import {
  listDueReactivations, getDueReactivationById, stampReactivationSent, countReactivationsSince,
  conversationQuietSince, reactivationCutoff, type DueReactivation,
} from "@bis/db";
import { emailBrandNamed } from "@/lib/email/templates/shell";
import { normalizeReplyTo } from "@/lib/email/reply-to";
import { reactivationEmail } from "@/lib/email/templates/reactivation";
import { resolveAccountZone } from "@/lib/booking/followup-timing";
import { stampWithRetry } from "@/lib/booking/stamp-retry";
import { shouldSendReactivationNow, missingForReactivation } from "../reactivation-gate";
import { defaultReactivationBody, reactivationSubject, reactivationFooterReason } from "../reactivation-copy";
import { AUTOMATION_TICK_CAP, REACTIVATION_DAILY_CAP, DAILY_CAP_WINDOW_MS } from "../caps";
import {
  holdOrSend, logSkipped, subjectOf, verdict, REASONS, type HoldSubject, type Releaser,
} from "../hold-or-send";
import type { Pass, PassContext } from "../context";

/**
 * The check-in to a past customer who has gone quiet — part B's recipe with
 * spam teeth, and every one of its restraints is structural rather than
 * advisory:
 *   - EMAIL ONLY (spec decision 4). There is no per-contact SMS consent in
 *     this schema, and "we haven't seen you in a while" is marketing, not
 *     customer care. The due-row carries no phone number, so a recipe author
 *     cannot text it by mistake. The unlock is named, not vague: a
 *     per-contact consent column and an approved marketing campaign.
 *   - ONLY PAST CUSTOMERS. A completed booking is a query predicate in the
 *     due-list, not a hope.
 *   - FIVE A DAY per account (REACTIVATION_DAILY_CAP), oldest conversation
 *     first so nobody starves.
 *   - ONCE PER CONTACT, EVER. `contacts.reactivation_sent_at` is permanent,
 *     which is also why turning the recipe off mid-drain strands nothing.
 *   - THE QUIET PERIOD IS CHECKED EXACTLY, HERE, before every send. The
 *     due-list's bulk message read is a bounded pre-filter against a column
 *     that can lag; this pass asks `conversationQuietSince` per row, with
 *     THIS account's own cutoff. Nothing goes out on the strength of the
 *     pre-filter alone.
 *
 * Morning band 08:00–11:00 in the account's zone, plus quiet hours. The
 * release re-checks the quiet period FIRST, because someone who wrote in
 * during a hold must never then be told "it's been a while".
 */
export const reactivationPass: Pass = {
  key: "reactivations",
  async run(ctx) {
    return processReactivations(ctx, await listDueReactivations(ctx.db, ctx.now.toISOString()), { released: false });
  },
};

export type ProcessOptions = { released: boolean };

