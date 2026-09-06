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
 * Rules, all of which must hold:
 *  0. A zone we can resolve — else FAIL CLOSED (no hour is defensible).
 *  1. Not stale: the meeting ended within 61h.
 *  2. Morning band, 08:00-11:00 in the account's zone.
 *  3. The meeting ended on a strictly EARLIER local day.
 *  4. THE COLLISION: the calendar's follow-up email already fires the morning
 *     after a completed meeting. If `followup_sent_at` is set, it must be on
 *     a strictly earlier local day than today — day one "how did it go?", day
 *     two "would you leave a review?" — never both the same morning. Null
 *     means no follow-up was sent (feature off, no email, send failed) and
 *     there is nothing to defer to.
 *
 * `review_requested_at` still does all the deduping; this gate has no memory.
 */
export function shouldSendReviewRequestNow(
  now: Date, meetingEnd: Date, followupSentAt: Date | null, timezone: string,
): boolean {
  const elapsedMs = now.getTime() - meetingEnd.getTime();
  if (!Number.isFinite(elapsedMs)) return false;
  if (elapsedMs < 0) return false;                          // has not ended
  if (elapsedMs > REVIEW_REQUEST_MAX_AGE_MS) return false;  // too stale to be welcome

  const zone = resolveAccountZone(timezone);
  if (zone === null) return false;

  if (!isInMorningBand(now, zone)) return false;
  if (!isStrictlyEarlierLocalDay(meetingEnd, now, zone)) return false;

  if (followupSentAt !== null) {
    // An unparseable stamp is a data problem; the safe direction is to hold.
    if (!Number.isFinite(followupSentAt.getTime())) return false;
    if (!isStrictlyEarlierLocalDay(followupSentAt, now, zone)) return false;
  }
  return true;
}
