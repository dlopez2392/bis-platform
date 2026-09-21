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

export type ReadKey =
  | "account" | "calendar" | "profile" | "numbers" | "ticks" | "calls"
  | "forms" | "conversations";

/** Which read each step's answer depends on. A step whose read did not settle
 *  renders "couldn't check" — never "done", and never "to do" either, since a
 *  read that threw answered neither question. */
export const READS_BEHIND: Record<SetupStepKey, readonly ReadKey[]> = {
  account: [],
  branding: ["account"],
  hours: ["calendar"],
  voice_profile: ["profile"],
  // Three legs: the toggle/destination live on `profile`, row 2's published
  // count on `forms`, row 4's proof on `conversations`. Any one failing
  // degrades ONLY this step — never voice_profile, which reads `profile`
  // alone and would otherwise wrongly go unknown on a forms-only failure.
  website_assistant: ["profile", "forms", "conversations"],
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
 *  list, two readers — and setup-view.test.ts pins them in lockstep (undo
 *  any one step: the predicate answers false exactly when the key is listed
 *  here), because "keep it in sync" alone did not hold: `branding` joined
 *  the predicate with the brand-name resolver (spec 2026-09-07 — the name
 *  every email, text and the booking page hand to a stranger the moment the
 *  line goes live) and this list did not follow, which left the Go live
 *  button disabled with no step named under it. */
export const GO_LIVE_PREREQ_KEYS: readonly SetupStepKey[] = [
  "branding", "hours", "voice_profile", "number", "test_call",
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

/** Which note the test-call card renders, and — via `canEnableTestCalls`
 *  below, which reads off this same value — whether the button underneath it
 *  is ever a LIVE "enable" rather than a disabled one. */
export type TestCallNoteKind = "enable" | "needsProfile" | "testing" | null;

/**
 * `provisioned` and `testing` are the only two statuses this card ever has
 * something to say about (`live`/`released` fall through to `null` — the
 * go-live card and the move-number flow own those, respectively). Within
 * those two, `hasVoiceProfile` decides which of two very different messages
 * is honest — the wizard's own exit-gate finding this fixes (Finding 2, the
 * same gap Finding 1 found in the step order itself): `provisioned` alone
 * used to be enough to offer the button. But `setNumberStatusAction`
 * (voice/actions.ts) gates only the flip TO `live` on a saved profile — the
 * flip to `testing` this card's button drives has no such check, so it would
 * happily set status to `testing` on a number with `profile === null`.
 * `callAnswerable` (lib/voice/accept-gate.ts) then declines every call to it
 * with `no-profile`, REGARDLESS of status — `testing` is not an exception
 * there, only `profile.enabled` for `live` is.
 *
 * - `provisioned`, profile saved → `"enable"`: the ordinary path, a live
 *   button that would actually leave the number answering.
 * - `provisioned`, no profile → `"needsProfile"`: a button that flipped the
 *   row anyway would be offering to fix a card that would still be lying the
 *   moment the write landed, so the button must render DISABLED rather than
 *   vanish — an operator staring at a card with no control at all has no
 *   path forward from here.
 * - `testing`, profile saved → `"testing"`: genuinely answering, say so.
 * - `testing`, no profile → `"needsProfile"`, not `"testing"`. Covers a
 *   number that reached `testing` before this task shipped (or via a direct
 *   call to the action, which still has no profile check on this
 *   transition): the old card read status alone and printed "answering
 *   calls now" — provably false per `callAnswerable`. Status can no longer
 *   answer this question by itself.
 */
export function testCallNoteKind(
  status: PhoneNumberStatus,
  hasVoiceProfile: boolean,
): TestCallNoteKind {
  if (status === "provisioned") return hasVoiceProfile ? "enable" : "needsProfile";
  if (status === "testing") return hasVoiceProfile ? "testing" : "needsProfile";
  return null;
}

/** Whether the test-call card's button is a LIVE "Enable test calls" —
 *  narrower than "does the button render at all" (setup-panel.tsx also
 *  renders it, disabled, for `"needsProfile"` on a `provisioned` number).
 *  Derived from `testCallNoteKind` rather than re-deciding status/profile
 *  itself, so the two can never drift apart on which case is which. */
export function canEnableTestCalls(status: PhoneNumberStatus, hasVoiceProfile: boolean): boolean {
  return testCallNoteKind(status, hasVoiceProfile) === "enable";
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
