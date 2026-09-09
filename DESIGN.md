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
`--line-strong` (interactive edges). Depth in **both** modes comes from the lit
ground (three accent glows — two `--accent`, one `--accent-2` — plus a masked
grid, all sized in `vw`/`vh` so the mockup's proportions survive any viewport),
glass surfaces (translucent steps 1–3 with a 1px top highlight — light's
`--surface-1` is `rgba(255,255,255,.72)`, not white, so the aurora reads
through a card there too), the backdrop blur `--glass-filter` — `blur(14px)`
in dark, `none` in light, never `blur(0px)` — on cards, the sidebar and the
overlays alike (**amended 2026-09-09**: cards blurred, then did not for one
morning on a measured 7–9 dropped frames of 52, and now do again, because the
mockup's `.card` carries `backdrop-filter: var(--card-blur)` and literal
mockup fidelity is the standing instruction), and `--shadow-card` — never gray
blur shadows in either mode; ambient light is accent-tinted, which is why
`--shadow-card` and `--shadow-overlay` are declared on `*`, not `:root`.

**Type roles (3, no exceptions):**
- Display — **Geist 600** (amended 2026-09-09): page titles (22px, `-.02em`),
  KPI numbers (30px, `-.03em`) and the Website sentence panel (24px,
  `--sentence-size`, `-.02em`). It is a WEIGHT-and-tracking role, not a second
  typeface: the mockup loads Bricolage Grotesque for its own page chrome, but
  `.dir-a` — the direction this app ships — deliberately overrides it
  (`docs/design/northern-lights.html:157`, `--f-disp: "Geist"; --disp-w: 600`),
  and the mockup is the source on any disagreement. `--font-display` therefore
  points at `var(--font-geist-sans)`; Bricolage stays declared in the dashboard
  layout but no longer preloads, because nothing paints it.
- UI — Geist 400/500/600: everything functional. Hierarchy by weight first,
  size second, color last.
- Label — Geist Mono 500, 10px, +0.14em, uppercase: sidebar group headers,
  chart captions, table headers, timestamps.
- All aligned digits get `font-variant-numeric: tabular-nums`.

**Shape & motion:** radii are 8px (controls, `--radius-ctl` / the mockup's
`--r-ctl`), 12px (cards, `--radius-card` / `--r-card`; `--radius` is
`0.75rem` so `rounded-lg` and `rounded-xl` finally agree), 999px (pills) —
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
composed from the accent family (`--gradient-hero`, `--gradient-em`,
`--gradient-primary`, `--shadow-glow`, and since 2026-09-09 the accent-tinted
`--shadow-card` and `--shadow-overlay`) are declared on `*`, not `:root`, so
they re-resolve against the accent each element inherits.

## Rules (enforced in review)

1. Every metric ships with context — a delta, sparkline, or period label.
2. New components use the existing 4 surfaces; needing a 5th means redesign.
3. Status (Booked/Abandoned/Spam etc.) is never color alone — dot + word.
4. Tables: whole row is the click target, hover shifts to `--surface-3` (the
   ladder's raised step; light's `--surface-2` sits ON a card, so the raised
   step has to go darker still), visible
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
    code (`data-hero`); all other numbers are text-colored. The Website
    sentence panel's emphasised clause is the one sanctioned second gradient
    moment — the mockup gives it its OWN, deeper pair (`--gradient-em`, the
    mockup's `--em-bg`) and reserves `--gradient-hero` for the KPI.

## Key patterns

- **Sidebar:** grouped nav (OVERVIEW / CRM / COMMUNICATIONS / GROWTH) with
  mono uppercase group labels, active item gets `--accent-dim` bg + a 3px
  gradient rail FLUSH WITH THE SIDEBAR'S EDGE (the mockup's
  `.nav.active::before { left: -12px }`, which needs `-mx-3 px-3` on the
  scrolling nav — `overflow-y-auto` clips the x axis too and ate the rail),
  unread counts as small accent badges. Client switcher at top with a 30px/9px
  avatar carrying the account's initial + timezone. Footer: Settings link +
  a 5px setup progress meter on `--meter-bg`, pinned.
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
on the same axis, with a legend (both swatches the same 10px rounded square —
never a square and a circle). Never a dual axis. Status colors only for
status. Thin marks, 4px rounded tops and 2px feet, a 1px `--axis` rule under
the bars, hover tooltip on every mark, weekend bars muted on `--bar-wk`
(`--surface-3` is 29% too bright for this), and a mono label under EVERY
period — thin by parity when the width will not take them all, never down to
three. The busiest bar is `bar-hot`: the sanctioned violet→cyan gradient, not
the accent bar brightened. Text on charts uses text tokens, never the series
color.

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
Phase 2). **Both moved again on 2026-09-09** with the fidelity pass: `color`
is `#efebf9` (the light ground is a real pale violet now) and `radius` is
`0.75rem` (12px cards). `theme.test.ts`'s parity block was retargeted, not weakened: where
its regexes expected a literal hex in `globals.css` that is now
`var(--accent)`, the assertions now read `tokens.css`'s `--accent` per mode
instead (plus a check that globals' `--primary`/`--ring` still route through
`var(--accent)`, so a wrong token name would still be caught) and the
shadcn-`--accent` case asserts the new `@theme inline` mapping directly.

## Definition of done for any UI PR

- [ ] No hard-coded colors/radii/shadows — tokens only
- [ ] Renders correctly in dark AND light (the app's `.dark` class, not
      `data-theme`) — and in light that means the aurora reads THROUGH the
      card, because `--surface-1` is translucent there too
- [ ] Renders correctly with the blur fallback (`@supports not (backdrop-filter)`)
- [ ] Passes the composite contrast test in both themes (`branding/theme.test.ts`)
- [ ] Loaded, empty, and error states implemented
- [ ] Keyboard: focus ring visible, Esc closes overlays, row nav works
- [ ] Copy passes the "landscaper at 7 AM" read
- [ ] `/styleguide` page updated if a new component/variant was added
