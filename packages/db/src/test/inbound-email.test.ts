import { describe, it, expect } from "vitest";
import "dotenv/config";
import { withTestAccount } from "./fixtures";
import { createContact } from "../contacts";
import { createMessage, listMessages, listConversations, ensureConversation } from "../messaging";
import { createAccount } from "../accounts";
import { deleteAccountCascade } from "../account-teardown";
import {
  BIS_REPLY_DOMAIN, REPLY_TOKEN_PATTERN, newReplyToken, getInboundSettings, setInboundSettings,
  ensureReplyToken, readReplyToken, findReplyThread, recordInboundEmail, getInboundEmail, setInboundMessage,
  decideInboundEmail, unfileInboundEmail, listHeldInboundEmails, countHeldInboundEmails, matchSender,
  findInboundEmailByProviderId, deleteInboundMessageByProviderId,
  type NewInboundEmail,
} from "../inbound-email";

const ACTOR = "user_test";
const RUN = Math.random().toString(36).slice(2, 10);
const AUTH = { spf: "pass", dkim: "pass", dmarc: "pass", spam: "PASS", virus: "PASS" };
const row = (accountId: string, conversationId: string, over: Partial<NewInboundEmail> = {}): NewInboundEmail => ({
  accountId, conversationId, providerEmailId: `re_${RUN}_${Math.random().toString(36).slice(2, 8)}`,
  fromEmail: "ana@example.com", fromName: "Ana", toEmail: `r-x@${BIS_REPLY_DOMAIN}`, subject: "Re: Hi",
  text: "Sounds good", auth: AUTH, attachmentCount: 0, status: "held", holdReason: "not_on_record", decidedBy: null,
  receivedAt: new Date().toISOString(), ...over,
});

