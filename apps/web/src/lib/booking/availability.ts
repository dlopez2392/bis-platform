// Extracted verbatim from b/[publicId]/actions.ts so the voice tools and the
// public booking page compute availability from ONE implementation. Any
// drift between the two would let the AI offer times the page would refuse.
import { getBusinessStatusRow, listBookedRanges, listClosedDaysFrom, serviceDb, type CalendarRow } from "@bis/db";
import {
  computeSlots, bookableRange, computeMoveSlots, movableRange, partsInZone, type Range, type SlotClosures, type SlotConfig,
} from "@/lib/booking/slots";
import { addDays, dayKey, slotClosures } from "@/lib/business-status/status";
import { readGoogleBusy, type GoogleBusyDeps } from "./google-busy";

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

/** What every function below may be handed for the Google leg (./google-busy.ts): the transport, the env, a
 *  clock, and where to run the work that must not delay the answer (the page passes next/server's `after`). */
export type AvailabilityDeps = GoogleBusyDeps;

/**
 * The reads every function below judges against, started TOGETHER: the booked ranges, the account's closures
 * and (S-22 PR 4, D10, D13) the owner's busy time on Google for `day`. The first two reject on failure; the
 * Google leg never does and answers inside its 1,500 ms budget, so a caller waits max(database, Google).
 * A `checked` Google answer is merged into `booked`, so the engine applies the same two-sided buffer, re-anchor
 * and picker/submit invariant to it as to a booking. Any other outcome merges nothing (owner answer Q1).
 * `day` null (an instant that is not one) asks Google nothing.
 */
async function readsFor(
  db: ReturnType<typeof serviceDb>, calendar: CalendarRow, timezone: string, now: Date,
  google: { day: string | null; fresh: boolean; deps?: AvailabilityDeps }, excludeBookingId?: string,
): Promise<{ booked: Range[]; config: SlotConfig }> {
  const [booked, closures, onGoogle] = await Promise.all([
    bookedInHorizon(db, calendar, now, excludeBookingId),
    readSlotClosures(db, calendar.account_id, timezone, now),
    google.day === null
      ? null
      : readGoogleBusy(db, calendar.account_id, google.day, { fresh: google.fresh }, google.deps),
  ]);
  const busy = onGoogle?.outcome === "checked" ? onGoogle.busy : [];
  return { booked: busy.length ? [...booked, ...busy] : booked, config: { ...slotConfigFrom(calendar, timezone), closures } };
}

/** The day Google is asked about, or null when no slot can fall on it: before today or past the horizon (one
 *  day of slack each side), so a request for a far-off day costs no Google quota (A6). */
function googleDay(day: string, calendar: CalendarRow, timezone: string, now: Date): string | null {
  let today: string;
  try { today = dayKeyInZone(now, timezone); } catch { return null; } // an invalid zone: the engine offers nothing anyway
  return day >= addDays(today, -1) && day <= addDays(today, calendar.max_advance_days + 1) ? day : null;
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
 * The free slots on ONE account-zone day (`YYYY-MM-DD`), freshly computed (D14: every caller asks for a day;
 * the whole-horizon reader is gone, so Google is asked about a day, never the horizon). The engine still walks
 * its whole horizon, so notice and horizon are enforced exactly as before, and the day is kept by the same
 * `dayKeyInZone` the callers used. `booked` rows arrive as ISO strings from `listBookedRanges`; converting
 * them to real `Date`s is this module's job, not the engine's (the engine fails closed on an unparseable range
 * rather than silently ignoring it). The picker's Google read goes through the 60-second memo (D9).
 */
export async function computeDaySlots(
  db: ReturnType<typeof serviceDb>, calendar: CalendarRow, timezone: string, now: Date, day: string,
  deps?: AvailabilityDeps,
): Promise<Range[]> {
  const { booked, config } = await readsFor(db, calendar, timezone, now,
    { day: googleDay(day, calendar, timezone, now), fresh: false, deps });
  return computeSlots(config, booked, now).filter((s) => dayKeyInZone(s.startsAt, timezone) === day);
}

/** The account-zone day an instant falls on, or null for an instant that is not one. */
function dayOf(startsAt: Date, calendar: CalendarRow, timezone: string, now: Date): string | null {
  if (!Number.isFinite(startsAt.getTime())) return null;
  try { return googleDay(dayKeyInZone(startsAt, timezone), calendar, timezone, now); } catch { return null; }
}

/** The booked ranges both functions here judge against — ONE read, so the
 *  picker and the submit see the same bookings. +2 days of headroom past the
 *  horizon end so a booking near the last in-horizon instant is never
 *  excluded by an off-by-one on the query window itself — computeSlots is
 *  what actually enforces the horizon boundary. */
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
 * the picker's output" (D-028's review: a booking earlier in the day
 * re-anchors the later grid, and a still-free pick must not be refused).
 * Google is asked AFRESH, never through the picker's memo (D9): a time taken
 * on Google since the picker loaded is refused, as a BIS booking is.
 */
export async function bookableSlot(
  db: ReturnType<typeof serviceDb>, calendar: CalendarRow, timezone: string, now: Date, startsAt: Date,
  deps?: AvailabilityDeps,
): Promise<Range | null> {
  const { booked, config } = await readsFor(db, calendar, timezone, now,
    { day: dayOf(startsAt, calendar, timezone, now), fresh: true, deps });
  return bookableRange(config, booked, now, startsAt);
}

/** F-048: the booking a customer is moving — its id (left out of the busy
 *  ranges) and its CURRENT range (still held until the move commits). */
export type MovingBooking = { id: string; startsAt: Date; endsAt: Date };

/** F-048: the move page's picker — `computeDaySlots` for the day as it will
 *  be once the move commits (`computeMoveSlots` in ./slots.ts). ONE read, the
 *  same as the booking page's, minus the moving booking itself. */
export async function moveSlots(
  db: ReturnType<typeof serviceDb>, calendar: CalendarRow, timezone: string, now: Date, moving: MovingBooking,
  day: string, deps?: AvailabilityDeps,
): Promise<Range[]> {
  const { booked: others, config } = await readsFor(db, calendar, timezone, now,
    { day: googleDay(day, calendar, timezone, now), fresh: false, deps }, moving.id);
  return computeMoveSlots(config, others, moving, now).filter((s) => dayKeyInZone(s.startsAt, timezone) === day);
}

/** F-048: the move's submit-time check, the twin of `bookableSlot`
 *  (`movableRange` in ./slots.ts), Google asked afresh as there. `moveBooking`
 *  and `bookings_no_overlap` remain the guarantee against a race past it. */
export async function movableSlot(
  db: ReturnType<typeof serviceDb>, calendar: CalendarRow, timezone: string, now: Date,
  moving: MovingBooking, startsAt: Date, deps?: AvailabilityDeps,
): Promise<Range | null> {
  const { booked: others, config } = await readsFor(db, calendar, timezone, now,
    { day: dayOf(startsAt, calendar, timezone, now), fresh: true, deps }, moving.id);
  return movableRange(config, others, moving, now, startsAt);
}

/** `YYYY-MM-DD` as seen in `timezone` — the day-picker's own key format, and
 *  the same zone-conversion path (`partsInZone`) the engine itself uses, so
 *  this can never disagree with computeSlots about which day a slot falls on. */
export function dayKeyInZone(instant: Date, timezone: string): string {
  const p = partsInZone(instant, timezone);
  return `${p.y}-${String(p.m).padStart(2, "0")}-${String(p.d).padStart(2, "0")}`;
}
