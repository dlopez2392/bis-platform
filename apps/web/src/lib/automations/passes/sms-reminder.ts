import {
  listDueSmsReminders, stampSmsReminderSent, stampSmsReminderFailed,
} from "@bis/db";
import { resolveSmsSender, type SmsGate } from "@/lib/sms/sender";
import { toE164 } from "@/lib/voice/phone-number";
import { safeZone, formatWhen } from "@/lib/booking/time";
import { stampWithRetry } from "@/lib/booking/stamp-retry";
import { composeSmsReminder, defaultSmsReminderBody } from "../sms-reminder-copy";
import { sendAutomationSms, markAutomationSmsSent, smsCooldownActive } from "../send-sms";
import type { Pass } from "../context";

/**
 * The text reminder, ~2h before `starts_at` — the second step of the
 * booking reminder sequence (the email goes ~a day before). SMS only, by
 * definition of the recipe; the due-row carries no email address.
 *
 * NO MORNING GATE: the window IS the moment (listDueSmsReminders). Per row:
 *   no textable phone → SMS gate refused (skip and count; there is no other
 *   channel) → SMS cooldown → send → STAMP → mark the message row sent.
 *
 * UNCAPPED, by the spec's own reasoning for the email reminder: a reminder
 * is one-to-one with a booking the customer made, and a cap on a busy
 * client would drop reminders — the row leaves its 45-minute window before
 * a rolling day clears — turning a burst guard into no-shows. No bulk
 * status change can create a burst here.
 *
 * The time is rendered in the BOOKER's zone (safeZone, the email
 * reminder's rule), so a Los Angeles booker of a New York company reads
 * their own clock.
 */
export const smsReminderPass: Pass = {
  key: "smsReminders",
  async run(ctx) {
    const c = { sent: 0, failed: 0, unstamped: 0, skippedNoAddress: 0, skippedSmsGate: 0, skippedRecentFailure: 0 };
    const due = await listDueSmsReminders(ctx.db, ctx.now.toISOString());

    const smsGates = new Map<string, SmsGate>();

    for (const row of due) {
      const to = toE164(row.contactPhone);
      if (!to) {
        c.skippedNoAddress++;
        console.error(`text reminder skipped, no textable phone on file for booking ${row.bookingId}`);
        continue;
      }
      let gate = smsGates.get(row.accountId);
      if (!gate) {
        try {
          gate = await resolveSmsSender(ctx.db, row.accountId);
        } catch (e) {
          c.failed++;
          console.error(`text reminder: sms gate read failed for account ${row.accountId}: ${String(e)}`);
          continue;
        }
        smsGates.set(row.accountId, gate);
      }
      if (!gate.ok) {
        c.skippedSmsGate++;
        console.error(
          `text reminder skipped for booking ${row.bookingId}: account ${row.accountId} cannot text (${gate.reason})`,
        );
        continue;
      }
      if (smsCooldownActive(row.smsFailedAt, ctx.now)) {
        c.skippedRecentFailure++;
        continue;
      }

      // Inside the per-row try: a junk ACCOUNT zone makes formatWhen throw,
      // and that is this row's failure, not the pass's.
      try {
        const zone = safeZone(row.bookerTimezone ?? undefined, row.accountTimezone);
        const body = composeSmsReminder(
          row.brandName, formatWhen(new Date(row.startsAt), zone), row.body.trim() || defaultSmsReminderBody());
        const smsRow = await sendAutomationSms(ctx, {
          accountId: row.accountId, contactId: row.contactId, to, from: gate.from, body,
          onProviderFailure: () => stampSmsReminderFailed(ctx.db, row.bookingId),
        });

        // SEND-THEN-STAMP; the stamp before the row's status, as everywhere.
        const stamp = await stampWithRetry(() => stampSmsReminderSent(ctx.db, row.bookingId));
        if (!stamp.stamped) {
          c.unstamped++;
          console.error(
            `text reminder sent but NOT stamped for booking ${row.bookingId} after `
            + `${stamp.attempts} attempts — expect up to 2 more copies before the window closes: ${String(stamp.lastError)}`,
          );
        }
        c.sent++;
        await markAutomationSmsSent(ctx, row.accountId, smsRow, "text reminder");
      } catch (e) {
        c.failed++;
        console.error(`text reminder send failed for booking ${row.bookingId}: ${String(e)}`);
      }
    }

    return c;
  },
};
