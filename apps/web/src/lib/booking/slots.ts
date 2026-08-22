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
export type Range = { startsAt: Date; endsAt: Date };

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
  const fmt = Intl.DateTimeFormat("en-US", {
    timeZone, hourCycle: "h23",
    weekday: "short", year: "numeric", month: "numeric", day: "numeric",
    hour: "numeric", minute: "numeric",
  });
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
 *  them, because offering "2:30" on a day with no 2:30 books a lie. */
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

/** Turn a calendar's open-hours config + its existing bookings into offerable
 *  slots between `now + minNoticeHours` (inclusive) and `now + maxAdvanceDays`
 *  calendar days, all reckoned in `config.timezone`. Pure: never mutates
 *  `booked`, never touches the network or a clock other than `now`. */
export function computeSlots(config: SlotConfig, booked: Range[], now: Date): Range[] {
  const { timezone, slotDurationMinutes, bufferMinutes, minNoticeHours, maxAdvanceDays, openHours } = config;

  const noticeMs = minNoticeHours * 3600_000;
  const earliestStart = new Date(now.getTime() + noticeMs);
  const bufferMs = bufferMinutes * 60_000;

  const nowParts = partsInZone(now, timezone);
  // Horizon end = midnight starting the day AFTER day `maxAdvanceDays`, i.e.
  // the whole of day `maxAdvanceDays` is in-horizon. Computed via pure
  // calendar-day arithmetic (month/year-safe) then resolved through the zone
  // once, at midnight — never by adding raw milliseconds across a DST edge.
  const horizonDay = addCalendarDays(nowParts.y, nowParts.m, nowParts.d, maxAdvanceDays + 1);
  const horizonEnd = zonedTimeToUtc(horizonDay.y, horizonDay.m, horizonDay.d, 0, 0, timezone)!;

  const results: Range[] = [];

  for (let i = 0; i <= maxAdvanceDays; i++) {
    // Resolve calendar day `now + i` days (pure UTC calendar math, DST-safe),
    // then read its weekday by resolving noon on that date in-zone — noon
    // never falls inside a DST gap, so this always succeeds.
    const cal = addCalendarDays(nowParts.y, nowParts.m, nowParts.d, i);
    const dayNoon = zonedTimeToUtc(cal.y, cal.m, cal.d, 12, 0, timezone)!;
    const dayParts = partsInZone(dayNoon, timezone);
    const weekday = dayParts.weekday;
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
        const candStart = zonedTimeToUtc(dayParts.y, dayParts.m, dayParts.d, startHH, startMI, timezone);
        candMinutes += slotDurationMinutes;
        if (!candStart) continue; // inside a DST gap — skip, never shift

        const candEnd = new Date(candStart.getTime() + slotDurationMinutes * 60_000);

        if (candStart.getTime() < earliestStart.getTime()) continue;
        if (candEnd.getTime() > horizonEnd.getTime()) continue;

        const conflicts = booked.some((b) => {
          const bStart = b.startsAt.getTime();
          const bEnd = b.endsAt.getTime();
          return candStart.getTime() < bEnd + bufferMs && bStart < candEnd.getTime() + bufferMs;
        });
        if (conflicts) continue;

        results.push({ startsAt: candStart, endsAt: candEnd });
      }
    }
  }

  results.sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
  return results;
}
