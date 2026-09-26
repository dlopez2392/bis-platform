// apps/web/src/lib/voice/tools/registry.ts
import {
  serviceDb,
  findUpcomingBookingForPhone,
  createContact, fillContactBlanks, getContact,
  createBooking, SlotTakenError, setBookingStatus, getBookingById,
  markHandoffRequested,
  ensureConversation, createMessage, incrementUnreadCount,
  type CalendarRow, type VoiceProfileRow, type Branding,
} from "@bis/db";
import { computeAllSlots, dayKeyInZone } from "@/lib/booking/availability";
import { toE164 } from "../phone-number";
import { getEmailProvider } from "@/lib/email";
import { getMeetingProvider } from "@/lib/meetings/provider";
import { emailBrand } from "@/lib/email/templates/shell";
import {
  bookingConfirmationEmail, bookingRescheduledEmail,
  bookingPhoneChangeAlertEmail, bookingCancelledEmail, bookingCancelledSubject,
} from "@/lib/email/templates/booking";
import { normalizeReplyTo } from "@/lib/email/reply-to";
import { isValidEmail } from "@/lib/forms/guards";
import { formatWhen } from "@/lib/booking/time";
import {
  type CallState, withLead, withMessage, withTranscript, withBooking, withBookingCancelled,
  withServed, withTransferred,
} from "../call-state";
import { detectSpokenLanguage } from "../language";
import type { HandoffTarget } from "../handoff";

export type ToolName =
  | "check_availability" | "book_appointment" | "reschedule_appointment"
  | "cancel_appointment" | "find_my_booking"
  | "capture_lead" | "take_message" | "log_transcript"
  | "transfer_to_human";

/**
 * DELIBERATELY ABSENT: `accountName`. `accounts.name` is the agency's internal
 * label ("Rio Roofing — trial"); the confirmation and reschedule emails below
 * resolve the customer-facing name from `branding` alone (`brandDisplayName`,
 * through `emailBrand`), so there is no label here for a tool to leak.
 */
export interface ToolContext {
  db: ReturnType<typeof serviceDb>;
  accountId: string; timezone: string;
  calendar: CalendarRow;
  profile: VoiceProfileRow;
  branding: Branding; fromEmail: string | null;
  callerNumber: string | null;
  origin: string;
  /**
   * The `calls` row opened at accept — NULL when `startCallRow` failed open
   * (route.ts step 10). `transfer_to_human` is the one tool that cannot work
   * without it: the handoff route finds this call by its row, and a transfer
   * it can never find is a caller left in silence.
   */
  callRowId: string | null;
  /** Where a caller who asks for a person can go, resolved once at accept. */
  handoffTarget: HandoffTarget;
  now?: () => Date;
}

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const REQUIRED_LEAD_FIELDS = ["fullName", "need"] as const;

/**
 * What a refused booking lookup or change offers the caller instead: a person
 * when this call has somewhere to send them, otherwise a message. The same
 * `handoffTarget.available` decides whether `transfer_to_human` is on the
 * session at all (`toolSchemas`), so a refusal never names a tool the model
 * was not given.
 */
function nextStep(ctx: ToolContext): string {
  return ctx.handoffTarget.available
    ? "offer to put them through to someone on the team with transfer_to_human"
    : "offer to take a message with take_message";
}

/** The contact fields the booking tools read. `getContact` is untyped. */
type BookingContact = {
  first_name: string | null; last_name: string | null;
  email: string | null; phone: string | null;
};

/**
 * Booking tools are bound to the verified caller. A booking may be moved or
 * cancelled on this call only when EITHER
 *   (a) it was made on this call — `state.bookings` is written only by
 *       book_appointment and reschedule_appointment, from ids the database
 *       returned, never from anything the model passes; OR
 *   (b) the call shows a caller ID and the booking's contact's phone IS it.
 *       `contacts.phone` is stored as typed ("(956) 292-1696" from a web
 *       form), so it is normalized with `toE164` before the compare — a raw
 *       string compare would refuse the rightful caller.
 *
 * Checked before anything is looked up, written or sent. The contact is read
 * ONCE, here, and handed back for the notifications that follow a change. A
 * read that fails fails CLOSED: nothing changes on a booking we could not
 * check. Logged by booking id only.
 */
