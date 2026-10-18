import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { TranscriptEvent } from "@bis/db";

const gw = vi.hoisted(() => ({ aiComplete: vi.fn() }));
vi.mock("@/lib/ai/gateway", async (importOriginal) => ({ ...(await importOriginal<object>()), aiComplete: gw.aiComplete }));

import { readCallForCard, NO_READING } from "./call-card";
import { AI_REFUSALS } from "@/lib/ai/gateway";
import { openGateDb } from "@/lib/ai/testing/open-gate";

const GATE = { db: openGateDb().db, accountId: "acct", timezone: "America/Chicago" };
const transcript: TranscriptEvent[] = [{ role: "caller", text: "my roof started leaking last night", at: "t" }];

// No real model call, even on the RED run against today's code (which would reach the global fetch):
// no key, and a fetch that refuses.
beforeEach(() => {
  gw.aiComplete.mockReset();
  vi.stubEnv("OPENAI_API_KEY", "");
  vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("no network in tests"); }));
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("readCallForCard on the gateway (spec 3.2, choice I1)", () => {
  it.each(AI_REFUSALS)("%s -> no reading (mutation: parse the refusal as an empty JSON object and return { reason: '', ... } -> FAILS)", async (reason) => {
    gw.aiComplete.mockResolvedValue({ ok: false, reason });
    expect(await readCallForCard(transcript, GATE)).toEqual(NO_READING);
  });

  it("asks for call_card in JSON mode, 300 tokens, 10 s, naming the call in its log ref (mutation: feature 'call_summary' -> FAILS)", async () => {
    gw.aiComplete.mockResolvedValue({ ok: true, text: JSON.stringify({ reason: null, quote: null }), usage: { inputTokens: 1, outputTokens: 1, costMicroUsd: 1 } });
    await readCallForCard(transcript, { ...GATE, label: "finishCall call1" });
    expect(gw.aiComplete).toHaveBeenCalledWith(GATE.db, expect.objectContaining({
      accountId: "acct", feature: "call_card", model: "gpt-4o-mini", responseFormat: { type: "json_object" },
      maxTokens: 300, timeoutMs: 10_000, timezone: "America/Chicago", ref: "finishCall call1",
    }));
  });
});
