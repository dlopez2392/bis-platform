# Branded sign-in

**Status:** approved in conversation 2026-09-11 (danlo), spec for review.
**Scope:** the three signed-out screens of the dashboard app — `/sign-in` (and its Clerk task routes), `/` and `/no-access`. Both themes.
**Direction mockups (source of truth for the layout):** https://claude.ai/code/artifact/323e1d92-3afa-4e02-9831-65704f1e2241 — direction 03, "the rail", **with the ghost nav dropped**. Where this spec and the mockup disagree about the rail's contents, this spec wins: the mockup drew a nav that was explicitly rejected.
**Amends:** `DESIGN.md` rule 9 (one place, §7). Everything else in the contract stands.
**Out of scope, tracked separately:** moving Clerk from its development instance to a production one (§8).

## 1. Why

`(dashboard)/sign-in/[[...sign-in]]/page.tsx` is three lines — a flex wrapper around a bare
`<SignIn />`. It has no logo, no brand colour, and not even the app's own background: it is the
only page in the product that does not mount `Ground`. `/` and `/no-access` both do, so the three
signed-out screens already disagree with each other.

`DESIGN.md` rule 9 names login as a client-customer surface that must carry "the client's logo +
brand color from the theming engine". That is the item the CRM review marked Do-next, and taking
it literally is impossible — see §2.

## 2. The problem rule 9 walks into, and the decision

The root layout paints `themeStyle(theme)` from `getRequestTheme()`, which resolves the tenant
through `resolveClientAccessState()` → Clerk `auth()`. **Signed out, that returns `status: "none"`,
so `themeInputsFrom(null)` yields no theme object and no `data-tenant-theme` attribute.** There is
no account to read a logo or a brand colour from, because identifying the account is what the page
exists to do.

Three ways out were put to danlo:

1. **Platform-branded only** — the page wears BIS's mark and accent; rule 9 is amended to say so.
2. **A per-client sign-in link** (`/sign-in?c=<id>`) that reads branding unauthenticated.
3. **Brand after the email is entered** — a custom flow that looks the account up first.

**Decision: option 1.** The reasons, recorded so this is not re-litigated:

- Option 2 needs a stable public account id, an unauthenticated branding read (an enumeration
  surface to rate-limit), and it only works for a client who bookmarks that exact link rather than
  the bare domain.
- Option 3 means replacing Clerk's `<SignIn />` with a hand-built flow. That breaks the
  organization-selection task screen `auth.setup.ts` depends on, and there is no
  email-domain → account mapping in the schema to look anything up by.
