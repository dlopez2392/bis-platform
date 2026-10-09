import {
  claimCancelNotice, getContact, ensureConversation, createMessage, updateMessageStatus,
  loadAccountBrandInfo, bookingContactEmail, isAccountOutboundSuppressed, readEmailSuppression,
  discardQueuedNotice, serviceDb, type SupabaseClient,
} from "@bis/db";
import { emailLedgerAddress } from "@bis/db/email-address";
import { sendEmailOrThrow } from "@/lib/consent/email-gate";
import { emailBrand } from "@/lib/email/templates/shell";
import { normalizeReplyTo } from "@/lib/email/reply-to";
import {
  bookingCancelledByBusinessEmail, bookingCancelledByBusinessSubject,
} from "@/lib/email/templates/booking";
import { formatWhen, safeZone } from "@/lib/booking/time";
import type { PublicLocale } from "@/lib/forms/public-strings";
import { UNDO_WINDOW_MS, NOTICE_GRACE_MS } from "./undo-window";
import type { NoticeAvailability } from "./cancel-flow";

/**
 * F-048: the customer's notice for a cancel made on the Calendar page, sent
 * only once that cancel's Undo window has closed (DESIGN.md rule 6: an Undo
 * after the customer was told would not undo anything). Three steps:
 *
 *   1. `cancelNoticeAvailability`, BEFORE the cancel and before the dialog:
 *      whether a notice can go at all (an address, an account that sends, an
 *      address that has not hard-bounced or complained). Only "available"
 *      opens the dialog, and only it lets the toast promise an email.
 *   2. `queueCancelNotice`, in the cancel's own request: compose the email
 *      and write the outbound row on the customer's thread, QUEUED, as the
 *      person who cancelled. Written before the wait, so a notice the server
 *      never got to send stays visible as a stuck queued row.
 *   3. `sendQueuedCancelNotice`, after the response (`after()`): wait out the
 *      window and its grace, CLAIM the cancel by its version, send through
 *      the email gate as `staff.booking_cancel_notice`, mark the row. An Undo
 *      that landed first means no claim: nothing is sent and the queued row
 *      is removed. A claimed notice that then fails marks the row failed.
 *
 * Durable follow-up (not built): a pending-notice column on bookings, swept
 * by the reminders cron, so a notice survives the process that queued it.
 */
export type { NoticeAvailability };

/**
 * `readDb` reads the contact as the signed-in user (RLS); `writer` reads the
 * two suppression facts exactly as the email gate does: the account's
 * `outbound_suppressed` (D-061) and the address's hard-bounce/complaint
 * suppression (D-016, `readEmailSuppression` keyed by `emailLedgerAddress`).
 * THROWS on any read error: the caller refuses rather than promise an email
 * nobody could check.
 */
export async function cancelNoticeAvailability(
  readDb: SupabaseClient, writer: SupabaseClient, accountId: string, bookingId: string,
): Promise<NoticeAvailability> {
  const to = emailLedgerAddress(await bookingContactEmail(readDb, accountId, bookingId));
  if (!to) return "no_email";
  if (await isAccountOutboundSuppressed(writer, accountId)) return "suppressed_account";
  if (await readEmailSuppression(writer, accountId, to)) return "address_blocked";
  return "available";
}

export type QueueCancelNoticeRequest = {
  accountId: string; bookingId: string;
  /** The person who cancelled; the thread row is theirs. */
  userId: string;
  /** The language the owner chose in the dialog. */
  locale: PublicLocale;
  /** The owner's message, already bounded by the action. */
  message: string;
  origin: string | null;
};

/** Everything the send needs, fixed when the row is written. */
export type ComposedCancelNotice = {
  contactId: string; to: string; locale: PublicLocale; origin: string | null;
  fromName: string; fromAddress?: string; replyTo?: string;
  subject: string; text: string; html: string;
};

export type QueuedCancelNotice = { messageId: string; email: ComposedCancelNotice };

/** Composes the email and writes its queued thread row. THROWS on anything
 *  missing or unreadable, before the row when it can: the caller then
 *  promises no email. */
