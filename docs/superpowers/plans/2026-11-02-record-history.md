# Record history and trash (S-04 + F-115 part 1): implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every change to a customer's own facts (a contact's fields, tags and custom fields; households and businesses and their members; places; equipment; deals; relationships) leaves one row per changed field. The row says who made the change (from the closed set of five author kinds), when, and the value before and after. The record page's timeline shows those changes with "Put back". A removed unit, member, tag, relationship or place can be restored from its timeline row for 30 days. Owners can download a record's history as CSV.

**Architecture:** Migration 0111 creates `public.record_changes`. It is append-only by grants and filled only by one SECURITY DEFINER trigger function, `app.record_changes_capture()`, which decides the author in the database from the strongest evidence available: the token, then a transaction-local setting written by a definer, then the `x-bis-author` request header that BIS server code attaches through `withAuthor`. It starts in observe mode, where an unattributed write is logged with a NULL author. CI's throwaway stacks run in enforce mode, where an unattributed write is refused. 0112 extends capture to the rest of the owner's Q1 set and teaches the definers to name their author. 0113 runs after 7 clean days in production: it backfills, sets NOT NULL and turns enforce on everywhere. The UI is one more opt-in timeline source (`changes`) on the existing record and group pages. There is no new surface.

**Tech Stack:** PostgreSQL 17 (Supabase) with plpgsql triggers, PostgREST `request.headers`, supabase-js `^2.110.8` (postgrest-js builder `setHeader`), Next.js App Router (server pages, server actions, one GET route), vitest, Playwright (bis-e2e-qa only).

**Spec:** `docs/superpowers/specs/2026-11-02-record-history-design.md`. The owner rulings in its §9 (Q1–Q5, 2026-11-02) are BINDING. Every file and line below was read at `c44724a1` (the spec commit on `feat/f115-record-history`, whose base `ac192df7` = `origin/main` on 2026-11-02).

## Global Constraints

