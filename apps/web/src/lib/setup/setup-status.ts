import type { CalendarRow, VoiceProfileRow, PhoneNumberRow } from "@bis/db";
import { assistantProfileGap, isAssistantProfileReady } from "@bis/db/profile-ready";

// Pure module by design: the wizard's whole promise is that step completion
// is COMPUTED from live rows on every render, never stored as its own flag
// that can drift from reality. No db client, no Date, no side effects — only
// the shapes below plus a couple of ticked-by-the-user booleans that genuinely
// have no derivable source (see "email" and "forwarding" below).

export type SetupStepKey =
  | "account" | "branding" | "hours" | "voice_profile" | "website_assistant" | "number"
  | "email" | "forwarding" | "test_call" | "go_live";

export type SetupStepState = { key: SetupStepKey; done: boolean; skipped: boolean };

/**
 * The two plan flags `accounts.permissions` ever carries — `writePermissions`
 * (packages/db/src/account-billing.ts) is the ONLY writer, and it copies
 * exactly these two keys off the plan's `PlanFeatures` when billed, or writes
 * `{}` for an unbilled account. Optional, not `boolean`, because the column
 * itself can be `{}` or missing either key — see `deriveSetupStatus`'s own
 * comment on what each absence means.
 */
export type SetupPermissions = { voice_receptionist?: boolean; web_concierge?: boolean };

export type SetupInputs = {
  brandName: string | null;
  fromEmail: string | null;
  calendar: Pick<CalendarRow, "enabled" | "open_hours"> | null;
  profile: Pick<
    VoiceProfileRow,
    "greeting_en" | "greeting_es" | "facts" | "enabled" | "languages"
    // The website-assistant trio: read off the SAME voice_profiles row
    // (getVoiceProfile already selects every PROFILE_COLS column, so this is
    // a type widening only — no new query). `concierge_enabled` decides
    // website_assistant's own done bit below; `concierge_form_id` is the
    // other half of that conjunction; `public_id` is what the setup pane's
    // fourth row needs to build the embed snippet, threaded through
    // unchanged by deriveSetupStatus itself.
    | "concierge_enabled" | "concierge_form_id" | "public_id"
  > | null;
  numbers: Pick<PhoneNumberRow, "status">[];
  /** ANSWERED calls ever (`countAnsweredCallsSince`, D-091): a robocall, a
   *  hang-up or a silent ring proves nothing about the line, so none of
   *  them turns the test-call step green. */
  callCount: number;
  ticks: { emailSkipped: boolean; forwardingDone: boolean };
  /** Published forms only (the setup pane's row 2) — gatherSetupInputs
   *  narrows `listForms`'s full result down to this count, same narrowing
   *  the Voice page's own website-assistant card already does. Not used by
   *  `deriveSetupStatus` below (website_assistant's `done` never gates on
   *  it — publishing a form is proof of readiness the pane shows, not a
   *  prerequisite this function enforces) — carried on `SetupInputs`
   *  anyway because this is the one struct `gatherSetupInputs` assembles
   *  for every reader downstream, the same reason `profile` sits here for
   *  callers that only want `hasVoiceProfile`. */
  publishedFormCount: number;
  /** Whether AT LEAST ONE conversation is attributed to a real site visit
   *  (row 4's proof, not a gate) — boolean, not a count (fix-round review,
   *  MINOR 4: the pane only ever asks yes/no, so the accessor itself is
   *  bounded with `.limit(1)`) — same "carried for downstream readers"
   *  reasoning as the field above. */
  conciergeSiteConversation: boolean;
  /**
   * The account's plan flags, straight off `accounts.permissions` — read
   * alongside `brandName`/`fromEmail` in the same `accounts` row
   * (setup-inputs.ts), so a failed read degrades THIS field the exact same
   * way it already degrades those two: to `null`. `null` must read
   * IDENTICALLY to `{}` below (see `deriveSetupStatus`) — a read failure
   * must never silently hide a step an operator never asked to lose
   * (docs/crm-features.md:883).
   */
  permissions: SetupPermissions | null;
};

// localStorage-style keys the wizard persists the two ticks under. Named
// here, not inline at each call site, because Tasks 13/14 read AND write
// these exact strings — a typo on either side silently loses the tick.
export const SETUP_TICK_KEYS = {
  emailSkipped: "setup:email_skipped",
  forwardingDone: "setup:forwarding_done",
} as const;

