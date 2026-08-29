// apps/web/src/lib/voice/tools/schemas.ts
// Flat GA Realtime tool format: type/name/description/parameters at top
// level, no function: wrapper. Ported from the reception demo and re-pointed
// at platform semantics (booking ids, not Cal uids).
const BOOKING_TOOLS = [
  { type: "function", name: "check_availability",
    description: "List open appointment start times for a date.",
    parameters: { type: "object", properties: { date: { type: "string", description: "YYYY-MM-DD in the business's timezone" } }, required: ["date"] } },
  { type: "function", name: "book_appointment",
    description: "Book an appointment at an available ISO start time. Requires the caller's name and a phone number (their caller ID is used if they don't give one). You MUST first ask whether they would like an email confirmation: pass their email, or emailDeclined: true if they said no. The tool refuses to book without one of the two.",
    parameters: { type: "object", properties: { startsAt: { type: "string" }, name: { type: "string" }, email: { type: "string" }, emailDeclined: { type: "boolean", description: "true ONLY after you asked whether they want an email confirmation and they declined or could not give one" }, phone: { type: "string" }, notes: { type: "string" } }, required: ["startsAt", "name"] } },
  { type: "function", name: "reschedule_appointment",
    description: "Move an existing booking to a new ISO start time.",
    parameters: { type: "object", properties: { bookingId: { type: "string" }, startsAt: { type: "string" } }, required: ["bookingId", "startsAt"] } },
  { type: "function", name: "cancel_appointment",
    description: "Cancel an existing booking.",
    parameters: { type: "object", properties: { bookingId: { type: "string" } }, required: ["bookingId"] } },
  { type: "function", name: "find_my_booking",
    description: "Find the caller's upcoming booking using their phone number.",
    parameters: { type: "object", properties: { phone: { type: "string" } }, required: [] } },
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

export function toolSchemas(bookingEnabled: boolean) {
  return bookingEnabled ? [...BOOKING_TOOLS, ...CORE_TOOLS] : [...CORE_TOOLS];
}
