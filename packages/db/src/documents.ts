import type { SupabaseClient } from "@supabase/supabase-js";
import { emit } from "./events";
import { forContacts, withTimelinePage, type TimelinePageOpts } from "./timeline-cursor";
import { DOCUMENT_BUCKET, type DocumentCategory, type DocumentContentType, type DocumentSource } from "./document-rules";

/**
 * The document vault's data layer (0077; spec sections 3 and 5). READS take the caller's client:
 * on a request client RLS decides what is visible (the record's visibility, the Technician fence,
 * Owners only), and a server action's proof is exactly such a read. WRITES take the service client
 * a server action holds AFTER that proof (0053): `authenticated` has no write grant on either table.
 * Every write is scoped to `accountId`. Event payloads carry the document id and its record, never its
 * title or category: events_read (0001) shows every event to every Owner and Staff, and an
 * Owners-only title must not reach Staff that way (plan deviation 3). THROWS on a read or write error.
 */
export type DocumentRecordRef = { kind: "contact"; id: string } | { kind: "group"; id: string };
export type DocumentRow = {
  id: string; account_id: string; contact_id: string | null; client_group_id: string | null;
  title: string; category: DocumentCategory; expires_on: string | null; owners_only: boolean; source: DocumentSource;
  current_version_id: string | null; created_by: string; created_at: string; updated_at: string;
  deleted_at: string | null; deleted_by: string | null;
};
export type DocumentVersionRow = {
  id: string; document_id: string; account_id: string; storage_path: string; bytes: number;
  content_type: DocumentContentType; original_name: string | null; status: "uploading" | "ready"; created_at: string;
};
/** `versions`: every READY version, newest first (created_at, then id, descending); always includes `version`. */
export type ListedDocument = DocumentRow & { version: DocumentVersionRow; versions: DocumentVersionRow[] };
export type RecordDocuments = { live: ListedDocument[]; trashed: ListedDocument[]; liveMore: boolean; trashedMore: boolean };

/** Plan deviation 9: the card reads at most this many live and this many trashed documents. */
export const MAX_DOCUMENTS_READ = 200;

const DOC_COLS = "id, account_id, contact_id, client_group_id, title, category, expires_on, owners_only, source, "
  + "current_version_id, created_by, created_at, updated_at, deleted_at, deleted_by";
const VERSION_COLS = "id, document_id, account_id, storage_path, bytes, content_type, original_name, status, created_at";

const recordColumn = (r: DocumentRecordRef) => (r.kind === "contact" ? "contact_id" : "client_group_id");
/** The payload's record key: contactId or groupId, never both (documents_one_record). */
const recordPayload = (row: { contact_id: string | null; client_group_id: string | null }) =>
  row.contact_id ? { contactId: row.contact_id } : { groupId: row.client_group_id };
/** bigint arrives as a number from PostgREST below 2^53, as a string from pg; both read as a number here. */
const asVersion = (v: DocumentVersionRow): DocumentVersionRow => ({ ...v, bytes: Number(v.bytes) });

/** Best-effort event after a committed write: the write stands, a lost event is logged (restoreContactLanguage's shape in contacts.ts). */
async function emitAfter(
  db: SupabaseClient, accountId: string, type: string, actorId: string, payload: object, actorType: "user" | "system" = "user",
): Promise<void> {
  try {
    await emit(db, accountId, type, actorId, payload, actorType);
  } catch (e) {
    console.error(`documents: account ${accountId}: ${type} emit failed after the write committed: ${(e as Error).message}`);
  }
}

/** Newest first by upload time, then id; the current version is always among them (spec 4.3's Versions list). */
function readyVersionsOf(current: DocumentVersionRow, all: readonly DocumentVersionRow[]): DocumentVersionRow[] {
  const ready = all.filter((v) => v.status === "ready").map(asVersion)
    .sort((a, b) => (a.created_at === b.created_at ? (a.id < b.id ? 1 : -1) : a.created_at < b.created_at ? 1 : -1));
  return ready.some((v) => v.id === current.id) ? ready : [asVersion(current), ...ready];
}

