"use server";

import { revalidatePath } from "next/cache";
import {
  readConsentHistory, newestDecidingRow, listMessages, type SupabaseClient,
  getInboundEmail, decideInboundEmail, unfileInboundEmail, matchSender, ensureConversation, getContact, serviceDb,
  deleteInboundMessageByProviderId,
} from "@bis/db";
import { requireAccountAccess } from "@/lib/auth";
import { dbForRequest } from "@/lib/db";
import { emailContextFor } from "@/lib/consent/email-context";
import { undoInboundStop, stopEmails } from "@/lib/consent/email-staff-actions";
import { fileInboundEmail } from "@/lib/email/inbound/file";
import { m } from "@/lib/messages";
import { t } from "@/lib/i18n/t";
import type { Locale } from "@/lib/i18n/locale";

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

export async function undoReplyStopAction(accountId: string, locale: Locale, conversationId: string, eventId: string): Promise<ReplyActionResult> {
  const { userId } = await requireAccountAccess(accountId);
  const thread = await provedThread(accountId, conversationId);
  if (!thread) return { ok: false, error: t(m, "conversations.held.changed", locale) };
  // The browser sent an eventId; prove it names a stop recorded on THIS thread before anyone acts on
  // it, and take the stop's own contact (a household member's, when the reply came from one) rather
  // than the thread's own contact, which may be someone else's address entirely.
  const messages = await listMessages(thread.db, accountId, conversationId);
  const owning = messages.find((msg) => metaOf(msg)?.consent?.kind === "stopped" && metaOf(msg)?.consent?.eventId === eventId);
  if (!owning) return { ok: false, error: t(m, "conversations.held.changed", locale) };
  const targetContactId = metaOf(owning)?.sender?.contact_id ?? thread.contactId;
  // S-10 T9a: the caller's own reader locale (the inbox bubble's `locale` prop), passed through to
  // emailContextFor so every error consent/email-staff-actions.ts builds with it (including
  // undoInboundStop's replyExpiredExplain) is ALREADY in the reader's language by the time it
  // reaches the client — never the explicit "en" this action used before this screen resolved one.
  const ctx = await emailContextFor(accountId, targetContactId, userId, locale);
  if ("ok" in ctx) return { ok: false, error: ctx.error };
  const r = await undoInboundStop(ctx, eventId);
  revalidatePath(`/dashboard/accounts/${accountId}/conversations`);
  revalidatePath(`/dashboard/accounts/${accountId}/contacts/${targetContactId}`);
  // The 7-day-window refusal is a typed field on EmailActionResult (Task 5), never a string the
  // caller re-derives: passed through only when undoInboundStop itself set it.
  return r.ok ? { ok: true } : { ok: false, error: r.error, ...(r.expired ? { expired: true as const } : {}) };
}

