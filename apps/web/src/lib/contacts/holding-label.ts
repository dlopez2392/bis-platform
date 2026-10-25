// S-47e (E8, spec 5.12.4, S29): the one name a shared number's holding thread shows wherever a customer's
// name would. Never "Caller".
import { m } from "@/lib/messages";
import { t } from "@/lib/i18n/t";
import type { Locale } from "@/lib/i18n/locale";
import { formatPhone } from "@/lib/document-requests/customer-state";

export function holdingLabel(number: string | null, locale: Locale): string {
  return t(m, "contact.holding.label", locale, { number: number ? formatPhone(number) : "" }).trim();
}

/** The label in two parts, for a row that must never cut the number (T17 design review I-3, M-5): the words, which
 *  may truncate, and the formatted number, which keeps its width. Both languages put the number last. */
export function holdingLabelParts(number: string | null, locale: Locale): { words: string; number: string } {
  return { words: holdingLabel(null, locale), number: number ? formatPhone(number) : "" };
}
