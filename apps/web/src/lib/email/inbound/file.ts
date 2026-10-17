import { createMessage, findMessageByProviderId, getContact, incrementUnreadCount, setInboundMessage, type InboundEmailRow, type SupabaseClient } from "@bis/db";
import { emailLedgerAddress } from "@bis/db/email-address";
import { classifyEmailStop } from "@/lib/consent/email-stop";
import { recordInboundStop } from "@/lib/consent/email-staff-actions";
import { bareAddress } from "./address";

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
 * raised again, with `setInboundMessage` run LAST as the one commit marker. Raising unread twice
 * across two attempts is an accepted cost (one crash, one extra badge increment) against the
 * alternative of losing it silently.
 *
 * Fix round 3 item 1: the RETURNED `created` — which the caller (pipeline.ts) uses to decide whether
 * IT forwards — is decided by `setInboundMessage`'s own boolean, not by having reached this far. Two
 * concurrent deliveries of the same unlinked row (Resend retrying while the first run is still in
 * flight, not a crash-then-retry) both raise unread and both reach the commit write, but the
 * database's compare-and-set (`.is("message_id", null)`) lets only ONE of them actually flip the
 * link — that one, and only that one, reports `created: true` and is the one the caller forwards for.
 * The loser's write is a no-op (`linked: false`), logged as the diagnostic it is, but no longer
 * reported as a completion: the winner's own call already owns the forward.
 */
export type MessageConsent = { kind: "stopped"; eventId: string } | { kind: "maybe"; phrase: string } | { kind: "none" };
export type FileDeps = { db: SupabaseClient; now: () => Date };
export type FileInput = {
  row: InboundEmailRow; contactId: string;
  sender: { contactId: string; firstName: string | null; lastName: string | null; viaGroup: boolean } | null;
  attachmentCount: number; raiseUnread: boolean; actor: { id: string; type: "system" | "user" };
  /** S-06 part 2: a teammate's forward (spec §4). The whole text, the person mark, no stop, no unread. */
  forward?: { authorId: string | null };
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

  const forward = i.forward ?? null;
  let consent: MessageConsent = { kind: "none" };
  // Spec §4: the stop rule does NOT run on a forward (a forwarded STOP is not the customer's live
  // request; staff can press Stop emails).
  if (!forward) {
    // Orchestrator ruling (final review): ONLY a sender that matched (the contact or a group member,
    // matchSender non-null) applies a clear stop. A manual File / Choose a record of a sender that did not
    // match the target (a stranger) never stops the customer automatically: the STOP is the "maybe" chip.
    const stopFor = i.sender?.contactId ?? null;
    const cls = classifyEmailStop(row.text);
    // Review finding (Task 8) + Task 12 fix round 1 ruling (item 6): `row.fromEmail` can be the RAW,
    // unparseable From header text (set by pipeline.ts's own fallback when `bareAddress` failed on
    // receipt) rather than a real address. The message is still filed either way, but the ledger is
    // never written against a string that is not an address; a clear stop with no usable address
    // becomes the same "maybe" chip an unclear phrase does (staff decide by hand), rather than
    // silently dropping the stop to "none" as though nothing was said at all.
    //
    // Final review I1: the stop is recorded under the MATCHED CONTACT's own ledger address
    // (emailLedgerAddress(contact.email)) — the address the email gate and the contact's Email row read —
    // never the sender's literal From: matchSender matches on email_key, which strips +tags, so a reply
    // from ana@ to a contact stored as ana+bis@ used to stop an address nothing ever sends to. Read here,
    // on the filing client, only for a clear stop; the contact was proven by the caller (matchSender in
    // the pipeline, the request-client proof in the manual File). A contact with no usable email (or
    // gone) is the same "maybe" chip as an unparseable From: nothing is written against a guess.
    const bare = cls.kind === "clear" ? bareAddress(row.fromEmail) : null;
    const address = cls.kind === "clear" && bare && stopFor
      ? emailLedgerAddress((await getContact(db, row.accountId, stopFor))?.email ?? null)
      : null;
    if (cls.kind === "clear" && address && stopFor) {
      const r = await recordInboundStop(db, { accountId: row.accountId, contactId: stopFor, address, providerEmailId: row.providerEmailId, phrase: cls.phrase });
      if (r.outcome === "stopped") consent = { kind: "stopped", eventId: r.eventId };
    } else if (cls.kind === "unclear" || cls.kind === "clear") {
      consent = { kind: "maybe", phrase: cls.phrase };
    }
  }

  const existing = await findMessageByProviderId(db, row.accountId, row.providerEmailId);
  let messageId: string;
  if (existing) {
    // Task 12 fix round 2 (minor — corrected comment): `provider_email_id`'s uniqueness is GLOBAL
    // (messaging.ts's own doc on `messages_provider_message_id_unique`), not per-account, so a hit
    // scoped to THIS account can only ever be a message THIS SAME row already created on an
    // earlier attempt — never another row's or another account's. The only way that earlier
    // message can sit on a different conversation than the one being filed onto now is a
    // "Choose a record" move between attempts: the row's own conversation_id changed, but its
    // earlier, still-linked-by-provider-id message did not move with it. Reusing it anyway would
    // silently leave the newly-chosen customer's thread without the message it was just told it
    // has. Thrown, like every other failure in this function: the caller (the manual File action,
    // or pipeline.ts's retry) decides what a throw here means.
    if (existing.conversationId !== row.conversationId) {
      throw new Error("fileInboundEmail: an existing message for this provider id sits on a different conversation");
    }
    messageId = existing.id;
  } else {
    const meta: Record<string, unknown> = { inbound_email_id: row.providerEmailId, attachment_count: i.attachmentCount };
    if (forward) {
      meta.forwarded = true;
      meta.forwarded_by = forward.authorId;   // G4: the inbox names the forwarder from this
    } else if (i.sender?.viaGroup) {
      meta.sender = { contact_id: i.sender.contactId, first_name: i.sender.firstName, last_name: i.sender.lastName };
    }
    meta.consent = consent;
    ({ id: messageId } = await createMessage(db, row.accountId, {
      conversationId: row.conversationId, channel: "email", direction: "inbound", status: "delivered",
      subject: row.subject ?? undefined, body: row.text, providerMessageId: row.providerEmailId, meta,
      ...(forward ? { author: { kind: "person" as const, id: forward.authorId } } : {}),
    }, i.actor.id, i.actor.type));
  }
  // Spec §4: a teammate's forward never raises unread, whatever the caller passed.
  if (i.raiseUnread && !forward) await incrementUnreadCount(db, row.accountId, row.conversationId);
  // The commit marker, LAST. Its boolean now DECIDES `created` (fix round 3 item 1): a concurrent
  // run that lost the compare-and-set race did no useful commit here, however far it got, and must
  // not be reported as the completion the caller forwards for — that belongs to whichever run's
  // write actually landed.
  const linked = await setInboundMessage(db, row.accountId, row.id, messageId);
  if (!linked) {
    console.error(`fileInboundEmail: row ${row.id} was linked by another process between read and write`);
  }
  return { messageId, created: linked, consent };
}
