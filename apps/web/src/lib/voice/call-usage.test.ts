import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const dbMocks = vi.hoisted(() => ({ recordCallUsage: vi.fn() }));
vi.mock("@bis/db", () => dbMocks);

import type { CallUsageInput, SupabaseClient } from "@bis/db";
import { estimateCallCostMicroUsd, recordCallUsageSafely } from "./call-usage";

// One call's worth: 1000 text in (700 of it cached), 200 audio in (100 cached), 30 text out, 120 audio out.
const call = {
  inputTextTokens: 1000, inputCachedTextTokens: 700, inputAudioTokens: 200, inputCachedAudioTokens: 100,
  outputTextTokens: 30, outputAudioTokens: 120,
};
const none = { ...call, inputTextTokens: 0, inputCachedTextTokens: 0, inputAudioTokens: 0, inputCachedAudioTokens: 0,
  outputTextTokens: 0, outputAudioTokens: 0 };

describe("estimateCallCostMicroUsd", () => {
  let warn: ReturnType<typeof vi.spyOn>;
  beforeEach(() => { warn = vi.spyOn(console, "warn").mockImplementation(() => {}); });
  afterEach(() => { warn.mockRestore(); });

  it("prices gpt-realtime per token, cached input at the cached price and the rest at full (mutation: cost cached at the full price → FAILS)", () => {
    // $ per 1M tokens is micro-dollars per token:
    // text 300x4 + cached text 700x0.4 + audio 100x32 + cached audio 100x0.4 + text out 30x24 + audio out 120x64
    // = 1200 + 280 + 3200 + 40 + 720 + 7680
    expect(estimateCallCostMicroUsd("gpt-realtime", call)).toBe(13_120);
    expect(estimateCallCostMicroUsd("gpt-realtime-2.1", call)).toBe(13_120);
  });

  it("gpt-realtime-2.1-mini: its own audio prices; its unknown text and cached prices at the full-size model's (mutation: mini audio out at 64 → FAILS)", () => {
    // 1200 + 280 + 100x10 + 40 + 720 + 120x20
    expect(estimateCallCostMicroUsd("gpt-realtime-2.1-mini", call)).toBe(5_640);
  });

  it("rounds UP to a whole micro-dollar, and never prices more cached tokens than were sent as a negative", () => {
    expect(estimateCallCostMicroUsd("gpt-realtime", { ...none, inputCachedTextTokens: 1 })).toBe(1);
    expect(estimateCallCostMicroUsd("gpt-realtime", { ...none, inputTextTokens: 10, inputCachedTextTokens: 50 })).toBe(20);
    expect(estimateCallCostMicroUsd("gpt-realtime", none)).toBe(0);
  });

  it("an unknown model costs 0 and is warned about by name, never thrown", () => {
    expect(estimateCallCostMicroUsd("gpt-realtime-2099-01-01", call)).toBe(0);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("gpt-realtime-2099-01-01"));
  });
});

describe("recordCallUsageSafely", () => {
  const db = {} as SupabaseClient;
  const input: CallUsageInput = {
    callId: "call1", accountId: "a1", model: "gpt-realtime", responses: 1,
    inputTextTokens: 0, inputAudioTokens: 0, inputCachedTextTokens: 0, inputCachedAudioTokens: 0,
    outputTextTokens: 0, outputAudioTokens: 0, estCostMicrousd: 0,
  };
  let err: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    dbMocks.recordCallUsage.mockReset();
    err = vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => { err.mockRestore(); vi.useRealTimers(); });

  it("writes the input through recordCallUsage", async () => {
    dbMocks.recordCallUsage.mockResolvedValue("recorded");
    await recordCallUsageSafely(db, input, "finishCall call1");
    expect(dbMocks.recordCallUsage).toHaveBeenCalledWith(db, input);
    expect(err).not.toHaveBeenCalled();
  });

  it("never throws: a failing write, or an input that throws while being built, is logged with the call (mutation: drop the catch → rejects, FAILS)", async () => {
    dbMocks.recordCallUsage.mockRejectedValue(new Error("call_usage is down"));
    await expect(recordCallUsageSafely(db, input, "finishCall call1")).resolves.toBeUndefined();
    expect(err).toHaveBeenLastCalledWith(expect.stringMatching(/finishCall call1.*call_usage is down/));
    await expect(recordCallUsageSafely(db, () => { throw new Error("bad build"); }, "finishCall call1")).resolves.toBeUndefined();
    expect(err).toHaveBeenLastCalledWith(expect.stringContaining("bad build"));
  });

  it("gives a stalled write 5 seconds, then gives up and logs it (mutation: no time limit → never settles, FAILS)", async () => {
    vi.useFakeTimers();
    dbMocks.recordCallUsage.mockReturnValue(new Promise(() => {}));
    let settled = false;
    const p = recordCallUsageSafely(db, input, "finishCall call1").then(() => { settled = true; });
    await vi.advanceTimersByTimeAsync(4_999);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await p;
    expect(settled).toBe(true);
    expect(err).toHaveBeenLastCalledWith(expect.stringContaining("timed out"));
  });
});
