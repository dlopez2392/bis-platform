import { describe, it, expect } from "vitest";
import { withTestAccount } from "./fixtures";
import { serviceDb } from "../service";
import { createContact } from "../contacts";
import { ACCOUNT_OWNED_TABLES } from "../account-teardown";
import {
  listContactRelationships, getRelationship, addRelationship, setRelationshipSides, removeRelationship,
  restoreRelationship, RelationshipDbError, type NewRelationship,
} from "../relationships";
import type { RelationshipKey } from "../relationship-keys";

const base = (a: string, b: string, labelKey: RelationshipKey = "parent"): NewRelationship => ({
  contactId: a, relatedContactId: b, labelKey, customLabel: null, contactForm: null, relatedForm: null,
  contactCanPickUp: false, contactIsEmergency: false, relatedCanPickUp: false, relatedIsEmergency: false,
});
const person = async (db: Parameters<typeof createContact>[0], accountId: string, firstName: string) =>
  (await createContact(db, accountId, { firstName, lastName: "Ramírez" }, "user_test")).id;

describe("relationships (spec §6)", () => {
  it("one row reads from both records, each with the OTHER person (mutation: return people for both ids -> FAILS)", () =>
    withTestAccount(async (db, accountId) => {
      const ana = await person(db, accountId, "Ana");
      const sofia = await person(db, accountId, "Sofía");
      const row = await addRelationship(db, accountId, { ...base(ana, sofia), contactForm: "f", relatedForm: "f" }, "user_test");
      const onSofia = await listContactRelationships(db, accountId, sofia);
      expect(onSofia.rows.map((r) => r.id)).toEqual([row.id]);
      expect(onSofia.people).toEqual([{ id: ana, first_name: "Ana", last_name: "Ramírez" }]);
      const onAna = await listContactRelationships(db, accountId, ana);
      expect(onAna.rows.map((r) => r.id)).toEqual([row.id]);
      expect(onAna.people).toEqual([{ id: sofia, first_name: "Sofía", last_name: "Ramírez" }]);
    }));

  it("a customer with none reads empty", () => withTestAccount(async (db, accountId) => {
    const solo = await person(db, accountId, "Solo");
    expect(await listContactRelationships(db, accountId, solo)).toEqual({ rows: [], people: [] });
  }));

  it("a non-uuid id is refused before any query is built (mutation: drop assertUuid -> FAILS with a PostgREST error instead)", () =>
    withTestAccount(async (db, accountId) => {
      await expect(listContactRelationships(db, accountId, "x,contact_id.neq.0")).rejects.toMatchObject({ code: "22P02", name: "RelationshipDbError" });
    }));

  it("a duplicate keeps its SQLSTATE (mutation: throw a plain Error -> FAILS)", () => withTestAccount(async (db, accountId) => {
    const a = await person(db, accountId, "A");
    const b = await person(db, accountId, "B");
    await addRelationship(db, accountId, base(a, b), "user_test");
    const e = await addRelationship(db, accountId, base(b, a), "user_test").catch((x: unknown) => x);
    expect(e).toBeInstanceOf(RelationshipDbError);
    expect((e as RelationshipDbError).code).toBe("23505");
  }));

  it("setRelationshipSides changes only side columns and hands back what they were (mutation: previous read after the write -> FAILS)", () =>
    withTestAccount(async (db, accountId) => {
      const a = await person(db, accountId, "A");
      const b = await person(db, accountId, "B");
      const row = await addRelationship(db, accountId, base(a, b), "user_test");
      const r = await setRelationshipSides(db, accountId, row.id, { contact_can_pick_up: true, contact_form: "m" }, "user_test");
      if (typeof r === "string") throw new Error(`unexpected ${r}`);
      expect(r.previous).toEqual({ contact_can_pick_up: false, contact_form: null });
      expect((await getRelationship(db, accountId, row.id))).toMatchObject({ contact_can_pick_up: true, contact_form: "m" });
      expect(await setRelationshipSides(db, accountId, crypto.randomUUID(), { contact_form: "f" }, "user_test")).toBe("not_found");
      await expect(setRelationshipSides(db, accountId, row.id, { label_key: "spouse" } as never, "user_test")).rejects.toMatchObject({ code: "22023" });
    }));

  it("remove returns the row, a second remove finds nothing, restore puts back the same id (mutation: restore without id -> FAILS)", () =>
    withTestAccount(async (db, accountId) => {
      const a = await person(db, accountId, "A");
      const b = await person(db, accountId, "B");
      const row = await addRelationship(db, accountId, base(a, b, "godparent"), "user_test");
      const removed = await removeRelationship(db, accountId, row.id, "user_test");
      expect(removed).toMatchObject({ id: row.id, label_key: "godparent" });
      expect(await removeRelationship(db, accountId, row.id, "user_test")).toBe("not_found");
      const back = await restoreRelationship(db, accountId, removed as typeof row, "user_test");
      expect(back.id).toBe(row.id);
      expect((await listContactRelationships(db, accountId, a)).rows.map((r) => r.id)).toEqual([row.id]);
    }));

  it("restoring when one person was deleted meanwhile keeps 23503 (mutation: swallow the error -> FAILS)", () => withTestAccount(async (db, accountId) => {
    const a = await person(db, accountId, "A");
    const b = await person(db, accountId, "B");
    const row = await addRelationship(db, accountId, base(a, b, "caregiver"), "user_test");
    const removed = await removeRelationship(db, accountId, row.id, "user_test");
    const { error } = await db.from("contacts").delete().eq("id", b);
    if (error) throw new Error(error.message);
    await expect(restoreRelationship(db, accountId, removed as typeof row, "user_test")).rejects.toMatchObject({ code: "23503" });
  }));

  it("each write appends its event with the ids and the key, never the typed text (mutation: drop the removed emit -> FAILS)", () =>
    withTestAccount(async (db, accountId) => {
      const a = await person(db, accountId, "A");
      const b = await person(db, accountId, "B");
      const row = await addRelationship(db, accountId, { ...base(a, b, "other"), customLabel: "Vecina" }, "user_test");
      await setRelationshipSides(db, accountId, row.id, { related_is_emergency: true }, "user_test");
      await removeRelationship(db, accountId, row.id, "user_test");
      const { data, error } = await db.from("events").select("type, payload").eq("account_id", accountId)
        // id, not created_at: three appends can share a millisecond. events.id is
        // `bigint generated always as identity` (0001_tenancy.sql:59), so it ascends with the appends.
        .like("type", "contact.relationship%").order("id", { ascending: true });
      if (error) throw new Error(error.message);
      expect((data ?? []).map((e) => e.type)).toEqual(
        ["contact.relationship_added", "contact.relationship_updated", "contact.relationship_removed"]);
      for (const e of data ?? []) {
        expect(e.payload).toMatchObject({ relationshipId: row.id, contactId: a, relatedContactId: b, labelKey: "other" });
        expect(JSON.stringify(e.payload)).not.toContain("Vecina");
      }
    }));

  it("account teardown removes relationships, listed before contacts (mutation: drop it from ACCOUNT_OWNED_TABLES -> FAILS)", async () => {
    expect(ACCOUNT_OWNED_TABLES.indexOf("contact_relationships")).toBeGreaterThan(-1);
    expect(ACCOUNT_OWNED_TABLES.indexOf("contact_relationships")).toBeLessThan(ACCOUNT_OWNED_TABLES.indexOf("contacts"));
    let seen = "";
    await withTestAccount(async (db, accountId) => {
      seen = accountId;
      await addRelationship(db, accountId, base(await person(db, accountId, "A"), await person(db, accountId, "B"), "sibling"), "user_test");
    });
    const { data, error } = await serviceDb().from("contact_relationships").select("id").eq("account_id", seen);
    if (error) throw new Error(error.message);
    expect(data).toEqual([]);
  });
});
