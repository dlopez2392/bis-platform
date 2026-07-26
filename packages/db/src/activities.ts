import type { SupabaseClient } from "@supabase/supabase-js";

async function emit(db: SupabaseClient, accountId: string, type: string, actorId: string, payload: object) {
  const { error } = await db.from("events").insert({
    account_id: accountId, type, actor_type: "user", actor_id: actorId, payload });
  if (error) throw new Error(`event emit failed: ${error.message}`);
}

export async function addNote(
  db: SupabaseClient, accountId: string, contactId: string, body: string, actorId: string,
): Promise<{ id: string }> {
  const { data, error } = await db.from("notes")
    .insert({ account_id: accountId, contact_id: contactId, body, author_id: actorId })
    .select("id").single();
  if (error || !data) throw new Error(`addNote failed: ${error?.message}`);
  await emit(db, accountId, "note.created", actorId, { contactId, noteId: data.id });
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
): Promise<{ id: string }> {
  const { data, error } = await db.from("tasks")
    .insert({ account_id: accountId, contact_id: input.contactId ?? null,
              title: input.title, due_at: input.dueAt ?? null })
    .select("id").single();
  if (error || !data) throw new Error(`addTask failed: ${error?.message}`);
  await emit(db, accountId, "task.created", actorId, { taskId: data.id, contactId: input.contactId });
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
): Promise<void> {
  const { error } = await db.from("tasks")
    .update({ completed_at: new Date().toISOString() })
    .eq("account_id", accountId).eq("id", taskId);
  if (error) throw new Error(error.message);
  await emit(db, accountId, "task.completed", actorId, { taskId });
}
