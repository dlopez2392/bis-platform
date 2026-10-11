import { describe, it, expect } from "vitest";
import { withTestAccount } from "./fixtures";
import { serviceDb } from "../service";
import {
  readPersonId, taskAssigneeFor, assignContacts, undoAssignContacts, setTaskAssignee, releaseMemberAssignments, reassignReleased,
  releaseTasksOffCustomers,
} from "../assignment";
import type { SupabaseClient } from "@supabase/supabase-js";

const RUN = Math.random().toString(36).slice(2, 10);
async function person(db: SupabaseClient, accountId: string, tag: string, role: "owner" | "staff" | "technician") {
  const clerk = `user_assign_${tag}_${RUN}`;
  const { data: u, error } = await db.from("users").insert({ clerk_user_id: clerk, email: `${clerk}@example.com` }).select("id").single();
  if (error) throw error;
  const { error: mErr } = await db.from("memberships").insert({ scope: "account", account_id: accountId, user_id: u!.id, role });
  if (mErr) throw mErr;
  return { id: u!.id as string, clerk };
}
async function contact(db: SupabaseClient, accountId: string, assignee: string | null): Promise<string> {
  const { data, error } = await db.from("contacts").insert({ account_id: accountId, first_name: "C", assigned_to: assignee }).select("id").single();
  if (error) throw error;
  return data.id as string;
}
async function task(db: SupabaseClient, accountId: string, contactId: string | null, assignee: string | null, title = "t"): Promise<string> {
  const { data, error } = await db.from("tasks").insert({ account_id: accountId, contact_id: contactId, title, assigned_to: assignee }).select("id").single();
  if (error) throw error;
  return data.id as string;
}
async function holder(db: SupabaseClient, table: "contacts" | "tasks", id: string): Promise<string | null> {
  const { data, error } = await db.from(table).select("assigned_to").eq("id", id).single();
  if (error) throw error;
  return (data.assigned_to as string | null) ?? null;
}

/**
 * withTestAccount, then this run's users rows. The users go LAST, after the
 * account's teardown has deleted its contacts and tasks: contacts.assigned_to
 * and tasks.assigned_to reference users with no delete action (0003), so a
 * users delete made inside the callback fails on the FK whenever a row still
 * names the person, and that person would be stranded in the project.
 * (memberships.user_id and memberships.account_id are `on delete cascade` since 0066.)
 */
async function withAssignAccount(fn: (db: SupabaseClient, accountId: string) => Promise<void>): Promise<void> {
  try {
    await withTestAccount(fn);
  } finally {
    const { error } = await serviceDb().from("users").delete().like("clerk_user_id", `user_assign_%_${RUN}`);
    if (error) throw new Error(`assignment.test cleanup failed on users: ${error.message}`);
  }
}

/**
 * The REAL service client against the real database, except that the first
 * `from(table).update(...)` resolves to an injected error, the way a dropped
 * connection mid-call would. Only that one call is faked; every read and every
 * other write reaches the database.
 */
function failFirstUpdate(db: SupabaseClient, table: string): SupabaseClient {
  let armed = true;
  const failing: unknown = new Proxy({}, {
    get(_t, k) {
      if (k === "then") {
        return (res: (v: unknown) => unknown) =>
          Promise.resolve({ data: null, error: { message: `injected ${table} update failure` } }).then(res);
      }
      return () => failing;
    },
  });
  const bound = (target: object, k: string | symbol) => {
    const v = Reflect.get(target, k, target) as unknown;
    return typeof v === "function" ? (v as (...a: unknown[]) => unknown).bind(target) : v;
  };
  return new Proxy(db, {
    get(target, k) {
      if (k !== "from") return bound(target, k);
      return (t: string) => {
        const b = target.from(t);
        if (t !== table || !armed) return b;
        return new Proxy(b, {
          get(bt, bk) {
            if (bk === "update") { armed = false; return () => failing; }
            return bound(bt, bk);
          },
        });
      };
    },
  });
}

