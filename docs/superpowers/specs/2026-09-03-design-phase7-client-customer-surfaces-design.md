# Design Phase 7 — Client-customer surfaces

**Date:** 2026-09-03 · **Status:** approved by danlo (brainstorm 2026-09-03)
**Roadmap:** P7 of `docs/superpowers/plans/2026-08-31-design-migration-roadmap.md`
**Governing contract:** `DESIGN.md` — rule 9, the Booking-page key pattern, and
the definition-of-done.

## Goal

Repair the booking flow's live defects and finish the two contract items that
are genuinely additive. Exit: a customer booking on a dark-themed tenant reads
an error message that passes AA, sees a brand header aligned to the column it
belongs to, knows where they are in the flow, and the cancel page honours the
same host theme hint the booking page does.

## What P7 is NOT (danlo's locked scope calls)

The roadmap's P7 paragraph lists five things. Three are deliberately out, each
for a reason found while scoping — not from lack of time.

1. **No branded card.** The roadmap says "booking page branded card". Both
   public surfaces today paint no card, no border and no shadow, and that is a
   RECORDED DECISION from M4b — `f/[publicId]/form.css:9-12`: *"a themed form
   should be today's form in the tenant's colours, not a card floating on a
   page."* Adding a card to `/b` would either reverse that decision or leave
   the two sibling surfaces inconsistent. Out until someone decides to reverse
   it on purpose.
2. **No token-layer migration.** "Aligned to tokens" is not a literal swap. The
   public pages and all seven email templates consume the shadcn-era semantic
   layer (`--background`, `--card`, `--border`, `--radius`), and
   `themeStyle()` emits **no** `--surface-*`, `--line` or `--shadow-*` at all
   (`lib/branding/theme-style.ts:36-79`). Migrating means changing what the
   theming engine emits, which re-renders every tenant's live public pages —
   on the surfaces the roadmap itself calls money-adjacent and says to touch
   last.
3. **No service description.** There is nowhere to put one: `CALENDAR_COLS`
   (`packages/db/src/booking.ts:72-75`) has no name/title/description column
   and `CalendarRow` has no such field. That is a migration plus a settings UI,
   not a styling task.

Also already done, and therefore not in scope: the roadmap's
"typing-the-name destructive confirms retrofit ... sweep the remainder in P7".
There is nothing left to sweep — no `window.confirm` and no reflexive
"Are you sure?" dialog exists anywhere in `apps/web/src`, and the only
destructive data action in the dashboard (bulk contact delete) already got its
typed-count confirm in P4.

## The five fixes

### 1. The error colour (AA failure, live)

`.bis-booking-error` (`b/[publicId]/booking-page.tsx:412`) and
`.bis-cancel-error` (`b/[publicId]/cancel/[token]/page.tsx:173`) both set
`color: #b91c1c` as an UNCONDITIONAL literal. The form page deliberately
tokenised that same value — `form.css:60` is `var(--form-error, #b91c1c)` —
because per `public-form-theme.ts:44-52` that red is **2.93:1 on all three dark
ramps, under AA, on the sentence that tells a customer their email address is
wrong.**

`--form-error` is already emitted for these pages and is already
contrast-corrected: `public-form-theme.ts:176` is
`ensureContrast(FORM_ERROR, theme.background, 4.5) ?? theme.foreground`, with
the unthemed default `#b91c1c` at `:82`. Both pages already call
`publicFormTheme` and already receive it in their style object — they simply
never read it.

**Change:** `#b91c1c` → `var(--form-error, #b91c1c)` in both rules. The AA
correction comes along for free.

### 2. The brand header has no measure (layout bug, live)

`.bis-booking-brand` (`booking-page.tsx:382`) has no `max-width` and no
`margin-inline`, while `.bis-booking` has `max-width: 480px; margin: 0 auto`
(`:388`). On a wide viewport the client's logo and name sit at the far left
while the booking column is centred. `cancel/[token]/page.tsx:157` vs `:163`
has the identical defect.

The form page already fixed exactly this — `form.css:97-100` gives
`.bis-form-brand, .bis-form` the same two properties, with a comment naming the
failure: *"The brand header is a SIBLING of the form, not a child, so it needs
the same two properties or the logo hangs to the left of the fields it belongs
to."*

**Change:** give the brand row the same measure and centring as the column it
heads, on both pages. Folded into fix 4's shared stylesheet.

### 3. The cancel page ignores the host theme hint

`cancel/[token]/page.tsx:108` calls `publicFormTheme(branding, false)` with no
third argument, so `hostMode` defaults to null. A `?theme=dark` hint reaches
the booking page (`b/[publicId]/page.tsx:117`) and the form page
(`f/[publicId]/page.tsx:125-127`) but not the cancel page — so a dark host site
embeds a light cancel page. PR #22 edited this very file to add `?locale=` and
left the theme argument out.

**Change:** read `?theme=` alongside the `?locale=` it already reads and pass
`parseHostMode(...)` as the third argument, matching the booking page's call
exactly.

### 4. One brand header instead of three

Three near-duplicate brand headers exist: `FormBrand`
(`f/[publicId]/form-brand.tsx:15`, logo capped `max-height: 40px;
max-width: 180px`, name 17px) and two inlined copies in `b/[publicId]/page.tsx`
and `cancel/[token]/page.tsx` (28×28 logo, 15px name, no measure).

**Change:** one `PublicBrand` component plus one shared stylesheet, consumed by
all three routes. `FormBrand`'s null-when-empty behaviour is preserved exactly
— it returns `null` rather than an empty wrapper because an unbranded form must
render byte-for-byte what it rendered before M4b.

**Accepted consequence:** the booking page's logo grows from a fixed 28×28 to
the form's `max-height: 40px` cap. This is the intended convergence, not a
side effect — but it is a visible change on a live surface and belongs in the
screenshot gate.

