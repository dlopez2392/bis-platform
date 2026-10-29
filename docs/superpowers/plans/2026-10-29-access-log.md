# See when BIS looked (F-118 part 1): implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Before any account's pages show anything to a BIS (agency) person, they choose why they are there. That starts a two-hour visit. Each customer, household or business, call, conversation, file, form's answers and customer-list download they open is written once per visit to an append-only log, which the account's Owners read in a "BIS access" section at the bottom of the Team page.

**Architecture:** Migration 0105 adds `agency_visits` and `agency_visit_items`. Both are append-only by grants: no role holds UPDATE or DELETE. It also adds four `security invoker` functions and one window helper. The gate lives inside the two guards every in-account surface already calls (`requireAccountAccess`, `apiAccountAccess`), in the agency branch only, and redirects to a chooser page outside the account tree, `/dashboard/enter/<id>?to=<path>`. The proxy hands the gate the requested path in an `x-bis-path` request header. Each record surface calls one logger, `noteOpened` (pages and actions) or `noteOpenedApi` (routes), after its own record proof and before any of the record leaves the server. A source-walk test fails, naming the file, on any page or route under the account trees that nobody has classified.

**Tech Stack:** Postgres 17 (Supabase) migrations and plpgsql, supabase-js and PostgREST RPC, Next.js 16.3.6 App Router (server components, server actions, route handlers, `proxy.ts` on Clerk's `clerkMiddleware`), React 19, vitest, Playwright (bis-e2e-qa only), the `typescript` package's AST for the source walk.

**Spec:** `docs/superpowers/specs/2026-10-29-access-log-design.md`. The owner's rulings are in its §10 and the planning corrections in its §11. Every `path:line` below was read at `13079bec` on 2026-10-29.

**Shorthand:** `ACCT/` = `apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/`; `API/` = `apps/web/src/app/api/accounts/[accountId]/`; `ENTER/` = `apps/web/src/app/(dashboard)/dashboard/enter/[accountId]/`; `SCRATCH` = `C:\Users\danlo\AppData\Local\Temp\claude\C--Users-danlo-bis-platform\a07f1286-4ae4-42ce-bdae-7730a126c5d4\scratchpad` (Git Bash: `/c/Users/danlo/AppData/Local/Temp/claude/C--Users-danlo-bis-platform/a07f1286-4ae4-42ce-bdae-7730a126c5d4/scratchpad`). Every agent works in its OWN subdirectory of `SCRATCH`, named in its task.

## Global Constraints

- The worktree is `C:\Users\danlo\bis-platform\.claude\worktrees\access-log` on branch `feat/access-log`. It has no `node_modules`: the orchestrator runs `pnpm install --frozen-lockfile --prefer-offline` ONCE before dispatching anyone. No agent runs `pnpm install`.
- Migration number **0105** (`0105_access_log.sql`). 0104 is the newest on `main` (`ab4aee71`). No other branch holds a 0105 (`git log --all -- '*0105*'` was empty on 2026-10-29). **No agent applies 0105 anywhere.** The orchestrator applies it, in the order in Task 13.
- **No `@bis/db` vitest runs locally against bis-ci until 0105 is on bis-ci.** That includes mock-only files whenever Supabase credentials are in scope, because the package's global setup sweeps for every invocation. This worktree has no `packages/db/.env` and no `apps/web/.env.local` (checked 2026-10-29). Never create one. Never export `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` or a bis-ci `SUPABASE_DB_URL` in a shell. Before ANY `@bis/db` run, check `env | grep -c '^\(NEXT_PUBLIC_SUPABASE_URL\|SUPABASE_SERVICE_ROLE_KEY\)='` prints `0`. With that, `packages/db/src/test/global-setup.ts:31-33` skips the sweep.
- Local `@bis/db` runs are exactly one of two kinds: `withRollback` files against a local replica (`SUPABASE_DB_URL=postgresql://postgres@localhost:<your port>/post`), or pure and fake-client files. Files built on `withTestAccount` (`*-live.test.ts`) are proven ONLY by CI `verify`, which builds its own stack from the branch's migrations. The same rule holds for the three live web tests (`apps/web/src/app/f/[publicId]/actions.returning-lead.test.ts`, `ACCT/calls/[callId]/actions.test.ts`, `weekly-metrics.live.test.ts`): never run them locally on this branch.
- Replica recipe: memory `bis-local-db-replica`, and the script in Task 1 Step 1. Use PostgreSQL **17.6** from `C:\Users\danlo\AppData\Local\Temp\claude\C--Users-danlo-bis-platform\88d51cd6-6c5b-4497-af8a-63647f233ba6\scratchpad\ca-t1\pg17\pgsql\bin\` while it exists. Otherwise use PG18 at `C:\Program Files\PostgreSQL\18\bin`, and make no cost claim from PG18 (its skip scan hides PG17 plans). `initdb -E UTF8 --locale=C --locale-provider=icu --icu-locale=en-US`, `alter database … set timezone to 'UTC'`. Use your own port and your own scratch directory. Stop your replica when done.
- Commands from the worktree root. Web: `pnpm --filter web exec vitest run <paths>`. Db: `pnpm --filter @bis/db exec vitest run <paths>`. Judge a db run by vitest's summary block, never the exit code: it prints a trailing `ERR_PNPM_RECURSIVE_EXEC_FIRST_FAIL`. When an exit code matters, write it to a file with nothing after the command. Every lane also runs `pnpm --filter web lint` and `pnpm --filter web typecheck` (whole package, cheap) before reporting.
- **Never** run `pnpm check`, `pnpm --filter web build` or Playwright. Those are the orchestrator's, one at a time. Only bis-e2e-qa writes Playwright specs, and only the orchestrator runs them.
- Commits: `git add <explicit paths>` then `git commit -- <the same paths>`, message `type(scope): what and why`, scopes `db`, `auth`, `contacts`, `voice`, `sms` (conversations), `design`, `e2e`. **Never** `-A`, `.`, `git stash`, `git checkout` (not even `git checkout -- <file>` to revert a probe), `git commit --amend`, rebase or push. If `.git/index.lock` exists, wait and retry; never delete it. Revert a mutation probe by restoring your saved copy (`cp` and then `cmp`), never with git. Reviewers probe in their OWN `git worktree add --detach <sha>`, removed with `git worktree remove --force` only.
- Copy follows DESIGN.md's 7 AM rule in English and in usted Spanish. Every English key has its `.es` twin on the very next line. No milestone codes (the `INTERNAL_MILESTONE` guard), no `F-118`, no `{{`, no arrows. `accounts.name` (the agency's label) appears ONLY on the agency's own chooser page, never on an Owner's surface.
- DESIGN.md rules 3, 5, 7, 8 and 11 bind every UI task: the chooser has four tiles and NO primary, the reader has no primary, there are no status colours (a reason is not a status), and loading is skeletons shaped like the content, never spinners. Tokens only. Each UI task renders correctly in `.dark` and light and under `@supports not (backdrop-filter)`, and survives the pseudo-locale's +35% length.
- e2e runs only on the PER-RUN FIXTURE account and Test Client One, read-only on the latter (the visits it writes there are ids only; see the finding in Task 13).
- Owner rulings (spec §10), binding: **1** a visit is two hours, fixed, from the reason; a new sign-in session needs a new reason; activity does not extend it. **2** list pages are not logged. **3** `/dashboard/work`, `/dashboard/screened` and `/dashboard/numbers` are not gated or logged, and that is DISCLOSED in words on the Owner's section (both languages) and in the trust-pack text. **4** fail closed: if the log write fails, the record does not open for the agency person, and clients are never affected. **5** refuse any session carrying Clerk's `act` claim. **6** direct database access is disclosed as not logged. **7** the chooser is an entry step like `/no-access`, with no DESIGN.md amendment. **8** no owner email or notification. **9** the section sits at the bottom of the Team page, plus ⌘K `nav:bis-access`.

## Deviations from the spec (the source wins)

These are the spec's §11 corrections, C1–C19, with the evidence behind each:

1. **C1, export count.** The export streams: `ACCT/contacts/export/route.ts:106-171` builds a `ReadableStream`, so "rows sent" exists only after the data has left. The item is written BEFORE the stream, with `item_count = countContacts(db, accountId, { search, archived })` (`packages/db/src/contacts.ts:1031-1045`, which already throws on a null count).
2. **C2, Export is an anchor.** `ACCT/contacts/page.tsx:281-287` renders Export as `next/link` to a route handler. A route handler runs on any GET, so a Link's prefetch, and the RSC fetch that comes before the full-page fallback, could each log a download. The button becomes a plain `<a download>`, and the route returns 204 to requests carrying `rsc` or `next-router-prefetch` (header names: `e2e/support.ts:217-218`).
3. **C3, pages are safe at render.** `node_modules/next/dist/server/app-render/walk-tree-with-flight-router-state.js:62-80` (16.3.6): before PPR, a prefetch stops at the first `loading` and short-circuits a tree with none. `apps/web/next.config.ts` turns on no PPR. So no record PAGE body runs on an automatic prefetch. The e2e spec pins it.
4. **C4.** `packages/db/src/test/schema-grants-guard.test.ts` is not edited: `:62-111` lists only `authenticated` WRITES.
5. **C5.** `agency_visit_items` has no direct `account_id` foreign key. The composite key to `agency_visits (id, account_id)` carries the account, and the cascade from `accounts` runs through `agency_visits_page` (which leads with `account_id`) and `agency_visit_items_visit` (which leads with `visit_id`).
6. **C6.** `actor_name` is nullable. An unknown name is rendered "Someone at BIS" / "Alguien de BIS" in the reader's language.
7. **C7.** There is no `apps/web/src/lib/jobs`; the job runner is `lib/automations/jobs`. The import guard is an allowlist plus the public, cron, webhook and voice trees.
8. **C8.** The intro is narrowed to "These entries can't be changed or deleted from BIS or from your account." Grants do not bind the table's owner role.
9. **C9.** Spanish "al cabo de 2 horas".
10. **C10, creating a company starts a Setup visit.** `dashboard/accounts/actions.ts:146` (`createClientAccount`) and `:225` (`adoptOrphanOrgAction`) redirect straight into the new account. Both start a Setup visit for the caller first. A failed start is logged, and the redirect then meets the chooser. With this, `blueprints.spec.ts:95-109` and `vetting.spec.ts:100-104` need no change. **The owner may veto:** the alternative is that those two specs click Setup.
11. **C11, the work list's suggestion buttons.** `work/agency-work-list.tsx:223-234` binds `acceptSuggestionAction`, `editAcceptSuggestionAction`, `discardSuggestionAction` and `undoSuggestionAction` for every account. All four go through `run()` in `lib/proposals/actions.ts:35-41`. Under ruling 3 the page is ungated, so `run()` passes `{ agencyVisit: "not-required" }`. That option is pinned as used exactly once (Task 3), and the Owner's agency-lists line discloses it. **The owner may veto:** the alternative is that a suggestion decided from the work list redirects the agency person to that account's chooser.
12. **C12.** For the agency, a non-UUID account id gets `notFound()` (page) or `null` (route) before the visit read. `ACCT/layout.tsx:37` already turns 22P02 into a 404, and the new uuid-typed call would have made it a 500.
13. **C13.** The summary has two sentences, "Opened …" and "Downloaded your customer list …". A download is never a counted thing that was opened.
14. **C14.** The header's total is `access_log_page`'s own `total`.
15. **C15.** The "ended" hint compares the newest visit start, read on the service client, with the app's clock.
16. **C16.** The setup project gets a fifth setup test, and `e2e/fixtures/entry-guards.test.ts:125-133` pins the names. `access-log.spec.ts` signs the agency in again to get a session with no visit.
17. **C17.** `x-bis-path` drops `_rsc`.
18. **C18.** 40 files under the two trees: 19 records, 21 not-records (listed in Task 11).
19. **C19.** The window's edge is exact under the transaction's fixed `now()`.

Two more choices of my own, not spec corrections:

20. **Routes log sequentially; pages log in parallel.** A route calls `noteOpenedApi` right after its proof and before its other reads, so a refused note proves that no data read ran. That costs one round trip per drawer card, and the cards load in parallel anyway. Pages put `noteOpened` inside their existing `Promise.all`. The page body returns no markup until that `Promise.all` settles, so the write still comes before any record data is rendered.
21. **The chooser's tiles are submit buttons, not `ChoiceTiles`.** `components/choice-tiles.tsx` is a radio group whose arrow keys change the selection. On a one-tap-submits screen, an arrow key would then start a visit. The tiles reuse its token recipe instead.

## File map

| File | Task | Responsibility |
|---|---|---|
| `packages/db/supabase/migrations/0105_access_log.sql` (new) | T1 | Two tables, indexes, RLS, grants, four functions, the window helper, rollback |
| `packages/db/src/test/access-log-schema.test.ts` (new) | T1 | `withRollback`: grants, append-only, RLS, window, functions, page, cascade, pins |
| `packages/db/src/access-log.ts` (new) | T1 | Constants, types, typed wrappers, `parseAccessLogPage` |
| `packages/db/src/test/access-log-wrappers.test.ts` (new) | T1 | Fake client: argument mapping, errors, shape parsing |
| `packages/db/src/test/access-log-live.test.ts` (new) | T1 | `withTestAccount`, CI only: wrappers through PostgREST, teardown leaves nothing |
| `packages/db/src/index.ts` | T1 | Additive exports |
| `packages/db/src/account-teardown.ts` | T1 | One comment paragraph only |
| `apps/web/src/lib/messages.ts`, `apps/web/src/lib/messages.test.ts` | T2 | Every `accessLog.*` key, EN + ES, and a copy guard |
| `apps/web/src/lib/access-log/paths.ts` (+`.test.ts`) (new) | T3 | `BIS_PATH_HEADER`, `accountPathOf`, `safeReturnPath`, `enterHref` (pure) |
| `apps/web/src/lib/access-log/gate.ts` (+`.test.ts`) (new) | T3 | `requireAgencyVisit`, `agencyVisitOk`, the `agencyVisit` pin |
| `apps/web/src/lib/access-log/note.ts` (+`.test.ts`) (new) | T3 | `noteOpened`, `noteOpenedApi` |
| `apps/web/src/lib/access-log/visit.ts` (+`.test.ts`) (new) | T3 | `startVisitForCaller`, `actorNameFor`, `lastVisitEndedRecently` |
| `apps/web/src/lib/auth.ts`, `apps/web/src/lib/auth.test.ts` | T3 | The gate and the `act` refusal in both guards |
| `apps/web/src/proxy.ts`, `apps/web/src/proxy.test.ts` | T3 | `x-bis-path` on account requests |
| `apps/web/src/lib/proposals/actions.ts:41`, `apps/web/src/lib/proposals/actions.test.ts:80` | T3 | The one `agencyVisit: "not-required"` |
| `ACCT/in-account-service-reads.test.ts` | T3 | Three `ALLOWED` entries |
| `apps/web/src/lib/access-log/view.ts` (+`.test.ts`) (new) | T4 | Pure: page + names → rows (labels, spans, summaries, items, links) |
| `apps/web/src/lib/access-log/names.ts` (+`.test.ts`) (new) | T4 | Resolve record names on the reader's request client |
| `apps/web/src/components/access-log/{reason-tiles,bis-access-frame,bis-access-list,bis-access-skeleton,bis-access-error}.tsx` (+tests) (new) | T4 | The chooser's tiles and the reader's pieces |
| `apps/web/src/app/(dashboard)/dashboard/styleguide/bis-access-demo.tsx` (new), `…/styleguide/page.tsx` | T4 | DoD: the new components on `/styleguide` |
| `ENTER/page.tsx`, `ENTER/actions.ts` (+tests) (new) | T5 | The chooser and `startVisitAction` |
| `apps/web/src/app/(dashboard)/dashboard/accounts/actions.ts` (+`.test.ts`) | T5 | A created or adopted company starts a Setup visit |
| `API/contacts/[contactId]/{summary,ai-summary,document-requests,document-requirements,documents,email,groups,places,relationships,texts}/route.ts`, `API/groups/[groupId]/{document-requests,documents,places}/route.ts`, and their 15 test files | T6 | `noteOpenedApi` after each proof |
| `ACCT/contacts/[contactId]/page.tsx`, `ACCT/groups/[groupId]/page.tsx`, `ACCT/contacts/documents-actions.ts`, `ACCT/forms/[formId]/page.tsx`, `ACCT/contacts/export/route.ts`, `ACCT/contacts/page.tsx`, their tests, and `ACCT/forms/[formId]/page.test.ts` (new) | T7 | `noteOpened` on the CRM pages, the file action and the export; Export becomes an anchor |
| `ACCT/calls/[callId]/page.tsx`, `ACCT/calls/[callId]/page.test.ts` | T8 | `noteOpened` on the call page |
| `ACCT/conversations/page.tsx` and its seven `page*.test.ts` files | T9 | `noteOpened` on an opened thread |
| `ACCT/team/page.tsx` (+`page.test.ts`), `apps/web/src/components/access-log/bis-access-section.tsx` (+test) (new), `apps/web/src/lib/palette/registry.ts` (+`registry.test.ts`) | T10 | The Team section and `nav:bis-access` |
| `ACCT/access-log-routes.test.ts` (new) | T11 | The route walk and the import allowlist |
| `apps/web/e2e/auth.setup.ts`, `apps/web/e2e/fixtures/entry-guards.test.ts`, `apps/web/e2e/access-log.spec.ts` (new), `apps/web/screenshots/capture.spec.ts` | T12 | Setup visits, the deep-link and Owner-read spec, the capture's visit |

## Task list and waves

| # | Title | Owner | Tier | Wave |
|---|---|---|---|---|
| T1 | Migration 0105, its schema tests and the typed wrappers | bis-db-schema | high | 1 |
| T2 | Every `accessLog.*` string, English and Spanish | bis-frontend | low | 1 |
| T3 | The gate, the writers, the path header and the `act` refusal | bis-platform | high | 2 |
| T4 | The reader's view, name resolver and components (+ styleguide) | bis-frontend | medium | 2 |
| T5 | The chooser page and `startVisitAction`; a new company starts a Setup visit | bis-platform | medium | 3 |
| T6 | The drawer and card routes log (13 routes) | bis-crm | medium | 3 |
| T7 | The contact and group pages, file opens, form answers and the export log; Export is an anchor | bis-crm | medium | 3 |
| T8 | The call page logs | bis-voice | medium | 3 |
| T9 | The inbox logs an opened conversation | bis-comms | medium | 3 |
| T10 | BIS access on the Team page, and ⌘K | bis-frontend | medium | 3 |
| T11 | The route walk: no unclassified page or route | bis-platform | medium | 4 |
| T12 | e2e: setup visits, the deep link and the Owner's read, the capture | bis-e2e-qa | medium | 4 |
| T13 | Whole-branch review, design review, apply order, merge | orchestrator (bis-reviewer opus, bis-design-reviewer) | high | 5 |

**Waves.** Wave 2 starts once T1 has passed its review, because T3 and T4 import its exports, and once T2 is committed (T4 reads the keys). Wave 3 needs T3 (`note.ts`, `visit.ts`, `paths.ts`, `gate.ts`) and T4 (`ReasonTiles`, the view, the list). Wave 4 needs every wave-3 task committed: T11's walk must start green, and T12 drives the finished UI. Two tasks in one wave never share a file. `messages.ts` has exactly one writer (T2, wave 1). `ACCT/in-account-service-reads.test.ts` has exactly one writer (T3). Two bis-crm agents run T6 and T7 side by side on disjoint files. **Push the branch after wave 3** so CI `verify` runs the whole suite (suite-wide counters and source scans only show up there). The `e2e` job's migration check fails naming 0105 until the orchestrator applies it to bis-ci; that red is expected.

---

## Shared facts every task relies on

### Interfaces produced by T1 (`packages/db/src/access-log.ts`, exported from `packages/db/src/index.ts`)

```ts
export const AGENCY_VISIT_REASONS = ["setup", "support", "fix", "billing"] as const;
export type AgencyVisitReason = (typeof AGENCY_VISIT_REASONS)[number];
export function isAgencyVisitReason(v: unknown): v is AgencyVisitReason;
export const ACCESS_LOG_KINDS = ["contact", "group", "call", "conversation", "document_view", "document_download", "form_answers", "customer_list_export"] as const;
export type AccessLogKind = (typeof ACCESS_LOG_KINDS)[number];
export type OpenedRef =
  | { kind: Exclude<AccessLogKind, "customer_list_export">; recordId: string }
  | { kind: "customer_list_export"; itemCount: number };
export const AGENCY_VISIT_HOURS = 2;          // mirrors app.agency_visit_window(); pinned by the schema test
export const ACCESS_LOG_PAGE_SIZE = 20;
export const ACCESS_LOG_ITEMS_SHOWN = 100;     // mirrors access_log_page's per-visit item cap
export type AgencyActor = { clerkUserId: string; sessionId: string };

export function startAgencyVisit(db: SupabaseClient, accountId: string, actor: AgencyActor & { name: string | null }, reason: AgencyVisitReason): Promise<string | null>; // null: no such account (23503)
export function agencyVisitLive(db: SupabaseClient, accountId: string, actor: AgencyActor): Promise<string | null>;
export function noteAgencyOpen(db: SupabaseClient, accountId: string, actor: AgencyActor, ref: OpenedRef): Promise<"ok" | "no_visit">;
export function newestAgencyVisitStart(db: SupabaseClient, accountId: string, actor: AgencyActor): Promise<string | null>;
export function readAgencyActorName(db: SupabaseClient, clerkUserId: string): Promise<{ name: string | null; email: string | null } | null>;

export type AccessLogCounts = { contact: number; group: number; call: number; conversation: number; file: number; form_answers: number; customer_list_export: number };
export type AccessLogItem = { kind: AccessLogKind; recordId: string | null; itemCount: number | null; firstOpenedAt: string };
export type AccessLogVisit = { id: string; actorName: string | null; reason: AgencyVisitReason; startedAt: string; endedAt: string | null; counts: AccessLogCounts; itemTotal: number; items: AccessLogItem[] };
export type AccessLogPage = { total: number; visits: AccessLogVisit[]; hasOlder: boolean };
export type AccessLogCursor = { startedAt: string; id: string };
export function readAccessLogPage(db: SupabaseClient, accountId: string, before: AccessLogCursor | null, limit?: number): Promise<AccessLogPage>;
export function parseAccessLogPage(raw: unknown, limit: number): AccessLogPage;
```

Every wrapper THROWS on an error, and on any answer it did not expect. The service-role wrappers take `serviceDb()`. `readAccessLogPage` takes the READER's request client (`dbForRequest()`), so RLS bounds it.

### Interfaces produced by T3 (`apps/web/src/lib/access-log/`)

```ts
// paths.ts (pure; imported by proxy.ts, so no server-only imports)
export const BIS_PATH_HEADER = "x-bis-path";
export function accountPathOf(url: { pathname: string; search: string }): string | null;
export function safeReturnPath(raw: unknown, accountId: string): string | null;
export function enterHref(accountId: string, to: string | null): string;
// gate.ts
export function requireAgencyVisit(accountId: string, clerkUserId: string, sessionId: string | null | undefined): Promise<void>; // redirects or notFound()s
export function agencyVisitOk(accountId: string, clerkUserId: string, sessionId: string | null | undefined): Promise<boolean>;
// note.ts
export type NoteAccess = { isAgency: boolean };
export function noteOpened(access: NoteAccess, accountId: string, ref: OpenedRef): Promise<void>;     // no visit: redirect to the chooser
export function noteOpenedApi(access: NoteAccess, accountId: string, ref: OpenedRef): Promise<boolean>; // no visit: false (the route answers 404)
// visit.ts
export function startVisitForCaller(accountId: string, reason: AgencyVisitReason): Promise<string | null>;
export function lastVisitEndedRecently(accountId: string, now?: Date): Promise<boolean>;
export function actorNameFor(clerkUserId: string): Promise<string | null>;
// lib/auth.ts
export type AccessOptions = { duringPause?: "allow"; agencyVisit?: "not-required" };
```

`noteOpened` and `noteOpenedApi` both throw when the write fails (ruling 4). For a client (`isAgency === false`) both return at once and make no call at all.

### Interfaces produced by T4

```ts
// lib/access-log/view.ts
export type AccessLogNames = {
  contacts: Map<string, { first: string | null; last: string | null; archived: boolean }>;
  groups: Map<string, { name: string; kind: "household" | "business" }>;
  calls: Map<string, { contactId: string | null; startedAt: string }>;
  conversations: Map<string, { contactId: string | null }>;
  documents: Map<string, { title: string; trashed: boolean; record: { kind: "contact" | "group"; id: string } | null }>;
  forms: Map<string, { name: string }>;
};
export type VisitItemView = { key: string; text: string; href: string | null };
export type VisitRowView = { id: string; label: string; when: string; summary: string; items: VisitItemView[]; more: string | null };
export function buildVisitRows(page: AccessLogPage, names: AccessLogNames, ctx: { tr: Tr; zone: string; base: string }): VisitRowView[];
export function visitSummary(counts: AccessLogCounts, tr: Tr): string;
export function visitSpan(startIso: string, endIso: string | null, zone: string, locale: Locale): string;
export function encodeAccessCursor(v: AccessLogVisit): string;
export function parseAccessCursor(raw: string | undefined): AccessLogCursor | null;
// lib/access-log/names.ts
export const NAME_CHUNK = 50;
export function resolveAccessLogNames(db: SupabaseClient, accountId: string, page: AccessLogPage): Promise<AccessLogNames>;
// components/access-log/*
export function ReasonTiles(props: { legend: string; options: readonly { value: AgencyVisitReason; label: string }[] }): JSX.Element; // server-safe, submit buttons name="reason"
export function BisAccessFrame(props: { children: React.ReactNode }): JSX.Element; // "use client"; <section id="bis-access">, title, intro, both notes; useLocale()
export function BisAccessList(props: { rows: VisitRowView[] }): JSX.Element;      // "use client"; expand and collapse per visit
export function BisAccessSkeleton(): JSX.Element;                                  // "use client"
export function BisAccessError(): JSX.Element;                                     // "use client"; ghost Try again, router.refresh()
```

### The 40 files the route walk classifies (C18)

**Records (19).** Each must call `noteOpened` (pages, the export) or `noteOpenedApi` (routes):
`ACCT/contacts/[contactId]/page.tsx`, `ACCT/groups/[groupId]/page.tsx`, `ACCT/calls/[callId]/page.tsx`, `ACCT/conversations/page.tsx`, `ACCT/forms/[formId]/page.tsx`, `ACCT/contacts/export/route.ts`, and the 13 routes `API/contacts/[contactId]/{ai-summary,document-requests,document-requirements,documents,email,groups,places,relationships,summary,texts}/route.ts` and `API/groups/[groupId]/{document-requests,documents,places}/route.ts`.

**Not records (21), with the reason the walk records:** `activity` (list), `automations` (settings), `billing` (settings), `branding` (settings), `calendar` (list), `calls` (list), `checklist` (agency work about the client), `contacts/import` (writes, shows no stored record), `contacts` (list), `dashboard` (totals), `documents` (list; opening a file is logged by the file action), `forms` (list), `pipeline` (list), `settings` (settings), `setup` (settings), `tasks` (list), `team` (settings; this section lives here), `voice/knowledge/[version]` (the business's own facts), `voice` (settings), `website` (settings), and `API/search/route.ts` (returns names like a list; opening a result is logged).

### Bare `@bis/db` and module mocks a task must update

| Test file | Why | Entry | Task |
|---|---|---|---|
| `apps/web/src/lib/auth.test.ts:16-20` (bare `@bis/db`) | the gate calls `agencyVisitLive` | `agencyVisitLive: (...a) => agencyVisitLive(...a)` | T3 |
| `apps/web/src/lib/auth.test.ts:12-14` (`next/navigation`) | the gate calls `notFound()` | `notFound: () => { throw new Error("NOT_FOUND"); }` | T3 |
| `apps/web/src/lib/proposals/actions.test.ts:80` | `run()` now passes the option | `toHaveBeenCalledWith("A", { agencyVisit: "not-required" })` | T3 |
| every test of a record surface (T6–T9 file lists) | the surface calls `noteOpened`/`noteOpenedApi` | `vi.mock("@/lib/access-log/note", …)` | T6–T9 |
| `apps/web/src/app/(dashboard)/dashboard/accounts/actions.test.ts:18-30` | the two actions call `startVisitForCaller` | `vi.mock("@/lib/access-log/visit", …)` | T5 |
| `ACCT/team/page.test.ts` | the page renders `BisAccessSection` | `vi.mock("@/components/access-log/bis-access-section", …)` | T10 |

### e2e locators a new control can collide with

- `[data-team-row]` (`staff-roles.spec.ts:234,263`) filters rows by name text. Visit rows use `data-bis-access-visit` and NEVER `data-team-row`.
- `getByRole("main")` scopes Team assertions (`staff-roles.spec.ts:226`). The new section is inside `<main>`. Its row names are "E2E Agency" and the fixture customer, never "E2E Client" or "E2E Staff", so the existing `filter({ hasText: "E2E Client" })` stays unique to the team rows.
- `getByRole("link", { name: "Export" })` (contacts specs) still finds the anchor: it stays a link with the same name.
- The chooser's buttons ("Setup", "Billing", …) render only on `/dashboard/enter/<id>`. Every existing "Setup" or "Billing" locator is scoped to a sidebar, a palette, or a Staff page (`calls.spec.ts:237`, `setup.spec.ts:912`, `palette.spec.ts:222`, `staff-roles.spec.ts:119`).
- Palette queries in `palette.spec.ts` (`cal`, `call`, `custom fields`, a contact's name, nonsense): none is a substring of "BIS access" or its keywords.

---

### Task 1: Migration 0105, its schema tests and the typed wrappers

**Tier:** high · **Owner:** bis-db-schema · **Wave:** 1 · **Scratch:** `SCRATCH\al-t1`, replica port **55851**

**Files:**
- Create: `packages/db/supabase/migrations/0105_access_log.sql`
- Create: `packages/db/src/test/access-log-schema.test.ts` (withRollback; replica and CI)
- Create: `packages/db/src/access-log.ts`
- Create: `packages/db/src/test/access-log-wrappers.test.ts` (fake client; local)
- Create: `packages/db/src/test/access-log-live.test.ts` (withTestAccount; CI only)
- Modify: `packages/db/src/index.ts` (one additive `export { … } from "./access-log";` block, after the `./calendar-feeds` block at `:119-123`)
- Modify: `packages/db/src/account-teardown.ts` (comment block after `:46`, one paragraph; the LIST does not change)
- Create (scratch, not committed): `SCRATCH\al-t1\pg-al.sh`, `SCRATCH\al-t1\mutants\*.sql`

**Interfaces:** Produces everything under "Interfaces produced by T1" above. Consumes nothing.

- [ ] **Step 1: Build the replica (pre = 0001–0104).** Write `SCRATCH/al-t1/pg-al.sh`. It is the calendar-feed lane's script (`…88d51cd6…/scratchpad/cf-t1/pg17-cf.sh`) with these changes: `D=$S/al-t1`, port `55851`, `W=/c/Users/danlo/bis-platform/.claude/worktrees/access-log`; `init` applies EVERY file in `$W/packages/db/supabase/migrations` except `0105_*`, and no branch file; `post [FILE]` applies `${2:-$M/0105_access_log.sql}`. Keep its bootstrap block exactly (the three roles, the schemas, the `storage.buckets` stub, and the default privileges for tables, sequences and functions in `public` and `app`). Run `sh pg-al.sh init`. Expected last line: `pre = 0001-0104 on 17.6` (or `18.x` if you had to fall back).

- [ ] **Step 2: Write the failing schema test.** Create `packages/db/src/test/access-log-schema.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { Client } from "pg";
import { withRollback, actAs, actAsMember, actAsOwner } from "./db";
import { ACCOUNT_OWNED_TABLES } from "../account-teardown";
import { AGENCY_VISIT_HOURS } from "../access-log";

/**
 * 0105_access_log.sql (F-118 part 1). Every database case runs in a rolled-back transaction, so this file
 * runs on the local replica and in CI verify. RED BEFORE APPLY: every database case names an object 0105
 * creates. now() is fixed for the whole transaction, which is what lets the window's edge be tested exactly.
 */
const RUN = Math.random().toString(36).slice(2, 10);
const ACTOR = `user_agency_${RUN}`;
const SESSION = `sess_${RUN}`;
type Acct = { accountId: string; orgId: string };
type Who = { actor?: string; session?: string; reason?: string; name?: string | null };

async function seedAccount(c: Client, label: string): Promise<Acct> {
  await actAsOwner(c);
  const orgId = `org_access_${label}_${RUN}`;
  const { rows: [agency] } = await c.query<{ id: string }>("insert into public.agencies (name) values ('Access log') returning id");
  const { rows: [account] } = await c.query<{ id: string }>(
    `insert into public.accounts (agency_id, clerk_org_id, name, client_access_enabled)
     values ($1, $2, 'Access log test', true) returning id`, [agency!.id, orgId]);
  return { accountId: account!.id, orgId };
}
async function refusal(c: Client, sql: string, params: unknown[] = []): Promise<{ code?: string; message: string } | null> {
  await c.query("savepoint probe");
  try { await c.query(sql, params); await c.query("release savepoint probe"); return null; }
  catch (e) { await c.query("rollback to savepoint probe"); const err = e as { code?: string; message: string }; return { code: err.code, message: err.message }; }
}
/** As service_role, the only role the three writers are granted to. NOT actAsOwner: that bypasses grants. */
async function asService<T>(c: Client, fn: () => Promise<T>): Promise<T> {
  await actAsOwner(c);
  await c.query("set local role service_role");
  try { return await fn(); } finally { await c.query("reset role"); }
}
const start = (c: Client, accountId: string, w: Who = {}) => asService(c, async () =>
  (await c.query<{ id: string }>("select public.start_agency_visit($1, $2, $3, $4, $5) as id",
    [accountId, w.actor ?? ACTOR, w.name === undefined ? "Dan Lopez" : w.name, w.session ?? SESSION, w.reason ?? "support"])).rows[0]!.id);
const live = (c: Client, accountId: string, w: Who = {}) => asService(c, async () =>
  (await c.query<{ id: string | null }>("select public.agency_visit_live($1, $2, $3) as id",
    [accountId, w.actor ?? ACTOR, w.session ?? SESSION])).rows[0]!.id);
const note = (c: Client, accountId: string, kind: string, recordId: string | null, count: number | null = null, w: Who = {}) =>
  asService(c, async () => (await c.query<{ r: string }>("select public.note_agency_open($1, $2, $3, $4, $5, $6) as r",
    [accountId, w.actor ?? ACTOR, w.session ?? SESSION, kind, recordId, count])).rows[0]!.r);
/** A visit with a chosen start, written as the table owner: the only way to set started_at. */
async function visitAt(c: Client, accountId: string, ago: string, w: Who = {}): Promise<string> {
  await actAsOwner(c);
  return (await c.query<{ id: string }>(
    `insert into public.agency_visits (account_id, actor_clerk_user_id, actor_name, clerk_session_id, reason, started_at)
     values ($1, $2, 'Dan Lopez', $3, $4, now() - $5::interval) returning id`,
    [accountId, w.actor ?? ACTOR, w.session ?? SESSION, w.reason ?? "support", ago])).rows[0]!.id;
}
async function itemAt(c: Client, visitId: string, accountId: string, kind: string, recordId: string | null, ago: string, count: number | null = null) {
  await actAsOwner(c);
  await c.query(
    `insert into public.agency_visit_items (visit_id, account_id, kind, record_id, item_count, first_opened_at)
     values ($1, $2, $3, $4, $5, now() - $6::interval)`, [visitId, accountId, kind, recordId, count, ago]);
}
const uuid = async (c: Client) => (await c.query<{ u: string }>("select gen_random_uuid()::text as u")).rows[0]!.u;
const itemCount = async (c: Client, accountId: string) => {
  await actAsOwner(c);
  return (await c.query<{ n: number }>("select count(*)::int as n from public.agency_visit_items where account_id = $1", [accountId])).rows[0]!.n;
};
```

Then these `describe` blocks, each `it` wrapped in `withRollback(async (c) => { … })` unless marked pure. Every test name carries its mutation, and every mutation is run in Step 6:

```ts
describe("0105: grants make both tables append-only", () => {
  it("table privileges: authenticated and service_role SELECT, nothing else for any role, MAINTAIN included (mutation: drop service_role from the revoke-all line -> FAILS)", () =>
    withRollback(async (c) => {
      const { rows } = await c.query(
        `select r, t, p from unnest(array['anon','authenticated','service_role']) r
           cross join unnest(array['public.agency_visit_items','public.agency_visits']) t
           cross join unnest(array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER','MAINTAIN']) p
          where has_table_privilege(r, t, p) order by 1, 2, 3`);
      expect(rows).toEqual([
        { r: "authenticated", t: "public.agency_visit_items", p: "SELECT" },
        { r: "authenticated", t: "public.agency_visits", p: "SELECT" },
        { r: "service_role", t: "public.agency_visit_items", p: "SELECT" },
        { r: "service_role", t: "public.agency_visits", p: "SELECT" },
      ]);
    }));

  it("column INSERT: service_role on exactly these ten columns, so started_at and first_opened_at stay the database's clock (mutation: add started_at to the grant -> FAILS)", () =>
    withRollback(async (c) => {
      const { rows } = await c.query(
        `select r, cl.relname || '.' || a.attname as col
           from unnest(array['anon','authenticated','service_role']) r
           cross join pg_class cl join pg_namespace n on n.oid = cl.relnamespace
           join pg_attribute a on a.attrelid = cl.oid and a.attnum > 0 and not a.attisdropped
          where n.nspname = 'public' and cl.relname in ('agency_visits','agency_visit_items')
            and has_column_privilege(r, cl.oid, a.attnum, 'INSERT') order by 1, 2`);
      expect(rows).toEqual([
        "agency_visit_items.account_id", "agency_visit_items.item_count", "agency_visit_items.kind",
        "agency_visit_items.record_id", "agency_visit_items.visit_id",
        "agency_visits.account_id", "agency_visits.actor_clerk_user_id", "agency_visits.actor_name",
        "agency_visits.clerk_session_id", "agency_visits.reason",
      ].map((col) => ({ r: "service_role", col })));
    }));

  it("as service_role: UPDATE and DELETE are refused 42501, and so is an INSERT naming started_at (mutation: grant update (reason) on agency_visits to service_role -> FAILS)", () =>
    withRollback(async (c) => {
      const a = await seedAccount(c, "ro");
      const v = await start(c, a.accountId);
      await note(c, a.accountId, "contact", await uuid(c));
      await actAsOwner(c);
      await c.query("set local role service_role");
      expect((await refusal(c, "update public.agency_visits set reason = 'billing' where id = $1", [v]))?.code).toBe("42501");
      expect((await refusal(c, "delete from public.agency_visit_items where visit_id = $1", [v]))?.code).toBe("42501");
      expect((await refusal(c,
        `insert into public.agency_visits (account_id, actor_clerk_user_id, clerk_session_id, reason, started_at)
         values ($1, 'x', 'y', 'setup', now() - interval '1 day')`, [a.accountId]))?.code).toBe("42501");
      await c.query("reset role");
    }));
});

describe("0105: row level security", () => {
  it("is on for both tables, with exactly one permissive SELECT policy each, to authenticated (mutation: disable row level security on agency_visit_items -> FAILS)", () =>
    withRollback(async (c) => {
      const { rows: rls } = await c.query(
        "select relname, relrowsecurity from pg_class where oid in ('public.agency_visits'::regclass, 'public.agency_visit_items'::regclass) order by 1");
      expect(rls).toEqual([{ relname: "agency_visit_items", relrowsecurity: true }, { relname: "agency_visits", relrowsecurity: true }]);
      const { rows: pol } = await c.query(
        `select tablename, policyname, permissive, cmd, roles::text as roles from pg_policies
          where schemaname = 'public' and tablename in ('agency_visits','agency_visit_items') order by 1, 2`);
      expect(pol).toEqual([
        { tablename: "agency_visit_items", policyname: "agency_visit_items_read", permissive: "PERMISSIVE", cmd: "SELECT", roles: "{authenticated}" },
        { tablename: "agency_visits", policyname: "agency_visits_read", permissive: "PERMISSIVE", cmd: "SELECT", roles: "{authenticated}" },
      ]);
    }));

  it("an Owner of A reads A's visits and items; Staff and a Technician of A, and an Owner of B, read none of A's; the agency reads both accounts; A's Owner with client access off reads none (mutations: drop the Owner clause -> the Staff case FAILS; drop the account clause -> the B Owner case FAILS)", () =>
    withRollback(async (c) => {
      const a = await seedAccount(c, "rlsA");
      const b = await seedAccount(c, "rlsB");
      const va = await visitAt(c, a.accountId, "10 minutes");
      await visitAt(c, b.accountId, "10 minutes");
      await itemAt(c, va, a.accountId, "contact", await uuid(c), "5 minutes");
      const seenOfA = async () => (await c.query<{ v: number; i: number }>(
        `select (select count(*)::int from public.agency_visits where account_id = $1) as v,
                (select count(*)::int from public.agency_visit_items where account_id = $1) as i`, [a.accountId])).rows[0];
      await actAsMember(c, a.accountId, a.orgId, "owner");
      expect(await seenOfA()).toEqual({ v: 1, i: 1 });
      for (const role of ["staff", "technician"] as const) {
        await actAsOwner(c);
        await actAsMember(c, a.accountId, a.orgId, role);
        expect(await seenOfA(), role).toEqual({ v: 0, i: 0 });
      }
      await actAsOwner(c);
      await actAsMember(c, b.accountId, b.orgId, "owner");
      expect(await seenOfA()).toEqual({ v: 0, i: 0 });
      // Positive control for the B case: B's Owner does see B's own visit.
      expect((await c.query("select 1 from public.agency_visits where account_id = $1", [b.accountId])).rowCount).toBe(1);
      await actAsOwner(c);
      await actAs(c, { app_role: "agency_admin", sub: ACTOR });
      expect((await c.query("select 1 from public.agency_visits where account_id = any($1::uuid[])", [[a.accountId, b.accountId]])).rowCount).toBe(2);
      await actAsOwner(c);
      await c.query("update public.accounts set client_access_enabled = false where id = $1", [a.accountId]);
      await actAsMember(c, a.accountId, a.orgId, "owner");
      expect(await seenOfA()).toEqual({ v: 0, i: 0 });
    }));
});

describe("0105: a visit is live for two hours from its start, for its own person, session and account", () => {
  it("a visit started exactly two hours ago is NOT live; one started two hours less a microsecond ago is (mutations: `>` -> `>=` FAILS; a 3-hour window FAILS)", () =>
    withRollback(async (c) => {
      const a = await seedAccount(c, "edge");
      await visitAt(c, a.accountId, "2 hours", { session: "s_edge" });
      const inside = await visitAt(c, a.accountId, "2 hours", { session: "s_in" });
      await actAsOwner(c);
      await c.query("update public.agency_visits set started_at = started_at + interval '1 microsecond' where id = $1", [inside]);
      expect(await live(c, a.accountId, { session: "s_edge" })).toBeNull();
      expect(await live(c, a.accountId, { session: "s_in" })).toBe(inside);
    }));

  it("another session, another account and another person are not live (mutations: drop the session filter, the account filter or the actor filter from agency_visit_live -> FAILS)", () =>
    withRollback(async (c) => {
      const a = await seedAccount(c, "who");
      const b = await seedAccount(c, "whoB");
      const v = await visitAt(c, a.accountId, "1 minute");
      expect(await live(c, a.accountId)).toBe(v);
      expect(await live(c, a.accountId, { session: "sess_other" })).toBeNull();
      expect(await live(c, b.accountId)).toBeNull();
      expect(await live(c, a.accountId, { actor: "user_other" })).toBeNull();
    }));
});

describe("0105: start_agency_visit", () => {
  it("twice in the window answers the SAME visit, keeping the first reason; after the window a NEW one (mutation: always insert -> FAILS)", () =>
    withRollback(async (c) => {
      const a = await seedAccount(c, "start");
      const first = await start(c, a.accountId, { reason: "support" });
      expect(await start(c, a.accountId, { reason: "billing" })).toBe(first);
      await actAsOwner(c);
      expect((await c.query("select reason from public.agency_visits where id = $1", [first])).rows[0]).toEqual({ reason: "support" });
      const old = await visitAt(c, a.accountId, "3 hours", { session: "s_old" });
      const fresh = await start(c, a.accountId, { session: "s_old" });
      expect(fresh).not.toBe(old);
      expect(await live(c, a.accountId, { session: "s_old" })).toBe(fresh);
    }));

  it("a blank name is stored as NULL, and a missing account, a missing argument and an unknown reason are refused (mutations: drop nullif(btrim(...)) -> FAILS; drop the null check -> FAILS)", () =>
    withRollback(async (c) => {
      const a = await seedAccount(c, "args");
      const v = await start(c, a.accountId, { name: "   " });
      await actAsOwner(c);
      expect((await c.query("select actor_name from public.agency_visits where id = $1", [v])).rows[0]).toEqual({ actor_name: null });
      await c.query("set local role service_role");
      const call = "select public.start_agency_visit($1, $2, 'Dan', $3, $4)";
      expect((await refusal(c, call, ["00000000-0000-4000-8000-000000000000", ACTOR, "s_x", "setup"]))?.code).toBe("23503");
      expect((await refusal(c, call, [a.accountId, null, "s_x", "setup"]))?.code).toBe("22004");
      expect((await refusal(c, call, [a.accountId, ACTOR, "s_y", "curious"]))?.code).toBe("23514");
      await c.query("reset role");
    }));
});

describe("0105: note_agency_open", () => {
  it("one row per record per visit; two records two rows; every export its own row; a new visit logs the same record again (mutation: drop agency_visit_items_once or its on-conflict clause -> FAILS)", () =>
    withRollback(async (c) => {
      const a = await seedAccount(c, "once");
      await start(c, a.accountId);
      const x = await uuid(c);
      const y = await uuid(c);
      expect(await note(c, a.accountId, "contact", x)).toBe("ok");
      expect(await note(c, a.accountId, "contact", x)).toBe("ok");
      expect(await itemCount(c, a.accountId)).toBe(1);
      await note(c, a.accountId, "contact", y);
      await note(c, a.accountId, "group", x);   // same id, another kind: its own row
      expect(await itemCount(c, a.accountId)).toBe(3);
      await note(c, a.accountId, "customer_list_export", null, 10);
      await note(c, a.accountId, "customer_list_export", null, 12);
      expect(await itemCount(c, a.accountId)).toBe(5);
      await start(c, a.accountId, { session: "s_two" });
      await note(c, a.accountId, "contact", x, null, { session: "s_two" });
      expect(await itemCount(c, a.accountId)).toBe(6);
    }));

  it("no live visit answers no_visit and writes nothing; a live visit on A never covers a note for B (mutation: look the visit up by actor and session only -> FAILS)", () =>
    withRollback(async (c) => {
      const a = await seedAccount(c, "nov");
      const b = await seedAccount(c, "novB");
      expect(await note(c, a.accountId, "contact", await uuid(c))).toBe("no_visit");
      expect(await itemCount(c, a.accountId)).toBe(0);
      await start(c, a.accountId);
      expect(await note(c, b.accountId, "contact", await uuid(c))).toBe("no_visit");
      expect(await itemCount(c, a.accountId)).toBe(0);
      expect(await itemCount(c, b.accountId)).toBe(0);
    }));

  it("an export with no count, a record kind with no id and an unknown kind are refused 23514 (mutation: drop agency_visit_items_export_count_check -> FAILS)", () =>
    withRollback(async (c) => {
      const a = await seedAccount(c, "chk");
      await start(c, a.accountId);
      await actAsOwner(c);
      await c.query("set local role service_role");
      const call = "select public.note_agency_open($1, $2, $3, $4, $5, $6)";
      expect((await refusal(c, call, [a.accountId, ACTOR, SESSION, "customer_list_export", null, null]))?.code).toBe("23514");
      expect((await refusal(c, call, [a.accountId, ACTOR, SESSION, "contact", null, null]))?.code).toBe("23514");
      expect((await refusal(c, call, [a.accountId, ACTOR, SESSION, "peek", "00000000-0000-4000-8000-000000000001", null]))?.code).toBe("23514");
      await c.query("reset role");
    }));
});

describe("0105: who may call what", () => {
  it("EXECUTE: service_role the three writers and the window, authenticated the reader only, anon nothing; every function an invoker ending its search_path in pg_temp (mutation: drop `public` from a revoke line -> FAILS)", () =>
    withRollback(async (c) => {
      const FNS = ["public.start_agency_visit(uuid,text,text,text,text)", "public.agency_visit_live(uuid,text,text)",
        "public.note_agency_open(uuid,text,text,text,uuid,integer)", "public.access_log_page(uuid,timestamptz,uuid,integer)",
        "app.agency_visit_window()"];
      const { rows } = await c.query(
        `select r, f from unnest(array['anon','authenticated','service_role']) r cross join unnest($1::text[]) f
          where has_function_privilege(r, f, 'EXECUTE') order by 1, 2`, [FNS]);
      expect(rows).toEqual([
        { r: "authenticated", f: "public.access_log_page(uuid,timestamptz,uuid,integer)" },
        { r: "service_role", f: "app.agency_visit_window()" },
        { r: "service_role", f: "public.agency_visit_live(uuid,text,text)" },
        { r: "service_role", f: "public.note_agency_open(uuid,text,text,text,uuid,integer)" },
        { r: "service_role", f: "public.start_agency_visit(uuid,text,text,text,text)" },
      ]);
      const { rows: cfg } = await c.query(
        "select p.oid::regprocedure::text as f, p.prosecdef as d, p.proconfig as cfg from pg_proc p where p.oid = any($1::regprocedure[]) order by 1", [FNS]);
      for (const r of cfg) expect(r, r.f).toMatchObject({ d: false, cfg: ["search_path=pg_catalog, pg_temp"] });
      expect(cfg).toHaveLength(FNS.length);
    }));
});

describe("0105: access_log_page", () => {
  it("newest first, limit + 1 rows, the real total, counts with a file counted once across view and download, ended_at, items newest first and capped at 100, and the cursor (mutations: count(distinct record_id) -> count(*) FAILS; drop the item limit FAILS; `<` -> `<=` FAILS; `limit p_limit + 1` -> `limit p_limit` FAILS)", () =>
    withRollback(async (c) => {
      const a = await seedAccount(c, "page");
      const b = await seedAccount(c, "pageB");
      await visitAt(c, b.accountId, "30 minutes");       // B's, never in A's page
      const oldest = await visitAt(c, a.accountId, "3 hours", { session: "s1" });
      const middle = await visitAt(c, a.accountId, "2 hours", { session: "s2" });
      const newest = await visitAt(c, a.accountId, "1 hour", { session: "s3" });
      const d1 = await uuid(c); const d2 = await uuid(c); const x = await uuid(c);
      await itemAt(c, newest, a.accountId, "document_view", d1, "50 minutes");
      await itemAt(c, newest, a.accountId, "document_download", d1, "49 minutes");
      await itemAt(c, newest, a.accountId, "document_view", d2, "48 minutes");
      await itemAt(c, newest, a.accountId, "contact", x, "47 minutes");
      await itemAt(c, newest, a.accountId, "customer_list_export", null, "46 minutes", 12);
      await actAsOwner(c);
      await c.query(
        `insert into public.agency_visit_items (visit_id, account_id, kind, record_id, first_opened_at)
         select $1, $2, 'contact', gen_random_uuid(), now() - interval '110 minutes' + (g || ' seconds')::interval
           from generate_series(1, 101) g`, [middle, a.accountId]);
      await actAsMember(c, a.accountId, a.orgId, "owner");
      const page = async (before: [string, string] | null, limit: number) =>
        (await c.query("select public.access_log_page($1, $2, $3, $4) as p", [a.accountId, before?.[0] ?? null, before?.[1] ?? null, limit])).rows[0].p;
      const p1 = await page(null, 2);
      expect(p1.total).toBe(3);
      expect(p1.visits.map((v: { id: string }) => v.id)).toEqual([newest, middle, oldest]);
      expect(p1.visits[0].counts).toEqual({ contact: 1, group: 0, call: 0, conversation: 0, file: 2, form_answers: 0, customer_list_export: 1 });
      expect(p1.visits[0].items[0]).toMatchObject({ kind: "customer_list_export", record_id: null, item_count: 12 });
      expect(p1.visits[0].ended_at).not.toBeNull();
      expect(p1.visits[1].items).toHaveLength(100);
      expect(p1.visits[1].item_total).toBe(101);
      expect(p1.visits[2].ended_at).toBeNull();
      expect(p1.visits[2].items).toEqual([]);
      const p2 = await page([p1.visits[1].started_at, middle], 2);
      expect(p2.visits.map((v: { id: string }) => v.id)).toEqual([oldest]);
      for (const bad of [0, 51]) expect((await refusal(c, "select public.access_log_page($1, null, null, $2)", [a.accountId, bad]))?.code).toBe("22023");
      await actAsOwner(c);
      await actAsMember(c, a.accountId, a.orgId, "staff");
      expect(await page(null, 20)).toEqual({ total: 0, visits: [] });
    }));
});

describe("0105: the account's own delete carries the log away", () => {
  it("as service_role, deleting the account removes its visits and items; another account's survive (mutation: agency_visits.account_id on delete restrict -> FAILS)", () =>
    withRollback(async (c) => {
      const a = await seedAccount(c, "gone");
      const b = await seedAccount(c, "stay");
      const va = await visitAt(c, a.accountId, "5 minutes");
      const vb = await visitAt(c, b.accountId, "5 minutes");
      await itemAt(c, va, a.accountId, "contact", await uuid(c), "1 minute");
      await itemAt(c, vb, b.accountId, "contact", await uuid(c), "1 minute");
      await asService(c, () => c.query("delete from public.accounts where id = $1", [a.accountId]));
      await actAsOwner(c);
      const { rows } = await c.query(
        `select (select count(*)::int from public.agency_visits where account_id = $1) as av,
                (select count(*)::int from public.agency_visit_items where account_id = $1) as ai,
                (select count(*)::int from public.agency_visits where account_id = $2) as bv,
                (select count(*)::int from public.agency_visit_items where account_id = $2) as bi`, [a.accountId, b.accountId]);
      expect(rows[0]).toEqual({ av: 0, ai: 0, bv: 1, bi: 1 });
    }));

  it("(pure) neither table is on ACCOUNT_OWNED_TABLES: service_role holds no DELETE, so a listed delete would fail every teardown (mutation: add agency_visits to the list -> FAILS)", () => {
    const listed = ACCOUNT_OWNED_TABLES as readonly string[];
    expect(listed.includes("agency_visits")).toBe(false);
    expect(listed.includes("agency_visit_items")).toBe(false);
    expect(listed.includes("calls")).toBe(true); // the real list, not an empty import
  });

  it("(pure) AGENCY_VISIT_HOURS is the window 0105 declares (mutation: set the constant to 3 -> FAILS)", () => {
    const sql = readFileSync(fileURLToPath(new URL("../../supabase/migrations/0105_access_log.sql", import.meta.url)), "utf8");
    const body = sql.slice(sql.indexOf("create function app.agency_visit_window"));
    expect(body.match(/select interval '(\d+) hours'/)?.[1]).toBe(String(AGENCY_VISIT_HOURS));
  });
});
```

The pure cases import `../access-log`. Create that file now with only `export const AGENCY_VISIT_HOURS = 2;` (Step 4 fills in the rest), so the red in Step 3 is the database's red and not an import error.

- [ ] **Step 3: Run it on `pre`. Every database case must fail.** `cd packages/db && SUPABASE_DB_URL=postgresql://postgres@localhost:55851/pre pnpm exec vitest run src/test/access-log-schema.test.ts > "$D/vt-pre.txt" 2>&1; echo $? > "$D/vt-pre.exit"` (with `D=SCRATCH/al-t1`). Paste the summary line and one red line (expected: `function public.start_agency_visit(...) does not exist` / `relation "public.agency_visits" does not exist`). The three pure cases pass on `pre`, and that is correct.

- [ ] **Step 4: Write the migration and the wrappers.** Create `packages/db/supabase/migrations/0105_access_log.sql`. It must be ASCII only, with no backslash anywhere:

```sql
-- 0105_access_log.sql - see when BIS looked (F-118 part 1)
-- (docs/superpowers/specs/2026-10-29-access-log-design.md sections 3 to 5;
--  docs/superpowers/plans/2026-10-29-access-log.md, Task 1)
--
-- WHAT. public.agency_visits: one row each time a BIS (agency) person chooses a reason before entering an
-- account. A visit is live for app.agency_visit_window() (two hours) from its started_at, for the same Clerk
-- user, the same Clerk session and the same account; nothing extends it. public.agency_visit_items: one row
-- per record opened per visit (the first time), or per customer-list download. Ids only, never customer
-- data: the reader resolves names under its own RLS. record_id has no foreign key on purpose: the log
-- outlives the record.
-- APPEND-ONLY BY GRANTS (0054's shape). After this file no role holds UPDATE, DELETE, TRUNCATE, REFERENCES,
-- TRIGGER or MAINTAIN on either table; service_role inserts only the named columns, so started_at and
-- first_opened_at are always the database's own now(). Rows leave only with their account, through
-- on delete cascade, which runs as the table owner. Neither table is on ACCOUNT_OWNED_TABLES (consent_events'
-- reason): the teardown's per-table delete would be refused. The owner role itself is not bound by grants
-- (the trust pack says so).
-- WHO READS. authenticated, under RLS: the agency, or this account's Owner while client access is on
-- (0066's expression, each call in an InitPlan). Staff, Technicians and every other account read nothing.
-- FUNCTIONS. All SECURITY INVOKER, set search_path = pg_catalog, pg_temp (0096's rule), names schema-
-- qualified; EXECUTE revoked from public, anon, authenticated and service_role by name (0043's lesson), then
-- granted: start_agency_visit, agency_visit_live, note_agency_open and app.agency_visit_window to
-- service_role; access_log_page to authenticated (RLS bounds it). No definer, so EXPECTED_DEFINERS in
-- definer-search-path.test.ts does not change.
-- LOCKS. Two new, empty tables. The foreign key to accounts takes SHARE ROW EXCLUSIVE on public.accounts for
-- the few milliseconds this file runs; lock_timeout 5s bounds the wait.
-- APPLY ORDER: CI project (ci-project-setup.yml: push-dry-run, then push), then production (MCP
-- apply_migration, once), then the parity check, then merge. Additive: the build before this file never
-- reads it; the build after it calls these functions on every agency request, so it goes BEFORE the deploy.
--
-- Rollback (by hand, in this order; revert the app first). IT DESTROYS THE LOG:
--   drop function public.access_log_page(uuid, timestamptz, uuid, integer);
--   drop function public.note_agency_open(uuid, text, text, text, uuid, integer);
--   drop function public.start_agency_visit(uuid, text, text, text, text);
--   drop function public.agency_visit_live(uuid, text, text);
--   drop function app.agency_visit_window();
--   drop table public.agency_visit_items, public.agency_visits;
--
-- ASCII only, no backslash anywhere.

do $$
begin
  perform pg_catalog.set_config('lock_timeout', '5s', true);
end $$;

create table public.agency_visits (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  actor_kind text not null default 'agency'
    constraint agency_visits_actor_kind_check check (actor_kind in ('agency')),
  actor_clerk_user_id text not null constraint agency_visits_actor_check check (btrim(actor_clerk_user_id) <> ''),
  actor_name text constraint agency_visits_actor_name_check
    check (actor_name is null or char_length(btrim(actor_name)) between 1 and 200),
  clerk_session_id text not null constraint agency_visits_session_check check (btrim(clerk_session_id) <> ''),
  reason text not null constraint agency_visits_reason_check check (reason in ('setup', 'support', 'fix', 'billing')),
  started_at timestamptz not null default now(),
  constraint agency_visits_id_account_key unique (id, account_id)
);
create index agency_visits_page on public.agency_visits (account_id, started_at desc, id desc);
create index agency_visits_live on public.agency_visits (actor_clerk_user_id, clerk_session_id, account_id, started_at desc);
comment on table public.agency_visits is
  'F-118 (0105): one row per reason a BIS person chose before entering an account. Append-only by grants.';

create table public.agency_visit_items (
  id uuid primary key default gen_random_uuid(),
  visit_id uuid not null,
  account_id uuid not null,
  kind text not null constraint agency_visit_items_kind_check check (kind in (
    'contact', 'group', 'call', 'conversation', 'document_view', 'document_download', 'form_answers',
    'customer_list_export')),
  record_id uuid,
  item_count integer constraint agency_visit_items_item_count_check check (item_count is null or item_count >= 0),
  first_opened_at timestamptz not null default now(),
  constraint agency_visit_items_record_check check ((kind = 'customer_list_export') = (record_id is null)),
  constraint agency_visit_items_export_count_check check ((kind = 'customer_list_export') = (item_count is not null)),
  constraint agency_visit_items_visit_fkey foreign key (visit_id, account_id)
    references public.agency_visits (id, account_id) on delete cascade
);
create unique index agency_visit_items_once on public.agency_visit_items (visit_id, kind, record_id)
  where record_id is not null;
create index agency_visit_items_visit on public.agency_visit_items (visit_id, first_opened_at desc);
comment on table public.agency_visit_items is
  'F-118 (0105): each record a visit opened (first time only) and each customer-list download. Ids only.';

alter table public.agency_visits enable row level security;
alter table public.agency_visit_items enable row level security;
create policy agency_visits_read on public.agency_visits for select to authenticated
  using ((select coalesce(app.is_agency(), false))
         or (account_id = (select app.current_account_id())
             and (select app.is_account_owner(app.current_account_id()))));
create policy agency_visit_items_read on public.agency_visit_items for select to authenticated
  using ((select coalesce(app.is_agency(), false))
         or (account_id = (select app.current_account_id())
             and (select app.is_account_owner(app.current_account_id()))));

revoke all on public.agency_visits, public.agency_visit_items from anon, authenticated, service_role;
grant select on public.agency_visits, public.agency_visit_items to authenticated, service_role;
grant insert (account_id, actor_clerk_user_id, actor_name, clerk_session_id, reason)
  on public.agency_visits to service_role;
grant insert (visit_id, account_id, kind, record_id, item_count)
  on public.agency_visit_items to service_role;

create function app.agency_visit_window() returns interval
language sql immutable set search_path = pg_catalog, pg_temp as $$
  select interval '2 hours'
$$;

create function public.agency_visit_live(p_account_id uuid, p_actor text, p_session text)
returns uuid language sql stable security invoker set search_path = pg_catalog, pg_temp as $$
  select v.id from public.agency_visits v
   where v.actor_clerk_user_id = p_actor and v.clerk_session_id = p_session and v.account_id = p_account_id
     and v.started_at > pg_catalog.now() - app.agency_visit_window()
   order by v.started_at desc, v.id desc
   limit 1
$$;

create function public.start_agency_visit(
  p_account_id uuid, p_actor text, p_actor_name text, p_session text, p_reason text)
returns uuid language plpgsql security invoker set search_path = pg_catalog, pg_temp as $$
declare v_id uuid;
begin
  if p_account_id is null or p_actor is null or p_session is null or p_reason is null then
    raise exception 'start_agency_visit: a required argument is null' using errcode = '22004';
  end if;
  -- Two taps, or two tabs, make one visit.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_actor || '|' || p_session || '|' || p_account_id::text, 0));
  v_id := public.agency_visit_live(p_account_id, p_actor, p_session);
  if v_id is not null then return v_id; end if;
  insert into public.agency_visits (account_id, actor_clerk_user_id, actor_name, clerk_session_id, reason)
  values (p_account_id, p_actor, nullif(pg_catalog.btrim(p_actor_name), ''), p_session, p_reason)
  returning id into v_id;
  return v_id;
end $$;

create function public.note_agency_open(
  p_account_id uuid, p_actor text, p_session text, p_kind text, p_record_id uuid, p_item_count integer)
returns text language plpgsql security invoker set search_path = pg_catalog, pg_temp as $$
declare v_visit uuid;
begin
  if p_account_id is null or p_actor is null or p_session is null or p_kind is null then
    raise exception 'note_agency_open: a required argument is null' using errcode = '22004';
  end if;
  -- The live visit for THIS person, session and account: a caller can never name another visit.
  v_visit := public.agency_visit_live(p_account_id, p_actor, p_session);
  if v_visit is null then return 'no_visit'; end if;
  if p_kind = 'customer_list_export' then
    insert into public.agency_visit_items (visit_id, account_id, kind, record_id, item_count)
    values (v_visit, p_account_id, p_kind, null, p_item_count);
  else
    insert into public.agency_visit_items (visit_id, account_id, kind, record_id, item_count)
    values (v_visit, p_account_id, p_kind, p_record_id, null)
    on conflict (visit_id, kind, record_id) where record_id is not null do nothing;
  end if;
  return 'ok';
end $$;

create function public.access_log_page(
  p_account_id uuid, p_before_started timestamptz, p_before_id uuid, p_limit integer)
returns jsonb language plpgsql stable security invoker set search_path = pg_catalog, pg_temp as $$
declare v_total bigint; v_visits jsonb;
begin
  if p_account_id is null or p_limit is null then
    raise exception 'access_log_page: a required argument is null' using errcode = '22004';
  end if;
  if p_limit < 1 or p_limit > 50 then
    raise exception 'access_log_page: p_limit must be 1 to 50' using errcode = '22023';
  end if;
  if (p_before_started is null) <> (p_before_id is null) then
    raise exception 'access_log_page: a cursor needs both halves' using errcode = '22023';
  end if;
  select count(*) into v_total from public.agency_visits v where v.account_id = p_account_id;
  select coalesce(jsonb_agg(pg.visit order by pg.started_at desc, pg.id desc), '[]'::jsonb) into v_visits
  from (
    select v.id, v.started_at, jsonb_build_object(
      'id', v.id, 'actor_name', v.actor_name, 'reason', v.reason, 'started_at', v.started_at,
      'ended_at', (select max(i.first_opened_at) from public.agency_visit_items i where i.visit_id = v.id),
      'counts', (select jsonb_build_object(
          'contact', count(*) filter (where i.kind = 'contact'),
          'group', count(*) filter (where i.kind = 'group'),
          'call', count(*) filter (where i.kind = 'call'),
          'conversation', count(*) filter (where i.kind = 'conversation'),
          'file', count(distinct i.record_id) filter (where i.kind in ('document_view', 'document_download')),
          'form_answers', count(*) filter (where i.kind = 'form_answers'),
          'customer_list_export', count(*) filter (where i.kind = 'customer_list_export'))
        from public.agency_visit_items i where i.visit_id = v.id),
      'item_total', (select count(*) from public.agency_visit_items i where i.visit_id = v.id),
      'items', (select coalesce(jsonb_agg(jsonb_build_object(
            'kind', x.kind, 'record_id', x.record_id, 'item_count', x.item_count, 'first_opened_at', x.first_opened_at)
            order by x.first_opened_at desc, x.id desc), '[]'::jsonb)
        from (select i.id, i.kind, i.record_id, i.item_count, i.first_opened_at
                from public.agency_visit_items i where i.visit_id = v.id
               order by i.first_opened_at desc, i.id desc limit 100) x)
    ) as visit
    from public.agency_visits v
    where v.account_id = p_account_id
      and (p_before_started is null or (v.started_at, v.id) < (p_before_started, p_before_id))
    order by v.started_at desc, v.id desc
    limit p_limit + 1
  ) pg;
  return jsonb_build_object('total', v_total, 'visits', v_visits);
end $$;

revoke all on function app.agency_visit_window() from public, anon, authenticated, service_role;
revoke all on function public.agency_visit_live(uuid, text, text) from public, anon, authenticated, service_role;
revoke all on function public.start_agency_visit(uuid, text, text, text, text) from public, anon, authenticated, service_role;
revoke all on function public.note_agency_open(uuid, text, text, text, uuid, integer) from public, anon, authenticated, service_role;
revoke all on function public.access_log_page(uuid, timestamptz, uuid, integer) from public, anon, authenticated, service_role;
grant execute on function app.agency_visit_window() to service_role;
grant execute on function public.agency_visit_live(uuid, text, text) to service_role;
grant execute on function public.start_agency_visit(uuid, text, text, text, text) to service_role;
grant execute on function public.note_agency_open(uuid, text, text, text, uuid, integer) to service_role;
grant execute on function public.access_log_page(uuid, timestamptz, uuid, integer) to authenticated;
```

Then fill in `packages/db/src/access-log.ts` with the "Interfaces produced by T1" block. The house shape is `calendar-feeds.ts:1-80`: a doc comment saying who may call what, and an `Error` naming the wrapper on every failure. Bodies:
  - `startAgencyVisit`: `db.rpc("start_agency_visit", { p_account_id, p_actor: actor.clerkUserId, p_actor_name: actor.name, p_session: actor.sessionId, p_reason: reason })`. `error.code === "23503"` returns `null`. Any other error throws. A non-string `data` throws.
  - `agencyVisitLive`: `rpc("agency_visit_live", …)`. `null` returns `null`, a string returns that string, and anything else throws.
  - `noteAgencyOpen`: `p_record_id` is `null` for `customer_list_export` and `ref.recordId` otherwise; `p_item_count` is `ref.itemCount` for the export and `null` otherwise. Only `"ok"` and `"no_visit"` are accepted.
  - `newestAgencyVisitStart`: `from("agency_visits").select("started_at").eq("account_id", …).eq("actor_clerk_user_id", …).eq("clerk_session_id", …).order("started_at", { ascending: false }).limit(1).maybeSingle()`.
  - `readAgencyActorName`: `from("users").select("name, email").eq("clerk_user_id", clerkUserId).maybeSingle()`.
  - `readAccessLogPage`: `rpc("access_log_page", { p_account_id, p_before_started: before?.startedAt ?? null, p_before_id: before?.id ?? null, p_limit: limit })`, then `parseAccessLogPage(data, limit)`.
  - `parseAccessLogPage`: validate `{ total: number, visits: array }`, and for each visit every field named in `AccessLogVisit`, using `isAgencyVisitReason` and `ACCESS_LOG_KINDS`. Map snake_case to camelCase. `hasOlder = visits.length > limit`, and keep only the first `limit` visits. Throw on any unexpected shape.

Add the barrel block to `index.ts`. In `account-teardown.ts`, append to the comment block after `:46` a paragraph that begins "`agency_visits` and `agency_visit_items` (0105) are deliberately not on that list either, for consent_events' reason: …". It names the append-only grants and the cascade, and points at `access-log-schema.test.ts`'s pure case.

- [ ] **Step 5: Run on `post`. Everything must pass.** `sh pg-al.sh post`, then the Step 3 command against `/post`. Paste the summary line (expected `Tests  N passed (N)` with N = the file's case count, 0 failed). Also run the three neighbours that must NOT move, on `post`: `src/test/schema-grants-guard.test.ts src/test/definer-search-path.test.ts src/test/consent-ledger-schema.test.ts`. Paste their summary.

- [ ] **Step 6: Mutation probes, each on `post` from a mutated COPY of 0105** (`$D/mutants/M<n>.sql`, applied with `sh pg-al.sh post $D/mutants/M<n>.sql`). Each must turn the test NAMED in its row red. Paste the red line for each:

| # | Mutation in the copy | Red test |
|---|---|---|
| M1 | `revoke all … from anon, authenticated;` (service_role dropped) | table privileges |
| M2 | `grant insert (…, started_at)` on visits | column INSERT |
| M3 | add `grant update (reason) on public.agency_visits to service_role;` | append-only as service_role |
| M4 | visits policy `using (account_id = (select app.current_account_id()))` | read policy (Staff case) |
| M5 | visits policy `using ((select app.is_account_owner(app.current_account_id())))` | read policy (B Owner case) |
| M6 | `>` to `>=` in `agency_visit_live` | window edge |
| M7 | `interval '3 hours'` in the window | window edge, AND the pure AGENCY_VISIT_HOURS pin |
| M8 | drop `and v.clerk_session_id = p_session` | another session… |
| M9 | in `start_agency_visit`, delete the `if v_id is not null then return v_id; end if;` line | start twice |
| M10 | delete the `on conflict … do nothing` clause | one row per record |
| M11 | `agency_visit_live`: drop `and v.account_id = p_account_id` | another session… (account case) AND no_visit across accounts |
| M12 | `count(distinct i.record_id)` to `count(i.record_id)` | access_log_page |
| M13 | drop `limit 100` | access_log_page |
| M14 | `<` to `<=` in the cursor | access_log_page |
| M15 | `limit p_limit + 1` to `limit p_limit` | access_log_page |
| M16 | visits `on delete cascade` to `on delete restrict` | account delete |
| M17 | remove `public, ` from the `start_agency_visit` revoke | EXECUTE |
| M18 | drop `nullif(pg_catalog.btrim(p_actor_name), '')` (insert `p_actor_name`) | blank name |

M11 may also turn other cases red. That is fine, as long as the NAMED case is among them. If a row stays green, do NOT accept it: find out why and substitute a mutation that can fail, then say so in the report (working rule 2).

- [ ] **Step 7: The wrappers' fake-client test, local.** Create `packages/db/src/test/access-log-wrappers.test.ts`. A fake `SupabaseClient` records `rpc(name, args)` and returns a scripted `{ data, error }`, and a `from(table)` builder records `.select/.eq/.order/.limit/.maybeSingle` (copy the shape from `src/test/feed-bookings-reads.test.ts`). Cases:
  - Each of the five wrappers sends exactly its function or table and its argument names. Mutation: swap `p_actor` and `p_session` in `agencyVisitLive`, and the case FAILS.
  - `startAgencyVisit` turns `{ code: "23503" }` into `null`, and throws on any other error. Mutation: return null on every error, and the second half FAILS.
  - `noteAgencyOpen` sends `p_record_id: null, p_item_count: 212` for an export, and `p_record_id: id, p_item_count: null` otherwise. Mutation: always send `ref.recordId`, and the case FAILS.
  - `noteAgencyOpen` throws on `data: "maybe"`.
  - `parseAccessLogPage` maps a two-visit jsonb (snake_case) to the camelCase type, sets `hasOlder: true` for `limit + 1` rows and keeps `limit`, and throws on an unknown reason or kind.
  - `newestAgencyVisitStart` filters on all three columns. A second-account guard: mutation drop `.eq("account_id", …)`, and the case FAILS.

  Run it after the env check in Global Constraints: `pnpm --filter @bis/db exec vitest run src/test/access-log-wrappers.test.ts`. Paste red (before the wrappers exist), then green.

- [ ] **Step 8: The live test, CI only (do not run it locally).** Create `packages/db/src/test/access-log-live.test.ts` on `withTestAccount` (`fixtures.ts:140-149`):
  - One case runs `startAgencyVisit` (twice, same id), then `agencyVisitLive` (that id), then `noteAgencyOpen(contact)` (`ok`), then `noteAgencyOpen` for a random second UUID account (`no_visit`), then `newestAgencyVisitStart` (a string). Everything goes through `serviceDb()`.
  - One case records the account id inside `withTestAccount` and, after it resolves, reads `agency_visits` for that id on `serviceDb()`. It expects `[]`: teardown left nothing (the `alert-phone-verification-grants.test.ts:324` shape).

- [ ] **Step 8b (report only, no assertion): write cost on the PG17 replica.** On `post`, as the table owner, insert 20,000 visits and 200,000 items for one account. Then `explain (analyze, buffers)` one `note_agency_open` (as `set role service_role`) and one `agency_visit_live`. Paste both execution times and check for `Index Searches: N>1`; there should be none on PG17. Skip this step on PG18.

- [ ] **Step 9: Typecheck and commit.** Run `pnpm --filter @bis/db exec tsc --noEmit -p .` (or the package's `typecheck` script if it has one), then stop the replica (`sh pg-al.sh stop`). Commit the seven paths: `feat(db): migration 0105, an append-only log of BIS's visits to an account and the records each opened (F-118 part 1)`.

---

### Task 2: Every `accessLog.*` string, English and Spanish

**Tier:** low · **Owner:** bis-frontend · **Wave:** 1

**Files:**
- Modify: `apps/web/src/lib/messages.ts` (one block, at the end before `} as const;` at `:6390`, under a `// F-118 part 1: the reason chooser and the Owner's BIS access section.` comment)
- Modify: `apps/web/src/lib/messages.test.ts` (one new `describe`)

**Interfaces:** Produces the keys below. T4, T5 and T10 read them, by these exact names.

- [ ] **Step 1: Failing test.** In `messages.test.ts`:

```ts
describe("the BIS access copy (F-118 part 1)", () => {
  const keys = Object.keys(m).filter((k) => k.startsWith("accessLog.") && !k.endsWith(".es"));
  it("exists, and every key has its Spanish twin (positive control: the family is not empty)", () => {
    expect(keys.length).toBeGreaterThan(40);
    for (const k of keys) expect(m, k).toHaveProperty(`${k}.es`);
  });
  it("cites no milestone, no ticket, no template syntax and no arrow, in either language (mutation: put 'F-118' in accessLog.intro -> FAILS)", () => {
    for (const k of keys) for (const v of [m[k as keyof typeof m], m[`${k}.es` as keyof typeof m]]) {
      expect(v, k).not.toMatch(/\bM\d[a-z]?\b|F-\d{3}|\{\{|[\u2190-\u21FF]/);
    }
  });
  it("every counted phrase has its singular twin, in both languages", () => {
    for (const base of ["accessLog.total", "accessLog.count.customers", "accessLog.count.groups", "accessLog.count.calls",
      "accessLog.count.conversations", "accessLog.count.files", "accessLog.count.forms", "accessLog.summary.downloads", "accessLog.item.export"]) {
      expect(m, base).toHaveProperty(`${base}One`);
      expect(m, base).toHaveProperty(`${base}One.es`);
    }
  });
  it("the Owner-facing promises are the spec's words (mutation: restore 'Nobody, at BIS or here' -> FAILS; drop the agency-lists sentence -> FAILS)", () => {
    expect(m["accessLog.intro"]).toContain("These entries can't be changed or deleted from BIS or from your account.");
    expect(m["accessLog.intro.es"]).toContain("Estas entradas no se pueden cambiar ni borrar desde BIS ni desde su cuenta.");
    expect(m["accessLog.note.agencyLists"]).toContain("open work, screened calls and phone numbers");
    expect(m["accessLog.note.agencyLists.es"]).toContain("el trabajo pendiente, las llamadas filtradas y los números de teléfono");
    expect(m["accessLog.enter.ended.es"]).toBe("Su última visita aquí terminó al cabo de 2 horas.");
  });
});
```

- [ ] **Step 2: Run red.** `pnpm --filter web exec vitest run src/lib/messages.test.ts`. Paste the first red line.

- [ ] **Step 3: Add the keys.** Each English line is followed by its `.es` line:

| Key | English | Spanish (usted) |
|---|---|---|
| `accessLog.title` | BIS access | Acceso de BIS |
| `accessLog.intro` | Each time someone at BIS opens your account, they must choose why first. Every customer, call, conversation and file they open is listed here. These entries can't be changed or deleted from BIS or from your account. | Cada vez que alguien de BIS abre su cuenta, primero tiene que elegir por qué. Aquí aparece cada cliente, llamada, conversación y archivo que abre. Estas entradas no se pueden cambiar ni borrar desde BIS ni desde su cuenta. |
| `accessLog.note.automatic` | This list shows people at BIS. Automatic work, like Sofía answering a call or a reminder going out, isn't a person looking and isn't listed. | Esta lista muestra a personas de BIS. El trabajo automático, como Sofía al contestar una llamada o el envío de un recordatorio, no es una persona mirando y no aparece aquí. |
| `accessLog.note.agencyLists` | BIS also has a few lists that show every business at once: open work, screened calls and phone numbers. Looking at those lists, or deciding one of Sofía's suggestions from the work list, doesn't open your account, so it isn't listed here. Opening a customer, call or conversation from them is. | BIS también tiene algunas listas que muestran todos los negocios a la vez: el trabajo pendiente, las llamadas filtradas y los números de teléfono. Ver esas listas, o decidir una sugerencia de Sofía desde la lista de trabajo, no abre su cuenta, así que no aparece aquí. Abrir desde ellas un cliente, una llamada o una conversación sí aparece. |
| `accessLog.empty` | BIS hasn't opened your account yet. When someone does, you'll see who, when, why and what they opened. | BIS todavía no ha abierto su cuenta. Cuando alguien lo haga, verá quién, cuándo, por qué y qué abrió. |
| `accessLog.error` | We couldn't load BIS's visits. Try again. | No pudimos cargar las visitas de BIS. Inténtelo de nuevo. |
| `accessLog.retry` | Try again | Reintentar |
| `accessLog.loading` | Loading BIS's visits | Cargando las visitas de BIS |
| `accessLog.total` / `accessLog.totalOne` | {count} visits / 1 visit | {count} visitas / 1 visita |
| `accessLog.pager.older` / `.newer` / `.label` | Older / Newer / BIS access pages | Anteriores / Recientes / Páginas de acceso de BIS |
| `accessLog.someone` | Someone at BIS | Alguien de BIS |
| `accessLog.show` / `accessLog.hide` | Show what was opened / Hide what was opened | Mostrar lo que se abrió / Ocultar lo que se abrió |
| `accessLog.summary.opened` | Opened {list}. | Abrió {list}. |
| `accessLog.summary.and` | and | y |
| `accessLog.summary.downloads` / `…downloadsOne` | Downloaded your customer list {count} times. / Downloaded your customer list. | Descargó su lista de clientes {count} veces. / Descargó su lista de clientes. |
| `accessLog.summary.nothing` | Didn't open any customer, call, conversation or file. | No abrió ningún cliente, llamada, conversación ni archivo. |
| `accessLog.count.customers` / `…customersOne` | {count} customers / 1 customer | {count} clientes / 1 cliente |
| `accessLog.count.groups` / `…groupsOne` | {count} households or businesses / 1 household or business | {count} hogares o negocios / 1 hogar o negocio |
| `accessLog.count.calls` / `…callsOne` | {count} calls / 1 call | {count} llamadas / 1 llamada |
| `accessLog.count.conversations` / `…conversationsOne` | {count} conversations / 1 conversation | {count} conversaciones / 1 conversación |
| `accessLog.count.files` / `…filesOne` | {count} files / 1 file | {count} archivos / 1 archivo |
| `accessLog.count.forms` / `…formsOne` | the answers to {count} forms / the answers to 1 form | las respuestas de {count} formularios / las respuestas de 1 formulario |
| `accessLog.item.customer` | Customer · {name} | Cliente · {name} |
| `accessLog.item.household` | Household · {name} | Hogar · {name} |
| `accessLog.item.business` | Business · {name} | Negocio · {name} |
| `accessLog.item.call` | Call · {name} · {when} | Llamada · {name} · {when} |
| `accessLog.item.callNoName` | Call · {when} | Llamada · {when} |
| `accessLog.item.conversation` | Conversation · {name} | Conversación · {name} |
| `accessLog.item.conversationNoName` | Conversation | Conversación |
| `accessLog.item.fileViewed` | File · {title} · viewed | Archivo · {title} · visto |
| `accessLog.item.fileDownloaded` | File · {title} · downloaded | Archivo · {title} · descargado |
| `accessLog.item.form` | Form answers · {name} | Respuestas del formulario · {name} |
| `accessLog.item.export` / `…exportOne` | Downloaded your customer list ({count} customers) / Downloaded your customer list (1 customer) | Descargó su lista de clientes ({count} clientes) / Descargó su lista de clientes (1 cliente) |
| `accessLog.name.archived` | {name} (archived) | {name} (archivado) |
| `accessLog.name.trashed` | {title} (in the trash) | {title} (en la papelera) |
| `accessLog.gone.customer` | A customer who was later deleted | Un cliente que se eliminó después |
| `accessLog.gone.group` | A household or business that was later deleted | Un hogar o negocio que se eliminó después |
| `accessLog.gone.file` | A file that was later deleted for good | Un archivo que se eliminó para siempre después |
| `accessLog.gone.other` | A record that was later deleted | Un registro que se eliminó después |
| `accessLog.more` | and {count} more | y {count} más |
| `accessLog.enter.heading` | Why are you opening {name}? | ¿Por qué abre {name}? |
| `accessLog.enter.legend` | Choose a reason | Elija un motivo |
| `accessLog.enter.notice` | The business's Owners can see each visit, its reason and everything you open. | Los dueños del negocio pueden ver cada visita, su motivo y todo lo que abra. |
| `accessLog.enter.back` | Back to accounts | Volver a las cuentas |
| `accessLog.enter.ended` | Your last visit here ended after 2 hours. | Su última visita aquí terminó al cabo de 2 horas. |
| `accessLog.reason.setup` / `.support` / `.fix` / `.billing` | Setup / Support request / Fixing a problem / Billing | Configuración / Solicitud de ayuda / Arreglar un problema / Facturación |

The plural pairs follow `t.ts:54-70`: the base key holds the "other" form, `${base}One` the singular, and each has its own `.es`.

- [ ] **Step 4: Run green.** Run `src/lib/messages.test.ts`, `src/lib/consent/copy.test.ts` (it pins prefix counts; `accessLog.` must not match any of its regexes) and `src/lib/i18n/ratchet.test.ts`. Paste the three summary lines. Then run `pnpm --filter web lint`.
- [ ] **Step 5: Commit** the two paths: `feat(design): the BIS access copy, English and Spanish (F-118 part 1)`.

---

### Task 3: The gate, the writers, the path header and the `act` refusal

**Tier:** high · **Owner:** bis-platform · **Wave:** 2 (after T1 is reviewed and committed)

**Files:**
- Create: `apps/web/src/lib/access-log/paths.ts`, `paths.test.ts`
- Create: `apps/web/src/lib/access-log/gate.ts`, `gate.test.ts`
- Create: `apps/web/src/lib/access-log/note.ts`, `note.test.ts`
- Create: `apps/web/src/lib/access-log/visit.ts`, `visit.test.ts`
- Modify: `apps/web/src/lib/auth.ts:10-81` (the `AccessOptions` type and `requireAccountAccess`) and `:199-211` (`apiAccountAccess`), plus `apps/web/src/lib/auth.test.ts`
- Modify: `apps/web/src/proxy.ts:1-7`, `apps/web/src/proxy.test.ts`
- Modify: `apps/web/src/lib/proposals/actions.ts:41` (one line), `apps/web/src/lib/proposals/actions.test.ts:80` (one line)
- Modify: `ACCT/in-account-service-reads.test.ts` (three `ALLOWED` entries, in sorted position among the `lib/` keys)

**Interfaces:** Consumes T1's wrappers (`agencyVisitLive`, `noteAgencyOpen`, `startAgencyVisit`, `newestAgencyVisitStart`, `readAgencyActorName`, `isAgencyVisitReason`, `AGENCY_VISIT_HOURS`, `OpenedRef`, `AgencyVisitReason`) and `isUuid` from `@/lib/assign/action-guards`. Produces everything under "Interfaces produced by T3".

- [ ] **Step 1: `paths.ts`, test first.** `paths.test.ts` cases:
  - `accountPathOf({ pathname: "/dashboard/accounts/A/contacts/c1", search: "?x=1&_rsc=abc" })` is `"/dashboard/accounts/A/contacts/c1?x=1"` (mutation: keep `_rsc`, FAILS).
  - The bare `/dashboard/accounts/A` keeps its form; `/dashboard/accounts` (the list), `/dashboard/work`, `/dashboard/enter/A` and `/b/x` give `null`.
  - `safeReturnPath` accepts `/dashboard/accounts/A`, `/dashboard/accounts/A/contacts/c1?x=1`, `/dashboard/accounts/A?c=1`, and an UPPER-case id in either the path or the argument.
  - `safeReturnPath` refuses `//evil.example`, `https://evil.example/dashboard/accounts/A`, `/dashboard/accounts/B/contacts`, `/dashboard/accounts/AB` (the near miss: a prefix that is not a segment), `/dashboard/accounts/A\\evil`, `/dashboard/accounts/A//x`, a control character, a 2,049-character path, `""`, `null` and `42`. Mutations: drop the same-account check (B FAILS); `startsWith(prefix)` without the segment check (`AB` FAILS); drop the `\\` check (FAILS).
  - `enterHref(A, null)` is `/dashboard/enter/A`, and `enterHref(A, "/dashboard/accounts/A/x?y=1")` is `/dashboard/enter/A?to=%2Fdashboard%2Faccounts%2FA%2Fx%3Fy%3D1`.

  Implementation:

```ts
/** F-118 part 1 (spec 3.2): pure path helpers. Imported by proxy.ts, so nothing server-only here. */
export const BIS_PATH_HEADER = "x-bis-path";
const ACCOUNT_PATH = /^\/dashboard\/accounts\/[^/?#]+(?:\/|$)/;

/** The in-account path a request asked for (pathname + search, without Next's internal `_rsc`), or null. */
export function accountPathOf(url: { pathname: string; search: string }): string | null {
  if (!ACCOUNT_PATH.test(url.pathname)) return null;
  const params = new URLSearchParams(url.search);
  params.delete("_rsc");
  const qs = params.toString();
  return url.pathname + (qs ? `?${qs}` : "");
}

/** `raw` when it is a path inside THIS account and nothing else; null otherwise. */
export function safeReturnPath(raw: unknown, accountId: string): string | null {
  if (typeof raw !== "string" || raw.length === 0 || raw.length > 2048) return null;
  if (raw.includes("//") || raw.includes("\\") || /[\u0000-\u001f\u007f]/.test(raw)) return null;
  const prefix = `/dashboard/accounts/${accountId}`.toLowerCase();
  const lower = raw.toLowerCase();
  if (!lower.startsWith(prefix)) return null;
  const rest = lower.slice(prefix.length);
  return rest === "" || rest.startsWith("/") || rest.startsWith("?") ? raw : null;
}

export function enterHref(accountId: string, to: string | null): string {
  return `/dashboard/enter/${accountId}${to ? `?to=${encodeURIComponent(to)}` : ""}`;
}
```

- [ ] **Step 2: `gate.ts`, test first.** `gate.test.ts` mocks `@bis/db` (`serviceDb`, `agencyVisitLive`), `next/headers` (a settable `Headers`) and `next/navigation` (`redirect` and `notFound` both throw tagged errors). Cases:
  1. A live visit resolves with no redirect, and `agencyVisitLive` gets `(svc, A, { clerkUserId: "user_agency", sessionId: "sess_1" })`.
  2. No visit, with `x-bis-path` set to a same-account path, redirects to `enterHref(A, that path)`.
  3. No visit and no header redirects to `/dashboard/enter/A`.
  4. No visit, with the header naming account B, redirects to `/dashboard/enter/A`. Mutation: pass the header raw, and this FAILS.
  5. An RPC rejection rejects with THAT error, never a redirect. Mutations: catch it and treat it as live (FAILS); catch it and redirect (FAILS).
  6. `notFound()` for `"foo"`, with `agencyVisitLive` never called.
  7. No `sessionId` redirects to `/sign-in`, with no RPC.
  8. `agencyVisitOk` returns true or false, throws on an RPC error, and is false with no RPC for a non-UUID id.
  9. **The carve-out pin.** An AST walk over `apps/web/src` (non-test `.ts`/`.tsx`, the `typescript` package as in `lib/documents/read-gate.test.ts:28-64`) collects every `PropertyAssignment` named `agencyVisit`. It expects exactly one, in `lib/proposals/actions.ts`, initialised to the string literal `"not-required"`. Mutation, in a COPY: add `{ agencyVisit: "not-required" }` to `ACCT/contacts/[contactId]/page.tsx:94`, and the case FAILS naming that file.

```ts
import { cache } from "react";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { serviceDb, agencyVisitLive } from "@bis/db";
import { isUuid } from "@/lib/assign/action-guards";
import { BIS_PATH_HEADER, enterHref, safeReturnPath } from "./paths";

/**
 * F-118 part 1 (spec 3.1): the agency's visit, read once per (account, person, session) per request, so the
 * layout, the page and the shell share it. service_role only (0105), so serviceDb(): this runs inside
 * requireAccountAccess, before the caller is admitted. A failed read THROWS (ruling 4: fail closed).
 */
const liveVisit = cache((accountId: string, clerkUserId: string, sessionId: string) =>
  agencyVisitLive(serviceDb(), accountId, { clerkUserId, sessionId }));

export async function requireAgencyVisit(accountId: string, clerkUserId: string, sessionId: string | null | undefined): Promise<void> {
  if (!sessionId) redirect("/sign-in");
  if (!isUuid(accountId)) notFound();
  if (await liveVisit(accountId, clerkUserId, sessionId)) return;
  const to = safeReturnPath((await headers()).get(BIS_PATH_HEADER), accountId);
  redirect(enterHref(accountId, to));
}

export async function agencyVisitOk(accountId: string, clerkUserId: string, sessionId: string | null | undefined): Promise<boolean> {
  if (!sessionId || !isUuid(accountId)) return false;
  return (await liveVisit(accountId, clerkUserId, sessionId)) !== null;
}
```

- [ ] **Step 3: `auth.ts`, test first.** In `auth.test.ts`, add `sessionId: "sess_1"` to `asAgency()` and `asClient()`, and add the mocks from the shared table: `agencyVisitLive` on the bare `@bis/db` factory with `mockResolvedValue("visit_1")` in `beforeEach`, and `notFound` on `next/navigation`. New cases:
  - `requireAccountAccess(OWN)` for the agency with a live visit returns exactly today's value (`:53-58`), and `agencyVisitLive` gets `(…, OWN, { clerkUserId: "user_agency", sessionId: "sess_1" })`.
  - With no visit and `requestHeaders.value = { "x-bis-path": `/dashboard/accounts/${OWN}/contacts` }`, it throws `REDIRECT:/dashboard/enter/${OWN}?to=%2Fdashboard%2Faccounts%2F${OWN}%2Fcontacts`. Mutation: return for the agency before the visit check, and this FAILS.
  - `{ agencyVisit: "not-required" }` makes no RPC call and returns the agency value.
  - No client case ever calls `agencyVisitLive`: assert `not.toHaveBeenCalled()` in the existing Owner, Staff and other-account cases. Mutation: read the visit before the branch, and these FAIL.
  - `actor: { sub: "user_staff" }` on a client session redirects to `/no-access?reason=none` before `getAccountByOrgId`. On an agency session it does the same. `apiAccountAccess` answers `null` in both. Mutation: drop the `actor` check, and all three FAIL.
  - `apiAccountAccess(OWN)` for the agency returns `{ userId, isAgency: true }` with a visit and `null` without one; for `"foo"` it returns `null` with no RPC.
  - An RPC rejection makes `requireAccountAccess` reject with that error.

  Then the change to `auth.ts`:

```ts
import { requireAgencyVisit, agencyVisitOk } from "./access-log/gate";

export type AccessOptions = {
  duringPause?: "allow";
  /** F-118 part 1 (spec 11, C11): ONLY lib/proposals/actions.ts's run(), whose four actions /dashboard/work
   *  binds across every account (owner ruling 3: that page is not gated). gate.test.ts pins the one use. */
  agencyVisit?: "not-required";
};

// requireAccountAccess, replacing :58-63:
  const { userId, sessionId, sessionClaims, actor } = await auth();
  if (!userId) redirect("/sign-in");
  // F-118 part 1 (owner ruling 5): a session signed in AS someone else (Clerk's act claim, `actor` on auth())
  // would look like that person here and be logged nowhere. BIS's only way in is the agency path, with a reason.
  if (actor) redirect("/no-access?reason=none");
  const claims = sessionClaims as AppClaims;
  // The agency never gets a client membership (plan deviation 6). F-118: a live visit first (spec 3.1).
  if (claims.app_role === "agency_admin") {
    if (opts.agencyVisit !== "not-required") await requireAgencyVisit(accountId, userId, sessionId);
    return { userId, isAgency: true, role: null, canManage: true };
  }

// apiAccountAccess, replacing :202-205:
  const { userId, sessionId, sessionClaims, actor } = await auth();
  if (!userId || actor) return null;
  const claims = sessionClaims as AppClaims;
  if (claims.app_role === "agency_admin") {
    return (await agencyVisitOk(accountId, userId, sessionId)) ? { userId, isAgency: true } : null;
  }
```

  Update both doc comments in one sentence each: the agency branch now requires a live visit (spec 3.1). `lib/billing/read-only.test.ts:303-305` scans this file for `duringPause?: "allow"`, which must still appear exactly once. Run that test too.

- [ ] **Step 4: `note.ts`, test first.** `note.test.ts` mocks `@clerk/nextjs/server` (`auth`), `@bis/db` (`serviceDb`, `noteAgencyOpen`), `next/headers` and `next/navigation`. Cases:
  1. For a client (`{ isAgency: false }`), `noteOpened` resolves with no `auth()` call and no RPC, and `noteOpenedApi` returns `true`, also with neither. Mutation: call the RPC for clients, and the spy count FAILS.
  2. For the agency with `"ok"`, it resolves, and the RPC gets `(svc, A, { clerkUserId, sessionId }, ref)` with the ref passed through unchanged (a contact ref and an export ref).
  3. With `"no_visit"`, `noteOpened` redirects to `enterHref(A, x-bis-path)` and `noteOpenedApi` returns `false`.
  4. On an RPC rejection both reject. Mutation: `catch { return; }` (fail open), and this FAILS for both.
  5. With no `sessionId`, `noteOpenedApi` returns `false` with no RPC.

```ts
import { auth } from "@clerk/nextjs/server";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { serviceDb, noteAgencyOpen, type OpenedRef } from "@bis/db";
import { BIS_PATH_HEADER, enterHref, safeReturnPath } from "./paths";

/** The access value the surface's own guard returned; only isAgency is read. */
export type NoteAccess = { isAgency: boolean };

/**
 * F-118 part 1 (spec 4.2): the ONE place a record open is written. Called by every record surface AFTER its
 * own proof that the record exists in this account, and BEFORE any of it leaves the server. A client is never
 * logged and pays nothing. A failed write THROWS (owner ruling 4: fail closed). The write is service_role
 * only (0105) and re-checks the live visit itself, keyed by the session's own person and session, never a
 * value from the browser.
 */
async function note(access: NoteAccess, accountId: string, ref: OpenedRef): Promise<"client" | "ok" | "no_visit"> {
  if (!access.isAgency) return "client";
  const { userId, sessionId } = await auth();
  if (!userId || !sessionId) return "no_visit";
  return noteAgencyOpen(serviceDb(), accountId, { clerkUserId: userId, sessionId }, ref);
}

/** Pages and server actions: no live visit sends the person to the chooser. */
export async function noteOpened(access: NoteAccess, accountId: string, ref: OpenedRef): Promise<void> {
  if ((await note(access, accountId, ref)) !== "no_visit") return;
  redirect(enterHref(accountId, safeReturnPath((await headers()).get(BIS_PATH_HEADER), accountId)));
}

/** Route handlers: false means answer the route's usual 404. */
export async function noteOpenedApi(access: NoteAccess, accountId: string, ref: OpenedRef): Promise<boolean> {
  return (await note(access, accountId, ref)) !== "no_visit";
}
```

- [ ] **Step 5: `visit.ts`, test first.** `visit.test.ts` mocks `@clerk/nextjs/server` (`auth`, `currentUser`), `@/lib/auth` (`requireAgency`), `@bis/db` (`serviceDb`, `startAgencyVisit`, `readAgencyActorName`, `newestAgencyVisitStart`; keep the real `isAgencyVisitReason` and `AGENCY_VISIT_HOURS` through `importOriginal`) and `next/navigation`. Cases:
  1. The name order: `users.name` comes first, without asking Clerk. Then Clerk's `fullName` beats `users.email` when `users.name` is blank. Then `users.email`, then Clerk's primary email, then `null`. The result is trimmed and clipped to 200 characters. Mutation: ask Clerk first, and the first case FAILS on the `currentUser` spy count.
  2. A Clerk failure gives the next fallback, never a throw.
  3. `startVisitForCaller(A, "curious")` returns `null` with no RPC, and so does `startVisitForCaller("foo", "setup")`. Mutation: validate after the RPC, and the spy FAILS.
  4. `startVisitForCaller(A, "setup")` calls `startAgencyVisit(svc, A, { clerkUserId, sessionId, name }, "setup")` and returns its id. A `null` from the wrapper passes through. A rejection rejects.
  5. `requireAgency` runs first: when it throws, nothing else runs.
  6. `lastVisitEndedRecently`: with `now` fixed, a newest start exactly `AGENCY_VISIT_HOURS` ago is `true`, 1 h 59 min is `false` (still live), 13 h 59 min is `true` and 14 h is `false`. With no start it is `false`. Mutation: drop the lower bound, and the 1 h 59 case FAILS.

  `startVisitForCaller` is: `const { userId } = await requireAgency(); const { sessionId } = await auth(); if (!sessionId) redirect("/sign-in");`, then the reason and UUID checks, then `actorNameFor(userId)`, then `startAgencyVisit(serviceDb(), …)`.

- [ ] **Step 6: The proxy.** `proxy.ts`:

```ts
import { NextResponse } from "next/server";
import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import { BIS_PATH_HEADER, accountPathOf } from "@/lib/access-log/paths";

const isProtected = createRouteMatcher(["/dashboard(.*)"]);

export default clerkMiddleware(async (auth, req) => {
  if (isProtected(req)) await auth.protect();
  // F-118 part 1 (spec 3.2): the in-account path the person asked for, so the reason gate can send them back
  // to it. Set (overwriting any value the browser sent) on account paths only; the gate re-validates it.
  const path = accountPathOf(req.nextUrl);
  if (path === null) return;
  const headers = new Headers(req.headers);
  headers.set(BIS_PATH_HEADER, path);
  return NextResponse.next({ request: { headers } });
});
```

  `proxy.test.ts` gains one case. It walks `proxy.ts`'s AST (the `typescript` package) and finds a `CallExpression` of `accountPathOf` AND a `.set(…)` call whose first argument is the identifier `BIS_PATH_HEADER`. A comment naming either does not satisfy it. Mutation: delete the `headers.set` line, and it FAILS. The existing `createRouteMatcher` regex case (`:10`) must stay green. The e2e deep link (T12) is the behavioural proof, because `clerkMiddleware` cannot run in vitest. ASSUMPTION (spec 3.2): the request header reaches `headers()` in server code.

- [ ] **Step 7: The carve-out and its neighbours.** `lib/proposals/actions.ts:41` becomes `const access = await requireAccountAccess(accountId, { agencyVisit: "not-required" });`, with a one-line comment citing ruling 3 and the plan's C11. Line 80 of `lib/proposals/actions.test.ts` becomes `toHaveBeenCalledWith("A", { agencyVisit: "not-required" })`. In `ACCT/in-account-service-reads.test.ts`, add three entries to `ALLOWED`, in sorted position, each with a one-line comment:
  - `"lib/access-log/gate.ts": "before-trust"`: the agency's live-visit read inside `requireAccountAccess`; service_role only (0105).
  - `"lib/access-log/note.ts": "proven-target"`: writes the open only after the surface's own request-client proof, keyed by the caller's own session.
  - `"lib/access-log/visit.ts": "agency-only"`: `requireAgency` first; starts the caller's own visit and reads their own name.

- [ ] **Step 8: Run everything.** `pnpm --filter web exec vitest run src/lib/access-log src/lib/auth.test.ts src/proxy.test.ts src/lib/proposals/actions.test.ts "src/app/(dashboard)/dashboard/accounts/[accountId]/in-account-service-reads.test.ts" src/lib/billing/read-only.test.ts`. Then typecheck and lint. Then run the WHOLE web suite once (`pnpm --filter web test`): `auth.ts` is shared infrastructure, so bis-agent-test-scope requires it. Paste every summary line.

- [ ] **Step 9: Mutation probes.** Run every probe named in Steps 1–6, each in a COPY. Paste the red line for each, then restore from your saved copy and `cmp`.

- [ ] **Step 10: Commit** the paths listed under Files: `feat(auth): a reason before BIS enters an account (a two-hour visit), one logger for record opens, and no impersonated sessions (F-118 part 1)`.

---

### Task 4: The reader's view, name resolver and components

**Tier:** medium · **Owner:** bis-frontend · **Wave:** 2 (after T1 and T2)

**Files:**
- Create: `apps/web/src/lib/access-log/view.ts`, `view.test.ts`
- Create: `apps/web/src/lib/access-log/names.ts`, `names.test.ts`
- Create: `apps/web/src/components/access-log/reason-tiles.tsx`, `bis-access-frame.tsx`, `bis-access-list.tsx`, `bis-access-skeleton.tsx`, `bis-access-error.tsx`, `access-log-components.test.ts`
- Create: `apps/web/src/app/(dashboard)/dashboard/styleguide/bis-access-demo.tsx`
- Modify: `apps/web/src/app/(dashboard)/dashboard/styleguide/page.tsx` (one import, one section)

**Interfaces:** Consumes T1's types, T2's keys, `makeTr`/`Tr` (`lib/record/copy.ts:9-24`), `formatDateInZone` and `formatDateTimeInZone` (`lib/format.ts:51-94`), `encodeCursor` and `parseCursor` (`lib/cursor.ts:45-88`), and `useLocale` (`components/locale-provider.tsx:17`). Produces everything under "Interfaces produced by T4".

- [ ] **Step 1: `view.test.ts`, red first.** Every case builds a `Tr` with `makeTr("en")` and `makeTr("es")`. Cases:
  - `visitSummary` with counts `{ contact: 4, call: 1, file: 1 }` gives "Opened 4 customers, 1 call and 1 file." and, in Spanish, "Abrió 4 clientes, 1 llamada y 1 archivo." `{ contact: 1 }` gives "Opened 1 customer." / "Abrió 1 cliente." Mutation: always plural, FAILS.
  - The kinds come in the spec's order (customers, households or businesses, calls, conversations, files, form answers) whatever order the counts arrive in. Mutation: `Object.keys(counts)` order, FAILS.
  - Exports produce their own sentence: `{ contact: 2, customer_list_export: 1 }` gives "Opened 2 customers. Downloaded your customer list."; `{ customer_list_export: 2 }` gives "Downloaded your customer list 2 times."; all zeroes give the "Didn't open…" sentence.
  - `visitSpan` in `Pacific/Honolulu` for `2026-10-30T08:30:00Z`–`2026-10-30T08:45:00Z` gives text shaped like `"Oct 29, 2026, 10:30 PM–10:45 PM"`, containing **Oct 29**. Assert the day, not the exact string, because ICU's spacing varies. The same instants in `America/Chicago` contain **Oct 30**. That is two zones with opposite days, and the machine zone (Chicago) cannot be the fixture's. A visit with no end shows its start only. A span that crosses midnight names both days. Mutations: render in the machine's zone (Honolulu FAILS); always "start–end" (no-end FAILS).
  - `buildVisitRows`, with one visit holding one of every kind, gives:
    - each item's text from its key;
    - the household or business label chosen by `kind`;
    - an archived customer as "Maria Lopez (archived)" / "(archivado)", and a trashed file as "Insurance card (in the trash)";
    - "viewed" or "downloaded" by kind;
    - a missing contact as `gone.customer` with `href: null`, a missing group as `gone.group`, a missing document as `gone.file`, a missing call, conversation or form as `gone.other`;
    - the hrefs `${base}/contacts/<id>`, `${base}/groups/<id>`, `${base}/calls/<id>`, `${base}/conversations?c=<id>`, `${base}/contacts/<rid>?document=<id>` (`${base}/groups/<rid>?document=<id>` for a group's file) and `${base}/forms/<id>`, and the export with `href: null`;
    - the label `"Dan Lopez · Support request"`, and with `actorName: null` `"Someone at BIS · …"` / `"Alguien de BIS · …"`;
    - `more` as "and 37 more" when `itemTotal` is 137 with 100 items, and `null` when they are equal.

    Mutations: drop the archived suffix (FAILS); link a gone record (FAILS); ignore `kind` for a group (FAILS).
  - `parseAccessCursor(encodeAccessCursor(v))` round-trips. Garbage and `undefined` give `null`.

- [ ] **Step 2: Implement `view.ts`.** It is pure, with no React. `visitSummary` maps the six counted kinds to `tr.count("accessLog.count.<x>", n)` in a FIXED array order, joins them with `", "` and `" " + tr.text("accessLog.summary.and") + " "` before the last, then adds `tr.count("accessLog.summary.downloads", n)` as its own sentence. `visitSpan` uses `formatDateInZone` for the day and an `Intl.DateTimeFormat(locale === "es" ? "es-US" : "en-US", { timeZone, hour: "numeric", minute: "2-digit" })` for the clock. Use the same locale tags `format.ts` uses: read them from the file. A contact's display name is `[first, last].filter(Boolean).join(" ")`, or `tr.text("contact.noName")` (which has an `.es` twin), never the English-only `contactDisplayName` fallback. The call `when` is `formatDateTimeInZone(startedAt, zone, locale)`. The cursor helpers wrap `encodeCursor`/`parseCursor` with `{ v: startedAt, id }`, and a null `v` is invalid.

- [ ] **Step 3: `names.test.ts`, red first, then `names.ts`.** Use a fake client that records every `from(table).select(cols).eq(col, val).in(col, ids)`. Cases:
  - Each of the six reads (`contacts` with `id, first_name, last_name, archived_at`; `client_groups` with `id, name, kind`; `calls` with `id, started_at, contact_id`; `conversations` with `id, contact_id`; `documents` with `id, title, deleted_at, contact_id, client_group_id`; `forms` with `id, name`) carries `.eq("account_id", A)`. Mutation: drop it from any one read, and it FAILS naming the table.
  - The contacts read includes the contact ids found on the calls and conversations, so a call's caller has a name.
  - 120 contact ids make three calls of at most `NAME_CHUNK` (50). Mutation: one unchunked call, FAILS.
  - No ids of a kind means no read of that table.
  - A read error throws, naming the table. Mutation: swallow it into empty maps, FAILS.
  - Trashed documents and archived contacts are NOT filtered out. Mutation: add `.is("deleted_at", null)`, FAILS on the trashed fixture.

  `resolveAccessLogNames` does the calls, conversations, documents, groups and forms reads in one `Promise.all`, then one contacts read. Rows map into `AccessLogNames`.

- [ ] **Step 4: The components, red first.** `access-log-components.test.ts` uses `renderToStaticMarkup` with `createElement` (the `account-name-fields.test.ts:2-3,28` shape), inside `LocaleProvider` for the client ones, and decodes text through `lib/rendered-text.ts`. Cases:
  - `ReasonTiles` renders four `<button type="submit" name="reason" value="setup|support|fix|billing">` in that order, a `<legend>`, and no element using the primary variant's class (`bg-primary`). Mutation: `type="button"`, FAILS.
  - `BisAccessFrame` renders `id="bis-access"`, the title, the intro, the automatic note and the agency-lists note in English, and all of them in Spanish under `LocaleProvider locale="es"`. Mutation: drop the agency-lists `<p>` (ruling 3), FAILS in both languages.
  - `BisAccessList` with two rows renders each `data-bis-access-visit`, its label, its `when` with `tabular-nums`, its summary, and a ghost `button` with `aria-expanded="false"` and `aria-controls` naming the items list's id. That list is `hidden`, its links are `<a href>` for linked items and plain text for gone ones, and the `more` line appears. A row with no items renders no button.
  - `BisAccessSkeleton` renders three row skeletons and the sr-only loading text, and no spinner.
  - `BisAccessError` renders the error sentence and a ghost "Try again" button.

  Implementation notes:
  - `ReasonTiles` is a server-safe component (no `"use client"`). Its tiles copy `components/choice-tiles.tsx:52-58`'s token recipe (`--surface-2` at rest, `--surface-3` on hover over 150ms, `--line`/`--line-strong`, `--radius-ctl`, `min-h-11`, the `--ring-glow` focus ring) on a `<button>`. The grid is `sm:grid-cols-2`, all four tiles are the same size, and there is no primary.
  - `BisAccessFrame` (`"use client"`) renders `<section id="bis-access" aria-labelledby="bis-access-title" className="mt-8 space-y-3">`, an `h2` (UI role, `text-base font-semibold`), the intro (`text-sm text-[var(--text-2)]`), the two notes (`text-xs text-[var(--text-3)]`), then `{children}`. Strings come from `t(m, key, useLocale())`.
  - `BisAccessList` (`"use client"`) is a `<ul>` of `<li data-bis-access-visit={id}>`. The label uses the Label role (`font-mono text-[10px] font-medium uppercase tracking-[0.14em] text-[var(--text-3)]`). The when line is `tabular-nums text-sm`. The summary is `text-sm`. The toggle is a ghost `Button` (`components/ui/button`), with item links through `next/link`. There is no checkbox, no status colour, and no row-as-link (the rows are not navigable records; only items link).
  - Every string comes from the catalogue, so the i18n ratchet stays at 0 for these files. The `" · "` and `"–"` separators carry no letters.

- [ ] **Step 5: Styleguide.** `bis-access-demo.tsx` (`"use client"`) renders `ReasonTiles` inside a `<form onSubmit={(e) => e.preventDefault()}>` with English labels from `m`. It also renders `BisAccessList` with two fixture rows built as JS constants (not JSX literals), `BisAccessSkeleton`, and `BisAccessError`, each under a small mono caption. The captions come from the existing styleguide pattern: read `page.tsx`'s nearest demo for how captions are written. Register it in `styleguide/page.tsx` with one import and one `<section aria-labelledby="sg-bis-access">` beside the other demos.

- [ ] **Step 6: Run.** `pnpm --filter web exec vitest run src/lib/access-log/view.test.ts src/lib/access-log/names.test.ts src/components/access-log src/lib/i18n/ratchet.test.ts src/components/ui/material.test.ts`, plus every styleguide test file (`"src/app/(dashboard)/dashboard/styleguide"`). Then typecheck and lint. Paste the summaries. Then run the mutation probes named above, each in a copy, and paste the red lines.

- [ ] **Step 7: Commit** the paths: `feat(design): the BIS access section's view, name lookup and components, and the chooser's reason tiles (F-118 part 1)`.

---

### Task 5: The chooser page and `startVisitAction`; a new company starts a Setup visit

**Tier:** medium · **Owner:** bis-platform · **Wave:** 3

**Files:**
- Create: `ENTER/page.tsx`, `ENTER/page.test.ts`, `ENTER/actions.ts`, `ENTER/actions.test.ts`
- Modify: `apps/web/src/app/(dashboard)/dashboard/accounts/actions.ts:140-146` and `:220-225`, and `actions.test.ts` (mock, plus two cases per action)

**Interfaces:** Consumes `startVisitForCaller`, `lastVisitEndedRecently` (`visit.ts`), `agencyVisitOk` (`gate.ts`), `safeReturnPath` and `enterHref` (`paths.ts`), `ReasonTiles` (T4), `requireAgency` and `accountHome` (`lib/auth.ts:12-18,128-130`), `requestLocale` (`lib/i18n/request-locale.ts:35`), `getPersonPrefs`, `makeTr`, `dbForRequest`, and `PageHeader`.

- [ ] **Step 1: `actions.test.ts`, red first** (spec test 12). It mocks `@/lib/auth` (`requireAgency`), `@/lib/access-log/visit` (`startVisitForCaller`) and `next/navigation` (`redirect` throws `REDIRECT:<url>`). Cases:
  - With reason `support` and a valid `to` (`/dashboard/accounts/<A>/contacts/<c>?x=1`), it calls `startVisitForCaller(A, "support")` and redirects to that `to`.
  - It sends a refused `to` to `accountHome(A, null)`: each of `//evil.example`, `/dashboard/accounts/<B>/x`, `/dashboard/accounts/<A>\\evil`, `https://evil.example`, `null`. Mutation: `redirect(to ?? home)`, and the B and `//` cases FAIL.
  - An unknown reason (`curious`, an empty value, a missing field) redirects back to `enterHref(A, safe to)` and NEVER calls `startVisitForCaller`. Mutation: call it first, and the spy FAILS.
  - A non-UUID `accountId` redirects to `/dashboard/accounts` without starting anything.
  - `startVisitForCaller` returning `null` (no such account) redirects to `/dashboard/accounts`.
  - When `requireAgency` throws, nothing runs.

  Implementation (`"use server"`). The bound arguments come back from the browser unencrypted, so the action re-checks everything:

```ts
export async function startVisitAction(accountId: string, to: string | null, formData: FormData): Promise<void> {
  await requireAgency();
  if (!isUuid(accountId)) redirect("/dashboard/accounts");
  const back = safeReturnPath(to, accountId);
  const reason = formData.get("reason");
  if (!isAgencyVisitReason(reason)) redirect(enterHref(accountId, back));
  const visit = await startVisitForCaller(accountId, reason);
  if (!visit) redirect("/dashboard/accounts");
  redirect(back ?? accountHome(accountId, null));
}
```

- [ ] **Step 2: `page.test.ts`, red first.** It mocks `requireAgency`, Clerk's `auth` (userId and sessionId), `agencyVisitOk`, `lastVisitEndedRecently`, `dbForRequest` (accounts `select("name")`), `getPersonPrefs` and `next/navigation`. It renders with `renderToStaticMarkup` after `await Page(props)`. Cases:
  - A non-UUID id gives `notFound` before any read.
  - A live visit redirects at once to the safe `to`, or to `accountHome`.
  - A missing account gives `notFound`.
  - The page renders the heading "Why are you opening E2E Co?", the four reason buttons in order, the notice, the Back link to `/dashboard/accounts`, and a `<form>`. The ended line appears only when `lastVisitEndedRecently` is true. Mutation: always show it, FAILS.
  - `prefs.language: "es"` gives "¿Por qué abre …?" and "Solicitud de ayuda".
  - The markup contains no `bg-primary` (rule 8).
  - An account read error throws. Mutation: `notFound()` on an error, FAILS.

- [ ] **Step 3: `page.tsx`.** It is a server component:
  - `await requireAgency()` first, then `isUuid`, then `safeReturnPath(searchParams.to, accountId)`.
  - `agencyVisitOk(accountId, userId, sessionId)` redirects at once when true.
  - Then `Promise.all([db.from("accounts").select("name").eq("id", accountId).maybeSingle(), getPersonPrefs(), lastVisitEndedRecently(accountId)])`.
  - `requestLocale({ account: null, isOperator: true, userLanguage: prefs.language })`: the inline literal satisfies `request-locale-callers.test.ts:16`, which needs `userLanguage:` inside the braces.
  - `<PageHeader title={tr.text("accessLog.enter.heading", { name })} />`. The ended line goes above the form.
  - `<form action={startVisitAction.bind(null, accountId, to)}><ReasonTiles legend=… options=… /></form>`, then the notice, then the Back link (ghost, `buttonVariants({ variant: "ghost", size: "sm" })`).
  - Keep it to one column, `max-w-xl`. Tokens only.

- [ ] **Step 4: A created or adopted company starts a Setup visit (C10).** In `dashboard/accounts/actions.ts`, just before each `redirect` (`:146` and `:225`), add the block below. It runs AFTER the account exists and BEFORE the redirect into it; a failed start still redirects, and the gate then shows the chooser.

```ts
  // F-118 part 1 (plan C10): the creator's reason is Setup; without it this redirect would meet the chooser.
  await startVisitForCaller(id, "setup").catch((e: unknown) => {
    console.error(`account ${id}: starting the creator's Setup visit failed, the chooser will ask: ${String(e)}`);
  });
```

  In `actions.test.ts`, add `vi.mock("@/lib/access-log/visit", () => ({ startVisitForCaller: vi.fn(async () => "visit_1") }))` and, for each action, two cases:
  - It is called with `(newId, "setup")`, and BEFORE `redirect`: record the order through both mocks. Mutation: call it after the redirect line, and it FAILS.
  - A rejection still redirects to the same target.

- [ ] **Step 5: Run.** `pnpm --filter web exec vitest run "src/app/(dashboard)/dashboard/enter" "src/app/(dashboard)/dashboard/accounts/actions.test.ts" src/lib/i18n/request-locale-callers.test.ts src/lib/i18n/ratchet.test.ts`, then typecheck and lint. Paste the summaries and the probe red lines.

- [ ] **Step 6: Commit** the six paths: `feat(auth): the reason chooser at /dashboard/enter, and a new company starts its creator's Setup visit (F-118 part 1)`.

---

### Task 6: The drawer and card routes log (13 routes)

**Tier:** medium · **Owner:** bis-crm · **Wave:** 3

**Files (each `route.ts` with its tests):**

| Route | Its proof (`:line`) | Insert right after the proof | `ref` |
|---|---|---|---|
| `API/contacts/[contactId]/summary/route.ts` | `:43-44` | `if (!contact) …404` | `{ kind: "contact", recordId: contactId }` |
| `…/ai-summary/route.ts` | `:48-54` | `if (!contact) …404` (`:54`), before the second `try` | contact, `contactId` (lowercased at `:42`) |
| `…/document-requests/route.ts` | `:26` (inside `try`) | the `getContact` 404 line | contact |
| `…/document-requirements/route.ts` | `:25` (inside `try`) | same | contact |
| `…/documents/route.ts` | `:25` (inside `try`) | same | contact |
| `…/email/route.ts` | `:26-27` | `if (!contact) …404` | contact |
| `…/groups/route.ts` | `:24` (inside `try`) | the `getContact` 404 line | contact |
| `…/places/route.ts` | `:48-49` | `if (!contact) …404` | contact |
| `…/relationships/route.ts` | `:32-33` | `if (!contact) …404` | contact |
| `…/texts/route.ts` | `:27-28` | `if (!contact) …404` | contact |
| `API/groups/[groupId]/document-requests/route.ts` | `:27` | the `readGroup` 404 line | `{ kind: "group", recordId: groupId }` |
| `API/groups/[groupId]/documents/route.ts` | `:25-26` | `if (!group) …404` | group |
| `API/groups/[groupId]/places/route.ts` | `:33-34` | `if (!group) …404` | group |

Tests: each route's `route.test.ts`, plus `summary/route.reads.test.ts` and `ai-summary/route.reads.test.ts` (15 files).

**Interfaces:** Consumes `noteOpenedApi` (T3).

- [ ] **Step 1: Red first, in every one of the 15 test files.** Add:

```ts
const noteOpenedApi = vi.fn(async () => true);
vi.mock("@/lib/access-log/note", () => ({ noteOpenedApi: (...a: unknown[]) => noteOpenedApi(...(a as [])) }));
```

  Reset it in `beforeEach` with `mockReset()` and `mockResolvedValue(true)` (`clearAllMocks` keeps implementations, the memory's shape). In each `route.test.ts`, make the guard mock return an AGENCY value (`{ userId: "user_agency", isAgency: true }`) for these three new cases:
  1. **Logged after the proof:** `noteOpenedApi` is called once with `(that same access object, A, ref)`, where `ref` is this route's row from the table. Mutations: delete the call (FAILS); hard-code `{ isAgency: false }` as the first argument (FAILS).
  2. **A 404 logs nothing:** with `getContact` / `readGroup` resolving `null`, the answer is 404 and `noteOpenedApi` was never called. Mutation: move the call above the proof, FAILS.
  3. **No visit, no data:** with `noteOpenedApi` resolving `false`, the answer is 404 and this route's FIRST data read after the proof was never called. That read is `listRecordDocuments` for documents, `listContactPlaces` for places, `loadSummary` for summary, and so on; name it in the test. Mutation: ignore the `false`, FAILS.

  The two `.reads.test.ts` files only gain the mock (resolving `true`), so they keep passing. Run red and paste one red line per route.

- [ ] **Step 2: The one line per route.** Add the import, then after the proof:

```ts
  if (!(await noteOpenedApi(access, accountId, { kind: "contact", recordId: contactId }))) return NextResponse.json({}, { status: 404 });
```

  Group routes use `{ kind: "group", recordId: groupId }`. It goes inside the existing `try` where the proof is inside one. A thrown write then becomes that route's own 500 (fail closed). Where the proof is not inside a `try`, the throw becomes Next's 500. Never wrap the call in a new catch.

- [ ] **Step 3: Run.** `pnpm --filter web exec vitest run src/app/api/accounts`, then typecheck and lint. Paste the summary. Run the three probes on two routes of your choice (one contact route, one group route), each in a copy, and paste the red lines.

- [ ] **Step 4: Commit** the 28 paths: `feat(contacts): the drawer and every record card log BIS's open of the customer or household (F-118 part 1)`.

---

### Task 7: The contact and group pages, file opens, form answers and the export log; Export is an anchor

**Tier:** medium · **Owner:** bis-crm · **Wave:** 3

**Files:**
- Modify: `ACCT/contacts/[contactId]/page.tsx` (`:94-110`), `ACCT/contacts/[contactId]/page.test.ts`
- Modify: `ACCT/groups/[groupId]/page.tsx` (`:76-94`), `ACCT/groups/[groupId]/page.test.ts`
- Modify: `ACCT/contacts/documents-actions.ts` (`:228-256`), `ACCT/contacts/documents-actions.test.ts`
- Modify: `ACCT/forms/[formId]/page.tsx` (`:21-48`); Create: `ACCT/forms/[formId]/page.test.ts`
- Modify: `ACCT/contacts/export/route.ts` (`:76-104`), `ACCT/contacts/export/route.get.test.ts` (and `route.test.ts` if its mocks need the new modules)
- Modify: `ACCT/contacts/page.tsx` (`:281-287`), `ACCT/contacts/page.test.ts`

**Interfaces:** Consumes `noteOpened` (T3) and `countContacts` (`packages/db/src/contacts.ts:1031`).

- [ ] **Step 1: Red first, every file.** Mock `@/lib/access-log/note` with `noteOpened: vi.fn(async () => undefined)` in each test file, reset in `beforeEach`, with the surface's guard mock returning an agency access. Cases:
  - **Contact page.**
    - `noteOpened` gets `(access, A, { kind: "contact", recordId: CONTACT.id })`.
    - `getContact` → `null` gives `notFound` and no call.
    - The shared-number holding record (`holds_shared_number: true`) redirects and makes NO call; its conversation logs it.
    - A rejected `noteOpened` rejects the page, with no markup. Mutation: `.catch(() => undefined)` on it, FAILS.
  - **Group page.** The same three: called with `{ kind: "group", recordId: group.id }`, `readGroup` → `null` makes no call, and a rejection rejects.
  - **File action** (`getDocumentUrlAction`).
    - `mode: "view"` on a PDF logs `document_view`, and `"download"` logs `document_download`.
    - `"view"` on a Word file (an `OFFICE_TYPES` content type) logs `document_download`, because that is what happens (`:242`). Mutation: log `mode` instead of the effective `download`, and this FAILS.
    - The ORDER is `["noteOpened", "signedDocumentReadUrl"]`, recorded through both mocks. Mutation: move the note after the mint, FAILS.
    - A rejected note returns `fail("documents.error.open")`, and `signedDocumentReadUrl` is never called.
    - A note that throws Next's redirect (an `Error` whose `digest` is `"NEXT_REDIRECT;replace;/dashboard/enter/A;307;"`) REJECTS the action with that error. Mutation: drop `unstable_rethrow`, and it FAILS, because the catch turns the redirect into `documents.error.open`.
    - A version that is not found makes no note.
  - **Form page** (new `page.test.ts`). Copy the mock set from `ACCT/calls/[callId]/page.test.ts:19-130` and adapt: `requireNotTechnician` returns an agency access, plus `getForm`, `listSubmissions`, `listCustomFields`, `findConciergeDestinationName`, `next/headers` and the accounts read.
    - It is called with `{ kind: "form_answers", recordId: FORM.id }`.
    - `getForm` → `null` gives `notFound` with no call.
    - A rejection rejects.
  - **Export route** (`route.get.test.ts`).
    - Requests with `rsc: 1`, and with `next-router-prefetch: 1`, answer 204 with an empty body, and NONE of `requireAccountOwner`, `countContacts`, `noteOpened` or `listContacts` runs. Mutation: drop the check, and both FAIL.
    - A normal request calls `countContacts(db, A, { search: q, archived })` with the SAME `q` and `archived` the stream's `listContacts` gets. Mutation: drop `search`, FAILS.
    - Then `noteOpened(access, A, { kind: "customer_list_export", itemCount: <the count> })`, BEFORE the first `listContacts`. Record the order and read the body to completion.
    - A rejected note rejects the GET, and `listContacts` is never called.
  - **List page** (`page.test.ts`). The Export control is `<a … download …>` carrying `data-export-link` and the same href `buildExportHref` builds. Mutation: put back `<Link>` without `download`, FAILS on the attribute.

- [ ] **Step 2: The edits.**
  - **Contact page:** append `noteOpened(access, accountId, { kind: "contact", recordId: contact.id })` as the LAST element of the `Promise.all` at `:110`. It is not destructured; put a one-line comment above it citing spec 4.1 and ruling 4. It sits after the holding redirect (`:100-103`), so a holding record is never logged as a customer.
  - **Group page:** `:94` becomes `const [activity] = await Promise.all([loadGroupActivity(db, accountId, group.id), noteOpened(access, accountId, { kind: "group", recordId: group.id })]);`.
  - **File action:**
    - `:232` captures `const access = await requireAccountAccess(accountId, { duringPause: "allow" });`. The `duringPause` text is unchanged, so `read-only.test.ts` stays green.
    - After `:242`'s `download`, add `await noteOpened(access, accountId, { kind: download ? "document_download" : "document_view", recordId: doc.id });`.
    - The `catch` at `:252` starts with `unstable_rethrow(e);` (imported from `next/navigation`, the house use at `create-account-feedback.ts:1,33`).
  - **Form page:** `:21` captures `const access = await requireNotTechnician(accountId);`, and `noteOpened(access, accountId, { kind: "form_answers", recordId: form.id })` is appended to the `Promise.all` at `:39`. `technician-guards.test.ts` still finds `requireNotTechnician` (run it).
  - **Export route:** first line of `GET`: `if (req.headers.get("rsc") !== null || req.headers.get("next-router-prefetch") !== null) return new Response(null, { status: 204 });`, with a comment citing plan C2. Then `:93` captures `const access = await requireAccountOwner(accountId);`, and after `:103`'s `db`:

```ts
  // F-118 part 1 (plan C1): the route streams, so the count of what it is about to send is read first, on the
  // export's own filters, and the download is logged before a single row leaves (owner ruling 4).
  const total = await countContacts(db, accountId, { search: q, archived });
  await noteOpened(access, accountId, { kind: "customer_list_export", itemCount: total });
```

  - **List page `:281-287`:** replace the `<Link>` with `<a href={buildExportHref(base, q, sort, dir, view)} download data-export-link className={…same…}>`. Keep the comment that says why: a Link prefetches, and its RSC fetch would run the handler.

- [ ] **Step 3: Run.** `pnpm --filter web exec vitest run "src/app/(dashboard)/dashboard/accounts/[accountId]/contacts" "src/app/(dashboard)/dashboard/accounts/[accountId]/groups" "src/app/(dashboard)/dashboard/accounts/[accountId]/forms" "src/app/(dashboard)/dashboard/accounts/[accountId]/technician-guards.test.ts" src/lib/billing/read-only.test.ts src/lib/documents/read-gate.test.ts src/lib/consent/scans.test.ts`, then typecheck and lint. Paste the summaries, then every probe's red line.

- [ ] **Step 4: Commit** the paths: `feat(contacts): the customer and household pages, a file's view or download, a form's answers and the customer list download log BIS's open; Export is a plain download link (F-118 part 1)`.

---

### Task 8: The call page logs

**Tier:** medium · **Owner:** bis-voice · **Wave:** 3

**Files:** Modify `ACCT/calls/[callId]/page.tsx:88-106` and `ACCT/calls/[callId]/page.test.ts`.

- [ ] **Step 1: Red first.** In `page.test.ts`, add the `@/lib/access-log/note` mock (`noteOpened`, reset in `beforeEach`), with the `@/lib/auth` mock (`:19`) returning an agency access. Cases:
  - It is called once with `(an object with isAgency: true, A, { kind: "call", recordId: CALL.id })`. Mutation: pass `{ isAgency: false }`, FAILS.
  - `getCall` → `null` gives `notFound` and NO call.
  - A rejection rejects the page. Mutation: catch it, FAILS.
- [ ] **Step 2: Edit.** `:88` becomes `const access = await requireAccountAccess(accountId); const { isAgency, userId } = access;`. After `:106` (`if (!call) notFound();`) add `await noteOpened(access, accountId, { kind: "call", recordId: call.id });`, with a comment citing spec 4.1. It runs before any of the call's markup is returned. `in-account-service-reads.test.ts` already lists this file; nothing new there.
- [ ] **Step 3: Run** `pnpm --filter web exec vitest run "src/app/(dashboard)/dashboard/accounts/[accountId]/calls"`, then typecheck and lint, then the probes. Paste the results.
- [ ] **Step 4: Commit** the two paths: `feat(voice): the call page logs BIS's open of the call (F-118 part 1)`.

---

### Task 9: The inbox logs an opened conversation

**Tier:** medium · **Owner:** bis-comms · **Wave:** 3

**Files:** Modify `ACCT/conversations/page.tsx:281-285`, `ACCT/conversations/page.test.ts`, and the six sibling files `page.forwarders.test.ts`, `page.holding.test.ts`, `page.pagination.test.ts`, `page.sender-visibility.test.ts`, `page.webchat.test.ts`, `page.zone.test.ts` (mock only).

- [ ] **Step 1: Red first.** All seven files gain the `@/lib/access-log/note` mock, resolving. In `page.test.ts`, with the guard returning an agency access:
  - A `?c=` that is on the page is logged with `{ kind: "conversation", recordId: <that id> }`.
  - A `?c=` found by `getConversationSummary` (not on the page) is logged too.
  - A `?c=` that resolves to nothing, and a request with no `c`, make NO call. Mutation: log `c` before it resolves, FAILS.
  - A rejection rejects the page.
  - `?view=held` makes no call.
- [ ] **Step 2: Edit.** Replace `:285` with:

```ts
  // F-118 part 1 (spec 4.1): opening a thread is a record open; the thread's own read and the log run side by side,
  // and nothing renders until both have settled (owner ruling 4).
  const [messages] = active
    ? await Promise.all([listMessages(db, accountId, active.id), noteOpened(access, accountId, { kind: "conversation", recordId: active.id })])
    : [[] as Awaited<ReturnType<typeof listMessages>>];
```

  `mark-read.tsx:17-20` stays as it is: its effect-based write is still right for unread counts (spec §11 C3 explains why the page render itself is not run by a prefetch).
- [ ] **Step 3: Run** `pnpm --filter web exec vitest run "src/app/(dashboard)/dashboard/accounts/[accountId]/conversations"`, then typecheck and lint, then the probes. Paste the results.
- [ ] **Step 4: Commit** the eight paths: `feat(sms): opening a conversation logs BIS's open of it (F-118 part 1)`.

---

### Task 10: BIS access on the Team page, and ⌘K

**Tier:** medium · **Owner:** bis-frontend · **Wave:** 3

**Files:**
- Create: `apps/web/src/components/access-log/bis-access-section.tsx`, `bis-access-section.test.ts`
- Modify: `ACCT/team/page.tsx`, `ACCT/team/page.test.ts`
- Modify: `apps/web/src/lib/palette/registry.ts` (one entry after `nav:required-documents` at `:157-164`), `apps/web/src/lib/palette/registry.test.ts`

**Interfaces:** Consumes `readAccessLogPage`, `ACCESS_LOG_PAGE_SIZE` (T1), `resolveAccessLogNames`, `buildVisitRows`, `parseAccessCursor`, `encodeAccessCursor` and the five components (T4), `dbForRequest`, `getPersonPrefs`, `requestLocale`, `makeTr`, and `renderZone` (`lib/zone.ts:101`).

- [ ] **Step 1: `bis-access-section.test.ts`, red first.** It awaits the async component, then renders it with `renderToStaticMarkup`, inside `LocaleProvider`. It mocks `@/lib/db`, `@bis/db` (`readAccessLogPage`), `@/lib/access-log/names`, person-prefs and zone. Cases:
  - **Loaded:** the header reads "3 visits", the rows render through `BisAccessList`, and there is exactly ONE `nav` with `aria-label` "BIS access pages". "Older" links to `/dashboard/accounts/<A>/team?accessBefore=<encoded last visit>#bis-access` when `hasOlder` is set. "Newer" appears only when a cursor was given and links to `/dashboard/accounts/<A>/team#bis-access`, dropping the cursor; that is the house pattern, where Newer returns to the head (`ACCT/conversations/page.tsx:267-268`). Mutation: always render Newer, FAILS.
  - **Empty:** the empty sentence, no pager, and no button of any kind.
  - **Error:** `readAccessLogPage` rejecting renders `BisAccessError`, and the section does not throw. Mutation: remove the catch, FAILS. A names-resolver rejection does the same.
  - **The cursor:** `before="garbage"` calls `readAccessLogPage(db, A, null, 20)`, and a valid cursor passes it through. Mutation: ignore `before`, FAILS.
  - **Spanish:** an account `language: "es"` renders "3 visitas" and Spanish summaries.
  - **The zone:** the rows' `when` comes from the ACCOUNT's zone (`Pacific/Honolulu` in the fixture, with an instant whose day differs from Chicago's). Mutation: pass `"UTC"`, FAILS.
  - **The reads:** all of them go through `dbForRequest()` only. Assert that the module never imports `serviceDb` by checking the mock was never called.

  Implementation: `export async function BisAccessSection({ accountId, isAgency, before }: { accountId: string; isAgency: boolean; before?: string })`. In one `try`:
  1. `const db = await dbForRequest();`
  2. `[account, prefs]` from `db.from("accounts").select("timezone, language").eq("id", accountId).maybeSingle()` and `getPersonPrefs()`, throwing on `account.error`.
  3. `const accountLanguage = { language: … };` then `requestLocale({ account: accountLanguage, isOperator: isAgency, userLanguage: prefs.language })`. The named variable is the house style.
  4. The zone through `renderZone`, then `readAccessLogPage`, `resolveAccessLogNames` and `buildVisitRows(…, { base: `/dashboard/accounts/${accountId}` })`.
  5. Render the total line (`tr.count("accessLog.total", page.total)`, `tabular-nums`), then `BisAccessList`, then the pager (ghost link buttons, `accessBefore`, `#bis-access`). An empty page renders the `accessLog.empty` sentence instead.

  `catch` logs `bis access: account ${accountId}: ${loggableError(e)}` and returns `<BisAccessError />`.
- [ ] **Step 2: The Team page.** `ACCT/team/page.tsx` takes `searchParams?: Promise<{ accessBefore?: string }>`. Below the existing `Suspense` it renders:

```tsx
<BisAccessFrame>
  <Suspense fallback={<BisAccessSkeleton />}>
    <BisAccessSection accountId={accountId} isAgency={isAgency} before={accessBefore} />
  </Suspense>
</BisAccessFrame>
```

  Update the file's doc comment: the section reads its own data, has its own fallback, and has its own error state, so a failed log read never costs the Team card above (rule 5 per section). In `page.test.ts`, mock the section and assert two things for both the agency and an Owner: the markup carries `id="bis-access"`, and the section receives `accessBefore`. Mutation: drop the frame, FAILS.
- [ ] **Step 3: ⌘K.** In `registry.ts`, after `:164`:

```ts
  // F-118 part 1 (owner ruling 9): BIS access, the bottom of the Team page, for an Owner and the agency.
  if (base && (isAgency || isOwner)) {
    entries.push({
      kind: "href", id: "nav:bis-access", label: m["accessLog.title"], group: "navigation", agencyOnly: false,
      keywords: ["bis", "access", "log", "visits", "who looked", "acceso", "registro", "visitas"],
      href: `${base}/team#bis-access`,
    });
  }
```

  In `registry.test.ts`, add one case. An Owner and the agency each get `nav:bis-access` with that href. Staff (`buildPaletteEntries(BASE, false, false)`), a Technician (`…, true`) and the agency top level (`null` base) get none. `filterEntries(owner, "visitas")` and `filterEntries(owner, "who looked")` find it. Mutations: drop `isAgency ||` (the agency case FAILS); drop the guard (the Staff case FAILS). The anchor-parity check (`:284-310`) covers settings-group entries only, so the anchor is pinned by `bis-access-frame`'s test in T4 and by step 2's page test.
- [ ] **Step 4: Run.** `pnpm --filter web exec vitest run src/components/access-log "src/app/(dashboard)/dashboard/accounts/[accountId]/team" src/lib/palette src/components/command-palette.test.ts src/lib/i18n/ratchet.test.ts`, then typecheck and lint, then the probes. Paste the results.
- [ ] **Step 5: Commit** the six paths: `feat(design): BIS access at the bottom of the Team page, with every visit, its reason and what was opened, and in the command palette (F-118 part 1)`.

---

### Task 11: The route walk, so no page or route goes unclassified

**Tier:** medium · **Owner:** bis-platform · **Wave:** 4 (after T6–T9 are committed, so it starts green)

**Files:** Create `ACCT/access-log-routes.test.ts`.

- [ ] **Step 1: Write the test.** Use `typescript`'s AST, never a regex over text: comments are never nodes (`lib/documents/read-gate.test.ts:6-26`).

```ts
import { describe, it, expect, afterAll } from "vitest";
import { readFileSync, readdirSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, sep } from "node:path";
import ts from "typescript";

/**
 * F-118 part 1 (spec 4.2): every page and route under the two account trees is classified. A RECORD must call
 * the one logger in real code; anything else states why it is not a record. A new file in neither list fails BY
 * NAME, so a new record surface cannot ship without someone deciding. Plus: the file action logs before it
 * mints; the mint has exactly two app callers; the logger has exactly these importers; and no public, cron,
 * webhook or voice tree imports any access-log module (spec 2.2).
 */
const SRC = join(__dirname, "../../../../..");                 // apps/web/src
const ROOTS = ["app/(dashboard)/dashboard/accounts/[accountId]", "app/api/accounts"];
const A = "app/(dashboard)/dashboard/accounts/[accountId]";
const API = "app/api/accounts/[accountId]";
const rel = (p: string, base = SRC) => relative(base, p).split(sep).join("/");

const RECORD: Record<string, "noteOpened" | "noteOpenedApi"> = {
  [`${A}/contacts/[contactId]/page.tsx`]: "noteOpened",
  [`${A}/groups/[groupId]/page.tsx`]: "noteOpened",
  [`${A}/calls/[callId]/page.tsx`]: "noteOpened",
  [`${A}/conversations/page.tsx`]: "noteOpened",
  [`${A}/forms/[formId]/page.tsx`]: "noteOpened",
  [`${A}/contacts/export/route.ts`]: "noteOpened",
  ...Object.fromEntries(["ai-summary", "document-requests", "document-requirements", "documents", "email", "groups", "places",
    "relationships", "summary", "texts"].map((r) => [`${API}/contacts/[contactId]/${r}/route.ts`, "noteOpenedApi" as const])),
  ...Object.fromEntries(["document-requests", "documents", "places"].map((r) => [`${API}/groups/[groupId]/${r}/route.ts`, "noteOpenedApi" as const])),
};
const NOT_A_RECORD: Record<string, string> = {
  [`${A}/activity/page.tsx`]: "a list (ruling 2)",
  [`${A}/automations/page.tsx`]: "settings",
  [`${A}/billing/page.tsx`]: "settings",
  [`${A}/branding/page.tsx`]: "settings",
  [`${A}/calendar/page.tsx`]: "a list (ruling 2)",
  [`${A}/calls/page.tsx`]: "a list (ruling 2)",
  [`${A}/checklist/page.tsx`]: "agency work about the client, not a client record",
  [`${A}/contacts/import/page.tsx`]: "writes rows; shows no stored record",
  [`${A}/contacts/page.tsx`]: "a list (ruling 2); its drawer's routes are records",
  [`${A}/dashboard/page.tsx`]: "totals",
  [`${A}/documents/page.tsx`]: "a list (ruling 2); opening a file is logged by getDocumentUrlAction",
  [`${A}/forms/page.tsx`]: "a list (ruling 2)",
  [`${A}/pipeline/page.tsx`]: "a list (ruling 2)",
  [`${A}/settings/page.tsx`]: "settings",
  [`${A}/setup/page.tsx`]: "settings",
  [`${A}/tasks/page.tsx`]: "a list (ruling 2)",
  [`${A}/team/page.tsx`]: "settings; the BIS access section lives here",
  [`${A}/voice/knowledge/[version]/page.tsx`]: "the business's own facts, not a customer's",
  [`${A}/voice/page.tsx`]: "settings",
  [`${A}/website/page.tsx`]: "settings",
  [`${API}/search/route.ts`]: "returns names like a list; opening a result opens a logged record",
};

function walk(dir: string, keep: (name: string) => boolean, out: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) { if (e.name !== "node_modules") walk(p, keep, out); }
    else if (keep(e.name)) out.push(p);
  }
  return out;
}
const isEntry = (n: string) => n === "page.tsx" || n === "route.ts";
const isSource = (n: string) => /\.(ts|tsx)$/.test(n) && !/\.test\.(ts|tsx)$/.test(n);
const parse = (p: string) => ts.createSourceFile(p, readFileSync(p, "utf8"), ts.ScriptTarget.Latest, true,
  p.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
/** Positions of real calls to `name` (an identifier callee), anywhere in `node`. */
function callsTo(node: ts.Node, name: string): number[] {
  const at: number[] = [];
  const visit = (n: ts.Node) => {
    if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === name) at.push(n.getStart());
    ts.forEachChild(n, visit);
  };
  visit(node);
  return at;
}
const importsFrom = (sf: ts.SourceFile) => sf.statements.filter(ts.isImportDeclaration)
  .map((d) => (d.moduleSpecifier as ts.StringLiteral).text);

