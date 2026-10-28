// One Telnyx messaging webhook URL carries THREE event types: inbound texts
// (`message.received`) and both outbound status callbacks
// (`message.sent`, `message.finalized`) — a messaging profile has exactly
// one inbound-webhook slot, so this route branches on `event_type` rather
// than existing as two routes.
//
// Payload shape verified 2026-09-04 against Telnyx's current messaging
// webhook docs (developers.telnyx.com/docs/messaging/messages/receiving-webhooks),
// not assumed from memory — see task-4-report.md for the full diff against
// the brief's draft test. Two things worth stating up front because getting
// either wrong means inbound texts or status updates are silently dropped:
//
//  1. The envelope is `{ data: { event_type, id, occurred_at, payload,
//     record_type }, meta }`. `data.id` is the WEBHOOK EVENT's own id — a
//     different value from the message id. The message id (== what
//     `lib/sms/telnyx.ts`'s `send()` stores as `provider_message_id`, read
//     from the synchronous `POST /v2/messages` response's `data.id`) lives
//     at `data.payload.id` on this webhook, not at the envelope's `data.id`.
//     Looking up `data.id` here would never match a real outbound message.
//
//  2. `message.received`: `data.payload.from.phone_number` is the customer
//     (a single object), `data.payload.to[].phone_number` is our number (an
//     array — one entry for a normal SMS to one number), `data.payload.text`
//     is the body. `message.sent` / `message.finalized`: per-recipient
//     status lives at `data.payload.to[].status`.
//
//  3. Consent chain PR-2 (spec §4.2): every inbound text runs the consent
//     step (lib/consent/inbound.ts) — STOP, START, HELP in English and
//     Spanish, the phrase list, the first-text grant. `autoresponse_type`
//     (VERIFIED, plan F1) says Telnyx already answered a keyword itself, in
//     which case BIS sends nothing. Telnyx retries a non-2xx up to three
//     times per URL, then the failover URL (VERIFIED, plan F7), and gives
//     each attempt 2 s: so a text that changes consent and could not be
//     handled answers 503, every write is idempotent on the message id, and
//     BIS's own reply runs in `after()`, once this route has answered.
import { NextResponse, after } from "next/server";
import {
  serviceDb, ensureConversation, createMessage, createContact, incrementUnreadCount,
  updateMessageStatusByProviderId, findMessageByProviderId, getPhoneNumberByE164, getAlertPhone,
  applyConfirmationReply, ensureHoldingContact, listOutstandingConfirmAsks, matchConfirmationReply,
  restoreContactOnSign,
  type MessageStatus, type SupabaseClient,
} from "@bis/db";
import { looksAutomaticText } from "@/lib/contacts/automatic-text";
import { readCandidates, isShared } from "@/lib/voice/identity/candidates";
import { verifyTelnyxSignature } from "@/lib/voice/telnyx-signature";
import { stampHeartbeat } from "@/lib/ops/stamp";
import { e164Of } from "@/lib/voice/phone-number";
import { loggableError } from "@/lib/loggable-error";
import {
  classifyInbound, parseAutoresponse, recordInboundConsent, fileSharedReplyTodo, CHANGES_CONSENT, type InboundClass,
} from "@/lib/consent/inbound";
import { sendConsentReply } from "@/lib/consent/replies";

// A webhook, not a user action: there is no session, no operator, no AI
// persona — "system" is the actor for every write this route makes.
const ACTOR_ID = "sms-inbound";
const ACTOR_TYPE = "system" as const;

function log(...args: unknown[]) {
  console.error("[sms/inbound]", ...args);
}

// Telnyx's per-recipient `to[].status` values (from `message.sent` /
// `message.finalized`) mapped onto this platform's MessageStatus ladder.
// A status not listed here (Telnyx adds one later, or a typo in the
// payload) is deliberately left unmapped rather than guessed — the caller
// treats "no mapping" the same as "no mappable status" and skips the write.
// That's safe either way: updateMessageStatusByProviderId's own STATUS_RANK
// guard (packages/db/src/messaging.ts) already makes a stale or
// out-of-order write a no-op, so the only failure mode of an unmapped
// status is "this particular update did nothing," never a regression.
const STATUS_MAP: Record<string, MessageStatus> = {
  queued: "queued",
  sending: "sent",
  sent: "sent",
  delivery_unconfirmed: "sent",
  delivered: "delivered",
  sending_failed: "failed",
  delivery_failed: "failed",
};

