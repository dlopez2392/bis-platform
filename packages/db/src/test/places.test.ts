import { describe, it, expect } from "vitest";
import { withTestAccount } from "./fixtures";
import { createContact } from "../contacts";
import { createGroupWithMember } from "../client-groups";
import { ACCOUNT_OWNED_TABLES } from "../account-teardown";
import {
  listContactPlaces, addPlace, removePlace, setPlaceArchived, restorePlace, addEquipment, replaceEquipment,
  updatePlace, removeEquipment, restoreEquipment, PlaceDbError, type PlaceFields, type EquipmentFields,
} from "../places";

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
