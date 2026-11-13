import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// A row a test swaps in for one task; every other task reads the real table (tasks.ts).
const swapped = vi.hoisted(() => ({ routes: {} as Record<string, unknown> }));
vi.mock("./tasks", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./tasks")>();
  return { ...actual, AI_TASKS: new Proxy(actual.AI_TASKS, { get: (t, k) => swapped.routes[k as string] ?? Reflect.get(t, k) }) };
});
// A second priced model, so a fallback's ledger row can be told apart from the primary's: one micro-dollar per token.
vi.mock("./prices", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./prices")>();
  return {
    ...actual,
    isPricedModel: (m: string) => m === "test-fallback" || actual.isPricedModel(m),
    costMicroUsd: (m: string, i: number, o: number) => (m === "test-fallback" ? i + o : actual.costMicroUsd(m as "gpt-4o-mini", i, o)),
  };
});

import { aiComplete, aiGateMs, aiReadiness, GATE_TIMEOUT_MS, type AiInput } from "./gateway";
import { AI_TASK_NAMES, AI_TASKS, type AiTask, type TaskRoute } from "./tasks";
import { openGateDb, type GateOver } from "./testing/open-gate";

/** The task table (tasks.ts) and the fallback (gateway.ts step 7). The provider is a stubbed fetch: no network. */
const MESSAGES: AiInput["messages"] = [{ role: "system", content: "rules" }, { role: "user", content: "hello" }];
const base = (o: Partial<AiInput> = {}): AiInput => ({
  accountId: "acct1", task: "call_summary", messages: MESSAGES, timeoutMs: 10_000, timezone: "America/Chicago",
  ref: "call c1", now: new Date("2026-10-18T15:00:00Z"), ...o,
});
const ok = (content: unknown = "fine", usage: unknown = { prompt_tokens: 40, completion_tokens: 2 }) =>
  new Response(JSON.stringify({ choices: [{ message: { content } }], usage }), { status: 200 });
type Step = Response | Error | (() => Response);
/** A fetch that answers each request with the next step, recording every request body. */
function scripted(...steps: Step[]) {
  const bodies: Record<string, unknown>[] = [];
  const raw: string[] = [];
  const fetchImpl = vi.fn(async (_url: string, init: RequestInit) => {
    raw.push(String(init.body));
    bodies.push(JSON.parse(String(init.body)) as Record<string, unknown>);
    const s = steps[bodies.length - 1] ?? steps[steps.length - 1]!;
    if (s instanceof Error) throw s;
    return typeof s === "function" ? s() : s;
  }) as unknown as typeof fetch & { mock: { calls: unknown[] } };
  return { fetchImpl, bodies, raw };
}
const ledgerOf = (calls: { fn: string; args: Record<string, unknown> }[]) => calls.filter((c) => c.fn === "ai_ledger_record").map((c) => c.args);
const withFallback = (task: AiTask = "call_summary", primary: TaskRoute["primary"] = { model: "gpt-4o-mini", params: {} }): void => {
  swapped.routes[task] = { feature: task === "web_chat" ? null : task, primary, fallback: { model: "test-fallback", params: { maxOutput: { field: "max_completion_tokens", tokens: 77 } } } };
};

