import type { SupabaseClient } from "@supabase/supabase-js";
import { emit, type ActorType } from "./events";
import { readConsentEvent, readConsentHistory, newestDecidingRow } from "./consent";

export async function addNote(
  db: SupabaseClient, accountId: string, contactId: string, body: string, actorId: string,
  actorType: ActorType = "user",
): Promise<{ id: string }> {
  const { data, error } = await db.from("notes")
    .insert({ account_id: accountId, contact_id: contactId, body, author_id: actorId })
    .select("id").single();
  if (error || !data) throw new Error(`addNote failed: ${error?.message}`);
  await emit(db, accountId, "note.created", actorId, { contactId, noteId: data.id }, actorType);
  return { id: data.id };
}

export async function listNotes(db: SupabaseClient, accountId: string, contactId: string) {
  const { data, error } = await db.from("notes")
    .select("id, body, pinned, author_id, created_at")
    .eq("account_id", accountId).eq("contact_id", contactId)
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return data;
}

export async function addTask(
  db: SupabaseClient, accountId: string,
  input: { contactId?: string; title: string; dueAt?: string }, actorId: string,
  actorType: ActorType = "user",
): Promise<{ id: string }> {
  const { data, error } = await db.from("tasks")
    .insert({ account_id: accountId, contact_id: input.contactId ?? null,
              title: input.title, due_at: input.dueAt ?? null })
    .select("id").single();
  if (error || !data) throw new Error(`addTask failed: ${error?.message}`);
  await emit(db, accountId, "task.created", actorId,
    { taskId: data.id, contactId: input.contactId }, actorType);
  return { id: data.id };
}

export async function listContactTasks(db: SupabaseClient, accountId: string, contactId: string) {
  const { data, error } = await db.from("tasks")
    .select("id, title, due_at, completed_at, created_at, consent_event_id")
    .eq("account_id", accountId).eq("contact_id", contactId)
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return data;
}

export async function completeTask(
  db: SupabaseClient, accountId: string, taskId: string, actorId: string,
  actorType: ActorType = "user",
): Promise<void> {
  const { data: linked, error: readError } = await db.from("tasks")
    .select("consent_event_id").eq("account_id", accountId).eq("id", taskId).maybeSingle();
  if (readError) throw new Error(readError.message);
  const eventId = (linked as { consent_event_id: string | null } | null)?.consent_event_id ?? null;
  if (eventId && await holdStillOpen(db, accountId, eventId)) throw new HoldUndecidedError();
  const { error } = await db.from("tasks")
    .update({ completed_at: new Date().toISOString() })
    .eq("account_id", accountId).eq("id", taskId);
  if (error) throw new Error(error.message);
  await emit(db, accountId, "task.completed", actorId, { taskId }, actorType);
}

/**
 * Reverses `completeTask` — the "Done" button's undo (DESIGN.md rule 6:
 * reversible actions run immediately with an undo toast; the undo needs the
 * reverse operation to actually exist). Zero-migration: `completed_at` is
 * already nullable, so reopening is just setting it back to null. Mirrors
 * `completeTask`'s own shape, including emitting its own event rather than
 * silently reusing `task.created` or staying silent.
 */
export async function reopenTask(
  db: SupabaseClient, accountId: string, taskId: string, actorId: string,
  actorType: ActorType = "user",
): Promise<void> {
  const { data, error } = await db.from("tasks")
    .update({ completed_at: null })
    .eq("account_id", accountId).eq("id", taskId)
    .select("id");
  if (error) throw new Error(error.message);
  // Mirrors `setBookingStatus` (booking.ts): select the id back and throw
  // when nothing matched, rather than resolving success for a write that
  // touched no row. Undo is the one path where a silent no-op is
  // user-visible — the toast would say "undone" while the task the operator
  // is looking at stays completed. `completeTask` shares this gap; left
  // alone here, recorded for the whole-branch review.
  if (!data?.length) throw new Error(`reopenTask: no task ${taskId} for account ${accountId}`);
  await emit(db, accountId, "task.reopened", actorId, { taskId }, actorType);
}

/**
 * The consent To-do (consent chain spec §6, plan Task 8): one per ledger row,
 * enforced by 0055's `tasks_consent_event_once`. A second attempt — Telnyx
 * retrying a webhook whose first attempt already wrote the To-do — finds the
 * first one rather than making two, and emits nothing. Any other error
 * THROWS: the inbound route turns it into a 503 so the To-do is retried.
 */
