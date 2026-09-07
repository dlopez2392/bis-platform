import { proseWithButton } from "./prose-button";
import type { EmailBrand } from "./shell";

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
  const { html, text } = proseWithButton(input.brand, input.body, input.reviewUrl, "Leave a review");
  return { subject: `Would you leave ${input.brand.name} a review?`, html, text };
}
