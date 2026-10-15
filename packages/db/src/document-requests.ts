import type { SupabaseClient } from "@supabase/supabase-js";
import { emit, type ActorType } from "./events";
import { forContacts, withTimelinePage, type TimelinePageOpts, type TimelineCursor } from "./timeline-cursor";
import {
  DOCUMENT_REQUEST_DAYS, type DocumentContentType, type DocumentRequestChannel, type DocumentRequestItem,
} from "./document-rules";
import type { DocumentRecordRef, ScanStatus } from "./documents";

/**
 * Customer upload links (0080; spec section 4). READS take the caller's client (RLS decides on a
 * request client; the public routes hold the service client after proving the token, and pass the
 * request's own account and id to every query). WRITES take the service client. token_hash is
 * written once and read only as a lookup key: no read here returns it. THROWS on a read or write
 * error, as documents.ts does.
 */
export type DocumentRequestRow = {
  id: string; account_id: string; contact_id: string | null; client_group_id: string | null;
  items: DocumentRequestItem[]; language: "en" | "es"; channel: DocumentRequestChannel; created_by: string;
  created_at: string; expires_at: string; revoked_at: string | null; revoked_by: string | null; completed_at: string | null;
  /** Re-review R1: set just before a send is handed to the provider; null when nothing went out. */
  sent_at: string | null;
};
const REQUEST_COLS = "id, account_id, contact_id, client_group_id, items, language, channel, created_by, created_at, expires_at, revoked_at, revoked_by, completed_at, sent_at";
const DAY_MS = 86_400_000;

export async function createDocumentRequest(db: SupabaseClient, a: {
  id: string; accountId: string; record: DocumentRecordRef; items: DocumentRequestItem[]; language: "en" | "es";
  tokenHash: string; channel: DocumentRequestChannel; createdBy: string; now: Date;
}): Promise<DocumentRequestRow> {
  const created = a.now.toISOString();
  const { data, error } = await db.from("document_requests").insert({
    id: a.id, account_id: a.accountId,
    contact_id: a.record.kind === "contact" ? a.record.id : null,
    client_group_id: a.record.kind === "group" ? a.record.id : null,
    items: a.items, language: a.language, token_hash: a.tokenHash, channel: a.channel, created_by: a.createdBy,
    created_at: created, expires_at: new Date(a.now.getTime() + DOCUMENT_REQUEST_DAYS * DAY_MS).toISOString(),
  }).select(REQUEST_COLS).single();
  if (error) throw new Error(`createDocumentRequest failed: ${error.message}`);
  return data as DocumentRequestRow;
}

/** The public routes' first read: the request whose token hashes to this, in any account (the token IS the proof). */
export async function findDocumentRequestByTokenHash(db: SupabaseClient, tokenHash: string): Promise<DocumentRequestRow | null> {
  const { data, error } = await db.from("document_requests").select(REQUEST_COLS).eq("token_hash", tokenHash).maybeSingle();
  if (error) throw new Error(`findDocumentRequestByTokenHash failed: ${error.message}`);
  return (data as DocumentRequestRow | null) ?? null;
}

export async function getDocumentRequest(db: SupabaseClient, accountId: string, requestId: string): Promise<DocumentRequestRow | null> {
  const { data, error } = await db.from("document_requests").select(REQUEST_COLS).eq("account_id", accountId).eq("id", requestId).maybeSingle();
  if (error) throw new Error(`getDocumentRequest failed: ${error.message}`);
  return (data as DocumentRequestRow | null) ?? null;
}

export type RequestStartOutcome =
  | { status: "ok"; documentId: string; versionId: string; storagePath: string }
  | { status: "not_found" | "revoked" | "completed" | "expired" | "no_item" | "rate_limited" | "over_quota" | "too_large" };
const START_REFUSALS = new Set(["not_found", "revoked", "completed", "expired", "no_item", "rate_limited", "over_quota", "too_large"]);

