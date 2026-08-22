/**
 * Pure slot engine: turns a calendar's config + its existing bookings into
 * offerable time slots. No I/O, no dependencies on other tasks. Every date
 * arithmetic step is done in the account's `timezone`, never the system zone —
 * `Intl.DateTimeFormat` is always called with an explicit `timeZone`.
 */

const WEEKDAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;

export type OpenHours = Partial<Record<"sun" | "mon" | "tue" | "wed" | "thu" | "fri" | "sat", [string, string][]>>;
export type SlotConfig = {
  timezone: string; slotDurationMinutes: number; bufferMinutes: number;
  minNoticeHours: number; maxAdvanceDays: number; openHours: OpenHours;
};
/** Both `startsAt`/`endsAt` are real `Date`s here, but the accessors that
 *  produce a `Range` from a DB row hand back ISO STRINGS — converting a row
 *  into a `Range` (`new Date(row.starts_at)` etc.) is the CALLER's job, not
 *  this module's. If that conversion ever fails (a malformed/invalid
 *  timestamp), it fails CLOSED here: the conflict predicate below treats a
 *  non-finite `Date` as a guaranteed conflict rather than silently ignoring
 *  it (see I2). */
export type Range = { startsAt: Date; endsAt: Date };

// Memoized per timezone: constructing an Intl.DateTimeFormat is comparatively
// expensive and computeSlots calls partsInZone many times per invocation, all
// pinned to the same config.timezone. Module-level cache, never cleared —
// there are only ~400 IANA zone names, so this cannot leak meaningfully.
const formatterCache = new Map<string, Intl.DateTimeFormat>();

/** Wall-clock parts of `instant` as seen in `timeZone`. Always pins `timeZone`
 *  explicitly on the Intl call — the system zone must never leak in.
 *
 *  Deliberately called WITHOUT `new`: ECMA-402 permits invoking
 *  `Intl.DateTimeFormat` as a plain function (it still constructs a full
 *  instance). That's what makes it safe under `vi.spyOn(Intl, "DateTimeFormat")`
 *  with no explicit passthrough configured — this vitest/tinyspy version's
 *  spy wrapper mis-handles the `new`-invocation path for native constructors
 *  and returns an inert stub, but correctly forwards a plain call through to
 *  the real constructor, so this stays testable AND correct. */
export function partsInZone(instant: Date, timeZone: string) {
  let fmt = formatterCache.get(timeZone);
  if (!fmt) {
    fmt = Intl.DateTimeFormat("en-US", {
      timeZone, hourCycle: "h23",
      weekday: "short", year: "numeric", month: "numeric", day: "numeric",
      hour: "numeric", minute: "numeric",
    });
    formatterCache.set(timeZone, fmt);
  }
  const p: Record<string, string> = {};
  for (const part of fmt.formatToParts(instant)) p[part.type] = part.value;
  return {
    y: Number(p.year), m: Number(p.month), d: Number(p.day),
    hh: Number(p.hour), mi: Number(p.minute),
    weekday: p.weekday!.toLowerCase().slice(0, 3) as (typeof WEEKDAYS)[number],
  };
}

/** Wall time in `timeZone` → instant. Null when the wall time does not exist
 *  (the DST spring-forward gap): callers SKIP such slots rather than shifting
 *  them, because offering "2:30" on a day with no 2:30 books a lie.
 *
 *  A REPEATED wall time (the DST fall-back hour) resolves deterministically,
 *  not ambiguously: the two-iteration fixpoint below always converges on the
 *  SAME one of the two real instants for a given (y,m,d,hh,mi) — in practice
 *  the earlier occurrence for zones west of UTC and the later occurrence for
 *  zones east of UTC. That determinism is an emergent property of the
 *  algorithm, not a designed one; the only thing actually guaranteed by the
 *  final containment check is "never wrong" (it will never return an instant
 *  that reads back as a different wall time), not "always the earlier one" —
 *  a repeated hour is possibly DROPPED by a future rewrite, never mis-dated. */
export function zonedTimeToUtc(y: number, m: number, d: number, hh: number, mi: number, timeZone: string): Date | null {
  let ts = Date.UTC(y, m - 1, d, hh, mi);
  for (let i = 0; i < 2; i++) {
    const p = partsInZone(new Date(ts), timeZone);
    ts += Date.UTC(y, m - 1, d, hh, mi) - Date.UTC(p.y, p.m - 1, p.d, p.hh, p.mi);
  }
  const check = partsInZone(new Date(ts), timeZone);
  if (check.y !== y || check.m !== m || check.d !== d || check.hh !== hh || check.mi !== mi) return null;
  return new Date(ts);
}

