import {
  documentRequestTarget, getDocumentRequest, documentRequestState, getBranding, getSendingIdentity, brandDisplayName,
  readAccountTimezone, claimDocumentRequestSend, clearDocumentRequestSend,
  ensureConversation, createMessage, updateMessageStatus, recordAutomationLog,
  type DocumentRequestRow, type DocumentRequestTarget, type SupabaseClient,
} from "@bis/db";
import { normalisePhone } from "@bis/db/phone";
import { sendSms } from "@/lib/consent/gate";
import { sendEmail } from "@/lib/consent/email-gate";
import { smsRecipientState } from "@/lib/consent/recipient-state";
import { resolveSmsSender } from "@/lib/sms/sender";
import {
  writeHeld, logSkipped, subjectOf, BLOCK_REASONS, EMAIL_BLOCK_REASONS, REASONS, type LogSubject, type Releaser,
} from "@/lib/automations/hold-or-send";
import { withTrailingLink } from "@/lib/automations/sms-link";
import { recordUsageSafely } from "@/lib/billing/usage";
import { emailBrand } from "@/lib/email/templates/shell";
import { documentRequestEmail, requestCopy } from "@/lib/email/templates/document-request";
import { normalizeReplyTo } from "@/lib/email/reply-to";
import type { MessageKey } from "@/lib/messages";
import { loggableError } from "@/lib/loggable-error";
import { requestUrl } from "./token";
import { itemsSentence } from "./customer-state";

/**
 * A document request's text or email (spec 4.2; plan deviation 11). Through THE gates: two
 * informational kinds, so a stopped or held number and an unsubscribed address are refused and the
 * automated sending hours apply. Outside them the send is HELD in automation_log (source
 * document_request, one row per request) and released by releaseDocumentRequest while the request is
 * still open. The text's conversation row is written before it leaves (the composer's WRITE THEN
 * SEND), with the staff member as its author (the person mark); an email's after it is sent. One
 * language end to end: the request's. Never throws; logs name the request id, never the link.
 */
export type DeliverOutcome = { kind: "sent" } | { kind: "held"; until: string; zone: string } | { kind: "blocked"; reason: MessageKey } | { kind: "failed" };
const LEDGER_RETRY_MS = 15 * 60_000;

/** A log write never changes what happened (hold-or-send.ts's `record` rule; plan review I4): a failed write is logged, never thrown. */
async function logQuietly(db: SupabaseClient, requestId: string, w: Parameters<typeof recordAutomationLog>[1]): Promise<void> {
  try {
    await recordAutomationLog(db, w);
  } catch (e) {
    console.error(`document request ${requestId}: What went out not written (${w.status}): ${loggableError(e)}`);
  }
}

// gate.ts step 2: `no_number` is a destination that cannot be texted, so it reads as the no-phone line.
const SMS_REASON: Record<string, MessageKey> = {
  // `held` is a consent check still IN PROGRESS, never a confirmed stop (`stopped`): its own words
  // say so (Task 4 fix round, S-07 2b review).
  stopped: "documents.request.reason.textsStopped", held: "documents.request.reason.textsHeld",
  a2p_not_approved: "documents.request.reason.textSetup", no_live_number: "documents.request.reason.textSetup",
  no_number: "documents.request.reason.noPhone", unconfirmed_number: "documents.request.reason.noPhone",
  // M7a PR-4 (review item 2): the account is paused for billing; the request email still goes (owner answer Q6).
  billing_paused: "documents.request.reason.accountPaused",
};
const EMAIL_REASON: Record<string, MessageKey> = {
  stopped: "documents.request.reason.emailStopped", held: "documents.request.reason.emailHeld",
  suppressed: "documents.request.reason.bounced", no_address: "documents.request.reason.noEmail",
};

