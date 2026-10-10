"use server";

import { headers } from "next/headers";
import {
  serviceDb, getContact, moveBooking, SlotTakenError, BookingNotMovableError,
  countRecentBookings, rescheduleChain,
  ensureConversation, createMessage, incrementUnreadCount,
} from "@bis/db";
import { sendEmailOrThrow } from "@/lib/consent/email-gate";
import { getMeetingProvider } from "@/lib/meetings/provider";
import { normalizeReplyTo } from "@/lib/email/reply-to";
import { originFrom } from "@/lib/email/origin";
import { emailBrand } from "@/lib/email/templates/shell";
import {
  bookingMovedAlertEmail, bookingRescheduledEmail, bookingRescheduledSubject,
} from "@/lib/email/templates/booking";
import { safeZone, formatWhen } from "@/lib/booking/time";
import { moveSlots, movableSlot, dayKeyInZone } from "@/lib/booking/availability";
import { calendarFileUrl } from "@/lib/booking/calendar-file";
import { bookingCancelUrl, bookingMoveUrl, isBookingToken } from "@/lib/booking/links";
import { normalizeLocale } from "@/lib/forms/public-strings";
import { clientIp, hashIp, RATE_LIMIT_MAX, RATE_LIMIT_WINDOW_MS } from "@/lib/forms/guards";
import { bookingStrings } from "@/lib/booking/public-strings";
import { m } from "@/lib/messages";
import { readMoveContext, moveState, movingOf, scrubToken, MOVE_CHAIN_MAX, type MoveContext } from "./data";

/**
 * F-048 (rider): the customer moves their own booking, from the link in their
 * email. The token is the capability, exactly as for the cancel link beside
 * this route: no account id, no session. Everything this module touches —
 * the calendar, the account, the notify list, every link it hands back — is
 * the ROW's (`readMoveContext`), never anything the request names; the URL's
 * `publicId` is not even an argument here.
 *
 * TOKEN RULES (the calendar file's): a value that is not a token is refused
 * before any read, and no log line ever carries one (`scrubToken`).
 */

/** `emailSent` (D-033's rule): true only once the email gate said the
 *  customer's "moved" email was SENT; the success screen claims an email only
 *  then. `manageUrl`/`calendarUrl` are the NEW booking's ("" without an
 *  origin). `gone`: the booking stopped being movable (cancelled, already
 *  moved, or over), so the page stops offering times. */
export type MoveResult =
  | { ok: true; startsAt: string; manageUrl: string; calendarUrl: string; emailSent: boolean }
  | { ok: false; error: string; slotTaken?: true; gone?: true };

// Same pair, same reasoning, as the booking and cancel actions: an
// unauthenticated capability link is never a signed-in user acting.
const ACTOR_ID = "public";
const ACTOR_TYPE = "system";

const DAY_KEY_RE = /^\d{4}-\d{2}-\d{2}$/;

function stripSubjectControlChars(value: string): string {
  return value.replace(/[\r\n\t]+/g, " ");
}

/** The move page's picker: free times on one account-zone day, for the day as
 *  it will be once the move commits (`moveSlots`). */
export async function getMoveSlotsAction(
  token: string, locale: string, dayIso: string,
): Promise<{ slots: string[] } | { error: string }> {
  const s = bookingStrings(normalizeLocale(locale, "en"));
  if (!isBookingToken(token) || !DAY_KEY_RE.test(dayIso)) return { error: s.genericError };
  try {
    const db = serviceDb();
    const now = new Date();
    const ctx = await readMoveContext(db, token);
    if (!ctx || moveState(ctx, now) !== "live") return { error: s.genericError };
    const timezone = ctx.account.timezone ?? "UTC";
    const all = await moveSlots(db, ctx.calendar, timezone, now, movingOf(ctx.row));
    return {
      slots: all.filter((r) => dayKeyInZone(r.startsAt, timezone) === dayIso).map((r) => r.startsAt.toISOString()),
    };
  } catch (e) {
    console.error(`move slots (${dayIso}) failed: ${scrubToken(e, token)}`);
    return { error: s.genericError };
  }
}

