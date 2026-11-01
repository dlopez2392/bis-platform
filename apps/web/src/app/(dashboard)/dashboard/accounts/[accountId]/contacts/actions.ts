"use server";

import { revalidatePath } from "next/cache";
import { requireAccountAccess, requireAccountOwner } from "@/lib/auth";
import { dbForRequest } from "@/lib/db";
import { deleteContacts, addTagToContacts, removeTagFromContacts, updateContact,
         getContact, setContactPhoneCountry, serviceDb,
         assignContacts, undoAssignContacts, type PreviousAssignee,
         setContactsBusiness, undoSetBusiness, GROUP_NAME_MAX, type GroupMemberSnapshot,
         setContactLanguage, restoreContactLanguage, keepContactLanguageHint, isLanguageTriple,
         type ContactLanguage, type LanguageTriple,
         countContactDocuments, purgeContactDocuments } from "@bis/db";
import { addContactByHand } from "@/lib/contacts/add-contact-by-hand";
import { seesWholeAccount } from "@/lib/auth-role";
import { MAX_ASSIGN, MAX_MOVED_TASKS, isUuid, isUuidOrNull, isRefusal } from "@/lib/assign/action-guards";
import { normalisePhone, repickPhoneCountry, type PhoneCountry } from "@bis/db/phone";
import { loggableError } from "@/lib/loggable-error";
import type { PhoneCountryPickResult, PhoneCountryUndoResult, PhoneCountryPrevious } from "@/lib/contacts/phone-country";
import type { PhoneInlineUndo } from "@/lib/contacts/inline-phone-undo";
import { m } from "@/lib/messages";
import { t } from "@/lib/i18n/t";
import { requestLocale } from "@/lib/i18n/request-locale";
import { getPersonPrefs } from "@/lib/preferences/person-prefs";
import type { Locale } from "@/lib/i18n/locale";
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
/** Add contact's refusals, named by key (2026-10-28) so the dialog words them in the reader's
 *  language; `error` stays the English line for any caller that reads only that. */
export type AddContactErrorKey = "contacts.add.blank" | "contacts.add.badEmail" | "contacts.add.badPhone";
export type CreateContactResult =
  | { kind: "created" }
  | { kind: "existing"; contactId: string }
  | { kind: "invalid"; error: string; errorKey?: AddContactErrorKey };

const refuse = (errorKey: AddContactErrorKey): CreateContactResult =>
  ({ kind: "invalid", error: m[errorKey], errorKey });

export async function createContactAction(
  accountId: string, formData: FormData,
): Promise<CreateContactResult> {
  const access = await requireAccountAccess(accountId);
  const val = (k: string) => String(formData.get(k) ?? "").trim();
  const firstName = val("firstName");
  const lastName = val("lastName");
  if (!firstName && !lastName && !val("email") && !val("phone")) {
    return refuse("contacts.add.blank");
  }
  const email = normalizeFieldInput("email", val("email"));
  if (!email.ok) return refuse("contacts.add.badEmail");
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
  if (!phoneField.ok) return refuse("contacts.add.badPhone");

  // F-085 part 1 (spec §8): a customer someone adds by hand is theirs; the
  // narrow path for a caller who cannot see the whole account lives in the
  // shared helper (relationships spec R4 reuses it).
  const db = await dbForRequest();
  const result = await addContactByHand(access, db, accountId, {
    firstName: firstName || undefined, lastName: lastName || undefined,
    email: email.value || undefined, phone: phoneField.value || undefined,
  });
  if (result.existing) return { kind: "existing", contactId: result.id };
  revalidatePath(`/dashboard/accounts/${accountId}/contacts`);
  return { kind: "created" };
}

/** What the assignment controls show for a refusal (spec §8); the copy lives under `assign.*`. */
export type AssignError = "assign.refused" | "assign.failed" | "assign.customerFirst" | "assign.changed";
export type AssignResult = { ok: true; previous: PreviousAssignee[] } | { ok: false; error: AssignError };

/**
 * Owner, Staff and the agency assign customers (spec §8, A2); a Technician
 * never does (M4), nor a client whose role could not be settled. The
 * database refuses them too (0068). Hands back exactly the customers that
 * CHANGED, which is what the Undo takes.
 */
