"use server";

import type { SupabaseClient } from "@bis/db";
import { requireAccountAccess } from "@/lib/auth";
import { seesWholeAccount } from "@/lib/auth-role";
import { dbForRequest } from "@/lib/db";
import {
  getContact, readGroup, getPlace, getEquipment, addPlace, updatePlace, setPlaceOwner, removePlace, setPlaceArchived,
  restorePlace, addEquipment, replaceEquipment, updateEquipment, removeEquipment, restoreEquipment,
  type PlaceRow, type EquipmentRow, type PlaceOwner, type PlaceCtx,
} from "@bis/db";
import { isUuid } from "@/lib/assign/action-guards";
import { loggableError } from "@/lib/loggable-error";
import {
  parseOwner, parsePlaceFields, parsePlacePatch, parseEquipmentFields, parseEquipmentPatch,
  parsePlaceSnapshot, parseEquipmentSnapshot, type InputError,
} from "@/lib/contacts/place-input";
import { placeErrorFor, placeErrorCode, type PlaceErrorKey } from "@/lib/contacts/place-errors";
import { accountTodayForWrite } from "@/lib/contacts/account-today";

/**
 * Properties and equipment (spec §6). Every write runs on the request client, never the service
 * client (C4), so 0071's RLS, its Technician fences and its two triggers bind it. Before any write:
 * the record is proven readable on that client (getContact, or readGroup on a group's own page, S-03
 * part 2), and the target is read on it and must be ON the record: the record's own property, or one
 * shared by a group the record belongs to (a group's record is its own properties only). So an
 * action can never write a property the caller cannot read, nor record an event against a record
 * the property is not on (events carry the record's id as `contactId`, or `groupId` for a group).
 *
 * places.ts answers a change that changes nothing with the stored row and no write (review round
 * 1). Every change a caller may not make is therefore refused HERE, before places.ts: the owner
 * change for anyone who does not see the whole account (a Technician, or an unsettled role: fails
 * closed, lib/auth-role.ts), even when it would change nothing. Everything else a Technician can
 * read, 0071 lets them write (spec §4, O2: its with-checks are the same reach as its reads).
 *
 * Every answer is a messages.ts KEY with its params, never translated text: the card translates it
 * in the reader's language. Ids from the browser are compared lowercased (PostgREST echoes them
 * lowercase). Every payload from the browser, an Undo's snapshot included, is re-validated by
 * place-input.ts before it reaches a query. Nothing is revalidated: the card re-reads its own route.
 */
export type PlaceActionError = { ok: false; error: string; params?: Record<string, string | number> };
export type PlaceRemovalUndo = { mode: "deleted"; snapshot: PlaceRow } | { mode: "archived"; placeId: string };
type Ok = { ok: true };

const refused: PlaceActionError = { ok: false, error: "places.refused" };
const invalid: PlaceActionError = { ok: false, error: "places.error.invalid" };
const moveRefused: PlaceActionError = { ok: false, error: "places.moveRefused" };
const inputError = (e: InputError): PlaceActionError => (e.params ? { ok: false, error: e.key, params: e.params } : { ok: false, error: e.key });

/** The two refusals the database is expected to raise on a person's own write; every other code is logged. */
const EXPECTED_CODES = new Set(["42501", "23505"]);

function fail(where: string, accountId: string, e: unknown, map: (e: unknown) => PlaceErrorKey = placeErrorFor): PlaceActionError {
  const code = placeErrorCode(e);
  if (code === undefined || !EXPECTED_CODES.has(code)) console.error(`${where} (account ${accountId}): ${loggableError(e)}`);
  return { ok: false, error: map(e) };
}

/** Spec §7: an Undo the database refuses (its row is back already, or what it hung on is gone) is "Couldn't put it back." */
const undoErrorFor = (e: unknown): PlaceErrorKey => {
  const code = placeErrorCode(e);
  return code === "23505" || code === "23503" ? "places.error.undoFailed" : placeErrorFor(e);
};
/** Spec §6: the owner guard's 42501 says who may move a property, not that the property is closed to the caller. */
const ownerErrorFor = (e: unknown): PlaceErrorKey => (placeErrorCode(e) === "42501" ? "places.moveRefused" : placeErrorFor(e));

