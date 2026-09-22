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
