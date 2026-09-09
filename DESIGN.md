# BIS Platform — Design System

> This file is the design contract for every UI change in this repo.
> Reference mockups: `docs/design/northern-lights.html` (current — the Northern Lights refresh, 2026-09-08); `docs/design/bis-design-direction.html` (history).
> Tokens: `apps/web/src/styles/tokens.css` — components consume tokens ONLY.
> If a change conflicts with this file, stop and flag it instead of improvising.

## Identity

- Dark-first operator UI; light theme is the default for client-role users.
- Violet accent, violet-biased neutrals (no pure grays anywhere).
- Second accent `--accent-2` (cyan by default; derived from the brand hue when
  a brand color is active). Used only where §3.3 of the Northern Lights spec
  lists.
- Voice: plain language a business owner reads at 7 AM. Never expose internal
  milestone codes (M2/M5/M1c), carrier jargon, or `{{template_syntax}}` in
  client-facing copy.

## Foundations

**Surface ladder (4 steps, never more):** `--surface-0` page → `--surface-1`
cards/sidebar → `--surface-2` nested panels/inputs → `--surface-3`
hover/raised/tooltips. Two border tokens: `--line` (structure),
`--line-strong` (interactive edges). Depth in dark mode comes from the lit
ground (three accent glows — two `--accent`, one `--accent-2` — plus a masked
grid), glass surfaces (translucent steps 1–3 with a 1px top highlight; the backdrop
blur `--glass-filter` — `blur(14px)` in dark, `none` in light, never
`blur(0px)` — is applied to the sidebar and the overlays ONLY: cards scroll,
and their backdrop surfaces dropped 7–9 of 52 frames on an integrated GPU
(measured 2026-09-09, spec §9), while a card over the lit ground has nothing
for a blur to resolve), and
`--shadow-card` — never gray blur shadows on dark; ambient light is
accent-tinted.

**Type roles (3, no exceptions):**
- Display — Bricolage Grotesque 650: page titles and KPI numbers ONLY (exception since Task 11: the Website sentence panel at 24px, mockup `--sentence-size`, also uses the display face).
- UI — Geist 400/500/600: everything functional. Hierarchy by weight first,
  size second, color last.
- Label — Geist Mono 500, 10px, +0.14em, uppercase: sidebar group headers,
  chart captions, table headers, timestamps.
- All aligned digits get `font-variant-numeric: tabular-nums`.

**Shape & motion:** radii are 8px (controls), 11px (cards), 999px (pills) —
no other values. Spacing on a 4px grid. Motion: 150ms hovers, 250ms panels,
`prefers-reduced-motion` respected, and NOTHING animates on scroll.

**Tenant seam:** `deriveTheme`/`themeStyle` override the semantic surfaces
(`--background`, `--card`, `--popover`, `--muted`, `--secondary`, `--border`,
`--input`, `--ring`, the four `--sidebar*` names, `--radius`, `--font-sans`)
and the whole accent family (`--accent`, `--accent-strong`, `--accent-dim`,
`--ring-glow`, `--accent-2`, `--accent-2-dim`, `--ring-glow-2`,
`--sidebar-tint-2`, `--glow-1/2/3-alpha`). The chrome neutrals `--surface-0..3`,
`--surface-overlay`, `--line`, `--line-strong`, `--text-1..3` are MODE-keyed,
not tenant-keyed, and a themed tenant's `--card` is the ramp's opaque colour,
so glass reads only on unthemed (BIS) accounts. A component that paints from a
chrome neutral is choosing the mode-keyed side of the seam on purpose. The
exact emitted key set is pinned in `branding/theme-style.test.ts`. Tokens
composed from the accent family (`--gradient-hero`, `--gradient-primary`,
`--shadow-glow`) are declared on `*`, not `:root`, so they re-resolve against
the accent each element inherits.

## Rules (enforced in review)

1. Every metric ships with context — a delta, sparkline, or period label.
2. New components use the existing 4 surfaces; needing a 5th means redesign.
3. Status (Booked/Abandoned/Spam etc.) is never color alone — dot + word.
4. Tables: whole row is the click target, hover shifts to `--surface-3` (the
   ladder's raised step; light's `--surface-2` is white), visible
   `:focus-visible` ring, bulk-action bar appears when a checkbox is
   ticked (never render checkboxes without bulk actions).
5. Every screen has designed loaded / empty / error states. Empty states sell
   the feature: one sentence of what appears here + the action that causes it.
6. Reversible actions run immediately with an undo toast; destructive actions
   confirm by typing the name. No reflexive "Are you sure?" dialogs.
7. Loading = skeletons shaped like the content. No spinners.
8. One primary button per view; everything else is ghost.
9. Client-customer surfaces (booking page, forms, emails, login) always carry
   the client's logo + brand color from the theming engine.
10. Sidebar: middle nav scrolls, footer cluster (Settings + setup meter) is
    pinned and visible at every viewport height.
11. One hero gradient per screen, named in the screen's spec and marked in
    code; all other numbers are text-colored.

## Key patterns