export async function assignContactsAction(
  accountId: string, contactIds: string[], assignee: string | null,
): Promise<AssignResult> {
  const access = await requireAccountAccess(accountId);
  if (!seesWholeAccount(access)) return { ok: false, error: "assign.refused" };
  if (!Array.isArray(contactIds) || contactIds.length === 0 || contactIds.length > MAX_ASSIGN
      || !contactIds.every(isUuid) || !isUuidOrNull(assignee)) {
    return { ok: false, error: "assign.failed" };
  }
  try {
    const previous = await assignContacts(await dbForRequest(), accountId, contactIds, assignee, access.userId);
    revalidatePath(contactsPath(accountId));
    return { ok: true, previous };
  } catch (e) {
    console.error(`assignContactsAction: account ${accountId}: ${loggableError(e)}`);
    return { ok: false, error: isRefusal(e) ? "assign.refused" : "assign.failed" };
  }
}

/** One entry of an Undo as it came back from the browser: every id a UUID (or null where a person may be nobody). */
function isPrevious(p: unknown): p is PreviousAssignee {
  if (typeof p !== "object" || p === null) return false;
  const x = p as Record<string, unknown>;
  return isUuid(x.contactId) && isUuidOrNull(x.assignee) && isUuidOrNull(x.target)
    && Array.isArray(x.movedTaskIds) && x.movedTaskIds.every(isUuid);
}

/**
 * The Undo for assignContactsAction. Exact only through undoAssignContacts,
 * which acts on a customer only while it is still with the call's `target`
 * and moves back ONLY the tasks that call moved: the whole list goes through
 * in ONE call, never regrouped into assignContacts calls, which would pull
 * the new holder's own earlier tasks over (Task 2 review m1). `previous`
 * comes from the browser, so every field is checked before anything is read.
 * An Undo that put back no customer at all answers "assign.changed"; one
 * that put back some is ok.
 */
export async function undoAssignContactsAction(
  accountId: string, previous: PreviousAssignee[],
): Promise<{ ok: true } | { ok: false; error: AssignError }> {
  const access = await requireAccountAccess(accountId);
  if (!seesWholeAccount(access)) return { ok: false, error: "assign.refused" };
  if (!Array.isArray(previous) || previous.length === 0 || previous.length > MAX_ASSIGN || !previous.every(isPrevious)
      || previous.reduce((n, p) => n + p.movedTaskIds.length, 0) > MAX_MOVED_TASKS) {
    return { ok: false, error: "assign.failed" };
  }
  try {
    const { restored } = await undoAssignContacts(await dbForRequest(), accountId, previous, access.userId);
    // Nothing put back: someone handed every one of them on since, and their
    // pick stands. Said as "assign.changed", like the task Undo (final re-review).
    if (restored === 0) return { ok: false, error: "assign.changed" };
    revalidatePath(contactsPath(accountId));
    return { ok: true };
  } catch (e) {
    console.error(`undoAssignContactsAction: account ${accountId}: ${loggableError(e)}`);
    return { ok: false, error: isRefusal(e) ? "assign.refused" : "assign.failed" };
  }
}

const contactsPath = (accountId: string) => `/dashboard/accounts/${accountId}/contacts`;

/** What the Business name's Undo hands back: the server's own record (the phone field's precedent). */
export type BusinessUndo = { added: string | null; removed: GroupMemberSnapshot | null };

/**
 * The contact's Business name is a business GROUP (S-02 §6 row 3, 0069). The
 * request client proves the contact first (a Technician cannot see someone
 * else's customer), then the service client writes, because the group tables
 * are server-written. The column the list shows is kept by the database.
 *
 * `shown` is the name the database STORED (I3): a business already on the
 * list under another spelling keeps ITS spelling ("Beta Roofing" for a typed
 * "beta roofing"), so the field shows that rather than the typed text. An
 * unchanged save reports the spelling the proof read already holds; a real
 * change reads it back after the write. The 120 limit counts characters, as
 * the database's char_length does, not UTF-16 units (M1).
 */
