// The ONE session shape, used FLAT (not nested under `session`) by the SIP
// accept endpoint — nesting it is the documented way to get a silent 4xx.
import { readTurnDetection } from "./turn-detection";
import { toolSchemas } from "./tools/schemas";
import { buildSystemPrompt } from "./system-prompt";

export const REALTIME_MODEL = process.env.REALTIME_MODEL || "gpt-realtime";

export type VoicePromptInput = {
  personaName: string; businessName: string; greeting: string;
  facts: string; services: string;
  languages: "en" | "es" | "both";
  bookingEnabled: boolean;
  timezone: string; slotDurationMinutes: number;
  afterHours: "hours_then_message" | "message_only";
  callerNumber: string | null;
};

export function buildRealtimeSessionConfig(input: VoicePromptInput, now: Date) {
  return {
    type: "realtime",
    model: REALTIME_MODEL,
    instructions: buildSystemPrompt(input, now),
    tools: toolSchemas(input.bookingEnabled),
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