/** The browser never gets the author's Clerk subject (the route strips it too); the parsers accept null. */
const forBrowser = <R extends { created_by: string | null }>(row: R): R => ({ ...row, created_by: null });

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** C12 (S-03 part 2): the record an action is taken from is a contact (a uuid, as every caller has
 *  passed since 0071) or a group, on the group's own page. Parsed, never trusted: it came from a browser. */
export type PlaceSubjectArg = string | { kind: "group"; id: string };
type PlaceSubject = { kind: "contact" | "group"; id: string };
function subjectOf(raw: unknown): PlaceSubject | null {
  if (typeof raw === "string") return isUuid(raw) ? { kind: "contact", id: raw.toLowerCase() } : null;
  if (isRecord(raw) && raw.kind === "group" && isUuid(raw.id)) return { kind: "group", id: raw.id.toLowerCase() };
  return null;
}
/** A contact's ctx is the shape it has been since 0071 (places.ts defaults a missing kind to contact). */
const ctxFor = (subject: PlaceSubject, access: { userId: string }): PlaceCtx =>
  subject.kind === "group"
    ? { subjectId: subject.id, subjectKind: "group", actorId: access.userId }
    : { subjectId: subject.id, actorId: access.userId };
const lowerOwner = (o: PlaceOwner): PlaceOwner =>
  o.contactId !== null ? { contactId: o.contactId.toLowerCase(), groupId: null } : { contactId: null, groupId: o.groupId.toLowerCase() };

async function recordVisible(db: SupabaseClient, accountId: string, subject: PlaceSubject): Promise<boolean> {
  return subject.kind === "group"
    ? Boolean(await readGroup(db, accountId, subject.id))
    : Boolean(await getContact(db, accountId, subject.id));
}

/** Is the record a member of this group, as the caller's own client reads it? */
async function inGroup(db: SupabaseClient, accountId: string, subject: string, groupId: string): Promise<boolean> {
  const { data, error } = await db.from("client_group_members").select("id")
    .eq("account_id", accountId).eq("contact_id", subject).eq("client_group_id", groupId.toLowerCase()).limit(1);
  if (error) throw error;
  return (data ?? []).length > 0;
}

/** The record's own: a contact's own place or one shared by its groups; a group's own place only
 *  (C12: a member's own places are on the member's page, never the group's). */
async function ownedByRecord(
  db: SupabaseClient, accountId: string, subject: PlaceSubject, owner: Pick<PlaceRow, "contact_id" | "client_group_id">,
): Promise<boolean> {
  if (subject.kind === "group") return owner.contact_id === null && owner.client_group_id?.toLowerCase() === subject.id;
  if (owner.contact_id !== null) return owner.contact_id.toLowerCase() === subject.id;
  if (owner.client_group_id !== null) return inGroup(db, accountId, subject.id, owner.client_group_id);
  return false;
}
const ownerAsRow = (o: PlaceOwner) => ({ contact_id: o.contactId, client_group_id: o.groupId });

/** The place, read on the caller's client and on this record; null refuses. */
async function placeOnRecord(db: SupabaseClient, accountId: string, subject: PlaceSubject, placeId: string): Promise<PlaceRow | null> {
  const place = await getPlace(db, accountId, placeId.toLowerCase());
  return place && (await ownedByRecord(db, accountId, subject, place)) ? place : null;
}

/** The unit, read on the caller's client, at a place on this record; null refuses. */
async function unitOnRecord(db: SupabaseClient, accountId: string, subject: PlaceSubject, equipmentId: string): Promise<EquipmentRow | null> {
  const unit = await getEquipment(db, accountId, equipmentId.toLowerCase());
  return unit && (await placeOnRecord(db, accountId, subject, unit.place_id)) ? unit : null;
}