export async function processReactivations(
  ctx: PassContext, due: DueReactivation[], opts: ProcessOptions,
) {
  const c = {
    sent: 0, failed: 0, unstamped: 0, held: 0,
    skippedCap: 0, skippedHeardBack: 0, waitingForMorning: 0, unresolvableTimezone: 0,
    skippedNoMailingAddress: 0, skippedNoReplyTo: 0,
  };
  const sentToday = new Map<string, number>();
  let attemptsThisTick = 0;

  for (const row of due) {
    // The channel is fixed, so unlike the configured-channel recipes the
    // subject can be built before anything else.
    const subject: HoldSubject = {
      accountId: row.accountId, accountTimezone: row.accountTimezone, source: "reactivation",
      channel: "email", subjectKey: `contact:${row.contactId}`, contactId: row.contactId,
    };

    if (resolveAccountZone(row.accountTimezone) === null) {
      c.unresolvableTimezone++;
      console.error(
        `reactivation HELD for contact ${row.contactId}: account ${row.accountId}'s timezone `
        + `${JSON.stringify(row.accountTimezone)} is not a zone we can resolve`,
      );
      await logSkipped(ctx, subject, REASONS.timezone);
      continue;
    }

    // Skipped entirely on a release: the band already said yes once, when
    // this row was held. Silent on a normal tick — the row is due again
    // tomorrow morning and there is nothing a client would want to read.
    if (!opts.released && !shouldSendReactivationNow(ctx.now, row.accountTimezone)) {
      c.waitingForMorning++;
      continue;
    }

    // NOTHING TO STAND ON (decision A, danlo, 2026-09-22). The check-in is
    // commercial email, which under CAN-SPAM (the orchestrator's reading, not
    // a lawyer's) carries the sender's postal address and a working opt-out;
    // this one's opt-out is a REPLY, so a reply must reach the business, not
    // the agency's `EMAIL_FROM` mailbox. The save refuses to turn the recipe
    // on without both, but either can be cleared on the Branding page since.
    //
    // ON A NORMAL TICK this is a BACKSTOP: `listDueReactivations` asks the
    // same function and leaves an account missing either out of its walk
    // (review fix, 2026-09-22), so such rows do not reach this loop and the
    // operator's signal is the Automations card, not the Activity page.
    // It BITES on a RELEASE — `releaseReactivation` comes through this same
    // loop off `getDueReactivationById`, which is deliberately unfiltered,
    // so an address cleared during a hold is caught here and the held row
    // is re-written `skipped` with a reason the client can read.
    //
    // BEFORE THE CAPS, on purpose: a row skipped here is never stamped, and
    // behind the tick cap a run of them would spend all ten attempts and
    // starve everyone else. AFTER the band, so outside the morning nothing
    // is logged at all.
    const missing = missingForReactivation(row.mailingAddress, row.replyToEmail);
    if (missing.mailingAddress) {
      c.skippedNoMailingAddress++;
      await logSkipped(ctx, subject, REASONS.noMailingAddress);
      continue;
    }
    if (missing.replyTo) {
      c.skippedNoReplyTo++;
      await logSkipped(ctx, subject, REASONS.noReplyTo);
      continue;
    }

    if (attemptsThisTick >= AUTOMATION_TICK_CAP) {
      c.skippedCap++;
      continue;                                  // a per-tick queue, not logged
    }
    let today = sentToday.get(row.accountId);
    if (today === undefined) {
      today = await countReactivationsSince(
        ctx.db, row.accountId, new Date(ctx.now.getTime() - DAILY_CAP_WINDOW_MS).toISOString());
      sentToday.set(row.accountId, today);
    }
    if (today >= REACTIVATION_DAILY_CAP) {
      c.skippedCap++;
      await logSkipped(ctx, subject, REASONS.dailyCap);
      continue;
    }
    attemptsThisTick++;
    sentToday.set(row.accountId, today + 1);

    // THE EXACT QUIET CHECK, per row, immediately before the send — and the
    // reason the due-list's bulk message read is allowed to be a cheap
    // pre-filter. That read is bounded by a row limit, so one chatty
    // conversation can crowd the others out of its results; this one is
    // scoped to a single conversation, takes no limit, and asks THIS
    // account's own cutoff rather than the widest across accounts. Without
    // it, an account set to eighteen months on a platform where somebody
    // else is set to six never has its own cutoff enforced, and a customer
    // who wrote in ten months ago is told "it's been a while since we were
    // out at your place".
    //
    // It sits AFTER the caps on purpose: the caps are what bound how many of
    // these reads one tick can make. The cost is that a row skipped here has
    // spent one of the five in-memory day slots — for this tick only, since
    // the next tick re-reads the real count from the stamp column.
    //
    // Skipped on a RELEASE because `releaseReactivation` has already made the
    // same call and written a real `heardBack` row if it bit; making it twice
    // would be a second read for the same answer.
    //
    // Silent on a normal tick: the row was never due, it is examined again
    // next tick, and there is nothing here a client would want to read.
    if (!opts.released) {
      const cutoff = reactivationCutoff(ctx.now, row.quietMonths);
      if (!await conversationQuietSince(ctx.db, row.accountId, row.contactId, cutoff.toISOString())) {
        c.skippedHeardBack++;
        console.error(
          `reactivation skipped for contact ${row.contactId}: a message newer than `
          + `${cutoff.toISOString()} exists, though conversations.last_message_at said `
          + `${row.lastMessageAt} — the touch lagged (messaging.ts:120-131)`,
        );
        continue;
      }
    }

    const body = row.body.trim() || defaultReactivationBody(row.brandName);

    try {
      const outcome = await holdOrSend(ctx, subject, async () => {
        const brand = emailBrandNamed(row.branding, row.brandName);
        const { subject: line, html, text } = reactivationEmail({
          brand, subject: reactivationSubject(row.brandName), body,
          // Non-null here: the check above skipped every row without one.
          mailingAddress: row.mailingAddress!,
          // Composed here like the subject, so the blank-brand branch stays
          // in the copy module and the template only prints.
          footerReason: reactivationFooterReason(row.brandName),
        });
        await ctx.email.send({
          to: row.contactEmail,
          fromName: brand.name,
          fromAddress: row.fromEmail ?? undefined,
          replyTo: normalizeReplyTo(row.replyToEmail),
          subject: line, body: text, html,
        });
        const stamp = await stampWithRetry(() => stampReactivationSent(ctx.db, row.contactId));
        if (!stamp.stamped) {
          c.unstamped++;
          console.error(
            `reactivation sent but NOT stamped for contact ${row.contactId} after ${stamp.attempts} `
            + `attempts — this person can receive it again: ${String(stamp.lastError)}`,
          );
        }
      });
      if (outcome === "held") {
        c.held++;
        continue;
      }
      c.sent++;
    } catch (e) {
      c.failed++;
      console.error(`reactivation send failed for contact ${row.contactId}: ${String(e)}`);
    }
  }

  return c;
}

export const releaseReactivation: Releaser = async (ctx, row) => {
  const contactId = row.subject_key.replace(/^contact:/, "");
  const found = await getDueReactivationById(ctx.db, contactId);
  if (!found.due) {
    await logSkipped(ctx, subjectOf(row), found.why === "off" ? REASONS.recipeOff : REASONS.noLongerDue);
    return "skipped";
  }
  if (found.due.accountId !== row.account_id) {
    await logSkipped(ctx, subjectOf(row), REASONS.noLongerDue);
    return "skipped";
  }
  // THE QUIET RE-CHECK, and it runs FIRST among this releaser's own rules.
  // A hold can last hours; someone who wrote in during it has a live
  // conversation, and "it's been a while since we were out at your place"
  // talks straight over it. Written `skipped` rather than left untouched —
  // an untouched released row keeps its past `held_until` and parks the head
  // of the queue.
  const cutoff = reactivationCutoff(ctx.now, found.due.quietMonths);
  if (!await conversationQuietSince(ctx.db, found.due.accountId, contactId, cutoff.toISOString())) {
    await logSkipped(ctx, subjectOf(row), REASONS.heardBack);
    return "skipped";
  }
  return verdict(await processReactivations(ctx, [found.due], { released: true }));
};
