import type { SetupStepKey } from "./setup-status";
import { GO_LIVE_PREREQ_KEYS, type SetupStepView } from "./setup-view";

// Pure module, same discipline as setup-status.ts / setup-view.ts: no db,
// no React, no Date. Everything the two-pane rail needs to decide WHICH
// step is shown and WHICH steps are locked lives here so it is reachable
// by a test — vitest.config.ts does not include .tsx files.

/** The canonical nine, in the order the wizard walks them. Mirrors the array
 *  `deriveSetupStatus` returns; kept here so the rail can order itself
 *  without depending on that function having been called. */
export const SETUP_STEP_KEYS: readonly SetupStepKey[] = [
  "account", "branding", "hours", "voice_profile", "number",
  "email", "forwarding", "test_call", "go_live",
] as const;

/**
 * Which steps can be LOCKED, and by what. Exactly two, and both gates
 * already exist in code — no step's lock is invented here:
 *  - test_call: `canEnableTestCalls(status, hasVoiceProfile)` (setup-view.ts)
 *  - go_live:   `goLivePrereqsMet` narrowed by unknown reads (buildSetupViews)
 * The other seven are independent and are NEVER locked; claiming otherwise
 * would invent a dependency the derivation does not have.
 */
export function isLockedStep(
  key: SetupStepKey, opts: { canTestCall: boolean; prereqsMet: boolean },
): boolean {
  if (key === "test_call") return !opts.canTestCall;
  if (key === "go_live") return !opts.prereqsMet;
  return false;
}

/**
 * The unmet prerequisites to NAME in a locked step's pane.
 *
 * `!done || unknown` — not `!done` alone. The same reasoning setup-panel.tsx
 * records for the go-live blocked list (setup-panel.tsx:220-233): an UNKNOWN
 * prerequisite must still be named, because a read that threw answered
 * neither "done" nor "to do" — `buildSetupViews`'s `prereqsMet` already
 * refuses go-live on it (setup-view.ts), so the pane must give the same
 * answer rather than silently dropping the step `!done` alone would miss
 * whenever a prerequisite carries `done: true` alongside `unknown: true`
 * (the way `email` can, per setup-panel.tsx's own comment on that
 * asymmetry) — go-live's four prerequisites don't do that today, but this
 * function does not assume they never will.
 */
export function lockedPrereqKeys(
  key: SetupStepKey, views: SetupStepView[],
): SetupStepKey[] {
  if (key === "go_live") {
    return views
      .filter((v) => GO_LIVE_PREREQ_KEYS.includes(v.key) && (!v.done || v.unknown))
      .map((v) => v.key);
  }
  if (key === "test_call") {
    return views
      .filter((v) => (v.key === "number" || v.key === "voice_profile") && (!v.done || v.unknown))
      .map((v) => v.key);
  }
  return [];
}

/** Preselected step: the first one not yet done. When everything is done the
 *  wizard has nothing outstanding, so it opens on the last step (go-live)
 *  rather than an arbitrary one. */
export function defaultStepKey(views: SetupStepView[]): SetupStepKey {
  return views.find((v) => !v.done)?.key ?? SETUP_STEP_KEYS[SETUP_STEP_KEYS.length - 1]!;
}

/** `?step=` → a real key. Anything missing, unknown or malformed falls back
 *  to the default rather than rendering an empty pane. */
export function parseStepParam(
  raw: string | null | undefined, views: SetupStepView[],
): SetupStepKey {
  if (raw && (SETUP_STEP_KEYS as readonly string[]).includes(raw)) {
    return raw as SetupStepKey;
  }
  return defaultStepKey(views);
}
