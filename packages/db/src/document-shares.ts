import type { SupabaseClient } from "@supabase/supabase-js";
import { forContacts, withTimelinePage, type TimelinePageOpts } from "./timeline-cursor";
import type { DocumentCategory, DocumentContentType } from "./document-rules";
import type { DocumentRecordRef, ScanStatus } from "./documents";

/**
 * Share links (0085; spec 4). READS take the caller's client: on a request client RLS decides (a share
 * is visible exactly when its document is); the public tree passes the service client AFTER proving
 * the token, and every read below then carries the token row's own account, document and version.
 * WRITES take the service client a server action holds after its request-client proof (0053). Only
 * sha256(token) is ever stored or read here, and no read here returns it. THROWS on a read or write error.
 */
export const DOCUMENT_SHARE_HOURS = 24;
const HOUR_MS = 3_600_000;

export type DocumentShareRow = {
  id: string; account_id: string; document_id: string; version_id: string; created_by: string; created_at: string;
  expires_at: string; revoked_at: string | null; revoked_by: string | null; first_opened_at: string | null; open_count: number;
};
const SHARE_COLS = "id, account_id, document_id, version_id, created_by, created_at, expires_at, revoked_at, revoked_by, first_opened_at, open_count";

export type CreateShareOutcome = { status: "ok"; share: DocumentShareRow } | { status: "changed" };

/**
 * Service client. created_at and expires_at from ONE instant, so 0085's document_shares_expiry holds exactly.
 * `ownersOnly` is the value the action's request-client read saw. The share stands only while the
 * document still has that value and is not in the trash; otherwise the new row is deleted and the
 * answer is "changed" (the O2 race: an Owner switching the file to Owners only, whose revoke ran
 * between this action's read and its insert, must not leave a live Staff link behind).
 * Why insert-then-check closes it (PostgREST has no conditional insert, and each request is its own
 * transaction): the check reads AFTER the insert committed. If the Owner's switch committed before the
 * check's snapshot, the check sees it and deletes the row. If it committed after, the Owner's revoke
 * runs later still, so its snapshot includes this committed row and revokes it.
 */
export async function createDocumentShare(db: SupabaseClient, a: {
  accountId: string; documentId: string; versionId: string; tokenHash: string; createdBy: string; ownersOnly: boolean; now: Date;
}): Promise<CreateShareOutcome> {
  const { data, error } = await db.from("document_shares").insert({
    account_id: a.accountId, document_id: a.documentId, version_id: a.versionId, token_hash: a.tokenHash, created_by: a.createdBy,
    created_at: a.now.toISOString(), expires_at: new Date(a.now.getTime() + DOCUMENT_SHARE_HOURS * HOUR_MS).toISOString(),
  }).select(SHARE_COLS).single();
  if (error) throw new Error(`createDocumentShare failed: ${error.message}`);
  const row = data as DocumentShareRow;
  const drop = async () => {
    const { error: delErr } = await db.from("document_shares").delete().eq("account_id", a.accountId).eq("id", row.id);
    if (delErr) throw new Error(`createDocumentShare (withdraw ${row.id}) failed: ${delErr.message}`);
  };
  const { data: still, error: checkErr } = await db.from("documents").select("id")
    .eq("account_id", a.accountId).eq("id", a.documentId).eq("owners_only", a.ownersOnly).is("deleted_at", null).maybeSingle();
  if (checkErr) {
    // The link never leaves this function unproved: withdraw it before failing.
    await drop();
    throw new Error(`createDocumentShare (check) failed: ${checkErr.message}`);
  }
  if (!still) {
    await drop();
    return { status: "changed" };
  }
  return { status: "ok", share: row };
}

/** The public tree's first read: by the token's hash alone (the hash is the proof). */
export async function findDocumentShareByTokenHash(db: SupabaseClient, tokenHash: string): Promise<DocumentShareRow | null> {
  const { data, error } = await db.from("document_shares").select(SHARE_COLS).eq("token_hash", tokenHash).maybeSingle();
  if (error) throw new Error(`findDocumentShareByTokenHash failed: ${error.message}`);
  return (data as DocumentShareRow | null) ?? null;
}

export type DocumentShareLife = "open" | "expired" | "revoked";
/** Revoked first (someone stopped it), then expired; computed, never written. */
export function documentShareState(s: Pick<DocumentShareRow, "revoked_at" | "expires_at">, now: Date): DocumentShareLife {
  if (s.revoked_at !== null) return "revoked";
  return Date.parse(s.expires_at) <= now.getTime() ? "expired" : "open";
}

