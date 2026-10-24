// The ONE session shape, used FLAT (not nested under `session`) by the SIP
// accept endpoint — nesting it is the documented way to get a silent 4xx.
import { readTurnDetection } from "./turn-detection";
import { toolSchemas } from "./tools/schemas";
import { buildSystemPrompt } from "./system-prompt";
import { bookingMode } from "./booking-mode";
import type { TradeModuleId } from "./modules";
import type { OpenHours } from "../booking/slots";
import type { RenderedService } from "./knowledge/payload";
import type { ClosedDayLine } from "./knowledge/closure-lines";
import type { EffectiveStatus } from "../business-status/status";

export const REALTIME_MODEL = process.env.REALTIME_MODEL || "gpt-realtime";

export type VoicePromptInput = {
  // No `greeting`: the prompt never embeds one. The phone line's opening is
  // its own instruction (`openingGreeting`, lib/voice/greeting.ts).
  personaName: string; businessName: string;
  facts: string; services: string;
  languages: "en" | "es" | "both";
  bookingEnabled: boolean;
  timezone: string; slotDurationMinutes: number;
  afterHours: "hours_then_message" | "message_only";
  callerNumber: string | null;
  meetingType: "in_person" | "phone" | "video";
  /**
   * Whether this call has somewhere to transfer a caller who asks for a
   * person. OPTIONAL and defaulting to false, which is the fail-closed
   * direction: the web demo (`api/voice/web/session`) has no phone leg to
   * hand off at all, and a caller offered a transfer that cannot happen is
   * worse off than one who was never offered it.
   */
  handoffAvailable?: boolean;
  /**
   * Which surface this conversation is happening on. OPTIONAL and defaulting
   * to "phone" so every existing caller's prompt is byte-identical — a
   * prompt change is a behaviour change on a live phone line.
   *
   * The text concierge passes "web". The browser voice demo
   * (`api/voice/web/session`) passes "web_voice": it is voice, over WebRTC,
   * and it reads the PHONE wording everywhere (`onWeb` is "web" only) except
   * the one line that is phone-line policy — "Always take a message" (owner
   * decision 2026-10-09: phone only). It keeps the `webDemoNotice` it has
   * always appended.
   */
  medium?: "phone" | "web" | "web_voice";
  /**
   * S-47a: this conversation has ALREADY been told it is talking to an AI (the phone's opening sentence,
   * or the chat's label and first message). OPTIONAL and defaulting to false, so every caller that does not
   * pass it (the browser voice demo) gets a byte-identical prompt.
   */
  disclosed?: boolean;
  /**
   * S-47b: the account's trade rules (`voice_profiles.trade_module`), or none. OPTIONAL, and absent or null
   * gives NO lines, so every existing prompt is byte-identical (pinned by system-prompt.test.ts's digest).
   * The phone route passes the value it STAMPS on the call row; the chat passes the conversation's stamp.
   */
  tradeModule?: TradeModuleId | null;
  /**
   * S-47c: the account's structured weekly hours (`voice_profiles.business_hours`, through the knowledge payload),
   * or none. OPTIONAL; absent, null or an object with no open day gives NO lines, so every existing prompt is
   * byte-identical (system-prompt.test.ts's PRE_S47C_DIGEST). The phone and the chat pass the payload's value.
   */
  businessHours?: OpenHours | null;
  /**
   * S-47c: the rendered price list (name, descriptions and the two fixed sentences), from the SAME payload the
   * call or chat is stamped with. OPTIONAL; absent, null or [] gives no lines and keeps today's HARD LIMITS line.
   */
  priceList?: RenderedService[] | null;
  /**
   * S-47c, owner decision C20: true only when the price-list READ FAILED (knowledgeFromLive's listUnavailable). The
   * HARD LIMITS price line is then the closed one (no price at all) unless the account is insurance. OPTIONAL;
   * absent or false changes nothing, so every existing prompt is byte-identical.
   */
  priceListUnavailable?: boolean;
  /**
   * S-47d (spec 5.4): today's effective status from the one switch, read LIVE at call start, at each chat turn and
   * at demo start. OPTIONAL; absent, null or an open status adds nothing, so every existing prompt is
   * byte-identical (system-prompt.test.ts's PRE_S47D_DIGEST). A closure adds the TODAY line and closes the phone
   * under "Follow business hours" (spec 5.4.2); Running late adds only the TODAY line.
   */
  businessStatus?: EffectiveStatus | null;
  /**
   * S-47d (spec 5.4, 4.2): the upcoming closed days with the lines she reads, from the SAME payload the call or
   * chat is stamped with (promptKnowledge's closedDays). OPTIONAL; absent, null or [] gives no CLOSED DAYS block.
   */
  closedDays?: ClosedDayLine[] | null;
};

export function buildRealtimeSessionConfig(input: VoicePromptInput, now: Date) {
  return {
    type: "realtime",
    model: REALTIME_MODEL,
    instructions: buildSystemPrompt(input, now),
    // `bookingMode`, not `bookingEnabled`: "Always take a message" withholds
    // the NEW-booking tool (D-040), the same answer the prompt gives.
    tools: toolSchemas(bookingMode(input), input.meetingType, input.handoffAvailable === true),
    audio: {
      input: {
        transcription: { model: "gpt-4o-mini-transcribe" },
        noise_reduction: { type: "near_field" },
        turn_detection: readTurnDetection(),
      },
      output: { voice: "marin" },
    },
  };
}
