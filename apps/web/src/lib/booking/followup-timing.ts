import { safeZone } from "./time";

/**
 * WHEN a post-meeting follow-up may be sent — the pure, unit-testable half of
 * the follow-up pass in `api/cron/reminders/route.ts`.
 *
 * Why this exists at all. Until 2026-09-05 the platform's single cron entry
 * ran once a day at 14:00 UTC (the Vercel Hobby plan rejects any deployment
 * carrying a sub-daily schedule), and `listDueFollowups` simply returned
 * anything whose meeting had ended in the previous 25 hours. Follow-ups
 * therefore landed the next morning — but only as an ACCIDENT of the tick
 * hour: 14:00 UTC is early morning in the Rio Grande Valley. On the Pro plan
 * the job ticks every 15 minutes and that accident is gone. Without this gate
 * a follow-up would fire within 15 minutes of the meeting ending, while the
 * customer is still in the parking lot.
 *
 * The product decision was to KEEP next-morning and make it explicit, in the
 * ACCOUNT's own timezone rather than in whatever zone the serverless region
 * happens to run in. Two rules, both of which must hold:
 *
 *  1. MORNING BAND — it is currently between 08:00 (inclusive) and 11:00
 *     (exclusive) local. 08:00 because that is when a Valley business opens
 *     and the mail is the first thing the customer reads; 11:00 because after
 *     that it is not morning and the note stops reading as "the morning after
 *     your appointment". The band is three hours rather than one tick wide on
 *     purpose: any of the ~12 ticks inside it can be the one that sends, so
 *     losing a few ticks to an outage costs nothing.
 *
 *  2. STRICTLY LATER LOCAL DAY — the meeting ended on an EARLIER local
 *     calendar day than today. This is what stops a meeting that ended at
 *     07:00 from being "followed up" at 08:00 the same morning; a follow-up
 *     has to read as next-day, not same-session. Comparing local calendar
 *     dates (not "at least N hours ago") is what makes an 09:00 appointment
 *     and a 23:00 appointment both wait for the next morning, which is the
 *     behaviour a business owner would describe if asked.
 *
 * Plus a staleness cap, so a multi-day outage cannot come back up and mail
 * someone about a meeting they have forgotten — see FOLLOWUP_MAX_AGE_MS.
 *
 * And a third rule that is really a precondition for the other two: RULE 0,
 * A ZONE WE CAN ACTUALLY RESOLVE — see `resolveAccountZone`. Both rules above
 * are statements about local time, and neither means anything without one.
 *
 * `followup_sent_at` still does all the deduping. This gate only decides
 * whether NOW is an acceptable moment; it has no memory.
 */

export const FOLLOWUP_MORNING_START_HOUR = 8;
export const FOLLOWUP_MORNING_END_HOUR = 11;

/**
 * The oldest a meeting may be and still earn a follow-up — and the figure
 * `listDueFollowups`' backward query window is sized to, so that the gate can
 * always fire at least once for any booking that will ever qualify. It is
 * derived, not rounded:
 *
 *   32h   worst case, a meeting ends at 00:00:00 local on day D. It then
 *         waits out the rest of D (24h) and the small hours of D+1 (8h)
 *         before the band can OPEN. Ending at local midnight is the worst
 *         case precisely because it maximises that wait.
 *   + 3h  the band stays open until 11:00 local. Sizing to the band's CLOSE
 *         rather than its open is deliberate: it means every tick in the
 *         qualifying window still finds the row in the query result, so the
 *         gate has ~12 chances to fire instead of exactly one.
 *   + 2h  the largest scheduled backward clock shift in the IANA database
 *         (Antarctica/Troll swings UTC+2 → UTC+0 each October), which makes
 *         local day D 26 REAL hours long. America/New_York's own 1h fall-back
 *         is the ordinary case and costs 33h; 2h covers the extreme.
 *   = 37h
 *
 * Because the band's upper edge is exclusive, the cap is never the binding
 * constraint at the boundary — 11:00 local is already excluded by rule 1. The
 * cap earns its keep further out: it is what makes a week-old booking
 * unmailable no matter how long the cron was down.
 *
 * It does leave a bounded catch-up. A meeting that ended late on day D and
 * whose whole D+1 morning was missed can still be picked up on D+2's morning
 * if that lands inside 37h. Two mornings late is a recoverable outcome; a
 * week late is not, and that is the line this constant draws.
 *
 * Not covered: a jurisdiction permanently moving its clock BACKWARD by more
 * than two hours between the meeting and the next morning. The failure mode
 * there is a silently dropped follow-up, never a mistimed one — the safe
 * direction.
 */
