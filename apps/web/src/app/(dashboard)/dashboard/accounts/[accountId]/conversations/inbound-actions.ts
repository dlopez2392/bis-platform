"use server";

import { revalidatePath } from "next/cache";
import { readConsentEvent, readConsentHistory, newestDecidingRow, serviceDb } from "@bis/db";
import { requireAccountAccess } from "@/lib/auth";
import { dbForRequest } from "@/lib/db";
import { emailContextFor } from "@/lib/consent/email-context";
import { undoInboundStop, stopEmails } from "@/lib/consent/email-staff-actions";
import { m } from "@/lib/messages";

/**
 * The thread's inbound-email actions (S-06 part 1). Every one proves the CONVERSATION on the request
 * client first (0053/0068: a Technician sees only their own customers' threads); only then the service
 * client reads the stop row (its contact may be a household member) and the ledger writes.
 */
export type ReplyActionResult = { ok: true } | { ok: false; error: string; expired?: true };

async function provedThread(accountId: string, conversationId: string): Promise<{ contactId: string } | null> {
  const db = await dbForRequest();
  const { data, error } = await db.from("conversations").select("id, contact_id").eq("account_id", accountId).eq("id", conversationId).maybeSingle();
  if (error || !data) return null;
  return { contactId: (data as { contact_id: string }).contact_id };
}

export async function undoReplyStopAction(accountId: string, conversationId: string, eventId: string): Promise<ReplyActionResult> {
  const { userId } = await requireAccountAccess(accountId);
  if (!(await provedThread(accountId, conversationId))) return { ok: false, error: m["conversations.held.changed"] };
  const row = await readConsentEvent(serviceDb(), accountId, eventId);
  if (!row?.contact_id) return { ok: false, error: m["contact.email.changed"] };
  const ctx = await emailContextFor(accountId, row.contact_id, userId);
  if ("ok" in ctx) return { ok: false, error: ctx.error };
  const r = await undoInboundStop(ctx, eventId);
  revalidatePath(`/dashboard/accounts/${accountId}/conversations`);
  // The 7-day-window refusal is a typed field on EmailActionResult (Task 5), never a string the
  // caller re-derives: passed through only when undoInboundStop itself set it.
  return r.ok ? { ok: true } : { ok: false, error: r.error, ...(r.expired ? { expired: true as const } : {}) };
}

export async function stopEmailsFromReplyAction(accountId: string, conversationId: string, contactId: string): Promise<ReplyActionResult> {
  const { userId } = await requireAccountAccess(accountId);
  if (!(await provedThread(accountId, conversationId))) return { ok: false, error: m["conversations.held.changed"] };
  const ctx = await emailContextFor(accountId, contactId, userId);
  if ("ok" in ctx) return { ok: false, error: ctx.error };
  const newest = newestDecidingRow(await readConsentHistory(ctx.writer, accountId, "email", ctx.address));
  const r = await stopEmails(ctx, newest?.id ?? null);
  revalidatePath(`/dashboard/accounts/${accountId}/conversations`);
  return r.ok ? { ok: true } : { ok: false, error: r.error };
}
