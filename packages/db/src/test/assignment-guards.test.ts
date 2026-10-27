import { describe, it, expect } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  assignContacts, undoAssignContacts, setTaskAssignee, reassignReleased, releaseTasksOffCustomers, ASSIGN_IN_BATCH_SIZE,
} from "../assignment";

/**
 * Final review m10, M7 and m4, on a RECORDING fake client (no database: these
 * pin the shape of each request, which is what the three findings are about,
 * and run anywhere). Every `from(table)` chain is recorded step by step;
 * `answer` decides what an awaited chain resolves to. `rpc` answers nothing
 * (emit on a non-user client inserts into events, which records like any
 * other chain).
 */
type Step = [string, unknown[]];
type Call = { table: string; steps: Step[] };
function recordingDb(answer: (call: Call) => unknown = () => null) {
  const calls: Call[] = [];
  const db = {
    from(table: string) {
      const call: Call = { table, steps: [] };
      calls.push(call);
      const chain: unknown = new Proxy({}, {
        get(_t, k) {
          if (k === "then") {
            return (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) =>
              Promise.resolve({ data: answer(call), error: null }).then(res, rej);
          }
          return (...args: unknown[]) => { call.steps.push([String(k), args]); return chain; };
        },
      });
      return chain;
    },
    rpc: async () => ({ data: null, error: null }),
  };
  return { db: db as unknown as SupabaseClient, calls };
}
const has = (c: Call, method: string) => c.steps.some(([k]) => k === method);
const arg = (c: Call, method: string, column: string) => c.steps.find(([k, a]) => k === method && a[0] === column)?.[1][1];
const updates = (calls: Call[], table: string) => calls.filter((c) => c.table === table && has(c, "update"));
const reads = (calls: Call[], table: string) => calls.filter((c) => c.table === table && has(c, "select") && !has(c, "update"));
const inList = (c: Call, column: string) => (arg(c, "in", column) as string[] | undefined) ?? [];

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const A = uuid(900_001); const B = uuid(900_002); const C = uuid(900_003);

