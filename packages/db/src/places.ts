import type { SupabaseClient } from "@supabase/supabase-js";
import { emit, type ActorType } from "./events";
import { isUserClient } from "./user-client";
import type { GroupKind } from "./client-groups";

/**
 * Properties and equipment (spec §6, migration 0071). Every function runs on whichever client the
 * caller passes: the request client for a person's own action, so 0071's RLS and Technician fences
 * bind it. "Refused" is a zero-row write: RLS raises nothing on an UPDATE or DELETE its USING
 * filters out, so writers read first, and found-but-not-written is the refusal (plan deviation 6).
 * Events carry ids and field names only, never typed text: an address is personal data and
 * `events` is append-only.
 */

/** Keeps PostgREST's SQLSTATE, so a caller tells a second replacement (23505), a refusal (42501) or
 *  a unit something replaced (23503) apart by code, never by the wording of a message. */
export class PlaceDbError extends Error {
  readonly code: string | undefined;
  constructor(message: string, code: string | undefined) {
    super(message);
    this.name = "PlaceDbError";
    this.code = code || undefined;
  }
}
const dbError = (what: string, e: { message: string; code?: string }) => new PlaceDbError(`${what}: ${e.message}`, e.code);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** The contact id is interpolated into a PostgREST `or=` filter, so ids are checked before any query is built. */
function assertUuid(v: string, what: string): void {
  if (!UUID.test(v)) throw new PlaceDbError(`${what}: not a uuid`, "22P02");
}

/**
 * `emit()` already refuses a non-'user' actor on a user client (0053), but only AFTER the caller's
 * write has landed. Refusing here, before any read or write, means a disallowed actor never gets as
 * far as a partial write (relationships.ts's guard, same reason).
 */
function assertActorAllowed(db: SupabaseClient, actorType: ActorType): void {
  if (isUserClient(db) && actorType !== "user") {
    throw new PlaceDbError(`a signed-in user's client cannot record a '${actorType}' actor on a place`, undefined);
  }
}

export const MAX_PLACES_READ = 100;
export const MAX_EQUIPMENT_READ = 500;

const PLACE_COLUMNS =
  "id, account_id, contact_id, client_group_id, label, address, landmark, directions, city, region, postal_code, country, archived_at, created_by, created_at, updated_at";
const EQUIPMENT_COLUMNS =
  "id, account_id, place_id, name, make, model, serial, notes, installed_on, warranty_until, replaces_id, created_by, created_at, updated_at";
const PLACE_FIELD_KEYS = ["label", "address", "landmark", "directions", "city", "region", "postal_code", "country"] as const;
const EQUIPMENT_FIELD_KEYS = ["name", "make", "model", "serial", "notes", "installed_on", "warranty_until"] as const;

export type PlaceRow = {
  id: string; account_id: string; contact_id: string | null; client_group_id: string | null;
  label: string | null; address: string | null; landmark: string | null; directions: string | null;
  city: string | null; region: string | null; postal_code: string | null; country: "US" | "MX" | null;
  archived_at: string | null; created_by: string | null; created_at: string; updated_at: string;
};
export type EquipmentRow = {
  id: string; account_id: string; place_id: string; name: string; make: string | null; model: string | null;
  serial: string | null; notes: string | null; installed_on: string | null; warranty_until: string | null;
  replaces_id: string | null; created_by: string | null; created_at: string; updated_at: string;
};
export type PlaceOwner = { contactId: string; groupId: null } | { contactId: null; groupId: string };
export type PlaceFields = Pick<PlaceRow, "label" | "address" | "landmark" | "directions" | "city" | "region" | "postal_code" | "country">;
export type PlacePatch = Partial<PlaceFields>;
export type EquipmentFields = Pick<EquipmentRow, "name" | "make" | "model" | "serial" | "notes" | "installed_on" | "warranty_until">;
export type EquipmentPatch = Partial<EquipmentFields>;
export type ContactPlaceGroup = { id: string; kind: GroupKind; name: string; isPrimary: boolean };
export type ContactPlaces = {
  groups: ContactPlaceGroup[]; places: PlaceRow[]; placeCount: number; equipment: EquipmentRow[]; equipmentCount: number;
};
/** subjectId: the record the action was taken from, carried in every event payload; a group's page (S-03
 *  part 2, C12) records it as `groupId`, a contact's as `contactId`. */
