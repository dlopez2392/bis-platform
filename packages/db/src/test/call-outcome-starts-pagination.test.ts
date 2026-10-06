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
  // Column-aware, unlike a bare `() => builder` passthrough: a mutation that
  // swaps the filtered COLUMN (`started_at` -> `created_at`) or drops the
  // account scope entirely must fail an assertion here, not silently no-op
  // (the reviewer's finding against the first version of this file, which
  // only recorded `gt`/`order`/`in` and let `eq`/`gte`/`lt` ignore their
  // arguments).
  const gteCalls: Array<[string, unknown]> = [];
  const ltCalls: Array<[string, unknown]> = [];
  const orCalls: string[] = [];
  let call = 0;
  const builder: Record<string, unknown> = {
    eq: (col: string, val: unknown) => { eqCalls.push([col, val]); return builder; },
    in: (col: string, val: unknown) => { inCalls.push([col, val]); return builder; },
    gte: (col: string, val: unknown) => { gteCalls.push([col, val]); return builder; },
    lt: (col: string, val: unknown) => { ltCalls.push([col, val]); return builder; },
    order: (col: string, opts: unknown) => { orderCalls.push([col, opts]); return builder; },
    gt: (col: string, val: unknown) => { gtCalls.push([col, val]); return builder; },
    or: (filter: string) => { orCalls.push(filter); return builder; },
    limit: async (n: number) => {
      limitCalls.push(n);
      const data = pages[call] ?? [];
      call += 1;
      return { data, error: null };
    },
  };
  const db = { from: () => ({ select: () => builder }) } as unknown as SupabaseClient;
  return { db, limitCalls, eqCalls, inCalls, orderCalls, gtCalls, gteCalls, ltCalls, orCalls };
}

describe("listCallStartsByOutcomeBetween (keyset pagination, no row-cap undercount)", () => {
  it("keeps paging past a SHORT non-empty page until a genuinely empty page", async () => {
    const { db, gtCalls, limitCalls } = fakeCallsDb([
      [{ id: "a", started_at: "2027-01-01T00:00:00.000Z" }, { id: "b", started_at: "2027-01-02T00:00:00.000Z" }],
      [{ id: "c", started_at: "2027-01-03T00:00:00.000Z" }],
      [],
    ]);

    const result = await listCallStartsByOutcomeBetween(
      db, "acct_1", ["lead"], "2027-01-01T00:00:00.000Z", "2027-02-01T00:00:00.000Z", { pageSize: 5 },
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

    await listCallStartsByOutcomeBetween(db, "acct_1", ["lead"], "2027-01-01T00:00:00.000Z", "2027-02-01T00:00:00.000Z", { pageSize: 1 });

    expect(inCalls).toEqual([["outcome", ["lead"]], ["outcome", ["lead"]]]);
  });

  it("orders by id on every page, not just the first", async () => {
    const { db, orderCalls, limitCalls } = fakeCallsDb([
      [{ id: "a", started_at: "2027-01-01T00:00:00.000Z" }, { id: "b", started_at: "2027-01-02T00:00:00.000Z" }],
      [{ id: "c", started_at: "2027-01-03T00:00:00.000Z" }],
      [],
    ]);

    await listCallStartsByOutcomeBetween(db, "acct_1", ["lead"], "2027-01-01T00:00:00.000Z", "2027-02-01T00:00:00.000Z", { pageSize: 2 });

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

  // Review finding: a mutation swapping the filtered column to `created_at`
  // previously survived every test above, since the fake `gte`/`lt` ignored
  // which column they were called with.
  it("filters the WINDOW on started_at, never created_at", async () => {
    const { db, gteCalls, ltCalls } = fakeCallsDb([
      [{ id: "a", started_at: "2027-01-01T00:00:00.000Z" }],
      [],
    ]);

    await listCallStartsByOutcomeBetween(db, "acct_1", ["lead"], "2027-01-01T00:00:00.000Z", "2027-02-01T00:00:00.000Z", { pageSize: 1 });

    expect(gteCalls).toEqual([
      ["started_at", "2027-01-01T00:00:00.000Z"], ["started_at", "2027-01-01T00:00:00.000Z"],
    ]);
    expect(ltCalls).toEqual([
      ["started_at", "2027-02-01T00:00:00.000Z"], ["started_at", "2027-02-01T00:00:00.000Z"],
    ]);
  });

  // Review finding: dropping `.eq("account_id", …)` previously survived
  // every test above too — an agency viewer's dashboard would then count
  // every client's leads, not just this account's.
  it("scopes EVERY page to the given account — not just the first", async () => {
    const { db, eqCalls, limitCalls } = fakeCallsDb([
      [{ id: "a", started_at: "2027-01-01T00:00:00.000Z" }],
      [{ id: "b", started_at: "2027-01-02T00:00:00.000Z" }],
      [],
    ]);

    await listCallStartsByOutcomeBetween(db, "acct_1", ["lead"], "2027-01-01T00:00:00.000Z", "2027-02-01T00:00:00.000Z", { pageSize: 1 });

    expect(limitCalls.length).toBe(3);
    expect(eqCalls).toEqual(limitCalls.map(() => ["account_id", "acct_1"]));
  });

  // The agency's own test handsets (`agencyHandsets()` in apps/web). The
  // live suite (voice.test.ts) proves PostgREST reads this filter the way it
  // is written; these pin the string and its guards without a database.
  it("no excludeCallers means no caller filter at all", async () => {
    const { db, orCalls } = fakeCallsDb([[]]);
    await listCallStartsByOutcomeBetween(db, "acct_1", ["lead"], "2027-01-01T00:00:00.000Z", "2027-02-01T00:00:00.000Z", { excludeCallers: [] });
    expect(orCalls).toEqual([]);
  });

  it("excludeCallers keeps withheld numbers (IS NULL) and quotes every value, on EVERY page", async () => {
    const { db, orCalls, limitCalls } = fakeCallsDb([
      [{ id: "a", started_at: "2027-01-01T00:00:00.000Z" }],
      [],
    ]);
    await listCallStartsByOutcomeBetween(
      db, "acct_1", ["lead"], "2027-01-01T00:00:00.000Z", "2027-02-01T00:00:00.000Z",
      { pageSize: 1, excludeCallers: ["+19565550101", "+19565550102"] },
    );
    expect(orCalls).toEqual(limitCalls.map(
      () => 'caller_e164.is.null,caller_e164.not.in.("+19565550101","+19565550102")',
    ));
  });

  it("refuses a value that is not +E.164 rather than splicing it into the filter", async () => {
    const { db, limitCalls } = fakeCallsDb([[]]);
    await expect(listCallStartsByOutcomeBetween(
      db, "acct_1", ["lead"], "2027-01-01T00:00:00.000Z", "2027-02-01T00:00:00.000Z",
      { excludeCallers: ["+19565550101),outcome.eq.spam"] },
    )).rejects.toThrow("+E.164");
    expect(limitCalls).toEqual([]);
  });
});
