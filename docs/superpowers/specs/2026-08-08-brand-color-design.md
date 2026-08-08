# Brand Color — Design Spec

**Date:** 2026-08-08
**Status:** approved by danlo, ready for planning
**Follows:** M3 white-labeling (`2026-08-07-m3-white-labeling-design.md`), merged as PR #9

## 1. Goal

A client company's brand color drives the accent on the two surfaces M3 already
white-labeled: their **public lead form** and their **sidebar**.

M3 shipped a name and a logo. The gap it left is visible the moment you look at
a real branded form: the Submit button is BIS violet sitting under a client's
teal mark. The agency's color is the last piece of the agency's identity still
showing on a page the client's own customers see.

## 2. Decisions settled with danlo — do NOT re-litigate

1. **The brand color wins outright.** The per-form accent picker is **removed**,
   not layered under a precedence rule.
2. **Surfaces: the public lead form and the client's sidebar accents only.**
   Buttons inside the CRM keep BIS violet for now — deliberately deferred, see §11.
3. **Email is out.** Not deferred for taste: there is no HTML email in this
   product to color. See §11.
4. **Contrast is derived, never rejected.** A client may pick any color; the app
   guarantees it renders legibly rather than refusing it.
5. **Stored `theme.accent` values are ignored, not migrated.** No data rewrite.

### 2.1 The finding that shaped decision 1

The form editor already has an accent picker: `<Input type="color"
name="accent">` in `form-editor.tsx`, defaulting to `#6d28d9`.

**A native color input always submits a value**, touched or not, and
`forms/actions.ts` stores it verbatim. So every form ever saved through the
editor carries an explicit `theme.accent` of `#6d28d9`, stored identically to a
deliberate choice. Nothing in the data distinguishes "I chose violet" from "I
never opened this control."

That kills the obvious design — *brand color fills in when a form has no
accent* — because it would be a **no-op on every existing form**: correct in
tests, inert in production. Hence: the brand color wins and the picker goes.

Production currently has **zero forms** (verified 2026-08-08 during the M3
production teardown), so removing the picker discards no real data.

**This same trap must not be reproduced in the Settings control — see §7.**

## 3. Data model

Migration `0011_brand_color.sql`:

```sql
-- Nullable, like brand_name and brand_logo_path before it: null means "no
-- brand color", every surface falls back, and shipping this changes nothing
-- for existing accounts.
--
-- Stored as a #rrggbb string rather than three smallints because that is what
-- both consumers want -- a CSS custom property and an <input type="color"> --
-- and because it is the form the value is validated in.
alter table public.accounts add column brand_color text;
```

Extends `Branding` in `packages/db/src/branding.ts`:

```ts
export type Branding = {
  brandName: string | null;
  brandLogoPath: string | null;
  brandColor: string | null;
};
```

`setBranding` gains `brandColor?: string | null`, following the existing
`undefined` = leave alone / `null` = clear semantics already documented there.

## 4. Validation and the latent bug it closes

`brand_color` is interpolated into a CSS custom property on a page anonymous
strangers load. That makes its validation security-relevant, not cosmetic.

**A pre-existing hole this work retires.** `theme.accent` already takes that
path with **no validation at all** — `forms/actions.ts` stores
`String(formData.get("accent") ?? "") || undefined`. A value such as
`url(https://evil.example/pixel.png)` substitutes into `background:
var(--accent)` and causes the customer's browser to issue that request.

It is **not XSS**: per the CSS Variables spec a `var()` substitution that
produces an invalid value makes the declaration invalid at computed-value time
rather than re-parsing the declaration block, so no new declaration can be
injected. It *is* an unvetted outbound request, a tracking vector, and a
defacement vector on the least-trusted surface in the product. Note the forms
editor is reachable by **client** users, not only the agency.

Removing the `theme.accent` read (§9) retires that path. The replacement is
validated at both ends:

- **On write** — `parseHexColor` at the Settings action boundary. Anything that
  is not exactly `#rrggbb` is rejected with `m["branding.badColor"]`.
