import { listBusinessStatusChanges, loadClosureSnapshot, type BusinessStatusChange, type SupabaseClient } from "@bis/db";
import { resolveAccountZone } from "@/lib/booking/followup-timing";
import { coversAppointment, dayKey, hoursChain, type StatusInput, type StatusRowInput } from "@/lib/business-status/status";
import { m } from "@/lib/messages";
import { LEDGER_RETRY_MS } from "./send-sms";

/**
 * The reminder hold (S-47d, spec 5.5.2; plan "The model, The hold"). A booking recipe's send waits while a
 * closure (Closed today, a storm, a planned closed day) covers its appointment, skips once its deadline has
 * passed, and holds for LEDGER_RETRY_MS when the status cannot be read: never a send while a closure might
 * be in force (the consent ledger's precedent).
 *
 * Owner rulings D13a and D13b (2026-10-24): the AUTOMATIC follow-up alone never sends for an appointment a
 * closure covered unless the owner kept it. It holds while the closure is in force, as everything else does,
 * and is skipped once the closure has ended, however it ended: on its own, or early, by switching to Open or
 * Running late. The review request, the referral ask and the no-show nudge go out only after staff mark the
 * booking, and that mark is proof of what happened, so for them an ended closure sends (SD6), as it does for
 * the three before-appointment recipes.
 *
 * The five reasons are written once, here, and spread into `REASONS` (hold-or-send.ts), which imports this
 * module; reading them back from there would be an import cycle.
 */
export const CLOSURE_REASONS = {
  heldClosedToday: m["automations.reason.heldClosedToday"],
  heldStorm: m["automations.reason.heldStorm"],
  heldClosedDay: m["automations.reason.heldClosedDay"],
  heldClosureUnknown: m["automations.reason.heldClosureUnknown"],
  skippedClosed: m["automations.reason.skippedClosed"],
} as const;

const DAY_MS = 86_400_000;
/** How far back the loader reads both the closed days and the switch's change log (D13b's 14 days). The
 *  follow-up is the reader that needs history: it goes up to 37 hours after the appointment ends
 *  (FOLLOWUP_MAX_AGE_MS, enforced on release too), so the closed day or closure its START fell in can be
 *  37 hours plus the appointment's length plus the zone's offset from UTC old, more than the one day the
 *  first loader read. Fourteen days covers that several times over and is the change log's own window. */
export const CLOSURE_LOOKBACK_DAYS = 14;

/** A stored Closed today or storm as it ran: from the change that set it until the next change or its own
 *  until, whichever came first. `end` null: no next change and no until (still open-ended). */
export type ClosureWindow = { start: Date; end: Date | null };

/** `windows` null: the change log could not be read (review m1). Only the follow-up needs it, so only the
 *  follow-up holds; every other send decides on the snapshot, as before the history existed. */
export type ClosureState =
  | { ok: true; input: Omit<StatusInput, "now">; windows: readonly ClosureWindow[] | null }
  | { ok: false };

/** The SUBJECT's own account, always: holdOrSend passes `s.accountId`. */
export type ClosureLoader = (accountId: string) => Promise<ClosureState>;

const CLOSING: readonly string[] = ["closed_today", "storm"];