export function unclassified(base: string, roots: readonly string[], known: ReadonlySet<string>): string[] {
  return roots.flatMap((r) => walk(join(base, r), isEntry)).map((p) => rel(p, base)).filter((f) => !known.has(f)).sort();
}
export function missingLogger(base: string, record: Readonly<Record<string, string>>): string[] {
  return Object.entries(record).filter(([f, fn]) => callsTo(parse(join(base, f)), fn).length === 0).map(([f]) => f).sort();
}

describe("every page and route in the account trees is classified (spec 4.2)", () => {
  const known = new Set([...Object.keys(RECORD), ...Object.keys(NOT_A_RECORD)]);
  it("walks a real tree (positive control: more than 30 files)", () => {
    expect(ROOTS.flatMap((r) => walk(join(SRC, r), isEntry)).length).toBeGreaterThan(30);
  });
  it("no unclassified page.tsx or route.ts (mutation: add ACCT/zzprobe/page.tsx -> FAILS naming it)", () => {
    expect(unclassified(SRC, ROOTS, known)).toEqual([]);
  });
  it("no stale entry, and no file in both lists", () => {
    const now = new Set(ROOTS.flatMap((r) => walk(join(SRC, r), isEntry)).map((p) => rel(p)));
    expect([...known].filter((f) => !now.has(f))).toEqual([]);
    expect(Object.keys(RECORD).filter((f) => f in NOT_A_RECORD)).toEqual([]);
  });
  it("every record calls its logger in real code, imported from @/lib/access-log/note (mutation: delete noteOpened from calls/[callId]/page.tsx -> FAILS naming it)", () => {
    expect(missingLogger(SRC, RECORD)).toEqual([]);
    for (const f of Object.keys(RECORD)) expect(importsFrom(parse(join(SRC, f))), f).toContain("@/lib/access-log/note");
  });
  it("no not-a-record file calls the logger (the list stays honest)", () => {
    for (const f of Object.keys(NOT_A_RECORD)) {
      const sf = parse(join(SRC, f));
      expect([...callsTo(sf, "noteOpened"), ...callsTo(sf, "noteOpenedApi")], f).toEqual([]);
    }
  });
});

