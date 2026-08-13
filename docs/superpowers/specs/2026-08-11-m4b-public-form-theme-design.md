# M4b — The Public Form Wears The Tenant Theme — Design Spec

## 1. Goal

A client's workspace already wears their design: `brand_color` plus the four
check-constrained enums (`brand_neutral`, `brand_corners`, `brand_type`,
`brand_mode`) derive a full token set that M4a paints on `<body>`. Their public
lead form — the one surface their own customers ever see — gets three of those
values and throws the rest away. `f/[publicId]/page.tsx` reads the whole
`Branding` row today and uses `brandName`, the logo, and `brandColor`. Neutral,
corners, type and mode are fetched and discarded.

Everything else on that page is hardcoded in `form.css`: a `system-ui` font
stack, `#18181b` text, `#d4d4d8` input borders, `#fff` input fills, and a
`.dark` block of `#fafafa` / `#18181b` / `#3f3f46`.

M4b closes that gap. After it, the form a stranger fills in looks like the
workspace the client signed into.

## 2. Decisions settled with danlo — do NOT re-litigate

1. **The tenant theme wins; the per-form `theme.radius` and `theme.mode` are
   retired.** Same call as removing the per-form accent picker in the
   brand-colour milestone: a company has one brand, not one per form. Neither
   field has ever had an editor control (`forms/actions.ts:82-85` says so in a
   comment), so no human choice is being overridden.
2. **On a transparent embed the theme contributes colour, corners and typeface
   only** — no surfaces, no mode. The `transparent` checkbox already means "the
   host page owns the backdrop". A dark-mode tenant who also checks it would
   otherwise paint near-white text onto a white host page and the form would
   vanish.
3. **`brand_type` reaches the form as the same web fonts the workspace uses**,
   not a system-stack approximation, so the two surfaces match exactly.
4. **`brand_mode: "follow"` honours the visitor's device** via a
   `prefers-color-scheme` media block, rather than silently resolving to light.
   A setting that reads "follow the device" and quietly does nothing on the
   public form is the same shape as `brand_type` being inert for all of M4a.

## 3. What each visitor sees

| Case | Colour | Corners | Typeface | Surfaces | Mode |
| --- | --- | --- | --- | --- | --- |
| Standalone `/f/<publicId>` | yes | yes | yes | yes | `brand_mode` |
| Embed, `transparent` unchecked | yes | yes | yes | yes | `brand_mode` |
| Embed, `transparent` checked | yes | yes | yes | **no** | **none** |
| Account with no theme controls set | today's `resolveFormAccent` | no | no | no | light |

The last row is the important compatibility promise: an account that has set no
theme controls renders **byte-identical to today**. `deriveTheme` returns `null`
unless at least one of neutral/corners/type/mode is set, and this route treats
that null as "paint nothing" — `form.css`'s own values stand. A brand colour
alone does not engage the theme, on the form or in the workspace.

## 4. The module

New: `apps/web/src/lib/branding/public-form-theme.ts`. Pure, no `@bis/db`
runtime import (`Branding` crosses as a type only, the rule
`tenant-theme.ts` already follows).

```
publicFormTheme(branding: Branding, transparent: boolean): PublicFormTheme

type PublicFormTheme = {
  /** Inline custom properties for <main>, or null when nothing is themed. */
  style: CSSProperties | null;
  /** Declarations for a prefers-color-scheme: dark block, or null. */
  darkCss: string | null;
  /** The CTA fill + its label. Always present, themed or not. */
  formAccent: { accent: string; accentForeground: string };
  /** For the data-tenant-theme attribute and for tests. */
  themed: boolean;
};
```

It composes existing pieces rather than adding a second mapping:

- `themeInputsFrom(branding)` — the shared DB-row-to-inputs mapping.
- `deriveTheme(inputs, "light")` and `deriveTheme(inputs, "dark")`. Both are
  computed; `follow` needs the pair and the call is pure and cheap.
