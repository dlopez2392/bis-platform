import type { SupabaseClient } from "@supabase/supabase-js";
import { emit, type ActorType } from "./events";
import { sanitizeSearchTerm } from "./search-term";

export type MessageStatus =
  | "queued" | "sent" | "delivered" | "opened" | "bounced" | "failed";

export type NewMessage = {
  conversationId: string;
  // 'form' arrives with M1c: a form submission is the platform's first inbound
  // message. 'note' is not reused for it — that means "the operator wrote this
  // internally" in the UI, and a lead's own words are not an internal note.
  // "sms" needs no migration: 0006_forms.sql:92 already sets the CHECK to
  // ('email','sms','webchat','voice','note','form') — a deliberate
  // "channels are adapters, not migrations" decision.
  channel: "email" | "form" | "voice" | "sms";
  direction: "outbound" | "inbound";
  subject?: string;
  body: string;
  // Set on inbound webhook writes (sms/inbound's message.received handler) so
  // a retried delivery can be recognised and skipped BEFORE this insert runs
  // — see findMessageByProviderId below. Left unset for every other caller;
  // the outbound send path instead records this later via
  // updateMessageStatus's own providerMessageId patch.
  providerMessageId?: string;
};

export type ConversationSummary = {
  id: string;
  contactId: string;
  contactFirstName: string | null;
  contactLastName: string | null;
  lastMessageAt: string | null;
  lastMessagePreview: string | null;
  unreadCount: number;
};

const MESSAGE_COLS =
  "id, conversation_id, channel, direction, status, provider_message_id, subject, body, error, created_at";

// Providers deliver webhook events at-least-once and without an ordering
// guarantee, so the same event can replay and a later-firing event (e.g.
// "delivered") can arrive after an earlier one in the lifecycle (e.g.
// "opened") that actually happened first on the provider's side. Rank the
// scale so a write only ever moves status forward. bounced/failed are
// terminal outcomes and share the top rank, so either always wins over an
// earlier in-flight status but a duplicate of either is still a no-op.
const STATUS_RANK: Record<MessageStatus, number> = {
  queued: 0,
  sent: 1,
  delivered: 2,
  opened: 3,
  bounced: 4,
  failed: 4,
};

export async function ensureConversation(
  db: SupabaseClient, accountId: string, contactId: string, actorId: string,
  actorType: ActorType = "user",
): Promise<{ id: string; created: boolean }> {
  const { data: existing, error: findErr } = await db.from("conversations")
    .select("id").eq("account_id", accountId).eq("contact_id", contactId).maybeSingle();
  if (findErr) throw new Error(`conversation lookup failed: ${findErr.message}`);
  if (existing) return { id: existing.id, created: false };

  // Plain insert, not upsert: PostgREST's upsert response can't distinguish
  // "I inserted" from "I updated on conflict", so two callers racing past the
  // lookup above would both get created: true and both emit
  // conversation.created — one automation firing twice for one conversation.
  // `conversations_account_contact_unique` still keeps the row itself safe;
  // we just need the loser's insert to fail visibly (23505) instead of
  // silently upserting, so only the actual winner emits.
  const { data, error } = await db.from("conversations")
    .insert({ account_id: accountId, contact_id: contactId })
    .select("id").single();

  if (!error) {
    if (!data) throw new Error("ensureConversation failed: insert returned no row");
    await emit(db, accountId, "conversation.created", actorId,
      { conversationId: data.id, contactId }, actorType);
    return { id: data.id, created: true };
  }

  if (error.code !== "23505") throw new Error(`ensureConversation failed: ${error.message}`);

  // Lost the race: another caller's insert won between our lookup and our
  // insert. Re-select rather than emit — this call did not create anything.
  const { data: winner, error: reselectErr } = await db.from("conversations")
    .select("id").eq("account_id", accountId).eq("contact_id", contactId).single();
  if (reselectErr || !winner) {
    throw new Error(`conversation re-select after conflict failed: ${reselectErr?.message}`);
  }
  return { id: winner.id, created: false };
}

