# Northern Lights Visual Refresh — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the dashboard a light source, glass surfaces, a second accent and one hero number per screen — through tokens only — without changing any component's shape or copy, in two PRs (Foundation, then Data surfaces).

**Architecture:** All new material lives in `tokens.css` (per-mode values) and a handful of named `@utility` classes in `(dashboard)/globals.css` (`glass`, `glass-overlay`, `sidebar-chrome`, `btn-primary`, `pill-on`, `hero-text`, `bar-accent`, `bar-hot`); components only swap class names. A fixed, non-interactive `<Ground />` layer paints the three glows and the masked grid behind sidebar and content. `deriveTheme` gains `accent2`, and `themeStyle` starts emitting `--accent`/`--accent-2` (+ dims, glows) so a themed tenant's glass, glows and hero follow their brand. Data surfaces (StatTile `hero`, Sparkline fill, DailyChart gradient + second series) land in PR 2.

**Tech Stack:** Next.js 16 App Router, Tailwind v4 (`@theme inline`, `@utility`), shadcn/ui, next-themes (`.dark` on `<html>`), vitest (unit; `renderToStaticMarkup` for component render tests — the convention in `calls-chart-card.test.ts`), Playwright (e2e). `packages/db` is NOT touched.

**Spec:** `docs/superpowers/specs/2026-09-08-visual-refresh-northern-lights-design.md`. **Mockup (wins on disagreement):** `docs/design/northern-lights.html` (`.dir-a` block, lines 156–190).

## Global Constraints

- Tokens only: no hard-coded colors/radii/shadows in components — including the new glow/glass tokens. (Spec §12; DESIGN.md.)
- Radii unchanged: 8 / 11 / 999. (Spec §3.5.) The mockup's 12px card radius renders at the contract's 11px.
- No new typefaces; type roles unchanged (Bricolage 650 display, Geist UI, Geist Mono labels). (§3.5)
- Nothing animates on scroll; glows are static; hovers 150ms; reduced-motion respected. (§8)
- Blur only on: Card, sidebar, overlays (dialog/drawer/popover/palette/toast). Never on table rows, list items, badges, inputs inside long lists. (§9)
- Gradient text only at display size ≥ 22px, and only on the elements §5 names. (§3.4)
- One hero per screen; a screen with no KPI has no hero. (§5)
- Status never by color alone — dot + word (unchanged). (§8)
- One primary button per view; everything else ghost. (DESIGN.md rule 8; §4)
- Every change renders in dark AND light (keyed on `.dark`) AND under `@supports not (backdrop-filter: blur(1px))`. (§3.2, §12)
- Copy unchanged ("landscaper at 7 AM" read still passes). New strings only where a new element needs one (the chart legend), through `lib/messages.ts`. (§12)
- Second accent `--accent-2` appears ONLY in: glow 2; the second chart series; the far end of the active rail gradient (`--sidebar-tint-2`); the second stop of the hero gradient. (§3.3 as amended 2026-09-08 — the toast accent word was dropped.)
- Value mirrors move in lockstep in the same commit as the tokens: `neutral-ramps.ts` `SIDEBAR_FOREGROUND`, `theme-style.ts` `SAFE_STYLE_FALLBACKS`, `theme.test.ts` parity, `design-foundation.test.ts`. (§6)
- Commands: repo-root commands start `cd /c/Users/danlo/bis-platform && …`; unit tests `cd /c/Users/danlo/bis-platform/apps/web && npx vitest run <bracket-free substring>` — a `-t`/path filter that matches nothing silently passes, so read the failed test NAME, never just the exit code. Typecheck `pnpm --filter web typecheck`; lint `pnpm --filter web lint`; e2e `npx playwright test styleguide.spec.ts` (from `apps/web`).
- Commit bodies via single quotes or `-F <file>`; NEVER backticks inside a double-quoted `-m`. Branch: `design/northern-lights`. Never push `main`; PR-only.

## Planning findings the executor must know (verified against source 2026-09-08)

1. **`--accent` is NOT the brand today.** `theme-style.ts:50-58` deliberately emits no `--accent`; the brand drives `--primary` only, and components paint the brand with `bg-primary`/`text-primary`. Spec §6's premise ("the brand color replaces `--accent` exactly as today") is false. Task 3 makes the spec's INTENT true by emitting `--accent`, `--accent-strong`, `--accent-dim`, `--ring-glow`, `--accent-2`, `--accent-2-dim`, `--ring-glow-2` from `themeStyle`. Until Task 3 lands, anything painted from `var(--accent)` is BIS violet for themed tenants — which is why Task 3 precedes every component task.
2. **The sentence emphasis field is `strong`, not "emphasis":** `lib/website/sentence.ts:3` — `export type SentenceSegment = { text: string; strong?: true };`.
3. **The sentence panel is 17px** (`website-section.tsx:40`, `text-[17px]`) but §3.4 forbids gradient text under 22px and the mockup sets `--sentence-size: 24px`. Task 11 lifts the sentence to 24px (mockup wins) so the §5 gradient emphasis is legal.
4. **Composite contrast — DECIDED 2026-09-08 (spec amended):** dark `--text-3` is lifted from `#6F6987` to `#7B7593` in Task 1 (the old value sits at 3.5:1 on today's opaque card and drops to ≈2.7:1 under glass at the strongest on-canvas glow). Task 7 asserts at the on-canvas peak. If any brand in the sweep still fails muted-text-on-lit-ground in dark (planning arithmetic says `#ffffff`/`#fde047` will, ≈4.1:1), Task 7 applies the decided fallback: `themeStyle` emits the glow alphas halved whenever a brand colour is active; the BIS default keeps .28/.16/.12.
4b. **Hero gradient stops (spec amended, mockup wins):** dark `--gradient-hero` mixes `var(--accent)` 50% and `var(--accent-2)` 60% with white (was 70/80). **Toast accent word: dropped from scope.** **Primary button text:** `text-primary-foreground` (`readableTextOn`), spec amended.
4c. **Sidebar (recorded decision kept):** dark in BOTH themes for the BIS default, implemented with a chrome token set in `tokens.css` (`--sidebar-ground`, `--sidebar-surface`, `--sidebar-line`, `--sidebar-text`, `--sidebar-text-strong`, `--sidebar-tint`, `--sidebar-tint-2`, identical in `:root` and `.dark`) — chrome, not a fifth content surface. globals' `--sidebar*` semantic vars route to them.
5. **`deriveTheme`'s −30° hue rotation does not produce the spec's family names** (OKLCH: violet ≈ 285° → 255° = blue, not cyan; orange ≈ 50° → 20° = red-orange, not yellow). Task 3 asserts the RULE (hue delta, lightness, chroma) not the family names; the BIS default stays the pinned cyan constants.
6. **Render tests exist:** `.test.ts` files use `createElement` + `renderToStaticMarkup` (`dashboard/calls-chart-card.test.ts:1-9`). `"use client"` components with `useState` render fine that way. Files under `src/**/*.test.ts` only (`vitest.config.ts` include) — no `.test.tsx`.
7. **The topbar presence dot is `bg-primary`** (`topbar-presence.tsx:43`), brand-coloured on purpose; the spec's halo uses `--good`. Task 5 implements the spec and records the mismatch in the ledger.
8. `--text-3` is consumed by no `.tsx` in `apps/web/src` (grep 2026-09-08); only `tokens.css`'s `.label` exemplar uses it.

## File Structure

**Created**
- `apps/web/src/lib/branding/oklch.ts` — pure hex ↔ OKLCH conversion + `deriveAccent2`. One responsibility: color math, no I/O.
- `apps/web/src/lib/branding/oklch.test.ts` — round-trip + derivation table tests.
- `apps/web/src/lib/branding/northern-lights.test.ts` — file-reading parity for the new tokens, utilities, `@supports` fallback, `SAFE_STYLE_FALLBACKS`.
- `apps/web/src/components/ground.tsx` — the fixed glow + grid layer (`<Ground />`).
- `apps/web/src/components/ground.test.ts` — render test: token-only, non-interactive.
- `apps/web/src/components/ui/material.test.ts` — Card/Skeleton/EmptyState render + overlay/table/sidebar class scans.
- `apps/web/src/components/ui/button.test.ts` — variant class tests + input/select/textarea focus scans.
- `apps/web/src/components/sparkline.test.ts` — fill/stroke values.
- `apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/website/daily-chart.test.ts` — gradient class, second series, legend, gridlines, same-axis.
- `apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/website/website-section.test.ts` — one hero, legend, sentence emphasis.
- `apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/dashboard/hero.test.ts` — one `hero` prop on the Dashboard page's tiles.

**Modified**
- `apps/web/src/styles/tokens.css` — surface/line/text values, glow alphas, material tokens, `--accent-2` family, sidebar chrome tokens, `--gradient-hero`, `--gradient-primary`, `--shadow-*`, `@supports` fallback.
- `apps/web/src/app/(dashboard)/globals.css` — `--popover` → overlay, sidebar semantic vars routed to the chrome tokens, `:focus-visible` exclusions, `@utility` classes.
- `apps/web/src/lib/branding/design-foundation.test.ts` — dark `--surface-0` value.
- `apps/web/src/lib/branding/neutral-ramps.ts` — `SIDEBAR_FOREGROUND` follows dark `--text-2`.
- `apps/web/src/lib/branding/theme.ts` — `ResolvedTheme.accent2`, `deriveTheme` derivation, `BIS.*.accent2` constants.
- `apps/web/src/lib/branding/theme-style.ts` — emits the accent family.
- `apps/web/src/lib/branding/theme.test.ts` — sidebar parity retarget, `accent2` table, composite contrast.
- `apps/web/src/lib/branding/theme-style.test.ts` — new emitted keys.
- `apps/web/src/app/(dashboard)/dashboard/layout.tsx` — mounts `<Ground />`.
- `apps/web/src/components/ui/{card,skeleton,dialog,sheet,popover,select,dropdown-menu,command,table,sonner,button,input,textarea,badge}.tsx` — class swaps only.
- `apps/web/src/components/{topbar,topbar-presence,empty-state,app-sidebar,stat-tile,sparkline}.tsx` — class swaps; StatTile gains `hero`.
- `apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/website/{page,daily-chart,website-section}.tsx` — pills, chart, hero + second series.
- `apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/dashboard/page.tsx` — `hero` on calls answered.
- `apps/web/src/lib/messages.ts` — one legend string.
- `apps/web/src/app/(dashboard)/dashboard/styleguide/page.tsx` — "Ground & light" section; chart section gains hero tile + second series.
- `apps/web/e2e/styleguide.spec.ts` — material check in both themes; one hero on the styleguide.
- `DESIGN.md` — five amendments + mockup line.

---

# Phase A — PR 1 Foundation

### Task 1: Tokens — surfaces, glow alphas, material, second accent, fallback

**Files:**
- Modify: `apps/web/src/styles/tokens.css` (`:root` lines 9–51; `.dark` lines 54–96; append after line 96)
- Modify: `apps/web/src/lib/branding/design-foundation.test.ts:48`
- Create: `apps/web/src/lib/branding/northern-lights.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces (custom properties every later task reads): `--surface-0..3`, `--line`, `--line-strong`, `--text-1..3`, `--accent-2`, `--accent-2-dim`, `--ring-glow-2`, `--gradient-hero`, `--gradient-primary`, `--glow-1-alpha`, `--glow-2-alpha`, `--glow-3-alpha`, `--grid-alpha`, `--glass-blur`, `--glass-highlight`, `--sheen`, `--surface-overlay`, `--shadow-card`, `--shadow-glow`, `--shadow-overlay`.

- [ ] **Step 1: Write the failing parity test**

Create `apps/web/src/lib/branding/northern-lights.test.ts`:

```ts
// apps/web/src/lib/branding/northern-lights.test.ts
//
// File-reading parity for the Northern Lights material (spec §3). Same shape
// as design-foundation.test.ts: the CSS is data, so the test reads it and pins
// the values the mockup (docs/design/northern-lights.html, .dir-a) fixed.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SAFE_STYLE_FALLBACKS } from "./theme-style";

const here = path.dirname(fileURLToPath(import.meta.url));
const tokens = readFileSync(path.join(here, "../../styles/tokens.css"), "utf8");
const globals = readFileSync(path.join(here, "../../app/(dashboard)/globals.css"), "utf8");

const rootBlock = tokens.match(/:root\s*\{([^}]*)\}/)![1]!;
const darkBlock = tokens.match(/\.dark\s*\{([^}]*)\}/)![1]!;
const value = (block: string, token: string) =>
  block.match(new RegExp(`--${token}:\\s*([^;]+);`))?.[1]?.trim();

describe("tokens.css — Northern Lights (spec §3)", () => {
  it.each([
    ["surface-0", "#0B0A12"], ["surface-1", "rgba(255,255,255,.035)"],
    ["surface-2", "rgba(255,255,255,.06)"], ["surface-3", "rgba(255,255,255,.09)"],
    ["line", "rgba(255,255,255,.08)"], ["line-strong", "rgba(255,255,255,.14)"],
    ["text-1", "#F1EEFA"], ["text-2", "#9A94B4"], ["text-3", "#7B7593"],
    ["glow-1-alpha", ".28"], ["glow-2-alpha", ".16"], ["glow-3-alpha", ".12"], ["grid-alpha", ".025"],
    ["glass-blur", "14px"], ["glass-highlight", "inset 0 1px 0 rgba(255,255,255,.06)"],
    ["sheen", "linear-gradient(180deg, rgba(255,255,255,.03), transparent 40%)"],
    ["surface-overlay", "rgba(22,20,34,.88)"],
    ["shadow-card", "var(--glass-highlight), 0 20px 50px -30px rgba(0,0,0,.8)"],
    ["shadow-glow", "0 0 0 1px color-mix(in srgb, var(--accent) 50%, transparent), 0 8px 24px -8px color-mix(in srgb, var(--accent) 70%, transparent)"],
    ["shadow-overlay", "var(--glass-highlight), 0 16px 40px -16px rgba(0,0,0,.9)"],
    ["accent-2", "#4FD8E6"], ["accent-2-dim", "rgba(79, 216, 230, .14)"], ["ring-glow-2", "rgba(79, 216, 230, .35)"],
    ["gradient-hero", "linear-gradient(90deg, color-mix(in srgb, var(--accent) 50%, white), color-mix(in srgb, var(--accent-2) 60%, white))"],
    ["gradient-primary", "linear-gradient(180deg, color-mix(in srgb, var(--accent) 70%, white), var(--accent))"],
  ])("dark --%s is %s", (token, expected) => {
    expect(value(darkBlock, token)).toBe(expected);
  });

  // Sidebar chrome: dark in BOTH themes (recorded decision) — identical values in both blocks.
  it.each([
    ["sidebar-ground", "#0B0A12"], ["sidebar-surface", "rgba(255,255,255,.02)"], ["sidebar-line", "rgba(255,255,255,.07)"],
    ["sidebar-text", "#B9B3CF"], ["sidebar-text-strong", "#FFFFFF"], ["sidebar-tint", "#8B7CF7"], ["sidebar-tint-2", "#4FD8E6"],
  ])("--%s is %s in :root AND .dark", (token, expected) => {
    expect(value(rootBlock, token)).toBe(expected);
    expect(value(darkBlock, token)).toBe(expected);
  });

  it.each([
    ["surface-0", "#F6F5FA"], ["surface-1", "#FFFFFF"], ["surface-2", "#FFFFFF"], ["surface-3", "#F1EFF7"],
    ["glow-1-alpha", ".07"], ["glow-2-alpha", ".05"], ["glow-3-alpha", ".04"], ["grid-alpha", ".012"],
    ["glass-blur", "0px"], ["glass-highlight", "inset 0 1px 0 rgba(255,255,255,.9)"], ["sheen", "none"],
    ["surface-overlay", "rgba(255,255,255,.96)"],
    ["shadow-card", "0 1px 2px rgba(29,25,48,.05), 0 12px 32px -18px rgba(29,25,48,.22)"],
    ["shadow-glow", "0 0 0 1px color-mix(in srgb, var(--accent) 25%, transparent), 0 8px 24px -8px color-mix(in srgb, var(--accent) 35%, transparent)"],
    ["shadow-overlay", "var(--glass-highlight), 0 12px 32px -18px rgba(29,25,48,.22)"],
    ["accent-2", "#0891B2"], ["accent-2-dim", "rgba(8, 145, 178, .14)"], ["ring-glow-2", "rgba(8, 145, 178, .28)"],
    ["gradient-hero", "linear-gradient(90deg, var(--accent), var(--accent-2))"],
    ["gradient-primary", "linear-gradient(180deg, var(--accent), var(--accent-strong))"],
  ])("light --%s is %s", (token, expected) => {
    expect(value(rootBlock, token)).toBe(expected);
  });

  it("swaps the dark glass steps to opaque composites when backdrop-filter is unsupported", () => {
    const fallback = tokens.match(/@supports not \(backdrop-filter: blur\(1px\)\)\s*\{\s*\.dark\s*\{([^}]*)\}/)?.[1];
    expect(fallback).toBeTruthy();
    expect(value(fallback!, "surface-1")).toBe("#15131F");
    expect(value(fallback!, "surface-2")).toBe("#1B1826");
    expect(value(fallback!, "surface-3")).toBe("#211D2E");
  });

  it("keeps the fallback AFTER the main .dark block, so theme.test.ts's first-match regex still reads the live values", () => {
    expect(tokens.indexOf("@supports not")).toBeGreaterThan(tokens.indexOf(".dark {"));
  });

  it("keeps SAFE_STYLE_FALLBACKS.color equal to the light --surface-0", () => {
    expect(SAFE_STYLE_FALLBACKS.color).toBe(value(rootBlock, "surface-0")!.toLowerCase());
  });
});

