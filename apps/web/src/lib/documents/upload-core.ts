import { DOCUMENT_MAX_BYTES, isDocumentContentType, type DocumentContentType } from "@bis/db/document-rules";
import { typeForFile, isImageType, shownSize } from "./rules";
import type { ImageType } from "./strip-image";

/**
 * The browser half of one file's upload that does not depend on WHO is uploading (moved out of
 * upload-client.ts, S-07 2b): prepare a file (re-encode an image, check its type and its size AS
 * STORED) and PUT its bytes to a signed upload URL with progress. Browser-safe; no server action is
 * imported here, so a public page can use it (S-07 2b).
 */
export type Refusal = { ok: false; error: string; params?: Record<string, string | number> };
export const refusal = (error: string, params?: Record<string, string | number>): Refusal => (params ? { ok: false, error, params } : { ok: false, error });

export async function prepareFile(file: File, strip: (file: Blob, type: ImageType) => Promise<Blob>): Promise<{ ok: true; blob: Blob; contentType: DocumentContentType } | Refusal> {
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