describe("files: logged before the URL is minted, and only two app callers mint (spec 4.2)", () => {
  it("getDocumentUrlAction calls noteOpened once, before signedDocumentReadUrl (mutation: move the note after the mint -> FAILS)", () => {
    const sf = parse(join(SRC, `${A}/contacts/documents-actions.ts`));
    const fn = sf.statements.find((s): s is ts.FunctionDeclaration => ts.isFunctionDeclaration(s) && s.name?.text === "getDocumentUrlAction");
    expect(fn).toBeDefined();
    const notes = callsTo(fn!, "noteOpened");
    const mints = callsTo(fn!, "signedDocumentReadUrl");
    expect([notes.length, mints.length]).toEqual([1, 1]);
    expect(notes[0]!).toBeLessThan(mints[0]!);
  });
  it("the read-URL mint has exactly two app callers: the file action and a customer's share link (mutation: call it from a third file -> FAILS)", () => {
    const callers = walk(SRC, isSource).filter((p) => callsTo(parse(p), "signedDocumentReadUrl").length > 0).map((p) => rel(p)).sort();
    expect(callers).toEqual([`${A}/contacts/documents-actions.ts`, "lib/document-shares/public-share.ts"]);
  });
});

describe("who may reach the logger (spec 2.2)", () => {
  const all = walk(SRC, isSource).map((p) => ({ f: rel(p), imports: importsFrom(parse(p)) }));
  it("the importers of @/lib/access-log/note are exactly the records and the file action (mutation: import it into lib/automations/fanout.ts -> FAILS)", () => {
    expect(all.filter((x) => x.imports.includes("@/lib/access-log/note")).map((x) => x.f).sort())
      .toEqual([...Object.keys(RECORD), `${A}/contacts/documents-actions.ts`].sort());
  });
  it("no public, cron, webhook or voice tree imports any access-log module", () => {
    const PUBLIC = ["app/api/cron/", "app/api/webhooks/", "app/api/voice/", "app/api/sms/", "app/api/concierge/", "app/api/d/",
      "app/api/s/", "app/api/unsubscribe/", "app/api/ops/", "app/b/", "app/c/", "app/f/", "app/u/", "app/d/", "app/s/", "app/cal/",
      "lib/automations/", "lib/voice/"];
    const bad = all.filter((x) => PUBLIC.some((p) => x.f.startsWith(p)) && x.imports.some((i) => /access-log/.test(i)));
    expect(bad.map((x) => x.f)).toEqual([]);
  });
});

