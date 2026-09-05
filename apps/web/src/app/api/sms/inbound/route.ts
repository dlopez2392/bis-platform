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
import { NextResponse } from "next/server";
import {
  serviceDb, ensureConversation, createMessage, createContact,
  updateMessageStatusByProviderId, getPhoneNumberByE164,
  type MessageStatus, type SupabaseClient,
} from "@bis/db";
import { verifyTelnyxSignature } from "@/lib/voice/telnyx-signature";
import { toE164 } from "@/lib/voice/phone-number";

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
};
type TelnyxWebhookBody = {
  data?: { event_type?: string; payload?: TelnyxPayload };
};

async function handleInbound(db: SupabaseClient, payload: TelnyxPayload | undefined): Promise<void> {
  const calledNumber = toE164(payload?.to?.[0]?.phone_number ?? null);
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
  const phoneRow = await getPhoneNumberByE164(db, calledNumber);
  if (!phoneRow) {
    log("inbound text to a number this platform does not own", calledNumber);
    return;
  }
  const accountId = phoneRow.account_id;

  // Match an existing contact on this account by phone, or create one —
  // createContact already dedupes on phone (contacts.ts's findDuplicate),
  // so a single call gets both cases: a known customer's text joins their
  // existing thread instead of forking a duplicate contact.
  const fromNumber = toE164(payload?.from?.phone_number ?? null);
  const contact = await createContact(
    db, accountId, { phone: fromNumber ?? undefined }, ACTOR_ID, ACTOR_TYPE,
  );
  const conversation = await ensureConversation(db, accountId, contact.id, ACTOR_ID, ACTOR_TYPE);
  await createMessage(db, accountId, {
    conversationId: conversation.id, channel: "sms", direction: "inbound",
    body: payload?.text ?? "",
  }, ACTOR_ID, ACTOR_TYPE);
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
    log("rejected: invalid signature");
    return NextResponse.json({ error: "invalid signature" }, { status: 401 });
  }

  let body: TelnyxWebhookBody;
  try {
    body = JSON.parse(rawBody);
  } catch {
    log("rejected: malformed JSON body past a valid signature");
    return NextResponse.json({ ok: true });
  }

  const eventType = body.data?.event_type;
  const payload = body.data?.payload;
  const db = serviceDb();

  // Everything past the signature check acks 200 no matter what happens
  // inside: a webhook that 500s gets retried forever, and nothing below
  // this point is an error the provider can fix by retrying. Any unexpected
  // throw (a DB blip, a malformed payload past the type guards) logs and
  // falls through to the same 200 a graceful no-op would return.
  try {
    if (eventType === "message.received") {
      await handleInbound(db, payload);
    } else if (eventType === "message.sent" || eventType === "message.finalized") {
      await handleStatus(db, payload);
    } else {
      log("ignoring unrecognised event_type", eventType);
    }
  } catch (e) {
    log("unexpected failure handling webhook", eventType, String(e));
  }
  return NextResponse.json({ ok: true });
}
