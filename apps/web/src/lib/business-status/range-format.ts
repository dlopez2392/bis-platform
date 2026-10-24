// S-47d Task 12 (spec 5.6.3; orchestrator ruling, 2026-10-23): the ONE formatter the Closed days card
// uses for a range, in both languages. "Thursday, December 24" for one day; "Dec 28 – Jan 1" for a
// range, same month or crossing a month or a year boundary. Pure, no imports: `closureTodoDates` in
// closure-todo.ts is a DIFFERENT formatter (the closure To-do's {dates} bullet — full month names, no
// weekday, never abbreviated) and is never reused here. Fixed word lists, never Intl, so the card's
// words never depend on the server's locale data (the same reason hours.ts's own date words are fixed
// arrays, not Intl, per its own comment).
//
// Never shows the year on either side: a closed day's range is at most 92 days (0097's own
// `closed_days_range_check`), so the month pair alone always says which side of a year boundary a date
// in the range falls on.
const EN_WEEKDAY = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;
const EN_MONTH = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
] as const;
const EN_MONTH_ABBR = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;
const ES_WEEKDAY = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"] as const;
const ES_MONTH = [
  "enero", "febrero", "marzo", "abril", "mayo", "junio",
  "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
] as const;
const ES_MONTH_ABBR = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"] as const;

/** A "YYYY-MM-DD" calendar-day key, never converted through a zone (the day a closed day starts and
 *  ends on IS the date stored, `closed_days.starts_on`/`ends_on`). */
function dateParts(key: string): { month: number; date: number } {
  const [, mm, dd] = key.split("-");
  return { month: Number(mm) - 1, date: Number(dd) };
}

function weekdayOf(key: string, locale: "en" | "es"): string {
  const [y, m, d] = key.split("-").map(Number) as [number, number, number];
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return (locale === "es" ? ES_WEEKDAY : EN_WEEKDAY)[dow]!;
}

/**
 * The Closed days card's own date range, in words: one day reads "Thursday, December 24" /
 * "jueves, 24 de diciembre"; a range within one month reads "Dec 24 – 26" / "24 – 26 dic"; a range
 * crossing a month (or a year) reads "Dec 28 – Jan 1" / "28 dic – 1 ene". `from`/`to` are "YYYY-MM-DD"
 * calendar keys, `from <= to` (the caller's own invariant — `closed_days.ends_on >= starts_on`).
 */
export function formatClosedDayRange(from: string, to: string, locale: "en" | "es"): string {
  if (from === to) {
    const { month, date } = dateParts(from);
    return locale === "es"
      ? `${weekdayOf(from, "es")}, ${date} de ${ES_MONTH[month]}`
      : `${weekdayOf(from, "en")}, ${EN_MONTH[month]} ${date}`;
  }
  const a = dateParts(from);
  const b = dateParts(to);
  const abbr = locale === "es" ? ES_MONTH_ABBR : EN_MONTH_ABBR;
  if (a.month === b.month) {
    return locale === "es" ? `${a.date} – ${b.date} ${abbr[a.month]}` : `${abbr[a.month]} ${a.date} – ${b.date}`;
  }
  return locale === "es"
    ? `${a.date} ${abbr[a.month]} – ${b.date} ${abbr[b.month]}`
    : `${abbr[a.month]} ${a.date} – ${abbr[b.month]} ${b.date}`;
}
