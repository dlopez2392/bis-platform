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

/**
 * An Error that keeps PostgREST's SQLSTATE (fix round 1, m1): a refusal (RLS,
 * or 0068's trigger, both 42501) is told apart from any other failure by its
 * code, never by the wording of its message.
 */
export class AssignmentDbError extends Error {
  readonly code: string | undefined;
  constructor(message: string, code: string | undefined) {
    super(message);
    this.name = "AssignmentDbError";
    this.code = code || undefined;
  }
}
function dbError(what: string, error: { message: string; code?: string }): AssignmentDbError {
  return new AssignmentDbError(`${what}: ${error.message}`, error.code);
}

/**
 * The caller's own users.id AS A PERSON OF THIS COMPANY: the users row of the
 * Clerk user, only when it holds a membership in this account (scope
 * 'account'). Null otherwise. A users row alone is not enough (fix round 1,
 * C1): since 0067 the topbar theme toggle upserts one for ANY signed-in
 * person, the agency's staff included, and the agency is never a member of a
 * client's company (A5), so what it adds stays Unassigned and it never sees
 * "Mine". Two plain reads, not an embed: under a client's RLS both are
 * visible to a member (users_member_read, memberships_member_read).
 */
export async function readPersonId(db: SupabaseClient, accountId: string, clerkUserId: string): Promise<string | null> {
  const { data: user, error } = await db.from("users").select("id").eq("clerk_user_id", clerkUserId).maybeSingle();
  if (error) throw dbError("readPersonId failed", error);
  const userId = (user?.id as string | undefined) ?? null;
  if (!userId) return null;
  const { data: member, error: mErr } = await db.from("memberships").select("id")
    .eq("scope", "account").eq("account_id", accountId).eq("user_id", userId).maybeSingle();
  if (mErr) throw dbError("readPersonId membership read failed", mErr);
  return member ? userId : null;
}

/** A new task's default assignee: the customer's, else its author (plan deviation 3). */
export async function taskAssigneeFor(
  db: SupabaseClient, accountId: string, contactId: string | null, authorUserId: string | null,
): Promise<string | null> {
  if (contactId) {
    const { data, error } = await db.from("contacts").select("assigned_to").eq("account_id", accountId).eq("id", contactId).maybeSingle();
    if (error) throw dbError("taskAssigneeFor failed", error);
    const owner = (data?.assigned_to as string | null | undefined) ?? null;
    if (owner) return owner;
  }
  return authorUserId;
}

/** A5: only a member of THIS company can hold a customer or a task. */
async function assertMember(db: SupabaseClient, accountId: string, userId: string): Promise<void> {
  const { data, error } = await db.from("memberships").select("id")
    .eq("scope", "account").eq("account_id", accountId).eq("user_id", userId).maybeSingle();
  if (error) throw dbError("assignment: membership check failed", error);
  if (!data) throw new Error("assignment: the assignee is not a member of this account");
}

type ContactRow = { id: string; assigned_to: string | null };

/** Groups items by a key, a nullable user id being Unassigned (null) as a group of its own. */
function groupBy<T, K>(items: readonly T[], key: (t: T) => K): Map<K, T[]> {
  const m = new Map<K, T[]>();
  for (const it of items) m.set(key(it), [...(m.get(key(it)) ?? []), it]);
  return m;
}

/**
 * At most this many ids in one `.in()` (final review m4). PostgREST carries
 * the list in the request URL, and contacts.ts's TAG_LOOKUP_BATCH_SIZE found
 * 400-500 UUIDs long enough for `fetch` itself to fail; 200 is the size it
 * settled on. A bulk "Assign to…" takes up to 500 customers (MAX_ASSIGN), and
 * a removal can release far more, so every list here is split.
 */
export const ASSIGN_IN_BATCH_SIZE = 200;
function batches<T>(items: readonly T[]): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += ASSIGN_IN_BATCH_SIZE) out.push(items.slice(i, i + ASSIGN_IN_BATCH_SIZE));
  return out;
}

/** `assigned_to` equal to `who`, where Unassigned is IS NULL, never `= null` (which matches nothing). */
function heldBy<Q extends { is(c: string, v: null): Q; eq(c: string, v: string): Q }>(q: Q, who: string | null): Q {
  return who === null ? q.is("assigned_to", null) : q.eq("assigned_to", who);
}

/** The contacts of this account among `ids`, with their holder: one read per batch. */
async function readHolders(db: SupabaseClient, accountId: string, ids: readonly string[], what: string): Promise<ContactRow[]> {
  const rows: ContactRow[] = [];
  for (const batch of batches(ids)) {
    const { data, error } = await db.from("contacts").select("id, assigned_to").eq("account_id", accountId).in("id", batch);
    if (error) throw dbError(`${what} read failed`, error);
    rows.push(...((data ?? []) as ContactRow[]));
  }
  return rows;
}

