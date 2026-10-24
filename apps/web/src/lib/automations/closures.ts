import { loadClosureSnapshot, type SupabaseClient } from "@bis/db";
import { resolveAccountZone } from "@/lib/booking/followup-timing";
import { coversAppointment, dayKey, hoursChain, type StatusInput } from "@/lib/business-status/status";
import { m } from "@/lib/messages";
import { LEDGER_RETRY_MS } from "./send-sms";

/**
 * The reminder hold (S-47d, spec 5.5.2; plan "The model, The hold"). A booking recipe's send waits while a
 * closure (Closed today, a storm, a planned closed day) covers its appointment, skips once its deadline has
 * passed, and holds for LEDGER_RETRY_MS when the status cannot be read: never a send while a closure might
 * be in force (the consent ledger's precedent).
 *
 * The five reasons are read from the catalogue here, the same keys `REASONS` (hold-or-send.ts) carries, and
 * not through `REASONS` itself: hold-or-send.ts imports this module, so reading back from it would be an
 * import cycle.
 */
const CLOSURE_REASONS = {
  heldClosedToday: m["automations.reason.heldClosedToday"],
  heldStorm: m["automations.reason.heldStorm"],
  heldClosedDay: m["automations.reason.heldClosedDay"],
  heldClosureUnknown: m["automations.reason.heldClosureUnknown"],
  skippedClosed: m["automations.reason.skippedClosed"],
} as const;

const DAY_MS = 86_400_000;

export type ClosureState =
  | { ok: true; input: Omit<StatusInput, "now"> }
  | { ok: false };

/** The SUBJECT's own account, always: holdOrSend passes `s.accountId`. */
export type ClosureLoader = (accountId: string) => Promise<ClosureState>;

/**
 * One loadClosureSnapshot per account per tick, always for the accountId it is called with. Memoises the
 * PROMISE per accountId, so concurrent callers share one read; a failed read is memoised as { ok: false }
 * for the tick and logged once (the account id only). The closed days kept are the ranges ending on or after
 * yesterday in UTC: an older closed day's window ended long ago (D12), so a late follow-up for it sends (SD6).
 * Keep is not read here: it comes from each due row (SD20).
 */
export function closureLoader(db: SupabaseClient, now: Date): ClosureLoader {
  const since = { date: dayKey(new Date(now.getTime() - DAY_MS), "UTC") };
  const memo = new Map<string, Promise<ClosureState>>();
  return (accountId) => {
    let read = memo.get(accountId);
    if (!read) {
      // Inside an async thunk, so even a throw before any promise exists becomes the { ok: false } below.
      read = (async () => loadClosureSnapshot(db, accountId, since))().then(
        (snap): ClosureState => ({
          ok: true,
          input: {
            row: snap.row,
            closedDays: snap.closedDays,
            hours: hoursChain(snap.hours.businessHours, snap.hours.calendarHours),
            // An unresolvable stored zone reads UTC as a null one does: the reader's Intl calls would
            // otherwise throw inside every booking send of the account.
            timezone: resolveAccountZone(snap.timezone) ?? "UTC",
          },
        }),
        (): ClosureState => {
          console.error(`closures: the business status could not be read for account ${accountId}; its booking sends hold`);
          return { ok: false };
        },
      );
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
 * What a closure says about one send for an appointment at `appointmentAt`:
 * - an unreadable status: held until now + LEDGER_RETRY_MS;
 * - kept (the due row's own closure_kept_at): send, however old the appointment;
 * - not covered, or covered by a window that ended at or before now (SD6): send;
 * - a deadline at or before now: skipped;
 * - else held until the earlier of the window's end and the deadline, or now + 24 hours when neither
 *   exists (an open-ended storm), so a held row never carries a past held_until.
 */
export function closureVerdict(
  state: ClosureState, s: { appointmentAt: Date; kept: boolean; deadline?: Date | null }, now: Date,
): ClosureVerdict {
  if (!state.ok) {
    return { kind: "held", until: new Date(now.getTime() + LEDGER_RETRY_MS), reason: CLOSURE_REASONS.heldClosureUnknown };
  }
  if (s.kept) return { kind: "send" };
  const cover = coversAppointment({ ...state.input, now }, s.appointmentAt);
  if (!cover.covered) return { kind: "send" };
  if (cover.endsAt !== null && cover.endsAt.getTime() <= now.getTime()) return { kind: "send" };
  const deadline = s.deadline ?? null;
  if (deadline !== null && deadline.getTime() <= now.getTime()) {
    return { kind: "skipped", reason: CLOSURE_REASONS.skippedClosed };
  }
  const ends = [cover.endsAt, deadline].filter((x): x is Date => x !== null).map((x) => x.getTime());
  const until = ends.length > 0 ? new Date(Math.min(...ends)) : new Date(now.getTime() + DAY_MS);
  return { kind: "held", until, reason: HELD_REASON[cover.kind] };
}