describe("reply tokens", () => {
  it("newReplyToken is 24 lowercase hex characters, a different one each call (mutation: return a constant → FAILS)", () => {
    const a = newReplyToken(); const b = newReplyToken();
    expect(a).toMatch(REPLY_TOKEN_PATTERN); expect(b).toMatch(REPLY_TOKEN_PATTERN); expect(a).not.toBe(b);
  });

  it("ensureReplyToken makes the conversation and its token once, then answers the same token (mutation: overwrite the token on every call → the second answer differs, FAILS)", async () => {
    await withTestAccount(async (db, accountId) => {
      const { id: contactId } = await createContact(db, accountId, { firstName: "Ana", email: "ana@example.com" }, ACTOR);
      let n = 0;
      const make = () => `${String(++n).padStart(2, "0")}${"a".repeat(22)}`;
      const first = await ensureReplyToken(db, accountId, contactId, ACTOR, make);
      const second = await ensureReplyToken(db, accountId, contactId, ACTOR, make);
      expect(first).toEqual(second);
      expect(first.token).toBe(`01${"a".repeat(22)}`);
      expect(await findReplyThread(db, first.token)).toEqual({ conversationId: first.conversationId, accountId, contactId, revoked: false, inboundDomain: null });
      expect(await findReplyThread(db, "f".repeat(24))).toBeNull();
      expect(await findReplyThread(db, "not-a-token")).toBeNull();
    });
  });

  it("twelve concurrent callers on a fresh contact end with exactly one token, one conversation, one conversation.created event (mutation: drop the .is('reply_token', null) race guard → more than one distinct token, FAILS)", async () => {
    await withTestAccount(async (db, accountId) => {
      const { id: contactId } = await createContact(db, accountId, { firstName: "Concurrent", email: "concurrent@example.com" }, ACTOR);
      const results = await Promise.all(
        Array.from({ length: 12 }, (_, i) =>
          ensureReplyToken(db, accountId, contactId, ACTOR, () => `${String(i).padStart(2, "0")}${"c".repeat(22)}`)),
      );
      const distinctTokens = new Set(results.map((r) => r.token));
      const distinctConversations = new Set(results.map((r) => r.conversationId));
      expect(distinctTokens.size).toBe(1);
      expect(distinctConversations.size).toBe(1);
      const { data } = await db.from("events").select("id")
        .eq("account_id", accountId).eq("type", "conversation.created");
      expect(data).toHaveLength(1);
    });
  });

  it("a revoked token reads as revoked (mutation: drop the revoked mapping → revoked false, FAILS)", async () => {
    await withTestAccount(async (db, accountId) => {
      const { id: contactId } = await createContact(db, accountId, { firstName: "Ana", email: "ana2@example.com" }, ACTOR);
      const t = await ensureReplyToken(db, accountId, contactId, ACTOR);
      await db.from("conversations").update({ reply_token_revoked_at: new Date().toISOString() }).eq("id", t.conversationId);
      expect((await findReplyThread(db, t.token))?.revoked).toBe(true);
    });
  });

  it("a revoked token is ROTATED, never handed out again: ensureReplyToken writes a fresh token and clears revoked_at (mutation: hand back the revoked token unchanged → the old token still matches, FAILS)", async () => {
    await withTestAccount(async (db, accountId) => {
      const { id: contactId } = await createContact(db, accountId, { firstName: "Rot", email: "rot@example.com" }, ACTOR);
      const first = await ensureReplyToken(db, accountId, contactId, ACTOR);
      await db.from("conversations").update({ reply_token_revoked_at: new Date().toISOString() }).eq("id", first.conversationId);
      expect((await findReplyThread(db, first.token))?.revoked).toBe(true);

      const second = await ensureReplyToken(db, accountId, contactId, ACTOR);
      expect(second.conversationId).toBe(first.conversationId);
      expect(second.token).not.toBe(first.token);
      // The old (revoked) token no longer resolves to the thread at all — new mail must never
      // advertise a dead reply address.
      expect(await findReplyThread(db, first.token)).toBeNull();
      const thread = await findReplyThread(db, second.token);
      expect(thread?.revoked).toBe(false);
      expect(thread?.conversationId).toBe(first.conversationId);

      // Calling again answers the SAME (now live) token, not a third rotation.
      const third = await ensureReplyToken(db, accountId, contactId, ACTOR);
      expect(third.token).toBe(second.token);
    });
  });

  it("twelve concurrent callers rotating the SAME revoked token end with exactly one new token, matching the stored row, every attempt (mutation: drop the rotation's .eq('reply_token', existing.token) compare-and-set → more than one distinct token on at least one of five attempts, FAILS; the race is probabilistic — a single attempt can converge by luck even mutated, which is why this repeats the race five times on five fresh contacts rather than once)", async () => {
    await withTestAccount(async (db, accountId) => {
      for (let attempt = 0; attempt < 5; attempt++) {
        const { id: contactId } = await createContact(db, accountId, { firstName: `ConcurrentRot${attempt}`, email: `concurrent-rot-${attempt}@example.com` }, ACTOR);
        const first = await ensureReplyToken(db, accountId, contactId, ACTOR);
        await db.from("conversations").update({ reply_token_revoked_at: new Date().toISOString() }).eq("id", first.conversationId);

        const results = await Promise.all(
          Array.from({ length: 12 }, (_, i) =>
            ensureReplyToken(db, accountId, contactId, ACTOR, () => `${String(i).padStart(2, "0")}${attempt}${"d".repeat(21)}`)),
        );
        const distinctTokens = new Set(results.map((r) => r.token));
        expect(distinctTokens.size).toBe(1);
        const won = [...distinctTokens][0]!;
        expect(won).not.toBe(first.token);

        const { data } = await db.from("conversations").select("reply_token, reply_token_revoked_at")
          .eq("id", first.conversationId).single();
        expect(data!.reply_token).toBe(won);
        expect(data!.reply_token_revoked_at).toBeNull();
        expect(await findReplyThread(db, first.token)).toBeNull();
      }
    });
  });
});

describe("the account's Replies mode", () => {
  it("reads off by default; writes bis and own_domain, emits the event (mutation: drop the emit → no event row, FAILS)", async () => {
    await withTestAccount(async (db, accountId) => {
      expect(await getInboundSettings(db, accountId)).toEqual({ mode: "off", domain: null });
      await setInboundSettings(db, accountId, { mode: "own_domain", domain: `reply.${RUN}.example.com` }, ACTOR);
      expect(await getInboundSettings(db, accountId)).toEqual({ mode: "own_domain", domain: `reply.${RUN}.example.com` });
      const { data } = await db.from("events").select("type, payload").eq("account_id", accountId).eq("type", "account.inbound_replies_updated");
      expect(data).toEqual([{ type: "account.inbound_replies_updated", payload: { mode: "own_domain", domain: `reply.${RUN}.example.com` } }]);
      await setInboundSettings(db, accountId, { mode: "off", domain: `reply.${RUN}.example.com` }, ACTOR);
      expect((await getInboundSettings(db, accountId)).mode).toBe("off");
    });
  });

  it("throws on an account that does not exist (mutation: drop the no-row check → resolves, FAILS)", async () => {
    await withTestAccount(async (db) => {
      await expect(setInboundSettings(db, "00000000-0000-4000-8000-000000000000", { mode: "bis", domain: null }, ACTOR)).rejects.toThrow(/no account/);
    });
  });
});