function parseHHMM(s: string): { hh: number; mi: number } {
  const [hh, mi] = s.split(":").map(Number);
  return { hh: hh!, mi: mi! };
}

/** Pure calendar-day arithmetic (no timezone lookups): normalizes y/m/d + a
 *  day delta via UTC, so month/year rollover is handled by the platform's
 *  Date.UTC normalization rather than manual carrying. */
function addCalendarDays(y: number, m: number, d: number, delta: number) {
  const dt = new Date(Date.UTC(y, m - 1, d + delta, 12, 0));
  return { y: dt.getUTCFullYear(), m: dt.getUTCMonth() + 1, d: dt.getUTCDate() };
}

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

function minutesOf(s: string): number {
  const { hh, mi } = parseHHMM(s);
  return hh * 60 + mi;
}

/** Defensive normalization of a calendar's `open_hours` jsonb column: the DB
 *  has no CHECK constraint on its shape, so a malformed or hand-edited row
 *  must never crash the picker — it can only ever narrow what's offered.
 *  Drops anything that isn't a real weekday key mapped to a list of
 *  `[HH:MM, HH:MM]` (or `"24:00"` as the closing bound) string tuples, and
 *  drops individual intervals where `to` doesn't strictly exceed `from`. */
export function normalizeOpenHours(raw: unknown): OpenHours {
  const out: OpenHours = {};
  if (typeof raw !== "object" || raw === null) return out;
  const obj = raw as Record<string, unknown>;
  for (const day of WEEKDAYS) {
    const val = obj[day];
    if (!Array.isArray(val)) continue;
    const intervals: [string, string][] = [];
    for (const entry of val) {
      if (!Array.isArray(entry) || entry.length !== 2) continue;
      const [from, to] = entry as [unknown, unknown];
      if (typeof from !== "string" || typeof to !== "string") continue;
      const fromOk = TIME_RE.test(from) || from === "24:00";
      const toOk = TIME_RE.test(to) || to === "24:00";
      if (!fromOk || !toOk) continue;
      if (minutesOf(to) <= minutesOf(from)) continue;
      intervals.push([from, to]);
    }
    if (intervals.length > 0) out[day] = intervals;
  }
  return out;
}

/** Turn a calendar's open-hours config + its existing bookings into offerable
 *  slots between `now + minNoticeHours` (inclusive) and `now + maxAdvanceDays`
 *  calendar days, all reckoned in `config.timezone`. Pure: never mutates
 *  `booked`, never touches the network or a clock other than `now`. */
