"use server";

import { createHash } from "node:crypto";
import { requireAccountAccess } from "@/lib/auth";
import { dbForRequest } from "@/lib/db";
import {
  serviceDb, getContact, readGroup, getDocument, getDocumentVersion, getUploadingVersion, createDocument,
  reserveDocumentVersion, markDocumentVersionReady, discardDocumentUpload, updateDocumentField, setDocumentOwnersOnly,
  trashDocument, restoreDocument, listDocumentVersionStates, claimDocumentForPurge, deletePurgedDocument, DOCUMENT_PURGING_MARK, DOCUMENT_BUCKET, DOCUMENT_MAX_BYTES, isDocumentCategory, isDocumentContentType,
  type SupabaseClient, type DocumentRecordRef, type DocumentContentType, type DocumentRow,
} from "@bis/db";
import { isUuid } from "@/lib/assign/action-guards";
import { loggableError } from "@/lib/loggable-error";
import { validateInlineRule } from "@/lib/inline-rule";
import { extensionAllowed, extensionForType, isDay, OFFICE_TYPES, purgeNameKey, shownSize } from "@/lib/documents/rules";
import { checkDocumentBytes } from "@/lib/documents/content-check";

/**
 * The document vault's actions (spec 5.1). Every one: requireAccountAccess, then a REQUEST-client
 * read that returns the record or the document (RLS: the record's visibility, the Technician fence,
 * Owners only), and only then a write on the service client, scoped to the same account (0053;
 * in-account-service-reads.test.ts lists this file as proven-target). Every answer is a messages.ts
 * KEY with params, never translated text: the card translates it in the reader's language. Ids from
 * the browser are lowercased (PostgREST echoes them lowercase) and every payload is re-validated.
 * Storage paths are the server's (0077's reserve_document_version mints them; the CHECK on
 * document_versions pins their shape), never the browser's. Nothing throws out of an action except
 * requireAccountAccess's redirect (this tree's convention).
 */
export type DocRecordArg = { kind: "contact" | "group"; id: string };
export type DocFail = { ok: false; error: string; params?: Record<string, string | number> };
export type StartUploadInput = {
  record: DocRecordArg; name: string; title: string; size: number; contentType: string;
  category: string; expiresOn: string | null; ownersOnly: boolean; source: "upload" | "camera";
};
export type DocumentUndo = { documentId: string; field: "title" | "category" | "expires_on"; prior: string | null; written: string | null };

const fail = (error: string, params?: Record<string, string | number>): DocFail => (params ? { ok: false, error, params } : { ok: false, error });
const REFUSED = "documents.error.refused";
const FAILED = "documents.error.failed";
const TITLE_RULE = { kind: "text", max: 200, required: true } as const;
/** Spec 4.3: a URL lives 120 seconds and is minted again on demand. */
const URL_SECONDS = 120;

function log(where: string, accountId: string, e: unknown): void {
  console.error(`documents ${where} (account ${accountId}): ${loggableError(e)}`);
}
const isRecordObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

function recordOf(raw: unknown): DocumentRecordRef | null {
  if (!isRecordObj(raw) || !isUuid(raw.id)) return null;
  const id = raw.id.toLowerCase();
  return raw.kind === "contact" ? { kind: "contact", id } : raw.kind === "group" ? { kind: "group", id } : null;
}

async function recordVisible(db: SupabaseClient, accountId: string, r: DocumentRecordRef): Promise<boolean> {
  return r.kind === "group" ? Boolean(await readGroup(db, accountId, r.id)) : Boolean(await getContact(db, accountId, r.id));
}

/** The request-client proof for an existing document: visible to the caller (RLS), optionally not in the trash. */
async function visibleDocument(accountId: string, documentId: string, live: boolean): Promise<DocumentRow | null> {
  const doc = await getDocument(await dbForRequest(), accountId, documentId);
  if (!doc) return null;
  return live && doc.deleted_at !== null ? null : doc;
}

/** One field's value as the database will store it, or not ok when it is not one. */
function cleanField(field: DocumentUndo["field"], raw: unknown): { ok: true; value: string | null } | { ok: false } {
  if (field === "title") {
    if (typeof raw !== "string") return { ok: false };
    const r = validateInlineRule(TITLE_RULE, raw);
    return r.ok ? { ok: true, value: r.value } : { ok: false };
  }
  if (field === "category") return isDocumentCategory(raw) ? { ok: true, value: raw } : { ok: false };
  if (raw === null || raw === "") return { ok: true, value: null };
  return isDay(raw) ? { ok: true, value: raw } : { ok: false };
}

