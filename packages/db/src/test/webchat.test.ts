import { describe, it, expect } from "vitest";
import "dotenv/config";
import type { SupabaseClient } from "@supabase/supabase-js";
import { withTestAccount } from "./fixtures";
import { createContact } from "../contacts";
import { createForm, createSubmission, linkSubmissionContact } from "../forms";
import {
  createConciergeConversation, appendConciergeTurns, setConciergeSubmission, getConciergeConversation, type ConciergeTurn,
} from "../concierge";
import { ensureConversation, listMessages, fileWebchatTurns, hasRecentOutboundSms, updateMessageStatusByProviderId } from "../messaging";
import { callerInTouchSince } from "../voice";
import { latestInboundByContact } from "../automations";
import { resolveWebchatThread, listWebchatKeys, syncWebchatTurns } from "../webchat";
import { planWebchatRows, webchatKey } from "../webchat-plan";

/**
 * S-06 part 3 (spec §1-§4, "Every reader of messages", "Failure behaviour"; plan G27-G29), on the
 * replica behind PostgREST. Chat ids are real uuids from concierge_conversations, so every
 * `webchat:<chat>:<i>` key is unique project-wide (0005's index is not account-scoped).
 */
const ACTOR = "user_test";
const PAST = (s: number) => new Date(Date.parse("2026-10-01T15:00:00Z") + s * 1000).toISOString();
const SOON = (s: number) => new Date(Date.now() + 3_600_000 + s * 1000).toISOString();
const turns = (n: number, at: (i: number) => string): ConciergeTurn[] =>
  Array.from({ length: n }, (_, i) => ({ role: i % 2 === 0 ? "visitor" : "assistant", text: `turn ${i}`, at: at(i) }));
const ms = (iso: string) => Date.parse(iso);
type ChatMeta = { webchat: { index: number; matched_existing: boolean } };

/** A lead chat as fileLead and enrich leave it: the submission linked to the customer, the chat's one
 *  slot claimed, the customer's thread open. `existing`: the customer was on file BEFORE the lead. */
async function seedLead(db: SupabaseClient, accountId: string, opts: { existing: boolean; turns: ConciergeTurn[] }) {
  const form = await createForm(db, accountId, { name: "Website chat" }, ACTOR);
  const earlier = opts.existing ? (await createContact(db, accountId, { firstName: "Ana" }, ACTOR)).id : null;
  const chat = await createConciergeConversation(db, { accountId, formId: form.id, ipHash: "h", locale: "es", attribution: {}, origin: null });
  if (opts.turns.length > 0) await appendConciergeTurns(db, chat.id, opts.turns);
  const sub = await createSubmission(db, accountId, form.id, { answers: [], authorKind: "ai" });
  const contactId = earlier ?? (await createContact(db, accountId, { firstName: "Ana" }, ACTOR)).id;
  await linkSubmissionContact(db, accountId, sub.id, contactId);
  expect(await setConciergeSubmission(db, chat.id, sub.id)).toBe(true);
  const { id: conversationId } = await ensureConversation(db, accountId, contactId, ACTOR, "system");
  return { chatId: chat.id, formId: form.id, submissionId: sub.id, contactId, conversationId };
}
const chatRows = async (db: SupabaseClient, accountId: string, conversationId: string) =>
  (await listMessages(db, accountId, conversationId)).filter((x) => x.channel === "webchat");
const convo = async (db: SupabaseClient, id: string) => {
  const { data, error } = await db.from("conversations").select("unread_count, last_message_at").eq("id", id).single();
  expect(error).toBeNull();
  return data as { unread_count: number; last_message_at: string | null };
};
const filedEvents = async (db: SupabaseClient, accountId: string) => {
  const { data, error } = await db.from("events").select("payload, actor_type, actor_id").eq("account_id", accountId).eq("type", "webchat.filed");
  expect(error).toBeNull();
  return data ?? [];
};
const parkThread = async (db: SupabaseClient, id: string) => {
  const { error } = await db.from("conversations").update({ last_message_at: PAST(0), unread_count: 0 }).eq("id", id);
  expect(error).toBeNull();
};
const planFor = async (db: SupabaseClient, accountId: string, s: { chatId: string; conversationId: string; submissionId: string }) => {
  const chat = await getConciergeConversation(db, s.chatId);
  return planWebchatRows({ chatId: s.chatId, transcript: chat!.transcript, existing: await listWebchatKeys(db, accountId, s.conversationId, s.chatId),
    locale: "es", submissionId: s.submissionId, matchedExisting: false, leadAt: PAST(0), now: PAST(0) });
};