/** The card's read: live documents newest first, trashed ones by when they were trashed. Listed only once a version is ready. */
export async function listRecordDocuments(db: SupabaseClient, accountId: string, record: DocumentRecordRef): Promise<RecordDocuments> {
  const read = async (trashed: boolean) => {
    // One chain, the trash filter as an operator (`not.is` / `is`): a ternary over two builders, or a
    // reassigned `let q`, is too deep for tsc to check (TS2589). Two embeds of document_versions, each
    // named by its constraint (plan Assumption B1): the current version, and every version (the
    // one-to-many key), filtered to ready ones here so an upload in flight never shows.
    const { data, error } = await db.from("documents")
      .select(`${DOC_COLS}, version:document_versions!documents_current_version_fkey(${VERSION_COLS}), versions:document_versions!document_versions_document_fkey(${VERSION_COLS})`)
      .eq("account_id", accountId).eq(recordColumn(record), record.id).not("current_version_id", "is", null)
      .filter("deleted_at", trashed ? "not.is" : "is", null)
      .order(trashed ? "deleted_at" : "created_at", { ascending: false })
      .order("id", { ascending: false }).limit(MAX_DOCUMENTS_READ + 1);
    if (error) throw new Error(`listRecordDocuments failed: ${error.message}`);
    return ((data ?? []) as unknown as (DocumentRow & { version: DocumentVersionRow | null; versions: DocumentVersionRow[] | null })[])
      .flatMap((r) => (r.version ? [{ ...r, version: asVersion(r.version), versions: readyVersionsOf(r.version, r.versions ?? []) }] : []));
  };
  const [live, trashed] = await Promise.all([read(false), read(true)]);
  return {
    live: live.slice(0, MAX_DOCUMENTS_READ), trashed: trashed.slice(0, MAX_DOCUMENTS_READ),
    liveMore: live.length > MAX_DOCUMENTS_READ, trashedMore: trashed.length > MAX_DOCUMENTS_READ,
  };
}

export async function getDocument(db: SupabaseClient, accountId: string, documentId: string): Promise<DocumentRow | null> {
  const { data, error } = await db.from("documents").select(DOC_COLS).eq("account_id", accountId).eq("id", documentId).maybeSingle();
  if (error) throw new Error(`getDocument failed: ${error.message}`);
  return (data as DocumentRow | null) ?? null;
}

export async function getDocumentVersion(db: SupabaseClient, accountId: string, versionId: string): Promise<DocumentVersionRow | null> {
  const { data, error } = await db.from("document_versions").select(VERSION_COLS).eq("account_id", accountId).eq("id", versionId).maybeSingle();
  if (error) throw new Error(`getDocumentVersion failed: ${error.message}`);
  return data ? asVersion(data as DocumentVersionRow) : null;
}

/** The finish step's read: an UPLOADING version of this document, or null. */
export async function getUploadingVersion(
  db: SupabaseClient, accountId: string, documentId: string, versionId: string,
): Promise<DocumentVersionRow | null> {
  const { data, error } = await db.from("document_versions").select(VERSION_COLS)
    .eq("account_id", accountId).eq("document_id", documentId).eq("id", versionId).eq("status", "uploading").maybeSingle();
  if (error) throw new Error(`getUploadingVersion failed: ${error.message}`);
  return data ? asVersion(data as DocumentVersionRow) : null;
}