- **Migration numbers 0111, 0112, 0113.** On 2026-11-02 the newest file on `origin/main` is `0110_contact_match.sql`, and no open PR or remote branch holds 0111–0119 (checked with `gh pr list` and `git ls-tree` over every remote branch). Each migration's owner re-checks immediately before its PR opens: `git fetch origin main -q && git ls-tree --name-only origin/main packages/db/supabase/migrations/ | tail -3`. If the number is taken, renumber the file, its header and every pin in this plan, in one commit. Never edit 0110 or any earlier file.
- **Owner rulings (spec §9):** **Q1** history covers contacts (with tags and custom fields), households and businesses and their members, places, equipment, deals and relationships. It does NOT cover To-dos or bookings. **Q2** Owners, Staff and BIS (agency) read history; Technicians read none. **Q3** history is kept as long as the record exists, goes with the account, and a contact's permanent delete takes that contact's values. **Q4** trash lives on each record: removal rows carry Restore for 30 days, contacts keep Archived, files keep the Documents trash, and there is no new top-level surface. **Q5** Download: per record, Owners only, CSV with English or Spanish headers, and an agency download is noted in the BIS access log.
- **Five author kinds, closed:** `person`, `ai`, `automation`, `customer`, `import` (`packages/db/src/provenance.ts:7`). `author_id` is set only with `person` or `import`.
- **Append-only:** no API role holds UPDATE, DELETE or TRUNCATE on `record_changes`. Time comes from `now()`. The author comes from the token or the trusted server path, never from a client value.
- **No agent applies a migration to any Supabase project.** The orchestrator applies each one exactly once: bis-ci through `ci-project-setup.yml` (push-dry-run, then push), then production through MCP `apply_migration`, then the parity check, then the merge. Production's Supabase is `tlbkbmlrfafquucsmsmm`; never point a local test at it.
- **SQL style (0103/0105/0106):** the header has `WHY / WHAT / GRANTS / SEARCH PATHS / LOCKS AND COST / LOAD-BEARING / ROLLBACK` sections. The file is ASCII only, with no backslash anywhere and every dollar sign part of a dollar-quote pair. Its first statement is the `lock_timeout` 5s `do` block. Every definer has `set search_path = pg_catalog, pg_temp`, and every function call is schema-qualified.
- **Copy:** English and *usted* Spanish. Every English key has its `.es` twin on the very next line of `apps/web/src/lib/messages.ts`. Glossary: *su negocio* (never *empresa*), *agendar*/*cita*, sentence case. Counts go through `plural()` (`apps/web/src/lib/i18n/t.ts:54`, base key plus `One`). Copy carries no milestone codes, no arrows and no `{{template}}`. It must pass the "landscaper at 7 AM" read and survive the pseudo-locale's +35% at 375 px. Server actions take `locale` right after `accountId` and are `.bind()`-ed.
- **DESIGN.md:** tokens only; a status is a dot plus a word (rule 3); Put back and Restore run at once with an Undo toast (rule 6); skeletons, never spinners (rule 7); every change row carries an author mark (the Provenance section); the record page names no hero (rule 11); on a phone the page is one column with 44 px targets.
- **Speed process:** each TASK is tiered. HIGH (migrations, RLS, grants, triggers and the author contract) gets a full brief, an implementer, and a bis-reviewer pass with mutation probes on the reviewer's own replica. MEDIUM gets an implementer plus one review. LOW gets no per-task review. There is one end-of-PR review per PR. At most 2 lanes run at once. Lanes run only the affected test files plus `tsc`; CI runs the full suite.

## Rules for every agent (shared worktrees)

Worktrees: the plan lives in `C:\Users\danlo\bis-platform\.claude\worktrees\f115` (Git Bash: `/c/Users/danlo/bis-platform/.claude/worktrees/f115`, branch `feat/f115-record-history`). The orchestrator creates one worktree per PR branch (see "PR split") with `git worktree add`. Start every Bash command with `cd <your worktree> && …`.

1. **Never** run `git checkout`, `git switch`, `git stash` (any form), `git reset`, `git rebase`, `git commit --amend`, `git add -A`/`git add .`, `rm -rf`, or a push. Commit only your task's named paths: `git add <paths>` then `git commit -m "<type(scope): what and why>" -- <paths>`. End every commit message with the two attribution lines in the task brief. If `.git/index.lock` exists, wait and retry; never delete it. Remove a worktree only with `git worktree remove`.
2. **Your own replica, never a Supabase project.** Schema proof runs on a local **PostgreSQL 17.6** replica: binaries `C:\Users\danlo\AppData\Local\Temp\claude\C--Users-danlo-bis-platform\88d51cd6-6c5b-4497-af8a-63647f233ba6\scratchpad\ca-t1\pg17\pgsql\bin` (confirm that `postgres.exe --version` answers `17.6` before anything else). The driver script to copy is `C:\Users\danlo\AppData\Local\Temp\claude\C--Users-danlo-bis-platform\6aad36e9-1c5f-4846-8e5b-164fe1f316ea\scratchpad\rp\pg17-rp.sh`. Copy it into YOUR scratchpad and change exactly these: `S` = your scratchpad; `D="$S/<task>"`; the port to your task's port below (in every place it appears); `W` = your worktree; the `init` skip pattern to your migration (`0111_*`, and also `0112_*`/`0113_*` when present); `post` applies your migration file(s) in order into `$D/<n>.apply.txt`. Ports: T0 **55991**, T1 **55992**, T3 **55993**, T6 **55994**, T7 **55995**, reviewers **+100** (for example 56092). PG18 (`C:\Program Files\PostgreSQL\18`) is NOT a substitute: production is PG17.
3. **`@bis/db` vitest runs are exactly two kinds.** (a) `withRollback` files run against your replica, with `SUPABASE_DB_URL=postgresql://postgres@localhost:<port>/post` on that one command line and no other Supabase variable in the shell. The sweep then prints `[sweep] no Supabase credentials; skipping abandoned-fixture sweep`: paste it. (b) Pure files run with no Supabase variable at all. Every `withTestAccount` file (`*-live.test.ts`) is proven by CI `verify` only, read by the orchestrator FOR THE HEAD SHA. Command shape, from `packages/db`: `SUPABASE_DB_URL=… pnpm exec vitest run src/test/<file>.test.ts`.
4. **Env.** Worktrees have no `packages/db/.env` and no `apps/web/.env.local`: never create, copy or edit one. A web test that needs env sources the main checkout's file into that one shell (`set -a; . /c/Users/danlo/bis-platform/apps/web/.env.local; set +a; pnpm --filter web exec vitest run <file>`), and never in a shell that then runs `@bis/db` vitest.
5. Judge every vitest run by its own summary block (`Test Files … | Tests …`), never by the exit code. `@bis/db` prints a trailing `ERR_PNPM_RECURSIVE_EXEC_FIRST_FAIL "Command vitest not found"` after the real results. A `-t` filter that matches nothing skips silently, so paste the summary showing the expected count.
6. **Red first, and the red is real.** Paste the failing assertion line, then the green summary line. Run each named mutation and show it failing BY NAME; if a mutation cannot fail, say so and substitute one that can.
7. Every TS task's green step also runs `pnpm --filter @bis/db typecheck` and/or `pnpm --filter web typecheck` and `pnpm --filter web lint` (0 errors). No component body calls `Date.now()` or a no-argument `new Date()`.
8. The orchestrator runs `pnpm install --frozen-lockfile --prefer-offline` once per fresh worktree (none had `node_modules` on 2026-11-02). Agents never reinstall.
9. Stay inside your task's file list. A file another task owns is read-only to you; if you need it changed, stop and say so in your report.
10. e2e runs only on the per-run fixture account. `Test Client One` is READ-ONLY. Only bis-e2e-qa writes Playwright, and only the orchestrator runs the gates (`pnpm check`, `pnpm --filter web build`, `pnpm --filter web test:e2e`), one at a time.

## Corrections to the spec made while planning (the source wins)

1. **`RowAuthor` already exists** (`packages/db/src/provenance.ts:9`, `{ authorKind: AuthorKind; authorId: string | null }`, re-exported at `packages/db/src/index.ts:426`). `withAuthor` takes it as-is. No new author type is made.
2. **The ops heartbeat takes no count** (`packages/db/src/ops.ts:77`, `recordHeartbeat(db, key, {ok:true} | {ok:false; error})`). The "daily unattributed count" is therefore a cron pass (`recordChangesAudit`). It returns `{ unattributed: n }` as `PassCounters` and THROWS when `n > 0`, so the pass's heartbeat (`cron.pass.recordChangesAudit`) turns red with the number in its error. The 7-day gate is read with the SQL in the orchestrator checklist, not from the heartbeat.
3. **The 0091 undos are SECURITY INVOKER, not definers** (`undo_ai_contact_created`, `MIG/0091_ai_acts.sql:500`; `undo_ai_booking_act`, replaced at `MIG/0107:218`). `undo_ai_contact_created` is called on a SERVICE client (`packages/db/src/ai-acts.ts:125-128`), so its TypeScript caller sends the header (precedence step 4). It needs no SQL change. `undo_ai_booking_act` touches bookings, which are out of scope (Q1).
4. **Direct database sessions** are migrations, psql, `withRollback` seeding as `postgres`, and the account-teardown cascade. They carry no `request.jwt.claims`, and the spec's precedence table does not cover them. Ruling taken here as the least-surprising reading of §2.3: a write with **no JWT claims at all** is marked `automation` with `via = 'sql'`, is never refused, and is not counted as unattributed. Enforce mode refuses only a **service_role PostgREST request** that names no author. Reason: enforce exists to catch BIS server code; a data migration is BIS acting as the system. **Flag for the T1 review and the orchestrator.** If the owner prefers "direct sessions must set `bis.author` themselves", change step 5 of the capture function and test 7b only.
5. **`service_role` gets SELECT only, not SELECT + INSERT** (spec §2.2 and test 2 said both). The capture definer is the only writer and runs as the table owner, so no app path needs INSERT. Without it, BIS server code cannot forge a row. Test 2 asserts INSERT is absent.
6. **Rows deleted by a cascade from their parent** are deleted contacts, deleted accounts and a removed group's members. On a cascade from `accounts`, inserting a change row that references the vanishing account would fail its FK and break account teardown, which the db suite's sweep does on every run. On a delete, the capture function therefore returns early when the owning account row no longer exists. In 0112, a child row also returns early when its contact (or group) no longer exists, because the parent's own delete row is the record of that removal.
7. **Definers reset what they set.** A `set_config(..., true)` lives until the end of the transaction. Every definer that sets `bis.author`, `bis.author_id` or `bis.via` sets all three back to `''` before it returns, so a later statement in the same transaction is not mis-marked (test 10b).
8. **`contact_tags` has no `id` column** (`MIG/0003_crm_core.sql:30-33`). Its `record_id` is `tag_id` and its `contact_id` is the contact.
9. **The header is always JSON**, `{"kind":…, "id"?:…, "via"?:…}`, on both paths. On the client path only `kind = 'import'` and `via` matching `^restore:[0-9]+$` are honoured. Any other client-sent `via` is dropped, because a forged `via` could fold a person's change row out of sight (spec risk 6).

## Shared facts every task relies on

### External assumptions (proven by T0, re-proven end-to-end by T1's live test and the Preview check)

- **A1.** PostgREST sets `request.headers` (a JSON object whose keys are lower-cased header names) and `request.jwt.claims` as transaction-local settings, so an AFTER ROW trigger fired by that request's write can read them with `current_setting(..., true)`. This holds for both a table write and an `rpc` call.
- **A2.** supabase-js `^2.110.8`'s PostgREST builder exposes `setHeader(name, value)` on the builders `from(...).insert/update/upsert/delete` and `rpc(...)` return. The repo does not use it today.
- **A3 (assumption, not testable locally).** Hosted Supabase's API gateway forwards a custom `x-bis-author` header to PostgREST. It is proven after PR A by checklist step A6 on Vercel Preview against bis-ci, read-only.

### SQL interfaces (T1 makes them; T3 extends them)

```text
public.record_changes            table, columns exactly as spec section 2.2, record_type CHECK in RECORD_TYPES
app.record_changes_settings      one row: (id boolean primary key default true check (id), enforce boolean not null default false)
app.record_change_fields(text)   -> text[]  SQL, immutable, NOT a definer; audited columns per record_type
app.record_changes_capture()     -> trigger SECURITY DEFINER; tg_argv[0] = record_type, tg_argv[1] = 'client' | 'server'
triggers on public.contacts:     record_changes_client (WHEN current_user = 'authenticated')
                                 record_changes_server (WHEN current_user <> 'authenticated')
transaction settings read:       bis.author (kind), bis.author_id, bis.via   ('' = unset)
header read:                     current_setting('request.headers', true)::jsonb ->> 'x-bis-author'
RECORD_TYPES = contact, client_group, client_group_member, place, equipment, opportunity, contact_relationship, contact_tag
via formats:  merge:<bigint> | ai_act:<uuid> | proposal:<uuid> | restore:<bigint> | sql | seed
```

### TypeScript interfaces

```ts
// packages/db/src/row-author.ts (T2)
export const AUTHOR_HEADER = "x-bis-author";
export function authorHeaderValue(author: RowAuthor, via?: string): string;          // throws on person without id
export function withAuthor<B extends { setHeader(name: string, value: string): B }>(builder: B, author: RowAuthor, via?: string): B;
export function requireAuthor(db: SupabaseClient, author: RowAuthor | undefined, writer: string): RowAuthor; // throws on a service client with no author
export function eventActorOf(author: RowAuthor): { actorId: string; actorType: ActorType }; // exact inverse of contactAuthor

// packages/db/src/record-changes.ts (T4)
export type ChangeRecordType = "contact" | "client_group" | "client_group_member" | "place" | "equipment" | "opportunity" | "contact_relationship" | "contact_tag";
export type ChangeRow = { id: number; recordType: ChangeRecordType; recordId: string; contactId: string | null; clientGroupId: string | null;
  op: "insert" | "update" | "delete"; field: string | null; before: unknown; after: unknown; xact: string;
  authorKind: AuthorKind | null; authorId: string | null; via: string | null; createdAt: string };
export type ChangeGroup = { key: string; recordType: ChangeRecordType; recordId: string; authorKind: AuthorKind | null; authorId: string | null;
  via: string | null; at: string; firstAt: string; steps: ChangeRow[][]; rows: ChangeRow[] };
export const COLLAPSE_MINUTES = 10;
export function groupChanges(rows: ChangeRow[]): ChangeGroup[];                        // pure
export function foldVia(groups: ChangeGroup[], onPage: { mergeIds: Set<string>; aiActIds: Set<string>; proposalIds: Set<string> }): ChangeGroup[]; // pure
export async function listChangeRows(db: SupabaseClient, accountId: string, scope: { contactIds: string[] } | { groupId: string }, before: string | undefined, limit: number): Promise<ChangeRow[]>;

// packages/db/src/record-restore.ts (T6)
export const RESTORE_DAYS = DOCUMENT_TRASH_DAYS;                                       // 30, from document-rules.ts:35
export function canPutBack(row: ChangeRow): boolean;                                   // pure
export function canRestore(row: ChangeRow, now: Date): boolean;                        // pure
export async function putBackChange(db: SupabaseClient, accountId: string, changeId: number, author: RowAuthor): Promise<"put_back" | "changed" | "not_found" | "not_allowed">;
export async function restoreRemoved(db: SupabaseClient, accountId: string, changeId: number, author: RowAuthor, now: Date): Promise<"restored" | "expired" | "parent_gone" | "already_back" | "not_found" | "not_allowed">;
```

### Pinned lists this plan moves

- `packages/db/src/test/definer-search-path.test.ts:31` `EXPECTED_DEFINERS`: 38 entries today. T1 adds `"app.record_changes_capture()": PG_CATALOG_PG_TEMP`, making 39. T3 adds none (it replaces existing definers). T7 adds none.
- `packages/db/src/test/schema-grants-guard.test.ts:65-111` `EXPECTED_WRITES`: unchanged by every task here (authenticated writes nothing on `record_changes`). The assertion at `:126` already fails if one appears.
- `packages/db/src/account-teardown.ts:20` `ACCOUNT_OWNED_TABLES`: NOT changed. The table leaves with its account by cascade (0105's choice).
- `apps/web/src/lib/record/timeline-rows.ts:55-60` `SOURCE_KEY: Record<TimelineSource, MessageKey>`: T4 adds `changes: "timeline.what.changes"`.

## Task list

| # | Title | Owner | Tier | PR | Lane |
|---|---|---|---|---|---|
| T0 | Spike: PostgREST headers in an AFTER trigger; supabase-js `setHeader` | bis-db-schema | LOW | (report only) | 1 |
| T1 | 0111: table, capture, contacts triggers, settings row, grants and RLS, pins, replica timings | bis-db-schema | **HIGH** | A | 1 |
| T2 | `withAuthor`, required `RowAuthor` on contact writers, every contact write path converted, the audit pass, CI enforce switch | bis-crm (TS writers) + bis-voice (voice/web chat) + bis-platform (CI switch) | **HIGH** | A | 1 |
| T3 | 0112: the rest of Q1, definers name their author, custom-key put-back function, their TS writers | bis-db-schema (SQL) + bis-crm (TS writers) | **HIGH** | B | 1 |
| T4 | Reader: `changes` source, grouping, collapse, fold, loaders opt in | bis-crm | MEDIUM | C | 2 |
| T5 | Timeline rows, disclosure, values, EN/ES copy, phone layout, failure key | bis-frontend | MEDIUM | E | 2 |
| T6 | Put back and Restore: server functions and actions | bis-crm | **HIGH** | C | 2 |
| T7 | 0113: backfill, NOT NULL, enforce on (after 7 clean days) | bis-db-schema | **HIGH** | D | 1 |
| T8 | Download history (Owners, CSV EN/ES, agency access-log note) | bis-crm | MEDIUM | C | 2 |
| T9 | e2e: edit a phone, see was/now, Put back, Undo | bis-e2e-qa | MEDIUM | E | 2 |
| T10 | Roadmap rows and tracker | orchestrator | LOW | E | — |

---

### Task 0: Spike — verify A1 and A2 before anything is built on them

**Tier:** LOW (about half a day; no per-task review) · **Owner:** bis-db-schema · **Lane:** 1 · **Port:** 55991, PostgREST 3999
**Files:** none committed. Everything lives in `<scratchpad>/t0/`. The output is a report the orchestrator pastes into the ledger, plus a one-line verdict per assumption.

No Docker and no Supabase CLI are installed on this machine (checked 2026-11-02), so the local proof uses a **standalone PostgREST binary** against your PG17.6 replica. The CI stack (Kong + PostgREST + supabase-js) re-proves A1 and A2 end-to-end in T1's live test, and A3 is proven on Preview at checklist step A6.

- [ ] **Step 1: Replica.** Copy `pg17-rp.sh` as in rule 2 to `<scratchpad>/t0/pg17-t0.sh`, port 55991, skip nothing (`pre` = 0001–0110). Run `sh pg17-t0.sh init`. Expected last line: `pre = 110 files applied, last 0110_contact_match.sql, on 17.6`. Then `create database spike template pre`.
- [ ] **Step 2: Which PostgREST.** Read CI's PostgREST image tag: `gh run list --workflow ci.yml --branch main --limit 1 --json databaseId --jq '.[0].databaseId'`, then `gh run view <id> --log | grep -m3 -io 'postgrest:v[0-9.]*'`. Download that version's `postgrest-v<ver>-windows-x86-64.zip` from `https://github.com/PostgREST/postgrest/releases` into `<scratchpad>/t0/` and unzip it. (ASSUMPTION: the machine can reach GitHub releases. If it cannot, stop and report; do not install anything system-wide.)
- [ ] **Step 3: The probe schema** (on `spike` only; never a migration). Run with `psql -h localhost -p 55991 -U postgres -d spike -v ON_ERROR_STOP=1`:

```sql
create role authenticator login noinherit password 'spike';
grant anon, authenticated, service_role to authenticator;
create table public.spike_t (id int primary key, v text);
insert into public.spike_t values (1, 'a');
create table public.spike_log (path text, headers text, claims text, cu text, at timestamptz default now());
create function public.spike_capture() returns trigger language plpgsql security definer
  set search_path = pg_catalog, pg_temp as $$
begin
  insert into public.spike_log (path, headers, claims, cu)
  values (tg_argv[0], pg_catalog.current_setting('request.headers', true),
          pg_catalog.current_setting('request.jwt.claims', true), current_user);
  return null;
end $$;
create trigger spike_client after update on public.spike_t for each row
  when (current_user = 'authenticated') execute function public.spike_capture('client');
create trigger spike_server after update on public.spike_t for each row
  when (current_user <> 'authenticated') execute function public.spike_capture('server');
create function public.spike_rpc(p int) returns void language plpgsql security definer
  set search_path = pg_catalog, pg_temp as $$ begin update public.spike_t set v = v || 'r' where id = p; end $$;
grant select, update on public.spike_t to authenticated, service_role;
grant execute on function public.spike_rpc(int) to authenticated, service_role;
```

- [ ] **Step 4: Run PostgREST.** Write `<scratchpad>/t0/postgrest.conf`:

```text
db-uri = "postgres://authenticator:spike@localhost:55991/spike"
db-schemas = "public"
db-anon-role = "anon"
jwt-secret = "spike-secret-spike-secret-spike-secret-0001"
server-port = 3999
```

Start it in the background (`./postgrest.exe postgrest.conf > postgrest.log 2>&1 &`) and confirm `curl -s localhost:3999/` answers JSON. Mint two HS256 tokens with Node only (no dependencies):

```js
// <scratchpad>/t0/jwt.cjs  — node jwt.cjs service_role  |  node jwt.cjs authenticated
const c = require("crypto"); const b = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
const role = process.argv[2]; const h = b({ alg: "HS256", typ: "JWT" });
const p = b({ role, sub: role === "authenticated" ? "user_spike" : undefined, exp: Math.floor(Date.now() / 1000) + 3600 });
const s = c.createHmac("sha256", "spike-secret-spike-secret-spike-secret-0001").update(h + "." + p).digest("base64url");
console.log(h + "." + p + "." + s);
```

- [ ] **Step 5: A1 by curl.** Make three calls, then read the log:

```bash
SVC=$(node jwt.cjs service_role); USR=$(node jwt.cjs authenticated)
curl -s -X PATCH 'localhost:3999/spike_t?id=eq.1' -H "Authorization: Bearer $SVC" -H 'Content-Type: application/json' \
  -H 'x-bis-author: {"kind":"ai","via":"ai_act:00000000-0000-0000-0000-000000000001"}' -d '{"v":"b"}'
curl -s -X POST 'localhost:3999/rpc/spike_rpc' -H "Authorization: Bearer $SVC" -H 'Content-Type: application/json' \
  -H 'x-bis-author: {"kind":"automation"}' -d '{"p":1}'
curl -s -X PATCH 'localhost:3999/spike_t?id=eq.1' -H "Authorization: Bearer $USR" -H 'Content-Type: application/json' \
  -H 'x-bis-author: {"kind":"import"}' -d '{"v":"c"}'
psql -h localhost -p 55991 -U postgres -d spike -c "select path, headers::jsonb->>'x-bis-author' as hdr, claims::jsonb->>'role' as role, cu from public.spike_log order by at"
```

**A1 holds when** the three rows read, in order: `server | {"kind":"ai",…} | service_role | postgres`; `server | {"kind":"automation"} | service_role | postgres` (the rpc's definer ran the update, so `current_user` is the owner and the header is still visible); `client | {"kind":"import"} | authenticated | postgres`. (`cu` is the definer's owner inside the function body. The path column proves the WHEN test.) Paste the table.

- [ ] **Step 6: A2, read the types.** After the orchestrator's install, find the builder: `cd packages/db && node -p "require.resolve('@supabase/postgrest-js/package.json')"`, then `grep -rn "setHeader" $(dirname <that>)/dist/cjs/*.d.ts | head`. **A2 holds when** `PostgrestBuilder` declares `setHeader(name: string, value: string): this`. Paste the line and the postgrest-js version.
- [ ] **Step 7: A2, run it.** Write `<scratchpad>/t0/a2.mjs` to run with `node` from `packages/db` (so it resolves the installed package):

```js
import { PostgrestClient } from "@supabase/postgrest-js";           // the builder supabase-js wraps
const svc = process.env.SVC;
const db = new PostgrestClient("http://localhost:3999", { headers: { Authorization: `Bearer ${svc}` } });
const r1 = await db.from("spike_t").update({ v: "d" }).eq("id", 1).setHeader("x-bis-author", JSON.stringify({ kind: "customer" }));
const r2 = await db.rpc("spike_rpc", { p: 1 }).setHeader("x-bis-author", JSON.stringify({ kind: "person", id: "user_x" }));
console.log(r1.error, r2.error);
```

Run `SVC=$SVC node <scratchpad>/t0/a2.mjs` from `packages/db`; expected `null null`. The two newest `spike_log` rows carry `{"kind":"customer"}` and `{"kind":"person","id":"user_x"}`. Then a compile probe: create `packages/db/src/__spike-setheader.ts` containing `import { serviceDb } from "./service"; export const p = serviceDb().from("contacts").update({ dnd: true }).eq("id", "x").setHeader("x-bis-author", "{}");`, run `pnpm --filter @bis/db typecheck` (expected: 0 errors), then delete that ONE file with `rm packages/db/src/__spike-setheader.ts` and confirm `git status --short` is clean.
- [ ] **Step 8: Stop and report.** Stop PostgREST and the replica (`sh pg17-t0.sh stop`). Report: the CI PostgREST version, the Step 5 table, the Step 6 line, the Step 7 output, and one verdict line each: `A1: HOLDS | FAILS (what was seen)` and `A2: HOLDS | FAILS`.

**If A1 fails (the spec's fallback):** writers cannot pass the author by header. T1 Step 4's precedence step 4 is replaced by a definer RPC, `public.write_as(p_author jsonb, p_table text, p_op text, p_id uuid, p_patch jsonb)`. It validates the author, sets the three `bis.*` settings, performs the write under the caller's account check and resets the settings. T2 converts each service-client contact write to `db.rpc("write_as", …)` instead of `withAuthor(builder, …)`. Add +0.5 ew. T1's other steps are unchanged. The orchestrator brings the A1 failure to the owner before T2 starts, because it changes T2's size.
**If A2 fails:** the header still works, but not per query. `withAuthor` becomes `serviceDbAs(author, via): SupabaseClient`, a short-lived `createClient(url, key, { global: { headers: { "x-bis-author": authorHeaderValue(author, via) } } })` per call, which costs the same as today's per-call `serviceDb()`. In T2, each converted writer uses `isUserClient(db) ? db : serviceDbAs(author, via)` for its audited write. T1 is unchanged.

---

### Task 1: 0111 — the change log, its capture, contacts triggers, observe mode

**Tier:** HIGH · **Owner:** bis-db-schema · **Lane:** 1 · **Port:** 55992 · **PR:** A · **Depends on:** T0 (A1 HOLDS, or the fallback chosen)

**Files:**
- Create: `packages/db/supabase/migrations/0111_record_changes.sql`
- Create: `packages/db/src/test/record-changes-schema.test.ts` (withRollback; tests 1, 2, 4–9, 11 of spec §5)
- Create: `packages/db/src/test/record-changes-rls.test.ts` (withRollback; test 3)
- Create: `packages/db/src/test/record-changes-live.test.ts` (withTestAccount, CI only; end-to-end A1/A2 through Kong and supabase-js)
- Modify: `packages/db/src/test/definer-search-path.test.ts:25,31` (count comment 38 → 39; one entry)
- Scratch (never committed): `<scratchpad>/t1/pg17-t1.sh`, `<scratchpad>/t1/cost/`

**Interfaces:** produces every object in "SQL interfaces". `record_type` CHECK lists all eight `RECORD_TYPES` now, so 0112 never alters the CHECK. Only `contacts` gets triggers in 0111.

- [ ] **Step 1: Replica and faithfulness.** Make `pg17-t1.sh` per rule 2 (port 55992; `init` skips `0111_*`; `post` applies 0111). Run `init`; expected `pre = 110 files applied, last 0110_contact_match.sql, on 17.6`. On `pre`, record the client-write digest and the definer count, then paste both:

```sql
select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where p.prosecdef and n.nspname in ('public','app');                                   -- expect 38
select count(*) || '|' || md5(string_agg(x, ',' order by x)) as digest from (
  select r || ' ' || c.relname || ' ' || p as x
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   cross join (values ('anon'), ('authenticated')) v(r)
   cross join (values ('INSERT'), ('UPDATE'), ('DELETE')) w(p)
   where n.nspname = 'public' and c.relkind = 'r' and has_table_privilege(r, c.oid, p)) s;   -- record it: 0111 must not move it
```

- [ ] **Step 2: Measure first (before 0111 exists).** See "Measure first" under this task. Run the two timings on `pre` now and save them as `cost/before.txt`.

- [ ] **Step 3: The schema test, red first.** Create `record-changes-schema.test.ts`. Copy the helpers `seedAccount`, `refusal`, `contact` from `packages/db/src/test/contact-archive-schema.test.ts` and `asService` from `contact-merge-schema.test.ts:60-64`, with the org prefix `org_rc_`. Add one helper:

```ts
/** A service-role PostgREST request as the capture sees it: service claims, plus the x-bis-author header when given. */
async function asServiceWith(c: Client, author?: object): Promise<void> {
  await asService(c);
  await c.query("select set_config('request.headers', $1, true)",
    [JSON.stringify(author ? { "x-bis-author": JSON.stringify(author) } : {})]);
}
const changes = (c: Client, id: string) => c.query(
  "select op, field, before, after, author_kind, author_id, via from public.record_changes where record_id = $1 order by id", [id]);
