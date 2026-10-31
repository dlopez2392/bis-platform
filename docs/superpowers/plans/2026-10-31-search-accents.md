# Contacts search that ignores accents and finds full names and phone digits (F-092 part 1): implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** "Garcia" finds "García", "garcia maria" finds "María García López", and "+52 1 899 123 4567" finds the customer stored as "+528991234567", in the contact list, its export, ⌘K and every pick-a-customer box, with the boxes showing the best match first and the matched letters set in weight 600; households and businesses follow the same rules.

**Architecture:** Migration 0108 installs `pg_trgm` in the `extensions` schema and adds two stored generated columns, `contacts.search_name` (first, last and business name, each folded by 0106's `app.contact_name_fold`, joined by spaces) and `client_groups.search_name`, each behind a trigram GIN index. One import-free reader, `contactSearchPlan` (`packages/db/src/contact-search.ts`), turns the typed text into folded words and phone digits; `withSearch` keeps today's four raw clauses and ADDS "every word in `search_name`" and the `phone_national` clause, so the list, its real total and the export still share one filter and never lose a match. A new `searchContacts` ranks the small boxes in three tiers (exact, every word starts a word, contains). A pure helper maps matches back onto the displayed text for highlighting.

**Tech Stack:** PostgreSQL 17 (Supabase) with `pg_trgm`, plpgsql, supabase-js/PostgREST `or()`/`and()` filters, Next.js App Router (server page, GET route, server actions), React client components, vitest, Playwright (bis-e2e-qa only).

**Spec:** `docs/superpowers/specs/2026-10-31-search-accents-design.md` (owner rulings in its section 9, all DECIDED 2026-10-31). Every file and line below was read at `21162c13` (code identical to `af5976fa`).

## Global Constraints

- Migration number **0108** (`packages/db/supabase/migrations/0108_contact_search.sql`). 0107 (`0107_calendar_agenda.sql`) is the newest file and is on production: never edit it or any earlier file.
- Owner rulings (spec section 9, DECIDED 2026-10-31): **Q1** ñ and n match both ways (the existing `app.contact_name_fold` / `nameFold`, unchanged). **Q2** a term is a phone search at **4** digits (`MIN_PHONE_SEARCH_DIGITS = 4`, today's rule). **Q3** the contact list keeps its chosen sort, its cursor paging (`?before=`), exactly one pager and its real total (`countContacts`) while searching; ⌘K and the pick-a-customer boxes rank best match first. **Q4** households and businesses follow the same rules, with `client_groups.search_name` in 0108.
- The match set is a strict SUPERSET of today's (spec D4): `withSearch` keeps `first_name`, `last_name`, `email`, `phone` raw `ilike` and the `phone_key` digits clause, and only adds clauses.
- Exact lookups do not change (spec D8): `findDuplicate`, `listContactsOnNumber`, caller ID, forms, the text-back. Calls and conversations search do not change (D9).
- Every query runs on the caller's RLS client (`dbForRequest()`), never `serviceDb()`; archived and merged-away contacts and a shared number's holding record never appear (`withArchived`, the holding skip).
- Copy: English and usted Spanish, every English key with its `.es` twin on the very next line, under the `contacts.search.` namespace; no milestone codes, no arrows, no `{{template}}`; the "landscaper at 7 AM" read; survives the pseudo-locale's +35% at 375 px. `apps/web/src/lib/messages.ts` has exactly ONE writer in this plan (T6).
- DESIGN.md: tokens only (no hard-coded colour, radius or shadow); highlighting is weight 600 in a `<mark>` reset to `bg-transparent text-inherit` (hierarchy by weight first, colour last); loaded, empty and error states (rule 5); no spinners (rule 7); `/styleguide` entry for the new component.
- The 50,000-contact budget (spec 4.5): a list page plus its count under **150 ms**, the ⌘K contacts half (three tiers) under **100 ms**, both at the 95th percentile, measured on a real PostgreSQL **17.6** replica as a signed-in Owner under RLS (T12).

## Rules for every agent (shared worktree)

Worktree: `C:\Users\danlo\bis-platform\.claude\worktrees\search` (Git Bash: `/c/Users/danlo/bis-platform/.claude/worktrees/search`), branch `feat/search-accents`.

1. **Never** `git stash` (any form), `git checkout`, `git switch`, `git reset`, `git rebase`, `git commit --amend`, `git add -A` or `git add .`, or push. Another agent's files are in this tree. Commit only your task's named paths: `git add <paths>` then `git commit -m "<type(scope): what and why>" -- <paths>`. If `.git/index.lock` exists, wait and retry; never delete it.
2. **No `@bis/db` vitest against bis-ci (or any Supabase project) until the orchestrator says 0108 is there.** The db suite's globalSetup sweep (`packages/db/src/test/global-setup.ts`) and every live test run against whatever project the shell names, and bis-ci has no `search_name` until then. Local `@bis/db` runs are exactly two kinds: (a) `withRollback` files against YOUR OWN localhost replica, with `SUPABASE_DB_URL=postgresql://postgres@localhost:<your port>/<db>` on that one command line and no other Supabase variable in the shell (the sweep then prints `[sweep] no Supabase credentials; skipping abandoned-fixture sweep`: paste it); (b) pure files (no database), with no Supabase variable at all. Every `withTestAccount` file (`*-live.test.ts`, `contacts.test.ts`, `client-groups.test.ts`) is proven by CI `verify` only, read by the orchestrator FOR THE HEAD SHA.
3. **Env.** This worktree has no `packages/db/.env` and no `apps/web/.env.local`: never create, copy or edit one. A web test that needs env sources the main checkout's file into that one shell only (`set -a; . /c/Users/danlo/bis-platform/apps/web/.env.local; set +a; pnpm --filter web exec vitest run <file>`), and never in a shell that then runs `@bis/db` vitest.
4. **e2e** runs only on the per-run fixture account. `Test Client One` (contact Maria Garcia, opportunity Deck build) is READ-ONLY; its Maria Garcia carries no accent. Only bis-e2e-qa writes Playwright; only the orchestrator runs it, one gate at a time.
5. **Gates** (`pnpm check`, `pnpm --filter web build`, `pnpm --filter web test:e2e`) are the orchestrator's, one at a time. Agents run their own files by path.
6. Judge every vitest run by its own summary block (`Test Files … | Tests …`), never the exit code. `@bis/db` prints a trailing `ERR_PNPM_RECURSIVE_EXEC_FIRST_FAIL "Command vitest not found"` after the real results. A `-t` filter that matches no name skips silently: paste the summary line showing the expected count.
7. **Red first, and the red is real**: paste the failing assertion line, then the green summary line. Each named mutation is run and fails BY NAME; if one cannot fail, say so and substitute one that can.
8. Every UI task's green step also runs `pnpm --filter web typecheck` and `pnpm --filter web lint` (0 errors). No component body calls `Date.now()` or `new Date()` without an argument.
9. One `pnpm install --frozen-lockfile --prefer-offline` in the worktree, by the orchestrator, before wave 1 (no `node_modules` here on 2026-10-31). Agents never reinstall.
10. Stay inside your task's file list. A file another task owns is read-only to you; if you need it changed, stop and say so in your report.

## Pre-flight (measured 2026-10-31 by the orchestrator, read-only, identical on production `tlbkbmlrfafquucsmsmm` and bis-ci `odnobiodsftffphuuosz`)

| Check | Query | Answer on both |
|---|---|---|
| `extensions` schema exists | `select count(*) from pg_namespace where nspname = 'extensions'` | `1` |
| `pg_trgm` installed? | `select count(*) from pg_extension where extname = 'pg_trgm'` | `0` (not installed) |
| `pg_trgm` available | `select default_version from pg_available_extensions where name = 'pg_trgm'` | `1.6` |
| The fold exists and is immutable | `select provolatile from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'app' and p.proname = 'contact_name_fold'` | `i` |
| Contacts | `select count(*) from public.contacts` | production 53, bis-ci 41 |

So 0108 says `create extension if not exists pg_trgm with schema extensions` and names every operator class `extensions.gin_trgm_ops`. `pg_trgm` is a trusted extension (its control file says `trusted = true`, as `btree_gist`'s does), which is why the migration role may create it, as 0016 created `btree_gist`.

Still **ASSUMPTIONS**, each with its proof:
- **A1.** The Supabase CLI's Docker images that CI's `verify` and `e2e` start (`.github/scripts/ci-local-supabase.sh:304-305`, bootstrap then `supabase db push`) carry `pg_trgm` and an `extensions` schema. Proven by CI `verify` applying 0108 on the first push that carries T1 (checklist step 3); a red there is an ENVIRONMENT finding first (CLAUDE.md, runbook section 6).
- **A2.** The local PG17.6 replica can load `pg_trgm`. The unpacked copy most plans use (`…/88d51cd6-…/scratchpad/ca-t1/pg17/pgsql`) holds only `btree_gist` and `plpgsql` (checked 2026-10-31: its `share/extension` lists nothing else). The archive beside it, `…/88d51cd6-6c5b-4497-af8a-63647f233ba6/scratchpad/ca-t1/pg17.zip` (329,891,687 bytes), holds `pgsql/lib/pg_trgm.dll`, `pgsql/share/extension/pg_trgm.control`, `btree_gin.dll` and `btree_gin.control` (`unzip -l`, checked 2026-10-31). Each replica agent unzips its OWN copy (T1 Step 1); never write into another session's scratchpad.
- **A3.** PostgREST accepts a nested `and(...)` inside `or(...)` and an unquoted operand holding a space (`search_name.ilike.% ana%`). Today's raw clauses already send spaces unquoted (`contacts.test.ts:117`'s "trevi" cycle includes "rosa trevino"-style terms); the nested `and` is proven by T4's live file on CI.

## Corrections to the spec made while planning (the source wins)

1. **The Technician case is not a db test** (spec 7 and 11-T3 said "the T3 db test runs a search as a Technician session"). A live PostgREST call as a Technician needs a signed token; only a local run has the replica's JWT secret (`BIS_REPLICA_JWT_SECRET`, `packages/db/src/test/ai-acts-schema.test.ts:831-834`: "CI's stack never exposes its own"), so on CI the case would be SKIPPED, and a skip is not a pass. A SQL-level case (`set role authenticated` and select by `search_name`) cannot fail for any change this plan makes: the column adds no path around `contacts_technician_scope` (`0068_mine_unassigned_technician.sql:103-107`). The property is held where THIS plan could break it: T5's route and action tests pin that `searchContacts` receives the request client (`dbForRequest()`'s result; mutation: hand it `serviceDb()` → FAILS), and `ACCT/in-account-service-reads.test.ts` already refuses a new `serviceDb` import in these files.
2. **The highlight lands in three other owners' files**, so it is three tasks, not one: the shared component is new in `apps/web/src/components/` (bis-frontend's; T7, with the palette rows), the Add job rows are bis-booking's (`ACCT/calendar/job-sheet.tsx`, T9), and the held-email rows and the shared-number mover are bis-comms' (`ACCT/conversations/held-email-search*.ts*`, `holding-move.tsx`, T10).
3. **`searchContacts` takes no `assignee`** (spec 5 listed `assignee?`): no box filters by Mine or Unassigned, and nothing would pass it.
4. **The `phone_national` clause carries only a full ten-digit national number that differs from the key** (spec 4.2 said "whenever that differs"). For a partial, `phoneNational` returns the typed digits unchanged (`dedupe-keys.ts:19-24`): "+1 956 55" would add `phone_national ilike '%195655%'`, a clause that means nothing.
5. **The extension list is pinned in a third place**: `packages/db/src/ci/sql-files.test.ts:194-197` holds both parity files' `where e.extname in ('btree_gist', 'plpgsql')` literally. T1 moves all three together.
6. **The measurement runs on PostgreSQL 17.6, not the PG18 install** (the brief named PG18). Production is PG17, and PG18's skip scan serves an index whose leading column is unconstrained (`Index Searches: N>1`), which made a read 3.8 s on PG18 that was ~41 s with PG17's plan (memory `bis-local-db-replica`, contacts-archive 0103 review). Fallback only if the archive is gone: PG18 at `C:\Program Files\PostgreSQL\18` (it has `pg_trgm`), with every plan checked for `Index Searches: N>1`.
7. **The empty state's long query wraps without touching `EmptyState`** (`apps/web/src/components/empty-state.tsx`, bis-frontend's): T6 passes `className="[overflow-wrap:anywhere]"`, and `overflow-wrap` is inherited by the title and body.
8. **`phoneSearchDigits` changes for a "+" term**: today "+1 956 55" gives `195655` (which misses +19565550199); after T4 it gives `95655`. Its own pins (`packages/db/src/contacts-phone.test.ts:63-77`) all stay green: none starts with "+" except "+1 956 555 0199", which gives `9565550199` both ways.

---

