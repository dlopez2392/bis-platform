import { describe, it, expect } from "vitest";
import { withTestAccount } from "./fixtures";
import { createContact } from "../contacts";
import {
  ensureConversation, createMessage, updateMessageStatus,
  updateMessageStatusByProviderId, findMessageByProviderId, hasRecentOutboundSms,
  listFailedOutboundSms,
  listConversations, listMessages,
  incrementUnreadCount, sumUnreadCount, searchConversations,
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

      await updateMessageStatus(db, accountId, id, "sent", { providerMessageId: "prov_1" }, "user_test");
      let [msg] = await listMessages(db, accountId, convo.id);
      expect(msg!.status).toBe("sent");
      expect(msg!.provider_message_id).toBe("prov_1");

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

      await updateMessageStatus(db, accountId, id, "sent", { providerMessageId: "prov_ai" }, "voice", "ai");

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

      await updateMessageStatus(db, accountId, id, "sent", { providerMessageId: "prov_cool" }, "voice", "ai");
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
        { providerMessageId: "prov_resend" }, "user_test");
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
        const { data } = await db.from("messages").select("created_at").eq("id", id).single();
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

  it("createMessage persists a providerMessageId set at insert time", () =>
    withTestAccount(async (db, accountId) => {
      const { id: contactId } = await createContact(db, accountId, { firstName: "Ada" }, "user_test");
      const convo = await ensureConversation(db, accountId, contactId, "user_test");

      const { id: messageId } = await createMessage(db, accountId, {
        conversationId: convo.id, channel: "sms", direction: "inbound",
        body: "hi", providerMessageId: "inbound_evt_1",
      }, "sms-inbound", "system");

      const [msg] = await listMessages(db, accountId, convo.id);
      expect(msg!.provider_message_id).toBe("inbound_evt_1");
      expect(msg!.id).toBe(messageId);
    }));

  it("findMessageByProviderId finds a row scoped to its own account and returns null for a miss", () =>
    withTestAccount(async (db, accountId) => {
      const { id: contactId } = await createContact(db, accountId, { firstName: "Ada" }, "user_test");
      const convo = await ensureConversation(db, accountId, contactId, "user_test");
      await createMessage(db, accountId, {
        conversationId: convo.id, channel: "sms", direction: "inbound",
        body: "hi", providerMessageId: "inbound_evt_2",
      }, "sms-inbound", "system");

      const hit = await findMessageByProviderId(db, accountId, "inbound_evt_2");
      expect(hit).not.toBeNull();

      expect(await findMessageByProviderId(db, accountId, "inbound_evt_does_not_exist")).toBeNull();
    }));

  it("createMessage on a replayed inbound webhook is skipped by the caller, proving exactly one row exists", () =>
    withTestAccount(async (db, accountId) => {
      // This mirrors what sms/inbound's handleInbound does: check
      // findMessageByProviderId BEFORE calling createMessage, and skip the
      // insert entirely on a hit. Proven here against the real table rather
      // than a mock, since a mock can't see the unique index backstop.
      const { id: contactId } = await createContact(db, accountId, { firstName: "Ada" }, "user_test");
      const convo = await ensureConversation(db, accountId, contactId, "user_test");

      const providerMessageId = "inbound_evt_replay";
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

  it("updateMessageStatusByProviderId does not match inbound messages even when they carry a provider_message_id", () =>
    withTestAccount(async (db, accountId) => {
      const { id: contactId } = await createContact(db, accountId, { firstName: "Ada" }, "user_test");
      const convo = await ensureConversation(db, accountId, contactId, "user_test");

      // Create an inbound message with a provider id (for webhook-retry idempotency)
      const { id: messageId } = await createMessage(db, accountId, {
        conversationId: convo.id, channel: "sms", direction: "inbound",
        body: "inbound message", providerMessageId: "inbound_prov_delivery",
      }, "sms-inbound", "system");

      // Attempt to update status by provider id — should miss because the row is inbound
      const result = await updateMessageStatusByProviderId(db, "inbound_prov_delivery", "delivered");
      expect(result.updated).toBe(false);

      // Verify the message status is unchanged (still at its default queued state)
      const [msg] = await listMessages(db, accountId, convo.id);
      expect(msg!.id).toBe(messageId);
      expect(msg!.status).toBe("queued");
    }));
});
