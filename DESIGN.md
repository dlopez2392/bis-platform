# BIS Platform — Design System

> This file is the design contract for every UI change in this repo.
> Reference mockups: `docs/design/bis-design-direction.html` (open it in a browser).
> Tokens: `apps/web/src/styles/tokens.css` — components consume tokens ONLY.
> If a change conflicts with this file, stop and flag it instead of improvising.

## Identity

- Dark-first operator UI; light theme is the default for client-role users.
- Violet accent, violet-biased neutrals (no pure grays anywhere).
- Voice: plain language a business owner reads at 7 AM. Never expose internal
  milestone codes (M2/M5/M1c), carrier jargon, or `{{template_syntax}}` in
  client-facing copy.

## Foundations

**Surface ladder (4 steps, never more):** `--surface-0` page → `--surface-1`
cards/sidebar → `--surface-2` nested panels/inputs → `--surface-3`
hover/raised/tooltips. Two border tokens: `--line` (structure),
`--line-strong` (interactive edges). Depth in dark mode comes from the ladder
plus `--shadow-card` (inset top highlight + soft ambient) — never gray blur
shadows on dark.

**Type roles (3, no exceptions):**
- Display — Bricolage Grotesque 650: page titles and KPI numbers ONLY.
- UI — Geist 400/500/600: everything functional. Hierarchy by weight first,
  size second, color last.
- Label — Geist Mono 500, 10px, +0.14em, uppercase: sidebar group headers,
  chart captions, table headers, timestamps.
- All aligned digits get `font-variant-numeric: tabular-nums`.

**Shape & motion:** radii are 8px (controls), 11px (cards), 999px (pills) —
no other values. Spacing on a 4px grid. Motion: 150ms hovers, 250ms panels,
`prefers-reduced-motion` respected, and NOTHING animates on scroll.

## Rules (enforced in review)

1. Every metric ships with context — a delta, sparkline, or period label.
2. New components use the existing 4 surfaces; needing a 5th means redesign.
3. Status (Booked/Abandoned/Spam etc.) is never color alone — dot + word.
4. Tables: whole row is the click target, hover shifts to `--surface-2`,
   visible `:focus-visible` ring, bulk-action bar appears when a checkbox is
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

Single-hue (accent) for single-series; status colors only for status.
Thin marks, 4px rounded tops, hover tooltip on every mark, weekend bars
muted (`--surface-3`), mono axis labels. Never a dual-axis chart. Text on
charts uses text tokens, never the series color.

## Installation status (2026-08-31)

Contract, mockups, and tokens file are INSTALLED; the tokens import into
`(dashboard)/globals.css` is DELIBERATELY DEFERRED — the contract's own
stop-and-flag rule applied to itself. Two conflicts with the live app must be
resolved by the first migration task, not by a blind import:

1. **Token-name collision:** `globals.css` already defines `--accent` and
   `--ring` (the shadcn set, consumed app-wide); this file defines the same
   names with different values on `:root`. Importing as-is flips live colors.
2. **Theme polarity:** this contract is dark-default keyed on
   `[data-theme="light"]`; the app is light-default keyed on a `.dark` class
   (next-themes). The bridge (next-themes `attribute="data-theme"` or a
   selector alias) is part of migration task 1, alongside resolving #1 and
   the `body`/`:focus-visible` base rules that would beat Tailwind's layers.

Until that task lands, new UI follows this contract's RULES and PATTERNS
(surfaces, type roles, radii, states, copy voice) while consuming the
EXISTING globals.css variables; the token cut-over happens once, deliberately.

## Definition of done for any UI PR

- [ ] No hard-coded colors/radii/shadows — tokens only
- [ ] Renders correctly in dark AND light (`data-theme="light"`)
- [ ] Loaded, empty, and error states implemented
- [ ] Keyboard: focus ring visible, Esc closes overlays, row nav works
- [ ] Copy passes the "landscaper at 7 AM" read
- [ ] `/styleguide` page updated if a new component/variant was added
