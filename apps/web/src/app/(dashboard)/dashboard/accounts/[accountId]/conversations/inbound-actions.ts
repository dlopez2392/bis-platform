"use server";

import { revalidatePath } from "next/cache";
import {
  readConsentHistory, newestDecidingRow, listMessages, type SupabaseClient,
  getInboundEmail, decideInboundEmail, unfileInboundEmail, matchSender, ensureConversation, getContact, serviceDb,
} from "@bis/db";
import { requireAccountAccess } from "@/lib/auth";
import { dbForRequest } from "@/lib/db";
import { emailContextFor } from "@/lib/consent/email-context";
import { undoInboundStop, stopEmails } from "@/lib/consent/email-staff-actions";
import { fileInboundEmail } from "@/lib/email/inbound/file";
import { m } from "@/lib/messages";

/**
 * The thread's inbound-email actions (S-06 part 1). Every one proves the CONVERSATION on the request
 * client first (0053/0068: a Technician sees only their own customers' threads), THEN binds whatever
 * id the browser sent (an event id, a contact id) to a message actually ON that proven thread — never
 * trusting the browser's own claim of whose stop or whose address it is. Only once the target contact
 * is bound this way does emailContextFor (itself a request-client proof) build the service-client
 * context the ledger write runs through. Review fix (Task 11 review, round 1): the first version of
 * this file proved the THREAD but then discarded that proof's contact and read the stop's contact
 * straight off a service-client read of consent_events — a browser-supplied eventId naming ANY
 * account row, not necessarily one that ever reached this thread.
 */
export type ReplyActionResult = { ok: true } | { ok: false; error: string; expired?: true };

type MessageMeta = { sender?: { contact_id?: string }; consent?: { kind: string; eventId?: string } };

/** True only for an inbound email message that actually landed on this thread (file.ts's own shape:
 *  meta.sender is set only when the sender was a household/business member, meta.consent.eventId only
 *  when the stop was recorded). A message with neither still proves nothing either function needs. */
function metaOf(msg: { channel: string; direction: string; meta: unknown }): MessageMeta | null {
  return msg.channel === "email" && msg.direction === "inbound" ? ((msg.meta as MessageMeta | null) ?? {}) : null;
}

async function provedThread(accountId: string, conversationId: string): Promise<{ db: SupabaseClient; contactId: string } | null> {
  const db = await dbForRequest();
  const { data, error } = await db.from("conversations").select("id, contact_id").eq("account_id", accountId).eq("id", conversationId).maybeSingle();
  if (error || !data) return null;
  return { db, contactId: (data as { contact_id: string }).contact_id };
}

export async function undoReplyStopAction(accountId: string, conversationId: string, eventId: string): Promise<ReplyActionResult> {
  const { userId } = await requireAccountAccess(accountId);
  const thread = await provedThread(accountId, conversationId);
  if (!thread) return { ok: false, error: m["conversations.held.changed"] };
  // The browser sent an eventId; prove it names a stop recorded on THIS thread before anyone acts on
  // it, and take the stop's own contact (a household member's, when the reply came from one) rather
  // than the thread's own contact, which may be someone else's address entirely.
  const messages = await listMessages(thread.db, accountId, conversationId);
  const owning = messages.find((msg) => metaOf(msg)?.consent?.kind === "stopped" && metaOf(msg)?.consent?.eventId === eventId);
  if (!owning) return { ok: false, error: m["conversations.held.changed"] };
  const targetContactId = metaOf(owning)?.sender?.contact_id ?? thread.contactId;
  const ctx = await emailContextFor(accountId, targetContactId, userId);
  if ("ok" in ctx) return { ok: false, error: ctx.error };
  const r = await undoInboundStop(ctx, eventId);
  revalidatePath(`/dashboard/accounts/${accountId}/conversations`);
  revalidatePath(`/dashboard/accounts/${accountId}/contacts/${targetContactId}`);
  // The 7-day-window refusal is a typed field on EmailActionResult (Task 5), never a string the
  // caller re-derives: passed through only when undoInboundStop itself set it.
  return r.ok ? { ok: true } : { ok: false, error: r.error, ...(r.expired ? { expired: true as const } : {}) };
}

