"use server";

import { revalidatePath } from "next/cache";
import { requireAccountAccess } from "@/lib/auth";
import { dbForRequest } from "@/lib/db";
import { createContact, deleteContacts, addTagToContacts, removeTagFromContacts, updateContact,
         setMarketingEmailOptOut } from "@bis/db";
import { m } from "@/lib/messages";
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

/**
 * The "No marketing emails" switch (drawer + full contact page). `true`
 * records the customer's "stop" (stamps `marketing_email_opted_out_at`),
 * `false` clears it — which is also the undo toast's write.
 *
 * Through the request's RLS client, not the service client: a client-role
 * user manages their own contacts, and RLS is the second fence behind
 * `requireAccountAccess`. The first fence for a contact of ANOTHER account is
 * `setMarketingEmailOptOut` itself — scoped by `account_id` on the update and
 * throwing when no row matched — so that case lands in the catch below as a
 * reported failure, never a silent "saved".
 *
 * `optedOut` is checked to be a real boolean: an action's arguments arrive
 * off the wire, and a truthy stand-in ("false") would stamp the opt-out.
 */
export async function setMarketingEmailOptOutAction(
  accountId: string, contactId: string, optedOut: boolean,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { userId } = await requireAccountAccess(accountId);
  if (typeof optedOut !== "boolean") return { ok: false, error: m["contact.marketingOptOut.failed"] };
  try {
    // `userId` is the actor on the audit event the db function emits
    // (contact.marketing_email_opted_out / _opted_in): who, and which way.
    await setMarketingEmailOptOut(await dbForRequest(), accountId, contactId, optedOut, userId);
  } catch (e) {
    // The operator reads only "Couldn't save that"; this line is the one
    // trace of which contact on which account refused, and the db's reason.
    console.error(
      `setMarketingEmailOptOutAction: account ${accountId} contact ${contactId} ` +
      `optedOut=${optedOut} failed: ${e instanceof Error ? e.message : String(e)}`,
    );
    return { ok: false, error: m["contact.marketingOptOut.failed"] };
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
