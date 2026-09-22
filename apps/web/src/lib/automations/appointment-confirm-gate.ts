import { APPOINTMENT_CONFIRM_MIN_LEAD_MS } from "@bis/db";

/**
 * WHEN a confirmation ask stops being worth making — the pure half of the
 * appointment-confirm pass. There is no morning band here and no staleness
 * cap: the due WINDOW (47h–48h15m, listDueAppointmentConfirms) already says
 * when the ask becomes due, and quiet hours says when it may go. All that is
 * left is the far end.
 *
 * `appointmentConfirmDeadline` is handed to `holdOrSend` as the subject's
 * `deadline`, which sends rather than holds past usefulness. It is reachable
 * only under a quiet window nearly 23 hours long — the ask is due two days
 * out and the deadline is 24h15m out, so the two rarely meet — and it is
 * declared anyway because the RULE is "never hold something past the point it
 * helps", not "this fires often".
 *
 * `tooCloseToAsk` is what actually bites, in `releaseAppointmentConfirm`: a
 * row held through a long window and released inside the email reminder's own
 * eligibility is skipped with a reason, never texted. The lead is 24h15m and
 * not a flat 24h because the email reminder becomes eligible at 24h15m out
 * (REMINDER_WINDOW_END_MS, booking.ts:384) — the collision this prevents is
 * one text and one email in the same quarter hour, not two texts.
 */
export function appointmentConfirmDeadline(startsAt: Date): Date {
  return new Date(startsAt.getTime() - APPOINTMENT_CONFIRM_MIN_LEAD_MS);
}

/** FAIL CLOSED on an instant that cannot be read: this runs inside a cron
 *  tick with no one watching, and the safe direction is not to text. */
export function tooCloseToAsk(now: Date, startsAt: Date): boolean {
  const lead = startsAt.getTime() - now.getTime();
  if (!Number.isFinite(lead)) return true;
  return lead <= APPOINTMENT_CONFIRM_MIN_LEAD_MS;
}
