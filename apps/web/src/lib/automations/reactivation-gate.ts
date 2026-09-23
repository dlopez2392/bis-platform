import { resolveAccountZone, isInMorningBand } from "@/lib/booking/followup-timing";

/**
 * WHEN a reactivation email may go — and that is ALL this gate decides. The
 * quiet period itself is a query predicate (listDueReactivations), not a
 * gate, because "has this person been silent for nine months" is a question
 * the database can answer once for every account rather than one the pass
 * asks per row.
 *
 * FAIL CLOSED on an unresolvable zone: no hour is defensible, and this runs
 * inside a cron tick with no one watching.
 */
export function shouldSendReactivationNow(now: Date, timezone: string): boolean {
  const zone = resolveAccountZone(timezone);
  if (zone === null) return false;
  if (!Number.isFinite(now.getTime())) return false;
  return isInMorningBand(now, zone);
}

/**
 * WHAT a reactivation email cannot go without — RE-EXPORTED, not defined
 * here. The rule's home is `@bis/db` (`automations.ts`) because the due-list
 * walk lives there and has to leave out an account missing either, and
 * packages/db cannot import web. The pass, the save action and the card keep
 * importing it from this module; `reactivation-gate.test.ts` pins that this
 * is the same function object, never a copy.
 */
export { missingForReactivation } from "@bis/db";
