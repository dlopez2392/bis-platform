import { describe, it, expect } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { listCallStartsByOutcomeBetween } from "../voice";

/**
 * Pure pagination-logic test — no real database, same shape
 * `opportunities-pagination.test.ts` uses for `sumOpenOpportunities`. This
 * is the "leads captured" call half's read (weekly-metrics.ts's
 * `LEAD_OUTCOME`, passed in by the caller — see this function's own doc
 * comment for why the outcome set is a parameter, never a literal here).
 */
function fakeCallsDb(pages: { id: string; started_at: string }[][]) {
  const limitCalls: number[] = [];
  const eqCalls: Array<[string, unknown]> = [];
  const inCalls: Array<[string, unknown]> = [];
  const orderCalls: Array<[string, unknown]> = [];
  const gtCalls: Array<[string, unknown]> = [];
  let call = 0;
  const builder: Record<string, unknown> = {
    eq: (col: string, val: unknown) => { eqCalls.push([col, val]); return builder; },
    in: (col: string, val: unknown) => { inCalls.push([col, val]); return builder; },
    gte: () => builder,
    lt: () => builder,
    order: (col: string, opts: unknown) => { orderCalls.push([col, opts]); return builder; },
    gt: (col: string, val: unknown) => { gtCalls.push([col, val]); return builder; },
    limit: async (n: number) => {
      limitCalls.push(n);
      const data = pages[call] ?? [];
      call += 1;
      return { data, error: null };
    },
  };
  const db = { from: () => ({ select: () => builder }) } as unknown as SupabaseClient;
  return { db, limitCalls, eqCalls, inCalls, orderCalls, gtCalls };
}

describe("listCallStartsByOutcomeBetween (keyset pagination, no row-cap undercount)", () => {
  it("keeps paging past a SHORT non-empty page until a genuinely empty page", async () => {
    const { db, gtCalls, limitCalls } = fakeCallsDb([
      [{ id: "a", started_at: "2027-01-01T00:00:00.000Z" }, { id: "b", started_at: "2027-01-02T00:00:00.000Z" }],
      [{ id: "c", started_at: "2027-01-03T00:00:00.000Z" }],
      [],
    ]);

    const result = await listCallStartsByOutcomeBetween(
      db, "acct_1", ["lead"], "2027-01-01T00:00:00.000Z", "2027-02-01T00:00:00.000Z", 5,
    );

    expect(result).toEqual([
      "2027-01-01T00:00:00.000Z", "2027-01-02T00:00:00.000Z", "2027-01-03T00:00:00.000Z",
    ]);
    expect(limitCalls).toEqual([5, 5, 5]);
    expect(gtCalls).toEqual([["id", "b"], ["id", "c"]]);
  });

  it("filters by the exact outcomes array the caller passed, not a hard-coded one", async () => {
    const { db, inCalls } = fakeCallsDb([
      [{ id: "a", started_at: "2027-01-01T00:00:00.000Z" }],
      [],
    ]);

    await listCallStartsByOutcomeBetween(db, "acct_1", ["lead"], "2027-01-01T00:00:00.000Z", "2027-02-01T00:00:00.000Z", 1);

    expect(inCalls).toEqual([["outcome", ["lead"]], ["outcome", ["lead"]]]);
  });

  it("orders by id on every page, not just the first", async () => {
    const { db, orderCalls, limitCalls } = fakeCallsDb([
      [{ id: "a", started_at: "2027-01-01T00:00:00.000Z" }, { id: "b", started_at: "2027-01-02T00:00:00.000Z" }],
      [{ id: "c", started_at: "2027-01-03T00:00:00.000Z" }],
      [],
    ]);

    await listCallStartsByOutcomeBetween(db, "acct_1", ["lead"], "2027-01-01T00:00:00.000Z", "2027-02-01T00:00:00.000Z", 2);

    expect(orderCalls).toEqual(limitCalls.map(() => ["id", { ascending: true }]));
  });

  it("stops immediately on a first page that is already empty", async () => {
    const { db, limitCalls } = fakeCallsDb([[]]);

    const result = await listCallStartsByOutcomeBetween(
      db, "acct_1", ["lead"], "2027-01-01T00:00:00.000Z", "2027-02-01T00:00:00.000Z",
    );

    expect(result).toEqual([]);
    expect(limitCalls.length).toBe(1);
  });
});
