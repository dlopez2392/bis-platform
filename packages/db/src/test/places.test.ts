import { describe, it, expect } from "vitest";
import { withTestAccount } from "./fixtures";
import { createContact } from "../contacts";
import { createGroupWithMember, setPrimaryMembership } from "../client-groups";
import { ACCOUNT_OWNED_TABLES } from "../account-teardown";
import {
  listContactPlaces, addPlace, removePlace, setPlaceArchived, restorePlace, addEquipment, replaceEquipment,
  updatePlace, removeEquipment, restoreEquipment, PlaceDbError, type PlaceFields, type EquipmentFields,
  getPlace, getEquipment, setPlaceOwner, updateEquipment, type PlacePatch, type EquipmentPatch,
} from "../places";
import type { SupabaseClient } from "@supabase/supabase-js";

const ACTOR = "user_test";
const fields = (over: Partial<PlaceFields> = {}): PlaceFields => ({
  label: null, address: "1204 Nolana Ave", landmark: null, directions: null, city: null, region: null, postal_code: null, country: null, ...over,
});
const unit = (over: Partial<EquipmentFields> = {}): EquipmentFields => ({
  name: "AC upstairs", make: "Trane", model: "XR14", serial: null, notes: null, installed_on: "2019-03-03", warranty_until: null, ...over,
});

describe("listContactPlaces (spec §6)", () => {
  it("returns the person's own places and their groups' places with the units there and real counts, never another person's", () =>
    withTestAccount(async (db, accountId) => {
      const ana = (await createContact(db, accountId, { firstName: "Ana" }, ACTOR)).id;
      const luis = (await createContact(db, accountId, { firstName: "Luis" }, ACTOR)).id;
      const home = await createGroupWithMember(db, accountId, ana, "household", "Garcia", null, ACTOR);
      if (home.status !== "ok") throw new Error("group");
      const ctx = { subjectId: ana, actorId: ACTOR };
      const own = await addPlace(db, accountId, { contactId: ana, groupId: null }, fields(), ctx);
      const shared = await addPlace(db, accountId, { contactId: null, groupId: home.groupId }, fields({ address: null, landmark: "past the canal" }), ctx);
      await addPlace(db, accountId, { contactId: luis, groupId: null }, fields({ address: "9 Other St" }), { subjectId: luis, actorId: ACTOR });
      await addEquipment(db, accountId, own.id, unit(), ctx);
      await addEquipment(db, accountId, shared.id, unit({ name: "Water heater" }), ctx);
      const r = await listContactPlaces(db, accountId, ana.toUpperCase());
      expect(r.places.map((p) => p.id).sort()).toEqual([own.id, shared.id].sort());
      expect(r.placeCount).toBe(2);
      expect(r.equipment.map((e) => e.name).sort()).toEqual(["AC upstairs", "Water heater"]);
      expect(r.equipmentCount).toBe(2);
      expect(r.groups).toEqual([{ id: home.groupId, kind: "household", name: "Garcia", isPrimary: true }]);
    }));
  it("lists current places before removed ones, so the cap never hides a current one (mutation: drop the archived_at order -> FAILS)", () =>
    withTestAccount(async (db, accountId) => {
      const ana = (await createContact(db, accountId, { firstName: "Ana" }, ACTOR)).id;
      const ctx = { subjectId: ana, actorId: ACTOR };
      const older = await addPlace(db, accountId, { contactId: ana, groupId: null }, fields({ address: "1 Old St" }), ctx);
      await addEquipment(db, accountId, older.id, unit(), ctx);
      expect(await removePlace(db, accountId, older.id, ctx)).toMatchObject({ mode: "archived" });
      const newer = await addPlace(db, accountId, { contactId: ana, groupId: null }, fields({ address: "2 New St" }), ctx);
      const r = await listContactPlaces(db, accountId, ana);
      expect(r.places.map((p) => p.id)).toEqual([newer.id, older.id]);
      expect(r.placeCount).toBe(2);
    }));
});

