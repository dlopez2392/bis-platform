import {
  listDueReviewRequests, stampReviewRequested, stampReviewRequestSmsFailed, countReviewRequestsSince,
  getDueReviewRequestById, chooseBody, REVIEW_REQUEST_MAX_AGE_MS, recentReviewAsks, emailKey, missingForMarketingEmail,
  type DueReviewRequest, type ReviewRequestConfig, type RecipientLanguage,
} from "@bis/db";
import { emailBrandNamed } from "@/lib/email/templates/shell";
import { normalizeReplyTo } from "@/lib/email/reply-to";
import { reviewRequestEmail } from "@/lib/email/templates/review-request";
import { reviewCheckinEmail } from "@/lib/email/templates/review-checkin";
import { checkinLink } from "@/lib/checkin/token";
import { configuredOrigin } from "@/lib/email/origin";
import { resolveSmsSender, type SmsGate } from "@/lib/sms/sender";
import { normalisePhone } from "@bis/db/phone";
import { resolveAccountZone } from "@/lib/booking/followup-timing";
import { stampWithRetry } from "@/lib/booking/stamp-retry";
import { laterOf } from "../anchor";
import { shouldSendReviewRequestNow } from "../review-request-gate";
import { checkinTiming, CHECKIN_MAX_AGE_MS } from "../review-checkin-gate";
import { composeReviewRequestSms, defaultReviewRequestBody } from "../review-request-copy";
import { AUTOMATION_TICK_CAP, AUTOMATION_DAILY_CAP, DAILY_CAP_WINDOW_MS } from "../caps";
import { sendAutomationSms, markAutomationSmsSent, smsCooldownActive, type SentSms } from "../send-sms";
import {
  holdOrSend, logSkipped, subjectOf, verdict, REASONS, type SmsHoldSubject, type Releaser,
} from "../hold-or-send";
import type { Pass, PassContext } from "../context";
import { loggableError } from "@/lib/loggable-error";

type Target =
  | { channel: "sms"; to: string }
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
 * THE CHECK-IN (F-072, docs/superpowers/plans/2026-11-17-review-requests.md): an account whose recipe config has
 * `checkin: true`, on the EMAIL channel, sends "How did we do?" two hours after the anchor instead (`asCheckin`
 * below): the same kind, so the opt-out, the hours, the footer and `outbound_suppressed` are the consent chain's
 * and unchanged; no morning band and no deferral to the calendar follow-up (review-checkin-gate.ts); the words
 * are ours, never the operator's; the account must have a mailing address (the marketing footer prints it); the
 * link must be sealable; and a customer is asked at most once per 90 days, by contact AND by address (the
 * database read plus a memory of this tick, which the stamp cannot cover until it lands). The held/released path
 * is the same loop, so a held check-in is re-gated on release. An account WITHOUT the flag runs none of this.
 * The check-in's own counters (`waitingForCheckin` (not yet two hours), `expiredCheckin` (past 36 h), `skippedRecentlyAsked`, `skippedNoMailingAddress`,
 * `skippedNoLink`) appear in the result only when nonzero, so the cron's JSON for every account without it is
 * byte-identical to before (route.test.ts is the proof).
 *
 * Nothing new sends: `ctx.email` and `ctx.sms` (the send gate) come from the harness.
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

/** A customer is asked for a review at most once per this long (plan D4, danlo 2026-11-17). */
const ASK_INTERVAL_MS = 90 * 24 * 60 * 60 * 1000;

/** Who a row would be asking, as the keys the same-tick memory holds: the contact, and the address as the consent
 *  ledger reads it (`emailKey`: case and a +tag are one inbox), each scoped to the account (separate tenants). */
