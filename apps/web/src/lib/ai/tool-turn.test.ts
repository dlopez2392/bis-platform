import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { SupabaseClient } from "@bis/db";
import type { AiMessage, AiResult, AiInput } from "./gateway";

// The gateway is faked: no provider is reached. aiOverheadMs is a fixed 3 s here.
const aiComplete = vi.fn<(db: unknown, input: AiInput) => Promise<AiResult>>();
vi.mock("./gateway", () => ({ aiComplete: (db: unknown, input: AiInput) => aiComplete(db, input), aiOverheadMs: () => 3_000 }));

import { completeWithTool } from "./tool-turn";
import { chatShape } from "@/lib/tools/belt";

const db = {} as SupabaseClient;
const TOOL = chatShape({ audience: "customer", name: "capture_lead", description: "d",
  parameters: { type: "object", properties: {}, required: [] } } as const);
const base = { accountId: "a1", task: "web_chat" as const, messages: [{ role: "user", content: "hi" }] as AiMessage[], timezone: "UTC" };
const ok = (text: string, toolCalls?: { id: string; name: string; arguments: string | null }[]): AiResult =>
  ({ ok: true, text, model: "m", usage: { inputTokens: 1, outputTokens: 1, costMicroUsd: 0 }, ...(toolCalls ? { toolCalls } : {}) } as AiResult);
const budget = { startedAt: 1_000_000, totalMs: 27_000, followupMaxMs: 8_000, followupMinMs: 2_000 };
const call = (args: string | null = "{}", id = "c1", name = "capture_lead") => ({ id, name, arguments: args });

type R = { saw: string };
const turn = (over: Partial<Parameters<typeof completeWithTool<R>>[0]> = {}) => completeWithTool<R>({
  db, input: base, tools: [TOOL], firstTimeoutMs: 20_000, budget,
  run: async (_n, _a, raw) => ({ saw: raw }), refused: (n) => ({ saw: `refused ${n}` }), failed: (c) => ({ saw: `failed ${c}` }),
  ...over,
});

beforeEach(() => { aiComplete.mockReset(); vi.useFakeTimers(); vi.setSystemTime(budget.startedAt + 1_000); });
afterEach(() => { vi.useRealTimers(); });