export async function setContactBusinessAction(
  accountId: string, contactId: string, value: string,
  // S-10 T3: default "en" so a caller that predates it is unchanged.
  locale: Locale = "en",
): Promise<{ ok: true; shown: string; undoPayload?: BusinessUndo } | { ok: false; error: string }> {
  const { userId } = await requireAccountAccess(accountId);
  const name = value.trim();
  if ([...name].length > GROUP_NAME_MAX) return { ok: false, error: t(m, "contact.business.tooLong", locale) };
  let db: Awaited<ReturnType<typeof dbForRequest>>;
  let r: Awaited<ReturnType<typeof setContactsBusiness>>[number] | undefined;
  let before: Awaited<ReturnType<typeof getContact>>;
  try {
    db = await dbForRequest();
    before = await getContact(db, accountId, contactId);
    if (!before) return { ok: false, error: t(m, "contacts.action.saveFailed", locale) };
    // S-47e (spec 5.12.3): a shared number's holding record is nobody's business (0098's CHECK refuses one too).
    if (before.holds_shared_number) return { ok: false, error: t(m, "contacts.action.saveFailed", locale) };
    [r] = await setContactsBusiness(serviceDb(), accountId, [{ contactId, name }], userId);
    if (!r || r.status === "not_found") return { ok: false, error: t(m, "contacts.action.saveFailed", locale) };
    if (r.status === "too_long") return { ok: false, error: t(m, "contact.business.tooLong", locale) };
  } catch (e) {
    console.error(`setContactBusinessAction: account ${accountId} contact ${contactId}: ${loggableError(e)}`);
    return { ok: false, error: t(m, "contacts.action.saveFailed", locale) };
  }
  if (r.status === "unchanged") return { ok: true, shown: before.company_name ?? "" };
  // The write has committed by here: a failed read-back costs the canonical
  // spelling (the typed name is shown instead), never the truth that it saved.
  let shown = name;
  try {
    const after = await getContact(db, accountId, contactId);
    // No row read back (not a throw) is the same lost read: keep the typed name.
    shown = after ? (after.company_name ?? "") : name;
  } catch (e) {
    console.error(`setContactBusinessAction: account ${accountId} contact ${contactId}: read-back after save failed: ${loggableError(e)}`);
  }
  revalidatePath(contactsPath(accountId));
  revalidatePath(`${contactsPath(accountId)}/${contactId}`);
  return { ok: true, shown, undoPayload: { added: r.added, removed: r.removed } };
}

export async function undoContactBusinessAction(
  accountId: string, contactId: string, undo: BusinessUndo,
  // S-10 T3: default "en" so a caller that predates it is unchanged.
  locale: Locale = "en",
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { userId } = await requireAccountAccess(accountId);
  const removed = undo?.removed ?? null;
  if (!isUuidOrNull(undo?.added ?? null) || (removed !== null && removed.contact_id !== contactId)) {
    return { ok: false, error: t(m, "contacts.action.undoFailed", locale) };
  }
  try {
    const db = await dbForRequest();
    if (!(await getContact(db, accountId, contactId))) return { ok: false, error: t(m, "contacts.action.undoFailed", locale) };
    // userId: the Undo deletes the membership the write added, and that removal is recorded as the caller's.
    const r = await undoSetBusiness(serviceDb(), accountId, contactId, undo.added, removed, userId);
    if (r !== "ok") return { ok: false, error: t(m, "contacts.action.undoFailed", locale) };
    revalidatePath(contactsPath(accountId));
    revalidatePath(`${contactsPath(accountId)}/${contactId}`);
    return { ok: true };
  } catch (e) {
    console.error(`undoContactBusinessAction: account ${accountId} contact ${contactId}: ${loggableError(e)}`);
    return { ok: false, error: t(m, "contacts.action.undoFailed", locale) };
  }
}

/**
 * S-09 §7.5: a customer's language, chosen by staff. The contact is proved on the CALLER's own client
 * first (getContact under RLS: a Technician reaches only their own customers, 0068), then written on
 * the service client: the client role holds no UPDATE on the language columns (0076, C2). Returns both
 * the PRIOR triple and what this call actually WROTE (`written`): the Undo sends `written` straight
 * back (fix round I3), so the server can refuse it — "changed" — the moment the row no longer holds
 * it, the same compare-and-set every other Undo in this file runs on its own field.
 *
 * Every error here is already in the READER's language (fix round I4, and Task 11's own review of
 * it): resolved the same way the record page does (`requestLocale` + `getPersonPrefs`, #251's
 * pattern) — `isOperator` from `requireAccountAccess`'s own `isAgency`, `userLanguage` from
 * `getPersonPrefs()`, and `account` read fresh off `accounts.language` on the CALLER's own client
 * (RLS; the same column the record page's own `requestLocale` call reads), so a client-role reader
 * with no personal `users.language` still gets the ACCOUNT's language, not a silent fallback to
 * English.
 */