function askKeys(accountId: string, contactId: string, email: string | null): string[] {
  const key = email ? emailKey(email) : "";
  return [`${accountId}:contact:${contactId}`, ...(key ? [`${accountId}:address:${key}`] : [])];
}

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
    sent: 0, failed: 0, unstamped: 0, held: 0, blocked: 0,
    skippedInvalidConfig: 0, skippedNoAddress: 0, skippedSmsGate: 0, skippedRecentFailure: 0, skippedCap: 0,
    waitingForMorning: 0, unresolvableTimezone: 0,
  };
  // F-072's own counters: merged into the result only when nonzero (see the pass's comment).
  const k = { waitingForCheckin: 0, expiredCheckin: 0, skippedRecentlyAsked: 0, skippedNoMailingAddress: 0, skippedNoLink: 0 };

  // Per-account memos for one tick: the sender gate and the daily count
  // are answered once per account, not once per row.
  const smsGates = new Map<string, SmsGate>();
  const sentToday = new Map<string, number>();
  let attemptsThisTick = 0;
  // Who was asked (sent or held) earlier in THIS tick: two jobs completed together must send one email, and the
  // database cannot see the first stamp until it lands (or ever, if it fails).
  const askedThisTick = new Set<string>();

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

    // THE CLOCK (0026): the later of the meeting end and "Mark completed".
    const anchor = laterOf(new Date(row.endsAt), row.completedAt ? new Date(row.completedAt) : null);

    // F-072. `checkin` turns the 90-day rule on for either channel; the check-in EMAIL itself is the email channel's.
    const checkin = config.checkin === true;
    const asCheckin = checkin && config.channel === "email";

    // Built only once the channel is known: the log subject's channel field
    // is the CONFIGURED one, never a guess.
    const subject: SmsHoldSubject = {
      accountId: row.accountId, accountTimezone: row.accountTimezone, source: "review_request",
      channel: config.channel, smsKind: "automation.review_request", subjectKey: `booking:${row.bookingId}`, contactId: row.contactId,
      // S-47d (spec 5.5.2, SD20): a closure covering this appointment holds the send unless the owner kept it.
      appointmentAt: new Date(row.startsAt), kept: row.closureKeptAt !== null,
      // M7a PR-4 (plan G7a, re-review I2): a pause hold never runs past the list's own age window.
      pauseDeadline: new Date(anchor.getTime() + (asCheckin ? CHECKIN_MAX_AGE_MS : REVIEW_REQUEST_MAX_AGE_MS)),
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

    if (asCheckin) {
      // THE CHECK-IN'S MOMENT: two hours after the anchor, and not older than 36 h. It runs on BOTH paths, as the
      // review request's does: there is no band to skip on a release, so a held check-in is re-gated, not re-banded.
      // Silent on a normal tick (the row is simply examined again next tick); on a release a real skip, or the row
      // keeps its past `held_until` and parks the head of the queue.
      const timing = checkinTiming(ctx.now, anchor, row.accountTimezone);
      if (timing !== "due") {
        if (timing === "late") k.expiredCheckin++; else k.waitingForCheckin++;
        if (opts.released) await logSkipped(ctx, subject, REASONS.noLongerDue);
        continue;
      }
    }

    const followupSentAt = row.followupSentAt ? new Date(row.followupSentAt) : null;
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
    if (!asCheckin && !shouldSendReviewRequestNow(
      ctx.now, anchor, followupSentAt, row.accountTimezone, { skipBand: opts.released })) {
      c.waitingForMorning++;
      if (opts.released) await logSkipped(ctx, subject, REASONS.noLongerDue);
      continue;
    }

    // The deliverable address for the CHOSEN channel. SMS: contacts.phone
    // is free-form and normalisePhone (F-009) is the one rule every number
    // leaving this app goes through (null = nothing we can text); the send
    // gate reads the stored number again itself. Email: the address or nothing.
    let target: Target;
    let checkinUrl: string | null = null;
    if (config.channel === "sms") {
      const to = normalisePhone(row.contactPhone) ? row.contactPhone : null;
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
          console.error(`review request: sms gate read failed for account ${row.accountId}: ${loggableError(e)}`);
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
      target = { channel: "sms", to };
    } else {
      if (!row.contactEmail) {
        c.skippedNoAddress++;
        console.error(`review request skipped, no contact email on file for booking ${row.bookingId}`);
        await logSkipped(ctx, subject, REASONS.noEmail);
        continue;
      }
      if (asCheckin) {
        // The marketing footer prints the postal address, so a check-in without one is not sent (the referral ask's
        // rule, asked through the same function). Before the link and the 90-day read: cheapest first.
        if (missingForMarketingEmail(row.mailingAddress, null).mailingAddress) {
          k.skippedNoMailingAddress++;
          await logSkipped(ctx, subject, REASONS.noMailingAddress);
          continue;
        }
        // The page link, sealed now, on the CONFIGURED origin only (plan D6): `ctx.origin` falls back to the request's
        // own host, which for a cron is the deployment's vercel.app URL, and Gmail discards mail whose links point
        // there. No link that works (APP_ORIGIN not configured, no secret, a production secret under 32 characters,
        // an id that is not a uuid) means NO email: a dead or weakly signed link is worse than none.
        // Console only on a normal tick (a deployment fault, not the customer's), a real skip on a release.
        checkinUrl = checkinLink({
          accountId: row.accountId, bookingId: row.bookingId, language: row.language, now: ctx.now,
          origin: configuredOrigin(),
        });
        if (checkinUrl === null) {
          k.skippedNoLink++;
          console.error(
            `review check-in skipped for booking ${row.bookingId}: no link can be made (APP_ORIGIN or `
            + `CONSENT_TOKEN_SECRET unset or unusable) — set them; nothing is sent without its link`,
          );
          if (opts.released) await logSkipped(ctx, subject, REASONS.noLongerDue);
          continue;
        }
      }
      target = { channel: "email", to: row.contactEmail };
    }

    // CAPS, recipe passes only (caps.ts). Checked AFTER the gate and the
    // address, so only rows that would actually send count against them;
    // a skipped row is left unstamped and is simply due again. The TICK cap
    // is a per-tick queue, not logged (this row is due again next tick,
    // twelve times before the band closes); the DAILY cap (below) is logged —
    // the client's own limit was reached today. The tick cap is in memory and
    // comes BEFORE the 90-day read, so a burst of due rows past it costs no
    // database read at all.
    if (attemptsThisTick >= AUTOMATION_TICK_CAP) {
      c.skippedCap++;
      continue;
    }

    // THE 90 DAYS (plan D4): a customer is asked for a review at most once per 90 days, by contact AND by address.
    // The memory first (free, and the only thing that sees an earlier row of THIS tick), then the database. A read
    // that fails sends nothing for the row: answering "not asked" on an error would send.
    const keys = checkin ? askKeys(row.accountId, row.contactId, target.channel === "email" ? target.to : null) : [];
    if (checkin) {
      let asked = keys.some((key) => askedThisTick.has(key));
      if (!asked) {
        try {
          asked = await recentReviewAsks(
            ctx.db, row.accountId, { contactId: row.contactId, email: target.channel === "email" ? target.to : null },
            new Date(ctx.now.getTime() - ASK_INTERVAL_MS).toISOString(),
          );
        } catch (e) {
          c.failed++;
          console.error(`review check-in: the 90-day read failed for booking ${row.bookingId}, nothing sent: ${loggableError(e)}`);
          continue;
        }
      }
      if (asked) {
        k.skippedRecentlyAsked++;
        // Silent on a normal tick (due again until it ages out); a real skip on a release, or it parks.
        if (opts.released) await logSkipped(ctx, subject, REASONS.noLongerDue);
        continue;
      }
    }

    // CAPS, recipe passes only (caps.ts), continued: the DAILY cap, which reads the database, comes after the
    // 90-day check above; the TICK cap (in memory) came first, see there.
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
    // The cap accounting runs BEFORE the send below; a row the gate refuses
    // gives back both, and a row it HOLDS gives back its tick slot (below).
    // The DAILY cap stays exact regardless, because it is re-read from
    // stamps (countReviewRequestsSince) every tick, never carried forward
    // from this in-memory counter.
    attemptsThisTick++;
    sentToday.set(row.accountId, today + 1);

    // S-09 PR 2 (C11): the chosen language drives the template, the link sentence and the gate's footer.
    const chosen = chooseBody({
      language: row.language, body: row.body, bodyEs: row.bodyEs,
      defaults: { en: defaultReviewRequestBody(row.brandName, "en"), es: defaultReviewRequestBody(row.brandName, "es") },
    });
    const body = chosen.text;

    let smsRow: SentSms | null = null;
    try {
      const outcome = await holdOrSend(ctx, subject, async () => {
        if (target.channel === "sms") {
          smsRow = await sendAutomationSms(ctx, {
            accountId: row.accountId, contactId: row.contactId, to: target.to,
            kind: subject.smsKind, accountTimezone: row.accountTimezone,
            body: composeReviewRequestSms(body, config.reviewUrl),
            language: chosen.language,
            onProviderFailure: () => stampReviewRequestSmsFailed(ctx.db, row.bookingId),
          });
        } else if (asCheckin && checkinUrl !== null) {
          await sendCheckinEmail(ctx, row, target.to, checkinUrl);
        } else {
          await sendEmail(ctx, row, config, target.to, body, chosen.language);
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
            + (asCheckin
              ? `${stamp.attempts} attempts — it stays due and is retried every tick until it ages out (36 h); the `
                + `provider's idempotency key (review-checkin/<booking>) deduplicates the retries for 24 h: `
              : `${stamp.attempts} attempts — expect up to 11 more copies before the morning band closes: `)
            + String(stamp.lastError),
          );
        }

        if (smsRow) await markAutomationSmsSent(ctx, row.accountId, smsRow, "review request");
      });
      if (outcome === "skipped") {
        // The gate refused it and nothing was sent: give back the tick slot and
        // today's count taken above (review R2-I2). Otherwise ten refused rows at
        // the head of the list use up AUTOMATION_TICK_CAP, which is ONE counter
        // across every account, and starve everyone behind them.
        attemptsThisTick--;
        sentToday.set(row.accountId, (sentToday.get(row.accountId) ?? 1) - 1);
        c.blocked++;
        continue;
      }
      if (outcome === "held") {
        // Nothing went this tick, so the tick slot taken above goes back (the
        // Task 9 review, concern 1): ten accounts' texts held until noon on a
        // Sunday must not use up AUTOMATION_TICK_CAP, ONE counter across every
        // account, while another account's could go now. Today's count stays
        // taken: a held row IS that day's send.
        attemptsThisTick--;
        c.held++;
        // A held check-in IS that address's ask (it goes at the opening): its twin is not held too.
        for (const key of keys) askedThisTick.add(key);
        continue;
      }
      c.sent++;
      for (const key of keys) askedThisTick.add(key);
    } catch (e) {
      c.failed++;
      console.error(`review request send failed for booking ${row.bookingId}: ${loggableError(e)}`);
      continue;
    }
  }

  // The check-in's counters ride along only when they have something to say, so an account without the feature
  // returns exactly the counters it always did.
  return { ...c, ...Object.fromEntries(Object.entries(k).filter(([, n]) => n > 0)) };
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

