"use server";

import { revalidatePath } from "next/cache";
import type { SupabaseClient } from "@bis/db";
import { requireAccountAccess } from "@/lib/auth";
import { seesWholeAccount } from "@/lib/auth-role";
import { dbForRequest } from "@/lib/db";
import {
  getContact, listContacts, getRelationship, addRelationship, setRelationshipSides, removeRelationship,
  restoreRelationship, type RelationshipRow, type RelationshipSidesPatch,
} from "@bis/db";
import { isUuid } from "@/lib/assign/action-guards";
import { loggableError } from "@/lib/loggable-error";
import { normalizeFieldInput } from "@/lib/contacts/field-input";
import { addContactByHand } from "@/lib/contacts/add-contact-by-hand";
import { parseAddInput, parseViewPatch, parseSidesPatch, parseRelationshipRow } from "@/lib/contacts/relationship-input";
import { toRelationshipView, columnsForViewPatch, newRelationshipFor, type RelationshipView } from "@/lib/contacts/relationship-view";
import { relationshipErrorFor, type RelationshipError } from "@/lib/contacts/relationship-errors";

/**
 * Relationships between customers (spec §6). Every write runs on the request client, so 0070's
 * RLS and Technician fences bind it; the record it is shown on is proven readable first. A caller
 * who does not see the whole account (a Technician, or a role that could not be settled: fails
 * closed, lib/auth-role.ts) writes only when BOTH people are theirs (spec §5.3, C5): checked here
 * before any write so the answer is the refusal copy, and refused again by the database (42501).
 * Nothing pre-checks a pair for duplicates: the reverse of a support label is a legal second row
 * (R7), and the database's two unique indexes decide (23505).
 *
 * Ids from the browser are compared lowercased: isUuid accepts either case, but PostgREST echoes
 * every row's ids lowercase, so a plain string comparison would miss "the same person".
 */
export type RelationshipResult = { ok: true; view: RelationshipView } | { ok: false; error: RelationshipError };
/**
 * A "New person" add can fail AFTER the person was created (refused, a duplicate pair, a lost
 * connection): `contactId` names them, so the dialog retries as `{ kind: "existing" }` instead of
 * creating them a second time (Task 4 review, finding 3).
 */
export type AddRelationshipResult = { ok: true; view: RelationshipView } | { ok: false; error: RelationshipError; contactId?: string };
type Refusal = { ok: false; error: RelationshipError };

const refused: Refusal = { ok: false, error: "relationships.error.refused" };
const invalid: Refusal = { ok: false, error: "relationships.error.invalid" };

function fail(where: string, accountId: string, e: unknown): Refusal {
  const error = relationshipErrorFor(e);
  if (error === "relationships.error.failed") console.error(`${where} (account ${accountId}): ${loggableError(e)}`);
  return { ok: false, error };
}

const isOn = (row: RelationshipRow, subjectId: string) =>
  row.contact_id.toLowerCase() === subjectId || row.related_contact_id.toLowerCase() === subjectId;

/**
 * An Undo payload that would clear the flag 0070's CHECKs pin to the label (contact_relationships_
 * emergency, _pickup): the label names the column, whichever record the Undo was offered on.
 */
const clearsLockedFlag = (row: RelationshipRow, cols: RelationshipSidesPatch) =>
  (row.label_key === "emergency_contact" && cols.contact_is_emergency === false)
  || (row.label_key === "authorized_pickup" && cols.contact_can_pick_up === false);

/** Both people readable on the caller's own client: a narrow caller's precondition for any write. */
async function bothVisible(db: SupabaseClient, accountId: string, row: RelationshipRow): Promise<boolean> {
  const [a, b] = await Promise.all([
    getContact(db, accountId, row.contact_id), getContact(db, accountId, row.related_contact_id),
  ]);
  return Boolean(a && b);
}

/** The other person, as the caller may read them (null for a Technician's hidden person). */
async function viewOf(db: SupabaseClient, accountId: string, row: RelationshipRow, subjectId: string): Promise<RelationshipView | null> {
  const otherId = row.contact_id === subjectId ? row.related_contact_id : row.contact_id;
  const other = await getContact(db, accountId, otherId);
  const people = other ? [{ id: other.id as string, first_name: other.first_name as string | null, last_name: other.last_name as string | null }] : [];
  return toRelationshipView(row, subjectId, people);
}