describe("the walk itself (self-test on a throwaway tree)", () => {
  const base = mkdtempSync(join(tmpdir(), "access-log-routes-"));
  afterAll(() => rmSync(base, { recursive: true, force: true }));
  const put = (f: string, body: string) => { mkdirSync(join(base, f, ".."), { recursive: true }); writeFileSync(join(base, f), body); };
  put("app/x/[accountId]/known/page.tsx", "export default function P() { return null; }\n");
  put("app/x/[accountId]/new/page.tsx", "export default function P() { return null; }\n");
  put("app/x/[accountId]/rec/page.tsx", "// noteOpened(access, a, ref) is mentioned only here\nconst s = \"noteOpened(\";\nexport default function P() { return s; }\n");
  put("app/x/[accountId]/ok/page.tsx", "import { noteOpened } from \"@/lib/access-log/note\";\nexport default async function P() { await noteOpened({ isAgency: true }, \"a\", { kind: \"call\", recordId: \"b\" }); return null; }\n");
  it("reports an unclassified page by name", () => {
    expect(unclassified(base, ["app/x"], new Set(["app/x/[accountId]/known/page.tsx", "app/x/[accountId]/rec/page.tsx", "app/x/[accountId]/ok/page.tsx"])))
      .toEqual(["app/x/[accountId]/new/page.tsx"]);
  });
  it("a record whose only noteOpened is in a comment or a string is reported; a real call is not", () => {
    expect(missingLogger(base, { "app/x/[accountId]/rec/page.tsx": "noteOpened", "app/x/[accountId]/ok/page.tsx": "noteOpened" }))
      .toEqual(["app/x/[accountId]/rec/page.tsx"]);
  });
});
```

- [ ] **Step 2: Run it green.** `pnpm --filter web exec vitest run "src/app/(dashboard)/dashboard/accounts/[accountId]/access-log-routes.test.ts"`. Paste the summary. If a file reports, the plan's 19/21 count was wrong or a wave-3 task missed a surface: STOP and report which, and do not edit the lists to make it pass.
- [ ] **Step 3: Probes, in your own detached worktree** (`git worktree add --detach HEAD SCRATCH/al-t11/wt`, run `pnpm install --frozen-lockfile --prefer-offline` once there, and remove it with `git worktree remove --force` when done). Each probe below must fail BY NAME:
  - (a) delete the `noteOpened` line from `calls/[callId]/page.tsx`;
  - (b) move the file action's note below the mint;
  - (c) create `ACCT/zzprobe/page.tsx`;
  - (d) import `noteOpened` into `lib/automations/fanout.ts`;
  - (e) replace the call in `conversations/page.tsx` with a comment that names it.

  Paste each red line.
- [ ] **Step 4: Commit** the one path: `test(auth): every page and route in the account trees is classified as a record that logs or not a record, by name (F-118 part 1)`.

---

### Task 12: e2e: setup visits, the deep link and the Owner's read, the capture

**Tier:** medium · **Owner:** bis-e2e-qa · **Wave:** 4 · runs only in the orchestrator's `pnpm --filter web test:e2e` slot, after checking that no `screenshots.yml` run is in progress

**Files:**
- Modify: `apps/web/e2e/auth.setup.ts` (a FIFTH `setup(…)`, registered LAST, after `:379-439`)
- Modify: `apps/web/e2e/fixtures/entry-guards.test.ts:125-133` (the names list)
- Create: `apps/web/e2e/access-log.spec.ts`
- Modify: `apps/web/screenshots/capture.spec.ts:216-230` (give the demo account a reason before the first capture)

- [ ] **Step 1: The fifth setup test.** Every agency spec enters the fixture account or Test Client One. With the gate, each would now meet the chooser. One setup test gives both accounts a reason for the shared agency session. A visit lasts two hours, so a local run longer than that meets the chooser late, and that is the gate working (the report says so). CI runs in about nine minutes.

```ts
// F-118 part 1: the agency's session gives a reason ONCE for the two accounts the agency specs enter, so every
// spec after this one finds a live visit (two hours). Registered last: it needs the client fixture above.
setup("agency gives a reason for the fixture account and Test Client One", async ({ browser }) => {
  const fixture = JSON.parse(readFileSync(CLIENT_FIXTURE_FILE, "utf8")) as { accountId: string };
  const seeded = await lookupSeededAccountId(serviceDb(), SEEDED_ACCOUNT_NAME);
  const ctx = await browser.newContext({ storageState: AUTH_FILE });
  try {
    const page = await ctx.newPage();
    for (const id of [fixture.accountId, seeded]) {
      await page.goto(`/dashboard/accounts/${id}/dashboard`);
      await expect(page).toHaveURL(new RegExp(`/dashboard/enter/${id}`));
      await page.getByRole("button", { name: m["accessLog.reason.setup"], exact: true }).click();
      await expect(page).toHaveURL(new RegExp(`/dashboard/accounts/${id}/dashboard$`));
    }
  } finally {
    await ctx.close();
  }
});
```

  The imports are `expect` (from `@playwright/test`), `m` (`../src/lib/messages`), `lookupSeededAccountId` (`./fixtures/seeded`) and `SEEDED_ACCOUNT_NAME` (`./support`). `entry-guards.test.ts` imports this file under mocks (`:19-56`), where `expect` and the helpers are only dereferenced inside the test body, which never runs there. Confirm that by running it. Append `"agency gives a reason for the fixture account and Test Client One"` to the expected list at `:127-132`, and update the comment above it ("a fifth…, F-118"). Run `pnpm --filter web exec vitest run e2e/fixtures` and paste the summary. Mutation: drop the new `setup(…)`, and the names case FAILS.

- [ ] **Step 2: `access-log.spec.ts`.** It runs on the PER-RUN FIXTURE ACCOUNT. Read the fixture through a run-time `fullFixture()`, the `contacts-drawer.spec.ts:72-93` shape: `accountId`, `companyName`, `contactName` (`auth.setup.ts:217,270`). Find the fixture contact's id with `serviceDb().from("contacts").select("id").eq("account_id", accountId).eq("last_name", contactName.split(" ").slice(1).join(" "))`, which is read-only. One test, `test.describe.configure({ timeout: 180_000 })`:
  1. **A new agency session:** `browser.newContext()` with NO storage state, `clerkSetup()`, `signInWithTicket(page, await clerkClient(), agency.clerkUserId)` and `setActiveOrganization(page, agency.clerkOrgId)`. Both come from `e2e/.auth/agency-fixture.json` (`auth.setup.ts:100-105`). A new sign-in is a new session with no visit.
  2. **The deep link:** `page.goto(`/dashboard/accounts/${accountId}/contacts/${contactId}`)`. Expect the URL to match `/dashboard/enter/<accountId>?to=` and the heading to be `m["accessLog.enter.heading"]` with `{name}` = `companyName`. Expect `getByText(contactName)` to have count 0: the chooser shows NOT the customer.
  3. Click `m["accessLog.reason.support"]`. Expect the URL to END with the contact path. That is the `x-bis-path` round trip, spec §3.2's ASSUMPTION, proven here. Then expect `recordPage(page)` (`support.ts:131-140`) to show `contactName`.
  4. **No download from a prefetch (C2):** `goto` the contacts list, `hover()` the `m["contacts.export"]` link, `waitForLoadState("networkidle")`, and close this context.
  5. **The Owner reads it:** `browser.newContext({ storageState: "e2e/.auth/client-state.json" })`, `goto …/team#bis-access`. Locate `section#bis-access [data-bis-access-visit]` filtered by `hasText: m["accessLog.reason.support"]` and expect count 1. Expect it to contain `"E2E Agency"` (the per-run agency's Clerk name, `auth.setup.ts:97`) and the sentence "Opened 1 customer." (`m["accessLog.summary.opened"]` with `{list}` = `m["accessLog.count.customersOne"]`). Click `m["accessLog.show"]` and expect a link named `m["accessLog.item.customer"]` with `{name}` = `contactName`. Expect `section#bis-access` NOT to contain `m["accessLog.summary.downloadsOne"]`; its positive control is the "Opened 1 customer." assertion just above.
  6. **Staff cannot read it:** `browser.newContext({ storageState: "e2e/.auth/staff-state.json" })`, `goto …/team`, and expect the URL NOT to end in `/team` (`staff-roles.spec.ts:150-155` shows the redirect).

  Close every context in a `finally`. The spec creates no named rows, so `fixture-names.test.ts` needs no entry. Confirm that by running `pnpm --filter web exec vitest run e2e/fixtures`.
