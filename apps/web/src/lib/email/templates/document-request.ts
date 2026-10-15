import { m } from "@/lib/messages";
import { t } from "@/lib/i18n/t";
import { proseWithButton } from "./prose-button";
import type { EmailBrand } from "./shell";

/** A document request by email (spec 4.2): one language end to end (subject, body, button), the client's brand. */
export function documentRequestEmail(a: { brand: EmailBrand; business: string; items: string; url: string; locale: "en" | "es" }): { subject: string; html: string; text: string } {
  const body = t(m, "documentRequest.email.body", a.locale, { items: a.items });
  // proseWithButton's text part already ends with the bare link (prose-button.ts), so nothing is appended here.
  const { html, text } = proseWithButton(a.brand, body, a.url, t(m, "documentRequest.email.button", a.locale));
  return { subject: t(m, "documentRequest.email.subject", a.locale, { business: a.business }), html, text };
}
