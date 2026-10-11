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
// user-client.ts marks a client via Symbol.for("@bis/db:user-client") — a GLOBAL registry key,
// so this test can set the SAME mark on an otherwise perfectly ordinary, fully-working client
// (no fake/invalid JWT involved, which would fail the write for an unrelated reason and make the
// probe vacuous). Only the guard under test can still stop a write through a client marked this way.
const USER_CLIENT_MARK = Symbol.for("@bis/db:user-client");
const markAsUserClient = (db: Parameters<typeof createContact>[0]) =>
  Object.defineProperty(db, USER_CLIENT_MARK, { value: true, configurable: true });

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

  it("an uppercase-but-valid id still names the OTHER person, not the subject (mutation: drop the lowercase step -> FAILS)", () =>
    withTestAccount(async (db, accountId) => {
      const ana = await person(db, accountId, "Ana");
      const sofia = await person(db, accountId, "Sofía");
      await addRelationship(db, accountId, base(ana, sofia), "user_test");
      // PostgREST always echoes ids back lowercase; a caller who forwards Ana's id uppercase
      // must still see Sofía as the OTHER person, never Ana named on her own record.
      const { people } = await listContactRelationships(db, accountId, ana.toUpperCase());
      expect(people).toEqual([{ id: sofia, first_name: "Sofía", last_name: "Ramírez" }]);
    }));

  it("a customer with none reads empty", () => withTestAccount(async (db, accountId) => {
    const solo = await person(db, accountId, "Solo");
    expect(await listContactRelationships(db, accountId, solo)).toEqual({ rows: [], people: [] });
  }));

  it("a malformed id is refused by the guard itself, not merely by Postgres's uuid cast, and never leaks an unrelated stored row (mutation: drop assertUuid -> FAILS)", () =>
    withTestAccount(async (db, accountId) => {
      const ana = await person(db, accountId, "Ana");
      const sofia = await person(db, accountId, "Sofía");
      await addRelationship(db, accountId, base(ana, sofia), "user_test");
      // An unrelated pair, stored in the SAME account. A payload of just "x,..." dies on
      // Postgres's own uuid cast (22P02) regardless of the guard, which would still pass with
      // assertUuid deleted — proving nothing. This payload is a VALID uuid plus an extra or=
      // branch that survives the cast (`contact_id.not.is.null` needs no cast at all), so with
      // the guard removed the filter becomes "match everything in the account".
      const carlos = await person(db, accountId, "Carlos");
      const dana = await person(db, accountId, "Dana");
      const unrelated = await addRelationship(db, accountId, base(carlos, dana, "sibling"), "user_test");
      const malicious = `${ana},contact_id.not.is.null`;
      let thrown: unknown;
      let resolved: { rows: { id: string }[] } | undefined;
      try {
        resolved = await listContactRelationships(db, accountId, malicious);
      } catch (e) {
        thrown = e;
      }
      expect(thrown).toMatchObject({ code: "22P02", name: "RelationshipDbError" });
      expect((resolved?.rows ?? []).map((r) => r.id)).not.toContain(unrelated.id);
    }));

  it("a duplicate keeps its SQLSTATE (mutation: throw a plain Error -> FAILS)", () => withTestAccount(async (db, accountId) => {
    const a = await person(db, accountId, "A");
    const b = await person(db, accountId, "B");
    await addRelationship(db, accountId, base(a, b), "user_test");
    const e = await addRelationship(db, accountId, base(b, a), "user_test").catch((x: unknown) => x);
    expect(e).toBeInstanceOf(RelationshipDbError);
    expect((e as RelationshipDbError).code).toBe("23505");
  }));

  it("a support label is directional: the same direction twice is refused (23505, contact_relationships_directed), the reverse direction is a separate row (R7, mutation: swap which index backs it -> FAILS)", () =>
    withTestAccount(async (db, accountId) => {
      const a = await person(db, accountId, "A");
      const b = await person(db, accountId, "B");
      // contact_relationships_emergency (0070): an emergency_contact row must carry
      // contact_is_emergency: true on the side it's filed under.
      const emergency = { ...base(a, b, "emergency_contact"), contactIsEmergency: true };
      await addRelationship(db, accountId, emergency, "user_test");
      const e = await addRelationship(db, accountId, emergency, "user_test").catch((x: unknown) => x);
      expect(e).toBeInstanceOf(RelationshipDbError);
      expect((e as RelationshipDbError).code).toBe("23505");
      // Unlike a family/symmetric label (the test above), the REVERSE direction of a support
      // label is a distinct, allowed row: "B is A's emergency contact" too.
      const reverse = await addRelationship(
        db, accountId, { ...base(b, a, "emergency_contact"), contactIsEmergency: true }, "user_test");
      expect(reverse.contact_id).toBe(b);
      expect((await listContactRelationships(db, accountId, a)).rows).toHaveLength(2);
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

  it("remove returns the row, a second remove finds nothing, restore puts back the same id AND says so in its own event (mutation: restore without id, or drop restored:true -> FAILS)", () =>
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
      const { data, error } = await db.from("events").select("type, payload").eq("account_id", accountId)
        .eq("type", "contact.relationship_added").order("id", { ascending: false }).limit(1);
      if (error) throw new Error(error.message);
      expect(data?.[0]).toMatchObject({
        type: "contact.relationship_added",
        payload: { relationshipId: row.id, contactId: a, relatedContactId: b, labelKey: "godparent", restored: true },
      });
    }));

  // Retitled by the final review (item 8): it cannot tell RETURNING from the existence read (both
  // see contact_can_pick_up: true), so it claims only what it proves, a snapshot with every column.
  it("remove's Undo snapshot carries every column of the deleted row, the flag set just before included (mutation: narrow the delete's select to id -> FAILS)", () =>
    withTestAccount(async (db, accountId) => {
      const a = await person(db, accountId, "A");
      const b = await person(db, accountId, "B");
      const row = await addRelationship(db, accountId, base(a, b, "caregiver"), "user_test");
      const sided = await setRelationshipSides(db, accountId, row.id, { contact_can_pick_up: true }, "user_test");
      if (typeof sided === "string") throw new Error(`unexpected ${sided}`);
      const removed = await removeRelationship(db, accountId, row.id, "user_test");
      // If the delete's own select were narrowed back to "id" (the pre-fix shape), the snapshot
      // used for both the Undo return value and the removed event would be missing every column
      // but id, even though the row visibly has contact_can_pick_up: true at the moment it's
      // deleted.
      expect(removed).toMatchObject({ id: row.id, label_key: "caregiver", contact_can_pick_up: true });
    }));

  it("restore builds its insert from NAMED columns: an extra field is ignored, the id carries over, updated_at is refreshed (mutation: spread {...row} again -> FAILS)", () =>
    withTestAccount(async (db, accountId) => {
      const a = await person(db, accountId, "A");
      const b = await person(db, accountId, "B");
      const row = await addRelationship(db, accountId, base(a, b, "landlord"), "user_test");
      const removed = await removeRelationship(db, accountId, row.id, "user_test");
      if (typeof removed === "string") throw new Error(`unexpected ${removed}`);
      const withExtra = { ...removed, notAColumn: "should never reach postgrest" } as unknown as typeof removed;
      const back = await restoreRelationship(db, accountId, withExtra, "user_test");
      expect(back.id).toBe(row.id);
      expect(back.updated_at).not.toBe(row.updated_at);
      expect((back as unknown as Record<string, unknown>).notAColumn).toBeUndefined();
    }));

  it("restore stamps created_at on the server, never the snapshot's: a forged timestamp from the browser is ignored (final review item 9; mutation: insert created_at: row.created_at again -> FAILS)", () =>
    withTestAccount(async (db, accountId) => {
      const a = await person(db, accountId, "A");
      const b = await person(db, accountId, "B");
      const row = await addRelationship(db, accountId, base(a, b, "landlord"), "user_test");
      const removed = await removeRelationship(db, accountId, row.id, "user_test");
      if (typeof removed === "string") throw new Error(`unexpected ${removed}`);
      const back = await restoreRelationship(db, accountId, { ...removed, created_at: "2001-01-01T00:00:00+00:00" }, "user_test");
      expect(back.id).toBe(row.id);
      // The column default (now()) stamped it: no earlier than the row's first insert, nowhere near 2001.
      expect(Date.parse(back.created_at)).toBeGreaterThanOrEqual(Date.parse(row.created_at));
    }));

  it("a non-user actor on a user client is refused before any write — the insert is never attempted (mutation: drop assertActorAllowed in addRelationship -> FAILS)", () =>
    withTestAccount(async (db, accountId) => {
      const a = await person(db, accountId, "A");
      const b = await person(db, accountId, "B");
      markAsUserClient(db);
      await expect(addRelationship(db, accountId, base(a, b), "automation_x", "system"))
        .rejects.toMatchObject({ name: "RelationshipDbError" });
      expect((await listContactRelationships(db, accountId, a)).rows).toEqual([]);
    }));

  it("a non-user actor on a user client is refused before any write — an existing row survives a refused remove (mutation: drop assertActorAllowed in removeRelationship -> FAILS)", () =>
    withTestAccount(async (db, accountId) => {
      const a = await person(db, accountId, "A");
      const b = await person(db, accountId, "B");
      const row = await addRelationship(db, accountId, base(a, b, "landlord"), "user_test");
      markAsUserClient(db);
      await expect(removeRelationship(db, accountId, row.id, "automation_x", "system"))
        .rejects.toMatchObject({ name: "RelationshipDbError" });
      expect(await getRelationship(db, accountId, row.id)).toMatchObject({ id: row.id });
    }));

  it("a non-user actor on a user client is refused before any write — a refused edit changes nothing (final review item 8; mutation: drop assertActorAllowed in setRelationshipSides -> FAILS)", () =>
    withTestAccount(async (db, accountId) => {
      const a = await person(db, accountId, "A");
      const b = await person(db, accountId, "B");
      const row = await addRelationship(db, accountId, base(a, b, "landlord"), "user_test");
      markAsUserClient(db);
      await expect(setRelationshipSides(db, accountId, row.id, { contact_can_pick_up: true }, "automation_x", "system"))
        .rejects.toMatchObject({ name: "RelationshipDbError" });
      expect(await getRelationship(db, accountId, row.id)).toMatchObject({ id: row.id, contact_can_pick_up: false });
    }));

  it("a non-user actor on a user client is refused before any write — a refused restore puts nothing back (final review item 8; mutation: drop assertActorAllowed in restoreRelationship -> FAILS)", () =>
    withTestAccount(async (db, accountId) => {
      const a = await person(db, accountId, "A");
      const b = await person(db, accountId, "B");
      const row = await addRelationship(db, accountId, base(a, b, "landlord"), "user_test");
      const removed = await removeRelationship(db, accountId, row.id, "user_test");
      if (typeof removed === "string") throw new Error(`unexpected ${removed}`);
      markAsUserClient(db);
      await expect(restoreRelationship(db, accountId, removed, "automation_x", "system"))
        .rejects.toMatchObject({ name: "RelationshipDbError" });
      expect(await getRelationship(db, accountId, row.id)).toBeNull();
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
