import { listDueFollowups, stampFollowupSent } from "@bis/db";
import { normalizeReplyTo } from "@/lib/email/reply-to";
import { emailBrand } from "@/lib/email/templates/shell";
import { bookingFollowupEmail } from "@/lib/email/templates/followup";
import { shouldSendFollowupNow, resolveAccountZone } from "@/lib/booking/followup-timing";
import { stampWithRetry } from "@/lib/booking/stamp-retry";
import type { Pass } from "../context";

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
    const followups = await listDueFollowups(ctx.db, ctx.now.toISOString());

    let sent = 0;
    let failed = 0;
    let unstamped = 0;
    let skippedNoEmail = 0;
    let waitingForMorning = 0;
    let unresolvableTimezone = 0;

    for (const followup of followups) {
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
        continue;
      }

      // THE SEND-TIME GATE, before the no-email check so a contact with no
      // email is not logged 96 times a day for something that was never
      // going to send this tick. The dominant branch by a wide margin.
      if (!shouldSendFollowupNow(ctx.now, new Date(followup.endsAt), followup.accountTimezone)) {
        waitingForMorning++;
        continue;
      }

      if (!followup.contactEmail) {
        skippedNoEmail++;
        console.error(
          `follow-up skipped, no contact email on file for booking ${followup.bookingId}`,
        );
        continue;
      }

      // SEND-THEN-STAMP, same discipline as the reminder pass.
      try {
        const brand = emailBrand(followup.branding, followup.accountName);
        const { subject, html, text } = bookingFollowupEmail({
          brand, body: followup.followupBody,
        });

        // replyTo reads DueFollowup's OWN top-level `replyToEmail`, not
        // `followup.branding.replyToEmail` — that's the whole reason
        // `listDueFollowups` duplicates it there.
        await ctx.email.send({
          to: followup.contactEmail,
          fromName: brand.name,
          fromAddress: followup.fromEmail ?? undefined,
          replyTo: normalizeReplyTo(followup.replyToEmail),
          subject,
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

        sent++;
      } catch (e) {
        failed++;
        console.error(`follow-up send failed for booking ${followup.bookingId}: ${String(e)}`);
      }
    }

    return { sent, failed, unstamped, skippedNoEmail, waitingForMorning, unresolvableTimezone };
  },
};
