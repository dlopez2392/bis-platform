import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { TranscriptEvent } from "@bis/db";

// Every task's row points at a model no caller could name. A caller that still names its own model, or that goes
// around the gateway with its own request, sends something else and fails here. (The web chat's own probe is in
// its route test; the record summary's route hands its task to a mocked gateway in its own test.)
vi.mock("@/lib/ai/tasks", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/ai/tasks")>();
  const probed = Object.fromEntries(Object.entries(actual.AI_TASKS).map(([k, r]) => [k, { ...r, primary: { ...r.primary, model: "route-probe-model" } }]));
  return { ...actual, AI_TASKS: probed };
});
vi.mock("@/lib/ai/prices", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/ai/prices")>()),
  isPricedModel: (m: string) => m === "route-probe-model",
  costMicroUsd: () => 1,
}));

import { generateSummary } from "@/lib/voice/summary-service";
import { readCallForCard } from "@/lib/voice/call-card";
import { generateProposals } from "@/lib/proposals/generate";
import { emptyCallState, withTranscript } from "@/lib/voice/call-state";
import { openGateDb } from "./testing/open-gate";

const said = (role: "caller" | "assistant", text: string): TranscriptEvent => ({ role, text, at: "2026-09-18T12:00:00.000Z" });
const transcript = [said("assistant", "How can I help?"), said("caller", "Can someone call me back about a quote?")];

function capture(content: string) {
  const bodies: { model: string }[] = [];
  const fetchImpl = vi.fn(async (_u: string, init: RequestInit) => {
    bodies.push(JSON.parse(String(init.body)) as { model: string });
    return new Response(JSON.stringify({ choices: [{ message: { content } }], usage: { prompt_tokens: 1, completion_tokens: 1 } }), { status: 200 });
  }) as unknown as typeof fetch;
  return { fetchImpl, bodies };
}
const ledgerModels = (calls: { fn: string; args: Record<string, unknown> }[]) => calls.filter((c) => c.fn === "ai_ledger_record").map((c) => c.args.p_model);

beforeEach(() => {
  vi.stubEnv("OPENAI_API_KEY", "sk-test");
  vi.stubEnv("AI_GATEWAY_OFF", "");
  vi.stubEnv("AI_PROVIDER", "");
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

describe("every text caller sends its task row's model, never its own (mutation: a literal model in any caller -> FAILS)", () => {
  it("the call summary", async () => {
    const { db, calls } = openGateDb();
    const { fetchImpl, bodies } = capture("Caller asked for a quote.");
    await generateSummary(withTranscript(emptyCallState(), said("caller", "are you open saturday?")), { db, accountId: "acct", timezone: "America/Chicago", fetchImpl });
    expect(bodies.map((b) => b.model)).toEqual(["route-probe-model"]);
    expect(ledgerModels(calls)).toEqual(["route-probe-model"]);
  });

  it("the call card", async () => {
    const { db, calls } = openGateDb();
    const { fetchImpl, bodies } = capture(JSON.stringify({ reason: null, quote: null }));
    await readCallForCard(transcript, { db, accountId: "acct", timezone: "America/Chicago", fetchImpl });
    expect(bodies.map((b) => b.model)).toEqual(["route-probe-model"]);
    expect(ledgerModels(calls)).toEqual(["route-probe-model"]);
  });

  it("the call's suggestions", async () => {
    const { db, calls } = openGateDb();
    const { fetchImpl, bodies } = capture(JSON.stringify({ proposals: [] }));
    await generateProposals({
      db, fetchImpl, accountId: "acct", callId: "call1", contactId: null, outcome: "lead", transcript,
      handoffRequested: false, blankFields: [], openOpportunity: null, callbackTodo: false,
      now: new Date("2026-09-18T13:00:00.000Z"), timezone: "America/Chicago", language: "en",
    });
    expect(bodies.map((b) => b.model)).toEqual(["route-probe-model"]);
    expect(ledgerModels(calls)).toEqual(["route-probe-model"]);
  });
});
