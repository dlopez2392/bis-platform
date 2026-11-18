import { proseWithButton } from "./prose-button";
import type { EmailBrand } from "./shell";
import { m } from "@/lib/messages";
import { t } from "@/lib/i18n/t";
import type { PublicLocale } from "@/lib/forms/public-strings";

export type ReviewCheckinEmailInput = {
  /** `brand.name` is the brand display name (the due row's `brandName`), never `accounts.name`. */
  brand: EmailBrand;
  /** The sealed `/r/<token>` link (checkin/token.ts `checkinLink`): the email's ONE link, in both parts. */
  checkinUrl: string;
  /** The customer's language, subject through button. English by default. */
  locale?: PublicLocale;
};

/**
 * The after-the-job check-in (F-072, plan D6), two hours after the job is marked completed. ONE question and ONE
 * button that opens the page where the three answers are; nothing here mentions a review, so the check-in is never a
 * filter in front of one (the page shows the review link to everyone after any answer). The words are ours, fixed
 * and bilingual: an agency-typed paragraph is exactly the gating this exists to remove. The logo, the brand colour,
 * the unsubscribe footer, the headers and the mailing address come from the shell and the email gate, not from here.
 */
export function reviewCheckinEmail(input: ReviewCheckinEmailInput): { subject: string; html: string; text: string } {
  const locale = input.locale ?? "en";
  const name = input.brand.name;
  const { html, text } = proseWithButton(
    input.brand, t(m, "email.checkin.body", locale, { name }), input.checkinUrl, t(m, "email.checkin.button", locale),
  );
  return { subject: t(m, "email.checkin.subject", locale, { name }), html, text };
}
