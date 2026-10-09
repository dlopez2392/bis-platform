import { describe, it, expect, vi, afterEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { listAccountWork } from "../work-queue";
import { listContactTasks } from "../activities";
import { ensureCallbackTask } from "../voice";

/**
 * 0064 reaches production by hand, and the To do reads that name
 * `tasks.call_id` back four pages (the account dashboard, the To do page, the
 * agency work page, the contact page). Until 0064 is applied there, a select
 * naming the column answers PostgREST/Postgres 42703 — measured on a local
 * PostgREST 14.14 over a pre-0064 replica:
 *   {"code":"42703","message":"column tasks.call_id does not exist"}
 * — so both reads retry WITHOUT the column, and a To do simply shows no
 * author mark. Any OTHER error still throws. TEMPORARY, like emit's PGRST202
 * fallback for 0053 (#150, removed in #152 once applied): remove this file's
 * subject once 0064 is on production.
 *
 * No real database: a fake `tasks` table that refuses any select naming
 * call_id with the measured error, and answers otherwise.
 */
type TaskRow = { id: string; contact_id: string | null; title: string; due_at: string | null;
  created_at: string; consent_event_id: string | null; completed_at: string | null };

const ROW: TaskRow = {
  id: "t1", contact_id: "c1", title: "Order shingles", due_at: null,
  created_at: "2026-10-09T17:00:00Z", consent_event_id: null, completed_at: null,
};
const MISSING = { code: "42703", details: null, hint: null, message: "column tasks.call_id does not exist" };

function fakeDb(opts: { error?: { code: string; message: string }; firstError?: { code: string; message: string } } = {}) {
  const selects: string[] = [];
  const answer = (table: string, cols: string) => {
    if (table !== "tasks") return { data: [], error: null };
    selects.push(cols);
    if (opts.error) return { data: null, error: opts.error };
    if (cols.includes("call_id")) return { data: null, error: opts.firstError ?? MISSING };
    return { data: [ROW], error: null };
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
    from: (table: string) => ({
      select: (cols: string) => chain(table, cols),
    }),
    rpc: async () => ({ data: [], error: null }),
  };
  return { db: db as unknown as SupabaseClient, selects };
}

afterEach(() => { vi.restoreAllMocks(); });

describe("before 0064 reaches a database, the To do reads still answer (TEMPORARY)", () => {
  it("listAccountWork: a 42703 on tasks.call_id retries without it, and the task comes back with no call (mutation: drop the retry → openTasks throws, FAILS)", async () => {
    const { db, selects } = fakeDb();
    const rows = await listAccountWork(db, "a1");
    const task = rows.find((r) => r.id === "task:t1");
    expect(task).toMatchObject({ title: "Order shingles" });
    expect(task?.callId ?? null).toBeNull();
    expect(selects.filter((s) => s.startsWith("id, contact_id, title"))).toEqual([
      "id, contact_id, title, due_at, created_at, consent_event_id, call_id",
      "id, contact_id, title, due_at, created_at, consent_event_id",
    ]);
  });

  it("listContactTasks: same retry (mutation: drop the retry → throws, FAILS)", async () => {
    const { db, selects } = fakeDb();
    const tasks = await listContactTasks(db, "a1", "c1");
    expect(tasks.map((t) => t.title)).toEqual(["Order shingles"]);
    expect(selects).toEqual([
      "id, title, due_at, completed_at, created_at, consent_event_id, call_id",
      "id, title, due_at, completed_at, created_at, consent_event_id",
    ]);
  });

  it("any OTHER error still throws, and is not retried (mutation: retry on every error → FAILS)", async () => {
    const other = { code: "42501", message: "permission denied for table tasks" };
    const a = fakeDb({ error: other });
    await expect(listAccountWork(a.db, "a1")).rejects.toThrow("permission denied");
    const b = fakeDb({ error: other });
    await expect(listContactTasks(b.db, "a1", "c1")).rejects.toThrow("permission denied");
    expect(b.selects).toHaveLength(1);
  });

  it("a 42703 about ANOTHER column is not this fallback's to swallow (mutation: match the code alone → FAILS)", async () => {
    // Only the FIRST select fails, so a fallback that swallowed this error
    // would retry into a success and resolve: the rejection is the proof.
    const { db } = fakeDb({ firstError: { code: "42703", message: "column tasks.consent_event_id does not exist" } });
    await expect(listContactTasks(db, "a1", "c1")).rejects.toThrow("consent_event_id");
  });
});

describe("ensureCallbackTask: the To do is written even if its event is not (M8)", () => {
  it("an emit failure after the insert logs as an EMIT failure and still returns the To do (mutation: let the emit throw → rejects, FAILS)", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const db = {
      from: (table: string) => ({
        insert: () => ({ select: () => ({ single: async () => ({ data: { id: "task1" }, error: null }) }) }),
        ...(table === "events" ? { insert: async () => ({ error: { message: "events insert refused" } }) } : {}),
      }),
    } as unknown as SupabaseClient;
    await expect(ensureCallbackTask(db, "a1",
      { callId: "call1", contactId: null, title: "Call back at 9565061545: Roof leak", dueAt: "2027-06-01T17:02:00.000Z" },
      "voice", "ai")).resolves.toEqual({ id: "task1", created: true });
    expect(err.mock.calls.some((c) => /task\.created emit failed/.test(String(c[0])) && String(c[0]).includes("task1"))).toBe(true);
  });
});
