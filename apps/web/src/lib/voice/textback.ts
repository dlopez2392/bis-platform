// The missed-call text-back, as a prepare/deliver pair.
//
// It lived inline in `finishCall` until 2026-09-17, when a second caller
// appeared for it: a transfer that rings out with nobody picking up. That
// path is reached from `/api/voice/texml/handoff-result`, long after the
// socket and its `CallState` are gone, so the logic had to become something
// both callers could hold.
//
// A SECOND COPY WAS THE ALTERNATIVE AND IT WAS REJECTED. What lives here is
// not a template — it is policy: which accounts may text at all, the
// disclosure CTIA requires, the per-caller cooldown, and write-then-send so
// a provider failure is a visible message rather than a silent gap. Two
// copies of that is two things to keep in step, and the one that drifts is
// always the one nobody is looking at.
//
// The shape is `lib/sms/alerts.ts`'s, deliberately: `prepare…` does every
// read and every write and returns what to send, `deliver…` does the network
// call. That split exists because the send is a carrier round trip inside an
// invocation with a caller waiting on it, and it must never sit in front of
// the durable record — or, in the handoff case, in front of the apology the
// caller is holding a silent line to hear.
import type { serviceDb } from "@bis/db";
import {
  createContact, fillContactBlanks, ensureConversation, createMessage,
  updateMessageStatus, hasRecentOutboundSms,
} from "@bis/db";
import { getSmsProvider } from "@/lib/sms";
import { resolveSmsSender } from "@/lib/sms/sender";
import { defaultTextbackBody } from "./textback-body";
import { withOptOut } from "@/lib/sms/opt-out";
import { segmentsFor } from "@/lib/sms/segments";
import type { SmsProvider } from "@/lib/sms/types";
import { recordUsageSafely, smsBillable } from "@/lib/billing/usage";

/** The service-role client every voice write goes through, named the way
 *  finish-call.ts names it rather than reaching for @supabase/supabase-js,
 *  which apps/web does not depend on directly. */
type VoiceDb = ReturnType<typeof serviceDb>;

const ACTOR_ID = "voice";
const ACTOR_TYPE = "ai" as const;

/**
 * How long after one outbound SMS this caller gets another.
 *
 * A repeat abandoned caller would otherwise get a byte-identical message on
 * every call, and repeated identical bodies to one number is exactly what
 * carrier filtering hunts for under 10DLC — with the CLIENT'S OWN A2P
 * registration as the thing that gets blocked, not ours. This is a rate
 * limit, not an opt-out: STOP is enforced upstream at the carrier level by
 * Telnyx, deliberately not reimplemented here.
 *
 * MODULE-PRIVATE ON PURPOSE, and it stayed that way when this moved out of
 * finish-call.ts. finish-call.test.ts pins the window with its own literal
 * 24h rather than importing this — a test that reads the constant it is
 * checking proves only that multiplication works, and would stay green if
 * someone quietly dropped this to an hour.
 */
const TEXTBACK_COOLDOWN_HOURS = 24;
const TEXTBACK_COOLDOWN_MS = TEXTBACK_COOLDOWN_HOURS * 60 * 60 * 1000;

export interface TextbackRequest {
  /** E.164, already normalised. No number, no text — the caller decides that. */
  callerNumber: string;
  /** A contact this call already established, if any. Null means resolve one
   *  from caller ID: the minimal "Caller" + number record. */
  contactId: string | null;
  /** Overrides how a null `contactId` is resolved.
   *
   *  `finishCall` passes its own resolver because a call with a captured lead
   *  has a richer contact to make than caller ID alone — name, email, the
   *  callback number the caller gave. It is a FUNCTION rather than a resolved
   *  id so that it runs on the far side of the send gate: an account that is
   *  not cleared to text must not accumulate contacts for callers it can
   *  never reach, and that ordering is the whole reason the gate is the first
   *  thing this module does. */
  resolveContact?: () => Promise<string | null>;
  /** The language the CALLER spoke, not the profile's setting. */
  language: "en" | "es";
  /** Customer-facing name, `brandDisplayName` already applied. NEVER
   *  `accounts.name` — that is the agency's internal label and it reached a
   *  stranger's phone from this exact context once already. */
  brandName: string;
  /** `voice_profiles.textback_body`. Empty means use the live default, which
   *  is deliberately never persisted. */
  textbackBody: string;
  /** Identifies the call in log lines. */
  label: string;
}