describe("syncWebchatTurns: the lead's chat, once (spec §2, §3)", () => {
  it("files every turn as web chat: the visitor's inbound with the customer mark, Sofía's outbound with the AI mark, delivered, keyed, in the chat's language, times kept and strictly increasing; one event; a second sync writes nothing (mutations: Sofía's actor 'system' → author 'automation', FAILS; drop the 23505 skip → the direct re-file stops at 0, FAILS; emit per row → 4 events, FAILS; emit with nothing new → 2 events, FAILS)", async () => {
    await withTestAccount(async (db, accountId) => {
      const s = await seedLead(db, accountId, { existing: false, turns: turns(4, (i) => PAST(i < 2 ? 0 : 10)) });
      const r = await syncWebchatTurns(db, accountId, s.chatId);
      expect(r).toEqual({ outcome: "filed", result: { inserted: 4, visitorInserted: 2, unreadRaised: 0, stoppedAt: null, failedSteps: [] } });
      const rows = await chatRows(db, accountId, s.conversationId);
      expect(rows.map((x) => [x.direction, x.author_kind, x.author_id, x.status, x.provider_message_id, x.body, x.subject])).toEqual([
        ["inbound", "customer", null, "delivered", webchatKey(s.chatId, 0), "turn 0", null],
        ["outbound", "ai", null, "delivered", webchatKey(s.chatId, 1), "turn 1", null],
        ["inbound", "customer", null, "delivered", webchatKey(s.chatId, 2), "turn 2", null],
        ["outbound", "ai", null, "delivered", webchatKey(s.chatId, 3), "turn 3", null],
      ]);
      expect(rows.map((x) => (x.meta as { webchat: unknown }).webchat)).toEqual([0, 1, 2, 3].map((index) => ({
        chat_id: s.chatId, index, locale: "es", submission_id: s.submissionId, matched_existing: false })));
      expect(rows.map((x) => ms(x.created_at))).toEqual([ms(PAST(0)), ms(PAST(0)) + 1, ms(PAST(10)), ms(PAST(10)) + 1]);
      expect((await listWebchatKeys(db, accountId, s.conversationId, s.chatId)).map((k) => k.index).sort()).toEqual([0, 1, 2, 3]);
      expect(await filedEvents(db, accountId)).toEqual([
        { payload: { conversationId: s.conversationId, chatId: s.chatId, count: 4 }, actor_type: "system", actor_id: "concierge" },
      ]);
      expect(await syncWebchatTurns(db, accountId, s.chatId)).toEqual({ outcome: "nothing_new" });
      // The race a second tab's sync loses: the same rows go straight to the writer again.
      const again = planWebchatRows({ chatId: s.chatId, transcript: turns(4, (i) => PAST(i < 2 ? 0 : 10)), existing: [], locale: "es",
        submissionId: s.submissionId, matchedExisting: false, leadAt: PAST(0), now: PAST(0) });
      expect(await fileWebchatTurns(db, accountId, s.conversationId, again))
        .toEqual({ inserted: 0, visitorInserted: 0, unreadRaised: 0, stoppedAt: null, failedSteps: [] });
      expect(await chatRows(db, accountId, s.conversationId)).toHaveLength(4);
      expect(await filedEvents(db, accountId)).toHaveLength(1);
    });
  });

  it("a later turn copies only its pair: the visitor's row raises unread by one and moves the thread up; a batch holding only Sofía's row does neither (spec §4; mutations: raise unread for an inserted Sofía row → FAILS; touch for any row → last_message_at moves, FAILS)", async () => {
    await withTestAccount(async (db, accountId) => {
      const s = await seedLead(db, accountId, { existing: false, turns: turns(2, () => PAST(0)) });
      expect((await syncWebchatTurns(db, accountId, s.chatId)).outcome).toBe("filed");
      expect((await convo(db, s.conversationId)).unread_count).toBe(0);
      await parkThread(db, s.conversationId);
      await appendConciergeTurns(db, s.chatId, [{ role: "visitor", text: "¿Y los sábados?", at: SOON(0) }, { role: "assistant", text: "Sí", at: SOON(0) }]);
      expect(await syncWebchatTurns(db, accountId, s.chatId))
        .toEqual({ outcome: "filed", result: { inserted: 2, visitorInserted: 1, unreadRaised: 1, stoppedAt: null, failedSteps: [] } });
      const moved = await convo(db, s.conversationId);
      expect(moved.unread_count).toBe(1);
      expect(ms(moved.last_message_at!)).toBeGreaterThan(ms(PAST(0)));
      // The healing batch after one that stopped between the visitor's row and Sofía's: Sofía's row alone.
      await parkThread(db, s.conversationId);
      await appendConciergeTurns(db, s.chatId, [{ role: "visitor", text: "x", at: SOON(5) }, { role: "assistant", text: "y", at: SOON(5) }]);
      const sofiaOnly = (await planFor(db, accountId, s)).filter((x) => x.direction === "outbound");
      expect(sofiaOnly.map((x) => x.index)).toEqual([5]);
      expect((await fileWebchatTurns(db, accountId, s.conversationId, sofiaOnly)).inserted).toBe(1);
      const still = await convo(db, s.conversationId);
      expect(still.unread_count).toBe(0);
      expect(ms(still.last_message_at!)).toBe(ms(PAST(0)));
      // The rule is per row (final review P1): the next sync inserts the healing index 4 (the visitor
      // row the Sofía-only batch left out) and the new index 6. Both are post-lead visitor turns, so each
      // raises unread once in the batch that inserts it; Sofía's index 7 raises nothing.
      await appendConciergeTurns(db, s.chatId, [{ role: "visitor", text: "z", at: SOON(10) }, { role: "assistant", text: "w", at: SOON(10) }]);
      expect(await syncWebchatTurns(db, accountId, s.chatId))
        .toEqual({ outcome: "filed", result: { inserted: 3, visitorInserted: 2, unreadRaised: 2, stoppedAt: null, failedSteps: [] } });
      expect((await convo(db, s.conversationId)).unread_count).toBe(2);
    });
  });

  it("a later turn that heals a failed filing-turn copy raises unread only for the turns after the lead (plan G27; mutation: countsUnread = visitor → unread 2, FAILS)", async () => {
    await withTestAccount(async (db, accountId) => {
      const s = await seedLead(db, accountId, { existing: false, turns: turns(2, () => PAST(0)) });
      await parkThread(db, s.conversationId);
      await appendConciergeTurns(db, s.chatId, [{ role: "visitor", text: "later", at: SOON(0) }, { role: "assistant", text: "ok", at: SOON(0) }]);
      expect(await syncWebchatTurns(db, accountId, s.chatId))
        .toEqual({ outcome: "filed", result: { inserted: 4, visitorInserted: 2, unreadRaised: 1, stoppedAt: null, failedSteps: [] } });
      expect((await convo(db, s.conversationId)).unread_count).toBe(1);
    });
  });

  it("an insert error other than 'already there' stops the batch at that row; order is kept and the next sync files the rest (spec failure table; mutation: continue past the error → row 2 lands before row 1, FAILS)", async () => {
    await withTestAccount(async (db, accountId) => {
      const s = await seedLead(db, accountId, { existing: false, turns: turns(3, (i) => PAST(i)) });
      const broken = (await planFor(db, accountId, s)).map((x) => (x.index === 1 ? { ...x, createdAt: "not a time" } : x));
      const r = await fileWebchatTurns(db, accountId, s.conversationId, broken);
      expect([r.inserted, r.stoppedAt]).toEqual([1, 1]);
      expect((await chatRows(db, accountId, s.conversationId)).map((x) => x.provider_message_id)).toEqual([webchatKey(s.chatId, 0)]);
      expect((await syncWebchatTurns(db, accountId, s.chatId)).outcome).toBe("filed");
      expect((await chatRows(db, accountId, s.conversationId)).map((x) => (x.meta as ChatMeta).webchat.index)).toEqual([0, 1, 2]);
    });
  });
});

