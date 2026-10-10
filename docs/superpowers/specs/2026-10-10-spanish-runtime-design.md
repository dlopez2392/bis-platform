# Spanish runtime — design spec (Lane B, first-release item 1)

Status: DRAFT for owner review. No code in this lane has shipped; nothing here is applied.
Scope source: `docs/crm-features.md` §4.3 (first-release item 1, lines ~1246-1330) and §5.2
(lines ~1911-1939), the F-012/F-013/F-014 rows (~1924-1926), the "Spanish-ready components"
enabler row (~2821) and amendment 18 (~2865). Governed by `DESIGN.md`'s Definition of Done
bilingual item (added 2026-10) and its Voice rule ("plain language... never expose internal
milestone codes").

## Goal and non-goals

**Goal.** Give the signed-in dashboard an i18n runtime that can render any screen in English or
Spanish, prove it end-to-end on a small number of real screens, and put a build-time ratchet in
place so no new English-only user-facing string ships from today forward. This is F-013 part 1
(the runtime, formatters, the ratchet gate, AI output/alerts in the reader's language) plus F-014
(pseudo-locale, overflow check, accents-in-capitals, Label line-height).

**Non-goals (explicitly out of scope for this lane):**
- Translating every existing dashboard screen. That is F-013 part 2 / S-10, next horizon. This
  lane converts only enough surfaces to prove the runtime works (see "Screens converted").
- The sign-in page's language. Rule 9 keeps `/sign-in` platform-branded; it already follows the
  browser's language with its own EN|ES switch per §6.3's design notes, unrelated to this runtime.
- "Mis preferencias" UI (F-096, lane D later). No settings SCREEN for language ships here.
- A per-user language column. That arrives with S-01 ("staff and roles"). This spec designs the
  seam so a user-language override slots in later without touching the resolver's logic — it does
  not block on, or guess at, that lane's schema.
- Peso presentment, Mexican address formats, contact-level observed language (F-008/F-009/F-015 —
  items 2 and 5 on the first-release table, different lanes).
- Translating staff-authored free text or customer quotes. Per §5.2's design note and the
  Provenance pattern in `DESIGN.md`: what a customer wrote stays in their own language with its
  own `lang`; nothing in this lane machine-translates a transcript quote.

## Approach (options + recommendation)

Three candidates were weighed; two are compared in depth because the third fails the same axis
immediately.

**Ruled out quickly: react-intl / i18next.** Both are, like next-intl, React-rendering-first
libraries with their own provider/context model. Neither changes the core tension below, and
neither has the one advantage next-intl would bring (official Next.js App Router integration
docs), so there is no case for carrying a second contender through the full comparison.

### Option A — next-intl

next-intl is the closest thing to a default choice for a Next.js App Router project: per-locale
JSON message files, `useTranslations`/`getTranslations` for client/server components,
`next-intl/middleware` for locale routing, and ICU `MessageFormat` (plurals, `select`) built on
`intl-messageformat`. *(These are my recollection of next-intl's documented shape, not verified
against its current docs in this session — flagged per the brief's instruction; anyone implementing
this should re-check the installed version's docs before committing to the exact API calls below.)*

Weighed against the brief's axes:
- **Server components + server actions + emails, one catalogue.** next-intl's `getTranslations()`
  is designed for the request lifecycle (RSC render, middleware-resolved locale). This repo's
  emails are plain TypeScript builders with no React tree and no request context
  (`lib/email/templates/weekly-report.ts`, `lib/automations/*-copy.ts`) — they run from cron-style
  passes (`lib/automations/passes/*.ts`), not from an HTTP request. *Assumption:* next-intl's
  server APIs are documented as request/RSC-oriented; I did not verify whether `getTranslations`
  works cleanly called from a bare Node pass outside Next's request lifecycle. Either it does not
  (so emails need a second, parallel catalogue anyway — defeating "one catalogue"), or it does via
  an undocumented low-level entry point, which is a worse foundation than a function with no
  such ambiguity.
- **Type safety.** Needs its own TypeScript augmentation (a generated `IntlMessages` type from the
  JSON namespace shape) — a different mechanism from this repo's existing `keyof typeof m`.
- **Bundle cost.** A real runtime dependency (message loading, ICU formatting, middleware) versus
  this repo's current zero-dependency flat object. *Assumption:* I have not measured next-intl's
  actual shipped KB; flagging rather than asserting a number.
- **ICU plurals.** Native and well-tested — this is next-intl's real strength. *Assumption: as
  documented*; not independently verified here.
- **Ratchet-gate detection.** next-intl's ESLint plugin reportedly flags literal JSX text.
  *Assumption, unverified.* Even if true, this repo's `eslint.config.mjs` is the vanilla
  `eslint-config-next` config with zero custom rules today — adding either an ESLint rule or a
  vitest source-scan is equally greenfield work regardless of which catalogue technology is chosen,
  so this is not a deciding advantage.
- **Migration cost.** This is the expensive one. `messages.ts` (2,900+ lines) already encodes
  Spanish as flat `"key.es"` siblings in the SAME object as `"key"` (precedent at
  `apps/web/src/lib/messages.ts:682-696`, the `todo.consent.*` pair the brief points at). The three
  per-feature files (`booking/public-strings.ts`, `concierge/strings.ts`,
  `forms/public-strings.ts`) use a sibling shape: `STRINGS.en` / `STRINGS.es`, same keys, picked by
  a `publicStrings(locale)`/`conciergeStrings(locale)` function. Moving any of this into next-intl's
  per-locale-JSON-file shape is a real rewrite of working, tested, reviewed copy — not a wrapper.

### Option B — an in-house typed catalogue, generalising `messages.ts`

Keep every existing catalogue file in its CURRENT shape (no rewrite) and add one small shared
primitive both shapes can call through:

```ts
// lib/i18n/t.ts (new, ~60-80 lines)
export type Locale = "en" | "es";

// For messages.ts's flat "key" / "key.es" shape.
export function t(
  catalogue: Record<string, string>,
  key: string,
  locale: Locale,
  params?: Record<string, string | number>,
): string { /* looks up `${key}.es` when locale==="es", falls back to `key`,
               then does the existing {placeholder} substitution every call
               site today does by hand with .replace() */ }

// For the STRINGS.en/STRINGS.es shape (booking/concierge/forms) — these
// already have their own `xStrings(locale)` accessor; this lane just retypes
// their `locale: string | undefined` params as `Locale` so one type is
// shared, no behavior change.

// ICU-lite plural helper, generalising the existing idleShort/idleShortOne
// two-key convention (messages.ts:81-88) instead of replacing it:
export function plural(
  catalogue: Record<string, string>,
  baseKey: string,
  count: number,
  locale: Locale,
  params?: Record<string, string | number>,
): string { /* Intl.PluralRules(locale).select(count) picks "one" | "other"
               and reads `${baseKey}One` / baseKey (en) or their .es twins */ }
```

Weighed against the same axes:
- **Server components + server actions + emails, one catalogue.** `t()` and `plural()` are plain
  functions with no React dependency and no request context — `locale` is an explicit argument
  everywhere. The SAME function is callable from an RSC, a `"use server"` action, a cron pass
  building a plain-text email, or a vitest test. This is the one axis where option B is not just
  cheaper but structurally better suited to this repo's actual surfaces, because two of the three
  surfaces the brief names (server actions, emails) are not React trees today.
- **Type safety.** Extends `keyof typeof m` as-is; no new generated-types step.
- **Bundle cost.** Near zero — `t`/`plural` are a few dozen lines; the string data is already
  shipped (several client components already import `m`).
- **ICU plurals.** Not full ICU `select`/`selectordinal` — just plural selection via the platform's
  own `Intl.PluralRules`, generalising a pattern this codebase already hand-rolls
  (`shell.presence.idleShort` / `idleShortOne`, `messages.ts:81-88`). Good enough for the plural
  needs actually present in this catalogue (counts of calls, days, etc.); if a screen ever needs
  `select` (gendered forms, not plurals), that is a real gap — noted as an open question below, not
  swept under the rug.
- **Ratchet-gate detection.** Independent of this choice either way (see F-012 section).
- **Migration cost.** None of the four existing string files move. `messages.ts` keeps exactly its
  current flat-key-with-`.es`-twin convention. The three per-feature files keep their
  `STRINGS.en`/`STRINGS.es` convention. This lane adds the shared helper and starts USING it on the
  two screens converted (see below) plus the staff-alert/call-summary wiring; it does not touch a
  single line of copy that already shipped.

### Recommendation

**Option B — the in-house typed catalogue, generalising `messages.ts`.** The deciding factor is
the brief's own stated requirement that "server components + server actions + emails (non-React)
all reading one catalogue" — today's emails and automation passes are plain TypeScript, not React,
and next-intl's documented strength (RSC/middleware integration) does not reach them without a
second, parallel mechanism, which would mean the dashboard and the emails are STILL on two
catalogues, just with extra machinery for one of them. Option B's `t()`/`plural()` reach every
surface identically because neither depends on a request or a render tree. Secondary factors all
point the same way: zero new dependency, zero migration of ~3,000 existing lines of reviewed copy,
and a plural mechanism that is a small, proven-shape addition rather than a new paradigm. The one
real gap (no ICU `select` for anything beyond plural count) is accepted and named, not hidden.

## Architecture

### Catalogue shape

No new file format. `messages.ts` keeps `"key"` / `"key.es"` pairs in one object; the three
per-feature files keep `STRINGS.en` / `STRINGS.es`. New shared pieces:

- `lib/i18n/locale.ts` — `export type Locale = "en" | "es";` (single source; the three
  per-feature files' own ad-hoc `PublicLocale` / inline `"es"` checks get retyped to import this,
  additively — their existing exports stay for callers that already import `PublicLocale` by name).
- `lib/i18n/t.ts` — `t()` and `plural()` as sketched above, plus the interpolation step every call
  site today repeats by hand with `.replace("{x}", …)`.
- `lib/i18n/resolve-locale.ts` — the resolver (next section), pure, same testing posture as
  `theme-mode.ts`'s `resolveThemeMode`.

### Locale resolution order: user → account → default

Mirrors `theme-mode.ts`'s `resolveThemeMode` shape deliberately (same file this repo already
trusts for a mode-resolution seam with a not-yet-existing input):

```ts
export function resolveLocale(
  userLanguage: Locale | null | undefined,   // S-01's future column; always
                                              // undefined until that lane ships —
                                              // no caller here has it to pass
  accountLanguage: Locale | null | undefined, // this lane's new accounts.language
): Locale {
  if (userLanguage === "en" || userLanguage === "es") return userLanguage;
  if (accountLanguage === "en" || accountLanguage === "es") return accountLanguage;
  return "en"; // status quo default — the dashboard is English-only today
               // (lib/booking/public-strings.ts:8's own words), so a null
               // account.language on every existing account changes nothing
}
```

The seam the brief asks for: `userLanguage` is a parameter, not a lookup this function performs.
Every call site in THIS lane passes `undefined` for it (there is nowhere to read it from yet).
When S-01 lands a user-level language — whether as `users.language` or the roadmap's "one
per-person preferences store" (§6.4 enabler row, "created with staff and roles (S-01) · now") —
its caller starts passing the real value, and `resolveLocale` does not change. This is the same
shape `theme-mode.ts` already uses for its own `isOperator` parameter, so it is a repeated pattern
in this codebase, not a new idiom.

### Where locale is read

- **Server components / server actions (account-scoped screens).** Every account-scoped screen
  already loads the account row (branding, timezone — see `lib/zone.ts`'s own account-row
  argument). `accountLanguage` is one more field off that SAME row; no extra query, mirroring the
  exact concern `zone.ts`'s doc comment raises about `readAgencyZone()` being evaluated eagerly. A
  small `lib/i18n/request-locale.ts` wraps `resolveLocale(undefined, account.language)` today
  (comment noting the `undefined` is the S-01 seam, not a bug) and becomes the one call site that
  changes when a user-language source exists.
- **Client components.** No client-side toggle ships in this lane (Mis preferencias is out of
  scope), so there is no `next-themes`-style persisted client state to design yet. A thin
  `LocaleProvider` (React context, no localStorage, no cookie) is seeded once from the server's
  resolved value and handed down, purely to avoid every client component re-deriving it — this
  avoids a hydration mismatch because the server and client always agree (there is no client-only
  signal yet to disagree about, unlike theme's OS-preference case).
- **QA-only override, not a user-facing switcher.** Because there is no real toggle yet but the
  DoD requires proving both languages render, add a dev/preview-only `?locale=es` query param
  honored ONLY under `NODE_ENV !== "production"` (or a preview-only env flag, to be confirmed with
  whoever owns the environment guards described in CLAUDE.md) — this is scaffolding for this lane
  and lane F-014's overflow check, not a feature; it must not survive as an unguarded production
  override, and a test should assert that.
- **Email / staff alerts (non-React).** The builder function takes an explicit `language: Locale`
  parameter, resolved by the caller (the pass/cron job) from `account.language` via
  `resolveLocale`, the same function server components use. No provider, no context — matches the
  shape `automations/*-copy.ts` already use for parameters today.

## Formatters

Generalise `lib/format.ts` (currently `en-US`-hardcoded throughout, confirmed by reading the file —
every `Intl.NumberFormat`/`Intl.DateTimeFormat`/`toLocaleDateString` call passes the literal string
`"en-US"`) rather than replace it:

- `formatCurrency(n, locale: Locale = "en")` — swaps the Intl locale tag between `"en-US"` and
  `"es-US"`; **currency stays USD** in both (crm-features §5.2's "What we reject here": peso
  presentment is explicitly rejected for this lane; only "USD"/"MXN" LABELS survive, and only in
  F-055, a different lane). `es-US` is the deliberate choice over `es-MX`/`es-ES` for exactly this
  reason — it keeps US grouping/decimal conventions (comma thousands, period decimal) while
  rendering Spanish month/weekday names elsewhere, which is the same reasoning `DESIGN.md` and
  §5.2 both state ("one `es-US` formatting layer").
- `formatDate` / `formatDateTime` / `formatDateInZone` / `formatDateTimeInZone` / `formatDateUTC` —
  each gains a `locale: Locale = "en"` parameter (defaulted so every existing call site keeps
  compiling unchanged — consistent with the non-goal of not retranslating shipped screens) that
  swaps the literal locale tag. *Assumption to verify with a real `Intl.DateTimeFormat("es-US",
  {month:"short"})` call during implementation, pinned in a test rather than trusted from memory:*
  I expect Spanish short month tokens to render with a trailing period (e.g. "oct.") under ICU's
  `es` data; this must be confirmed against the actual Node ICU build this repo runs on, not
  assumed, because a few Label-role surfaces are tight on width (see F-014 below).
- **New:** `formatRelativeTime(iso, locale: Locale = "en")` using `Intl.RelativeTimeFormat` — no
  such formatter exists in `format.ts` today (confirmed by grep; the brief lists "relative times"
  as in-scope and this repo has none yet).
- **New:** the `plural()` helper in `lib/i18n/t.ts` (above), backed by `Intl.PluralRules(locale)`.

## The ratchet gate (F-012)

**What it detects.** Two different things, both needed, neither substituting for the other:
1. **Catalogue parity.** Every `"key"` added to `messages.ts` (or `STRINGS.en`) must have a
   `"key.es"` (or `STRINGS.es`) sibling. This is nearly free: `messages.test.ts` already spot-checks
   individual keys this way by hand (e.g. `forms.kind.core.referral_source.es`,
   `actions.test.ts:300-302`'s generic `${stem}.es` check) — this lane generalises that ONE existing
   assertion shape into a loop over every key instead of a hand-picked few, which is the test
   that can actually fail on a real regression (a key added without its twin).
2. **Raw-literal detection.** A NEW hard-coded English string typed directly into JSX (not routed
   through the catalogue at all) is a different failure mode catalogue-parity cannot see. This
   needs a source scan: walk `.tsx` files under `apps/web/src/app` and `apps/web/src/components`,
   parse with the TypeScript compiler API (already a project dependency via `tsc`) rather than
   regex — a regex pass over JSX text nodes is exactly the kind of check that produces false
   positives on things like `className` strings or numeric literals, and false positives are how a
   ratchet gate gets disabled in frustration instead of fixed.

**Baseline file.** A generated, git-committed JSON (`apps/web/src/lib/i18n/ratchet-baseline.json`)
mapping `relative/file/path.tsx` → the count of un-catalogued string literals found in it TODAY.
The baseline is generated once by a script, never hand-edited to add an entry, and the test fails
if ANY file's live count exceeds its baseline entry, or if a file with no baseline entry has a
nonzero count (a genuinely new file cannot start smuggling strings in just because it is absent
from the list). A file's count may only go DOWN — regenerating the baseline after a real
translation pass is an explicit, reviewable commit, never a side effect of a normal change.

**Allowlist.** Two kinds, both named explicitly (not inferred):
- **Route-scope allowlist** — agency-only top-level routes (Companies, Blueprints, the agency work
  queue, agency Billing) are internal tooling, not a "landscaper at 7 AM" surface; DESIGN.md's own
  bilingual DoD line is qualified ("once a surface carries bilingual copy AT ALL"). This mirrors
  `messages.test.ts`'s existing `AGENCY_ONLY` set precedent (currently empty, by design, per that
  file's own comment) — same idea, applied to routes instead of catalogue keys. This needs an
  **owner decision** (open question 6 below); until then the scanner still runs everywhere and the
  baseline simply absorbs today's agency-only English as a (large) starting count.
- **String-shape allowlist** — test fixtures, `aria-label`s that are internal test hooks, decorative
  punctuation, and the test-marker attributes the orchestrator's own workflow relies on (`data-slot`
  etc., per CLAUDE.md's measurement discipline) are not user-facing copy and are excluded by file
  pattern (`*.test.tsx`) and a short, named list of attribute names, not by a blanket "looks like
  code" heuristic.

**Where it runs.** A vitest test (`apps/web/src/lib/i18n/ratchet.test.ts`), picked up automatically
by `include: ["src/**/*.test.ts", …]` in `apps/web/vitest.config.ts` — so it runs under
`pnpm --filter web test`, which `pnpm check` already invokes (per CLAUDE.md: "Gates before any
merge: `pnpm check` (typecheck + lint + db + web tests)"). No new CI job, no ESLint plugin, no
change to `eslint.config.mjs` (confirmed today to be the unmodified `eslint-config-next` base with
no custom rules) — it rides the gate that already runs in CI's `verify` job.

**How it fails.** `expect(liveCount, file).toBeLessThanOrEqual(baseline[file] ?? 0)` per file, with
the failing file path and both counts in the assertion message — not one aggregate number, so a
red run names the file to fix, the same way `messages.test.ts`'s own per-key assertions do today.

## Pseudo-locale and overflow check (F-014)

- **Pseudo-locale.** A build/test-time transform (`lib/i18n/pseudo-locale.ts`) that takes any
  English string and pads it toward +35% length using bracket-wrapped filler
  (`"Dashboard"` → `"[Đâšĥбõâŕð Ẋẋẋ]"`-style accented/padded rendering is the common pseudo-locale
  technique — accented Latin characters stress font coverage, brackets make truncation visible).
  This is NOT the Spanish catalogue; it is a synthetic third "locale" used only in a visual
  regression pass, so it never needs a human translator and never drifts from real Spanish copy.
- **Overflow check.** Render the two converted screens (below) under the pseudo-locale and assert,
  per DESIGN.md's `--radius-ctl`/Label-role constraints, that no Label-role text (10px, uppercase,
  `+0.14em` tracking — the sidebar group headers, chart captions) clips its line box, and that no
  button/stat-tile text overflows its container. Mechanically: a Playwright/vitest-DOM check
  comparing `scrollWidth`/`scrollHeight` against `clientWidth`/`clientHeight` on the relevant nodes
  — NOT an eye-check, consistent with CLAUDE.md's "verify by computed value" rule. This is a
  measurement run (ask bis-e2e-qa or bis-design-reviewer per the agent's own operating rule), not
  something this spec's author runs.
- **Accents kept in capitals.** `text-transform: uppercase` (the Label role's existing mechanism,
  `DESIGN.md`'s Label spec) does not strip Spanish diacritics in any current browser — the actual
  risk is a DIFFERENT, ALREADY-PRESENT pattern in this codebase being reached for by habit:
  `lib/consent/keywords.ts:41` and `lib/consent/phrases.ts:172` both do
  `text.normalize("NFD").replace(/\p{M}/gu, "").toUpperCase()` — a deliberate diacritic-STRIPPING
  normalizer, but it exists ONLY for fuzzy keyword/phrase MATCHING (so "PARAR" matches "PÁRAR"
  regardless of accent), never for display. A test should assert that no Label-role rendering path
  imports either of those two modules, specifically because they are the one place in the repo that
  already strips exactly the characters F-014 requires kept. The font coverage question itself
  (does Geist Mono's uppercase glyph set include Á/É/Í/Ó/Ú/Ñ at 10px without clipping) is an
  **assumption I have not verified against the actual font files** and should be a visual check
  item in the overflow pass, not asserted from memory.
- **Label line-height.** DESIGN.md fixes the Label role's size (10px) but accented capitals
  (Á, É, with diacritics sitting above the cap-height) need enough line-height headroom not to
  clip at the top. This is a CSS value to set and screenshot-verify, not something this spec can
  settle by description alone — flagged for the implementer with the same "verify by computed
  value" discipline (a computed `line-height` check against the diacritic's rendered bounding box,
  or at minimum a screenshot diff on `/styleguide`'s Label example under both locales).

## AI output and alerts in the reader's language

**What exists today (confirmed by grep, not assumed).** Staff-facing surfaces are hardcoded
English on purpose, each with a comment saying so:
- `lib/voice/summary-service.ts:55` — the AI prompt instruction: *"Always write the summary in
  English (it is staff-facing), regardless of the language spoken on the call."*
- `lib/sms/alerts.ts:13` — *"thread stay English regardless of the customer's own language."*
- `lib/voice/call-card.ts:118` — *"the `.es` twin waits for an operator locale"* — i.e. the call
  card's Spanish strings are ALREADY WRITTEN (the `.es` catalogue twins exist) but unreachable
  because nothing resolves a reader's language yet. This is the exact seam this lane closes.

**This lane's change.** Thread `language: Locale` (resolved via `resolveLocale` from
`account.language`, same as the dashboard itself) through `summary-service.ts`'s prompt-building
and `alerts.ts`'s message assembly, so the AI's summary PROSE and the alert's surrounding words
render in the reader's resolved language. **Two things stay fixed regardless of this change,
because changing them would violate the Provenance pattern already in DESIGN.md:**
1. The customer's own verbatim quote (`voice/tools/registry.ts`'s *"quote stays in the language
   the caller spoke"*) is never machine-translated — it keeps its own `lang` attribute, a
   translation (if any, later lane) sits BESIDE it, never replacing it.
2. This is staff/operator-facing AI output, a DIFFERENT axis from the customer-facing bilingual
   messaging S-09/F-008 already own (item 5 on the first-release table, a separate lane): a
   customer's booking confirmation or reminder is already resolved from the CONTACT's own observed
   language, not from the account's UI language, and this lane does not touch that path.

**Risk to flag, not solve here.** Resolving `account.language` for an AGENCY OPERATOR (who may work
many accounts, not all in the same language) versus a CLIENT-role login (whose own dashboard this
genuinely is) are different questions — see open question 1.

## Data

**New column, described, not applied.** `accounts.language`, nullable `text`, default `NULL`,
`check (language is null or language in ('en','es'))` — same check-constraint style
`public.accounts.status` already uses in `packages/db/supabase/migrations/0001_tenancy.sql`
(`status text not null default 'active' check (status in ('active','paused','archived'))`), except
nullable rather than defaulted, because `NULL` is a real, meaningful third state here ("no
preference recorded yet" → `resolveLocale` falls through to `"en"`), not an omission to patch over.
Migration file: the next free number after the current latest
(`packages/db/supabase/migrations/0064_call_card.sql` as of this writing — **confirm the actual
highest number at implementation time**, since other lanes land migrations concurrently). Per
CLAUDE.md's own migration discipline, this goes to the CI project first, then production, then a
parity check (`docs/runbooks/ci-supabase-project.md`) — none of that happens in this spec.

**The future seam, named so it is not re-litigated.** S-01 ("staff and roles") is expected to add
either a `users.language` column or route language through the roadmap's "one per-person
preferences store" (§6.4 enabler row). This spec does not pick between those two for S-01 — that
is that lane's call — because `resolveLocale`'s first parameter only cares about getting a
`Locale | null | undefined` from SOMEWHERE; it is indifferent to which table that value comes from.

## Screens converted in this lane

Two surfaces, chosen for being small, shared, and already partly started:

1. **Sidebar nav labels + topbar presence indicator.** Every account-scoped screen renders these,
   so converting them exercises the resolver and the provider on every route at once with minimal
   new copy (the nav's dozen-odd one- and two-word labels). `shell.presence.*` ALREADY has `.es`
   twins (`messages.ts:81-88`) sitting unused — the smallest possible proof that the runtime, not
   the copy, was the missing piece. `nav.*` does not yet have `.es` twins (confirmed by reading
   `messages.ts:1-50`) and gets them here.
2. **The account dashboard's KPI/stat-tile row (the hero + its deltas).** This is the
   highest-traffic screen per account and the one DESIGN.md rule 1 already requires a delta in
   WORDS for ("3 more than the week before") — converting it exercises `formatCurrency`,
   `formatRelativeTime`/date formatting, AND the plural helper (call counts) together, which the
   sidebar alone would not. It sits inside this agent's own ownership (`dashboard/**`,
   `stat-tile.tsx`), so no cross-agent handoff is needed to implement it.

Both get a `/styleguide` entry showing the EN and ES render side by side (DoD: "`/styleguide` page
updated if a new component/variant was added" — a locale IS a variant here, same as dark/light).

## Testing (and how each test could fail)

Every test below names the mutation that would turn it red, per this codebase's own documented
history of tests that cannot fail.

- **`resolve-locale.test.ts`.** `resolveLocale("es", "en")` → `"es"` (user wins); `resolveLocale(
  undefined, "es")` → `"es"` (account wins when user is absent); `resolveLocale(undefined,
  undefined)` → `"en"` (default). **Fails if** the precedence is swapped (account checked before
  user) — a real defect once a user-language column exists, catchable NOW because the test already
  pins the order with user present AND absent.
- **Catalogue-parity ratchet test.** Add a new key to `messages.ts` with no `.es` twin → the test
  must go red naming that exact key. **Fails to be real** if the test only re-checks keys that
  ALREADY had both forms (vacuous — cannot catch tomorrow's omission); the test must iterate
  `Object.keys(m)` fresh each run, not a hand-picked list, which is the precedent
  `messages.test.ts`'s own `INTERNAL_MILESTONE` sweep already uses correctly (loops every key, not
  a sample).
- **Raw-literal ratchet test.** Add `<p>Loading your calls</p>` (a literal, no catalogue key) to a
  non-allowlisted file → the file's live count exceeds its baseline entry, test goes red naming the
  file. **Mutation that must NOT pass:** reverting a real translated string back to English should
  make the test fail by name — if deleting a `.es` twin and hard-coding the English string back in
  does not fail this test, the scanner is not actually parsing that file's AST (a common vacuous
  shape: a regex that only matches a narrow quoting style).
- **Formatter tests.** `formatCurrency(1234, "es")` pinned to its ACTUAL `Intl.NumberFormat(
  "es-US",…)` output (not assumed — run it once, paste the real string into the test, per this
  agent's own verification discipline). **Fails if** the locale tag is swapped for `es-MX`/`es-ES`
  by accident later (those use different grouping), catching exactly the §5.2 "es-US, not es-MX"
  decision silently drifting.
- **Pseudo-locale overflow test.** Render the stat-tile row under the pseudo-locale, assert
  `scrollWidth <= clientWidth` on every Label-role node. **Fails if** someone widens the container
  instead of fixing the text truncation strategy — the test should assert against the DESIGN.md-
  fixed container width (a card inside the existing grid), not a width the test itself can inflate,
  or the test becomes unable to fail by construction.
- **Accents-in-capitals test.** Assert a Label-role component rendering `"Qué pasó"` uppercased
  via CSS still contains `"QUÉ"` (with the accent) in its text content / computed content, and that
  the Label-role module does NOT import `consent/keywords.ts` or `consent/phrases.ts`.
  **Fails if** a future refactor "helpfully" reuses the keyword-matching normalizer for display —
  exactly the defect this test exists to catch, named explicitly rather than inferred.
- **AI-output-language test.** Call `buildSummaryPrompt(…, "es")` and assert the instruction text
  sent to the model asks for Spanish, while a fixture transcript's verbatim quote field is
  untouched and still carries `lang="es"` (or whatever it was). **Fails if** a later change
  machine-translates the quote itself — catches a Provenance-pattern regression, not just a prompt
  wording regression.
- **Migration test (packages/db).** The new column exists, accepts `'en'`/`'es'`/`NULL`, rejects
  `'fr'` via the check constraint. **Fails if** the constraint is accidentally written as
  `not null default 'en'` instead (a real difference: that would silently convert "unset" into "en"
  at the DB layer, bypassing `resolveLocale`'s own default and making a later default-change a
  migration instead of a code change).

## Open questions for the owner

Each is a genuine product call this spec cannot make unilaterally, with a recommendation attached
per this repo's own working style (one recommendation, not a survey).

1. **Does `account.language` mean the ACCOUNT's administrative language, or only the default for
   its CLIENT-role logins?** An agency operator working a Spanish-language client account is
   probably still an English-primary staff member. **Recommendation:** `account.language` is
   authoritative only for CLIENT-role sessions (mirrors `theme-mode.ts`'s existing
   operator/client-role split for dark/light); an agency operator's OWN session stays English
   until S-01's user-level language exists, at which point `resolveLocale`'s `userLanguage`
   parameter — already designed for this — takes over for operators specifically.
2. **Does this lane touch the agency's own top-level chrome (Companies, Blueprints, agency work
   queue) at all?** **Recommendation:** no — those are agency-internal tooling, English-only for
   now, consistent with `messages.test.ts`'s existing (currently empty but present) `AGENCY_ONLY`
   carve-out concept and with this spec's ratchet-gate route-scope allowlist.
3. **What should `resolveLocale` default to when `account.language` is `NULL` (every account that
   exists today)?** **Recommendation:** `"en"` — zero behavior change for every existing account,
   explicitly NOT inferred from a contact's observed language (F-008's signal), which answers a
   different question (what language to write THIS customer in, not what language the OWNER's own
   dashboard renders in).
4. **Should there be ANY real way to set `account.language` before Mis preferencias (F-096) ships,
   so this lane can be proven on a live, toggleable account rather than only a seeded DB value?**
   **Recommendation:** yes — one `inline-field` (the existing primitive) added to the account's
   existing settings surface, scoped as a minimal addition to THIS lane, not a new screen and not
   the Mis preferencias UI itself. Flagging because the brief's non-goals list Mis preferencias UI
   but does not explicitly rule this narrower addition in or out.
5. **Should the ratchet-gate baseline be count-based (per file, as designed above) or
   hash-based (per exact string)?** **Recommendation:** count-based — simpler, and this repo's
   habit of moving strings between files during refactors would make a hash-based baseline noisy
   (every refactor "removes" and "adds" hashes) without actually catching more real regressions.
6. **Should the ratchet gate scan agency-only routes at all, even just to freeze their current
   count, or exclude them entirely from day one?** **Recommendation:** exclude them entirely by
   route-scope allowlist (ties to open question 2) — scanning-but-freezing a surface this spec
   recommends staying English-only forever just adds baseline-file churn with no safety benefit.

## Effort estimate vs. the plan's 3.5–5.5 ew

The plan (`docs/crm-features.md` §4.3) prices F-013 part 1 at +2.5–3.5 ew and F-014 at +1–2 ew,
total **3.5–5.5 ew**. This spec's own breakdown of the scope above:

| Piece | ew |
|---|---|
| `accounts.language` migration + db test | 0.25 |
| Shared `lib/i18n/t.ts`, `Locale` type, `plural()`, `resolveLocale` + tests | 0.5 |
| Formatters generalized (`format.ts` + new `formatRelativeTime`) + tests | 0.5 |
| Pseudo-locale generator + overflow check + accents/line-height pass | 0.75–1 |
| Ratchet gate (AST scanner, baseline file, allowlist wiring into `pnpm check`) | 1–1.5 |
| Staff alert / call-summary language wiring (`alerts.ts`, `summary-service.ts`) | 0.5 |
| Two proof screens converted + `/styleguide` entries | 0.5–0.75 |
| **Total** | **4–5** |

This sits inside the plan's 3.5–5.5 ew band, toward the upper end. The single biggest risk to the
estimate is the ratchet gate's raw-literal scanner: telling real user-facing JSX text apart from
`className` strings, test fixtures, `aria-label` hooks, and internal log strings is inherently
fuzzy, has no existing precedent in this repo (no custom ESLint rule exists today; confirmed by
reading `eslint.config.mjs`), and is the one piece of this lane most likely to run past its 1–1.5
ew budget in practice. Everything else reuses an existing, proven shape (`theme-mode.ts`'s
resolver pattern, `messages.ts`'s `.es`-twin convention, the per-feature `STRINGS.en/es` pattern)
and should land inside its estimate.