export async function addPlaceAction(
  accountId: string, subjectArg: PlaceSubjectArg, raw: unknown,
): Promise<{ ok: true; place: PlaceRow } | PlaceActionError> {
  const access = await requireAccountAccess(accountId);
  const subject = subjectOf(subjectArg);
  if (!subject) return invalid;
  const rawOwner = isRecord(raw) ? raw.owner : undefined;
  // No owner named: the record's own property (the add form's default), a group's on a group's page.
  const own: PlaceOwner = subject.kind === "group" ? { contactId: null, groupId: subject.id } : { contactId: subject.id, groupId: null };
  const named = rawOwner === undefined || rawOwner === null || rawOwner === "" ? own : parseOwner(rawOwner);
  if (!named) return invalid;
  const owner = lowerOwner(named);
  const parsed = parsePlaceFields(raw);
  if (!parsed.ok) return inputError(parsed.error);
  const db = await dbForRequest();
  try {
    if (!(await recordVisible(db, accountId, subject))) return refused;
    if (!(await ownedByRecord(db, accountId, subject, ownerAsRow(owner)))) return refused;
    const row = await addPlace(db, accountId, owner, parsed.fields, ctxFor(subject, access));
    return { ok: true, place: forBrowser(row) };
  } catch (e) {
    return fail("addPlaceAction", accountId, e);
  }
}

export async function updatePlaceFieldAction(
  accountId: string, subjectArg: PlaceSubjectArg, placeId: string, field: string, value: string,
): Promise<Ok | PlaceActionError> {
  const access = await requireAccountAccess(accountId);
  const subject = subjectOf(subjectArg);
  if (!subject || !isUuid(placeId)) return invalid;
  const db = await dbForRequest();
  try {
    if (!(await recordVisible(db, accountId, subject))) return refused;
    const place = await placeOnRecord(db, accountId, subject, placeId);
    if (!place) return refused;
    // The at-least-one rule reads the row as stored, so clearing the last way to find it is refused here.
    const parsed = parsePlacePatch(field, value, place);
    if (!parsed.ok) return inputError(parsed.error);
    const result = await updatePlace(db, accountId, place.id, parsed.patch, ctxFor(subject, access));
    return result === "not_found" || result === "refused" ? refused : { ok: true };
  } catch (e) {
    return fail("updatePlaceFieldAction", accountId, e);
  }
}

export async function setPlaceOwnerAction(
  accountId: string, subjectArg: PlaceSubjectArg, placeId: string, owner: string,
): Promise<Ok | PlaceActionError> {
  const access = await requireAccountAccess(accountId);
  const subject = subjectOf(subjectArg);
  if (!subject || !isUuid(placeId)) return invalid;
  // C12 (S-03 part 2): no "Move to" on a group's page, for anyone; refused before anything is read.
  if (subject.kind === "group") return refused;
  // Owner and Staff work (spec §4, §5.3). Refused before anything is read, a change that would
  // change nothing included: places.ts answers that one without a write, so it would read as "ok".
  if (!seesWholeAccount(access)) return moveRefused;
  const named = parseOwner(owner);
  if (!named) return invalid;
  const next = lowerOwner(named);
  const db = await dbForRequest();
  try {
    if (!(await recordVisible(db, accountId, subject))) return refused;
    const place = await placeOnRecord(db, accountId, subject, placeId);
    if (!place) return refused;
    if (!(await ownedByRecord(db, accountId, subject, ownerAsRow(next)))) return refused;
    const result = await setPlaceOwner(db, accountId, place.id, next, ctxFor(subject, access));
    return result === "not_found" || result === "refused" ? refused : { ok: true };
  } catch (e) {
    return fail("setPlaceOwnerAction", accountId, e, ownerErrorFor);
  }
}

export async function removePlaceAction(
  accountId: string, subjectArg: PlaceSubjectArg, placeId: string,
): Promise<{ ok: true; undo: PlaceRemovalUndo } | PlaceActionError> {
  const access = await requireAccountAccess(accountId);
  const subject = subjectOf(subjectArg);
  if (!subject || !isUuid(placeId)) return invalid;
  const db = await dbForRequest();
  try {
    if (!(await recordVisible(db, accountId, subject))) return refused;
    const place = await placeOnRecord(db, accountId, subject, placeId);
    if (!place) return refused;
    // Already removed (stale card): places.ts would answer it unwritten, and its Undo would put back
    // a property this call never removed. Refused: nothing is left for this call to remove.
    if (place.archived_at !== null) return refused;
    const result = await removePlace(db, accountId, place.id, ctxFor(subject, access));
    if (result === "not_found" || result === "refused") return refused;
    return result.mode === "deleted"
      ? { ok: true, undo: { mode: "deleted", snapshot: forBrowser(result.snapshot) } }
      : { ok: true, undo: { mode: "archived", placeId: result.row.id } };
  } catch (e) {
    return fail("removePlaceAction", accountId, e);
  }
}

