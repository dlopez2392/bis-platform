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
/**
 * One customer assignContacts CHANGED: who had it (`assignee`), who the call
 * gave it to (`target`), and the open task ids that moved with it. Exactly
 * what undoAssignContacts takes; it acts only while the customer is still
 * with `target` (review residual 5).
 */
export type PreviousAssignee = { contactId: string; assignee: string | null; target: string | null; movedTaskIds: string[] };

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

type ContactRow = { id: string; assigned_to: string | null };

/** Groups items by a nullable user id, Unassigned (null) being a group of its own. */
function groupBy<T>(items: readonly T[], key: (t: T) => string | null): Map<string | null, T[]> {
  const m = new Map<string | null, T[]>();
  for (const it of items) m.set(key(it), [...(m.get(key(it)) ?? []), it]);
  return m;
}

/**
 * Sets each contact's assignee and moves that contact's OPEN tasks that were
 * the previous assignee's along with it (A4). Returns one entry per customer
 * it actually CHANGED (one already held by the target is left out, so an Undo
 * can never touch it), which is exactly what undoAssignContacts takes.
 *
 * The order is load-bearing; it is what makes a retry heal (review I-3):
 *   1. the open tasks move (old holder -> target), one statement per old holder;
 *   2. the contacts change, in one statement;
 *   3. the events are written.
 * A failure in 1 leaves every contact still naming its old holder, so a retry
 * reads the same "previous" and finishes the move. Contacts first would
 * strand the tasks: the retry would read previous = target, find nothing to
 * change and return, leaving open tasks with someone who may no longer see
 * the customer. A failure in 3 leaves the assignment done and some events
 * unwritten, and a retry has nothing to change so writes none: a missing
 * ledger row is accepted, a stranded task is not. A retry also cannot report
 * the tasks an earlier, failed attempt already moved in its `movedTaskIds`.
 * This is not one transaction (no SQL function), so two concurrent reassigns
 * of one customer can still split its tasks from it (the review's logged race).
 */
export async function assignContacts(
  db: SupabaseClient, accountId: string, contactIds: readonly string[], assignee: string | null, actorId: string,
): Promise<PreviousAssignee[]> {
  if (contactIds.length === 0) return [];
  if (assignee !== null) await assertMember(db, accountId, assignee);
  const { data, error } = await db.from("contacts").select("id, assigned_to").eq("account_id", accountId).in("id", [...contactIds]);
  if (error) throw new Error(`assignContacts read failed: ${error.message}`);
  const changing: PreviousAssignee[] = ((data ?? []) as ContactRow[])
    .filter((r) => r.assigned_to !== assignee)
    .map((r) => ({ contactId: r.id, assignee: r.assigned_to, target: assignee, movedTaskIds: [] }));
  if (changing.length === 0) return [];

  // 1. Tasks first, one statement per holder they are leaving.
  for (const [from, group] of groupBy(changing, (p) => p.assignee)) {
    let q = db.from("tasks").update({ assigned_to: assignee })
      .eq("account_id", accountId).in("contact_id", group.map((p) => p.contactId)).is("completed_at", null);
    q = from === null ? q.is("assigned_to", null) : q.eq("assigned_to", from);
    const { data: moved, error: tErr } = await q.select("id, contact_id");
    if (tErr) throw new Error(`assignContacts task move failed: ${tErr.message}`);
    for (const t of (moved ?? []) as { id: string; contact_id: string }[]) {
      group.find((p) => p.contactId === t.contact_id)?.movedTaskIds.push(t.id);
    }
  }

  // 2. Then the contacts.
  const { error: upErr } = await db.from("contacts")
    .update({ assigned_to: assignee, updated_at: new Date().toISOString() })
    .eq("account_id", accountId).in("id", changing.map((p) => p.contactId));
  if (upErr) throw new Error(`assignContacts failed: ${upErr.message}`);

  // 3. Then the ledger.
  for (const p of changing) {
    await emit(db, accountId, "contact.assigned", actorId, { contactId: p.contactId, from: p.assignee, to: assignee });
  }
  return changing;
}

