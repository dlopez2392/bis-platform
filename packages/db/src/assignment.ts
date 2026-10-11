import type { SupabaseClient } from "@supabase/supabase-js";
import { emit } from "./events";

/**
 * Mine, Unassigned and the Technician (spec §8). Who a customer or a task
 * belongs to. Reads and writes run on whichever client the caller passes:
 * the request client for a person's own action (RLS + 0068 bound it), the
 * service client only for release and its undo (service_role-only RPC).
 *
 * Must NOT import `./team`: team.ts imports `releaseMemberAssignments` from
 * here, and a cycle would be a load-order hazard. The membership check below
 * therefore queries `memberships` itself.
 */
export type AssigneeFilter = { who: "mine"; userId: string } | { who: "unassigned" };
export type ReleasedAssignments = { contacts: string[]; tasks: string[] };
export type PreviousAssignee = { contactId: string; assignee: string | null };

/** The caller's own users.id. Null for a person with no users row (the agency, A5). */
export async function readPersonId(db: SupabaseClient, clerkUserId: string): Promise<string | null> {
  const { data, error } = await db.from("users").select("id").eq("clerk_user_id", clerkUserId).maybeSingle();
  if (error) throw new Error(`readPersonId failed: ${error.message}`);
  return (data?.id as string | undefined) ?? null;
}

/** A new task's default assignee: the customer's, else its author (plan deviation 3). */
export async function taskAssigneeFor(
  db: SupabaseClient, accountId: string, contactId: string | null, authorUserId: string | null,
): Promise<string | null> {
  if (contactId) {
    const { data, error } = await db.from("contacts").select("assigned_to").eq("account_id", accountId).eq("id", contactId).maybeSingle();
    if (error) throw new Error(`taskAssigneeFor failed: ${error.message}`);
    const owner = (data?.assigned_to as string | null | undefined) ?? null;
    if (owner) return owner;
  }
  return authorUserId;
}

/** A5: only a member of THIS company can hold a customer or a task. */
async function assertMember(db: SupabaseClient, accountId: string, userId: string): Promise<void> {
  const { data, error } = await db.from("memberships").select("id")
    .eq("scope", "account").eq("account_id", accountId).eq("user_id", userId).maybeSingle();
  if (error) throw new Error(`assignment: membership check failed: ${error.message}`);
  if (!data) throw new Error("assignment: the assignee is not a member of this account");
}

/**
 * Sets each contact's assignee and moves that contact's OPEN tasks that were
 * the previous assignee's along with it (A4). Returns what each contact had,
 * which is exactly what an Undo passes back (one call per previous assignee).
 */
export async function assignContacts(
  db: SupabaseClient, accountId: string, contactIds: readonly string[], assignee: string | null, actorId: string,
): Promise<PreviousAssignee[]> {
  if (contactIds.length === 0) return [];
  if (assignee !== null) await assertMember(db, accountId, assignee);
  const { data, error } = await db.from("contacts").select("id, assigned_to").eq("account_id", accountId).in("id", [...contactIds]);
  if (error) throw new Error(`assignContacts read failed: ${error.message}`);
  const previous = ((data ?? []) as { id: string; assigned_to: string | null }[])
    .map((r) => ({ contactId: r.id, assignee: r.assigned_to }));
  const changing = previous.filter((p) => p.assignee !== assignee);
  if (changing.length === 0) return previous;
  const { error: upErr } = await db.from("contacts")
    .update({ assigned_to: assignee, updated_at: new Date().toISOString() })
    .eq("account_id", accountId).in("id", changing.map((p) => p.contactId));
  if (upErr) throw new Error(`assignContacts failed: ${upErr.message}`);
  for (const p of changing) {
    let q = db.from("tasks").update({ assigned_to: assignee })
      .eq("account_id", accountId).eq("contact_id", p.contactId).is("completed_at", null);
    q = p.assignee === null ? q.is("assigned_to", null) : q.eq("assigned_to", p.assignee);
    const { error: tErr } = await q;
    if (tErr) throw new Error(`assignContacts task move failed: ${tErr.message}`);
    await emit(db, accountId, "contact.assigned", actorId, { contactId: p.contactId, from: p.assignee, to: assignee });
  }
  return previous;
}

export async function setTaskAssignee(
  db: SupabaseClient, accountId: string, taskId: string, assignee: string | null, actorId: string,
): Promise<{ previous: string | null } | "not_found"> {
  const { data, error } = await db.from("tasks").select("assigned_to").eq("account_id", accountId).eq("id", taskId).maybeSingle();
  if (error) throw new Error(`setTaskAssignee read failed: ${error.message}`);
  if (!data) return "not_found";
  if (assignee !== null) await assertMember(db, accountId, assignee);
  const { error: upErr } = await db.from("tasks").update({ assigned_to: assignee }).eq("account_id", accountId).eq("id", taskId);
  if (upErr) throw new Error(`setTaskAssignee failed: ${upErr.message}`);
  const previous = (data.assigned_to as string | null) ?? null;
  await emit(db, accountId, "task.assigned", actorId, { taskId, from: previous, to: assignee });
  return { previous };
}

/** 0068's service_role-only release. Pass serviceDb(). */
export async function releaseMemberAssignments(db: SupabaseClient, accountId: string, userId: string): Promise<ReleasedAssignments> {
  const { data, error } = await db.rpc("release_member_assignments", { p_account_id: accountId, p_user_id: userId });
  if (error) throw new Error(`releaseMemberAssignments failed: ${error.message}`);
  const j = (data ?? {}) as { contacts?: unknown; tasks?: unknown };
  const ids = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
  return { contacts: ids(j.contacts), tasks: ids(j.tasks) };
}

/** The removal's Undo: gives back only what nobody has picked up since. Pass serviceDb(). */
export async function reassignReleased(db: SupabaseClient, accountId: string, userId: string, released: ReleasedAssignments): Promise<void> {
  if (released.contacts.length > 0) {
    const { error } = await db.from("contacts").update({ assigned_to: userId })
      .eq("account_id", accountId).in("id", released.contacts).is("assigned_to", null);
    if (error) throw new Error(`reassignReleased contacts failed: ${error.message}`);
  }
  if (released.tasks.length > 0) {
    const { error } = await db.from("tasks").update({ assigned_to: userId })
      .eq("account_id", accountId).in("id", released.tasks).is("assigned_to", null).is("completed_at", null);
    if (error) throw new Error(`reassignReleased tasks failed: ${error.message}`);
  }
}
