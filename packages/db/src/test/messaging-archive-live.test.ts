import { describe, it, expect } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { withTestAccount } from "./fixtures";
import { serviceDb } from "../service";
import { createContact } from "../contacts";
import {
  ensureConversation, createMessage, incrementUnreadCount, clearUnreadCount,
  listConversations, searchConversations, sumUnreadCount,
} from "../messaging";

/**
 * Review I8 (owner decision 2026-10-28): an archived contact's thread leaves the inbox and search
 * ONLY while it holds nothing unread. CI only (withTestAccount + serviceDb, same posture as
 * assignee-filters.test.ts: these call the real Supabase project's PostgREST, which this package's
 * local Postgres replica cannot stand in for — not run locally in this lane, per the plan's Global
 * Constraints). The pure half, which the mutation probes for `listConversations` and
 * `searchConversations` are run against locally, is src/messaging-archive.test.ts.
 */
const RUN = Math.random().toString(36).slice(2, 10);

/** Archives a contact directly on the service client — `archiveContacts` (T4) is not depended on
 *  here, so this writes `archived_at` the same way the app's authenticated client would, minus the
 *  stamp trigger's role check (service_role is not 'authenticated', so archived_by is left null;
 *  irrelevant to this file, which asserts only on conversations.inbox_visible's effects). */
async function archiveContact(db: SupabaseClient, contactId: string): Promise<void> {
  const { error } = await db.from("contacts")
    .update({ archived_at: new Date().toISOString() }).eq("id", contactId);
  if (error) throw new Error(`archiveContact failed: ${error.message}`);
}

async function person(db: SupabaseClient, tag: string): Promise<string> {
  const clerk = `user_mal_${tag}_${RUN}`;
  const { data, error } = await db.from("users")
    .insert({ clerk_user_id: clerk, email: `${clerk}@example.com` }).select("id").single();
  if (error) throw error;
  return data!.id as string;
}

describe("an archived contact's thread leaves the inbox and search while nothing in it is unread (review I8, CI only)", () => {
  it("a quiet archived thread (unread 0) is dropped; a loud one (unread > 0) stays listed, found and counted, then leaves once read (mutation: drop `.eq(\"inbox_visible\", true)` in listConversations -> the quiet thread's assertion FAILS; mutation: filter only the second read in searchConversations -> the found-by-search assertion FAILS)", async () => {
    await withTestAccount(async (db, accountId) => {
      const quiet = await createContact(db, accountId, { firstName: "Quiet" }, "user_test");
      const loud = await createContact(db, accountId, { firstName: "Loud" }, "user_test");
      const quietConvo = await ensureConversation(db, accountId, quiet.id, "user_test");
      const loudConvo = await ensureConversation(db, accountId, loud.id, "user_test");
      // Quiet: only OUR outbound text-back — unread stays 0, same as a junk caller's thread.
      await createMessage(db, accountId,
        { conversationId: quietConvo.id, channel: "sms", direction: "outbound", body: "On our way, thanks for waiting." },
        "user_test");
      // Loud: the customer's own inbound text — unread raised explicitly (createMessage never does).
      await createMessage(db, accountId,
        { conversationId: loudConvo.id, channel: "sms", direction: "inbound", body: "the roof is leaking again" },
        "user_test");
      await incrementUnreadCount(db, accountId, loudConvo.id);

      await archiveContact(db, quiet.id);
      await archiveContact(db, loud.id);

      const inbox = await listConversations(db, accountId);
      const inboxIds = inbox.map((c) => c.id);
      expect(inboxIds).not.toContain(quietConvo.id);
      expect(inboxIds).toContain(loudConvo.id);

      const foundLoud = await searchConversations(db, accountId, { search: "leaking" });
      expect(foundLoud.map((c) => c.id)).toEqual([loudConvo.id]);
      const foundQuiet = await searchConversations(db, accountId, { search: "waiting" });
      expect(foundQuiet.map((c) => c.id)).not.toContain(quietConvo.id);

      expect(await sumUnreadCount(db, accountId)).toBeGreaterThanOrEqual(1);

      await clearUnreadCount(db, accountId, loudConvo.id);
      const afterRead = await listConversations(db, accountId);
      expect(afterRead.map((c) => c.id)).not.toContain(loudConvo.id);
    });
  });

  it("B's matching archived threads — quiet or loud — never appear in A's inbox, search or badge (second account; mutation: drop the account_id filter anywhere in either read -> FAILS)", async () => {
    await withTestAccount(async (dbA, accountA) => {
      await withTestAccount(async (dbB, accountB) => {
        const contactB = await createContact(dbB, accountB, { firstName: "Bea" }, "user_test");
        const convoB = await ensureConversation(dbB, accountB, contactB.id, "user_test");
        await createMessage(dbB, accountB,
          { conversationId: convoB.id, channel: "sms", direction: "inbound", body: "fence quote please" },
          "user_test");
        await incrementUnreadCount(dbB, accountB, convoB.id);
        await archiveContact(dbB, contactB.id);

        const inboxA = await listConversations(dbA, accountA);
        expect(inboxA.map((c) => c.id)).not.toContain(convoB.id);

        const foundA = await searchConversations(dbA, accountA, { search: "fence" });
        expect(foundA.map((c) => c.id)).not.toContain(convoB.id);

        // A's own badge counts only A's own conversations; B's unread row — archived or not —
        // never contributes to it. sumUnreadCount is deliberately unfiltered on archive (the
        // "Unchanged on purpose" rule), so this proves account scoping, not the archive rule.
        expect(await sumUnreadCount(dbA, accountA)).toBe(0);
      });
    });
  });

  it("a Technician's Mine filter still returns their own ACTIVE customer's thread once inbox_visible joins the query (mutation: drop `.eq(\"inbox_visible\", true)` in listConversations -> this case still passes on its own, so it is not the catch; the quiet/loud case above is)", async () => {
    try {
      await withTestAccount(async (db, accountId) => {
        const tech = await person(db, "tech");
        const { data: contact, error } = await db.from("contacts")
          .insert({ account_id: accountId, first_name: "Mine", assigned_to: tech }).select("id").single();
        if (error) throw error;
        const convo = await ensureConversation(db, accountId, contact!.id as string, "user_test");
        await createMessage(db, accountId,
          { conversationId: convo.id, channel: "sms", direction: "inbound", body: "when can you come by" },
          "user_test");

        const mine = await listConversations(db, accountId, { assignee: { who: "mine", userId: tech } });
        expect(mine.map((c) => c.id)).toEqual([convo.id]);
      });
    } finally {
      const { error } = await serviceDb().from("users").delete().like("clerk_user_id", `user_mal_%_${RUN}`);
      if (error) throw new Error(`messaging-archive-live.test cleanup failed on users: ${error.message}`);
    }
  });
});
