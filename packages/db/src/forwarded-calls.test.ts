import { describe, it, expect } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { countForwardedCallsSince } from "./forwarded-calls";

/**
 * Hermetic twin of test/forwarded-calls.test.ts: what the count does with the
 * answers PostgREST can give, without a database.
 */
type Answer = { count: number | null; error: { message: string } | null };

/** A query chain that records its filters and resolves to the next answer. */
function fakeDb(answers: Answer[]): { db: SupabaseClient; filters: string[][] } {
  const filters: string[][] = [];
  const db = {
    from: (table: string) => {
      const mine = [`from:${table}`];
      filters.push(mine);
      const answer = answers.shift()!;
      const chain = {
        select: () => chain,
        eq: (col: string, v: unknown) => { mine.push(`${col}=${String(v)}`); return chain; },
        gte: (col: string, v: unknown) => { mine.push(`${col}>=${String(v)}`); return chain; },
        then: (ok: (a: Answer) => unknown) => Promise.resolve(answer).then(ok),
      };
      return chain;
    },
  } as unknown as SupabaseClient;
  return { db, filters };
}

describe("countForwardedCallsSince", () => {
  it("counts the account, and the caller on that account, from the instant given", async () => {
    const { db, filters } = fakeDb([{ count: 7, error: null }, { count: 2, error: null }]);
    expect(await countForwardedCallsSince(db, "acct", "+19565550111", "T0")).toEqual({ forAccount: 7, forCaller: 2 });
    expect(filters).toEqual([
      ["from:forwarded_calls", "account_id=acct", "created_at>=T0"],
      ["from:forwarded_calls", "account_id=acct", "caller_e164=+19565550111", "created_at>=T0"],
    ]);
  });

  it("a withheld caller counts 0 for the caller and asks nothing about one", async () => {
    const { db, filters } = fakeDb([{ count: 3, error: null }]);
    expect(await countForwardedCallsSince(db, "acct", null, "T0")).toEqual({ forAccount: 3, forCaller: 0 });
    expect(filters).toHaveLength(1);
  });

  it("a null count with NO error — PostgREST's answer to a HEAD on a table it does not know — throws, never reads as 0 (mutation: `a.count ?? 0` → FAILS)", async () => {
    const { db } = fakeDb([{ count: null, error: null }, { count: 0, error: null }]);
    await expect(countForwardedCallsSince(db, "acct", "+19565550111", "T0")).rejects.toThrow(/no count returned/);
    const { db: db2 } = fakeDb([{ count: 0, error: null }, { count: null, error: null }]);
    await expect(countForwardedCallsSince(db2, "acct", "+19565550111", "T0")).rejects.toThrow(/no count returned/);
  });

  it("an error throws with its message", async () => {
    const { db } = fakeDb([{ count: null, error: { message: "boom" } }]);
    await expect(countForwardedCallsSince(db, "acct", null, "T0")).rejects.toThrow(/countForwardedCallsSince failed: boom/);
  });
});
