"use server";

import { revalidatePath } from "next/cache";
import { requireAccountAccess } from "@/lib/auth";
import { serviceDb, setRequiredDocumentCategories, cleanRequiredCategories } from "@bis/db";
import { loggableError } from "@/lib/loggable-error";
import { m } from "@/lib/messages";

/**
 * Saves the account's required documents (spec 5.2). D6 (owner ruling 2026-10-16): the agency edits
 * the list on Settings now; the action already admits a client Owner (canManage) for the later Owner
 * screen. One account column, server-written (0081: no grant on it). The ticks are cleaned HERE, to
 * the vault's order with duplicates dropped, and anything not requirable refuses the whole save
 * before any write (I3). `error` is display text, as setReportEmailsAction's is: the card toasts it.
 */
export async function setRequiredDocumentCategoriesAction(
  accountId: string, formData: FormData,
): Promise<{ ok: true; list: string[] } | { ok: false; error: string }> {
  const access = await requireAccountAccess(accountId);
  if (!access.canManage) return { ok: false, error: m["settings.requiredDocuments.role"] };
  const list = cleanRequiredCategories(formData.getAll("category").map(String));
  if (!list) return { ok: false, error: m["settings.requiredDocuments.failed"] };
  try {
    const saved = await setRequiredDocumentCategories(serviceDb(), accountId, list);
    revalidatePath(`/dashboard/accounts/${accountId}/settings`);
    return { ok: true, list: saved };
  } catch (e) {
    console.error(`required documents save (account ${accountId}): ${loggableError(e)}`);
    return { ok: false, error: m["settings.requiredDocuments.failed"] };
  }
}
