import { proseWithButton } from "./prose-button";
import type { EmailBrand } from "./shell";
import { m } from "@/lib/messages";
import { t } from "@/lib/i18n/t";
import type { PublicLocale } from "@/lib/forms/public-strings";

export type ReviewRequestEmailInput = {
  brand: EmailBrand;
  /** Already defaulted by the caller (the pass) — this template renders
   *  what it is given. Blank lines are paragraph breaks, as in the
   *  follow-up template. */
  body: string;
  /** Validated http(s) by parseReviewRequestConfig before it reaches here. */
  reviewUrl: string;
  /** S-09 PR 2: the customer's language. English by default. */
  locale?: PublicLocale;
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
  const locale = input.locale ?? "en";
  const { html, text } = proseWithButton(input.brand, input.body, input.reviewUrl, t(m, "email.review.button", locale));
  return { subject: t(m, "email.review.subject", locale, { name: input.brand.name }), html, text };
}