/**
 * Sets each contact's assignee and moves that contact's OPEN tasks that were
 * the previous assignee's along with it (A4). Returns one entry per customer
 * it actually CHANGED (one already held by the target is left out, so an Undo
 * can never touch it), which is exactly what undoAssignContacts takes.
 *
 * The order is load-bearing; it is what makes a retry heal (review I-3):
 *   1. the open tasks move (old holder -> target), one statement per old holder
 *      (and per ASSIGN_IN_BATCH_SIZE customers);
 *   2. the contacts change, one statement per ASSIGN_IN_BATCH_SIZE customers;
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
  const changing: PreviousAssignee[] = (await readHolders(db, accountId, contactIds, "assignContacts"))
    .filter((r) => r.assigned_to !== assignee)
    .map((r) => ({ contactId: r.id, assignee: r.assigned_to, target: assignee, movedTaskIds: [] }));
  if (changing.length === 0) return [];

  // 1. Tasks first, one statement per holder they are leaving (and per batch, m4).
  for (const [from, group] of groupBy(changing, (p) => p.assignee)) {
    for (const batch of batches(group)) {
      const q = heldBy(db.from("tasks").update({ assigned_to: assignee })
        .eq("account_id", accountId).in("contact_id", batch.map((p) => p.contactId)).is("completed_at", null), from);
      const { data: moved, error: tErr } = await q.select("id, contact_id");
      if (tErr) throw dbError("assignContacts task move failed", tErr);
      for (const t of (moved ?? []) as { id: string; contact_id: string }[]) {
        batch.find((p) => p.contactId === t.contact_id)?.movedTaskIds.push(t.id);
      }
    }
  }

  // 2. Then the contacts, one statement per batch.
  for (const batch of batches(changing)) {
    const { error: upErr } = await db.from("contacts")
      .update({ assigned_to: assignee, updated_at: new Date().toISOString() })
      .eq("account_id", accountId).in("id", batch.map((p) => p.contactId));
    if (upErr) throw dbError("assignContacts failed", upErr);
  }

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
 *
 * The still-the-target check is made twice: on the read, to decide the work,
 * and AT THE WRITE (final review m10), as the task move-back always was, so a
 * pick that lands between the read and the write is not overwritten. Every
 * list is split at ASSIGN_IN_BATCH_SIZE (m4).
 */
export async function undoAssignContacts(
  db: SupabaseClient, accountId: string, previous: readonly PreviousAssignee[], actorId: string,
): Promise<void> {
  if (previous.length === 0) return;
  const rows = await readHolders(db, accountId, previous.map((p) => p.contactId), "undoAssignContacts");
  const current = new Map(rows.map((r) => [r.id, r.assigned_to]));
  const work = previous
    .filter((p) => p.target !== p.assignee && current.has(p.contactId) && current.get(p.contactId) === p.target)
    .map((p) => ({ ...p, holder: p.target }));
  if (work.length === 0) return;
  const restoring = groupBy(work, (w) => w.assignee);
  for (const who of restoring.keys()) if (who !== null) await assertMember(db, accountId, who);

  // 1. The moved tasks, back from the target (the guard keeps one handed on since where it is).
  //    Only tasks of THIS entry's customer (fix round 1, m2): `previous` can come back
  //    from a browser, and a forged id must not move another customer's task.
  for (const w of work) {
    for (const batch of batches(w.movedTaskIds)) {
      const q = heldBy(db.from("tasks").update({ assigned_to: w.assignee })
        .eq("account_id", accountId).eq("contact_id", w.contactId).in("id", batch).is("completed_at", null), w.holder);
      const { error: tErr } = await q;
      if (tErr) throw dbError("undoAssignContacts task move failed", tErr);
    }
  }
  // 2. Then the contacts, one statement per (previous assignee, target) pair and batch,
  //    each guarded by its target at the write (m10). One assignContacts call has one
  //    target, but `previous` comes from a browser, so the pair is the honest key.
  const pairs = groupBy(work, (w) => JSON.stringify([w.assignee, w.holder]));
  const written = new Set<string>();
  for (const group of pairs.values()) {
    const { assignee: who, holder } = group[0]!;
    for (const batch of batches(group)) {
      const q = heldBy(db.from("contacts")
        .update({ assigned_to: who, updated_at: new Date().toISOString() })
        .eq("account_id", accountId).in("id", batch.map((w) => w.contactId)), holder);
      const { data: back, error: upErr } = await q.select("id");
      if (upErr) throw dbError("undoAssignContacts failed", upErr);
      for (const r of (back ?? []) as { id: string }[]) written.add(r.id);
    }
  }
  // 3. Then the ledger: only the customers the guarded write actually put back.
  for (const w of work) {
    if (!written.has(w.contactId)) continue;
    await emit(db, accountId, "contact.assigned", actorId, { contactId: w.contactId, from: w.holder, to: w.assignee });
  }
}

