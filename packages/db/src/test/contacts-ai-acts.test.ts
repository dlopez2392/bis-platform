// Contact authors and the field-undo helpers (item 8c, plan Task 3): who created a contact
// (`contactAuthor`, 0091's columns), what a blank-fill actually wrote (`fillContactBlanksReport`'s
// `prior`/`written`), and the two reversible-act helpers `restoreContactFieldIf`/`lastFieldEditor`.
import { describe, it, expect } from "vitest";
import { withTestAccount } from "./fixtures";
import { createContact, getContact, fillContactBlanksReport, restoreContactFieldIf, lastFieldEditor } from "../contacts";

describe("createContact: author_kind/author_id (0091)", () => {
  it("a 'user' actor stores person + the actor's id", () =>
    withTestAccount(async (db, accountId) => {
      const c = await createContact(db, accountId, { firstName: "Ana", phone: "+15559990001" }, "user_abc", "user");
      const row = await getContact(db, accountId, c.id);
      expect(row!.author_kind).toBe("person");
      expect(row!.author_id).toBe("user_abc");
    }));

  it("an 'ai' actor stores ai, with no id", () =>
    withTestAccount(async (db, accountId) => {
      const c = await createContact(db, accountId, { firstName: "Bea", phone: "+15559990002" }, "sofia", "ai");
      const row = await getContact(db, accountId, c.id);
      expect(row!.author_kind).toBe("ai");
      expect(row!.author_id).toBeNull();
    }));

  it("a 'system' actor (the public form) stores customer", () =>
    withTestAccount(async (db, accountId) => {
      const c = await createContact(db, accountId, { firstName: "Cal", phone: "+15559990003" }, "form", "system");
      const row = await getContact(db, accountId, c.id);
      expect(row!.author_kind).toBe("customer");
      expect(row!.author_id).toBeNull();
    }));

  it("an explicit author wins over the actor (mutation: ignore input.author -> FAILS)", () =>
    withTestAccount(async (db, accountId) => {
      // actorType says "user" (would normally store person), but the caller passes an explicit import.
      const c = await createContact(db, accountId,
        { firstName: "Dee", phone: "+15559990004", author: { authorKind: "import", authorId: null } }, "user_xyz", "user");
      const row = await getContact(db, accountId, c.id);
      expect(row!.author_kind).toBe("import");
      expect(row!.author_id).toBeNull();
    }));

  it("an existing (dedupe) hit writes nothing: the author stays whatever the FIRST create wrote", () =>
    withTestAccount(async (db, accountId) => {
      const first = await createContact(db, accountId, { firstName: "Eli", phone: "+15559990005" }, "user_first", "user");
      const second = await createContact(db, accountId, { firstName: "Eli", phone: "+15559990005" }, "sofia", "ai");
      expect(second.existing).toBe(true);
      expect(second.id).toBe(first.id);
      const row = await getContact(db, accountId, first.id);
      expect(row!.author_kind).toBe("person");
      expect(row!.author_id).toBe("user_first");
    }));
});

describe("fillContactBlanksReport: prior/written (item 8c)", () => {
  it("on a 'Caller' placeholder contact, reports prior.firstName = 'Caller' and written.firstName = 'Ana'", () =>
    withTestAccount(async (db, accountId) => {
      const c = await createContact(db, accountId, { firstName: "Caller", phone: "+15559990006" }, "t");
      const report = await fillContactBlanksReport(db, accountId, c.id, { firstName: "Ana" }, "t");
      expect(report.fields).toEqual(["first_name"]);
      expect(report.prior.firstName).toBe("Caller");
      expect(report.written.firstName).toBe("Ana");
    }));

  it("reports a phone fill's written form as the STORED (E.164) value, not the raw input", () =>
    withTestAccount(async (db, accountId) => {
      const c = await createContact(db, accountId, { firstName: "Fay" }, "t");
      const report = await fillContactBlanksReport(db, accountId, c.id, { phone: "(956) 555-0188" }, "t");
      expect(report.fields).toContain("phone");
      expect(report.prior.phone ?? null).toBeNull();
      expect(report.written.phone).toBe("+19565550188");
    }));
});

describe("restoreContactFieldIf (item 8c)", () => {
  it("restores when the column still holds the expected value, and emits contact.updated as the actor", () =>
    withTestAccount(async (db, accountId) => {
      const c = await createContact(db, accountId, { firstName: "Caller" }, "t");
      await fillContactBlanksReport(db, accountId, c.id, { firstName: "Ana" }, "t");
      const outcome = await restoreContactFieldIf(db, accountId, c.id, "firstName", "Ana", "Caller", "undoer_1");
      expect(outcome).toBe("restored");
      const row = await getContact(db, accountId, c.id);
      expect(row!.first_name).toBe("Caller");
      const { data: ev } = await db.from("events").select("actor_id, payload")
        .eq("account_id", accountId).eq("type", "contact.updated").order("created_at", { ascending: false }).limit(1);
      expect((ev as { actor_id: string }[])[0]!.actor_id).toBe("undoer_1");
    }));

  it("answers 'changed' and writes nothing when the column has moved since (mutation: drop .eq(column, expected) -> FAILS)", () =>
    withTestAccount(async (db, accountId) => {
      const c = await createContact(db, accountId, { firstName: "Gus" }, "t");
      // The field no longer holds "Ana" (it was never set to it at all): the compare-and-swap must miss.
      const outcome = await restoreContactFieldIf(db, accountId, c.id, "firstName", "Ana", "Caller", "undoer_1");
      expect(outcome).toBe("changed");
      const row = await getContact(db, accountId, c.id);
      expect(row!.first_name).toBe("Gus");
    }));

  it("a phone restore writes the stored (phoneFields) form", () =>
    withTestAccount(async (db, accountId) => {
      const c = await createContact(db, accountId, { firstName: "Hal" }, "t");
      await fillContactBlanksReport(db, accountId, c.id, { phone: "(956) 555-0199" }, "t");
      const outcome = await restoreContactFieldIf(db, accountId, c.id, "phone", "+19565550199", null, "undoer_1");
      expect(outcome).toBe("restored");
      const row = await getContact(db, accountId, c.id);
      expect(row!.phone).toBeNull();
    }));
});

describe("lastFieldEditor (item 8c)", () => {
  it("names the person who most recently edited that field after the given instant", () =>
    withTestAccount(async (db, accountId) => {
      const c = await createContact(db, accountId, { firstName: "Ian" }, "t");
      const since = new Date().toISOString();
      await new Promise((r) => setTimeout(r, 5));
      const { updateContact } = await import("../contacts");
      await updateContact(db, accountId, c.id, { firstName: "Ivan" }, "user_person1", "user");
      const who = await lastFieldEditor(db, accountId, c.id, "firstName", since);
      expect(who).toBe("user_person1");
    }));

  it("answers null when nobody has edited that field since", () =>
    withTestAccount(async (db, accountId) => {
      const c = await createContact(db, accountId, { firstName: "Jon" }, "t");
      const who = await lastFieldEditor(db, accountId, c.id, "firstName", new Date().toISOString());
      expect(who).toBeNull();
    }));
});
