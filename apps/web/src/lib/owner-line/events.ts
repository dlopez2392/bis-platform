// apps/web/src/lib/owner-line/events.ts
// The owner line's frame handler (F-032 spec §4.4): the transcript both ways, and the owner tools through
// runOwnerTool, which refuses any other name (a receptionist tool included) and re-checks the person live before
// every read. No recording guard (a person who keyed a PIN is not a broadcast), no transfer, no hangup: the only
// actions it ever returns are sends. The cap, the warning and the silence guard are the lifecycle's.
import { withTranscript, withCallerItem, callerTurnRecorded, type CallState } from "@/lib/voice/call-state";
import type { RealtimeCallEvent, VoiceAction } from "@/lib/voice/call-events";
import { runOwnerTool, type OwnerToolContext } from "./tools/registry";
import { OWNER_TOOL_NAMES, type OwnerToolName } from "./tools/schemas";

function parse(raw: unknown): Record<string, unknown> {
  if (typeof raw !== "string") return {};
  try {
    const v = JSON.parse(raw);
    return v && typeof v === "object" ? v : {};
  } catch {
    return {};
  }
}

/**
 * `ran` collects every owner tool the person ASKED for on this call (a known name only), whatever the read
 * returned: the access log records what was asked about, and over-reporting an attempt is safer than leaving one
 * out (plan Task 12; spec §6).
 */
export async function processOwnerLineEvent(
  state: CallState, ctx: OwnerToolContext, ran: Set<OwnerToolName>, event: RealtimeCallEvent,
): Promise<{ state: CallState; actions: VoiceAction[] }> {
  switch (event?.type) {
    case "response.output_audio_transcript.done":
      return event.transcript
        ? { state: withTranscript(state, { role: "assistant", text: String(event.transcript), at: new Date().toISOString() }), actions: [] }
        : { state, actions: [] };
    case "conversation.item.input_audio_transcription.completed":
      // A re-delivered frame for a turn already recorded is recorded once, as the receptionist's handler does.
      if (!event.transcript || callerTurnRecorded(state, event.item_id)) return { state, actions: [] };
      return {
        state: withCallerItem(withTranscript(state, { role: "caller", text: String(event.transcript), at: new Date().toISOString() }), event.item_id),
        actions: [],
      };
    case "response.function_call_arguments.done": {
      const name = String(event.name ?? "");
      const result = await runOwnerTool(ctx, name, parse(event.arguments));
      if ((OWNER_TOOL_NAMES as readonly string[]).includes(name)) ran.add(name as OwnerToolName);
      return { state, actions: [
        { kind: "send", payload: { type: "conversation.item.create",
          item: { type: "function_call_output", call_id: event.call_id, output: JSON.stringify(result) } } },
        { kind: "send", payload: { type: "response.create" } },
      ] };
    }
    default:
      return { state, actions: [] };
  }
}