- Neither has anything to show today. There are **two accounts in the database** — `Test Client One`
  (the fixture) and `Bespoke Intelligent Solutions` (the agency's own, client access off) — **and
  zero brand logos have ever been uploaded.** A mechanism for painting a tenant's brand pre-auth
  would ship with no tenant to paint.

## 3. Goals and non-goals

Goals:

- The three signed-out screens render through one shell and read as one product.
- The sign-in page is recognisably this app before a word is read, in both themes.
- Clerk's form is restyled through tokens only — no hard-coded colour, radius or shadow.
- Nothing about tenant theming changes. A signed-out request still resolves to "no tenant", and
  `data-tenant-theme` is still absent.

Non-goals (explicitly out of scope):

- Any per-tenant branding at sign-in. See §2.
- A theme toggle on the signed-out screens. See §6.
- Sign-up. There is no `/sign-up` route and clients are provisioned through Clerk organizations.
- Password reset copy or flow. Clerk owns it and it works.
- The Clerk production-instance migration. See §8.

## 4. The shell

A new `components/auth-shell.tsx` renders the frame all three signed-out screens use:

- `Ground` (the existing component, unchanged) on `--surface-0`.
- Centred on it, one card: `glass`, `--radius-card`, `--line`, `--shadow-card`, `max-width: 840px`.
- The card is a two-column grid, `[rail | content]`, rail fixed at `200px`.

### 4.1 The rail

The rail's whole point is that it is the dashboard sidebar's chrome: **the one surface in the app
that is dark in both themes**, which is what makes a login recognisable as this product and what
gives the light theme an anchor it otherwise lacks.

- It uses the existing `@utility sidebar-chrome` **verbatim** — `background-color:
  var(--sidebar-ground)` with `background-image: linear-gradient(var(--sidebar), var(--sidebar))`
  and `backdrop-filter: var(--glass-filter)`. It does **not** invent a fifth surface, and it does
  not restate those values; `globals.css` stays the one place they are declared. Right border is
  `--sidebar-line`.
- Contents, in order, and nothing else: the mark at 28px, the wordmark `m["shell.brand"]` ("BIS")
  in `--sidebar-text-strong` at `text-sm font-semibold` — the exact treatment `app-sidebar.tsx`
  gives it today — and a single line of `--sidebar-muted` micro-copy (§10).
- **No navigation, no meter, no ghost items.** The direction mockup drew a nav; it was rejected
  because a nav that navigates nowhere is decorative chrome pretending to be structure, which is
  exactly what DESIGN.md exists to prevent.

### 4.2 Responsive

Below `640px` the grid collapses to one column and the rail becomes a horizontal brand bar across
the top of the card (mark + wordmark on one row, micro-copy dropped), so the form keeps full width
on a phone. The card's `max-width` yields to the viewport with a `24px` gutter.

### 4.3 The three screens

| route | rail | content column |
|---|---|---|
| `/sign-in` | mark + wordmark + micro-copy | "Sign in" heading, tagline, then `<SignIn />` |
| `/` (signed out) | same | `landing.title` / `landing.tagline` / the Sign in button |
| `/no-access` | same | the existing `ShieldAlert` block and `SignOutButton`, unchanged in copy |

`/` when signed in as a non-agency user keeps its current no-access card; it moves into the shell's
content column and its copy does not change.

## 5. The mark

BIS has a real logo — a white triangle inside a black disc — and it exists in exactly one place: a
256×256 PNG frame inside `apps/web/public/favicon.ico`. **Nothing in the app has ever drawn it.**

`components/bis-mark.tsx` re-cuts it as two SVG shapes on a `0 0 48 48` viewBox — a disc and a
triangle — taking `currentColor` for the disc and the surrounding surface colour for the triangle,
so it inverts correctly per theme and per surface. No new asset, no image request.

Rejected: filling the disc with `--gradient-primary`. It looks good, but it would put a third
gradient on a screen that already has the primary button's, and rule 11 reserves gradient moments
deliberately. If it is ever wanted, it is a rule-11 amendment, not a component tweak.

The favicon itself is not touched.

## 6. Theme and mode

`<SignIn />` is restyled with class names that read tokens, so **light and dark follow the
existing `.dark` class with no Clerk theme swap, no second source of truth, and no flash.**

Mode resolution on these routes is **unchanged**: `resolveThemeMode(cookie, null)` — the user's own
cookie if they have ever chosen one, otherwise light.

**No theme toggle is added to any signed-out screen.** This is not an oversight. `theme-mode.ts`
records a shipped bug where a cookie written at `/sign-in` — a route with no tenant, therefore
resolving `light` — outranked every tenant's `brand_mode` permanently, so a company that chose a
dark default never saw one. Adding a toggle here re-opens exactly that path.

## 7. Restyling Clerk

Everything in this section is read off the installed `@clerk/react@6.12.8` type definitions
(`dist/types-BnGFcHu4.d.mts`), not recalled from documentation.

`<SignIn />` takes an `appearance` prop:

- **`layout: { logoPlacement: 'none' }`** — the mark lives in the rail, not in Clerk's card.
- **`elements`** — `UserDefinedStyle = string | CSSObject`, so each key accepts **our own class
  name**. Confirmed keys to target: `rootBox`, `cardBox`, `card`, `header`, `headerTitle`,
  `headerSubtitle`, `main`, `footer`, `socialButtonsBlockButton`, `dividerRow`, `dividerLine`,
  `dividerText`, `formFieldLabel`, `formFieldInput`, `formButtonPrimary`.
- **`cssLayerName`** — puts Clerk's own stylesheet in a named cascade layer so our classes win
  **without `!important`**. Any implementation that reaches for `!important` has skipped this.

The card, its border and its shadow come from the shell, so Clerk's `card`/`cardBox` are flattened
to transparent and unbordered rather than restyled — there must not be a card inside a card.
Clerk's `header` is hidden; our own heading sits above the form. **Hiding that header is also what
removes "Sign in to BIS Platform (dev)" from the card**, independently of §8.

**Deliberately not specified: `appearance.variables`.** `CssColor` is typed as bare `string`, so
`{ colorPrimary: 'var(--accent)' }` would typecheck — but `colorPrimary` is `CssColorOrScale` and
Clerk derives a whole shade scale from it at runtime, which needs a parseable colour. Class names
via `elements` keep us tokens-only and sidestep the question. If `variables` turns out to be
needed, it must be **proven with a computed-style probe before being relied on**, never assumed
from the fact that it compiles.

### 7.1 What Clerk contributes that no stylesheet reaches

Read off the live production instance on 2026-09-11:

| on the page | source | note |
|---|---|---|
| "Sign in to BIS Platform (dev)" | `displayConfig.applicationName` | removed here by hiding Clerk's header; the string itself is §8 |
| "Development mode" banner | `showDevModeWarning: true` | dev instance only; **§8**, not fixable in code |
| "Secured by Clerk" | `branded: true` | a paid-plan toggle; hiding it in CSS would breach their terms |
| Google button, divider, email, password | `oauth_google`, `email_code`, `password` | the inventory the layout must hold; all four are styled |

## 8. The Clerk instance (out of scope, tracked)

Production runs on a Clerk **development** instance:
`topical-redfish-40.clerk.accounts.dev`, `instanceEnvironmentType: "development"`.

Agreed split:

- **Now, by danlo, outside this PR:** rename the application in the Clerk dashboard from
  "BIS Platform (dev)". One minute, and it fixes the string everywhere Clerk prints it, including
  screens this spec does not restyle.
- **Later, its own item:** a production instance — new keys, a CNAME on `clerk.app.bis-rgv.com`,
  danlo's user and the Test Client One org recreated there, and the e2e suite left on the
  development instance (which is an improvement: it stops production and the test suite sharing one
  Clerk instance, the way they currently share one Supabase project). This is the only thing that
  removes the Development-mode banner.

This PR must not depend on either happening.

## 9. DESIGN.md rule 9

Current text:

> 9. Client-customer surfaces (booking page, forms, emails, login) always carry
>    the client's logo + brand color from the theming engine.

Replacement:

> 9. Client-customer surfaces (booking page, forms, emails) always carry the
>    client's logo + brand color from the theming engine. **Login is the one
>    exception and carries the platform's mark and accent instead** — nobody is
>    authenticated at `/sign-in`, so `getRequestTheme()` resolves "no tenant" and
>    there is no account whose brand could be read. Do not "fix" this by
>    branding sign-in per tenant without first solving how the tenant is
>    identified before authentication (2026-09-11).

The parenthetical reason is load-bearing: without it the rule reads as an omission somebody will
later close.

## 10. Copy

New strings in `lib/messages.ts`:

- `signIn.title` — "Sign in"
- `signIn.tagline` — "Calls, leads and bookings, all in one place."
- `signIn.railCopy` — "by Bespoke Intelligent Solutions"

The rail's line is the one that does real work: it tells a client whose software this is, which is
the question somebody who followed a bookmark once a week actually has. The tagline states what is
behind the door without selling — a client signing in has already bought.

**No footer line under the form.** Clerk already renders its own "Forgot password?" and reset flow;
a hand-written line beneath it would either duplicate that or contradict it, and there is no
self-serve support route to promise.

Existing `landing.*` and `clientAccess.*` strings are unchanged.

## 11. Tests

New `apps/web/e2e/sign-in.spec.ts`, unauthenticated:

- The rail's bounding box is **measured** non-zero in both themes. A presence query is not enough:
  the checklist meter shipped as a `0×0` inline element and passed every query-based check.
- The mark renders and its box is non-zero in both themes.
- `data-tenant-theme` is **absent** on `<body>` — the signed-out request must still resolve to
  "no tenant".
- A computed-style probe proves our classes actually beat Clerk's — reading the resolved
  **value** on a restyled element, not merely asserting the class is present. Pinning the class
  would pass even if Clerk's stylesheet won, which is the same failure mode as the
  `backdrop-filter` regression that shipped green.
- Clerk's `<SignIn />` still renders its email field and its Google button.

Extended coverage on the sibling routes: `/` and `/no-access` still render their existing copy
inside the new shell.

### 11.1 What must not break

- **`auth.setup.ts`.** It visits `/sign-in`, signs in by ticket, and then clicks a
  **"Choose an organization"** button at `/sign-in/tasks/choose-organization`. That task screen is a
  *different* Clerk component rendered through the same catch-all route, so the shell must not
  assume the sign-in card's height or contents, and the appearance prop must not hide anything that
  screen needs. If this breaks, every spec in the suite fails at setup.
- **`captchaWidgetType: "smart"`.** Clerk can inject a CAPTCHA challenge into the card mid-flow.
  The card must tolerate growing; nothing in the shell may fix its height.
- Existing `theme.spec.ts` / `tenant-theme.spec.ts` pins on the signed-out routes.

## 12. Risks

- **Clerk's `elements` keys are a public API but its internal DOM is not.** A future Clerk release
  can re-shape the card. The computed-style probe in §11 is what turns that from a silent visual
  regression into a red test.
- **`cssLayerName` is the whole basis for our classes winning.** If it is omitted or misnamed, the
  styling silently does nothing and the page looks approximately right in a screenshot while
  actually being Clerk's defaults over our shell.
- **Touching `/` and `/no-access` widens the diff into two pages nobody complained about.** Accepted
  deliberately: leaving them out would re-create the exact divergence this work exists to remove.

## 13. Done means

- `pnpm check` clean (typecheck, lint, db, web), `pnpm --filter web build` clean, full local e2e
  green, and CI `verify` + `e2e` both green on the PR's current head.
- All three signed-out screens photographed in **both themes on the built app**, not the styleguide,
  and the restyled Clerk elements probed for computed values.
- `DESIGN.md` rule 9 amended as in §9.
