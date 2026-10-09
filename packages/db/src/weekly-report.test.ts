import { describe, it, expect } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { listAccountsDueWeeklyReport } from "./weekly-report";

/**
 * D-067, the ordering half: the pass caps how many accounts it attempts in
 * one tick (passes/weekly-report.ts, `WEEKLY_REPORT_TICK_CAP`, its own
 * limit — not the shared recipe burst guard). The REAL cursor that makes
 * those limited attempts land on progress across the Monday band's twelve
 * ticks is `accounts.weekly_report_week`, checked for free in the pass's
 * own loop before either limit — an account already stamped for this week
 * costs nothing there. What this file's ordering is for is narrower: with
 * no stated order, a cap-sized window into the NOT-yet-stamped accounts
 * could favour a different, arbitrary subset of them each time the read
 * runs, rather than the same subset the previous tick's attempts had
 * already passed over — oldest-account-first (`created_at`, the one
 * column every account has that is set once and never changes) is what
 * makes THAT deterministic rather than an accident of whatever order
 * Postgres happens to return today.
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
  for (const k of ["select", "neq", "eq", "order", "range", "in"]) {
    chain[k] = (...a: unknown[]) => { calls.push([k, ...a]); return chain; };
  }
  (chain as { then?: unknown }).then = (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => answer().then(res, rej);
  const db = { from: (t: string) => { calls.push(["from", t]); return chain; } } as unknown as SupabaseClient;
  return { db, calls };
}

describe("listAccountsDueWeeklyReport — the due-list's own ordering contract (D-067)", () => {
  it("orders the due read deterministically, oldest account first, id as the tiebreak (mutation: drop either .order() call → FAILS)", async () => {
    const f = fakeDb([{ data: [], error: null }]);
    await listAccountsDueWeeklyReport(f.db);
    expect(f.calls).toContainEqual(["order", "created_at", { ascending: true }]);
    expect(f.calls).toContainEqual(["order", "id", { ascending: true }]);
  });
});

/**
 * D-067 (review round 2): an unpaged read inherits PostgREST's `max_rows`
 * cap, and with `order("created_at")` ascending that silently drops the
 * accounts at the TAIL — the newest-created ones — rather than erroring.
 * Paged like `listTrafficBreakdown` (sites.ts): advance by the page's
 * ACTUAL length and stop only on a genuinely EMPTY page, never on "fewer
 * than requested" — the server's own `max_rows` can already be below the
 * page size asked for (`listBilledUsageAccounts`'s own documented lesson,
 * usage.ts), and advancing by the requested size instead of the real one
 * would skip straight over whatever that short page didn't carry.
 */
function acctRow(id: string) {
  return {
    id, created_at: "2020-01-01T00:00:00.000Z", report_emails: [`${id}@example.com`],
    weekly_report_week: null, timezone: "America/Chicago", brand_name: id,
    brand_logo_path: null, brand_color: null, brand_neutral: null, brand_corners: null,
    brand_type: null, brand_mode: null, reply_to_email: null,
  };
}

describe("listAccountsDueWeeklyReport — pages past a short page, stopping only on a genuinely empty one (D-067)", () => {
  it("keeps paging past TWO short non-empty pages until an empty one, advancing by the ACTUAL rows returned each time (mutation: stop once a page is shorter than requested, or advance by the page size instead of rows.length → FAILS)", async () => {
    const f = fakeDb([
      { data: [acctRow("a"), acctRow("b")], error: null },   // short: 2 rows, nowhere near the 1,000-row page
      { data: [acctRow("c")], error: null },                  // short again
      { data: [], error: null },                               // genuinely empty — THIS is what stops it
      { data: [], error: null },                               // the sites lookup (no sites linked)
    ]);
    const rows = await listAccountsDueWeeklyReport(f.db);
    expect(rows.map((r) => r.accountId)).toEqual(["a", "b", "c"]);
    const ranges = f.calls.filter((c) => c[0] === "range").map((c) => [c[1], c[2]]);
    expect(ranges).toEqual([[0, 999], [2, 1001], [3, 1002]]);
  });
});
