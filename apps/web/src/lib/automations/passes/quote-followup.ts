import {
  listDueQuoteFollowups, getDueQuoteFollowupById, latestInboundByContact,
  stampQuoteFollowupSent, stampQuoteFollowupSmsFailed, countQuoteFollowupsSince,
  type DueQuoteFollowup,
} from "@bis/db";
import { emailBrandNamed } from "@/lib/email/templates/shell";
import { normalizeReplyTo } from "@/lib/email/reply-to";
import { quoteFollowupEmail } from "@/lib/email/templates/quote-followup";
import { resolveSmsSender, type SmsGate } from "@/lib/sms/sender";
import { toE164 } from "@/lib/voice/phone-number";
import { resolveAccountZone } from "@/lib/booking/followup-timing";
import { stampWithRetry } from "@/lib/booking/stamp-retry";
import { shouldSendQuoteFollowupNow } from "../quote-followup-gate";
import { defaultQuoteFollowupBody, quoteFollowupSubject } from "../quote-followup-copy";
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
 * The quote follow-up — the one recipe driven by the PIPELINE rather than by
 * a booking. The operator nominates the stage they move a deal into once the
 * quote has gone out; a few quiet days later, with no reply from the
 * customer, this checks in once and never again (`quote_followup_sent_at` is
 * permanent).
 *
 * NOTHING CREATES AN OPPORTUNITY AUTOMATICALLY — the pipeline dialog, the
 * demo seed and an accepted `call_proposals` row are the only three writers —
 * so this recipe can only ever act on a deal a human put in front of it. The
 * card's own copy says so; it is the operator-facing half of the same fact.
 *
 * Per row, each refusal counted under its own name so triage can tell them
 * apart: invalid config → unresolvable zone → not this morning → no
 * deliverable address → SMS gate refused (NO fallback to email) → SMS
 * cooldown → caps → send → STAMP → (sms) mark the row sent.
 */
export const quoteFollowupPass: Pass = {
  key: "quoteFollowups",
  async run(ctx) {
    return processQuoteFollowups(
      ctx, await listDueQuoteFollowups(ctx.db, ctx.now.toISOString()), { released: false });
  },
};

export type ProcessOptions = { released: boolean };

