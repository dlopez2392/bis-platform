import { REVIEW_REQUEST_MAX_AGE_MS } from "@bis/db";
import {
  resolveAccountZone, isInMorningBand, isStrictlyEarlierLocalDay,
} from "@/lib/booking/followup-timing";

/**
 * WHEN a review request may be sent — the pure, unit-testable half of the
 * review-request pass. Composes the follow-up gate's own predicates rather
 * than copying them, so the two gates cannot drift; it cannot simply CALL
 * `shouldSendFollowupNow` because that carries the 37h cap and this one
 * carries 61h (`REVIEW_REQUEST_MAX_AGE_MS`, derived in packages/db).
 *
 * `anchor` is laterOf(ends_at, completed_at) (anchor.ts) — the pass computes
 * it; this gate only knows an instant. Rules, all of which must hold:
 *  0. A zone we can resolve — else FAIL CLOSED (no hour is defensible).
 *  1. Not stale: the anchor is within 61h.
 *  2. Morning band, 08:00-11:00 in the account's zone.
 *  3. The anchor fell on a strictly EARLIER local day.
 *  4. THE COLLISION: the calendar's follow-up email already fires the morning
 *     after a completed meeting. If `followup_sent_at` is set, it must be on
 *     a strictly earlier local day than today — day one "how did it go?", day
 *     two "would you leave a review?" — never both the same morning. Null
 *     means no follow-up was sent (feature off, no email, send failed) and
 *     there is nothing to defer to.
 *
 * `review_requested_at` still does all the deduping; this gate has no memory.
 *
 * `skipBand` is THE RELEASE PATH, and it skips rule 2 ALONE (the release
 * contract in part B's spec, line 16, and amendment B16). A held row passed
 * the band once, at the hour it was held, and is released at the quiet
 * window's end — by definition not a band hour — so re-applying rule 2 would
 * park every overnight hold for a whole extra day. Rules 0, 1, 3 and 4 ARE
 * re-applied, and RULE 4 IS THE WHOLE POINT: the calendar follow-up and this
 * request can both be held inside one quiet window and come back on the same
 * tick, and rule 4 lives nowhere else — without it on the release path the
 * customer gets "how did it go?" and "would you leave a review?" one minute
 * apart, the exact collision the rule exists to stop.
 */
export function shouldSendReviewRequestNow(
  now: Date, anchor: Date, followupSentAt: Date | null, timezone: string,
  opts: { skipBand?: boolean } = {},
): boolean {
  const elapsedMs = now.getTime() - anchor.getTime();
  if (!Number.isFinite(elapsedMs)) return false;
  if (elapsedMs < 0) return false;                          // has not ended
  if (elapsedMs > REVIEW_REQUEST_MAX_AGE_MS) return false;  // too stale to be welcome

  const zone = resolveAccountZone(timezone);
  if (zone === null) return false;

  if (!opts.skipBand && !isInMorningBand(now, zone)) return false;
  if (!isStrictlyEarlierLocalDay(anchor, now, zone)) return false;

  if (followupSentAt !== null) {
    // An unparseable stamp is a data problem; the safe direction is to hold.
    if (!Number.isFinite(followupSentAt.getTime())) return false;
    if (!isStrictlyEarlierLocalDay(followupSentAt, now, zone)) return false;
  }
  return true;
}