export async function startDocumentUploadAction(
  accountId: string, input: StartUploadInput,
): Promise<{ ok: true; documentId: string; versionId: string; uploadUrl: string } | DocFail> {
  const access = await requireAccountAccess(accountId);
  if (!isRecordObj(input)) return fail(REFUSED);
  const record = recordOf(input.record);
  if (!record) return fail(REFUSED);
  if (input.ownersOnly === true && !access.canManage) return fail("documents.error.ownersOnlyRole");
  if (!Number.isInteger(input.size) || input.size < 1) return fail("documents.error.upload");
  if (input.size > DOCUMENT_MAX_BYTES) return fail("documents.error.tooLarge", { size: shownSize(input.size) });
  if (typeof input.name !== "string" || !extensionAllowed(input.name) || !isDocumentContentType(input.contentType)) {
    return fail("documents.error.badType");
  }
  const contentType: DocumentContentType = input.contentType;
  const title = typeof input.title === "string" ? validateInlineRule(TITLE_RULE, input.title) : null;
  if (!title?.ok || !isDocumentCategory(input.category) || !(input.expiresOn === null || isDay(input.expiresOn))
    || (input.source !== "upload" && input.source !== "camera") || typeof input.ownersOnly !== "boolean") {
    return fail(REFUSED);
  }
  try {
    if (!(await recordVisible(await dbForRequest(), accountId, record))) return fail("documents.error.notFound");
  } catch (e) {
    log("start: record read", accountId, e);
    return fail("documents.error.upload");
  }
  const svc = serviceDb();
  let documentId: string | null = null;
  try {
    documentId = await createDocument(svc, {
      accountId, record, title: title.value, category: input.category, expiresOn: input.expiresOn,
      ownersOnly: input.ownersOnly, source: input.source, createdBy: access.userId,
    });
    const r = await reserveDocumentVersion(svc, {
      accountId, documentId, bytes: input.size, contentType,
      originalName: input.name.slice(0, 255) || null, uploadedBy: access.userId,
    });
    if (r.status !== "ok") {
      await discardDocumentUpload(svc, accountId, documentId, null);
      return r.status === "over_quota" ? fail("documents.error.quota")
        : r.status === "too_large" ? fail("documents.error.tooLarge", { size: shownSize(input.size) })
        : fail(REFUSED);
    }
    const { data, error } = await svc.storage.from(DOCUMENT_BUCKET).createSignedUploadUrl(r.storagePath);
    if (error || !data) {
      // Nothing was uploaded yet: the reservation and the empty document go now (the catch below repeats the document's).
      await discardDocumentUpload(svc, accountId, documentId, r.versionId);
      throw new Error(`createSignedUploadUrl: ${error?.message ?? "no data"}`);
    }
    return { ok: true, documentId, versionId: r.versionId, uploadUrl: data.signedUrl };
  } catch (e) {
    log("start", accountId, e);
    if (documentId) await discardDocumentUpload(svc, accountId, documentId, null).catch((x: unknown) => log("start: cleanup", accountId, x));
    return fail("documents.error.upload");
  }
}

export type StartVersionInput = { name: string; size: number; contentType: string };

/**
 * "Upload new version" (spec 3.3, 4.1): the same reserve-then-PUT-then-finish journey as a first upload,
 * on an EXISTING listed document. The request-client read proves the caller sees the file (RLS: the
 * record's visibility, the Technician fence, Owners only); a file still on its first upload (never
 * listed) or in the trash gets no new version (plan deviation 2; the finish step re-checks the trash).
 * "Listed" is current_version_id set, which 0077's documents_current_is_ready trigger allows only on a
 * READY version: refusing here is what keeps "the first ready version is the oldest" true (0078's
 * comment names the app as its enforcer).
 * The version's bytes count against the quota from the reservation on (0077's reserve_document_version).
 * A refused reservation touches nothing; a failure after it removes only the new reservation, never the
 * document (discardDocumentUpload keeps a document that has a current version).
 */