- **Sidebar:** grouped nav (OVERVIEW / CRM / COMMUNICATIONS / GROWTH) with
  mono uppercase group labels, active item gets `--accent-dim` bg + 3px left
  rail, unread counts as small accent badges. Client switcher at top with
  avatar + timezone. Footer: Settings link + setup progress meter, pinned.
- **Setup:** two-pane wizard — stepper rail (done ✓ / current / todo /
  locked-with-reason) + one step detail pane. First incomplete step
  pre-selected. When all steps complete, Setup leaves the nav; checklist
  remains reachable from Settings.
- **Record views:** list click opens a right-side drawer over the list
  (Esc closes, deep link opens full page). Small edits are inline
  (click value → edit → save on blur + undo toast), not form+Save.
- **Command palette (⌘K):** finds contacts/calls/conversations, jumps to any
  settings section by name, runs actions. Settings sections must be
  registered in the palette index.
- **Booking page:** branded card (client logo, name, service description,
  step dots, "Powered by BIS" footer) on `--surface-0`. Same component for
  embed and direct link.
- **AI presence:** topbar indicator — "● Sofía · on a call" (pulse) /
  "✓ N calls handled this week" (idle).

## Charts

Accent for the primary series; ONE second series in `--accent-2` is allowed
on the same axis, with a legend. Never a dual axis. Status colors only for
status. Thin marks, 4px rounded tops, hover tooltip on every mark, weekend
bars muted (`--surface-3`), mono axis labels. Text on charts uses text
tokens, never the series color.

## Installation status (2026-08-31 — Phase 1 COMPLETE, tokens import LIVE)

The foundation cut-over shipped: `(dashboard)/globals.css` imports
`tokens.css` first and every semantic variable resolves to a token (or a
sanctioned literal island). New UI consumes tokens directly. The records
below document how the two original install conflicts (token-name collision;
theme polarity) were resolved — they are history, not open items. One
notational deviation from this file's own DoD line: themes are keyed on the
app's `.dark` class (next-themes), not `data-theme="light"` — verify "renders
in dark AND light" against the `.dark` toggle.

Resolved 2026-08-31 (Phase 1): tokens restructured to the app's
`:root`(light)/`.dark` scaffolding — values unchanged; the mockup HTML
remains the visual source of truth. The alpha glow token is `--ring-glow`
(renamed from `--ring`, which the shadcn layer owns as the solid focus
color = `var(--accent)`).

Resolved 2026-08-31 (Phase 1, Task 3 — semantic-variable cut-over):
`(dashboard)/globals.css` now imports `tokens.css` first and every shadcn
semantic var either resolves to a token or is a sanctioned literal island
(sidebar block, `--stage-1..6`). `--primary`/`--ring` route through
`var(--accent)`; shadcn's own `--accent`/`--accent-foreground` name (the
hover surface, not the brand accent) was deleted from `:root`/`.dark` and
`@theme inline`'s `--color-accent`/`--color-accent-foreground` point at
`var(--surface-3)`/`var(--text-1)` directly instead, so the brand `--accent`
custom property is never shadowed.

**#6D28D9 (light) and #8B7CF7 (dark) passed the AA contrast sweep in
`branding/theme.test.ts` untouched — no lift was needed.** `BIS.light`/
`BIS.dark` in `theme.ts` were updated to these resolved values (also
`sidebarAccent` → `#A99EFF` in both modes, matching the sidebar-literal
island being identical in `:root` and `.dark` now). `--primary-foreground`
was re-derived via `readableTextOn`: `#ffffff` for light (7.105:1),
`#111111` for dark (5.686:1) — both already what the brief's placeholders
carried.

Two cross-file mirrors that the tokenization's literal-vs-`var()` shape
change broke were brought back into lockstep (values only; no test deleted
or loosened): `neutral-ramps.ts`'s `SIDEBAR_FOREGROUND` `#d4d4d8` →
`#a9a3bd` (globals' sidebar-literal island moved to `#A9A3BD`), and
`theme-style.ts`'s `SAFE_STYLE_FALLBACKS` `color` `#f8f8fb` → `#f6f5fa`
(tokens.css's light `--surface-0`) and `radius` `0.625rem` → `0.6875rem`
(globals' own `--radius` literal, 11px — control convergence deferred to
Phase 2). `theme.test.ts`'s parity block was retargeted, not weakened: where
its regexes expected a literal hex in `globals.css` that is now
`var(--accent)`, the assertions now read `tokens.css`'s `--accent` per mode
instead (plus a check that globals' `--primary`/`--ring` still route through
`var(--accent)`, so a wrong token name would still be caught) and the
shadcn-`--accent` case asserts the new `@theme inline` mapping directly.

## Definition of done for any UI PR

- [ ] No hard-coded colors/radii/shadows — tokens only
- [ ] Renders correctly in dark AND light (`data-theme="light"`)
- [ ] Renders correctly with the blur fallback (`@supports not (backdrop-filter)`)
- [ ] Passes the composite contrast test in both themes (`branding/theme.test.ts`)
- [ ] Loaded, empty, and error states implemented
- [ ] Keyboard: focus ring visible, Esc closes overlays, row nav works
- [ ] Copy passes the "landscaper at 7 AM" read
- [ ] `/styleguide` page updated if a new component/variant was added
