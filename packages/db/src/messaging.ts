import type { SupabaseClient } from "@supabase/supabase-js";

export type MessageStatus =
  | "queued" | "sent" | "delivered" | "opened" | "bounced" | "failed";

export type NewMessage = {
  conversationId: string;
  channel: "email";
  direction: "outbound";
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
};

const MESSAGE_COLS =
  "id, conversation_id, channel, direction, status, provider_message_id, subject, body, error, created_at";

async function emit(
  db: SupabaseClient, accountId: string, type: string, actorId: string, payload: object,
) {
  const { error } = await db.from("events").insert({
    account_id: accountId, type, actor_type: "user", actor_id: actorId, payload });
  if (error) throw new Error(`event emit failed: ${error.message}`);
}

export async function ensureConversation(
  db: SupabaseClient, accountId: string, contactId: string, actorId: string,
): Promise<{ id: string; created: boolean }> {
  const { data: existing, error: findErr } = await db.from("conversations")
    .select("id").eq("account_id", accountId).eq("contact_id", contactId).maybeSingle();
  if (findErr) throw new Error(`conversation lookup failed: ${findErr.message}`);
  if (existing) return { id: existing.id, created: false };

  // `conversations_account_contact_unique` makes this safe under concurrency:
  // two callers can both miss the lookup, and the loser's insert conflicts
  // rather than creating a duplicate thread.
  const { data, error } = await db.from("conversations")
    .upsert({ account_id: accountId, contact_id: contactId },
            { onConflict: "account_id,contact_id" })
    .select("id").single();
  if (error || !data) throw new Error(`ensureConversation failed: ${error?.message}`);

  await emit(db, accountId, "conversation.created", actorId,
    { conversationId: data.id, contactId });
  return { id: data.id, created: true };
}

export async function createMessage(
  db: SupabaseClient, accountId: string, input: NewMessage, actorId: string,
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

  const { error: touchErr } = await db.from("conversations")
    .update({ last_message_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq("account_id", accountId).eq("id", input.conversationId);
  if (touchErr) throw new Error(`conversation touch failed: ${touchErr.message}`);

  await emit(db, accountId, "message.created", actorId,
    { messageId: data.id, conversationId: input.conversationId, channel: input.channel });
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
    .update({ status, updated_at: new Date().toISOString() })
    .eq("provider_message_id", providerMessageId)
    .select("id, account_id").maybeSingle();
  if (error) throw new Error(`updateMessageStatusByProviderId failed: ${error.message}`);
  if (!data) return { updated: false };

  await emit(db, data.account_id, "message.status_changed", "system",
    { messageId: data.id, status, providerMessageId });
  return { updated: true };
}

export async function listConversations(
  db: SupabaseClient, accountId: string,
): Promise<ConversationSummary[]> {
  const { data, error } = await db.from("conversations")
    .select("id, contact_id, last_message_at, contacts(first_name, last_name)")
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
  }));
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
