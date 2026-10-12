# The contact record page, PR 1b (the timeline): implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every row on the contact record page's timeline says who did what and when, with an author mark from one closed set (a named person or "Someone on the team", "Sofía · AI", an automation, the customer, an import). Bookings and calls become their own row kinds, the inbox's `form`/`voice` copies leave the timeline, the timeline pages on the server across seven sources, and it reads in English and Spanish. Migration 0073 (author columns, triggers, backfill, three indexes), then the NOT NULL follow-up.

**Architecture:** Migration 0073 adds `created_by` (stamped from the JWT by triggers) on `tasks`/`opportunities`, `author_kind`/`author_id` written by server code on `messages`/`bookings`, `author_kind` (default `customer`) on `form_submissions`, guards `notes.author_id`, indexes `(account_id, contact_id)` on `bookings`/`tasks`/`calls`, and backfills history through one re-runnable function. Each domain's `listContact<Thing>` gains an additive page option (`(at desc, id desc)`, `before` cursor, `limit`). `packages/db/src/record.ts` merges the seven sources into one page of 30 with an "older" cursor and a `failed` list. In `apps/web`, a pure mapping (`lib/record/author-mark.ts`) and row builder (`lib/record/timeline-rows.ts`) turn entries into rows. The kit's `AuthorMark` and `TimelineItem` draw them, and the rewritten `ActivityTimeline` renders composer, rows, failure notice and one pager.

**Tech Stack:** Postgres (Supabase; plpgsql triggers, RLS), supabase-js through `@bis/db`, Next.js 16 App Router (server page, client cards), React 19.2, Tailwind v4, vitest (`renderToStaticMarkup`, no DOM; `withRollback` on a local PG18 replica; `withTestAccount` on CI `verify`), Playwright (bis-e2e-qa only).

**Spec:** `docs/superpowers/specs/2026-10-12-record-page-design.md` (origin/main `a5d0868a`, plus this branch's fix to §6, §7 and §10.2: a booking row reads "booked an appointment for {when}", with no calendar name). This plan covers **only 1b**: everything the spec marks **[1b]**. PR 1a (#246) is merged and is the base: the kit (`apps/web/src/components/record/*`), the registry, the loaders (`apps/web/src/lib/record/loaders.ts`), `packages/db/src/record.ts` (`contactFacts`, `contactNextUp`), and `ActivityTimeline` inside its card with the composer on top.

## Global Constraints

- **Ownership (tag on every task).** bis-db-schema: migrations 0073/0074, `packages/db/src/provenance.ts`, their schema and parity tests (writes migrations, never applies them). bis-comms: `packages/db/src/messaging.ts` (`createMessage`, `listContactMessages`), `message-composer.tsx`, `lib/consent/composer-state.ts`, `lib/email/failure-reason.ts`, the `compose.*`/`conversations.*` copy. bis-booking: `packages/db/src/booking.ts` and the `calendar.bookings.*` copy. bis-voice: `packages/db/src/voice.ts` and the `calls.*` copy. bis-automations: `apps/web/src/lib/concierge/lead.ts`. bis-frontend: `apps/web/src/components/record/*`, `/styleguide`, DESIGN.md text, the `provenance.*` copy. bis-crm: `packages/db/src/{timeline-cursor,record,activities,opportunities,forms}.ts`, `apps/web/src/lib/record/*`, `apps/web/src/lib/cursor.ts`, the `[contactId]` page and its timeline, the `timeline.*`/`contact.*` copy. bis-e2e-qa: `apps/web/e2e/**`. **No task edits a file its owner does not own.**
- **`apps/web/src/lib/messages.ts` is edited by five tasks, strictly in this order, one at a time:** Task 8 → Task 3 → Task 4 → Task 5 → Task 9. Each task's messages.ts step is its LAST code step and starts only after the previous task in this chain has committed. New keys go just above `} as const;` (`messages.ts:3774` today), under the task's own namespace. A `.es` twin for an existing key goes on the line directly under its English key.
- **Migration order (G9 first).** 0072 (`0072_company_name_read_only.sql`, branch `feat/s02-g9`, not on main yet) must be on bis-ci, on production and on `main` before 0073 goes anywhere. Task 0 merges `origin/main` into this branch only after G9 has merged. The bis-ci dry run must list only `0073_record_provenance.sql`. Then push to bis-ci. Then apply to production exactly once through MCP `apply_migration`, with an ASCII-only file and no backslash (the MCP mangles escapes). Then the parity digest. Only then merge 1b. The NOT NULL follow-up (Task 13, `0074_record_provenance_not_null.sql` or the next free number) goes later, in the same order. **Never re-apply 0069–0072.**
- **No `@bis/db` vitest runs locally against bis-ci until 0073 is on bis-ci.** The package's globalSetup sweep runs on every invocation. Prove `withRollback` (schema, parity) tests on a **local PG18 replica**: `initdb -E UTF8 --locale=C --locale-provider=icu --icu-locale=en-US`, `alter database … set timezone to 'UTC'`, one port per agent (table below), never 5432. Pure db tests (no connection) run with the credentials blanked so the sweep skips: `NEXT_PUBLIC_SUPABASE_URL= SUPABASE_SERVICE_ROLE_KEY= SUPABASE_DB_URL=postgresql://postgres@localhost:<port>/post`. `withTestAccount` (PostgREST) tests are written red-first against the stub, typechecked locally, and proven red then green by **CI `verify`** (an in-runner stack that applies every migration in the branch) after the orchestrator pushes. Never run the three live web tests (`src/app/f/[publicId]/actions.returning-lead.test.ts`, `calls/[callId]/actions.test.ts`, `weekly-metrics.live.test.ts`).
- **Replica ports:** Task 1 implementer `55500`, Task 1 reviewer `55501`. Task 13 implementer `55502`, reviewer `55503`. Spares `55504`–`55509`. Scratch only under `C:\Users\danlo\AppData\Local\Temp\claude\C--Users-danlo-bis-platform\b2404cc3-3bd3-4952-b479-7ac904054953\scratchpad\s03-1b-t<N>-impl\` (reviewer: `-review\`), written in Git Bash as `/c/Users/danlo/AppData/Local/Temp/claude/C--Users-danlo-bis-platform/b2404cc3-3bd3-4952-b479-7ac904054953/scratchpad/s03-1b-t<N>-impl`. Below, `<SCRATCH>` means that literal path and `<WT>` means `/c/Users/danlo/bis-platform/.claude/worktrees/s03-1b`.
- **plpgsql NULL guard.** Every boolean a policy, CHECK or trigger branches on is `coalesce(…, false)`: `is_agency()` is NULL for a client token, and `x = 'person'` is NULL when `x` is NULL. A CHECK that evaluates to NULL **passes**.
- **A HEAD count throws on a null count** (repo rule since #245). This plan adds no HEAD count. Any count added later must keep the rule.
- **Every test can fail.** Each test names the mutation probe that makes it fail. Run the probe, see the test fail BY NAME, paste the failing assertion line, revert. A `-t` filter that matches nothing passes silently, so check the run count.
- **The `vi.mock("@bis/db")` factory check.** A task that adds a NEW named import from `@bis/db` to an existing module adds that name to every `vi.mock("@bis/db", …)` factory reaching the module: `grep -rln 'vi.mock("@bis/db"' apps/web/src | xargs grep -ln "<module basename>"`.
- **DESIGN.md definition of done for every UI task (8, 9, 10):** tokens only, with no hard-coded colour, radius or shadow (dots use `bg-[var(--accent|good|warn|crit|text-3)]`, the mark uses `--chip-line`/`--chip-bg`/`--chip-text`, radii `rounded-full`/`rounded-[var(--radius-ctl)]`). Renders in dark and light (the `.dark` class). Survives the blur fallback (cards keep the `glass` utility and are never blurred). Loaded, empty and error states. Visible `:focus-visible` ring; controls at least 44px tall on a phone (`min-h-11 md:min-h-8`). EN+ES, the pseudo-locale's +35% wraps and never clips, and `lang` is correct (typed text `lang=""`, a caller's words `lang={calls.language}`, C11). Rule 3: status is a dot plus a word. Rule 7: skeletons, never a spinner. Rule 11: no hero. New kit pieces get `/styleguide` entries.
- **Copy:** usted, trades Spanish, the spec's §10.2 words verbatim (with this branch's `timeline.booked` fix). No `{{…}}`, no milestone codes (`INTERNAL_MILESTONE` in `messages.test.ts`), no carrier or vendor jargon. New `.tsx` files carry NO JSX literal copy (the ratchet, `lib/i18n/ratchet.test.ts`). Typed text (a note, a text, a form answer) is shown as typed, never translated.
- **Running tests.** Web: `pnpm --filter web exec vitest run <paths>`, `pnpm --filter web typecheck`, `pnpm --filter web exec eslint <touched files>`. DB: `pnpm --filter @bis/db typecheck`. Judge a db run by vitest's summary block (`ERR_PNPM_RECURSIVE_EXEC_FIRST_FAIL` prints after the real results). When an exit code matters, write it to a file with nothing after the command. Never run the gates (`pnpm check`, `pnpm --filter web build`, `pnpm --filter web test:e2e`): the orchestrator runs them, one at a time.
- **Commits:** `git add -- <new files>` then `git commit -m "<type>(<scope>): <what and why>" -- <every path>`. Never `-A` or `.`. **Never `git stash`.** If `.git/index.lock` exists, wait and retry; never delete it. Never push. Never touch `main`.
- **Never** apply a migration to bis-ci or production (Task 12 is the orchestrator's), mutate Test Client One, create or edit `.env*`, call a real provider.

## Where this plan departs from the spec's wording (the source decided)

1. **The backfill is a function, `app.backfill_record_provenance()`, run once by 0073 and again by 0074.** The spec asks for "one idempotent statement per table, re-run by the follow-up" (§5.3, §13). A function is the only way both files run the SAME statements, and the schema test can call it twice to prove the second run changes nothing. It returns `(bucket, row_count)`, and 0073's `DO` block raises them as NOTICEs. It stays after 0074, where it is a no-op because no row is NULL any more.
2. **The CASE lives in two SQL functions, `app.message_author(text, text)` and `app.booking_author(text, boolean)`.** The spec's parity test (§12.2) compares "the SQL CASE" with `messageAuthor`/`bookingAuthor`. A CASE inlined in an UPDATE cannot be called per combination, but a function can. The spec names two new functions (§5.2). This plan adds these two pure, immutable helpers as well, executable by nobody but the owner.
3. **The update guards hold only the client role.** `app.keep_created_by()` and the update branch of `app.notes_author_guard()` restore the old value only when `current_user = 'authenticated'`, as 0071's `stamp_created_by` decides by role. The service role and the table owner (the backfill, 0074's re-run) may still correct a value. The spec's sentence does not name a role.
4. **`author_id`'s CHECK is `author_id is null or coalesce(author_kind = 'person', false)`.** The spec's literal `author_id is null or author_kind = 'person'` evaluates to NULL, and so passes, for a row with an id and no kind. That is exactly the shape a nullable column admits before 0074.
5. **Cursor filtering happens in SQL as a row-value comparison** (`at < v OR (at = v AND id < id)`), the contact list's own idiom (`contacts.ts:783-805`). It does not use "`at <= v`, then drop in the composer" (§7). Both are exact, and the SQL form never spends a row of the 31.
6. **Booking status words reuse `calendar.bookings.status.*`** (`messages.ts:1591-1594`, bis-booking's, gaining twins) instead of adding a parallel `booking.status.*` (§10.2, which §15 left to bis-booking). So "completed" reads "Completed" on the calendar and on the record alike, not "Done".
7. **Row order inside the head line is mark · verb · status · detail · time.** Two of the spec's three examples put the status first ("answered a call · ● Booked · 3 min"); the deal example puts its amount first. This plan uses one order for every row.
8. **`AiAuthorMark` (bis-voice, `calls/ai-author-mark.tsx`) is kept, not folded.** The call card keeps using it, and the timeline stops importing it (§15 allows "kept and wrapped").
9. **Technician parity for the merged page is the existing `technician-scope.test.ts`.** Its `PER_CONTACT` table (`:27-31`) already pins notes, tasks, opportunities, messages, calls, bookings and form_submissions one by one. This plan adds the one new read a Technician makes (team names from `users`) to the schema test. A supabase-js Technician client does not exist in the db suite.
10. **A booking whose `author_kind` is still NULL (the window between 0073 and 1b's deploy, until 0074) reads "Customer".** The public booking page is the common maker. A NULL outbound message reads "Someone on the team" (D9) and an inbound one "Customer", both the backfill's own defaults.
11. **The composer and its consent lines become bilingual in 1b (Task 3).** The spec lists "the composer's" keys among the twins 1b needs (§10.2). `composerStateLine`, `composerEmailNotice` and `messageFailureReason` gain an optional `locale` (default `"en"`, so every other caller is unchanged). `automations.reason.accountSuppressed` (bis-automations') has no twin and falls back to English through `t()`. That is recorded as a gap below.

## File Structure

**Created**

| Path | Owner | Responsibility |
|---|---|---|
| `packages/db/supabase/migrations/0073_record_provenance.sql` | bis-db-schema | columns, CHECKs, triggers, indexes, the backfill function and its first run |
| `packages/db/supabase/migrations/0074_record_provenance_not_null.sql` | bis-db-schema | (Task 13, its own PR) re-run, then `set not null` |
| `packages/db/src/provenance.ts` | bis-db-schema | `AUTHOR_KINDS`, `AuthorKind`, `RowAuthor`, `messageAuthor`, `bookingAuthor` |
| `packages/db/src/test/record-provenance-schema.test.ts` | bis-db-schema | triggers, CHECKs, indexes, backfill buckets, re-run (replica) |
| `packages/db/src/test/provenance-parity.test.ts` | bis-db-schema | SQL CASE functions == TS functions (replica) |
| `packages/db/src/timeline-cursor.ts` | bis-crm | `TimelineCursor`, `TimelinePageOpts`, `TIMELINE_PAGE_SIZE`, `isTimelineInstant`, `instantKey`, `timelineBeforeFilter`, `withTimelinePage` |
| `packages/db/src/test/timeline-cursor.test.ts` | bis-crm | pure tests of the above |
| `packages/db/src/test/timeline-sources.test.ts` | bis-crm | live: the four bis-crm sources page by `(at, id)` |
| `packages/db/src/test/timeline-merge.test.ts` | bis-crm | pure: `compareTimelineEntries` |
| `apps/web/src/components/record/author-mark.tsx` (+ `.test.ts`) | bis-frontend | `AuthorMark` |
| `apps/web/src/components/record/timeline-item.tsx` (+ `.test.ts`) | bis-frontend | `TimelineItem`, `TimelineItemSkeleton`, `TimelineTone` |
| `apps/web/src/lib/record/author-mark.ts` (+ `.test.ts`) | bis-crm | `authorOf`, `authorLabel`, `authorMark`, `personIdsOf` |
| `apps/web/src/lib/record/timeline-rows.ts` (+ `.test.ts`) | bis-crm | `timelineRows`, `timelineFailedText` |
| `apps/web/src/lib/record/timeline-pager.ts` (+ `.test.ts`) | bis-crm | `timelinePagerHrefs` |
| `…/contacts/[contactId]/activity-timeline.fixture.ts` | bis-crm | `legacyTimeline()`: today's test props → 1b props (tests only) |
| `…/contacts/[contactId]/activity-timeline.rows.test.ts` | bis-crm | the 1b row grammar, pager, notices |

**Modified:** `packages/db/src/{index,activities,opportunities,forms,messaging,booking,voice,record}.ts`, `packages/db/src/test/{messaging,booking,voice,record}.test.ts`, `apps/web/src/lib/{messages,cursor}.ts`, `apps/web/src/lib/cursor.test.ts`, `apps/web/src/lib/consent/composer-state.ts` (+ test), `apps/web/src/lib/email/failure-reason.ts` (+ test), `apps/web/src/lib/concierge/lead.ts` (+ test), `apps/web/src/lib/record/loaders.ts` (+ test), `apps/web/src/components/record/record-card.tsx` (+ test), `…/styleguide/record-demo.tsx` (+ test), `…/contacts/[contactId]/{activity-timeline,message-composer,page,loading}.tsx` and their tests, the nine `activity-timeline.*.test.ts`, `apps/web/e2e/record-page.spec.ts`, `DESIGN.md`, `docs/superpowers/specs/2026-10-12-record-page-design.md` (done in this plan's commit).

`…/contacts/` means `apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/contacts/`.

## Task list, owners, order

| # | Task | Owner | Review | Depends on | Parallel group |
|---|---|---|---|---|---|
| 0 | Merge `origin/main` after G9 (0072) merges; confirm | orchestrator | n/a | G9 merged | — |
| 1 | Migration 0073, `provenance.ts`, schema + parity tests | bis-db-schema | **opus** | 0 | A |
| 2 | Timeline cursor; paged notes, To-dos, deals, submissions; `authorKind` on `createSubmission` | bis-crm | sonnet | 0 | A |
| 8 | Kit: `AuthorMark`, `TimelineItem`, card skeleton slot, styleguide, DESIGN.md; `provenance.*` copy (**messages.ts #1**) | bis-frontend | sonnet | 0 | A |
| 3 | `createMessage` author, paged `listContactMessages`; the composer and its lines bilingual (**messages.ts #2**) | bis-comms | sonnet | 1, 2 (msgs after 8) | B |
| 4 | `createBooking`/`moveBooking` author, `listContactBookings`; status twins (**messages.ts #3**) | bis-booking | sonnet | 1, 2 (msgs after 3) | B |
| 5 | `listContactCalls` widened and paged; outcome twins (**messages.ts #4**) | bis-voice | sonnet | 2 (msgs after 4) | B |
| 6 | The web chat's submission is the AI's | bis-automations | sonnet | 2 | B |
| 7 | `listContactTimelinePage`, `listPeopleNames`, barrel | bis-crm | **opus** | 3, 4, 5 | C |
| 9 | Author-mark mapping, row builder, pager, cursor parse; `timeline.*` copy (**messages.ts #5**) | bis-crm | sonnet | 7, 8 (msgs after 5) | D |
| 10 | `ActivityTimeline` on the kit, loaders, page, loading | bis-crm | **opus** | 3, 9 | E |
| 11 | e2e `record-page.spec.ts` extended | bis-e2e-qa | sonnet | 10 | F |
| 12 | Rollout: measure, bis-ci, production, parity, merge | orchestrator | n/a | 11 | — |
| 13 | Follow-up PR: 0074 NOT NULL + insert-site sweep | bis-db-schema | **opus** | 12 deployed | — |

**Group A** (1, 2, 8) touch disjoint files: Task 1 owns the migration, `provenance.ts`, its two tests and one `index.ts` block; Task 2 owns `timeline-cursor.ts`, `activities.ts`, `opportunities.ts`, `forms.ts` and two tests and does **not** touch `index.ts`; Task 8 owns `components/record/*`, the styleguide, DESIGN.md and is first in the messages.ts chain. **Group B** (3, 4, 5, 6) touch disjoint code files (`messaging.ts` + composer files; `booking.ts`; `voice.ts`; `lead.ts`); only their messages.ts steps are serialized (3 → 4 → 5). `index.ts` is edited only by Task 1 and Task 7, which never overlap in time.

---

## Task 0: Merge `origin/main` after G9 (orchestrator)

- [ ] **Step 1.** Wait until G9 (`feat/s02-g9`, migration `0072_company_name_read_only.sql`) has merged to `main` and 0072 is on bis-ci and production (its own rollout). Then, in `<WT>`: `git fetch origin && git merge origin/main`. Expect no conflict: on `main` today G9's diff touches only `client-groups-*`, `company-name-read-only-schema.test.ts`, `contacts-marketing-optout-schema.test.ts`, `schema-grants-guard.test.ts`, `server-only-writes-grants.test.ts`, the 0072 file and its spec. None of these appear in this plan.
- [ ] **Step 2.** Confirm, and stop if any line differs:
  `ls packages/db/supabase/migrations | tail -3` → `0070_contact_relationships.sql`, `0071_places_and_equipment.sql`, `0072_company_name_read_only.sql`.
  `grep -c "0073_" -r packages/db/supabase/migrations` → `0`.
  `grep -n "export async function listContactUpcomingBookings" packages/db/src/booking.ts` hits (1a's read).

---

## Task 1: Migration 0073, `provenance.ts`, and their proof (bis-db-schema)

**Review:** opus. **Scratch:** `<SCRATCH>` = `…/scratchpad/s03-1b-t1-impl`, replica port **55500** (reviewer `s03-1b-t1-review`, **55501**).

**Files**
- Create: `packages/db/supabase/migrations/0073_record_provenance.sql`
- Create: `packages/db/src/provenance.ts`
- Create: `packages/db/src/test/record-provenance-schema.test.ts`
- Create: `packages/db/src/test/provenance-parity.test.ts`
- Modify: `packages/db/src/index.ts` (one block, appended after the record block that ends at `:268`)

**Interfaces**
- Consumes (SQL): `app.stamp_created_by()` (0071:139-148), `app.jwt()` (0001:4), `events (account_id, type, actor_type, actor_id, payload)` (0001:58-66), `concierge_conversations.submission_id` (0042:70). Event payload keys: `message.created {messageId}` (`messaging.ts:150-152`), `booking.created {bookingId}` (`booking.ts:267-268`, `:787-788`), `task.created {taskId}` (`activities.ts:36-37`), `opportunity.created {opportunityId}` (`opportunities.ts:27-28`).
- Produces (SQL), exact names later tasks rely on:
  - Columns `tasks.created_by text`, `opportunities.created_by text`, `messages.author_kind text`, `messages.author_id text`, `bookings.author_kind text`, `bookings.author_id text`, `form_submissions.author_kind text not null default 'customer'`.
  - Constraints `messages_author_kind_check`, `messages_author_id_person`, `bookings_author_kind_check`, `bookings_author_id_person`, `form_submissions_author_kind_check`.
  - Triggers `tasks_stamp_created_by`, `opportunities_stamp_created_by`, `tasks_keep_created_by`, `notes_author_guard`; functions `app.keep_created_by()`, `app.notes_author_guard()`, `app.message_author(text, text)`, `app.booking_author(text, boolean)`, `app.backfill_record_provenance() returns table (bucket text, row_count bigint)`.
  - Indexes `bookings_account_contact`, `tasks_account_contact`, `calls_account_contact`, each `(account_id, contact_id)`.
- Produces (TS), `packages/db/src/provenance.ts`, barrelled:
  ```ts
  export const AUTHOR_KINDS: readonly ["person", "ai", "automation", "customer", "import"];
  export type AuthorKind = (typeof AUTHOR_KINDS)[number];
  export type RowAuthor = { authorKind: AuthorKind; authorId: string | null };
  export function messageAuthor(actorType: ActorType, actorId: string, direction: "inbound" | "outbound"): RowAuthor;
  export function bookingAuthor(actorType: ActorType, actorId: string): RowAuthor;
  ```

- [ ] **Step 1: Build your replica** (without 0073). Write the env file:

```bash
mkdir -p "<SCRATCH>"
cat > "<SCRATCH>/env.sh" <<'EOF'
S="<SCRATCH>"
PGBIN="/c/Program Files/PostgreSQL/18/bin"
P() { "$PGBIN/psql" -h localhost -p 55500 -U postgres -v ON_ERROR_STOP=1 -q "$@"; }
EOF
```

Then from `<WT>` in Git Bash:

```bash
source "<SCRATCH>/env.sh"
"$PGBIN/initdb" -U postgres -A trust -E UTF8 --locale=C --locale-provider=icu --icu-locale=en-US -D "$S/pgdata" > "$S/initdb.log" 2>&1
"$PGBIN/pg_ctl" -D "$S/pgdata" -o "-p 55500" -l "$S/pg.log" start </dev/null >/dev/null 2>&1
P -c "create role anon nologin noinherit; create role authenticated nologin noinherit; create role service_role nologin noinherit bypassrls; grant anon, authenticated, service_role to postgres;"
P -c "create database pre"
P -d pre -c "alter database pre set timezone to 'UTC'"
P -d pre -c "create schema if not exists app; create schema if not exists extensions;"
sed -n '58,63p;72,73p' packages/db/supabase/bootstrap/ci-project.sql | P -d pre
for f in packages/db/supabase/migrations/0*.sql; do
  case "$f" in *0073_*) continue;; esac
  P -d pre -1 -f "$f" || { echo "FAILED at $f"; break; }
done
```

Expected: no `FAILED at` line. Check the facts 0073 relies on (read-only, on `pre`):

```bash
P -d pre -At -c "select proname from pg_proc where pronamespace = 'app'::regnamespace and proname in ('stamp_created_by','jwt') order by 1"
P -d pre -At -c "select count(*) from information_schema.columns where table_schema='public' and ((table_name='notes' and column_name='author_id') or (table_name='concierge_conversations' and column_name='submission_id') or (table_name='bookings' and column_name='ip_hash'))"
ls packages/db/supabase/migrations | tail -1
```

Expected: `jwt`, `stamp_created_by`; `3`; `0072_company_name_read_only.sql`. Anything else: stop (Task 0 did not run).

- [ ] **Step 2: Write `packages/db/src/provenance.ts`** (pure; the parity test needs it to compile):

```ts
import type { ActorType } from "./events";

/**
 * DESIGN.md, Provenance: every timeline row names who made it, from ONE closed set. The same five
 * values as the CHECKs in 0073_record_provenance.sql; a sixth is a compile error here and a 23514 there.
 */
export const AUTHOR_KINDS = ["person", "ai", "automation", "customer", "import"] as const;
export type AuthorKind = (typeof AUTHOR_KINDS)[number];
export type RowAuthor = { authorKind: AuthorKind; authorId: string | null };

/** SQL's btrim(x): spaces only, both ends (never `.trim()`, which strips a superset). */
const btrim = (s: string) => s.replace(/^ +| +$/g, "");

/**
 * Who wrote a message (spec §5.2), from the actor its writer already passes to createMessage. The
 * ONLY place this mapping lives in TypeScript; app.message_author (0073) is its SQL twin, pinned by
 * provenance-parity.test.ts. An inbound message is the customer's unless the receptionist filed it.
 */
export function messageAuthor(actorType: ActorType, actorId: string, direction: "inbound" | "outbound"): RowAuthor {
  if (actorType === "ai") return { authorKind: "ai", authorId: null };
  if (direction === "inbound") return { authorKind: "customer", authorId: null };
  if (actorType === "user") return { authorKind: "person", authorId: btrim(actorId) || null };
  return { authorKind: "automation", authorId: null };
}

/**
 * Who made a booking (spec §5.2). `system` is the public booking page and its move page (the
 * customer); `ai` is the receptionist; `user` a person (no staff path books today). SQL twin:
 * app.booking_author.
 */
export function bookingAuthor(actorType: ActorType, actorId: string): RowAuthor {
  if (actorType === "ai") return { authorKind: "ai", authorId: null };
  if (actorType === "system") return { authorKind: "customer", authorId: null };
  return { authorKind: "person", authorId: btrim(actorId) || null };
}
```

Append to `packages/db/src/index.ts` (after the record block, `:263-268`):

```ts

// Who made a timeline row (S-03 part 1, 1b; migration 0073). See ./provenance.ts.
export { AUTHOR_KINDS, messageAuthor, bookingAuthor, type AuthorKind, type RowAuthor } from "./provenance";
```

- [ ] **Step 3: Write the failing schema test** `packages/db/src/test/record-provenance-schema.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import type { Client } from "pg";
import { withRollback, actAs } from "./db";

/**
 * Record provenance (spec §5, migration 0073). As the table owner inside a rolled-back transaction
 * unless a case switches role. A refused INSERT or a failed CHECK raises; one statement per savepoint.
 */
const RUN = Math.random().toString(36).slice(2, 10);
const ORG = `org_rp_${RUN}`;
const OWNER_SUB = `user_rp_owner_${RUN}`;
const STAFF_SUB = `user_rp_staff_${RUN}`;
const TECH_SUB = `user_rp_tech_${RUN}`;

async function attempt(c: Client, sql: string, args: unknown[] = []) {
  await c.query("savepoint attempt");
  try {
    const r = await c.query(sql, args);
    await c.query("release savepoint attempt");
    return r;
  } catch (e) {
    await c.query("rollback to savepoint attempt");
    throw e;
  }
}
async function insert(c: Client, table: string, row: Record<string, unknown>) {
  const keys = Object.keys(row);
  const r = await attempt(c,
    `insert into ${table} (${keys.join(", ")}) values (${keys.map((_, i) => `$${i + 1}`).join(", ")}) returning *`,
    Object.values(row));
  return r.rows[0] as Record<string, unknown> & { id: string };
}

async function seed(c: Client) {
  const one = async (sql: string, args: unknown[]) => (await c.query<{ id: string }>(sql, args)).rows[0]!.id;
  const { rows: [agency] } = await c.query<{ id: string }>("select id from agencies limit 1");
  const acct = await one(
    "insert into accounts (agency_id, clerk_org_id, name, client_access_enabled) values ($1,$2,'Prov Co',true) returning id",
    [agency!.id, ORG]);
  const user = (sub: string, name: string | null) =>
    one("insert into users (clerk_user_id, email, name) values ($1, $1 || '@example.com', $2) returning id", [sub, name]);
  const owner = await user(OWNER_SUB, "Dan López");
  const staff = await user(STAFF_SUB, null);
  const tech = await user(TECH_SUB, "Tec");
  await c.query("insert into memberships (user_id, scope, account_id, role) values ($1,'account',$4,'owner'), ($2,'account',$4,'staff'), ($3,'account',$4,'technician')",
    [owner, staff, tech, acct]);
  const ana = await one("insert into contacts (account_id, first_name, assigned_to) values ($1,'Ana',$2) returning id", [acct, tech]);
  const pipeline = await one("insert into pipelines (account_id, name) values ($1,'Sales') returning id", [acct]);
  const stage = await one("insert into pipeline_stages (account_id, pipeline_id, name, position) values ($1,$2,'New',0) returning id", [acct, pipeline]);
  const convo = await one("insert into conversations (account_id, contact_id) values ($1,$2) returning id", [acct, ana]);
  const cal = await one("insert into calendars (account_id, public_id) values ($1, $2) returning id", [acct, `cal_${RUN}`]);
  const form = await one("insert into forms (account_id, public_id, name) values ($1, $2, 'Quote request') returning id", [acct, `frm_${RUN}`]);
  return { acct, ana, pipeline, stage, convo, cal, form };
}

let slot = 0;
const booking = (s: Awaited<ReturnType<typeof seed>>, extra: Record<string, unknown> = {}) => {
  slot += 1;
  const start = new Date(Date.UTC(2027, 0, 1, 0, 0) + slot * 7_200_000);
  return { account_id: s.acct, calendar_id: s.cal, contact_id: s.ana, starts_at: start.toISOString(),
    ends_at: new Date(start.getTime() + 3_600_000).toISOString(), cancel_token: `tok_${RUN}_${slot}`, ...extra };
};
const message = (s: Awaited<ReturnType<typeof seed>>, direction: "inbound" | "outbound", extra: Record<string, unknown> = {}) =>
  ({ account_id: s.acct, conversation_id: s.convo, channel: "sms", direction, body: "x", ...extra });
const event = (c: Client, acct: string, type: string, actorType: string, actorId: string, payload: Record<string, string>) =>
  c.query("insert into events (account_id, type, actor_type, actor_id, payload) values ($1,$2,$3,$4,$5)",
    [acct, type, actorType, actorId, JSON.stringify(payload)]);

describe("0073: who stamps tasks and deals (spec §5.2)", () => {
  it("a signed-in To-do and deal store the caller's sub, whatever was sent (mutation: drop trigger tasks_stamp_created_by -> FAILS; drop opportunities_stamp_created_by -> FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      await actAs(c, { org_id: ORG, sub: OWNER_SUB });
      const t = await insert(c, "tasks", { account_id: s.acct, contact_id: s.ana, title: "Order shingles", created_by: STAFF_SUB });
      expect(t.created_by).toBe(OWNER_SUB);
      const o = await insert(c, "opportunities", { account_id: s.acct, contact_id: s.ana, pipeline_id: s.pipeline, stage_id: s.stage, name: "Deck build", created_by: STAFF_SUB });
      expect(o.created_by).toBe(OWNER_SUB);
    }));
  it("the service role stores NULL on insert (mutation: keep a service-sent created_by -> FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      await c.query("set local role service_role");
      expect((await insert(c, "tasks", { account_id: s.acct, contact_id: s.ana, title: "x", created_by: STAFF_SUB })).created_by).toBeNull();
    }));
  it("a signed-in UPDATE cannot rewrite a To-do's author; the service role can correct it (mutation: drop trigger tasks_keep_created_by -> FAILS; hold every role -> the service case FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      await actAs(c, { org_id: ORG, sub: OWNER_SUB });
      const t = await insert(c, "tasks", { account_id: s.acct, contact_id: s.ana, title: "x" });
      const u = await attempt(c, "update tasks set created_by = $1, title = 'y' where id = $2 returning created_by, title", [STAFF_SUB, t.id]);
      expect(u.rows[0]).toEqual({ created_by: OWNER_SUB, title: "y" });
      await c.query("reset role");
      await c.query("set local role service_role");
      const v = await attempt(c, "update tasks set created_by = $1 where id = $2 returning created_by", [STAFF_SUB, t.id]);
      expect(v.rows[0]!.created_by).toBe(STAFF_SUB);
    }));
});

describe("0073: a note's author is the signed-in caller (spec §5.2)", () => {
  it("a forged author_id is replaced by the caller's sub on insert, and an update cannot change it (mutation: drop trigger notes_author_guard -> the forged id persists, FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      await actAs(c, { org_id: ORG, sub: STAFF_SUB });
      const n = await insert(c, "notes", { account_id: s.acct, contact_id: s.ana, body: "Gate code 4411", author_id: OWNER_SUB });
      expect(n.author_id).toBe(STAFF_SUB);
      const u = await attempt(c, "update notes set author_id = $1, body = 'Gate code 4412' where id = $2 returning author_id, body", [OWNER_SUB, n.id]);
      expect(u.rows[0]).toEqual({ author_id: STAFF_SUB, body: "Gate code 4412" });
    }));
  it("the service role's value is kept (no service path writes notes today; spec §5.2)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      await c.query("set local role service_role");
      expect((await insert(c, "notes", { account_id: s.acct, contact_id: s.ana, body: "x", author_id: OWNER_SUB })).author_id).toBe(OWNER_SUB);
    }));
});

