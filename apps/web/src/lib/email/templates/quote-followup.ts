import { shell, escapeHtml, type EmailBrand } from "./shell";

export type QuoteFollowupEmailInput = {
  brand: EmailBrand;
  /** Composed by the caller with `quoteFollowupSubject(row.brandName)`, never
   *  interpolated here: `brand.name` is `""` for an account with no brand
   *  name, and `About your quote from ${brand.name}` would then ship a
   *  subject ending in "from " with nothing after it. */
  subject: string;
  /** Already defaulted by the caller (the pass). Blank lines are paragraph
   *  breaks, as in the follow-up template. */
  body: string;
};

/**
 * The quote check-in. The FOLLOW-UP's shape and not the review request's: no
 * button and no call to action, because the action is "reply to this email"
 * and a button would need somewhere to point — the quote itself is a document
 * the operator already sent, and this app never held a copy of it.
 *
 * Nothing here interpolates a price or the deal's own name; the caller's
 * `body` is the whole message.
 */
export function quoteFollowupEmail(input: QuoteFollowupEmailInput):
  { subject: string; html: string; text: string } {
  const paragraphs = input.body
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);
  const html = shell(
    input.brand,
    paragraphs.map((p) => `<p style="margin:0 0 12px;">${escapeHtml(p)}</p>`).join(""),
  );
  return {
    subject: input.subject,
    html,
    text: paragraphs.join("\n\n"),
  };
}
