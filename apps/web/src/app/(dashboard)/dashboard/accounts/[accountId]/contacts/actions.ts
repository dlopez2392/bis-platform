"use server";

import { revalidatePath } from "next/cache";
import { requireAccountAccess } from "@/lib/auth";
import { dbForRequest } from "@/lib/db";
import { createContact, deleteContacts, addTagToContacts, removeTagFromContacts, updateContact,
         setMarketingEmailOptOut, getContact, setContactPhoneCountry } from "@bis/db";
import { normalisePhone, repickPhoneCountry, type PhoneCountry } from "@bis/db/phone";
import { loggableError } from "@/lib/loggable-error";
import type { PhoneCountryPickResult, PhoneCountryUndoResult, PhoneCountryPrevious } from "@/lib/contacts/phone-country";
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

const COUNTRIES: readonly PhoneCountry[] = ["US", "MX"];

function revalidateContact(accountId: string, contactId: string): void {
  revalidatePath(contactsPath(accountId));
  revalidatePath(`${contactsPath(accountId)}/${contactId}`);
}

/**
 * The Texts row's "Mexico (+52)" / "US (+1)" (consent chain spec §6, F-009):
 * rewrites the stored number under the chosen country and clears
 * `phone_country_unconfirmed`, through the request's RLS client (0054
 * grants `authenticated` UPDATE on the flag by name, 0053's convention).
 * Compare-and-set on the phone the action READ: an edit that lands between
 * the read and the write wins, and the operator is told to reload.
 *
 * The row that asked may be stale (review R3-I2): only a number that is
 * STILL ambiguous — the contact's flag, or the stored number itself still
 * reading both ways (a row saved before the 0054 backfill ran) — is
 * re-coded. A number since corrected to a plainly US or Mexican one answers
 * "changed", and nothing is written.
 *
 * Answers the previous phone and flag, which the undo toast hands back.
 */
export async function setPhoneCountryAction(
  accountId: string, contactId: string, country: PhoneCountry,
): Promise<PhoneCountryPickResult> {
  const { userId } = await requireAccountAccess(accountId);
  if (!COUNTRIES.includes(country)) return { ok: false, error: m["contact.phoneCountry.failed"] };
  try {
    const db = await dbForRequest();
    const contact = await getContact(db, accountId, contactId);
    if (!contact?.phone) return { ok: false, error: m["contact.phoneCountry.changed"] };
    if (contact.phone_country_unconfirmed !== true && normalisePhone(contact.phone)?.unconfirmed !== true) {
      return { ok: false, error: m["contact.phoneCountry.changed"] };
    }
    const phone = repickPhoneCountry(contact.phone, country);
    if (!phone) return { ok: false, error: m["contact.phoneCountry.unreadable"] };
    const outcome = await setContactPhoneCountry(db, accountId, contactId,
      { expectedPhone: contact.phone, phone, unconfirmed: false }, userId);
    if (outcome === "changed") return { ok: false, error: m["contact.phoneCountry.changed"] };
    revalidateContact(accountId, contactId);
    return { ok: true, phone, previous: { phone: contact.phone, unconfirmed: contact.phone_country_unconfirmed === true } };
  } catch (e) {
    console.error(`setPhoneCountryAction: account ${accountId} contact ${contactId}: ${loggableError(e)}`);
    return { ok: false, error: m["contact.phoneCountry.failed"] };
  }
}

/**
 * The undo toast's write: puts back the phone and flag the pick replaced,
 * while the stored phone is still the one the pick wrote. Its arguments come
 * off the wire, so it only ever restores the SAME national number: a
 * `previous` whose ten digits differ from `picked`'s is refused, and the
 * undo can never become a way to write an arbitrary phone.
 *
 * Off the wire: restores the normaliser's OWN form, and never a flag
 * cleared for a number the normaliser still calls ambiguous, whatever the
 * wire says (review R3-M12).
 */
export async function undoPhoneCountryAction(
  accountId: string, contactId: string, picked: string, previous: PhoneCountryPrevious,
): Promise<PhoneCountryUndoResult> {
  const { userId } = await requireAccountAccess(accountId);
  const sameNumber = typeof picked === "string" && typeof previous?.phone === "string"
    && typeof previous.unconfirmed === "boolean"
    && repickPhoneCountry(picked, "US") !== null
    && repickPhoneCountry(picked, "US") === repickPhoneCountry(previous.phone, "US");
  if (!sameNumber) return { ok: false, error: m["contact.phoneCountry.failed"] };
  const restored = normalisePhone(previous.phone);
  const phone = restored?.e164 ?? previous.phone;
  const unconfirmed = previous.unconfirmed || restored?.unconfirmed === true;
  try {
    const outcome = await setContactPhoneCountry(await dbForRequest(), accountId, contactId,
      { expectedPhone: picked, phone, unconfirmed }, userId);
    if (outcome === "changed") return { ok: false, error: m["contact.phoneCountry.changed"] };
  } catch (e) {
    console.error(`undoPhoneCountryAction: account ${accountId} contact ${contactId}: ${loggableError(e)}`);
    return { ok: false, error: m["contact.phoneCountry.failed"] };
  }
  revalidateContact(accountId, contactId);
  return { ok: true };
}

/**
 * The generic inline field edit's undo (`components/inline-field.tsx`)
 * resubmits the PRIOR text through `updateContactFieldAction` for every
 * field — fine for four of them, wrong for phone once the field has since
 * been edited to a DIFFERENT number: a number already carrying a country
 * code is "kept as given" by the normaliser (F-009,
 * `packages/db/src/phone.ts`'s `international()` branch, which always
 * answers `unconfirmed: false`) and is never re-flagged from its text
 * alone, so restoring a flagged "+1…" number's prior text through the
 * ordinary write always came back CONFIRMED.
 *
 * This is the phone field's dedicated undo: a compare-and-set on the number
 * the EDIT wrote, restoring BOTH the prior phone and its prior flag
 * together, never re-derived from text.
 */
export async function undoInlinePhoneEditAction(
  accountId: string, contactId: string,
  input: { editedPhone: string; priorPhone: string; priorUnconfirmed: boolean },
): Promise<PhoneCountryUndoResult> {
  const { userId } = await requireAccountAccess(accountId);
  if (typeof input.priorUnconfirmed !== "boolean") return { ok: false, error: m["contact.phoneCountry.failed"] };
  try {
    const outcome = await setContactPhoneCountry(await dbForRequest(), accountId, contactId,
      { expectedPhone: input.editedPhone, phone: input.priorPhone, unconfirmed: input.priorUnconfirmed }, userId);
    if (outcome === "changed") return { ok: false, error: m["contact.phoneCountry.changed"] };
  } catch (e) {
    console.error(`undoInlinePhoneEditAction: account ${accountId} contact ${contactId}: ${loggableError(e)}`);
    return { ok: false, error: m["contact.phoneCountry.failed"] };
  }
  revalidateContact(accountId, contactId);
  return { ok: true };
}