describe("removing and restoring a place (C5)", () => {
  it("deletes an empty place and archives one with units (mutation: skip the unit count -> the service client's delete cascades the unit and FAILS)", () =>
    withTestAccount(async (db, accountId) => {
      const ana = (await createContact(db, accountId, { firstName: "Ana" }, ACTOR)).id;
      const ctx = { subjectId: ana, actorId: ACTOR };
      const empty = await addPlace(db, accountId, { contactId: ana, groupId: null }, fields(), ctx);
      const full = await addPlace(db, accountId, { contactId: ana, groupId: null }, fields({ address: "9 Full St" }), ctx);
      await addEquipment(db, accountId, full.id, unit(), ctx);
      const a = await removePlace(db, accountId, empty.id, ctx);
      expect(a).toMatchObject({ mode: "deleted", snapshot: { id: empty.id, address: "1204 Nolana Ave" } });
      const b = await removePlace(db, accountId, full.id, ctx);
      expect(b).toMatchObject({ mode: "archived", row: { id: full.id } });
      expect((b as { row: { archived_at: string | null } }).row.archived_at).not.toBeNull();
      const { count } = await db.from("equipment").select("id", { count: "exact", head: true }).eq("place_id", full.id);
      expect(count).toBe(1);
    }));
  it("restorePlace brings back the same id; setPlaceArchived(false) puts an archived place back", () =>
    withTestAccount(async (db, accountId) => {
      const ana = (await createContact(db, accountId, { firstName: "Ana" }, ACTOR)).id;
      const ctx = { subjectId: ana, actorId: ACTOR };
      const p = await addPlace(db, accountId, { contactId: ana, groupId: null }, fields({ landmark: "blue house" }), ctx);
      const gone = await removePlace(db, accountId, p.id, ctx);
      if (typeof gone === "string" || gone.mode !== "deleted") throw new Error("expected a delete");
      const back = await restorePlace(db, accountId, gone.snapshot, ctx);
      expect(back).toMatchObject({ id: p.id, address: "1204 Nolana Ave", landmark: "blue house" });
      await addEquipment(db, accountId, p.id, unit(), ctx);
      await removePlace(db, accountId, p.id, ctx);
      expect(await setPlaceArchived(db, accountId, p.id, false, ctx)).toMatchObject({ id: p.id, archived_at: null });
    }));
  it("updatePlace answers the previous values for Undo", () => withTestAccount(async (db, accountId) => {
    const ana = (await createContact(db, accountId, { firstName: "Ana" }, ACTOR)).id;
    const ctx = { subjectId: ana, actorId: ACTOR };
    const p = await addPlace(db, accountId, { contactId: ana, groupId: null }, fields(), ctx);
    expect(await updatePlace(db, accountId, p.id, { landmark: "past the canal" }, ctx))
      .toMatchObject({ previous: { landmark: null }, row: { landmark: "past the canal" } });
  }));
});

describe("equipment: replace, remove, restore (C3, C6)", () => {
  it("a replacement is linked to the old unit at its place; replacing it again answers 23505", () => withTestAccount(async (db, accountId) => {
    const ana = (await createContact(db, accountId, { firstName: "Ana" }, ACTOR)).id;
    const ctx = { subjectId: ana, actorId: ACTOR };
    const p = await addPlace(db, accountId, { contactId: ana, groupId: null }, fields(), ctx);
    const old = await addEquipment(db, accountId, p.id, unit(), ctx);
    const next = await replaceEquipment(db, accountId, old.id, unit({ make: "Carrier", installed_on: "2026-10-11" }), ctx);
    expect(next).toMatchObject({ place_id: p.id, replaces_id: old.id, make: "Carrier" });
    await expect(replaceEquipment(db, accountId, old.id, unit({ installed_on: "2026-10-11" }), ctx))
      .rejects.toSatisfy((e: unknown) => e instanceof PlaceDbError && e.code === "23505");
  }));
  it("a replaced unit cannot be removed (23503); a current one can, and restoreEquipment brings back the same id and link (mutation: restore without the id -> FAILS)", () =>
    withTestAccount(async (db, accountId) => {
      const ana = (await createContact(db, accountId, { firstName: "Ana" }, ACTOR)).id;
      const ctx = { subjectId: ana, actorId: ACTOR };
      const p = await addPlace(db, accountId, { contactId: ana, groupId: null }, fields(), ctx);
      const old = await addEquipment(db, accountId, p.id, unit(), ctx);
      const next = await replaceEquipment(db, accountId, old.id, unit({ installed_on: "2026-10-11" }), ctx);
      if (typeof next === "string") throw new Error("replace");
      await expect(removeEquipment(db, accountId, old.id, ctx))
        .rejects.toSatisfy((e: unknown) => e instanceof PlaceDbError && e.code === "23503");
      const snap = await removeEquipment(db, accountId, next.id, ctx);
      if (typeof snap === "string") throw new Error("remove");
      expect(await restoreEquipment(db, accountId, snap, ctx)).toMatchObject({ id: next.id, replaces_id: old.id });
    }));
});