/**
 * D13b: the closure history, rebuilt from the switch's own change log (`business_status.changed`, which the
 * set and undo actions emit after every successful change, through the server as 'system', the only rows
 * listBusinessStatusChanges reads, so a client cannot forge one: Task 9 review I1). ONE mechanism, the change
 * list, fed by:
 * - the logged changes in the lookback, oldest first;
 * - the stored row, as the newest change, when its own event is missing (a failed emit, or a row older than
 *   the log read); an event is logged a moment AFTER its update, so a logged row is never counted twice;
 * - the first logged change's `from`: a closure already running when the log read begins (set more than 14
 *   days ago) is the window from `lookbackStart` to that change.
 *
 * Each change to closed_today or storm opens a window that runs to the next change or its own until, whichever
 * comes first. An Undo is a change: set then undo leaves a window seconds long, which still counts but only
 * for an appointment that started inside it.
 *
 * WHERE THE LOG IS SILENT. Every event is written by the server right after a successful row update, so a
 * missing one means that insert failed (emit failures are logged, never shown). What happens depends on which
 * change it was (each case is pinned in closures.test.ts):
 * - the NEWEST change: the stored row stands in for it, nothing is lost;
 * - an END (a change away from closed_today or storm) in the middle of the log: the window runs on to the
 *   next logged change (P4). Fails CLOSED: a follow-up for an appointment after the real reopening is skipped;
 * - a SET that would have been the first change in the lookback: the next change's `from` opens the window
 *   from `lookbackStart` (P5). Fails CLOSED: a follow-up for an appointment before the real closure is skipped;
 * - a SET in the middle of the log that the row no longer carries: no window at all. Fails OPEN: that
 *   closure's follow-ups send. Only the first change's `from` is read; reading every `from` would close this
 *   gap, which is a redesign, not made.
 */
export function closureWindows(
  changes: readonly BusinessStatusChange[], row: StatusRowInput | null, lookbackStart: Date,
): ClosureWindow[] {
  type C = { at: number; from: string | null; to: string | null; until: number | null };
  const ms = (iso: string | null): number | null => {
    if (iso === null) return null;
    const t = Date.parse(iso);
    return Number.isFinite(t) ? t : null;
  };
  const list: C[] = [];
  for (const c of changes) {
    const at = ms(c.at);
    if (at !== null) list.push({ at, from: c.from, to: c.to, until: ms(c.until) });
  }
  list.sort((a, b) => a.at - b.at);
  const out: ClosureWindow[] = [];
  const first = list[0];
  if (first && first.from !== null && CLOSING.includes(first.from)) {
    out.push({ start: lookbackStart, end: new Date(first.at) });
  }
  const setAt = row ? ms(row.set_at) : null;
  const last = list[list.length - 1];
  if (row && setAt !== null && (!last || last.at < setAt)) {
    list.push({ at: setAt, from: null, to: row.state, until: ms(row.until) });
  }
  list.forEach((c, i) => {
    if (c.to === null || !CLOSING.includes(c.to)) return;
    const ends = [list[i + 1]?.at ?? null, c.until].filter((x): x is number => x !== null);
    out.push({ start: new Date(c.at), end: ends.length > 0 ? new Date(Math.min(...ends)) : null });
  });
  return out;
}

/**
 * One read per account per tick, always for the accountId it is called with: loadClosureSnapshot and the
 * change log (listBusinessStatusChanges), in parallel, memoised together as one PROMISE per accountId.
 * - A failed SNAPSHOT read, or a snapshot the mapper cannot read (review M1), is { ok: false } for the tick:
 *   every booking send of the account holds LEDGER_RETRY_MS.
 * - A failed CHANGE-LOG read is `windows: null` (review m1): only the follow-up, which alone reads the
 *   history, holds LEDGER_RETRY_MS; never a silent send.
 * Each failure logs one line, the account id only. Both reach back CLOSURE_LOOKBACK_DAYS. Keep is not read
 * here: it comes from each due row (SD20).
 */
export function closureLoader(db: SupabaseClient, now: Date): ClosureLoader {
  const lookbackStart = new Date(now.getTime() - CLOSURE_LOOKBACK_DAYS * DAY_MS);
  const since = { date: dayKey(lookbackStart, "UTC") };
  const memo = new Map<string, Promise<ClosureState>>();
  return (accountId) => {
    let read = memo.get(accountId);
    if (!read) {
      // Inside an async thunk, so even a throw before any promise exists becomes the { ok: false } below; the
      // catch comes AFTER the mapper, so a snapshot it cannot read is { ok: false } too (review M1).
      const history = (async () => listBusinessStatusChanges(db, accountId, lookbackStart.toISOString()))()
        .catch((): null => {
          console.error(`closures: the closure history could not be read for account ${accountId}; its follow-ups hold`);
          return null;
        });
      read = (async () => Promise.all([loadClosureSnapshot(db, accountId, since), history]))()
        .then(([snap, changes]): ClosureState => ({
          ok: true,
          input: {
            row: snap.row,
            closedDays: snap.closedDays,
            hours: hoursChain(snap.hours.businessHours, snap.hours.calendarHours),
            // An unresolvable stored zone reads UTC as a null one does: the reader's Intl calls would
            // otherwise throw inside every booking send of the account.
            timezone: resolveAccountZone(snap.timezone) ?? "UTC",
          },
          windows: changes === null ? null : closureWindows(changes, snap.row, lookbackStart),
        }))
        .catch((): ClosureState => {
          console.error(`closures: the business status could not be read for account ${accountId}; its booking sends hold`);
          return { ok: false };
        });
      memo.set(accountId, read);
    }
    return read;
  };
}

