import { bookingStrings } from "@/lib/booking/public-strings";
import type { PublicLocale } from "@/lib/forms/public-strings";
import type { CancelNoticeChoice } from "./actions";

/**
 * F-048: the Cancel dialog's notice, minus React. The message is
 * customer-facing copy, so its default comes from the bilingual public
 * strings (`bookingStrings`), in whichever language the owner picks; there is
 * no record of a customer's language on a booking, so the owner, who knows
 * the customer, chooses.
 */
export type NoticeDraft = { send: boolean; locale: PublicLocale; message: string };

const defaultFor = (locale: PublicLocale) => bookingStrings(locale).cancelNoticeDefault;

/** The dialog opens only when a notice can go (`cancelStep`), so it starts on. */
export function initialDraft(): NoticeDraft {
  return { send: true, locale: "en", message: defaultFor("en") };
}

/** Switching language swaps a message the owner has not touched (or has
 *  cleared) for the new language's default, and keeps anything they wrote. */
export function withLanguage(draft: NoticeDraft, locale: PublicLocale): NoticeDraft {
  const untouched = draft.message.trim() === "" || draft.message === defaultFor(draft.locale);
  return { ...draft, locale, message: untouched ? defaultFor(locale) : draft.message };
}

/** What the server is asked for; it checks again whether the notice can go. */
export function draftToChoice(draft: NoticeDraft): CancelNoticeChoice {
  return { send: draft.send, locale: draft.locale, message: draft.message };
}
