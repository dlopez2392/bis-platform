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
/** Part 1's two sources; parts 2+ widen the CHECK and this list together. */
export const DOCUMENT_SOURCES = ["upload", "camera"] as const;
export type DocumentSource = (typeof DOCUMENT_SOURCES)[number];
export const DOCUMENT_TITLE_MAX = 200;
/** A trashed file is purged this many days after it was trashed (spec section 5.4). */
export const DOCUMENT_TRASH_DAYS = 30;

export const isDocumentCategory = (v: unknown): v is DocumentCategory =>
  typeof v === "string" && (DOCUMENT_CATEGORIES as readonly string[]).includes(v);
export const isDocumentContentType = (v: unknown): v is DocumentContentType =>
  typeof v === "string" && (DOCUMENT_CONTENT_TYPES as readonly string[]).includes(v);

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
