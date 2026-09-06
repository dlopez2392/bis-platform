import { timingSafeEqual } from "node:crypto";
import {
  serviceDb, listDueReminders, stampReminderSent, listDueFollowups, stampFollowupSent,
} from "@bis/db";
import { getEmailProvider } from "@/lib/email";
import { configuredOrigin } from "@/lib/email/origin";
import { normalizeReplyTo } from "@/lib/email/reply-to";
import { emailBrand } from "@/lib/email/templates/shell";
import { bookingReminderEmail } from "@/lib/email/templates/booking";
import { bookingFollowupEmail } from "@/lib/email/templates/followup";
import { safeZone, formatWhen } from "@/lib/booking/time";
import { shouldSendFollowupNow, resolveAccountZone } from "@/lib/booking/followup-timing";
import { stampWithRetry } from "@/lib/booking/stamp-retry";

export const dynamic = "force-dynamic";

/**
 * The platform's first scheduled job: Vercel hits this every 15 minutes
 * (`vercel.json`'s `crons` entry — the every-15-minutes schedule; the literal
 * cron string is deliberately NOT quoted anywhere in a block comment in this
 * repo, because its leading `*` + `/` closes the comment) to mail bookers a reminder
 * roughly a day before their booking. The account was on the Hobby plan
 * until 2026-09-05, and Hobby REJECTS any deployment carrying a sub-daily
 * schedule, so this ran `0 14 * * *` with both query windows widened to 25h
 * to compensate. The Pro upgrade let all three move back together.
 *
 * The three are COUPLED — never change one alone:
 *  - this schedule,
 *  - `listDueReminders`' forward window (`[now+23h, now+24h15m]`), which is
 *    sized to this cadence; widen the cadence without widening that and
 *    reminders are missed, restore the cadence without narrowing it and
 *    every booker gets their reminder up to a day early,
 *  - `listDueFollowups`' backward window (37h) plus `shouldSendFollowupNow`
 *    in the follow-up pass below. On the daily cron, "next morning" was an
 *    ACCIDENT of the 14:00 UTC tick hour landing in the Rio Grande Valley's
 *    early morning. At 96 ticks a day that property is gone, so the gate now
 *    enforces it explicitly, in each account's own timezone.
 *
 * Cost when nothing is due: two `bookings` selects, both narrow and both
 * index-shaped (status + a null-check on the stamp column + a range on
 * `starts_at`/`ends_at`). Each returns [] and short-circuits BEFORE the
 * per-account `accounts` lookups, no loop body runs, and
 * `getEmailProvider()` only reads env vars — it opens no connection. An
 * idle tick is two queries and nothing else, 96 times a day.
 *
 * AUTH is two separate failure modes, not one:
 *  - `CRON_SECRET` unset → 503, zero queries. An unguarded cron route must
 *    refuse to exist rather than run open while danlo is mid-setup — this is
 *    the designed failure until he adds the env var in Vercel.
 *  - a request whose `authorization` header doesn't match → 401, zero
 *    queries. Vercel attaches `Bearer ${CRON_SECRET}` automatically once the
 *    env var exists; anything else is not a cron invocation.
 */
