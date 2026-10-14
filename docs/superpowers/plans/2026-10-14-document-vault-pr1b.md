# The document vault, PR 1b (S-07 + F-005 part 1, migration 0078): implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finish part 1 of the staff vault: upload a new version of a file from its row menu (the row reads "Version 2" once a second version is ready), see every version newest first in the viewer and download an older one, give each new version its own timeline row ("Ana uploaded a new version of Lease") and a `document.version_added` event, let an Owner or the agency delete a trashed file forever by typing its name exactly (objects first, then rows, then `document.purged`), and show "4.1 of 5 GB used" on the card above 80% of the quota. Folded in from PR 1a's final review: a new version is never added to a trashed file, the image viewer retries on its own at most once, "not found" for a file says "file", and the `/styleguide` demo never reaches a real server action.

**Architecture:** One additive migration, **0078**, adds two read paths. First, `public.document_version_timeline`, a `security_invoker` view of every ready version after a document's first, carrying its document's title, category, record and trash state, so the timeline's existing documents source reads the new-version rows under the caller's own RLS (the Owners-only and Technician fences apply unchanged). Second, `public.document_space_used(uuid)`: a `SECURITY DEFINER` sum, executable by `authenticated`, that counts exactly what 0077's `reserve_document_version` counts (every version of the account, ready or uploading, trashed documents included), so the card's line and the quota refusal cannot disagree, and a Staff member or a Technician gets the ACCOUNT's number, not their RLS-visible slice. Everything else is app code on 0077 as it stands: a new version reuses `reserve_document_version` and `mark_document_version_ready` through a new start action (`startDocumentVersionUploadAction`) and the existing finish action, which now also refuses (and cleans up) a version whose document went to the trash mid-upload. The card's read embeds every ready version of each document. Delete forever is one server action: the caller must be an Owner or the agency (owner ruling R1, checked before any read), then a request-client read proves the file is visible and trashed and the typed name matches, then the service client claims the row (a compare-and-set re-stamp of `deleted_at` that also sets `deleted_by` to the constant `DOCUMENT_PURGING_MARK`, `"documents:purging"`, which `restoreDocument` refuses, so no Restore can win once the claim lands), removes every version's object, deletes the row, and emits.

**Tech Stack:** Postgres 17 (Supabase) migration; supabase-js 2.110.8 (`rpc`, `@supabase/storage-js` `createSignedUploadUrl`, `createSignedUrl`, `remove`); Next.js 16.3.6 App Router (server actions, route handlers, client components); React 19.2.4; vitest 4 (`renderToStaticMarkup`, no DOM; `vi.mock`); the `@bis/db` suites on a local PG18 replica (with a local PostgREST for `withTestAccount`) and CI `verify`; Playwright (bis-e2e-qa writes it, the orchestrator runs it).

**Spec:** `docs/superpowers/specs/2026-10-13-document-vault-design.md` (owner-approved 2026-10-13). PR 1a's plan: `docs/superpowers/plans/2026-10-13-document-vault-pr1a.md` (its "Not in this PR (PR 1b)" section is this PR's scope). Base: `main` at `03f43736` (#258, PR 1a merged; 0077 applied to bis-ci and production, never re-apply). Every file:line below was read off this worktree at `03f43736`; anything not read is labelled **Assumption**.

`<WT>` = `C:\Users\danlo\bis-platform\.claude\worktrees\s07-1b` (Git Bash: `/c/Users/danlo/bis-platform/.claude/worktrees/s07-1b`), branch `feat/s07-vault-1b`. `<SCRATCH>` = `C:\Users\danlo\AppData\Local\Temp\claude\C--Users-danlo-bis-platform\db21dcfe-6aee-47cd-8939-ff4f82a45810\scratchpad` (Git Bash: `/c/Users/danlo/AppData/Local/Temp/claude/C--Users-danlo-bis-platform/db21dcfe-6aee-47cd-8939-ff4f82a45810/scratchpad`); write it out literally in every command. `…/contacts/` = `apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/contacts/`. `…/api/` = `apps/web/src/app/api/accounts/[accountId]/`.

## Global Constraints

- **NEVER `git stash`, `git reset`, `git checkout --`, `--amend`, or any history rewrite** in the shared worktree. Another agent's uncommitted work lives in the same tree. To undo your own edit, edit it back. To see committed text, `git show HEAD:<path>`. Never `rm -rf` anything under `<WT>` (memory "No rm -rf on worktrees": it once followed a junction into the main checkout); scratch directories under `<SCRATCH>` are yours to delete.
- **Ownership (tag on every task; no task edits a file its owner does not own).**
  - **bis-db-schema:** `packages/db/supabase/migrations/0078_document_space_used.sql` (new), `packages/db/src/test/document-space-used.test.ts` (new), and the one allow-list line in `packages/db/src/test/schema-grants-guard.test.ts` (`rlsOff`, the first view in `public`). Writes the migration and proves it on a replica; never applies it.
  - **bis-crm:** `apps/web/src/lib/messages.ts` and one new `describe` in `apps/web/src/lib/messages.test.ts` (**Task 2 only**); `packages/db/src/documents.ts`, `packages/db/src/test/documents.test.ts`, `packages/db/src/index.ts` (the documents export block only); `…/contacts/documents-actions.ts` and its test; `apps/web/src/lib/documents/{documents-load,document-view,space}.ts` and the tests of the first and third; `…/api/contacts/[contactId]/documents/route.ts`, `…/api/groups/[groupId]/documents/route.ts` and their tests; `apps/web/src/lib/i18n/{catalogue,ratchet}-baseline.json` (regenerated, never hand-edited); for the version rows (Task 3b): `packages/db/src/record.ts`, `packages/db/src/test/record.test.ts`, `apps/web/src/lib/record/{author-mark,timeline-rows,recent-rows}.ts` and their tests, `…/contacts/[contactId]/activity-timeline.tsx` and `activity-timeline.rows.test.ts`, `…/groups/[groupId]/group-timeline.tsx` and its test, `…/contacts/contact-drawer.tsx` (the `ROW_ICON` map only), `apps/web/src/lib/contacts/drawer-summary.ts` (`ROW_KINDS` only) and its test, and `…/api/contacts/[contactId]/summary/route.reads.test.ts` (`MEASURED` and its comment only).
  - **bis-frontend:** `apps/web/src/lib/documents/upload-client.ts` and its test; `…/contacts/{documents-card.tsx,documents-card-handlers.ts,document-viewer.tsx,document-purge-dialog.tsx}` and their tests; `apps/web/src/app/(dashboard)/dashboard/styleguide/{documents-demo.tsx,documents-demo.test.ts}`.
  - **bis-e2e-qa:** `apps/web/e2e/documents-versions.spec.ts` (new).
  - **Orchestrator:** the ledger, the bis-ci and production applies of 0078, the parity check, the gates, the PR, the merge, the roadmap tracker row. No `DESIGN.md` edit: its "Documents" paragraph already states this PR's rules (version shown, a typed name only for a permanent purge, never sharing the trash move's confirmation).
- **Shared files, one task at a time.**
  - `apps/web/src/lib/messages.ts`: **Task 2 only** (the one writer). Every key in this plan is listed in Task 2. A later task that finds a key missing STOPS and reports it; the orchestrator re-opens Task 2. A `.es` twin goes on the line directly under its English key.
  - `packages/db/src/index.ts`: **Task 3 only**.
  - `…/contacts/documents-actions.ts` (+ test): **Task 4 only**.
  - `packages/db/src/documents.ts` (+ `test/documents.test.ts`): **Task 3 only** (Task 3 also writes `listDocumentVersionTimeline` there; Task 3b only calls it).
  - `packages/db/src/record.ts` and `lib/record/*`: **Task 3b only**.
  - `apps/web/src/lib/documents/documents-load.ts`: **Task 5 only** (Tasks 7 and 8 consume its types).
  - `…/contacts/documents-card.tsx`, `documents-card-handlers.ts` (+ tests) and the styleguide demo: **Task 8 only**. `document-viewer.tsx` and `document-purge-dialog.tsx` (+ tests): **Task 7 only**.
  - `apps/web/src/lib/i18n/*-baseline.json`: **Task 9 only**, after Tasks 2, 3b and 4–8 have committed.
