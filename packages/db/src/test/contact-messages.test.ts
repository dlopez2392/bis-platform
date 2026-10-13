import { describe, it, expect } from "vitest";
import "dotenv/config";
import { withTestAccount } from "./fixtures";
import { createContact } from "../contacts";
import { ensureConversation, createMessage, listContactMessages } from "../messaging";

/**
 * The gap this closes: a client emails a contact from that contact's own page,
 * gets a toast, and the record shows nothing. The message was only ever
 * reachable from Conversations, because the timeline had no way to ask for a
 * contact's messages — `listMessages` needs a conversation id the page does
 * not have.
 */
describe("listContactMessages", () => {
  it("returns a contact's messages oldest first", async () => {
    await withTestAccount(async (db, accountId) => {
      const { id: contactId } = await createContact(
        db, accountId, { firstName: "Maria", email: "maria@example.com" }, "user_test",
      );
      const convo = await ensureConversation(db, accountId, contactId, "user_test");
      await createMessage(db, accountId, {
        conversationId: convo.id, channel: "email", direction: "outbound",
        subject: "Quote", body: "Quote attached",
      }, "user_test");

      const messages = await listContactMessages(db, accountId, contactId);
      expect(messages).toHaveLength(1);
      expect(messages[0]!.body).toBe("Quote attached");
      expect(messages[0]!.direction).toBe("outbound");
    });
  });

  // A contact who has never been messaged has no conversation row at all, and
  // that is the common case — it must read as "nothing yet", not throw.
  it("returns nothing for a contact with no conversation", async () => {
    await withTestAccount(async (db, accountId) => {
      const { id: contactId } = await createContact(
        db, accountId, { firstName: "Silent" }, "user_test",
      );
      expect(await listContactMessages(db, accountId, contactId)).toEqual([]);
    });
  });
});

/**
 * S-03 part 2b (C6, C13): a household's record timeline reads every member's
 * texts and emails in one page, each row still naming its own contact — the
 * same `forContacts` single-vs-set shape Task 11 gave notes, To-dos, deals
 * and submissions.
 */
describe("listContactMessages: a household's set (S-03 part 2b)", () => {
  it("a set reads both people's messages in one page, newest first, each naming its own contact (probe: map every row to the first conversation's contact -> FAILS)", async () => {
    await withTestAccount(async (db, accountId) => {
      const { id: ana } = await createContact(
        db, accountId, { firstName: "Ana", email: "ana-2b@example.com" }, "user_test",
      );
      const { id: ben } = await createContact(
        db, accountId, { firstName: "Ben", email: "ben-2b@example.com" }, "user_test",
      );
      const anaConvo = await ensureConversation(db, accountId, ana, "user_test");
      const benConvo = await ensureConversation(db, accountId, ben, "user_test");
      const anaMsg = await createMessage(db, accountId, {
        conversationId: anaConvo.id, channel: "email", direction: "outbound",
        subject: "Quote", body: "Ana's quote",
      }, "user_test");
      const benMsg = await createMessage(db, accountId, {
        conversationId: benConvo.id, channel: "sms", direction: "inbound", body: "Ben's text",
      }, "user_test");
      const older = await db.from("messages").update({ created_at: "2026-10-01T00:00:00+00:00" }).eq("id", anaMsg.id);
      if (older.error) throw new Error(`older update failed: ${older.error.message}`);
      const newer = await db.from("messages").update({ created_at: "2026-10-09T00:00:00+00:00" }).eq("id", benMsg.id);
      if (newer.error) throw new Error(`newer update failed: ${newer.error.message}`);

      const both = await listContactMessages(db, accountId, [ana, ben], { limit: 31, channels: ["email", "sms"] });
      expect(both.map((m) => ({ body: m.body, contact_id: m.contact_id }))).toEqual([
        { body: "Ben's text", contact_id: ben },
        { body: "Ana's quote", contact_id: ana },
      ]);
    });
  });

  it("a set with one member who has no conversation reads only the other's messages", async () => {
    await withTestAccount(async (db, accountId) => {
      const { id: ana } = await createContact(
        db, accountId, { firstName: "Ana", email: "ana-2b-solo@example.com" }, "user_test",
      );
      const { id: silent } = await createContact(db, accountId, { firstName: "Silent" }, "user_test");
      const convo = await ensureConversation(db, accountId, ana, "user_test");
      await createMessage(db, accountId, {
        conversationId: convo.id, channel: "email", direction: "outbound", subject: "Hi", body: "hello",
      }, "user_test");

      const rows = await listContactMessages(db, accountId, [ana, silent], { limit: 31 });
      expect(rows.map((r) => r.contact_id)).toEqual([ana]);
    });
  });

  it("a set with no conversation at all returns []", async () => {
    await withTestAccount(async (db, accountId) => {
      const { id: a } = await createContact(db, accountId, { firstName: "A" }, "user_test");
      const { id: b } = await createContact(db, accountId, { firstName: "B" }, "user_test");
      expect(await listContactMessages(db, accountId, [a, b], { limit: 31 })).toEqual([]);
    });
  });

  it("a set with no page throws (the drawer never has one to give; probe: drop the guard -> FAILS)", async () => {
    await withTestAccount(async (db, accountId) => {
      const { id: a } = await createContact(db, accountId, { firstName: "A" }, "user_test");
      const { id: b } = await createContact(db, accountId, { firstName: "B" }, "user_test");
      await expect(listContactMessages(db, accountId, [a, b])).rejects.toThrow("a set needs a page");
    });
  });
});