- [ ] **Step 3: The capture.** In `capture.spec.ts`, right after the first `page.goto(…/dashboard)` at `:229`, add one helper call, `await enterOnce(page, demo.accountId)`. If the URL matches `/dashboard/enter/`, it clicks `m["accessLog.reason.setup"]` and waits for `/dashboard$`. Define it in the same file with a doc comment (F-118: the capture's agency session gives the demo account a reason; the demo's log keeps ids only). The capture runs on bis-ci (`screenshots.yml`), so it works only after 0105 is there.
- [ ] **Step 4: The orchestrator runs the suite** (Task 13, step 4). Paste the spec lines from the run (a pass, or the first failure with `gh run view --log-failed` for CI). Probe, in the orchestrator's slot and on a COPY branch only: put back `<Link>` on Export and remove the route's RSC check. Step 2.5's `not.toContain` must then FAIL. If it stays green, the prefetch never reached the handler, and the anchor and the 204 are belt and braces; say so in the report.
- [ ] **Step 5: Commit** the four paths: `test(e2e): the agency gives a reason once per run; a deep link meets the chooser and lands where it pointed; the Owner reads the visit on Team (F-118 part 1)`.

---

### Task 13: Whole-branch review, design review, apply order, merge

**Tier:** high · **Owner:** the orchestrator, dispatching bis-reviewer (opus) and bis-design-reviewer · **Wave:** 5

