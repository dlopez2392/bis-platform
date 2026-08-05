import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

export type ChecklistStateRow = {
  id: string; item_key: string; title: string | null;
  done_at: string | null; done_by: string | null; note: string | null; position: number;
};

const COLS = "id, item_key, title, done_at, done_by, note, position";

/** Returns only rows that exist. A catalogue item with no row has never been
 *  touched; the caller merges these against the code catalogue. */
export async function listChecklistState(
  db: SupabaseClient, accountId: string,
): Promise<ChecklistStateRow[]> {
  const { data, error } = await db.from("checklist_items").select(COLS)
    .eq("account_id", accountId).order("position").order("created_at");
  if (error) throw new Error(`listChecklistState failed: ${error.message}`);
  return (data ?? []) as unknown as ChecklistStateRow[];
}

/**
 * Creates or updates one item's state. `done` and `note` are independent: a
 * caller passing only a note must not un-tick the item, which is why each is
 * applied only when explicitly present.
 */
export async function setChecklistItem(
  db: SupabaseClient, accountId: string, itemKey: string,
  patch: { done?: boolean; note?: string }, actorId: string,
): Promise<void> {
  const row: Record<string, unknown> = {};
  if (patch.done !== undefined) {
    row.done_at = patch.done ? new Date().toISOString() : null;
    row.done_by = patch.done ? actorId : null;
  }
  if (patch.note !== undefined) row.note = patch.note;

  const { data: existing, error: findErr } = await db.from("checklist_items").select("id")
    .eq("account_id", accountId).eq("item_key", itemKey).maybeSingle();
  if (findErr) throw new Error(`checklist lookup failed: ${findErr.message}`);

  if (existing) {
    const { error } = await db.from("checklist_items").update(row).eq("id", existing.id);
    if (error) throw new Error(`setChecklistItem failed: ${error.message}`);
    return;
  }

  const { error } = await db.from("checklist_items")
    .insert({ account_id: accountId, item_key: itemKey, ...row });
  if (error) throw new Error(`setChecklistItem failed: ${error.message}`);
}

/** Custom items carry their own title because no catalogue entry defines them.
 *  Takes no actorId: adding an item records no actor — only completing one
 *  does, via `done_by`. */
export async function addCustomChecklistItem(
  db: SupabaseClient, accountId: string, title: string,
): Promise<{ itemKey: string }> {
  const itemKey = `custom:${randomUUID()}`;
  const { error } = await db.from("checklist_items")
    .insert({ account_id: accountId, item_key: itemKey, title, position: 100 });
  if (error) throw new Error(`addCustomChecklistItem failed: ${error.message}`);
  return { itemKey };
}
