"use server";

import { headers } from "next/headers";
import {
  serviceDb, getCalendarByPublicId, createContact, fillContactBlanks, createBooking, SlotTakenError,
  countRecentBookings, ensureConversation, createMessage,
  incrementUnreadCount,
} from "@bis/db";
import { sendEmailOrThrow } from "@/lib/consent/email-gate";
import { getMeetingProvider } from "@/lib/meetings/provider";
import { normalizeReplyTo } from "@/lib/email/reply-to";
import { originFrom } from "@/lib/email/origin";
import { emailBrand } from "@/lib/email/templates/shell";
import { bookingAlertEmail, bookingConfirmationEmail } from "@/lib/email/templates/booking";
import { composeBookingAlertSms, formatAlertWhen, sendAlertSms } from "@/lib/sms/alerts";
import { resolveLocale, type Locale } from "@/lib/i18n/locale";
import { safeZone, formatWhen } from "@/lib/booking/time";
import { computeAllSlots, bookableSlot, dayKeyInZone } from "@/lib/booking/availability";
import {
  HONEYPOT_FIELD, RENDER_TOKEN_FIELD, MIN_FILL_MS, RATE_LIMIT_MAX, RATE_LIMIT_WINDOW_MS,
  verifyRenderToken, hashIp, isValidEmail, isValidPhone, parseAttribution,
} from "@/lib/forms/guards";
// The SAME helper the sibling public-form action uses, not a re-implementation
// (I3) — see its docstring in that file for why it is exported.
import { setAttribution } from "@/lib/forms/enrich";
import { normalizeLocale } from "@/lib/forms/public-strings";
import { bookingStrings } from "@/lib/booking/public-strings";
import { bookingConfirmationSubject } from "@/lib/email/templates/booking";
import { recordBookingGrant } from "@/lib/consent/grants";
import { calendarFileUrl } from "@/lib/booking/calendar-file";
import { bookingMoveUrl } from "@/lib/booking/links";

export type BookingResult =
  /** `confirmationSent` (D-033): true only once the email gate said the
   *  booker's confirmation was SENT. The success screen claims an email only
   *  when it is true. */
  /** `calendarUrl` (F-048): the add-to-calendar file, "" when there is no
   *  origin to build it on — the same empty-means-omit shape as `cancelUrl`. */
  | { ok: true; cancelUrl: string; calendarUrl: string; confirmationSent: boolean }
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
 *  submit-time recheck (`bookableSlot` in `submitBookingAction`), so a
 *  transient failure that fell back quietly would make picker and recheck
 *  agree on the wrong zone rather than disagree: a 09:00-17:00 business
 *  becomes bookable at 03:00 local with nothing to catch it, because both
 *  reads made the identical wrong assumption. The outer try/catch in each
 *  caller already returns the safe answer (a generic error, zero writes) for
 *  anything this throws — see `submitFormAction`'s equivalent `setAttribution`
 *  in the sibling form action for the same throw-don't-swallow reasoning. */
async function loadAccount(db: ReturnType<typeof serviceDb>, accountId: string) {
  const { data, error } = await db.from("accounts")
    .select("timezone, from_email, reply_to_email, brand_name, brand_logo_path, "
      + "brand_color, brand_neutral, brand_corners, brand_type, brand_mode, alert_phone, language")
    .eq("id", accountId).maybeSingle();
  if (error) throw new Error(`loadAccount(${accountId}) failed: ${error.message}`);
  return data as {
    timezone: string | null;
    from_email: string | null; reply_to_email: string | null;
    brand_name: string | null; brand_logo_path: string | null; brand_color: string | null;
    brand_neutral: "warm" | "cool" | "slate" | null;
    brand_corners: "sharp" | "soft" | "round" | null;
    brand_type: "geist" | "inter" | "serif" | null;
    brand_mode: "light" | "dark" | "follow" | null;
    // 0035_alert_phone.sql: the ONE number bookings text when work arrives.
    // NULL is "off," not an error — see sendAlertSms (@/lib/sms/alerts).
    alert_phone: string | null;
    // F-013 (Task 8, Spanish-runtime lane): the account's own language, read
    // for the staff booking-alert SMS below — never the booker's own
    // `?locale=` (the `locale` local variable in this file), which answers a
    // different question (what language the CUSTOMER'S confirmation is in).
    language: Locale | null;
  } | null;
}

