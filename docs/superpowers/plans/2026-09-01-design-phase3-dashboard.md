# Design Phase 3 — Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Checkbox steps.

**Goal:** the dashboard matches the roadmap's "The dashboard, in both
directions" mockup — KPI tiles with evidence (display face, tabular digits,
delta + sparkline), a 14-day calls chart per DESIGN.md's chart section, a
recent-calls mini table, and a real-data activity feed — for both audiences,
both themes.

**Architecture:** all data stays server-derived. Page-level reads go through
`dbForRequest()` (RLS — grants proven by client-session e2e, never unit
fixtures). New per-account aggregate helpers land in `packages/db`; all
day-bucketing/delta/sparkline math is pure functions in
`apps/web/src/lib/dashboard/` (TDD). Charts are hand-rolled markup — NO new
dependencies. NO migrations this phase (if a task appears to need one, BLOCK
and report). The phase ENTRY task coalesces the three per-navigation shell
action POSTs into one `getShellSnapshot` (final-review Important from P2 —
Next serializes same-client server actions; user mutations queue behind
background reads).

**Tech Stack:** Next.js App Router server components + guarded `"use server"`
actions, Tailwind v4 tokens, hand-rolled SVG/CSS marks, vitest, Playwright.

## Global Constraints (every task)

- Tokens only — no hard-coded colors/radii/shadows. Chart marks follow
  DESIGN.md's own chart section: single-hue accent for single-series, 4px
  rounded TOPS on bars (`rounded-t-[4px]` — the chart section's explicit
  exception to the 8/11/999 radii rule), weekend bars muted via the
  `--surface-3`-mapped utility, mono axis labels, text on charts uses text
  tokens never the series color, never a dual-axis chart.
- Rule 1: EVERY metric ships with context — delta, sparkline, or period
  label. Rule 3: status never color alone (dot + word). Rule 5: designed
  loaded/empty/error states — empty states sell the feature (one sentence
  of what appears here + the action that causes it). Rule 7: skeletons
  shaped like content, no spinners (server components render complete —
  skeletons only where a client boundary actually loads).
- NOTHING animates on scroll; `prefers-reduced-motion` already has a global
  `animation: none !important` kill — do not add scroll/entrance animation.
- All aligned digits get `font-variant-numeric: tabular-nums`
  (`tabular-nums` utility). KPI values use the display face:
  `font-display font-[650]`.
- Copy through `m[...]` (`apps/web/src/lib/messages.ts`); voice = "a
  business owner reads at 7 AM"; never expose internal event-type strings
  or milestone codes.
- DATA HONESTY: no fabricated metrics or feed items. A tile that cannot be
  computed honestly is HIDDEN, not zeroed (e.g. after-hours without
  configured hours). Feed renders only event types that exist in the
  `events` table today.
- Timezone math: only via the booking primitives (`dayKeyInZone`,
  `zonedTimeToUtc` in `apps/web/src/lib/booking/`) or `Date.UTC` +
  `getUTC*` reads. NEVER an un-pinned `Intl` formatter (formats in the
  SYSTEM zone — recorded hard lesson). Tests construct explicit UTC
  instants and pin the account-zone behavior with a fixture zone that
  DIFFERS from the dev machine's (America/Chicago) — use e.g.
  `Pacific/Auckland` or `America/New_York` so the test can discriminate.
- Every new query is `.eq("account_id", accountId)`-scoped (or mirrors the
  existing account-scoped helper for tables that join, e.g. bookings).
- No assertion deleted except assertions about outputs a task removes,
  replaced by assertions of the new contract. e2e `waitForResponse`
  predicates must match the mutation BODY, never method+URL alone
  (recorded P2 lesson).
- Gates: unit + lint + tsc per task (`pnpm --filter web test`,
  `pnpm --filter web lint`, `pnpm --filter web exec tsc --noEmit`, plus
  `pnpm --filter db test` and its tsc when packages/db is touched); full
  check/build/e2e at the final task. Implementers NEVER run the e2e suite
  (shared Supabase project) — the controller runs it at the gate; e2e spec
  EDITS are allowed where a task names them.