// F-196: `clock` is a release's own (ctx.clock): the gates judge the hours at the send's instant, since under
// fan-out a release can run minutes after its tick's now. Every window and stamp still reads `now`. Absent on
// the staff path, whose now is the moment.
type DeliverArgs = { request: DocumentRequestRow; channel: "text" | "email"; actorId: string; origin: string; now: Date; clock?: () => Date };

/**
 * Where the at-most-once stamp stands while a delivery runs: `none` (never claimed, a lost claim, or
 * cleared), `held` (claimed and not cleared), `unknown` (the claim itself threw: the update may have
 * landed). Only a THROW while it is `none` is a failure before anything went out with no stamp held
 * (orchestrator ruling I1). An unclear provider failure is an ANSWER, never a throw, so it never is.
 */
type Stamp = { state: "none" | "held" | "unknown" };

type Attempt =
  | { ok: true; outcome: DeliverOutcome }
  | { ok: false; subject: LogSubject; retryable: boolean };

/** One delivery, with every throw caught and classified; writes nothing for a throw (the callers decide). */
async function attempt(db: SupabaseClient, a: DeliverArgs): Promise<Attempt> {
  const { request, channel, actorId, now, clock } = a;
  const accountId = request.account_id;
  const lang = request.language;
  const subject: LogSubject = {
    accountId, source: "document_request", channel: channel === "text" ? "sms" : "email",
    subjectKey: `document_request:${request.id}`, contactId: null, payload: { channel, actorId },
  };
  const stamp: Stamp = { state: "none" };
  try {
    const target = await documentRequestTarget(db, accountId, request);
    subject.contactId = target?.contactId ?? null;
    const branding = await getBranding(db, accountId);
    // The brand name, or "" when the account has none: the copy picks a no-name sentence then (fix round 2), and
    // the From name is what every other customer email sends (emailBrand's name), never "the business".
    const business = brandDisplayName(branding);
    const items = itemsSentence(request.items, lang);
    const url = requestUrl(a.origin, request.id);
    const zone = await readAccountTimezone(db, accountId);
    const c: Ctx = { request, target, actorId, now, sendAt: clock ?? (() => now), zone, subject, business, items, url, stamp };
    const outcome = channel === "text" ? await deliverText(db, c) : await deliverEmail(db, { ...c, branding, origin: a.origin });
    return { ok: true, outcome };
  } catch (e) {
    console.error(`document request ${request.id}: delivery by ${channel} failed (send stamp ${stamp.state}): ${loggableError(e)}`);
    return { ok: false, subject, retryable: stamp.state === "none" };
  }
}

/** The direct (staff) path: every failure is answered `failed` and written so, as it always was. */
export async function deliverDocumentRequest(db: SupabaseClient, a: DeliverArgs): Promise<DeliverOutcome> {
  const r = await attempt(db, a);
  if (r.ok) return r.outcome;
  await logQuietly(db, a.request.id, { ...r.subject, status: "failed", reason: REASONS.failed });
  return { kind: "failed" };
}

type Ctx = {
  request: DocumentRequestRow; target: DocumentRequestTarget | null; actorId: string; now: Date;
  /** The instant the gate judges the hours at: the release's clock, else `now`. */
  sendAt: () => Date; zone: string | null;
  subject: LogSubject; business: string; items: string; url: string; stamp: Stamp;
};

