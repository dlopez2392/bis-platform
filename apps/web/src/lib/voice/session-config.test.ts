import { describe, it, expect } from "vitest";
import { buildRealtimeSessionConfig } from "./session-config";

const base = {
  personaName: "Sofía", businessName: "Rio Roofing", greeting: "Hi.",
  facts: "-", services: "-", languages: "both" as const, bookingEnabled: true,
  timezone: "America/Chicago", slotDurationMinutes: 60,
  afterHours: "hours_then_message" as const, callerNumber: null,
  meetingType: "in_person" as const,
};

// Loosely mirrors the FLAT session shape `buildRealtimeSessionConfig`
// returns — just the fields this test reads, plus the `session` key it
// asserts is ABSENT (the return type has no such field, so a plain
// `ReturnType<...>` cast can't express that negative check).
type SessionConfigShape = {
  type: string; model: string; instructions: string;
  tools: { name: string }[];
  audio: {
    input: { transcription: unknown; noise_reduction: unknown; turn_detection: { type: string } };
    output: { voice: string };
  };
  session?: unknown;
};

describe("buildRealtimeSessionConfig", () => {
  it("is the FLAT session shape with tools, transcription, VAD and voice", () => {
    const c = buildRealtimeSessionConfig(base, new Date()) as unknown as SessionConfigShape;
    expect(c.type).toBe("realtime");
    expect(typeof c.model).toBe("string");
    expect(typeof c.instructions).toBe("string");
    expect(Array.isArray(c.tools)).toBe(true);
    expect(c.tools.map((t) => t.name)).toContain("book_appointment");
    expect(c.audio.input.transcription).toEqual({ model: "gpt-4o-mini-transcribe" });
    expect(c.audio.input.noise_reduction).toEqual({ type: "near_field" });
    expect(c.audio.input.turn_detection.type).toBe("semantic_vad");
    expect(c.audio.output.voice).toBe("marin");
    expect(c.session).toBeUndefined(); // FLAT — the accept endpoint rejects nesting
  });
  it("booking disabled drops booking tools from the session", () => {
    const c = buildRealtimeSessionConfig({ ...base, bookingEnabled: false }, new Date()) as unknown as SessionConfigShape;
    expect(c.tools.map((t) => t.name)).not.toContain("book_appointment");
  });
  // D-040: "Always take a message" means no booking on the call, so the
  // session must not hand the model the tools to do it — a prompt saying
  // "do not book" beside a book_appointment tool is the contradiction the
  // 2026-08-30 call showed the model resolving the wrong way.
  it("Always take a message drops book_appointment even when booking is allowed, and keeps take_message", () => {
    const c = buildRealtimeSessionConfig(
      { ...base, bookingEnabled: true, afterHours: "message_only" }, new Date(),
    ) as unknown as SessionConfigShape;
    const names = c.tools.map((t) => t.name);
    expect(names).not.toContain("book_appointment");
    expect(names).toContain("take_message");
  });
  // Owner decision A (2026-10-09): it replaces NEW booking only — an existing
  // appointment can still be found, moved (to a time check_availability
  // offers) or cancelled.
  it("Always take a message keeps the existing-appointment tools (mutation: withhold every booking tool → FAILS)", () => {
    const c = buildRealtimeSessionConfig(
      { ...base, bookingEnabled: true, afterHours: "message_only" }, new Date(),
    ) as unknown as SessionConfigShape;
    const names = c.tools.map((t) => t.name);
    for (const t of ["find_my_booking", "reschedule_appointment", "cancel_appointment", "check_availability"]) {
      expect(names).toContain(t);
    }
  });

  // `handoffAvailable` is OPTIONAL, and the direction of its default is a
  // safety property, not a style choice: an omitted flag must WITHHOLD the
  // transfer tool. `base` above has no such key — exactly the shape the web
  // demo and any future caller that never heard of the handoff pass — and
  // relaxing the check to `!== false` would advertise a transfer nobody can
  // perform. The only reason that is not already live is that the web demo
  // hard-overrides `tools: []`, which is a different fact than this default
  // being safe.
  it("an OMITTED handoffAvailable withholds transfer_to_human — the default fails closed", () => {
    const c = buildRealtimeSessionConfig(base, new Date()) as unknown as SessionConfigShape;
    expect(base).not.toHaveProperty("handoffAvailable");
    expect(c.tools.map((t) => t.name)).not.toContain("transfer_to_human");
  });

  it("...and an explicit true offers it — the flag is what decides, not the omission", () => {
    const c = buildRealtimeSessionConfig({ ...base, handoffAvailable: true }, new Date()) as unknown as SessionConfigShape;
    expect(c.tools.map((t) => t.name)).toContain("transfer_to_human");
  });
});
