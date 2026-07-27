# BIS Platform — M1a CRM UI Overhaul

**Date:** 2026-07-26
**Status:** Approved design, pending implementation plan
**Scope:** Visual and interaction overhaul of every screen shipped in M1a, plus the app shell that was never built.

---

## 1. Why

M1a shipped working CRM functionality — tenancy, RLS, events, contacts, opportunities, 18 passing tests — inside stock `create-next-app` styling. There is no design system, no component library, no app shell. `globals.css` is 45 lines of scaffold. The pipeline board moves cards with `◀` / `▶` buttons.

Dan's assessment after E2E testing it: *"the most basic thing I've ever seen"* versus HighLevel.

This overhaul closes that gap. It is a **restyle plus two specified interaction upgrades** — not a feature milestone.

**Reference:** a live tour of the GoHighLevel account (agency *Bespoke Intelligent Solutions*, sub-account `Qyr8QK7pk4pzhWkVwjzO`) on 2026-07-26 produced four reference captures: opportunities board, contacts smart list, contact detail three-pane, and dashboard. They are session artifacts, not committed. The patterns extracted from them are recorded in §5–§7 below, which is the durable form.

---

## 2. Product context

BIS Platform is **an internal tool for BIS that may be resold later**, and Dan's own client companies may eventually be given logins.

This is a sequencing question, not an architectural fork. The existing route shape (`/dashboard/accounts/[accountId]/...`) and the `app_role` claim already in `apps/web/src/lib/auth.ts` are GHL's two-level model. Nothing in this overhaul needs to change for a client to log in later — that becomes a role plus an invite flow.

Two consequences the design honors:

- **The agency level is a real destination, not an admin afterthought.** Dan's stated daily need is "look at all the companies I set up, easy to access."
- **Account-scoped screens must never assume the viewer is Dan.** No agency-wide figures inside an account workspace.

**Differentiator: deliberate simplicity.** GHL's sidebar carries 17 items and that is precisely what makes it overwhelming. BIS ships six.

---

## 3. Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Product intent | Internal tool, resale-capable | Bones already support it; no rework needed later |
| Scope | App shell + all 7 existing screens, one pass | Avoids a half-old app; commit-per-screen keeps review incremental |
| Identity | BIS violet `#7c3aed` / cyan `#0891b2`, light-first with dark | Matches bis-rgv.com so platform and public site read as one company; light is better for dense tables; violet avoids generic-blue SaaS |
| Pipeline UX | Drag-and-drop **plus** inline card editing | Full GHL parity; `◀`/`▶` is the most prototype-y thing in the app |
| Structure | shadcn/ui inside `apps/web` | One consumer app today; `packages/ui` is plumbing that buys nothing visible. Promotion later is a file move |
| Dark mode | `.dark` class on `<html>`, not `prefers-color-scheme` | Enables a user toggle later; makes screenshots deterministic |
| i18n | Structural now, English strings only | Retrofitting after 20 screens is expensive; wiring an empty shell is nearly free |

### Non-goals

- No Conversations or Calendar implementation — they ship as honest empty states pointing at M1b.
- No client-facing invite flow, no account-user role enablement. See §12.
- No new CRM features. If it does not exist in M1a, it is not in this pass.
- No `packages/ui` extraction.
- No unrelated refactoring of the data layer.

---

## 4. Design tokens

Tokens live in `apps/web/src/app/globals.css` as CSS custom properties in the shadcn variable set, mapped into Tailwind v4 through `@theme inline`.

**Semantic set:** `--background`, `--foreground`, `--card`, `--card-foreground`, `--popover`, `--popover-foreground`, `--primary`, `--primary-foreground`, `--secondary`, `--muted`, `--muted-foreground`, `--accent`, `--accent-foreground`, `--destructive`, `--success`, `--warning`, `--border`, `--input`, `--ring`, `--radius`.

**Light (default):** primary `#7c3aed`, accent `#0891b2`. Canvas is a near-white gray with white cards — the page/surface separation GHL uses to make dense content legible. Border is a low-contrast gray; the reference leans on borders rather than shadows, and so does this.

**Dark (`.dark`):** primary `#8b5cf6`, accent `#22d3ee`, matching the bis-rgv.com dark ramp.

**Sidebar** gets its own token trio (`--sidebar`, `--sidebar-foreground`, `--sidebar-accent`) because it is dark slate in *both* modes, like the reference. It must not simply invert.

**Pipeline stages** get a dedicated color ramp (`--stage-1` … `--stage-6`) so board columns stay distinguishable in both modes. Stage color is assigned by position, not by name, so renaming a stage does not change its color.

**Typography:** Geist, already wired in `layout.tsx`, replacing the current `Arial, Helvetica, sans-serif` body rule.

**Removal:** the `select` / `input` / `textarea` `color-scheme` block at `globals.css:29–50` is deleted. It exists only because the app follows the OS theme; once dark is class-driven it is dead code, and it is the direct cause of the two most recent commits (`c3dcc6a`, `d55be5e`).

