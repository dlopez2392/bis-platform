"use server";

import { randomUUID } from "node:crypto";
import { headers } from "next/headers";
import { requireAccountAccess } from "@/lib/auth";
import { dbForRequest } from "@/lib/db";
import {
  serviceDb, getContact, readGroup, documentRequestTarget, createDocumentRequest, getDocumentRequest, revokeDocumentRequest,
  restoreDocumentRequest, documentRequestState, recipientLanguage, cleanRequestItems,
  type SupabaseClient, type DocumentRecordRef, type DocumentRequestRow, type DocumentRequestTarget,
} from "@bis/db";
import { isUuid } from "@/lib/assign/action-guards";
import { loggableError } from "@/lib/loggable-error";
import { originFrom } from "@/lib/email/origin";
import { requestToken, tokenHash, requestUrl } from "@/lib/document-requests/token";
import { deliverDocumentRequest, requestChannels, type DeliverOutcome } from "@/lib/document-requests/deliver";
import { ledgerDb } from "@/lib/consent/ledger-db";
import type { DocRecordArg, DocFail } from "./documents-actions";

/**
 * "Ask the customer" (spec 4.2). Every action: requireAccountAccess, then a REQUEST-client read of the
 * record or the request (RLS decides: the record's visibility, the Technician fence), and only then
 * the service client, scoped to the same account (0053; listed proven-target in
 * in-account-service-reads.test.ts). Who the request speaks to (a group's call-first member, plan
 * deviation 3) and the channels on offer are read on the request client too, exactly as the card's
 * routes read them, so the re-check below is the offer the dialog showed and never more. The link is
 * built from the request id (plan deviation 1) and is never stored; only its sha256 is. A failed send
 * never undoes the request: staff can Copy link. Answers are messages.ts keys; logs name the account,
 * never the link.
 */
const fail = (error: string): DocFail => ({ ok: false, error });
/** This request's own crafted/not-visible refusal (Task 5 fix round, S-07 2b review): never the generic document key. */
const REFUSED = "documents.request.refused";
const CREATE_FAILED = "documents.request.failed";
/** Revoked, completed or expired (fix round 1): the request is still the caller's to see, just over. */
const NOT_OPEN = "documents.request.notOpen";
/** Copy link could not be built or read: the house "didn't go through" line, never "couldn't create". */
const LINK_FAILED = "common.actionCrashed";
/** Undo is offered by the revoke's own toast; past this, or for someone else's revoke, it is over (fix round 3). */
const UNDO_WINDOW_MS = 10 * 60_000;
const CHANNELS = new Set(["text", "email", "link"]);
type Channel = "text" | "email" | "link";

/** Names the account and, for an existing request, its id: never the token or the link. */
function log(where: string, accountId: string, e: unknown, requestId?: string): void {
  const req = requestId === undefined ? "" : `, request ${isUuid(requestId) ? requestId.toLowerCase() : "(malformed)"}`;
  console.error(`document requests ${where} (account ${accountId}${req}): ${loggableError(e)}`);
}
function recordOf(raw: unknown): DocumentRecordRef | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  if (!isUuid(r.id)) return null;
  const id = r.id.toLowerCase();
  return r.kind === "contact" ? { kind: "contact", id } : r.kind === "group" ? { kind: "group", id } : null;
}
async function recordVisible(db: SupabaseClient, accountId: string, r: DocumentRecordRef): Promise<boolean> {
  return r.kind === "group" ? Boolean(await readGroup(db, accountId, r.id)) : Boolean(await getContact(db, accountId, r.id));
}
const refOf = (r: DocumentRecordRef) => ({ contact_id: r.kind === "contact" ? r.id : null, client_group_id: r.kind === "group" ? r.id : null });