async function checkCallerOwnsBooking(
  state: CallState, ctx: ToolContext, tool: "cancel" | "reschedule",
  bookingId: string, contactId: string,
): Promise<{ owned: true; contact: BookingContact | null } | { owned: false; error: string }> {
  let contact: BookingContact | null;
  try {
    contact = (await getContact(ctx.db, ctx.accountId, contactId)) as BookingContact | null;
  } catch (e) {
    console.error(`voice ${tool} ${bookingId}: contact lookup failed, nothing changed: ${String(e)}`);
    return { owned: false, error:
      "The appointment couldn't be checked right now, so nothing was changed. "
      + `Apologize, then ${nextStep(ctx)} so the team can help.` };
  }
  const bookedThisCall = state.bookings.some((b) => b.id === bookingId);
  const callerIdMatches = !!ctx.callerNumber && toE164(contact?.phone) === ctx.callerNumber;
  if (!bookedThisCall && !callerIdMatches) {
    return { owned: false, error:
      "This appointment isn't under the number they're calling from, so it can't be changed on this call. "
      + "Do not share any of its details. "
      + `Apologize, then ${nextStep(ctx)} so the team can confirm who they are and help.` };
  }
  return { owned: true, contact };
}

// ─── Telling the business about a change made by phone ─────────────────────
//
// A cancel-only call classifies `abandoned`, so finishCall alerts nobody, and
// a customer whose booking was cancelled on a call used to hear nothing
// either. After every successful phone cancel or reschedule, three
// independent legs run: a staff alert, a line in the contact's thread (the
// in-app signal that exists even with no notify emails), and the customer's
// own email. All best-effort — the change is already committed — and none of
// them logs the caller's number, a name, a URL, or an address on success.

// Same attribution finishCall uses: every write here is the AI's, never a
// signed-in user's.
const ACTOR_ID = "voice";
const ACTOR_TYPE = "ai";

/** What changed. `oldStartsAt` is the booking row's own start. */
type PhoneChange =
  | { kind: "cancelled"; oldStartsAt: string }
  | { kind: "moved"; oldStartsAt: string; newStartsAt: Date };

function contactDisplayName(contact: BookingContact | null): string {
  return [contact?.first_name, contact?.last_name].filter(Boolean).join(" ").trim() || "Someone";
}

/** The caller's language for the customer email; an unset profile is English. */
function spokenLocale(state: CallState, ctx: ToolContext): "en" | "es" {
  return detectSpokenLanguage(state.transcript, ctx.profile.languages) === "es" ? "es" : "en";
}

/**
 * The legs run side by side and are all awaited before the tool answers: the
 * caller is waiting on the line, so serial sends are dead air, and an
 * un-awaited promise is a notification lost when the call ends. Each leg
 * catches and logs its own failure; this is the net for anything that
 * escapes one anyway.
 */
async function settleLegs<T extends readonly unknown[] | []>(
  tool: "cancel" | "reschedule", bookingId: string, legs: T,
): Promise<{ -readonly [P in keyof T]: PromiseSettledResult<Awaited<T[P]>> }> {
  const settled = await Promise.allSettled(legs);
  for (const s of settled as PromiseSettledResult<unknown>[]) {
    if (s.status === "rejected") {
      console.error(`voice ${tool} ${bookingId}: a notification step failed unexpectedly: ${String(s.reason)}`);
    }
  }
  return settled;
}

/**
 * One staff alert per notify address. `ctx.calendar` IS the booking's
 * calendar: one calendar per account is schema (`calendars_one_per_account`).
 */