- [ ] **Step 1: Whole-branch review.** bis-reviewer on opus, in its OWN detached worktree at the branch head (with its own `pnpm install --frozen-lockfile --prefer-offline`, removed with `git worktree remove --force`), and its own replica port 55852 for 0105. The brief says, in its own words, "never git checkout, never git stash, never amend; probe in your worktree only". It must re-run:
  - every T1 mutation on the replica, plus three of its own;
  - T3's gate and note probes;
  - T11's five probes;
  - one second-account probe per new read: `newestAgencyVisitStart` without its account filter; `resolveAccessLogNames` without `.eq("account_id")` on documents; `note_agency_open` looking the visit up without the account.

  It answers for each owner ruling, 1 to 9, with a file:line that implements it. It also answers four questions:
  - Can any record's data reach the browser before its note settles?
  - Can a client ever reach the RPC?
  - Can `to` ever leave the account?
  - Does every `noteOpened` sit after its proof?

- [ ] **Step 2: Design review.** bis-design-reviewer covers the chooser and the BIS access section:
  - dark and light (the `.dark` class), the blur fallback, English, Spanish and the pseudo-locale;
  - keyboard: Tab through the four tiles with a visible focus ring; the Show/Hide toggle with `aria-expanded`; Esc closes nothing because nothing overlays;
  - no primary on either view;
  - skeleton shapes;
  - the 7 AM read of every string in T2's table, and the disclosure line in both languages.

  ONE fix agent then takes the combined list from steps 1 and 2. A fix touching T1 or T3 code is re-reviewed by the same reviewer; other fixes are not (the speed process).
