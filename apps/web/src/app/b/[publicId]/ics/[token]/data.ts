import { serviceDb, rescheduleChain, getBranding, brandDisplayName, type BookingStatus } from "@bis/db";
import type { CalendarFileInput } from "@/lib/booking/calendar-file";

const COLS = "id, account_id, calendar_id, status, cancel_token, starts_at, ends_at, meeting_url";

type Row = CalendarFileInput["booking"] & { account_id: string; calendar_id: string; status: BookingStatus };

/**
 * Everything the add-to-calendar file needs, read by the TOKEN and then by
 * the row it names, never by anything else in the URL: the cancel link inside
 * the file is built on the booking's own calendar's public id, and the brand
 * and zone are the booking's own account's (the same rule the cancel action
 * keeps for its notify list). A GET, and only reads: a mail scanner that
 * prefetches the link changes nothing.
 *
 * `null` for an unknown token or a booking that is not live, before the
 * chain or the brand are read. THROWS on a read error (the route answers 500).
 */
export async function loadCalendarFileInput(
  token: string,
): Promise<Omit<CalendarFileInput, "locale" | "origin" | "now"> | null> {
  const db = serviceDb();
  const { data, error } = await db.from("bookings").select(COLS).eq("cancel_token", token).maybeSingle();
  if (error) throw new Error(`calendar file: booking read failed: ${error.message}`);
  const booking = data as Row | null;
  if (!booking || booking.status !== "booked") return null;

  const { data: cal, error: calErr } = await db.from("calendars").select("public_id")
    .eq("id", booking.calendar_id).maybeSingle();
  if (calErr) throw new Error(`calendar file: calendar read failed: ${calErr.message}`);
  if (!cal) return null;

  const { data: account, error: accErr } = await db.from("accounts").select("timezone")
    .eq("id", booking.account_id).maybeSingle();
  if (accErr) throw new Error(`calendar file: account read failed: ${accErr.message}`);

  const [chain, branding] = await Promise.all([
    rescheduleChain(db, booking.account_id, booking.id),
    getBranding(db, booking.account_id),
  ]);

  return {
    booking,
    chain,
    publicId: (cal as { public_id: string }).public_id,
    brandName: brandDisplayName(branding),
    accountZone: (account as { timezone: string | null } | null)?.timezone ?? "UTC",
  };
}
