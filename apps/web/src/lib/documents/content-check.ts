import type { DocumentContentType } from "@bis/db/document-rules";

/**
 * What a stored file IS, from its leading bytes (spec 5.2), never from its name or the browser's
 * word for it; validate-logo.ts's allowlist shape (lib/branding/validate-logo.ts:16-31). SVG and
 * HTML have no branch, so they are refused like everything else that is not provably one of six.
 * DOCX and XLSX are ZIPs: the central directory (whose entry names are stored uncompressed) must
 * name [Content_Types].xml and an entry under word/ or xl/ (plan deviation 7).
 */
const DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

function startsWith(b: Uint8Array, sig: readonly number[], offset = 0): boolean {
  return b.length >= offset + sig.length && sig.every((x, i) => b[offset + i] === x);
}
const u16 = (b: Uint8Array, o: number) => b[o]! | (b[o + 1]! << 8);
const u32 = (b: Uint8Array, o: number) => (b[o]! | (b[o + 1]! << 8) | (b[o + 2]! << 16) | (b[o + 3]! << 24)) >>> 0;

/** Entry names from the ZIP's central directory; null when it is not a well-formed ZIP. */
function zipEntryNames(b: Uint8Array): string[] | null {
  // The end-of-central-directory record sits in the last 22 + 65535 bytes (its comment is at most 65535).
  const floor = Math.max(0, b.length - 22 - 65535);
  let eocd = -1;
  for (let i = b.length - 22; i >= floor; i--) {
    if (startsWith(b, [0x50, 0x4b, 0x05, 0x06], i)) { eocd = i; break; }
  }
  if (eocd < 0) return null;
  const count = u16(b, eocd + 10);
  let at = u32(b, eocd + 16);
  const names: string[] = [];
  const decoder = new TextDecoder("utf-8", { fatal: false });
  for (let n = 0; n < count; n++) {
    if (!startsWith(b, [0x50, 0x4b, 0x01, 0x02], at) || at + 46 > b.length) return null;
    const nameLen = u16(b, at + 28), extraLen = u16(b, at + 30), commentLen = u16(b, at + 32);
    if (at + 46 + nameLen > b.length) return null;
    names.push(decoder.decode(b.subarray(at + 46, at + 46 + nameLen)));
    at += 46 + nameLen + extraLen + commentLen;
  }
  return names;
}

export function sniffDocumentType(bytes: Uint8Array): DocumentContentType | null {
  if (startsWith(bytes, [0x25, 0x50, 0x44, 0x46, 0x2d])) return "application/pdf";            // %PDF-
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return "image/jpeg";
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png";
  if (startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) && startsWith(bytes, [0x57, 0x45, 0x42, 0x50], 8)) return "image/webp";
  if (startsWith(bytes, [0x50, 0x4b, 0x03, 0x04])) {
    const names = zipEntryNames(bytes);
    if (!names || !names.includes("[Content_Types].xml")) return null;
    if (names.some((n) => n.startsWith("word/"))) return DOCX;
    if (names.some((n) => n.startsWith("xl/"))) return XLSX;
  }
  return null;
}

export function checkDocumentBytes(bytes: Uint8Array, declared: DocumentContentType): "ok" | "mismatch" {
  return sniffDocumentType(bytes) === declared ? "ok" : "mismatch";
}
