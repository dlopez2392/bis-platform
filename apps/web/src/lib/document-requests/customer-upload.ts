import {
  findDocumentRequestByTokenHash, startDocumentRequestUpload, getRequestDocument, getDocumentVersion, listRequestFiles,
  getBranding, brandDisplayName, brandLogoUrl, listPhoneNumbersForAccount, documentRequestState,
  DOCUMENT_BUCKET, DOCUMENT_MAX_BYTES, isDocumentCategory, isDocumentContentType,
  type Branding, type DocumentRequestRow, type SupabaseClient,
} from "@bis/db";
import { m } from "@/lib/messages";
import { t } from "@/lib/i18n/t";
import { isUuid } from "@/lib/assign/action-guards";
import { loggableError } from "@/lib/loggable-error";
import { extensionAllowed } from "@/lib/documents/rules";
import { finishStoredUpload, cleanUpUpload } from "@/lib/documents/finish-upload";
import { openRequestTask } from "@/lib/document-requests/request-task";
import { isTokenShape, tokenHash } from "./token";
import { customerFileState, formatPhone, itemLabel, type CustomerFile, type CustomerFileState } from "./customer-state";

/**
 * The public rule (study 3.4; spec 4.4): a token is proven FIRST (its shape, then a lookup by its
 * sha256, then open), and every later read or write carries the request's own account and id. The
 * customer names only an item key (start) or a document and version of THIS request (finish); the
 * record and the category come from the request row inside 0080's start function. Logs name the
 * request id, never the token. Answers are bare error words with no id in them. The service client
 * is the CALLER's (the route's); this file names no serviceDb. Nothing here mints a read URL: the
 * customer never sees or downloads anything stored.
 */
export type Resolved = { kind: "open" | "expired" | "revoked" | "completed"; request: DocumentRequestRow } | { kind: "not_found" };
export type RouteAnswer = { status: number; body: Record<string, unknown> };
const answer = (status: number, body: Record<string, unknown>): RouteAnswer => ({ status, body });
const refuse = (status: number, error: string): RouteAnswer => answer(status, { error });

export async function resolveToken(db: SupabaseClient, token: string, now: Date): Promise<Resolved> {
  if (!isTokenShape(token)) return { kind: "not_found" };
  const request = await findDocumentRequestByTokenHash(db, tokenHash(token));
  if (!request) return { kind: "not_found" };
  return { kind: documentRequestState(request, now), request };
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** The business's first LIVE number, as a person reads it; null when it has none or the read fails (decorative,
 *  logged by request id like the branding read, never the token). */
async function livePhone(db: SupabaseClient, request: DocumentRequestRow): Promise<string | null> {
  try {
    const live = (await listPhoneNumbersForAccount(db, request.account_id)).find((p) => p.status === "live");
    return live ? formatPhone(live.e164) : null;
  } catch (e) {
    console.error(`document request ${request.id}: phone number unreadable: ${loggableError(e)}`);
    return null;
  }
}

export async function customerStart(db: SupabaseClient, token: string, body: unknown, now: Date): Promise<RouteAnswer> {
  let requestId = "unknown";
  try {
    const r = await resolveToken(db, token, now);
    if (r.kind === "not_found") return refuse(404, "not_found");
    if (r.kind !== "open") return refuse(410, r.kind);
    const request = r.request;
    requestId = request.id;
    if (!isObj(body)) return refuse(400, "bad_request");
    const { itemKey, name, size, contentType } = body;
    if (!isDocumentCategory(itemKey)) return refuse(400, "no_item");
    if (typeof size !== "number" || !Number.isInteger(size) || size < 1) return refuse(400, "bad_request");
    if (size > DOCUMENT_MAX_BYTES) return refuse(413, "too_large");
    if (typeof name !== "string" || !extensionAllowed(name) || !isDocumentContentType(contentType)) return refuse(400, "bad_type");
    const item = request.items.find((i) => i.key === itemKey);
    if (!item) return refuse(400, "no_item");
    const s = await startDocumentRequestUpload(db, {
      accountId: request.account_id, requestId: request.id, itemKey, bytes: size, contentType,
      originalName: name.slice(0, 255) || null, title: itemLabel(item, request.language),
    });
    if (s.status === "over_quota") {
      await openRequestTask(db, request.account_id, request, "storage_full", now);
      const phone = await livePhone(db, request);
      return answer(409, phone ? { error: "over_quota", phone } : { error: "over_quota" });
    }
    if (s.status === "rate_limited") return refuse(429, "rate_limited");
    if (s.status === "too_large") return refuse(413, "too_large");
    if (s.status === "no_item") return refuse(400, "no_item");
    if (s.status === "not_found") return refuse(404, "not_found");
    // The request closed between the lookup and the start function's lock: expired, revoked or completed.
    if (s.status !== "ok") return refuse(410, s.status);
    const { data, error } = await db.storage.from(DOCUMENT_BUCKET).createSignedUploadUrl(s.storagePath);
    if (error || !data) {
      await cleanUpUpload(db, request.account_id, s.documentId, s.versionId, s.storagePath);
      throw new Error(`createSignedUploadUrl: ${error?.message ?? "no data"}`);
    }
    return answer(200, { documentId: s.documentId, versionId: s.versionId, uploadUrl: data.signedUrl });
  } catch (e) {
    console.error(`document request ${requestId}: customer start failed: ${loggableError(e)}`);
    return refuse(503, "failed");
  }
}