describe("unread is per row, never per caller (final review P1)", () => {
  it("two tabs: B's filing-turn sync copies A's post-lead visitor turn too, and that row still raises unread exactly once; A's own sync then finds nothing new (reviewer's reproduction; it failed on the caller-flag code with unread 0. Mutation: gate unread on a caller's flag → unread 0, FAILS)", async () => {
    await withTestAccount(async (db, accountId) => {
      // Four turns before the lead; then tab A's turn lands AFTER it (its pair is appended); then tab B's
      // filing-turn sync runs first and copies all six; then A's own sync.
      const s = await seedLead(db, accountId, { existing: false, turns: turns(4, () => PAST(0)) });
      await appendConciergeTurns(db, s.chatId, [{ role: "visitor", text: "tab A", at: SOON(0) }, { role: "assistant", text: "ok", at: SOON(0) }]);
      expect(await syncWebchatTurns(db, accountId, s.chatId))
        .toEqual({ outcome: "filed", result: { inserted: 6, visitorInserted: 3, unreadRaised: 1, stoppedAt: null, failedSteps: [] } });
      expect(await syncWebchatTurns(db, accountId, s.chatId)).toEqual({ outcome: "nothing_new" });
      expect(await chatRows(db, accountId, s.conversationId)).toHaveLength(6);
      expect((await convo(db, s.conversationId)).unread_count).toBe(1);
    });
  });

  it("healing a chat whose turns all came before the lead raises nothing: every visitor row is pre-lead (mutation: count every inserted visitor row → unread 2, FAILS)", async () => {
    await withTestAccount(async (db, accountId) => {
      const s = await seedLead(db, accountId, { existing: false, turns: turns(4, () => PAST(0)) });
      expect(await syncWebchatTurns(db, accountId, s.chatId))
        .toEqual({ outcome: "filed", result: { inserted: 4, visitorInserted: 2, unreadRaised: 0, stoppedAt: null, failedSteps: [] } });
      expect((await convo(db, s.conversationId)).unread_count).toBe(0);
    });
  });
});

