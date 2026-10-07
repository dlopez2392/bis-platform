// The missed-call text-back, as a prepare/deliver pair.
//
// It lived inline in `finishCall` until 2026-09-17, when a second caller
// appeared for it: a transfer that rings out with nobody picking up. That
// path is reached from `/api/voice/texml/handoff-result`, long after the
// socket and its `CallState` are gone, so the logic had to become something
// both callers could hold. A THIRD caller arrived with the consent chain's
// PR-1: the release pass (`releaseTextback`, below), which sends at 08:00 a
// text-back the send gate held overnight.
//
// A SECOND COPY WAS THE ALTERNATIVE AND IT WAS REJECTED. What lives here is
// not a template — it is policy: which accounts may text at all, the
// per-caller cooldown, the send gate, and write-then-send so a provider
// failure is a visible message rather than a silent gap. Two copies of that
// is two things to keep in step, and the one that drifts is always the one
// nobody is looking at.
//
// The shape is `lib/sms/alerts.ts`'s, deliberately: `prepare…` does every
// read and every write and returns what to send, `deliver…` does the network
// call. That split exists because the send is a carrier round trip inside an
// invocation with a caller waiting on it, and it must never sit in front of
// the durable record — or, in the handoff case, in front of the apology the
// caller is holding a silent line to hear. The gate follows the same split:
// `decideSms` in prepare, `deliverSms` in deliver.
import type { serviceDb, AutomationLogRow } from "@bis/db";
import {
  createContact, fillContactBlanks, ensureConversation, createMessage,
  updateMessageStatus, hasRecentOutboundSms, recordAutomationLog, getVoiceProfile, getBranding,
  callerInTouchSince,
} from "@bis/db";
import { resolveSmsSender } from "@/lib/sms/sender";
import { decideSms, deliverSms, type ClearedSms } from "@/lib/consent/gate";
import { writeHeld, logSkipped, subjectOf, REASONS, BLOCK_REASONS, type LogSubject, type Releaser } from "@/lib/automations/hold-or-send";
import { LEDGER_RETRY_MS, pastRetryAge, type AutomationBlockReason } from "@/lib/automations/send-sms";
import { brandDisplayName } from "@/lib/email/templates/shell";
import { defaultTextbackBody } from "./textback-body";
import { recordUsageSafely } from "@/lib/billing/usage";

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
 * limit, not an opt-out: a stop is the ledger's (lib/consent/gate.ts).
 *
 * MODULE-PRIVATE ON PURPOSE. finish-call.test.ts pins the window with its
 * own literal 24h rather than importing this — a test that reads the
 * constant it is checking proves only that multiplication works.
 */
const TEXTBACK_COOLDOWN_HOURS = 24;
const TEXTBACK_COOLDOWN_MS = TEXTBACK_COOLDOWN_HOURS * 60 * 60 * 1000;

export interface TextbackRequest {
  /** E.164, already normalised. No number, no text — the caller decides that. */
  callerNumber: string;
  /** A contact this call already established, if any. Null means resolve one
   *  from caller ID: the minimal "Caller" + number record. */
  contactId: string | null;
  /** Overrides how a null `contactId` is resolved. A FUNCTION, not an id, so
   *  it runs on the far side of the A2P check: an account that is not
   *  cleared to text must not accumulate contacts for callers it can never
   *  reach. */
  resolveContact?: () => Promise<string | null>;
  /** The language the CALLER spoke, not the profile's setting. */
  language: "en" | "es";
  /** Customer-facing name, `brandDisplayName` already applied. NEVER
   *  `accounts.name` — that is the agency's internal label and it reached a
   *  stranger's phone from this exact context once already. */
  brandName: string;
  /** `voice_profiles.textback_body`. Empty means use the live default. */
  textbackBody: string;
  /** Identifies the call in log lines. */
  label: string;
  /** The call's row id: the automation-log subject (`call:<id>`) and what a
   *  release re-reads. Null — a call whose row was never written — cannot
   *  be held, so outside the hours such a text-back is not sent (logged). */
  callId: string | null;
  /** The instant the hours are judged at. finishCall passes the call's own
   *  end; the release pass its tick; the handoff route the present. */
  now: Date;
  /** True on the 08:00 release of a text-back held overnight: the default
   *  body drops "just now" (danlo, 2026-09-26). */
  held?: boolean;
  /** When the call ended: the payload's `missedAt`, and what "in touch
   *  since" and the re-hold age cap are judged from. Defaults to `now`
   *  (finishCall and the handoff route pass the call's own end as `now`);
   *  the release passes the held payload's, never its own tick. */
  missedAt?: Date;
}

