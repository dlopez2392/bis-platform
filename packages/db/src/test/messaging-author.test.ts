import { describe, it, expect } from "vitest";
import "dotenv/config";
import { withTestAccount } from "./fixtures";
import { createContact } from "../contacts";
import { ensureConversation, createMessage, listContactMessages } from "../messaging";

describe("createMessage names its author (S-03 1b, spec §5.2)", () => {
  it("a person, an automation, the receptionist, the customer (mutation: write author_kind 'person' always -> FAILS)", () =>
    withTestAccount(async (db, accountId) => {
      const { id: ana } = await createContact(db, accountId, { firstName: "Ana" }, "user_test");
      const { id: conv } = await ensureConversation(db, accountId, ana, "user_test");
      const send = (direction: "inbound" | "outbound", actorId: string, actorType: "user" | "system" | "ai") =>
        createMessage(db, accountId, { conversationId: conv, channel: "sms", direction, body: "x" }, actorId, actorType);
      const ids = {
        staff: (await send("outbound", "user_dan", "user")).id,
        recipe: (await send("outbound", "automation", "system")).id,
        textback: (await send("outbound", "voice", "ai")).id,
        inbound: (await send("inbound", "sms-inbound", "system")).id,
      };
      const { data, error } = await db.from("messages").select("id, author_kind, author_id").in("id", Object.values(ids));
      if (error) throw new Error(`author read failed: ${error.message}`);
      const by = (id: string) => (data ?? []).find((r: { id: string }) => r.id === id);
      expect(by(ids.staff)).toMatchObject({ author_kind: "person", author_id: "user_dan" });
      expect(by(ids.recipe)).toMatchObject({ author_kind: "automation", author_id: null });
      expect(by(ids.textback)).toMatchObject({ author_kind: "ai", author_id: null });
      expect(by(ids.inbound)).toMatchObject({ author_kind: "customer", author_id: null });
    }));
});

describe("listContactMessages, paged for the timeline (spec §7, C4)", () => {
  it("only email and text, newest first, past the cursor; with no page, today's whole thread oldest first (mutation: drop the channel filter -> the form copy appears, FAILS)", () =>
    withTestAccount(async (db, accountId) => {
      const { id: ana } = await createContact(db, accountId, { firstName: "Ana" }, "user_test");
      const { id: conv } = await ensureConversation(db, accountId, ana, "user_test");
      const mk = async (channel: "sms" | "email" | "form" | "voice", at: string) => {
        const { id } = await createMessage(db, accountId, { conversationId: conv, channel, direction: "inbound", body: channel }, "x", "system");
        // Fails loudly: a silently refused update would leave every row at "now" and the order untested.
        const moved = await db.from("messages").update({ created_at: at }).eq("id", id);
        if (moved.error) throw new Error(`fixture update failed: ${moved.error.message}`);
        return id;
      };
      const sms = await mk("sms", "2026-10-01T10:00:00+00:00");
      await mk("form", "2026-10-02T10:00:00+00:00");
      const email = await mk("email", "2026-10-03T10:00:00+00:00");
      await mk("voice", "2026-10-04T10:00:00+00:00");
      const page = (await listContactMessages(db, accountId, ana, { limit: 31, channels: ["email", "sms"] })) as { id: string; created_at: string; author_kind: string }[];
      expect(page.map((m) => m.id)).toEqual([email, sms]);
      expect(page[0]!.author_kind).toBe("customer");
      const older = (await listContactMessages(db, accountId, ana, { limit: 31, channels: ["email", "sms"], before: { v: page[0]!.created_at, id: email } })) as { id: string }[];
      expect(older.map((m) => m.id)).toEqual([sms]);
      expect(((await listContactMessages(db, accountId, ana)) as { channel: string }[]).map((m) => m.channel)).toEqual(["sms", "form", "email", "voice"]);
    }));
});
