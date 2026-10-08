"use server";

import { revalidatePath } from "next/cache";
import { requireAccountAccess } from "@/lib/auth";
import { dbForRequest } from "@/lib/db";
import { createContact, deleteContacts, addTagToContacts, removeTagFromContacts, updateContact,
         getContact, setContactPhoneCountry } from "@bis/db";
import { normalisePhone, repickPhoneCountry, type PhoneCountry } from "@bis/db/phone";
import { loggableError } from "@/lib/loggable-error";
import type { PhoneCountryPickResult, PhoneCountryUndoResult, PhoneCountryPrevious } from "@/lib/contacts/phone-country";
import type { PhoneInlineUndo } from "@/lib/contacts/inline-phone-undo";
import { m } from "@/lib/messages";
import { EDITABLE_FIELDS, FIELD_TO_INPUT_KEY, normalizeFieldInput,
         type EditableField } from "@/lib/contacts/field-input";

/**
 * D-013: Add contact used to save an all-blank contact (no name, email or
 * phone — nothing a person could ever find it by again), never checked an
 * email or phone's SHAPE at all (a typo like "not-an-email" saved as typed),
 * and on a dedupe match `createContact` already silently returned
 * (`{ existing: true, id }`) the dialog just closed as if a NEW contact had
 * been made — the operator learns nothing and the existing record goes
 * unlinked. `normalizeFieldInput` (lib/contacts/field-input.ts) is the SAME
 * shape check inline editing and the CSV importer already use — reused
 * here, not re-implemented, so "what looks like an email" has one answer
 * everywhere it's asked.
 */
export type CreateContactResult =
  | { kind: "created" }
  | { kind: "existing"; contactId: string }
  | { kind: "invalid"; error: string };

export async function createContactAction(
  accountId: string, formData: FormData,
): Promise<CreateContactResult> {
  const { userId } = await requireAccountAccess(accountId);
  const val = (k: string) => String(formData.get(k) ?? "").trim();
  const firstName = val("firstName");
  const lastName = val("lastName");
  if (!firstName && !lastName && !val("email") && !val("phone")) {
    return { kind: "invalid", error: m["contacts.add.blank"] };
  }
  const email = normalizeFieldInput("email", val("email"));
  if (!email.ok) return { kind: "invalid", error: email.error };
  // Named `phoneField`, not `phone`: this file's OWN scan (F-009,
  // scans.test.ts) tracks a "local that carries a normaliser's number" by
  // name across the WHOLE FILE, not per function — `setPhoneCountryAction`,
  // `undoPhoneCountryAction` and `undoInlinePhoneEditAction` below each have
  // their own local named `phone` that genuinely IS a normaliser's number
  // (PHONE_KEY_ONLY, allowed there, under a phone KEY rather than handed to
  // a contact write). A local here ALSO named `phone` collided with those
  // three across the file and made the scan misread this write — which
  // hands `createContact` the number exactly as `normalizeFieldInput`
  // returned it (trimmed, unvalidated-shape-only, never normalised; the
  // SAME value `updateContactFieldAction`'s own `norm.value` below writes)
  // — as if it carried one of theirs.
  const phoneField = normalizeFieldInput("phone", val("phone"));
  if (!phoneField.ok) return { kind: "invalid", error: phoneField.error };

  const result = await createContact(await dbForRequest(), accountId, {
    firstName: firstName || undefined, lastName: lastName || undefined,
    email: email.value || undefined, phone: phoneField.value || undefined,
  }, userId);
  if (result.existing) return { kind: "existing", contactId: result.id };
  revalidatePath(`/dashboard/accounts/${accountId}/contacts`);
  return { kind: "created" };
}

const contactsPath = (accountId: string) => `/dashboard/accounts/${accountId}/contacts`;

/**
 * For the PHONE field only: `undo` carries what the server itself read and
 * wrote, so the inline Undo restores exactly that — never a value the
 * client captured (review C1: the drawer's own summary can be stale, or
 * defaulted `false` while loading or on a failed fetch, because an inline
 * edit never bumps `retryNonce`) and never `norm.value`, the TYPED text
 * (review I1: the stored column is rarely equal to it — `phoneFields`
 * normalises to E.164, so "(956) 292-1696" is stored as "+19562921696").
 * `undefined` when there was no PRIOR real number to restore (a first fill
 * from empty): Undo then falls back to the ordinary `save("")`, which has
 * no ambiguity to get wrong.
 */
