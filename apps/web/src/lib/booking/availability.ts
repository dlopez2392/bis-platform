// Extracted verbatim from b/[publicId]/actions.ts so the voice tools and the
// public booking page compute availability from ONE implementation. Any
// drift between the two would let the AI offer times the page would refuse.
import { listBookedRanges, serviceDb, type CalendarRow } from "@bis/db";
import { computeSlots, bookableRange, partsInZone, type Range, type SlotConfig } from "@/lib/booking/slots";

function slotConfigFrom(calendar: CalendarRow, timezone: string): SlotConfig {
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
  return computeSlots(slotConfigFrom(calendar, timezone), await bookedInHorizon(db, calendar, now), now);
}

/** The booked ranges both functions here judge against — ONE read, so the
 *  picker and the submit see the same bookings. */
async function bookedInHorizon(
  db: ReturnType<typeof serviceDb>, calendar: CalendarRow, now: Date,
): Promise<Range[]> {
  const horizonEndMs = now.getTime() + (calendar.max_advance_days + 2) * 24 * 3600_000;
  const rows = await listBookedRanges(db, calendar.id, now.toISOString(), new Date(horizonEndMs).toISOString());
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
  return bookableRange(slotConfigFrom(calendar, timezone), await bookedInHorizon(db, calendar, now), now, startsAt);
}

/** `YYYY-MM-DD` as seen in `timezone` — the day-picker's own key format, and
 *  the same zone-conversion path (`partsInZone`) the engine itself uses, so
 *  this can never disagree with computeSlots about which day a slot falls on. */
export function dayKeyInZone(instant: Date, timezone: string): string {
  const p = partsInZone(instant, timezone);
  return `${p.y}-${String(p.m).padStart(2, "0")}-${String(p.d).padStart(2, "0")}`;
}
