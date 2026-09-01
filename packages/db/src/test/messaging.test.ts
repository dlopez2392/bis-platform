import { describe, it, expect } from "vitest";
import { withTestAccount } from "./fixtures";
import { createContact } from "../contacts";
import {
  ensureConversation, createMessage, updateMessageStatus,
  updateMessageStatusByProviderId, listConversations, listMessages,
  incrementUnreadCount, sumUnreadCount,
} from "../messaging";

describe("messaging", () => {
  it("ensureConversation is idempotent per contact", () =>
    withTestAccount(async (db, accountId) => {
      const { id: contactId } = await createContact(db, accountId, { firstName: "Ada" }, "user_test");

      const first = await ensureConversation(db, accountId, contactId, "user_test");
      const second = await ensureConversation(db, accountId, contactId, "user_test");

      expect(second.id).toBe(first.id);
      expect(first.created).toBe(true);
      expect(second.created).toBe(false);

      const convos = await listConversations(db, accountId);
      expect(convos).toHaveLength(1);
    }));

  it("ensureConversation is safe under a concurrent race: one creator, one event", () =>
    withTestAccount(async (db, accountId) => {
      const { id: contactId } = await createContact(db, accountId, { firstName: "Grace" }, "user_test");

      const [a, b] = await Promise.all([
        ensureConversation(db, accountId, contactId, "user_test"),
        ensureConversation(db, accountId, contactId, "user_test"),
      ]);

      expect(a.id).toBe(b.id);
      expect([a.created, b.created].filter(Boolean)).toHaveLength(1);

      const { data: ev } = await db.from("events").select("type").eq("account_id", accountId)
        .eq("type", "conversation.created");
      expect(ev).toHaveLength(1);
    }));

  it("createMessage writes the row and bumps last_message_at", () =>
    withTestAccount(async (db, accountId) => {
      const { id: contactId } = await createContact(db, accountId, { firstName: "Ada" }, "user_test");
      const convo = await ensureConversation(db, accountId, contactId, "user_test");

      await createMessage(db, accountId, {
        conversationId: convo.id, channel: "email", direction: "outbound",
        subject: "Hello", body: "First contact",
      }, "user_test");

      const messages = await listMessages(db, accountId, convo.id);
      expect(messages).toHaveLength(1);
      expect(messages[0]!.status).toBe("queued");
      expect(messages[0]!.subject).toBe("Hello");

      const [summary] = await listConversations(db, accountId);
      expect(summary!.lastMessageAt).not.toBeNull();
      expect(summary!.lastMessagePreview).toContain("First contact");
    }));

  it("createMessage emits message.created for a successfully inserted message", () =>
    withTestAccount(async (db, accountId) => {
      const { id: contactId } = await createContact(db, accountId, { firstName: "Ada" }, "user_test");
      const convo = await ensureConversation(db, accountId, contactId, "user_test");

      const { id: messageId } = await createMessage(db, accountId, {
        conversationId: convo.id, channel: "email", direction: "outbound", body: "hi",
      }, "user_test");

      const { data: ev } = await db.from("events").select("type, payload")
        .eq("account_id", accountId).eq("type", "message.created");
      expect(ev).toHaveLength(1);
      expect((ev![0]!.payload as { messageId: string }).messageId).toBe(messageId);
    }));

  it("updateMessageStatus records a provider id and an error", () =>
    withTestAccount(async (db, accountId) => {
      const { id: contactId } = await createContact(db, accountId, { firstName: "Ada" }, "user_test");
      const convo = await ensureConversation(db, accountId, contactId, "user_test");
      const { id } = await createMessage(db, accountId, {
        conversationId: convo.id, channel: "email", direction: "outbound", body: "x",
      }, "user_test");

      await updateMessageStatus(db, accountId, id, "sent", { providerMessageId: "prov_1" }, "user_test");
      let [msg] = await listMessages(db, accountId, convo.id);
      expect(msg!.status).toBe("sent");
      expect(msg!.provider_message_id).toBe("prov_1");

      await updateMessageStatus(db, accountId, id, "failed", { error: "boom" }, "user_test");
      [msg] = await listMessages(db, accountId, convo.id);
      expect(msg!.status).toBe("failed");
      expect(msg!.error).toBe("boom");
    }));

  it("updateMessageStatusByProviderId finds the row without tenant context", () =>
    withTestAccount(async (db, accountId) => {
      const { id: contactId } = await createContact(db, accountId, { firstName: "Ada" }, "user_test");
      const convo = await ensureConversation(db, accountId, contactId, "user_test");
      const { id } = await createMessage(db, accountId, {
        conversationId: convo.id, channel: "email", direction: "outbound", body: "x",
      }, "user_test");
      await updateMessageStatus(db, accountId, id, "sent", { providerMessageId: "prov_2" }, "user_test");

      const hit = await updateMessageStatusByProviderId(db, "prov_2", "delivered");
      expect(hit.updated).toBe(true);

      const [msg] = await listMessages(db, accountId, convo.id);
      expect(msg!.status).toBe("delivered");
    }));

  it("updateMessageStatusByProviderId ignores an unknown id without throwing", () =>
    withTestAccount(async (db) => {
      const miss = await updateMessageStatusByProviderId(db, "prov_does_not_exist", "delivered");
      expect(miss.updated).toBe(false);
    }));

  it("updateMessageStatusByProviderId logs the webhook update as the system actor, not a user", () =>
    withTestAccount(async (db, accountId) => {
      const { id: contactId } = await createContact(db, accountId, { firstName: "Ada" }, "user_test");
      const convo = await ensureConversation(db, accountId, contactId, "user_test");
      const { id } = await createMessage(db, accountId, {
        conversationId: convo.id, channel: "email", direction: "outbound", body: "x",
      }, "user_test");
      await updateMessageStatus(db, accountId, id, "sent", { providerMessageId: "prov_actor" }, "user_test");

      await updateMessageStatusByProviderId(db, "prov_actor", "delivered");

      const { data: ev } = await db.from("events").select("actor_type, actor_id")
        .eq("account_id", accountId).eq("type", "message.status_changed")
        .order("created_at", { ascending: false }).limit(1);
      expect(ev![0]!.actor_type).toBe("system");
      expect(ev![0]!.actor_id).toBe("system");
    }));

  it("updateMessageStatusByProviderId does not regress status when a later event arrives out of order", () =>
    withTestAccount(async (db, accountId) => {
      const { id: contactId } = await createContact(db, accountId, { firstName: "Ada" }, "user_test");
      const convo = await ensureConversation(db, accountId, contactId, "user_test");
      const { id } = await createMessage(db, accountId, {
        conversationId: convo.id, channel: "email", direction: "outbound", body: "x",
      }, "user_test");
      await updateMessageStatus(db, accountId, id, "sent", { providerMessageId: "prov_order" }, "user_test");

      await updateMessageStatusByProviderId(db, "prov_order", "opened");
      // "delivered" is earlier than "opened" on the lifecycle scale — a
      // provider replay or reorder must not revert the row.
      await updateMessageStatusByProviderId(db, "prov_order", "delivered");

      const [msg] = await listMessages(db, accountId, convo.id);
      expect(msg!.status).toBe("opened");
    }));

  it("updateMessageStatusByProviderId treats a replayed event as a true no-op: no second event row", () =>
    withTestAccount(async (db, accountId) => {
      const { id: contactId } = await createContact(db, accountId, { firstName: "Ada" }, "user_test");
      const convo = await ensureConversation(db, accountId, contactId, "user_test");
      const { id } = await createMessage(db, accountId, {
        conversationId: convo.id, channel: "email", direction: "outbound", body: "x",
      }, "user_test");
      await updateMessageStatus(db, accountId, id, "sent", { providerMessageId: "prov_replay" }, "user_test");

      await updateMessageStatusByProviderId(db, "prov_replay", "delivered");
      await updateMessageStatusByProviderId(db, "prov_replay", "delivered");

      const [msg] = await listMessages(db, accountId, convo.id);
      expect(msg!.status).toBe("delivered");

      const { data: ev } = await db.from("events").select("id")
        .eq("account_id", accountId).eq("type", "message.status_changed");
      // One from the initial "sent" write above, one from the first
      // "delivered" — the replayed second call must not add a third.
      expect(ev).toHaveLength(2);
    }));

  it("listConversations orders most-recent first", () =>
    withTestAccount(async (db, accountId) => {
      const a = await createContact(db, accountId, { firstName: "Older" }, "user_test");
      const b = await createContact(db, accountId, { firstName: "Newer" }, "user_test");
      const ca = await ensureConversation(db, accountId, a.id, "user_test");
      const cb = await ensureConversation(db, accountId, b.id, "user_test");

      await createMessage(db, accountId, {
        conversationId: ca.id, channel: "email", direction: "outbound", body: "first",
      }, "user_test");
      await createMessage(db, accountId, {
        conversationId: cb.id, channel: "email", direction: "outbound", body: "second",
      }, "user_test");

      const convos = await listConversations(db, accountId);
      expect(convos[0]!.id).toBe(cb.id);
      expect(convos[1]!.id).toBe(ca.id);
    }));

  it("sumUnreadCount adds unread_count across every conversation in the account", () =>
    withTestAccount(async (db, accountId) => {
      const a = await createContact(db, accountId, { firstName: "Ada" }, "user_test");
      const b = await createContact(db, accountId, { firstName: "Grace" }, "user_test");
      const ca = await ensureConversation(db, accountId, a.id, "user_test");
      const cb = await ensureConversation(db, accountId, b.id, "user_test");

      await incrementUnreadCount(db, accountId, ca.id);
      await incrementUnreadCount(db, accountId, ca.id);
      await incrementUnreadCount(db, accountId, cb.id);

      expect(await sumUnreadCount(db, accountId)).toBe(3);
    }));

  it("sumUnreadCount is 0 for an account with no conversations", () =>
    withTestAccount(async (db, accountId) => {
      expect(await sumUnreadCount(db, accountId)).toBe(0);
    }));
});
