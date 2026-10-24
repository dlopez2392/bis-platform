import { loadClosureSnapshot, type SupabaseClient } from "@bis/db";
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
 * Owner ruling D13 (2026-10-24): the four AFTER-appointment recipes (follow-up, no-show nudge, review request,
 * referral ask) never send for an appointment a closure covered unless the owner kept it. They hold while the
 * closure is in force, as the reminders do, and are skipped once it has ended.
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
/** D13: how far back the loader reads closed days. An after-appointment message is anchored at the later of
 *  the appointment's end and the operator's status stamp (anchor.ts): the referral ask runs up to 85 hours
 *  after it, and a week of jobs marked completed on Friday anchors Monday's at Friday. Fourteen days covers
 *  both with room to spare; a closed day older than that is not seen, so its message sends. */
export const CLOSED_DAY_LOOKBACK_DAYS = 14;

export type ClosureState =
  | { ok: true; input: Omit<StatusInput, "now"> }
  | { ok: false };

/** The SUBJECT's own account, always: holdOrSend passes `s.accountId`. */
export type ClosureLoader = (accountId: string) => Promise<ClosureState>;

/**
 * One loadClosureSnapshot per account per tick, always for the accountId it is called with. Memoises the
 * PROMISE per accountId, so concurrent callers share one read; a failed read is memoised as { ok: false }
 * for the tick and logged once (the account id only), including a snapshot the mapper below cannot read.
 * The closed days kept are the ranges ending on or after the UTC date CLOSED_DAY_LOOKBACK_DAYS back, so an
 * after-appointment message can still see the closed day its appointment fell on (D13). Keep is not read here:
 * it comes from each due row (SD20).
 */
export function closureLoader(db: SupabaseClient, now: Date): ClosureLoader {
  const since = { date: dayKey(new Date(now.getTime() - CLOSED_DAY_LOOKBACK_DAYS * DAY_MS), "UTC") };
  const memo = new Map<string, Promise<ClosureState>>();
  return (accountId) => {
    let read = memo.get(accountId);
    if (!read) {
      // Inside an async thunk, so even a throw before any promise exists becomes the { ok: false } below; the
      // catch comes AFTER the mapper, so a snapshot it cannot read is { ok: false } too (review M1).
      read = (async () => loadClosureSnapshot(db, accountId, since))()
        .then((snap): ClosureState => ({
          ok: true,
          input: {
            row: snap.row,
            closedDays: snap.closedDays,
            hours: hoursChain(snap.hours.businessHours, snap.hours.calendarHours),
            // An unresolvable stored zone reads UTC as a null one does: the reader's Intl calls would
            // otherwise throw inside every booking send of the account.
            timezone: resolveAccountZone(snap.timezone) ?? "UTC",
          },
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

/** For tests: every account reads open, no closed days. */
export const NO_CLOSURES: ClosureLoader = async () => ({
  ok: true, input: { row: null, closedDays: [], hours: null, timezone: "UTC" },
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
 * D13: the stored Closed today or storm whose window has ENDED (its until is at or before now) and held
 * `startsAt`. coversAppointment cannot say so: it reads a stored closure only while it is in force. The row
 * keeps that window until the switch is changed again; switching to Open (or anything else) replaces it, and
 * that is the owner's release.
 */
function endedStatusWindow(row: StatusRowInput | null, startsAt: Date, now: Date): boolean {
  if (!row || (row.state !== "storm" && row.state !== "closed_today") || row.until === null) return false;
  const t = startsAt.getTime();
  const until = Date.parse(row.until);
  return until <= now.getTime() && t >= Date.parse(row.set_at) && t < until;
}

/**
 * What a closure says about one send for an appointment at `appointmentAt`:
 * - an unreadable status: held until now + LEDGER_RETRY_MS;
 * - kept (the due row's own closure_kept_at): send, however old the appointment;
 * - a closure covered the appointment and has ENDED (SD6, or a stored closure whose until has passed): an
 *   after-appointment send is skipped (D13); a before-appointment send goes;
 * - not covered: send;
 * - a deadline at or before now: skipped;
 * - else held until the earlier of the window's end and the deadline, or now + 24 hours when neither
 *   exists (an open-ended storm), so a held row never carries a past held_until.
 */
export function closureVerdict(
  state: ClosureState,
  s: { appointmentAt: Date; kept: boolean; deadline?: Date | null; afterAppointment?: boolean },
  now: Date,
): ClosureVerdict {
  if (!state.ok) {
    return { kind: "held", until: new Date(now.getTime() + LEDGER_RETRY_MS), reason: CLOSURE_REASONS.heldClosureUnknown };
  }
  if (s.kept) return { kind: "send" };
  const cover = coversAppointment({ ...state.input, now }, s.appointmentAt);
  const ended = cover.covered
    ? cover.endsAt !== null && cover.endsAt.getTime() <= now.getTime()
    : endedStatusWindow(state.input.row, s.appointmentAt, now);
  if (ended && s.afterAppointment) return { kind: "skipped", reason: CLOSURE_REASONS.skippedClosed };
  if (!cover.covered || ended) return { kind: "send" };
  const deadline = s.deadline ?? null;
  if (deadline !== null && deadline.getTime() <= now.getTime()) {
    return { kind: "skipped", reason: CLOSURE_REASONS.skippedClosed };
  }
  const ends = [cover.endsAt, deadline].filter((x): x is Date => x !== null).map((x) => x.getTime());
  const until = ends.length > 0 ? new Date(Math.min(...ends)) : new Date(now.getTime() + DAY_MS);
  return { kind: "held", until, reason: HELD_REASON[cover.kind] };
}