/** Service client. scan_status is honestly 'skipped' for a staff upload (spec 3.2). */
export async function createDocument(db: SupabaseClient, a: {
  accountId: string; record: DocumentRecordRef; title: string; category: DocumentCategory; expiresOn: string | null;
  ownersOnly: boolean; source: DocumentSource; createdBy: string;
}): Promise<string> {
  const { data, error } = await db.from("documents").insert({
    account_id: a.accountId, [recordColumn(a.record)]: a.record.id, title: a.title, category: a.category,
    expires_on: a.expiresOn, owners_only: a.ownersOnly, source: a.source, scan_status: "skipped", created_by: a.createdBy,
  }).select("id").single();
  if (error) throw new Error(`createDocument failed: ${error.message}`);
  return (data as { id: string }).id;
}

export type ReserveOutcome = { status: "ok"; versionId: string; storagePath: string } | { status: "over_quota" | "too_large" | "not_found" };

/** Service client: public.reserve_document_version (0077), executable by service_role only. */
export async function reserveDocumentVersion(db: SupabaseClient, a: {
  accountId: string; documentId: string; bytes: number; contentType: DocumentContentType; originalName: string | null; uploadedBy: string;
}): Promise<ReserveOutcome> {
  const { data, error } = await db.rpc("reserve_document_version", {
    p_account_id: a.accountId, p_document_id: a.documentId, p_bytes: a.bytes, p_content_type: a.contentType,
    p_original_name: a.originalName, p_uploaded_by: a.uploadedBy,
  });
  if (error) throw new Error(`reserveDocumentVersion failed: ${error.message}`);
  const r = data as { status: string; version_id?: string; storage_path?: string };
  if (r.status === "ok" && r.version_id && r.storage_path) return { status: "ok", versionId: r.version_id, storagePath: r.storage_path };
  if (r.status === "over_quota" || r.status === "too_large" || r.status === "not_found") return { status: r.status };
  throw new Error(`reserveDocumentVersion: unexpected answer ${JSON.stringify(r.status)}`);
}

/**
 * Service client, after the finish step checked the object's bytes. Only an UPLOADING version of
 * this document becomes ready, and only at the size it reserved (0077 answers `size_mismatch`
 * otherwise, before any write): every answer but `ok` is false, so a refused finish never reads as
 * ready, and the caller removes the object and the reservation. The document's current version moves
 * to it; document.added is emitted for a document's FIRST ready version, document.version_added for
 * every later one (owner ruling R2).
 */
export async function markDocumentVersionReady(db: SupabaseClient, a: {
  accountId: string; documentId: string; versionId: string; bytes: number; sha256: string; actorId: string;
}): Promise<boolean> {
  // public.mark_document_version_ready (0077): the version and the pointer move in ONE transaction.
  const { data, error } = await db.rpc("mark_document_version_ready", {
    p_account_id: a.accountId, p_document_id: a.documentId, p_version_id: a.versionId, p_bytes: a.bytes, p_sha256: a.sha256,
  });
  if (error) throw new Error(`markDocumentVersionReady failed: ${error.message}`);
  const r = data as { status: string; first?: boolean };
  if (r.status !== "ok") return false;
  // Best-effort, read included: the version IS ready and current, so a failed read for the event's
  // record ids is logged, never answered as a failed upload. The first version is document.added; a
  // later one is document.version_added (owner ruling R2). No title, no category (PR 1a deviation 3).
  try {
    const doc = await getDocument(db, a.accountId, a.documentId);
    if (doc) {
      await emit(db, a.accountId, r.first ? "document.added" : "document.version_added", a.actorId,
        r.first ? { documentId: doc.id, ...recordPayload(doc) } : { documentId: doc.id, versionId: a.versionId, ...recordPayload(doc) });
    }
  } catch (e) {
    console.error(`documents: account ${a.accountId}: ${r.first ? "document.added" : "document.version_added"} emit failed after the write committed: ${(e as Error).message}`);
  }
  return true;
}

/**
 * Service client: a refused or failed upload. The version goes (none when the reservation itself was
 * refused, `versionId` null); a document that never had a ready version goes too.
 */
