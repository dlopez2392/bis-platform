import { describe, it, expect } from "vitest";
import "dotenv/config";
import { withTestAccount } from "./fixtures";
import { createContact } from "../contacts";
import { createMessage, listMessages } from "../messaging";
import {
  BIS_REPLY_DOMAIN, REPLY_TOKEN_PATTERN, newReplyToken, getInboundSettings, setInboundSettings,
  ensureReplyToken, findReplyThread, recordInboundEmail, getInboundEmail, setInboundMessage,
  decideInboundEmail, unfileInboundEmail, listHeldInboundEmails, countHeldInboundEmails, matchSender,
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

  it("a revoked token reads as revoked (mutation: drop the revoked mapping → revoked false, FAILS)", async () => {
    await withTestAccount(async (db, accountId) => {
      const { id: contactId } = await createContact(db, accountId, { firstName: "Ana", email: "ana2@example.com" }, ACTOR);
      const t = await ensureReplyToken(db, accountId, contactId, ACTOR);
      await db.from("conversations").update({ reply_token_revoked_at: new Date().toISOString() }).eq("id", t.conversationId);
      expect((await findReplyThread(db, t.token))?.revoked).toBe(true);
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

  it("decides with a compare-and-set on the status; sets the message only once (mutation: drop .eq('status', from) → the second decide answers true, FAILS)", async () => {
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

describe("matchSender", () => {
  it("matches the thread's contact, then a member of their household or business, by email_key; never a stranger or a non-member (mutation: drop the group branch → Luis is null, FAILS; match every contact in the account → Pat matches, FAILS)", async () => {
    await withTestAccount(async (db, accountId) => {
      const ana = (await createContact(db, accountId, { firstName: "Ana", email: "Ana.Ruiz+shop@Example.com" }, ACTOR)).id;
      const luis = (await createContact(db, accountId, { firstName: "Luis", lastName: "Ruiz", email: "luis@example.com" }, ACTOR)).id;
      await createContact(db, accountId, { firstName: "Pat", email: "pat@example.com" }, ACTOR);
      const { data: g } = await db.from("client_groups").insert({ account_id: accountId, kind: "household", name: "Casa Ruiz" }).select("id").single();
      // PostgREST's bulk insert fills a key missing from one object in the batch with NULL, not the
      // column default, when another object in the same batch sets it — is_primary must be explicit
      // on both rows, or Luis's row violates client_group_members' NOT NULL (found running this test).
      await db.from("client_group_members").insert([
        { account_id: accountId, client_group_id: g!.id, contact_id: ana, is_primary: true },
        { account_id: accountId, client_group_id: g!.id, contact_id: luis, is_primary: false },
      ]);
      expect(await matchSender(db, accountId, ana, "ana.ruiz@example.com")).toEqual({ contactId: ana, firstName: "Ana", lastName: null, viaGroup: false });
      expect(await matchSender(db, accountId, ana, "LUIS@example.com")).toEqual({ contactId: luis, firstName: "Luis", lastName: "Ruiz", viaGroup: true });
      expect(await matchSender(db, accountId, ana, "pat@example.com")).toBeNull();
      expect(await matchSender(db, accountId, ana, "stranger@example.com")).toBeNull();
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
