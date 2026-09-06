import {
  listDueReviewRequests, stampReviewRequested, countReviewRequestsSince,
  ensureConversation, createMessage, updateMessageStatus,
  type DueReviewRequest, type ReviewRequestConfig,
} from "@bis/db";
import { emailBrandNamed } from "@/lib/email/templates/shell";
import { normalizeReplyTo } from "@/lib/email/reply-to";
import { reviewRequestEmail } from "@/lib/email/templates/review-request";
import { resolveSmsSender, type SmsGate } from "@/lib/sms/sender";
import { toE164 } from "@/lib/voice/phone-number";
import { resolveAccountZone } from "@/lib/booking/followup-timing";
import { stampWithRetry } from "@/lib/booking/stamp-retry";
import { shouldSendReviewRequestNow } from "../review-request-gate";
import { composeReviewRequestSms, defaultReviewRequestBody } from "../review-request-copy";
import { AUTOMATION_TICK_CAP, AUTOMATION_DAILY_CAP, DAILY_CAP_WINDOW_MS } from "../caps";
import type { Pass, PassContext } from "../context";

// The messages rows this pass writes are the platform's, not a person's —
// the same actor shape the voice text-back uses ("voice"/"ai").
const ACTOR_ID = "automation";
const ACTOR_TYPE = "system" as const;

type Target =
  | { channel: "sms"; to: string; from: string }
  | { channel: "email"; to: string };

/**
 * Review request after a completed job — the first RECIPE on the harness.
 *
 * Trigger is a human: the operator's "Mark completed". Everything here is
 * then decided per row, in this order, each refusal counted under its own
 * name so triage can tell them apart:
 *   invalid config → unresolvable zone → not this morning (the gate, which
 *   also defers to the calendar follow-up) → no deliverable address → SMS
 *   gate refused (NO fallback to email) → caps → send → STAMP → (sms) mark
 *   the message row sent.
 *
 * Nothing new sends: `ctx.email` and `ctx.sms()` come from the harness.
 * The SMS path is `sendSmsAction`'s exactly — write the message row, then
 * send, mark failed on a provider error — so a review text shows up in the
 * customer's conversation like any other outbound text, and a reply lands
 * in the operator's inbox.
 */
export const reviewRequestPass: Pass = {
  key: "reviewRequests",
  async run(ctx) {
    const c = {
      sent: 0, failed: 0, unstamped: 0,
      skippedInvalidConfig: 0, skippedNoAddress: 0, skippedSmsGate: 0, skippedCap: 0,
      waitingForMorning: 0, unresolvableTimezone: 0,
    };
    const due = await listDueReviewRequests(ctx.db, ctx.now.toISOString());

    // Per-account memos for one tick: the sender gate and the daily count
    // are answered once per account, not once per row.
    const smsGates = new Map<string, SmsGate>();
    const sentToday = new Map<string, number>();
    let attemptsThisTick = 0;

    for (const row of due) {
      const config = row.config;
      if (config === null) {
        c.skippedInvalidConfig++;
        console.error(
          `review request skipped for booking ${row.bookingId}: account ${row.accountId}'s `
          + `review_request config is missing or invalid — set the review link in Automations`,
        );
        continue;
      }

      // RULE 0, before the gate, same as the follow-up pass: no resolvable
      // zone means no defensible hour. Counted separately so a
      // misconfiguration stays visible rather than hiding in waitingForMorning.
      if (resolveAccountZone(row.accountTimezone) === null) {
        c.unresolvableTimezone++;
        console.error(
          `review request HELD for booking ${row.bookingId}: account ${row.accountId}'s timezone `
          + `${JSON.stringify(row.accountTimezone)} is not a zone we can resolve — fix the account's timezone`,
        );
        continue;
      }

      const followupSentAt = row.followupSentAt ? new Date(row.followupSentAt) : null;
      if (!shouldSendReviewRequestNow(ctx.now, new Date(row.endsAt), followupSentAt, row.accountTimezone)) {
        c.waitingForMorning++;
        continue;
      }

      // The deliverable address for the CHOSEN channel. SMS: contacts.phone
      // is free-form and toE164 is what every number leaving this app goes
      // through (null = nothing we can text). Email: the address or nothing.
      let target: Target;
      if (config.channel === "sms") {
        const to = toE164(row.contactPhone);
        if (!to) {
          c.skippedNoAddress++;
          console.error(`review request skipped, no textable phone on file for booking ${row.bookingId}`);
          continue;
        }
        // THE gate, and the only one — never re-derived. Refusal means skip
        // and count, NOT "send it by email instead": a silent channel switch
        // is how an operator stops trusting what the settings page says.
        let gate = smsGates.get(row.accountId);
        if (!gate) {
          // The gate READS (a2p registration, phone_numbers); a read error is
          // this row's failure, not the whole pass's — letting it escape would
          // discard the counters for every row already sent this tick.
          try {
            gate = await resolveSmsSender(ctx.db, row.accountId);
          } catch (e) {
            c.failed++;
            console.error(`review request: sms gate read failed for account ${row.accountId}: ${String(e)}`);
            continue;
          }
          smsGates.set(row.accountId, gate);
        }
        if (!gate.ok) {
          c.skippedSmsGate++;
          console.error(
            `review request skipped for booking ${row.bookingId}: account ${row.accountId} cannot text `
            + `(${gate.reason}) — not falling back to email`,
          );
          continue;
        }
        target = { channel: "sms", to, from: gate.from };
      } else {
        if (!row.contactEmail) {
          c.skippedNoAddress++;
          console.error(`review request skipped, no contact email on file for booking ${row.bookingId}`);
          continue;
        }
        target = { channel: "email", to: row.contactEmail };
      }

      // CAPS, recipe passes only (caps.ts). Checked AFTER the gate and the
      // address, so only rows that would actually send count against them;
      // a skipped row is left unstamped and is simply due again.
      if (attemptsThisTick >= AUTOMATION_TICK_CAP) {
        c.skippedCap++;
        continue;
      }
      let today = sentToday.get(row.accountId);
      if (today === undefined) {
        today = await countReviewRequestsSince(
          ctx.db, row.accountId, new Date(ctx.now.getTime() - DAILY_CAP_WINDOW_MS).toISOString(),
        );
        sentToday.set(row.accountId, today);
      }
      if (today >= AUTOMATION_DAILY_CAP) {
        c.skippedCap++;
        continue;
      }
      attemptsThisTick++;
      sentToday.set(row.accountId, today + 1);

      const body = row.body.trim() || defaultReviewRequestBody(row.brandName);

      let smsRow: { messageId: string; providerMessageId: string } | null = null;
      try {
        if (target.channel === "sms") {
          smsRow = await sendSms(ctx, row, target.to, target.from, composeReviewRequestSms(body, config.reviewUrl));
        } else {
          await sendEmail(ctx, row, config, target.to, body);
        }
      } catch (e) {
        c.failed++;
        console.error(`review request send failed for booking ${row.bookingId}: ${String(e)}`);
        continue;
      }

      // SEND-THEN-STAMP. The stamp comes BEFORE the SMS row's status update:
      // the stamp is what stops ~12 duplicates over the morning band; the
      // status is what the inbox shows. Same residual as the other passes
      // when every attempt fails — counted, logged, and the repeats are live.
      const stamp = await stampWithRetry(() => stampReviewRequested(ctx.db, row.bookingId));
      if (!stamp.stamped) {
        c.unstamped++;
        console.error(
          `review request sent but NOT stamped for booking ${row.bookingId} after `
          + `${stamp.attempts} attempts — expect up to 11 more copies before the morning band `
          + `closes: ${String(stamp.lastError)}`,
        );
      }
      c.sent++;

      if (smsRow) {
        // Best effort: the text is gone and stamped. A failure here must not
        // re-label a delivered text "failed" (that invites a duplicate send).
        try {
          await updateMessageStatus(ctx.db, row.accountId, smsRow.messageId, "sent",
            { providerMessageId: smsRow.providerMessageId }, ACTOR_ID, ACTOR_TYPE);
        } catch (e) {
          console.error(`review request: text sent but message ${smsRow.messageId} not marked sent: ${String(e)}`);
        }
      }
    }

    return c;
  },
};

