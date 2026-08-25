// The pure seam between the OpenAI Realtime WS and the tool registry.
// Everything testable about a live call funnels through here.
import { runTool, type ToolContext, type ToolName } from "./tools/registry";
import { withTranscript, type CallState } from "./call-state";

export interface VoiceAction { kind: "send"; payload: object }

// The Realtime WS event shapes this module reads from — a loose subset (only
// the fields `processCallEvent`'s switch actually touches), not the full
// OpenAI Realtime event union: the socket can send many event types this
// module ignores entirely (the `default` branch below), so typing every
// field of every possible event would document behavior this file doesn't
// have. `type` drives the switch; the rest are read per-branch.
export interface RealtimeCallEvent {
  type?: string;
  transcript?: string;
  arguments?: string;
  name?: string;
  call_id?: string;
}

function safeParse(raw: unknown): Record<string, unknown> {
  if (typeof raw !== "string") return {};
  try {
    const v = JSON.parse(raw);
    return v && typeof v === "object" ? v : {};
  } catch { return {}; }
}

function functionCallActions(callId: string | undefined, result: unknown): VoiceAction[] {
  return [
    { kind: "send", payload: {
      type: "conversation.item.create",
      item: { type: "function_call_output", call_id: callId, output: JSON.stringify(result) },
    } },
    { kind: "send", payload: { type: "response.create" } },
  ];
}

export async function processCallEvent(
  state: CallState, ctx: ToolContext, event: RealtimeCallEvent,
): Promise<{ state: CallState; actions: VoiceAction[] }> {
  switch (event?.type) {
    case "response.output_audio_transcript.done": {
      if (!event.transcript) return { state, actions: [] };
      return {
        state: withTranscript(state, { role: "assistant", text: String(event.transcript), at: new Date().toISOString() }),
        actions: [],
      };
    }
    case "conversation.item.input_audio_transcription.completed": {
      if (!event.transcript) return { state, actions: [] };
      return {
        state: withTranscript(state, { role: "caller", text: String(event.transcript), at: new Date().toISOString() }),
        actions: [],
      };
    }
    case "response.function_call_arguments.done": {
      const args = safeParse(event.arguments);
      try {
        const { state: next, result } = await runTool(state, ctx, event.name as ToolName, args);
        return { state: next, actions: functionCallActions(event.call_id, result) };
      } catch (err) {
        // Logged unconditionally: a bare swallow here made a DB outage
        // mid-booking invisible in the logs AND indistinguishable from a
        // genuinely unknown tool name to the model. `runTool` throws
        // "Unknown tool: <name>" (registry.ts) for the latter specifically —
        // anything else is a real failure (DB, network, a tool's own bug)
        // and gets an honest label instead of the misleading "unknown tool".
        console.error(`voice tool ${event.name} failed: ${String(err)}`);
        const message = err instanceof Error ? err.message : String(err);
        const payload = message.startsWith("Unknown tool")
          ? { ok: false, error: "unknown tool" }
          : { ok: false, error: "tool failed — apologize and offer to take a message" };
        return { state, actions: functionCallActions(event.call_id, payload) };
      }
    }
    default:
      return { state, actions: [] };
  }
}
