import { cache } from "react";
import { serviceDb, getCalendarForAccount, type BookingRow, type Branding, type CalendarRow } from "@bis/db";
import { scrubToken } from "@/lib/booking/links";
import { lookupBookingByToken } from "../../cancel/[token]/data";

/**
 * F-048: everything the move page and its two actions need, read by the
 * TOKEN and then by the row it names, never by anything else in the URL — the
 * same rule the cancel action and the calendar file keep. The calendar is the
 * booking's account's own (one per account, `calendars_one_per_account`), and
 * it must BE the booking's calendar: a row pointing anywhere else is a data
 * defect, and nothing here acts on it.
 *
 * A pure read (the token lookup is the cancel page's own SELECT), so a mail
 * scanner that prefetches the link changes nothing. `null` for an unknown
 * token. THROWS on a read error.
 */
export type MoveAccount = {
  timezone: string | null;
  from_email: string | null; reply_to_email: string | null;
  brand_name: string | null; brand_logo_path: string | null; brand_color: string | null;
  brand_neutral: Branding["brandNeutral"]; brand_corners: Branding["brandCorners"];
  brand_type: Branding["brandType"]; brand_mode: Branding["brandMode"];
};

export type MoveContext = {
  row: Pick<BookingRow,
    "id" | "account_id" | "calendar_id" | "contact_id" | "starts_at" | "ends_at" | "status" | "booker_timezone">;
  calendar: CalendarRow;
  account: MoveAccount;
};

const ACCOUNT_COLS = "timezone, from_email, reply_to_email, brand_name, brand_logo_path, "
  + "brand_color, brand_neutral, brand_corners, brand_type, brand_mode";

const NO_ACCOUNT: MoveAccount = {
  timezone: null, from_email: null, reply_to_email: null,
  brand_name: null, brand_logo_path: null, brand_color: null,
  brand_neutral: null, brand_corners: null, brand_type: null, brand_mode: null,
};

export async function readMoveContext(
  db: ReturnType<typeof serviceDb>, token: string,
): Promise<MoveContext | null> {
  const row = await lookupBookingByToken(db, token);
  if (!row) return null;
  const calendar = await getCalendarForAccount(db, row.account_id);
  if (!calendar || calendar.id !== row.calendar_id) return null;
  const { data, error } = await db.from("accounts").select(ACCOUNT_COLS).eq("id", row.account_id).maybeSingle();
  if (error) throw new Error(`move: account read failed for ${row.account_id}: ${error.message}`);
  return { row, calendar, account: (data as MoveAccount | null) ?? NO_ACCOUNT };
}

/**
 * What a move link can do right now. `cancelled` (the page tells a move from
 * a plain cancel with `bookingWasMoved`); `past` for an outcome, or a booking
 * that has started — still `booked`, but there is nothing left to move;
 * `offline` when the business has switched online booking off, which stops a
 * move as it stops a new booking (a cancel is never stopped by it). Pure.
 */
export type MoveState = "live" | "cancelled" | "past" | "offline";

export function moveState(ctx: Pick<MoveContext, "row" | "calendar">, now: Date): MoveState {
  const { row, calendar } = ctx;
  if (row.status === "cancelled") return "cancelled";
  if (row.status !== "booked") return "past";
  const start = new Date(row.starts_at).getTime();
  if (!Number.isFinite(start) || start <= now.getTime()) return "past";
  if (!calendar.enabled) return "offline";
  return "live";
}

/**
 * Fix round 1 (I3): how many times one appointment may be moved from its link
 * (its `rescheduleChain` depth, the receptionist's moves included). Every move
 * hands back a NEW token, so without a bound one link could chain moves
 * forever, each emailing the business and the customer; the booking page's
 * per-IP limit catches a burst from one address, and this catches the chain
 * whatever address it comes from. Lifetime, not per day: no real customer
 * moves one appointment ten times, and past that the honest answer is the
 * one a switched-off calendar gets, to contact the business.
 */
export const MOVE_CHAIN_MAX = 10;

/** The booking being moved, in the shape the move engine takes. */
export function movingOf(row: MoveContext["row"]): { id: string; startsAt: Date; endsAt: Date } {
  return { id: row.id, startsAt: new Date(row.starts_at), endsAt: new Date(row.ends_at) };
}

/** One cached read per request, shared by the page, its `generateMetadata`
 *  and the segment layout (the cancel page's pattern). */
export const loadMoveContext = cache((token: string) => readMoveContext(serviceDb(), token));

/** For the callers with no `error.tsx` to land in (`generateMetadata`, the
 *  layout). Logs the failure, NEVER the token. */
export async function loadMoveContextSafe(token: string): Promise<MoveContext | null> {
  try {
    return await loadMoveContext(token);
  } catch (e) {
    console.error(`move page: booking read failed: ${scrubToken(e, token)}`);
    return null;
  }
}

export { scrubToken };