```

The cases follow. Each title names its mutation, and each case runs inside `withRollback`:

1. `"0111: columns, CHECKs and the three indexes (mutation: drop record_changes_author_id -> an ai row with an id inserts -> FAILS)"`: assert the column list and types from `information_schema.columns`; that `insert … (op 'update', field null)` violates `record_changes_field_shape`; that `author_kind 'ai'` with `author_id 'x'` violates `record_changes_author_id`; that `record_type 'booking'` violates the type CHECK; and the three index names in `pg_indexes`: `record_changes_contact_idx`, `record_changes_group_idx`, `record_changes_record_idx`.
2. `"grants: anon none; authenticated and service_role SELECT only; nobody UPDATE/DELETE/TRUNCATE (mutation: grant insert to service_role -> FAILS)"`: loop over `anon, authenticated, service_role` × `SELECT, INSERT, UPDATE, DELETE, TRUNCATE` with `has_table_privilege`, expecting exactly `authenticated SELECT` and `service_role SELECT`. Also assert that `app.record_changes_settings` grants nothing to the three roles.
3. `"column pin: every contacts column is AUDITED or EXCLUDED (mutation: add a column to contacts in the test -> FAILS naming it)"`: read `information_schema.columns` for `public.contacts` and compare against `AUDITED = app.record_change_fields('contact')` plus this `EXCLUDED` map, each entry carrying its reason string:

```ts
const EXCLUDED: Record<string, string> = {
  id: "the row key", account_id: "the tenant", created_at: "set once on insert",
  archived_at: "0103's log", archived_by: "0103's log", merged_into: "0106's log", merged_at: "0106's log",
  company_name: "derived (0072)", sort_name: "derived", email_key: "derived", phone_key: "derived",
  phone_country_unconfirmed: "derived", updated_at: "a timestamp", author_kind: "creation provenance",
  author_id: "creation provenance", holds_shared_number: "structural", last_language_signal: "telemetry",
  last_language_signal_at: "telemetry", language_hint_kept_at: "telemetry", language_set_at: "telemetry",
  attribution: "machine UTM blob (enrich.ts:416)",
};
```

   Any live column in neither list fails with `expect(unlisted).toEqual([])`. **First read the real column list on `pre`** (`\d public.contacts`). Every name above that does not exist is removed from the map, and every existing column the spec did not name is reported in your summary for the reviewer. The spec's AUDITED list is fixed: `first_name, last_name, email, phone, assigned_to, dnd, source, marketing_email_opted_out_at, language, custom`.
4. `"signed-in edit: one row per changed field, person + sub; a no-op writes nothing (mutation: drop IS DISTINCT FROM -> the no-op case FAILS)"`: `actAsMember(c, a, org, "staff")` returns `sub`. Update `phone` and `email`, which gives 2 rows `update`, both `person`, `author_id = sub`, with `before`/`after` the old and new text as jsonb. Updating `phone` to the same value adds 0 rows. Updating `custom` from `{"gate":"1234"}` to `{"gate":"9","dog":"Rex"}` gives 2 rows, `custom.gate` and `custom.dog`, with `before` `null` for the dog.
5. `"insert snapshots the audited columns only (mutation: snapshot to_jsonb(new) -> 'attribution' appears -> FAILS)"`: one `insert` row, `field null`, `after` has exactly the AUDITED keys.
6. `"precedence (mutation: swap steps 3 and 4 -> FAILS)"`, four sub-asserts:
   (a) A GUC beats the header: `asServiceWith(c, {kind:"ai"})`, then `set_config('bis.author','customer',true)`, then an update gives `customer`.
   (b) A definer a person called gives `person` even with an `ai` header: create a throwaway definer IN THE TEST (`create function pg_temp.t_upd(uuid) … security definer`; if pg_temp definers are refused, use `public.t_rc_upd` and drop it, still inside the rollback). Call it after `actAsMember` plus `set_config('request.headers', '{"x-bis-author":"{\"kind\":\"ai\"}"}', true)`, and expect `person` with the sub. Build the JSON with `JSON.stringify` in TS; there is no backslash in SQL.
   (c) The client path with an `import` header gives `import` with the sub.
   (d) The client path with header `{"kind":"ai"}` gives `person`, and with `{"kind":"person","via":"merge:5"}` it gives `person` with `via null`. With `via:"restore:12"` it gives `via 'restore:12'`.
7. `"enforce on: a service request with no author is refused and the update rolls back (mutation: step 5 writes NULL in enforce mode -> FAILS)"`: as owner, run `update app.record_changes_settings set enforce = true`. Then `asServiceWith(c)` with no author, and `refusal(...)` of an update expects SQLSTATE `42501` and the message `record_changes: a server write must say who made it`. Reading the contact afterwards shows it unchanged. **7b**, the same setup with NO claims at all (`reset role`, `set_config('request.jwt.claims','',true)`): the update succeeds and the row is `automation` with `via 'sql'` (correction 4). **7c**, enforce OFF with service and no author: the row's `author_kind` is NULL.
8. `"a client cannot write the log or claim ai through bis.author (mutation: read the GUC on the client path -> FAILS)"`: an authenticated INSERT into `record_changes` gives `42501`. `actAsMember` then `set_config('bis.author','ai',true)`, then an update gives `person`.
9. `"contact purge: value rows gone, one values-free delete row (mutation: keep value rows -> FAILS)"`: edit twice, then `delete from public.contacts where id = $1` as owner. For that `record_id` the only row left is `op 'delete'`, with `before null`, `after null` and `field null`. **9b**: `delete from public.accounts where id = $1` for a seeded account with contacts and change rows succeeds (correction 6). Mutation: remove the account-exists early return, and the delete FAILS with an FK violation.
10. `"the settings row is one row (mutation: drop the check (id) -> a second insert succeeds -> FAILS)"`.

   Run `cd packages/db && SUPABASE_DB_URL=postgresql://postgres@localhost:55992/pre pnpm exec vitest run src/test/record-changes-schema.test.ts`. Expected red: every case fails with `relation "public.record_changes" does not exist` (or the function is missing). Paste the summary.

- [ ] **Step 4: Write 0111.** Header sections, in order:
  - `WHY.` Spec §1–2 in four sentences: no field edit is recorded with its values today, and a trigger sees every write in its own transaction.
  - `WHAT.` Every object in "SQL interfaces".
  - `GRANTS.` Corrections 5 and 9.
  - `SEARCH PATHS.`
  - `LOCKS AND COST.` The Step 2/9 numbers.
  - `LOAD-BEARING.` (1) The role test sits in WHEN, never in the body (0103:200-203). (2) The definer is the only writer. (3) Observe until 0113. (4) A data migration that writes an audited table must `set_config('bis.author','automation',true)` or accept `automation/sql`. (5) Correction 6.
  - `ROLLBACK` (revert the app first): `drop trigger record_changes_client on public.contacts; drop trigger record_changes_server on public.contacts; drop function app.record_changes_capture(); drop function app.record_change_fields(text); drop table app.record_changes_settings;` then, OWNER DECISION ONLY and after an export, `drop table public.record_changes;` (it DESTROYS history).
  - The `ASCII only …` line, then the `lock_timeout` block (0106:149-153 verbatim).

