// apps/web/src/lib/voice/tools/registry.ts
import {
  serviceDb,
  findUpcomingBookingForPhone,
  createContact, fillContactBlanks, getContact,
  createBooking, SlotTakenError, setBookingStatus, getBookingById,
  type CalendarRow, type VoiceProfileRow, type Branding,
} from "@bis/db";
import { computeAllSlots, dayKeyInZone } from "@/lib/booking/availability";
import { toE164 } from "../phone-number";
import { getEmailProvider } from "@/lib/email";
import { getMeetingProvider } from "@/lib/meetings/provider";
import { emailBrand } from "@/lib/email/templates/shell";
import { bookingConfirmationEmail, bookingRescheduledEmail } from "@/lib/email/templates/booking";
import { normalizeReplyTo } from "@/lib/email/reply-to";
import { isValidEmail } from "@/lib/forms/guards";
import { formatWhen } from "@/lib/booking/time";
import {
  type CallState, withLead, withMessage, withTranscript, withBooking, withBookingCancelled,
  withServed,
} from "../call-state";

export type ToolName =
  | "check_availability" | "book_appointment" | "reschedule_appointment"
  | "cancel_appointment" | "find_my_booking"
  | "capture_lead" | "take_message" | "log_transcript";

export interface ToolContext {
  db: ReturnType<typeof serviceDb>;
  accountId: string; accountName: string; timezone: string;
  calendar: CalendarRow;
  profile: VoiceProfileRow;
  branding: Branding; fromEmail: string | null;
  callerNumber: string | null;
  origin: string;
  now?: () => Date;
}

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const REQUIRED_LEAD_FIELDS = ["fullName", "need"] as const;

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

    case "find_my_booking": {
      const phone = toE164(String(args?.phone ?? "")) ?? ctx.callerNumber;
      if (!phone) return { state, result: { found: false } };
      const hit = await findUpcomingBookingForPhone(ctx.db, ctx.accountId, phone, now.toISOString());
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
          const brand = emailBrand(ctx.branding, ctx.accountName);
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
      await setBookingStatus(ctx.db, ctx.accountId, bookingId, "cancelled", "voice");

      // 2026-08-29 (final-review Important): this used to end here, silently —
      // a same-day VIDEO reschedule left the customer holding the OLD
      // confirmation's link to a room nobody would be in, with the new link
      // existing nowhere a customer could see it. The contact's email isn't in
      // call state (find_my_booking matched by phone), so it's read from the
      // contact row. Everything below is best-effort with the same invariant
      // as book_appointment's send: the reschedule is already committed, so
      // email trouble is a soft `emailFailed` flag for the model to voice,
      // never a hard `ok:false` on a booking the caller now holds.
      let emailFailed = false;
      let contactEmail: string | null = null;
      try {
        const contact = await getContact(ctx.db, ctx.accountId, old.contact_id);
        contactEmail = (contact?.email ?? "").trim() || null;
      } catch (e) {
        // Can't tell whether an email was on file, so flag rather than stay
        // silent — for a video caller this is exactly the "your new link
        // never arrived" case the flag exists to voice.
        emailFailed = true;
        console.error(`voice reschedule ${newId}: contact lookup failed: ${String(e)}`);
      }
      if (contactEmail) {
        try {
          const brand = emailBrand(ctx.branding, ctx.accountName);
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
        } catch (e) {
          emailFailed = true;
          console.error(`voice reschedule ${newId}: confirmation email failed: ${String(e)}`);
        }
      }

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
      await setBookingStatus(ctx.db, ctx.accountId, bookingId, "cancelled", "voice");
      // `withBookingCancelled` alone is not enough to remember this happened:
      // it maps over `state.bookings`, which is EMPTY when the booking was
      // made on an earlier call — the ordinary case for a cancellation. The
      // served flag is what survives that, and it is what stops a caller we
      // served perfectly from being texted "Sorry we missed you just now".
      return { state: withServed(withBookingCancelled(state, bookingId), "cancelled"), result: { ok: true } };
    }

    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}
