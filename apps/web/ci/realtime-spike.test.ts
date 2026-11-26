import { describe, it, expect, vi } from "vitest";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { realtimeErrorWhy } from "../scripts/realtime-spike-why";
import {
  countEvents, echoedTranscriber, REALTIME_MODEL_CHOICES, TRANSCRIBE_CANDIDATES, TRANSCRIPT_CAP, transcriptionTracker, withTranscriber,
} from "../scripts/realtime-spike-checks";
import { buildRealtimeSessionConfig } from "../src/lib/voice/session-config";

// apps/web/scripts/realtime-spike.ts (S-47b Task 0) runs in sofia-corpus.yml,
// whose log is PUBLIC. It may print event types and a capped reply, never the
// key, a header, an environment value or an error's free-text message (a
// message can echo what was sent). These cases run it for real WITHOUT a key,
// so it must stop before opening any connection; nothing here touches the
// network.

const SPIKE = fileURLToPath(new URL("../scripts/realtime-spike.ts", import.meta.url));
const SPIKE_WHY = fileURLToPath(new URL("../scripts/realtime-spike-why.ts", import.meta.url));
const WEB =fileURLToPath(new URL("..", import.meta.url));
const TSX_CLI = createRequire(import.meta.url).resolve("tsx/cli");

vi.setConfig({ testTimeout: 60_000 });