describe("inbound rows", () => {
  it("records once per Resend id: a second record answers the first row, created false (mutation: rethrow 23505 → FAILS)", async () => {
    await withTestAccount(async (db, accountId) => {
      const { id: contactId } = await createContact(db, accountId, { firstName: "Ana", email: "ana3@example.com" }, ACTOR);
      const t = await ensureReplyToken(db, accountId, contactId, ACTOR);
      const r = row(accountId, t.conversationId, { attachmentCount: 3 });
      const a = await recordInboundEmail(db, r);
      expect(a.row.attachmentCount).toBe(3);   // owner ruling 2026-10-16 (mutation: drop attachment_count from the insert → 0, FAILS)
      const b = await recordInboundEmail(db, { ...r, text: "a different body" });
      expect(a.created).toBe(true); expect(b.created).toBe(false);
      expect(b.row.id).toBe(a.row.id); expect(b.row.text).toBe("Sounds good");
      expect(await getInboundEmail(db, accountId, a.row.id)).toEqual(a.row);
    });
  });

  it("decides with a compare-and-set on the status; sets the message only once; File→Unfile on an otherwise-empty thread un-lists it and resets its last_message_at (mutation: drop .eq('status', from) → the second decide answers true, FAILS; mutation: unfileInboundEmail skips its last_message_at reset → the empty thread stays listed with a stale last_message_at, FAILS)", async () => {
    await withTestAccount(async (db, accountId) => {
      const { id: contactId } = await createContact(db, accountId, { firstName: "Ana", email: "ana4@example.com" }, ACTOR);
      const t = await ensureReplyToken(db, accountId, contactId, ACTOR);
      const { row: held } = await recordInboundEmail(db, row(accountId, t.conversationId));
      expect(await decideInboundEmail(db, accountId, held.id, "held", { status: "dismissed", decidedBy: ACTOR })).toBe(true);
      expect(await decideInboundEmail(db, accountId, held.id, "held", { status: "dismissed", decidedBy: ACTOR })).toBe(false);
      expect((await getInboundEmail(db, accountId, held.id))?.status).toBe("dismissed");
      expect(await decideInboundEmail(db, accountId, held.id, "dismissed", { status: "held", decidedBy: null })).toBe(true);
      const { id: msg } = await createMessage(db, accountId, { conversationId: t.conversationId, channel: "email", direction: "inbound", body: "x" }, ACTOR);
      expect(await decideInboundEmail(db, accountId, held.id, "held", { status: "filed", messageId: msg, decidedBy: ACTOR })).toBe(true);
      expect(await unfileInboundEmail(db, accountId, held.id, msg)).toBe(true);
      expect((await getInboundEmail(db, accountId, held.id))?.status).toBe("held");
      expect(await listMessages(db, accountId, t.conversationId)).toEqual([]);
      // Fix round 3: File→Unfile deletes the thread's only message. The owner's rule is "list a
      // conversation that holds at least one message," and this thread, right now, holds none — it
      // must not appear in the inbox, and its own last_message_at (a stale pointer at the now-deleted
      // message's time) must be reset, not left dangling.
      expect((await listConversations(db, accountId)).map((c) => c.id)).not.toContain(t.conversationId);
      const { data: resetConv } = await db.from("conversations").select("last_message_at").eq("id", t.conversationId).single();
      expect((resetConv as { last_message_at: string | null }).last_message_at).toBeNull();
      const { row: filed } = await recordInboundEmail(db, row(accountId, t.conversationId, { status: "filed", holdReason: null, decidedBy: "email-inbound" }));
      const { id: msg2 } = await createMessage(db, accountId, { conversationId: t.conversationId, channel: "email", direction: "inbound", body: "y" }, ACTOR);
      expect(await setInboundMessage(db, accountId, filed.id, msg2)).toBe(true);
      expect(await setInboundMessage(db, accountId, filed.id, msg2)).toBe(false);
    });
  });

  it("lists and counts only held rows, newest first, with the thread's customer (mutation: drop .eq('status','held') → the dismissed row is listed and counted, FAILS)", async () => {
    await withTestAccount(async (db, accountId) => {
      const { id: contactId } = await createContact(db, accountId, { firstName: "Ana", lastName: "Ruiz", email: "ana5@example.com" }, ACTOR);
      const t = await ensureReplyToken(db, accountId, contactId, ACTOR);
      const older = await recordInboundEmail(db, row(accountId, t.conversationId, { receivedAt: "2026-10-15T10:00:00.000Z" }));
      const newer = await recordInboundEmail(db, row(accountId, t.conversationId, { receivedAt: "2026-10-16T10:00:00.000Z" }));
      const gone = await recordInboundEmail(db, row(accountId, t.conversationId));
      await decideInboundEmail(db, accountId, gone.row.id, "held", { status: "dismissed", decidedBy: ACTOR });
      const list = await listHeldInboundEmails(db, accountId);
      expect(list.map((r) => r.id)).toEqual([newer.row.id, older.row.id]);
      expect(list[0]).toMatchObject({ contactId, contactFirstName: "Ana", contactLastName: "Ruiz" });
      expect(await countHeldInboundEmails(db, accountId)).toBe(2);
    });
  });
});

