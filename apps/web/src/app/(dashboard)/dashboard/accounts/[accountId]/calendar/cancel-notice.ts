import {
  claimCancelNotice, getContact, ensureConversation, createMessage, updateMessageStatus,
  loadAccountBrandInfo, serviceDb, type SupabaseClient,
} from "@bis/db";
import { sendEmailOrThrow } from "@/lib/consent/email-gate";
import { emailBrand } from "@/lib/email/templates/shell";
import { normalizeReplyTo } from "@/lib/email/reply-to";
import {
  bookingCancelledByBusinessEmail, bookingCancelledByBusinessSubject,
} from "@/lib/email/templates/booking";
import { formatWhen, safeZone } from "@/lib/booking/time";
import type { PublicLocale } from "@/lib/forms/public-strings";
import { UNDO_WINDOW_MS, NOTICE_GRACE_MS } from "./undo-window";

/**
 * F-048: the customer's notice for a cancel made on the Calendar page,
 * sent only once that cancel's Undo window has closed (DESIGN.md rule 6: an
 * Undo after the customer was told would not undo anything).
 *
 * Runs after the cancel's response (`after()` in `cancelBookingAction`), so
 * closing the tab does not lose it. The order is the guarantee:
 *   1. wait out the window and its grace;
 *   2. read what the email needs, and stop WITHOUT claiming when there is no
 *      address or the account is marked not to send (D-061), so the Undo
 *      still works for a notice that was never going to go;
 *   3. CLAIM the cancel (`claimCancelNotice`): a conditional write on the
 *      cancel's own version. An Undo that landed first means no claim, and
 *      nothing is written or sent. A claim that lands first refuses any later
 *      Undo (`customer_told`);
 *   4. write the outbound row on the customer's thread, as the person who
 *      cancelled (the composer's write-then-send), then send through the
 *      email gate as `staff.booking_cancel_notice`, then mark the row.
 *
 * Never throws: nobody is left to catch it. Every outcome is answered, and a
 * failure is logged by booking id, never by address. A claimed notice whose
 * send then fails stays visible as a failed message on the customer's
 * thread; the booking stays cancelled.
 *
 * Known limit: the wait lives in the server process. If that process dies
 * inside the window, the notice is never sent and nothing records it (no
 * row is written before the claim). A durable queue would need a column and
 * a cron pass; see the F-048 report.
 */
export type CancelNoticeRequest = {
  accountId: string; bookingId: string;
  /** The cancel's own `updatedAt` (`setBookingStatus`'s answer). */
  version: string;
  /** The person who cancelled; the thread row is theirs. */
  userId: string;
  /** The language the owner chose in the dialog. */
  locale: PublicLocale;
  /** The owner's message, already bounded by the action. */
  message: string;
  origin: string | null;
};

export type CancelNoticeOutcome = "sent" | "undone" | "no_email" | "suppressed" | "failed";

type Deps = { db?: SupabaseClient; sleep?: (ms: number) => Promise<void> };

const realSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export async function sendCancelNoticeAfterUndo(
  req: CancelNoticeRequest, deps: Deps = {},
): Promise<CancelNoticeOutcome> {
  const sleep = deps.sleep ?? realSleep;
  await sleep(UNDO_WINDOW_MS + NOTICE_GRACE_MS);

  const db = deps.db ?? serviceDb();
  const tag = `cancel notice for booking ${req.bookingId} (account ${req.accountId})`;
  let messageId: string | null = null;
  try {
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
    if (!to) return "no_email";

    const account = (await loadAccountBrandInfo(db, [req.accountId], "cancel notice")).get(req.accountId)!;
    if (account.outboundSuppressed) return "suppressed";

    const { data: calData, error: calErr } = await db.from("calendars")
      .select("public_id, enabled").eq("account_id", req.accountId).eq("id", booking.calendar_id).maybeSingle();
    if (calErr) throw new Error(`calendar read failed: ${calErr.message}`);
    const calendar = calData as { public_id: string; enabled: boolean } | null;

    if (!(await claimCancelNotice(db, req.accountId, req.bookingId, req.version))) return "undone";

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
    ({ id: messageId } = await createMessage(db, req.accountId, {
      conversationId: convo.id, channel: "email", direction: "outbound", subject, body: text,
    }, req.userId));

    const { providerMessageId } = await sendEmailOrThrow({
      accountId: req.accountId, kind: "staff.booking_cancel_notice", contactId: booking.contact_id,
      language: req.locale, origin: req.origin,
      to, fromName: brand.name, fromAddress: account.fromEmail ?? undefined,
      replyTo: normalizeReplyTo(account.replyToEmail), subject, body: text, html,
    }, { db });
    await updateMessageStatus(db, req.accountId, messageId, "sent", { providerMessageId }, req.userId);
    return "sent";
  } catch (e) {
    const reason = e instanceof Error ? e.message : String(e);
    console.error(`${tag} failed: ${reason}`);
    if (messageId) {
      try {
        await updateMessageStatus(db, req.accountId, messageId, "failed", { error: reason }, req.userId);
      } catch (e2) {
        console.error(`${tag}: marking the thread row failed also failed: ${String(e2)}`);
      }
    }
    return "failed";
  }
}