The body:

```sql
-- 1. The log. No FK on record_id: the log outlives a removed row (0105's reason).
create table public.record_changes (
  id bigint generated always as identity primary key,
  account_id uuid not null references public.accounts (id) on delete cascade,
  record_type text not null constraint record_changes_record_type check (record_type in
    ('contact', 'client_group', 'client_group_member', 'place', 'equipment', 'opportunity',
     'contact_relationship', 'contact_tag')),
  record_id uuid not null,
  contact_id uuid,
  client_group_id uuid,
  op text not null constraint record_changes_op check (op in ('insert', 'update', 'delete')),
  field text,
  before jsonb,
  after jsonb,
  xact bigint not null default pg_catalog.txid_current(),
  author_kind text constraint record_changes_author_kind check (author_kind in ('person', 'ai', 'automation', 'customer', 'import')),
  author_id text,
  via text,
  created_at timestamptz not null default pg_catalog.now(),
  constraint record_changes_field_shape check ((op = 'update') = (field is not null)),
  constraint record_changes_author_id check (author_id is null or author_kind in ('person', 'import'))
);
create index record_changes_contact_idx on public.record_changes (account_id, contact_id, created_at desc, id desc);
create index record_changes_group_idx on public.record_changes (account_id, client_group_id, created_at desc, id desc)
  where client_group_id is not null;
create index record_changes_record_idx on public.record_changes (account_id, record_type, record_id, created_at desc);

-- 2. Observe or enforce. One row; 0113 turns enforce on.
create table app.record_changes_settings (
  id boolean primary key default true constraint record_changes_settings_one check (id),
  enforce boolean not null default false
);
insert into app.record_changes_settings default values;
revoke all on app.record_changes_settings from public, anon, authenticated, service_role;

-- 3. The audited columns per type. 0112 replaces this with every Q1 type.
create function app.record_change_fields(p_type text) returns text[]
language sql immutable set search_path = pg_catalog, pg_temp as $$
  select case p_type
    when 'contact' then array['first_name', 'last_name', 'email', 'phone', 'assigned_to', 'dnd', 'source',
                              'marketing_email_opted_out_at', 'language', 'custom']
  end
$$;
revoke all on function app.record_change_fields(text) from public, anon;
grant execute on function app.record_change_fields(text) to authenticated, service_role;

-- 4. The capture. DEFINER: it writes a table no API role can write.
create function app.record_changes_capture() returns trigger
language plpgsql security definer set search_path = pg_catalog, pg_temp as $$
declare
  v_type text := tg_argv[0];
  v_path text := tg_argv[1];
  v_fields text[] := app.record_change_fields(tg_argv[0]);
  v_row jsonb := pg_catalog.to_jsonb(case when tg_op = 'DELETE' then old else new end);
  v_old jsonb := case when tg_op <> 'INSERT' then pg_catalog.to_jsonb(old) end;
  v_new jsonb := case when tg_op <> 'DELETE' then pg_catalog.to_jsonb(new) end;
  v_claims jsonb := pg_catalog.nullif(pg_catalog.current_setting('request.jwt.claims', true), '')::jsonb;
  v_hdr jsonb;
  v_kind text; v_id text; v_via text;
  v_account uuid := (v_row ->> 'account_id')::uuid;
  v_contact uuid; v_group uuid; v_record uuid;
  f text; k text;
begin
  -- Correction 6: a cascade from the account (teardown) records nothing.
  if tg_op = 'DELETE' and not exists (select 1 from public.accounts a where a.id = v_account) then
    return null;
  end if;

  begin
    v_hdr := (pg_catalog.nullif(pg_catalog.current_setting('request.headers', true), '')::jsonb ->> 'x-bis-author')::jsonb;
  exception when others then
    v_hdr := null;   -- a malformed header is no author
  end;

  -- Who made the write (spec 2.3; corrections 4 and 9).
  if v_path = 'client' then
    v_kind := case when v_hdr ->> 'kind' = 'import' then 'import' else 'person' end;
    v_id := v_claims ->> 'sub';
    v_via := case when (v_hdr ->> 'via') ~ '^restore:[0-9]+$' then v_hdr ->> 'via' end;
  elsif pg_catalog.nullif(pg_catalog.current_setting('bis.author', true), '') is not null then
    v_kind := pg_catalog.current_setting('bis.author', true);
    v_id := pg_catalog.nullif(pg_catalog.current_setting('bis.author_id', true), '');
    v_via := pg_catalog.nullif(pg_catalog.current_setting('bis.via', true), '');
  elsif v_claims ->> 'role' = 'authenticated' then
    v_kind := 'person'; v_id := v_claims ->> 'sub';
  elsif v_claims ->> 'role' = 'service_role' and v_hdr ->> 'kind' in ('person', 'ai', 'automation', 'customer', 'import')
        and (v_hdr ->> 'kind' not in ('person') or pg_catalog.nullif(v_hdr ->> 'id', '') is not null) then
    v_kind := v_hdr ->> 'kind'; v_id := pg_catalog.nullif(v_hdr ->> 'id', ''); v_via := v_hdr ->> 'via';
  elsif v_claims is null then
    v_kind := 'automation'; v_via := 'sql';
  elsif (select s.enforce from app.record_changes_settings s) then
    raise exception 'record_changes: a server write must say who made it' using errcode = '42501';
  end if;
  if v_kind not in ('person', 'import') then v_id := null; end if;

  -- Where it shows.
  v_record := (v_row ->> 'id')::uuid;
  v_contact := case v_type when 'contact' then v_record else (v_row ->> 'contact_id')::uuid end;
  v_group := (v_row ->> 'client_group_id')::uuid;

  if tg_op = 'INSERT' then
    insert into public.record_changes (account_id, record_type, record_id, contact_id, client_group_id, op, after,
                                       author_kind, author_id, via)
    select v_account, v_type, v_record, v_contact, v_group, 'insert',
           (select pg_catalog.jsonb_object_agg(x, v_new -> x) from pg_catalog.unnest(v_fields) x),
           v_kind, v_id, v_via;
  elsif tg_op = 'DELETE' then
    if v_type = 'contact' then
      -- Spec 2.2: the old values do not outlive a deletion the Owner asked for; the fact does.
      delete from public.record_changes r where r.account_id = v_account and r.contact_id = v_record;
      insert into public.record_changes (account_id, record_type, record_id, contact_id, op, author_kind, author_id, via)
      values (v_account, v_type, v_record, v_record, 'delete', v_kind, v_id, v_via);
    else
      insert into public.record_changes (account_id, record_type, record_id, contact_id, client_group_id, op, before,
                                         author_kind, author_id, via)
      select v_account, v_type, v_record, v_contact, v_group, 'delete', v_old, v_kind, v_id, v_via;
    end if;
  else
    foreach f in array v_fields loop
      if f = 'custom' then
        for k in select pg_catalog.jsonb_object_keys(coalesce(v_old -> 'custom', '{}'::jsonb))
                 union select pg_catalog.jsonb_object_keys(coalesce(v_new -> 'custom', '{}'::jsonb)) loop
          if (v_old -> 'custom' -> k) is distinct from (v_new -> 'custom' -> k) then
            insert into public.record_changes (account_id, record_type, record_id, contact_id, client_group_id, op, field,
                                               before, after, author_kind, author_id, via)
            values (v_account, v_type, v_record, v_contact, v_group, 'update', 'custom.' || k,
                    v_old -> 'custom' -> k, v_new -> 'custom' -> k, v_kind, v_id, v_via);
          end if;
        end loop;
      elsif (v_old -> f) is distinct from (v_new -> f) then
        insert into public.record_changes (account_id, record_type, record_id, contact_id, client_group_id, op, field,
                                           before, after, author_kind, author_id, via)
        values (v_account, v_type, v_record, v_contact, v_group, 'update', f, v_old -> f, v_new -> f, v_kind, v_id, v_via);
      end if;
    end loop;
  end if;
  return null;
end $$;
revoke all on function app.record_changes_capture() from public, anon, authenticated, service_role;

-- 5. Contacts. The role test is in WHEN, which runs in the caller's context (0103:200-203).
create trigger record_changes_client after insert or update or delete on public.contacts
  for each row when (current_user = 'authenticated')
  execute function app.record_changes_capture('contact', 'client');
create trigger record_changes_server after insert or update or delete on public.contacts
  for each row when (current_user <> 'authenticated')
  execute function app.record_changes_capture('contact', 'server');

-- 6. Read: Owners, Staff, BIS. Technicians none (Q2).
alter table public.record_changes enable row level security;
revoke all on public.record_changes from public, anon, authenticated, service_role;
grant select on public.record_changes to authenticated, service_role;
```

  NOTE (the reviewer checks this): `WHEN` cannot reference `old` on INSERT or `new` on DELETE, but a bare `current_user` test is valid for all three ops. If PG rejects a WHEN on a multi-event trigger, split each trigger into three (insert/update/delete) with the same names plus `_ins`/`_upd`/`_del`.

  **The read policy:** copy the `events` table's SELECT policy from its newest definition. That is the 0109 InitPlan form, located with `grep -n "on public.events" packages/db/supabase/migrations/0109_policy_initplans.sql`, together with 0068's restrictive `events_technician_none` (`MIG/0068:144-145`). Rename them `record_changes_read` and `record_changes_technician_none`, keeping every function call wrapped in `(select …)` exactly as 0109 does. Paste both source policies and both new ones in your report. The reviewer diffs them word for word apart from the names.

- [ ] **Step 5: Pins.** In `definer-search-path.test.ts`, change the count comment at :25 to 39 and add `"app.record_changes_capture()": PG_CATALOG_PG_TEMP,` in its alphabetical place. Spec test 11's mutation: remove `set search_path` from the function on the replica, and the pin FAILS by name.

- [ ] **Step 6: Green on the replica.** Run `sh pg17-t1.sh post`; expected `0111 apply exit 0`. Then run the Step 3 command against `/post`. Expected: `Tests  10 passed` (plus sub-cases). Run each named mutation, show the case failing by name, and revert. Paste each failure line and the final summary.

- [ ] **Step 7: The RLS test.** Create `record-changes-rls.test.ts` (spec test 3; mutation: drop `record_changes_technician_none` → the Technician case FAILS). Seed two accounts, each with a contact and one change row made as owner. Then:
  - `actAsMember(…, "owner")` of A sees A's rows only (B's: 0).
  - `"staff"` sees A's rows.
  - `"technician"` sees 0, even for a contact assigned to them.
  - The agency claims (`actAs(c, { org_id: <agency org>, app_role: "agency_admin" })`: copy how `contact-archive-rls` or `events` RLS tests express the agency, by grep) see A's rows.

  Run it against `/post`; expected all green; mutation shown.

- [ ] **Step 8: The live test (CI only; write it, do not run it).** Create `record-changes-live.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { withTestAccount } from "./fixtures";
import { createContact } from "../contacts";

/** End-to-end through Kong, PostgREST and supabase-js (A1, A2): the header a service write carries is the author
 *  the database records. CI's local stack only (withTestAccount). */
describe("record_changes through the API", () => {
  it("a service update with an x-bis-author header is recorded as that author (mutation: drop the step-4 branch -> FAILS)", () =>
    withTestAccount(async (db, accountId) => {
      const c = await createContact(db, accountId, { firstName: "Rc", phone: "+19565550111" }, /* T2 adds author */);
      const r = await db.from("contacts").update({ dnd: true }).eq("id", c.id).eq("account_id", accountId)
        .setHeader("x-bis-author", JSON.stringify({ kind: "ai", via: "ai_act:00000000-0000-0000-0000-000000000111" }));
      expect(r.error).toBeNull();
      const { data } = await db.from("record_changes").select("field, author_kind, author_id, via")
        .eq("record_id", c.id).eq("op", "update");
      expect(data).toEqual([{ field: "dnd", author_kind: "ai", author_id: null, via: "ai_act:00000000-0000-0000-0000-000000000111" }]);
    }));
});
```

  Read `createContact`'s current signature first and pass what it needs today. T2 changes it and updates this call. If T0 chose the A2 fallback, use `serviceDbAs` instead of `.setHeader`.

- [ ] **Step 9: Measure after.** Run the two timings on `post` (see below). Write both tables into 0111's `LOCKS AND COST.` section (before, after, delta %, and rows written per op). Target: under +20% wall time. If it misses: stop and report the numbers, and do not optimise without the orchestrator.

- [ ] **Step 10: Whole-suite smoke on the replica in enforce mode.** On a scratch copy (`create database enf template post`), run `update app.record_changes_settings set enforce = true`, then `SUPABASE_DB_URL=…/enf pnpm exec vitest run src/test/*-schema.test.ts src/test/*-rls.test.ts`. List every case that now fails with `a server write must say who made it` (a test seeding as service_role with no author). For each, either (a) the test seeds with `set_config('request.headers', …automation…)`, if it is that test's own fixture, or (b) report it for T2 if it exercises an app path. Paste the before/after summary. (CI's verify will hit the same set once T2's switch lands.)

