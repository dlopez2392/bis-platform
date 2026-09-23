import { shell, escapeHtml, type EmailBrand } from "./shell";
import { marketingFooter, type MarketingFooterInput } from "./marketing-footer";

export type ReferralAskEmailInput = MarketingFooterInput & {
  brand: EmailBrand;
  /** Composed by the caller with `referralAskSubject(row.brandName)`, never
   *  interpolated here: `brand.name` is `""` for an account with no brand
   *  name, and `One favor, from ${brand.name}` would then ship a subject
   *  ending in a comma and a space. */
  subject: string;
  /** Already defaulted by the caller (the pass). Blank lines are paragraph
   *  breaks, as in the follow-up template. */
  body: string;
};

/**
 * The referral ask, the morning after the review request. Deliberately the
 * FOLLOW-UP's shape and not the review request's: no button and no call to
 * action, because the action is "reply to this email with a name" and a
 * button would need somewhere to point.
 *
 * AND THE CHECK-IN'S FOOTER (B21, danlo, 2026-09-23): asking a customer to
 * send the business more business is the second MARKETING email, and it can
 * reach the same person after every job — so it carries the same "why you
 * got this, reply and we'll stop" line and the postal address, through the
 * one helper both templates share. The pass refuses to send without an
 * address or a reply-to, so the reply reaches the business.
 */
export function referralAskEmail(input: ReferralAskEmailInput):
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