async function deliverText(db: SupabaseClient, c: Ctx): Promise<DeliverOutcome> {
  const { request, target, actorId, now, subject } = c;
  const accountId = request.account_id;
  if (!target?.contactId || !target.phone || !normalisePhone(target.phone)) {
    await logQuietly(db, request.id, { ...subject, status: "skipped", reason: REASONS.noPhone });
    return { kind: "blocked", reason: "documents.request.reason.noPhone" };
  }
  const contactId = target.contactId;
  // Re-review R1: at most once. The stamp is claimed inside prepare, i.e. after the gate cleared the send
  // and BEFORE the provider is called; a lost claim (another release sent it) sends nothing.
  let claimed = false;
  let lost = false;
  const body = withTrailingLink(requestCopy(request.language, c.business)("documentRequest.sms", { items: c.items }), c.url);
  const row: { messageId: string | null } = { messageId: null };
  const result = await sendSms(db, {
    accountId, kind: "staff.document_request_sms", to: target.phone, body, contactId, language: request.language,
    now: c.sendAt(), accountZone: c.zone,
  }, {
    prepare: async ({ body: sentBody }) => {
      c.stamp.state = "unknown";
      claimed = await claimDocumentRequestSend(db, accountId, request.id, now);
      c.stamp.state = claimed ? "held" : "none";
      if (!claimed) { lost = true; throw new Error("this request's text already went out"); }
      const convo = await ensureConversation(db, accountId, contactId, actorId);
      row.messageId = (await createMessage(db, accountId, { conversationId: convo.id, channel: "sms", direction: "outbound", body: sentBody }, actorId)).id;
    },
  });
  if (lost) return { kind: "sent" };
  if (claimed && result.kind !== "sent") {
    await clearDocumentRequestSend(db, accountId, request.id)
      .then(() => { c.stamp.state = "none"; })
      .catch((e: unknown) => console.error(`document request ${request.id}: the send stamp was not cleared after a send that did not go out: ${loggableError(e)}`));
  }
  if (result.kind === "deferred") {
    await writeHeld({ db }, subject, result.until, result.zone);
    return { kind: "held", until: result.until.toISOString(), zone: result.zone };
  }
  if (result.kind === "blocked") {
    if (result.reason === "ledger_unavailable") {
      const until = new Date(now.getTime() + LEDGER_RETRY_MS);
      await writeHeld({ db }, subject, until, "UTC", REASONS.ledgerRetry);
      return { kind: "held", until: until.toISOString(), zone: "UTC" };
    }
    const why = BLOCK_REASONS[result.reason as keyof typeof BLOCK_REASONS] ?? REASONS.failed;
    await logQuietly(db, request.id, { ...subject, status: "skipped", reason: why });
    return { kind: "blocked", reason: SMS_REASON[result.reason] ?? "documents.request.reason.failed" };
  }
  if (result.kind === "failed") {
    if (row.messageId) {
      await updateMessageStatus(db, accountId, row.messageId, "failed", { error: result.error }, actorId)
        .catch((e: unknown) => console.error(`document request ${request.id}: the text did not go out, and its failed status was not written: ${loggableError(e)}`));
    }
    await logQuietly(db, request.id, { ...subject, status: "failed", reason: REASONS.failed });
    return { kind: "failed" };
  }
  // sent: the text HAS left the building, so nothing below may turn this into "failed" (plan review I4).
  // The composer's order (conversations/actions.ts sendSmsAction): the status first, then usage; each caught on its own.
  if (row.messageId) {
    await updateMessageStatus(db, accountId, row.messageId, "sent", { providerMessageId: result.providerMessageId }, actorId)
      .catch((e: unknown) => console.error(`document request ${request.id}: sent, but the message status was not written: ${loggableError(e)}`));
    if (result.billable) {
      await recordUsageSafely(db, { accountId, meter: "sms", quantity: result.segments, occurredAt: now, sourceRef: `message:${row.messageId}` }, `document request ${request.id}`);
    }
  }
  await logQuietly(db, request.id, { ...subject, status: "sent" });
  return { kind: "sent" };
}

