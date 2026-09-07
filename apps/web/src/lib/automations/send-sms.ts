import { ensureConversation, createMessage, updateMessageStatus } from "@bis/db";
import { SMS_RETRY_COOLDOWN_MS } from "./caps";
import type { PassContext } from "./context";

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
  /** Runs on a PROVIDER failure, after the message row is marked failed: the
   *  recipe's own attempt marker (`*_sms_failed_at`) goes here. Best effort —
   *  its own failure is logged, never thrown, and never re-raised over the
   *  provider's error. */
  onProviderFailure: () => Promise<void>;
};

export type SentSms = { messageId: string; providerMessageId: string };

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
 *      (the 24h cooldown's input), rethrow so the pass counts `failed` and
 *      stamps nothing.
 * The caller stamps its dedupe column and THEN calls markAutomationSmsSent.
 */
export async function sendAutomationSms(ctx: PassContext, input: AutomationSmsInput): Promise<SentSms> {
  const sms = ctx.sms();
  const convo = await ensureConversation(
    ctx.db, input.accountId, input.contactId, AUTOMATION_ACTOR_ID, AUTOMATION_ACTOR_TYPE);
  const { id: messageId } = await createMessage(ctx.db, input.accountId, {
    conversationId: convo.id, channel: "sms", direction: "outbound", body: input.body,
  }, AUTOMATION_ACTOR_ID, AUTOMATION_ACTOR_TYPE);
  try {
    const { providerMessageId } = await sms.send({ to: input.to, from: input.from, body: input.body });
    return { messageId, providerMessageId };
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
}

/**
 * Best effort, AFTER the dedupe stamp: the text is gone and stamped, and a
 * failure here must not re-label a delivered text "failed" (that invites a
 * duplicate send). `what` names the recipe in the log line.
 */
export async function markAutomationSmsSent(
  ctx: PassContext, accountId: string, sent: SentSms, what: string,
): Promise<void> {
  try {
    await updateMessageStatus(ctx.db, accountId, sent.messageId, "sent",
      { providerMessageId: sent.providerMessageId }, AUTOMATION_ACTOR_ID, AUTOMATION_ACTOR_TYPE);
  } catch (e) {
    console.error(`${what}: text sent but message ${sent.messageId} not marked sent: ${String(e)}`);
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