## Shared facts every task relies on

`ACCT/` = `apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/`. `MIG/` = `packages/db/supabase/migrations/`. `DB/` = `packages/db/src/`. `WEB/` = `apps/web/src/`. `ROUTE` = `WEB/app/api/accounts/[accountId]/search/route.ts`.

### SQL interfaces (T1)

```text
extension pg_trgm 1.6, schema extensions
app.contact_search_name(p_first text, p_last text, p_company text) returns text
    plpgsql IMMUTABLE PARALLEL SAFE, SECURITY INVOKER, set search_path = pg_catalog, pg_temp
    the three app.contact_name_fold() results that are not '', joined by one space; NULL when all are ''
    EXECUTE: authenticated, service_role (a stored generated column runs its function as the WRITING role); not PUBLIC, not anon
public.contacts.search_name text GENERATED ALWAYS AS (app.contact_search_name(first_name, last_name, company_name)) STORED
public.client_groups.search_name text GENERATED ALWAYS AS (app.contact_name_fold(name)) STORED      -- '' for a blank name, never NULL
index contacts_search_trgm on public.contacts using gin (search_name, first_name, last_name, email, phone, phone_key, phone_national),
    every column extensions.gin_trgm_ops
index client_groups_search_trgm on public.client_groups using gin (search_name, name), both extensions.gin_trgm_ops
No grant on either column (table-level SELECT for authenticated already covers it; nothing writes a generated column).
No new SECURITY DEFINER: EXPECTED_DEFINERS (definer-search-path.test.ts:31-86) stays 37.
No client write changes: the digest (proposals-drop.test.ts:108) stays 49|e0df0cc230da2dce6fa93b26b43e6d46.
```

### TypeScript interfaces

`DB/dedupe-keys.ts` (T1; import-free, already exported as `@bis/db/dedupe-keys`):

```ts
/** One character of app.contact_name_fold: its mapped character if that is in [a-z0-9 ], else "". Per code point. */
export function foldChar(ch: string): string;
/** app.contact_search_name: the non-empty folds of first, last and business name, joined by one space; null when none. */
export function contactSearchName(first: string | null | undefined, last: string | null | undefined, company: string | null | undefined): string | null;
```

`DB/contact-search.ts` (T2; new; imports only `./dedupe-keys`; exported as `@bis/db/contact-search`):

```ts
export const MAX_SEARCH_LENGTH = 80;          // search-term.ts's MAX_TERM_LENGTH
export const MAX_NAME_TOKENS = 6;
export const MIN_PHONE_SEARCH_DIGITS = 4;     // owner ruling Q2
export type PhoneSearch = { key: string; national: string | null };
export type ContactSearchPlan = { tokens: string[]; phone: PhoneSearch | null };
export function contactSearchPlan(raw: string): ContactSearchPlan;
/** True when `phone` (as stored) is what a phone-shaped search matched. Drives the route's sublabel. */
export function phoneMatches(plan: ContactSearchPlan, phone: string | null | undefined): boolean;
```

`DB/contacts.ts` (T4, T5):

```ts
/** The ONE filter listContacts and countContacts apply (the `.or()` string), or null for "no filter". Exported for
 *  its pure test; NOT barrelled through index.ts (phoneSearchDigits' precedent, contacts.ts:882-884). */
export function contactSearchFilter(search: string | undefined): string | null;
export function phoneSearchDigits(raw: string): string;   // unchanged signature; now contactSearchPlan(raw).phone?.key ?? ""
/** The small boxes: three tiers (exact, every word starts a word, contains), each `order by sort_name, id`, merged
 *  in tier order, de-duplicated by id, cut to `limit`. Same holding, archive and merge rules as listContacts. Barrelled. */
export async function searchContacts(db: SupabaseClient, accountId: string, opts: { term: string; limit: number }):
  Promise<Awaited<ReturnType<typeof listContacts>>>;
```

`WEB/lib/contacts/search-highlight.ts` (T3; client-safe):

```ts
export type HighlightRange = readonly [start: number, end: number];   // UTF-16 offsets into the DISPLAYED text, end exclusive
export function nameRanges(text: string, query: string): HighlightRange[];
export function phoneRanges(text: string, query: string): HighlightRange[];
export function splitByRanges(text: string, ranges: readonly HighlightRange[]): { text: string; hit: boolean }[];
```

`WEB/components/highlighted-text.tsx` (T7):

```tsx
export function HighlightedText(props: { text: string; ranges: readonly HighlightRange[] }): JSX.Element;
// each hit: <mark data-search-hit className="bg-transparent font-semibold text-inherit">…</mark>
```

`ROUTE` (T5): `GET ?q=<raw>&types=contacts` answers `{ contacts, calls: [], conversations: [] }` without running the other two searches. `types` is a comma list of `contacts`, `calls`, `conversations`; missing or holding none of those means all three. `SearchHit` is unchanged.

### Pinned lists this plan moves (each was grepped)

| Pinned list | File:line | Moves | Task |
|---|---|---|---|
| Extension list, summary fingerprint | `packages/db/supabase/parity/fingerprint.sql:59,62` (and its header comment `:33-34`) | `('btree_gist', 'pg_trgm', 'plpgsql')` | T1 |
| Extension list, detail fingerprint | `packages/db/supabase/parity/fingerprint-detail.sql:17,20` | same, byte for byte | T1 |
| The extension-list pin | `packages/db/src/ci/sql-files.test.ts:194-197` | same literal | T1 |
| `EXPECTED_DEFINERS` (37) | `DB/test/definer-search-path.test.ts:31-87` | **none** (invoker only); run it on the replica | — |
| Client-write digest | `DB/test/proposals-drop.test.ts:108` | **none**; run it pre and post on the replica | — |
| Route's db mock | `ROUTE` test `:7-18` (`importOriginal` partial) | + `searchContacts`; the contacts cases move to it | T5 |
| Relationship actions' bare mock | `ACCT/contacts/relationship-actions.test.ts:14` | + `searchContacts`; `:321-330` move to it | T5 |
| `contacts.noMatches.*` | `WEB/lib/messages.ts:631-634`; read only by `ACCT/contacts/page.tsx:152` and `page.test.ts:618` | retired for `contacts.search.*` | T6 |
| `@bis/db` subpath exports | `packages/db/package.json:6-18` | + `"./contact-search": "./src/contact-search.ts"` | T2 |

### File map

| File | Task |
|---|---|
| `MIG/0108_contact_search.sql` (new); `DB/test/contact-search-schema.test.ts` (new); `DB/dedupe-keys.ts`; `DB/dedupe-keys.test.ts`; `packages/db/supabase/parity/fingerprint.sql`; `packages/db/supabase/parity/fingerprint-detail.sql`; `DB/ci/sql-files.test.ts` | T1 |
| `DB/contact-search.ts` (new); `DB/contact-search.test.ts` (new); `packages/db/package.json` | T2 |
| `WEB/lib/contacts/search-highlight.ts`, `search-highlight.test.ts` (new) | T3 |
| `DB/contacts.ts` (`withSearch`, `phoneSearchDigits`, new `contactSearchFilter`); `DB/contact-search-filter.test.ts` (new); `DB/test/contact-search-live.test.ts` (new) | T4 |
| `DB/contacts.ts` (new `searchContacts`); `DB/index.ts` (one export line); `DB/contact-search-tiers.test.ts` (new); `ROUTE`, `ROUTE`'s `route.test.ts`; `ACCT/contacts/relationship-actions.ts`, `relationship-actions.test.ts`; `DB/test/contact-search-live.test.ts` (append one describe) | T5 |
| `WEB/lib/messages.ts`; `ACCT/contacts/page.tsx`; `ACCT/contacts/page.test.ts` | T6 |
| `WEB/components/highlighted-text.tsx`, `highlighted-text.test.ts` (new); `WEB/components/command-palette.tsx`, `command-palette.test.ts`; `apps/web/src/app/(dashboard)/dashboard/styleguide/search-highlight-demo.tsx`, `search-highlight-demo.test.ts` (new); `…/styleguide/page.tsx` | T7 |
| `ACCT/contacts/contacts-table.tsx`, `contacts-table.test.ts`; `ACCT/contacts/add-relationship-dialog.tsx` (+ the test that renders its rows) | T8 |
| `ACCT/calendar/job-sheet.tsx`, `ACCT/calendar/job-sheet-handlers.ts`, `job-sheet-handlers.test.ts` | T9 |
| `ACCT/conversations/held-email-search.ts`, its test, `held-email-search-results.tsx`, its test; `ACCT/conversations/holding-move.tsx` (+ its test) | T10 |
| `DB/client-groups.ts` (`searchGroups`); `DB/client-groups-search.test.ts` (new); `DB/test/client-groups.test.ts` (one live case appended) | T11 |
| Scratch only, plus `MIG/0108_contact_search.sql`'s LOCKS AND COST header (and, only on the fallback, its index and T1's index case) | T12 |
| `apps/web/e2e/contacts-search.spec.ts` (new) | T13 |

---

## Task list

| # | Title | Owner | Tier | Wave |
|---|---|---|---|---|
| T1 | 0108: `pg_trgm`, the two stored search names and their trigram indexes; schema tests; the TS twins; parity lists | bis-db-schema | **HIGH** | 1 |
| T2 | `contactSearchPlan`: folded words, phone digits with the "+" rule and the 4-digit floor | bis-crm | LOW | 1 |
| T3 | `search-highlight.ts`: map matches back onto the displayed name and number | bis-crm | LOW | 2 |
| T4 | `withSearch` rewrite: the superset filter, its pure test and the live proof | bis-crm | MEDIUM | 2 |
| T5 | `searchContacts` tiers; the route (`types=contacts`, raw term, phone-aware sublabel); the relationship picker | bis-crm | MEDIUM | 3 |
| T6 | Empty states: copy EN/ES, the archived link, the Technician and Archived variants | bis-crm | LOW | 2 |
| T7 | `HighlightedText`, its styleguide entry, and the ⌘K contact rows | bis-frontend | LOW | 3 |
| T8 | Highlight in the contact list and the relationship picker | bis-crm | LOW | 4 |
| T9 | Add job: `types=contacts` and highlighted rows | bis-booking | LOW | 4 |
| T10 | Held email and the shared-number mover: `types=contacts` and highlighted rows | bis-comms | LOW | 4 |
| T11 | `searchGroups` on folded words (Q4) | bis-crm | LOW | 2 |
| T12 | The 50,000-contact measurement on PG17.6; numbers into 0108's header; `btree_gin` fallback only if missed | bis-db-schema (bis-crm writes the query shapes) | MEDIUM | 4 |
| T13 | e2e: accents, full names and phone shapes in the list and in ⌘K, on the per-run fixture account | bis-e2e-qa | LOW | 5 |

Spec section 11 → this plan: spec T0 → Pre-flight (done); T1 → T1; T2 → T2; T3 → T4; T4 → T5; T5 → T3, T7, T8, T9, T10; T6 → T6; T7 → T7; T8 → T12; T9 → T11; T10 → T13.

**Tiers** follow the binding speed process: HIGH = migration/RLS/grants (T1: brief review, opus review with mutation probes on its own replica, re-review); MEDIUM = server logic and `packages/db` code without a migration (T4, T5, T12: implementer plus one review); LOW = UI, copy, tests, docs, styleguide, e2e (no per-task review; the end-of-PR review covers them).

