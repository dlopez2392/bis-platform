// S-47c (spec section 5.1; C5, SD16): the hours lines and the "Right now" line. All arithmetic in the account's
// zone through partsInZone (Intl.DateTimeFormat with an explicit timeZone), the slot engine's rule, so DST is the
// zone's, never the server's. Pure; relative imports only.
import { partsInZone, type OpenHours } from "../../booking/slots";
import { dayKey, reopeningFrom, type ClosedDay, type EffectiveStatus } from "../../business-status/status";

type Day = "sun" | "mon" | "tue" | "wed" | "thu" | "fri" | "sat";
const SUN_FIRST: readonly Day[] = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
export const HOURS_DAYS_MONDAY_FIRST = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;
const DAY_NAME: Record<Day, string> = {
  mon: "Monday", tue: "Tuesday", wed: "Wednesday", thu: "Thursday", fri: "Friday", sat: "Saturday", sun: "Sunday",
};

const minutes = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

/** "08:00" -> "8:00 AM", "00:00" -> "12:00 AM", "12:00" -> "12:00 PM", "24:00" -> "midnight". */
export function clockTime(hhmm: string): string {
  if (hhmm === "24:00") return "midnight";
  const h = Number(hhmm.slice(0, 2));
  const m = hhmm.slice(3, 5);
  return `${h % 12 === 0 ? 12 : h % 12}:${m} ${h < 12 ? "AM" : "PM"}`;
}

// S-47d (spec 5.4.1, S12): the date words the closure lines say. Fixed English arrays, never Intl, so a server
// locale can never change a word she is told.
const MONTH_NAME = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October",
  "November", "December"] as const;
const keyParts = (key: string) => key.split("-").map(Number) as [number, number, number];

/** "Thursday" for "2026-12-24" (a calendar date key, no zone). */
export function weekdayNameOf(key: string): string {
  const [y, m, d] = keyParts(key);
  return DAY_NAME[SUN_FIRST[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]!];
}
/** "December 24" for "2026-12-24". */
export function monthDayOf(key: string): string {
  const [, m, d] = keyParts(key);
  return `${MONTH_NAME[m - 1]!} ${d}`;
}
/** Calendar days from key `a` to key `b` (negative when b is earlier). */
export function daysBetweenKeys(a: string, b: string): number {
  const [ay, am, ad] = keyParts(a);
  const [by, bm, bd] = keyParts(b);
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86_400_000);
}
/** The wall clock of `instant` in `timeZone`, in clockTime's words: "8:00 AM". */
export function clockAt(instant: Date, timeZone: string): string {
  const p = partsInZone(instant, timeZone);
  return clockTime(`${String(p.hh).padStart(2, "0")}:${String(p.mi).padStart(2, "0")}`);
}

/** A day's spans, sorted by start (the stored value is sorted already; a copied calendar value may not be). */
function spansOf(hours: OpenHours, day: Day): [string, string][] {
  return [...(hours[day] ?? [])].sort((a, b) => minutes(a[0]) - minutes(b[0]));
}

export function hasOpenDay(hours: OpenHours | null | undefined): hours is OpenHours {
  return !!hours && SUN_FIRST.some((d) => (hours[d] ?? []).length > 0);
}

/** Seven lines, Monday first (the calendar panel's order): "Monday: 8:00 AM to 12:00 PM and 1:00 PM to 6:00 PM". */
export function hoursLines(hours: OpenHours): string[] {
  return HOURS_DAYS_MONDAY_FIRST.map((d) => {
    const parts = spansOf(hours, d).map(([f, t]) => `${clockTime(f)} to ${clockTime(t)}`);
    if (parts.length === 0) return `${DAY_NAME[d]}: closed`;
    const joined = parts.length === 1 ? parts[0]! : `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]!}`;
    return `${DAY_NAME[d]}: ${joined}`;
  });
}

export type OpenNow = { open: boolean; line: string };
/** S-47d (spec 5.4.2): what openNow counts besides the weekly hours. `status` null reads as open. */
export type OpenNowClosures = { status: EffectiveStatus | null; closedDays: readonly ClosedDay[] };

