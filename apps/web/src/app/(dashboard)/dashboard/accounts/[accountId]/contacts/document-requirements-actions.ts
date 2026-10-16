"use server";

import { requireAccountAccess } from "@/lib/auth";
import { seesWholeAccount } from "@/lib/auth-role";
import { dbForRequest } from "@/lib/db";
import {
  serviceDb, getContact, getRequiredDocumentCategories, skipDocumentRequirement, getDocumentSkip, undoDocumentSkip,
  getActiveDocumentSkip, unskipDocumentRequirement, undoDocumentUnskip, isRequirableCategory, DOCUMENT_REQUIREMENT_UNDO_MS,
} from "@bis/db";
import { isUuid } from "@/lib/assign/action-guards";
import { loggableError } from "@/lib/loggable-error";
import type { DocFail } from "./documents-actions";

/**
 * "Not needed" and "Needed again" on the Documents card's checklist (spec 5.4), each with its Undo.
 * Every action: requireAccountAccess and the role check (D1: a Technician sees the list but never
 * changes it; an unsettled role fails closed), then a REQUEST-client read of the contact, the
 * account's list or the skip row (RLS decides: the contact's visibility, the Technician fence, 0081's
 * policy on the skips), and only then the service client, scoped to the same account (0053; listed
 * proven-target in in-account-service-reads.test.ts). An Undo is the SAME person's own, within
 * DOCUMENT_REQUIREMENT_UNDO_MS, never a blind restore. Answers are messages.ts keys; logs name the
 * account and the skip, never more.
 */
const fail = (error: string): DocFail => ({ ok: false, error });
/** A crafted id, category or instant: the checklist's own refusal (M2), never 2b's request key. */
const REFUSED = "documents.checklist.refused";
const CHANGED = "documents.checklist.changed";
const FAILED = "documents.error.failed";
const ROLE = "documents.checklist.skipRole";

function log(where: string, accountId: string, e: unknown, skipId?: string): void {
  const skip = skipId === undefined ? "" : `, skip ${isUuid(skipId) ? skipId.toLowerCase() : "(malformed)"}`;
  console.error(`document requirements ${where} (account ${accountId}${skip}): ${loggableError(e)}`);
}
const isInstant = (v: unknown): v is string => typeof v === "string" && !Number.isNaN(Date.parse(v));

export async function skipDocumentRequirementAction(
  accountId: string, contactId: string, category: string,
): Promise<{ ok: true; skipId: string } | DocFail> {
  const access = await requireAccountAccess(accountId);
  if (!seesWholeAccount(access)) return fail(ROLE);
  if (!isUuid(contactId) || !isRequirableCategory(category)) return fail(REFUSED);
  const contact = contactId.toLowerCase();
  try {
    const db = await dbForRequest();
    if (!(await getContact(db, accountId, contact))) return fail("documents.error.notFound");
    if (!(await getRequiredDocumentCategories(db, accountId)).includes(category)) return fail("documents.checklist.notRequired");
    const r = await skipDocumentRequirement(serviceDb(), { accountId, contactId: contact, category, actorId: access.userId });
    return r.status === "skipped" ? { ok: true, skipId: r.skip.id } : fail(CHANGED);
  } catch (e) {
    log("skip", accountId, e);
    return fail(FAILED);
  }
}

/** Undo "Not needed": deletes only the caller's own still-active skip, made within the window. */
export async function undoSkipDocumentRequirementAction(accountId: string, skipId: string): Promise<{ ok: true } | DocFail> {
  const access = await requireAccountAccess(accountId);
  if (!seesWholeAccount(access)) return fail(ROLE);
  if (!isUuid(skipId)) return fail(REFUSED);
  try {
    const row = await getDocumentSkip(await dbForRequest(), accountId, skipId.toLowerCase());
    if (!row || row.skipped_by !== access.userId || row.unskipped_at !== null) return fail(CHANGED);
    const elapsed = Date.now() - Date.parse(row.created_at);
    // An unreadable created_at (NaN) is refused as "changed" (M2: it's not a real expiry, it's a data
    // problem, and only CHANGED has ever meant "reload, we can't say"); a real elapsed over the window
    // gets its own, true sentence instead.
    if (Number.isNaN(elapsed)) return fail(CHANGED);
    if (elapsed > DOCUMENT_REQUIREMENT_UNDO_MS) return fail("documents.checklist.undoExpiredSkip");
    return (await undoDocumentSkip(serviceDb(), accountId, row.id, access.userId)) ? { ok: true } : fail(CHANGED);
  } catch (e) {
    log("undo skip", accountId, e, skipId);
    return fail(FAILED);
  }
}

/** "Needed again": closes the active skip at the DATABASE's instant, which the Undo toast carries back. */
export async function unskipDocumentRequirementAction(
  accountId: string, contactId: string, category: string,
): Promise<{ ok: true; skipId: string; unskippedAt: string } | DocFail> {
  const access = await requireAccountAccess(accountId);
  if (!seesWholeAccount(access)) return fail(ROLE);
  if (!isUuid(contactId) || !isRequirableCategory(category)) return fail(REFUSED);
  const contact = contactId.toLowerCase();
  try {
    const db = await dbForRequest();
    if (!(await getContact(db, accountId, contact))) return fail("documents.error.notFound");
    const skip = await getActiveDocumentSkip(db, accountId, contact, category);
    if (!skip) return fail(CHANGED);
    const r = await unskipDocumentRequirement(serviceDb(), accountId, skip.id, access.userId);
    return r ? { ok: true, skipId: skip.id, unskippedAt: r.unskippedAt } : fail(CHANGED);
  } catch (e) {
    log("unskip", accountId, e);
    return fail(FAILED);
  }
}

/**
 * Undo "Needed again": only the caller's own un-skip, the one its toast names (the same instant),
 * within the window. undoDocumentUnskip's compare-and-set on that exact string makes the write
 * race-safe, and a newer active skip for the same item wins (it answers false).
 */
export async function undoUnskipDocumentRequirementAction(
  accountId: string, skipId: string, unskippedAt: string,
): Promise<{ ok: true } | DocFail> {
  const access = await requireAccountAccess(accountId);
  if (!seesWholeAccount(access)) return fail(ROLE);
  if (!isUuid(skipId) || !isInstant(unskippedAt)) return fail(REFUSED);
  try {
    const row = await getDocumentSkip(await dbForRequest(), accountId, skipId.toLowerCase());
    const at = row?.unskipped_at ? Date.parse(row.unskipped_at) : Number.NaN;
    if (!row || row.unskipped_by !== access.userId || at !== Date.parse(unskippedAt)) return fail(CHANGED);
    if (Date.now() - at > DOCUMENT_REQUIREMENT_UNDO_MS) return fail("documents.checklist.undoExpiredUnskip");
    return (await undoDocumentUnskip(serviceDb(), accountId, row.id, unskippedAt, access.userId)) ? { ok: true } : fail(CHANGED);
  } catch (e) {
    log("undo unskip", accountId, e, skipId);
    return fail(FAILED);
  }
}