- `themeStyle(resolved)` — the already-validated emitter. Every token this route
  paints goes through it, so `parseHexColor`, `resolveCssLength` and
  `FONT_ALLOWLIST` guard the form exactly as they guard the workspace.
- `resolveFormAccent(brandColor)` for the CTA, then lifted (§6).

Mode selection, given `inputs.mode`:

| `brand_mode` | `style` | `darkCss` |
| --- | --- | --- |
| `null` (and no other control) | `null` | `null` |
| `light` | light tokens | `null` |
| `dark` | dark tokens | `null` |
| `follow` | light tokens | dark tokens |

`color-scheme` rides in the style object beside the tokens, set to the painted
mode. It is added here rather than inside `themeStyle`, which the dashboard also
calls and where `globals.css` and next-themes already own it.

With `transparent: true`, `style` carries only `--radius`, `--font-sans` and the
CTA pair, and **`darkCss` is `null` even for a `follow` tenant** — neither
corners nor typeface change with mode, so a media block would carry nothing.
The CTA is lifted against `#fff` in that case, the same surface the unthemed
path uses, because the host page's backdrop is unknowable and light is the
overwhelming default.

## 5. The dark block is a serialization, not a second mapping

`darkCss` is built by walking `Object.entries(themeStyle(dark))` and joining
`--key:value` pairs. There is one token table and one set of validators; the
media block carries what the style attribute would have carried.

This is the one place the route emits CSS **text** rather than a React `style`
object, so it forfeits React's entity-escaping. That is acceptable here and
only here, because every value in that object has already passed a validator
that admits nothing but hex colours, a length, and three allowlisted `var()`
references. As a belt: the serializer emits only keys matching `^--[a-z-]+$`
and values matching `^[#a-z0-9(),.\- ]+$`, dropping anything else. A value that
somehow failed both the validator and the charset check is dropped rather than
printed.

## 6. Two hazards this creates, and how each is closed

### 6.1 `--accent` means two different things

In `form.css` it is the brand accent — the Submit fill and the focus outline.
In the derived token set it is the ramp's own *subtle hover surface*, and M4a
made it deliberately **not** brand-driven, because a brand-filled accent made
every dropdown row loud.

Emitting `themeStyle` over today's CSS unchanged would therefore turn every
Submit button into a pale grey block, with a green test suite. The form's pair
is renamed **`--form-accent` / `--form-accent-foreground`**. The derived
`--accent` goes unused on this route; that is fine and is preferable to
redefining a token's meaning on one page.

### 6.2 Dark mode makes a contrast hazard reachable for the first time

`resolveFormAccent` returns the brand's *true* colour and picks a legible label
with `readableTextOn`. It has never needed a surface lift because the form was
always white. `brand_mode: "dark"` makes a dark navy brand on a near-black card
real.

So the CTA is lifted to **≥3:1**, per mode, through the existing
`ensureContrast`. It lands on two surfaces, not one — the Submit sits on the
page (`--background`) and the same colour is the focus outline on an input
filled with `--card` — so the lift follows the treatment `deriveTheme` already
gives its own `ring`: lift against the background, then lift the result again if
the card turns out to be the harder of the two. **One value, used for both**,
rather than a second accent that could disagree with the first.

Unthemed and transparent forms lift against `#fff`, which leaves today's values
unchanged for every brand colour that already cleared it.

**Not** `--primary`. `deriveTheme` lifts `primary` for 4.5:1 *as 12px link
text*, because it doubles as `text-primary` and the `link` button variant. A
Submit fill needs 3:1 plus a legible label, and using the lifted value would
visibly shift a client's button off the brand colour they chose.

## 7. Fonts

`f/layout.tsx` declares Geist, Inter and Source Serif 4 through
`next/font/google` and puts their `.variable` classes on `<html>`.

All three carry `preload: false`, unlike the dashboard, which preloads Geist as
its always-painted default. On this route Geist is *not* always painted: an
unthemed form falls back to `system-ui` and downloads no font at all. Preloading
the default would spend a font request on the majority of embeds for a face
nothing paints.