describe("0073: the closed set (spec §5.1, C2)", () => {
  it("author_kind outside the five is refused on messages, bookings and submissions (mutation: drop messages_author_kind_check -> FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      await expect(insert(c, "messages", message(s, "outbound", { author_kind: "robot" })))
        .rejects.toMatchObject({ code: "23514", constraint: "messages_author_kind_check" });
      await expect(insert(c, "bookings", booking(s, { author_kind: "robot" })))
        .rejects.toMatchObject({ code: "23514", constraint: "bookings_author_kind_check" });
      await expect(insert(c, "form_submissions", { account_id: s.acct, form_id: s.form, author_kind: "automation" }))
        .rejects.toMatchObject({ code: "23514", constraint: "form_submissions_author_kind_check" });
    }));
  it("an author_id only goes with a person, and an id with NO kind is refused too (mutation: write the check as `author_id is null or author_kind = 'person'` -> the NULL-kind row passes, FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      for (const kind of ["ai", null]) {
        await expect(insert(c, "messages", message(s, "outbound", { author_kind: kind, author_id: OWNER_SUB })), String(kind))
          .rejects.toMatchObject({ code: "23514", constraint: "messages_author_id_person" });
        await expect(insert(c, "bookings", booking(s, { author_kind: kind, author_id: OWNER_SUB })), String(kind))
          .rejects.toMatchObject({ code: "23514", constraint: "bookings_author_id_person" });
      }
      expect((await insert(c, "messages", message(s, "outbound", { author_kind: "person", author_id: OWNER_SUB }))).author_id).toBe(OWNER_SUB);
    }));
  it("a submission is the customer's unless said otherwise (mutation: drop the default -> NULL, FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      expect((await insert(c, "form_submissions", { account_id: s.acct, form_id: s.form })).author_kind).toBe("customer");
    }));
  it("messages and bookings still accept a row with no author (the build before 1b; 0074 closes it)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      expect((await insert(c, "messages", message(s, "inbound"))).author_kind).toBeNull();
      expect((await insert(c, "bookings", booking(s))).author_kind).toBeNull();
    }));
});

describe("0073: the record's per-customer indexes (spec §5.1)", () => {
  it("bookings, tasks and calls are indexed on (account_id, contact_id) (mutation: drop index calls_account_contact -> FAILS)", () =>
    withRollback(async (c) => {
      const { rows } = await c.query<{ indexname: string; indexdef: string }>(
        "select indexname, indexdef from pg_indexes where schemaname='public' and indexname = any($1) order by 1",
        [["bookings_account_contact", "calls_account_contact", "tasks_account_contact"]]);
      expect(rows.map((r) => [r.indexname, r.indexdef.replace(/^.* USING btree /, "")])).toEqual([
        ["bookings_account_contact", "(account_id, contact_id)"],
        ["calls_account_contact", "(account_id, contact_id)"],
        ["tasks_account_contact", "(account_id, contact_id)"],
      ]);
    }));
});

describe("0073: the backfill, bucket by bucket (spec §5.3)", () => {
  it("each historical row takes the kind its evidence gives, and a second run changes nothing (mutation: map an outbound system event to customer in app.message_author -> FAILS; drop `m.author_kind is null` -> the second run is non-zero, FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      const msg = async (direction: "inbound" | "outbound", actor: [string, string] | null) => {
        const m = await insert(c, "messages", message(s, direction));
        if (actor) await event(c, s.acct, "message.created", actor[0], actor[1], { messageId: m.id });
        return m.id;
      };
      const m = {
        inNone: await msg("inbound", null), inAi: await msg("inbound", ["ai", "voice"]),
        outUser: await msg("outbound", ["user", ` ${OWNER_SUB} `]), outSystem: await msg("outbound", ["system", "automation"]),
        outAi: await msg("outbound", ["ai", "voice"]), outNone: await msg("outbound", null),
      };
      const bk = async (actor: [string, string] | null, ip: string | null) => {
        const b = await insert(c, "bookings", booking(s, { ip_hash: ip }));
        if (actor) await event(c, s.acct, "booking.created", actor[0], actor[1], { bookingId: b.id });
        return b.id;
      };
      const b = {
        system: await bk(["system", "public"], "h1"), ai: await bk(["ai", "voice"], null), user: await bk(["user", OWNER_SUB], null),
        noneIp: await bk(null, "h2"), none: await bk(null, null),
      };
      const task = await insert(c, "tasks", { account_id: s.acct, contact_id: s.ana, title: "x" });
      await event(c, s.acct, "task.created", "user", OWNER_SUB, { taskId: task.id });
      const taskNoEvent = await insert(c, "tasks", { account_id: s.acct, contact_id: s.ana, title: "y" });
      const deal = await insert(c, "opportunities", { account_id: s.acct, contact_id: s.ana, pipeline_id: s.pipeline, stage_id: s.stage, name: "Deck" });
      await event(c, s.acct, "opportunity.created", "user", OWNER_SUB, { opportunityId: deal.id });
      const chat = await insert(c, "form_submissions", { account_id: s.acct, form_id: s.form });
      const typed = await insert(c, "form_submissions", { account_id: s.acct, form_id: s.form });
      await c.query("insert into concierge_conversations (account_id, form_id, ip_hash, submission_id) values ($1,$2,'h3',$3)", [s.acct, s.form, chat.id]);

      const first = await c.query<{ bucket: string; row_count: string }>("select * from app.backfill_record_provenance()");
      expect(first.rows.length).toBeGreaterThan(0);

      const kinds = async (table: string, ids: Record<string, string>) => {
        const { rows } = await c.query<{ id: string; author_kind: string; author_id: string | null }>(
          `select id, author_kind, author_id from ${table} where id = any($1)`, [Object.values(ids)]);
        return Object.fromEntries(Object.entries(ids).map(([k, id]) => {
          const r = rows.find((x) => x.id === id)!;
          return [k, [r.author_kind, r.author_id]];
        }));
      };
      expect(await kinds("messages", m)).toEqual({
        inNone: ["customer", null], inAi: ["ai", null], outUser: ["person", OWNER_SUB],
        outSystem: ["automation", null], outAi: ["ai", null], outNone: ["person", null],
      });
      expect(await kinds("bookings", b)).toEqual({
        system: ["customer", null], ai: ["ai", null], user: ["person", OWNER_SUB], noneIp: ["customer", null], none: ["ai", null],
      });
      const one = async (sql: string, id: string) => (await c.query(sql, [id])).rows[0];
      expect(await one("select created_by from tasks where id = $1", task.id)).toEqual({ created_by: OWNER_SUB });
      expect(await one("select created_by from tasks where id = $1", taskNoEvent.id)).toEqual({ created_by: null });
      expect(await one("select created_by from opportunities where id = $1", deal.id)).toEqual({ created_by: OWNER_SUB });
      expect(await one("select author_kind from form_submissions where id = $1", chat.id)).toEqual({ author_kind: "ai" });
      expect(await one("select author_kind from form_submissions where id = $1", typed.id)).toEqual({ author_kind: "customer" });

      const again = await c.query<{ bucket: string; row_count: string }>("select * from app.backfill_record_provenance()");
      expect(again.rows.reduce((n, r) => n + Number(r.row_count), 0)).toBe(0);
    }));
});

describe("0073: grants on the new functions (spec §5.2)", () => {
  it("nobody but the owner runs the backfill or the two CASE helpers; the triggers' functions are closed to anon (mutation: grant execute on app.backfill_record_provenance() to authenticated -> FAILS)", () =>
    withRollback(async (c) => {
      const can = async (role: string, fn: string) =>
        (await c.query<{ ok: boolean }>("select has_function_privilege($1, $2, 'execute') as ok", [role, fn])).rows[0]!.ok;
      for (const role of ["anon", "authenticated", "service_role"]) {
        expect(await can(role, "app.backfill_record_provenance()"), role).toBe(false);
        expect(await can(role, "app.message_author(text, text)"), role).toBe(false);
        expect(await can(role, "app.booking_author(text, boolean)"), role).toBe(false);
      }
      expect(await can("anon", "app.keep_created_by()")).toBe(false);
      expect(await can("anon", "app.notes_author_guard()")).toBe(false);
      expect(await can("authenticated", "app.notes_author_guard()")).toBe(true);
    }));
});

describe("names on person marks (spec §4, §6)", () => {
  it("a Technician reads the team's users rows, so a note's author can be named on their page (mutation: drop policy users_member_read -> FAILS)", () =>
    withRollback(async (c) => {
      await seed(c);
      await actAs(c, { org_id: ORG, sub: TECH_SUB });
      const { rows } = await c.query<{ name: string | null }>("select name from users where clerk_user_id = $1", [OWNER_SUB]);
      expect(rows).toEqual([{ name: "Dan López" }]);
    }));
});
```

- [ ] **Step 4: Write the failing parity test** `packages/db/src/test/provenance-parity.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { withRollback } from "./db";
import { messageAuthor, bookingAuthor, AUTHOR_KINDS } from "../provenance";
import type { ActorType } from "../events";

/**
 * The backfill's CASE (app.message_author / app.booking_author, 0073) and the TypeScript the app
 * writes with (provenance.ts) give the same kind for every actor the app passes (spec §12.2; the
 * dedupe-keys parity pattern, 0033/0034). A NULL actor (no event) exists only in SQL and is pinned
 * by the backfill test in record-provenance-schema.test.ts.
 */
const ACTORS: ActorType[] = ["user", "system", "ai"];

describe("provenance parity: SQL and TypeScript agree (spec §5.2, §12.2)", () => {
  it("messages: every actor type x direction (mutation: map system->customer in messageAuthor -> FAILS; map inbound ai->customer in app.message_author -> FAILS)", () =>
    withRollback(async (c) => {
      for (const actor of ACTORS) {
        for (const direction of ["inbound", "outbound"] as const) {
          const { rows: [r] } = await c.query<{ k: string }>("select app.message_author($1, $2) as k", [actor, direction]);
          expect(r!.k, `${actor} ${direction}`).toBe(messageAuthor(actor, "x", direction).authorKind);
        }
      }
    }));
  it("bookings: every actor type, with and without an ip hash (an event always outranks the ip) (mutation: map system->automation in app.booking_author -> FAILS)", () =>
    withRollback(async (c) => {
      for (const actor of ACTORS) {
        for (const hasIp of [true, false]) {
          const { rows: [r] } = await c.query<{ k: string }>("select app.booking_author($1, $2) as k", [actor, hasIp]);
          expect(r!.k, `${actor} ip=${hasIp}`).toBe(bookingAuthor(actor, "x").authorKind);
        }
      }
    }));
  it("every kind either side produces is one of the five (mutation: return 'system' from messageAuthor -> FAILS by type and here)", () => {
    for (const actor of ACTORS) {
      for (const d of ["inbound", "outbound"] as const) expect(AUTHOR_KINDS).toContain(messageAuthor(actor, "x", d).authorKind);
      expect(AUTHOR_KINDS).toContain(bookingAuthor(actor, "x").authorKind);
    }
  });
  it("a person's id is trimmed of spaces, as btrim does, and an empty one is null (mutation: keep the padding -> FAILS)", () => {
    expect(messageAuthor("user", "  user_1  ", "outbound")).toEqual({ authorKind: "person", authorId: "user_1" });
    expect(bookingAuthor("user", "   ")).toEqual({ authorKind: "person", authorId: null });
    expect(messageAuthor("system", "automation", "outbound")).toEqual({ authorKind: "automation", authorId: null });
  });
});
```

- [ ] **Step 5: Run both, red on `pre`.**

```bash
cd <WT>/packages/db && NEXT_PUBLIC_SUPABASE_URL= SUPABASE_SERVICE_ROLE_KEY= SUPABASE_DB_URL=postgresql://postgres@localhost:55500/pre pnpm exec vitest run src/test/record-provenance-schema.test.ts src/test/provenance-parity.test.ts
```

Expected: the schema cases fail (for example `column "created_by" of relation "tasks" does not exist`, `function app.backfill_record_provenance() does not exist`), the two SQL parity cases fail with `function app.message_author(unknown, unknown) does not exist`, and the two pure parity cases pass. Paste one failing line per describe.

- [ ] **Step 6: Write the migration** `packages/db/supabase/migrations/0073_record_provenance.sql`:

```sql
-- 0073_record_provenance.sql - who made each row on a customer's timeline (S-03 part 1, PR 1b)
-- (docs/superpowers/specs/2026-10-12-record-page-design.md section 5)
--
-- DESIGN.md, Provenance: every timeline row states who did it, from one closed set: a person, the AI
-- receptionist, an automation, the customer, an import. Rows a signed-in person writes directly
-- (notes, tasks, opportunities: client-writable under 0053) get their author stamped by the database
-- from the JWT sub, 0071's convention. Rows only server code writes (messages, bookings,
-- form_submissions: server-only since 0053) get an explicit author_kind from that code
-- (packages/db/src/provenance.ts). calls need nothing: every calls row is a call the receptionist
-- took (0059 and 0039 keep forwarded and refused calls out of it).
--
--   1. Columns and CHECKs. messages.author_kind and bookings.author_kind start NULLABLE: the build
--      before 1b inserts without them. The follow-up (0074) re-runs the backfill and sets NOT NULL.
--      author_id goes only with a person; the CHECK coalesces, so an id with no kind is refused too.
--   2. The mapping as SQL: app.message_author and app.booking_author, the twins of provenance.ts
--      (provenance-parity.test.ts). A NULL actor means the row's event is missing.
--   3. Triggers, plain (not definer), so current_user is the caller (0068 section 5's shape). Only
--      the client role is held: the service role and the owner may still correct a value.
--   4. Indexes for the record's per-customer reads.
--   5. The backfill, as a function this file runs once and 0074 runs again.
--
-- APPLY ORDER: after 0072 on each project. CI project (ci-project-setup.yml: push-dry-run, then
-- push), then production (MCP apply_migration), then the parity check, then merge 1b. Safe under the
-- running build: the triggers only fill columns it never sends, and the nullable columns accept its
-- inserts. The app that writes author_kind (1b) must never run before this file: a missing column
-- fails every send.
--
-- ROLLBACK (revert the app first; the columns are harmless to the 1a build). Dropping the columns
-- drops recorded authors, so only on an owner decision:
--   drop trigger tasks_stamp_created_by on public.tasks;
--   drop trigger tasks_keep_created_by on public.tasks;
--   drop trigger opportunities_stamp_created_by on public.opportunities;
--   drop trigger notes_author_guard on public.notes;
--   drop function app.keep_created_by(), app.notes_author_guard(), app.backfill_record_provenance(),
--     app.message_author(text, text), app.booking_author(text, boolean);
--   drop index public.bookings_account_contact, public.tasks_account_contact, public.calls_account_contact;
--   alter table public.tasks drop column created_by;
--   alter table public.opportunities drop column created_by;
--   alter table public.messages drop column author_kind, drop column author_id;
--   alter table public.bookings drop column author_kind, drop column author_id;
--   alter table public.form_submissions drop column author_kind;
--
-- ASCII only, no backslash anywhere.

set local lock_timeout = '5s';

-- 1. Columns.
alter table public.tasks add column created_by text;
alter table public.opportunities add column created_by text;

alter table public.messages
  add column author_kind text,
  add column author_id text,
  add constraint messages_author_kind_check
    check (author_kind in ('person', 'ai', 'automation', 'customer', 'import')),
  add constraint messages_author_id_person
    check (author_id is null or coalesce(author_kind = 'person', false));

alter table public.bookings
  add column author_kind text,
  add column author_id text,
  add constraint bookings_author_kind_check
    check (author_kind in ('person', 'ai', 'automation', 'customer', 'import')),
  add constraint bookings_author_id_person
    check (author_id is null or coalesce(author_kind = 'person', false));

alter table public.form_submissions
  add column author_kind text not null default 'customer',
  add constraint form_submissions_author_kind_check check (author_kind in ('customer', 'ai'));

-- 2. The mapping, as SQL. p_actor_type NULL = no event (an emit that failed after its insert).
create function app.message_author(p_actor_type text, p_direction text) returns text
language sql immutable parallel safe set search_path = '' as $$
  select case
    when p_actor_type = 'ai' then 'ai'
    when p_direction = 'inbound' then 'customer'
    when p_actor_type = 'user' then 'person'
    when p_actor_type is null then 'person'
    else 'automation'
  end
$$;

create function app.booking_author(p_actor_type text, p_has_ip boolean) returns text
language sql immutable parallel safe set search_path = '' as $$
  select case
    when p_actor_type = 'ai' then 'ai'
    when p_actor_type = 'system' then 'customer'
    when p_actor_type = 'user' then 'person'
    when coalesce(p_has_ip, false) then 'customer'
    else 'ai'
  end
$$;

-- 3. Triggers. tasks and opportunities reuse 0071's stamp unchanged (a signed-in insert stores its
--    sub, a client value is discarded, the service role stores NULL).
create trigger tasks_stamp_created_by before insert on public.tasks
  for each row execute function app.stamp_created_by();
create trigger opportunities_stamp_created_by before insert on public.opportunities
  for each row execute function app.stamp_created_by();

-- tasks holds a table-wide UPDATE grant for the client role (schema-grants-guard.test.ts), so a
-- signed-in UPDATE could rewrite created_by: put it back. opportunities needs none: its UPDATE grant
-- is a column list (0053 section 5) and created_by is not in it.
create function app.keep_created_by() returns trigger
language plpgsql set search_path = '' as $$
begin
  if current_user = 'authenticated' then
    new.created_by := old.created_by;
  end if;
  return new;
end $$;
create trigger tasks_keep_created_by before update on public.tasks
  for each row execute function app.keep_created_by();

-- notes is IUD for the client role too, and addNote sends author_id from the app. A signed-in insert
-- stores the caller's sub whatever was sent; a signed-in update keeps the stored author. The service
-- role's value is kept (no service path writes notes today).
create function app.notes_author_guard() returns trigger
language plpgsql set search_path = '' as $$
begin
  if current_user = 'authenticated' then
    if tg_op = 'INSERT' then
      new.author_id := nullif(btrim(app.jwt() ->> 'sub'), '');
    else
      new.author_id := old.author_id;
    end if;
  end if;
  return new;
end $$;
create trigger notes_author_guard before insert or update on public.notes
  for each row execute function app.notes_author_guard();

-- 4. Indexes for the record's per-customer reads (notes, messages, opportunities and submissions
--    already have one: 0003, 0005, 0006).
create index bookings_account_contact on public.bookings (account_id, contact_id);
create index tasks_account_contact on public.tasks (account_id, contact_id);
create index calls_account_contact on public.calls (account_id, contact_id);

-- 5. The backfill. Idempotent: it touches only rows still unset, so 0074 runs it again for rows the
--    previous build wrote between this file and 1b's deploy. Returns how many rows each bucket took.
create function app.backfill_record_provenance() returns table (bucket text, row_count bigint)
language plpgsql set search_path = '' as $$
#variable_conflict use_column
begin
  return query
  with ev as (
    select distinct on (e.payload ->> 'messageId')
           e.payload ->> 'messageId' as row_id, e.account_id, e.actor_type, e.actor_id
      from public.events e
     where e.type = 'message.created' and e.payload ->> 'messageId' is not null
     order by e.payload ->> 'messageId', e.id
  ), done as (
    update public.messages m
       set author_kind = app.message_author(ev.actor_type, src.direction),
           author_id = case when app.message_author(ev.actor_type, src.direction) = 'person'
                             and ev.actor_type = 'user'
                            then nullif(btrim(ev.actor_id), '') end
      from public.messages src
      left join ev on ev.row_id = src.id::text and ev.account_id = src.account_id
     where m.id = src.id and m.author_kind is null
    returning src.direction, m.author_kind, ev.actor_type is null as no_event
  )
  select 'messages ' || d.direction || ' ' || d.author_kind
         || case when d.no_event then ' (no event)' else '' end, count(*)
    from done d group by 1;

  return query
  with ev as (
    select distinct on (e.payload ->> 'bookingId')
           e.payload ->> 'bookingId' as row_id, e.account_id, e.actor_type, e.actor_id
      from public.events e
     where e.type = 'booking.created' and e.payload ->> 'bookingId' is not null
     order by e.payload ->> 'bookingId', e.id
  ), done as (
    update public.bookings b
       set author_kind = app.booking_author(ev.actor_type, src.ip_hash is not null),
           author_id = case when ev.actor_type = 'user' then nullif(btrim(ev.actor_id), '') end
      from public.bookings src
      left join ev on ev.row_id = src.id::text and ev.account_id = src.account_id
     where b.id = src.id and b.author_kind is null
    returning b.author_kind, ev.actor_type is null as no_event
  )
  select 'bookings ' || d.author_kind || case when d.no_event then ' (no event)' else '' end, count(*)
    from done d group by 1;

  return query
  with ev as (
    select distinct on (e.payload ->> 'taskId')
           e.payload ->> 'taskId' as row_id, e.account_id, nullif(btrim(e.actor_id), '') as actor_id
      from public.events e
     where e.type = 'task.created' and e.actor_type = 'user' and e.payload ->> 'taskId' is not null
     order by e.payload ->> 'taskId', e.id
  ), done as (
    update public.tasks t set created_by = ev.actor_id
      from ev
     where ev.row_id = t.id::text and ev.account_id = t.account_id and ev.actor_id is not null
       and t.created_by is null and t.call_id is null and t.consent_event_id is null
    returning t.id
  )
  select 'tasks person (from task.created)'::text, count(*) from done;

  return query
  with ev as (
    select distinct on (e.payload ->> 'opportunityId')
           e.payload ->> 'opportunityId' as row_id, e.account_id, nullif(btrim(e.actor_id), '') as actor_id
      from public.events e
     where e.type = 'opportunity.created' and e.actor_type = 'user' and e.payload ->> 'opportunityId' is not null
     order by e.payload ->> 'opportunityId', e.id
  ), done as (
    update public.opportunities o set created_by = ev.actor_id
      from ev
     where ev.row_id = o.id::text and ev.account_id = o.account_id and ev.actor_id is not null
       and o.created_by is null
    returning o.id
  )
  select 'opportunities person (from opportunity.created)'::text, count(*) from done;

  return query
  with done as (
    update public.form_submissions s set author_kind = 'ai'
     where s.author_kind <> 'ai'
       and s.id in (select c.submission_id from public.concierge_conversations c where c.submission_id is not null)
    returning s.id
  )
  select 'form_submissions ai (website chat)'::text, count(*) from done;
end $$;

revoke all on function app.message_author(text, text) from public, anon, authenticated, service_role;
revoke all on function app.booking_author(text, boolean) from public, anon, authenticated, service_role;
revoke all on function app.backfill_record_provenance() from public, anon, authenticated, service_role;
revoke all on function app.keep_created_by() from public, anon;
revoke all on function app.notes_author_guard() from public, anon;
grant execute on function app.keep_created_by() to authenticated, service_role;
grant execute on function app.notes_author_guard() to authenticated, service_role;

-- The first run. Its NOTICEs are the bucket counts the rollout reads (spec section 13 step 1 measured
-- them before apply; these should match).
do $$
declare r record;
begin
  for r in select * from app.backfill_record_provenance() loop
    raise notice 'record provenance backfill: % = %', r.bucket, r.row_count;
  end loop;
end $$;
```

- [ ] **Step 7: Check the file is ASCII with no backslash** (a node byte scan, with a positive control; Git Bash `grep -P` cannot run here):

```bash
cd <WT> && node -e "const fs=require('fs');const scan=(p)=>{const b=fs.readFileSync(p);let bad=0;for(const x of b){if(x>127||x===92)bad++;}return bad;};fs.writeFileSync('<SCRATCH>/ctl.sql','select 1; -- caf\u00e9 \\\\');console.log('control', scan('<SCRATCH>/ctl.sql'));console.log('0073', scan('packages/db/supabase/migrations/0073_record_provenance.sql'));"
```

Expected: `control 3` (the é's two bytes and one backslash), then `0073 0`.

- [ ] **Step 8: Apply to `post` and run green.**

```bash
source "<SCRATCH>/env.sh"
P -c "create database post template pre"
P -d post -c "alter database post set timezone to 'UTC'"
P -d post -1 -f packages/db/supabase/migrations/0073_record_provenance.sql
cd <WT>/packages/db && NEXT_PUBLIC_SUPABASE_URL= SUPABASE_SERVICE_ROLE_KEY= SUPABASE_DB_URL=postgresql://postgres@localhost:55500/post pnpm exec vitest run src/test/record-provenance-schema.test.ts src/test/provenance-parity.test.ts src/test/schema-grants-guard.test.ts src/test/technician-scope.test.ts src/test/places-schema.test.ts
```

Expected: the apply prints the `record provenance backfill: …` NOTICEs (on an empty replica, only the four `count(*)` buckets at 0). Vitest: every test passes. `schema-grants-guard.test.ts` passes **unchanged**: 0073 grants no table privilege, so `EXPECTED_WRITES` does not move (spec §5.2). Paste the summary line.

- [ ] **Step 9: Mutation probes, each on `post`, each FAILING the named test, then reset.** Reset after each probe: `P -c "drop database post" && P -c "create database post template pre" && P -d post -c "alter database post set timezone to 'UTC'" && P -d post -1 -f packages/db/supabase/migrations/0073_record_provenance.sql`. Run only the file the probe targets, and check the failing test is the one named.
  1. `drop trigger tasks_stamp_created_by on public.tasks` → "a signed-in To-do and deal store the caller's sub…" FAILS.
  2. `drop trigger tasks_keep_created_by on public.tasks` → "a signed-in UPDATE cannot rewrite…" FAILS.
  3. `drop trigger notes_author_guard on public.notes` → "a forged author_id is replaced…" FAILS.
  4. `alter table public.messages drop constraint messages_author_id_person, add constraint messages_author_id_person check (author_id is null or author_kind = 'person')` → "an author_id only goes with a person…" FAILS.
  5. `drop index public.calls_account_contact` → the index test FAILS.
  6. `create or replace function app.message_author(p_actor_type text, p_direction text) returns text language sql immutable set search_path = '' as $$ select case when p_actor_type = 'ai' then 'ai' when p_direction = 'inbound' then 'customer' when p_actor_type = 'user' then 'person' when p_actor_type is null then 'person' else 'customer' end $$` → the backfill test AND parity "messages" FAIL.
  7. `grant execute on function app.backfill_record_provenance() to authenticated` → the grants test FAILS.
  8. In `provenance.ts`, change `bookingAuthor`'s `system` branch to `"automation"` (TS only) → parity "bookings" FAILS. Revert.

- [ ] **Step 10: Commit.**

```bash
cd <WT>
git add -- packages/db/supabase/migrations/0073_record_provenance.sql packages/db/src/provenance.ts packages/db/src/test/record-provenance-schema.test.ts packages/db/src/test/provenance-parity.test.ts
git commit -m "feat(db): 0073 records who made every timeline row, with a backfill from the event log (S-03 1b)" -- packages/db/supabase/migrations/0073_record_provenance.sql packages/db/src/provenance.ts packages/db/src/test/record-provenance-schema.test.ts packages/db/src/test/provenance-parity.test.ts packages/db/src/index.ts
```

Then stop the replica: `"$PGBIN/pg_ctl" -D "$S/pgdata" stop`.

---
## Task 2: The timeline cursor, and the four bis-crm sources paged (bis-crm)

**Review:** sonnet. **Runs:** group A, beside Tasks 1 and 8. Does NOT touch `index.ts`.

**Files**
- Create: `packages/db/src/timeline-cursor.ts`
- Create: `packages/db/src/test/timeline-cursor.test.ts` (pure)
- Create: `packages/db/src/test/timeline-sources.test.ts` (live, CI)
- Modify: `packages/db/src/activities.ts:17-24` (`listNotes`), `:41-53` (`listContactTasks`)
- Modify: `packages/db/src/opportunities.ts:155-164` (`listContactOpportunities`)
- Modify: `packages/db/src/forms.ts:195-203` (`SubmissionInput`), `:222-234` (`submissionRow`), `:514-525` (`listContactSubmissions`)

**Interfaces**
- Consumes: the columns 0073 adds (`tasks.created_by`, `opportunities.created_by`, `form_submissions.author_kind`). These are read only in page mode, which no code calls before Task 7, and 0073 is applied before 1b deploys.
- Produces (`packages/db/src/timeline-cursor.ts`):
  ```ts
  export type TimelineCursor = { v: string; id: string };
  export type TimelinePageOpts = { before?: TimelineCursor; limit: number };
  export const TIMELINE_PAGE_SIZE = 30;
  export function isTimelineInstant(v: string): boolean;
  export function instantKey(at: string): string;            // microsecond-exact, string-comparable
  export function timelineBeforeFilter(column: string, before: TimelineCursor): string;
  export function withTimelinePage<T>(q: T, column: string, page: TimelinePageOpts): T;
  ```
- Produces (additive optional last parameter; with no argument each function behaves exactly as today):
  `listNotes(db, accountId, contactId, page?: TimelinePageOpts)`;
  `listContactTasks(db, accountId, contactId, page?)` → rows gain `created_by?: string | null` in page mode;
  `listContactOpportunities(db, accountId, contactId, page?)` → `created_by` in page mode;
  `listContactSubmissions(db, accountId, contactId, page?)` → `(SubmissionRow & { formName: string; author_kind?: "customer" | "ai" })[]`;
  `SubmissionInput.authorKind?: "customer" | "ai"` (written as `author_kind` only when given; the column default is `customer`).

- [ ] **Step 1: Write the failing pure test** `packages/db/src/test/timeline-cursor.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  instantKey, isTimelineInstant, timelineBeforeFilter, withTimelinePage, TIMELINE_PAGE_SIZE,
} from "../timeline-cursor";

const ID = "0f8a7b2c-1d2e-4f3a-8b4c-5d6e7f8a9b0c";

describe("instantKey: one total order across seven tables, to the microsecond (spec C3)", () => {
  it("the same instant spelled three ways is one key (mutation: compare the raw strings -> FAILS)", () => {
    const k = instantKey("2026-10-09T16:12:00.120000+00:00");
    expect(instantKey("2026-10-09T16:12:00.12Z")).toBe(k);
    expect(instantKey("2026-10-09T11:12:00.12-05:00")).toBe(k);
  });
  it("orders by microseconds, which Date drops (mutation: key on Date.parse alone -> FAILS)", () => {
    expect(instantKey("2026-10-09T16:12:00.000002Z") > instantKey("2026-10-09T16:12:00.000001Z")).toBe(true);
    expect(instantKey("2026-10-09T16:12:00.000001Z") > instantKey("2026-10-09T16:12:00Z")).toBe(true);
    expect(instantKey("2026-10-10T00:00:00Z") > instantKey("2026-10-09T23:59:59.999999Z")).toBe(true);
  });
  it("refuses anything that is not a timestamp with a zone", () => {
    for (const bad of ["", "2026-10-09", "2026-10-09T16:12", "2026-10-09 16:12:00+00", "2026-10-09T16:12:00"]) {
      expect(() => instantKey(bad), bad).toThrow(TypeError);
      expect(isTimelineInstant(bad), bad).toBe(false);
    }
  });
});

describe("timelineBeforeFilter: strictly past (at, id), the contact list's row-value idiom", () => {
  it("is exactly `at < v OR (at = v AND id < id)`, quoted (mutation: drop the and(...) half -> FAILS)", () => {
    expect(timelineBeforeFilter("created_at", { v: "2026-10-09T16:12:00.123456+00:00", id: ID })).toBe(
      `created_at.lt."2026-10-09T16:12:00.123456+00:00",and(created_at.eq."2026-10-09T16:12:00.123456+00:00",id.lt.${ID})`);
  });
  it("throws on a cursor that is not a timestamp and a uuid: it never reaches a filter string (mutation: drop the check -> FAILS)", () => {
    expect(() => timelineBeforeFilter("created_at", { v: "x),or(id.gt.0", id: ID })).toThrow(TypeError);
    expect(() => timelineBeforeFilter("created_at", { v: "2026-10-09T16:12:00Z", id: "not-a-uuid" })).toThrow(TypeError);
  });
});

describe("withTimelinePage", () => {
  const recorder = () => {
    const calls: unknown[][] = [];
    const chain: Record<string, (...a: unknown[]) => unknown> = {};
    for (const k of ["order", "or", "limit"]) chain[k] = (...a: unknown[]) => { calls.push([k, ...a]); return chain; };
    return { chain, calls };
  };
  it("orders (at desc, id desc), filters past the cursor, and limits (mutation: drop the id order -> FAILS)", () => {
    const { chain, calls } = recorder();
    withTimelinePage(chain, "started_at", { before: { v: "2026-10-09T16:12:00Z", id: ID }, limit: 31 });
    expect(calls).toEqual([
      ["order", "started_at", { ascending: false }],
      ["order", "id", { ascending: false }],
      ["or", timelineBeforeFilter("started_at", { v: "2026-10-09T16:12:00Z", id: ID })],
      ["limit", 31],
    ]);
  });
  it("the head page has no filter", () => {
    const { chain, calls } = recorder();
    withTimelinePage(chain, "created_at", { limit: TIMELINE_PAGE_SIZE + 1 });
    expect(calls.map((c) => c[0])).toEqual(["order", "order", "limit"]);
    expect(TIMELINE_PAGE_SIZE).toBe(30);
  });
});
```

- [ ] **Step 2: Run it red.**

```bash
cd <WT>/packages/db && NEXT_PUBLIC_SUPABASE_URL= SUPABASE_SERVICE_ROLE_KEY= SUPABASE_DB_URL=postgresql://postgres@localhost:1/none pnpm exec vitest run src/test/timeline-cursor.test.ts
```

Expected: FAIL, `Failed to resolve import "../timeline-cursor"`. The blank credentials make the global sweep skip; no test here connects.

- [ ] **Step 3: Write `packages/db/src/timeline-cursor.ts`:**

```ts
/**
 * Server paging for the record page's timeline (S-03 part 1, 1b; spec C3). Seven tables merge into
 * one list ordered (at desc, id desc); each source reads `limit` rows strictly past the cursor with
 * the contact list's row-value idiom (contacts.ts, listContacts), and record.ts merges them. `v` is
 * the last row's own timestamp exactly as PostgREST returned it, never reformatted.
 */