describe("globals.css — semantic mapping (spec §3.2, §4)", () => {
  const gRoot = globals.match(/:root\s*\{([^}]*)\}/)![1]!;
  const gDark = globals.match(/\.dark\s*\{([^}]*)\}/)![1]!;

  it("floats every overlay on --surface-overlay through --popover", () => {
    expect(gRoot).toMatch(/--popover:\s*var\(--surface-overlay\);/);
  });

  it("routes the sidebar semantic vars to the chrome tokens (no literal island, dark in both themes)", () => {
    expect(gRoot).toMatch(/--sidebar:\s*var\(--sidebar-surface\);/);
    expect(gRoot).toMatch(/--sidebar-foreground:\s*var\(--sidebar-text\);/);
    expect(gRoot).toMatch(/--sidebar-accent:\s*var\(--sidebar-tint\);/);
    expect(gRoot).toMatch(/--sidebar-border:\s*var\(--sidebar-line\);/);
    expect(gDark).not.toMatch(/--sidebar/);
  });

  it("sidebar-chrome paints the chrome ground under the (tenant-overridable) --sidebar layer, with blur", () => {
    const body = globals.match(/@utility sidebar-chrome\s*\{([^}]*)\}/)![1]!;
    expect(body).toMatch(/background-color:\s*var\(--sidebar-ground\);/);
    expect(body).toMatch(/background-image:\s*linear-gradient\(var\(--sidebar\), var\(--sidebar\)\);/);
    expect(body).toMatch(/backdrop-filter:\s*blur\(var\(--glass-blur\)\);/);
  });

  it.each(["glass", "glass-overlay", "sidebar-chrome", "btn-primary", "pill-on", "hero-text", "bar-accent", "bar-hot"])(
    "defines the %s utility", (name) => {
      expect(globals).toMatch(new RegExp(`@utility ${name}\\s*\\{`));
    });

  it("glass = sheen + shadow-card + blur(var(--glass-blur)), never a background colour (tenant --card must win)", () => {
    const body = globals.match(/@utility glass\s*\{([^}]*)\}/)![1]!;
    expect(body).toMatch(/background-image:\s*var\(--sheen\);/);
    expect(body).toMatch(/box-shadow:\s*var\(--shadow-card\);/);
    expect(body).toMatch(/backdrop-filter:\s*blur\(var\(--glass-blur\)\);/);
    expect(body).not.toMatch(/background-color/);
  });

  it("hero-text clips --gradient-hero to text", () => {
    const body = globals.match(/@utility hero-text\s*\{([^}]*)\}/)![1]!;
    expect(body).toMatch(/background-image:\s*var\(--gradient-hero\);/);
    expect(body).toMatch(/background-clip:\s*text;/);
  });

  it("carries no hex literal outside the sanctioned islands (--primary-foreground, --stage-1..6)", () => {
    const stripped = globals
      .replace(/--primary-foreground:\s*#[0-9a-fA-F]{6};/g, "")
      .replace(/--stage-[1-6]:\s*#[0-9a-fA-F]{6};/g, "");
    expect(stripped).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
  });
});
```

- [ ] **Step 2: Run it and see it fail**

Run: `cd /c/Users/danlo/bis-platform/apps/web && npx vitest run northern-lights`
Expected: FAIL — `dark --surface-0 is #0B0A12` (received `#0E0D14`), every new token `undefined`, `@supports` block missing, `@utility glass` missing.

- [ ] **Step 3: Rewrite the two token blocks**

In `apps/web/src/styles/tokens.css`, replace lines 3 and 9–96 so the file reads (the exemplar classes from line 98 on are unchanged):

```css
/* ============================================================
   BIS Platform — design tokens
   Source of truth: docs/design/northern-lights.html (.dir-a block)
   History: docs/design/bis-design-direction.html
   Wire components to tokens ONLY. Never hard-code a color,
   radius, or shadow in a component.
   ============================================================ */

/* ---------- light (default) ---------- */
:root {
  /* surface ladder: page → card → nested → raised (light stays solid) */
  --surface-0: #F6F5FA;
  --surface-1: #FFFFFF;
  --surface-2: #FFFFFF;
  --surface-3: #F1EFF7;
  /* anything floating over scrolling content — text must never read through */
  --surface-overlay: rgba(255,255,255,.96);

  --line:        #E8E5F0;
  --line-strong: #D8D4E6;

  --text-1: #1D1930;
  --text-2: #5D5876;
  --text-3: #8B86A0;

  /* accent is per-mode: desaturated on dark, full on light.
     The per-client branding engine (theme-style.ts) overrides the whole
     accent family below, so nothing here is hard-wired to violet. */
  --accent:        #6D28D9;
  --accent-strong: #5B21B8;
  --accent-dim:    rgba(109, 40, 217, .09);
  --ring-glow:     rgba(109, 40, 217, .28);

  /* second accent — pinned for the BIS default, derived for a brand
     (deriveTheme). Appears ONLY where the Northern Lights spec §3.3 lists. */
  --accent-2:     #0891B2;
  --accent-2-dim: rgba(8, 145, 178, .14);
  --ring-glow-2:  rgba(8, 145, 178, .28);

  /* sidebar CHROME, not a fifth content surface: the rail is dark in BOTH
     themes (recorded decision), so these are identical in :root and .dark.
     --sidebar-surface is the mockup's .02 glass over --sidebar-ground; the
     tints are the dark-mode accents as seen on that chrome. globals.css's
     --sidebar* semantic vars route here; theme-style.ts overrides them per
     tenant with the neutral ramp's own dark sidebar. */
  --sidebar-ground:      #0B0A12;
  --sidebar-surface:     rgba(255,255,255,.02);
  --sidebar-line:        rgba(255,255,255,.07);
  --sidebar-text:        #B9B3CF;
  --sidebar-text-strong: #FFFFFF;
  --sidebar-tint:        #8B7CF7;
  --sidebar-tint-2:      #4FD8E6;

  /* the lit ground (Ground component): three static radial glows + a masked grid */
  --glow-1-alpha: .07;
  --glow-2-alpha: .05;
  --glow-3-alpha: .04;
  --grid-alpha:   .012;

  /* material: light cards are solid, so blur is 0 and the sheen is off */
  --glass-blur:      0px;
  --glass-highlight: inset 0 1px 0 rgba(255,255,255,.9);
  --sheen:           none;

  /* gradients — text at display size only (hero) / the ONE primary button */
  --gradient-hero:    linear-gradient(90deg, var(--accent), var(--accent-2));
  --gradient-primary: linear-gradient(180deg, var(--accent), var(--accent-strong));

  /* status — always rendered with dot + text label, never color alone */
  --good: #15803D;  --good-bg: rgba(21, 128, 61, .10);
  --warn: #B45309;  --warn-bg: rgba(180, 83, 9, .10);
  --crit: #B91C1C;  --crit-bg: rgba(185, 28, 28, .09);

  /* shape */
  --radius-ctl:  8px;       /* buttons, inputs, chips  */
  --radius-card: 11px;      /* cards, panels, drawers  */
  --radius-pill: 999px;

  /* elevation */
  --shadow-card:    0 1px 2px rgba(29,25,48,.05), 0 12px 32px -18px rgba(29,25,48,.22);
  --shadow-glow:    0 0 0 1px color-mix(in srgb, var(--accent) 25%, transparent), 0 8px 24px -8px color-mix(in srgb, var(--accent) 35%, transparent);
  --shadow-overlay: var(--glass-highlight), 0 12px 32px -18px rgba(29,25,48,.22);

  /* motion */
  --ease-hover: 150ms cubic-bezier(.2,.7,.3,1);
  --ease-panel: 250ms cubic-bezier(.2,.7,.3,1);

  /* type roles */
  --font-display: var(--font-bricolage), "Bricolage Grotesque", "Geist", sans-serif; /* titles + KPI numbers ONLY */
  --font-ui:      "Geist", -apple-system, "Segoe UI", sans-serif;
  --font-mono:    "Geist Mono", ui-monospace, monospace;      /* micro-labels, ids, timestamps */
}

/* ---------- dark ---------- */
.dark {
  /* surface ladder: page → card → nested → raised. Steps 1–3 are glass:
     translucent whites over the lit ground (Ground component). */
  --surface-0: #0B0A12;
  --surface-1: rgba(255,255,255,.035);
  --surface-2: rgba(255,255,255,.06);
  --surface-3: rgba(255,255,255,.09);
  --surface-overlay: rgba(22,20,34,.88);

  --line:        rgba(255,255,255,.08);   /* structural borders */
  --line-strong: rgba(255,255,255,.14);   /* interactive edges  */

  --text-1: #F1EEFA;        /* primary   */
  --text-2: #9A94B4;        /* secondary */
  --text-3: #7B7593;        /* tertiary / labels — lifted from #6F6987 so it clears 3:1 on glass over the lit ground (composite contrast test) */

  --accent:        #8B7CF7;
  --accent-strong: #A99EFF;
  --accent-dim:    rgba(139, 124, 247, .14);
  --ring-glow:     rgba(139, 124, 247, .35);

  --accent-2:     #4FD8E6;
  --accent-2-dim: rgba(79, 216, 230, .14);
  --ring-glow-2:  rgba(79, 216, 230, .35);

  /* sidebar chrome — identical to :root on purpose (see there) */
  --sidebar-ground:      #0B0A12;
  --sidebar-surface:     rgba(255,255,255,.02);
  --sidebar-line:        rgba(255,255,255,.07);
  --sidebar-text:        #B9B3CF;
  --sidebar-text-strong: #FFFFFF;
  --sidebar-tint:        #8B7CF7;
  --sidebar-tint-2:      #4FD8E6;

  --glow-1-alpha: .28;
  --glow-2-alpha: .16;
  --glow-3-alpha: .12;
  --grid-alpha:   .025;

  --glass-blur:      14px;
  --glass-highlight: inset 0 1px 0 rgba(255,255,255,.06);
  --sheen:           linear-gradient(180deg, rgba(255,255,255,.03), transparent 40%);

  --gradient-hero:    linear-gradient(90deg, color-mix(in srgb, var(--accent) 50%, white), color-mix(in srgb, var(--accent-2) 60%, white));
  --gradient-primary: linear-gradient(180deg, color-mix(in srgb, var(--accent) 70%, white), var(--accent));

  /* status — always rendered with dot + text label, never color alone */
  --good: #4ADE97;  --good-bg: rgba(74, 222, 151, .12);
  --warn: #F0B35E;  --warn-bg: rgba(240, 179, 94, .12);
  --crit: #F2708A;  --crit-bg: rgba(242, 112, 138, .12);

  /* shape */
  --radius-ctl:  8px;
  --radius-card: 11px;
  --radius-pill: 999px;

  /* elevation: 1px top highlight + deep soft ambient, no gray blurs */
  --shadow-card:    var(--glass-highlight), 0 20px 50px -30px rgba(0,0,0,.8);
  --shadow-glow:    0 0 0 1px color-mix(in srgb, var(--accent) 50%, transparent), 0 8px 24px -8px color-mix(in srgb, var(--accent) 70%, transparent);
  --shadow-overlay: var(--glass-highlight), 0 16px 40px -16px rgba(0,0,0,.9);

  /* motion */
  --ease-hover: 150ms cubic-bezier(.2,.7,.3,1);
  --ease-panel: 250ms cubic-bezier(.2,.7,.3,1);

  /* type roles */
  --font-display: var(--font-bricolage), "Bricolage Grotesque", "Geist", sans-serif;
  --font-ui:      "Geist", -apple-system, "Segoe UI", sans-serif;
  --font-mono:    "Geist Mono", ui-monospace, monospace;
}

/* Nothing depends on the blur: without backdrop-filter the glass steps
   become the opaque composites they would have rendered as over --surface-0. */
@supports not (backdrop-filter: blur(1px)) {
  .dark {
    --surface-1: #15131F;
    --surface-2: #1B1826;
    --surface-3: #211D2E;
  }
}
```

Then in `apps/web/src/lib/branding/design-foundation.test.ts:48` change `#0E0D14` to `#0B0A12`:

```ts
    expect(tokens).toMatch(/\.dark\s*\{[^}]*--surface-0:\s*#0B0A12/i);
```

- [ ] **Step 4: Run; the token half is green, the globals half still red**

Run: `cd /c/Users/danlo/bis-platform/apps/web && npx vitest run northern-lights design-foundation`
Expected: every `tokens.css —` case PASS; `design-foundation` PASS; the `globals.css —` cases still FAIL (Task 2 owns them). `theme.test.ts` is untouched by this step and still green (`declared(tokensDarkBlock, "accent")` still finds `#8B7CF7`).

- [ ] **Step 5: Mutation check, then commit**

Mutation: set dark `--surface-1` back to `#16141E` → `dark --surface-1 is rgba(255,255,255,.035)` fails. Revert.

```bash
cd /c/Users/danlo/bis-platform && git add apps/web/src/styles/tokens.css apps/web/src/lib/branding/design-foundation.test.ts apps/web/src/lib/branding/northern-lights.test.ts && git commit -m 'feat(design): Northern Lights tokens — glass ladder, glow alphas, material, second accent, blur fallback (globals half of the parity test lands next)'
```

---

### Task 2: globals.css — overlay mapping, sidebar island retired, utilities, mirrors in lockstep

**Files:**
- Modify: `apps/web/src/app/(dashboard)/globals.css:15` (`--popover`), `:32-37` (sidebar island), `:53-56` (`.dark` sidebar copies), `:117-125` (`:focus-visible`), append utilities after line 106 (`@theme inline` close)
- Modify: `apps/web/src/lib/branding/neutral-ramps.ts:53-60`, `apps/web/src/lib/branding/theme.ts:110-111` (`BIS.*.sidebarAccent`)
- Modify: `apps/web/src/lib/branding/theme.test.ts:383-399` (three sidebar parity cases)

**Interfaces:**
- Consumes: Task 1 tokens.
- Produces: utilities `glass`, `glass-overlay`, `sidebar-chrome`, `btn-primary`, `pill-on`, `hero-text`, `bar-accent`, `bar-hot` (class names used verbatim by Tasks 4–6, 9–11, 13). `--popover` = overlay for every Radix surface and Sonner.

- [ ] **Step 1: Retarget the three sidebar parity cases (values only — no case deleted)**

In `apps/web/src/lib/branding/theme.test.ts`, replace the three `it(...)` blocks that start at the comment `// sidebar-accent is a sanctioned literal` (lines 383–399) with:

