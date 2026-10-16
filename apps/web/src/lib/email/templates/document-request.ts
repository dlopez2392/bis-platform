import { m, type MessageKey } from "@/lib/messages";
import { t } from "@/lib/i18n/t";
import { proseWithButton } from "./prose-button";
import type { EmailBrand } from "./shell";

/**
 * Each document-request sentence that names the business has its own sentence for an account with NO
 * brand name, the shape of the customer page's copy (app/d/[token]/copy.ts). Filling {business} with a
 * fallback word opens the text lower-case ("el negocio: por favor…") and makes a subject out of a common
 * noun ("the business needs a few documents"), so the fallback is whole sentences in the catalogue.
 */
const NO_NAME: Partial<Record<MessageKey, MessageKey>> = {
  "documentRequest.sms": "documentRequest.smsNoName",
  "documentRequest.email.subject": "documentRequest.email.subjectNoName",
};

export type RequestCopy = (key: MessageKey, params?: Record<string, string | number>) => string;

/** A request's words in `locale`. `business` is the brand name; null or blank when the account has none. */
export function requestCopy(locale: "en" | "es", business: string | null): RequestCopy {
  const name = business?.trim() || null;
  return (key, params) => (name
    ? t(m, key, locale, { business: name, ...params })
    : t(m, NO_NAME[key] ?? key, locale, params));
}

/** A document request by email (spec 4.2): one language end to end (subject, body, button), the client's brand. */
export function documentRequestEmail(a: { brand: EmailBrand; business: string; items: string; url: string; locale: "en" | "es" }): { subject: string; html: string; text: string } {
  const say = requestCopy(a.locale, a.business);
  const body = say("documentRequest.email.body", { items: a.items });
  // proseWithButton's text part already ends with the bare link (prose-button.ts), so nothing is appended here.
  const { html, text } = proseWithButton(a.brand, body, a.url, say("documentRequest.email.button"));
  return { subject: say("documentRequest.email.subject"), html, text };
}
