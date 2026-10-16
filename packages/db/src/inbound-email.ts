import { randomBytes } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { emit } from "./events";
import { ensureConversation } from "./messaging";
import { emailKey } from "./contacts";

/**
 * Inbound email, part 1 (S-06; 0082). Reply tokens, the account's Replies mode, the inbound rows and
 * the sender match. Every write here is server-only (0053): callers pass the service client, after
 * their own proof on the request client where a person acted.
 */
export type InboundMode = "off" | "bis" | "own_domain";
export const INBOUND_MODES: readonly InboundMode[] = ["off", "bis", "own_domain"];
export const BIS_REPLY_DOMAIN = "reply.bis-rgv.com";
/** Twin of 0082's conversations_reply_token_check. */
export const REPLY_TOKEN_PATTERN = /^[0-9a-f]{24}$/;

export type InboundSettings = { mode: InboundMode; domain: string | null };

export function newReplyToken(): string {
  return randomBytes(12).toString("hex");
}

function isMode(v: unknown): v is InboundMode {
  return v === "off" || v === "bis" || v === "own_domain";
}

export async function getInboundSettings(db: SupabaseClient, accountId: string): Promise<InboundSettings> {
  const { data, error } = await db.from("accounts").select("inbound_mode, inbound_domain").eq("id", accountId).maybeSingle();
  if (error) throw new Error(`getInboundSettings failed: ${error.message}`);
  const row = data as { inbound_mode: unknown; inbound_domain: string | null } | null;
  return { mode: isMode(row?.inbound_mode) ? row!.inbound_mode as InboundMode : "off", domain: row?.inbound_domain ?? null };
}

/** SERVER ONLY, agency-gated at the call site (no column grant reaches it). */
export async function setInboundSettings(db: SupabaseClient, accountId: string, s: InboundSettings, actorId: string): Promise<void> {
  const { data, error } = await db.from("accounts")
    .update({ inbound_mode: s.mode, inbound_domain: s.domain }).eq("id", accountId).select("id");
  if (error) throw new Error(`setInboundSettings failed: ${error.message}`);
  if (!data?.length) throw new Error(`setInboundSettings: no account ${accountId}`);
  await emit(db, accountId, "account.inbound_replies_updated", actorId, { mode: s.mode, domain: s.domain });
}

/**
 * The thread's token, made on first need (the conversation too). A compare-and-set on
 * `reply_token is null`, so two senders racing both end with the one stored token.
 */
export async function ensureReplyToken(
  db: SupabaseClient, accountId: string, contactId: string, actorId: string, make: () => string = newReplyToken,
): Promise<{ conversationId: string; token: string }> {
  const { id: conversationId } = await ensureConversation(db, accountId, contactId, actorId, "system");
  const read = async () => {
    const { data, error } = await db.from("conversations").select("reply_token")
      .eq("account_id", accountId).eq("id", conversationId).single();
    if (error) throw new Error(`ensureReplyToken read failed: ${error.message}`);
    return (data as { reply_token: string | null }).reply_token;
  };
  const existing = await read();
  if (existing) return { conversationId, token: existing };
  const { error } = await db.from("conversations").update({ reply_token: make() })
    .eq("account_id", accountId).eq("id", conversationId).is("reply_token", null);
  if (error) throw new Error(`ensureReplyToken write failed: ${error.message}`);
  const stored = await read();
  if (!stored) throw new Error("ensureReplyToken: no token after the write");
  return { conversationId, token: stored };
}

export type ReplyThread = { conversationId: string; accountId: string; contactId: string; revoked: boolean; inboundDomain: string | null };

export async function findReplyThread(db: SupabaseClient, token: string): Promise<ReplyThread | null> {
  if (!REPLY_TOKEN_PATTERN.test(token)) return null;
  const { data, error } = await db.from("conversations")
    .select("id, account_id, contact_id, reply_token_revoked_at, accounts(inbound_domain)")
    .eq("reply_token", token).maybeSingle();
  if (error) throw new Error(`findReplyThread failed: ${error.message}`);
  if (!data) return null;
  const r = data as unknown as { id: string; account_id: string; contact_id: string; reply_token_revoked_at: string | null; accounts: { inbound_domain: string | null } | null };
  return { conversationId: r.id, accountId: r.account_id, contactId: r.contact_id, revoked: r.reply_token_revoked_at !== null, inboundDomain: r.accounts?.inbound_domain ?? null };
}