export async function stopEmailsFromReplyAction(accountId: string, locale: Locale, conversationId: string, contactId: string): Promise<ReplyActionResult> {
  const { userId } = await requireAccountAccess(accountId);
  const thread = await provedThread(accountId, conversationId);
  if (!thread) return { ok: false, error: t(m, "conversations.held.changed", locale) };
  // The chip's "Stop emails" sends whichever contactId the bubble rendered for (the thread's own
  // contact, or a household member's when that message carried one) — prove it is actually one of
  // those two before building a context for it, rather than trusting the browser's own claim.
  if (contactId !== thread.contactId) {
    const messages = await listMessages(thread.db, accountId, conversationId);
    const onThread = messages.some((msg) => metaOf(msg)?.sender?.contact_id === contactId);
    if (!onThread) return { ok: false, error: t(m, "conversations.held.changed", locale) };
  }
  // S-10 T9a: the caller's own reader locale, same fix as undoReplyStopAction above.
  const ctx = await emailContextFor(accountId, contactId, userId, locale);
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
 * REQUEST client first (0082's RLS: a Technician sees only their own customers' threads) — and,
 * when "Choose a record" names a DIFFERENT contact than the row's own thread, proves that contact
 * too (`getContact` on the SAME request client, never the service client: a Technician must not be
 * able to file onto a customer they cannot otherwise see) — then writes through the service client
 * (0053) only against the id that row itself named, never a browser-supplied id trusted on its own.
 * Fix round 1 (review): every action body now runs inside its own try/catch — a throw from
 * anywhere in that body (a malformed id, an outage) answers the same typed `"failed"` the filing
 * rollback already used, rather than an unhandled rejection the UI cannot show a toast for.
 */
export type HeldUndo = { kind: "unfile"; id: string; messageId: string; eventId?: string } | { kind: "undismiss"; id: string };
export type HeldActionResult = { ok: true; undo: HeldUndo } | { ok: false; error: "changed" | "failed" };
/** Fix round 1 item 1: Undo of a File can need to reverse the stop that File itself recorded. A
 *  refused reversal (expired, or changed since) still unfiles — the File is undone either way — but
 *  is reported via `stopNotReversed` so the UI can say so, rather than claiming a clean undo. */
export type HeldUndoResult = { ok: true; stopNotReversed?: string } | { ok: false };

/** The held row, proven on the request client, plus its thread's own contact (the suggestion).
 *  Fix round 1 (minor): the conversation read's own `error` is now checked — an outage here must
 *  throw (and be reported as "failed" by the caller's wrapping try/catch), not be read as "changed"
 *  the way a genuine miss is. */
async function provedRow(accountId: string, id: string) {
  const db = await dbForRequest();
  const row = await getInboundEmail(db, accountId, id);
  if (!row) return null;
  const { data, error } = await db.from("conversations").select("contact_id").eq("account_id", accountId).eq("id", row.conversationId).maybeSingle();
  if (error) throw new Error(`provedRow: conversation read failed: ${error.message}`);
  if (!data) return null;
  return { db, row, suggestion: (data as { contact_id: string }).contact_id };
}

export async function fileHeldEmailAction(accountId: string, id: string, contactId: string | null): Promise<HeldActionResult> {
  const { userId } = await requireAccountAccess(accountId);
  try {
    const p = await provedRow(accountId, id);
    if (!p || p.row.status !== "held") return { ok: false, error: "changed" };
    const target = contactId ?? p.suggestion;
    const moving = target !== p.suggestion;
    // Proven on the REQUEST client, same as the row itself: a Technician filing onto a different
    // contact must still only be able to name one they can otherwise see.
    if (moving && !(await getContact(p.db, accountId, target))) return { ok: false, error: "changed" };
    const svc = serviceDb();
    let conversationId = p.row.conversationId;
    // Fix round 2 item 1: the rollback below (deleting a message, putting the row back to held)
    // must run ONLY when THIS call's own compare-and-set actually claimed the row — never when
    // something upstream of it (ensureConversation, or the CAS call itself) threw. `claimed` is set
    // the instant decideInboundEmail returns true and never before, so a throw before that point
    // leaves the row exactly as provedRow found it: still "held", nothing to roll back.
    let claimed = false;
    try {
      // Fix round 1 item 4 ("Choose a record"): the row's own conversation_id moves to the chosen
      // contact's thread in the SAME compare-and-set that files it (decideInboundEmail's own
      // account+id+expected-status WHERE clause), so Undo (unfileInboundEmail) later resets THIS
      // thread's last_message_at, never the original one the row no longer belongs to.
      if (moving) conversationId = (await ensureConversation(svc, accountId, target, userId)).id;
      if (!(await decideInboundEmail(svc, accountId, id, "held", {
        status: "filed", decidedBy: userId, ...(moving ? { conversationId } : {}),
      }))) return { ok: false, error: "changed" };
      claimed = true;
      const sender = await matchSender(svc, accountId, target, p.row.fromEmail);
      const r = await fileInboundEmail({ db: svc, now: () => new Date() }, {
        row: { ...p.row, status: "filed", conversationId }, contactId: target, sender, attachmentCount: p.row.attachmentCount,
        raiseUnread: false, actor: { id: userId, type: "user" },
      });
      revalidatePath(`/dashboard/accounts/${accountId}/conversations`);
      if (r.consent.kind === "stopped") revalidatePath(`/dashboard/accounts/${accountId}/contacts/${target}`);
      // r.created distinguishes fileInboundEmail's own compare-and-set winner from its loser — a
      // race that can only exist between two CONCURRENT deliveries of the same unlinked row
      // (file.ts fix round 3 item 1). This row was proven "held" and flipped to "filed" by exactly
      // one compare-and-set above, run by exactly one caller: nothing else can be racing this
      // specific call, so r.created is always true here and is deliberately not branched on.
      return {
        ok: true,
        undo: { kind: "unfile", id, messageId: r.messageId, ...(r.consent.kind === "stopped" ? { eventId: r.consent.eventId } : {}) },
      };
    } catch {
      // Fix round 1 item 2: a File that fails partway (after its own message landed, before the row
      // committed back to "filed" — or any other mid-flight failure) must not leave that message
      // dangling once the row returns to held. Scoped by account + this row's own provider id, so
      // the rollback can never touch another row's message even if something else collided here.
      // Fix round 2 item 1: gated on `claimed` — nothing here ran if the CAS itself never landed.
      if (claimed) {
        const deleted = await deleteInboundMessageByProviderId(svc, accountId, p.row.providerEmailId).catch(() => false);
        console.error("fileHeldEmailAction rollback", { accountId, id, deleted });
        await decideInboundEmail(svc, accountId, id, "filed", { status: "held", messageId: null, decidedBy: null }).catch(() => false);
      }
      return { ok: false, error: "failed" };
    }
  } catch {
    console.error("fileHeldEmailAction failed", { accountId });
    return { ok: false, error: "failed" };
  }
}

export async function dismissHeldEmailAction(accountId: string, id: string): Promise<HeldActionResult> {
  const { userId } = await requireAccountAccess(accountId);
  try {
    const p = await provedRow(accountId, id);
    if (!p || p.row.status !== "held") return { ok: false, error: "changed" };
    if (!(await decideInboundEmail(serviceDb(), accountId, id, "held", { status: "dismissed", decidedBy: userId }))) return { ok: false, error: "changed" };
    revalidatePath(`/dashboard/accounts/${accountId}/conversations`);
    return { ok: true, undo: { kind: "undismiss", id } };
  } catch {
    console.error("dismissHeldEmailAction failed", { accountId });
    return { ok: false, error: "failed" };
  }
}

export async function undoHeldEmailAction(accountId: string, locale: Locale, undo: HeldUndo): Promise<HeldUndoResult> {
  const { userId } = await requireAccountAccess(accountId);
  try {
    const p = await provedRow(accountId, undo.id);
    if (!p) return { ok: false };
    if (undo.kind === "undismiss") {
      const ok = p.row.status === "dismissed" && await decideInboundEmail(serviceDb(), accountId, undo.id, "dismissed", { status: "held", decidedBy: null });
      revalidatePath(`/dashboard/accounts/${accountId}/conversations`);
      return { ok };
    }
    if (p.row.status !== "filed") return { ok: false };
    // Fix round 2 items 2 and 3: bind FIRST (find the message carrying this eventId, before
    // unfiling anything), but actually REVERSE the stop only once the unfile itself has returned
    // true — a refused unfile ({ ok: false }) must never touch undoInboundStop at all, which fix
    // round 1's ordering let happen. The binding is now also strict: the message found must carry
    // BOTH the eventId AND the exact messageId the browser sent (no fallback to the thread's own
    // contact) — a message that carries this eventId under a DIFFERENT id than `undo.messageId`
    // names is not proof enough that the two belong to the same File at all.
    let reversalTarget: { contactId: string } | null = null;
    let stopNotReversed: string | undefined;
    if (undo.eventId) {
      const messages = await listMessages(p.db, accountId, p.row.conversationId);
      const owning = messages.find((msg) =>
        metaOf(msg)?.consent?.kind === "stopped" && metaOf(msg)?.consent?.eventId === undo.eventId
        && (msg as { id?: string }).id === undo.messageId);
      if (owning) {
        reversalTarget = { contactId: metaOf(owning)?.sender?.contact_id ?? p.suggestion };
      } else {
        stopNotReversed = t(m, "conversations.held.changed", locale);
      }
    }
    const ok = await unfileInboundEmail(serviceDb(), accountId, undo.id, undo.messageId);
    if (ok && reversalTarget) {
      // S-10 T9a: the caller's own reader locale, same fix as undoReplyStopAction above.
      // `stopNotReversed`'s own value is never shown verbatim (held-email-handlers.ts only checks
      // its presence), but it is now fully localized internally too, for the same reason: nothing
      // downstream should ever have to re-derive a locale this action already has.
      const ctx = await emailContextFor(accountId, reversalTarget.contactId, userId, locale);
      if ("ok" in ctx) {
        stopNotReversed = ctx.error;
      } else {
        const r = await undoInboundStop(ctx, undo.eventId!);
        if (!r.ok) stopNotReversed = r.error;
        else revalidatePath(`/dashboard/accounts/${accountId}/contacts/${reversalTarget.contactId}`);
      }
    }
    revalidatePath(`/dashboard/accounts/${accountId}/conversations`);
    return ok ? { ok: true, ...(stopNotReversed ? { stopNotReversed } : {}) } : { ok: false };
  } catch {
    console.error("undoHeldEmailAction failed", { accountId });
    return { ok: false };
  }
}
