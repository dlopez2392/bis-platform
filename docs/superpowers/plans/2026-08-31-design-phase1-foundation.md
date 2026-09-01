# Design Phase 1 — Foundation Cut-over Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** the whole app renders in the DESIGN.md palette and type system, in
dark AND light, with every existing contrast sweep and e2e spec green and
client tenant surfaces unchanged — no component code touched.

**Architecture:** `tokens.css` is restructured to the app's `:root`(light)/
`.dark` scaffolding and imported first; `globals.css`'s semantic variables
are re-pointed at the tokens; `branding/theme.ts`'s BIS palette moves in the
same commit because `branding/theme.test.ts` asserts the two stay in sync.
Contract hexes that fail the AA sweeps get lifted by the recorded procedure
and written back to `tokens.css` + DESIGN.md.

**Tech Stack:** Next 16 / Tailwind v4 (`@theme inline`) / next-themes
(`.dark` class) / next/font · vitest sweeps · Playwright.

## Global Constraints

- Tokens only — no new hard-coded colors/radii/shadows outside `tokens.css`
  and the two sanctioned literal islands (sidebar block, stage colors).
- `branding/theme.test.ts` sweep thresholds are gates: fg/bg ≥ 4.5, primary
  itself ≥ 4.5 on card AND background, ring ≥ 3.0 (see test lines 130-160).
- Per-client branding overrides `--accent` only (DESIGN.md); tenant-theme
  e2e + public-form-theme e2e must pass unchanged.
- `--stage-1..6` (pipeline) and the dark-in-both-themes sidebar block stay
  as literals this phase — recorded, revisited in P3/P4.
- Deviations from the delivered tokens file (scaffolding polarity, the
  `--ring` rename below) are recorded in DESIGN.md's Installation status.
- E2e runs wipe nothing live anymore, but still: no e2e while a human is
  mid-test on any live account.

**Name-collision resolution (locked):** the contract's alpha glow token
`--ring: rgba(…)` is renamed `--ring-glow` in tokens.css; the shadcn solid
`--ring` in globals becomes `var(--accent)`. Both recorded in DESIGN.md.

---

### Task 1: Bricolage Grotesque + `--font-display`

**Files:**
- Modify: `apps/web/src/app/(dashboard)/layout.tsx` (font block, ~line 2-40)
- Modify: `apps/web/src/app/(dashboard)/globals.css` (`@theme inline`)
- Test: `apps/web/src/lib/branding/design-foundation.test.ts` (create)

**Interfaces:**
- Produces: CSS var `--font-display` resolving to Bricolage Grotesque with
  Geist fallback; consumed by P2/P3 components and `.kpi-value`.

- [ ] **Step 1: failing test** — create `design-foundation.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const globals = readFileSync(
  join(__dirname, "../../app/(dashboard)/globals.css"), "utf-8");

describe("design foundation: fonts", () => {
  it("exposes --font-display mapped to the Bricolage variable", () => {
    expect(globals).toMatch(/--font-display:\s*var\(--font-bricolage\)/);
  });
});
```

- [ ] **Step 2: run** `pnpm --filter web exec vitest run src/lib/branding/design-foundation.test.ts` — expect FAIL (no match).
- [ ] **Step 3: implement** — in `layout.tsx` beside the existing Geist consts:

```ts
import { Bricolage_Grotesque, Geist, Geist_Mono, Inter, Source_Serif_4 } from "next/font/google";

// Display face — page titles and KPI numbers ONLY (DESIGN.md type roles).
// Variable font: weight 650 is picked at the use site, not loaded per-weight.
const bricolage = Bricolage_Grotesque({
  subsets: ["latin"],
  variable: "--font-bricolage",
});
```

