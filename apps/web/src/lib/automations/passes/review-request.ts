import {
  listDueReviewRequests, stampReviewRequested, stampReviewRequestSmsFailed, countReviewRequestsSince,
  getDueReviewRequestById, type DueReviewRequest, type ReviewRequestConfig,
} from "@bis/db";
import { emailBrandNamed } from "@/lib/email/templates/shell";
import { normalizeReplyTo } from "@/lib/email/reply-to";
import { reviewRequestEmail } from "@/lib/email/templates/review-request";
import { resolveSmsSender, type SmsGate } from "@/lib/sms/sender";
import { toE164 } from "@/lib/voice/phone-number";
import { resolveAccountZone } from "@/lib/booking/followup-timing";
import { stampWithRetry } from "@/lib/booking/stamp-retry";
import { laterOf } from "../anchor";
import { shouldSendReviewRequestNow } from "../review-request-gate";
import { composeReviewRequestSms, defaultReviewRequestBody } from "../review-request-copy";
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
 * Review request after a completed job — the first RECIPE on the harness.
 *
 * Trigger is a human: the operator's "Mark completed". Everything here is
 * then decided per row, in this order, each refusal counted under its own
 * name so triage can tell them apart:
 *   invalid config → unresolvable zone → not this morning (the gate, which
 *   also defers to the calendar follow-up) → no deliverable address → SMS
 *   gate refused (NO fallback to email) → SMS cooldown → caps → send →
 *   STAMP → (sms) mark the message row sent.
 *
 * Nothing new sends: `ctx.email` and `ctx.sms()` come from the harness.
 * The SMS path is sendAutomationSms — write the message row, then send,
 * mark failed and write the attempt marker on a provider error — so a
 * review text shows up in the customer's conversation like any other
 * outbound text, and a reply lands in the operator's inbox.
 */
export const reviewRequestPass: Pass = {
  key: "reviewRequests",
  async run(ctx) {
    return processReviewRequests(ctx, await listDueReviewRequests(ctx.db, ctx.now.toISOString()), { released: false });
  },
};

/** One boolean — a shared type across the three band-gated passes would be a
 *  fourth file to keep in step for no benefit; each pass declares its own. */
export type ProcessOptions = { released: boolean };

/**
 * The loop `reviewRequestPass.run` and `releaseReviewRequest` both drive.
 * `released` skips ONLY the morning-band gate (amendment 3: the band says
 * when a thing became due, the window says when it may go) — everything
 * else, including `holdOrSend`'s own quiet-hours check, still applies.
 */
