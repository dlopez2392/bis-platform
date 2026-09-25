import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const dbMocks = vi.hoisted(() => ({ recordUsage: vi.fn() }));
vi.mock("@bis/db", async (importOriginal) => ({ ...(await importOriginal<object>()), ...dbMocks }));

import type { SupabaseClient, UsageInput } from "@bis/db";
import { voiceMinutes, smsBillable, recordUsageSafely } from "./usage";

const DB = { tag: "service-db" } as unknown as SupabaseClient;
const INPUT: UsageInput = {
  accountId: "acct_1", meter: "sms", quantity: 2,
  occurredAt: new Date("2026-09-25T14:00:00Z"), sourceRef: "message:msg_1",
};

beforeEach(() => {
  dbMocks.recordUsage.mockReset().mockResolvedValue("recorded");
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("voiceMinutes", () => {
  it("rounds UP to whole minutes, never below one (mutation: Math.round → 61 s bills 1, FAILS; drop the floor of 1 → 0 s bills 0, FAILS)", () => {
    expect([0, 1, 59, 60, 61, 119, 120, 121, 3600].map(voiceMinutes)).toEqual([1, 1, 1, 1, 2, 2, 2, 3, 60]);
  });
});

describe("smsBillable", () => {
  it("only a real, unredirected provider bills (mutation: drop the redirect check → a developer-phone text bills, FAILS; test isFake for truthiness → a provider that never says it is real bills, FAILS)", () => {
    expect(smsBillable({ isFake: false })).toBe(true);
    expect(smsBillable({ isFake: true })).toBe(false);
    expect(smsBillable({ isFake: false, redirectTo: "+19565550199" })).toBe(false);
    expect(smsBillable({ isFake: undefined as unknown as boolean })).toBe(false);
  });
});

describe("recordUsageSafely", () => {
  it("hands recordUsage the input unchanged, on the client given or the one a getter builds, and the input given or the one a thunk builds (mutation: pass the getter itself as the client → FAILS; pass the input thunk itself as the input → FAILS)", async () => {
    await recordUsageSafely(DB, INPUT, "t");
    await recordUsageSafely(() => DB, INPUT, "t");
    await recordUsageSafely(DB, () => INPUT, "t");
    expect(dbMocks.recordUsage.mock.calls).toEqual([[DB, INPUT], [DB, INPUT], [DB, INPUT]]);
  });

  it("a rejected write is awaited before it is logged, with its own message, exactly once (mutation: void the write instead of awaiting it → resolves before the write settles, FAILS; remove the catch → rejects, FAILS)", async () => {
    let reject!: (e: unknown) => void;
    const pendingWrite = new Promise<never>((_resolve, rej) => {
      reject = rej;
    });
    dbMocks.recordUsage.mockReturnValueOnce(pendingWrite);

    let settled = false;
    const call = recordUsageSafely(DB, INPUT, "sendSmsAction msg_1").then(() => {
      settled = true;
    });

    // Give any stray microtasks a chance to run; the write is still pending,
    // so an implementation that awaits it must not have settled yet.
    await Promise.resolve();
    await Promise.resolve();
    expect(settled).toBe(false);
    expect(console.error).not.toHaveBeenCalled();

    reject(new Error("usage_events is down"));
    await call;

    expect(settled).toBe(true);
    expect(console.error).toHaveBeenCalledTimes(1);
    expect(console.error).toHaveBeenCalledWith(
      "sendSmsAction msg_1: usage not recorded (sms message:msg_1, quantity 2): usage_events is down",
    );
  });

  it("a throwing db getter is caught before the write is attempted, and logged with its own message (mutation: build the client outside the try → throws, FAILS)", async () => {
    await expect(
      recordUsageSafely(
        () => {
          throw new Error("SUPABASE_SERVICE_ROLE_KEY is missing");
        },
        INPUT,
        "sendSmsAction msg_1",
      ),
    ).resolves.toBeUndefined();

    expect(dbMocks.recordUsage).not.toHaveBeenCalled();
    expect(console.error).toHaveBeenCalledTimes(1);
    expect(console.error).toHaveBeenCalledWith(
      "sendSmsAction msg_1: usage not recorded (sms message:msg_1, quantity 2): SUPABASE_SERVICE_ROLE_KEY is missing",
    );
  });

  it("a throwing input builder is caught inside the same try, before recordUsage is ever called (mutation: build the input outside the try → throws, FAILS)", async () => {
    await expect(
      recordUsageSafely(
        DB,
        () => {
          throw new Error("row is null");
        },
        "sendSmsAction msg_1",
      ),
    ).resolves.toBeUndefined();

    expect(dbMocks.recordUsage).not.toHaveBeenCalled();
    expect(console.error).toHaveBeenCalledTimes(1);
    expect(console.error).toHaveBeenCalledWith(
      "sendSmsAction msg_1: usage not recorded (input not built): row is null",
    );
  });

  it("bounds the write so one that never settles is abandoned and logged, not left open forever (mutation: remove the timeout race → the hanging write outlives the caller, FAILS)", async () => {
    vi.useFakeTimers();
    dbMocks.recordUsage.mockReturnValueOnce(new Promise<never>(() => {}));

    const pending = recordUsageSafely(DB, INPUT, "sendSmsAction msg_1");
    await vi.advanceTimersByTimeAsync(5_000);
    await expect(pending).resolves.toBeUndefined();

    expect(console.error).toHaveBeenCalledTimes(1);
    expect(console.error).toHaveBeenCalledWith(
      "sendSmsAction msg_1: usage not recorded (sms message:msg_1, quantity 2): usage write timed out after 5000ms",
    );
  });

  it("describes a rejection reason it cannot stringify without throwing itself (mutation: use String(e) directly → throws on Object.create(null), FAILS)", async () => {
    dbMocks.recordUsage.mockRejectedValueOnce(Object.create(null) as unknown);

    await expect(recordUsageSafely(DB, INPUT, "sendSmsAction msg_1")).resolves.toBeUndefined();

    expect(console.error).toHaveBeenCalledTimes(1);
    expect(console.error).toHaveBeenCalledWith(
      "sendSmsAction msg_1: usage not recorded (sms message:msg_1, quantity 2): unprintable error",
    );
  });
});