export async function startDocumentVersionUploadAction(
  accountId: string, documentId: string, input: StartVersionInput,
): Promise<{ ok: true; documentId: string; versionId: string; uploadUrl: string } | DocFail> {
  const access = await requireAccountAccess(accountId);
  if (!isUuid(documentId) || !isRecordObj(input)) return fail(REFUSED);
  if (!Number.isInteger(input.size) || input.size < 1) return fail("documents.error.upload");
  if (input.size > DOCUMENT_MAX_BYTES) return fail("documents.error.tooLarge", { size: shownSize(input.size) });
  if (typeof input.name !== "string" || !extensionAllowed(input.name) || !isDocumentContentType(input.contentType)) {
    return fail("documents.error.badType");
  }
  const contentType: DocumentContentType = input.contentType;
  const docId = documentId.toLowerCase();
  let doc: DocumentRow | null = null;
  try {
    doc = await visibleDocument(accountId, docId, false);
  } catch (e) {
    log("start version: document read", accountId, e);
    return fail("documents.error.upload");
  }
  if (!doc || doc.current_version_id === null) return fail(REFUSED);
  if (doc.deleted_at !== null) return fail("documents.error.trashed");
  const svc = serviceDb();
  let versionId: string | null = null;
  try {
    const r = await reserveDocumentVersion(svc, {
      accountId, documentId: docId, bytes: input.size, contentType,
      originalName: input.name.slice(0, 255) || null, uploadedBy: access.userId,
    });
    if (r.status !== "ok") {
      return r.status === "over_quota" ? fail("documents.error.quota")
        : r.status === "too_large" ? fail("documents.error.tooLarge", { size: shownSize(input.size) })
        : fail(REFUSED);
    }
    versionId = r.versionId;
    const { data, error } = await svc.storage.from(DOCUMENT_BUCKET).createSignedUploadUrl(r.storagePath);
    if (error || !data) throw new Error(`createSignedUploadUrl: ${error?.message ?? "no data"}`);
    return { ok: true, documentId: docId, versionId: r.versionId, uploadUrl: data.signedUrl };
  } catch (e) {
    log("start version", accountId, e);
    // Nothing was uploaded yet: only the new reservation goes; the document and its ready versions stay.
    if (versionId) await discardDocumentUpload(svc, accountId, docId, versionId).catch((x: unknown) => log("start version: cleanup", accountId, x));
    return fail("documents.error.upload");
  }
}

/**
 * Removes a refused or failed upload: the object first, then the rows (spec 5.1 step 3). Never throws.
 * If the object cannot be removed, the rows are LEFT: the version stays `uploading`, so it still counts
 * against the quota and the sweep (passes/documents-sweep.ts) removes object and rows once it is older
 * than its cutoff. Deleting the rows first would strand an object nothing could find.
 */
async function cleanUp(svc: SupabaseClient, accountId: string, documentId: string, versionId: string, path: string): Promise<void> {
  const { error } = await svc.storage.from(DOCUMENT_BUCKET).remove([path]);
  if (error) {
    log(`cleanup: object ${path} not removed, rows kept for the sweep`, accountId, error);
    return;
  }
  await discardDocumentUpload(svc, accountId, documentId, versionId).catch((e: unknown) => log("cleanup: rows", accountId, e));
}

/** The media type storage holds for the object: lowercased, any ";" parameter dropped. */
const mediaType = (t: string): string => t.split(";")[0]!.trim().toLowerCase();

