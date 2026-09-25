import { ensureConversation, createMessage, updateMessageStatus } from "@bis/db";
import { SMS_RETRY_COOLDOWN_MS } from "./caps";
import { withOptOut } from "@/lib/sms/opt-out";
import { segmentsFor } from "@/lib/sms/segments";
import { recordUsageSafely, smsBillable } from "@/lib/billing/usage";
import type { SmsProvider } from "@/lib/sms/types";
import type { PassContext } from "./context";

/**
 * What the two helpers below actually need: the client and the LAZY SMS
 * getter — not the whole cron context. A full PassContext satisfies this
 * (it is a Pick), so every pass keeps handing over `ctx` unchanged; the
 * inline instant reply (instant-reply.ts, Milestone C) builds exactly these
 * two fields and never constructs the email provider it has no use for.
 */
export type SmsSendContext = Pick<PassContext, "db" | "sms">;

/** The messages rows automations write are the platform's, not a person's —
 *  the same actor shape the voice text-back uses ("voice"/"ai"). */
export const AUTOMATION_ACTOR_ID = "automation";
export const AUTOMATION_ACTOR_TYPE = "system" as const;

export type AutomationSmsInput = {
  accountId: string;
  contactId: string;
  /** E.164, already through toE164. */
  to: string;
  /** The account's live number, from resolveSmsSender. */
  from: string;
  body: string;
  /** The language THIS message is written in, which decides the language of
   *  the opt-out disclosure appended to it. Optional and defaulting to "en"
   *  because most passes have no locale to offer — the scheduled recipes
   *  (reminders, review requests, no-show nudges) compose English copy end to
   *  end. The form instant reply is the exception and passes the submission's
   *  own locale, so a person who filled the form in Spanish is not told how
   *  to opt out in English. */
  language?: "en" | "es";
  /** Runs on a PROVIDER failure, after the message row is marked failed: the
   *  recipe's own attempt marker (`*_sms_failed_at`) goes here. Best effort —
   *  its own failure is logged, never thrown, and never re-raised over the
   *  provider's error. */
  onProviderFailure: () => Promise<void>;
};

export type SentSms = {
  messageId: string;
  providerMessageId: string;
  /**
   * What this text bills (client billing), or null when the provider put
   * nothing in front of the customer: the fake provider, or a real one
   * redirected to a developer's phone (`smsBillable`). Segments are counted
   * on the body AS SENT, the opt-out disclosure included, because that is
   * what the carrier bills. Recorded by markAutomationSmsSent, never here.
   */
  usage: { segments: number; sentAt: Date } | null;
};

/**
 * WRITE THEN SEND — sendSmsAction's discipline, shared by every SMS-capable
 * pass so the ordering below is written once (the review-request tests are
 * the proof it did not change when it moved here):
 *   1. the provider FIRST: `ctx.sms()` is lazy and throws in production while
 *      TELNYX_API_KEY is unset; constructing it after the row would leave a
 *      failed text in the customer's conversation on every tick for a
 *      misconfiguration that has nothing to do with the customer;
 *   2. the conversation and the message row, so a provider failure is a
 *      visible failed text in the inbox, not a silent gap;
 *   3. the send;
 *   4. on failure: mark the row failed, write the recipe's attempt marker
 *      (the 24h cooldown's input for the morning-band recipes; the text
 *      reminder writes it and never reads it, the instant reply writes
 *      none), rethrow so the caller counts `failed` and stamps nothing.
 * The caller stamps its dedupe column and THEN calls markAutomationSmsSent.
 */