Stated cost: a tenant who engages the theme by setting only a neutral still gets
`FONT["geist"]`, so their form downloads a font where today it downloads none.
That follows from "any one control engages the whole theme", which is already
how the workspace behaves.

## 8. Route changes

`f/[publicId]/page.tsx`
- calls `publicFormTheme(branding, form.theme.transparentBackground ?? false)`;
- renders `<main style={style} data-tenant-theme={themed ? "" : undefined}>` —
  the same attribute the dashboard exposes, and the same e2e hook;
- renders the `<style>` block only when `darkCss` is non-null;
- stops deriving `className="dark"` from `form.theme.mode`;
- passes `formAccent` to `PublicForm` in place of today's `accent`.

`f/[publicId]/public-form.tsx`
- emits `--form-accent` / `--form-accent-foreground`;
- drops `--radius: resolveFormRadius(theme.radius)` — radius now arrives with
  the token set, or falls back inside `form.css`;
- keeps `background: transparent` for the transparent case.

`f/[publicId]/form.css`
- every hardcoded value becomes `var(--token, <today's value>)`, so the unthemed
  render is unchanged: `--font-sans` over the `system-ui` stack, `--foreground`
  over `#18181b`, `--card` over `#fff` for input fills, `--border` over
  `#d4d4d8`, `--muted-foreground` over `#71717a`, `--radius` unchanged;
- **`<main>` is the only element that paints a surface**, and it paints
  `--background`. `.bis-form` itself keeps no background of its own beyond
  today's `transparent` case. The standalone page therefore stays one flat
  colour rather than becoming a card floating on a page — a themed form should
  look like today's form in the tenant's colours, not like a new layout, and a
  non-transparent embed must not show a two-tone rectangle inside its iframe;
- the `.dark` block is **deleted**. The dark token set carries the mode itself,
  so there is no class to toggle and no second set of literals to keep in step;
- `color-scheme` is emitted with the token set so native inputs, scrollbars and
  autofill match the painted mode.

`packages/db` — no migration. `forms.theme` keeps `radius` and `mode` in its
type and its rows; both simply stop being read. Blueprint capture and apply
still copy them across accounts, where they are now inert.

## 9. Removals

- `resolveFormRadius` in `lib/forms/safe-theme.ts` loses its only call site and
  goes, with its tests. `resolveCssLength` stays — `themeStyle` uses it.
- The `.dark` selectors in `form.css`.
- The `theme.mode === "dark"` branch in `page.tsx`.

Verify at implementation time that `resolveFormRadius` has exactly one caller
before deleting it.

## 10. Testing

**Unit, on the new module.** Mode selection across `null` / light / dark /
follow; the transparent path dropping surfaces and mode while keeping corners,
typeface and CTA; the unthemed case returning `style: null`; the serializer
dropping a key or value that fails its charset. Each one mutation-checked —
reintroduce the defect, watch the test fail, revert. A green assertion that was
never seen red proves nothing here.

**Contrast.** The form's pairings join the existing sweep in
`branding/theme.test.ts` rather than getting a private one: CTA vs
`--background` ≥3:1, the same CTA as focus outline vs `--card` ≥3:1, CTA label
vs CTA ≥4.5:1, body text vs `--background` ≥4.5:1, and input border vs input
fill ≥3:1 — across every neutral × mode × the brand-colour sample set that sweep
already walks. That sweep is what found two AA defects live in production; the
form belongs inside it.

**Cross-check.** A test pinning `form.css`'s fallback literals against the
module's unthemed answers, the same shape as `7c5a8e3`. Two copies of a value in
two languages is exactly how `brand_type` stayed inert.

**e2e.** `/f/<publicId>` is anonymous, so this needs no Clerk session — the
cheapest surface in the product to test honestly. Assert **painted** values via
`getComputedStyle`: `background-color`, `color`, `font-family`, `border-radius`.
Never a custom property. Reading `--background` back is what let four green M4a
tests sit on top of a page that was still entirely BIS.