export async function finishDocumentUploadAction(accountId: string, documentId: string, versionId: string): Promise<{ ok: true } | DocFail> {
  const access = await requireAccountAccess(accountId);
  if (!isUuid(documentId) || !isUuid(versionId)) return fail(REFUSED);
  const docId = documentId.toLowerCase();
  const verId = versionId.toLowerCase();
  let doc: DocumentRow | null = null;
  try {
    doc = await visibleDocument(accountId, docId, false);
  } catch (e) {
    log("finish: document read", accountId, e);
    return fail("documents.error.upload");
  }
  if (!doc) return fail(REFUSED);
  const svc = serviceDb();
  try {
    const version = await getUploadingVersion(svc, accountId, docId, verId);
    if (!version) {
      // No uploading row. If NO row of that id exists at all (the sweep took it, or a refused finish
      // or an abandon cleaned it up after removing its object), an object the browser PUT afterwards
      // could still sit at the path the server reserved: remove that OBJECT only. A row that exists (already ready) is never touched, and no row is: a
      // crafted finish(document, random id) must never delete a teammate's document whose own upload
      // is still in flight. The sweep owns rows.
      if (!(await getDocumentVersion(svc, accountId, verId))) {
        const { error } = await svc.storage.from(DOCUMENT_BUCKET).remove([`${accountId}/${docId}/${verId}`]);
        if (error) log("finish: orphan object", accountId, error);
      }
      return fail(REFUSED);
    }
    // A version is never added to a file in the trash (plan deviation 2): trashed after this upload's
    // start, its object and its reservation go now, object first (cleanUp), and the file keeps the
    // versions it had. A trash that commits after this read is the serial order "ready, then trashed".
    if (doc.deleted_at !== null) {
      await cleanUp(svc, accountId, docId, verId, version.storage_path);
      return fail("documents.error.trashed");
    }
    const { data: blob, error } = await svc.storage.from(DOCUMENT_BUCKET).download(version.storage_path);
    if (error || !blob) {
      // No object (or no answer from storage): the rows are LEFT uploading (review M2). The signed
      // upload URL lives 2 hours, so a PUT still in flight could land after this; with its rows gone
      // nothing would ever find that object. The sweep removes object and rows together once the URL
      // has expired (its cutoff is later than the URL life), and the reservation counts against the
      // quota until then.
      log("finish: object not downloadable, rows left for the sweep", accountId, error ?? "no data");
      return fail("documents.error.upload");
    }
    const bytes = new Uint8Array(await blob.arrayBuffer());
    // Spec 3.5/5.1 (plan review I2): the stored size must be the RESERVED size, or a client that
    // understated it would slip past the quota. The reserved size is at most 25 MiB, so this also caps it.
    if (bytes.length !== version.bytes) {
      await cleanUp(svc, accountId, docId, verId, version.storage_path);
      return fail("documents.error.upload");
    }
    // The type storage holds for the object must be the declared one, and the bytes must be that type.
    if (mediaType(blob.type) !== version.content_type || checkDocumentBytes(bytes, version.content_type) !== "ok") {
      await cleanUp(svc, accountId, docId, verId, version.storage_path);
      return fail("documents.error.badType");
    }
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    const ok = await markDocumentVersionReady(svc, { accountId, documentId: docId, versionId: verId, bytes: bytes.length, sha256, actorId: access.userId });
    // false: the database refused (size_mismatch, or the row is no longer uploading because another
    // finish made it ready). Nothing is removed here: the object may be that ready version's. A
    // reservation still uploading is the sweep's.
    return ok ? { ok: true } : fail(REFUSED);
  } catch (e) {
    log("finish", accountId, e);
    return fail("documents.error.upload");
  }
}

/** The browser's PUT failed: remove what start reserved now, rather than waiting for the clean-up pass. */
export async function abandonDocumentUploadAction(accountId: string, documentId: string, versionId: string): Promise<{ ok: true } | DocFail> {
  await requireAccountAccess(accountId);
  if (!isUuid(documentId) || !isUuid(versionId)) return fail(REFUSED);
  const docId = documentId.toLowerCase();
  const verId = versionId.toLowerCase();
  try {
    if (!(await visibleDocument(accountId, docId, false))) return fail(REFUSED);
    const svc = serviceDb();
    const version = await getUploadingVersion(svc, accountId, docId, verId);
    if (version) await cleanUp(svc, accountId, docId, verId, version.storage_path);
    return { ok: true };
  } catch (e) {
    log("abandon", accountId, e);
    return fail(FAILED);
  }
}

export async function getDocumentUrlAction(
  accountId: string, versionId: string, mode: "view" | "download",
): Promise<{ ok: true; url: string; contentType: DocumentContentType } | DocFail> {
  await requireAccountAccess(accountId);
  if (!isUuid(versionId) || (mode !== "view" && mode !== "download")) return fail(REFUSED);
  try {
    const db = await dbForRequest();
    const version = await getDocumentVersion(db, accountId, versionId.toLowerCase());
    // Opening is not changing: a file the reader cannot see (or one not uploaded yet) is "not found" (review M6).
    if (!version || version.status !== "ready") return fail("documents.error.fileNotFound");
    const doc = await getDocument(db, accountId, version.document_id);
    if (!doc) return fail("documents.error.fileNotFound");
    // Word and Excel are never rendered (spec 4.3): always a download, named after the title.
    const download = mode === "download" || OFFICE_TYPES.includes(version.content_type);
    const { data, error } = await serviceDb().storage.from(DOCUMENT_BUCKET).createSignedUrl(
      version.storage_path, URL_SECONDS, download ? { download: `${doc.title}.${extensionForType(version.content_type)}` } : undefined);
    if (error || !data) throw new Error(`createSignedUrl: ${error?.message ?? "no data"}`);
    return { ok: true, url: data.signedUrl, contentType: version.content_type };
  } catch (e) {
    log("url", accountId, e);
    return fail("documents.error.open");
  }
}