- **On read, again** — both render paths re-validate before emitting, via the
  §5.1 resolvers rather than each surface doing it by hand. A value that fails is
  treated as unset. Nothing unvalidated reaches CSS, even if a row is written by
  some future path that forgets to check.

Rejected examples the tests must cover: `red`, `#abc`, `#GGGGGG`, `rgb(0,0,0)`,
`url(https://x)`, `#6d28d9; background:url(x)`, `var(--x)`, empty, whitespace.

## 5. The color module

`apps/web/src/lib/branding/color.ts` — **pure, no I/O**, deliberately separate
so it is unit-testable. This mirrors `validate-logo.ts`, which was the one piece
of M3 that could be mutation-tested cleanly.

```ts
parseHexColor(input: string): string | null   // strict; normalizes to lowercase
relativeLuminance(hex: string): number        // WCAG 2.x sRGB formula
contrastRatio(a: string, b: string): number   // (L1 + 0.05) / (L2 + 0.05)
readableTextOn(hex: string): "#ffffff" | "#111111"
lightenForSidebar(hex: string): string
```

`readableTextOn` returns whichever of white or near-black has the higher
contrast against the given color. This is what the form's Submit button text
becomes, replacing a hardcoded `#fff`.

`lightenForSidebar` raises **HSL lightness only, preserving hue and
saturation**, in steps of **0.02**, until the color clears **3:1 against the
sidebar background `#1e1b2e`**, giving up at L=0.95 and returning the best it
reached. 3:1 is the WCAG 1.4.11 threshold for non-text UI components, which is
what the active-item indicator and the icon chip are.

That threshold is not invented: measured, today's `--sidebar-accent` `#8b5cf6`
scores **3.96:1** against `#1e1b2e`, so 3:1 is the bar the shipped design
already clears. The step is load-bearing — a dark navy such as `#1e3a8a`
scores **1.62:1** and is effectively invisible there untreated.

### 5.1 Two resolver helpers, so no surface can forget

Both consumers go through these rather than re-deriving, and each performs the
render-time re-validation required by §4:

```ts
resolveFormAccent(brandColor: string | null):
  { accent: string; accentForeground: string }
resolveSidebarAccent(brandColor: string | null): string | null   // null = use today's tokens
```

A `brandColor` that fails `parseHexColor` is treated as unset by both.

**Resolved open question:** hue is preserved exactly. A very dark navy therefore
lightens toward a *lighter navy* rather than shifting toward a more legible hue.
That can read as a different shade than the client picked. Preserving hue was
chosen anyway: silently changing a company's hue is worse than lightening it,
and the Settings preview (§7) shows them the sidebar rendering so the result is
never a surprise.

## 6. Surfaces

### 6.1 Public lead form

`f/[publicId]/page.tsx` already reads branding for M3; it passes `brandColor`
down. `public-form.tsx` sets:

```
--accent            = validated brandColor ?? "#6d28d9"
--accent-foreground = readableTextOn(that)
```

`form.css` changes `.bis-form-submit` from `color: #fff` to
`color: var(--accent-foreground)`. `--accent` continues to drive the button
background, the input focus outline, and the focused border, so all three follow
the brand with no further change.

`theme.accent` is **no longer read**.

### 6.2 Client sidebar

`dashboard/layout.tsx` already resolves branding for M3 and passes it to
`AppSidebar`. The sidebar sets `--sidebar-accent` as an **inline style on the
`<aside>`**, overriding the token for that subtree only, to
`lightenForSidebar(brandColor)`.

This reaches both existing consumers without touching them: the active-item
indicator bar (`bg-sidebar-accent`) and the icon chip
(`bg-sidebar-accent/20 text-sidebar-accent`).

**The agency branch does not change**, and an unbranded client keeps today's
tokens — including their deliberate light/dark tuning (`#8b5cf6` / `#a78bfa`),
which a flat override would otherwise discard.

## 7. The Settings control

Added to the existing agency-only `BrandingPanel`. Agency-controlled, like the
rest of M3 — there is no client-facing write path and none may be introduced.

**The text field is what submits.** `name="brandColor"`, `#rrggbb`, and **empty
clears it** — mirroring how the display name already behaves. A
`<input type="color">` sits beside it purely as a picker, writing into the text
field via client state.