export async function createDocumentRequestAction(
  accountId: string, input: { record: DocRecordArg; items: unknown; channel: unknown },
): Promise<{ ok: true; requestId: string; url: string; delivery: DeliverOutcome | { kind: "link" } } | DocFail> {
  const access = await requireAccountAccess(accountId);
  const record = recordOf(input?.record);
  const items = cleanRequestItems(input?.items);
  const channel = typeof input?.channel === "string" && CHANNELS.has(input.channel) ? (input.channel as Channel) : null;
  if (!record || !items || !channel) return fail(REFUSED);
  let target: DocumentRequestTarget | null;
  try {
    const db = await dbForRequest();
    if (!(await recordVisible(db, accountId, record))) return fail("documents.error.notFound");
    target = await documentRequestTarget(db, accountId, refOf(record));
    // Plan review M13: the chosen channel must be on offer NOW (a stale dialog, or a crafted call, must
    // not text a number that has stopped texts); checked before anything is written.
    if (channel !== "link") {
      const offered = await requestChannels(db, ledgerDb(), accountId, target);
      if (!offered[channel]) return fail(channel === "text" ? "documents.request.textOff" : "documents.request.emailOff");
    }
  } catch (e) {
    log("create: record read", accountId, e);
    return fail(CREATE_FAILED);
  }
  const origin = originFrom(await headers());
  if (!origin) return fail(CREATE_FAILED);
  const svc = serviceDb();
  let request: DocumentRequestRow;
  const now = new Date();
  try {
    const { data: acct, error } = await svc.from("accounts").select("language").eq("id", accountId).maybeSingle();
    if (error) throw new Error(`account language: ${error.message}`);
    const language = recipientLanguage(target?.language, (acct as { language: string | null } | null)?.language);
    const id = randomUUID();
    request = await createDocumentRequest(svc, {
      id, accountId, record, items, language, tokenHash: tokenHash(requestToken(id)), channel, createdBy: access.userId, now,
    });
  } catch (e) {
    log("create", accountId, e);
    return fail(CREATE_FAILED);
  }
  const url = requestUrl(origin, request.id);
  if (channel === "link") return { ok: true, requestId: request.id, url, delivery: { kind: "link" } };
  // deliverDocumentRequest never throws; whatever it answers, the request stands.
  const delivery = await deliverDocumentRequest(svc, { request, channel, actorId: access.userId, origin, now });
  return { ok: true, requestId: request.id, url, delivery };
}

/** The request, proven on the REQUEST client (RLS: the record's visibility, the Technician fence). */
async function visibleRequest(accountId: string, requestId: string): Promise<DocumentRequestRow | null> {
  if (!isUuid(requestId)) return null;
  return getDocumentRequest(await dbForRequest(), accountId, requestId.toLowerCase());
}

export async function documentRequestLinkAction(accountId: string, requestId: string): Promise<{ ok: true; url: string } | DocFail> {
  // M7a PR-4 (plan G11): Copy link writes nothing, so it stays usable while the account is paused.
  await requireAccountAccess(accountId, { duringPause: "allow" });
  try {
    const request = await visibleRequest(accountId, requestId);
    if (!request) return fail(REFUSED);
    if (documentRequestState(request, new Date()) !== "open") return fail(NOT_OPEN);
    const origin = originFrom(await headers());
    return origin ? { ok: true, url: requestUrl(origin, request.id) } : fail(LINK_FAILED);
  } catch (e) {
    log("link", accountId, e, requestId);
    return fail(LINK_FAILED);
  }
}

export async function revokeDocumentRequestAction(accountId: string, requestId: string): Promise<{ ok: true; revokedAt: string } | DocFail> {
  const access = await requireAccountAccess(accountId);
  try {
    const request = await visibleRequest(accountId, requestId);
    if (!request) return fail(REFUSED);
    const now = new Date();
    if (documentRequestState(request, now) !== "open") return fail(NOT_OPEN);
    // Compare-and-set on "still open": a request that closed since the read above answers null.
    const r = await revokeDocumentRequest(serviceDb(), accountId, request.id, access.userId, now);
    return r ? { ok: true, revokedAt: r.revokedAt } : fail(NOT_OPEN);
  } catch (e) {
    log("revoke", accountId, e, requestId);
    return fail("documents.error.failed");
  }
}

/**
 * Undo (rule 6): only THIS caller's own revoke, the one its toast names (the same instant), within
 * ten minutes, and only while the request would otherwise still be open. The proof read on the
 * request client supplies revoked_by and revoked_at; restoreDocumentRequest's compare-and-set on
 * that exact revoked_at is what makes the write race-safe.
 */
export async function undoRevokeDocumentRequestAction(accountId: string, requestId: string, revokedAt: string): Promise<{ ok: true } | DocFail> {
  const access = await requireAccountAccess(accountId);
  if (typeof revokedAt !== "string" || Number.isNaN(Date.parse(revokedAt))) return fail(REFUSED);
  try {
    const request = await visibleRequest(accountId, requestId);
    if (!request) return fail(REFUSED);
    const now = Date.now();
    const at = request.revoked_at ? Date.parse(request.revoked_at) : Number.NaN;
    if (at !== Date.parse(revokedAt) || request.revoked_by !== access.userId || now - at > UNDO_WINDOW_MS
      || request.completed_at || Date.parse(request.expires_at) <= now) return fail(NOT_OPEN);
    return (await restoreDocumentRequest(serviceDb(), accountId, request.id, revokedAt)) ? { ok: true } : fail(NOT_OPEN);
  } catch (e) {
    log("undo revoke", accountId, e, requestId);
    return fail("documents.error.failed");
  }
}
