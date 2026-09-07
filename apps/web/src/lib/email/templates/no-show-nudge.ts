import { proseWithButton } from "./prose-button";
import type { EmailBrand } from "./shell";

export type NoShowNudgeEmailInput = {
  brand: EmailBrand;
  /** Already defaulted by the caller (the pass). */
  body: string;
  /** The account's public booking page, `${origin}/b/${public_id}` — built
   *  by the pass from ctx.origin, never configured. */
  bookingUrl: string;
};

/**
 * The nudge the morning after a no-show: the operator's paragraphs, then
 * the booking page as the one button. Restrained on purpose — it reads as
 * "we're still here", not as a marketing blast.
 */
export function noShowNudgeEmail(input: NoShowNudgeEmailInput):
  { subject: string; html: string; text: string } {
  const { html, text } = proseWithButton(input.brand, input.body, input.bookingUrl, "Pick a new time");
  return { subject: `Want to pick a new time with ${input.brand.name}?`, html, text };
}
