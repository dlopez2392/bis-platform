# Design Migration Program — Roadmap

> Spec: `DESIGN.md` (repo root) + `docs/design/bis-design-direction.html`.
> This file sequences the program. Each phase gets its own detailed
> implementation plan when its turn comes; only Phase 1's exists today
> (`2026-08-31-design-phase1-foundation.md`). Approved by danlo 2026-08-31
> ("plan the whole program first").

**Goal:** migrate the deployed platform from the shadcn-default look to the
DESIGN.md system — tokens, type roles, surfaces, and the contract's key
patterns — without ever shipping a half-styled or inaccessible state.

**Standing constraints (every phase):**
- Tokens only; no hard-coded colors/radii/shadows (DESIGN.md DoD).
- The contrast sweeps in `branding/theme.test.ts` and the tenant-theme e2e
  specs stay green in every phase — AA is a gate, not an aspiration. Where a
  contract hex fails a sweep, lift it by the recorded procedure (same
  hue/saturation, minimum lift to clear) and write the final value back into
  `tokens.css` + DESIGN.md.
- The per-client branding engine keeps overriding `--accent` only; client
  public surfaces (booking page, forms, emails) must render identically
  unless a phase explicitly targets them.
- Full gates before each merge: `pnpm check` · build · e2e. Deploys are
  per-phase, never mid-phase.

## Phases

**P1 — Foundation cut-over** (detailed plan exists; one PR)
Bricolage Grotesque via next/font · restructure `tokens.css` scaffolding to
the app's `:root`/`.dark` convention (values unchanged; deviation recorded)
· import tokens · remap the semantic variables in `globals.css` onto them ·
reconcile base rules (body, `:focus-visible`, reduced-motion) · update
`branding/theme.ts` BIS palette in lockstep with the sweeps · screenshot
pass on both themes + tenant surfaces.
*Exit:* whole app renders in the new palette/type in dark AND light, sweeps
green, tenant form pixel-equivalent, no component code touched.

**P2 — App shell** — sidebar grouped nav (OVERVIEW / CRM / COMMUNICATIONS /
GROWTH, mono labels, accent rail + `--accent-dim` active bg, unread badges),
pinned footer (Settings + setup meter), client switcher w/ avatar +
timezone, topbar AI presence indicator ("● Sofía · on a call" / "✓ N calls
handled"). *Exit:* shell matches mockup at every viewport height; badge
counts live.

**P3 — Dashboard** — KPI tiles (display face, tabular digits, every metric
with delta/sparkline/period per rule 1), charts per the chart section
(single-hue, rounded tops, tooltips, muted weekends, mono axes).
*Exit:* dashboard matches "The dashboard, in both directions" mockup.

**P4 — Tables + record drawers** — whole-row targets, `--surface-2` hover,
focus rings, bulk-action bar, right-side drawer over list (Esc closes, deep
link opens full page), inline small edits with undo toasts.
*Exit:* contacts + calls lists on the pattern; one drawer (contact detail)
shipped as the exemplar.

**P5 — Setup wizard two-pane** — stepper rail (done/current/todo/locked-
with-reason) + step detail pane; Setup leaves nav when complete. Folds in
the recorded wizard findings (rename-after-create affordance; assign-vs-move
error copy; provisioned→testing surfacing).
*Exit:* the dogfood-walk friction list is closed.

**P6 — Command palette + /styleguide** — ⌘K over contacts/calls/
conversations/settings-sections/actions with a registered settings index;
`/styleguide` page rendering every component/variant (and added to DoD
enforcement for later PRs).

**P7 — Client-customer surfaces** — booking page branded card (logo, step
dots, "Powered by BIS" footer), form + email templates aligned to tokens
through the theming engine. Deliberately LAST: these are revenue surfaces
with proven deliverability/branding behavior — they move only when the
system is stable everywhere else.

**Explicitly deferred, not planned:** role-based default theme (dark-first
for agency operators, light for client users) — small, decide after P1
lands; typing-the-name destructive confirms retrofit across old dialogs —
adopt in each phase's touched surfaces, sweep the remainder in P7.

## Order rationale

P1 is prerequisite to everything (tokens must exist before components
consume them). P2/P3 are the highest-visibility operator surfaces — the
"looks finished" payoff — and exercise the tokens broadly before deeper
structural work. P4/P5 change interaction patterns, riskier, so they ride on
a matured foundation. P6 is additive. P7 touches money-adjacent surfaces
last, deliberately.