/**
 * What `prepareTextback` resolved, whether or not anything is being sent.
 *
 * The ids come back even when `pending` is null, and that is load-bearing for
 * `finishCall`: a cooldown-suppressed text-back still hands its contact and
 * conversation to the call row, so the call is not orphaned from the thread
 * it belongs to. Collapsing this to `PendingTextback | null` would silently
 * drop that, and the only symptom would be a dashboard with no path from a
 * call to its own conversation.
 */
export interface TextbackOutcome {
  /** Null only when the send gate refused — nothing was written at all. */
  contactId: string | null;
  conversationId: string | null;
  /** Null when nothing should go out: gate refused, or cooldown. */
  pending: PendingTextback | null;
}

export interface PendingTextback {
  messageId: string;
  conversationId: string;
  to: string;
  from: string;
  body: string;
}

/**
 * The contact a caller-ID-only call gets: first name "Caller", their number,
 * source voice. `createContact` dedupes, and a hit backfills blanks rather
 * than writing a second record.
 *
 * Exported because `finishCall`'s own `resolveContactId` ends on this exact
 * branch for an abandoned call, and a handed-off call that rang out is the
 * same situation reached by a different road.
 */
export async function contactForCallerId(
  db: VoiceDb, accountId: string, callerNumber: string,
): Promise<string> {
  const created = await createContact(db, accountId, {
    firstName: "Caller", phone: callerNumber, source: "voice",
  }, ACTOR_ID, ACTOR_TYPE);
  if (created.existing) {
    try {
      await fillContactBlanks(db, accountId, created.id, { phone: callerNumber }, ACTOR_ID, ACTOR_TYPE);
    } catch (e) {
      console.error(`textback fillContactBlanks failed for ${created.id}: ${String(e)}`);
    }
  }
  return created.id;
}

/**
 * Everything up to and including the message row: the send gate, the body,
 * the conversation, the cooldown, the row. `pending` comes back null when
 * nothing should go out, and the reason is on the console in every such case.
 *
 * THE GATE IS CONSULTED FIRST, before any row is written, so an account that
 * is not cleared to text does not quietly accumulate contacts and
 * conversations for callers it can never reach.
 *
 * THROWS on an unexpected failure. Both callers wrap it — this function has
 * no opinion about what a caller should do when the database is down, and
 * swallowing it here would deny them the choice.
 */
export async function prepareTextback(
  db: VoiceDb, accountId: string, r: TextbackRequest,
): Promise<TextbackOutcome> {
  const gate = await resolveSmsSender(db, accountId);
  if (!gate.ok) return { contactId: null, conversationId: null, pending: null };

  // withOptOut wraps BOTH branches, the operator's own body included — the
  // one place this platform overrides an operator's exact words, because the
  // disclosure is what CTIA requires of a programme message and what the A2P
  // campaign samples are checked against. Idempotent, so an operator who
  // already wrote "Reply STOP to opt out" gets nothing appended. Applied
  // here, where the body is built, so the row records what actually went out.
  //
  // The operator's own body is never translated: they chose those words for
  // their own customers. Only the DEFAULT follows the caller's language.
  const body = withOptOut(
    r.textbackBody.trim() || defaultTextbackBody(r.brandName, r.language),
    r.language,
  );

  const contactId = r.contactId
    ?? (r.resolveContact ? await r.resolveContact() : await contactForCallerId(db, accountId, r.callerNumber));
  // A resolver that came back empty is not an error: `finishCall`'s can,
  // when there is neither a lead nor a caller id to build a contact from.
  // Nothing to hang a conversation on, so nothing to send.
  if (!contactId) return { contactId: null, conversationId: null, pending: null };
  const conversation = await ensureConversation(db, accountId, contactId, ACTOR_ID, ACTOR_TYPE);
  const conversationId = conversation.id;

  // The cooldown, consulted AFTER the conversation exists (that is what "this
  // caller" is keyed on) and BEFORE the message row is written, so a
  // suppressed text-back writes no row and sends nothing — an outbound row
  // nobody sent would be a lie in the operator's inbox.
  const since = new Date(Date.now() - TEXTBACK_COOLDOWN_MS);
  if (await hasRecentOutboundSms(db, accountId, conversationId, since)) {
    // Logged at error level like every other diagnostic here: suppression is
    // the feature working, not a failure, but it is also the ONLY trace a
    // caller who expected a text and did not get one leaves anywhere.
    console.error(
      `${r.label}: text-back suppressed — conversation ${conversationId} ` +
      `already had an outbound SMS within ${TEXTBACK_COOLDOWN_HOURS}h`,
    );
    return { contactId, conversationId, pending: null };
  }

  // WRITE THEN SEND: the row exists before anything leaves the building, so a
  // provider failure is a visible message rather than a silent gap. No unread
  // bump — this text is OURS, and unread counts inbound.
  const { id: messageId } = await createMessage(db, accountId, {
    conversationId, channel: "sms", direction: "outbound", body,
  }, ACTOR_ID, ACTOR_TYPE);
  return {
    contactId, conversationId,
    pending: { messageId, conversationId, to: r.callerNumber, from: gate.from, body },
  };
}

