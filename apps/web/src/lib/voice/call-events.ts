// The pure seam between the OpenAI Realtime WS and the tool registry.
// Everything testable about a live call funnels through here.
import { runTool, type ToolContext, type ToolName } from "./tools/registry";
import {
  withTranscript, withRecordedCaller, withCallerDelta, clearPendingCallerTurn, type CallState,
} from "./call-state";
import { looksLikeRecordedMessage } from "./recorded-message";
import { handoffLine } from "./handoff";

/**
 * `close` is the ONLY action that ends a call on purpose. Its one producer is
 * a successful `transfer_to_human` below; its one consumer is the lifecycle in
 * `app/api/voice/incoming/route.ts`, which lets the queued sends go out and
 * the spoken line play before the socket actually goes.
 */
export type VoiceAction =
  | { kind: "send"; payload: object }
  | { kind: "close" }
  /** End the call NOW, with no goodbye. Only a recording gets this — see the
   *  caller-transcript branch below for why it says nothing first. */
  | { kind: "hangup" };

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
  /** `conversation.item.input_audio_transcription.delta` only — see that case. */
  item_id?: string;
  delta?: string;
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
    case "conversation.item.input_audio_transcription.delta": {
      // THE PREFIX IS JUDGED, NOT THE FINISHED TURN. The `.completed` case
      // below is where this guard lived first (#88), and it was correct —
      // and it fired at the moment the robot would have hung up anyway,
      // because semantic_vad lands a 470-character script as ONE turn and
      // `.completed` arrives only when that turn is over. Calls with and
      // without the guard both cost 38–56 seconds; #88 fixed the label, not
      // the bill. This case runs the SAME predicate against the transcript
      // as far as it has got, so the hangup lands at the first "press 0 to
      // speak with an agent" instead of at "thank you".
      //
      // Same predicate, same two conditions, same negatives — see
      // recorded-message.ts for why it is never keyed on "Google". Nothing
      // here widens what counts as a recording; it only moves WHEN the same
      // judgement is made.
      //
      // Already ending — a delta hung this call up and the socket is still
      // draining while the lifecycle awaits endCallLeg. Whatever arrives in
      // that window is not a turn to judge or record: the transcript already
      // holds the words that ended the call, and a second hangup would end
      // the SIP leg twice. Same idempotence idiom as withServed.
      if (state.recordedCaller) return { state: clearPendingCallerTurn(state), actions: [] };
      if (!event.item_id || !event.delta) return { state, actions: [] };
      const next = withCallerDelta(state, event.item_id, event.delta);
      const prefix = next.pendingCallerTurn!.text;
      if (!looksLikeRecordedMessage(prefix)) return { state: next, actions: [] };
      // Recorded FIRST, as the prefix — the same evidence rule as below: the
      // words that tripped the guard are the only way a false positive can
      // ever be audited. The buffer is cleared because the turn is over; the
      // socket closes before any `.completed` could arrive for it.
      const recorded = withRecordedCaller(
        withTranscript(clearPendingCallerTurn(next),
          { role: "caller", text: prefix, at: new Date().toISOString() }));
      return { state: recorded, actions: [{ kind: "hangup" }] };
    }
    case "conversation.item.input_audio_transcription.completed": {
      // Already ending — a delta hung this call up and the socket is still
      // draining while the lifecycle awaits endCallLeg. Whatever arrives in
      // that window is not a turn to judge or record: the transcript already
      // holds the words that ended the call, and a second hangup would end
      // the SIP leg twice. Same idempotence idiom as withServed.
      if (state.recordedCaller) return { state: clearPendingCallerTurn(state), actions: [] };
      if (!event.transcript) return { state: clearPendingCallerTurn(state), actions: [] };
      const text = String(event.transcript);
      const next = withTranscript(clearPendingCallerTurn(state),
        { role: "caller", text, at: new Date().toISOString() });
      // The turn is ALWAYS recorded first, recording or not. What the robot
      // said is the evidence the guard was right, and the only way anyone can
      // audit a false positive afterwards — a spam row with an empty
      // transcript is indistinguishable from a silent call.
      //
      // Still here, not only in the `.delta` case above: a transcriber that
      // sends no deltas (or a turn whose prefix crossed the floor only on
      // its final word) must still be caught on the finished text.
      if (looksLikeRecordedMessage(text)) {
        // NO GOODBYE, unlike the cap and the silence guard. Those end a call a
        // PERSON is on, where the repo rule is that a caller must never hear
        // the line simply go dead. There is nobody here to hear it: the thing
        // on the other end is a broadcast that has already stopped listening,
        // and a five-second parting sentence is five more seconds of the
        // client paying for it.
        return { state: withRecordedCaller(next), actions: [{ kind: "hangup" }] };
      }
      return { state: next, actions: [] };
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
