import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { AI_TASKS, AI_TASK_NAMES, type ModelRoute } from "./tasks";
import { MODEL_RULES } from "./prices";
import { openAiProvider, refusedBy } from "./providers/openai";

/**
 * The model switch's D1 (docs/superpowers/plans/2026-11-26-openai-model-switch.md, section 4; spike run
 * 45887051394, 2026-11-26): what each model refuses goes in ONE table per model, and no task row may send a
 * field its model refuses. Judged on the body the provider really sends, never on the row's own spelling.
 */
const MESSAGES = [{ role: "system" as const, content: "rules" }, { role: "user" as const, content: "hi" }];

async function sentBody(route: ModelRoute): Promise<Record<string, unknown>> {
  let body: Record<string, unknown> = {};
  const fetchImpl = vi.fn(async (_u: string, init: RequestInit) => {
    body = JSON.parse(String(init.body)) as Record<string, unknown>;
    return new Response(JSON.stringify({ choices: [{ message: { content: "x" } }] }), { status: 200 });
  }) as unknown as typeof fetch;
  await openAiProvider.complete({ model: route.model, params: route.params, messages: MESSAGES, timeoutMs: 1_000, fetchImpl });
  return body;
}

const ROUTES = AI_TASK_NAMES.flatMap((task) => {
  const r = AI_TASKS[task];
  return [[task, "primary", r.primary] as const, ...(r.fallback ? [[task, "fallback", r.fallback] as const] : [])];
});

beforeEach(() => { vi.stubEnv("OPENAI_API_KEY", "sk-test"); });
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

describe("every task row sends only what its model accepts (mutation: give a luna row max_tokens, or a 4o-mini row reasoning_effort -> FAILS by task name)", () => {
  it.each(ROUTES)("%s's %s", async (_task, _slot, route) => {
    expect(MODEL_RULES[route.model].api).toBe("chat");
    expect(refusedBy(route.model, await sentBody(route))).toEqual([]);
  });
});

describe("the rules are D1's measurements", () => {
  it("gpt-6-luna takes max_completion_tokens, efforts none and low only, always one, and JSON mode, on Chat Completions", () => {
    expect(MODEL_RULES["gpt-6-luna"]).toEqual({
      api: "chat", capField: "max_completion_tokens", reasoningEfforts: ["none", "low"], reasoningEffortRequired: true, jsonMode: true,
    });
  });
  it("gpt-4o-mini takes max_tokens, no reasoning effort at all, and JSON mode", () => {
    expect(MODEL_RULES["gpt-4o-mini"]).toEqual({
      api: "chat", capField: "max_tokens", reasoningEfforts: [], reasoningEffortRequired: false, jsonMode: true,
    });
  });
});

describe("refusedBy names each refused field (so a failure says what to fix)", () => {
  it("luna: max_tokens, an effort it refuses, and a missing effort", () => {
    expect(refusedBy("gpt-6-luna", { max_tokens: 300, reasoning_effort: "none" })).toEqual(["max_tokens"]);
    expect(refusedBy("gpt-6-luna", { max_completion_tokens: 300, reasoning_effort: "minimal" })).toEqual(["reasoning_effort minimal"]);
    expect(refusedBy("gpt-6-luna", { max_completion_tokens: 300 })).toEqual(["reasoning_effort (missing)"]);
    expect(refusedBy("gpt-6-luna", { max_completion_tokens: 300, reasoning_effort: "low", response_format: { type: "json_object" } })).toEqual([]);
  });
  it("gpt-4o-mini: max_completion_tokens and any reasoning effort", () => {
    expect(refusedBy("gpt-4o-mini", { max_completion_tokens: 300, reasoning_effort: "none" })).toEqual(["max_completion_tokens", "reasoning_effort none"]);
    expect(refusedBy("gpt-4o-mini", { max_tokens: 300, response_format: { type: "json_object" } })).toEqual([]);
  });
});

describe("the four internal text tasks run on luna, with 4o-mini behind them; the web chat stays (PR 2; PR 2b moves it)", () => {
  it("call_summary, call_card, call_proposals and record_summary: luna, effort none, each row's own cap under max_completion_tokens", () => {
    expect(AI_TASKS.call_summary.primary).toEqual({ model: "gpt-6-luna", params: { reasoningEffort: "none" } });
    expect(AI_TASKS.call_card.primary).toEqual({ model: "gpt-6-luna", params: { maxOutput: { field: "max_completion_tokens", tokens: 300 }, reasoningEffort: "none", responseFormat: { type: "json_object" } } });
    expect(AI_TASKS.call_proposals.primary).toEqual({ model: "gpt-6-luna", params: { maxOutput: { field: "max_completion_tokens", tokens: 2000 }, reasoningEffort: "none", responseFormat: { type: "json_object" } } });
    expect(AI_TASKS.record_summary.primary).toEqual({ model: "gpt-6-luna", params: { maxOutput: { field: "max_completion_tokens", tokens: 400 }, reasoningEffort: "none" } });
  });
  it("each moved row's fallback is its old gpt-4o-mini row, byte for byte", () => {
    expect(AI_TASKS.call_summary.fallback).toEqual({ model: "gpt-4o-mini", params: {} });
    expect(AI_TASKS.call_card.fallback).toEqual({ model: "gpt-4o-mini", params: { maxOutput: { field: "max_tokens", tokens: 300 }, responseFormat: { type: "json_object" } } });
    expect(AI_TASKS.call_proposals.fallback).toEqual({ model: "gpt-4o-mini", params: { maxOutput: { field: "max_tokens", tokens: 2000 }, responseFormat: { type: "json_object" } } });
    expect(AI_TASKS.record_summary.fallback).toEqual({ model: "gpt-4o-mini", params: { maxOutput: { field: "max_tokens", tokens: 400 } } });
  });
  it("web_chat is unchanged: gpt-4o-mini, max_tokens 500, no fallback", () => {
    expect(AI_TASKS.web_chat).toEqual({ feature: "web_chat", gated: false, primary: { model: "gpt-4o-mini", params: { maxOutput: { field: "max_tokens", tokens: 500 } } } });
  });
});
