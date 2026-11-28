import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { FAKE_REALTIME, FAKE_TRANSCRIBE, stubVoiceModels } from "./testing/voice-models";

/**
 * The two voice model vars are trimmed (model switch PR 4, review Minor): a value pasted into Vercel with a trailing
 * newline or space must not become the model name OpenAI is sent, and a whitespace-only value reads as unset.
 * Read at module load, so each case stubs the env, resets modules and imports fresh.
 */
async function models(realtime: string, transcribe: string) {
  stubVoiceModels({ realtime, transcribe });
  vi.resetModules();
  const m = await import("./session-config");
  return [m.REALTIME_MODEL, m.TRANSCRIBE_MODEL];
}

beforeEach(() => { vi.resetModules(); });
afterEach(() => { vi.unstubAllEnvs(); vi.resetModules(); });

describe("the voice model env is trimmed (mutation: drop the trim -> FAILS)", () => {
  it("a pasted trailing newline or surrounding spaces are cut from both names", async () => {
    expect(await models(`${FAKE_REALTIME}\n`, `  ${FAKE_TRANSCRIBE} \r\n`)).toEqual([FAKE_REALTIME, FAKE_TRANSCRIBE]);
  });
  it("a whitespace-only value reads as unset: today's two defaults", async () => {
    expect(await models(" \n", "\t ")).toEqual(["gpt-realtime", "gpt-4o-mini-transcribe"]);
  });
});
