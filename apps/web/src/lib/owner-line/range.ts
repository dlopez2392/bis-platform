// apps/web/src/lib/owner-line/range.ts
// The owner line's ranges (F-032 §5): today, yesterday, tomorrow, this week, or named dates, always as whole days in
// the ACCOUNT's zone (owner ruling Q-F), at most 31 days. Day boundaries start from the weekly report's
// localMidnightInstant, the conversion that has already been wrong once in this repo and is pinned there. Its own
// doc (weekly-window.ts:95-98) says it assumes no clock change AT midnight, so localDayStart corrects the answer for
// the zones where one happens: the first instant whose local date is the day. The same rule SQL uses
// (app.owner_line_day_start, 0115) for the 10-a-day limit.
import { dayKeyInZone } from "@/lib/booking/availability";
import { localMidnightInstant } from "@/lib/reports/weekly-window";

const STEP_MS = 15 * 60_000;
/** The first instant whose local date in `zone` is `day`. Bounded: no zone jumps more than 2 hours. */
export function localDayStart(day: string, zone: string): Date {
  let t = localMidnightInstant(day, zone).getTime();
  for (let i = 0; i < 8 && dayKeyInZone(new Date(t), zone) < day; i++) t += STEP_MS;
  for (let i = 0; i < 8 && dayKeyInZone(new Date(t - STEP_MS), zone) === day; i++) t -= STEP_MS;
  return new Date(t);
}

export const MAX_RANGE_DAYS = 31;
export const RANGE_KINDS = ["today", "yesterday", "tomorrow", "this_week", "dates"] as const;
export type ResolvedRange =
  | { ok: true; fromIso: string; toIso: string; firstDay: string; lastDay: string; multiDay: boolean }
  | { ok: false; error: "bad_range" | "range_too_long" };

const DAY = /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/;
const parts = (day: string) => day.split("-").map(Number) as [number, number, number];
function shift(day: string, n: number): string {
  const [y, m, d] = parts(day);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}
const isDay = (v: unknown): v is string => typeof v === "string" && DAY.test(v) && shift(v, 0) === v;
const days = (a: string, b: string) => {
  const [ay, am, ad] = parts(a);
  const [by, bm, bd] = parts(b);
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86_400_000) + 1;
};

export function resolveRange(input: { range?: unknown; from?: unknown; to?: unknown }, zone: string, now: Date): ResolvedRange {
  const today = dayKeyInZone(now, zone);
  let first: string;
  let last: string;
  switch (input.range) {
    case "today": first = last = today; break;
    case "yesterday": first = last = shift(today, -1); break;
    case "tomorrow": first = last = shift(today, 1); break;
    case "this_week": {
      const [y, m, d] = parts(today);
      const sinceMonday = (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7;
      first = shift(today, -sinceMonday);
      last = shift(first, 6);
      break;
    }
    case "dates": {
      if (!isDay(input.from) || (input.to !== undefined && !isDay(input.to))) return { ok: false, error: "bad_range" };
      first = input.from;
      last = (input.to as string | undefined) ?? input.from;
      if (last < first) return { ok: false, error: "bad_range" };
      if (days(first, last) > MAX_RANGE_DAYS) return { ok: false, error: "range_too_long" };
      break;
    }
    default: return { ok: false, error: "bad_range" };
  }
  return {
    ok: true, firstDay: first, lastDay: last, multiDay: first !== last,
    fromIso: localDayStart(first, zone).toISOString(),
    toIso: localDayStart(shift(last, 1), zone).toISOString(),
  };
}
