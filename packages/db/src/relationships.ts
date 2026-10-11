import type { SupabaseClient } from "@supabase/supabase-js";
import { emit, type ActorType } from "./events";
import { isUserClient } from "./user-client";
import {
  RELATIONSHIP_COLUMNS, SIDE_COLUMNS, type RelationshipKey, type RelationshipRow, type RelatedPerson,
  type RelationshipSidesPatch, type SideColumn, type WordForm,
} from "./relationship-keys";

/**
 * Relationships between customers (spec §6, migration 0070). Every function runs on whichever
 * client the caller passes: the request client for a person's own action, so 0070's RLS and
 * Technician fences bind it. Never embeds contacts(...): the table has TWO foreign keys to
 * contacts and an unhinted embed is ambiguous (0050's note); the people are a second plain read.
 */

/** Keeps PostgREST's SQLSTATE, so a caller tells a duplicate (23505), a refusal (42501) or a
 *  vanished person (23503) apart by code, never by the wording of a message. */
export class RelationshipDbError extends Error {
  readonly code: string | undefined;
  constructor(message: string, code: string | undefined) {
    super(message);
    this.name = "RelationshipDbError";
    this.code = code || undefined;
  }
}
const dbError = (what: string, e: { message: string; code?: string }) => new RelationshipDbError(`${what}: ${e.message}`, e.code);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** The id is interpolated into a PostgREST `or=` filter, so it is checked before any query is built. */
function assertUuid(v: string, what: string): void {
  if (!UUID.test(v)) throw new RelationshipDbError(`${what}: not a uuid`, "22P02");
}

/**
 * `emit()` already refuses a non-'user' actor on a user client (0053) — but only AFTER its own
 * caller's write has landed, so the row is written, then emit() throws, and the caller is told the
 * whole call failed while the database disagrees. Refusing here, before any read or write, means a
 * disallowed actor never gets as far as a partial write.
 */
function assertActorAllowed(db: SupabaseClient, actorType: ActorType): void {
  if (isUserClient(db) && actorType !== "user") {
    throw new RelationshipDbError(
      `a signed-in user's client cannot record a '${actorType}' actor on a relationship`, undefined);
  }
}

export const MAX_RELATIONSHIPS_READ = 100;

export type NewRelationship = {
  contactId: string;
  relatedContactId: string;
  labelKey: RelationshipKey;
  customLabel: string | null;
  contactForm: WordForm | null;
  relatedForm: WordForm | null;
  contactCanPickUp: boolean;
  contactIsEmergency: boolean;
  relatedCanPickUp: boolean;
  relatedIsEmergency: boolean;
};

const payloadOf = (row: RelationshipRow) => ({
  relationshipId: row.id, contactId: row.contact_id, relatedContactId: row.related_contact_id, labelKey: row.label_key,
});

export async function listContactRelationships(
  db: SupabaseClient, accountId: string, contactId: string,
): Promise<{ rows: RelationshipRow[]; people: RelatedPerson[] }> {
  assertUuid(contactId, "listContactRelationships");
  // Postgres's uuid comparisons are case-insensitive, but PostgREST always echoes a row's ids back
  // lowercase (its uuid output function), so a caller who typed or forwarded an uppercase id must
  // be normalised here BEFORE the plain JS string comparison below — otherwise the comparison
  // mismatches and the subject is named as if they were their OWN "other" person.
  const id = contactId.toLowerCase();
  const { data, error } = await db.from("contact_relationships").select(RELATIONSHIP_COLUMNS)
    .eq("account_id", accountId)
    .or(`contact_id.eq.${id},related_contact_id.eq.${id}`)
    .order("created_at", { ascending: true }).order("id", { ascending: true })
    .limit(MAX_RELATIONSHIPS_READ);
  if (error) throw dbError("listContactRelationships failed", error);
  const rows = (data ?? []) as unknown as RelationshipRow[];
  const otherIds = [...new Set(rows.map((r) => (r.contact_id === id ? r.related_contact_id : r.contact_id)))];
  // rows still carry BOTH raw contact ids, including the subject's own and, when one person is
  // hidden from this caller (a Technician, spec §5.3), an id that never resolves to a `people`
  // entry below. Never serialize `rows` itself to a browser: a caller maps each row through
  // apps/web's toRelationshipView (@bis/contacts/relationship-view), which picks the OTHER id,
  // looks it up in `people`, and renders the hidden case as its own chip rather than a bare uuid.
  if (otherIds.length === 0) return { rows, people: [] };
  // Under RLS a person the caller may not see simply does not come back (a Technician's
  // "someone not on your list", spec §5.3).
  const { data: people, error: pErr } = await db.from("contacts").select("id, first_name, last_name")
    .eq("account_id", accountId).in("id", otherIds);
  if (pErr) throw dbError("listContactRelationships people read failed", pErr);
  return { rows, people: (people ?? []) as RelatedPerson[] };
}

export async function getRelationship(db: SupabaseClient, accountId: string, relationshipId: string): Promise<RelationshipRow | null> {
  assertUuid(relationshipId, "getRelationship");
  const { data, error } = await db.from("contact_relationships").select(RELATIONSHIP_COLUMNS)
    .eq("account_id", accountId).eq("id", relationshipId).maybeSingle();
  if (error) throw dbError("getRelationship failed", error);
  return (data as unknown as RelationshipRow | null) ?? null;
}