export async function discardDocumentUpload(db: SupabaseClient, accountId: string, documentId: string, versionId: string | null): Promise<void> {
  if (versionId) {
    const { error } = await db.from("document_versions").delete()
      .eq("account_id", accountId).eq("document_id", documentId).eq("id", versionId).eq("status", "uploading");
    if (error) throw new Error(`discardDocumentUpload (version) failed: ${error.message}`);
  }
  const { error: docError } = await db.from("documents").delete()
    .eq("account_id", accountId).eq("id", documentId).is("current_version_id", null);
  if (docError) throw new Error(`discardDocumentUpload (document) failed: ${docError.message}`);
}

export type DocumentField = "title" | "category" | "expires_on";
export type CasOutcome = "updated" | "changed";

/**
 * Service client. An edit passes no `expected` and writes; an Undo passes `expected` = the value its
 * edit wrote, and changes nothing ("changed") when someone wrote after it (spec 4.1: compare-and-set,
 * never a blind restore). A trashed document is never edited.
 */
export async function updateDocumentField(
  db: SupabaseClient, accountId: string, documentId: string, field: DocumentField, value: string | null,
  expected?: { value: string | null },
): Promise<CasOutcome> {
  let q = db.from("documents").update({ [field]: value, updated_at: new Date().toISOString() })
    .eq("account_id", accountId).eq("id", documentId).is("deleted_at", null);
  if (expected) q = expected.value === null ? q.is(field, null) : q.eq(field, expected.value);
  const { data, error } = await q.select("id");
  if (error) throw new Error(`updateDocumentField failed: ${error.message}`);
  return (data ?? []).length > 0 ? "updated" : "changed";
}

/** Service client; the CALLER has checked the role (Owner or agency, spec 3.4). Same compare-and-set. */
export async function setDocumentOwnersOnly(
  db: SupabaseClient, accountId: string, documentId: string, value: boolean, expected?: boolean,
): Promise<CasOutcome> {
  let q = db.from("documents").update({ owners_only: value, updated_at: new Date().toISOString() })
    .eq("account_id", accountId).eq("id", documentId).is("deleted_at", null);
  if (expected !== undefined) q = q.eq("owners_only", expected);
  const { data, error } = await q.select("id");
  if (error) throw new Error(`setDocumentOwnersOnly failed: ${error.message}`);
  return (data ?? []).length > 0 ? "updated" : "changed";
}

/** Service client. Answers the stored instant exactly as PostgREST returned it; the Undo's restore compares against it. */
export async function trashDocument(
  db: SupabaseClient, accountId: string, documentId: string, actorId: string,
): Promise<{ status: "trashed"; deletedAt: string } | { status: "changed" }> {
  const now = new Date().toISOString();
  const { data, error } = await db.from("documents")
    .update({ deleted_at: now, deleted_by: actorId, updated_at: now })
    .eq("account_id", accountId).eq("id", documentId).is("deleted_at", null)
    .select("id, contact_id, client_group_id, category, deleted_at");
  if (error) throw new Error(`trashDocument failed: ${error.message}`);
  const row = (data ?? [])[0] as { id: string; contact_id: string | null; client_group_id: string | null; category: string; deleted_at: string } | undefined;
  if (!row) return { status: "changed" };
  await emitAfter(db, accountId, "document.trashed", actorId, { documentId: row.id, ...recordPayload(row) });
  return { status: "trashed", deletedAt: row.deleted_at };
}

/**
 * Service client. Restores only while deleted_at still equals the instant the caller saw. Never a row
 * Delete forever has claimed (plan deviation 4): its objects may already be gone. (`deleted_by` is
 * never null on a trashed row, documents_trash_coherent, so the `neq` cannot drop a real restore.)
 */
