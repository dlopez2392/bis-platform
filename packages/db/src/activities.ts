import type { SupabaseClient } from "@supabase/supabase-js";
import { emit, type ActorType } from "./events";

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
    .select("id, title, due_at, completed_at, created_at")
    .eq("account_id", accountId).eq("contact_id", contactId)
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return data;
}

export async function completeTask(
  db: SupabaseClient, accountId: string, taskId: string, actorId: string,
  actorType: ActorType = "user",
): Promise<void> {
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
