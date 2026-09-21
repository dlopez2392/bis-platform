import { listDueReminders, stampReminderSent, getDueReminderById, type DueReminder } from "@bis/db";
import { normalizeReplyTo } from "@/lib/email/reply-to";
import { emailBrand } from "@/lib/email/templates/shell";
import { bookingReminderEmail } from "@/lib/email/templates/booking";
import { safeZone, formatWhen } from "@/lib/booking/time";
import { stampWithRetry } from "@/lib/booking/stamp-retry";
import {
  holdOrSend, logSkipped, subjectOf, verdict, REASONS, type HoldSubject, type Releaser,
} from "../hold-or-send";
import type { Pass, PassContext } from "../context";

/**
 * Booking reminders, ~a day before `starts_at`. Moved verbatim from
 * api/cron/reminders/route.ts onto the harness (2026-09-06); the route's 30
 * tests run unchanged against this pass through the route.
 *
 * UNCAPPED, by design. The automation caps (caps.ts) guard RECIPE passes
 * against bursts; a reminder is one-to-one with a booking the customer made,
 * and a daily cap on a busy client would drop reminders — the row leaves its
 * 75-minute window before a rolling day clears — turning a burst guard into
 * no-shows. This pass has run uncapped in production and keeps doing so.
 *
 * Counted the way the route always counted: a reminder with no contact email
 * is a `failed` send (contrast the follow-up pass, which counts it
 * `skippedNoEmail`). That difference is the reason the registry is a harness
 * and not a shared listDue/send/stamp algorithm.
 *
 * QUIET HOURS (part C): the send runs inside `holdOrSend`. Inside the
 * account's window the row is HELD — not stamped — and `releaseReminder`
 * brings it back when the window ends, because the 75-minute due window
 * will have closed by then and `listDueReminders` would never see it again.
 * The `deadline` is the appointment itself: a reminder for a job that starts
 * before the window ends goes out now.
 */
export const remindersPass: Pass = {
  key: "reminders",
  async run(ctx) {
    return processReminders(ctx, await listDueReminders(ctx.db, ctx.now.toISOString()));
  },
};

export type ReminderCounters = { sent: number; failed: number; unstamped: number; held: number };

function subjectFor(r: DueReminder): HoldSubject {
  return {
    accountId: r.accountId, accountTimezone: r.accountTimezone, source: "reminders", channel: "email",
    subjectKey: `booking:${r.bookingId}`, contactId: r.contactId, deadline: new Date(r.startsAt),
  };
}

/** The per-row path, shared by the tick (every due row) and the release (one held row). */
export async function processReminders(ctx: PassContext, reminders: DueReminder[]): Promise<ReminderCounters> {
  const c: ReminderCounters = { sent: 0, failed: 0, unstamped: 0, held: 0 };

  for (const reminder of reminders) {
    const subject = subjectFor(reminder);
    // SEND-THEN-STAMP, never the reverse: `reminder_sent_at` is a dedupe
    // marker, not a record of an attempt. A send failure is counted in
    // `failed` and logged, and the row stays unstamped so
    // `listDueReminders` returns it again next tick.
    try {
      if (!reminder.contactEmail) {
        await logSkipped(ctx, subject, REASONS.noEmail);
        throw new Error("no contact email on file");
      }

      const brand = emailBrand(reminder.branding);
      const bookerZone = safeZone(reminder.bookerTimezone ?? undefined, reminder.accountTimezone);
      const whenBookerZone = formatWhen(new Date(reminder.startsAt), bookerZone);
      const cancelUrl = `${ctx.origin}/b/${reminder.calendarPublicId}/cancel/${reminder.cancelToken}`;

      const { html, text } = bookingReminderEmail({
        brand, whenBookerZone, cancelUrl, meetingUrl: reminder.meetingUrl ?? undefined,
      });

      const outcome = await holdOrSend(ctx, subject, async () => {
        // fromAddress carries the account's sending address: a reminder is
        // customer-facing outbound, same shape as the booking confirmation.
        await ctx.email.send({
          to: reminder.contactEmail!,
          fromName: brand.name,
          fromAddress: reminder.fromEmail ?? undefined,
          replyTo: normalizeReplyTo(reminder.branding.replyToEmail),
          subject: "Reminder: your upcoming booking",
          body: text,
          html,
        });

        // A send that already left the building counts as `sent` no matter
        // what happens next. The stamp is retried (stampWithRetry) because at
        // 96 ticks a day an unstamped row is 5-6 identical reminders, and it
        // is still reported when every attempt fails — the retry shrinks the
        // duplicate window, it does not close it.
        const stamp = await stampWithRetry(() => stampReminderSent(ctx.db, reminder.bookingId));
        if (!stamp.stamped) {
          c.unstamped++;
          console.error(
            `reminder sent but NOT stamped for booking ${reminder.bookingId} after `
            + `${stamp.attempts} attempts — expect up to 5 more copies over the next 75 `
            + `minutes: ${String(stamp.lastError)}`,
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
      console.error(`reminder send failed for booking ${reminder.bookingId}: ${String(e)}`);
    }
  }

  return c;
}

/** The release: re-read the booking (the due window is long gone), re-check, send through processReminders. */
export const releaseReminder: Releaser = async (ctx, row) => {
  const bookingId = row.subject_key.replace(/^booking:/, "");
  const found = await getDueReminderById(ctx.db, bookingId);
  if (!found.due) {
    await logSkipped(ctx, subjectOf(row), found.why === "off" ? REASONS.recipeOff : REASONS.noLongerDue);
    return "skipped";
  }
  if (new Date(found.due.startsAt).getTime() <= ctx.now.getTime()) {
    await logSkipped(ctx, subjectOf(row), REASONS.appointmentStarted);
    return "skipped";
  }
  return verdict(await processReminders(ctx, [found.due]));
};
