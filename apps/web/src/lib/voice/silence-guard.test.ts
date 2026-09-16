import { describe, it, expect } from "vitest";
import { readSilentSeconds, isCallerAudioEvent, silenceGoodbye } from "./silence-guard";

const env = (o: Record<string, string>) => o as unknown as NodeJS.ProcessEnv;

describe("readSilentSeconds", () => {
  it("defaults to 30 with no configuration", () => {
    expect(readSilentSeconds(env({}))).toBe(30);
  });
  it("reads an override from env", () => {
    expect(readSilentSeconds(env({ PHONE_MAX_SILENT_SECONDS: "45" }))).toBe(45);
  });
  it("ignores junk rather than disabling the guard", () => {
    expect(readSilentSeconds(env({ PHONE_MAX_SILENT_SECONDS: "abc" }))).toBe(30);
    expect(readSilentSeconds(env({ PHONE_MAX_SILENT_SECONDS: "-5" }))).toBe(30);
    expect(readSilentSeconds(env({ PHONE_MAX_SILENT_SECONDS: "0" }))).toBe(30);
  });
  it("clamps to 5..120 — never long enough to be useless, never short enough to cut off a slow greeting", () => {
    expect(readSilentSeconds(env({ PHONE_MAX_SILENT_SECONDS: "1" }))).toBe(5);
    expect(readSilentSeconds(env({ PHONE_MAX_SILENT_SECONDS: "9999" }))).toBe(120);
  });
});

describe("isCallerAudioEvent", () => {
  it("accepts the whole input_audio_buffer namespace — the fast signal", () => {
    expect(isCallerAudioEvent("input_audio_buffer.speech_started")).toBe(true);
    expect(isCallerAudioEvent("input_audio_buffer.speech_stopped")).toBe(true);
    expect(isCallerAudioEvent("input_audio_buffer.committed")).toBe(true);
  });
  it("accepts the transcription completion — the signal classifyOutcome itself keys spam off", () => {
    expect(isCallerAudioEvent("conversation.item.input_audio_transcription.completed")).toBe(true);
  });
  it("rejects assistant and response events — Sofía talking is not the caller speaking", () => {
    expect(isCallerAudioEvent("response.output_audio_transcript.done")).toBe(false);
    expect(isCallerAudioEvent("response.created")).toBe(false);
    expect(isCallerAudioEvent("response.function_call_arguments.done")).toBe(false);
    expect(isCallerAudioEvent("session.updated")).toBe(false);
  });
  it("rejects a missing or empty type without throwing", () => {
    expect(isCallerAudioEvent(undefined)).toBe(false);
    expect(isCallerAudioEvent("")).toBe(false);
  });
  it("rejects a truthy NON-STRING type without throwing — the payload is untrusted JSON", () => {
    // `RealtimeCallEvent.type` is DECLARED `string | undefined`, but it is
    // `JSON.parse`d off a socket: nothing stops a frame carrying a number, an
    // object or an array there. Before the guard below, every one of these
    // threw out of `.startsWith`, out of `handleMessage`, and permanently
    // rejected the lifecycle's serialization chain — dropping every later
    // frame of that call while the caller kept talking.
    const bad: unknown[] = [42, 0.5, true, {}, { startsWith: "not a function" }, [], ["input_audio_buffer.x"], null];
    for (const t of bad) {
      expect(() => isCallerAudioEvent(t as unknown as string)).not.toThrow();
      expect(isCallerAudioEvent(t as unknown as string)).toBe(false);
    }
  });
  it("does not accept a merely similar prefix", () => {
    expect(isCallerAudioEvent("input_audio_buffer_cleared")).toBe(false);
    expect(isCallerAudioEvent("output_audio_buffer.started")).toBe(false);
    // The two fixtures above contain the namespace as no substring at all, so
    // they pass under BOTH matchers and prove neither. These two are the near
    // misses that discriminate:
    //
    //  - `startsWith("input_audio_buffer.")` vs `includes(...)`: the namespace
    //    has to be at the START of the type. An event nested under
    //    `conversation.item.` is about a conversation item, not a live input
    //    buffer.
    expect(isCallerAudioEvent("conversation.item.input_audio_buffer.committed")).toBe(false);
    //  - `type === "…transcription.completed"` vs
    //    `type.startsWith("…transcription")`: the backstop is ONE exact event,
    //    not a namespace. See the `.failed` test below for why that matters
    //    beyond the mutation.
    expect(isCallerAudioEvent("conversation.item.input_audio_transcription.completed.part")).toBe(false);
  });
  it("rejects a FAILED transcription — the one near miss that would defeat the guard by its own cancel", () => {
    // `conversation.item.input_audio_transcription.failed` is a real Realtime
    // event, and only the `.completed` variant writes a `role: "caller"`
    // transcript entry (`call-events.ts:51-57`). If this predicate ever
    // loosened from an exact match to a prefix, a call whose caller audio
    // FAILED to transcribe would cancel the timer while still classifying
    // `spam` — the guard cancelled by the very event that proves it should
    // have fired.
    expect(isCallerAudioEvent("conversation.item.input_audio_transcription.failed")).toBe(false);
  });
});

describe("silenceGoodbye", () => {
  it("is the CONSTRAINED form, not the cap's open-ended wrap-up", () => {
    // The distinction is the whole reason the 247s call produced a fabricated
    // record: asking a model to "wrap up" a conversation that never happened
    // is asking it to invent one. See the spec's "The call this feature is
    // built from".
    expect(silenceGoodbye("en")).toContain("exactly");
    expect(silenceGoodbye("en")).not.toContain("wrap up");
  });
  it("speaks Spanish for an es-only profile, English otherwise — mirroring the greeting's own rule", () => {
    expect(silenceGoodbye("es")).toContain("No puedo escuchar");
    expect(silenceGoodbye("en")).toContain("can't hear");
    // `both` takes English, exactly as the greeting does at
    // incoming/route.ts:746 (`languages === "es" ? greeting_es : greeting_en`).
    expect(silenceGoodbye("both")).toBe(silenceGoodbye("en"));
  });
});
