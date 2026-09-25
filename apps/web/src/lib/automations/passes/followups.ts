import { listDueFollowups, stampFollowupSent, getDueFollowupById, type DueFollowup } from "@bis/db";
import { normalizeReplyTo } from "@/lib/email/reply-to";
import { emailBrand } from "@/lib/email/templates/shell";
import { bookingFollowupEmail } from "@/lib/email/templates/followup";
import { shouldSendFollowupNow, resolveAccountZone } from "@/lib/booking/followup-timing";
import { stampWithRetry } from "@/lib/booking/stamp-retry";
import {
  holdOrSend, logSkipped, subjectOf, verdict, REASONS, type HoldSubject, type Releaser,
} from "../hold-or-send";
import type { Pass, PassContext } from "../context";

/**
 * Follow-up emails the morning after a booking's meeting ENDS. Moved
 * verbatim from api/cron/reminders/route.ts onto the harness (2026-09-06).
 * UNCAPPED, for the same reason as the reminder pass (see its doc comment).
 *
 * `listDueFollowups` is only a CANDIDATE list — anything that ended in the
 * last 37h — so the gate below can always fire. The pass, not the query,
 * decides the moment. Runs BEFORE the review-request pass in the registry:
 * it stamps `followup_sent_at`, and the review gate defers to that stamp.
 */
export const followupsPass: Pass = {
  key: "followups",
  async run(ctx) {
    return processFollowups(ctx, await listDueFollowups(ctx.db, ctx.now.toISOString()), { released: false });
  },
};

/** One boolean — a shared type across the three band-gated passes would be a
 *  fourth file to keep in step for no benefit; each pass declares its own. */
export type ProcessOptions = { released: boolean };

/**
 * The loop `followupsPass.run` and `releaseFollowup` both drive. `released`
 * skips ONLY the morning-band gate (amendment 3: the band says when a thing
 * became due, the window says when it may go) — everything else, including
 * `holdOrSend`'s own quiet-hours check, still applies on release.
 */
