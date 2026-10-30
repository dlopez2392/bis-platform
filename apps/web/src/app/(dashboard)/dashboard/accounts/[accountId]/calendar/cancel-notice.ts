import {
  claimCancelNotice, getContact, ensureConversation, createMessage, updateMessageStatus,
  loadAccountBrandInfo, bookingContactEmail, isAccountOutboundSuppressed, readEmailSuppression,
  discardQueuedNotice, readBookingStatus, deletePendingCancelNotice, serviceDb, type SupabaseClient,
} from "@bis/db";
import { emailLedgerAddress } from "@bis/db/email-address";
import { sendEmailOrThrow, type EmailRequest } from "@/lib/consent/email-gate";
import type { SendEmailResult } from "@/lib/email/types";
import { emailBrand } from "@/lib/email/templates/shell";
import { normalizeReplyTo } from "@/lib/email/reply-to";
import {
  bookingCancelledByBusinessEmail, bookingCancelledByBusinessSubject,
} from "@/lib/email/templates/booking";
import { formatWhen, safeZone } from "@/lib/booking/time";
import type { PublicLocale } from "@/lib/forms/public-strings";
import { CANCEL_NOTICE_EXPIRED, type ExpiredReason } from "@/lib/booking/cancel-notice-expired";
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
 *      never got to send stays visible as a stuck queued row. The cancel
 *      action then writes the notice's durable copy
 *      (`booking_cancel_notices`, 0100), due when the window and its grace
 *      close.
 *   3. `sendQueuedCancelNotice`, after the response (`after()`): wait out the
 *      window and its grace, then `deliverCancelNotice`: CLAIM the cancel by
 *      its version, send through the email gate as
 *      `staff.booking_cancel_notice`, mark the row, remove the durable copy.
 *      A claimed notice that then fails marks the row failed.
 *
 * Durable (built, F-048 follow-up): when the process dies inside the wait,
 * the cron's `cancelNotices` pass (lib/automations/passes/cancel-notices.ts)
 * finds the durable copy two minutes after it fell due and runs the SAME
 * `deliverCancelNotice`, through the tick's own email gate; past the
 * appointment's start or a day after the cancel it sends nothing and marks
 * the row failed instead (`expireCancelNotice`). Exactly one of `after()`,
 * the sweep and the Undo wins the claim. The loser of the claim discards the
 * queued row ONLY when the booking is no longer cancelled (the Undo won): a
 * booking still cancelled means the other sender holds the claim and may
 * already have sent, its row still queued after a failed "sent" mark (M-c),
 * so it touches nothing but its own durable copy (`onLostClaim`). The sweep
 * finds work ONLY in `booking_cancel_notices`, never by scanning
 * `messages.status = 'queued'`, for the same reason: such a scan would email
 * the customer twice.
 */
export type { NoticeAvailability };

/**
 * `readDb` reads the contact as the signed-in user (RLS); `writer` reads the
 * two suppression facts exactly as the email gate does: the account's
 * `outbound_suppressed` (D-061) and the address's hard-bounce/complaint
 * suppression (D-016, `readEmailSuppression` keyed by `emailLedgerAddress`).
 * THROWS on any read error. Both callers then fail OPEN to the reversible
 * action: the button cancels at once with no notice, and
 * `cancelBookingAction` cancels without it and answers "none", so no email is
 * promised that nobody could check.
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
  /** F-046 (T10 carry-in 2): the booking whose time the email names, when it is not the cancelled one. A staff
   *  job cancelled inside its Undo hold was never told to the customer; the action names the earlier row of the
   *  same appointment that they WERE told (`cancelBookingAction`). Must be the same customer's, or this THROWS. */
  whenFrom?: string;
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
  let when: { starts_at: string; booker_timezone: string | null } = booking;
  if (req.whenFrom !== undefined) {
    const { data: toldData, error: toldErr } = await db.from("bookings")
      .select("contact_id, starts_at, booker_timezone")
      .eq("account_id", req.accountId).eq("id", req.whenFrom).maybeSingle();
    if (toldErr) throw new Error(`told booking read failed: ${toldErr.message}`);
    const told = toldData as { contact_id: string; starts_at: string; booker_timezone: string | null } | null;
    if (!told || told.contact_id !== booking.contact_id) throw new Error("the told booking is not this customer's");
    when = told;
  }

  const contact = await getContact(db, req.accountId, booking.contact_id) as { email?: string | null } | null;
  const to = contact?.email?.trim();
  if (!to) throw new Error("the contact has no email");

  const account = (await loadAccountBrandInfo(db, [req.accountId], "cancel notice")).get(req.accountId)!;
  const { data: calData, error: calErr } = await db.from("calendars")
    .select("public_id, enabled").eq("account_id", req.accountId).eq("id", booking.calendar_id).maybeSingle();
  if (calErr) throw new Error(`calendar read failed: ${calErr.message}`);
  const calendar = calData as { public_id: string; enabled: boolean } | null;

  const startsAt = new Date(when.starts_at);
  const accountZone = safeZone(account.accountTimezone, "UTC");
  const bookerZone = safeZone(when.booker_timezone ?? undefined, accountZone);
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

