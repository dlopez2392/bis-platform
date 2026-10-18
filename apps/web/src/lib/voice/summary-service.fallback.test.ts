import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const gw = vi.hoisted(() => ({ aiComplete: vi.fn() }));
vi.mock("@/lib/ai/gateway", async (importOriginal) => ({ ...(await importOriginal<object>()), aiComplete: gw.aiComplete }));

import { generateSummary } from "./summary-service";
import { AI_REFUSALS } from "@/lib/ai/gateway";
import { emptyCallState, withTranscript } from "./call-state";
import { summaryFactLine } from "./summarize";
import { openGateDb } from "@/lib/ai/testing/open-gate";

/** G6: every refusal is the fact line, the same one a missing key produced before the gateway. */
const GATE = { db: openGateDb().db, accountId: "acct", timezone: "America/Chicago" };
const spoke = () => withTranscript(emptyCallState(), { role: "caller", text: "are you open saturday?", at: "t" });

// No real model call, even on the RED run against today's code (which would reach the global fetch):
// no key, and a fetch that refuses.
beforeEach(() => {
  gw.aiComplete.mockReset();
  vi.stubEnv("OPENAI_API_KEY", "");
  vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("no network in tests"); }));
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("generateSummary on the gateway (spec 3.2)", () => {
  it.each(AI_REFUSALS)("%s -> exactly the fact line (mutation: compose a fixed 'AI is off' sentence on a refusal -> FAILS)", async (reason) => {
    gw.aiComplete.mockResolvedValue({ ok: false, reason });
    const s = spoke();
    expect(await generateSummary(s, GATE)).toBe(summaryFactLine(s));
  });

  it("the spam skip makes no gateway call (mutation: call aiComplete before the spam check -> FAILS)", async () => {
    const s = withTranscript(emptyCallState(), { role: "assistant", text: "Hi, this is Sofía.", at: "t" });
    await generateSummary(s, GATE);
    expect(gw.aiComplete).not.toHaveBeenCalled();
  });

  it("asks for call_summary on gpt-4o-mini for THIS account, under 10 s, in its zone (mutation: feature 'call_card' -> FAILS)", async () => {
    gw.aiComplete.mockResolvedValue({ ok: true, text: "Caller asked about Saturday.", usage: { inputTokens: 1, outputTokens: 1, costMicroUsd: 1 } });
    const out = await generateSummary(spoke(), { ...GATE, ref: "call c1" });
    expect(gw.aiComplete).toHaveBeenCalledWith(GATE.db, expect.objectContaining({
      accountId: "acct", feature: "call_summary", model: "gpt-4o-mini", timeoutMs: 10_000, timezone: "America/Chicago", ref: "call c1",
    }));
    expect(out).toContain("Caller asked about Saturday.");
  });
});