**Waves.** Two tasks in one wave never share a file; each task's file list is the complete set it may touch.
- **Wave 1:** T1 and T2 (T2 imports `nameFold` and `phoneNational`, which exist today; T1 adds to `dedupe-keys.ts`, which T2 does not edit).
- **Wave 2** (after T1's replica proof and T2 are committed): T3 (needs `foldChar`, `contactSearchPlan`), T4 (needs both and the columns), T6 (needs `MIN_PHONE_SEARCH_DIGITS`), T11 (needs `contactSearchPlan` and the column).
- **Wave 3** (after T4 for T5; after T3 for T7): T5, T7. T5 appends to `contacts.ts` and `contact-search-live.test.ts`, which T4 made: it starts only after T4 commits.
- **Wave 4** (after T5 and T7): T8, T9, T10, T12. T12 also waits for T4 and T5 (it measures their exact query shapes).
- **Wave 5** (after 0108 is on bis-ci, checklist step 5): T13.

---

### Task 1: 0108, its schema tests, the TS twins and the parity lists

**Tier:** HIGH · **Owner:** bis-db-schema · **Wave:** 1

**Files:**
- Create: `packages/db/supabase/migrations/0108_contact_search.sql`
- Create: `packages/db/src/test/contact-search-schema.test.ts`
- Modify: `packages/db/src/dedupe-keys.ts` (append `foldChar`, `contactSearchName`; nothing else moves)
- Modify: `packages/db/src/dedupe-keys.test.ts` (append one describe)
- Modify: `packages/db/supabase/parity/fingerprint.sql:33-34,59,62`, `packages/db/supabase/parity/fingerprint-detail.sql:17,20`, `packages/db/src/ci/sql-files.test.ts:194-197`
- Scratch (never committed): `<your scratchpad>/cs-t1/pg17-cs.sh`, `<your scratchpad>/cs-t1/pg17full/`

**Interfaces:** Produces every object in "SQL interfaces" and the two TypeScript functions above. Consumes 0106's `app.contact_name_fold` (`MIG/0106_contact_merge.sql:191-214`) and `nameFold` (`DB/dedupe-keys.ts:51-55`).

- [ ] **Step 1: Your own PG17.6 replica with `pg_trgm`.** In your scratchpad: `mkdir -p cs-t1 && unzip -q /c/Users/danlo/AppData/Local/Temp/claude/C--Users-danlo-bis-platform/88d51cd6-6c5b-4497-af8a-63647f233ba6/scratchpad/ca-t1/pg17.zip -d cs-t1/pg17full` (about 330 MB; ASSUMPTION A2). Confirm `ls cs-t1/pg17full/pgsql/share/extension/pg_trgm.control` exists and `cs-t1/pg17full/pgsql/bin/postgres.exe --version` answers `postgres (PostgreSQL) 17.6`. Copy `/c/Users/danlo/AppData/Local/Temp/claude/C--Users-danlo-bis-platform/6aad36e9-1c5f-4846-8e5b-164fe1f316ea/scratchpad/rp/pg17-rp.sh` to `cs-t1/pg17-cs.sh` and change exactly: `S` = your scratchpad; `B="$S/cs-t1/pg17full/pgsql/bin"`; `D="$S/cs-t1"`; port `55961` → `55981` (all places); `W=/c/Users/danlo/bis-platform/.claude/worktrees/search`; `init` skips `0108_*` instead of `0106_*`; `post` applies `$M/0108_contact_search.sql` into `$D/0108.apply.txt` and echoes `0108 apply exit $rc`. Add a verb `rw N`: `drop database if exists rw with (force)`, `create database rw template pre`, `alter database rw set timezone to 'UTC'`, insert one agency, one account and N contacts with `generate_series` (first `'María' || i`, last `'García López'`, phone `'+52899' || lpad(i::text, 7, '0')`), then `"$B/psql" … -d rw -1 -f $M/0108_contact_search.sql` wrapped in `\timing on` (use a tiny wrapper file that does `\timing on` then `\i <0108>`), three runs (recreate `rw` each time). Run `sh pg17-cs.sh init`. Expected last line: `pre = 107 files applied, last 0107_calendar_agenda.sql, on 17.6`. Paste it.

- [ ] **Step 2: Faithfulness, before anything else.** On `pre`, run the digest query from `packages/db/src/test/proposals-drop.test.ts:99-106` with psql and confirm `49|e0df0cc230da2dce6fa93b26b43e6d46` (the value pinned at `:108`, read off bis-ci after 0106). And `select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where p.prosecdef and n.nspname in ('public','app')` answers `37`. Paste both. A different answer means the replica is not faithful: stop and report.

- [ ] **Step 3: The TS twins, red first.** Append to `packages/db/src/dedupe-keys.test.ts`:

```ts
import { foldChar, contactSearchName } from "./dedupe-keys";   // merge into the file's existing import line

describe("foldChar and contactSearchName (0108's twins)", () => {
  const collapse = (s: string) => s.replace(/ +/g, " ").replace(/^ | $/g, "");
  const CORPUS = [
    "María García López", "JOSÉ MUÑOZ", "garcía-lópez", "O'Brien", "Ruiz\u00A0Díaz", "Ana\tRuiz", "  Inés  Peña ",
    "Jose\u0301 Pe\u0301rez", "Zoë Brontë", "李 王", "Nguyễn Văn", "😀 Ana", "john_doe", "maria5@example.com", "",
  ];
  it.each(CORPUS)("nameFold(%j) is foldChar per code point, collapsed and trimmed (mutation: foldChar returns 'Ñ' unmapped -> the MUÑOZ row FAILS)", (s) => {
    expect(collapse([...s].map(foldChar).join(""))).toBe(nameFold(s));
  });
  it("foldChar answers one character of [a-z0-9 ] or nothing (mutation: return the unmapped character -> FAILS on '@')", () => {
    expect([..."ÑñÉé-.,'@\u0301😀Aa9 "].map(foldChar)).toEqual(["n", "n", "e", "e", " ", " ", " ", " ", "", "", "", "a", "a", "9", " "]);
  });
  it("contactSearchName joins the non-empty folds by one space, null when none (mutation: join with '|' -> FAILS)", () => {
    expect(contactSearchName("María", "García López", null)).toBe("maria garcia lopez");
    expect(contactSearchName("Juan", null, "Plomería Pérez")).toBe("juan plomeria perez");
    expect(contactSearchName(null, "Ruiz", "  ")).toBe("ruiz");
    expect(contactSearchName("李", "王", null)).toBeNull();
    expect(contactSearchName(null, null, null)).toBeNull();
    expect(contactSearchName("", "  ", "")).toBeNull();
  });
});
```

The test source holds `\u00A0` and `\u0301` as ESCAPES (six characters each), never the raw character: after writing, `grep -c 'u00A0' packages/db/src/dedupe-keys.test.ts` must count the line, and `node -e "const s=require('fs').readFileSync('packages/db/src/dedupe-keys.test.ts','utf8');console.log(s.includes('\u00A0'))"` must print `false` (memory `bis-local-db-replica`: the edit tools have turned escapes into raw characters before). Run `cd packages/db && pnpm exec vitest run src/dedupe-keys.test.ts` (pure; no Supabase variable in the shell). Expected red: `foldChar is not a function` (or the import fails). Paste.

- [ ] **Step 4: The twins.** Append to `packages/db/src/dedupe-keys.ts`, after `nameFold`:

```ts
const KEEP = /^[a-z0-9 ]$/;
/** One character of app.contact_name_fold (0106): the FOLD table's answer if it is in [a-z0-9 ], else "". Called per
 *  code point; nameFold equals these, joined, with runs of spaces collapsed and the ends trimmed (dedupe-keys.test.ts). */
export function foldChar(ch: string): string {
  const f = FOLD.get(ch) ?? ch;
  return KEEP.test(f) ? f : "";
}

/** app.contact_search_name (0108): the non-empty folds of first, last and business name, joined by one space; null
 *  when all three fold to nothing. contact-search-schema.test.ts compares it with the SQL shape by shape. */
export function contactSearchName(
  first: string | null | undefined, last: string | null | undefined, company: string | null | undefined,
): string | null {
  const v = [nameFold(first), nameFold(last), nameFold(company)].filter((p) => p !== "").join(" ");
  return v === "" ? null : v;
}
```

Run the same command. Expected: `Tests  N passed`. Run each mutation named in the three case titles (edit, run, see the case FAIL by name, revert). Paste the three failing lines and the final green summary.

- [ ] **Step 5: The schema test, red first.** Create `packages/db/src/test/contact-search-schema.test.ts`. Reuse `contact-dedupe-schema.test.ts`'s helpers by copying them (`seedAccount` `:25-33`, `refusal` `:35-39`, `person` `:42-48`, `asService` `:72-76`), changing the org prefix to `org_search_`:

```ts
import { describe, it, expect } from "vitest";
import type { Client } from "pg";
import { withRollback, actAsMember, actAsOwner } from "./db";
import { contactSearchName, nameFold } from "../dedupe-keys";

/**
 * 0108 (F-092 part 1, spec 4.3): pg_trgm in the extensions schema; contacts.search_name and client_groups.search_name,
 * stored, generated from app.contact_name_fold; one trigram GIN on each table. Replica only (withRollback).
 * RED BEFORE 0108: every case, because each names the extension, a column, a function or an index 0108 creates.
 * One refused statement per savepoint (`refusal`).
 */
const RUN = Math.random().toString(36).slice(2, 10);
// seedAccount, refusal, person, asService: copied from contact-dedupe-schema.test.ts (see the plan's T1 Step 5).

describe("0108: the catalogue", () => {
  it("pg_trgm lives in the extensions schema (mutation: alter extension pg_trgm set schema public -> FAILS)", () =>
    withRollback(async (c) => {
      const { rows } = await c.query(
        "select n.nspname from pg_extension e join pg_namespace n on n.oid = e.extnamespace where e.extname = 'pg_trgm'");
      expect(rows).toEqual([{ nspname: "extensions" }]);
    }));

  it("both search_name columns are STORED generated with exactly these expressions (mutation: the contacts expression without company_name -> FAILS)", () =>
    withRollback(async (c) => {
      const { rows } = await c.query(
        `select table_name, is_generated, generation_expression from information_schema.columns
          where table_schema = 'public' and column_name = 'search_name' order by table_name`);
      expect(rows).toEqual([
        { table_name: "client_groups", is_generated: "ALWAYS", generation_expression: "app.contact_name_fold(name)" },
        { table_name: "contacts", is_generated: "ALWAYS", generation_expression: "app.contact_search_name(first_name, last_name, company_name)" },
      ]);
    }));

  it("app.contact_search_name is an immutable invoker with pg_temp last, EXECUTE for authenticated and service_role only (mutation: grant execute to anon -> FAILS)", () =>
    withRollback(async (c) => {
      const { rows } = await c.query(
        `select p.provolatile, p.prosecdef, p.proparallel, p.proconfig,
                has_function_privilege('anon', p.oid, 'EXECUTE') as anon,
                has_function_privilege('authenticated', p.oid, 'EXECUTE') as auth,
                has_function_privilege('service_role', p.oid, 'EXECUTE') as svc
           from pg_proc p join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'app' and p.proname = 'contact_search_name'`);
      expect(rows).toEqual([{ provolatile: "i", prosecdef: false, proparallel: "s",
        proconfig: ["search_path=pg_catalog, pg_temp"], anon: false, auth: true, svc: true }]);
    }));

  // Read through pg_index and pg_opclass, never pg_get_indexdef: whether the opclass prints as gin_trgm_ops or
  // extensions.gin_trgm_ops depends on the session's search_path, which differs between the replica and Supabase.
  it.each([
    ["contacts_search_trgm", ["search_name", "first_name", "last_name", "email", "phone", "phone_key", "phone_national"]],
    ["client_groups_search_trgm", ["search_name", "name"]],
  ])("%s is a GIN over %j, every column extensions.gin_trgm_ops (mutation: rebuild contacts_search_trgm without phone_national -> FAILS)", (index, columns) =>
    withRollback(async (c) => {
      const { rows } = await c.query(
        `select am.amname, a.attname, oc.opcname, ocn.nspname
           from pg_index i
           join pg_class ic on ic.oid = i.indexrelid
           join pg_am am on am.oid = ic.relam
           cross join lateral unnest(i.indkey::int2[], i.indclass::oid[]) with ordinality as k(attnum, opc, ord)
           join pg_attribute a on a.attrelid = i.indrelid and a.attnum = k.attnum
           join pg_opclass oc on oc.oid = k.opc
           join pg_namespace ocn on ocn.oid = oc.opcnamespace
          where ic.relname = $1 order by k.ord`, [index]);
      expect(rows).toEqual(columns.map((attname) => ({ amname: "gin", attname, opcname: "gin_trgm_ops", nspname: "extensions" })));
    }));

  it.each([["contacts", "contacts_search_trgm"], ["client_groups", "client_groups_search_trgm"]])(
    "the planner can answer search_name ilike '%%garcia%%' on %s from %s (mutation: rebuild it as a plain btree on search_name -> FAILS)",
    (table, index) =>
      withRollback(async (c) => {
        await c.query("set local enable_seqscan = off");
        const { rows } = await c.query(`explain (format text) select 1 from public.${table} where search_name ilike '%garcia%'`);
        // An Index Cond, not a Filter: a btree on search_name could be walked in full and filtered, which would
        // name the index without serving the pattern.
        expect(rows.map((r) => r["QUERY PLAN"]).join("\n"))
          .toMatch(new RegExp(`Bitmap Index Scan on ${index}[\\s\\S]*Index Cond: \\(search_name ~~\\* `));
      }));
});

describe("0108: the stored names match their TypeScript twins", () => {
  const SHAPES: [string | null, string | null, string | null][] = [
    ["María", "García López", null], ["MARIA", "GARCIA", null], ["maría", "garcía-lópez", null], ["Inés", "Peña", null],
    ["Mary", "O'Brien", null], ["Jose\u0301", "Pe\u0301rez", null], ["Ana", "Ruiz\u00A0Díaz", null], ["Ana\t", "  Ruiz  ", null],
    ["李", "王", null], ["Nguyễn", "Văn", null], [null, "Ruiz", null], ["", "  ", null], [null, null, null],
    ["Juan", null, "Plomería Pérez"], [null, null, "Taller Núñez"], ["Ana", "Ruiz", "  "], ["Zoë", "Brontë", "O'Neil & Hijos"],
  ];
  it.each(SHAPES)("app.contact_search_name(%j, %j, %j) = contactSearchName() (mutations: join with '|' in SQL -> the multi-part rows FAIL; return '' instead of null -> the empty rows FAIL)", (f, l, co) =>
    withRollback(async (c) => {
      const { rows: [r] } = await c.query("select app.contact_search_name($1, $2, $3) as v", [f, l, co]);
      expect(r.v).toBe(contactSearchName(f, l, co));
    }));

  it("a signed-in Owner's insert and edit store search_name (mutation: revoke execute on app.contact_search_name from authenticated -> 42501, FAILS)", () =>
    withRollback(async (c) => {
      const a = await seedAccount(c, "own");
      await actAsMember(c, a.accountId, a.orgId, "owner");
      const { rows: [r] } = await c.query(
        "insert into public.contacts (account_id, first_name, last_name) values ($1, 'María', 'García') returning id, search_name", [a.accountId]);
      expect(r.search_name).toBe("maria garcia");
      const { rows: [u] } = await c.query("update public.contacts set last_name = 'García López' where id = $1 returning search_name", [r.id]);
      expect(u.search_name).toBe("maria garcia lopez");
    }));

  it("a business member's search_name carries the business name the sync writes (0069/0072; mutation: the column's expression with null for company_name -> FAILS)", () =>
    withRollback(async (c) => {
      const a = await seedAccount(c, "biz");
      const id = await person(c, a.accountId, { first: "Juan", last: "Pérez" });
      // Read 0069's public.create_group_with_member(uuid, uuid, text, text, text) for its five parameters before writing
      // this call; it is EXECUTE service_role only (0069 section 9), hence asService.
      await asService(c);
      await c.query("select public.create_group_with_member($1, $2, 'business', 'Taller Núñez', null)", [a.accountId, id]);
      await actAsOwner(c);
      const { rows: [r] } = await c.query("select company_name, search_name from public.contacts where id = $1", [id]);
      expect(r).toEqual({ company_name: "Taller Núñez", search_name: contactSearchName("Juan", "Pérez", "Taller Núñez") });
      expect(r.search_name).toBe("juan perez taller nunez");
    }));

  it.each(["Familia García", "Plomería Núñez-Peña", "  FAMILIA  O'BRIEN ", "李家"])(
    "client_groups.search_name = nameFold(%j) (mutation: generate it from app.group_name_key(name) -> the accented rows FAIL)", (name) =>
      withRollback(async (c) => {
        const a = await seedAccount(c, "grp");
        const id = await person(c, a.accountId, { first: "Ana" });
        await asService(c);
        await c.query("select public.create_group_with_member($1, $2, 'household', $3, null)", [a.accountId, id, name]);
        await actAsOwner(c);
        const { rows: [r] } = await c.query(
          "select search_name from public.client_groups where account_id = $1 and name = $2", [a.accountId, name.trim()]);
        expect(r.search_name).toBe(nameFold(name));
      }));
});
```

`public.create_group_with_member(p_account_id uuid, p_contact_id uuid, p_kind text, p_name text, p_role text default null)` returns jsonb, SECURITY INVOKER, EXECUTE service_role only, and stores `btrim(p_name, app.group_ws())` (`MIG/0069_client_groups.sql:234-236`, read 2026-10-31); read its body before trusting the two calls, and if anything there disagrees with them, the source wins and your report says which line. Keep the `\u…` escapes as escapes (Step 3's check, on this file).

Run red on `pre`: `cd /c/Users/danlo/bis-platform/.claude/worktrees/search/packages/db && SUPABASE_DB_URL=postgresql://postgres@localhost:55981/pre pnpm exec vitest run src/test/contact-search-schema.test.ts`. Expected: every case fails (the catalogue cases on empty rows or a wrong value, the others on `function app.contact_search_name(...) does not exist` or `column "search_name" does not exist`). Paste the summary line and two failing lines.

- [ ] **Step 6: The migration.** Create `packages/db/supabase/migrations/0108_contact_search.sql` with exactly this text (the LOCKS AND COST numbers are filled in Step 8 from your measurement; T12 adds the 50,000 numbers later):

```sql
-- 0108_contact_search.sql - contacts search that ignores accents and finds full names and phone digits (F-092 part 1)
-- (docs/superpowers/specs/2026-10-31-search-accents-design.md section 4.3;
--  docs/superpowers/plans/2026-10-31-search-accents.md, Task 1)
--
-- WHY. Contact search matched raw text with ILIKE, which folds case and never accents: "Garcia" did not find
-- "Garcia" spelled with its accent, "Maria Garcia" found nobody (the whole term had to sit inside ONE column), and the
-- legacy Mexican mobile shape "+52 1 899 ..." missed the stored "+52 899 ...". The owner ruled (spec section 9,
-- 2026-10-31): n and n-tilde match both ways, a phone search starts at 4 digits, the list keeps its own order, and
-- households and businesses follow the same rules.
--
-- WHAT.
--   pg_trgm, in the extensions schema (read on both projects 2026-10-31: the schema exists, pg_trgm was not
--     installed, default version 1.6). Trusted, like btree_gist (0016), so the migration role may create it.
--   app.contact_search_name(text, text, text): app.contact_name_fold (0106) of first name, last name and business
--     name, the non-empty ones joined by one space, NULL when all three fold to nothing. plpgsql, not sql: a sql
--     function calling a sql function re-plans the inner one on every row (0106 section 1's measured reason).
--     Its TypeScript twin is contactSearchName in packages/db/src/dedupe-keys.ts, compared shape by shape in
--     contact-search-schema.test.ts.
--   contacts.search_name: stored, generated from it. company_name is written by the business sync (0069) and reset by
--     0072's BEFORE trigger; stored generated columns are computed after BEFORE triggers, so search_name always
--     carries the business name the row ends up with (proven in contact-search-schema.test.ts).
--   client_groups.search_name: stored, generated from app.contact_name_fold(name) ('' for a blank name).
--   contacts_search_trgm: one GIN over search_name and the six columns the search's other clauses read (first_name,
--     last_name, email, phone, phone_key, phone_national), every column extensions.gin_trgm_ops, so each arm of the
--     search's OR can be a bitmap scan of this one index. client_groups_search_trgm: search_name and name.
--
-- GRANTS. app.contact_search_name: EXECUTE for authenticated and service_role (a stored generated column runs its
-- function as the WRITING role: 0106 plan correction 3), revoked from PUBLIC and anon by name (the default ACL grants
-- anon by name). No column grant: contacts and client_groups keep their table-level SELECT for authenticated, and
-- nothing writes a generated column. No definer (EXPECTED_DEFINERS stays 37); no client write changes (the digest in
-- proposals-drop.test.ts stays 49|e0df0cc230da2dce6fa93b26b43e6d46).
--
-- SEARCH PATHS. The function says set search_path = pg_catalog, pg_temp (the 0096 rule) and names app functions by
-- schema. The indexes name their operator class by schema, so no search_path decides which one is used.
--
-- LOCKS AND COST. The file runs as one transaction; lock_timeout 5s below bounds only the WAIT to take each lock.
--   contacts: adding a stored generated column rewrites the table under ACCESS EXCLUSIVE, held to the end of the
--     file: every contact read and write waits for it. MEASURED on a real PostgreSQL 17.6 replica (pre = 0001-0107,
--     one account, laptop SSD, psql -1, three runs each): <T1 Step 8 fills: 10,000 contacts, the whole file X to Y s;
--     50,000 contacts, X to Y s>. <T12 fills: 500,000 contacts over ten accounts, the whole file X to Y s; index size>.
--     Production held 53 contacts on 2026-10-31: no off-peak rule.
--   client_groups: the same rewrite, of a table production holds a handful of rows of.
--   Every contact insert, and every update of a name or a phone, computes search_name and updates the GIN index.
--
-- LOAD-BEARING. From plan Task 4 on, the app's contact search names search_name and phone_national in its filter;
-- the app merges only after this file is on production.
--
-- ROLLBACK (roll the app back first):
--   drop index public.client_groups_search_trgm;
--   drop index public.contacts_search_trgm;
--   alter table public.client_groups drop column search_name;
--   alter table public.contacts drop column search_name;
--   drop function app.contact_search_name(text, text, text);
--   pg_trgm stays: nothing else depends on it, and removing it is a separate decision.
--
-- ASCII only, no backslash anywhere, and every dollar sign in this file is part of a dollar-quote pair.

-- 0. Fail fast instead of queueing behind a long lock.
do $$
begin
  perform pg_catalog.set_config('lock_timeout', '5s', true);
end $$;

-- 1. The trigram operator classes.
create extension if not exists pg_trgm with schema extensions;

-- 2. The searched name. Three folds, the non-empty ones joined by one space; NULL when none.
create function app.contact_search_name(p_first text, p_last text, p_company text) returns text
language plpgsql immutable parallel safe set search_path = pg_catalog, pg_temp as $$
declare
  v_first text := app.contact_name_fold(p_first);
  v_last text := app.contact_name_fold(p_last);
  v_company text := app.contact_name_fold(p_company);
  v text := '';
begin
  if v_first <> '' then
    v := v_first;
  end if;
  if v_last <> '' then
    v := case when v = '' then v_last else v || ' ' || v_last end;
  end if;
  if v_company <> '' then
    v := case when v = '' then v_company else v || ' ' || v_company end;
  end if;
  return nullif(v, '');
end $$;

revoke all on function app.contact_search_name(text, text, text) from public, anon;
grant execute on function app.contact_search_name(text, text, text) to authenticated, service_role;

-- 3. The stored names. Each alter table rewrites its table once.
alter table public.contacts
  add column search_name text generated always as (app.contact_search_name(first_name, last_name, company_name)) stored;
alter table public.client_groups
  add column search_name text generated always as (app.contact_name_fold(name)) stored;

comment on column public.contacts.search_name is
  'F-092 (0108): first, last and business name folded by app.contact_name_fold, joined by spaces. Search only.';
comment on column public.client_groups.search_name is
  'F-092 (0108): the group name folded by app.contact_name_fold. Search only.';

-- 4. The trigram indexes: every column a search clause reads.
create index contacts_search_trgm on public.contacts using gin (
  search_name extensions.gin_trgm_ops,
  first_name extensions.gin_trgm_ops,
  last_name extensions.gin_trgm_ops,
  email extensions.gin_trgm_ops,
  phone extensions.gin_trgm_ops,
  phone_key extensions.gin_trgm_ops,
  phone_national extensions.gin_trgm_ops
);
create index client_groups_search_trgm on public.client_groups using gin (
  search_name extensions.gin_trgm_ops,
  name extensions.gin_trgm_ops
);
```

Before running it, confirm from the source (and paste the lines): `phone_key` is a text column (`MIG/0033_contact_dedupe_keys.sql:45`), `client_groups.name` is text (`MIG/0069_client_groups.sql`, the table), and no index named `contacts_search_trgm` or `client_groups_search_trgm` exists (`grep -rn "search_trgm" packages/db/supabase/migrations` answers only 0108). Byte check (Git Bash `grep -P` cannot run it): `node -e "const s=require('fs').readFileSync('packages/db/supabase/migrations/0108_contact_search.sql');let bad=0;for(const b of s)if(b>127||b===92)bad++;console.log('non-ascii-or-backslash bytes:',bad)"` answers `0`; positive control: the same command on `packages/db/src/dedupe-keys.test.ts` answers a non-zero count. Paste both.

- [ ] **Step 7: Green on `post`.** `sh pg17-cs.sh post` → `0108 apply exit 0`. Then on `post`: `cd …/packages/db && SUPABASE_DB_URL=postgresql://postgres@localhost:55981/post pnpm exec vitest run src/test/contact-search-schema.test.ts src/test/definer-search-path.test.ts src/test/proposals-drop.test.ts src/test/contact-dedupe-schema.test.ts`. Expected: all green (definer-search-path still pins 37; the digest still `49|e0df0cc230da2dce6fa93b26b43e6d46`; 0106's twin cases untouched). If the replica prints `generation_expression` in another spelling than the case pins, pin what it prints and say so. Paste the summary line and the sweep's skip line.

- [ ] **Step 8: Mutations, each on `post`, each then reset with `sh pg17-cs.sh post`.** Apply each with psql, run `src/test/contact-search-schema.test.ts`, paste the failing case NAME(S):
  - M1 `alter extension pg_trgm set schema public;` → "pg_trgm lives in the extensions schema" FAILS (the index cases may fail too: name them).
  - M2 `alter table public.contacts drop column search_name; alter table public.contacts add column search_name text generated always as (app.contact_search_name(first_name, last_name, null)) stored;` → the expressions case, the `contacts_search_trgm` index case (the drop took the index), the planner case for contacts, and the business-member case FAIL.
  - M3 `grant execute on function app.contact_search_name(text, text, text) to anon;` → the function case FAILS.
  - M4 `revoke execute on function app.contact_search_name(text, text, text) from authenticated;` → the signed-in Owner case FAILS with 42501.
  - M5 `drop index public.contacts_search_trgm; create index contacts_search_trgm on public.contacts using gin (search_name extensions.gin_trgm_ops, first_name extensions.gin_trgm_ops, last_name extensions.gin_trgm_ops, email extensions.gin_trgm_ops, phone extensions.gin_trgm_ops, phone_key extensions.gin_trgm_ops);` → the `contacts_search_trgm` index case FAILS.
  - M6 `drop index public.contacts_search_trgm; create index contacts_search_trgm on public.contacts (search_name);` → the index case and the contacts planner case FAIL.
  - M7 `create or replace function app.contact_search_name(…)` with Step 6's body joining with `'|'` instead of `' '` → the multi-part SHAPES rows FAIL; then Step 6's body ending `return v;` instead of `return nullif(v, '');` → the empty rows FAIL.
  - M8 `alter table public.client_groups drop column search_name; alter table public.client_groups add column search_name text generated always as (app.group_name_key(name)) stored;` → the expressions case and the accented `client_groups.search_name` rows FAIL.
  Then the rewrite cost: `sh pg17-cs.sh rw 10000` and `sh pg17-cs.sh rw 50000`, three runs each; write the ranges into the header's LOCKS AND COST line (Step 6's `<T1 Step 8 fills …>`), leaving T12's placeholder for T12. Paste the six timings.

- [ ] **Step 9: Parity lists.** In `packages/db/supabase/parity/fingerprint.sql` and `fingerprint-detail.sql`, change both `where e.extname in ('btree_gist', 'plpgsql')` (the `extension` and `extension_version(info)` branches) to `where e.extname in ('btree_gist', 'pg_trgm', 'plpgsql')`; in `fingerprint.sql`'s header (`:33-34`), "extensions: only the ones the migrations use (btree_gist, 0016) and plpgsql" becomes "(btree_gist, 0016; pg_trgm, 0108) and plpgsql". In `packages/db/src/ci/sql-files.test.ts:195-196` change the two expected literals the same way (red first: run `cd packages/db && pnpm exec vitest run src/ci/sql-files.test.ts` after editing ONLY the test, paste the failure, then edit the two SQL files and paste green; its byte-for-byte case keeps the two files' item lists equal). Note for the parity run (checklist step 8): `pg_trgm`'s own functions live in `extensions`, which the fingerprint never reads; the `index` kind prints `contacts_search_trgm`'s operator class qualified or not by the session's search_path, so a difference ONLY in `extensions.` qualification between two projects is a search_path artefact, not a schema difference.

- [ ] **Step 10: Commit** `feat(db): 0108 stores a folded search name on contacts and households behind trigram indexes, so search can ignore accents and find full names (F-092 part 1)` with exactly the seven paths in Files.

**Done when:** red then green pasted for Steps 3, 5/7 and 9; M1–M8 each red by name; the two faithfulness numbers (Step 2) and the post-apply definer count and digest unchanged; the byte check 0; rewrite timings in the header.

---

### Task 2: `contactSearchPlan`

**Tier:** LOW · **Owner:** bis-crm · **Wave:** 1

**Files:** Create `packages/db/src/contact-search.ts`, `packages/db/src/contact-search.test.ts`. Modify `packages/db/package.json` (one line in `exports`: `"./contact-search": "./src/contact-search.ts"`, after `"./dedupe-keys"`).

**Behaviour** (spec 4.1, 4.2, owner Q1/Q2):

```ts
/**
 * F-092 part 1 (spec 4.1, 4.2): how a typed customer search is read. Imports only ./dedupe-keys (itself import-free),
 * so apps/web's client components import it as `@bis/db/contact-search` (the highlight, the empty-state floor).
 */
import { nameFold, phoneNational } from "./dedupe-keys";

export const MAX_SEARCH_LENGTH = 80;          // search-term.ts's MAX_TERM_LENGTH: the same paste cap
export const MAX_NAME_TOKENS = 6;
export const MIN_PHONE_SEARCH_DIGITS = 4;     // owner ruling Q2 (2026-10-31): today's floor
const PHONE_SHAPE = /^[+()\-. \d]+$/;         // contacts.ts:879's PHONE_SEARCH_SHAPE, restated (this file imports nothing else)

export type PhoneSearch = { key: string; national: string | null };
export type ContactSearchPlan = { tokens: string[]; phone: PhoneSearch | null };

/** Digits for phone_key (0033: the digits, an 11-digit leading 1 folded off). A leading "+" names a country code:
 *  "+1" drops its 1; "+521" (the legacy Mexican mobile prefix) becomes "52", as phone_key stores a Mexican number. */
function keyDigits(raw: string): string {
  const d = raw.replace(/[^0-9]/g, "");
  const plus = raw.trimStart().startsWith("+");
  if (plus && d.startsWith("521")) return `52${d.slice(3)}`;
  if (plus && d.startsWith("1")) return d.slice(1);
  return d.length === 11 && d.startsWith("1") ? d.slice(1) : d;
}

export function contactSearchPlan(raw: string): ContactSearchPlan {
  const term = raw.slice(0, MAX_SEARCH_LENGTH);
  const tokens = nameFold(term).split(" ").filter((t) => t !== "").slice(0, MAX_NAME_TOKENS);
  if (!PHONE_SHAPE.test(term)) return { tokens, phone: null };
  const key = keyDigits(term).slice(0, 20);
  if (key.length < MIN_PHONE_SEARCH_DIGITS) return { tokens, phone: null };
  const n = phoneNational(term.replace(/[^0-9]/g, ""));
  return { tokens, phone: { key, national: n !== null && n.length === 10 && n !== key ? n : null } };
}

export function phoneMatches(plan: ContactSearchPlan, phone: string | null | undefined): boolean {
  if (!plan.phone || !phone) return false;
  const d = phone.replace(/[^0-9]/g, "");
  const stored = d.length === 11 && d.startsWith("1") ? d.slice(1) : d;
  if (stored.includes(plan.phone.key)) return true;
  const n = phoneNational(phone);
  return plan.phone.national !== null && n !== null && n.includes(plan.phone.national);
}
```

**Tests** (`contact-search.test.ts`, pure; red first by writing the test before the file, paste `Cannot find module './contact-search'`), each name carrying its mutation:
- The spec 4.2 table as `contactSearchPlan(x).phone`: `(956) 555-0199`, `956.555.0199`, `9565550199`, `+1 956 555 0199` → `{ key: "9565550199", national: null }`; `0199` → `{ key: "0199", national: null }`; `899 123 4567` → `{ key: "8991234567", national: null }`; `+52 1 899 123 4567` → `{ key: "528991234567", national: "8991234567" }`; `044 899 123 4567` → `{ key: "0448991234567", national: "8991234567" }`; `+521 899 12` → `{ key: "5289912", national: null }` (mutation: drop the `521` branch → FAILS); `+1 956 55` → `{ key: "95655", national: null }` (mutation: drop the `plus && "1"` branch → FAILS); `956`, `+1 956`, `(99)` → `null` (mutation: floor 3 → FAILS); `Suite 9`, `maria5@example.com`, `john2026@x.com`, `Unit 1234 Main` → `null` (mutation: drop the shape check → FAILS).
- Agreement with today for every non-"+" phone-shaped term of 4+ digits: `contactSearchPlan(x).phone?.key === phoneDigits(x).slice(0, 20)` (import `phoneDigits` from `./contacts`) over `["(956) 555-0199", "9565550199", "19565550199", "0199", "1-800", "899 123 4567", "044 899 123 4567"]`.
- Tokens: `María García` → `["maria", "garcia"]`; `GARCÍA-LÓPEZ` → `["garcia", "lopez"]`; `Peña` and `Pena` → `["pena"]` (Q1); `O'Brien` → `["o", "brien"]`; `Jose\u0301` → `["jose"]`; `李` → `[]`; eight words → six tokens (mutation: drop the cap → FAILS); `"a".repeat(100)` → one token of length 80.
- Hostile input: for `` `a,b)(or(id.eq.x%_*\\"'` `` and `"%"`, `"()"`, every token matches `/^[a-z0-9]+$/` (mutation: tokens from `term.toLowerCase().split(" ")` → FAILS).
- `phoneMatches`: plan of `0199` matches `+19565550199` and not `+19565550200`; plan of `+52 1 899 123 4567` matches `+528991234567` and `(899) 123-4567`; a name plan (`garcia`) matches nothing.

Keep `\u0301` as an escape (T1 Step 3's check). Run `cd packages/db && pnpm exec vitest run src/contact-search.test.ts` (pure, no Supabase variable). **Done when:** red then green pasted, every named mutation red by name; commit `feat(contacts): contactSearchPlan reads a typed search as folded words and phone digits, with the + country-code rule and the 4-digit floor (F-092)` -- the three paths.

---

### Task 3: `search-highlight.ts`

**Tier:** LOW · **Owner:** bis-crm · **Wave:** 2 (needs T1's `foldChar` and T2)

**Files:** Create `apps/web/src/lib/contacts/search-highlight.ts`, `search-highlight.test.ts`.

**Behaviour:**

```ts
import { foldChar } from "@bis/db/dedupe-keys";
import { contactSearchPlan } from "@bis/db/contact-search";

export type HighlightRange = readonly [start: number, end: number];
const MARK = /\p{M}/u;   // a combining mark (a decomposed accent) belongs to the letter before it

/** Every place a typed word appears in `text`, folded exactly as search folds it, as ranges of the ORIGINAL text. */
export function nameRanges(text: string, query: string): HighlightRange[] {
  const { tokens } = contactSearchPlan(query);
  if (tokens.length === 0 || text === "") return [];
  let folded = "";
  const from: number[] = [];
  const to: number[] = [];
  let i = 0;
  for (const ch of text) {                       // per code point, as nameFold folds
    const f = foldChar(ch);
    if (f !== "") { folded += f; from.push(i); to.push(i + ch.length); }
    else if (MARK.test(ch) && to.length > 0) to[to.length - 1] = i + ch.length;
    i += ch.length;
  }
  const out: [number, number][] = [];
  for (const t of tokens) {
    for (let at = folded.indexOf(t); at !== -1; at = folded.indexOf(t, at + 1)) out.push([from[at]!, to[at + t.length - 1]!]);
  }
  return merge(out);
}

/** Where the searched digits sit in a number as displayed: the key's digits first, else the national ten. */
export function phoneRanges(text: string, query: string): HighlightRange[] {
  const { phone } = contactSearchPlan(query);
  if (!phone || text === "") return [];
  const pos: number[] = [];
  let digits = "";
  for (let i = 0; i < text.length; i++) if (text[i]! >= "0" && text[i]! <= "9") { digits += text[i]; pos.push(i); }
  for (const needle of [phone.key, phone.national]) {
    if (!needle) continue;
    const at = digits.indexOf(needle);
    if (at !== -1) return [[pos[at]!, pos[at + needle.length - 1]! + 1]];
  }
  return [];
}

export function splitByRanges(text: string, ranges: readonly HighlightRange[]): { text: string; hit: boolean }[];
// sorted, merged ranges → alternating parts; parts.map(p => p.text).join("") === text always; no empty parts.
function merge(r: [number, number][]): HighlightRange[];   // sort by start, join overlapping or touching ranges
```

**Tests** (`pnpm --filter web exec vitest run src/lib/contacts/search-highlight.test.ts`; red first: `Failed to resolve import`): `nameRanges("García", "garcia")` → `[[0, 6]]`; `("María García López", "garcia maria")` → `[[0, 5], [6, 12]]`; `("Peña", "pena")` → `[[0, 4]]`; `("Jose\u0301 Pérez", "jose")` → `[[0, 5]]` (mutation: drop the combining-mark line → `[[0, 4]]`, FAILS); `("😀 Ana", "ana")` → `[[3, 6]]` (mutation: advance the offset by 1 per code point instead of `ch.length` → `[[2, 5]]`, FAILS); `("O'Brien", "brien")` → `[[2, 7]]`; `("Ana Anabel", "ana")` → `[[0, 3], [4, 7]]` (every occurrence); `("Ana", "an ana")` → `[[0, 3]]` (overlaps merged; mutation: skip `merge` → FAILS); no token → `[]`. `phoneRanges("(956) 555-0199", "0199")` → `[[10, 14]]`; `("(956) 555-0199", "555-0199")` → `[[6, 14]]`; `("+52 899 123 4567", "044 899 123 4567")` → the national ten `[[4, 16]]`; a name query → `[]`. `splitByRanges` round-trips for every case above (join equals text) and marks the right parts. **Done when:** red, green and both mutations pasted; commit `feat(contacts): map a search's folded words and digits back onto the displayed name and number for highlighting (F-092)` -- the two paths.

---

### Task 4: `withSearch` rewrite

**Tier:** MEDIUM · **Owner:** bis-crm · **Wave:** 2 (needs T1 committed and replica-proven, and T2)

**Files:** Modify `packages/db/src/contacts.ts:848-935` only (the doc comment from `:848`, `PHONE_SEARCH_SHAPE`, `MIN_PHONE_SEARCH_DIGITS`, `phoneSearchDigits`, `withSearch`, plus the new `contactSearchFilter` beside them; add `import { contactSearchPlan } from "./contact-search";` at the top). Create `packages/db/src/contact-search-filter.test.ts` (pure) and `packages/db/src/test/contact-search-live.test.ts` (CI-only).

**Behaviour** (spec 4.4; Global Constraints' superset rule):

```ts
export function contactSearchFilter(search: string | undefined): string | null {
  const s = search ? sanitizeSearchTerm(search) : "";
  if (!s) return null;                         // "%" or "()" still means "no filter" for the LIST (contacts.test.ts:141)
  const plan = contactSearchPlan(search!);
  const clauses = [`first_name.ilike.%${s}%`, `last_name.ilike.%${s}%`, `email.ilike.%${s}%`, `phone.ilike.%${s}%`];
  const words = plan.tokens.map((t) => `search_name.ilike.%${t}%`);   // [a-z0-9]+ only: no grammar, no wildcard
  if (words.length === 1) clauses.push(words[0]!);
  else if (words.length > 1) clauses.push(`and(${words.join(",")})`);
  if (plan.phone) clauses.push(`phone_key.ilike.%${plan.phone.key}%`);
  if (plan.keptKey) clauses.push(`phone_key.ilike.%${plan.keptKey}%`);
  if (plan.phone?.national) clauses.push(`phone_national.ilike.%${plan.phone.national}%`);
  return clauses.join(",");
}
function withSearch<T>(q: T, search?: string): T {
  const f = contactSearchFilter(search);
  return f ? (q as { or: (f: string) => T }).or(f) : q;
}
export function phoneSearchDigits(raw: string): string {
  return contactSearchPlan(raw).phone?.key ?? "";
}
```

Delete the now-unused `PHONE_SEARCH_SHAPE` and `MIN_PHONE_SEARCH_DIGITS` constants (they live in `contact-search.ts`); move the long comment above them to `contactSearchFilter`, adding one paragraph: the folded words (0108's `search_name`) and the national ten (0106's `phone_national`) are ADDED arms, so nothing found before stops being found (spec D4). Keep `phoneSearchDigits` exported (its pins in `contacts-phone.test.ts:63-77` stay green; correction 8).

**Pure test** (`contact-search-filter.test.ts`; red first: `contactSearchFilter is not a function`). Exact strings (each is the whole `.or()` argument):
- `"María García"` → `first_name.ilike.%María García%,last_name.ilike.%María García%,email.ilike.%María García%,phone.ilike.%María García%,and(search_name.ilike.%maria%,search_name.ilike.%garcia%)` (mutation: drop the `and(...)` arm → FAILS)
- `"garcia"` → `first_name.ilike.%garcia%,last_name.ilike.%garcia%,email.ilike.%garcia%,phone.ilike.%garcia%,search_name.ilike.%garcia%`
- `"(956) 555-0199"` → `first_name.ilike.%956 555-0199%,last_name.ilike.%956 555-0199%,email.ilike.%956 555-0199%,phone.ilike.%956 555-0199%,and(search_name.ilike.%956%,search_name.ilike.%555%,search_name.ilike.%0199%),phone_key.ilike.%9565550199%`
- `"+52 1 899 123 4567"` → `first_name.ilike.%+52 1 899 123 4567%,last_name.ilike.%+52 1 899 123 4567%,email.ilike.%+52 1 899 123 4567%,phone.ilike.%+52 1 899 123 4567%,and(search_name.ilike.%52%,search_name.ilike.%1%,search_name.ilike.%899%,search_name.ilike.%123%,search_name.ilike.%4567%),phone_key.ilike.%528991234567%,phone_national.ilike.%8991234567%` (mutation: drop the national arm → FAILS)
- `"john_doe"` → `first_name.ilike.%john\_doe%,last_name.ilike.%john\_doe%,email.ilike.%john\_doe%,phone.ilike.%john\_doe%,search_name.ilike.%johndoe%` (in the TS literal, `\\_`)
- `"%"`, `"()"`, `""`, `undefined` → `null`.
- The superset, by construction: for 20 mixed terms, the first four clauses are exactly today's (`af5976fa`'s `withSearch` restated in the test as a frozen oracle), and today's `phone_key` clause appears whenever today's did (mutation: replace the raw arms with the token arm → FAILS).
- `listContacts` and `countContacts` both hand the SAME string to `.or()`: a recording fake client (a `Proxy` whose every method records `[name, args]` and returns itself, and whose `then` resolves `{ data: [], error: null, count: 0 }`), called with `search: "María García"`, records one `or` call each with `contactSearchFilter("María García")`; with `search: "%"` neither records an `or` (mutation: `countContacts` skips `withSearch` → FAILS).

**Live test** (`src/test/contact-search-live.test.ts`; `withTestAccount` + its `db`, which is `serviceDb()`; CI-only, never run locally; read `fixtures.ts:140` for the signature). ONE `withTestAccount` per `it` and at most three `it`s (contention: `search.test.ts:1-5`, `contacts.test.ts:118-122`). Seed with `createContact(db, accountId, {...}, "user_test")` (read its input type, `contacts.ts` `CreateContactInput`): María / García López / `+528991234567`; Maria / Garcia / `+19565550199`; Inés / Peña; Ines / Pena; José / O'Brien; 李 / 王; Juan / Pérez joined to business "Taller Núñez" (through the `create_group_with_member` RPC as the service client; read 0069 for its parameters); an archived "Gloria García" (`update contacts set archived_at = now()` through the service client, or the archive helper T-archive used: read `contact-archive-live.test.ts:30-60`); a merged-away "Garcia Merged" (`merged_into` and `merged_at` set together, `contacts_merged_pair`); a holding record "Garcia Holding" (`holds_shared_number: true`, as `contacts.test.ts:1290-1310` seeds one: read it). Assertions, each labelled, each on `listContacts` ids AND `countContacts` (rows equal count, spec 4.4):
- `garcia`, `GARCÍA`, `garcía` → the two Garcías only (never Gloria, Merged or Holding); red on `af5976fa` (the accented one is missed).
- `maria garcia` and `garcia maria` → both Marías; `maria lopez` → María García López only; red on `af5976fa` (no full-name match).
- `pena` and `peña` → both Inés and Ines (Q1); `o'brien` and `brien` → José; `李` → 李 (the raw arm: the fold empties it).
- Phones: `+52 1 899 123 4567`, `044 899 123 4567`, `899 123 4567`, `+521 899 12` → María García López; `+1 956 55`, `0199`, `(956) 555-0199` → Maria Garcia.
- `nunez` → Juan (the business name, D3).
- Archived view: `garcia` with `archived: "only"` → Gloria only.
- Superset: for each term above, the ids today's filter finds (an inline `.or()` copy of `af5976fa`'s clauses run on the same `db`) are a subset of `listContacts`' ids.
- PostgREST accepted the nested `and(...)` (ASSUMPTION A3): `maria garcia` returned rows, no error.

The existing live cases stay green by construction; check each against the new filter and say so in the report: `contacts.test.ts:117` ("trevi"), `:126` (`trevi"`), `:131` (`trev%`), `:141` (`%` → 2, no filter), `:152` (`john_doe` → 1: `johnXdoe` folds to `johnxdoe`, which does not contain `johndoe`), `:164-168` (the phone), `:176` (`maria5@example.com` → 1: its tokens are `maria5example` and `com`, in no other seeded name), `:555-581` (`Ada` with a cursor), `:1374-1375` (`Caller`; read `:1290-1380` first, where the holding record named Caller is seeded); `contact-archive-live.test.ts:46-62`.

Run the pure file: `cd packages/db && pnpm exec vitest run src/contact-search-filter.test.ts src/contacts-phone.test.ts src/contact-search.test.ts`. `pnpm --filter web typecheck` (contacts.ts is imported by the app). **Done when:** pure red/green and three mutations pasted; the live file committed and listed for the orchestrator's CI read (checklist step 3); commit `feat(contacts): search ignores accents, finds full names in any order and every Mexican phone shape, keeping every match it had (F-092)` -- the three paths.

---

### Task 5: `searchContacts`, the route and the relationship picker

**Tier:** MEDIUM · **Owner:** bis-crm · **Wave:** 3 (after T4 commits)

**Files:** Modify `packages/db/src/contacts.ts` (add `searchContacts` after `countContacts`); `packages/db/src/index.ts` (add `searchContacts` to the existing `./contacts` export line that carries `listContacts`; touch no other line); create `packages/db/src/contact-search-tiers.test.ts`; modify `ROUTE`, `ROUTE`'s `route.test.ts`; `ACCT/contacts/relationship-actions.ts:226-249`, `relationship-actions.test.ts`; append one describe to `packages/db/src/test/contact-search-live.test.ts`.

**Behaviour** (spec 5, owner Q3):

```ts
export async function searchContacts(db: SupabaseClient, accountId: string, opts: { term: string; limit: number }) {
  const filter = contactSearchFilter(opts.term);
  if (!filter) return [];
  const plan = contactSearchPlan(opts.term);
  const base = () => withArchived(db.from("contacts").select(COLS).eq("account_id", accountId).eq("holds_shared_number", false)
    .or(filter).order("sort_name", { ascending: true, nullsFirst: false }).order("id", { ascending: true }).limit(opts.limit), "exclude");
  const exact: string[] = [];
  if (plan.tokens.length) exact.push(`search_name.eq.${plan.tokens.join(" ")}`);
  const digits = opts.term.replace(/[^0-9]/g, "");
  if (plan.phone && digits.length >= 10) {
    const n = phoneNational(digits);
    if (n !== null && n.length === 10) exact.push(`phone_national.eq.${n}`);
  }
  if (opts.term.includes("@")) exact.push(`email_key.eq.${quoteFilterValue(emailKey(opts.term))}`);
  const tiers = [
    exact.length ? base().or(exact.join(",")) : null,                                          // 1. exact
    plan.tokens.length                                                                       // 2. every word starts a word
      ? plan.tokens.reduce((q, t) => q.or(`search_name.ilike.${t}%,search_name.ilike.% ${t}%`), base()) : null,
    base(),                                                                                  // 3. contains
  ];
  const answers = await Promise.all(tiers.map((q) => q ?? Promise.resolve({ data: [], error: null })));
  const seen = new Set<string>();
  const out = [];
  for (const { data, error } of answers) {
    if (error) throw new Error(`searchContacts failed: ${error.message}`);
    for (const row of data ?? []) if (!seen.has(row.id)) { seen.add(row.id); out.push(row); }
  }
  return out.slice(0, opts.limit);
}
```

(`phoneNational` from `./dedupe-keys`; `emailKey`, `quoteFilterValue`, `withArchived`, `COLS` are this file's. Type the rows as `listContacts`' rows; fix any supabase-js inference with the narrowest cast and say so.)

Route (`ROUTE`): import `searchContacts` from `@bis/db` and `contactSearchPlan`, `phoneMatches` from `@bis/db/contact-search`; `const raw = …trim()` stays; the floor stays `searchTermLength(raw) < MIN_QUERY`; delete `const q = sanitizeSearchTerm(raw)` and pass `raw` to all three (each sanitizes for itself: `voice.ts:1314`, `messaging.ts:970`, and `withSearch`), so the double sanitizing ends (spec finding 3). Parse `types`: a comma list kept to `contacts`, `calls`, `conversations`; none left means all three; a skipped source answers `[]` without being called. Contacts: `searchContacts(db, accountId, { term: raw, limit: PER_SOURCE })`; `sublabel: phoneMatches(plan, c.phone) ? c.phone : c.email ?? c.phone ?? null`. Update the long comment above `raw` (the sanitized-length reasoning stays; the "passes the sanitized term" part goes).

Relationship action: `searchContacts(db, accountId, { term: q, limit: 9 })` in place of `listContacts(…, { search: q, limit: 9 })`; the rest unchanged.

**Tests:**
- `contact-search-tiers.test.ts` (pure, the recording fake from T4): for `ana` the three queries carry, beyond the base, `search_name.eq.ana`, then `search_name.ilike.ana%,search_name.ilike.% ana%`, then nothing; for `maria5@example.com` tier 1 is `search_name.eq.maria5example com,email_key.eq."maria5@example.com"`; for `(956) 555-0199` tier 1 includes `phone_national.eq.9565550199`; for `李` (no tokens, no phone, no `@`) only tier 3 runs. Every query has `account_id`, `holds_shared_number = false`, `archived_at is null`, `merged_into is null`, `order sort_name, id`, `limit`. Merge: limit 3 with tier answers `[A]`, `[B, A]`, `[C, B, D]` → `[A, B, C]` (mutations: concatenate without de-duplicating → FAILS; reverse the tier order → FAILS). An error in any tier throws. `%` → `[]` with no query.
- `route.test.ts`: add `searchContacts` to `dbMocks`; the contacts-half cases move from `listContacts` to it. New: `?q=ana&types=contacts` calls only `searchContacts` and answers `calls: []`, `conversations: []` (mutation: ignore `types` → FAILS); `types=bogus` runs all three; the raw term reaches all three (`ro"sa` arrives as `ro"sa`; replaces "passes the SANITIZED term", `:95-99`); `searchContacts` receives the request client: make the `@/lib/db` mock return a sentinel object and assert it is the first argument (correction 1; mutation: `serviceDb()` → FAILS); sublabel: with `q=0199` a hit `{ phone: "+19565550199", email: "a@b.c" }` shows the phone, with `q=ana` the email.
- `relationship-actions.test.ts`: add `searchContacts: vi.fn()` to the bare mock (`:14`); `:321-330` assert `searchContacts` with `(REQUEST, A, { term: "Ana", limit: 9 })`.
- Live (append to `contact-search-live.test.ts`, one `it`, CI-only): seed Ana García, Mariana Ruiz, Susana Díaz, Juana Ana Pérez; `searchContacts(db, a, { term: "ana", limit: 5 })` ids start `[Ana García, Juana Ana Pérez]` (tier 2 by `sort_name`; no exact "ana"), then Mariana, Susana; `term: "ana garcia"` puts Ana García first (exact).

Run `pnpm --filter web exec vitest run "src/app/api/accounts" "src/app/(dashboard)/dashboard/accounts/[accountId]/contacts/relationship-actions.test.ts"`, `cd packages/db && pnpm exec vitest run src/contact-search-tiers.test.ts`, `pnpm --filter web typecheck`, `pnpm --filter web lint`. **Done when:** red/green and the named mutations pasted; commit `feat(contacts): the palette and the pickers show the best match first, Add job and held email ask for contacts only, and a phone search shows the phone (F-092)` -- the listed paths.

---

### Task 6: Empty states

**Tier:** LOW · **Owner:** bis-crm · **Wave:** 2 (needs T2's `MIN_PHONE_SEARCH_DIGITS`)

**Files:** `apps/web/src/lib/messages.ts`; `ACCT/contacts/page.tsx` (`emptyCopy` `:149-159` and the `EmptyState` call `:499-502`); `ACCT/contacts/page.test.ts`.

**Copy** (add under `contacts.search.`, beside `contacts.search` `:610-612`; each `.es` on the next line; `{digits}` filled with `MIN_PHONE_SEARCH_DIGITS` from `@bis/db/contact-search`; `{query}` with `q.slice(0, 80)`):

| Key | English | Spanish |
|---|---|---|
| `contacts.search.noMatch.title` | Nobody matches “{query}” | Nadie coincide con “{query}” |
| `contacts.search.noMatch.body` | Try part of the name, or the last {digits} digits of their phone. | Pruebe con parte del nombre o con los últimos {digits} dígitos del teléfono. |
| `contacts.search.lookInArchived` | Look in archived customers | Buscar en clientes archivados |
| `contacts.search.noMatchMine.title` | None of your customers match “{query}” | Ninguno de sus clientes coincide con “{query}” |
| `contacts.search.noMatchArchived.title` | No archived customer matches “{query}” | Ningún cliente archivado coincide con “{query}” |

Retire `contacts.noMatches.title`/`.body` and their `.es` (`:631-634`) once `grep -rn "contacts.noMatches" apps/web/src` shows only the two lines this task rewrites.

**Behaviour:** `emptyCopy` with `q`: archived view → `noMatchArchived.title`; else not `wholeAccount` (a Technician, whose list is only theirs) → `noMatchMine.title`; else → `noMatch.title`; every one carries `noMatch.body`. Only the active-view, whole-account case gets the action: a ghost link `?view=archived&q=<q>` (built with `withView({ q }, "archived")`, the page's own helper) reading `contacts.search.lookInArchived`, no count (spec 6). The `EmptyState` gets `className="[overflow-wrap:anywhere]"` (correction 7). Search without a query keeps today's states.

**Tests** (`page.test.ts`, extending the F-085 describe at `:547-650`; red first): an Owner searching `garcía` with no rows sees `Nobody matches “garcía”`, the body with `4`, and a link whose href is `?view=archived&q=garc%C3%ADa`; Spanish (`?locale=es` or the request locale the file already drives) shows `Nadie coincide con “garcía”`; a Technician sees `None of your customers match` and no archived link (mutation: show the link to everyone → FAILS); the Archived view sees `No archived customer matches` and no link; the link text holds no digit (no promised count). `pnpm --filter web exec vitest run "src/app/(dashboard)/dashboard/accounts/[accountId]/contacts/page.test.ts" src/lib/messages.test.ts src/lib/i18n`, typecheck, lint. **Done when:** red/green pasted; commit `feat(contacts): an empty search says who matched nothing, suggests part of the name or the last four digits, and offers the archived customers (F-092)` -- the three paths.

---

### Task 7: `HighlightedText`, the styleguide and the ⌘K rows

**Tier:** LOW · **Owner:** bis-frontend · **Wave:** 3 (after T3)

**Files:** Create `apps/web/src/components/highlighted-text.tsx`, `highlighted-text.test.ts`, `apps/web/src/app/(dashboard)/dashboard/styleguide/search-highlight-demo.tsx`, `search-highlight-demo.test.ts`; modify `…/styleguide/page.tsx` (one entry), `apps/web/src/components/command-palette.tsx` (the live contacts rows, `:325-340`), `command-palette.test.ts`.

**Behaviour:**

```tsx
import { Fragment } from "react";
import { splitByRanges, type HighlightRange } from "@/lib/contacts/search-highlight";

/** Search hits: the matched letters in weight 600, colour and background inherited (DESIGN.md: weight first, colour last). */
export function HighlightedText({ text, ranges }: { text: string; ranges: readonly HighlightRange[] }) {
  if (ranges.length === 0) return <>{text}</>;
  return (
    <>
      {splitByRanges(text, ranges).map((p, i) => p.hit
        ? <mark key={i} data-search-hit className="bg-transparent font-semibold text-inherit">{p.text}</mark>
        : <Fragment key={i}>{p.text}</Fragment>)}
    </>
  );
}
```

The palette's CONTACTS group only: `hit.label` through `HighlightedText` with `nameRanges(hit.label, query)`, and the sublabel's own text with `phoneRanges(hit.sublabel, query)` (the ` · date` join stays outside the mark); calls and conversations rows unchanged. The styleguide demo shows a palette-like and a list-like row ("María García López" for `garcia maria`; "(956) 555-0199" for `0199`; "Peña" for `pena`), its data in a const array rendered with `{…}` (the i18n ratchet counts JSX text literals: run `src/lib/i18n/ratchet.test.ts`).

**Tests:** `renderToStaticMarkup` of `HighlightedText` for `García` / `[[0, 6]]` contains `<mark data-search-hit="" class="bg-transparent font-semibold text-inherit">García</mark>`; empty ranges render the plain text with no `<mark` (mutation: always wrap → FAILS). The palette test asserts a contacts hit labelled "María García" for query `garcia` renders a `data-search-hit` around `García`, and a calls hit renders none. The demo test renders it. `pnpm --filter web exec vitest run src/components/highlighted-text.test.ts src/components/command-palette.test.ts "src/app/(dashboard)/dashboard/styleguide" src/lib/i18n`, typecheck, lint; light and dark by eye on `/styleguide` is the orchestrator's capture. **Done when:** red/green pasted; commit `feat(design): search hits set the matched letters in weight 600, first in the command palette (F-092)` -- the listed paths.

---

### Task 8: Highlight in the contact list and the relationship picker

**Tier:** LOW · **Owner:** bis-crm · **Wave:** 4 (after T7)

**Files:** `ACCT/contacts/contacts-table.tsx` (name cell `:318-323`, phone cell `:326-333`), `contacts-table.test.ts`; `ACCT/contacts/add-relationship-dialog.tsx` (hit rows `:157-163`) and `ACCT/contacts/add-relationship-dialog.test.ts` (if it cannot render the hit row without a DOM, extract the row into an exported `RelatableHitRow` in the same file and render it statically).

**Behaviour:** the table already receives `q` (`:98`, `:119`): name `<HighlightedText text={name} ranges={q ? nameRanges(name, q) : []} />` inside the existing `truncate` span; phone the same with `phoneRanges(c.phone, q)`. The picker: `personName(h, …)` with `nameRanges(…, term)`, the phone with `phoneRanges(h.phone, term)`. Nothing else changes (the row stays the click target; `data-contact-row` untouched).

**Tests:** the table with `q="garcia"` and a row "María García" renders `data-search-hit` around `García` (mutation: render the name without `HighlightedText` → FAILS); without `q`, no `<mark` (mutation: compute the ranges from a fixed query instead of `q` → FAILS); a phone row with `q="0199"` marks `0199`. The picker row likewise. Run the two test files, typecheck, lint. **Done when:** red/green pasted; commit `feat(contacts): the contact list and the relationship picker show which letters matched (F-092)` -- the listed paths.

---

### Task 9: Add job asks for contacts only, and highlights

**Tier:** LOW · **Owner:** bis-booking · **Wave:** 4 (after T5 and T7)

**Files:** `ACCT/calendar/job-sheet.tsx` (`onQuery` `:174-190`, the hit rows `:309-327`), `ACCT/calendar/job-sheet-handlers.ts`, `job-sheet-handlers.test.ts`.

**Behaviour:** move the URL into `job-sheet-handlers.ts` as `export function customerSearchUrl(accountId: string, term: string): string` → `/api/accounts/${accountId}/search?q=${encodeURIComponent(term)}&types=contacts`, and call it from `onQuery`. The row's label through `HighlightedText` with `nameRanges(h.label, hits.query)`, the sublabel with `phoneRanges(h.sublabel, hits.query)`. **Tests:** `customerSearchUrl("a1", "garcía maria")` equals `/api/accounts/a1/search?q=garc%C3%ADa%20maria&types=contacts` (mutation: drop `&types=contacts` → FAILS). Run the handlers test, typecheck, lint. **Done when:** commit `feat(booking): Add job asks the search for contacts only and shows which letters matched (F-092)` -- the three paths.

---

### Task 10: Held email and the shared-number mover

**Tier:** LOW · **Owner:** bis-comms · **Wave:** 4 (after T5 and T7)

**Files:** `ACCT/conversations/held-email-search.ts` (`:40-49`) and its test; `ACCT/conversations/held-email-search-results.tsx` and its test; `ACCT/conversations/holding-move.tsx` (`:60-70`) and its test.

**Behaviour:** `searchHeldContacts` fetches `…/search?q=${encodeURIComponent(query)}&types=contacts`. The results rows and the mover's rows (which already read `searchRelatableContactsAction`, best-first after T5) highlight the name with `nameRanges` and the phone with `phoneRanges` against the query the rows answered. **Tests:** the fetch mock receives a URL ending `&types=contacts` (mutation: drop it → FAILS); a rendered result for query `garcia` marks `García`. Run the three test files, typecheck, lint. **Done when:** commit `feat(comms): held email asks the search for contacts only, and both pickers show which letters matched (F-092)` -- the listed paths.

---

### Task 11: `searchGroups` on folded words (Q4)

**Tier:** LOW · **Owner:** bis-crm · **Wave:** 2 (needs T1's column and T2)

**Files:** `packages/db/src/client-groups.ts:130-144`; create `packages/db/src/client-groups-search.test.ts` (pure); append one case to `packages/db/src/test/client-groups.test.ts` (CI-only).

**Behaviour:** keep both guards (`!trimmed`, `!s`); then `const { tokens } = contactSearchPlan(trimmed)`; the filter becomes `.or([`name.ilike.%${s}%`, …words])` where `words` is `search_name.ilike.%t%` for one token or `and(search_name.ilike.%t1%,…)` for several (T4's shape; today's raw `name` arm kept, so nothing found today is lost); order and limit unchanged (`name_key`, 8). **Tests:** pure, with the recording fake: `familia garcía` → `.or("name.ilike.%familia garcía%,and(search_name.ilike.%familia%,search_name.ilike.%garcia%)")` (mutation: drop the token arm → FAILS); `%` → `[]` and no query. Live (CI): a household "Familia García" is found by `familia garcia`, `garcia familia` and `GARCIA`. `cd packages/db && pnpm exec vitest run src/client-groups-search.test.ts`, `pnpm --filter web typecheck`. **Done when:** commit `feat(contacts): finding a household or business ignores accents and word order, like customers (F-092, owner Q4)` -- the three paths.

---

### Task 12: The 50,000-contact measurement

**Tier:** MEDIUM · **Owner:** bis-db-schema; bis-crm supplies the query shapes from T4/T5 · **Wave:** 4 (after T4 and T5)

**Where:** a real PostgreSQL **17.6** replica (correction 6), your own: unzip the archive as T1 Step 1 did into `<scratchpad>/cs-t12/pg17full`, copy T1's script to `cs-t12/pg17-perf.sh`, port **55985**, `pre` = 0001–0107 exactly as T1's `init`.

**Seed** (`perf` = `create database perf template pre`, timezone UTC; seed with `set session_replication_role = replica` so the per-row pair trigger does not file millions of flags; generated columns still compute): one agency, **10 accounts × 50,000 contacts** (500,000), names from fixed arrays of 40 Spanish first names (half accented: María, José, Inés, Ramón…) and 40 surnames (García, López, Peña, Núñez, Treviño…), 70 % two surnames, 30 % one; phones: 40 % `+1956…`, 20 % `(956) …`, 25 % `+52899…`, 10 % `+52 1 899 …`, 5 % none; 60 % with an email; 3 % archived; created_at spread over two years. Then time `psql -1 -f 0108` on `perf` three times (re-create `perf` from a seeded template each time) and record the index sizes (`select pg_size_pretty(pg_relation_size('public.contacts_search_trgm'))`). `analyze`.

**Queries:** as a signed-in Owner of one account under RLS (`set local role authenticated` and `request.jwt.claims` for a member made like `actAsMember`, `packages/db/src/test/db.ts:33-42`), the SQL the app sends, written from `contactSearchFilter`/`searchContacts`' strings (bis-crm writes them into `cs-t12/queries.sql` and the reviewer checks each against T4's pure-test strings): the list page `… where account_id = $1 and holds_shared_number = false and archived_at is null and merged_into is null and (<filter>) order by created_at desc, id desc limit 51` and `order by sort_name, id limit 51`; its `select count(*)` with the same filter; the palette's three tiers, limit 5. Terms: `garcia`, `maria lopez`, `garcía lópez`, `ana`, `0199`, `(956) 555-0199`, `+52 1 899 123`, `zzqx` (matches nothing: the worst case for a limited page), and the two-letter `ma`.

**Measure:** a node script in your scratchpad using `pg` from `packages/db/node_modules`, 5 warm-up then 40 timed runs per query, reporting p50 and p95; plus `explain (analyze, buffers)` once per query (paste the plan's top node and whether `contacts_search_trgm` appears).

**Pass:** for every term of 3+ characters, p95(list page) + p95(count) **< 150 ms** under each sort, and p95(tier 1) + p95(tier 2) + p95(tier 3) **< 100 ms**. The two-letter `ma` cannot use a trigram index; it passes at **< 300 ms** list + count.
**If a 3+ character term misses:** add `create extension if not exists btree_gin with schema extensions;` and replace `contacts_search_trgm` with one that leads with `account_id extensions.gin_uuid_ops` (check the opclass name in the PG17 `btree_gin` script first) on `perf`, re-measure, and only if that passes, change 0108 (index, header, the extension) and T1's index case and both parity lists (`btree_gin`) in ONE commit, with the numbers; then the orchestrator re-runs T1 Steps 7–8 on a fresh replica. If it still misses, or `ma` misses its line: stop, and the orchestrator brings the table of numbers to the owner (the only owner question this plan can raise).

**Done when:** the header's `<T12 fills …>` placeholder holds the 500,000 apply time and index size, and the report holds the full p50/p95 table, the plans' top nodes, and the pass/fail per line; commit `docs(db): 0108's header carries the 50,000-contacts-per-account measurement (F-092)` -- `packages/db/supabase/migrations/0108_contact_search.sql` (plus, only on the fallback, the files named above).

---

### Task 13: e2e

**Tier:** LOW · **Owner:** bis-e2e-qa · **Wave:** 5 (after 0108 is on bis-ci; the orchestrator runs it)

**Files:** create `apps/web/e2e/contacts-search.spec.ts`.

On the per-run fixture account only (read how `contacts-archive.spec.ts` or `contacts-merge.spec.ts` makes and uses it), never `Test Client One`. Make "María García López" (`+52 899 123 4567`) and "Inés Peña" through the app or the fixture helper those specs use. Locators scoped to `getByRole("main")` or a `data-*` scope (Next streaming duplicates Suspense content outside `main`).
1. The list: search `garcia maria` → the row (`[data-contact-row]`) for María is visible, the header total says one, a `[data-search-hit]` wraps `García`; search `pena` → Inés.
2. Phone: search `+52 1 899 123 4567` → María.
3. ⌘K: type `garcia` → the contacts group lists María with a `[data-search-hit]`.
4. Empty: search `zzqx` → "Nobody matches “zzqx”" and the "Look in archived customers" link to `?view=archived&q=zzqx`.
**Mutation probe:** in a scratch copy, make `withSearch` drop the token arm: step 1 FAILS by name. Revert. Commit `test(e2e): search finds accented names, full names in any order and a +52 1 number, in the list and in the palette (F-092)` -- the one path.

---

## Orchestrator checklist (in order)

1. **Install once:** `pnpm install --frozen-lockfile --prefer-offline` in the worktree, before wave 1.
2. **Wave gates:** wave 2 only after T1's Steps 7–8 lines are in its report and its commit is on the branch, and T2 is committed; wave 3 after T4 (for T5) and T3 (for T7); wave 4 after T5 and T7; wave 5 after step 5.
3. **Push after wave 2 and after wave 4.** CI `verify` builds its own stack from the branch's migrations, which proves ASSUMPTION A1 (0108 applies in the Supabase CLI images) and runs the live files (T4, T5, T11). Read the check runs FOR THE HEAD SHA (`gh api repos/:owner/:repo/commits/<sha>/check-runs`), then the db-suite log, and find by name every case of `contact-search-live.test.ts` and the `client-groups.test.ts` case green. The `e2e` job's migration check fails naming 0108 until step 5: that red is expected.
4. **T12's verdict** is in before step 5: 0108's text must be final (the header numbers, and the index if the fallback ran) before it reaches an append-only project.
5. **0108 to bis-ci:** pre-checks (below) on bis-ci; `ci-project-setup.yml` from `feat/search-accents`, push-dry-run, then push; post-checks on bis-ci.
6. **T13** (local e2e): no `screenshots.yml` run in progress; one gate at a time.
7. **Production:** pre-checks; MCP `apply_migration`, name `contact_search`, the file's exact text (ASCII only, no backslash: the `\u` trap does not apply); post-checks.
8. **Parity** (`docs/runbooks/ci-supabase-project.md`): `packages/db/supabase/parity/fingerprint.sql` on both; every kind's digest equal. The `extension` kind now lists `pg_trgm` on both; a difference only in an `extensions.` qualification inside `index` is a search_path artefact (T1 Step 9), confirmed with `fingerprint-detail.sql`.
9. **PR** from `feat/search-accents`; squash-merge only after `verify` and `e2e` are green FOR THE HEAD SHA.
10. **Ledger and roadmap:** the eight planning corrections; F-092 part 1's row in `docs/crm-features.md` and the roadmap tracker.

**Pre-checks (read-only, before applying, on bis-ci then production):**

```sql
select count(*) from pg_extension where extname = 'pg_trgm';                                        -- 0
select count(*) from information_schema.columns where table_schema = 'public' and column_name = 'search_name';   -- 0
select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where p.prosecdef and n.nspname in ('public', 'app');                                               -- 37
select count(*) || '|' || md5(string_agg(x, ',' order by x)) as digest from (
  select r || ' ' || c.relname || ' ' || p as x
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   cross join (values ('anon'), ('authenticated')) v(r)
   cross join (values ('INSERT'), ('UPDATE'), ('DELETE')) w(p)
   where n.nspname = 'public' and c.relkind = 'r' and has_table_privilege(r, c.oid, p)) s;           -- 49|e0df0cc230da2dce6fa93b26b43e6d46
select count(*) from public.contacts;  select count(*) from public.client_groups;                    -- record both
```

**Post-checks (read-only, after applying, on each project):**

```sql
select e.extversion, n.nspname from pg_extension e join pg_namespace n on n.oid = e.extnamespace
 where e.extname = 'pg_trgm';                                                                        -- 1.6 | extensions
select table_name, is_generated, generation_expression from information_schema.columns
 where table_schema = 'public' and column_name = 'search_name' order by 1;
  -- client_groups | ALWAYS | app.contact_name_fold(name)
  -- contacts      | ALWAYS | app.contact_search_name(first_name, last_name, company_name)
select indexname from pg_indexes where schemaname = 'public'
   and indexname in ('contacts_search_trgm', 'client_groups_search_trgm') order by 1;               -- both
select p.provolatile, p.prosecdef, p.proconfig,
       has_function_privilege('anon', p.oid, 'EXECUTE') as anon,
       has_function_privilege('authenticated', p.oid, 'EXECUTE') as auth,
       has_function_privilege('service_role', p.oid, 'EXECUTE') as svc
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'app' and p.proname = 'contact_search_name';     -- i | f | {search_path=pg_catalog, pg_temp} | f | t | t
-- the definer count: still 37; the client-write digest: still 49|e0df0cc230da2dce6fa93b26b43e6d46 (the two pre-check queries)
select count(*) as all_rows, count(search_name) as named,
       count(*) filter (where search_name is null
                          and (coalesce(first_name, '') || coalesce(last_name, '') || coalesce(company_name, '')) ~ '[A-Za-z]') as missed
  from public.contacts;                                                                              -- missed = 0; all_rows = the pre count
select count(*) filter (where search_name = '' and name ~ '[A-Za-z]') as missed from public.client_groups;   -- 0
select app.contact_search_name('Mar' || chr(237) || 'a', 'Garc' || chr(237) || 'a L' || chr(243) || 'pez', null);  -- maria garcia lopez
```

Any answer other than the one in its comment: stop before the next project and report.

## Not in this plan

- **The new-deal picker reaches only the newest 200 contacts** (`ACCT/pipeline/page.tsx:26`, a plain Select in `ACCT/pipeline/add-opportunity-dialog.tsx:78-89`): a customer older than that cannot be chosen. It should become a search box on `searchContacts`; a pipeline task, recorded for the ledger. (The other spec finding, Add job and held email paying for two searches they discard at `ROUTE:94-98`, IS in this plan: T5's `types=contacts`, used by T9 and T10.)
- Part 2 (one index across every record type, nickname expansion, typo tolerance) and F-095 (Spanish type words, "Ver los N resultados"); calls search by formatted phone and message bodies; joined-up words ("obrien" for "O'Brien") and a name and a number in one query (spec section 10).

## Self-review (2026-10-31)

- **Spec coverage.** §1 → T4 (accents, full names, the legacy +52 shape), T5 (best first). §2 rows 1–2 → T4; 3 → T5, T7; 4 → T5, T9; 5 → T5, T10; 6–7 → T5, T8, T10; 8 → T1, T11; 9–13 unchanged by design. §3 → T1 (reuses the fold). §4.1 → T2, T4; §4.2 → T2; §4.3 → T1 (and the pre-flight); §4.4 → T4; §4.5 → T12. §5 → T5. §6 → T3, T6, T7–T10. §7 → T4 live (archived, merged, holding), T5 (request client; correction 1). §8 D1–D9 → T1, T2, T4, T5, T7. §9 → Global Constraints. §11 → the task list. §13 → "Not in this plan" and T5.
- **Placeholders.** The two `<… fills …>` markers in 0108's header are measurements T1 Step 8 and T12 write in, by name; no "TBD". UI tasks are specified by behaviour, tests and DESIGN.md rules rather than full component bodies, as the model plan did for its UI tasks.
- **Names.** `contactSearchPlan`, `ContactSearchPlan`, `PhoneSearch`, `MIN_PHONE_SEARCH_DIGITS`, `phoneMatches`, `contactSearchFilter`, `searchContacts`, `foldChar`, `contactSearchName`, `nameRanges`, `phoneRanges`, `splitByRanges`, `HighlightRange`, `HighlightedText`, `customerSearchUrl`, `contacts_search_trgm`, `client_groups_search_trgm`, `app.contact_search_name`, `search_name`, `contacts.search.*` are spelled the same wherever they appear.
- **Not run while planning:** the migration text and the test code above were written from the source, not executed (no `node_modules` in this worktree, and no replica was started for the plan). T1 Steps 5–8 are where they first run; where the replica or 0069's real signatures disagree with a line here, the source wins and the report says which line.
