// apps/web/src/lib/tools/customer/specs.ts
// The customer catalogue (F-023 plan §3.1): every tool an assistant may use while talking to a customer. The phone
// sends them through lib/voice/tools/schemas.ts (toolSchemas → realtimeShape) and runs them in
// lib/voice/tools/registry.ts; the web chat sends capture_lead's `web` variant (lib/concierge/prompt.ts → chatShape).
// Platform semantics (booking ids, not Cal uids), ported from the reception demo. Every word here is pinned byte for
// byte by customer-tool-schemas.fixture.json. What a session is SENT never names a tool it lacks: a base description
// that does (check_availability names book_appointment) is sent only where that tool is offered, else its variant.
import type { ToolSpec } from "../belt";

/** The session facts a variant can be keyed by: the calendar's meeting type ("video"), the booking mode ("manage",
 *  "Always take a message") and the transport ("web", the web chat). Plan §3.2: one entry per name, variants inside. */
export type VariantKey = "video" | "manage" | "web";
export type CustomerToolSpec = ToolSpec<"customer"> & {
  readonly variants?: Readonly<Partial<Record<VariantKey, ToolSpec<"customer">>>>;
};

const CHECK_AVAILABILITY = { audience: "customer", name: "check_availability",
  description: "List open appointment slots for a date. Each slot carries startsAt (an ISO timestamp — pass that exact value to book_appointment or reschedule_appointment) and local (the same moment rendered in the business's own timezone — this is what you SAY to the caller; never convert the ISO value yourself).",
  parameters: { type: "object", properties: { date: { type: "string", description: "YYYY-MM-DD in the business's timezone" } }, required: ["date"] } } as const;

const BOOK_APPOINTMENT = { audience: "customer", name: "book_appointment",
  description: "Book an appointment at an available ISO start time. Requires the caller's name and a phone number (their caller ID is used if they don't give one). You MUST first ask whether they would like an email confirmation: pass their email, or emailDeclined: true if they said no. The tool refuses to book without one of the two.",
  parameters: { type: "object", properties: { startsAt: { type: "string" }, name: { type: "string" }, email: { type: "string" }, emailDeclined: { type: "boolean", description: "true ONLY after you asked whether they want an email confirmation and they declined or could not give one" }, phone: { type: "string", description: "Digits as spoken; no country code unless the caller said one." }, notes: { type: "string" }, forSomeoneElse: { type: "boolean", description: "Only after you asked whether the appointment is for the caller or for someone else: false if it is for the caller, true if it is for someone else." } }, required: ["startsAt", "name"] } } as const;

const CAPTURE_LEAD = { audience: "customer", name: "capture_lead",
  description: "Record who the caller is and what they need. For callbackNumber, write the digits as spoken, with no country code unless the caller said one.",
  parameters: { type: "object", properties: { fields: { type: "object", additionalProperties: { type: "string" } }, forSomeoneElse: { type: "boolean", description: "Only after you asked whether this is for the caller or for someone else: false if it is for the caller, true if it is for someone else." } }, required: ["fields"] } } as const;