export type LanguageActionResult =
  | { ok: true; prior: LanguageTriple; written: LanguageTriple }
  | { ok: false; error: string };

const isContactLanguage = (v: unknown): v is ContactLanguage => v === "en" || v === "es";

async function languageError(
  key: "contact.language.saveFailed" | "contact.language.changed", accountId: string, isAgency: boolean,
): Promise<{ ok: false; error: string }> {
  // getPersonPrefs() never rejects (its own doc comment): a failed read means defaults, never a thrown action.
  const prefs = await getPersonPrefs();
  let accountLanguageValue: Locale | null = null;
  try {
    const db = await dbForRequest();
    const { data } = await db.from("accounts").select("language").eq("id", accountId).maybeSingle();
    accountLanguageValue = (data?.language as Locale | null | undefined) ?? null;
  } catch {
    // Reading the account's language for an ERROR's own locale must never itself raise a new error;
    // a failed read here still resolves a locale (no account fallback, same as an unthemed account).
  }
  const accountLanguage = { language: accountLanguageValue };
  const locale = requestLocale({ account: accountLanguage, isOperator: isAgency, userLanguage: prefs.language });
  return { ok: false, error: t(m, key, locale) };
}

export async function setContactLanguageAction(
  accountId: string, contactId: string, language: ContactLanguage,
): Promise<LanguageActionResult> {
  const { userId, isAgency } = await requireAccountAccess(accountId);
  if (!isContactLanguage(language)) return await languageError("contact.language.saveFailed", accountId, isAgency);
  try {
    const db = await dbForRequest();
    const before = await getContact(db, accountId, contactId);
    if (!before) return await languageError("contact.language.saveFailed", accountId, isAgency);
    const prior: LanguageTriple = {
      language: (before.language ?? null) as ContactLanguage | null,
      source: (before.language_source ?? null) as LanguageTriple["source"],
      setAt: (before.language_set_at ?? null) as string | null,
    };
    let threw: unknown = null;
    let wrote = false;
    let setAt: string | null = null;
    try {
      const result = await setContactLanguage(serviceDb(), accountId, contactId, language, userId);
      wrote = result.wrote;
      setAt = result.setAt;
    } catch (e) {
      threw = e;
    }
    if (threw) {
      // The read-back here is the RECOVERY path only: the writer threw before it could tell us its
      // own setAt, so the UPDATE's own effect (which may already have committed before the writer's
      // emit() threw — M1, this file's own rule, R3-M11) is the only way left to learn what landed.
      // A thrown write is judged by what the row actually holds, never reported as a failed save just
      // because the event after it did not land.
      const after = await getContact(db, accountId, contactId).catch(() => null);
      console.error(`setContactLanguageAction: account ${accountId} contact ${contactId}: write failed: ${loggableError(threw)}`);
      wrote = after?.language === language && after?.language_source === "staff";
      setAt = (after?.language_set_at ?? null) as string | null;
    }
    if (!wrote) return await languageError("contact.language.saveFailed", accountId, isAgency);
    const written: LanguageTriple = { language, source: "staff", setAt };
    revalidatePath(`${contactsPath(accountId)}/${contactId}`);
    return { ok: true, prior, written };
  } catch (e) {
    console.error(`setContactLanguageAction: account ${accountId} contact ${contactId}: ${loggableError(e)}`);
    return await languageError("contact.language.saveFailed", accountId, isAgency);
  }
}

/**
 * Undo (C9, fix round I3): both `prior` and `written` are validated with `isLanguageTriple` before
 * ANY read, the contact is proved on the CALLER's own client, and only then does the writer's own
 * compare-and-set run — against `written` exactly, so a stale Undo (the language moved on since) or a
 * forged `written` (the browser's own claim, sent back from a `set` that never actually produced it)
 * answers "changed" rather than overwriting whatever is there now.
 */
