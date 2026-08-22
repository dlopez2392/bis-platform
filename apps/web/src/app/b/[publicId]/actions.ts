"use server";

import { headers } from "next/headers";
import {
  serviceDb, getCalendarByPublicId, createContact, createBooking, SlotTakenError,
  listBookedRanges, countRecentBookings, ensureConversation, createMessage,
  incrementUnreadCount, type CalendarRow,
} from "@bis/db";
import { getEmailProvider } from "@/lib/email";
import { normalizeReplyTo } from "@/lib/email/reply-to";
import { originFrom } from "@/lib/email/origin";
import { emailBrand } from "@/lib/email/templates/shell";
import { bookingAlertEmail, bookingConfirmationEmail } from "@/lib/email/templates/booking";
import { computeSlots, partsInZone, type SlotConfig } from "@/lib/booking/slots";
import {
  HONEYPOT_FIELD, RENDER_TOKEN_FIELD, MIN_FILL_MS, RATE_LIMIT_MAX, RATE_LIMIT_WINDOW_MS,
  verifyRenderToken, hashIp, isValidEmail, isValidPhone,
} from "@/lib/forms/guards";
import { m } from "@/lib/messages";

export type BookingResult =
  | { ok: true; cancelUrl: string }
  | { ok: false; error: string; slotTaken?: true };

// Every db mutation this action makes passes this pair. The trailing
// actorType param on createContact/createBooking/ensureConversation/
// createMessage exists precisely so a public booking is not audit-logged as
// actor_type='user' — the recorded Resend-webhook bug class. Named once so a
// future edit that adds another mutation call cannot forget it by typing
// "user" (the default) out of habit.
const ACTOR_ID = "public";
const ACTOR_TYPE = "system";

/** Same trust assumption as `f/[publicId]/actions.ts`'s `clientIp`: Vercel
 *  OVERWRITES `x-vercel-forwarded-for`/`x-forwarded-for` rather than
 *  appending, which is what makes the first hop trustworthy here. */
function clientIp(h: Headers): string {
  const vercelForwarded = h.get("x-vercel-forwarded-for");
  if (vercelForwarded) return vercelForwarded.split(",")[0]!.trim();
  const forwarded = h.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0]!.trim();
  return h.get("x-real-ip") ?? "unknown";
}

function str(formData: FormData, key: string): string {
  return String(formData.get(key) ?? "").trim();
}

function slotConfigFrom(calendar: CalendarRow, timezone: string): SlotConfig {
  return {
    timezone,
    slotDurationMinutes: calendar.slot_duration_minutes,
    bufferMinutes: calendar.buffer_minutes,
    minNoticeHours: calendar.min_notice_hours,
    maxAdvanceDays: calendar.max_advance_days,
    openHours: calendar.open_hours,
  };
}

/**
 * The whole bookable horizon, freshly computed — both callers below run this
 * rather than trusting anything the client sent about what's free. `booked`
 * rows arrive as ISO strings from `listBookedRanges`; converting them to real
 * `Date`s is this module's job, not the engine's (the engine fails closed on
 * an unparseable range rather than silently ignoring it).
 */
async function computeAllSlots(
  db: ReturnType<typeof serviceDb>, calendar: CalendarRow, timezone: string, now: Date,
): Promise<{ startsAt: Date; endsAt: Date }[]> {
  // +2 days of headroom past the horizon end so a booking near the last
  // in-horizon instant is never excluded by an off-by-one on the query window
  // itself — computeSlots is what actually enforces the horizon boundary.
  const horizonEndMs = now.getTime() + (calendar.max_advance_days + 2) * 24 * 3600_000;
  const rows = await listBookedRanges(db, calendar.id, now.toISOString(), new Date(horizonEndMs).toISOString());
  const booked = rows.map((r) => ({ startsAt: new Date(r.starts_at), endsAt: new Date(r.ends_at) }));
  return computeSlots(slotConfigFrom(calendar, timezone), booked, now);
}

/** `YYYY-MM-DD` as seen in `timezone` — the day-picker's own key format, and
 *  the same zone-conversion path (`partsInZone`) the engine itself uses, so
 *  this can never disagree with computeSlots about which day a slot falls on. */
function dayKeyInZone(instant: Date, timezone: string): string {
  const p = partsInZone(instant, timezone);
  return `${p.y}-${String(p.m).padStart(2, "0")}-${String(p.d).padStart(2, "0")}`;
}

const DAY_KEY_RE = /^\d{4}-\d{2}-\d{2}$/;

/** The account row every send below needs — timezone for both re-validating
 *  availability and formatting the company-zone when-string, the rest for
 *  branding and the confirmation's from/reply-to. One row, several jobs, the
 *  same economy `notify()` in the sibling form action takes. */
