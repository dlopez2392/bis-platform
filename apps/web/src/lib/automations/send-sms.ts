import { ensureConversation, createMessage, updateMessageStatus } from "@bis/db";
import { SMS_RETRY_COOLDOWN_MS } from "./caps";
import { recordUsageSafely } from "@/lib/billing/usage";
import type { AutomationSmsKind } from "@/lib/consent/classes";
import type { SmsBlockReason } from "@/lib/consent/gate";
import type { PassContext } from "./context";

/**
 * What the two helpers below actually need: the client, the send gate and
 * the tick's instant — not the whole cron context. A full PassContext
 * satisfies this (it is a Pick), so every pass keeps handing over `ctx`
 * unchanged; the inline instant reply (instant-reply.ts) builds exactly these
 * three fields and never constructs the email provider it has no use for.
 */
export type SmsSendContext = Pick<PassContext, "db" | "sms" | "now">;

/** The messages rows automations write are the platform's, not a person's —
 *  the same actor shape the voice text-back uses ("voice"/"ai"). */
export const AUTOMATION_ACTOR_ID = "automation";
export const AUTOMATION_ACTOR_TYPE = "system" as const;

export type AutomationSmsInput = {
  accountId: string;
  contactId: string;
  /** Which automation this is (lib/consent/classes.ts): it decides the
   *  hours and the footer, never the caller. */
  kind: AutomationSmsKind;
  /** The number as the contact row holds it. The gate normalises it, and a
   *  ten-digit number whose country is unknown is held there (F-009). */
  to: string;
  body: string;
  /** The language THIS message is written in, which decides the language of
   *  the opt-out disclosure the gate appends to it. Optional and defaulting
   *  to "en" because most passes have no locale to offer — the scheduled
   *  recipes compose English copy end to end. The form instant reply is the
   *  exception and passes the submission's own locale. */
  language?: "en" | "es";
  /** The account's zone, off the due row, so the gate does not re-read it. */
  accountTimezone: string | null;
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
   * redirected to a developer's phone. Segments are counted on the body AS
   * SENT, the opt-out disclosure included, because that is what the carrier
   * bills. Recorded by markAutomationSmsSent, never here.
   */
  usage: { segments: number; sentAt: Date } | null;
};

/** How long a send waits when the consent state could not be read (review
 *  R2-I4). A failed row would leave the held queue for good (a released
 *  reminder is past its due window and is never listed again), so an outage
 *  is a short re-hold instead, and the release pass tries again. */
export const LEDGER_RETRY_MS = 15 * 60_000;

/** The re-hold age cap (orchestrator, 2026-09-26): an instant reply or a
 *  missed-call text-back released more than this long after the thing that
 *  triggered it (the form submission, the call's end) is skipped, not sent
 *  and not held again, so an outage never sends "Sorry we missed your call"
 *  days later. */
export const RETRY_MAX_AGE_MS = 24 * 60 * 60_000;

/** True when `now` is more than RETRY_MAX_AGE_MS after `trigger`. */
export function pastRetryAge(trigger: Date, now: Date): boolean {
  return now.getTime() - trigger.getTime() > RETRY_MAX_AGE_MS;
}

/** The gate said "not yet": holdOrSend writes the held row for `until`.
 *  `why` picks the row's reason: the sending hours, or an unreadable
 *  consent state being retried. */
export class SmsDeferred extends Error {
  constructor(readonly until: Date, readonly why: "hours" | "ledger_unavailable" = "hours") {
    super(`automation sms deferred until ${until.toISOString()} (${why})`);
    this.name = "SmsDeferred";
  }
}

/** The gate said "not to this number": holdOrSend logs the row `skipped`
 *  with the reason. `ledger_unavailable` is never one of these: it is an
 *  outage, re-held for LEDGER_RETRY_MS (SmsDeferred). */
/** An automation never sends a consent reply, so the stop confirmation's own
 *  refusal is not one of its reasons (hold-or-send.ts's BLOCK_REASONS). */
export type AutomationBlockReason = Exclude<SmsBlockReason, "ledger_unavailable" | "stop_confirmation_stale">;
export class SmsBlocked extends Error {
  constructor(readonly reason: AutomationBlockReason) {
    super(`automation sms not sent: ${reason}`);
    this.name = "SmsBlocked";
  }
}