describe("syncWebchatTurns never throws (spec 'Failure behaviour')", () => {
  it("a time the planner cannot read answers failed at the write stage and writes nothing (Task 2 review: planWebchatRows throws on an unparseable `now` under a garbage first `at`; mutation: plan outside the try → the sync THROWS, FAILS)", async () => {
    await withTestAccount(async (db, accountId) => {
      const s = await seedLead(db, accountId, { existing: false, turns: [{ role: "visitor", text: "hola", at: "garbage" }, { role: "assistant", text: "Hola", at: "garbage" }] });
      expect(() => planWebchatRows({ chatId: s.chatId, transcript: [{ role: "visitor", text: "hola", at: "garbage" }], existing: [], locale: "es",
        submissionId: s.submissionId, matchedExisting: false, leadAt: PAST(0), now: "not a time" })).toThrow(RangeError);
      expect(await syncWebchatTurns(db, accountId, s.chatId, { now: new Date("not a time") }))
        .toEqual({ outcome: "failed", stage: "write" });
      expect(await chatRows(db, accountId, s.conversationId)).toHaveLength(0);
      expect(await filedEvents(db, accountId)).toHaveLength(0);
    });
  });
});

describe("the chat's own id, never the caller's spelling of it (Task 3 review, fix round 1)", () => {
  it("a sync asked with another spelling of the same uuid (upper case, no hyphens) copies nothing again and raises nothing again: every key is the stored chat.id (mutation: key on the chatId parameter → the whole chat is re-copied under new keys and unread rises, FAILS)", async () => {
    await withTestAccount(async (db, accountId) => {
      const s = await seedLead(db, accountId, { existing: false, turns: turns(4, (i) => SOON(i)) });
      expect(await syncWebchatTurns(db, accountId, s.chatId))
        .toEqual({ outcome: "filed", result: { inserted: 4, visitorInserted: 2, unreadRaised: 2, stoppedAt: null, failedSteps: [] } });
      for (const spelling of [s.chatId.toUpperCase(), s.chatId.replaceAll("-", "")]) {
        expect(spelling).not.toBe(s.chatId);
        expect(await syncWebchatTurns(db, accountId, spelling)).toEqual({ outcome: "nothing_new" });
      }
      const { count, error } = await db.from("messages").select("id", { count: "exact", head: true })
        .eq("account_id", accountId).eq("channel", "webchat");
      expect(error).toBeNull();
      if (count === null) throw new Error("no count returned");
      expect(count).toBe(4);
      expect((await chatRows(db, accountId, s.conversationId)).map((x) => x.provider_message_id))
        .toEqual([0, 1, 2, 3].map((i) => webchatKey(s.chatId, i)));
      expect((await convo(db, s.conversationId)).unread_count).toBe(2);
      expect(await filedEvents(db, accountId)).toHaveLength(1);
    });
  });
});

describe("a step after the inserts fails: the rows stand (spec failure table; plan G28)", () => {
  it("the event insert fails: failedSteps names it, every row is on the thread, unread is still raised (mutation: drop the emit's try/catch → fileWebchatTurns THROWS, FAILS)", async () => {
    await withTestAccount(async (db, accountId) => {
      const s = await seedLead(db, accountId, { existing: false, turns: turns(2, () => SOON(0)) });
      // The service client with ONE table broken: `events` answers an error, everything else is real.
      const brokenEvents = new Proxy(db, {
        get(target, prop) {
          if (prop === "from") {
            return (table: string) => (table === "events"
              ? { insert: async () => ({ data: null, error: { message: "events unavailable", code: "XX000" } }) }
              : target.from(table));
          }
          const v = Reflect.get(target, prop);
          return typeof v === "function" ? v.bind(target) : v;
        },
      }) as SupabaseClient;
      expect(await fileWebchatTurns(brokenEvents, accountId, s.conversationId, await planFor(db, accountId, s)))
        .toEqual({ inserted: 2, visitorInserted: 1, unreadRaised: 1, stoppedAt: null, failedSteps: ["event"] });
      expect((await chatRows(db, accountId, s.conversationId)).map((x) => x.provider_message_id))
        .toEqual([webchatKey(s.chatId, 0), webchatKey(s.chatId, 1)]);
      expect((await convo(db, s.conversationId)).unread_count).toBe(1);
      expect(await filedEvents(db, accountId)).toHaveLength(0);
    });
  });
});