```ts
  // The sidebar-literal island moved to tokens.css as a CHROME token set
  // (Northern Lights spec §4 as decided 2026-09-08): the four --sidebar*
  // names survive as shadcn semantic vars, ROUTE to --sidebar-tint /
  // --sidebar-text / … in :root, and .dark no longer re-declares them. The
  // hex truth now lives in tokens.css, identical in both blocks — the sidebar
  // is dark in both themes.
  it("keeps :root --sidebar-accent wired to var(--sidebar-tint), and BIS.*.sidebarAccent equal to --sidebar-tint in both token blocks", () => {
    expect(rootBlock).toMatch(/--sidebar-accent:\s*var\(--sidebar-tint\);/);
    expect(BIS.light.sidebarAccent).toBe(declared(tokensRootBlock, "sidebar-tint"));
    expect(BIS.dark.sidebarAccent).toBe(declared(tokensDarkBlock, "sidebar-tint"));
  });

  it("no longer re-declares any --sidebar* name in .dark (the island is gone)", () => {
    expect(darkBlock).not.toMatch(/--sidebar/);
  });

  it("keeps --sidebar-foreground wired to var(--sidebar-text) and SIDEBAR_FOREGROUND equal to --sidebar-text in both token blocks", () => {
    expect(rootBlock).toMatch(/--sidebar-foreground:\s*var\(--sidebar-text\);/);
    expect(SIDEBAR_FOREGROUND).toBe(declared(tokensRootBlock, "sidebar-text"));
    expect(SIDEBAR_FOREGROUND).toBe(declared(tokensDarkBlock, "sidebar-text"));
  });
```

- [ ] **Step 2: Run and see both suites fail**

Run: `cd /c/Users/danlo/bis-platform/apps/web && npx vitest run northern-lights theme.test`
Expected: `keeps :root --sidebar-accent wired to var(--sidebar-tint)…` FAIL (`#A99EFF` literal today; `BIS.light.sidebarAccent` `#a99eff` ≠ `#8b7cf7`); `SIDEBAR_FOREGROUND … equal to --sidebar-text` FAIL (`#a9a3bd` vs `#b9b3cf`); `globals.css —` cases FAIL.

- [ ] **Step 3: Edit globals.css**

Replace line 15 `--popover: var(--surface-1);` with:

```css
  --popover: var(--surface-overlay);   /* every Radix surface + Sonner float over scroll: opaque enough that text never reads through */
```

Replace lines 32–37 (the comment + four sidebar literals) with:

```css
  /* The sidebar's four shadcn names route to tokens.css's CHROME set (dark in
     BOTH themes — recorded decision; the literal island is gone).
     theme-style.ts still overrides them per tenant with the neutral ramp's
     dark sidebar. */
  --sidebar: var(--sidebar-surface);
  --sidebar-foreground: var(--sidebar-text);
  --sidebar-accent: var(--sidebar-tint);
  --sidebar-border: var(--sidebar-line);
```

Delete lines 53–56 in `.dark` (`--sidebar`, `--sidebar-foreground`, `--sidebar-accent`, `--sidebar-border`).

Replace the `:focus-visible` rule (lines 117–125) with:

```css
:focus-visible {
  /* var(--ring), NOT var(--accent): --ring is the token whose derivation is
     LIFTED to ≥3:1 against bg and card (theme.ts), and resolves to the same
     violet when unthemed. Text controls opt out of the hard outline: they
     draw the 3px --ring-glow ring + accent border themselves (spec §4). */
  outline: 2px solid var(--ring);
  outline-offset: 2px;
}
[data-slot="input"]:focus-visible,
[data-slot="textarea"]:focus-visible,
[data-slot="select-trigger"]:focus-visible {
  outline: none;
}
```

Append after the `@theme inline` block's closing `}` (line 106):

```css
/* ---- Northern Lights material (spec §3.2, §4, §5). Named utilities so a
   component swaps one class and the values stay in tokens.css. ---- */
@utility glass {
  /* no background-color: the element keeps bg-card so a tenant's --card wins */
  background-image: var(--sheen);
  box-shadow: var(--shadow-card);
  backdrop-filter: blur(var(--glass-blur));
  -webkit-backdrop-filter: blur(var(--glass-blur));
}
@utility glass-overlay {
  background-color: var(--popover);
  color: var(--popover-foreground);
  box-shadow: var(--shadow-overlay);
  backdrop-filter: blur(var(--glass-blur));
  -webkit-backdrop-filter: blur(var(--glass-blur));
}
@utility sidebar-chrome {
  /* chrome, not a fifth content surface: an opaque dark ground under the
     (tenant-overridable) --sidebar layer, so the rail is dark in both themes */
  background-color: var(--sidebar-ground);
  background-image: linear-gradient(var(--sidebar), var(--sidebar));
  backdrop-filter: blur(var(--glass-blur));
  -webkit-backdrop-filter: blur(var(--glass-blur));
}
@utility btn-primary {
  background-image: var(--gradient-primary);
  box-shadow: var(--shadow-glow);
}
@utility pill-on {
  background-color: var(--accent-dim);
  color: var(--text-1);
  box-shadow: 0 0 0 1px color-mix(in srgb, var(--accent) 35%, transparent), 0 0 18px color-mix(in srgb, var(--accent) 25%, transparent);
}
@utility hero-text {
  background-image: var(--gradient-hero);
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
}
@utility bar-accent {
  background-image: linear-gradient(180deg, color-mix(in srgb, var(--accent) 95%, transparent), color-mix(in srgb, var(--accent) 25%, transparent));
}
@utility bar-hot {
  filter: brightness(1.15);
  box-shadow: 0 0 22px color-mix(in srgb, var(--accent) 45%, transparent);
}
```

- [ ] **Step 4: Move the two mirrors**

In `apps/web/src/lib/branding/neutral-ramps.ts` replace lines 53–60 with:

```ts
/**
 * Mirrors tokens.css's `--sidebar-text` (`#B9B3CF`, identical in :root and
 * .dark): globals.css's `--sidebar-foreground` routes to it since the
 * Northern Lights refresh moved the sidebar-literal island into a chrome
 * token set. Mode-independent on purpose — the sidebar is dark in both
 * themes. theme.test.ts's parity block pins this against tokens.css.
 */
export const SIDEBAR_FOREGROUND = "#b9b3cf";
```

In `apps/web/src/lib/branding/theme.ts:110-111` change both `sidebarAccent: "#a99eff"` to `sidebarAccent: "#8b7cf7"` (tokens.css's `--sidebar-tint`, the mockup's rail start; still ≥ 3:1 on every ramp sidebar — `#8b7cf7` on `#111721` ≈ 5.4:1, which the sweep's `sidebar accent` case re-proves).

- [ ] **Step 5: Run green**

Run: `cd /c/Users/danlo/bis-platform/apps/web && npx vitest run northern-lights theme.test theme-style design-foundation`
Expected: all PASS, including the sweep's `sidebar text` ≥ 4.5 (`#b9b3cf` on `#111721` ≈ 9:1) and `sidebar accent` ≥ 3 (`#8b7cf7` fallback).

- [ ] **Step 6: Mutation check, typecheck, commit**

Mutation: change `--sidebar-accent: var(--sidebar-tint)` to `var(--accent)` → `keeps :root --sidebar-accent wired to var(--sidebar-tint)…` fails. Revert.

```bash
cd /c/Users/danlo/bis-platform && pnpm --filter web typecheck && pnpm --filter web lint && git add "apps/web/src/app/(dashboard)/globals.css" apps/web/src/lib/branding/neutral-ramps.ts apps/web/src/lib/branding/theme.ts apps/web/src/lib/branding/theme.test.ts && git commit -m 'feat(design): overlays float on --surface-overlay, sidebar semantic vars routed to the chrome tokens, Northern Lights utilities; SIDEBAR_FOREGROUND, BIS.sidebarAccent and parity retargeted in lockstep'
```

---

### Task 3: `accent2` derivation + `themeStyle` emits the accent family

**Files:**
- Create: `apps/web/src/lib/branding/oklch.ts`, `apps/web/src/lib/branding/oklch.test.ts`
- Modify: `apps/web/src/lib/branding/theme.ts:64-75` (`ResolvedTheme`), `:109-112` (`BIS`), `:205-260` (`deriveTheme`)
- Modify: `apps/web/src/lib/branding/theme-style.ts:36-74`
- Modify: `apps/web/src/lib/branding/theme.test.ts` (new cases inside `describe("deriveTheme")`, after line 128), `apps/web/src/lib/branding/theme-style.test.ts`

**Interfaces:**
- Consumes: `parseHexColor(input): string | null` (`color.ts:38`), `contrastRatio(a, b): number` (`color.ts:59`), `BIS`, `NEUTRAL_RAMPS`.
- Produces:
  - `hexToOklch(hex: string): { l: number; c: number; h: number }`, `oklchToHex(o: { l: number; c: number; h: number }): string`, `deriveAccent2(hex: string): string` (lower-case `#rrggbb`).
  - `ResolvedTheme.accent2: string`; `BIS.light.accent2 = "#0891b2"`, `BIS.dark.accent2 = "#4fd8e6"`.
  - `themeStyle` emits `--accent`, `--accent-strong`, `--accent-dim`, `--ring-glow`, `--accent-2`, `--accent-2-dim`, `--ring-glow-2` (Task 7 and every `var(--accent)` utility rely on this for tenants).

- [ ] **Step 1: Failing OKLCH tests**

Create `apps/web/src/lib/branding/oklch.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { deriveAccent2, hexToOklch, oklchToHex } from "./oklch";

const wrap = (h: number) => ((h % 360) + 360) % 360;
const hueDelta = (a: number, b: number) => { const d = Math.abs(wrap(a) - wrap(b)); return Math.min(d, 360 - d); };

describe("oklch", () => {
  it.each(["#8b7cf7", "#6d28d9", "#f97316", "#14b8a6", "#dc2626", "#808080", "#000000", "#ffffff"])(
    "round-trips %s within one 8-bit step per channel", (hex) => {
      const back = oklchToHex(hexToOklch(hex));
      for (let i = 1; i < 7; i += 2) {
        expect(Math.abs(parseInt(back.slice(i, i + 2), 16) - parseInt(hex.slice(i, i + 2), 16))).toBeLessThanOrEqual(1);
      }
    });

  it("puts white at L≈1 and black at L≈0 with ~zero chroma", () => {
    expect(hexToOklch("#ffffff").l).toBeCloseTo(1, 2);
    expect(hexToOklch("#000000").l).toBeCloseTo(0, 2);
    expect(hexToOklch("#808080").c).toBeLessThan(0.01);
  });

  it("clamps out-of-gamut results into #rrggbb", () => {
    expect(oklchToHex({ l: 0.95, c: 0.4, h: 30 })).toMatch(/^#[0-9a-f]{6}$/);
  });
});

describe("deriveAccent2 — L +0.18 (clamp .85), C ×0.9, H −30° (spec §3.3)", () => {
  // The RULE is asserted, not the spec's family names: −30° from violet is
  // blue (~255°), not cyan — recorded in the plan's findings.
  it.each([
    ["violet", "#8b7cf7"], ["orange", "#f97316"], ["teal", "#14b8a6"], ["red", "#dc2626"],
  ])("%s: hue rotates −30° (±6°), chroma shrinks, lightness rises", (_name, hex) => {
    const src = hexToOklch(hex);
    const out = hexToOklch(deriveAccent2(hex));
    expect(hueDelta(out.h, src.h - 30)).toBeLessThanOrEqual(6);
    expect(out.c).toBeLessThan(src.c);
    expect(out.l).toBeGreaterThan(src.l);
    expect(out.l).toBeLessThanOrEqual(0.86);
  });

  it("gray → a slightly lighter gray (chroma stays ~0)", () => {
    const out = hexToOklch(deriveAccent2("#808080"));
    expect(out.c).toBeLessThan(0.01);
    expect(out.l).toBeCloseTo(hexToOklch("#808080").l + 0.18, 1);
  });

  it("clamps lightness at .85 for an already-light input", () => {
    expect(hexToOklch(deriveAccent2("#e9d5ff")).l).toBeLessThanOrEqual(0.86);
  });

  it("returns lower-case #rrggbb", () => {
    expect(deriveAccent2("#8B7CF7")).toMatch(/^#[0-9a-f]{6}$/);
  });
});
```

- [ ] **Step 2: Run and see it fail**

Run: `cd /c/Users/danlo/bis-platform/apps/web && npx vitest run oklch`
Expected: FAIL — `Cannot find module './oklch'`.

- [ ] **Step 3: Implement `oklch.ts`**

```ts
// apps/web/src/lib/branding/oklch.ts
//
// Pure hex ↔ OKLCH (Björn Ottosson's matrices) and the second-accent rule
// from the Northern Lights spec §3.3. No I/O, no DOM.
export type Oklch = { l: number; c: number; h: number };

const srgbToLinear = (v: number) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
const linearToSrgb = (v: number) => (v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055);
const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

export function hexToOklch(hex: string): Oklch {
  const n = parseInt(hex.replace("#", ""), 16);
  const r = srgbToLinear(((n >> 16) & 255) / 255);
  const g = srgbToLinear(((n >> 8) & 255) / 255);
  const b = srgbToLinear((n & 255) / 255);
  const l_ = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m_ = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s_ = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const L = 0.2104542553 * l_ + 0.793617785 * m_ - 0.0040720468 * s_;
  const a = 1.9779984951 * l_ - 2.428592205 * m_ + 0.4505937099 * s_;
  const bb = 0.0259040371 * l_ + 0.7827717662 * m_ - 0.808675766 * s_;
  const c = Math.hypot(a, bb);
  const h = ((Math.atan2(bb, a) * 180) / Math.PI + 360) % 360;
  return { l: L, c, h };
}

export function oklchToHex({ l, c, h }: Oklch): string {
  const a = c * Math.cos((h * Math.PI) / 180);
  const bb = c * Math.sin((h * Math.PI) / 180);
  const l_ = (l + 0.3963377774 * a + 0.2158037573 * bb) ** 3;
  const m_ = (l - 0.1055613458 * a - 0.0638541728 * bb) ** 3;
  const s_ = (l - 0.0894841775 * a - 1.291485548 * bb) ** 3;
  const r = 4.0767416621 * l_ - 3.3077115913 * m_ + 0.2309699292 * s_;
  const g = -1.2684380046 * l_ + 2.6097574011 * m_ - 0.3413193965 * s_;
  const b = -0.0041960863 * l_ - 0.7034186147 * m_ + 1.707614701 * s_;
  const to255 = (v: number) => Math.round(clamp01(linearToSrgb(clamp01(v))) * 255).toString(16).padStart(2, "0");
  return `#${to255(r)}${to255(g)}${to255(b)}`;
}