describe("decided_at is keyed on decidedBy !== null, not on truthiness", () => {
  it("recordInboundEmail: an empty-string decidedBy (falsy, but not null) still gets a decided_at, honoring inbound_emails_decided_coherent (mutation: `row.decidedBy ? ... : null` → decided_at null while decided_by is '' → the CHECK constraint rejects the insert, FAILS)", async () => {
    await withTestAccount(async (db, accountId) => {
      const { id: contactId } = await createContact(db, accountId, { firstName: "Empty", email: "empty@example.com" }, ACTOR);
      const t = await ensureReplyToken(db, accountId, contactId, ACTOR);
      const { row: stored } = await recordInboundEmail(db, row(accountId, t.conversationId, { decidedBy: "", status: "filed", holdReason: null }));
      expect(stored.decidedBy).toBe("");
      expect(stored.decidedAt).not.toBeNull();
    });
  });

  it("decideInboundEmail: an empty-string decidedBy still gets a decided_at (mutation: `to.decidedBy ? ... : null` → decided_at null while decided_by is '', FAILS)", async () => {
    await withTestAccount(async (db, accountId) => {
      const { id: contactId } = await createContact(db, accountId, { firstName: "Empty2", email: "empty2@example.com" }, ACTOR);
      const t = await ensureReplyToken(db, accountId, contactId, ACTOR);
      const { row: held } = await recordInboundEmail(db, row(accountId, t.conversationId));
      await decideInboundEmail(db, accountId, held.id, "held", { status: "dismissed", decidedBy: "" });
      const after = await getInboundEmail(db, accountId, held.id);
      expect(after?.decidedBy).toBe("");
      expect(after?.decidedAt).not.toBeNull();
    });
  });
});

describe("recordInboundEmail's duplicate re-read is account-scoped", () => {
  it("a second record of the same provider id answers the stored row only when it is THIS account's row (mutation: drop the account scope from the re-read → account B is handed account A's row, FAILS)", async () => {
    await withTestAccount(async (dbA, accountA) => {
      await withTestAccount(async (dbB, accountB) => {
        const providerEmailId = `re_${RUN}_${Math.random().toString(36).slice(2, 8)}`;
        const { id: contactA } = await createContact(dbA, accountA, { firstName: "A", email: "a@example.com" }, ACTOR);
        const tA = await ensureReplyToken(dbA, accountA, contactA, ACTOR);
        const a = await recordInboundEmail(dbA, row(accountA, tA.conversationId, { providerEmailId }));
        expect(a.created).toBe(true);

        const { id: contactB } = await createContact(dbB, accountB, { firstName: "B", email: "b@example.com" }, ACTOR);
        const tB = await ensureReplyToken(dbB, accountB, contactB, ACTOR);
        // The INSERT for account B with the SAME provider_email_id (globally unique) hits 23505 against
        // account A's row — account B must never be handed account A's row as its own "duplicate".
        await expect(recordInboundEmail(dbB, row(accountB, tB.conversationId, { providerEmailId })))
          .rejects.toThrow(/recordInboundEmail/);
      });
    });
  });

  it("a genuine retry within the SAME account still answers the stored row, created false", async () => {
    await withTestAccount(async (db, accountId) => {
      const { id: contactId } = await createContact(db, accountId, { firstName: "Retry", email: "retry@example.com" }, ACTOR);
      const t = await ensureReplyToken(db, accountId, contactId, ACTOR);
      const r = row(accountId, t.conversationId);
      const first = await recordInboundEmail(db, r);
      const second = await recordInboundEmail(db, { ...r, text: "different body" });
      expect(second.created).toBe(false);
      expect(second.row.id).toBe(first.row.id);
      expect(second.row.text).toBe(first.row.text);
    });
  });
});

