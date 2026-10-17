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
/** Fix round 3 item 3 (S-06 part 1): the one stable marker a caller matches to tell
 *  `recordInboundEmail`'s cross-account race apart from every other failure — never the surrounding
 *  prose, which is free to change. */
export const INBOUND_EMAIL_COLLISION = "INBOUND_EMAIL_COLLISION";

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

/** Bounded: a revoke landing between this function's own write and its final read-back (another
 *  actor revoking the token this call just won) is vanishingly rare, but an unbounded retry loop
 *  would be a real hang if it somehow kept happening — 3 rounds, then throw rather than loop forever
 *  or hand back a token this function itself knows is already dead. */
const ENSURE_REPLY_TOKEN_MAX_ROUNDS = 3;

/**
 * The thread's token, made on first need (the conversation too). A compare-and-set on
 * `reply_token is null`, so two senders racing both end with the one stored token.
 *
 * A REVOKED token is never handed out again (owner ruling 2026-10-16): new mail must never advertise
 * a dead reply address, so a revoked token is rotated — a fresh token written and
 * `reply_token_revoked_at` cleared, race-safe the same way (compare-and-set on the exact revoked
 * token this caller saw, so only one of several concurrent rotators wins and the rest just re-read).
 */
export async function ensureReplyToken(
  db: SupabaseClient, accountId: string, contactId: string, actorId: string, make: () => string = newReplyToken,
): Promise<{ conversationId: string; token: string }> {
  const { id: conversationId } = await ensureConversation(db, accountId, contactId, actorId, "system");
  const read = async () => {
    const { data, error } = await db.from("conversations").select("reply_token, reply_token_revoked_at")
      .eq("account_id", accountId).eq("id", conversationId).single();
    if (error) throw new Error(`ensureReplyToken read failed: ${error.message}`);
    const r = data as { reply_token: string | null; reply_token_revoked_at: string | null };
    return { token: r.reply_token, revoked: r.reply_token_revoked_at !== null };
  };

  let current = await read();
  for (let round = 0; round < ENSURE_REPLY_TOKEN_MAX_ROUNDS; round++) {
    if (current.token && !current.revoked) return { conversationId, token: current.token };

    const cas = current.token === null
      ? db.from("conversations").update({ reply_token: make() })
          .eq("account_id", accountId).eq("id", conversationId).is("reply_token", null)
      : db.from("conversations").update({ reply_token: make(), reply_token_revoked_at: null })
          .eq("account_id", accountId).eq("id", conversationId).eq("reply_token", current.token);
    const { error } = await cas;
    if (error) throw new Error(`ensureReplyToken write failed: ${error.message}`);
    current = await read();
    if (!current.token) throw new Error("ensureReplyToken: no token after the write");
    // current.revoked here means someone revoked the winning token between our write and this read
    // (or between another rotator's write and OUR read) — loop once more rather than hand back a
    // token this call already knows is dead. The loop's own top-of-body check (above) covers rounds
    // 0..MAX-2; the check below covers the LAST round's read too — without it, a token that turned
    // live on exactly this final read was thrown away instead of returned (budget-2 case).
  }
  if (current.token && !current.revoked) return { conversationId, token: current.token };
  throw new Error(`ensureReplyToken: still revoked after ${ENSURE_REPLY_TOKEN_MAX_ROUNDS} rounds`);
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
    // Truncated by CODE POINT, not UTF-16 code unit: a plain `.slice` can split a surrogate pair (an
    // astral emoji, say) in two, leaving a lone surrogate that PostgREST/Postgres reject outright
    // ("Empty or invalid json") — the reply is then lost on every retry, not merely over-truncated.
    text: Array.from(row.text).slice(0, 100000).join(""),
    auth: row.auth, attachment_count: row.attachmentCount, status: row.status, hold_reason: row.holdReason,
    decided_by: row.decidedBy, decided_at: row.decidedBy !== null ? new Date().toISOString() : null, received_at: row.receivedAt,
  }).select(COLS).single();
  if (!error && data) return { row: toRow(data as Raw), created: true };
  if (error?.code !== "23505") throw new Error(`recordInboundEmail failed: ${error?.message}`);
  // provider_email_id is unique ACROSS every account, not just this one — a 23505 proves some row
  // already holds this id, never which account it belongs to. Re-read scoped to THIS account: a row
  // under a different account is never a duplicate of this one, so answer it as a hard failure rather
  // than handing account B account A's row back as its own "duplicate, created false".
  const { data: again, error: e2 } = await db.from("inbound_emails").select(COLS)
    .eq("account_id", row.accountId).eq("provider_email_id", row.providerEmailId).maybeSingle();
  if (e2) throw new Error(`recordInboundEmail re-read failed: ${e2.message}`);
  if (!again) throw new Error(`recordInboundEmail: ${INBOUND_EMAIL_COLLISION} (provider_email_id ${row.providerEmailId} outside account ${row.accountId})`);
  return { row: toRow(again as Raw), created: false };
}