describe("assignment core (spec §8)", () => {
  it("readPersonId: the users row of a MEMBER of this account, else null", () => withAssignAccount(async (db, accountId) => {
    const a = await person(db, accountId, "p", "staff");
    expect(await readPersonId(db, accountId, a.clerk)).toBe(a.id);
    expect(await readPersonId(db, accountId, `user_nobody_${RUN}`)).toBeNull();
  }));
  // Fix round 1 (C1): since 0067 the topbar theme toggle upserts a users row
  // for ANY signed-in person, the agency's staff included. A users row alone
  // is therefore not a person of this company: only a membership here is.
  it("readPersonId: a users row with no membership in this account (the agency since 0067) is null (mutation: read users by clerk id alone -> FAILS)", () =>
    withAssignAccount(async (db, accountId) => {
      const clerk = `user_assign_agency_${RUN}`;
      const { error } = await db.from("users").insert({ clerk_user_id: clerk, email: `${clerk}@example.com` });
      if (error) throw error;
      expect(await readPersonId(db, accountId, clerk)).toBeNull();
    }));
  it("readPersonId: a member of ANOTHER account is null here (mutation: drop .eq(account_id) -> FAILS)", () =>
    withAssignAccount(async (db, accountId) => {
      await withTestAccount(async (_db, otherAccountId) => {
        const stranger = await person(db, otherAccountId, "pother", "staff");
        expect(await readPersonId(db, otherAccountId, stranger.clerk)).toBe(stranger.id);
        expect(await readPersonId(db, accountId, stranger.clerk)).toBeNull();
      });
    }));
  it("taskAssigneeFor: the customer's assignee, else the author (mutation: always return the author -> FAILS)", () => withAssignAccount(async (db, accountId) => {
    const tech = await person(db, accountId, "t1", "technician");
    const owner = await person(db, accountId, "o1", "owner");
    const assigned = await contact(db, accountId, tech.id);
    const open = await contact(db, accountId, null);
    expect(await taskAssigneeFor(db, accountId, assigned, owner.id)).toBe(tech.id);
    expect(await taskAssigneeFor(db, accountId, open, owner.id)).toBe(owner.id);
    expect(await taskAssigneeFor(db, accountId, null, owner.id)).toBe(owner.id);
    expect(await taskAssigneeFor(db, accountId, null, null)).toBeNull();
  }));
  it("assignContacts moves the customer and the old assignee's open tasks with it, and returns the previous assignee and the moved task ids (A4; mutations: skip the task move / skip the contacts update -> FAILS)", () =>
    withAssignAccount(async (db, accountId) => {
      const a = await person(db, accountId, "a", "technician");
      const b = await person(db, accountId, "b", "technician");
      const owner = await person(db, accountId, "o2", "owner");
      const c1 = await contact(db, accountId, a.id);
      const t1 = await task(db, accountId, c1, a.id, "x");
      const tOwner = await task(db, accountId, c1, owner.id, "y");
      const previous = await assignContacts(db, accountId, [c1], b.id, owner.clerk);
      expect(previous).toEqual([{ contactId: c1, assignee: a.id, target: b.id, movedTaskIds: [t1] }]);
      expect(await holder(db, "contacts", c1)).toBe(b.id);
      expect(await holder(db, "tasks", t1)).toBe(b.id);
      expect(await holder(db, "tasks", tOwner)).toBe(owner.id);
    }));
  it("assignContacts from Unassigned takes the customer's unassigned open tasks along, and assigning to Unassigned (null) sends both back (m3; mutation: .eq(assigned_to, null) for an Unassigned holder -> FAILS)", () =>
    withAssignAccount(async (db, accountId) => {
      const b = await person(db, accountId, "u", "staff");
      const c = await contact(db, accountId, null);
      const tu = await task(db, accountId, c, null, "nobody's");
      expect(await assignContacts(db, accountId, [c], b.id, b.clerk)).toEqual([{ contactId: c, assignee: null, target: b.id, movedTaskIds: [tu] }]);
      expect(await holder(db, "contacts", c)).toBe(b.id);
      expect(await holder(db, "tasks", tu)).toBe(b.id);
      expect(await assignContacts(db, accountId, [c], null, b.clerk)).toEqual([{ contactId: c, assignee: b.id, target: null, movedTaskIds: [tu] }]);
      expect(await holder(db, "contacts", c)).toBeNull();
      expect(await holder(db, "tasks", tu)).toBeNull();
    }));
  it("assignContacts heals on retry after the task move fails: nothing has changed, and the retry finishes (review I-3; mutation: update contacts before moving tasks -> FAILS)", () =>
    withAssignAccount(async (db, accountId) => {
      const a = await person(db, accountId, "h1", "technician");
      const b = await person(db, accountId, "h2", "technician");
      const c1 = await contact(db, accountId, a.id);
      const t1 = await task(db, accountId, c1, a.id);
      await expect(assignContacts(failFirstUpdate(db, "tasks"), accountId, [c1], b.id, b.clerk)).rejects.toThrow(/injected tasks update failure/);
      expect(await holder(db, "contacts", c1)).toBe(a.id);
      expect(await holder(db, "tasks", t1)).toBe(a.id);
      await assignContacts(db, accountId, [c1], b.id, b.clerk);
      expect(await holder(db, "contacts", c1)).toBe(b.id);
      expect(await holder(db, "tasks", t1)).toBe(b.id);
    }));
  it("undoAssignContacts restores the customer and moves back only the tasks that moved: B's own earlier task stays with B (review m1; mutation: move back every open task B holds on the customer -> FAILS)", () =>
    withAssignAccount(async (db, accountId) => {
      const a = await person(db, accountId, "ua", "technician");
      const b = await person(db, accountId, "ub", "technician");
      const c1 = await contact(db, accountId, a.id);
      const tA = await task(db, accountId, c1, a.id, "A's");
      const tB = await task(db, accountId, c1, b.id, "B's own, from before");
      const previous = await assignContacts(db, accountId, [c1], b.id, b.clerk);
      expect(previous).toEqual([{ contactId: c1, assignee: a.id, target: b.id, movedTaskIds: [tA] }]);
      await undoAssignContacts(db, accountId, previous, b.clerk);
      expect(await holder(db, "contacts", c1)).toBe(a.id);
      expect(await holder(db, "tasks", tA)).toBe(a.id);
      expect(await holder(db, "tasks", tB)).toBe(b.id);
    }));
  it("undoAssignContacts refuses to give the customer back to a previous assignee who has left, and changes nothing (A5, review I-4; mutation: drop the Undo's membership check -> FAILS)", () =>
    withAssignAccount(async (db, accountId) => {
      const a = await person(db, accountId, "la", "technician");
      const b = await person(db, accountId, "lb", "technician");
      const c1 = await contact(db, accountId, a.id);
      const tA = await task(db, accountId, c1, a.id, "A's");
      const previous = await assignContacts(db, accountId, [c1], b.id, b.clerk);
      const { error } = await db.from("memberships").delete().eq("account_id", accountId).eq("user_id", a.id);
      if (error) throw error;
      await expect(undoAssignContacts(db, accountId, previous, b.clerk)).rejects.toThrow(/not a member/);
      expect(await holder(db, "contacts", c1)).toBe(b.id);
      expect(await holder(db, "tasks", tA)).toBe(b.id);
    }));
  it("undoAssignContacts leaves a moved task that was handed to someone else since (review m9; mutation: drop the current-holder guard on the task move-back -> FAILS)", () =>
    withAssignAccount(async (db, accountId) => {
      const a = await person(db, accountId, "ga", "technician");
      const b = await person(db, accountId, "gb", "technician");
      const c = await person(db, accountId, "gc", "staff");
      const c1 = await contact(db, accountId, a.id);
      const tA = await task(db, accountId, c1, a.id, "A's");
      const previous = await assignContacts(db, accountId, [c1], b.id, b.clerk);
      expect(await setTaskAssignee(db, accountId, tA, c.id, b.clerk)).toEqual({ previous: b.id });
      await undoAssignContacts(db, accountId, previous, b.clerk);
      expect(await holder(db, "contacts", c1)).toBe(a.id);
      expect(await holder(db, "tasks", tA)).toBe(c.id);
    }));
  it("assignContacts reports only the customers it changed: in a bulk assign, one already held by the target is not in the Undo, so moving it on and undoing leaves it moved (review residual 5; mutation: return every customer read -> FAILS)", () =>
    withAssignAccount(async (db, accountId) => {
      const a = await person(db, accountId, "ba", "technician");
      const b = await person(db, accountId, "bb", "technician");
      const c = await person(db, accountId, "bc", "staff");
      const x = await contact(db, accountId, a.id);
      const y = await contact(db, accountId, b.id);
      const previous = await assignContacts(db, accountId, [x, y], b.id, b.clerk);
      expect(previous).toEqual([{ contactId: x, assignee: a.id, target: b.id, movedTaskIds: [] }]);
      await assignContacts(db, accountId, [y], c.id, c.clerk);
      await undoAssignContacts(db, accountId, previous, b.clerk);
      expect(await holder(db, "contacts", x)).toBe(a.id);
      expect(await holder(db, "contacts", y)).toBe(c.id);
    }));
  // Fix round 1 (m2): `previous` reaches the server from the browser. An
  // entry's movedTaskIds may only move tasks of THAT entry's customer, so a
  // forged id naming another customer's task (held by the same target)
  // stays where it is.
  it("undoAssignContacts moves back only tasks of the entry's own customer: a forged task id of another customer stays put (mutation: drop .eq(contact_id) from the move-back -> FAILS)", () =>
    withAssignAccount(async (db, accountId) => {
      const a = await person(db, accountId, "fa", "technician");
      const b = await person(db, accountId, "fb", "technician");
      const x = await contact(db, accountId, a.id);
      const other = await contact(db, accountId, b.id);
      const tOther = await task(db, accountId, other, b.id, "B's, on another customer");
      const previous = await assignContacts(db, accountId, [x], b.id, b.clerk);
      const forged = previous.map((p) => ({ ...p, movedTaskIds: [...p.movedTaskIds, tOther] }));
      await undoAssignContacts(db, accountId, forged, b.clerk);
      expect(await holder(db, "contacts", x)).toBe(a.id);
      expect(await holder(db, "tasks", tOther)).toBe(b.id);
    }));
  it("undoAssignContacts acts only while the customer is still with the call's target: reassigned since, it stays where it went (review residual 5; mutation: drop the still-the-target check -> FAILS)", () =>
    withAssignAccount(async (db, accountId) => {
      const a = await person(db, accountId, "ta", "technician");
      const b = await person(db, accountId, "tb", "technician");
      const c = await person(db, accountId, "tc", "staff");
      const x = await contact(db, accountId, a.id);
      const tX = await task(db, accountId, x, a.id, "A's");
      const previous = await assignContacts(db, accountId, [x], b.id, b.clerk);
      await assignContacts(db, accountId, [x], c.id, c.clerk);
      await undoAssignContacts(db, accountId, previous, b.clerk);
      expect(await holder(db, "contacts", x)).toBe(c.id);
      expect(await holder(db, "tasks", tX)).toBe(c.id);
    }));
  it("assignContacts refuses a target who is a member of ANOTHER account, and changes nothing (A5, review m2; mutation: drop .eq(account_id) from the membership check -> FAILS)", () =>
    withAssignAccount(async (db, accountId) => {
      const c1 = await contact(db, accountId, null);
      await withTestAccount(async (_db, otherAccountId) => {
        const stranger = await person(db, otherAccountId, "x", "staff");
        await expect(assignContacts(db, accountId, [c1], stranger.id, "user_test")).rejects.toThrow(/not a member/);
      });
      expect(await holder(db, "contacts", c1)).toBeNull();
    }));
  it("setTaskAssignee writes the assignee and returns the previous one, or not_found (review I-2; mutation: skip the update -> FAILS)", () => withAssignAccount(async (db, accountId) => {
    const a = await person(db, accountId, "s", "staff");
    const t = await task(db, accountId, null, null, "z");
    expect(await setTaskAssignee(db, accountId, t, a.id, a.clerk)).toEqual({ previous: null });
    expect(await holder(db, "tasks", t)).toBe(a.id);
    expect(await setTaskAssignee(db, accountId, "00000000-0000-4000-8000-000000000000", a.id, a.clerk)).toBe("not_found");
  }));
  it("setTaskAssignee with an expected holder (the task Undo) leaves a task someone picked since with them: 'changed' (final review M7; mutation: ignore expected -> FAILS)", () =>
    withAssignAccount(async (db, accountId) => {
      const a = await person(db, accountId, "e1", "staff");
      const b = await person(db, accountId, "e2", "staff");
      const c = await person(db, accountId, "e3", "staff");
      const t = await task(db, accountId, null, a.id, "picked twice");
      expect(await setTaskAssignee(db, accountId, t, b.id, a.clerk)).toEqual({ previous: a.id });
      expect(await setTaskAssignee(db, accountId, t, c.id, a.clerk)).toEqual({ previous: b.id });   // the later pick
      expect(await setTaskAssignee(db, accountId, t, a.id, a.clerk, { expected: b.id })).toBe("changed");   // the first save's Undo
      expect(await holder(db, "tasks", t)).toBe(c.id);
      expect(await setTaskAssignee(db, accountId, t, b.id, a.clerk, { expected: c.id })).toEqual({ previous: c.id });
      expect(await holder(db, "tasks", t)).toBe(b.id);
    }));
  it("setTaskAssignee refuses a target who is a member of ANOTHER account, and the task keeps its assignee (A5, review I-2; mutation: drop the membership check -> FAILS)", () =>
    withAssignAccount(async (db, accountId) => {
      const a = await person(db, accountId, "s2", "staff");
      const t = await task(db, accountId, null, a.id, "kept");
      await withTestAccount(async (_db, otherAccountId) => {
        const stranger = await person(db, otherAccountId, "x2", "staff");
        await expect(setTaskAssignee(db, accountId, t, stranger.id, a.clerk)).rejects.toThrow(/not a member/);
      });
      expect(await holder(db, "tasks", t)).toBe(a.id);
    }));
  it("releaseTasksOffCustomers: someone made a Technician lets go of open tasks on customers not theirs, and keeps the rest (final review, A4 for a demotion; mutation: release every open task -> FAILS)", () =>
    withAssignAccount(async (db, accountId) => {
      const a = await person(db, accountId, "d1", "technician");
      const b = await person(db, accountId, "d2", "staff");
      const mine = await contact(db, accountId, a.id);
      const theirs = await contact(db, accountId, b.id);
      const nobodys = await contact(db, accountId, null);
      const tMine = await task(db, accountId, mine, a.id, "on my customer");
      const tTheirs = await task(db, accountId, theirs, a.id, "on B's customer");
      const tNobody = await task(db, accountId, nobodys, a.id, "on an unassigned customer");
      const tLoose = await task(db, accountId, null, a.id, "no customer");
      const tDone = await task(db, accountId, theirs, a.id, "done already");
      const { error } = await db.from("tasks").update({ completed_at: new Date().toISOString() }).eq("id", tDone);
      if (error) throw error;
      expect((await releaseTasksOffCustomers(db, accountId, a.id)).sort()).toEqual([tTheirs, tNobody].sort());
      expect(await holder(db, "tasks", tTheirs)).toBeNull();
      expect(await holder(db, "tasks", tNobody)).toBeNull();
      expect(await holder(db, "tasks", tMine)).toBe(a.id);
      expect(await holder(db, "tasks", tLoose)).toBe(a.id);
      expect(await holder(db, "tasks", tDone)).toBe(a.id);
    }));
  it("releaseMemberAssignments then reassignReleased restores only what is still Unassigned", () => withAssignAccount(async (db, accountId) => {
    const a = await person(db, accountId, "r", "technician");
    const other = await person(db, accountId, "r2", "staff");
    const c1 = await contact(db, accountId, a.id);
    const c2 = await contact(db, accountId, a.id);
    const t = await task(db, accountId, null, a.id, "open, no customer");
    const { error: dErr } = await db.from("memberships").delete().eq("user_id", a.id);
    if (dErr) throw dErr;
    const released = await releaseMemberAssignments(db, accountId, a.id);
    expect(released.contacts.sort()).toEqual([c1, c2].sort());
    expect(released.tasks).toEqual([t]);
    const { error: uErr } = await db.from("contacts").update({ assigned_to: other.id }).eq("id", c2);   // picked up meanwhile
    if (uErr) throw uErr;
    await reassignReleased(db, accountId, a.id, released);
    expect(await holder(db, "contacts", c1)).toBe(a.id);
    expect(await holder(db, "contacts", c2)).toBe(other.id);   // mutation: drop the .is("assigned_to", null) guard -> FAILS
    expect(await holder(db, "tasks", t)).toBe(a.id);           // mutation: drop reassignReleased's tasks branch -> FAILS
  }));
});