### Task 1: getShellSnapshot — coalesce the three per-navigation POSTs (P3 ENTRY, non-negotiable)

**Files:** Create
`apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/shell-actions.ts`;
Create `apps/web/src/components/shell-data.tsx`; Create
`apps/web/src/lib/setup/setup-inputs.ts`; Modify `app-sidebar.tsx`,
`topbar-presence.tsx`, `topbar.tsx` (only if its props change),
`(dashboard)/dashboard/layout.tsx`; Delete `unread-actions.ts`,
`setup-actions.ts`, `presence-actions.ts` (their doc-comment rationale moves
to shell-actions.ts — the ancestor-params explanation must survive); Modify
`setup/page.tsx` + the go-live action in `setup/actions.ts` to consume
`gatherSetupInputs` (values unchanged, lockstep only).

**Interfaces — Produces:**
- `getShellSnapshot(accountId: string): Promise<ShellSnapshot>` where
  `ShellSnapshot = { unreadTotal: number; setup: { done: number; total: number } | null; presence: { onCall: boolean; weekCount: number } | null }`
- `gatherSetupInputs(db, accountId): Promise<SetupInputs>` in
  `apps/web/src/lib/setup/setup-inputs.ts` — the ONE copy of the six-source
  read set (accounts brand_name/from_email, getCalendarForAccount,
  getVoiceProfile, listPhoneNumbersForAccount, countCallsSince from epoch,
  listChecklistState), db client passed in (setup page keeps
  `dbForRequest()`, the action passes `serviceDb()`).
- `ShellDataProvider` + `useShellData(): ShellSnapshot | null` in
  `shell-data.tsx` (`"use client"`, React context).

**Action semantics:** `requireAccountAccess(accountId)` OUTSIDE the try
(both audiences). Derive the audience the same way
`requireAgencyOnlyAccountAccess` does in `apps/web/src/lib/auth.ts` WITHOUT
redirecting a client — a client gets `setup: null` (setup is agency-only
data; the server decides, never the client). Inside the try, `Promise.all`:
`sumUnreadCount`; agency-only `gatherSetupInputs` → `deriveSetupStatus` →
`reduceSetupProgress`; `getVoiceProfile` → `null` if `!profile?.enabled`
else `getVoicePresence(db, accountId, new Date())` (presence for BOTH
audiences, exactly as today). Failure folds per section: a throwing leg
degrades ITS section to the hidden value (`0` / `null` / `null`) with
`console.error` — one leg's failure must not blank the others.

**Client semantics:** ONE `useEffect` in `ShellDataProvider`, keyed
`[pathname]`, accountId re-derived inside via `ACCOUNT_ROUTE_RE` from
`@/lib/account-route` (retarget app-sidebar's module-private copy to the
shared module — recorded dedup lands here), `cancelled` cleanup, `.catch`
keeps last known, state paired `{ accountId, snapshot }`, consumers derive
by accountId match (the react-hooks set-state-in-effect shape from P2 —
preserve it). Provider mounted in the dashboard layout wrapping
`<AppSidebar/>` + `<Topbar/>` + `<main>`; `AppSidebar` reads
unread/setup via `useShellData()` (its two effects and two action imports
are deleted); `TopbarPresence` reads presence the same way (its effect
deleted). Off-account routes: effect early-returns; consumers derive their
hidden states.

**Also in this task (touched-file queue items):** the Conversations badge
pill caps at 99 → renders `99+` (recorded P2 Minor; `aria-label` keeps the
real count). Behavior everywhere else byte-identical — this is a wiring
refactor, not a redesign.

**Tests:** TDD `gatherSetupInputs` is NOT separately unit-tested (it is a
read-set move — the existing `deriveSetupStatus`/`reduceSetupProgress` tests
stand); pin the provider's derive-by-account-match with the same reasoning
P2 recorded. Existing pure-helper tests (`presence.test.ts`, messaging,
nav-groups) must pass UNCHANGED. Expect web test count unchanged or +small.
Commit `refactor(design): one getShellSnapshot action replaces three per-navigation shell reads`.

