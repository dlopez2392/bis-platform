/**
 * F-048 follow-up: the two markers the cron sweep writes into a Calendar-page
 * cancel notice's `messages.error` when it is too late to tell the customer
 * (`expireCancelNotice`, the calendar's cancel-notice.ts). Shaped like the
 * email gate's own `email not sent: <reason>` messages, and matched EXACTLY by
 * `messageFailureReason` (lib/email/failure-reason.ts), which shows the owner
 * plain words on the thread, never the marker. Kept here, with no imports, so
 * lib/email can read them without importing a page module.
 */
export const CANCEL_NOTICE_EXPIRED = {
  /** The appointment's start had passed (or could not be read) when the sweep reached it. */
  started: "email not sent: too_late_appointment_started",
  /** A day had passed since the cancel. */
  too_old: "email not sent: too_late_day_old",
} as const;

export type ExpiredReason = keyof typeof CANCEL_NOTICE_EXPIRED;
