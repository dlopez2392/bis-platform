import type { SupabaseClient } from "@supabase/supabase-js";
import { emit, type ActorType } from "./events";

export type MessageStatus =
  | "queued" | "sent" | "delivered" | "opened" | "bounced" | "failed";

export type NewMessage = {
  conversationId: string;
  // 'form' arrives with M1c: a form submission is the platform's first inbound
  // message. 'note' is not reused for it — that means "the operator wrote this
  // internally" in the UI, and a lead's own words are not an internal note.
  channel: "email" | "form" | "voice";
  direction: "outbound" | "inbound";
  subject?: string;
  body: string;
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
): Promise<void> {
  const row: Record<string, unknown> = { status, updated_at: new Date().toISOString() };
  if (patch.providerMessageId !== undefined) row.provider_message_id = patch.providerMessageId;
  if (patch.error !== undefined) row.error = patch.error;

  const { error } = await db.from("messages")
    .update(row).eq("account_id", accountId).eq("id", messageId);
  if (error) throw new Error(`updateMessageStatus failed: ${error.message}`);

  await emit(db, accountId, "message.status_changed", actorId, { messageId, status });
}

/**
 * Webhook path. Provider events carry only their own message id and no tenant
 * context, so this deliberately does not take an accountId — the provider id
 * is globally unique (see the partial unique index in migration 0005). The
 * account is read back from the row, never taken from the payload.
 */
export async function updateMessageStatusByProviderId(
  db: SupabaseClient, providerMessageId: string, status: MessageStatus,
): Promise<{ updated: boolean }> {
  const { data, error } = await db.from("messages")
    .select("id, account_id, status")
    .eq("provider_message_id", providerMessageId)
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
