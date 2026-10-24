import { describe, it, expect } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { listClosureAppointments, CLOSURE_APPOINTMENTS_LIMIT } from "../business-status";

/**
 * minors-1b item 5: `listClosureAppointments` had no `.limit()` — an account whose closure window covers
 * a lot of booked appointments (the Calendar page's own union-window read, follow-up, can span up to 100
 * ranges) had no query-level backstop at all. Checked here with a fake client, no database (same shape as
 * `record-people-names-cap.test.ts`), so it fails locally by name on the real read logic, without seeding
 * hundreds of rows in a live project.
 */
type Answer = { data: unknown; error: unknown };
function fakeDb(answer: Answer = { data: [], error: null }) {
  const calls: { op: string; args: unknown[] }[] = [];
  const chain: Record<string, unknown> = {};
  for (const op of ["select", "eq", "gte", "lt", "order", "limit"]) {
    chain[op] = (...args: unknown[]) => { calls.push({ op, args }); return chain; };
  }
  chain.then = (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) =>
    Promise.resolve(answer).then(res, rej);
  const db = { from: () => chain };
  return { db: db as unknown as SupabaseClient, calls };
}

describe("listClosureAppointments — query-level cap (no database)", () => {
  it(`caps the query at ${CLOSURE_APPOINTMENTS_LIMIT} (mutation: drop the .limit() call -> FAILS)`, async () => {
    const { db, calls } = fakeDb();
    await listClosureAppointments(db, "acct_1", "2027-06-01T00:00:00.000Z", "2027-06-02T00:00:00.000Z");
    expect(calls.filter((c) => c.op === "limit").map((c) => c.args[0])).toEqual([CLOSURE_APPOINTMENTS_LIMIT]);
  });

  it("still maps the rows unchanged (the cap is additive, not a behaviour change)", async () => {
    const { db } = fakeDb({
      data: [{
        id: "bk1", contact_id: "c1", starts_at: "2027-06-01T15:00:00.000Z", ends_at: "2027-06-01T15:30:00.000Z",
        closure_kept_at: null, contacts: { first_name: "Ana", last_name: "Cruz" },
      }],
      error: null,
    });
    const got = await listClosureAppointments(db, "acct_1", "2027-06-01T00:00:00.000Z", "2027-06-02T00:00:00.000Z");
    expect(got).toEqual([{
      id: "bk1", contact_id: "c1", starts_at: "2027-06-01T15:00:00.000Z", ends_at: "2027-06-01T15:30:00.000Z",
      closure_kept_at: null, first_name: "Ana", last_name: "Cruz",
    }]);
  });
});