async function alertStaffOfPhoneChange(
  ctx: ToolContext, tool: "cancel" | "reschedule", bookingId: string, contactId: string,
  change: PhoneChange, contact: BookingContact | null,
): Promise<void> {
  const recipients = ctx.calendar.notify_emails ?? [];
  if (recipients.length === 0) return;
  try {
    const brand = emailBrand(ctx.branding);
    const { subject, html, text } = bookingPhoneChangeAlertEmail({
      brand, kind: change.kind,
      whenCompanyZone: formatWhen(new Date(change.oldStartsAt), ctx.timezone),
      newWhenCompanyZone: change.kind === "moved" ? formatWhen(change.newStartsAt, ctx.timezone) : undefined,
      contactName: contactDisplayName(contact),
      callerNumber: ctx.callerNumber,
      contactUrl: `${ctx.origin}/dashboard/accounts/${ctx.accountId}/contacts/${contactId}`,
    });
    // Throws synchronously when mail config is missing — inside this try.
    const provider = getEmailProvider();
    const failures: string[] = [];
    await Promise.all(recipients.map(async (to) => {
      try {
        // No fromAddress: this goes to the client's OWN staff, and a
        // client-domain-to-client-domain send through a third-party sender
        // reads as spoofing to corporate filters. Platform From only.
        await provider.send({ to, fromName: brand.name, subject, body: text, html });
      } catch (e) {
        failures.push(`${to} (${e instanceof Error ? e.message : String(e)})`);
      }
    }));
    if (failures.length > 0) {
      console.error(`voice ${tool} ${bookingId}: staff alert failed for ${failures.join(", ")}`);
    }
  } catch (e) {
    console.error(`voice ${tool} ${bookingId}: staff alert setup failed: ${String(e)}`);
  }
}

/** The line in the contact's thread, mirroring the public cancel link's. */
async function recordPhoneChangeInThread(
  ctx: ToolContext, tool: "cancel" | "reschedule", bookingId: string, contactId: string,
  change: PhoneChange,
): Promise<void> {
  try {
    const oldWhen = formatWhen(new Date(change.oldStartsAt), ctx.timezone);
    const subject = change.kind === "moved" ? "Booking moved by phone" : "Booking cancelled by phone";
    const body = change.kind === "moved"
      ? `Moved their booking from ${oldWhen} to ${formatWhen(change.newStartsAt, ctx.timezone)}`
      : `Cancelled their ${oldWhen} booking`;
    const convo = await ensureConversation(ctx.db, ctx.accountId, contactId, ACTOR_ID, ACTOR_TYPE);
    await createMessage(ctx.db, ctx.accountId, {
      conversationId: convo.id, channel: "voice", direction: "inbound", subject, body,
    }, ACTOR_ID, ACTOR_TYPE);
    await incrementUnreadCount(ctx.db, ctx.accountId, convo.id);
  } catch (e) {
    console.error(`voice ${tool} ${bookingId}: conversation trail failed: ${String(e)}`);
  }
}

