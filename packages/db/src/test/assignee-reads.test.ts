import { describe, it, expect } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { listAccountWork } from "../work-queue";
import { listContactTasks } from "../activities";
import { getContact, listContacts } from "../contacts";

/**
 * F-085 part 1 (spec §9): the "Assigned to" field on the drawer, the record
 * page and the task rows shows who holds the customer or the task NOW, so
 * the reads behind those screens carry `assigned_to`. No real database: a
 * fake client that records each select and answers one row, so a read that
 * stopped selecting the column, or stopped carrying it through, fails here
 * by name.
 */
const HOLDER = "11111111-1111-4111-8111-111111111111";

function fakeDb(rows: Record<string, Record<string, unknown>[]>) {
  const selects: { table: string; cols: string }[] = [];
  const chain = (table: string, cols: string) => {
    const answer = () => ({ data: rows[table] ?? [], error: null });
    const b: Record<string, unknown> = {
      eq: () => b, is: () => b, in: () => b, gt: () => b, lt: () => b, not: () => b, or: () => b,
      order: () => b,
      limit: () => b,
      maybeSingle: async () => ({ data: (rows[table] ?? [])[0] ?? null, error: null }),
      then: (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => Promise.resolve(answer()).then(res, rej),
    };
    return b;
  };
  const db = {
    from: (table: string) => ({ select: (cols: string) => { selects.push({ table, cols }); return chain(table, cols); } }),
    rpc: async () => ({ data: [], error: null }),
  };
  return { db: db as unknown as SupabaseClient, selects };
}

const cols = (s: string) => s.split(",").map((c) => c.trim());

describe("the assignee travels with the rows the screens show (F-085 part 1)", () => {
  it("listAccountWork: a task row carries its own holder as assigneeId (mutation: drop assigned_to from openTasks' select or its mapping -> FAILS)", async () => {
    const { db, selects } = fakeDb({
      tasks: [{ id: "t1", contact_id: null, title: "Order shingles", due_at: null, created_at: "2026-10-09T17:00:00Z", consent_event_id: null, call_id: null, assigned_to: HOLDER }],
    });
    const rows = await listAccountWork(db, "a1");
    expect(cols(selects.find((s) => s.table === "tasks")!.cols)).toContain("assigned_to");
    expect(rows.find((r) => r.id === "task:t1")!.assigneeId).toBe(HOLDER);
  });

  it("listAccountWork: an unassigned task carries null, never undefined", async () => {
    const { db } = fakeDb({
      tasks: [{ id: "t2", contact_id: null, title: "x", due_at: null, created_at: "2026-10-09T17:00:00Z", consent_event_id: null, call_id: null, assigned_to: null }],
    });
    expect((await listAccountWork(db, "a1")).find((r) => r.id === "task:t2")!.assigneeId).toBeNull();
  });

  it("listContactTasks selects assigned_to (mutation: drop it -> FAILS)", async () => {
    const { db, selects } = fakeDb({ tasks: [{ id: "t1", assigned_to: HOLDER }] });
    const tasks = await listContactTasks(db, "a1", "c1");
    expect(cols(selects[0]!.cols)).toContain("assigned_to");
    expect(tasks[0]!.assigned_to).toBe(HOLDER);
  });

  it("getContact and listContacts select assigned_to (mutation: drop it from COLS -> FAILS)", async () => {
    const { db, selects } = fakeDb({ contacts: [{ id: "c1", assigned_to: HOLDER }] });
    await getContact(db, "a1", "c1");
    await listContacts(db, "a1");
    expect(selects.filter((s) => s.table === "contacts")).toHaveLength(2);
    for (const s of selects) expect(cols(s.cols)).toContain("assigned_to");
  });
});
