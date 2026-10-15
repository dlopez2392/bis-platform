import {
  isDocumentCategory, isDocumentContentType, type DocumentCategory, type DocumentContentType, type DocumentSource,
} from "@bis/db/document-rules";
import { isDay } from "./rules";
import type { DocumentsSpace } from "./space";

/**
 * The Documents card's own read (spec 4.5: it loads and fails on its own), the route's response
 * parsed. Anything but a well-formed 200 is the card's error state (lib/contacts/places-load.ts's rule),
 * so a server newer than this tab's bundle gets "Couldn't load documents." instead of a row that throws.
 * The author's Clerk id never travels: the route sends `addedBy` already resolved.
 */
export type DocumentVersionView = { id: string; contentType: DocumentContentType; bytes: number; createdAt: string; addedOn: string };
export type DocumentView = {
  id: string; title: string; category: DocumentCategory; expiresOn: string | null; ownersOnly: boolean; source: DocumentSource;
  /** `addedOn`: the day it was added, YYYY-MM-DD in the ACCOUNT's zone (the route's), for "yesterday" against `today`. */
  addedBy: { you: boolean; name: string | null }; createdAt: string; addedOn: string; deletedAt: string | null;
  version: { id: string; contentType: DocumentContentType; bytes: number };
  /** Every READY version, newest first; always includes `version` (spec 4.3). */
  versions: DocumentVersionView[];
  /** A Delete forever began and did not finish (deviation 4): never restorable. */
  purging: boolean;
};
export type DocumentsResponse = {
  today: string; now: string;
  record: { kind: "contact"; id: string } | { kind: "group"; id: string; groupKind: "household" | "business" };
  live: DocumentView[]; trashed: DocumentView[]; capped: boolean; space: DocumentsSpace | null;
};
export type DocumentsLoad = { status: "loading" } | { status: "error" } | { status: "ready"; data: DocumentsResponse };

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown): v is string => typeof v === "string" && v.length > 0;
const instant = (v: unknown) => str(v) && !Number.isNaN(Date.parse(v));

function isVersionView(v: unknown): boolean {
  return isObj(v) && str(v.id) && isDocumentContentType(v.contentType) && typeof v.bytes === "number" && v.bytes > 0
    && instant(v.createdAt) && isDay(v.addedOn);
}

function isSpace(v: unknown): boolean {
  return v === null || (isObj(v) && Number.isSafeInteger(v.used) && (v.used as number) >= 0
    && Number.isSafeInteger(v.quota) && (v.quota as number) > 0);
}

function isView(v: unknown, trashed: boolean): boolean {
  if (!isObj(v) || !isObj(v.addedBy) || !isObj(v.version)) return false;
  return str(v.id) && typeof v.title === "string" && isDocumentCategory(v.category)
    && (v.expiresOn === null || isDay(v.expiresOn)) && typeof v.ownersOnly === "boolean"
    && (v.source === "upload" || v.source === "camera")
    && typeof v.addedBy.you === "boolean" && (v.addedBy.name === null || typeof v.addedBy.name === "string")
    && instant(v.createdAt) && isDay(v.addedOn) && (trashed ? instant(v.deletedAt) : v.deletedAt === null)
    && str(v.version.id) && isDocumentContentType(v.version.contentType)
    && typeof v.version.bytes === "number" && v.version.bytes > 0
    && typeof v.purging === "boolean" && (trashed || v.purging === false)
    && Array.isArray(v.versions) && v.versions.length > 0 && v.versions.every(isVersionView)
    && v.versions.some((x) => isObj(x) && x.id === (v.version as Obj).id);
}

function isRecord(v: unknown): boolean {
  if (!isObj(v) || !str(v.id)) return false;
  return v.kind === "contact" || (v.kind === "group" && (v.groupKind === "household" || v.groupKind === "business"));
}

export async function documentsLoadFrom(res: Response): Promise<DocumentsLoad> {
  if (!res.ok) return { status: "error" };
  let body: unknown;
  try { body = await res.json(); } catch { return { status: "error" }; }
  if (!isObj(body)) return { status: "error" };
  const ok = isDay(body.today) && instant(body.now) && isRecord(body.record)
    && Array.isArray(body.live) && body.live.every((x) => isView(x, false))
    && Array.isArray(body.trashed) && body.trashed.every((x) => isView(x, true))
    && typeof body.capped === "boolean" && isSpace(body.space);
  return ok ? { status: "ready", data: body as DocumentsResponse } : { status: "error" };
}
