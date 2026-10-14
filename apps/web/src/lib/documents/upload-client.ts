import { DOCUMENT_MAX_BYTES, isDocumentContentType, type DocumentCategory, type DocumentContentType } from "@bis/db/document-rules";
import {
  startDocumentUploadAction, startDocumentVersionUploadAction, finishDocumentUploadAction, abandonDocumentUploadAction, type DocRecordArg,
} from "@/app/(dashboard)/dashboard/accounts/[accountId]/contacts/documents-actions";
import { typeForFile, isImageType, shownSize } from "./rules";
import { stripImage, type ImageType } from "./strip-image";

/**
 * One file's journey (spec 4.2, V6): prepare (re-encode an image, check its type and its size AS
 * STORED), start (the server reserves and answers a signed upload URL), PUT the bytes straight to
 * storage with progress (never through a function body, capped at 4.5 MB), finish (the server checks
 * the real bytes). A failed PUT gives the reservation back at once. Every failure is a messages.ts
 * key the card translates. The PUT's headers are the ones storage-js's uploadToSignedUrl sends for a
 * raw body (plan Assumption A1; read off @supabase/storage-js 2.110.8's dist/index.mjs).
 */
export type UploadPhase =
  | { kind: "uploading"; percent: number } | { kind: "checking" } | { kind: "done" }
  | { kind: "failed"; error: string; params?: Record<string, string | number> };
export type UploadBatch = { record: DocRecordArg; ownersOnly: boolean; expiresOn: string | null; source: "upload" | "camera" };
export type UploadItem = { file: File; title: string; category: DocumentCategory };
export type UploadDeps = {
  start: typeof startDocumentUploadAction; finish: typeof finishDocumentUploadAction; abandon: typeof abandonDocumentUploadAction;
  put: (url: string, body: Blob, contentType: string, onProgress: (percent: number) => void) => Promise<boolean>;
  strip: (file: Blob, type: ImageType) => Promise<Blob>;
};
type Refusal = { ok: false; error: string; params?: Record<string, string | number> };
const refusal = (error: string, params?: Record<string, string | number>): Refusal => (params ? { ok: false, error, params } : { ok: false, error });

export async function prepareFile(file: File, strip: UploadDeps["strip"]): Promise<{ ok: true; blob: Blob; contentType: DocumentContentType } | Refusal> {
  const declared = typeForFile(file.name, file.type);
  if (!declared) return refusal("documents.error.badType");
  let blob: Blob = file;
  let contentType: DocumentContentType = declared;
  if (isImageType(declared)) {
    try {
      blob = await strip(file, declared as ImageType);
    } catch {
      // Never fall back to the original: it still carries its location data.
      return refusal("documents.error.upload");
    }
    contentType = isDocumentContentType(blob.type) ? blob.type : declared;
  }
  // The size that counts is the size STORED, so it is checked after the re-encode (a 30 MB photo may fit once redrawn).
  if (blob.size > DOCUMENT_MAX_BYTES) return refusal("documents.error.tooLarge", { size: shownSize(blob.size) });
  if (blob.size < 1) return refusal("documents.error.upload");
  return { ok: true, blob, contentType };
}

type Started = { ok: true; documentId: string; versionId: string; uploadUrl: string };
const failedPhase = (r: Refusal): UploadPhase => (r.params ? { kind: "failed", error: r.error, params: r.params } : { kind: "failed", error: r.error });

/** The shared tail of both journeys: PUT with progress, give the reservation back on a failed PUT, then finish. */
async function sendAndFinish(
  accountId: string, started: Started, blob: Blob, contentType: string,
  deps: Pick<UploadDeps, "put" | "abandon" | "finish">, onPhase: (p: UploadPhase) => void,
): Promise<UploadPhase> {
  onPhase({ kind: "uploading", percent: 0 });
  const put = await deps.put(started.uploadUrl, blob, contentType, (percent) => onPhase({ kind: "uploading", percent })).catch(() => false);
  if (!put) {
    // Abandon's answer is ignored: if it fails, the reservation stays `uploading` and the documents sweep removes it.
    await deps.abandon(accountId, started.documentId, started.versionId).catch(() => undefined);
    return { kind: "failed", error: "documents.error.upload" };
  }
  onPhase({ kind: "checking" });
  const finished = await deps.finish(accountId, started.documentId, started.versionId).catch((): Refusal => refusal("documents.error.upload"));
  return finished.ok ? { kind: "done" } : failedPhase(finished);
}

