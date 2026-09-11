import type { WeeklyWindow } from "./weekly-metrics";

/**
 * The week window and the Monday send-gate for the weekly report passes
 * (spec 2026-09-10-weekly-report-design, "Gate" / "Window"). Pure date math,
 * deliberately dependent on nothing but `WeeklyWindow`'s shape — this is
 * dispatched as its own task because every number in the feature hangs off
 * these three functions, and local-day arithmetic is where this repo has
 * been bitten before (see the two gotchas below, both earned here).
 *
 * Self-contained on purpose rather than importing `partsInZone`/
 * `zonedTimeToUtc` from `booking/slots.ts`: this module lives in a different
 * domain (reports, not scheduling) and the brief for this task is explicit
 * that it depends on nothing else. The technique below is the same one
 * proven there — this is a fresh instance of it, not a divergent one.
 */

const WEEKDAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;
type Weekday = (typeof WEEKDAYS)[number];

/** Monday 08:00–10:59 local — the band `inMondayBand` gates on. */
const BAND_START_HOUR = 8;
const BAND_END_HOUR = 11;

type LocalParts = { year: number; month: number; day: number; hour: number; weekday: Weekday };

/**
 * Wall-clock parts of `instant` as seen in `zone`.
 *
 * Deliberately called WITHOUT `new` — recorded gotcha in this codebase (see
 * `booking/slots.ts`'s `partsInZone`, the same pattern): ECMA-402 permits
 * invoking `Intl.DateTimeFormat` as a plain function, which still constructs
 * a full instance, and that is what keeps this safe under a
 * `vi.spyOn(Intl, "DateTimeFormat")` with no explicit passthrough configured
 * — this vitest/tinyspy version's spy wrapper mis-handles the `new`-
 * invocation path for native constructors but correctly forwards a plain
 * call through to the real constructor. `vi.spyOn` cannot intercept a `new`
 * invocation at all.
 *
 * `hourCycle: "h23"`, never `hour12: false` — the latter renders local
 * midnight as hour "24" in several locales. Locale pinned to "en-US" so an
 * unpinned locale never brings a non-Gregorian calendar or different digit
 * set with it (the same reason `followup-timing.ts`'s `localParts` pins it).
 */
function localParts(instant: Date, zone: string): LocalParts {
  const parts = Intl.DateTimeFormat("en-US", {
    timeZone: zone, weekday: "short",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", hourCycle: "h23",
  }).formatToParts(instant);
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? "";
  return {
    year: Number(get("year")), month: Number(get("month")), day: Number(get("day")),
    hour: Number(get("hour")),
    weekday: get("weekday").toLowerCase().slice(0, 3) as Weekday,
  };
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function dayKeyOf(parts: { year: number; month: number; day: number }): string {
  return `${parts.year}-${pad2(parts.month)}-${pad2(parts.day)}`;
}

/**
 * `dayKey` shifted by `delta` CALENDAR days — pure Gregorian arithmetic, no
 * zone lookup. `Date.UTC` is used here purely as a calendar CALCULATOR: the
 * instant it produces is never exposed as a real moment, only re-read
 * through its own UTC getters to recover the rolled-over y/m/d (month/year
 * carries handled by the platform's normalization, not manual carrying).
 * This is NOT the anchoring bug the rest of this module exists to avoid —
 * that bug is presenting a UTC-midnight instant as if it were a LOCAL one;
 * this never leaves the UTC frame, so there is nothing to misread.
 */
function shiftDayKey(dayKey: string, delta: number): string {
  const [y, m, d] = dayKey.split("-").map(Number) as [number, number, number];
  const dt = new Date(Date.UTC(y, m - 1, d + delta, 12, 0, 0));
  return dayKeyOf({ year: dt.getUTCFullYear(), month: dt.getUTCMonth() + 1, day: dt.getUTCDate() });
}

/**
 * The real UTC instant of local midnight on `dayKey` in `zone`.
 *
 * Never `new Date(Date.UTC(y, m - 1, d))` presented as the answer — that
 * anchors UTC midnight, and every zone west of Greenwich (every Americas
 * zone) then reads back as the PREVIOUS day. This has shipped as a bug here.
 *
 * Instead: guess UTC midnight of the same y/m/d as a starting point, read
 * back what wall clock that guess actually shows in `zone`, and correct by
 * the difference. Two rounds converge because an IANA offset only takes a
 * handful of discrete values and each round removes the whole error — the
 * same fixpoint `booking/slots.ts`'s `zonedTimeToUtc` uses for an arbitrary
 * wall time, specialized here to hour/minute 00:00. No US zone this
 * platform serves shifts its clock across local midnight, so the spring-
 * forward gap `zonedTimeToUtc` guards against with a null return cannot
 * land on the instant this function is ever asked to resolve.
 */
function localMidnightInstant(dayKey: string, zone: string): Date {
  const [y, m, d] = dayKey.split("-").map(Number) as [number, number, number];
  const target = Date.UTC(y, m - 1, d, 0, 0, 0);
  let ts = target;
  for (let i = 0; i < 2; i++) {
    const seen = localParts(new Date(ts), zone);
    const seenTs = Date.UTC(seen.year, seen.month - 1, seen.day, seen.hour, 0, 0);
    ts += target - seenTs;
  }
  return new Date(ts);
}

/** The Monday of the week that has just ENDED, as `YYYY-MM-DD` in `zone`. */
export function lastWeekMonday(now: Date, zone: string): string {
  const parts = localParts(now, zone);
  const daysSinceMonday = (WEEKDAYS.indexOf(parts.weekday) + 6) % 7; // mon=0 .. sun=6
  const thisWeekMonday = shiftDayKey(dayKeyOf(parts), -daysSinceMonday);
  return shiftDayKey(thisWeekMonday, -7);
}

/**
 * That Monday expanded into the window shape the reads take.
 *
 * The window is seven LOCAL days, built by shifting the day key and
 * re-resolving each end's own local midnight independently — never by
 * adding `7 * 24 * 3600 * 1000` ms to `fromIso`. A DST week is 167 or 169
 * real hours, not 168, and adding milliseconds would silently produce the
 * wrong instant on exactly the weeks this report most needs to get right.
 */
export function weekWindow(monday: string, zone: string): WeeklyWindow {
  const nextMonday = shiftDayKey(monday, 7);
  return {
    fromIso: localMidnightInstant(monday, zone).toISOString(),
    toIso: localMidnightInstant(nextMonday, zone).toISOString(),
    fromDay: monday,
    toDay: shiftDayKey(monday, 6), // the Sunday, inclusive
  };
}

/** Monday 08:00–10:59 local. */
export function inMondayBand(now: Date, zone: string): boolean {
  if (!Number.isFinite(now.getTime())) return false;
  const { weekday, hour } = localParts(now, zone);
  if (weekday !== "mon") return false;
  return hour >= BAND_START_HOUR && hour < BAND_END_HOUR;
}