export async function addRelationshipAction(accountId: string, raw: unknown): Promise<AddRelationshipResult> {
  const access = await requireAccountAccess(accountId);
  const parsed = parseAddInput(raw);
  if (!parsed.ok) return { ok: false, error: parsed.error === "self" ? "relationships.error.self" : "relationships.error.invalid" };
  const input = parsed.input;
  const subjectId = input.subjectId.toLowerCase();
  const db = await dbForRequest();
  // Set once "New person" has made (or matched) someone else: every failure after that names them.
  let created: string | null = null;
  const withCreated = (r: Refusal): AddRelationshipResult => (created ? { ...r, contactId: created } : r);
  try {
    if (!(await getContact(db, accountId, subjectId))) return refused;
    let otherId: string;
    if (input.other.kind === "existing") {
      otherId = input.other.contactId.toLowerCase();
    } else {
      const phone = normalizeFieldInput("phone", input.other.phone);
      if (!phone.ok) return invalid;
      // Spec R4: the shared hand-add path, with the caller's own access, so a Technician's new
      // person is theirs at once and a hidden duplicate is flagged by the service client there.
      const made = await addContactByHand(access, db, accountId, {
        firstName: input.other.firstName || undefined, lastName: input.other.lastName || undefined, phone: phone.value || undefined,
      });
      otherId = made.id.toLowerCase();
      revalidatePath(`/dashboard/accounts/${accountId}/contacts`);
      // A match on the record's own customer created nobody: nothing to retry with.
      if (otherId !== subjectId) created = otherId;
    }
    if (otherId === subjectId) return { ok: false, error: "relationships.error.self" };
    // Both people readable on the caller's own client: for a Technician, the other person is theirs too.
    if (!(await getContact(db, accountId, otherId))) return withCreated(refused);
    const row = await addRelationship(db, accountId, newRelationshipFor({
      subjectId, otherId, labelKey: input.labelKey, otherSide: input.side,
      customLabel: input.customLabel, otherForm: input.otherForm, subjectForm: input.subjectForm,
    }), access.userId);
    const view = await viewOf(db, accountId, row, subjectId);
    return view ? { ok: true, view } : withCreated({ ok: false, error: "relationships.error.failed" });
  } catch (e) {
    return withCreated(fail("addRelationshipAction", accountId, e));
  }
}

export async function setRelationshipAction(
  accountId: string, subjectId: string, relationshipId: string, rawPatch: unknown,
): Promise<{ ok: true; view: RelationshipView; undo: RelationshipSidesPatch } | Refusal> {
  const access = await requireAccountAccess(accountId);
  const patch = parseViewPatch(rawPatch);
  if (!isUuid(subjectId) || !isUuid(relationshipId) || !patch) return invalid;
  const subject = subjectId.toLowerCase();
  const db = await dbForRequest();
  try {
    const row = await getRelationship(db, accountId, relationshipId);
    if (!row) return { ok: false, error: "relationships.error.gone" };
    const columns = columnsForViewPatch(row, subject, patch);
    if (!columns) return invalid;
    // 0070's emergency/pickup CHECKs: the flag the label already is never clears (review finding 1).
    const locked = toRelationshipView(row, subject, [])?.lockedFlag;
    if (locked && patch[locked] === false) return invalid;
    if (!seesWholeAccount(access) && !(await bothVisible(db, accountId, row))) return refused;
    const result = await setRelationshipSides(db, accountId, relationshipId, columns, access.userId);
    if (result === "not_found") return { ok: false, error: "relationships.error.gone" };
    if (result === "refused") return refused;
    const view = await viewOf(db, accountId, result.row, subject);
    return view ? { ok: true, view, undo: result.previous } : { ok: false, error: "relationships.error.failed" };
  } catch (e) {
    return fail("setRelationshipAction", accountId, e);
  }
}

