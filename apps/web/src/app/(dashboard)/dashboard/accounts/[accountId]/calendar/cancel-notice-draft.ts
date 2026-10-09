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

export function initialDraft(hasEmail: boolean): NoticeDraft {
  return { send: hasEmail, locale: "en", message: defaultFor("en") };
}

/** Switching language swaps a message the owner has not touched (or has
 *  cleared) for the new language's default, and keeps anything they wrote. */
export function withLanguage(draft: NoticeDraft, locale: PublicLocale): NoticeDraft {
  const untouched = draft.message.trim() === "" || draft.message === defaultFor(draft.locale);
  return { ...draft, locale, message: untouched ? defaultFor(locale) : draft.message };
}

/** What the server is asked for: a send only when the owner left it on AND
 *  there is an address (the server checks the address again). */
export function draftToChoice(draft: NoticeDraft, hasEmail: boolean): CancelNoticeChoice {
  return { send: hasEmail && draft.send, locale: draft.locale, message: draft.message };
}
