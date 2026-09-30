import { wallInstant } from "@/lib/automations/quiet-hours";

export type MonthWindow = { fromIso: string; toIso: string; label: string };

/**
 * `[first of this month 00:00 local, first of next month 00:00 local)` for
 * the month `now` falls in on `zone`'s wall clock, plus the label the card
 * prints ("September 2026"). Each edge is resolved as its own local
 * midnight, never `from + N days`, because a month with a DST change is not
 * N × 24 hours long. `zone` is already resolved by the caller (renderZone)
 * — an unusable zone throws here, which is the page's loud failure, not a
 * silent UTC.
 *
 * Resolved through `quiet-hours.ts`'s `wallInstant`, not
 * `weekly-window.ts`'s `localMidnightInstant` (part-C cleanup item 4): that
 * fixed point reconciles HOURS only, so a month boundary lands 30/45
 * minutes wrong in a minute-offset zone (Asia/Kolkata, Australia/Adelaide,
 * America/St_Johns) and can miss entirely where local midnight on the 1st
 * does not exist (a zone whose clock jumps at midnight). `wallInstant`
 * reconciles minutes and falls back to the first wall reading at or after
 * the requested time when the requested minute doesn't exist.
 * `weekly-window.ts`'s own callers (the weekly report) are untouched.
 */
export function monthWindow(now: Date, zone: string): MonthWindow {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: zone, year: "numeric", month: "2-digit" }).formatToParts(now);
  const year = Number(parts.find((p) => p.type === "year")!.value);
  const month = Number(parts.find((p) => p.type === "month")!.value);
  const nextYear = month === 12 ? year + 1 : year;
  const nextMonth = month === 12 ? 1 : month + 1;
  return {
    fromIso: wallInstant(year, month, 1, 0, zone).toISOString(),
    toIso: wallInstant(nextYear, nextMonth, 1, 0, zone).toISOString(),
    label: new Intl.DateTimeFormat("en-US", { timeZone: zone, month: "long", year: "numeric" }).format(now),
  };
}
