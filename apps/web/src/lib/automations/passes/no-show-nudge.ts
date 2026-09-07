import {
  listDueNoShowNudges, stampNoShowNudged, stampNoShowNudgeSmsFailed, countNoShowNudgesSince,
  type DueNoShowNudge,
} from "@bis/db";
import { emailBrandNamed } from "@/lib/email/templates/shell";
import { normalizeReplyTo } from "@/lib/email/reply-to";
import { noShowNudgeEmail } from "@/lib/email/templates/no-show-nudge";
import { resolveSmsSender, type SmsGate } from "@/lib/sms/sender";
import { toE164 } from "@/lib/voice/phone-number";
import { resolveAccountZone } from "@/lib/booking/followup-timing";
import { stampWithRetry } from "@/lib/booking/stamp-retry";
import { laterOf } from "../anchor";
import { shouldSendNoShowNudgeNow } from "../no-show-nudge-gate";
import { composeNoShowNudgeSms, defaultNoShowNudgeBody } from "../no-show-nudge-copy";
import { AUTOMATION_TICK_CAP, AUTOMATION_DAILY_CAP, DAILY_CAP_WINDOW_MS } from "../caps";
import { sendAutomationSms, markAutomationSmsSent, smsCooldownActive, type SentSms } from "../send-sms";
import type { Pass, PassContext } from "../context";

type Target =
  | { channel: "sms"; to: string; from: string }
  | { channel: "email"; to: string };

/**
 * No-show → rebooking nudge, the morning after. Trigger is a human: the
 * operator's "Mark no-show". Per row, in this order, each refusal counted
 * under its own name:
 *   invalid config → unresolvable zone → not this morning (the gate, run
 *   from laterOf(ends_at, no_show_at)) → booking page switched off → no
 *   deliverable address → SMS gate refused (NO fallback to email) → SMS
 *   cooldown → caps → send → STAMP → (sms) mark the message row sent.
 *
 * The link is the account's own booking page — `${ctx.origin}/b/<public
 * id>`, the same origin every customer link carries — never configured.
 * `skippedCalendarOff` sits AFTER the gate on purpose: a row that was never
 * going to send this tick is not logged 96 times a day.
 */