/**
 * What became of one notice. `sent`: this caller claimed it and the email
 * went. `undone`: the Undo won, nothing was sent and the queued row is gone.
 * `elsewhere`: someone else holds the claim (the other of `after()` and the
 * sweep, or a newer cancel), so this caller touched nothing but its own
 * pending row. `unsettled`: who won could not be read, so this caller
 * touched nothing at all and the sweep settles it later. `failed`: the send
 * (or the claim) failed and the row says so. `expired` (the sweep only): too
 * late to tell the customer, never sent, and the row says so.
 */
export type CancelNoticeOutcome = "sent" | "undone" | "elsewhere" | "unsettled" | "failed";
export type ExpiredNoticeOutcome = "expired" | "undone" | "elsewhere" | "unsettled";

/** One notice, everything its delivery needs: what `queueCancelNotice`
 *  answered, the cancel's version, and the person who cancelled. The cron
 *  sweep rebuilds it from `booking_cancel_notices` (0100). */
export type CancelNotice = {
  accountId: string; bookingId: string; version: string; userId: string;
  messageId: string; email: ComposedCancelNotice;
};

/** `send` is the cron tick's own gate (`ctx.email.send`) when the sweep
 *  delivers; `after()` leaves it out and sends through `sendEmailOrThrow` on
 *  the same client. The two are the same gate. */
type DeliverDeps = { db: SupabaseClient; send?: (req: EmailRequest) => Promise<SendEmailResult> };

/** Why a notice is too late to send: the marker written to the thread row's
 *  `error`, which failure-reason.ts turns into plain words for the owner
 *  ("too late to tell the customer"). Defined in lib/booking so lib/email can
 *  read it without importing this page module. */
export { CANCEL_NOTICE_EXPIRED, type ExpiredReason };

const tagOf = (n: CancelNotice) => `cancel notice for booking ${n.bookingId} (account ${n.accountId})`;

/** Settles this cancel's pending row only (by its version). Best effort:
 *  a row left behind is found by the sweep, which loses the claim and
 *  removes it. */
async function dropPending(db: SupabaseClient, n: CancelNotice): Promise<void> {
  try {
    await deletePendingCancelNotice(db, n.accountId, n.bookingId, n.version);
  } catch (e) {
    console.error(`${tagOf(n)}: its pending row not removed: ${String(e)}`);
  }
}

/**
 * The claim was lost. Before the sweep, that could only mean the Undo won.
 * Now the other sender (the `after()` job or the sweep) may hold the claim
 * and may already have SENT, with its thread row still queued (a failed
 * "sent" mark, M-c), so discarding the queued row could delete the record
 * of an email that went. Rule: discard ONLY when the booking is provably no
 * longer cancelled (the Undo won). Still cancelled, or no such booking:
 * someone else owns the notice, and this caller removes only its own
 * pending row. Status unreadable: touch nothing; the sweep asks again.
 */
async function onLostClaim(db: SupabaseClient, n: CancelNotice): Promise<"undone" | "elsewhere" | "unsettled"> {
  let status: string | null;
  try {
    status = await readBookingStatus(db, n.accountId, n.bookingId);
  } catch (e) {
    console.error(`${tagOf(n)}: claim lost and the booking unreadable, left for the sweep: ${String(e)}`);
    return "unsettled";
  }
  if (status === "cancelled" || status === null) {
    await dropPending(db, n);
    return "elsewhere";
  }
  // The Undo won (the Undo action removes the row too; this covers an Undo
  // whose own removal failed). Nothing was sent. The discard carries the
  // pending row with it (0100's cascade); the explicit drop covers a queued
  // row that is already gone.
  try {
    await discardQueuedNotice(db, n.accountId, n.messageId);
  } catch (e) {
    console.error(`${tagOf(n)}: undone, but removing its queued row failed: ${String(e)}`);
  }
  await dropPending(db, n);
  return "undone";
}