beforeEach(() => {
  swapped.routes = {};
  vi.stubEnv("OPENAI_API_KEY", "sk-test");
  vi.stubEnv("AI_GATEWAY_OFF", "");
  vi.stubEnv("AI_PROVIDER", "");
  vi.stubEnv("VERCEL_ENV", "");
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

describe("the task table is today's requests, byte for byte (this PR changes routing, not behaviour)", () => {
  // The exact body each task sent before the table existed: same fields, same values, same order.
  const today: Record<AiTask, Record<string, unknown>> = {
    web_chat: { model: "gpt-4o-mini", messages: MESSAGES, max_tokens: 500 },
    call_summary: { model: "gpt-4o-mini", messages: MESSAGES },
    call_card: { model: "gpt-4o-mini", messages: MESSAGES, response_format: { type: "json_object" }, max_tokens: 300 },
    call_proposals: { model: "gpt-4o-mini", messages: MESSAGES, response_format: { type: "json_object" }, max_tokens: 2000 },
    record_summary: { model: "gpt-4o-mini", messages: MESSAGES, max_tokens: 400 },
  };
  it.each(AI_TASK_NAMES)("%s sends exactly today's body, and no task has a fallback yet (mutations: any row's model, cap or JSON mode changed; a fallback added to any row -> FAILS)", async (task) => {
    expect(AI_TASKS[task].fallback).toBeUndefined();
    const { fetchImpl, raw } = scripted(ok());
    expect((await aiComplete(openGateDb().db, base({ task, fetchImpl }))).ok).toBe(true);
    expect(raw).toEqual([JSON.stringify(today[task])]);
  });
});

describe("a task's row decides the request (one-row model swaps)", () => {
  it("a reasoning model's row sends max_completion_tokens and reasoning_effort, never max_tokens (PR #350's shape)", async () => {
    swapped.routes.call_summary = { feature: "call_summary", primary: { model: "test-fallback", params: { maxOutput: { field: "max_completion_tokens", tokens: 300 }, reasoningEffort: "none" } } };
    const { db, calls } = openGateDb();
    const { fetchImpl, bodies } = scripted(ok());
    const r = await aiComplete(db, base({ fetchImpl }));
    expect(bodies[0]).toEqual({ model: "test-fallback", messages: MESSAGES, max_completion_tokens: 300, reasoning_effort: "none" });
    expect(r).toMatchObject({ ok: true, model: "test-fallback" });
    expect(ledgerOf(calls)[0]).toMatchObject({ p_model: "test-fallback", p_cost: 42 });
  });

  it("an unpriced model is refused before the gate, so it cannot spend unmetered (mutation: skip the price check -> FAILS)", async () => {
    swapped.routes.call_summary = { feature: "call_summary", primary: { model: "gpt-9", params: {} } };
    const { db, calls } = openGateDb();
    const { fetchImpl } = scripted(ok());
    expect(await aiComplete(db, base({ fetchImpl }))).toEqual({ ok: false, reason: "unknown_model" });
    expect(calls.map((c) => [c.fn, c.args.p_model])).toEqual([["ai_ledger_record", "gpt-9"]]);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe("the fallback (gateway.ts step 7)", () => {
  it("after a 503: tried once, on its own row, and its cost is recorded against the model that answered (mutation: record the primary's model -> FAILS)", async () => {
    withFallback();
    const { db, calls } = openGateDb();
    const { fetchImpl, bodies } = scripted(new Response("{}", { status: 503 }), ok("from fallback", { prompt_tokens: 10, completion_tokens: 5 }));
    const r = await aiComplete(db, base({ fetchImpl }));
    expect(r).toEqual({ ok: true, text: "from fallback", model: "test-fallback", usage: { inputTokens: 10, outputTokens: 5, costMicroUsd: 15 } });
    expect(bodies.map((b) => [b.model, b.max_tokens, b.max_completion_tokens])).toEqual([["gpt-4o-mini", undefined, undefined], ["test-fallback", undefined, 77]]);
    expect(calls.map((c) => c.fn)).toEqual(["ai_gate_check", "ai_ledger_record", "ai_ledger_record"]);
    expect(ledgerOf(calls).map((a) => [a.p_model, a.p_outcome, a.p_cost])).toEqual([["gpt-4o-mini", "provider_error", 0], ["test-fallback", "ok", 15]]);
  });

  const transient: [string, Step][] = [
    ["HTTP 500", new Response("{}", { status: 500 })],
    ["HTTP 429", new Response("{}", { status: 429 })],
    ["HTTP 408", new Response("{}", { status: 408 })],
    ["a network failure", new TypeError("fetch failed")],
  ];
  it.each(transient)("after %s the fallback is tried", async (_name, first) => {
    withFallback();
    const { fetchImpl, bodies } = scripted(first, ok());
    expect(await aiComplete(openGateDb().db, base({ fetchImpl }))).toMatchObject({ ok: true, model: "test-fallback" });
    expect(bodies).toHaveLength(2);
  });

  // [what happened, the mutation that fails the row, the first answer, the result]
  const final: [string, string, Step, string][] = [
    ["a 400 (our request was wrong)", "fall back on every provider_error", new Response("{}", { status: 400 }), "provider_error"],
    ["a 401", "mark every non-ok status transient", new Response("{}", { status: 401 }), "provider_error"],
    ["an answer that does not parse", "mark a parse failure transient", new Response("not json", { status: 200 }), "provider_error"],
    ["a timeout", "fall back on a timeout", new DOMException("The operation timed out.", "TimeoutError"), "timeout"],
  ];
  it.each(final)("after %s it is NOT tried (mutation: %s -> FAILS)", async (_name, _mutation, first, reason) => {
    withFallback();
    const { db, calls } = openGateDb();
    const { fetchImpl, bodies } = scripted(first, ok());
    expect(await aiComplete(db, base({ fetchImpl }))).toEqual({ ok: false, reason });
    expect(bodies.map((b) => b.model)).toEqual(["gpt-4o-mini"]);
    expect(ledgerOf(calls)).toHaveLength(1);
  });

  const refusals: [string, GateOver | null, string][] = [
    ["over budget", { gate: { month_spend_microusd: 10_000_000 } }, "over_budget"],
    ["the account's AI switched off", { gate: { account_enabled: false } }, "account_off"],
    ["the global switch off", { gate: { global_enabled: false } }, "global_off"],
    ["an unreadable gate", { gate: "error" }, "gate_unreadable"],
    ["no key", null, "no_key"],
  ];
  it.each(refusals)("%s: no request to either model, no fallback (mutation: fall back on any refusal -> FAILS)", async (_name, over, reason) => {
    withFallback();
    if (over === null) vi.stubEnv("OPENAI_API_KEY", "");
    const { db, calls } = openGateDb(over ?? {});
    const { fetchImpl } = scripted(ok());
    expect(await aiComplete(db, base({ fetchImpl }))).toEqual({ ok: false, reason });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(ledgerOf(calls)).toEqual([expect.objectContaining({ p_model: "gpt-4o-mini", p_outcome: reason })]);
  });

  it("AI_GATEWAY_OFF=1: nothing is read, nothing is sent, no fallback", async () => {
    withFallback();
    vi.stubEnv("AI_GATEWAY_OFF", "1");
    const { db, calls } = openGateDb();
    const { fetchImpl } = scripted(ok());
    expect(await aiComplete(db, base({ fetchImpl }))).toEqual({ ok: false, reason: "global_off" });
    expect([calls.length, (fetchImpl as unknown as { mock: { calls: unknown[] } }).mock.calls.length]).toEqual([0, 0]);
  });

  it("shares the caller's time limit: the fallback gets what is left, never a fresh one (mutation: pass input.timeoutMs again -> FAILS)", async () => {
    withFallback();
    let clock = 1_000_000;
    vi.spyOn(Date, "now").mockImplementation(() => clock);
    const timeout = vi.spyOn(AbortSignal, "timeout");
    const { fetchImpl } = scripted(() => { clock += 4_000; return new Response("{}", { status: 502 }); }, ok());
    await aiComplete(openGateDb().db, base({ fetchImpl }));
    // gate 3 s, primary 10 s, its ledger row 3 s, the fallback 6 s (10 - 4), its ledger row 3 s.
    expect(timeout.mock.calls.map((c) => c[0])).toEqual([3_000, 10_000, 3_000, 6_000, 3_000]);
  });

  it("with less than a second left it is not started (mutation: drop the FALLBACK_MIN_MS check -> FAILS)", async () => {
    withFallback();
    let clock = 1_000_000;
    vi.spyOn(Date, "now").mockImplementation(() => clock);
    const { fetchImpl, bodies } = scripted(() => { clock += 9_500; return new Response("{}", { status: 503 }); }, ok());
    expect(await aiComplete(openGateDb().db, base({ fetchImpl }))).toEqual({ ok: false, reason: "provider_error" });
    expect(bodies).toHaveLength(1);
  });

  it("a fallback that fails too is a provider_error, with a row for each model", async () => {
    withFallback();
    const { db, calls } = openGateDb();
    const { fetchImpl } = scripted(new Response("{}", { status: 503 }), new Response("{}", { status: 503 }));
    expect(await aiComplete(db, base({ fetchImpl }))).toEqual({ ok: false, reason: "provider_error" });
    expect(ledgerOf(calls).map((a) => a.p_model)).toEqual(["gpt-4o-mini", "test-fallback"]);
  });
});

describe("the web chat task: tools, and no ledger feature yet", () => {
  const TOOL = { type: "function" as const, function: { name: "capture_lead", description: "d", parameters: { type: "object" } } };

  it("makes no RPC at all: no gate read, and no ledger row, since 0086 admits no web_chat feature (mutations: write the row anyway; read the gate anyway -> FAILS)", async () => {
    const { db, calls } = openGateDb();
    const { fetchImpl } = scripted(ok());
    expect((await aiComplete(db, base({ task: "web_chat", fetchImpl }))).ok).toBe(true);
    expect(calls).toEqual([]);
  });

  // The AI settings copy promises operators the website chat keeps running whatever these say (review of #362):
  // they join the chat only with its ledger migration and a copy rewrite.
  const closedGates: [string, GateOver][] = [
    ["the account's AI switched off", { gate: { account_enabled: false } }],
    ["the global switch off", { gate: { global_enabled: false } }],
    ["over budget", { gate: { month_spend_microusd: 10_000_000 } }],
    ["an unreadable gate", { gate: "error" }],
  ];
  it.each(closedGates)("%s: the web chat still answers (mutation: apply the gate to a task with no feature -> FAILS)", async (_name, over) => {
    const { fetchImpl } = scripted(ok("still here"));
    expect(await aiComplete(openGateDb(over).db, base({ task: "web_chat", fetchImpl }))).toMatchObject({ ok: true, text: "still here" });
  });

  it("the kill switch (AI_GATEWAY_OFF=1) still refuses it", async () => {
    vi.stubEnv("AI_GATEWAY_OFF", "1");
    const { fetchImpl } = scripted(ok());
    expect(await aiComplete(openGateDb().db, base({ task: "web_chat", fetchImpl }))).toEqual({ ok: false, reason: "global_off" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  const gated = AI_TASK_NAMES.filter((t) => t !== "web_chat").flatMap((t) => closedGates.map(([name, over]) => [t, name, over] as const));
  it.each(gated)("%s, %s: every task WITH a feature still gets every gate (mutation: skip the gate for every task -> FAILS)", async (task, _name, over) => {
    const { fetchImpl } = scripted(ok());
    expect((await aiComplete(openGateDb(over).db, base({ task, fetchImpl }))).ok).toBe(false);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("aiGateMs: no gate time for the web chat today, the gate's bound for every other task", () => {
    expect(AI_TASK_NAMES.map((t) => [t, aiGateMs(t)])).toEqual(AI_TASK_NAMES.map((t) => [t, t === "web_chat" ? 0 : GATE_TIMEOUT_MS]));
  });

  it("sends tools, a tool exchange in the wire shape and tool_choice; a tool call with null content is an answer of \"\"", async () => {
    const answer = new Response(JSON.stringify({ choices: [{ message: { content: null, tool_calls: [{ id: "t1", type: "function", function: { name: "capture_lead", arguments: "{\"a\":1}" } }] } }] }), { status: 200 });
    const { fetchImpl, raw } = scripted(answer);
    const r = await aiComplete(openGateDb().db, base({
      task: "web_chat", tools: [TOOL], toolChoice: "none", fetchImpl,
      messages: [...MESSAGES, { role: "assistant", content: null, toolCalls: [{ id: "t0", name: "capture_lead", arguments: "{}" }] }, { role: "tool", toolCallId: "t0", content: "{\"ok\":true}" }],
    }));
    expect(r).toMatchObject({ ok: true, text: "", toolCalls: [{ id: "t1", name: "capture_lead", arguments: "{\"a\":1}" }] });
    // The concierge's own body before the move: model, messages, tools, max_tokens, then tool_choice.
    expect(raw[0]).toBe(JSON.stringify({
      model: "gpt-4o-mini",
      messages: [...MESSAGES,
        { role: "assistant", content: null, tool_calls: [{ id: "t0", type: "function", function: { name: "capture_lead", arguments: "{}" } }] },
        { role: "tool", tool_call_id: "t0", content: "{\"ok\":true}" }],
      tools: [TOOL], max_tokens: 500, tool_choice: "none",
    }));
  });
});

describe("aiReadiness: what a caller checks before it spends anything of its own", () => {
  it("is null when the provider is configured and the kill switch is off", () => { expect(aiReadiness()).toBeNull(); });
  it("names the kill switch first (mutation: drop the AI_GATEWAY_OFF check -> FAILS)", () => {
    vi.stubEnv("AI_GATEWAY_OFF", "1");
    expect(aiReadiness()).toBe("global_off");
  });
  it("names a missing key (mutation: always configured -> FAILS)", () => {
    vi.stubEnv("OPENAI_API_KEY", "");
    expect(aiReadiness()).toBe("no_key");
  });
  it("the fake needs no key", () => {
    vi.stubEnv("OPENAI_API_KEY", "");
    vi.stubEnv("AI_PROVIDER", "fake");
    expect(aiReadiness()).toBeNull();
  });
});
