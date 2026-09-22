import {
  listDueAppointmentConfirms, getDueAppointmentConfirmById,
  stampAppointmentConfirmAsked, stampAppointmentConfirmSmsFailed,
  type DueAppointmentConfirm,
} from "@bis/db";
import { resolveSmsSender, type SmsGate } from "@/lib/sms/sender";
import { toE164 } from "@/lib/voice/phone-number";
import { safeZone, formatWhen } from "@/lib/booking/time";
import { resolveAccountZone } from "@/lib/booking/followup-timing";
import { stampWithRetry } from "@/lib/booking/stamp-retry";
import { appointmentConfirmDeadline, tooCloseToAsk } from "../appointment-confirm-gate";
import { composeAppointmentConfirm } from "../appointment-confirm-copy";
import { sendAutomationSms, markAutomationSmsSent } from "../send-sms";
import {
  holdOrSend, logSkipped, subjectOf, verdict, REASONS, type HoldSubject, type Releaser,
} from "../hold-or-send";
import type { Pass, PassContext } from "../context";

/**
 * The confirmation ask, two days before the appointment — part B's first
 * recipe and the one that fires on every booking a client already takes.
 *
 * NO MORNING GATE: the window IS the moment (listDueAppointmentConfirms,
 * 47h–48h15m), and quiet hours already holds a 6 AM send until 08:00. Per row:
 *   no textable phone → SMS gate refused (skip and count; there IS no other
 *   channel — "Reply YES" in an email points at a no-reply address) →
 *   holdOrSend(send → STAMP → mark the message row sent).
 *
 * UNCAPPED, the first recipe that is (spec decision 2). The cap is a burst
 * guard against a bug or a bulk status change (caps.ts); this pass is keyed on
 * `starts_at` inside a 75-minute window, so no status change and no import can
 * burst it — and a fully-booked Saturday would otherwise leave five customers
 * unasked. Consistency that drops a real customer's text is not a rule worth
 * keeping.
 *
 * NO 24h COOLDOWN either, for the text reminder's recorded reason
 * (SMS_RETRY_COOLDOWN_MS in caps.ts): the window is 75 minutes — five ticks —
 * so a hold that outlived it would mean ONE attempt ever. The failed attempt
 * marker is still written, so the operator can see it; this pass never reads
 * it back.
 *
 * THE DEADLINE. The subject carries `starts_at − 24h15m`: at or before the
 * quiet window's end, holdOrSend sends now rather than holding past
 * usefulness. 24h15m and not a flat 24h because that is the instant the
 * EMAIL reminder becomes eligible (REMINDER_WINDOW_END_MS, booking.ts:384)
 * — the collision is one text and one email, not two texts; the SMS
 * reminder's own window is 90–135 minutes and never meets this. The deadline
 * is reachable only under a quiet window of nearly 23 hours (the ask is due
 * two days out), and it is declared because the rule is "never hold
 * something past the point it helps". What actually bites is
 * `releaseAppointmentConfirm`'s own `tooCloseToAsk` re-check.
 *
 * The time is rendered in the BOOKER's zone (safeZone, the email reminder's
 * rule), so a Los Angeles booker of a Texas company reads their own clock.
 */
export const appointmentConfirmPass: Pass = {
  key: "appointmentConfirms",
  async run(ctx) {
    return processAppointmentConfirms(ctx, await listDueAppointmentConfirms(ctx.db, ctx.now.toISOString()));
  },
};

export type AppointmentConfirmCounters = {
  sent: number; failed: number; unstamped: number; held: number;
  skippedNoAddress: number; skippedSmsGate: number; unresolvableTimezone: number;
};

/** No `ProcessOptions`: this recipe has no morning band, so a release has
 *  nothing to skip. `releaseSmsReminder` is the precedent. */
function subjectFor(r: DueAppointmentConfirm): HoldSubject {
  return {
    accountId: r.accountId, accountTimezone: r.accountTimezone,
    source: "appointment_confirm", channel: "sms",
    subjectKey: `booking:${r.bookingId}`, contactId: r.contactId,
    deadline: appointmentConfirmDeadline(new Date(r.startsAt)),
  };
}