/** What a release needs that the call row cannot cheaply re-derive.
 *  `missedAt`: the call's own end, the instant "in touch since" is judged
 *  from (absent on a payload written before it existed). */
export type TextbackPayload = {
  callerNumber: string; contactId: string; conversationId: string; language: "en" | "es"; missedAt?: string;
};

export function parseTextbackPayload(raw: unknown): TextbackPayload | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const p = raw as Record<string, unknown>;
  if (typeof p.callerNumber !== "string" || typeof p.contactId !== "string" || typeof p.conversationId !== "string") return null;
  if (p.language !== "en" && p.language !== "es") return null;
  const missedAt = typeof p.missedAt === "string" && Number.isFinite(Date.parse(p.missedAt)) ? p.missedAt : undefined;
  return { callerNumber: p.callerNumber, contactId: p.contactId, conversationId: p.conversationId, language: p.language, ...(missedAt ? { missedAt } : {}) };
}

/**
 * What `prepareTextback` resolved, whether or not anything is being sent.
 *
 * The ids come back even when `pending` is null, and that is load-bearing for
 * `finishCall`: a suppressed text-back still hands its contact and
 * conversation to the call row, so the call is not orphaned from its thread.
 * Collapsing this to `PendingTextback | null` would silently drop that, and
 * the only symptom would be a dashboard with no path from a call to its own
 * conversation.
 */
export interface TextbackOutcome {
  /** Null only when the A2P check refused — nothing was written at all. */
  contactId: string | null;
  conversationId: string | null;
  /** Null when nothing goes out NOW; `notSent` says why. */
  pending: PendingTextback | null;
  notSent: null | "sender_refused" | "no_contact" | "cooldown" | "held" | "blocked" | "unheld";
}

export interface PendingTextback {
  messageId: string;
  conversationId: string;
  /** The gate's clearance: the number, the sender and the text as it will go. */
  cleared: ClearedSms;
  /** The automation-log subject, or null for a call with no row. */
  subject: LogSubject | null;
  /** The instant the decision was judged at: a delivery-time re-hold waits
   *  LEDGER_RETRY_MS from here (re-review A). */
  now: Date;
}

/**
 * The contact a caller-ID-only call gets: first name "Caller", their number,
 * source voice. `createContact` dedupes, and a hit backfills blanks rather
 * than writing a second record.
 */
export async function contactForCallerId(
  db: VoiceDb, accountId: string, callerNumber: string,
): Promise<string> {
  const created = await createContact(db, accountId, {
    firstName: "Caller", phone: callerNumber, source: "voice",
  }, ACTOR_ID, ACTOR_TYPE);
  if (created.existing) {
    // Safe as it stands: this dedupes on the caller ID ALONE, so a match IS
    // the caller's own contact and the phone fill is a no-op. Never add an
    // email or name here without checking the match's phone is the caller ID.
    try {
      await fillContactBlanks(db, accountId, created.id, { phone: callerNumber }, ACTOR_ID, ACTOR_TYPE);
    } catch (e) {
      console.error(`textback fillContactBlanks failed for ${created.id}: ${String(e)}`);
    }
  }
  return created.id;
}

async function record(db: VoiceDb, w: Parameters<typeof recordAutomationLog>[1], label: string): Promise<void> {
  try {
    await recordAutomationLog(db, w);
  } catch (e) {
    console.error(`${label}: text-back log write failed (${w.status}): ${String(e)}`);
  }
}

/**
 * Everything up to and including the message row: the A2P check, the body,
 * the contact, the conversation, the cooldown, the SEND GATE's decision, the
 * row. `pending` comes back null when nothing goes out now, and `notSent`
 * and the console say why.
 *
 * THE A2P CHECK IS FIRST, before any row is written, so an account that is
 * not cleared to text does not accumulate contacts and conversations for
 * callers it can never reach. The gate runs it again; that is its own read.
 *
 * Outside the hours (a call missed at 22:00) the gate DEFERS: the text-back
 * is held on the automation log (source `textback`, subject `call:<id>`)
 * with what a release needs, and `releaseTextback` sends it at 08:00 through
 * this same function (spec §4.1 item 4). A stop, a hold or an unconfirmed
 * number BLOCKS it: one skipped row with the reason, no message row. An
 * unreadable ledger is a different thing from either: an outage, not an
 * answer, so it re-holds for LEDGER_RETRY_MS rather than logging a refusal
 * (review R2-I4).
 *
 * THROWS on an unexpected failure. Every caller wraps it.
 */