async function sendEmail(
  ctx: PassContext, row: DueReviewRequest, config: ReviewRequestConfig, to: string, body: string,
): Promise<void> {
  // emailBrandNamed, because the row carries the resolved brand name and
  // nothing else — there is no accountName here to get wrong.
  const brand = emailBrandNamed(row.branding, row.brandName);
  const { subject, html, text } = reviewRequestEmail({ brand, body, reviewUrl: config.reviewUrl });
  await ctx.email.send({
    to,
    fromName: brand.name,
    fromAddress: row.fromEmail ?? undefined,
    // The row's OWN top-level replyToEmail, never branding.replyToEmail —
    // the DueFollowup precedent.
    replyTo: normalizeReplyTo(row.replyToEmail),
    subject,
    body: text,
    html,
  });
}

/**
 * WRITE THEN SEND — sendSmsAction's discipline: the messages row exists
 * before anything leaves the building, so a provider failure is a visible
 * failed text in the conversation, not a silent gap. Returns the ids the
 * caller needs to mark it sent AFTER the stamp. Throws on a provider failure
 * after marking the row failed (best effort).
 */
async function sendSms(
  ctx: PassContext, row: DueReviewRequest, to: string, from: string, body: string,
): Promise<{ messageId: string; providerMessageId: string }> {
  // The provider FIRST, before any row is written: `ctx.sms()` is lazy and
  // throws in production when TELNYX_API_KEY is unset. Constructing it after
  // the message row would leave a failed text in the customer's conversation
  // on every in-band tick for a misconfiguration that has nothing to do with
  // the customer (review finding, 2026-09-06).
  const sms = ctx.sms();
  const convo = await ensureConversation(ctx.db, row.accountId, row.contactId, ACTOR_ID, ACTOR_TYPE);
  const { id: messageId } = await createMessage(ctx.db, row.accountId, {
    conversationId: convo.id, channel: "sms", direction: "outbound", body,
  }, ACTOR_ID, ACTOR_TYPE);
  try {
    const { providerMessageId } = await sms.send({ to, from, body });
    return { messageId, providerMessageId };
  } catch (e) {
    const message = e instanceof Error ? e.message : "unknown send failure";
    try {
      await updateMessageStatus(ctx.db, row.accountId, messageId, "failed", { error: message }, ACTOR_ID, ACTOR_TYPE);
    } catch (statusErr) {
      console.error(`review request: could not mark message ${messageId} failed: ${String(statusErr)}`);
    }
    throw e;
  }
}