export type PlaceCtx = { subjectId: string; subjectKind?: "contact" | "group"; actorId: string; actorType?: ActorType };

const now = () => new Date().toISOString();

async function event(db: SupabaseClient, accountId: string, type: string, ctx: PlaceCtx, ids: Record<string, unknown>) {
  const subject = ctx.subjectKind === "group" ? { groupId: ctx.subjectId } : { contactId: ctx.subjectId };
  await emit(db, accountId, type, ctx.actorId, { ...subject, ...ids }, ctx.actorType ?? "user");
}

/** Named columns only: `fields` may have come from a browser, and a wider object must never reach
 *  PostgREST as literal insert columns. */
const placeFieldsOf = (f: PlaceFields) => ({
  label: f.label, address: f.address, landmark: f.landmark, directions: f.directions,
  city: f.city, region: f.region, postal_code: f.postal_code, country: f.country,
});
const equipmentFieldsOf = (f: EquipmentFields) => ({
  name: f.name, make: f.make, model: f.model, serial: f.serial, notes: f.notes,
  installed_on: f.installed_on, warranty_until: f.warranty_until,
});

function assertPatchKeys(keys: string[], allowed: readonly string[], what: string): void {
  if (keys.length === 0 || keys.some((k) => !allowed.includes(k))) {
    throw new PlaceDbError(`${what}: nothing to change, or not an editable field`, "22023");
  }
}

/**
 * The most groups whose places one record reads. A person belongs to a household and perhaps a
 * business or two, so this is far past any real record; it bounds the membership read, the group
 * read and the `or=` filter (each id adds 37 characters to the request URL). Primary first, then
 * the order they joined (listContactGroups' order), so a cap could only ever drop the newest.
 */
const MAX_GROUPS_READ = 25;

/**
 * placeCount is the exact number of places the caller may see. equipmentCount is the exact number
 * of units at the places RETURNED (at most MAX_PLACES_READ): the units of a place the card does not
 * show are not counted, and the `in` list of place ids is bounded by that same cap.
 */