describe("events (spec §6)", () => {
  it("each write appends its event, with the subject and ids and never typed text (mutation: drop the emit in replaceEquipment -> FAILS)", () =>
    withTestAccount(async (db, accountId) => {
      const ana = (await createContact(db, accountId, { firstName: "Ana" }, ACTOR)).id;
      const ctx = { subjectId: ana, actorId: ACTOR };
      const p = await addPlace(db, accountId, { contactId: ana, groupId: null }, fields(), ctx);
      const old = await addEquipment(db, accountId, p.id, unit(), ctx);
      await replaceEquipment(db, accountId, old.id, unit({ installed_on: "2026-10-11" }), ctx);
      await updatePlace(db, accountId, p.id, { landmark: "past the canal" }, ctx);
      const { data } = await db.from("events").select("type, actor_id, payload").eq("account_id", accountId)
        .in("type", ["place.added", "equipment.added", "equipment.replaced", "place.updated"]).order("created_at");
      expect((data ?? []).map((e) => e.type)).toEqual(["place.added", "equipment.added", "equipment.replaced", "place.updated"]);
      for (const e of data ?? []) {
        expect(e.actor_id).toBe(ACTOR);
        expect((e.payload as { contactId: string }).contactId).toBe(ana);
        expect(JSON.stringify(e.payload)).not.toMatch(/Nolana|canal|Trane/);
      }
      expect(data![2]!.payload).toMatchObject({ replacedId: old.id });
      expect(data![3]!.payload).toMatchObject({ fields: ["landmark"] });
    }));
});

describe("account teardown (spec §5.3)", () => {
  it("lists equipment, then places, ahead of the client groups and contacts they reference (mutation: drop either name -> FAILS)", () => {
    const at = (t: string) => ACCOUNT_OWNED_TABLES.indexOf(t as (typeof ACCOUNT_OWNED_TABLES)[number]);
    expect(at("equipment")).toBeGreaterThanOrEqual(0);
    expect(at("equipment")).toBeLessThan(at("places"));
    expect(at("places")).toBeLessThan(at("client_group_members"));
    expect(at("places")).toBeLessThan(at("contacts"));
  });
});

// ---- Review round 1: every event, tenant fences, refusals and no-op writes ----

const EVENT_TYPES = [
  "place.added", "place.updated", "place.owner_changed", "place.removed", "place.restored",
  "equipment.added", "equipment.replaced", "equipment.updated", "equipment.removed", "equipment.restored",
];
async function placeEvents(db: SupabaseClient, accountId: string) {
  const { data, error } = await db.from("events").select("type, actor_type, actor_id, payload")
    .eq("account_id", accountId).in("type", EVENT_TYPES).order("created_at").order("id");
  if (error) throw new Error(error.message);
  return (data ?? []) as { type: string; actor_type: string; actor_id: string; payload: Record<string, unknown> }[];
}
const isCode = (code: string) => (e: unknown) => e instanceof PlaceDbError && e.code === code;

