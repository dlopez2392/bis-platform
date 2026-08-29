import type { PhoneNumberStatus } from "@bis/db";

export interface CallAnswerableInput {
  status: PhoneNumberStatus;
  profile: { enabled: boolean } | null;
}

export interface CallAnswerableResult {
  answerable: boolean;
  reason?: "no-profile" | "disabled";
}

/**
 * The ONE shared predicate both voice gates call — the OpenAI webhook's
 * accept decision (`api/voice/incoming`, step 7) and TeXML's spoken-refusal
 * decision (`api/voice/texml`'s `classify()`) — so the two can never drift
 * out of agreement (video-meetings Task 8, Finding 1).
 *
 * `testing` and `live` are deliberately asymmetric: a `testing` number must
 * answer regardless of `profile.enabled` — that's the whole point of
 * testing mode, exercising the call before a client goes live — while
 * `live` numbers still respect the toggle. Other `PhoneNumberStatus` values
 * (`provisioned`, `released`) are unreachable here: both callers already
 * filter to testing/live before reaching this check.
 */
export function callAnswerable(
  { status, profile }: CallAnswerableInput,
): CallAnswerableResult {
  if (!profile) return { answerable: false, reason: "no-profile" };
  if (status === "testing") return { answerable: true };
  return profile.enabled ? { answerable: true } : { answerable: false, reason: "disabled" };
}
