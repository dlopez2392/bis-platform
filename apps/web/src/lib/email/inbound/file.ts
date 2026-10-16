import { createMessage, findMessageByProviderId, incrementUnreadCount, setInboundMessage, type InboundEmailRow, type SupabaseClient } from "@bis/db";
import { classifyEmailStop } from "@/lib/consent/email-stop";
import { recordInboundStop } from "@/lib/consent/email-staff-actions";

/**
 * Filing one inbound email on a thread (spec Inbound steps 5 and 7; Needs a look's File). Order, each
 * step idempotent so Resend's retry after a 503 completes what is missing: the stop (ledger,
 * source_ref on Resend's id), then the message (found by Resend's id before any insert), then unread.
 * THROWS on a ledger or write failure: the webhook answers 503.
 *
 * Fix round 1 item 3: "first completion" is decided by the inbound ROW's OWN link (`row.messageId`,
 * read at the TOP of this call, before any write this call makes), never by whether THIS call itself
 * inserted the message. A retry after a mid-flight crash (the message got written but the row never
 * got linked to it, or linking itself failed) passes in the SAME row, still unlinked — so unread is
 * raised again and the caller is told to forward again, with `setInboundMessage` run LAST as the one
 * commit marker. Raising unread twice across two attempts is an accepted cost (one crash, one extra
 * badge increment) against the alternative of losing it or the forward silently; never ignored, but
 * its own boolean is a diagnostic only, not a second gate — gating on it instead would stop the retry
 * from ever re-raising unread/forward once the LINK has committed but a later step (incrementing
 * unread) is what actually failed, which would lose the forward forever.
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
  // A row already linked (a true duplicate delivery, fully completed before — stop classification
  // included, since the link write is the LAST thing a completed call does, so a set messageId
  // proves the stop step already ran) needs no re-classification, no lookup, no write: its own
  // messageId IS the answer, and nothing past this point runs.
  if (row.messageId !== null) {
    return { messageId: row.messageId, created: false, consent: { kind: "none" } };
  }

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
  }
  if (i.raiseUnread) await incrementUnreadCount(db, row.accountId, row.conversationId);
  // The commit marker, LAST. Its boolean is read (never ignored) as a diagnostic of a genuine race —
  // another process linking the same row between this call's read and this write — but is not a
  // second gate: notYetLinked above already decided unread/forward are owed this call.
  const linked = await setInboundMessage(db, row.accountId, row.id, messageId);
  if (!linked) {
    console.error(`fileInboundEmail: row ${row.id} was linked by another process between read and write`);
  }
  return { messageId, created: true, consent };
}