export type TimelineCursor = { v: string; id: string };
export type TimelinePageOpts = { before?: TimelineCursor; limit: number };
export const TIMELINE_PAGE_SIZE = 30;

// PostgREST serialises timestamptz as ISO 8601 with T and an offset, up to six fractional digits.
const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.(\d{1,6}))?(?:Z|[+-]\d{2}:\d{2})$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isTimelineInstant(v: string): boolean {
  return INSTANT.test(v) && !Number.isNaN(Date.parse(v));
}

/**
 * A string that sorts like the instant, to the microsecond. `Date` keeps milliseconds only, so two
 * rows 1 µs apart (or a cursor row and its neighbour) would tie; the fraction is read from the text
 * (booking.ts's `sameMicroInstant` reads it the same way).
 */
export function instantKey(at: string): string {
  const m = INSTANT.exec(at);
  const whole = m ? Date.parse(at.replace(/\.\d+/, "")) : Number.NaN;
  if (!m || Number.isNaN(whole)) throw new TypeError(`instantKey: not a timestamp: ${JSON.stringify(at)}`);
  return `${String(whole / 1000).padStart(12, "0")}.${(m[1] ?? "").padEnd(6, "0")}`;
}

/** `column < v OR (column = v AND id < id)`, for PostgREST's `.or()`. Validated, then quoted, so a
 *  hand-edited `?before=` can never reach the filter grammar (apps/web validates it first too). */
export function timelineBeforeFilter(column: string, before: TimelineCursor): string {
  if (!isTimelineInstant(before.v) || !UUID.test(before.id)) throw new TypeError("timeline cursor: malformed");
  const v = `"${before.v}"`;
  return `${column}.lt.${v},and(${column}.eq.${v},id.lt.${before.id.toLowerCase()})`;
}

type Chain = {
  order: (column: string, o: { ascending: boolean }) => Chain;
  or: (filter: string) => Chain;
  limit: (n: number) => Chain;
};

/** Applies the page to a PostgREST query: (column desc, id desc), past the cursor, at most `limit`. */
export function withTimelinePage<T>(q: T, column: string, page: TimelinePageOpts): T {
  let c = (q as unknown as Chain).order(column, { ascending: false }).order("id", { ascending: false });
  if (page.before) c = c.or(timelineBeforeFilter(column, page.before));
  return c.limit(page.limit) as unknown as T;
}
```

- [ ] **Step 4: Run it green.** Same command as Step 2. Expected: `Tests  7 passed (7)`. Run the probes named in each test title (drop the `and(...)` half; key on `Date.parse` alone; drop the `order("id")`; drop the validation), see each named test FAIL, revert.

- [ ] **Step 5: Write the failing live test** `packages/db/src/test/timeline-sources.test.ts` (CI proves it; locally it only typechecks):

```ts
import { describe, it, expect } from "vitest";
import "dotenv/config";
import { withTestAccount } from "./fixtures";
import { createContact } from "../contacts";
import { addNote, listNotes, addTask, listContactTasks } from "../activities";
import { ensureDefaultPipeline } from "../crm-config";
import { createOpportunity, listContactOpportunities } from "../opportunities";
import { createForm, createSubmission, linkSubmissionContact, listContactSubmissions } from "../forms";

const ACTOR = "user_test";

describe("the bis-crm timeline sources, paged (S-03 1b, spec §7, C3)", () => {
  it("notes page by (created_at desc, id desc); two notes at one instant split across pages are neither lost nor repeated (mutation: drop the and(...) half of the cursor filter -> the tied note is lost, FAILS)", () =>
    withTestAccount(async (db, accountId) => {
      const { id: ana } = await createContact(db, accountId, { firstName: "Ana" }, ACTOR);
      const ids: string[] = [];
      for (const body of ["one", "two", "three"]) ids.push((await addNote(db, accountId, ana, body, ACTOR)).id);
      const at = "2026-10-09T16:12:00.123456+00:00";
      await db.from("notes").update({ created_at: at }).in("id", [ids[1], ids[2]]);
      await db.from("notes").update({ created_at: "2026-10-01T00:00:00+00:00" }).eq("id", ids[0]);
      const first = (await listNotes(db, accountId, ana, { limit: 1 })) as { id: string; created_at: string }[];
      const second = (await listNotes(db, accountId, ana, { limit: 1, before: { v: first[0]!.created_at, id: first[0]!.id } })) as { id: string; created_at: string }[];
      const third = (await listNotes(db, accountId, ana, { limit: 5, before: { v: second[0]!.created_at, id: second[0]!.id } })) as { id: string }[];
      const tied = [ids[1]!, ids[2]!].sort().reverse();
      expect([first[0]!.id, second[0]!.id, ...third.map((n) => n.id)]).toEqual([...tied, ids[0]]);
      // No options: today's shape, every note.
      expect(((await listNotes(db, accountId, ana)) ?? []).length).toBe(3);
    }));

  it("To-dos and deals carry who made them in page mode (NULL for the service role, 0071 C8)", () =>
    withTestAccount(async (db, accountId) => {
      const { id: ana } = await createContact(db, accountId, { firstName: "Ana" }, ACTOR);
      await addTask(db, accountId, { contactId: ana, title: "Order shingles" }, ACTOR);
      const { pipelineId } = await ensureDefaultPipeline(db, accountId);
      await createOpportunity(db, accountId, { contactId: ana, pipelineId, name: "Deck build", value: 2400 }, ACTOR);
      const tasks = await listContactTasks(db, accountId, ana, { limit: 31 });
      expect(tasks[0]).toMatchObject({ title: "Order shingles", created_by: null });
      const deals = (await listContactOpportunities(db, accountId, ana, { limit: 31 })) as { name: string; created_by: string | null }[];
      expect(deals[0]).toMatchObject({ name: "Deck build", created_by: null });
    }));

  it("a submission says whose it is: the website chat's is the AI's, a typed form the customer's (mutation: drop author_kind from submissionRow -> the chat's reads customer, FAILS)", () =>
    withTestAccount(async (db, accountId) => {
      const { id: ana } = await createContact(db, accountId, { firstName: "Ana" }, ACTOR);
      const form = await createForm(db, accountId, { name: "Quote request" }, ACTOR);
      const chat = await createSubmission(db, accountId, form.id, { answers: [], authorKind: "ai" });
      const typed = await createSubmission(db, accountId, form.id, { answers: [] });
      await linkSubmissionContact(db, accountId, chat.id, ana);
      await linkSubmissionContact(db, accountId, typed.id, ana);
      const rows = await listContactSubmissions(db, accountId, ana, { limit: 31 });
      const kindOf = (id: string) => rows.find((r) => r.id === id)?.author_kind;
      expect([kindOf(chat.id), kindOf(typed.id)]).toEqual(["ai", "customer"]);
      expect(rows.every((r) => r.formName === "Quote request")).toBe(true);
    }));
});
```

- [ ] **Step 6: Typecheck red.** `pnpm --filter @bis/db typecheck`. Expected: errors such as `Expected 3 arguments, but got 4` on `listNotes(…, { limit: 1 })` and `Object literal may only specify known properties, and 'authorKind' does not exist in type 'SubmissionInput'`. Paste one.

- [ ] **Step 7: Implement the four sources.** In `packages/db/src/activities.ts`, add `import { withTimelinePage, type TimelinePageOpts } from "./timeline-cursor";` under the existing imports, then replace `listNotes` (`:17-24`) and `listContactTasks` (`:41-53`):

```ts
/** A customer's notes, newest first. `page` (the record timeline, S-03 1b) reads one page by
 *  (created_at desc, id desc) past its cursor; without it, every note, as the drawer reads them. */
export async function listNotes(db: SupabaseClient, accountId: string, contactId: string, page?: TimelinePageOpts) {
  const q = db.from("notes")
    .select("id, body, pinned, author_id, created_at")
    .eq("account_id", accountId).eq("contact_id", contactId);
  const { data, error } = await (page ? withTimelinePage(q, "created_at", page) : q.order("created_at", { ascending: false }));
  if (error) throw new Error(error.message);
  return data;
}
```

```ts
const TASK_COLS = "id, title, due_at, completed_at, created_at, consent_event_id, call_id, assigned_to";

export async function listContactTasks(
  db: SupabaseClient, accountId: string, contactId: string, page?: TimelinePageOpts,
) {
  // created_by (0073) only in page mode: the record timeline names who made a To-do.
  const q = db.from("tasks")
    .select(page ? `${TASK_COLS}, created_by` : TASK_COLS)
    .eq("account_id", accountId).eq("contact_id", contactId);
  const { data, error } = await (page ? withTimelinePage(q, "created_at", page) : q.order("created_at", { ascending: false }));
  if (error) throw new Error(error.message);
  return (data ?? []) as {
    id: string; title: string; due_at: string | null; completed_at: string | null;
    created_at: string; consent_event_id: string | null; call_id: string | null;
    /** F-085 part 1: who holds the task (the record page's task picker). */
    assigned_to: string | null;
    /** 0073: the author's Clerk subject; present in page mode only. */
    created_by?: string | null;
  }[];
}
```

In `packages/db/src/opportunities.ts`, add the same import and replace `listContactOpportunities` (`:155-164`):

```ts
export async function listContactOpportunities(
  db: SupabaseClient, accountId: string, contactId: string, page?: TimelinePageOpts,
) {
  const cols = "id, name, status, monetary_value, created_at";
  const q = db.from("opportunities")
    .select(page ? `${cols}, created_by` : cols)
    .eq("account_id", accountId).eq("contact_id", contactId);
  const { data, error } = await (page ? withTimelinePage(q, "created_at", page) : q.order("created_at", { ascending: false }));
  if (error) throw new Error(error.message);
  return data;
}
```

In `packages/db/src/forms.ts`, add `import { withTimelinePage, type TimelinePageOpts } from "./timeline-cursor";`; add to `SubmissionInput` (after `answersHash?: string;`, `:202`):

```ts
  /** Who filled it (0073): omitted = the customer (the column's default); "ai" = the website chat
   *  took it (lib/concierge/lead.ts). */
  authorKind?: "customer" | "ai";
```

In `submissionRow`, add as the last property of the returned object (after `answers_hash`, `:232`):

```ts
    ...(input.authorKind ? { author_kind: input.authorKind } : {}),
```

Replace `listContactSubmissions` (`:514-525`):

```ts
export async function listContactSubmissions(
  db: SupabaseClient, accountId: string, contactId: string, page?: TimelinePageOpts,
): Promise<(SubmissionRow & { formName: string; author_kind?: "customer" | "ai" })[]> {
  const q = db.from("form_submissions")
    .select(`${SUBMISSION_COLS}, forms(name)${page ? ", author_kind" : ""}`)
    .eq("account_id", accountId).eq("contact_id", contactId);
  const { data, error } = await (page ? withTimelinePage(q, "created_at", page) : q.order("created_at", { ascending: false }));
  if (error) throw new Error(error.message);
  return ((data ?? []) as any[]).map((r) => ({
    ...(r as SubmissionRow & { author_kind?: "customer" | "ai" }), formName: r.forms?.name ?? "",
  }));
}
```

- [ ] **Step 8: Green locally where it can be.** `pnpm --filter @bis/db typecheck` → no errors. Re-run Step 4's pure command → still `7 passed`. Then confirm the web callers of these four functions still typecheck: `pnpm --filter web typecheck` → no errors (each new parameter is optional). The live test's red→green is proven by CI `verify` after the orchestrator pushes (Task 12 step 2, or earlier if the orchestrator pushes the branch for an early verify). Its named probe: in `timelineBeforeFilter` drop `,and(…)` → "notes page by…" FAILS.

- [ ] **Step 9: Commit.**

```bash
git add -- packages/db/src/timeline-cursor.ts packages/db/src/test/timeline-cursor.test.ts packages/db/src/test/timeline-sources.test.ts
git commit -m "feat(contacts): the record timeline's server cursor, and notes, To-dos, deals and submissions paged by it (S-03 1b)" -- packages/db/src/timeline-cursor.ts packages/db/src/test/timeline-cursor.test.ts packages/db/src/test/timeline-sources.test.ts packages/db/src/activities.ts packages/db/src/opportunities.ts packages/db/src/forms.ts
```

---

## Task 3: Messages name their author; the composer speaks the page's language (bis-comms)

**Review:** sonnet. **Runs:** group B, after Tasks 1 and 2. **messages.ts #2:** its Step 9 waits for Task 8's commit.

**Files**
- Modify: `packages/db/src/messaging.ts` (imports `:1-5`; `createMessage` `:129-145`; `listContactMessages` `:735-743`)
- Create: `packages/db/src/test/messaging-author.test.ts` (live, CI)
- Modify: `…/contacts/[contactId]/message-composer.tsx` and `message-composer.test.ts`
- Modify: `apps/web/src/lib/consent/composer-state.ts` (`composerStateLine` `:43-59`, `composerEmailNotice` `:80-91`) and `composer-state.test.ts`
- Modify: `apps/web/src/lib/email/failure-reason.ts` (`messageFailureReason` `:55-67`) and `failure-reason.test.ts`
- Modify: `apps/web/src/lib/messages.ts` (twins only)

**Interfaces**
- Consumes: `messageAuthor` (Task 1, `./provenance`); `withTimelinePage`, `TimelinePageOpts` (Task 2, `./timeline-cursor`).
- Produces:
  `createMessage` writes `author_kind`/`author_id` from `messageAuthor(actorType, actorId, input.direction)` (signature unchanged).
  `listContactMessages(db, accountId, contactId, page?: TimelinePageOpts & { channels?: readonly NewMessage["channel"][] })`: in page mode, rows carry `author_kind`, `author_id`, ordered `(created_at desc, id desc)`, only `channels` if given; with no `page`, today's oldest-first full thread.
  `composerStateLine(state, zone, locale: Locale = "en")`, `composerEmailNotice(state, zone, locale: Locale = "en")`, `messageFailureReason(message, locale: Locale = "en")`, `smsFormBlock(gate, contactHasPhone, blockedLine, locale: Locale = "en")`. Every existing caller is unchanged.

- [ ] **Step 1: Failing live test** `packages/db/src/test/messaging-author.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import "dotenv/config";
import { withTestAccount } from "./fixtures";
import { createContact } from "../contacts";
import { ensureConversation, createMessage, listContactMessages } from "../messaging";

describe("createMessage names its author (S-03 1b, spec §5.2)", () => {
  it("a person, an automation, the receptionist, the customer (mutation: write author_kind 'person' always -> FAILS)", () =>
    withTestAccount(async (db, accountId) => {
      const { id: ana } = await createContact(db, accountId, { firstName: "Ana" }, "user_test");
      const { id: conv } = await ensureConversation(db, accountId, ana, "user_test");
      const send = (direction: "inbound" | "outbound", actorId: string, actorType: "user" | "system" | "ai") =>
        createMessage(db, accountId, { conversationId: conv, channel: "sms", direction, body: "x" }, actorId, actorType);
      const ids = {
        staff: (await send("outbound", "user_dan", "user")).id,
        recipe: (await send("outbound", "automation", "system")).id,
        textback: (await send("outbound", "voice", "ai")).id,
        inbound: (await send("inbound", "sms-inbound", "system")).id,
      };
      const { data } = await db.from("messages").select("id, author_kind, author_id").in("id", Object.values(ids));
      const by = (id: string) => (data ?? []).find((r: { id: string }) => r.id === id);
      expect(by(ids.staff)).toMatchObject({ author_kind: "person", author_id: "user_dan" });
      expect(by(ids.recipe)).toMatchObject({ author_kind: "automation", author_id: null });
      expect(by(ids.textback)).toMatchObject({ author_kind: "ai", author_id: null });
      expect(by(ids.inbound)).toMatchObject({ author_kind: "customer", author_id: null });
    }));
});

describe("listContactMessages, paged for the timeline (spec §7, C4)", () => {
  it("only email and text, newest first, past the cursor; with no page, today's whole thread oldest first (mutation: drop the channel filter -> the form copy appears, FAILS)", () =>
    withTestAccount(async (db, accountId) => {
      const { id: ana } = await createContact(db, accountId, { firstName: "Ana" }, "user_test");
      const { id: conv } = await ensureConversation(db, accountId, ana, "user_test");
      const mk = async (channel: "sms" | "email" | "form" | "voice", at: string) => {
        const { id } = await createMessage(db, accountId, { conversationId: conv, channel, direction: "inbound", body: channel }, "x", "system");
        await db.from("messages").update({ created_at: at }).eq("id", id);
        return id;
      };
      const sms = await mk("sms", "2026-10-01T10:00:00+00:00");
      await mk("form", "2026-10-02T10:00:00+00:00");
      const email = await mk("email", "2026-10-03T10:00:00+00:00");
      await mk("voice", "2026-10-04T10:00:00+00:00");
      const page = (await listContactMessages(db, accountId, ana, { limit: 31, channels: ["email", "sms"] })) as { id: string; created_at: string; author_kind: string }[];
      expect(page.map((m) => m.id)).toEqual([email, sms]);
      expect(page[0]!.author_kind).toBe("customer");
      const older = (await listContactMessages(db, accountId, ana, { limit: 31, channels: ["email", "sms"], before: { v: page[0]!.created_at, id: email } })) as { id: string }[];
      expect(older.map((m) => m.id)).toEqual([sms]);
      expect(((await listContactMessages(db, accountId, ana)) as { channel: string }[]).map((m) => m.channel)).toEqual(["sms", "form", "email", "voice"]);
    }));
});
```

- [ ] **Step 2: Typecheck red.** `pnpm --filter @bis/db typecheck` → `Expected 3 arguments, but got 4` on `listContactMessages`. (The author test compiles today and fails on CI because the column values are missing.)

- [ ] **Step 3: Implement in `packages/db/src/messaging.ts`.** Add imports under `:5`:

```ts
import { messageAuthor } from "./provenance";
import { withTimelinePage, type TimelinePageOpts } from "./timeline-cursor";
```

At the top of `createMessage`'s body:

```ts
  // Who wrote it (0073, spec §5.2): from the actor the caller already passes, one mapping for all
  // thirteen writers (provenance.ts; the backfill's SQL twin is pinned by provenance-parity.test.ts).
  const author = messageAuthor(actorType, actorId, input.direction);
```

and two properties in the inserted object (after `provider_message_id`, `:141`):

```ts
      author_kind: author.authorKind,
      author_id: author.authorId,
```

Replace `listContactMessages` (`:735-743`):

```ts
export async function listContactMessages(
  db: SupabaseClient, accountId: string, contactId: string,
  page?: TimelinePageOpts & { channels?: readonly NewMessage["channel"][] },
) {
  const { data: conversation, error } = await db.from("conversations")
    .select("id").eq("account_id", accountId).eq("contact_id", contactId).maybeSingle();
  if (error) throw new Error(`listContactMessages failed: ${error.message}`);
  if (!conversation) return [];
  if (!page) return listMessages(db, accountId, conversation.id as string);
  // The record timeline (S-03 1b): one page, newest first, with who wrote each (0073). `channels`
  // keeps the inbox's form/voice copies out (spec C4): those events have rows of their own there.
  let q = db.from("messages")
    .select(`${MESSAGE_COLS}, author_kind, author_id`)
    .eq("account_id", accountId).eq("conversation_id", conversation.id as string);
  if (page.channels) q = q.in("channel", [...page.channels]);
  const { data, error: mErr } = await withTimelinePage(q, "created_at", page);
  if (mErr) throw new Error(`listContactMessages failed: ${mErr.message}`);
  return data ?? [];
}
```

- [ ] **Step 4: Typecheck green.** `pnpm --filter @bis/db typecheck`, then `pnpm --filter web typecheck`: no errors. CI proves the live red→green; probes are in the test titles.

- [ ] **Step 5: Failing web tests for the bilingual composer and its lines.** Append to `apps/web/src/lib/consent/composer-state.test.ts`:

```ts
describe("the composer's lines in the page's language (S-03 1b, spec §10.2)", () => {
  it("a stopped number reads Spanish with a Spanish date; English stays the default (mutation: ignore locale -> FAILS)", () => {
    const es = composerStateLine({ kind: "stopped", since: "2026-10-04T15:00:00Z" }, "America/Chicago", "es");
    expect(es).toBe(`Dejó de recibir textos el ${formatDateInZone("2026-10-04T15:00:00Z", "America/Chicago", "es")}. No puede mandarle textos a este número hasta que mande START.`);
    expect(es).not.toContain("Oct");
    expect(composerStateLine({ kind: "held", since: "x" }, "UTC")).toBe(m["compose.smsHeld"]);
  });
  it("the email notice drops an unformattable date in either language", () => {
    expect(composerEmailNotice({ kind: "stopped", since: "nope", byCustomer: true }, "UTC", "es"))
      .toBe("Se dio de baja de sus correos. Escríbale solo sobre algo que le haya pedido.");
    expect(composerEmailNotice({ kind: "stopped", since: "nope", byCustomer: true }, "UTC"))
      .toBe("They unsubscribed from your emails. Write only about something they asked you for.");
  });
});
```

(Add whatever the file does not already import: `import { m } from "@/lib/messages";`, `import { formatDateInZone } from "@/lib/format";`, `import { composerStateLine, composerEmailNotice } from "./composer-state";`.)

Append to `apps/web/src/lib/email/failure-reason.test.ts`:

```ts
describe("failure reasons in Spanish (S-03 1b)", () => {
  it("a failed message reads its Spanish reason; English is the default (mutation: ignore locale -> FAILS)", () => {
    expect(messageFailureReason({ status: "failed", error: "provider said no" }, "es")).toBe("Esto no se envió.");
    expect(messageFailureReason({ status: "failed", error: "provider said no" })).toBe(m["conversations.failureReason.failed"]);
  });
});
```

Append to `…/contacts/[contactId]/message-composer.test.ts`:

```ts
describe("the composer in Spanish (S-03 1b, spec §10.2)", () => {
  it("smsFormBlock answers in the page's language (mutation: drop the locale -> English, FAILS)", () => {
    expect(smsFormBlock(null, true, null, "es")).toEqual({ text: "No se pudo revisar si puede recibir textos. Vuelva a cargar la página para intentar de nuevo.", consent: false });
    expect(smsFormBlock({ ok: true, from: "+19565550199", ownedNumbers: [] } as never, false, null, "es"))
      .toEqual({ text: "Este contacto no tiene número de teléfono.", consent: false });
  });
  it("its tabs read Spanish under a Spanish LocaleProvider (mutation: keep m[...] for the tab labels -> FAILS)", async () => {
    const { createElement } = await import("react");
    const { renderToStaticMarkup } = await import("react-dom/server");
    const { LocaleProvider } = await import("@/components/locale-provider");
    const html = renderToStaticMarkup(createElement(LocaleProvider, { locale: "es" } as never, createElement(MessageComposer, {
      contactId: "c1", contactHasEmail: true, contactHasPhone: true, smsGate: null, smsBlockedLine: null, emailNoticeLine: null,
      noteAction: async () => {}, emailAction: async () => {}, smsAction: async () => {},
    } as never)));
    for (const word of [">Nota<", ">Correo<", ">Texto<"]) expect(html).toContain(word);
  });
});
```

(Import `smsFormBlock` and `MessageComposer` from `./message-composer` if the file does not already. Keep the file's existing mocks.)

- [ ] **Step 6: Run them red.** `pnpm --filter web exec vitest run src/lib/consent/composer-state.test.ts src/lib/email/failure-reason.test.ts "src/app/(dashboard)/dashboard/accounts/[accountId]/contacts/[contactId]/message-composer.test.ts"`. Expected: the new cases fail, with English where Spanish was expected. Paste one failing assertion.

- [ ] **Step 7: Implement.** `composer-state.ts`: add `import { t } from "@/lib/i18n/t";` and `import type { Locale } from "@/lib/i18n/locale";`; replace the two functions:

```ts
export function composerStateLine(state: SmsRecipientState, zone: string, locale: Locale = "en"): string | null {
  switch (state.kind) {
    case "ok": return null;
    case "stopped": {
      let date: string | null = null;
      try {
        date = formatDateInZone(state.since, zone, locale);
      } catch {
        date = null;
      }
      return date === null ? t(m, "compose.smsStoppedUndated", locale) : t(m, "compose.smsStopped", locale, { date });
    }
    case "held": return t(m, "compose.smsHeld", locale);
    case "unconfirmed_number": return t(m, "compose.smsCheckNumber", locale);
    case "unknown": return t(m, "compose.smsStateUnknown", locale);
  }
}
```

```ts
export function composerEmailNotice(state: EmailRecipientState, zone: string, locale: Locale = "en"): string | null {
  if (state.kind === "ok") return null;
  if (state.kind === "unknown") return t(m, "compose.emailStateUnknown", locale);
  const key = state.suppressed === "bounced" ? "compose.emailBounced"
    : state.suppressed === "complained" ? "compose.emailComplained"
    : state.byCustomer ? "compose.emailUnsubscribed" : "compose.emailStoppedByYou";
  try {
    return t(m, key, locale, { date: formatDateInZone(state.since, zone, locale) });
  } catch {
    // Both languages phrase the date as " on {date}" / " el {date}": drop it rather than throw.
    return t(m, key, locale).replace(/ (?:on|el) \{date\}/, "");
  }
}
```

`failure-reason.ts`: add the same two imports; change the signature to `messageFailureReason(message: { status: string; error: string | null }, locale: Locale = "en"): string | null` and replace each `m["k"]` in its body (`:60-66`) with `t(m, "k", locale)`.

`message-composer.tsx`: add `import { useLocale } from "@/components/locale-provider";`, `import { t } from "@/lib/i18n/t";`, `import type { Locale } from "@/lib/i18n/locale";` and change the messages import to `import { m, type MessageKey } from "@/lib/messages";`. Change `smsFormBlock` to take `locale: Locale = "en"` as its fourth parameter and read each of its four keys through `t(m, key, locale)`. Inside `MessageComposer`, first line: `const locale = useLocale(); const tx = (key: MessageKey, params?: Record<string, string | number>) => t(m, key, locale, params);`. Then replace each of the component's own `m["…"]` reads (lines `:118`, `:119`, `:139`, `:141`, `:143`, `:181`, `:187`, `:196`, `:203`, `:216-218`, `:226`, `:236`, `:237`) with `tx("…")`. The keys are `compose.sent`, `compose.smsSent`, `compose.smsSendRejected`, `compose.smsFailed`, `compose.noteFailed`, `compose.sendRejected`, `compose.sendFailed`, `compose.note`, `compose.email`, `compose.sms`, `compose.noEmailOnContact`, `compose.subject`, `compose.emailPlaceholder`, `compose.smsPlaceholder`, `contact.addNote`, `compose.smsSegments`, `compose.send`, `common.add`, `compose.sending` and `common.saving`. For `compose.smsSegments`, pass `{ chars, segments }` as params instead of the `.replace` calls. Pass `locale` to its `smsFormBlock(...)` call. `EmailSendButton` already takes `label`/`pendingLabel` (`send-button.tsx:13-18`). The Conversations page is untouched.

- [ ] **Step 8: Run green.** Same command as Step 6 → all pass. Then confirm the existing callers still pass: `pnpm --filter web exec vitest run src/lib/consent src/lib/email "src/app/(dashboard)/dashboard/accounts/[accountId]/conversations"`.

- [ ] **Step 9: Copy (messages.ts #2: only after Task 8 committed).** Add each `.es` line directly under its English key, verbatim:

| Key | `.es` |
|---|---|
| `common.add` | `Agregar` |
| `common.saving` | `Guardando…` |
| `contact.addNote` | `Escriba una nota…` |
| `compose.note` · `.email` · `.subject` | `Nota` · `Correo` · `Asunto` |
| `compose.emailPlaceholder` · `.smsPlaceholder` | `Escriba un correo…` · `Escriba un texto…` |
| `compose.send` · `.sending` · `.sent` | `Enviar` · `Enviando…` · `Correo enviado.` |
| `compose.sendFailed` | `No se pudo enviar ese correo. Quedó guardado como fallido en la conversación.` |
| `compose.sendRejected` | `No se pudo enviar ese correo. Revise que el contacto tenga correo.` |
| `compose.noteFailed` | `No se pudo guardar esa nota. Intente de nuevo.` |
| `compose.noEmailOnContact` · `.noPhoneOnContact` | `Este contacto no tiene correo.` · `Este contacto no tiene número de teléfono.` |
| `compose.sms` · `.smsSent` · `.smsFailed` | `Texto` · `Texto enviado` · `No se pudo enviar el texto` |
| `compose.smsSendRejected` | `No se pudo enviar ese texto. Revise que el contacto tenga número de teléfono.` |
| `compose.smsBlockedA2p` | `Los textos están apagados hasta que se apruebe el registro de mensajes de esta empresa` |
| `compose.smsBlockedNoNumber` | `Para mandar textos, esta empresa necesita un número de teléfono activo` |
| `compose.smsSegments` | `{chars} caracteres · {segments} mensaje(s)` |
| `compose.smsStopped` | `Dejó de recibir textos el {date}. No puede mandarle textos a este número hasta que mande START.` |
| `compose.smsStoppedUndated` | `Dejó de recibir sus textos. No puede mandarle textos a este número hasta que mande START.` |
| `compose.smsHeld` | `Los textos a esta persona están en pausa mientras revisa si pidió que se detuvieran.` |
| `compose.smsCheckNumber` | `Este número podría ser de México o de EE. UU. Elija su país en el contacto antes de mandarle un texto.` |
| `compose.smsStateUnknown` | `No se pudo revisar si puede recibir textos. Vuelva a cargar la página para intentar de nuevo.` |
| `compose.emailUnsubscribed` | `Se dio de baja de sus correos el {date}. Escríbale solo sobre algo que le haya pedido.` |
| `compose.emailStoppedByYou` | `Usted detuvo los correos a esta persona el {date}. Escríbale solo sobre algo que le haya pedido.` |
| `compose.emailBounced` | `Este correo rebotó el {date}: los correos a esta dirección no se enviarán. Corrija la dirección para empezar de nuevo.` |
| `compose.emailComplained` | `Esta persona marcó un correo como spam el {date}; no le volveremos a escribir a menos que se vuelva a suscribir.` |
| `compose.emailStateUnknown` | `No se pudo revisar si se dio de baja. Escríbale solo sobre algo que le haya pedido.` |
| `conversations.status.queued` · `.sent` · `.delivered` | `En cola` · `Enviado` · `Entregado` |
| `conversations.status.opened` · `.bounced` · `.failed` | `Abierto` · `Rebotó` · `No se envió` |
| `conversations.failureReason.complained` | `Marcó este correo como spam.` |
| `conversations.failureReason.bounced` | `No se pudo llegar a esta dirección.` |
| `conversations.failureReason.failed` | `Esto no se envió.` |
| `conversations.failureReason.suppressed` | `Ya rebotó o lo marcaron como spam; no se envió nada.` |

Then `pnpm --filter web exec vitest run src/lib/i18n src/lib/messages.test.ts src/lib/consent src/lib/email "src/app/(dashboard)/dashboard/accounts/[accountId]/contacts/[contactId]/message-composer.test.ts"` → all pass (the ratchet passes a frozen key that gained its twin). Note for the report: deleting one twin (say `compose.smsHeld.es`) fails no ratchet test, because the ratchet freezes the key. These words are pinned by Step 5's tests instead (`compose.smsStopped`, `compose.smsStateUnknown`, `compose.noPhoneOnContact`, the three tab words, `conversations.failureReason.failed`).

- [ ] **Step 10: Commit.**

```bash
git add -- packages/db/src/test/messaging-author.test.ts
git commit -m "feat(sms): every message records who wrote it, the record reads one page of texts and emails, and the composer speaks Spanish (S-03 1b)" -- packages/db/src/messaging.ts packages/db/src/test/messaging-author.test.ts "apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/contacts/[contactId]/message-composer.tsx" "apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/contacts/[contactId]/message-composer.test.ts" apps/web/src/lib/consent/composer-state.ts apps/web/src/lib/consent/composer-state.test.ts apps/web/src/lib/email/failure-reason.ts apps/web/src/lib/email/failure-reason.test.ts apps/web/src/lib/messages.ts
```

---

## Task 4: Bookings name their author; `listContactBookings` (bis-booking)

**Review:** sonnet. **Runs:** group B. **messages.ts #3:** its Step 5 waits for Task 3's commit.

**Files**
- Modify: `packages/db/src/booking.ts` (imports `:1-5`; `createBooking` `:253-270`; `insertBookingRow` `:281-299`; `moveBooking` `:687-792`; append after `listContactUpcomingBookings`, which ends at `:975`)
- Create: `packages/db/src/test/booking-author.test.ts` (live, CI)
- Modify: `apps/web/src/lib/messages.ts` (twins only)

**Interfaces**
- Consumes: `bookingAuthor`, `RowAuthor`, `AuthorKind` (Task 1); `withTimelinePage`, `TimelinePageOpts` (Task 2).
- Produces:
  ```ts
  export type ContactBookingRow = {
    id: string; created_at: string; starts_at: string; status: BookingStatus; note: string | null;
    author_kind: AuthorKind | null; author_id: string | null; rescheduled_from_id: string | null;
    moved_from_starts_at: string | null;
  };
  export async function listContactBookings(db, accountId, contactId, page: TimelinePageOpts): Promise<ContactBookingRow[]>;
  ```
  `createBooking` and `moveBooking` write `author_kind`/`author_id` (signatures unchanged). No barrel line: Task 7 imports from `./booking`.

- [ ] **Step 1: Failing live test** `packages/db/src/test/booking-author.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import "dotenv/config";
import { withTestAccount } from "./fixtures";
import { createContact } from "../contacts";
import { getOrCreateCalendar, createBooking, moveBooking, listContactBookings } from "../booking";