- [ ] **Step 3: Branch freshness.** `git fetch` and compare `origin/main` with the branch's merge base. If `main` moved, MERGE `main` into `feat/access-log` (never rebase, never force-push). Check that no migration numbered 0105 or higher arrived with it. If one did, renumber this file and every reference in the plan, spec and tests BEFORE anything is applied. Confirm that 0104 is on bis-ci and production. Re-run every gate on the combined tree.
- [ ] **Step 4: Gates, one at a time.**
  - Push the branch; CI `verify` runs `pnpm check` (including `access-log-live.test.ts`) and the build.
  - Locally: `pnpm --filter web build`.
  - Locally, and only after checking that no `screenshots.yml` run is in progress: `pnpm --filter web test:e2e` against bis-ci. This needs 0105 on bis-ci first (Step 5); until then the local run goes after Step 5.
- [ ] **Step 5: Apply 0105, in this order, once the final review has passed the migration unchanged.**
  1. **bis-ci:** dispatch `ci-project-setup.yml` from `feat/access-log`: `push-dry-run` (read the plan it prints: only `0105_access_log.sql`), then `push`.
  2. **Re-run CI on the HEAD SHA.** `e2e`'s `ci-migrations-applied.sh` now passes. Read `gh api repos/{owner}/{repo}/commits/<sha>/check-runs` for that SHA: `verify` and `e2e` must both be `success`.
  3. **Production:** MCP `apply_migration` once, name `access_log`, with the file's exact text. It is ASCII only with no backslash, so the `\u` trap does not apply. Verify by comparing `md5(array_to_string(statements, ''))` in `supabase_migrations.schema_migrations` with the file's md5. This happens BEFORE the merge deploy: the old build ignores the tables, and the new build calls the functions on every agency request.
  4. **Parity** (`docs/runbooks/ci-supabase-project.md`): run this on bis-ci and on production (read-only `execute_sql`). The two md5 values must be equal.