/**
 * THE delivery, shared by the `after()` job and the cron sweep: CLAIM the
 * cancel by its version, send through the email gate as
 * `staff.booking_cancel_notice`, mark the thread row, settle the pending row.
 * Exactly one caller can win the claim (`claimCancelNotice`), so the
 * customer is emailed at most once whoever runs first.
 *
 * A claimed notice whose send fails marks the row failed and settles the
 * pending row: the claim is spent, so nobody could send it now. A claim that
 * THROWS marks the row failed but KEEPS the pending row: the claim may never
 * have landed, and the sweep retries it under the same claim (if it did
 * land, the sweep loses it and only removes the pending row).
 *
 * Never throws: `after()` runs it after the response, and nobody is left to
 * catch it. Logs by booking id, never by address.
 */
export async function deliverCancelNotice(n: CancelNotice, deps: DeliverDeps): Promise<CancelNoticeOutcome> {
  const { db } = deps;
  const send = deps.send ?? ((req: EmailRequest) => sendEmailOrThrow(req, { db }));
  const tag = tagOf(n);
  const { messageId, email } = n;
  let claimed = false;
  try {
    claimed = await claimCancelNotice(db, n.accountId, n.bookingId, n.version);
    if (!claimed) return await onLostClaim(db, n);

    const { providerMessageId } = await send({
      accountId: n.accountId, kind: "staff.booking_cancel_notice", contactId: email.contactId,
      language: email.locale, origin: email.origin,
      to: email.to, fromName: email.fromName, fromAddress: email.fromAddress,
      replyTo: email.replyTo, subject: email.subject, body: email.text, html: email.html,
    });
    // Its own try (fix round 2, M-c): the email has gone. A failure to RECORD
    // that must never turn the row into "failed", or a late Undo would tell
    // the owner it didn't go through when it did. The row stays queued (the
    // honest "not known yet"), and the failure is logged.
    try {
      await updateMessageStatus(db, n.accountId, messageId, "sent", { providerMessageId }, n.userId);
    } catch (e) {
      console.error(`${tag}: sent, but marking the thread row sent failed: ${String(e)}`);
    }
    await dropPending(db, n);
    return "sent";
  } catch (e) {
    const reason = e instanceof Error ? e.message : String(e);
    console.error(`${tag} failed: ${reason}`);
    try {
      await updateMessageStatus(db, n.accountId, messageId, "failed", { error: reason }, n.userId);
    } catch (e2) {
      console.error(`${tag}: marking the thread row failed also failed: ${String(e2)}`);
    }
    if (claimed) await dropPending(db, n);
    return "failed";
  }
}

/**
 * The sweep's answer to a notice it is too late to send (the appointment
 * has started, or the cancel is a day old): CLAIM first, exactly as a send
 * would, so an Undo that won is never told "failed" and a notice someone
 * else sent is never relabelled. Claimed: the thread row is marked failed in
 * plain words (the thread says it was too late to tell the customer) and
 * the pending row is settled. Lost: rule 4, as `deliverCancelNotice`. A
 * claim that throws touches nothing: the next tick tries again.
 *
 * Never throws.
 */
export async function expireCancelNotice(
  n: CancelNotice, deps: { db: SupabaseClient }, why: ExpiredReason,
): Promise<ExpiredNoticeOutcome> {
  const { db } = deps;
  let claimed: boolean;
  try {
    claimed = await claimCancelNotice(db, n.accountId, n.bookingId, n.version);
  } catch (e) {
    console.error(`${tagOf(n)}: too late to send, and its claim failed; left for the next tick: ${String(e)}`);
    return "unsettled";
  }
  if (!claimed) return onLostClaim(db, n);
  try {
    await updateMessageStatus(db, n.accountId, n.messageId, "failed", { error: CANCEL_NOTICE_EXPIRED[why] }, n.userId);
  } catch (e) {
    console.error(`${tagOf(n)}: too late to send, and marking the thread row failed failed: ${String(e)}`);
  }
  await dropPending(db, n);
  return "expired";
}

type Deps = { db?: SupabaseClient; sleep?: (ms: number) => Promise<void> };

const realSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** The `after()` job: waits out the Undo window and its grace, then delivers.
 *  Never throws. */
export async function sendQueuedCancelNotice(
  req: SendQueuedCancelNoticeRequest, deps: Deps = {},
): Promise<CancelNoticeOutcome> {
  const sleep = deps.sleep ?? realSleep;
  await sleep(UNDO_WINDOW_MS + NOTICE_GRACE_MS);
  return deliverCancelNotice({
    accountId: req.accountId, bookingId: req.bookingId, version: req.version, userId: req.userId,
    messageId: req.queued.messageId, email: req.queued.email,
  }, { db: deps.db ?? serviceDb() });
}

