import { describe, it, expect } from "vitest";
import { buildRealtimeSessionConfig } from "./session-config";

const base = {
  personaName: "Sofía", businessName: "Rio Roofing", greeting: "Hi.",
  facts: "-", services: "-", languages: "both" as const, bookingEnabled: true,
  timezone: "America/Chicago", slotDurationMinutes: 60,
  afterHours: "hours_then_message" as const, callerNumber: null,
};

describe("buildRealtimeSessionConfig", () => {
  it("is the FLAT session shape with tools, transcription, VAD and voice", () => {
    const c = buildRealtimeSessionConfig(base, new Date()) as any;
    expect(c.type).toBe("realtime");
    expect(typeof c.model).toBe("string");
    expect(typeof c.instructions).toBe("string");
    expect(Array.isArray(c.tools)).toBe(true);
    expect(c.tools.map((t: any) => t.name)).toContain("book_appointment");
    expect(c.audio.input.transcription).toEqual({ model: "gpt-4o-mini-transcribe" });
    expect(c.audio.input.noise_reduction).toEqual({ type: "near_field" });
    expect(c.audio.input.turn_detection.type).toBe("semantic_vad");
    expect(c.audio.output.voice).toBe("marin");
    expect(c.session).toBeUndefined(); // FLAT — the accept endpoint rejects nesting
  });
  it("booking disabled drops booking tools from the session", () => {
    const c = buildRealtimeSessionConfig({ ...base, bookingEnabled: false }, new Date()) as any;
    expect(c.tools.map((t: any) => t.name)).not.toContain("book_appointment");
  });
});