const span = (v: string) => ({ startsAt: new Date(v), endsAt: new Date(Date.parse(v) + 3_600_000) });

describe("bookings name their author (S-03 1b, spec §5.2)", () => {
  it("the booking page's is the customer's, the receptionist's the AI's, a person's names them (mutation: write author_kind 'person' always -> FAILS)", () =>
    withTestAccount(async (db, accountId) => {
      const cal = await getOrCreateCalendar(db, accountId, "user_test");
      const { id: ana } = await createContact(db, accountId, { firstName: "Ana" }, "user_test");
      const pub = await createBooking(db, accountId, { calendarId: cal.id, contactId: ana, ...span("2027-03-02T15:00:00Z"), ipHash: "h" }, "public", "system");
      const ai = await createBooking(db, accountId, { calendarId: cal.id, contactId: ana, ...span("2027-03-03T15:00:00Z") }, "voice", "ai");
      const staff = await createBooking(db, accountId, { calendarId: cal.id, contactId: ana, ...span("2027-03-04T15:00:00Z") }, "user_dan", "user");
      const { data } = await db.from("bookings").select("id, author_kind, author_id").in("id", [pub.id, ai.id, staff.id]);
      const by = (id: string) => (data ?? []).find((r: { id: string }) => r.id === id);
      expect(by(pub.id)).toMatchObject({ author_kind: "customer", author_id: null });
      expect(by(ai.id)).toMatchObject({ author_kind: "ai", author_id: null });
      expect(by(staff.id)).toMatchObject({ author_kind: "person", author_id: "user_dan" });
    }));
  it("a move records who moved it: the customer's move page (mutation: pass no author to moveBooking's insert -> NULL, FAILS)", () =>
    withTestAccount(async (db, accountId) => {
      const cal = await getOrCreateCalendar(db, accountId, "user_test");
      const { id: ana } = await createContact(db, accountId, { firstName: "Ana" }, "user_test");
      const first = await createBooking(db, accountId, { calendarId: cal.id, contactId: ana, ...span("2027-04-02T15:00:00Z") }, "public", "system");
      const moved = await moveBooking(db, accountId, first.id, { ...span("2027-04-03T15:00:00Z"), ipHash: "h" }, "public", "system");
      const { data } = await db.from("bookings").select("author_kind").eq("id", moved.id).single();
      expect(data).toEqual({ author_kind: "customer" });
    }));
});

describe("listContactBookings (spec §6, §7)", () => {
  it("one page by (created_at desc, id desc), a reschedule carrying the start it replaced (mutation: drop the moved-from read -> null, FAILS)", () =>
    withTestAccount(async (db, accountId) => {
      const cal = await getOrCreateCalendar(db, accountId, "user_test");
      const { id: ana } = await createContact(db, accountId, { firstName: "Ana" }, "user_test");
      const first = await createBooking(db, accountId, { calendarId: cal.id, contactId: ana, ...span("2027-05-02T15:00:00Z") }, "public", "system");
      const moved = await moveBooking(db, accountId, first.id, span("2027-05-03T15:00:00Z"), "public", "system");
      const rows = await listContactBookings(db, accountId, ana, { limit: 31 });
      expect(rows.map((r) => r.id)).toEqual([moved.id, first.id]);
      expect(Date.parse(rows[0]!.moved_from_starts_at!)).toBe(Date.parse("2027-05-02T15:00:00Z"));
      expect(rows[0]).toMatchObject({ status: "booked", author_kind: "customer" });
      expect(rows[1]).toMatchObject({ status: "cancelled", moved_from_starts_at: null });
      const older = await listContactBookings(db, accountId, ana, { limit: 31, before: { v: rows[0]!.created_at, id: rows[0]!.id } });
      expect(older.map((r) => r.id)).toEqual([first.id]);
    }));
});
```

- [ ] **Step 2: Typecheck red.** `pnpm --filter @bis/db typecheck` → `Module '"../booking"' has no exported member 'listContactBookings'`.

- [ ] **Step 3: Implement in `packages/db/src/booking.ts`.** Imports under `:5`:

```ts
import { bookingAuthor, type AuthorKind, type RowAuthor } from "./provenance";
import { withTimelinePage, type TimelinePageOpts } from "./timeline-cursor";
```

`insertBookingRow` gains a fifth parameter `author: RowAuthor` and two inserted properties (after `rescheduled_from_id`, `:296`):

```ts
      // Who made it (0073, spec §5.2): bookingAuthor, from the actor the caller passes.
      author_kind: author.authorKind,
      author_id: author.authorId,
```

In `createBooking` (`:258`): `const { data, error } = await insertBookingRow(db, accountId, input, cancelToken, bookingAuthor(actorType, actorId));`. In `moveBooking` (`:724`): `const inserted = await insertBookingRow(db, accountId, input, cancelToken, bookingAuthor(actorType, actorId));`.

Append after `listContactUpcomingBookings`:

```ts
export type ContactBookingRow = {
  id: string; created_at: string; starts_at: string; status: BookingStatus; note: string | null;
  author_kind: AuthorKind | null; author_id: string | null; rescheduled_from_id: string | null;
  /** The replaced booking's start ("Moved from …"), when this row is a reschedule and that row is readable. */
  moved_from_starts_at: string | null;
};

/**
 * The record timeline's bookings (S-03 part 1, 1b; spec §6): one page by (created_at desc, id desc).
 * A booking row reads "booked an appointment for {when}": no calendar label, there is one calendar
 * per account (`calendars_one_per_account`, 0016) and it has no name column. A reschedule (0061)
 * carries the start it replaced, read in ONE extra query for the page. Runs on the caller's client,
 * so RLS (0068's Technician fence) decides what is read. THROWS on a read error.
 */
export async function listContactBookings(
  db: SupabaseClient, accountId: string, contactId: string, page: TimelinePageOpts,
): Promise<ContactBookingRow[]> {
  const { data, error } = await withTimelinePage(
    db.from("bookings")
      .select("id, created_at, starts_at, status, note, author_kind, author_id, rescheduled_from_id")
      .eq("account_id", accountId).eq("contact_id", contactId),
    "created_at", page);
  if (error) throw new Error(`listContactBookings failed: ${error.message}`);
  const rows = (data ?? []) as Omit<ContactBookingRow, "moved_from_starts_at">[];
  const fromIds = [...new Set(rows.flatMap((r) => (r.rescheduled_from_id ? [r.rescheduled_from_id] : [])))];
  const movedFrom = new Map<string, string>();
  if (fromIds.length > 0) {
    const { data: olds, error: oErr } = await db.from("bookings").select("id, starts_at")
      .eq("account_id", accountId).in("id", fromIds);
    if (oErr) throw new Error(`listContactBookings (moved from) failed: ${oErr.message}`);
    for (const o of (olds ?? []) as { id: string; starts_at: string }[]) movedFrom.set(o.id, o.starts_at);
  }
  return rows.map((r) => ({
    ...r, moved_from_starts_at: r.rescheduled_from_id ? movedFrom.get(r.rescheduled_from_id) ?? null : null,
  }));
}
```

- [ ] **Step 4: Typecheck green.** `pnpm --filter @bis/db typecheck` → no errors. CI proves the live red→green (probes in the titles).

- [ ] **Step 5: Copy (messages.ts #3: only after Task 3 committed).** Directly under each English key (`messages.ts:1591-1594`):

```ts
  "calendar.bookings.status.booked.es": "Agendada",
  "calendar.bookings.status.cancelled.es": "Cancelada",
  "calendar.bookings.status.completed.es": "Terminada",
  "calendar.bookings.status.no_show.es": "No llegó",
```

Then `pnpm --filter web exec vitest run src/lib/i18n src/lib/messages.test.ts` → passes. (Task 9's `timeline-rows.test.ts` pins `Agendada`.)

- [ ] **Step 6: Commit.**

```bash
git add -- packages/db/src/test/booking-author.test.ts
git commit -m "feat(booking): every booking records who made it, and the record reads a customer's bookings a page at a time (S-03 1b)" -- packages/db/src/booking.ts packages/db/src/test/booking-author.test.ts apps/web/src/lib/messages.ts
```

---

## Task 5: `listContactCalls` widened and paged (bis-voice)

**Review:** sonnet. **Runs:** group B. **messages.ts #4:** its Step 5 waits for Task 4's commit.

**Files**
- Modify: `packages/db/src/voice.ts` (imports `:1-3`; `listContactCalls` `:943-957`)
- Create: `packages/db/src/test/voice-timeline.test.ts` (live, CI)
- Modify: `apps/web/src/lib/messages.ts` (twins only)

**Interfaces**
- Consumes: `withTimelinePage`, `TimelineCursor` (Task 2).
- Produces:
  ```ts
  export type ContactCallRow = {
    id: string; started_at: string; outcome: string; duration_secs: number | null;
    reason: string | null; summary: string; language: "en" | "es";
  };
  export async function listContactCalls(
    db, accountId, contactId, limit = 3, opts: { excludeSpam?: boolean; before?: TimelineCursor } = {},
  ): Promise<ContactCallRow[]>;   // (started_at desc, id desc); existing callers unchanged
  ```
  Exported through `export * from "./voice"` (`index.ts:124`).

- [ ] **Step 1: Failing live test** `packages/db/src/test/voice-timeline.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import "dotenv/config";
import { withTestAccount, testPhoneNumber } from "./fixtures";
import { createContact } from "../contacts";
import { assignPhoneNumber, listContactCalls } from "../voice";

describe("listContactCalls for the record timeline (S-03 1b, spec §6, §7)", () => {
  it("carries outcome, duration, reason, summary and language, and pages past a cursor at a tied instant (mutation: drop the id tiebreak -> FAILS)", () =>
    withTestAccount(async (db, accountId) => {
      const { id: ana } = await createContact(db, accountId, { firstName: "Ana" }, "user_test");
      const num = await assignPhoneNumber(db, accountId, { e164: testPhoneNumber() }, "user_test");
      const at = "2026-10-09T16:12:00.123456+00:00";
      const ids: string[] = [];
      for (const reason of ["Roof leak", "Gutter quote"]) {
        const { data, error } = await db.from("calls").insert({
          account_id: accountId, phone_number_id: num.id, contact_id: ana, started_at: at, outcome: "booked",
          duration_secs: 181, reason, summary: "x", language: "es",
        }).select("id").single();
        if (error) throw new Error(error.message);
        ids.push((data as { id: string }).id);
      }
      const first = await listContactCalls(db, accountId, ana, 1);
      expect(first[0]).toMatchObject({ outcome: "booked", duration_secs: 181, language: "es", summary: "x" });
      const second = await listContactCalls(db, accountId, ana, 5, { before: { v: first[0]!.started_at, id: first[0]!.id } });
      expect([first[0]!.id, ...second.map((c) => c.id)]).toEqual([...ids].sort().reverse());
    }));
});
```

- [ ] **Step 2: Typecheck red.** `pnpm --filter @bis/db typecheck` → `Object literal may only specify known properties, and 'before' does not exist`.

- [ ] **Step 3: Implement.** Under `voice.ts:3` add `import { withTimelinePage, type TimelineCursor } from "./timeline-cursor";`. Replace `:943-957`:

```ts
export type ContactCallRow = {
  id: string; started_at: string; outcome: string; duration_secs: number | null;
  reason: string | null; summary: string; language: "en" | "es";
};

/** The contact drawer's recent-calls source: newest few for ONE contact. `excludeSpam` is the
 *  record page's "Last talked" read (S-03 part 1, spec §7): a call the receptionist marked spam
 *  is not talking with the customer. `before` pages the record timeline (1b, spec C3); the row's
 *  own columns are there for its timeline row (outcome, minutes, reason, the caller's language). */
export async function listContactCalls(
  db: SupabaseClient, accountId: string, contactId: string, limit = 3,
  opts: { excludeSpam?: boolean; before?: TimelineCursor } = {},
): Promise<ContactCallRow[]> {
  let query = db.from("calls")
    .select("id, started_at, outcome, duration_secs, reason, summary, language")
    .eq("account_id", accountId).eq("contact_id", contactId);
  if (opts.excludeSpam) query = query.neq("outcome", "spam");
  const { data, error } = await withTimelinePage(query, "started_at", { before: opts.before, limit });
  if (error) throw new Error(`listContactCalls failed: ${error.message}`);
  return (data ?? []) as ContactCallRow[];
}
```

- [ ] **Step 4: Green.** `pnpm --filter @bis/db typecheck`, `pnpm --filter web typecheck` → no errors (the drawer's summary route and `record.ts`'s `lastTalked` read the same three fields as before). CI proves the live test.

- [ ] **Step 5: Copy (messages.ts #4: only after Task 4 committed).** Under each English key (`messages.ts:2321-2330`):

```ts
  "calls.outcome.booked.es": "Agendó",
  "calls.outcome.lead.es": "Cliente potencial",
  "calls.outcome.message.es": "Mensaje",
  "calls.outcome.abandoned.es": "Colgó",
  "calls.outcome.spam.es": "Spam",
  "calls.outcome.transferred.es": "Transferida",
```

Then `pnpm --filter web exec vitest run src/lib/i18n src/lib/messages.test.ts` → passes.

- [ ] **Step 6: Commit.**

```bash
git add -- packages/db/src/test/voice-timeline.test.ts
git commit -m "feat(voice): a customer's calls carry what the record timeline shows, paged by its cursor (S-03 1b)" -- packages/db/src/voice.ts packages/db/src/test/voice-timeline.test.ts apps/web/src/lib/messages.ts
```

---

## Task 6: The web chat's submission is the AI's (bis-automations)

**Review:** sonnet. **Runs:** group B, after Task 2.

**Files**
- Modify: `apps/web/src/lib/concierge/lead.ts:151-154`
- Modify: `apps/web/src/lib/concierge/lead.test.ts`

**Interfaces:** Consumes `SubmissionInput.authorKind` (Task 2, through `@bis/db`'s existing `type SubmissionInput` export). Produces nothing new.

- [ ] **Step 1: Failing test.** Add inside `describe("fileLead", …)` in `lead.test.ts`:

```ts
  it("files the submission as the AI's: the website chat took it, not the customer typing a form (S-03 1b, spec §5.2; mutation: drop authorKind -> FAILS)", async () => {
    const { db } = fakeDb();
    await fileLead({ db, ...CTX });
    expect(dbFns.createSubmission.mock.calls[0]![3]).toMatchObject({ authorKind: "ai" });
  });
```

- [ ] **Step 2: Run red.** `pnpm --filter web exec vitest run src/lib/concierge/lead.test.ts` → the new case fails (`expected {…} to match object { authorKind: 'ai' }`).

- [ ] **Step 3: Implement.** The `createSubmission` call in `lead.ts` (`:151-154`) becomes:

```ts
    const submission = await createSubmission(db, form.account_id, form.id, {
      answers, attribution: ctx.attribution, consent,
      locale: ctx.locale, ipHash: ctx.ipHash,
      // 0073: the record timeline marks this lead "Sofía · AI · took a request in the website chat".
      authorKind: "ai",
    });
```

- [ ] **Step 4: Run green.** Same command → all pass.

- [ ] **Step 5: Commit.** `git commit -m "feat(automations): the website chat's lead is marked as the AI's on the customer's record (S-03 1b)" -- apps/web/src/lib/concierge/lead.ts apps/web/src/lib/concierge/lead.test.ts`

---

## Task 7: One merged page, and the names to mark it with (bis-crm)

**Review:** opus. **Runs:** group C, after Tasks 3, 4, 5.

**Files**
- Modify: `packages/db/src/record.ts` (imports `:1-3`; append after `contactNextUp`, which ends at `:111`)
- Modify: `packages/db/src/index.ts` (the record block, `:263-268`)
- Create: `packages/db/src/test/timeline-merge.test.ts` (pure)
- Modify: `packages/db/src/test/record.test.ts` (live, CI; new describe blocks)

**Interfaces**
- Consumes: Task 2's four sources and cursor helpers; `listContactMessages` (Task 3), `listContactBookings` + `ContactBookingRow` (Task 4), `listContactCalls` + `ContactCallRow` (Task 5), `AuthorKind` (Task 1).
- Produces (all barrelled):
  ```ts
  export type TimelineSource = "notes" | "todos" | "deals" | "forms" | "messages" | "bookings" | "calls";
  export const TIMELINE_SOURCES: readonly TimelineSource[];          // that order
  export type TimelineNote = { id: string; body: string; author_id: string | null; created_at: string };
  export type TimelineTask = { id: string; title: string; due_at: string | null; completed_at: string | null; created_at: string;
    consent_event_id: string | null; call_id: string | null; assigned_to: string | null; created_by: string | null };
  export type TimelineDeal = { id: string; name: string; status: string; monetary_value: number | string; created_at: string; created_by: string | null };
  export type TimelineSubmission = { id: string; created_at: string; formName: string;
    answers: { key: string; label: string; value: string }[]; author_kind: "customer" | "ai" };
  export type TimelineMessage = { id: string; channel: "email" | "sms"; direction: "inbound" | "outbound"; status: string;
    subject: string | null; body: string; error: string | null; created_at: string; author_kind: AuthorKind | null; author_id: string | null };
  export type TimelineEntry =
    | { kind: "note"; id: string; at: string; note: TimelineNote }
    | { kind: "task"; id: string; at: string; task: TimelineTask }
    | { kind: "deal"; id: string; at: string; deal: TimelineDeal }
    | { kind: "submission"; id: string; at: string; submission: TimelineSubmission }
    | { kind: "message"; id: string; at: string; message: TimelineMessage }
    | { kind: "booking"; id: string; at: string; booking: ContactBookingRow }
    | { kind: "call"; id: string; at: string; call: ContactCallRow };
  export type TimelinePage = { items: TimelineEntry[]; older: TimelineCursor | null; failed: TimelineSource[] };
  export function compareTimelineEntries(a: TimelineEntry, b: TimelineEntry): number;   // (at desc, id desc)
  export async function listContactTimelinePage(db, accountId, contactId, before?: TimelineCursor,
    opts?: { limit?: number; onError?: (source: TimelineSource, e: unknown) => void }): Promise<TimelinePage>;  // never throws for a source
  export async function listPeopleNames(db, clerkUserIds: readonly string[]): Promise<Record<string, string>>;  // THROWS on a read error
  // re-exported: types TimelineCursor, ContactBookingRow, ContactCallRow; const TIMELINE_PAGE_SIZE
  ```

- [ ] **Step 1: Failing pure test** `packages/db/src/test/timeline-merge.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { compareTimelineEntries, type TimelineEntry } from "../record";

const note = (id: string, at: string): TimelineEntry =>
  ({ kind: "note", id, at, note: { id, body: "x", author_id: null, created_at: at } });

describe("compareTimelineEntries: (at desc, id desc) across tables (spec C3)", () => {
  it("newest first to the microsecond, whatever the spelling (mutation: compare Date.parse -> the 1 µs pair ties, FAILS)", () => {
    const rows = [note("00000000-0000-4000-8000-000000000001", "2026-10-09T16:12:00.000001+00:00"),
      note("00000000-0000-4000-8000-000000000002", "2026-10-09T16:12:00Z"),
      note("00000000-0000-4000-8000-000000000003", "2026-10-09T16:12:00.000002Z")];
    expect([...rows].sort(compareTimelineEntries).map((r) => r.id.slice(-1))).toEqual(["3", "1", "2"]);
  });
  it("a tie on the instant falls to the higher id first, as Postgres orders uuids (mutation: ascending ids -> FAILS)", () => {
    const at = "2026-10-09T16:12:00.5+00:00";
    const rows = [note("0a000000-0000-4000-8000-000000000000", at), note("0b000000-0000-4000-8000-000000000000", at)];
    expect([...rows].sort(compareTimelineEntries).map((r) => r.id.slice(0, 2))).toEqual(["0b", "0a"]);
  });
});
```

- [ ] **Step 2: Run red.** `cd <WT>/packages/db && NEXT_PUBLIC_SUPABASE_URL= SUPABASE_SERVICE_ROLE_KEY= SUPABASE_DB_URL=postgresql://postgres@localhost:1/none pnpm exec vitest run src/test/timeline-merge.test.ts` → FAIL (`compareTimelineEntries` is not exported).

- [ ] **Step 3: Failing live tests.** Append to `packages/db/src/test/record.test.ts`, and extend its imports: `addNote` from `../activities` (beside `addTask`); `createForm, createSubmission, linkSubmissionContact` from `../forms`; `listContactTimelinePage, listPeopleNames, TIMELINE_SOURCES` from `../record` (beside `contactFacts, contactNextUp`).

```ts
describe("listContactTimelinePage (S-03 1b, spec §7, C3, C4)", () => {
  it("merges the seven sources newest first, each row its own kind (mutation: leave calls out of the merge -> FAILS)", () =>
    withTestAccount(async (db, accountId) => {
      const { id: ana } = await createContact(db, accountId, { firstName: "Ana" }, ACTOR);
      const at = (d: number) => `2026-10-0${d}T15:00:00+00:00`;
      const stamp = async (table: string, id: string, d: number) => {
        const { error } = await db.from(table).update({ created_at: at(d) }).eq("id", id);
        if (error) throw new Error(`stamp ${table}: ${error.message}`);
      };
      await stamp("notes", (await addNote(db, accountId, ana, "n", ACTOR)).id, 1);
      await stamp("tasks", (await addTask(db, accountId, { contactId: ana, title: "t" }, ACTOR)).id, 2);
      const { pipelineId } = await ensureDefaultPipeline(db, accountId);
      await stamp("opportunities", (await createOpportunity(db, accountId, { contactId: ana, pipelineId, name: "d" }, ACTOR)).id, 3);
      const form = await createForm(db, accountId, { name: "Quote request" }, ACTOR);
      const sub = await createSubmission(db, accountId, form.id, { answers: [] });
      await linkSubmissionContact(db, accountId, sub.id, ana);
      await stamp("form_submissions", sub.id, 4);
      const { id: conv } = await ensureConversation(db, accountId, ana, ACTOR);
      await seedMessage(db, accountId, conv, "sms", at(5), "delivered");
      const cal = await getOrCreateCalendar(db, accountId, ACTOR);
      const b = await createBooking(db, accountId, { calendarId: cal.id, contactId: ana, startsAt: new Date("2027-03-02T15:00:00Z"), endsAt: new Date("2027-03-02T16:00:00Z") }, ACTOR);
      await stamp("bookings", b.id, 6);
      const num = await assignPhoneNumber(db, accountId, { e164: testPhoneNumber() }, ACTOR);
      const { error } = await db.from("calls").insert({ account_id: accountId, phone_number_id: num.id, contact_id: ana, started_at: at(7), outcome: "booked" });
      if (error) throw new Error(error.message);
      const page = await listContactTimelinePage(db, accountId, ana);
      expect(page.items.map((i) => i.kind)).toEqual(["call", "booking", "message", "submission", "deal", "task", "note"]);
      expect(page).toMatchObject({ older: null, failed: [] });
    }));

  it("the inbox's form and voice copies are not timeline rows (C4; mutation: drop the channels option -> FAILS)", () =>
    withTestAccount(async (db, accountId) => {
      const { id: ana } = await createContact(db, accountId, { firstName: "Ana" }, ACTOR);
      const { id: conv } = await ensureConversation(db, accountId, ana, ACTOR);
      await seedMessage(db, accountId, conv, "form", "2026-10-05T15:00:00Z", "delivered");
      await createMessage(db, accountId, { conversationId: conv, channel: "voice", direction: "inbound", body: "x" }, "voice", "ai");
      expect((await listContactTimelinePage(db, accountId, ana)).items).toEqual([]);
    }));

  it("rows at one instant across a page boundary are neither lost nor repeated (mutation: compare `at` only in the cursor filter -> a row is lost, FAILS)", () =>
    withTestAccount(async (db, accountId) => {
      const { id: ana } = await createContact(db, accountId, { firstName: "Ana" }, ACTOR);
      const same = "2026-10-09T16:12:00.123456+00:00";
      const n = (await addNote(db, accountId, ana, "n", ACTOR)).id;
      const t = (await addTask(db, accountId, { contactId: ana, title: "t" }, ACTOR)).id;
      await db.from("notes").update({ created_at: same }).eq("id", n);
      await db.from("tasks").update({ created_at: same }).eq("id", t);
      const p1 = await listContactTimelinePage(db, accountId, ana, undefined, { limit: 1 });
      expect(p1.older).not.toBeNull();
      const p2 = await listContactTimelinePage(db, accountId, ana, p1.older!, { limit: 1 });
      expect(p2.older).toBeNull();
      expect([...p1.items, ...p2.items].map((i) => i.id).sort()).toEqual([n, t].sort());
      expect(p1.items[0]!.id > p2.items[0]!.id).toBe(true);
    }));

  it("a source that fails is reported by name and the rest still load (spec §7; mutation: let one source's error reject the whole page -> FAILS)", () =>
    withTestAccount(async (db, accountId) => {
      const { id: ana } = await createContact(db, accountId, { firstName: "Ana" }, ACTOR);
      await addNote(db, accountId, ana, "still here", ACTOR);
      const failing = new Proxy(db, {
        get(target, prop, receiver) {
          if (prop === "from") {
            return (table: string) => {
              if (table === "calls") throw new Error("calls down");
              return target.from(table);
            };
          }
          return Reflect.get(target, prop, receiver);
        },
      });
      const errors: string[] = [];
      const page = await listContactTimelinePage(failing, accountId, ana, undefined, { onError: (s) => errors.push(s) });
      expect(page.failed).toEqual(["calls"]);
      expect(errors).toEqual(["calls"]);
      expect(page.items.map((i) => i.kind)).toEqual(["note"]);
      expect(TIMELINE_SOURCES).toHaveLength(7);
    }));
});

describe("listPeopleNames (spec §6, Names)", () => {
  it("name, else email, for the ids asked; an id with no row is simply absent (mutation: return the email even when a name exists -> FAILS)", () =>
    withTestAccount(async (db) => {
      const run = Math.random().toString(36).slice(2, 10);
      const a = `user_names_a_${run}`;
      const b = `user_names_b_${run}`;
      const { error } = await db.from("users").insert([
        { clerk_user_id: a, email: `${a}@example.com`, name: "Dan López" },
        { clerk_user_id: b, email: `${b}@example.com`, name: null },
      ]);
      if (error) throw new Error(error.message);
      try {
        expect(await listPeopleNames(db, [a, b, `user_gone_${run}`, a])).toEqual({ [a]: "Dan López", [b]: `${b}@example.com` });
        expect(await listPeopleNames(db, [])).toEqual({});
      } finally {
        await db.from("users").delete().in("clerk_user_id", [a, b]);
      }
    }));
});
```

- [ ] **Step 4: Typecheck red.** `pnpm --filter @bis/db typecheck` → `Module '"../record"' has no exported member 'listContactTimelinePage'`.

- [ ] **Step 5: Implement in `packages/db/src/record.ts`.** Replace the imports (`:1-3`):

```ts
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  countContactBookingsMade, listContactUpcomingBookings, listContactBookings,
  type UpcomingBooking, type ContactBookingRow,
} from "./booking";
import { listContactCalls, type ContactCallRow } from "./voice";
import { listNotes, listContactTasks } from "./activities";
import { listContactOpportunities } from "./opportunities";
import { listContactSubmissions } from "./forms";
import { listContactMessages } from "./messaging";
import { instantKey, TIMELINE_PAGE_SIZE, type TimelineCursor } from "./timeline-cursor";
import type { AuthorKind } from "./provenance";

export type { TimelineCursor } from "./timeline-cursor";
export type { ContactBookingRow } from "./booking";
export type { ContactCallRow } from "./voice";
export { TIMELINE_PAGE_SIZE } from "./timeline-cursor";
```

Append after `contactNextUp`:

```ts
/**
 * The record page's timeline (S-03 part 1, 1b; spec §6, §7, C3). Seven sources, each read on the
 * caller's client (RLS, 0068's Technician fences included, decides what is visible), merged into
 * ONE page ordered (at desc, id desc) with the contact list's cursor. Each source reads limit + 1;
 * the merge keeps `limit` and knows whether an older page exists. A source that fails is reported
 * in `failed` (and to `onError` for the log), never thrown: the rest of the page still loads.
 */
export type TimelineSource = "notes" | "todos" | "deals" | "forms" | "messages" | "bookings" | "calls";
export const TIMELINE_SOURCES: readonly TimelineSource[] = ["notes", "todos", "deals", "forms", "messages", "bookings", "calls"];

export type TimelineNote = { id: string; body: string; author_id: string | null; created_at: string };
export type TimelineTask = {
  id: string; title: string; due_at: string | null; completed_at: string | null; created_at: string;
  consent_event_id: string | null; call_id: string | null; assigned_to: string | null; created_by: string | null;
};
export type TimelineDeal = {
  id: string; name: string; status: string; monetary_value: number | string; created_at: string; created_by: string | null;
};
export type TimelineSubmission = {
  id: string; created_at: string; formName: string;
  answers: { key: string; label: string; value: string }[]; author_kind: "customer" | "ai";
};
export type TimelineMessage = {
  id: string; channel: "email" | "sms"; direction: "inbound" | "outbound"; status: string;
  subject: string | null; body: string; error: string | null; created_at: string;
  /** NULL only for a row the build before 1b wrote, until 0074 re-runs the backfill. */
  author_kind: AuthorKind | null; author_id: string | null;
};
export type TimelineEntry =
  | { kind: "note"; id: string; at: string; note: TimelineNote }
  | { kind: "task"; id: string; at: string; task: TimelineTask }
  | { kind: "deal"; id: string; at: string; deal: TimelineDeal }
  | { kind: "submission"; id: string; at: string; submission: TimelineSubmission }
  | { kind: "message"; id: string; at: string; message: TimelineMessage }
  | { kind: "booking"; id: string; at: string; booking: ContactBookingRow }
  | { kind: "call"; id: string; at: string; call: ContactCallRow };
export type TimelinePage = { items: TimelineEntry[]; older: TimelineCursor | null; failed: TimelineSource[] };

/** (at desc, id desc). `at` to the microsecond (instantKey); ids as Postgres orders uuids (bytewise,
 *  which is the lowercase hex string's order). */
export function compareTimelineEntries(a: TimelineEntry, b: TimelineEntry): number {
  const ka = instantKey(a.at);
  const kb = instantKey(b.at);
  if (ka !== kb) return ka < kb ? 1 : -1;
  const ia = a.id.toLowerCase();
  const ib = b.id.toLowerCase();
  return ia === ib ? 0 : ia < ib ? 1 : -1;
}

export async function listContactTimelinePage(
  db: SupabaseClient, accountId: string, contactId: string, before?: TimelineCursor,
  opts: { limit?: number; onError?: (source: TimelineSource, e: unknown) => void } = {},
): Promise<TimelinePage> {
  const limit = opts.limit ?? TIMELINE_PAGE_SIZE;
  const page = { before, limit: limit + 1 };
  const settle = async (source: TimelineSource, read: () => Promise<TimelineEntry[]>) => {
    try {
      return { source, entries: await read() };
    } catch (e) {
      opts.onError?.(source, e);
      return { source, entries: null };
    }
  };
  const results = await Promise.all([
    settle("notes", async () => (((await listNotes(db, accountId, contactId, page)) ?? []) as TimelineNote[])
      .map((note): TimelineEntry => ({ kind: "note", id: note.id, at: note.created_at, note }))),
    settle("todos", async () => (await listContactTasks(db, accountId, contactId, page))
      .map((t): TimelineEntry => ({ kind: "task", id: t.id, at: t.created_at, task: { ...t, created_by: t.created_by ?? null } }))),
    settle("deals", async () => (((await listContactOpportunities(db, accountId, contactId, page)) ?? []) as TimelineDeal[])
      .map((deal): TimelineEntry => ({ kind: "deal", id: deal.id, at: deal.created_at, deal }))),
    settle("forms", async () => (await listContactSubmissions(db, accountId, contactId, page))
      .map((s): TimelineEntry => ({ kind: "submission", id: s.id, at: s.created_at, submission: {
        id: s.id, created_at: s.created_at, formName: s.formName, answers: s.answers, author_kind: s.author_kind ?? "customer",
      } }))),
    settle("messages", async () => ((await listContactMessages(db, accountId, contactId, { ...page, channels: ["email", "sms"] })) as TimelineMessage[])
      .map((message): TimelineEntry => ({ kind: "message", id: message.id, at: message.created_at, message }))),
    settle("bookings", async () => (await listContactBookings(db, accountId, contactId, page))
      .map((booking): TimelineEntry => ({ kind: "booking", id: booking.id, at: booking.created_at, booking }))),
    settle("calls", async () => (await listContactCalls(db, accountId, contactId, page.limit, { before }))
      .map((call): TimelineEntry => ({ kind: "call", id: call.id, at: call.started_at, call }))),
  ]);
  const failed = results.flatMap((r) => (r.entries === null ? [r.source] : []));
  const merged = results.flatMap((r) => r.entries ?? []).sort(compareTimelineEntries);
  const items = merged.slice(0, limit);
  const last = items.at(-1);
  return { items, older: merged.length > limit && last ? { v: last.at, id: last.id } : null, failed };
}

/**
 * Display names for person marks (spec §6, Names): `name ?? email` (the picker's rule), for the
 * distinct Clerk ids asked, on the caller's client, so RLS decides who may be named (users_member_read
 * and users_agency_read, 0066). An id with no readable row is absent; the caller reads it as
 * "Someone on the team". No service-role read names anyone. THROWS on a read error.
 */
export async function listPeopleNames(db: SupabaseClient, clerkUserIds: readonly string[]): Promise<Record<string, string>> {
  const ids = [...new Set(clerkUserIds.filter((x) => x.length > 0))];
  if (ids.length === 0) return {};
  const { data, error } = await db.from("users").select("clerk_user_id, name, email").in("clerk_user_id", ids);
  if (error) throw new Error(`listPeopleNames failed: ${error.message}`);
  const out: Record<string, string> = {};
  for (const u of (data ?? []) as { clerk_user_id: string; name: string | null; email: string }[]) {
    const label = u.name?.trim() || u.email;
    if (label) out[u.clerk_user_id] = label;
  }
  return out;
}
```