export type ShareTarget = {
  document: { id: string; title: string; deleted_at: string | null };
  version: { id: string; content_type: DocumentContentType; bytes: number; status: "uploading" | "ready"; scan_status: ScanStatus };
};
/**
 * The shared file and the SHARED version (never the current one: spec 6), each read with the token
 * row's account, document and version ids. null when either is gone.
 */
export async function getShareTarget(
  db: SupabaseClient, s: Pick<DocumentShareRow, "account_id" | "document_id" | "version_id">,
): Promise<ShareTarget | null> {
  const [doc, ver] = await Promise.all([
    db.from("documents").select("id, title, deleted_at").eq("account_id", s.account_id).eq("id", s.document_id).maybeSingle(),
    db.from("document_versions").select("id, content_type, bytes, status, scan_status")
      .eq("account_id", s.account_id).eq("document_id", s.document_id).eq("id", s.version_id).maybeSingle(),
  ]);
  if (doc.error) throw new Error(`getShareTarget (document) failed: ${doc.error.message}`);
  if (ver.error) throw new Error(`getShareTarget (version) failed: ${ver.error.message}`);
  if (!doc.data || !ver.data) return null;
  const v = ver.data as ShareTarget["version"];
  return { document: doc.data as ShareTarget["document"], version: { ...v, bytes: Number(v.bytes) } };
}

/** Plan deviation 3: the card's "Shared" line, the latest live expiry per document of one record, from the view (RLS decides). */
const MAX_LIVE_SHARES_READ = 1000;
export async function listLiveDocumentShares(
  db: SupabaseClient, accountId: string, record: DocumentRecordRef, now: Date,
): Promise<Record<string, string>> {
  const { data, error } = await db.from("document_share_timeline").select("document_id, expires_at")
    .eq("account_id", accountId).eq(record.kind === "contact" ? "contact_id" : "client_group_id", record.id)
    .is("revoked_at", null).gt("expires_at", now.toISOString()).is("deleted_at", null)
    .order("expires_at", { ascending: false }).limit(MAX_LIVE_SHARES_READ);
  if (error) throw new Error(`listLiveDocumentShares failed: ${error.message}`);
  const out: Record<string, string> = {};
  for (const r of (data ?? []) as { document_id: string; expires_at: string }[]) {
    if (!Object.hasOwn(out, r.document_id)) out[r.document_id] = r.expires_at;
  }
  return out;
}

/**
 * Service client. Stop sharing, and ruling O2's revoke when a file goes Owners only: every LIVE share
 * of this document, one compare-and-set; null when none was live.
 */
export async function revokeDocumentShares(
  db: SupabaseClient, accountId: string, documentId: string, actorId: string, now: Date,
): Promise<{ ids: string[]; revokedAt: string } | null> {
  const at = now.toISOString();
  const { data, error } = await db.from("document_shares").update({ revoked_at: at, revoked_by: actorId })
    .eq("account_id", accountId).eq("document_id", documentId).is("revoked_at", null).gt("expires_at", at)
    .select("id, revoked_at");
  if (error) throw new Error(`revokeDocumentShares failed: ${error.message}`);
  const rows = (data ?? []) as { id: string; revoked_at: string }[];
  return rows.length === 0 ? null : { ids: rows.map((r) => r.id), revokedAt: rows[0]!.revoked_at };
}

/** Service client. Undo: exactly THOSE shares, THAT revoke (its stored time and author), each only while unexpired. */
export async function restoreDocumentShares(db: SupabaseClient, a: {
  accountId: string; documentId: string; ids: readonly string[]; revokedAt: string; actorId: string; now: Date;
}): Promise<number> {
  if (a.ids.length === 0) return 0;
  const { data, error } = await db.from("document_shares").update({ revoked_at: null, revoked_by: null })
    .eq("account_id", a.accountId).eq("document_id", a.documentId).in("id", [...a.ids])
    .eq("revoked_at", a.revokedAt).eq("revoked_by", a.actorId).gt("expires_at", a.now.toISOString()).select("id");
  if (error) throw new Error(`restoreDocumentShares failed: ${error.message}`);
  return (data ?? []).length;
}

