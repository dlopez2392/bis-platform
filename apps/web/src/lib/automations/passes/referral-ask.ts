import {
  listDueReferralAsks, stampReferralAsked, stampReferralAskSmsFailed, countReferralAsksSince,
  getDueReferralAskById, type DueReferralAsk,
} from "@bis/db";
import { emailBrandNamed } from "@/lib/email/templates/shell";
import { normalizeReplyTo } from "@/lib/email/reply-to";
import { referralAskEmail } from "@/lib/email/templates/referral-ask";
import { resolveSmsSender, type SmsGate } from "@/lib/sms/sender";
import { toE164 } from "@/lib/voice/phone-number";
import { resolveAccountZone } from "@/lib/booking/followup-timing";
import { stampWithRetry } from "@/lib/booking/stamp-retry";
import { laterOf } from "../anchor";
import { shouldSendReferralAskNow, reviewRequestStillOwed } from "../referral-ask-gate";
import { defaultReferralAskBody, referralAskSubject } from "../referral-ask-copy";
import { AUTOMATION_TICK_CAP, AUTOMATION_DAILY_CAP, DAILY_CAP_WINDOW_MS } from "../caps";
import { sendAutomationSms, markAutomationSmsSent, smsCooldownActive, type SentSms } from "../send-sms";
import {
  holdOrSend, logSkipped, subjectOf, verdict, REASONS, type HoldSubject, type Releaser,
} from "../hold-or-send";
import type { Pass, PassContext } from "../context";

type Target =
  | { channel: "sms"; to: string; from: string }
  | { channel: "email"; to: string };

/**
 * The referral ask — the completed-job ladder's THIRD rung. Day one the
 * calendar's follow-up ("how did it go?"), day two the review request
 * ("would you leave a review?"), day three this ("know anyone else?").
 *
 * It is a recipe of its own rather than a channel option on the review
 * request, and that is a decision: one `automations` row cannot be enabled
 * twice with two bodies, and an operator who wanted only referrals would have
 * had to turn reviews off to get them.
 *
 * It DEFERS TO THE REVIEW REQUEST EXPLICITLY, not by luck — see
 * reviewRequestStillOwed. Relying on the registry's order would make a
 * product promise out of an array literal.
 *
 * Per row, each refusal counted under its own name so triage can tell them
 * apart: invalid config → unresolvable zone → the review is still owed →
 * not this morning → no deliverable address → SMS gate refused (NO fallback
 * to email) → SMS cooldown → caps → send → STAMP → (sms) mark the row sent.
 */
export const referralAskPass: Pass = {
  key: "referralAsks",
  async run(ctx) {
    return processReferralAsks(ctx, await listDueReferralAsks(ctx.db, ctx.now.toISOString()), { released: false });
  },
};

export type ProcessOptions = { released: boolean };

