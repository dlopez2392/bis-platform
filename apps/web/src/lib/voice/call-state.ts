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

export interface CallState {
  contactId: string | null;
  bookings: (MirroredBooking & { status: "booked" | "cancelled" })[];
  leads: CapturedLead[];
  messages: TakenMessage[];
  transcript: TranscriptEvent[];
  summary?: string;
}

export function emptyCallState(): CallState {
  return { contactId: null, bookings: [], leads: [], messages: [], transcript: [] };
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
