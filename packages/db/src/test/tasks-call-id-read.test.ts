import { describe, it, expect } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { listAccountWork } from "../work-queue";
import { listContactTasks } from "../activities";

/**
 * 0064 (`tasks.call_id`) is applied on the CI project and on production
 * (2026-10-09), so the two To do reads that name the column read it
 * directly, in ONE select. The TEMPORARY fallback that retried without the
 * column on a 42703 (call-id-fallback.ts, the 0053/PGRST202 shape #152
 * removed) is gone: a database missing the column is now a real defect, and
 * the read says so instead of quietly dropping the To do's author mark.
 *
 * No real database: a fake `tasks` table that answers the first select with
 * the error a pre-0064 database gave (measured on a local PostgREST 14.14:
 * {"code":"42703","message":"column tasks.call_id does not exist"}) and any
 * later select with a row, so a read that still retried would RESOLVE.
 */
const ROW = {
  id: "t1", contact_id: "c1", title: "Order shingles", due_at: null,
  created_at: "2026-10-09T17:00:00Z", consent_event_id: null, completed_at: null,
};
const MISSING = { code: "42703", details: null, hint: null, message: "column tasks.call_id does not exist" };

function fakeDb() {
  const selects: string[] = [];
  const answer = (table: string, cols: string) => {
    if (table !== "tasks") return { data: [], error: null };
    selects.push(cols);
    return selects.length === 1 ? { data: null, error: MISSING } : { data: [ROW], error: null };
  };
  const chain = (table: string, cols: string) => {
    const b: Record<string, unknown> = {
      eq: () => b, is: () => b, in: () => b, gt: () => b, lt: () => b, not: () => b,
      order: () => b,
      limit: async () => answer(table, cols),
      then: (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) =>
        Promise.resolve(answer(table, cols)).then(res, rej),
    };
    return b;
  };
  const db = {
    from: (table: string) => ({ select: (cols: string) => chain(table, cols) }),
    rpc: async () => ({ data: [], error: null }),
  };
  return { db: db as unknown as SupabaseClient, selects };
}

describe("the To do reads name tasks.call_id directly, with no pre-0064 fallback", () => {
  it("listAccountWork: a missing call_id column throws, and is not retried without it (mutation: restore the 42703 retry → resolves, FAILS)", async () => {
    const { db, selects } = fakeDb();
    await expect(listAccountWork(db, "a1")).rejects.toThrow("call_id");
    expect(selects).toEqual(["id, contact_id, title, due_at, created_at, consent_event_id, call_id"]);
  });

  it("listContactTasks: same, one select and the error surfaces (mutation: restore the 42703 retry → resolves, FAILS)", async () => {
    const { db, selects } = fakeDb();
    await expect(listContactTasks(db, "a1", "c1")).rejects.toThrow("call_id");
    expect(selects).toEqual(["id, title, due_at, completed_at, created_at, consent_event_id, call_id"]);
  });
});
