import { describe, it, expect } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { listSubmissionCreationsBetween } from "../forms";

/**
 * Pure pagination-logic test — no real database, same shape
 * `opportunities-pagination.test.ts` uses for `sumOpenOpportunities`. The
 * reviewer's finding this guards: a row-returning read with no `.limit()`
 * inherits PostgREST's `max_rows` cap, so a window with more real
 * submissions than that cap would silently drop the newest ones (ordered by
 * `created_at` ascending, as the sibling `listContactCreationsBetween` this
 * replaced was — the row-cap defect the reviewer caught there). Keyset
 * paging on `id` is the fix; this test proves the LOOP, not the live query.
 */
function fakeSubmissionsDb(pages: { id: string; created_at: string }[][]) {
  const limitCalls: number[] = [];
  const eqCalls: Array<[string, unknown]> = [];
  const isCalls: Array<[string, unknown]> = [];
  const orderCalls: Array<[string, unknown]> = [];
  const gtCalls: Array<[string, unknown]> = [];
  // Column-aware, unlike a bare `() => builder` passthrough: a mutation
  // that swaps the filtered COLUMN (`created_at` -> some other timestamp)
  // must fail an assertion here, not silently no-op.
  const gteCalls: Array<[string, unknown]> = [];
  const ltCalls: Array<[string, unknown]> = [];
  let call = 0;
  const builder: Record<string, unknown> = {
    eq: (col: string, val: unknown) => { eqCalls.push([col, val]); return builder; },
    is: (col: string, val: unknown) => { isCalls.push([col, val]); return builder; },
    gte: (col: string, val: unknown) => { gteCalls.push([col, val]); return builder; },
    lt: (col: string, val: unknown) => { ltCalls.push([col, val]); return builder; },
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
  return { db, limitCalls, eqCalls, isCalls, orderCalls, gtCalls, gteCalls, ltCalls };
}

describe("listSubmissionCreationsBetween (keyset pagination, no row-cap undercount)", () => {
  // The reviewer's probe, transplanted: a server `max_rows` below the
  // requested page size hands back a SHORT but non-empty page every time.
  // Offset/`.range()` paging (or any rule that stops once a page is shorter
  // than asked) would read only the first short page and silently drop the
  // rest. Keyset paging only trusts a genuinely EMPTY page as "no more rows".
  it("keeps paging past a SHORT non-empty page until a genuinely empty page", async () => {
    const { db, gtCalls, limitCalls } = fakeSubmissionsDb([
      [{ id: "a", created_at: "2027-01-01T00:00:00.000Z" }, { id: "b", created_at: "2027-01-02T00:00:00.000Z" }],
      [{ id: "c", created_at: "2027-01-03T00:00:00.000Z" }],
      [],
    ]);

    const result = await listSubmissionCreationsBetween(
      db, "acct_1", "2027-01-01T00:00:00.000Z", "2027-02-01T00:00:00.000Z", 5,
    );

    expect(result).toEqual([
      "2027-01-01T00:00:00.000Z", "2027-01-02T00:00:00.000Z", "2027-01-03T00:00:00.000Z",
    ]);
    expect(limitCalls).toEqual([5, 5, 5]);
    expect(gtCalls).toEqual([["id", "b"], ["id", "c"]]);
  });

  it("orders by id on every page, not just the first", async () => {
    const { db, orderCalls, limitCalls } = fakeSubmissionsDb([
      [{ id: "a", created_at: "2027-01-01T00:00:00.000Z" }, { id: "b", created_at: "2027-01-02T00:00:00.000Z" }],
      [{ id: "c", created_at: "2027-01-03T00:00:00.000Z" }],
      [],
    ]);

    await listSubmissionCreationsBetween(db, "acct_1", "2027-01-01T00:00:00.000Z", "2027-02-01T00:00:00.000Z", 2);

    expect(orderCalls).toEqual(limitCalls.map(() => ["id", { ascending: true }]));
  });

  it("scopes every page to the account and the non-spam filter, not just the first", async () => {
    const { db, eqCalls, isCalls, limitCalls } = fakeSubmissionsDb([
      [{ id: "a", created_at: "2027-01-01T00:00:00.000Z" }],
      [{ id: "b", created_at: "2027-01-02T00:00:00.000Z" }],
      [],
    ]);

    await listSubmissionCreationsBetween(db, "acct_1", "2027-01-01T00:00:00.000Z", "2027-02-01T00:00:00.000Z", 1);

    expect(limitCalls.length).toBe(3);
    expect(eqCalls).toEqual(limitCalls.map(() => ["account_id", "acct_1"]));
    expect(isCalls).toEqual(limitCalls.map(() => ["spam_reason", null]));
  });

  it("stops immediately on a first page that is already empty", async () => {
    const { db, limitCalls } = fakeSubmissionsDb([[]]);

    const result = await listSubmissionCreationsBetween(db, "acct_1", "2027-01-01T00:00:00.000Z", "2027-02-01T00:00:00.000Z");

    expect(result).toEqual([]);
    expect(limitCalls.length).toBe(1);
  });

  it("filters the WINDOW on created_at, never some other timestamp column", async () => {
    const { db, gteCalls, ltCalls } = fakeSubmissionsDb([
      [{ id: "a", created_at: "2027-01-01T00:00:00.000Z" }],
      [],
    ]);

    await listSubmissionCreationsBetween(db, "acct_1", "2027-01-01T00:00:00.000Z", "2027-02-01T00:00:00.000Z", 1);

    expect(gteCalls).toEqual([
      ["created_at", "2027-01-01T00:00:00.000Z"], ["created_at", "2027-01-01T00:00:00.000Z"],
    ]);
    expect(ltCalls).toEqual([
      ["created_at", "2027-02-01T00:00:00.000Z"], ["created_at", "2027-02-01T00:00:00.000Z"],
    ]);
  });
});