describe("events, every type (spec §6, review round 1)", () => {
  it("each write appends exactly its own event: subject, ids, mode and field names, and none of the typed values (mutations: drop place.removed's emit, mark an archive 'deleted', drop equipment.restored's emit, add name or model to equipment.added -> FAILS)", () =>
    withTestAccount(async (db, accountId) => {
      // Every value this test types, and so every value no event may carry.
      const TYPED = {
        label: "Casa grande", address: "4410 Jackson Rd", landmark: "blue gate", directions: "left at the canal",
        city: "McAllen", region: "TX", postal_code: "78501", landmark2: "red gate", directions2: "right at the church",
        unitName: "Attic furnace", unitMake: "Rheem", unitModel: "FX9", serial: "SN-778", notes: "filter under the stairs",
        notes2: "filter by the door", newName: "Attic furnace two", newMake: "Lennox", newModel: "EL296",
        emptyAddress: "77 Empty Rd", group: "Navarro",
      };
      const ana = (await createContact(db, accountId, { firstName: "Ana" }, ACTOR)).id;
      const home = await createGroupWithMember(db, accountId, ana, "household", TYPED.group, null, ACTOR);
      if (home.status !== "ok") throw new Error("group");
      const ctx = { subjectId: ana, actorId: ACTOR };
      const p = await addPlace(db, accountId, { contactId: ana, groupId: null }, {
        label: TYPED.label, address: TYPED.address, landmark: TYPED.landmark, directions: TYPED.directions,
        city: TYPED.city, region: TYPED.region, postal_code: TYPED.postal_code, country: "US",
      }, ctx);
      await updatePlace(db, accountId, p.id, { landmark: TYPED.landmark2, directions: TYPED.directions2 }, ctx);
      await setPlaceOwner(db, accountId, p.id, { contactId: null, groupId: home.groupId }, ctx);
      const u = await addEquipment(db, accountId, p.id, unit({
        name: TYPED.unitName, make: TYPED.unitMake, model: TYPED.unitModel, serial: TYPED.serial, notes: TYPED.notes,
      }), ctx);
      await updateEquipment(db, accountId, u.id, { notes: TYPED.notes2 }, ctx);
      const r = await replaceEquipment(db, accountId, u.id,
        unit({ name: TYPED.newName, make: TYPED.newMake, model: TYPED.newModel, installed_on: "2026-10-11" }), ctx);
      if (typeof r === "string") throw new Error("replace");
      const snap = await removeEquipment(db, accountId, r.id, ctx);
      if (typeof snap === "string") throw new Error("remove");
      await restoreEquipment(db, accountId, snap, ctx);
      await removePlace(db, accountId, p.id, ctx); // has units: archived
      await setPlaceArchived(db, accountId, p.id, false, ctx);
      await setPlaceArchived(db, accountId, p.id, true, ctx);
      const empty = await addPlace(db, accountId, { contactId: ana, groupId: null }, fields({ address: TYPED.emptyAddress }), ctx);
      const gone = await removePlace(db, accountId, empty.id, ctx);
      if (typeof gone === "string" || gone.mode !== "deleted") throw new Error("expected a delete");
      await restorePlace(db, accountId, gone.snapshot, ctx);

      const events = await placeEvents(db, accountId);
      const s = { contactId: ana };
      expect(events.map((e) => [e.type, e.payload])).toEqual([
        ["place.added", { ...s, placeId: p.id }],
        ["place.updated", { ...s, placeId: p.id, fields: ["landmark", "directions"] }],
        ["place.owner_changed", { ...s, placeId: p.id, ownerContactId: null, ownerGroupId: home.groupId }],
        ["equipment.added", { ...s, placeId: p.id, equipmentId: u.id }],
        ["equipment.updated", { ...s, placeId: p.id, equipmentId: u.id, fields: ["notes"] }],
        ["equipment.replaced", { ...s, placeId: p.id, equipmentId: r.id, replacedId: u.id }],
        ["equipment.removed", { ...s, placeId: p.id, equipmentId: r.id }],
        ["equipment.restored", { ...s, placeId: p.id, equipmentId: r.id }],
        ["place.removed", { ...s, placeId: p.id, mode: "archived" }],
        ["place.restored", { ...s, placeId: p.id }],
        ["place.removed", { ...s, placeId: p.id, mode: "archived" }],
        ["place.added", { ...s, placeId: empty.id }],
        ["place.removed", { ...s, placeId: empty.id, mode: "deleted" }],
        ["place.restored", { ...s, placeId: empty.id }],
      ]);
      for (const e of events) {
        expect([e.actor_type, e.actor_id]).toEqual(["user", ACTOR]);
        const text = JSON.stringify(e.payload);
        for (const v of Object.values(TYPED)) expect(text, `${e.type} carries "${v}"`).not.toContain(v);
      }
    }));
});