type TelnyxRecipient = { phone_number?: string; status?: string };
type TelnyxPayload = {
  id?: string;
  from?: { phone_number?: string };
  to?: TelnyxRecipient[];
  text?: string;
  /** Telnyx answered the text itself as this keyword (plan F1). */
  autoresponse_type?: string;
  /** The profile the text came in on (plan F9), kept as evidence. */
  messaging_profile_id?: string;
};
type TelnyxWebhookBody = {
  data?: { event_type?: string; payload?: TelnyxPayload };
};

/** Work to run once the response is sent (`after`); injected so tests can run it. */
type Defer = (work: () => Promise<void>) => void;

/**
 * A text's FIRST filing failed before its message row was written (item 8c final review A7): the
 * customer's words are nowhere yet, so the route answers 503 and Telnyx retries. The retry is safe:
 * filing is keyed on the message id (`findMessageByProviderId`), so it files once. The case it exists
 * for is a text racing the removal of the contact it matched (an Undo of a customer Sofía added):
 * `@bis/db`'s helpers rethrow plain Errors without the database code, so the route never matches on a
 * foreign-key text; any failure before the row exists is retryable by definition.
 */
class FilingFailed extends Error {
  override name = "FilingFailed";
  constructor(cause: unknown) {
    super("the inbound text's first filing failed before its message was written", { cause });
  }
}