/** Service client. 0080's start_document_request_upload: the request locked and re-proved open, the record and category its own. */
export async function startDocumentRequestUpload(db: SupabaseClient, a: {
  accountId: string; requestId: string; itemKey: string; bytes: number; contentType: DocumentContentType; originalName: string | null; title: string;
}): Promise<RequestStartOutcome> {
  const { data, error } = await db.rpc("start_document_request_upload", {
    p_account_id: a.accountId, p_request_id: a.requestId, p_item_key: a.itemKey, p_bytes: a.bytes,
    p_content_type: a.contentType, p_original_name: a.originalName, p_title: a.title,
  });
  if (error) throw new Error(`startDocumentRequestUpload failed: ${error.message}`);
  const r = data as { status: string; document_id?: string; version_id?: string; storage_path?: string };
  if (r.status === "ok" && r.document_id && r.version_id && r.storage_path) {
    return { status: "ok", documentId: r.document_id, versionId: r.version_id, storagePath: r.storage_path };
  }
  if (START_REFUSALS.has(r.status)) return { status: r.status as Exclude<RequestStartOutcome["status"], "ok"> };
  throw new Error(`startDocumentRequestUpload: unexpected answer ${JSON.stringify(r.status)}`);
}

export type RequestDocument = { id: string; account_id: string; request_id: string; request_item_key: string; deleted_at: string | null };

/** The customer finish's proof: THIS request's file in THIS account, or null. */
export async function getRequestDocument(db: SupabaseClient, accountId: string, requestId: string, documentId: string): Promise<RequestDocument | null> {
  const { data, error } = await db.from("documents").select("id, account_id, request_id, request_item_key, deleted_at")
    .eq("account_id", accountId).eq("request_id", requestId).eq("id", documentId).maybeSingle();
  if (error) throw new Error(`getRequestDocument failed: ${error.message}`);
  return (data as RequestDocument | null) ?? null;
}

export type RequestFile = {
  documentId: string; itemKey: string; versionId: string; ready: boolean; scanStatus: ScanStatus; scanSignature: string | null; createdAt: string;
};
type FileRow = {
  id: string; request_item_key: string; created_at: string;
  versions: { id: string; status: "uploading" | "ready"; scan_status: ScanStatus; scan_signature: string | null; created_at: string }[];
};

/** The customer page's read: each non-trashed file of the request with its NEWEST version, oldest file first. */
export async function listRequestFiles(db: SupabaseClient, accountId: string, requestId: string): Promise<RequestFile[]> {
  const { data, error } = await db.from("documents")
    .select("id, request_item_key, created_at, versions:document_versions!document_versions_document_fkey(id, status, scan_status, scan_signature, created_at)")
    .eq("account_id", accountId).eq("request_id", requestId).is("deleted_at", null)
    .order("created_at", { ascending: true }).order("id", { ascending: true });
  if (error) throw new Error(`listRequestFiles failed: ${error.message}`);
  const out: RequestFile[] = [];
  for (const d of (data ?? []) as FileRow[]) {
    const v = [...d.versions].sort((x, y) => (x.created_at < y.created_at ? 1 : x.created_at > y.created_at ? -1 : 0))[0];
    if (!v) continue;
    out.push({ documentId: d.id, itemKey: d.request_item_key, versionId: v.id, ready: v.status === "ready", scanStatus: v.scan_status, scanSignature: v.scan_signature, createdAt: v.created_at });
  }
  return out;
}

export type OpenDocumentRequest = {
  id: string; items: (DocumentRequestItem & { answered: boolean })[]; channel: DocumentRequestChannel; createdAt: string; expiresAt: string;
};

/** The card's read: this record's OPEN requests (not revoked, not completed, not expired), newest first, each item answered or not. */
export async function listOpenDocumentRequests(db: SupabaseClient, accountId: string, record: DocumentRecordRef, now: Date): Promise<OpenDocumentRequest[]> {
  const { data, error } = await db.from("document_requests").select(REQUEST_COLS)
    .eq("account_id", accountId).eq(record.kind === "contact" ? "contact_id" : "client_group_id", record.id)
    .is("revoked_at", null).is("completed_at", null).gt("expires_at", now.toISOString())
    .order("created_at", { ascending: false }).limit(50);
  if (error) throw new Error(`listOpenDocumentRequests failed: ${error.message}`);
  const rows = (data ?? []) as DocumentRequestRow[];
  if (rows.length === 0) return [];
  // `.eq("account_id", accountId)` here is defense-in-depth, not the only guard: `rows` already came
  // from the account-scoped read above, and `documents_request_fkey` ties every document's account_id
  // to its OWN request's account_id (0080), so a request_id from `rows` can only ever match documents
  // already in this account. Confirmed empirically (plan review fix round): dropping this filter alone
  // leaves every test in this file green.
  const { data: docs, error: docErr } = await db.from("documents")
    .select("request_id, request_item_key, versions:document_versions!document_versions_document_fkey(status, scan_status)")
    .eq("account_id", accountId).in("request_id", rows.map((r) => r.id)).is("deleted_at", null);
  if (docErr) throw new Error(`listOpenDocumentRequests (files) failed: ${docErr.message}`);
  const answered = new Set<string>();
  for (const d of (docs ?? []) as { request_id: string; request_item_key: string; versions: { status: string; scan_status: string }[] }[]) {
    if (d.versions.some((v) => v.status === "ready" && v.scan_status === "clean")) answered.add(`${d.request_id}/${d.request_item_key}`);
  }
  return rows.map((r) => ({
    id: r.id, channel: r.channel, createdAt: r.created_at, expiresAt: r.expires_at,
    items: r.items.map((i) => ({ ...i, answered: answered.has(`${r.id}/${i.key}`) })),
  }));
}