export async function sendAutomationSms(ctx: SmsSendContext, input: AutomationSmsInput): Promise<SentSms> {
  const sms = ctx.sms();
  // THE choke point for every unprompted text this platform sends on a
  // schedule — reminders, review requests, no-show nudges, and the inline
  // form instant reply, which routes through here too. Putting the opt-out
  // disclosure at this one line is what makes "every programme message says
  // how to stop it" a property of the system rather than a rule each pass has
  // to remember; a new pass gets it by calling this function.
  //
  // Computed ONCE, above the row write, and the same string is both stored
  // and sent. Appending it at the send call instead would leave the operator
  // reading a shorter message in the conversation than the customer received.
  //
  // The language comes from the caller, defaulting to English — see the field
  // comment on `language`. The default is for the scheduled passes, which
  // compose English copy and have no locale to offer; the instant reply
  // already picks a body by locale and hands that same locale over, so its
  // Spanish reply does not end in an English sentence. When a scheduled pass
  // learns a locale, thread it through here rather than leaving it defaulting
  // quietly.
  const body = withOptOut(input.body, input.language);
  const convo = await ensureConversation(
    ctx.db, input.accountId, input.contactId, AUTOMATION_ACTOR_ID, AUTOMATION_ACTOR_TYPE);
  const { id: messageId } = await createMessage(ctx.db, input.accountId, {
    conversationId: convo.id, channel: "sms", direction: "outbound", body,
  }, AUTOMATION_ACTOR_ID, AUTOMATION_ACTOR_TYPE);
  let providerMessageId: string;
  try {
    ({ providerMessageId } = await sms.send({ to: input.to, from: input.from, body }));
  } catch (e) {
    const message = e instanceof Error ? e.message : "unknown send failure";
    try {
      await updateMessageStatus(ctx.db, input.accountId, messageId, "failed", { error: message },
        AUTOMATION_ACTOR_ID, AUTOMATION_ACTOR_TYPE);
    } catch (statusErr) {
      console.error(`automation sms: could not mark message ${messageId} failed: ${String(statusErr)}`);
    }
    try {
      await input.onProviderFailure();
    } catch (markErr) {
      console.error(`automation sms: could not record the failed attempt for message ${messageId}: ${String(markErr)}`);
    }
    throw e;
  }
  // AFTER the send's try, never inside it: the text is delivered, and
  // nothing about its usage may reach the catch above (which marks the row
  // failed) or reject this function (the caller would then never stamp, and
  // re-send the text next tick). billedUsage never throws.
  return { messageId, providerMessageId, usage: billedUsage(sms, body, messageId) };
}

/**
 * What a delivered automation text bills, or null. NEVER throws: a failure
 * here (a provider whose shape changed, a counting bug) loses one text's
 * usage, logged, rather than the text's `sent` status or its dedupe stamp.
 */
function billedUsage(
  sms: Pick<SmsProvider, "isFake" | "redirectTo">, body: string, messageId: string,
): SentSms["usage"] {
  try {
    return smsBillable(sms) ? { segments: segmentsFor(body).segments, sentAt: new Date() } : null;
  } catch (e) {
    console.error(`automation sms: usage not worked out for message ${messageId}, so it will not bill: ${String(e)}`);
    return null;
  }
}

/**
 * Best effort, AFTER the dedupe stamp: the text is gone and stamped, and a
 * failure here must not re-label a delivered text "failed" (that invites a
 * duplicate send). `what` names the recipe in the log line.
 *
 * Also where an automation text is BILLED (client billing): after the
 * caller's stamp and the status write, never between the send and the stamp,
 * where a ledger round trip would widen the window in which a crash re-sends
 * the text. `recordUsageSafely` never throws. Every caller of
 * sendAutomationSms calls this on its success path; send-sms.test.ts's scan
 * keeps that true.
 */
export async function markAutomationSmsSent(
  ctx: SmsSendContext, accountId: string, sent: SentSms, what: string,
): Promise<void> {
  try {
    await updateMessageStatus(ctx.db, accountId, sent.messageId, "sent",
      { providerMessageId: sent.providerMessageId }, AUTOMATION_ACTOR_ID, AUTOMATION_ACTOR_TYPE);
  } catch (e) {
    console.error(`${what}: text sent but message ${sent.messageId} not marked sent: ${String(e)}`);
  }
  if (sent.usage) {
    await recordUsageSafely(ctx.db, {
      accountId, meter: "sms", quantity: sent.usage.segments,
      occurredAt: sent.usage.sentAt, sourceRef: `message:${sent.messageId}`,
    }, what);
  }
}

/**
 * Whether a booking's last FAILED text attempt is still inside the cooldown
 * (SMS_RETRY_COOLDOWN_MS). The pass counts a hold as `skippedRecentFailure`
 * and leaves the row unstamped, so it is simply due again once the marker
 * ages out. A marker in the future or one that cannot be read HOLDS — the
 * house rule for a stamp that cannot be trusted is the safe direction.
 */
export function smsCooldownActive(smsFailedAt: string | null, now: Date): boolean {
  if (smsFailedAt === null) return false;
  const t = new Date(smsFailedAt).getTime();
  if (!Number.isFinite(t)) return true;
  return now.getTime() - t < SMS_RETRY_COOLDOWN_MS;
}