export async function restoreDocument(
  db: SupabaseClient, accountId: string, documentId: string, expectedDeletedAt: string, actorId: string,
): Promise<CasOutcome> {
  const { data, error } = await db.from("documents")
    .update({ deleted_at: null, deleted_by: null, updated_at: new Date().toISOString() })
    .eq("account_id", accountId).eq("id", documentId).eq("deleted_at", expectedDeletedAt)
    .neq("deleted_by", DOCUMENT_PURGING_MARK)
    .select("id, contact_id, client_group_id, category");
  if (error) throw new Error(`restoreDocument failed: ${error.message}`);
  const row = (data ?? [])[0] as { id: string; contact_id: string | null; client_group_id: string | null; category: string } | undefined;
  if (!row) return "changed";
  await emitAfter(db, accountId, "document.restored", actorId, { documentId: row.id, ...recordPayload(row) });
  return "updated";
}

/**
 * The space-used line (spec 4.2 item 4; 0078): the ACCOUNT's bytes, every version ready or uploading,
 * trashed documents included, which is exactly what reserve_document_version holds against the quota.
 * Any member's REQUEST client (0078 is SECURITY DEFINER and refuses a caller outside the account).
 * A bigint may arrive as a number or a numeric string (plan Assumption B2). THROWS on an error and on
 * anything that is not a non-negative safe integer: a null is a failure, never zero.
 */
export async function documentSpaceUsed(db: SupabaseClient, accountId: string): Promise<number> {
  const { data, error } = await db.rpc("document_space_used", { p_account_id: accountId });
  if (error) throw new Error(`documentSpaceUsed failed: ${error.message}`);
  const n = typeof data === "number" ? data : typeof data === "string" && /^\d+$/.test(data) ? Number(data) : Number.NaN;
  if (!Number.isSafeInteger(n) || n < 0) throw new Error(`documentSpaceUsed: unexpected answer ${JSON.stringify(data)}`);
  return n;
}

export type DocumentVersionState = { storage_path: string; status: "uploading" | "ready" };

/**
 * Service client, AFTER the request-client proof: every version of ONE document, for Delete forever's
 * object list and its in-flight check. Asks for 1001 and refuses past 1000 (review M5): a purge must
 * never act on a list PostgREST's row cap could have cut short.
 */
export async function listDocumentVersionStates(db: SupabaseClient, accountId: string, documentId: string): Promise<DocumentVersionState[]> {
  const { data, error } = await db.from("document_versions").select("storage_path, status")
    .eq("account_id", accountId).eq("document_id", documentId).limit(1001);
  if (error) throw new Error(`listDocumentVersionStates failed: ${error.message}`);
  const rows = (data ?? []) as DocumentVersionState[];
  if (rows.length > 1000) throw new Error(`listDocumentVersionStates: document ${documentId} has more than 1000 versions`);
  return rows;
}

/** `deleted_by` of a row Delete forever has claimed (plan deviation 4): restoreDocument never restores it. */
export const DOCUMENT_PURGING_MARK = "documents:purging";

/**
 * Service client: Delete forever's claim (plan deviation 4). Re-stamps deleted_at and marks deleted_by
 * with DOCUMENT_PURGING_MARK ONLY while deleted_at still equals the instant the caller's proof read,
 * so a Restore or a trash toast's Undo carrying that old instant (restoreDocument compares it) changes
 * nothing while the objects are being removed, and one carrying the new instant meets the marker. The new
 * instant is at least a millisecond later than the old one, so the two can never be equal. Answers the
 * stored new instant exactly as PostgREST returned it, or null when the file is no longer that trashed file.
 */
export async function claimDocumentForPurge(
  db: SupabaseClient, accountId: string, documentId: string, expectedDeletedAt: string,
): Promise<string | null> {
  const prior = Date.parse(expectedDeletedAt);
  const stamp = new Date(Math.max(Date.now(), Number.isNaN(prior) ? 0 : prior + 1)).toISOString();
  const { data, error } = await db.from("documents")
    .update({ deleted_at: stamp, deleted_by: DOCUMENT_PURGING_MARK, updated_at: stamp })
    .eq("account_id", accountId).eq("id", documentId).eq("deleted_at", expectedDeletedAt)
    .select("deleted_at");
  if (error) throw new Error(`claimDocumentForPurge failed: ${error.message}`);
  const row = (data ?? [])[0] as { deleted_at: string } | undefined;
  return row ? row.deleted_at : null;
}

