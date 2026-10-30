import { emit, type JobHoldClaim, type SupabaseClient } from "@bis/db";

/**
 * F-046 part 1 (D8, extended to moves by the plan review): the events of a staff job's hold, written by the
 * settle (job-hold.ts) once its claim is won, never at insert, so an add or a move undone inside its hold
 * leaves none. An add: `booking.created`. A move's new row: that AND the old row's `booking.status_changed`
 * cancelled, the two events `moveBooking` writes for every other move and no longer writes for a staff one.
 * Actor: the person who made the job (`author_id`); a row with none is the system's.
 *
 * Its own module, not job-hold.ts: that file sends through the email gate, and consent scan 2 reads every
 * `booking.`-prefixed literal in a gate caller as an email kind. These are event types, as createBooking and
 * setBookingStatus write them in @bis/db. THROWS on a write error; the settle logs it and goes on.
 */
export async function emitJobHoldEvents(db: SupabaseClient, accountId: string, claim: JobHoldClaim): Promise<void> {
  const [actor, actorType] = claim.author_id ? [claim.author_id, "user" as const] : ["system", "system" as const];
  await emit(db, accountId, "booking.created", actor,
    { bookingId: claim.id, calendarId: claim.calendar_id, contactId: claim.contact_id }, actorType);
  if (claim.rescheduled_from_id !== null) {
    await emit(db, accountId, "booking.status_changed", actor,
      { bookingId: claim.rescheduled_from_id, status: "cancelled" }, actorType);
  }
}