export async function addRelationship(
  db: SupabaseClient, accountId: string, input: NewRelationship, actorId: string, actorType: ActorType = "user",
): Promise<RelationshipRow> {
  assertActorAllowed(db, actorType);
  const { data, error } = await db.from("contact_relationships").insert({
    account_id: accountId,
    contact_id: input.contactId,
    related_contact_id: input.relatedContactId,
    label_key: input.labelKey,
    custom_label: input.customLabel,
    contact_form: input.contactForm,
    related_form: input.relatedForm,
    contact_can_pick_up: input.contactCanPickUp,
    contact_is_emergency: input.contactIsEmergency,
    related_can_pick_up: input.relatedCanPickUp,
    related_is_emergency: input.relatedIsEmergency,
  }).select(RELATIONSHIP_COLUMNS).single();
  if (error) throw dbError("addRelationship failed", error);
  const row = data as unknown as RelationshipRow;
  await emit(db, accountId, "contact.relationship_added", actorId, payloadOf(row), actorType);
  return row;
}

/**
 * Only the per-side forms and flags (0070's column grant). Reads first: an UPDATE that RLS filters
 * out raises nothing and returns no row, so "found but not written" is the refusal (a Technician
 * with one person hidden, spec §5.3).
 */
export async function setRelationshipSides(
  db: SupabaseClient, accountId: string, relationshipId: string, patch: RelationshipSidesPatch,
  actorId: string, actorType: ActorType = "user",
): Promise<{ previous: RelationshipSidesPatch; row: RelationshipRow } | "not_found" | "refused"> {
  assertActorAllowed(db, actorType);
  const keys = Object.keys(patch) as SideColumn[];
  if (keys.length === 0 || keys.some((k) => !(SIDE_COLUMNS as readonly string[]).includes(k))) {
    throw new RelationshipDbError("setRelationshipSides: nothing to change, or not a side column", "22023");
  }
  const current = await getRelationship(db, accountId, relationshipId);
  if (!current) return "not_found";
  const previous: RelationshipSidesPatch = {};
  for (const k of keys) (previous as Record<string, unknown>)[k] = current[k];
  const { data, error } = await db.from("contact_relationships")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("account_id", accountId).eq("id", relationshipId).select(RELATIONSHIP_COLUMNS);
  if (error) throw dbError("setRelationshipSides failed", error);
  const row = ((data ?? []) as unknown as RelationshipRow[])[0];
  if (!row) return "refused";
  await emit(db, accountId, "contact.relationship_updated", actorId, { ...payloadOf(row), fields: keys }, actorType);
  return { previous, row };
}

export async function removeRelationship(
  db: SupabaseClient, accountId: string, relationshipId: string, actorId: string, actorType: ActorType = "user",
): Promise<RelationshipRow | "not_found" | "refused"> {
  assertActorAllowed(db, actorType);
  // This read exists ONLY to tell "nothing there" from "there, but refused" (a Technician who can
  // SEE a relationship because one person is theirs, but cannot DELETE it because the restrictive
  // delete policy needs BOTH, spec §5.3). The Undo snapshot itself comes from the DELETE's own
  // RETURNING below, never from this read: a flag flipped between the two would otherwise be lost
  // from the undo toast.
  const current = await getRelationship(db, accountId, relationshipId);
  if (!current) return "not_found";
  const { data, error } = await db.from("contact_relationships").delete()
    .eq("account_id", accountId).eq("id", relationshipId).select(RELATIONSHIP_COLUMNS);
  if (error) throw dbError("removeRelationship failed", error);
  const row = ((data ?? []) as unknown as RelationshipRow[])[0];
  if (!row) return "refused";
  await emit(db, accountId, "contact.relationship_removed", actorId, payloadOf(row), actorType);
  return row;
}

/**
 * The Undo of a remove: the same row, the same id (rule 6). Builds its insert from NAMED columns,
 * never `{...row}`: `row` is whatever the caller's undo toast held onto, and a wider or
 * differently-shaped object (an extra field tacked on, a stale type) must never be free to reach
 * PostgREST as literal insert columns. The id IS carried over: Undo restores the same row (rule 6).
 * `created_at` is NOT (final review item 9): the snapshot came back from a browser, so a timestamp
 * in it is the browser's to forge, and it would decide where the row sorts (the list orders by
 * created_at); the column default stamps it here instead, and `updated_at` is now as well.
 */
export async function restoreRelationship(
  db: SupabaseClient, accountId: string, row: RelationshipRow, actorId: string, actorType: ActorType = "user",
): Promise<RelationshipRow> {
  assertActorAllowed(db, actorType);
  if (row.account_id !== accountId) throw new RelationshipDbError("restoreRelationship: another account's row", "22023");
  const { data, error } = await db.from("contact_relationships").insert({
    id: row.id,
    account_id: row.account_id,
    contact_id: row.contact_id,
    related_contact_id: row.related_contact_id,
    label_key: row.label_key,
    custom_label: row.custom_label,
    contact_form: row.contact_form,
    related_form: row.related_form,
    contact_can_pick_up: row.contact_can_pick_up,
    contact_is_emergency: row.contact_is_emergency,
    related_can_pick_up: row.related_can_pick_up,
    related_is_emergency: row.related_is_emergency,
    updated_at: new Date().toISOString(),
  }).select(RELATIONSHIP_COLUMNS).single();
  if (error) throw dbError("restoreRelationship failed", error);
  const restored = data as unknown as RelationshipRow;
  await emit(db, accountId, "contact.relationship_added", actorId, { ...payloadOf(restored), restored: true }, actorType);
  return restored;
}