export async function GET(req: Request): Promise<Response> {
  const secret = process.env.CRON_SECRET;
  if (!secret) return new Response(null, { status: 503 });

  // Constant-time compare, mirroring guards.ts's verifyRenderToken: a
  // straight `!==` leaks how many leading bytes matched via response timing,
  // and this header is a bearer credential, not a public token. Length is
  // checked first — timingSafeEqual throws on mismatched buffer lengths
  // rather than returning false, and comparing a wrong-length header would
  // otherwise be an unhandled crash instead of a clean 401.
  const got = Buffer.from(req.headers.get("authorization") ?? "");
  const want = Buffer.from(`Bearer ${secret}`);
  if (got.length !== want.length || !timingSafeEqual(got, want)) {
    return new Response(null, { status: 401 });
  }

  // No headers()/originFrom here — this is a cron invocation, not a browser
  // request forwarded through Vercel's edge, so there is no forwarded-host
  // chain to trust or distrust. APP_ORIGIN wins when set (the custom domain,
  // matching what a real visitor's Host header carries); req.url's origin is
  // only the FALLBACK — and that fallback IS the deployment's own vercel.app
  // URL, the exact link/sender mismatch Gmail silently discarded mail over
  // (closed 2026-08-27; see origin.ts's doc comment).
  const origin = configuredOrigin() ?? new URL(req.url).origin;

  const db = serviceDb();
  const reminders = await listDueReminders(db, new Date().toISOString());
  const provider = getEmailProvider();

  let sent = 0;
  let failed = 0;
  let unstamped = 0;

  for (const reminder of reminders) {
    // SEND-THEN-STAMP, never the reverse: `reminder_sent_at` is a dedupe
    // marker, not a record of an attempt. Stamping before a send that then
    // fails would silence that reminder forever — the next cron tick could
    // never pick it back up. A send failure here is counted in `failed` and
    // logged, and the row stays unstamped so `listDueReminders` returns it
    // again next tick.
    try {
      if (!reminder.contactEmail) {
        throw new Error("no contact email on file");
      }

      const brand = emailBrand(reminder.branding, reminder.accountName);
      const bookerZone = safeZone(reminder.bookerTimezone ?? undefined, reminder.accountTimezone);
      const whenBookerZone = formatWhen(new Date(reminder.startsAt), bookerZone);
      const cancelUrl = `${origin}/b/${reminder.calendarPublicId}/cancel/${reminder.cancelToken}`;

      const { html, text } = bookingReminderEmail({
        brand, whenBookerZone, cancelUrl, meetingUrl: reminder.meetingUrl ?? undefined,
      });

      // fromAddress carries the account's sending address: a reminder is
      // customer-facing outbound, same shape as the booking confirmation
      // (`submitBookingAction` in `b/[publicId]/actions.ts`) — not the
      // staff-facing lead alert, which deliberately omits it.
      await provider.send({
        to: reminder.contactEmail,
        fromName: brand.name,
        fromAddress: reminder.fromEmail ?? undefined,
        replyTo: normalizeReplyTo(reminder.branding.replyToEmail),
        subject: "Reminder: your upcoming booking",
        body: text,
        html,
      });

      // A send that already left the building counts as `sent` no matter
      // what happens next — folding the stamp into the outer catch would
      // misreport a stamp failure as a send failure in triage. Handling the
      // stamp separately here means a stamp failure can't silently look
      // identical to a send failure, and can't roll back the `sent` count.
      //
      // WHY THE STAMP IS RETRIED, and why the old "a duplicate" reasoning no
      // longer describes the cost. This comment used to accept exactly one
      // repeat email, and on the once-a-day cron that was true: the row came
      // back on the next tick, tomorrow, and got mailed a second time. At 96
      // ticks a day it is not one repeat. `listDueReminders`' window is 75
      // minutes wide, so an unstamped row is returned by 5-6 CONSECUTIVE
      // ticks and this booker gets 5-6 identical reminders fifteen minutes
      // apart. `stampWithRetry` spends a bounded ~0.9s of backoff on what is
      // a transient write failure (the send that just succeeded proves the
      // connection carries), which removes this in practice.
      //
      // It does NOT close it, and this is not claiming otherwise. If every
      // attempt fails — a sustained outage, or a write the database will keep
      // refusing — the row is still left unstamped and the 5-6 repeats above
      // are the real exposure. That remains the deliberate direction (a
      // repeat email is recoverable; a reminder that never fires again is
      // not — see `stampReminderSent`'s doc comment), and the `unstamped`
      // count plus this log line are the only signal that it happened.
      // Nothing suppresses the repeat and there is no dead-letter.
      const stamp = await stampWithRetry(() => stampReminderSent(db, reminder.bookingId));
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

  // Second pass, same cron tick, same auth gate: follow-ups sent the morning
  // after a booking's meeting ENDS. Kept as its own loop with its own
  // counters rather than folded into the reminder loop above — the two
  // passes read different due-lists, stamp different columns, and (per the
  // brief) count a missing contact email differently: a reminder with no
  // email is a `failed` send, but a follow-up with no email is
  // `skippedNoEmail` and never even attempts a send, since a contact who
  // never gave an email will retry harmlessly until the window ages it out
  // on its own.
  //
  // `listDueFollowups` is only a CANDIDATE list here — it returns anything
  // that ended in the last 37h, which is wide on purpose (see its doc
  // comment) so the gate below can always fire. The route, not the query,
  // decides the moment.
  const tickAt = new Date();
  const followups = await listDueFollowups(db, tickAt.toISOString());

  let followupsSent = 0;
  let followupsFailed = 0;
  let followupsUnstamped = 0;
  let skippedNoEmail = 0;
  let waitingForMorning = 0;
  let unresolvableTimezone = 0;

  for (const followup of followups) {
    // RULE 0, AND IT RUNS BEFORE THE GATE ITSELF: an account whose
    // `accounts.timezone` we cannot resolve gets NO follow-up at all.
    //
    // `accounts.timezone` is free text at creation (a recorded, still-open
    // issue — not fixed here). The gate never hands it to Intl raw, because a
    // RangeError would abort this whole tick including the reminder pass that
    // has already mailed people above. What it must ALSO not do is guess:
    // the old `safeZone(tz, "UTC")` substitution turned an unreadable zone
    // into a send inside the 08:00-11:00 UTC band, which is 03:00-06:00 in
    // the Rio Grande Valley. A silent 3 a.m. email is worse than no email,
    // and the old daily 14:00 UTC tick used to hide this by accident.
    //
    // Counted and logged under its OWN name rather than folded into
    // `waitingForMorning`, which is the pass's normal, expected, dominant
    // outcome. "Not this tick" and "we cannot tell you when" need to look
    // different in triage, or the misconfiguration stays invisible — this is
    // the whole failure mode. The log repeats while the booking is a
    // candidate (up to 37h), which is loud, but this state is rare, always a
    // misconfiguration, and always operator-fixable.
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

    // THE SEND-TIME GATE. Runs before the no-email check, so a contact with
    // no email is not logged 96 times a day for something that was never
    // going to send this tick anyway. It re-resolves the zone itself rather
    // than taking `accountZone` as an argument: the gate owns its own
    // preconditions and must stay safe to call from anywhere, and both sides
    // go through the same `resolveAccountZone`, so they cannot disagree.
    //
    // This is the dominant branch by a wide margin: a booking sits in the
    // candidate list for up to 37h and only ~12 of those ticks are inside
    // its morning band, so most ticks count `waitingForMorning` and do
    // nothing. It is reported so that "follow-ups aren't going out" can be
    // told apart from "nothing was due" without adding logging noise.
    if (!shouldSendFollowupNow(tickAt, new Date(followup.endsAt), followup.accountTimezone)) {
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

    // SEND-THEN-STAMP, same discipline as the reminder pass above:
    // `followup_sent_at` is a dedupe marker, not a record of an attempt.
    try {
      const brand = emailBrand(followup.branding, followup.accountName);
      const { subject, html, text } = bookingFollowupEmail({
        brand, body: followup.followupBody,
      });

      // fromAddress/replyTo follow the DueReminder precedent above, but
      // replyTo reads DueFollowup's OWN top-level `replyToEmail`, not
      // `followup.branding.replyToEmail` — that's the whole reason
      // `listDueFollowups` duplicates it there (see its doc comment).
      await provider.send({
        to: followup.contactEmail,
        fromName: brand.name,
        fromAddress: followup.fromEmail ?? undefined,
        replyTo: normalizeReplyTo(followup.replyToEmail),
        subject,
        body: text,
        html,
      });

      // Handled separately, same reasoning as the reminder pass: a send that
      // already left the building counts as `sent` regardless of whether
      // the stamp write lands, so a stamp failure can't misreport as a
      // send failure — and can't roll back the `sent` count either.
      //
      // Retried for the same reason too, and this is the WORSE of the two
      // paths by more than double. A follow-up's qualifying moment is the
      // three-hour morning band in `followup-timing.ts`, not a 75-minute
      // window, so an unstamped row is returned and re-sent by roughly TWELVE
      // consecutive ticks — twelve identical "great seeing you" emails,
      // fifteen minutes apart, on the morning after someone's appointment.
      // Its own budget, deliberately not shared with the reminder pass above:
      // the two loops fail independently and one exhausting its retries must
      // not spend the other's.
      //
      // Same residual exposure, stated the same way: when every attempt fails
      // the row stays unstamped and those ~12 repeats are live. The
      // `followups.unstamped` count and this log line are the only signal.
      const stamp = await stampWithRetry(() => stampFollowupSent(db, followup.bookingId));
      if (!stamp.stamped) {
        followupsUnstamped++;
        console.error(
          `follow-up sent but NOT stamped for booking ${followup.bookingId} after `
          + `${stamp.attempts} attempts — expect up to 11 more copies before the `
          + `morning band closes: ${String(stamp.lastError)}`,
        );
      }

      followupsSent++;
    } catch (e) {
      followupsFailed++;
      console.error(`follow-up send failed for booking ${followup.bookingId}: ${String(e)}`);
    }
  }

  return Response.json({
    sent, failed, unstamped,
    followups: {
      sent: followupsSent, failed: followupsFailed,
      unstamped: followupsUnstamped, skippedNoEmail, waitingForMorning,
      unresolvableTimezone,
    },
  });
}
