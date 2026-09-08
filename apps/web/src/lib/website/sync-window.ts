import { dayKeyInZone } from "@/lib/booking/availability";
import { partsInZone, zonedTimeToUtc } from "@/lib/booking/slots";

export const SYNC_HOUR = 3;
export const MAX_BACKFILL_DAYS = 30;

/** Past 03:00 local: the day that just ended is complete on Vercel's side. */
export function isPastSyncHour(now: Date, timezone: string): boolean {
  return partsInZone(now, timezone).hh >= SYNC_HOUR;
}

function shiftDayKey(dayKey: string, delta: number): string {
  const [y, m, d] = dayKey.split("-").map(Number);
  const dt = new Date(Date.UTC(y!, m! - 1, d! + delta, 12, 0));
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}-${String(dt.getUTCDate()).padStart(2, "0")}`;
}

/** Local day keys still to pull, oldest first, ending at LOCAL yesterday,
 *  at most MAX_BACKFILL_DAYS (the most recent ones win when the gap is longer). */
export function daysToSync(input: { now: Date; timezone: string; lastSyncedDay: string | null }): string[] {
  const yesterday = shiftDayKey(dayKeyInZone(input.now, input.timezone), -1);
  const days: string[] = [];
  for (let i = MAX_BACKFILL_DAYS - 1; i >= 0; i--) {
    const day = shiftDayKey(yesterday, -i);
    if (input.lastSyncedDay !== null && day <= input.lastSyncedDay) continue;
    days.push(day);
  }
  return days;
}

function localMidnight(dayKey: string, timezone: string): Date {
  const [y, m, d] = dayKey.split("-").map(Number);
  for (let bump = 0; bump < 4; bump++) {
    const resolved = zonedTimeToUtc(y!, m!, d!, bump, 0, timezone);
    if (resolved) return resolved;
  }
  throw new Error(`could not resolve local midnight for ${dayKey} in ${timezone}`);
}

/** [local midnight of dayKey, local midnight of the next day) as ISO instants —
 *  the since/until Vercel's API takes. */
export function localDayBounds(dayKey: string, timezone: string): { sinceIso: string; untilIso: string } {
  return {
    sinceIso: localMidnight(dayKey, timezone).toISOString(),
    untilIso: localMidnight(shiftDayKey(dayKey, 1), timezone).toISOString(),
  };
}