### Task 2: per-account metric helpers in packages/db

**Files:** Modify `packages/db/src/contacts.ts`, `opportunities.ts`,
`booking.ts`, `voice.ts` (+ their test files under `packages/db/src/test/`);
export any new names from the barrel if not `export *`.

**Interfaces — Produces (exact signatures later tasks consume):**
- `countContacts(db, accountId: string): Promise<number>` — exact head
  count, `contacts`.
- `listCallStartsBetween(db, accountId: string, fromIso: string, toIso: string): Promise<string[]>`
  — `calls.started_at` ISO strings, `.gte(from).lt(to)`, ascending. (Caps
  are 50/day so a 14-day window is ≤700 rows — bucketing happens in JS.)
- `listBookingCreationsBetween(db, accountId: string, fromIso: string, toIso: string): Promise<string[]>`
  — `bookings.created_at`, account-scoped the same way
  `listUpcomingBookings` (booking.ts:291) scopes bookings; all statuses (a
  later cancel does not erase the capture).
- `listOpportunityValuesCreatedBetween(db, accountId: string, fromIso: string, toIso: string): Promise<{ createdAt: string; monetaryValue: number }[]>`
  — `opportunities` created in window, any status ("Pipeline added" =
  created value, not surviving value).
- (already exist, reuse, do NOT duplicate: `countCallsSince`,
  `sumUnreadCount`, `listCalls`.)