export async function restoreContactLanguageAction(
  accountId: string, contactId: string, prior: LanguageTriple, written: LanguageTriple,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { userId, isAgency } = await requireAccountAccess(accountId);
  if (!isLanguageTriple(prior) || !isLanguageTriple(written)) {
    return await languageError("contact.language.saveFailed", accountId, isAgency);
  }
  try {
    const db = await dbForRequest();
    if (!(await getContact(db, accountId, contactId))) return await languageError("contact.language.saveFailed", accountId, isAgency);
    const outcome = await restoreContactLanguage(serviceDb(), accountId, contactId, prior, written, userId);
    if (outcome === "changed") return await languageError("contact.language.changed", accountId, isAgency);
    revalidatePath(`${contactsPath(accountId)}/${contactId}`);
    return { ok: true };
  } catch (e) {
    console.error(`restoreContactLanguageAction: account ${accountId} contact ${contactId}: ${loggableError(e)}`);
    return await languageError("contact.language.saveFailed", accountId, isAgency);
  }
}

/** Keep: the hint stays away until a newer sign (§7.4). Nothing about the customer changes, so there is
 *  no `written` to compare against — a thrown write is judged (M1) by whether `language_hint_kept_at`
 *  actually moved off what the proof read saw, never by the event emitted after it. */
export async function keepContactLanguageHintAction(
  accountId: string, contactId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { userId, isAgency } = await requireAccountAccess(accountId);
  try {
    const db = await dbForRequest();
    const before = await getContact(db, accountId, contactId);
    if (!before) return await languageError("contact.language.saveFailed", accountId, isAgency);
    let threw: unknown = null;
    let wrote = false;
    try {
      wrote = await keepContactLanguageHint(serviceDb(), accountId, contactId, userId);
    } catch (e) {
      threw = e;
    }
    if (threw) {
      console.error(`keepContactLanguageHintAction: account ${accountId} contact ${contactId}: write failed: ${loggableError(threw)}`);
      const after = await getContact(db, accountId, contactId).catch(() => null);
      wrote = after != null && after.language_hint_kept_at !== before.language_hint_kept_at;
    }
    if (!wrote) return await languageError("contact.language.saveFailed", accountId, isAgency);
    revalidatePath(`${contactsPath(accountId)}/${contactId}`);
    return { ok: true };
  } catch (e) {
    console.error(`keepContactLanguageHintAction: account ${accountId} contact ${contactId}: ${loggableError(e)}`);
    return await languageError("contact.language.saveFailed", accountId, isAgency);
  }
}

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
  // S-10 T3: default "en" so a caller that predates it is unchanged.
  locale: Locale = "en",
): Promise<{ ok: true; undo?: PhoneInlineUndo } | { ok: false; error: string }> {
  const { userId } = await requireAccountAccess(accountId);
  if (!EDITABLE_FIELDS.includes(field)) return { ok: false, error: t(m, "contacts.action.unknownField", locale) };
  if (field === "company_name") {
    const r = await setContactBusinessAction(accountId, contactId, value, locale);
    return r.ok ? { ok: true } : r;
  }
  const norm = normalizeFieldInput(field, value, locale);
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
    return { ok: false, error: t(m, "contacts.action.saveFailed", locale) };
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
  // S-10 T3: default "en" so a caller that predates it is unchanged.
  locale: Locale = "en",
): Promise<
  | { ok: true; tagId: string; applied: number; addedIds: string[] }
  | { ok: false; error: string }
> {
  await requireAccountAccess(accountId);
  if (contactIds.length === 0 || !tagName.trim()) return { ok: false, error: t(m, "contacts.action.nothingSelected", locale) };
  try {
    const r = await addTagToContacts(await dbForRequest(), accountId, contactIds, tagName);
    revalidatePath(contactsPath(accountId));
    return { ok: true, ...r };
  } catch {
    return { ok: false, error: t(m, "contacts.action.tagFailed", locale) };
  }
}

export async function bulkRemoveTagAction(
  accountId: string, contactIds: string[], tagId: string,
  // S-10 T3: default "en" so a caller that predates it is unchanged.
  locale: Locale = "en",
): Promise<{ ok: true } | { ok: false; error: string }> {
  await requireAccountAccess(accountId);
  try {
    await removeTagFromContacts(await dbForRequest(), accountId, contactIds, tagId);
    revalidatePath(contactsPath(accountId));
    return { ok: true };
  } catch {
    return { ok: false, error: t(m, "contacts.action.undoTagFailed", locale) };
  }
}

