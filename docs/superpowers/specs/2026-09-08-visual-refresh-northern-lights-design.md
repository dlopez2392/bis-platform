# Visual refresh of the BIS dashboard — "Northern Lights"

**Status:** approved in conversation 2026-09-08 (danlo), spec for review.
**Scope:** the dashboard app at app.bis-rgv.com, both themes, agency and client roles.
**Reference mockup (source of truth):** `docs/design/northern-lights.html`. When the app and the mockup disagree, the mockup wins. Tokens are extracted from it, not designed twice.
**Amends:** `DESIGN.md` (five places, listed in §7). Everything in the contract not named there stands.

## 1. Why

The dashboard is correct and reads flat. danlo's words: "very one dimensional, lacks any depth or visual appeal". Three directions were mocked up on the same screen (the Website section): a light-and-layering direction, a light-first colorful one, and a bold gradient-mesh one. He chose the first, "Northern Lights", plus one idea from the second: a second series color in charts.

The direction fixes flatness with **light and layering rather than a new palette**. Every component keeps its shape and copy; the violet identity and both type families stay; white-label remains a one-token swap.

## 2. Goals and non-goals

Goals:
- Depth: the page has a light source, cards are glass over it, elevation reads without gray blur shadows.
- One deliberate color moment per screen (the hero number) and a second accent for it, for the second chart series and for the active rail.
- No component changes shape or copy; every rule in DESIGN.md not amended here still holds.
- Identical treatment for a client's brand color: nothing in the refresh is hard-wired to violet.

Non-goals (out of scope, explicitly):
- The marketing site (bis-rgv.com), the booking page, public forms, emails and the login screen. They keep their existing branded treatment.
- Any element of the "Signal" direction (gradient mesh ground, three-color signature, 20px radii, 44px numbers).
- New typefaces, new radii, animated glows, anything that animates on scroll.
- Restructuring screens or navigation.

## 3. Foundations

### 3.1 The ground has a light source
The dashboard's page layer (`(dashboard)/dashboard/layout.tsx`'s outermost wrapper, behind sidebar and content) paints, as non-interactive fixed layers:
- **Glow 1** — radial, 700×420px, centred at 12% x / −10% y, `--accent` at `--glow-1-alpha`.
- **Glow 2** — radial, 620×380px, centred at 96% x / 8% y, `--accent-2` at `--glow-2-alpha`.
- **Glow 3** — radial, 560×360px, centred at 60% x / 110% y, `--accent` at `--glow-3-alpha`.
- **Grid** — 1px lines every 48px at `--grid-alpha`, masked with a radial falloff so it is visible only in the top third around glow 1.

| token | dark | light |
|---|---|---|
| `--glow-1-alpha` | .28 | .07 |
| `--glow-2-alpha` | .16 | .05 |
| `--glow-3-alpha` | .12 | .04 |
| `--grid-alpha` | .025 | .012 |

Nothing else in the app knows the glows exist. They are static; `prefers-reduced-motion` is irrelevant to them because they do not move.

### 3.2 Surfaces: the ladder stays, dark mode becomes glass
Four steps, never more. Dark values change from opaque fills to translucent whites over the lit ground; light values keep solid fills. Exact values (from the mockup):

| token | dark (new) | dark (old) | light |
|---|---|---|---|
| `--surface-0` | `#0B0A12` | `#0E0D14` | `#F6F5FA` (unchanged) |
| `--surface-1` | `rgba(255,255,255,.035)` | `#16141E` | `#FFFFFF` (unchanged) |
| `--surface-2` | `rgba(255,255,255,.06)` | `#1D1A28` | `#FFFFFF` (unchanged) |
| `--surface-3` | `rgba(255,255,255,.09)` | `#252132` | `#F1EFF7` (unchanged) |
| `--line` | `rgba(255,255,255,.08)` | `#28243A` | `#E8E5F0` (unchanged) |
| `--line-strong` | `rgba(255,255,255,.14)` | `#38334F` | `#D8D4E6` (unchanged) |
| `--text-1/2/3` | `#F1EEFA` / `#9A94B4` / `#7B7593` | `#F2F0F7` / `#A9A3BD` / `#6F6987` | unchanged |