export async function runTool(
  state: CallState, ctx: ToolContext, name: ToolName, args: Record<string, unknown>,
): Promise<{ state: CallState; result: unknown }> {
  const now = ctx.now?.() ?? new Date();
  switch (name) {
    // Every time a tool result names leaves this file twice: `startsAt`
    // (ISO, what other tool calls take) and a `local`/`startsAtLocal`
    // rendering in the ACCOUNT's zone, which is what the model SAYS.
    // 2026-08-30 live call: the model rescheduled to the caller's asked-for
    // 4 PM, re-read the result's raw ISO with the wrong UTC offset, decided
    // it had hit the wrong slot, and silently moved a correct booking an
    // hour forward. The model's own timezone math is a coin flip; these
    // renderings make it unnecessary, and the prompt forbids it.
    case "check_availability": {
      const date = String(args?.date ?? "");
      if (!DAY_RE.test(date)) {
        return { state, result: { ok: false, error: "date must be YYYY-MM-DD" } };
      }
      const all = await computeAllSlots(ctx.db, ctx.calendar, ctx.timezone, now);
      const slots = all
        .filter((s) => dayKeyInZone(s.startsAt, ctx.timezone) === date)
        .slice(0, 20)
        .map((s) => ({
          startsAt: s.startsAt.toISOString(),
          local: formatWhen(s.startsAt, ctx.timezone),
        }));
      return { state, result: { slots } };
    }

    // Booking tools are bound to the verified caller: caller ID is the only
    // identity. A number the caller recites is never looked up — the schema
    // no longer declares one, and a stray `phone` arg (models do send
    // undeclared args) that is not the caller ID is refused, not queried.
    // Every refusal leaves `state` untouched: nothing was found for anyone.
    case "find_my_booking": {
      if (!ctx.callerNumber) {
        return { state, result: { found: false, verified: false, error:
          "This call has no visible caller number, so appointments can't be looked up on it — not by a number the caller says, either. "
          + `Apologize, then ${nextStep(ctx)} so the team can help them.` } };
      }
      const recited = String(args?.phone ?? "").trim();
      if (recited && toE164(recited) !== ctx.callerNumber) {
        return { state, result: { found: false, verified: false, error:
          "Appointments can only be looked up for the number they are calling from, and that is not the number they gave. "
          + "Do not confirm, read out, change or cancel anything for another number. "
          + `Tell them they can call back from the phone the appointment is under, or ${nextStep(ctx)} so the team can help them.` } };
      }
      const hit = await findUpcomingBookingForPhone(ctx.db, ctx.accountId, ctx.callerNumber, now.toISOString());
      // `found: false` is NOT served: we looked and told the caller we had
      // nothing for them, which is the same empty-handed ending the text-back
      // exists for. Only a lookup that actually produced their appointment
      // counts.
      if (!hit) return { state, result: { found: false } };
      return { state: withServed(state, "booking_found"), result: {
        found: true, ...hit,
        startsAtLocal: formatWhen(new Date(hit.startsAt), ctx.timezone),
      } };
    }

    case "capture_lead": {
      const fields: Record<string, string> = {};
      const raw = (args?.fields && typeof args.fields === "object") ? args.fields : {};
      for (const [k, v] of Object.entries(raw)) fields[k] = String(v ?? "").trim();
      if (!fields.callbackNumber && ctx.callerNumber) fields.callbackNumber = ctx.callerNumber;
      const missing = REQUIRED_LEAD_FIELDS.filter((f) => !fields[f]);
      if (missing.length > 0) return { state, result: { ok: false, missing } };
      return { state: withLead(state, { fields }), result: { ok: true } };
    }

    case "take_message": {
      const body = String(args?.body ?? "").trim();
      if (!body) return { state, result: { ok: false, error: "message body required" } };
      const callbackNumber = toE164(String(args?.callbackNumber ?? "")) ?? ctx.callerNumber ?? undefined;
      return {
        state: withMessage(state, { body, callbackNumber, at: now.toISOString() }),
        result: { ok: true },
      };
    }

    case "log_transcript": {
      const role = args?.role === "assistant" ? "assistant" : "caller";
      return {
        state: withTranscript(state, { role, text: String(args?.text ?? ""), at: now.toISOString() }),
        result: { ok: true },
      };
    }

    case "book_appointment": {
      const name = String(args?.name ?? "").trim();
      if (!name) return { state, result: { ok: false, error: "name required" } };

      // Checked before the phone/email refusal below: a caller who DID give a
      // phone number but garbled it deserves "say that again", not the generic
      // "need a phone or email" — those are different problems for the model
      // to voice differently.
      const rawPhone = String(args?.phone ?? "").trim();
      if (rawPhone && !toE164(rawPhone)) {
        return {
          state,
          result: { ok: false, error: "That phone number doesn't look complete — could you give it to me again?" },
        };
      }

      const phone = toE164(String(args?.phone ?? "")) ?? ctx.callerNumber;
      const email = String(args?.email ?? "").trim() || null;
      if (!phone && !email) {
        return { state, result: { ok: false, error: "need a phone number or an email to book" } };
      }

      // The email offer is enforced HERE, not just in the prompt. Three real
      // calls on 2026-08-28 booked without the offer ever being made, under
      // two differently-structured prompts — prose loses to flow momentum,
      // but the model reliably corrects on tool results (slot-taken, garbled
      // phone). So: no email and no explicit declined-attestation = no
      // booking, and the error tells the model exactly what to do.
      if (!email && args?.emailDeclined !== true) {
        return {
          state,
          result: {
            ok: false,
            error: "Not booked yet. First ask the caller whether they would like an email confirmation — that is where the written confirmation and the cancellation link go. Then call book_appointment again with their email, or with emailDeclined: true if they said no.",
          },
        };
      }

      // Video calendars are stricter still: `emailDeclined: true` is NOT an
      // escape hatch here — there is no meeting link without an address to
      // send it to, and no video call without the link. This runs AFTER the
      // gate above (not merged into it) so a caller who never mentioned email
      // at all still gets the generic "ask them" nudge first; only once the
      // model has attested a decline does this more specific refusal fire.
      if (ctx.calendar.meeting_type === "video") {
        if (!email) {
          return { state, result: { ok: false,
            error: "This is a video appointment — an email is required for the meeting link. If the caller cannot give one, do not book: use take_message so a human can arrange it." } };
        }
        // A gate on non-empty alone let a garbled address ("no", a typo
        // missing the @, etc.) through and mint a booking whose confirmation
        // — the ONLY place the meeting link lives — could never be delivered.
        // Same shape rule the public booking form already enforces
        // (`isValidEmail`, `@/lib/forms/guards`), applied here on the video
        // path specifically because a bad address is silent failure for a
        // video booking in a way it isn't for phone-only ones.
        if (!isValidEmail(email)) {
          return { state, result: { ok: false,
            error: "That email address doesn't look right for the video meeting link. Read it back to the caller character by character — including confirming whether \"plus\" means a literal + sign — then call book_appointment again." } };
        }
      }

      const wanted = String(args?.startsAt ?? "");
      const all = await computeAllSlots(ctx.db, ctx.calendar, ctx.timezone, now);
      const slot = all.find((s) => s.startsAt.toISOString() === new Date(wanted).toISOString());
      if (!slot) return { state, result: { ok: false, error: "that time isn't available — offer one from check_availability" } };

      let contactId = state.contactId;
      if (!contactId) {
        const space = name.lastIndexOf(" ");
        const firstName = space > 0 ? name.slice(0, space) : name;
        const lastName = space > 0 ? name.slice(space + 1) : undefined;
        const created = await createContact(ctx.db, ctx.accountId,
          { firstName, lastName, phone: phone ?? undefined, email: email ?? undefined, source: "voice" },
          "voice", "ai");
        contactId = created.id;
        if (created.existing) {
          // Dedupe returns the existing row untouched — backfill blanks so a
          // repeat caller stops being "Caller" with no email (the unsendable-
          // reminder casualty). Failure here must NEVER fail the booking.
          try {
            await fillContactBlanks(ctx.db, ctx.accountId, contactId,
              { firstName, lastName, email: email ?? undefined, phone: phone ?? undefined },
              "voice", "ai");
          } catch (e) {
            console.error(`voice fillContactBlanks failed for ${contactId}: ${String(e)}`);
          }
        }
      }

      // Video room, mirroring `b/[publicId]/actions.ts`'s Task 3 pin: a
      // provider that is absent (unconfigured) or that THROWS must never
      // cost anyone their booking — best-effort, one call, one try/catch,
      // `meetingUrl` simply stays `undefined` on either path. Never logs the
      // url, on failure (there isn't one) or on success (no story needed).
      let meetingUrl: string | undefined;
      if (ctx.calendar.meeting_type === "video") {
        const meetingProvider = getMeetingProvider();
        if (meetingProvider) {
          try {
            ({ url: meetingUrl } = await meetingProvider.createMeetingRoom(
              { bookingId: ctx.calendar.public_id, endsAt: slot.endsAt }));
          } catch (e) {
            console.error(`voice booking: createMeetingRoom failed for calendar ${ctx.calendar.id}: ${String(e)}`);
          }
        }
      }

      let bookingId: string; let cancelToken: string;
      try {
        ({ id: bookingId, cancelToken } = await createBooking(ctx.db, ctx.accountId, {
          calendarId: ctx.calendar.id, contactId,
          startsAt: slot.startsAt, endsAt: slot.endsAt,
          note: String(args?.notes ?? "").trim() || undefined,
          meetingUrl,
        }, "voice", "ai"));
      } catch (e) {
        if (e instanceof SlotTakenError) {
          return { state: { ...state, contactId }, result: { ok: false, slotTaken: true, error: "that time was just taken — offer another" } };
        }
        throw e;
      }

      let emailFailed = false;
      if (email) {
        try {
          const brand = emailBrand(ctx.branding);
          const whenCompanyZone = formatWhen(slot.startsAt, ctx.timezone);
          const cancelUrl = `${ctx.origin}/b/${ctx.calendar.public_id}/cancel/${cancelToken}`;
          const { html, text } = bookingConfirmationEmail({
            brand, whenBookerZone: whenCompanyZone, whenCompanyZone, cancelUrl, meetingUrl,
          });
          await getEmailProvider().send({
            to: email, fromName: brand.name, fromAddress: ctx.fromEmail ?? undefined,
            replyTo: normalizeReplyTo(ctx.branding.replyToEmail),
            subject: "You're booked in", body: text, html,
          });
        } catch (e) {
          // A sent booking must never be reported as failed: the row exists,
          // the caller has a time — only the confirmation email is missing,
          // and that is a soft flag, never a hard `ok:false`.
          emailFailed = true;
          console.error(`voice booking ${bookingId}: confirmation email failed: ${String(e)}`);
        }
      }

      const next = withBooking({ ...state, contactId }, {
        id: bookingId, contactName: name,
        startsAt: slot.startsAt.toISOString(), endsAt: slot.endsAt.toISOString(),
      });
      return { state: next, result: {
        ok: true, bookingId,
        startsAt: slot.startsAt.toISOString(),
        startsAtLocal: formatWhen(slot.startsAt, ctx.timezone),
        ...(emailFailed ? { emailFailed: true } : {}),
      } };
    }

    case "reschedule_appointment": {
      const bookingId = String(args?.bookingId ?? "");
      const old = bookingId ? await getBookingById(ctx.db, ctx.accountId, bookingId) : null;
      if (!old || old.status !== "booked") {
        return { state, result: { ok: false, error: "no such booking — use find_my_booking first" } };
      }
      // Ownership BEFORE the slot lookup, the room and both writes.
      const owner = await checkCallerOwnsBooking(state, ctx, "reschedule", bookingId, old.contact_id);
      if (!owner.owned) return { state, result: { ok: false, error: owner.error } };

      const wanted = String(args?.startsAt ?? "");
      const all = await computeAllSlots(ctx.db, ctx.calendar, ctx.timezone, now);
      const slot = all.find((s) => s.startsAt.toISOString() === new Date(wanted).toISOString());
      if (!slot) return { state, result: { ok: false, error: "that time isn't available" } };

      // Video calendars need a NEW room sized to the NEW slot — the old
      // row's room expires at the OLD endsAt+1h, so it is never reused or
      // copied forward here. Same best-effort idiom as book_appointment,
      // five lines up in that case: an absent or throwing provider never
      // costs the caller their reschedule, `meetingUrl` simply stays
      // `undefined` on either path, and neither path ever logs a url.
      let meetingUrl: string | undefined;
      if (ctx.calendar.meeting_type === "video") {
        const meetingProvider = getMeetingProvider();
        if (meetingProvider) {
          try {
            ({ url: meetingUrl } = await meetingProvider.createMeetingRoom(
              { bookingId: ctx.calendar.public_id, endsAt: slot.endsAt }));
          } catch (e) {
            console.error(`voice reschedule: createMeetingRoom failed for calendar ${ctx.calendar.id}: ${String(e)}`);
          }
        }
      }

      // Book the NEW slot first — never leave the caller with nothing.
      let newId: string; let newCancelToken: string;
      try {
        ({ id: newId, cancelToken: newCancelToken } = await createBooking(ctx.db, ctx.accountId, {
          calendarId: old.calendar_id, contactId: old.contact_id,
          startsAt: slot.startsAt, endsAt: slot.endsAt,
          meetingUrl,
        }, "voice", "ai"));
      } catch (e) {
        if (e instanceof SlotTakenError) return { state, result: { ok: false, slotTaken: true, error: "that time was just taken" } };
        throw e;
      }
      await setBookingStatus(ctx.db, ctx.accountId, bookingId, "cancelled", "voice", "ai");

      // 2026-08-29 (final-review Important): this used to end here, silently —
      // a same-day VIDEO reschedule left the customer holding the OLD
      // confirmation's link to a room nobody would be in, with the new link
      // existing nowhere a customer could see it. The contact's email isn't in
      // call state (find_my_booking matched by phone); it comes from the
      // contact row the ownership check above already read. Everything below
      // is best-effort with the same invariant as book_appointment's send: the
      // reschedule is already committed, so email trouble is a soft
      // `emailFailed` flag for the model to voice, never a hard `ok:false` on
      // a booking the caller now holds. ONLY the customer's email sets it: the
      // staff alert and the thread line are for the business, not something
      // the model tells the caller.
      const contactEmail = (owner.contact?.email ?? "").trim() || null;
      const change = { kind: "moved" as const, oldStartsAt: old.starts_at, newStartsAt: slot.startsAt };
      const emailCustomer = async (): Promise<boolean> => {
        if (!contactEmail) return false;
        try {
          const brand = emailBrand(ctx.branding);
          const whenCompanyZone = formatWhen(slot.startsAt, ctx.timezone);
          // The NEW row's token — the old confirmation's cancel link points at
          // a booking that was just cancelled above.
          const cancelUrl = `${ctx.origin}/b/${ctx.calendar.public_id}/cancel/${newCancelToken}`;
          const { html, text } = bookingRescheduledEmail({
            brand, whenBookerZone: whenCompanyZone, whenCompanyZone, cancelUrl, meetingUrl,
          });
          await getEmailProvider().send({
            to: contactEmail, fromName: brand.name, fromAddress: ctx.fromEmail ?? undefined,
            replyTo: normalizeReplyTo(ctx.branding.replyToEmail),
            subject: "Your booking has been moved", body: text, html,
          });
          return false;
        } catch (e) {
          console.error(`voice reschedule ${newId}: confirmation email failed: ${String(e)}`);
          return true;
        }
      };
      const [, , customer] = await settleLegs("reschedule", bookingId, [
        alertStaffOfPhoneChange(ctx, "reschedule", bookingId, old.contact_id, change, owner.contact),
        recordPhoneChangeInThread(ctx, "reschedule", bookingId, old.contact_id, change),
        emailCustomer(),
      ]);
      const emailFailed = customer.status === "rejected" || customer.value;

      // `withServed` is belt-and-braces here: the mirrored booking below
      // already classifies this call `booked`, so it never reaches the
      // text-back gate today. Recorded anyway so "we served this caller" does
      // not silently depend on that unrelated mechanism holding.
      const next = withServed(withBooking(
        { ...state, bookings: state.bookings.filter((b) => b.id !== bookingId) },
        { id: newId, contactName: "", startsAt: slot.startsAt.toISOString(), endsAt: slot.endsAt.toISOString() },
      ), "rescheduled");
      return { state: next, result: {
        ok: true, bookingId: newId,
        startsAt: slot.startsAt.toISOString(),
        startsAtLocal: formatWhen(slot.startsAt, ctx.timezone),
        ...(emailFailed ? { emailFailed: true } : {}),
      } };
    }

    case "cancel_appointment": {
      const bookingId = String(args?.bookingId ?? "");
      const row = bookingId ? await getBookingById(ctx.db, ctx.accountId, bookingId) : null;
      if (!row || row.status !== "booked") {
        return { state, result: { ok: false, error: "no such booking — use find_my_booking first" } };
      }
      const owner = await checkCallerOwnsBooking(state, ctx, "cancel", bookingId, row.contact_id);
      if (!owner.owned) return { state, result: { ok: false, error: owner.error } };

      await setBookingStatus(ctx.db, ctx.accountId, bookingId, "cancelled", "voice", "ai");

      // Committed: now tell the business and the customer, best-effort. A
      // cancel's result stays exactly `{ ok: true }` — a failed customer
      // email is logged, never surfaced to the model.
      const contactEmail = (owner.contact?.email ?? "").trim() || null;
      const change = { kind: "cancelled" as const, oldStartsAt: row.starts_at };
      const emailCustomer = async (): Promise<void> => {
        if (!contactEmail) return;
        try {
          const locale = spokenLocale(state, ctx);
          const brand = emailBrand(ctx.branding);
          const { html, text } = bookingCancelledEmail({
            brand, locale, whenCompanyZone: formatWhen(new Date(row.starts_at), ctx.timezone, locale),
          });
          await getEmailProvider().send({
            to: contactEmail, fromName: brand.name, fromAddress: ctx.fromEmail ?? undefined,
            replyTo: normalizeReplyTo(ctx.branding.replyToEmail),
            subject: bookingCancelledSubject(locale), body: text, html,
          });
        } catch (e) {
          console.error(`voice cancel ${bookingId}: cancellation email failed: ${String(e)}`);
        }
      };
      await settleLegs("cancel", bookingId, [
        alertStaffOfPhoneChange(ctx, "cancel", bookingId, row.contact_id, change, owner.contact),
        recordPhoneChangeInThread(ctx, "cancel", bookingId, row.contact_id, change),
        emailCustomer(),
      ]);

      // `withBookingCancelled` alone is not enough to remember this happened:
      // it maps over `state.bookings`, which is EMPTY when the booking was
      // made on an earlier call — the ordinary case for a cancellation. The
      // served flag is what survives that, and it is what stops a caller we
      // served perfectly from being texted "Sorry we missed you just now".
      return { state: withServed(withBookingCancelled(state, bookingId), "cancelled"), result: { ok: true } };
    }

    // The caller asked for a person. Everything here happens BEFORE the model
    // is told it worked, and the order is the whole point:
    //
    //   1. is there anywhere to send them,
    //   2. is there a row the handoff route can find this call by,
    //   3. WRITE THE INTENT AND WAIT FOR IT,
    //   4. only then say yes.
    //
    // Step 3 is awaited because `finishCall` and Telnyx's request to the Dial
    // action URL run concurrently once the socket closes, and Telnyx can win.
    // An intent held only in memory — or written without waiting — would
    // transfer intermittently: the caller hears "one moment, I'll put you
    // through", the socket dies, and the action route finds no transfer and
    // hangs up on them. Intermittent is worse than never, because nobody
    // believes the bug report.
    //
    // Every refusal returns state UNTOUCHED. `withTransferred` is what stops
    // the missed-call text-back, and marking a caller transferred when they
    // were not is how someone gets no text after a call that helped nobody.
    case "transfer_to_human": {
      if (!ctx.handoffTarget.available) {
        return { state, result: { ok: false,
          error: "There's no one available to transfer to on this line. Apologize, then offer to take a message." } };
      }
      if (!ctx.callRowId) {
        return { state, result: { ok: false,
          error: "The transfer can't be set up for this call. Apologize, then offer to take a message." } };
      }
      try {
        await markHandoffRequested(ctx.db, ctx.accountId, ctx.callRowId);
      } catch (e) {
        // Loud: this is the one failure that would otherwise look exactly
        // like a caller who never asked — nothing in the row, nothing in the
        // logs, and a model that told them they were being put through.
        console.error(`voice transfer_to_human: markHandoffRequested failed for call row ${ctx.callRowId}: ${String(e)}`);
        return { state, result: { ok: false,
          error: "The transfer didn't go through. Apologize, then offer to take a message." } };
      }
      return { state: withTransferred(state), result: { ok: true } };
    }

    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}
