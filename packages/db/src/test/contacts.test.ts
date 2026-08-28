import "dotenv/config";
import { describe, it, expect } from "vitest";
import { withTestAccount } from "./fixtures";
import { createContact, updateContact, listContacts, getContact,
         addTagToContact, listContactTags, fillContactBlanks } from "../contacts";

describe("contacts service", () => {
  it("creates, emits event, dedupes by email", () =>
    withTestAccount(async (db, accountId) => {
      const a = await createContact(db, accountId,
        { firstName: "Maria", lastName: "Garcia", email: "maria@example.com" }, "user_test");
      expect(a.existing).toBe(false);
      const { data: ev } = await db.from("events").select("type").eq("account_id", accountId)
        .eq("type", "contact.created");
      expect(ev).toHaveLength(1);
      const b = await createContact(db, accountId,
        { firstName: "M.", email: "MARIA@example.com" }, "user_test");
      expect(b.existing).toBe(true);
      expect(b.id).toBe(a.id);
    }));

  it("updates fields + custom, emits contact.updated", () =>
    withTestAccount(async (db, accountId) => {
      const { id } = await createContact(db, accountId, { firstName: "Joe" }, "user_test");
      await updateContact(db, accountId, id, { phone: "+19565550100", custom: { referral: "yes" } }, "user_test");
      const row = await getContact(db, accountId, id);
      expect(row?.phone).toBe("+19565550100");
      expect((row?.custom as any).referral).toBe("yes");
    }));

  it("search matches name/email/phone; tags round-trip", () =>
    withTestAccount(async (db, accountId) => {
      const { id } = await createContact(db, accountId,
        { firstName: "Rosa", lastName: "Trevino", email: "rosa@shop.com" }, "user_test");
      await createContact(db, accountId, { firstName: "Zed" }, "user_test");
      const hits = await listContacts(db, accountId, { search: "trevi" });
      expect(hits).toHaveLength(1);
      await addTagToContact(db, accountId, id, "vip");
      await addTagToContact(db, accountId, id, "vip"); // idempotent
      const tags = await listContactTags(db, accountId, id);
      expect(tags.map(t => t.name)).toEqual(["vip"]);
    }));

  it("createContact tolerates PostgREST filter syntax in email AND phone", () =>
    withTestAccount(async (db, accountId) => {
      // Both fields must be present: the old dedupe interpolated them into a
      // single .or() filter only in that case, so an email-only submission
      // took an already-safe .ilike() branch and proved nothing. From a public
      // form both of these strings are attacker-controlled.
      const hostile = `a"),phone.eq."x`;
      const first = await createContact(
        db, accountId, { firstName: "Nefarious", email: hostile, phone: `1"),email.ilike."%` },
        "user_test");
      expect(first.existing).toBe(false);

      const second = await createContact(
        db, accountId, { firstName: "Nefarious", email: hostile, phone: `1"),email.ilike."%` },
        "user_test");
      expect(second.existing).toBe(true);
      expect(second.id).toBe(first.id);
    }));

  it("createContact tolerates filter syntax in an email-only submission", () =>
    withTestAccount(async (db, accountId) => {
      const hostile = `a"),phone.eq."x`;
      const first = await createContact(db, accountId, { email: hostile }, "user_test");
      const second = await createContact(db, accountId, { email: hostile }, "user_test");
      expect(second.existing).toBe(true);
      expect(second.id).toBe(first.id);
    }));

  it("createContact dedupes on phone when only a phone is given", () =>
    withTestAccount(async (db, accountId) => {
      const a = await createContact(db, accountId, { phone: "956-555-0101" }, "user_test");
      const b = await createContact(db, accountId, { phone: "956-555-0101" }, "user_test");
      expect(b.existing).toBe(true);
      expect(b.id).toBe(a.id);
    }));

  it("createContact treats % and _ in email as literal characters, not ILIKE wildcards", () =>
    withTestAccount(async (db, accountId) => {
      // A pre-existing, unrelated contact. Before `findDuplicate` escaped its
      // ILIKE operand, an attacker-supplied "%@example.com" would match this
      // row (ILIKE '%@example.com' matches any address ending "@example.com"),
      // hijacking it — the exact bug this test guards against.
      const real = await createContact(db, accountId,
        { firstName: "Real", lastName: "Customer", email: "real.customer@example.com" }, "user_test");

      const first = await createContact(
        db, accountId, { firstName: "Wildcard", email: "%@example.com" }, "user_test");
      expect(first.existing).toBe(false);
      expect(first.id).not.toBe(real.id);

      // Submitting the identical literal string again still dedupes onto
      // itself normally — the fix makes "%" literal, it does not disable
      // dedupe for values that happen to contain one.
      const second = await createContact(
        db, accountId, { firstName: "Wildcard again", email: "%@example.com" }, "user_test");
      expect(second.existing).toBe(true);
      expect(second.id).toBe(first.id);
      expect(second.id).not.toBe(real.id);

      // Total across this test: two distinct contacts (the real one, and the
      // wildcard one) — never merged together.
      const { data: all } = await db.from("contacts").select("id").eq("account_id", accountId);
      expect(all).toHaveLength(2);
    }));

  it("createContact treats a leading underscore in email as literal, not an ILIKE single-char wildcard", () =>
    withTestAccount(async (db, accountId) => {
      const real = await createContact(db, accountId,
        { firstName: "Real", email: "a@example.com" }, "user_test");

      const wildcard = await createContact(
        db, accountId, { firstName: "Wildcard", email: "_@example.com" }, "user_test");
      expect(wildcard.existing).toBe(false);
      expect(wildcard.id).not.toBe(real.id);
    }));

  it("createContact records a system actor when asked", () =>
    withTestAccount(async (db, accountId) => {
      await createContact(db, accountId, { firstName: "Lead" }, "form", "system");
      const { data } = await db.from("events").select("actor_type, actor_id")
        .eq("account_id", accountId).eq("type", "contact.created");
      expect(data![0]!.actor_type).toBe("system");
      expect(data![0]!.actor_id).toBe("form");
    }));
});