- [ ] **Step 11: Commit** `feat(db): 0111 record_changes, the change log every contact write fills, observe mode (F-115/S-04)` -- the five paths. Report the replica digest and definer count on `post` (digest unchanged, count 39).

#### Measure first (T1 Steps 2 and 9): the replica timing method

- **Database per run:** `drop database if exists cost with (force); create database cost template pre` (or `template post` for the after run), with timezone UTC. There are three runs each for before and after, and the median is reported. Use `\timing on` in a psql script file and run it with `psql -h localhost -p 55992 -U postgres -d cost -v ON_ERROR_STOP=1 -f <file>`.
- **Seed (as postgres, no claims, so 0111's rows are `automation/sql`; the seed is excluded from timing):** one agency, one account, one Owner user plus membership (copy `actAsMember`'s inserts from `packages/db/src/test/db.ts:33-42`), 500 contacts (`generate_series`, phones `'+1956555' || lpad(i::text,4,'0')`), and a second user to assign to.
- **Timing 1, the 500-contact bulk assign as the app sends it:** `begin; select set_config('request.jwt.claims', '{"role":"authenticated","sub":"<owner sub>","org_id":"<org>","app_role":"owner"}', true); set local role authenticated;` then `update public.contacts set assigned_to = '<user2>' where account_id = '<a>' and id = any(<the 500 ids>);` then `commit;`. Record the update's `Time:`. After 0111, also record `select count(*) from public.record_changes where field = 'assigned_to'`, which must be 500.
- **Timing 2, the 10,000-message merge:** seed contact K and contact O, one conversation for O, and 10,000 messages on O. Read the minimal NOT NULL columns of `conversations` and `messages` from their migrations (`grep -n "create table public.messages" -A30 packages/db/supabase/migrations/*.sql`). Give O a different `email` and `phone` so the merge overwrites two fields. As the Owner (claims as above), time `select public.merge_contacts('<a>', '<K>', '<O>', '<choices>'::jsonb, '<seen>'::jsonb)`, building `p_choices`/`p_seen` the way `packages/db/src/test/contact-merge-schema.test.ts` does (copy its smallest valid call). Record the time and the change rows written.
- **Report form** (into 0111's header and the task report):

```text
-- LOCKS AND COST. Measured on a PG 17.6 replica, median of 3, <date>:
--   500-contact bulk assign (as an Owner): before <x> ms, after <y> ms (+<p>%); 500 change rows.
--   merge moving 10,000 messages: before <x> ms, after <y> ms (+<p>%); <n> change rows.
--   ~<b> bytes per change row (pg_column_size avg over the 500).
```

T3 Step 6 re-runs Timing 2 after 0112, because the merge then also writes `via` and touches the other Q1 tables.

---

### Task 2: Every contact write says who made it

**Tier:** HIGH · **Owners:** bis-crm (Steps 1–6, 8), bis-voice (Step 7, voice and web-chat writes), bis-platform (Step 9, the CI switch) · **Lane:** 1 · **PR:** A · **Depends on:** T1 committed

**Files:**
- Create: `packages/db/src/row-author.ts`, `packages/db/src/row-author.test.ts`
- Modify: `packages/db/src/index.ts` (export the four names)
- Modify: `packages/db/src/contacts.ts`: `updateContact` :572, `fillContactBlanks` :623, `fillContactBlanksReport` :646, `restoreContactFieldIf` :745, `recordLanguageSignal` :1637, `writeLanguage` :1659, `setContactLanguage` :1674, `restoreContactLanguage` :1700, `setContactPhoneCountry` :1572, `createContact`, and every other function in the file that inserts, updates or deletes `contacts` (Step 1's inventory decides)
- Modify: `packages/db/src/assignment.ts:336-339` (`reassignReleased`), `packages/db/src/contact-import.ts:142-191`, `packages/db/src/ai-acts.ts:125-128`, `apps/web/src/lib/forms/enrich.ts:401-416` (`setAttribution`: `attribution` is EXCLUDED, but the update still fires the trigger and must carry an author), and each caller Step 1 lists
- Create: `apps/web/src/lib/automations/passes/record-changes-audit.ts` + `.test.ts`; modify `apps/web/src/lib/automations/registry.ts:77` and `fanout.ts:81-82`
- Modify: `.github/scripts/ci-local-supabase.sh:305-308` (Step 9)
- Modify: `packages/db/src/test/record-changes-live.test.ts` (the `createContact` call's author)

**Interfaces:** consumes `RowAuthor`, `AuthorKind`, `contactAuthor` (`provenance.ts:9,8,47`), `isUserClient` (`user-client.ts:30`) and `ActorType` (`events.ts:4`). Produces the four `row-author.ts` functions in "TypeScript interfaces". Every contact writer's `(actorId, actorType)` pair becomes **one required `author: RowAuthor`**, in the same position.

- [ ] **Step 1: The inventory (no code).** List every write to an audited table's rows. Run `grep -rn 'from("contacts")' packages/db/src apps/web/src --include=*.ts | grep -v test` and keep the lines whose chain has `.insert(`, `.update(`, `.upsert(` or `.delete(` (read 3 lines around each). Add every `rpc(` to a function that writes `contacts`: `grep -n "update public.contacts\|insert into public.contacts\|delete from public.contacts" packages/db/supabase/migrations/*.sql`, take the function names, then grep their `rpc("…")` callers. For each line, record: file:line, client (user / service / unknown), today's actor, and the author it must send. Use this table:

| Path | Author |
|---|---|
| signed-in staff (`dbForRequest()`) | none needed (client path); still pass `author` |
| CSV import (`contact-import.ts`, user client) | `{authorKind:"import", authorId: userId}` |
| form submit, booking page, inbound SMS creating/filling a contact | `customer` |
| Sofía voice tools, web chat | `ai`, `via: ai_act:<uuid>` when an act is logged |
| cron passes, assignment release (`assignment.ts:339`) | `automation` |
| language signal from the customer's own message/booking | `customer`; staff setter: `person` |
| undo of an AI act (`ai-acts.ts:128`, service) | `person` (the undoer), `via: ai_act:<act id>` |

  Paste the table in your report; it is the checklist for Steps 5–7. Anything that cannot be classified is a question for the orchestrator, not a guess.

- [ ] **Step 2: `row-author.ts`, red first.** Write `row-author.test.ts` (pure; no Supabase variable):

```ts
import { describe, it, expect } from "vitest";
import { authorHeaderValue, withAuthor, requireAuthor, eventActorOf, AUTHOR_HEADER } from "./row-author";
import { contactAuthor } from "./provenance";

describe("row-author", () => {
  it("serialises kind, id and via (mutation: drop via -> FAILS)", () => {
    expect(JSON.parse(authorHeaderValue({ authorKind: "ai", authorId: null }, "ai_act:a"))).toEqual({ kind: "ai", via: "ai_act:a" });
    expect(JSON.parse(authorHeaderValue({ authorKind: "person", authorId: "user_1" }))).toEqual({ kind: "person", id: "user_1" });
  });
  it("refuses a person with no id (mutation: remove the guard -> FAILS)", () => {
    expect(() => authorHeaderValue({ authorKind: "person", authorId: null })).toThrow(/person author needs an id/);
  });
  it("withAuthor sets exactly the one header (mutation: wrong header name -> FAILS)", () => {
    const calls: [string, string][] = [];
    const b = { setHeader(n: string, v: string) { calls.push([n, v]); return b; } };
    expect(withAuthor(b, { authorKind: "automation", authorId: null })).toBe(b);
    expect(calls).toEqual([[AUTHOR_HEADER, '{"kind":"automation"}']]);
  });
  it("requireAuthor refuses a service client with no author, at runtime (mutation: return undefined -> FAILS)", () => {
    const service = {} as never;   // isUserClient(service) is false
    expect(() => requireAuthor(service, undefined, "updateContact")).toThrow(/updateContact: a server write must say who made it/);
  });
  it("eventActorOf is the inverse of contactAuthor for every pair it produces (mutation: map customer to ai -> FAILS)", () => {
    for (const [t, id] of [["user", "user_1"], ["ai", "sofia"], ["system", "system"]] as const) {
      const a = contactAuthor(t, id);
      expect(contactAuthor(eventActorOf(a).actorType, eventActorOf(a).actorId)).toEqual(a);
    }
  });
});
```

  Read `contactAuthor` and `SEED_ACTORS` (`provenance.ts:39-49`) first. Replace the three pairs in the last case with EVERY pair `contactAuthor` distinguishes. Red: module not found.

- [ ] **Step 3: Implement** `row-author.ts`:

```ts
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ActorType } from "./events";
import type { RowAuthor } from "./provenance";
import { isUserClient } from "./user-client";

/** The header 0111's app.record_changes_capture() reads on a service-role request (spec 2.3 step 4). */
export const AUTHOR_HEADER = "x-bis-author";

export function authorHeaderValue(author: RowAuthor, via?: string): string {
  if (author.authorKind === "person" && !author.authorId) throw new Error("withAuthor: a person author needs an id");
  return JSON.stringify({ kind: author.authorKind, ...(author.authorId ? { id: author.authorId } : {}), ...(via ? { via } : {}) });
}

/** Attach who made this write to ONE query. Harmless on a user client: the database takes the token there. */
export function withAuthor<B extends { setHeader(name: string, value: string): B }>(builder: B, author: RowAuthor, via?: string): B {
  return builder.setHeader(AUTHOR_HEADER, authorHeaderValue(author, via));
}

/** The runtime half of "required" (spec test 12): a JS caller or a cast cannot skip the author on a service client. */
export function requireAuthor(db: SupabaseClient, author: RowAuthor | undefined, writer: string): RowAuthor {
  if (!author && !isUserClient(db)) throw new Error(`${writer}: a server write must say who made it`);
  return author as RowAuthor;
}
```

  Add `eventActorOf` as the exact inverse of `contactAuthor` (Step 2 proves it). Export all four from `index.ts`. Green; paste.

- [ ] **Step 4: The compile-time pin, red first.** Append to `packages/db/src/row-author.test.ts`:

```ts
import { updateContact } from "./contacts";
it("updateContact does not compile without an author (mutation: make author optional -> tsc FAILS on the unused directive)", () => {
  // @ts-expect-error author is required
  void (() => updateContact({} as never, "a", "c", { dnd: true }));
  expect(true).toBe(true);
});
```

  `pnpm --filter @bis/db typecheck` is red today, because the call is valid, so the directive is unused. That is the red.

- [ ] **Step 5: Convert the writers in `packages/db`.** For each Step 1 row in `packages/db/src`:
  - Replace `actorId, actorType = "user"` with `author: RowAuthor`, and start the function with `author = requireAuthor(db, author, "<name>")`.
  - Wrap the audited write: `withAuthor(db.from("contacts").update(patch).eq(…), author, via)`.
  - For `emit`, use `const { actorId, actorType } = eventActorOf(author)`.
  - Writers that already take `RowAuthor` for creation (`createContact`, `contacts.ts:43`) keep it and gain `withAuthor` on the insert.

  Run `pnpm --filter @bis/db typecheck`. The errors are now every caller, which is the list for Step 6. Then run the affected pure db tests by file (`row-author.test.ts`, `contacts.test.ts` only if it is a withRollback file; check its header first).
- [ ] **Step 6: Convert the callers in `apps/web`** (bis-crm). Fix every typecheck error by passing the author from Step 1's table. Staff server actions pass `{ authorKind: "person", authorId: userId }`. Never invent `person` without a real Clerk id; when an action has none, stop and report. Run `pnpm --filter web typecheck` (0 errors), `pnpm --filter web lint`, and the vitest files of each touched folder.
- [ ] **Step 7: Voice and web chat** (bis-voice). In the voice tool writers and the web-chat contact writes (Step 1's rows under `apps/web/src/lib/voice*`, `app/api/*voice*`, `lib/web-chat*`), when an `ai_acts` row is logged for the write, generate its id FIRST (`crypto.randomUUID()`), pass `via: \`ai_act:${id}\`` to the writer, and insert the act with that same `id`. When no act is logged, use `{authorKind:"ai", authorId:null}` with no `via`. Add one unit test per converted tool asserting the writer was called with `via` equal to the act's id (mutation: generate two different uuids → FAILS).
- [ ] **Step 8: The audit pass, red first** (bis-crm). Create `record-changes-audit.test.ts`. Mock `@bis/db` bare, as the other pass tests do; copy the mock shape from `passes/documents-sweep.test.ts`. Assert three things:
  - `run(ctx)` with a head count of 0 returns `{ unattributed: 0 }`.
  - A count of 3 throws `record_changes: 3 unattributed changes in the last 24 hours`. Mutation: return instead of throw → FAILS.
  - `{count: null, error: null}` THROWS `record_changes: the unattributed count could not be read`. Mutation: `count ?? 0` → FAILS. This is the head-count-null rule.

  Implement `passes/record-changes-audit.ts`:

```ts
import type { Pass } from "../context";

/** F-115: the daily proof that every server path names its author. Red heartbeat while any path does not. */
export const recordChangesAuditPass: Pass = {
  key: "recordChangesAudit",
  async run(ctx) {
    const { serviceDb } = await import("@bis/db");
    const since = new Date(ctx.now.getTime() - 24 * 60 * 60 * 1000).toISOString();
    const { count, error } = await serviceDb().from("record_changes").select("id", { count: "exact", head: true })
      .is("author_kind", null).gte("created_at", since);
    if (error || count === null) throw new Error("record_changes: the unattributed count could not be read");
    if (count > 0) throw new Error(`record_changes: ${count} unattributed changes in the last 24 hours`);
    return { unattributed: 0 };
  },
};
```

  Read `context.ts:59-70` first and use `PassContext`'s real clock field and its real way of reaching `serviceDb` (copy `documents-sweep.ts:25-40`). Register it in `registry.ts:77`, plus `n("recordChangesAudit", [])` in `fanout.ts`. If `HEARTBEAT_KEYS` (`ops.ts:12`) must list it, add it there.
- [ ] **Step 9: CI enforce switch** (bis-platform). In `.github/scripts/ci-local-supabase.sh`, right after `supabase db push --local …` (:305) and before the `notify pgrst` line, add:

```sh
# F-115 (0111): CI refuses any server write that does not say who made it, so a test that covers an unconverted
# path fails here instead of writing an unattributed row in production. Production stays in observe mode until 0113.
psql "$db_url" -X -q -v ON_ERROR_STOP=1 -c "update app.record_changes_settings set enforce = true"
```

  The e2e job seeds AFTER this (`ci:seed:local`). If the seed writes contacts through a service client with no author, convert those writes to `withAuthor(…, { authorKind: "automation", authorId: null }, "seed")`. Never move the switch after the seed. Proof is CI's run on the PR head: verify and e2e green, read by the orchestrator FOR THE HEAD SHA.
- [ ] **Step 10: Commit per owner**, each with only its paths:
  - `feat(db): every contact writer takes the author and sends it with the write (F-115)`
  - `feat(web): every contact write path says who made it; the daily unattributed count (F-115)`
  - `feat(voice): Sofia's contact writes carry their act id (F-115)`
  - `ci: the local stacks refuse a server write that does not say who made it (F-115)`

---

### Task 3: 0112 — the rest of Q1, and definers that name their author

**Tier:** HIGH · **Owners:** bis-db-schema (SQL, tests), bis-crm (TS writers, Step 7) · **Lane:** 1 · **Port:** 55993 · **PR:** B · **Depends on:** T2 merged (PR A), 0111 on production

**Files:**
- Create: `packages/db/supabase/migrations/0112_record_changes_q1.sql`, `packages/db/src/test/record-changes-q1-schema.test.ts`
- Modify: the TS writers of `client_groups`, `client_group_members`, `places`, `equipment`, `opportunities`, `contact_relationships`, `contact_tags` (`packages/db/src/client-groups.ts`, `places.ts`, `opportunities.ts`, the relationship and tag writers found by grep) and their callers

**What 0112 does:**
1. `create or replace function app.record_change_fields(text)` with every type. Each table gets the column pin of T1 Step 3's case 3, with its own AUDITED/EXCLUDED map. The decision rule: what a person typed or chose is AUDITED; ids, `account_id`, timestamps, derived keys and creation provenance are EXCLUDED. The starting point (the implementer confirms each against `\d`):
   - `client_group`: `name, kind`
   - `client_group_member`: `role` (if it exists) plus insert/delete
   - `place`: `label`, address columns, `notes`
   - `equipment`: `name`, `make`, `model`, `serial`, `installed_on`, `replaces_id`, `notes`
   - `opportunity`: `name, stage_id, pipeline_id, value, assigned_to, status, close_date`
   - `contact_relationship`: `related_contact_id, label_key, custom_label`
   - `contact_tag`: insert/delete only (empty update list)
2. Two triggers per table, as T1 Step 4 §5, with the record_type as the first argument. In the capture function, `contact_tag` uses `tag_id` as `record_id`. Patch the `v_record` line to `coalesce((v_row->>'id')::uuid, (v_row->>'tag_id')::uuid)`. `equipment` resolves its contact and group from its place: add `if v_type = 'equipment' then select p.contact_id, p.client_group_id into v_contact, v_group from public.places p where p.id = (v_row->>'place_id')::uuid; end if;`. Child deletes return early when their contact or group no longer exists (correction 6). `client_group` rows set `client_group_id = record_id`. Re-create the capture function in full with `create or replace`, keeping T1's body plus exactly these three changes; the reviewer diffs it against 0111.
3. Definers that name their author (each is `create or replace` of its newest body, copied verbatim, plus the lines below; locate each body's newest definition by grep across 0103–0110):
   - `public.merge_contacts` (`MIG/0106:880`): right after the `contact_merges` row is inserted and its id is known, run `perform pg_catalog.set_config('bis.author', 'person', true); perform pg_catalog.set_config('bis.author_id', coalesce(p_actor, app.jwt() ->> 'sub'), true); perform pg_catalog.set_config('bis.via', 'merge:' || <merge id var>, true);`, and reset all three to `''` before every `return` (correction 7). **If any overwrite of a contact column happens BEFORE the merge row's insert in 0106's body, stop and report;** do not reorder without review.
   - `public.undo_contact_merge` (`MIG/0106:1229`): the same, with `via 'merge:' || p_merge_id`.
   - `public.restore_contact_on_sign` (`MIG/0103:221`): `bis.author = 'customer'`, with no id and no via.
   - `public.delete_internal_contacts` (`MIG/0103:297`): if its TS caller uses a user client (check `bulk-action-bar.tsx:276-283`'s action), it needs NO change (precedence step 3 gives `person`); prove it with test 4 below instead. If its caller is a service client, set `person` from `app.jwt() ->> 'sub'`.
   - The 0091 undos need no change (correction 3).
4. `public.put_back_contact_custom(p_account_id uuid, p_contact_id uuid, p_key text, p_expected jsonb, p_value jsonb) returns boolean`. It is SECURITY INVOKER (RLS applies; on a user client it takes the client path, so a person mark), `set search_path = pg_catalog, pg_temp`, and runs `update public.contacts set custom = case when p_value is null then custom - p_key else pg_catalog.jsonb_set(coalesce(custom, '{}'), array[p_key], p_value) end where account_id = p_account_id and id = p_contact_id and (custom -> p_key) is not distinct from p_expected returning true`. Grant execute to `authenticated`; revoke from `public, anon`. It is not a definer, so `EXPECTED_DEFINERS` does not change.

**Steps** (red first; replica port 55993 with `init` skipping `0112_*`, and `post` applying 0111 then 0112):

- [ ] **Step 1:** Column pins per table (mutation: add a column to `places` → FAILS naming it).
- [ ] **Step 2:** Per table, a signed-in edit writes one row per changed field with the right `contact_id`/`client_group_id`. The equipment row carries its place's contact (mutation: drop the equipment lookup → `contact_id` null → FAILS).
- [ ] **Step 3, spec test 10:** `merge_contacts` as an Owner gives one row per overwritten field with `via = 'merge:<id>'` and `person`. `undo_contact_merge` writes the reverse rows with the same `via`. Mutation: remove the `set_config` → FAILS.
- [ ] **Step 4, test 10b (correction 7):** in one transaction, `merge_contacts`, then `asServiceWith(c)` with no author and a contact update with enforce ON, raises `42501`. The merge's `person` did not leak (mutation: drop the reset → no raise → FAILS). Also: `delete_internal_contacts` as an Owner leaves a values-free `delete` row marked `person` with the Owner's sub.
- [ ] **Step 5:** `restore_contact_on_sign` gives `customer`. A contact delete cascades to `contact_tags`/`client_group_members`/`contact_relationships`/`places` and leaves only the contact's values-free row, with no child value rows (mutation: drop the child early return → FAILS). `put_back_contact_custom`: matching expected → true plus one `custom.<key>` row; stale → null and no row (mutation: drop the `is not distinct from` → FAILS).
- [ ] **Step 6:** Re-run Timing 2 (T1's method) on `post`. Add the after-0112 numbers to 0112's `LOCKS AND COST.`.
- [ ] **Step 7 (bis-crm):** Convert the writers of the seven tables exactly as T2 Steps 5–6 did: required `author`, `withAuthor`, `requireAuthor`. Include `removeEquipment`/`restoreEquipment` (`places.ts:444,460`), `restoreMembership` (`client-groups.ts:405`, rpc `restore_group_membership`) and `updateOpportunity`. `pnpm --filter @bis/db typecheck`, `pnpm --filter web typecheck`, lint, and the touched folders' tests.
- [ ] **Step 8:** Commit, one per owner: `feat(db): 0112 history for households, places, equipment, deals, relationships and tags; merges and restores name their author (F-115)` and `feat(crm): every Q1 writer says who made the write (F-115)`.

---

### Task 4: The reader — the `changes` timeline source

**Tier:** MEDIUM · **Owner:** bis-crm · **Lane:** 2 · **PR:** C · **Depends on:** T1 committed (a branch with 0111)

**Files:**
- Create: `packages/db/src/record-changes.ts`, `packages/db/src/record-changes.test.ts` (pure)
- Modify: `packages/db/src/record.ts:278-282` (add `"changes"` to `TimelineSource` and `TIMELINE_SOURCES`), `:535-537` (opts gains `changes?: boolean`), and the source switch near `:616-630`
- Modify: `apps/web/src/lib/record/loaders.ts:100-104` (pass `changes: true`), `group-loaders.ts:142` (pass `changes: true`), `recent-rows.ts:55-66` (a `change` case returning `null`, exhaustive), `timeline-rows.ts:55-60` (`changes: "timeline.what.changes"`)

- [ ] **Step 1: Pure tests, red first.** Write `record-changes.test.ts` with fixed `ChangeRow` fixtures:
  - Rows with the same `xact` and `recordId` form one group; different `xact` values form two groups. Mutation: group by `createdAt` → FAILS on two writes in the same second.
  - Two groups by the same author on the same record, 9 minutes apart, collapse into one with `steps.length === 2`; 11 minutes apart they stay two. Mutation: compare with `<=` 11 → FAILS.
  - A different author or a different record never collapses.
  - `foldVia` drops a group whose `via` is `merge:7` when `mergeIds` has `"7"`, and keeps it when the merge row is not on the page (spec risk 6). The same holds for `ai_act:` and `proposal:`. `restore:` never folds.
  - `null` `authorKind` groups are kept (observe mode).
- [ ] **Step 2: Implement** `groupChanges` and `foldVia` (pure, with `COLLAPSE_MINUTES = 10`, comparing on `createdAt` ms). Then add `listChangeRows`: on the caller's client (RLS), it selects the `ChangeRow` columns from `record_changes`, scoped `.eq("account_id", accountId)` plus `.in("contact_id", contactIds)` or `.eq("client_group_id", groupId)`, with `.lt("created_at", before)` when given, `.order("created_at", { ascending: false }).order("id", { ascending: false })` and `.limit(limit)`. It maps snake_case to `ChangeRow`.
- [ ] **Step 3: Wire it into `listTimelinePage`** exactly as `aiActs` is wired at `record.ts:623`: only when `opts.changes`, on the same `before`/`limit`, errors through `onError("changes")`. The timeline item variant is `{ kind: "change"; at: string; group: ChangeGroup }`, built by `foldVia(groupChanges(rows), <ids of the merge, ai_act and suggestion items on this page>)`. Read how the page's merge, AI-act and suggestion items expose their ids, and build the three sets from them. Tombstones: the record loader already passes `[contactId, ...tombstones]` (`mergedIdsOf`). Keep it.
- [ ] **Step 4: Loaders.** Add `changes: true` to the record loader (:100-104) and the group loader (:142); the drawer (:210-213) stays without it. In `recent-rows.ts`, add `case "change": return null;`, and confirm `tsc` would fail without it (the switch is exhaustive). Add `changes: "timeline.what.changes"` to `SOURCE_KEY` and its two catalogue keys (see Copy; T5 owns `messages.ts` but T4 adds only these two, in one commit, with T5 told).
- [ ] **Step 5: A web test** in `apps/web/src/lib/record/loaders.test.ts` (or its existing equivalent): the record loader asks for `changes`, the drawer does not, and a failed `changes` read names `"changes"` in `failed`. Mutation: the drawer passes `changes: true` → FAILS. Run the folder's tests plus both typechecks and lint.
- [ ] **Step 6:** Commit `feat(crm): the record timeline reads its change history, grouped per write (F-115)`.

---

### Task 5: The change rows on the timeline (UI)

**Tier:** MEDIUM · **Owner:** bis-frontend · **Lane:** 2 · **PR:** E (**merges only after T7's 0113 is on production**) · **Depends on:** T4, T6 (buttons call T6's actions)

**Files:**
- Create: `apps/web/src/lib/record/change-rows.ts` + `.test.ts` (pure: verb, field labels, value formatting)
- Create: `apps/web/src/components/record/change-item.tsx` + `.test.tsx`
- Modify: the timeline renderer that switches on item kinds (find it with `grep -rn '"aiAct"' apps/web/src/components/record`), `apps/web/src/lib/messages.ts` (the Copy section's keys, sole writer in PR E), `apps/web/src/app/(dashboard)/styleguide/…` (a ChangeItem entry, if the disclosure is new to the kit)

**Behaviour:**
- One `TimelineItem` (`components/record/timeline-item.tsx:13,39`) per `ChangeGroup`.
  - `mark` comes from the group's author, through the existing author-mark helper (`apps/web/src/lib/record/author-mark.ts:13-17`). A person the reader cannot name is "Someone on the team". An `import` with an id is "Import · <name>". A NULL author (only possible before 0113) renders the automation mark; this is why PR E waits for 0113.
  - `verb` is the Copy section's `history.verb.changed` with the field list. Its parts are `history.field.*`, joined with `Intl.ListFormat(locale, { type: "conjunction" })`, which gives "changed phone and email" / "cambió el teléfono y el correo". It is `history.verb.added` for an insert and the per-type removal verbs for a delete.
  - `detail` is a disclosure (`<details>`/`<summary>`, keyboard reachable, 44 px target). Its label is `history.steps` plus `plural()` when `steps.length > 1`. Inside, one line per field: label, "Was"/"Antes" and old value, "Now"/"Ahora" and new value. On a phone (below `sm`) the two values stack on two lines with their word labels.
- Values:
  - Phones go through the app's phone formatter (the one the contact card uses; find it by grep).
  - `assigned_to` uses `listPeopleNames` (`record.ts:649`), else "Someone on the team".
  - `custom.<key>` takes its label from the account's custom fields, else the key.
  - null or "" shows "(blank)"/"(vacío)"; booleans show "Yes"/"No" and "Sí"/"No"; timestamps use the record page's date formatter in the account zone.
- Actions (ghost buttons, rule 8) call T6's bound actions:
  - "Put back" appears per field when `canPutBack(row)` and the reader is Owner/Staff/agency.
  - "Restore" appears on a removal row while `canRestore(row, now)`, with `now` passed from the server page, never `Date.now()` in the component.
  - Both run at once and show an Undo toast (rule 6). The stale answer shows `history.putBack.changed`.
  - The Owner-only `history.download` link goes to T8's route.
- States: the timeline's own loaded, empty and skeleton states. A failed `changes` read appears in the partial-failure line through `SOURCE_KEY` (T4).

**Steps:**
- [ ] **Step 1:** `change-rows.test.ts`, red first. Verb and list per locale; "(blank)"; Sí/No; a phone formatted; `plural()` at 1 ("1 change"/"1 cambio") and at 3. Mutation: use `count === 0` for `One` → FAILS at 1.
- [ ] **Step 2:** Implement, then green.
- [ ] **Step 3:** `change-item.test.tsx`. Every rendered row has a mark (mutation: render with `mark` undefined → FAILS; the provenance rule). EN and ES snapshots of the strings. The Put back click calls the action and shows the Undo toast. Put back is hidden for a Technician.
- [ ] **Step 4:** Renderer wiring, styleguide entry, the pseudo-locale check at 375 px (`pseudo-locale.test.ts` pattern), and both themes via `.dark`. Run `pnpm --filter web typecheck`, lint and the touched folders' tests. Then bis-design-reviewer audits the diff against the DESIGN.md definition of done.
- [ ] **Step 5:** Commit `feat(record): who changed what, on the record's timeline, with Put back and Restore (F-115)`.

---

### Task 6: Put back and Restore

**Tier:** HIGH (it writes customer data on a person's behalf) · **Owner:** bis-crm · **Lane:** 2 · **Port:** 55994 · **PR:** C · **Depends on:** T3 (0112 and its writers), T4

**Files:**
- Create: `packages/db/src/record-restore.ts`, `packages/db/src/record-restore.test.ts` (pure parts), `packages/db/src/test/record-restore-schema.test.ts` (withRollback, replica with 0111 and 0112)
- Create: `apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/contacts/history-actions.ts` + `.test.ts`; the group page's twin beside `groups/[groupId]/page.tsx`, if its actions live there
- Possibly modify: `packages/db/src/places.ts` (add `restorePlace(db, accountId, snapshot, ctx)` mirroring `restoreEquipment` :460, only if none exists; grep `restorePlace` first)

**Rules:**
- **Who:** Owners, Staff and agency; never Technicians. Reuse exactly the role check `contacts/archive-actions.ts` uses (read it), and refuse with `not_allowed` before any read.
- **Put back** (`op = 'update'`): only for the audited columns of `contact`, `client_group`, `place`, `equipment`, `opportunity`, `contact_relationship`.
  - Compare-and-swap on the user client: `withAuthor(db.from(<table>).update({ [field]: before }).eq("account_id", a).eq("id", recordId)` plus `.eq(field, after)` (or `.is(field, null)` when `after` is null), `author, \`restore:${changeId}\`)` with `.select("id")`. Zero rows → `"changed"`.
  - `custom.<key>` goes through `rpc("put_back_contact_custom", …)` (0112) with the same header. `false`/null → `"changed"`.
  - A put-back is a new write: person mark, `via restore:<id>` (the client path keeps that `via`, correction 9). History is never rewritten.
- **Restore** (`op = 'delete'`, types `equipment`, `client_group_member`, `contact_tag`, `contact_relationship`, `place`): only while `created_at > now - RESTORE_DAYS days`, otherwise `"expired"`.
  - Re-insert the `before` snapshot with the SAME id, using `restoreEquipment` / `restoreMembership` / `restorePlace` / a plain insert for tags and relationships, all with `via restore:<id>`.
  - A missing parent (place, group, contact or tag gone; FK 23503) answers `"parent_gone"`. An id already present (23505) answers `"already_back"`.
- **Actions:** `putBackAction(accountId, locale, changeId)` and `restoreAction(accountId, locale, changeId)`, `.bind()`-ed and `revalidatePath`-ing the record page. Each returns `{ ok: true, undo: { changeId: <the new change row id or null> } } | { ok: false, message }`, with the message from the Copy section. Undo of a put-back is a put-back of the row it wrote; undo of a restore is the type's existing remove writer.

**Steps (red first each):**
- [ ] **Step 1:** Pure. `canPutBack` is false for insert/delete, for `contact_tag`, and for an EXCLUDED field. `canRestore` gives day 29 true, day 30 + 1 ms false (mutation: compare against 31 days → FAILS). `RESTORE_DAYS === DOCUMENT_TRASH_DAYS`.
- [ ] **Step 2: Replica (spec tests 14 and 15).**
  - Put back lands while unchanged and writes a row with `via restore:<id>`, `person`.
  - It refuses a stale value (mutation: drop the `.eq(field, after)` equivalent in the SQL the test issues → FAILS).
  - As a Technician (`actAsMember(…,"technician")`), the read returns nothing, which gives `not_found`.
  - Restore of a removed unit within 30 days brings back the same id.
  - With its place deleted, restore gives `parent_gone`. A second restore gives `already_back`.

  Since the TS functions use supabase-js, drive the replica cases at the SQL they issue: assert with `pg` the exact statements `putBackChange` builds, and add one `record-restore-live.test.ts` (withTestAccount, CI only) that calls the real functions end-to-end.
- [ ] **Step 3:** Action tests with `@bis/db` mocked bare: Technician refused before any call; locale messages EN/ES; `.bind()` shape. Mutation: skip the role check → FAILS.
- [ ] **Step 4:** Both typechecks, lint, touched tests. Commit `feat(crm): put back a changed value and restore a removed unit, member, tag, relationship or place for 30 days (F-115)`.

---

### Task 7: 0113 — backfill, NOT NULL, enforce on

**Tier:** HIGH · **Owner:** bis-db-schema · **Lane:** 1 · **Port:** 55995 · **PR:** D · **Starts only when** the orchestrator's 7-day gate query (checklist step D0) shows 7 consecutive production days with zero unattributed rows after PR B's deploy.

**Files:** create `packages/db/supabase/migrations/0113_record_changes_enforce.sql` and `packages/db/src/test/record-changes-enforce-schema.test.ts`.

**What 0113 does:**
1. **Backfill** NULL-author rows from `public.events` (0074's method; read `MIG/0074_*.sql` first and reuse its actor mapping). A match is an event with the same `account_id`, `payload->>'contactId' = record_id::text`, the field named in `payload->'fields'`, and `created_at` within 2 seconds. Events carry TS field names: map them to column names with a literal `values` table built from the payloads at `DB/contacts.ts:593,720,766`. Read them; for example `firstName → first_name`. Actor mapping: `user → person` (id = `actor_id`), `ai → ai`, and `system → automation`. Where `contactAuthor` maps `system` to `customer` for that event type, follow `contactAuthor` (`provenance.ts:47`); the test pins each pair.
2. **Leftovers:** rows still NULL become `author_kind 'automation'`, `via 'backfill:unknown'`. A `raise notice` names the count. The orchestrator's dry run (checklist D1) reads this count on production BEFORE applying; if it is above 0, the owner sees the number first.
3. `alter table public.record_changes alter column author_kind set not null;`
4. `update app.record_changes_settings set enforce = true;`, which covers every environment (bis-ci included).
5. Header: WHY, WHAT, the dry-run numbers, `LOCKS AND COST.` (the `alter … set not null` scans the table under ACCESS EXCLUSIVE; state the row count and the replica time for that many rows), and ROLLBACK (`update … set enforce = false; alter … drop not null;` — the backfilled marks stay).

**Steps:**
- [ ] **Step 1, red first:** seed NULL rows plus matching events.
  - Each mapped pair is backfilled (mutation: map `system` to `ai` → FAILS).
  - A row whose event is 3 s away stays leftover, and becomes `automation/backfill:unknown`.
  - NOT NULL holds after (mutation: skip the leftover update → apply FAILS).
  - Enforce is on.
  - A service write with no author now raises.
- [ ] **Step 2:** Time the backfill plus NOT NULL on 100,000 seeded rows; put the number in the header.
- [ ] **Step 3:** Commit `feat(db): 0113 every change row names its author, and every server write must (F-115)`.

---

### Task 8: Download history

**Tier:** MEDIUM · **Owner:** bis-crm · **Lane:** 2 · **PR:** C · **Depends on:** T4

**Files:**
- Create: `apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/contacts/[contactId]/history/route.ts` + `.test.ts`
- Create: `apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/groups/[groupId]/history/route.ts` + `.test.ts`
- Create: `apps/web/src/lib/record/history-csv.ts` + `.test.ts` (pure)

- [ ] **Step 1: Pure CSV, red first.**
  - Columns: When, Who, Kind, Record, Field, Before, After, Cause. The header row is in the reader's locale (Copy: `history.csv.*`).
  - Values formatted as T5's text, with no colour words. Timestamps are ISO 8601 with the account's offset.
  - Excel-safe escaping: a cell starting with `= + - @` is prefixed with `'`. Copy the contacts export's escaper; grep `route.ts` there.

  Mutations: drop the formula guard → a `=HYPERLINK` case FAILS; Spanish header at `es` → `Cuándo`.
- [ ] **Step 2: Route.** `GET` mirrors `contacts/export/route.ts:91-114`: `requireAccountOwner(accountId)` (`lib/auth.ts:104`) refuses Staff and Technicians with 403. Reads go through the request's RLS client with `listChangeRows` paged to the end (cap 50,000 rows; past the cap, answer 413 with `history.download.tooBig`). The filename is `history-<record name slug>-<yyyy-mm-dd>.csv`. When `isAgency`, call `noteOpenedApi` (`lib/access-log/note.ts:34`) exactly as the export route does, with a `kind` naming the history download. Read `OpenedRef` in `packages/db/src/access-log.ts` for the allowed kinds; if none fits, stop and report (adding a kind is a migration question).
- [ ] **Step 3: Route tests** (spec test 17): Owner gets 200 and `text/csv`; Staff 403; Technician 403 (mutation: allow Staff → FAILS); agency → `noteOpenedApi` called once; ES reader → Spanish header.
- [ ] **Step 4:** Typechecks, lint, tests. Commit `feat(crm): Owners download a record's history as CSV (F-115)`.

---

### Task 9: e2e

**Tier:** MEDIUM · **Owner:** bis-e2e-qa · **Lane:** 2 · **PR:** E · **Depends on:** T5, T6; 0111 and 0112 on bis-ci; the orchestrator runs it

**Files:** create `apps/web/e2e/record-history.spec.ts`.

The spec runs on the per-run fixture account only (copy how `contacts-merge.spec.ts` makes and uses it), never `Test Client One`. Scope locators to `getByRole("main")`.
1. Create a contact with phone `(956) 555-0111` through the app, then open its record page.
2. Edit the phone inline to `(956) 555-0112` and save on blur.
3. The timeline shows a row with the person's mark and "changed phone". Expanding it shows "Was (956) 555-0111" and "Now (956) 555-0112".
4. Press "Put back". The phone reads `(956) 555-0111`, an Undo toast appears, and a new row exists.
5. Press Undo. The phone reads `(956) 555-0112`.
6. Repeat step 3's check with the Spanish reader preference (`cambió el teléfono`), only if the fixture can switch locale; otherwise note it as covered by T5's tests.

**Mutation probe:** in a scratch copy, make the reader drop `changes` from the record loader. Step 3 then FAILS by name; revert. Commit `test(e2e): a changed phone shows was and now, puts back and undoes (F-115)`.

---

### Task 10: Roadmap and tracker

**Tier:** LOW · **Owner:** orchestrator · **PR:** E. Update `docs/crm-features.md:727` (from "Partial (event-level only…)" to done, naming 0111–0113), `:1404` (S-04) and `:1440` (F-115 part 1, "the history tab" = the timeline source). Update the roadmap tracker's F-115 and S-04 item rows, and add a ledger entry with the planning corrections above.

---

## Copy (every new string; English then *usted* Spanish)

Keys live in `apps/web/src/lib/messages.ts`, each `.es` twin on the next line. Field labels come in two forms: `history.label.*` for the detail line, sentence case, and `history.field.*` for inside the verb (the Spanish carries its article).

| Key | English | Spanish |
|---|---|---|
| `timeline.what.changes` | changes | cambios |
| `history.verb.changed` | changed {fields} | cambió {fields} |
| `history.verb.added` | added this record | agregó este registro |
| `history.verb.removedEquipment` | removed the unit {name} | quitó el equipo {name} |
| `history.verb.removedMember` | removed {name} from the household | quitó a {name} del hogar |
| `history.verb.removedMemberBusiness` | removed {name} from the business | quitó a {name} del negocio |
| `history.verb.removedTag` | removed the tag {name} | quitó la etiqueta {name} |
| `history.verb.removedRelationship` | removed the link to {name} | quitó la relación con {name} |
| `history.verb.removedPlace` | removed the place {name} | quitó el lugar {name} |
| `history.verb.deleted` | deleted this customer | eliminó a este cliente |
| `history.field.first_name` / `history.label.first_name` | first name / First name | el nombre / Nombre |
| `history.field.last_name` / `…label…` | last name / Last name | el apellido / Apellido |
| `history.field.email` / `…label…` | email / Email | el correo / Correo |
| `history.field.phone` / `…label…` | phone / Phone | el teléfono / Teléfono |
| `history.field.assigned_to` / `…label…` | who it is assigned to / Assigned to | a quién está asignado / Asignado a |
| `history.field.dnd` / `…label…` | do not disturb / Do not disturb | no molestar / No molestar |
| `history.field.source` / `…label…` | where they came from / Source | de dónde llegó / Origen |
| `history.field.marketing_email_opted_out_at` / `…label…` | promotional email / Promotional email | los correos de promociones / Correos de promociones |
| `history.field.language` / `…label…` | language / Language | el idioma / Idioma |
| `history.field.custom` / `…label…` | {label} / {label} | {label} / {label} |
| `history.field.name` / `…label…` | name / Name | el nombre / Nombre |
| `history.field.stage` / `…label…` | stage / Stage | la etapa / Etapa |
| `history.field.value` / `…label…` | value / Value | el valor / Valor |
| `history.field.other` / `…label…` | a detail / Detail | un dato / Dato |
| `history.was` | Was | Antes |
| `history.now` | Now | Ahora |
| `history.blank` | (blank) | (vacío) |
| `history.yes` / `history.no` | Yes / No | Sí / No |
| `history.steps` / `history.stepsOne` | {count} changes / 1 change | {count} cambios / 1 cambio |
| `history.showSteps` | Show every step | Ver cada paso |
| `history.hideSteps` | Hide the steps | Ocultar los pasos |
| `history.putBack` | Put back | Poner como antes |
| `history.putBack.done` | {field} is back to what it was. | {field} quedó como antes. |
| `history.putBack.changed` | It changed since, so it wasn't put back. | Cambió desde entonces; no se restauró. |
| `history.restore` | Restore | Restaurar |
| `history.restore.done` | {name} is back. | {name} quedó restaurado. |
| `history.restore.expired` | This could be restored for 30 days. That time has passed. | Esto se podía restaurar durante 30 días. Ese plazo ya pasó. |
| `history.restore.parentGone` | It can't be restored: what it belonged to was removed. | No se puede restaurar: lo que lo contenía ya no existe. |
| `history.restore.alreadyBack` | It's already back. | Ya está restaurado. |
| `history.notAllowed` | Only Owners and Staff can do this. | Solo los Dueños y el Personal pueden hacer esto. |
| `history.undo` | Undo | Deshacer |
| `history.download` | Download history | Descargar historial |
| `history.download.tooBig` | This history is too long to download at once. Ask us for a copy. | Este historial es demasiado largo para descargarlo de una vez. Pídanos una copia. |
| `history.csv.when` … `history.csv.cause` | When, Who, Kind, Record, Field, Before, After, Cause | Cuándo, Quién, Tipo, Registro, Campo, Antes, Después, Causa |
| `history.cause.merge` / `.aiAct` / `.proposal` / `.restore` / `.sql` | merged with another record / Sofía did it / accepted suggestion / put back / BIS system | unión con otro registro / lo hizo Sofía / sugerencia aceptada / restaurado / sistema de BIS |

Notes:
- Before writing "Dueños" and "Personal", T5 checks the glossary (`docs/superpowers/specs/2026-10-31-spanish-dashboard-design.md` §4.3) for the role names and uses the glossary's words if they differ.
- `restore.done` agrees in gender only through the noun; if the reviewer finds "restaurado" wrong for a feminine noun (*la etiqueta*), switch to "{name}: restaurado/a" or rephrase as "Se restauró {name}." (preferred; no agreement problem).
- `history.steps` uses `plural()`, so 1 reads "1 change"/"1 cambio".

## PR split and lane schedule

| PR | Branch (orchestrator creates) | Tasks | Migration | Merges when |
|---|---|---|---|---|
| A | `feat/f115-a-capture` | T0 report, T1, T2 | 0111 | 0111 on bis-ci, then production, then parity; verify and e2e green for the head SHA |
| B | `feat/f115-b-q1` | T3 | 0112 | after A; the same apply order. **The 7-day clock starts at B's production deploy** |
| C | `feat/f115-c-reader` | T4, T6, T8 | none | after B (T6 needs 0112). Nothing user-visible: the reader and actions have no UI until E, and the download link is rendered by T5 |
| D | `feat/f115-d-enforce` | T7 | 0113 | after 7 consecutive zero days (D0) and the leftover dry run (D1) |
| E | `feat/f115-e-timeline` | T5, T9, T10 | none | **only after D's 0113 is on production** |

**Lanes (2 at most):**
- **Lane 1 (schema and authors):** T0 → T1 → T2 → [PR A] → T3 → [PR B] → (wait for the gate) → T7 → [PR D].
- **Lane 2 (reader and UI):** starts when T1 is committed on A's branch. The lane-2 worktree branches from A's branch at that commit; after A merges, the orchestrator merges `origin/main` into it (a merge, never a rebase). The order is T4 → T8 → (after T3 is committed) T6 → [PR C] → T5 → T9 → (hold until D) → T10 → [PR E].
- While lane 1 waits the 7 days, lane 2 finishes T5 and T9 and holds PR E open.

## Orchestrator checklist (in order)

**A0.** Create worktrees and run the install once each. Re-check the migration numbers (Global Constraints).
**A1.** T0 report in; record both verdicts in the ledger. A fallback chosen? Then brief T1/T2 with the fallback text in T0.
**A2.** T1 HIGH review: a bis-reviewer on its own replica (port 56092) runs every named mutation, plus correction 4's direct-session case, and diffs the read policy word for word against 0109/0068.
**A3.** T2 reviews (bis-crm, bis-voice, bis-platform parts), then push A. Read `verify` and `e2e` FOR THE HEAD SHA (`gh api repos/:owner/:repo/commits/<sha>/check-runs`). `record-changes-live.test.ts` green by name proves A1/A2 through Kong. The e2e job's migration check names 0111 until A4; that red is expected.
**A4.** Pre-checks on bis-ci (below), then `ci-project-setup.yml` from `feat/f115-a-capture` with `push-dry-run` then `push`, then post-checks.
**A5.** Production: pre-checks, then MCP `apply_migration` (name `record_changes`, the file's exact text; ASCII, no backslash), then post-checks. **Apply it immediately before merging A,** so old app code writes as few unattributed rows as possible (each would be a leftover in D1).
**A6.** Parity (`docs/runbooks/ci-supabase-project.md`, `fingerprint.sql` on both). Merge A. After the deploy, prove **A3** on Vercel Preview (bis-ci): make a service-path contact write (a form submission on the fixture account), then read bis-ci with `select author_kind, via from public.record_changes order by id desc limit 3` (read-only). Expect `customer`.
**B1–B4.** The same for 0112 / PR B (name `record_changes_q1`). The post-checks add the 14 new triggers and `put_back_contact_custom`.
**C1.** PR C: the end-of-PR review, then gates, then merge.
**D0. The 7-day gate**, read-only on production, daily after B's deploy:

```sql
select d::date as day,
       (select count(*) from public.record_changes r
         where r.author_kind is null and r.created_at >= d and r.created_at < d + interval '1 day') as unattributed
  from pg_catalog.generate_series(date_trunc('day', now()) - interval '7 days', date_trunc('day', now()) - interval '1 day', interval '1 day') d
 order by 1;
```

The gate passes when all 7 rows read 0 and every day is after B's deploy day. The `cron.pass.recordChangesAudit` heartbeat has been green for the same days.
**D1.** Leftover dry run on production (read-only): T7's backfill `select` without the update, counting rows still NULL after matching. If above 0, take the number to the owner before D2.
**D2.** 0113 to bis-ci, then production (name `record_changes_enforce`), then parity, then merge D.
**E1.** PR E: the end-of-PR review including bis-design-reviewer, then the gates (e2e one at a time; check no `screenshots.yml` run is in progress), then merge. Then T10.

**Pre-checks (read-only, before each apply, bis-ci then production):** the definer count (38 before 0111; 39 before 0112 and 0113) and the client-write digest (T1 Step 1's query; record the value, which must not move). `select to_regclass('public.record_changes')` returns null before 0111.
**Post-checks:** the definer count (39 after 0111, unchanged by 0112 and 0113) and the digest (unchanged). `select tgname from pg_trigger where tgrelid = 'public.contacts'::regclass and tgname like 'record_changes_%'` returns both. `has_table_privilege` for anon/authenticated/service_role × INSERT/UPDATE/DELETE on `record_changes` is all false. `select enforce from app.record_changes_settings` is `f` after 0111/0112 and `t` after 0113. `select proconfig from pg_proc where proname = 'record_changes_capture'` is `{search_path=pg_catalog, pg_temp}`. Any other answer: stop before the next project and report.

## Not in this plan

Spec §8: document metadata history; notes (no editor exists); field-restriction filtering (F-004: when it lands, the reader must hide restricted fields' rows); customer-visible history; the retention engine and legal hold (F-123); whole-business export (F-121); the API and webhooks reading the log (F-149); To-dos and bookings history. The hash chain is dropped (spec header).

## Self-review (2026-11-02)

- **Spec coverage.** §1 → corrections 1–3 (reuse). §2.1 D1–D8 → T1 (1, 3, 4, 5, 8 via RESTORE_DAYS in T6), T2 (2), T4 (7). §2.2 → T1. §2.3 → T1 Step 4 (precedence), T2. §2.4 → T3 (put-back function), T6. §2.5 → T1 measure-first, T3 Step 6, T7 header, T8. §3 → T4, T5. §4 risks 1–7 → enforce/count/gate/backfill (T1, T2, T7), T0 (risk 2), correction 9 and `foldVia` (risk 6), T3 (risk 7). §5 tests 1–19 → T1 (1–9, 11, 19), T1 Step 7 (3), T2 (12), T3 (10), T4 (13), T6 (14, 15), T5 (16), T8 (17), T9 (18). §6 → the task list. §7 → each migration's ROLLBACK. §9 → Global Constraints.
- **Placeholders.** The `<…>` markers are values an implementer measures or reads at a named line (timings, the merge id variable, the 0109 policy text), each with the command that yields it. The Q1 column lists in T3 are a starting point that the per-table pin forces the implementer to confirm against `\d`.
- **Names.** `record_changes`, `app.record_changes_capture`, `app.record_change_fields`, `app.record_changes_settings`, `record_changes_client`/`_server`, `put_back_contact_custom`, `AUTHOR_HEADER`, `withAuthor`, `requireAuthor`, `eventActorOf`, `authorHeaderValue`, `ChangeRow`, `ChangeGroup`, `groupChanges`, `foldVia`, `listChangeRows`, `COLLAPSE_MINUTES`, `RESTORE_DAYS`, `canPutBack`, `canRestore`, `putBackChange`, `restoreRemoved`, `recordChangesAuditPass` and `history.*` are spelled the same everywhere.
