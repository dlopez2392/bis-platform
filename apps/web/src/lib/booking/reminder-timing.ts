import { SMS_REMINDER_WINDOW_END_MS } from "@bis/db";

/**
 * The latest instant an EMAIL reminder is still worth sending — the
 * `deadline` the reminders pass gives `holdOrSend` and the email gate. Past
 * it, a reminder held by the sending hours (08:00-21:00, lib/consent/hours.ts)
 * is dropped rather than released (choice 21).
 *
 * The day-before reminder: the appointment itself, as it always was.
 *
 * The LATE reminder (D-029; `DueReminder.late`, a booking made less than the
 * day-before window's span ahead): the appointment minus
 * `SMS_REMINDER_WINDOW_END_MS` (2h15m), the earliest the text reminder can
 * go. Without that, both could be held overnight and released together at
 * 08:00 — a 09:00 appointment booked at 19:00 the evening before got its
 * email at 05:45 held to 08:00, and its text (due 06:45-07:30) held to 08:00
 * too. With it, a held late email is dropped whenever 08:00 is at or past
 * that deadline.
 *
 * ACCEPTED, and the price of that rule: a late-booked appointment at or
 * before about 10:15 whose late window (3h-4h15m ahead) falls before 08:00 —
 * in practice an early-morning appointment booked the evening before — gets
 * NO separate reminder email. The confirmation it received at booking time is
 * its reminder, plus the text reminder where texting is on. Proved across a
 * whole day of appointments and booking times in
 * lib/automations/cron-coupling.test.ts, which also proves the email and the
 * text never land in the same quarter hour.
 */
export function reminderDeadline(reminder: { startsAt: string; late: boolean }): Date {
  const startsAt = new Date(reminder.startsAt);
  return reminder.late ? new Date(startsAt.getTime() - SMS_REMINDER_WINDOW_END_MS) : startsAt;
}