/** The Undo comes back from the browser: exactly one of the two shapes removePlaceAction hands out. */
function parseRemovalUndo(v: unknown, accountId: string): PlaceRemovalUndo | null {
  if (!isRecord(v) || Object.keys(v).length !== 2) return null;
  if (v.mode === "deleted") {
    const snapshot = parsePlaceSnapshot(v.snapshot, accountId);
    return snapshot ? { mode: "deleted", snapshot } : null;
  }
  if (v.mode === "archived" && isUuid(v.placeId)) return { mode: "archived", placeId: v.placeId.toLowerCase() };
  return null;
}

export async function undoRemovePlaceAction(accountId: string, subjectArg: PlaceSubjectArg, undo: unknown): Promise<Ok | PlaceActionError> {
  const access = await requireAccountAccess(accountId);
  const parsed = parseRemovalUndo(undo, accountId);
  const subject = subjectOf(subjectArg);
  if (!subject || !parsed) return invalid;
  const ctx = ctxFor(subject, access);
  const db = await dbForRequest();
  try {
    if (!(await recordVisible(db, accountId, subject))) return refused;
    if (parsed.mode === "deleted") {
      // The row is gone, so its own snapshot names the owner; that owner must be on this record.
      if (!(await ownedByRecord(db, accountId, subject, parsed.snapshot))) return refused;
      await restorePlace(db, accountId, parsed.snapshot, ctx);
      return { ok: true };
    }
    const place = await placeOnRecord(db, accountId, subject, parsed.placeId);
    if (!place) return refused;
    const result = await setPlaceArchived(db, accountId, place.id, false, ctx);
    return result === "not_found" || result === "refused" ? refused : { ok: true };
  } catch (e) {
    return fail("undoRemovePlaceAction", accountId, e, undoErrorFor);
  }
}

export async function setPlaceArchivedAction(
  accountId: string, subjectArg: PlaceSubjectArg, placeId: string, archived: boolean,
): Promise<Ok | PlaceActionError> {
  const access = await requireAccountAccess(accountId);
  const subject = subjectOf(subjectArg);
  if (!subject || !isUuid(placeId) || typeof archived !== "boolean") return invalid;
  const db = await dbForRequest();
  try {
    if (!(await recordVisible(db, accountId, subject))) return refused;
    const place = await placeOnRecord(db, accountId, subject, placeId);
    if (!place) return refused;
    const result = await setPlaceArchived(db, accountId, place.id, archived, ctxFor(subject, access));
    return result === "not_found" || result === "refused" ? refused : { ok: true };
  } catch (e) {
    return fail("setPlaceArchivedAction", accountId, e);
  }
}

export async function addEquipmentAction(
  accountId: string, subjectArg: PlaceSubjectArg, placeId: string, raw: unknown,
): Promise<{ ok: true; unit: EquipmentRow } | PlaceActionError> {
  const access = await requireAccountAccess(accountId);
  const subject = subjectOf(subjectArg);
  if (!subject || !isUuid(placeId)) return invalid;
  const db = await dbForRequest();
  try {
    if (!(await recordVisible(db, accountId, subject))) return refused;
    const place = await placeOnRecord(db, accountId, subject, placeId);
    if (!place) return refused;
    const parsed = parseEquipmentFields(raw, await accountTodayForWrite(db, accountId), { replacement: false });
    if (!parsed.ok) return inputError(parsed.error);
    const row = await addEquipment(db, accountId, place.id, parsed.fields, ctxFor(subject, access));
    return { ok: true, unit: forBrowser(row) };
  } catch (e) {
    return fail("addEquipmentAction", accountId, e);
  }
}