Replace the record block in `packages/db/src/index.ts` (`:263-268`) with:

```ts
// The contact record page: facts, Next up (S-03 part 1) and the paged timeline (1b). See ./record.ts.
export {
  contactFacts, contactNextUp, OPEN_DEALS_SUM_CAP,
  listContactTimelinePage, listPeopleNames, compareTimelineEntries, TIMELINE_SOURCES, TIMELINE_PAGE_SIZE,
  type Fact, type ContactFacts, type LastTalked, type LastTalkedChannel, type OpenDeals, type FactName,
  type ContactNextUp, type NextUpTask,
  type TimelineSource, type TimelineNote, type TimelineTask, type TimelineDeal, type TimelineSubmission,
  type TimelineMessage, type TimelineEntry, type TimelinePage, type TimelineCursor, type ContactBookingRow,
} from "./record";
```

(`ContactCallRow` reaches the barrel through `export * from "./voice"`, `index.ts:124`.)

- [ ] **Step 6: Green where it can be.** Re-run Step 2's command → `2 passed`. `pnpm --filter @bis/db typecheck` and `pnpm --filter web typecheck` → no errors. CI proves the live tests (probes in their titles).

- [ ] **Step 7: Commit.**

```bash
git add -- packages/db/src/test/timeline-merge.test.ts
git commit -m "feat(contacts): the record timeline reads one merged page across seven sources, and the names to mark it with (S-03 1b)" -- packages/db/src/record.ts packages/db/src/index.ts packages/db/src/test/timeline-merge.test.ts packages/db/src/test/record.test.ts
```

---

## Task 8: The kit's `AuthorMark` and `TimelineItem`; styleguide; DESIGN.md (bis-frontend)

**Review:** sonnet. **Runs:** group A, beside Tasks 1 and 2. **messages.ts #1** (first in the chain).

**Files**
- Create: `apps/web/src/components/record/author-mark.tsx`, `author-mark.test.ts`
- Create: `apps/web/src/components/record/timeline-item.tsx`, `timeline-item.test.ts`
- Modify: `apps/web/src/components/record/record-card.tsx` (`RecordCardViewProps` `:50-56`, the two skeleton sites `:91`, `:96-97`, `RecordCardProps` `:108-111`, `RecordCard` `:114-126`) and `record-card.test.ts`
- Modify: `apps/web/src/app/(dashboard)/dashboard/styleguide/record-demo.tsx` and `record-demo.test.ts`
- Modify: `DESIGN.md` (Provenance paragraph)
- Modify: `apps/web/src/lib/messages.ts` (four keys + twins under `provenance.ai.es`, `:2409`)

**Interfaces**
- Consumes: `AuthorKind` (Task 1, type-only `import type { AuthorKind } from "@bis/db"`). At Task 8's start Task 1 may not have committed yet. If so, declare `type AuthorKind = "person" | "ai" | "automation" | "customer" | "import"` locally in `author-mark.tsx` with a `// replaced by @bis/db's AuthorKind once Task 1 lands` note. The Task 9 implementer swaps it for the import, and the reviewer checks that this happened.
- Produces:
  ```tsx
  export function AuthorMark(p: { kind: AuthorKind; label: string }): JSX.Element;      // data-author-mark={kind}
  export type TimelineTone = "accent" | "good" | "warn" | "crit" | "muted";
  export type TimelineItemProps = {
    kind: string; icon: ComponentType<{ className?: string }>;
    mark: { kind: AuthorKind; label: string };
    verb: ReactNode; status?: { tone: TimelineTone; word: string } | null; detail?: string | null;
    time: string; dateTime: string; action?: ReactNode; children?: ReactNode;
  };
  export function TimelineItem(p: TimelineItemProps): JSX.Element;                        // data-timeline-item={kind}
  export function TimelineItemSkeleton(p: { rows: number }): JSX.Element;                 // data-record-skeleton data-timeline-skeleton
  // RecordCardView / RecordCard gain `skeleton?: ReactNode`, used in place of RecordCardSkeleton when given.
  ```
  Keys: `provenance.customer`, `provenance.automation`, `provenance.import`, `provenance.you` (+ `.es`).

- [ ] **Step 1: Failing tests.** `apps/web/src/components/record/author-mark.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AuthorMark } from "./author-mark";

describe("AuthorMark (spec §6, DESIGN.md Provenance)", () => {
  it("carries its kind for tests and says who in a word, never colour alone (mutation: drop data-author-mark -> FAILS)", () => {
    const html = renderToStaticMarkup(createElement(AuthorMark, { kind: "customer", label: "Customer" }));
    expect(html).toContain('data-author-mark="customer"');
    expect(html).toContain(">Customer<");
  });
  it("is a pill on the chip tokens, never a hard-coded colour (mutation: bg-violet-500 -> FAILS)", () => {
    const html = renderToStaticMarkup(createElement(AuthorMark, { kind: "ai", label: "Sofía · AI" }));
    expect(html).toMatch(/class="[^"]*\brounded-full\b/);
    for (const token of ["--chip-line", "--chip-bg", "--chip-text"]) expect(html).toContain(token);
    expect(html).not.toMatch(/#[0-9a-f]{3,8}\b|\b(?:bg|text|border)-(?:violet|gray|zinc|slate|neutral)-\d/i);
  });
  it("a long name truncates with its full text in title (pseudo-locale +35%; mutation: drop title -> FAILS)", () => {
    const long = "Maximiliano Alejandro de la Garza Villarreal";
    const html = renderToStaticMarkup(createElement(AuthorMark, { kind: "person", label: long }));
    expect(html).toContain(`title="${long}"`);
    expect(html).toMatch(/class="[^"]*\btruncate\b/);
  });
});
```

`apps/web/src/components/record/timeline-item.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { CalendarCheck } from "lucide-react";
import { TimelineItem, TimelineItemSkeleton } from "./timeline-item";

const base = {
  kind: "booking", icon: CalendarCheck, mark: { kind: "customer" as const, label: "Customer" },
  verb: "booked an appointment for Thu, Oct 16, 10:00 AM", time: "Oct 9, 2026, 4:12 PM", dateTime: "2026-10-09T21:12:00Z",
};
const render = (over: Record<string, unknown> = {}, body?: unknown) =>
  renderToStaticMarkup(createElement(TimelineItem, { ...base, ...over } as never, body as never));

describe("TimelineItem: mark · verb · status · detail · time, then the body (spec §8, §9.4)", () => {
  it("reads in that order (mutation: put the time before the mark -> FAILS)", () => {
    const html = render({ status: { tone: "accent", word: "Booked" }, detail: "Moved from Tue, Oct 14, 9:00 AM" });
    const at = (s: string) => html.indexOf(s);
    expect(at('data-author-mark="customer"')).toBeGreaterThan(-1);
    expect(at('data-author-mark="customer"')).toBeLessThan(at("booked an appointment"));
    expect(at("booked an appointment")).toBeLessThan(at(">Booked<"));
    expect(at(">Booked<")).toBeLessThan(at("Moved from"));
    expect(at("Moved from")).toBeLessThan(at("Oct 9, 2026, 4:12 PM"));
    expect(html).toContain('data-timeline-item="booking"');
  });
  it("a status is a dot and a word (rule 3; mutation: drop the word -> FAILS; drop the dot -> FAILS)", () => {
    const html = render({ status: { tone: "warn", word: "No-show" } });
    expect(html).toContain('data-timeline-status="warn"');
    expect(html).toMatch(/<span aria-hidden="true" class="[^"]*\bbg-\[var\(--warn\)\][^"]*"><\/span><span>No-show<\/span>/);
  });
  it("no status draws no dot; the time is a <time> with its instant", () => {
    const html = render();
    expect(html).not.toContain("data-timeline-status");
    expect(html).toMatch(/<time[^>]*datetime="2026-10-09T21:12:00Z"/i);
  });
  it("renders the body under the head line and the action beside it (mutation: drop children -> FAILS)", () => {
    const html = render({ action: createElement("button", null, "done") }, createElement("p", null, "Gate code 4411"));
    expect(html.indexOf("Oct 9, 2026, 4:12 PM")).toBeLessThan(html.indexOf("Gate code 4411"));
    expect(html).toContain(">done<");
  });
});

describe("TimelineItemSkeleton (rule 7: shaped like a row, never a spinner)", () => {
  it("draws one mark-chip, line and time per row (mutation: render one generic bar -> FAILS)", () => {
    const html = renderToStaticMarkup(createElement(TimelineItemSkeleton, { rows: 5 }));
    expect(html).toContain("data-record-skeleton");
    expect(html.match(/data-timeline-skeleton-row/g)).toHaveLength(5);
    expect(html).not.toMatch(/animate-spin|spinner/i);
  });
});
```

Append to `record-card.test.ts`:

```ts
describe("RecordCard's skeleton slot (S-03 1b: the timeline loads as rows, not lines)", () => {
  it("a loading card draws the skeleton it is given, else its lines (mutation: ignore the prop -> FAILS)", () => {
    const custom = view({ state: "loading", skeleton: createElement("div", { "data-custom-skeleton": "" }) } as never);
    expect(custom).toContain("data-custom-skeleton");
    expect(view({ state: "loading" })).toContain("data-record-skeleton");
  });
});
```

- [ ] **Step 2: Run red.** `pnpm --filter web exec vitest run src/components/record` → the two new files fail to resolve their imports, and the skeleton-slot case fails (`expected … to contain 'data-custom-skeleton'`).

- [ ] **Step 3: Implement.** `apps/web/src/components/record/author-mark.tsx`:

```tsx
import type { AuthorKind } from "@bis/db";

/**
 * Who made a timeline row (spec §6; DESIGN.md, Provenance): one of five kinds, always said in a
 * word, never colour alone. AiAuthorMark's chip (calls/ai-author-mark.tsx) generalised: the chip
 * tokens, a 999px pill, the Label size. A long name truncates with its full text in `title`.
 */
export function AuthorMark({ kind, label }: { kind: AuthorKind; label: string }) {
  return (
    <span data-author-mark={kind} title={label}
      className="inline-flex max-w-[14rem] shrink-0 items-center rounded-full border border-[var(--chip-line)] bg-[var(--chip-bg)] px-1.5 text-[10px] leading-4 font-medium text-[var(--chip-text)]">
      <span className="truncate">{label}</span>
    </span>
  );
}
```

`apps/web/src/components/record/timeline-item.tsx`:

```tsx
import type { ComponentType, ReactNode } from "react";
import type { AuthorKind } from "@bis/db";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { AuthorMark } from "./author-mark";

export type TimelineTone = "accent" | "good" | "warn" | "crit" | "muted";
const DOT: Record<TimelineTone, string> = {
  accent: "bg-[var(--accent)]", good: "bg-[var(--good)]", warn: "bg-[var(--warn)]",
  crit: "bg-[var(--crit)]", muted: "bg-[var(--text-3)]",
};

export type TimelineItemProps = {
  /** The row kind, for tests and styling hooks (`data-timeline-item`). */
  kind: string;
  icon: ComponentType<{ className?: string }>;
  mark: { kind: AuthorKind; label: string };
  verb: ReactNode;
  status?: { tone: TimelineTone; word: string } | null;
  detail?: string | null;
  time: string;
  dateTime: string;
  action?: ReactNode;
  children?: ReactNode;
};

const Sep = () => <span aria-hidden="true" className="text-muted-foreground">·</span>;

/**
 * One timeline row (spec §8, §9.4): who · did what · status · detail · when, then the body. Rows sit
 * on `--row-line` rules inside the card (never a box in a glass card); the caller draws the rule.
 */
export function TimelineItem({ kind, icon: Icon, mark, verb, status, detail, time, dateTime, action, children }: TimelineItemProps) {
  return (
    <div data-timeline-item={kind} className="flex items-start gap-3 py-[7px]">
      <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-sm">
          <AuthorMark kind={mark.kind} label={mark.label} />
          <span className="min-w-0 break-words font-medium text-card-foreground">{verb}</span>
          {status ? (
            <>
              <Sep />
              <span data-timeline-status={status.tone} className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                <span aria-hidden="true" className={cn("size-[7px] shrink-0 rounded-full", DOT[status.tone])}></span><span>{status.word}</span>
              </span>
            </>
          ) : null}
          {detail ? (
            <>
              <Sep />
              <span className="text-xs text-muted-foreground tabular-nums">{detail}</span>
            </>
          ) : null}
          <Sep />
          <time dateTime={dateTime} className="text-xs text-muted-foreground tabular-nums">{time}</time>
        </p>
        {children ? <div className="mt-1 min-w-0">{children}</div> : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}

/** Rule 7: the timeline's loading rows, shaped like a row (icon, mark chip, line, time). */
export function TimelineItemSkeleton({ rows }: { rows: number }) {
  return (
    <div className="space-y-3" data-record-skeleton data-timeline-skeleton aria-hidden>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} data-timeline-skeleton-row className="flex items-start gap-3">
          <Skeleton className="size-4 shrink-0 rounded-[var(--radius-ctl)]" />
          <div className="min-w-0 flex-1 space-y-1.5">
            <div className="flex items-center gap-1.5">
              <Skeleton className="h-4 w-20 rounded-full" />
              <Skeleton className={cn("h-4 rounded-[var(--radius-ctl)]", i % 2 === 1 ? "w-1/3" : "w-1/2")} />
            </div>
            <Skeleton className="h-3 w-24 rounded-[var(--radius-ctl)]" />
          </div>
        </div>
      ))}
    </div>
  );
}
```

`record-card.tsx`: add `skeleton?: ReactNode;` to `RecordCardViewProps` and to `RecordCardProps`. In `RecordCardView`, replace both `<RecordCardSkeleton rows={p.skeletonRows} />` (the loading branch, `:91`, and the boundary's `skeleton` prop, `:97`) with `{p.skeleton ?? <RecordCardSkeleton rows={p.skeletonRows} />}` / `skeleton={p.skeleton ?? <RecordCardSkeleton rows={p.skeletonRows} />}`. In `RecordCard`, destructure `skeleton` and pass `skeleton={skeleton}` to `RecordCardView`.

- [ ] **Step 4: Run green.** `pnpm --filter web exec vitest run src/components/record` → all pass. Run each test's named probe and see it FAIL by name.

- [ ] **Step 5: Styleguide.** In `record-demo.tsx` add imports `import { CalendarCheck } from "lucide-react";`, `import { AuthorMark } from "@/components/record/author-mark";`, `import { TimelineItem, TimelineItemSkeleton } from "@/components/record/timeline-item";`, then above `export function RecordDemo`:

```tsx
// A specimen person's name: a variable, not a JSX literal (the i18n ratchet counts literals).
const PERSON = "Dan López";
const MARKS = [
  { kind: "person", label: PERSON },
  { kind: "ai", label: m["provenance.ai"].replace("{name}", "Sofía") },
  { kind: "automation", label: m["provenance.automation"] },
  { kind: "customer", label: m["provenance.customer"] },
  { kind: "import", label: m["provenance.import"] },
] as const;
```

and inside `RecordDemo`'s outer `div`, after the cards row:

```tsx
      <div data-sg-author-marks className="flex flex-wrap gap-2">
        {MARKS.map((mk) => <AuthorMark key={mk.kind} kind={mk.kind} label={mk.label} />)}
      </div>
      <div data-sg-timeline-item className="w-[420px] max-w-full rounded-xl border border-border bg-card glass px-4 py-2">
        <TimelineItem kind="booking" icon={CalendarCheck} mark={{ kind: "customer", label: m["provenance.customer"] }}
          verb={m["record.nextUp.booking"].replace("{when}", "Thu, Oct 16 · 10:00 AM")}
          status={{ tone: "accent", word: m["calendar.bookings.status.booked"] }}
          time="Oct 9, 2026, 4:12 PM" dateTime="2026-10-09T21:12:00Z" />
        <TimelineItemSkeleton rows={2} />
      </div>
```

Append to `record-demo.test.ts` inside its describe:

```ts
  it("AuthorMark in all five kinds and a TimelineItem with its skeleton (spec §15; mutation: drop the import mark -> FAILS)", () => {
    for (const kind of ["person", "ai", "automation", "customer", "import"]) expect(html).toContain(`data-author-mark="${kind}"`);
    expect(html).toContain(`>${m["provenance.customer"]}<`);
    expect(html).toContain('data-timeline-item="booking"');
    expect(html).toContain("data-timeline-skeleton");
  });
```

- [ ] **Step 6: DESIGN.md.** In "Record page, documents and provenance", append to the **Provenance.** paragraph, after "…who did it is never left to be inferred.", verbatim (spec §16.1):

```
A person the reader cannot name — someone who has left the team, or one
their role cannot see — reads "Someone on the team" ("Alguien del equipo");
it is still the person mark, never a sixth kind (decided 2026-10-12).
```

- [ ] **Step 7: Copy (messages.ts #1).** Directly under `"provenance.ai.es": "{name} · IA",` (`messages.ts:2409`):

```ts
  // The record timeline's author marks (S-03 1b, spec §6, §10.2): one closed set of five.
  "provenance.customer": "Customer",
  "provenance.customer.es": "Cliente",
  "provenance.automation": "Automation",
  "provenance.automation.es": "Automatización",
  "provenance.import": "Import",
  "provenance.import.es": "Importación",
  "provenance.you": "You",
  "provenance.you.es": "Usted",
```

- [ ] **Step 8: Green and the DoD.** `pnpm --filter web exec vitest run src/components/record "src/app/(dashboard)/dashboard/styleguide" src/lib/i18n src/lib/messages.test.ts` → all pass. `pnpm --filter web typecheck`; `pnpm --filter web exec eslint src/components/record "src/app/(dashboard)/dashboard/styleguide/record-demo.tsx"`. DoD by eye on `/styleguide` (orchestrator's dev server, or `pnpm --filter web dev` if the brief allows): the five marks and the row in dark and light (the `.dark` toggle), and under `@supports not (backdrop-filter)` (the card keeps `glass`, never blurred). The row wraps at 390px and with `?locale=pseudo`, never clips. Report what was checked.

- [ ] **Step 9: Commit.**

```bash
git add -- apps/web/src/components/record/author-mark.tsx apps/web/src/components/record/author-mark.test.ts apps/web/src/components/record/timeline-item.tsx apps/web/src/components/record/timeline-item.test.ts
git commit -m "feat(design): the record kit's author mark and timeline row, on the styleguide; Provenance names the unnamed person (S-03 1b)" -- apps/web/src/components/record/author-mark.tsx apps/web/src/components/record/author-mark.test.ts apps/web/src/components/record/timeline-item.tsx apps/web/src/components/record/timeline-item.test.ts apps/web/src/components/record/record-card.tsx apps/web/src/components/record/record-card.test.ts "apps/web/src/app/(dashboard)/dashboard/styleguide/record-demo.tsx" "apps/web/src/app/(dashboard)/dashboard/styleguide/record-demo.test.ts" DESIGN.md apps/web/src/lib/messages.ts
```

---

## Task 9: Who made each row, the row's words, and the pager (bis-crm)

**Review:** sonnet. **Runs:** group D, after Tasks 7 and 8. **messages.ts #5:** its Step 7 waits for Task 5's commit.

**Files**
- Create: `apps/web/src/lib/record/author-mark.ts`, `author-mark.test.ts`
- Create: `apps/web/src/lib/record/timeline-rows.ts`, `timeline-rows.test.ts`
- Create: `apps/web/src/lib/record/timeline-pager.ts`, `timeline-pager.test.ts`
- Modify: `apps/web/src/lib/cursor.ts` (append) and `apps/web/src/lib/cursor.test.ts`
- Modify: `apps/web/src/lib/messages.ts` (the `timeline.*` block + four twins)
- If Task 8 declared `AuthorKind` locally in `components/record/author-mark.tsx`, replace it with `import type { AuthorKind } from "@bis/db";`.

**Interfaces**
- Consumes: `TimelineEntry`, `TimelineSource`, `AuthorKind` (Tasks 1, 7, via `@bis/db` types); `TimelineTone` (Task 8); `makeTr`/`Tr` (`lib/record/copy.ts:9-22`); `encodeCursor`, `parseCursor` (`lib/cursor.ts:156`, `:166`).
- Produces:
  ```ts
  // lib/record/author-mark.ts
  export type AuthorMarkView = { kind: AuthorKind; label: string };
  export type AuthorCtx = { viewerId: string | null; names: Readonly<Record<string, string>>; personaName: string | null; tr: Tr };
  export function authorOf(entry: TimelineEntry): { kind: AuthorKind; personId: string | null };
  export function authorLabel(kind: AuthorKind, personId: string | null, ctx: AuthorCtx): string;
  export function authorMark(entry: TimelineEntry, ctx: AuthorCtx): AuthorMarkView;
  export function personIdsOf(entries: readonly TimelineEntry[]): string[];
  // lib/record/timeline-rows.ts
  export type TimelineStatus = { tone: TimelineTone; word: string };
  export type TimelineRow = { key: string; entry: TimelineEntry; day: string; showDay: boolean; time: string;
    mark: AuthorMarkView; verb: string; status: TimelineStatus | null; detail: string | null };
  export function timelineRows(entries: readonly TimelineEntry[], ctx: { zone: string; tr: Tr; author: AuthorCtx }): TimelineRow[];
  export function timelineFailedText(failed: readonly TimelineSource[], tr: Tr): string | null;
  // lib/record/timeline-pager.ts
  export const TIMELINE_ANCHOR = "record-timeline";
  export function timelinePagerHrefs(p: { basePath: string; older: { v: string; id: string } | null; paged: boolean; locale?: unknown }):
    { olderHref: string | null; newerHref: string | null };
  // lib/cursor.ts
  export function parseTimelineCursor(raw: string | undefined): { v: string; id: string } | undefined;
  ```

- [ ] **Step 1: Failing tests.** `apps/web/src/lib/record/author-mark.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import type { TimelineEntry } from "@bis/db";
import { authorOf, authorMark, personIdsOf, type AuthorCtx } from "./author-mark";
import { makeTr } from "./copy";

const AT = "2026-10-09T16:12:00+00:00";
const FIVE = ["person", "ai", "automation", "customer", "import"];
const task = (over: Record<string, unknown> = {}): TimelineEntry => ({ kind: "task", id: "t1", at: AT, task: {
  id: "t1", title: "x", due_at: null, completed_at: null, created_at: AT, consent_event_id: null, call_id: null,
  assigned_to: null, created_by: null, ...over } }) as unknown as TimelineEntry;
const message = (over: Record<string, unknown>): TimelineEntry => ({ kind: "message", id: "m1", at: AT, message: {
  id: "m1", channel: "sms", direction: "outbound", status: "sent", subject: null, body: "x", error: null, created_at: AT,
  author_kind: null, author_id: null, ...over } }) as unknown as TimelineEntry;
const booking = (author_kind: string | null): TimelineEntry => ({ kind: "booking", id: "b1", at: AT, booking: {
  id: "b1", created_at: AT, starts_at: AT, status: "booked", note: null, author_kind, author_id: null,
  rescheduled_from_id: null, moved_from_starts_at: null } as never });
const ENTRIES: [string, TimelineEntry, string][] = [
  ["note", { kind: "note", id: "n1", at: AT, note: { id: "n1", body: "x", author_id: "user_dan", created_at: AT } }, "person"],
  ["callback To-do", task({ call_id: "c1" }), "ai"],
  ["stop-hold To-do", task({ consent_event_id: "e1" }), "automation"],
  ["typed To-do", task({ created_by: "user_dan" }), "person"],
  ["deal", { kind: "deal", id: "d1", at: AT, deal: { id: "d1", name: "Deck", status: "open", monetary_value: 0, created_at: AT, created_by: null } }, "person"],
  ["web chat", { kind: "submission", id: "s1", at: AT, submission: { id: "s1", created_at: AT, formName: "Q", answers: [], author_kind: "ai" } }, "ai"],
  ["typed form", { kind: "submission", id: "s2", at: AT, submission: { id: "s2", created_at: AT, formName: "Q", answers: [], author_kind: "customer" } }, "customer"],
  ["inbound text, pre-0074", message({ direction: "inbound" }), "customer"],
  ["outbound text, pre-0074", message({}), "person"],
  ["recipe text", message({ author_kind: "automation" }), "automation"],
  ["staff email", message({ author_kind: "person", author_id: "user_dan", channel: "email" }), "person"],
  ["booking page", booking("customer"), "customer"],
  ["receptionist booking", booking("ai"), "ai"],
  ["booking, pre-0074", booking(null), "customer"],
  ["call", { kind: "call", id: "k1", at: AT, call: { id: "k1", started_at: AT, outcome: "booked", duration_secs: 60, reason: null, summary: "", language: "en" } }, "ai"],
];

const ctx = (over: Partial<AuthorCtx> = {}): AuthorCtx =>
  ({ viewerId: "user_me", names: { user_dan: "Dan López" }, personaName: null, tr: makeTr("en"), ...over });

describe("authorOf: every row kind and source gives spec §6's kind (mutation: mark a call 'automation' -> FAILS)", () => {
  it.each(ENTRIES)("%s", (_name, entry, kind) => {
    expect(authorOf(entry).kind).toBe(kind);
    expect(FIVE).toContain(authorMark(entry, ctx()).kind);
  });
});

describe("authorMark's words (spec §6 Names, D9, D10, D11)", () => {
  const note = (author_id: string | null): TimelineEntry => ({ kind: "note", id: "n", at: AT, note: { id: "n", body: "x", author_id, created_at: AT } });
  it("names a readable person, says You only for the viewer, and Someone on the team for anyone else (mutation: You for every person -> FAILS)", () => {
    expect(authorMark(note("user_dan"), ctx()).label).toBe("Dan López");
    expect(authorMark(note("user_me"), ctx()).label).toBe("You");
    expect(authorMark(note("user_gone"), ctx()).label).toBe("Someone on the team");
    expect(authorMark(note(null), ctx()).label).toBe("Someone on the team");
  });
  it("an id that names an Object property is not a name (mutation: read names[id] without hasOwn -> a function leaks in, FAILS)", () => {
    expect(authorMark(note("constructor"), ctx()).label).toBe("Someone on the team");
  });
  it("the receptionist is the account's persona, else Sofía; the rest are words (mutation: hard-code Sofía -> FAILS)", () => {
    const call = ENTRIES.find(([n]) => n === "call")![1];
    expect(authorMark(call, ctx({ personaName: "Lupita" })).label).toBe("Lupita · AI");
    expect(authorMark(call, ctx()).label).toBe("Sofía · AI");
    expect(authorMark(booking("customer"), ctx()).label).toBe("Customer");
    expect(authorMark(message({ author_kind: "automation" }), ctx()).label).toBe("Automation");
  });
  it("in Spanish (mutation: build labels from m[...] -> English, FAILS)", () => {
    const es = ctx({ tr: makeTr("es") });
    expect(authorMark(booking("customer"), es).label).toBe("Cliente");
    expect(authorMark(note("user_me"), es).label).toBe("Usted");
    expect(authorMark(note(null), es).label).toBe("Alguien del equipo");
    expect(authorMark(ENTRIES.find(([n]) => n === "call")![1], es).label).toBe("Sofía · IA");
  });
});

describe("personIdsOf: the ids one names read asks for (spec §6)", () => {
  it("only person marks, each once (mutation: include a callback To-do's created_by -> FAILS)", () => {
    const entries = [...ENTRIES.map(([, e]) => e), task({ call_id: "c9", created_by: "user_ai_shadow" })];
    expect(personIdsOf(entries).sort()).toEqual(["user_dan"]);
  });
});
```

`apps/web/src/lib/record/timeline-rows.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import type { TimelineEntry } from "@bis/db";
import { timelineRows, timelineFailedText } from "./timeline-rows";
import { makeTr } from "./copy";

const author = (locale: "en" | "es" = "en") => ({ viewerId: null, names: {}, personaName: null, tr: makeTr(locale) });
const rows = (entries: TimelineEntry[], locale: "en" | "es" = "en", zone = "America/Chicago") =>
  timelineRows(entries, { zone, tr: makeTr(locale), author: author(locale) });
const call = (secs: number | null, outcome = "booked"): TimelineEntry => ({ kind: "call", id: "k1", at: "2026-10-09T16:12:00Z",
  call: { id: "k1", started_at: "2026-10-09T16:12:00Z", outcome, duration_secs: secs, reason: null, summary: "", language: "es" } });
const booking = (status: string, moved: string | null = null): TimelineEntry => ({ kind: "booking", id: "b1", at: "2026-10-09T16:12:00Z",
  booking: { id: "b1", created_at: "2026-10-09T16:12:00Z", starts_at: "2026-10-16T15:00:00Z", status, note: null,
    author_kind: "customer", author_id: null, rescheduled_from_id: moved ? "b0" : null, moved_from_starts_at: moved } as never });
const sms = (direction: "inbound" | "outbound", status: string): TimelineEntry => ({ kind: "message", id: "m1", at: "2026-10-09T16:12:00Z",
  message: { id: "m1", channel: "sms", direction, status, subject: null, body: "x", error: null, created_at: "2026-10-09T16:12:00Z",
    author_kind: direction === "inbound" ? "customer" : "person", author_id: null } });

describe("timelineRows: each kind's words (spec §6, §10.2)", () => {
  it("a booking reads booked an appointment for its start, in the account's zone, with a dot-and-word status (mutation: format the start in UTC -> 3:00 PM, FAILS)", () => {
    const [r] = rows([booking("booked")]);
    expect(r!.verb).toBe("booked an appointment for Fri, Oct 16, 10:00 AM");
    expect(r!.status).toEqual({ tone: "accent", word: "Booked" });
    expect(r!.mark.label).toBe("Customer");
  });
  it("a reschedule says where it moved from (mutation: drop the detail -> FAILS)", () => {
    expect(rows([booking("booked", "2026-10-14T14:00:00Z")])[0]!.detail).toBe("Moved from Wed, Oct 14, 9:00 AM");
  });
  it("a call: answered, its outcome as a dot and a word, and whole minutes (mutation: Math.floor -> 2 min, FAILS)", () => {
    const [r] = rows([call(150)]);
    expect([r!.verb, r!.status, r!.detail, r!.mark.label]).toEqual(["answered a call", { tone: "good", word: "Booked" }, "3 min", "Sofía · AI"]);
    expect(rows([call(null)])[0]!.detail).toBeNull();
  });
  it("an outbound text shows its delivery state; an inbound one shows none (mutation: status on inbound -> FAILS)", () => {
    expect(rows([sms("outbound", "failed")])[0]!.status).toEqual({ tone: "crit", word: "Failed" });
    expect(rows([sms("inbound", "delivered")])[0]!.status).toBeNull();
    expect(rows([sms("outbound", "brand_new")])[0]!.status).toEqual({ tone: "muted", word: "brand_new" });
  });
  it("in Spanish (mutation: read the words from m[...] -> English, FAILS)", () => {
    const [b] = rows([booking("booked")], "es");
    expect(b!.verb.startsWith("agendó una cita para ")).toBe(true);
    expect(b!.status!.word).toBe("Agendada");
    expect(rows([call(60, "abandoned")], "es")[0]!.status!.word).toBe("Colgó");
    expect(rows([sms("outbound", "delivered")], "es")[0]!.verb).toBe("mandó un texto");
  });
  it("a day separator falls on the ACCOUNT's calendar day (mutation: compute the day in UTC -> one separator, FAILS)", () => {
    const at = (iso: string): TimelineEntry => ({ kind: "note", id: iso, at: iso, note: { id: iso, body: "x", author_id: null, created_at: iso } });
    // 05:30Z is Oct 9, 00:30 in Chicago; 03:00Z is still Oct 8 there. One UTC day, two Chicago days.
    expect(rows([at("2026-10-09T05:30:00Z"), at("2026-10-09T03:00:00Z")]).map((r) => r.showDay)).toEqual([true, true]);
    expect(rows([at("2026-10-09T05:30:00Z"), at("2026-10-09T03:00:00Z")], "en", "UTC").map((r) => r.showDay)).toEqual([true, false]);
  });
});

describe("timelineFailedText (spec §9.4: some sources failed)", () => {
  it("names what could not be read, in the page's language (mutation: name only the first -> FAILS)", () => {
    expect(timelineFailedText(["calls", "bookings"], makeTr("en"))).toBe("Couldn't load calls and bookings.");
    expect(timelineFailedText(["calls", "bookings"], makeTr("es"))).toBe("No se pudo cargar: llamadas y citas.");
    expect(timelineFailedText([], makeTr("en"))).toBeNull();
  });
});
```

`apps/web/src/lib/record/timeline-pager.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { timelinePagerHrefs, TIMELINE_ANCHOR } from "./timeline-pager";
import { parseTimelineCursor } from "@/lib/cursor";

const BASE = "/dashboard/accounts/a1/contacts/c1";
const OLDER = { v: "2026-10-09T16:12:00.123456+00:00", id: "0f8a7b2c-1d2e-4f3a-8b4c-5d6e7f8a9b0c" };