export function computeSlots(config: SlotConfig, booked: Range[], now: Date): Range[] {
  const { timezone, slotDurationMinutes, bufferMinutes, minNoticeHours, maxAdvanceDays } = config;

  // Fail CLOSED on a malformed numeric config: NaN comparisons are always
  // false, so an unvalidated NaN/negative duration, buffer, notice, or
  // horizon would silently disable the check it's supposed to drive rather
  // than block bookings. A short duration floor (5min) also rules out a
  // zero/negative duration turning into an infinite candidate loop.
  if (
    !Number.isFinite(slotDurationMinutes) || slotDurationMinutes < 5 ||
    !Number.isFinite(bufferMinutes) || bufferMinutes < 0 ||
    !Number.isFinite(minNoticeHours) || minNoticeHours < 0 ||
    !Number.isFinite(maxAdvanceDays) || maxAdvanceDays < 0
  ) {
    return [];
  }

  const openHours = normalizeOpenHours(config.openHours);

  const noticeMs = minNoticeHours * 3600_000;
  const earliestStart = new Date(now.getTime() + noticeMs);
  const bufferMs = bufferMinutes * 60_000;

  try {
    const nowParts = partsInZone(now, timezone);

    // Horizon end = midnight starting the day AFTER day `maxAdvanceDays`, i.e.
    // the whole of day `maxAdvanceDays` is in-horizon. This is a PINNED
    // DECISION, not an accident of the arithmetic: "book up to N days out"
    // means all of day N is bookable, because the public picker and the
    // submit-time revalidation both call this same function and must never
    // disagree about whether a slot on day N is still in range. Computed via
    // pure calendar-day arithmetic (month/year-safe) then resolved through
    // the zone once, at midnight — never by adding raw milliseconds across a
    // DST edge.
    const horizonDay = addCalendarDays(nowParts.y, nowParts.m, nowParts.d, maxAdvanceDays + 1);
    // Midnight can itself fall inside a spring-forward gap (e.g.
    // America/Havana, Asia/Beirut, America/Santiago all move their clocks
    // forward AT midnight on some transition day) — bump forward minute by
    // minute rather than assert non-null. 4 bumps comfortably clears every
    // real-world DST jump (the largest observed is 1h, some historical
    // zones used other offsets; this stays generous).
    let horizonEnd: Date | null = null;
    for (let bump = 0; bump < 4 && !horizonEnd; bump++) {
      horizonEnd = zonedTimeToUtc(horizonDay.y, horizonDay.m, horizonDay.d, bump, 0, timezone);
    }
    if (!horizonEnd) return [];

    const results: Range[] = [];

    for (let i = 0; i <= maxAdvanceDays; i++) {
      // Resolve calendar day `now + i` days (pure UTC calendar math, DST-safe).
      const cal = addCalendarDays(nowParts.y, nowParts.m, nowParts.d, i);
      // Weekday of `cal` in the account zone, derived WITHOUT an Intl
      // round-trip: `cal` is already the account-zone calendar date (it came
      // straight out of `addCalendarDays`, itself account-zone-day
      // arithmetic on `nowParts`) — day-of-week is a pure calendar-day
      // property that depends only on the (y, m, d) triple, not on which
      // clock you use to look it up. Anchoring that same triple at UTC
      // midnight and reading `getUTCDay()` therefore gives the exact same
      // weekday `partsInZone(noon-in-zone, timezone).weekday` used to give,
      // with no zone conversion (and no possible DST-gap failure) needed.
      const weekday = WEEKDAYS[new Date(Date.UTC(cal.y, cal.m - 1, cal.d)).getUTCDay()]!;
      const intervals = openHours[weekday];
      if (!intervals || intervals.length === 0) continue;

      for (const [from, to] of intervals) {
        const fromParts = parseHHMM(from);
        const toParts = parseHHMM(to);
        const toMinutes = toParts.hh * 60 + toParts.mi;

        let candMinutes = fromParts.hh * 60 + fromParts.mi;
        while (candMinutes + slotDurationMinutes <= toMinutes) {
          const startHH = Math.floor(candMinutes / 60);
          const startMI = candMinutes % 60;
          const candStart = zonedTimeToUtc(cal.y, cal.m, cal.d, startHH, startMI, timezone);
          candMinutes += slotDurationMinutes;
          if (!candStart) continue; // inside a DST gap — skip, never shift

          const candEnd = new Date(candStart.getTime() + slotDurationMinutes * 60_000);

          if (candStart.getTime() < earliestStart.getTime()) continue;
          if (candEnd.getTime() > horizonEnd.getTime()) continue;

          // Wall-minute containment (`candMinutes <= toMinutes` above) and
          // real-ms containment can DISAGREE across a spring-forward gap:
          // 00:00–02:00 open, a 120min slot starting 00:00 passes the minute
          // check (0+120<=120) but the gap eats an hour of real time, so the
          // candidate actually ENDS at 03:00 wall — past the 02:00 close.
          // Verify the candidate's real in-zone wall-clock end explicitly.
          const endParts = partsInZone(candEnd, timezone);
          const endMinutes = endParts.d === cal.d && endParts.m === cal.m
            ? endParts.hh * 60 + endParts.mi
            : 1440; // rolled into the next calendar day — treat as end-of-day
          if (endMinutes > toMinutes) continue;

          const conflicts = booked.some((b) => {
            const bStart = b.startsAt.getTime();
            const bEnd = b.endsAt.getTime();
            // An unresolvable (non-finite) booked range fails CLOSED: it
            // blocks the slot it's compared against rather than silently
            // passing every NaN comparison as false and offering a slot
            // that might actually be taken.
            if (!Number.isFinite(bStart) || !Number.isFinite(bEnd)) return true;
            return candStart.getTime() < bEnd + bufferMs && bStart < candEnd.getTime() + bufferMs;
          });
          if (conflicts) continue;

          results.push({ startsAt: candStart, endsAt: candEnd });
        }
      }
    }

    results.sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
    // Dedupe: overlapping open-hours intervals (a config bug, but one the DB
    // schema doesn't prevent) can offer the same wall-clock start twice.
    const seen = new Set<number>();
    return results.filter((r) => {
      const t = r.startsAt.getTime();
      if (seen.has(t)) return false;
      seen.add(t);
      return true;
    });
  } catch (err) {
    if (err instanceof RangeError) return []; // e.g. an invalid IANA timezone
    throw err;
  }
}