describe("tenant fences (review round 1)", () => {
  it("a wrong account id answers not_found or null for every read and write by id, and the row is untouched (mutation: drop getPlace's or getEquipment's account filter -> FAILS)", () =>
    withTestAccount(async (db, accountId) => withTestAccount(async (_db, otherId) => {
      const ana = (await createContact(db, accountId, { firstName: "Ana" }, ACTOR)).id;
      const ctx = { subjectId: ana, actorId: ACTOR };
      const p = await addPlace(db, accountId, { contactId: ana, groupId: null }, fields(), ctx);
      const u = await addEquipment(db, accountId, p.id, unit(), ctx);
      expect(await getPlace(db, otherId, p.id)).toBeNull();
      expect(await getEquipment(db, otherId, u.id)).toBeNull();
      expect(await updatePlace(db, otherId, p.id, { landmark: "past the canal" }, ctx)).toBe("not_found");
      expect(await setPlaceOwner(db, otherId, p.id, { contactId: ana, groupId: null }, ctx)).toBe("not_found");
      expect(await setPlaceArchived(db, otherId, p.id, true, ctx)).toBe("not_found");
      expect(await removePlace(db, otherId, p.id, ctx)).toBe("not_found");
      expect(await updateEquipment(db, otherId, u.id, { notes: "x" }, ctx)).toBe("not_found");
      expect(await replaceEquipment(db, otherId, u.id, unit({ installed_on: "2026-10-11" }), ctx)).toBe("not_found");
      expect(await removeEquipment(db, otherId, u.id, ctx)).toBe("not_found");
      expect(await getPlace(db, accountId, p.id)).toEqual(p);
      expect(await getEquipment(db, accountId, u.id)).toEqual(u);
      expect(await placeEvents(db, otherId)).toEqual([]);
    })));
  it("restorePlace and restoreEquipment refuse another account's snapshot with 22023 and write nothing (mutation: drop either account check -> FAILS)", () =>
    withTestAccount(async (db, accountId) => withTestAccount(async (_db, otherId) => {
      const ana = (await createContact(db, accountId, { firstName: "Ana" }, ACTOR)).id;
      const ctx = { subjectId: ana, actorId: ACTOR };
      const p = await addPlace(db, accountId, { contactId: ana, groupId: null }, fields(), ctx);
      const u = await addEquipment(db, accountId, p.id, unit(), ctx);
      const unitSnap = await removeEquipment(db, accountId, u.id, ctx);
      if (typeof unitSnap === "string") throw new Error("remove unit");
      const gone = await removePlace(db, accountId, p.id, ctx);
      if (typeof gone === "string" || gone.mode !== "deleted") throw new Error("expected a delete");
      await expect(restorePlace(db, otherId, gone.snapshot, ctx)).rejects.toSatisfy(isCode("22023"));
      expect(await getPlace(db, accountId, p.id)).toBeNull();
      await restorePlace(db, accountId, gone.snapshot, ctx);
      await expect(restoreEquipment(db, otherId, unitSnap, ctx)).rejects.toSatisfy(isCode("22023"));
      expect(await getEquipment(db, accountId, u.id)).toBeNull();
    })));
});

describe("refusals and order (review round 1)", () => {
  it("updatePlace and updateEquipment refuse an empty patch or a field outside the editable set with 22023, writing nothing (mutation: drop the key check -> FAILS)", () =>
    withTestAccount(async (db, accountId) => {
      const ana = (await createContact(db, accountId, { firstName: "Ana" }, ACTOR)).id;
      const luis = (await createContact(db, accountId, { firstName: "Luis" }, ACTOR)).id;
      const ctx = { subjectId: ana, actorId: ACTOR };
      const p = await addPlace(db, accountId, { contactId: ana, groupId: null }, fields(), ctx);
      const other = await addPlace(db, accountId, { contactId: ana, groupId: null }, fields({ address: "9 Other St" }), ctx);
      const u = await addEquipment(db, accountId, p.id, unit(), ctx);
      for (const bad of [{}, { contact_id: luis }, { archived_at: "2026-10-11T00:00:00Z" }]) {
        await expect(updatePlace(db, accountId, p.id, bad as PlacePatch, ctx)).rejects.toSatisfy(isCode("22023"));
      }
      for (const bad of [{}, { place_id: other.id }, { replaces_id: u.id }]) {
        await expect(updateEquipment(db, accountId, u.id, bad as EquipmentPatch, ctx)).rejects.toSatisfy(isCode("22023"));
      }
      expect(await getPlace(db, accountId, p.id)).toEqual(p);
      expect(await getEquipment(db, accountId, u.id)).toEqual(u);
      expect((await placeEvents(db, accountId)).map((e) => e.type)).not.toContain("place.updated");
    }));
  it("lists the person's primary group first, whatever the names or join order (mutation: drop the primary-first sort -> FAILS)", () =>
    withTestAccount(async (db, accountId) => {
      const ana = (await createContact(db, accountId, { firstName: "Ana" }, ACTOR)).id;
      const alpha = await createGroupWithMember(db, accountId, ana, "household", "Alpha", null, ACTOR);
      const zeta = await createGroupWithMember(db, accountId, ana, "business", "Zeta Roofing", null, ACTOR);
      if (alpha.status !== "ok" || zeta.status !== "ok") throw new Error("groups");
      expect(await setPrimaryMembership(db, accountId, zeta.memberId, ACTOR)).toMatchObject({ status: "ok" });
      const r = await listContactPlaces(db, accountId, ana);
      expect(r.groups).toEqual([
        { id: zeta.groupId, kind: "business", name: "Zeta Roofing", isPrimary: true },
        { id: alpha.groupId, kind: "household", name: "Alpha", isPrimary: false },
      ]);
    }));
});

