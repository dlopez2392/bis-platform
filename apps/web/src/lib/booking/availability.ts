// Extracted verbatim from b/[publicId]/actions.ts so the voice tools and the
// public booking page compute availability from ONE implementation. Any
// drift between the two would let the AI offer times the page would refuse.
import { getBusinessStatusRow, listBookedRanges, listClosedDaysFrom, serviceDb, type CalendarRow } from "@bis/db";
import {
  computeSlots, bookableRange, computeMoveSlots, movableRange, partsInZone, type Range, type SlotClosures, type SlotConfig,
} from "@/lib/booking/slots";
import { addDays, dayKey, slotClosures } from "@/lib/business-status/status";

/** S-47d spec §5.3: the account's closures, as the slot engine takes them. The business_status row and the
 *  closed days ending on or after yesterday (in the account's zone, one day of slack), read in parallel,
 *  both for THIS accountId. Hours do not matter here: a closure's window is the stored until. A failed read
 *  THROWS, exactly as a failed listBookedRanges does, so every caller's existing error path answers (S17):
 *  never a slot offered during a closure nobody could read. */
export async function readSlotClosures(
  db: ReturnType<typeof serviceDb>, accountId: string, timezone: string, now: Date,
): Promise<SlotClosures> {
  const [row, closedDays] = await Promise.all([
    getBusinessStatusRow(db, accountId),
    listClosedDaysFrom(db, accountId, addDays(dayKey(now, timezone), -1)),
  ]);
  return slotClosures({ row, closedDays, hours: null, timezone, now });
}

/** The two reads every function below judges against, started TOGETHER: the booked ranges and the
 *  account's closures. Both reject on failure. */
async function readsFor(
  db: ReturnType<typeof serviceDb>, calendar: CalendarRow, timezone: string, now: Date, excludeBookingId?: string,
): Promise<{ booked: Range[]; config: SlotConfig }> {
  const [booked, closures] = await Promise.all([
    bookedInHorizon(db, calendar, now, excludeBookingId),
    readSlotClosures(db, calendar.account_id, timezone, now),
  ]);
  return { booked, config: { ...slotConfigFrom(calendar, timezone), closures } };
}

export function slotConfigFrom(calendar: CalendarRow, timezone: string): SlotConfig {
  return {
    timezone,
    slotDurationMinutes: calendar.slot_duration_minutes,
    bufferMinutes: calendar.buffer_minutes,
    minNoticeHours: calendar.min_notice_hours,
    maxAdvanceDays: calendar.max_advance_days,
    openHours: calendar.open_hours,
  };
}

/**
 * The whole bookable horizon, freshly computed — both callers below run this
 * rather than trusting anything the client sent about what's free. `booked`
 * rows arrive as ISO strings from `listBookedRanges`; converting them to real
 * `Date`s is this module's job, not the engine's (the engine fails closed on
 * an unparseable range rather than silently ignoring it).
 */
export async function computeAllSlots(
  db: ReturnType<typeof serviceDb>, calendar: CalendarRow, timezone: string, now: Date,
): Promise<{ startsAt: Date; endsAt: Date }[]> {
  // +2 days of headroom past the horizon end so a booking near the last
  // in-horizon instant is never excluded by an off-by-one on the query window
  // itself — computeSlots is what actually enforces the horizon boundary.
  const { booked, config } = await readsFor(db, calendar, timezone, now);
  return computeSlots(config, booked, now);
}

/** The booked ranges both functions here judge against — ONE read, so the
 *  picker and the submit see the same bookings. */
async function bookedInHorizon(
  db: ReturnType<typeof serviceDb>, calendar: CalendarRow, now: Date, excludeBookingId?: string,
): Promise<Range[]> {
  const horizonEndMs = now.getTime() + (calendar.max_advance_days + 2) * 24 * 3600_000;
  const rows = await listBookedRanges(
    db, calendar.id, now.toISOString(), new Date(horizonEndMs).toISOString(), excludeBookingId);
  return rows.map((r) => ({ startsAt: new Date(r.starts_at), endsAt: new Date(r.ends_at) }));
}

/**
 * THE SUBMIT-TIME CHECK for every path that books (the public page's submit,
 * the phone receptionist's book and reschedule): the range to book at
 * `startsAt`, or null when it is not bookable now. `bookableRange` in
 * ./slots.ts is the rule; see it for why this is no longer "is it in
 * computeAllSlots' output" (D-028's review: a booking earlier in the day
 * re-anchors the later grid, and a still-free pick must not be refused).
 */
export async function bookableSlot(
  db: ReturnType<typeof serviceDb>, calendar: CalendarRow, timezone: string, now: Date, startsAt: Date,
): Promise<Range | null> {
  const { booked, config } = await readsFor(db, calendar, timezone, now);
  return bookableRange(config, booked, now, startsAt);
}

/** F-048: the booking a customer is moving — its id (left out of the busy
 *  ranges) and its CURRENT range (still held until the move commits). */
export type MovingBooking = { id: string; startsAt: Date; endsAt: Date };

/** F-048: the move page's picker — `computeAllSlots` for the day as it will
 *  be once the move commits (`computeMoveSlots` in ./slots.ts). ONE read, the
 *  same as the booking page's, minus the moving booking itself. */
export async function moveSlots(
  db: ReturnType<typeof serviceDb>, calendar: CalendarRow, timezone: string, now: Date, moving: MovingBooking,
): Promise<Range[]> {
  const { booked: others, config } = await readsFor(db, calendar, timezone, now, moving.id);
  return computeMoveSlots(config, others, moving, now);
}

/** F-048: the move's submit-time check, the twin of `bookableSlot`
 *  (`movableRange` in ./slots.ts). `moveBooking` and `bookings_no_overlap`
 *  remain the guarantee against a race past it. */
export async function movableSlot(
  db: ReturnType<typeof serviceDb>, calendar: CalendarRow, timezone: string, now: Date,
  moving: MovingBooking, startsAt: Date,
): Promise<Range | null> {
  const { booked: others, config } = await readsFor(db, calendar, timezone, now, moving.id);
  return movableRange(config, others, moving, now, startsAt);
}

/** `YYYY-MM-DD` as seen in `timezone` — the day-picker's own key format, and
 *  the same zone-conversion path (`partsInZone`) the engine itself uses, so
 *  this can never disagree with computeSlots about which day a slot falls on. */
export function dayKeyInZone(instant: Date, timezone: string): string {
  const p = partsInZone(instant, timezone);
  return `${p.y}-${String(p.m).padStart(2, "0")}-${String(p.d).padStart(2, "0")}`;
}
