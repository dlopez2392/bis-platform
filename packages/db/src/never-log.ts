import type { SupabaseClient } from "@supabase/supabase-js";
import { emit } from "./events";
import { NEVER_LOG_MAX, type NeverLogKind, type NeverLogPattern } from "./never-log-rules";

/**
 * S-06 part 2 (0083): the account's Never record list. Writes are server-only (0053): callers pass the
 * service client after their own role proof (the actions' requireAccountOwner). Every read and write
 * is scoped to the account; an entry id is never trusted alone.
 */
export type NeverLogEntry = NeverLogPattern & { id: string; addedBy: string; createdAt: string };
export type AddNeverLogResult = { outcome: "added"; entry: NeverLogEntry } | { outcome: "duplicate" } | { outcome: "full" };

const COLS = "id, pattern, kind, added_by, created_at";
/** PostgREST's max_rows. Above NEVER_LOG_MAX on purpose: a race past the cap (plan G11) still drops. */
const READ_LIMIT = 1000;
type Raw = { id: string; pattern: string; kind: NeverLogKind; added_by: string; created_at: string };
const toEntry = (r: Raw): NeverLogEntry => ({
  id: r.id, pattern: r.pattern, kind: r.kind, addedBy: r.added_by, createdAt: new Date(r.created_at).toISOString(),
});

export async function listNeverLog(db: SupabaseClient, accountId: string): Promise<NeverLogEntry[]> {
  const { data, error } = await db.from("inbound_never_log").select(COLS).eq("account_id", accountId)
    .order("created_at", { ascending: false }).order("id", { ascending: false }).limit(READ_LIMIT);
  if (error) throw new Error(`listNeverLog failed: ${error.message}`);
  return ((data ?? []) as Raw[]).map(toEntry);
}

export async function addNeverLog(db: SupabaseClient, accountId: string, p: NeverLogPattern, actorId: string): Promise<AddNeverLogResult> {
  const { data: same, error: sErr } = await db.from("inbound_never_log").select("id")
    .eq("account_id", accountId).eq("pattern", p.pattern).maybeSingle();
  if (sErr) throw new Error(`addNeverLog duplicate read failed: ${sErr.message}`);
  if (same) return { outcome: "duplicate" };
  const { count, error: cErr } = await db.from("inbound_never_log").select("id", { count: "exact", head: true }).eq("account_id", accountId);
  if (cErr) throw new Error(`addNeverLog count failed: ${cErr.message}`);
  if (count === null) throw new Error("addNeverLog: no count");
  if (count >= NEVER_LOG_MAX) return { outcome: "full" };
  const { data, error } = await db.from("inbound_never_log")
    .insert({ account_id: accountId, pattern: p.pattern, kind: p.kind, added_by: actorId }).select(COLS).single();
  if (error?.code === "23505") return { outcome: "duplicate" };
  if (error || !data) throw new Error(`addNeverLog failed: ${error?.message}`);
  const entry = toEntry(data as Raw);
  // The event names the row and its kind, never the pattern (an address is personal data).
  await emit(db, accountId, "account.never_log_added", actorId, { id: entry.id, kind: entry.kind });
  return { outcome: "added", entry };
}

export async function removeNeverLog(db: SupabaseClient, accountId: string, id: string, actorId: string): Promise<NeverLogEntry | null> {
  const { data, error } = await db.from("inbound_never_log").delete().eq("account_id", accountId).eq("id", id).select(COLS);
  if (error) throw new Error(`removeNeverLog failed: ${error.message}`);
  const row = ((data ?? []) as Raw[])[0];
  if (!row) return null;
  await emit(db, accountId, "account.never_log_removed", actorId, { id: row.id, kind: row.kind });
  return toEntry(row);
}
