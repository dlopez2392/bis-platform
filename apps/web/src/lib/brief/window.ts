// apps/web/src/lib/brief/window.ts
// The daily brief's clock (plan D4): WHEN a brief may go, and WHICH local days it describes. Pure; takes the tick's
// `now`, never reads the clock. Data days are UTC and owners are US Central, so nothing here slices by UTC date:
// the band is the account's wall-clock hour, and the day windows come from the owner line's own range resolver
// (`localDayStart`: the first instant whose local date is the day, correct on 23 and 25 hour days).
import { resolveRange } from "@/lib/owner-line/range";

/** 07:00 through 08:59 local. A brief is "your 7 AM day"; a tick that misses the band drops that day (owner Q3). */
export const BRIEF_BAND_START_HOUR = 7;
export const BRIEF_BAND_END_HOUR = 9;

/** The wall-clock hour of `instant` in `zone` (0-23), or null when the zone or the instant cannot be read. Called
 *  without `new`, `hourCycle: "h23"` (never `hour12: false`, which prints midnight as 24), locale pinned: the
 *  weekly report's own `localParts` choices, for the same reasons (reports/weekly-window.ts). */
function localHour(instant: Date, zone: string): number | null {
  if (!Number.isFinite(instant.getTime())) return null;
  try {
    const part = Intl.DateTimeFormat("en-US", { timeZone: zone, hour: "2-digit", hourCycle: "h23" })
      .formatToParts(instant).find((p) => p.type === "hour")?.value;
    const hour = Number(part);
    return part !== undefined && Number.isInteger(hour) ? hour : null;
  } catch {
    return null;
  }
}

/** True from 07:00 to 08:59 on the account's own wall clock. The clock change (2 AM) never touches it. */
export function dailyBriefBand(now: Date, zone: string): boolean {
  const hour = localHour(now, zone);
  return hour !== null && hour >= BRIEF_BAND_START_HOUR && hour < BRIEF_BAND_END_HOUR;
}

export type BriefDays = {
  /** The account-local calendar day, "YYYY-MM-DD", and the day before it. */
  today: string;
  yesterday: string;
  /** The first instant of yesterday, today and tomorrow in the zone: ISO, exact on 23 and 25 hour days. */
  yesterdayStartIso: string;
  todayStartIso: string;
  tomorrowStartIso: string;
};

/** Today's and yesterday's windows for `zone`, or null when the zone is unusable. */
export function briefDays(now: Date, zone: string): BriefDays | null {
  const today = resolveRange({ range: "today" }, zone, now);
  const yesterday = resolveRange({ range: "yesterday" }, zone, now);
  if (!today.ok || !yesterday.ok) return null;
  return {
    today: today.firstDay, yesterday: yesterday.firstDay,
    yesterdayStartIso: yesterday.fromIso, todayStartIso: today.fromIso, tomorrowStartIso: today.toIso,
  };
}
