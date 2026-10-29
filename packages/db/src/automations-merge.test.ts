import { describe, it, expect } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getDueReactivationById } from "./automations";

/**
 * F-006 part 1 (Task 8), migration 0106: a reactivation held before a merge
 * must never release to the merged-away address — the kept record has its
 * own reactivation clock. `getDueReactivationById` is the held-RELEASE path
 * (`processReactivations`'s own due-list walk starts from conversations, and
 * a tombstone owns none, so it never surfaces one to hold in the first
 * place); this pins the release's contacts read.
 *
 * `recordingDb` is the same shape as `automations-archive.test.ts`'s own
 * copy (itself "T4's `recordingDb`, with one fix"): a chain that calls
 * `.maybeSingle()` defaults to `null` with no seeded answer, so the by-id
 * read's `if (!contact)` branch is reachable without seeding a row.
 */
function recordingDb(answers: Record<string, unknown> = {}) {
  const calls: { table: string; method: string; args: unknown[] }[] = [];
  const chainFor = (table: string): unknown => {
    let single = false;
    const chain: unknown = new Proxy({}, {
      get(_t, method: string) {
        if (method === "then") {
          return (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => {
            const seeded = Object.prototype.hasOwnProperty.call(answers, table);
            const data = seeded ? answers[table] : (single ? null : []);
            return Promise.resolve({ data, error: null, count: 0 }).then(res, rej);
          };
        }
        if (method === "maybeSingle") single = true;
        return (...args: unknown[]) => { calls.push({ table, method, args }); return chain; };
      },
    });
    return chain;
  };
  const db = { from: (table: string) => chainFor(table) } as unknown as SupabaseClient;
  return { db, calls };
}
const has = (calls: { method: string; args: unknown[] }[], method: string, ...args: unknown[]) =>
  calls.some((c) => c.method === method && JSON.stringify(c.args) === JSON.stringify(args));

describe("getDueReactivationById: a merged-away contact is never released to", () => {
  it("filters its contacts read on merged_into is null (mutation: drop the filter -> the recorded call lacks it, FAILS)", async () => {
    const { db, calls } = recordingDb();
    const r = await getDueReactivationById(db, "id-1");
    expect(has(calls, "is", "merged_into", null)).toBe(true);
    expect(r).toEqual({ due: null, why: "gone" });
  });
});