export async function processAppointmentConfirms(
  ctx: PassContext, due: DueAppointmentConfirm[],
): Promise<AppointmentConfirmCounters> {
  const c: AppointmentConfirmCounters = {
    sent: 0, failed: 0, unstamped: 0, held: 0,
    skippedNoAddress: 0, skippedSmsGate: 0, unresolvableTimezone: 0,
  };
  const smsGates = new Map<string, SmsGate>();

  for (const row of due) {
    const subject = subjectFor(row);

    // THE UNRESOLVABLE-ZONE GUARD its three siblings open with
    // (`referral-ask.ts`, `reactivation.ts`, `quote-followup.ts`), and the
    // one this pass shipped without (audit B's M1). `safeZone` does not
    // validate its FALLBACK (`lib/booking/time.ts:20-30`), so junk in both
    // the booker's zone and the account's came back as junk, `formatWhen`
    // threw inside the per-row try, and the row was counted `failed` with NO
    // log row at all — nothing on the Activity page saying why the texts
    // stopped, and a RELEASED row left untouched, keeping its past
    // `held_until` and parking the head of the release queue for ever.
    //
    // The ACCOUNT's zone, not the composed one, and a valid BOOKER zone does
    // not rescue it: `holdOrSend` needs the account's zone to know whether
    // this account is in its quiet window at all, and sends with no window
    // when it cannot resolve one. An account whose zone is junk has a
    // configuration problem an operator can fix, and this is the row that
    // tells them so.
    if (resolveAccountZone(row.accountTimezone) === null) {
      c.unresolvableTimezone++;
      console.error(
        `appointment confirm skipped for booking ${row.bookingId}: account ${row.accountId}'s timezone `
        + `${JSON.stringify(row.accountTimezone)} is not a zone we can resolve`,
      );
      await logSkipped(ctx, subject, REASONS.timezone);
      continue;
    }

    const to = toE164(row.contactPhone);
    if (!to) {
      c.skippedNoAddress++;
      await logSkipped(ctx, subject, REASONS.noPhone);
      console.error(`appointment confirm skipped, no textable phone on file for booking ${row.bookingId}`);
      continue;
    }
    let gate = smsGates.get(row.accountId);
    if (!gate) {
      try {
        gate = await resolveSmsSender(ctx.db, row.accountId);
      } catch (e) {
        // A gate READ failure is this row's failure, not the pass's: letting
        // it escape would discard the counters for every row already sent.
        c.failed++;
        console.error(`appointment confirm: sms gate read failed for account ${row.accountId}: ${String(e)}`);
        continue;
      }
      smsGates.set(row.accountId, gate);
    }
    if (!gate.ok) {
      c.skippedSmsGate++;
      await logSkipped(ctx, subject, REASONS.smsGate);
      console.error(
        `appointment confirm skipped for booking ${row.bookingId}: account ${row.accountId} cannot text (${gate.reason})`,
      );
      continue;
    }
    const from = gate.from;

    try {
      // Still inside the per-row try, though the guard above now takes the
      // only input that could make `formatWhen` throw: an unresolvable
      // ACCOUNT zone. What is left is the composition itself — the BOOKER's
      // zone when the booking carries one (amendment B13), the account's
      // otherwise, and never UTC.
      const zone = safeZone(row.bookerTimezone ?? undefined, row.accountTimezone);
      const body = composeAppointmentConfirm(
        row.brandName, formatWhen(new Date(row.startsAt), zone), row.body);
      const outcome = await holdOrSend(ctx, subject, async () => {
        const smsRow = await sendAutomationSms(ctx, {
          accountId: row.accountId, contactId: row.contactId, to, from, body,
          onProviderFailure: () => stampAppointmentConfirmSmsFailed(ctx.db, row.bookingId),
        });
        // SEND-THEN-STAMP; the stamp before the row's status, as everywhere.
        const stamp = await stampWithRetry(() => stampAppointmentConfirmAsked(ctx.db, row.bookingId));
        if (!stamp.stamped) {
          c.unstamped++;
          console.error(
            `appointment confirm sent but NOT stamped for booking ${row.bookingId} after `
            + `${stamp.attempts} attempts — expect up to 4 more copies before the window closes: ${String(stamp.lastError)}`,
          );
        }
        await markAutomationSmsSent(ctx, row.accountId, smsRow, "appointment confirm");
      });
      if (outcome === "held") {
        c.held++;
        continue;
      }
      c.sent++;
    } catch (e) {
      c.failed++;
      console.error(`appointment confirm send failed for booking ${row.bookingId}: ${String(e)}`);
    }
  }

  return c;
}

export const releaseAppointmentConfirm: Releaser = async (ctx, row) => {
  const bookingId = row.subject_key.replace(/^booking:/, "");
  const found = await getDueAppointmentConfirmById(ctx.db, bookingId);
  if (!found.due) {
    await logSkipped(ctx, subjectOf(row), found.why === "off" ? REASONS.recipeOff : REASONS.noLongerDue);
    return "skipped";
  }
  // The held row's key is not trusted across tenants: getDueAppointmentConfirmById
  // takes no account argument and runs service-role, so a mismatch never sends
  // and leaves the queue.
  if (found.due.accountId !== row.account_id) {
    await logSkipped(ctx, subjectOf(row), REASONS.noLongerDue);
    return "skipped";
  }
  // Released after a long hold, now inside the email reminder's own lead: the
  // ask has stopped being useful. Written `skipped`, never left untouched — an
  // untouched released row keeps its past `held_until` and parks the head of
  // the queue forever.
  if (tooCloseToAsk(ctx.now, new Date(found.due.startsAt))) {
    await logSkipped(ctx, subjectOf(row), REASONS.tooCloseToAppointment);
    return "skipped";
  }
  return verdict(await processAppointmentConfirms(ctx, [found.due]));
};
