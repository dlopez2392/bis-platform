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
 * `remaining` counts the reply being WRITTEN, not the ones after it (Important
 * 3, review of commit 129b43f). The caller passes
 * `CONCIERGE_MAX_TURNS - claimed + 1`, so `remaining === 1` means THIS reply
 * — the one this notice is attached to — is the last one the visitor will
 * ever read a response to; there is no "one more" coming. The old wording
 * said "1 more reply" at that exact point, which told the model the close
 * comes next turn on the turn it had to close NOW — the incoherence the
 * turn-cap `ended` response was built to avoid, displaced by one turn.
 *
 * Model-facing text, not customer copy: what the visitor reads is whatever
 * Sofía writes from it.
 */
export function budgetNotice(remaining: number): string {
  if (remaining > CONCIERGE_BUDGET_WARN_TURNS) return "";
  if (remaining <= 1) {
    return [
      "",
      "",
      "THIS CHAT IS ALMOST OVER — THIS IS YOUR LAST REPLY. The visitor cannot write again after this one.",
      "Do not ask a question. Close warmly: thank them, and if you already have their name and either an email address or a phone number, say the team will follow up. If you do not have a way to reach them, say so plainly rather than promising a follow-up you cannot deliver.",
    ].join("\n");
  }
  return [
    "",
    "",
    `THIS CHAT IS ALMOST OVER — you have ${remaining} replies left, including this one, before the visitor cannot write again.`,
    "If you do not already have their name and either an email address or a phone number, ask for them NOW, in this reply, before anything else, and call capture_lead the moment you have them.",
  ].join("\n");
}
