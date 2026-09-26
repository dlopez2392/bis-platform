import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * React's real `cache()` memoizes per REQUEST scope, and a bare vitest call
 * has none (lib/zone.test.ts explains why it cannot be asserted directly).
 * So `react`'s `cache` is replaced here by a stand-in for ONE request's
 * scope: a memo on the arguments. What that measures is the module's own
 * choice, the one thing that can regress: whether the read is wrapped in
 * `cache()` at all. Unwrap it and the second read below is a second query.
 */
vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  const cache = <A extends unknown[], R>(fn: (...args: A) => R) => {
    const memo = new Map<string, R>();
    return (...args: A): R => {
      const key = JSON.stringify(args);
      if (!memo.has(key)) memo.set(key, fn(...args));
      return memo.get(key)!;
    };
  };
  return { ...actual, cache };
});
vi.mock("@/lib/db", () => ({ dbForRequest: async () => ({ tag: "rls" }) }));
const dbm = vi.hoisted(() => ({ getAccountBilling: vi.fn() }));
vi.mock("@bis/db", async (importOriginal) => ({
  ...(await importOriginal<object>()), ...dbm, serviceDb: () => ({ tag: "service" }),
}));

const { readAccountBilling } = await import("./account-billing-read");

beforeEach(() => {
  dbm.getAccountBilling.mockReset();
  dbm.getAccountBilling.mockResolvedValue(null);
});

describe("readAccountBilling", () => {
  it("reads the row on the signed-in caller's RLS client, never serviceDb (mutation: pass serviceDb() → FAILS)", async () => {
    await readAccountBilling("acc-rls");
    expect(dbm.getAccountBilling).toHaveBeenCalledWith({ tag: "rls" }, "acc-rls");
  });

  it("is ONE query per request for one account, however many readers (the layout's banner and the Billing page) (mutation: drop cache() → two queries, FAILS)", async () => {
    await Promise.all([readAccountBilling("acc-once"), readAccountBilling("acc-once")]);
    expect(dbm.getAccountBilling).toHaveBeenCalledTimes(1);
  });
});