async function deliverEmail(db: SupabaseClient, c: Ctx & { branding: Awaited<ReturnType<typeof getBranding>>; origin: string }): Promise<DeliverOutcome> {
  const { request, target, actorId, now, subject } = c;
  const accountId = request.account_id;
  const to = target?.email?.trim();
  if (!target?.contactId || !to) {
    await logQuietly(db, request.id, { ...subject, status: "skipped", reason: REASONS.noEmail });
    return { kind: "blocked", reason: "documents.request.reason.noEmail" };
  }
  const contactId = target.contactId;
  const mail = documentRequestEmail({ brand: emailBrand(c.branding), business: c.business, items: c.items, url: c.url, locale: request.language });
  // The account's own sending address (M4d), as every other customer email sends it; unset falls back to EMAIL_FROM.
  const { fromEmail } = await getSendingIdentity(db, accountId);
  // Re-review R1: at most once. The stamp is claimed BEFORE the email is handed to the gate; cleared below
  // when it did not go out (or the gate threw).
  c.stamp.state = "unknown";
  const claimed = await claimDocumentRequestSend(db, accountId, request.id, now);
  c.stamp.state = claimed ? "held" : "none";
  if (!claimed) return { kind: "sent" };
  const result = await sendEmail({
    accountId, kind: "staff.document_request_email", contactId, to, fromName: c.business,
    fromAddress: fromEmail ?? undefined, replyTo: normalizeReplyTo(c.branding.replyToEmail),
    subject: mail.subject, body: mail.text, html: mail.html,
    language: request.language, origin: c.origin, now: c.sendAt(), accountZone: c.zone,
  }, { db }).catch(async (e: unknown) => {
    // The thrown path never holds. A clear that succeeds leaves no stamp, so a RELEASE may leave the row for the
    // next tick (I1); a clear that fails leaves the stamp held, so every path writes the row "failed".
    await clearDocumentRequestSend(db, accountId, request.id)
      .then(() => { c.stamp.state = "none"; })
      .catch((x: unknown) => console.error(`document request ${request.id}: the send stamp was not cleared: ${loggableError(x)}`));
    throw e;
  });
  if (result.kind !== "sent") {
    // Final fix (after re-review R1): the clear is AWAITED and NOT swallowed before any hold. A held row whose
    // request still carries sent_at would later be written "sent" by the releaser without a send. If the clear
    // fails, nothing is held: an answer that would have held is "failed" instead (staff can still Copy link).
    // A refusal or a failure holds nothing anyway, so it still reports what really happened (M2).
    const wouldHold = result.kind === "deferred"
      || (result.kind === "blocked" && (result.reason === "ledger_unavailable" || result.reason === "unsubscribe_unavailable"));
    try {
      await clearDocumentRequestSend(db, accountId, request.id);
      c.stamp.state = "none";
    } catch (e) {
      console.error(`document request ${request.id}: the email did not go out and its send stamp could not be cleared${wouldHold ? ", so it is not held" : ""}: ${loggableError(e)}`);
      if (wouldHold) {
        await logQuietly(db, request.id, { ...subject, status: "failed", reason: REASONS.failed });
        return { kind: "failed" };
      }
    }
  }
  if (result.kind === "deferred") {
    await writeHeld({ db }, subject, result.until, result.zone);
    return { kind: "held", until: result.until.toISOString(), zone: result.zone };
  }
  if (result.kind === "blocked") {
    if (result.reason === "ledger_unavailable" || result.reason === "unsubscribe_unavailable") {
      // holdOrSend's own two email retry lines: "couldn't check whether they can get emails" and the unsubscribe-link one.
      const until = new Date(now.getTime() + LEDGER_RETRY_MS);
      await writeHeld({ db }, subject, until, "UTC", result.reason === "ledger_unavailable" ? REASONS.emailLedgerRetry : REASONS.emailSetupRetry);
      return { kind: "held", until: until.toISOString(), zone: "UTC" };
    }
    const why = EMAIL_BLOCK_REASONS[result.reason] ?? REASONS.failed;
    await logQuietly(db, request.id, { ...subject, status: "skipped", reason: why });
    return { kind: "blocked", reason: EMAIL_REASON[result.reason] ?? "documents.request.reason.failed" };
  }
  if (result.kind === "failed") {
    await logQuietly(db, request.id, { ...subject, status: "failed", reason: REASONS.failed });
    return { kind: "failed" };
  }
  // The thread's row AFTER the send (a held email must leave no row); a crash between the two loses the
  // thread row only, never the email or its log line below.
  try {
    const convo = await ensureConversation(db, accountId, contactId, actorId);
    const msg = await createMessage(db, accountId, { conversationId: convo.id, channel: "email", direction: "outbound", subject: mail.subject, body: mail.text }, actorId);
    await updateMessageStatus(db, accountId, msg.id, "sent", { providerMessageId: result.providerMessageId }, actorId);
  } catch (e) {
    console.error(`document request ${request.id}: the email went out but its conversation row was not written: ${loggableError(e)}`);
  }
  await logQuietly(db, request.id, { ...subject, status: "sent" });
  return { kind: "sent" };
}