/** Available instants (ISO) on one account-zone calendar day. Rendered by the
 *  client in the BOOKER's own zone; this just answers "what's free", in UTC
 *  instants — the zone the client renders them in is a display choice made
 *  downstream, not something this action needs to know. */
export async function getSlotsAction(
  publicId: string, locale: string, dayIso: string,
): Promise<{ slots: string[] } | { error: string }> {
  // Bound by page.tsx from the resolved `?locale=`, but a server action is a
  // public endpoint: an unknown value is English, never an exception.
  const s = bookingStrings(normalizeLocale(locale, "en"));
  try {
    if (!DAY_KEY_RE.test(dayIso)) return { error: s.genericError };

    const db = serviceDb();
    const calendar = await getCalendarByPublicId(db, publicId);
    if (!calendar || !calendar.enabled) return { error: s.genericError };

    const account = await loadAccount(db, calendar.account_id);
    const timezone = account?.timezone ?? "UTC";

    const now = new Date();
    const all = await computeAllSlots(db, calendar, timezone, now);
    const wanted = all.filter((s) => dayKeyInZone(s.startsAt, timezone) === dayIso);
    return { slots: wanted.map((s) => s.startsAt.toISOString()) };
  } catch (e) {
    console.error(`getSlotsAction ${publicId} (${dayIso}) failed: ${String(e)}`);
    return { error: s.genericError };
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
  // Read before the try: the outer catch below answers in this language too.
  // The hidden `locale` field the page posts, normalised exactly as the
  // sibling form action normalises its own — a crafted value is English.
  const locale = normalizeLocale(String(formData.get("locale") ?? ""), "en");
  const s = bookingStrings(locale);
  try {
    const db = serviceDb();
    const calendar = await getCalendarByPublicId(db, publicId);
    if (!calendar || !calendar.enabled) return { ok: false, error: s.genericError };

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
      return { ok: false, error: s.required };
    }
    if (!isValidEmail(email)) return { ok: false, error: s.invalidEmail };
    if (phone && !isValidPhone(phone)) return { ok: false, error: s.invalidPhone };

    // --- Guards on well-formed input --------------------------------------
    // Rate limit first: the only guard below that bounds anything, and the
    // branch a real bot reaches most often — same ordering `submitFormAction`
    // pins and for the same reason.
    const windowStart = new Date(Date.now() - RATE_LIMIT_WINDOW_MS).toISOString();
    if (await countRecentBookings(db, calendar.id, ipHash, windowStart) >= RATE_LIMIT_MAX) {
      return { ok: false, error: s.genericError };
    }

    if (str(formData, HONEYPOT_FIELD) !== "") {
      // Same body a genuine accept gets, and zero writes — a bot watching for
      // a response that flips on the honeypot learns nothing. There is no
      // real booking, so no real cancelUrl exists to hand back; empty is
      // harmless here because a person filling this form in good faith does
      // not hit this branch. `confirmationSent: true` for the same reason:
      // a real accept nearly always says true, so the fake says it too.
      return { ok: true, cancelUrl: "", calendarUrl: "", confirmationSent: true };
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
        return { ok: false, error: s.tokenExpired };
      }
      // `malformed`/`bad_signature` stay folded into the shared fake success —
      // unlike `expired`, there is no real visitor on the other end of those.
      return { ok: true, cancelUrl: "", calendarUrl: "", confirmationSent: true };
    }
    if (token.elapsedMs < MIN_FILL_MS) {
      return { ok: true, cancelUrl: "", calendarUrl: "", confirmationSent: true };
    }

    // --- The booking --------------------------------------------------
    const account = await loadAccount(db, calendar.account_id);
    const timezone = account?.timezone ?? "UTC";
    const bookerZone = safeZone(bookerTimezoneRaw, timezone);

    const startsAt = new Date(startsAtRaw);
    if (Number.isNaN(startsAt.getTime())) return { ok: false, error: s.genericError };

    // App-level re-check BEFORE any write (I2): a rejected instant must never
    // leave a contact row behind. This used to run after `createContact`,
    // which meant every "just taken" reply still injected a CRM row — no
    // booking, no trail beyond a name/email/phone written by whoever last hit
    // the button, 5-10 minutes apart, one IP. `bookableSlot` is the one
    // submit-time rule every booking path runs: free, fits, notice, horizon,
    // and a start the engine offers under some state of the day — NOT "is it
    // in the picker's current list", which a booking earlier in the day can
    // shift (D-028's review). `bookings_no_overlap` below is the actual
    // guarantee against a race that lands between this check and the insert —
    // this only saves a doomed write in the common case.
    const now = new Date();
    const bookable = await bookableSlot(db, calendar, timezone, now, startsAt);
    if (!bookable) return { ok: false, error: s.slotTaken, slotTaken: true };
    const { endsAt } = bookable;

    // Video room, minted before the booking row exists (Task 3). No
    // ordering requirement forces this after `createBooking`: the real
    // provider's room-naming is NOT derived from `bookingId` (see
    // `daily.ts` — it uses `crypto.randomUUID()`), so `publicId` (the
    // calendar's, not a booking's — there is no booking yet) stands in for
    // the interface's `bookingId` field. THE PIN: a provider that is absent
    // (video is optional — `getMeetingProvider()` returns null when
    // unconfigured) or that THROWS must never cost anyone their booking —
    // this is best-effort, exactly like the emails below, one call, one
    // try/catch, `meetingUrl` simply stays `undefined` on either path. Never
    // logs the url, on failure (there isn't one to log) OR on success (there
    // is, and a room link needs no story about how it got into a log).
    let meetingUrl: string | undefined;
    if (calendar.meeting_type === "video") {
      const meetingProvider = getMeetingProvider();
      if (meetingProvider) {
        try {
          ({ url: meetingUrl } = await meetingProvider.createMeetingRoom({ bookingId: publicId, endsAt }));
        } catch (e) {
          console.error(`booking ${publicId}: createMeetingRoom failed: ${String(e)}`);
        }
      }
    }

    const created = await createContact(db, calendar.account_id, {
      firstName, lastName: lastName || undefined, email,
      // AS TYPED (review R2-C1): createContact's phoneFields stores the
      // E.164 when it parses, as typed when it does not, and flags ten digits
      // that could be Mexican or US. Pre-normalising here would store
      // "55 1234 5678" as a confirmed +1 and the gate would text it.
      phone: phone || undefined,
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
        note: note || undefined, bookerTimezone: bookerZone, ipHash, meetingUrl,
      }, ACTOR_ID, ACTOR_TYPE));
    } catch (e) {
      if (e instanceof SlotTakenError) {
        return { ok: false, error: s.slotTaken, slotTaken: true };
      }
      throw e;
    }

    // D-031: a RETURNING booker's new details fill the blanks on the contact
    // the dedupe found — a first phone number, a surname — and never
    // overwrite what is there. The forms path's rule (`fillBlanks`,
    // lib/forms/enrich.ts), through its exported twin in @bis/db. The phone
    // goes AS TYPED, the same R2-C1 rule as `createContact` above: the
    // write's own `phoneFields` judges it. A value that DIFFERS from the one
    // on file is not written; the thread below carries what was typed, so it
    // is not lost either. Only AFTER the insert succeeded (review minor): a
    // booker who loses the slot race made no booking, so nothing of theirs is
    // written onto a contact the dedupe matched. Best-effort, its own try:
    // the booking is already real and must never become a reported failure.
    if (created.existing) {
      try {
        await fillContactBlanks(db, calendar.account_id, contactId, {
          firstName, lastName: lastName || undefined, email, phone: phone || undefined,
        }, ACTOR_ID, ACTOR_TYPE);
      } catch (e) {
        console.error(`booking ${publicId}: fillContactBlanks failed for contact ${contactId}: ${String(e)}`);
      }
    }

    // Consent chain PR-2 (decision 8): a booking made with a phone is a grant.
    // Evidence only, never throws (lib/consent/grants.ts). As typed, so the
    // ledger keys the number the contact row stores.
    await recordBookingGrant(db, { accountId: calendar.account_id, bookingId, contactId, phoneAsTyped: phone || null });

    const contactName = [firstName, lastName].filter(Boolean).join(" ").trim() || email;

    // --- Best-effort from here: the booking is real. `whenCompanyZone`/
    // `whenBookerZone` are computed INSIDE this same try (C2): both zones are
    // validated by construction (`timezone` is the account's own row,
    // `bookerZone` already passed `safeZone`'s identical `Intl.DateTimeFormat`
    // probe), but this keeps it true by structure rather than by trust — a
    // formatting failure here can no longer escape to the outer catch and turn
    // a successful insert into a reported failure. -------------------------
    // `whenCompanyZone` is operator-facing (the alert, the thread) and stays
    // English; the two `*ForBooker` strings are the same instants in the
    // booker's own language, for the one email the booker reads.
    let whenCompanyZone = "";
    let whenBookerZone = "";
    let whenCompanyZoneForBooker = "";
    try {
      whenCompanyZone = formatWhen(startsAt, timezone);
      whenBookerZone = formatWhen(startsAt, bookerZone, locale);
      whenCompanyZoneForBooker = formatWhen(startsAt, timezone, locale);
      const convo = await ensureConversation(db, calendar.account_id, contactId, ACTOR_ID, ACTOR_TYPE);
      // The details as the booker TYPED them (D-031), the way a form
      // submission's thread lists every answer: for a returning booker these
      // can differ from what the contact holds, and the fill above never
      // overwrites — this line is where staff see the difference.
      const body = [
        `Booking: ${whenCompanyZone}`,
        `Email: ${email}`,
        ...(phone ? [`Phone: ${phone}`] : []),
        ...(note ? [`Note: ${note}`] : []),
      ].join("\n");
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
    //
    // The cancel page reads `?locale=` the way this page does, so a Spanish
    // booker's link opens a Spanish page. English is the page's default and
    // carries no parameter, which keeps every existing link and test intact.
    const cancelUrl = originFrom(h)
      ? `${originFrom(h)}/b/${publicId}/cancel/${cancelToken}${locale === "es" ? "?locale=es" : ""}`
      : "";
    // F-048: the booking's add-to-calendar file, on the same origin and
    // token as the cancel link, in the booker's language.
    const calendarUrl = calendarFileUrl(originFrom(h), publicId, cancelToken, locale);
    // F-048: where the booker moves this booking themselves (the move page
    // beside the cancel page). Email only: the success screen's cancel link
    // opens the cancel page, which offers the move too.
    const moveUrl = bookingMoveUrl(originFrom(h), publicId, cancelToken, locale);

    // Everything below is best-effort, structurally, not just by convention:
    // a send through the email gate THROWS (`EmailNotSent`) when the
    // provider is missing or refuses (consent PR-3; `sendEmailOrThrow`).
    // Uncaught, that exception used to reach the outer catch at the bottom of this function
    // and turn an already-committed booking into a reported "Something went
    // wrong" — the booking stayed real, the booker was told it wasn't, and
    // nobody (not the client's staff, not the booker) was ever notified. One
    // try around brand/origin/provider/the alert loop/the confirmation keeps
    // ANY post-insert failure here — not just a single recipient's send,
    // which already has its own catch below — from ever reaching that outer
    // catch again.
    //
    // D-033: whether the CONFIRMATION went is the one fact out of this block
    // the booker is told about. It flips only after `sendEmailOrThrow`
    // returns for that send (it throws on every not-sent answer), so a throw
    // anywhere earlier in the block leaves it false too.
    let confirmationSent = false;
    try {
      const brand = emailBrand({
        brandName: account?.brand_name ?? null, brandLogoPath: account?.brand_logo_path ?? null,
        brandColor: account?.brand_color ?? null, brandNeutral: account?.brand_neutral ?? null,
        brandCorners: account?.brand_corners ?? null, brandType: account?.brand_type ?? null,
        brandMode: account?.brand_mode ?? null, replyToEmail: null,
      });

      const origin = originFrom(h);

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
            await sendEmailOrThrow({
              accountId: calendar.account_id, kind: "operator.booking_alert",
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

      const { html, text } = bookingConfirmationEmail({
        brand, locale, whenBookerZone, whenCompanyZone: whenCompanyZoneForBooker, cancelUrl, meetingUrl, calendarUrl, moveUrl,
      });
      await sendEmailOrThrow({
        // The customer-initiated kind (spec §4.3): it answers what the booker
        // just did, so an unsubscribe never stops it — and it still carries
        // the way out (consent PR-3).
        accountId: calendar.account_id, kind: "booking.confirmation", contactId, language: locale, origin,
        to: email, fromName: brand.name, fromAddress: account?.from_email ?? undefined,
        replyTo: normalizeReplyTo(account?.reply_to_email), subject: bookingConfirmationSubject(locale),
        body: text, html,
      });
      confirmationSent = true;
    } catch (e) {
      console.error("booking emails failed", e);
    }

    // The SMS twin of the alert email above — ALONGSIDE it, never instead
    // (danlo, 2026-09-15). Its own try/catch even though `sendAlertSms`
    // (@/lib/sms/alerts) never throws by contract: the booking above is
    // already real, and nothing past this point may turn it into a reported
    // failure — the same reasoning the email block's own try carries. Reads
    // `account?.alert_phone`: the field IS the switch (0035_alert_phone.sql)
    // — `sendAlertSms` no-ops on null, so no separate guard is needed here.
    //
    // `calendar.notify_emails.length > 0` tells `composeBookingAlertSms`
    // whether its no-name fallback may promise "check email" — a calendar
    // with no notify emails never got one (alert-send-report follow-up
    // review, finding 3). Guarded on `whenCompanyZone` being non-empty too:
    // it is set inside the try above and stays "" if `formatWhen` itself
    // threw, and an empty when-string would otherwise read as "New booking:
    //  - Maria Lopez." on a real handset (same review, minors).
    try {
      if (whenCompanyZone) {
        // The account's OWN language — never `locale` above, which is the
        // BOOKER's `?locale=` choice for their own confirmation email.
        const alertLanguage = resolveLocale(undefined, account?.language ?? null);
        await sendAlertSms(
          db, calendar.account_id, account?.alert_phone ?? null,
          composeBookingAlertSms(
            // Owner decision B: the date in the ACCOUNT's language too —
            // for Spanish "sab 17 oct, 3:00 p.m. CDT", accents dropped so the
            // text stays GSM-7. English is byte-identical to
            // `whenCompanyZone`, which the email and the thread keep using.
            formatAlertWhen(startsAt, timezone, alertLanguage),
            contactName, calendar.notify_emails.length > 0, alertLanguage,
          ),
        );
      }
    } catch (e) {
      console.error(`booking ${bookingId} alert SMS failed: ${String(e)}`);
    }

    return { ok: true, cancelUrl, calendarUrl, confirmationSent };
  } catch (e) {
    console.error(`submitBookingAction ${publicId} failed: ${String(e)}`);
    return { ok: false, error: s.genericError };
  }
}
