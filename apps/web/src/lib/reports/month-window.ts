import { localMidnightInstant } from "./weekly-window";

export type MonthWindow = { fromIso: string; toIso: string; label: string };

/**
 * `[first of this month 00:00 local, first of next month 00:00 local)` for
 * the month `now` falls in on `zone`'s wall clock, plus the label the card
 * prints ("September 2026"). Each edge is resolved as its own local
 * midnight (weekly-window.ts's fixed point), never `from + N days`, because
 * a month with a DST change is not N × 24 hours long. `zone` is already
 * resolved by the caller (renderZone) — an unusable zone throws here, which
 * is the page's loud failure, not a silent UTC.
 */
export function monthWindow(now: Date, zone: string): MonthWindow {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: zone, year: "numeric", month: "2-digit" }).formatToParts(now);
  const year = Number(parts.find((p) => p.type === "year")!.value);
  const month = Number(parts.find((p) => p.type === "month")!.value);
  const key = (y: number, m: number) => `${y}-${String(m).padStart(2, "0")}-01`;
  const next = month === 12 ? key(year + 1, 1) : key(year, month + 1);
  return {
    fromIso: localMidnightInstant(key(year, month), zone).toISOString(),
    toIso: localMidnightInstant(next, zone).toISOString(),
    label: new Intl.DateTimeFormat("en-US", { timeZone: zone, month: "long", year: "numeric" }).format(now),
  };
}