/** For tests: every account reads open, no closed days, no closure history. */
export const NO_CLOSURES: ClosureLoader = async () => ({
  ok: true, input: { row: null, closedDays: [], hours: null, timezone: "UTC" }, windows: [],
});

export type ClosureVerdict =
  | { kind: "send" }
  | { kind: "held"; until: Date; reason: string }
  | { kind: "skipped"; reason: string };

const HELD_REASON = {
  closed_today: CLOSURE_REASONS.heldClosedToday,
  storm: CLOSURE_REASONS.heldStorm,
  closed_day: CLOSURE_REASONS.heldClosedDay,
} as const;

/**
 * What a closure says about one send for an appointment at `appointmentAt`:
 * - an unreadable status: held until now + LEDGER_RETRY_MS;
 * - kept (the due row's own closure_kept_at): send, however old the appointment;
 * - covered by a closure in force: skipped once the deadline has passed, else held until the earlier of the
 *   window's end and the deadline, or now + 24 hours when neither exists (an open-ended storm), so a held row
 *   never carries a past held_until;
 * - otherwise the closure, if any, has ended: a closed day whose window has passed (SD6), or a stored closure
 *   in the history (D13b). The follow-up (`skipIfWasClosed`) is skipped (D13a), or held LEDGER_RETRY_MS when
 *   the history could not be read (review m1); every other send goes.
 */
export function closureVerdict(
  state: ClosureState,
  s: { appointmentAt: Date; kept: boolean; deadline?: Date | null; skipIfWasClosed?: boolean },
  now: Date,
): ClosureVerdict {
  if (!state.ok) {
    return { kind: "held", until: new Date(now.getTime() + LEDGER_RETRY_MS), reason: CLOSURE_REASONS.heldClosureUnknown };
  }
  if (s.kept) return { kind: "send" };
  const cover = coversAppointment({ ...state.input, now }, s.appointmentAt);
  const inForce = cover.covered && (cover.endsAt === null || cover.endsAt.getTime() > now.getTime());
  if (!inForce) {
    if (s.skipIfWasClosed) {
      if (cover.covered) return { kind: "skipped", reason: CLOSURE_REASONS.skippedClosed };
      if (state.windows === null) {
        return { kind: "held", until: new Date(now.getTime() + LEDGER_RETRY_MS), reason: CLOSURE_REASONS.heldClosureUnknown };
      }
      const t = s.appointmentAt.getTime();
      const wasClosed = state.windows.some((w) => t >= w.start.getTime() && (w.end === null || t < w.end.getTime()));
      if (wasClosed) return { kind: "skipped", reason: CLOSURE_REASONS.skippedClosed };
    }
    return { kind: "send" };
  }
  const deadline = s.deadline ?? null;
  if (deadline !== null && deadline.getTime() <= now.getTime()) {
    return { kind: "skipped", reason: CLOSURE_REASONS.skippedClosed };
  }
  const ends = [cover.endsAt, deadline].filter((x): x is Date => x !== null).map((x) => x.getTime());
  const until = ends.length > 0 ? new Date(Math.min(...ends)) : new Date(now.getTime() + DAY_MS);
  return { kind: "held", until, reason: HELD_REASON[cover.kind] };
}