describe("undoAssignContacts puts a customer back only while the call's target still holds it, AT the write (final review m10)", () => {
  it("the contacts update filters on assigned_to = target, so a pick made between the read and the write is not overwritten (mutation: drop the guard -> FAILS)", async () => {
    const { db, calls } = recordingDb((c) => {
      if (c.table === "contacts" && !has(c, "update")) return [{ id: "c1", assigned_to: B }];
      if (c.table === "memberships") return { id: "m" };
      return [];
    });
    await undoAssignContacts(db, "acct", [{ contactId: "c1", assignee: A, target: B, movedTaskIds: [] }], "actor");
    const [u] = updates(calls, "contacts");
    expect(u).toBeDefined();
    expect(arg(u!, "eq", "assigned_to")).toBe(B);
  });
  it("a call that left the customer Unassigned is guarded with IS NULL, not = null (mutation: .eq(assigned_to, null) -> FAILS)", async () => {
    const { db, calls } = recordingDb((c) => {
      if (c.table === "contacts" && !has(c, "update")) return [{ id: "c1", assigned_to: null }];
      if (c.table === "memberships") return { id: "m" };
      return [];
    });
    await undoAssignContacts(db, "acct", [{ contactId: "c1", assignee: A, target: null, movedTaskIds: [] }], "actor");
    const [u] = updates(calls, "contacts");
    expect(arg(u!, "is", "assigned_to")).toBeNull();
    expect(u!.steps.some(([k, a]) => k === "eq" && a[0] === "assigned_to")).toBe(false);
  });
  it("entries that name different targets are written in separate statements, each guarded by its own target (mutation: group by previous assignee only -> FAILS)", async () => {
    const { db, calls } = recordingDb((c) => {
      if (c.table === "contacts" && !has(c, "update")) return [{ id: "c1", assigned_to: B }, { id: "c2", assigned_to: C }];
      if (c.table === "memberships") return { id: "m" };
      return [];
    });
    await undoAssignContacts(db, "acct", [
      { contactId: "c1", assignee: A, target: B, movedTaskIds: [] },
      { contactId: "c2", assignee: A, target: C, movedTaskIds: [] },
    ], "actor");
    const guarded = updates(calls, "contacts").map((u) => [arg(u, "eq", "assigned_to"), inList(u, "id")]);
    expect(guarded).toEqual(expect.arrayContaining([[B, ["c1"]], [C, ["c2"]]]));
    expect(guarded).toHaveLength(2);
  });
  it("the ledger records only the customers the guarded write put back (mutation: emit for every entry -> FAILS)", async () => {
    const { db, calls } = recordingDb((c) => {
      if (c.table === "contacts" && !has(c, "update")) return [{ id: "c1", assigned_to: B }, { id: "c2", assigned_to: B }];
      if (c.table === "contacts") return [{ id: "c1" }];   // c2 was picked between the read and the write
      if (c.table === "memberships") return { id: "m" };
      return [];
    });
    await undoAssignContacts(db, "acct", [
      { contactId: "c1", assignee: A, target: B, movedTaskIds: [] },
      { contactId: "c2", assignee: A, target: B, movedTaskIds: [] },
    ], "actor");
    const events = calls.filter((c) => c.table === "events").map((c) => (c.steps.find(([k]) => k === "insert")?.[1][0] as { payload: { contactId: string } }).payload.contactId);
    expect(events).toEqual(["c1"]);
  });
  // Final re-review: the Undo says how many customers it actually put back, so
  // the app can tell "undone" from "someone picked them all since".
  it("returns how many customers the guarded write put back: 1 of 2 when one was picked between the read and the write (mutation: count the entries -> FAILS)", async () => {
    const { db } = recordingDb((c) => {
      if (c.table === "contacts" && !has(c, "update")) return [{ id: "c1", assigned_to: B }, { id: "c2", assigned_to: B }];
      if (c.table === "contacts") return [{ id: "c1" }];
      if (c.table === "memberships") return { id: "m" };
      return [];
    });
    expect(await undoAssignContacts(db, "acct", [
      { contactId: "c1", assignee: A, target: B, movedTaskIds: [] },
      { contactId: "c2", assignee: A, target: B, movedTaskIds: [] },
    ], "actor")).toEqual({ restored: 1 });
  });
  it("returns 0 when every customer was handed on since, whether the read saw it or the write did (mutation: answer the entry count -> FAILS)", async () => {
    const pickedSince = recordingDb((c) => {
      if (c.table === "contacts" && !has(c, "update")) return [{ id: "c1", assigned_to: C }];
      return [];
    });
    expect(await undoAssignContacts(pickedSince.db, "acct", [{ contactId: "c1", assignee: A, target: B, movedTaskIds: [] }], "actor"))
      .toEqual({ restored: 0 });
    const lostAtWrite = recordingDb((c) => {
      if (c.table === "contacts" && !has(c, "update")) return [{ id: "c1", assigned_to: B }];
      if (c.table === "memberships") return { id: "m" };
      return [];
    });
    expect(await undoAssignContacts(lostAtWrite.db, "acct", [{ contactId: "c1", assignee: A, target: B, movedTaskIds: [] }], "actor"))
      .toEqual({ restored: 0 });
  });
});

describe(`no request names more than ${ASSIGN_IN_BATCH_SIZE} ids in one .in() (final review m4)`, () => {
  const ids = (n: number, from = 1) => Array.from({ length: n }, (_, i) => uuid(from + i));
  it("the batch is 200, the size contacts.ts's TAG_LOOKUP_BATCH_SIZE found safe for a request URL", () => {
    expect(ASSIGN_IN_BATCH_SIZE).toBe(200);
  });
  it("assignContacts with 201 customers reads and writes in batches of at most 200, covering every id once (mutation: one .in() for all -> FAILS)", async () => {
    const all = ids(201);
    const { db, calls } = recordingDb((c) => {
      if (c.table === "contacts" && !has(c, "update")) return inList(c, "id").map((id) => ({ id, assigned_to: null }));
      if (c.table === "memberships") return { id: "m" };
      return [];
    });
    const changed = await assignContacts(db, "acct", all, A, "actor");
    expect(changed).toHaveLength(201);
    for (const [label, group, column] of [
      ["read", reads(calls, "contacts"), "id"], ["contacts write", updates(calls, "contacts"), "id"], ["task move", updates(calls, "tasks"), "contact_id"],
    ] as const) {
      expect(group.length, label).toBe(2);
      for (const c of group) expect(inList(c, column).length, label).toBeLessThanOrEqual(ASSIGN_IN_BATCH_SIZE);
      expect(group.flatMap((c) => inList(c, column)).sort(), label).toEqual([...all].sort());
    }
  });
  it("200 customers is one batch: the boundary is inclusive (mutation: batch at 199 -> FAILS)", async () => {
    const { db, calls } = recordingDb((c) => {
      if (c.table === "contacts" && !has(c, "update")) return inList(c, "id").map((id) => ({ id, assigned_to: null }));
      if (c.table === "memberships") return { id: "m" };
      return [];
    });
    await assignContacts(db, "acct", ids(200), A, "actor");
    expect(reads(calls, "contacts")).toHaveLength(1);
    expect(updates(calls, "contacts")).toHaveLength(1);
  });
  it("undoAssignContacts with 201 entries and one entry carrying 201 moved tasks batches the read, the move-back and the write (mutation: one .in() for all -> FAILS)", async () => {
    const all = ids(201);
    const tasks = ids(201, 10_000);
    const { db, calls } = recordingDb((c) => {
      if (c.table === "contacts" && !has(c, "update")) return inList(c, "id").map((id) => ({ id, assigned_to: B }));
      if (c.table === "memberships") return { id: "m" };
      return [];
    });
    await undoAssignContacts(db, "acct",
      all.map((contactId, i) => ({ contactId, assignee: A, target: B, movedTaskIds: i === 0 ? tasks : [] })), "actor");
    for (const [label, group, column] of [
      ["read", reads(calls, "contacts"), "id"], ["contacts write", updates(calls, "contacts"), "id"], ["task move-back", updates(calls, "tasks"), "id"],
    ] as const) {
      expect(group.length, label).toBe(2);
      for (const c of group) expect(inList(c, column).length, label).toBeLessThanOrEqual(ASSIGN_IN_BATCH_SIZE);
    }
    expect(updates(calls, "tasks").flatMap((c) => inList(c, "id")).sort()).toEqual([...tasks].sort());
  });
  it("reassignReleased batches a departed person's customers and tasks too (mutation: one .in() for all -> FAILS)", async () => {
    const { db, calls } = recordingDb();
    await reassignReleased(db, "acct", A, { contacts: ids(401), tasks: ids(201, 10_000) });
    expect(updates(calls, "contacts").map((c) => inList(c, "id").length)).toEqual([200, 200, 1]);
    expect(updates(calls, "tasks").map((c) => inList(c, "id").length)).toEqual([200, 1]);
  });
});

