import {
  documentRequestTarget, ensureDocumentRequestTask, getDocumentRequestForVersion,
  type DocumentRequestRow, type SupabaseClient,
} from "@bis/db";
import { m } from "@/lib/messages";
import { t } from "@/lib/i18n/t";
import { loggableError } from "@/lib/loggable-error";

/**
 * The ONE work-queue To-do per request and kind (spec 4.4, 4.5; plan deviation 4): "Ana García sent
 * documents · Review" on the first clean file, "… couldn't send documents: your storage is full" on
 * an over-quota start. Titled in the ACCOUNT's language (staff read it). Never throws: a To-do that
 * cannot be opened is logged by request id; the file's own timeline row still says it arrived.
 */
const KEY = { received: "documents.request.task.received", storage_full: "documents.request.task.storageFull" } as const;
const ACTOR = "documents-request";

export async function openRequestTask(
  db: SupabaseClient, accountId: string, request: DocumentRequestRow, kind: "received" | "storage_full", now: Date,
): Promise<void> {
  try {
    const target = await documentRequestTarget(db, accountId, request);
    if (!target) return;
    const { data, error } = await db.from("accounts").select("language").eq("id", accountId).maybeSingle();
    if (error) throw new Error(`account language: ${error.message}`);
    const lang = (data as { language: string | null } | null)?.language === "es" ? "es" : "en";
    await ensureDocumentRequestTask(db, accountId, {
      requestId: request.id, kind, contactId: target.contactId, title: t(m, KEY[kind], lang, { name: target.name }), dueAt: now.toISOString(),
    }, ACTOR, "system");
  } catch (e) {
    console.error(`document request ${request.id} (account ${accountId}): the ${kind} To-do was not opened: ${loggableError(e)}`);
  }
}

/** scanVersion's clean hook: a customer file's first clean version opens its request's "received" To-do. */
export async function openReceivedTaskFor(db: SupabaseClient, v: { accountId: string; versionId: string }, now: Date): Promise<void> {
  try {
    const request = await getDocumentRequestForVersion(db, v.accountId, v.versionId);
    if (request) await openRequestTask(db, v.accountId, request, "received", now);
  } catch (e) {
    console.error(`documents scan (account ${v.accountId}): the request To-do check failed for version ${v.versionId}: ${loggableError(e)}`);
  }
}
