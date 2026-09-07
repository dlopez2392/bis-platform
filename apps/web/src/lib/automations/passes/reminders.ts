import { listDueReminders, stampReminderSent } from "@bis/db";
import { normalizeReplyTo } from "@/lib/email/reply-to";
import { emailBrand } from "@/lib/email/templates/shell";
import { bookingReminderEmail } from "@/lib/email/templates/booking";
import { safeZone, formatWhen } from "@/lib/booking/time";
import { stampWithRetry } from "@/lib/booking/stamp-retry";
import type { Pass } from "../context";

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
 */
export const remindersPass: Pass = {
  key: "reminders",
  async run(ctx) {
    const reminders = await listDueReminders(ctx.db, ctx.now.toISOString());

    let sent = 0;
    let failed = 0;
    let unstamped = 0;

    for (const reminder of reminders) {
      // SEND-THEN-STAMP, never the reverse: `reminder_sent_at` is a dedupe
      // marker, not a record of an attempt. A send failure is counted in
      // `failed` and logged, and the row stays unstamped so
      // `listDueReminders` returns it again next tick.
      try {
        if (!reminder.contactEmail) {
          throw new Error("no contact email on file");
        }

        const brand = emailBrand(reminder.branding);
        const bookerZone = safeZone(reminder.bookerTimezone ?? undefined, reminder.accountTimezone);
        const whenBookerZone = formatWhen(new Date(reminder.startsAt), bookerZone);
        const cancelUrl = `${ctx.origin}/b/${reminder.calendarPublicId}/cancel/${reminder.cancelToken}`;

        const { html, text } = bookingReminderEmail({
          brand, whenBookerZone, cancelUrl, meetingUrl: reminder.meetingUrl ?? undefined,
        });

        // fromAddress carries the account's sending address: a reminder is
        // customer-facing outbound, same shape as the booking confirmation.
        await ctx.email.send({
          to: reminder.contactEmail,
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
          unstamped++;
          console.error(
            `reminder sent but NOT stamped for booking ${reminder.bookingId} after `
            + `${stamp.attempts} attempts — expect up to 5 more copies over the next 75 `
            + `minutes: ${String(stamp.lastError)}`,
          );
        }

        sent++;
      } catch (e) {
        failed++;
        console.error(`reminder send failed for booking ${reminder.bookingId}: ${String(e)}`);
      }
    }

    return { sent, failed, unstamped };
  },
};