/** S-47c's "opens {when}" words, by zone days to the opening: today / tomorrow / {Weekday} / next {Weekday} at
 *  exactly seven (SD15), and "on {Weekday}, {Month} {d}" beyond seven (S12, S-47d). */
function opensWhen(opening: Date, timeZone: string, now: Date): string {
  const key = dayKey(opening, timeZone);
  const dd = daysBetweenKeys(dayKey(now, timeZone), key);
  if (dd <= 0) return "today";
  if (dd === 1) return "tomorrow";
  if (dd < 7) return weekdayNameOf(key);
  if (dd === 7) return `next ${weekdayNameOf(key)}`;
  return `on ${weekdayNameOf(key)}, ${monthDayOf(key)}`;
}
function closedLine(opening: Date | null, timeKnown: boolean, timeZone: string, now: Date): OpenNow {
  if (opening === null) return { open: false, line: "Right now: closed." };
  const when = opensWhen(opening, timeZone, now);
  return { open: false, line: `Right now: closed; opens ${when}${timeKnown ? ` at ${clockAt(opening, timeZone)}` : ""}.` };
}

/** Absent `closures`: S-47c's answer, byte for byte. With a closure in force (Closed today, Storm, a closed day):
 *  closed, opening at the reader's reopening. Otherwise (open, running late, or no status): the hours' answer,
 *  except that a closed-now answer names the next opening that is not on a closed day. */
export function openNow(hours: OpenHours, timeZone: string, now: Date, closures?: OpenNowClosures): OpenNow {
  if (closures) {
    const s = closures.status;
    if (s && (s.state === "closed_today" || s.state === "storm" || s.state === "closed_day")) {
      return closedLine(s.reopensAt, s.reopensTimeKnown, timeZone, now);
    }
    const byHours = openNow(hours, timeZone, now);
    if (byHours.open) return byHours;
    const next = reopeningFrom(now, hours, timeZone, closures.closedDays);
    return next.timeKnown ? closedLine(next.at, true, timeZone, now) : { open: false, line: "Right now: closed." };
  }
  const p = partsInZone(now, timeZone);
  const today = SUN_FIRST.indexOf(p.weekday);
  const t = p.hh * 60 + p.mi;
  const dayAt = (offset: number): Day => SUN_FIRST[(today + offset) % 7]!;

  const current = spansOf(hours, dayAt(0)).find(([f, to]) => minutes(f) <= t && t < minutes(to));
  if (current) {
    // One stretch: a span that starts exactly when this one ends continues it (the same day, or 00:00 the next
    // day after a 24:00 end). A stretch that never ends inside a week is "open." (SD16).
    let end = current[1];
    let offset = 0;
    for (let guard = 0; guard < 7 * 48; guard++) {
      const nextOffset = end === "24:00" ? offset + 1 : offset;
      if (nextOffset > 7) return { open: true, line: "Right now: open." };
      const from = end === "24:00" ? "00:00" : end;
      const next = spansOf(hours, dayAt(nextOffset)).find(([f]) => f === from);
      if (!next) break;
      end = next[1];
      offset = nextOffset;
    }
    return { open: true, line: `Right now: open until ${clockTime(end)}.` };
  }

  const laterToday = spansOf(hours, dayAt(0)).find(([f]) => minutes(f) > t);
  if (laterToday) return { open: false, line: `Right now: closed; opens today at ${clockTime(laterToday[0])}.` };
  for (let d = 1; d <= 7; d++) {
    const first = spansOf(hours, dayAt(d))[0];
    if (!first) continue;
    const when = d === 1 ? "tomorrow" : d === 7 ? `next ${DAY_NAME[dayAt(d)]}` : DAY_NAME[dayAt(d)];
    return { open: false, line: `Right now: closed; opens ${when} at ${clockTime(first[0])}.` };
  }
  return { open: false, line: "Right now: closed." }; // no open day at all: callers never pass one (hasOpenDay)
}
