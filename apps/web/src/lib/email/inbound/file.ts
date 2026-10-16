import { createMessage, findMessageByProviderId, incrementUnreadCount, setInboundMessage, type InboundEmailRow, type SupabaseClient } from "@bis/db";
import { classifyEmailStop } from "@/lib/consent/email-stop";
import { recordInboundStop } from "@/lib/consent/email-staff-actions";

/**
 * Filing one inbound email on a thread (spec Inbound steps 5 and 7; Needs a look's File). Order, each
 * step idempotent so Resend's retry after a 503 completes what is missing: the stop (ledger,
 * source_ref on Resend's id), then the message (found by Resend's id before any insert), then unread.
 * THROWS on a ledger or write failure: the webhook answers 503.
 */
export type MessageConsent = { kind: "stopped"; eventId: string } | { kind: "maybe"; phrase: string } | { kind: "none" };
export type FileDeps = { db: SupabaseClient; now: () => Date };
export type FileInput = {
  row: InboundEmailRow; contactId: string;
  sender: { contactId: string; firstName: string | null; lastName: string | null; viaGroup: boolean } | null;
  attachmentCount: number; raiseUnread: boolean; actor: { id: string; type: "system" | "user" };
};
export type FileResult = { messageId: string; created: boolean; consent: MessageConsent };

export async function fileInboundEmail(deps: FileDeps, i: FileInput): Promise<FileResult> {
  const { db } = deps;
  const { row } = i;
  const stopFor = i.sender?.contactId ?? i.contactId;
  const cls = classifyEmailStop(row.text);
  let consent: MessageConsent = { kind: "none" };
  if (cls.kind === "clear") {
    const r = await recordInboundStop(db, { accountId: row.accountId, contactId: stopFor, address: row.fromEmail, providerEmailId: row.providerEmailId, phrase: cls.phrase });
    if (r.outcome === "stopped") consent = { kind: "stopped", eventId: r.eventId };
  } else if (cls.kind === "unclear") {
    consent = { kind: "maybe", phrase: cls.phrase };
  }
  const existing = await findMessageByProviderId(db, row.accountId, row.providerEmailId);
  let messageId: string;
  let created = false;
  if (existing) {
    messageId = existing.id;
  } else {
    const meta: Record<string, unknown> = { inbound_email_id: row.providerEmailId, attachment_count: i.attachmentCount };
    if (i.sender?.viaGroup) meta.sender = { contact_id: i.sender.contactId, first_name: i.sender.firstName, last_name: i.sender.lastName };
    meta.consent = consent;
    ({ id: messageId } = await createMessage(db, row.accountId, {
      conversationId: row.conversationId, channel: "email", direction: "inbound", status: "delivered",
      subject: row.subject ?? undefined, body: row.text, providerMessageId: row.providerEmailId, meta,
    }, i.actor.id, i.actor.type));
    created = true;
  }
  await setInboundMessage(db, row.accountId, row.id, messageId);
  if (created && i.raiseUnread) await incrementUnreadCount(db, row.accountId, row.conversationId);
  return { messageId, created, consent };
}