/**
 * The network half. ONLY the send is guarded.
 *
 * Once `send()` has returned, the text is gone and irrevocably out the door,
 * so a failure recording that must never re-label the row `failed`: it would
 * tell the operator a delivered text never went out and drop the provider id
 * the delivery webhook correlates against. That bookkeeping failure is logged
 * and the message is left exactly as written.
 *
 * NEVER THROWS. Both callers reach this after the thing that mattered — a
 * call row, or a spoken apology — is already settled.
 */
/**
 * The network half, and it NEVER THROWS: both callers reach it after the
 * thing that mattered — a call row, or a spoken apology — is already settled.
 *
 * `label` identifies the call in the two log lines this can produce. They are
 * the only trace either failure leaves, so their wording is a contract:
 * finish-call.test.ts asserts both strings.
 */
export async function deliverTextback(
  db: VoiceDb, accountId: string, pending: PendingTextback, label: string,
): Promise<void> {
  const { messageId, to, from, body } = pending;
  try {
    // ONLY the send is guarded. Once send() has returned, the text is gone and
    // irrevocably out the door, so a failure recording that — the `sent` write
    // below — must never be re-labelled `failed`: that would tell the operator
    // a delivered text never went out, and drop the provider id the delivery
    // webhook correlates against. That failure falls through to the outer
    // catch instead, where it is logged and the message is left exactly as
    // written. Identical reasoning to sendSmsAction (conversations/actions.ts).
    let providerMessageId: string;
    let provider: SmsProvider;
    try {
      provider = getSmsProvider();
      ({ providerMessageId } = await provider.send({ to, from, body }));
    } catch (sendError) {
      // Nothing left the building, so `failed` is the honest label — and it is
      // the only signal this failure has, since there is no retry and no human
      // watching.
      //
      // Its own try/catch, because this write is BOOKKEEPING and `sendError`
      // is the news. Awaited bare, a rejection here would replace the throw
      // below entirely: the outer catch would log a database error, the
      // genuine carrier failure would vanish, and the row would sit `queued`
      // with nothing saying why. The original error survives its own
      // bookkeeping either way.
      try {
        await updateMessageStatus(db, accountId, messageId, "failed",
          { error: sendError instanceof Error ? sendError.message : "unknown send failure" },
          ACTOR_ID, ACTOR_TYPE);
      } catch (statusError) {
        console.error(`${label}: could not mark message ${messageId} failed: ${String(statusError)}`);
      }
      throw sendError;
    }
    // The `sent` write FIRST, straight after the send: it stores the
    // provider id Telnyx's status webhook correlates against, and a webhook
    // that lands before it finds no row and is lost for good, so nothing may
    // sit in that gap. USAGE (client billing) in its `finally`: the text
    // reached the customer, so its segments bill even when that write throws
    // into the catch below; recordUsageSafely never throws, so it cannot
    // replace that write's error either. This one leg covers both callers
    // (finishCall and the handoff-result route).
    try {
      await updateMessageStatus(db, accountId, messageId, "sent",
        { providerMessageId }, ACTOR_ID, ACTOR_TYPE);
    } finally {
      if (smsBillable(provider)) {
        await recordUsageSafely(db, {
          accountId, meter: "sms", quantity: segmentsFor(body).segments,
          occurredAt: new Date(), sourceRef: `message:${messageId}`,
        }, label);
      }
    }
  } catch (e) {
    console.error(`${label}: text-back failed: ${String(e)}`);
  }
}