const ERROR_WORD: Record<string, [number, string]> = {
  "documents.error.badType": [400, "bad_type"], "documents.error.trashed": [400, "refused"],
  "documents.error.refused": [400, "refused"], "documents.error.upload": [400, "upload"],
};

export async function customerFinish(db: SupabaseClient, token: string, body: unknown, now: Date): Promise<RouteAnswer> {
  let requestId = "unknown";
  try {
    const r = await resolveToken(db, token, now);
    if (r.kind === "not_found") return refuse(404, "not_found");
    // Deviation 13 (ruling I6): a version THIS request already reserved may still finish after the request
    // completed or expired (the start refuses new files then); only a revoked link refuses it.
    if (r.kind === "revoked") return refuse(410, "revoked");
    const request = r.request;
    requestId = request.id;
    if (!isObj(body) || !isUuid(body.documentId) || !isUuid(body.versionId)) return refuse(400, "bad_request");
    const documentId = body.documentId.toLowerCase();
    const versionId = body.versionId.toLowerCase();
    // The proof: THIS request's document in THIS account. Its version is then checked against that
    // document by finishStoredUpload's own read (account, document and version together).
    const doc = await getRequestDocument(db, request.account_id, request.id, documentId);
    if (!doc) return refuse(404, "not_found");
    const f = await finishStoredUpload(db, {
      accountId: request.account_id, documentId, versionId, trashed: doc.deleted_at !== null,
      actorId: `customer:${request.id}`, actorType: "system",
    });
    if (!f.ok) {
      const [status, word] = ERROR_WORD[f.error] ?? [400, "upload"];
      return refuse(status, word);
    }
    let state: CustomerFileState = "checking";
    if (f.scan === "clean") state = "received";
    else if (f.scan === "infected") state = "virus";
    else if (f.scan === "unscannable") {
      const v = await getDocumentVersion(db, request.account_id, versionId);
      // Only THIS document's version may lend its signature (the proven document, not just the account).
      const signature = v && v.document_id === documentId ? v.scan_signature : null;
      state = customerFileState({ ready: true, scanStatus: "unscannable", scanSignature: signature }) ?? "unscannable";
    }
    return answer(200, { state });
  } catch (e) {
    console.error(`document request ${requestId}: customer finish failed: ${loggableError(e)}`);
    return refuse(503, "failed");
  }
}

export type CustomerPage = {
  state: Resolved["kind"]; language: "en" | "es"; business: string; logoUrl: string | null; branding: Branding | null;
  phone: string | null; items: { key: string; label: string; files: CustomerFile[] }[];
};

/** The page's whole read (spec 4.3): server-rendered, re-run by router.refresh() while a file is Checking. */
export async function customerPage(db: SupabaseClient, token: string, now: Date): Promise<CustomerPage> {
  const r = await resolveToken(db, token, now);
  if (r.kind === "not_found") {
    return { state: "not_found", language: "en", business: m["customerDocs.business"], logoUrl: null, branding: null, phone: null, items: [] };
  }
  const { request } = r;
  let branding: Branding | null = null;
  try {
    branding = await getBranding(db, request.account_id);
  } catch (e) {
    // Decorative (the /u page's rule): a branding blip never costs the customer the page.
    console.error(`document request ${request.id}: branding unreadable: ${loggableError(e)}`);
  }
  const business = (branding && brandDisplayName(branding)) || t(m, "customerDocs.business", request.language);
  const phone = await livePhone(db, request);
  const files = r.kind === "open" ? await listRequestFiles(db, request.account_id, request.id) : [];
  return {
    state: r.kind, language: request.language, business, branding, phone,
    logoUrl: branding?.brandLogoPath ? brandLogoUrl(branding.brandLogoPath) : null,
    items: request.items.map((i) => ({
      key: i.key, label: itemLabel(i, request.language),
      files: files.filter((f) => f.itemKey === i.key).flatMap((f): CustomerFile[] => {
        const state = customerFileState(f);
        // An unparseable created_at stays non-finite (NaN), never an invented age: nextCustomerPollMs stops on it.
        const age = now.getTime() - Date.parse(f.createdAt);
        return state ? [{ state, ageMs: Number.isFinite(age) ? Math.max(0, age) : age }] : [];
      }),
    })),
  };
}
