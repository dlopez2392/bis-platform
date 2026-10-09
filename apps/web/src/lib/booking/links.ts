import type { PublicLocale } from "@/lib/forms/public-strings";

/**
 * F-048: the customer's own links to their booking, built in ONE place. The
 * cancel token is the capability for all of them (cancel, move, the calendar
 * file beside them in ./calendar-file.ts); a link carries `?locale=es` for a
 * Spanish customer, so the page it opens speaks their language, and none
 * exists without an origin ("" is the empty-means-omit shape every template
 * and the success screens already honour).
 */

function withLocale(url: string, locale: PublicLocale): string {
  return locale === "es" ? `${url}?locale=es` : url;
}

/** `/b/<publicId>/move/<token>`: pick a new time for this booking. */
export function bookingMoveUrl(
  origin: string | null, publicId: string, cancelToken: string, locale: PublicLocale,
): string {
  return origin ? withLocale(`${origin}/b/${publicId}/move/${cancelToken}`, locale) : "";
}

/** `/b/<publicId>/cancel/<token>`: the page every email has always linked. */
export function bookingCancelUrl(
  origin: string | null, publicId: string, cancelToken: string, locale: PublicLocale,
): string {
  return origin ? withLocale(`${origin}/b/${publicId}/cancel/${cancelToken}`, locale) : "";
}

/** `newCancelToken`'s shape: 24 characters of `ALPHABET` (packages/db
 *  forms.ts). Anything else cannot be a token and is refused before any read
 *  — and so never reaches a query or a log line. */
const TOKEN_RE = /^[a-km-np-z2-9]{24}$/;

export function isBookingToken(value: string): boolean {
  return TOKEN_RE.test(value);
}