/** Service client. Revokes an OPEN request (compare-and-set); null when it was not open. */
export async function revokeDocumentRequest(db: SupabaseClient, accountId: string, requestId: string, actorId: string, now: Date): Promise<{ revokedAt: string } | null> {
  const { data, error } = await db.from("document_requests").update({ revoked_at: now.toISOString(), revoked_by: actorId })
    .eq("account_id", accountId).eq("id", requestId).is("revoked_at", null).is("completed_at", null).gt("expires_at", now.toISOString())
    .select("revoked_at").maybeSingle();
  if (error) throw new Error(`revokeDocumentRequest failed: ${error.message}`);
  return data ? { revokedAt: (data as { revoked_at: string }).revoked_at } : null;
}

/** Service client. Undo: clears exactly THAT revoke (compare-and-set on its time). */
export async function restoreDocumentRequest(db: SupabaseClient, accountId: string, requestId: string, expectedRevokedAt: string): Promise<boolean> {
  const { data, error } = await db.from("document_requests").update({ revoked_at: null, revoked_by: null })
    .eq("account_id", accountId).eq("id", requestId).eq("revoked_at", expectedRevokedAt).select("id");
  if (error) throw new Error(`restoreDocumentRequest failed: ${error.message}`);
  return (data ?? []).length === 1;
}

export type TimelineDocumentRequest = {
  id: string; items: DocumentRequestItem[]; channel: DocumentRequestChannel; created_by: string; created_at: string;
  contact_id: string | null; client_group_id: string | null;
};
const TIMELINE_COLS = "id, items, channel, created_by, created_at, contact_id, client_group_id";

/** The timeline's request rows (plan deviation 6), on the caller's client so RLS decides; paged on created_at. */
export async function listDocumentRequestTimeline(
  db: SupabaseClient, accountId: string, who: string | readonly string[], groupId: string | null, page: TimelinePageOpts,
): Promise<TimelineDocumentRequest[]> {
  const base = () => db.from("document_requests").select(TIMELINE_COLS).eq("account_id", accountId);
  const reads = [withTimelinePage(forContacts(base(), "contact_id", who), "created_at", page)];
  if (groupId) reads.push(withTimelinePage(base().eq("client_group_id", groupId), "created_at", page));
  const results = await Promise.all(reads);
  const out: TimelineDocumentRequest[] = [];
  for (const { data, error } of results) {
    if (error) throw new Error(`listDocumentRequestTimeline failed: ${error.message}`);
    out.push(...((data ?? []) as TimelineDocumentRequest[]));
  }
  return out;
}

export type DocumentRequestTarget = {
  name: string; contactId: string | null; language: string | null; phone: string | null; email: string | null; phoneCountryUnconfirmed: boolean | null;
};
type ContactBits = { id: string; first_name: string | null; last_name: string | null; language: string | null; phone: string | null; email: string | null; phone_country_unconfirmed: boolean | null };
const CONTACT_BITS = "id, first_name, last_name, language, phone, email, phone_country_unconfirmed";
const nameOf = (c: ContactBits): string => [c.first_name, c.last_name].filter((x) => x && x.trim()).join(" ").trim();

/**
 * Who a request speaks to (plan deviation 3): a contact itself; a group by its name, delivered to its
 * primary contact. `client_group_members.is_primary_contact` (0075:51, "who we call first") is at most
 * one row per GROUP (the unique partial index `client_group_members_one_primary_contact`, 0075:52);
 * `is_primary` (0069) is a different flag — which of a CONTACT's groups is their main one — and is not
 * this read.
 */