describe("findInboundEmailByProviderId", () => {
  it("absent answers null; present answers the row with its own accountId — account-agnostic by design, SERVICE CLIENT ONLY: the caller compares row.accountId itself (mutation: swap .maybeSingle() for .single() → an absent id throws instead of answering null, FAILS)", async () => {
    await withTestAccount(async (db, accountId) => {
      const providerEmailId = `re_${RUN}_${Math.random().toString(36).slice(2, 8)}`;
      expect(await findInboundEmailByProviderId(db, providerEmailId)).toBeNull();

      const { id: contactId } = await createContact(db, accountId, { firstName: "Finder", email: "finder@example.com" }, ACTOR);
      const t = await ensureReplyToken(db, accountId, contactId, ACTOR);
      const { row: stored } = await recordInboundEmail(db, row(accountId, t.conversationId, { providerEmailId }));

      const found = await findInboundEmailByProviderId(db, providerEmailId);
      expect(found).toEqual(stored);
      expect(found!.accountId).toBe(accountId);

      expect(await findInboundEmailByProviderId(db, `re_${RUN}_${Math.random().toString(36).slice(2, 8)}`)).toBeNull();
    });
  });
});

describe("recordInboundEmail's text truncation", () => {
  it("truncates by code point, never splitting a surrogate pair: a body with an astral emoji just past the limit records successfully with exactly 100000 code points stored (mutation: slice by UTF-16 code unit → lone surrogate → PostgREST rejects the row, FAILS)", async () => {
    await withTestAccount(async (db, accountId) => {
      const { id: contactId } = await createContact(db, accountId, { firstName: "Astral", email: "astral@example.com" }, ACTOR);
      const t = await ensureReplyToken(db, accountId, contactId, ACTOR);
      const text = "a".repeat(99999) + "\u{1F600}" + "tail";
      const { row: stored } = await recordInboundEmail(db, row(accountId, t.conversationId, { text }));
      expect(Array.from(stored.text)).toHaveLength(100000);
      expect(stored.text).toBe("a".repeat(99999) + "\u{1F600}");
    });
  });
});

