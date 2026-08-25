// apps/web/src/lib/voice/tools/registry.ts
import {
  serviceDb,
  findUpcomingBookingForPhone,
  type CalendarRow, type VoiceProfileRow, type Branding,
} from "@bis/db";
import { computeAllSlots, dayKeyInZone } from "@/lib/booking/availability";
import { toE164 } from "../phone-number";
import {
  type CallState, withLead, withMessage, withTranscript,
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

    case "book_appointment":
    case "reschedule_appointment":
    case "cancel_appointment":
      // Implemented in Task 7 (bookAppointmentTool / rescheduleTool / cancelTool).
      return { state, result: { ok: false, error: "booking is not available yet" } };

    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}