export async function prepareTextback(
  db: VoiceDb, accountId: string, r: TextbackRequest,
): Promise<TextbackOutcome> {
  const sender = await resolveSmsSender(db, accountId);
  if (!sender.ok) return { contactId: null, conversationId: null, pending: null, notSent: "sender_refused" };

  // The operator's own body is never translated: they chose those words for
  // their own customers. Only the DEFAULT follows the caller's language. The
  // STOP line is the gate's to add (the registry's footer for voice.textback).
  const body = r.textbackBody.trim() || defaultTextbackBody(r.brandName, r.language, r.held === true);

  const contactId = r.contactId
    ?? (r.resolveContact ? await r.resolveContact() : await contactForCallerId(db, accountId, r.callerNumber));
  // A resolver that came back empty is not an error: `finishCall`'s can, when
  // there is neither a lead nor a caller id to build a contact from. Nothing
  // to hang a conversation on, so nothing to send.
  if (!contactId) return { contactId: null, conversationId: null, pending: null, notSent: "no_contact" };
  const conversation = await ensureConversation(db, accountId, contactId, ACTOR_ID, ACTOR_TYPE);
  const conversationId = conversation.id;

  // The cooldown, consulted AFTER the conversation exists (that is what "this
  // caller" is keyed on) and BEFORE the message row is written. Judged from
  // `r.now` — the instant the hours are judged at — never the wall clock:
  // the release pass replays this against its OWN tick, not the real time.
  const since = new Date(r.now.getTime() - TEXTBACK_COOLDOWN_MS);
  if (await hasRecentOutboundSms(db, accountId, conversationId, since)) {
    console.error(
      `${r.label}: text-back suppressed — conversation ${conversationId} ` +
      `already had an outbound SMS within ${TEXTBACK_COOLDOWN_HOURS}h`,
    );
    return { contactId, conversationId, pending: null, notSent: "cooldown" };
  }

  const subject: LogSubject | null = r.callId === null ? null : {
    accountId, source: "textback", channel: "sms", subjectKey: `call:${r.callId}`, contactId,
    payload: { callerNumber: r.callerNumber, contactId, conversationId, language: r.language, missedAt: (r.missedAt ?? r.now).toISOString() } satisfies TextbackPayload,
  };
  const decision = await decideSms(db, {
    accountId, kind: "voice.textback", to: r.callerNumber, body, contactId, language: r.language, now: r.now,
    // The caller ID, from the carrier: not held on the contact's stored
    // phone_country_unconfirmed, which is about a number a person typed.
    numberFromCarrier: true,
  });
  // An unreadable consent state (or zone) is an outage, not an answer: hold
  // it LEDGER_RETRY_MS and let the release try again (review R2-I4). A
  // failed row would leave the queue, and a text-back has no pass to retry.
  const retry = decision.kind === "blocked" && decision.reason === "ledger_unavailable";
  if (decision.kind === "deferred" || retry) {
    if (!subject) {
      console.error(`${r.label}: text-back NOT sent — ${retry ? "consent state unreadable" : "outside the sending hours"}, and a call with no row cannot be held`);
      return { contactId, conversationId, pending: null, notSent: "unheld" };
    }
    // The call row still gets its contact and conversation if the hold write
    // fails: logged, and this call's text-back is lost (review R2 minor).
    try {
      if (decision.kind === "deferred") await writeHeld({ db }, subject, decision.until, decision.zone);
      else await writeHeld({ db }, subject, new Date(r.now.getTime() + LEDGER_RETRY_MS), "UTC", REASONS.ledgerRetry);
    } catch (e) {
      console.error(`${r.label}: text-back NOT held, the hold write failed: ${String(e)}`);
      return { contactId, conversationId, pending: null, notSent: "unheld" };
    }
    return { contactId, conversationId, pending: null, notSent: "held" };
  }
  if (decision.kind === "blocked") {
    console.error(`${r.label}: text-back not sent — the send gate refused it (${decision.reason})`);
    // stop_confirmation_stale cannot occur: a text-back never asks for the
    // stop confirmation's own exception (kind is always "voice.textback").
    // Excluded here, alongside ledger_unavailable, so this narrows to
    // AutomationBlockReason for recordBlocked/BLOCK_REASONS (consent PR-2).
    if (subject && decision.reason !== "ledger_unavailable" && decision.reason !== "stop_confirmation_stale") {
      await recordBlocked(db, subject, decision.reason, r.label);
    }
    return { contactId, conversationId, pending: null, notSent: "blocked" };
  }

  // WRITE THEN SEND: the row exists before anything leaves the building, with
  // the text exactly as the gate will send it. No unread bump — this text is
  // OURS, and unread counts inbound.
  const { id: messageId } = await createMessage(db, accountId, {
    conversationId, channel: "sms", direction: "outbound", body: decision.send.body,
  }, ACTOR_ID, ACTOR_TYPE);
  return {
    contactId, conversationId, notSent: null,
    pending: { messageId, conversationId, cleared: decision.send, subject, now: r.now },
  };
}

