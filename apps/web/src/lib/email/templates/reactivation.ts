import { shell, escapeHtml, type EmailBrand } from "./shell";

export type ReactivationEmailInput = {
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
 */
export function reactivationEmail(input: ReactivationEmailInput):
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