export async function listContactPlaces(db: SupabaseClient, accountId: string, contactId: string): Promise<ContactPlaces> {
  // The id is interpolated into the or= filter below, so it is checked first. Its case does not
  // matter: Postgres compares uuids by value, so an uppercase id matches the same rows.
  assertUuid(contactId, "listContactPlaces");
  const { data: mem, error: mErr } = await db.from("client_group_members").select("client_group_id, is_primary")
    .eq("account_id", accountId).eq("contact_id", contactId)
    .order("is_primary", { ascending: false }).order("created_at", { ascending: true }).order("id", { ascending: true })
    .limit(MAX_GROUPS_READ);
  if (mErr) throw dbError("listContactPlaces memberships read failed", mErr);
  const memberships = (mem ?? []) as { client_group_id: string; is_primary: boolean }[];
  const groupIds = memberships.map((m) => m.client_group_id);

  const base = db.from("places").select(PLACE_COLUMNS, { count: "exact" }).eq("account_id", accountId);
  const owned = groupIds.length > 0
    ? base.or(`contact_id.eq.${contactId},client_group_id.in.(${groupIds.join(",")})`)
    : base.eq("contact_id", contactId);
  // Active first (spec §6), so the cap never hides a current property behind removed ones.
  const { data: pData, count: placeCount, error: pErr } = await owned
    .order("archived_at", { ascending: true, nullsFirst: true })
    .order("created_at", { ascending: true }).order("id", { ascending: true })
    .limit(MAX_PLACES_READ);
  if (pErr) throw dbError("listContactPlaces places read failed", pErr);
  // #245: a HEAD-less count can still come back null on a failure; never read that as a real number.
  if (placeCount === null) throw new PlaceDbError("listContactPlaces failed: no count returned", undefined);
  const places = (pData ?? []) as unknown as PlaceRow[];

  let equipment: EquipmentRow[] = [];
  let equipmentCount = 0;
  if (places.length > 0) {
    const { data, count, error } = await db.from("equipment").select(EQUIPMENT_COLUMNS, { count: "exact" })
      .eq("account_id", accountId).in("place_id", places.map((p) => p.id))
      .order("created_at", { ascending: true }).order("id", { ascending: true })
      .limit(MAX_EQUIPMENT_READ);
    if (error) throw dbError("listContactPlaces equipment read failed", error);
    if (count === null) throw new PlaceDbError("listContactPlaces failed: no equipment count returned", undefined);
    equipment = (data ?? []) as unknown as EquipmentRow[];
    equipmentCount = count;
  }

  let groups: ContactPlaceGroup[] = [];
  if (groupIds.length > 0) {
    const { data, error } = await db.from("client_groups").select("id, kind, name")
      .eq("account_id", accountId).in("id", groupIds).limit(MAX_GROUPS_READ);
    if (error) throw dbError("listContactPlaces groups read failed", error);
    // The memberships' order (primary first, then joined), not the group read's.
    const rank = (groupId: string) => groupIds.indexOf(groupId);
    groups = ((data ?? []) as { id: string; kind: GroupKind; name: string }[])
      .map((g) => ({ ...g, isPrimary: memberships.some((m) => m.client_group_id === g.id && m.is_primary) }))
      .sort((a, b) => rank(a.id) - rank(b.id));
  }
  return { groups, places, placeCount, equipment, equipmentCount };
}

/**
 * A group's OWN places (S-03 part 2, C12): `client_group_id = groupId`, active first, capped at
 * MAX_PLACES_READ with an exact count, and their equipment, as listContactPlaces' second and third
 * reads with the owner filter swapped. A member's own places are on their own page. `groups` is
 * always empty: on a group's page there is no other group to rank by. THROWS on a read error or a
 * count-less answer (#245).
 */
export async function listGroupPlaces(db: SupabaseClient, accountId: string, groupId: string): Promise<ContactPlaces> {
  assertUuid(groupId, "listGroupPlaces");
  const { data: pData, count: placeCount, error: pErr } = await db.from("places").select(PLACE_COLUMNS, { count: "exact" })
    .eq("account_id", accountId).eq("client_group_id", groupId)
    .order("archived_at", { ascending: true, nullsFirst: true })
    .order("created_at", { ascending: true }).order("id", { ascending: true })
    .limit(MAX_PLACES_READ);
  if (pErr) throw dbError("listGroupPlaces places read failed", pErr);
  if (placeCount === null) throw new PlaceDbError("listGroupPlaces failed: no count returned", undefined);
  const places = (pData ?? []) as unknown as PlaceRow[];
  let equipment: EquipmentRow[] = [];
  let equipmentCount = 0;
  if (places.length > 0) {
    const { data, count, error } = await db.from("equipment").select(EQUIPMENT_COLUMNS, { count: "exact" })
      .eq("account_id", accountId).in("place_id", places.map((p) => p.id))
      .order("created_at", { ascending: true }).order("id", { ascending: true })
      .limit(MAX_EQUIPMENT_READ);
    if (error) throw dbError("listGroupPlaces equipment read failed", error);
    if (count === null) throw new PlaceDbError("listGroupPlaces failed: no equipment count returned", undefined);
    equipment = (data ?? []) as unknown as EquipmentRow[];
    equipmentCount = count;
  }
  return { groups: [], places, placeCount, equipment, equipmentCount };
}

