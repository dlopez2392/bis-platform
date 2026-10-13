import { describe, it, expect } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { listPeopleNames } from "../record";

/**
 * minors-1b item 3: listPeopleNames had no `.limit()` on its query — a
 * caller that ever grew past the one bounded caller it has today (the
 * record timeline, TIMELINE_PAGE_SIZE = 30 distinct person ids per page)
 * would have no query-level backstop. Checked here with a fake client, no
 * database, so it fails locally by name — same shape as
 * booking-author-shape.test.ts.
 */
type Answer = { data: unknown; error: unknown };
function fakeDb(answer: Answer = { data: [], error: null }) {
  const calls: { op: string; args: unknown[] }[] = [];
  const chain: Record<string, unknown> = {};
  for (const op of ["select", "in", "limit"]) {
    chain[op] = (...args: unknown[]) => { calls.push({ op, args }); return chain; };
  }
  chain.then = (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) =>
    Promise.resolve(answer).then(res, rej);
  const db = { from: () => chain };
  return { db: db as unknown as SupabaseClient, calls };
}

describe("listPeopleNames — query-level cap (no database)", () => {
  it("caps the query at the number of distinct ids asked (mutation: drop the .limit() call -> FAILS)", async () => {
    const { db, calls } = fakeDb();
    await listPeopleNames(db, ["a", "b", "c", "a"]);
    expect(calls.filter((c) => c.op === "limit").map((c) => c.args[0])).toEqual([3]);
  });

  it("an empty id list never reaches the database at all (mutation: drop the early return -> FAILS, a .from() call is recorded)", async () => {
    let fromCalled = false;
    const db = { from: () => { fromCalled = true; return {}; } } as unknown as SupabaseClient;
    expect(await listPeopleNames(db, [])).toEqual({});
    expect(fromCalled).toBe(false);
  });

  it("still returns the mapped rows unchanged (the cap is additive, not a behaviour change)", async () => {
    const { db } = fakeDb({
      data: [{ clerk_user_id: "a", name: "Dan", email: "dan@example.com" }],
      error: null,
    });
    expect(await listPeopleNames(db, ["a"])).toEqual({ a: "Dan" });
  });
});
