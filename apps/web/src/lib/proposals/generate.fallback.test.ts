import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { TranscriptEvent } from "@bis/db";

const gw = vi.hoisted(() => ({ aiComplete: vi.fn() }));
vi.mock("@/lib/ai/gateway", async (importOriginal) => ({ ...(await importOriginal<object>()), aiComplete: gw.aiComplete }));

import { generateProposals } from "./generate";
import { AI_REFUSALS } from "@/lib/ai/gateway";

/** G6: proposals fall back to none. A stand-in client that records every table it is asked for. */
function recordingDb() {
  const tables: string[] = [];
  return { tables, db: { from: (t: string) => { tables.push(t); throw new Error(`no write expected to ${t}`); } } as never };
}
const t = (role: "caller" | "assistant", text: string): TranscriptEvent => ({ role, text, at: "2026-09-18T12:00:00.000Z" });
const base = {
  accountId: "acct", callId: "call1", contactId: null, outcome: "lead" as const,
  transcript: [t("assistant", "How can I help?"), t("caller", "Can someone call me back about a quote?")],
  handoffRequested: false, blankFields: [], openOpportunity: null, callbackTodo: false,
  now: new Date("2026-09-18T13:00:00.000Z"), timezone: "America/Chicago",
};

// No real model call, even on the RED run against today's code (which would reach the global fetch):
// no key, and a fetch that refuses.
beforeEach(() => {
  gw.aiComplete.mockReset();
  vi.stubEnv("OPENAI_API_KEY", "");
  vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("no network in tests"); }));
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("generateProposals on the gateway (spec 3.2)", () => {
  it.each(AI_REFUSALS)("%s -> 0 proposals and no write (mutation: on a refusal, parse '{\"proposals\":[...]}' anyway -> FAILS)", async (reason) => {
    gw.aiComplete.mockResolvedValue({ ok: false, reason });
    const { db, tables } = recordingDb();
    expect(await generateProposals({ ...base, db })).toBe(0);
    expect(tables).toEqual([]);
  });

  it("an ineligible call makes no gateway call at all (mutation: call aiComplete before callIsEligible -> FAILS)", async () => {
    const { db } = recordingDb();
    expect(await generateProposals({ ...base, db, outcome: "spam" })).toBe(0);
    expect(gw.aiComplete).not.toHaveBeenCalled();
  });

  it("asks for call_proposals on gpt-4o-mini in JSON mode, 2000 tokens, 10 s, the account's zone, naming the call (mutation: maxTokens 4000 -> FAILS)", async () => {
    gw.aiComplete.mockResolvedValue({ ok: true, text: JSON.stringify({ proposals: [] }), usage: { inputTokens: 1, outputTokens: 1, costMicroUsd: 1 } });
    const { db } = recordingDb();
    await generateProposals({ ...base, db });
    expect(gw.aiComplete).toHaveBeenCalledWith(db, expect.objectContaining({
      accountId: "acct", feature: "call_proposals", model: "gpt-4o-mini", responseFormat: { type: "json_object" },
      maxTokens: 2000, timeoutMs: 10_000, timezone: "America/Chicago", ref: "call call1",
    }));
  });
});
