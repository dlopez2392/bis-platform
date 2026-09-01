# Design Phase 2 — App Shell Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Checkbox steps.

**Goal:** the shell matches DESIGN.md's sidebar/footer/presence patterns —
grouped nav with mono labels, accent-dim active treatment, unread badges,
pinned footer with the setup meter, identity blocks with avatar + timezone,
topbar Sofía presence — in both themes, both audiences, collapsed and
expanded, at every viewport height.

**Architecture:** all shell work stays in the existing components
(`app-sidebar.tsx`, `account-switcher.tsx`, `topbar.tsx`, `page-header.tsx`)
plus small server helpers for badge/meter/presence data threaded through the
dashboard layout. Tokens only; the sidebar remains dark in both themes and
themed clients keep overriding `--sidebar-accent`.

**Global constraints (every task):**
- Tokens only; sidebar literal island stands. Active treatment uses
  `bg-sidebar-accent/15` + a 3px `bg-sidebar-accent` left rail (the
  sidebar-scoped equivalent of the contract's `--accent-dim` — recorded
  deviation: keeps themed-client accents working).
- Group labels: `font-mono text-[10px] font-medium uppercase tracking-[0.14em]`
  + `text-sidebar-foreground/50`; hidden when collapsed.
- No assertion deleted except assertions about outputs a task removes
  (Task 1), which must be replaced by assertions of the new contract.
- Gates: unit + lint per task; full check/build/e2e at Task 7. Suites that
  read shell markup (`shell.spec.ts`, `client-access.spec.ts`,
  `tenant-theme.spec.ts`) are lockstep-mirror candidates — expected-value
  updates allowed, thresholds never.
- Copy through `m[...]` catalog; new keys added there (group labels:
  nav.group.overview = "Overview" etc. — the CSS uppercases).

### Task 0: entry-gate focus screenshots (controller judges)

TEMP spec `apps/web/e2e/design-focus.spec.ts` (never committed): shoot
`:focus-visible` on a button — (a) agency `/dashboard/accounts` (unthemed,
storage `e2e/.auth/state.json`), (b) the FIXTURE CLIENT session
(`e2e/.auth/client-state.json`, its own account root — THEMED: the fixture
sets brandColor/mode). Tab to a visible button, screenshot viewport, save
`focus-agency.png` / `focus-themed.png` to the scratchpad design-shots dir.
Run only this spec; report PNG paths; controller judges ring visibility and
deletes the spec. THIS CLOSES THE P1 FINAL-REVIEW CONDITION.

### Task 1: themeStyle stops emitting the old-semantic accent pair

**Files:** Modify `apps/web/src/lib/branding/theme-style.ts` (drop the
`--accent`/`--accent-foreground` emission lines), `theme.ts` (remove
`accent`/`accentForeground` from the derived Theme type + derivation),
`theme.test.ts` + `theme-style.test.ts` (remove ONLY the assertions about
the removed outputs; ADD: an assertion that `themeStyle`'s emitted string
contains NO `--accent:` and NO `--accent-foreground:` — the new contract:
the brand `--accent` token is never shadowed on themed accounts).
TDD: new no-shadow assertions first (they fail against current emission).
Run the full branding suite. Commit
`fix(design): themed accounts no longer shadow the brand --accent token`.

### Task 2: grouped sidebar nav + badges