export async function getPlace(db: SupabaseClient, accountId: string, placeId: string): Promise<PlaceRow | null> {
  assertUuid(placeId, "getPlace");
  const { data, error } = await db.from("places").select(PLACE_COLUMNS)
    .eq("account_id", accountId).eq("id", placeId).maybeSingle();
  if (error) throw dbError("getPlace failed", error);
  return (data as unknown as PlaceRow | null) ?? null;
}

export async function getEquipment(db: SupabaseClient, accountId: string, equipmentId: string): Promise<EquipmentRow | null> {
  assertUuid(equipmentId, "getEquipment");
  const { data, error } = await db.from("equipment").select(EQUIPMENT_COLUMNS)
    .eq("account_id", accountId).eq("id", equipmentId).maybeSingle();
  if (error) throw dbError("getEquipment failed", error);
  return (data as unknown as EquipmentRow | null) ?? null;
}

export async function addPlace(
  db: SupabaseClient, accountId: string, owner: PlaceOwner, fields: PlaceFields, ctx: PlaceCtx,
): Promise<PlaceRow> {
  assertActorAllowed(db, ctx.actorType ?? "user");
  const { data, error } = await db.from("places").insert({
    account_id: accountId, contact_id: owner.contactId, client_group_id: owner.groupId, ...placeFieldsOf(fields),
  }).select(PLACE_COLUMNS).single();
  if (error) throw dbError("addPlace failed", error);
  const row = data as unknown as PlaceRow;
  await event(db, accountId, "place.added", ctx, { placeId: row.id });
  return row;
}

export async function updatePlace(
  db: SupabaseClient, accountId: string, placeId: string, patch: PlacePatch, ctx: PlaceCtx,
): Promise<{ previous: PlacePatch; row: PlaceRow } | "not_found" | "refused"> {
  assertActorAllowed(db, ctx.actorType ?? "user");
  assertPatchKeys(Object.keys(patch), PLACE_FIELD_KEYS, "updatePlace");
  const current = await getPlace(db, accountId, placeId);
  if (!current) return "not_found";
  const { previous, changed, fields } = planPatch(patch, current);
  if (fields.length === 0) return { previous, row: current };
  const { data, error } = await db.from("places").update({ ...changed, updated_at: now() })
    .eq("account_id", accountId).eq("id", placeId).select(PLACE_COLUMNS);
  if (error) throw dbError("updatePlace failed", error);
  const row = ((data ?? []) as unknown as PlaceRow[])[0];
  if (!row) return "refused";
  await event(db, accountId, "place.updated", ctx, { placeId, fields });
  return { previous, row };
}

/**
 * Splits a validated patch against the stored row. `previous` holds the stored value of EVERY key
 * the caller named (so its Undo can always be replayed: a replay of an unchanged key is a no-op);
 * `changed` and `fields` hold only the keys whose defined value differs. Nothing differs: the
 * caller writes nothing and appends no event (review round 1).
 */
function planPatch<P extends object>(patch: P, current: object) {
  const stored = current as Record<string, unknown>;
  const previous: Record<string, unknown> = {};
  const changed: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(patch)) {
    previous[k] = stored[k];
    if (v !== undefined && v !== stored[k]) changed[k] = v;
  }
  return { previous: previous as P, changed, fields: Object.keys(changed) };
}

/** Postgres compares uuids by value, so the owner a caller names may differ only in case. */
const sameId = (a: string | null, b: string | null) => (a === null || b === null ? a === b : a.toLowerCase() === b.toLowerCase());

/**
 * Moves a place between a person and a group. 0071's places_owner_guard raises 42501 for a caller
 * who does not see the whole account (a Technician); that is THROWN, never folded into "refused",
 * so the action can say "only an Owner or Staff can change who a property belongs to".
 */