/** The check-in (F-072, plan D6): same kind and same From/Reply-To rules as the review request, our own words, the
 *  customer's language, and the ONE sealed page link. `brand.name` is the row's `brandName`, never `accounts.name`. */
async function sendCheckinEmail(ctx: PassContext, row: DueReviewRequest, to: string, checkinUrl: string): Promise<void> {
  const brand = emailBrandNamed(row.branding, row.brandName);
  const { subject, html, text } = reviewCheckinEmail({ brand, checkinUrl, locale: row.language });
  await ctx.email.send({
    accountId: row.accountId, kind: "automation.review_request", contactId: row.contactId,
    origin: ctx.origin, now: ctx.now, accountZone: row.accountTimezone,
    to, fromName: brand.name, fromAddress: row.fromEmail ?? undefined,
    replyTo: normalizeReplyTo(row.replyToEmail),
    subject, body: text, html, language: row.language,
    // ONE fixed key per booking: a check-in stays due ~34 h (anything that failed after it landed, or a stamp that
    // never did, is retried on the next tick with the same key and the provider deduplicates it for 24 h).
    idempotencyKey: `review-checkin/${row.bookingId}`,
  });
}

async function sendEmail(
  ctx: PassContext, row: DueReviewRequest, config: ReviewRequestConfig, to: string, body: string,
  language: RecipientLanguage,
): Promise<void> {
  // emailBrandNamed, because the row carries the resolved brand name and
  // nothing else — there is no accountName here to get wrong.
  const brand = emailBrandNamed(row.branding, row.brandName);
  const { subject, html, text } = reviewRequestEmail({ brand, body, reviewUrl: config.reviewUrl, locale: language });
  await ctx.email.send({
    accountId: row.accountId, kind: "automation.review_request", contactId: row.contactId,
    origin: ctx.origin, now: ctx.now, accountZone: row.accountTimezone,
    to,
    fromName: brand.name,
    fromAddress: row.fromEmail ?? undefined,
    // The row's OWN top-level replyToEmail, never branding.replyToEmail —
    // the DueFollowup precedent.
    replyTo: normalizeReplyTo(row.replyToEmail),
    subject,
    body: text,
    html,
    language,
  });
}
