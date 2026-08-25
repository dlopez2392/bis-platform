"use server";

import { headers } from "next/headers";
import {
  serviceDb, getCalendarByPublicId, createContact, createBooking, SlotTakenError,
  countRecentBookings, ensureConversation, createMessage,
  incrementUnreadCount, type CalendarRow,
} from "@bis/db";
import { getEmailProvider } from "@/lib/email";
import { normalizeReplyTo } from "@/lib/email/reply-to";
import { originFrom } from "@/lib/email/origin";
import { emailBrand } from "@/lib/email/templates/shell";
import { bookingAlertEmail, bookingConfirmationEmail } from "@/lib/email/templates/booking";
import { safeZone, formatWhen } from "@/lib/booking/time";
import { computeAllSlots, dayKeyInZone } from "@/lib/booking/availability";
import {
  HONEYPOT_FIELD, RENDER_TOKEN_FIELD, MIN_FILL_MS, RATE_LIMIT_MAX, RATE_LIMIT_WINDOW_MS,
  verifyRenderToken, hashIp, isValidEmail, isValidPhone, parseAttribution,
} from "@/lib/forms/guards";
// The SAME helper the sibling public-form action uses, not a re-implementation
// (I3) — see its docstring in that file for why it is exported.
import { setAttribution } from "@/app/f/[publicId]/actions";
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

// Bounds on the public fields this route persists or emails. Slice, not
// reject — an over-long value is not a spam signal, it's still a real booking
// worth taking. `note` matches `f/[publicId]/actions.ts`'s `collect()`
// precedent exactly (5000 there is per-answer on a form with many fields;
// 2000 here is the one free-text field on a booking). `bookerTimezone` is
// deliberately absent from this map — its own bound is `safeZone`'s 64-char
// cap below, enforced by rejecting outright rather than truncating a zone
// name into a different, wrong one.
const FIELD_MAX: Record<string, number> = {
  firstName: 500, lastName: 500, email: 500, phone: 500, note: 2000,
};

function str(formData: FormData, key: string): string {
  const raw = String(formData.get(key) ?? "").trim();
  const max = FIELD_MAX[key];
  return max ? raw.slice(0, max) : raw;
}

/** Strips characters that could inject additional lines into a rendered
 *  email subject. A crafted contact name carrying `\r`/`\n`/`\t` is still a
 *  valid name for the booking itself — only the subject line needs this. */
function stripSubjectControlChars(value: string): string {
  return value.replace(/[\r\n\t]+/g, " ");
}

const DAY_KEY_RE = /^\d{4}-\d{2}-\d{2}$/;

/** The account row every send below needs — timezone for both re-validating
 *  availability and formatting the company-zone when-string, the rest for
 *  branding and the confirmation's from/reply-to. One row, several jobs, the
 *  same economy `notify()` in the sibling form action takes.
 *
 *  THROWS on a query error rather than silently falling back to UTC — this
 *  row's `timezone` feeds BOTH the picker (`getSlotsAction`) and the
 *  submit-time recheck (`computeAllSlots` in `submitBookingAction`), so a
 *  transient failure that fell back quietly would make picker and recheck
 *  agree on the wrong zone rather than disagree: a 09:00-17:00 business
 *  becomes bookable at 03:00 local with nothing to catch it, because both
 *  reads made the identical wrong assumption. The outer try/catch in each
 *  caller already returns the safe answer (a generic error, zero writes) for
 *  anything this throws — see `submitFormAction`'s equivalent `setAttribution`
 *  in the sibling form action for the same throw-don't-swallow reasoning. */
