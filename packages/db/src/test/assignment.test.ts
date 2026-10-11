import { describe, it, expect } from "vitest";
import { withTestAccount } from "./fixtures";
import { serviceDb } from "../service";
import {
  readPersonId, taskAssigneeFor, assignContacts, setTaskAssignee, releaseMemberAssignments, reassignReleased,
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

/**
 * withTestAccount, then this run's users rows. The users go LAST, after the
 * account's teardown has deleted its contacts and tasks: contacts.assigned_to
 * and tasks.assigned_to reference users with no delete action (0003), so a
 * users delete made inside the callback fails on the FK whenever a row still
 * names the person, and that person would be stranded in the project.
 * (memberships.user_id is `on delete cascade` since 0066.)
 */
async function withAssignAccount(fn: (db: SupabaseClient, accountId: string) => Promise<void>): Promise<void> {
  try {
    await withTestAccount(fn);
  } finally {
    const { error } = await serviceDb().from("users").delete().like("clerk_user_id", `user_assign_%_${RUN}`);
    if (error) throw new Error(`assignment.test cleanup failed on users: ${error.message}`);
  }
}

describe("assignment core (spec §8)", () => {
  it("readPersonId: the users row for a Clerk id, else null", () => withAssignAccount(async (db, accountId) => {
    const a = await person(db, accountId, "p", "staff");
    expect(await readPersonId(db, a.clerk)).toBe(a.id);
    expect(await readPersonId(db, `user_nobody_${RUN}`)).toBeNull();
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
  it("assignContacts moves the old assignee's open tasks with the customer and returns the previous assignees (A4; mutation: skip the task move -> FAILS)", () =>
    withAssignAccount(async (db, accountId) => {
      const a = await person(db, accountId, "a", "technician");
      const b = await person(db, accountId, "b", "technician");
      const owner = await person(db, accountId, "o2", "owner");
      const c1 = await contact(db, accountId, a.id);
      const { data: t1, error: e1 } = await db.from("tasks").insert({ account_id: accountId, contact_id: c1, title: "x", assigned_to: a.id }).select("id").single();
      if (e1) throw e1;
      const { data: tOwner, error: e2 } = await db.from("tasks").insert({ account_id: accountId, contact_id: c1, title: "y", assigned_to: owner.id }).select("id").single();
      if (e2) throw e2;
      const previous = await assignContacts(db, accountId, [c1], b.id, owner.clerk);
      expect(previous).toEqual([{ contactId: c1, assignee: a.id }]);
      const { data: rows } = await db.from("tasks").select("id, assigned_to").in("id", [t1.id, tOwner.id]);
      const by = Object.fromEntries((rows ?? []).map((r) => [r.id, r.assigned_to]));
      expect(by[t1.id]).toBe(b.id);
      expect(by[tOwner.id]).toBe(owner.id);
    }));
  it("assignContacts refuses a target who is not a member of this account", () => withAssignAccount(async (db, accountId) => {
    const c1 = await contact(db, accountId, null);
    const { data: stranger, error } = await db.from("users").insert({ clerk_user_id: `user_assign_x_${RUN}`, email: `x_${RUN}@example.com` }).select("id").single();
    if (error) throw error;
    await expect(assignContacts(db, accountId, [c1], stranger.id, "user_test")).rejects.toThrow(/not a member/);
  }));
  it("setTaskAssignee returns the previous assignee, or not_found", () => withAssignAccount(async (db, accountId) => {
    const a = await person(db, accountId, "s", "staff");
    const { data: t, error } = await db.from("tasks").insert({ account_id: accountId, title: "z" }).select("id").single();
    if (error) throw error;
    expect(await setTaskAssignee(db, accountId, t.id, a.id, a.clerk)).toEqual({ previous: null });
    expect(await setTaskAssignee(db, accountId, "00000000-0000-4000-8000-000000000000", a.id, a.clerk)).toBe("not_found");
  }));
  it("releaseMemberAssignments then reassignReleased restores only what is still Unassigned", () => withAssignAccount(async (db, accountId) => {
    const a = await person(db, accountId, "r", "technician");
    const other = await person(db, accountId, "r2", "staff");
    const c1 = await contact(db, accountId, a.id);
    const c2 = await contact(db, accountId, a.id);
    const { data: t, error: tErr } = await db.from("tasks").insert({ account_id: accountId, title: "open, no customer", assigned_to: a.id }).select("id").single();
    if (tErr) throw tErr;
    const { error: dErr } = await db.from("memberships").delete().eq("user_id", a.id);
    if (dErr) throw dErr;
    const released = await releaseMemberAssignments(db, accountId, a.id);
    expect(released.contacts.sort()).toEqual([c1, c2].sort());
    expect(released.tasks).toEqual([t.id]);
    const { error: uErr } = await db.from("contacts").update({ assigned_to: other.id }).eq("id", c2);   // picked up meanwhile
    if (uErr) throw uErr;
    await reassignReleased(db, accountId, a.id, released);
    const { data } = await db.from("contacts").select("id, assigned_to").in("id", [c1, c2]);
    const by = Object.fromEntries((data ?? []).map((r) => [r.id, r.assigned_to]));
    expect(by[c1]).toBe(a.id);
    expect(by[c2]).toBe(other.id);      // mutation: drop the .is("assigned_to", null) guard -> FAILS
    const { data: tAfter } = await db.from("tasks").select("assigned_to").eq("id", t.id).single();
    expect(tAfter?.assigned_to).toBe(a.id);   // mutation: drop reassignReleased's tasks branch -> FAILS
  }));
});
