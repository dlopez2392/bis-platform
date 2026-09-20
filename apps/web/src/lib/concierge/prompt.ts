/**
 * The concierge's ONE tool, and the two pieces of text-shaped prompt work the
 * turn route needs on top of `buildSystemPrompt`.
 *
 * Defined here rather than taken from lib/voice/tools/registry.ts: `runTool`
 * resolves against a voice-shaped context (ctx.callRowId, ctx.callerNumber)
 * that does not exist on the web, and transfer_to_human requires a phone leg
 * the web has never had.
 *
 * Booking stays OFF. Giving an anonymous stranger a path into a tenant's
 * calendar is a larger decision than v1 needs, and the existing web demo
 * already refuses it by forcing tools: [].
 *
 * Why a tool at all, when the voice demo could not have one: on text THIS
 * SERVER makes the model call, so a tool call comes straight back in the
 * response body. `processCallEvent` being wired only to the phone path's
 * socket was a WebRTC problem, and text does not have it.
 */
export const CAPTURE_LEAD_TOOL = {
  type: "function" as const,
  function: {
    name: "capture_lead",
    description:
      "Record who this visitor is so the business can get back to them. Call this as soon as they give a name AND either an email address or a phone number. Do not guess or invent any value.",
    parameters: {
      type: "object",
      properties: {
        fullName: { type: "string", description: "The visitor's name, as they gave it." },
        email: { type: "string", description: "Their email address, if they gave one." },
        phone: { type: "string", description: "Their phone number, if they gave one." },
        need: { type: "string", description: "One sentence on what they are asking for." },
      },
      required: ["fullName", "need"],
      additionalProperties: false,
    },
  },
};

export type CaptureLeadArgs = {
  fullName?: unknown; email?: unknown; phone?: unknown; need?: unknown;
};

/** A model may return anything. Nothing reaches the CRM without passing this. */
export function parseCaptureLead(raw: string): {
  fullName: string; email: string; phone: string; need: string;
} | null {
  let parsed: CaptureLeadArgs;
  try { parsed = JSON.parse(raw) as CaptureLeadArgs; } catch { return null; }
  if (!parsed || typeof parsed !== "object") return null;
  const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
  const fullName = str(parsed.fullName);
  if (!fullName) return null;
  return { fullName, email: str(parsed.email), phone: str(parsed.phone), need: str(parsed.need) };
}

/**
 * The tool gives ONE name; a form can carry two columns for it.
 *
 * Without this the whole name lands in `core.first_name` and the contact
 * reads "Ana García" as a first name with no surname — `enrich` maps answers
 * by KIND straight onto `createContact`'s `firstName`/`lastName`, so whatever
 * shape arrives here is the shape the operator sees on the contact row
 * forever. First token, then the rest: "Ana María García Peña" keeps its
 * whole surname rather than losing the tail.
 */
export function splitName(fullName: string): { first: string; last: string } {
  const parts = fullName.trim().split(/\s+/);
  const first = parts.shift() ?? "";
  return { first, last: parts.join(" ") };
}

/**
 * What the model may claim to have DONE on this surface.
 *
 * `buildSystemPrompt`'s TOOLS block names `take_message` and `log_transcript`
 * on every medium — they are the phone path's floor, and the phone session
 * really is given them. The web session is given exactly one tool, so a model
 * reading that block will offer to "take a message", call nothing (there is
 * nothing to call), and tell the visitor it is done — which is the prompt's
 * own "never claim something is recorded without a successful tool result"
 * rule broken by the prompt itself, and a lead that exists only in a
 * transcript nobody reads.
 *
 * Appended by the route rather than added to `system-prompt.ts` because the
 * ROUTE is what decides the tool array. One place decides both.
 */
export const WEB_TOOL_NOTICE = [
  "",
  "",
  "TOOLS ON THIS SURFACE — capture_lead is the ONLY tool you have here. take_message and log_transcript do not exist on the website: do not mention them, and never say you have taken a message, logged, sent, or passed anything on unless capture_lead came back successful. If you cannot answer something, say the team will follow up and use capture_lead to get their name and either an email address or a phone number.",
].join("\n");

/** How close to the cap Sofía is told her budget. Three exchanges is enough
 *  to ask for a name and a way to reach them and still hear an answer. */
export const CONCIERGE_BUDGET_WARN_TURNS = 3;

/**
 * The line appended to the system prompt as the turn cap approaches.
 *
 * It exists because of what happens AT the cap: the page's composer disables
 * itself the moment the route answers `ended: true`, so any copy that then
 * asks for a name and a number asks for something the UI refuses to accept.
 * The ask has to happen while the visitor can still type, which is here —
 * and the last reply is then a close rather than a request.
 *
 * Model-facing text, not customer copy: what the visitor reads is whatever
 * Sofía writes from it.
 */
export function budgetNotice(remaining: number): string {
  if (remaining > CONCIERGE_BUDGET_WARN_TURNS) return "";
  const count = remaining <= 1
    ? "1 more reply"
    : `${remaining} more replies`;
  return [
    "",
    "",
    `THIS CHAT IS ALMOST OVER — you have ${count} and then the visitor cannot write again.`,
    "If you do not already have their name and either an email address or a phone number, ask for them NOW, in this reply, before anything else, and call capture_lead the moment you have them.",
    "On your last reply do not ask a question: thank them and say the team will follow up.",
  ].join("\n");
}
