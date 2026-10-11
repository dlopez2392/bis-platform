import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * F-085 part 1, spec §7.3: "prove the target through the request client,
 * then write through the service client". `callerCanSee` is the proof: a read
 * through the CALLER's own client (RLS + 0068), scoped to the account and the
 * id. The fake below records every link of the chain, so a read that drops
 * the account scope or reads the wrong table is caught, not just the answer.
 */
const fake = vi.hoisted(() => ({
  calls: [] as Array<[string, ...unknown[]]>,
  result: { data: null as unknown, error: null as unknown },
}));

vi.mock("@/lib/db", () => ({
  dbForRequest: async () => {
    const chain = {
      select: (...a: unknown[]) => { fake.calls.push(["select", ...a]); return chain; },
      eq: (...a: unknown[]) => { fake.calls.push(["eq", ...a]); return chain; },
      maybeSingle: async () => { fake.calls.push(["maybeSingle"]); return fake.result; },
    };
    return { from: (t: string) => { fake.calls.push(["from", t]); return chain; } };
  },
}));

import { callerCanSee } from "./visible";

beforeEach(() => {
  fake.calls = [];
  fake.result = { data: null, error: null };
});

describe("callerCanSee — the caller's own client vouches for the row (spec §7.3)", () => {
  it("true when the scoped read returns the row, and the read is account- and id-scoped on the named table", async () => {
    fake.result = { data: { id: "bk_1" }, error: null };
    expect(await callerCanSee("bookings", "acct_1", "bk_1")).toBe(true);
    expect(fake.calls).toEqual([
      ["from", "bookings"],
      ["select", "id"],
      ["eq", "account_id", "acct_1"],
      ["eq", "id", "bk_1"],
      ["maybeSingle"],
    ]);
  });

  it("false when RLS hides the row (the read returns null)", async () => {
    fake.result = { data: null, error: null };
    expect(await callerCanSee("conversations", "acct_1", "cv_1")).toBe(false);
    expect(fake.calls[0]).toEqual(["from", "conversations"]);
  });

  it("throws on a read error: 'could not tell' is never 'allowed' (mutation: return true on error → FAILS)", async () => {
    fake.result = { data: null, error: { message: "boom" } };
    await expect(callerCanSee("bookings", "acct_1", "bk_1")).rejects.toThrow("callerCanSee(bookings) failed: boom");
  });
});
