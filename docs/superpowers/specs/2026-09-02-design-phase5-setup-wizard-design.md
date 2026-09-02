# Design Phase 5 — Setup Wizard Two-Pane

**Date:** 2026-09-02 · **Status:** approved by danlo (brainstorm 2026-09-02)
**Roadmap:** P5 of `docs/superpowers/plans/2026-08-31-design-migration-roadmap.md`
**Governing contract:** `DESIGN.md` (the "Setup" key pattern; rules 3, 5, 6, 7, 8)

## Goal

Turn the setup wizard from one long scrolling stack of nine cards into the
two-pane shape the design system calls for: a stepper rail beside a single
step's detail pane. Exit (roadmap): the dogfood-walk friction list is closed.

## Scope correction (verified against code, not memory)

The roadmap line says P5 folds in three recorded wizard findings. Two are
ALREADY FIXED and are not P5 work:

- **Test-call circular dependency** — fixed. `lib/voice/accept-gate.ts:30`:
  a `testing` number answers regardless of `profile.enabled`.
- **provisioned→testing unsurfaced** — fixed. `setup-view.ts`'s
  `testCallNoteKind` renders the honest four-case matrix, and
  `canEnableTestCalls` gates the button on a saved profile.

A third roadmap bullet, "Setup leaves the nav when complete," ALSO already
shipped, in P2: `app-sidebar.tsx:333` hides the footer meter at
`done === total`, and the meter is correctly agency-only (the client footer
is null).

**Genuinely open, and therefore in P5:** rename-after-create. There is no way
to rename an account anywhere in the app — `accounts.name` is written once by
`create-account-dialog.tsx` and never again.

## Decisions (danlo, locked — do not re-litigate)

1. **Two-pane, one step at a time** — rail + detail pane, not a rail beside
   the existing scrollable stack.
2. **A locked step is always SELECTABLE**, and its pane names the unmet
   prerequisites with a link to each. Never a dead click.
3. **Architecture A** — all nine detail bodies server-rendered in ONE pass
   from the existing `gatherSetupInputs` read set; selection is client state
   mirrored to `?step=<key>` via shallow `pushState`. No server round trip
   and no extra reads on a step click.
4. **Rename lives in the wizard's step 1** (not Settings) — that is where the
   typo is felt. danlo expressed no preference; this is the recorded call.

## Architecture

### Layout and selection

- Stepper rail (~260px, sticky) + detail pane.
- The page keeps its single `gatherSetupInputs` call and renders all nine
  detail bodies server-side; the rail toggles which is visible. Switching is
  instant, issues no request, and re-reads nothing.
- Selection mirrors to `?step=<SetupStepKey>` with shallow
  `window.history.pushState` — refresh and deep links restore the step, Back
  moves between steps, no RSC re-render. This is the `usePeek` pattern from
  P4 (`lib/contacts/use-peek.ts`), hardened there through two fix waves;
  reuse its shape (URL as the single source of truth via
  `useSyncExternalStore`, a popstate listener, no setState-in-effect) rather
  than reinventing it.
- **Default selection:** the first step that is not `done`. A missing,
  malformed, or unknown `?step=` value falls back to that same default — never
  an empty pane.

### Rail states — FIVE, not four

The roadmap names done/current/todo/locked. The code already carries a fifth
that must not be collapsed into the others: `unknown` = the read behind this
step failed. `setup-view.ts`'s `kindOf` already computes this and checks
`unknown` BEFORE `done` deliberately.

| State | Rail | Meaning |
|---|---|---|
| done | ✓ + word | derived true |
| current | ▸ + word | the selected step |
| to do | ○ + word | derived false |
| locked | ⊘ + word | real unmet prerequisite (two steps only) |
| couldn't check | ⚠ + word | the read behind it did not answer |

Status is never colour alone — dot/icon **plus** the word (DESIGN.md rule 3).
A step whose read failed is NEVER rendered as locked: we do not know that it
is blocked.

### Locked is derived, never invented

Only two steps have real prerequisites, and both already exist in code:

- **test_call** — needs an assigned number AND a saved voice profile
  (`canEnableTestCalls` / `testCallNoteKind`, setup-view.ts).
