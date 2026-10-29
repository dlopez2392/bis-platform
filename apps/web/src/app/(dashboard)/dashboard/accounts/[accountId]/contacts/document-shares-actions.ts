"use server";

import { headers } from "next/headers";
import { unstable_rethrow } from "next/navigation";
import { requireAccountAccess } from "@/lib/auth";
import { noteOpened } from "@/lib/access-log/note";
import { dbForRequest } from "@/lib/db";
import {
  serviceDb, getDocument, listReadyVersionScans, shareableVersion, createDocumentShare, revokeDocumentShares, restoreDocumentShares,
  type DocumentRow,
} from "@bis/db";
import { isUuid } from "@/lib/assign/action-guards";
import { loggableError } from "@/lib/loggable-error";
import { originFrom } from "@/lib/email/origin";
import { tokenHash } from "@/lib/document-requests/token";
import { newShareToken, shareUrl } from "@/lib/document-shares/share-token";
import type { DocFail } from "./documents-actions";

/**
 * Share links (spec 4.1, E3). Every action: requireAccountAccess, then a REQUEST-client read of the
 * document (RLS: the record's visibility, the Technician fence, Owners only), and only then the service
 * client, scoped to the same account and document (0053; listed proven-target in
 * in-account-service-reads.test.ts). An Owners-only file is shared or stopped by an Owner or the agency
 * only (E3), checked here as well as by RLS. The shared version is the one the reader SEES, computed here
 * by documentView's rule (ruling R-V: the newest clean ready version), never taken from the browser. The
 * write carries the Owners-only value this action's read saw, and the share stands only while the file
 * still holds it (the O2 race; createDocumentShare). The link is built once and never stored or logged:
 * only its sha256 is kept. Answers are messages.ts keys.
 */
const fail = (error: string): DocFail => ({ ok: false, error });
const REFUSED = "documents.share.refused";
const FAILED = "documents.share.failed";
const ROLE = "documents.share.ownersOnlyRole";
/** Undo found nothing to bring back: every link expired, or the file changed since the stop. */
const ENDED = "documents.share.ended";
const MAX_UNDO_IDS = 50;

/** Names the account and the document: never the token or the link. */
function log(where: string, accountId: string, e: unknown, documentId: string): void {
  console.error(`document shares ${where} (account ${accountId}, document ${documentId}): ${loggableError(e)}`);
}

/** The proof: the document under the caller's RLS, and the Owners-only rule (E3). */
async function provenDocument(accountId: string, documentId: string, canManage: boolean): Promise<DocumentRow | string> {
  const doc = await getDocument(await dbForRequest(), accountId, documentId);
  if (!doc) return REFUSED;
  if (doc.owners_only && !canManage) return ROLE;
  return doc;
}

export async function createDocumentShareAction(accountId: string, documentId: string): Promise<{ ok: true; url: string } | DocFail> {
  const access = await requireAccountAccess(accountId);
  if (!isUuid(documentId)) return fail(REFUSED);
  const docId = documentId.toLowerCase();
  try {
    const doc = await provenDocument(accountId, docId, access.canManage);
    if (typeof doc === "string") return fail(doc);
    if (doc.deleted_at !== null) return fail("documents.error.trashed");
    // Ruling R-V: the version the reader sees, read on the request client, by documentView's own rule.
    const pick = shareableVersion(await listReadyVersionScans(await dbForRequest(), accountId, doc.id), doc.current_version_id);
    if (pick.kind !== "clean") return fail(pick.kind === "pending" ? "documents.error.scanning" : "documents.error.removed");
    const origin = originFrom(await headers());
    if (!origin) return fail(FAILED);
    // F-118 part 1 (spec 4.1, review I1): a share link opens the file with no sign-in, so MAKING one
    // is a file open — logged BEFORE the token is minted, never after the write.
    await noteOpened(access, accountId, { kind: "document_share", recordId: doc.id });
    const token = newShareToken();
    const r = await createDocumentShare(serviceDb(), {
      accountId, documentId: doc.id, versionId: pick.versionId, tokenHash: tokenHash(token), createdBy: access.userId,
      ownersOnly: doc.owners_only, now: new Date(),
    });
    // "changed": the file went Owners only or to the trash after the read; the row was withdrawn.
    if (r.status !== "ok") return fail(REFUSED);
    return { ok: true, url: shareUrl(origin, token) };
  } catch (e) {
    unstable_rethrow(e);
    log("create", accountId, e, docId);
    return fail(FAILED);
  }
}