/**
 * Service client, AFTER every object of the document is gone: the claimed row (its versions cascade),
 * then document.purged with actor `user` (spec 3.6: a person's purge). False when the row is no longer
 * the claimed one; nothing is emitted then. The payload carries the document and its record only.
 */
export async function deletePurgedDocument(
  db: SupabaseClient, accountId: string, doc: { id: string; contact_id: string | null; client_group_id: string | null },
  claimedAt: string, actorId: string,
): Promise<boolean> {
  // The actor is the event's (deleted_by holds the marker since the claim).
  const { data, error } = await db.from("documents").delete()
    .eq("account_id", accountId).eq("id", doc.id).eq("deleted_at", claimedAt).select("id");
  if (error) throw new Error(`deletePurgedDocument failed: ${error.message}`);
  if ((data ?? []).length === 0) return false;
  await emitAfter(db, accountId, "document.purged", actorId, { documentId: doc.id, ...recordPayload(doc) });
  return true;
}

export type SweepVersion = { id: string; account_id: string; document_id: string; storage_path: string };

/** Service client (the clean-up pass): versions still uploading, created before the cutoff, oldest first, across accounts. */
export async function listAbandonedUploads(db: SupabaseClient, cutoffIso: string, limit: number): Promise<SweepVersion[]> {
  const { data, error } = await db.from("document_versions").select("id, account_id, document_id, storage_path")
    .eq("status", "uploading").lt("created_at", cutoffIso).order("created_at", { ascending: true }).limit(limit);
  if (error) throw new Error(`listAbandonedUploads failed: ${error.message}`);
  return (data ?? []) as SweepVersion[];
}

/** Service client, AFTER its object is gone: the row, then its document if it never had a ready version. */
export async function deleteAbandonedVersion(db: SupabaseClient, v: SweepVersion): Promise<void> {
  await discardDocumentUpload(db, v.account_id, v.document_id, v.id);
}

export type PurgeCandidate = {
  id: string; account_id: string; contact_id: string | null; client_group_id: string | null; category: DocumentCategory; paths: string[];
};

/** Service client (the clean-up pass): documents trashed before the cutoff, with EVERY version's path. */
export async function listPurgeableDocuments(db: SupabaseClient, cutoffIso: string, limit: number): Promise<PurgeCandidate[]> {
  const { data, error } = await db.from("documents")
    .select("id, account_id, contact_id, client_group_id, category, versions:document_versions!document_versions_document_fkey(storage_path)")
    .not("deleted_at", "is", null).lt("deleted_at", cutoffIso).order("deleted_at", { ascending: true }).limit(limit);
  if (error) throw new Error(`listPurgeableDocuments failed: ${error.message}`);
  return ((data ?? []) as unknown as (Omit<PurgeCandidate, "paths"> & { versions: { storage_path: string }[] | null })[])
    .map(({ versions, ...d }) => ({ ...d, paths: (versions ?? []).map((v) => v.storage_path) }));
}

/** Service client, AFTER every object is gone: the row (its versions cascade), then document.purged as the system. */
export async function purgeDocumentRow(db: SupabaseClient, doc: PurgeCandidate): Promise<boolean> {
  const { data, error } = await db.from("documents").delete()
    .eq("account_id", doc.account_id).eq("id", doc.id).not("deleted_at", "is", null).select("id");
  if (error) throw new Error(`purgeDocumentRow failed: ${error.message}`);
  if ((data ?? []).length === 0) return false;
  await emitAfter(db, doc.account_id, "document.purged", "documents-sweep",
    { documentId: doc.id, ...recordPayload(doc) }, "system");
  return true;
}