/** Only `.rpc()`, answering what the database never should: enough to pin the parse without a database. */
const rpcAnswering = (data: unknown) => ({ rpc: async () => ({ data, error: null }) }) as unknown as SupabaseClient;

describe("releaseMemberAssignments refuses a result it does not recognise (review m7, fake client)", () => {
  it.each([
    ["null", null],
    ["a bare array", []],
    ["contacts not an array", { contacts: "x", tasks: [] }],
    ["tasks missing", { contacts: [] }],
    ["a non-string id", { contacts: [1], tasks: [] }],
  ])("%s throws instead of reading as nothing released (mutation: fall back to [] -> FAILS)", async (_label, data) => {
    await expect(releaseMemberAssignments(rpcAnswering(data), "acct", "user")).rejects.toThrow(/unexpected result/);
  });
  it("the shape 0068 returns parses", async () => {
    expect(await releaseMemberAssignments(rpcAnswering({ contacts: ["c1"], tasks: [] }), "acct", "user"))
      .toEqual({ contacts: ["c1"], tasks: [] });
  });
});

/**
 * Fix round 1 (m1): a write the database refuses (RLS, or 0068's trigger,
 * both SQLSTATE 42501) must reach the caller with its code, so the app tells
 * a refusal from a failure by code, never by the wording of a message. A
 * fake client: reads answer `reads[table]`, every update answers `refusal`.
 */