export async function createMessage(
  db: SupabaseClient, accountId: string, input: NewMessage, actorId: string,
  actorType: ActorType = "user",
): Promise<{ id: string }> {
  const { data, error } = await db.from("messages")
    .insert({
      account_id: accountId,
      conversation_id: input.conversationId,
      channel: input.channel,
      direction: input.direction,
      subject: input.subject ?? null,
      body: input.body,
      provider_message_id: input.providerMessageId ?? null,
    })
    .select("id").single();
  if (error || !data) throw new Error(`createMessage failed: ${error?.message}`);

  // Emit before the conversation touch, not after: the message row genuinely
  // exists at this point, so the event must exist too, or nothing downstream
  // (automations, activity feeds) ever learns this message happened.
  await emit(db, accountId, "message.created", actorId,
    { messageId: data.id, conversationId: input.conversationId, channel: input.channel },
    actorType);

  // The touch is best-effort and deliberately non-fatal. The message is real
  // and visible either way (row + event both exist above); if this update
  // fails, only the inbox's sort order and preview go stale, and that
  // self-heals on the conversation's next message. Throwing here would be
  // worse: the caller would mark a message "failed" that was actually
  // written successfully.
  const { error: touchErr } = await db.from("conversations")
    .update({ last_message_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq("account_id", accountId).eq("id", input.conversationId);
  if (touchErr) {
    console.error(`conversation touch failed for ${input.conversationId}: ${touchErr.message}`);
  }

  return { id: data.id };
}

export async function updateMessageStatus(
  db: SupabaseClient, accountId: string, messageId: string,
  status: MessageStatus,
  patch: { providerMessageId?: string; error?: string } = {},
  actorId = "system",
  // Same `actorType: ActorType = "user"` convention every sibling in this file
  // uses, and defaulted the same way so no existing call site changes
  // behaviour. It exists because the voice text-back writes these statuses
  // with actor_id "voice" — an AI, not a human — and without this the event
  // said `actor_type: "user"`, which is the exact bug M1b fixed for the Resend
  // webhook (see emit's doc in events.ts).
  actorType: ActorType = "user",
): Promise<void> {
  const row: Record<string, unknown> = { status, updated_at: new Date().toISOString() };
  if (patch.providerMessageId !== undefined) row.provider_message_id = patch.providerMessageId;
  if (patch.error !== undefined) row.error = patch.error;

  const { error } = await db.from("messages")
    .update(row).eq("account_id", accountId).eq("id", messageId);
  if (error) throw new Error(`updateMessageStatus failed: ${error.message}`);

  await emit(db, accountId, "message.status_changed", actorId, { messageId, status }, actorType);
}

/**
 * Webhook path. Provider events carry only their own message id and no tenant
 * context, so this deliberately does not take an accountId — the provider id
 * is globally unique (see the partial unique index in migration 0005). The
 * account is read back from the row, never taken from the payload.
 *
 * Inbound messages now record provider ids for webhook-retry idempotency, so
 * this query must filter to direction="outbound" to ensure a delivery-status
 * callback can only ever match and update an outbound message (the platform's
 * own send), never an inbound one.
 */
export async function updateMessageStatusByProviderId(
  db: SupabaseClient, providerMessageId: string, status: MessageStatus,
): Promise<{ updated: boolean }> {
  const { data, error } = await db.from("messages")
    .select("id, account_id, status")
    .eq("provider_message_id", providerMessageId)
    .eq("direction", "outbound")
    .maybeSingle();
  if (error) throw new Error(`updateMessageStatusByProviderId failed: ${error.message}`);
  if (!data) return { updated: false };

  // Out-of-order or replayed event: the row already reflects an equal or
  // later point in the lifecycle. Leave it alone — no write, no event —
  // rather than regress the status or log a duplicate.
  if (STATUS_RANK[status] <= STATUS_RANK[data.status as MessageStatus]) {
    return { updated: true };
  }

  const { error: updateErr } = await db.from("messages")
    .update({ status, updated_at: new Date().toISOString() })
    .eq("id", data.id);
  if (updateErr) throw new Error(`updateMessageStatusByProviderId failed: ${updateErr.message}`);

  await emit(db, data.account_id, "message.status_changed", "system",
    { messageId: data.id, status, providerMessageId }, "system");
  return { updated: true };
}

/**
 * Idempotency check for an inbound webhook write (sms/inbound's
 * message.received handler): Telnyx retries at-least-once, and unlike
 * `updateMessageStatusByProviderId` above this MUST run before the insert,
 * not after — there is no update to make idempotent-by-rank here, only an
 * insert to skip outright. Scoped by accountId (unlike the status lookup)
 * because the caller already knows its tenant from the dialed number and
 * there is no reason to search past it, even though
 * `messages_provider_message_id_unique` (migration 0005) also enforces this
 * globally as a backstop against a race between two concurrent deliveries.
 */
export async function findMessageByProviderId(
  db: SupabaseClient, accountId: string, providerMessageId: string,
): Promise<{ id: string } | null> {
  const { data, error } = await db.from("messages")
    .select("id")
    .eq("account_id", accountId).eq("provider_message_id", providerMessageId)
    .maybeSingle();
  if (error) throw new Error(`findMessageByProviderId failed: ${error.message}`);
  return (data as { id: string } | null) ?? null;
}

/**
 * Has this conversation already been texted since `since`?
 *
 * The cooldown read behind the missed-call text-back (finish-call.ts): a
 * repeat abandoned caller would otherwise receive a byte-identical message on
 * every call, which is precisely the pattern carrier filtering looks for under
 * 10DLC — and the A2P registration at risk is the CLIENT'S OWN. Like
 * `findMessageByProviderId` above, this runs BEFORE the insert rather than
 * reconciling after it, so a suppressed text-back leaves no row at all.
 *
 * Scoped by accountId AND conversationId, both. Conversations are
 * one-per-contact (see `ensureConversation`), so the conversation filter alone
 * already means "this caller"; the account filter is the tenant boundary and
 * is not redundant with it — a conversation id is a bare uuid arriving from a
 * caller's own state, and no read in this file is allowed to be satisfiable by
 * another tenant's rows.
 *
 * `failed` is deliberately EXCLUDED. A non-failed row (including `queued`,
 * which is what a text whose post-send bookkeeping write blew up is left as)
 * means a text really did leave the building; a `failed` row means the
 * provider refused and nothing was ever delivered, so counting it would
 * silence the feature permanently for that caller on the strength of an
 * outage. `bounced` still counts: that message did go out, and the carrier
 * rejecting it is the last reason to send it again.
 */
export async function hasRecentOutboundSms(
  db: SupabaseClient, accountId: string, conversationId: string, since: Date,
): Promise<boolean> {
  const { data, error } = await db.from("messages")
    .select("id")
    .eq("account_id", accountId)
    .eq("conversation_id", conversationId)
    .eq("channel", "sms")
    .eq("direction", "outbound")
    .neq("status", "failed")
    .gte("created_at", since.toISOString())
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`hasRecentOutboundSms failed: ${error.message}`);
  return data !== null;
}

/**
 * ONE CALL's text-back window — the span of time inside which the text-back
 * for that call, if there was one, would have been written.
 *
 * The whole point of this type. `messages` carries no call id (and this change
 * ships no migration to add one), so the only thing that can tie a failed
 * outbound SMS to a particular call is WHEN it was written: `finishCall`
 * writes the text-back row during its own run, immediately after the caller
 * hangs up. Correlating by conversation instead is wrong — conversations are
 * one-per-CONTACT (`ensureConversation`), so one conversation spans every call
 * that person has ever made, and a failure on any of them would be claimed by
 * all of them.
 *
 * The bounds are chosen by the caller, which is where the reasoning and the
 * residual failure modes are documented (`calls/textback-window.ts`). This read
 * only applies them.
 */
export type TextbackWindow = {
  /** The `calls` row this window belongs to. Carried straight through to the
   *  result so callers key the badge on the CALL, never on the conversation. */
  callId: string;
  conversationId: string;
  /** Inclusive lower bound, ISO. */
  fromIso: string;
  /** Exclusive upper bound, ISO. */
  toIso: string;
};

/** The failed text-back belonging to ONE call — nothing reached the person on
 *  the other end, and there is no retry anywhere that will. `body` is what was
 *  attempted, so a resend does not make the operator retype it. */
export type FailedOutboundSms = {
  callId: string;
  conversationId: string;
  messageId: string;
  body: string;
  failedAt: string;
  /** When a LATER outbound SMS to this contact did go out, if one did.
   *
   *  It deliberately does NOT suppress the failure: the text-back for this
   *  call failed, that stays true forever, and an unrelated manual reply two
   *  hours later is not evidence about it. Keying the badge itself on this was
   *  the defect — a genuinely failed text-back vanished the moment anyone
   *  texted that contact again, and nothing else in the product recorded it.
   *
   *  What it IS for: deciding whether to still offer "Send it now". The resend
   *  writes a NEW outbound row through `sendSmsAction` rather than mutating the
   *  failed one, so without this the button would sit there permanently and
   *  every press would text a real phone again — the repeated-identical-body
   *  pattern 10DLC carrier filtering hunts for, with the CLIENT'S OWN A2P
   *  registration as the thing that gets blocked. */
  supersededAt: string | null;
};

/**
 * The failed text-back belonging to each of these CALLS — the read behind the
 * failed-text-back badge on the Calls list and the call detail page.
 *
 * ONE read for a whole page of calls, not one per row. The calls list renders
 * up to 50, and a per-row query would be fifty round trips to answer a
 * question that is empty for almost every one of them.
 *
 * Correlation is BY CALL, through each call's own window (see `TextbackWindow`
 * above): a failure counts for a call only when it was written inside that
 * call's window. The conversation is still the lookup key — it is what the
 * message rows are filed under — but it is no longer the ANSWER. A
 * conversation-wide "is there a failure here" reported the same failure on
 * every call that contact ever made, in both directions: a later call claiming
 * an earlier call's failure, and a real failure disappearing the moment
 * anything else in the thread succeeded.
 *
 * "The newest failure INSIDE the window", not "the newest failure anywhere":
 * a failure from a previous call is outside this call's window and cannot be
 * claimed by it.
 *
 * And each failure is claimed by ONE call. Windows genuinely overlap — a redial
 * ending within five minutes of the first call puts its text-back inside both —
 * so the loop below settles the overlap deterministically (latest-start call
 * first, one message consumed once) rather than letting two rows report the
 * same message. See the comments on the loop for why that is the right call.
 *
 * Two queries at most, and one in the common case. The first asks only for
 * FAILED rows inside the union of the windows — rare and time-bounded, so it
 * cannot be the unbounded scan "newest message per conversation" usually is;
 * when it comes back empty, which is almost always, the second never runs.
 *
 * Scoped by accountId as well as conversation id, exactly like
 * `hasRecentOutboundSms` above and for the same reason: a conversation id is a
 * bare uuid arriving from a caller's own page state, and no read in this file
 * may be satisfiable by another tenant's rows.
 */
export async function listFailedOutboundSms(
  db: SupabaseClient, accountId: string, windows: TextbackWindow[],
): Promise<FailedOutboundSms[]> {
  // A window that cannot bound anything is dropped, never widened. Both bounds
  // reach here from `calls` columns, and an unparseable or inverted pair would
  // otherwise become a filter matching everything — which is precisely the
  // conversation-wide join this read exists to stop being.
  const usable = windows.filter((w) => {
    if (!w.callId || !w.conversationId) return false;
    const from = Date.parse(w.fromIso);
    const to = Date.parse(w.toIso);
    return Number.isFinite(from) && Number.isFinite(to) && from < to;
  });
  if (usable.length === 0) return [];

  const ids = [...new Set(usable.map((w) => w.conversationId))];
  const earliest = Math.min(...usable.map((w) => Date.parse(w.fromIso)));
  const latest = Math.max(...usable.map((w) => Date.parse(w.toIso)));

  const { data: failures, error } = await db.from("messages")
    .select("id, conversation_id, body, created_at")
    .eq("account_id", accountId)
    .in("conversation_id", ids)
    .eq("channel", "sms")
    .eq("direction", "outbound")
    .eq("status", "failed")
    // The union of every window on the page — a coarse pre-filter, with the
    // per-window test below doing the real work. Milliseconds, because
    // Date.parse truncates the microseconds Postgres stores; truncation rounds
    // DOWN, so this only ever widens and cannot drop a row that belongs.
    .gte("created_at", new Date(earliest).toISOString())
    .lt("created_at", new Date(latest).toISOString())
    .order("created_at", { ascending: false });
  if (error) throw new Error(`listFailedOutboundSms failed: ${error.message}`);

  const byConversation = new Map<string, { id: string; body: string; created_at: string }[]>();
  for (const row of (failures ?? []) as {
    id: string; conversation_id: string; body: string; created_at: string;
  }[]) {
    const held = byConversation.get(row.conversation_id);
    if (held) held.push(row);
    else byConversation.set(row.conversation_id, [row]);
  }

  // LATEST-START CALL FIRST, whatever order the caller passed them in.
  //
  // Windows overlap for real: a text-back is written at the END of a call, and
  // one call's window runs five minutes past its own hangup, so a redial that
  // ENDS within those five minutes has its text-back land inside the first
  // call's window as well as its own. Something has to decide which call owns
  // it, and the write itself says which: the message was written just after a
  // hangup, so among the candidates whose window holds it, the one that STARTED
  // last is the one whose hangup it sits closest to. For a single caller the
  // calls are sequential — `startA < endA <= startB` — so latest start is also
  // latest end, and the two readings of "nearest" agree.
  //
  // Sorted HERE rather than relied upon from the caller. `listCalls` does return
  // newest-first (`.order("started_at", { ascending: false })`), and both call
  // sites feed this straight from it — but that is the caller's ordering to
  // change, and if it ever did, the failure would be silent and would send a
  // real phone the wrong call's words.
  const ordered = [...usable].sort((x, y) => Date.parse(y.fromIso) - Date.parse(x.fromIso));

  // Rows arrive newest-first, so the first UNCLAIMED one falling inside a
  // window is that call's. Compared as instants, not as strings: Postgres omits
  // the fractional part of a timestamptz whose microseconds are zero, so two
  // rows a second apart can differ in LENGTH as well as value and lexical
  // comparison stops being trustworthy at exactly the boundaries this decides.
  //
  // TWO ledgers, and the message one is the one that matters. Keyed only on the
  // CALL, a single message could be handed to more than one call — and with two
  // overlapping windows it always was: the newer call took its own failed
  // text-back, and the older call, whose window still reached past it, took the
  // SAME row. The older call's own failure never surfaced at all, and "Send it
  // now" on that row would have texted a real phone the OTHER call's words.
  // `claimedMessages` makes a failure consumable exactly once.
  //
  // `claimedCalls` keeps the other half of the invariant the badge relies on:
  // one call reports at most one failure, so a duplicate window for one call —
  // or a second failed message inside one window — still yields a single row.
  const hits: FailedOutboundSms[] = [];
  const claimedCalls = new Set<string>();
  const claimedMessages = new Set<string>();
  for (const w of ordered) {
    if (claimedCalls.has(w.callId)) continue;
    const from = Date.parse(w.fromIso);
    const to = Date.parse(w.toIso);
    const hit = (byConversation.get(w.conversationId) ?? []).find((row) => {
      if (claimedMessages.has(row.id)) return false;
      const at = Date.parse(row.created_at);
      return Number.isFinite(at) && at >= from && at < to;
    });
    if (!hit) continue;
    claimedCalls.add(w.callId);
    claimedMessages.add(hit.id);
    hits.push({
      callId: w.callId,
      conversationId: w.conversationId,
      messageId: hit.id,
      body: hit.body,
      failedAt: hit.created_at,
      supersededAt: null,
    });
  }
  if (hits.length === 0) return [];

  // Only now, and only for the handful of conversations that actually had a
  // failure: has anything else reached this contact since? This answers the
  // resend control's question, never the badge's — see `supersededAt` above.
  const { data: sent, error: sentErr } = await db.from("messages")
    .select("conversation_id, created_at")
    .eq("account_id", accountId)
    .in("conversation_id", [...new Set(hits.map((h) => h.conversationId))])
    .eq("channel", "sms")
    .eq("direction", "outbound")
    .neq("status", "failed");
  if (sentErr) throw new Error(`listFailedOutboundSms failed: ${sentErr.message}`);

  const latestSent = new Map<string, string>();
  for (const row of (sent ?? []) as { conversation_id: string; created_at: string }[]) {
    const at = Date.parse(row.created_at);
    if (!Number.isFinite(at)) continue;
    const held = latestSent.get(row.conversation_id);
    if (held === undefined || at > Date.parse(held)) {
      latestSent.set(row.conversation_id, row.created_at);
    }
  }

  return hits.map((h) => {
    const at = latestSent.get(h.conversationId);
    return at !== undefined && Date.parse(at) > Date.parse(h.failedAt)
      ? { ...h, supersededAt: at }
      : h;
  });
}

/**
 * Atomic, via a SQL function. PostgREST cannot express `set x = x + 1`, and a
 * read-modify-write from here would silently lose a count when two submissions
 * land at once.
 */
export async function incrementUnreadCount(
  db: SupabaseClient, accountId: string, conversationId: string,
): Promise<void> {
  const { error } = await db.rpc("increment_conversation_unread", {
    p_account_id: accountId, p_conversation_id: conversationId });
  if (error) throw new Error(`incrementUnreadCount failed: ${error.message}`);
}

export async function clearUnreadCount(
  db: SupabaseClient, accountId: string, conversationId: string,
): Promise<void> {
  const { error } = await db.from("conversations")
    .update({ unread_count: 0, updated_at: new Date().toISOString() })
    .eq("account_id", accountId).eq("id", conversationId);
  if (error) throw new Error(`clearUnreadCount failed: ${error.message}`);
}

/**
 * Total unread count across every conversation in the account — the sidebar
 * badge needs one number, not the per-conversation breakdown listConversations
 * already returns. Summed in JS rather than a Postgres aggregate: PostgREST's
 * select-based sum() would be a new, unproven surface in this codebase, and an
 * account's conversation count is small enough that fetching the one column
 * and reducing it costs nothing meaningful. Still a single query.
 */
export async function sumUnreadCount(
  db: SupabaseClient, accountId: string,
): Promise<number> {
  const { data, error } = await db.from("conversations")
    .select("unread_count").eq("account_id", accountId);
  if (error) throw new Error(`sumUnreadCount failed: ${error.message}`);
  return (data ?? []).reduce((sum, row) => sum + (row.unread_count ?? 0), 0);
}

export async function listConversations(
  db: SupabaseClient, accountId: string,
): Promise<ConversationSummary[]> {
  const { data, error } = await db.from("conversations")
    .select("id, contact_id, last_message_at, unread_count, contacts(first_name, last_name)")
    .eq("account_id", accountId)
    .order("last_message_at", { ascending: false, nullsFirst: false });
  if (error) throw new Error(error.message);

  const rows = (data ?? []) as any[];
  if (rows.length === 0) return [];

  // One query for the previews rather than one per thread. Ordered newest
  // first, so the first row seen for a conversation is its latest message.
  //
  // This does fetch more rows than it strictly needs. PostgREST caps results
  // at max_rows (1000), so at a few hundred conversations with long histories
  // the tail of the previews would be truncated. Correct fix at that scale is
  // a DB-side lateral join or a denormalised last_message_preview column;
  // neither is warranted for one operator, and N+1 queries are worse.
  const ids = rows.map((r) => r.id);
  const { data: msgs, error: msgErr } = await db.from("messages")
    .select("conversation_id, body")
    .eq("account_id", accountId).in("conversation_id", ids)
    .order("created_at", { ascending: false });
  if (msgErr) throw new Error(msgErr.message);

  const preview = new Map<string, string>();
  for (const row of (msgs ?? []) as any[]) {
    if (!preview.has(row.conversation_id)) preview.set(row.conversation_id, row.body);
  }

  return rows.map((r) => ({
    id: r.id,
    contactId: r.contact_id,
    contactFirstName: r.contacts?.first_name ?? null,
    contactLastName: r.contacts?.last_name ?? null,
    lastMessageAt: r.last_message_at,
    lastMessagePreview: preview.get(r.id) ?? null,
    unreadCount: r.unread_count ?? 0,
  }));
}

/**
 * Every message exchanged with one contact, oldest first.
 *
 * `listMessages` needs a conversation id, which the contact detail page does
 * not have and should not have to look up itself — that gap is why a sent
 * email appeared in Conversations and nowhere on the contact's own record.
 *
 * Two reads rather than an embedded join, because conversations are
 * ONE-PER-CONTACT (see `ensureConversation`): the lookup is a single row by a
 * unique pair, and going through `listMessages` keeps one definition of what a
 * message row looks like. A contact who has never been messaged has no
 * conversation row at all — the common case — and reads as an empty list
 * rather than an error.
 */
export async function listContactMessages(
  db: SupabaseClient, accountId: string, contactId: string,
) {
  const { data: conversation, error } = await db.from("conversations")
    .select("id").eq("account_id", accountId).eq("contact_id", contactId).maybeSingle();
  if (error) throw new Error(`listContactMessages failed: ${error.message}`);
  if (!conversation) return [];
  return listMessages(db, accountId, conversation.id as string);
}

export async function listMessages(
  db: SupabaseClient, accountId: string, conversationId: string,
) {
  const { data, error } = await db.from("messages")
    .select(MESSAGE_COLS)
    .eq("account_id", accountId).eq("conversation_id", conversationId)
    .order("created_at", { ascending: true });
  if (error) throw new Error(error.message);
  return data ?? [];
}

/**
 * The ⌘K palette's conversations half — matched on MESSAGE BODY, which is what
 * someone means by "find the thread where we talked about the fence".
 *
 * Two queries, deliberately. The first is a single-column `.ilike()`, whose
 * operand PostgREST sends as a parameter — no interpolated filter grammar to
 * break (see search-term.ts). The second fetches only the handful of parent
 * conversations that survived.
 *
 * The 200-row cap on the first query is a real, accepted limit, not immunity:
 * an account with more than 200 messages matching one term keeps only the 200
 * NEWEST, so a thread whose only match is older than all of those is missed.
 * That is the right trade for a find-as-you-type box capped at 5 results —
 * but it is a truncation, and calling it anything else would be a lie the
 * next reader has to discover for themselves.
 *
 * `lastMessagePreview` is the MATCHED message, not the newest one — in a
 * palette, showing the line you searched for is the whole point.
 */
export async function searchConversations(
  db: SupabaseClient, accountId: string, opts: { search: string; limit?: number },
): Promise<ConversationSummary[]> {
  const s = sanitizeSearchTerm(opts.search);
  if (!s) return [];
  const limit = opts.limit ?? 5;

  const { data: msgs, error: msgErr } = await db.from("messages")
    .select("conversation_id, body, created_at")
    .eq("account_id", accountId)
    .ilike("body", `%${s}%`)
    .order("created_at", { ascending: false })
    .limit(200);
  if (msgErr) throw new Error(`searchConversations failed: ${msgErr.message}`);

  // Newest matching message per conversation, in match order, capped.
  const preview = new Map<string, string>();
  for (const row of (msgs ?? []) as { conversation_id: string; body: string }[]) {
    if (!preview.has(row.conversation_id)) preview.set(row.conversation_id, row.body);
    if (preview.size >= limit) break;
  }
  const ids = [...preview.keys()];
  if (ids.length === 0) return [];

  const { data, error } = await db.from("conversations")
    .select("id, contact_id, last_message_at, unread_count, contacts(first_name, last_name)")
    .eq("account_id", accountId)
    .in("id", ids);
  if (error) throw new Error(`searchConversations failed: ${error.message}`);

  const byId = new Map(((data ?? []) as any[]).map((r) => [r.id as string, r]));
  // Ordered by match recency (the `ids` order), not by the second query's
  // arbitrary return order. A row RLS filtered out is dropped rather than
  // half-rendered from the message hit alone.
  return ids.flatMap((id) => {
    const r = byId.get(id);
    if (!r) return [];
    return [{
      id: r.id,
      contactId: r.contact_id,
      contactFirstName: r.contacts?.first_name ?? null,
      contactLastName: r.contacts?.last_name ?? null,
      lastMessageAt: r.last_message_at,
      lastMessagePreview: preview.get(id) ?? null,
      unreadCount: r.unread_count ?? 0,
    }];
  });
}