/** A refusal, in the client's words. An unreadable ledger is never one: it
 *  is a re-hold (prepare and deliver handle it before this). */
async function recordBlocked(db: VoiceDb, subject: LogSubject, reason: AutomationBlockReason, label: string): Promise<void> {
  await record(db, { ...subject, status: "skipped", reason: BLOCK_REASONS[reason] }, label);
}

/**
 * The network half, and it NEVER THROWS: every caller reaches it after the
 * thing that mattered — a call row, or a spoken apology — is already settled.
 * Returns what happened, for the release pass.
 *
 * The gate re-reads the ledger here (`deliverSms`), so a stop that landed
 * after `prepareTextback` still wins: the message row is marked failed with
 * the reason, and nothing is sent. An unreadable ledger AT DELIVERY re-holds
 * for LEDGER_RETRY_MS instead (re-review A): the message row is marked
 * failed (a new one is written on release), and the automation-log row is
 * held again rather than dropped.
 *
 * `label` identifies the call in the log lines. They are the only trace a
 * failure leaves, so their wording is a contract: finish-call.test.ts
 * asserts "text-back failed".
 */
export async function deliverTextback(
  db: VoiceDb, accountId: string, pending: PendingTextback, label: string,
): Promise<"sent" | "failed" | "skipped" | "held"> {
  const { messageId, cleared, subject } = pending;
  try {
    const result = await deliverSms(db, cleared);
    if (result.kind === "blocked") {
      try {
        await updateMessageStatus(db, accountId, messageId, "failed",
          { error: `not sent: ${result.reason}` }, ACTOR_ID, ACTOR_TYPE);
      } catch (statusError) {
        console.error(`${label}: could not mark message ${messageId} failed: ${String(statusError)}`);
      }
      if (result.reason === "ledger_unavailable") {
        // An outage, not an answer (re-review A; G3): held again for
        // LEDGER_RETRY_MS, never a failed row that drops the text-back. The
        // release re-prepares it (a new message row) and applies the age cap.
        if (!subject) {
          console.error(`${label}: text-back NOT sent — consent state unreadable at delivery, and a call with no row cannot be held`);
          return "failed";
        }
        await writeHeld({ db }, subject, new Date(pending.now.getTime() + LEDGER_RETRY_MS), "UTC", REASONS.ledgerRetry);
        console.error(`${label}: text-back held again — consent state unreadable at delivery`);
        return "held";
      }
      if (result.reason === "stop_confirmation_stale") {
        // Cannot occur: deliverTextback's `cleared` is always kind
        // "voice.textback", which the gate never treats as a stop
        // confirmation (consent PR-2). Logged so a real occurrence would be
        // visible rather than silently mis-typed into recordBlocked.
        console.error(`${label}: text-back refused as a stale stop confirmation, which a text-back can never be`);
        return "skipped";
      }
      if (subject) await recordBlocked(db, subject, result.reason, label);
      console.error(`${label}: text-back not sent — the send gate refused it at delivery (${result.reason})`);
      return "skipped";
    }
    if (result.kind !== "sent") {
      // `deferred` cannot come back from deliverSms; a `failed` is the carrier's.
      const error = result.kind === "failed" ? result.error : "unexpected gate answer";
      try {
        await updateMessageStatus(db, accountId, messageId, "failed", { error }, ACTOR_ID, ACTOR_TYPE);
      } catch (statusError) {
        console.error(`${label}: could not mark message ${messageId} failed: ${String(statusError)}`);
      }
      if (subject) await record(db, { ...subject, status: "failed", reason: REASONS.failed }, label);
      throw new Error(error);
    }
    // The `sent` write FIRST, straight after the send: it stores the provider
    // id Telnyx's status webhook correlates against. USAGE (client billing)
    // in its `finally`: the text reached the customer, so its segments bill
    // even when that write throws into the catch below.
    try {
      await updateMessageStatus(db, accountId, messageId, "sent",
        { providerMessageId: result.providerMessageId }, ACTOR_ID, ACTOR_TYPE);
    } finally {
      if (result.billable) {
        await recordUsageSafely(db, {
          accountId, meter: "sms", quantity: result.segments,
          occurredAt: new Date(), sourceRef: `message:${messageId}`,
        }, label);
      }
    }
    if (subject) await record(db, { ...subject, status: "sent", reason: "" }, label);
    return "sent";
  } catch (e) {
    console.error(`${label}: text-back failed: ${String(e)}`);
    return "failed";
  }
}

