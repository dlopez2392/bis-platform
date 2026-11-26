// pnpm --filter web exec tsx scripts/realtime-spike.ts      (REALTIME_MODEL: gpt-realtime or gpt-realtime-2.1)
//
// S-47b Task 0 spike (plan docs/superpowers/plans/2026-10-21-sofia-trade-modules-pr47b.md), grown by the OpenAI
// model switch's Step 0 (b) (docs/superpowers/plans/2026-11-26-openai-model-switch.md). Against the Realtime
// model REALTIME_MODEL names (one of the workflow's fixed choice; anything else exits 2), it prints ONE JSON
// line per check:
//   - model: the model it ran against.
//   - text_only: does the model answer a TEXT-ONLY session built from our real session config? Both names the
//     switch has had, `output_modalities` (the GA shape) and then `modalities`. {variant, ok, why, events,
//     textLength, nonEmpty}: `events` counts each known event type (any other as `other`), and the reply is
//     described by its length and whether it had any text, never printed.
//   - session_config: our FULL session config, audio block kept, with each transcription candidate
//     (realtime-spike-checks.ts): `session.updated` (and the transcriber it echoes) or the error.
//   - speaker: one session speaks a fixed English, then a fixed Spanish sentence (model audio, no person).
//   - round_trip: a second session, on the full config with the candidate transcriber, is fed that audio:
//     whether `.delta` and `.completed` arrived, the usage's shape, the transcript capped at 120 characters.
// `why` is the outcome, where an OpenAI error is its code, type and param only, never its message (a message
// can echo what was sent). It never prints the key, a header or any environment value, and it reads the key
// from the shell only, never from a file. Exit 0 when a text-only variant returned text, 1 when neither did,
// 2 when the model is not one of the choice or there is no key. The transcription checks are findings and do
// not change the exit code.
//
// It runs in sofia-corpus.yml (step=spike), whose log is public; apps/web/ci/realtime-spike.test.ts pins
// the two exit-2 cases, the no-message rule and the transcription checks' pure parts.
import WebSocket from "ws";
import { buildRealtimeSessionConfig, REALTIME_MODEL } from "../src/lib/voice/session-config";
import { realtimeErrorWhy } from "./realtime-spike-why";
import {
  countEvents, echoedTranscriber, REALTIME_MODEL_CHOICES, ROUND_TRIP_SENTENCES, TRANSCRIBE_CANDIDATES, transcriptionTracker, withTranscriber,
  type TranscriptionResult,
} from "./realtime-spike-checks";

const VARIANTS = ["output_modalities", "modalities"] as const;
type Variant = (typeof VARIANTS)[number];
type SpikeResult = { check: "text_only"; variant: Variant; ok: boolean; why: string; events: Record<string, number>; textLength: number; nonEmpty: boolean };
type Lang = keyof typeof ROUND_TRIP_SENTENCES;

const TIMEOUT_MS = 30_000;
const ROUND_TRIP_TIMEOUT_MS = 45_000;
/** 24 kHz, 16-bit mono PCM (the session's default audio format): 48,000 bytes a second. */
const BYTES_PER_SECOND = 48_000;
/** Silence after the sentence, so the session's own turn detection can end the turn as it does on a call. */
const TRAILING_SILENCE_BYTES = BYTES_PER_SECOND * 2.5;
/** When turn detection has not committed by then, commit by hand (and say so). */
const MANUAL_COMMIT_AFTER_MS = 8_000;

type Ev = Record<string, unknown>;
const statusOf = (ev: Ev) => {
  const s = (ev.response as { status?: unknown } | undefined)?.status;
  return typeof s === "string" ? s.replace(/[^\w-]/g, "").slice(0, 40) : "unknown";
};

function realConfig() {
  return buildRealtimeSessionConfig({
    personaName: "Sofía", businessName: "Spike Test Co", facts: "- Open 9 to 5, Monday to Friday.",
    services: "Testing", languages: "both", bookingEnabled: true, timezone: "America/Chicago",
    slotDurationMinutes: 30, afterHours: "hours_then_message", callerNumber: "+19565550142",
    meetingType: "phone", handoffAvailable: true,
  }, new Date());
}

/**
 * One socket to REALTIME_MODEL. `fail` turns a transport outcome (a refused upgrade as its status code, a socket
 * error as its class, a close as its code, the timeout) into this check's result; the handlers settle it otherwise.
 */