export async function stopEmailsFromReplyAction(accountId: string, conversationId: string, contactId: string): Promise<ReplyActionResult> {
  const { userId } = await requireAccountAccess(accountId);
  const thread = await provedThread(accountId, conversationId);
  if (!thread) return { ok: false, error: m["conversations.held.changed"] };
  // The chip's "Stop emails" sends whichever contactId the bubble rendered for (the thread's own
  // contact, or a household member's when that message carried one) — prove it is actually one of
  // those two before building a context for it, rather than trusting the browser's own claim.
  if (contactId !== thread.contactId) {
    const messages = await listMessages(thread.db, accountId, conversationId);
    const onThread = messages.some((msg) => metaOf(msg)?.sender?.contact_id === contactId);
    if (!onThread) return { ok: false, error: m["conversations.held.changed"] };
  }
  const ctx = await emailContextFor(accountId, contactId, userId);
  if ("ok" in ctx) return { ok: false, error: ctx.error };
  const newest = newestDecidingRow(await readConsentHistory(ctx.writer, accountId, "email", ctx.address));
  const r = await stopEmails(ctx, newest?.id ?? null);
  revalidatePath(`/dashboard/accounts/${accountId}/conversations`);
  revalidatePath(`/dashboard/accounts/${accountId}/contacts/${contactId}`);
  return r.ok ? { ok: true } : { ok: false, error: r.error };
}

/**
 * "Needs a look" (Task 12): File on <customer>, Choose a record, Not a customer, each with Undo
 * (spec G13 — a one-transaction Undo for a manual File). Every action proves the held row on the
 * REQUEST client first (0082's RLS: a Technician sees only their own customers' threads), then
 * writes through the service client (0053) only against the id that row itself named — never a
 * browser-supplied id trusted on its own.
 */
export type HeldUndo = { kind: "unfile"; id: string; messageId: string } | { kind: "undismiss"; id: string };
export type HeldActionResult = { ok: true; undo: HeldUndo } | { ok: false; error: "changed" | "failed" };

/** The held row, proven on the request client, plus its thread's own contact (the suggestion). */
async function provedRow(accountId: string, id: string) {
  const db = await dbForRequest();
  const row = await getInboundEmail(db, accountId, id);
  if (!row) return null;
  const { data } = await db.from("conversations").select("contact_id").eq("account_id", accountId).eq("id", row.conversationId).maybeSingle();
  if (!data) return null;
  return { db, row, suggestion: (data as { contact_id: string }).contact_id };
}

export async function fileHeldEmailAction(accountId: string, id: string, contactId: string | null): Promise<HeldActionResult> {
  const { userId } = await requireAccountAccess(accountId);
  const p = await provedRow(accountId, id);
  if (!p || p.row.status !== "held") return { ok: false, error: "changed" };
  const target = contactId ?? p.suggestion;
  let conversationId = p.row.conversationId;
  if (target !== p.suggestion) {
    if (!(await getContact(p.db, accountId, target))) return { ok: false, error: "changed" };
    conversationId = (await ensureConversation(serviceDb(), accountId, target, userId)).id;
  }
  const svc = serviceDb();
  if (!(await decideInboundEmail(svc, accountId, id, "held", { status: "filed", decidedBy: userId }))) return { ok: false, error: "changed" };
  try {
    const sender = await matchSender(svc, accountId, target, p.row.fromEmail);
    const r = await fileInboundEmail({ db: svc, now: () => new Date() }, {
      row: { ...p.row, status: "filed", conversationId }, contactId: target, sender, attachmentCount: p.row.attachmentCount,
      raiseUnread: false, actor: { id: userId, type: "user" },
    });
    revalidatePath(`/dashboard/accounts/${accountId}/conversations`);
    return { ok: true, undo: { kind: "unfile", id, messageId: r.messageId } };
  } catch (e) {
    console.error(`fileHeldEmailAction: account ${accountId} row ${id}: ${e instanceof Error ? e.name : typeof e}`);
    await decideInboundEmail(svc, accountId, id, "filed", { status: "held", messageId: null, decidedBy: null }).catch(() => false);
    return { ok: false, error: "failed" };
  }
}

export async function dismissHeldEmailAction(accountId: string, id: string): Promise<HeldActionResult> {
  const { userId } = await requireAccountAccess(accountId);
  const p = await provedRow(accountId, id);
  if (!p || p.row.status !== "held") return { ok: false, error: "changed" };
  if (!(await decideInboundEmail(serviceDb(), accountId, id, "held", { status: "dismissed", decidedBy: userId }))) return { ok: false, error: "changed" };
  revalidatePath(`/dashboard/accounts/${accountId}/conversations`);
  return { ok: true, undo: { kind: "undismiss", id } };
}

export async function undoHeldEmailAction(accountId: string, undo: HeldUndo): Promise<{ ok: boolean }> {
  await requireAccountAccess(accountId);
  const p = await provedRow(accountId, undo.id);
  if (!p) return { ok: false };
  const ok = undo.kind === "unfile"
    ? p.row.status === "filed" && await unfileInboundEmail(serviceDb(), accountId, undo.id, undo.messageId)
    : p.row.status === "dismissed" && await decideInboundEmail(serviceDb(), accountId, undo.id, "dismissed", { status: "held", decidedBy: null });
  revalidatePath(`/dashboard/accounts/${accountId}/conversations`);
  return { ok };
}
