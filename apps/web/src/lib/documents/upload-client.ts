import { DOCUMENT_MAX_BYTES, isDocumentContentType, type DocumentCategory, type DocumentContentType } from "@bis/db/document-rules";
import {
  startDocumentUploadAction, finishDocumentUploadAction, abandonDocumentUploadAction, type DocRecordArg,
} from "@/app/(dashboard)/dashboard/accounts/[accountId]/contacts/documents-actions";
import { typeForFile, isImageType, formatMb } from "./rules";
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
  if (blob.size > DOCUMENT_MAX_BYTES) return refusal("documents.error.tooLarge", { size: formatMb(blob.size, "en") });
  if (blob.size < 1) return refusal("documents.error.upload");
  return { ok: true, blob, contentType };
}

export async function uploadOne(
  accountId: string, item: UploadItem, batch: UploadBatch, deps: UploadDeps, onPhase: (p: UploadPhase) => void,
): Promise<UploadPhase> {
  const failed = (r: Refusal): UploadPhase => (r.params ? { kind: "failed", error: r.error, params: r.params } : { kind: "failed", error: r.error });
  const prepared = await prepareFile(item.file, deps.strip);
  if (!prepared.ok) return failed(prepared);
  const started = await deps.start(accountId, {
    record: batch.record, name: item.file.name, title: item.title, size: prepared.blob.size, contentType: prepared.contentType,
    category: item.category, expiresOn: batch.expiresOn, ownersOnly: batch.ownersOnly, source: batch.source,
  }).catch((): Refusal => refusal("documents.error.upload"));
  if (!started.ok) return failed(started);
  onPhase({ kind: "uploading", percent: 0 });
  const put = await deps.put(started.uploadUrl, prepared.blob, prepared.contentType, (percent) => onPhase({ kind: "uploading", percent }))
    .catch(() => false);
  if (!put) {
    await deps.abandon(accountId, started.documentId, started.versionId).catch(() => undefined);
    return { kind: "failed", error: "documents.error.upload" };
  }
  onPhase({ kind: "checking" });
  const finished = await deps.finish(accountId, started.documentId, started.versionId).catch((): Refusal => refusal("documents.error.upload"));
  return finished.ok ? { kind: "done" } : failed(finished);
}

/** Browser only: XHR, because fetch reports no upload progress. */
export function xhrPut(url: string, body: Blob, contentType: string, onProgress: (percent: number) => void): Promise<boolean> {
  return new Promise((resolve) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    xhr.setRequestHeader("content-type", contentType);
    xhr.setRequestHeader("x-upsert", "false");
    xhr.setRequestHeader("cache-control", "max-age=3600");
    xhr.upload.onprogress = (e) => { if (e.lengthComputable) onProgress(Math.min(100, Math.round((e.loaded / e.total) * 100))); };
    xhr.onload = () => resolve(xhr.status >= 200 && xhr.status < 300);
    xhr.onerror = () => resolve(false);
    xhr.onabort = () => resolve(false);
    xhr.send(body);
  });
}

export const browserDeps = (): UploadDeps => ({
  start: startDocumentUploadAction, finish: finishDocumentUploadAction, abandon: abandonDocumentUploadAction,
  put: xhrPut, strip: stripImage,
});