describe("timelinePagerHrefs: one pager, Older carries ?before=, Newer goes back to the head (spec C3)", () => {
  it("Older's cursor round-trips exactly; Newer appears only on a paged view (mutation: always offer Newer -> FAILS)", () => {
    const head = timelinePagerHrefs({ basePath: BASE, older: OLDER, paged: false });
    const url = new URL(head.olderHref!, "https://x.test");
    expect(url.pathname).toBe(BASE);
    expect(url.hash).toBe(`#${TIMELINE_ANCHOR}`);
    expect(parseTimelineCursor(url.searchParams.get("before") ?? undefined)).toEqual(OLDER);
    expect(head.newerHref).toBeNull();
    const paged = timelinePagerHrefs({ basePath: BASE, older: null, paged: true });
    expect(paged).toEqual({ olderHref: null, newerHref: `${BASE}#${TIMELINE_ANCHOR}` });
  });
  it("keeps the QA locale override and nothing else (mutation: forward any locale string -> FAILS)", () => {
    expect(timelinePagerHrefs({ basePath: BASE, older: null, paged: true, locale: "es" }).newerHref).toBe(`${BASE}?locale=es#${TIMELINE_ANCHOR}`);
    expect(timelinePagerHrefs({ basePath: BASE, older: null, paged: true, locale: "\"><script>" }).newerHref).toBe(`${BASE}#${TIMELINE_ANCHOR}`);
    expect(timelinePagerHrefs({ basePath: BASE, older: null, paged: true, locale: ["es", "es"] }).newerHref).toBe(`${BASE}#${TIMELINE_ANCHOR}`);
  });
});
```

Append to `apps/web/src/lib/cursor.test.ts`:

```ts
describe("parseTimelineCursor (S-03 1b, spec §11: a ?before= that does not parse is a cold start)", () => {
  const ID = "0f8a7b2c-1d2e-4f3a-8b4c-5d6e7f8a9b0c";
  it("round-trips a timestamp cursor exactly, never reformatting it", () => {
    const c = { v: "2026-10-09T16:12:00.123456+00:00", id: ID };
    expect(parseTimelineCursor(encodeCursor(c))).toEqual(c);
  });
  it("anything but a zoned timestamp and a uuid is a cold start (mutation: return parseCursor's result as is -> free text passes, FAILS)", () => {
    for (const v of [null, "Garcia", "2026-10-09", "2026-10-09T16:12", "2026-10-09T16:12:00"]) {
      expect(parseTimelineCursor(encodeCursor({ v, id: ID })), String(v)).toBeUndefined();
    }
    expect(parseTimelineCursor(["a", "b"] as unknown as string)).toBeUndefined();
    expect(parseTimelineCursor("not-base64-json")).toBeUndefined();
  });
});
```

(Add `parseTimelineCursor` to the file's import from `./cursor`.)

- [ ] **Step 2: Run red.** `pnpm --filter web exec vitest run src/lib/record/author-mark.test.ts src/lib/record/timeline-rows.test.ts src/lib/record/timeline-pager.test.ts src/lib/cursor.test.ts` → the three new files fail on their missing modules; `parseTimelineCursor is not a function`.

- [ ] **Step 3: Implement `apps/web/src/lib/record/author-mark.ts`:**

```ts
import type { AuthorKind, TimelineEntry } from "@bis/db";
import type { Tr } from "./copy";

export type AuthorMarkView = { kind: AuthorKind; label: string };
/** `viewerId` is the signed-in person's Clerk id (requireAccountAccess's userId), the same id every
 *  person column stores; `names` comes from ONE listPeopleNames read on the request client. */
export type AuthorCtx = { viewerId: string | null; names: Readonly<Record<string, string>>; personaName: string | null; tr: Tr };

/**
 * Who made a row (spec §6): the kind, from the row's own columns (0073), and the person to name.
 * A NULL author_kind exists only for a row the build before 1b wrote, until 0074; it reads as the
 * backfill's own default (an inbound message the customer's, an outbound one a person's, D9; a
 * booking the customer's, the booking page being its common maker).
 */
export function authorOf(entry: TimelineEntry): { kind: AuthorKind; personId: string | null } {
  switch (entry.kind) {
    case "note": return { kind: "person", personId: entry.note.author_id };
    case "task":
      if (entry.task.call_id) return { kind: "ai", personId: null };
      if (entry.task.consent_event_id) return { kind: "automation", personId: null };
      return { kind: "person", personId: entry.task.created_by };
    case "deal": return { kind: "person", personId: entry.deal.created_by };
    case "submission": return { kind: entry.submission.author_kind, personId: null };
    case "message": {
      const kind = entry.message.author_kind ?? (entry.message.direction === "inbound" ? "customer" : "person");
      return { kind, personId: kind === "person" ? entry.message.author_id : null };
    }
    case "booking": {
      const kind = entry.booking.author_kind ?? "customer";
      return { kind, personId: kind === "person" ? entry.booking.author_id : null };
    }
    case "call": return { kind: "ai", personId: null };
  }
}

/** The mark's word. A person the reader cannot name (a departed member, the agency read by a client,
 *  a seed) is "Someone on the team", still the person mark (D10, D11); never a sixth kind. */
export function authorLabel(kind: AuthorKind, personId: string | null, ctx: AuthorCtx): string {
  const { tr } = ctx;
  switch (kind) {
    case "person": {
      if (personId && ctx.viewerId && personId === ctx.viewerId) return tr.text("provenance.you");
      const named = personId && Object.hasOwn(ctx.names, personId) ? ctx.names[personId] : undefined;
      return named || tr.text("assign.someone");
    }
    case "ai": return tr.text("provenance.ai", { name: ctx.personaName?.trim() || "Sofía" });
    case "automation": return tr.text("provenance.automation");
    case "customer": return tr.text("provenance.customer");
    case "import": return tr.text("provenance.import");
  }
}

export function authorMark(entry: TimelineEntry, ctx: AuthorCtx): AuthorMarkView {
  const { kind, personId } = authorOf(entry);
  return { kind, label: authorLabel(kind, personId, ctx) };
}

/** The distinct person ids a page's marks name: what the one names read asks for. */
export function personIdsOf(entries: readonly TimelineEntry[]): string[] {
  const ids = new Set<string>();
  for (const entry of entries) {
    const { kind, personId } = authorOf(entry);
    if (kind === "person" && personId) ids.add(personId);
  }
  return [...ids];
}
```

- [ ] **Step 4: Implement `apps/web/src/lib/record/timeline-rows.ts`:**

```ts
import type { TimelineEntry, TimelineSource } from "@bis/db";
import type { TimelineTone } from "@/components/record/timeline-item";
import { formatCurrency, formatDateInZone, formatDateTimeInZone } from "@/lib/format";
import type { MessageKey } from "@/lib/messages";
import { authorMark, type AuthorCtx, type AuthorMarkView } from "./author-mark";
import type { Tr } from "./copy";

export type TimelineStatus = { tone: TimelineTone; word: string };
/** One row as the timeline draws it (spec §9.4): the grammar's parts, already in the page's language. */
export type TimelineRow = {
  key: string; entry: TimelineEntry; day: string; showDay: boolean; time: string;
  mark: AuthorMarkView; verb: string; status: TimelineStatus | null; detail: string | null;
};

type StatusMap = Readonly<Record<string, readonly [MessageKey, TimelineTone]>>;
const MESSAGE_STATUS: StatusMap = {
  queued: ["conversations.status.queued", "muted"], sent: ["conversations.status.sent", "accent"],
  delivered: ["conversations.status.delivered", "good"], opened: ["conversations.status.opened", "good"],
  bounced: ["conversations.status.bounced", "crit"], failed: ["conversations.status.failed", "crit"],
};
const BOOKING_STATUS: StatusMap = {
  booked: ["calendar.bookings.status.booked", "accent"], completed: ["calendar.bookings.status.completed", "good"],
  cancelled: ["calendar.bookings.status.cancelled", "muted"], no_show: ["calendar.bookings.status.no_show", "warn"],
};
const CALL_OUTCOME: StatusMap = {
  booked: ["calls.outcome.booked", "good"], lead: ["calls.outcome.lead", "accent"], message: ["calls.outcome.message", "accent"],
  abandoned: ["calls.outcome.abandoned", "muted"], spam: ["calls.outcome.spam", "muted"], transferred: ["calls.outcome.transferred", "accent"],
};
const DEAL_STATUS: StatusMap = {
  open: ["pipeline.status.open", "accent"], won: ["pipeline.status.won", "good"], lost: ["pipeline.status.lost", "muted"],
};
const SOURCE_KEY: Record<TimelineSource, MessageKey> = {
  notes: "timeline.what.notes", todos: "timeline.what.todos", deals: "timeline.what.deals", forms: "timeline.what.forms",
  messages: "timeline.what.messages", bookings: "timeline.what.bookings", calls: "timeline.what.calls",
};

/** A known value is a dot and a word (rule 3); an unmapped future one still shows, as itself (D-014). */
function statusOf(map: StatusMap, value: string, tr: Tr): TimelineStatus {
  const hit = Object.hasOwn(map, value) ? map[value] : undefined;
  return hit ? { tone: hit[1], word: tr.text(hit[0]) } : { tone: "muted", word: value };
}

/** "Thu, Oct 16, 10:00 AM" in the account's zone and the page's language. */
function whenText(iso: string, zone: string, tr: Tr): string {
  return new Intl.DateTimeFormat(tr.locale === "es" ? "es-US" : "en-US", {
    timeZone: zone, weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
  }).format(new Date(iso));
}

function phrase(entry: TimelineEntry, mark: AuthorMarkView, zone: string, tr: Tr): Pick<TimelineRow, "verb" | "status" | "detail"> {
  switch (entry.kind) {
    case "note": return { verb: tr.text("timeline.note"), status: null, detail: null };
    case "task": return { verb: tr.text(entry.task.call_id ? "timeline.callbackTodo" : "timeline.todo"), status: null, detail: null };
    case "deal": return {
      verb: tr.text("timeline.deal", { name: entry.deal.name }),
      status: statusOf(DEAL_STATUS, entry.deal.status, tr),
      detail: formatCurrency(Number(entry.deal.monetary_value), tr.locale),
    };
    case "submission": return {
      verb: mark.kind === "ai" ? tr.text("timeline.chat") : tr.text("timeline.form", { form: entry.submission.formName }),
      status: null, detail: null,
    };
    case "message": return {
      verb: tr.text(entry.message.channel === "sms" ? "timeline.texted" : "timeline.emailed"),
      // Only an outbound message has a delivery state worth a word: "sent" is what the provider took.
      status: entry.message.direction === "outbound" ? statusOf(MESSAGE_STATUS, entry.message.status, tr) : null,
      detail: null,
    };
    case "booking": return {
      verb: tr.text("timeline.booked", { when: whenText(entry.booking.starts_at, zone, tr) }),
      status: statusOf(BOOKING_STATUS, entry.booking.status, tr),
      detail: entry.booking.moved_from_starts_at
        ? tr.text("timeline.movedFrom", { when: whenText(entry.booking.moved_from_starts_at, zone, tr) }) : null,
    };
    case "call": return {
      verb: tr.text("timeline.answeredCall"),
      status: statusOf(CALL_OUTCOME, entry.call.outcome, tr),
      detail: entry.call.duration_secs ? tr.text("timeline.minutes", { count: Math.max(1, Math.round(entry.call.duration_secs / 60)) }) : null,
    };
  }
}

/**
 * The page's rows (spec §9.4), newest first as the merge returned them, each under a day separator
 * in the ACCOUNT's zone (D-010). Pure; THROWS on a malformed instant, so the page builds it inside
 * its view guard (C5): a bad row costs the timeline card, never the page.
 */
export function timelineRows(entries: readonly TimelineEntry[], ctx: { zone: string; tr: Tr; author: AuthorCtx }): TimelineRow[] {
  let previousDay: string | null = null;
  return entries.map((entry) => {
    const day = formatDateInZone(entry.at, ctx.zone, ctx.tr.locale);
    const mark = authorMark(entry, ctx.author);
    const row: TimelineRow = {
      key: `${entry.kind}-${entry.id}`, entry, day, showDay: day !== previousDay,
      time: formatDateTimeInZone(entry.at, ctx.zone, ctx.tr.locale), mark, ...phrase(entry, mark, ctx.zone, ctx.tr),
    };
    previousDay = day;
    return row;
  });
}

/** "Couldn't load calls and bookings." for the sources that failed; null when none did. */
export function timelineFailedText(failed: readonly TimelineSource[], tr: Tr): string | null {
  if (failed.length === 0) return null;
  const what = new Intl.ListFormat(tr.locale === "es" ? "es-US" : "en-US", { type: "conjunction" })
    .format(failed.map((s) => tr.text(SOURCE_KEY[s])));
  return tr.text("timeline.someFailed", { what });
}
```

- [ ] **Step 5: Implement the pager and the cursor parse.** `apps/web/src/lib/record/timeline-pager.ts`:

```ts
import { encodeCursor } from "@/lib/cursor";

/** The timeline card's own anchor, so Older and Newer land on the rows, not the page top. */
export const TIMELINE_ANCHOR = "record-timeline";
// The QA override (request-locale.ts); anything else on the URL is dropped, never echoed.
const QA_LOCALES = new Set(["en", "es", "pseudo"]);

/**
 * One pager (DESIGN.md, Paged lists; spec C3): "Older" carries `?before=` (the merge's own cursor),
 * "Newer" returns to the head (contacts/page.tsx's buildNewerHref idiom). Built with URLSearchParams.
 */
export function timelinePagerHrefs(p: { basePath: string; older: { v: string; id: string } | null; paged: boolean; locale?: unknown }):
  { olderHref: string | null; newerHref: string | null } {
  const keep: Record<string, string> = typeof p.locale === "string" && QA_LOCALES.has(p.locale) ? { locale: p.locale } : {};
  const href = (extra: Record<string, string>) => {
    const qs = new URLSearchParams({ ...keep, ...extra }).toString();
    return `${p.basePath}${qs ? `?${qs}` : ""}#${TIMELINE_ANCHOR}`;
  };
  return {
    olderHref: p.older ? href({ before: encodeCursor(p.older) }) : null,
    newerHref: p.paged ? href({}) : null,
  };
}
```

Append to `apps/web/src/lib/cursor.ts`:

```ts
// The record timeline's cursor (S-03 1b, spec C3): a RowCursor whose `v` is a zoned timestamp, the
// same shape packages/db's timeline-cursor.ts validates before building a filter.
const TIMELINE_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/;

/** TOTAL, like its siblings: anything but a zoned timestamp paired with a uuid is a cold start. */
export function parseTimelineCursor(raw: string | undefined): { v: string; id: string } | undefined {
  const c = parseCursor(raw);
  if (!c || c.v === null || !TIMELINE_INSTANT.test(c.v) || Number.isNaN(Date.parse(c.v))) return undefined;
  return { v: c.v, id: c.id };
}
```

- [ ] **Step 6: Run what can be green before the copy lands.** Same command as Step 2. `author-mark.test.ts` and `timeline-pager.test.ts` and `cursor.test.ts` pass after Step 7 at the latest. `timeline-rows.test.ts` fails until the `timeline.*` keys exist (`t()` falls back to the raw key, so a typed key is a compile error: `pnpm --filter web typecheck` reports `"timeline.note"` is not a `MessageKey`). That is the red for the copy.

- [ ] **Step 7: Copy (messages.ts #5: only after Task 5 committed).** Append just above `} as const;`:

```ts
  // S-03 part 1, 1b (spec §10.2): the record timeline's rows, notices and pager.
  "timeline.note": "added a note",
  "timeline.note.es": "agregó una nota",
  "timeline.todo": "added a To-do",
  "timeline.todo.es": "agregó un pendiente",
  "timeline.callbackTodo": "left a callback To-do",
  "timeline.callbackTodo.es": "dejó un pendiente para devolver la llamada",
  "timeline.deal": "added a deal: {name}",
  "timeline.deal.es": "agregó una oportunidad: {name}",
  "timeline.form": "sent the {form} form",
  "timeline.form.es": "envió el formulario {form}",
  "timeline.chat": "took a request in the website chat",
  "timeline.chat.es": "tomó una solicitud en el chat del sitio web",
  "timeline.texted": "texted",
  "timeline.texted.es": "mandó un texto",
  "timeline.emailed": "emailed",
  "timeline.emailed.es": "mandó un correo",
  "timeline.booked": "booked an appointment for {when}",
  "timeline.booked.es": "agendó una cita para {when}",
  "timeline.movedFrom": "Moved from {when}",
  "timeline.movedFrom.es": "Se movió del {when}",
  "timeline.answeredCall": "answered a call",
  "timeline.answeredCall.es": "contestó una llamada",
  "timeline.openCall": "Open call",
  "timeline.openCall.es": "Ver llamada",
  "timeline.minutes": "{count} min",
  "timeline.minutes.es": "{count} min",
  "timeline.empty": "Texts, calls, bookings, notes and To-dos with this customer show up here.",
  "timeline.empty.es": "Aquí aparecen los textos, llamadas, citas, notas y pendientes con este cliente.",
  "timeline.someFailed": "Couldn't load {what}.",
  "timeline.someFailed.es": "No se pudo cargar: {what}.",
  "timeline.what.calls": "calls",
  "timeline.what.calls.es": "llamadas",
  "timeline.what.bookings": "bookings",
  "timeline.what.bookings.es": "citas",
  "timeline.what.messages": "texts and emails",
  "timeline.what.messages.es": "textos y correos",
  "timeline.what.notes": "notes",
  "timeline.what.notes.es": "notas",
  "timeline.what.todos": "To-dos",
  "timeline.what.todos.es": "pendientes",
  "timeline.what.deals": "deals",
  "timeline.what.deals.es": "oportunidades",
  "timeline.what.forms": "forms",
  "timeline.what.forms.es": "formularios",
  "timeline.older": "Older",
  "timeline.older.es": "Anteriores",
  "timeline.newer": "Newer",
  "timeline.newer.es": "Más recientes",
  "timeline.pages": "Pages",
  "timeline.pages.es": "Páginas",
```

and these twins directly under their English keys: `"contact.tasks.es": "Pendientes",` (`:663`), `"contact.addTask.es": "Nuevo pendiente…",` (`:665`), `"contact.done.es": "listo",` (`:666`), `"todo.consent.timelineHint.es": "Ciérrelo desde la página de Pendientes.",` (`:824`).

- [ ] **Step 8: Green.** `pnpm --filter web exec vitest run src/lib/record src/lib/cursor.test.ts src/lib/i18n src/lib/messages.test.ts` → all pass. `pnpm --filter web typecheck` → no errors. Run every probe named in the four files' titles, see each FAIL by name, revert.

- [ ] **Step 9: Commit.**

```bash
git add -- apps/web/src/lib/record/author-mark.ts apps/web/src/lib/record/author-mark.test.ts apps/web/src/lib/record/timeline-rows.ts apps/web/src/lib/record/timeline-rows.test.ts apps/web/src/lib/record/timeline-pager.ts apps/web/src/lib/record/timeline-pager.test.ts
git commit -m "feat(contacts): who made each timeline row, its words in English and Spanish, and one pager (S-03 1b)" -- apps/web/src/lib/record/author-mark.ts apps/web/src/lib/record/author-mark.test.ts apps/web/src/lib/record/timeline-rows.ts apps/web/src/lib/record/timeline-rows.test.ts apps/web/src/lib/record/timeline-pager.ts apps/web/src/lib/record/timeline-pager.test.ts apps/web/src/lib/cursor.ts apps/web/src/lib/cursor.test.ts apps/web/src/lib/messages.ts apps/web/src/components/record/author-mark.tsx
```

(Drop `apps/web/src/components/record/author-mark.tsx` from the path list if Task 8 already imported `AuthorKind` from `@bis/db`.)

---

## Task 10: The timeline on the kit, its loader, the page (bis-crm)

**Review:** opus. **Runs:** group E, after Tasks 3 and 9 (and so after everything above).

**Files**
- Modify (rewrite): `…/contacts/[contactId]/activity-timeline.tsx`
- Create: `…/contacts/[contactId]/activity-timeline.fixture.ts`, `activity-timeline.rows.test.ts`
- Modify: the nine `…/contacts/[contactId]/activity-timeline.{assignee,callback,due-date,failure-reason,hold,item-zone,message-status,note,order}.test.ts` (one call each)
- Modify: `apps/web/src/lib/record/loaders.ts` (`loadTimeline` `:39-74`; imports `:1-7`) and `loaders.test.ts`
- Modify: `…/contacts/[contactId]/page.tsx` and `page.test.ts`
- Modify: `…/contacts/[contactId]/loading.tsx` and `loading.test.ts`

**Interfaces**
- Consumes: `listContactTimelinePage`, `listPeopleNames`, `TIMELINE_SOURCES`, `getVoiceProfile`, `holdOpenTaskIds`, `TimelinePage`, `TimelineCursor` (`@bis/db`); `timelineRows`, `timelineFailedText`, `TimelineRow` (Task 9); `personIdsOf` (Task 9); `timelinePagerHrefs`, `TIMELINE_ANCHOR` (Task 9); `parseTimelineCursor` (Task 9); `TimelineItem`, `TimelineItemSkeleton` (Task 8); `RecordCardRetry` (`record-card.tsx:29-36`); the bilingual `composerStateLine`/`composerEmailNotice`/`messageFailureReason` (Task 3).
- Produces:
  ```ts
  // loaders.ts
  export type TimelineLoad =
    | { status: "ready"; page: TimelinePage; holdOpen: string[]; names: Record<string, string>; personaName: string | null }
    | { status: "error" };
  export async function loadTimeline(db, ledger, accountId, contactId, before?: TimelineCursor): Promise<TimelineLoad>;
  // activity-timeline.tsx
  export type ActivityTimelineProps = {
    accountId: string; contactId: string; contactHasEmail: boolean; contactHasPhone: boolean;
    smsGate: SmsGate | null; smsBlockedLine: string | null; emailNoticeLine: string | null;
    emailAction: (fd: FormData) => Promise<void>; smsAction: (fd: FormData) => Promise<void>;
    timezone: string; canAssign?: boolean; members?: AssignMember[];
    rows: TimelineRow[]; holdOpenTaskIds: string[]; failedText: string | null; emptyText: string | null;
    pager: { olderHref: string | null; newerHref: string | null }; tr: Tr;
  };
  // activity-timeline.fixture.ts (tests only)
  export function legacyTimeline(props: Record<string, unknown>): ActivityTimelineProps;
  ```

- [ ] **Step 1: The test fixture, so today's nine row tests keep testing the same behaviour.** Create `…/contacts/[contactId]/activity-timeline.fixture.ts`:

```ts
import type { TimelineEntry } from "@bis/db";
import type { SmsGate } from "@/lib/sms/sender";
import type { AssignMember } from "@/lib/assign/view";
import type { Locale } from "@/lib/i18n/locale";
import { makeTr } from "@/lib/record/copy";
import { timelineRows } from "@/lib/record/timeline-rows";
import type { ActivityTimelineProps } from "./activity-timeline";

/**
 * TESTS ONLY. The nine activity-timeline.*.test.ts files were written against 1a's props (one array
 * per source). This turns those props into 1b's (merged entries → rows), so each file keeps pinning
 * the same behaviour (hold hint, due date zone, failure reason, status words…) with a one-call change.
 */
type Row = Record<string, unknown> & { id: string; created_at: string };
const list = (v: unknown) => (Array.isArray(v) ? (v as Row[]) : []);

export function entriesOf(p: Record<string, unknown>): TimelineEntry[] {
  const out = [
    ...list(p.notes).map((n) => ({ kind: "note", id: n.id, at: n.created_at, note: { author_id: null, ...n } })),
    ...list(p.tasks).map((t) => ({ kind: "task", id: t.id, at: t.created_at, task: {
      due_at: null, completed_at: null, consent_event_id: null, call_id: null, assigned_to: null, created_by: null, ...t } })),
    ...list(p.opportunities).map((o) => ({ kind: "deal", id: o.id, at: o.created_at, deal: { created_by: null, ...o } })),
    ...list(p.submissions).map((s) => ({ kind: "submission", id: s.id, at: s.created_at, submission: {
      formName: "", answers: [], author_kind: "customer", ...s } })),
    ...list(p.messages).map((m) => ({ kind: "message", id: m.id, at: m.created_at, message: {
      channel: "email", subject: null, error: null, author_kind: null, author_id: null, ...m } })),
  ] as unknown as TimelineEntry[];
  return out.sort((a, b) => Date.parse(b.at) - Date.parse(a.at) || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0));
}

export function legacyTimeline(p: Record<string, unknown>): ActivityTimelineProps {
  const timezone = (p.timezone as string | undefined) ?? "UTC";
  const tr = makeTr((p.locale as Locale | undefined) ?? "en");
  const rows = timelineRows(entriesOf(p), { zone: timezone, tr, author: { viewerId: null, names: {}, personaName: null, tr } });
  return {
    accountId: p.accountId as string, contactId: p.contactId as string,
    contactHasEmail: Boolean(p.contactHasEmail), contactHasPhone: Boolean(p.contactHasPhone),
    smsGate: (p.smsGate ?? null) as SmsGate | null,
    smsBlockedLine: (p.smsBlockedLine ?? null) as string | null, emailNoticeLine: (p.emailNoticeLine ?? null) as string | null,
    emailAction: p.emailAction as ActivityTimelineProps["emailAction"], smsAction: p.smsAction as ActivityTimelineProps["smsAction"],
    timezone, canAssign: Boolean(p.canAssign), members: (p.members ?? []) as AssignMember[],
    rows, holdOpenTaskIds: (p.holdOpenTaskIds ?? []) as string[],
    failedText: null, emptyText: rows.length === 0 ? tr.text("timeline.empty") : null,
    pager: { olderHref: null, newerHref: null }, tr,
  };
}
```

In each of the nine files, change only the props expression passed to `createElement(ActivityTimeline, …)`: `createElement(ActivityTimeline, { … } as never)` becomes `createElement(ActivityTimeline, legacyTimeline({ … }) as never)`. Under the existing `const { ActivityTimeline } = await import("./activity-timeline");` add `const { legacyTimeline } = await import("./activity-timeline.fixture");`. Change nothing else in those files. In particular, no assertion moves. If an assertion fails after the rewrite, the rewrite changed behaviour: fix the component, not the test.

- [ ] **Step 2: The new row test** `…/contacts/[contactId]/activity-timeline.rows.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { TimelineEntry } from "@bis/db";