describe("matchSender", () => {
  it("matches the thread's contact, then a member of their household or business, by email_key; never a stranger, a non-member, a member of a DIFFERENT household, a removed member, or a same-email contact in ANOTHER account (mutation: drop the group branch → Luis is null, FAILS; match every contact in the account → Pat matches, FAILS)", async () => {
    await withTestAccount(async (db, accountId) => {
      const ana = (await createContact(db, accountId, { firstName: "Ana", email: "Ana.Ruiz+shop@Example.com" }, ACTOR)).id;
      const luis = (await createContact(db, accountId, { firstName: "Luis", lastName: "Ruiz", email: "luis@example.com" }, ACTOR)).id;
      const pat = (await createContact(db, accountId, { firstName: "Pat", email: "pat@example.com" }, ACTOR)).id;
      const gone = (await createContact(db, accountId, { firstName: "Gone", email: "gone@example.com" }, ACTOR)).id;

      const g = await db.from("client_groups").insert({ account_id: accountId, kind: "household", name: "Casa Ruiz" }).select("id").single();
      expect(g.error).toBeNull();
      // PostgREST's bulk insert fills a key missing from one object in the batch with NULL, not the
      // column default, when another object in the same batch sets it — is_primary must be explicit
      // on both rows, or Luis's row violates client_group_members' NOT NULL (found running this test).
      const mem = await db.from("client_group_members").insert([
        { account_id: accountId, client_group_id: g.data!.id, contact_id: ana, is_primary: true },
        { account_id: accountId, client_group_id: g.data!.id, contact_id: luis, is_primary: false },
        { account_id: accountId, client_group_id: g.data!.id, contact_id: gone, is_primary: false },
      ]).select("id");
      expect(mem.error).toBeNull();

      // Pat's OWN household, which Ana is not in — proves the match is scoped to Ana's groups, not
      // "any group in the account" (the brief's prescribed mutation for this does not fail: it still
      // scopes to client_group_members rows, and a non-member like Pat-outside-any-group has none
      // regardless; a second household that Ana is NOT a member of is what actually exercises the
      // account-wide-match risk).
      const g2 = await db.from("client_groups").insert({ account_id: accountId, kind: "household", name: "Casa Pat" }).select("id").single();
      expect(g2.error).toBeNull();
      const mem2 = await db.from("client_group_members").insert({ account_id: accountId, client_group_id: g2.data!.id, contact_id: pat, is_primary: true }).select("id");
      expect(mem2.error).toBeNull();

      // A removed member: was in Ana's household, then the row was deleted.
      const del = await db.from("client_group_members").delete().eq("account_id", accountId).eq("contact_id", gone);
      expect(del.error).toBeNull();

      expect(await matchSender(db, accountId, ana, "ana.ruiz@example.com")).toEqual({ contactId: ana, firstName: "Ana", lastName: null, viaGroup: false });
      expect(await matchSender(db, accountId, ana, "LUIS@example.com")).toEqual({ contactId: luis, firstName: "Luis", lastName: "Ruiz", viaGroup: true });
      // Pat is in a DIFFERENT household from Ana's — never a match off Ana's thread.
      expect(await matchSender(db, accountId, ana, "pat@example.com")).toBeNull();
      // A removed member reads as gone, not as still-in-the-household.
      expect(await matchSender(db, accountId, ana, "gone@example.com")).toBeNull();
      expect(await matchSender(db, accountId, ana, "stranger@example.com")).toBeNull();

      // A contact with the SAME email, in ANOTHER account entirely (even the SAME address Luis uses),
      // is never a cross-account match: the match asked of Ana's thread still resolves to THIS
      // account's Luis, never the other account's same-email contact.
      const otherOrg = `org_test_${Math.random().toString(36).slice(2, 10)}`;
      const other = await createAccount(db, { clerkOrgId: otherOrg, name: "Other Co", actorId: ACTOR });
      try {
        const otherLuis = (await createContact(db, other.id, { firstName: "LuisElsewhere", email: "luis@example.com" }, ACTOR)).id;
        expect(otherLuis).not.toBe(luis);
        expect(await matchSender(db, accountId, ana, "LUIS@example.com")).toEqual({ contactId: luis, firstName: "Luis", lastName: "Ruiz", viaGroup: true });
        expect(await matchSender(db, other.id, ana, "LUIS@example.com")).toBeNull();
      } finally {
        await deleteAccountCascade(db, other.id, "matchSender-test");
      }
    });
  });
});

describe("messages carry meta", () => {
  it("createMessage writes meta when given and listMessages reads it; an omitted meta is {} (mutation: drop meta from MESSAGE_COLS → undefined, FAILS)", async () => {
    await withTestAccount(async (db, accountId) => {
      const { id: contactId } = await createContact(db, accountId, { firstName: "Ana", email: "ana6@example.com" }, ACTOR);
      const t = await ensureReplyToken(db, accountId, contactId, ACTOR);
      await createMessage(db, accountId, { conversationId: t.conversationId, channel: "email", direction: "inbound", body: "a", meta: { attachment_count: 2 } }, ACTOR);
      await createMessage(db, accountId, { conversationId: t.conversationId, channel: "email", direction: "outbound", body: "b" }, ACTOR);
      expect((await listMessages(db, accountId, t.conversationId)).map((x) => x.meta)).toEqual([{ attachment_count: 2 }, {}]);
    });
  });
});

/**
 * NOT RUN in this session (Task 12 fix round 1): this worktree has no Supabase env configured
 * (`serviceDb()` throws "Supabase service env vars missing" from `withTestAccount` itself — every
 * other test in this file is equally unexercised here), so these two were written to the same
 * style as the rest of the file and read for correctness, but never watched red-then-green. Flagged
 * for the orchestrator per the brief's "say if you couldn't" instruction.
 */