export async function setPlaceOwner(
  db: SupabaseClient, accountId: string, placeId: string, owner: PlaceOwner, ctx: PlaceCtx,
): Promise<{ previous: PlaceOwner; row: PlaceRow } | "not_found" | "refused"> {
  assertActorAllowed(db, ctx.actorType ?? "user");
  const current = await getPlace(db, accountId, placeId);
  if (!current) return "not_found";
  const previous: PlaceOwner = current.contact_id !== null
    ? { contactId: current.contact_id, groupId: null }
    : { contactId: null, groupId: current.client_group_id as string };
  if (sameId(current.contact_id, owner.contactId) && sameId(current.client_group_id, owner.groupId)) {
    return { previous, row: current };
  }
  const { data, error } = await db.from("places")
    .update({ contact_id: owner.contactId, client_group_id: owner.groupId, updated_at: now() })
    .eq("account_id", accountId).eq("id", placeId).select(PLACE_COLUMNS);
  if (error) throw dbError("setPlaceOwner failed", error);
  const row = ((data ?? []) as unknown as PlaceRow[])[0];
  if (!row) return "refused";
  await event(db, accountId, "place.owner_changed", ctx,
    { placeId, ownerContactId: row.contact_id, ownerGroupId: row.client_group_id });
  return { previous, row };
}

async function writeArchived(db: SupabaseClient, accountId: string, placeId: string, archived: boolean): Promise<PlaceRow | null> {
  const { data, error } = await db.from("places").update({ archived_at: archived ? now() : null, updated_at: now() })
    .eq("account_id", accountId).eq("id", placeId).select(PLACE_COLUMNS);
  if (error) throw dbError("archive write failed", error);
  return ((data ?? []) as unknown as PlaceRow[])[0] ?? null;
}

/**
 * C5: an empty place is deleted (Undo re-inserts it); a place with equipment is archived, so its
 * units and their history stay. Counts the units FIRST (plan deviation 5): the service role
 * bypasses places_delete_empty, and its delete would cascade every unit away.
 * F-046: a place a job names (bookings.place_id, 0107, NO ACTION) is archived too: a job's address
 * cannot vanish.
 */
export async function removePlace(
  db: SupabaseClient, accountId: string, placeId: string, ctx: PlaceCtx,
): Promise<{ mode: "deleted"; snapshot: PlaceRow } | { mode: "archived"; row: PlaceRow } | "not_found" | "refused"> {
  assertActorAllowed(db, ctx.actorType ?? "user");
  const current = await getPlace(db, accountId, placeId);
  if (!current) return "not_found";
  const { count: unitCount, error: uErr } = await db.from("equipment").select("id", { count: "exact", head: true })
    .eq("account_id", accountId).eq("place_id", placeId);
  if (uErr) throw dbError("removePlace unit count failed", uErr);
  if (unitCount === null) throw dbError("removePlace unit count failed", { message: "no count returned" });
  const { count: bookingCount, error: bErr } = await db.from("bookings").select("id", { count: "exact", head: true })
    .eq("account_id", accountId).eq("place_id", placeId);
  if (bErr) throw dbError("removePlace booking count failed", bErr);
  if (bookingCount === null) throw dbError("removePlace booking count failed", { message: "no count returned" });
  if (unitCount === 0 && bookingCount === 0) {
    const { data, error } = await db.from("places").delete()
      .eq("account_id", accountId).eq("id", placeId).select(PLACE_COLUMNS);
    if (error && !(error.code === "23503" && error.message.includes("bookings_place_fkey"))) {
      throw dbError("removePlace delete failed", error);
    }
    if (!error) {
      const deleted = ((data ?? []) as unknown as PlaceRow[])[0];
      if (deleted) {
        await event(db, accountId, "place.removed", ctx, { placeId, mode: "deleted" });
        return { mode: "deleted", snapshot: deleted };
      }
    }
    // 0 rows, or a booking landed between the count and the delete (bookings_place_fkey, 23503). On
    // a REQUEST client, places_delete_empty refused because a unit or a booking arrived since the
    // count, or the caller may not delete the place at all: keep it and archive instead, which RLS
    // refuses in turn when the caller may not write. A SERVICE client (the demo seed, tests) bypasses
    // that policy, so for it a unit or a booking inserted between the count and the delete is
    // cascaded away with the place: only the request client is protected against that race (spec §12).
  }
  // Already archived: nothing to write, no event, the stored row as it is (review round 1).
  if (current.archived_at !== null) return { mode: "archived", row: current };
  const row = await writeArchived(db, accountId, placeId, true);
  if (!row) return "refused";
  await event(db, accountId, "place.removed", ctx, { placeId, mode: "archived" });
  return { mode: "archived", row };
}