export const FOLLOWUP_MAX_AGE_MS = 37 * 60 * 60 * 1000;

/**
 * A sentinel `safeZone` can hand back as a FALLBACK but never as a SUCCESS.
 * `safeZone` returns its input verbatim only when the `Intl` probe succeeds,
 * and `!` is not legal in an IANA zone name, so this string can never be
 * probed successfully — seeing it come back is proof the probe failed, never
 * proof of what the input was. There is no collision to worry about even in
 * the pathological case: an operator who typed this into `accounts.timezone`
 * verbatim would be told `null`, which is the correct answer, because it is
 * not a zone.
 */
const ZONE_UNRESOLVABLE = "!unresolvable";

/**
 * The account's `accounts.timezone` if `Intl` can resolve it, `null` if it
 * cannot. `null` means FAIL CLOSED at every call site — see the block comment
 * on `shouldSendFollowupNow` for why that is the only defensible direction.
 *
 * Detecting this is subtle enough to be worth stating. `safeZone(tz, "UTC")`
 * — what every render path in this repo uses, and what this gate used to use —
 * SILENTLY SUBSTITUTES its fallback, so a broken zone and a legitimately-UTC
 * account arrive at the band check as the same string. That substitution is
 * exactly what hid this: nothing downstream could tell "the operator chose
 * UTC" from "the operator typed `CST` and we gave up". Inspecting the returned
 * VALUE cannot recover the difference either, and a `zone === "UTC" means
 * broken` check would break every real UTC account instead.
 *
 * So the fallback is a value no input can legitimately produce. It reuses
 * `safeZone`'s own `Intl.DateTimeFormat` probe rather than writing a second
 * one — a divergent copy of that probe is a recorded mistake in this repo, and
 * a zone this module accepted but `formatWhen` rejected would be worse than
 * the bug being fixed. Even the pathological input (a caller passing the
 * sentinel itself) resolves correctly: the probe rejects it, so it comes back
 * as the fallback and reads as unresolvable, which it is.
 */
export function resolveAccountZone(timezone: string | null | undefined): string | null {
  const zone = safeZone(timezone ?? undefined, ZONE_UNRESOLVABLE);
  return zone === ZONE_UNRESOLVABLE ? null : zone;
}

/** Local calendar date as a comparable integer, e.g. 2026-09-09 → 20260909. */
function localDayNumber(parts: Intl.DateTimeFormatPart[]): number {
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((p) => p.type === type)?.value ?? NaN);
  return get("year") * 10000 + get("month") * 100 + get("day");
}

/**
 * `hourCycle: "h23"`, never `hour12: false` — the latter renders local
 * midnight as hour "24" in several locales, and the locale is pinned to
 * "en-US" for the same family of reasons `formatWhen` pins its own: an
 * unpinned locale can bring a non-Gregorian calendar with it, and the day
 * numbers below would then be comparing something other than the dates a
 * business owner sees.
 */
function localParts(instant: Date, timeZone: string): Intl.DateTimeFormatPart[] {
  return new Intl.DateTimeFormat("en-US", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", hourCycle: "h23",
  }).formatToParts(instant);
}

/**
 * Whether `now` falls inside the morning band, read in `zone`. Resolves the
 * zone itself (a helper must be safe to call from anywhere) and FAILS CLOSED:
 * a zone Intl cannot resolve or an invalid instant is `false`, never a throw
 * — this runs inside a cron tick with no one watching.
 */
export function isInMorningBand(now: Date, zone: string): boolean {
  const resolved = resolveAccountZone(zone);
  if (resolved === null || !Number.isFinite(now.getTime())) return false;
  const hour = Number(localParts(now, resolved).find((p) => p.type === "hour")?.value ?? NaN);
  if (!Number.isFinite(hour)) return false;
  return hour >= FOLLOWUP_MORNING_START_HOUR && hour < FOLLOWUP_MORNING_END_HOUR;
}

