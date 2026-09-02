// apps/web/src/lib/dashboard/metrics.ts
//
// Pure dashboard-metrics math: windows, day-bucketing, deltas, sparkline
// geometry, and after-hours counting. No React, no @bis/db, no I/O — a
// module a unit test can hold entirely. Sits between the db layer (Task 2's
// `listCallStartsBetween` etc. — raw ISO strings in, ascending) and the UI
// (Task 4 consumes `sparklinePath`/`deltaVsPrior`; Task 5 consumes
// `localDayWindow`/`bucketByLocalDay`/`countAfterHours`).
//
// Zone-correct primitives are reused verbatim from the booking package —
// `dayKeyInZone` (availability.ts) and `zonedTimeToUtc`/`partsInZone`
// (slots.ts) — never a fresh, un-pinned `Intl.DateTimeFormat` here (that
// formats in the SYSTEM zone, the recorded Americas-previous-day bug
// class). The one sanctioned exception is weekday derivation from an
// already-known y/m/d: anchor that date at UTC midnight and read
// `getUTCDay()` — weekday is a pure calendar-date property, independent of
// which clock computed it (the same trick slots.ts itself uses at its own
// weekday derivation, computeSlots's per-day loop).
import { dayKeyInZone } from "@/lib/booking/availability";
import { normalizeOpenHours, partsInZone, zonedTimeToUtc, type OpenHours } from "@/lib/booking/slots";

/** Parses a `YYYY-MM-DD` dayKey into its numeric parts. Never fed through
 *  `new Date(str)` for calendar math (that's UTC midnight — the recorded
 *  Americas-previous-day bug when later compared against a local reading). */
function parseDayKey(dayKey: string): { y: number; m: number; d: number } {
  const [y, m, d] = dayKey.split("-").map(Number);
  return { y: y!, m: m!, d: d! };
}

