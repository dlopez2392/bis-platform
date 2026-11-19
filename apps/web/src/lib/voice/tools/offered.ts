// F-023 PR 4 (plan §3.5): the tools a session is offered, decided from the prompt's own input, so the prompt names
// only those. Relative imports only: scripts/sofia-corpus.ts loads system-prompt.ts, which imports this, under tsx.
import type { VoicePromptInput } from "../session-config";
import { bookingMode } from "../booking-mode";
import { toolSchemas } from "./schemas";
import type { CustomerToolName } from "../../tools/customer/specs";

export type OfferedTools = ReadonlySet<CustomerToolName>;

/**
 * - "web_voice", both browser demos: nothing. The web session route and the prospect demo mint `tools: []`.
 * - "web", the website chat: capture_lead alone (CAPTURE_LEAD_TOOL, lib/concierge/prompt.ts).
 * - the phone (no medium, or "phone"): what the call's session is sent, `toolSchemas` from the same booking mode,
 *   meeting type and handoff that buildRealtimeSessionConfig passes it.
 */
export function offeredTools(
  input: Pick<VoicePromptInput, "medium" | "bookingEnabled" | "afterHours" | "meetingType" | "handoffAvailable">,
): OfferedTools {
  if (input.medium === "web_voice") return new Set();
  if (input.medium === "web") return new Set(["capture_lead"]);
  return new Set(toolSchemas(bookingMode(input), input.meetingType, input.handoffAvailable === true).map((t) => t.name));
}

/** `[line]` when every tool it names is offered, else `[]`: spread into the prompt's lines. */
export function ifOffered(
  offered: OfferedTools, names: CustomerToolName | readonly CustomerToolName[], line: string,
): string[] {
  const all: readonly CustomerToolName[] = typeof names === "string" ? [names] : names;
  return all.every((n) => offered.has(n)) ? [line] : [];
}
