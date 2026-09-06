import { shell, escapeHtml, button, type EmailBrand } from "./shell";

export type ReviewRequestEmailInput = {
  brand: EmailBrand;
  /** Already defaulted by the caller (the pass) — this template renders
   *  what it is given. Blank lines are paragraph breaks, as in the
   *  follow-up template. */
  body: string;
  /** Validated http(s) by parseReviewRequestConfig before it reaches here. */
  reviewUrl: string;
};

/**
 * The review request, ~two mornings after a completed job (the morning after
 * the follow-up). The follow-up's restraint — a small branded header and the
 * operator's own paragraphs — plus the ONE thing a follow-up does not have:
 * a single call to action, the review link as a button, and the same link in
 * plain text for text-only clients.
 */
export function reviewRequestEmail(input: ReviewRequestEmailInput):
  { subject: string; html: string; text: string } {
  const paragraphs = input.body
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);

  const html = shell(
    input.brand,
    paragraphs.map((p) => `<p style="margin:0 0 12px;">${escapeHtml(p)}</p>`).join("")
    + `<p style="margin:16px 0 0;">${button(input.brand, input.reviewUrl, "Leave a review")}</p>`,
  );

  // Composed from the same paragraph list, never by stripping tags.
  const text = `${paragraphs.join("\n\n")}\n\n${input.reviewUrl}`;

  return { subject: `Would you leave ${input.brand.name} a review?`, html, text };
}
