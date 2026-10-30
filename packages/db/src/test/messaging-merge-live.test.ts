import "dotenv/config";
import { describe, it, expect } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { withTestAccount } from "./fixtures";
import { ensureConversation, createMessage, incrementUnreadForMessage } from "../messaging";
import { findReplyThread, matchSender } from "../inbound-email";
import { mergeContacts, undoContactMerge, contactMergePreview } from "../contact-merge";

/**
 * Task 7 (F-006), live half: threads and mail after a REAL merge — `ensureConversation`, `matchSender`,
 * `findReplyThread`'s `contact_merges.other_reply_token` fallback, and `incrementUnreadForMessage`'s
 * merge-aware bump — against the real 0106 RPCs, on the CI project only (0106 is not on bis-ci yet, so
 * this file is proven by CI `verify`, which builds its own stack from the branch's migrations, never run
 * locally against any Supabase project). The pure half (a fake client, every mutation named in the plan)
 * is `../messaging-merge.test.ts`.
 */
const ACTOR = "user_test";
const TOKEN_A = "bbbbbbbbbbbbbbbbbbbbbbbb";
const TOKEN_B = "cccccccccccccccccccccccc".slice(0, 24);

async function person(
  db: SupabaseClient, accountId: string, p: { first: string; last: string; email?: string; phone: string },
): Promise<string> {
  const { data, error } = await db.from("contacts")
    .insert({ account_id: accountId, first_name: p.first, last_name: p.last, email: p.email ?? null, phone: p.phone, author_kind: "person" })
    .select("id").single();
  if (error) throw new Error(`person insert failed: ${error.message}`);
  return (data as { id: string }).id;
}

async function setReplyToken(db: SupabaseClient, accountId: string, conversationId: string, token: string): Promise<void> {
  const { error } = await db.from("conversations").update({ reply_token: token })
    .eq("account_id", accountId).eq("id", conversationId);
  if (error) throw new Error(`setReplyToken failed: ${error.message}`);
}

async function readUnread(db: SupabaseClient, conversationId: string): Promise<number> {
  const { data, error } = await db.from("conversations").select("unread_count").eq("id", conversationId).single();
  if (error) throw new Error(`readUnread failed: ${error.message}`);
  return (data as { unread_count: number }).unread_count;
}

describe("threads and mail after a merge (CI only: 0106 not on bis-ci; withTestAccount + serviceDb)", () => {
  it("a reply to mail sent before the merge, a text already on the other thread, a sender match on a tombstone's own address, and the unread bump for a message the merge moved all land on the kept record (owner ruling D8)", () =>
    withTestAccount(async (db, accountId) =>
      withTestAccount(async (dbB, accountB) => {
        const k = await person(db, accountId, { first: "Keep", last: "Kept", phone: "+19565550501" });
        const o = await person(db, accountId, { first: "Other", last: "Othersson", email: "old@x.mx", phone: "+19565550502" });

        const kThread = await ensureConversation(db, accountId, k, ACTOR);
        const oThread = await ensureConversation(db, accountId, o, ACTOR);
        await setReplyToken(db, accountId, oThread.id, TOKEN_A);

        const { id: messageId } = await createMessage(db, accountId, {
          conversationId: oThread.id, channel: "sms", direction: "inbound", body: "hola",
        }, ACTOR, "system");

        // A second account's own merge, with its own token, must never answer account A's lookup.
        const bk = await person(dbB, accountB, { first: "BKeep", last: "Bee", phone: "+19565550503" });
        const bo = await person(dbB, accountB, { first: "BOther", last: "Bee", phone: "+19565550504" });
        const bkThread = await ensureConversation(dbB, accountB, bk, ACTOR);
        const boThread = await ensureConversation(dbB, accountB, bo, ACTOR);
        await setReplyToken(dbB, accountB, boThread.id, TOKEN_B);
        const bPreview = await contactMergePreview(dbB, accountB, bk, bo);
        if (bPreview.status !== "ok") throw new Error(`expected ok, got ${bPreview.status}`);
        const bOutcome = await mergeContacts(dbB, accountB, { keepId: bk, otherId: bo, choices: {}, seen: bPreview.seen, actor: ACTOR });
        if (bOutcome.status !== "merged") throw new Error(`expected merged, got ${bOutcome.status}`);

        // Before A's own merge: the live token's own thread answers directly, and B's token is B's own.
        expect(await findReplyThread(db, TOKEN_A)).toMatchObject({ conversationId: oThread.id, contactId: o });
        expect(await findReplyThread(dbB, TOKEN_B)).toMatchObject({ conversationId: bkThread.id, contactId: bk });

        const preview = await contactMergePreview(db, accountId, k, o);
        if (preview.status !== "ok") throw new Error(`expected ok, got ${preview.status}`);
        const outcome = await mergeContacts(db, accountId, { keepId: k, otherId: o, choices: {}, seen: preview.seen, actor: ACTOR });
        if (outcome.status !== "merged") throw new Error(`expected merged, got ${outcome.status}`);

        // A reply to the old mail now lands on the kept record's thread, through contact_merges'
        // own snapshot of the deleted thread's token (correction 7).
        expect(await findReplyThread(db, TOKEN_A)).toMatchObject({ conversationId: kThread.id, accountId, contactId: k, revoked: false });
        // Account B's own merge is untouched by account A's.
        expect(await findReplyThread(dbB, TOKEN_B)).toMatchObject({ conversationId: bkThread.id, contactId: bk });

        // A text addressed to the merged-away record's own id lands on the kept thread, no new one made.
        expect(await ensureConversation(db, accountId, o, ACTOR)).toEqual({ id: kThread.id, created: false });

        // The merged-away record's own address still resolves to the kept contact, by its own name.
        expect(await matchSender(db, accountId, k, "old@x.mx")).toEqual({ contactId: k, firstName: "Keep", lastName: "Kept", viaGroup: false });

        // The message the merge moved bumps the thread it now sits on (plan review m7), not the one its
        // caller resolved before the merge ever happened.
        const before = await readUnread(db, kThread.id);
        await incrementUnreadForMessage(db, accountId, messageId);
        expect(await readUnread(db, kThread.id)).toBe(before + 1);

        // Undo restores O's own thread, its token included.
        const undone = await undoContactMerge(db, accountId, outcome.mergeId, ACTOR);
        expect(undone).toMatchObject({ status: "undone", otherId: o });
        expect(await findReplyThread(db, TOKEN_A)).toMatchObject({ conversationId: oThread.id, contactId: o });
      }),
    ));
});
