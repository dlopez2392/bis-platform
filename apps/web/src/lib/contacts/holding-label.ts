// S-47e (E8, spec 5.12.4, S29): the one name a shared number's holding thread shows wherever a customer's
// name would. Never "Caller".
import { m } from "@/lib/messages";
import { t } from "@/lib/i18n/t";
import type { Locale } from "@/lib/i18n/locale";
import { formatPhone } from "@/lib/document-requests/customer-state";

export function holdingLabel(number: string | null, locale: Locale): string {
  return t(m, "contact.holding.label", locale, { number: number ? formatPhone(number) : "" }).trim();
}