/**
 * The Undo for assignContacts (review m1). Acts on a customer only while it
 * is still with the target that call gave it to, as the removal's Undo acts
 * only on what is still Unassigned (review residual 5): one reassigned since
 * stays where it went. Puts each such customer back with its previous
 * assignee and moves back ONLY the task ids that call moved, and of those only
 * the ones the target still holds, so a task the target had before the
 * reassignment, or one handed on since, stays where it is. Same tasks-first
 * order as assignContacts, so a retry after a partial failure finishes. A
 * previous assignee who is no longer a member of this account is refused (A5)
 * rather than given the customer back.
 */
export async function undoAssignContacts(
  db: SupabaseClient, accountId: string, previous: readonly PreviousAssignee[], actorId: string,
): Promise<void> {
  if (previous.length === 0) return;
  const { data, error } = await db.from("contacts").select("id, assigned_to")
    .eq("account_id", accountId).in("id", previous.map((p) => p.contactId));
  if (error) throw new Error(`undoAssignContacts read failed: ${error.message}`);
  const current = new Map(((data ?? []) as ContactRow[]).map((r) => [r.id, r.assigned_to]));
  const work = previous
    .filter((p) => p.target !== p.assignee && current.has(p.contactId) && current.get(p.contactId) === p.target)
    .map((p) => ({ ...p, holder: p.target }));
  if (work.length === 0) return;
  const restoring = groupBy(work, (w) => w.assignee);
  for (const who of restoring.keys()) if (who !== null) await assertMember(db, accountId, who);

  // 1. The moved tasks, back from the target (the guard keeps one handed on since where it is).
  for (const w of work) {
    if (w.movedTaskIds.length === 0) continue;
    let q = db.from("tasks").update({ assigned_to: w.assignee })
      .eq("account_id", accountId).in("id", w.movedTaskIds).is("completed_at", null);
    q = w.holder === null ? q.is("assigned_to", null) : q.eq("assigned_to", w.holder);
    const { error: tErr } = await q;
    if (tErr) throw new Error(`undoAssignContacts task move failed: ${tErr.message}`);
  }
  // 2. Then the contacts, one statement per previous assignee.
  for (const [who, group] of restoring) {
    const { error: upErr } = await db.from("contacts")
      .update({ assigned_to: who, updated_at: new Date().toISOString() })
      .eq("account_id", accountId).in("id", group.map((w) => w.contactId));
    if (upErr) throw new Error(`undoAssignContacts failed: ${upErr.message}`);
  }
  // 3. Then the ledger.
  for (const w of work) {
    await emit(db, accountId, "contact.assigned", actorId, { contactId: w.contactId, from: w.holder, to: w.assignee });
  }
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

const isIdList = (v: unknown): v is string[] => Array.isArray(v) && v.every((x) => typeof x === "string");

/**
 * 0068's service_role-only release. Pass serviceDb(). Any result that is not
 * `{ contacts: string[], tasks: string[] }` throws (review m7): read as "nothing
 * released", it would give the removal's Undo nothing to restore while the
 * customers had in fact gone back to Unassigned.
 */
export async function releaseMemberAssignments(db: SupabaseClient, accountId: string, userId: string): Promise<ReleasedAssignments> {
  const { data, error } = await db.rpc("release_member_assignments", { p_account_id: accountId, p_user_id: userId });
  if (error) throw new Error(`releaseMemberAssignments failed: ${error.message}`);
  const j = (typeof data === "object" && data !== null && !Array.isArray(data) ? data : {}) as { contacts?: unknown; tasks?: unknown };
  if (!isIdList(j.contacts) || !isIdList(j.tasks)) {
    throw new Error(`releaseMemberAssignments: unexpected result shape: ${JSON.stringify(data)?.slice(0, 200)}`);
  }
  return { contacts: j.contacts, tasks: j.tasks };
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