export async function replaceEquipmentAction(
  accountId: string, subjectArg: PlaceSubjectArg, equipmentId: string, raw: unknown,
): Promise<{ ok: true; unit: EquipmentRow } | PlaceActionError> {
  const access = await requireAccountAccess(accountId);
  const subject = subjectOf(subjectArg);
  if (!subject || !isUuid(equipmentId)) return invalid;
  const db = await dbForRequest();
  try {
    if (!(await recordVisible(db, accountId, subject))) return refused;
    const old = await unitOnRecord(db, accountId, subject, equipmentId);
    if (!old) return refused;
    // A replacement must carry its date (0071's equipment_replacement_dated), not after the account's today.
    const parsed = parseEquipmentFields(raw, await accountTodayForWrite(db, accountId), { replacement: true });
    if (!parsed.ok) return inputError(parsed.error);
    const result = await replaceEquipment(db, accountId, old.id, parsed.fields, ctxFor(subject, access));
    return result === "not_found" ? refused : { ok: true, unit: forBrowser(result) };
  } catch (e) {
    return fail("replaceEquipmentAction", accountId, e);
  }
}

export async function updateEquipmentFieldAction(
  accountId: string, subjectArg: PlaceSubjectArg, equipmentId: string, field: string, value: string,
): Promise<Ok | PlaceActionError> {
  const access = await requireAccountAccess(accountId);
  const subject = subjectOf(subjectArg);
  if (!subject || !isUuid(equipmentId)) return invalid;
  const db = await dbForRequest();
  try {
    if (!(await recordVisible(db, accountId, subject))) return refused;
    const unit = await unitOnRecord(db, accountId, subject, equipmentId);
    if (!unit) return refused;
    // The warranty order reads the unit as stored, so the other date is the database's, not the browser's.
    const parsed = parseEquipmentPatch(field, value, await accountTodayForWrite(db, accountId), unit);
    if (!parsed.ok) return inputError(parsed.error);
    const result = await updateEquipment(db, accountId, unit.id, parsed.patch, ctxFor(subject, access));
    return result === "not_found" || result === "refused" ? refused : { ok: true };
  } catch (e) {
    return fail("updateEquipmentFieldAction", accountId, e);
  }
}

export async function removeEquipmentAction(
  accountId: string, subjectArg: PlaceSubjectArg, equipmentId: string,
): Promise<{ ok: true; snapshot: EquipmentRow } | PlaceActionError> {
  const access = await requireAccountAccess(accountId);
  const subject = subjectOf(subjectArg);
  if (!subject || !isUuid(equipmentId)) return invalid;
  const db = await dbForRequest();
  try {
    if (!(await recordVisible(db, accountId, subject))) return refused;
    const unit = await unitOnRecord(db, accountId, subject, equipmentId);
    if (!unit) return refused;
    const result = await removeEquipment(db, accountId, unit.id, ctxFor(subject, access));
    return result === "not_found" || result === "refused" ? refused : { ok: true, snapshot: forBrowser(result) };
  } catch (e) {
    return fail("removeEquipmentAction", accountId, e);
  }
}

export async function undoRemoveEquipmentAction(accountId: string, subjectArg: PlaceSubjectArg, snapshot: unknown): Promise<Ok | PlaceActionError> {
  const access = await requireAccountAccess(accountId);
  const subject = subjectOf(subjectArg);
  if (!subject) return invalid;
  const db = await dbForRequest();
  try {
    if (!(await recordVisible(db, accountId, subject))) return refused;
    // Re-validated as an add would be, the account's today included: no future install date via Undo.
    const parsed = parseEquipmentSnapshot(snapshot, accountId, await accountTodayForWrite(db, accountId));
    if (!parsed) return invalid;
    // The unit is gone; the place it returns to must still be readable and on this record.
    if (!(await placeOnRecord(db, accountId, subject, parsed.place_id))) return refused;
    await restoreEquipment(db, accountId, parsed, ctxFor(subject, access));
    return { ok: true };
  } catch (e) {
    return fail("undoRemoveEquipmentAction", accountId, e, undoErrorFor);
  }
}