/**
 * The release (source `textback`, from release-held.ts): the call missed at
 * 22:00 gets its text at 08:00. Re-reads the voice profile (the operator may
 * have turned the text-back off, or rewritten it, overnight) and the brand,
 * then runs `prepareTextback` again from the held row's payload — every
 * check re-applies, the cooldown included — and delivers.
 *
 * The re-hold age cap runs FIRST (danlo, 2026-09-26): a release more than 24h
 * after the call — however many times it was re-held for an outage — stops
 * here, skipped, rather than texting "Sorry we missed your call" days late.
 * Then the "has this caller been in touch since" check: a caller who called
 * or texted since the missed call has been served, and the 08:00 text would
 * talk over them.
 */
export const releaseTextback: Releaser = async (ctx, row: AutomationLogRow) => {
  const match = /^call:(.+)$/.exec(row.subject_key);
  const payload = parseTextbackPayload(row.payload);
  if (!match || !payload) {
    await logSkipped(ctx, subjectOf(row), REASONS.noLongerDue);
    return "skipped";
  }
  const db = ctx.db as VoiceDb;
  const profile = await getVoiceProfile(db, row.account_id);
  if (!profile?.textback_enabled) {
    await logSkipped(ctx, subjectOf(row), REASONS.recipeOff);
    return "skipped";
  }
  const label = `release textback call ${match[1]}`;
  // The re-hold age cap (orchestrator, 2026-09-26): every hold ends in this
  // release, so a text-back more than RETRY_MAX_AGE_MS after the call stops
  // here, whatever held it (an outage, or the hours after one). A payload
  // from before `missedAt` falls back to the row's last write.
  const missedAt = payload.missedAt ?? row.occurred_at;
  if (pastRetryAge(new Date(missedAt), ctx.now)) {
    await logSkipped(ctx, subjectOf(row), REASONS.tooLongAfterCall);
    return "skipped";
  }
  // danlo, 2026-09-26: a caller who has called or texted since the missed call
  // has been served; the 08:00 text would talk over them.
  let inTouch: boolean;
  try {
    inTouch = await callerInTouchSince(db, row.account_id, payload.callerNumber, payload.conversationId, missedAt);
  } catch (e) {
    // An outage, not an answer: try again in LEDGER_RETRY_MS (review R2-I4).
    console.error(`${label}: could not check whether the caller has been in touch; held again: ${String(e)}`);
    await writeHeld(ctx, subjectOf(row), new Date(ctx.now.getTime() + LEDGER_RETRY_MS), "UTC", REASONS.ledgerRetry);
    return "held";
  }
  if (inTouch) {
    await logSkipped(ctx, subjectOf(row), REASONS.heardBack);
    return "skipped";
  }
  const branding = await getBranding(db, row.account_id);
  const outcome = await prepareTextback(db, row.account_id, {
    callerNumber: payload.callerNumber, contactId: payload.contactId, language: payload.language,
    brandName: brandDisplayName(branding), textbackBody: profile.textback_body ?? "",
    label, callId: match[1]!, now: ctx.now, held: true, missedAt: new Date(missedAt),
  });
  if (outcome.pending) return deliverTextback(db, row.account_id, outcome.pending, label);
  switch (outcome.notSent) {
    case "held": return "held";
    case "blocked": return "skipped";
    // A hold write that failed at RELEASE (I1, 2026-09-27): the row's past
    // held_until is untouched, so it is examined again next tick — never
    // logged "No longer due" and abandoned. No write here on purpose: this
    // IS the retry, not a new decision.
    case "unheld": return "failed";
    case "cooldown":
      await logSkipped(ctx, subjectOf(row), REASONS.recentText);
      return "skipped";
    case "sender_refused":
      await logSkipped(ctx, subjectOf(row), REASONS.smsGate);
      return "skipped";
    default:
      await logSkipped(ctx, subjectOf(row), REASONS.noLongerDue);
      return "skipped";
  }
};
