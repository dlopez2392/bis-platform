import { callerCanSee } from "@/lib/auth/visible";
import { m } from "@/lib/messages";

/**
 * F-085 part 1, spec §7.3: "prove the target through the request client, then
 * write through the service client". Every booking action below writes (or
 * reads) with serviceDb(), which RLS does not bind, so each first proves the
 * booking with `callerCanSee`, through the caller's OWN client: under 0068 a
 * Technician cannot see another person's customer's booking, and the proof
 * fails with no role branching here. A "no" and a proof that could not be
 * made are the same generic refusal; `action` names the caller in the log.
 * Answers null when the booking is proven.
 *
 * F-046 (plan correction 5): its own module, with no "use server" directive, so
 * both action files (actions.ts, agenda-actions.ts) share it without it becoming
 * a server action anyone could call.
 */
export async function proveBooking(
  action: string, accountId: string, bookingId: string,
): Promise<{ ok: false; error: string } | null> {
  try {
    if (await callerCanSee("bookings", accountId, bookingId)) return null;
  } catch (e) {
    console.error(`${action}: booking ${bookingId} could not be proven (account ${accountId}): ${String(e)}`);
  }
  return { ok: false, error: m["calendar.bookings.statusUpdateFailed"] };
}