export async function processFollowups(
  ctx: PassContext, followups: DueFollowup[], opts: ProcessOptions,
) {
  let sent = 0;
  let failed = 0;
  let unstamped = 0;
  let held = 0;
  let skippedNoEmail = 0;
  let waitingForMorning = 0;
  let unresolvableTimezone = 0;

  for (const followup of followups) {
    const subject: HoldSubject = {
      accountId: followup.accountId, accountTimezone: followup.accountTimezone, source: "followups",
      channel: "email", subjectKey: `booking:${followup.bookingId}`, contactId: followup.contactId,
    };

    // RULE 0, before the gate itself: an account whose `accounts.timezone`
    // cannot be resolved gets NO follow-up. The old `safeZone(tz, "UTC")`
    // substitution turned an unreadable zone into a send inside the
    // 08:00-11:00 UTC band — 03:00-06:00 in the Rio Grande Valley. Counted
    // under its OWN name so a misconfiguration stays visible in triage.
    const accountZone = resolveAccountZone(followup.accountTimezone);
    if (accountZone === null) {
      unresolvableTimezone++;
      console.error(
        `follow-up HELD for booking ${followup.bookingId}: account ${followup.accountId}'s `
        + `timezone ${JSON.stringify(followup.accountTimezone)} is not a zone we can resolve, `
        + `so there is no hour we can safely send at — fix the account's timezone; `
        + `this booking will age out unsent`,
      );
      await logSkipped(ctx, subject, REASONS.timezone);
      continue;
    }

    // THE SEND-TIME GATE, before the no-email check so a contact with no
    // email is not logged 96 times a day for something that was never
    // going to send this tick. The dominant branch by a wide margin.
    //
    // IT RUNS ON BOTH PATHS. A release skips the morning BAND and nothing
    // else (`skipBand`, the release contract in part B's spec at line 16 and
    // amendment B16): the band already said yes once, when this row was held,
    // and a release is not a second morning to wait for — but the 37h cap and
    // the strictly-earlier-local-day rule live nowhere else on this path, and
    // the releaser RE-READS the booking, so a meeting that moved during the
    // hold arrives here with a brand-new anchor. It used to skip the whole
    // composite, which sent a follow-up about a meeting that had aged out.
    //
    // When it refuses on a release the row is written `skipped`, never left
    // untouched: an untouched released row keeps its past `held_until` and
    // parks the head of the queue for ever. On a normal tick it stays silent
    // — the row is simply due again tomorrow morning.
    if (!shouldSendFollowupNow(
      ctx.now, new Date(followup.endsAt), followup.accountTimezone, { skipBand: opts.released })) {
      waitingForMorning++;
      if (opts.released) await logSkipped(ctx, subject, REASONS.noLongerDue);
      continue;
    }

    if (!followup.contactEmail) {
      skippedNoEmail++;
      console.error(
        `follow-up skipped, no contact email on file for booking ${followup.bookingId}`,
      );
      await logSkipped(ctx, subject, REASONS.noEmail);
      continue;
    }

    // SEND-THEN-STAMP, same discipline as the reminder pass, now behind
    // holdOrSend: inside the account's quiet window it writes a held row and
    // returns "held" without sending or stamping — the row is simply due
    // again once the window closes (or a release brings it back sooner).
    try {
      const outcome = await holdOrSend(ctx, subject, async () => {
        const brand = emailBrand(followup.branding);
        const { subject: emailSubject, html, text } = bookingFollowupEmail({
          brand, body: followup.followupBody,
        });

        // replyTo reads DueFollowup's OWN top-level `replyToEmail`, not
        // `followup.branding.replyToEmail` — that's the whole reason
        // `listDueFollowups` duplicates it there.
        await ctx.email.send({
          to: followup.contactEmail!,
          fromName: brand.name,
          fromAddress: followup.fromEmail ?? undefined,
          replyTo: normalizeReplyTo(followup.replyToEmail),
          subject: emailSubject,
          body: text,
          html,
        });

        // The WORSE of the two migrated paths: the morning band is ~12 ticks
        // wide, so an unstamped row is ~12 identical emails. Its own retry
        // budget, deliberately not shared with the reminder pass.
        const stamp = await stampWithRetry(() => stampFollowupSent(ctx.db, followup.bookingId));
        if (!stamp.stamped) {
          unstamped++;
          console.error(
            `follow-up sent but NOT stamped for booking ${followup.bookingId} after `
            + `${stamp.attempts} attempts — expect up to 11 more copies before the `
            + `morning band closes: ${String(stamp.lastError)}`,
          );
        }
      });
      if (outcome === "held") {
        held++;
        continue;
      }
      sent++;
    } catch (e) {
      failed++;
      console.error(`follow-up send failed for booking ${followup.bookingId}: ${String(e)}`);
    }
  }

  return { sent, failed, unstamped, held, skippedNoEmail, waitingForMorning, unresolvableTimezone };
}

/**
 * Brings ONE held row back. Re-reads the booking (it may have been cancelled,
 * or follow-ups may have been switched off since the hold), then runs it
 * through the exact same loop with `released: true` — one row, so its
 * outcome IS the pass's counters (`verdict`).
 */
export const releaseFollowup: Releaser = async (ctx, row) => {
  const bookingId = row.subject_key.replace(/^booking:/, "");
  const found = await getDueFollowupById(ctx.db, bookingId);
  if (!found.due) {
    await logSkipped(ctx, subjectOf(row), found.why === "off" ? REASONS.recipeOff : REASONS.noLongerDue);
    return "skipped";
  }
  // the held row's key is not trusted across tenants; a mismatch never sends and leaves the queue
  if (found.due.accountId !== row.account_id) {
    await logSkipped(ctx, subjectOf(row), REASONS.noLongerDue);
    return "skipped";
  }
  return verdict(await processFollowups(ctx, [found.due], { released: true }));
};