export async function processReferralAsks(
  ctx: PassContext, due: DueReferralAsk[], opts: ProcessOptions,
) {
  const c = {
    sent: 0, failed: 0, unstamped: 0, held: 0,
    skippedInvalidConfig: 0, skippedNoAddress: 0, skippedSmsGate: 0, skippedRecentFailure: 0, skippedCap: 0,
    waitingForMorning: 0, waitingForReviewRequest: 0, unresolvableTimezone: 0,
  };

  const smsGates = new Map<string, SmsGate>();
  const sentToday = new Map<string, number>();
  let attemptsThisTick = 0;

  for (const row of due) {
    const config = row.config;
    if (config === null) {
      c.skippedInvalidConfig++;
      console.error(
        `referral ask skipped for booking ${row.bookingId}: account ${row.accountId}'s referral_ask `
        + `config is missing or invalid — re-save the recipe in Automations`,
      );
      // NOT logged: the channel is unknown before the config parses, so there
      // is no subject (its channel field is required) to write against.
      // UNREACHABLE ON A RELEASE, and that is load-bearing:
      // `getDueReferralAskById` answers `why: "off"` for a config that will
      // not parse, so `releaseReferralAsk` writes `REASONS.recipeOff` and
      // never enters this loop. Without that guard this silent `continue`
      // would leave a released row `held` with its past `held_until`, and
      // `listReleasableHolds` would hand it back every tick for ever.
      continue;
    }

    const subject: HoldSubject = {
      accountId: row.accountId, accountTimezone: row.accountTimezone, source: "referral_ask",
      channel: config.channel, subjectKey: `booking:${row.bookingId}`, contactId: row.contactId,
    };

    if (resolveAccountZone(row.accountTimezone) === null) {
      c.unresolvableTimezone++;
      console.error(
        `referral ask HELD for booking ${row.bookingId}: account ${row.accountId}'s timezone `
        + `${JSON.stringify(row.accountTimezone)} is not a zone we can resolve`,
      );
      await logSkipped(ctx, subject, REASONS.timezone);
      continue;
    }

    const anchor = laterOf(new Date(row.endsAt), row.completedAt ? new Date(row.completedAt) : null);
    const followupSentAt = row.followupSentAt ? new Date(row.followupSentAt) : null;
    const reviewRequestedAt = row.reviewRequestedAt ? new Date(row.reviewRequestedAt) : null;

    // Both of these are skipped on a RELEASE: the band already said yes once,
    // when this row was held, and the releaser has already re-applied
    // precedence itself (and written a real `skipped` row if it bit). Counted
    // separately because "the review goes first" and "not this morning" are
    // very different answers to "why has nothing gone out?".
    if (!opts.released) {
      if (reviewRequestStillOwed(ctx.now, anchor, reviewRequestedAt, row.reviewRequestEnabled)) {
        c.waitingForReviewRequest++;
        continue;   // silent: the row is due again tomorrow morning
      }
      if (!shouldSendReferralAskNow(
        ctx.now, anchor, followupSentAt, reviewRequestedAt, row.reviewRequestEnabled, row.accountTimezone)) {
        c.waitingForMorning++;
        continue;
      }
    }

    let target: Target;
    if (config.channel === "sms") {
      const to = toE164(row.contactPhone);
      if (!to) {
        c.skippedNoAddress++;
        console.error(`referral ask skipped, no textable phone on file for booking ${row.bookingId}`);
        await logSkipped(ctx, subject, REASONS.noPhone);
        continue;
      }
      let gate = smsGates.get(row.accountId);
      if (!gate) {
        try {
          gate = await resolveSmsSender(ctx.db, row.accountId);
        } catch (e) {
          // TRANSIENT, on both paths, and deliberately not logged: a read
          // error is not a branch that repeats deterministically, so a
          // released row left `held` with its past `held_until` IS the
          // retry — the next tick re-examines it. Same call
          // `review-request.ts:136-146` makes for the same read.
          c.failed++;
          console.error(`referral ask: sms gate read failed for account ${row.accountId}: ${String(e)}`);
          continue;
        }
        smsGates.set(row.accountId, gate);
      }
      if (!gate.ok) {
        c.skippedSmsGate++;
        console.error(
          `referral ask skipped for booking ${row.bookingId}: account ${row.accountId} cannot text `
          + `(${gate.reason}) — not falling back to email`,
        );
        await logSkipped(ctx, subject, REASONS.smsGate);
        continue;
      }
      // Silent on a normal tick (the row is simply due again once the marker
      // ages out); a REAL skip on a release, or the row keeps its past
      // held_until and parks the head of the queue forever.
      if (smsCooldownActive(row.smsFailedAt, ctx.now)) {
        c.skippedRecentFailure++;
        if (opts.released) await logSkipped(ctx, subject, REASONS.smsCooldown);
        continue;
      }
      target = { channel: "sms", to, from: gate.from };
    } else {
      if (!row.contactEmail) {
        c.skippedNoAddress++;
        console.error(`referral ask skipped, no contact email on file for booking ${row.bookingId}`);
        await logSkipped(ctx, subject, REASONS.noEmail);
        continue;
      }
      target = { channel: "email", to: row.contactEmail };
    }

    // CAPS, after the gate and the address so only rows that would actually
    // send count against them. The TICK cap is a per-tick queue and is not
    // logged; the DAILY cap is — the client's own limit was reached today.
    if (attemptsThisTick >= AUTOMATION_TICK_CAP) {
      c.skippedCap++;
      continue;
    }
    let today = sentToday.get(row.accountId);
    if (today === undefined) {
      today = await countReferralAsksSince(
        ctx.db, row.accountId, new Date(ctx.now.getTime() - DAILY_CAP_WINDOW_MS).toISOString());
      sentToday.set(row.accountId, today);
    }
    if (today >= AUTOMATION_DAILY_CAP) {
      c.skippedCap++;
      await logSkipped(ctx, subject, REASONS.dailyCap);
      continue;
    }
    attemptsThisTick++;
    sentToday.set(row.accountId, today + 1);

    const body = row.body.trim() || defaultReferralAskBody(row.brandName);

    let smsRow: SentSms | null = null;
    try {
      const outcome = await holdOrSend(ctx, subject, async () => {
        if (target.channel === "sms") {
          // NO composer and NO trailing link: this recipe asks for a name,
          // never a rating, and there is nowhere for a link to point.
          smsRow = await sendAutomationSms(ctx, {
            accountId: row.accountId, contactId: row.contactId, to: target.to, from: target.from,
            body,
            onProviderFailure: () => stampReferralAskSmsFailed(ctx.db, row.bookingId),
          });
        } else {
          await sendEmail(ctx, row, target.to, body);
        }

        const stamp = await stampWithRetry(() => stampReferralAsked(ctx.db, row.bookingId));
        if (!stamp.stamped) {
          c.unstamped++;
          console.error(
            `referral ask sent but NOT stamped for booking ${row.bookingId} after ${stamp.attempts} `
            + `attempts — expect up to 11 more copies before the morning band closes: ${String(stamp.lastError)}`,
          );
        }
        if (smsRow) await markAutomationSmsSent(ctx, row.accountId, smsRow, "referral ask");
      });
      if (outcome === "held") {
        c.held++;
        continue;
      }
      c.sent++;
    } catch (e) {
      c.failed++;
      console.error(`referral ask send failed for booking ${row.bookingId}: ${String(e)}`);
      continue;
    }
  }

  return c;
}