const FIELDS: readonly DocumentUndo["field"][] = ["title", "category", "expires_on"];
const isField = (v: unknown): v is DocumentUndo["field"] => (FIELDS as readonly unknown[]).includes(v);

export async function updateDocumentFieldAction(
  accountId: string, documentId: string, field: DocumentUndo["field"], raw: string,
): Promise<{ ok: true; shown: string; undoPayload: DocumentUndo } | DocFail> {
  await requireAccountAccess(accountId);
  if (!isUuid(documentId) || !isField(field)) return fail(REFUSED);
  const value = cleanField(field, raw);
  if (!value.ok) return fail(REFUSED);
  const docId = documentId.toLowerCase();
  try {
    const doc = await visibleDocument(accountId, docId, true);
    if (!doc) return fail(REFUSED);
    const r = await updateDocumentField(serviceDb(), accountId, docId, field, value.value);
    if (r === "changed") return fail(REFUSED);
    return { ok: true, shown: value.value ?? "", undoPayload: { documentId: docId, field, prior: doc[field], written: value.value } };
  } catch (e) {
    log(`edit ${field}`, accountId, e);
    return fail(FAILED);
  }
}

export async function undoDocumentFieldAction(accountId: string, payload: unknown): Promise<{ ok: true } | DocFail> {
  await requireAccountAccess(accountId);
  if (!isRecordObj(payload) || !isUuid(payload.documentId) || !isField(payload.field)) return fail(REFUSED);
  const field = payload.field;
  const prior = cleanField(field, payload.prior);
  const written = cleanField(field, payload.written);
  if (!prior.ok || !written.ok) return fail(REFUSED);
  const docId = payload.documentId.toLowerCase();
  try {
    if (!(await visibleDocument(accountId, docId, true))) return fail(REFUSED);
    const r = await updateDocumentField(serviceDb(), accountId, docId, field, prior.value, { value: written.value });
    return r === "updated" ? { ok: true } : fail("documents.undoChanged");
  } catch (e) {
    log(`undo ${field}`, accountId, e);
    return fail(FAILED);
  }
}

export async function setOwnersOnlyAction(accountId: string, documentId: string, value: boolean): Promise<{ ok: true; prior: boolean } | DocFail> {
  const access = await requireAccountAccess(accountId);
  if (!access.canManage) return fail("documents.error.ownersOnlyRole");
  if (!isUuid(documentId) || typeof value !== "boolean") return fail(REFUSED);
  const docId = documentId.toLowerCase();
  try {
    const doc = await visibleDocument(accountId, docId, true);
    if (!doc) return fail(REFUSED);
    const r = await setDocumentOwnersOnly(serviceDb(), accountId, docId, value);
    return r === "updated" ? { ok: true, prior: doc.owners_only } : fail(REFUSED);
  } catch (e) {
    log("owners only", accountId, e);
    return fail(FAILED);
  }
}

export async function undoOwnersOnlyAction(accountId: string, documentId: string, prior: boolean, written: boolean): Promise<{ ok: true } | DocFail> {
  const access = await requireAccountAccess(accountId);
  if (!access.canManage) return fail("documents.error.ownersOnlyRole");
  if (!isUuid(documentId) || typeof prior !== "boolean" || typeof written !== "boolean") return fail(REFUSED);
  const docId = documentId.toLowerCase();
  try {
    if (!(await visibleDocument(accountId, docId, true))) return fail(REFUSED);
    const r = await setDocumentOwnersOnly(serviceDb(), accountId, docId, prior, written);
    return r === "updated" ? { ok: true } : fail("documents.undoChanged");
  } catch (e) {
    log("undo owners only", accountId, e);
    return fail(FAILED);
  }
}

export async function trashDocumentAction(accountId: string, documentId: string): Promise<{ ok: true; deletedAt: string } | DocFail> {
  const access = await requireAccountAccess(accountId);
  if (!isUuid(documentId)) return fail(REFUSED);
  const docId = documentId.toLowerCase();
  try {
    if (!(await visibleDocument(accountId, docId, true))) return fail(REFUSED);
    const r = await trashDocument(serviceDb(), accountId, docId, access.userId);
    return r.status === "trashed" ? { ok: true, deletedAt: r.deletedAt } : fail(REFUSED);
  } catch (e) {
    log("trash", accountId, e);
    return fail(FAILED);
  }
}