---

## 5. App shell

Two levels, mirroring the reference.

### Sidebar

Fixed 224px, collapsible to a 64px icon rail. Collapse state persists in a cookie, not `localStorage`, so the server render matches the client and there is no layout flash. Dark slate in both themes; active item carries a violet left-edge indicator and raised contrast.

Top to bottom:

1. **BIS mark** — links to agency root.
2. **Account switcher** — avatar, company name, city, up/down chevrons. Opens a searchable list of every account. This is the control Dan touches most and the direct answer to "easy to access"; it gets the most prominent non-logo position, exactly as the reference does.
3. **Global search** — input with a `⌘K` / `Ctrl K` affordance.
4. **Nav** — five account-scoped items: Dashboard, Contacts, Opportunities, Conversations, Calendar. Settings is the sixth, pinned to the sidebar footer and separated by a rule.

Agency-scope nav is two items: Accounts, Settings.

### Topbar

Holds Clerk's `OrganizationSwitcher` (agency/org — rarely touched) and `UserButton`. These currently sit in `dashboard/layout.tsx` next to the nav links; they move here. The org switcher and the account switcher are different concepts at different frequencies and must not share a control.

### `<PageHeader>`

One component codifying the reference's three-row pattern. Every screen uses it — this consistency is most of what makes GHL feel like a single product.

- **Row 1** — page title (large, semibold) and underlined sub-tabs.
- **Row 2** — contextual selector (e.g. pipeline picker), a count pill, and right-aligned actions: secondary outline buttons, then one primary filled button, then an overflow kebab.
- **Row 3** — filter and sort pills showing active counts (`Filters (1)`), right-aligned search input, and a field-visibility control.

Rows 2 and 3 are optional per screen.

---

## 6. Screens

Seven screens, each its own commit.

### 6.1 Agency dashboard — `/dashboard`

Currently 8 lines. Becomes a stat-tile row across all accounts (total contacts, open opportunities, pipeline value, won this month) over a recent-activity list. Each tile is a label, a large value, and an optional delta — no sparklines. Charts are deferred until there is enough real data to be worth plotting; an empty chart is worse than no chart.

### 6.2 Accounts list — `/dashboard/accounts`

Currently 39 lines. Becomes Dan's daily view: a responsive grid of company cards, each with name, city, and quick stats (contacts, open opps, pipeline value), clicking through to that account's workspace. Retains the existing create-account form, restyled into a dialog behind a primary "Add company" button.

### 6.3 Account workspace layout — `/dashboard/accounts/[accountId]/layout.tsx`

Provides the account-scoped sidebar, the account header, and the switcher's current-account state. Continues to enforce access exactly as today.

### 6.4 Contacts list — `.../contacts`

A proper data table: leading checkbox column, avatar + name, phone and email with leading icons, business name, created, last activity, tags as chips with a `+N` overflow. Sortable headers, pagination footer with page-size select. `PageHeader` carries `Filters` / `Sort` pills, search, Import and Add Contact.

Filters and sort operate on the existing `listContacts` query parameters. No new query capability is built; where the current data layer cannot express a filter, that filter is not offered.

### 6.5 Contact detail — `.../contacts/[contactId]`

The reference's three-pane layout, which is the densest and most valuable screen to copy:

- **Left** — contact card (avatar, name, delete), owner and followers, tags with inline add/remove, then collapsible field groups behind a field search.
- **Center** — activity timeline with day separators, and a message composer pinned to the bottom. The composer is presentational in this pass; wiring is M1b.
- **Right** — activity rail, collapsible, with a genuine empty state.

Panes are independently scrollable. Below `lg`, they stack: contact card, timeline, activity.

### 6.6 Pipeline board — `.../pipeline`

Column headers become discrete cards showing stage name, opportunity count, and stage total. Cards show name, contact, value, and a footer icon row.

**Drag-and-drop** via `dnd-kit`. The board becomes a client component fed serialized data from its server parent. `useOptimistic` applies the move immediately so cards never snap back, with the existing `moveOppAction` behind it and a revert plus toast on failure.

**Inline editing** via a card detail drawer: click a card to edit name, value, and status without leaving the board. Saves through a server action.

Owner is deliberately excluded. `opportunities.assigned_to` exists (`0003_crm_core.sql:85`) and references `public.users(id)`, but `@bis/db` exposes no user accessor and no screen creates users — an owner picker would mean building user management, which §3 lists as a non-goal. Owner editing moves to M1b alongside real user records.

The `◀` / `▶` buttons and the inline `status` select + `set` button are removed. `moveOppAction`'s direction-based signature is extended to accept a target stage id — drag needs an absolute destination, not a relative step.

### 6.7 Account settings — `.../settings`

Sectioned form using shadcn form primitives, with grouped cards and a single save affordance per section.

---

## 7. Component inventory

