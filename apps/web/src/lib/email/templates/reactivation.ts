import { shell, escapeHtml, type EmailBrand } from "./shell";
import { marketingFooter, type MarketingFooterInput } from "./marketing-footer";

export type ReactivationEmailInput = MarketingFooterInput & {
  brand: EmailBrand;
  /** Composed by the caller with `reactivationSubject(row.brandName)`, never
   *  interpolated here: `brand.name` is `""` for an account with no brand
   *  name, and `A note from ${brand.name}` would then ship a subject ending
   *  in "from ". */
  subject: string;
  /** Already defaulted by the caller (the pass). Blank lines are paragraph
   *  breaks, as in the follow-up template. */
  body: string;
};

/**
 * The check-in to a past customer. The FOLLOW-UP's restraint, not the review
 * request's: no button, because the action is "reply to this email", and a
 * button would need somewhere to point. A short personal note from a business
 * they know, not a campaign.
 *
 * AND A FOOTER (decision A, danlo, 2026-09-22), which the follow-up does not
 * carry: this is the one recipe that emails someone who did not just
 * interact with the business, and its purpose is winning work back —
 * commercial email, which under CAN-SPAM (the orchestrator's reading, not a
 * lawyer's) needs a working opt-out and the sender's physical postal
 * address. The opt-out is a REPLY, not a link, so the no-link restraint
 * above survives it: the pass also refuses to send without a reply-to, so a
 * reply reaches the business and not the agency's `EMAIL_FROM` mailbox.
 * The footer itself is `marketingFooter`, shared with the referral ask (B21).
 */
export function reactivationEmail(input: ReactivationEmailInput):
  { subject: string; html: string; text: string } {
  const paragraphs = input.body
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);
  const footer = marketingFooter(input);
  const html = shell(
    input.brand,
    paragraphs.map((p) => `<p style="margin:0 0 12px;">${escapeHtml(p)}</p>`).join("") + footer.html,
  );
  return {
    subject: input.subject,
    html,
    text: [...paragraphs, footer.text].join("\n\n"),
  };
}