const LIVE_NUMBER_STATUSES: ReadonlySet<PhoneNumberRow["status"]> = new Set([
  "provisioned", "testing", "live",
]);

function nonBlank(value: string | null | undefined): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

// At least one day's window array must be non-empty. `open_hours: {}` passes
// `calendar.enabled === true` but has zero keys, so `Object.values` yields an
// empty array and `.some(...)` is false — this is the exact wiped-config
// state that made every day read "no availability" on a real call
// (exit-gate call #1).
function hasOpenHours(openHours: Record<string, [string, string][]>): boolean {
  return Object.values(openHours).some((windows) => windows.length > 0);
}

function step(key: SetupStepKey, done: boolean, skipped = false): SetupStepState {
  return { key, done, skipped };
}

/**
 * The profile question `voice_profile`'s own `done` bit answers — extracted
 * so `WebsiteAssistantStep` (setup/steps/website-assistant.tsx) can ask the
 * SAME question for its row 1 without a second, hand-rolled copy. On a
 * CRM-only plan `voice_profile` is not in `deriveSetupStatus`'s returned
 * list at all (see `CRM_ONLY_DROPPED_KEYS` below), so there is no `views`
 * entry row 1 could read `done`/`unknown` off — it has to ask this question
 * directly, off the same `profile` row, and get the same answer
 * `deriveSetupStatus` would have computed had the step existed.
 *
 * Mirrors the incoming voice route's step-11 greeting pick exactly
 * (apps/web/src/app/api/voice/incoming/route.ts) and the website
 * assistant's own system-prompt builder (api/concierge/[publicId]/turn/
 * route.ts, which passes BOTH `greeting` and `facts` into
 * `buildSystemPrompt` for a chat session exactly as it does for a phone
 * call) — the website assistant genuinely reads the same greeting the
 * phone does, not a lesser requirement, so this is the right question for
 * row 1 to ask on EITHER plan shape, not an over-requirement carried over
 * from the phone-only step.
 */
//
// D-108: now ONE predicate with the Voice page's assistant toggle and
// `enableConcierge` (`isAssistantProfileReady`, @bis/db/profile-ready). The
// old local rule wanted only the "primary" greeting, so a bilingual profile
// with no Spanish greeting read done here while the toggle refused it, and a
// Spanish visitor on that line got an empty first message.
export function isVoiceProfileDone(
  profile: Pick<VoiceProfileRow, "facts" | "greeting_en" | "greeting_es" | "languages"> | null,
): boolean {
  return isAssistantProfileReady(profile);
}

/** True when the ONE thing keeping the profile from done is a bilingual
 *  line's blank Spanish greeting, so a Setup row can say which greeting,
 *  rather than "write the greeting" about one the operator already wrote.
 *  Same predicate as above, never a second rule. */
export function isSpanishGreetingTheGap(
  profile: Pick<VoiceProfileRow, "facts" | "greeting_en" | "greeting_es" | "languages"> | null,
): boolean {
  return profile !== null && assistantProfileGap(profile) === "spanish_greeting";
}

// The five steps a CRM-only plan can never reach: each one is either Sofía
// herself (voice_profile), the phone number she answers on (number), proof
// she is reachable (test_call), the one-time flip that turns her on
// (go_live), or a fact about the carrier forwarding TO her (forwarding). A
// client who bought the CRM alone has none of these to finish — leaving them
// in the list is docs/crm-features.md:883's defect: Setup never completes,
// and the sidebar meter never fills.
const CRM_ONLY_DROPPED_KEYS: ReadonlySet<SetupStepKey> = new Set([
  "voice_profile", "number", "forwarding", "test_call", "go_live",
]);