vi.mock("./actions", () => ({ addNoteAction: vi.fn(), addTaskAction: vi.fn(), completeTaskAction: vi.fn() }));
vi.mock("./message-composer", () => ({ MessageComposer: () => null }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

const { ActivityTimeline } = await import("./activity-timeline");
const { legacyTimeline } = await import("./activity-timeline.fixture");
const { makeTr } = await import("@/lib/record/copy");
const { timelineRows } = await import("@/lib/record/timeline-rows");

const AT = "2026-10-09T16:12:00Z";
const ENTRIES: TimelineEntry[] = [
  { kind: "call", id: "k1", at: AT, call: { id: "k1", started_at: AT, outcome: "booked", duration_secs: 180, reason: "Se le gotea el techo", summary: "", language: "es" } },
  { kind: "booking", id: "b1", at: AT, booking: { id: "b1", created_at: AT, starts_at: "2026-10-16T15:00:00Z", status: "booked", note: null,
    author_kind: "customer", author_id: null, rescheduled_from_id: null, moved_from_starts_at: null } },
  { kind: "message", id: "m1", at: AT, message: { id: "m1", channel: "email", direction: "outbound", status: "delivered", subject: "Quote",
    body: "Here it is", error: null, created_at: AT, author_kind: "person", author_id: "user_dan" } },
  { kind: "deal", id: "d1", at: AT, deal: { id: "d1", name: "Deck build", status: "open", monetary_value: 2400, created_at: AT, created_by: null } },
  { kind: "note", id: "n1", at: AT, note: { id: "n1", body: "Gate code 4411", author_id: "user_me", created_at: AT } },
];
const render = (over: Record<string, unknown> = {}, locale: "en" | "es" = "en") => {
  const tr = makeTr(locale);
  const rows = timelineRows(ENTRIES, { zone: "America/Chicago", tr, author: { viewerId: "user_me", names: { user_dan: "Dan López" }, personaName: null, tr } });
  const base = legacyTimeline({ accountId: "a1", contactId: "c1", timezone: "America/Chicago", locale, emailAction: async () => {}, smsAction: async () => {} });
  return renderToStaticMarkup(createElement(ActivityTimeline, { ...base, rows, emptyText: null, ...over } as never));
};

describe("the 1b timeline (spec §6, §9.4)", () => {
  it("every row carries an author mark: a row with no mark is a defect (DESIGN.md Provenance; mutation: render the deal row without its mark -> FAILS)", () => {
    const html = render();
    const items = html.match(/data-timeline-item="/g) ?? [];
    expect(items).toHaveLength(ENTRIES.length);
    expect(html.match(/data-author-mark="/g)).toHaveLength(ENTRIES.length);
    for (const label of ["Sofía · AI", "Customer", "Dan López", "Someone on the team", "You"]) expect(html).toContain(`>${label}<`);
  });
  it("a call row links to its call page and keeps the caller's language; typed text is lang=\"\" (C11; mutation: drop lang on the call's words -> FAILS)", () => {
    const html = render();
    expect(html).toContain('href="/dashboard/accounts/a1/calls/k1"');
    expect(html).toMatch(/<p lang="es"[^>]*>Se le gotea el techo<\/p>/);
    expect(html).toMatch(/<p lang=""[^>]*>Gate code 4411<\/p>/);
    expect(html).toMatch(/<p lang=""[^>]*>Here it is<\/p>/);
  });
  it("one pager at the foot, Older and Newer as given, labelled; none when there is nowhere to go (mutation: always render the pager -> FAILS)", () => {
    const html = render({ pager: { olderHref: "/x?before=abc#record-timeline", newerHref: "/x#record-timeline" } });
    expect(html.match(/data-timeline-pager/g)).toHaveLength(1);
    expect(html).toMatch(/<nav aria-label="Pages"/);
    expect(html).toContain('href="/x?before=abc#record-timeline"');
    expect(html.indexOf(">Newer<")).toBeLessThan(html.indexOf(">Older<"));
    expect(html.lastIndexOf("data-timeline-item")).toBeLessThan(html.indexOf("data-timeline-pager"));
    expect(render()).not.toContain("data-timeline-pager");
  });
  it("some sources failed: the rows that loaded, and above them what could not be (spec §9.4; mutation: drop the notice -> FAILS)", () => {
    const html = render({ failedText: "Couldn't load calls and bookings." });
    expect(html).toMatch(/role="alert"[^>]*data-timeline-failed|data-timeline-failed[^>]*role="alert"/);
    expect(html).toContain("Couldn&#x27;t load calls and bookings.");
    expect(html.indexOf("data-timeline-failed")).toBeLessThan(html.indexOf("data-timeline-item"));
  });
  it("the empty state sells the timeline, only when told to (rule 5)", () => {
    const empty = render({ rows: [], emptyText: "Texts, calls, bookings, notes and To-dos with this customer show up here." });
    expect(empty).toContain("Texts, calls, bookings, notes and To-dos with this customer show up here.");
    expect(render()).not.toContain("show up here");
  });
  it("in Spanish the chrome and rows read Spanish (mutation: leave the To-do form on m[...] -> FAILS)", () => {
    const html = render({}, "es");
    for (const s of [">Agregar<", ">Cliente<", ">Usted<", "contestó una llamada", "Nuevo pendiente…"]) expect(html).toContain(s);
  });
});
```

- [ ] **Step 3: Run red.** `pnpm --filter web exec vitest run "src/app/(dashboard)/dashboard/accounts/[accountId]/contacts/[contactId]/activity-timeline"` (the folder prefix matches all ten files). Expected: the nine legacy files fail because `ActivityTimeline` still expects `notes`/`tasks`/…, so `rows` is ignored and the rows are missing. The new file fails on `data-author-mark`. Paste one line from each.

- [ ] **Step 4: Rewrite `activity-timeline.tsx`:**

```tsx
import { CalendarCheck, CalendarClock, CheckSquare, DollarSign, FileText, Mail, MessageSquare, Phone, Square,
         StickyNote } from "lucide-react";
import Link from "next/link";
import type { SmsGate } from "@/lib/sms/sender";
import { Input } from "@/components/ui/input";
import { Button, buttonVariants } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { TimelineItem } from "@/components/record/timeline-item";
import { RecordCardRetry } from "@/components/record/record-card";
import { TaskAssigneeField } from "@/components/assign/assignee-field";
import { formatDateInZone } from "@/lib/format";
import { cn } from "@/lib/utils";
import { messageFailureReason } from "@/lib/email/failure-reason";
import type { AssignMember } from "@/lib/assign/view";
import type { Locale } from "@/lib/i18n/locale";
import type { Tr } from "@/lib/record/copy";
import type { TimelineRow } from "@/lib/record/timeline-rows";
import { TIMELINE_ANCHOR } from "@/lib/record/timeline-pager";
import { addNoteAction, addTaskAction, completeTaskAction } from "./actions";
import { MessageComposer } from "./message-composer";
import { ADD_TODO_FIELD_ID } from "./constants";

export type ActivityTimelineProps = {
  accountId: string;
  contactId: string;
  contactHasEmail: boolean;
  /** Whether e164Of(contact.phone) resolves: the same notion sendSmsAction gates on. */
  contactHasPhone: boolean;
  /** THE send gate, resolved on the server (resolveSmsSender); null = could not be read. */
  smsGate: SmsGate | null;
  /** The recipient's consent line (lib/consent/composer-state.ts), in the page's language; null when it may text. */
  smsBlockedLine: string | null;
  emailNoticeLine: string | null;
  emailAction: (formData: FormData) => Promise<void>;
  smsAction: (formData: FormData) => Promise<void>;
  /** The account's RESOLVED zone (renderZone): a To-do's due date is midnight there (D-006). */
  timezone: string;
  /** F-085 part 1: may this caller hand tasks on, and to whom. */
  canAssign?: boolean;
  members?: AssignMember[];
  /** S-03 1b: one server page, merged across seven sources, already in the page's language. */
  rows: TimelineRow[];
  /** Open To-dos whose number is still on hold (consent chain PR-2, G21): a hint stands in for Done. */
  holdOpenTaskIds: string[];
  /** "Couldn't load calls and bookings." when some sources failed; null otherwise. */
  failedText: string | null;
  /** The empty state's sentence, set only on a first page with no rows and no failure. */
  emptyText: string | null;
  pager: { olderHref: string | null; newerHref: string | null };
  tr: Tr;
};

/** A To-do's due date, in the SAME account zone it was saved from (D-006); no date rather than a throw. */
function taskDueDateText(dueAt: string, timezone: string, locale: Locale): string | null {
  try {
    return formatDateInZone(dueAt, timezone, locale);
  } catch (err) {
    if (!(err instanceof RangeError)) throw err;
    return null;
  }
}

/**
 * The record page's timeline (S-03 part 1, spec §9.4), inside its RecordCard ("Activity"): the
 * composer first (where the header's Text and Email land), the add-To-do row, then one server page
 * of rows under day separators in the account's zone, each row who · did what · when on the kit's
 * TimelineItem, then ONE pager. Every row carries an author mark (DESIGN.md, Provenance).
 */
export function ActivityTimeline(p: ActivityTimelineProps) {
  const { tr } = p;
  const hidden = <input type="hidden" name="contactId" value={p.contactId} />;
  const assign = p.canAssign ? { accountId: p.accountId, members: p.members ?? [] } : null;
  const boundAddTask = addTaskAction.bind(null, p.accountId);
  const boundAddNote = addNoteAction.bind(null, p.accountId);
  const boundCompleteTask = completeTaskAction.bind(null, p.accountId);
  const pagerLink = cn(buttonVariants({ variant: "ghost", size: "sm" }), "min-h-11 md:min-h-8");

  return (
    <div id={TIMELINE_ANCHOR} className="scroll-mt-4 space-y-4">
      <div className="border-b border-[var(--row-line)] pb-4" data-timeline-composer>
        <MessageComposer contactId={p.contactId} contactHasEmail={p.contactHasEmail} contactHasPhone={p.contactHasPhone}
          smsGate={p.smsGate} smsBlockedLine={p.smsBlockedLine} emailNoticeLine={p.emailNoticeLine}
          noteAction={boundAddNote} emailAction={p.emailAction} smsAction={p.smsAction} />
      </div>
      <form action={boundAddTask} aria-label={tr.text("contact.tasks")}
        className="flex flex-wrap items-center gap-2 rounded-[var(--radius-ctl)] border border-dashed border-[var(--line-strong)] p-2">
        {hidden}
        <Input id={ADD_TODO_FIELD_ID} name="title" placeholder={tr.text("contact.addTask")} className="h-8 min-w-[140px] flex-1 text-sm" />
        <Input name="dueAt" type="date" className="h-8 w-36 text-sm" />
        <Button type="submit" variant="outline" size="sm">{tr.text("common.add")}</Button>
      </form>

      {p.failedText ? (
        <div role="alert" data-timeline-failed className="flex flex-wrap items-center gap-2 text-sm">
          <p className="text-muted-foreground">{p.failedText}</p>
          <RecordCardRetry label={tr.text("record.card.retry")} />
        </div>
      ) : null}

      {p.emptyText ? <p data-timeline-empty className="text-sm text-muted-foreground">{p.emptyText}</p> : null}

      {p.rows.length > 0 ? (
        <ol className="flex flex-col">
          {p.rows.map((row, i) => (
            <li key={row.key}
              // A day separator is already a divider; a row rule directly above one would read as two lines.
              className={cn("border-t border-[var(--row-line)] first:border-t-0", row.showDay && "border-t-0")}>
              {row.showDay ? (
                <div className={cn("mb-1 flex items-center gap-2 text-xs font-medium text-muted-foreground", i > 0 && "mt-3")}>
                  <Separator className="flex-1" />
                  {row.day}
                  <Separator className="flex-1" />
                </div>
              ) : null}
              <Row row={row} hidden={hidden} completeAction={boundCompleteTask} timezone={p.timezone} assign={assign}
                holdOpen={p.holdOpenTaskIds} accountId={p.accountId} tr={tr} />
            </li>
          ))}
        </ol>
      ) : null}

      {p.pager.olderHref || p.pager.newerHref ? (
        <nav aria-label={tr.text("timeline.pages")} data-timeline-pager className="flex items-center justify-end gap-2">
          {p.pager.newerHref ? <Link href={p.pager.newerHref} className={pagerLink}>{tr.text("timeline.newer")}</Link> : null}
          {p.pager.olderHref ? <Link href={p.pager.olderHref} className={pagerLink}>{tr.text("timeline.older")}</Link> : null}
        </nav>
      ) : null}
    </div>
  );
}

function Row({ row, hidden, completeAction, timezone, assign, holdOpen, accountId, tr }: {
  row: TimelineRow; hidden: React.ReactNode; completeAction: (formData: FormData) => Promise<void>; timezone: string;
  assign: { accountId: string; members: AssignMember[] } | null; holdOpen: string[]; accountId: string; tr: Tr;
}) {
  const e = row.entry;
  const head = { kind: e.kind, mark: row.mark, verb: row.verb, status: row.status, detail: row.detail, time: row.time, dateTime: e.at };
  switch (e.kind) {
    case "note":
      return (
        <TimelineItem {...head} icon={StickyNote}>
          <p lang="" className="whitespace-pre-wrap break-words text-sm text-card-foreground">{e.note.body}</p>
        </TimelineItem>
      );
    case "task": {
      const done = Boolean(e.task.completed_at);
      const due = e.task.due_at ? taskDueDateText(e.task.due_at, timezone, tr.locale) : null;
      const action = done ? null : holdOpen.includes(e.id) ? (
        <p className="text-xs text-muted-foreground" data-testid="task-decide-first">{tr.text("todo.consent.timelineHint")}</p>
      ) : (
        <form action={completeAction}>
          {hidden}
          <input type="hidden" name="taskId" value={e.id} />
          <Button type="submit" variant="outline" size="xs">{tr.text("contact.done")}</Button>
        </form>
      );
      return (
        <TimelineItem {...head} icon={done ? CheckSquare : Square} action={action}>
          <p lang="" className={cn("text-sm", done ? "text-muted-foreground line-through" : "text-card-foreground")}>{e.task.title}</p>
          {due || (assign && !done) ? (
            <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              {due ? <span className="flex items-center gap-1"><CalendarClock className="size-3" aria-hidden />{due}</span> : null}
              {assign && !done ? (
                <TaskAssigneeField key={`${e.id}:${e.task.assigned_to ?? ""}`} accountId={assign.accountId} taskId={e.id}
                  value={e.task.assigned_to} options={assign.members} />
              ) : null}
            </div>
          ) : null}
        </TimelineItem>
      );
    }
    case "deal":
      return <TimelineItem {...head} icon={DollarSign} />;
    case "submission": {
      const answers = e.submission.answers.filter((a) => a.value);
      return (
        <TimelineItem {...head} icon={FileText}>
          {answers.length > 0 ? (
            <dl className="space-y-0.5">
              {answers.map((a) => (
                <div key={a.key} className="flex gap-2 text-sm">
                  <dt className="shrink-0 text-muted-foreground">{a.label}:</dt>
                  <dd lang="" className="min-w-0 break-words text-card-foreground">{a.value}</dd>
                </div>
              ))}
            </dl>
          ) : null}
        </TimelineItem>
      );
    }
    case "message": {
      const reason = e.message.direction === "outbound" ? messageFailureReason(e.message, tr.locale) : null;
      return (
        <TimelineItem {...head} icon={e.message.channel === "sms" ? MessageSquare : Mail}>
          {e.message.subject ? <p lang="" className="text-sm font-medium text-card-foreground">{e.message.subject}</p> : null}
          <p lang="" className="whitespace-pre-wrap break-words text-sm text-card-foreground">{e.message.body}</p>
          {reason ? <p className="mt-1 text-xs text-[var(--crit)]">{reason}</p> : null}
        </TimelineItem>
      );
    }
    case "booking":
      return (
        <TimelineItem {...head} icon={CalendarCheck}>
          {e.booking.note ? <p lang="" className="whitespace-pre-wrap break-words text-sm text-card-foreground">{e.booking.note}</p> : null}
        </TimelineItem>
      );
    case "call": {
      const words = e.call.reason?.trim() || e.call.summary.trim();
      return (
        <TimelineItem {...head} icon={Phone} action={
          <Link href={`/dashboard/accounts/${accountId}/calls/${e.id}`} data-timeline-open-call
            className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "min-h-11 md:min-h-8")}>{tr.text("timeline.openCall")}</Link>
        }>
          {words ? <p lang={e.call.language} className="line-clamp-2 break-words text-sm text-card-foreground">{words}</p> : null}
        </TimelineItem>
      );
    }
  }
}
```

- [ ] **Step 5: Run green.** Same command as Step 3 → all ten files pass with no assertion edited. Probes: drop `mark` from the deal row (render `<TimelineItem {...head} mark={undefined as never}>` crashes, so instead skip the `AuthorMark` for `kind === "deal"` in `TimelineItem` temporarily) → "every row carries an author mark" FAILS; render `<nav>` unconditionally → the pager test FAILS; drop `lang={e.call.language}` → the C11 test FAILS; render `Done` for every open To-do → `activity-timeline.hold.test.ts` FAILS.

- [ ] **Step 6: The loader.** In `apps/web/src/lib/record/loaders.ts`, change the `@bis/db` import to drop `listNotes, listContactTasks, listContactOpportunities` from the timeline's use (keep `listContactOpportunities` for `loadDeals`) and add `listContactTimelinePage, listPeopleNames, getVoiceProfile, TIMELINE_SOURCES, type TimelinePage, type TimelineCursor`. Remove `listContactSubmissions`, `listContactMessages` and `listNotes` from the import if nothing else in the file uses them. Add `import { personIdsOf } from "./author-mark";`. Replace `:39-74` (the `Notes`…`Msgs` aliases, `TimelineLoad`, `loadTimeline`) with:

```ts
export type TimelineLoad =
  | { status: "ready"; page: TimelinePage; holdOpen: string[]; names: Record<string, string>; personaName: string | null }
  | { status: "error" };

/**
 * The timeline card's load (S-03 1b, spec §7, C3, C5): one merged server page; a source that failed
 * is named in `page.failed` and the rest still render; only when ALL seven failed is it the card's
 * error. Then three soft reads, none of which can cost the card: the hold check (fails CLOSED), the
 * names on person marks (fails to "Someone on the team"), the receptionist's persona (fails to "Sofía").
 */
export async function loadTimeline(
  db: SupabaseClient, ledger: SupabaseClient, accountId: string, contactId: string, before?: TimelineCursor,
): Promise<TimelineLoad> {
  let page: TimelinePage;
  try {
    page = await listContactTimelinePage(db, accountId, contactId, before, {
      onError: (source, e) => log(`activity (${source})`, accountId, e),
    });
  } catch (e) {
    log("activity", accountId, e);
    return { status: "error" };
  }
  if (page.failed.length >= TIMELINE_SOURCES.length) return { status: "error" };
  const tasks = page.items.flatMap((i) => (i.kind === "task" ? [i.task] : []));
  const [holdOpen, names, personaName] = await Promise.all([
    // Review R3-N1 (G21): a failed hold read fails CLOSED onto every open linked To-do on the page.
    holdOpenTaskIds(db, accountId, tasks, ledger).catch((e: unknown) => {
      console.error(`contact page: hold To-dos unreadable for contact ${contactId}: ${loggableError(e)}`);
      return tasks.filter((t) => !t.completed_at && t.consent_event_id).map((t) => t.id);
    }),
    listPeopleNames(db, personIdsOf(page.items)).catch((e: unknown) => {
      log("activity names", accountId, e);
      return {} as Record<string, string>;
    }),
    getVoiceProfile(db, accountId).then((p) => p?.persona_name ?? null).catch((e: unknown) => {
      log("activity persona", accountId, e);
      return null;
    }),
  ]);
  return { status: "ready", page, holdOpen, names, personaName };
}
```

Update `loaders.test.ts`: in its `vi.mock("@bis/db", …)` factory add `listContactTimelinePage: (...a: unknown[]) => listContactTimelinePageMock(...a)`, `listPeopleNames: (...a: unknown[]) => listPeopleNamesMock(...a)`, `getVoiceProfile: (...a: unknown[]) => getVoiceProfileMock(...a)`, `TIMELINE_SOURCES: ["notes", "todos", "deals", "forms", "messages", "bookings", "calls"]`, with the three `vi.fn()`s declared above it (reset in `beforeEach`: page → `{ items: [], older: null, failed: [] }`, names → `{}`, persona → `null`). Replace the test "a null list is an empty list, and a failed hold read fails CLOSED…" with:

```ts
  const taskEntry = (id: string, completed_at: string | null, consent_event_id: string | null) => ({
    kind: "task", id, at: "2026-10-01T00:00:00Z", task: { id, title: "x", due_at: null, completed_at, created_at: "2026-10-01T00:00:00Z",
      consent_event_id, call_id: null, assigned_to: null, created_by: null } });

  it("a failed hold read fails CLOSED onto every open linked To-do on the page, on the ledger client (mutation: pass [] on failure -> FAILS)", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      listContactTimelinePageMock.mockResolvedValue({ items: [taskEntry("t_hold", null, "h1"), taskEntry("t_done", "2026-10-01T00:00:00Z", "h2"), taskEntry("t_plain", null, null)], older: null, failed: [] });
      holdOpenTaskIdsMock.mockRejectedValue(new Error("ledger down"));
      const load = await loadTimeline(db, ledger, "acct1", "ct1");
      expect(load).toMatchObject({ status: "ready", holdOpen: ["t_hold"] });
      expect(holdOpenTaskIdsMock.mock.calls[0]![3]).toBe(ledger);
    } finally { errors.mockRestore(); }
  });

  it("some sources failing is still ready; all seven failing is the card's error (spec §9.4; mutation: error on any failure -> FAILS)", async () => {
    listContactTimelinePageMock.mockResolvedValue({ items: [], older: null, failed: ["calls"] });
    expect(await loadTimeline(db, ledger, "acct1", "ct1")).toMatchObject({ status: "ready", page: { failed: ["calls"] } });
    listContactTimelinePageMock.mockResolvedValue({ items: [], older: null, failed: ["notes", "todos", "deals", "forms", "messages", "bookings", "calls"] });
    expect(await loadTimeline(db, ledger, "acct1", "ct1")).toEqual({ status: "error" });
  });

  it("the cursor reaches the page read, and the names read asks for exactly the page's person ids (mutation: drop `before` -> FAILS)", async () => {
    const before = { v: "2026-10-09T16:12:00Z", id: "0f8a7b2c-1d2e-4f3a-8b4c-5d6e7f8a9b0c" };
    listContactTimelinePageMock.mockResolvedValue({ items: [
      { kind: "note", id: "n1", at: "2026-10-01T00:00:00Z", note: { id: "n1", body: "x", author_id: "user_dan", created_at: "2026-10-01T00:00:00Z" } },
    ], older: null, failed: [] });
    await loadTimeline(db, ledger, "acct1", "ct1", before);
    expect(listContactTimelinePageMock.mock.calls[0]!.slice(0, 4)).toEqual([db, "acct1", "ct1", before]);
    expect(listPeopleNamesMock).toHaveBeenCalledWith(db, ["user_dan"]);
  });

  it("names and the persona failing cost nothing but the names (spec §11: never an error; mutation: rethrow -> FAILS)", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      listPeopleNamesMock.mockRejectedValue(new Error("users down"));
      getVoiceProfileMock.mockRejectedValue(new Error("profile down"));
      expect(await loadTimeline(db, ledger, "acct1", "ct1")).toMatchObject({ status: "ready", names: {}, personaName: null });
    } finally { errors.mockRestore(); }
  });
```

- [ ] **Step 7: The page.** Replace `…/contacts/[contactId]/page.tsx` with the following. Lines that differ from 1a are commented `// 1b`.

```tsx
import type { ReactNode } from "react";
import { notFound } from "next/navigation";
import { getContact } from "@bis/db";
import { contactDisplayName } from "@/lib/format";
import { dbForRequest } from "@/lib/db";
import { requireAccountAccess } from "@/lib/auth";
import { loadAssignView, type AssignView } from "@/lib/assign/view";
import type { MessageKey } from "@/lib/messages";
import { LocaleProvider } from "@/components/locale-provider";
import { RecordLayout } from "@/components/record/record-layout";
import { RecordHeader, type RecordHeaderAction } from "@/components/record/record-header";
import { RecordCard, type RecordCardState } from "@/components/record/record-card";
import { columnRuns, type RecordCardId } from "@/lib/record/record-cards";
import { makeTr } from "@/lib/record/copy";
import { factsView } from "@/lib/record/record-facts";
import { nextUpView } from "@/lib/record/next-up";
import { headerActions, canTextFrom, firstMapUrl, type HeaderActionId } from "@/lib/record/header-actions";
import {
  loadSummary, loadNextUp, loadTimeline, loadDeals, loadTags, loadFieldDefs, loadHeaderPlaces, softSmsGate,
} from "@/lib/record/loaders";
import { timelineRows, timelineFailedText } from "@/lib/record/timeline-rows"; // 1b
import { timelinePagerHrefs } from "@/lib/record/timeline-pager"; // 1b
import { parseTimelineCursor } from "@/lib/cursor"; // 1b
import { requestLocale, requestPseudoMode } from "@/lib/i18n/request-locale";
import { getPersonPrefs } from "@/lib/preferences/person-prefs";
import type { Locale } from "@/lib/i18n/locale";
import { ContactDetailsBody, ContactTagsBody } from "./contact-fields-panel";
import { RelationshipsCard } from "../relationships-card";
import { ActivityTimeline } from "./activity-timeline";
import { GroupsCard } from "../groups-card";
import { PlacesCard } from "../places-card";
import { SummaryBody } from "./summary-card";
import { NextUpBody } from "./next-up-card";
import { DealsBody } from "./deals-card";
import { sendEmailAction, sendSmsAction } from "../../conversations/actions";
import { e164Of } from "@/lib/voice/phone-number";
import { smsRecipientState, emailRecipientState } from "@/lib/consent/recipient-state";
import { readTextsView } from "@/lib/consent/texts-view";
import type { TextsLoad } from "@/lib/consent/texts-row";
import { readEmailView } from "@/lib/consent/email-view";
import { ledgerDb } from "@/lib/consent/ledger-db";
import type { EmailLoad } from "@/lib/consent/email-row";
import { loggableError } from "@/lib/loggable-error";
import { composerStateLine, composerEmailNotice } from "@/lib/consent/composer-state";
import { renderZone } from "@/lib/zone";

export const dynamic = "force-dynamic";

/** "Assigned to" with nothing known: no picker, no team, no viewer (M4). */
const READ_ONLY_ASSIGN: AssignView = {
  who: "all", personId: null, assignee: undefined, canAssign: false, showMine: false, members: [],
};

const ACTION_KEY = {
  call: "record.action.call", text: "record.action.text", email: "record.action.email", directions: "record.action.directions",
} as const satisfies Record<HeaderActionId, MessageKey>;

type Slot = { node: ReactNode; state?: RecordCardState; errorText?: string };

/**
 * The contact record page (S-03 part 1; spec §§8–9). Three columns on a desk (who they are |
 * what is happening | what they have); one column on a phone in the order a person acts in. Every
 * card has its own loader (never throws) and its own boundary, so one card's fault never blanks the
 * page. 1b: the timeline is one server page across seven sources, every row marked with who made it.
 */
export default async function ContactDetailPage({
  params, searchParams,
}: {
  params: Promise<{ accountId: string; contactId: string }>;
  // The QA locale override (`?locale=es|pseudo`, BIS_I18N_QA only) and the timeline's cursor (1b).
  searchParams?: Promise<{ locale?: string; before?: string }>;
}) {
  const { accountId, contactId } = await params;
  const { locale: localeParam, before: beforeParam } = (await searchParams) ?? {};
  // 1b (spec §11): a ?before= that does not parse is a cold start, never an error.
  const before = parseTimelineCursor(beforeParam);
  const access = await requireAccountAccess(accountId);
  const db = await dbForRequest();
  const contact = await getContact(db, accountId, contactId);
  if (!contact) notFound();
  // F-085 (spec §7.3): every consent DISPLAY read (and the hold check's ledger read) goes through
  // this client, built only here, after getContact on the request client proved the contact.
  const ledger = ledgerDb();
  const now = new Date();
  const [prefs, tags, fieldDefs, smsGate, account, smsRecipient, assign, summary, nextUp, timeline, deals, places] = await Promise.all([
    getPersonPrefs(),
    loadTags(db, accountId, contactId),
    loadFieldDefs(db, accountId),
    softSmsGate(db, accountId),
    db.from("accounts").select("timezone, language").eq("id", accountId).maybeSingle(),
    smsRecipientState(ledger, accountId, contact),
    loadAssignView(db, accountId, access, undefined, { members: true, viewer: true }).catch((e: unknown) => {
      console.error(`contact page: assignment read failed for account ${accountId}, Assigned to is read-only: ${loggableError(e)}`);
      return READ_ONLY_ASSIGN;
    }),
    loadSummary(db, accountId, contactId),
    loadNextUp(db, accountId, contactId, now),
    loadTimeline(db, ledger, accountId, contactId, before), // 1b
    loadDeals(db, accountId, contactId),
    loadHeaderPlaces(db, accountId, contactId),
  ]);
  const emailRecipient = await emailRecipientState(ledger, accountId, contact);
  if (account.error) {
    console.error(`contact page: account ${accountId} timezone and language read failed: ${account.error.message}`);
  }
  const accountRow = account.data as { timezone: string; language?: Locale | null } | null;
  const zone = await renderZone(accountRow?.timezone);
  // A named variable, not an inline literal: request-locale-callers.test.ts scans each call's braces.
  const accountLanguage = { language: accountRow?.language ?? null };
  const locale = requestLocale({ account: accountLanguage, isOperator: access.isAgency, userLanguage: prefs.language }, { locale: localeParam });
  const tr = makeTr(locale, requestPseudoMode({ locale: localeParam }));

  let texts: TextsLoad;
  try {
    texts = { status: "ready", view: await readTextsView(ledger, accountId, contact), zone: zone.zone, phone: contact.phone ?? null };
  } catch (e) {
    console.error(`contact page: Texts row unreadable for contact ${contactId}: ${loggableError(e)}`);
    texts = { status: "error" };
  }
  let email: EmailLoad;
  try {
    email = { status: "ready", view: await readEmailView(ledger, accountId, contact), zone: zone.zone };
  } catch (e) {
    console.error(`contact page: Email row unreadable for contact ${contactId}: ${loggableError(e)}`);
    email = { status: "error" };
  }

  /**
   * A view model is built HERE, in the page body, outside every card's boundary, so a throw while
   * building one would reject the whole page. Each is built in its own try instead: a failure
   * costs only its own card (C5), logged by card and account (spec §11).
   */
  const viewOf = <T,>(card: string, build: () => T): T | null => {
    try {
      return build();
    } catch (e) {
      console.error(`record page: ${card} view failed for account ${accountId}: ${loggableError(e)}`);
      return null;
    }
  };

  const smsBlockedLine = composerStateLine(smsRecipient, zone.zone, locale); // 1b: in the page's language
  const name = contactDisplayName(contact);
  const mainGroup = places?.groups.find((g) => g.isPrimary) ?? places?.groups[0] ?? null;
  const subtitle = mainGroup
    ? tr.text(mainGroup.kind === "household" ? "record.group.household" : "record.group.business", { group: mainGroup.name })
    : null;
  // 1b: the rows are built here, in their own guard (C5), so a malformed row costs the timeline card.
  const timelineView = timeline.status === "ready"
    ? viewOf("timeline", () => timelineRows(timeline.page.items, {
      zone: zone.zone, tr,
      author: { viewerId: access.userId, names: timeline.names, personaName: timeline.personaName, tr },
    }))
    : null;
  // Text and Email link to the composer inside the timeline card; when that card failed there is no
  // composer behind them, so they hide (D3). Call stays.
  const composerShown = timelineView !== null;
  const actions: RecordHeaderAction[] = headerActions({
    phone: contact.phone ?? null,
    email: composerShown ? contact.email ?? null : null,
    canText: composerShown && canTextFrom({ phone: contact.phone ?? null, smsGate, smsBlockedLine }),
    directionsUrl: places ? firstMapUrl(places.places, contactId, places.groups) : null,
  }).map((a) => ({
    ...a,
    label: tr.text(ACTION_KEY[a.id]),
    ariaLabel: a.id === "call" ? tr.text("record.action.callAria", { name }) : undefined,
  }));

  const facts = summary.status === "ready"
    ? viewOf("summary", () => factsView({ createdAt: contact.created_at, facts: summary.facts }, { zone: zone.zone, now, tr }))
    : null;
  const upNext = nextUp.status === "ready" ? viewOf("next up", () => nextUpView(nextUp.data, { zone: zone.zone, now, tr })) : null;

  const failed = (errorText: string): Slot => ({ node: null, state: "error", errorText });
  const cardFailed = (titleKey: MessageKey) => failed(tr.text("record.card.failed", { title: tr.text(titleKey) }));
  const slots = {
    summary: facts
      ? { node: <SummaryBody view={facts} retryLabel={tr.text("record.card.retry")} /> }
      : failed(tr.text("record.summary.failed")),
    "next-up": upNext
      ? { node: <NextUpBody view={upNext} emptyText={tr.text("record.nextUp.empty")} addTodoLabel={composerShown ? tr.text("record.nextUp.addTodo") : null} /> }
      : failed(tr.text("record.nextUp.failed")),
    // 1b: bilingual (no lang="en" wrapper), one server page, every row marked.
    timeline: timeline.status === "ready" && timelineView
      ? {
        node: (
          <ActivityTimeline
            accountId={accountId}
            contactId={contactId}
            contactHasEmail={Boolean(contact.email)}
            contactHasPhone={Boolean(e164Of(contact.phone))}
            smsGate={smsGate}
            smsBlockedLine={smsBlockedLine}
            emailNoticeLine={composerEmailNotice(emailRecipient, zone.zone, locale)}
            emailAction={sendEmailAction.bind(null, accountId)}
            smsAction={sendSmsAction.bind(null, accountId)}
            timezone={zone.zone}
            canAssign={assign.canAssign}
            members={assign.members}
            rows={timelineView}
            holdOpenTaskIds={timeline.holdOpen}
            failedText={timelineFailedText(timeline.page.failed, tr)}
            emptyText={!before && timelineView.length === 0 && timeline.page.failed.length === 0 ? tr.text("timeline.empty") : null}
            pager={timelinePagerHrefs({
              basePath: `/dashboard/accounts/${accountId}/contacts/${contactId}`,
              older: timeline.page.older, paged: Boolean(before), locale: localeParam,
            })}
            tr={tr}
          />
        ),
      }
      : failed(tr.text("record.activity.failed")),
    // The Groups card's copy stays English in part 1, as Details' and Tags' (§9.6, D12).
    groups: { node: <div lang="en"><GroupsCard accountId={accountId} contactId={contactId} canManageGroups={assign.canAssign} headingHidden /></div> },
    properties: { node: <PlacesCard accountId={accountId} contactId={contactId} canMovePlace={assign.canAssign} headingHidden /> },
    deals: deals.status === "ready" ? { node: <DealsBody deals={deals.deals} tr={tr} /> } : cardFailed("record.card.deals"),
    details: fieldDefs.status === "ready"
      ? {
        node: (
          // The fields panel stays English until part 3 (D12).
          <div lang="en">
            <ContactDetailsBody accountId={accountId} contactId={contactId} contact={contact} fieldDefs={fieldDefs.fieldDefs}
              email={email} texts={texts} canAssign={assign.canAssign} members={assign.members} viewerId={assign.personId} />
          </div>
        ),
      }
      : cardFailed("contact.details"),
    tags: tags.status === "ready"
      ? { node: <div lang="en"><ContactTagsBody accountId={accountId} contactId={contactId} tags={tags.tags} /></div> }
      : cardFailed("contact.tags"),
    "related-people": { node: <RelationshipsCard accountId={accountId} contactId={contactId} headingHidden /> },
  } satisfies Record<RecordCardId, Slot>;

  const columns = columnRuns().map(({ column, cards }) => ({
    column,
    content: cards.map((def) => {
      const slot: Slot = slots[def.id];
      return (
        <RecordCard key={def.id} id={def.id} title={tr.text(def.titleKey)} collapsibleOnPhone={def.collapsibleOnPhone}
          skeletonRows={def.skeletonRows} state={slot.state ?? "ready"} errorText={slot.errorText}>
          {slot.node}
        </RecordCard>
      );
    }),
  }));

  return (
    <LocaleProvider locale={locale}>
      <RecordLayout
        lang={locale}
        skipLabel={tr.text("record.skipToDetails")}
        header={<RecordHeader name={name} subtitle={subtitle} actions={actions}
          back={{ href: `/dashboard/accounts/${accountId}/contacts`, label: tr.text("record.back") }} />}
        columns={columns}
      />
    </LocaleProvider>
  );
}
```

`loading.tsx`: import `TimelineItemSkeleton` from `@/components/record/timeline-item` and give the timeline its row-shaped skeleton: on the `RecordCard` add `skeleton={def.id === "timeline" ? <TimelineItemSkeleton rows={def.skeletonRows} /> : undefined}`.

- [ ] **Step 8: Update `page.test.ts`** (each change names the line it replaces):
  1. Above the `vi.mock("@bis/db", …)` factory (`:69`) declare:
     ```ts
     const EMPTY_PAGE = { items: [], older: null, failed: [] };
     const listContactTimelinePageMock = vi.fn(async (..._a: unknown[]): Promise<unknown> => EMPTY_PAGE);
     const listPeopleNamesMock = vi.fn(async (..._a: unknown[]): Promise<unknown> => ({}));
     const getVoiceProfileMock = vi.fn(async (..._a: unknown[]): Promise<unknown> => null);
     ```
     and add to the factory: `listContactTimelinePage: (...a: unknown[]) => listContactTimelinePageMock(...a)`, `listPeopleNames: (...a: unknown[]) => listPeopleNamesMock(...a)`, `getVoiceProfile: (...a: unknown[]) => getVoiceProfileMock(...a)`, `TIMELINE_SOURCES: ["notes", "todos", "deals", "forms", "messages", "bookings", "calls"]`.
  2. `render()` (`:182-185`) gains an optional search: `async function render(search: Record<string, string> = {}) { const el = await ContactDetailPage({ params: Promise.resolve({ accountId: "acct1", contactId: "ct1" }), searchParams: Promise.resolve(search) }); return renderToStaticMarkup(el); }`.
  3. The 404 test (`:234-253`): in `reads`, replace `listNotes: listNotesMock` with `listContactTimelinePage: listContactTimelinePageMock`.
  4. The hold test (`:317-340`): replace `listContactTasksMock.mockResolvedValue([...])` with
     ```ts
     const taskEntry = (id: string, consent_event_id: string | null) => ({ kind: "task", id, at: "2026-10-01T00:00:00Z", task: {
       id, title: "x", due_at: null, completed_at: null, created_at: "2026-10-01T00:00:00Z", consent_event_id, call_id: null, assigned_to: null, created_by: null } });
     listContactTimelinePageMock.mockResolvedValue({ items: [taskEntry("t_hold", "h1"), taskEntry("t_plain", null)], older: null, failed: [] });
     ```
     The rest of the test is unchanged: the `holdOpenTaskIdsMock` call is still asserted with the two task objects (`expect.objectContaining` matches the `task` rows), and so are the `LEDGER` argument and the `holdOpenTaskIds` prop. In the test's existing `finally`, add `listContactTimelinePageMock.mockResolvedValue(EMPTY_PAGE);` so later describes start from an empty page.
  5. In the "every card loads and fails on its own" `beforeEach` (`:592-608`) add `listContactTimelinePageMock.mockReset().mockResolvedValue(EMPTY_PAGE); listPeopleNamesMock.mockReset().mockResolvedValue({});`.
  6. `:626`, `:723` and `:734` replace `listNotesMock.mockRejectedValue(new Error("notes read down"))` with `listContactTimelinePageMock.mockRejectedValue(new Error("timeline read down"))`.
  7. The Deals test (`:657-668`): replace the comment and the `mockResolvedValueOnce([]).mockRejectedValueOnce(…)` chain with `listContactOpportunitiesMock.mockRejectedValue(new Error("deals down"));`. The timeline no longer reads through it (1b), so one rejection is the Deals card's alone.
  8. The Spanish test (`:740-748`): the timeline is now converted, so `expect(["details", "tags", "groups"].filter((id) => !wrapped(id))).toEqual([]);` and `expect(["summary", "next-up", "deals", "timeline"].filter(wrapped)).toEqual([]);`. Rename its title to `"…the bodies that stay English carry lang=\"en\": Details, Tags and Groups; the timeline is bilingual since 1b (§9.6; mutation: wrap the timeline in lang=\"en\" -> FAILS)"`.
  9. Append a describe:

```ts
describe("the record page's timeline (S-03 1b, spec §7, §9.4, §11)", () => {
  const ID = "0f8a7b2c-1d2e-4f3a-8b4c-5d6e7f8a9b0c";
  const noteBy = (author_id: string | null, id = "n1") => ({ kind: "note", id, at: "2026-10-09T16:12:00Z",
    note: { id, body: "x", author_id, created_at: "2026-10-09T16:12:00Z" } });
  beforeEach(() => {
    getContactMock.mockReset().mockResolvedValue(CONTACT);
    recipientState.mockReset().mockResolvedValue({ kind: "ok" });
    emailRecipientStateMock.mockReset().mockResolvedValue({ kind: "ok" });
    readTextsView.mockReset().mockResolvedValue({ kind: "allowed", newestId: null });
    readEmailView.mockReset().mockResolvedValue({ kind: "allowed", newestId: null });
    listContactTimelinePageMock.mockReset().mockResolvedValue(EMPTY_PAGE);
    listPeopleNamesMock.mockReset().mockResolvedValue({});
    prefsMock.mockReset().mockResolvedValue({ language: null, theme: null });
    timelineProps.mockClear();
    timelineThrows.on = false;
  });
  type Props = { rows: { verb: string; mark: { label: string } }[]; failedText: string | null; emptyText: string | null;
    pager: { olderHref: string | null; newerHref: string | null } };
  const props = () => timelineProps.mock.calls.at(-1)![0] as Props;

  it("a ?before= that parses reaches the page read; one that does not is a cold start (spec §11; mutation: pass the raw param -> FAILS)", async () => {
    const good = Buffer.from(JSON.stringify(["2026-10-09T16:12:00.123456+00:00", ID]), "utf8").toString("base64url");
    await render({ before: good });
    expect(listContactTimelinePageMock.mock.calls.at(-1)![3]).toEqual({ v: "2026-10-09T16:12:00.123456+00:00", id: ID });
    await render({ before: "garbage" });
    expect(listContactTimelinePageMock.mock.calls.at(-1)![3]).toBeUndefined();
  });

  it("names: the request client reads the page's person ids; the viewer reads You and an unreadable id Someone on the team (D10, D11; mutation: You for every person -> FAILS)", async () => {
    requireAccountAccessMock.mockResolvedValueOnce({ userId: "user_me", isAgency: false, role: "staff", canManage: false });
    listContactTimelinePageMock.mockResolvedValue({ items: [noteBy("user_me", "n1"), noteBy("user_dan", "n2"), noteBy("user_gone", "n3")], older: null, failed: [] });
    listPeopleNamesMock.mockResolvedValue({ user_dan: "Dan López" });
    await render();
    expect(listPeopleNamesMock.mock.calls.at(-1)![1]).toEqual(["user_me", "user_dan", "user_gone"]);
    expect(props().rows.map((r) => r.mark.label)).toEqual(["You", "Dan López", "Someone on the team"]);
  });

  it("some sources failed: the timeline gets its rows and says what could not load (mutation: drop failedText -> FAILS)", async () => {
    listContactTimelinePageMock.mockResolvedValue({ items: [noteBy(null)], older: null, failed: ["calls", "bookings"] });
    await render();
    expect(props().failedText).toBe("Couldn't load calls and bookings.");
    expect(props().rows).toHaveLength(1);
    expect(props().emptyText).toBeNull();
  });

  it("all seven sources failed: the card's error, and Text and Email hide with the composer (D3)", async () => {
    listContactTimelinePageMock.mockResolvedValue({ items: [], older: null, failed: ["notes", "todos", "deals", "forms", "messages", "bookings", "calls"] });
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const html = await render();
      expect(cardHtml(html, "timeline")).toContain(m["record.activity.failed"].replaceAll("'", "&#x27;"));
      expect(timelineProps).not.toHaveBeenCalled();
      expect(html).not.toContain("#compose-email");
    } finally { errors.mockRestore(); }
  });

  it("the pager: Older from the head carries the merge's cursor; a paged view offers Newer; the first empty page sells the timeline (mutation: offer Newer on the head -> FAILS)", async () => {
    listContactTimelinePageMock.mockResolvedValue({ items: [noteBy(null)], older: { v: "2026-10-09T16:12:00Z", id: ID }, failed: [] });
    await render();
    expect(props().pager.olderHref).toMatch(/^\/dashboard\/accounts\/acct1\/contacts\/ct1\?before=[\w-]+#record-timeline$/);
    expect(props().pager.newerHref).toBeNull();
    const cursor = Buffer.from(JSON.stringify(["2026-10-09T16:12:00Z", ID]), "utf8").toString("base64url");
    listContactTimelinePageMock.mockResolvedValue(EMPTY_PAGE);
    await render({ before: cursor });
    expect(props().pager.newerHref).toBe("/dashboard/accounts/acct1/contacts/ct1#record-timeline");
    expect(props().emptyText).toBeNull();
    await render();
    expect(props().emptyText).toBe(m["timeline.empty"]);
  });

  it("a Spanish page's rows read Spanish (§9.6; mutation: build the rows with an English Tr -> FAILS)", async () => {
    prefsMock.mockResolvedValue({ language: "es", theme: null });
    listContactTimelinePageMock.mockResolvedValue({ items: [noteBy(null)], older: null, failed: [] });
    await render();
    expect(props().rows[0].verb).toBe("agregó una nota");
    expect(props().rows[0].mark.label).toBe("Alguien del equipo");
  });
});
```

(`cardHtml` is the file's module-scope helper, `page.test.ts:589`.)

Update `loading.test.ts`, appending inside its describe:

```ts
  it("the timeline loads as rows (mark chip, line, time), not generic lines (spec §9.4; mutation: drop the timeline skeleton -> FAILS)", () => {
    const html = renderToStaticMarkup(createElement(Loading));
    const timeline = html.match(/<section[^>]*data-record-card="timeline"[\s\S]*?<\/section>/)![0];
    expect(timeline).toContain("data-timeline-skeleton");
    expect(timeline.match(/data-timeline-skeleton-row/g)).toHaveLength(5);
  });
```

- [ ] **Step 9: Run green.**

```bash
pnpm --filter web exec vitest run src/lib/record "src/app/(dashboard)/dashboard/accounts/[accountId]/contacts/[contactId]" src/lib/i18n/request-locale-callers.test.ts src/lib/i18n/ratchet.test.ts
pnpm --filter web typecheck
pnpm --filter web exec eslint "src/app/(dashboard)/dashboard/accounts/[accountId]/contacts/[contactId]" src/lib/record
```

Expected: every file passes, typecheck and lint clean. Run the probes named in Steps 2, 6 and 8, each FAILING by name. Then check the `vi.mock("@bis/db")` factories: `grep -rln 'vi.mock("@bis/db"' apps/web/src | xargs grep -ln "loaders\|contacts/\[contactId\]/page"` lists only `loaders.test.ts` and `page.test.ts` (both updated). If another file appears, add the four new names to its factory.

- [ ] **Step 10: DoD by eye** (orchestrator's dev server against a replica or Preview): a fixture contact with a booking, a call and 31 notes; dark and light; the blur fallback (`@supports not (backdrop-filter)` via devtools); 390px (head lines wrap, every control ≥ 44px); `?locale=es` and `?locale=pseudo` (+35% wraps, never clips); keyboard (Tab reaches Done, the assignee picker, Open call, Older/Newer, each with a visible ring); the pager lands on `#record-timeline`. Report what was checked.

- [ ] **Step 11: Commit.**

```bash
D="apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/contacts/[contactId]"
git add -- "$D/activity-timeline.fixture.ts" "$D/activity-timeline.rows.test.ts"
git commit -m "feat(contacts): the record timeline shows who made every row, bookings and calls as their own rows, one page at a time, in English and Spanish (S-03 1b)" -- "$D/activity-timeline.tsx" "$D/activity-timeline.fixture.ts" "$D/activity-timeline.rows.test.ts" "$D/activity-timeline.assignee.test.ts" "$D/activity-timeline.callback.test.ts" "$D/activity-timeline.due-date.test.ts" "$D/activity-timeline.failure-reason.test.ts" "$D/activity-timeline.hold.test.ts" "$D/activity-timeline.item-zone.test.ts" "$D/activity-timeline.message-status.test.ts" "$D/activity-timeline.note.test.ts" "$D/activity-timeline.order.test.ts" "$D/page.tsx" "$D/page.test.ts" "$D/loading.tsx" "$D/loading.test.ts" apps/web/src/lib/record/loaders.ts apps/web/src/lib/record/loaders.test.ts
```

---

## Task 11: e2e, `record-page.spec.ts` extended (bis-e2e-qa)

**Review:** sonnet. **Runs:** group F, after Task 10. The agent writes the spec; **the orchestrator runs it** (Task 12 step 2). Per-run fixture account only, never Test Client One. Every locator goes through `recordPage(page)` (`apps/web/e2e/support.ts:131-134`): the route streams, and a hidden copy can sit outside `<main>`.

**Files**
- Modify: `apps/web/e2e/record-page.spec.ts`

**Interfaces:** Consumes the barrel's `createBooking`, `assignPhoneNumber`, `startCallRow`, `finishCallRow`, `addNote`, `createForm`, `createSubmission`, `linkSubmissionContact`, `ensureConversation`, `createMessage` (all exported today); `m["provenance.customer"]`, `m["provenance.customer.es"]`, `m["timeline.older"]`, `m["timeline.newer"]`, `m["timeline.openCall"]`.

- [ ] **Step 1: Seed through the app's own writers** so every row carries its 1b author (and the seed survives 0074's NOT NULL). In `record-page.spec.ts`:
  - Extend the `@bis/db` import to `serviceDb, createContact, addPlace, getOrCreateCalendar, createBooking, assignPhoneNumber, startCallRow, finishCallRow, addNote, createForm, createSubmission, linkSubmissionContact, ensureConversation, createMessage`.
  - Replace `const CANCEL_TOKEN = …` with `let cancelToken = "";`, and `const made: { full?: string; bare?: string } = {};` with `const made: { full?: string; bare?: string; pager?: string; phone?: string; call?: string; form?: string; submission?: string; conversation?: string } = {};`, and add `const WORDS = \`Fence quote ${stamp}\`;`.
  - In `beforeAll`, replace the `db.from("bookings").insert({…})` block and its error check (`:59-63`; keep `cal` and `start` above it) with:

```ts
  // The booking page's own writer, so the row is the customer's (0073: author_kind 'customer').
  const booked = await createBooking(db, accountId, {
    calendarId: cal.id, contactId: made.full, startsAt: start, endsAt: new Date(start.getTime() + 3_600_000), ipHash: `e2e-${stamp}`,
  }, "public", "system");
  cancelToken = booked.cancelToken;
  // A receptionist call (calls.spec's path): every calls row is hers.
  const number = await assignPhoneNumber(db, accountId, { e164: `+1557${String(stamp).slice(-7)}`, status: "testing" }, ACTOR);
  made.phone = number.id;
  made.call = (await startCallRow(db, accountId, { phoneNumberId: number.id, callerE164: PHONE })).id;
  await finishCallRow(db, accountId, made.call, {
    outcome: "booked", endedAt: new Date(), durationSecs: 180, turnCount: 0, transcript: [],
    summary: `Roof leak, booked. Ref ${stamp}`, language: "en", contactId: made.full,
  });
  // A form submission AND the inbox's copy of it: the timeline must show it once (C4).
  const form = await createForm(db, accountId, { name: `Record form ${stamp}` }, ACTOR);
  made.form = form.id;
  made.submission = (await createSubmission(db, accountId, form.id, { answers: [{ key: "message", label: "Message", value: WORDS }] })).id;
  await linkSubmissionContact(db, accountId, made.submission, made.full);
  made.conversation = (await ensureConversation(db, accountId, made.full, ACTOR)).id;
  await createMessage(db, accountId, { conversationId: made.conversation, channel: "form", direction: "inbound", body: WORDS }, "form", "system");
  // 31 notes on their own contact: one more than a page.
  const pager = await createContact(db, accountId, { firstName: "Pager", lastName: LAST }, ACTOR);
  if (pager.existing) throw new Error("record-page e2e: the pager contact matched an existing one; refusing to use (or delete) it.");
  made.pager = pager.id;
  for (let i = 1; i <= 31; i++) await addNote(db, accountId, made.pager, `Pager note ${i}`, ACTOR);
```

  - Replace `afterAll`'s body with the child-first order: every step checked, every failure logged (the fixture sweep takes leftovers), never thrown before the last assertion.

```ts
test.afterAll(async () => {
  const { accountId } = fixture();
  const db = serviceDb();
  const step = async (label: string, run: () => PromiseLike<{ error: { message: string } | null }>) => {
    const { error } = await run();
    if (error) console.error(`record-page e2e: ${label} cleanup failed (the fixture sweep takes it): ${error.message}`);
  };
  const ids = [made.full, made.bare, made.pager].filter((x): x is string => Boolean(x));
  if (made.conversation) {
    await step("messages", () => db.from("messages").delete().eq("account_id", accountId).eq("conversation_id", made.conversation!));
    await step("conversation", () => db.from("conversations").delete().eq("account_id", accountId).eq("id", made.conversation!));
  }
  if (made.call) await step("call", () => db.from("calls").delete().eq("account_id", accountId).eq("id", made.call!));
  if (made.phone) await step("phone number", () => db.from("phone_numbers").delete().eq("account_id", accountId).eq("id", made.phone!));
  // bookings.contact_id is `on delete restrict`: the booking goes before its contact.
  if (cancelToken) await step("booking", () => db.from("bookings").delete().eq("account_id", accountId).eq("cancel_token", cancelToken));
  // form_submissions.form_id is `on delete restrict`: the submission goes before its form.
  if (made.submission) await step("submission", () => db.from("form_submissions").delete().eq("account_id", accountId).eq("id", made.submission!));
  if (made.form) await step("form", () => db.from("forms").delete().eq("account_id", accountId).eq("id", made.form!));
  await step("contacts", () => db.from("contacts").delete().eq("account_id", accountId).in("id", ids));
  const { data: left } = await db.from("contacts").select("id").in("id", ids);
  expect(left ?? []).toEqual([]);
  if (cancelToken) {
    const { data: leftBooking } = await db.from("bookings").select("id").eq("cancel_token", cancelToken);
    expect(leftBooking ?? []).toEqual([]);
  }
});
```

  - The first test's `PHONE_ORDER` and every 1a test stay as they are.

- [ ] **Step 2: The 1b tests.** Append:

```ts
const timelineCard = (page: Page) => record(page).locator('[data-record-card="timeline"]');

test("every timeline row says who made it: the booking page's booking is the customer's, the call is the receptionist's", async ({ page }) => {
  await page.goto(url(made.full!));
  const tl = timelineCard(page);
  const items = tl.locator("[data-timeline-item]");
  await expect(items.first()).toBeVisible();
  // DESIGN.md, Provenance: a row with no mark is a defect.
  await expect(tl.locator("[data-timeline-item]:not(:has([data-author-mark]))")).toHaveCount(0);
  const booking = tl.locator('[data-timeline-item="booking"]');
  await expect(booking).toHaveCount(1);
  await expect(booking.locator('[data-author-mark="customer"]')).toHaveText(m["provenance.customer"]);
  await expect(booking).toContainText("booked an appointment for");
  const call = tl.locator('[data-timeline-item="call"]');
  await expect(call.locator('[data-author-mark="ai"]')).toHaveText(/ · AI$/);
  await expect(call).toContainText("answered a call");
  await expect(call.getByRole("link", { name: m["timeline.openCall"] })).toHaveAttribute("href", new RegExp(`/calls/${made.call}$`));
});

test("a form submission appears once, not twice: the inbox's copy is not a timeline row (C4, D15)", async ({ page }) => {
  await page.goto(url(made.full!));
  const tl = timelineCard(page);
  await expect(tl.locator('[data-timeline-item="submission"]')).toHaveCount(1);
  await expect(tl.locator('[data-timeline-item="message"]')).toHaveCount(0);
  await expect(tl.getByText(WORDS, { exact: true })).toHaveCount(1);
});

test("Older pages the timeline on the server, and Newer returns to the head", async ({ page }) => {
  await page.goto(url(made.pager!));
  const tl = timelineCard(page);
  await expect(tl.locator("[data-timeline-item]")).toHaveCount(30);
  await expect(tl.locator("[data-timeline-pager]")).toHaveCount(1);
  await tl.getByRole("link", { name: m["timeline.older"] }).click();
  await expect(page).toHaveURL(/[?&]before=/);
  await expect(timelineCard(page).locator("[data-timeline-item]")).toHaveCount(1);
  await expect(timelineCard(page).getByText("Pager note 1", { exact: true })).toBeVisible();
  await timelineCard(page).getByRole("link", { name: m["timeline.newer"] }).click();
  await expect(page).not.toHaveURL(/[?&]before=/);
  await expect(timelineCard(page).locator("[data-timeline-item]")).toHaveCount(30);
});

test("in Spanish a row reads Cliente", async ({ page }) => {
  await page.goto(url(made.full!, "?locale=es"));
  await expect(timelineCard(page).locator('[data-timeline-item="booking"] [data-author-mark="customer"]')).toHaveText(m["provenance.customer.es"]);
});
```

(Add `type Page` to the `./fixtures/test` import, or `import type { Page } from "@playwright/test";`, whichever the file's sibling specs use.)

- [ ] **Step 2b: Why the call row is safe for later specs.** `playwright.config.ts:123-128` runs one worker, file by file. `calls.spec.ts` (which asserts "1 of N calls today", `:150-156`) runs before this file, and `screened-calls.spec.ts`/`usage-meter.spec.ts` after it. This file's `afterAll` deletes its call before the next file starts, so no other spec ever sees it.

- [ ] **Step 3: Static checks only.** `pnpm --filter web exec tsc --noEmit -p e2e` (or the repo's e2e typecheck if it differs; `pnpm --filter web typecheck` covers `e2e/` when its tsconfig includes it), `pnpm --filter web exec eslint e2e/record-page.spec.ts`, and `pnpm --filter web exec vitest run e2e/fixtures` (the fixture-name and entry-guard tests: this spec mints no `E2E ` name, so `fixture-names.test.ts` needs no entry). **Do not run Playwright.** Each new test names its own failure: an unmarked row, a duplicated submission, no pager, an English mark on a Spanish page.

- [ ] **Step 4: Commit.** `git commit -m "test(e2e): the record timeline marks every row, shows a submission once, pages on the server and reads Spanish (S-03 1b)" -- apps/web/e2e/record-page.spec.ts`

---

## Task 12: Rollout (orchestrator; not a coding task)

- [ ] **1. Measure first, read-only, on bis-ci then production** (spec §13 step 1; MCP `execute_sql` read-only selects). These queries count, per table, how many historical rows each §5.3 bucket will take. Record the numbers in the ledger: the outbound-message residue (D9) above all.

```sql
-- messages: direction x the message.created actor (NULL = no event: the D9 residue when outbound)
with ev as (
  select distinct on (e.payload ->> 'messageId') e.payload ->> 'messageId' as row_id, e.account_id, e.actor_type
    from public.events e where e.type = 'message.created' and e.payload ->> 'messageId' is not null
   order by e.payload ->> 'messageId', e.id)
select m.direction, coalesce(ev.actor_type, '(no event)') as actor, count(*)
  from public.messages m left join ev on ev.row_id = m.id::text and ev.account_id = m.account_id
 group by 1, 2 order by 1, 2;

-- bookings: the booking.created actor, else whether an ip hash is present
with ev as (
  select distinct on (e.payload ->> 'bookingId') e.payload ->> 'bookingId' as row_id, e.account_id, e.actor_type
    from public.events e where e.type = 'booking.created' and e.payload ->> 'bookingId' is not null
   order by e.payload ->> 'bookingId', e.id)
select coalesce(ev.actor_type, case when b.ip_hash is not null then '(no event, ip)' else '(no event, no ip)' end) as bucket, count(*)
  from public.bookings b left join ev on ev.row_id = b.id::text and ev.account_id = b.account_id
 group by 1 order by 1;

-- tasks and deals a person's event can name; submissions the web chat claims
select 'tasks named' as bucket, count(*) from public.tasks t
 where t.call_id is null and t.consent_event_id is null
   and exists (select 1 from public.events e where e.type = 'task.created' and e.actor_type = 'user'
                and e.account_id = t.account_id and e.payload ->> 'taskId' = t.id::text)
union all
select 'tasks unnamed (Someone on the team)', count(*) from public.tasks t
 where t.call_id is null and t.consent_event_id is null
   and not exists (select 1 from public.events e where e.type = 'task.created' and e.actor_type = 'user'
                    and e.account_id = t.account_id and e.payload ->> 'taskId' = t.id::text)
union all
select 'deals named', count(*) from public.opportunities o
 where exists (select 1 from public.events e where e.type = 'opportunity.created' and e.actor_type = 'user'
                and e.account_id = o.account_id and e.payload ->> 'opportunityId' = o.id::text)
union all
select 'submissions by the web chat', count(*) from public.form_submissions s
 where s.id in (select c.submission_id from public.concierge_conversations c where c.submission_id is not null);
```

- [ ] **2. Merge prep and gates.** Task 0 done; merge `origin/main` again if it moved. Push the branch early so `verify` runs the whole db suite (the live `withTestAccount` tests of Tasks 2–7 prove red→green there). `e2e` stays red until step 4 (the migration check). Then, one at a time on the combined tree: `pnpm check`, `pnpm --filter web build`, `pnpm --filter web test:e2e` (check for an in-progress `screenshots.yml` run first).
- [ ] **3. CI project, dry run.** `gh workflow run ci-project-setup.yml --ref feat/s03-record-1b -f step=push-dry-run`. Read the run: it lists exactly `0073_record_provenance.sql`. If it lists 0072 too, G9 has not reached bis-ci: stop.
- [ ] **4. CI project, push.** `gh workflow run ci-project-setup.yml --ref feat/s03-record-1b -f step=push`. Read the run for success and for the `record provenance backfill: …` NOTICE lines. They should match step 1's bis-ci numbers. Re-run the PR's `e2e` job (one started before the push read an older history).
- [ ] **5. Production.** Warn danlo in chat first. Re-run Task 1 Step 7's byte scan (`0073 0`). Apply via MCP `apply_migration`, name `record_provenance`, **exactly once; never re-apply**, and never touch 0069–0072. Then read-only: `select count(*) from public.messages where author_kind is null` and `… public.bookings …` → both `0`; `select author_kind, count(*) from public.messages group by 1` against step 1's buckets.
- [ ] **6. Parity.** `docs/runbooks/ci-supabase-project.md`'s parity digest between bis-ci and production: they match. Spot checks on production: `select count(*) from pg_trigger where tgname in ('tasks_stamp_created_by','opportunities_stamp_created_by','tasks_keep_created_by','notes_author_guard')` → `4`; `select count(*) from pg_indexes where indexname in ('bookings_account_contact','tasks_account_contact','calls_account_contact')` → `3`.
- [ ] **7. PR, merge, deploy.** Open the PR only now. Read the check runs for the HEAD SHA (`gh api repos/{owner}/{repo}/commits/{sha}/check-runs`); merge with the SHA pinned. Verify the deploy is READY at the merge SHA; `/` 200, `/sign-in` 200, `/api/cron/reminders` 401, `/b/bogus` 404. Served-HTML marker: a `data-author-mark` on a contact page's timeline row (Preview or production, signed in).
- [ ] **8. Ledger, runbook, tracker.** Propose the 0073 run-log line for `docs/runbooks/ci-supabase-project.md` to bis-platform; update S-03's row in the roadmap tracker; open Task 13's branch once the deploy is confirmed.

Hazards (spec §13): **1b's app before 0073** fails every send (`createMessage` writes a missing column; assumed PGRST204), so the order is not optional, and the `e2e` job's migration check enforces it on bis-ci. **0073 before 1b** is safe. **Rollback:** revert 1b; 0073's columns and triggers are harmless to the 1a build.

---

## Task 13: Follow-up PR, `0074_record_provenance_not_null.sql` (bis-db-schema)

**Review:** opus. **When:** after 1b is deployed and confirmed (Task 12 step 7). From then on, nothing inserts a message or a booking without `author_kind`. Its own branch off `main` (`feat/s03-record-1b-not-null`); **0074, or the next free number then**: check `ls packages/db/supabase/migrations | tail -2`. **Scratch:** `s03-1b-t13-impl/`, replica port **55502** (reviewer **55503**).

**Files**
- Create: `packages/db/supabase/migrations/0074_record_provenance_not_null.sql`
- Modify: `packages/db/src/test/record-provenance-schema.test.ts`
- Modify (the insert-site sweep: every direct INSERT into `messages` or `bookings` that does not go through `createMessage`/`createBooking` gains an `author_kind`). As of `a5d0868a`: `packages/db/src/test/assignee-filters.test.ts:150`, `automations-b-schema.test.ts:102`, `:121`, `messaging.test.ts:759`, and the SQL inserts in `bookings-rescheduled-from-schema.test.ts`, `email-optout-fold.test.ts`, `phone-country-backfill.test.ts` (4), `same-account-fk-schema.test.ts`, `server-only-writes-grants.test.ts` (4), `technician-scope.test.ts` (2). Re-derive the list at the time with `grep -rnE 'insert into (public\.)?(bookings|messages)\b|from\("(bookings|messages)"\)' packages/db/src apps/web/src apps/web/e2e --include=*.ts`, then read each hit. The INSERTs refused by privilege (`server-only-writes-grants.test.ts`'s `authenticated` cases) still refuse with 42501 before any NOT NULL check, so they need the column only where they insert as the owner.

- [ ] **Step 1: Measure** (read-only, bis-ci then production): `select count(*) from public.messages where author_kind is null` and the same for `bookings`. These are the rows the previous build wrote between 0073 and 1b's deploy. Expect a handful. Record them.
- [ ] **Step 2: Failing schema test.** In `record-provenance-schema.test.ts`, replace the case "messages and bookings still accept a row with no author…" with:

```ts
  it("messages and bookings refuse a row with no author since 0074 (mutation: drop the set not null on bookings -> FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      await expect(insert(c, "messages", message(s, "inbound"))).rejects.toMatchObject({ code: "23502", column: "author_kind" });
      await expect(insert(c, "bookings", booking(s))).rejects.toMatchObject({ code: "23502", column: "author_kind" });
    }));
```

and make the backfill case open the window it measures: its first statements after `const s = await seed(c);` become

```ts
      // The window 0074 closes: rows the build before 1b wrote. Rolled back with the test.
      await c.query("alter table public.messages alter column author_kind drop not null");
      await c.query("alter table public.bookings alter column author_kind drop not null");
```

Run on a replica with 0073 applied and 0074 not (`pre` + 0073 = this task's `pre`): the new case fails with `promise resolved … instead of rejecting`. The other cases pass.

- [ ] **Step 3: The migration** `packages/db/supabase/migrations/0074_record_provenance_not_null.sql`:

```sql
-- 0074_record_provenance_not_null.sql - every message and booking names who made it (S-03 part 1, PR 1b follow-up)
-- (docs/superpowers/specs/2026-10-12-record-page-design.md sections 5.1 and 13 step 4)
--
-- 0073 added messages.author_kind and bookings.author_kind as NULLABLE, because the build before 1b
-- inserted without them. 1b is deployed and writes them on every insert, so: re-run 0073's backfill
-- for the rows the previous build wrote in the window, then close the columns.
--
-- APPLY ORDER: only after 1b is deployed. CI project (ci-project-setup.yml: push-dry-run, then push),
-- then production (MCP apply_migration), then the parity check, then merge this PR.
--
-- ROLLBACK (before reverting the 1b app, which does not need this):
--   alter table public.messages alter column author_kind drop not null;
--   alter table public.bookings alter column author_kind drop not null;
--
-- ASCII only, no backslash anywhere.

set local lock_timeout = '5s';

do $$
declare r record;
begin
  for r in select * from app.backfill_record_provenance() loop
    raise notice 'record provenance backfill (0074 re-run): % = %', r.bucket, r.row_count;
  end loop;
end $$;

alter table public.messages alter column author_kind set not null;
alter table public.bookings alter column author_kind set not null;
```

(`app.backfill_record_provenance()` stays: the schema test calls it, and it is a no-op once no row is NULL.)

- [ ] **Step 4: Green on the replica, then the sweep.** Apply 0074 to `post`; run `record-provenance-schema.test.ts`, `provenance-parity.test.ts`, `schema-grants-guard.test.ts`, `technician-scope.test.ts`, `server-only-writes-grants.test.ts`, `same-account-fk-schema.test.ts`, `bookings-rescheduled-from-schema.test.ts`, `email-optout-fold.test.ts`, `phone-country-backfill.test.ts`, `automations-b-schema.test.ts` on `post` with blank credentials. Each insert-site file that fails with `23502 … author_kind` gets the column (`author_kind: 'customer'` for an inbound or a public-page row, `'person'` with no id otherwise). Re-run until green. The PostgREST files (`assignee-filters.test.ts`, `messaging.test.ts`) are fixed by the same rule and proven by CI `verify`. Probe: drop `set not null` on bookings → the new case FAILS by name.
- [ ] **Step 5: Byte scan** (Task 1 Step 7's node scan on the new file) → `0`.
- [ ] **Step 6: Commit** the migration, the schema test and every swept file, by explicit path.
- [ ] **Step 7: Rollout** (orchestrator), Task 12's order: dry run lists only this file; bis-ci push; production `apply_migration` once (name `record_provenance_not_null`), after re-running Step 1's counts; parity; spot check `select is_nullable from information_schema.columns where table_name in ('messages','bookings') and column_name = 'author_kind'` → `NO`, `NO`; then merge.

---

## Self-review against the spec

| Spec | Covered by |
|---|---|
| §1 every row marked; §2 D5 bookings and calls as rows | Task 7 (seven sources), Task 9 (`authorOf`, `timelineRows`), Task 10 (`TimelineItem` for every row; "every row carries an author mark"), Task 11 |
| D9 unnamed outbound → "Someone on the team" | Task 1 (`app.message_author` NULL actor → person), Task 9 (`authorOf` NULL default, label) |
| D10/D11 an unnameable person, no service read | Task 7 (`listPeopleNames` on the request client), Task 9 (`authorLabel`, `hasOwn`), Task 8 (DESIGN.md sentence), Task 1 (Technician names test) |
| D15 / C4 the `form`/`voice` copies leave | Task 3 (`channels`), Task 7 (always `["email","sms"]`), Task 11 (submission once) |
| C1 two author shapes | Task 1 (triggers; columns), Tasks 3, 4, 6 (server writers) |
| C2 one closed type | Task 1 (`AUTHOR_KINDS`, CHECKs), Task 9 (exhaustive switches; "every output is one of the five") |
| C3 server paging, one pager, 30 a page | Task 2 (cursor), Task 7 (merge, `older`), Task 9 (pager), Task 10 (page), Task 11 (Older/Newer) |
| C10 status a dot and a word on booking, message, call rows | Task 8 (`TimelineItem`), Task 9 (status maps) |
| C11 `lang=""`, `lang={calls.language}` | Task 10 (bodies; test) |
| §5.1 columns, CHECKs, three indexes | Task 1 |
| §5.2 writers | Task 1 (triggers), Task 3 (`createMessage`), Task 4 (`createBooking`/`moveBooking`), Task 6 (web chat) |
| §5.3 backfill buckets, honest defaults, NOTICE | Task 1 (function, buckets test, re-run), Task 12 step 1 (measure), Task 13 (re-run) |
| §6 kinds and words; persona; names | Task 9, Task 10 (loader reads persona and names) |
| §7 1b reads; drawer unchanged | Tasks 2–5 (optional page params; no-arg behaviour pinned in the live tests), Task 7 |
| §8 `AuthorMark`, `TimelineItem` | Task 8 |
| §9.4 1b states: empty, loading rows, some failed, all failed, pager | Task 8 (skeleton slot), Task 10 (`failedText`, `emptyText`, loader's all-failed, loading.tsx) |
| §9.6 / §10.2 bilingual timeline; copy | Tasks 3, 4, 5, 8, 9 (keys and twins), Task 10 (no `lang="en"` wrapper) |
| §11 cold-start cursor; unreadable id not an error | Task 9 (`parseTimelineCursor`), Task 10 (page test), Task 7/10 (soft names) |
| §12.2 schema, parity, queries, web, e2e | Tasks 1, 7, 9, 10, 11; Technician parity: deviation 9 |
| §13 rollout and follow-up | Tasks 0, 12, 13 |
| §16.1 Provenance sentence | Task 8 Step 6 |

Placeholder scan: no "TBD", "add error handling" or "similar to Task N". Every code step carries its code. Task 3 Step 7's composer change is a key-by-key substitution with every line and key named. Task 13's insert-site sweep is a rule plus a list re-derived by a command at the time, because the sites move as `main` moves.

Type and name consistency checked across tasks: `AuthorKind`, `AUTHOR_KINDS`, `RowAuthor`, `messageAuthor`, `bookingAuthor`, `TimelineCursor`, `TimelinePageOpts`, `TIMELINE_PAGE_SIZE`, `isTimelineInstant`, `instantKey`, `timelineBeforeFilter`, `withTimelinePage`, `ContactBookingRow`, `listContactBookings`, `ContactCallRow`, `TimelineSource`, `TIMELINE_SOURCES`, `TimelineNote`, `TimelineTask`, `TimelineDeal`, `TimelineSubmission`, `TimelineMessage`, `TimelineEntry`, `TimelinePage`, `compareTimelineEntries`, `listContactTimelinePage`, `listPeopleNames`, `AuthorMark`, `TimelineTone`, `TimelineItem`, `TimelineItemSkeleton`, `AuthorMarkView`, `AuthorCtx`, `authorOf`, `authorLabel`, `authorMark`, `personIdsOf`, `TimelineStatus`, `TimelineRow`, `timelineRows`, `timelineFailedText`, `TIMELINE_ANCHOR`, `timelinePagerHrefs`, `parseTimelineCursor`, `TimelineLoad`, `loadTimeline`, `ActivityTimelineProps`, `legacyTimeline`. SQL: `app.message_author`, `app.booking_author`, `app.backfill_record_provenance`, `app.keep_created_by`, `app.notes_author_guard`, the four triggers, the five constraints, the three indexes.

## Spec gaps and conflicts found while planning (for the ledger)

1. **Fixed in this branch:** §6's booking example ("· Estimates ·"), §7's "`listContactBookings` (booking.ts, with the calendar's name)" and §10.2's English `timeline.booked` promised a calendar name that does not exist (one calendar per account, no name column). The row now reads "booked an appointment for {when}".
2. **§13 step 1 was not measured while planning.** This session had no Supabase MCP tool, so the bucket counts on bis-ci and production are Task 12 step 1's to take, with the queries given.
3. **The spec's `author_id` CHECK passes a row with an id and no kind** (a CHECK that evaluates to NULL passes). Planned with `coalesce` (deviation 4) and pinned by a test.
4. **A backfill run after 0073's triggers would be undone by an unconditional `keep_created_by`.** Planned role-limited (deviation 3).
5. **`aiAuthorMark` (`lib/voice/provenance.ts:12-15`) is English-only** (`m["provenance.ai"]`). The spec routes the persona "through" it, but the bilingual timeline needs `t()`, so Task 9 reads `provenance.ai` through `Tr` with the same "Sofía" fallback. `aiAuthorMark` itself is unchanged.
6. **English left inside the Spanish timeline:** `TaskAssigneeField` (`components/assign/assignee-field.tsx`, `assign.*` keys through `m[…]`) and `automations.reason.accountSuppressed` (no twin). Both belong to other owners (bis-frontend / F-085, bis-automations). Follow-ups, not 1b's.
7. **Technician parity for the merged page** rests on `technician-scope.test.ts`'s table-by-table fences. The db suite has no supabase-js Technician client (deviation 9).
8. **The 0074 follow-up touches about eleven test files** that insert into `messages`/`bookings` directly (Task 13's sweep). The spec's §13 does not mention them.
9. **`booking.status.*` (§10.2) became twins on `calendar.bookings.status.*`** (deviation 6): "Completed" on the record, not "Done".