and add `bricolage.variable` to the same className list the existing font
variables are joined into (match the file's current pattern exactly). In
`globals.css` `@theme inline`, under the two existing font lines:

```css
  --font-display: var(--font-bricolage);
```

- [ ] **Step 4: run test** — expect PASS. Also `pnpm --filter web exec tsc --noEmit`.
- [ ] **Step 5: commit** `feat(design): load Bricolage Grotesque and expose --font-display`

---

### Task 2: restructure `tokens.css` to app scaffolding

**Files:**
- Modify: `apps/web/src/styles/tokens.css` (full rewrite, values preserved)
- Modify: `DESIGN.md` (Installation status: record the two deviations)
- Test: extend `design-foundation.test.ts`

**Interfaces:**
- Produces: `:root`-scoped LIGHT tokens and `.dark`-scoped DARK tokens named
  `--surface-0..3 --line --line-strong --text-1..3 --accent --accent-strong
  --accent-dim --ring-glow --good/--warn/--crit(+-bg) --radius-ctl
  --radius-card --radius-pill --shadow-card --ease-hover --ease-panel
  --font-display/ui/mono`. NO `body`, `:focus-visible`, or
  `prefers-reduced-motion` rules remain in this file (they move to
  globals.css in Task 4). Exemplar classes (.label .card .btn .pill
  .kpi-value .row-interactive .sidebar__* .skeleton) stay.

- [ ] **Step 1: failing test** — add to `design-foundation.test.ts`:

```ts
const tokens = readFileSync(
  join(__dirname, "../../styles/tokens.css"), "utf-8");

describe("design foundation: tokens scaffolding", () => {
  it("uses the app's :root(light)/.dark polarity, not data-theme", () => {
    expect(tokens).not.toMatch(/data-theme/);
    expect(tokens).toMatch(/\.dark\s*\{/);
  });
  it("light default: :root carries the light surface ladder", () => {
    expect(tokens).toMatch(/:root\s*\{[^}]*--surface-0:\s*#F6F5FA/i);
  });
  it("dark values live under .dark", () => {
    expect(tokens).toMatch(/\.dark\s*\{[^}]*--surface-0:\s*#0E0D14/i);
  });
  it("carries no base element rules — globals owns those", () => {
    expect(tokens).not.toMatch(/^\s*body\s*\{/m);
    expect(tokens).not.toMatch(/prefers-reduced-motion/);
    expect(tokens).not.toMatch(/:focus-visible/);
  });
  it("renamed the glow token — no bare --ring collision with globals", () => {
    expect(tokens).toMatch(/--ring-glow:/);
    expect(tokens).not.toMatch(/--ring:\s/);
  });
});
```

- [ ] **Step 2: run** — expect FAIL on all five.
- [ ] **Step 3: rewrite tokens.css** — same values, new scaffolding: the
  delivered file's `[data-theme="light"]` block becomes `:root`, the
  delivered `:root` (dark) block becomes `.dark`, `--ring` → `--ring-glow`
  in both blocks and in `.btn`'s box-shadow, and delete the `body`,
  `@media (prefers-reduced-motion…)`, and `:focus-visible` rules (Task 4
  re-homes them). Keep the header comment + all exemplar classes verbatim.
  Note the font vars: keep `--font-display/--font-ui/--font-mono` with the
  delivered stacks as fallbacks (next/font vars take precedence via
  globals' `@theme`).
- [ ] **Step 4: run test** — expect PASS.
- [ ] **Step 5:** append to DESIGN.md Installation status:

```markdown
Resolved 2026-08-31 (Phase 1): tokens restructured to the app's
`:root`(light)/`.dark` scaffolding — values unchanged; the mockup HTML
remains the visual source of truth. The alpha glow token is `--ring-glow`
(renamed from `--ring`, which the shadcn layer owns as the solid focus
color = `var(--accent)`).
```

- [ ] **Step 6: commit** `feat(design): tokens on app scaffolding, glow token renamed`

---

### Task 3: import + semantic remap + BIS palette (one atomic commit)

**Files:**
- Modify: `apps/web/src/app/(dashboard)/globals.css` (`:root`, `.dark`, first line)
- Modify: `apps/web/src/lib/branding/theme.ts` (BIS palette)
- Tests: the EXISTING `branding/theme.test.ts` sweep is the gate — no new test.

**Interfaces:**
- Consumes: Task 2's token names.
- Produces: every shadcn semantic var resolving to a token; `BIS.light` /
  `BIS.dark` in theme.ts numerically equal to the resolved globals values
  (the sync the sweep asserts).

- [ ] **Step 1:** first line of globals.css (before the tailwind import):

```css
@import "../../styles/tokens.css";
```

- [ ] **Step 2: remap `:root` (light)** — replace the literals:

```css
:root {
  --radius: 0.6875rem; /* 11px — --radius-card; controls converge in P2 */

  --background: var(--surface-0);
  --foreground: var(--text-1);
  --card: var(--surface-1);
  --card-foreground: var(--text-1);
  --popover: var(--surface-1);
  --popover-foreground: var(--text-1);

  --primary: var(--accent);            /* #6D28D9 pending sweep (Step 5) */
  --primary-foreground: #ffffff;       /* re-derive via readableTextOn in Step 5 */
  --secondary: var(--surface-3);
  --secondary-foreground: var(--text-1);
  --muted: var(--surface-3);
  --muted-foreground: var(--text-2);
  --accent-hover: var(--surface-3);    /* shadcn hover surface — see note */
  --accent-foreground: var(--text-1);

  --destructive: var(--crit);
  --success: var(--good);
  --warning: var(--warn);

  --border: var(--line);
  --input: var(--line);
  --ring: var(--accent);

  /* Sidebar is dark in BOTH themes (recorded decision) — violet-biased
     dark-ladder literals, not theme-flipping tokens. */
  --sidebar: #16141E;
  --sidebar-foreground: #A9A3BD;
  --sidebar-accent: #A99EFF;
  --sidebar-border: #28243A;

  --stage-1: #8b5cf6; --stage-2: #0891b2; --stage-3: #2563eb;
  --stage-4: #0d9488; --stage-5: #16a34a; --stage-6: #d97706;
}
```

  ⚠ NOTE on shadcn `--accent`: it is the HOVER SURFACE var (dropdown/command
  hovers), not the brand accent. Keep the shadcn name `--accent` in the
  `@theme inline` mapping but point it at `--surface-3` — i.e. in `:root`
  write `--accent: var(--surface-3)` is IMPOSSIBLE (tokens.css already
  defines `--accent` as the brand violet on `:root`; redefining it here
  would clobber the token for the whole page). RESOLUTION, locked: globals'
  `@theme inline` line `--color-accent: var(--accent);` changes to
  `--color-accent: var(--surface-3);` and
  `--color-accent-foreground: var(--text-1);` — the shadcn hover surface
  reads the ladder directly and the custom property `--accent` remains the
  brand violet everywhere (which is exactly what the tenant branding engine
  overrides). Delete the `--accent`/`--accent-foreground` lines from
  globals' `:root`/`.dark` blocks entirely.

- [ ] **Step 3: remap `.dark`** — same shape (tokens.css's `.dark` block
  already flips the primitives, so most lines are IDENTICAL to `:root` and
  collapse away). The `.dark` block keeps only what differs numerically
  after tokenization:

```css
.dark {
  --primary: var(--accent);           /* #8B7CF7 pending sweep (Step 5) */
  --primary-foreground: #111111;      /* re-derive in Step 5 */
  --destructive: var(--crit);
  --success: var(--good);
  --warning: var(--warn);
  --sidebar: #131120;                 /* keep current: one step below cards */
  --sidebar-foreground: #A9A3BD;
  --sidebar-accent: #A99EFF;
  --sidebar-border: #28243A;
  --stage-1: #a78bfa; --stage-2: #22d3ee; --stage-3: #60a5fa;
  --stage-4: #2dd4bf; --stage-5: #4ade80; --stage-6: #fbbf24;
}
```

  (Vars that now read `var(--token)` in `:root` resolve per-theme through
  tokens.css's own `.dark` block — they need no `.dark` repetition here.
  Keep the file's existing explanatory comments where they still apply;
  delete the ones about hexes that no longer exist.)

- [ ] **Step 4: theme.ts BIS palette** — set `BIS.light`/`BIS.dark` to the
  RESOLVED hex values of the remap (light: background #F6F5FA, card
  #FFFFFF, primary #6D28D9, ring #6D28D9, border #E8E5F0, muted #F1EFF7,
  mutedForeground #5D5876, foreground #1D1930, sidebar #16141E …; dark:
  background #0E0D14, card #16141E, primary #8B7CF7, ring #8B7CF7, border
  #28243A, mutedForeground #A9A3BD, foreground #F2F0F7 …), updating the
  block comments to say the values now come from `tokens.css`.
- [ ] **Step 5: run the sweep** —
  `pnpm --filter web exec vitest run src/lib/branding/theme.test.ts`.
  EXPECTED: failures naming exact pairs (e.g. `primary on card dark`).
  For each failure, LIFT the failing value by the recorded procedure (same
  hue/sat, minimum change to clear; `readableTextOn()` decides the
  foreground), write the lifted hex into BOTH `tokens.css` (`--accent` /
  `--accent-strong` as applicable) and `theme.ts`, and record old→new in
  DESIGN.md Installation status. Re-run until green. If `#6D28D9` /
  `#8B7CF7` pass untouched, record that instead.
- [ ] **Step 6: full unit suite** `pnpm --filter web test` — the sync
  assertions in theme.test.ts read globals.css; expect green.
- [ ] **Step 7: commit** `feat(design): semantic variables cut over to the DESIGN.md tokens`

---

### Task 4: base rules — focus ring, reduced motion, radius exposure

**Files:**
- Modify: `apps/web/src/app/(dashboard)/globals.css` (after the body rule)
- Test: extend `design-foundation.test.ts`

- [ ] **Step 1: failing test:**

```ts
describe("design foundation: base rules", () => {
  it("globals owns the focus ring and the reduced-motion kill switch", () => {
    expect(globals).toMatch(/:focus-visible/);
    expect(globals).toMatch(/prefers-reduced-motion/);
  });
});
```

- [ ] **Step 2: run** — FAIL. **Step 3: implement** in globals.css:

```css
/* DESIGN.md base rules — visible keyboard focus everywhere, and motion
   fully honors the OS setting. Un-layered on purpose: these must beat the
   Tailwind layers. */
:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}

@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation: none !important;
    transition: none !important;
  }
}
```

- [ ] **Step 4: run test** — PASS. Run `pnpm --filter web test` (nothing else moves).
- [ ] **Step 5: commit** `feat(design): global focus ring + reduced-motion base rules`

---

### Task 5: visual verification pass (both themes + tenant surfaces)

**Files:**
- Create (TEMPORARY, deleted in this task): `apps/web/e2e/design-screens.spec.ts`

Uses the recorded technique: a throwaway Playwright spec riding the
self-cleaning auth fixtures, screenshots to the scratchpad, then deleted.

- [ ] **Step 1:** temp spec — for each of `/dashboard/accounts` (agency),
  the fixture account's `/contacts`, `/calendar`, `/setup`, and the
  fixture's public form `/f/<formPublicId from client-fixture.json>` +
  booking page: screenshot in light, click the theme toggle, screenshot in
  dark. Save PNGs to the scratchpad.
- [ ] **Step 2:** run ONLY this spec (`pnpm --filter web test:e2e design-screens`).
- [ ] **Step 3:** review every pair: no unreadable text, no white-on-white,
  sidebar still dark in both, tenant form still renders ITS brand color
  (not the new violet — the branding engine must keep winning). Fix at the
  token/mapping level only; re-shoot.
- [ ] **Step 4:** danlo eyeballs the shots (checkpoint — this is the "does
  it look like the mockup direction" human gate).
- [ ] **Step 5:** delete the temp spec. Commit anything fixed:
  `fix(design): <finding>`.

---

### Task 6: full gates + ledger + wrap

- [ ] `pnpm check` exit 0 · `pnpm --filter web build` · full e2e 37/37.
- [ ] DESIGN.md Installation status updated: import LIVE, lifted values (if
  any) recorded; delete the "deferred" language.
- [ ] Ledger entry in `.superpowers/sdd/progress.md` (P1 section: what
  shipped, lifted values, deviations, screenshots location).
- [ ] Whole-branch review before merge (house rule), then hand danlo the
  merge decision.

## Self-review notes

- Spec coverage: contract Foundations §type/§surfaces/§shape land via Tasks
  1-4; Rules/patterns/charts are P2+ scope by roadmap design.
- The `@theme inline --color-accent` resolution in Task 3 is the load-
  bearing subtlety; it is spelled out inline where the implementer needs it.
- Sweep-driven lifts cannot be precomputed — the plan encodes the exact
  procedure, gates, and write-back locations instead of guessed hexes.