export async function ensureConsentTask(
  db: SupabaseClient, accountId: string,
  input: { contactId: string; consentEventId: string; title: string }, actorId: string,
  actorType: ActorType = "system",
): Promise<{ id: string; created: boolean }> {
  const { data, error } = await db.from("tasks")
    .insert({ account_id: accountId, contact_id: input.contactId, title: input.title, consent_event_id: input.consentEventId })
    .select("id").single();
  if (!error && data) {
    await emit(db, accountId, "task.created", actorId,
      { taskId: data.id, contactId: input.contactId, consentEventId: input.consentEventId }, actorType);
    return { id: data.id as string, created: true };
  }
  if (error?.code !== "23505") throw new Error(`ensureConsentTask failed: ${error?.message ?? "no row"}`);
  const { data: found, error: readErr } = await db.from("tasks")
    .select("id").eq("account_id", accountId).eq("consent_event_id", input.consentEventId).maybeSingle();
  if (readErr || !found) throw new Error(`ensureConsentTask: already there but unreadable: ${readErr?.message ?? "no row"}`);
  return { id: (found as { id: string }).id, created: false };
}

/**
 * Completes the OPEN tasks that link any of these ledger rows (a hold's
 * To-do, once staff confirm or release the hold, from the drawer or the To-do
 * list) and returns exactly the ids it completed: the action's undo reopens
 * those and no others. No rows asked about, no write.
 */
export async function completeTasksForConsentEvents(
  db: SupabaseClient, accountId: string, eventIds: readonly string[], actorId: string,
  actorType: ActorType = "user",
): Promise<string[]> {
  if (eventIds.length === 0) return [];
  const { data, error } = await db.from("tasks")
    .update({ completed_at: new Date().toISOString() })
    .eq("account_id", accountId).in("consent_event_id", [...eventIds]).is("completed_at", null)
    .select("id");
  if (error) throw new Error(`completeTasksForConsentEvents failed: ${error.message}`);
  const ids = ((data ?? []) as { id: string }[]).map((r) => r.id);
  for (const taskId of ids) await emit(db, accountId, "task.completed", actorId, { taskId }, actorType);
  return ids;
}

/** The undo of `completeTasksForConsentEvents`: reopens exactly these tasks, in this account. */
export async function reopenTasks(
  db: SupabaseClient, accountId: string, ids: readonly string[], actorId: string,
  actorType: ActorType = "user",
): Promise<void> {
  if (ids.length === 0) return;
  const { data, error } = await db.from("tasks")
    .update({ completed_at: null })
    .eq("account_id", accountId).in("id", [...ids])
    .select("id");
  if (error) throw new Error(`reopenTasks failed: ${error.message}`);
  for (const r of (data ?? []) as { id: string }[]) await emit(db, accountId, "task.reopened", actorId, { taskId: r.id }, actorType);
}

/** A hold's To-do is closed by deciding the hold (Confirm stop / Not a stop), never by "Done" (review R3-I1). */
export class HoldUndecidedError extends Error {
  constructor() {
    super("this To-do asks about a hold that is still undecided");
    this.name = "HoldUndecidedError";
  }
}

/**
 * Is the NUMBER this ledger row is about still on hold — its newest deciding
 * row a hold, this one or a later one (review R3-N3: after Not a stop and its
 * Undo, the new hold H2 is newest while the reopened To-do still links H1)?
 */
async function holdStillOpen(db: SupabaseClient, accountId: string, eventId: string): Promise<boolean> {
  const ev = await readConsentEvent(db, accountId, eventId);
  if (!ev || ev.action !== "held") return false;
  return newestDecidingRow(await readConsentHistory(db, accountId, ev.channel, ev.address))?.action === "held";
}

/**
 * A task's contact and the ledger row it asks about, by account AND id (the
 * consent To-do's buttons act on that contact's number, and close the To-do
 * through its own link).
 */
export async function readTaskContact(
  db: SupabaseClient, accountId: string, taskId: string,
): Promise<{ contactId: string | null; consentEventId: string | null } | null> {
  const { data, error } = await db.from("tasks")
    .select("contact_id, consent_event_id").eq("account_id", accountId).eq("id", taskId).maybeSingle();
  if (error) throw new Error(`readTaskContact failed: ${error.message}`);
  const row = data as { contact_id: string | null; consent_event_id: string | null } | null;
  return row ? { contactId: row.contact_id, consentEventId: row.consent_event_id } : null;
}

/** The open To-dos whose linked number is still on hold: the contact timeline shows a hint in place of their Done (review R3-N1). */
export async function holdOpenTaskIds(
  db: SupabaseClient, accountId: string,
  tasks: readonly { id: string; completed_at: string | null; consent_event_id?: string | null }[],
): Promise<string[]> {
  const open: string[] = [];
  for (const t of tasks) {
    if (!t.completed_at && t.consent_event_id && await holdStillOpen(db, accountId, t.consent_event_id)) open.push(t.id);
  }
  return open;
}
