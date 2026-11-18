import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { ensureCheckinTask, type JobCheckin } from "./job-checkins";

/**
 * ensureCheckinTask's event step, without a database (the live twin is test/job-checkins.test.ts). The To-do is the
 * record and its `created: true` is the ONE signal the owner's email waits for (F-072, owner decision 2026-11-17):
 * once the insert has succeeded, a failed `task.created` event is logged and the call still answers created, because
 * the 23505 branch never re-emits, so throwing would only make every retry say "already there" and lose the alert.
 */
const ACCT = "acct-1";
const checkin: JobCheckin = { id: "chk-1", accountId: ACCT, bookingId: "bk-1", contactId: "ct-1", answer: "not_great", answeredAt: "2027-06-15T12:00:00Z", reviewLinkOpenedAt: null };
const INPUT = { title: "Call Ana: they said the job was not great", dueAt: "2027-06-15T12:00:00.000Z" };

function fakeDb(o: { task?: { id: string } | { code: string }; eventError?: string }) {
  const ops: { table: string; op: string }[] = [];
  const from = (table: string) => {
    const q: Record<string, unknown> = {};
    q.insert = (row: unknown) => {
      ops.push({ table, op: "insert" });
      if (table === "events") return Promise.resolve({ error: o.eventError ? { message: o.eventError } : null, row });
      return q;
    };
    q.select = () => q;
    q.eq = () => q;
    q.single = async () => ("code" in (o.task ?? {})
      ? { data: null, error: { code: (o.task as { code: string }).code, message: "dup" } }
      : { data: o.task ?? { id: "t1" }, error: null });
    q.maybeSingle = async () => ({ data: { id: "t-existing" }, error: null });
    return q;
  };
  return { db: { from } as unknown as SupabaseClient, ops };
}

beforeEach(() => { vi.spyOn(console, "error").mockImplementation(() => {}).mockClear(); });

describe("ensureCheckinTask: the To-do's event", () => {
  it("the tasks insert succeeds and the event insert fails: still created: true, and logged once with the account and check-in ids (probe: rethrow the emit error -> FAILS)", async () => {
    const { db, ops } = fakeDb({ eventError: "events down" });
    await expect(ensureCheckinTask(db, ACCT, checkin, INPUT, "checkin-page", "system")).resolves.toEqual({ id: "t1", created: true });
    expect(ops).toEqual([{ table: "tasks", op: "insert" }, { table: "events", op: "insert" }]);
    expect(console.error).toHaveBeenCalledTimes(1);
    const line = vi.mocked(console.error).mock.calls[0]![0] as string;
    expect(line).toContain(ACCT);
    expect(line).toContain("chk-1");
    expect(line).toContain("events down");
    expect(line).not.toContain(INPUT.title);
  });

  it("both succeed: created: true and nothing logged", async () => {
    const { db } = fakeDb({});
    await expect(ensureCheckinTask(db, ACCT, checkin, INPUT, "checkin-page", "system")).resolves.toEqual({ id: "t1", created: true });
    expect(console.error).not.toHaveBeenCalled();
  });

  it("a failed tasks insert still throws (no To-do, nothing to say 'created' about), and 23505 is created: false with no event", async () => {
    const down = fakeDb({ task: { code: "XX000" } });
    await expect(ensureCheckinTask(down.db, ACCT, checkin, INPUT, "checkin")).rejects.toThrow(/ensureCheckinTask failed/);
    const dup = fakeDb({ task: { code: "23505" } });
    await expect(ensureCheckinTask(dup.db, ACCT, checkin, INPUT, "checkin")).resolves.toEqual({ id: "t-existing", created: false });
    expect(dup.ops.filter((o) => o.table === "events")).toEqual([]);
  });
});