/** Spec §3.3: lightness +0.18 (clamped to 0.85), chroma ×0.9, hue −30°. */
export function deriveAccent2(hex: string): string {
  const { l, c, h } = hexToOklch(hex);
  return oklchToHex({ l: Math.min(0.85, l + 0.18), c: c * 0.9, h: (h - 30 + 360) % 360 });
}
```

- [ ] **Step 4: Run green**

Run: `cd /c/Users/danlo/bis-platform/apps/web && npx vitest run oklch`
Expected: PASS (all cases).

- [ ] **Step 5: Failing `deriveTheme`/`themeStyle` tests**

Inside `describe("deriveTheme", …)` in `theme.test.ts`, after the `it("ignores a colour that is not a real hex", …)` block (ends line 128), add:

```ts
  it("pins accent2 to the BIS constants when no brand colour is set (not derived)", () => {
    const light = deriveTheme({ color: null, neutral: "slate", corners: null, type: null, mode: null }, "light");
    const dark = deriveTheme({ color: null, neutral: "slate", corners: null, type: null, mode: null }, "dark");
    expect(light?.accent2).toBe("#0891b2");
    expect(dark?.accent2).toBe("#4fd8e6");
  });

  it("derives accent2 from the LIFTED primary when a brand colour is set", () => {
    for (const mode of MODES) {
      const t = deriveTheme({ color: "#6d28d9", neutral: "slate", corners: null, type: null, mode: null }, mode)!;
      expect(t.accent2).toBe(deriveAccent2(t.primary));
      expect(t.accent2).toMatch(/^#[0-9a-f]{6}$/);
    }
  });
```

and add `import { deriveAccent2 } from "./oklch";` next to the file's other imports (line 8 area).

In `theme-style.test.ts`, after the existing `expect(style["--sidebar-accent"]).toBe(theme.sidebarAccent);` (line 16) add:

```ts
    expect(style["--accent"]).toBe(theme.primary);
    expect(style["--accent-strong"]).toBe(theme.primary);
    expect(style["--accent-dim"]).toBe(`color-mix(in srgb, ${theme.primary} 14%, transparent)`);
    expect(style["--ring-glow"]).toBe(`color-mix(in srgb, ${theme.ring} 35%, transparent)`);
    expect(style["--accent-2"]).toBe(theme.accent2);
    expect(style["--accent-2-dim"]).toBe(`color-mix(in srgb, ${theme.accent2} 14%, transparent)`);
    expect(style["--ring-glow-2"]).toBe(`color-mix(in srgb, ${theme.accent2} 35%, transparent)`);
    expect(style["--sidebar-tint-2"]).toBe(theme.accent2);
```

(`theme` and `style` are the names that file already uses — `theme-style.test.ts:5-12`.)

- [ ] **Step 6b: Read the two e2e specs that may pin the body style BEFORE changing what it emits**

Read `apps/web/e2e/tenant-theme.spec.ts` and `apps/web/e2e/theme.spec.ts` in full. If either asserts the exact contents of `<body style="…">` / `data-tenant-theme` (e.g. `toHaveAttribute("style", …)`, a snapshot of `style`, or `toHaveCSS` on a value this task changes), update the asserted VALUES in the same commit to include the new declarations — never delete or loosen an assertion. If neither pins it, note "checked: not pinned" in the commit body.

- [ ] **Step 6: Run and see them fail**

Run: `cd /c/Users/danlo/bis-platform/apps/web && npx vitest run theme.test theme-style`
Expected: FAIL — `accent2` is `undefined`; `style["--accent"]` is `undefined`.

- [ ] **Step 7: Implement**

`theme.ts` — add to `ResolvedTheme` (after `sidebarAccent: string; sidebarBorder: string;`, line 73):

```ts
  /** Second accent (spec §3.3): pinned for BIS, derived from the lifted primary for a brand. */
  accent2: string;
```

Replace `BIS` (lines 109–112):

```ts
export const BIS = {
  light: { primary: "#6d28d9", ring: "#6d28d9", sidebarAccent: "#8b7cf7", accent2: "#0891b2" },
  dark:  { primary: "#8b7cf7", ring: "#8b7cf7", sidebarAccent: "#8b7cf7", accent2: "#4fd8e6" },
} as const;
```

(`sidebarAccent` is already `#8b7cf7` after Task 2; the declaration is `as const` in source.)

Add `import { deriveAccent2 } from "./oklch";` after line 10. In `deriveTheme`, after the `ring` block (line 233) add:

```ts
  // Derived from the LIFTED primary, not the raw brand: the primary is what
  // --accent will be on <body>, so the pair is analogous to what renders.
  const accent2 = brand ? deriveAccent2(primary) : bis.accent2;
```

and add `accent2,` to the returned object after `sidebarBorder: ramp.sidebarBorder,`.

`theme-style.ts` — after `"--ring": c(theme.ring),` (line 61) add:

```ts
    // The whole accent family follows the brand (Northern Lights spec §6):
    // glows, rail, hero gradient, primary button and focus glow all read
    // var(--accent)/var(--accent-2) from tokens.css, so a themed tenant's
    // dashboard never shows BIS violet. Alpha variants are built from the
    // already-validated hex, so no tenant text reaches CSS.
    "--accent": c(theme.primary),
    "--accent-strong": c(theme.primary),
    "--accent-dim": `color-mix(in srgb, ${c(theme.primary)} 14%, transparent)`,
    "--ring-glow": `color-mix(in srgb, ${c(theme.ring)} 35%, transparent)`,
    "--accent-2": c(theme.accent2),
    "--accent-2-dim": `color-mix(in srgb, ${c(theme.accent2)} 14%, transparent)`,
    "--ring-glow-2": `color-mix(in srgb, ${c(theme.accent2)} 35%, transparent)`,
    // The far end of the active rail / avatar / meter gradient on the dark chrome.
    "--sidebar-tint-2": c(theme.accent2),
```

- [ ] **Step 8: Run green, typecheck**

Run: `cd /c/Users/danlo/bis-platform/apps/web && npx vitest run theme.test theme-style oklch tenant-theme public-form-theme`
Expected: PASS. Then `cd /c/Users/danlo/bis-platform && pnpm --filter web typecheck` — any other constructor of `ResolvedTheme` (search `ResolvedTheme = {` / `satisfies ResolvedTheme`) now needs `accent2`; add `accent2: "#4fd8e6"` to such fixtures.

- [ ] **Step 9: Mutation check, commit**

Mutation: in `deriveAccent2` change `h - 30` to `h + 30` → the four hue cases fail (delta ≈ 60°). Revert.

```bash
cd /c/Users/danlo/bis-platform && git add apps/web/src/lib/branding/oklch.ts apps/web/src/lib/branding/oklch.test.ts apps/web/src/lib/branding/theme.ts apps/web/src/lib/branding/theme.test.ts apps/web/src/lib/branding/theme-style.ts apps/web/src/lib/branding/theme-style.test.ts apps/web/e2e/tenant-theme.spec.ts apps/web/e2e/theme.spec.ts && git commit -m 'feat(design): deriveTheme gains accent2 (OKLCH L+.18 C*.9 H-30, BIS pinned); themeStyle emits the whole accent family so tenants glow in their colour'
```

---

### Task 4: The lit ground

**Files:**
- Create: `apps/web/src/components/ground.tsx`, `apps/web/src/components/ground.test.ts`
- Modify: `apps/web/src/app/(dashboard)/dashboard/layout.tsx:9-12` (imports), `:133` (wrapper)

**Interfaces:**
- Consumes: tokens `--accent`, `--accent-2`, `--glow-*-alpha`, `--grid-alpha`, `--text-1`.
- Produces: `export function Ground(): JSX.Element` — `data-slot="ground"`, `aria-hidden`, fixed, pointer-events none.

- [ ] **Step 1: Failing test**

```ts
// apps/web/src/components/ground.test.ts
import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Ground } from "./ground";

describe("Ground — the lit page layer (spec §3.1)", () => {
  const html = renderToStaticMarkup(createElement(Ground));

  it("is fixed, behind everything, non-interactive and hidden from AT", () => {
    expect(html).toContain('data-slot="ground"');
    expect(html).toContain('aria-hidden="true"');
    expect(html).toMatch(/class="[^"]*pointer-events-none[^"]*fixed[^"]*inset-0[^"]*-z-10/);
  });

  it("paints three glows from the accent tokens at the token alphas", () => {
    expect(html).toContain("radial-gradient(700px 420px at 12% -10%");
    expect(html).toContain("radial-gradient(620px 380px at 96% 8%");
    expect(html).toContain("radial-gradient(560px 360px at 60% 110%");
    expect(html).toContain("var(--glow-1-alpha)");
    expect(html).toContain("var(--glow-2-alpha)");
    expect(html).toContain("var(--glow-3-alpha)");
    expect(html).toContain("var(--accent-2)");
  });

  it("paints a 48px grid at --grid-alpha, masked to the top third", () => {
    expect(html).toContain("background-size:48px 48px");
    expect(html).toContain("var(--grid-alpha)");
    expect(html).toContain("mask-image:radial-gradient(800px 500px at 30% 0%");
  });

  it("uses no colour literal — tokens only", () => {
    // `black` inside the mask is opacity, not paint (masks read alpha).
    expect(html.replace(/mask-image:[^;]+;/g, "")).not.toMatch(/#[0-9a-fA-F]{3,8}\b|rgba?\(/);
  });
});
```

- [ ] **Step 2: Run and see it fail**

Run: `cd /c/Users/danlo/bis-platform/apps/web && npx vitest run ground`
Expected: FAIL — `Cannot find module './ground'`.

- [ ] **Step 3: Implement**

```tsx
// apps/web/src/components/ground.tsx
//
// The dashboard's light source (Northern Lights spec §3.1): three static
// radial glows and a 48px grid masked to the top third, painted once behind
// sidebar and content. No images, no canvas, no animation — reduced-motion is
// irrelevant because nothing moves. Nothing else in the app knows it exists.
const glow = (size: string, at: string, token: string, alpha: string) =>
  `radial-gradient(${size} at ${at}, rgb(from var(${token}) r g b / var(${alpha})), transparent 60%)`;

const GLOWS = [
  glow("700px 420px", "12% -10%", "--accent", "--glow-1-alpha"),
  glow("620px 380px", "96% 8%", "--accent-2", "--glow-2-alpha"),
  glow("560px 360px", "60% 110%", "--accent", "--glow-3-alpha"),
].join(", ");

const GRID_LINE = "rgb(from var(--text-1) r g b / var(--grid-alpha))";
const GRID = `linear-gradient(${GRID_LINE} 1px, transparent 1px), linear-gradient(90deg, ${GRID_LINE} 1px, transparent 1px)`;
// A mask reads alpha only — `black` here is "opaque", not a painted colour.
const GRID_MASK = "radial-gradient(800px 500px at 30% 0%, black 20%, transparent 70%)";

export function Ground() {
  return (
    <div aria-hidden="true" data-slot="ground" className="pointer-events-none fixed inset-0 -z-10">
      <div className="absolute inset-0" style={{ backgroundImage: GLOWS }} />
      <div
        className="absolute inset-0"
        style={{ backgroundImage: GRID, backgroundSize: "48px 48px", maskImage: GRID_MASK, WebkitMaskImage: GRID_MASK }}
      />
    </div>
  );
}
```

In `dashboard/layout.tsx` add `import { Ground } from "@/components/ground";` after line 12 and change line 133:

```tsx
      <div className="relative flex min-h-screen">
        <Ground />
        <AppSidebar
```

- [ ] **Step 4: Run green; build check**

Run: `cd /c/Users/danlo/bis-platform/apps/web && npx vitest run ground` → PASS. `cd /c/Users/danlo/bis-platform && pnpm --filter web typecheck && pnpm --filter web lint`.

- [ ] **Step 5: Mutation check, commit**

Mutation: replace `var(--accent)` in the first glow with `#8B7CF7` → `uses no colour literal` fails. Revert.

```bash
cd /c/Users/danlo/bis-platform && git add apps/web/src/components/ground.tsx apps/web/src/components/ground.test.ts "apps/web/src/app/(dashboard)/dashboard/layout.tsx" && git commit -m 'feat(design): the lit ground — three token-driven glows and a masked grid behind the dashboard shell'
```

---

### Task 5: Shell components — Card, Skeleton, Topbar, Empty state, overlays, Table, Toasts, Sidebar

**Files:**
- Modify: `apps/web/src/components/ui/card.tsx:10`, `ui/skeleton.tsx:7`, `ui/dialog.tsx:64`, `ui/sheet.tsx:63`, `ui/popover.tsx:33`, `ui/select.tsx:65`, `ui/dropdown-menu.tsx:45,233`, `ui/command.tsx:24`, `ui/table.tsx:60`, `ui/sonner.tsx:27-34`
- Modify: `apps/web/src/components/topbar.tsx:26`, `topbar-presence.tsx:43`, `empty-state.tsx:15`, `app-sidebar.tsx:176,205,239,386-387,392,413,462,477-478`
- Create: `apps/web/src/components/ui/material.test.ts`

**Interfaces:**
- Consumes: utilities `glass`, `glass-overlay`, `sidebar-chrome` (Task 2); chrome tokens `--sidebar-line`, `--sidebar-text-strong`, `--sidebar-tint-2`, `--sidebar-ground` (Task 1); `--sidebar-accent` (semantic, tenant-overridable).
- Produces: nothing new — class names only. Test proves Card carries `glass`, overlays carry `glass-overlay`, sidebar has no white literals.

- [ ] **Step 1: Failing tests**

```ts
// apps/web/src/components/ui/material.test.ts
//
// Card/Skeleton/EmptyState are pure functions of props → renderToStaticMarkup.
// Radix overlays and the sidebar need contexts/hooks, so their class strings
// are read from source (the same data-not-behaviour shape as the CSS tests).
import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Inbox } from "lucide-react";
import { Card } from "./card";
import { Skeleton } from "./skeleton";
import { EmptyState } from "../empty-state";

const here = path.dirname(fileURLToPath(import.meta.url));
const src = (rel: string) => readFileSync(path.join(here, rel), "utf8");

describe("Card is glass (spec §4)", () => {
  const html = renderToStaticMarkup(createElement(Card, null, "x"));
  it("keeps bg-card (a tenant's --card must still win) and adds the glass utility", () => {
    expect(html).toMatch(/class="[^"]*\bbg-card\b[^"]*\bglass\b/);
    expect(html).not.toMatch(/shadow-sm/);
  });
});

describe("Skeleton reads as card material", () => {
  const html = renderToStaticMarkup(createElement(Skeleton));
  it("fills with --surface-2 and the glass highlight", () => {
    expect(html).toContain("bg-[var(--surface-2)]");
    expect(html).toContain("shadow-[var(--glass-highlight)]");
    expect(html).not.toContain("bg-accent");
  });
});

describe("EmptyState sits on a stronger glow", () => {
  const html = renderToStaticMarkup(createElement(EmptyState, { icon: Inbox, title: "Nothing yet" }));
  it("paints an --accent-dim radial at its top-left corner", () => {
    expect(html).toContain("bg-[radial-gradient(420px_220px_at_0%_0%,var(--accent-dim),transparent_70%)]");
  });
});

describe("overlays float on --surface-overlay (opaque-over-scroll rule)", () => {
  it.each([
    ["dialog.tsx", "dialog-content"], ["sheet.tsx", "sheet-content"], ["popover.tsx", "popover-content"],
    ["select.tsx", "select-content"], ["dropdown-menu.tsx", "dropdown-menu-content"], ["command.tsx", '"command"'],
  ])("%s's %s uses glass-overlay, not bg-background/bg-popover", (file, slot) => {
    const text = src(`./${file}`);
    const start = text.indexOf(`data-slot=${slot.startsWith('"') ? slot : `"${slot}"`}`);
    expect(start).toBeGreaterThan(-1);
    const window = text.slice(start, start + 600);
    expect(window).toContain("glass-overlay");
    expect(window).not.toMatch(/\bbg-background\b|\bbg-popover\b/);
  });

  it("dropdown sub-content is an overlay too", () => {
    expect(src("./dropdown-menu.tsx").match(/glass-overlay/g)?.length).toBeGreaterThanOrEqual(2);
  });

  it("table rows hover to --surface-2 and never blur", () => {
    const row = src("./table.tsx").slice(src("./table.tsx").indexOf('data-slot="table-row"'), src("./table.tsx").indexOf('data-slot="table-row"') + 300);
    expect(row).toContain("hover:bg-[var(--surface-2)]");
    expect(row).not.toMatch(/glass|blur/);
  });

  it("toasts are overlays with the strong line", () => {
    const t = src("./sonner.tsx");
    expect(t).toContain('"--normal-border": "var(--line-strong)"');
    expect(t).toContain('className: "glass-overlay"');
  });
});

describe("shell chrome", () => {
  it("topbar is transparent with a bottom hairline", () => {
    expect(src("../topbar.tsx")).toMatch(/<header className="[^"]*\bbg-transparent\b[^"]*\bborder-b\b|<header className="[^"]*\bborder-b\b[^"]*\bbg-transparent\b/);
  });
  it("the presence dot carries the --good halo", () => {
    expect(src("../topbar-presence.tsx")).toContain("shadow-[0_0_0_4px_color-mix(in_srgb,var(--good)_22%,transparent)]");
  });
  it("sidebar: blur, gradient rail, token badges, no white literals", () => {
    const s = src("../app-sidebar.tsx");
    expect(s).toMatch(/className=\{cn\(\s*"[^"]*\bsidebar-chrome\b/);
    expect(s).toContain("bg-[linear-gradient(var(--sidebar-accent),var(--sidebar-tint-2))]");
    expect(s).toContain("bg-[linear-gradient(135deg,var(--sidebar-accent),var(--sidebar-tint-2))]");
    expect(s).toContain("bg-[linear-gradient(90deg,var(--sidebar-accent),var(--sidebar-tint-2))]");
    expect(s).not.toMatch(/hover:bg-white\/5|bg-white\/10|\btext-white\b|var\(--accent-2\)/);
  });
});
```

- [ ] **Step 2: Run and see it fail**

Run: `cd /c/Users/danlo/bis-platform/apps/web && npx vitest run material`
Expected: FAIL on every case (`glass` absent, `bg-background` present, `text-white` present…).

- [ ] **Step 3: Class swaps (exact old → new)**

`ui/card.tsx:10`
```tsx
        "flex flex-col gap-6 rounded-xl border bg-card py-6 text-card-foreground glass",
```
`ui/skeleton.tsx:7`
```tsx
      className={cn("animate-pulse rounded-md bg-[var(--surface-2)] shadow-[var(--glass-highlight)]", className)}
```
`ui/dialog.tsx:64` — replace `rounded-lg border bg-background p-6 shadow-lg` with `rounded-lg border border-[var(--line-strong)] glass-overlay p-6`.
`ui/sheet.tsx:63` — replace `bg-background shadow-lg` with `glass-overlay border-[var(--line-strong)]`.
`ui/popover.tsx:33` — replace `rounded-md border bg-popover p-4 text-popover-foreground shadow-md` with `rounded-md border border-[var(--line-strong)] glass-overlay p-4`.
`ui/select.tsx:65` — replace `rounded-md border bg-popover text-popover-foreground shadow-md` with `rounded-md border border-[var(--line-strong)] glass-overlay`.
`ui/dropdown-menu.tsx:45` and `:233` — replace `border bg-popover p-1 text-popover-foreground shadow-md` (resp. `shadow-lg`) with `border border-[var(--line-strong)] glass-overlay p-1`.
`ui/command.tsx:24` — replace `rounded-md bg-popover text-popover-foreground` with `rounded-md glass-overlay`.
`ui/table.tsx:60`
```tsx
        "border-b transition-colors hover:bg-[var(--surface-2)] has-aria-expanded:bg-[var(--surface-2)] data-[state=selected]:bg-muted",
```
`ui/sonner.tsx:27-34` — replace the `style` prop and add `toastOptions`:
```tsx
      toastOptions={{ className: "glass-overlay" }}
      style={
        {
          "--normal-bg": "var(--popover)",
          "--normal-text": "var(--popover-foreground)",
          "--normal-border": "var(--line-strong)",
          "--border-radius": "var(--radius)",
        } as React.CSSProperties
      }
```
(The toast "accent word" was dropped from scope on 2026-09-08 — toasts get the overlay material only.)

`topbar.tsx:26`
```tsx
    <header className="flex h-14 shrink-0 items-center justify-end gap-3 border-b border-border bg-transparent px-6">
```
`topbar-presence.tsx:43`
```tsx
        <span aria-hidden className="size-2 shrink-0 rounded-full bg-primary animate-pulse shadow-[0_0_0_4px_color-mix(in_srgb,var(--good)_22%,transparent)]" />
```
`empty-state.tsx:15`
```tsx
    <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-border bg-[radial-gradient(420px_220px_at_0%_0%,var(--accent-dim),transparent_70%)] px-6 py-16 text-center">
```
`app-sidebar.tsx`:
(The sidebar is dark in BOTH themes, so hover fills and strong text come from the chrome tokens, never from `--surface-*`/`text-foreground`, which flip with the theme.)
- `:176` `bg-sidebar p-3` → `sidebar-chrome p-3` (the utility paints `--sidebar-ground` under the `--sidebar` layer + blur; `text-sidebar-foreground` stays)
- `:205` `hover:bg-white/5 hover:text-sidebar-foreground` → `hover:bg-[var(--sidebar-line)] hover:text-[var(--sidebar-text-strong)]`
- `:239` `"bg-sidebar-accent/20 text-sidebar-accent"` → `"bg-[linear-gradient(135deg,var(--sidebar-accent),var(--sidebar-tint-2))] text-[var(--sidebar-ground)]"`
- `:386` `"bg-sidebar-accent/15 font-medium text-white"` → `"bg-sidebar-accent/15 font-medium text-[var(--sidebar-text-strong)] shadow-[var(--glass-highlight)]"`
- `:387` `"text-sidebar-foreground/75 hover:bg-white/5 hover:text-sidebar-foreground"` → `"text-sidebar-foreground/75 hover:bg-[var(--sidebar-line)] hover:text-[var(--sidebar-text-strong)]"`
- `:392` `rounded-r bg-sidebar-accent` → `rounded-r bg-[linear-gradient(var(--sidebar-accent),var(--sidebar-tint-2))]`
- `:413` `bg-sidebar-accent px-1.5 text-center text-[10px] font-medium text-sidebar` → `bg-sidebar-accent/15 px-1.5 text-center text-[10px] font-medium text-sidebar-accent`
- `:462` `hover:bg-white/5 hover:text-sidebar-foreground` → `hover:bg-[var(--sidebar-line)] hover:text-[var(--sidebar-text-strong)]`
- `:477` `bg-white/10` → `bg-[var(--sidebar-line)]`; `:478` `bg-sidebar-accent` → `bg-[linear-gradient(90deg,var(--sidebar-accent),var(--sidebar-tint-2))]` (mockup `--meter-fill`).

- [ ] **Step 4: Run green; gates**

Run: `cd /c/Users/danlo/bis-platform/apps/web && npx vitest run material` → PASS. `cd /c/Users/danlo/bis-platform && pnpm --filter web typecheck && pnpm --filter web lint && pnpm --filter web build` (build proves Tailwind accepts every arbitrary class; a rejected class is a silent no-op, so also open `/dashboard/styleguide` in dark and confirm a Card's computed `backdrop-filter` is `blur(14px)` in devtools).

- [ ] **Step 5: Mutation check, commit**

Mutation: drop `glass` from `card.tsx:10` → `Card is glass` fails. Revert.

```bash
cd /c/Users/danlo/bis-platform && git add apps/web/src/components/ui/card.tsx apps/web/src/components/ui/skeleton.tsx apps/web/src/components/ui/dialog.tsx apps/web/src/components/ui/sheet.tsx apps/web/src/components/ui/popover.tsx apps/web/src/components/ui/select.tsx apps/web/src/components/ui/dropdown-menu.tsx apps/web/src/components/ui/command.tsx apps/web/src/components/ui/table.tsx apps/web/src/components/ui/sonner.tsx apps/web/src/components/ui/material.test.ts apps/web/src/components/topbar.tsx apps/web/src/components/topbar-presence.tsx apps/web/src/components/empty-state.tsx apps/web/src/components/app-sidebar.tsx && git commit -m 'feat(design): glass cards, overlay surfaces, transparent topbar, gradient rail and token badges in the sidebar'
```

---

### Task 6: Controls — Button, Input/Textarea/Select, Badge, period pills

**Files:**
- Modify: `apps/web/src/components/ui/button.tsx:12-20`, `ui/input.tsx:11-12`, `ui/textarea.tsx:10-11`, `ui/select.tsx:40`, `ui/badge.tsx:13-18`
- Modify: `apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/website/page.tsx:23,31-33` (`PeriodSwitch`)
- Create: `apps/web/src/components/ui/button.test.ts`

**Interfaces:**
- Consumes: `btn-primary`, `pill-on` utilities (Task 2); `buttonVariants` cva (`button.tsx:7`).
- Produces: nothing new.

- [ ] **Step 1: Failing tests**

```ts
// apps/web/src/components/ui/button.test.ts
import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Button } from "./button";
import { Badge } from "./badge";
import { Input } from "./input";
import { Textarea } from "./textarea";

const here = path.dirname(fileURLToPath(import.meta.url));
const cls = (html: string) => html.match(/class="([^"]*)"/)![1]!;

describe("Button variants (spec §4)", () => {
  it("primary = gradient + glow, no flat bg-primary", () => {
    const c = cls(renderToStaticMarkup(createElement(Button, null, "Go")));
    expect(c).toMatch(/\bbtn-primary\b/);
    expect(c).toMatch(/\btext-primary-foreground\b/);
    expect(c).not.toMatch(/\bbg-primary\b/);
  });
  it("outline = surface-1 fill, strong line, no shadow", () => {
    const c = cls(renderToStaticMarkup(createElement(Button, { variant: "outline" }, "x")));
    expect(c).toMatch(/\bbg-card\b/);
    expect(c).toMatch(/border-\[var\(--line-strong\)\]/);
    expect(c).not.toMatch(/shadow-xs/);
  });
  it("destructive = crit-bg fill, crit text, no gradient", () => {
    const c = cls(renderToStaticMarkup(createElement(Button, { variant: "destructive" }, "x")));
    expect(c).toContain("bg-[var(--crit-bg)]");
    expect(c).toContain("text-[var(--crit)]");
    expect(c).not.toMatch(/\bbtn-primary\b|\btext-white\b/);
  });
});

describe("text controls: surface-2 fill, accent border + 3px ring-glow on focus", () => {
  it.each([
    ["input", () => cls(renderToStaticMarkup(createElement(Input)))],
    ["textarea", () => cls(renderToStaticMarkup(createElement(Textarea)))],
    ["select-trigger", () => readFileSync(path.join(here, "select.tsx"), "utf8").split('data-slot="select-trigger"')[1]!.slice(0, 700)],
  ])("%s", (_name, get) => {
    const c = get();
    expect(c).toContain("bg-[var(--surface-2)]");
    expect(c).toContain("focus-visible:border-[var(--accent)]");
    expect(c).toContain("focus-visible:ring-[3px]");
    expect(c).toContain("focus-visible:ring-[var(--ring-glow)]");
    expect(c).not.toMatch(/\bbg-transparent\b|dark:bg-input\/30|ring-ring\/50/);
  });
});

describe("Badge fills soften (dot + word rule unchanged)", () => {
  it("secondary and outline sit on --surface-2; destructive on --crit-bg", () => {
    expect(cls(renderToStaticMarkup(createElement(Badge, { variant: "secondary" }, "x")))).toContain("bg-[var(--surface-2)]");
    expect(cls(renderToStaticMarkup(createElement(Badge, { variant: "outline" }, "x")))).toContain("bg-[var(--surface-2)]");
    const d = cls(renderToStaticMarkup(createElement(Badge, { variant: "destructive" }, "x")));
    expect(d).toContain("bg-[var(--crit-bg)]");
    expect(d).toContain("text-[var(--crit)]");
  });
});

describe("period pills (Website header)", () => {
  const page = readFileSync(path.join(here, "../../app/(dashboard)/dashboard/accounts/[accountId]/website/page.tsx"), "utf8");
  it("selected segment uses pill-on; container is surface-1 with --line", () => {
    expect(page).toMatch(/aria-label="Period" className="[^"]*\brounded-full\b[^"]*\bborder-border\b[^"]*\bbg-card\b/);
    expect(page).toMatch(/\? "pill-on rounded-full px-3 py-1/);
    expect(page).not.toContain("bg-primary/15");
  });
});
```

- [ ] **Step 2: Run and see it fail**

Run: `cd /c/Users/danlo/bis-platform/apps/web && npx vitest run button.test`
Expected: FAIL — `btn-primary` absent, `bg-transparent` present, `bg-primary/15` present.

- [ ] **Step 3: Implement**

`ui/button.tsx:12-20` variants:
```tsx
        default: "btn-primary text-primary-foreground hover:brightness-[1.08]",
        destructive:
          "bg-[var(--crit-bg)] text-[var(--crit)] hover:brightness-[1.08] focus-visible:ring-destructive/20 dark:focus-visible:ring-destructive/40",
        outline:
          "border border-[var(--line-strong)] bg-card hover:bg-[var(--surface-2)]",
        secondary:
          "bg-secondary text-secondary-foreground hover:bg-secondary/80",
        ghost:
          "hover:bg-[var(--surface-2)]",
        link: "text-primary underline-offset-4 hover:underline",
```
`ui/input.tsx:11-12` — in the first string replace `bg-transparent` with `bg-[var(--surface-2)]` and delete ` dark:bg-input/30`; replace line 12 with:
```tsx
        "focus-visible:border-[var(--accent)] focus-visible:ring-[3px] focus-visible:ring-[var(--ring-glow)]",
```
`ui/textarea.tsx:10-11` — same two substitutions (its focus classes sit in the same string; replace `focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50` with the line above's content).
`ui/select.tsx:40` (trigger) — same: `bg-transparent` → `bg-[var(--surface-2)]`, drop `dark:bg-input/30`, focus trio → `focus-visible:border-[var(--accent)] focus-visible:ring-[3px] focus-visible:ring-[var(--ring-glow)]`.
`ui/badge.tsx:13-18`:
```tsx
        secondary:
          "bg-[var(--surface-2)] text-foreground [a&]:hover:bg-[var(--surface-3)]",
        destructive:
          "bg-[var(--crit-bg)] text-[var(--crit)] focus-visible:ring-destructive/20 dark:focus-visible:ring-destructive/40 [a&]:hover:brightness-[1.08]",
        outline:
          "border-border bg-[var(--surface-2)] text-foreground [a&]:hover:bg-[var(--surface-3)]",
```
`website/page.tsx` `PeriodSwitch`:
```tsx
    <nav aria-label="Period" className="flex gap-1 rounded-full border border-border bg-card p-0.5">
```
```tsx
            p === period
              ? "pill-on rounded-full px-3 py-1 font-mono text-[11px] font-medium tracking-[0.06em]"
              : "rounded-full px-3 py-1 font-mono text-[11px] font-medium tracking-[0.06em] text-muted-foreground hover:bg-[var(--surface-2)]"
```

- [ ] **Step 4: Run green; gates**

Run: `cd /c/Users/danlo/bis-platform/apps/web && npx vitest run button.test styleguide website` → PASS (the `website` substring covers `lib/website/*.test.ts` and `website/actions.test.ts`, none of which read classes). `cd /c/Users/danlo/bis-platform && pnpm --filter web typecheck && pnpm --filter web lint`.

- [ ] **Step 5: Mutation check, commit**

Mutation: in `button.tsx` default variant swap `btn-primary` for `bg-primary` → `primary = gradient + glow` fails. Revert.

```bash
cd /c/Users/danlo/bis-platform && git add apps/web/src/components/ui/button.tsx apps/web/src/components/ui/button.test.ts apps/web/src/components/ui/input.tsx apps/web/src/components/ui/textarea.tsx apps/web/src/components/ui/select.tsx apps/web/src/components/ui/badge.tsx "apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/website/page.tsx" && git commit -m 'feat(design): gradient primary button with glow, surface-2 text controls with the ring-glow focus, softened badges, glowing period pill'
```

---

### Task 7: Composite contrast test (spec §8) — on-canvas peak, decided fallback

**Files:**
- Modify: `apps/web/src/lib/branding/theme.test.ts` (new `describe` after the parity block, i.e. append at end of file)

**Interfaces:**
- Consumes: `deriveTheme`, `ADVERSARIAL` (line 35), `NEUTRALS`/`MODES` (line 15), `contrastRatio` (`color.ts:59`), `deriveAccent2`, `tokensRootBlock`/`tokensDarkBlock` (parity block, lines 336–337 — hoist them: they are `const`s inside `describe("globals.css / tokens.css / BIS parity")`; move the two `readFileSync`/`match` lines for tokens.css to module scope above line 322 so both describes share them).
- Produces: nothing; a gate.

**Compositing model.** `over(top, alpha, under)` = per-channel `alpha·top + (1−alpha)·under` in gamma sRGB (what the browser does for `rgba()` layers). Effective background under a card = `over(surface1.rgb, surface1.alpha, over(glow, glowAlpha, ground))`. Point (b) "darkest" = `glowAlpha = 0`. Point (a) "glow-1 centre" — the centre sits at y = −10% (off-canvas). The strongest glow any on-canvas pixel sees is at the top edge: for the shortest supported layout (Playwright's 720px) that is 72px into a 420px radius with the stop at 60%, so the factor is `1 − 72/(420·0.6) = 0.714`. The test uses that (`ON_CANVAS`) and documents it; the literal centre would be a point no pixel has.

- [ ] **Step 1: Write the test**

Add `import { themeStyle } from "./theme-style";` to `theme.test.ts`'s imports if it is not already there, then append:

```ts
// ---------------------------------------------------------------------------
// Composite contrast (Northern Lights spec §8). Text sits on glass over a lit
// ground, so the effective background is glow → ground → surface, composited.
// ---------------------------------------------------------------------------
type Paint = { hex: string; alpha: number };
const hexToRgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as [number, number, number];
const rgbToHex = (rgb: number[]) => `#${rgb.map((v) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, "0")).join("")}`;
const over = (top: string, alpha: number, under: string) => {
  const t = hexToRgb(top), u = hexToRgb(under);
  return rgbToHex(t.map((c, i) => alpha * c + (1 - alpha) * u[i]!));
};
const mixWhite = (hex: string, pct: number) => over(hex, pct / 100, "#ffffff");
const rawOf = (block: string, token: string) => {
  const raw = block.match(new RegExp(`--${token}:\\s*([^;]+);`))?.[1]?.trim();
  if (!raw) throw new Error(`--${token} not declared`);
  return raw;
};
const paintOf = (block: string, token: string): Paint => {
  const raw = rawOf(block, token);
  if (/^#[0-9a-fA-F]{6}$/.test(raw)) return { hex: raw.toLowerCase(), alpha: 1 };
  const m = raw.match(/^rgba\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*([0-9.]+)\s*\)$/);
  if (!m) throw new Error(`--${token}: ${raw} is neither #hex nor rgba()`);
  return { hex: rgbToHex([+m[1]!, +m[2]!, +m[3]!]), alpha: Number(m[4]) };
};
// Glow-1's centre is at y = −10%; on a 720px-tall layout the top edge is 72px
// into the 420px radius whose stop ends at 60%: 1 − 72/(420·0.6).
const ON_CANVAS = 1 - 72 / (420 * 0.6);

describe("composite contrast — BIS default (spec §8)", () => {
  for (const [mode, block] of [["dark", tokensDarkBlock!], ["light", tokensRootBlock!]] as const) {
    const ground = paintOf(block, "surface-0").hex;
    const card = paintOf(block, "surface-1");
    const accent = paintOf(block, "accent").hex;
    const accent2 = paintOf(block, "accent-2").hex;
    const glow1 = Number(rawOf(block, "glow-1-alpha")) * ON_CANVAS;
    const underCard = (glowAlpha: number) => over(card.hex, card.alpha, over(accent, glowAlpha, ground));
    const atGlow = underCard(glow1);
    const darkest = underCard(0);
    const text = (n: 1 | 2 | 3) => paintOf(block, `text-${n}`).hex;

    it(`${mode}: --text-1 and --text-2 ≥ 4.5:1 under a card at the glow-1 peak and at the darkest point`, () => {
      for (const bg of [atGlow, darkest]) {
        expect(contrastRatio(text(1), bg), `text-1 on ${bg}`).toBeGreaterThanOrEqual(4.5);
        expect(contrastRatio(text(2), bg), `text-2 on ${bg}`).toBeGreaterThanOrEqual(4.5);
      }
    });

    it(`${mode}: --text-3 ≥ 3:1 at both points`, () => {
      for (const bg of [atGlow, darkest]) {
        expect(contrastRatio(text(3), bg), `text-3 on ${bg}`).toBeGreaterThanOrEqual(3);
      }
    });

    it(`${mode}: the hero gradient's stops clear 3:1 (large text) at the darkest point`, () => {
      const stops = mode === "dark" ? [mixWhite(accent, 50), mixWhite(accent2, 60)] : [accent, accent2];
      for (const s of stops) expect(contrastRatio(s, darkest), `hero stop ${s} on ${darkest}`).toBeGreaterThanOrEqual(3);
    });
  }
});

describe("composite contrast — every brand in the sweep (spec §8)", () => {
  // Tenant cards are the ramp's opaque colours (theme-style.ts overrides
  // --card), so under a card the composite IS the card — the existing sweep
  // covers it. What the glow changes for a tenant is text painted directly on
  // the ground (page-level labels), and the hero stops on the card. The glow
  // alpha is whatever themeStyle EMITS for that theme when it emits one
  // (Step 4 halves it for brand-active tenants), else the token value.
  for (const mode of MODES) {
    const tokenAlpha = Number(rawOf(mode === "dark" ? tokensDarkBlock! : tokensRootBlock!, "glow-1-alpha"));
    it(`${mode}: muted text stays ≥ 4.5:1 on the lit ground, hero stops ≥ 3:1 on the card`, () => {
      for (const neutral of NEUTRALS)
        for (const color of ADVERSARIAL) {
          const t = deriveTheme({ color, neutral, corners: null, type: null, mode: null }, mode)!;
          const style = themeStyle(t) as Record<string, string>;
          const glowAlpha = Number(style["--glow-1-alpha"] ?? tokenAlpha) * ON_CANVAS;
          const where = `${neutral}/${mode}/${color}`;
          const litGround = over(t.primary, glowAlpha, t.background);
          expect(contrastRatio(t.mutedForeground, litGround), `muted on lit ground ${where}`).toBeGreaterThanOrEqual(4.5);
          const stops = mode === "dark" ? [mixWhite(t.primary, 50), mixWhite(t.accent2, 60)] : [t.primary, t.accent2];
          for (const s of stops) expect(contrastRatio(s, t.card), `hero stop ${s} on card ${where}`).toBeGreaterThanOrEqual(3);
        }
    });
  }
});
```

- [ ] **Step 2: Prove it computes — the spec's fail-first check**

Temporarily set `--glow-1-alpha: 1;` in tokens.css's `.dark` block. Run: `cd /c/Users/danlo/bis-platform/apps/web && npx vitest run theme.test -t "composite"`
Expected: `dark: --text-1 and --text-2 ≥ 4.5:1 …` FAILS (`text-2 on #5b53a5`-ish ≈ 2:1). Revert the alpha.

- [ ] **Step 3: Run against the real tokens**

Run: `cd /c/Users/danlo/bis-platform/apps/web && npx vitest run theme.test -t "composite"`

Expected (planning arithmetic, 2026-09-08, with Task 1's lifted dark `--text-3` `#7B7593`): every `BIS default` case PASSES (dark text-3 ≈3.2:1 at the peak, text-2 ≈4.8:1; light cards are opaque white; hero stops at 50%/60% white are far above 3:1). The brand sweep is expected to FAIL `muted on lit ground` in dark for `#ffffff` and `#fde047` (≈4.1–4.5:1). Record the failing names in the ledger, then apply Step 4. If — and only if — the sweep is already green, skip Step 4 and note that in the commit body.

- [ ] **Step 4: Decided fallback — `themeStyle` halves the glow alphas whenever a brand colour is active**

BIS default keeps `.28/.16/.12` (nothing is emitted for the agency — no theme). A themed tenant WITHOUT a brand colour keeps the token alphas too. Only `brand !== null` halves them.

`theme.ts` — after `BIS` add:

```ts
/**
 * tokens.css's glow alphas per mode (theme.test.ts pins the parity). Halved
 * for a brand-active tenant: a very light brand (white, yellow) lifted for
 * text becomes a very bright glow, and page-level muted text on the lit
 * ground dropped under 4.5:1 in the composite sweep (decided 2026-09-08).
 */
export const GLOW_ALPHAS = {
  light: { glow1: 0.07, glow2: 0.05, glow3: 0.04 },
  dark:  { glow1: 0.28, glow2: 0.16, glow3: 0.12 },
} as const;
export type GlowAlphas = { glow1: number; glow2: number; glow3: number };
```

`ResolvedTheme` gains `glowAlphas: GlowAlphas;` (after `accent2: string;`). In `deriveTheme`, after the `accent2` line:

```ts
  const glowScale = brand ? 0.5 : 1;
  const glowAlphas: GlowAlphas = {
    glow1: GLOW_ALPHAS[mode].glow1 * glowScale,
    glow2: GLOW_ALPHAS[mode].glow2 * glowScale,
    glow3: GLOW_ALPHAS[mode].glow3 * glowScale,
  };
```

and `glowAlphas,` in the returned object after `accent2,`.

`theme-style.ts` — after `"--sidebar-tint-2": c(theme.accent2),`:

```ts
    // Numbers from a closed constant table (GLOW_ALPHAS × 1 or × 0.5) — no tenant text.
    "--glow-1-alpha": String(theme.glowAlphas.glow1),
    "--glow-2-alpha": String(theme.glowAlphas.glow2),
    "--glow-3-alpha": String(theme.glowAlphas.glow3),
```

Tests. In `theme.test.ts` inside `describe("deriveTheme")`:

```ts
  it("keeps the token glow alphas for a tenant with no brand colour, and halves them when a brand is active", () => {
    for (const mode of MODES) {
      const plain = deriveTheme({ color: null, neutral: "slate", corners: null, type: null, mode: null }, mode)!;
      const branded = deriveTheme({ color: "#6d28d9", neutral: "slate", corners: null, type: null, mode: null }, mode)!;
      expect(plain.glowAlphas).toEqual(GLOW_ALPHAS[mode]);
      expect(branded.glowAlphas.glow1).toBeCloseTo(GLOW_ALPHAS[mode].glow1 / 2, 10);
      expect(branded.glowAlphas.glow2).toBeCloseTo(GLOW_ALPHAS[mode].glow2 / 2, 10);
      expect(branded.glowAlphas.glow3).toBeCloseTo(GLOW_ALPHAS[mode].glow3 / 2, 10);
    }
  });
```

In the parity `describe` (add `GLOW_ALPHAS` to the `./theme` import):

```ts
  it.each([["glow1", "glow-1-alpha"], ["glow2", "glow-2-alpha"], ["glow3", "glow-3-alpha"]] as const)(
    "keeps GLOW_ALPHAS.%s equal to tokens.css's --%s in both modes", (key, token) => {
      expect(GLOW_ALPHAS.dark[key]).toBe(Number(tokensDarkBlock!.match(new RegExp(`--${token}:\\s*([^;]+);`))![1]));
      expect(GLOW_ALPHAS.light[key]).toBe(Number(tokensRootBlock!.match(new RegExp(`--${token}:\\s*([^;]+);`))![1]));
    });
```

In `theme-style.test.ts` after the `--sidebar-tint-2` line:

```ts
    expect(style["--glow-1-alpha"]).toBe(String(theme.glowAlphas.glow1));
    expect(style["--glow-2-alpha"]).toBe(String(theme.glowAlphas.glow2));
    expect(style["--glow-3-alpha"]).toBe(String(theme.glowAlphas.glow3));
```

The brand-sweep composite test (Step 1) already reads `style["--glow-1-alpha"]` when present, so it now asserts against the halved alpha for branded themes and the token alpha otherwise — rerun: `npx vitest run theme.test -t "composite"` → PASS. Any `ResolvedTheme` fixture found in Task 3 Step 8 also gains `glowAlphas: { glow1: 0.28, glow2: 0.16, glow3: 0.12 }`.

- [ ] **Step 5: Full branding suite green, mutation, commit**

Run: `cd /c/Users/danlo/bis-platform/apps/web && npx vitest run branding` → PASS; `cd /c/Users/danlo/bis-platform && pnpm --filter web typecheck`.

Mutation (in addition to Step 2's fail-first): set `glowScale` to `1` for brands → `muted on lit ground slate/dark/#ffffff` fails again. Revert.

```bash
cd /c/Users/danlo/bis-platform && git add apps/web/src/lib/branding/theme.test.ts apps/web/src/lib/branding/theme.ts apps/web/src/lib/branding/theme-style.ts apps/web/src/lib/branding/theme-style.test.ts && git commit -m 'test(design): composite contrast — text on glass over the lit ground for the BIS default and every brand in the sweep; brand-active tenants glow at half alpha'
```

(If Step 4 was skipped, add only `theme.test.ts`.)

---

### Task 8: Styleguide "Ground & light", e2e material check, DESIGN.md amendments, perf gate

**Files:**
- Modify: `apps/web/src/app/(dashboard)/dashboard/styleguide/page.tsx` (insert a new `<Section>` before line 66 `<Section title="Buttons"`)
- Modify: `apps/web/e2e/styleguide.spec.ts` (new test inside `test.describe("the style guide")`, after line 15)
- Modify: `DESIGN.md` (six places below)
- Modify: `.superpowers/sdd/progress.md` (ledger — perf gate record)

**Interfaces:**
- Consumes: `Section({ title, file, children })` (`styleguide/page.tsx:41-55`), `Button` variants (Task 6), `hero-text`.
- Produces: the section title string `"Ground & light"` (e2e anchors on it).

- [ ] **Step 1: Failing e2e**

Add to `apps/web/e2e/styleguide.spec.ts` inside the first `describe`, after the existing test:

```ts
  test("ships the Northern Lights material in both themes", async ({ page }) => {
    await page.goto("/dashboard/styleguide");
    await expect(page.getByText("Ground & light", { exact: true })).toBeVisible();

    const probe = () =>
      page.evaluate((dark: boolean) => {
        document.documentElement.classList.toggle("dark", dark);
        const card = document.querySelector('[data-slot="card"]')!;
        const cs = getComputedStyle(card);
        return { filter: cs.backdropFilter || (cs as unknown as { webkitBackdropFilter?: string }).webkitBackdropFilter || "", bg: cs.backgroundColor };
      }, dark);
    let dark = true;
    const d = await probe();
    // Glass shipped: blur(14px) — or, where backdrop-filter is unsupported, the opaque fallback #15131F.
    expect(d.filter.includes("blur") || d.bg === "rgb(21, 19, 31)").toBe(true);
    dark = false;
    const l = await probe();
    expect(l.bg).toBe("rgb(255, 255, 255)");
    await expect(page.getByText("Ground & light", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Primary action" })).toBeVisible();
  });
```

Run: `cd /c/Users/danlo/bis-platform/apps/web && npx playwright test styleguide.spec.ts` (detached pattern per the ledger). Expected: FAIL — `getByText("Ground & light")` not found.

- [ ] **Step 2: Add the section**

In `styleguide/page.tsx`, insert before `<Section title="Buttons" …>` (line 66):

```tsx
        <Section title="Ground & light" file="styles/tokens.css · components/ground.tsx">
          {/* The glass ladder: four steps, never more. Each swatch is a token. */}
          <div className="flex w-full flex-wrap gap-3">
            {(["--surface-0", "--surface-1", "--surface-2", "--surface-3"] as const).map((t) => (
              <div key={t} className="flex flex-col gap-1">
                <div className="h-14 w-28 rounded-lg border border-border glass" style={{ backgroundColor: `var(${t})` }} />
                <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">{t}</span>
              </div>
            ))}
            <div className="flex flex-col gap-1">
              <div className="h-14 w-28 rounded-lg" style={{ backgroundColor: "var(--accent-2)" }} />
              <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">--accent-2</span>
            </div>
          </div>
          {/* The hero gradient — display size only (≥ 22px), one per screen. */}
          <p className="hero-text font-display text-3xl font-[650] tracking-[-0.01em] tabular-nums">1,248</p>
          <div className="flex w-full flex-wrap gap-2">
            <Button>Primary action</Button>
            <Button variant="ghost">Ghost action</Button>
            <Button variant="destructive">Delete</Button>
          </div>
        </Section>
```

(Names deliberately avoid the substring "destructive" — the existing test's `getByRole("button", { name: "destructive" })` must keep matching exactly one button.)

- [ ] **Step 3: DESIGN.md amendments (exact old → new)**

1. Header line 3: `> Reference mockups: \`docs/design/bis-design-direction.html\` (open it in a browser).` → `> Reference mockups: \`docs/design/northern-lights.html\` (current — the Northern Lights refresh, 2026-09-08); \`docs/design/bis-design-direction.html\` (history).`
2. Identity — after the bullet `- Violet accent, violet-biased neutrals (no pure grays anywhere).` add: `- Second accent \`--accent-2\` (cyan by default; derived from the brand hue when a brand color is active). Used only where §3.3 of the Northern Lights spec lists.`
3. Foundations → Surface ladder: replace `Depth in dark mode comes from the ladder\nplus \`--shadow-card\` (inset top highlight + soft ambient) — never gray blur\nshadows on dark.` with `Depth in dark mode comes from the lit ground (two accent glows + a masked grid), glass surfaces (translucent steps 1–3 with a 1px top highlight and \`--glass-blur\`), and \`--shadow-card\` — never gray blur shadows on dark; ambient light is accent-tinted.`
4. Rules — after rule 10 add: `11. One hero gradient per screen, named in the screen's spec and marked in code; all other numbers are text-colored.`
5. Charts — replace `Single-hue (accent) for single-series; status colors only for status.` with `Accent for the primary series; ONE second series in \`--accent-2\` is allowed on the same axis, with a legend. Never a dual axis. Status colors only for status.`
6. Definition of done — add two checkboxes after the dark/light line: `- [ ] Renders correctly with the blur fallback (\`@supports not (backdrop-filter)\`)` and `- [ ] Passes the composite contrast test in both themes (\`branding/theme.test.ts\`)`.

- [ ] **Step 4: Gates + perf gate (manual, recorded)**

`cd /c/Users/danlo/bis-platform && pnpm check && pnpm --filter web build`, then `cd apps/web && npx playwright test styleguide.spec.ts` → PASS. Eyeball `/dashboard/styleguide` in both themes against `docs/design/northern-lights.html` (screenshots in the scratchpad, not committed). **Perf gate (§9):** open the Contacts table at 500 rows with the styleguide open beside it, scroll in Chrome with the Performance panel recording; record "no dropped frames" (or the number) in `.superpowers/sdd/progress.md`.

- [ ] **Step 5: Mutation check, commit**

Mutation: remove the `glass` class from `card.tsx:10` → the e2e `d.filter.includes("blur") || …` assertion fails in dark. Revert.

```bash
cd /c/Users/danlo/bis-platform && git add "apps/web/src/app/(dashboard)/dashboard/styleguide/page.tsx" apps/web/e2e/styleguide.spec.ts DESIGN.md && git commit -m 'docs(design): styleguide Ground & light section, e2e proves the glass shipped in both themes, DESIGN.md amended for the Northern Lights refresh'
```

**End of Phase A → open PR 1 (`design/northern-lights` → `main`); merge only when `verify` + `e2e` are green on its head; danlo merges.**

---

# Phase B — PR 2 Data surfaces (branch off `main` after PR 1 merges: `design/northern-lights-data`)

### Task 9: StatTile `hero` + Sparkline area fill

**Files:**
- Modify: `apps/web/src/components/stat-tile.tsx:43-79`, `apps/web/src/components/stat-tile.test.ts` (append), `apps/web/src/components/sparkline.tsx:32-34`
- Create: `apps/web/src/components/sparkline.test.ts`

**Interfaces:**
- Consumes: `hero-text` utility; `sparklinePath(counts, width, height): { line; area; endX; endY }` (`lib/dashboard/metrics.ts:182`).
- Produces: `StatTile` prop `hero?: boolean`; the value `<p>` carries `data-hero="true"` only when `hero` is set (Tasks 11–13 and the e2e count on it).

- [ ] **Step 1: Failing tests**

Append to `stat-tile.test.ts` (add `import { createElement } from "react"; import { renderToStaticMarkup } from "react-dom/server"; import { StatTile } from "./stat-tile";` at the top — keep the existing `hasStatContext` import):

```ts
describe("StatTile hero (spec §5)", () => {
  const render = (hero?: boolean) =>
    renderToStaticMarkup(createElement(StatTile, { label: "Visitors", value: "1,248", delta: { direction: "up", label: "12%" }, hero }));

  it("marks exactly the hero tile with data-hero and the gradient class", () => {
    const html = render(true);
    expect(html).toContain('data-hero="true"');
    expect(html).toMatch(/<p[^>]*data-hero="true"[^>]*class="[^"]*\bhero-text\b/);
    expect(html).not.toMatch(/data-hero="true"[^>]*text-card-foreground/);
  });

  it("a plain tile has no data-hero and stays text-coloured", () => {
    const html = render();
    expect(html).not.toContain("data-hero");
    expect(html).toMatch(/text-card-foreground/);
    expect(html).not.toContain("hero-text");
  });
});
```

Create `apps/web/src/components/sparkline.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Sparkline } from "./sparkline";

describe("Sparkline (spec §5): 1.8px line, 14% area, r 2.4 end dot, currentColor only", () => {
  const html = renderToStaticMarkup(createElement(Sparkline, { counts: [1, 3, 2, 5] }));
  it("uses the spec's stroke and fill", () => {
    expect(html).toMatch(/<polyline[^>]*stroke="currentColor"[^>]*stroke-width="1.8"/);
    expect(html).toMatch(/<polygon[^>]*fill="currentColor"[^>]*opacity="0.14"/);
    expect(html).toMatch(/<circle[^>]*r="2.4"/);
  });
  it("carries no colour literal", () => {
    expect(html).not.toMatch(/#[0-9a-fA-F]{3,8}\b|rgba?\(/);
  });
});
```

- [ ] **Step 2: Run and see them fail**

Run: `cd /c/Users/danlo/bis-platform/apps/web && npx vitest run stat-tile sparkline`
Expected: FAIL — `data-hero` absent; `opacity="0.12"`/`stroke-width="2"`.

- [ ] **Step 3: Implement**

`stat-tile.tsx` — add the prop (after `valueTestId?: string;` line 60):
```tsx
  /** Spec §5: the ONE number on this screen that renders in --gradient-hero.
   *  The screen names it in code; a test counts at most one per screen. */
  hero?: boolean;
```
add `hero,` to the destructuring (line 49), and replace the value `<p>` (lines 74–79):
```tsx
        <p
          data-testid={valueTestId}
          data-hero={hero ? "true" : undefined}
          className={cn(
            "font-display font-[650] text-3xl tracking-[-0.01em] tabular-nums",
            hero ? "hero-text" : "text-card-foreground",
          )}
        >
```
`sparkline.tsx:32-34`:
```tsx
      <polygon points={area} fill="currentColor" opacity={0.14} />
      <polyline points={line} fill="none" stroke="currentColor" strokeWidth={1.8} />
      <circle cx={endX} cy={endY} r={2.4} fill="currentColor" />
```
and fix the header comment (lines 8–9): `stroke-width 1.8, endpoint dot r 2.4, area fill at 14% opacity (Northern Lights spec §5).`

- [ ] **Step 4: Run green**

`cd /c/Users/danlo/bis-platform/apps/web && npx vitest run stat-tile sparkline` → PASS; `cd /c/Users/danlo/bis-platform && pnpm --filter web typecheck`.

- [ ] **Step 5: Mutation check, commit**

Mutation: make `data-hero` always `"true"` → `a plain tile has no data-hero` fails. Revert.

```bash
cd /c/Users/danlo/bis-platform && git add apps/web/src/components/stat-tile.tsx apps/web/src/components/stat-tile.test.ts apps/web/src/components/sparkline.tsx apps/web/src/components/sparkline.test.ts && git commit -m 'feat(design): StatTile hero prop renders the one gradient number per screen; sparkline area 14%, line 1.8px'
```

---

### Task 10: DailyChart — gradient bars, hover glow, gridlines, second series, legend

**Files:**
- Modify: `apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/website/daily-chart.tsx` (whole component body, lines 7–52)
- Create: `apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/website/daily-chart.test.ts`

**Interfaces:**
- Consumes: `bar-accent`, `bar-hot`, `glass-overlay` utilities; `m["website.tile.visitors"]` ("Visitors"), `formatDateUTC`.
- Produces: `DailyChart({ days, secondSeries }: { days: Day[]; secondSeries?: { label: string; values: number[] } })`. Markup contracts: bars `<button data-slot="chart-bar">`; the ONE axis row `data-slot="chart-axis"`; gridlines `data-slot="chart-grid"`; the second series `<svg data-slot="chart-series-2">` with one `<polyline>`; legend `<div data-slot="chart-legend">` only when `secondSeries` is given.

- [ ] **Step 1: Failing tests**

```ts
// …/website/daily-chart.test.ts
import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { DailyChart } from "./daily-chart";

const DAYS = [
  { day: "2026-09-01", visitors: 100, pageviews: 300, isWeekend: false },
  { day: "2026-09-02", visitors: 50, pageviews: 150, isWeekend: false },
  { day: "2026-09-03", visitors: 25, pageviews: 60, isWeekend: true },
  { day: "2026-09-04", visitors: 0, pageviews: 0, isWeekend: true },
];

describe("DailyChart bars (spec §5)", () => {
  const html = renderToStaticMarkup(createElement(DailyChart, { days: DAYS }));
  it("weekday bars wear the accent gradient, weekends --surface-3, and no colour literal appears", () => {
    expect(html.match(/data-slot="chart-bar"[^>]*class="[^"]*\bbar-accent\b/g)?.length).toBe(2);
    expect(html.match(/data-slot="chart-bar"[^>]*class="[^"]*\bbg-accent\b/g)?.length).toBe(2);
    expect(html).not.toMatch(/#[0-9a-fA-F]{3,8}\b|rgba?\(/);
  });
  it("draws two dashed gridlines at 33% and 66% in --line", () => {
    const grid = html.match(/data-slot="chart-grid"[^>]*>/g) ?? [];
    expect(grid.length).toBe(2);
    expect(grid.join(" ")).toContain("bottom:33%");
    expect(grid.join(" ")).toContain("bottom:66%");
    for (const g of grid) expect(g).toMatch(/border-dashed[^"]*border-border|border-border[^"]*border-dashed/);
  });
  it("has exactly one axis row and no second series or legend when none is given", () => {
    expect(html.match(/data-slot="chart-axis"/g)?.length).toBe(1);
    expect(html).not.toContain("chart-series-2");
    expect(html).not.toContain("chart-legend");
  });
});

describe("DailyChart second series (spec §5): same axis, --accent-2, mono legend", () => {
  // Second max (80) is deliberately BELOW the visitors max (100): a series
  // scaled by its own max would put 80 at the top and betray a second axis.
  const second = { label: "Pageviews ÷ 3", values: [80, 40, 20, 0] };
  const html = renderToStaticMarkup(createElement(DailyChart, { days: DAYS, secondSeries: second }));
  it("renders one polyline in --accent-2, 2px, with an end dot", () => {
    expect(html.match(/data-slot="chart-series-2"/g)?.length).toBe(1);
    expect(html).toMatch(/<polyline[^>]*stroke="var\(--accent-2\)"[^>]*stroke-width="2"/);
    expect(html).toContain("bg-[var(--accent-2)]"); // end dot, r 4 = size-2
  });
  it("shares the bars' axis: y is scaled by the VISITORS max, never its own", () => {
    // max visitors = 100 → 80 → y 20, 40 → y 60, 20 → y 80, 0 → y 100; x = (i+.5)/4·100.
    // Scaled by its OWN max (80) the string would start "12.5,0 37.5,50".
    const points = html.match(/<polyline[^>]*points="([^"]+)"/)![1]!;
    expect(points).toBe("12.5,20 37.5,60 62.5,80 87.5,100");
  });
  it("still has exactly one axis row (never a dual axis)", () => {
    expect(html.match(/data-slot="chart-axis"/g)?.length).toBe(1);
    expect(html).not.toMatch(/<text\b/);
  });
  it("legend names both series in mono", () => {
    const legend = html.match(/data-slot="chart-legend"[\s\S]*?<\/div>/)![0]!;
    expect(legend).toContain("font-mono");
    expect(legend).toContain("Visitors");
    expect(legend).toContain("Pageviews ÷ 3");
    expect(legend).toContain("bg-[var(--accent)]");
    expect(legend).toContain("bg-[var(--accent-2)]");
  });
});
```

- [ ] **Step 2: Run and see it fail**

Run: `cd /c/Users/danlo/bis-platform/apps/web && npx vitest run daily-chart`
Expected: FAIL — no `data-slot="chart-bar"`, no gridlines, `secondSeries` ignored.

- [ ] **Step 3: Implement**

Replace `daily-chart.tsx` lines 7–52 with:

```tsx
type Day = { day: string; visitors: number; pageviews: number; isWeekend: boolean };
export type SecondSeries = { label: string; values: number[] };

/**
 * Thin accent-gradient bars with 4px rounded tops, weekend bars muted
 * (`bg-accent` = --surface-3), two dashed gridlines, mono axis labels, a
 * tooltip on hover AND focus (each bar is a button so a keyboard reaches it).
 * Bars are DIVs, not SVG rects, so every colour is a token class.
 *
 * ONE optional second series (Northern Lights spec §5): a polyline in
 * --accent-2 on the SAME axis — its y is scaled by the bars' max, never its
 * own — with a mono legend naming both. Never a second axis.
 */
export function DailyChart({ days, secondSeries }: { days: Day[]; secondSeries?: SecondSeries }) {
  const [active, setActive] = useState<number | null>(null);
  const max = Math.max(1, ...days.map((d) => d.visitors));
  const labelAt = (i: number) => i === 0 || i === days.length - 1 || i === Math.floor(days.length / 2);
  const shortDate = (day: string) => formatDateUTC(day).replace(/,.*$/, "");
  const xAt = (i: number) => ((i + 0.5) / days.length) * 100;
  const yAt = (v: number) => 100 - Math.min(100, Math.max(0, (v / max) * 100));
  const points = secondSeries
    ? days.map((_, i) => `${xAt(i)},${yAt(secondSeries.values[i] ?? 0)}`).join(" ")
    : null;
  const last = days.length - 1;
  return (
    <div className="relative mt-3">
      {active !== null ? (
        <div role="tooltip" className="pointer-events-none absolute -top-1 z-10 rounded-lg border border-border glass-overlay px-2.5 py-1.5 text-xs"
             style={{ left: `${xAt(active)}%`, transform: "translateX(-50%)" }}>
          <span className="block font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">{formatDateUTC(days[active]!.day)}</span>
          <span className="font-semibold text-card-foreground">
            {m["website.chart.tooltip"].replace("{visitors}", days[active]!.visitors.toLocaleString("en-US")).replace("{pageviews}", days[active]!.pageviews.toLocaleString("en-US"))}
          </span>
        </div>
      ) : null}
      <div className="relative flex h-[120px] items-end gap-[6px]" onMouseLeave={() => setActive(null)}>
        {[33, 66].map((pct) => (
          <div key={pct} aria-hidden data-slot="chart-grid" className="pointer-events-none absolute inset-x-0 border-t border-dashed border-border" style={{ bottom: `${pct}%` }} />
        ))}
        {days.map((d, i) => (
          <button
            key={d.day}
            type="button"
            data-slot="chart-bar"
            aria-label={`${formatDateUTC(d.day)}: ${d.visitors} visitors, ${d.pageviews} pageviews`}
            onMouseEnter={() => setActive(i)} onFocus={() => setActive(i)} onBlur={() => setActive(null)}
            className={`relative flex-1 rounded-t-[4px] outline-none transition-opacity duration-150 focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none ${d.isWeekend ? "bg-accent" : "bar-accent"} ${active === i ? "bar-hot" : ""} ${active !== null && active !== i ? "opacity-70" : ""}`}
            style={{ height: `${Math.max(2, (d.visitors / max) * 100)}%` }}
          />
        ))}
        {points ? (
          <>
            <svg data-slot="chart-series-2" aria-hidden="true" viewBox="0 0 100 100" preserveAspectRatio="none" className="pointer-events-none absolute inset-0 h-full w-full overflow-visible">
              <polyline points={points} fill="none" stroke="var(--accent-2)" strokeWidth={2} vectorEffect="non-scaling-stroke" strokeLinejoin="round" strokeLinecap="round" />
            </svg>
            {/* End dot as a DIV: a circle inside a non-uniformly scaled SVG would squash. r 4 = size-2. */}
            <span aria-hidden className="pointer-events-none absolute size-2 -translate-x-1/2 translate-y-1/2 rounded-full bg-[var(--accent-2)]"
                  style={{ left: `${xAt(last)}%`, bottom: `${100 - yAt(secondSeries!.values[last] ?? 0)}%` }} />
          </>
        ) : null}
      </div>
      <div className="mt-2 flex justify-between" aria-hidden data-slot="chart-axis">
        {days.map((d, i) => (
          <span key={d.day} className="flex-1 font-mono text-[10px] uppercase tracking-[0.04em] text-muted-foreground">
            {labelAt(i) ? shortDate(d.day) : ""}
          </span>
        ))}
      </div>
      {secondSeries ? (
        <div data-slot="chart-legend" className="mt-2 flex items-center gap-4 font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
          <span className="flex items-center gap-1.5"><span aria-hidden className="size-2 rounded-[2px] bg-[var(--accent)]" />{m["website.tile.visitors"]}</span>
          <span className="flex items-center gap-1.5"><span aria-hidden className="size-2 rounded-full bg-[var(--accent-2)]" />{secondSeries.label}</span>
        </div>
      ) : null}
    </div>
  );
}
```

- [ ] **Step 4: Run green; gates**

`cd /c/Users/danlo/bis-platform/apps/web && npx vitest run daily-chart` → PASS. `cd /c/Users/danlo/bis-platform && pnpm --filter web typecheck && pnpm --filter web lint`.

- [ ] **Step 5: Mutation checks, commit**

Mutation 1: scale `yAt` for the second series by `Math.max(...secondSeries.values)` instead of `max` (a second axis) → `shares the bars' axis` fails (`points` becomes `12.5,0 37.5,50 62.5,75 87.5,100`). Mutation 2: hard-code `stroke="#4FD8E6"` → `renders one polyline in --accent-2` fails. Revert both.

```bash
cd /c/Users/danlo/bis-platform && git add "apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/website/daily-chart.tsx" "apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/website/daily-chart.test.ts" && git commit -m 'feat(design): daily chart — gradient bars, hover glow, dashed gridlines, one second series in --accent-2 on the same axis with a mono legend'
```

---

### Task 11: Website screen — hero = Visitors, sentence emphasis gradient, second series = pageviews ÷ 3

**Files:**
- Modify: `apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/website/website-section.tsx:39-46,64`
- Modify: `apps/web/src/lib/messages.ts` (after line 1128 `"website.chart.tooltip"`)
- Create: `apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/website/website-section.test.ts`

**Interfaces:**
- Consumes: `StatTile.hero` (Task 9), `DailyChart.secondSeries` (Task 10), `WebsiteView` (`lib/website/view-model.ts:10-21`), `SentenceSegment = { text: string; strong?: true }` (`sentence.ts:3`).
- Produces: message key `"website.chart.series.pageviewsThird": "Pageviews ÷ 3"`.

- [ ] **Step 1: Failing test**

```ts
// …/website/website-section.test.ts
import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { WebsiteView } from "@/lib/website/view-model";
import { WebsiteSection } from "./website-section";

const days = [
  { day: "2026-09-01", visitors: 100, pageviews: 300, isWeekend: false },
  { day: "2026-09-02", visitors: 50, pageviews: 151, isWeekend: false },
  { day: "2026-09-03", visitors: 25, pageviews: 60, isWeekend: true },
];
const VIEW: WebsiteView = {
  period: 14, fromDay: "2026-08-20", toDay: "2026-09-03",
  days,
  totals: { visitors: 175, pageviews: 511 },
  prior: { visitors: 120, pageviews: 400 },
  visitorsDelta: { direction: "up", label: "46%" }, pageviewsDelta: { direction: "up", label: "28%" },
  fromGoogle: { share: 0.4, priorShare: 0.3 },
  topPage: { name: "/", visitors: 90, share: 0.51 },
  pages: [{ name: "/", visitors: 90, share: 0.51 }], sources: [{ name: "google", visitors: 70, share: 0.4 }],
  places: [], devices: [{ name: "mobile", visitors: 120, share: 0.69 }],
  sentence: [{ text: "Your site had " }, { text: "175 visitors", strong: true }, { text: " in the last 14 days." }],
  lastSyncedDay: "2026-09-03", stale: false,
};

describe("Website screen (spec §5)", () => {
  const html = renderToStaticMarkup(createElement(WebsiteSection, { view: VIEW }));

  it("names exactly one hero — Visitors", () => {
    expect(html.match(/data-hero="true"/g)?.length).toBe(1);
    expect(html).toMatch(/data-hero="true"[^>]*>175</);
  });

  it("renders the emphasised sentence segment in the hero gradient at display size (≥ 22px), nothing else coloured", () => {
    expect(html).toMatch(/<strong[^>]*class="[^"]*\bhero-text\b[^"]*">175 visitors<\/strong>/);
    expect(html).not.toMatch(/<strong[^>]*text-primary/);
    expect(html).toMatch(/aria-label="Summary"[\s\S]*?<p class="[^"]*text-\[24px\]/);
  });

  it("passes pageviews ÷ 3 (rounded) as the second series with the legend label", () => {
    expect(html).toContain("Pageviews ÷ 3");
    // 300/3=100 → y 0; 151/3=50.33→50 → y 50; 60/3=20 → y 80 (visitors max 100)
    expect(html.match(/<polyline[^>]*points="([^"]+)"/)![1]).toBe("16.666666666666664,0 50,50 83.33333333333334,80");
  });
});
```

- [ ] **Step 2: Run and see it fail**

Run: `cd /c/Users/danlo/bis-platform/apps/web && npx vitest run website-section`
Expected: FAIL — `data-hero` count `undefined`; `<strong … text-primary>` present; no legend.

- [ ] **Step 3: Implement**

`lib/messages.ts` — after line 1128 add:
```ts
  "website.chart.series.pageviewsThird": "Pageviews ÷ 3",
```
`website-section.tsx:39-44` (the sentence panel):
```tsx
      <section className="rounded-lg border border-border bg-card p-5" aria-label="Summary">
        {/* 24px (mockup --sentence-size): gradient text is legal only at display size (spec §3.4). */}
        <p className="max-w-[62ch] font-display text-[24px] font-[650] leading-[1.3] tracking-[-0.01em] text-card-foreground">
          {view.sentence.map((s, i) => s.strong
            ? <strong key={i} className="hero-text font-[650]">{s.text}</strong>
            : <span key={i}>{s.text}</span>)}
        </p>
      </section>
```
`website-section.tsx:46` — add `hero` to the Visitors tile:
```tsx
        <StatTile hero label={m["website.tile.visitors"]} value={fmt(view.totals.visitors)} delta={view.visitorsDelta} spark={view.days.map((d) => d.visitors)} />
```
`website-section.tsx:64`:
```tsx
        <DailyChart
          days={view.days}
          secondSeries={{ label: m["website.chart.series.pageviewsThird"], values: view.days.map((d) => Math.round(d.pageviews / 3)) }}
        />
```

- [ ] **Step 4: Run green; gates**

`cd /c/Users/danlo/bis-platform/apps/web && npx vitest run website-section messages daily-chart` → PASS (messages.test.ts's roadmap-label scan must accept the new string — it contains no milestone code). `cd /c/Users/danlo/bis-platform && pnpm --filter web typecheck && pnpm --filter web lint`.

- [ ] **Step 5: Mutation check, commit**

Mutation: add `hero` to the Pageviews tile too → `names exactly one hero` fails (count 2). Revert.

```bash
cd /c/Users/danlo/bis-platform && git add "apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/website/website-section.tsx" "apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/website/website-section.test.ts" apps/web/src/lib/messages.ts && git commit -m 'feat(design): Website screen — Visitors is the hero, the sentence emphasis wears the hero gradient at display size, pageviews ÷ 3 rides the chart as the second series'
```

---

### Task 12: Dashboard screen — hero = calls answered this week

**Files:**
- Modify: `apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/dashboard/page.tsx:242-248`
- Create: `apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/dashboard/hero.test.ts`

**Interfaces:**
- Consumes: `StatTile.hero`.
- Produces: nothing.

The page is an async server component wired to eleven `@bis/db` reads (lines 3–8) and `requireAccountAccess`; rendering it under vitest would mean a factory mock of `@bis/db` (blast-radius lesson: vitest throws on any export a factory omits). The one-hero rule is therefore pinned on the source: each `<StatTile … />` element in this file is a JSX literal, so the test counts the ones carrying a `hero` attribute.

- [ ] **Step 1: Failing test**

```ts
// …/dashboard/hero.test.ts
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const page = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "page.tsx"), "utf8");
const tiles = page.match(/<StatTile\b[\s\S]*?\/>/g) ?? [];

describe("Dashboard hero (spec §5): calls answered this week, and only it", () => {
  it("renders several tiles (positive control)", () => {
    expect(tiles.length).toBeGreaterThanOrEqual(6);
  });
  it("exactly one tile carries hero, and it is the calls-answered tile", () => {
    const heroes = tiles.filter((t) => /\bhero\b/.test(t));
    expect(heroes.length).toBe(1);
    expect(heroes[0]).toContain('m["dashboard.kpi.callsAnswered"]');
  });
});
```

- [ ] **Step 2: Run and see it fail**

Run: `cd /c/Users/danlo/bis-platform/apps/web && npx vitest run dashboard/hero`
Expected: FAIL — `heroes.length` 0.

- [ ] **Step 3: Implement**

`dashboard/page.tsx:242-248`:
```tsx
          <StatTile
            hero
            label={m["dashboard.kpi.callsAnswered"]}
            value={String(currentCallsIso.length)}
            delta={callsDelta}
            spark={callsSpark}
            valueTestId="kpi-calls-answered"
          />
```

- [ ] **Step 4: Run green**

`cd /c/Users/danlo/bis-platform/apps/web && npx vitest run dashboard/hero client-access` → PASS (e2e `client-access.spec.ts` reads `kpi-calls-answered` by test id — untouched).

- [ ] **Step 5: Mutation check, commit**

Mutation: add `hero` to the `appointmentsBooked` tile → `exactly one tile carries hero` fails. Revert.

```bash
cd /c/Users/danlo/bis-platform && git add "apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/dashboard/page.tsx" "apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/dashboard/hero.test.ts" && git commit -m 'feat(design): Dashboard hero is calls answered this week; a source test keeps it the only one'
```

---

### Task 13: Styleguide chart section + e2e one-hero check

**Files:**
- Modify: `apps/web/src/app/(dashboard)/dashboard/styleguide/page.tsx:162-170` (chart section), imports (line 4 area)
- Modify: `apps/web/e2e/styleguide.spec.ts` (extend the Task 8 test)

**Interfaces:**
- Consumes: `StatTile` (`@/components/stat-tile`), `DailyChart.secondSeries`, `m["website.chart.series.pageviewsThird"]`.
- Produces: nothing.

- [ ] **Step 1: Failing e2e**

Append inside the Task 8 test, after the `Primary action` assertion:
```ts
    // Spec §5: one hero per screen — the styleguide is a screen too.
    await expect(page.locator('[data-hero="true"]')).toHaveCount(1);
    await expect(page.getByText("Pageviews ÷ 3")).toBeVisible();
```
Run `cd /c/Users/danlo/bis-platform/apps/web && npx playwright test styleguide.spec.ts` → FAIL (`toHaveCount(1)` sees 0).

- [ ] **Step 2: Implement**

Add `import { StatTile } from "@/components/stat-tile";` after line 4 of `styleguide/page.tsx`. Replace the chart section (lines 162–170) with:

```tsx
        <Section title="Stat tiles + website chart" file="components/stat-tile.tsx · …/website/{daily-chart,device-strip}.tsx">
          <div className="grid w-full gap-3 md:grid-cols-2">
            <StatTile hero label="Visitors" value="1,248" delta={{ direction: "up", label: "12%" }} spark={[3, 5, 4, 7, 9, 6, 8]} />
            <StatTile label="Pageviews" value="3,910" delta={{ direction: "flat", label: "0%" }} spark={[9, 8, 9, 10, 9, 8, 9]} />
          </div>
          <div className="w-full">
            <DailyChart
              days={[
                { day: "2026-08-31", visitors: 42, pageviews: 90, isWeekend: false }, { day: "2026-09-01", visitors: 55, pageviews: 120, isWeekend: false },
                { day: "2026-09-02", visitors: 48, pageviews: 101, isWeekend: false }, { day: "2026-09-03", visitors: 61, pageviews: 133, isWeekend: false },
                { day: "2026-09-04", visitors: 80, pageviews: 170, isWeekend: false }, { day: "2026-09-05", visitors: 30, pageviews: 61, isWeekend: true },
                { day: "2026-09-06", visitors: 26, pageviews: 50, isWeekend: true },
              ]}
              secondSeries={{ label: m["website.chart.series.pageviewsThird"], values: [30, 40, 34, 44, 57, 20, 17] }}
            />
          </div>
          <DeviceStrip devices={[{ name: "mobile", visitors: 71, share: 0.71 }, { name: "desktop", visitors: 26, share: 0.26 }, { name: "tablet", visitors: 3, share: 0.03 }]} />
        </Section>
```

- [ ] **Step 3: Gates, eyeball, commit**

`cd /c/Users/danlo/bis-platform && pnpm check && pnpm --filter web build`; `cd apps/web && npx playwright test styleguide.spec.ts` → PASS. Eyeball both themes against the mockup's chart + tiles (scratchpad screenshots).

Mutation: put `hero` on the Pageviews sample tile too → `toHaveCount(1)` fails. Revert.

```bash
cd /c/Users/danlo/bis-platform && git add "apps/web/src/app/(dashboard)/dashboard/styleguide/page.tsx" apps/web/e2e/styleguide.spec.ts && git commit -m 'docs(design): styleguide shows the hero tile and the two-series chart; e2e pins one hero per screen'
```

**End of Phase B → open PR 2; full e2e; read-only review; CI green on the head; danlo merges.**

---

## Self-Review

**1. Spec coverage**

| Spec section | Task(s) |
|---|---|
| §3.1 ground (3 glows, grid, alphas table) | 1 (alphas), 4 (`Ground`) |
| §3.2 surface ladder values, material tokens, `--surface-overlay`, opaque-over-scroll, `@supports` fallback | 1, 2 (`--popover` → overlay), 5 (overlay classes) |
| §3.3 `--accent-2` family: pinned BIS constants, `deriveTheme` derivation, table tests, exhaustive use list | 1 (constants), 3 (derivation + tests); uses: 4 (glow 2), 10 (series 2), 5 (rail via `--sidebar-tint-2`, emitted per tenant in 3), 1 (hero stop). Toast accent word: dropped from scope 2026-09-08 |
| §3.4 hero gradient token, ≥22px, contrast pinned | 1, 2 (`hero-text`), 7, 9, 11 |
| §3.5 unchanged (radii/type/motion) | Global constraints; no task touches them |
| §4 Card / Sidebar / Topbar / Buttons / Inputs / Pills / Badges / Toasts / Overlays / Tables / Skeletons / Empty states | 5 (card, sidebar, topbar, toasts, overlays, tables, skeletons, empty), 6 (buttons, inputs, pills, badges) |
| §5 one hero per screen, sentence emphasis, StatTile, Sparkline, Daily chart, panels unchanged | 9, 10, 11, 12, 13; breakdown-panel untouched (`bg-primary` share bar already = accent) |
| §6 white-label: brand drives everything, `deriveTheme`/`themeStyle`, mirrors in lockstep | 3; mirrors in 1, 2 |
| §7 DESIGN.md five amendments + mockup line | 8 |
| §8 composite contrast (fail-first), gradient ≥22px, focus ring, motion | 7; 11; 2 + 6 (focus); global |
| §9 blur scope, static glows, perf gate recorded in ledger | 5 (no blur on rows/badges/inputs), 4, 8 (gate) |
| §10 rollout (two PRs, gates) | Phase A / Phase B boundaries, Tasks 8 and 13 gates |
| §11 parity tests, `deriveTheme` tables, composite, chart tests, hero rule, e2e styleguide, mutations | 1, 3, 7, 10, 11–13, 8; every task names a mutation |
| §12 DoD | Gates in 8 and 13; tokens-only tests in 1, 4, 9, 10 |

Gaps (explicit): none against the amended spec (toast accent word dropped 2026-09-08). Dashboard one-hero test is a source scan, not a render (Task 12 explains why). Decision 5 note: with `--sidebar-ground` opaque in `.dark` too, glow 1 does not show through the rail as it does in the mockup; the one-line refinement `.dark { --sidebar-ground: transparent; }` (page ground is the same hex) would restore it — not applied, per the decision as given. **DECIDED (orchestrator, 2026-09-08): apply it. In `.dark` set `--sidebar-ground: transparent` so glow 1 shows through the rail exactly as the mockup does; `:root` (light) keeps `#0B0A12` so the sidebar stays dark. Task 1's both-blocks-identical parity case exempts `--sidebar-ground`; Task 2's `sidebar-chrome` utility is unchanged (it paints `--sidebar-ground` under the glass either way).**

**2. Placeholder scan** — no TBD/TODO; every code step shows code; every command has an expected result. Three conditional instructions remain and are intentional, each with the code fully written: Task 3 Step 6b (e2e specs that may pin the body style — values only), Task 3 Step 8 (fixtures that construct `ResolvedTheme` need `accent2`/`glowAlphas`; the search string is given), Task 7 Step 4 (the decided fallback, applied only if the brand sweep reports a failure).

**3. Type consistency** — `hero?: boolean` (Task 9) is what Tasks 11–13 pass; `secondSeries?: { label: string; values: number[] }` (Task 10) is what Tasks 11 and 13 pass; `deriveAccent2(hex: string): string` (Task 3) is what `deriveTheme` and the tests call; `ResolvedTheme.glowAlphas: { glow1; glow2; glow3 }` and `GLOW_ALPHAS` (Task 7 Step 4) are what `themeStyle` and both tests read; chrome token names (`--sidebar-ground/-surface/-line/-text/-text-strong/-tint/-tint-2`) match between Task 1's tokens, Task 2's routes and utility, Task 3's emission and Task 5's classes; `data-slot` names (`chart-bar`, `chart-grid`, `chart-axis`, `chart-series-2`, `chart-legend`, `ground`) match between component and test; utility names (`glass`, `glass-overlay`, `sidebar-chrome`, `btn-primary`, `pill-on`, `hero-text`, `bar-accent`, `bar-hot`) match Task 2's definitions and every consumer; `tokensRootBlock`/`tokensDarkBlock` are hoisted to module scope in Task 7 before both describes use them.

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-09-08-northern-lights.md`. Two execution options:

1. **Subagent-Driven (recommended)** — a fresh subagent per task, review between tasks, fast iteration. REQUIRED SUB-SKILL: superpowers:subagent-driven-development.
2. **Inline Execution** — execute tasks in this session with superpowers:executing-plans, batch execution with checkpoints.

All spec/codebase disagreements found at planning were decided on 2026-09-08 and are baked into the tasks (see "Planning findings" 1, 4, 4b, 4c); nothing in the plan waits on a pick.

