/** F-046 (spec 5.2, 5.3): the agenda's day and week, reckoned in the account's zone. A day runs from its own
 *  local midnight (01:00 where midnight is the DST gap, `startOfDay`) to the next day's, so a spring-forward day
 *  is 23 hours and a fall-back day 25: never `from + 24 h`. Pure: `now` is always a parameter. */
import { addDays, startOfDay, isDateKey } from "@/lib/business-status/status";
import { partsInZone, zonedTimeToUtc, normalizeOpenHours, type OpenHours } from "./slots";

export type AgendaView = "day" | "week";
export type AgendaDay = { key: string; start: Date; end: Date; zoneShift: boolean };
const WEEKDAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;
const weekdayOf = (key: string) => {
  const [y, m, d] = key.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
};

export function parseAgendaParams(raw: { view?: string; day?: string }, today: string): { view: AgendaView; day: string } {
  return { view: raw.view === "week" ? "week" : "day", day: raw.day && isDateKey(raw.day) ? raw.day : today };
}
/** D10: the slot engine's own weekday order, Sunday first (slots.ts:8). */
export function weekStartKey(key: string): string { return addDays(key, -weekdayOf(key)); }
export function shiftKey(view: AgendaView, key: string, dir: -1 | 1): string { return addDays(key, dir * (view === "week" ? 7 : 1)); }

const offsetMinutes = (t: Date, tz: string) => {
  const p = partsInZone(t, tz);
  return (Date.UTC(p.y, p.m - 1, p.d, p.hh, p.mi) - Math.floor(t.getTime() / 60_000) * 60_000) / 60_000;
};
/** Whether the zone's UTC offset at `start` differs from its offset in the last minute before `end`: on such a
 *  day a wall time can repeat (or be skipped), so every time shown carries the zone's short name. */
export function dayHasZoneShift(start: Date, end: Date, tz: string): boolean {
  return offsetMinutes(start, tz) !== offsetMinutes(new Date(end.getTime() - 60_000), tz);
}
function day(key: string, tz: string): AgendaDay {
  const start = startOfDay(key, tz);
  const end = startOfDay(addDays(key, 1), tz);
  return { key, start, end, zoneShift: dayHasZoneShift(start, end, tz) };
}
export function agendaWindow(view: AgendaView, key: string, tz: string): { from: Date; to: Date; days: AgendaDay[] } {
  const first = view === "week" ? weekStartKey(key) : key;
  const days = Array.from({ length: view === "week" ? 7 : 1 }, (_, i) => day(addDays(first, i), tz));
  return { from: days[0]!.start, to: days[days.length - 1]!.end, days };
}
/** A time of day in the account's zone, with the zone's short name when `withZone` (a zone-shift day). Called
 *  without `new`, as `partsInZone` is: ECMA-402-equal, and a `vi.spyOn(Intl, "DateTimeFormat")` can intercept it. */
export function agendaTime(instant: Date, tz: string, locale: "en" | "es", withZone: boolean): string {
  return Intl.DateTimeFormat(locale === "es" ? "es-US" : "en-US", {
    timeZone: tz, hour: "numeric", minute: "2-digit", ...(withZone ? { timeZoneName: "short" as const } : {}),
  }).format(instant);
}
/** The instant of wall time `hhmm` on day `key`; null inside a DST gap (a time that does not exist that day). */
export function wallToInstant(key: string, hhmm: string, tz: string): Date | null {
  const [y, m, d] = key.split("-").map(Number) as [number, number, number];
  const [hh, mi] = hhmm.split(":").map(Number) as [number, number];
  return zonedTimeToUtc(y, m, d, hh, mi, tz);
}
/** The free rows of a Day: every whole hour inside the day's open hours that starts at or after `now` and that
 *  no live job touches ([) bounds). An hour the clocks skip is never offered. */
export function freeHours(i: { dayKey: string; timezone: string; openHours: OpenHours;
  live: readonly { startsAt: Date; endsAt: Date }[]; now: Date }): Date[] {
  const out: Date[] = [];
  const hours = normalizeOpenHours(i.openHours)[WEEKDAYS[weekdayOf(i.dayKey)]!] ?? [];
  for (const [f, t] of hours) {
    const [fh, fm] = f.split(":").map(Number) as [number, number];
    const [th] = t.split(":").map(Number) as [number];
    for (let h = fm === 0 ? fh : fh + 1; h + 1 <= th; h++) {
      const at = wallToInstant(i.dayKey, `${String(h).padStart(2, "0")}:00`, i.timezone);
      if (!at || at.getTime() < i.now.getTime()) continue;
      const end = at.getTime() + 3_600_000;
      if (i.live.some((r) => r.startsAt.getTime() < end && at.getTime() < r.endsAt.getTime())) continue;
      out.push(at);
    }
  }
  return out.sort((a, b) => a.getTime() - b.getTime());
}
