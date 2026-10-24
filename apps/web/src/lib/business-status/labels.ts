// S-47d Task 11 (plan "The topbar forms", spec §5.6.1, §6): the topbar's status words and the dashboard
// card's end-of-closure line. Not part of the voice-knowledge/tsx graph (status.ts/guard.ts/knowledge/*.ts),
// so this file is free to use the app's own catalogue (`messages.ts`) rather than relative-only imports.
//
// Time, weekday and month words are fixed tables (never Intl), the same reason `range-format.ts` (Task 12)
// and `hours.ts` (S-47c) give for their own: the card and topbar's words must never depend on the server's
// locale data. The two tables below are this surface's OWN words, not a reuse of `range-format.ts`'s
// (that file's English months carry no period and its Spanish "sep" has none either; the topbar forms spec
// pins periods throughout, including "sept." for September) — two surfaces, two specs, deliberately not
// shared.
import { partsInZone } from "../booking/slots";
import { dayKey, type EffectiveStatus } from "./status";
import { m, type MessageKey } from "@/lib/messages";
import { t } from "@/lib/i18n/t";
import type { Locale } from "@/lib/i18n/locale";

const WEEKDAY: Record<Locale, readonly string[]> = {
  en: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"],
  es: ["dom.", "lun.", "mar.", "mié.", "jue.", "vie.", "sáb."],
};
const MONTH: Record<Locale, readonly string[]> = {
  en: ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"],
  es: ["ene.", "feb.", "mar.", "abr.", "may.", "jun.", "jul.", "ago.", "sept.", "oct.", "nov.", "dic."],
};
// The dashboard card's own long form (spec §5.6.2: "Next closed day: Thursday, December 24
// (holiday)") — full names, never the topbar's abbreviated tables above. A separate table, not a
// second source for the same fact: `range-format.ts` (Task 12, the Closed days card) carries its OWN
// identical-looking pair for a different surface, deliberately not shared (two specs, two owners).
const WEEKDAY_LONG: Record<Locale, readonly string[]> = {
  en: ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"],
  es: ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"],
};
const MONTH_LONG: Record<Locale, readonly string[]> = {
  en: ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"],
  es: ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"],
};
// partsInZone's own weekday field (slots.ts) is 3-letter lowercase English, Sunday-first — the same
// order this file's own WEEKDAY tables use, so no second day-of-week calculation is needed.
const WD_ORDER = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;

/** "h AM"/"h PM", ":mm" only when the minutes are not 00 ("8 AM", "8:30 AM", "12 PM") — the plan's own
 *  time form, shared by the topbar and the card: neither spec draws a second convention. */
function formatTime(at: Date, timezone: string): string {
  const p = partsInZone(at, timezone);
  const period = p.hh < 12 ? "AM" : "PM";
  const h12 = p.hh % 12 === 0 ? 12 : p.hh % 12;
  return p.mi === 0 ? `${h12} ${period}` : `${h12}:${String(p.mi).padStart(2, "0")} ${period}`;
}

/** English "{Mon} {d}", Spanish "{d} de {mes}" (plan "The topbar forms"). */
function formatDate(at: Date, timezone: string, locale: Locale): string {
  const p = partsInZone(at, timezone);
  const mon = MONTH[locale][p.m - 1]!;
  return locale === "es" ? `${p.d} de ${mon}` : `${mon} ${p.d}`;
}

function weekdayLabel(at: Date, timezone: string, locale: Locale): string {
  const idx = WD_ORDER.indexOf(partsInZone(at, timezone).weekday);
  return WEEKDAY[locale][idx]!;
}

/** The dashboard card's own long form (spec §5.6.2): "Weekday, Month d" / "weekday, d de mes". Used
 *  for the next-closed-day line and the 14-day cap's own date, never Intl (same reason this whole
 *  module's words are fixed tables: the card's words must never depend on the server's locale data). */
export function cardLongDate(at: Date, timezone: string, locale: Locale): string {
  const p = partsInZone(at, timezone);
  const idx = WD_ORDER.indexOf(p.weekday);
  const weekday = WEEKDAY_LONG[locale][idx]!;
  const month = MONTH_LONG[locale][p.m - 1]!;
  return locale === "es" ? `${weekday}, ${p.d} de ${month}` : `${weekday}, ${month} ${p.d}`;
}

function epochDayFromKey(key: string): number {
  const [y, mo, d] = key.split("-").map(Number) as [number, number, number];
  return Math.floor(Date.UTC(y, mo - 1, d) / 86_400_000);
}

/** Zone-calendar days from `now` to `at` (plan: "dd is the number of zone-calendar days from
 *  dayKey(now) to dayKey(reopensAt)"). SD15: dd 0 (or a stray negative) cannot occur given the reader's
 *  own rules; clamped to 1 so a stray same-day instant renders rather than throwing. */
function ddOf(now: Date, at: Date, timezone: string): number {
  const dd = epochDayFromKey(dayKey(at, timezone)) - epochDayFromKey(dayKey(now, timezone));
  return dd < 1 ? 1 : dd;
}

