/**
 * The document vault's fixed rules (spec V4, V5, section 3), in ONE module: the app reads them, and
 * test/document-vault-schema.test.ts pins each against 0077's SQL, so a number changed on one side
 * fails by name. Pure: no client, no I/O, safe in the browser.
 */
export const DOCUMENT_BUCKET = "documents" as const;
/** 5 GiB per account, trashed files included until purged (V4). 0077's reserve_document_version holds the same literal. */
export const DOCUMENT_QUOTA_BYTES = 5_368_709_120;
/** 25 MiB per file (V4). The bucket's file_size_limit and document_versions_bytes_check hold the same literal. */
export const DOCUMENT_MAX_BYTES = 26_214_400;
/** The bucket's allowed_mime_types, IN THIS ORDER (the parity fingerprint compares the array as text). */
export const DOCUMENT_CONTENT_TYPES = [
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
] as const;
export type DocumentContentType = (typeof DOCUMENT_CONTENT_TYPES)[number];
/** Stored as keys; the words live in messages.ts as documents.category.<key> (V5). */
export const DOCUMENT_CATEGORIES = ["id", "contract", "estimate", "invoice", "photo", "permit", "insurance", "warranty", "other"] as const;
export type DocumentCategory = (typeof DOCUMENT_CATEGORIES)[number];
/** Part 1's two sources, and part 2b's customer upload (0080 widens the CHECK with this list). */
export const DOCUMENT_SOURCES = ["upload", "camera", "customer"] as const;
export type DocumentSource = (typeof DOCUMENT_SOURCES)[number];
/** The sources a STAFF upload may claim; `customer` is only ever written by start_document_request_upload. */
export const STAFF_DOCUMENT_SOURCES = ["upload", "camera"] as const;
/** A customer file's created_by / uploaded_by is "customer:<request id>" (0080's documents_request_coherent). */
export const CUSTOMER_AUTHOR_PREFIX = "customer:";
export const isCustomerAuthor = (by: string | null | undefined): boolean =>
  typeof by === "string" && by.startsWith(CUSTOMER_AUTHOR_PREFIX);
export const DOCUMENT_TITLE_MAX = 200;
/** A trashed file is purged this many days after it was trashed (spec section 5.4). */
export const DOCUMENT_TRASH_DAYS = 30;

/** Customer upload links (spec P5, 4.1, 4.4); the SQL literals in 0080 are these. */
export const DOCUMENT_REQUEST_DAYS = 7;
export const DOCUMENT_REQUEST_DAILY_STARTS = 20;
export const DOCUMENT_REQUEST_MAX_ITEMS = 9;
export const DOCUMENT_REQUEST_NOTE_MAX = 80;
export type DocumentRequestItem = { key: DocumentCategory; category: DocumentCategory; note: string | null };
export type DocumentRequestChannel = "text" | "email" | "link";
export type DocumentRequestState = "open" | "expired" | "revoked" | "completed";

export const isDocumentCategory = (v: unknown): v is DocumentCategory =>
  typeof v === "string" && (DOCUMENT_CATEGORIES as readonly string[]).includes(v);
export const isDocumentContentType = (v: unknown): v is DocumentContentType =>
  typeof v === "string" && (DOCUMENT_CONTENT_TYPES as readonly string[]).includes(v);

/**
 * 0080's app.document_request_items_ok, in TypeScript: the dialog's and the action's check. A note is
 * trimmed. 0071's app.tidy_text (the SQL side of the note check) treats U+0085 (NEL) as whitespace
 * (Unicode's White_Space property), but JS's String.prototype.trim() does not strip it — verified
 * directly against the replica (`app.tidy_text(chr(133) || 'x', 80)` answers false). A note trimmed
 * here could therefore still carry a leading or trailing NEL and pass this function while the SQL
 * check refuses the insert; it is refused here too, mirroring the SQL side exactly.
 */
export function cleanRequestItems(raw: unknown): DocumentRequestItem[] | null {
  if (!Array.isArray(raw) || raw.length < 1 || raw.length > DOCUMENT_REQUEST_MAX_ITEMS) return null;
  const out: DocumentRequestItem[] = [];
  const seen = new Set<string>();
  for (const x of raw) {
    if (typeof x !== "object" || x === null || Array.isArray(x)) return null;
    const { key, category, note } = x as Record<string, unknown>;
    if (!isDocumentCategory(category) || key !== category || seen.has(category)) return null;
    seen.add(category);
    if (category === "other") {
      if (typeof note !== "string") return null;
      const t = note.trim();
      if (t.length < 1 || t.length > DOCUMENT_REQUEST_NOTE_MAX) return null;
      if (t.startsWith("\u0085") || t.endsWith("\u0085")) return null;
      out.push({ key: category, category, note: t });
    } else {
      if (note !== null) return null;
      out.push({ key: category, category, note: null });
    }
  }
  return out;
}

/** The order 0080's start function (and its completion trigger, 0080 step 6) checks them in: revoked, then
 *  completed, then expired. A clean verdict for a revoked-then-un-revoked request still completes it
 *  (the trigger does not gate on revoked_at), so this ranks revoked above completed deliberately: an app
 *  reader must never show a revoked request as done. */
export function documentRequestState(
  r: { revoked_at: string | null; completed_at: string | null; expires_at: string }, now: Date,
): DocumentRequestState {
  if (r.revoked_at) return "revoked";
  if (r.completed_at) return "completed";
  return Date.parse(r.expires_at) <= now.getTime() ? "expired" : "open";
}

/**
 * Why a removed version was removed, read from its scan state and clamd's name for it (0079's
 * scan_signature). Owner ruling 2026-10-15 ("remove, and say why"): content clamd reports as
 * Heuristics.Encrypted.* is password-protected, and the person is told so; every other unscannable
 * cause (a limit, three clamd errors) is "unscannable". Pure and browser-safe: the card's read and 2b's
 * customer page both call it, so the two can never word the reason differently. The signature itself
 * never leaves the server.
 */
export type RemovedReason = "virus" | "password" | "unscannable";
export const PASSWORD_SIGNATURE_PREFIX = "Heuristics.Encrypted.";
export function removedReason(scanStatus: string, signature: string | null): RemovedReason | null {
  if (scanStatus === "infected") return "virus";
  if (scanStatus !== "unscannable") return null;
  return signature?.startsWith(PASSWORD_SIGNATURE_PREFIX) ? "password" : "unscannable";
}
