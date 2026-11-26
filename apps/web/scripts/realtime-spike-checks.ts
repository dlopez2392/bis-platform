// The transcription checks realtime-spike.ts runs (OpenAI model switch plan, Step 0 (b),
// docs/superpowers/plans/2026-11-26-openai-model-switch.md): does a session take our FULL config with a new
// transcriber, and does that transcriber send `.delta` and `.completed` for speech? classifyOutcome
// (voice/call-state.ts) labels a call with no caller transcript as spam, so a transcriber that sends other events
// would fail silently on every call. Pure, so apps/web/ci/realtime-spike.test.ts proves it without a network.
//
// What leaves here lands in a PUBLIC log: counts, identifier tokens, error code/type/param (realtimeErrorWhy),
// the usage object's key names, and a transcript of the MODEL's own synthetic sentence capped at 120 characters.
import { realtimeErrorWhy } from "./realtime-spike-why";

/** The workflow's fixed `realtime_model` choice (sofia-corpus.yml; ci-workflow.test.ts pins the two agree). */
export const REALTIME_MODEL_CHOICES = ["gpt-realtime", "gpt-realtime-2.1"] as const;
/** gpt-transcribe first (the transcription guide names it for in-session use); -2025-12-15 is a stopgap (dies 02-26). */
export const TRANSCRIBE_CANDIDATES = ["gpt-transcribe", "gpt-live-transcribe", "gpt-4o-mini-transcribe-2025-12-15"] as const;
export const TRANSCRIPT_CAP = 120;
/** What the speaking session says, one per language: model audio, no person recorded. */
export const ROUND_TRIP_SENTENCES = {
  en: "Hi, I would like to book an appointment for Tuesday morning, please.",
  es: "Hola, quisiera hacer una cita para el martes por la mañana, por favor.",
} as const;

const token = (v: unknown) => (typeof v === "string" ? v.replace(/[^\w.[\]-]/g, "").slice(0, 80) : "");
const obj = (v: unknown): Record<string, unknown> | null => (typeof v === "object" && v !== null ? v as Record<string, unknown> : null);

/** The event types the text-only check may name in the log; any other is counted as `other`. */
const KNOWN_EVENTS = new Set([
  "session.created", "session.updated", "error", "conversation.created", "conversation.item.created",
  "conversation.item.added", "conversation.item.done", "response.created", "response.done",
  "response.output_item.added", "response.output_item.done", "response.content_part.added",
  "response.content_part.done", "response.output_text.delta", "response.output_text.done", "rate_limits.updated",
  "(unparseable)", "(no type)",
]);

/** How many of each known event type arrived, every unknown one folded into `other`. */
export function countEvents(types: readonly string[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const t of types) {
    const k = KNOWN_EVENTS.has(t) ? t : "other";
    out[k] = (out[k] ?? 0) + 1;
  }
  return out;
}

type WithTranscription ={ audio: { input: { transcription: { model: string } } } };

/** The session config exactly as built, audio block kept, with only the transcription model changed. */
export function withTranscriber<T extends WithTranscription>(cfg: T, model: string): T {
  return {
    ...cfg,
    audio: { ...cfg.audio, input: { ...cfg.audio.input, transcription: { ...cfg.audio.input.transcription, model } } },
  };
}

/** `session.updated`'s transcription model, as identifier characters; "" when absent. */
export function echoedTranscriber(ev: unknown): string {
  return token(obj(obj(obj(obj(obj(ev)?.session)?.audio)?.input)?.transcription)?.model);
}

/** A usage object as its `type` and its key names only, e.g. "tokens {input_tokens, …}"; "none" when absent. */
function usageShape(u: unknown): string {
  const o = obj(u);
  if (!o) return "none";
  return `${token(o.type) || "untyped"} {${Object.keys(o).map(token).filter(Boolean).sort().join(", ")}}`;
}

export type TranscriptionResult = { deltas: number; completed: boolean; transcript: string; usage: string; errors: string[] };

/** Fed every event of the listening session; reads only the transcription events and errors. */
export function transcriptionTracker() {
  let deltas = 0;
  let fromDeltas = "";
  let completed: string | null = null;
  let usage = "none";
  const errors: string[] = [];
  return {
    onEvent(ev: unknown): void {
      const e = obj(ev);
      const type = e?.type;
      if (type === "conversation.item.input_audio_transcription.delta") {
        deltas += 1;
        if (typeof e!.delta === "string") fromDeltas += e!.delta;
      } else if (type === "conversation.item.input_audio_transcription.completed") {
        completed = typeof e!.transcript === "string" ? e!.transcript : fromDeltas;
        usage = usageShape(e!.usage);
      } else if (type === "conversation.item.input_audio_transcription.failed") {
        errors.push(`transcription failed: ${realtimeErrorWhy(e!.error)}`);
      } else if (type === "error") {
        errors.push(realtimeErrorWhy(e!.error));
      }
    },
    get completed(): boolean { return completed !== null; },
    result(): TranscriptionResult {
      return { deltas, completed: completed !== null, transcript: (completed ?? fromDeltas).slice(0, TRANSCRIPT_CAP), usage, errors: [...errors] };
    },
  };
}