export async function updateContactFieldAction(
  accountId: string, contactId: string, field: EditableField, value: string,
): Promise<{ ok: true; undo?: PhoneInlineUndo } | { ok: false; error: string }> {
  const { userId } = await requireAccountAccess(accountId);
  if (!EDITABLE_FIELDS.includes(field)) return { ok: false, error: "Unknown field." };
  const norm = normalizeFieldInput(field, value);
  if (!norm.ok) return norm;
  // Round 4 (m4): `dbForRequest()` moves back INSIDE the try — a throw here
  // is a failed save (the operator typed something and nothing happened),
  // never the "crashed" toast, which is for a stale server-action id.
  let db: Awaited<ReturnType<typeof dbForRequest>>;
  // `null` (round 4, DESIGN.md rule 6): a FIRST fill from empty still gets
  // a real prior to restore — "no prior real number" is `null`, not "skip
  // this field entirely". `undefined` alone means "not the phone field".
  let priorPhone: string | null | undefined;
  let priorUnconfirmed = false;
  try {
    db = await dbForRequest();
    if (field === "phone") {
      const before = await getContact(db, accountId, contactId);
      priorPhone = typeof before?.phone === "string" ? before.phone : null;
      priorUnconfirmed = before?.phone_country_unconfirmed === true;
    }
    await updateContact(db, accountId, contactId, { [FIELD_TO_INPUT_KEY[field]]: norm.value }, userId);
  } catch {
    return { ok: false, error: "Save failed — please try again." };
  }
  // The write has already committed by here: a failed read-back (m4) costs
  // the Undo button, never the truth that the edit went through — this
  // never turns into "Save failed" for a save that actually succeeded.
  // `editedPhone` may be `null` (a CLEAR): the phone field's Undo must be
  // offered for that too (round 3, CRITICAL — see inline-phone-undo.ts).
  let undo: PhoneInlineUndo | undefined;
  if (field === "phone" && priorPhone !== undefined) {
    try {
      const after = await getContact(db, accountId, contactId);
      undo = { priorPhone, priorUnconfirmed, editedPhone: after?.phone ?? null };
    } catch (e) {
      console.error(`updateContactFieldAction: account ${accountId} contact ${contactId}: read-back after save failed: ${loggableError(e)}`);
    }
  }
  revalidatePath(contactsPath(accountId));
  revalidatePath(`${contactsPath(accountId)}/${contactId}`);
  return undo ? { ok: true, undo } : { ok: true };
}

export async function bulkAddTagAction(
  accountId: string, contactIds: string[], tagName: string,
): Promise<
  | { ok: true; tagId: string; applied: number; addedIds: string[] }
  | { ok: false; error: string }
> {
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
 *
 * `seenPhone` (review I3) is the phone the ROW RENDERED WITH, not merely
 * the one this call re-reads: the compare-and-set below is judged against
 * it, so a number someone else changed to another AMBIGUOUS number, between
 * this row's render and the operator's click, answers "changed" rather than
 * being re-coded unseen.
 */
export async function setPhoneCountryAction(
  accountId: string, contactId: string, country: PhoneCountry, seenPhone: string,
): Promise<PhoneCountryPickResult> {
  const { userId } = await requireAccountAccess(accountId);
  if (!COUNTRIES.includes(country)) return { ok: false, error: m["contact.phoneCountry.failed"] };
  try {
    const db = await dbForRequest();
    const contact = await getContact(db, accountId, contactId);
    if (!contact?.phone) return { ok: false, error: m["contact.phoneCountry.changed"] };
    // Fails CLOSED (round 3, IMPORTANT): a `seenPhone` that is missing or
    // does not itself read as a ten-digit-based number answers "changed"
    // rather than falling through — an empty stub (a `?peek=` row) or an
    // unseen number must never be treated as "no opinion, proceed".
    const seenReads = repickPhoneCountry(seenPhone, "US");
    if (seenReads === null || repickPhoneCountry(contact.phone, "US") !== seenReads) {
      return { ok: false, error: m["contact.phoneCountry.changed"] };
    }
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
 * field — fine for four of them, wrong for phone: a number already carrying
 * a country code is "kept as given" by the normaliser (F-009,
 * `packages/db/src/phone.ts`'s `international()` branch, which always
 * answers `unconfirmed: false`) and is never re-flagged from its text
 * alone, so restoring a flagged "+1…" number's prior TEXT through the
 * ordinary write can come back CONFIRMED.
 *
 * Server-authoritative (fixes a first version's I1/C1): every field of
 * `undo` is exactly what `updateContactFieldAction` itself read and wrote
 * for THIS save — never a value the client captured — so this is a
 * compare-and-set on the number the edit ACTUALLY wrote (`editedPhone`, the
 * stored column, not the typed text), restoring the prior phone and its
 * prior flag together, never re-derived from text.
 */
export async function undoInlinePhoneEditAction(
  accountId: string, contactId: string, undo: PhoneInlineUndo,
): Promise<PhoneCountryUndoResult> {
  const { userId } = await requireAccountAccess(accountId);
  if (
    (undo?.editedPhone !== null && typeof undo?.editedPhone !== "string") ||
    (undo?.priorPhone !== null && typeof undo?.priorPhone !== "string") ||
    typeof undo?.priorUnconfirmed !== "boolean"
  ) {
    return { ok: false, error: m["contact.phoneCountry.failed"] };
  }
  // R3-M12 floor: restore the NORMALISER's own form of the prior text, and
  // never a flag cleared for a number the normaliser still calls ambiguous,
  // whatever the caller says. `priorPhone: null` (round 4, DESIGN.md rule
  // 6, a first fill undone) restores null — nothing to normalise.
  const restored = undo.priorPhone === null ? null : normalisePhone(undo.priorPhone);
  const phone = undo.priorPhone === null ? null : (restored?.e164 ?? undo.priorPhone);
  const unconfirmed = undo.priorUnconfirmed || restored?.unconfirmed === true;
  try {
    const outcome = await setContactPhoneCountry(await dbForRequest(), accountId, contactId,
      { expectedPhone: undo.editedPhone, phone, unconfirmed }, userId);
    if (outcome === "changed") return { ok: false, error: m["contact.phoneCountry.inlineChanged"] };
  } catch (e) {
    console.error(`undoInlinePhoneEditAction: account ${accountId} contact ${contactId}: ${loggableError(e)}`);
    return { ok: false, error: m["contact.phoneCountry.failed"] };
  }
  revalidateContact(accountId, contactId);
  return { ok: true };
}
