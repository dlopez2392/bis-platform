import type { CallOutcome, TranscriptEvent } from "@bis/db";

/**
 * Outcomes that may propose a next step, mapped explicitly rather than
 * inferred from what to skip.
 *
 * A denylist admits anything it has never named. `transferred` (added in
 * migration 0037) defaulted to ELIGIBLE under the old `SKIP_OUTCOMES` list
 * with no compile-time signal — `callIsEligible({ outcome: "transferred",
 * handoffRequested: false, ... })` returned `true` — and a seventh outcome
 * would default the same way. `satisfies Record<CallOutcome, boolean>`
 * requires every member of `CallOutcome` to appear as a key here, so
 * widening the union without updating this map is a type error instead of
 * a silent admit.
 *
 * `spam` is a robocall or a connect timeout; `abandoned` is a caller who
 * hung up before anything happened; neither supports a next step.
 * `transferred` is refused here too, as a second guard beside the
 * `handoffRequested` check below.
 *
 * ⚠️ This differs deliberately from `summary-service.ts:26-29`, which
 * still calls the model for an `abandoned` call because "its stored
 * summary is the only account anywhere of why a real human rang and left".
 * A summary is a RECORD of what happened; a proposal is an ACTION someone
 * is asked to take. Recording a call nobody completed is useful; proposing
 * work from it is inventing it.
 */
const ELIGIBLE_OUTCOMES = {
  booked: true,
  lead: true,
  message: true,
  abandoned: false,
  spam: false,
  transferred: false,
} satisfies Record<CallOutcome, boolean>;

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
  // Checked regardless of what the outcome says (order is unobservable for
  // a pure boolean — this is not "first" in any behavioural sense). A call
  // where the caller asked for a person has a transcript that stops at the
  // handoff — "what was said afterwards is not here" (summarize.ts:80).
  // Whatever was agreed with the human is invisible to us, so any proposal
  // would be built on the half of the call we heard, and would sit beside a
  // real conversation it contradicts.
  if (input.handoffRequested) return false;
  if (!ELIGIBLE_OUTCOMES[input.outcome]) return false;
  return input.transcript.some((e) => e.role === "caller" && e.text.trim().length > 0);
}
