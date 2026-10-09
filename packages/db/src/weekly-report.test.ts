import { describe, it, expect } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { listAccountsDueWeeklyReport } from "./weekly-report";

/**
 * D-067, the ordering half: the pass caps how many accounts it attempts in
 * one tick (passes/weekly-report.ts, AUTOMATION_TICK_CAP) and relies on the
 * due-list returning accounts in a CONSISTENT order from one tick to the
 * next, because the accounts a cap turns away this tick must be exactly the
 * ones it reaches first next tick — otherwise a cap-sized window into a
 * read with no stated order can skip some accounts for the whole Monday
 * band while reattempting others, however many of the band's twelve ticks
 * it gets. Oldest-account-first (`created_at`, the one column every account
 * has that is set once and never changes) is what turns that walk into a
 * real one rather than an accident of whatever order Postgres happens to
 * return today.
 *
 * Against a PostgREST-shaped fake that records what it was asked (no
 * database; `listAccountsDueWeeklyReport` returns early on an empty read,
 * so nothing past the first query needs a response here) — a live ordering
 * assertion against the real shared project cannot be trusted to RED on a
 * missing `.order()`: a small, rarely-written table's default scan is
 * usually stable in PRACTICE, which is exactly the accident this guards
 * against trusting.
 */
type Answer = { data: unknown; error: unknown };
function fakeDb(answers: Answer[]) {
  const calls: Array<[string, ...unknown[]]> = [];
  let next = 0;
  const answer = () => Promise.resolve(answers[next++] ?? { data: null, error: null });
  const chain: Record<string, (...a: unknown[]) => unknown> = {};
  for (const k of ["select", "neq", "eq", "order"]) {
    chain[k] = (...a: unknown[]) => { calls.push([k, ...a]); return chain; };
  }
  (chain as { then?: unknown }).then = (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => answer().then(res, rej);
  const db = { from: (t: string) => { calls.push(["from", t]); return chain; } } as unknown as SupabaseClient;
  return { db, calls };
}

describe("listAccountsDueWeeklyReport — the due-list's own ordering contract (D-067)", () => {
  it("orders the due read deterministically, oldest account first (mutation: drop the .order() call → FAILS)", async () => {
    const f = fakeDb([{ data: [], error: null }]);
    await listAccountsDueWeeklyReport(f.db);
    expect(f.calls).toContainEqual(["order", "created_at", { ascending: true }]);
  });
});
