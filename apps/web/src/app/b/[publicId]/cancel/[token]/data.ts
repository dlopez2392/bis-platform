import { cache } from "react";
import { serviceDb, type BookingRow } from "@bis/db";
import { scrubToken } from "@/lib/booking/links";

const BOOKING_COLS =
  "id, account_id, calendar_id, contact_id, starts_at, ends_at, status, note, "
  + "cancel_token, booker_timezone, reminder_sent_at";

/**
 * Read-only lookup by token — a plain SELECT, no `.update()` anywhere in this
 * function. This is the accessor that lets `page.tsx` distinguish "never
 * existed" from "already cancelled" from "booked" from "already happened" on
 * a GET, without touching a row: `cancelBookingByToken` collapses the first
 * two into a single `null`, which is exactly right for ITS job (idempotent
 * cancel) and exactly wrong for a page that needs to render four states.
 *
 * Here, not in the "use server" `actions.ts` it started in: every runtime
 * export of that module is a server action a browser can POST to, and a
 * row-by-token read is a page helper, not an action (D-109 review).
 */
export async function lookupBookingByToken(
  db: ReturnType<typeof serviceDb>, token: string,
): Promise<BookingRow | null> {
  const { data, error } = await db.from("bookings")
    .select(BOOKING_COLS).eq("cancel_token", token).maybeSingle();
  if (error) throw new Error(`lookupBookingByToken failed: ${error.message}`);
  return (data as unknown as BookingRow | null) ?? null;
}

/**
 * Shared by `page.tsx` (component and `generateMetadata`) and `layout.tsx`:
 * one function reference, so React's `cache()` dedupes the token lookup to
 * ONE query per request across all three. The layout asking for the same row
 * is what lets it brand a dead end at no cost to a working link (D-109).
 */
export const loadBooking = cache((token: string) => lookupBookingByToken(serviceDb(), token));

/**
 * For the callers with no `error.tsx` to land in: `generateMetadata`, and the
 * layout, which sits ABOVE nothing that could catch it. Only the page
 * component's own `loadBooking` is allowed to throw (it reaches
 * `app/b/error.tsx`).
 */
export async function loadBookingSafe(token: string): ReturnType<typeof loadBooking> {
  try {
    return await loadBooking(token);
  } catch (e) {
    // Never the token (fix round 1, m3): it cancels and moves this booking.
    console.error(`cancel page: booking read failed: ${scrubToken(e, token)}`);
    return null;
  }
}