This shape is deliberate and is the whole lesson of §2.1: a bare color input
would submit `#000000` for every account that never set one, manufacturing the
exact "explicit value that means nothing" problem this spec exists to undo.

The panel shows a small preview of the resulting Submit button and sidebar
indicator, so the derived text color and the sidebar lightening are visible
before saving.

## 8. Fallbacks

| state | form accent | form button text | sidebar accent |
|---|---|---|---|
| no brand color | `#6d28d9` | `#ffffff` | today's tokens, light/dark tuned |
| valid brand color | that color | `readableTextOn` | `lightenForSidebar` |
| stored value fails re-validation | `#6d28d9` | `#ffffff` | today's tokens |

Nothing renders blank, and an unbranded form is byte-identical to today apart
from the `--accent-foreground` custom property, which resolves to the same
`#ffffff` it currently hardcodes.

## 9. Removals

- The accent `Input` in `form-editor.tsx`.
- `accent` from the theme merge in `forms/actions.ts` and from `mergeFormTheme`
  in `lib/forms/editor-helpers.ts` (and its tests, which assert on accent).
- `m["forms.accent"]`.
- `accent` from the `FormTheme` type in `packages/db/src/forms.ts`.

Stored JSON keeps its now-unread `accent` key. No migration, and per-form color
stays reversible if it is ever wanted back.

## 10. Testing

- **Unit, color module:** WCAG contrast against known pairs — black/white
  **21.00:1** (pins the formula itself), `#6d28d9` on white **7.10:1**,
  `#8b5cf6` on `#1e1b2e` **3.96:1**, `#1e3a8a` on `#1e1b2e` **1.62:1**. All four
  measured 2026-08-08, not estimated. `readableTextOn` flipping across the
  luminance midpoint; `lightenForSidebar` taking `#1e3a8a` past 3:1, being a
  no-op for a color already light enough, and preserving hue within rounding.
- **Unit, validation:** every rejection case in §4.
- **Unit, db:** `setBranding` writes and clears `brandColor` under the existing
  `undefined` / `null` semantics.
- **E2E:** the fixture account gets a brand color; assert the **computed**
  `background-color` and `color` of the form's Submit button, and the computed
  background of the sidebar indicator. Computed style, not class names — a class
  assertion passes while the variable is unset.
- Every new assertion **mutation-tested**: break the production code, watch it go
  red, revert. An assertion that cannot fail is worse than none.
- `forms.spec.ts` must pass unchanged — an unbranded form still renders as before.

## 11. Out of scope

- **HTML email.** There is no HTML email in this product: `SendEmailInput`
  carries only `body: string` and the Resend provider sends `text:`. Coloring
  email means building an HTML email system — a provider-interface change, a
  template, and updates to both the form-notification and contact-composer
  senders plus the fake provider. Larger than this feature, and its own project.
- **Primary buttons inside the CRM.** `--primary` drives every filled button,
  badge, focus ring and hover state across both themes; each needs its own
  contrast treatment. Deferred deliberately: ship the contained version, look at
  it on a real client, then decide.
- Custom domains, per-client sending domains, fonts, dark-mode brand variants.

## 12. Constraints inherited from M3

- Branding is agency-only; no client-facing write path.
- `accountId` bound server-side via `.bind(null, accountId)`, never a form field.
- A `"use server"` file exports only async functions; sync helpers go in a
  sibling module.
- All user-visible strings from the `m` catalog.
- Query faults fail loud and name the failing query; **decorative** reads on
  customer-facing paths degrade rather than break the page (the M3 review
  finding — a logo, or a color, is not worth the lead).
- Five gates green before every commit: `pnpm typecheck` · `pnpm lint` ·
  `pnpm test` · `pnpm --filter web build` · `pnpm --filter web test:e2e`.
- E2E: judge a red run by **wall clock** first. Cold ≈ 6-8 min, warm ≈ 2.1-2.6.
  Two consecutive reds is not proof; re-run, then run the spec alone, then audit
  the dev DB read-only.