export const releaseReferralAsk: Releaser = async (ctx, row) => {
  const bookingId = row.subject_key.replace(/^booking:/, "");
  const found = await getDueReferralAskById(ctx.db, bookingId);
  if (!found.due) {
    await logSkipped(ctx, subjectOf(row), found.why === "off" ? REASONS.recipeOff : REASONS.noLongerDue);
    return "skipped";
  }
  if (found.due.accountId !== row.account_id) {
    await logSkipped(ctx, subjectOf(row), REASONS.noLongerDue);
    return "skipped";
  }
  // PRECEDENCE, RE-APPLIED. The agency may have switched review requests on
  // during the hold. Written `skipped` rather than left untouched (the
  // parked-row rule); the normal pass re-discovers this unstamped booking the
  // next morning and moves this SAME row back to `held` or `sent` in place,
  // because the log's unique key is (account, source, subject).
  const anchor = laterOf(
    new Date(found.due.endsAt), found.due.completedAt ? new Date(found.due.completedAt) : null);
  const reviewRequestedAt = found.due.reviewRequestedAt ? new Date(found.due.reviewRequestedAt) : null;
  if (reviewRequestStillOwed(ctx.now, anchor, reviewRequestedAt, found.due.reviewRequestEnabled)) {
    await logSkipped(ctx, subjectOf(row), REASONS.reviewFirst);
    return "skipped";
  }
  return verdict(await processReferralAsks(ctx, [found.due], { released: true }));
};

async function sendEmail(
  ctx: PassContext, row: DueReferralAsk, to: string, body: string,
): Promise<void> {
  // emailBrandNamed, because the row carries the resolved brand name and
  // nothing else — there is no accountName here to get wrong.
  const brand = emailBrandNamed(row.branding, row.brandName);
  // The subject is composed here, not inside the template: an account with no
  // brand name has `brandName === ""` (brandDisplayName, branding.ts:197-199)
  // and a template interpolating it would ship "One favour, from ".
  const { subject, html, text } = referralAskEmail({
    brand, subject: referralAskSubject(row.brandName), body,
  });
  await ctx.email.send({
    to,
    fromName: brand.name,
    fromAddress: row.fromEmail ?? undefined,
    // The row's OWN top-level replyToEmail, never branding.replyToEmail.
    replyTo: normalizeReplyTo(row.replyToEmail),
    subject,
    body: text,
    html,
  });
}