**Risk, named:** this is the only item that touches the lead form, which is
live and carries real customers. `public-form-theme.spec.ts`'s five theming
tests are the safety net and must pass unchanged; the shared stylesheet has to
preserve `/f`'s current computed styles rather than merely look similar.

### 5. `b/error.tsx` hard-codes everything

`b/error.tsx:31-43` uses literal inline style objects with no `var()` anywhere
— `#18181b`, `#6d28d9`, `#ffffff`, `borderRadius: "0.5rem"`.

**Change:** same `var(--token, literal)` shape as its neighbours.

**Honest limit, stated so nobody mistakes this for a fix that does something:**
a route error boundary renders when the page threw, without branding context,
so in practice it will keep painting the literal fallbacks. This buys
consistency for a future reader, not a better experience for a visitor. It is
in scope only because it is nearly free.

## The two additions

### Step dots

DESIGN.md's Booking-page pattern asks for step dots. The page is already a
three-state flow and the state is already there — nothing new to track:

| Step | Condition | Name |
|---|---|---|
| 1 | neither below | Pick a time |
| 2 | `selectedSlot` set | Your details |
| 3 | `result?.ok` | Confirmed |

Derivation lives in a pure exported function so it is unit-testable without a
DOM (this app's vitest has none — `vitest.config.ts` includes only `*.test.ts`).

Rendered as an ordered list with `aria-current="step"` on the active item.
**The dots do not carry the meaning by themselves:** DESIGN.md rule 3 forbids
status by colour alone, so the current step's NAME renders as visible text
beside them. Each dot also carries a visually-hidden label so the list is
navigable by assistive tech.

The success branch early-returns (`booking-page.tsx:219-232`) and does not
render the week strip, so the indicator must render in BOTH branches.

Copy goes in `lib/booking/public-strings.ts` in **both** languages — PR #22
moved booking copy out of `messages.ts`, and `messages.ts` is the
single-locale dashboard catalogue.

### "Powered by BIS" footer

Zero matches for `Powered by` exist repo-wide today. Add it to the booking page
and the cancel page — the two pages of one flow, seen by one visitor.

**Not on the lead form.** DESIGN.md puts this line in the Booking-page pattern
specifically, and the form has its own reviewed treatment this phase has no
reason to disturb.

**Flagged as a business decision, not a styling one:** a client's own customers
will read the agency's name on the page where they book. DESIGN.md mandates it
and danlo approved it with that consequence stated. Trivial to remove if he
changes his mind.

## Architecture

No new data, no new routes, no schema change, no new dependency. The work is:
one new shared component + one shared stylesheet (fix 4), one new pure
derivation function + its markup (step dots), and four localised edits (fixes
1, 2, 3, 5 and the footer).

`PublicBrand` is the only new module boundary. It takes `{ name, logoUrl }`,
returns null when both are absent, and owns no state.

## Error handling

Nothing here introduces a failure mode. The theming call added to the cancel
page is the same one its two siblings already make, and `publicFormTheme`
already degrades to unthemed defaults when branding is null — the public routes
read branding through a `cache()` wrapper that returns null on a database fault
(`b/[publicId]/page.tsx:30-37`).

## Testing

**Unit (pure, no DOM):**
- the step derivation: each of the three states, and that a successful result
  outranks a selected slot.
- `PublicBrand`'s null case is covered by the existing form specs.

**e2e:**
- a booking walk asserting the step indicator advances 1 → 2 → 3, and that the
  current step's name is present as TEXT (not colour alone).
- the Powered-by footer renders on both the booking and cancel pages.
- **the assertion that justifies this phase:** on a dark-themed tenant, the
  booking page's error text measures ≥ 4.5:1 against its background, using the
  `paintedContrast` helper `e2e/support.ts:20` already provides. A literal
  `#b91c1c` fails this; the token passes it.
- `public-form-theme.spec.ts` re-runs UNCHANGED as the dedupe's proof.

**Screenshot pass** both themes before merge: booking page at steps 1/2/3, the
cancel page, and the form (to prove the dedupe moved nothing).

## Definition of done

DESIGN.md's DoD applies (tokens only for what this phase touches, dark + light,
keyboard, 7 AM copy, `/styleguide` updated if a new component/variant lands —
`PublicBrand` is one). Gates before merge: `pnpm check`, `pnpm --filter web
build`, full `pnpm --filter web test:e2e`, review gate, danlo screenshot gate.

## Out of scope (explicitly)

- The branded card, the token-layer migration, and the service description —
  see "What P7 is NOT" above, with reasons.
- Email templates. They are HTML-with-inline-styles by necessity (clients strip
  `<style>` blocks; Outlook renders through Word) and are unconditionally
  `#f4f4f5`/`#ffffff`/`#18181b` with no dark-mode variant. Moving them onto
  tokens is the same engine migration as item 2 and carries deliverability
  risk on a platform whose email reputation was hard-won. Recorded as a
  follow-up, not attempted here.
- `shell.ts:79`'s `border-radius: 6px`, which is not a sanctioned radius —
  noted for the email pass above, not fixed in isolation.
- The role-based default theme (dark-first for agency, light for clients).
  `resolveThemeMode(cookie, brandMode)` takes no role argument and returns
  light for everyone, so DESIGN.md's "Dark-first operator UI" is currently
  false. Real, but it is a dashboard concern, not a client-customer one.
- `/sign-in` branding. DESIGN.md rule 9 names login as a client-customer
  surface that carries the client's logo and colour, but the app has ONE
  shared sign-in URL and no tenant context before authentication, so it
  cannot be per-tenant without a tenant hint in the URL. Needs its own
  decision.
