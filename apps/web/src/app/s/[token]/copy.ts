import { m, type MessageKey } from "@/lib/messages";
import { t } from "@/lib/i18n/t";

/**
 * Each sentence that names the business has its own sentence for an account with NO brand name
 * (`app/d/[token]/copy.ts`'s rule: a fallback word in the {business} hole reads "a el negocio" in
 * Spanish and opens a sentence lower-case in both languages). Browser-safe.
 */
const NO_NAME: Partial<Record<MessageKey, MessageKey>> = {
  "sharePage.pageTitle": "sharePage.pageTitleNoName",
  "sharePage.heading": "sharePage.headingNoName",
  "sharePage.ask": "sharePage.askNoName",
  "customerDocs.call": "customerDocs.callNoName",
  "customerDocs.callNoPhone": "customerDocs.callNoPhoneNoName",
};

export type ShareCopy = (key: MessageKey, params?: Record<string, string | number>) => string;

/** The page's words in `locale`. `business` is the brand name, or null when the account has none. */
export function shareCopy(locale: "en" | "es", business: string | null): ShareCopy {
  return (key, params) => (business
    ? t(m, key, locale, { business, ...params })
    : t(m, NO_NAME[key] ?? key, locale, params));
}