/**
 * WRITE THEN SEND — sendSmsAction's discipline, shared by every SMS-capable
 * pass, now through the send gate (consent chain PR-1):
 *   1. the gate decides (registry, number, A2P sender, ledger, the
 *      number's country, the kind's hours, the footer) BEFORE any row, so
 *      a text that must not go leaves nothing in the customer's thread;
 *   2. the gate takes the provider FIRST: it throws in production while
 *      TELNYX_API_KEY is unset, and a row written before it would leave a
 *      failed text in the thread on every tick for a misconfiguration;
 *   3. `prepare`: the conversation and the message row, with the body
 *      exactly as it will be sent, footer included;
 *   4. the send;
 *   5. on a provider failure: mark the row failed, write the recipe's
 *      attempt marker, rethrow so the caller counts `failed` and stamps
 *      nothing.
 * A deferral throws SmsDeferred and a refusal throws SmsBlocked; holdOrSend
 * (hold-or-send.ts) turns each into its log row. The caller stamps its dedupe
 * column and THEN calls markAutomationSmsSent.
 */
export async function sendAutomationSms(ctx: SmsSendContext, input: AutomationSmsInput): Promise<SentSms> {
  // THE choke point for every unprompted text this platform sends on a
  // schedule: every pass and the inline instant reply come through here, and
  // from here through the send gate, so a new pass gets the gate's checks,
  // hours and footer by calling this function.
  // A holder, not a `let`: the row id is written inside the gate's callback.
  const row: { id: string | null } = { id: null };
  const result = await ctx.sms({
    accountId: input.accountId, kind: input.kind, to: input.to, body: input.body,
    contactId: input.contactId, language: input.language, accountZone: input.accountTimezone, now: ctx.now,
  }, {
    prepare: async ({ body }) => {
      const convo = await ensureConversation(
        ctx.db, input.accountId, input.contactId, AUTOMATION_ACTOR_ID, AUTOMATION_ACTOR_TYPE);
      row.id = (await createMessage(ctx.db, input.accountId, {
        conversationId: convo.id, channel: "sms", direction: "outbound", body,
      }, AUTOMATION_ACTOR_ID, AUTOMATION_ACTOR_TYPE)).id;
    },
  });
  switch (result.kind) {
    case "sent":
      // The text has LEFT. Throwing now would count it failed, leave it
      // unstamped and send it again next tick (review R2 minor), so a
      // missing row is logged and the send is reported as the send it was.
      if (row.id === null) {
        console.error(`automation sms for account ${input.accountId}: sent, but the gate never wrote the message row`);
      }
      return {
        messageId: row.id ?? "", providerMessageId: result.providerMessageId,
        usage: result.billable ? { segments: result.segments, sentAt: new Date() } : null,
      };
    case "deferred":
      throw new SmsDeferred(result.until);
    case "blocked":
      if (result.reason === "ledger_unavailable") {
        throw new SmsDeferred(new Date(ctx.now.getTime() + LEDGER_RETRY_MS), "ledger_unavailable");
      }
      if (result.reason === "stop_confirmation_stale") {
        // Only a consent reply can meet it (gate.ts), and no automation sends one.
        throw new Error(`automation sms: ${input.kind} was refused as a stale stop confirmation, which only a consent reply can be`);
      }
      throw new SmsBlocked(result.reason);
    case "failed":
      if (result.stage === "provider" && row.id !== null) {
        const messageId = row.id;
        try {
          await updateMessageStatus(ctx.db, input.accountId, messageId, "failed", { error: result.error },
            AUTOMATION_ACTOR_ID, AUTOMATION_ACTOR_TYPE);
        } catch (statusErr) {
          console.error(`automation sms: could not mark message ${messageId} failed: ${String(statusErr)}`);
        }
        try {
          await input.onProviderFailure();
        } catch (markErr) {
          console.error(`automation sms: could not record the failed attempt for message ${messageId}: ${String(markErr)}`);
        }
      }
      throw new Error(result.error);
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
  if (!sent.messageId) return;   // no row to mark or to bill against (logged at the send)
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