```sql
select md5(string_agg(x, '|' order by x)) from (
  select 'fn:' || p.oid::regprocedure::text || ':' || md5(pg_get_functiondef(p.oid)) || ':' || coalesce(array_to_string(p.proacl::text[], ','), '') as x
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where (n.nspname = 'public' and p.proname in ('start_agency_visit','agency_visit_live','note_agency_open','access_log_page'))
      or (n.nspname = 'app' and p.proname = 'agency_visit_window')
  union all select 'acl:' || c.relname || ':' || coalesce(array_to_string(c.relacl::text[], ','), '')
    from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relname in ('agency_visits','agency_visit_items')
  union all select 'col:' || c.relname || '.' || a.attname || ':' || format_type(a.atttypid, a.atttypmod) || ':' || a.attnotnull || ':' || coalesce(array_to_string(a.attacl::text[], ','), '')
    from pg_attribute a join pg_class c on c.oid = a.attrelid join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relname in ('agency_visits','agency_visit_items') and a.attnum > 0 and not a.attisdropped
  union all select 'con:' || conrelid::regclass::text || ':' || conname || ':' || pg_get_constraintdef(oid)
    from pg_constraint where conrelid in ('public.agency_visits'::regclass, 'public.agency_visit_items'::regclass) and contype <> 'n'
  union all select 'idx:' || indexrelid::regclass::text || ':' || pg_get_indexdef(indexrelid)
    from pg_index where indrelid in ('public.agency_visits'::regclass, 'public.agency_visit_items'::regclass)
  union all select 'pol:' || tablename || ':' || policyname || ':' || permissive || ':' || cmd || ':' || roles::text || ':' || coalesce(qual, '')
    from pg_policies where schemaname = 'public' and tablename in ('agency_visits','agency_visit_items')
) s;
```

- [ ] **Step 6: The PR and the merge.** Open the PR from `feat/access-log`, with the body ending in the attribution lines. Arm `gh pr merge <n> --auto --squash`. Read the check runs for the HEAD SHA, not an earlier run. If a REST merge is ever needed, PUT with the `sha` pinned, and read the PR's state before any retry.
- [ ] **Step 7: Deploy verification.**
  - The production deployment is READY, its meta names the merge SHA, and it is aliased to `app.bis-rgv.com`.
  - Smoke checks: `/` 200, `/sign-in` 200, `/api/cron/reminders` 401, `/b/bogus` 404.
  - The marker only this work emits: the deployment's output (Vercel MCP, deployment files) contains the route `/dashboard/enter/[accountId]`.
  - The owner signs in and opens one account. The chooser appears; choosing "Support request" lands on the account; Team then shows "BIS access" with that visit.
- [ ] **Step 8: Ledger and agent facts** (orchestrator only).
  - Record in `.superpowers/sdd/progress.md`: the spec corrections C1–C19; the two owner vetoes still open (C10, C11); and the finding below.
  - Add one line to `.claude/agents/bis-platform.md`'s **Claims** fact: "the agency branch now requires a live visit (`lib/access-log/gate.ts`); `agencyVisit: "not-required"` is pinned to `lib/proposals/actions.ts`". Commit it on a docs branch later; never on `main`.
  - Finding: every local e2e run and every screenshot capture on bis-ci writes visits into Test Client One's and the demo account's logs. Those rows can never be deleted (ids only); they leave only with the account. CI's own stacks are thrown away.

## Orchestrator and owner checklist (in order)

1. **Owner, before wave 3:** confirm or veto **C10** (a created or adopted company starts its creator's Setup visit) and **C11** (deciding a suggestion from the work list needs no visit, and the Owner's note says so). On a veto: for C10, T5 drops its Step 4 and T12 adds a Setup click to `blueprints.spec.ts:109` and `vetting.spec.ts:102`; for C11, T3 drops Step 7's carve-out and the agency-lists sentence loses its suggestion clause (T2 re-runs).
2. Run `pnpm install --frozen-lockfile --prefer-offline` once in the worktree, before wave 1.
3. Wave 1: T1 and T2. Before wave 2, review T1 (high; opus with probes, in its own worktree and on its own replica port).
4. Wave 2: T3 (review it: high) and T4 (one review: medium).
5. Wave 3: T5–T10, with one review each for the medium tasks. Then push the branch so CI `verify` runs the whole suite. The `e2e` job's red on 0105 is expected.
6. Wave 4: T11, then T12, run in your gate slot.
7. Task 13, steps 1–7. 0105 goes to bis-ci, then production, then the parity check, then the merge. **Never** apply it before the final review has passed it unchanged.
8. **Owner, after the deploy:** approve the trust-pack sentences, which go in the owner's private document and never in this repo. Their content must cover:
   - What is now true: a reason is chosen before BIS enters; Owners read a log of each visit and everything opened, on the Team page; the log is append-only for every app role; it is kept for the life of the account.
   - Limit one (ruling 3): BIS's three lists that cover every business at once (open work, including deciding a suggestion from it; screened calls; phone numbers) are not gated or logged, and anything opened from them is.
   - Limit two (ruling 6): maintenance straight on the database (the Supabase dashboard, or SQL with the service key or the owner role) bypasses the app, is not in this log, and is not bound by its grants.

   The orchestrator drafts the exact wording in the final report, not in a file.
9. **Owner, later:** create the production Clerk instance (unchanged, already pending). Note that every agency person's name in the log is a snapshot taken when the visit starts: a later name change in Clerk does not rewrite old visits.

## Self-review (done while writing, 2026-10-29)

- **Spec coverage.**
  - §2.1 (who is BIS) is the existing `app_role` check in T3; the actor-name snapshot is `actorNameFor` in T3.
  - §2.2 (background reads) is pinned by T11's no-import case.
  - §2.3 (ruling 3) is disclosed in T2 and T4 (the frame), carved out in T3 Step 7, and covered in the trust pack (checklist 8).
  - §2.4 (`act`) is T3 Step 3.
  - §3.1 (the gate) is T3. §3.2 (the chooser) is T5, with `to` in T3 Step 1. §3.3 (the window) is T1's window cases.
  - §4.1 (what is logged) is T6–T9, with C1 and C2 in T7. §4.2 (the logger and the guard) is T3 and T11. §4.3 (cost) is T1 Step 8b, report only.
  - §5 is T1. §5.4 (teardown) is T1's cascade and pure cases.
  - §6.1 is T10. §6.2 is T4's view and names. §6.3 is T2, T4 and T10.
  - §7 is checklist 8.
  - §8's tests: rows 1–8 are T1; 9 is T3 Steps 2–3; 10 is T3 Step 4; 11 is T11; 12 is T5 Step 1; 13 is T4 Step 1; 14 is T2; 15 is T12.
  - The brief's must-haves are all covered: the 0105 task and its replica note (T1, Global Constraints), the e2e fallout (T12: the setup test, `entry-guards.test.ts`, the capture), the pinned lists that were checked (`ACCOUNT_OWNED_TABLES` in T1, `FK_PAIRS` unchanged because neither table has a contacts FK, `schema-grants-guard` unchanged per C4, `in-account-service-reads` in T3, `proposals/actions.test.ts:80` in T3, `entry-guards` in T12, `request-locale-callers` in T5, `read-only.test.ts` in T3 and T7), the route walk (T11), and the final task (T13).
- **Pinned lists grepped, and what each says.**
  - `ai-acts-schema.test.ts:848-879` (`FK_PAIRS`, 23 pairs into contacts): neither new table references contacts, so no change.
  - `ACCOUNT_OWNED_TABLES` readers: T1 adds the "not on the list" pin, in the shape of `one-switch-schema.test.ts:569-574`.
  - `e2e/fixtures/sweep.ts:125-130` deletes each listed table, then the account, which cascades the log away.
  - `fixture-names.test.ts`: T12 creates no named rows.
  - `messages-readers.test.ts`: the names resolver reads `conversations`, never `messages`.
  - `consent/copy.test.ts:42,112`: no regex matches `accessLog.`.
  - `palette.spec.ts:85,111,135,151,168`: no query matches the new entry.
- **Placeholders.** None. Where a test copies an existing helper (`seedAccount`, the fake-client shape, the forms page's mock set), the plan names the file and lines to copy. That is deliberate: those inserts carry columns this plan did not read, and the source wins.
- **Probes checked for "can it fail".**
  - T1 M10: the probe was rewritten from "drop the index" to "delete the on-conflict clause". Dropping only the index makes the function ERROR, which also reds the test, but a delete-the-clause probe produces the wrong OUTPUT the memory asks for.
  - T1 M11 fails two cases; the named one is among them.
  - T3 Step 2 case 4 (header for another account) and T5 Step 1 (B `to`) are separate layers, each probed separately, so neither masks the other.
  - T7's Word-file case exists because "log `mode`" would otherwise survive.
  - T12 Step 4's probe may stay green, because the prefetch might never reach a route handler. The plan says what that means, rather than counting it as proof.
- **Names used across tasks:** `noteOpened`, `noteOpenedApi`, `NoteAccess`, `OpenedRef`, `requireAgencyVisit`, `agencyVisitOk`, `startVisitForCaller`, `lastVisitEndedRecently`, `safeReturnPath`, `enterHref`, `accountPathOf`, `BIS_PATH_HEADER`, `readAccessLogPage`, `resolveAccessLogNames`, `buildVisitRows`, `parseAccessCursor`, `encodeAccessCursor`, `BisAccessFrame`, `BisAccessList`, `BisAccessSkeleton`, `BisAccessError`, `BisAccessSection`, `ReasonTiles` and `agencyVisit: "not-required"` are spelled the same in every task.
