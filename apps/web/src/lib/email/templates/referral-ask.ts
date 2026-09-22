import { shell, escapeHtml, type EmailBrand } from "./shell";

export type ReferralAskEmailInput = {
  brand: EmailBrand;
  /** Composed by the caller with `referralAskSubject(row.brandName)`, never
   *  interpolated here: `brand.name` is `""` for an account with no brand
   *  name, and `One favour, from ${brand.name}` would then ship a subject
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
 * button would need somewhere to point. A short personal note, not marketing.
 */
export function referralAskEmail(input: ReferralAskEmailInput):
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