Cases: a themed tenant paints their neutral and typeface; an unthemed account
matches today's values; a transparent embed keeps `rgba(0, 0, 0, 0)` and picks
up no surface; a `dark` tenant paints dark; and a `follow` tenant paints dark
under Playwright's `colorScheme: 'dark'` context option and light without it.

Cleanup belongs in a `finally`. `auth.teardown` runs only when a suite
completes, so a killed run otherwise strands fixture rows — this has already
cost the project a stranded Clerk identity and a public file in Storage.

## 11. Out of scope

- **Appearance controls in the form editor.** The tenant theme is the only
  input; the editor keeps its single `transparent` checkbox.
- **A form preview in the Settings panel.** The specimen there previews the
  workspace. Showing the public form beside it is a reasonable later increment
  and is not this one.
- **Per-client favicon**, email branding, and custom domains. Separate items.
- **Dropping `radius`/`mode` from `FormTheme`.** They go unread; removing the
  columns and the blueprint fields buys nothing and costs a migration.

## 12. Constraints inherited from M4a

- Never assert a CSS custom property as evidence. Assert what is painted.
- Any one of the four controls engages the whole theme. There is no partial
  state where, say, corners apply and surfaces do not.
- Values reaching a `style` attribute are validated at the emitter, not at the
  call site, because React does not strip `;` from a style value.
- The agency's own chrome stays BIS by having no theme to emit — not by a
  conditional. The same holds here: an unthemed account takes the `null` path.

## 13. What implementation changed about this spec (2026-08-12)

Recorded here rather than silently, because a spec that no longer describes
the code is worse than no spec.

1. **`style` is never null.** §4 has it null for an unthemed account. That
   would have dropped the brand colour off the CTA — an account with a colour
   and no theme controls is the majority case, and it paints that colour
   today. The token set is what varies; the CTA pair is always emitted, and
   `themed` (not nullness) drives `data-tenant-theme`.
2. **The CTA custom properties are emitted on `<main>`, not by
   `public-form.tsx`.** §8 assigns them to the form element. An inline style
   there outranks the `prefers-color-scheme` rule on the ancestor, so a
   `follow` tenant's CTA would have been pinned to its light value on a dark
   device. One element carries the whole set.
3. **The dark block carries `!important`, and `darkCss` is the whole `@media`
   rule** rather than its declarations. Same cause: the light tokens are an
   inline attribute on the element the rule selects, and inline beats any
   author rule. Without it the block parses, matches, and changes nothing.
   Returning the complete rule keeps the selector beside the values it scopes.
4. **`--form-error` was added.** Not in this spec at all. `form.css`'s
   validation red is 6.1:1 on a light page and **2.93:1 on all three dark
   ramps** — the message telling a customer their email address is wrong. Only
   `brand_mode` makes it reachable, so it is lifted per mode.
5. **The CTA lift is `liftForLabel`, not the bare two-surface walk.** §6.2
   asks for 3:1 visibility. That alone ships a 4.459:1 label on `#8b5cf6` (and
   its neighbours in the dead luminance band), which is a **live AA defect on
   today's form** — `resolveFormAccent` never lifted for the label at all.
   `liftForLabel` took a visibility parameter instead of being duplicated.
6. **The unthemed CTA is lifted too**, resolving §3's "byte-identical" against
   §6.2's "lift against `#fff`" in favour of §6.2. Only colours that could not
   be seen on white, or could not carry a label, move at all.
7. **Input border vs input fill is asserted at 1.25:1, not §10's 3:1.**
   Measured: the ramps land at 1.29–1.36:1 and today's form literal at
   1.478:1. **Nothing in this product meets 1.4.11 for an input's boundary**,
   the dashboard included; asserting 3:1 would fail every combination and the
   fix is a change to the shared ramps, which M4b does not own. Recorded as a
   design-system item.
8. **`resolveFormAccent` is deleted**, and the Settings preview's unthemed
   swatch now calls `publicFormTheme` — it was previewing a colour the form no
   longer paints.