describe("Task 12 fix round 1, item 4: decideInboundEmail's own conversation_id move", () => {
  it("'Choose a record' moves the row to Pat's conversation in the SAME compare-and-set that files it; Undo resets PAT's own last_message_at to his newest remaining message, not the original thread's (mutation: drop conversationId from the update entirely → moved?.conversationId reads back as Ana's own thread, not Pat's, FAILS)", async () => {
    await withTestAccount(async (db, accountId) => {
      const { id: ana } = await createContact(db, accountId, { firstName: "Ana", email: "ana7@example.com" }, ACTOR);
      const { id: pat } = await createContact(db, accountId, { firstName: "Pat", email: "pat7@example.com" }, ACTOR);
      const anaThread = await ensureReplyToken(db, accountId, ana, ACTOR);
      const patConvo = await ensureConversation(db, accountId, pat, ACTOR);
      // Pat already has messages on his own thread — the scenario the ruling names ("Choose Pat,
      // who has messages"): his last_message_at must read as his own newest AFTER Undo, never as
      // the held row's own received time and never as stale.
      const { id: patOlder } = await createMessage(db, accountId, { conversationId: patConvo.id, channel: "email", direction: "inbound", body: "older" }, ACTOR);
      await new Promise((r) => setTimeout(r, 10));
      const { id: patNewer } = await createMessage(db, accountId, { conversationId: patConvo.id, channel: "email", direction: "inbound", body: "newer" }, ACTOR);
      void patOlder;

      const { row: held } = await recordInboundEmail(db, row(accountId, anaThread.conversationId));
      expect(await decideInboundEmail(db, accountId, held.id, "held", {
        status: "filed", decidedBy: ACTOR, conversationId: patConvo.id,
      })).toBe(true);
      const moved = await getInboundEmail(db, accountId, held.id);
      expect(moved?.conversationId).toBe(patConvo.id);
      expect(moved?.status).toBe("filed");

      const { id: filedMsg } = await createMessage(db, accountId, { conversationId: patConvo.id, channel: "email", direction: "inbound", body: "the held reply, now filed" }, ACTOR);
      expect(await setInboundMessage(db, accountId, held.id, filedMsg)).toBe(true);

      expect(await unfileInboundEmail(db, accountId, held.id, filedMsg)).toBe(true);
      const { data: patRow } = await db.from("conversations").select("last_message_at").eq("id", patConvo.id).single();
      const { data: newerMsg } = await db.from("messages").select("created_at").eq("id", patNewer).single();
      expect((patRow as { last_message_at: string }).last_message_at).toBe((newerMsg as { created_at: string }).created_at);

      // Ana's OWN thread was never touched by any of this — the move was total, not a copy.
      expect(await listMessages(db, accountId, anaThread.conversationId)).toEqual([]);
    });
  });

  it("decideInboundEmail without conversationId leaves the row's own thread untouched (mutation: always write conversation_id even when not given → FAILS)", async () => {
    await withTestAccount(async (db, accountId) => {
      const { id: contactId } = await createContact(db, accountId, { firstName: "Ana", email: "ana8@example.com" }, ACTOR);
      const t = await ensureReplyToken(db, accountId, contactId, ACTOR);
      const { row: held } = await recordInboundEmail(db, row(accountId, t.conversationId));
      expect(await decideInboundEmail(db, accountId, held.id, "held", { status: "dismissed", decidedBy: ACTOR })).toBe(true);
      expect((await getInboundEmail(db, accountId, held.id))?.conversationId).toBe(t.conversationId);
    });
  });
});

