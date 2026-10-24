import { describe, it, expect } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { listClosureAppointmentsForRanges, CLOSURE_APPOINTMENTS_LIMIT } from "../business-status";

/**
 * Fix round (sonnet review, CHANGES REQUESTED on the Calendar page's union query): the first cut of the
 * "one query, not N" fix (minors-1b item 5) spanned [earliest range start, latest range end + 1 day) —
 * every ORDINARY booking in the gap between two far-apart ranges spent a slot of the shared
 * CLOSURE_APPOINTMENTS_LIMIT cap on a booking no closure ever touched. `listClosureAppointmentsForRanges`
 * is the single-query shape that is actually scoped to the ranges themselves: a `.or()` of one
 * `and(gte, lt)` per range. Checked here with a fake client, no database (the SAME shape
 * `business-status-limit.test.ts` and `record-people-names-cap.test.ts` already use), so it fails
 * locally by name — this is the "assert the query shape" half of the fix round's own test list; the
 * "a booking in the gap is not fetched" half, against the real caller, is calendar/page.test.ts's job
 * (it is the caller who decides whether the ranges passed in are the per-range windows or the
 * enclosing span).
 */
type Answer = { data: unknown; error: unknown };
function fakeDb(answer: Answer = { data: [], error: null }) {
  const calls: { op: string; args: unknown[] }[] = [];
  const chain: Record<string, unknown> = {};
  for (const op of ["select", "eq", "or", "order", "limit"]) {
    chain[op] = (...args: unknown[]) => { calls.push({ op, args }); return chain; };
  }
  chain.then = (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) =>
    Promise.resolve(answer).then(res, rej);
  const db = { from: () => chain };
  return { db: db as unknown as SupabaseClient, calls };
}

describe("listClosureAppointmentsForRanges — query shape (no database)", () => {
  it("builds ONE .or() of per-range and(gte,lt) predicates, never a bare gte/lt spanning the whole union (mutation: span min..max with gte/lt instead -> FAILS, gte/lt is not even on this fake client)", async () => {
    const { db, calls } = fakeDb();
    await listClosureAppointmentsForRanges(db, "acct_1", [
      { fromIso: "2027-06-10T05:00:00.000Z", toIso: "2027-06-13T05:00:00.000Z" },
      { fromIso: "2027-09-01T05:00:00.000Z", toIso: "2027-09-02T05:00:00.000Z" },
    ]);
    const orCalls = calls.filter((c) => c.op === "or");
    expect(orCalls).toHaveLength(1);
    expect(orCalls[0]!.args[0]).toBe(
      "and(starts_at.gte.2027-06-10T05:00:00.000Z,starts_at.lt.2027-06-13T05:00:00.000Z),"
      + "and(starts_at.gte.2027-09-01T05:00:00.000Z,starts_at.lt.2027-09-02T05:00:00.000Z)",
    );
  });

  it("caps the query at CLOSURE_APPOINTMENTS_LIMIT (mutation: drop the .limit() call -> FAILS)", async () => {
    const { db, calls } = fakeDb();
    await listClosureAppointmentsForRanges(db, "acct_1", [{ fromIso: "a", toIso: "b" }]);
    expect(calls.filter((c) => c.op === "limit").map((c) => c.args[0])).toEqual([CLOSURE_APPOINTMENTS_LIMIT]);
  });

  it("no ranges, no query at all (mutation: drop the early return -> a .from() call is recorded, FAILS)", async () => {
    let fromCalled = false;
    const db = { from: () => { fromCalled = true; return {}; } } as unknown as SupabaseClient;
    expect(await listClosureAppointmentsForRanges(db, "acct_1", [])).toEqual([]);
    expect(fromCalled).toBe(false);
  });

  it("still maps the rows unchanged (the shape is additive, not a behaviour change)", async () => {
    const { db } = fakeDb({
      data: [{
        id: "bk1", contact_id: "c1", starts_at: "2027-06-10T15:00:00.000Z", ends_at: "2027-06-10T15:30:00.000Z",
        closure_kept_at: null, contacts: { first_name: "Ana", last_name: "Cruz" },
      }],
      error: null,
    });
    const got = await listClosureAppointmentsForRanges(db, "acct_1", [{ fromIso: "x", toIso: "y" }]);
    expect(got).toEqual([{
      id: "bk1", contact_id: "c1", starts_at: "2027-06-10T15:00:00.000Z", ends_at: "2027-06-10T15:30:00.000Z",
      closure_kept_at: null, first_name: "Ana", last_name: "Cruz",
    }]);
  });
});
