import { isDocumentCategory, type DocumentRequestChannel, type DocumentRequestItem } from "@bis/db/document-rules";

/**
 * The Documents card's requests read, browser side (spec 4.2): the two routes'
 * DocumentRequestsResponse, parsed strictly (one bad request or item makes the whole answer an
 * error, as documentsLoadFrom does), plus the words the list needs. Browser-safe: it imports the
 * vault's rules from the subpath only, never the barrel.
 */
/** Mirrors OpenDocumentRequest from the barrel without importing it (that type is assignable here). */
export type OpenRequestView = {
  id: string; items: (DocumentRequestItem & { answered: boolean })[]; channel: DocumentRequestChannel; createdAt: string; expiresAt: string;
};
export type DocumentRequestsResponse = { now: string; channels: { text: boolean; email: boolean }; requests: OpenRequestView[] };
export type DocumentRequestsLoad = { kind: "loading" } | { kind: "error" } | { kind: "ready"; data: DocumentRequestsResponse };

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isIso = (v: unknown): v is string => typeof v === "string" && !Number.isNaN(Date.parse(v));
const CHANNELS = new Set(["text", "email", "link"]);

function item(v: unknown): (DocumentRequestItem & { answered: boolean }) | null {
  if (!isObj(v) || !isDocumentCategory(v.category) || v.key !== v.category || typeof v.answered !== "boolean") return null;
  if (!(v.note === null || typeof v.note === "string")) return null;
  return { key: v.category, category: v.category, note: v.note, answered: v.answered };
}

function request(v: unknown): OpenRequestView | null {
  if (!isObj(v) || typeof v.id !== "string" || !Array.isArray(v.items) || typeof v.channel !== "string" || !CHANNELS.has(v.channel)
    || !isIso(v.createdAt) || !isIso(v.expiresAt)) return null;
  const items = v.items.map(item);
  if (items.length === 0 || items.some((i) => i === null)) return null;
  return {
    id: v.id, items: items as OpenRequestView["items"], channel: v.channel as DocumentRequestChannel, createdAt: v.createdAt, expiresAt: v.expiresAt,
  };
}

export function parseDocumentRequests(body: unknown): DocumentRequestsResponse | null {
  if (!isObj(body) || !isIso(body.now) || !isObj(body.channels) || typeof body.channels.text !== "boolean"
    || typeof body.channels.email !== "boolean" || !Array.isArray(body.requests)) return null;
  const requests = body.requests.map(request);
  if (requests.some((r) => r === null)) return null;
  return { now: body.now, channels: { text: body.channels.text, email: body.channels.email }, requests: requests as OpenRequestView[] };
}

export async function documentRequestsLoadFrom(res: Response): Promise<DocumentRequestsLoad> {
  if (!res.ok) return { kind: "error" };
  const data = parseDocumentRequests(await res.json().catch(() => null));
  return data ? { kind: "ready", data } : { kind: "error" };
}

const DAY_MS = 86_400_000;
/** Whole days left, rounded UP (one hour left is "1 day"), never below 0. */
export const expiresInDays = (expiresAt: string, now: string): number =>
  Math.max(0, Math.ceil((Date.parse(expiresAt) - Date.parse(now)) / DAY_MS));

export const documentRequestsRouteFor = (accountId: string, record: { kind: "contact" | "group"; id: string }): string =>
  `/api/accounts/${accountId}/${record.kind === "group" ? "groups" : "contacts"}/${record.id}/document-requests`;
