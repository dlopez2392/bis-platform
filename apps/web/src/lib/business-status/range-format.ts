// S-47d Task 12 (spec 5.6.3; orchestrator ruling, 2026-10-23): the ONE formatter the Closed days card
// uses for a range, in both languages. "Thursday, December 24" for one day; "Dec 28 – Jan 1" for a
// range, same month or crossing a month or a year boundary. `closureTodoDates` in closure-todo.ts is a
// DIFFERENT formatter (the closure To-do's {dates} bullet — full month names, no weekday, never
// abbreviated) and is never reused here. Fixed word lists, never Intl, so the card's words never depend
// on the server's locale data (the same reason hours.ts's own date words are fixed arrays, not Intl, per
// its own comment). Fix round D1: the words are date-words.ts's, the same tables the topbar uses, so
// Spanish reads "28 de dic. – 1 de ene." here exactly as "abre el 28 de dic." reads there.
//
// Never shows the year on either side: a closed day's range is at most 92 days (0097's own
// `closed_days_range_check`), so the month pair alone always says which side of a year boundary a date
// in the range falls on.
import { MONTH_LONG, WEEKDAY_LONG, shortDate } from "./date-words";

/** A "YYYY-MM-DD" calendar-day key, never converted through a zone (the day a closed day starts and
 *  ends on IS the date stored, `closed_days.starts_on`/`ends_on`). */
function dateParts(key: string): { month: number; date: number } {
  const [, mm, dd] = key.split("-");
  return { month: Number(mm) - 1, date: Number(dd) };
}

function weekdayOf(key: string, locale: "en" | "es"): string {
  const [y, m, d] = key.split("-").map(Number) as [number, number, number];
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return WEEKDAY_LONG[locale][dow]!;
}

/**
 * The Closed days card's own date range, in words: one day reads "Thursday, December 24" /
 * "jueves, 24 de diciembre"; a range within one month reads "Dec 24 – 26" / "24 – 26 de dic."; a range
 * crossing a month (or a year) reads "Dec 28 – Jan 1" / "28 de dic. – 1 de ene.". `from`/`to` are
 * "YYYY-MM-DD" calendar keys, `from <= to` (the caller's own invariant — `closed_days.ends_on >=
 * starts_on`).
 */
export function formatClosedDayRange(from: string, to: string, locale: "en" | "es"): string {
  if (from === to) {
    const { month, date } = dateParts(from);
    const monthName = MONTH_LONG[locale][month]!;
    return locale === "es"
      ? `${weekdayOf(from, "es")}, ${date} de ${monthName}`
      : `${weekdayOf(from, "en")}, ${monthName} ${date}`;
  }
  const a = dateParts(from);
  const b = dateParts(to);
  if (a.month === b.month) {
    return locale === "es"
      ? `${a.date} – ${shortDate(b.month, b.date, "es")}`
      : `${shortDate(a.month, a.date, "en")} – ${b.date}`;
  }
  return `${shortDate(a.month, a.date, locale)} – ${shortDate(b.month, b.date, locale)}`;
}
