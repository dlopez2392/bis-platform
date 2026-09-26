// apps/web/src/lib/voice/tools/schemas.ts
// Flat GA Realtime tool format: type/name/description/parameters at top
// level, no function: wrapper. Ported from the reception demo and re-pointed
// at platform semantics (booking ids, not Cal uids).
const BOOKING_TOOLS = [
  { type: "function", name: "check_availability",
    description: "List open appointment slots for a date. Each slot carries startsAt (an ISO timestamp — pass that exact value to book_appointment or reschedule_appointment) and local (the same moment rendered in the business's own timezone — this is what you SAY to the caller; never convert the ISO value yourself).",
    parameters: { type: "object", properties: { date: { type: "string", description: "YYYY-MM-DD in the business's timezone" } }, required: ["date"] } },
  { type: "function", name: "book_appointment",
    description: "Book an appointment at an available ISO start time. Requires the caller's name and a phone number (their caller ID is used if they don't give one). You MUST first ask whether they would like an email confirmation: pass their email, or emailDeclined: true if they said no. The tool refuses to book without one of the two.",
    parameters: { type: "object", properties: { startsAt: { type: "string" }, name: { type: "string" }, email: { type: "string" }, emailDeclined: { type: "boolean", description: "true ONLY after you asked whether they want an email confirmation and they declined or could not give one" }, phone: { type: "string" }, notes: { type: "string" } }, required: ["startsAt", "name"] } },
  // Booking tools are bound to the verified caller (registry.ts): the two
  // below refuse a booking that is neither under the caller ID nor made on
  // this call, and find_my_booking takes no number at all — the contract
  // says so, so the model never asks a caller for one to look up.
  { type: "function", name: "reschedule_appointment",
    description: "Move an existing booking to a new ISO start time. Only for a booking find_my_booking returned on this call, or one booked on this call.",
    parameters: { type: "object", properties: { bookingId: { type: "string" }, startsAt: { type: "string" } }, required: ["bookingId", "startsAt"] } },
  { type: "function", name: "cancel_appointment",
    description: "Cancel an existing booking. Only for a booking find_my_booking returned on this call, or one booked on this call.",
    parameters: { type: "object", properties: { bookingId: { type: "string" } }, required: ["bookingId"] } },
  { type: "function", name: "find_my_booking",
    description: "Find the caller's upcoming booking by the number they are calling from. It cannot look up any other number.",
    parameters: { type: "object", properties: {}, required: [] } },
] as const;

const CORE_TOOLS = [
  { type: "function", name: "capture_lead",
    description: "Record who the caller is and what they need.",
    parameters: { type: "object", properties: { fields: { type: "object", additionalProperties: { type: "string" } } }, required: ["fields"] } },
  { type: "function", name: "take_message",
    description: "Leave a message for a human callback.",
    parameters: { type: "object", properties: { body: { type: "string" }, callbackNumber: { type: "string" } }, required: ["body"] } },
  { type: "function", name: "log_transcript",
    description: "Log a spoken turn for staff review.",
    parameters: { type: "object", properties: { role: { type: "string", enum: ["caller", "assistant"] }, text: { type: "string" } }, required: ["role", "text"] } },
] as const;

// Advertised ONLY when the account actually has somewhere to send the caller
// (`toolSchemas`' third argument). A model offered this tool WILL offer it out
// loud — "let me put you through" — and a caller who hears that and then does
// not get put through is worse off than one who was never offered it, so the
// gate is on the schema rather than on the tool's refusal alone.
//
// No parameters: who to dial is the business's own configured number, never
// anything the model or the caller supplies.
const HANDOFF_TOOL = {
  type: "function", name: "transfer_to_human",
  description: "Put the caller through to a person at the business. Use only when the caller asks to speak to someone.",
  parameters: { type: "object", properties: {}, required: [] },
} as const;

// The video rewrite of book_appointment's contract. 2026-08-30, live call:
// the caller declined email and the model invented "we can book using just
// your phone number" — while the SYSTEM PROMPT said email-is-required
// (recited moments earlier; prompt rules are wishes). The tool description
// was actively working against the video gate: it said "pass their email,
// or emailDeclined: true if they said no", which on a video calendar is a
// booking path that does not exist (registry.ts refuses it). The contract
// the model reads at call time must say what the tool will actually do.
const VIDEO_BOOK_TOOL = {
  ...BOOKING_TOOLS[1],
  description:
    "Book an appointment at an available ISO start time. Requires the caller's name, a phone number (their caller ID is used if they don't give one), and a working EMAIL ADDRESS — appointments at this business are VIDEO meetings and the meeting link only arrives by email. emailDeclined is NOT accepted: there is no way to book without an email and no phone-only option, so never offer one. If the caller cannot or will not give an email, stop collecting booking details and use take_message so a human can arrange it.",
  parameters: {
    ...BOOKING_TOOLS[1].parameters,
    properties: {
      ...BOOKING_TOOLS[1].parameters.properties,
      emailDeclined: {
        type: "boolean",
        description: "Not accepted for this business — its video appointments cannot be booked without an email. If the caller declines, use take_message instead.",
      },
    },
  },
} as const;

export function toolSchemas(
  bookingEnabled: boolean, meetingType: "in_person" | "phone" | "video",
  handoffAvailable: boolean,
) {
  // Appended to CORE, not to BOOKING: asking for a person has nothing to do
  // with whether this business takes appointments.
  const core = handoffAvailable ? [...CORE_TOOLS, HANDOFF_TOOL] : [...CORE_TOOLS];
  if (!bookingEnabled) return core;
  const booking = meetingType === "video"
    ? BOOKING_TOOLS.map((t) => (t.name === "book_appointment" ? VIDEO_BOOK_TOOL : t))
    : [...BOOKING_TOOLS];
  return [...booking, ...core];
}
