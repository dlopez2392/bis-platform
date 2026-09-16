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
  it("does not accept a merely similar prefix", () => {
    expect(isCallerAudioEvent("input_audio_buffer_cleared")).toBe(false);
    expect(isCallerAudioEvent("output_audio_buffer.started")).toBe(false);
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
    // incoming/route.ts:507 (`languages === "es" ? greeting_es : greeting_en`).
    expect(silenceGoodbye("both")).toBe(silenceGoodbye("en"));
  });
});
