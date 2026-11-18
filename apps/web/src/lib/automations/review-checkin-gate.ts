import { resolveAccountZone } from "@/lib/booking/followup-timing";

/**
 * WHEN the after-the-job check-in may be sent (F-072, plan D4): the pure half of the check-in branch of the
 * review-request pass. Three rules, all of which must hold:
 *  0. A zone we can resolve, else FAIL CLOSED (the sending hours are judged in it).
 *  1. At least CHECKIN_DELAY_MS (2 h) since the anchor, `laterOf(ends_at, completed_at)` (anchor.ts).
 *  2. Not more than CHECKIN_MAX_AGE_MS since it: a request that old is not welcome, an outage of days must not
 *     come back up and mail someone about a job they have forgotten.
 *
 * NO MORNING BAND, and NO "strictly later local day": the check-in is meant for the afternoon the job was done.
 * NO DEFERRAL to `followup_sent_at`: with the check-in on, the calendar follow-up is the one that stands down
 * (booking.ts, listDueFollowups), and a follow-up that went on an earlier day is a different ask.
 *
 * THE SENDING HOURS ARE NOT HERE. They come from the consent chain: `holdOrSend` holds an automated email outside
 * 08:00 to 21:00 in the account's zone and the release pass sends it at the opening, so a job completed at 20:30 is
 * due at 22:30, held, and goes at 08:00 the next morning, still inside the cap. The gate runs again on that
 * release (the pass's release path re-gates, it does not re-band: there is no band to skip).
 *
 * CHECKIN_MAX_AGE_MS = 36 h, DERIVED:
 *   2 h    the delay itself.
 *  +11 h   the longest the consent chain can hold it: due the instant the hours close (21:00), sent when they
 *          open (08:00).
 *  +1 h    a fall-back night, whose local day is 25 hours long (pinned below with America/Chicago, 2026-11-01).
 *  = 14 h  the latest a send is still on schedule.
 *  The other 22 h are slack for the caps (caps.ts: 10 a tick, 25 a day) and for a tick or two that failed.
 *  It is also at most REVIEW_REQUEST_MAX_AGE_MS (61 h, packages/db), the window the due-list reads, so the list
 *  never drops a row this gate would still send. (The plan's prose adds a "day of slack" to 2 + 11 and calls it
 *  36, which is 37; the figure is the binding one and is kept, with the sum shown honestly here.)
 *
 * `review_requested_at` still does all the deduping; this gate has no memory.
 */
export const CHECKIN_DELAY_MS = 2 * 60 * 60 * 1000;
export const CHECKIN_MAX_AGE_MS = 36 * 60 * 60 * 1000;

/** Where a check-in stands on the clock: `early` (under 2 h, or an unreadable instant or zone: it is not time), `due`,
 *  or `late` (past 36 h: it will never send, and the pass counts it apart so a quiet "waiting" count cannot hide it). */
export type CheckinTiming = "early" | "due" | "late";

export function checkinTiming(now: Date, anchor: Date, timezone: string): CheckinTiming {
  const elapsedMs = now.getTime() - anchor.getTime();
  if (!Number.isFinite(elapsedMs)) return "early";
  if (resolveAccountZone(timezone) === null) return "early";
  if (elapsedMs < CHECKIN_DELAY_MS) return "early";
  return elapsedMs <= CHECKIN_MAX_AGE_MS ? "due" : "late";
}

export function shouldSendCheckinNow(now: Date, anchor: Date, timezone: string): boolean {
  return checkinTiming(now, anchor, timezone) === "due";
}