export async function bulkDeleteContactsAction(
  accountId: string, contactIds: string[],
  // S-10 T3: default "en" so a caller that predates it is unchanged.
  locale: Locale = "en",
): Promise<
  // skippedIds: every contact kept, blocked or kept late (the bar's "Archive them" archives exactly these).
  // lateKept: of those, the ones the database kept AFTER the purge removed files (the bar's
  // contacts.delete.filesGoneKept line); already counted in skippedBlocked, never added to it.
  | { ok: true; deleted: number; skippedBlocked: number; skippedFiles: number; skippedIds: string[]; lateKept: number }
  | { ok: false; error: string; errorKey?: "contacts.delete.filesGoneKept" }
> {
  // Staff and roles: delete is Owner-only (requireAccountOwner's own doc
  // comment). Staff (and a client whose role could not be settled) are
  // redirected to their own dashboard — never 403'd, and never swallowed
  // into an { ok: false } here, so the redirect actually fires for the
  // caller. 0066's RESTRICTIVE policy refuses the same write at the DB
  // layer too, but this guard runs FIRST: it must never be possible for a
  // refused delete to read back as "deleted: 0" success.
  const { userId } = await requireAccountOwner(accountId);
  if (contactIds.length === 0) return { ok: false, error: t(m, "contacts.action.nothingSelected", locale) };
  // Owner ruling 2026-10-13: a customer's files go with them. deleteContacts proves the deletable ids
  // on the REQUEST client (RLS reads which of these ids are this account's contacts, and drops the
  // linked ones); only those reach beforeDelete, where the purge removes each document's objects and
  // then its row on the SERVICE client (0077: authenticated has no write on documents and none on
  // storage.objects), BEFORE any contact row is deleted. A customer whose files could not all be
  // removed is kept (skippedFiles), and the NO ACTION FK refuses the delete of any contact whose
  // document rows remain.
  let purged = 0;
  try {
    const r = await deleteContacts(await dbForRequest(), accountId, contactIds, {
      // 0103: what blocks a delete for good is read on the service client (contact_delete_blockers is
      // service_role only), only for the ids the request client proved; the delete itself runs on the
      // request client, so the database's own Owner check decides.
      serviceDb: serviceDb(),
      beforeDelete: async (deletable) => {
        const p = await purgeContactDocuments(serviceDb(), accountId, deletable, userId);
        purged = p.purgedDocuments;
        return p.keptContacts;
      },
    });
    revalidatePath(contactsPath(accountId));
    // A contact the database kept late (a text arrived between the blockers read and the lock) lost files
    // only if the purge removed any: with none removed, "the files were deleted" would be untrue.
    return { ok: true, ...r, lateKept: purged > 0 ? r.lateKept : 0 };
  } catch (e) {
    console.error(`contacts delete (account ${accountId}): ${loggableError(e)}`);
    // Files were already removed and then the contact delete failed (most likely a file added between
    // the purge and the delete, which the NO ACTION FK refuses, but ANY failure after a purge leaves
    // the same state): say exactly that, never a plain "try again" that hides the files went.
    if (purged > 0) {
      revalidatePath(contactsPath(accountId));
      return { ok: false, error: t(m, "contacts.action.deleteFailed", locale), errorKey: "contacts.delete.filesGoneKept" };
    }
    return { ok: false, error: t(m, "contacts.action.deleteFailed", locale) };
  }
}

/** The delete dialog's file count (owner ruling 2026-10-13), on the Owner's request client, so RLS
 *  decides what is counted. Never 0 on a failure: a failed or null count is ok:false. */