describe("which thread, through the lead only (spec §1, §5a)", () => {
  it("a customer on file before the lead is marked matched; one the lead created is not (G19; mutation: matched_existing always false → FAILS)", async () => {
    await withTestAccount(async (db, accountId) => {
      const old = await seedLead(db, accountId, { existing: true, turns: turns(2, () => PAST(0)) });
      const fresh = await seedLead(db, accountId, { existing: false, turns: turns(2, () => PAST(0)) });
      expect((await resolveWebchatThread(db, accountId, old.submissionId))?.matchedExisting).toBe(true);
      expect((await resolveWebchatThread(db, accountId, fresh.submissionId))?.matchedExisting).toBe(false);
      await syncWebchatTurns(db, accountId, old.chatId);
      await syncWebchatTurns(db, accountId, fresh.chatId);
      expect((await chatRows(db, accountId, old.conversationId)).map((x) => (x.meta as ChatMeta).webchat.matched_existing)).toEqual([true, true]);
      expect((await chatRows(db, accountId, fresh.conversationId)).map((x) => (x.meta as ChatMeta).webchat.matched_existing)).toEqual([false, false]);
    });
  });

  it("the lead's customer gone, no lead, or another account's chat: nothing is written anywhere and nobody else is looked up (mutations: drop the account check → B's sync answers no_customer instead of no_lead, FAILS: the boundary is guarded twice, resolveWebchatThread's own account filter still stops the copy, so this is never a leak; create a contact when contact_id is null → rows land, FAILS)", async () => {
    await withTestAccount(async (db, accountId) => {
      await withTestAccount(async (_db, other) => {
        const s = await seedLead(db, accountId, { existing: false, turns: turns(2, () => PAST(0)) });
        expect(await syncWebchatTurns(db, other, s.chatId)).toEqual({ outcome: "no_lead" });
        const { error } = await db.from("form_submissions").update({ contact_id: null }).eq("id", s.submissionId);
        expect(error).toBeNull();
        expect(await resolveWebchatThread(db, accountId, s.submissionId)).toBeNull();
        expect(await syncWebchatTurns(db, accountId, s.chatId)).toEqual({ outcome: "no_customer" });
        const bare = await createConciergeConversation(db, { accountId, formId: s.formId, ipHash: "h", locale: "en", attribution: {}, origin: null });
        expect(await syncWebchatTurns(db, accountId, bare.id)).toEqual({ outcome: "no_lead" });
        const { count, error: cErr } = await db.from("messages").select("id", { count: "exact", head: true })
          .in("account_id", [accountId, other]).eq("channel", "webchat");
        expect(cErr).toBeNull();
        if (count === null) throw new Error("no count returned");
        expect(count).toBe(0);
      });
    });
  });
});

describe("nothing reads a chat row as a text or a send (spec readers table; G17, G29)", () => {
  it("the text-back cooldown and its release ignore chat rows, a delivery event can never relabel one, and a visitor turn is hearing back (mutations: drop .eq('channel','sms') from hasRecentOutboundSms → true, FAILS; from callerInTouchSince's texts read → true, FAILS; drop the G29 guard → updated, FAILS)", async () => {
    await withTestAccount(async (db, accountId) => {
      const s = await seedLead(db, accountId, { existing: false, turns: turns(2, () => SOON(0)) });
      await syncWebchatTurns(db, accountId, s.chatId);
      const since = new Date(Date.now() - 3_600_000);
      expect(await hasRecentOutboundSms(db, accountId, s.conversationId, since)).toBe(false);
      expect(await callerInTouchSince(db, accountId, "+19565550100", s.conversationId, since.toISOString())).toBe(false);
      expect(await updateMessageStatusByProviderId(db, webchatKey(s.chatId, 1), "failed")).toEqual({ updated: false, accountId: null, contactId: null });
      expect((await chatRows(db, accountId, s.conversationId)).map((x) => x.status)).toEqual(["delivered", "delivered"]);
      expect((await latestInboundByContact(db, [accountId], [s.contactId], since.toISOString())).has(s.contactId)).toBe(true);
    });
  });
});
