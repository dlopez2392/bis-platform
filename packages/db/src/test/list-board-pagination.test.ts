import { describe, it, expect } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { listBoard } from "../opportunities";

/**
 * D-105: `listBoard` read every opportunity in one unpaged `.select()`, so
 * PostgREST's row cap (max_rows, 1000 in production) silently dropped any
 * card past it — the board would just show fewer cards than exist, with no
 * sign anything was missing (DESIGN.md: "never promise a number the screen
 * can't know"). The fix pages past the cap with the same keyset pattern
 * `sumOpenOpportunities` already uses (id ascending, `.gt()` cursor,
 * stopping only on a genuinely empty page) so the board holds every card,
 * not just the first `pageSize` of them.
 *
 * Pure pagination-logic test — no real database. One fake `pipeline_stages`
 * table (answered in one shot) and one fake `opportunities` table that hands
 * back one page per `.limit()` call, recording what `.eq()`/`.order()`/
 * `.gt()` were asked for.
 */
function fakeBoardDb(
  stages: { id: string; name: string; position: number }[],
  pages: Array<Array<{
    id: string; name: string; monetary_value: number; status: string;
    stage_id: string; created_at: string;
    contacts: { id: string; first_name: string | null; last_name: string | null };
  }>>,
) {
  const limitCalls: number[] = [];
  const eqCalls: Array<[string, unknown]> = [];
  const orderCalls: Array<[string, unknown]> = [];
  const gtCalls: Array<[string, unknown]> = [];
  let call = 0;
  const oppsBuilder: Record<string, unknown> = {
    eq: (col: string, val: unknown) => {
      eqCalls.push([col, val]);
      return oppsBuilder;
    },
    order: (col: string, opts: unknown) => {
      orderCalls.push([col, opts]);
      return oppsBuilder;
    },
    gt: (col: string, val: unknown) => {
      gtCalls.push([col, val]);
      return oppsBuilder;
    },
    limit: async (n: number) => {
      limitCalls.push(n);
      const data = pages[call] ?? [];
      call += 1;
      return { data, error: null };
    },
  };
  const stagesBuilder = {
    eq: () => stagesBuilder,
    order: async () => ({ data: stages, error: null }),
  };
  const db = {
    from: (table: string) => {
      if (table === "pipeline_stages") return { select: () => stagesBuilder };
      return { select: () => oppsBuilder };
    },
  } as unknown as SupabaseClient;
  return { db, limitCalls, eqCalls, orderCalls, gtCalls };
}

function oppRow(id: string, stageId: string, value: number, createdAt = "2027-01-01T00:00:00.000Z") {
  return {
    id, name: id, monetary_value: value, status: "open", stage_id: stageId,
    created_at: createdAt,
    contacts: { id: "c1", first_name: "A", last_name: "B" },
  };
}

const STAGES = [{ id: "s1", name: "New Lead", position: 0 }];

describe("listBoard (keyset pagination, no row-cap undercount)", () => {
  it("collects cards across multiple pages past a shrunk page size, stopping on the empty page", async () => {
    const { db, limitCalls } = fakeBoardDb(STAGES, [
      [oppRow("a", "s1", 100), oppRow("b", "s1", 200)],
      [oppRow("c", "s1", 300), oppRow("d", "s1", 400)],
      // Third page empty — the loop must stop here, not keep requesting.
    ]);

    const board = await listBoard(db, "acct1", "pipe1", 2);

    expect(board).toHaveLength(1);
    expect(board[0]!.opportunities).toHaveLength(4);
    expect(board[0]!.opportunities.map((o) => o.id).sort()).toEqual(["a", "b", "c", "d"]);
    expect(board[0]!.totalValue).toBe(1000);
    expect(limitCalls).toEqual([2, 2, 2]);
  });

  it("keeps paging past a SHORT non-empty page until a genuinely empty page", async () => {
    const { db, gtCalls } = fakeBoardDb(STAGES, [
      [oppRow("a", "s1", 100), oppRow("b", "s1", 200)], // short: asked for 5
      [oppRow("c", "s1", 300)],                           // short again
      [],                                                  // the real end
    ]);

    const board = await listBoard(db, "acct1", "pipe1", 5);

    expect(board[0]!.opportunities).toHaveLength(3);
    expect(gtCalls).toEqual([["id", "b"], ["id", "c"]]);
  });

  it("orders by id on every page, not just the first", async () => {
    const { db, orderCalls, limitCalls } = fakeBoardDb(STAGES, [
      [oppRow("a", "s1", 100), oppRow("b", "s1", 200)],
      [oppRow("c", "s1", 300)],
    ]);

    await listBoard(db, "acct1", "pipe1", 2);

    expect(limitCalls.length).toBeGreaterThan(1);
    expect(orderCalls).toEqual(limitCalls.map(() => ["id", { ascending: true }]));
  });

  // Coordinator-requested gap closure: the four tests above all give every
  // row the SAME created_at, so the keyset order (by `id`, the fetch-time
  // cursor) and the display order (newest-first by `created_at`, restored
  // once every page is in) happen to coincide by construction — a test
  // that could pass even if the final `.sort()` were deleted entirely.
  // Here the fetch (keyset/id) order is OLDEST id first ("a", "b", "c") but
  // the created_at values are deliberately NOT monotonic with id, spread
  // across two separate pages, so only a real post-fetch sort by
  // created_at — not the order pages arrived in — can produce the newest-
  // first id sequence this test asserts (mutation: delete the final `.sort`
  // call → the ids would come back in fetch order "a","b","c" instead).
  it("restores newest-first display order across page boundaries, not fetch (id) order (mutation: delete the final .sort → FAILS)", async () => {
    const { db } = fakeBoardDb(STAGES, [
      // Page 1: ids "a" (oldest) then "b" (newest) — fetched in that order.
      [oppRow("a", "s1", 100, "2027-01-01T00:00:00.000Z"),
       oppRow("b", "s1", 200, "2027-01-03T00:00:00.000Z")],
      // Page 2: id "c" (middle) — a THIRD page, so the sort has to survive
      // the pagination loop, not just one page's own Array#sort call.
      [oppRow("c", "s1", 300, "2027-01-02T00:00:00.000Z")],
    ]);

    const board = await listBoard(db, "acct1", "pipe1", 2);

    expect(board[0]!.opportunities.map((o) => o.id)).toEqual(["b", "c", "a"]);
  });

  it("scopes EVERY page to this account and pipeline", async () => {
    const { db, eqCalls, limitCalls } = fakeBoardDb(STAGES, [
      [oppRow("a", "s1", 50)],
      [oppRow("b", "s1", 25)],
      [],
    ]);

    await listBoard(db, "acct_1", "pipe_1", 1);

    expect(limitCalls.length).toBe(3);
    expect(eqCalls.filter(([c]) => c === "account_id")).toEqual(limitCalls.map(() => ["account_id", "acct_1"]));
    expect(eqCalls.filter(([c]) => c === "pipeline_id")).toEqual(limitCalls.map(() => ["pipeline_id", "pipe_1"]));
  });
});
