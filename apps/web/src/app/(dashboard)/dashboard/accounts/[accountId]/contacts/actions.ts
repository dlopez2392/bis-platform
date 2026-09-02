"use server";

import { revalidatePath } from "next/cache";
import { requireAccountAccess } from "@/lib/auth";
import { dbForRequest } from "@/lib/db";
import { createContact, deleteContacts, addTagToContacts, removeTagFromContacts, updateContact } from "@bis/db";
import { EDITABLE_FIELDS, FIELD_TO_INPUT_KEY, normalizeFieldInput,
         type EditableField } from "@/lib/contacts/field-input";

export async function createContactAction(accountId: string, formData: FormData): Promise<void> {
  const { userId } = await requireAccountAccess(accountId);
  const val = (k: string) => String(formData.get(k) ?? "").trim() || undefined;
  await createContact(await dbForRequest(), accountId, {
    firstName: val("firstName"), lastName: val("lastName"),
    email: val("email"), phone: val("phone"),
  }, userId);
  revalidatePath(`/dashboard/accounts/${accountId}/contacts`);
}

const contactsPath = (accountId: string) => `/dashboard/accounts/${accountId}/contacts`;

export async function updateContactFieldAction(
  accountId: string, contactId: string, field: EditableField, value: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { userId } = await requireAccountAccess(accountId);
  if (!EDITABLE_FIELDS.includes(field)) return { ok: false, error: "Unknown field." };
  const norm = normalizeFieldInput(field, value);
  if (!norm.ok) return norm;
  try {
    await updateContact(await dbForRequest(), accountId, contactId,
      { [FIELD_TO_INPUT_KEY[field]]: norm.value }, userId);
  } catch {
    return { ok: false, error: "Save failed — please try again." };
  }
  revalidatePath(contactsPath(accountId));
  revalidatePath(`${contactsPath(accountId)}/${contactId}`);
  return { ok: true };
}

export async function bulkAddTagAction(
  accountId: string, contactIds: string[], tagName: string,
): Promise<{ ok: true; tagId: string; applied: number } | { ok: false; error: string }> {
  await requireAccountAccess(accountId);
  if (contactIds.length === 0 || !tagName.trim()) return { ok: false, error: "Nothing selected." };
  try {
    const r = await addTagToContacts(await dbForRequest(), accountId, contactIds, tagName);
    revalidatePath(contactsPath(accountId));
    return { ok: true, ...r };
  } catch {
    return { ok: false, error: "Tagging failed — please try again." };
  }
}

export async function bulkRemoveTagAction(
  accountId: string, contactIds: string[], tagId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  await requireAccountAccess(accountId);
  try {
    await removeTagFromContacts(await dbForRequest(), accountId, contactIds, tagId);
    revalidatePath(contactsPath(accountId));
    return { ok: true };
  } catch {
    return { ok: false, error: "Undo failed — the tag is still applied." };
  }
}

export async function bulkDeleteContactsAction(
  accountId: string, contactIds: string[],
): Promise<{ ok: true; deleted: number; skippedBlocked: number } | { ok: false; error: string }> {
  await requireAccountAccess(accountId);
  if (contactIds.length === 0) return { ok: false, error: "Nothing selected." };
  try {
    const r = await deleteContacts(await dbForRequest(), accountId, contactIds);
    revalidatePath(contactsPath(accountId));
    return { ok: true, ...r };
  } catch {
    return { ok: false, error: "Delete failed — please try again." };
  }
}
