import { createHash } from "node:crypto";
import { vi } from "vitest";

/**
 * TEST-ONLY (model switch PR 4). REALTIME_MODEL and TRANSCRIBE_MODEL are read when lib/voice/session-config loads,
 * so a test stubs them with `stubVoiceModels`, then `vi.resetModules()` and imports the surface fresh.
 */

/** Two names no OpenAI model will ever have, so a body carrying one can only have got it from the env. */
export const FAKE_REALTIME = "bis-test-realtime-not-a-model";
export const FAKE_TRANSCRIBE = "bis-test-transcribe-not-a-model";

/**
 * Stubs both model vars; an omitted one is "", which FORCES today's default whatever the developer's shell holds and
 * exercises the `||` fallback. The two turn-detection knobs are blanked too, so a pinned body cannot move with them.
 */
export function stubVoiceModels(models: { realtime?: string; transcribe?: string }): void {
  vi.stubEnv("REALTIME_MODEL", models.realtime ?? "");
  vi.stubEnv("TRANSCRIBE_MODEL", models.transcribe ?? "");
  vi.stubEnv("PHONE_TURN_DETECTION", "");
  vi.stubEnv("PHONE_VAD_EAGERNESS", "");
}

/** sha256 of the exact string sent, so a pin is byte for byte. */
export function bodyDigest(sent: string): string {
  return createHash("sha256").update(sent, "utf8").digest("hex");
}

type ModelFields = { model: string; audio: { input: { transcription: { model: string } } } };

/** `body` with only the named model fields replaced: what an override must produce, and nothing more. */
export function withModels<T extends ModelFields>(body: T, models: { realtime?: string; transcribe?: string }): T {
  return {
    ...body,
    model: models.realtime ?? body.model,
    audio: {
      ...body.audio,
      input: { ...body.audio.input, transcription: { ...body.audio.input.transcription, model: models.transcribe ?? body.audio.input.transcription.model } },
    },
  };
}
