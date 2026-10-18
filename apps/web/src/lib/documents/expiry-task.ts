import { DOCUMENT_EXPIRY_WINDOW_DAYS, shiftDay, type DocumentCategory } from "@bis/db/document-rules";
import { zonedTimeToUtc } from "@/lib/booking/slots";
import { dayDiff } from "@/lib/documents/expiry";
import { m, type MessageKey } from "@/lib/messages";
import { t } from "@/lib/i18n/t";
import type { Locale } from "@/lib/i18n/locale";

/**
 * The expiry To-do's pure rules (S-07 3a, spec 3.2). "Today" is the ACCOUNT's calendar day, read by the
 * caller with dayKeyInZone (lib/booking/availability.ts, the slot engine's own conversion); the window is
 * today .. today + 30, so a file already past its date never opens a To-do (the catch-up rule: the
 * Documents page's Expired filter covers those). Due: the expiry date minus 7 CALENDAR days, at 09:00 in
 * the zone (owner choice 2026-10-17), so a DST change in between never moves it to 08:00 or 10:00.
 */
export const EXPIRY_DUE_LEAD_DAYS = 7;
export const EXPIRY_DUE_HOUR = 9;

export function inExpiryWindow(expiresOn: string, today: string): boolean {
  const days = dayDiff(today, expiresOn);
  return days >= 0 && days <= DOCUMENT_EXPIRY_WINDOW_DAYS;
}

export function expiryDueAt(expiresOn: string, zone: string): string {
  const day = shiftDay(expiresOn, -EXPIRY_DUE_LEAD_DAYS);
  const y = Number(day.slice(0, 4)); const mo = Number(day.slice(5, 7)); const d = Number(day.slice(8, 10));
  // A 09:00 that does not exist (a DST gap at that hour, in no zone served today) falls to 09:00 UTC rather than no due date.
  return (zonedTimeToUtc(y, mo, d, EXPIRY_DUE_HOUR, 0, zone) ?? new Date(Date.UTC(y, mo - 1, d, EXPIRY_DUE_HOUR, 0))).toISOString();
}

export function expiryTaskTitle(a: { category: DocumentCategory; title: string; name: string; expiresOn: string }, lang: Locale): string {
  const name = a.name.trim() || t(m, "documents.expiryTask.noName", lang);
  const date = new Intl.DateTimeFormat(lang === "es" ? "es-US" : "en-US", { timeZone: "UTC", month: "short", day: "numeric" })
    .format(new Date(`${a.expiresOn}T00:00:00Z`));
  return t(m, `documents.expiryTask.${a.category}` as MessageKey, lang, { name, date, title: a.title });
}