/** Owner's request client (RLS-safe): how many documents a delete of these contacts takes with it, trashed ones included. A null count is a failure, never zero (memory "head-count null"). */
export async function countContactDocuments(db: SupabaseClient, accountId: string, contactIds: readonly string[]): Promise<number> {
  let total = 0;
  for (let i = 0; i < contactIds.length; i += 100) {
    const { count, error } = await db.from("documents").select("id", { count: "exact", head: true })
      .eq("account_id", accountId).in("contact_id", [...contactIds.slice(i, i + 100)]);
    if (error) throw new Error(`countContactDocuments failed: ${error.message}`);
    if (count === null) throw new Error("countContactDocuments: the count came back null");
    total += count;
  }
  return total;
}

export type ContactPurge = { purgedDocuments: number; keptContacts: string[] };

/**
 * Service client, BEFORE the contacts are deleted (owner ruling 2026-10-13: a customer's files go
 * with them; plan deviation 2 states the order). Per document: every version's object out of the
 * bucket (ONE remove call), then the row (its versions cascade), then document.purged with actor
 * `user`. A failed remove or row delete keeps that CONTACT: its remaining documents are not touched,
 * the ids are logged, and it is answered in keptContacts, so the caller does not delete it. Removing
 * an object that is already gone is not an error (plan A4), so a retry finishes what a failure left.
 * Never throws after the first deletion; unread contacts come back as kept. A read that fails before
 * any object was removed throws (nothing is gone, so "try again" is true); once one has been removed,
 * a failed read keeps the contacts of that chunk and of every later one, logged, and the answer is
 * returned, so the caller reports what really happened (the NO ACTION FK still guards those contacts).
 */
export async function purgeContactDocuments(
  db: SupabaseClient, accountId: string, contactIds: readonly string[], actorId: string,
): Promise<ContactPurge> {
  const kept = new Set<string>();
  let purged = 0;
  // Set once any object has left the bucket or any row is deleted: from then on a throw would tell the
  // caller nothing went.
  let removedAny = false;
  for (let i = 0; i < contactIds.length; i += 100) {
    // Read EVERY document of this chunk first (paged, so PostgREST's row cap can never truncate it
    // silently), then delete: deleting while paging would shift the pages.
    type Row = { id: string; contact_id: string; versions: { storage_path: string }[] | null };
    const rows: Row[] = [];
    try {
      for (let from = 0; ; from += 500) {
        const { data, error } = await db.from("documents")
          .select("id, contact_id, versions:document_versions!document_versions_document_fkey(storage_path)")
          .eq("account_id", accountId).in("contact_id", [...contactIds.slice(i, i + 100)])
          // A stable total order (the primary key) for the paging: without it two pages may overlap or skip
          // rows. Nothing is deleted until every page is read, so the ranges cannot shift under the loop.
          .order("id").range(from, from + 499);
        if (error) throw new Error(`purgeContactDocuments (read) failed: ${error.message}`);
        const page = (data ?? []) as unknown as Row[];
        rows.push(...page);
        if (page.length < 500) break;
      }
    } catch (e) {
      if (!removedAny) throw e;
      const unread = contactIds.slice(i);
      for (const id of unread) kept.add(id);
      console.error(`purgeContactDocuments: account ${accountId}: ${(e as Error).message}; after ${purged} purged, ${unread.length} contact(s) not read are kept: ${unread.join(",")}`);
      break;
    }
    for (const d of rows) {
      if (kept.has(d.contact_id)) continue;
      const paths = (d.versions ?? []).map((v) => v.storage_path);
      if (paths.length > 0) {
        const { error: rm } = await db.storage.from(DOCUMENT_BUCKET).remove(paths);
        if (rm) {
          kept.add(d.contact_id);
          console.error(`purgeContactDocuments: account ${accountId} contact ${d.contact_id} document ${d.id}: objects not removed, contact kept: ${rm.message}`);
          continue;
        }
        removedAny = true;
      }
      const { data: gone, error: del } = await db.from("documents").delete().eq("account_id", accountId).eq("id", d.id).select("id");
      if (del) {
        kept.add(d.contact_id);
        console.error(`purgeContactDocuments: account ${accountId} contact ${d.contact_id} document ${d.id}: objects removed but the row was not, contact kept for the retry: ${del.message}`);
        continue;
      }
      // A row another purge already took is not this purge's: neither counted nor announced.
      if ((gone ?? []).length === 0) continue;
      removedAny = true;
      purged++;
      await emitAfter(db, accountId, "document.purged", actorId, { documentId: d.id, contactId: d.contact_id });
    }
  }
  return { purgedDocuments: purged, keptContacts: [...kept] };
}