- **go_live** — needs hours + voice_profile + number + test_call
  (`GO_LIVE_PREREQ_KEYS` / `goLivePrereqsMet`).

The other seven steps are independent and are never locked. A locked step's
pane names its unmet prerequisites and links to each, reusing the existing
`setup.goLive.blocked` list rather than deriving a second one. An
unmet-because-UNKNOWN prerequisite keeps go-live blocked, exactly as
`buildSetupViews` already decides — an unverifiable prerequisite is not a met
one.

### Decomposition

`setup-panel.tsx` is 30KB holding all nine cards — the file every future step
change must touch. It splits into:

- `setup/steps/<key>.tsx` — one module per step, exporting only its detail
  body (nine small files).
- `setup/setup-rail.tsx` — the stepper rail.
- `setup/setup-shell.tsx` — the client component owning selection + `?step=`.

Existing interactive children move across UNCHANGED:
`setup-go-live-button.tsx`, `setup-move-number-button.tsx`,
`setup-enable-test-calls-button.tsx`, `setup-tick-button.tsx`.
**No derivation logic is touched** — `setup-status.ts` and `setup-view.ts`
are read-only in this phase.

## The rename step

Step 1 ("Create the account") currently renders dead copy: "This company
exists — you're looking at it." It gains an inline rename of `accounts.name`
using P4's `InlineField` (click → edit → save on blur/Enter → undo toast).

The pane must say plainly, because both are true and non-obvious:

- this label is **agency-private** — a client sees their brand name, never
  this internal note (e.g. "Rio Roofing — trial"); P3 established that
  precedence in the dashboard greeting and the sidebar identity block;
- it is **not** the client's public-facing name — Branding owns that.

New `renameAccountAction(accountId, value)` in the setup route's `actions.ts`:
`requireAgencyOnlyAccountAccess` (the whole wizard is agency-only), trim,
**reject empty**, return `{ ok: true } | { ok: false; error }`, revalidate the
account's paths. Empty is rejected rather than allowed to clear — unlike a
contact field, an account with no name breaks the client switcher, the
dashboard greeting, and the accounts list.

## Error handling

- The failed-read discipline carries over intact: a step whose read did not
  answer renders ⚠ in the rail, says so in its pane, and never counts as a met
  prerequisite.
- If EVERY read fails the rail still renders all nine entries — a wizard that
  renders nothing tells the operator less than one that names what it could
  not verify.
- Rename failure reverts the displayed value and toasts, through the same
  `notifyActionResult` path every other action uses (stale-tab rejections stay
  loud).
- A locked step's pane never renders a live primary button; the existing
  buttons already gate themselves and keep doing so.

## Testing

**Unit (pure logic — apps/web vitest has no DOM):**
- rail-state mapping for all five kinds, including that `unknown` beats
  `done` and that a step with a failed read is never rendered locked;
- prerequisite naming for both locked steps (and that an unknown prerequisite
  still blocks);
- `?step=` parsing: valid key, unknown key, missing, malformed → correct
  default (first not-done step);
- `renameAccountAction`: empty rejected without a db write, non-agency
  rejected, success shape.

**e2e (fixture account, agency session):**
- rail selection swaps the pane with NO navigation;
- deep-link `?step=<key>` restores that step; Back moves between steps;
- a locked step is selectable and names its blockers;
- inline rename is mutation-checked by reload;
- first-incomplete-step preselect on a fresh account.

**Screenshot pass** both themes before merge (rail with a mix of all five
states, a locked step's pane, the rename step), per the phase ritual.

## Out of scope (explicitly)

- No changes to step derivation (`setup-status.ts`) or to the go-live /
  move-number / enable-test-calls actions themselves.
- No client-facing setup view — the wizard stays agency-only
  (`requireAgencyOnlyAccountAccess`).
- No Settings rename surface.
- Command-palette registration of setup sections is P6.

## Definition of done

DESIGN.md's DoD applies (tokens only, dark + light, loaded/empty/error
states, keyboard: rail is arrow-navigable with a visible focus ring, 7 AM
copy). Gates before merge: `pnpm check`, `pnpm --filter web build`,
`pnpm --filter web test:e2e` (full suite), review gate, danlo screenshot gate.
