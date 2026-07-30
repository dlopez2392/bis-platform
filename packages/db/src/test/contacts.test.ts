import "dotenv/config";
import { describe, it, expect } from "vitest";
import { withTestAccount } from "./fixtures";
import { createContact, updateContact, listContacts, getContact,
         addTagToContact, listContactTags } from "../contacts";

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

  it("createContact records a system actor when asked", () =>
    withTestAccount(async (db, accountId) => {
      await createContact(db, accountId, { firstName: "Lead" }, "form", "system");
      const { data } = await db.from("events").select("actor_type, actor_id")
        .eq("account_id", accountId).eq("type", "contact.created");
      expect(data![0]!.actor_type).toBe("system");
      expect(data![0]!.actor_id).toBe("form");
    }));
});
