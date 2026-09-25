import { describe, it, expect, vi, beforeEach } from "vitest";

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
  it("hands recordUsage the input unchanged, on the client given or the one a getter builds (mutation: pass the getter itself as the client → FAILS)", async () => {
    await recordUsageSafely(DB, INPUT, "t");
    await recordUsageSafely(() => DB, INPUT, "t");
    expect(dbMocks.recordUsage.mock.calls).toEqual([[DB, INPUT], [DB, INPUT]]);
  });

  it("never throws: a rejected write and a getter that throws are both logged with what was lost (mutation: remove the catch → rejects, FAILS; build the client outside the try → throws, FAILS)", async () => {
    dbMocks.recordUsage.mockRejectedValueOnce(new Error("usage_events is down"));
    await expect(recordUsageSafely(DB, INPUT, "sendSmsAction msg_1")).resolves.toBeUndefined();
    await expect(recordUsageSafely(() => { throw new Error("SUPABASE_SERVICE_ROLE_KEY is missing"); }, INPUT, "sendSmsAction msg_1"))
      .resolves.toBeUndefined();
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("sendSmsAction msg_1: usage not recorded (sms message:msg_1, quantity 2)"));
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("SUPABASE_SERVICE_ROLE_KEY is missing"));
  });
});