/**
 * The move. Every refusal comes before any write; `moveBooking` is the write
 * (the new range first, then the old row cancelled only if it is still live,
 * else the new one taken back out), and `bookings_no_overlap` is the
 * guarantee under it. Past that point the booking HAS moved, so nothing after
 * it may turn the answer into a failure: the thread line, the business's
 * alert and the customer's email are each best-effort.
 */
export async function confirmMoveAction(
  token: string, locale: string, slotStartsAt: string,
): Promise<MoveResult> {
  const lang = normalizeLocale(locale, "en");
  const s = bookingStrings(lang);
  if (!isBookingToken(token)) return { ok: false, error: s.moveGenericError };

  let ctx: MoveContext | null;
  let moved: { id: string; cancelToken: string };
  let startsAt: Date;
  let meetingUrl: string | undefined;
  const db = serviceDb();
  try {
    const now = new Date();
    ctx = await readMoveContext(db, token);
    if (!ctx) return { ok: false, error: s.moveGenericError };
    const state = moveState(ctx, now);
    if (state === "cancelled") return { ok: false, error: s.moveAlreadyChanged, gone: true };
    if (state === "past") return { ok: false, error: s.cancelPastTitle, gone: true };
    if (state === "offline") return { ok: false, error: s.moveOffline };

    // Fix round 1 (I3): the bounds on how often, BEFORE the slot is looked
    // at. The booking page's own per-IP limit (the moved row carries the IP
    // hash, so `countRecentBookings` sees moves), answered as that page
    // answers it; then the appointment's own cap (`MOVE_CHAIN_MAX`).
    const ipHash = hashIp(clientIp(await headers()));
    const windowStart = new Date(now.getTime() - RATE_LIMIT_WINDOW_MS).toISOString();
    if (await countRecentBookings(db, ctx.calendar.id, ipHash, windowStart) >= RATE_LIMIT_MAX) {
      return { ok: false, error: s.moveGenericError };
    }
    const { depth } = await rescheduleChain(db, ctx.row.account_id, ctx.row.id);
    if (depth >= MOVE_CHAIN_MAX) return { ok: false, error: s.moveOffline, gone: true };

    const timezone = ctx.account.timezone ?? "UTC";
    const wanted = new Date(slotStartsAt);
    const slot = Number.isFinite(wanted.getTime())
      ? await movableSlot(db, ctx.calendar, timezone, now, movingOf(ctx.row), wanted)
      : null;
    if (!slot) return { ok: false, error: s.slotTaken, slotTaken: true };
    startsAt = slot.startsAt;

    // A NEW room sized to the NEW time, the receptionist's rule: the old
    // room expires with the old slot. Best-effort; never logs a url.
    if (ctx.calendar.meeting_type === "video") {
      const provider = getMeetingProvider();
      if (provider) {
        try {
          ({ url: meetingUrl } = await provider.createMeetingRoom({ bookingId: ctx.calendar.public_id, endsAt: slot.endsAt }));
        } catch (e) {
          console.error(`move ${ctx.row.id}: createMeetingRoom failed: ${String(e)}`);
        }
      }
    }

    try {
      moved = await moveBooking(db, ctx.row.account_id, ctx.row.id,
        { startsAt: slot.startsAt, endsAt: slot.endsAt, meetingUrl, ipHash }, ACTOR_ID, ACTOR_TYPE);
    } catch (e) {
      if (e instanceof SlotTakenError) return { ok: false, error: s.slotTaken, slotTaken: true };
      if (e instanceof BookingNotMovableError) return { ok: false, error: s.moveAlreadyChanged, gone: true };
      throw e;
    }
  } catch (e) {
    console.error(`confirmMoveAction failed: ${scrubToken(e, token)}`);
    return { ok: false, error: s.moveGenericError };
  }

  // --- Best-effort from here: the booking has moved. ----------------------
  const { row, calendar, account } = ctx;
  const accountId = row.account_id;
  const timezone = account.timezone ?? "UTC";
  const bookerZone = safeZone(row.booker_timezone ?? undefined, timezone);
  const origin = originFrom(await headers());
  const manageUrl = bookingCancelUrl(origin, calendar.public_id, moved.cancelToken, lang);
  const calendarUrl = calendarFileUrl(origin, calendar.public_id, moved.cancelToken, lang);
  const moveUrl = bookingMoveUrl(origin, calendar.public_id, moved.cancelToken, lang);

  let contact: { first_name?: string | null; last_name?: string | null; email?: string | null } | null = null;
  try {
    contact = await getContact(db, accountId, row.contact_id);
  } catch (e) {
    console.error(`move ${row.id}: contact read failed: ${String(e)}`);
  }
  const contactEmail = contact?.email?.trim() || null;
  const contactName = [contact?.first_name, contact?.last_name].filter(Boolean).join(" ").trim()
    || contactEmail || "Someone";

  // The business's record, in English and its own zone (the dashboard's).
  let wasCompanyZone = "";
  let nowCompanyZone = "";
  try {
    wasCompanyZone = formatWhen(new Date(row.starts_at), timezone);
    nowCompanyZone = formatWhen(startsAt, timezone);
    const convo = await ensureConversation(db, accountId, row.contact_id, ACTOR_ID, ACTOR_TYPE);
    await createMessage(db, accountId, {
      conversationId: convo.id, channel: "form", direction: "inbound",
      subject: m["calendar.move.thread.subject.en"],
      body: m["calendar.move.thread.body.en"].replace("{was}", wasCompanyZone).replace("{now}", nowCompanyZone),
    }, ACTOR_ID, ACTOR_TYPE);
    await incrementUnreadCount(db, accountId, convo.id);
  } catch (e) {
    console.error(`move ${row.id} -> ${moved.id}: thread line failed: ${String(e)}`);
  }

  const brand = emailBrand({
    brandName: account.brand_name, brandLogoPath: account.brand_logo_path,
    brandColor: account.brand_color, brandNeutral: account.brand_neutral,
    brandCorners: account.brand_corners, brandType: account.brand_type,
    brandMode: account.brand_mode, replyToEmail: null,
  });

  // The business: one alert per notify address, from the row's own calendar.
  if (calendar.notify_emails.length > 0 && wasCompanyZone && nowCompanyZone) {
    const contactUrl = origin ? `${origin}/dashboard/accounts/${accountId}/contacts/${row.contact_id}` : null;
    const { subject, html, text } = bookingMovedAlertEmail({
      brand, whenCompanyZone: wasCompanyZone, newWhenCompanyZone: nowCompanyZone,
      contactName: stripSubjectControlChars(contactName), contactUrl,
    });
    const failures: string[] = [];
    for (const to of calendar.notify_emails) {
      try {
        // No fromAddress: the client's OWN staff, the booking alert's rule.
        await sendEmailOrThrow({
          accountId, kind: "operator.move_notice", to, fromName: brand.name, subject, body: text, html,
        });
      } catch (e) {
        failures.push(`${to} (${e instanceof Error ? e.message : String(e)})`);
      }
    }
    if (failures.length > 0) console.error(`move ${moved.id}: alert failed for ${failures.join(", ")}`);
  }

  // The customer: what they just did, in their language, with the NEW links.
  let emailSent = false;
  if (contactEmail) {
    try {
      const { html, text } = bookingRescheduledEmail({
        brand, locale: lang,
        whenBookerZone: formatWhen(startsAt, bookerZone, lang),
        whenCompanyZone: formatWhen(startsAt, timezone, lang),
        cancelUrl: manageUrl, meetingUrl, calendarUrl, moveUrl,
      });
      await sendEmailOrThrow({
        // Customer-initiated (spec §4.3): it answers what the customer just
        // did, so an unsubscribe never stops it, and it carries the way out.
        accountId, kind: "booking.moved", contactId: row.contact_id, language: lang, origin,
        to: contactEmail, fromName: brand.name, fromAddress: account.from_email ?? undefined,
        replyTo: normalizeReplyTo(account.reply_to_email), subject: bookingRescheduledSubject(lang),
        body: text, html,
      });
      emailSent = true;
    } catch (e) {
      console.error(`move ${moved.id}: customer email failed: ${String(e)}`);
    }
  }

  return { ok: true, startsAt: startsAt.toISOString(), manageUrl, calendarUrl, emailSent };
}