/** The topbar's "opens" phrase, by `dd` (plan "The topbar forms"). */
export function opensPhrase(at: Date, timeKnown: boolean, timezone: string, now: Date, locale: Locale): string {
  const dd = ddOf(now, at, timezone);
  if (dd === 1) {
    return timeKnown
      ? t(m, "business.opens.time", locale, { time: formatTime(at, timezone) })
      : t(m, "business.opens.tomorrow", locale);
  }
  if (dd <= 6) {
    const day = weekdayLabel(at, timezone, locale);
    return timeKnown
      ? t(m, "business.opens.dayTime", locale, { day, time: formatTime(at, timezone) })
      : t(m, "business.opens.day", locale, { day });
  }
  return t(m, "business.opens.date", locale, { date: formatDate(at, timezone, locale) });
}

const LATE_KEYS: Record<15 | 30 | 60 | 120, { full: MessageKey; short: MessageKey }> = {
  15: { full: "business.topbar.late15", short: "business.topbar.short.late15" },
  30: { full: "business.topbar.late30", short: "business.topbar.short.late30" },
  60: { full: "business.topbar.late60", short: "business.topbar.short.late60" },
  120: { full: "business.topbar.late120", short: "business.topbar.short.late120" },
};

/**
 * The topbar's full/short forms (plan "The topbar forms", spec §5.6.1): null for Open, which the caller
 * reads as "render nothing" (the topbar's idle/pulse state covers Open on its own). A closed day reads
 * exactly as Closed today (spec: "a closed day reads the same as Closed today").
 */
export function topbarLabels(
  e: EffectiveStatus, timezone: string, now: Date, locale: Locale,
): { full: string; short: string } | null {
  switch (e.state) {
    case "open":
      return null;
    case "closed_today":
    case "closed_day": {
      const opens = opensPhrase(e.reopensAt, e.reopensTimeKnown, timezone, now, locale);
      return {
        full: t(m, "business.topbar.closedToday", locale, { opens }),
        short: t(m, "business.topbar.short.closedToday", locale),
      };
    }
    case "running_late": {
      const keys = LATE_KEYS[e.lateMinutes];
      return { full: t(m, keys.full, locale), short: t(m, keys.short, locale) };
    }
    case "storm": {
      if (e.reopensAt === null) {
        return { full: t(m, "business.topbar.storm", locale), short: t(m, "business.topbar.short.storm", locale) };
      }
      const opens = opensPhrase(e.reopensAt, e.reopensTimeKnown, timezone, now, locale);
      return {
        full: t(m, "business.topbar.stormDated", locale, { opens }),
        short: t(m, "business.topbar.short.storm", locale),
      };
    }
  }
}

/** The dashboard card's own "opens again" phrasing (business.card.opensAgain.*) — a separate catalogue
 *  from the topbar's business.opens.*, same dd bucketing. dd>=7 keeps the time, unlike the topbar's
 *  date-only bucket: the card is a full read, not a compact status word. */
function opensAgainPhrase(at: Date, timeKnown: boolean, timezone: string, now: Date, locale: Locale): string {
  const dd = ddOf(now, at, timezone);
  if (dd === 1) {
    return timeKnown
      ? t(m, "business.card.opensAgain.tomorrow", locale, { time: formatTime(at, timezone) })
      : t(m, "business.card.opensAgain.tomorrowNoTime", locale);
  }
  if (dd <= 6) {
    const day = weekdayLabel(at, timezone, locale);
    return timeKnown
      ? t(m, "business.card.opensAgain.day", locale, { day, time: formatTime(at, timezone) })
      : t(m, "business.card.opensAgain.dayNoTime", locale, { day });
  }
  const date = formatDate(at, timezone, locale);
  return timeKnown
    ? t(m, "business.card.opensAgain.date", locale, { date, time: formatTime(at, timezone) })
    : t(m, "business.card.opensAgain.dateNoTime", locale, { date });
}

/**
 * The dashboard card's end-of-closure line (spec §5.6.2: "Opens again tomorrow at 8:00 AM", "Until you
 * reopen", "Ends at midnight"). Running late's window always ends at tonight's midnight (`untilFor`'s
 * own rule), never a reopening computed from hours, so its end line is the fixed "Ends at midnight"
 * rather than an opens-again phrase. `open` never reaches this (the card's Open branch never calls it);
 * it answers "" rather than throwing, so a caller that slips never crashes the card.
 */
export function cardEndLine(e: EffectiveStatus, timezone: string, now: Date, locale: Locale): string {
  switch (e.state) {
    case "open":
      return "";
    case "running_late":
      return t(m, "business.card.endsMidnight", locale);
    case "storm":
      return e.reopensAt === null
        ? t(m, "business.card.untilReopen", locale)
        : opensAgainPhrase(e.reopensAt, e.reopensTimeKnown, timezone, now, locale);
    case "closed_today":
    case "closed_day":
      return opensAgainPhrase(e.reopensAt, e.reopensTimeKnown, timezone, now, locale);
  }
}