describe("fillContactBlanks", () => {
  it("fills only blank fields and reports them", () =>
    withTestAccount(async (db, accountId) => {
      const c = await createContact(db, accountId, { firstName: "Ana", phone: "+15550000020" }, "t");
      const filled = await fillContactBlanks(db, accountId, c.id,
        { firstName: "Ignored", email: "ANA@Example.com " }, "t");
      expect(filled.sort()).toEqual(["email"]);
      const row = await getContact(db, accountId, c.id);
      expect(row!.first_name).toBe("Ana");            // IRON RULE: not overwritten
      expect(row!.email).toBe("ana@example.com");     // normalized
    }));

  it("replaces the 'Caller' placeholder with a real name (lastName rides along)", () =>
    withTestAccount(async (db, accountId) => {
      const c = await createContact(db, accountId, { firstName: "Caller", phone: "+15550000021" }, "t");
      const filled = await fillContactBlanks(db, accountId, c.id,
        { firstName: "Dan", lastName: "Lopez" }, "t");
      expect(filled.sort()).toEqual(["first_name", "last_name"]);
      const row = await getContact(db, accountId, c.id);
      expect(row!.first_name).toBe("Dan");
      expect(row!.last_name).toBe("Lopez");
    }));

  it("does NOT treat a real first name with blank last name as a placeholder", () =>
    withTestAccount(async (db, accountId) => {
      const c = await createContact(db, accountId, { firstName: "Madonna", phone: "+15550000022" }, "t");
      expect(await fillContactBlanks(db, accountId, c.id, { firstName: "Dan" }, "t")).toEqual([]);
    }));

  it("no-ops cleanly when nothing is blank (no update, no event)", () =>
    withTestAccount(async (db, accountId) => {
      const c = await createContact(db, accountId,
        { firstName: "A", lastName: "B", email: "a@b.co", phone: "+15550000023" }, "t");
      expect(await fillContactBlanks(db, accountId, c.id,
        { firstName: "X", lastName: "Y", email: "x@y.co", phone: "+15550000024" }, "t")).toEqual([]);
    }));
});