export async function undoSetRelationshipAction(
  accountId: string, subjectId: string, relationshipId: string, rawPrevious: unknown,
): Promise<RelationshipResult> {
  const access = await requireAccountAccess(accountId);
  // What the browser hands back is re-validated: side columns only, each with 0070's own shape.
  const previous = parseSidesPatch(rawPrevious);
  if (!isUuid(subjectId) || !isUuid(relationshipId) || !previous) return invalid;
  const subject = subjectId.toLowerCase();
  const db = await dbForRequest();
  try {
    const row = await getRelationship(db, accountId, relationshipId);
    if (!row) return { ok: false, error: "relationships.error.gone" };
    if (!isOn(row, subject)) return invalid;
    if (clearsLockedFlag(row, previous)) return invalid;
    if (!seesWholeAccount(access) && !(await bothVisible(db, accountId, row))) return refused;
    const result = await setRelationshipSides(db, accountId, relationshipId, previous, access.userId);
    if (result === "not_found") return { ok: false, error: "relationships.error.gone" };
    if (result === "refused") return refused;
    const view = await viewOf(db, accountId, result.row, subject);
    return view ? { ok: true, view } : { ok: false, error: "relationships.error.failed" };
  } catch (e) {
    return fail("undoSetRelationshipAction", accountId, e);
  }
}

export async function removeRelationshipAction(
  accountId: string, relationshipId: string,
): Promise<{ ok: true; snapshot: RelationshipRow } | Refusal> {
  const access = await requireAccountAccess(accountId);
  if (!isUuid(relationshipId)) return invalid;
  const db = await dbForRequest();
  try {
    if (!seesWholeAccount(access)) {
      const row = await getRelationship(db, accountId, relationshipId);
      if (!row) return { ok: false, error: "relationships.error.gone" };
      if (!(await bothVisible(db, accountId, row))) return refused;
    }
    const result = await removeRelationship(db, accountId, relationshipId, access.userId);
    if (result === "not_found") return { ok: false, error: "relationships.error.gone" };
    if (result === "refused") return refused;
    return { ok: true, snapshot: result };
  } catch (e) {
    return fail("removeRelationshipAction", accountId, e);
  }
}

export async function undoRemoveRelationshipAction(accountId: string, subjectId: string, rawSnapshot: unknown): Promise<RelationshipResult> {
  const access = await requireAccountAccess(accountId);
  // The snapshot comes back from the browser: every field re-checked as 0070 would, and it must be
  // this account's row and about the record the Undo was offered on.
  const snapshot = parseRelationshipRow(rawSnapshot);
  if (!isUuid(subjectId) || !snapshot || snapshot.account_id !== accountId) return invalid;
  const subject = subjectId.toLowerCase();
  if (!isOn(snapshot, subject)) return invalid;
  const db = await dbForRequest();
  try {
    if (!seesWholeAccount(access) && !(await bothVisible(db, accountId, snapshot))) return refused;
    const row = await restoreRelationship(db, accountId, snapshot, access.userId);
    const view = await viewOf(db, accountId, row, subject);
    return view ? { ok: true, view } : { ok: false, error: "relationships.error.failed" };
  } catch (e) {
    const r = fail("undoRemoveRelationshipAction", accountId, e);
    return r.error === "relationships.error.gone" ? { ok: false, error: "relationships.error.restore" } : r;
  }
}

export type RelatableHit = { id: string; firstName: string | null; lastName: string | null; phone: string | null };

/** The dialog's picker: the caller's own RLS decides who can be found (a Technician finds only theirs). */
export async function searchRelatableContactsAction(
  accountId: string, subjectId: string, term: string,
): Promise<{ ok: true; hits: RelatableHit[] } | { ok: false }> {
  await requireAccountAccess(accountId);
  if (!isUuid(subjectId) || typeof term !== "string") return { ok: true, hits: [] };
  const subject = subjectId.toLowerCase();
  const q = term.replace(/\s+/g, " ").trim();
  if ([...q].length < 2) return { ok: true, hits: [] };
  const db = await dbForRequest();
  try {
    const rows = await listContacts(db, accountId, { search: q, limit: 9 });
    return {
      ok: true,
      hits: rows.filter((r) => String(r.id).toLowerCase() !== subject).slice(0, 8)
        .map((r) => ({ id: r.id as string, firstName: r.first_name as string | null, lastName: r.last_name as string | null, phone: r.phone as string | null })),
    };
  } catch (e) {
    console.error(`searchRelatableContactsAction (account ${accountId}): ${loggableError(e)}`);
    return { ok: false };
  }
}