export function deriveSetupStatus(inputs: SetupInputs): SetupStepState[] {
  const { brandName, fromEmail, calendar, profile, numbers, callCount, ticks, permissions } = inputs;

  const brandingDone = nonBlank(brandName);

  const hoursDone = calendar?.enabled === true && hasOpenHours(calendar.open_hours);

  // `isVoiceProfileDone` (above) — the same question row 1 of the website
  // assistant step now asks directly when `voice_profile` is not in this
  // function's own returned list (a CRM-only plan). One predicate, so the
  // two can never answer it differently for the same profile row.
  const voiceProfileDone = isVoiceProfileDone(profile);

  // Never a stored flag (this file's whole promise, see the header comment):
  // a client whose concierge got disabled, or whose destination form was
  // cleared, must see this step un-done again on the very next render, not
  // keep a green tick from whenever it was FIRST configured.
  const websiteAssistantDone =
    profile?.concierge_enabled === true && Boolean(profile.concierge_form_id);

  const numberDone = numbers.some((n) => LIVE_NUMBER_STATUSES.has(n.status));

  const emailDone = nonBlank(fromEmail);
  // Explicitly not required for go-live (see goLivePrereqsMet) — a tenant
  // can be reachable and booking without ever configuring a sending
  // identity. "skipped" only ever appears alongside done:false: once
  // fromEmail is actually set the card is done, not done-and-skipped.
  const emailSkipped = !emailDone && ticks.emailSkipped;

  const testCallDone = callCount > 0;

  const goLiveDone = profile?.enabled === true && numbers.some((n) => n.status === "live");

  const allSteps: SetupStepState[] = [
    step("account", true),
    step("branding", brandingDone),
    step("hours", hoursDone),
    step("voice_profile", voiceProfileDone),
    step("website_assistant", websiteAssistantDone),
    step("number", numberDone),
    step("email", emailDone, emailSkipped),
    step("forwarding", ticks.forwardingDone),
    step("test_call", testCallDone),
    step("go_live", goLiveDone),
  ];

  // `=== false`, explicitly — `{}` (unbilled), a missing key, and `true` all
  // take the ELSE branch, i.e. today's full ten-step list, unchanged. This is
  // the one signal `writePermissions` (packages/db/src/account-billing.ts)
  // ever writes true/false on purpose; everything else is "we don't know,
  // assume full" by construction, which is also what makes a failed
  // permissions read (SetupInputs's own doc comment: degrades to `null`)
  // safe to fall through here without a separate check.
  const voiceReceptionistOff = permissions?.voice_receptionist === false;
  const webConciergeOff = permissions?.web_concierge === false;

  return allSteps.filter((s) => {
    if (voiceReceptionistOff && CRM_ONLY_DROPPED_KEYS.has(s.key)) return false;
    if (webConciergeOff && s.key === "website_assistant") return false;
    return true;
  });
}

/** What the sidebar's setup meter AND the wizard's own progress pane show —
 *  `setup-panel.tsx`'s `SetupProgress` calls this function directly rather
 *  than carrying its own copy of the formula, so the two can never disagree
 *  about what "finished" means for the same account
 *  (docs/crm-features.md:884: before this function excluded skipped steps
 *  from `total`, a live tenant who skipped the genuinely optional email step
 *  could never reach "N of N" on the sidebar meter even though the wizard's
 *  own pane already read fully done — that was the exact shape of the
 *  defect, back when the pane still computed its own total separately).
 *  `total` excludes a SKIPPED step from the denominator; `steps.length`
 *  would still be the right total for every step that is never skippable —
 *  this reads off the array's own `skipped` flags rather than hardcoding
 *  either number, so it stays correct however many steps the caller hands
 *  it (today's ten, or a CRM-only plan's shorter list — see
 *  `deriveSetupStatus`). */
export function reduceSetupProgress(steps: SetupStepState[]): { done: number; total: number } {
  return {
    done: steps.filter((s) => s.done).length,
    total: steps.filter((s) => !s.skipped).length,
  };
}

// branding now gates go-live (spec 2026-09-07-brand-name-resolver): a
// customer-facing name is what every email, text and the booking page hand
// to a stranger the moment the line goes live, so this is not the same kind
// of check as email/forwarding below. email/forwarding are still
// deliberately excluded: neither blocks a tenant from actually taking live
// calls, so gating go-live on them would be a UX lie (see
// setup-status.test.ts's goLivePrereqsMet suite for the met-with-
// email-undone case this guards against regressing).
export function goLivePrereqsMet(steps: SetupStepState[]): boolean {
  const isDone = (key: SetupStepKey) => steps.find((s) => s.key === key)?.done === true;
  return isDone("hours") && isDone("voice_profile") && isDone("number") && isDone("test_call") && isDone("branding");
}
