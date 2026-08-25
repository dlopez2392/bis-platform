// apps/web/src/lib/voice/tools/registry.ts
import {
  serviceDb,
  findUpcomingBookingForPhone,
  createContact, createBooking, SlotTakenError, setBookingStatus, getBookingById,
  type CalendarRow, type VoiceProfileRow, type Branding,
} from "@bis/db";
import { computeAllSlots, dayKeyInZone } from "@/lib/booking/availability";
import { toE164 } from "../phone-number";
import { getEmailProvider } from "@/lib/email";
import { emailBrand } from "@/lib/email/templates/shell";
import { bookingConfirmationEmail } from "@/lib/email/templates/booking";
import { normalizeReplyTo } from "@/lib/email/reply-to";
import { formatWhen } from "@/lib/booking/time";
import {
  type CallState, withLead, withMessage, withTranscript, withBooking, withBookingCancelled,
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
  state: CallState, ctx: ToolContext, name: ToolName, args: any,
): Promise<{ state: CallState; result: unknown }> {
  const now = ctx.now?.() ?? new Date();
  switch (name) {
    case "check_availability": {
      const date = String(args?.date ?? "");
      if (!DAY_RE.test(date)) {
        return { state, result: { ok: false, error: "date must be YYYY-MM-DD" } };
      }
      const all = await computeAllSlots(ctx.db, ctx.calendar, ctx.timezone, now);
      const slots = all
        .filter((s) => dayKeyInZone(s.startsAt, ctx.timezone) === date)
        .slice(0, 20)
        .map((s) => s.startsAt.toISOString());
      return { state, result: { slots } };
    }

    case "find_my_booking": {
      const phone = toE164(args?.phone) ?? ctx.callerNumber;
      if (!phone) return { state, result: { found: false } };
      const hit = await findUpcomingBookingForPhone(ctx.db, ctx.accountId, phone, now.toISOString());
      return { state, result: hit ? { found: true, ...hit } : { found: false } };
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
      const callbackNumber = toE164(args?.callbackNumber) ?? ctx.callerNumber ?? undefined;
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

      const phone = toE164(args?.phone) ?? ctx.callerNumber;
      const email = String(args?.email ?? "").trim() || null;
      if (!phone && !email) {
        return { state, result: { ok: false, error: "need a phone number or an email to book" } };
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
      }

      let bookingId: string; let cancelToken: string;
      try {
        ({ id: bookingId, cancelToken } = await createBooking(ctx.db, ctx.accountId, {
          calendarId: ctx.calendar.id, contactId,
          startsAt: slot.startsAt, endsAt: slot.endsAt,
          note: String(args?.notes ?? "").trim() || undefined,
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
            brand, whenBookerZone: whenCompanyZone, whenCompanyZone, cancelUrl,
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
      return { state: next, result: { ok: true, bookingId, startsAt: slot.startsAt.toISOString(), ...(emailFailed ? { emailFailed: true } : {}) } };
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
      // Book the NEW slot first — never leave the caller with nothing.
      let newId: string;
      try {
        ({ id: newId } = await createBooking(ctx.db, ctx.accountId, {
          calendarId: old.calendar_id, contactId: old.contact_id,
          startsAt: slot.startsAt, endsAt: slot.endsAt,
        }, "voice", "ai"));
      } catch (e) {
        if (e instanceof SlotTakenError) return { state, result: { ok: false, slotTaken: true, error: "that time was just taken" } };
        throw e;
      }
      await setBookingStatus(ctx.db, ctx.accountId, bookingId, "cancelled", "voice");
      const next = withBooking(
        { ...state, bookings: state.bookings.filter((b) => b.id !== bookingId) },
        { id: newId, contactName: "", startsAt: slot.startsAt.toISOString(), endsAt: slot.endsAt.toISOString() },
      );
      return { state: next, result: { ok: true, bookingId: newId, startsAt: slot.startsAt.toISOString() } };
    }

    case "cancel_appointment": {
      const bookingId = String(args?.bookingId ?? "");
      const row = bookingId ? await getBookingById(ctx.db, ctx.accountId, bookingId) : null;
      if (!row || row.status !== "booked") {
        return { state, result: { ok: false, error: "no such booking — use find_my_booking first" } };
      }
      await setBookingStatus(ctx.db, ctx.accountId, bookingId, "cancelled", "voice");
      return { state: withBookingCancelled(state, bookingId), result: { ok: true } };
    }

    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}