export async function documentRequestTarget(
  db: SupabaseClient, accountId: string, ref: { contact_id: string | null; client_group_id: string | null },
): Promise<DocumentRequestTarget | null> {
  const asTarget = (name: string, c: ContactBits | null): DocumentRequestTarget => ({
    name, contactId: c?.id ?? null, language: c?.language ?? null, phone: c?.phone ?? null, email: c?.email ?? null,
    phoneCountryUnconfirmed: c?.phone_country_unconfirmed ?? null,
  });
  if (ref.contact_id) {
    const { data, error } = await db.from("contacts").select(CONTACT_BITS).eq("account_id", accountId).eq("id", ref.contact_id).maybeSingle();
    if (error) throw new Error(`documentRequestTarget failed: ${error.message}`);
    return data ? asTarget(nameOf(data as ContactBits), data as ContactBits) : null;
  }
  if (!ref.client_group_id) return null;
  const { data: g, error: gErr } = await db.from("client_groups").select("id, name").eq("account_id", accountId).eq("id", ref.client_group_id).maybeSingle();
  if (gErr) throw new Error(`documentRequestTarget (group) failed: ${gErr.message}`);
  if (!g) return null;
  const { data: m, error: mErr } = await db.from("client_group_members").select(`contact:contacts!inner(${CONTACT_BITS})`)
    .eq("account_id", accountId).eq("client_group_id", ref.client_group_id).eq("is_primary_contact", true).maybeSingle();
  if (mErr) throw new Error(`documentRequestTarget (primary contact) failed: ${mErr.message}`);
  return asTarget((g as { name: string }).name, (m as { contact: ContactBits } | null)?.contact ?? null);
}

/** Service client. The ONE To-do per request and kind (0080's tasks_document_request_once); emits task.created only when it made the row. */
export async function ensureDocumentRequestTask(
  db: SupabaseClient, accountId: string,
  input: { requestId: string; kind: "received" | "storage_full"; contactId: string | null; title: string; dueAt: string },
  actorId: string, actorType: ActorType = "system",
): Promise<{ id: string; created: boolean }> {
  const { data, error } = await db.from("tasks").insert({
    account_id: accountId, contact_id: input.contactId, title: input.title, due_at: input.dueAt,
    document_request_id: input.requestId, document_request_kind: input.kind,
  }).select("id").single();
  if (!error && data) {
    await emit(db, accountId, "task.created", actorId,
      { taskId: (data as { id: string }).id, contactId: input.contactId, documentRequestId: input.requestId }, actorType);
    return { id: (data as { id: string }).id, created: true };
  }
  if (error?.code !== "23505") throw new Error(`ensureDocumentRequestTask failed: ${error?.message ?? "no row"}`);
  const { data: found, error: readErr } = await db.from("tasks").select("id")
    .eq("account_id", accountId).eq("document_request_id", input.requestId).eq("document_request_kind", input.kind).maybeSingle();
  if (readErr || !found) throw new Error(`ensureDocumentRequestTask: already there but unreadable: ${readErr?.message ?? "no row"}`);
  return { id: (found as { id: string }).id, created: false };
}

/** The request a version's file answers, or null for a staff file. */
export async function getDocumentRequestForVersion(db: SupabaseClient, accountId: string, versionId: string): Promise<DocumentRequestRow | null> {
  const { data, error } = await db.from("document_versions").select("document:documents!document_versions_document_fkey(request_id)")
    .eq("account_id", accountId).eq("id", versionId).maybeSingle();
  if (error) throw new Error(`getDocumentRequestForVersion failed: ${error.message}`);
  const requestId = (data as { document: { request_id: string | null } | null } | null)?.document?.request_id ?? null;
  return requestId ? getDocumentRequest(db, accountId, requestId) : null;
}

/**
 * Re-review m1: requests that should have a "received" To-do and do not. Service client, every account.
 *
 * Reads the clean customer files' side, newest first, inside an 8-day window (a request lives 7 days;
 * one more for a verdict that lands late), PAGING through that side (plan review fix round, point 4):
 * each page's own requests are checked against the task table and filtered right there, so requests
 * that already carry a "received" To-do are excluded from THAT page's count rather than merely from the
 * final answer — a run of recent, already-handled requests can otherwise fill the whole page and starve
 * an older, genuinely missing one out of view. `filesPage` is a test seam (default 500, matching the
 * single-page read this replaces); production callers never set it.
 */