/**
 * F-085 follow-up, Task A: the role change's give-back (actions.ts's
 * giveBackTechnicianTasks) reuses this same function for its task ids, so
 * its safety against a forged or stale id rests entirely on these two
 * guards. Pinned here on the fake client (fast, no database) because
 * assignment.test.ts:307 already pins the still-Unassigned guard against a
 * real database — this closes the account-scope half, which had no pin at
 * all until now.
 */
describe("reassignReleased never writes outside the account it is given, contacts or tasks (mutation: drop .eq('account_id', accountId) -> FAILS)", () => {
  it("every write is scoped by account_id, so an id from another account could never match", async () => {
    const { db, calls } = recordingDb();
    await reassignReleased(db, "acct", A, { contacts: [uuid(1)], tasks: [uuid(2)] });
    for (const c of [...updates(calls, "contacts"), ...updates(calls, "tasks")]) {
      expect(arg(c, "eq", "account_id")).toBe("acct");
    }
  });
});

describe("reassignReleased only ever writes a row still Unassigned (mutation: drop .is('assigned_to', null) -> FAILS)", () => {
  it("every write guards on IS NULL assigned_to, contacts and tasks alike", async () => {
    const { db, calls } = recordingDb();
    await reassignReleased(db, "acct", A, { contacts: [uuid(1)], tasks: [uuid(2)] });
    for (const c of [...updates(calls, "contacts"), ...updates(calls, "tasks")]) {
      expect(arg(c, "is", "assigned_to")).toBeNull();
    }
  });
});

describe("setTaskAssignee's optional expected holder, which the task Undo passes (final review M7)", () => {
  const task = (assigned_to: string | null) => recordingDb((c) => {
    if (c.table === "tasks" && !has(c, "update")) return { assigned_to };
    if (c.table === "tasks") return [{ id: "t1" }];
    if (c.table === "memberships") return { id: "m" };
    return null;
  });
  it("a task picked by someone else since is left alone: 'changed', and nothing is written (mutation: ignore expected -> FAILS)", async () => {
    const { db, calls } = task(C);
    expect(await setTaskAssignee(db, "acct", "t1", A, "actor", { expected: B })).toBe("changed");
    expect(updates(calls, "tasks")).toHaveLength(0);
  });
  it("still with the expected holder: written, guarded at the write by that holder (mutation: drop the write guard -> FAILS)", async () => {
    const { db, calls } = task(B);
    expect(await setTaskAssignee(db, "acct", "t1", A, "actor", { expected: B })).toEqual({ previous: B });
    expect(arg(updates(calls, "tasks")[0]!, "eq", "assigned_to")).toBe(B);
  });
  it("an expected Unassigned is guarded with IS NULL", async () => {
    const { db, calls } = task(null);
    expect(await setTaskAssignee(db, "acct", "t1", A, "actor", { expected: null })).toEqual({ previous: null });
    expect(arg(updates(calls, "tasks")[0]!, "is", "assigned_to")).toBeNull();
  });
  it("a pick that lands between the read and the guarded write matches no row: 'changed', and no event is written (mutation: treat zero rows as written -> FAILS)", async () => {
    const { db, calls } = recordingDb((c) => {
      if (c.table === "tasks" && !has(c, "update")) return { assigned_to: B };
      if (c.table === "tasks") return [];
      if (c.table === "memberships") return { id: "m" };
      return null;
    });
    expect(await setTaskAssignee(db, "acct", "t1", A, "actor", { expected: B })).toBe("changed");
    expect(calls.some((c) => c.table === "events")).toBe(false);
  });
  it("without expected, a pick writes whoever holds the task now (the save itself is unguarded)", async () => {
    const { db, calls } = task(C);
    expect(await setTaskAssignee(db, "acct", "t1", A, "actor")).toEqual({ previous: C });
    expect(updates(calls, "tasks")[0]!.steps.some(([k, a]) => (k === "eq" || k === "is") && a[0] === "assigned_to")).toBe(false);
  });
});