export const noShowNudgePass: Pass = {
  key: "noShowNudges",
  async run(ctx) {
    const c = {
      sent: 0, failed: 0, unstamped: 0,
      skippedInvalidConfig: 0, skippedNoAddress: 0, skippedSmsGate: 0, skippedRecentFailure: 0,
      skippedCap: 0, skippedCalendarOff: 0,
      waitingForMorning: 0, unresolvableTimezone: 0,
    };
    const due = await listDueNoShowNudges(ctx.db, ctx.now.toISOString());

    const smsGates = new Map<string, SmsGate>();
    const sentToday = new Map<string, number>();
    let attemptsThisTick = 0;

    for (const row of due) {
      const config = row.config;
      if (config === null) {
        c.skippedInvalidConfig++;
        console.error(
          `no-show nudge skipped for booking ${row.bookingId}: account ${row.accountId}'s `
          + `no_show_nudge config is missing or invalid — pick a channel in Automations`,
        );
        continue;
      }

      if (resolveAccountZone(row.accountTimezone) === null) {
        c.unresolvableTimezone++;
        console.error(
          `no-show nudge HELD for booking ${row.bookingId}: account ${row.accountId}'s timezone `
          + `${JSON.stringify(row.accountTimezone)} is not a zone we can resolve — fix the account's timezone`,
        );
        continue;
      }

      // THE CLOCK (0026): the later of the meeting end and "Mark no-show".
      const anchor = laterOf(new Date(row.endsAt), row.noShowAt ? new Date(row.noShowAt) : null);
      if (!shouldSendNoShowNudgeNow(ctx.now, anchor, row.accountTimezone)) {
        c.waitingForMorning++;
        continue;
      }

      if (!row.calendarEnabled) {
        c.skippedCalendarOff++;
        console.error(
          `no-show nudge skipped for booking ${row.bookingId}: account ${row.accountId}'s booking page `
          + `is switched off, so the rebook link would 404 — turn the calendar on`,
        );
        continue;
      }

      let target: Target;
      if (config.channel === "sms") {
        const to = toE164(row.contactPhone);
        if (!to) {
          c.skippedNoAddress++;
          console.error(`no-show nudge skipped, no textable phone on file for booking ${row.bookingId}`);
          continue;
        }
        let gate = smsGates.get(row.accountId);
        if (!gate) {
          try {
            gate = await resolveSmsSender(ctx.db, row.accountId);
          } catch (e) {
            c.failed++;
            console.error(`no-show nudge: sms gate read failed for account ${row.accountId}: ${String(e)}`);
            continue;
          }
          smsGates.set(row.accountId, gate);
        }
        if (!gate.ok) {
          c.skippedSmsGate++;
          console.error(
            `no-show nudge skipped for booking ${row.bookingId}: account ${row.accountId} cannot text `
            + `(${gate.reason}) — not falling back to email`,
          );
          continue;
        }
        if (smsCooldownActive(row.smsFailedAt, ctx.now)) {
          c.skippedRecentFailure++;
          continue;
        }
        target = { channel: "sms", to, from: gate.from };
      } else {
        if (!row.contactEmail) {
          c.skippedNoAddress++;
          console.error(`no-show nudge skipped, no contact email on file for booking ${row.bookingId}`);
          continue;
        }
        target = { channel: "email", to: row.contactEmail };
      }

      // CAPS (caps.ts): a bulk "Mark no-show" is exactly the burst these guard.
      if (attemptsThisTick >= AUTOMATION_TICK_CAP) {
        c.skippedCap++;
        continue;
      }
      let today = sentToday.get(row.accountId);
      if (today === undefined) {
        today = await countNoShowNudgesSince(
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

      const body = row.body.trim() || defaultNoShowNudgeBody(row.brandName);
      const bookingUrl = `${ctx.origin}/b/${row.calendarPublicId}`;

      let smsRow: SentSms | null = null;
      try {
        if (target.channel === "sms") {
          smsRow = await sendAutomationSms(ctx, {
            accountId: row.accountId, contactId: row.contactId, to: target.to, from: target.from,
            body: composeNoShowNudgeSms(body, bookingUrl),
            onProviderFailure: () => stampNoShowNudgeSmsFailed(ctx.db, row.bookingId),
          });
        } else {
          await sendEmail(ctx, row, target.to, body, bookingUrl);
        }
      } catch (e) {
        c.failed++;
        console.error(`no-show nudge send failed for booking ${row.bookingId}: ${String(e)}`);
        continue;
      }

      // SEND-THEN-STAMP, stamp before the SMS row's status update.
      const stamp = await stampWithRetry(() => stampNoShowNudged(ctx.db, row.bookingId));
      if (!stamp.stamped) {
        c.unstamped++;
        console.error(
          `no-show nudge sent but NOT stamped for booking ${row.bookingId} after `
          + `${stamp.attempts} attempts — expect up to 11 more copies before the morning band `
          + `closes: ${String(stamp.lastError)}`,
        );
      }
      c.sent++;

      if (smsRow) await markAutomationSmsSent(ctx, row.accountId, smsRow, "no-show nudge");
    }

    return c;
  },
};

async function sendEmail(
  ctx: PassContext, row: DueNoShowNudge, to: string, body: string, bookingUrl: string,
): Promise<void> {
  const brand = emailBrandNamed(row.branding, row.brandName);
  const { subject, html, text } = noShowNudgeEmail({ brand, body, bookingUrl });
  await ctx.email.send({
    to,
    fromName: brand.name,
    fromAddress: row.fromEmail ?? undefined,
    replyTo: normalizeReplyTo(row.replyToEmail),   // the row's OWN top-level replyToEmail
    subject,
    body: text,
    html,
  });
}