async function handleInbound(
  db: SupabaseClient, payload: TelnyxPayload | undefined, consent: InboundClass, defer: Defer,
): Promise<void> {
  const calledNumber = e164Of(payload?.to?.[0]?.phone_number ?? null);
  if (!calledNumber) {
    log("inbound message with no resolvable called (to) number");
    return;
  }

  // Resolve the tenant off the DIALED number, never the payload's claimed
  // sender. An unknown called-number is not this platform's error to fix —
  // it 200s so the provider stops retrying — but it IS logged, because the
  // case that matters is a number we DO own whose phone_numbers row is
  // missing or wrong: a real customer's text silently discarded with no
  // screen anywhere that would say so.
  //
  // The status check is the same guard voice/incoming applies at its own
  // tenant-resolution step: setPhoneNumberStatus is a plain UPDATE, never a
  // delete, so a released or reassigned number's row persists with the OLD
  // account_id. Treating anything other than testing/live as "unowned"
  // stops a stranger's text to a released number from being attributed to
  // a former tenant's conversation list.
  const phoneRow = await getPhoneNumberByE164(db, calledNumber);
  if (!phoneRow || (phoneRow.status !== "testing" && phoneRow.status !== "live")) {
    log("inbound text to a number this platform does not own or is not active", calledNumber);
    return;
  }
  const accountId = phoneRow.account_id;
  const fromNumber = e164Of(payload?.from?.phone_number ?? null);
  const text = typeof payload?.text === "string" ? payload.text : "";
  const providerMessageId = payload?.id ?? null;
  const base = {
    accountId, text, autoresponse: parseAutoresponse(payload?.autoresponse_type),
    autoresponseRaw: typeof payload?.autoresponse_type === "string" ? payload.autoresponse_type : null,
    providerMessageId,
    messagingProfileId: typeof payload?.messaging_profile_id === "string" ? payload.messaging_profile_id : null,
    now: new Date(),
  };

  // THE loop guard 0035_alert_phone.sql's own comment leaves to the send
  // path: a text FROM the account's own alert phone is the platform
  // receiving its own alert reply, or the owner texting their own line by
  // habit, and filing it would create a CONTACT for the business owner.
  // Contained on purpose: a failed read degrades the guard, never the
  // customer's message.
  let alertPhone: string | null = null;
  try {
    alertPhone = await getAlertPhone(db, accountId);
  } catch (e) {
    log("getAlertPhone read failed — proceeding without the loop guard rather than dropping the text", accountId, loggableError(e));
  }
  if (alertPhone && fromNumber === alertPhone) {
    // Review R2-I5 (plan G10): the gate records a carrier block for the
    // alert phone's own texts too, and choice 19 lets only the phone's own
    // START lift it, so its STOP and START are recorded BEFORE the drop. No
    // grant, no To-do, no HELP: it is the business, not a customer.
    if (consent.kind === "stop" || consent.kind === "start") {
      await recordInboundConsent(db, { ...base, address: fromNumber, contactId: null, firstFiling: true, sharedNumber: null }, consent,
        (reply) => defer(() => sendConsentReply(db, { accountId, to: fromNumber, contactId: null, conversationId: null, reply })));
    }
    log("dropping inbound text from the account's own alert_phone — recognized, not filed as a contact", accountId, alertPhone);
    return;
  }

  // Telnyx retries message.received at-least-once, and a 503 below asks it
  // to. payload.id is the message's own id (file header note 1), stable
  // across retries: a row already recorded under it means this delivery was
  // filed before, so the FILING is skipped (and YES/NO, which answers "the
  // most recent unanswered ask" and must not run twice), but the consent step
  // is not: it is idempotent on the same id, and it is what a retry is for
  // (plan G1, spec S1).
  let existing: Awaited<ReturnType<typeof findMessageByProviderId>> = null;
  try {
    existing = providerMessageId ? await findMessageByProviderId(db, accountId, providerMessageId) : null;
  } catch (e) {
    // Not knowing whether it was filed is not having filed it: a retry asks again.
    throw new FilingFailed(e);
  }
  const firstFiling = existing === null;

  // Match an existing contact on this account by phone, or create one —
  // createContact already dedupes on phone (contacts.ts's findDuplicate),
  // so a known customer's text joins their existing thread. Up to and
  // including the message row, a failure on the FIRST filing is
  // `FilingFailed` (503, Telnyx retries); on a retry the text is already
  // filed, so a failure here keeps the old rule below.
  let contact: Awaited<ReturnType<typeof createContact>>;
  let conversation: Awaited<ReturnType<typeof ensureConversation>>;
  let shared: { realContactIds: string[]; truncated: boolean } | null = null;
  /** More people on the number than one read returns (spec S6): an ask among those read may not be the only one. */
  let sharedTruncated = false;
  try {
    // S-47e (E8, S27): a text from a number several customers share carries no name, so it files on the
    // number's ONE holding record, never on a household member by phone. Staff move it. A failed read on
    // the first filing is FilingFailed (503), like every other step here.
    const read = fromNumber ? await readCandidates(db, accountId, fromNumber) : null;
    if (read && fromNumber && isShared(read)) {
      shared = { realContactIds: read.candidates.map((c) => c.id), truncated: read.truncated };
      sharedTruncated = read.truncated;
      contact = { id: (await ensureHoldingContact(db, accountId, fromNumber, "sms")).id, existing: true, flagged: false };
    } else {
      contact = await createContact(
        db, accountId, { phone: fromNumber ?? undefined }, ACTOR_ID, ACTOR_TYPE,
      );
    }
    conversation = await ensureConversation(db, accountId, contact.id, ACTOR_ID, ACTOR_TYPE);
    // Contact archive, owner ruling Q1 and review I7/I8: the customer's own text brings an archived contact
    // back (logged as the customer's act) — not a STOP/START/HELP, a Telnyx autoresponse or a stop phrase
    // (consent.kind), not a phone's auto-reply, not a shared number's holding record. Runs on every delivery
    // (idempotent: an active contact answers false), inside the filing try and BEFORE the message, so a
    // failure on the first filing files nothing and Telnyx's retry redoes the whole text.
    if (!shared && consent.kind === "none" && !looksAutomaticText(text)) {
      await restoreContactOnSign(db, accountId, contact.id, "text");
    }
    if (firstFiling) {
      await createMessage(db, accountId, {
        conversationId: conversation.id, channel: "sms", direction: "inbound",
        body: text, providerMessageId: providerMessageId ?? undefined,
        // Received in full, not queued to send anywhere — see NewMessage.status
        // (packages/db/src/messaging.ts). The column default is 'queued', which
        // is right for an outbound send and wrong for an inbound text.
        status: "delivered",
      }, ACTOR_ID, ACTOR_TYPE);
    }
  } catch (e) {
    // A HoldingContactUnavailable lands here too (P23): a delete raced the insert, and Telnyx's retry recovers.
    if (firstFiling) throw new FilingFailed(e);
    throw e;
  }

  if (firstFiling) {
    // Same invariant every other inbound writer keeps: a new inbound message
    // always bumps the conversation's unread count, right after the row that
    // made it unread exists.
    await incrementUnreadCount(db, accountId, conversation.id);

    // PART B: the appointment-confirmation answer, for a text that is
    // nothing else (a keyword or a stop sentence never reaches it; spec §4.2
    // step 5's "otherwise", which includes a text Telnyx answered but BIS
    // does not recognise — review R2-m4). CONTAINED ON PURPOSE: a failed
    // recognition degrades to "nobody recorded the answer", which the
    // operator still sees as an unread "yes". THE LOG LINE BELOW IS
    // LOAD-BEARING: route.test.ts asserts on exactly it. It sends NOTHING
    // (automation spec decision 6).
    if (consent.kind === "none" || consent.kind === "telnyx_only") {
      try {
        if (shared) {
          // S-47e (S30): the household's one outstanding ask, or one To-do when there is not exactly one.
          if (matchConfirmationReply(text)) {
            const now = base.now;
            // Truncated: no read of asks, because exactly one among those read is not exactly one on the number.
            const asks = sharedTruncated ? [] : await listOutstandingConfirmAsks(db, accountId, shared.realContactIds, now);
            if (asks.length === 1) {
              const answer = await applyConfirmationReply(db, accountId, asks[0]!.contactId, text, now);
              if (answer) log("recorded an appointment confirmation reply", accountId, asks[0]!.contactId, answer);
            } else {
              await fileSharedReplyTodo(db, accountId, contact.id, now);
              log("a reply from a shared number matched no single appointment; To-do filed", accountId);
            }
          }
        } else {
          const answer = await applyConfirmationReply(db, accountId, contact.id, text, new Date());
          if (answer) log("recorded an appointment confirmation reply", accountId, contact.id, answer);
        }
      } catch (e) {
        log("could not record a confirmation reply — the customer's message is filed regardless", accountId, loggableError(e));
      }
    }
  } else {
    log("already-recorded inbound message (retried delivery): consent step only", providerMessageId);
  }

  if (!fromNumber) {
    if (consent.kind !== "none") log("inbound text with no sender number: nothing to record in the consent ledger", accountId);
    return;
  }
  // The reply is scheduled the moment it is owed, inside the step, so a
  // To-do failure after it (503) cannot lose it (review R2-I1a).
  await recordInboundConsent(db, { ...base, address: fromNumber, contactId: contact.id, firstFiling, sharedNumber: shared }, consent,
    (reply) => defer(() => sendConsentReply(db, { accountId, to: fromNumber, contactId: contact.id, conversationId: conversation.id, reply })));
}

