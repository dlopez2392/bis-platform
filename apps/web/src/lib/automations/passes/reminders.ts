import { listDueReminders, stampReminderSent, getDueReminderById, getAutomation, type DueReminder } from "@bis/db";
import { normalisePhone } from "@bis/db/phone";
import { resolveSmsSender } from "@/lib/sms/sender";
import { normalizeReplyTo } from "@/lib/email/reply-to";
import { emailBrand } from "@/lib/email/templates/shell";
import { bookingReminderEmail, bookingReminderSubject } from "@/lib/email/templates/booking";
import { safeZone, formatWhen } from "@/lib/booking/time";
import { stampWithRetry } from "@/lib/booking/stamp-retry";
import { reminderDeadline } from "@/lib/booking/reminder-timing";
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
 * before the sending hours open is NOT sent ("Not sent: quiet hours ran past
 * the appointment", consent chain choice 21). A LATE reminder (D-029, booked
 * less than a day ahead) has an earlier one, and which depends on whether a
 * text reminder will go (S-09 PR 2, C16, Q3): if it will, the start minus
 * 2h15m, so a held late email is dropped rather than released at 08:00 beside
 * the text; if it will not, the start minus 45 minutes, so it is released at
 * 08:00 for every appointment after 08:45. `reminderDeadline`
 * (lib/booking/reminder-timing.ts) is the rule; `textCovers` below decides
 * which, for late rows only, and the release path recomputes it the same way.
 *
 * S-09 PR 2: in the customer's language (the due row's `language`; an
 * emptied Spanish box sends the whole text in English).
 */
export const remindersPass: Pass = {
  key: "reminders",
  async run(ctx) {
    return processReminders(ctx, await listDueReminders(ctx.db, ctx.now.toISOString()));
  },
};

export type ReminderCounters = { sent: number; failed: number; unstamped: number; held: number; blocked: number };

function subjectFor(r: DueReminder, deadline: Date): HoldSubject {
  return {
    accountId: r.accountId, accountTimezone: r.accountTimezone, source: "reminders", channel: "email",
    subjectKey: `booking:${r.bookingId}`, contactId: r.contactId, deadline,
  };
}

/**
 * S-09 PR 2 (C16): does a text reminder cover this LATE row? Read only for late rows, once per account
 * per call (the text pass's own cache shape, sms-reminder.ts). A read failure counts as "no text": the
 * email then goes at 08:00, the safe side of a missed reminder. The tick shares one cache across its
 * rows; a release reads per row (one held row per call), bounded by RELEASE_BATCH (release-held.ts).
 */
function textCoverage(ctx: PassContext): (r: DueReminder) => Promise<boolean> {
  const textOn = new Map<string, boolean>();
  return async (r) => {
    if (!r.late || !normalisePhone(r.contactPhone)) return false;
    if (!textOn.has(r.accountId)) {
      try {
        const recipe = await getAutomation(ctx.db, r.accountId, "sms_reminder");
        textOn.set(r.accountId, recipe?.enabled === true && (await resolveSmsSender(ctx.db, r.accountId)).ok);
      } catch (e) {
        console.error(`reminders: text-reminder read failed for account ${r.accountId}: ${String(e)}`);
        textOn.set(r.accountId, false);
      }
    }
    return textOn.get(r.accountId)!;
  };
}

/** The per-row path, shared by the tick (every due row) and the release (one held row). */
export async function processReminders(ctx: PassContext, reminders: DueReminder[]): Promise<ReminderCounters> {
  const c: ReminderCounters = { sent: 0, failed: 0, unstamped: 0, held: 0, blocked: 0 };

  const textCovers = textCoverage(ctx);

  for (const reminder of reminders) {
    const deadline = reminderDeadline(reminder, { textCovers: await textCovers(reminder) });
    const subject = subjectFor(reminder, deadline);
    // SEND-THEN-STAMP, never the reverse: `reminder_sent_at` is a dedupe
    // marker, not a record of an attempt. A send failure is counted in
    // `failed` and logged, and the row stays unstamped so
    // `listDueReminders` returns it again next tick.
    try {
      const to = reminder.contactEmail;
      if (!to) {
        await logSkipped(ctx, subject, REASONS.noEmail);
        throw new Error("no contact email on file");
      }

      const brand = emailBrand(reminder.branding);
      const bookerZone = safeZone(reminder.bookerTimezone ?? undefined, reminder.accountTimezone);
      // S-09 PR 2: in the customer's language (the due row's `language`; an
      // emptied Spanish box sends the whole text in English). No editable
      // body here, so the row's resolved language IS the message's (C11).
      const locale = reminder.language;
      const whenBookerZone = formatWhen(new Date(reminder.startsAt), bookerZone, locale);
      // ?locale=es as the confirmation's cancel link does (b/[publicId]/actions.ts), so the page matches the email.
      const cancelUrl = `${ctx.origin}/b/${reminder.calendarPublicId}/cancel/${reminder.cancelToken}${locale === "es" ? "?locale=es" : ""}`;

      const { html, text } = bookingReminderEmail({
        brand, whenBookerZone, cancelUrl, meetingUrl: reminder.meetingUrl ?? undefined, locale,
      });

      const outcome = await holdOrSend(ctx, subject, async () => {
        // fromAddress carries the account's sending address: a reminder is
        // customer-facing outbound, same shape as the booking confirmation.
        await ctx.email.send({
          // The email gate (consent PR-3): the ledger, the fixed hours at this
          // tick's instant, choice 21's deadline, and the unsubscribe footer.
          accountId: reminder.accountId, kind: "automation.reminder", contactId: reminder.contactId,
          origin: ctx.origin, now: ctx.now, accountZone: reminder.accountTimezone,
          deadline,
          to,
          fromName: brand.name,
          fromAddress: reminder.fromEmail ?? undefined,
          replyTo: normalizeReplyTo(reminder.branding.replyToEmail),
          subject: bookingReminderSubject(locale),
          body: text,
          html,
          language: locale,
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
      if (outcome === "skipped") {
        c.blocked++;
        continue;
      }
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
  // The held row's key is not trusted across tenants: getDueReminderById
  // takes no account argument and runs service-role, so a mismatch never
  // sends and leaves the queue.
  if (found.due.accountId !== row.account_id) {
    await logSkipped(ctx, subjectOf(row), REASONS.noLongerDue);
    return "skipped";
  }
  if (new Date(found.due.startsAt).getTime() <= ctx.now.getTime()) {
    await logSkipped(ctx, subjectOf(row), REASONS.appointmentStarted);
    return "skipped";
  }
  // Review (Task 13): inside the sending hours neither holdOrSend nor the email gate checks the deadline
  // (the gate only drops a deadline at or before the NEXT opening, and there is none inside the hours), so
  // the release does. Recomputed now, not at hold time: texting turned on overnight moves a late row's
  // deadline to start - 2h15m, and the 08:00 release must not land beside the text; a release delayed past
  // start - 45m would give less notice than MORNING_OF_MIN_NOTICE_MS.
  const deadline = reminderDeadline(found.due, { textCovers: await textCoverage(ctx)(found.due) });
  if (ctx.now.getTime() >= deadline.getTime()) {
    await logSkipped(ctx, subjectOf(row), REASONS.windowAfterDeadline);
    return "skipped";
  }
  return verdict(await processReminders(ctx, [found.due]));
};
