import type { AuthorKind, ContactFacts } from "@bis/db";
import { partsInZone } from "@/lib/booking/slots";
import { formatCurrency, formatDateInZone } from "@/lib/format";
import type { Locale } from "@/lib/i18n/locale";
import type { Tr } from "./copy";

const tag = (locale: Locale) => (locale === "es" ? "es-US" : "en-US");

/** `YYYY-MM-DD` as the account's zone sees `instant` (the booking engine's own conversion). */
export function dayKeyIn(instant: Date, zone: string): string {
  const p = partsInZone(instant, zone);
  return `${p.y}-${String(p.m).padStart(2, "0")}-${String(p.d).padStart(2, "0")}`;
}

const utcDay = (key: string) => {
  const [y, mo, d] = key.split("-").map(Number);
  return Date.UTC(y!, mo! - 1, d!);
};

/** Whole CALENDAR days between `at` and `now`, both read in `zone`; never 24-hour arithmetic. */
export function calendarDaysAgo(at: string, now: Date, zone: string): number {
  return Math.round((utcDay(dayKeyIn(now, zone)) - utcDay(dayKeyIn(new Date(at), zone))) / 86_400_000);
}

/** "Dec 2025": the month the customer joined, in the account's zone; null if unreadable. */
export function sinceMonth(createdAt: string, zone: string, locale: Locale): string | null {
  try {
    return new Intl.DateTimeFormat(tag(locale), { timeZone: zone, month: "short", year: "numeric" }).format(new Date(createdAt));
  } catch (e) {
    if (e instanceof RangeError) return null;
    throw e;
  }
}

/** "today", "yesterday", "4 days ago" (Intl, numeric auto), then the date past 30 days. */
export function talkedWhen(at: string, now: Date, zone: string, locale: Locale): string {
  const days = calendarDaysAgo(at, now, zone);
  if (days > 30) return formatDateInZone(at, zone, locale);
  return new Intl.RelativeTimeFormat(tag(locale), { numeric: "auto" }).format(-Math.max(0, days), "day");
}

export type FactsView = { line: string[]; missing: string | null; allFailed: boolean };

/**
 * The summary's one line of facts (spec §9.2). A zero is left out; a failed read is left out AND
 * named under the line ("Couldn't count …"), so a missing fact never reads as a zero (DESIGN.md,
 * the weekly report: omitted, never zeroed).
 */
export function factsView(
  input: {
    createdAt: string; facts: ContactFacts;
    /** item 8c: who created the record, already resolved to the mark's own words (`authorLabel`); null
     *  for a row written before the deploy (the column itself is null), so the fact is simply absent
     *  rather than wrong (DESIGN.md: omitted, never guessed). */
    author?: { kind: AuthorKind; label: string } | null;
  },
  ctx: { zone: string; now: Date; tr: Tr },
): FactsView {
  const { tr, zone, now } = ctx;
  const line: string[] = [];
  const missing: string[] = [];
  const month = sinceMonth(input.createdAt, zone, tr.locale);
  if (month) line.push(tr.text("record.facts.since", { month }));
  if (input.author) line.push(tr.text("record.facts.addedBy", { who: input.author.label }));

  const booked = input.facts.bookingsMade;
  if (!booked.ok) missing.push(tr.text("record.facts.what.bookings"));
  else if (booked.value > 0) line.push(tr.count("record.facts.booked", booked.value));

  const talked = input.facts.lastTalked;
  if (!talked.ok) missing.push(tr.text("record.facts.what.talked"));
  else if (talked.value) {
    line.push(tr.text("record.facts.lastTalked", {
      when: talkedWhen(talked.value.at, now, zone, tr.locale),
      channel: tr.text(`record.facts.channel.${talked.value.channel}` as const),
    }));
  }

  const deals = input.facts.openDeals;
  if (!deals.ok) missing.push(tr.text("record.facts.what.deals"));
  else if (deals.value.count > 0) {
    line.push(tr.count("record.facts.openDeals", deals.value.count));
    if (deals.value.amount !== null && deals.value.amount > 0) line.push(formatCurrency(deals.value.amount, tr.locale));
  }

  return {
    line,
    missing: missing.length > 0
      ? tr.text("record.facts.couldntCount", { what: new Intl.ListFormat(tag(tr.locale), { type: "conjunction" }).format(missing) })
      : null,
    allFailed: missing.length === 3,
  };
}
