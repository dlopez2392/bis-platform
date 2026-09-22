import { QUOTE_FOLLOWUP_MAX_AGE_MS } from "@bis/db";
import { resolveAccountZone, isInMorningBand } from "@/lib/booking/followup-timing";

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * WHEN a quote follow-up may go - the pure half of the pass. There is no
 * "strictly earlier local day" rule here, unlike the completed-job ladder:
 * the quiet period is at least one whole day already, so the rule it would
 * enforce is enforced by the operator's own setting.
 *
 * The "have they replied since?" test is NOT here, because it is a query
 * (listDueQuoteFollowups, and again in the releaser). A gate that took a
 * database would not be a gate.
 *
 * FAIL CLOSED on an unresolvable zone: no hour is defensible.
 */
export function shouldSendQuoteFollowupNow(
  now: Date, stageChangedAt: Date, quietDays: number, timezone: string,
): boolean {
  const elapsedMs = now.getTime() - stageChangedAt.getTime();
  if (!Number.isFinite(elapsedMs)) return false;
  if (elapsedMs < quietDays * DAY_MS) return false;         // not quiet long enough yet
  if (elapsedMs > QUOTE_FOLLOWUP_MAX_AGE_MS) return false;  // a month on, it reads as a mistake

  const zone = resolveAccountZone(timezone);
  if (zone === null) return false;
  return isInMorningBand(now, zone);
}
