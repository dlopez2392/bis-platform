import { NO_SHOW_NUDGE_MAX_AGE_MS } from "@bis/db";
import {
  resolveAccountZone, isInMorningBand, isStrictlyEarlierLocalDay,
} from "@/lib/booking/followup-timing";

/**
 * WHEN a no-show nudge may be sent — the pure half of the no-show pass.
 * The follow-up gate's shape exactly (the same two predicates), with the
 * follow-up's own 37h cap (NO_SHOW_NUDGE_MAX_AGE_MS, derived in
 * packages/db) and nothing to defer to: listDueFollowups excludes no_show,
 * so the two never meet.
 *
 * `anchor` is laterOf(ends_at, no_show_at) (anchor.ts) — the pass computes
 * it. Rules, all of which must hold:
 *  0. A zone we can resolve — else FAIL CLOSED.
 *  1. Not stale: the anchor is within 37h.
 *  2. Morning band, 08:00-11:00 in the account's zone.
 *  3. The anchor fell on a strictly EARLIER local day — an operator marking
 *     no-shows at midnight does not text anyone at midnight.
 *
 * `no_show_nudged_at` does all the deduping; this gate has no memory.
 *
 * `skipBand` is THE RELEASE PATH, and it skips rule 2 ALONE (the release
 * contract in part B's spec, line 16, and amendment B16). A held row passed
 * the band once, at the hour it was held, and is released at the quiet
 * window's end — by definition not a band hour — so re-applying rule 2 would
 * park every overnight hold for a whole extra day. Rules 0, 1 and 3 ARE
 * re-applied, because the releaser re-reads the booking: one un-marked and
 * re-marked no-show during the hold gives a brand-new `no_show_at`, and rule
 * 3 is the only thing anywhere that keeps that text off the same day.
 */
export function shouldSendNoShowNudgeNow(
  now: Date, anchor: Date, timezone: string, opts: { skipBand?: boolean } = {},
): boolean {
  const elapsedMs = now.getTime() - anchor.getTime();
  if (!Number.isFinite(elapsedMs)) return false;
  if (elapsedMs < 0) return false;
  if (elapsedMs > NO_SHOW_NUDGE_MAX_AGE_MS) return false;

  const zone = resolveAccountZone(timezone);
  if (zone === null) return false;

  if (!opts.skipBand && !isInMorningBand(now, zone)) return false;
  return isStrictlyEarlierLocalDay(anchor, now, zone);
}