describe("Task 12 fix round 1, item 2: deleteInboundMessageByProviderId", () => {
  it("removes the message for this row's own provider id; answers false (never throws) on a provider id with no message at all (mutation: drop the provider_message_id filter entirely → every message in the account is removed, FAILS — the only part of this function's scoping this single-row test CAN falsify. The account, channel and direction filters are defence in depth this test is honest about NOT proving: `messages_provider_message_id_unique` (0005_messaging.sql) is a GLOBAL unique index with no channel/direction/account component, so no second row — in this account or any other, inbound email or anything else — could ever exist to collide with `held.providerEmailId` in the first place, and no single-account test can manufacture the collision those filters guard against)", async () => {
    await withTestAccount(async (db, accountId) => {
      const { id: contactId } = await createContact(db, accountId, { firstName: "Ana", email: "ana9@example.com" }, ACTOR);
      const t = await ensureReplyToken(db, accountId, contactId, ACTOR);
      const { row: held } = await recordInboundEmail(db, row(accountId, t.conversationId));
      await createMessage(db, accountId, {
        conversationId: t.conversationId, channel: "email", direction: "inbound", body: "x", providerMessageId: held.providerEmailId,
      }, ACTOR);
      expect(await deleteInboundMessageByProviderId(db, accountId, held.providerEmailId)).toBe(true);
      expect(await listMessages(db, accountId, t.conversationId)).toEqual([]);
      expect(await deleteInboundMessageByProviderId(db, accountId, held.providerEmailId)).toBe(false);
      expect(await deleteInboundMessageByProviderId(db, accountId, "re_never_existed")).toBe(false);
    });
  });
});

describe("readReplyToken (S-06 part 2, owner ruling: a page view never writes)", () => {
  it("answers the customer's live token, and null for no conversation, a conversation with no token, and a revoked token — creating nothing (mutation: call ensureReplyToken inside -> a conversation appears, FAILS)", async () => {
    await withTestAccount(async (db, accountId) => {
      const { id: contactId } = await createContact(db, accountId, { firstName: "Read", email: "read@example.com" }, ACTOR);
      expect(await readReplyToken(db, accountId, contactId)).toBeNull();
      const none = await db.from("conversations").select("id").eq("account_id", accountId).eq("contact_id", contactId);
      if (none.error) throw none.error;
      expect(none.data).toEqual([]);
      const { data: ev0, error: e0 } = await db.from("events").select("id").eq("account_id", accountId).eq("type", "conversation.created");
      if (e0) throw e0;
      expect(ev0).toEqual([]);
      await ensureConversation(db, accountId, contactId, ACTOR);
      expect(await readReplyToken(db, accountId, contactId)).toBeNull();
      const t = await ensureReplyToken(db, accountId, contactId, ACTOR);
      expect(await readReplyToken(db, accountId, contactId)).toEqual({ token: t.token });
      const rv = await db.from("conversations").update({ reply_token_revoked_at: new Date().toISOString() }).eq("id", t.conversationId);
      if (rv.error) throw rv.error;
      expect(await readReplyToken(db, accountId, contactId)).toBeNull();
    });
  });

  it("is scoped to the account: another account's id never reads this customer's token (mutation: drop the account_id filter -> FAILS)", async () => {
    await withTestAccount(async (dbB, accountB) => {
      await withTestAccount(async (db, accountA) => {
        const { id: contactId } = await createContact(db, accountA, { firstName: "Scoped", email: "scoped@example.com" }, ACTOR);
        await ensureReplyToken(db, accountA, contactId, ACTOR);
        expect(await readReplyToken(dbB, accountB, contactId)).toBeNull();
      });
    });
  });
});

describe("ensureReplyToken's actor type (S-06 part 2 fix round 2, Minor 4)", () => {
  const created = async (db: Parameters<Parameters<typeof withTestAccount>[0]>[0], accountId: string) => {
    const { data, error } = await db.from("events").select("actor_type, actor_id")
      .eq("account_id", accountId).eq("type", "conversation.created");
    if (error) throw error;
    return data;
  };

  it("defaults to system: the email gate's call is unchanged (mutation: default to user -> FAILS)", async () => {
    await withTestAccount(async (db, accountId) => {
      const { id: contactId } = await createContact(db, accountId, { firstName: "Gate", email: "gate@example.com" }, ACTOR);
      await ensureReplyToken(db, accountId, contactId, "email-gate");
      expect(await created(db, accountId)).toEqual([{ actor_type: "system", actor_id: "email-gate" }]);
    });
  });

  it("a person's click records the conversation as theirs, actor type user (mutation: drop the actorType pass-through -> system, FAILS)", async () => {
    await withTestAccount(async (db, accountId) => {
      const { id: contactId } = await createContact(db, accountId, { firstName: "Click", email: "click@example.com" }, ACTOR);
      await ensureReplyToken(db, accountId, contactId, "user_clicker", undefined, "user");
      expect(await created(db, accountId)).toEqual([{ actor_type: "user", actor_id: "user_clicker" }]);
    });
  });
});