describe("no-op writes append nothing (review round 1)", () => {
  it("archiving an archived place, putting back a current one or giving a place the owner it has writes nothing and appends no event (mutations: drop the already-archived, already-current or same-owner guard -> FAILS)", () =>
    withTestAccount(async (db, accountId) => {
      const ana = (await createContact(db, accountId, { firstName: "Ana" }, ACTOR)).id;
      const ctx = { subjectId: ana, actorId: ACTOR };
      const p = await addPlace(db, accountId, { contactId: ana, groupId: null }, fields(), ctx);
      await addEquipment(db, accountId, p.id, unit(), ctx);
      await removePlace(db, accountId, p.id, ctx);
      const archived = await getPlace(db, accountId, p.id);
      expect(archived?.archived_at).not.toBeNull();
      expect(await setPlaceArchived(db, accountId, p.id, true, ctx)).toEqual(archived);
      expect(await removePlace(db, accountId, p.id, ctx)).toEqual({ mode: "archived", row: archived });
      await setPlaceArchived(db, accountId, p.id, false, ctx);
      const current = await getPlace(db, accountId, p.id);
      expect(await setPlaceArchived(db, accountId, p.id, false, ctx)).toEqual(current);
      expect(await setPlaceOwner(db, accountId, p.id, { contactId: ana.toUpperCase(), groupId: null }, ctx))
        .toEqual({ previous: { contactId: ana, groupId: null }, row: current });
      expect((await placeEvents(db, accountId)).map((e) => e.type))
        .toEqual(["place.added", "equipment.added", "place.removed", "place.restored"]);
    }));
  it("an edit whose values equal the stored ones, or are undefined, writes nothing and appends no event; a mixed patch names only what changed (mutation: write every patched key -> FAILS)", () =>
    withTestAccount(async (db, accountId) => {
      const ana = (await createContact(db, accountId, { firstName: "Ana" }, ACTOR)).id;
      const ctx = { subjectId: ana, actorId: ACTOR };
      const p = await addPlace(db, accountId, { contactId: ana, groupId: null }, fields({ landmark: "blue gate" }), ctx);
      const u = await addEquipment(db, accountId, p.id, unit(), ctx);
      expect(await updatePlace(db, accountId, p.id, { landmark: "blue gate" }, ctx)).toEqual({ previous: { landmark: "blue gate" }, row: p });
      expect(await updatePlace(db, accountId, p.id, { landmark: undefined }, ctx)).toEqual({ previous: { landmark: "blue gate" }, row: p });
      expect(await updateEquipment(db, accountId, u.id, { model: "XR14", notes: undefined }, ctx))
        .toEqual({ previous: { model: "XR14", notes: null }, row: u });
      const mixed = await updatePlace(db, accountId, p.id, { landmark: "blue gate", directions: "by the canal" }, ctx);
      expect(mixed).toMatchObject({ previous: { landmark: "blue gate", directions: null }, row: { directions: "by the canal" } });
      const events = await placeEvents(db, accountId);
      expect(events.map((e) => e.type)).toEqual(["place.added", "equipment.added", "place.updated"]);
      expect(events[2]!.payload).toMatchObject({ fields: ["directions"] });
    }));
});