export async function processReviewRequests(
  ctx: PassContext, due: DueReviewRequest[], opts: ProcessOptions,
) {
  const c = {
    sent: 0, failed: 0, unstamped: 0, held: 0,
    skippedInvalidConfig: 0, skippedNoAddress: 0, skippedSmsGate: 0, skippedRecentFailure: 0, skippedCap: 0,
    waitingForMorning: 0, unresolvableTimezone: 0,
  };

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
      // NOT logged: the channel is unknown before the config parses, so
      // there is no subject (its channel field is required) to write
      // against — console only.
      continue;
    }

    // Built only once the channel is known: the log subject's channel field
    // is the CONFIGURED one, never a guess.
    const subject: HoldSubject = {
      accountId: row.accountId, accountTimezone: row.accountTimezone, source: "review_request",
      channel: config.channel, subjectKey: `booking:${row.bookingId}`, contactId: row.contactId,
    };

    // RULE 0, before the gate, same as the follow-up pass: no resolvable
    // zone means no defensible hour. Counted separately so a
    // misconfiguration stays visible rather than hiding in waitingForMorning.
    if (resolveAccountZone(row.accountTimezone) === null) {
      c.unresolvableTimezone++;
      console.error(
        `review request HELD for booking ${row.bookingId}: account ${row.accountId}'s timezone `
        + `${JSON.stringify(row.accountTimezone)} is not a zone we can resolve — fix the account's timezone`,
      );
      await logSkipped(ctx, subject, REASONS.timezone);
      continue;
    }

    const followupSentAt = row.followupSentAt ? new Date(row.followupSentAt) : null;
    // THE CLOCK (0026): the later of the meeting end and "Mark completed".
    const anchor = laterOf(new Date(row.endsAt), row.completedAt ? new Date(row.completedAt) : null);
    // THE GATE RUNS ON BOTH PATHS. A release skips the morning BAND and
    // nothing else (`skipBand`, the release contract in part B's spec at line
    // 16 and amendment B16): the band already said yes once, when this row was
    // held. Everything else is RE-APPLIED, and RULE 4 is the whole point — the
    // follow-up pass runs first in the registry and stamps `followup_sent_at`,
    // and its email and this request can both be held inside one quiet window
    // and come back on the same release tick. Skipping the composite put "how
    // did it go?" and "would you leave a review?" on one morning, the exact
    // collision rule 4 exists to stop; it also sent a request whose 61h cap
    // had run out during the hold.
    //
    // When it refuses on a release the row is written `skipped`, never left
    // untouched: an untouched released row keeps its past `held_until` and
    // parks the head of the queue for ever. On a normal tick it stays silent
    // — the row is simply due again tomorrow morning.
    if (!shouldSendReviewRequestNow(
      ctx.now, anchor, followupSentAt, row.accountTimezone, { skipBand: opts.released })) {
      c.waitingForMorning++;
      if (opts.released) await logSkipped(ctx, subject, REASONS.noLongerDue);
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
        await logSkipped(ctx, subject, REASONS.noPhone);
        continue;
      }
      // THE gate, and the only one — never re-derived. Refusal means skip
      // and count, NOT "send it by email instead": a silent channel switch
      // is how an operator stops trusting what the settings page says.
      let gate = smsGates.get(row.accountId);
      if (!gate) {
        // The gate READS (a2p registration, phone_numbers); a read error is
        // this row's failure, not the whole pass's — letting it escape would
        // discard the counters for every row already sent this tick. Not
        // logged: a gate read failure is `failed`, console only.
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
        await logSkipped(ctx, subject, REASONS.smsGate);
        continue;
      }
      // ONE ATTEMPT PER DAY: a text that failed less than 24h ago is not
      // retried this tick (caps.ts, SMS_RETRY_COOLDOWN_MS). Held rows never
      // reach the caps and are simply due again when the marker ages out.
      // NOT logged on a normal tick, same as waitingForMorning: this row was
      // never going to send this tick and is simply examined again next one.
      // A RELEASED row is different: it came off the `held` queue, and if
      // this `continue` left it untouched it would keep its past
      // `held_until` and be re-examined, re-found "skipped" and re-left
      // `held` forever — the parked-row bug (cleanup item 3). So a release
      // writes the real skip here and leaves the queue.
      if (smsCooldownActive(row.smsFailedAt, ctx.now)) {
        c.skippedRecentFailure++;
        if (opts.released) await logSkipped(ctx, subject, REASONS.smsCooldown);
        continue;
      }
      target = { channel: "sms", to, from: gate.from };
    } else {
      if (!row.contactEmail) {
        c.skippedNoAddress++;
        console.error(`review request skipped, no contact email on file for booking ${row.bookingId}`);
        await logSkipped(ctx, subject, REASONS.noEmail);
        continue;
      }
      target = { channel: "email", to: row.contactEmail };
    }

    // CAPS, recipe passes only (caps.ts). Checked AFTER the gate and the
    // address, so only rows that would actually send count against them;
    // a skipped row is left unstamped and is simply due again. The TICK cap
    // is a per-tick queue, not logged (this row is due again next tick,
    // twelve times before the band closes); the DAILY cap is logged — the
    // client's own limit was reached today.
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
      await logSkipped(ctx, subject, REASONS.dailyCap);
      continue;
    }
    // The cap accounting runs BEFORE the send below, so a row that ends up
    // HELD (quiet hours) still consumed a tick slot tonight — harmless: it
    // is simply held again next tick. The DAILY cap stays exact regardless,
    // because it is re-read from stamps (countReviewRequestsSince) every
    // tick, never carried forward from this in-memory counter.
    attemptsThisTick++;
    sentToday.set(row.accountId, today + 1);

    const body = row.body.trim() || defaultReviewRequestBody(row.brandName);

    let smsRow: SentSms | null = null;
    try {
      const outcome = await holdOrSend(ctx, subject, async () => {
        if (target.channel === "sms") {
          smsRow = await sendAutomationSms(ctx, {
            accountId: row.accountId, contactId: row.contactId, to: target.to, from: target.from,
            body: composeReviewRequestSms(body, config.reviewUrl),
            onProviderFailure: () => stampReviewRequestSmsFailed(ctx.db, row.bookingId),
          });
        } else {
          await sendEmail(ctx, row, config, target.to, body);
        }

        // SEND-THEN-STAMP. The stamp comes BEFORE the SMS row's status
        // update: the stamp is what stops ~12 duplicates over the morning
        // band; the status is what the inbox shows. Same residual as the
        // other passes when every attempt fails — counted, logged, and the
        // repeats are live.
        const stamp = await stampWithRetry(() => stampReviewRequested(ctx.db, row.bookingId));
        if (!stamp.stamped) {
          c.unstamped++;
          console.error(
            `review request sent but NOT stamped for booking ${row.bookingId} after `
            + `${stamp.attempts} attempts — expect up to 11 more copies before the morning band `
            + `closes: ${String(stamp.lastError)}`,
          );
        }

        if (smsRow) await markAutomationSmsSent(ctx, row.accountId, smsRow, "review request");
      });
      if (outcome === "held") {
        c.held++;
        continue;
      }
      c.sent++;
    } catch (e) {
      c.failed++;
      console.error(`review request send failed for booking ${row.bookingId}: ${String(e)}`);
      continue;
    }
  }

  return c;
}

/**
 * Brings ONE held row back. Re-reads the booking (the operator may have
 * un-completed it, or review requests may have been switched off since the
 * hold), then runs it through the exact same loop with `released: true` —
 * one row, so its outcome IS the pass's counters (`verdict`).
 */
export const releaseReviewRequest: Releaser = async (ctx, row) => {
  const bookingId = row.subject_key.replace(/^booking:/, "");
  const found = await getDueReviewRequestById(ctx.db, bookingId);
  if (!found.due) {
    await logSkipped(ctx, subjectOf(row), found.why === "off" ? REASONS.recipeOff : REASONS.noLongerDue);
    return "skipped";
  }
  // the held row's key is not trusted across tenants; a mismatch never sends and leaves the queue
  if (found.due.accountId !== row.account_id) {
    await logSkipped(ctx, subjectOf(row), REASONS.noLongerDue);
    return "skipped";
  }
  return verdict(await processReviewRequests(ctx, [found.due], { released: true }));
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
