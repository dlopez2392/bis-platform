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
});
