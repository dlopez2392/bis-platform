import type { SetupStepKey } from "./setup-status";
import { GO_LIVE_PREREQ_KEYS, kindOf, type SetupStepView, type StateKind } from "./setup-view";

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
 * Which steps can be LOCKED. Exactly two — `test_call` and `go_live` — the
 * other seven are independent and are NEVER locked; claiming otherwise would
 * invent a dependency the derivation does not have.
 *
 * A step is locked exactly when `lockedPrereqKeys` names at least one unmet
 * prerequisite for it. This is the ONLY source of truth for the lock: it is
 * derived from the same list the pane renders under the lock, not from a
 * separately-computed gate, so the two can never disagree. A prior version
 * took `canTestCall`/`prereqsMet` from the caller instead — `canTestCall`
 * came from `canEnableTestCalls`, which answers "should the Enable button be
 * live?", not "can a test call be placed?", and goes false once a number
 * reaches `testing` (a state that already means the number answers calls).
 * That let this function say LOCKED while `lockedPrereqKeys` said "no unmet
 * prerequisites" — a locked pane with no reason shown under it. Deriving the
 * lock from the prerequisites themselves makes that divergence impossible by
 * construction.
 */
export function isLockedStep(key: SetupStepKey, views: SetupStepView[]): boolean {
  return lockedPrereqKeys(key, views).length > 0;
}

/**
 * The unmet prerequisites to NAME in a locked step's pane — and, via
 * `isLockedStep` above, the thing that decides whether the step locks at
 * all.
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
 *
 * `test_call`'s prerequisites are `number` and `voice_profile`: placing a
 * test call needs a number to dial and a profile to answer with — nothing
 * else the wizard tracks bears on whether a test call can be placed.
 * `canEnableTestCalls` (setup-view.ts) is deliberately NOT used as this
 * gate: it answers whether the *Enable test calls* button should be live,
 * which is a narrower and different question — it goes false once the
 * number's status reaches `testing`, precisely because a number already in
 * testing mode doesn't need enabling, not because a test call can no longer
 * be placed. `testing` is also in `LIVE_NUMBER_STATUSES` (setup-status.ts),
 * so `number` and (with a saved profile) `voice_profile` both read `done:
 * true` at that point — using `canEnableTestCalls` as the lock gate would
 * report LOCKED with zero unmet prerequisites here to name.
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

/** The five `kindOf` states (./setup-view.ts) plus a sixth the RAIL layer
 *  adds on top: `locked`. Kept OUT of `StateKind` itself — that type is what
 *  every step module's own `kind` prop uses (setup/steps/step-shared.tsx),
 *  and none of those need to know "locked" exists; only the rail and the
 *  pane header (setup/setup-shell.tsx) do. */
export type RailKind = StateKind | "locked";

/**
 * `kindOf`'s answer, promoted to `locked` when this step's own prerequisites
 * are unmet — but ONLY when `kindOf` didn't already answer `unknown`,
 * `done`, or `skipped`:
 *   - `unknown` stays `unknown`. A step whose OWN read failed must keep
 *     saying so — "couldn't check" is never quietly upgraded to a verdict
 *     about a DIFFERENT step's prerequisites.
 *   - `done` stays `done`. `test_call` can be done (a real call was placed)
 *     while one of its prerequisites has since gone unmet again (a voice
 *     profile cleared after the call) — the step itself is still finished;
 *     it does not retroactively need unlocking.
 *   - `skipped` stays `skipped`, for the same reason: no lockable key is
 *     ever also skippable today (`isLockedStep` only locks `test_call`/
 *     `go_live`; only `email` is ever skipped), but excluding it here keeps
 *     that true by construction rather than by coincidence.
 *
 * Lives in this module, not in the rail component that renders it, for the
 * reason stated at the top of this file: it is a decision, and a decision
 * in a `.tsx` is a decision no test can reach. See setup-rail.test.ts.
 */
export function railKindOf(
  view: SetupStepView, isNext: boolean, views: SetupStepView[],
): RailKind {
  const kind = kindOf(view, isNext);
  if (kind === "unknown" || kind === "done" || kind === "skipped") return kind;
  return isLockedStep(view.key, views) ? "locked" : kind;
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