function refusingWrites(reads: Record<string, unknown>, refusal: { code: string; message: string }): SupabaseClient {
  const chain = (table: string, writing: boolean): unknown => new Proxy({}, {
    get(_t, k) {
      if (k === "then") {
        const result = writing ? { data: null, error: refusal } : { data: reads[table] ?? null, error: null };
        return (res: (v: unknown) => unknown) => Promise.resolve(result).then(res);
      }
      if (k === "update") return () => chain(table, true);
      return () => chain(table, writing);
    },
  });
  return { from: (table: string) => chain(table, false) } as unknown as SupabaseClient;
}

describe("the assignment writers keep the database's error code (fix round 1, m1; fake client)", () => {
  const refusal = { code: "42501", message: "tasks: a technician cannot change a task's assignee" };
  it("setTaskAssignee: the trigger's 42501 is on the thrown error (mutation: throw a plain Error -> FAILS)", async () => {
    const db = refusingWrites({ tasks: { assigned_to: null } }, refusal);
    await expect(setTaskAssignee(db, "acct", "task", null, "user")).rejects.toMatchObject({ code: "42501" });
  });
  it("assignContacts: an RLS refusal on the task move keeps 42501", async () => {
    const db = refusingWrites({ contacts: [{ id: "c1", assigned_to: "u1" }] }, { code: "42501", message: "new row violates row-level security policy" });
    await expect(assignContacts(db, "acct", ["c1"], null, "user")).rejects.toMatchObject({ code: "42501" });
  });
  it("undoAssignContacts: a refusal on the move-back keeps 42501", async () => {
    // c1 is still with the call's target (Unassigned), and u-prev is a member
    // (the membership read answers a row), so the move-back write runs.
    const db = refusingWrites({ contacts: [{ id: "c1", assigned_to: null }], memberships: { id: "m1" } }, refusal);
    const work = [{ contactId: "c1", assignee: "u-prev", target: null, movedTaskIds: ["t1"] }];
    await expect(undoAssignContacts(db, "acct", work, "user")).rejects.toMatchObject({ code: "42501" });
  });
  it("an error with no code stays without one (not a refusal)", async () => {
    const db = refusingWrites({ tasks: { assigned_to: null } }, { code: "", message: "boom" } as never);
    const err = await setTaskAssignee(db, "acct", "task", null, "user").catch((e: unknown) => e);
    expect((err as { code?: unknown }).code === "42501").toBe(false);
  });
});
