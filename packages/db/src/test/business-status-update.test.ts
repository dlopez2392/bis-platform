import { describe, it, expect } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { updateBusinessStatus } from "../business-status";

/**
 * S-47d fix round B2: the compare-and-set half of `updateBusinessStatus`, checked with NO database, so it
 * runs on every CI run. The live case in business-status.test.ts needs a signed Owner token, which needs
 * the replica's JWT secret, and CI's stack never exposes it (that case is `skipIf(!SECRET)`). Without this
 * file, deleting the `.eq("set_at", …)` line would leave every CI run green.
 *
 * A fake client records each builder call on `business_status`; `answer` is what the awaited select
 * resolves to.
 */
type Call = { op: string; args: unknown[] };
function fakeDb(answer: { data: unknown; error: unknown }) {
  const calls: Call[] = [];
  const b: Record<string, unknown> = {};
  for (const op of ["update", "eq", "select"]) {
    b[op] = (...args: unknown[]) => { calls.push({ op, args }); return b; };
  }
  b.then = (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => Promise.resolve(answer).then(res, rej);
  const db = { from: (table: string) => { calls.push({ op: "from", args: [table] }); return b; } };
  return { db: db as unknown as SupabaseClient, calls };
}

const PATCH = { state: "closed_today" as const, late_minutes: null, until: null };
const ROW = {
  account_id: "a1", state: "closed_today", late_minutes: null, until: null,
  set_by: "user_1", set_at: "2027-06-07T15:00:00.123456+00:00",
};
const eqs = (calls: Call[]) => calls.filter((c) => c.op === "eq").map((c) => c.args);

describe("updateBusinessStatus — the compare-and-set filter (no database)", () => {
  it("with expectedSetAt: filters on account_id AND on set_at, the string passed verbatim (mutation: delete the q.eq(\"set_at\", …) line -> FAILS)", async () => {
    const { db, calls } = fakeDb({ data: [ROW], error: null });
    const r = await updateBusinessStatus(db, "a1", PATCH, { expectedSetAt: "2027-06-07T15:00:00.123456+00:00" });
    expect(eqs(calls)).toEqual([["account_id", "a1"], ["set_at", "2027-06-07T15:00:00.123456+00:00"]]);
    expect(calls[0]).toEqual({ op: "from", args: ["business_status"] });
    expect(calls.find((c) => c.op === "update")?.args[0]).toEqual({ state: "closed_today", late_minutes: null, until: null });
    expect(r).toEqual(ROW);
  });

  it("without expectedSetAt: filters on account_id ONLY, never on set_at (mutation: always append the set_at filter -> FAILS)", async () => {
    const { db, calls } = fakeDb({ data: [ROW], error: null });
    await updateBusinessStatus(db, "a1", PATCH);
    expect(eqs(calls)).toEqual([["account_id", "a1"]]);
  });

  it("an empty string is still a given expectedSetAt (the check is `!== undefined`, not truthiness)", async () => {
    const { db, calls } = fakeDb({ data: [], error: null });
    const r = await updateBusinessStatus(db, "a1", PATCH, { expectedSetAt: "" });
    expect(eqs(calls)).toEqual([["account_id", "a1"], ["set_at", ""]]);
    expect(r).toBeNull();
  });

  it("no row matched (a lost compare-and-set, or RLS USING): null", async () => {
    const { db } = fakeDb({ data: [], error: null });
    expect(await updateBusinessStatus(db, "a1", PATCH, { expectedSetAt: "x" })).toBeNull();
  });

  it("a 42501 (RLS WITH CHECK, SD1) maps to null, never a throw (mutation: drop the 42501 branch -> FAILS)", async () => {
    const { db } = fakeDb({ data: null, error: { code: "42501", message: "new row violates row-level security policy" } });
    await expect(updateBusinessStatus(db, "a1", PATCH)).resolves.toBeNull();
  });

  it("any other error throws, naming the function", async () => {
    const { db } = fakeDb({ data: null, error: { code: "23514", message: "check violation" } });
    await expect(updateBusinessStatus(db, "a1", PATCH)).rejects.toThrow(/^updateBusinessStatus failed: check violation$/);
  });
});