**Files:** Modify `apps/web/src/components/app-sidebar.tsx`,
`apps/web/src/lib/messages.ts`; Create `packages/db` helper ONLY if one
for summing `conversations.unread_count` by account does not already exist
(check `messaging.ts` first).
> **CORRECTED 2026-09-01 (review):** this task originally said to thread
> `unreadTotal` through the dashboard layout — that wiring is IMPOSSIBLE:
> the layout rendering `<AppSidebar/>` is an ANCESTOR of
> `dashboard/accounts/[accountId]` and never receives a descendant
> segment's dynamic params, so `accountId` is always undefined there. The
> shipped architecture instead adds a guarded `"use server"` action
> `getUnreadTotal(accountId)` in the `[accountId]` segment
> (`unread-actions.ts`, `requireAccountAccess` + scoped `sumUnreadCount`),
> imported directly by the client sidebar and called from an effect keyed
> on `pathname`. Any later task needing per-account data in the sidebar
> must use this pattern, not layout params.
**In-account groups (both audiences, items filtered per audience as today):**
OVERVIEW: Dashboard · CRM: Contacts, Opportunities · COMMUNICATIONS:
Conversations, Calls, Voice(agency-only) · GROWTH: Forms, Calendar,
Branding(client-only). **Setup leaves the nav** (footer, Task 3). Agency
top-level (Companies/Blueprints) stays flat, no labels. Structure:
`{ label: string; items: NavItem[] }[]`; render label row (hidden when
collapsed; a plain `<div role="presentation">`), then items.
**Active treatment:** replace `bg-white/10` with `bg-sidebar-accent/15
text-white`, rail `w-[3px]` (was `w-0.5`).
**Badge:** `unreadCount` prop → small pill on Conversations item
(`bg-sidebar-accent text-[10px] font-medium text-sidebar rounded-full
px-1.5 min-w-4 text-center`); collapsed state shows a dot (absolute
top-right of icon). Hidden when 0.
> **CORRECTED 2026-09-01 (review):** the original "aria-label on the
> badge span" instruction was itself an a11y defect — name-from-content
> would let a labelled span REPLACE the link's own name in the collapsed
> state. The count rides on the Link's `aria-label`
> (`"Conversations (N unread)"`); both badge spans are `aria-hidden`.
TDD where testable (group-structure pure helper: extract
`buildNavGroups(base, isAgency)` to `apps/web/src/lib/nav-groups.ts` with
unit tests: grouping, audience filtering, Setup absent). e2e mirrors:
update `shell.spec.ts` expectations if they reference nav structure.
Commit `feat(design): grouped sidebar nav with mono labels and unread badge`.

### Task 3: pinned footer cluster + scrolling middle