`--text-3` is lifted one step in dark (`#6F6987` → `#7B7593`): on glass over the lit ground the old value falls to about 2.7:1; the new one clears 3:1 at the brightest on-canvas point. Tone is unchanged to the eye.

New material tokens:
- `--glass-blur`: `14px` dark, `0px` light (light cards are solid; blur costs nothing when 0).
- `--glass-highlight`: `inset 0 1px 0 rgba(255,255,255,.06)` dark, `inset 0 1px 0 rgba(255,255,255,.9)` light.
- `--sheen`: `linear-gradient(180deg, rgba(255,255,255,.03), transparent 40%)` dark, `none` light.
- `--shadow-card` (redefined): dark `var(--glass-highlight), 0 20px 50px -30px rgba(0,0,0,.8)`; light `0 1px 2px rgba(29,25,48,.05), 0 12px 32px -18px rgba(29,25,48,.22)`.
- `--shadow-glow`: `0 0 0 1px color-mix(in srgb, var(--accent) 50%, transparent), 0 8px 24px -8px color-mix(in srgb, var(--accent) 70%, transparent)` — the primary button and the selected pill only.

**Opaque-over-scroll rule.** Any surface that floats over scrolling content (drawer, dropdown, popover, tooltip, command palette, toast) uses `--surface-overlay`: `rgba(22,20,34,.88)` dark / `rgba(255,255,255,.96)` light, with the same blur. Text must never read through.

**Fallback rule.** `@supports not (backdrop-filter: blur(1px))` swaps `--surface-1/2/3` to the opaque composites `#15131F` / `#1B1826` / `#211D2E` (dark). Nothing depends on the blur.

### 3.3 Second accent
New token `--accent-2`, with `--accent-2-dim` (14% alpha) and `--ring-glow-2`.
- **BIS default (no brand color active):** pinned constants, not derived. Dark `#4FD8E6`, light `#0891B2`.
- **Brand color active (per-tenant theme):** derived in `deriveTheme` from the brand hue in OKLCH: lightness +0.18 (clamped to 0.85), chroma ×0.9, hue rotated −30°. Analogous, never complementary, so any brand pairs cleanly. The derivation is a pure function with table tests that pin the RULE for five input hues (hue delta −30° ± 6°, chroma ×0.9, lightness +0.18 clamped to .85, a gray stays gray), not color-family names: a single rotation cannot promise "violet → cyan" for every brand, and it does not need to — analogous is the guarantee.
- **Where it appears, exhaustively:** glow 2; the second chart series; the far end of the active-rail gradient; the second stop of the hero gradient. Nowhere else. (An accent word inside toasts was considered and dropped: toasts are plain strings at every call site.)

