import { m } from "./messages";
import type { Locale } from "./i18n/locale";

/** `es` renders as `es-US` (not bare `es`) so currency/date conventions stay
 *  US-local (e.g. `$`/`,`/`.` grouping) for an audience reading Spanish in
 *  the same market as the `en-US` callers above, not Spain's or Mexico's. */
function tag(locale: Locale): string {
  return locale === "es" ? "es-US" : "en-US";
}

export function formatCurrency(n: number, locale: Locale = "en"): string {
  return new Intl.NumberFormat(tag(locale), {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(n);
}

/** Renders in the RUNTIME's zone (server or browser, whichever formats it).
 *  For anything scoped to an account — a record's timestamp, anything an
 *  operator reads as "when this happened to this client" — use
 *  `formatDateInZone` below and pass the account's zone. */
export function formatDate(iso: string, locale: Locale = "en"): string {
  return new Date(iso).toLocaleDateString(tag(locale), {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

/** Renders in the RUNTIME's zone — same caveat as `formatDate` above. */
export function formatDateTime(iso: string, locale: Locale = "en"): string {
  return new Date(iso).toLocaleString(tag(locale), {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/**
 * A calendar date AND time in a SPECIFIED zone — `formatDateTime`'s own
 * caveat applies to it (renders in the RUNTIME's zone, not the account's)
 * for exactly the reason `formatDateInZone` exists below: a timeline row's
 * own "when this happened" clock time is read by an operator who lives in
 * the account's zone, not the server's or their own browser's. Same
 * no-year caveat does not apply here — this one DOES carry a year, same
 * reasoning as `formatDateInZone`'s own note on that.
 */
export function formatDateTimeInZone(
  iso: string,
  timeZone: string,
  locale: Locale = "en",
): string {
  return new Intl.DateTimeFormat(tag(locale), {
    timeZone, month: "short", day: "numeric", year: "numeric",
    hour: "numeric", minute: "2-digit",
  }).format(new Date(iso));
}

/**
 * A calendar date in a SPECIFIED zone — for timestamps whose meaning is the
 * day they happened on in the account's world, not the hour, and not the
 * viewer's clock. (`formatDate` above pins no zone at all, so it renders in
 * whatever zone the server or browser happens to be in.)
 *
 * `year` is not optional here, for `formatCallTime`'s reason: fields like this
 * scroll back across years, and without one a 2025 record and a 2026 record
 * render identically. NOT solved by adding `year` to `lib/booking/time.ts`'s
 * `formatWhen` — that formatter renders booking confirmations, reminder and
 * cancellation mail, and six strings in the voice tool registry that are
 * SPOKEN ALOUD on live calls, where a year is clutter at best.
 *
 * No hour/minute: a field measured in days-to-weeks does not need a clock, and
 * "Sep 4, 2026" is what a business owner reads at 7 AM.
 *
 * ⚠️ THROWS on an unparseable `iso` (`RangeError: Invalid time value`), unlike
 * the three `toLocale*String` formatters in this file, which return the string
 * "Invalid Date". Deliberate — a bad timestamp should be a 500 an operator
 * reports, not a cell that quietly reads "Invalid Date" forever — but it means
 * a nullable or user-supplied value must be checked BEFORE the call, not after.
 */
export function formatDateInZone(
  iso: string,
  timeZone: string,
  locale: Locale = "en",
): string {
  return new Intl.DateTimeFormat(tag(locale), {
    timeZone, month: "short", day: "numeric", year: "numeric",
  }).format(new Date(iso));
}

/** For date-only values stored as UTC midnight (e.g. task due dates) —
 *  formatting in local time can roll the displayed day back by one. */
export function formatDateUTC(iso: string, locale: Locale = "en"): string {
  return new Date(iso).toLocaleDateString(tag(locale), {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

/** New — no relative-time formatter existed in this file before this task
 *  (confirmed by grep: zero uses of Intl.RelativeTimeFormat anywhere in the
 *  repo). `numeric: "auto"` so a recent instant reads "today"/"ayer" rather
 *  than "0 days ago"/"hace 0 días". */
export function formatRelativeTime(iso: string, locale: Locale = "en"): string {
  const diffMs = new Date(iso).getTime() - Date.now();
  const diffMin = Math.round(diffMs / 60_000);
  const rtf = new Intl.RelativeTimeFormat(tag(locale), { numeric: "auto" });
  if (Math.abs(diffMin) < 60) return rtf.format(diffMin, "minute");
  const diffHr = Math.round(diffMin / 60);
  if (Math.abs(diffHr) < 24) return rtf.format(diffHr, "hour");
  return rtf.format(Math.round(diffHr / 24), "day");
}

export function contactDisplayName(c: {
  first_name: string | null;
  last_name: string | null;
}): string {
  return [c.first_name, c.last_name].filter(Boolean).join(" ") || m["contact.noName"];
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  return (parts[0]![0]! + (parts[1]?.[0] ?? "")).toUpperCase();
}
