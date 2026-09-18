import type { CallOutcome, TranscriptEvent } from "@bis/db";

/**
 * Outcomes that never propose anything.
 *
 * `spam` is a robocall or a connect timeout; `abandoned` is a caller who
 * hung up before anything happened. Neither supports a next step.
 *
 * ⚠️ This differs deliberately from `summary-service.ts:26-29`, which
 * still calls the model for an `abandoned` call because "its stored
 * summary is the only account anywhere of why a real human rang and left".
 * A summary is a RECORD of what happened; a proposal is an ACTION someone
 * is asked to take. Recording a call nobody completed is useful; proposing
 * work from it is inventing it.
 */
const SKIP_OUTCOMES: readonly CallOutcome[] = ["spam", "abandoned"] as const;

/**
 * True when this finished call may be proposed from at all.
 *
 * Most calls should propose nothing, and that is the design target rather
 * than a fallback: a feature that suggests something every time trains a
 * client to dismiss without reading, which is worse than silence.
 */
export function callIsEligible(input: {
  outcome: CallOutcome;
  transcript: TranscriptEvent[];
  handoffRequested: boolean;
}): boolean {
  // FIRST, and independent of the outcome string. A call where the caller
  // asked for a person has a transcript that stops at the handoff —
  // "what was said afterwards is not here" (summarize.ts:80). Whatever was
  // agreed with the human is invisible to us, so any proposal would be
  // built on the half of the call we heard, and would sit beside a real
  // conversation it contradicts.
  if (input.handoffRequested) return false;
  if (SKIP_OUTCOMES.includes(input.outcome)) return false;
  return input.transcript.some((e) => e.role === "caller" && e.text.trim().length > 0);
}
