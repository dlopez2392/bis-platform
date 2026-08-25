import { describe, it, expect } from "vitest";
import { readTurnDetection } from "./turn-detection";

describe("readTurnDetection", () => {
  // `readTurnDetection`'s env param defaults to `process.env`, so its type is
  // the full `NodeJS.ProcessEnv` (many ambient-required keys, e.g. NODE_ENV)
  // — these tests only care about the PHONE_* subset, so a plain object
  // literal needs a cast rather than satisfying that whole interface.
  it("defaults to semantic_vad at medium", () => {
    expect(readTurnDetection({} as unknown as NodeJS.ProcessEnv)).toEqual({
      type: "semantic_vad", eagerness: "medium", create_response: true, interrupt_response: true,
    });
  });
  it("PHONE_TURN_DETECTION=server yields clamped server_vad", () => {
    expect(readTurnDetection({
      PHONE_TURN_DETECTION: "server", PHONE_VAD_SILENCE_MS: "100", PHONE_VAD_THRESHOLD: "9",
    } as unknown as NodeJS.ProcessEnv)).toEqual({
      type: "server_vad", threshold: 1, prefix_padding_ms: 300, silence_duration_ms: 200,
      create_response: true, interrupt_response: true,
    });
  });
  it("junk eagerness falls back to medium", () => {
    expect(readTurnDetection({ PHONE_VAD_EAGERNESS: "warp" } as unknown as NodeJS.ProcessEnv))
      .toMatchObject({ type: "semantic_vad", eagerness: "medium" });
  });
  it("blank env vars fall back to defaults, not 0", () => {
    expect(readTurnDetection({
      PHONE_TURN_DETECTION: "server", PHONE_VAD_THRESHOLD: "", PHONE_VAD_SILENCE_MS: "   ",
    } as unknown as NodeJS.ProcessEnv)).toEqual({
      type: "server_vad", threshold: 0.6, prefix_padding_ms: 300, silence_duration_ms: 800,
      create_response: true, interrupt_response: true,
    });
  });
});