describe("releaseTasksOffCustomers: a person made a Technician lets go of open tasks on customers that are not theirs (final review, A4 for a demotion)", () => {
  const T1 = uuid(1), T2 = uuid(2), T3 = uuid(3), K1 = uuid(11), K2 = uuid(12), K3 = uuid(13);
  const answering = (tasks: { id: string; contact_id: string }[], contacts: { id: string; assigned_to: string | null }[]) =>
    recordingDb((c) => {
      if (c.table === "tasks" && !has(c, "update")) return tasks;
      if (c.table === "contacts") return contacts.filter((k) => inList(c, "id").includes(k.id));
      if (c.table === "tasks") return inList(c, "id").map((id) => ({ id }));
      return null;
    });
  it("releases exactly the open tasks whose customer is someone else's or nobody's, guarded by holder and still open (mutations: release every open task, or drop the holder guard -> FAILS)", async () => {
    const { db, calls } = answering(
      [{ id: T1, contact_id: K1 }, { id: T2, contact_id: K2 }, { id: T3, contact_id: K3 }],
      [{ id: K1, assigned_to: A }, { id: K2, assigned_to: B }, { id: K3, assigned_to: null }]);
    expect((await releaseTasksOffCustomers(db, "acct", A)).sort()).toEqual([T2, T3].sort());
    const [u] = updates(calls, "tasks");
    expect(inList(u!, "id").sort()).toEqual([T2, T3].sort());
    expect(u!.steps.find(([k]) => k === "update")?.[1][0]).toEqual({ assigned_to: null });
    expect(arg(u!, "eq", "assigned_to")).toBe(A);
    expect(arg(u!, "is", "completed_at")).toBeNull();
    expect(arg(u!, "eq", "account_id")).toBe("acct");
  });
  it("reads only this person's OPEN tasks that HAVE a customer: a task with no customer stays theirs, since they still see it (mutation: drop the contact_id filter -> FAILS)", async () => {
    const { db, calls } = answering([], []);
    await releaseTasksOffCustomers(db, "acct", A);
    const [r] = reads(calls, "tasks");
    expect(arg(r!, "eq", "assigned_to")).toBe(A);
    expect(arg(r!, "is", "completed_at")).toBeNull();
    expect(r!.steps.some(([k, a]) => k === "not" && a[0] === "contact_id" && a[1] === "is" && a[2] === null)).toBe(true);
  });
  it("every task on their own customers: nothing is written (mutation: write an empty .in() -> FAILS)", async () => {
    const { db, calls } = answering([{ id: T1, contact_id: K1 }], [{ id: K1, assigned_to: A }]);
    expect(await releaseTasksOffCustomers(db, "acct", A)).toEqual([]);
    expect(updates(calls, "tasks")).toHaveLength(0);
  });
  it("201 tasks are read back and released in batches of at most 200 (m4)", async () => {
    const tasks = Array.from({ length: 201 }, (_, i) => ({ id: uuid(20_000 + i), contact_id: uuid(30_000 + i) }));
    const { db, calls } = answering(tasks, []);
    expect(await releaseTasksOffCustomers(db, "acct", A)).toHaveLength(201);
    for (const c of [...reads(calls, "contacts"), ...updates(calls, "tasks")]) {
      expect(inList(c, "id").length).toBeLessThanOrEqual(ASSIGN_IN_BATCH_SIZE);
    }
    expect(updates(calls, "tasks")).toHaveLength(2);
  });
});
