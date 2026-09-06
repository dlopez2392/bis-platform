// Per-call state lives in ONE invocation and dies with it — no store, no
// migrations. The mirroring rule is the demo's BUG-5 lesson: any tool that
// changes external state must reflect it here, or classification and the
// recorded row silently lie.
import type { CallOutcome, TranscriptEvent } from "@bis/db";

export type MirroredBooking = {
  id: string; contactName: string; startsAt: string; endsAt: string;
  status?: "booked" | "cancelled";
};
export type CapturedLead = { fields: Record<string, string> };
export type TakenMessage = { body: string; callbackNumber?: string; at: string };

/**
 * A tool outcome that means the receptionist actually DID something for this
 * caller, even though the call ends with no booking, lead or message of its
 * own — i.e. the cases `classifyOutcome` scores `abandoned` but a human would
 * call "served".
 *
 * Recorded separately from `bookings`/`leads`/`messages` on purpose:
 * `classifyOutcome`'s `abandoned` feeds the calls list, the outcome pill and
 * the dashboard KPIs, and re-labelling a cancellation call there would be a
 * product change, not a bug fix. This flag is read by exactly one consumer —
 * the missed-call text-back's gate — so "we served you" and "what the
 * dashboard calls this call" can differ without either lying.
 *
 * - `cancelled` — `cancel_appointment` succeeded. The caller rang in to
 *   cancel and we cancelled. For a booking made on a PREVIOUS call this
 *   leaves no trace in `bookings` at all (`withBookingCancelled` maps over an
 *   array that is empty), which is exactly how a perfectly-served caller was
 *   getting "Sorry we missed you just now" by text.
 * - `rescheduled` — `reschedule_appointment` succeeded. Today this also
 *   mirrors a new `booked` booking, so the call classifies `booked` and never
 *   reaches the text-back gate; recorded anyway so the gate does not depend
 *   on that second, unrelated mechanism staying true.
 * - `booking_found` — `find_my_booking` returned a real booking. Ringing up
 *   to check your own appointment time is a complete, successful call that
 *   changes nothing in the database. A `found: false` lookup is NOT served:
 *   we told that caller we had nothing for them.
 */
export type ServedAction = "cancelled" | "rescheduled" | "booking_found";

export interface CallState {
  contactId: string | null;
  bookings: (MirroredBooking & { status: "booked" | "cancelled" })[];
  leads: CapturedLead[];
  messages: TakenMessage[];
  transcript: TranscriptEvent[];
  /** See ServedAction. Append-only, deduplicated, never read by classifyOutcome. */
  served: ServedAction[];
  summary?: string;
}

export function emptyCallState(): CallState {
  return { contactId: null, bookings: [], leads: [], messages: [], transcript: [], served: [] };
}

export function classifyOutcome(state: CallState): CallOutcome {
  if (state.bookings.some((b) => b.status === "booked")) return "booked";
  if (state.leads.length > 0) return "lead";
  if (state.messages.length > 0) return "message";
  if (state.transcript.some((t) => t.role === "caller" && t.text.trim())) return "abandoned";
  return "spam";
}

export function withBooking(state: CallState, b: MirroredBooking): CallState {
  const booking = { ...b, status: "booked" as const };
  // If replacing an existing booking, it moves to the array's end; order is not load-bearing.
  return { ...state, bookings: [...state.bookings.filter((x) => x.id !== b.id), booking] };
}

export function withBookingCancelled(state: CallState, bookingId: string): CallState {
  return {
    ...state,
    bookings: state.bookings.map((b) => (b.id === bookingId ? { ...b, status: "cancelled" as const } : b)),
  };
}

export function withLead(state: CallState, lead: CapturedLead): CallState {
  return { ...state, leads: [...state.leads, lead] };
}

export function withMessage(state: CallState, msg: TakenMessage): CallState {
  return { ...state, messages: [...state.messages, msg] };
}

export function withTranscript(state: CallState, ev: TranscriptEvent): CallState {
  return { ...state, transcript: [...state.transcript, ev] };
}

/** Deduplicated: two lookups in one call are still one served caller. */
export function withServed(state: CallState, action: ServedAction): CallState {
  if (state.served.includes(action)) return state;
  return { ...state, served: [...state.served, action] };
}

/**
 * Did the receptionist actually do something for this caller?
 *
 * The missed-call text-back's own gate, deliberately NOT part of
 * `classifyOutcome`: a caller who rang in purely to cancel, or to check what
 * time their appointment is, ends the call `abandoned` by classification and
 * must never be texted "Sorry we missed you just now" for it.
 */
export function wasServed(state: CallState): boolean {
  return state.served.length > 0;
}
