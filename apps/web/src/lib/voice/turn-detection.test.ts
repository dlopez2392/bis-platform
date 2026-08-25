import { describe, it, expect } from "vitest";
import { readTurnDetection } from "./turn-detection";

describe("readTurnDetection", () => {
  it("defaults to semantic_vad at medium", () => {
    expect(readTurnDetection({} as any)).toEqual({
      type: "semantic_vad", eagerness: "medium", create_response: true, interrupt_response: true,
    });
  });
  it("PHONE_TURN_DETECTION=server yields clamped server_vad", () => {
    expect(readTurnDetection({
      PHONE_TURN_DETECTION: "server", PHONE_VAD_SILENCE_MS: "100", PHONE_VAD_THRESHOLD: "9",
    } as any)).toEqual({
      type: "server_vad", threshold: 1, prefix_padding_ms: 300, silence_duration_ms: 200,
      create_response: true, interrupt_response: true,
    });
  });
  it("junk eagerness falls back to medium", () => {
    expect(readTurnDetection({ PHONE_VAD_EAGERNESS: "warp" } as any))
      .toMatchObject({ type: "semantic_vad", eagerness: "medium" });
  });
});