export type InboundStatus = "filed" | "held" | "dismissed";
export type HoldReason = "not_on_record" | "unverified";
export type InboundAuthRecord = { spf: string | null; dkim: string | null; dmarc: string | null; spam: string | null; virus: string | null };
export type InboundEmailRow = {
  id: string; accountId: string; conversationId: string; providerEmailId: string;
  fromEmail: string; fromName: string | null; toEmail: string; subject: string | null; text: string;
  auth: InboundAuthRecord; attachmentCount: number; status: InboundStatus; holdReason: HoldReason | null; messageId: string | null;
  decidedBy: string | null; decidedAt: string | null; receivedAt: string;
};
export type NewInboundEmail = Omit<InboundEmailRow, "id" | "messageId" | "decidedBy" | "decidedAt"> & { decidedBy: string | null };

const COLS = "id, account_id, conversation_id, provider_email_id, from_email, from_name, to_email, subject, text, auth, attachment_count, status, hold_reason, message_id, decided_by, decided_at, received_at";
type Raw = {
  id: string; account_id: string; conversation_id: string; provider_email_id: string; from_email: string; from_name: string | null;
  to_email: string; subject: string | null; text: string; auth: InboundAuthRecord; attachment_count: number; status: InboundStatus; hold_reason: HoldReason | null;
  message_id: string | null; decided_by: string | null; decided_at: string | null; received_at: string;
};
const toRow = (r: Raw): InboundEmailRow => ({
  id: r.id, accountId: r.account_id, conversationId: r.conversation_id, providerEmailId: r.provider_email_id,
  fromEmail: r.from_email, fromName: r.from_name, toEmail: r.to_email, subject: r.subject, text: r.text, auth: r.auth, attachmentCount: r.attachment_count,
  status: r.status, holdReason: r.hold_reason, messageId: r.message_id, decidedBy: r.decided_by, decidedAt: r.decided_at,
  // Normalised so a row read back equals the row first answered (PostgREST spells timestamptz its own way).
  receivedAt: new Date(r.received_at).toISOString(),
});

/** Inserts; a second delivery of the same Resend id answers the stored row with created false. */
export async function recordInboundEmail(db: SupabaseClient, row: NewInboundEmail): Promise<{ row: InboundEmailRow; created: boolean }> {
  const { data, error } = await db.from("inbound_emails").insert({
    account_id: row.accountId, conversation_id: row.conversationId, provider_email_id: row.providerEmailId,
    from_email: row.fromEmail, from_name: row.fromName, to_email: row.toEmail, subject: row.subject,
    text: row.text.slice(0, 100000), auth: row.auth, attachment_count: row.attachmentCount, status: row.status, hold_reason: row.holdReason,
    decided_by: row.decidedBy, decided_at: row.decidedBy ? new Date().toISOString() : null, received_at: row.receivedAt,
  }).select(COLS).single();
  if (!error && data) return { row: toRow(data as Raw), created: true };
  if (error?.code !== "23505") throw new Error(`recordInboundEmail failed: ${error?.message}`);
  const { data: again, error: e2 } = await db.from("inbound_emails").select(COLS).eq("provider_email_id", row.providerEmailId).single();
  if (e2 || !again) throw new Error(`recordInboundEmail re-read failed: ${e2?.message}`);
  return { row: toRow(again as Raw), created: false };
}

export async function getInboundEmail(db: SupabaseClient, accountId: string, id: string): Promise<InboundEmailRow | null> {
  const { data, error } = await db.from("inbound_emails").select(COLS).eq("account_id", accountId).eq("id", id).maybeSingle();
  if (error) throw new Error(`getInboundEmail failed: ${error.message}`);
  return data ? toRow(data as Raw) : null;
}

/** Points a filed row at its message, once (message_id is null). */
export async function setInboundMessage(db: SupabaseClient, accountId: string, id: string, messageId: string): Promise<boolean> {
  const { data, error } = await db.from("inbound_emails").update({ message_id: messageId })
    .eq("account_id", accountId).eq("id", id).is("message_id", null).select("id");
  if (error) throw new Error(`setInboundMessage failed: ${error.message}`);
  return (data?.length ?? 0) > 0;
}