/** 0085: past the link's total cap (p_link_max) the claim answers closed; rate_limited is the per-address window only. */
export type ShareClaim = { status: "ok"; first: boolean } | { status: "not_found" | "closed" | "rate_limited" };
/** Service client: public.claim_document_share_download (0085). THROWS on an RPC error (a limit below 1 is one: 22023) or an answer it does not know. */
export async function claimDocumentShareDownload(db: SupabaseClient, a: {
  accountId: string; shareId: string; ipHash: string; max: number; windowSeconds: number; linkMax: number;
}): Promise<ShareClaim> {
  const { data, error } = await db.rpc("claim_document_share_download", {
    p_account_id: a.accountId, p_share_id: a.shareId, p_ip_hash: a.ipHash, p_max: a.max, p_window_seconds: a.windowSeconds, p_link_max: a.linkMax,
  });
  if (error) throw new Error(`claimDocumentShareDownload failed: ${error.message}`);
  const r = data as { status: string; first?: unknown };
  if (r.status === "ok" && typeof r.first === "boolean") return { status: "ok", first: r.first };
  if (r.status === "not_found" || r.status === "closed" || r.status === "rate_limited") return { status: r.status };
  throw new Error(`claimDocumentShareDownload: unexpected answer ${JSON.stringify(r.status)}`);
}

export type ReadyVersionScan = { id: string; scan_status: ScanStatus; created_at: string };
/** Every READY version of one document, newest first (created_at, then id), on the CALLER's client (RLS decides). */
export async function listReadyVersionScans(db: SupabaseClient, accountId: string, documentId: string): Promise<ReadyVersionScan[]> {
  const { data, error } = await db.from("document_versions").select("id, scan_status, created_at")
    .eq("account_id", accountId).eq("document_id", documentId).eq("status", "ready")
    .order("created_at", { ascending: false }).order("id", { ascending: false }).limit(200);
  if (error) throw new Error(`listReadyVersionScans failed: ${error.message}`);
  return (data ?? []) as ReadyVersionScan[];
}

export type Shareable = { kind: "clean"; versionId: string } | { kind: "pending" | "removed" };
/**
 * Ruling R-V: the version a link shares is the one the reader SEES, by documentView's own rule
 * (apps/web/src/lib/documents/document-view.ts:36-38): the newest clean ready version; with none clean,
 * the current version decides the refusal (pending -> still being checked, else removed). `versions`
 * is listReadyVersionScans' answer, newest first. Pure.
 */
export function shareableVersion(versions: readonly ReadyVersionScan[], currentVersionId: string | null): Shareable {
  const clean = versions.find((v) => v.scan_status === "clean");
  if (clean) return { kind: "clean", versionId: clean.id };
  const current = versions.find((v) => v.id === currentVersionId) ?? versions[0];
  return !current || current.scan_status === "pending" ? { kind: "pending" } : { kind: "removed" };
}

export type TimelineDocumentShare = {
  id: string; document_id: string; title: string; category: DocumentCategory; created_by: string; created_at: string;
  first_opened_at: string | null; contact_id: string | null; client_group_id: string | null; deleted_at: string | null;
};
const SHARE_TIMELINE_COLS = "id, document_id, title, category, created_by, created_at, first_opened_at, contact_id, client_group_id, deleted_at";

/**
 * The timeline's share rows (plan deviation 4), on the caller's client so RLS decides: each share at its
 * created_at, and each OPENED share again at its first_opened_at (2c's skip/un-skip shape). A group page
 * also reads the group's own files.
 */
export async function listDocumentShareTimeline(
  db: SupabaseClient, accountId: string, who: string | readonly string[], groupId: string | null, page: TimelinePageOpts,
): Promise<{ shares: TimelineDocumentShare[]; opens: TimelineDocumentShare[] }> {
  const base = () => db.from("document_share_timeline").select(SHARE_TIMELINE_COLS).eq("account_id", accountId);
  const opened = () => base().not("first_opened_at", "is", null);
  const shareReads = [withTimelinePage(forContacts(base(), "contact_id", who), "created_at", page)];
  const openReads = [withTimelinePage(forContacts(opened(), "contact_id", who), "first_opened_at", page)];
  if (groupId) {
    shareReads.push(withTimelinePage(base().eq("client_group_id", groupId), "created_at", page));
    openReads.push(withTimelinePage(opened().eq("client_group_id", groupId), "first_opened_at", page));
  }
  const [s, o] = await Promise.all([Promise.all(shareReads), Promise.all(openReads)]);
  const rows = (results: typeof s, what: string) => results.flatMap(({ data, error }) => {
    if (error) throw new Error(`listDocumentShareTimeline (${what}) failed: ${error.message}`);
    return (data ?? []) as TimelineDocumentShare[];
  });
  return { shares: rows(s, "shares"), opens: rows(o, "opens") };
}
