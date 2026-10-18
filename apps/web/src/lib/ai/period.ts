/**
 * The account's own calendar month and day (choice I7), as 0086 stores them: YYYY-MM and YYYY-MM-DD.
 *
 * Built from the date's PARTS (as billing-view.ts's monthStartInZone does), not from a formatted string, so
 * the key's shape never depends on a locale's punctuation (assumption A5 no longer has to hold). 0086 accepts
 * any well-formed key, a far-future one included, and relies on this function being handed the real clock:
 * the gateway passes `input.now ?? new Date()`, so a key is always within a day of today's UTC date. An
 * invalid date throws (Intl's RangeError), and the gateway's outer catch then sends no key at all.
 */
export function periodKeys(now: Date, zone: string): { monthKey: string; dayKey: string } {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  const part = (type: "year" | "month" | "day") => parts.find((p) => p.type === type)?.value ?? "";
  const monthKey = `${part("year")}-${part("month")}`;
  const dayKey = `${monthKey}-${part("day")}`;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dayKey)) throw new RangeError(`periodKeys: no date for ${zone}`);
  return { monthKey, dayKey };
}