async function loadAccount(db: ReturnType<typeof serviceDb>, accountId: string) {
  const { data } = await db.from("accounts")
    .select("name, timezone, from_email, reply_to_email, brand_name, brand_logo_path, "
      + "brand_color, brand_neutral, brand_corners, brand_type, brand_mode")
    .eq("id", accountId).maybeSingle();
  return data as {
    name: string | null; timezone: string | null;
    from_email: string | null; reply_to_email: string | null;
    brand_name: string | null; brand_logo_path: string | null; brand_color: string | null;
    brand_neutral: "warm" | "cool" | "slate" | null;
    brand_corners: "sharp" | "soft" | "round" | null;
    brand_type: "geist" | "inter" | "serif" | null;
    brand_mode: "light" | "dark" | "follow" | null;
  } | null;
}

function formatWhen(instant: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone, weekday: "short", month: "short", day: "numeric",
    hour: "numeric", minute: "2-digit", timeZoneName: "short",
  }).format(instant);
}

/** Available instants (ISO) on one account-zone calendar day. Rendered by the
 *  client in the BOOKER's own zone; this just answers "what's free", in UTC
 *  instants — the zone the client renders them in is a display choice made
 *  downstream, not something this action needs to know. */
export async function getSlotsAction(
  publicId: string, dayIso: string,
): Promise<{ slots: string[] } | { error: string }> {
  try {
    if (!DAY_KEY_RE.test(dayIso)) return { error: m["booking.public.genericError"] };

    const db = serviceDb();
    const calendar = await getCalendarByPublicId(db, publicId);
    if (!calendar || !calendar.enabled) return { error: m["booking.public.genericError"] };

    const account = await loadAccount(db, calendar.account_id);
    const timezone = account?.timezone ?? "UTC";

    const now = new Date();
    const all = await computeAllSlots(db, calendar, timezone, now);
    const wanted = all.filter((s) => dayKeyInZone(s.startsAt, timezone) === dayIso);
    return { slots: wanted.map((s) => s.startsAt.toISOString()) };
  } catch (e) {
    console.error(`getSlotsAction ${publicId} (${dayIso}) failed: ${String(e)}`);
    return { error: m["booking.public.genericError"] };
  }
}

/**
 * The public booking submit path. Same three properties as
 * `f/[publicId]/actions.ts`'s `submitFormAction`, applied to a calendar
 * instead of a form:
 *
 *  1. `accountId` comes off the calendar row, never the request — this
 *     endpoint is unauthenticated and uses the service-role client.
 *  2. Every guard below runs before any write. Bad input (missing name,
 *     invalid email) is checked first, same anti-oracle reasoning
 *     `submitFormAction` documents: a spam guard running first would let a
 *     bot learn which hidden field is the honeypot by watching whether a
 *     request with a blank required field flips the response.
 *  3. Once `createBooking` succeeds the slot is real and the cancelToken is
 *     minted — nothing after that point may cost the booker a response that
 *     says they are NOT booked when they are. Conversation/thread work and
 *     both sends are therefore best-effort from there on, exactly the split
 *     `enrich()`/`notify()` draw in the sibling action.
 */