export async function listRequestsMissingReceivedTask(
  db: SupabaseClient, now: Date, limit: number, opts: { filesPage?: number } = {},
): Promise<DocumentRequestRow[]> {
  const filesPage = opts.filesPage ?? 500;
  const since = new Date(now.getTime() - 8 * DAY_MS).toISOString();
  const dayAgo = now.getTime() - DAY_MS;
  // Open, or completed in the last 24 hours, or expired in the last 24 hours (deviation 13: a file
  // reserved before the expiry may finish after it).
  const recent = (r: DocumentRequestRow): boolean =>
    r.completed_at ? Date.parse(r.completed_at) > dayAgo : Date.parse(r.expires_at) > dayAgo;
  const out: DocumentRequestRow[] = [];
  const seen = new Set<string>();
  let cursor: TimelineCursor | undefined;
  let guard = 0;
  let windowExhausted = false;
  for (; guard < 40 && out.length < limit; guard++) {
    const { data: files, error } = await withTimelinePage(
      db.from("documents")
        .select("id, request_id, created_at, versions:document_versions!document_versions_document_fkey!inner(id)")
        .eq("source", "customer").is("deleted_at", null).gte("created_at", since)
        .eq("versions.status", "ready").eq("versions.scan_status", "clean"),
      "created_at", { before: cursor, limit: filesPage },
    );
    if (error) throw new Error(`listRequestsMissingReceivedTask (files) failed: ${error.message}`);
    const rows = (files ?? []) as { id: string; request_id: string; created_at: string }[];
    if (rows.length === 0) { windowExhausted = true; break; }
    const last = rows[rows.length - 1]!;
    cursor = { v: last.created_at, id: last.id };
    const ids = [...new Set(rows.map((d) => d.request_id))].filter((id) => !seen.has(id));
    for (const id of ids) seen.add(id);
    for (let i = 0; i < ids.length; i += 100) {
      const batch = ids.slice(i, i + 100);
      const [reqs, tasks] = await Promise.all([
        db.from("document_requests").select(REQUEST_COLS).in("id", batch).is("revoked_at", null),
        db.from("tasks").select("document_request_id").eq("document_request_kind", "received").in("document_request_id", batch),
      ]);
      if (reqs.error) throw new Error(`listRequestsMissingReceivedTask (requests) failed: ${reqs.error.message}`);
      if (tasks.error) throw new Error(`listRequestsMissingReceivedTask (tasks) failed: ${tasks.error.message}`);
      const hasTask = new Set(((tasks.data ?? []) as { document_request_id: string }[]).map((t) => t.document_request_id));
      out.push(...((reqs.data ?? []) as DocumentRequestRow[]).filter((r) => !hasTask.has(r.id) && recent(r)));
    }
    if (rows.length < filesPage) { windowExhausted = true; break; } // this page was short: the window is exhausted
  }
  // The guard exists so a pathological backlog can't loop forever; it is only the reason older misses
  // were dropped from THIS call when the loop stopped WITHOUT the window running out AND without
  // already having found `limit` many (reaching the limit is a normal, complete answer, not a drop).
  // Said once, by function name and page count only — no request or contact ids, matching
  // documents.ts's own console.error calls (this module has none of its own yet to match instead).
  if (guard >= 40 && !windowExhausted && out.length < limit) {
    console.error(`listRequestsMissingReceivedTask: stopped after ${guard} file pages (guard cutoff); older misses may be dropped`);
  }
  // Newest first, across every page and batch (a later page's requests can sort ahead of an earlier
  // page's in `out` otherwise, since document_requests carries no ORDER BY of its own here).
  out.sort((a, b) => (a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : 0));
  return out.slice(0, limit);
}

/** Re-review R1: the at-most-once send stamp. True only for the caller that moved sent_at from null. */
export async function claimDocumentRequestSend(db: SupabaseClient, accountId: string, requestId: string, now: Date): Promise<boolean> {
  const { data, error } = await db.from("document_requests").update({ sent_at: now.toISOString() })
    .eq("account_id", accountId).eq("id", requestId).is("sent_at", null).select("id");
  if (error) throw new Error(`claimDocumentRequestSend failed: ${error.message}`);
  return (data ?? []).length === 1;
}

/** Re-review R1: the send did not go out (blocked, deferred, failed): the stamp goes, so a later send may try. */
export async function clearDocumentRequestSend(db: SupabaseClient, accountId: string, requestId: string): Promise<void> {
  const { error } = await db.from("document_requests").update({ sent_at: null }).eq("account_id", accountId).eq("id", requestId);
  if (error) throw new Error(`clearDocumentRequestSend failed: ${error.message}`);
}
