// apps/web/src/lib/owner-line/session-config.ts
// The owner-line session's accept body (F-032 spec §4.4). FLAT, like buildRealtimeSessionConfig
// (lib/voice/session-config.ts): nesting under `session` is the documented silent 4xx. The same model,
// transcription, voice and turn detection as the receptionist, so a real call sounds the same; its own prompt and
// ONLY its own tools, never the receptionist's (no booking, no lead, no message, no transfer).
import { REALTIME_MODEL } from "@/lib/voice/session-config";
import { readTurnDetection } from "@/lib/voice/turn-detection";
import { OWNER_TOOL_SCHEMAS } from "./tools/schemas";
import { ownerLineInstructions } from "./prompt";

/** Each owner-line call ends at 10 minutes (spec §4.4), with a spoken warning a minute before. */
export const OWNER_LINE_MAX_CALL_SECONDS = 600;

export function buildOwnerLineSessionConfig(p: Parameters<typeof ownerLineInstructions>[0]) {
  return {
    type: "realtime" as const,
    model: REALTIME_MODEL,
    instructions: ownerLineInstructions(p),
    tools: OWNER_TOOL_SCHEMAS,
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