/** Archives (Undo of "put back") or puts back (Undo of an archive, or "Put back") a place. */
export async function setPlaceArchived(
  db: SupabaseClient, accountId: string, placeId: string, archived: boolean, ctx: PlaceCtx,
): Promise<PlaceRow | "not_found" | "refused"> {
  assertActorAllowed(db, ctx.actorType ?? "user");
  const current = await getPlace(db, accountId, placeId);
  if (!current) return "not_found";
  // Already in that state: no re-stamp of archived_at, no event (review round 1).
  if ((current.archived_at !== null) === archived) return current;
  const row = await writeArchived(db, accountId, placeId, archived);
  if (!row) return "refused";
  if (archived) await event(db, accountId, "place.removed", ctx, { placeId, mode: "archived" });
  else await event(db, accountId, "place.restored", ctx, { placeId });
  return row;
}

/**
 * The Undo of a delete: the same row, the same id (rule 6). Named columns, never `{...snapshot}`:
 * the snapshot came back from a browser. `created_by`, `created_at` and `updated_at` are not carried
 * (spec §7: 0071's trigger re-stamps created_by for a client token, and a browser-held timestamp
 * would decide where the row sorts).
 */
export async function restorePlace(db: SupabaseClient, accountId: string, snapshot: PlaceRow, ctx: PlaceCtx): Promise<PlaceRow> {
  assertActorAllowed(db, ctx.actorType ?? "user");
  if (snapshot.account_id !== accountId) throw new PlaceDbError("restorePlace: another account's row", "22023");
  const { data, error } = await db.from("places").insert({
    id: snapshot.id,
    account_id: snapshot.account_id,
    contact_id: snapshot.contact_id,
    client_group_id: snapshot.client_group_id,
    ...placeFieldsOf(snapshot),
    archived_at: snapshot.archived_at,
  }).select(PLACE_COLUMNS).single();
  if (error) throw dbError("restorePlace failed", error);
  const row = data as unknown as PlaceRow;
  await event(db, accountId, "place.restored", ctx, { placeId: row.id });
  return row;
}

export async function addEquipment(
  db: SupabaseClient, accountId: string, placeId: string, fields: EquipmentFields, ctx: PlaceCtx,
): Promise<EquipmentRow> {
  assertActorAllowed(db, ctx.actorType ?? "user");
  const { data, error } = await db.from("equipment").insert({
    account_id: accountId, place_id: placeId, ...equipmentFieldsOf(fields),
  }).select(EQUIPMENT_COLUMNS).single();
  if (error) throw dbError("addEquipment failed", error);
  const row = data as unknown as EquipmentRow;
  await event(db, accountId, "equipment.added", ctx, { placeId: row.place_id, equipmentId: row.id });
  return row;
}

/**
 * C3: a replacement is a NEW unit at the old unit's place, pointing at it. A second replacement of
 * the same unit answers 23505 (equipment_one_successor), thrown with its code.
 */