function runSession<T>(key: string, timeoutMs: number, fail: (why: string) => T,
  handlers: (send: (o: unknown) => void, finish: (r: T) => void) => { open: () => void; event: (ev: Ev, type: string) => void }): Promise<T> {
  return new Promise((resolve) => {
    let settled = false;
    const ws = new WebSocket(`wss://api.openai.com/v1/realtime?model=${encodeURIComponent(REALTIME_MODEL)}`,
      { headers: { Authorization: `Bearer ${key}` } });
    const finish = (r: T) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { ws.terminate(); } catch { /* already closed */ }
      resolve(r);
    };
    const timer = setTimeout(() => finish(fail(`timeout after ${timeoutMs / 1000}s`)), timeoutMs);
    const h = handlers((o) => { if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(o)); }, finish);
    ws.on("unexpected-response", (req, res) => { req.destroy(); finish(fail(`http ${res.statusCode ?? "unknown"}`)); });
    ws.on("error", (e: Error) => finish(fail(`socket error: ${e.name}`)));
    ws.on("close", (code: number) => finish(fail(`socket closed: ${code}`)));
    ws.on("open", () => h.open());
    ws.on("message", (raw) => {
      let ev: Ev;
      try { ev = JSON.parse(String(raw)) as Ev; } catch { h.event({}, "(unparseable)"); return; }
      h.event(ev, typeof ev?.type === "string" ? ev.type : "(no type)");
    });
  });
}

function trySession(key: string, variant: Variant): Promise<SpikeResult> {
  // Text only: no audio block, and the variant's switch set to text.
  const { audio, ...rest } = realConfig();
  void audio;
  const session = { ...rest, [variant]: ["text"] };
  const seen: string[] = [];
  let text = "";
  const result = (ok: boolean, why: string): SpikeResult => ({
    check: "text_only", variant, ok, why, events: countEvents(seen), textLength: text.length, nonEmpty: text.trim() !== "",
  });
  return runSession(key, TIMEOUT_MS, (why) => result(false, why), (send, finish) => ({
    open: () => send({ type: "session.update", session }),
    event: (ev, type) => {
      seen.push(type);
      if (type === "error") {
        finish(result(false, realtimeErrorWhy(ev.error)));
      } else if (type === "session.updated") {
        send({ type: "conversation.item.create", item: { type: "message", role: "user",
          content: [{ type: "input_text", text: "Hi, what are your hours?" }] } });
        send({ type: "response.create" });
      } else if (type === "response.output_text.delta") {
        text += typeof ev.delta === "string" ? ev.delta : "";
      } else if (type === "response.done") {
        const status = statusOf(ev);
        finish(result(text.trim() !== "", text.trim() ? `text reply received (status ${status})` : `response.done with no text (status ${status})`));
      }
    },
  }));
}

type ConfigResult = { check: "session_config"; transcriber: string; ok: boolean; why: string; echoed: string };

/** The FULL config, audio block kept, with this transcriber: does the session take it? */
function checkConfig(key: string, transcriber: string): Promise<ConfigResult> {
  const session = withTranscriber(realConfig(), transcriber);
  const result = (ok: boolean, why: string, echoed = ""): ConfigResult => ({ check: "session_config", transcriber, ok, why, echoed });
  return runSession(key, TIMEOUT_MS, (why) => result(false, why), (send, finish) => ({
    open: () => send({ type: "session.update", session }),
    event: (ev, type) => {
      if (type === "error") finish(result(false, realtimeErrorWhy(ev.error)));
      else if (type === "session.updated") finish(result(true, "session.updated", echoedTranscriber(ev)));
    },
  }));
}

type Spoken = { ok: boolean; why: string; audio: Buffer };

/** The model reads one fixed sentence aloud; its audio is what the round trip feeds a transcriber. */
function speak(key: string, lang: Lang): Promise<Spoken> {
  const chunks: Buffer[] = [];
  const session = {
    type: "realtime", output_modalities: ["audio"], audio: { output: { voice: "marin" } },
    instructions: "You are a reading voice. Read the user's sentence aloud exactly as written, in its own language, and say nothing else.",
  };
  return runSession<Spoken>(key, TIMEOUT_MS, (why) => ({ ok: false, why, audio: Buffer.alloc(0) }), (send, finish) => ({
    open: () => send({ type: "session.update", session }),
    event: (ev, type) => {
      if (type === "error") {
        finish({ ok: false, why: realtimeErrorWhy(ev.error), audio: Buffer.alloc(0) });
      } else if (type === "session.updated") {
        send({ type: "conversation.item.create", item: { type: "message", role: "user",
          content: [{ type: "input_text", text: ROUND_TRIP_SENTENCES[lang] }] } });
        send({ type: "response.create" });
      } else if ((type === "response.output_audio.delta" || type === "response.audio.delta") && typeof ev.delta === "string") {
        chunks.push(Buffer.from(ev.delta, "base64"));
      } else if (type === "response.done") {
        const audio = Buffer.concat(chunks);
        finish({ ok: audio.length > 0, why: audio.length ? "audio received" : `response.done with no audio (status ${statusOf(ev)})`, audio });
      }
    },
  }));
}