### 3.4 The hero gradient
`--gradient-hero`: `linear-gradient(90deg, color-mix(in srgb, var(--accent) 50%, white), color-mix(in srgb, var(--accent-2) 60%, white))` in dark (the mockup's stops); in light the stops are `var(--accent)` and `var(--accent-2)` unlightened.
Used only on text at display size (≥ 22px) via `background-clip: text`, and only on the elements §5 names. The lightest stop must clear AA large-text contrast (3:1) on the darkest effective ground; the contrast test in §8 pins it.

### 3.5 Unchanged
Type roles (Bricolage 650 for display, Geist for UI, Geist Mono labels), radii (8 / 11 / 999 — the mockup's 12px card radius is rendered at the contract's 11px; the difference is not visible), 4px spacing grid, motion timings, status colors, `--accent-dim`, `--ring-glow`.

## 4. Components in the shell

Everything here happens through the semantic variables in `(dashboard)/globals.css` and the `Card` primitive unless a file is named.

- **Card** (`components/ui/card.tsx`): background `--surface-1`, border `--line`, `box-shadow: var(--shadow-card)`, `backdrop-filter: blur(var(--glass-blur))`, and a `::before` sheen layer (`--sheen`, pointer-events none). Cards nest as today (`--surface-2` inside `--surface-1`).
- **Sidebar** (`components/app-sidebar.tsx` + the sidebar literal island in globals): the sidebar stays DARK in both themes for the BIS default (the recorded decision stands; the mockup shows it that way). It is chrome, not a fifth content surface: tokens.css gains `--sidebar-ground: #0B0A12`, `--sidebar-surface: rgba(255,255,255,.02)` (the mockup value, with blur), `--sidebar-line` and `--sidebar-text`, identical in `:root` and `.dark`; globals' `--sidebar*` semantic variables route to them and the literal island is retired. Active item: keeps the 3px left rail; the rail becomes `linear-gradient(var(--accent), var(--accent-2))`; the item background stays `--accent-dim` with `--glass-highlight`. Group labels unchanged. Client switcher: the avatar background becomes the accent→accent-2 gradient at 135°. Unread badges: `--accent-dim` fill, accent text (were solid).
- **Topbar** (`components/topbar.tsx`): transparent, bottom hairline `--line`. Sofía's presence dot gets `box-shadow: 0 0 0 4px color-mix(in srgb, var(--good) 22%, transparent)`.
- **Buttons** (`components/ui/button.tsx`): default (primary) variant → `background: linear-gradient(180deg, color-mix(in srgb, var(--accent) 70%, white), var(--accent))`, text stays `--primary-foreground` (derived by `readableTextOn`, so it is contrast-safe on every tenant primary; `--surface-0` is not), `box-shadow: var(--shadow-glow)`. Light mode: gradient stops `var(--accent)` → `var(--accent-strong)`, text white, glow at half alpha. Ghost/outline: `--surface-1` fill, `--line-strong` border, no shadow. Destructive: `--crit-bg` fill, `--crit` text, no gradient, no glow. One primary per view (rule 8) is what keeps this quiet.
- **Inputs / Select / Textarea**: `--surface-2` fill, `--line` border; focus = `border-color: var(--accent); box-shadow: 0 0 0 3px var(--ring-glow)`; no hard outline.
- **Period pills** (Website header; any segmented control): container `--surface-1` with `--line`; selected segment `--accent-dim` fill, `--text-1`, `box-shadow: 0 0 0 1px color-mix(in srgb, var(--accent) 35%, transparent), 0 0 18px color-mix(in srgb, var(--accent) 25%, transparent)`.
- **Badges / chips**: fills soften to `--surface-2` (neutral) and the existing `--good-bg / --warn-bg / --crit-bg` (status); dot + word rule unchanged.
- **Toasts** (`components/ui/sonner.tsx`): `--surface-overlay`, `--glass-highlight`, `0 16px 40px -16px rgba(0,0,0,.9)` dark. Plain text as today.
- **Dialog / Drawer / Popover / Command palette**: `--surface-overlay` + blur; borders `--line-strong`.
- **Tables** (`components/ui/table.tsx`): unchanged behaviour; hover row `--surface-2`; header labels mono as today. No blur on rows.
- **Skeletons** (`components/ui/skeleton.tsx`): `--surface-2` with `--glass-highlight` so they read as the same material as cards.
- **Empty states** (`components/empty-state.tsx`): may sit on a stronger glow: the container gets `--accent-dim` radial at its top-left corner. The sell-the-feature copy rule is unchanged.

## 5. Data surfaces

- **One hero per screen.** Each screen names its hero KPI in code (a `hero` prop on `StatTile`); only that number renders in `--gradient-hero`. Named now: Website → Visitors; Dashboard → the week's headline count (calls handled). A screen with no KPI has no hero. Lint: a test asserts at most one `hero` tile per rendered screen in the two screens above.
- **Sentence panel** (`website-section.tsx`): unchanged copy; the sentence moves from 17px UI to 24px display (the mockup's size, which is what makes the gradient legal under §3.4); the emphasised segment (`SentenceSegment.strong`) renders in `--gradient-hero`. Nothing else in the sentence is colored.
- **StatTile** (`components/stat-tile.tsx`): label (mono), number (display; hero or plain), delta pill (semantic), sparkline.
- **Sparkline** (`components/sparkline.tsx`): line stroke `--accent` 1.8px, area fill `--accent` at 14%, end point dot r 2.4. Colors from tokens; no literals.
- **Daily chart** (`website/daily-chart.tsx`): bars `linear-gradient(180deg, color-mix(in srgb, var(--accent) 95%, transparent), color-mix(in srgb, var(--accent) 25%, transparent))`, 4px tops kept, weekends `--surface-3` as today; hover: `filter: brightness(1.15)` and `box-shadow: 0 0 22px color-mix(in srgb, var(--accent) 45%, transparent)`; tooltip on `--surface-overlay`. **Second series allowed:** an SVG polyline in `--accent-2`, 2px, end dot r 4, on the SAME axis, with a mono legend naming both series ("Visitors", "Pageviews ÷ 3" or whatever the screen defines). Never a second axis. Two dashed gridlines at 33% and 66% in `--line`.
- **Panels + share bars** (`website/breakdown-panel.tsx`): rows unchanged; share bar fill `--accent`; panel titles carry no color.
- **Device strip**: dropped in the Website spec already; unchanged here.

## 6. White-label

- The brand color replaces `--accent` exactly as today. Because every new surface derives from `--accent` (glows, rail, hero gradient, primary button, focus ring) and from the derived `--accent-2`, a client's dashboard glows in their color and never shows BIS violet.
- `deriveTheme` gains `accent2` output; `themeStyle` emits `--accent-2`, `--accent-2-dim`, `--ring-glow-2`. `SAFE_STYLE_FALLBACKS` and the `neutral-ramps`/`theme-style` mirrors are updated in the same commit as the tokens (the M1 lesson: value mirrors must move in lockstep).
- Client-customer surfaces (booking page, forms, emails, login) are untouched.

## 7. DESIGN.md amendments (exact)

1. **Foundations → Surface ladder:** "Depth in dark mode comes from the ladder plus `--shadow-card` … never gray blur shadows on dark" → "Depth in dark mode comes from the lit ground (two accent glows + a masked grid), glass surfaces (translucent steps 1–3 with a 1px top highlight and `--glass-blur`), and `--shadow-card` — never gray blur shadows on dark; ambient light is accent-tinted."
2. **Identity:** add "Second accent `--accent-2` (cyan by default; derived from the brand hue when a brand color is active). Used only where §3.3 of the Northern Lights spec lists."
3. **Rules:** add rule 11 — "One hero gradient per screen, named in the screen's spec and marked in code; all other numbers are text-colored."
4. **Charts:** "Single-hue (accent) for single-series" → "Accent for the primary series; ONE second series in `--accent-2` is allowed on the same axis, with a legend. Never a dual axis."
5. **Definition of done:** add "Renders correctly with the blur fallback (`@supports not (backdrop-filter)`)" and "Passes the composite contrast test in both themes".

Reference mockup line at the top of DESIGN.md points to `docs/design/northern-lights.html`; the previous mockup stays in the repo as history.

## 8. Accessibility

- **Composite contrast test** (`branding/theme.test.ts`, extended): for each brand color in the existing sweep and for the BIS default, compute the effective background under a `--surface-1` card at (a) the glow-1 centre and (b) the darkest point (ground with no glow), by alpha-compositing glow → ground → surface. Point (a) is the brightest point a card can actually occupy (the glow centre sits off-canvas; the plan derives the on-canvas factor). Assert `--text-1` ≥ 4.5:1 and `--text-2` ≥ 4.5:1 at both, `--text-3` ≥ 3:1 at both, and the lightest hero-gradient stop ≥ 3:1 at (b) (large text). Same for light. If a brand color in the sweep still fails in dark after the `--text-3` lift, `themeStyle` emits the three glow alphas at half strength whenever a brand color is active (BIS default keeps full strength), and the sweep is asserted with that. The test must fail first when run against the old tokens with the new glow alphas set to 1.0 (proof it computes).
- Gradient text only at ≥ 22px.
- Focus: every control shows the 3px `--ring-glow` ring; overlays trap focus as today; Esc closes.
- Status never by color alone (unchanged).
- Motion: nothing new animates; hovers 150ms; reduced-motion respected.

## 9. Performance

- Blur only on: Card, sidebar, overlays (dialog/drawer/popover/palette/toast). Never on table rows, list items, badges, inputs inside long lists.
- The glow layers are three fixed `radial-gradient` backgrounds on one element and one masked repeating gradient; no images, no canvas, no animation.
- Measured gate in PR 1: the Contacts table at 500 rows scrolls without dropped frames in Chrome on the dev laptop with the styleguide open beside it (manual, recorded in the ledger).

## 10. Rollout

**PR 1 — Foundation (ships alone, restyles everything):**
tokens.css (§3), `(dashboard)/globals.css` semantic mapping incl. `--surface-overlay`, the ground layer in the dashboard layout, `@supports` fallback, Card/sidebar/topbar/button/input/pill/badge/toast/overlay/skeleton/empty-state treatments (§4), `deriveTheme` + `themeStyle` for `--accent-2` (§6), the composite contrast test (§8), DESIGN.md amendments (§7), `docs/design/northern-lights.html` as the reference, styleguide: a new "Ground & light" section (glows, glass ladder, hero gradient sample, second accent) and the updated Buttons/Form controls/Skeleton sections.

**PR 2 — Data surfaces:**
StatTile `hero`, Sparkline area fill, daily chart gradient + hover glow + second series + legend + gridlines, sentence emphasis gradient, the Website screen's hero assignment and second series (pageviews ÷ 3), the Dashboard screen's hero assignment, styleguide chart section, the one-hero-per-screen test.

Each PR: `pnpm check`, build, full e2e, both themes eyeballed on the styleguide (screenshots kept in the scratchpad, not committed), read-only review, CI green on the head, danlo merges.

## 11. Testing

- Token parity tests (existing `theme.test.ts` parity block) extended to the new tokens; `SAFE_STYLE_FALLBACKS` parity.
- `deriveTheme` table tests for `accent2` (five hues) and for the BIS default (pinned constants, not derived).
- Composite contrast test (§8) with the "fail first" check.
- Chart tests (`daily-chart` / `sparkline` unit tests): assert the second series renders only when given, that its color comes from `--accent-2` (class or CSS var, never a literal), the legend names both series, and gridlines exist.
- Hero rule test: rendering the Website page and Dashboard page with fixture data yields exactly one `data-hero="true"` tile each.
- e2e: existing suites unchanged; `styleguide.spec.ts` gains a check that the "Ground & light" section exists in both themes and that a `.dark` card has a computed `backdrop-filter` (or the fallback background) — proves the material shipped.
- Mutation checks named per test in the plan (a token literal in a component; the hero on two tiles; the second series on a second axis).

## 12. Definition of done

- No hard-coded colors/radii/shadows (tokens only), including the new glow/glass tokens.
- Renders in dark and light, and in the blur fallback.
- Loaded / empty / error states unchanged in behaviour, restyled through tokens.
- Composite contrast test green for every brand color in the sweep.
- Styleguide updated; both themes eyeballed against `docs/design/northern-lights.html`.
- Copy unchanged ("landscaper at 7 AM" read still passes).

## 13. Open questions (none blocking)

- Dashboard hero: "calls handled this week" is the current headline; if the Dashboard is redesigned later, the hero moves with it.
- Whether the login screen (Clerk-hosted appearance) should pick up the ground later — out of scope now, noted for the branding program.