/**
 * Whether `instant` fell on a strictly EARLIER local calendar day than `now`,
 * both rendered in `zone`. Comparing local calendar dates (not "at least N
 * hours ago") is what makes a 09:00 and a 23:00 appointment both wait for
 * the next morning. Same fail-closed contract as `isInMorningBand`. The
 * review-request gate applies this twice: to the meeting end, and to the
 * follow-up's own stamp.
 */
export function isStrictlyEarlierLocalDay(instant: Date, now: Date, zone: string): boolean {
  const resolved = resolveAccountZone(zone);
  if (resolved === null) return false;
  if (!Number.isFinite(instant.getTime()) || !Number.isFinite(now.getTime())) return false;
  return localDayNumber(localParts(now, resolved)) > localDayNumber(localParts(instant, resolved));
}

/**
 * @param now         the instant the cron tick is running at
 * @param meetingEnd  the booking's `ends_at`
 * @param timezone    the account's `accounts.timezone` — VALIDATED at
 *                    creation, not free text: `createAccount` is the only
 *                    write path in the product and runs the value through
 *                    `assertUsableZone` before the insert
 *                    (`packages/db/src/accounts.ts:10-17`), and no update
 *                    path writes the column at all. What is left is a direct
 *                    database edit, a restore, or a future writer that
 *                    forgets — so the value is still never handed to `Intl`
 *                    raw: a RangeError here would take down a whole cron
 *                    tick, including the reminder pass that already ran. And
 *                    unlike every RENDER path, which substitutes a fallback
 *                    zone and carries on, an unresolvable zone here means DO
 *                    NOT SEND — see below.
 *
 * FAIL CLOSED ON AN UNRESOLVABLE ZONE, and this is a deliberate divergence
 * from the `safeZone(tz, "UTC")` habit the rest of the repo follows. A render
 * that guesses a zone shows a customer a time that is off by hours; they can
 * see it is wrong, and a human is present. This gate does not render anything
 * — it decides WHEN to wake someone up. The 08:00-11:00 band read in a
 * substituted UTC is 03:00-06:00 in the Rio Grande Valley, where this
 * platform's clients are, so the guess does not produce a visibly wrong time,
 * it produces an email on a customer's phone in the middle of the night with
 * nothing anywhere explaining why.
 *
 * That is a REGRESSION the 15-minute cadence introduced, not a pre-existing
 * hazard: on the old daily 14:00 UTC tick an account with a broken timezone
 * still got its follow-up at a civilised hour, by the same accident that made
 * "next morning" work at all.
 *
 * The alternative to guessing is not sending, and it is strictly better here.
 * There is no hour we can defend picking for an account whose zone we cannot
 * read; the staleness cap ages the booking out on its own; and the operator
 * can fix `accounts.timezone` and have every later booking work. An unsent
 * follow-up is a missing nicety. A 3 a.m. one is a complaint.
 */
export function shouldSendFollowupNow(now: Date, meetingEnd: Date, timezone: string): boolean {
  // Epoch milliseconds, never lexicographic ISO comparison: the strings in
  // play come from Postgres (`+00:00`) and from JS (`.000Z`) and do not sort
  // against each other reliably. NaN from an unparseable date must read as
  // "not now" rather than throwing inside the cron.
  const elapsedMs = now.getTime() - meetingEnd.getTime();
  if (!Number.isFinite(elapsedMs)) return false;
  if (elapsedMs < 0) return false;                    // the meeting has not ended
  if (elapsedMs > FOLLOWUP_MAX_AGE_MS) return false;  // too stale to be welcome

  // Rule 0. Everything below is a statement about LOCAL time and means
  // nothing without a zone we can resolve.
  const zone = resolveAccountZone(timezone);
  if (zone === null) return false;

  // Rules 1 and 2, as the two exported predicates — the review-request gate
  // composes the same two, so they cannot drift apart.
  if (!isInMorningBand(now, zone)) return false;
  return isStrictlyEarlierLocalDay(meetingEnd, now, zone);
}
