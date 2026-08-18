import { shell, escapeHtml, type EmailBrand } from "./shell";

/**
 * The message a client sends one of their own contacts.
 *
 * Deliberately restrained: the operator's text under a small brand header, and
 * nothing else. A heavily branded 1:1 email from a contractor to a customer
 * reads as marketing, which costs both trust and inbox placement — so there is
 * no button, no footer and no campaign chrome here, and that is a decision
 * rather than an omission.
 *
 * The text part is the typed body byte-for-byte. It is never derived from the
 * html, because the operator wrote it and nothing here has any business
 * rewording it.
 */
export function outboundEmail(input: { brand: EmailBrand; body: string }):
  { html: string; text: string } {
  const paragraphs = escapeHtml(input.body).replace(/\n/g, "<br />");
  return {
    html: shell(input.brand, `<div>${paragraphs}</div>`),
    text: input.body,
  };
}
