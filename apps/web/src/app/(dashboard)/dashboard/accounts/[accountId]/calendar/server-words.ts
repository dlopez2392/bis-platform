import { m, type MessageKey } from "@/lib/messages";
import { t } from "@/lib/i18n/t";
import type { Locale } from "@/lib/i18n/locale";

/**
 * T11/T12 review: the booking actions in actions.ts answer a refusal as the catalogue's ENGLISH sentence
 * (`{ ok: false, error: m[key] }`), and cancel-flow.ts names its toast the same way. A Spanish drawer toasted
 * them as they came. This reads such a sentence back to its key and says it in the drawer's language. Client
 * code: the browser loads it, so it names keys, never a server module.
 *
 * Every sentence those paths can answer is listed (server-words.test.ts pins the list against actions.ts and
 * prove-booking.ts, so a new refusal there cannot slip through in English).
 */
export const SERVER_SENTENCE_KEYS = [
  "calendar.bookings.statusUpdateFailed",
  "calendar.bookings.notStartedYet",
  "calendar.cancelDialog.messageTooLong",
  "calendar.bookings.restoreSlotTaken",
  "calendar.bookings.restoreRescheduled",
  "calendar.bookings.restoreNotOurs",
  "calendar.bookings.restoreChanged",
  "calendar.bookings.restoreCustomerTold",
  "calendar.bookings.restoreNoticeFailed",
  "calendar.bookings.restoreNoticeUnknown",
  "calendar.bookings.cancelledToast",
  "calendar.bookings.cancelledToastAddressBlocked",
] as const satisfies readonly MessageKey[];

const BY_ENGLISH = new Map<string, MessageKey>(SERVER_SENTENCE_KEYS.map((k) => [m[k], k]));

/**
 * `english`, a catalogue sentence a server action answered, in `locale`. A sentence that is not one of these is
 * said as it came in English and, in Spanish, as `fallback`'s sentence (a refusal's generic "Could not update
 * this booking"): never English in a Spanish drawer.
 */
export function inDrawerLanguage(english: string, locale: Locale, fallback: MessageKey = "calendar.bookings.statusUpdateFailed"): string {
  const key = BY_ENGLISH.get(english);
  if (key) return t(m, key, locale);
  return locale === "en" ? english : t(m, fallback, locale);
}