type RoundTrip = { check: "round_trip"; transcriber: string; lang: Lang; ok: boolean; why: string; commit: "vad" | "manual" | "none" } & TranscriptionResult;

/** The full config with this transcriber hears the spoken sentence: do `.delta` and `.completed` arrive? */
function listen(key: string, transcriber: string, lang: Lang, audio: Buffer): Promise<RoundTrip> {
  const tracker = transcriptionTracker();
  let commit: RoundTrip["commit"] = "none";
  let ready = false;
  let manual: ReturnType<typeof setTimeout> | undefined;
  const result = (ok: boolean, why: string): RoundTrip => {
    clearTimeout(manual);
    return { check: "round_trip", transcriber, lang, ok, why, commit, ...tracker.result() };
  };
  return runSession(key, ROUND_TRIP_TIMEOUT_MS, (why) => result(false, why), (send, finish) => ({
    open: () => send({ type: "session.update", session: withTranscriber(realConfig(), transcriber) }),
    event: (ev, type) => {
      tracker.onEvent(ev);
      if (type === "error" && !ready) {
        finish(result(false, realtimeErrorWhy(ev.error)));
      } else if (type === "session.updated" && !ready) {
        ready = true;
        const pcm = Buffer.concat([audio, Buffer.alloc(TRAILING_SILENCE_BYTES)]);
        for (let i = 0; i < pcm.length; i += BYTES_PER_SECOND) {
          send({ type: "input_audio_buffer.append", audio: pcm.subarray(i, i + BYTES_PER_SECOND).toString("base64") });
        }
        manual = setTimeout(() => { if (commit === "none") { commit = "manual"; send({ type: "input_audio_buffer.commit" }); } }, MANUAL_COMMIT_AFTER_MS);
      } else if (type === "input_audio_buffer.committed" && commit === "none") {
        commit = "vad";
      } else if (type === "conversation.item.input_audio_transcription.completed" || type === "conversation.item.input_audio_transcription.failed") {
        const r = tracker.result();
        finish(result(r.deltas > 0 && r.completed, r.completed ? "transcription completed" : "transcription failed"));
      }
    },
  }));
}

async function main(): Promise<void> {
  if (!(REALTIME_MODEL_CHOICES as readonly string[]).includes(REALTIME_MODEL)) {
    console.error(`REALTIME_MODEL must be one of: ${REALTIME_MODEL_CHOICES.join(", ")}`);
    process.exit(2);
  }
  const key = process.env.OPENAI_API_KEY ?? "";
  if (!key) {
    console.error("OPENAI_API_KEY is not set in this shell (it is never read from a file)");
    process.exit(2);
  }
  console.log(JSON.stringify({ check: "model", model: REALTIME_MODEL }));
  let anyText = false;
  for (const variant of VARIANTS) {
    const result = await trySession(key, variant);
    console.log(JSON.stringify(result));
    anyText ||= result.ok;
  }
  for (const transcriber of TRANSCRIBE_CANDIDATES) console.log(JSON.stringify(await checkConfig(key, transcriber)));
  for (const lang of Object.keys(ROUND_TRIP_SENTENCES) as Lang[]) {
    const spoken = await speak(key, lang);
    console.log(JSON.stringify({ check: "speaker", lang, ok: spoken.ok, why: spoken.why, bytes: spoken.audio.length }));
    for (const transcriber of TRANSCRIBE_CANDIDATES) {
      console.log(JSON.stringify(spoken.audio.length
        ? await listen(key, transcriber, lang, spoken.audio)
        : { check: "round_trip", transcriber, lang, ok: false, why: "not run: the speaker produced no audio" }));
    }
  }
  process.exit(anyText ? 0 : 1);
}

void main();
