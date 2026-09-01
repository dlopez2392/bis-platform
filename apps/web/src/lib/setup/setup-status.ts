import type { CalendarRow, VoiceProfileRow, PhoneNumberRow } from "@bis/db";

// Pure module by design: the wizard's whole promise is that step completion
// is COMPUTED from live rows on every render, never stored as its own flag
// that can drift from reality. No db client, no Date, no side effects — only
// the shapes below plus a couple of ticked-by-the-user booleans that genuinely
// have no derivable source (see "email" and "forwarding" below).

export type SetupStepKey =
  | "account" | "branding" | "hours" | "voice_profile" | "number"
  | "email" | "forwarding" | "test_call" | "go_live";

export type SetupStepState = { key: SetupStepKey; done: boolean; skipped: boolean };

export type SetupInputs = {
  brandName: string | null;
  fromEmail: string | null;
  calendar: Pick<CalendarRow, "enabled" | "open_hours"> | null;
  profile: Pick<VoiceProfileRow, "greeting_en" | "greeting_es" | "facts" | "enabled" | "languages"> | null;
  numbers: Pick<PhoneNumberRow, "status">[];
  callCount: number;
  ticks: { emailSkipped: boolean; forwardingDone: boolean };
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

export function deriveSetupStatus(inputs: SetupInputs): SetupStepState[] {
  const { brandName, fromEmail, calendar, profile, numbers, callCount, ticks } = inputs;

  const brandingDone = nonBlank(brandName);

  const hoursDone = calendar?.enabled === true && hasOpenHours(calendar.open_hours);

  // Mirrors the incoming route's step-11 greeting pick exactly
  // (apps/web/src/app/api/voice/incoming/route.ts): languages === "es" reads
  // greeting_es, everything else (including "both") reads greeting_en. A
  // profile that's only filled in for the OTHER language would pass a naive
  // "either greeting is set" check yet still greet a real caller with dead
  // air — this must ask the same question the live route asks.
  const primaryGreeting = profile
    ? (profile.languages === "es" ? profile.greeting_es : profile.greeting_en)
    : null;
  const voiceProfileDone = Boolean(profile) && nonBlank(profile?.facts) && nonBlank(primaryGreeting);

  const numberDone = numbers.some((n) => LIVE_NUMBER_STATUSES.has(n.status));

  const emailDone = nonBlank(fromEmail);
  // Explicitly not required for go-live (see goLivePrereqsMet) — a tenant
  // can be reachable and booking without ever configuring a sending
  // identity. "skipped" only ever appears alongside done:false: once
  // fromEmail is actually set the card is done, not done-and-skipped.
  const emailSkipped = !emailDone && ticks.emailSkipped;

  const testCallDone = callCount > 0;

  const goLiveDone = profile?.enabled === true && numbers.some((n) => n.status === "live");

  return [
    step("account", true),
    step("branding", brandingDone),
    step("hours", hoursDone),
    step("voice_profile", voiceProfileDone),
    step("number", numberDone),
    step("email", emailDone, emailSkipped),
    step("forwarding", ticks.forwardingDone),
    step("test_call", testCallDone),
    step("go_live", goLiveDone),
  ];
}

/** What the sidebar's setup meter shows (app-sidebar.tsx via
 *  dashboard/accounts/[accountId]/setup-actions.ts): how many of the steps
 *  are done, out of how many exist. `total` reads off `steps.length` rather
 *  than a hardcoded 9 so it stays correct if a step is ever added or
 *  removed here — the one number this function must never duplicate from
 *  the array it was handed. */
export function reduceSetupProgress(steps: SetupStepState[]): { done: number; total: number } {
  return { done: steps.filter((s) => s.done).length, total: steps.length };
}

// email/forwarding are deliberately excluded: neither blocks a tenant from
// actually taking live calls, so gating go-live on them would be a UX lie
// (see setup-status.test.ts's goLivePrereqsMet suite for the met-with-
// email-undone case this guards against regressing).
export function goLivePrereqsMet(steps: SetupStepState[]): boolean {
  const isDone = (key: SetupStepKey) => steps.find((s) => s.key === key)?.done === true;
  return isDone("hours") && isDone("voice_profile") && isDone("number") && isDone("test_call");
}
