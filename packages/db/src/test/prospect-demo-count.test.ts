// F-140 slice 1: the prospect demo's cap helpers, against a fake query builder. No database: the
// global setup skips its sweep without credentials, and nothing here connects.
import { describe, it, expect } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { countProspectDemosSince, recordProspectDemo, PROSPECT_DEMO_EVENT_TYPE } from "../voice";

type Call = [string, ...unknown[]];

/** Records every builder call; awaiting the chain resolves to `result`. */
function fakeDb(result: { count?: number | null; error?: { message: string } | null }) {
  const calls: Call[] = [];
  const chain: Record<string, unknown> = {};
  for (const name of ["select", "is", "eq", "gte"]) {
    chain[name] = (...args: unknown[]) => { calls.push([name, ...args]); return chain; };
  }
  chain.then = (ok: (v: unknown) => unknown) => Promise.resolve({ count: null, error: null, ...result }).then(ok);
  const inserts: unknown[] = [];
  const db = {
    from: (table: string) => {
      calls.push(["from", table]);
      return { ...chain, insert: async (row: unknown) => { inserts.push(row); return { error: null }; } };
    },
  } as unknown as SupabaseClient;
  return { db, calls, inserts };
}

describe("countProspectDemosSince", () => {
  it("counts THIS person's agency-only demo rows since the given instant (mutation: drop the actor_id filter -> FAILS)", async () => {
    const { db, calls } = fakeDb({ count: 3 });
    await expect(countProspectDemosSince(db, "user_agency", "2026-11-15T15:00:00.000Z")).resolves.toBe(3);
    expect(calls).toEqual([
      ["from", "events"],
      ["select", "id", { count: "exact", head: true }],
      ["is", "account_id", null],
      ["eq", "type", PROSPECT_DEMO_EVENT_TYPE],
      ["eq", "actor_id", "user_agency"],
      ["gte", "created_at", "2026-11-15T15:00:00.000Z"],
    ]);
  });

  it("throws on {count: null, error: null}, so the cap fails closed instead of reading zero (mutation: drop the null check -> FAILS)", async () => {
    const { db } = fakeDb({ count: null, error: null });
    await expect(countProspectDemosSince(db, "user_agency", "2026-11-15T15:00:00.000Z")).rejects.toThrow("no count returned");
  });

  it("throws on a read error", async () => {
    const { db } = fakeDb({ count: null, error: { message: "boom" } });
    await expect(countProspectDemosSince(db, "user_agency", "2026-11-15T15:00:00.000Z")).rejects.toThrow("boom");
  });
});

describe("recordProspectDemo", () => {
  it("writes an agency-only row for the person with an EMPTY payload: nothing about the prospect", async () => {
    const { db, inserts } = fakeDb({});
    await recordProspectDemo(db, "user_agency");
    expect(inserts).toEqual([
      { account_id: null, type: PROSPECT_DEMO_EVENT_TYPE, actor_type: "user", actor_id: "user_agency", payload: {} },
    ]);
  });
});
