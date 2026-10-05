import { describe, it, expect } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { sumOpenOpportunities } from "../opportunities";

/**
 * Pure pagination-logic test — no real database. `sumOpenOpportunities`
 * pages past PostgREST's row cap (max_rows, 1000 in production; `pageSize`
 * here is shrunk so the test can prove multi-page traversal without
 * creating a thousand rows). The fake client hands back one page per call
 * to `.limit()` and records what `.order()`/`.gt()`/`.eq()` were asked for.
 */
function fakeOpenOpportunitiesDb(pages: { id: string; monetary_value: number }[][]) {
  const limitCalls: number[] = [];
  const eqCalls: Array<[string, unknown]> = [];
  const orderCalls: Array<[string, unknown]> = [];
  const gtCalls: Array<[string, unknown]> = [];
  let call = 0;
  const builder: Record<string, unknown> = {
    eq: (col: string, val: unknown) => {
      eqCalls.push([col, val]);
      return builder;
    },
    order: (col: string, opts: unknown) => {
      orderCalls.push([col, opts]);
      return builder;
    },
    gt: (col: string, val: unknown) => {
      gtCalls.push([col, val]);
      return builder;
    },
    limit: async (n: number) => {
      limitCalls.push(n);
      const data = pages[call] ?? [];
      call += 1;
      return { data, error: null };
    },
  };
  const db = {
    from: () => ({ select: () => builder }),
  } as unknown as SupabaseClient;
  return { db, limitCalls, eqCalls, orderCalls, gtCalls };
}

describe("sumOpenOpportunities (keyset pagination, no row-cap undercount)", () => {
  it("sums and counts across multiple full pages past a shrunk page size, stopping on the empty page", async () => {
    const { db, limitCalls } = fakeOpenOpportunitiesDb([
      [{ id: "a", monetary_value: 100 }, { id: "b", monetary_value: 200 }],
      [{ id: "c", monetary_value: 300 }, { id: "d", monetary_value: 400 }],
      // Third page empty — the loop must stop here, not keep requesting.
    ]);

    const result = await sumOpenOpportunities(db, undefined, 2);

    expect(result).toEqual({ count: 4, value: 1000 });
    expect(limitCalls).toEqual([2, 2, 2]);
  });

  // The reviewer's probe: 1,200 real rows, a server `max_rows` of 500, asked
  // for pageSize 1000 — PostgREST hands back exactly 500 rows (short, but
  // NOT empty) three times running. Offset/`.range()` paging (or any rule
  // that stops once a page comes back shorter than asked) would read only
  // the first 500 and silently drop the other 700. Keyset paging only
  // trusts an EMPTY page as "no more rows", so a short-but-non-empty page
  // must still be followed by another request.
  it("keeps paging past a SHORT non-empty page (server max_rows below pageSize) until a genuinely empty page", async () => {
    const { db, gtCalls } = fakeOpenOpportunitiesDb([
      [{ id: "a", monetary_value: 100 }, { id: "b", monetary_value: 200 }], // short: asked for 5
      [{ id: "c", monetary_value: 300 }],                                    // short again
      [],                                                                    // the real end
    ]);

    const result = await sumOpenOpportunities(db, undefined, 5);

    expect(result).toEqual({ count: 3, value: 600 });
    // No gt() on the first request (no cursor yet); each later request
    // carries the previous page's LAST id as the keyset cursor.
    expect(gtCalls).toEqual([["id", "b"], ["id", "c"]]);
  });

  it("orders by id on every page, not just the first", async () => {
    const { db, orderCalls, limitCalls } = fakeOpenOpportunitiesDb([
      [{ id: "a", monetary_value: 100 }, { id: "b", monetary_value: 200 }],
      [{ id: "c", monetary_value: 300 }],
    ]);

    await sumOpenOpportunities(db, undefined, 2);

    expect(limitCalls.length).toBeGreaterThan(1);
    expect(orderCalls).toEqual(limitCalls.map(() => ["id", { ascending: true }]));
  });

  it("scopes to one account when accountId is given", async () => {
    const { db, eqCalls } = fakeOpenOpportunitiesDb([[{ id: "a", monetary_value: 50 }]]);

    await sumOpenOpportunities(db, "acct_1", 1000);

    expect(eqCalls).toContainEqual(["status", "open"]);
    expect(eqCalls).toContainEqual(["account_id", "acct_1"]);
  });

  it("omits the account filter when no accountId is given (agency-wide)", async () => {
    const { db, eqCalls } = fakeOpenOpportunitiesDb([[]]);

    await sumOpenOpportunities(db, undefined, 1000);

    expect(eqCalls).toEqual([["status", "open"]]);
  });
});