/** P6: what the dialog may offer. Text: the account can text, the target has a number we can text, and it has not stopped or been held. */
export async function requestChannels(
  db: SupabaseClient, ledger: SupabaseClient, accountId: string, target: DocumentRequestTarget | null,
): Promise<{ text: boolean; email: boolean }> {
  if (!target?.contactId) return { text: false, email: false };
  const email = Boolean(target.email?.trim());
  if (!normalisePhone(target.phone)) return { text: false, email };
  const [gate, state] = await Promise.all([
    resolveSmsSender(db, accountId).catch(() => null),
    smsRecipientState(ledger, accountId, { phone: target.phone, phone_country_unconfirmed: target.phoneCountryUnconfirmed }),
  ]);
  return { text: gate?.ok === true && state.kind === "ok", email };
}

/** A held request leaves only while it is still open: a revoked, completed or expired one is "No longer due". */
export const releaseDocumentRequest: Releaser = async (ctx, row) => {
  const match = /^document_request:([0-9a-f-]{36})$/.exec(row.subject_key);
  const payload = row.payload as { channel?: unknown; actorId?: unknown } | null;
  const channel = payload?.channel === "text" || payload?.channel === "email" ? payload.channel : null;
  const actorId = typeof payload?.actorId === "string" ? payload.actorId : null;
  if (!match || !channel || !actorId) {
    await logSkipped(ctx, subjectOf(row), REASONS.noLongerDue);
    return "skipped";
  }
  const request = await getDocumentRequest(ctx.db, row.account_id, match[1]!);
  // Re-review R1: release-held.ts never writes the held row itself; only this releaser's own "sent" write
  // dequeues it. A request whose stamp is set already went out (the release that sent it could not write
  // its row): write the row now and NEVER send again. A failed write here throws to release-held's catch
  // (errored), and the next tick tries the write again; it still sends nothing.
  if (request?.sent_at) {
    await recordAutomationLog(ctx.db, { ...subjectOf(row), status: "sent" });
    return "sent";
  }
  if (!request || documentRequestState(request, ctx.now) !== "open") {
    await logSkipped(ctx, subjectOf(row), REASONS.noLongerDue);
    return "skipped";
  }
  const r = await attempt(ctx.db, { request, channel, actorId, origin: ctx.origin, now: ctx.now, clock: ctx.clock });
  if (!r.ok) {
    // Orchestrator ruling I1 (textback.ts's 2026-09-27 rule): nothing went out and no stamp is held (a read, the
    // link key, a gate throw, a re-hold that could not be written), so the row is NOT written. THROWING is
    // release-held.ts's own contract for that: its per-row catch counts the row `errored` and writes nothing, so
    // the row keeps its past held_until and is examined next tick, as every other releaser's outage does
    // (holdOrSend rethrows). The 7-day expiry bounds it: the state check above then writes "No longer due".
    // The message names the request id only; the cause was logged by attempt() through loggableError.
    if (r.retryable) throw new Error(`document request ${request.id}: nothing went out; left held for the next tick`);
    await logQuietly(ctx.db, request.id, { ...r.subject, status: "failed", reason: REASONS.failed });
    return "failed";
  }
  const out = r.outcome;
  return out.kind === "sent" ? "sent" : out.kind === "held" ? "held" : out.kind === "blocked" ? "skipped" : "failed";
};
