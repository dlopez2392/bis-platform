import { loadAccountBrandInfo, type SupabaseClient } from "@bis/db";
import type { AiAct } from "@bis/db/ai-act-rules";
import { recipientLanguage } from "@bis/db/spanish-box";
import { calendarFileUrl } from "@/lib/booking/calendar-file";
import { bookingCancelUrl, bookingMoveUrl } from "@/lib/booking/links";
import { formatWhen } from "@/lib/booking/time";
import { sendEmailOrThrow } from "@/lib/consent/email-gate";
import { normalizeReplyTo } from "@/lib/email/reply-to";
import {
  bookingCancelledEmail, bookingCancelledSubject, bookingConfirmationEmail, bookingConfirmationSubject,
  bookingRescheduledEmail, bookingRescheduledSubject,
} from "@/lib/email/templates/booking";
import { emailBrand } from "@/lib/email/templates/shell";

type BookingAct = Extract<AiAct, { kind: "booking_created" | "booking_cancelled" | "booking_rescheduled" }>;

/**
 * The customer's notice when staff undo one of Sofía's booking changes and leave "Let {name} know" ticked
 * (item 8c, D3; plan Task 5 item 5). It says what the booking is NOW, in the usual words: the voice tools'
 * own templates (`registry.ts`), never new copy.
 *   - a booking she made, undone: the cancellation, for the time she had booked;
 *   - a cancel she made, undone: the confirmation, with that booking's own cancel link, calendar file and
 *     video link;
 *   - a move she made, undone: "your booking has been moved", to the restored OLD time, with its own cancel
 *     and move links and NO calendar file (A6, below).
 * One language end to end (DESIGN.md "A customer's language"): their record's, else the account's, else
 * English (`recipientLanguage`, S-09). Email only (owner Q3), as `booking.undo_notice` (owner Q2's
 * `transactional` class). On the SERVICE client the caller hands in, after its own request-client proof.
 * THROWS when it cannot send (no email, an unreadable booking, the gate's refusal): the caller answers
 * "not told", and never marks the act notified.
 *
 * A6 (plan "The model", function 1): a booking's calendar file is served by `/b/<id>/ics/<token>` with
 * UID = the chain's first booking and SEQUENCE = its depth in the chain (`rescheduleChain`,
 * `calendar-file.ts`). The undo DELETED the move's new booking (depth d+1), so the restored old booking's
 * file is served at depth d, LOWER than the file the customer may already hold for the moved time. A
 * calendar app that honours SEQUENCE keeps the moved time and ignores the lower one, and this notice cannot
 * raise the SEQUENCE: the route computes it when the file is opened, not this email. So the restored time is
 * not offered as a calendar file at all (the plan's second option): the email states the time in words and
 * links the cancel and move pages, never a file that would silently fail to update their calendar.
 */
export async function sendBookingUndoNotice(args: {
  db: SupabaseClient; accountId: string; act: BookingAct;
  contact: { email: string | null; language: string | null };
  origin: string | null;
}): Promise<void> {
  const { db, accountId, act, origin } = args;
  const to = args.contact.email?.trim();
  if (!to) throw new Error(`booking undo notice for act ${act.id}: no email on file`);

  const info = (await loadAccountBrandInfo(db, [accountId], "ai-acts notice")).get(accountId);
  if (!info) throw new Error(`booking undo notice for act ${act.id}: account ${accountId} unreadable`);
  const locale = recipientLanguage(args.contact.language, info.accountLanguage);
  const brand = emailBrand(info.branding);
  const when = (iso: string) => formatWhen(new Date(iso), info.accountTimezone, locale);

  let message: { subject: string; html: string; text: string };
  if (act.kind === "booking_created") {
    message = { subject: bookingCancelledSubject(locale), ...bookingCancelledEmail({ brand, locale, whenCompanyZone: when(act.after.startsAt) }) };
  } else {
    const bookingId = act.kind === "booking_cancelled" ? act.target.bookingId : act.target.fromBookingId;
    const b = await bookingLinks(db, accountId, bookingId);
    const whenCompanyZone = when(b.startsAt);
    const cancelUrl = bookingCancelUrl(origin, b.publicId, b.cancelToken, locale);
    const meetingUrl = b.meetingUrl ?? undefined;
    if (act.kind === "booking_cancelled") {
      const calendarUrl = calendarFileUrl(origin, b.publicId, b.cancelToken, locale);
      message = {
        subject: bookingConfirmationSubject(locale),
        ...bookingConfirmationEmail({ brand, locale, whenBookerZone: whenCompanyZone, whenCompanyZone, cancelUrl, meetingUrl, calendarUrl }),
      };
    } else {
      const moveUrl = bookingMoveUrl(origin, b.publicId, b.cancelToken, locale);
      message = {
        subject: bookingRescheduledSubject(locale),
        ...bookingRescheduledEmail({ brand, locale, whenBookerZone: whenCompanyZone, whenCompanyZone, cancelUrl, meetingUrl, moveUrl }),
      };
    }
  }

  await sendEmailOrThrow({
    accountId, kind: "booking.undo_notice", contactId: act.contactId, language: locale, origin,
    to, fromName: brand.name, fromAddress: info.fromEmail ?? undefined, replyTo: normalizeReplyTo(info.replyToEmail),
    subject: message.subject, body: message.text, html: message.html,
  }, { db });
}

/** The restored booking's own token, video link and calendar public id, this account's only. */
async function bookingLinks(db: SupabaseClient, accountId: string, bookingId: string) {
  const { data: b, error } = await db.from("bookings").select("id, calendar_id, cancel_token, meeting_url, starts_at")
    .eq("account_id", accountId).eq("id", bookingId).maybeSingle();
  if (error || !b) throw new Error(`booking undo notice: booking ${bookingId} unreadable: ${error?.message ?? "not found"}`);
  const row = b as { calendar_id: string; cancel_token: string; meeting_url: string | null; starts_at: string };
  const { data: cal, error: calError } = await db.from("calendars").select("public_id")
    .eq("account_id", accountId).eq("id", row.calendar_id).maybeSingle();
  if (calError || !cal) throw new Error(`booking undo notice: calendar of booking ${bookingId} unreadable: ${calError?.message ?? "not found"}`);
  return {
    publicId: (cal as { public_id: string }).public_id, cancelToken: row.cancel_token,
    meetingUrl: row.meeting_url, startsAt: row.starts_at,
  };
}
