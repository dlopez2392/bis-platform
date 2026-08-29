import type { PhoneNumberRow, PhoneNumberStatus } from "@bis/db";
import { goLivePrereqsMet, type SetupStepKey, type SetupStepState } from "./setup-status";

// Pure module, same discipline as setup-status.ts: no db client, no React,
// no Date. This one carries the safety invariant that spans the setup PAGE
// rather than the derive function — which failed read degrades which
// step(s) to "couldn't check", and the rule that an unmet-because-unknown
// prerequisite blocks go-live exactly like an unmet-because-false one.
// Before this module existed both lived inline in page.tsx and in an
// unexported function in setup-panel.tsx — two .tsx files vitest.config.ts
// does not include, so neither was reachable by a test. See
// setup-view.test.ts.

export type ReadKey = "account" | "calendar" | "profile" | "numbers" | "ticks" | "calls";

/** Which read each step's answer depends on. A step whose read did not settle
 *  renders "couldn't check" — never "done", and never "to do" either, since a
 *  read that threw answered neither question. */
export const READS_BEHIND: Record<SetupStepKey, readonly ReadKey[]> = {
  account: [],
  branding: ["account"],
  hours: ["calendar"],
  voice_profile: ["profile"],
  number: ["numbers"],
  // Both: `from_email` decides done, the stored tick decides skipped.
  email: ["account", "ticks"],
  forwarding: ["ticks"],
  test_call: ["calls"],
  // Mirrors the derive function: profile.enabled AND a number at status live.
  go_live: ["profile", "numbers"],
};

/** Mirrors the keys `goLivePrereqsMet` checks (setup-status.ts). Duplicated
 *  here rather than derived from it because that function returns a boolean
 *  and callers need to NAME the unmet steps (setup.goLive.blocked). One
 *  list, two readers — keep it in sync with that function's body. */
export const GO_LIVE_PREREQ_KEYS: readonly SetupStepKey[] = [
  "hours", "voice_profile", "number", "test_call",
];

/**
 * A derived step plus whether the read behind it actually answered.
 *
 * `unknown` is not a fourth value of `done` — it sits beside it deliberately,
 * so that no arm of the render can accidentally treat a failed read as a
 * negative answer and no future edit can collapse the two.
 */
export type SetupStepView = SetupStepState & { unknown: boolean };

/**
 * Joins each derived step with whether its read settled, and narrows
 * `goLivePrereqsMet`'s answer with the one thing a pure function over
 * derived rows cannot know on its own — that some of those rows never
 * arrived. An unverifiable prerequisite is not a met one.
 */
export function buildSetupViews(
  steps: SetupStepState[],
  failedReads: Record<ReadKey, boolean>,
): { views: SetupStepView[]; prereqsMet: boolean } {
  const views: SetupStepView[] = steps.map((step) => ({
    ...step,
    unknown: READS_BEHIND[step.key].some((read) => failedReads[read]),
  }));

  const prereqsMet =
    goLivePrereqsMet(steps) &&
    !views.some((v) => GO_LIVE_PREREQ_KEYS.includes(v.key) && v.unknown);

  return { views, prereqsMet };
}

export type StateKind = "done" | "open" | "next" | "skipped" | "unknown";

/**
 * `unknown` is checked FIRST and `done` only after it. A step whose read
 * threw can still be carrying `done: false` from the neutral input the page
 * fed the derive function — reading that as "To do" would quietly turn a
 * failure into an answer.
 */
export function kindOf(step: SetupStepView, isNext: boolean): StateKind {
  if (step.unknown) return "unknown";
  if (step.done) return "done";
  if (step.skipped) return "skipped";
  return isNext ? "next" : "open";
}

/** The number the carrier forwards to and a test call dials, together with
 *  its status — never `released`, since `resolveAssignedNumber` filters those
 *  out below exactly as it always has. `id` is what `setNumberStatusAction`
 *  (voice/actions.ts) takes to flip it out of `provisioned`. */
export type AssignedNumber = { id: string; e164: string; status: PhoneNumberStatus };

/**
 * What the client's carrier forwards to, and what a test call dials. Three
 * states, not two: `null` means "no number exists yet, go assign one";
 * `"unknown"` means "the read that would answer this failed" — collapsing
 * those into one falsy value is what let the forwarding card tell an
 * operator to go assign a number when the real problem was a failed read.
 * A released number is a former number — forwarding a live business line to
 * one is how a client's calls go nowhere.
 */
export function resolveAssignedNumber(
  numbers: Pick<PhoneNumberRow, "id" | "status" | "e164">[],
  numbersReadFailed: boolean,
): AssignedNumber | null | "unknown" {
  if (numbersReadFailed) return "unknown";
  const found = numbers.find((n) => n.status !== "released");
  return found ? { id: found.id, e164: found.e164, status: found.status } : null;
}

/**
 * Whether the test-call card should offer the "Enable test calls" button —
 * the wizard's own exit-gate finding this task fixes: an operator who
 * finished every other step still had a number sitting `provisioned`,
 * answering nobody, with nothing on this page saying so or offering to fix
 * it. `testing` and `live` both already answer calls (`callAnswerable`,
 * lib/voice/accept-gate.ts — `testing` regardless of the receptionist
 * toggle, since Task 8), so only `provisioned` needs the button.
 */
export function canEnableTestCalls(status: PhoneNumberStatus): boolean {
  return status === "provisioned";
}

/**
 * Whether moving THIS number needs the destructive-confirm step
 * (setup-move-number-button.tsx) instead of a one-click move.
 *
 * `testing` and `live` both mean some other client's callers are being
 * routed to this number right now — the incoming route accepts a call for
 * either status (api/voice/incoming/route.ts), and `reassignPhoneNumber`
 * resets status to `provisioned` on the move (packages/db/src/voice.ts), so
 * taking one of these numbers is putting that client's line out of service,
 * not just relabeling a row. `provisioned` and `released` numbers answer
 * nobody either way, so a plain click is enough for those.
 */
export function requiresMoveConfirm(status: PhoneNumberStatus): boolean {
  return status === "testing" || status === "live";
}