**From shadcn/ui:** button, input, label, select, dialog, drawer/sheet, dropdown-menu, popover, tabs, table, badge, avatar, card, separator, tooltip, skeleton, sonner (toasts), form, checkbox, command (for ⌘K and the account switcher's search).

**Written for this app:** `AppSidebar`, `AccountSwitcher`, `Topbar`, `PageHeader`, `StatTile`, `DataTable` (a thin wrapper over shadcn's table with sorting and pagination), `TagChips`, `EmptyState`, `PipelineBoard`, `PipelineCard`, `OpportunityDrawer`, `ContactFieldGroup`, `ActivityTimeline`.

`EmptyState` is load-bearing, not decoration: Conversations and Calendar are empty states, and every list needs one.

---

## 8. Data flow

Unchanged. RSC plus server actions; no new data layer, no client fetching library.

The two client components are the pipeline board and the opportunity drawer. Both receive serialized props from server parents and mutate through existing server actions. `revalidatePath` continues to reconcile after optimistic updates.

`moveOppAction` gains a target-stage parameter (§6.6). No other action signature changes.

`listBoard`'s return type widens to expose `stage.position`, which it already selects — the board needs it client-side to assign stage colors by index. No query change.

---

## 9. Internationalization

Component strings are extracted to a messages module and referenced by key. English only ships in this pass. No locale routing, no language switcher, no Spanish translation.

The rule this enforces: **no hardcoded user-facing string in a component.** That is the whole cost now, and it is what makes Spanish a translation file later instead of a refactor across every screen.

---

## 10. Dependencies added

| Package | Why | Note |
|---|---|---|
| `shadcn/ui` components | Radix primitives, copied into the repo | Not a runtime dependency; brings `radix-ui`, `class-variance-authority`, `clsx`, `tailwind-merge`, `cmdk`, `sonner` |
| `tw-animate-css` | Supplies the `animate-in` / `slide-in-from-*` utilities the new-york Dialog, Sheet, Popover, DropdownMenu, and Tooltip emit | **Added during Task 2, approved by the controller.** CSS-only, imported from `globals.css`, lives in `devDependencies`. Without it those classes resolve to nothing and every overlay loses its enter/exit motion |
| `lucide-react` | Icons | shadcn's assumption; closest to the reference's icon language |
| `dnd-kit` | Board drag-and-drop | ~10kb; the accessible option, with keyboard dragging |
| `next-themes` | `.dark` class management | Small; avoids hand-rolling theme persistence |
| `@playwright/test` | UI smoke tests | Dev dependency |

---

## 11. Testing

The 18 existing tests must stay green — this is a restyle, and any test that breaks indicates unintended behavior change, not a test needing an update. The one legitimate exception is a test asserting on `moveOppAction`'s signature, which changes by design (§6.6).

`pnpm check` (typecheck + test) must pass before each commit.

New Playwright specs:

1. Shell renders; sidebar collapses and the state survives reload.
2. Account switcher lists accounts and navigates into one.
3. Contacts list loads, sorts, and paginates.
4. Drag an opportunity to another stage; reload; it is still there.
5. Opportunity drawer edits a value and persists it.

Test 4 is the important one — optimistic UI can convincingly show a move that never reached the database, which is exactly the failure a visual check misses.

Dan does a visual pass per screen at the review gate.

---

## 12. Risks

**shadcn against Next 16 / React 19.** The registry generally supports both, but individual components may need hand-fixes. Mitigation: install incrementally, typecheck after each.

**Optimistic drag hiding write failures.** Covered by Playwright test 4 and a revert-plus-toast path.

**Clerk component theming.** `@clerk/themes` is already a dependency; `OrganizationSwitcher` and `UserButton` need violet variables to avoid looking foreign in the topbar.

**Scope growth.** Seven screens is a large pass and "rebuild everything" invites additions. The non-goals in §3 are the control, and commit-per-screen makes drift visible early.

**Client-login readiness.** RLS exists but has not been proven under a non-agency role. Deliberately out of scope; a hardening pass with an authenticated-as-client isolation test must precede giving any real client a login. "RLS exists" and "I would bet a client relationship on it" are different claims.

---

## 13. Commit sequence

1. Tokens, theme, `next-themes`, delete the `color-scheme` block
2. shadcn init and base components
3. App shell — sidebar, account switcher, topbar, `PageHeader`
4. Accounts list
5. Agency dashboard
6. Account workspace layout
7. Contacts list
8. Contact detail
9. Pipeline board — drag-and-drop
10. Opportunity drawer — inline editing
11. Settings
12. Playwright specs

Steps 1–3 are the foundation and land together before any screen work. Each subsequent commit passes `pnpm check`.

---

## 14. Success criteria

- Every screen uses `PageHeader` and the token set; no stock scaffold styling remains.
- The account switcher reaches any company in two clicks from anywhere.
- Opportunities move by dragging, and the move survives a reload.
- Opportunity fields are editable without leaving the board.
- `pnpm check` green; five Playwright specs green.
- No hardcoded user-facing strings.
- Dan's verdict on the pipeline and contact-detail screens is that they read as a real product.
