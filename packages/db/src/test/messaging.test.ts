import { describe, it, expect } from "vitest";
import { withTestAccount, testProviderMessageId } from "./fixtures";
import { createContact } from "../contacts";
import {
  ensureConversation, createMessage, updateMessageStatus,
  updateMessageStatusByProviderId, findMessageByProviderId, hasRecentOutboundSms,
  listFailedOutboundSms,
  listConversations, listMessages, getConversationSummary,
  incrementUnreadCount, clearUnreadCount, sumUnreadCount, searchConversations,
} from "../messaging";

/**
 * Every `provider_message_id` in this file comes from `testProviderMessageId()`
 * (test/fixtures.ts), never from a literal.
 *
 * `messages_provider_message_id_unique` (`0005_messaging.sql`) is PROJECT-WIDE
 * and partial, not account-scoped, and the migration's own comment says why: a
 * delivery webhook arrives with only a provider id and no tenant context, so
 * the lookup cannot be scoped and neither can the index. That is right and
 * stays. `withTestAccount` therefore gives these values no isolation at all —
 * exactly the position `phone_numbers.e164` was in before PR 59 and blueprint
 * names before PR 58. Two processes running the insert-time test below at once
 * failed one process on
 * `createMessage failed: duplicate key value violates unique constraint
 * "messages_provider_message_id_unique"` in six rounds out of six.
 *
 * Where the value is asserted on or looked up again, draw it ONCE into a const
 * and use that const on both sides. Two separate draws for the write and the
 * read is the way this goes quietly wrong: the inbound-direction test near the
 * bottom of this file expects a MISS, so mismatched ids would let it pass while
 * proving nothing — which is why that test now also asserts the row really
 * carries the id.
 *
 * Bodies, names and conversation ids stay as written literals: those are
 * account-scoped, and `searchConversations` matches on the words in one.
 */
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

      // P6 searchConversations, asserted inside THIS cycle rather than a new
      // withTestAccount of its own — blueprints.test.ts is contention-marginal
      // and extra fixture cycles tip it into a 20s timeout.
      const hits = await searchConversations(db, accountId, { search: "first contact" });
      expect(hits).toHaveLength(1);
      expect(hits[0]!.id).toBe(convo.id);
      expect(hits[0]!.contactFirstName).toBe("Ada");
      // The MATCHED message, which is the whole point in a palette.
      expect(hits[0]!.lastMessagePreview).toContain("First contact");

      expect(await searchConversations(db, accountId, { search: "zzz nothing" })).toEqual([]);
      // A bare wildcard must return NOTHING here, not every conversation: an
      // empty sanitized term means "no searchable query", not "match all".
      expect(await searchConversations(db, accountId, { search: "%" })).toEqual([]);
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

      // Drawn once and compared against itself: the claim is that the patch
      // reaches the column intact, and that is what a round trip proves.
      const providerMessageId = testProviderMessageId();
      await updateMessageStatus(db, accountId, id, "sent", { providerMessageId }, "user_test");
      let [msg] = await listMessages(db, accountId, convo.id);
      expect(msg!.status).toBe("sent");
      expect(msg!.provider_message_id).toBe(providerMessageId);

      await updateMessageStatus(db, accountId, id, "failed", { error: "boom" }, "user_test");
      [msg] = await listMessages(db, accountId, convo.id);
      expect(msg!.status).toBe("failed");
      expect(msg!.error).toBe("boom");

      // The actorType parameter is OPTIONAL and defaults to "user" — pins that
      // adding it did not change what an existing call site (this one, and both
      // of conversations/actions.ts's) writes.
      const { data: ev } = await db.from("events").select("actor_type, actor_id")
        .eq("account_id", accountId).eq("type", "message.status_changed")
        .order("created_at", { ascending: false }).limit(1);
      expect(ev![0]!.actor_type).toBe("user");
      expect(ev![0]!.actor_id).toBe("user_test");
    }));

  it("updateMessageStatus attributes an AI-actor write to the AI, not to a user", () =>
    withTestAccount(async (db, accountId) => {
      // The voice text-back writes these statuses with actor_id "voice". Before
      // the actorType parameter existed it emitted actor_type "user" — the
      // exact mis-attribution M1b fixed for the Resend webhook.
      const { id: contactId } = await createContact(db, accountId, { firstName: "Ada" }, "user_test");
      const convo = await ensureConversation(db, accountId, contactId, "voice", "ai");
      const { id } = await createMessage(db, accountId, {
        conversationId: convo.id, channel: "sms", direction: "outbound", body: "x",
      }, "voice", "ai");

      await updateMessageStatus(db, accountId, id, "sent",
        { providerMessageId: testProviderMessageId() }, "voice", "ai");

      const { data: ev } = await db.from("events").select("actor_type, actor_id")
        .eq("account_id", accountId).eq("type", "message.status_changed")
        .order("created_at", { ascending: false }).limit(1);
      expect(ev![0]!.actor_type).toBe("ai");
      expect(ev![0]!.actor_id).toBe("voice");
    }));

  it("hasRecentOutboundSms holds the text-back cooldown open for a real send but not for a failed one", () =>
    withTestAccount(async (db, accountId) => {
      // One fixture cycle for the whole cooldown contract, deliberately — see
      // the note in the createMessage test above about contention.
      const { id: contactId } = await createContact(db, accountId, { firstName: "Ada" }, "user_test");
      const convo = await ensureConversation(db, accountId, contactId, "voice", "ai");
      const since = () => new Date(Date.now() - 24 * 60 * 60 * 1000);

      // A caller nobody has texted yet.
      expect(await hasRecentOutboundSms(db, accountId, convo.id, since())).toBe(false);

      const { id } = await createMessage(db, accountId, {
        conversationId: convo.id, channel: "sms", direction: "outbound",
        body: "Sorry we missed you just now.",
      }, "voice", "ai");

      // `queued` counts. That is the state a text whose post-send bookkeeping
      // write blew up is left in, and that text DID go out.
      expect(await hasRecentOutboundSms(db, accountId, convo.id, since())).toBe(true);

      await updateMessageStatus(db, accountId, id, "sent",
        { providerMessageId: testProviderMessageId() }, "voice", "ai");
      expect(await hasRecentOutboundSms(db, accountId, convo.id, since())).toBe(true);

      // THE DECIDED DIRECTION: `failed` means the provider refused and nothing
      // was ever delivered. Counting it would silence the feature permanently
      // for this caller on the strength of one outage.
      await updateMessageStatus(db, accountId, id, "failed", { error: "carrier refused" }, "voice", "ai");
      expect(await hasRecentOutboundSms(db, accountId, convo.id, since())).toBe(false);

      // `bounced` is the other side of that line: it left the building.
      await updateMessageStatus(db, accountId, id, "bounced", {}, "voice", "ai");
      expect(await hasRecentOutboundSms(db, accountId, convo.id, since())).toBe(true);

      // The WINDOW is real, not decorative: a `since` after the row was written
      // excludes it.
      expect(await hasRecentOutboundSms(db, accountId, convo.id, new Date(Date.now() + 60_000))).toBe(false);

      // The TENANT boundary. Same conversation id, another account's context:
      // without the account_id filter the conversation filter alone would still
      // match this row.
      expect(await hasRecentOutboundSms(
        db, "00000000-0000-0000-0000-000000000000", convo.id, since())).toBe(false);

      // Channel and direction both filter: the caller texting US back is not a
      // text-back, and neither is an email.
      await createMessage(db, accountId, {
        conversationId: convo.id, channel: "sms", direction: "inbound", body: "who is this",
      }, "sms-inbound", "system");
      await createMessage(db, accountId, {
        conversationId: convo.id, channel: "email", direction: "outbound", body: "following up",
      }, "user_test");
      await updateMessageStatus(db, accountId, id, "failed", { error: "carrier refused" }, "voice", "ai");
      expect(await hasRecentOutboundSms(db, accountId, convo.id, since())).toBe(false);
    }));

  // MEASURED, not guessed: ~10.3s alone on an idle machine (`vitest run
  // messaging.test.ts -t "listFailedOutboundSms ties a failed text-back"`)
  // — the heaviest test in this file; covered by the package's testTimeout.
  it("listFailedOutboundSms ties a failed text-back to the CALL whose window holds it, keeps it after a later text goes out, and refuses to see another tenant's rows", () =>
    withTestAccount(async (db, accountId) => {
      // One fixture cycle for the whole contract, deliberately — same
      // contention note as the tests above.
      const ada = await createContact(db, accountId, { firstName: "Ada" }, "user_test");
      const grace = await createContact(db, accountId, { firstName: "Grace" }, "user_test");
      const a = await ensureConversation(db, accountId, ada.id, "voice", "ai");
      const b = await ensureConversation(db, accountId, grace.id, "voice", "ai");

      // Windows are built from THIS machine's clock while `created_at` comes
      // off the database's, so every bound below is minutes wide rather than
      // seconds. What is under test here is that a window FILTERS, not that two
      // clocks agree to the millisecond — the real bounds are pinned in
      // apps/web's textback-window.test.ts, where the clock is not a variable.
      const t0 = Date.now();
      const MIN = 60_000;
      const iso = (ms: number) => new Date(t0 + ms).toISOString();
      /** The shape of a call that just this moment ended. */
      const justNow = (callId: string, conversationId: string) => ({
        callId, conversationId, fromIso: iso(-10 * MIN), toIso: iso(10 * MIN),
      });

      // An empty window list must short-circuit — the calls list hands one over
      // for every page of calls that never opened a conversation, and a query
      // there would be a round trip that cannot return anything.
      expect(await listFailedOutboundSms(db, accountId, [])).toEqual([]);
      // Conversations with no messages at all.
      expect(await listFailedOutboundSms(
        db, accountId, [justNow("call-a", a.id), justNow("call-b", b.id)])).toEqual([]);

      const body = "Sorry we missed you just now.";
      const { id: failedId } = await createMessage(db, accountId, {
        conversationId: a.id, channel: "sms", direction: "outbound", body,
      }, "voice", "ai");

      // `queued` is not a failure — the text may well have gone out.
      expect(await listFailedOutboundSms(
        db, accountId, [justNow("call-a", a.id), justNow("call-b", b.id)])).toEqual([]);

      await updateMessageStatus(db, accountId, failedId, "failed",
        { error: "carrier refused" }, "voice", "ai");

      const hits = await listFailedOutboundSms(
        db, accountId, [justNow("call-a", a.id), justNow("call-b", b.id)]);
      expect(hits).toHaveLength(1);
      // Keyed on the CALL the window came in for, which is what the badge joins
      // on now — the conversation rides along only as provenance.
      expect(hits[0]!.callId).toBe("call-a");
      expect(hits[0]!.conversationId).toBe(a.id);
      expect(hits[0]!.messageId).toBe(failedId);
      // The body the operator gets to resend WITHOUT retyping it.
      expect(hits[0]!.body).toBe(body);
      // Nothing has gone out since, so the resend control stands.
      expect(hits[0]!.supersededAt).toBeNull();

      // THE FALSE POSITIVE. The same caller rings again hours later and
      // abandons again; the 24h cooldown suppresses that call's text-back, so
      // it never writes a message at all — but `finishCall` still stamps the
      // SAME conversation onto its row, because conversations are
      // one-per-CONTACT. Keyed on the conversation, that later call claimed
      // this failure and said "Text-back didn't send" about a text-back that
      // never existed. Its own window is two hours away from the message.
      const twoHoursLater = {
        callId: "call-a2", conversationId: a.id,
        fromIso: iso(120 * MIN), toIso: iso(130 * MIN),
      };
      expect(await listFailedOutboundSms(db, accountId, [twoHoursLater])).toEqual([]);
      // …and asked about together, only the call whose window holds it answers.
      expect((await listFailedOutboundSms(
        db, accountId, [justNow("call-a", a.id), twoHoursLater])).map((f) => f.callId))
        .toEqual(["call-a"]);

      // A duplicate window for one call must not duplicate the answer.
      expect(await listFailedOutboundSms(
        db, accountId, [justNow("call-a", a.id), justNow("call-a", a.id)])).toHaveLength(1);

      // THE TENANT BOUNDARY. Same conversation id, another account's context:
      // without the account filter the conversation filter alone would match.
      expect(await listFailedOutboundSms(
        db, "00000000-0000-0000-0000-000000000000", [justNow("call-a", a.id)])).toEqual([]);

      // Channel and direction both filter. A failed EMAIL is not a failed
      // text-back, and neither is anything inbound.
      const { id: emailId } = await createMessage(db, accountId, {
        conversationId: b.id, channel: "email", direction: "outbound", body: "hello",
      }, "user_test");
      await updateMessageStatus(db, accountId, emailId, "failed", { error: "bounced" }, "user_test");
      const { id: inboundId } = await createMessage(db, accountId, {
        conversationId: b.id, channel: "sms", direction: "inbound", body: "who is this",
      }, "sms-inbound", "system");
      await updateMessageStatus(db, accountId, inboundId, "failed", { error: "x" }, "system", "system");
      expect((await listFailedOutboundSms(
        db, accountId, [justNow("call-a", a.id), justNow("call-b", b.id)])).map((f) => f.callId))
        .toEqual(["call-a"]);

      // THE FALSE NEGATIVE, and the semantics this replaces. A later outbound
      // text to the same contact goes out fine — the operator's own resend, or
      // an unrelated manual reply. Keyed on "the LATEST outbound SMS is failed",
      // the badge vanished here and nothing else in the product recorded that
      // the text-back had failed. It did fail, that call's caller was never
      // texted, and that stays true.
      const { id: resentId } = await createMessage(db, accountId, {
        conversationId: a.id, channel: "sms", direction: "outbound", body,
      }, "user_test");
      await updateMessageStatus(db, accountId, resentId, "sent",
        { providerMessageId: testProviderMessageId() }, "user_test");
      const kept = await listFailedOutboundSms(db, accountId, [justNow("call-a", a.id)]);
      expect(kept).toHaveLength(1);
      expect(kept[0]!.messageId).toBe(failedId);
      // The ONLY thing that changed: the resend control now knows something has
      // reached this person, so it stands down rather than texting them twice.
      expect(kept[0]!.supersededAt).not.toBeNull();

      // A second failure inside the same window is the one reported, carrying
      // its own body rather than the stale first one — and the successful
      // resend is now older than it, so nothing supersedes it.
      const { id: secondFailure } = await createMessage(db, accountId, {
        conversationId: a.id, channel: "sms", direction: "outbound", body: "Second attempt.",
      }, "user_test");
      await updateMessageStatus(db, accountId, secondFailure, "failed",
        { error: "carrier refused again" }, "user_test");
      const again = await listFailedOutboundSms(db, accountId, [justNow("call-a", a.id)]);
      expect(again).toHaveLength(1);
      expect(again[0]!.messageId).toBe(secondFailure);
      expect(again[0]!.body).toBe("Second attempt.");
      expect(again[0]!.supersededAt).toBeNull();

      // FIX WAVE 2 — ONE MESSAGE BELONGS TO ONE CALL.
      //
      // Grace rings, abandons, and her text-back fails; she redials within five
      // minutes, abandons again, and that one fails too. Two calls, two failed
      // messages — and the FIRST call's window runs five minutes past its own
      // hangup, so it contains BOTH of them, while the second call's window
      // (lower bound `started_at`, after the first message was written) contains
      // only its own.
      //
      // Keyed on the CALL, the claim set could not stop a message being handed
      // out twice: rows are scanned newest-first, so the first call took the
      // SECOND call's message, its own failure never surfaced anywhere, and
      // "Send it now" on that row would have texted a real phone the other
      // call's words. Keyed on the MESSAGE, each failure is consumed once and
      // the latest-starting call whose window holds it gets it — the call whose
      // hangup it was written after.
      const firstCall = await createMessage(db, accountId, {
        conversationId: b.id, channel: "sms", direction: "outbound",
        body: "First call's text-back.",
      }, "voice", "ai");
      await updateMessageStatus(db, accountId, firstCall.id, "failed",
        { error: "carrier refused" }, "voice", "ai");
      const secondCall = await createMessage(db, accountId, {
        conversationId: b.id, channel: "sms", direction: "outbound",
        body: "Second call's text-back.",
      }, "voice", "ai");
      await updateMessageStatus(db, accountId, secondCall.id, "failed",
        { error: "carrier refused" }, "voice", "ai");

      // Bounds read back off the DATABASE's clock, not this machine's — the two
      // windows here have to sit between two rows written seconds apart, which
      // is finer than the skew the minute-wide windows above are shaped around.
      const writtenAt = async (id: string) => {
        const { data, error } = await db.from("messages").select("created_at").eq("id", id).single();
        // Checked, not assumed: unchecked, a failed read here reaches the next
        // line as `Cannot read properties of null` — a message that names
        // neither this query nor the reason, which is precisely how the
        // e164 collision presented before PR 59.
        expect(error, `messages created_at read failed: ${error?.message}`).toBeNull();
        return Date.parse((data as { created_at: string }).created_at);
      };
      const firstAt = await writtenAt(firstCall.id);
      const secondAt = await writtenAt(secondCall.id);
      expect(secondAt).toBeGreaterThan(firstAt);

      const isoAt = (ms: number) => new Date(ms).toISOString();
      const earlierWindow = {
        callId: "call-first", conversationId: b.id,
        fromIso: isoAt(firstAt - MIN), toIso: isoAt(secondAt + MIN),
      };
      const laterWindow = {
        callId: "call-second", conversationId: b.id,
        fromIso: isoAt(secondAt), toIso: isoAt(secondAt + MIN),
      };

      // Handed over EARLIEST-first — deliberately the opposite of the order
      // `listCalls` delivers, because the read sorts them itself rather than
      // trusting a caller to have done it.
      const overlap = await listFailedOutboundSms(db, accountId, [earlierWindow, laterWindow]);
      expect(overlap).toHaveLength(2);
      // No message reported twice. This is the assertion the callId keying
      // failed: it returned the same messageId under both call ids.
      expect(new Set(overlap.map((h) => h.messageId)).size).toBe(2);
      const byCall = new Map(overlap.map((h) => [h.callId, h]));
      expect(byCall.get("call-second")!.messageId).toBe(secondCall.id);
      expect(byCall.get("call-second")!.body).toBe("Second call's text-back.");
      // Each call served its OWN message — and the body matters as much as the
      // id, because it is what "Send it now" would put on a real phone.
      expect(byCall.get("call-first")!.messageId).toBe(firstCall.id);
      expect(byCall.get("call-first")!.body).toBe("First call's text-back.");

      // Same answer newest-first, which is the order the pages actually pass.
      const reversed = await listFailedOutboundSms(db, accountId, [laterWindow, earlierWindow]);
      expect(new Set(reversed.map((h) => h.messageId)).size).toBe(2);
      expect(reversed.find((h) => h.callId === "call-first")!.messageId).toBe(firstCall.id);
      expect(reversed.find((h) => h.callId === "call-second")!.messageId).toBe(secondCall.id);
    }));

  it("updateMessageStatusByProviderId finds the row without tenant context", () =>
    withTestAccount(async (db, accountId) => {
      const { id: contactId } = await createContact(db, accountId, { firstName: "Ada" }, "user_test");
      const convo = await ensureConversation(db, accountId, contactId, "user_test");
      const { id } = await createMessage(db, accountId, {
        conversationId: convo.id, channel: "email", direction: "outbound", body: "x",
      }, "user_test");
      const providerMessageId = testProviderMessageId();
      await updateMessageStatus(db, accountId, id, "sent", { providerMessageId }, "user_test");

      // The lookup under test carries no account at all, so with a fixed
      // literal the row it reaches is only this account's by luck.
      const hit = await updateMessageStatusByProviderId(db, providerMessageId, "delivered");
      expect(hit.updated).toBe(true);

      const [msg] = await listMessages(db, accountId, convo.id);
      expect(msg!.status).toBe("delivered");
    }));

  it("updateMessageStatusByProviderId ignores an unknown id without throwing", () =>
    withTestAccount(async (db) => {
      // Drawn and never written. "Unknown" has to be unknown to the whole
      // PROJECT for this to mean anything, and a literal is only unknown until
      // some other run writes it — this lookup has no account to hide behind.
      const miss = await updateMessageStatusByProviderId(db, testProviderMessageId(), "delivered");
      expect(miss.updated).toBe(false);
    }));

  it("updateMessageStatusByProviderId logs the webhook update as the system actor, not a user", () =>
    withTestAccount(async (db, accountId) => {
      const { id: contactId } = await createContact(db, accountId, { firstName: "Ada" }, "user_test");
      const convo = await ensureConversation(db, accountId, contactId, "user_test");
      const { id } = await createMessage(db, accountId, {
        conversationId: convo.id, channel: "email", direction: "outbound", body: "x",
      }, "user_test");
      const providerMessageId = testProviderMessageId();
      await updateMessageStatus(db, accountId, id, "sent", { providerMessageId }, "user_test");

      await updateMessageStatusByProviderId(db, providerMessageId, "delivered");

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
      const providerMessageId = testProviderMessageId();
      await updateMessageStatus(db, accountId, id, "sent", { providerMessageId }, "user_test");

      await updateMessageStatusByProviderId(db, providerMessageId, "opened");
      // "delivered" is earlier than "opened" on the lifecycle scale — a
      // provider replay or reorder must not revert the row.
      await updateMessageStatusByProviderId(db, providerMessageId, "delivered");

      const [msg] = await listMessages(db, accountId, convo.id);
      expect(msg!.status).toBe("opened");
    }));

  // D-016: the Resend webhook records a spam complaint distinctly from a
  // plain bounce by writing a marker into `error` alongside the "bounced"
  // status (no new status value exists without a migration — see
  // apps/web's lib/email/failure-reason.ts). The optional 4th argument is
  // what lets it do that in the SAME write as the status, rather than a
  // second round trip the out-of-order guard below would then have to
  // reason about separately.
  it("updateMessageStatusByProviderId can set an error marker alongside the status (D-016)", () =>
    withTestAccount(async (db, accountId) => {
      const { id: contactId } = await createContact(db, accountId, { firstName: "Ada" }, "user_test");
      const convo = await ensureConversation(db, accountId, contactId, "user_test");
      const { id } = await createMessage(db, accountId, {
        conversationId: convo.id, channel: "email", direction: "outbound", body: "x",
      }, "user_test");
      const providerMessageId = testProviderMessageId();
      await updateMessageStatus(db, accountId, id, "sent", { providerMessageId }, "user_test");

      await updateMessageStatusByProviderId(db, providerMessageId, "bounced", { error: "complained" });

      const [msg] = await listMessages(db, accountId, convo.id);
      expect(msg!.status).toBe("bounced");
      expect(msg!.error).toBe("complained");
    }));

  it("updateMessageStatusByProviderId's out-of-order guard also withholds the error patch, not only the status (mutation: write the patch unconditionally → FAILS)", () =>
    withTestAccount(async (db, accountId) => {
      const { id: contactId } = await createContact(db, accountId, { firstName: "Ada" }, "user_test");
      const convo = await ensureConversation(db, accountId, contactId, "user_test");
      const { id } = await createMessage(db, accountId, {
        conversationId: convo.id, channel: "email", direction: "outbound", body: "x",
      }, "user_test");
      const providerMessageId = testProviderMessageId();
      await updateMessageStatus(db, accountId, id, "sent", { providerMessageId }, "user_test");

      // "opened" already outranks "bounced" on STATUS_RANK's scale (3 vs 4 is
      // backwards here — bounced/failed share rank 4, the TOP, so this picks
      // "delivered" instead, which genuinely ranks BELOW bounced, to prove a
      // stale complaint event replayed after a terminal status is dropped
      // whole, patch included).
      await updateMessageStatusByProviderId(db, providerMessageId, "bounced", { error: "complained" });
      // A DIFFERENT value than the first call's, deliberately: if the guard
      // only withheld the status column (and wrote the patch regardless),
      // `error` would still end up "complained" by coincidence — matching
      // the first call's own value — and this test would pass without
      // proving anything. A distinct value makes "the patch landed anyway"
      // and "the patch was correctly withheld" read as different outcomes.
      await updateMessageStatusByProviderId(db, providerMessageId, "delivered", { error: "should_not_land" });

      const [msg] = await listMessages(db, accountId, convo.id);
      expect(msg!.status).toBe("bounced");
      // The second call's patch must not have landed — proves the guard
      // skips the WHOLE write, not just the status column.
      expect(msg!.error).toBe("complained");
    }));

  it("updateMessageStatusByProviderId treats a replayed event as a true no-op: no second event row", () =>
    withTestAccount(async (db, accountId) => {
      const { id: contactId } = await createContact(db, accountId, { firstName: "Ada" }, "user_test");
      const convo = await ensureConversation(db, accountId, contactId, "user_test");
      const { id } = await createMessage(db, accountId, {
        conversationId: convo.id, channel: "email", direction: "outbound", body: "x",
      }, "user_test");
      const providerMessageId = testProviderMessageId();
      await updateMessageStatus(db, accountId, id, "sent", { providerMessageId }, "user_test");

      await updateMessageStatusByProviderId(db, providerMessageId, "delivered");
      await updateMessageStatusByProviderId(db, providerMessageId, "delivered");

      const [msg] = await listMessages(db, accountId, convo.id);
      expect(msg!.status).toBe("delivered");

      const { data: ev } = await db.from("events").select("id")
        .eq("account_id", accountId).eq("type", "message.status_changed");
      // One from the initial "sent" write above, one from the first
      // "delivered" — the replayed second call must not add a third.
      expect(ev).toHaveLength(2);
    }));

  it("createMessage persists a providerMessageId set at insert time", () =>
    withTestAccount(async (db, accountId) => {
      const { id: contactId } = await createContact(db, accountId, { firstName: "Ada" }, "user_test");
      const convo = await ensureConversation(db, accountId, contactId, "user_test");

      // ONE draw, used for the write and the read back. The claim is that an id
      // handed to the INSERT survives onto the row, so the two sides have to be
      // the same value — and the row's column is `null` when they are not,
      // which no drawn id can equal.
      const providerMessageId = testProviderMessageId();
      const { id: messageId } = await createMessage(db, accountId, {
        conversationId: convo.id, channel: "sms", direction: "inbound",
        body: "hi", providerMessageId,
      }, "sms-inbound", "system");

      const [msg] = await listMessages(db, accountId, convo.id);
      expect(msg!.provider_message_id).toBe(providerMessageId);
      expect(msg!.id).toBe(messageId);
    }));

  it("findMessageByProviderId finds a row scoped to its own account and returns null for a miss", () =>
    withTestAccount(async (db, accountId) => {
      const { id: contactId } = await createContact(db, accountId, { firstName: "Ada" }, "user_test");
      const convo = await ensureConversation(db, accountId, contactId, "user_test");
      const providerMessageId = testProviderMessageId();
      await createMessage(db, accountId, {
        conversationId: convo.id, channel: "sms", direction: "inbound",
        body: "hi", providerMessageId,
      }, "sms-inbound", "system");

      const hit = await findMessageByProviderId(db, accountId, providerMessageId);
      expect(hit).not.toBeNull();

      // Drawn and never written, so the miss is a real miss rather than one
      // that holds only until another run writes that literal.
      expect(await findMessageByProviderId(db, accountId, testProviderMessageId())).toBeNull();
    }));

  it("createMessage on a replayed inbound webhook is skipped by the caller, proving exactly one row exists", () =>
    withTestAccount(async (db, accountId) => {
      // This mirrors what sms/inbound's handleInbound does: check
      // findMessageByProviderId BEFORE calling createMessage, and skip the
      // insert entirely on a hit. Proven here against the real table rather
      // than a mock, since a mock can't see the unique index backstop.
      const { id: contactId } = await createContact(db, accountId, { firstName: "Ada" }, "user_test");
      const convo = await ensureConversation(db, accountId, contactId, "user_test");

      const providerMessageId = testProviderMessageId();
      for (const attempt of [1, 2]) {
        const existing = await findMessageByProviderId(db, accountId, providerMessageId);
        if (!existing) {
          await createMessage(db, accountId, {
            conversationId: convo.id, channel: "sms", direction: "inbound",
            body: `attempt ${attempt}`, providerMessageId,
          }, "sms-inbound", "system");
        }
      }

      const messages = await listMessages(db, accountId, convo.id);
      expect(messages).toHaveLength(1);
      expect(messages[0]!.body).toBe("attempt 1");
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

  // D-019: the inbox list was unpaged — `listConversations` returned every
  // conversation the account had, in one unbounded read. Cursor-paged now,
  // the same `{v, id}` idiom `listContacts` already uses (contacts.ts), with
  // id as the tiebreaker so two conversations sharing a last_message_at
  // (forced below, exactly as a real same-millisecond write can) still page
  // without a repeat or a skip.
  it("listConversations pages past its limit and never repeats or skips a row, including when last_message_at collides", () =>
    withTestAccount(async (db, accountId) => {
      const ids: string[] = [];
      for (let i = 0; i < 12; i++) {
        const { id: contactId } = await createContact(db, accountId, { firstName: `C${i}` }, "user_test");
        const convo = await ensureConversation(db, accountId, contactId, "user_test");
        await createMessage(db, accountId, {
          conversationId: convo.id, channel: "email", direction: "outbound", body: `msg ${i}`,
        }, "user_test");
        ids.push(convo.id);
      }
      // Forced collision: every row shares ONE last_message_at, exactly what
      // a batch of messages written inside the same transaction would leave
      // behind, and exactly what a timestamp-only cursor cannot page through.
      const at = "2026-10-08T12:00:00.000Z";
      const { error } = await db.from("conversations").update({ last_message_at: at })
        .in("id", ids);
      expect(error, `forcing the collision failed: ${error?.message}`).toBeNull();

      const seen: string[] = [];
      let before: { v: string | null; id: string } | undefined;
      for (let page = 0; page < 10; page++) {
        const rows = await listConversations(db, accountId, { limit: 5, before });
        if (rows.length === 0) break;
        seen.push(...rows.map((r) => r.id));
        const last = rows[rows.length - 1]!;
        before = { v: last.lastMessageAt, id: last.id };
      }

      expect(seen.length).toBe(12);
      expect(new Set(seen).size).toBe(12); // no repeats
      expect([...seen].sort()).toEqual([...ids].sort()); // no skips
    }));

  // MEASURED, not guessed: ~4s alone on an idle machine (one bulk insert of
  // 1005 rows, one network round trip). The heaviest test in this file
  // besides listFailedOutboundSms's own; covered by the package's
  // testTimeout.
  //
  // PostgREST caps a single select's rows at its project's max_rows (1000 on
  // this project, per the doc comment `listConversations` carried before
  // this fix). The OLD preview read fetched every message across every
  // conversation id on the page in ONE query ordered newest-first and took
  // the first-seen row per conversation — correct only while the account's
  // combined message count on that page stayed under the cap. A chatty
  // conversation could push a quiet one's own latest message past position
  // 1000, and the quiet one would come back with NO preview at all, despite
  // genuinely having one. The fix reads each conversation's own latest
  // message on its own, so no conversation's preview can ever be pushed out
  // by another conversation's volume, at any scale.
  it("a conversation's preview is its OWN latest message even when another conversation on the same page has pushed the account's message count past PostgREST's 1000-row select cap (D-019)", () =>
    withTestAccount(async (db, accountId) => {
      const { id: quietContactId } = await createContact(db, accountId, { firstName: "Quiet" }, "user_test");
      const quiet = await ensureConversation(db, accountId, quietContactId, "user_test");
      await createMessage(db, accountId, {
        conversationId: quiet.id, channel: "email", direction: "outbound", body: "quiet's only message",
      }, "user_test");

      const { id: loudContactId } = await createContact(db, accountId, { firstName: "Loud" }, "user_test");
      const loud = await ensureConversation(db, accountId, loudContactId, "user_test");
      // One bulk insert, 1004 rows — ONE round trip, not 1004. Every one of
      // them gets a LATER created_at than quiet's single message above
      // (that write already completed, and `now()` only advances), so a
      // global "take the first 1000 rows ordered by created_at desc" read
      // would return 1000 of THESE and exactly zero of quiet's.
      const rows = Array.from({ length: 1004 }, (_, i) => ({
        account_id: accountId, conversation_id: loud.id, channel: "email",
        direction: "outbound", body: `loud message ${i}`,
      }));
      const { error: bulkErr } = await db.from("messages").insert(rows);
      expect(bulkErr, `bulk insert failed: ${bulkErr?.message}`).toBeNull();
      // last_message_at is normally set by createMessage's own touch; the
      // bulk insert above bypassed that helper, so it is set directly here —
      // after quiet's, so both conversations still sort onto the one page
      // `listConversations`'s default limit (50) already covers.
      const { error: touchErr } = await db.from("conversations")
        .update({ last_message_at: new Date().toISOString() }).eq("id", loud.id);
      expect(touchErr, `touching loud's conversation failed: ${touchErr?.message}`).toBeNull();

      const [loudSummary, quietSummary] = await listConversations(db, accountId);
      expect(loudSummary!.id).toBe(loud.id);
      expect(loudSummary!.lastMessagePreview).toContain("loud message");
      // THE ASSERTION. Before this fix this came back `null` — the quiet
      // conversation's one message, 1005th-oldest out of 1005 total, was
      // outside the global query's first 1000 rows.
      expect(quietSummary!.id).toBe(quiet.id);
      expect(quietSummary!.lastMessagePreview).toBe("quiet's only message");
    }), 20_000);

  // Review fix (messaging.ts:602). A conversation that has never been
  // messaged (`ensureConversation` alone, no `createMessage` — the 'note'
  // tab, say, or a race between the two) has a NULL last_message_at. SQL's
  // `<` and `=` are never true against NULL, so once a cursor's `v` is a
  // real timestamp, the two normal OR-branches can never match a null row
  // at all — the explicit `,last_message_at.is.null` branch is what keeps
  // it reachable on a LATER page rather than silently dropping it forever.
  it("pages a conversation with no messages yet (null last_message_at) onto a later page, never dropping it (mutation: remove the `is.null` OR branch → FAILS)", () =>
    withTestAccount(async (db, accountId) => {
      const { id: withMsgContact } = await createContact(db, accountId, { firstName: "Messaged" }, "user_test");
      const withMsg = await ensureConversation(db, accountId, withMsgContact, "user_test");
      await createMessage(db, accountId, {
        conversationId: withMsg.id, channel: "email", direction: "outbound", body: "hi",
      }, "user_test");

      const { id: noMsgContact } = await createContact(db, accountId, { firstName: "Never messaged" }, "user_test");
      const noMsg = await ensureConversation(db, accountId, noMsgContact, "user_test");

      // Page 1, limit 1: the messaged conversation sorts first (non-null
      // last_message_at outranks null in this ordering), so it alone fills
      // the page and hands back a cursor whose `v` is a REAL timestamp —
      // exactly the branch that must still reach the null row next.
      const page1 = await listConversations(db, accountId, { limit: 1 });
      expect(page1).toHaveLength(1);
      expect(page1[0]!.id).toBe(withMsg.id);

      const page2 = await listConversations(
        db, accountId, { limit: 1, before: { v: page1[0]!.lastMessageAt, id: page1[0]!.id } });
      expect(page2).toHaveLength(1);
      expect(page2[0]!.id).toBe(noMsg.id);
      expect(page2[0]!.lastMessageAt).toBeNull();
    }));

  // D-019's deep-link escape hatch: a link naming a conversation id has no
  // idea which page of the now-paged list it would fall on.
  // `getConversationSummary` finds it directly, regardless of where (or
  // whether) it would appear in `listConversations`'s own paged order.
  it("getConversationSummary finds one conversation by id with its own preview, and null for a miss or another account's row", () =>
    withTestAccount(async (db, accountId) =>
      withTestAccount(async (otherDb, otherAccountId) => {
        const { id: contactId } = await createContact(db, accountId, { firstName: "Ada" }, "user_test");
        const convo = await ensureConversation(db, accountId, contactId, "user_test");
        await createMessage(db, accountId, {
          conversationId: convo.id, channel: "email", direction: "outbound", body: "deep-linked",
        }, "user_test");

        const summary = await getConversationSummary(db, accountId, convo.id);
        expect(summary).not.toBeNull();
        expect(summary!.id).toBe(convo.id);
        expect(summary!.contactId).toBe(contactId);
        expect(summary!.contactFirstName).toBe("Ada");
        expect(summary!.lastMessagePreview).toBe("deep-linked");

        // A real id, but not THIS account's: the tenant boundary.
        expect(await getConversationSummary(otherDb, otherAccountId, convo.id)).toBeNull();
        // Drawn and never written.
        expect(await getConversationSummary(db, accountId, "00000000-0000-0000-0000-000000000000"))
          .toBeNull();
      })));

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

  // clearUnreadCount is called by markConversationReadAction with a
  // conversation id that comes straight off the browser. Since 0053 that
  // call reaches a service-role write, so this .eq("account_id", …).eq("id",
  // …) pair is the only thing standing between it and another account's row,
  // or another conversation in the SAME account.
  it("clearUnreadCount touches only the named account's conversation: another account's id changes nothing, and a second unread conversation in the SAME account is untouched (mutation: drop .eq(\"account_id\") -> the first read below stays 0 instead of 1 -> FAILS; drop .eq(\"id\") -> the second conversation reads 0 instead of 1 -> FAILS)", () =>
    withTestAccount(async (db, accountA) =>
      withTestAccount(async (_db, accountB) => {
        const contactB = await createContact(db, accountB, { firstName: "Beto" }, "user_test");
        const convoB = await ensureConversation(db, accountB, contactB.id, "user_test");
        await incrementUnreadCount(db, accountB, convoB.id);

        // A SECOND unread conversation in accountB. Without .eq("id", …),
        // clearing convoB below would clear every conversation whose
        // account_id matches — this one included — and the assertion on it
        // near the bottom would read 0 instead of 1.
        const contactB2 = await createContact(db, accountB, { firstName: "Cora" }, "user_test");
        const convoB2 = await ensureConversation(db, accountB, contactB2.id, "user_test");
        await incrementUnreadCount(db, accountB, convoB2.id);

        await clearUnreadCount(db, accountA, convoB.id);
        const { data } = await db.from("conversations").select("unread_count").eq("id", convoB.id).single();
        expect(data).toEqual({ unread_count: 1 });
        await clearUnreadCount(db, accountB, convoB.id);
        const { data: after } = await db.from("conversations").select("unread_count").eq("id", convoB.id).single();
        expect(after).toEqual({ unread_count: 0 });

        // The second conversation is untouched: clearing convoB named ONLY
        // convoB, never every unread row in accountB.
        const { data: other } = await db.from("conversations").select("unread_count").eq("id", convoB2.id).single();
        expect(other).toEqual({ unread_count: 1 });
      })));

  it("updateMessageStatusByProviderId does not match inbound messages even when they carry a provider_message_id", () =>
    withTestAccount(async (db, accountId) => {
      const { id: contactId } = await createContact(db, accountId, { firstName: "Ada" }, "user_test");
      const convo = await ensureConversation(db, accountId, contactId, "user_test");

      // Create an inbound message with a provider id (for webhook-retry idempotency)
      const providerMessageId = testProviderMessageId();
      const { id: messageId } = await createMessage(db, accountId, {
        conversationId: convo.id, channel: "sms", direction: "inbound",
        body: "inbound message", providerMessageId,
      }, "sms-inbound", "system");

      // Attempt to update status by provider id — should miss because the row is inbound
      const result = await updateMessageStatusByProviderId(db, providerMessageId, "delivered");
      expect(result.updated).toBe(false);

      // Verify the message status is unchanged (still at its default queued state)
      const [msg] = await listMessages(db, accountId, convo.id);
      expect(msg!.id).toBe(messageId);
      expect(msg!.status).toBe("queued");
      // The row DOES carry the id the lookup was given — added with the drawn
      // ids, because without it the miss above is equally consistent with the
      // id never having reached the row, and the test would go on passing while
      // proving nothing about direction. This is the only assertion in the file
      // that a two-separate-draws mistake would not have failed loudly.
      expect(msg!.provider_message_id).toBe(providerMessageId);
    }));
});
