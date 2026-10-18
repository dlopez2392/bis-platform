import type { SupabaseClient } from "@supabase/supabase-js";
import { emit, type ActorType } from "./events";
import type { DocumentCategory } from "./document-rules";
import type { ScanStatus } from "./documents";

/**
 * The expiry To-dos (0084; spec 3.2). Service client only: the documentsExpiry cron pass reads every
 * account's candidates and writes the To-dos; nothing here runs on a request client. A candidate is a
 * live document that is NOT Owners only (a To-do title would reveal it to Staff), filed on a contact or
 * a group, with an expiry date in [fromDay, toDay] and a CLEAN current version. The pass narrows the
 * coarse UTC range to each account's own day. THROWS on a read or write error.
 */
export type ExpiringDocument = {
  id: string; account_id: string; contact_id: string | null; client_group_id: string | null;
  title: string; category: DocumentCategory; expires_on: string; owners_only: boolean; deleted_at: string | null;
  version_scan: ScanStatus; account_timezone: string | null; account_language: string | null;
};

type Raw = Omit<ExpiringDocument, "version_scan" | "account_timezone" | "account_language"> & {
  version: { scan_status: ScanStatus } | null;
  account: { timezone: string | null; language: string | null } | null;
};

export async function listExpiringDocuments(
  db: SupabaseClient, a: { fromDay: string; toDay: string; limit: number; accountId?: string },
): Promise<ExpiringDocument[]> {
  // One chain (TS2589 otherwise, documents.ts:70-73): the optional account scope is a .match on an empty
  // object when absent. Embeds by constraint name (plan Assumptions A1, A2).
  const { data, error } = await db.from("documents")
    .select("id, account_id, contact_id, client_group_id, title, category, expires_on, owners_only, deleted_at, "
      + "version:document_versions!documents_current_version_fkey!inner(scan_status), account:accounts!documents_account_id_fkey(timezone, language)")
    .match(a.accountId ? { account_id: a.accountId } : {})
    .is("deleted_at", null).eq("owners_only", false)
    .gte("expires_on", a.fromDay).lte("expires_on", a.toDay)
    .is("place_id", null).is("opportunity_id", null)
    .eq("version.scan_status", "clean")
    .order("expires_on", { ascending: false }).order("id", { ascending: false })
    .limit(a.limit);
  if (error) throw new Error(`listExpiringDocuments failed: ${error.message}`);
  return ((data ?? []) as unknown as Raw[]).flatMap(({ version, account, ...d }) => (version ? [{
    ...d, version_scan: version.scan_status, account_timezone: account?.timezone ?? null, account_language: account?.language ?? null,
  }] : []));
}

export const expiryTaskKey = (documentId: string, expiresOn: string): string => `${documentId}|${expiresOn}`;

/** Every (document, date) that already has its To-do, for these documents. Batches of 100 ids (a URL's length). */
export async function listDocumentExpiryTaskKeys(db: SupabaseClient, documentIds: readonly string[]): Promise<Set<string>> {
  const keys = new Set<string>();
  for (let i = 0; i < documentIds.length; i += 100) {
    const { data, error } = await db.from("tasks").select("document_expiry_id, document_expiry_on")
      .in("document_expiry_id", [...documentIds.slice(i, i + 100)]);
    if (error) throw new Error(`listDocumentExpiryTaskKeys failed: ${error.message}`);
    for (const t of (data ?? []) as { document_expiry_id: string; document_expiry_on: string }[]) {
      keys.add(expiryTaskKey(t.document_expiry_id, t.document_expiry_on));
    }
  }
  return keys;
}

/** Service client. The ONE To-do per document and expiry date (0084's tasks_document_expiry_once); emits task.created only when it made the row. */
export async function ensureDocumentExpiryTask(
  db: SupabaseClient, accountId: string,
  input: { documentId: string; expiresOn: string; contactId: string | null; title: string; dueAt: string },
  actorId: string, actorType: ActorType = "system",
): Promise<{ id: string; created: boolean }> {
  const { data, error } = await db.from("tasks").insert({
    account_id: accountId, contact_id: input.contactId, title: input.title, due_at: input.dueAt,
    document_expiry_id: input.documentId, document_expiry_on: input.expiresOn,
  }).select("id").single();
  if (!error && data) {
    const id = (data as { id: string }).id;
    await emit(db, accountId, "task.created", actorId, { taskId: id, contactId: input.contactId, documentId: input.documentId }, actorType);
    return { id, created: true };
  }
  if (error?.code !== "23505") throw new Error(`ensureDocumentExpiryTask failed: ${error?.message ?? "no row"}`);
  const { data: found, error: readErr } = await db.from("tasks").select("id")
    .eq("account_id", accountId).eq("document_expiry_id", input.documentId).eq("document_expiry_on", input.expiresOn).maybeSingle();
  if (readErr || !found) throw new Error(`ensureDocumentExpiryTask: already there but unreadable: ${readErr?.message ?? "no row"}`);
  return { id: (found as { id: string }).id, created: false };
}

/**
 * Service client, after the caller's role check and its request-client read. Owner ruling R1
 * (2026-10-17): a file switched to Owners only takes its OPEN expiry To-dos with it at once, so no
 * To-do title names it to Staff. Owner ruling R4 (2026-10-17): a file moved to the trash does too
 * (one call per trashed document). A done To-do stays (history). Switching the file back off, or
 * restoring it, holds nothing: the next pass run reopens the To-do for that file and date. Answers
 * how many went.
 */
export async function deleteOpenExpiryTasks(db: SupabaseClient, accountId: string, documentId: string): Promise<number> {
  const { data, error } = await db.from("tasks").delete()
    .eq("account_id", accountId).eq("document_expiry_id", documentId).is("completed_at", null).select("id");
  if (error) throw new Error(`deleteOpenExpiryTasks failed: ${error.message}`);
  return (data ?? []).length;
}
