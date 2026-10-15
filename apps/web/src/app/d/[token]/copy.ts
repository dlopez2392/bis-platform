import { m, type MessageKey } from "@/lib/messages";
import { t } from "@/lib/i18n/t";

/**
 * Each sentence that names the business has its own sentence for an account with NO brand name.
 * Filling {business} with a fallback word cannot be right in Spanish ("Pida a el negocio" must be
 * "Pida al negocio") and opens a sentence lower-case in both languages ("the business asks…"), so
 * the fallback is written as whole sentences in the catalogue, not interpolated (Task 9 review).
 */
const NO_NAME: Partial<Record<MessageKey, MessageKey>> = {
  "customerDocs.heading": "customerDocs.headingNoName",
  "customerDocs.intro": "customerDocs.introNoName",
  "customerDocs.why.full": "customerDocs.why.fullNoName",
  "customerDocs.why.fullNoPhone": "customerDocs.why.fullNoPhoneNoName",
  "customerDocs.done": "customerDocs.doneNoName",
  "customerDocs.ask": "customerDocs.askNoName",
  "customerDocs.call": "customerDocs.callNoName",
  "customerDocs.callNoPhone": "customerDocs.callNoPhoneNoName",
};

export type DocCopy = (key: MessageKey, params?: Record<string, string | number>) => string;

/** The page's words in `locale`. `business` is the brand name, or null when the account has none. Browser-safe. */
export function docCopy(locale: "en" | "es", business: string | null): DocCopy {
  return (key, params) => (business
    ? t(m, key, locale, { business, ...params })
    : t(m, NO_NAME[key] ?? key, locale, params));
}