async function handleStatus(db: SupabaseClient, payload: TelnyxPayload | undefined): Promise<void> {
  // payload.id, NOT the webhook envelope's data.id — see file header note 1.
  const providerMessageId = payload?.id;
  const rawStatus = payload?.to?.[0]?.status;
  const status = rawStatus ? STATUS_MAP[rawStatus] : undefined;
  if (!providerMessageId || !status) {
    log("status event missing a resolvable message id or mappable status", providerMessageId, rawStatus);
    return;
  }
  await updateMessageStatusByProviderId(db, providerMessageId, status);
}

export async function POST(req: Request): Promise<NextResponse> {
  // req.text() FIRST — the signature covers the exact raw bytes; re-serializing
  // a parsed body would not match.
  const rawBody = await req.text();

  const publicKey = process.env.TELNYX_PUBLIC_KEY?.trim();
  const timestamp = req.headers.get("telnyx-timestamp");
  const signatureB64 = req.headers.get("telnyx-signature-ed25519");
  const verified = !!publicKey &&
    verifyTelnyxSignature({ rawBody, timestamp, signatureB64, publicKeyB64: publicKey });
  if (!verified) {
    // Never stamped (lib/ops/stamp.ts): a forgery is a stranger, not an
    // outage. An UNSET key lands here too, and is deliberately not an alert
    // either: texting is dormant until A2P clears, and the key's absence is
    // a known state, not a failure.
    log("rejected: invalid signature");
    return NextResponse.json({ error: "invalid signature" }, { status: 401 });
  }

  let body: TelnyxWebhookBody;
  try {
    body = JSON.parse(rawBody);
  } catch {
    log("rejected: malformed JSON body past a valid signature");
    stampHeartbeat("sms.inbound", { ok: true });
    return NextResponse.json({ ok: true });
  }

  const eventType = body.data?.event_type;
  const payload = body.data?.payload;
  // Classified BEFORE anything can fail (pure), so a failure anywhere below —
  // serviceDb() included — knows whether it lost a stop.
  const consent: InboundClass = eventType === "message.received"
    ? classifyInbound(typeof payload?.text === "string" ? payload.text : "", parseAutoresponse(payload?.autoresponse_type))
    : { kind: "none" };
  if (eventType === "message.received" && parseAutoresponse(payload?.autoresponse_type) === "OTHER") {
    // Review R2-I2: any value means Telnyx replied, so BIS sends nothing; a
    // value BIS does not know is logged so it can be added on purpose.
    log("an autoresponse_type BIS does not know, read as 'Telnyx already replied'", String(payload?.autoresponse_type).slice(0, 40));
  }

  // Everything past the signature check acks 200 whatever happens inside,
  // EXCEPT a text that changes consent (a stop, a start, a stop sentence):
  // losing one of those is a legal failure, so it answers 503 and Telnyx
  // retries (plan G2; every write it retries is idempotent). A plain text
  // keeps the old rule (nothing a retry can fix, so 200 and a log line)
  // once it is filed; before its message row exists, a failure is
  // `FilingFailed` and answers 503 too, so the words are never lost.
  // serviceDb() MUST stay inside this try for either guarantee to hold.
  try {
    const db = serviceDb();
    if (eventType === "message.received") {
      await handleInbound(db, payload, consent, (work) => after(work));
    } else if (eventType === "message.sent" || eventType === "message.finalized") {
      await handleStatus(db, payload);
    } else {
      log("ignoring unrecognised event_type", eventType);
    }
  } catch (e) {
    // The event type is Telnyx's own name and the error is named by its type,
    // never its message, which can quote a phone number or the text itself.
    stampHeartbeat("sms.inbound", { ok: false, error: `${String(eventType ?? "unknown").slice(0, 40)} handling failed (${e instanceof Error ? e.name : typeof e})` });
    // A FilingFailed wraps the real cause; every branch logs the cause.
    const cause = e instanceof FilingFailed ? e.cause : e;
    if (CHANGES_CONSENT.has(consent.kind)) {
      log("could not handle a text that changes consent; answering 503 so Telnyx retries", eventType, consent.kind, loggableError(cause));
      return NextResponse.json({ error: "retry" }, { status: 503 });
    }
    // Item 8c final review A7: a plain text not yet filed is retried too.
    if (e instanceof FilingFailed) {
      log("could not file an inbound text; answering 503 so Telnyx retries", eventType, loggableError(cause));
      return NextResponse.json({ error: "retry" }, { status: 503 });
    }
    log("unexpected failure handling webhook", eventType, loggableError(e));
    return NextResponse.json({ ok: true });
  }
  stampHeartbeat("sms.inbound", { ok: true });
  return NextResponse.json({ ok: true });
}
