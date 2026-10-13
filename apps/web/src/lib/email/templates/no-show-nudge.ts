import { proseWithButton } from "./prose-button";
import type { EmailBrand } from "./shell";
import { m } from "@/lib/messages";
import { t } from "@/lib/i18n/t";
import type { PublicLocale } from "@/lib/forms/public-strings";

export type NoShowNudgeEmailInput = {
  brand: EmailBrand;
  /** Already defaulted by the caller (the pass). */
  body: string;
  /** The account's public booking page, `${origin}/b/${public_id}` — built
   *  by the pass from ctx.origin, never configured. */
  bookingUrl: string;
  /** S-09 PR 2: the customer's language. English by default. */
  locale?: PublicLocale;
};

/**
 * The nudge the morning after a no-show: the operator's paragraphs, then
 * the booking page as the one button. Restrained on purpose — it reads as
 * "we're still here", not as a marketing blast.
 */
export function noShowNudgeEmail(input: NoShowNudgeEmailInput):
  { subject: string; html: string; text: string } {
  const locale = input.locale ?? "en";
  const { html, text } = proseWithButton(input.brand, input.body, input.bookingUrl, t(m, "email.noShow.button", locale));
  return { subject: t(m, "email.noShow.subject", locale, { name: input.brand.name }), html, text };
}
