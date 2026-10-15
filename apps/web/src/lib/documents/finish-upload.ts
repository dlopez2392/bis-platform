import { createHash } from "node:crypto";
import {
  getUploadingVersion, getDocumentVersion, markDocumentVersionReady, discardDocumentUpload, DOCUMENT_BUCKET,
  type SupabaseClient, type ActorType,
} from "@bis/db";
import { loggableError } from "@/lib/loggable-error";
import { checkDocumentBytes } from "@/lib/documents/content-check";
import { scanVersion, type ScanResult } from "@/lib/documents/scan-version";

/**
 * The finish step's body (spec 5.1 of part 1; 3.4 of part 2): shared by the staff action, after its
 * request-client proof, and by the customer route (S-07 2b), after its token proof. `svc` is the
 * caller's service client; every read and write is scoped to `accountId`. The object is checked
 * (size = the reservation, the stored type = the declared one, the bytes that type), hashed, marked
 * ready as the caller's actor, and scanned at once with holdErrors: the finish NEVER spends an
 * attempt (2a re-review N2a). Answers a documents.error.* key; never throws.
 */
type Finish = { ok: true; scan: ScanResult } | { ok: false; error: string };
const REFUSED = "documents.error.refused";

function log(where: string, accountId: string, e: unknown): void {
  console.error(`documents ${where} (account ${accountId}): ${loggableError(e)}`);
}
/** The media type storage holds for the object: lowercased, any ";" parameter dropped. */
const mediaType = (t: string): string => t.split(";")[0]!.trim().toLowerCase();

/**
 * Removes a refused or failed upload: the object first, then the rows (spec 5.1 step 3). Never throws.
 * If the object cannot be removed, the rows are LEFT: the version stays `uploading`, so it still counts
 * against the quota and the sweep (passes/documents-sweep.ts) removes object and rows once it is older
 * than its cutoff. Deleting the rows first would strand an object nothing could find.
 */
export async function cleanUpUpload(svc: SupabaseClient, accountId: string, documentId: string, versionId: string, path: string): Promise<void> {
  const { error } = await svc.storage.from(DOCUMENT_BUCKET).remove([path]);
  if (error) {
    log(`cleanup: object ${path} not removed, rows kept for the sweep`, accountId, error);
    return;
  }
  await discardDocumentUpload(svc, accountId, documentId, versionId).catch((e: unknown) => log("cleanup: rows", accountId, e));
}

export async function finishStoredUpload(svc: SupabaseClient, a: {
  accountId: string; documentId: string; versionId: string; trashed: boolean; actorId: string; actorType?: ActorType;
}): Promise<Finish> {
  const { accountId, documentId: docId, versionId: verId } = a;
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
      return { ok: false, error: REFUSED };
    }
    // A version is never added to a file in the trash (plan deviation 2): trashed after this upload's
    // start, its object and its reservation go now, object first (cleanUpUpload), and the file keeps the
    // versions it had. A trash that commits after this read is the serial order "ready, then trashed".
    if (a.trashed) {
      await cleanUpUpload(svc, accountId, docId, verId, version.storage_path);
      return { ok: false, error: "documents.error.trashed" };
    }
    const { data: blob, error } = await svc.storage.from(DOCUMENT_BUCKET).download(version.storage_path);
    if (error || !blob) {
      // No object (or no answer from storage): the rows are LEFT uploading (review M2). The signed
      // upload URL lives 2 hours, so a PUT still in flight could land after this; with its rows gone
      // nothing would ever find that object. The sweep removes object and rows together once the URL
      // has expired (its cutoff is later than the URL life), and the reservation counts against the
      // quota until then.
      log("finish: object not downloadable, rows left for the sweep", accountId, error ?? "no data");
      return { ok: false, error: "documents.error.upload" };
    }
    const bytes = new Uint8Array(await blob.arrayBuffer());
    // Spec 3.5/5.1 (plan review I2): the stored size must be the RESERVED size, or a client that
    // understated it would slip past the quota. The reserved size is at most 25 MiB, so this also caps it.
    if (bytes.length !== version.bytes) {
      await cleanUpUpload(svc, accountId, docId, verId, version.storage_path);
      return { ok: false, error: "documents.error.upload" };
    }
    // The type storage holds for the object must be the declared one, and the bytes must be that type.
    if (mediaType(blob.type) !== version.content_type || checkDocumentBytes(bytes, version.content_type) !== "ok") {
      await cleanUpUpload(svc, accountId, docId, verId, version.storage_path);
      return { ok: false, error: "documents.error.badType" };
    }
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    const ok = await markDocumentVersionReady(svc, { accountId, documentId: docId, versionId: verId, bytes: bytes.length, sha256, actorId: a.actorId, actorType: a.actorType });
    // false: the database refused (size_mismatch, or the row is no longer uploading because another
    // finish made it ready). Nothing is removed here: the object may be that ready version's. A
    // reservation still uploading is the sweep's.
    if (!ok) return { ok: false, error: REFUSED };
    // Spec 3.4: scanned at once, so a file normally reads "Checking" for a second or two only. A scan
    // that fails never fails the upload: the file is stored, stays Checking, and the retry pass
    // (passes/documents-scan.ts) scans it. A fresh version has spent no attempt.
    // Re-review N2a: the finish NEVER spends an attempt (holdErrors): only the retry pass does, after the
    // worker's self-test passes again in its own run.
    const scan = await scanVersion(svc, { accountId, versionId: verId, storagePath: version.storage_path, attempts: 0 }, undefined, { holdErrors: true })
      .catch((e: unknown): ScanResult => { log("finish: scan", accountId, e); return "pending"; });
    return { ok: true, scan };
  } catch (e) {
    log("finish", accountId, e);
    return { ok: false, error: "documents.error.upload" };
  }
}