function formatDayKey(y: number, m: number, d: number): string {
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/** Pure calendar-day arithmetic (no timezone lookup): shifts a y/m/d by
 *  `delta` days via `Date.UTC`'s own month/year normalization, exactly the
 *  technique slots.ts's `addCalendarDays` uses for the same reason — this
 *  never touches a clock, so it can never disagree with a zone conversion
 *  about which calendar day comes next. */
function shiftCalendarDate(y: number, m: number, d: number, delta: number): { y: number; m: number; d: number } {
  const dt = new Date(Date.UTC(y, m - 1, d + delta, 12, 0));
  return { y: dt.getUTCFullYear(), m: dt.getUTCMonth() + 1, d: dt.getUTCDate() };
}

/** Local midnight of the given calendar date, resolved to a real UTC
 *  instant. Bumps forward hour-by-hour if local midnight itself falls
 *  inside a spring-forward gap (rare zones move their clocks at midnight,
 *  not 2am) — the same defensive pattern slots.ts uses for its own
 *  horizon-midnight resolution, rather than asserting non-null. */
function resolveLocalMidnight(y: number, m: number, d: number, timezone: string): Date {
  for (let bump = 0; bump < 4; bump++) {
    const resolved = zonedTimeToUtc(y, m, d, bump, 0, timezone);
    if (resolved) return resolved;
  }
  throw new Error(`could not resolve local midnight for ${formatDayKey(y, m, d)} in ${timezone}`);
}

/** UTC-anchor weekday of a calendar date — see the module doc comment for
 *  why this is the sanctioned pattern rather than an Intl weekday read. */
function utcWeekdayIndex(y: number, m: number, d: number): number {
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // Sun=0 .. Sat=6
}

/**
 * Window covering the last `days` LOCAL calendar days ending today
 * (inclusive), zone-correct via `zonedTimeToUtc`/`dayKeyInZone`. `toIso` is
 * always `now` itself (not end-of-day) — later tasks combine this with
 * `.lt(toIso)` window queries where "up to right now" is the honest upper
 * bound, not a padded end-of-day.
 */
export function localDayWindow(
  now: Date,
  timezone: string,
  days: number,
): { fromIso: string; toIso: string; dayKeys: string[] } {
  const today = parseDayKey(dayKeyInZone(now, timezone));
  const dayKeys: string[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const day = shiftCalendarDate(today.y, today.m, today.d, -i);
    dayKeys.push(formatDayKey(day.y, day.m, day.d));
  }
  const first = parseDayKey(dayKeys[0]!);
  const fromIso = resolveLocalMidnight(first.y, first.m, first.d, timezone).toISOString();
  return { fromIso, toIso: now.toISOString(), dayKeys };
}

/**
 * Buckets each ISO instant into its LOCAL calendar day (via `dayKeyInZone`
 * — the exact conversion the picker and slot engine already use, so this
 * can never disagree with them about which day an instant falls on) and
 * counts per bucket. Instants whose local day isn't in `dayKeys` are
 * silently dropped (no phantom bucket, no crash) — callers are expected to
 * pass a window whose `dayKeys` cover every `isoTimes` entry they care
 * about (e.g. straight from `localDayWindow`).
 */
export function bucketByLocalDay(
  isoTimes: string[],
  timezone: string,
  dayKeys: string[],
): { dayKey: string; count: number; isWeekend: boolean }[] {
  const counts = new Map<string, number>();
  for (const key of dayKeys) counts.set(key, 0);
  for (const iso of isoTimes) {
    const key = dayKeyInZone(new Date(iso), timezone);
    const current = counts.get(key);
    if (current !== undefined) counts.set(key, current + 1);
  }
  return dayKeys.map((dayKey) => {
    const { y, m, d } = parseDayKey(dayKey);
    const weekday = utcWeekdayIndex(y, m, d);
    return { dayKey, count: counts.get(dayKey) ?? 0, isWeekend: weekday === 0 || weekday === 6 };
  });
}

/**
 * Same zone-correct day-bucketing as `bucketByLocalDay` above, but summing a
 * `monetaryValue` per instant instead of counting instants — the dashboard's
 * "Pipeline added" tile needs day-SUMS of value, not day counts, for its
 * spark. Deliberately a separate function rather than a `bucketByLocalDay`
 * option: the two return shapes differ (`count` vs `value`), and threading a
 * summed-field callback through the simpler counting function would make
 * that one harder to read for its own, more common callers. Same silent-drop
 * behavior for an instant whose local day isn't in `dayKeys`.
 */
export function bucketValueByLocalDay(
  pairs: { createdAt: string; monetaryValue: number }[],
  timezone: string,
  dayKeys: string[],
): { dayKey: string; value: number; isWeekend: boolean }[] {
  const sums = new Map<string, number>();
  for (const key of dayKeys) sums.set(key, 0);
  for (const { createdAt, monetaryValue } of pairs) {
    const key = dayKeyInZone(new Date(createdAt), timezone);
    const current = sums.get(key);
    if (current !== undefined) sums.set(key, current + monetaryValue);
  }
  return dayKeys.map((dayKey) => {
    const { y, m, d } = parseDayKey(dayKey);
    const weekday = utcWeekdayIndex(y, m, d);
    return { dayKey, value: sums.get(dayKey) ?? 0, isWeekend: weekday === 0 || weekday === 6 };
  });
}

/**
 * `current` vs `previous`: percent change when `previous > 0` (rounded to
 * the nearest whole percent); absolute count when `previous === 0` (a
 * percent off a zero base is meaningless — the mockup's "▲ 3" case).
 * `direction` is "flat" only when `current === previous` exactly (a 0%
 * rounded result from a genuine small change still reports "up"/"down").
 */
export function deltaVsPrior(
  current: number,
  previous: number,
): { direction: "up" | "down" | "flat"; label: string } {
  const diff = current - previous;
  const direction: "up" | "down" | "flat" = diff > 0 ? "up" : diff < 0 ? "down" : "flat";
  if (previous === 0) {
    return { direction, label: String(Math.abs(diff)) };
  }
  const pct = Math.round((Math.abs(diff) / previous) * 100);
  return { direction, label: `${pct}%` };
}

// Fraction of `height` reserved as top/bottom padding so the line's stroke
// and the endpoint dot (Task 4: strokeWidth 2, endpoint circle r 2.4) never
// clip against the viewBox edge — matches the mockup's own proportions
// (viewBox 100x26, values ranging ~4..22, i.e. ~15% padding each side).
const SPARK_PADDING_RATIO = 0.15;

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Sparkline geometry for a `counts` series inside a `width`x`height`
 * viewBox (mockup: 100x26). Returns `line`/`area` as ready-to-use SVG
 * `points` strings — `area` is `line` plus the two bottom corners, closing
 * the shape down to the baseline for a polygon fill — plus the endpoint
 * (most recent point, always the rightmost) coordinates for Task 4's dot.
 * A flat series (all counts equal, including a single point) collapses to
 * a horizontal mid-height line rather than dividing by zero.
 */
export function sparklinePath(
  counts: number[],
  width: number,
  height: number,
): { line: string; area: string; endX: number; endY: number } {
  if (counts.length === 0) return { line: "", area: "", endX: 0, endY: 0 };

  const pad = height * SPARK_PADDING_RATIO;
  const min = Math.min(...counts);
  const max = Math.max(...counts);
  const flat = max === min;

  const points = counts.map((count, i) => {
    const x = counts.length === 1 ? width : (i / (counts.length - 1)) * width;
    const y = flat ? height / 2 : height - pad - ((count - min) / (max - min)) * (height - 2 * pad);
    return { x: round2(x), y: round2(y) };
  });

  const line = points.map((p) => `${p.x},${p.y}`).join(" ");
  const area = `${line} ${round2(width)},${round2(height)} 0,${round2(height)}`;
  const last = points[points.length - 1]!;
  return { line, area, endX: last.x, endY: last.y };
}

/**
 * A call is after-hours when its LOCAL time (in `timezone`) falls outside
 * that local day's `open_hours` window. Reuses `normalizeOpenHours` (the
 * booking availability code's own defensive shape validation — dropping
 * malformed intervals, `"24:00"` handling) exactly as `computeSlots` itself
 * does, rather than re-validating the shape here; this function only adds
 * the trivial "HH:MM" -> minutes-of-day arithmetic needed to compare a
 * local clock reading against an already-validated interval.
 *
 * DATA HONESTY (pinned by the brief): a day with NO configured window
 * (either because that weekday's key is absent, or because `openHours` is
 * entirely empty) still gets an answer from this function — every call on
 * that day counts as after-hours. Whether to HIDE the after-hours tile
 * entirely when `open_hours` is empty is Task 5's call, composed on top of
 * this function's honest count, not this function's job.
 */
export function countAfterHours(isoTimes: string[], timezone: string, openHours: OpenHours): number {
  const normalized = normalizeOpenHours(openHours);
  let afterHours = 0;
  for (const iso of isoTimes) {
    const parts = partsInZone(new Date(iso), timezone);
    const intervals = normalized[parts.weekday];
    const minutes = parts.hh * 60 + parts.mi;
    const withinHours = !!intervals && intervals.some(([from, to]) => {
      const [fromHH, fromMI] = from.split(":").map(Number);
      const [toHH, toMI] = to.split(":").map(Number);
      const fromMinutes = fromHH! * 60 + fromMI!;
      const toMinutes = toHH! * 60 + toMI!;
      return minutes >= fromMinutes && minutes < toMinutes;
    });
    if (!withinHours) afterHours++;
  }
  return afterHours;
}
