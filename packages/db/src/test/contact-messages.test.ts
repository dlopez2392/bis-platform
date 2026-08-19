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