export async function getInboundEmail(db: SupabaseClient, accountId: string, id: string): Promise<InboundEmailRow | null> {
  const { data, error } = await db.from("inbound_emails").select(COLS).eq("account_id", accountId).eq("id", id).maybeSingle();
  if (error) throw new Error(`getInboundEmail failed: ${error.message}`);
  return data ? toRow(data as Raw) : null;
}

/**
 * Account-agnostic lookup by the globally-unique `provider_email_id` (`inbound_emails_provider_email_id_key`).
 * SERVICE CLIENT USE ONLY — there is no account scope to this read, so callers MUST compare
 * `row.accountId` themselves against whatever account they believe they are acting on before trusting
 * anything else about the row (same shape as `recordInboundEmail`'s own 23505 re-read, which is scoped;
 * this one deliberately is not, because its whole purpose is finding a row when the caller does not yet
 * know, or cannot trust, which account it belongs to).
 */
export async function findInboundEmailByProviderId(db: SupabaseClient, providerEmailId: string): Promise<InboundEmailRow | null> {
  const { data, error } = await db.from("inbound_emails").select(COLS).eq("provider_email_id", providerEmailId).maybeSingle();
  if (error) throw new Error(`findInboundEmailByProviderId failed: ${error.message}`);
  return data ? toRow(data as Raw) : null;
}

/** Points a filed row at its message, once (message_id is null). */
export async function setInboundMessage(db: SupabaseClient, accountId: string, id: string, messageId: string): Promise<boolean> {
  const { data, error } = await db.from("inbound_emails").update({ message_id: messageId })
    .eq("account_id", accountId).eq("id", id).is("message_id", null).select("id");
  if (error) throw new Error(`setInboundMessage failed: ${error.message}`);
  return (data?.length ?? 0) > 0;
}

/**
 * A compare-and-set on the status the caller saw; false when someone moved it first.
 *
 * `conversationId` (Task 12 fix round 1, item 4 — "Choose a record"): optional, and written in this
 * SAME update when given, never a second write — the row's thread reassignment and its held→filed
 * transition are one atomic compare-and-set, scoped by the same account+id+expected-status WHERE
 * clause as everything else here, so a row someone else already moved can never have its thread
 * silently reassigned underneath that other write.
 */
export async function decideInboundEmail(
  db: SupabaseClient, accountId: string, id: string, from: InboundStatus,
  to: { status: InboundStatus; messageId?: string | null; decidedBy: string | null; conversationId?: string },
): Promise<boolean> {
  const { data, error } = await db.from("inbound_emails").update({
    status: to.status,
    ...(to.messageId !== undefined ? { message_id: to.messageId } : {}),
    ...(to.conversationId !== undefined ? { conversation_id: to.conversationId } : {}),
    decided_by: to.decidedBy, decided_at: to.decidedBy !== null ? new Date().toISOString() : null,
  }).eq("account_id", accountId).eq("id", id).eq("status", from).select("id");
  if (error) throw new Error(`decideInboundEmail failed: ${error.message}`);
  return (data?.length ?? 0) > 0;
}

/**
 * Rollback for a manual File that failed partway (Task 12 fix round 1, item 2): removes any message
 * row left behind for THIS row's own provider id, scoped to the account, so a failed File never
 * leaves a dangling message when the row returns to held. Returns whether a row was actually
 * removed — false is the ordinary case (the ledger write itself is what failed, before any message
 * ever existed), not a diagnostic in itself.
 *
 * `channel`/`direction` (fix round 2 minor): `provider_message_id` is reused across channels and
 * directions on `messages` (sms's own inbound writer sets it too; an outbound send's provider id is
 * a different provider's value, but nothing stops it colliding in theory) — this rollback only ever
 * means "the inbound email THIS row created," so it is scoped to exactly that shape, never anything
 * else that happens to carry the same provider id.
 */
export async function deleteInboundMessageByProviderId(db: SupabaseClient, accountId: string, providerEmailId: string): Promise<boolean> {
  const { data, error } = await db.from("messages").delete()
    .eq("account_id", accountId).eq("provider_message_id", providerEmailId)
    .eq("channel", "email").eq("direction", "inbound").select("id");
  if (error) throw new Error(`deleteInboundMessageByProviderId failed: ${error.message}`);
  return (data?.length ?? 0) > 0;
}