async function loadAccount(db: ReturnType<typeof serviceDb>, accountId: string) {
  const { data, error } = await db.from("accounts")
    .select("name, timezone, from_email, reply_to_email, brand_name, brand_logo_path, "
      + "brand_color, brand_neutral, brand_corners, brand_type, brand_mode")
    .eq("id", accountId).maybeSingle();
  if (error) throw new Error(`loadAccount(${accountId}) failed: ${error.message}`);
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
    // Untrusted until `safeZone` validates it below, against the account's
    // own zone as fallback — a crafted or malformed value here must never
    // reach `Intl.DateTimeFormat` after the booking write below has already
    // committed (C2).
    const bookerTimezoneRaw = str(formData, "bookerTimezone") || undefined;
    // Lifted from the host page by embed.js, passed through by `page.tsx`
    // and `booking-page.tsx`'s hidden `attribution` field — the exact shape
    // `f/[publicId]/actions.ts`'s own `submitFormAction` decodes (I3).
    // Re-run through `parseAttribution` here too: the hidden input is a
    // plain form value, editable in devtools like any other, so this is the
    // real allow-list/length boundary, not the one `page.tsx` already applied.
    const attribution = parseAttribution(new URLSearchParams(str(formData, "attribution")));

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
    if (!token.ok) {
      // A genuinely expired token is not a spam signal — it is a real visitor
      // who left the tab open past MAX_TOKEN_AGE_MS. Returning the shared fake
      // success here (as `f/[publicId]/actions.ts` documents for its own
      // identical branch) would tell them "You're booked in." with zero writes:
      // no booking, no confirmation, and the slot silently withheld from
      // everyone else too. Telling them to refresh leaks nothing a bot doesn't
      // already know — `issuedAt` is plaintext in the token it holds.
      if (token.reason === "expired") {
        return { ok: false, error: m["booking.public.tokenExpired"] };
      }
      // `malformed`/`bad_signature` stay folded into the shared fake success —
      // unlike `expired`, there is no real visitor on the other end of those.
      return { ok: true, cancelUrl: "" };
    }
    if (token.elapsedMs < MIN_FILL_MS) {
      return { ok: true, cancelUrl: "" };
    }

    // --- The booking --------------------------------------------------
    const account = await loadAccount(db, calendar.account_id);
    const timezone = account?.timezone ?? "UTC";
    const bookerZone = safeZone(bookerTimezoneRaw, timezone);

    const startsAt = new Date(startsAtRaw);
    if (Number.isNaN(startsAt.getTime())) return { ok: false, error: m["booking.public.genericError"] };
    const endsAt = new Date(startsAt.getTime() + calendar.slot_duration_minutes * 60_000);

    // App-level re-check BEFORE any write (I2): a rejected instant must never
    // leave a contact row behind. This used to run after `createContact`,
    // which meant every "just taken" reply still injected a CRM row — no
    // booking, no trail beyond a name/email/phone written by whoever last hit
    // the button, 5-10 minutes apart, one IP. Friendly message with fresh
    // slots, computed the exact same way the picker itself was;
    // `bookings_no_overlap` below is the actual guarantee against a race that
    // lands between this check and the insert — this only saves a doomed
    // write in the common case.
    const now = new Date();
    const stillFree = (await computeAllSlots(db, calendar, timezone, now)).some(
      (s) => s.startsAt.getTime() === startsAt.getTime() && s.endsAt.getTime() === endsAt.getTime(),
    );
    if (!stillFree) return { ok: false, error: m["booking.public.slotTaken"], slotTaken: true };

    const created = await createContact(db, calendar.account_id, {
      firstName, lastName: lastName || undefined, email, phone: phone || undefined,
      source: "booking",
    }, ACTOR_ID, ACTOR_TYPE);
    const contactId = created.id;

    // Best-effort, its own try/catch, deliberately BEFORE the booking insert
    // below rather than folded into the "Best-effort from here" block after
    // it: attribution belongs to the CONTACT, not to any one booking attempt,
    // and `created.existing` — which decides first-touch vs. last-touch — is
    // only available right here. Losing it must never cost anyone their
    // booking, exactly the reasoning `f/[publicId]/actions.ts`'s own call
    // documents; unlike that caller's `enrich()`, there is no
    // `processing_error` column on `bookings` to route this into, so it is
    // logged instead.
    try {
      await setAttribution(db, calendar.account_id, contactId, attribution, !created.existing);
    } catch (e) {
      console.error(`booking ${publicId}: setAttribution failed for contact ${contactId}: ${String(e)}`);
    }

    let bookingId: string;
    let cancelToken: string;
    try {
      ({ id: bookingId, cancelToken } = await createBooking(db, calendar.account_id, {
        calendarId: calendar.id, contactId, startsAt, endsAt,
        note: note || undefined, bookerTimezone: bookerZone, ipHash,
      }, ACTOR_ID, ACTOR_TYPE));
    } catch (e) {
      if (e instanceof SlotTakenError) {
        return { ok: false, error: m["booking.public.slotTaken"], slotTaken: true };
      }
      throw e;
    }

    const contactName = [firstName, lastName].filter(Boolean).join(" ").trim() || email;

    // --- Best-effort from here: the booking is real. `whenCompanyZone`/
    // `whenBookerZone` are computed INSIDE this same try (C2): both zones are
    // validated by construction (`timezone` is the account's own row,
    // `bookerZone` already passed `safeZone`'s identical `Intl.DateTimeFormat`
    // probe), but this keeps it true by structure rather than by trust — a
    // formatting failure here can no longer escape to the outer catch and turn
    // a successful insert into a reported failure. -------------------------
    let whenCompanyZone = "";
    let whenBookerZone = "";
    try {
      whenCompanyZone = formatWhen(startsAt, timezone);
      whenBookerZone = formatWhen(startsAt, bookerZone);
      const convo = await ensureConversation(db, calendar.account_id, contactId, ACTOR_ID, ACTOR_TYPE);
      const body = [`Booking: ${whenCompanyZone}`, ...(note ? [`Note: ${note}`] : [])].join("\n");
      await createMessage(db, calendar.account_id, {
        conversationId: convo.id, channel: "form", direction: "inbound",
        subject: "Booking", body,
      }, ACTOR_ID, ACTOR_TYPE);
      await incrementUnreadCount(db, calendar.account_id, convo.id);
    } catch (e) {
      console.error(`booking ${bookingId} conversation/thread/formatting failed: ${String(e)}`);
    }

    // `originFrom` can legitimately return null (a request with no host
    // header); the naive template literal used to coerce that into the
    // literal string "null" landing in a sent confirmation email
    // ("null/b/.../cancel/..."). Guarded rather than defaulted to some
    // relative path: `booking-page.tsx` already renders the cancel hint
    // without a link when `cancelUrl` is "" (the same empty string the
    // honeypot/too-fast branches above already return), so this reuses an
    // existing, already-handled shape instead of inventing a new one.
    //
    // Computed here, above the email try below, and from a function that
    // cannot throw (`originFrom` only reads headers, never builds a
    // provider) — the booking is already real by this point (`createBooking`
    // above committed), so the response this action returns must carry a
    // real cancelUrl regardless of whether anything past this line succeeds.
    const cancelUrl = originFrom(h) ? `${originFrom(h)}/b/${publicId}/cancel/${cancelToken}` : "";

    // Everything below is best-effort, structurally, not just by convention:
    // `getEmailProvider()` THROWS the moment RESEND_API_KEY/EMAIL_FROM is
    // missing or rotated in production (see `preflight.ts`). Uncaught, that
    // exception used to reach the outer catch at the bottom of this function
    // and turn an already-committed booking into a reported "Something went
    // wrong" — the booking stayed real, the booker was told it wasn't, and
    // nobody (not the client's staff, not the booker) was ever notified. One
    // try around brand/origin/provider/the alert loop/the confirmation keeps
    // ANY post-insert failure here — not just a single recipient's send,
    // which already has its own catch below — from ever reaching that outer
    // catch again.
    try {
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
            await provider.send({
              to, fromName: brand.name,
              // Time first (spec §6): the operator triages a list of these,
              // and the time is what they scan for, not the name.
              // `whenCompanyZone` is server-computed from a real timestamp
              // (never attacker input) so only the name needs stripping.
              subject: `New booking: ${whenCompanyZone} — ${stripSubjectControlChars(contactName)}`,
              body: text, html,
            });
          } catch (e) {
            failures.push(`${to} (${e instanceof Error ? e.message : String(e)})`);
          }
        }
        if (failures.length > 0) {
          console.error(`booking ${bookingId} alert send failed for ${failures.join(", ")}`);
        }
      }

      const { html, text } = bookingConfirmationEmail({ brand, whenBookerZone, whenCompanyZone, cancelUrl });
      await provider.send({
        to: email, fromName: brand.name, fromAddress: account?.from_email ?? undefined,
        replyTo: normalizeReplyTo(account?.reply_to_email), subject: "You're booked in",
        body: text, html,
      });
    } catch (e) {
      console.error("booking emails failed", e);
    }

    return { ok: true, cancelUrl };
  } catch (e) {
    console.error(`submitBookingAction ${publicId} failed: ${String(e)}`);
    return { ok: false, error: m["booking.public.genericError"] };
  }
}