describe("completeWithTool", () => {
  it("no tool call: one completion, its text, the handler never runs", async () => {
    aiComplete.mockResolvedValueOnce(ok("Hello there"));
    const run = vi.fn(async () => ({ saw: "" }));
    const r = await turn({ run });
    expect(aiComplete).toHaveBeenCalledTimes(1);
    expect(aiComplete.mock.calls[0]![1]).toMatchObject({ tools: [TOOL], timeoutMs: 20_000 });
    expect(aiComplete.mock.calls[0]![1].toolChoice).toBeUndefined();
    expect(run).not.toHaveBeenCalled();
    expect(r).toMatchObject({ text: "Hello there", toolCalled: false });
  });

  it("a call: the handler runs once, the pre-result words are discarded, the second completion hears the result with toolChoice none", async () => {
    aiComplete
      .mockResolvedValueOnce(ok("I have passed your details on!", [call('{"x":1}')]))
      .mockResolvedValueOnce(ok("Sorry, I need a number."));
    const run = vi.fn(async (_n: string, _a: Record<string, unknown>, raw: string) => ({ saw: raw }));
    const r = await turn({ run });
    expect(run).toHaveBeenCalledTimes(1);
    expect(run).toHaveBeenCalledWith("capture_lead", { x: 1 }, '{"x":1}');
    expect(aiComplete).toHaveBeenCalledTimes(2);
    const second = aiComplete.mock.calls[1]![1];
    expect(second.toolChoice).toBe("none");
    expect(second.messages).toEqual([
      ...base.messages,
      { role: "assistant", content: null, toolCalls: [call('{"x":1}')] },
      { role: "tool", toolCallId: "c1", content: JSON.stringify({ saw: '{"x":1}' }) },
    ]);
    expect(r.text).toBe("Sorry, I need a number.");
    expect(r).toMatchObject({ toolCalled: true, toolResult: { saw: '{"x":1}' }, followup: "answered" });
  });

  it("the second completion's time limit is the smaller of its cap and what is left minus the gateway overhead", async () => {
    aiComplete.mockResolvedValueOnce(ok("", [call()])).mockResolvedValueOnce(ok("ok"));
    await turn();
    expect(aiComplete.mock.calls[1]![1].timeoutMs).toBe(8_000);
    aiComplete.mockReset();
    vi.setSystemTime(budget.startedAt + 20_000); // 27 - 20 - 3 = 4 s left
    aiComplete.mockResolvedValueOnce(ok("", [call()])).mockResolvedValueOnce(ok("ok"));
    await turn();
    expect(aiComplete.mock.calls[1]![1].timeoutMs).toBe(4_000);
  });

  it("too little time left: the handler still ran, no second completion, no words", async () => {
    aiComplete.mockResolvedValueOnce(ok("pre-result words", [call()]));
    vi.setSystemTime(budget.startedAt + 23_000); // 27 - 23 - 3 = 1 s < 2 s
    const run = vi.fn(async () => ({ saw: "" }));
    const r = await turn({ run });
    expect(run).toHaveBeenCalledTimes(1);
    expect(aiComplete).toHaveBeenCalledTimes(1);
    expect(r).toMatchObject({ text: "", toolCalled: true, followup: "skipped" });
  });

  it("the second completion throws: empty text, toolCalled true", async () => {
    aiComplete.mockResolvedValueOnce(ok("pre", [call()])).mockRejectedValueOnce(new Error("boom"));
    const r = await turn();
    expect(r).toMatchObject({ text: "", toolCalled: true, followup: "failed" });
  });

  it("the second completion refused (not ok): empty text, never the pre-result words", async () => {
    aiComplete.mockResolvedValueOnce(ok("pre", [call()])).mockResolvedValueOnce({ ok: false, reason: "timeout" } as AiResult);
    const r = await turn();
    expect(r).toMatchObject({ text: "", followup: "failed" });
  });

  it("two calls in one completion: the handler runs once, for the first", async () => {
    aiComplete.mockResolvedValueOnce(ok("", [call('{"n":1}', "c1"), call('{"n":2}', "c2")])).mockResolvedValueOnce(ok("done"));
    const run = vi.fn(async () => ({ saw: "" }));
    await turn({ run });
    expect(run).toHaveBeenCalledTimes(1);
    expect(run).toHaveBeenCalledWith("capture_lead", { n: 1 }, '{"n":1}');
    expect(aiComplete.mock.calls[1]![1].messages.filter((x) => x.role === "tool")).toHaveLength(1);
  });

  it("a name that is not offered: the handler does not run, the caller's refusal is the tool's answer", async () => {
    aiComplete.mockResolvedValueOnce(ok("", [call("{}", "c1", "book_appointment")])).mockResolvedValueOnce(ok("I can't."));
    const run = vi.fn(async () => ({ saw: "ran" }));
    const r = await turn({ run });
    expect(run).not.toHaveBeenCalled();
    expect(r.toolResult).toEqual({ saw: "refused book_appointment" });
    expect(aiComplete.mock.calls[1]![1].messages.at(-1)).toEqual({
      role: "tool", toolCallId: "c1", content: JSON.stringify({ saw: "refused book_appointment" }),
    });
  });

  it("a call with no arguments is not a call: the first words stand", async () => {
    aiComplete.mockResolvedValueOnce(ok("Just words", [call(null)]));
    const run = vi.fn(async () => ({ saw: "" }));
    const r = await turn({ run });
    expect(run).not.toHaveBeenCalled();
    expect(aiComplete).toHaveBeenCalledTimes(1);
    expect(r).toMatchObject({ text: "Just words", toolCalled: false });
  });

  it("the handler throws: the caller's failure result, by class only, is the tool's answer", async () => {
    aiComplete.mockResolvedValueOnce(ok("", [call()])).mockResolvedValueOnce(ok("x"));
    const r = await turn({ run: async () => { throw new TypeError("secret words"); } });
    expect(r.toolResult).toEqual({ saw: "failed TypeError" });
  });

  it("a failure of the first completion propagates", async () => {
    aiComplete.mockResolvedValueOnce({ ok: false, reason: "timeout" } as AiResult);
    await expect(turn()).rejects.toThrow("ai timeout");
  });
});