**Tests:** live-DB per house pattern in `packages/db/src/test/` — each
helper gets: rows inside vs outside the window (boundary: `fromIso`
inclusive, `toIso` exclusive — pin both edges), and a cross-tenant
discriminator (fabricated other-account row NOT returned; mirror
`voice.test.ts`'s existing isolation cases). Watch RED first.
Commit `feat(design): per-account metric helpers for the dashboard`.

### Task 3: pure dashboard-metrics library (TDD throughout)

**Files:** Create `apps/web/src/lib/dashboard/metrics.ts` + `metrics.test.ts`.

**Interfaces — Produces:**
- `localDayWindow(now: Date, timezone: string, days: number): { fromIso: string; toIso: string; dayKeys: string[] }`
  — window covering the last `days` LOCAL calendar days ending today
  (inclusive), zone-correct via `zonedTimeToUtc`/`dayKeyInZone` from
  `@/lib/booking/`; `toIso` = now.
- `bucketByLocalDay(isoTimes: string[], timezone: string, dayKeys: string[]): { dayKey: string; count: number; isWeekend: boolean }[]`
  — `isWeekend` from the LOCAL calendar date: parse the dayKey and read
  `new Date(Date.UTC(y, m-1, d)).getUTCDay()` — anchoring the same
  calendar date at UTC midnight and reading the UTC day is
  locale/zone-independent (this is the sanctioned pattern; an un-pinned
  Intl weekday here is the recorded Americas-previous-day bug).
- `deltaVsPrior(current: number, previous: number): { direction: "up" | "down" | "flat"; label: string }`
  — previous > 0 → percent (`"12%"`, rounded); previous === 0 → absolute
  (`"3"` — the mockup's "▲ 3" case); equal → flat.
- `sparklinePath(counts: number[], width: number, height: number): { line: string; area: string; endX: number; endY: number }`
  — polyline/polygon `points` strings + endpoint dot coordinates
  (mockup geometry: viewBox 100×26).
- `countAfterHours(isoTimes: string[], timezone: string, openHours: OpenHours): number`
  — a call is after-hours when its LOCAL time falls outside that local
  day's `open_hours` window. Reuse the open-hours shape/parsing the
  booking availability code already has (find it in
  `apps/web/src/lib/booking/` — do NOT invent a second parser; if the
  existing one cannot be consumed cleanly, BLOCK and report).

**Tests:** explicit UTC instants; fixture zone that is NOT the dev machine's
(use `America/New_York` AND one far zone like `Pacific/Auckland` for the
day-boundary cases); pin: a call at 23:30 local lands in that local day
even when its UTC date is tomorrow; DST spring-forward day still buckets;
week/weekend flags; delta edge cases (0→0 flat, 0→n absolute, down);
sparkline flat-line and single-point cases; after-hours: before-open,
after-close, closed-day (all calls after-hours? NO — see honesty rule: a
day with no configured window means the metric is undefined; the FUNCTION
counts calls on closed days as after-hours, and the TILE-level rule in
Task 5 hides the tile when open_hours is entirely empty — pin both).
Commit `feat(design): pure dashboard metric math - windows, buckets, deltas, sparklines`.

### Task 4: KpiTile component + restyle of every existing stat tile

**Files:** Modify `apps/web/src/components/stat-tile.tsx` (it becomes the
new tile — one tile component in the tree, not two); Create
`apps/web/src/components/sparkline.tsx`; Modify
`(dashboard)/dashboard/page.tsx` (agency top-level tiles get the new
treatment) and the in-account page's existing three tiles (full page
rebuild is Task 5 — this task only makes the CURRENT tiles wear the new
skin so the component change ships coherently).

**Interfaces — Produces:**
- `StatTile({ label, value, delta?, spark?, period? }: { label: string; value: string; delta?: { direction: "up" | "down" | "flat"; label: string }; spark?: number[]; period?: string })`
  — label renders in the Label role (`font-mono text-[10px] font-medium
  tracking-[0.14em] uppercase text-muted-foreground`); value renders
  `font-display font-[650] text-3xl tracking-[-0.01em] tabular-nums
  text-card-foreground`; delta chip: `▲`/`▼` + label, `text-success` up /
  `text-destructive` down / muted flat, with `aria-label` "up 12% vs the
  prior period" style wording via `m[...]`; `period` renders as a mono
  caption when given. Rule 1: the component REQUIRES at least one of
  delta/spark/period — throw in dev (a plain number with no context is the
  thing this phase exists to kill).
- `Sparkline({ counts, className? })` — 100×26 viewBox,
  `preserveAspectRatio="none"`, polyline `stroke="currentColor"`
  strokeWidth 2 + area polygon `fill="currentColor"` opacity .12 + endpoint
  `circle` r 2.4; the component is `aria-hidden` (decorative — the delta
  and value carry the information); color from the parent's
  `text-primary`.
- Existing call sites: agency top-level 4 tiles get `period` ("All time" —
  new `m` key, exact copy `"All time"`); in-account 3 tiles same. Delta
  prop shape CHANGES from the dead `{value, direction}` to the new one —
  no live caller passes it today (verified in inventory), so no behavior
  change.

**Tests:** component has no test file today and the repo has no .tsx test
convention (recorded) — the dev-mode context-required rule gets a unit
test only if a clean seam exists without a component-render harness;
otherwise state plainly in the report that the tile is screenshot-verified
at the final task.
Commit `feat(design): stat tiles wear the display face with delta, sparkline, and period context`.

### Task 5: in-account dashboard rebuild — both audiences

**Files:** Modify
`apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/dashboard/page.tsx`;
Modify `apps/web/src/lib/messages.ts` (new keys); Modify
`apps/web/src/app/(dashboard)/page.tsx` (ONE line: the access-gate `<h1>`
gains `font-display font-[650] tracking-[-0.01em]` — the recorded P2
triage item); Modify `apps/web/e2e/client-access.spec.ts` (grants proof +
selector tightening, below).

**Layout (top to bottom):**
1. Greeting header replaces the bare PageHeader on THIS page only:
   `<h1>` display face, `m["dashboard.greeting.morning" | ".afternoon" | ".evening"]`
   interpolating the account name ("Good morning, {name}") — time-of-day
   from the ACCOUNT timezone via the Task 3 primitives (page fetches
   `accounts.timezone` — the in-account layout does not provide it; inline
   select mirrors `calendar/page.tsx:43`). Sub-line: the local long date
   (zone-pinned formatter per `formatWhen`'s existing pattern) and, ONLY
   when the account has an enabled voice profile, `m["dashboard.sub.voice"]`
   = "Sofía is answering your calls." No other claims — the mockup's
   "answered every call this weekend" is not honestly derivable this phase.
2. Agency-only ChecklistPanel block — unchanged position, unchanged
   behavior.
3. KPI row `grid gap-4 sm:grid-cols-2 xl:grid-cols-4`:
   - **Calls answered** — count of `listCallStartsBetween` over the last-7-
     local-days window; delta vs the prior 7; spark = 14-day buckets.
   - **Appointments booked** — same shape over `listBookingCreationsBetween`.
   - **After-hours captured** — `countAfterHours` over the 7-day calls;
     HIDDEN entirely (grid flexes) when the account's calendar is missing
     or `open_hours` is empty — never render a lie; delta vs prior 7.
   - **Pipeline added** — `formatCurrency` sum of
     `listOpportunityValuesCreatedBetween` over 7 days; delta vs prior 7;
     spark = 14-day value-sum buckets.
   All via `dbForRequest()` — client role INCLUDED (see grants proof).
4. The current three total tiles (Contacts / Open opportunities / Pipeline
   value) stay as a slimmer secondary row with `period` "All time".
   **RECORDED DEVIATION from the mockup** (which drops them): they carry
   information the page already gives clients today; danlo can cut later.
5. Chart + activity cards land in Tasks 6–7; this task leaves their grid
   slot rendering the existing content flow (no placeholder boxes).

Contacts/opportunities inline queries move to `countContacts` /
Task 2 helpers where one exists; the opportunities open-value read keeps
its in-file `max_rows` comment.

**Grants proof (hard lesson — serviceDb fixtures are BLIND to grants):**
extend `client-access.spec.ts` with an assertion that the CLIENT session's
dashboard renders the Calls-answered KPI with a numeric value (not the
error/hidden state) — this is the only layer that proves `calls`,
`bookings`, `opportunities` SELECT grants for the client role. While
touching this spec, tighten its `span.bg-sidebar-accent` selector (line
~129) to the rail (`.w-\[3px\]`) — the recorded P2 queue item; same in
`shell.spec.ts:33`. If the client session CANNOT read a table this page
needs, do not add a migration — BLOCK and report (grant changes are a
controller/danlo decision).

**Tests:** greeting time-of-day pure helper (morning/afternoon/evening
boundaries in the account zone, non-dev-zone fixture) TDD'd in
`apps/web/src/lib/dashboard/metrics.test.ts` or a sibling; messages parity
(the catalog test suite runs on every string change).
Commit `feat(design): dashboard KPI row with honest evidence, both audiences`.

### Task 6: 14-day calls chart card + recent-calls mini table

**Files:** Create
`apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/dashboard/calls-chart-card.tsx`
(server component — data arrives as props from the page); Modify the
dashboard page (renders the card in a `grid gap-4 xl:grid-cols-2` row);
messages keys.

**Chart (the mockup's own construction — CSS bars, not SVG):** a flex row
of `<div>` bars, height as a percentage of the window max, accent bars
`bg-primary`, weekend bars `bg-muted` (the `--surface-3` mapping — verify
against globals' `@theme inline` and use the utility that resolves to
surface-3), `rounded-t-[4px]`, hover tooltip on EVERY mark via the
mockup's data-attribute + CSS `::after` pattern rebuilt with tokens
(content = "Aug 18 · 5 calls" — local dates in the account zone), plus an
`sr-only` per-bar text ("Aug 18, 5 calls"). Bars container height 120px.
Axis row below: three mono labels (`font-mono text-[10px] tracking-[0.14em]
uppercase text-muted-foreground`): window start date · `m` key for
"weekends muted" · "today". Card header: `<h5>` "Calls" + mono caption
"LAST 14 DAYS".
**Empty state (rule 5):** zero calls in the window → one sentence
(`m["dashboard.calls.empty"]` = "When Sofía answers, every call lands
here with its outcome.") + a ghost link to the Voice page (enabled
profile absent) or the Calls page (profile enabled, just quiet).
**Mini table:** `listCalls(db, accountId, { limit: 3 })` under the chart —
columns: contact display name or E.164, `duration · LANG`, outcome pill
(reuse the EXACT outcome-pill rendering the Calls list already has — find
it in the calls list page/components and share the component rather than
copying its classes; dot + word), local time (`tabular-nums`). Whole row
is the click target → the call detail route (rule 4: row hover
`bg-muted`... verify the calls list's existing row treatment and match
it). Table hidden when there are no calls (the empty state above covers
it).
Commit `feat(design): 14-day calls chart with muted weekends and a recent-calls table`.

### Task 7: activity feed card — real events only

**Files:** Modify `packages/db/src/events.ts` (+ test): first READ helper.
Create
`.../dashboard/activity-card.tsx`; modify the dashboard page (second
column of the Task 6 grid row); messages keys.

**Interfaces — Produces:**
- `listRecentEvents(db, accountId: string, limit: number): Promise<{ id: string; type: string; actorType: string; payload: unknown; createdAt: string }[]>`
  — newest first, account-scoped, live-DB tested (window + cross-tenant
  discriminator).

**Feed semantics:** BEFORE building the renderer, grep every `emit(` call
site and enumerate the real event types + payload shapes into a curation
map — render ONLY types with an honest, owner-readable line (expected:
booking created/cancelled/rescheduled, lead/form submission, call
outcomes if emitted). Each row: icon chip (lucide icon + token bg like the
mockup's `--ac-dim`/good/warn chips — tokens only), bold one-line summary
via `m[...]` (never the raw type string), relative time ("10m", "3h" — a
small pure helper, TDD, zone-safe since it's instant-to-instant). Unknown
event types are SKIPPED silently. Feed reads via `dbForRequest()`.
**Grants reality check:** `events` may have no client SELECT grant — check
the migrations FIRST. If the client role cannot read it, the feed renders
for the AGENCY only and the client's layout gives the chart card the full
row (state this in the report; a grant migration is NOT this phase's call).
**Card footer:** one real affordance — `Add opportunity` button linking to
the pipeline page (the mockup's "Weekly report" button is OMITTED — the
feature does not exist; recorded deviation).
**Empty state:** `m["dashboard.activity.empty"]` = "Bookings, form leads,
and call outcomes appear here as they happen." No action link needed.
Commit `feat(design): activity feed from the events ledger - real types only`.

### Task 8: screenshot pass + gates + wrap (controller)

Temp spec, same technique as P2 Task 7 (never committed, deleted after):
in-account dashboard agency light + dark, client fixture session (themed),
chart-hover state if capturable, short viewport 1280×600, agency top-level.
Controller judges against DESIGN.md + the mockup's dashboard section; then
full `pnpm check` + build + full e2e (controller-run); ledger; whole-branch
review (most capable model) handed this plan + DESIGN.md + the recorded
deviations list; merge decision to danlo.

## Recorded deviations (final review + danlo get this list)

- Greeting sub-line claims only what is derivable (date + "Sofía is
  answering your calls" when enabled) — the mockup's weekend-summary line
  is aspirational copy.
- Mockup's Google-review and missed-call-text-back feed items omitted —
  features do not exist.
- "Weekly report" button omitted — feature does not exist.
- The three all-time total tiles are RETAINED as a secondary row (mockup
  drops them).
- Shell snapshot remains per-navigation (P2's recorded deviation carries).

## Self-review notes

- Task 1 is the entry gate on purpose (P2 final-review Important) and
  absorbs the gatherSetupInputs consolidation + badge cap + regex dedup
  queue items; Task 5 absorbs the access-gate h1 + e2e selector items.
- Tasks 2→3→4→5 form the data→math→component→page chain; 6 and 7 are
  independent cards after 5.
- The client-role grants question is handled at the only honest layer
  (client-session e2e) in Task 5, with BLOCK-not-migrate instructions in
  both places it could bite (Tasks 5 and 7).