/**
 * Stop sharing: every live link of the file. The answer is the Undo's payload: the ids and the instant
 * this stop wrote, and the file's Owners-only value as THIS read saw it (restoreDocumentShares brings
 * nothing back on a file that has changed since).
 */
export async function stopSharingAction(
  accountId: string, documentId: string,
): Promise<{ ok: true; ids: string[]; revokedAt: string; ownersOnly: boolean } | DocFail> {
  const access = await requireAccountAccess(accountId);
  if (!isUuid(documentId)) return fail(REFUSED);
  const docId = documentId.toLowerCase();
  try {
    const doc = await provenDocument(accountId, docId, access.canManage);
    if (typeof doc === "string") return fail(doc);
    const r = await revokeDocumentShares(serviceDb(), accountId, doc.id, access.userId, new Date());
    return r ? { ok: true, ids: r.ids, revokedAt: r.revokedAt, ownersOnly: doc.owners_only } : fail("documents.share.notShared");
  } catch (e) {
    log("stop", accountId, e, docId);
    return fail("documents.error.failed");
  }
}

const isInstant = (v: unknown): v is string => typeof v === "string" && v.length <= 40 && !Number.isNaN(Date.parse(v));

/**
 * Undo (rule 6): exactly the links THIS caller's stop wrote, at that instant, while each is unexpired.
 * The payload comes back from the browser, so nothing in it is trusted: the action reads the document
 * on the request client itself (visibility, and the Owners-only role rule against the file as it is
 * NOW), and a payload whose Owners-only value is not what the file holds now is refused with no write.
 */
export async function undoStopSharingAction(
  accountId: string, documentId: string, ids: unknown, revokedAt: unknown, ownersOnly: unknown,
): Promise<{ ok: true } | DocFail> {
  const access = await requireAccountAccess(accountId);
  if (!isUuid(documentId) || !Array.isArray(ids) || ids.length === 0 || ids.length > MAX_UNDO_IDS || !ids.every(isUuid)
    || !isInstant(revokedAt) || typeof ownersOnly !== "boolean") {
    return fail(REFUSED);
  }
  const docId = documentId.toLowerCase();
  try {
    const doc = await provenDocument(accountId, docId, access.canManage);
    if (typeof doc === "string") return fail(doc);
    if (doc.owners_only !== ownersOnly) return fail(ENDED);
    // Orchestrator ruling M1: the payload's value is the browser's, so it cannot tell "already Owners only
    // when stopped" from "switched to Owners only since" (an Owner could post true after the switch and
    // bring Staff's links back). Decided here: an Owners-only file changed after the stop gets nothing
    // back. Any edit stamps updated_at, so this over-refuses; that is acceptable for an Undo.
    // What it does NOT stop (final review minor 3): the Owners-only switch revokes the links itself, so an
    // Owner replaying THAT revoke's own payload passes (updated_at T1 is not after its revokedAt T2). That is
    // not an escalation: only an Owner or the agency gets past provenDocument on an Owners-only file at all,
    // and they may share that file afresh anyway.
    if (doc.owners_only && Date.parse(doc.updated_at) > Date.parse(revokedAt)) return fail(ENDED);
    const r = await restoreDocumentShares(serviceDb(), {
      accountId, documentId: doc.id, ids: ids.map((i) => i.toLowerCase()), revokedAt, actorId: access.userId,
      ownersOnly: doc.owners_only, now: new Date(),
    });
    return r.status === "restored" && r.count > 0 ? { ok: true } : fail(ENDED);
  } catch (e) {
    log("undo stop", accountId, e, docId);
    return fail("documents.error.failed");
  }
}
