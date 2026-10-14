import { DOCUMENT_TRASH_DAYS } from "@bis/db/document-rules";
import { m } from "@/lib/messages";
import { t, plural } from "@/lib/i18n/t";
import type { Locale } from "@/lib/i18n/locale";

/** Spec 4.1: 30 days away or less, or past, is a dot and the word (rule 3). */
export const EXPIRY_SOON_DAYS = 30;
export type ExpiryView = { band: "future" | "today" | "past"; days: number; soon: boolean };
const DAY_MS = 86_400_000;

/** Whole calendar days from `from` to `to` (both YYYY-MM-DD), on UTC midnights so a DST change never shifts it. */
export function dayDiff(from: string, to: string): number {
  const at = (d: string) => Date.UTC(Number(d.slice(0, 4)), Number(d.slice(5, 7)) - 1, Number(d.slice(8, 10)));
  return Math.round((at(to) - at(from)) / DAY_MS);
}

/** `today` is the ACCOUNT's day (accountToday), never the browser's. */
export function expiryView(expiresOn: string | null, today: string): ExpiryView | null {
  if (!expiresOn) return null;
  const d = dayDiff(today, expiresOn);
  if (d === 0) return { band: "today", days: 0, soon: true };
  if (d < 0) return { band: "past", days: -d, soon: true };
  return { band: "future", days: d, soon: d <= EXPIRY_SOON_DAYS };
}

export function expiryText(v: ExpiryView, locale: Locale): string {
  if (v.band === "today") return t(m, "documents.expires.today", locale);
  return plural(m, v.band === "future" ? "documents.expires.in" : "documents.expires.ago", v.days, locale, { count: v.days });
}

/** Days until the clean-up pass purges a file trashed at `deletedAt` (spec 4.4), counted from the server's `now`. */
export function purgeDaysLeft(deletedAt: string, now: string): number {
  const left = (Date.parse(deletedAt) + DOCUMENT_TRASH_DAYS * DAY_MS - Date.parse(now)) / DAY_MS;
  return Math.max(0, Math.ceil(left));
}

export function purgeText(daysLeft: number, locale: Locale): string {
  return daysLeft <= 0 ? t(m, "documents.purgeToday", locale) : plural(m, "documents.purgeIn", daysLeft, locale, { count: daysLeft });
}
