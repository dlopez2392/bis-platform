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
 *
 * `skipBand` is THE RELEASE PATH, and it skips the BAND ALONE (the spec's
 * release contract, line 16, and amendment B16). A held row passed the band
 * once, at the hour it was held; it is released at the quiet window's end,
 * which is by definition not a morning-band hour, so re-applying the band
 * would park every overnight hold for a whole extra day. Everything ELSE in
 * here is re-applied, because the operator's own `quietDays` and the 30-day
 * staleness cap live NOWHERE else: a deal dragged out of the watched stage
 * and back into it during the hold has a brand-new `stage_changed_at`, and
 * chasing it at noon is exactly the setting the operator wrote down being
 * ignored (audit B's I3).
 */
export function shouldSendQuoteFollowupNow(
  now: Date, stageChangedAt: Date, quietDays: number, timezone: string,
  opts: { skipBand?: boolean } = {},
): boolean {
  const elapsedMs = now.getTime() - stageChangedAt.getTime();
  if (!Number.isFinite(elapsedMs)) return false;
  if (elapsedMs < quietDays * DAY_MS) return false;         // not quiet long enough yet
  if (elapsedMs > QUOTE_FOLLOWUP_MAX_AGE_MS) return false;  // a month on, it reads as a mistake

  const zone = resolveAccountZone(timezone);
  if (zone === null) return false;   // never skipped: a release with no zone is still no hour
  if (opts.skipBand) return true;
  return isInMorningBand(now, zone);
}