export type TimelineDocument = {
  id: string; title: string; category: DocumentCategory; source: DocumentSource; created_by: string;
  created_at: string; deleted_at: string | null; contact_id: string | null; client_group_id: string | null;
};
const TIMELINE_COLS = "id, title, category, source, created_by, created_at, deleted_at, contact_id, client_group_id";

/**
 * The timeline's documents source (plan deviation 3): one row per listed document, at created_at, on
 * the caller's client so RLS decides. `who` is one contact (`.eq`) or a group's members (`.in`); a
 * group page also passes its own id, and the group's own documents are a second page-read, merged by
 * record.ts (which sorts and slices every source together).
 */
export async function listDocumentTimeline(
  db: SupabaseClient, accountId: string, who: string | readonly string[], groupId: string | null, page: TimelinePageOpts,
): Promise<TimelineDocument[]> {
  const base = () => db.from("documents").select(TIMELINE_COLS).eq("account_id", accountId).not("current_version_id", "is", null);
  const reads = [withTimelinePage(forContacts(base(), "contact_id", who), "created_at", page)];
  if (groupId) reads.push(withTimelinePage(base().eq("client_group_id", groupId), "created_at", page));
  const results = await Promise.all(reads);
  const out: TimelineDocument[] = [];
  for (const { data, error } of results) {
    if (error) throw new Error(`listDocumentTimeline failed: ${error.message}`);
    out.push(...((data ?? []) as TimelineDocument[]));
  }
  return out;
}

export type TimelineDocumentVersion = {
  id: string; document_id: string; title: string; category: DocumentCategory; uploaded_by: string;
  created_at: string; deleted_at: string | null; contact_id: string | null; client_group_id: string | null;
};
const VERSION_TIMELINE_COLS = "id, document_id, title, category, uploaded_by, created_at, deleted_at, contact_id, client_group_id";

/**
 * The timeline's new-version rows (owner ruling R2; plan deviation 6): 0078's view, one row per ready
 * version after a document's first, on the caller's REQUEST client (security_invoker: RLS decides).
 * Paged exactly as listDocumentTimeline, on the version's created_at and its own id. A group page
 * also reads the group's own files; record.ts merges, sorts and slices every source together.
 */
export async function listDocumentVersionTimeline(
  db: SupabaseClient, accountId: string, who: string | readonly string[], groupId: string | null, page: TimelinePageOpts,
): Promise<TimelineDocumentVersion[]> {
  const base = () => db.from("document_version_timeline").select(VERSION_TIMELINE_COLS).eq("account_id", accountId);
  const reads = [withTimelinePage(forContacts(base(), "contact_id", who), "created_at", page)];
  if (groupId) reads.push(withTimelinePage(base().eq("client_group_id", groupId), "created_at", page));
  const results = await Promise.all(reads);
  const out: TimelineDocumentVersion[] = [];
  for (const { data, error } of results) {
    if (error) throw new Error(`listDocumentVersionTimeline failed: ${error.message}`);
    out.push(...((data ?? []) as TimelineDocumentVersion[]));
  }
  return out;
}