export async function submitBookingAction(publicId: string, formData: FormData): Promise<BookingResult> {
  try {
    const db = serviceDb();
    const calendar = await getCalendarByPublicId(db, publicId);
    if (!calendar || !calendar.enabled) return { ok: false, error: m["booking.public.genericError"] };

    const h = await headers();
    const ipHash = hashIp(clientIp(h));

    const firstName = str(formData, "firstName");
    const lastName = str(formData, "lastName");
    const email = str(formData, "email");
    const phone = str(formData, "phone");
    const note = str(formData, "note");
    const startsAtRaw = str(formData, "slotStartsAt");
    const bookerTimezone = str(formData, "bookerTimezone") || undefined;

    // --- Real errors, for real people, before any spam guard -------------
    if (!firstName || !email || !startsAtRaw) {
      return { ok: false, error: m["booking.public.required"] };
    }
    if (!isValidEmail(email)) return { ok: false, error: m["booking.public.invalidEmail"] };
    if (phone && !isValidPhone(phone)) return { ok: false, error: m["booking.public.invalidPhone"] };

    // --- Guards on well-formed input --------------------------------------
    // Rate limit first: the only guard below that bounds anything, and the
    // branch a real bot reaches most often — same ordering `submitFormAction`
    // pins and for the same reason.
    const windowStart = new Date(Date.now() - RATE_LIMIT_WINDOW_MS).toISOString();
    if (await countRecentBookings(db, calendar.id, ipHash, windowStart) >= RATE_LIMIT_MAX) {
      return { ok: false, error: m["booking.public.genericError"] };
    }

    if (str(formData, HONEYPOT_FIELD) !== "") {
      // Same body a genuine accept gets, and zero writes — a bot watching for
      // a response that flips on the honeypot learns nothing. There is no
      // real booking, so no real cancelUrl exists to hand back; empty is
      // harmless here because a person filling this form in good faith does
      // not hit this branch.
      return { ok: true, cancelUrl: "" };
    }

    const token = verifyRenderToken(str(formData, RENDER_TOKEN_FIELD), Date.now(), publicId);
    if (!token.ok || token.elapsedMs < MIN_FILL_MS) {
      return { ok: true, cancelUrl: "" };
    }

    // --- The booking --------------------------------------------------
    const account = await loadAccount(db, calendar.account_id);
    const timezone = account?.timezone ?? "UTC";

    const startsAt = new Date(startsAtRaw);
    if (Number.isNaN(startsAt.getTime())) return { ok: false, error: m["booking.public.genericError"] };
    const endsAt = new Date(startsAt.getTime() + calendar.slot_duration_minutes * 60_000);

    const created = await createContact(db, calendar.account_id, {
      firstName, lastName: lastName || undefined, email, phone: phone || undefined,
      source: "booking",
    }, ACTOR_ID, ACTOR_TYPE);
    const contactId = created.id;

    // App-level re-check: a friendly "just taken" message with fresh slots,
    // computed the exact same way the picker itself was. `bookings_no_overlap`
    // below is the actual guarantee against a race that lands between this
    // check and the insert — this only saves a doomed write in the common case.
    const now = new Date();
    const stillFree = (await computeAllSlots(db, calendar, timezone, now)).some(
      (s) => s.startsAt.getTime() === startsAt.getTime() && s.endsAt.getTime() === endsAt.getTime(),
    );
    if (!stillFree) return { ok: false, error: m["booking.public.slotTaken"], slotTaken: true };

    let bookingId: string;
    let cancelToken: string;
    try {
      ({ id: bookingId, cancelToken } = await createBooking(db, calendar.account_id, {
        calendarId: calendar.id, contactId, startsAt, endsAt,
        note: note || undefined, bookerTimezone, ipHash,
      }, ACTOR_ID, ACTOR_TYPE));
    } catch (e) {
      if (e instanceof SlotTakenError) {
        return { ok: false, error: m["booking.public.slotTaken"], slotTaken: true };
      }
      throw e;
    }

    const whenCompanyZone = formatWhen(startsAt, timezone);
    const whenBookerZone = formatWhen(startsAt, bookerTimezone || timezone);
    const contactName = [firstName, lastName].filter(Boolean).join(" ").trim() || email;

    // --- Best-effort from here: the booking is real. ----------------------
    try {
      const convo = await ensureConversation(db, calendar.account_id, contactId, ACTOR_ID, ACTOR_TYPE);
      const body = [`Booking: ${whenCompanyZone}`, ...(note ? [`Note: ${note}`] : [])].join("\n");
      await createMessage(db, calendar.account_id, {
        conversationId: convo.id, channel: "form", direction: "inbound",
        subject: "Booking", body,
      }, ACTOR_ID, ACTOR_TYPE);
      await incrementUnreadCount(db, calendar.account_id, convo.id);
    } catch (e) {
      console.error(`booking ${bookingId} conversation/thread failed: ${String(e)}`);
    }

    const brand = emailBrand({
      brandName: account?.brand_name ?? null, brandLogoPath: account?.brand_logo_path ?? null,
      brandColor: account?.brand_color ?? null, brandNeutral: account?.brand_neutral ?? null,
      brandCorners: account?.brand_corners ?? null, brandType: account?.brand_type ?? null,
      brandMode: account?.brand_mode ?? null, replyToEmail: null,
    }, account?.name ?? "BIS");

    const origin = originFrom(h);
    const provider = getEmailProvider();

    if (calendar.notify_emails.length > 0) {
      const contactUrl = origin ? `${origin}/dashboard/accounts/${calendar.account_id}/contacts/${contactId}` : null;
      const { html, text } = bookingAlertEmail({
        brand, whenCompanyZone, contactName, note: note || null, contactUrl,
      });
      const failures: string[] = [];
      for (const to of calendar.notify_emails) {
        try {
          // No fromAddress: the same deliverability reasoning as the lead
          // alert (spec §3) — this message goes to the CLIENT'S OWN staff,
          // and sending client-domain-to-client-domain through a third-party
          // sender is the shape corporate filters treat as spoofing.
          await provider.send({ to, fromName: brand.name, subject: `New booking: ${contactName}`, body: text, html });
        } catch (e) {
          failures.push(`${to} (${e instanceof Error ? e.message : String(e)})`);
        }
      }
      if (failures.length > 0) {
        console.error(`booking ${bookingId} alert send failed for ${failures.join(", ")}`);
      }
    }

    // Verbatim per spec: `originFrom` can legitimately return null (a request
    // with no host header), which template-literal-coerces to the string
    // "null" here rather than a relative path. Known, accepted gap — the
    // confirmation's `cancelUrl` field is not optional the way the lead
    // alert's `contactUrl` is, and every real request Vercel forwards to this
    // route carries a host.
    const cancelUrl = `${origin}/b/${publicId}/cancel/${cancelToken}`;
    try {
      const { html, text } = bookingConfirmationEmail({ brand, whenBookerZone, whenCompanyZone, cancelUrl });
      await provider.send({
        to: email, fromName: brand.name, fromAddress: account?.from_email ?? undefined,
        replyTo: normalizeReplyTo(account?.reply_to_email), subject: "You're booked in",
        body: text, html,
      });
    } catch (e) {
      console.error(`booking ${bookingId} confirmation send failed: ${String(e)}`);
    }

    return { ok: true, cancelUrl };
  } catch (e) {
    console.error(`submitBookingAction ${publicId} failed: ${String(e)}`);
    return { ok: false, error: m["booking.public.genericError"] };
  }
}
