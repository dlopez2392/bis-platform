import type { BookingStatus } from "@bis/db";
import type { PublicLocale } from "@/lib/forms/public-strings";
import { bookingStrings } from "./public-strings";
import { bookingIcs, bookingUid } from "./ics";
import { formatWhen, safeZone } from "./time";

/**
 * F-048: what one booking's add-to-calendar file says. Pure — the route
 * (`app/b/[publicId]/ics/[token]/route.ts`) does every read and hands the
 * rows in; `ics.ts` writes the format.
 *
 * Only a LIVE booking gets a file (`null` otherwise): an old link must never
 * put a cancelled appointment back on anyone's phone.
 */
export type CalendarFileInput = {
  booking: {
    id: string; status: BookingStatus; cancel_token: string;
    starts_at: string; ends_at: string; meeting_url: string | null;
  };
  /** `rescheduleChain`'s answer for this booking. */
  chain: { rootId: string; depth: number };
  /** The booking's OWN calendar's public id, read from the row, never the URL. */
  publicId: string;
  /** `brandDisplayName`; "" when the business set none. */
  brandName: string;
  accountZone: string;
  locale: PublicLocale;
  origin: string | null;
  now: Date;
};

export function calendarFileFor(input: CalendarFileInput): string | null {
  const { booking } = input;
  if (booking.status !== "booked") return null;
  const startsAt = new Date(booking.starts_at);
  const endsAt = new Date(booking.ends_at);
  if (!Number.isFinite(startsAt.getTime()) || !Number.isFinite(endsAt.getTime())) return null;

  const s = bookingStrings(input.locale);
  const zone = safeZone(input.accountZone, "UTC");
  const cancelUrl = input.origin
    ? `${input.origin}/b/${input.publicId}/cancel/${booking.cancel_token}${input.locale === "es" ? "?locale=es" : ""}`
    : "";

  const description = [
    s.calendarForUs.replace("{when}", formatWhen(startsAt, zone, input.locale)),
    ...(booking.meeting_url ? ["", `${s.calendarJoin}: ${booking.meeting_url}`] : []),
    ...(cancelUrl ? ["", `${s.calendarCancel}: ${cancelUrl}`] : []),
  ].join("\n");

  return bookingIcs({
    uid: bookingUid(input.chain.rootId),
    sequence: input.chain.depth,
    startsAt, endsAt,
    stampedAt: input.now,
    summary: input.brandName
      ? s.calendarTitleWithBrand.replace("{business}", input.brandName)
      : s.calendarTitleNoBrand,
    description,
  });
}

/** Where a booking's file is downloaded from: the confirmation email and the
 *  success screen both link here. "" without an origin, the same
 *  empty-means-omit shape `cancelUrl` uses. */
export function calendarFileUrl(
  origin: string | null, publicId: string, cancelToken: string, locale: PublicLocale,
): string {
  if (!origin) return "";
  return `${origin}/b/${publicId}/ics/${cancelToken}${locale === "es" ? "?locale=es" : ""}`;
}
