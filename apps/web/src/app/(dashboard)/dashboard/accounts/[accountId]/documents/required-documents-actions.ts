"use server";

import { revalidatePath } from "next/cache";
import { requireAccountAccess } from "@/lib/auth";
import { serviceDb, restoreRequiredDocumentCategories, cleanRequiredCategories } from "@bis/db";
import { loggableError } from "@/lib/loggable-error";

/**
 * The Owner's Required documents card's Undo (S-07 3a, spec 3.3). Admits who 2c's save admits
 * (canManage: an Owner or the agency). A compare-and-set on the whole list (plan deviation 9): the
 * previous list goes back only while the stored one is still what the save wrote. `error` is a
 * message KEY: the bilingual card says it in the reader's language.
 */
export type RequiredUndoAnswer =
  | { ok: true }
  | { ok: false; error: "documents.required.role" | "documents.required.changed" | "documents.required.failed" };

export async function undoRequiredDocumentsAction(accountId: string, expected: string[], previous: string[]): Promise<RequiredUndoAnswer> {
  const access = await requireAccountAccess(accountId);
  if (!access.canManage) return { ok: false, error: "documents.required.role" };
  const e = cleanRequiredCategories(expected);
  const p = cleanRequiredCategories(previous);
  if (!e || !p) return { ok: false, error: "documents.required.failed" };
  try {
    if (!(await restoreRequiredDocumentCategories(serviceDb(), accountId, e, p))) return { ok: false, error: "documents.required.changed" };
    revalidatePath(`/dashboard/accounts/${accountId}/documents`);
    revalidatePath(`/dashboard/accounts/${accountId}/settings`);
    return { ok: true };
  } catch (err) {
    console.error(`required documents undo (account ${accountId}): ${loggableError(err)}`);
    return { ok: false, error: "documents.required.failed" };
  }
}
