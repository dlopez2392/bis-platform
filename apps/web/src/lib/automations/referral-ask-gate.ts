import { REFERRAL_ASK_MAX_AGE_MS, REVIEW_REQUEST_MAX_AGE_MS } from "@bis/db";
import {
  resolveAccountZone, isInMorningBand, isStrictlyEarlierLocalDay,
} from "@/lib/booking/followup-timing";

/**
 * THE PRECEDENCE RULE, on its own so the pass can count it separately from
 * "not this morning" — two very different reasons a referral ask did not go.
 *
 * When review requests are ON for this account, the review has not been sent,
 * and the job's anchor is still inside the review's OWN 61-hour window, the
 * referral ask waits. That makes the ladder an ordering rather than a
 * coincidence: without it, a morning where both became eligible would send
 * whichever pass ran first, and the registry's order is not a product promise.
 *
 * Once the review's 61h has run out unsent (the feature was off, no address,
 * three failed texts), there is nothing left to defer to and the referral ask
 * goes on its own.
 */
export function reviewRequestStillOwed(
  now: Date, anchor: Date, reviewRequestedAt: Date | null, reviewRequestEnabled: boolean,
): boolean {
  // POLARITY, because every `return false` in this function means "NOT owed",
  // which lets the referral ask PROCEED — the opposite of what the identical
  // line means in `shouldSendReferralAskNow` below, where false means "do not
  // send". The two functions are one file apart and their `return false`s are
  // byte-identical; a line copied from here into a send gate would turn a
  // fail-closed into a fail-open.
  if (!reviewRequestEnabled) return false;      // reviews are off: nothing to defer to
  if (reviewRequestedAt !== null) return false; // already sent: the rung below is done
  const elapsedMs = now.getTime() - anchor.getTime();
  // NOT owed on an unreadable anchor. Unreachable today (both anchors are
  // `timestamptz` and the pass only reaches here past its own parse), and the
  // SAFE direction for THIS predicate is the permissive one: the alternative
  // is a row that defers to a review request that can never be sent, i.e. a
  // referral ask that is never sent either. The send gate re-checks the same
  // arithmetic and fails CLOSED on it (see below), so a broken anchor still
  // sends nothing — this line decides only whether the review has priority.
  if (!Number.isFinite(elapsedMs)) return false;
  return elapsedMs <= REVIEW_REQUEST_MAX_AGE_MS;
}

/**
 * WHEN a referral ask may be sent — the pure, unit-testable half of the pass.
 * Composes the same predicates as the review-request gate rather than copying
 * them, so the three rungs cannot drift. All must hold:
 *  0. A zone we can resolve — else FAIL CLOSED (no hour is defensible).
 *  1. Not stale: the anchor is within 85h (61h plus one local day).
 *  2. Morning band, 08:00–11:00 in the account's zone.
 *  3. The anchor fell on a strictly EARLIER local day.
 *  4. BOTH earlier rungs' stamps, when set, fell on strictly earlier local
 *     days: day one "how did it go?", day two "would you leave a review?",
 *     day three "know anyone else?" — never two on one morning.
 *  5. The review request is not still owed (above).
 *
 * `referral_asked_at` does all the deduping; this gate has no memory.
 *
 * `skipBand` is THE RELEASE PATH, and it skips rule 2 ALONE (the spec's
 * release contract, line 16, and amendment B16). A held row passed the band
 * once, at the hour it was held, and is released at the quiet window's end —
 * by definition not a band hour — so re-applying rule 2 would park every
 * overnight hold for a whole extra day. Rules 1, 3, 4 and 5 ARE re-applied,
 * because rule 4 lives NOWHERE else: two rows held inside the same quiet
 * window (the review request's, written first, then the referral's) release
 * on the same tick, and without rule 4 on the release path the customer gets
 * "would you leave a review?" and "know anyone else?" one minute apart —
 * audit B's I1, and the exact opposite of what the card promises.
 */
export function shouldSendReferralAskNow(
  now: Date, anchor: Date, followupSentAt: Date | null, reviewRequestedAt: Date | null,
  reviewRequestEnabled: boolean, timezone: string,
  opts: { skipBand?: boolean } = {},
): boolean {
  // POLARITY, the mirror of the note in `reviewRequestStillOwed`: every
  // `return false` from here down means DO NOT SEND. Same three words, the
  // opposite decision — this is the fail-closed half.
  const elapsedMs = now.getTime() - anchor.getTime();
  if (!Number.isFinite(elapsedMs)) return false;          // unreadable anchor: no defensible hour
  if (elapsedMs < 0) return false;                        // has not ended
  if (elapsedMs > REFERRAL_ASK_MAX_AGE_MS) return false;  // too stale to be welcome

  const zone = resolveAccountZone(timezone);
  if (zone === null) return false;   // never skipped: a release with no zone is still no hour

  if (!opts.skipBand && !isInMorningBand(now, zone)) return false;
  if (!isStrictlyEarlierLocalDay(anchor, now, zone)) return false;

  for (const stamp of [followupSentAt, reviewRequestedAt]) {
    if (stamp === null) continue;
    // An unparseable stamp is a data problem; the safe direction is to hold.
    if (!Number.isFinite(stamp.getTime())) return false;
    if (!isStrictlyEarlierLocalDay(stamp, now, zone)) return false;
  }

  if (reviewRequestStillOwed(now, anchor, reviewRequestedAt, reviewRequestEnabled)) return false;
  return true;
}