export async function processQuoteFollowups(
  ctx: PassContext, due: DueQuoteFollowup[], opts: ProcessOptions,
) {
  const c = {
    sent: 0, failed: 0, unstamped: 0, held: 0,
    skippedInvalidConfig: 0, skippedNoAddress: 0, skippedSmsGate: 0, skippedRecentFailure: 0, skippedCap: 0,
    waitingForMorning: 0, unresolvableTimezone: 0,
  };

  const smsGates = new Map<string, SmsGate>();
  const sentToday = new Map<string, number>();
  let attemptsThisTick = 0;

  for (const row of due) {
    const config = row.config;
    if (config === null) {
      // DEFENSIVE ONLY, and the counter reads 0 for ever on a healthy tree:
      // `listDueQuoteFollowups` drops an account whose config will not parse
      // before it can become a row (its own `console.error` branch), and
      // `getDueQuoteFollowupById` answers `why: "off"` for the same, so the
      // releaser writes `recipeOff` and never enters this loop. It stays
      // because `DueQuoteFollowup.config` is nullable and a silent
      // `null.channel` in a cron tick is worse than a counter nobody moves.
      //
      // NOT logged: the channel is unknown before the config parses, so there
      // is no subject (its channel field is required) to write against.
      c.skippedInvalidConfig++;
      console.error(
        `quote follow-up skipped for opportunity ${row.opportunityId}: account ${row.accountId}'s `
        + `quote_followup config is missing or invalid — re-save the recipe in Automations`,
      );
      continue;
    }

    const subject: HoldSubject = {
      accountId: row.accountId, accountTimezone: row.accountTimezone, source: "quote_followup",
      channel: config.channel, subjectKey: `opportunity:${row.opportunityId}`, contactId: row.contactId,
    };

    if (resolveAccountZone(row.accountTimezone) === null) {
      c.unresolvableTimezone++;
      console.error(
        `quote follow-up HELD for opportunity ${row.opportunityId}: account ${row.accountId}'s timezone `
        + `${JSON.stringify(row.accountTimezone)} is not a zone we can resolve`,
      );
      await logSkipped(ctx, subject, REASONS.timezone);
      continue;
    }

    // NO `laterOf` anchor here: `stage_changed_at` IS the clock, written by
    // both `moveOpportunityStage` and `moveOpportunityToStage`. Skipped on a
    // RELEASE — the band already said yes once, when this row was held.
    if (!opts.released && !shouldSendQuoteFollowupNow(
      ctx.now, new Date(row.stageChangedAt), row.quietDays, row.accountTimezone)) {
      c.waitingForMorning++;
      continue;   // silent: the row is due again tomorrow morning
    }

    let target: Target;
    if (config.channel === "sms") {
      const to = toE164(row.contactPhone);
      if (!to) {
        c.skippedNoAddress++;
        console.error(`quote follow-up skipped, no textable phone on file for opportunity ${row.opportunityId}`);
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
          // `review-request.ts:142-146` makes for the same read.
          c.failed++;
          console.error(`quote follow-up: sms gate read failed for account ${row.accountId}: ${String(e)}`);
          continue;
        }
        smsGates.set(row.accountId, gate);
      }
      if (!gate.ok) {
        c.skippedSmsGate++;
        console.error(
          `quote follow-up skipped for opportunity ${row.opportunityId}: account ${row.accountId} cannot `
          + `text (${gate.reason}) — not falling back to email`,
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
        console.error(`quote follow-up skipped, no contact email on file for opportunity ${row.opportunityId}`);
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
      today = await countQuoteFollowupsSince(
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

    const body = row.body.trim() || defaultQuoteFollowupBody(row.brandName);

    let smsRow: SentSms | null = null;
    try {
      const outcome = await holdOrSend(ctx, subject, async () => {
        if (target.channel === "sms") {
          // NO composer and NO trailing link: the quote is a document the
          // operator already sent, and there is nowhere for a link to point.
          smsRow = await sendAutomationSms(ctx, {
            accountId: row.accountId, contactId: row.contactId, to: target.to, from: target.from,
            body,
            onProviderFailure: () => stampQuoteFollowupSmsFailed(ctx.db, row.opportunityId),
          });
        } else {
          await sendEmail(ctx, row, target.to, body);
        }

        const stamp = await stampWithRetry(() => stampQuoteFollowupSent(ctx.db, row.opportunityId));
        if (!stamp.stamped) {
          c.unstamped++;
          console.error(
            `quote follow-up sent but NOT stamped for opportunity ${row.opportunityId} after `
            + `${stamp.attempts} attempts — expect more copies while the morning band is open: `
            + String(stamp.lastError),
          );
        }
        if (smsRow) await markAutomationSmsSent(ctx, row.accountId, smsRow, "quote follow-up");
      });
      if (outcome === "held") {
        c.held++;
        continue;
      }
      c.sent++;
    } catch (e) {
      c.failed++;
      console.error(`quote follow-up send failed for opportunity ${row.opportunityId}: ${String(e)}`);
      continue;
    }
  }

  return c;
}

export const releaseQuoteFollowup: Releaser = async (ctx, row) => {
  const opportunityId = row.subject_key.replace(/^opportunity:/, "");
  const found = await getDueQuoteFollowupById(ctx.db, opportunityId);
  if (!found.due) {
    await logSkipped(ctx, subjectOf(row), found.why === "off" ? REASONS.recipeOff : REASONS.noLongerDue);
    return "skipped";
  }
  if (found.due.accountId !== row.account_id) {
    await logSkipped(ctx, subjectOf(row), REASONS.noLongerDue);
    return "skipped";
  }
  // The stage the recipe watches may have been deleted or re-pointed during
  // the hold. A normal tick cannot produce this — the due-list filters on the
  // stage — so this is the ONLY place the reason is reachable, and it exists
  // so the held row leaves the queue instead of sitting in it forever.
  if (found.due.stageId !== found.due.configStageId) {
    await logSkipped(ctx, subjectOf(row), REASONS.stageGone);
    return "skipped";
  }
  // THE QUIET RE-CHECK. A customer who replied during the hold must not be
  // chased at 8 AM about a quote they already answered. Written `skipped`,
  // never left untouched: an untouched released row keeps its past
  // `held_until` and parks the head of the queue.
  //
  // SCOPED BY THE SINGLE CONTACT ID: `latestInboundByContact` reads
  // `conversations` with no account_id filter of its own, and on the tick
  // path the ids come from an already-narrowed candidate set. Here that
  // narrowing IS this one id, taken from the re-read row rather than the log.
  const inbound = await latestInboundByContact(
    ctx.db, [found.due.contactId], found.due.stageChangedAt);
  const replied = inbound.get(found.due.contactId);
  if (replied && new Date(replied).getTime() > new Date(found.due.stageChangedAt).getTime()) {
    await logSkipped(ctx, subjectOf(row), REASONS.heardBack);
    return "skipped";
  }
  return verdict(await processQuoteFollowups(ctx, [found.due], { released: true }));
};

async function sendEmail(
  ctx: PassContext, row: DueQuoteFollowup, to: string, body: string,
): Promise<void> {
  // emailBrandNamed, because the row carries the resolved brand name and
  // nothing else — there is no accountName here to get wrong.
  const brand = emailBrandNamed(row.branding, row.brandName);
  // The subject is composed here, not inside the template: an account with no
  // brand name has `brandName === ""` (brandDisplayName, branding.ts:197-199)
  // and a template interpolating it would ship "About your quote from ".
  const { subject, html, text } = quoteFollowupEmail({
    brand, subject: quoteFollowupSubject(row.brandName), body,
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