export const CUSTOMER_TOOL_SPECS = [
  { ...CHECK_AVAILABILITY, variants: {
    // "Always take a message" (booking-mode.ts "manage"): the session has no book_appointment, and a description must
    // not name a tool its session lacks.
    manage: { ...CHECK_AVAILABILITY,
      description: CHECK_AVAILABILITY.description.replace("book_appointment or reschedule_appointment", "reschedule_appointment") },
  } },
  { ...BOOK_APPOINTMENT, variants: {
    // The video rewrite of book_appointment's contract. 2026-08-30, live call:
    // the caller declined email and the model invented "we can book using just
    // your phone number" — while the SYSTEM PROMPT said email-is-required
    // (recited moments earlier; prompt rules are wishes). The tool description
    // was actively working against the video gate: it said "pass their email,
    // or emailDeclined: true if they said no", which on a video calendar is a
    // booking path that does not exist (registry.ts refuses it). The contract
    // the model reads at call time must say what the tool will actually do.
    video: {
      ...BOOK_APPOINTMENT,
      description:
        "Book an appointment at an available ISO start time. Requires the caller's name, a phone number (their caller ID is used if they don't give one), and a working EMAIL ADDRESS — appointments at this business are VIDEO meetings and the meeting link only arrives by email. emailDeclined is NOT accepted: there is no way to book without an email and no phone-only option, so never offer one. If the caller cannot or will not give an email, stop collecting booking details and use take_message so a human can arrange it.",
      parameters: {
        ...BOOK_APPOINTMENT.parameters,
        properties: {
          ...BOOK_APPOINTMENT.parameters.properties,
          emailDeclined: {
            type: "boolean",
            description: "Not accepted for this business — its video appointments cannot be booked without an email. If the caller declines, use take_message instead.",
          },
        },
      },
    },
  } },
  // Booking tools are bound to the caller ID (registry.ts): find_my_booking
  // takes no number at all — the contract says so, so the model never asks a
  // caller for one to look up — and the two below move or cancel only a
  // booking made on this call, or one whose contact this call has confirmed
  // (S-47e: on a shared number that is the person named, not the caller ID
  // alone; flow.ts ownsStep).
  { audience: "customer", name: "reschedule_appointment",
    description: "Move an existing booking to a new ISO start time. Only for a booking find_my_booking returned on this call, or one booked on this call.",
    parameters: { type: "object", properties: { bookingId: { type: "string" }, startsAt: { type: "string" } }, required: ["bookingId", "startsAt"] } },
  { audience: "customer", name: "cancel_appointment",
    description: "Cancel an existing booking. Only for a booking find_my_booking returned on this call, or one booked on this call.",
    parameters: { type: "object", properties: { bookingId: { type: "string" } }, required: ["bookingId"] } },
  { audience: "customer", name: "find_my_booking",
    description: "Find the caller's upcoming booking by the number they are calling from. It cannot look up any other number. If it asks you to confirm who they are, ask for exactly what it says, call confirm_identity, then call find_my_booking again.",
    parameters: { type: "object", properties: {}, required: [] } },
  // S-47e (spec 5.4.3): on the session exactly where find_my_booking is (modes full and manage).
  { audience: "customer", name: "confirm_identity",
    description: "Confirm whose appointment the caller means, when find_my_booking asks you to and whenever the caller asks about a different person's appointment than the one already confirmed. Pass the first and last name exactly as the caller said it, and the email address only when you were asked for it: spell the email back character by character and wait for them to confirm, then write it with the @ and . symbols. It checks only the people under the number they are calling from. It never tells you a name or an email, and you must never suggest, guess or spell one for them.",
    parameters: { type: "object", properties: { fullName: { type: "string", description: "First and last name, as the caller said it." }, email: { type: "string", description: "Only when asked for. The address as confirmed, with @ and . symbols." } }, required: ["fullName"] } },
  { ...CAPTURE_LEAD, variants: {
    // The web chat's capture_lead (lib/concierge/prompt.ts CAPTURE_LEAD_TOOL): FLAT fields, not the phone's `fields`
    // object. Merging the two would change what both models are asked to fill (plan §3.2), so they stay two contracts.
    web: { audience: "customer", name: "capture_lead",
      description:
        "Record who this visitor is so the business can get back to them. Call this as soon as they give a name AND either an email address or a phone number. Do not guess or invent any value.",
      parameters: {
        type: "object",
        properties: {
          fullName: { type: "string", description: "The visitor's name, as they gave it." },
          email: { type: "string", description: "Their email address, if they gave one." },
          phone: { type: "string", description: "Their phone number, if they gave one. Digits as the visitor typed them; no country code unless they gave one." },
          need: { type: "string", description: "One sentence on what they are asking for." },
        },
        required: ["fullName", "need"],
        additionalProperties: false,
      } },
  } },
  { audience: "customer", name: "take_message",
    description: "Leave a message for a human callback.",
    parameters: { type: "object", properties: { body: { type: "string" }, callbackNumber: { type: "string", description: "Digits as spoken; no country code unless the caller said one." }, name: { type: "string", description: "The caller's first and last name, when you were asked for it." }, nameDeclined: { type: "boolean", description: "true ONLY after you asked for their name and they would not give it." } }, required: ["body"] } },
  { audience: "customer", name: "log_transcript",
    description: "Log a spoken turn for staff review.",
    parameters: { type: "object", properties: { role: { type: "string", enum: ["caller", "assistant"] }, text: { type: "string" } }, required: ["role", "text"] } },
  // Offered ONLY when the call actually has somewhere to send the caller
  // (`toolSchemas`' third argument). A model offered this tool WILL offer it out
  // loud — "let me put you through" — and a caller who hears that and then does
  // not get put through is worse off than one who was never offered it, so the
  // gate is on the schema rather than on the tool's refusal alone.
  //
  // No parameters: who to dial is the business's own configured number, never
  // anything the model or the caller supplies.
  { audience: "customer", name: "transfer_to_human",
    description: "Put the caller through to a person at the business. Use only when the caller asks to speak to someone.",
    parameters: { type: "object", properties: {}, required: [] } },
] as const satisfies readonly CustomerToolSpec[];

export type CustomerToolName = (typeof CUSTOMER_TOOL_SPECS)[number]["name"];
export const CUSTOMER_TOOL_NAMES: readonly CustomerToolName[] = CUSTOMER_TOOL_SPECS.map((s) => s.name);

type Spec = (typeof CUSTOMER_TOOL_SPECS)[number];
type VariantsOf<S> = S extends { readonly variants: infer V } ? V[keyof V] : never;
/** A spec as one session sends it: the tool itself or one of its variants. */
export type SelectedSpec = Spec | VariantsOf<Spec>;

/** The spec this session is sent: the first variant one of the session's facts names, else the tool itself. */
export function selectVariant<S extends Spec>(spec: S, facts: readonly string[]): S | VariantsOf<S> {
  if (!("variants" in spec)) return spec;
  const variants: Readonly<Record<string, ToolSpec<"customer">>> = spec.variants;
  for (const fact of facts) if (Object.hasOwn(variants, fact)) return variants[fact] as VariantsOf<S>;
  return spec;
}

/** Picks one tool by name, typed: `customerSpec("capture_lead")`. */
export function customerSpec<N extends CustomerToolName>(name: N): Extract<Spec, { name: N }> {
  return CUSTOMER_TOOL_SPECS.find((s) => s.name === name) as Extract<Spec, { name: N }>;
}
