import {
  listDueSmsReminders, stampSmsReminderSent, stampSmsReminderFailed, getDueSmsReminderById,
  type DueSmsReminder,
} from "@bis/db";
import { resolveSmsSender, type SmsGate } from "@/lib/sms/sender";
import { toE164 } from "@/lib/voice/phone-number";
import { safeZone, formatWhen } from "@/lib/booking/time";
import { stampWithRetry } from "@/lib/booking/stamp-retry";
import { composeSmsReminder, defaultSmsReminderBody } from "../sms-reminder-copy";
import { sendAutomationSms, markAutomationSmsSent } from "../send-sms";
import {
  holdOrSend, logSkipped, subjectOf, verdict, REASONS, type HoldSubject, type Releaser,
} from "../hold-or-send";
import type { Pass, PassContext } from "../context";

/**
 * The text reminder, ~2h before `starts_at` — the second step of the
 * booking reminder sequence (the email goes ~a day before). SMS only, by
 * definition of the recipe; the due-row carries no email address.
 *
 * NO MORNING GATE: the window IS the moment (listDueSmsReminders). Per row:
 *   no textable phone → SMS gate refused (skip and count; there is no other
 *   channel) → holdOrSend(send → STAMP → mark the message row sent).
 *
 * NO 24h HOLD after a failed attempt (danlo, 2026-09-07, from Milestone B's
 * review — see SMS_RETRY_COOLDOWN_MS in caps.ts): the window is 45 minutes,
 * three ticks, so a hold that outlived it meant ONE attempt ever and a
 * single carrier blip cost the customer their reminder. A failed send still
 * writes `sms_reminder_failed_at` (an attempt marker the operator can see)
 * but this pass never reads it back; the window bounds a bad afternoon to
 * three attempts and three failed rows (cron-coupling.test.ts pins the 3).
 * The customer-visible worst case is the flip side: a provider failure that
 * was actually accepted (a timeout after delivery) is retried next tick, so
 * up to three copies of the reminder can land. Inherent to retrying, and
 * the right trade for a reminder.
 *
 * UNCAPPED, by the spec's own reasoning for the email reminder.
 *
 * QUIET HOURS (part C): this is the recipe the reminder EXEMPTION exists
 * for. Due ~2h before the appointment, a text for a 07:30 job is due at
 * 05:30 — inside the default window — and holding it to 08:00 would text
 * someone about a job that already started. So the subject's `deadline` is
 * the appointment: at or before the window's end, it sends now. A job AFTER
 * the window's end (08:30, due 06:30) is held and released at 08:00 — thirty
 * minutes' notice instead of two hours, which is the trade the client made
 * when they set quiet hours. On release, an appointment that has already
 * started is skipped with its reason, never texted.
 *
 * The time is rendered in the BOOKER's zone (safeZone, the email
 * reminder's rule), so a Los Angeles booker of a New York company reads
 * their own clock.
 */
export const smsReminderPass: Pass = {
  key: "smsReminders",
  async run(ctx) {
    return processSmsReminders(ctx, await listDueSmsReminders(ctx.db, ctx.now.toISOString()));
  },
};

export type SmsReminderCounters = {
  sent: number; failed: number; unstamped: number; held: number; skippedNoAddress: number; skippedSmsGate: number;
};

function subjectFor(r: DueSmsReminder): HoldSubject {
  return {
    accountId: r.accountId, accountTimezone: r.accountTimezone, source: "sms_reminder", channel: "sms",
    subjectKey: `booking:${r.bookingId}`, contactId: r.contactId, deadline: new Date(r.startsAt),
  };
}

export async function processSmsReminders(ctx: PassContext, due: DueSmsReminder[]): Promise<SmsReminderCounters> {
  const c: SmsReminderCounters = { sent: 0, failed: 0, unstamped: 0, held: 0, skippedNoAddress: 0, skippedSmsGate: 0 };
  const smsGates = new Map<string, SmsGate>();

  for (const row of due) {
    const subject = subjectFor(row);
    const to = toE164(row.contactPhone);
    if (!to) {
      c.skippedNoAddress++;
      await logSkipped(ctx, subject, REASONS.noPhone);
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
      await logSkipped(ctx, subject, REASONS.smsGate);
      console.error(
        `text reminder skipped for booking ${row.bookingId}: account ${row.accountId} cannot text (${gate.reason})`,
      );
      continue;
    }
    const from = gate.from;

    // Inside the per-row try: a junk ACCOUNT zone makes formatWhen throw,
    // and that is this row's failure, not the pass's.
    try {
      const zone = safeZone(row.bookerTimezone ?? undefined, row.accountTimezone);
      const body = composeSmsReminder(
        row.brandName, formatWhen(new Date(row.startsAt), zone), row.body.trim() || defaultSmsReminderBody());
      const outcome = await holdOrSend(ctx, subject, async () => {
        const smsRow = await sendAutomationSms(ctx, {
          accountId: row.accountId, contactId: row.contactId, to, from, body,
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
        await markAutomationSmsSent(ctx, row.accountId, smsRow, "text reminder");
      });
      if (outcome === "held") {
        c.held++;
        continue;
      }
      c.sent++;
    } catch (e) {
      c.failed++;
      console.error(`text reminder send failed for booking ${row.bookingId}: ${String(e)}`);
    }
  }

  return c;
}

export const releaseSmsReminder: Releaser = async (ctx, row) => {
  const bookingId = row.subject_key.replace(/^booking:/, "");
  const found = await getDueSmsReminderById(ctx.db, bookingId);
  if (!found.due) {
    await logSkipped(ctx, subjectOf(row), found.why === "off" ? REASONS.recipeOff : REASONS.noLongerDue);
    return "skipped";
  }
  if (new Date(found.due.startsAt).getTime() <= ctx.now.getTime()) {
    await logSkipped(ctx, subjectOf(row), REASONS.appointmentStarted);
    return "skipped";
  }
  return verdict(await processSmsReminders(ctx, [found.due]));
};