/**
 * Hands one task to `assignee` (or to nobody) and returns who had it.
 *
 * `expected` (final review M7) is the task Undo's guard: the holder the save
 * being undone set. When it is given, the task moves only while that person
 * (or Unassigned, for null) still holds it, checked on the read and again AT
 * THE WRITE, so a pick someone made after the save is never overwritten by
 * its Undo; that answers "changed" and writes nothing, no event either. A
 * plain pick passes no `expected` and writes whoever holds the task now.
 */
export async function setTaskAssignee(
  db: SupabaseClient, accountId: string, taskId: string, assignee: string | null, actorId: string,
  opts: { expected?: string | null } = {},
): Promise<{ previous: string | null } | "not_found" | "changed"> {
  const { data, error } = await db.from("tasks").select("assigned_to").eq("account_id", accountId).eq("id", taskId).maybeSingle();
  if (error) throw dbError("setTaskAssignee read failed", error);
  if (!data) return "not_found";
  const previous = (data.assigned_to as string | null) ?? null;
  const guarded = opts.expected !== undefined;
  if (guarded && previous !== opts.expected) return "changed";
  if (assignee !== null) await assertMember(db, accountId, assignee);
  let q = db.from("tasks").update({ assigned_to: assignee }).eq("account_id", accountId).eq("id", taskId);
  if (guarded) q = heldBy(q, opts.expected ?? null);
  const { data: written, error: upErr } = await q.select("id");
  if (upErr) throw dbError("setTaskAssignee failed", upErr);
  if (guarded && (written ?? []).length === 0) return "changed";
  await emit(db, accountId, "task.assigned", actorId, { taskId, from: previous, to: assignee });
  return { previous };
}

/**
 * A person just made a Technician (final review, A4 for a demotion): the open
 * tasks they hold on customers that are NOT theirs go back to Unassigned,
 * because 0068's tasks_technician_scope now hides those tasks from them (a
 * Technician sees a task only on their own customer, or with no customer and
 * assigned to them). A task with no customer stays theirs: they still see it.
 * Returns the released task ids. Pass serviceDb(): the role change is the
 * Team's (server-only) write, and the person whose role changed is not the
 * caller.
 *
 * Three steps, not one statement (PostgREST cannot filter an update on a
 * joined row): their open tasks that have a customer, then which of those
 * customers are theirs, then the release, guarded at the write by holder and
 * still open, so a task finished or handed on meanwhile is left alone. A
 * customer handed to them between the read and the write can lose a task
 * they should have kept; it is Unassigned, not hidden, and anyone can pick it.
 */
export async function releaseTasksOffCustomers(db: SupabaseClient, accountId: string, userId: string): Promise<string[]> {
  const { data, error } = await db.from("tasks").select("id, contact_id")
    .eq("account_id", accountId).eq("assigned_to", userId).is("completed_at", null).not("contact_id", "is", null);
  if (error) throw dbError("releaseTasksOffCustomers read failed", error);
  const open = (data ?? []) as { id: string; contact_id: string }[];
  if (open.length === 0) return [];
  const theirs = new Set((await readHolders(db, accountId, [...new Set(open.map((t) => t.contact_id))], "releaseTasksOffCustomers"))
    .filter((r) => r.assigned_to === userId).map((r) => r.id));
  const off = open.filter((t) => !theirs.has(t.contact_id)).map((t) => t.id);
  const released: string[] = [];
  for (const batch of batches(off)) {
    const { data: done, error: upErr } = await db.from("tasks").update({ assigned_to: null })
      .eq("account_id", accountId).in("id", batch).eq("assigned_to", userId).is("completed_at", null).select("id");
    if (upErr) throw dbError("releaseTasksOffCustomers failed", upErr);
    released.push(...((done ?? []) as { id: string }[]).map((r) => r.id));
  }
  return released;
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
  if (error) throw dbError("releaseMemberAssignments failed", error);
  const j = (typeof data === "object" && data !== null && !Array.isArray(data) ? data : {}) as { contacts?: unknown; tasks?: unknown };
  if (!isIdList(j.contacts) || !isIdList(j.tasks)) {
    throw new Error(`releaseMemberAssignments: unexpected result shape: ${JSON.stringify(data)?.slice(0, 200)}`);
  }
  return { contacts: j.contacts, tasks: j.tasks };
}

/** The removal's Undo: gives back only what nobody has picked up since. Pass serviceDb(). */
export async function reassignReleased(db: SupabaseClient, accountId: string, userId: string, released: ReleasedAssignments): Promise<void> {
  // Split at ASSIGN_IN_BATCH_SIZE (final review m4): a removal releases every customer the person held.
  for (const batch of batches(released.contacts)) {
    const { error } = await db.from("contacts").update({ assigned_to: userId })
      .eq("account_id", accountId).in("id", batch).is("assigned_to", null);
    if (error) throw dbError("reassignReleased contacts failed", error);
  }
  for (const batch of batches(released.tasks)) {
    const { error } = await db.from("tasks").update({ assigned_to: userId })
      .eq("account_id", accountId).in("id", batch).is("assigned_to", null).is("completed_at", null);
    if (error) throw dbError("reassignReleased tasks failed", error);
  }
}
