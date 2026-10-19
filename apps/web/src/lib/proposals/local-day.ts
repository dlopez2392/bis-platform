/**
 * Local days in the account's zone (item 8b-1, spec 4.2). A suggested to-do's due date is DATE-only:
 * the form posts "YYYY-MM-DD", read in the account's zone, and the stored instant is the first one whose
 * local date is that day. Usually local midnight; the first minute after a DST gap where midnight does
 * not exist (America/Havana, America/Santiago, Asia/Beirut); the earlier of two midnights on a
 * fall-back day. Pure, no I/O.
 */

const formatters = new Map<string, Intl.DateTimeFormat>();

/** "YYYY-MM-DD" of `at` in `zone` (en-CA formats dates as ISO keys, so keys compare as strings). */
export function localDateKey(at: Date, zone: string): string {
  let f = formatters.get(zone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit" });
    formatters.set(zone, f);
  }
  return f.format(at);
}

/** ISO instant of the first moment whose local date in `zone` is `dateKey`. Scans by the hour from 15
 *  hours before the UTC midnight (west of every offset), steps back one hour, then scans by the minute:
 *  the first match is the earliest, whichever way the day's clocks jump. */
export function firstInstantOfLocalDay(dateKey: string, zone: string): string {
  const key = (t: number) => localDateKey(new Date(t), zone);
  const [y, m, d] = dateKey.split("-").map(Number);
  let t = Date.UTC(y!, m! - 1, d!) - 15 * 3_600_000;
  while (key(t) < dateKey) t += 3_600_000;
  t -= 3_600_000;
  while (key(t) < dateKey) t += 60_000;
  return new Date(t).toISOString();
}

/** Calendar arithmetic on a "YYYY-MM-DD" key; zone-free, because a calendar day has no offset. */
export function addLocalDays(dateKey: string, days: number): string {
  const [y, m, d] = dateKey.split("-").map(Number);
  return new Date(Date.UTC(y!, m! - 1, d! + days)).toISOString().slice(0, 10);
}