export async function queueCancelNotice(
  db: SupabaseClient, req: QueueCancelNoticeRequest,
): Promise<QueuedCancelNotice> {
  const { data: bookingData, error: bookingErr } = await db.from("bookings")
    .select("contact_id, calendar_id, starts_at, booker_timezone")
    .eq("account_id", req.accountId).eq("id", req.bookingId).maybeSingle();
  if (bookingErr) throw new Error(`booking read failed: ${bookingErr.message}`);
  const booking = bookingData as {
    contact_id: string; calendar_id: string; starts_at: string; booker_timezone: string | null;
  } | null;
  if (!booking) throw new Error("booking not found");

  const contact = await getContact(db, req.accountId, booking.contact_id) as { email?: string | null } | null;
  const to = contact?.email?.trim();
  if (!to) throw new Error("the contact has no email");

  const account = (await loadAccountBrandInfo(db, [req.accountId], "cancel notice")).get(req.accountId)!;
  const { data: calData, error: calErr } = await db.from("calendars")
    .select("public_id, enabled").eq("account_id", req.accountId).eq("id", booking.calendar_id).maybeSingle();
  if (calErr) throw new Error(`calendar read failed: ${calErr.message}`);
  const calendar = calData as { public_id: string; enabled: boolean } | null;

  const startsAt = new Date(booking.starts_at);
  const accountZone = safeZone(account.accountTimezone, "UTC");
  const bookerZone = safeZone(booking.booker_timezone ?? undefined, accountZone);
  const rebookUrl = calendar?.enabled && req.origin
    ? `${req.origin}/b/${calendar.public_id}${req.locale === "es" ? "?locale=es" : ""}`
    : "";
  const brand = emailBrand(account.branding);
  const subject = bookingCancelledByBusinessSubject(req.locale);
  const { html, text } = bookingCancelledByBusinessEmail({
    brand, locale: req.locale,
    whenBookerZone: formatWhen(startsAt, bookerZone, req.locale),
    whenCompanyZone: formatWhen(startsAt, accountZone, req.locale),
    message: req.message, rebookUrl,
  });

  const convo = await ensureConversation(db, req.accountId, booking.contact_id, req.userId);
  const { id: messageId } = await createMessage(db, req.accountId, {
    conversationId: convo.id, channel: "email", direction: "outbound", subject, body: text,
  }, req.userId);

  return {
    messageId,
    email: {
      contactId: booking.contact_id, to, locale: req.locale, origin: req.origin,
      fromName: brand.name, fromAddress: account.fromEmail ?? undefined,
      replyTo: normalizeReplyTo(account.replyToEmail), subject, text, html,
    },
  };
}

export type SendQueuedCancelNoticeRequest = {
  accountId: string; bookingId: string;
  /** The cancel's own `updatedAt` (`setBookingStatus`'s answer). */
  version: string;
  userId: string;
  queued: QueuedCancelNotice;
};

export type CancelNoticeOutcome = "sent" | "undone" | "failed";

type Deps = { db?: SupabaseClient; sleep?: (ms: number) => Promise<void> };

const realSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Never throws: it runs after the response, and nobody is left to catch it.
 *  Logs by booking id, never by address. */
export async function sendQueuedCancelNotice(
  req: SendQueuedCancelNoticeRequest, deps: Deps = {},
): Promise<CancelNoticeOutcome> {
  const sleep = deps.sleep ?? realSleep;
  await sleep(UNDO_WINDOW_MS + NOTICE_GRACE_MS);

  const db = deps.db ?? serviceDb();
  const tag = `cancel notice for booking ${req.bookingId} (account ${req.accountId})`;
  const { messageId, email } = req.queued;
  try {
    if (!(await claimCancelNotice(db, req.accountId, req.bookingId, req.version))) {
      // The Undo won (the Undo action removes the row too; this covers an
      // Undo whose own removal failed). Nothing was sent.
      try {
        await discardQueuedNotice(db, req.accountId, messageId);
      } catch (e) {
        console.error(`${tag}: undone, but removing its queued row failed: ${String(e)}`);
      }
      return "undone";
    }

    const { providerMessageId } = await sendEmailOrThrow({
      accountId: req.accountId, kind: "staff.booking_cancel_notice", contactId: email.contactId,
      language: email.locale, origin: email.origin,
      to: email.to, fromName: email.fromName, fromAddress: email.fromAddress,
      replyTo: email.replyTo, subject: email.subject, body: email.text, html: email.html,
    }, { db });
    // Its own try (fix round 2, M-c): the email has gone. A failure to RECORD
    // that must never turn the row into "failed", or a late Undo would tell
    // the owner it didn't go through when it did. The row stays queued (the
    // honest "not known yet"), and the failure is logged.
    try {
      await updateMessageStatus(db, req.accountId, messageId, "sent", { providerMessageId }, req.userId);
    } catch (e) {
      console.error(`${tag}: sent, but marking the thread row sent failed: ${String(e)}`);
    }
    return "sent";
  } catch (e) {
    const reason = e instanceof Error ? e.message : String(e);
    console.error(`${tag} failed: ${reason}`);
    try {
      await updateMessageStatus(db, req.accountId, messageId, "failed", { error: reason }, req.userId);
    } catch (e2) {
      console.error(`${tag}: marking the thread row failed also failed: ${String(e2)}`);
    }
    return "failed";
  }
}
