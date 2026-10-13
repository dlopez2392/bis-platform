import { SMS_REMINDER_WINDOW_END_MS } from "@bis/db";

/** S-09 PR 2 (C16, Q3): the least notice a morning-of reminder email is still worth sending with. A
 *  09:00 appointment gets 45-60 minutes (the release tick lands 08:00-08:15); 08:45 would get less use
 *  than the confirmation already gave, so it gets none. */
export const MORNING_OF_MIN_NOTICE_MS = 45 * 60 * 1000;

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
 * S-09 PR 2 (C16, Q3): that deadline applies only when a text reminder WILL go
 * (`textCovers`: the account has the text reminder on and can text, and the
 * contact has a textable phone). With no text coming, a late reminder's
 * deadline is the start minus `MORNING_OF_MIN_NOTICE_MS` (45 minutes): held
 * overnight, it is released at 08:00 for every appointment after 08:45, so an
 * early appointment booked the evening before no longer goes without a
 * reminder where texting is off (every live account until A2P). Appointments
 * at or before 08:45 still get none: the confirmation is their reminder.
 * "Email and text never together" (D-029) stands, because the earlier
 * deadline still applies whenever the text goes. Proved over a whole day of
 * appointments and booking times, both ways, on an ordinary day, both DST
 * days and UTC+14, in lib/automations/cron-coupling.test.ts.
 *
 * ACCEPTED, with a text coming: a late-booked appointment at or before about
 * 10:15 whose late window (3h-4h15m ahead) falls before 08:00 gets NO separate
 * reminder email; the confirmation and the text are its reminders.
 */
export function reminderDeadline(reminder: { startsAt: string; late: boolean }, opts: { textCovers: boolean }): Date {
  const startsAt = new Date(reminder.startsAt).getTime();
  if (!reminder.late) return new Date(startsAt);
  return new Date(startsAt - (opts.textCovers ? SMS_REMINDER_WINDOW_END_MS : MORNING_OF_MIN_NOTICE_MS));
}
