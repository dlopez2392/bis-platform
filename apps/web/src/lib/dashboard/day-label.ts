// apps/web/src/lib/dashboard/day-label.ts
//
// Formats an already-resolved LOCAL calendar-day `dayKey` ("YYYY-MM-DD" —
// the shape `localDayWindow`/`bucketByLocalDay` in metrics.ts produce, via
// `dayKeyInZone`) for display on the 14-day calls chart (Task 6): the axis's
// window-start label, the visible half of each bar's hover tooltip, and its
// `sr-only` twin.
//
// A dayKey carries no timezone of its own — the zone conversion already
// happened once, in `dayKeyInZone`, to produce it. Re-parsing it through a
// bare `new Date(dayKey)` and formatting WITHOUT an explicit `timeZone`
// reads the SYSTEM zone (the recorded Americas-previous-day bug: west of
// UTC, `new Date("2027-06-15")` — UTC midnight — renders back as "June 14").
// The fix here is the same one `metrics.ts`'s own `utcWeekdayIndex` uses for
// the identical problem: anchor the already-known y/m/d at UTC noon (clear
// of any DST edge, though none applies to a pure calendar read) and format
// with an EXPLICIT `timeZone: "UTC"` — a pure calendar-date operation,
// provably independent of whatever zone the process happens to run in.
function parseDayKey(dayKey: string): { y: number; m: number; d: number } {
  const [y, m, d] = dayKey.split("-").map(Number);
  return { y: y!, m: m!, d: d! };
}

function anchor(dayKey: string): Date {
  const { y, m, d } = parseDayKey(dayKey);
  return new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
}

const SHORT_FORMAT = new Intl.DateTimeFormat("en-US", {
  timeZone: "UTC",
  month: "short",
  day: "numeric",
});

const LONG_FORMAT = new Intl.DateTimeFormat("en-US", {
  timeZone: "UTC",
  month: "long",
  day: "numeric",
});

/** "Aug 18" — the chart axis's window-start label, and the visible half of
 *  each bar's hover tooltip ("Aug 18 · 5 calls"). */
export function shortDayLabel(dayKey: string): string {
  return SHORT_FORMAT.format(anchor(dayKey));
}

/** "August 18" — the date half of each bar's `sr-only` text ("August 18, 5
 *  calls"). */
export function longDayLabel(dayKey: string): string {
  return LONG_FORMAT.format(anchor(dayKey));
}