describe("realtime-spike.ts", () => {
  it("with no OPENAI_API_KEY, exits 2 naming the variable, before any connection, printing nothing on stdout", () => {
    const env = { ...process.env };
    delete env.OPENAI_API_KEY;
    const r = spawnSync(process.execPath, [TSX_CLI, SPIKE], { cwd: WEB, env, encoding: "utf8" });
    expect(r.status, r.stderr).toBe(2);
    expect(r.stderr).toContain("OPENAI_API_KEY is not set");
    expect(r.stdout).toBe("");
  });

  describe("realtimeErrorWhy: an OpenAI error event's `error`, as the one `why` line the public log may show", () => {
    const SENTINEL = "SENTINEL-sk-proj-do-not-print";
    /** An error whose every free-text path (message, toString, toJSON, a nested object) carries the sentinel. */
    const hostile = () => ({
      code: "invalid_value", type: "invalid_request_error", param: "session.modalities",
      message: SENTINEL,
      details: { echoed: SENTINEL },
      toString: () => SENTINEL,
      toJSON: () => ({ message: SENTINEL }),
    });

    it("reads code, type and param, and nothing else (mutation: append JSON.stringify(error), `${error}` or error[\"message\"] → FAILS)", () => {
      const why = realtimeErrorWhy(hostile());
      expect(why).toBe("error: invalid_value / invalid_request_error / param session.modalities");
      expect(why).not.toContain("SENTINEL");
    });

    it("never stringifies a code, type or param that is not a plain string (an object's toString is free text)", () => {
      const sneaky = { toString: () => SENTINEL };
      const why = realtimeErrorWhy({ code: sneaky, type: sneaky, param: sneaky, message: SENTINEL });
      expect(why).toBe("error: no code / no type");
      expect(why).not.toContain("SENTINEL");
    });

    it("keeps only identifier characters, capped, so a code cannot smuggle a sentence", () => {
      const why = realtimeErrorWhy({ code: `bad code: ${SENTINEL} with spaces`, type: "x".repeat(200) });
      expect(why).not.toContain(" with ");
      expect(why).not.toContain(": SENTINEL");
      expect(why.length).toBeLessThan(200);
    });

    it("answers for an error that is missing, a string, or an Error instance without reading its text", () => {
      expect(realtimeErrorWhy(undefined)).toBe("error: no code / no type");
      expect(realtimeErrorWhy(SENTINEL)).toBe("error: no code / no type");
      const e = Object.assign(new Error(SENTINEL), { code: "rate_limit_exceeded" });
      expect(realtimeErrorWhy(e)).toBe("error: rate_limit_exceeded / no type");
    });
  });

  it("with a REALTIME_MODEL outside the workflow's fixed choice, exits 2 naming the choice, before the key or any connection (mutation: drop the check → FAILS)", () => {
    const env: NodeJS.ProcessEnv = { ...process.env, REALTIME_MODEL: "gpt-4o" };
    delete env.OPENAI_API_KEY;
    const r = spawnSync(process.execPath, [TSX_CLI, SPIKE], { cwd: WEB, env, encoding: "utf8" });
    expect(r.status, r.stderr).toBe(2);
    expect(r.stderr).toContain("REALTIME_MODEL must be one of: gpt-realtime, gpt-realtime-2.1");
    expect(r.stdout).toBe("");
  });

  describe("realtime-spike-checks.ts: the transcription checks (OpenAI model switch plan, Step 0 (b))", () => {
    const SENTINEL = "SENTINEL-sk-proj-do-not-print";
    const cfg = () => buildRealtimeSessionConfig({
      personaName: "Sofía", businessName: "Spike Test Co", facts: "- Open 9 to 5.", services: "Testing",
      languages: "both", bookingEnabled: true, timezone: "America/Chicago", slotDurationMinutes: 30,
      afterHours: "hours_then_message", callerNumber: "+19565550142", meetingType: "phone", handoffAvailable: true,
    }, new Date("2026-11-26T15:00:00Z"));

    it("tries the plan's three transcription candidates, in its order, and offers the two Realtime models the workflow does", () => {
      expect(TRANSCRIBE_CANDIDATES).toEqual(["gpt-transcribe", "gpt-live-transcribe", "gpt-4o-mini-transcribe-2025-12-15"]);
      expect(REALTIME_MODEL_CHOICES).toEqual(["gpt-realtime", "gpt-realtime-2.1"]);
    });

    it("withTranscriber keeps the FULL session config, audio block included, and changes only the transcription model (mutation: drop `audio`, or replace audio.input → FAILS)", () => {
      const before = cfg();
      const snapshot = structuredClone(before);
      const after = withTranscriber(before, "gpt-transcribe");
      expect(after.audio.input.transcription.model).toBe("gpt-transcribe");
      expect({ ...after, audio: { ...after.audio, input: { ...after.audio.input, transcription: snapshot.audio.input.transcription } } })
        .toEqual(snapshot);
      expect(after.audio.input.turn_detection).toEqual(snapshot.audio.input.turn_detection);
      expect(after.audio.output.voice).toBe("marin");
      expect(before).toEqual(snapshot); // the input is not mutated
    });

    it("the tracker counts deltas, keeps .completed's transcript capped at 120 characters, and the usage's SHAPE only", () => {
      const t = transcriptionTracker();
      t.onEvent({ type: "conversation.item.input_audio_transcription.delta", delta: "Hola, " });
      t.onEvent({ type: "conversation.item.input_audio_transcription.delta", delta: { toString: () => SENTINEL } });
      t.onEvent({ type: "conversation.item.input_audio_transcription.delta", delta: "quisiera" });
      t.onEvent({
        type: "conversation.item.input_audio_transcription.completed", transcript: "x".repeat(300),
        usage: { type: "tokens", input_tokens: 31, output_tokens: 12, total_tokens: 43, input_token_details: { audio_tokens: 31 }, note: SENTINEL },
      });
      const r = t.result();
      expect(r.deltas).toBe(3);
      expect(r.completed).toBe(true);
      expect(r.transcript).toBe("x".repeat(TRANSCRIPT_CAP));
      expect(TRANSCRIPT_CAP).toBe(120);
      expect(r.usage).toBe("tokens {input_token_details, input_tokens, note, output_tokens, total_tokens, type}");
      expect(JSON.stringify(r)).not.toContain("SENTINEL");
    });

    it("the tracker falls back to the deltas' text when .completed carries none, and says so when nothing arrived", () => {
      const t = transcriptionTracker();
      t.onEvent({ type: "conversation.item.input_audio_transcription.delta", delta: "Hi, I'd like" });
      t.onEvent({ type: "conversation.item.input_audio_transcription.completed" });
      expect(t.result()).toMatchObject({ deltas: 1, completed: true, transcript: "Hi, I'd like", usage: "none" });
      expect(transcriptionTracker().result()).toEqual({ deltas: 0, completed: false, transcript: "", usage: "none", errors: [] });
    });

    it("the tracker records an error or a failed transcription as code / type / param only (mutation: push the event's message → FAILS)", () => {
      const t = transcriptionTracker();
      const error = { code: "model_not_found", type: "invalid_request_error", param: "session.audio.input.transcription.model", message: SENTINEL };
      t.onEvent({ type: "error", error });
      t.onEvent({ type: "conversation.item.input_audio_transcription.failed", error: { ...error, code: "transcription_failed" } });
      const r = t.result();
      expect(r.errors).toEqual([
        "error: model_not_found / invalid_request_error / param session.audio.input.transcription.model",
        "transcription failed: error: transcription_failed / invalid_request_error / param session.audio.input.transcription.model",
      ]);
      expect(JSON.stringify(r)).not.toContain("SENTINEL");
    });

    it("countEvents counts the known event types and folds every other one into `other`, so no event name the server invents reaches the log (mutation: count any type → FAILS)", () => {
      const counts = countEvents(["session.created", "session.updated", "response.output_text.delta", "response.output_text.delta",
        `${SENTINEL} said hi`, "response.output_text.delta.extra", "response.done"]);
      expect(counts).toEqual({ "session.created": 1, "session.updated": 1, "response.output_text.delta": 2, "response.done": 1, other: 2 });
      expect(JSON.stringify(counts)).not.toContain("SENTINEL");
      expect(countEvents([])).toEqual({});
    });

    it("echoedTranscriber reads session.updated's transcription model as identifier characters, and nothing else", () => {
      expect(echoedTranscriber({ session: { audio: { input: { transcription: { model: "gpt-transcribe" } } } } })).toBe("gpt-transcribe");
      expect(echoedTranscriber({ session: { audio: { input: { transcription: { model: `${SENTINEL} said hi` } } } } })).not.toContain(" ");
      expect(echoedTranscriber({ session: { audio: { input: { transcription: null } } } })).toBe("");
      expect(echoedTranscriber(SENTINEL)).toBe("");
    });
  });

  it("never reads an error's message, and never prints the environment (mutation: log `ev.error?.message` → FAILS)", () => {
    const code = [SPIKE, SPIKE_WHY].map((f) => fs.readFileSync(f, "utf8")).join("\n")
      .split("\n").filter((l) => !/^\s*(\/\/|\*|\/\*\*)/.test(l)).join("\n");
    expect(code).not.toMatch(/\.message\b/);
    expect(code).not.toMatch(/console\.\w+\([^)]*process\.env/);
    expect(code).not.toMatch(/JSON\.stringify\(\s*process\.env/);
  });
});
