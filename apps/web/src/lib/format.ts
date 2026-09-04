import { m } from "./messages";

const currency = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

export function formatCurrency(n: number): string {
  return currency.format(n);
}

export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
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
 */
export function formatDateInZone(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone, month: "short", day: "numeric", year: "numeric",
  }).format(new Date(iso));
}

/** For date-only values stored as UTC midnight (e.g. task due dates) —
 *  formatting in local time can roll the displayed day back by one. */
export function formatDateUTC(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
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