**Files:** `app-sidebar.tsx`; the setup meter needs the account's step
state: reuse the setup page's existing derivation (find it under
`.../setup/` — a server helper deriving the 9 steps).
> **CORRECTED 2026-09-01 (Task 2 review made this binding):** originally
> this said "called from the LAYOUT server-side, passed as
> `setupProgress`" — impossible, the layout is an ANCESTOR of
> `dashboard/accounts/[accountId]` and never receives the account id
> (the exact wiring behind Task 2's Critical). Use the sanctioned
> pattern instead: a guarded `"use server"` action in the `[accountId]`
> segment (mirror `unread-actions.ts` — `requireAccountAccess` OUTSIDE
> the try, returns `{ done: number; total: number }`), imported directly
> by `AppSidebar` and read from its pathname-keyed effect, agency +
> in-account only (early-return otherwise; a failed read hides the
> meter, never crashes the shell). The action CALLS the setup page's
> existing derivation — if that derivation is too heavy/entangled to
> call cleanly from an action, BLOCK and report rather than duplicating
> its logic.
**Shell:** `aside` gets `h-dvh sticky top-0`; nav middle `overflow-y-auto
min-h-0 flex-1`; footer cluster pinned at bottom (`mt-auto border-t
border-sidebar-border pt-2`): Settings link (agency in-account), setup
meter row (link to `${base}/setup`: label "Setup", right-aligned
`done/total` in mono + a 2px progress bar `bg-sidebar-accent` on
`bg-white/10`), agency top-level keeps Dashboard footer link. Meter hidden
when done === total (contract: Setup leaves nav when complete — the meter
row IS its nav presence).
Commit `feat(design): pinned sidebar footer with setup meter; middle nav scrolls`.

### Task 4: identity blocks — avatar + timezone

**Files:** `account-switcher.tsx`, `app-sidebar.tsx` client block.
Switcher trigger + client identity block both show: avatar chip (existing
logo-chip pattern; agency switcher shows active account's initial letter in
a `bg-sidebar-accent/20 text-sidebar-accent` chip when no logo concept
exists there) + name + second line `text-[11px] text-sidebar-foreground/60`
with the account timezone (already displayed today in the switcher —
preserve, restyle). Collapsed: chip only. No behavior changes.
Commit `feat(design): identity blocks with avatar chip + timezone line`.

### Task 5: topbar Sofía presence indicator

**Files:** Create `apps/web/src/lib/voice/presence.ts` — server helper:
`getVoicePresence(db, accountId, now)` → `{ onCall: boolean; weekCount: number }`
(onCall: a `calls` row with `ended_at IS NULL AND started_at > now-1h`;
weekCount: calls with `started_at >= start of current week, account tz not
required — UTC week is fine, label says "this week"). Unit tests with a
mocked db per the house pattern in `registry.test.ts`.
Modify `topbar.tsx`: in-account only, both audiences, and only when the
account HAS an enabled voice profile.
> **CORRECTED 2026-09-01 (third instance of the ancestor-params trap):**
> originally "the layout ... thread a boolean" — impossible: `Topbar` is
> mounted in the ROOT dashboard layout, which never receives
> `[accountId]`, and the nested `[accountId]` layout renders only into
> `main`, below the topbar. Use the sanctioned pattern (binding since the
> Task 2 review): a guarded `"use server"` action in the `[accountId]`
> segment (`requireAccountAccess` OUTSIDE the try — both audiences see
> this) that FIRST checks for an enabled voice profile — no enabled
> profile → return `null` and skip the calls queries entirely (the
> "skip the query" semantics move server-side into the action) —
> otherwise returns `getVoicePresence(...)`'s snapshot. Rendered by a
> small `"use client"` presence component inside the (still server)
> `Topbar`, reading via a pathname-keyed effect that early-returns off
> account routes; action/transport failure renders nothing — presence
> must never take the topbar down.
Render: on-call → violet dot with `animate-pulse`
(respects the global reduced-motion kill) + "Sofía · on a call"; idle →
"✓ N calls this week" muted; no enabled voice profile → render NOTHING
(not the idle state). Strings via `m[...]`. RECORDED DEVIATION:
request-time snapshot became per-navigation snapshot (same class, reads on
route change like the sidebar's badge/meter), still no live polling
(revisit later).
Commit `feat(design): topbar voice presence indicator`.

### Task 6: display face goes live

**Files:** `apps/web/src/styles/tokens.css` — `--font-display:
var(--font-bricolage), "Bricolage Grotesque", "Geist", sans-serif;` (both
blocks; kills the dead-literal-stack precedence issue from the P1 review).
`apps/web/src/app/(dashboard)/layout.tsx` — flip Bricolage `preload: false`
→ `true`, update its comment (the consumer now exists).
`apps/web/src/components/page-header.tsx` — title element gets
`font-[family-name:var(--font-display)] font-[650] tracking-[-0.01em]`
(or the tailwind-v4 idiomatic equivalent already used for fonts in this
repo — match house style).
Extend `design-foundation.test.ts`: tokens.css `--font-display` must
reference `var(--font-bricolage)` (both blocks); layout preload comment no
longer claims no-consumer (assert `preload: true` appears — read layout.tsx
as text like the existing tests read globals).
Commit `feat(design): page titles adopt the display face; Bricolage preloads`.

### Task 7: screenshot pass + gates + wrap

Temp spec (same technique as P1 Task 5, then deleted): agency top-level,
agency in-account dashboard + conversations (badge visible if any unread),
client fixture session root, collapsed sidebar, short-viewport (height 600 —
footer must stay visible per contract rule 10), light + dark each where
applicable. Controller judges against DESIGN.md sidebar/footer/presence
patterns; danlo eyeball checkpoint. Then: full `pnpm check` + build + e2e;
ledger; whole-branch review (most capable model) with this plan + DESIGN.md;
merge decision to danlo.

## Self-review notes
- Rule-10 short-viewport shot is the pinned-footer proof; collapsed +
  themed-client shots cover the branding overrides.
- Task 1 is deliberately first after the gate: it changes what themed
  accounts paint, and the Task 7 screenshots must reflect the final state.
- Data-plumbing risks (setup meter derivation, unread sum) carry explicit
  BLOCK instructions rather than improvised duplication.