export async function uploadOne(
  accountId: string, item: UploadItem, batch: UploadBatch, deps: UploadDeps, onPhase: (p: UploadPhase) => void,
): Promise<UploadPhase> {
  const prepared = await prepareFile(item.file, deps.strip);
  if (!prepared.ok) return failedPhase(prepared);
  const started = await deps.start(accountId, {
    record: batch.record, name: item.file.name, title: item.title, size: prepared.blob.size, contentType: prepared.contentType,
    category: item.category, expiresOn: batch.expiresOn, ownersOnly: batch.ownersOnly, source: batch.source,
  }).catch((): Refusal => refusal("documents.error.upload"));
  if (!started.ok) return failedPhase(started);
  return sendAndFinish(accountId, started, prepared.blob, prepared.contentType, deps, onPhase);
}

export type VersionDeps = Pick<UploadDeps, "finish" | "abandon" | "put" | "strip"> & { startVersion: typeof startDocumentVersionUploadAction };

/**
 * "Upload new version" (spec 3.3, 4.1): one file, prepared exactly as a first upload is (an image
 * re-encoded, its size checked AS STORED), reserved as a new version of `documentId`, then the same
 * PUT and finish. The finish makes it the current version once its bytes are checked (0077).
 */
export async function uploadVersion(
  accountId: string, documentId: string, file: File, deps: VersionDeps, onPhase: (p: UploadPhase) => void,
): Promise<UploadPhase> {
  const prepared = await prepareFile(file, deps.strip);
  if (!prepared.ok) return failedPhase(prepared);
  const started = await deps.startVersion(accountId, documentId, { name: file.name, size: prepared.blob.size, contentType: prepared.contentType })
    .catch((): Refusal => refusal("documents.error.upload"));
  if (!started.ok) return failedPhase(started);
  return sendAndFinish(accountId, started, prepared.blob, prepared.contentType, deps, onPhase);
}

/**
 * An upload that makes no progress for this long is abandoned, so the card can offer Retry. A stall
 * clock, not a total timeout: 25 MB on a slow phone uplink (about 1.5 Mbps) takes some 140 seconds
 * and must not be cut off while bytes are still moving.
 */
export const UPLOAD_STALL_MS = 60_000;

/**
 * Browser only: XHR, because fetch reports no upload progress. cache-control is stored with the
 * object and served back on every read; a private document is never cached by a browser or the CDN.
 */
export function xhrPut(url: string, body: Blob, contentType: string, onProgress: (percent: number) => void): Promise<boolean> {
  return new Promise((resolve) => {
    const xhr = new XMLHttpRequest();
    let stall: ReturnType<typeof setTimeout> | undefined;
    const arm = () => { clearTimeout(stall); stall = setTimeout(() => xhr.abort(), UPLOAD_STALL_MS); };
    const settle = (ok: boolean) => { clearTimeout(stall); resolve(ok); };
    xhr.open("PUT", url);
    xhr.setRequestHeader("content-type", contentType);
    xhr.setRequestHeader("x-upsert", "false");
    xhr.setRequestHeader("cache-control", "private, no-store");
    xhr.upload.onprogress = (e) => {
      arm();
      if (e.lengthComputable) onProgress(Math.min(100, Math.round((e.loaded / e.total) * 100)));
    };
    xhr.onload = () => settle(xhr.status >= 200 && xhr.status < 300);
    xhr.onerror = () => settle(false);
    xhr.onabort = () => settle(false);
    arm();
    xhr.send(body);
  });
}

export const browserDeps = (): UploadDeps => ({
  start: startDocumentUploadAction, finish: finishDocumentUploadAction, abandon: abandonDocumentUploadAction,
  put: xhrPut, strip: stripImage,
});

export const browserVersionDeps = (): VersionDeps => ({
  startVersion: startDocumentVersionUploadAction, finish: finishDocumentUploadAction, abandon: abandonDocumentUploadAction,
  put: xhrPut, strip: stripImage,
});