export async function countContactDocumentsAction(
  accountId: string, contactIds: string[],
): Promise<{ ok: true; count: number } | { ok: false }> {
  // M7a PR-4 (plan G11): a count, so it stays usable while the account is paused (the delete is refused).
  await requireAccountOwner(accountId, { duringPause: "allow" });
  if (!Array.isArray(contactIds) || !contactIds.every((id) => isUuid(id))) return { ok: false };
  if (contactIds.length === 0) return { ok: true, count: 0 };
  try {
    return { ok: true, count: await countContactDocuments(await dbForRequest(), accountId, contactIds.map((id) => id.toLowerCase())) };
  } catch (e) {
    console.error(`contacts delete: file count failed (account ${accountId}): ${loggableError(e)}`);
    return { ok: false };
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
  // S-10 T3: default "en" so a caller that predates it is unchanged.
  locale: Locale = "en",
): Promise<PhoneCountryPickResult> {
  const { userId } = await requireAccountAccess(accountId);
  if (!COUNTRIES.includes(country)) return { ok: false, error: t(m, "contact.phoneCountry.failed", locale) };
  try {
    const db = await dbForRequest();
    const contact = await getContact(db, accountId, contactId);
    if (!contact?.phone) return { ok: false, error: t(m, "contact.phoneCountry.changed", locale) };
    // Fails CLOSED (round 3, IMPORTANT): a `seenPhone` that is missing or
    // does not itself read as a ten-digit-based number answers "changed"
    // rather than falling through — an empty stub (a `?peek=` row) or an
    // unseen number must never be treated as "no opinion, proceed".
    const seenReads = repickPhoneCountry(seenPhone, "US");
    if (seenReads === null || repickPhoneCountry(contact.phone, "US") !== seenReads) {
      return { ok: false, error: t(m, "contact.phoneCountry.changed", locale) };
    }
    if (contact.phone_country_unconfirmed !== true && normalisePhone(contact.phone)?.unconfirmed !== true) {
      return { ok: false, error: t(m, "contact.phoneCountry.changed", locale) };
    }
    const phone = repickPhoneCountry(contact.phone, country);
    if (!phone) return { ok: false, error: t(m, "contact.phoneCountry.unreadable", locale) };
    const outcome = await setContactPhoneCountry(db, accountId, contactId,
      { expectedPhone: contact.phone, phone, unconfirmed: false }, userId);
    if (outcome === "changed") return { ok: false, error: t(m, "contact.phoneCountry.changed", locale) };
    revalidateContact(accountId, contactId);
    return { ok: true, phone, previous: { phone: contact.phone, unconfirmed: contact.phone_country_unconfirmed === true } };
  } catch (e) {
    console.error(`setPhoneCountryAction: account ${accountId} contact ${contactId}: ${loggableError(e)}`);
    return { ok: false, error: t(m, "contact.phoneCountry.failed", locale) };
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
  // S-10 T3: default "en" so a caller that predates it is unchanged.
  locale: Locale = "en",
): Promise<PhoneCountryUndoResult> {
  const { userId } = await requireAccountAccess(accountId);
  const sameNumber = typeof picked === "string" && typeof previous?.phone === "string"
    && typeof previous.unconfirmed === "boolean"
    && repickPhoneCountry(picked, "US") !== null
    && repickPhoneCountry(picked, "US") === repickPhoneCountry(previous.phone, "US");
  if (!sameNumber) return { ok: false, error: t(m, "contact.phoneCountry.failed", locale) };
  const restored = normalisePhone(previous.phone);
  const phone = restored?.e164 ?? previous.phone;
  const unconfirmed = previous.unconfirmed || restored?.unconfirmed === true;
  try {
    const outcome = await setContactPhoneCountry(await dbForRequest(), accountId, contactId,
      { expectedPhone: picked, phone, unconfirmed }, userId);
    if (outcome === "changed") return { ok: false, error: t(m, "contact.phoneCountry.changed", locale) };
  } catch (e) {
    console.error(`undoPhoneCountryAction: account ${accountId} contact ${contactId}: ${loggableError(e)}`);
    return { ok: false, error: t(m, "contact.phoneCountry.failed", locale) };
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
  // S-10 T3: default "en" so a caller that predates it is unchanged.
  locale: Locale = "en",
): Promise<PhoneCountryUndoResult> {
  const { userId } = await requireAccountAccess(accountId);
  if (
    (undo?.editedPhone !== null && typeof undo?.editedPhone !== "string") ||
    (undo?.priorPhone !== null && typeof undo?.priorPhone !== "string") ||
    typeof undo?.priorUnconfirmed !== "boolean"
  ) {
    return { ok: false, error: t(m, "contact.phoneCountry.failed", locale) };
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
    if (outcome === "changed") return { ok: false, error: t(m, "contact.phoneCountry.inlineChanged", locale) };
  } catch (e) {
    console.error(`undoInlinePhoneEditAction: account ${accountId} contact ${contactId}: ${loggableError(e)}`);
    return { ok: false, error: t(m, "contact.phoneCountry.failed", locale) };
  }
  revalidateContact(accountId, contactId);
  return { ok: true };
}