- **Every test must be able to fail, and the plan writer checked each one; the implementer re-checks.** Each test names the mutation that breaks it. Run the probe, see the test fail BY NAME, paste the failing assertion line into the report, revert by editing back. The shapes that made about one in three of PR 1a's prescribed tests vacuous, each of which a reviewer rejects on sight (memory "Vacuous test shapes"): `toBeTruthy`/`toBeDefined` on content; an English-only assertion where a Spanish twin exists (assert BOTH, the Spanish compared against the literal string from `m["….es"]`, never against `t()`'s output, which falls back to English silently); a mock that satisfies itself (asserting a mock returned what the test told it to return); an assertion on a value the fixture already contained before the code ran; a negative `not.toContain` against raw `renderToStaticMarkup` output on a string with an apostrophe (React writes `&#x27;`, so the negative can never fail): use `renderedText()` from `apps/web/src/lib/rendered-text.ts` for EVERY copy assertion, positive or negative. A `-t` filter that matches nothing passes silently: check the run count in vitest's summary block. Where a rule exists twice, probe both copies (the request-client proof precedes the service write in EVERY new action: probe both new actions).
- **0053, server-only writes; the request-client proof.** Every service-role call on an id that came from the browser (`documentId`, `versionId`) runs AFTER `requireAccountAccess(accountId)` and a request-client read (`dbForRequest()`, `apps/web/src/lib/db.ts:21-26`) that returns that document under RLS (its record's visibility, the Technician fence, Owners only). `documents-actions.ts` is already in `…/accounts/in-account-service-reads.test.ts:91` (`proven-target`); this plan adds no other file that mentions `serviceDb` under `…/accounts/`, `…/api/` or `apps/web/src/lib`. The two documents routes stay request-client only (`route.ts:23`, "NEVER serviceDb here"): the space read goes through 0078 on the request client.
- **SQL rules.** The migration file is ASCII only with no backslash anywhere (memory "MCP SQL escapes"; checked with a node byte count that has a positive control, because `grep -P` exits 2 silently in Git Bash). A boolean built from a nullable value is `coalesce(…, false)` (memory "plpgsql NULL guard"): `app.is_agency()` is NULL for a client token (`0001_tenancy.sql:9-12`), and `app.current_account_id()` is NULL for a token whose organisation matches no account (`0008_client_access.sql:13-18`). A Supabase `head: true` count throws on `count === null` (memory "head-count null"); this plan adds none.
- **react-hooks/set-state-in-effect.** No `setState` synchronously inside a `useEffect` body. Use the derived-state pattern `document-viewer.tsx` already uses (`fetchKeyFor`/`viewerStateFor`, `document-viewer.tsx:24-36`, `:69-84`): state set only in a promise callback or an event handler, and a value that must reset with its subject is keyed (`key={doc.id}`) rather than reset in an effect.
- **DESIGN.md definition of done for every UI task (7, 8):** tokens only (radii `rounded-[var(--radius-ctl)]` 8px, `rounded-[var(--radius-card)]` 12px, pills `rounded-full`; no hex, no literal shadow); both themes via the `.dark` class; the blur fallback (no `backdrop-filter` on the card; the viewer and the purge dialog are `Dialog` overlays and inherit `components/ui/dialog.tsx`'s glass); rule 3 (status is a dot AND a word, never colour alone); rule 4 (the whole row opens the viewer, hover `--surface-3`, a visible focus ring); rule 5 (loaded, empty, error); **rule 6: the trash move stays immediate with an Undo and NEVER opens a dialog; the typed-name dialog appears ONLY for Delete forever**; rule 7 (skeletons, never a spinner); **rule 8: the card keeps exactly ONE `data-variant="default"` button; the purge dialog's one primary is its `destructive` Delete forever, everything else `ghost`**; controls `min-h-11 md:min-h-8`; nothing animates on scroll; `prefers-reduced-motion` respected. The record page names no hero (rule 11): nothing here uses `--gradient-hero`. The section label in the viewer's Versions list uses the label role exactly as `components/record/record-section.tsx:34` writes it (`font-mono text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground`).
- **Copy.** Every new string through `t(m, key, locale, params)` with an `.es` twin in the same commit (`apps/web/src/lib/i18n/ratchet.test.ts`). New `.tsx` code carries no JSX literal copy with a letter in it. Usted for every new Spanish string. No vendor jargon in copy ("Supabase", "bucket", "signed URL", "storage"). Every server action answers a messages.ts KEY with params; the card translates it.
- **Browser code imports the vault's rules from `@bis/db/document-rules`** (`packages/db/package.json`'s pure subpath), never from the `@bis/db` barrel.
- **The `vi.mock` factory check.** A task that adds a NEW named import to a module adds that name to every mock factory that reaches the module: `grep -rln 'vi.mock("@bis/db"' apps/web/src | xargs grep -ln "<module basename>"`, and for the actions module `grep -rln 'documents-actions"' apps/web/src --include=*.test.ts`. A factory built on `importOriginal` gets the real function unless the name is in its mock object; add it there too. A bare factory without the name throws "[vitest] No "<name>" export is defined on the mock" the moment the module touches it.
- **Running tests.** Only the affected tests, by path: `pnpm --filter web exec vitest run "<path>" …`, `pnpm --filter web typecheck`, `pnpm --filter web exec eslint "<touched files>"`. `@bis/db` suites only on a replica (section "The replica kit" below), judged by vitest's summary block (capture the exit code to a file with nothing after the command; the `ERR_PNPM_RECURSIVE_EXEC_FIRST_FAIL` trailer lies). **No `@bis/db` vitest that calls `document_space_used` may run against bis-ci until Task 12 step 2 has applied 0078 there.** Never the gates (`pnpm check`, `pnpm --filter web build`, `pnpm --filter web test:e2e`) and never Playwright: the orchestrator runs them, one at a time (memory "Agent test scope"). Never pass the folder `…/accounts/` to vitest (it holds `calls/[callId]/actions.test.ts`, a live test).
- **Mutating e2e only on the per-run fixture account** (`readClientFixture()`, `apps/web/e2e/support.ts:103-111`), never `Test Client One`; every seeded row and stored object deleted in `afterAll`, each error checked, then re-read to confirm none is left.
- **Nothing sends, nothing calls a real provider.** No script, REPL or test writes to bis-ci or production storage except the orchestrator's e2e runs on the fixture account.
- **Commits:** `git add -- <new files>` then `git commit -m "<type>(<scope>): <what and why>" -- <every path>`. Never `-A` or `.`. If `.git/index.lock` exists, wait and retry; never delete it. Never push (the orchestrator pushes). Never touch `main`. Trailer lines on every commit: `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>` and `Claude-Session: https://claude.ai/code/session_013RThMy9QC8x7FZ94Lxib9p`.
- **Never** apply a migration outside your own replica, run SQL that writes to a shared project, mutate Test Client One, create or edit `.env*`, or delete a storage object outside the fixture account.

## The replica kit (every `@bis/db` task and its reviewer)

Ports, one set per agent, never `5432`: Task 1 implementer `55540`, Task 1 reviewer `55541`; Task 3 implementer Postgres `55542`, PostgREST `55543`, gateway `55544`; Task 3 reviewer `55545`/`55546`/`55547`; Task 11 (final review) `55548`/`55549`/`55550`. Each agent works in its own `<SCRATCH>/s07b-t<N>-<impl|review>/`.

PR 1a left the PostgREST v14.14 Windows build, the JWT signer and the gateway proxy in `<SCRATCH>/s07-t3-impl/` (`postgrest.exe`, `make-jwt.js`, `proxy.mjs`; read 2026-10-14). The proxy forwards `/rest/v1/*` to PostgREST and answers `DELETE /storage/v1/object/documents` with `200 []` (the only storage call a `withTestAccount` teardown makes); any other storage call gets 404, so a test that unexpectedly touches storage fails loudly.

**`<SCRATCH>/s07b-kit/replica.sh <pgPort> <dir>`** (Task 1 writes the kit; every later agent runs it): builds `pre` (every migration through 0077, with the storage stub 0077 needs) and `post` (`pre` plus the branch's 0078 if the file exists yet).

```bash
#!/usr/bin/env bash
# replica.sh <pgPort> <dir>: a throwaway PG18 replica of the migrations (memory "Local DB replica").
set -u
PORT="$1"; S="$2"
WT=/c/Users/danlo/bis-platform/.claude/worktrees/s07-1b
PGBIN="/c/Program Files/PostgreSQL/18/bin"
P() { "$PGBIN/psql" -h localhost -p "$PORT" -U postgres -v ON_ERROR_STOP=1 -q "$@"; }
mkdir -p "$S"
cd "$WT" || exit 1
"$PGBIN/pg_ctl" -D "$S/pgdata" stop -m fast </dev/null >/dev/null 2>&1
rm -rf "$S/pgdata"   # the scratch data directory only, never anything under the worktree
"$PGBIN/initdb" -U postgres -A trust -E UTF8 --locale=C --locale-provider=icu --icu-locale=en-US -D "$S/pgdata" > "$S/initdb.log" 2>&1 || { echo "initdb failed"; exit 1; }
"$PGBIN/pg_ctl" -D "$S/pgdata" -o "-p $PORT" -l "$S/pg.log" start </dev/null >/dev/null 2>&1
P -c "create role anon nologin noinherit; create role authenticated nologin noinherit; create role service_role nologin noinherit bypassrls; grant anon, authenticated, service_role to postgres;"
P -c "create database pre"
P -d pre -c "alter database pre set timezone to 'UTC'"
P -d pre -c "create schema if not exists app; create schema if not exists extensions;"
sed -n '58,63p;72,73p' packages/db/supabase/bootstrap/ci-project.sql | P -d pre
# The storage stub: only the two relations 0077 touches. NOT the real storage schema.
P -d pre <<'SQL'
create schema storage;
create table storage.buckets (id text primary key, name text not null, public boolean default false,
  file_size_limit bigint, allowed_mime_types text[]);
create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text references storage.buckets(id), name text);
alter table storage.objects enable row level security;
grant usage on schema storage to anon, authenticated, service_role;
grant all on storage.buckets, storage.objects to anon, authenticated, service_role;
SQL
for f in packages/db/supabase/migrations/0*.sql; do
  case "$f" in *0078_*) continue;; esac
  P -d pre -1 -f "$f" > /dev/null 2>"$S/mig.err" || { echo "FAILED at $f"; cat "$S/mig.err"; exit 1; }
done
P -c "create database post template pre"
P -d post -c "alter database post set timezone to 'UTC'"
if [ -f packages/db/supabase/migrations/0078_document_space_used.sql ]; then
  P -d post -1 -f packages/db/supabase/migrations/0078_document_space_used.sql || { echo "0078 FAILED"; exit 1; }
  echo "post = pre + 0078"
else
  echo "post = pre (no 0078 yet)"
fi
```

**`<SCRATCH>/s07b-kit/pgrst.sh <pgPort> <pgrstPort> <gatewayPort> <dir>`**: a local PostgREST on `post` behind the proxy, plus `<dir>/env-run.sh`, which points the `@bis/db` suites at localhost only (the CI project's values in `packages/db/.env` are never overridden by `dotenv`, which does not replace a variable already set, so these exports win).

```bash
#!/usr/bin/env bash
set -u
PG="$1"; PR="$2"; GW="$3"; S="$4"
K=/c/Users/danlo/AppData/Local/Temp/claude/C--Users-danlo-bis-platform/db21dcfe-6aee-47cd-8939-ff4f82a45810/scratchpad/s07-t3-impl
SECRET="s07b-local-postgrest-jwt-secret-not-used-anywhere-real-0000"
mkdir -p "$S"
cp "$K/postgrest.exe" "$K/make-jwt.js" "$K/proxy.mjs" "$S/"
cat > "$S/postgrest.conf" <<EOF
db-uri = "postgres://postgres@localhost:$PG/post"
db-schemas = "public"
db-anon-role = "anon"
jwt-secret = "$SECRET"
server-port = $PR
server-host = "127.0.0.1"
db-max-rows = 1000
log-level = "info"
EOF
node "$S/make-jwt.js" "$SECRET" service_role > "$S/service.key"
node "$S/make-jwt.js" "$SECRET" anon > "$S/anon.key"
rm -f "$S/stop"
( cd "$S" && node proxy.mjs "$GW" "$PR" > proxy.log 2>&1 &
  cd "$S" && while [ ! -f "$S/stop" ]; do ./postgrest.exe postgrest.conf >> postgrest.log 2>&1; sleep 1; done ) </dev/null >/dev/null 2>&1 &
cat > "$S/env-run.sh" <<EOF
export NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:$GW
export SUPABASE_SERVICE_ROLE_KEY=\$(cat "$S/service.key")
export NEXT_PUBLIC_SUPABASE_ANON_KEY=\$(cat "$S/anon.key")
export SUPABASE_DB_URL=postgresql://postgres@localhost:$PG/post
EOF
echo "PostgREST on $PR behind the gateway on $GW; source $S/env-run.sh before a run"
```

Stop your own kit only (never `taskkill /IM postgrest.exe`, which would stop every agent's): `touch "<dir>/stop"`, then in PowerShell `Get-Process postgrest | Where-Object { $_.Path -eq '<dir as a Windows path>\postgrest.exe' } | Stop-Process -Confirm:$false` and `Get-NetTCPConnection -LocalPort <gatewayPort> -State Listen | ForEach-Object { Stop-Process -Id $_.OwningProcess -Confirm:$false }`; then `"/c/Program Files/PostgreSQL/18/bin/pg_ctl" -D "<dir>/pgdata" stop -m fast`. A SQL mutation probe on `post` needs PostgREST to reload its schema cache: `psql … -d post -c "notify pgrst, 'reload schema'"`.

**Faithfulness** (once per kit build, read-only on bis-ci with `pnpm --filter @bis/db ci:sql`): the client-write-surface digest on `pre` equals bis-ci's. The query:

```sql
select count(*) || '|' || md5(string_agg(x, ',' order by x)) from (
  select r || ' ' || c.relname || ' ' || p as x
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  cross join (values ('anon'), ('authenticated')) v(r)
  cross join (values ('INSERT'), ('UPDATE'), ('DELETE')) w(p)
  where n.nspname = 'public' and c.relkind = 'r' and has_table_privilege(r, c.oid, p)) s;
```

Paste both values in the report; stop if they differ.

## Pinned tests this PR changes (stated outright)

- `apps/web/src/app/api/accounts/[accountId]/contacts/[contactId]/summary/route.reads.test.ts`: `MEASURED` 23 → **24** (Task 3b). The 24th read is `request:document_version_timeline`, the drawer's five newest rows reading new-version rows under RLS; the comment names S-07 1b.
- `packages/db/src/test/schema-grants-guard.test.ts`: `rlsOff` `[]` → `["document_version_timeline"]` (Task 1), the first view in `public`, a `security_invoker` view whose reads run under the tables' own RLS; the guard's comment asks for exactly this reviewed decision.
- `documents-actions.test.ts:193,220,225` (`notFound` → `fileNotFound`), the handlers test's Download case (`:139,146`), and the card test's `rowMenuItems` case (`:171-177`).
- **Unchanged, checked:** `TIMELINE_SOURCES` (the version rows join the existing `documents` source, so `record.test.ts:296`, `timeline-merge.test.ts:143,159-161`, and the `TIMELINE_SOURCES` mocks in `contacts/[contactId]/page.test.ts:80`, `groups/[groupId]/page.test.ts:86`, `group-loaders.test.ts:26`, `loaders.test.ts:20` and `summary/route.test.ts:36` keep their lists); `apps/web/src/app/api/cron/reminders/route.test.ts` (no new `@bis/db` name reaches the cron route: `documents-sweep.ts` imports none of this PR's functions); `document-vault-schema.test.ts` (0077 untouched).

## Not in this PR

- PR 1a's other final-review follow-ups (PR #258's list): a time budget for the clean-up pass; a household or business with no members does not show its own files on its timeline; an upload that lands after its rows are gone stays in storage, uncounted (this PR narrows the one new path to it, deviation 3, but does not close the general case); bulk actions near 400 customers hit a request-length ceiling (predates the vault); the customer-delete dialog's file count includes customers the delete will skip; signed reads carry no `Cache-Control` header.
- Splitting the row menu's "Edit details" into Rename, Category and Expiry items (spec §4.1 lists them separately; PR 1a shipped one "Edit details" item that opens all three inline fields, `documents-card.tsx:88-94`). Unchanged here.
- Space-used anywhere but the card, a per-account quota other than 5 GB, and paging past 200 documents (part 3).
- Everything in spec parts 2 and 3 (scanning, customer upload links, the checklist, expiry reminders, share links, the account-wide Documents view).

## Deviations from the spec, and spec-vs-code mismatches (the source decided; evidence cited)

1. **A second migration, 0078, for the space-used line and the new-version timeline rows** (spec §7 said "One migration (0077) and two PRs"; amended in this revision). The view half is deviation 6. The line needs the ACCOUNT's usage, counted by the quota's own rule (spec §4.2 item 4, §3.5). Three ways were read and refused: (a) a sum on the request client under RLS undercounts for Staff (an Owners-only file is invisible, `0077_document_vault.sql:139-140`) and for a Technician (`:135-138`), so two people on one account would read different numbers against one shared quota; (b) a service-role sum would put `serviceDb` into the two read routes, which are request-client only by rule (`route.ts:23`), and would page over every version row of the account (PostgREST's row cap) on every card load; (c) a PostgREST aggregate (`select=bytes.sum()`) is an unproven surface the codebase has already declined once (`packages/db/src/messaging.ts:582-583`). 0078 is one additive `SECURITY DEFINER` function with the same `where v.account_id = p_account_id` sum as `reserve_document_version` (`0077:181`), executable by `authenticated` only, refusing any caller outside the account. Rollout: bis-ci, then production, then parity (Task 12).
2. **"A new version must not be added to a trashed file" is enforced in the app, not by changing 0077's functions** (PR 1a final review follow-up: `reserve_document_version` checks only that the document exists, `0077:179`). The new start action refuses a trashed document on its request-client read, and the finish action, which already reads the document first (`documents-actions.ts:158`), now refuses one that went to the trash after the start and removes the object and the reservation (object first, rows second, its existing `cleanUp`, `:140-147`). Why this is airtight without a lock: the only remaining window is between the finish's read and `mark_document_version_ready`'s commit; a trash that commits inside it produces exactly the state of the serial order "the version became ready, then the file was trashed", which is a legal history (the trash's own Undo then restores the file with its new version). Every other interleaving is refused at the start or at the finish. Replacing `reserve_document_version` would mean re-creating a function the quota tests pin (`document-vault-schema.test.ts:285-345`) on production for no outcome the app check does not already give.
3. **Delete forever refuses while any version of the file is still uploading** (spec §4.4 silent). Purging the rows while a browser's PUT is in flight would land that object after its row is gone, where nothing finds it (PR #258 follow-up "an upload that lands after its records are gone"). The refusal says so ("A new version of this file is still uploading. Try again later."; review M6: it promises no time, because it can last hours) and lasts at most until the sweep removes an abandoned reservation (three hours, `ABANDONED_UPLOAD_MS`, PR 1a deviation 6). Residual, named: a new-version start whose request read saw the file live just before it was trashed, and whose reservation lands after the purge's version read, can still leave one object behind; that is the general follow-up, not closed here.
4. **Delete forever claims the row before it removes anything, and a claimed row is never restored** (spec §5.1 amended in this revision; review M1). The claim is one compare-and-set: `deleted_at` re-stamped and `deleted_by` set to the marker `DOCUMENT_PURGING_MARK` (`"documents:purging"`), only while `deleted_at` still equals the instant the proof read. `restoreDocument` gains `.neq("deleted_by", DOCUMENT_PURGING_MARK)`, so BOTH remaining Restore-during-purge cases the review named are closed, not just named: (a) a Restore carrying the NEW timestamp (a card that re-read after the claim) landing while objects are being removed is refused by the marker; (b) `deletePurgedDocument` failing after the objects are gone leaves a row that no Restore can bring back as an empty file. Consequences, named: a purge that fails part-way leaves the file in the trash, marked, NOT restorable (its objects may be partly gone); Delete forever again finishes it (the claim accepts the row's current instant), and the 30-day sweep does too (from the claim's instant). The actor of a purge is in `document.purged`'s event, so `deleted_by` losing it costs nothing. Cost: one filter in `restoreDocument` and one test.
5. **Delete forever is for Owners and the agency only** (owner ruling R1, 2026-10-14; spec §3.4 amended). The action refuses unless `access.canManage` (the Owners-only rule, `documents-actions.ts:297`), before any read; the card draws no Delete forever for anyone else, who still sees the trashed file and its Restore. The 30-day automatic purge is unchanged.
6. **A new version emits `document.version_added` and has its own timeline row** (owner ruling R2, 2026-10-14; spec §3.6 amended). The event: `markDocumentVersionReady` emits `document.version_added` with `{ documentId, versionId, contactId | groupId }` when 0077 answers `first: false` (`documents.ts:144` emits only on `first` today); no title, no category (PR 1a deviation 3's reason). The row: "{who} uploaded a new version of {title}", the person mark from `uploaded_by`, "In the trash" while the file is trashed, the category as its detail, at the version's `created_at`. **Its source** is a 0078 view, `public.document_version_timeline` (`security_invoker = true`): every READY version that has an older ready version of the same document, joined to its document's title, category, record and trash state. Why a view and not code: "after the first" cannot be expressed as a PostgREST filter, and filtering it out in JS after a paged read breaks the timeline's k-way merge (a page that loses rows to the filter can skip a qualifying row older than its window forever); and the first ready version is always the oldest, a rule the APP enforces, not the database: `startDocumentVersionUploadAction` (Task 4) refuses to start a new version until the document has a ready current one, and a document whose first upload fails is discarded whole; `reserve_document_version` checks only that the document exists (`0077:179`). Why it is safe: `security_invoker` runs the view with the caller's privileges, so `documents`' policies (tenant, Technician fence, Owners only) and `document_versions_through_document` apply exactly as to the card; 0078 revokes everything (Supabase's default ALL included) and grants SELECT to `authenticated` and `service_role` only (anon nothing, no write privilege for anyone but the owner); `schema-grants-guard.test.ts` gets its first reviewed `rlsOff` entry. **It joins the existing `documents` timeline source** (one more read inside the same `settle`), so `TIMELINE_SOURCES` and every test pinning it are unchanged, a failed read shows as "Couldn't load documents", and paging stays on one `(at, id)` cursor (a version's id is its own uuid, never a document's). New entry kind `documentVersion`: every exhaustive map of kinds (`drawer-summary.ts` `ROW_KINDS`, `contact-drawer.tsx` `ROW_ICON`) and every switch (`author-mark.ts`, `timeline-rows.ts`, `recent-rows.ts`, both timelines) gains it, or the drawer drops the row silently; `tsc` refuses the two `Record` maps without it. The drawer's read fence rises 23 → 24.
7. **"Version N" is the count of READY versions; the Versions list numbers versions by upload order** (`created_at`). After two new versions of one file upload at once, the one that finished last is current and is marked "Current" wherever it sits in the list. Rare, honest, and named.
8. **The typed name is compared as the screen shows it** (no trim, no case folding), in the browser and again on the server, through ONE shared helper both import, `purgeNameKey` in `lib/documents/rules.ts`: Unicode NFC, and every run of whitespace (a non-breaking space included) as one space (Task 7 review I2, orchestrator decision). A raw compare was NOT always typeable, as this line first claimed: `app.tidy_text` (`0077:60`) forbids only EDGE spaces, so a stored title can carry a double space or a non-breaking space that the browser draws as one ordinary space, or a decomposed accent ("Pen" + U+0303) that no keyboard types; each of those would refuse the name the person can see. What still refuses: a different letter, a different case, and any edge space (a stored title has none, so a typed one is a miss).
9. **The space-used number reaches every member, Technicians included** (an aggregate of bytes, never a row, a name or a count of files). The spec's §4.2 item 4 puts it on the card, which every member sees.
10. **One automatic image retry per version per card session** (PR 1a review M7: `document-viewer.tsx`'s `<img onError={onRetry}>` re-mints forever on a broken image). The first error re-mints the URL once; a second shows the viewer's error state with its Retry button, which the person presses.
11. **Spec-vs-code: the row menu.** Spec §4.1 lists "Rename, Category, Expiry" as three menu items; PR 1a shipped one "Edit details" item that opens all three inline (`documents-card.tsx:88-94`, PR 1a's Task 10). This PR adds "Upload new version" after the Owners-only item and before Download (the spec's order) and leaves "Edit details" as it is ("Not in this PR").

## Assumptions (not verified by reading; each has a named check)

- **B1** PostgREST v14 embeds the same table twice in one select under two aliases with two `!constraint` hints: `version:document_versions!documents_current_version_fkey(…)` (already used, `documents.ts:59`) and `versions:document_versions!document_versions_document_fkey(…)` (the one-to-many hint, already used alone at `documents.ts:257`). Check: Task 3's `documents.test.ts` case on the replica's PostgREST, then CI `verify`. Fallback (Task 3 names it): a second read of `document_versions` on the same request client, `.in("document_id", ids)` in chunks of 100, merged in code.
- **B2** `rpc("document_space_used")` answers a `bigint` scalar as a JSON number (it may arrive as a string on some PostgREST settings); `documentSpaceUsed` accepts both and throws on anything else. Check: Task 10's e2e reads the route's `space.used` as a safe integer on the CI stack. **Scope of that check (review M9):** the e2e runs as the agency, so it exercises only 0078's `is_agency()` branch; the member branch (an Owner, a Staff member counting an Owners-only file, refusals) is proven by Task 1's replica test, not end to end.
- **B3** Choosing a Radix `DropdownMenuItem` whose `onSelect` calls `.click()` on a hidden `<input type="file">` opens the file chooser (the item's select is a user activation), in Chromium under Playwright. Check: Task 10 waits for the `filechooser` event. Fallback named there.
- **B4** Production's `apply_migration` reloads PostgREST's schema cache, so `rpc("document_space_used")` resolves without a manual `notify pgrst, 'reload schema'`. Check: Task 12 step 6 calls it once through the API on production and on bis-ci; if PostgREST answers `PGRST202`, the orchestrator sends the notify (read-only otherwise) and re-checks.
- **B6** PostgREST serves a `security_invoker` view to a signed-in client as it does a table: the request runs as `authenticated` with the JWT claims, and the view's RLS is the tables' (PG15+ semantics). Task 1 proves the RLS half on pg directly (`set local role authenticated` with claims, exactly what PostgREST does); the PostgREST half is proven by CI `verify` (`record.test.ts`'s new case through the API) and Task 10's e2e (the row appears for the agency).
- **B5** (carried from PR 1a A4) `storage.from(b).remove([paths])` answers with no error for a path that does not exist. Delete forever treats an error as "try again", so a wrong assumption only refuses a purge that could have gone ahead.

## File Structure

**Created**

| Path | Owner | Responsibility |
|---|---|---|
| `packages/db/supabase/migrations/0078_document_space_used.sql` | bis-db-schema | `public.document_space_used(uuid)`: the account's usage by the quota's rule; `public.document_version_timeline`: the new-version rows, under the caller's RLS |
| `packages/db/src/test/document-space-used.test.ts` | bis-db-schema | the function's sum, parity with the reserve, guard, ACL; the view's rows, fences and grants |
| `apps/web/src/lib/documents/space.ts` (+ `space.test.ts`) | bis-crm | "4.1 of 5 GB used" above 80%, in the reader's language |
| `…/contacts/document-purge-dialog.tsx` (+ test) | bis-frontend | the typed-name dialog for Delete forever |
| `apps/web/e2e/documents-versions.spec.ts` | bis-e2e-qa | new version, Versions list, space read, Delete forever, on the fixture account |

**Modified:** `packages/db/src/{documents,index,record}.ts`, `packages/db/src/test/{documents,record,schema-grants-guard}.test.ts`; `apps/web/src/lib/record/{author-mark,timeline-rows,recent-rows}.ts` (+ tests); `…/contacts/[contactId]/activity-timeline.tsx` (+ `activity-timeline.rows.test.ts`); `…/groups/[groupId]/group-timeline.tsx` (+ test); `…/contacts/contact-drawer.tsx`; `apps/web/src/lib/contacts/drawer-summary.ts` (+ test); `…/api/contacts/[contactId]/summary/route.reads.test.ts`; `apps/web/src/lib/messages.ts`, `apps/web/src/lib/messages.test.ts`; `…/contacts/documents-actions.ts` (+ test); `apps/web/src/lib/documents/{documents-load,document-view,upload-client}.ts`, `documents-load.test.ts`, `upload-client.test.ts`; `…/api/contacts/[contactId]/documents/route.ts`, `…/api/groups/[groupId]/documents/route.ts` (+ tests); `…/contacts/{documents-card.tsx,documents-card-handlers.ts,document-viewer.tsx}` (+ tests); `apps/web/src/app/(dashboard)/dashboard/styleguide/documents-demo.tsx` (+ test); `apps/web/src/lib/i18n/{catalogue,ratchet}-baseline.json`.

## Task list, owners, order

| # | Task | Owner | Review | Depends on | Files |
|---|---|---|---|---|---|
| 0 | Confirm the base | orchestrator | n/a | — | none |
| 1 | Migration 0078 and its proof on the replica; the replica kit | bis-db-schema | **opus** | 0 | the migration, `document-space-used.test.ts`, `<SCRATCH>/s07b-kit/*` |
| 2 | Every key (**messages.ts, the only writer**) | bis-crm | sonnet | 0 | `lib/messages.ts`, `lib/messages.test.ts` |
| 3 | `@bis/db`: versions in the card's read, the space read, the purge's three writes and the restore marker, the version event, the version timeline read | bis-crm | **opus** | 1 | `packages/db/src/{documents,index}.ts`, `test/documents.test.ts` |
| 3b | The timeline's new-version rows (record.ts, both timelines, the drawer) | bis-crm | **opus** | 1, 2, 3 | `packages/db/src/record.ts`, `test/record.test.ts`, `lib/record/{author-mark,timeline-rows,recent-rows}*`, both timelines (+ tests), `contact-drawer.tsx`, `lib/contacts/drawer-summary*`, `summary/route.reads.test.ts` |
| 4 | The server actions: start a version, finish refuses a trashed file, Delete forever, the file's own "not found" | bis-crm | **opus** | 2, 3 | `…/contacts/documents-actions*` |
| 5 | The card's read: versions and space in the routes, the parser, `space.ts` | bis-crm | sonnet | 2, 3 | `lib/documents/{documents-load,document-view,space}*`, both routes (+ tests) |
| 6 | `uploadVersion` in the upload client | bis-frontend | sonnet | 4 | `lib/documents/upload-client*` |
| 7 | The viewer (Versions list, one automatic retry) and the purge dialog | bis-frontend | **opus** | 2, 5 | `…/contacts/{document-viewer,document-purge-dialog}*` |
| 8 | The card, its handlers, and `/styleguide` | bis-frontend | **opus** | 4, 5, 6, 7 | `…/contacts/{documents-card,documents-card-handlers}*`, `styleguide/documents-demo*` |
| 9 | Regenerate the i18n baselines | bis-crm | sonnet | 2, 3b, 4–8 | `lib/i18n/*-baseline.json` |
| 10 | The e2e spec | bis-e2e-qa | sonnet | 8, 9 | `e2e/documents-versions.spec.ts` |
| 11 | Whole-branch final review (checkpoint) | reviewer | **opus** | 1–10, 3b | none |
| 12 | Rollout (orchestrator; LAST) | orchestrator | n/a | 11 | none in the repo |

```
Wave A (two lanes):   T1 (bis-db-schema)                 T2 (bis-crm)
Wave B:               T3 (bis-crm, after T1)
Wave C (three lanes): T4 (bis-crm, after T2+T3)          T5 (bis-crm, 2nd instance, after T2+T3)   T3b (bis-crm, 3rd instance, after T1+T2+T3)
Wave D (two lanes):   T6 (bis-frontend, after T4)        T7 (bis-frontend, 2nd instance, after T2+T5)
Wave E:               T8 (bis-frontend, after T4–T7)
Wave F:               T9
Wave G:               T10
Checkpoint:           T11
Rollout:              T12 (orchestrator, LAST)
```

Disjointness: T4 (actions), T5 (`lib/documents/{documents-load,document-view,space}`, the documents routes) and T3b (`record.ts`, `lib/record/*`, the two timelines, the drawer's kind maps, the summary route's reads test) share no file. T6 (`upload-client*`) and T7 (`document-viewer*`, `document-purge-dialog*`) share no file. The orchestrator may apply 0078 to bis-ci (Task 12 step 2) as soon as Task 1's review approves, so the e2e job's migration check (`.github/scripts/ci-migrations-applied.sh`) is green by the first push.

---

## Task 0: Confirm the base (orchestrator)

- [ ] **Step 1.** In `<WT>`: `git log --oneline -2` shows the plan commit, then `03f43736 Every customer and household has a Documents card…`. `git fetch origin && git log --oneline origin/main -1`; if `main` moved past `03f43736`, `git merge origin/main` (never rebase in the shared tree) and re-run Step 2.
- [ ] **Step 1b.** `pnpm install --frozen-lockfile` in `<WT>` if `node_modules` is absent.
- [ ] **Step 2.** Confirm, and stop if any line differs:
  - `ls packages/db/supabase/migrations | tail -1` → `0077_document_vault.sql`; `git log --all --oneline -- 'packages/db/supabase/migrations/0078*'` → nothing (if another branch holds a 0078, this plan's number becomes the next free one and every `0078` below is renamed in one commit).
  - `grep -n '"documents.untitled.es"' apps/web/src/lib/messages.ts` → `3948:`.
  - `grep -n 'export async function restoreDocument' packages/db/src/documents.ts` → `221:`.
  - `grep -n 'visibleDocument(accountId, docId, false)' "apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/contacts/documents-actions.ts"` → `158:`, `219:` and `347:`.
  - `grep -n 'onError={onRetry}' "apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/contacts/document-viewer.tsx"` → one line.
  - `grep -n "const MEASURED = 23" "apps/web/src/app/api/accounts/[accountId]/contacts/[contactId]/summary/route.reads.test.ts"` → `55:`; `grep -nF "rlsOff).toEqual([])" packages/db/src/test/schema-grants-guard.test.ts` → `108:`.
  - `ls <SCRATCH>/s07-t3-impl/postgrest.exe <SCRATCH>/s07-t3-impl/make-jwt.js <SCRATCH>/s07-t3-impl/proxy.mjs` → all three exist (the replica kit's sources).

---

## Task 1: Migration 0078 and its proof on the replica; the replica kit (bis-db-schema)

**Review:** opus. **Runs beside:** Task 2. **Scratch:** `<SCRATCH>/s07b-t1-impl/`, replica port `55540` (reviewer `s07b-t1-review/`, `55541`).

**Files**
- Create: `<SCRATCH>/s07b-kit/replica.sh` and `<SCRATCH>/s07b-kit/pgrst.sh` (outside the repo; the text is in "The replica kit" above)
- Create: `packages/db/supabase/migrations/0078_document_space_used.sql`
- Create: `packages/db/src/test/document-space-used.test.ts`
- Modify: `packages/db/src/test/schema-grants-guard.test.ts:108` (the `rlsOff` allow-list: its first entry) and its comment `:18`

**Interfaces**
- Consumes (SQL): `public.document_versions (account_id, bytes, status)` and `public.documents (owners_only, deleted_at)` (0077); `app.is_agency()` (`0001_tenancy.sql:9-12`, NULL for a client token); `app.current_account_id()` (`0008_client_access.sql:13-18`, NULL when the token's org matches no account with client access); `public.reserve_document_version(uuid, uuid, bigint, text, text, text)` (`0077:166-191`, answers `used` = the account's sum plus the new bytes). Test helpers `withRollback`, `actAs`, `actAsMember` (`packages/db/src/test/db.ts:4-42`).
- Produces (SQL): `public.document_space_used(p_account_id uuid) returns bigint`, `STABLE SECURITY DEFINER`, `search_path = ''`; the sum of `bytes` over every `document_versions` row of the account (ready and uploading, trashed documents included); raises `22004` on a NULL argument and `42501` unless the caller is the agency or a member of that account's organisation; `EXECUTE` for `authenticated` only (not `anon`, not `service_role`, not `PUBLIC`).
  - `public.document_version_timeline` (view, `security_invoker = true`): columns `id` (the version id), `document_id`, `account_id`, `uploaded_by`, `created_at` (the version's), `title`, `category`, `contact_id`, `client_group_id`, `deleted_at` (the document's); one row per READY version that has an older ready version of the same document; `SELECT` for `authenticated` and `service_role`, nothing for `anon`.

- [ ] **Step 1: Write the kit and build your replica.** Write `<SCRATCH>/s07b-kit/replica.sh` and `<SCRATCH>/s07b-kit/pgrst.sh` exactly as "The replica kit" section gives them (`chmod +x` both). Then:

```bash
bash "/c/Users/danlo/AppData/Local/Temp/claude/C--Users-danlo-bis-platform/db21dcfe-6aee-47cd-8939-ff4f82a45810/scratchpad/s07b-kit/replica.sh" 55540 "/c/Users/danlo/AppData/Local/Temp/claude/C--Users-danlo-bis-platform/db21dcfe-6aee-47cd-8939-ff4f82a45810/scratchpad/s07b-t1-impl"
```

Expected: no `FAILED at` line, then `post = pre (no 0078 yet)`. Run the faithfulness digest on `pre` and on bis-ci (the kit section); paste both; stop if they differ.

- [ ] **Step 2: Write the failing test** `packages/db/src/test/document-space-used.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import type { Client } from "pg";
import { withRollback, actAs, actAsMember } from "./db";

/**
 * 0078, the space-used line's read (spec 4.2 item 4; plan deviation 1). As the table owner inside a
 * rolled-back transaction unless a case switches role. A refused statement runs under a savepoint
 * (`attempt`), so one refusal does not abort the rest of the case (25P02).
 */
const RUN = Math.random().toString(36).slice(2, 10);
const ORG = `org_su_${RUN}`;
const FN = "public.document_space_used(uuid)";

async function attempt(c: Client, sql: string, args: unknown[] = []) {
  await c.query("savepoint attempt");
  try { const r = await c.query(sql, args); await c.query("release savepoint attempt"); return r; }
  catch (e) { await c.query("rollback to savepoint attempt"); throw e; }
}

async function seed(c: Client) {
  const one = async (sql: string, args: unknown[]) => (await c.query<{ id: string }>(sql, args)).rows[0]!.id;
  const { rows: [agency] } = await c.query<{ id: string }>("select id from agencies limit 1");
  const acct = await one("insert into accounts (agency_id, clerk_org_id, name, client_access_enabled) values ($1,$2,'SU Co',true) returning id", [agency!.id, ORG]);
  const other = await one("insert into accounts (agency_id, clerk_org_id, name, client_access_enabled) values ($1,$2,'SU B',true) returning id", [agency!.id, `${ORG}_b`]);
  const ana = await one("insert into contacts (account_id, first_name) values ($1,'Ana') returning id", [acct]);
  const bea = await one("insert into contacts (account_id, first_name) values ($1,'Bea') returning id", [other]);
  return { acct, other, ana, bea };
}

/** A document on a contact, as the table owner; `ownersOnly` and `trashed` set directly. */
async function doc(c: Client, acct: string, contact: string, o: { ownersOnly?: boolean; trashed?: boolean } = {}) {
  const { rows: [d] } = await c.query<{ id: string }>(
    `insert into documents (account_id, contact_id, title, category, source, scan_status, created_by, owners_only, deleted_at, deleted_by)
     values ($1,$2,'File','other','upload','skipped','user_su',$3,$4,$5) returning id`,
    [acct, contact, o.ownersOnly ?? false, o.trashed ? new Date().toISOString() : null, o.trashed ? "user_su" : null]);
  return d!.id;
}

/** A version row of `bytes`, ready (hashed) or still uploading. */
async function version(c: Client, acct: string, documentId: string, bytes: number, ready: boolean) {
  const { rows: [v] } = await c.query<{ id: string }>("select gen_random_uuid() as id");
  await c.query(
    `insert into document_versions (id, document_id, account_id, storage_path, bytes, content_type, uploaded_by, status, sha256)
     values ($1,$2,$3,$4,$5,'application/pdf','user_su',$6,$7)`,
    [v!.id, documentId, acct, `${acct}/${documentId}/${v!.id}`, bytes, ready ? "ready" : "uploading", ready ? "c".repeat(64) : null]);
  return v!.id;
}

const used = async (c: Client, acct: string) =>
  Number((await attempt(c, "select public.document_space_used($1::uuid) as n", [acct])).rows[0]!.n);

describe("document_space_used: the quota's own sum (spec 4.2 item 4, 3.5)", () => {
  it("counts ready AND uploading versions, trashed documents included, and never another account's (mutations: `and v.status = 'ready'` -> FAILS; drop the account filter -> FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      const trashed = await doc(c, s.acct, s.ana, { trashed: true });
      const live = await doc(c, s.acct, s.ana);
      const theirs = await doc(c, s.other, s.bea);
      await version(c, s.acct, trashed, 100, true);
      await version(c, s.acct, live, 30, false);
      await version(c, s.other, theirs, 1000, true);
      await actAsMember(c, s.acct, ORG, "owner");
      expect(await used(c, s.acct)).toBe(130);
    }));

  it("equals the used figure reserve_document_version answers, which already counts the 25 bytes it just reserved (mutation: sum only documents with deleted_at is null -> FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      const trashed = await doc(c, s.acct, s.ana, { trashed: true });
      await version(c, s.acct, trashed, 700, true);
      const live = await doc(c, s.acct, s.ana);
      // As the table owner (reserve is service_role only; the owner holds every privilege).
      const r = (await c.query<{ r: { status: string; used: number } }>(
        "select public.reserve_document_version($1::uuid,$2::uuid,25::bigint,'application/pdf','x.pdf','user_su') as r", [s.acct, live])).rows[0]!.r;
      expect(r.status).toBe("ok");
      await actAsMember(c, s.acct, ORG, "staff");
      expect(await used(c, s.acct)).toBe(Number(r.used));
      expect(Number(r.used)).toBe(725);
    }));

  it("is the ACCOUNT's number for every member: a Staff member counts an Owners-only file they cannot read (mutation: security invoker -> FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      const secret = await doc(c, s.acct, s.ana, { ownersOnly: true });
      await version(c, s.acct, secret, 50, true);
      await actAsMember(c, s.acct, ORG, "staff");
      // Positive control: RLS really hides the file from this Staff member.
      const { rows: [seen] } = await c.query<{ n: string }>("select count(*) as n from document_versions");
      expect(Number(seen!.n)).toBe(0);
      expect(await used(c, s.acct)).toBe(50);
    }));

  it("the agency reads any account (mutation: drop app.is_agency() from the guard -> FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      const d = await doc(c, s.other, s.bea);
      await version(c, s.other, d, 64, true);
      await actAs(c, { app_role: "agency_admin", sub: `user_agency_${RUN}` });
      expect(await used(c, s.other)).toBe(64);
    }));

  it("refuses a member of another account and a token whose organisation matches no account (mutations: drop the coalesce on app.is_agency() -> FAILS on the first; drop the coalesce on current_account_id -> FAILS on the second)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      await actAsMember(c, s.other, `${ORG}_b`, "owner");
      await expect(attempt(c, "select public.document_space_used($1::uuid)", [s.acct])).rejects.toMatchObject({ code: "42501" });
      await c.query("reset role");
      await actAs(c, { org_id: `org_nobody_${RUN}`, sub: `user_nobody_${RUN}` });
      await expect(attempt(c, "select public.document_space_used($1::uuid)", [s.acct])).rejects.toMatchObject({ code: "42501" });
    }));

  it("a NULL account raises 22004 before it reads anything (mutation: drop the null guard -> FAILS)", () =>
    withRollback(async (c) => {
      await expect(attempt(c, "select public.document_space_used(null::uuid)")).rejects.toMatchObject({ code: "22004" });
    }));

  it("executable by authenticated only, SECURITY DEFINER, STABLE, search_path empty (mutation: grant execute to anon -> FAILS)", () =>
    withRollback(async (c) => {
      const { rows } = await c.query<{ r: string; ok: boolean }>(
        `select r, has_function_privilege(r, '${FN}', 'EXECUTE') as ok
           from (values ('anon'), ('authenticated'), ('service_role')) v(r) order by 1`);
      expect(rows).toEqual([{ r: "anon", ok: false }, { r: "authenticated", ok: true }, { r: "service_role", ok: false }]);
      const { rows: [f] } = await c.query<{ prosecdef: boolean; provolatile: string; proconfig: string[] }>(
        `select prosecdef, provolatile, proconfig from pg_proc where oid = '${FN}'::regprocedure`);
      expect(f).toEqual({ prosecdef: true, provolatile: "s", proconfig: ['search_path=""'] });
    }));
});

/** A version row created at an explicit instant (one transaction's now() is one instant for every row). */
async function versionAt(c: Client, acct: string, documentId: string, at: string, ready = true) {
  const { rows: [v] } = await c.query<{ id: string }>("select gen_random_uuid() as id");
  await c.query(
    `insert into document_versions (id, document_id, account_id, storage_path, bytes, content_type, uploaded_by, status, sha256, created_at)
     values ($1,$2,$3,$4,10,'application/pdf','user_up',$5,$6,$7)`,
    [v!.id, documentId, acct, `${acct}/${documentId}/${v!.id}`, ready ? "ready" : "uploading", ready ? "c".repeat(64) : null, at]);
  return v!.id;
}
const timelineIds = async (c: Client) =>
  (await attempt(c, "select id from public.document_version_timeline order by created_at desc, id desc")).rows.map((r) => (r as { id: string }).id);

describe("document_version_timeline: a row per NEW version (owner ruling R2; plan deviation 6)", () => {
  it("every ready version after a document's first, with its document's title, category, record and trash state; never the first, never one still uploading (mutations: drop the exists clause -> FAILS; drop `v.status = 'ready'` -> FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      const d = await doc(c, s.acct, s.ana, { trashed: true });
      await versionAt(c, s.acct, d, "2026-10-01T10:00:00Z");
      const second = await versionAt(c, s.acct, d, "2026-10-05T10:00:00Z");
      await versionAt(c, s.acct, d, "2026-10-06T10:00:00Z", false);
      const lone = await doc(c, s.acct, s.ana);
      await versionAt(c, s.acct, lone, "2026-10-02T10:00:00Z");
      await actAsMember(c, s.acct, ORG, "owner");
      expect(await timelineIds(c)).toEqual([second]);
      const { rows: [row] } = await attempt(c,
        "select document_id, account_id, uploaded_by, title, category, contact_id, client_group_id, deleted_at is not null as trashed from public.document_version_timeline where id = $1", [second]);
      expect(row).toEqual({ document_id: d, account_id: s.acct, uploaded_by: "user_up", title: "File", category: "other", contact_id: s.ana, client_group_id: null, trashed: true });
    }));

  it("runs under the CALLER's RLS: a Staff member never sees an Owners-only file's new version, another account sees none (mutation: drop `security_invoker = true` -> FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      const secret = await doc(c, s.acct, s.ana, { ownersOnly: true });
      await versionAt(c, s.acct, secret, "2026-10-01T10:00:00Z");
      const shown = await versionAt(c, s.acct, secret, "2026-10-03T10:00:00Z");
      await actAsMember(c, s.acct, ORG, "owner");
      expect(await timelineIds(c)).toEqual([shown]);                 // positive control: the Owner sees it
      await c.query("reset role");
      await actAsMember(c, s.acct, ORG, "staff");
      expect(await timelineIds(c)).toEqual([]);
      await c.query("reset role");
      await actAsMember(c, s.other, `${ORG}_b`, "owner");
      expect(await timelineIds(c)).toEqual([]);
    }));

  it("a Technician sees a TEAM file's new version only on a customer assigned to them (review m3: team-visible files, so only the Technician fence can hide them; mutation: drop policy documents_technician_scope -> FAILS on the unassigned leg)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      const bo = (await c.query<{ id: string }>("insert into contacts (account_id, first_name) values ($1,'Bo') returning id", [s.acct])).rows[0]!.id;
      const theirs = await doc(c, s.acct, bo);                       // owners_only false: the team may see it
      await versionAt(c, s.acct, theirs, "2026-10-01T10:00:00Z");
      await versionAt(c, s.acct, theirs, "2026-10-02T10:00:00Z");
      const mine = await doc(c, s.acct, s.ana);
      await versionAt(c, s.acct, mine, "2026-10-01T11:00:00Z");
      const mineNew = await versionAt(c, s.acct, mine, "2026-10-02T11:00:00Z");
      const sub = await actAsMember(c, s.acct, ORG, "technician");
      expect(await timelineIds(c)).toEqual([]);                      // nothing assigned: neither customer's file
      await c.query("reset role");
      await c.query("update contacts set assigned_to = (select id from users where clerk_user_id = $1) where id = $2", [sub, s.ana]);
      await actAs(c, { org_id: ORG, sub });
      expect(await timelineIds(c)).toEqual([mineNew]);               // assigned Ana: hers only, never Bo's
    }));

  it("SELECT for authenticated and service_role and nothing else; anon nothing; the view is security_invoker (mutations: grant insert to authenticated, or leave the default grants -> FAILS; drop service_role from the grant -> FAILS)", () =>
    withRollback(async (c) => {
      const { rows } = await c.query<{ k: string }>(
        `select r || ' ' || p as k from (values ('anon'), ('authenticated')) v(r)
          cross join (values ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE'), ('TRUNCATE'), ('REFERENCES'), ('TRIGGER')) x(p)
         where has_table_privilege(r, 'public.document_version_timeline', p) order by 1`);
      expect(rows.map((r) => r.k)).toEqual(["authenticated SELECT"]);
      // Review m4: service_role reads it too (the orchestrator's read-only checks), and writes nothing.
      const { rows: [svc] } = await c.query<{ sel: boolean; ins: boolean }>(
        "select has_table_privilege('service_role', 'public.document_version_timeline', 'SELECT') as sel, has_table_privilege('service_role', 'public.document_version_timeline', 'INSERT') as ins");
      expect(svc).toEqual({ sel: true, ins: false });
      const { rows: [o] } = await c.query<{ opts: string[] | null }>(
        "select c.reloptions as opts from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relname = 'document_version_timeline'");
      expect(o!.opts).toEqual(["security_invoker=true"]);
    }));
});
```

Why each case can fail (the writer's check; the implementer re-runs each probe): case 1 sums to 100 with a ready-only filter and to 1130 without the account filter; case 2's reserve `used` (725) includes the trashed document, so a live-only sum (25) differs; case 3 is 0 under `security invoker` (the positive control proves RLS hides the row, so the 50 can only come from the definer); case 4 refuses the agency token without `is_agency()`; case 5's first caller has `is_agency()` NULL and `current_account_id()` = the other account, so `not (NULL or false)` is NULL and the `if` falls through without the coalesce, and its second caller has both NULL; case 7's privilege list changes with any grant. The view's first case returns the first version too without the `exists` clause, and the uploading one without the status filter (its document has an older ready version); its second case shows the Owner's row to the Staff member and the other account without `security_invoker`; the Technician case uses team-visible files (no Owners-only fence to mask it), so its unassigned leg is red only through the Technician fence and its assigned leg is the positive control (the view would run as its owner, past RLS; the Owner's row is the positive control that the row exists); its third catches Supabase's default ALL grant (`bootstrap/ci-project.sql:58-63`) left un-revoked, and a dropped `security_invoker` option. `has_function_privilege(… 'anon' …)` is `true` if `PUBLIC` keeps EXECUTE, so the revoke from `public` is pinned too.

- [ ] **Step 3: Run it red on `pre`.** From `<WT>/packages/db` in Git Bash:

```bash
S=/c/Users/danlo/AppData/Local/Temp/claude/C--Users-danlo-bis-platform/db21dcfe-6aee-47cd-8939-ff4f82a45810/scratchpad/s07b-t1-impl
SUPABASE_DB_URL=postgresql://postgres@localhost:55540/pre pnpm exec vitest run src/test/document-space-used.test.ts > "$S/pre.log" 2>&1; echo $? > "$S/pre.exit"
```

Expected: exit 1; every function case fails on `function public.document_space_used(uuid) does not exist` (42883), the ACL case on `regprocedure`, every view case on `relation "public.document_version_timeline" does not exist` (42P01). Paste the summary block.

- [ ] **Step 4: Write `packages/db/supabase/migrations/0078_document_space_used.sql`:**

```sql
-- 0078_document_space_used.sql - the document vault, part 1b: the space-used line
-- (docs/superpowers/specs/2026-10-13-document-vault-design.md section 4.2 item 4;
--  docs/superpowers/plans/2026-10-14-document-vault-pr1b.md deviation 1)
--
-- One number for the Documents card: the bytes of every version of the account, ready AND uploading,
-- trashed documents included until purged. That is exactly the sum reserve_document_version (0077,
-- section 6) checks against the 5 GiB quota, so the card's line and the quota's refusal can never
-- disagree. SECURITY DEFINER because the number is the ACCOUNT's: under RLS a Staff member would not
-- count an Owners-only file, nor a Technician a customer outside their scope, and the card would
-- understate a quota the whole team shares. It answers one number, never a row, a name or a count.
-- The caller must be the agency or a member of that account's organisation (the tenant rule of
-- documents_member_read, 0077); anyone else gets 42501. Both halves of the guard coalesce:
-- app.is_agency() is NULL for a client token, and app.current_account_id() is NULL for a token whose
-- organisation matches no account, and a NULL in an IF condition would fall through, open.
--
-- APPLY ORDER: CI project (ci-project-setup.yml: push-dry-run, then push), then production (MCP
-- apply_migration, once), then the parity check, then merge. Additive: nothing before it calls it.
-- ROLLBACK (revert the app first): drop function public.document_space_used(uuid);
--
-- ASCII only, no backslash anywhere.

set local lock_timeout = '5s';

create function public.document_space_used(p_account_id uuid)
returns bigint language plpgsql stable security definer set search_path = '' as $$
begin
  if p_account_id is null then
    raise exception 'document_space_used: the account is null' using errcode = '22004';
  end if;
  if not (coalesce(app.is_agency(), false) or coalesce(p_account_id = app.current_account_id(), false)) then
    raise exception 'document_space_used: not this account' using errcode = '42501';
  end if;
  -- reserve_document_version's own sum (0077 section 6), on document_versions_by_account.
  return (select coalesce(sum(v.bytes), 0) from public.document_versions v where v.account_id = p_account_id);
end $$;

revoke all on function public.document_space_used(uuid) from public, anon, authenticated, service_role;
grant execute on function public.document_space_used(uuid) to authenticated;

-- 2. The timeline's new-version rows (owner ruling 2026-10-14; plan deviation 6): every READY version
--    that has an older ready version of the same document (the first is the "added a file" row, read
--    from documents). The first ready version is the oldest only because the APP refuses to start a
--    new version until the document has a ready current one (startDocumentVersionUploadAction, plan
--    Task 4); reserve_document_version (0077) checks only that the document exists, so the database
--    does not hold this rule. security_invoker: the view runs with the CALLER's
--    privileges, so the documents policies (tenant, Technician fence, Owners only) and
--    document_versions_through_document decide every row, as for the card. The first view in public:
--    schema-grants-guard.test.ts lists it, a reviewed decision. SELECT only; the default ALL grant a
--    new view gets is revoked first.
create view public.document_version_timeline with (security_invoker = true) as
  select v.id, v.document_id, v.account_id, v.uploaded_by, v.created_at,
         d.title, d.category, d.contact_id, d.client_group_id, d.deleted_at
    from public.document_versions v
    join public.documents d on d.id = v.document_id and d.account_id = v.account_id
   where v.status = 'ready'
     and exists (select 1 from public.document_versions p
                  where p.document_id = v.document_id and p.status = 'ready'
                    and (p.created_at, p.id) < (v.created_at, v.id));

revoke all on public.document_version_timeline from public, anon, authenticated, service_role;
grant select on public.document_version_timeline to authenticated, service_role;

comment on view public.document_version_timeline is
  'One row per new version of a document (0078): every ready version after the first. security_invoker, so the RLS of documents and document_versions decides what each caller sees.';
```

Header changes in the same file: the ROLLBACK line becomes `-- ROLLBACK (revert the app first): drop view public.document_version_timeline; drop function public.document_space_used(uuid);`, and the header's first line after the title becomes `-- Two reads: the Documents card's space-used number (1, below) and the timeline's new-version rows (2, below).`

- [ ] **Step 4b: The schema-wide guard's first view.** In `packages/db/src/test/schema-grants-guard.test.ts`, line 108, replace `expect((await writeSurface(c)).rlsOff).toEqual([]);` with

```ts
      // 0078 (S-07 1b): the one view in public, security_invoker (the tables' RLS decides every row its caller
      // reads) and SELECT-only, reviewed in docs/superpowers/plans/2026-10-14-document-vault-pr1b.md deviation 6.
      // document-space-used.test.ts pins its security_invoker option and its grants.
      expect((await writeSurface(c)).rlsOff).toEqual(["document_version_timeline"]);
```

and in the file's comment (line 18), "There are none today." becomes "There is one: document_version_timeline (0078), security_invoker, SELECT-only."

- [ ] **Step 5: The ASCII check, with a positive control** (Git Bash's `grep -P` exits 2 silently):

```bash
cd /c/Users/danlo/bis-platform/.claude/worktrees/s07-1b
node -e 'const fs=require("fs");const check=(p)=>{const b=fs.readFileSync(p);let bad=0;for(const x of b){if(x>127||x===92)bad++;}return bad;};const S=process.argv[1];fs.writeFileSync(S+"/control.sql","select 1; -- café \\\\ \n");console.log("control",check(S+"/control.sql"),"0078",check("packages/db/supabase/migrations/0078_document_space_used.sql"))' "/c/Users/danlo/AppData/Local/Temp/claude/C--Users-danlo-bis-platform/db21dcfe-6aee-47cd-8939-ff4f82a45810/scratchpad/s07b-t1-impl"
```

Expected: `control` a number above 0, `0078 0`.

- [ ] **Step 6: Rebuild and run green on `post`.** Re-run `replica.sh 55540 <dir>` (now `post = pre + 0078`), then the Step 3 command with `/post` and `post.log`/`post.exit`. Expected: exit 0, 11 passed. Also run `src/test/schema-grants-guard.test.ts` on `post` → passes, and on `pre` → its `rlsOff` case fails (the edit is only right beside the view). Paste the summary block.

- [ ] **Step 7: Mutation probes, each red BY NAME on `post`, then restored.** Apply each with `psql -p 55540 -d post` as a `create or replace function` (or a `grant`) of the mutated text, run the file, paste the failing assertion line, then re-run `replica.sh` (it rebuilds `post` clean) before the next:
  1. `… where v.account_id = p_account_id and v.status = 'ready'` → case 1 fails (100 ≠ 130).
  2. drop `where v.account_id = p_account_id` → case 1 fails (1130).
  3. `security invoker` in place of `security definer` → case 3 fails (0 ≠ 50).
  4. guard without `coalesce(app.is_agency(), false) or` (only the account half) → case 4 fails.
  5. `app.is_agency() or coalesce(p_account_id = app.current_account_id(), false)` (no coalesce on the agency half) → case 5 fails on its first expect.
  6. `coalesce(app.is_agency(), false) or p_account_id = app.current_account_id()` (no coalesce on the account half) → case 5 fails on its second expect.
  7. drop the null guard → case 6 fails.
  8. `grant execute on function public.document_space_used(uuid) to anon;` → case 7 fails.
  9. `… from public.document_versions v join public.documents d on d.id = v.document_id where v.account_id = p_account_id and d.deleted_at is null` → case 2 fails (25 ≠ 725).
  10. recreate the view without the `exists (…)` clause → the view's first case fails (the first version listed).
  11. recreate it without `with (security_invoker = true)` → its second case fails (the Staff member sees the Owners-only row) and its third (reloptions).
  12. `grant insert on public.document_version_timeline to authenticated;` → its third case fails, and `schema-grants-guard.test.ts` fails naming the view's write.
  12b. `drop policy documents_technician_scope on public.documents;` → the Technician case fails on its unassigned leg.
  13. revert Step 4b's guard edit with 0078 applied → `schema-grants-guard.test.ts` fails naming `document_version_timeline`; with the edit on `pre` (no view) it fails the other way, so the allow-list is green only beside the view.

- [ ] **Step 8: Commit.**

```bash
git add -- packages/db/supabase/migrations/0078_document_space_used.sql packages/db/src/test/document-space-used.test.ts
git commit -m "feat(db): 0078 document_space_used and the new-version timeline view (S-07 part 1b)" -- packages/db/supabase/migrations/0078_document_space_used.sql packages/db/src/test/document-space-used.test.ts packages/db/src/test/schema-grants-guard.test.ts
```

(Commit message body: the trailer lines from Global Constraints.) Leave your replica running for your reviewer only if asked; otherwise stop it (kit section).

---

## Task 2: Every key (bis-crm; messages.ts, the only writer)

**Review:** sonnet. **Runs beside:** Task 1.

**Files**
- Modify: `apps/web/src/lib/messages.ts` (a block directly after `"documents.untitled.es"`, line 3948)
- Modify: `apps/web/src/lib/messages.test.ts` (one new `describe` after the vault's, which ends at line 224, the file's last line)

**Interfaces**
- Produces (every later task uses exactly these keys; nothing else is added anywhere):

| Key | English | Spanish |
|---|---|---|
| `documents.error.fileNotFound` | We can't find this file anymore. Reload the page. | Ya no encontramos este archivo. Vuelva a cargar la página. |
| `documents.error.trashed` | This file is in the trash. Restore it first. | Este archivo está en la papelera. Restáurelo primero. |
| `documents.newVersion` | Upload new version | Subir una versión nueva |
| `documents.versionAdded` | New version of {title} added. | Se agregó una versión nueva de {title}. |
| `documents.version` | Version {n} | Versión {n} |
| `documents.versions` | Versions | Versiones |
| `documents.versionLine` | Version {n} · {when} | Versión {n} · {when} |
| `documents.versionCurrent` | Current | Actual |
| `documents.downloadVersion` | Download version {n} | Descargar la versión {n} |
| `documents.deleteForever` | Delete forever | Borrar para siempre |
| `documents.purge.body` | This deletes {title} and all of its versions for good. It can't be undone. | Esto borra {title} y todas sus versiones para siempre. No se puede deshacer. |
| `documents.purge.bodyOne` | This deletes {title} for good. It can't be undone. | Esto borra {title} para siempre. No se puede deshacer. |
| `documents.purge.label` | Type the file's name to confirm | Escriba el nombre del archivo para confirmar |
| `documents.purge.mismatch` | The name doesn't match. Type it exactly as shown. | El nombre no coincide. Escríbalo tal como aparece. |
| `documents.purged` | {title} was deleted for good. | {title} se borró para siempre. |
| `documents.error.purgeUploading` | A new version of this file is still uploading. Try again later. | Todavía se está subiendo una versión nueva de este archivo. Intente de nuevo más tarde. |
| `documents.error.purgeRole` | Only an Owner can delete a file forever. | Solo un dueño puede borrar un archivo para siempre. |
| `documents.error.purgeChanged` | Someone changed this file first, so it was not deleted. | Alguien cambió este archivo primero, así que no se borró. |
| `documents.error.purge` | Couldn't delete that file. Try again. | No se pudo borrar ese archivo. Intente de nuevo. |
| `documents.spaceUsed` | {used} of {quota} GB used | {used} de {quota} GB usados |
| `timeline.documentVersion` | uploaded a new version of {title} | subió una nueva versión de {title} |
| `documents.status.purging` | Being deleted | Se está borrando |

`documents.error.notFound` stays (the start action's "this record" answer, `documents-actions.ts:98`); Task 4 moves only the file's answers to `fileNotFound`. `timeline.documentVersion` follows the timeline's own voice: the row reads "{mark} {verb}" exactly as `timeline.document` ("added a file: {title}" / "agregó un archivo: {title}", `messages.ts:3949-3950`) does, third person, no usted form needed. `documents.purge.body` is for a file with two or more versions, `documents.purge.bodyOne` for one (review M11). `purgeUploading` promises no time (review M6: it can last up to three hours).

- [ ] **Step 1: Write the failing test.** Append to `apps/web/src/lib/messages.test.ts`, after line 224:

```ts
describe("the document vault's copy, PR 1b (versions, Delete forever, space used)", () => {
  const WANT: Record<string, [string, string]> = {
    "documents.error.fileNotFound": ["We can't find this file anymore. Reload the page.", "Ya no encontramos este archivo. Vuelva a cargar la página."],
    "documents.error.trashed": ["This file is in the trash. Restore it first.", "Este archivo está en la papelera. Restáurelo primero."],
    "documents.newVersion": ["Upload new version", "Subir una versión nueva"],
    "documents.versionAdded": ["New version of {title} added.", "Se agregó una versión nueva de {title}."],
    "documents.version": ["Version {n}", "Versión {n}"],
    "documents.versions": ["Versions", "Versiones"],
    "documents.versionLine": ["Version {n} · {when}", "Versión {n} · {when}"],
    "documents.versionCurrent": ["Current", "Actual"],
    "documents.downloadVersion": ["Download version {n}", "Descargar la versión {n}"],
    "documents.deleteForever": ["Delete forever", "Borrar para siempre"],
    "documents.purge.body": ["This deletes {title} and all of its versions for good. It can't be undone.", "Esto borra {title} y todas sus versiones para siempre. No se puede deshacer."],
    "documents.purge.bodyOne": ["This deletes {title} for good. It can't be undone.", "Esto borra {title} para siempre. No se puede deshacer."],
    "documents.purge.label": ["Type the file's name to confirm", "Escriba el nombre del archivo para confirmar"],
    "documents.purge.mismatch": ["The name doesn't match. Type it exactly as shown.", "El nombre no coincide. Escríbalo tal como aparece."],
    "documents.purged": ["{title} was deleted for good.", "{title} se borró para siempre."],
    "documents.error.purgeUploading": ["A new version of this file is still uploading. Try again later.", "Todavía se está subiendo una versión nueva de este archivo. Intente de nuevo más tarde."],
    "documents.error.purgeRole": ["Only an Owner can delete a file forever.", "Solo un dueño puede borrar un archivo para siempre."],
    "documents.error.purgeChanged": ["Someone changed this file first, so it was not deleted.", "Alguien cambió este archivo primero, así que no se borró."],
    "documents.error.purge": ["Couldn't delete that file. Try again.", "No se pudo borrar ese archivo. Intente de nuevo."],
    "documents.spaceUsed": ["{used} of {quota} GB used", "{used} de {quota} GB usados"],
    "timeline.documentVersion": ["uploaded a new version of {title}", "subió una nueva versión de {title}"],
    "documents.status.purging": ["Being deleted", "Se está borrando"],
  };
  it("every new key is the plan's wording, in both languages (mutation: 'Sube' for 'Suba'-style tú in any .es, or any word changed -> FAILS)", () => {
    for (const [k, [en, es]] of Object.entries(WANT)) {
      expect([m[k as MessageKey], m[`${k}.es` as MessageKey]], k).toEqual([en, es]);
    }
  });
  it("the file's own 'not found' says file, and the record's still says record and the in-flight refusal promises no time (review M6) (mutations: point fileNotFound at the record wording -> FAILS; 'Try again in a few minutes.' -> FAILS)", () => {
    expect(m["documents.error.fileNotFound"]).toMatch(/\bfile\b/);
    expect(m["documents.error.fileNotFound.es"]).toMatch(/\barchivo\b/);
    // Review M6: the in-flight refusal can last hours, so it promises no time.
    expect(m["documents.error.purgeUploading"]).not.toMatch(/minute/);
    expect(m["documents.error.purgeUploading.es"]).not.toMatch(/minuto/);
    expect([m["documents.error.notFound"], m["documents.error.notFound.es"]]).toEqual([
      "We can't find this record anymore. Reload the page.", "Ya no encontramos este registro. Vuelva a cargar la página."]);
  });
});
```

(Both cases are red today: `m[k]` is `undefined` for every new key, and `toMatch` on `undefined` throws. The second case's last line pins that the record's own answer, still used by the first-upload start, did not move.)

- [ ] **Step 2: Run it.** `pnpm --filter web exec vitest run src/lib/messages.test.ts` → the two new cases FAIL by name.

- [ ] **Step 3: Add the keys.** Directly after line 3948 (`"documents.untitled.es": "Archivo sin nombre",`), insert, each `.es` under its English key:

```ts
  // S-07 part 1b: versions, Delete forever by typed name, the space-used line (plan 2026-10-14).
  "documents.error.fileNotFound": "We can't find this file anymore. Reload the page.",
  "documents.error.fileNotFound.es": "Ya no encontramos este archivo. Vuelva a cargar la página.",
  "documents.error.trashed": "This file is in the trash. Restore it first.",
  "documents.error.trashed.es": "Este archivo está en la papelera. Restáurelo primero.",
  "documents.newVersion": "Upload new version",
  "documents.newVersion.es": "Subir una versión nueva",
  "documents.versionAdded": "New version of {title} added.",
  "documents.versionAdded.es": "Se agregó una versión nueva de {title}.",
  "documents.version": "Version {n}",
  "documents.version.es": "Versión {n}",
  "documents.versions": "Versions",
  "documents.versions.es": "Versiones",
  "documents.versionLine": "Version {n} · {when}",
  "documents.versionLine.es": "Versión {n} · {when}",
  "documents.versionCurrent": "Current",
  "documents.versionCurrent.es": "Actual",
  "documents.downloadVersion": "Download version {n}",
  "documents.downloadVersion.es": "Descargar la versión {n}",
  "documents.deleteForever": "Delete forever",
  "documents.deleteForever.es": "Borrar para siempre",
  "documents.purge.body": "This deletes {title} and all of its versions for good. It can't be undone.",
  "documents.purge.body.es": "Esto borra {title} y todas sus versiones para siempre. No se puede deshacer.",
  "documents.purge.bodyOne": "This deletes {title} for good. It can't be undone.",
  "documents.purge.bodyOne.es": "Esto borra {title} para siempre. No se puede deshacer.",
  "documents.purge.label": "Type the file's name to confirm",
  "documents.purge.label.es": "Escriba el nombre del archivo para confirmar",
  "documents.purge.mismatch": "The name doesn't match. Type it exactly as shown.",
  "documents.purge.mismatch.es": "El nombre no coincide. Escríbalo tal como aparece.",
  "documents.purged": "{title} was deleted for good.",
  "documents.purged.es": "{title} se borró para siempre.",
  "documents.error.purgeUploading": "A new version of this file is still uploading. Try again later.",
  "documents.error.purgeUploading.es": "Todavía se está subiendo una versión nueva de este archivo. Intente de nuevo más tarde.",
  "documents.error.purgeRole": "Only an Owner can delete a file forever.",
  "documents.error.purgeRole.es": "Solo un dueño puede borrar un archivo para siempre.",
  "documents.error.purgeChanged": "Someone changed this file first, so it was not deleted.",
  "documents.error.purgeChanged.es": "Alguien cambió este archivo primero, así que no se borró.",
  "documents.error.purge": "Couldn't delete that file. Try again.",
  "documents.error.purge.es": "No se pudo borrar ese archivo. Intente de nuevo.",
  "documents.spaceUsed": "{used} of {quota} GB used",
  "documents.spaceUsed.es": "{used} de {quota} GB usados",
  "timeline.documentVersion": "uploaded a new version of {title}",
  "timeline.documentVersion.es": "subió una nueva versión de {title}",
  "documents.status.purging": "Being deleted",
  "documents.status.purging.es": "Se está borrando",
```

- [ ] **Step 4: Run.** `pnpm --filter web exec vitest run src/lib/messages.test.ts src/lib/i18n/ratchet.test.ts` → the vault describes PASS; the ratchet's twin check passes (its baseline step is Task 9; if the catalogue-baseline case fails ONLY on the count of new keys, that is expected until Task 9 and is stated in the report). `pnpm --filter web typecheck` → clean.

- [ ] **Step 5: Probes.** (c) Write `purgeUploading` as "Try again in a few minutes." → case 2's M6 line fails; revert. (a) Change `documents.purge.label.es` to `"Escribe el nombre del archivo para confirmar"` → case 1 FAILS naming `documents.purge.label`; revert. (b) Set `documents.error.fileNotFound` to the record sentence → case 2 FAILS; revert.

- [ ] **Step 6: Commit.** `git commit -m "feat(i18n): the document vault's 1b copy, both languages (S-07 part 1b)" -- apps/web/src/lib/messages.ts apps/web/src/lib/messages.test.ts`

---

## Task 3: `@bis/db`: versions in the card's read, the space read, the purge's three writes (bis-crm)

**Review:** opus. **After:** Task 1 (0078 committed). **Scratch:** `<SCRATCH>/s07b-t3-impl/`; replica + PostgREST on `55542`/`55543`/`55544` (reviewer `55545`/`55546`/`55547`), built with the kit. **Never against bis-ci.**

**Files**
- Modify: `packages/db/src/documents.ts` (`ListedDocument` `:26`, `listRecordDocuments` `:54-73`; `markDocumentVersionReady` `:144-153`; `restoreDocument` `:220-233`; new functions after `restoreDocument` and after `listDocumentTimeline` `:388`)
- Modify: `packages/db/src/index.ts:270-277` (the documents export block)
- Modify: `packages/db/src/test/documents.test.ts` (imports `:6-11`; new describes at the end)

**Interfaces**
- Consumes: 0077's tables; 0078's `public.document_space_used(uuid)`; `emitAfter`, `recordPayload`, `asVersion`, `VERSION_COLS`, `DOC_COLS` (`documents.ts:32-52`).
- Produces (exact; Tasks 4 and 5 rely on these):

```ts
export type ListedDocument = DocumentRow & { version: DocumentVersionRow; versions: DocumentVersionRow[] };
// versions: every READY version of the document, newest first (created_at desc, id desc); always includes `version`.
export async function documentSpaceUsed(db: SupabaseClient, accountId: string): Promise<number>;      // request client; THROWS on error or a non-integer
export type DocumentVersionState = { storage_path: string; status: "uploading" | "ready" };
export async function listDocumentVersionStates(db: SupabaseClient, accountId: string, documentId: string): Promise<DocumentVersionState[]>;   // service client
export async function claimDocumentForPurge(db: SupabaseClient, accountId: string, documentId: string, expectedDeletedAt: string): Promise<string | null>;   // service client; the new instant, or null
export async function deletePurgedDocument(db: SupabaseClient, accountId: string, doc: { id: string; contact_id: string | null; client_group_id: string | null }, claimedAt: string, actorId: string): Promise<boolean>;   // service client; emits document.purged as `user`
export const DOCUMENT_PURGING_MARK: "documents:purging";   // deleted_by of a claimed row; restoreDocument refuses it
// markDocumentVersionReady: a later (not first) version now emits document.version_added { documentId, versionId, contactId | groupId }.
export type TimelineDocumentVersion = {
  id: string; document_id: string; title: string; category: DocumentCategory; uploaded_by: string;
  created_at: string; deleted_at: string | null; contact_id: string | null; client_group_id: string | null;
};
export async function listDocumentVersionTimeline(db: SupabaseClient, accountId: string, who: string | readonly string[], groupId: string | null, page: TimelinePageOpts): Promise<TimelineDocumentVersion[]>;   // request client; 0078's view
```

- [ ] **Step 1: Build the replica with PostgREST.** `replica.sh 55542 <dir>` (expect `post = pre + 0078`), then `pgrst.sh 55542 55543 55544 <dir>`, then the faithfulness digest. Confirm PostgREST is up: `curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:55544/rest/v1/` → `200`.

- [ ] **Step 2: Write the failing tests.** In `packages/db/src/test/documents.test.ts`, extend the import at `:6-11` with `documentSpaceUsed, listDocumentVersionStates, claimDocumentForPurge, deletePurgedDocument, listDocumentVersionTimeline, DOCUMENT_PURGING_MARK` (`createGroupWithMember` is already imported, `:5`), and append:

```ts
/** A second version of `id`, reserved and made ready at BYTES, as the new-version start and finish do. */
async function newVersion(db: SupabaseClient, accountId: string, id: string) {
  const r = await reserveDocumentVersion(db, { accountId, documentId: id, bytes: BYTES, contentType: "application/pdf", originalName: "v.pdf", uploadedBy: ACTOR });
  if (r.status !== "ok") throw new Error(`reserve: ${r.status}`);
  expect(await markDocumentVersionReady(db, { accountId, documentId: id, versionId: r.versionId, bytes: BYTES, sha256: HASH, actorId: ACTOR })).toBe(true);
  return r;
}

describe("versions in the card's read (spec 3.3, 4.1, 4.3)", () => {
  it("every ready version, newest first, the current one first; one still uploading is never listed; the new version emits document.version_added (mutations: drop the ready filter -> FAILS; sort oldest first -> FAILS; emit nothing for a later version -> FAILS)", () =>
    withTestAccount(async (db, accountId) => {
      const ana = (await createContact(db, accountId, { firstName: "Ana" }, ACTOR)).id;
      const d = await readyDoc(db, accountId, ana);
      const v2 = await newVersion(db, accountId, d.id);
      const pending = await reserveDocumentVersion(db, { accountId, documentId: d.id, bytes: BYTES, contentType: "application/pdf", originalName: null, uploadedBy: ACTOR });
      if (pending.status !== "ok") throw new Error(pending.status);
      const [listed] = (await listRecordDocuments(db, accountId, { kind: "contact", id: ana })).live;
      expect(listed!.version.id).toBe(v2.versionId);
      expect(listed!.versions.map((v) => [v.id, v.status])).toEqual([[v2.versionId, "ready"], [d.versionId, "ready"]]);
      // A PR 1a pin, not a 1b probe: a later version never emits a second document.added.
      expect(await events(db, accountId, "document.added")).toHaveLength(1);
      // 1b (owner ruling R2): it emits document.version_added, as the person, with no title or category.
      expect(await events(db, accountId, "document.version_added")).toEqual([
        { actor_type: "user", actor_id: ACTOR, payload: { documentId: d.id, versionId: v2.versionId, contactId: ana } }]);
    }));

  it("a file with one version lists exactly that one (mutation: answer [] when only the current is ready -> FAILS)", () =>
    withTestAccount(async (db, accountId) => {
      const ana = (await createContact(db, accountId, { firstName: "Ana" }, ACTOR)).id;
      const d = await readyDoc(db, accountId, ana);
      const [listed] = (await listRecordDocuments(db, accountId, { kind: "contact", id: ana })).live;
      expect(listed!.versions.map((v) => v.id)).toEqual([d.versionId]);
      expect(listed!.versions[0]!.bytes).toBe(BYTES);
    }));
});

describe("the new-version timeline read (0078's view; owner ruling R2)", () => {
  it("a contact's new versions, never a file's first, newest first; a group page adds the group's own (mutations: read documents instead of the view -> FAILS; drop the group read -> FAILS)", () =>
    withTestAccount(async (db, accountId) => {
      const ana = (await createContact(db, accountId, { firstName: "Ana" }, ACTOR)).id;
      const g = await createGroupWithMember(db, accountId, ana, "household", "Casa", null, ACTOR);
      if (g.status !== "ok") throw new Error(g.status);
      const mine = await readyDoc(db, accountId, ana, { title: "Mine" });
      const v2 = await newVersion(db, accountId, mine.id);
      await readyDoc(db, accountId, ana, { title: "Only one" });
      const theirsId = await createDocument(db, { accountId, record: { kind: "group", id: g.groupId }, title: "Ours", category: "other", expiresOn: null, ownersOnly: false, source: "upload", createdBy: ACTOR });
      const r1 = await reserveDocumentVersion(db, { accountId, documentId: theirsId, bytes: BYTES, contentType: "application/pdf", originalName: null, uploadedBy: ACTOR });
      if (r1.status !== "ok") throw new Error(r1.status);
      await markDocumentVersionReady(db, { accountId, documentId: theirsId, versionId: r1.versionId, bytes: BYTES, sha256: HASH, actorId: ACTOR });
      const ours2 = await newVersion(db, accountId, theirsId);
      const page = { limit: 31 };
      const contactRows = await listDocumentVersionTimeline(db, accountId, ana, null, page);
      expect(contactRows.map((x) => [x.id, x.document_id, x.title, x.uploaded_by])).toEqual([[v2.versionId, mine.id, "Mine", ACTOR]]);
      const groupRows = await listDocumentVersionTimeline(db, accountId, [ana], g.groupId, page);
      expect(groupRows.map((x) => x.id).sort()).toEqual([v2.versionId, ours2.versionId].sort());
    }));
});

describe("the space-used read (0078; spec 4.2 item 4)", () => {
  const fake = (answer: { data: unknown; error: { message: string } | null }) => {
    const calls: unknown[][] = [];
    const client = { rpc: async (...a: unknown[]) => { calls.push(a); return answer; } } as unknown as SupabaseClient;
    return { client, calls };
  };
  it("calls document_space_used with the account and answers its number; a numeric string is read as a number (mutation: rpc another name -> FAILS)", async () => {
    const f = fake({ data: 4_402_341_479, error: null });
    expect(await documentSpaceUsed(f.client, "acc-1")).toBe(4_402_341_479);
    expect(f.calls).toEqual([["document_space_used", { p_account_id: "acc-1" }]]);
    expect(await documentSpaceUsed(fake({ data: "725", error: null }).client, "acc-1")).toBe(725);
  });
  it("a null, a non-integer or an error throws, never reads as zero (mutation: `Number(data ?? 0)` -> FAILS on the null case)", async () => {
    await expect(documentSpaceUsed(fake({ data: null, error: null }).client, "a")).rejects.toThrow(/unexpected answer/);
    await expect(documentSpaceUsed(fake({ data: "x", error: null }).client, "a")).rejects.toThrow(/unexpected answer/);
    await expect(documentSpaceUsed(fake({ data: -1, error: null }).client, "a")).rejects.toThrow(/unexpected answer/);
    await expect(documentSpaceUsed(fake({ data: null, error: { message: "42501" } }).client, "a")).rejects.toThrow(/documentSpaceUsed failed: 42501/);
  });
});

describe("Delete forever's writes (spec 4.4, 5.1; deviations 3 and 4)", () => {
  it("the version states are this document's, every version, its status included (mutation: drop the document filter -> FAILS)", () =>
    withTestAccount(async (db, accountId) => {
      const ana = (await createContact(db, accountId, { firstName: "Ana" }, ACTOR)).id;
      const d = await readyDoc(db, accountId, ana);
      const other = await readyDoc(db, accountId, ana, { title: "Other" });
      const pending = await reserveDocumentVersion(db, { accountId, documentId: d.id, bytes: BYTES, contentType: "application/pdf", originalName: null, uploadedBy: ACTOR });
      if (pending.status !== "ok") throw new Error(pending.status);
      const states = await listDocumentVersionStates(db, accountId, d.id);
      expect(states.map((s) => [s.storage_path, s.status]).sort()).toEqual([[d.path, "ready"], [pending.storagePath, "uploading"]].sort());
      expect(states.map((s) => s.storage_path)).not.toContain(other.path);
    }));

  it("answers EVERY version past PostgREST's 1000-row cap, so the purge's object list is never cut short (review M5 and its re-review; mutation: read only the first page -> FAILS)", () =>
    withTestAccount(async (db, accountId) => {
      const ana = (await createContact(db, accountId, { firstName: "Ana" }, ACTOR)).id;
      const d = await readyDoc(db, accountId, ana);
      // 1001 more, inserted directly (the reserve rpc would take a round trip each): 1002 in all, past
      // max_rows = 1000 (config.toml, the kit, hosted), which caps a single read silently.
      const extra = Array.from({ length: 1001 }, () => {
        const id = crypto.randomUUID();
        return { id, document_id: d.id, account_id: accountId, storage_path: `${accountId}/${d.id}/${id}`, bytes: 1,
          content_type: "application/pdf", uploaded_by: ACTOR, status: "uploading" };
      });
      const { error } = await db.from("document_versions").insert(extra);
      if (error) throw error;
      const states = await listDocumentVersionStates(db, accountId, d.id);
      expect(states).toHaveLength(1002);
      expect(states.map((s) => s.storage_path).sort()).toEqual([d.path, ...extra.map((v) => v.storage_path)].sort());
    }));

  it("the claim re-stamps deleted_at and marks the row only while it still holds the instant the proof read; no Restore, old instant or new, brings it back (mutations: claim without .eq('deleted_at', expected) -> FAILS on the wrong-instant case; claim without changing deleted_at -> FAILS on the new instant equalling the old (and on the delete case's stale call); drop restoreDocument's marker filter -> FAILS on the new-instant restore)", () =>
    withTestAccount(async (db, accountId) => {
      const ana = (await createContact(db, accountId, { firstName: "Ana" }, ACTOR)).id;
      const d = await readyDoc(db, accountId, ana);
      const t = await trashDocument(db, accountId, d.id, ACTOR);
      if (t.status !== "trashed") throw new Error(t.status);
      expect(await claimDocumentForPurge(db, accountId, d.id, "2020-01-01T00:00:00+00:00")).toBeNull();
      expect((await getDocument(db, accountId, d.id))!.deleted_at).toBe(t.deletedAt);
      const claimed = await claimDocumentForPurge(db, accountId, d.id, t.deletedAt);
      expect(claimed).not.toBeNull();
      expect(claimed).not.toBe(t.deletedAt);
      expect(await restoreDocument(db, accountId, d.id, t.deletedAt, ACTOR)).toBe("changed");
      // Review M1 (a): a Restore that read AFTER the claim carries the new instant; the marker refuses it.
      expect(await restoreDocument(db, accountId, d.id, claimed!, ACTOR)).toBe("changed");
      const after = (await getDocument(db, accountId, d.id))!;
      expect([after.deleted_at, after.deleted_by]).toEqual([claimed, DOCUMENT_PURGING_MARK]);
      // A purge that failed part-way is finished by another claim on the row's current instant.
      expect(await claimDocumentForPurge(db, accountId, d.id, claimed!)).not.toBeNull();
    }));

  it("a live document is never claimed (mutation: drop .eq('deleted_at', expectedDeletedAt) in the claim -> FAILS)", () =>
    withTestAccount(async (db, accountId) => {
      const ana = (await createContact(db, accountId, { firstName: "Ana" }, ACTOR)).id;
      const d = await readyDoc(db, accountId, ana);
      const doc = (await getDocument(db, accountId, d.id))!;
      expect(await claimDocumentForPurge(db, accountId, d.id, doc.created_at)).toBeNull();
      expect((await getDocument(db, accountId, d.id))!.deleted_at).toBeNull();
    }));

  it("the delete takes the claimed row and every version, then one document.purged as the person, with no title (mutations: emit as system -> FAILS; a title in the payload -> FAILS; delete without the claimed instant -> FAILS on the stale case)", () =>
    withTestAccount(async (db, accountId) => {
      const ana = (await createContact(db, accountId, { firstName: "Ana" }, ACTOR)).id;
      const d = await readyDoc(db, accountId, ana, { title: "Secret plan" });
      await newVersion(db, accountId, d.id);
      const t = await trashDocument(db, accountId, d.id, ACTOR);
      if (t.status !== "trashed") throw new Error(t.status);
      const claimed = (await claimDocumentForPurge(db, accountId, d.id, t.deletedAt))!;
      const row = (await getDocument(db, accountId, d.id))!;
      expect(await deletePurgedDocument(db, accountId, row, t.deletedAt, "user_owner")).toBe(false);   // stale instant
      expect(await getDocument(db, accountId, d.id)).not.toBeNull();
      expect(await deletePurgedDocument(db, accountId, row, claimed, "user_owner")).toBe(true);
      expect(await getDocument(db, accountId, d.id)).toBeNull();
      const { data: left, error } = await db.from("document_versions").select("id").eq("document_id", d.id);
      if (error) throw error;
      expect(left ?? []).toEqual([]);
      expect(await events(db, accountId, "document.purged")).toEqual([
        { actor_type: "user", actor_id: "user_owner", payload: { documentId: d.id, contactId: ana } }]);
    }));
});
```

Why each can fail (checked while writing): the first case's version list has three entries (the uploading one included) without the ready filter, and is reversed when sorted oldest first; the second case would read `[]` if the current were dropped; the fake cases pin the rpc name and argument and the null rule; the states case returns `other.path` too without the document filter; the 1002-version case (a replica case, Task 3 fix round: PostgREST's max_rows = 1000 caps one read silently, so the first design's `.limit(1001)` and its refusal past 1000 could never fire) answers 500 rows if only the first page is read, and 1000 if the page size is raised past the cap; the claim case's wrong-instant call claims (and so moves `deleted_at`) without the `deleted_at` filter, and a claim that leaves `deleted_at` unchanged answers the old instant (`expect(claimed).not.toBe(t.deletedAt)`) and lets the delete case's stale call delete (the old-instant Restore is refused by the marker either way, so it does not catch this); the live case is claimed if the filter is relaxed; the delete case's stale call deletes without the instant filter, and the event comparison is exact (`toEqual`), so `actor_type: "system"` or a `title` key fails it.

- [ ] **Step 3: Run red.** From `<WT>/packages/db`: `source <dir>/env-run.sh && pnpm exec vitest run src/test/documents.test.ts > <dir>/red.log 2>&1; echo $? > <dir>/red.exit`. Expected: exit 1; the new cases fail on missing exports (`documentSpaceUsed is not a function`, and so on) and `versions` being `undefined`; the existing cases still pass. Paste the summary block.

- [ ] **Step 4: Write the code** in `packages/db/src/documents.ts`.

Replace line 26:

```ts
/** `versions`: every READY version, newest first (created_at, then id, descending); always includes `version`. */
export type ListedDocument = DocumentRow & { version: DocumentVersionRow; versions: DocumentVersionRow[] };
```

Replace `listRecordDocuments` (`:54-73`) with:

```ts
/** Newest first by upload time, then id; the current version is always among them (spec 4.3's Versions list). */
function readyVersionsOf(current: DocumentVersionRow, all: readonly DocumentVersionRow[]): DocumentVersionRow[] {
  const ready = all.filter((v) => v.status === "ready").map(asVersion)
    .sort((a, b) => (a.created_at === b.created_at ? (a.id < b.id ? 1 : -1) : a.created_at < b.created_at ? 1 : -1));
  return ready.some((v) => v.id === current.id) ? ready : [asVersion(current), ...ready];
}

/** The card's read: live documents newest first, trashed ones by when they were trashed. Listed only once a version is ready. */
export async function listRecordDocuments(db: SupabaseClient, accountId: string, record: DocumentRecordRef): Promise<RecordDocuments> {
  const read = async (trashed: boolean) => {
    // One chain, the trash filter as an operator (`not.is` / `is`): a ternary over two builders, or a
    // reassigned `let q`, is too deep for tsc to check (TS2589). Two embeds of document_versions, each
    // named by its constraint (plan Assumption B1): the current version, and every version (the
    // one-to-many key), filtered to ready ones here so an upload in flight never shows.
    const { data, error } = await db.from("documents")
      .select(`${DOC_COLS}, version:document_versions!documents_current_version_fkey(${VERSION_COLS}), versions:document_versions!document_versions_document_fkey(${VERSION_COLS})`)
      .eq("account_id", accountId).eq(recordColumn(record), record.id).not("current_version_id", "is", null)
      .filter("deleted_at", trashed ? "not.is" : "is", null)
      .order(trashed ? "deleted_at" : "created_at", { ascending: false })
      .order("id", { ascending: false }).limit(MAX_DOCUMENTS_READ + 1);
    if (error) throw new Error(`listRecordDocuments failed: ${error.message}`);
    return ((data ?? []) as unknown as (DocumentRow & { version: DocumentVersionRow | null; versions: DocumentVersionRow[] | null })[])
      .flatMap((r) => (r.version ? [{ ...r, version: asVersion(r.version), versions: readyVersionsOf(r.version, r.versions ?? []) }] : []));
  };
  const [live, trashed] = await Promise.all([read(false), read(true)]);
  return {
    live: live.slice(0, MAX_DOCUMENTS_READ), trashed: trashed.slice(0, MAX_DOCUMENTS_READ),
    liveMore: live.length > MAX_DOCUMENTS_READ, trashedMore: trashed.length > MAX_DOCUMENTS_READ,
  };
}
```

After `restoreDocument` (after line 233), add:

```ts
/**
 * The space-used line (spec 4.2 item 4; 0078): the ACCOUNT's bytes, every version ready or uploading,
 * trashed documents included, which is exactly what reserve_document_version holds against the quota.
 * Any member's REQUEST client (0078 is SECURITY DEFINER and refuses a caller outside the account).
 * A bigint may arrive as a number or a numeric string (plan Assumption B2). THROWS on an error and on
 * anything that is not a non-negative safe integer: a null is a failure, never zero.
 */
export async function documentSpaceUsed(db: SupabaseClient, accountId: string): Promise<number> {
  const { data, error } = await db.rpc("document_space_used", { p_account_id: accountId });
  if (error) throw new Error(`documentSpaceUsed failed: ${error.message}`);
  const n = typeof data === "number" ? data : typeof data === "string" && /^\d+$/.test(data) ? Number(data) : Number.NaN;
  if (!Number.isSafeInteger(n) || n < 0) throw new Error(`documentSpaceUsed: unexpected answer ${JSON.stringify(data)}`);
  return n;
}

export type DocumentVersionState = { storage_path: string; status: "uploading" | "ready" };

const VERSION_STATES_PAGE = 500;

/**
 * Service client, AFTER the request-client proof: EVERY version of ONE document, for Delete forever's
 * object list and its in-flight check. Paged (review M5's re-review): PostgREST caps one read at
 * max_rows (1000) silently, so a `.limit(1001)` never sees a 1001st row and a purge would delete rows
 * whose objects it never removed. Pages of 500 on the primary key, a stable total order, until a short
 * page (purgeContactDocuments' shape); 500 sits under the cap, so a full page is never mistaken for the last.
 */
export async function listDocumentVersionStates(db: SupabaseClient, accountId: string, documentId: string): Promise<DocumentVersionState[]> {
  const rows: DocumentVersionState[] = [];
  for (let from = 0; ; from += VERSION_STATES_PAGE) {
    const { data, error } = await db.from("document_versions").select("storage_path, status")
      .eq("account_id", accountId).eq("document_id", documentId)
      .order("id").range(from, from + VERSION_STATES_PAGE - 1);
    if (error) throw new Error(`listDocumentVersionStates failed: ${error.message}`);
    const page = (data ?? []) as DocumentVersionState[];
    rows.push(...page);
    if (page.length < VERSION_STATES_PAGE) return rows;
  }
}

/** `deleted_by` of a row Delete forever has claimed (plan deviation 4): restoreDocument never restores it. */
export const DOCUMENT_PURGING_MARK = "documents:purging";

/**
 * Service client: Delete forever's claim (plan deviation 4). Re-stamps deleted_at and marks deleted_by
 * with DOCUMENT_PURGING_MARK ONLY while deleted_at still equals the instant the caller's proof read, so a Restore or a trash toast's Undo carrying that old
 * instant (restoreDocument compares it) changes nothing while the objects are being removed. The new
 * instant is at least a millisecond later than the old one, so the two can never be equal. Answers the
 * stored new instant exactly as PostgREST returned it, or null when the file is no longer that trashed file.
 */
export async function claimDocumentForPurge(
  db: SupabaseClient, accountId: string, documentId: string, expectedDeletedAt: string,
): Promise<string | null> {
  const prior = Date.parse(expectedDeletedAt);
  const stamp = new Date(Math.max(Date.now(), Number.isNaN(prior) ? 0 : prior + 1)).toISOString();
  const { data, error } = await db.from("documents")
    .update({ deleted_at: stamp, deleted_by: DOCUMENT_PURGING_MARK, updated_at: stamp })
    .eq("account_id", accountId).eq("id", documentId).eq("deleted_at", expectedDeletedAt)
    .select("deleted_at");
  if (error) throw new Error(`claimDocumentForPurge failed: ${error.message}`);
  const row = (data ?? [])[0] as { deleted_at: string } | undefined;
  return row ? row.deleted_at : null;
}

/**
 * Service client, AFTER every object of the document is gone: the claimed row (its versions cascade),
 * then document.purged with actor `user` (spec 3.6: a person's purge). False when the row is no longer
 * the claimed one; nothing is emitted then. The payload carries the document and its record only.
 */
export async function deletePurgedDocument(
  db: SupabaseClient, accountId: string, doc: { id: string; contact_id: string | null; client_group_id: string | null },
  claimedAt: string, actorId: string,
): Promise<boolean> {
  // The actor is the event's (deleted_by holds the marker since the claim).
  const { data, error } = await db.from("documents").delete()
    .eq("account_id", accountId).eq("id", doc.id).eq("deleted_at", claimedAt).select("id");
  if (error) throw new Error(`deletePurgedDocument failed: ${error.message}`);
  if ((data ?? []).length === 0) return false;
  await emitAfter(db, accountId, "document.purged", actorId, { documentId: doc.id, ...recordPayload(doc) });
  return true;
}
```

Change `restoreDocument` (`:220-233`): after `.eq("deleted_at", expectedDeletedAt)` add `.neq("deleted_by", DOCUMENT_PURGING_MARK)`, and add to its comment: "Never a row Delete forever has claimed (plan deviation 4): its objects may already be gone." (`deleted_by` is never null on a trashed row, `documents_trash_coherent`, so `neq` cannot drop a legitimate restore through SQL's null logic.)

Change `markDocumentVersionReady` (`:144-153`): replace `if (r.first) { … }` with

```ts
  // Best-effort, read included: the version IS ready and current, so a failed read for the event's
  // record ids is logged, never answered as a failed upload. The first version is document.added; a
  // later one is document.version_added (owner ruling R2). No title, no category (PR 1a deviation 3).
  try {
    const doc = await getDocument(db, a.accountId, a.documentId);
    if (doc) {
      await emit(db, a.accountId, r.first ? "document.added" : "document.version_added", a.actorId,
        r.first ? { documentId: doc.id, ...recordPayload(doc) } : { documentId: doc.id, versionId: a.versionId, ...recordPayload(doc) });
    }
  } catch (e) {
    console.error(`documents: account ${a.accountId}: ${r.first ? "document.added" : "document.version_added"} emit failed after the write committed: ${(e as Error).message}`);
  }
```

After `listDocumentTimeline` (after `:388`), add:

```ts
export type TimelineDocumentVersion = {
  id: string; document_id: string; title: string; category: DocumentCategory; uploaded_by: string;
  created_at: string; deleted_at: string | null; contact_id: string | null; client_group_id: string | null;
};
const VERSION_TIMELINE_COLS = "id, document_id, title, category, uploaded_by, created_at, deleted_at, contact_id, client_group_id";

/**
 * The timeline's new-version rows (owner ruling R2; plan deviation 6): 0078's view, one row per ready
 * version after a document's first, on the caller's REQUEST client (security_invoker: RLS decides).
 * Paged exactly as listDocumentTimeline, on the version's created_at and its own id. A group page
 * also reads the group's own files; record.ts merges, sorts and slices every source together.
 */
export async function listDocumentVersionTimeline(
  db: SupabaseClient, accountId: string, who: string | readonly string[], groupId: string | null, page: TimelinePageOpts,
): Promise<TimelineDocumentVersion[]> {
  const base = () => db.from("document_version_timeline").select(VERSION_TIMELINE_COLS).eq("account_id", accountId);
  const reads = [withTimelinePage(forContacts(base(), "contact_id", who), "created_at", page)];
  if (groupId) reads.push(withTimelinePage(base().eq("client_group_id", groupId), "created_at", page));
  const results = await Promise.all(reads);
  const out: TimelineDocumentVersion[] = [];
  for (const { data, error } of results) {
    if (error) throw new Error(`listDocumentVersionTimeline failed: ${error.message}`);
    out.push(...((data ?? []) as TimelineDocumentVersion[]));
  }
  return out;
}
```

In `packages/db/src/index.ts`, the documents block (`:270-277`): add `documentSpaceUsed, listDocumentVersionStates, claimDocumentForPurge, deletePurgedDocument, listDocumentVersionTimeline, DOCUMENT_PURGING_MARK` to the value list and `type DocumentVersionState, type TimelineDocumentVersion` to the type list.

**If Assumption B1 fails** (PostgREST refuses two embeds of one table, or `versions` comes back `null` for every row): keep the single `version` embed and add, after the two reads, one request-client read `db.from("document_versions").select(VERSION_COLS).eq("account_id", accountId).in("document_id", ids)` per 100 document ids, grouped by `document_id` into `readyVersionsOf`. Say so in the report and in the PR body.

- [ ] **Step 5: Run green.** The Step 3 command with `green.log`/`green.exit`. Expected: exit 0; every case in the file passes. Also `pnpm --filter @bis/db typecheck` → clean, and from `<WT>`: `pnpm --filter web typecheck` → the only errors, if any, are in the two routes' `documentView` (Task 5 adds `versions` to the view; `ListedDocument` gaining a field breaks nothing else). Paste both.

- [ ] **Step 6: Mutation probes, red BY NAME, restored.** (1) drop `.filter((v) => v.status === "ready")`; (2) sort ascending; (3) replace `readyVersionsOf`'s return with `return ready.length > 1 ? ready : [];` → the one-version case fails; (4) `Number(data ?? 0)` path: replace the parse with `const n = Number(data ?? 0);` → the null case fails; (5) drop `.eq("document_id", documentId)`; (6) drop `.eq("deleted_at", expectedDeletedAt)` in the claim; (7) claim with `update({ deleted_by: DOCUMENT_PURGING_MARK, updated_at: stamp })` (no new `deleted_at`) → the claim case fails on `expect(claimed).not.toBe(t.deletedAt)` and the delete case on its stale call (not on the old-instant Restore, which the marker refuses anyway); (8) `actorType "system"` in `deletePurgedDocument`'s emit (pass `"system"` as the sixth argument of `emitAfter`); (9) drop `.eq("deleted_at", claimedAt)` in the delete → the stale case fails; (10) drop `.neq("deleted_by", DOCUMENT_PURGING_MARK)` in `restoreDocument` → the claim case's new-instant restore fails; (11) emit nothing when `first` is false → the versions case fails on `document.version_added`; (12) read only the first page (`return rows;` in place of the short-page test) → the 1002-version case fails, and a page size of 1001 → it fails at 1000 (the cap); (13) `db.from("documents")` in `listDocumentVersionTimeline` (with the documents columns) → the timeline case fails; (14) drop the group read → its group expectation fails. Use `<SCRATCH>/s07-t3-impl/mutate.cjs`'s find/replace approach or edit by hand and edit back; paste each failing line.

- [ ] **Step 7: Commit.** `git commit -m "feat(db): the card reads every ready version; the space read; Delete forever's claim, marker, list and delete; document.version_added and the version timeline read (S-07 part 1b)" -- packages/db/src/documents.ts packages/db/src/index.ts packages/db/src/test/documents.test.ts`

---

## Task 3b: The timeline's new-version rows (bis-crm; owner ruling R2)

**Review:** opus. **After:** Tasks 1, 2 and 3. **Runs beside:** Tasks 4 and 5. **Replica:** the Task 3 recipe on spare ports `55551`/`55552`/`55553` (reviewer `55554`/`55555`/`55556`) for `record.test.ts`; never against bis-ci.

**Files**
- Modify: `packages/db/src/record.ts` (import `:14`; `TimelineEntry` `:286-296`; the documents `settle` `:367-368`) and `packages/db/src/test/record.test.ts` (the documents describe `:542-560`)
- Modify: `apps/web/src/lib/record/author-mark.ts` (`authorOf`, after `:50`), `timeline-rows.ts` (`phrase`, after `:98`), `recent-rows.ts` (`excerptOf`, after `:46`), and their tests
- Modify: `…/contacts/[contactId]/activity-timeline.tsx` (after `:184`) and `activity-timeline.rows.test.ts`; `…/groups/[groupId]/group-timeline.tsx` (after `:128`) and `group-timeline.test.ts`
- Modify: `…/contacts/contact-drawer.tsx:64-67` (`ROW_ICON`); `apps/web/src/lib/contacts/drawer-summary.ts:52-54` (`ROW_KINDS`) and `drawer-summary.test.ts`
- Modify: `…/api/contacts/[contactId]/summary/route.reads.test.ts:51-55` (`MEASURED` and its comment)

**Interfaces**
- Consumes (Task 3): `listDocumentVersionTimeline(db, accountId, who, groupId, page)`, `type TimelineDocumentVersion`; (Task 2): `timeline.documentVersion`.
- Produces: a new `TimelineEntry` variant, inside the EXISTING `documents` source (`TIMELINE_SOURCES` unchanged):

```ts
  /** S-07 1b (owner ruling R2): one row per NEW version of a file, read from 0078's view so RLS decides. `id` is the version's. */
  | { kind: "documentVersion"; id: string; at: string; contactId: string; version: TimelineDocumentVersion };
```

- [ ] **Step 1: Write the failing tests.**

`packages/db/src/test/record.test.ts` (no new import: `createDocument`, `reserveDocumentVersion`, `markDocumentVersionReady` are imported at `:14`, `listTimelinePage` already used at `:555`). Append inside the documents describe (before its closing `});` at `:560`):

```ts
  it("a new version is its own row, under the same documents source, and the timeline pages through it on one cursor (owner ruling R2; mutations: drop the version read from the documents settle -> FAILS; read versions without the page cursor -> FAILS on page 2)", () =>
    withTestAccount(async (db, accountId) => {
      const ana = (await createContact(db, accountId, { firstName: "Ana" }, "user_t")).id;
      const id = await createDocument(db, { accountId, record: { kind: "contact", id: ana }, title: "Plan", category: "other", expiresOn: null, ownersOnly: false, source: "upload", createdBy: "user_t" });
      const ready = async () => {
        const r = await reserveDocumentVersion(db, { accountId, documentId: id, bytes: 5, contentType: "application/pdf", originalName: null, uploadedBy: "user_up" });
        if (r.status !== "ok") throw new Error(r.status);
        if (!(await markDocumentVersionReady(db, { accountId, documentId: id, versionId: r.versionId, bytes: 5, sha256: "c".repeat(64), actorId: "user_up" }))) throw new Error("not ready");
        return r.versionId;
      };
      await ready();
      const v2 = await ready();
      const v3 = await ready();
      const all = await listTimelinePage(db, accountId, [ana]);
      expect(all.failed).toEqual([]);
      expect(all.items.filter((i) => i.kind === "document" || i.kind === "documentVersion").map((i) => [i.kind, i.id]))
        .toEqual([["documentVersion", v3], ["documentVersion", v2], ["document", id]]);
      const v = all.items.find((i) => i.kind === "documentVersion")!;
      expect(v.kind === "documentVersion" && [v.version.title, v.version.uploaded_by, v.contactId]).toEqual(["Plan", "user_up", ana]);
      // One row per page: the version rows page on the same (at, id) cursor as every other row.
      const p1 = await listTimelinePage(db, accountId, [ana], undefined, { limit: 1 });
      const p2 = await listTimelinePage(db, accountId, [ana], p1.older!, { limit: 1 });
      const p3 = await listTimelinePage(db, accountId, [ana], p2.older!, { limit: 1 });
      expect([p1, p2, p3].map((p) => p.items.map((i) => i.id))).toEqual([[v3], [v2], [id]]);
    }));
```

(Other sources are empty for this contact, so the three rows are the whole timeline; `createContact` writes no timeline row of its own. If the replica shows otherwise, filter `p.items` to the two kinds before comparing and say so in the report.)

`apps/web/src/lib/record/author-mark.test.ts`: append

```ts
describe("a new version's author (owner ruling R2)", () => {
  const ver: TimelineEntry = { kind: "documentVersion", id: "v2", at: AT, contactId: "c1", version: {
    id: "v2", document_id: "d1", title: "Signed lease", category: "contract", uploaded_by: "user_bea", created_at: AT,
    deleted_at: null, contact_id: "c1", client_group_id: null } };
  it("is the person who uploaded it, and the names read asks for them (mutation: the document's creator, or unnamed() -> FAILS)", () => {
    expect(authorOf(ver)).toEqual({ kind: "person", personId: "user_bea" });
    expect(personIdsOf([ver])).toEqual(["user_bea"]);
  });
});
```

`apps/web/src/lib/record/timeline-rows.test.ts`: append

```ts
describe("a new version's row (owner ruling R2)", () => {
  const ver = (over: Partial<TimelineDocumentVersion> = {}): TimelineEntry => ({
    kind: "documentVersion", id: "v2", at: "2026-10-14T15:00:00.000Z", contactId: "c1",
    version: { id: "v2", document_id: "d1", title: "Signed lease", category: "contract", uploaded_by: "user_ana",
      created_at: "2026-10-14T15:00:00.000Z", deleted_at: null, contact_id: "c1", client_group_id: null, ...over },
  });
  const author = (tr: Tr) => ({ viewerId: "user_me", names: { user_ana: "Ana" }, personaName: null, tr });
  it("reads '<who> uploaded a new version of <title>', the category as detail, the person mark (mutation: reuse timeline.document -> FAILS)", () => {
    const tr = makeTr("en");
    const [row] = timelineRows([ver()], { zone: "America/Chicago", tr, author: author(tr) });
    expect([row!.verb, row!.detail, row!.mark, row!.status, row!.key]).toEqual(
      ["uploaded a new version of Signed lease", "Contract", { kind: "person", label: "Ana" }, null, "documentVersion-v2"]);
  });
  it("in Spanish, and a trashed file's version carries 'In the trash' as a dot and a word (mutation: drop the trashed status -> FAILS)", () => {
    const tr = makeTr("es");
    const [row] = timelineRows([ver({ deleted_at: "2026-10-15T00:00:00.000Z" })], { zone: "America/Chicago", tr, author: author(tr) });
    expect(row!.verb).toBe(m["timeline.documentVersion.es"].replace("{title}", "Signed lease"));
    expect(row!.status).toEqual({ tone: "muted", word: m["documents.status.trashed.es"] });
  });
});
```

(import `TimelineDocumentVersion` from `@bis/db` beside `TimelineDocument`.)

`apps/web/src/lib/record/recent-rows.test.ts`: append

```ts
describe("a new version in the drawer's Recent (owner ruling R2)", () => {
  it("is its head only, its own kind, never an excerpt (mutation: map it to kind 'document' -> FAILS)", () => {
    const ver: TimelineEntry = { kind: "documentVersion", id: "v2", at: AT, contactId: "c1", version: {
      id: "v2", document_id: "d1", title: "Signed lease", category: "contract", uploaded_by: "user_ana", created_at: AT,
      deleted_at: null, contact_id: "c1", client_group_id: null } };
    const [d] = view([ver]);
    expect([d!.kind, d!.verb, d!.excerpt]).toEqual(["documentVersion", "uploaded a new version of Signed lease", null]);
  });
});
```

`apps/web/src/lib/contacts/drawer-summary.test.ts`: after the document case (`:88-97`), add

```ts
  it("a new-version row (S-07 1b) parses and is kept, never dropped as an unknown kind (mutation: drop documentVersion from ROW_KINDS -> FAILS)", () => {
    const body = clone();
    const ver = { key: "documentVersion-v2", kind: "documentVersion", mark: { kind: "person", label: "Ana" }, verb: "uploaded a new version of Signed lease",
      status: null, detail: "Contract", time: "Oct 9, 2026, 11:12 AM", dateTime: "2026-10-09T16:12:00Z", excerpt: null };
    (body.recent as { rows: unknown[] }).rows = [ver];
    expect(parseDrawerSummary(body)!.recent).toEqual({
      status: "ready", rows: [ver], failedText: null, emptyText: null, seeAllHref: "/dashboard/accounts/a1/contacts/c1#record-timeline",
    });
  });
```

`activity-timeline.rows.test.ts` (after its document case, `:186-197`) and `group-timeline.test.ts` (after `:135-142`): one case each, the document case's shape with the entry `{ kind: "documentVersion", id: "v2", at: AT, contactId: "c1" /* "" on the group test, a group's own file */, version: { id: "v2", document_id: "d1", title: "Signed lease", category: "contract", uploaded_by: "user_me", created_at: AT, deleted_at: null, contact_id: "c1" /* null on the group test */, client_group_id: null /* "g1" on the group test */ } }`, Spanish `tr`, asserting the row `html.match(/<div data-timeline-item="documentVersion"[\s\S]*?<\/li>/)` (contact) / `rowHtml(render({ rows, tr }, "es"), "documentVersion")` (group) contains `>${m["timeline.documentVersion.es"].replace("{title}", "Signed lease")}<` and the person mark `>${m["provenance.you.es"]}<` (contact) / no `data-timeline-subject` (group). Mutation for both: `return null` for the `documentVersion` case → FAILS (the match is empty).

`summary/route.reads.test.ts`, lines 51-55: replace the comment and constant with

```ts
// Raised 22 -> 23 on 2026-10-13 by S-07 part 1 (the document vault): the drawer's five newest
// timeline rows include file rows like any timeline row, so the timeline reads `documents`
// (one bounded read, under RLS, which decides whether an Owners-only file shows). Still no
// Documents card in the drawer; that lives on the full record only.
// Raised 23 -> 24 on 2026-10-14 by S-07 part 1b (owner ruling R2): a new version of a file is its
// own timeline row, read from 0078's view document_version_timeline (security_invoker, so the same
// RLS decides), inside the same documents source.
const MEASURED = 24; // measured 2026-10-14: 24 reads (+1 prefs), the 24th is request:document_version_timeline; 23 before S-07 1b, 22 before S-07
```

Why each can fail (checked while writing): the record case's kinds list loses its two version rows without the read, and page 2 returns `v3` again if the version read ignores `before`; the author case names the document's creator only if the code reads the wrong field (the fixture has none, so it must be `uploaded_by`); the row cases compare exact verbs against the English literal and the Spanish catalogue string filled by hand; the Recent case pins the kind; the drawer case is dropped without `ROW_KINDS`; the two render cases are empty without their `case`; `MEASURED` at 23 fails the fence once the 24th read exists (probe below).

- [ ] **Step 2: Run red.** Web: `pnpm --filter web exec vitest run src/lib/record/author-mark.test.ts src/lib/record/timeline-rows.test.ts src/lib/record/recent-rows.test.ts src/lib/contacts/drawer-summary.test.ts "src/app/(dashboard)/dashboard/accounts/[accountId]/contacts/[contactId]/activity-timeline.rows.test.ts" "src/app/(dashboard)/dashboard/accounts/[accountId]/groups/[groupId]/group-timeline.test.ts" "src/app/api/accounts/[accountId]/contacts/[contactId]/summary/route.reads.test.ts"` → the new cases fail (the reads fence passes at 24 before the read exists: it is `<=`; its probe is Step 5's). The db case on your replica (`source <dir>/env-run.sh`, from `<WT>/packages/db`: `pnpm exec vitest run src/test/record.test.ts`) → the new case fails. Paste both summaries.

- [ ] **Step 3: Write the code.**

`packages/db/src/record.ts`: import `listDocumentVersionTimeline, type TimelineDocumentVersion` beside `listDocumentTimeline` (`:14`); add the variant from Interfaces to `TimelineEntry` after the `document` one (`:296`); replace the documents `settle` (`:367-368`) with

```ts
    // S-07: one source, two kinds. A file's "added" row (from documents) and each NEW version's row
    // (owner ruling R2, from 0078's view), both under the caller's RLS, both paged on (at, id); a failed
    // read of either is the one "documents" failure.
    settle("documents", async () => {
      const [docs, versions] = await Promise.all([
        listDocumentTimeline(db, accountId, who, opts.groupId ?? null, page),
        listDocumentVersionTimeline(db, accountId, who, opts.groupId ?? null, page),
      ]);
      return [
        ...docs.map((d): TimelineEntry => ({ kind: "document", id: d.id, at: d.created_at, contactId: d.contact_id ?? "", document: d })),
        ...versions.map((v): TimelineEntry => ({ kind: "documentVersion", id: v.id, at: v.created_at, contactId: v.contact_id ?? "", version: v })),
      ];
    }),
```

`packages/db/src/index.ts` needs no edit for the type: Task 3 exported `TimelineDocumentVersion` from the documents block.

`apps/web/src/lib/record/author-mark.ts`, after `:50`:

```ts
    // S-07 1b: the person who uploaded the new version (document_versions.uploaded_by is NOT NULL).
    case "documentVersion": return { kind: "person", personId: entry.version.uploaded_by };
```

`apps/web/src/lib/record/timeline-rows.ts`, after the `document` case (`:94-98`):

```ts
    // S-07 1b (owner ruling R2): a new version, the same trash status and category detail as its file.
    case "documentVersion": return {
      verb: tr.text("timeline.documentVersion", { title: entry.version.title }),
      status: entry.version.deleted_at ? { tone: "muted", word: tr.text("documents.status.trashed") } : null,
      detail: tr.text(`documents.category.${entry.version.category}`),
    };
```

`apps/web/src/lib/record/recent-rows.ts`, after `:46`: `    case "documentVersion": return null;`

Both timelines, after their `document` case: 

```tsx
    // S-07 1b: a new version of a file wears the file's paperclip.
    case "documentVersion":
      return <TimelineItem {...head} icon={Paperclip} />;
```

`contact-drawer.tsx:64-67`: add `documentVersion: Paperclip,` to `ROW_ICON`. `drawer-summary.ts:52-54`: add `documentVersion: true,` to `ROW_KINDS`. (Both are `Record<RecentRowView["kind"], …>`: `tsc` refuses either without the new kind, and a missing `ROW_KINDS` entry at runtime would drop the row silently, which the drawer test now pins.)

- [ ] **Step 4: Run green.** Step 2's commands → all pass; `pnpm --filter web typecheck` → clean in these files; `pnpm --filter @bis/db typecheck`; eslint on every touched file. Also, unchanged and green: `src/test/timeline-merge.test.ts` and `src/test/record.test.ts`'s `TIMELINE_SOURCES` case on the replica; `"src/app/(dashboard)/dashboard/accounts/[accountId]/contacts/[contactId]/page.test.ts"`, `"src/app/(dashboard)/dashboard/accounts/[accountId]/groups/[groupId]/page.test.ts"`, `src/lib/record/group-loaders.test.ts`, `src/lib/record/loaders.test.ts`, `"src/app/api/accounts/[accountId]/contacts/[contactId]/summary/route.test.ts"` (their `TIMELINE_SOURCES` mocks are untouched).

- [ ] **Step 5: Probes, red BY NAME, restored.** (1) drop `listDocumentVersionTimeline` from the settle → the record case fails; (2) in Task 3's `listDocumentVersionTimeline`, read without `withTimelinePage` (`base()` then `.limit(page.limit)` only, edit back after) → page 2 fails; (3) `authorOf` → `entry.version.document_id` as the person → fails; (4) `timeline.document` for the verb → fails; (5) `ROW_KINDS` without `documentVersion` (vitest does not typecheck) → the drawer case fails; (6) `return null` in each timeline's case → each render case fails; (7) `MEASURED = 23` → the reads fence fails, naming 24 reads.

- [ ] **Step 6: Commit.** `git commit -m "feat(timeline): a new version of a file is its own row, under the documents source, with the uploader's mark (S-07 part 1b, owner ruling R2)" -- packages/db/src/record.ts packages/db/src/test/record.test.ts apps/web/src/lib/record/author-mark.ts apps/web/src/lib/record/author-mark.test.ts apps/web/src/lib/record/timeline-rows.ts apps/web/src/lib/record/timeline-rows.test.ts apps/web/src/lib/record/recent-rows.ts apps/web/src/lib/record/recent-rows.test.ts "apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/contacts/[contactId]/activity-timeline.tsx" "apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/contacts/[contactId]/activity-timeline.rows.test.ts" "apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/groups/[groupId]/group-timeline.tsx" "apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/groups/[groupId]/group-timeline.test.ts" "apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/contacts/contact-drawer.tsx" apps/web/src/lib/contacts/drawer-summary.ts apps/web/src/lib/contacts/drawer-summary.test.ts "apps/web/src/app/api/accounts/[accountId]/contacts/[contactId]/summary/route.reads.test.ts"`

---

## Task 4: The server actions (bis-crm)

**Review:** opus. **After:** Tasks 2 and 3.

**Files**
- Modify: `…/contacts/documents-actions.ts` (imports `:6-11`; `finishDocumentUploadAction` `:152-210`; `getDocumentUrlAction` `:239-241`; two new exports after `startDocumentUploadAction` `:132` and at the end)
- Modify: `…/contacts/documents-actions.test.ts` (the `db` mock `:13-18`; three expectations `:193`, `:220`, `:225`; new describes; the two shared `it.each` tables `:280-327`)

**Interfaces**
- Consumes (Task 3): `listDocumentVersionStates`, `claimDocumentForPurge`, `deletePurgedDocument` from `@bis/db`; existing `getDocument`, `reserveDocumentVersion`, `discardDocumentUpload`, `getUploadingVersion`, `markDocumentVersionReady`.
- Produces (Tasks 6 and 8 call these):

```ts
export type StartVersionInput = { name: string; size: number; contentType: string };
export async function startDocumentVersionUploadAction(accountId: string, documentId: string, input: StartVersionInput):
  Promise<{ ok: true; documentId: string; versionId: string; uploadUrl: string } | DocFail>;
export async function purgeDocumentAction(accountId: string, documentId: string, typedTitle: string): Promise<{ ok: true } | DocFail>;
// finishDocumentUploadAction: unchanged signature; a document in the trash now answers "documents.error.trashed" after removing the object and the reservation.
// getDocumentUrlAction: unchanged signature; "documents.error.fileNotFound" where it answered "documents.error.notFound".
```

Error keys answered (all from Task 2): start a version — `documents.error.refused` (malformed, not visible, never listed), `documents.error.trashed`, `documents.error.tooLarge` (`{ size }`), `documents.error.badType`, `documents.error.quota`, `documents.error.upload`; purge — `documents.error.purgeRole` (not an Owner or the agency, before anything else), `documents.error.refused` (malformed, not visible, not in the trash), `documents.purge.mismatch`, `documents.error.purgeUploading`, `documents.error.purgeChanged`, `documents.error.purge`.

- [ ] **Step 1: Write the failing tests.** In `documents-actions.test.ts`:

(a) Add to the `db` mock object (`:13-18`): `listDocumentVersionStates: vi.fn(), claimDocumentForPurge: vi.fn(), deletePurgedDocument: vi.fn(),`.

(b) Change the three file answers to the file's own key: `:193`, `:220` and `:225` → `{ ok: false, error: "documents.error.fileNotFound" }`. Leave `:72` (`startDocumentUploadAction`'s record answer) as `documents.error.notFound`.

(c) Append these describes (after the `getDocumentUrlAction` describe, before the shared tables):

```ts
const LISTED = { ...DOC, current_version_id: "55555555-5555-4555-8555-555555555555" };
const TRASHED = { ...LISTED, deleted_at: "2026-10-13T15:00:00.123456+00:00", deleted_by: "user_owner" };
const vInput = (over: Partial<Parameters<typeof A.startDocumentVersionUploadAction>[2]> = {}) =>
  ({ name: "Lease v2.pdf", size: 1300, contentType: "application/pdf", ...over });

describe("startDocumentVersionUploadAction (spec 3.3, 4.1: Upload new version)", () => {
  beforeEach(() => { db.getDocument.mockResolvedValue(LISTED); });
  it("proves the document on the REQUEST client, then reserves a version of THAT document on the service client, and answers the signed URL (mutation: skip getDocument -> FAILS)", async () => {
    expect(await A.startDocumentVersionUploadAction(ACC, D.toUpperCase(), vInput()))
      .toEqual({ ok: true, documentId: D, versionId: V, uploadUrl: "https://x/upload?token=t" });
    expect(db.getDocument).toHaveBeenCalledWith(REQUEST, ACC, D);
    expect(db.getDocument.mock.invocationCallOrder[0]!).toBeLessThan(db.reserveDocumentVersion.mock.invocationCallOrder[0]!);
    expect(db.reserveDocumentVersion).toHaveBeenCalledWith(SERVICE, {
      accountId: ACC, documentId: D, bytes: 1300, contentType: "application/pdf", originalName: "Lease v2.pdf", uploadedBy: "user_owner" });
    expect(db.createDocument).not.toHaveBeenCalled();
    expect(storage.createSignedUploadUrl).toHaveBeenCalledWith(`${ACC}/${D}/${V}`);
  });
  it("a file the caller cannot see, or one never listed, is refused and nothing is reserved (mutations: treat null as visible; drop the current-version check -> FAILS)", async () => {
    db.getDocument.mockResolvedValueOnce(null);
    expect(await A.startDocumentVersionUploadAction(ACC, D, vInput())).toEqual({ ok: false, error: "documents.error.refused" });
    db.getDocument.mockResolvedValueOnce(DOC);   // current_version_id null: its first upload is still in flight
    expect(await A.startDocumentVersionUploadAction(ACC, D, vInput())).toEqual({ ok: false, error: "documents.error.refused" });
    expect(db.reserveDocumentVersion).not.toHaveBeenCalled();
  });
  it("a file in the trash gets no new version (plan deviation 2; mutation: drop the trash check -> FAILS)", async () => {
    db.getDocument.mockResolvedValue(TRASHED);
    expect(await A.startDocumentVersionUploadAction(ACC, D, vInput())).toEqual({ ok: false, error: "documents.error.trashed" });
    expect(db.reserveDocumentVersion).not.toHaveBeenCalled();
  });
  it("too large and a disallowed type are refused before any read (mutation: read first -> FAILS on the call count)", async () => {
    expect(await A.startDocumentVersionUploadAction(ACC, D, vInput({ size: 26_214_401 })))
      .toEqual({ ok: false, error: "documents.error.tooLarge", params: { size: "25.1 MB" } });
    expect(await A.startDocumentVersionUploadAction(ACC, D, vInput({ name: "x.exe" }))).toEqual({ ok: false, error: "documents.error.badType" });
    expect(await A.startDocumentVersionUploadAction(ACC, D, vInput({ contentType: "image/svg+xml" }))).toEqual({ ok: false, error: "documents.error.badType" });
    expect(db.getDocument).not.toHaveBeenCalled();
  });
  it("quota full answers the quota sentence and never discards anything: the file and its versions stay (mutation: discard(…, null) on a refusal -> FAILS)", async () => {
    db.reserveDocumentVersion.mockResolvedValue({ status: "over_quota" });
    expect(await A.startDocumentVersionUploadAction(ACC, D, vInput())).toEqual({ ok: false, error: "documents.error.quota" });
    expect(db.discardDocumentUpload).not.toHaveBeenCalled();
  });
  it("no signed URL: the new reservation goes, by its own version id, and the answer is the upload failure (mutation: discard with null -> FAILS)", async () => {
    storage.createSignedUploadUrl.mockResolvedValue({ data: null, error: { message: "down" } });
    expect(await A.startDocumentVersionUploadAction(ACC, D, vInput())).toEqual({ ok: false, error: "documents.error.upload" });
    expect(db.discardDocumentUpload).toHaveBeenCalledWith(SERVICE, ACC, D, V);
  });
});

describe("finishDocumentUploadAction refuses a file that went to the trash mid-upload (plan deviation 2)", () => {
  it("removes the object first, then the reservation, answers 'in the trash', and never marks it ready (mutation: drop the trash check -> FAILS)", async () => {
    db.getDocument.mockResolvedValue(TRASHED);
    expect(await A.finishDocumentUploadAction(ACC, D, V)).toEqual({ ok: false, error: "documents.error.trashed" });
    expect(storage.remove).toHaveBeenCalledWith([`${ACC}/${D}/${V}`]);
    expect(db.discardDocumentUpload).toHaveBeenCalledWith(SERVICE, ACC, D, V);
    expect(storage.remove.mock.invocationCallOrder[0]!).toBeLessThan(db.discardDocumentUpload.mock.invocationCallOrder[0]!);
    expect(storage.download).not.toHaveBeenCalled();
    expect(db.markDocumentVersionReady).not.toHaveBeenCalled();
  });
});

describe("purgeDocumentAction: Delete forever by the typed name (spec 4.4, 5.1; deviations 3, 4, 5, 8)", () => {
  const CLAIMED = "2026-10-14T09:00:00.5+00:00";
  beforeEach(() => {
    db.getDocument.mockResolvedValue(TRASHED);
    db.listDocumentVersionStates.mockResolvedValue([
      { storage_path: `${ACC}/${D}/v1`, status: "ready" }, { storage_path: `${ACC}/${D}/v2`, status: "ready" }]);
    db.claimDocumentForPurge.mockResolvedValue(CLAIMED);
    db.deletePurgedDocument.mockResolvedValue(true);
  });
  it("proves the file on the REQUEST client, then claims, removes EVERY version's object, then deletes the row, in that order (mutations: delete before remove; remove only the current path -> FAILS)", async () => {
    expect(await A.purgeDocumentAction(ACC, D, "Lease")).toEqual({ ok: true });
    expect(db.getDocument).toHaveBeenCalledWith(REQUEST, ACC, D);
    expect(db.listDocumentVersionStates).toHaveBeenCalledWith(SERVICE, ACC, D);
    expect(db.claimDocumentForPurge).toHaveBeenCalledWith(SERVICE, ACC, D, TRASHED.deleted_at);
    expect(storage.remove).toHaveBeenCalledWith([`${ACC}/${D}/v1`, `${ACC}/${D}/v2`]);
    expect(db.deletePurgedDocument).toHaveBeenCalledWith(SERVICE, ACC, TRASHED, CLAIMED, "user_owner");
    const order = [db.getDocument, db.claimDocumentForPurge, storage.remove, db.deletePurgedDocument].map((f) => f.mock.invocationCallOrder[0]!);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });
  it("the typed name must match exactly: case and edge spaces count (deviation 8; mutation: compare trimmed or lowercased -> FAILS)", async () => {
    for (const typed of ["lease", "Lease ", " Lease", "LEASE", ""]) {
      expect(await A.purgeDocumentAction(ACC, D, typed), typed).toEqual({ ok: false, error: "documents.purge.mismatch" });
    }
    expect(db.listDocumentVersionStates).not.toHaveBeenCalled();
    expect(db.claimDocumentForPurge).not.toHaveBeenCalled();
  });
  it("only a file in the trash, and only one the caller can see (mutations: drop the trashed check; treat null as visible -> FAILS)", async () => {
    db.getDocument.mockResolvedValueOnce(LISTED);
    expect(await A.purgeDocumentAction(ACC, D, "Lease")).toEqual({ ok: false, error: "documents.error.refused" });
    db.getDocument.mockResolvedValueOnce(null);
    expect(await A.purgeDocumentAction(ACC, D, "Lease")).toEqual({ ok: false, error: "documents.error.refused" });
    expect(await A.purgeDocumentAction(ACC, "not-a-uuid", "Lease")).toEqual({ ok: false, error: "documents.error.refused" });
    expect(db.claimDocumentForPurge).not.toHaveBeenCalled();
    expect(storage.remove).not.toHaveBeenCalled();
  });
  it("a version still uploading refuses the purge before anything changes (deviation 3; mutation: drop the in-flight check -> FAILS)", async () => {
    db.listDocumentVersionStates.mockResolvedValue([
      { storage_path: `${ACC}/${D}/v1`, status: "ready" }, { storage_path: `${ACC}/${D}/v2`, status: "uploading" }]);
    expect(await A.purgeDocumentAction(ACC, D, "Lease")).toEqual({ ok: false, error: "documents.error.purgeUploading" });
    expect(db.claimDocumentForPurge).not.toHaveBeenCalled();
    expect(storage.remove).not.toHaveBeenCalled();
  });
  it("a lost claim (someone restored or changed it first) removes nothing (deviation 4; mutation: ignore a null claim -> FAILS)", async () => {
    db.claimDocumentForPurge.mockResolvedValue(null);
    expect(await A.purgeDocumentAction(ACC, D, "Lease")).toEqual({ ok: false, error: "documents.error.purgeChanged" });
    expect(storage.remove).not.toHaveBeenCalled();
    expect(db.deletePurgedDocument).not.toHaveBeenCalled();
  });
  it("storage refusing the removal keeps the row: nothing is deleted, and the answer says try again (mutation: delete the row anyway -> FAILS)", async () => {
    storage.remove.mockResolvedValue({ data: null, error: { message: "down" } });
    expect(await A.purgeDocumentAction(ACC, D, "Lease")).toEqual({ ok: false, error: "documents.error.purge" });
    expect(db.deletePurgedDocument).not.toHaveBeenCalled();
  });
  it("a row that moved after its objects went is a failure, never a success (mutation: ignore deletePurgedDocument's false -> FAILS)", async () => {
    db.deletePurgedDocument.mockResolvedValue(false);
    expect(await A.purgeDocumentAction(ACC, D, "Lease")).toEqual({ ok: false, error: "documents.error.purge" });
  });
  it("Staff (and a Technician) are refused before anything is read: Delete forever is an Owner's and the agency's (owner ruling R1, deviation 5; mutation: drop the canManage check -> FAILS)", async () => {
    requireAccountAccess.mockResolvedValue(STAFF);
    expect(await A.purgeDocumentAction(ACC, D, "Lease")).toEqual({ ok: false, error: "documents.error.purgeRole" });
    requireAccountAccess.mockResolvedValue({ userId: "user_tech", isAgency: false, role: "technician", canManage: false });
    expect(await A.purgeDocumentAction(ACC, D, "Lease")).toEqual({ ok: false, error: "documents.error.purgeRole" });
    expect(db.getDocument).not.toHaveBeenCalled();
    expect(db.claimDocumentForPurge).not.toHaveBeenCalled();
    expect(storage.remove).not.toHaveBeenCalled();
  });
  it("the agency is allowed (canManage true without an account role) (mutation: require role === 'owner' -> FAILS)", async () => {
    requireAccountAccess.mockResolvedValue({ userId: "user_agency", isAgency: true, role: null, canManage: true });
    expect(await A.purgeDocumentAction(ACC, D, "Lease")).toEqual({ ok: true });
  });
});
```

(d) In the shared table "nothing throws out of an action" (`:309-327`), add two rows:

```ts
    ["start version", () => A.startDocumentVersionUploadAction(ACC, D, { name: "a.pdf", size: 10, contentType: "application/pdf" }), "documents.error.upload"],
    ["purge", () => A.purgeDocumentAction(ACC, D, "Lease"), "documents.error.purge"],
```

Why each can fail (checked while writing): the first start case fails without the request read (call order and `getDocument` arguments) and if the id is not lowercased (`D.toUpperCase()` in, `D` out); the refused case reaches `reserve` with either check missing; the trash case reaches `reserve`; the size case asserts `getDocument` never ran; the quota case fails if anything discards; the signed-URL case pins the version id. The finish case fails without the check (the download runs and `markDocumentVersionReady` is called, because the default mocks make every other check pass). The purge order case sorts the four call orders and compares with the unsorted list; the remove case pins both paths. The mismatch case covers five near-misses. The trashed and visible cases reach the claim without their checks. The uploading case reaches the claim without the check. The remaining branches each have their own case; the role case asserts nothing was even read. The "nothing throws" rows fail if the new action's `try` does not cover the read (the table's own `beforeEach` makes `getDocument` reject).

- [ ] **Step 2: Run red.** `pnpm --filter web exec vitest run "src/app/(dashboard)/dashboard/accounts/[accountId]/contacts/documents-actions.test.ts"` → the new cases FAIL (`A.startDocumentVersionUploadAction is not a function`, …) and the three changed `fileNotFound` expectations FAIL. Paste the summary.

- [ ] **Step 3: Write the code** in `documents-actions.ts`.

Extend the `@bis/db` import (`:6-11`) with `listDocumentVersionStates, claimDocumentForPurge, deletePurgedDocument`.

After `startDocumentUploadAction` (after `:132`), add:

```ts
export type StartVersionInput = { name: string; size: number; contentType: string };

/**
 * "Upload new version" (spec 3.3, 4.1): the same reserve-then-PUT-then-finish journey as a first upload,
 * on an EXISTING listed document. The request-client read proves the caller sees the file (RLS: the
 * record's visibility, the Technician fence, Owners only); a file still on its first upload (never
 * listed) or in the trash gets no new version (plan deviation 2; the finish step re-checks the trash).
 * The version's bytes count against the quota from the reservation on (0077's reserve_document_version).
 * A refused reservation touches nothing; a failure after it removes only the new reservation, never the
 * document (discardDocumentUpload keeps a document that has a current version).
 */
export async function startDocumentVersionUploadAction(
  accountId: string, documentId: string, input: StartVersionInput,
): Promise<{ ok: true; documentId: string; versionId: string; uploadUrl: string } | DocFail> {
  const access = await requireAccountAccess(accountId);
  if (!isUuid(documentId) || !isRecordObj(input)) return fail(REFUSED);
  if (!Number.isInteger(input.size) || input.size < 1) return fail("documents.error.upload");
  if (input.size > DOCUMENT_MAX_BYTES) return fail("documents.error.tooLarge", { size: shownSize(input.size) });
  if (typeof input.name !== "string" || !extensionAllowed(input.name) || !isDocumentContentType(input.contentType)) {
    return fail("documents.error.badType");
  }
  const contentType: DocumentContentType = input.contentType;
  const docId = documentId.toLowerCase();
  let doc: DocumentRow | null = null;
  try {
    doc = await visibleDocument(accountId, docId, false);
  } catch (e) {
    log("start version: document read", accountId, e);
    return fail("documents.error.upload");
  }
  if (!doc || doc.current_version_id === null) return fail(REFUSED);
  if (doc.deleted_at !== null) return fail("documents.error.trashed");
  const svc = serviceDb();
  let versionId: string | null = null;
  try {
    const r = await reserveDocumentVersion(svc, {
      accountId, documentId: docId, bytes: input.size, contentType,
      originalName: input.name.slice(0, 255) || null, uploadedBy: access.userId,
    });
    if (r.status !== "ok") {
      return r.status === "over_quota" ? fail("documents.error.quota")
        : r.status === "too_large" ? fail("documents.error.tooLarge", { size: shownSize(input.size) })
        : fail(REFUSED);
    }
    versionId = r.versionId;
    const { data, error } = await svc.storage.from(DOCUMENT_BUCKET).createSignedUploadUrl(r.storagePath);
    if (error || !data) throw new Error(`createSignedUploadUrl: ${error?.message ?? "no data"}`);
    return { ok: true, documentId: docId, versionId: r.versionId, uploadUrl: data.signedUrl };
  } catch (e) {
    log("start version", accountId, e);
    // Nothing was uploaded yet: only the new reservation goes; the document and its ready versions stay.
    if (versionId) await discardDocumentUpload(svc, accountId, docId, versionId).catch((x: unknown) => log("start version: cleanup", accountId, x));
    return fail("documents.error.upload");
  }
}
```

In `finishDocumentUploadAction`, replace the proof at `:157-162` and add the trash check after the `if (!version) {…}` block (after `:177`, before the download at `:178`):

```ts
  let doc: DocumentRow | null = null;
  try {
    doc = await visibleDocument(accountId, docId, false);
  } catch (e) {
    log("finish: document read", accountId, e);
    return fail("documents.error.upload");
  }
  if (!doc) return fail(REFUSED);
```

```ts
    // A version is never added to a file in the trash (plan deviation 2): trashed after this upload's
    // start, its object and its reservation go now, object first (cleanUp), and the file keeps the
    // versions it had. A trash that commits after this read is the serial order "ready, then trashed".
    if (doc.deleted_at !== null) {
      await cleanUp(svc, accountId, docId, verId, version.storage_path);
      return fail("documents.error.trashed");
    }
```

In `getDocumentUrlAction`, `:239` and `:241`: `fail("documents.error.notFound")` → `fail("documents.error.fileNotFound")` (the comment at `:238` stays).

At the end of the file, add:

```ts
/**
 * Delete forever (spec 3.4, 4.4, 5.1; DESIGN.md "Documents": only a typed name confirms a PERMANENT purge,
 * and that confirmation is never shared with the trash move). An Owner or the agency only (owner ruling
 * R1). The request-client read proves the
 * caller sees the file and that it is in the trash; the typed name must equal its title exactly (plan
 * deviation 8). Then, on the service client: refuse while any version is still uploading (deviation
 * 3); claim the row (deviation 4) so a racing Restore changes nothing; remove EVERY version's object;
 * only then delete the row (its versions cascade) and emit document.purged as the person. A storage
 * refusal keeps the row, still in the trash; nothing is deleted that still has an object.
 */
export async function purgeDocumentAction(accountId: string, documentId: string, typedTitle: string): Promise<{ ok: true } | DocFail> {
  const access = await requireAccountAccess(accountId);
  // Owner ruling R1 (2026-10-14; spec 3.4): Owners and the agency only, the Owners-only rule (setOwnersOnlyAction).
  if (!access.canManage) return fail("documents.error.purgeRole");
  if (!isUuid(documentId) || typeof typedTitle !== "string") return fail(REFUSED);
  const docId = documentId.toLowerCase();
  try {
    const doc = await visibleDocument(accountId, docId, false);
    if (!doc || doc.deleted_at === null) return fail(REFUSED);
    if (typedTitle !== doc.title) return fail("documents.purge.mismatch");
    const svc = serviceDb();
    const versions = await listDocumentVersionStates(svc, accountId, docId);
    if (versions.some((v) => v.status === "uploading")) return fail("documents.error.purgeUploading");
    const claimedAt = await claimDocumentForPurge(svc, accountId, docId, doc.deleted_at);
    if (!claimedAt) return fail("documents.error.purgeChanged");
    const paths = versions.map((v) => v.storage_path);
    if (paths.length > 0) {
      const { error } = await svc.storage.from(DOCUMENT_BUCKET).remove(paths);
      if (error) {
        log(`purge: objects not removed, the file stays in the trash (${docId})`, accountId, error);
        return fail("documents.error.purge");
      }
    }
    if (!(await deletePurgedDocument(svc, accountId, doc, claimedAt, access.userId))) {
      log(`purge: objects removed but the row was no longer the claimed one (${docId})`, accountId, "row moved");
      return fail("documents.error.purge");
    }
    return { ok: true };
  } catch (e) {
    log("purge", accountId, e);
    return fail("documents.error.purge");
  }
}
```

`DocumentRow` is already imported (`:10`); `extensionAllowed`, `shownSize` (`:15`) too.

- [ ] **Step 4: The factory check.** `grep -rln 'vi.mock("@bis/db"' apps/web/src | xargs grep -ln "documents-actions"` → only `documents-actions.test.ts` (done in Step 1a). `grep -rln 'documents-actions"' apps/web/src --include=*.test.ts` lists the tests that mock THIS module (card, handlers, viewer, upload client, styleguide); Tasks 6–8 add the two new names to those factories (their own files). Report both lists.

- [ ] **Step 5: Run green.** The Step 2 command → every case passes; `pnpm --filter web typecheck`; `pnpm --filter web exec eslint "src/app/(dashboard)/dashboard/accounts/[accountId]/contacts/documents-actions.ts" "src/app/(dashboard)/dashboard/accounts/[accountId]/contacts/documents-actions.test.ts"`; also `"src/app/(dashboard)/dashboard/accounts/[accountId]/in-account-service-reads.test.ts"` → PASS (no new `serviceDb` file).

- [ ] **Step 6: Probes, red BY NAME, restored.** (1) start version: replace `doc = await visibleDocument(accountId, docId, false);` with `doc = { current_version_id: "x", deleted_at: null } as DocumentRow;` → the first start case fails (no request read); (2) drop `doc.current_version_id === null ||` → the refused case fails; (3) drop the trash line in start → the trash case fails; (4) drop the trash block in finish → the finish case fails; (5) `typedTitle.trim().toLowerCase() !== doc.title.toLowerCase()` → the mismatch case fails; (6) move `deletePurgedDocument` above the `remove` → the order case fails; (7) drop the `uploading` check → its case fails; (8) `if (!claimedAt)` removed (use `claimedAt ?? doc.deleted_at`) → the lost-claim case fails; (9) `fail("documents.error.notFound")` back in `getDocumentUrlAction` → the three changed expectations fail; (10) review M7, the purge's request-client proof: replace `visibleDocument(accountId, docId, false)` in `purgeDocumentAction` with `getDocument(serviceDb(), accountId, docId)` → the first purge case fails on `getDocument`'s first argument (`SERVICE`, not `REQUEST`); (11) drop the `canManage` line → the role case fails.

- [ ] **Step 7: Commit.** `git commit -m "feat(documents): start a new version, refuse a trashed file at finish, Delete forever by typed name, the file's own not-found (S-07 part 1b)" -- "apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/contacts/documents-actions.ts" "apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/contacts/documents-actions.test.ts"`

---

## Task 5: The card's read: versions and space in the routes, the parser, `space.ts` (bis-crm)

**Review:** sonnet. **After:** Tasks 2 and 3. **Runs beside:** Task 4.

**Files**
- Create: `apps/web/src/lib/documents/space.ts`, `apps/web/src/lib/documents/space.test.ts`
- Modify: `apps/web/src/lib/documents/documents-load.ts` (types `:12-23`, `isView` `:30-39`, `documentsLoadFrom` `:46-56`) and `documents-load.test.ts`
- Modify: `apps/web/src/lib/documents/document-view.ts` (imports `:1-5`; `documentView` `:25-33`; one new export)
- Modify: `…/api/contacts/[contactId]/documents/route.ts` and `…/api/groups/[groupId]/documents/route.ts` (the `Promise.all` at `:26`/`:27` and the body)
- Modify: both routes' `route.test.ts` (the `@bis/db` mock `:10`, the `row()` fixture `:18-24`, the first case's `toEqual` `:45-49`; new cases)

**Interfaces**
- Consumes (Task 3): `ListedDocument.versions` (ready versions, newest first, including the current one); `documentSpaceUsed(db, accountId): Promise<number>` (throws on failure). `DOCUMENT_QUOTA_BYTES` from `@bis/db/document-rules`.
- Produces (Tasks 7, 8 and the styleguide rely on these exact shapes):

```ts
// apps/web/src/lib/documents/space.ts
export type DocumentsSpace = { used: number; quota: number };
export const SPACE_SHOW_ABOVE: number;   // 0.8
export function spaceUsedText(space: DocumentsSpace | null, locale: Locale): string | null;   // null at or below 80%, or when space is null

// apps/web/src/lib/documents/documents-load.ts
export type DocumentVersionView = { id: string; contentType: DocumentContentType; bytes: number; createdAt: string; addedOn: string };
export type DocumentView = { /* every 1a field, unchanged */ versions: DocumentVersionView[]; purging: boolean };   // purging: a Delete forever began and did not finish (deviation 4): never restorable   // ready, newest first, includes `version`
export type DocumentsResponse = { /* every 1a field, unchanged */ space: DocumentsSpace | null };

// apps/web/src/lib/documents/document-view.ts
export async function documentsSpace(db: SupabaseClient, accountId: string): Promise<DocumentsSpace | null>;   // null (logged) when the read fails
```

- [ ] **Step 1: Write the failing tests.**

`apps/web/src/lib/documents/space.test.ts` (new):

```ts
import { describe, it, expect } from "vitest";
import { m } from "@/lib/messages";
import { spaceUsedText, SPACE_SHOW_ABOVE } from "./space";

const GIB = 1_073_741_824;
const QUOTA = 5 * GIB;
const es = (used: string, quota: string) => m["documents.spaceUsed.es"].replace("{used}", used).replace("{quota}", quota);

describe("the space-used line (spec 4.2 item 4)", () => {
  it("is shown only ABOVE 80%: exactly 4 of 5 GB is quiet, one byte more speaks (mutation: >= in place of > -> FAILS)", () => {
    expect(SPACE_SHOW_ABOVE).toBe(0.8);
    expect(spaceUsedText({ used: 4 * GIB, quota: QUOTA }, "en")).toBeNull();
    expect(spaceUsedText({ used: 4 * GIB + 1, quota: QUOTA }, "en")).toBe("4.0 of 5 GB used");
  });
  it("tenths round DOWN, so a nearly full account never reads full (mutation: Math.round -> FAILS on 4.99)", () => {
    expect(spaceUsedText({ used: Math.floor(4.1 * GIB) + 1, quota: QUOTA }, "en")).toBe("4.1 of 5 GB used");
    expect(spaceUsedText({ used: Math.floor(4.99 * GIB), quota: QUOTA }, "en")).toBe("4.9 of 5 GB used");
    expect(spaceUsedText({ used: QUOTA, quota: QUOTA }, "en")).toBe("5.0 of 5 GB used");
  });
  it("Spanish is the Spanish catalogue's sentence (mutation: render the English key for es -> FAILS)", () => {
    expect(spaceUsedText({ used: Math.floor(4.1 * GIB) + 1, quota: QUOTA }, "es")).toBe(es("4.1", "5"));
  });
  it("no number, no line: a failed read (null) and a nonsense quota draw nothing (mutation: drop the `!(space.quota > 0)` guard -> FAILS on the zero quota)", () => {
    expect(spaceUsedText(null, "en")).toBeNull();
    expect(spaceUsedText({ used: 10, quota: 0 }, "en")).toBeNull();
  });
});
```

In `documents-load.test.ts`: give the fixture `view` a `versions` array and the `body` a `space`, then add refusals:

```ts
const view = {
  id: "d1", title: "Lease", category: "contract", expiresOn: "2026-11-01", ownersOnly: false, source: "upload",
  addedBy: { you: false, name: "Ana" }, createdAt: "2026-10-01T00:00:00Z", addedOn: "2026-09-30", deletedAt: null,
  version: { id: "v2", contentType: "application/pdf", bytes: 1200 },
  versions: [
    { id: "v2", contentType: "application/pdf", bytes: 1200, createdAt: "2026-10-02T00:00:00Z", addedOn: "2026-10-01" },
    { id: "v1", contentType: "image/jpeg", bytes: 900, createdAt: "2026-10-01T00:00:00Z", addedOn: "2026-09-30" },
  ],
  purging: false,
};
const body: DocumentsResponse = {
  today: "2026-10-13", now: "2026-10-13T15:00:00.000Z", record: { kind: "contact", id: "c1" },
  live: [view as DocumentsResponse["live"][number]], trashed: [], capped: false, space: { used: 4_500_000_000, quota: 5_368_709_120 },
};
```

and extend the `it.each` refusal table with:

```ts
    ["no versions list", res({ ...body, live: [{ ...view, versions: undefined }] })],
    ["an empty versions list", res({ ...body, live: [{ ...view, versions: [] }] })],
    ["a versions list without the current version", res({ ...body, live: [{ ...view, versions: [view.versions[1]] }] })],
    ["an SVG among the versions", res({ ...body, live: [{ ...view, versions: [view.versions[0], { ...view.versions[1], contentType: "image/svg+xml" }] }] })],
    ["a version with no added day", res({ ...body, live: [{ ...view, versions: [{ ...view.versions[0], addedOn: undefined }] }] })],
    ["no space field at all", res({ ...body, space: undefined })],
    ["a negative usage", res({ ...body, space: { used: -1, quota: 5_368_709_120 } })],
    ["a zero quota", res({ ...body, space: { used: 1, quota: 0 } })],
    ["no purging flag", res({ ...body, live: [{ ...view, purging: undefined }] })],
    ["a LIVE file marked purging", res({ ...body, live: [{ ...view, purging: true }] })],
```

and one more case:

```ts
  it("a null space is a good body: the line is simply not drawn (mutation: refuse a null space -> FAILS)", async () => {
    expect(await documentsLoadFrom(res({ ...body, space: null }))).toEqual({ status: "ready", data: { ...body, space: null } });
  });
```

In BOTH route tests (`…/contacts/[contactId]/documents/route.test.ts` and `…/groups/[groupId]/documents/route.test.ts`):
- add `documentSpaceUsed: vi.fn()` to the `db` mock object at `:10`; in `beforeEach`, `db.documentSpaceUsed.mockResolvedValue(4_500_000_000);`
- give `row()` (`:18-24`) a `versions` array of two ready versions, the current first:

```ts
  versions: [
    { id: "v1", document_id: "d1", account_id: ACC, storage_path: "p", bytes: 1200, content_type: "image/jpeg", original_name: "x.jpg", status: "ready", created_at: "2026-10-01T00:00:00Z" },
    { id: "v0", document_id: "d1", account_id: ACC, storage_path: "q", bytes: 800, content_type: "application/pdf", original_name: "x.pdf", status: "ready", created_at: "2026-09-20T15:00:00Z" },
  ],
```

- in the first case's `toEqual` (`:45-49`), add after `version: {…}`:

```ts
      versions: [
        { id: "v1", contentType: "image/jpeg", bytes: 1200, createdAt: "2026-10-01T00:00:00Z", addedOn: "2026-09-30" },
        { id: "v0", contentType: "application/pdf", bytes: 800, createdAt: "2026-09-20T15:00:00Z", addedOn: "2026-09-20" },
      ],
      purging: false,
```

  (Chicago: midnight UTC on Oct 1 is Sept 30; 15:00 UTC on Sept 20 is Sept 20. The storage path and the original name never travel: `toEqual` is exact.)
- append two cases to the describe:

```ts
  it("a trashed file whose Delete forever began is 'purging'; any other trashed file is not, and the marker never travels (review m1; mutation: purging always false -> FAILS)", async () => {
    db.listRecordDocuments.mockResolvedValue({ live: [row()], trashed: [
      row({ id: "t1", deleted_at: "2026-10-13T03:00:00Z", deleted_by: "documents:purging" }),
      row({ id: "t2", deleted_at: "2026-10-13T03:00:00Z", deleted_by: "user_ana" })], liveMore: false, trashedMore: false });
    const body = await (await call()).json();
    expect([body.live[0].purging, body.trashed[0].purging, body.trashed[1].purging]).toEqual([false, true, false]);
    expect(JSON.stringify(body)).not.toContain("documents:purging");
  });
  it("reports the account's usage on the REQUEST client, against the 5 GB quota (mutation: read it on serviceDb() -> the mock throws -> FAILS)", async () => {
    const body = await (await call()).json();
    expect(db.documentSpaceUsed).toHaveBeenCalledWith(REQUEST, ACC);
    expect(body.space).toEqual({ used: 4_500_000_000, quota: 5_368_709_120 });
  });
  it("a failed usage read is omitted, never a 500 and never zero: the card still loads (mutation: let the error reach the route's catch -> 500 -> FAILS)", async () => {
    db.documentSpaceUsed.mockRejectedValue(new Error("42501"));
    const res = await call();
    expect(res.status).toBe(200);
    expect((await res.json()).space).toBeNull();
  });
```

Why each can fail (checked while writing): `space.test.ts`'s first case is shown at exactly 80% under `>=`; `Math.round` turns 4.99 into "5.0"; the Spanish case compares with the catalogue's own Spanish string; the zero-quota case (10 bytes used of 0) passes `used > quota * 0.8` and draws a line without its guard. The null half of that case is a guard against a crash, not a probe target. The parser cases each break one rule the parser adds. The route's exact `toEqual` fails while `versions` is missing or carries a storage path; the space cases fail on the client argument and on an unguarded rejection.

- [ ] **Step 2: Run red.** `pnpm --filter web exec vitest run src/lib/documents/space.test.ts src/lib/documents/documents-load.test.ts "src/app/api/accounts/[accountId]/contacts/[contactId]/documents/route.test.ts" "src/app/api/accounts/[accountId]/groups/[groupId]/documents/route.test.ts"` → `space.test.ts` fails to import; the parser's "parses a good body" and new refusals fail; each route's first case and the two space cases fail. Paste the summary.

- [ ] **Step 3: Write the code.**

`apps/web/src/lib/documents/space.ts`:

```ts
import type { Locale } from "@/lib/i18n/locale";
import { t } from "@/lib/i18n/t";
import { m } from "@/lib/messages";

/**
 * The card's space-used line (spec 4.2 item 4): "4.1 of 5 GB used", only ABOVE 80% of the quota. The
 * used figure is the account's (0078), counted as the quota counts it. Tenths round DOWN, so an account
 * one byte short of full never reads "5.0 of 5 GB". GB here is the quota's own unit, 2^30 bytes (5 GB =
 * DOCUMENT_QUOTA_BYTES). No number, no line: a failed read is omitted, never shown as zero (DESIGN.md:
 * a metric not measured is omitted, never zeroed). Pure; the browser renders it.
 */
export type DocumentsSpace = { used: number; quota: number };
export const SPACE_SHOW_ABOVE = 0.8;
const GIB = 1_073_741_824;

export function spaceUsedText(space: DocumentsSpace | null, locale: Locale): string | null {
  if (!space || !(space.quota > 0) || !(space.used > space.quota * SPACE_SHOW_ABOVE)) return null;
  const tag = locale === "es" ? "es-US" : "en-US";
  const used = new Intl.NumberFormat(tag, { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(Math.floor((space.used * 10) / GIB) / 10);
  const quota = new Intl.NumberFormat(tag, { maximumFractionDigits: 1 }).format(space.quota / GIB);
  return t(m, "documents.spaceUsed", locale, { used, quota });
}
```

(`es-US` writes a decimal point, "4.1", read off Node's `Intl` on 2026-10-14; the same tag `formatMb` uses, `rules.ts:49`.)

`apps/web/src/lib/documents/documents-load.ts`: add the import `import type { DocumentsSpace } from "./space";`, then:

```ts
export type DocumentVersionView = { id: string; contentType: DocumentContentType; bytes: number; createdAt: string; addedOn: string };
```

add `purging: boolean;` to `DocumentView` (review m1: `true` only on a trashed file whose `deleted_by` is `DOCUMENT_PURGING_MARK`), and add `versions: DocumentVersionView[];` to `DocumentView` (after `version`, with the comment `/** Every READY version, newest first; always includes \`version\` (spec 4.3). */`), add `space: DocumentsSpace | null;` to `DocumentsResponse`, and:

```ts
function isVersionView(v: unknown): boolean {
  return isObj(v) && str(v.id) && isDocumentContentType(v.contentType) && typeof v.bytes === "number" && v.bytes > 0
    && instant(v.createdAt) && isDay(v.addedOn);
}

function isSpace(v: unknown): boolean {
  return v === null || (isObj(v) && Number.isSafeInteger(v.used) && (v.used as number) >= 0
    && Number.isSafeInteger(v.quota) && (v.quota as number) > 0);
}
```

In `isView`, append to the returned conjunction:

```ts
    && typeof v.purging === "boolean" && (trashed || v.purging === false)
    && Array.isArray(v.versions) && v.versions.length > 0 && v.versions.every(isVersionView)
    && v.versions.some((x) => isObj(x) && x.id === (v.version as Obj).id)
```

In `documentsLoadFrom`, append `&& isSpace(body.space)` to `ok`. (`body.space === undefined` fails `isSpace`, so a body from a server older than this bundle is the card's error state, the parser's own rule.)

`apps/web/src/lib/documents/document-view.ts`: change the imports to

```ts
import { documentSpaceUsed, type ListedDocument, type SupabaseClient } from "@bis/db";
import { DOCUMENT_QUOTA_BYTES } from "@bis/db/document-rules";
import { renderZone } from "@/lib/zone";
import { dayKeyInZone } from "@/lib/booking/availability";
import { loggableError } from "@/lib/loggable-error";
import type { DocumentView } from "./documents-load";
import type { DocumentsSpace } from "./space";
```

add to the object `documentView` returns, after `version: {…}`, the purge state (review m1; `deleted_by` is in `DOC_COLS`, `documents.ts:32-33`; import `DOCUMENT_PURGING_MARK` from `@bis/db` beside `documentSpaceUsed`, and add `DOCUMENT_PURGING_MARK: "documents:purging"` to BOTH route tests' bare `@bis/db` mock objects):

```ts
    purging: d.deleted_at !== null && d.deleted_by === DOCUMENT_PURGING_MARK,
    versions: d.versions.map((v) => ({
      id: v.id, contentType: v.content_type, bytes: v.bytes, createdAt: v.created_at, addedOn: dayKeyInZone(new Date(v.created_at), zone),
    })),
```

and append:

```ts
/**
 * The space-used line's number (spec 4.2 item 4), on the caller's REQUEST client: 0078 answers the
 * account's usage by the quota's own rule. A failed read is logged and omitted (null), never a failed
 * card: the line is a convenience, the files are the card.
 */
export async function documentsSpace(db: SupabaseClient, accountId: string): Promise<DocumentsSpace | null> {
  try {
    return { used: await documentSpaceUsed(db, accountId), quota: DOCUMENT_QUOTA_BYTES };
  } catch (e) {
    console.error(`documents space (account ${accountId}): ${loggableError(e)}`);
    return null;
  }
}
```

Both routes: import `documentsSpace` beside `documentView, documentsClock`; replace the `Promise.all` line with

```ts
    const [docs, { today, zone }, space] = await Promise.all([
      listRecordDocuments(db, accountId, { kind: "contact", id: contactId }), documentsClock(db, accountId), documentsSpace(db, accountId)]);
```

(the group route: `{ kind: "group", id: groupId }`), and add `space,` to the body after `capped`.

- [ ] **Step 4: Run green.** The Step 2 command → all pass. `pnpm --filter web typecheck` → the only errors left are in files Tasks 7 and 8 own (fixtures that build a `DocumentView` without `versions`: the card, viewer and handler tests and the styleguide demo); list them in the report, do not edit them. `pnpm --filter web exec eslint` on the touched files → clean.

- [ ] **Step 5: Probes, red BY NAME, restored.** (1) `>=` in `spaceUsedText`; (2) `Math.round`; (3) drop `&& isSpace(body.space)`; (4) drop the `versions.some(… version.id)` line; (4b) `purging: false` always in `documentView` → the purging route case fails in BOTH route tests; (4c) drop `(trashed || v.purging === false)` → the live-marked parser case fails; (5) in the contact route, `documentsSpace(serviceDb(), accountId)` (import `serviceDb`) → the REQUEST-client case fails; (6) replace `documentsSpace`'s body with a bare `return { used: await documentSpaceUsed(db, accountId), quota: DOCUMENT_QUOTA_BYTES };` → the omitted-read case fails in BOTH route tests (run both).

- [ ] **Step 6: Commit.** `git commit -m "feat(documents): the card's read carries every ready version and the account's usage (S-07 part 1b)" -- apps/web/src/lib/documents/space.ts apps/web/src/lib/documents/space.test.ts apps/web/src/lib/documents/documents-load.ts apps/web/src/lib/documents/documents-load.test.ts apps/web/src/lib/documents/document-view.ts "apps/web/src/app/api/accounts/[accountId]/contacts/[contactId]/documents/route.ts" "apps/web/src/app/api/accounts/[accountId]/contacts/[contactId]/documents/route.test.ts" "apps/web/src/app/api/accounts/[accountId]/groups/[groupId]/documents/route.ts" "apps/web/src/app/api/accounts/[accountId]/groups/[groupId]/documents/route.test.ts"` (after `git add -- apps/web/src/lib/documents/space.ts apps/web/src/lib/documents/space.test.ts`).

---

## Task 6: `uploadVersion` in the upload client (bis-frontend)

**Review:** sonnet. **After:** Task 4. **Runs beside:** Task 7.

**Files**
- Modify: `apps/web/src/lib/documents/upload-client.ts` (imports `:2-4`; `uploadOne` `:49-71` refactored onto a shared helper; new exports after it and after `browserDeps` `:106-109`)
- Modify: `apps/web/src/lib/documents/upload-client.test.ts` (the actions mock `:4-6`; new describe)

**Interfaces**
- Consumes (Task 4): `startDocumentVersionUploadAction(accountId, documentId, { name, size, contentType })`.
- Produces (Task 8):

```ts
export type VersionDeps = Pick<UploadDeps, "finish" | "abandon" | "put" | "strip"> & { startVersion: typeof startDocumentVersionUploadAction };
export async function uploadVersion(accountId: string, documentId: string, file: File, deps: VersionDeps, onPhase: (p: UploadPhase) => void): Promise<UploadPhase>;
export const browserVersionDeps: () => VersionDeps;
```

- [ ] **Step 1: Write the failing test.** In `upload-client.test.ts`, add `startDocumentVersionUploadAction: vi.fn()` to the mock factory at `:4-6`, import `uploadVersion` beside `uploadOne`, and append:

```ts
function versionDeps(over: Partial<import("./upload-client").VersionDeps> = {}) {
  const calls: string[] = [];
  const d = {
    calls,
    strip: vi.fn(async (f: Blob) => { calls.push("strip"); return new Blob([new Uint8Array(7)], { type: f.type }); }),
    startVersion: vi.fn(async () => { calls.push("startVersion"); return { ok: true as const, documentId: "d", versionId: "v2", uploadUrl: "https://u2" }; }),
    put: vi.fn(async (_u: string, _b: Blob, _t: string, p: (n: number) => void) => { calls.push("put"); p(60); return true; }),
    finish: vi.fn(async () => { calls.push("finish"); return { ok: true as const }; }),
    abandon: vi.fn(async () => { calls.push("abandon"); return { ok: true as const }; }),
    ...over,
  };
  return d as unknown as import("./upload-client").VersionDeps & { calls: string[] };
}

describe("uploadVersion (spec 3.3, 4.1: Upload new version)", () => {
  it("prepares the file (an image is re-encoded), reserves a version of THIS document at the size AS STORED, PUTs, then finishes that version (mutation: start a new document -> FAILS)", async () => {
    const d = versionDeps();
    const phases: unknown[] = [];
    const end = await uploadVersion("acc", "doc-1", file("roof.jpg", "image/jpeg", 50), d, (p) => phases.push(p));
    expect(end).toEqual({ kind: "done" });
    expect(d.calls).toEqual(["strip", "startVersion", "put", "finish"]);
    expect(mockOf(d.startVersion)).toHaveBeenCalledWith("acc", "doc-1", { name: "roof.jpg", size: 7, contentType: "image/jpeg" });
    expect(mockOf(d.put).mock.calls[0]!.slice(0, 1)).toEqual(["https://u2"]);
    expect(mockOf(d.finish)).toHaveBeenCalledWith("acc", "d", "v2");
    expect(phases).toEqual([{ kind: "uploading", percent: 0 }, { kind: "uploading", percent: 60 }, { kind: "checking" }]);
  });
  it("a refused start is the answer, with its params, and nothing is sent (mutation: PUT anyway -> FAILS)", async () => {
    const d = versionDeps({ startVersion: vi.fn(async () => ({ ok: false as const, error: "documents.error.trashed" })) as never });
    expect(await uploadVersion("acc", "doc-1", file("a.pdf", "application/pdf"), d, () => {})).toEqual({ kind: "failed", error: "documents.error.trashed" });
    expect(d.put).not.toHaveBeenCalled();
  });
  it("a failed PUT gives the reservation back at once and answers the upload failure (mutation: skip abandon -> FAILS)", async () => {
    const d = versionDeps({ put: vi.fn(async () => false) as never });
    expect(await uploadVersion("acc", "doc-1", file("a.pdf", "application/pdf"), d, () => {})).toEqual({ kind: "failed", error: "documents.error.upload" });
    expect(mockOf(d.abandon)).toHaveBeenCalledWith("acc", "d", "v2");
    expect(d.finish).not.toHaveBeenCalled();
  });
  it("a refused finish is the answer (mutation: answer done whatever finish says -> FAILS)", async () => {
    const d = versionDeps({ finish: vi.fn(async () => ({ ok: false as const, error: "documents.error.badType" })) as never });
    expect(await uploadVersion("acc", "doc-1", file("a.pdf", "application/pdf"), d, () => {})).toEqual({ kind: "failed", error: "documents.error.badType" });
  });
  it("a file of a kind the vault refuses never reaches the server (mutation: skip prepareFile -> FAILS)", async () => {
    const d = versionDeps();
    expect(await uploadVersion("acc", "doc-1", file("a.exe", ""), d, () => {})).toEqual({ kind: "failed", error: "documents.error.badType" });
    expect(d.startVersion).not.toHaveBeenCalled();
  });
});
```

(`file`, `mockOf` are the test file's own helpers, `:11`, `:26`.)

- [ ] **Step 2: Run red.** `pnpm --filter web exec vitest run src/lib/documents/upload-client.test.ts` → the new describe fails (`uploadVersion is not a function`); the existing cases pass.

- [ ] **Step 3: Write the code.** Extend the actions import at `:2-4` with `startDocumentVersionUploadAction`. Replace `uploadOne` (`:49-71`) with a shared tail and the two journeys:

```ts
type Started = { ok: true; documentId: string; versionId: string; uploadUrl: string };
const failedPhase = (r: Refusal): UploadPhase => (r.params ? { kind: "failed", error: r.error, params: r.params } : { kind: "failed", error: r.error });

/** The shared tail of both journeys: PUT with progress, give the reservation back on a failed PUT, then finish. */
async function sendAndFinish(
  accountId: string, started: Started, blob: Blob, contentType: string,
  deps: Pick<UploadDeps, "put" | "abandon" | "finish">, onPhase: (p: UploadPhase) => void,
): Promise<UploadPhase> {
  onPhase({ kind: "uploading", percent: 0 });
  const put = await deps.put(started.uploadUrl, blob, contentType, (percent) => onPhase({ kind: "uploading", percent })).catch(() => false);
  if (!put) {
    // Abandon's answer is ignored: if it fails, the reservation stays `uploading` and the documents sweep removes it.
    await deps.abandon(accountId, started.documentId, started.versionId).catch(() => undefined);
    return { kind: "failed", error: "documents.error.upload" };
  }
  onPhase({ kind: "checking" });
  const finished = await deps.finish(accountId, started.documentId, started.versionId).catch((): Refusal => refusal("documents.error.upload"));
  return finished.ok ? { kind: "done" } : failedPhase(finished);
}

export async function uploadOne(
  accountId: string, item: UploadItem, batch: UploadBatch, deps: UploadDeps, onPhase: (p: UploadPhase) => void,
): Promise<UploadPhase> {
  const prepared = await prepareFile(item.file, deps.strip);
  if (!prepared.ok) return failedPhase(prepared);
  const started = await deps.start(accountId, {
    record: batch.record, name: item.file.name, title: item.title, size: prepared.blob.size, contentType: prepared.contentType,
    category: item.category, expiresOn: batch.expiresOn, ownersOnly: batch.ownersOnly, source: batch.source,
  }).catch((): Refusal => refusal("documents.error.upload"));
  if (!started.ok) return failedPhase(started);
  return sendAndFinish(accountId, started, prepared.blob, prepared.contentType, deps, onPhase);
}

export type VersionDeps = Pick<UploadDeps, "finish" | "abandon" | "put" | "strip"> & { startVersion: typeof startDocumentVersionUploadAction };

/**
 * "Upload new version" (spec 3.3, 4.1): one file, prepared exactly as a first upload is (an image
 * re-encoded, its size checked AS STORED), reserved as a new version of `documentId`, then the same
 * PUT and finish. The finish makes it the current version once its bytes are checked (0077).
 */
export async function uploadVersion(
  accountId: string, documentId: string, file: File, deps: VersionDeps, onPhase: (p: UploadPhase) => void,
): Promise<UploadPhase> {
  const prepared = await prepareFile(file, deps.strip);
  if (!prepared.ok) return failedPhase(prepared);
  const started = await deps.startVersion(accountId, documentId, { name: file.name, size: prepared.blob.size, contentType: prepared.contentType })
    .catch((): Refusal => refusal("documents.error.upload"));
  if (!started.ok) return failedPhase(started);
  return sendAndFinish(accountId, started, prepared.blob, prepared.contentType, deps, onPhase);
}
```

After `browserDeps` (`:106-109`):

```ts
export const browserVersionDeps = (): VersionDeps => ({
  startVersion: startDocumentVersionUploadAction, finish: finishDocumentUploadAction, abandon: abandonDocumentUploadAction,
  put: xhrPut, strip: stripImage,
});
```

- [ ] **Step 4: Run green.** The Step 2 command → every case, old and new, passes (the refactor of `uploadOne` keeps its behaviour; its existing cases are the proof). `pnpm --filter web typecheck` (errors only in Task 7/8 files, listed); eslint on the two files → clean.

- [ ] **Step 5: Probes, red BY NAME, restored.** (1) in `uploadVersion`, call `deps.startVersion(accountId, "other", …)` → case 1 fails; (2) drop the `abandon` call in `sendAndFinish` → the failed-PUT case fails AND `uploadOne`'s existing abandon case fails (both copies, one helper); (3) `return { kind: "done" }` regardless of `finished` → case 4 fails; (4) skip `prepareFile` (pass the raw file with `contentType: "application/pdf"`) → case 5 fails.

- [ ] **Step 6: Commit.** `git commit -m "feat(documents): uploadVersion, the new-version journey on the shared PUT-and-finish tail (S-07 part 1b)" -- apps/web/src/lib/documents/upload-client.ts apps/web/src/lib/documents/upload-client.test.ts`

---

## Task 7: The viewer (Versions list, one automatic retry) and the purge dialog (bis-frontend)

**Review:** opus. **After:** Tasks 2 and 5. **Runs beside:** Task 6.

**Files**
- Modify: `…/contacts/document-viewer.tsx` (the module comment `:16-21`; `DocumentViewerBody` `:38-57`; `DocumentViewer` `:59-113`; two new exports)
- Modify: `…/contacts/document-viewer.test.ts` (`doc()` `:9-13`, `body()` `:14-15`; new describes)
- Create: `…/contacts/document-purge-dialog.tsx`, `…/contacts/document-purge-dialog.test.ts`

**Interfaces**
- Consumes: `DocumentView` with `versions: DocumentVersionView[]` (Task 5); keys from Task 2.
- Produces (Task 8 wires these):

```ts
// document-viewer.tsx
export function imageErrorStep(versionId: string | null, autoRetriedFor: string | null): "retry" | "fail";
export function DocumentViewerBody(p: { doc: DocumentView; state: ViewerState; locale: Locale; onRetry: () => void; onImageError: () => void }): JSX.Element;
export function DocumentVersionsList(p: { doc: DocumentView; locale: Locale; when: (addedOn: string) => string; onDownload: (versionId: string) => void }): JSX.Element | null;
export function DocumentViewer(p: {
  accountId: string; doc: DocumentView | null; header: { source: string; expiry: string | null }; locale: Locale;
  onClose: () => void; onDownload: (doc: DocumentView) => void;
  versionWhen: (addedOn: string) => string; onDownloadVersion: (doc: DocumentView, versionId: string) => void;
}): JSX.Element;
// document-purge-dialog.tsx
export function canPurge(typed: string, title: string): boolean;
export function DocumentPurgeForm(p: { title: string; versionCount: number; typed: string; busy: boolean; locale: Locale; bodyId?: string;
  onTyped: (v: string) => void; onCancel: () => void; onConfirm: () => void }): JSX.Element;
export function DocumentPurgeDialog(p: { doc: DocumentView | null; locale: Locale; onClose: () => void;
  onConfirm: (doc: DocumentView, typed: string) => Promise<boolean> }): JSX.Element;
```

- [ ] **Step 1: Write the failing tests.**

In `document-viewer.test.ts`: change the mock factory at `:4` to `vi.mock("./documents-actions", () => ({ getDocumentUrlAction: vi.fn() }));` (unchanged: the viewer imports only that action), extend the import at `:7` to `const { DocumentViewerBody, DocumentVersionsList, viewerStateFor, fetchKeyFor, imageErrorStep } = await import("./document-viewer");`, add `import type { ReactElement } from "react";` at the top, give `doc()` (`:9-13`) a `versions` array equal to its one version:

```ts
  versions: [{ id: "v", contentType: contentType as never, bytes: 10, createdAt: "2026-10-01T00:00:00Z", addedOn: "2026-09-30" }],
  purging: false,
```

change `body()` (`:14-15`) to pass `onImageError: vi.fn()`, and append:

```ts
describe("one automatic retry for a broken image (PR 1a review M7)", () => {
  it("the first error for a version re-mints once; the second is the error state; a new version gets its own retry (mutation: always 'retry' -> FAILS)", () => {
    expect(imageErrorStep("v1", null)).toBe("retry");
    expect(imageErrorStep("v1", "v1")).toBe("fail");
    expect(imageErrorStep("v2", "v1")).toBe("retry");
    expect(imageErrorStep(null, null)).toBe("fail");
  });
  it("the image's onError is the bounded handler, never the Retry button's re-mint (mutation: onError={onRetry} -> FAILS)", () => {
    const onRetry = vi.fn();
    const onImageError = vi.fn();
    const el = DocumentViewerBody({
      doc: doc("image/png"), state: { status: "ready", url: "https://s/i", contentType: "image/png" }, locale: "en", onRetry, onImageError,
    }) as ReactElement<{ onError?: unknown; src?: string }>;
    expect(el.props.src).toBe("https://s/i");
    expect(el.props.onError).toBe(onImageError);
  });
});

describe("the Versions list (spec 4.3)", () => {
  const three = {
    ...doc("application/pdf"),
    version: { id: "v3", contentType: "application/pdf" as never, bytes: 30 },
    versions: [
      { id: "v3", contentType: "application/pdf" as never, bytes: 30, createdAt: "2026-10-13T10:00:00Z", addedOn: "2026-10-13" },
      { id: "v2", contentType: "image/jpeg" as never, bytes: 20, createdAt: "2026-10-10T10:00:00Z", addedOn: "2026-10-10" },
      { id: "v1", contentType: "application/pdf" as never, bytes: 10, createdAt: "2026-10-01T10:00:00Z", addedOn: "2026-10-01" },
    ],
  };
  const list = (d: typeof three, locale: "en" | "es" = "en") =>
    renderToStaticMarkup(createElement(DocumentVersionsList, { doc: d, locale, when: (day: string) => `on ${day}`, onDownload: vi.fn() }));
  const rowOf = (html: string, id: string) => {
    const at = html.indexOf(`data-document-version-row="${id}"`);
    return html.slice(html.lastIndexOf("<li", at), html.indexOf("</li>", at));
  };
  it("newest first, numbered by upload order, the newest the highest (mutation: number by index + 1 -> FAILS)", () => {
    const html = list(three);
    expect(html.indexOf('"v3"')).toBeLessThan(html.indexOf('"v2"'));
    expect(html.indexOf('"v2"')).toBeLessThan(html.indexOf('"v1"'));
    expect(renderedText(rowOf(html, "v3"))).toContain("Version 3 · on 2026-10-13");
    expect(renderedText(rowOf(html, "v1"))).toContain("Version 1 · on 2026-10-01");
  });
  it("the current version is marked Current and offers no second Download; each older one has a ghost Download named for its number (mutation: a Download on the current row -> FAILS)", () => {
    const html = list(three);
    expect(renderedText(rowOf(html, "v3"))).toContain(m["documents.versionCurrent"]);
    expect(rowOf(html, "v3")).not.toContain("<button");
    expect(rowOf(html, "v2")).toMatch(/<button[^>]*aria-label="Download version 2"/);
    expect(rowOf(html, "v2")).toMatch(/data-variant="ghost"/);
    expect(html).not.toContain('data-variant="default"');
  });
  it("its heading is the label role, as record-section.tsx writes it (mutation: drop the mono label -> FAILS)", () => {
    expect(list(three)).toMatch(/<h3[^>]*class="[^"]*font-mono[^"]*tracking-\[0\.14em\][^"]*"[^>]*>Versions</);
  });
  it("Spanish: the line, Current and the Download name are the Spanish catalogue's (mutation: an English word in es -> FAILS)", () => {
    const html = list(three, "es");
    expect(renderedText(rowOf(html, "v2"))).toContain(m["documents.versionLine.es"].replace("{n}", "2").replace("{when}", "on 2026-10-10"));
    expect(renderedText(rowOf(html, "v3"))).toContain(m["documents.versionCurrent.es"]);
    expect(rowOf(html, "v2")).toContain(`aria-label="${m["documents.downloadVersion.es"].replace("{n}", "2")}"`);
    expect(renderedText(html)).toContain(m["documents.versions.es"]);
  });
  it("a file with one version draws no list at all (mutation: render for one version -> FAILS)", () => {
    expect(list({ ...three, versions: [three.versions[0]!] })).toBe("");
  });
});
```

`document-purge-dialog.test.ts` (new):

```ts
import { describe, it, expect, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { m } from "@/lib/messages";
import { renderedText } from "@/lib/rendered-text";
import { canPurge, DocumentPurgeForm } from "./document-purge-dialog";

const form = (typed: string, locale: "en" | "es" = "en", busy = false, versionCount = 2) => renderToStaticMarkup(createElement(DocumentPurgeForm, {
  title: "Lease", versionCount, typed, busy, locale, onTyped: vi.fn(), onCancel: vi.fn(), onConfirm: vi.fn(),
}));
const confirmTag = (html: string) => /<button[^>]*data-variant="destructive"[^>]*>/.exec(html)![0];

describe("Delete forever's typed name (spec 4.4; DESIGN.md Documents; plan deviation 8)", () => {
  it("only the exact title confirms: case and edge spaces count (mutation: trim or lowercase -> FAILS)", () => {
    expect(canPurge("Lease", "Lease")).toBe(true);
    for (const typed of ["lease", "Lease ", " Lease", "LEASE", "Leas", ""]) expect(canPurge(typed, "Lease"), typed).toBe(false);
  });
  it("the destructive button is disabled until the name matches, and while the purge runs (mutation: drop disabled -> FAILS)", () => {
    expect(confirmTag(form(""))).toContain('disabled=""');
    expect(confirmTag(form("Leas"))).toContain('disabled=""');
    // The attribute, never the word: the button's own classes carry "disabled:opacity-50" on every render.
    expect(confirmTag(form("Lease"))).not.toContain('disabled=""');
    expect(confirmTag(form("Lease", "en", true))).toContain('disabled=""');
  });
  it("a near miss says why, an empty box does not (mutation: show the hint whenever it does not match -> FAILS on the empty box)", () => {
    expect(renderedText(form("lease"))).toContain(m["documents.purge.mismatch"]);
    expect(renderedText(form(""))).not.toContain(m["documents.purge.mismatch"]);
    expect(renderedText(form("Lease"))).not.toContain(m["documents.purge.mismatch"]);
  });
  it("says what goes and that it cannot come back; ONE primary, the destructive one, and a ghost Cancel (rule 8; mutation: make Cancel default -> FAILS)", () => {
    const html = form("");
    expect(renderedText(html)).toContain(m["documents.purge.body"].replace("{title}", "Lease"));
    expect(renderedText(html)).toContain(m["documents.purge.label"]);
    expect(html.match(/data-variant="destructive"/g)).toHaveLength(1);
    expect(html).not.toContain('data-variant="default"');
    expect(html).toMatch(/data-variant="ghost"[^>]*>Cancel</);
    expect(html).toMatch(/data-variant="destructive"[^>]*>Delete forever</);
  });
  it("Spanish: the body, the label, the hint and both buttons are the Spanish catalogue's (mutation: an English word in es -> FAILS)", () => {
    const text = renderedText(form("lease", "es"));
    expect(text).toContain(m["documents.purge.body.es"].replace("{title}", "Lease"));
    expect(text).toContain(m["documents.purge.label.es"]);
    expect(text).toContain(m["documents.purge.mismatch.es"]);
    expect(text).toContain(m["documents.deleteForever.es"]);
    expect(text).toContain(m["documents.cancel.es"]);
  });
  it("a file with one version is not told it has versions; two or more are (review M11; mutation: always the plural body -> FAILS)", () => {
    expect(renderedText(form("", "en", false, 1))).toContain(m["documents.purge.bodyOne"].replace("{title}", "Lease"));
    expect(renderedText(form("", "en", false, 1))).not.toContain("versions");
    expect(renderedText(form("", "es", false, 1))).toContain(m["documents.purge.bodyOne.es"].replace("{title}", "Lease"));
    expect(renderedText(form("", "en", false, 3))).toContain(m["documents.purge.body"].replace("{title}", "Lease"));
  });
  it("the name box carries no language of its own, so a screen reader reads a title as typed (mutation: drop lang=\"\" -> FAILS)", () => {
    expect(form("")).toMatch(/<input[^>]*lang=""/);
  });
});
```

Why each can fail (checked while writing): `imageErrorStep`'s second and fourth expectations fail under "always retry"; the element's `onError` is compared by identity with the bounded handler, so `onError={onRetry}` fails it; the list's numbering, its Current row's missing button, its label class, its Spanish strings (compared against `m["….es"]`, filled by hand, never through `t()`) and its empty render each fail under the named mutation. Every copy assertion goes through `renderedText` (the purge body and label carry apostrophes). The disabled checks read the destructive button's own tag, so another element's `disabled` cannot satisfy them.

- [ ] **Step 2: Run red.** `pnpm --filter web exec vitest run "src/app/(dashboard)/dashboard/accounts/[accountId]/contacts/document-viewer.test.ts" "src/app/(dashboard)/dashboard/accounts/[accountId]/contacts/document-purge-dialog.test.ts"` → the new cases fail (missing exports; the purge test file cannot import). Paste the summary.

- [ ] **Step 3: Write the viewer.** In `document-viewer.tsx`:

Replace the module comment's last sentence (`:20`, "Versions arrive with PR 1b.") with: `Every ready version is listed, newest first, each older one offered for download (spec 4.3). A broken image re-mints its URL once on its own, then shows the error state (PR 1a review M7).`

After `viewerStateFor` (`:36`), add:

```ts
/**
 * A broken image (PR 1a review M7): the FIRST error for a version re-mints its URL once on its own (a
 * 120-second URL can expire between mint and paint); any later error is the viewer's error state, with
 * the Retry button the person presses. Never an endless loop of mints.
 */
export function imageErrorStep(versionId: string | null, autoRetriedFor: string | null): "retry" | "fail" {
  return versionId !== null && autoRetriedFor !== versionId ? "retry" : "fail";
}
```

Change `DocumentViewerBody`'s signature to take `onImageError: () => void` beside `onRetry`, and its image line (`:54`) to `onError={onImageError}`.

After `DocumentViewerBody`, add:

```tsx
/**
 * The Versions list (spec 4.3): every ready version, newest first, numbered by upload order (the newest
 * the highest); the current one says "Current" and has no Download of its own (the dialog's Download is
 * it); each older one has a ghost Download. Drawn only when there is more than one version.
 */
export function DocumentVersionsList({ doc, locale, when, onDownload }: {
  doc: DocumentView; locale: Locale; when: (addedOn: string) => string; onDownload: (versionId: string) => void;
}) {
  if (doc.versions.length < 2) return null;
  const tt = (key: MessageKey, params?: Record<string, string | number>) => t(m, key, locale, params);
  const total = doc.versions.length;
  return (
    <section data-document-versions aria-label={tt("documents.versions")}>
      <h3 className="mb-1 font-mono text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground">{tt("documents.versions")}</h3>
      <ul>
        {doc.versions.map((v, i) => {
          const n = total - i;
          return (
            <li key={v.id} data-document-version-row={v.id}
              className="flex items-center justify-between gap-2 border-t border-[var(--row-line)] py-1.5 text-sm first:border-t-0">
              <span className="tabular-nums">{tt("documents.versionLine", { n, when: when(v.addedOn) })}</span>
              {v.id === doc.version.id ? (
                <span className="text-xs text-muted-foreground">{tt("documents.versionCurrent")}</span>
              ) : (
                <Button type="button" variant="ghost" size="sm" className="min-h-11 md:min-h-8"
                  aria-label={tt("documents.downloadVersion", { n })} onClick={() => onDownload(v.id)}>{tt("documents.download")}</Button>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
```

In `DocumentViewer`: add the two props `versionWhen` and `onDownloadVersion` to its parameter type (Interfaces block), add the state and handler after `const mint = …` (`:85`):

```tsx
  // M7: the version whose ONE automatic retry has been spent. Set in an event handler (the image's
  // onError), never in an effect.
  const [autoRetriedFor, setAutoRetriedFor] = useState<string | null>(null);
  const onImageError = () => {
    if (imageErrorStep(versionId, autoRetriedFor) === "retry") {
      setAutoRetriedFor(versionId);
      mint();
    } else if (fetchKey) {
      setResult({ key: fetchKey, value: { status: "error" } });
    }
  };
```

and render, in place of `<DocumentViewerBody doc={doc} state={state} locale={locale} onRetry={mint} />` (`:104`):

```tsx
            <DocumentViewerBody doc={doc} state={state} locale={locale} onRetry={mint} onImageError={onImageError} />
            <DocumentVersionsList doc={doc} locale={locale} when={versionWhen} onDownload={(id) => onDownloadVersion(doc, id)} />
```

(The dialog's own Download stays its one primary, `:105-107`.)

- [ ] **Step 4: Write `document-purge-dialog.tsx`:**

```tsx
"use client";

import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { Locale } from "@/lib/i18n/locale";
import { t } from "@/lib/i18n/t";
import { m, type MessageKey } from "@/lib/messages";
import type { DocumentView } from "@/lib/documents/documents-load";

/**
 * Delete forever (spec 4.4; DESIGN.md "Documents": only a typed name confirms a PERMANENT purge, and the
 * trash move never shares this confirmation). The name must be typed EXACTLY as stored (plan deviation
 * 8); the server checks it again. The dialog's one primary is the destructive button (rule 8).
 */
export function canPurge(typed: string, title: string): boolean {
  return typed === title;
}

const control = "min-h-11 md:min-h-8";

/** Presentational, so the styleguide can draw it inline and the test can read it without a portal. */
export function DocumentPurgeForm({ title, versionCount, typed, busy, locale, bodyId, onTyped, onCancel, onConfirm }: {
  title: string; versionCount: number; typed: string; busy: boolean; locale: Locale; bodyId?: string;
  onTyped: (v: string) => void; onCancel: () => void; onConfirm: () => void;
}) {
  const tt = (key: MessageKey, params?: Record<string, string | number>) => t(m, key, locale, params);
  const matches = canPurge(typed, title);
  const nearMiss = typed !== "" && !matches;
  return (
    <div data-document-purge-form className="space-y-3">
      {/* Review M11: "all of its versions" only when there is more than one. */}
      <p id={bodyId} className="text-sm text-muted-foreground">{tt(versionCount > 1 ? "documents.purge.body" : "documents.purge.bodyOne", { title })}</p>
      <label className="block space-y-1 text-sm">
        <span>{tt("documents.purge.label")}</span>
        <Input lang="" value={typed} autoComplete="off" spellCheck={false} aria-invalid={nearMiss}
          onChange={(e) => onTyped(e.target.value)} />
      </label>
      {nearMiss ? <p data-purge-mismatch className="text-xs text-muted-foreground">{tt("documents.purge.mismatch")}</p> : null}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" className={control} onClick={onCancel}>{tt("documents.cancel")}</Button>
        <Button type="button" variant="destructive" className={control} disabled={!matches || busy} onClick={onConfirm}>
          {tt("documents.deleteForever")}
        </Button>
      </div>
    </div>
  );
}

/** One open dialog per file: keyed by the file, so the typed name never carries over to another (no effect resets it). */
function PurgeBody({ doc, locale, bodyId, onClose, onConfirm }: {
  doc: DocumentView; locale: Locale; bodyId: string; onClose: () => void; onConfirm: (doc: DocumentView, typed: string) => Promise<boolean>;
}) {
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  // `onConfirm` answers true once the server has answered at all (review I2: a refusal also reloads the card and
  // closes, the toast says why); false only when nothing was sent (a click while a write is in flight).
  const confirm = () => {
    setBusy(true);
    void onConfirm(doc, typed).then((done) => { if (done) onClose(); else setBusy(false); }, () => setBusy(false));
  };
  return (
    <>
      <DialogHeader>
        <DialogTitle>{t(m, "documents.deleteForever", locale)}</DialogTitle>
      </DialogHeader>
      <DocumentPurgeForm title={doc.title} versionCount={doc.versions.length} typed={typed} busy={busy} locale={locale} bodyId={bodyId}
        onTyped={setTyped} onCancel={onClose} onConfirm={confirm} />
    </>
  );
}

export function DocumentPurgeDialog({ doc, locale, onClose, onConfirm }: {
  doc: DocumentView | null; locale: Locale; onClose: () => void; onConfirm: (doc: DocumentView, typed: string) => Promise<boolean>;
}) {
  // The body paragraph IS the dialog's description: DialogContent hands every prop to Radix's Content
  // (`components/ui/dialog.tsx:51-63`), so aria-describedby names it and no DialogDescription repeats it.
  const bodyId = useId();
  return (
    <Dialog open={doc !== null} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent data-document-purge-dialog aria-describedby={bodyId}>
        {doc ? <PurgeBody key={doc.id} doc={doc} locale={locale} bodyId={bodyId} onClose={onClose} onConfirm={onConfirm} /> : null}
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 5: Run green.** The Step 2 command → all pass. `pnpm --filter web typecheck` (remaining errors only in Task 8's files: the card passes no `versionWhen`/`onDownloadVersion` yet; list them); eslint on the four files → clean, including `react-hooks/set-state-in-effect` (no effect sets state).

- [ ] **Step 6: Probes, red BY NAME, restored.** (1) `imageErrorStep` returns `"retry"` always; (2) `onError={onRetry}`; (3) `const n = i + 1;`; (4) render the ghost Download on the current row too; (5) `return null` only when `doc.versions.length < 1`; (6) `canPurge` → `typed.trim().toLowerCase() === title.toLowerCase()`; (6b) always `documents.purge.body` → the one-version case fails; (7) drop `disabled={…}`; (8) `nearMiss = !matches`; (9) `variant="default"` on Cancel.

- [ ] **Step 7: Commit.** `git add -- "apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/contacts/document-purge-dialog.tsx" "apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/contacts/document-purge-dialog.test.ts"` then `git commit -m "feat(documents): the viewer's Versions list and one automatic image retry; the typed-name purge dialog (S-07 part 1b)" -- <the four paths>`.

---

## Task 8: The card, its handlers, and `/styleguide` (bis-frontend)

**Review:** opus. **After:** Tasks 4, 5, 6 and 7.

**Files**
- Modify: `…/contacts/documents-card-handlers.ts` (imports `:6-8`; `DocumentHandlers` `:19-26`; the returned object `:51-92`) and its test
- Modify: `…/contacts/documents-card.tsx` (imports `:1-25`; `rowMenuItems` `:88-94`; `DocumentRow` `:125-212`; `DocumentsCardView` `:237-323`; `DocumentsCard` `:332-434`; two new exports) and its test
- Modify: `apps/web/src/app/(dashboard)/dashboard/styleguide/documents-demo.tsx` and `documents-demo.test.ts`

**Interfaces**
- Consumes: `uploadVersion`, `browserVersionDeps`, `UploadPhase` (Task 6); `DocumentViewer` with `versionWhen`/`onDownloadVersion`, `DocumentVersionsList`, `DocumentPurgeDialog`, `DocumentPurgeForm` (Task 7); `spaceUsedText`, `DocumentsSpace` (Task 5); `DocumentView.versions`, `DocumentsResponse.space` (Task 5); `purgeDocumentAction`, `updateDocumentFieldAction`, `undoDocumentFieldAction`, `getDocumentUrlAction`, `type DocumentUndo` (Task 4 / PR 1a).
- Produces:

```ts
// documents-card-handlers.ts
export type FieldSave = { ok: true; undoPayload: DocumentUndo; shown: string } | { ok: false; error: string };
export type DocumentHandlers = {
  trash(doc: DocumentView): Promise<void>;
  restore(doc: DocumentView): Promise<void>;
  setOwnersOnly(doc: DocumentView, value: boolean): Promise<void>;
  download(doc: DocumentView, versionId?: string): Promise<void>;
  saveField(doc: DocumentView, field: DocumentUndo["field"], value: string): Promise<FieldSave>;
  undoField(payload: unknown): Promise<{ ok: true } | { ok: false; error: string }>;
  purge(doc: DocumentView, typed: string): Promise<boolean>;   // true once the server answered, gone or refused (review I2); false when nothing was sent
  changed(): void;
};
// documents-card.tsx
export type RowMenuItem = { id: "edit" | "ownersOnly" | "newVersion" | "download" | "trash"; labelKey: MessageKey };
export function rowSavers(doc: DocumentView, handlers: Pick<DocumentHandlers, "saveField" | "undoField">): {
  save: (field: DocumentUndo["field"]) => (value: string) => Promise<FieldSave>; undoWith: (payload: unknown) => Promise<{ ok: true } | { ok: false; error: string }>;
};
export function versionToast(end: UploadPhase, title: string, locale: Locale): { ok: boolean; text: string } | null;
// DocumentsCardView gains three props: versionPhases: Readonly<Record<string, UploadPhase>>; onNewVersion(doc); onPurge(doc).
// styleguide/documents-demo.tsx
export const demoHandlers: DocumentHandlers;   // inert: never calls a server action (PR 1a review M6)
```

- [ ] **Step 1: Write the failing tests.**

**`documents-card-handlers.test.ts`.** Add `updateDocumentFieldAction: vi.fn(), undoDocumentFieldAction: vi.fn(), purgeDocumentAction: vi.fn(),` to the hoisted `actions` object (`:5-8`); give `DOC` (`:13-17`) `versions: [{ id: "v1", contentType: "application/pdf" as const, bytes: 1, createdAt: "2026-10-01T00:00:00Z", addedOn: "2026-09-30" }], purging: false,`; change the first Download case's mocked error (`:139`) to `"documents.error.fileNotFound"` and its expectation (`:146`) to `m["documents.error.fileNotFound.es"]`; append:

```ts
describe("inline edits go through the handlers (PR 1a review M6: the styleguide injects inert ones)", () => {
  it("a save answers InlineField's shape and re-reads the card; its Undo payload is the server's own (mutation: drop reload on success -> FAILS)", async () => {
    const reload = vi.fn();
    const undoPayload = { documentId: "d1", field: "title", prior: "Lease", written: "New lease" };
    actions.updateDocumentFieldAction.mockResolvedValue({ ok: true, shown: "New lease", undoPayload });
    const h = documentHandlers({ accountId: "acc", locale: "en", reload });
    expect(await h.saveField(DOC, "title", "New lease")).toEqual({ ok: true, undoPayload, shown: "New lease" });
    expect(actions.updateDocumentFieldAction).toHaveBeenCalledWith("acc", "d1", "title", "New lease");
    expect(reload).toHaveBeenCalledTimes(1);
  });
  it("a refused save is the reader's own words, with its params, and re-reads nothing (mutation: answer the raw key -> FAILS)", async () => {
    const reload = vi.fn();
    actions.updateDocumentFieldAction.mockResolvedValue({ ok: false, error: "documents.error.tooLarge", params: { size: "31 MB" } });
    const h = documentHandlers({ accountId: "acc", locale: "es", reload });
    expect(await h.saveField(DOC, "title", "x")).toEqual({ ok: false, error: m["documents.error.tooLarge.es"].replace("{size}", "31 MB") });
    expect(reload).not.toHaveBeenCalled();
  });
  it("an Undo someone beat says so in the reader's language (mutation: swallow the error -> FAILS)", async () => {
    actions.undoDocumentFieldAction.mockResolvedValue({ ok: false, error: "documents.undoChanged" });
    const h = documentHandlers({ accountId: "acc", locale: "es", reload: vi.fn() });
    expect(await h.undoField({ any: "payload" })).toEqual({ ok: false, error: m["documents.undoChanged.es"] });
    expect(actions.undoDocumentFieldAction).toHaveBeenCalledWith("acc", { any: "payload" });
  });
  it("a save that throws (a stale tab) is the plain failure, never a crash (mutation: drop the .catch -> FAILS)", async () => {
    actions.updateDocumentFieldAction.mockRejectedValue(new Error("stale"));
    const h = documentHandlers({ accountId: "acc", locale: "en", reload: vi.fn() });
    expect(await h.saveField(DOC, "title", "x")).toEqual({ ok: false, error: m["documents.error.failed"] });
  });
});

describe("Delete forever (spec 4.4; rule 6)", () => {
  it("gone for good: a plain success toast with NO Undo, a re-read, and true so the dialog closes (mutation: offer an Undo -> FAILS)", async () => {
    const reload = vi.fn();
    actions.purgeDocumentAction.mockResolvedValue({ ok: true });
    const h = documentHandlers({ accountId: "acc", locale: "en", reload });
    expect(await h.purge(DOC, "Lease")).toBe(true);
    expect(actions.purgeDocumentAction).toHaveBeenCalledWith("acc", "d1", "Lease");
    expect(toast.success.mock.calls).toEqual([["Lease was deleted for good."]]);
    expect(reload).toHaveBeenCalledTimes(1);
  });
  it("Spanish success words are the Spanish catalogue's (mutation: an English toast in es -> FAILS)", async () => {
    actions.purgeDocumentAction.mockResolvedValue({ ok: true });
    await documentHandlers({ accountId: "acc", locale: "es", reload: vi.fn() }).purge(DOC, "Lease");
    expect(toast.success.mock.calls).toEqual([[m["documents.purged.es"].replace("{title}", "Lease")]]);
  });
  it("a server mismatch means the title changed underneath (the button only enables on the card's own title): it says why, re-reads, and closes (review I2; mutation: no reload on a mismatch -> FAILS)", async () => {
    const reload = vi.fn();
    actions.purgeDocumentAction.mockResolvedValue({ ok: false, error: "documents.purge.mismatch" });
    expect(await documentHandlers({ accountId: "acc", locale: "es", reload }).purge(DOC, "Lease")).toBe(true);
    expect(toast.error).toHaveBeenCalledWith(m["documents.purge.mismatch.es"]);
    expect(reload).toHaveBeenCalledTimes(1);
  });
  it("any refusal (changed, in flight, not an Owner) says so, re-reads and closes, never a silent no-op (review I2; mutation: return false on a refusal -> FAILS)", async () => {
    const reload = vi.fn();
    actions.purgeDocumentAction.mockResolvedValue({ ok: false, error: "documents.error.purgeChanged" });
    expect(await documentHandlers({ accountId: "acc", locale: "en", reload }).purge(DOC, "Lease")).toBe(true);
    expect(toast.error).toHaveBeenCalledWith(m["documents.error.purgeChanged"]);
    expect(reload).toHaveBeenCalledTimes(1);
  });
  it("a second click while the purge is in flight sends nothing and keeps the dialog (mutation: drop the once() guard -> FAILS)", async () => {
    let finish!: (v: { ok: true }) => void;
    actions.purgeDocumentAction.mockReturnValue(new Promise((r) => { finish = r; }));
    const h = documentHandlers({ accountId: "acc", locale: "en", reload: vi.fn(), inFlight: new Set() });
    const first = h.purge(DOC, "Lease");
    expect(await h.purge(DOC, "Lease")).toBe(false);
    finish({ ok: true });
    expect(await first).toBe(true);
    expect(actions.purgeDocumentAction).toHaveBeenCalledTimes(1);
  });
  it("a purge that throws is the purge failure, in words (mutation: drop the .catch -> FAILS)", async () => {
    actions.purgeDocumentAction.mockRejectedValue(new Error("stale"));
    expect(await documentHandlers({ accountId: "acc", locale: "en", reload: vi.fn() }).purge(DOC, "Lease")).toBe(true);
    expect(toast.error).toHaveBeenCalledWith(m["documents.error.purge"]);
  });
});

describe("Download of an older version (spec 4.3)", () => {
  it("mints the named version, not the current one (mutation: ignore versionId -> FAILS)", async () => {
    actions.getDocumentUrlAction.mockResolvedValue({ ok: true, url: "https://files.example/old", contentType: "application/pdf" });
    const assign = vi.fn();
    vi.stubGlobal("window", { location: { assign } });
    try {
      await documentHandlers({ accountId: "acc", locale: "en", reload: vi.fn() }).download(DOC, "v0");
      expect(actions.getDocumentUrlAction).toHaveBeenCalledWith("acc", "v0", "download");
      expect(assign).toHaveBeenCalledWith("https://files.example/old");
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
```

**`documents-card.test.ts`.** In the actions mock factory (`:5-9`) add `startDocumentVersionUploadAction: vi.fn(), purgeDocumentAction: vi.fn(),`; extend the import at `:12` with `rowSavers, versionToast`; give `view()` (`:15-19`) a `versions` array of its one version (`[{ id: "v1", contentType: "application/pdf", bytes: 1200, createdAt: "2026-10-10T15:00:00.000Z", addedOn: "2026-10-10" }]`) and `purging: false`, both before `...over`; give `ready()` (`:20-21`) a fourth parameter `space: { used: number; quota: number } | null = null` and put `space` into `data`; add `saveField: vi.fn(), undoField: vi.fn(), purge: vi.fn(),` to `handlers` (`:22`); add `versionPhases: {}, onNewVersion: vi.fn(), onPurge: vi.fn(),` to `render`'s defaults (`:23-26`). Replace the `rowMenuItems` case (`:171-177`) with:

```ts
  it("the row menu: Upload new version for everyone who sees the file, Owners only for an Owner only, in the spec's order (mutations: drop newVersion; drop the canManage guard -> FAILS)", () => {
    expect(rowMenuItems(view() as never, false).map((i) => i.id)).toEqual(["edit", "newVersion", "download", "trash"]);
    expect(rowMenuItems(view() as never, true).map((i) => [i.id, i.labelKey])).toEqual([
      ["edit", "documents.edit"], ["ownersOnly", "documents.makeOwnersOnly"], ["newVersion", "documents.newVersion"],
      ["download", "documents.download"], ["trash", "documents.trash"]]);
    expect(rowMenuItems(view({ ownersOnly: true }) as never, true).find((i) => i.id === "ownersOnly")!.labelKey).toBe("documents.makeTeam");
  });
```

and append to the file:

```ts
describe("versions, Delete forever and the space line on the card (PR 1b)", () => {
  const GIB = 1_073_741_824;
  const three = [
    { id: "v3", contentType: "application/pdf", bytes: 30, createdAt: "2026-10-12T15:00:00.000Z", addedOn: "2026-10-12" },
    { id: "v2", contentType: "application/pdf", bytes: 20, createdAt: "2026-10-11T15:00:00.000Z", addedOn: "2026-10-11" },
    { id: "v1", contentType: "application/pdf", bytes: 10, createdAt: "2026-10-10T15:00:00.000Z", addedOn: "2026-10-10" },
  ];
  it("'Version 3' on a row with three ready versions, nothing on a row with one, in both languages (mutation: show it from one version -> FAILS)", () => {
    const multi = view({ version: { id: "v3", contentType: "application/pdf", bytes: 30 }, versions: three });
    const html = render(ready([multi, view({ id: "d2", title: "Roof" })]));
    expect(rowOf(html, "d1")).toContain("data-document-version");
    expect(renderedText(rowOf(html, "d1"))).toContain("Version 3");
    expect(rowOf(html, "d2")).not.toContain("data-document-version");
    const es = render(ready([multi]), { locale: "es", emptyText: m["documents.empty.contact.es"] });
    expect(renderedText(rowOf(es, "d1"))).toContain(m["documents.version.es"].replace("{n}", "3"));
  });
  it("a new version on its way shows its progress on its own row only (mutation: never draw the phase -> FAILS)", () => {
    const html = render(ready([view(), view({ id: "d2", title: "Roof" })]), { versionPhases: { d1: { kind: "uploading", percent: 45 } } });
    expect(renderedText(rowOf(html, "d1"))).toContain(m["documents.progress.uploading"].replace("{percent}", "45"));
    expect(rowOf(html, "d2")).not.toContain("data-version-progress");
    const checking = render(ready([view()]), { versionPhases: { d1: { kind: "checking" } }, locale: "es", emptyText: m["documents.empty.contact.es"] });
    expect(renderedText(rowOf(checking, "d1"))).toContain(m["documents.progress.checking.es"]);
  });
  it("each trashed file offers Delete forever as a ghost beside Restore; the card still has ONE primary (rule 6, rule 8; mutation: make Delete forever default -> FAILS)", () => {
    const html = render(ready([view()], [view({ id: "t1", title: "Old ID", deletedAt: "2026-10-10T15:00:00.000Z" })]));
    const trashed = html.slice(html.indexOf('data-document-trashed="t1"'));
    expect(/<button[^>]*data-document-purge[^>]*>/.exec(trashed)![0]).toContain('data-variant="ghost"');
    expect(renderedText(trashed)).toContain(m["documents.deleteForever"]);
    expect(renderedText(trashed)).toContain(m["documents.restore"]);
    expect(html.match(/data-variant="default"/g)).toHaveLength(1);
    const es = render(ready([view()], [view({ id: "t1", deletedAt: "2026-10-10T15:00:00.000Z" })]), { locale: "es", emptyText: m["documents.empty.contact.es"] });
    expect(renderedText(es)).toContain(m["documents.deleteForever.es"]);
  });
  it("a file whose Delete forever stopped part-way shows 'Being deleted' as a dot and a word, no Restore, and an Owner keeps Delete forever to finish it (review m1; mutation: ignore purging and draw Restore -> FAILS)", () => {
    const html = render(ready([view()], [view({ id: "t1", title: "Old ID", deletedAt: "2026-10-10T15:00:00.000Z", purging: true })]));
    const trashed = html.slice(html.indexOf('data-document-trashed="t1"'));
    expect(trashed).not.toContain("data-document-restore");
    expect(trashed).toMatch(/data-document-purging[^>]*><span aria-hidden="true"[^>]*><\/span>/);
    expect(renderedText(trashed)).toContain(m["documents.status.purging"]);
    expect(trashed).toContain("data-document-purge");
    const es = render(ready([view()], [view({ id: "t1", deletedAt: "2026-10-10T15:00:00.000Z", purging: true })]), { locale: "es", emptyText: m["documents.empty.contact.es"] });
    expect(renderedText(es)).toContain(m["documents.status.purging.es"]);
    // A trashed file with no purge begun keeps its Restore.
    expect(render(ready([view()], [view({ id: "t2", deletedAt: "2026-10-10T15:00:00.000Z" })]))).toContain("data-document-restore");
  });
  it("Staff and Technicians see the trashed file and Restore, but no Delete forever (owner ruling R1; mutation: draw it for everyone -> FAILS)", () => {
    const html = render(ready([view()], [view({ id: "t1", title: "Old ID", deletedAt: "2026-10-10T15:00:00.000Z" })]), { canManage: false });
    expect(html).toContain('data-document-trashed="t1"');
    expect(html).toContain("data-document-restore");
    expect(html).not.toContain("data-document-purge");
  });
  it("the space line shows above 80% of the quota only, in both languages, and adds no primary (spec 4.2 item 4; mutation: always draw it -> FAILS)", () => {
    const over = render(ready([view()], [], false, { used: 4_500_000_000, quota: 5 * GIB }));
    expect(over).toContain("data-space-used");
    expect(renderedText(over)).toContain("4.1 of 5 GB used");
    expect(over.match(/data-variant="default"/g)).toHaveLength(1);
    expect(render(ready([view()], [], false, { used: 4 * GIB, quota: 5 * GIB }))).not.toContain("data-space-used");
    expect(render(ready([view()]))).not.toContain("data-space-used");
    const es = render(ready([view()], [], false, { used: 4_500_000_000, quota: 5 * GIB }), { locale: "es", emptyText: m["documents.empty.contact.es"] });
    expect(renderedText(es)).toContain(m["documents.spaceUsed.es"].replace("{used}", "4.1").replace("{quota}", "5"));
  });
  it("a row's inline edits reach the HANDLERS, never a server action directly (PR 1a review M6; mutation: rowSavers calls updateDocumentFieldAction -> FAILS)", async () => {
    const actions = await import("./documents-actions");
    const h = { saveField: vi.fn(async () => ({ ok: true as const, undoPayload: { documentId: "d1", field: "title" as const, prior: "a", written: "b" }, shown: "b" })),
      undoField: vi.fn(async () => ({ ok: true as const })) };
    const doc = view() as never;
    const s = rowSavers(doc, h);
    await s.save("title")("b");
    await s.undoWith({ p: 1 });
    expect(h.saveField).toHaveBeenCalledWith(doc, "title", "b");
    expect(h.undoField).toHaveBeenCalledWith({ p: 1 });
    expect(actions.updateDocumentFieldAction).not.toHaveBeenCalled();
    expect(actions.undoDocumentFieldAction).not.toHaveBeenCalled();
  });
  it("the new-version toast: success words, or the refusal in the reader's language with its params; nothing mid-way (mutation: drop params -> FAILS)", () => {
    expect(versionToast({ kind: "done" }, "Lease", "en")).toEqual({ ok: true, text: "New version of Lease added." });
    expect(versionToast({ kind: "done" }, "Lease", "es")).toEqual({ ok: true, text: m["documents.versionAdded.es"].replace("{title}", "Lease") });
    expect(versionToast({ kind: "failed", error: "documents.error.tooLarge", params: { size: "31 MB" } }, "Lease", "es"))
      .toEqual({ ok: false, text: m["documents.error.tooLarge.es"].replace("{size}", "31 MB") });
    expect(versionToast({ kind: "uploading", percent: 10 }, "Lease", "en")).toBeNull();
  });
});
```

**`documents-demo.test.ts`.** In its actions mock factory (`:5-9`) add `startDocumentVersionUploadAction: vi.fn(), purgeDocumentAction: vi.fn(),`; import `demoHandlers` beside `DocumentsDemo`; import the mocked module (`const actions = await import("../accounts/[accountId]/contacts/documents-actions");`); append to the describe:

```ts
  it("shows PR 1b's states: 'Version 2' on each loaded card, the space line where the account is above 80%, a version uploading, Delete forever in each trash, the Versions list and the typed-name form (mutation: drop a state -> FAILS)", () => {
    expect(html.match(/data-document-version(?=[\s>=])/g)).toHaveLength(3);
    expect(html.match(/data-space-used/g)).toHaveLength(3);
    expect(html.match(/data-version-progress/g)).toHaveLength(1);
    expect(html.match(/data-document-purge(?=[\s>=])/g)).toHaveLength(3);
    expect(html).toContain("data-document-versions");
    expect(html).toContain("data-document-purge-form");
    expect(text).toContain(m["documents.purge.mismatch"]);
  });

  it("the demo's handlers are inert: none reaches a server action (PR 1a review M6; mutation: build demoHandlers from documentHandlers -> FAILS)", async () => {
    const doc = { id: "sg-1", title: "Signed contract" } as never;
    await demoHandlers.trash(doc);
    await demoHandlers.restore(doc);
    await demoHandlers.setOwnersOnly(doc, true);
    await demoHandlers.download(doc, "sg-v0");
    expect(await demoHandlers.saveField(doc, "title", "Renamed")).toMatchObject({ ok: true, shown: "Renamed" });
    expect(await demoHandlers.undoField({})).toEqual({ ok: true });
    expect(await demoHandlers.purge(doc, "Signed contract")).toBe(false);
    for (const fn of Object.values(actions)) if (vi.isMockFunction(fn)) expect(fn).not.toHaveBeenCalled();
  });
```

Why each can fail (checked while writing): the handler cases pin the reload count, the translated (not raw-key) refusal against `m["….es"]`, the exact `toast.success` call list (an Undo option adds a second argument), the reload-or-not split between a mismatch and a changed file, and the version id passed to the mint. The card cases read each row's own markup (`rowOf`) and compare Spanish against the catalogue; "ONE primary" is counted with the new controls present; `rowSavers` asserts the mocked actions stayed untouched; `versionToast`'s tooLarge case fails without params (the `{size}` placeholder stays). The demo's counts are per state, and its handler case fails the moment any handler reaches a mocked action.

- [ ] **Step 2: Run red.** `pnpm --filter web exec vitest run "src/app/(dashboard)/dashboard/accounts/[accountId]/contacts/documents-card.test.ts" "src/app/(dashboard)/dashboard/accounts/[accountId]/contacts/documents-card-handlers.test.ts" "src/app/(dashboard)/dashboard/styleguide/documents-demo.test.ts"` → the new cases fail by name. Paste the summary.

- [ ] **Step 3: The handlers.** In `documents-card-handlers.ts`:

Imports (`:6-8`):

```ts
import {
  trashDocumentAction, restoreDocumentAction, setOwnersOnlyAction, undoOwnersOnlyAction, getDocumentUrlAction,
  updateDocumentFieldAction, undoDocumentFieldAction, purgeDocumentAction, type DocumentUndo,
} from "./documents-actions";
```

Replace the type (`:19-26`) with the Interfaces block's `FieldSave` and `DocumentHandlers` (keep the module comment `:10-18`, adding one sentence: `Inline edits and Delete forever go through here too (PR 1a review M6), so the styleguide can inject handlers that never reach a server action.`).

Inside `documentHandlers`, after `say` (`:35`), add:

```ts
  const words = (a: { error: string; params?: Record<string, string | number> }) => tt(a.error, a.params);
```

and replace the returned object's `download` and `changed` entries (`:85-91`) with:

```ts
    async download(doc, versionId) {
      const r = await getDocumentUrlAction(accountId, versionId ?? doc.version.id, "download")
        .catch(() => ({ ok: false as const, error: "documents.error.open" }));
      if (!r.ok) { say(r); return; }
      window.location.assign(r.url);
    },
    async saveField(doc, field, value) {
      const r = await updateDocumentFieldAction(accountId, doc.id, field, value).catch(() => failed);
      if (!r.ok) return { ok: false, error: words(r) };
      reload();
      return { ok: true, undoPayload: r.undoPayload, shown: r.shown };
    },
    async undoField(payload) {
      const r = await undoDocumentFieldAction(accountId, payload).catch(() => failed);
      if (!r.ok) return { ok: false, error: words(r) };
      reload();
      return { ok: true };
    },
    async purge(doc, typed) {
      const r = await once(doc.id, () => purgeDocumentAction(accountId, doc.id, typed)
        .catch(() => ({ ok: false as const, error: "documents.error.purge" })));
      if (!r) return false;
      if (!r.ok) {
        // Review I2: every refusal re-reads and closes the dialog. The browser enables the button only on
        // the card's own title, so even a server mismatch means the file changed underneath (renamed,
        // restored, purged); the card must show the truth rather than keep a dialog about a stale file.
        say(r);
        reload();
        return true;
      }
      reload();
      // Gone for good: nothing to undo, so no Undo action (the typed name was the guard; rule 6).
      toast.success(tt("documents.purged", { title: doc.title }));
      return true;
    },
    changed: reload,
```

- [ ] **Step 4: The card.** In `documents-card.tsx`:

Imports: replace `:21-22` with

```ts
import { browserDeps, browserVersionDeps, uploadOne, uploadVersion, type UploadBatch, type UploadPhase } from "@/lib/documents/upload-client";
import { spaceUsedText } from "@/lib/documents/space";
import type { DocumentUndo } from "./documents-actions";
```

and add after `:25`: `import { DocumentPurgeDialog } from "./document-purge-dialog";` and change the handlers import (`:23`) to `import { documentHandlers, type DocumentHandlers, type FieldSave } from "./documents-card-handlers";`.

`rowMenuItems` (`:88-94`):

```ts
export type RowMenuItem = { id: "edit" | "ownersOnly" | "newVersion" | "download" | "trash"; labelKey: MessageKey };
export function rowMenuItems(doc: DocumentView, canManage: boolean): RowMenuItem[] {
  const items: RowMenuItem[] = [{ id: "edit", labelKey: "documents.edit" }];
  if (canManage) items.push({ id: "ownersOnly", labelKey: doc.ownersOnly ? "documents.makeTeam" : "documents.makeOwnersOnly" });
  items.push(
    { id: "newVersion", labelKey: "documents.newVersion" },
    { id: "download", labelKey: "documents.download" }, { id: "trash", labelKey: "documents.trash" });
  return items;
}

/** A row's inline-edit callbacks, through the handlers (PR 1a review M6): the card never calls an edit action itself. */
export function rowSavers(doc: DocumentView, handlers: Pick<DocumentHandlers, "saveField" | "undoField">): {
  save: (field: DocumentUndo["field"]) => (value: string) => Promise<FieldSave>;
  undoWith: (payload: unknown) => Promise<{ ok: true } | { ok: false; error: string }>;
} {
  return {
    save: (field) => (value) => handlers.saveField(doc, field, value),
    undoWith: (payload) => handlers.undoField(payload),
  };
}

/** What the card says when a new version's journey ends: its success, or the refusal in the reader's words. Nothing mid-way. */
export function versionToast(end: UploadPhase, title: string, locale: Locale): { ok: boolean; text: string } | null {
  if (end.kind === "done") return { ok: true, text: t(m, "documents.versionAdded", locale, { title }) };
  if (end.kind === "failed") return { ok: false, text: t(m, end.error as MessageKey, locale, end.params) };
  return null;
}
```

Replace `DocumentRow` (`:125-212`) with:

```tsx
function DocumentRow({ doc, today, canManage, locale, handlers, phase, onOpen, onNewVersion }: {
  doc: DocumentView; today: string; canManage: boolean; locale: Locale;
  handlers: DocumentHandlers; phase: UploadPhase | null; onOpen: (d: DocumentView) => void; onNewVersion: (d: DocumentView) => void;
}) {
  const tt = (key: MessageKey, params?: Params) => t(m, key, locale, params);
  const [editing, setEditing] = useState(false);
  // Every inline edit saves at once with an Undo (rule 6); the Undo is the server's own compare-and-set.
  const { save, undoWith } = rowSavers(doc, handlers);
  const choose = (item: RowMenuItem) => {
    if (item.id === "edit") setEditing((e) => !e);
    else if (item.id === "ownersOnly") void handlers.setOwnersOnly(doc, !doc.ownersOnly);
    else if (item.id === "newVersion") onNewVersion(doc);
    else if (item.id === "download") void handlers.download(doc);
    else void handlers.trash(doc);
  };
  const progress = phase?.kind === "uploading" ? tt("documents.progress.uploading", { percent: phase.percent })
    : phase?.kind === "checking" ? tt("documents.progress.checking") : null;
  return (
    <li data-document-row={doc.id}
      className={cn("relative rounded-[var(--radius-ctl)] hover:bg-[var(--surface-3)] motion-safe:transition-colors motion-safe:duration-150", rowLine)}>
      <div className="flex items-start gap-2 px-1 py-2">
        <FileText aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
        {/* The whole row opens the viewer (rule 4): the button's ::after is stretched over the row, and its ring is the row's. */}
        <button type="button" onClick={() => onOpen(doc)} aria-label={tt("documents.open", { title: doc.title })}
          className={cn(
            "min-w-0 flex-1 text-left outline-none",
            "after:absolute after:inset-0 after:rounded-[var(--radius-ctl)] after:content-['']",
            "focus-visible:after:ring-[3px] focus-visible:after:ring-ring/50",
          )}>
          <span lang="" className="block truncate text-sm font-medium text-card-foreground">{doc.title}</span>
          <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
            <span>{tt(`documents.category.${doc.category}` as MessageKey)}</span>
            <span aria-hidden="true">·</span>
            <span>{sourceLine(doc, today, locale)}</span>
            <ExpiryLine expiresOn={doc.expiresOn} today={today} locale={locale} />
            {doc.versions.length > 1 ? (
              <span data-document-version className="tabular-nums">{tt("documents.version", { n: doc.versions.length })}</span>
            ) : null}
            {doc.ownersOnly ? (
              <span data-owners-only className="inline-flex items-center gap-1">
                <Lock aria-hidden="true" className="size-3" />{tt("documents.ownersOnly")}
              </span>
            ) : null}
            {progress ? <span data-version-progress aria-live="polite" className="tabular-nums">{progress}</span> : null}
          </span>
        </button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button type="button" variant="ghost" size="icon-sm" className={cn("relative z-10", control)}
              aria-label={tt("documents.menu", { title: doc.title })}>
              <MoreHorizontal aria-hidden="true" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {rowMenuItems(doc, canManage).map((item) => (
              <DropdownMenuItem key={item.id} onSelect={() => choose(item)}>{tt(item.labelKey)}</DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      {editing ? (
        <dl data-document-edit className="relative z-10 grid grid-cols-[minmax(0,7rem)_1fr] gap-x-2 gap-y-1 px-1 pb-2 text-sm">
          <Line label={tt("documents.field.title")}>
            <InlineField key={`title:${doc.title}`} label={tt("documents.field.title")} value={doc.title}
              rule={{ kind: "text", max: DOCUMENT_TITLE_MAX, required: true }} locale={locale}
              save={save("title")} undoWith={undoWith} />
          </Line>
          <Line label={tt("documents.field.category")}>
            <InlineField key={`category:${doc.category}`} label={tt("documents.field.category")} value={doc.category}
              options={DOCUMENT_CATEGORIES.map((c) => ({ value: c, label: tt(`documents.category.${c}` as MessageKey) }))}
              locale={locale} save={save("category")} undoWith={undoWith} />
          </Line>
          <Line label={tt("documents.field.expires")}>
            <InlineField key={`expires:${doc.expiresOn ?? ""}`} label={tt("documents.field.expires")} value={doc.expiresOn}
              rule={{ kind: "date", required: false }} inputType="date" display="date" locale={locale}
              save={save("expires_on")} undoWith={undoWith} />
          </Line>
        </dl>
      ) : null}
    </li>
  );
}
```

In `DocumentsCardView` (`:237-323`):
- add to its props type: `versionPhases: Readonly<Record<string, UploadPhase>>; onNewVersion: (doc: DocumentView) => void; onPurge: (doc: DocumentView) => void;`
- after `const { data } = p.load;` (`:261`): `const spaceText = spaceUsedText(data.space, p.locale);`
- replace the count `<span>` (`:276-278`) with:

```tsx
        <div className="flex min-w-0 flex-col">
          <span className="text-xs text-muted-foreground tabular-nums">
            {plural(m, "documents.count", data.live.length, p.locale, { count: data.live.length })}
          </span>
          {spaceText ? <span data-space-used className="text-xs text-muted-foreground tabular-nums">{spaceText}</span> : null}
        </div>
```

- the row (`:296-297`): `<DocumentRow key={doc.id} doc={doc} today={data.today} canManage={p.canManage} locale={p.locale} handlers={p.handlers} phase={p.versionPhases[doc.id] ?? null} onOpen={p.onOpen} onNewVersion={p.onNewVersion} />`
- in the trash row (review m1): a file whose Delete forever began and did not finish (`doc.purging`) can never be restored (deviation 4), so its Restore button (`:314-315`) is replaced by the state as a dot and a word (rule 3):

```tsx
                {doc.purging ? (
                  <span data-document-purging className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                    <span aria-hidden="true" className="size-1.5 shrink-0 rounded-full bg-[var(--warn)]" />{tt("documents.status.purging")}
                  </span>
                ) : (
                  <Button type="button" variant="ghost" size="sm" data-document-restore className={control}
                    onClick={() => void p.handlers.restore(doc)}>{tt("documents.restore")}</Button>
                )}
```

- after it, for an Owner or the agency only (owner ruling R1; the server refuses anyone else too), Delete forever, which also finishes a purge that stopped part-way:

```tsx
                {p.canManage ? (
                  <Button type="button" variant="ghost" size="sm" data-document-purge className={control}
                    onClick={() => p.onPurge(doc)}>{tt("documents.deleteForever")}</Button>
                ) : null}
```

In `DocumentsCard` (`:332-434`), after `const onRetryFile = …` (`:407-410`), add:

```tsx
  // "Upload new version" (spec 4.1): the row menu opens ONE hidden single-file input; the chosen file goes
  // up under the card's one upload lock (a batch, a Retry and a new version never overlap), its progress on
  // its own row, and the card says how it ended.
  const versionInput = useRef<HTMLInputElement>(null);
  const versionTarget = useRef<DocumentView | null>(null);
  const [versionPhases, setVersionPhases] = useState<Record<string, UploadPhase>>({});
  const setVersionPhase = (id: string, phase: UploadPhase | null) => setVersionPhases((ps) => {
    const next = { ...ps };
    if (phase) next[id] = phase; else delete next[id];
    return next;
  });
  const onNewVersion = (doc: DocumentView) => {
    const refused = dropRefusal(lock.held, 1);
    if (refused) { toast.error(t(m, refused, locale)); return; }
    versionTarget.current = doc;
    versionInput.current?.click();
  };
  const onVersionFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    const doc = versionTarget.current;
    versionTarget.current = null;
    if (!file || !doc) return;
    // Review M10: a batch or a Retry may have taken the lock between the menu click and the file choice; say so.
    void locked(async () => {
      const end = await uploadVersion(accountId, doc.id, file, browserVersionDeps(), (ph) => setVersionPhase(doc.id, ph));
      setVersionPhase(doc.id, null);
      if (end.kind === "done") reload();
      const said = versionToast(end, doc.title, locale);
      if (said?.ok) toast.success(said.text);
      else if (said) toast.error(said.text);
    }).then((ran) => { if (ran === null) toast.error(t(m, "documents.error.busy", locale)); });
  };
  const [purging, setPurging] = useState<DocumentView | null>(null);
```

and replace the returned fragment (`:424-433`) with:

```tsx
  return (
    <>
      <DocumentsCardView accountId={accountId} load={load} canManage={canManage} emptyText={emptyText} locale={locale} handlers={handlers}
        onRetry={() => { setState({ route: "", load: { status: "loading" } }); reload(); }}
        onFiles={onFiles} onOpen={(d) => setOpenId(d.id)} panel={panel}
        versionPhases={versionPhases} onNewVersion={onNewVersion} onPurge={setPurging} />
      <input ref={versionInput} type="file" accept={ACCEPT} hidden data-version-input onChange={onVersionFile} />
      <DocumentViewer accountId={accountId} doc={open} locale={locale} onClose={() => setOpenId(null)}
        onDownload={(d) => void handlers.download(d)}
        onDownloadVersion={(d, versionId) => void handlers.download(d, versionId)}
        versionWhen={(day) => (ready ? addedWhen(day, ready.today, locale) : "")}
        header={{ source: open && ready ? sourceLine(open, ready.today, locale) : "", expiry: openExpiry ? expiryText(openExpiry, locale) : null }} />
      <DocumentPurgeDialog doc={purging} locale={locale} onClose={() => setPurging(null)} onConfirm={(d, typed) => handlers.purge(d, typed)} />
    </>
  );
```

(The old `import { updateDocumentFieldAction, undoDocumentFieldAction, type DocumentUndo } from "./documents-actions";` at `:22` is gone; the card no longer calls an edit action itself.)

- [ ] **Step 5: The styleguide.** In `documents-demo.tsx`:
- imports: add `import { addedWhen, type DocumentHandlers } from "../accounts/[accountId]/contacts/documents-card";` (alongside `DocumentsCardView`), `import { DocumentVersionsList } from "../accounts/[accountId]/contacts/document-viewer";`, `import { DocumentPurgeForm } from "../accounts/[accountId]/contacts/document-purge-dialog";`.
- `base` (`:17-20`): add `versions: [{ id: "sg-v", contentType: "application/pdf", bytes: 120_000, createdAt: "2026-10-10T15:00:00.000Z", addedOn: "2026-10-10" }], purging: false,`.
- `DATA.live[0]` (`sg-1`): add `versions: [{ id: "sg-v", contentType: "application/pdf", bytes: 120_000, createdAt: "2026-10-10T15:00:00.000Z", addedOn: "2026-10-10" }, { id: "sg-v0", contentType: "application/pdf", bytes: 98_000, createdAt: "2026-09-28T15:00:00.000Z", addedOn: "2026-09-28" }],` (so it reads "Version 2").
- `DATA.live[1]` (`sg-2`, the camera photo): add `versions: [{ id: "sg-v2", contentType: "image/jpeg", bytes: 800_000, createdAt: "2026-10-13T02:30:00.000Z", addedOn: "2026-10-12" }],` (its own version).
- `DATA`: add `space: { used: 4_500_000_000, quota: 5_368_709_120 },` (above 80%: the line shows). `EMPTY`: `{ ...DATA, live: [], trashed: [], space: null }`.
- replace `handlers` (`:35`) with the exported inert set, and `common` (`:36`):

```ts
/** Inert (PR 1a review M6): the styleguide never reaches a server action, however its rows are used. */
export const demoHandlers: DocumentHandlers = {
  trash: async () => {}, restore: async () => {}, setOwnersOnly: async () => {}, download: async () => {},
  saveField: async (doc, field, value) => ({ ok: true, undoPayload: { documentId: doc.id, field, prior: null, written: value }, shown: value }),
  undoField: async () => ({ ok: true }),
  purge: async () => false,
  changed: noop,
};
const common = {
  accountId: "sg", canManage: true, handlers: demoHandlers, onRetry: noop, onFiles: noop, onOpen: noop, panel: null,
  versionPhases: {}, onNewVersion: noop, onPurge: noop,
};
```

- the sixth card (panel open, `:60-62`): add `versionPhases={{ "sg-1": { kind: "uploading", percent: 60 } }}`.
- after it, two more boxes inside the grid:

```tsx
      <div className={box}>
        <DocumentVersionsList doc={DATA.live[0]!} locale="en" when={(day) => addedWhen(day, DATA.today, "en")} onDownload={noop} />
      </div>
      <div className={box}>
        <DocumentPurgeForm title="Old estimate" versionCount={1} typed="Old est" busy={false} locale="en" onTyped={noop} onCancel={noop} onConfirm={noop} />
      </div>
```

Update the module comment (`:8-16`): add "Each loaded card shows a contract on its second version, the account above 80% of its space, and Delete forever beside Restore in the trash; the panel card shows a new version uploading; then the viewer's Versions list and the typed-name form on their own."

- [ ] **Step 6: Run green.** The Step 2 command, plus `"src/app/(dashboard)/dashboard/accounts/[accountId]/contacts/document-viewer.test.ts" "src/app/(dashboard)/dashboard/accounts/[accountId]/contacts/document-purge-dialog.test.ts" src/lib/documents src/components/ui/material.test.ts src/lib/i18n/ratchet.test.ts` (the ratchet may fail ONLY on the baseline count until Task 9; say so). `pnpm --filter web typecheck` → clean (no errors anywhere now). eslint on every touched file → clean, including `react-hooks/set-state-in-effect`.

- [ ] **Step 7: Probes, red BY NAME, restored.** (1) `rowSavers`'s `save` → `updateDocumentFieldAction(…)` directly (import it) → the M6 card case fails; (2) `demoHandlers.saveField` → `documentHandlers({ accountId: "sg", locale: "en", reload: noop }).saveField(…)` → the demo's inert case fails; (3) offer an Undo on purge success (`offer(…)`) → the success case fails; (4) on a refusal, `return false` without `reload()` → both refusal cases fail; (4b) draw Delete forever without `p.canManage` → the R1 card case fails; (4b2) always draw Restore (ignore `doc.purging`) → the m1 card case fails; (4c) M10's `.then` has no unit test (a race between two user gestures is not reachable without a DOM); the reviewer checks it by reading; (5) `download`'s `versionId ?? doc.version.id` → `doc.version.id` → the older-version case fails; (6) `doc.versions.length > 0` for the row label → the one-version case fails; (7) `variant="default"` on Delete forever → the trash case fails; (8) drop `data.space` (pass `null` to `spaceUsedText`) → the space case fails; (9) in `versionToast`, drop `end.params` → its tooLarge case fails.

- [ ] **Step 8: Commit.** `git commit -m "feat(documents): Upload new version, Version N, Delete forever and the space line on the card; edits through the handlers; inert styleguide (S-07 part 1b)" -- "apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/contacts/documents-card.tsx" "apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/contacts/documents-card.test.ts" "apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/contacts/documents-card-handlers.ts" "apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/contacts/documents-card-handlers.test.ts" "apps/web/src/app/(dashboard)/dashboard/styleguide/documents-demo.tsx" "apps/web/src/app/(dashboard)/dashboard/styleguide/documents-demo.test.ts"`

---

## Task 9: Regenerate the i18n baselines (bis-crm)

**Review:** sonnet. **After:** Tasks 2, 3b, 4, 5, 6, 7 and 8 committed.

- [ ] **Step 1.** `pnpm --filter web exec tsx scripts/generate-i18n-baseline.ts` (the one command, `lib/i18n/ratchet.test.ts:1-9`).
- [ ] **Step 2.** `git diff --stat -- apps/web/src/lib/i18n/` shows only the two baseline files. In `ratchet-baseline.json`, no file's count rises and no NEW file appears with a nonzero count (`document-purge-dialog.tsx` and every changed `.tsx` carry no JSX literal copy); if one does, STOP and send it back to its task's owner rather than baselining it.
- [ ] **Step 3.** `pnpm --filter web exec vitest run src/lib/i18n src/lib/messages.test.ts` → PASS.
- [ ] **Step 4. Commit.** `git commit -m "chore(i18n): baselines after the document vault's 1b copy (S-07 part 1b)" -- apps/web/src/lib/i18n/catalogue-baseline.json apps/web/src/lib/i18n/ratchet-baseline.json`

---

## Task 10: The e2e spec (bis-e2e-qa)

**Review:** sonnet. **After:** Tasks 8 and 9. **Write only; the orchestrator runs it** (Task 12). Its own file and its own stamped contact, so `documents.spec.ts`'s file counts (its test 11 expects exactly 8 files) are untouched.

**Files**
- Create: `apps/web/e2e/documents-versions.spec.ts`

**Interfaces**
- Consumes: the per-run fixture account (`readClientFixture()`, `e2e/support.ts:103-111`); `recordPage` (`support.ts:132-134`); the card's hooks `[data-record-card="documents"] [data-documents-card]`, `[data-document-row]`, `[data-documents-panel]`, `[data-panel-file]` (PR 1a), and this PR's `[data-document-version]`, `[data-version-progress]`, `input[data-version-input]`, `[data-document-versions]`, `[data-document-version-row]`, `[data-documents-trash]`, `[data-document-trashed]`, `[data-document-purge-dialog]`, `[data-space-used]`; keys from Task 2.

- [ ] **Step 1: Write `apps/web/e2e/documents-versions.spec.ts`:**

```ts
import { test, expect, type Page } from "./fixtures/test";
import { readFileSync } from "node:fs";
import { config as loadEnv } from "dotenv";
import { serviceDb, createContact, DOCUMENT_BUCKET, DOCUMENT_QUOTA_BYTES } from "@bis/db";
import { m } from "../src/lib/messages";
import { readClientFixture, recordPage } from "./support";

loadEnv({ path: "apps/web/.env.local" });
loadEnv({ path: ".env.local" });

/**
 * The document vault, PR 1b (spec 6's "(PR 1b)" line, end to end): a new version and "Version 2", the
 * viewer's Versions list with an older version's own download, the account's usage on the card's read,
 * and Delete forever by the typed name. ON THE PER-RUN FIXTURE ACCOUNT ONLY, on one contact made here
 * with a stamped last name; never Test Client One. afterAll reads every document this file made (by the
 * contact), removes each version's object, deletes the rows, then the contact, checking every error,
 * and re-reads rows AND bucket folders to confirm none is left.
 *
 * SERIAL: test 1 uploads the file the others use; test 4 deletes it forever.
 */
test.describe.configure({ mode: "serial", timeout: 90_000 });

const STAMP = `DocsV${Date.now()}`;
const ACTOR = "e2e-documents-versions";
let accountId = "";
let contactId = "";
const db = () => serviceDb();
const made: string[] = [];

const fill = (s: string, params: Record<string, string | number>) =>
  Object.entries(params).reduce((acc, [k, v]) => acc.replaceAll(`{${k}}`, String(v)), s);
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** A minimal valid PDF whose comment line makes each upload's bytes (and size) its own. */
const pdf = (marker: string) => Buffer.from(
  `%PDF-1.4\n% ${marker}\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj 2 0 obj<</Type/Pages/Kids[]/Count 0>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n`, "binary");
const SIGNED_PUT = /\/storage\/v1\/object\/upload\/sign\/documents\//;

const card = (page: Page) => recordPage(page).locator('[data-record-card="documents"] [data-documents-card]');
const rowById = (page: Page, id: string) => card(page).locator(`[data-document-row="${id}"]`);
const panel = (page: Page) => card(page).locator("[data-documents-panel]");
const contactUrl = () => `/dashboard/accounts/${accountId}/contacts/${contactId}`;
const documentsRoute = () => `/api/accounts/${accountId}/contacts/${contactId}/documents`;
const toast = (page: Page, text: string) => page.locator("[data-sonner-toast]").filter({ hasText: text });

async function open(page: Page) {
  await page.goto(contactUrl());
  await expect(card(page).getByText(/^\d+ files?$/)).toBeVisible();
}
async function menu(page: Page, title: string, item: keyof typeof m) {
  await card(page).getByRole("button", { name: fill(m["documents.menu"], { title }), exact: true }).click();
  await page.getByRole("menuitem", { name: m[item], exact: true }).click();
}
async function docByTitle(title: string): Promise<{ id: string; current_version_id: string | null; deleted_at: string | null }> {
  const { data, error } = await db().from("documents").select("id, current_version_id, deleted_at")
    .eq("account_id", accountId).eq("contact_id", contactId).eq("title", title);
  if (error) throw new Error(`documents read: ${error.message}`);
  expect(data ?? [], `exactly one stored document titled "${title}"`).toHaveLength(1);
  return (data ?? [])[0] as { id: string; current_version_id: string | null; deleted_at: string | null };
}
async function versionsOf(documentId: string): Promise<{ id: string; status: string; storage_path: string; bytes: number }[]> {
  const { data, error } = await db().from("document_versions").select("id, status, storage_path, bytes, created_at")
    .eq("document_id", documentId).order("created_at", { ascending: true });
  if (error) throw new Error(`document_versions read: ${error.message}`);
  return ((data ?? []) as { id: string; status: string; storage_path: string; bytes: number }[]).map((v) => ({ ...v, bytes: Number(v.bytes) }));
}

test.beforeAll(async () => {
  const fixture = readClientFixture();
  if (!fixture) throw new Error("documents-versions.spec: no per-run fixture account (e2e/.auth/client-fixture.json). Run the full suite.");
  accountId = fixture.accountId;
  const c = await createContact(db(), accountId, { firstName: "Versions", lastName: STAMP }, ACTOR);
  if (c.existing) throw new Error("documents-versions.spec: the stamped contact matched an existing one; refusing to use (or delete) it.");
  contactId = c.id;
});

test.afterAll(async () => {
  if (!accountId || !contactId) return;
  const svc = db();
  const { data: docs, error } = await svc.from("documents").select("id").eq("account_id", accountId).eq("contact_id", contactId);
  if (error) throw new Error(`cleanup: documents read: ${error.message}`);
  const ids = (docs ?? []).map((d: { id: string }) => d.id);
  if (ids.length > 0) {
    const { data: versions, error: vErr } = await svc.from("document_versions").select("storage_path").in("document_id", ids);
    if (vErr) throw new Error(`cleanup: versions read: ${vErr.message}`);
    const paths = (versions ?? []).map((v: { storage_path: string }) => v.storage_path);
    if (paths.length > 0) {
      const { error: rmErr } = await svc.storage.from(DOCUMENT_BUCKET).remove(paths);
      if (rmErr) throw new Error(`cleanup: objects remove: ${rmErr.message}`);
    }
    const { error: dErr } = await svc.from("documents").delete().in("id", ids);
    if (dErr) throw new Error(`cleanup: documents delete: ${dErr.message}`);
  }
  const { error: cErr } = await svc.from("contacts").delete().eq("account_id", accountId).eq("id", contactId);
  if (cErr) throw new Error(`cleanup: contact delete: ${cErr.message}`);
  const { data: leftDocs, error: lErr } = await svc.from("documents").select("id").eq("contact_id", contactId);
  if (lErr) throw new Error(`cleanup: re-read: ${lErr.message}`);
  expect(leftDocs ?? []).toEqual([]);
  for (const id of new Set([...ids, ...made])) {
    const { data: objects, error: listErr } = await svc.storage.from(DOCUMENT_BUCKET).list(`${accountId}/${id}`);
    if (listErr) throw new Error(`cleanup: bucket re-read ${id}: ${listErr.message}`);
    expect(objects ?? [], `no object left under ${accountId}/${id}`).toEqual([]);
  }
});

test("1. Upload new version from the row menu: progress on the row, then 'Version 2'; the new version is current and the first stays; it has its own timeline row", async ({ page }) => {
  await open(page);
  await card(page).locator('input[type="file"][multiple]').setInputFiles([{ name: "Estimate.pdf", mimeType: "application/pdf", buffer: pdf("first") }]);
  await panel(page).getByRole("button", { name: m["documents.upload"], exact: true }).click();
  await expect(card(page).locator("[data-document-row]")).toHaveCount(1, { timeout: 30_000 });
  const doc = await docByTitle("Estimate");
  made.push(doc.id);
  // One version: no label (mutation: show "Version 1" -> FAILS).
  await expect(rowById(page, doc.id).locator("[data-document-version]")).toHaveCount(0);

  // Hold the PUT until the row's progress line has been seen (mutation: never draw the phase -> FAILS).
  let release!: () => void;
  const gate = new Promise<void>((r) => { release = r; });
  await page.route(SIGNED_PUT, async (route) => {
    if (route.request().method() === "PUT") await gate;
    await route.continue();
  });
  // Assumption B3: the menu item's select opens the hidden input's file chooser.
  const chooser = page.waitForEvent("filechooser");
  await menu(page, "Estimate", "documents.newVersion");
  await (await chooser).setFiles({ name: "Estimate rev.pdf", mimeType: "application/pdf", buffer: pdf("second, a longer one") });
  const uploading = new RegExp(escapeRe(m["documents.progress.uploading"]).replace(escapeRe("{percent}"), "\\d{1,3}"));
  await expect(rowById(page, doc.id).locator("[data-version-progress]")).toHaveText(uploading);
  release();

  await expect(toast(page, fill(m["documents.versionAdded"], { title: "Estimate" }))).toBeVisible({ timeout: 30_000 });
  await expect(rowById(page, doc.id).locator("[data-document-version]")).toHaveText(fill(m["documents.version"], { n: 2 }));
  await expect(rowById(page, doc.id).locator("[data-version-progress]")).toHaveCount(0);
  // Still ONE file on the card: a version is not a file (mutation: start a new document -> "2 files" -> FAILS).
  await expect(card(page).getByText(fill(m["documents.countOne"], { count: 1 }), { exact: true })).toBeVisible();
  const versions = await versionsOf(doc.id);
  expect(versions.map((v) => v.status)).toEqual(["ready", "ready"]);
  expect((await docByTitle("Estimate")).current_version_id).toBe(versions[1]!.id);
  expect(versions[1]!.bytes).toBe(pdf("second, a longer one").length);
  // Owner ruling R2: the new version is its own timeline row, with the person mark, read under RLS through
  // 0078's view (Assumption B6's PostgREST half). Mutation: drop the version read -> no row -> FAILS.
  await page.reload();
  const versionRow = recordPage(page).locator('[data-timeline-item="documentVersion"]');
  await expect(versionRow).toHaveCount(1);
  await expect(versionRow).toContainText(fill(m["timeline.documentVersion"], { title: "Estimate" }));
});

test("2. the viewer's Versions list: newest first, the current one marked, the older one downloads its OWN bytes", async ({ page }) => {
  await open(page);
  const doc = await docByTitle("Estimate");
  const [v1, v2] = await versionsOf(doc.id);
  await rowById(page, doc.id).click({ position: { x: 10, y: 10 } });
  const viewer = page.locator("[data-document-viewer]");
  const list = viewer.locator("[data-document-versions]");
  const rowsInList = list.locator("[data-document-version-row]");
  await expect(rowsInList).toHaveCount(2);
  await expect(rowsInList.first()).toHaveAttribute("data-document-version-row", v2!.id);
  await expect(list.locator(`[data-document-version-row="${v2!.id}"]`)).toContainText(m["documents.versionCurrent"]);
  await expect(list.locator(`[data-document-version-row="${v2!.id}"]`).getByRole("button")).toHaveCount(0);

  const download = page.waitForEvent("download");
  await list.getByRole("button", { name: fill(m["documents.downloadVersion"], { n: 1 }), exact: true }).click();
  const file = await download;
  // A signed URL on the OLDER version's own object (mutation: download ignores the version id -> v2's path -> FAILS).
  expect(file.url()).toMatch(new RegExp(`/storage/v1/object/sign/documents/${accountId}/${doc.id}/${v1!.id}\\?`));
  expect(readFileSync((await file.path())!).toString("binary")).toContain("% first");
  await page.keyboard.press("Escape");
  await expect(viewer).toHaveCount(0);
});

test("3. the card's read carries the account's usage by the quota's rule; far below 80% the card draws no line", async ({ page }) => {
  const response = page.waitForResponse((r) => new URL(r.url()).pathname === documentsRoute() && r.request().method() === "GET");
  await open(page);
  const body = (await (await response).json()) as { space: { used: number; quota: number } | null };
  const doc = await docByTitle("Estimate");
  const mine = (await versionsOf(doc.id)).reduce((n, v) => n + v.bytes, 0);
  // Assumption B2 and 0078 on the CI stack: a safe integer, at least this contact's two versions (other
  // specs share the fixture account, so the exact total is not this file's to know), against 5 GB.
  expect(body.space).not.toBeNull();
  expect(Number.isSafeInteger(body.space!.used)).toBe(true);
  expect(body.space!.used).toBeGreaterThanOrEqual(mine);
  expect(body.space!.quota).toBe(DOCUMENT_QUOTA_BYTES);
  await expect(card(page).locator("[data-space-used]")).toHaveCount(0);
});

test("4. Delete forever: the trash move asks nothing; only the exact name confirms; objects, rows and one purge event", async ({ page }) => {
  await open(page);
  const doc = await docByTitle("Estimate");
  const versions = await versionsOf(doc.id);
  expect(versions).toHaveLength(2);

  await menu(page, "Estimate", "documents.trash");
  await expect(rowById(page, doc.id)).toHaveCount(0);
  await expect(toast(page, fill(m["documents.trashed"], { title: "Estimate" }))).toBeVisible();
  // Rule 6 (review I3: checked only once the move has visibly happened, so a dialog that opens late cannot
  // slip past): the move is immediate with an Undo, never a dialog (mutation: open the purge dialog on trash -> FAILS).
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const trash = card(page).locator("[data-documents-trash]");
  await trash.locator("summary").click();
  await trash.locator(`[data-document-trashed="${doc.id}"]`).getByRole("button", { name: m["documents.deleteForever"], exact: true }).click();

  const dialog = page.locator("[data-document-purge-dialog]");
  await expect(dialog).toBeVisible();
  const confirm = dialog.getByRole("button", { name: m["documents.deleteForever"], exact: true });
  const box = dialog.getByRole("textbox");
  await expect(confirm).toBeDisabled();
  await box.fill("estimate");
  // Mutation: compare case-folded -> the button enables on "estimate" -> FAILS.
  await expect(confirm).toBeDisabled();
  await expect(dialog).toContainText(m["documents.purge.mismatch"]);
  await box.fill("Estimate");
  await expect(confirm).toBeEnabled();
  await confirm.click();

  await expect(toast(page, fill(m["documents.purged"], { title: "Estimate" }))).toBeVisible({ timeout: 30_000 });
  await expect(dialog).toHaveCount(0);
  await expect(trash).toHaveCount(0);
  // Rows gone, every version with them (mutation: delete only the current version's row -> FAILS).
  const { data: left, error } = await db().from("documents").select("id").eq("id", doc.id);
  if (error) throw new Error(`re-read: ${error.message}`);
  expect(left ?? []).toEqual([]);
  expect(await versionsOf(doc.id)).toEqual([]);
  // Objects gone, BOTH (mutation: remove only the current version's object -> the first still downloads -> FAILS).
  for (const v of versions) {
    const { data: blob } = await db().storage.from(DOCUMENT_BUCKET).download(v.storage_path);
    expect(blob, `object ${v.storage_path} is gone`).toBeNull();
  }
  // One purge event, the person's, naming the file and its customer only (mutation: emit as system -> FAILS).
  const { data: events, error: evErr } = await db().from("events").select("actor_type, payload")
    .eq("account_id", accountId).eq("type", "document.purged");
  if (evErr) throw new Error(`events read: ${evErr.message}`);
  const mine = (events ?? []).filter((e: { payload: { documentId?: string } }) => e.payload?.documentId === doc.id);
  expect(mine).toEqual([{ actor_type: "user", payload: { documentId: doc.id, contactId } }]);
});
```

- [ ] **Step 2: Check it loads.** From `<WT>/apps/web`: `pnpm exec playwright test --list e2e/documents-versions.spec.ts` → 4 tests listed under `chromium`, no error (listing loads and type-strips the file without running it). `pnpm exec eslint e2e/documents-versions.spec.ts` → clean. Do NOT run the tests (the orchestrator does, Task 12 step 4).
- [ ] **Step 3: Probes, written, not run.** In the report, beside each test, the mutation that fails it (the comments in the code) and which line asserts it. If Assumption B3 does not hold on the orchestrator's run (no `filechooser` event), the fallback is: choose the menu item, then `await recordPage(page).locator('[data-record-card="documents"] input[data-version-input]').setInputFiles(...)` (the input exists whether or not the chooser opened); the menu-to-input wiring is then proven only by the unit test's `rowMenuItems` and by hand on Preview, and the PR body says so.
- [ ] **Step 4: Commit.** `git add -- apps/web/e2e/documents-versions.spec.ts` then `git commit -m "test(e2e): new version, Versions list, the usage read and Delete forever by typed name, on the fixture account (S-07 part 1b)" -- apps/web/e2e/documents-versions.spec.ts`

---

## Task 11: Whole-branch final review (checkpoint, not an implementer task)

**Reviewer:** opus, fresh context. Runs after Tasks 1–10.

- [ ] **Step 1.** Read the spec end to end and this plan's Deviations, then `git diff 03f43736...HEAD` in `<WT>`; walk the coverage table below row by row against the diff.
- [ ] **Step 2.** Web tests by path: every test file Tasks 2, 3b and 4–8 touched, plus `src/lib/i18n/ratchet.test.ts`, `src/lib/messages.test.ts`, `src/components/ui/material.test.ts`, `"src/app/(dashboard)/dashboard/accounts/[accountId]/in-account-service-reads.test.ts"`; `pnpm --filter web typecheck`. The db suites on a replica of your own (the kit, ports `55548`/`55549`/`55550`): `document-space-used.test.ts`, `document-vault-schema.test.ts`, `document-vault-rls.test.ts`, `schema-grants-guard.test.ts` on `post`, and `documents.test.ts`, `record.test.ts`, `timeline-merge.test.ts` behind PostgREST. Re-run two probes of your own choosing, by name.
- [ ] **Step 3.** Hunt specifically: (a) a service call on a browser id not preceded by a request-client read of that document (the two new actions, and the finish's new trash branch); (b) a `serviceDb` mention outside `documents-actions.ts` under the in-account roots, or in either route; (c) a title or category in any event payload; (d) 0078's guard built on a nullable value without `coalesce`, or its grant reaching `anon`/`PUBLIC`; (e) a second `data-variant="default"` on the card or in the viewer, a non-destructive primary in the purge dialog; (f) the trash move opening any dialog (rule 6); (g) a new key without its twin, a JSX literal with a letter, a tú form; (h) a test that cannot fail (memory "Vacuous test shapes"): a Spanish assertion compared against `t()`'s output, a raw-markup negative on an apostrophe string, a `not.toContain("disabled")` that the button's own classes defeat; (i) the migration's ASCII rule; (j) the object-then-row order in Delete forever and in the finish's trash branch; (k) `set-state-in-effect` anywhere in the viewer, the dialog or the card; (l) Delete forever possible while a version is uploading; (m) Delete forever reachable for Staff or a Technician, in the card or in the action (owner ruling R1); (n) a `restoreDocument` path that ignores `DOCUMENT_PURGING_MARK`; (o) a timeline kind map or switch missing `documentVersion` (`ROW_KINDS`, `ROW_ICON`, `authorOf`, `phrase`, `excerptOf`, both timelines), a version row readable past RLS (the view without `security_invoker`), or a new-version row for a file's FIRST version; (p) `MEASURED` raised without its comment, or any `TIMELINE_SOURCES` pin changed (none should be).
- [ ] **Step 4.** Report findings by severity with file:line; the orchestrator routes fixes to the owning task's agent.

---

## Task 12: Rollout (orchestrator; LAST; not a coding task)

Additive migration, so it applies before the merge. Each step reads its own evidence; nothing is inferred from an earlier run.

- [ ] **Step 1.** Merge `origin/main` into `feat/s07-vault-1b`; `ls packages/db/supabase/migrations | tail -1` is still `0078_document_space_used.sql` and nothing on `main` holds a 0078.
- [ ] **Step 2. bis-ci** (as soon as Task 1's review approves, so the e2e job's migration check is green on the first push). `gh workflow run ci-project-setup.yml -f step=push-dry-run --ref feat/s07-vault-1b` → its log lists exactly `0078_document_space_used.sql`; then `-f step=push`. Post-apply, read-only with `pnpm --filter @bis/db ci:sql`: `select p.prosecdef, p.provolatile, p.proconfig from pg_proc p where p.oid = to_regprocedure('public.document_space_used(uuid)')` → `t | s | {search_path=""}`; `select has_function_privilege('anon', 'public.document_space_used(uuid)', 'EXECUTE'), has_function_privilege('authenticated', 'public.document_space_used(uuid)', 'EXECUTE'), has_function_privilege('service_role', 'public.document_space_used(uuid)', 'EXECUTE')` → `f | t | f`; `select c.reloptions, has_table_privilege('authenticated', c.oid, 'SELECT'), has_table_privilege('authenticated', c.oid, 'INSERT'), has_table_privilege('anon', c.oid, 'SELECT') from pg_class c where c.oid = 'public.document_version_timeline'::regclass` → `{security_invoker=true} | t | f | f`. From here on the `@bis/db` suites may run against bis-ci again.
- [ ] **Step 3. Push and CI.** Push the branch; CI `verify` (the in-runner stack runs every db suite, `document-space-used.test.ts` and `documents.test.ts` included, against real PostgREST: Assumption B1 is proven or refuted here) and `e2e` (the new spec, Assumptions B2 and B3) green ON THE HEAD SHA, read from `gh api repos/{owner}/{repo}/commits/<sha>/check-runs`. A CI-vs-local disagreement is an environment finding first (memory "CI vs local divergence").
- [ ] **Step 4. Gates, one at a time:** `pnpm check`, `pnpm --filter web build`, `pnpm --filter web test:e2e` (after checking no `screenshots.yml` run is in progress; a local e2e run uses bis-ci, which Step 2 gave 0078). The `forms.spec` unread-badge flake is unrelated; never loosen it.
- [ ] **Step 5. Production.** Pre-flight, read-only through MCP `execute_sql` on `tlbkbmlrfafquucsmsmm`: `select to_regprocedure('public.document_space_used(uuid)')` → null; `select max(version) from supabase_migrations.schema_migrations` → the 0077 apply (`20261014030854`). Then `apply_migration` with 0078's exact text, ONCE (memory "MCP SQL escapes": 0078 has no backslash, Task 1 Step 5 proved it). Then Step 2's two post-apply reads. Ledger line: `0078 APPLIED <date> on bis-ci and production — NEVER RE-APPLY`.
- [ ] **Step 6. Parity, the advisor and the API.** Review M8: Supabase's security advisor (MCP `get_advisors`, type `security`) will most likely flag `public.document_space_used` as a `SECURITY DEFINER` function in an exposed schema callable by `authenticated`. That is expected and reviewed (deviation 1: the function answers one number for the caller's own account and refuses anyone else); record the finding and this sentence in the PR body, do not "fix" it. A finding about the VIEW would be unexpected (it is `security_invoker`): stop and read it.
  Parity: `docs/runbooks/ci-supabase-project.md` §5: `fingerprint.sql` on both; the function definition and its ACL equal; an allowed difference is only one the runbook lists. Assumption B4 (PostgREST has reloaded and serves the function): after Step 2, open any contact's Documents card on the branch's Vercel Preview (bis-ci) as the agency and read the documents route's JSON in the browser's network panel; after Step 5, the same on production. Each must show `space` as an object, not `null`. A `null` with `PGRST202` in that deployment's function log means the schema cache is stale: send `notify pgrst, 'reload schema'` on that project (MCP `execute_sql`) and read again. Reading a route is read-only.
- [ ] **Step 7. Merge** (squash, through the PR, after the head SHA's `verify` and `e2e` are green and Task 11's findings are closed). The PR body names: deviations 1–11 (with the two Restore-during-purge cases deviation 4 closes, review M1), Assumptions B1–B6 and where each was proven (B2's e2e covers only the agency branch, review M9), the advisor's expected finding (review M8), the pinned tests this PR changes (`MEASURED` 23 → 24, the guard's `rlsOff`), "Not in this PR", and the 0078 apply lines.
- [ ] **Step 8.** Ledger: the migration line; the roadmap tracker row for item 6 stays `in_progress` (spec §7: `done` only after parts 2 and 3) with a note "part 1 complete (1a #258, 1b #<n>)"; the deploy reads READY on the merge SHA.

---

## Spec coverage

| Spec | Where |
|---|---|
| §3.3 "Upload a new version" adds a row; `current_version_id` moves when ready | Task 4 (start action, existing finish), Task 6 (journey), Task 8 (menu, input), Task 10 test 1 |
| §3.5 the quota counts a new version from its reservation | 0077 unchanged; Task 4 (reserve on the existing document), Task 1 (0078 counts uploading versions) |
| §3.6 `document.purged` with actor `user`, no title | Task 3 (`deletePurgedDocument`), Task 10 test 4 |
| §3.6 (amended, R2) `document.version_added` and the new-version timeline row | Task 1 (the view), Task 2 (`timeline.documentVersion`), Task 3 (event, `listDocumentVersionTimeline`), Task 3b (record.ts, both timelines, the drawer, `MEASURED` 24), Task 10 test 1; deviation 6 |
| §3.4 (amended, R1) Delete forever for Owners and agency only | Task 4 (action), Task 8 (button), deviation 5 |
| §4.1 row: "Version 2" only with more than one ready version | Task 3 (ready versions), Task 5 (view), Task 8 (row), Task 10 test 1; deviation 7 |
| §4.1 menu: Upload new version | Task 8 (`rowMenuItems`, order), deviation 11 |
| §4.2 item 4 "4.1 of 5 GB used" above 80% | Task 1 (0078), Tasks 3 and 5 (read, route, `space.ts`), Task 8 (card), Task 10 test 3; deviations 1, 9 |
| §4.3 Versions list, newest first, older versions downloadable | Task 3, Task 5, Task 7 (list), Task 8 (wiring, `download(doc, versionId)`), Task 10 test 2 |
| §4.4 Delete forever from "Trash (n)" by typed name; never shared with the trash move | Task 4 (action), Task 7 (dialog, one-version wording), Task 8 (button, handler: every refusal re-reads and closes), Task 10 test 4; deviations 3, 4, 5, 8 |
| §5.1 (amended) purge: Owner or agency, refused while uploading, claim with the purging mark, every version's object, then the rows, then emit; request-client proof first | Task 3 (claim, marker, `restoreDocument`), Task 4 (order test), Task 10 test 4 |
| §6 e2e "(PR 1b) Delete forever by typed name; upload a new version and see Version 2" | Task 10 |
| §7 rollout, migration order | Task 12; deviation 1 |
| PR 1a follow-up: no new version on a trashed file | Task 4 (start and finish), deviation 2 |
| PR 1a follow-up M7: bounded image retry | Task 7, deviation 10 |
| PR 1a follow-up: the file's own "not found" | Task 2 (`documents.error.fileNotFound`), Task 4, Task 8 (handler test) |
| PR 1a follow-up M6: the styleguide never reaches an action | Task 8 (`rowSavers`, `demoHandlers`) |
| Everything else | "Not in this PR" |

## Self-review notes (the writer's own pass, 2026-10-14)

- Vacuity pass, every prescribed test: each names its mutation and the "why each can fail" paragraph under each task says how. Caught and fixed while writing: a `not.toContain("disabled")` on the purge button that the button's own `disabled:opacity-50` class would defeat (now the attribute `disabled=""`); a tautological regex on the destructive tag; a messages case that was green before the keys existed (now `toMatch` on the new key, red on `undefined`); a "live document" claim case whose mutation was not a real one (renamed to the one it catches). Every copy assertion goes through `renderedText`; every Spanish assertion fills `m["….es"]` by hand.
- Revision of 2026-10-14 (owner rulings R1, R2; review I2, I3, M1–M11), re-checked case by case: the flipped Staff purge case now asserts a refusal with nothing read (mutation: drop `canManage`); the agency case catches an owner-only rule; the handler's two refusal cases expect a reload and `true` (mutation: return false); the in-flight case pins `once`; the claim case's new-instant Restore pins the marker; the 1002-version replica case pins the paging past PostgREST's 1000-row cap (fix round: the first design's `limit(1001)` refusal was dead code under max_rows); the one-version purge body pins M11; the messages case pins M6's no-time wording; every new-version case (view rows, RLS, grants, event, timeline read, record paging, author, row words in both languages, Recent, drawer parse, both renders, `MEASURED`) names its mutation in its title and in its task's "why each can fail". The `document.added` count in Task 3's versions case is labelled a 1a pin (M4). M10's busy toast has no unit test, said so in Task 8's probes.
- Request-client proof: both new actions read the document on `dbForRequest()` before any service call; the finish's trash branch runs after the existing proof; the routes stay request-only (the space read is 0078 on the request client).
- Types: `ListedDocument.versions` (Task 3) → `DocumentView.versions` (Task 5) → the row label (Task 8) and `DocumentVersionsList` (Task 7); `DocumentsResponse.space` (Task 5) → `spaceUsedText` (Task 5) → the card (Task 8); `startDocumentVersionUploadAction` (Task 4) → `VersionDeps.startVersion` (Task 6) → `browserVersionDeps` (Task 8); `purgeDocumentAction` (Task 4) → `handlers.purge` (Task 8) → `DocumentPurgeDialog.onConfirm` (Task 7); `DocumentHandlers` (Task 8) → `demoHandlers`.
- Every fixture that builds a `DocumentView` gains `versions` in the task that owns its file: the route tests and `documents-load.test.ts` (Task 5), the viewer test (Task 7), the card, handler and demo tests (Task 8). Typecheck is clean only after Task 8; Tasks 5–7 list the remaining errors instead of editing another task's files.