const isInstant = (v: unknown): v is string => typeof v === "string" && v.length <= 40 && !Number.isNaN(Date.parse(v));

export async function restoreDocumentAction(accountId: string, documentId: string, expectedDeletedAt: string): Promise<{ ok: true } | DocFail> {
  const access = await requireAccountAccess(accountId);
  if (!isUuid(documentId) || !isInstant(expectedDeletedAt)) return fail(REFUSED);
  const docId = documentId.toLowerCase();
  try {
    if (!(await visibleDocument(accountId, docId, false))) return fail(REFUSED);
    const r = await restoreDocument(serviceDb(), accountId, docId, expectedDeletedAt, access.userId);
    return r === "updated" ? { ok: true } : fail("documents.undoChanged");
  } catch (e) {
    log("restore", accountId, e);
    return fail(FAILED);
  }
}

/**
 * Delete forever (spec 3.4, 4.4, 5.1; DESIGN.md "Documents": only a typed name confirms a PERMANENT purge,
 * and that confirmation is never shared with the trash move). An Owner or the agency only (owner ruling
 * R1). The request-client read proves the
 * caller sees the file and that it is in the trash; the typed name must equal its title in `purgeNameKey`'s form (plan
 * deviation 8). Then, on the service client: refuse while any version is still uploading (deviation
 * 3); claim the row (deviation 4) so a racing Restore changes nothing; remove EVERY version's object;
 * only then delete the row (its versions cascade) and emit document.purged as the person. A storage
 * refusal keeps the row, still in the trash; nothing is deleted that still has an object.
 * A lost claim or a delete that matched nothing is re-read on the service client: no row at all means a
 * concurrent Delete forever finished this file first, and a row carrying DOCUMENT_PURGING_MARK means one
 * holds it now (it re-claimed from the marker). The file being gone, or going, is what was asked, so the
 * answer is success, never "changed" or "try again" (task 4 review I2, M1).
 */
export async function purgeDocumentAction(accountId: string, documentId: string, typedTitle: string): Promise<{ ok: true } | DocFail> {
  const access = await requireAccountAccess(accountId);
  // Owner ruling R1 (2026-10-14; spec 3.4): Owners and the agency only, the Owners-only rule (setOwnersOnlyAction).
  if (!access.canManage) return fail("documents.error.purgeRole");
  if (!isUuid(documentId) || typeof typedTitle !== "string") return fail(REFUSED);
  const docId = documentId.toLowerCase();
  try {
    const doc = await visibleDocument(accountId, docId, false);
    if (!doc || doc.deleted_at === null) return fail(REFUSED);
    if (purgeNameKey(typedTitle) !== purgeNameKey(doc.title)) return fail("documents.purge.mismatch");
    const svc = serviceDb();
    // Gone, or another Delete forever holds it (its claim marker): the file is deleted or being deleted.
    const alreadyGone = async (): Promise<boolean> => {
      const now = await getDocument(svc, accountId, docId);
      return now === null || now.deleted_by === DOCUMENT_PURGING_MARK;
    };
    const versions = await listDocumentVersionStates(svc, accountId, docId);
    if (versions.some((v) => v.status === "uploading")) return fail("documents.error.purgeUploading");
    const claimedAt = await claimDocumentForPurge(svc, accountId, docId, doc.deleted_at);
    if (!claimedAt) return (await alreadyGone()) ? { ok: true } : fail("documents.error.purgeChanged");
    const paths = versions.map((v) => v.storage_path);
    if (paths.length > 0) {
      const { error } = await svc.storage.from(DOCUMENT_BUCKET).remove(paths);
      if (error) {
        log(`purge: objects not removed, the file stays in the trash (${docId})`, accountId, error);
        return fail("documents.error.purge");
      }
    }
    if (!(await deletePurgedDocument(svc, accountId, doc, claimedAt, access.userId))) {
      if (await alreadyGone()) return { ok: true };
      log(`purge: objects removed but the row was no longer the claimed one (${docId})`, accountId, "row moved");
      return fail("documents.error.purge");
    }
    return { ok: true };
  } catch (e) {
    log("purge", accountId, e);
    return fail("documents.error.purge");
  }
}