export async function replaceEquipment(
  db: SupabaseClient, accountId: string, equipmentId: string, fields: EquipmentFields, ctx: PlaceCtx,
): Promise<EquipmentRow | "not_found"> {
  assertActorAllowed(db, ctx.actorType ?? "user");
  const old = await getEquipment(db, accountId, equipmentId);
  if (!old) return "not_found";
  const { data, error } = await db.from("equipment").insert({
    account_id: accountId, place_id: old.place_id, replaces_id: old.id, ...equipmentFieldsOf(fields),
  }).select(EQUIPMENT_COLUMNS).single();
  if (error) throw dbError("replaceEquipment failed", error);
  const row = data as unknown as EquipmentRow;
  await event(db, accountId, "equipment.replaced", ctx, { placeId: row.place_id, equipmentId: row.id, replacedId: old.id });
  return row;
}

export async function updateEquipment(
  db: SupabaseClient, accountId: string, equipmentId: string, patch: EquipmentPatch, ctx: PlaceCtx,
): Promise<{ previous: EquipmentPatch; row: EquipmentRow } | "not_found" | "refused"> {
  assertActorAllowed(db, ctx.actorType ?? "user");
  assertPatchKeys(Object.keys(patch), EQUIPMENT_FIELD_KEYS, "updateEquipment");
  const current = await getEquipment(db, accountId, equipmentId);
  if (!current) return "not_found";
  const { previous, changed, fields } = planPatch(patch, current);
  if (fields.length === 0) return { previous, row: current };
  const { data, error } = await db.from("equipment").update({ ...changed, updated_at: now() })
    .eq("account_id", accountId).eq("id", equipmentId).select(EQUIPMENT_COLUMNS);
  if (error) throw dbError("updateEquipment failed", error);
  const row = ((data ?? []) as unknown as EquipmentRow[])[0];
  if (!row) return "refused";
  await event(db, accountId, "equipment.updated", ctx, { placeId: row.place_id, equipmentId, fields });
  return { previous, row };
}

/**
 * C6: a unit something replaced cannot be removed on its own (equipment_replaces_fkey, 23503,
 * thrown with its code). The Undo snapshot is the DELETE's own RETURNING, not the read.
 */
export async function removeEquipment(
  db: SupabaseClient, accountId: string, equipmentId: string, ctx: PlaceCtx,
): Promise<EquipmentRow | "not_found" | "refused"> {
  assertActorAllowed(db, ctx.actorType ?? "user");
  const current = await getEquipment(db, accountId, equipmentId);
  if (!current) return "not_found";
  const { data, error } = await db.from("equipment").delete()
    .eq("account_id", accountId).eq("id", equipmentId).select(EQUIPMENT_COLUMNS);
  if (error) throw dbError("removeEquipment failed", error);
  const row = ((data ?? []) as unknown as EquipmentRow[])[0];
  if (!row) return "refused";
  await event(db, accountId, "equipment.removed", ctx, { placeId: row.place_id, equipmentId: row.id });
  return row;
}

/** The Undo of a remove: the same id and the same `replaces_id` link (rule 6), named columns only. */
export async function restoreEquipment(
  db: SupabaseClient, accountId: string, snapshot: EquipmentRow, ctx: PlaceCtx,
): Promise<EquipmentRow> {
  assertActorAllowed(db, ctx.actorType ?? "user");
  if (snapshot.account_id !== accountId) throw new PlaceDbError("restoreEquipment: another account's row", "22023");
  const { data, error } = await db.from("equipment").insert({
    id: snapshot.id,
    account_id: snapshot.account_id,
    place_id: snapshot.place_id,
    replaces_id: snapshot.replaces_id,
    ...equipmentFieldsOf(snapshot),
  }).select(EQUIPMENT_COLUMNS).single();
  if (error) throw dbError("restoreEquipment failed", error);
  const row = data as unknown as EquipmentRow;
  await event(db, accountId, "equipment.restored", ctx, { placeId: row.place_id, equipmentId: row.id });
  return row;
}