/** A compare-and-set on the status the caller saw; false when someone moved it first. */
export async function decideInboundEmail(
  db: SupabaseClient, accountId: string, id: string, from: InboundStatus,
  to: { status: InboundStatus; messageId?: string | null; decidedBy: string | null },
): Promise<boolean> {
  const { data, error } = await db.from("inbound_emails").update({
    status: to.status,
    ...(to.messageId !== undefined ? { message_id: to.messageId } : {}),
    decided_by: to.decidedBy, decided_at: to.decidedBy ? new Date().toISOString() : null,
  }).eq("account_id", accountId).eq("id", id).eq("status", from).select("id");
  if (error) throw new Error(`decideInboundEmail failed: ${error.message}`);
  return (data?.length ?? 0) > 0;
}

/** The Undo of a manual File (0082's unfile_inbound_email: the row back to held, the message deleted). */
export async function unfileInboundEmail(db: SupabaseClient, accountId: string, id: string, messageId: string): Promise<boolean> {
  const { data, error } = await db.rpc("unfile_inbound_email", { p_account_id: accountId, p_id: id, p_message_id: messageId });
  if (error) throw new Error(`unfileInboundEmail failed: ${error.message}`);
  return data === true;
}

export type HeldInboundEmail = InboundEmailRow & { contactId: string; contactFirstName: string | null; contactLastName: string | null };

export async function listHeldInboundEmails(db: SupabaseClient, accountId: string, opts: { limit?: number } = {}): Promise<HeldInboundEmail[]> {
  const { data, error } = await db.from("inbound_emails")
    .select(`${COLS}, conversations!inbound_emails_conversation_fkey(contact_id, contacts(first_name, last_name))`)
    .eq("account_id", accountId).eq("status", "held")
    .order("received_at", { ascending: false }).order("id", { ascending: false })
    .limit(opts.limit ?? 50);
  if (error) throw new Error(`listHeldInboundEmails failed: ${error.message}`);
  return ((data ?? []) as unknown as (Raw & { conversations: { contact_id: string; contacts: { first_name: string | null; last_name: string | null } | null } })[]).map((r) => ({
    ...toRow(r), contactId: r.conversations.contact_id,
    contactFirstName: r.conversations.contacts?.first_name ?? null, contactLastName: r.conversations.contacts?.last_name ?? null,
  }));
}

/** THROWS on a null count (memory "head-count null": a failed head read can answer count null, error null). */
export async function countHeldInboundEmails(db: SupabaseClient, accountId: string): Promise<number> {
  const { count, error } = await db.from("inbound_emails").select("id", { count: "exact", head: true })
    .eq("account_id", accountId).eq("status", "held");
  if (error) throw new Error(`countHeldInboundEmails failed: ${error.message}`);
  if (count === null) throw new Error("countHeldInboundEmails: no count");
  return count;
}

export type SenderMatch = { contactId: string; firstName: string | null; lastName: string | null; viaGroup: boolean };

/** The thread's contact first; else a member of any household or business that contact belongs to. */
export async function matchSender(db: SupabaseClient, accountId: string, contactId: string, fromEmail: string): Promise<SenderMatch | null> {
  const key = emailKey(fromEmail);
  if (!key) return null;
  const { data: me, error } = await db.from("contacts").select("id, first_name, last_name, email_key")
    .eq("account_id", accountId).eq("id", contactId).maybeSingle();
  if (error) throw new Error(`matchSender contact read failed: ${error.message}`);
  const self = me as { id: string; first_name: string | null; last_name: string | null; email_key: string | null } | null;
  if (self?.email_key === key) return { contactId: self.id, firstName: self.first_name, lastName: self.last_name, viaGroup: false };
  const { data: groups, error: gErr } = await db.from("client_group_members").select("client_group_id")
    .eq("account_id", accountId).eq("contact_id", contactId);
  if (gErr) throw new Error(`matchSender groups read failed: ${gErr.message}`);
  const groupIds = ((groups ?? []) as { client_group_id: string }[]).map((g) => g.client_group_id);
  if (groupIds.length === 0) return null;
  const { data: members, error: mErr } = await db.from("client_group_members")
    .select("contact_id, contacts!inner(first_name, last_name, email_key)")
    .eq("account_id", accountId).in("client_group_id", groupIds).eq("contacts.email_key", key)
    .order("contact_id").limit(1);
  if (mErr) throw new Error(`matchSender members read failed: ${mErr.message}`);
  const hit = ((members ?? []) as unknown as { contact_id: string; contacts: { first_name: string | null; last_name: string | null } }[])[0];
  return hit ? { contactId: hit.contact_id, firstName: hit.contacts.first_name, lastName: hit.contacts.last_name, viaGroup: true } : null;
}