/** The Undo of a manual File (0082's unfile_inbound_email: the row back to held, the message deleted). */
export async function unfileInboundEmail(db: SupabaseClient, accountId: string, id: string, messageId: string): Promise<boolean> {
  const { data, error } = await db.rpc("unfile_inbound_email", { p_account_id: accountId, p_id: id, p_message_id: messageId });
  if (error) throw new Error(`unfileInboundEmail failed: ${error.message}`);
  if (data !== true) return false;

  // The RPC deletes the message but has no reason to know about the conversation's own
  // last_message_at — it is left pointing at a message that no longer exists (fix round 3): a thread
  // this leaves with NO message would otherwise still carry a stale last_message_at (and
  // listConversations's own message-existence filter already keeps it off the list regardless; this
  // is about PREVIEW/SORT honesty for every thread, not just the now-empty ones). Reset to the newest
  // REMAINING message's created_at, or null if none remain, compare-and-set like discardQueuedNotice
  // (booking.ts ~576-597): a message landing on this thread between the RPC and this read must never
  // be overwritten backwards. Best-effort and logged, not thrown — the Undo itself already succeeded
  // (the row is back to held and the message is gone), and a stale sort/preview self-heals on the
  // thread's next message.
  const { data: inboundRow, error: rowErr } = await db.from("inbound_emails").select("conversation_id")
    .eq("account_id", accountId).eq("id", id).maybeSingle();
  if (rowErr || !inboundRow) {
    console.error(`unfileInboundEmail: conversation sort time not reset (row read failed): ${rowErr?.message ?? "row missing"}`);
    return true;
  }
  const conversationId = (inboundRow as { conversation_id: string }).conversation_id;
  const { data: conv, error: convErr } = await db.from("conversations").select("last_message_at")
    .eq("account_id", accountId).eq("id", conversationId).maybeSingle();
  if (convErr || !conv) {
    console.error(`unfileInboundEmail: conversation ${conversationId} sort time not reset: ${convErr?.message ?? "conversation missing"}`);
    return true;
  }
  const seen = (conv as { last_message_at: string | null }).last_message_at;
  const { data: newest, error: newestErr } = await db.from("messages").select("created_at")
    .eq("account_id", accountId).eq("conversation_id", conversationId)
    .order("created_at", { ascending: false }).limit(1);
  if (newestErr) {
    console.error(`unfileInboundEmail: conversation ${conversationId} sort time not reset: ${newestErr.message}`);
    return true;
  }
  let resetQ = db.from("conversations")
    .update({ last_message_at: ((newest ?? []) as { created_at: string }[])[0]?.created_at ?? null })
    .eq("account_id", accountId).eq("id", conversationId);
  resetQ = seen === null ? resetQ.is("last_message_at", null) : resetQ.eq("last_message_at", seen);
  const { error: resetErr } = await resetQ;
  if (resetErr) {
    console.error(`unfileInboundEmail: conversation ${conversationId} sort time not reset: ${resetErr.message}`);
  }
  return true;
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

/** S-06 part 2 (spec §3; G1 as ruled 2026-10-17, G2): the team is the account's members (any role) and
 *  its reply-to mailbox, by email key. BIS agency staff are NOT the team. userId is the Clerk id every
 *  person column stores. */
export type TeamSender = { userId: string } | { mailbox: true };

export async function matchTeamSender(db: SupabaseClient, accountId: string, fromEmail: string): Promise<TeamSender | null> {
  const key = emailKey(fromEmail);
  if (!key || !key.includes("@")) return null;
  const { data, error } = await db.from("memberships").select("users!inner(clerk_user_id, email)")
    .eq("scope", "account").eq("account_id", accountId);
  if (error) throw new Error(`matchTeamSender members read failed: ${error.message}`);
  const hit = ((data ?? []) as unknown as { users: { clerk_user_id: string; email: string } }[])
    .filter((r) => emailKey(r.users.email) === key).map((r) => r.users.clerk_user_id).sort()[0];
  if (hit) return { userId: hit };
  const { data: acct, error: aErr } = await db.from("accounts").select("reply_to_email").eq("id", accountId).maybeSingle();
  if (aErr) throw new Error(`matchTeamSender mailbox read failed: ${aErr.message}`);
  const mailbox = (acct as { reply_to_email: string | null } | null)?.reply_to_email ?? null;
  return mailbox && emailKey(mailbox) === key ? { mailbox: true } : null;
}
