// The pure seam between the OpenAI Realtime WS and the tool registry.
// Everything testable about a live call funnels through here.
import { runTool, type ToolContext, type ToolName } from "./tools/registry";
import { withTranscript, type CallState } from "./call-state";
import { handoffLine } from "./handoff";

/**
 * `close` is the ONLY action that ends a call on purpose. Its one producer is
 * a successful `transfer_to_human` below; its one consumer is the lifecycle in
 * `app/api/voice/incoming/route.ts`, which lets the queued sends go out and
 * the spoken line play before the socket actually goes.
 */
export type VoiceAction =
  | { kind: "send"; payload: object }
  | { kind: "close" };

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

/**
 * `instructions`, when given, rides on the `response.create` rather than
 * arriving as a THIRD frame of its own. A second `response.create` sent while
 * the first is still generating is rejected by the Realtime API
 * ("conversation already has an active response"), which this module ignores
 * as an unknown event type — so the pinned sentence would be silently dropped
 * and the model would improvise the one line of the call that must not be
 * improvised.
 */
function functionCallActions(
  callId: string | undefined, result: unknown, instructions?: string,
): VoiceAction[] {
  return [
    { kind: "send", payload: {
      type: "conversation.item.create",
      item: { type: "function_call_output", call_id: callId, output: JSON.stringify(result) },
    } },
    { kind: "send", payload: instructions
      ? { type: "response.create", response: { instructions } }
      : { type: "response.create" } },
  ];
}

/**
 * Did this frame hand the caller to a person?
 *
 * Derived from the two things THIS module sees — the tool's name and the
 * result it returned — and deliberately nothing else. The tool already did
 * the durable part (`markHandoffRequested`); this decides only whether the AI
 * leg is finished. A REFUSED transfer (`ok:false` — no number configured, no
 * call row, a database that would not take the write) leaves the call running
 * with Sofía, because the alternative is hanging up on a caller nobody is
 * going to ring.
 *
 * A thrown tool never reaches here (the catch below answers separately), which
 * is right: a throw is not a transfer.
 */
function endsTheAiLeg(name: string | undefined, result: unknown): boolean {
  if (name !== "transfer_to_human") return false;
  return typeof result === "object" && result !== null && (result as { ok?: unknown }).ok === true;
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
        const handingOver = endsTheAiLeg(event.name, result);
        const actions = functionCallActions(event.call_id, result,
          handingOver ? handoffLine(ctx.profile.languages) : undefined);
        // AFTER the two sends, never before: the second of them is the
        // `response.create` that makes the model say "one moment, I'll put you
        // through". Close first and the caller gets silence and then a ring.
        if (handingOver) actions.push({ kind: "close" });
        return { state: next, actions };
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
