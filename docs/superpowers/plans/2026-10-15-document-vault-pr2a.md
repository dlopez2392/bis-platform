# The document vault, PR 2a (S-07 + F-005 part 2, migration 0079): virus scanning, implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every stored file is checked for viruses before anyone can open or download it (owner decision P3). A ClamAV worker on Fly.io (P1, P2) scans each version through a signed, short-lived storage URL it is handed; a version reads "Checking" ("Revisando") until its verdict, "Taking longer than usual" after 15 minutes, and a file with a virus is deleted at once and leaves "Removed: it had a virus" ("Quitado: tenía un virus"), a timeline row with the automation mark and a `document.virus_removed` event (P4). Part 1's stored files get one catch-up scan through a retry pass on the existing cron, which also writes a heartbeat that `/api/ops/health` and the alert pass read.

**Architecture:** One additive migration, **0079**, gives `document_versions` a scan state (`scan_status` pending/clean/infected/unscannable, `scan_attempts`, `scanned_at`, `scan_signature`), a service-only verdict function `record_document_scan` (compare-and-set from `pending`), and a `security_invoker` view `document_scan_timeline` for the removed-file timeline rows. Part 1's rows default to `pending`, which IS the catch-up. Every signed READ URL is minted by ONE function, `signedDocumentReadUrl` in `packages/db/src/documents.ts`, which re-reads the version and refuses unless it is ready and clean; the scanner's own URL is minted by a second function, `signedScannerUrl`, used only by the scan procedure; a source-scan test pins that `createSignedUrl(` appears nowhere else. The finish action scans at once (`lib/documents/scan-version.ts` → `lib/documents/scan-client.ts`, HMAC-signed `POST /scan`); a new cron pass, `documentsScan`, scans what is still pending within a 45-second budget, gives up fail-closed after three errors, and records `documents.scanner` in `ops_heartbeats`. **`current_version_id` keeps 0077's meaning** (the newest ready version; the file's "listed" marker in seven places): what OPENS is the newest CLEAN ready version, derived in the card's read (deviation 1). The worker (`services/scanner/`, new, outside the pnpm workspace) is the official `clamav/clamav:1.4` image plus a dependency-free Node shim (`node:http`, `node:net`), deployed with `fly.toml`; its own CI job proves EICAR → infected and a clean PDF → clean against the real clamd. e2e runs the REAL shim in front of a fake clamd that Playwright starts (deviation 5), so nothing in the app can reach a fake in production.

**Tech Stack:** Postgres 17 (Supabase) migration; supabase-js 2.110.8 (`rpc`, `storage.createSignedUrl`, `storage.remove`); Next.js 16.3.6 App Router (server actions, route handlers, client components); React 19.2.4; vitest 4 (`renderToStaticMarkup`, no DOM; `vi.mock`); Node 24 in CI, `node:test` for the shim; Docker (`clamav/clamav:1.4`, Alpine, `apk add nodejs`); Fly.io (`flyctl`, one always-on `shared-cpu-1x` 2 GB machine in `iad`); the `@bis/db` suites on a local PG18 replica (with a local PostgREST for `withTestAccount`) and CI `verify`; Playwright (bis-e2e-qa writes it, the orchestrator runs it).

**Revision:** 2026-10-15, after the plan review of `4771f63a` (C1, C2, I1, I2, minors 2–15; orchestrator rulings on deviations 1 and 12). The spec carries matching "Amended 2026-10-15 (2a plan review)" notes. **Owner ruling 2026-10-15, password-protected files: REMOVE, AND SAY WHY** (applied in a third revision). **Fifth revision, 2026-10-15 (final check of f09fa9c2): R1 (the unscannable path keeps clamd's named cause again: a block swap had reverted 907f196f's line and its assertion; restored, with a second case that pins that path alone), R2 (orchestrator ruling: only an object CONFIRMED missing counts; every other 4xx, 5xx and every timeout is transport), minors 1-3.** **Fourth revision, 2026-10-15 (re-review of 2471631d and 907f196f): N1 (no limit below clamd 1.4's defaults; a 300 MiB-expansion CI case), N2a (the breaker is the worker's INSTREAM self-test; the finish never spends), N2b (`scan_tried_at`), N2c (runbook), N3 (file-specific errors count, bounded at three), the code blocks brought up to the password ruling, the e2e password case, minors 1-3.** Ruling text: a file clamd reports as `Heuristics.Encrypted.*` is removed exactly like any unscannable file, but its note names the reason ("Tiene contraseña: quítela y vuelva a subirlo"); every other unscannable cause keeps the generic "No se pudo revisar este archivo". The reason lives in DATA (the version's `scan_signature`, read through one shared helper), so 2b's customer page can say it too.

**Spec:** `docs/superpowers/specs/2026-10-15-document-vault-part2-design.md` (owner-approved 2026-10-15): §1 row 2a, §2 P1–P4, §3 entirely, and the 2a parts of §6, §7, §8, §9. Part 1's plans: `docs/superpowers/plans/2026-10-13-document-vault-pr1a.md`, `docs/superpowers/plans/2026-10-14-document-vault-pr1b.md` (the template). Base: `main` at `de3f3551` (#259, PR 1b merged; 0077 and 0078 applied to bis-ci and production, never re-apply) plus the spec commit `5d74ee58`. Every file:line below was read off this worktree at `5d74ee58`; anything not read is labelled **Assumption**.

`<WT>` = `C:\Users\danlo\bis-platform\.claude\worktrees\s07-2a` (Git Bash: `/c/Users/danlo/bis-platform/.claude/worktrees/s07-2a`), branch `feat/s07-vault-2a`. `<SCRATCH>` = `C:\Users\danlo\AppData\Local\Temp\claude\C--Users-danlo-bis-platform\f54a0255-9568-420c-ad87-a4d62d6b9a05\scratchpad` (Git Bash: `/c/Users/danlo/AppData/Local/Temp/claude/C--Users-danlo-bis-platform/f54a0255-9568-420c-ad87-a4d62d6b9a05/scratchpad`); write it out literally in every command. `<KITSRC>` = `/c/Users/danlo/AppData/Local/Temp/claude/C--Users-danlo-bis-platform/db21dcfe-6aee-47cd-8939-ff4f82a45810/scratchpad/s07-t3-impl` (PR 1a's PostgREST build, JWT signer and gateway proxy; read 2026-10-15: `postgrest.exe`, `make-jwt.js`, `proxy.mjs` present). `<FLYCTL>` = `C:/Users/danlo/.fly/bin/flyctl.exe` (Git Bash: `/c/Users/danlo/.fly/bin/flyctl.exe`), flyctl v0.4.118, logged in to danlo's Fly org `personal` (card added). There is NO `fly` alias on this machine: every Fly command in this plan is `<FLYCTL> …`, written out as that full path when run. `…/contacts/` = `apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/contacts/`. `…/api/` = `apps/web/src/app/api/accounts/[accountId]/`.

## Global Constraints

- **NEVER `git stash`, `git reset`, `git checkout --`, `--amend`, or any history rewrite** in the shared worktree. Another agent's uncommitted work lives in the same tree. To undo your own edit, edit it back. To see committed text, `git show HEAD:<path>`. Never `rm -rf` anything under `<WT>` (memory "No rm -rf on worktrees"); scratch directories under `<SCRATCH>` are yours to delete. Commit with `git commit -m "…" -- <every path>`, never `-A` or `.`.
- **Ownership (tag on every task; no task edits a file its owner does not own).**
  - **bis-db-schema:** `packages/db/supabase/migrations/0079_document_scan.sql` (new), `packages/db/src/test/document-scan.test.ts` (new), and the one `rlsOff` line (`:113`) plus its comment in `packages/db/src/test/schema-grants-guard.test.ts`. Writes the migration and proves it on a replica; never applies it.
  - **bis-crm:** `apps/web/src/lib/messages.ts` and one new `describe` in `apps/web/src/lib/messages.test.ts` (**Task 2 only**); `packages/db/src/documents.ts`, `packages/db/src/test/documents.test.ts`, `packages/db/src/index.ts` (the documents export block only); `apps/web/src/lib/documents/{scan-client,scan-version,scan-state,read-gate}.ts` and their tests (new); `…/contacts/documents-actions.ts` and its test; `apps/web/src/lib/documents/{documents-load,document-view}.ts`, `documents-load.test.ts`; `…/api/contacts/[contactId]/documents/route.test.ts`, `…/api/groups/[groupId]/documents/route.test.ts` (fixtures only); `apps/web/src/lib/i18n/{catalogue,ratchet}-baseline.json` (regenerated, never hand-edited); for the removed-file rows (Task 3b): `packages/db/src/record.ts`, `packages/db/src/test/record.test.ts`, `apps/web/src/lib/record/{author-mark,timeline-rows,recent-rows}.ts` and their tests, `…/contacts/[contactId]/activity-timeline.tsx` and `activity-timeline.rows.test.ts`, `…/groups/[groupId]/group-timeline.tsx` and its test, `…/contacts/contact-drawer.tsx` (the `ROW_ICON` map only), `apps/web/src/lib/contacts/drawer-summary.ts` (`ROW_KINDS` only) and its test, and `…/api/contacts/[contactId]/summary/route.reads.test.ts` (`MEASURED` and its comment only).
  - **bis-automations:** `apps/web/src/lib/automations/passes/documents-scan.ts` (+ test, new), `apps/web/src/lib/automations/registry.ts`, `apps/web/src/lib/automations/caps.ts` (prose only), `apps/web/src/lib/automations/sentinel.test.ts`, `apps/web/src/lib/automations/cron-coupling.test.ts`, `apps/web/src/app/api/cron/reminders/route.test.ts`, `apps/web/src/lib/ops/watch.ts` (+ `watch.test.ts`), `apps/web/src/app/api/ops/health/route.ts` (+ test).
  - **bis-frontend:** `…/contacts/{documents-card.tsx,document-viewer.tsx}` and their tests, `…/contacts/{documents-card-handlers.test.ts,document-purge-dialog.test.ts}` (fixtures only), `apps/web/src/app/(dashboard)/dashboard/styleguide/{documents-demo.tsx,documents-demo.test.ts}`.
  - **bis-platform:** everything under `services/scanner/` (new), `.github/workflows/ci.yml` (one new job, `scanner`), `apps/web/playwright.config.ts` (the `webServer` entry only), `apps/web/vitest.config.ts` (`test.env` only), `.env.example` (one block), `docs/runbooks/scanner.md` (new).
  - **bis-e2e-qa:** `apps/web/e2e/documents-scan.spec.ts` (new).
  - **Orchestrator:** the ledger, the Fly app, its secrets and deploy, the Vercel env, the bis-ci and production applies of 0079, the parity check, the gates, the EICAR check on Preview, the PR, the merge, the roadmap tracker row. No `DESIGN.md` edit: its "Documents" paragraph does not name scanning, and rule 3 (dot + word) already governs the new states.
- **Shared files, one task at a time.**
  - `apps/web/src/lib/messages.ts`: **Task 2 only**. Every key in this plan is listed in Task 2. A later task that finds a key missing STOPS and reports it; the orchestrator re-opens Task 2. A `.es` twin goes on the line directly under its English key.
  - `packages/db/src/documents.ts`, `packages/db/src/index.ts` (+ `test/documents.test.ts`): **Task 3 only** (Task 3 also writes `listDocumentScanTimeline` there; Task 3b only calls it).
  - `packages/db/src/record.ts` and `lib/record/*`: **Task 3b only**.
  - `apps/web/src/lib/documents/{documents-load,document-view,scan-state}.ts`: **Task 7 only** (Task 9 consumes their types).
  - `…/contacts/documents-actions.ts` (+ test): **Task 6 only**.
  - `…/contacts/documents-card.tsx`, `document-viewer.tsx` (+ tests) and the styleguide demo: **Task 9 only**.
  - `apps/web/src/lib/i18n/*-baseline.json`: **Task 11 only**, after Tasks 2, 3b, 6, 7, 9 have committed.
- **Every test must be able to fail, and the plan writer checked each one; the implementer re-checks.** Each test names the mutation that breaks it. Run the probe, see the test fail BY NAME, paste the failing assertion line into the report, revert by editing back. Shapes a reviewer rejects on sight (memory "Vacuous test shapes"): `toBeTruthy`/`toBeDefined` on content; an English-only assertion where a Spanish twin exists (assert BOTH, the Spanish compared against the literal string from `m["….es"]`, never `t()`'s output, which falls back to English silently); a mock that satisfies itself (asserting a mock returned what the test told it to return); an assertion on a value the fixture already contained before the code ran; a negative `not.toContain` against raw `renderToStaticMarkup` output on a string with an apostrophe (React writes `&#x27;`): use `renderedText()` from `apps/web/src/lib/rendered-text.ts` for EVERY copy assertion. A `-t` filter that matches nothing passes silently: check the run count in vitest's summary block. For `node:test`, read the `# pass` / `# fail` lines.
- **0053, server-only writes; the request-client proof.** Every service-role call on an id that came from the browser runs AFTER `requireAccountAccess(accountId)` and a request-client read (`dbForRequest()`, `apps/web/src/lib/db.ts:21-26`) that returns that document or version under RLS. `documents-actions.ts` is `proven-target` in `…/accounts/in-account-service-reads.test.ts:91`. **No new file under `apps/web/src/lib`, `…/accounts/` or `…/api/` contains the token `serviceDb`, not even in a comment** (that test scans `lib` too, `:34`): the scan procedure and the pass take the caller's client as a parameter (`ctx.db` in the pass, the action's service client in the finish).
- **SQL rules.** The migration is ASCII only with no backslash anywhere (memory "MCP SQL escapes"; checked with the node byte count below, which has a positive control, because `grep -P` exits 2 silently in Git Bash). A boolean built from a nullable value is `coalesce(…, false)` (memory "plpgsql NULL guard"). A Supabase `head: true` count throws on `count === null` (memory "head-count null"); this plan adds none.
- **No file in the repo contains the EICAR test string whole.** An antivirus on a developer's machine (Windows Defender on danlo's) can quarantine such a file mid-task. Every test builds it at run time from two halves with `eicar()` (`services/scanner/test/eicar.mjs`, Task 4) or the e2e spec's own two-half join (Task 12). A reviewer greps for `EICAR-STANDARD-ANTIVIRUS-TEST-FILE` and for `X5O!P%@AP` and expects each half on a different line, never joined in a literal.
- **The worker holds no database or storage credential** (spec §3.1): only `SCANNER_CLIENTS` (each caller's secret bound to that caller's storage origin, deviation 4). Never a Supabase key, a Vercel token or a production value in `services/scanner/`, `fly.toml` or the CI job. Production's caller secret lives in Vercel Production and in the worker's Fly secrets only; Preview's is a different value (CLAUDE.md "Only production credentials reach production data").
- **react-hooks/set-state-in-effect.** No `setState` synchronously inside a `useEffect` body. The card's re-read timer calls `reload` from the timer's callback, never in the body; the viewer's skip for an unchecked file is a condition on the existing effect's primitive deps.
- **DESIGN.md definition of done for every UI task (9):** tokens only (radii `rounded-[var(--radius-ctl)]`, pills `rounded-full`; no hex, no literal shadow); both themes via the `.dark` class; the blur fallback (no `backdrop-filter` on the card); **rule 3: every scan state is a dot AND a word** (`--warn` for Checking, `--crit` for Removed and Couldn't check); rule 4 (the whole row still opens the viewer, hover `--surface-3`, a visible focus ring); rule 5 (loaded, empty, error, and now each scan state, designed); rule 7 (no spinner: "Checking" is a word and a dot, never an animation; nothing pulses); rule 8 (the card keeps exactly ONE `data-variant="default"` button; the viewer's Download primary is not drawn for an unchecked file, so the dialog has none rather than a disabled one); controls `min-h-11 md:min-h-8`; nothing animates on scroll. The record page names no hero (rule 11).
- **Copy.** Every new string through `t(m, key, locale, params)` with an `.es` twin in the same commit (`apps/web/src/lib/i18n/ratchet.test.ts`). New `.tsx` code carries no JSX literal copy with a letter in it. Usted for every new Spanish string. No vendor jargon in copy ("ClamAV", "Fly", "scanner", "signature", "Supabase", "storage", "signed URL"). The ops email (`lib/ops/watch.ts`) is English and plain by its own rule (BIS staff read it).
- **Browser code imports the vault's rules from `@bis/db/document-rules`**, never the `@bis/db` barrel. `lib/documents/scan-state.ts` is browser-safe (no `@bis/db` barrel import, no `node:` import); `scan-client.ts` and `scan-version.ts` are server-only (they import `node:crypto` and the barrel).
- **The `vi.mock` factory check.** A task that adds a NEW named import to a module adds that name to every mock factory that reaches the module: `grep -rln 'vi.mock("@bis/db"' apps/web/src | xargs grep -ln "<module basename>"`. The cron route test's factory is bare except `chooseBody` (`route.test.ts:15-25`): an unlisted export throws, which turns the new pass into `errored: 1`.
- **Running tests.** Only the affected tests, by path: `pnpm --filter web exec vitest run "<path>" …`, `pnpm --filter web typecheck`, `pnpm --filter web exec eslint "<touched files>"`; the shim with `node --test "services/scanner/test/*.test.mjs"` from `<WT>`. `@bis/db` suites only on a replica (the kit below), judged by vitest's summary block (capture the exit code to a file with nothing after the command; the `ERR_PNPM_RECURSIVE_EXEC_FIRST_FAIL` trailer lies). **No `@bis/db` vitest may run against bis-ci until Task 14 step 2 has applied 0079 there** (the new columns are read by `documents.ts`'s every read). Never the gates (`pnpm check`, `pnpm --filter web build`, `pnpm --filter web test:e2e`) and never Playwright: the orchestrator runs them, one at a time (memory "Agent test scope"). Never pass the folder `…/accounts/` to vitest (it holds `calls/[callId]/actions.test.ts`, a live test). Docker runs (Task 4) are local and touch nothing shared.
- **Mutating e2e only on the per-run fixture account** (`readClientFixture()`, `apps/web/e2e/support.ts:103-111`), never `Test Client One`; every seeded row and stored object deleted in `afterAll`, each error checked, then re-read to confirm none is left.
- **Nothing sends, nothing calls a real provider.** No test calls the Fly worker. No script, REPL or test writes to bis-ci or production storage except the orchestrator's e2e runs on the fixture account and Task 14's one EICAR upload on Preview (bis-ci).
- **Commits** carry the trailer lines `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>` and `Claude-Session: https://claude.ai/code/session_013RThMy9QC8x7FZ94Lxib9p`. If `.git/index.lock` exists, wait and retry; never delete it. Never push (the orchestrator pushes). Never touch `main`.
- **Never** apply a migration outside your own replica, run SQL that writes to a shared project, mutate Test Client One, create or edit `.env*` (except Task 10's `.env.example`), deploy to Fly, or set a Vercel or Fly secret. Those are the orchestrator's, in Task 14.

## The replica kit (every `@bis/db` task and its reviewer)

Ports, one set per agent, never `5432`: Task 1 implementer `55560`, Task 1 reviewer `55561`; Task 3 implementer Postgres `55562`, PostgREST `55563`, gateway `55564`; Task 3 reviewer `55565`/`55566`/`55567`; Task 3b implementer `55568`/`55569`/`55570`; Task 13 (final review) `55571`/`55572`/`55573`. Each agent works in its own `<SCRATCH>/s07c-t<N>-<impl|review>/`.

PR 1b's kit, re-pointed: `pre` is every migration through **0078** (with the storage stub 0077 needs), `post` is `pre` plus the branch's 0079 if it exists yet. The PostgREST build, JWT signer and gateway proxy come from `<KITSRC>`; the proxy forwards `/rest/v1/*` to PostgREST and answers `DELETE /storage/v1/object/documents` with `200 []`; any other storage call gets 404, so a test that unexpectedly reaches storage fails loudly (Task 3 relies on that: a refused mint must never reach storage).

**`<SCRATCH>/s07c-kit/replica.sh <pgPort> <dir>`** (Task 1 writes the kit; every later agent runs it):

```bash
#!/usr/bin/env bash
# replica.sh <pgPort> <dir>: a throwaway PG18 replica of the migrations (memory "Local DB replica").
set -u
PORT="$1"; S="$2"
WT=/c/Users/danlo/bis-platform/.claude/worktrees/s07-2a
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
  case "$f" in *0079_*) continue;; esac
  P -d pre -1 -f "$f" > /dev/null 2>"$S/mig.err" || { echo "FAILED at $f"; cat "$S/mig.err"; exit 1; }
done
P -c "create database post template pre"
P -d post -c "alter database post set timezone to 'UTC'"
if [ -f packages/db/supabase/migrations/0079_document_scan.sql ]; then
  P -d post -1 -f packages/db/supabase/migrations/0079_document_scan.sql || { echo "0079 FAILED"; exit 1; }
  echo "post = pre + 0079"
else
  echo "post = pre (no 0079 yet)"
fi
```

**`<SCRATCH>/s07c-kit/pgrst.sh <pgPort> <pgrstPort> <gatewayPort> <dir>`**: a local PostgREST on `post` behind the proxy, plus `<dir>/env-run.sh`, which points the `@bis/db` suites at localhost only (`dotenv` does not replace a variable already set, so these exports win over `packages/db/.env`'s CI-project values).

```bash
#!/usr/bin/env bash
set -u
PG="$1"; PR="$2"; GW="$3"; S="$4"
K=/c/Users/danlo/AppData/Local/Temp/claude/C--Users-danlo-bis-platform/db21dcfe-6aee-47cd-8939-ff4f82a45810/scratchpad/s07-t3-impl
SECRET="s07c-local-postgrest-jwt-secret-not-used-anywhere-real-0000"
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

Stop your own kit only (never `taskkill /IM postgrest.exe`): `touch "<dir>/stop"`, then in PowerShell `Get-Process postgrest | Where-Object { $_.Path -eq '<dir as a Windows path>\postgrest.exe' } | Stop-Process -Confirm:$false` and `Get-NetTCPConnection -LocalPort <gatewayPort> -State Listen | ForEach-Object { Stop-Process -Id $_.OwningProcess -Confirm:$false }`; then `"/c/Program Files/PostgreSQL/18/bin/pg_ctl" -D "<dir>/pgdata" stop -m fast`. A SQL mutation probe on `post` needs `psql … -d post -c "notify pgrst, 'reload schema'"`.

**Faithfulness** (once per kit build, read-only on bis-ci with `pnpm --filter @bis/db ci:sql`): the client-write-surface digest on `pre` equals bis-ci's (bis-ci has 0078 and not 0079 until Task 14 step 2). The query:

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

- `packages/db/src/test/schema-grants-guard.test.ts:113`: `rlsOff` `["document_version_timeline"]` → **`["document_scan_timeline", "document_version_timeline"]`** (Task 1; the guard's query orders by name, `:33`). The second reviewed `security_invoker` view in `public`.
- `apps/web/src/app/api/accounts/[accountId]/contacts/[contactId]/summary/route.reads.test.ts:58`: `MEASURED` 24 → **25** (Task 3b). The 25th read is `request:document_scan_timeline`, the drawer's five newest rows reading removed-file rows under RLS, inside the same documents source.
- `apps/web/src/app/api/cron/reminders/route.test.ts`: every exact body (`:402`, `:425`, `:448`, `:464`, `:557`, `:572-590`, `:614-632`) gains `documentsScan: EMPTY_DOCUMENTS_SCAN` after `documentsSweep`; the `@bis/db` factory gains `recordHeartbeat` if absent (Task 8). The suite sets no `SCANNER_URL`, so the pass reports its not-configured counters there.
- `apps/web/src/lib/automations/sentinel.test.ts:280`: the `PASSES` order gains `"documentsScan"` directly after `"documentsSweep"`, and `:263` gains the pass's not-configured counters beside the sweep's (Task 8).
- `apps/web/src/lib/automations/cron-coupling.test.ts:328-335`: the budgets' sum gains `DOCUMENT_SCAN_BUDGET_MS` (180 + 45 + 60 headroom = 285 ≤ 300; Task 8); its comment names four budgets.
- `…/contacts/documents-actions.test.ts`: the finish's success answers `{ ok: true, scan }` (was `{ ok: true }`), and `getDocumentUrlAction` now mints through `signedDocumentReadUrl` (its mock replaces the `createSignedUrl` stub) (Task 6).
- Every `DocumentView` fixture gains `scan` and `createdAt` on `version` and `scan` on each `versions` entry: `documents-load.test.ts`, both documents route tests (Task 7); `document-viewer.test.ts`, `document-purge-dialog.test.ts`, `documents-card.test.ts`, `documents-card-handlers.test.ts`, `documents-demo.tsx` (+ test) (Task 9).
- **Unchanged, checked:** `TIMELINE_SOURCES` (the removed-file rows join the existing `documents` source, as 1b's version rows did), so every test pinning it keeps its list; `document-vault-schema.test.ts`, `document-vault-rls.test.ts`, `document-vault-reserve-lock.test.ts`, `document-space-used.test.ts` (0079 neither drops `documents.scan_status` nor changes 0077's or 0078's functions, so their inserts of `scan_status` and their `mark_document_version_ready` cases stand: deviation 2); `contacts.test.ts`, `record.test.ts`'s existing cases (the "listed" rule is unchanged: deviation 1); `in-account-service-reads.test.ts` (no new `serviceDb` mention).

## Not in this PR

- PR 2b (customer upload links, `/d/[token]`, migration 0080) and PR 2c (the "7 de 9" checklist, migration 0081). 2b's customer finish will call the same `scanVersion` (Task 5); this PR does not build it.
- **Dropping `documents.scan_status`** (spec §3.2): moved to 2b's 0080 as its first statement (deviation 2). This PR stops the app writing it and gives it a default.
- Excluding removed versions' bytes from the quota and the space line (deviation 9).
- Signing the worker's answers, a second worker machine, a region other than `iad`, scanning on read, re-scanning clean files when signatures update, quarantine (nothing infected is kept, P4).
- A Settings or ops UI for the scanner; the ops email and `/api/ops/health` are its only surfaces.
- Everything in spec part 3 (expiry reminders, share links, the account-wide Documents view).

## Deviations from the spec, and spec-vs-code mismatches (the source decided; evidence cited)

1. **`current_version_id` keeps 0077's meaning; what OPENS is the newest CLEAN ready version, derived in the read** (spec §3.2 bullets 4–5 said the pointer moves only on clean and the 0077 §5 trigger gains that condition). **ACCEPTED 2026-10-15** (orchestrator ruling; the spec's §3.2 is amended to match). The pointer is the file's "listed" marker, read as such in seven places: `listRecordDocuments` lists only `current_version_id is not null` (`packages/db/src/documents.ts:71`); the timeline's "added a file" row likewise (`:479`); `discardDocumentUpload` deletes a document whose pointer is null (`:181-182`), so a first upload that is ready but pending would be DELETED with its version by the next failed-upload clean-up or sweep (`documents-sweep.ts:168`); `startDocumentVersionUploadAction` refuses a file with no pointer (`documents-actions.ts:167`); `mark_document_version_ready` moves it and answers `first` from it (`0077:207-220`), and 0078's view relies on "the first ready version is the oldest", which that rule enforces (`0078:42-47`). Moving the pointer only on clean would unlist every pending upload (spec §3.5 wants it listed as "Revisando") and break those four writers. Holding P3 does not need the pointer: the ONE mint function re-reads the version and refuses unless it is clean (Task 3), and the card derives the openable version (`documentView`, Task 7): the newest ready version whose scan is clean, else the newest ready version with its state. Spec §3.5's behaviours all hold: a pending NEW version leaves the previous clean one opening normally, and the Versions list shows the new one as "Checking". Consequences: 0077's trigger and `mark_document_version_ready` are untouched; the verdict function moves no pointer (deviation 3); the database no longer promises "current is clean", the gate does.
2. **`documents.scan_status` is not dropped by 0079; it gets `default 'skipped'` and the app stops writing it** (spec §3.2 bullet 3). 0079 applies to production BEFORE the merge (the additive rule, Task 14), and the build running then writes `scan_status: "skipped"` on every upload (`documents.ts:115`): dropping the column first would fail every upload until the deploy. The drop becomes 2b's 0080's first statement (named in "Not in this PR"; 2b's plan must carry it). Five db test files insert the column explicitly and stay green (`document-vault-schema.test.ts:45`, `document-vault-rls.test.ts:42`, `document-vault-reserve-lock.test.ts:29`, `document-space-used.test.ts:33`, `documents.test.ts:63`).
3. **The verdict function is `SECURITY INVOKER`, executable by `service_role` only, and moves no pointer** (spec §3.2 bullet 5: "on clean it advances current_version_id"; deviation 1 removes the need). `record_heartbeat`'s shape (`0057:42-44`): service_role already holds UPDATE on `document_versions` (`0077:128`). It is a compare-and-set from `pending` on a READY version of that account; `error` adds an attempt and stays `pending`.
4. **The worker's secrets are per caller, each bound to that caller's storage origin** (`SCANNER_CLIENTS="<secret>@<origin> …"`), not one `SCANNER_SECRET` (spec §3.1). Spec §3.1 has Production and Preview call one worker; with one shared secret, Preview (which must never hold a production credential, CLAUDE.md) could make the worker fetch production URLs. Bound secrets mean a Preview-signed request can only fetch bis-ci objects. The app side keeps the spec's names, `SCANNER_URL` and `SCANNER_SECRET`, one value per deployment.
5. **e2e's fake scanner is the real shim in front of a fake clamd** (`services/scanner/test/fake-clamd.mjs`, EICAR → `FOUND`, else `OK`), both started by Playwright's `webServer` (spec §7 said "a route answering by content"). A route in the app would ship in every build and need a guard to stay unreachable in production; a process Playwright starts is not in the app at all, and the Docker image copies `src/` only, so the fake cannot reach production by construction. The shim's HMAC, its allow-list and its streaming to the clamd protocol run end to end in every e2e run.
6. **"Pending for over 15 minutes" is measured from the version's `created_at`** (its reservation), for the row's "Taking longer than usual" and for the health check (spec §3.4, §3.5). No column records when a version became ready, and adding one is not needed for an upload that takes seconds. Residual, named: a 25 MB upload over a slow phone link that takes many minutes would read "Taking longer than usual" early.
7. **The retry pass scans only while the worker's `/health` is good** (spec §3.4 is silent on an outage). Otherwise three ticks of a down worker would mark every pending file `unscannable` and delete it (fail closed, but on OUR fault). The finish's own attempt still counts, and so does an error from a healthy worker.
8. **An unscannable file emits `document.unscannable`** with the same payload (`{ documentId, versionId }`); spec §3.5 names the event only for a virus.
9. **A removed version's bytes still count against the 5 GB quota and the space line until its file is purged** (spec silent). 0077's reserve and 0078's sum count every version row (`0077:181`, `0078:36`); changing them re-creates two functions the quota tests pin, for a rare case the trash (30 days) or Delete forever clears.
10. **The removed-file row's words follow the timeline's grammar** ("{mark} {verb}", the automation mark leading): "Automation removed Lease: it had a virus" / "Automatización quitó Lease: tenía un virus" (spec §3.5 wrote the impersonal "Se quitó *Lease*: tenía un virus"). Unscannable: "removed Lease: it couldn't be checked" / "quitó Lease: no se pudo revisar".
11. **No permanent "Listo" label.** A clean file is the ordinary row (spec §3.4 "Revisando → Listo"); the card re-reads every 5 seconds while a file is Checking, so the word goes away by itself.
12. **The worker machine is 2 GB with `ConcurrentDatabaseReload no`** (spec P2 said ~2 GB). ClamAV's own Docker page says "2GB may be insufficient. Configure your containers to have 4GB of RAM" (docs.clamav.net, Installing/Docker, read 2026-10-15): a concurrent reload holds two signature sets at once. Turning it off halves the peak at the cost of a pause in scanning during each reload (scans then answer `error` and are retried). **ACCEPTED 2026-10-15** (orchestrator ruling): 2 GB with `ConcurrentDatabaseReload no`; 4 GB (about double the cost) only if Assumption A1 fails, and the orchestrator asks danlo before the cost changes.
13. **Download is in the row menu only when the file has a clean version**, and the viewer draws no Download for an unchecked file (spec §3.5 "cannot be opened"); the server refuses anyway.
14. **With no `SCANNER_URL`/`SCANNER_SECRET` (a developer's machine), the finish leaves the file Checking without spending an attempt**, and the pass records `documents.scanner` as failing "not configured". Fail closed: nothing opens unscanned.
15. **Only a clamd-stage error or an object CONFIRMED missing spends an attempt (deviation 17 has the second), and the retry pass has a breaker** (plan review C1; spec §3.4 amended: it said every error counts). The worker's error answer names its stage: `clamd` (clamd read this stream and answered ERROR about it) or `transport` (the object could not be fetched, a redirect, a non-200, a timeout, clamd unreachable or silent). The app spends an attempt ONLY on a well-formed 200 `{verdict:"error",stage:"clamd"}`; a 401, a 403, a network failure or junk leaves the version pending and spends nothing (`scan-client.ts`, Task 5). Without this, a wrong `SCANNER_CLIENTS` binding answers 403 to every scan while `/health` stays green, and three ticks (about 30 minutes) would delete every pending file as unscannable. The pass also HOLDS countable errors during its loop and spends them ONLY when the worker's INSTREAM self-test (a tiny fixed clean buffer, run inside `/health`) passes AGAIN after the loop (re-review N2a, replacing the first draft's "two failures and no verdict" count, which never tripped with one pending file); a failed self-test spends nothing and turns `documents.scanner` red. **The finish never spends:** it scans with `holdErrors` and leaves any countable error to the pass (re-review N2a). Accepted residual (plan review 8): the finish and the pass can scan the same fresh version at once; the first verdict recorded wins and the other answers `stale`; they can disagree only when one side meets a clamd error, which spends at most one attempt, so no removal can land under a clean verdict.
16. **Content clamd could not fully read is "unscannable", never clean** (plan review C2; spec §3.4 amended). clamd's defaults answer `OK` for content skipped under a scan limit or that is encrypted. The image sets `AlertExceedsMax yes` and `AlertEncrypted`, `AlertEncryptedArchive`, `AlertEncryptedDoc yes` (names read off the 1.4 image, A13), and sets NO limit below clamd 1.4's own defaults (re-review N1: the first draft LOWERED `MaxFileSize` to 30M and `MaxScanSize` to 100M against defaults of 100M and 400M, and those limits apply to every member an Office file unpacks to, so an ordinary XLSX export would have been deleted): `StreamMaxLength 100M`, `MaxFileSize 400M`, `MaxScanSize 1000M`, `MaxRecursion` and `MaxFiles` at their defaults. **ORCHESTRATOR RULING 2026-10-15:** a file that expands past those generous limits is treated as a decompression bomb: unscannable, removed, the generic note; accepted residual, no further owner question. The CI job proves a 300 MiB expansion scans clean and reports its time and peak memory (A1, A15); the shim maps `Heuristics.Limits.Exceeded.*` and `Heuristics.Encrypted.*` to `unscannable` (removed at once, object first, "Couldn't check this file"), never `infected`. **Owner ruling 2026-10-15 (remove, and say why):** a password-protected PDF, Word or Excel file, or an encrypted ZIP inside a DOCX, is removed exactly as any unscannable file, and its note names the reason: "Password-protected: remove the password and upload it again" / "Tiene contraseña: quítela y vuelva a subirlo". The reason is DATA, not card logic: 0079 keeps clamd's name on an unscannable version too (`scan_signature`, already staff-only under RLS), and ONE pure helper, `removedReason` in `@bis/db/document-rules` (browser-safe, so 2b's public page can use it), reads `Heuristics.Encrypted.*` as `"password"`. Why not a `scan_reason` column: the signature IS the reason in clamd's own words, the column already exists for infected versions, and a second column would be a second copy that could disagree with it; widening one CHECK and one CASE in a migration not yet applied anywhere is smaller. The view never sends the signature to a browser: `documentView` maps it to the scan state `"locked"` and drops it. A PDF that is only owner-locked (no password to open) is not "encrypted" to a reader and is expected to scan normally; that is an assumption (A13) the Preview check tests with one such file.
17. **Only an object CONFIRMED missing counts beyond clamd's own errors, bounded at three, and the retry order rotates** (re-review N2b, N3; final check R2, orchestrator ruling; spec §3.4 amended). The worker's error stage has three values. `clamd`: clamd answered ERROR about this stream. `missing`: storage said THIS object does not exist (a 404, or Supabase storage's 400 whose body says `statusCode` 404 / `not_found`); the APP then re-checks with its own service-role storage client (a `list` of the exact path) and counts it only when the object is confirmed gone for a READY version; if the object is there, or the check fails, nothing counts. `transport`: everything else, and it NEVER counts: any other 4xx (400, 401, 403, 429), any 5xx, a redirect, a network failure, EVERY timeout (fetch or clamd: slow storage or a clamd signature reload under `ConcurrentDatabaseReload no` must never walk files to unscannable), the size limit, clamd unreachable or silent. Countable errors take one attempt each, the third removing the file as unscannable with the generic note (N = 3, `scan_attempts`), so a genuinely missing object resolves itself in about three runs instead of reading "Checking" forever; they are spent ONLY after the self-test passes again in the same run. A file that keeps failing for a transport reason stays "Checking": `scan_tried_at` rotation keeps it from heading every run, the heartbeat names it, and runbook §8(d) is the deliberate end. 0079 adds `scan_tried_at`; the pass stamps it (verdict `tried`) BEFORE each scan and reads never-tried versions first, then the least recently tried, then the oldest.

## Assumptions (not verified by reading; each has a named check)

- **A1** (spec §9) clamd's resident memory with the current signatures, `ConcurrentDatabaseReload no`, fits a 2 GB machine with headroom. Check: the CI `scanner` job prints `docker stats --no-stream` after its scans (Task 10); at rollout, Fly's machine metrics after the first freshclam reload (Task 14 step 5). Pass: under 1.6 GiB. Fail: deviation 12's fallback.
- **A2** (spec §9) Fly's price for one always-on `shared-cpu-1x` 2 GB machine in `iad` is about $10–12 a month. Check: fly.io/docs/about/pricing at rollout (Task 14 step 1), the number written into the PR body.
- **A3** (spec §9, amended twice) the image's limits, none below clamd 1.4's defaults (`StreamMaxLength 100M`, `MaxFileSize 400M`, `MaxScanSize 1000M`), let a whole 25 MiB stream be READ, not only accepted. Check: the CI job's 25 MiB clean PDF answers `clean`, and a 25 MiB DOCX whose LAST member is the EICAR string answers `infected` (Task 4's `real-clamd.mjs`): a stream cut short or skipped past a limit could not find it.
- **A4** (spec §9) Supabase's signed GET URLs for the private `documents` bucket are fetchable from Fly's network with no IP allow-listing. Check: Task 14 step 7 (the EICAR on Preview reaches a verdict) and step 9 (production's catch-up leaves nothing pending).
- **A5** `clamav/clamav:1.4` keeps `clamd.conf` and `freshclam.conf` under `/etc/clamav/`, clamd listens on TCP 3310 (docs.clamav.net, read 2026-10-15: "clamd: 3310"), the image runs unprivileged as user `clamav` (its documented `--user clamav --entrypoint /init-unprivileged`), and `freshclam -d` and `clamd` daemonise with `Foreground no`. Check: Task 4 step 1 reads both conf files out of the image; the CI job's `/health` answers `clamd: true`.
- **A6** Real clamd flags the EICAR string inside a stored (uncompressed) DOCX zip member, the file Task 14's Preview check uploads (a raw EICAR file is refused by the app's type check before any scan, `content-check.ts:42-54`). Check: the CI job's `eicar.docx` answers `infected`.
- **A7** clamd's `VERSION` answer is `ClamAV <ver>/<db version>/<db date in ctime form>`, and V8's `Date.parse` reads that date. Check: the CI job asserts `signaturesAt` is within 7 days of now.
- **A8** Playwright's `webServer` takes an array, and an entry with `port` (no `url`) waits for a plain TCP listener (the fake clamd). Check: Task 10 step 6's `playwright test --list` loads the config; the orchestrator's e2e run starts all three.
- **A9** Alpine's `nodejs` package in the 1.4 image is Node 20 or later (global `fetch`, `AbortSignal.timeout`, web streams as async iterables). Check: Task 4 step 1 prints `node --version` inside the built image.
- **A10** PostgREST serves 0079's `security_invoker` view to a signed-in client exactly as 0078's (PR 1b's B6). Check: `record.test.ts`'s new case through PostgREST on the replica and in CI `verify`; Task 12 test 2 sees the row as the agency.
- **A11** `fly.toml`'s `auto_stop_machines = "off"` and a top-level `[checks]` TCP check are accepted by current flyctl. Check: `<FLYCTL> config validate` in Task 14 step 3.
- **A12** (carried, PR 1a A4) `storage.remove([path])` answers no error for a path already gone, so removing an infected object twice is harmless.
- **A13** (plan review C2) clamd 1.4 knows `AlertExceedsMax`, `AlertEncrypted`, `AlertEncryptedArchive`, `AlertEncryptedDoc`, `MaxFileSize`, `MaxScanSize`, `TCPAddr` by these names, reports skipped or encrypted content as `Heuristics.Limits.Exceeded.*` / `Heuristics.Encrypted.*`, and an owner-locked (no open password) PDF is not reported as encrypted. Check: Task 4 step 1 reads every name off `clamconf` in the image (clamd refuses to start on an unknown directive, which the CI job's health wait would show); the shim's mapping is unit-tested against the fake; the Preview check (Task 14 step 9) uploads one owner-locked PDF and expects it to open.
- **A14** (plan review 13) `freshclam --daemon` exits non-zero when its first update fails, which under `set -eu` would stop the machine; `start.sh` therefore lets it fail with a log line (the preloaded signatures stand and the heartbeat's age check covers staleness). Check: Task 4 step 7's local run and the CI job's `docker logs` show whether freshclam started; `<FLYCTL> logs` after the deploy.
- **A15** (re-review N1) an XLSX-shaped file of about 1 MB whose sheet unpacks to 300 MiB of XML scans CLEAN in under 20 s (comfortably inside the worker's own 25 s scan timeout; the pass's start window is 15 s, not 20 s — final whole-branch review M4) on the CI runner, and the machine's peak memory while doing it stays under 1.6 GiB. Check: the CI `scanner` job's `real-clamd.mjs` prints `scanMs` and asserts both clean and < 20 s; the job's memory step reads the container's cgroup `memory.peak`. Fly's shared CPU is slower than a runner: Task 14 step 5 re-reads the time from `<FLYCTL> logs` (the shim logs `ms` per scan) after the production smoke upload. Over 20 s on either: the orchestrator raises `SCAN_TIMEOUT_MS` and `DOCUMENT_SCAN_BUDGET_MS` together (the coupling test bounds the sum) before merge.

## File Structure

**Created**

| Path | Owner | Responsibility |
|---|---|---|
| `packages/db/supabase/migrations/0079_document_scan.sql` | bis-db-schema | scan columns, coherence check, pending index, `record_document_scan`, `document_scan_timeline`, `documents.scan_status` default |
| `packages/db/src/test/document-scan.test.ts` | bis-db-schema | 0079 on the replica: defaults, checks, the verdict's compare-and-set, ACL, the view's rows, fences and grants |
| `apps/web/src/lib/documents/scan-client.ts` (+ test) | bis-crm | the worker's two calls, HMAC-signed; config from env; never throws |
| `apps/web/src/lib/documents/scan-version.ts` (+ test) | bis-crm | one version's scan: mint the scanner URL, ask, delete-then-record on a virus or the third error |
| `apps/web/src/lib/documents/read-gate.test.ts` | bis-crm | source scan: `createSignedUrl(` only in `documents.ts`'s two mint functions; `signedScannerUrl` only in `scan-version.ts` |
| `apps/web/src/lib/documents/scan-state.ts` (+ test) | bis-crm | browser-safe: a row's scan state, its words, the card's re-read interval |
| `apps/web/src/lib/automations/passes/documents-scan.ts` (+ test) | bis-automations | the retry pass and the `documents.scanner` heartbeat |
| `services/scanner/{Dockerfile,fly.toml,start.sh,.dockerignore}` | bis-platform | the worker's image and deploy |
| `services/scanner/src/{server,hmac,config,allow,clamd,scan}.mjs` | bis-platform | the shim |
| `services/scanner/test/{fake-clamd,eicar,real-clamd}.mjs`, `services/scanner/test/{hmac,allow,clamd,server}.test.mjs` | bis-platform | the shim's tests, the fake for e2e, the real-clamd check |
| `docs/runbooks/scanner.md` | bis-platform | create, deploy, rotate, read health, roll back |
| `apps/web/e2e/documents-scan.spec.ts` | bis-e2e-qa | Checking → normal, the virus path, the slow state, the gate |

**Modified:** `packages/db/src/{documents,index,record}.ts`, `packages/db/src/test/{documents,record,schema-grants-guard}.test.ts`; `apps/web/src/lib/record/{author-mark,timeline-rows,recent-rows}.ts` (+ tests); both timelines (+ tests); `…/contacts/contact-drawer.tsx`; `apps/web/src/lib/contacts/drawer-summary.ts` (+ test); `…/summary/route.reads.test.ts`; `apps/web/src/lib/messages.ts`, `messages.test.ts`; `…/contacts/documents-actions.ts` (+ test); `apps/web/src/lib/documents/{documents-load,document-view}.ts`, `documents-load.test.ts`; both documents route tests; `…/contacts/{documents-card.tsx,document-viewer.tsx}` (+ tests), the handlers and purge-dialog tests (fixtures); the styleguide demo (+ test); `apps/web/src/lib/automations/{registry.ts,sentinel.test.ts,cron-coupling.test.ts}`; `apps/web/src/app/api/cron/reminders/route.test.ts`; `apps/web/src/lib/ops/watch.ts` (+ test); `apps/web/src/app/api/ops/health/route.ts` (+ test); `.github/workflows/ci.yml`; `apps/web/playwright.config.ts`; `apps/web/vitest.config.ts`; `.env.example`; `apps/web/src/lib/i18n/{catalogue,ratchet}-baseline.json`.

## Task list, owners, order

| # | Task | Owner | Review | Depends on | Files |
|---|---|---|---|---|---|
| 0 | Confirm the base | orchestrator | n/a | — | none |
| 1 | Migration 0079 and its proof on the replica; the replica kit | bis-db-schema | **opus** | 0 | the migration, `document-scan.test.ts`, the guard's line, `<SCRATCH>/s07c-kit/*` |
| 2 | Every key (**messages.ts, the only writer**) | bis-crm | sonnet | 0 | `lib/messages.ts`, `lib/messages.test.ts` |
| 3 | `@bis/db`: scan state in the reads, the read gate, the scanner's URL, the verdict, the pending reads, the removed-file timeline read | bis-crm | **opus** | 1 | `packages/db/src/{documents,index}.ts`, `test/documents.test.ts` |
| 3b | The timeline's removed-file rows (record.ts, both timelines, the drawer) | bis-crm | **opus** | 1, 2, 3 | `record.ts`, `record.test.ts`, `lib/record/*`, both timelines, `contact-drawer.tsx`, `drawer-summary*`, `route.reads.test.ts` |
| 4 | The worker: shim, image, fly.toml, tests, the fake clamd | bis-platform | **opus** | 0 | `services/scanner/**` |
| 5 | The app's scan client and the one-version scan procedure | bis-crm | **opus** | 3, 4 (the HMAC vector) | `lib/documents/{scan-client,scan-version}*` |
| 6 | The finish scans; the URL action through the gate; the source scan | bis-crm | **opus** | 2, 3, 5 | `…/contacts/documents-actions*`, `lib/documents/read-gate.test.ts` |
| 7 | The card's read: scan state in the view and the parser, `scan-state.ts` | bis-crm | sonnet | 2, 3 | `lib/documents/{documents-load,document-view,scan-state}*`, both route tests |
| 8 | The retry pass, the heartbeat, ops health, the watch label | bis-automations | **opus** | 3, 5, 7 | `passes/documents-scan*`, `registry.ts`, the three pinned automations tests, `lib/ops/watch*`, `api/ops/health/*` |
| 9 | The card and the viewer: states, re-read, Download only when clean; `/styleguide` | bis-frontend | **opus** | 2, 7 | `…/contacts/{documents-card,document-viewer}*`, two fixture tests, `styleguide/documents-demo*` |
| 10 | CI job, Playwright's fake scanner, the unit suite's scanner pin, `.env.example`, the runbook | bis-platform | sonnet | 4 | `ci.yml`, `playwright.config.ts`, `vitest.config.ts`, `.env.example`, `docs/runbooks/scanner.md` |
| 11 | Regenerate the i18n baselines | bis-crm | sonnet | 2, 3b, 6, 7, 9 | `lib/i18n/*-baseline.json` |
| 12 | The e2e spec | bis-e2e-qa | sonnet | 9, 10, 11 | `e2e/documents-scan.spec.ts` |
| 13 | Whole-branch final review (checkpoint) | reviewer | **opus** | 1–12, 3b | none |
| 14 | Rollout (orchestrator; LAST) | orchestrator | n/a | 13 | none in the repo |

```
Wave A (three lanes):  T1 (bis-db-schema)        T2 (bis-crm)              T4 (bis-platform)
Wave B (two lanes):    T3 (bis-crm, after T1)    T10 (bis-platform, after T4)
Wave C (three lanes):  T3b (bis-crm, after T1-T3)   T5 (bis-crm 2nd instance, after T3, T4)   T7 (bis-crm 3rd instance, after T2, T3)
Wave D (three lanes):  T6 (bis-crm, after T5)    T8 (bis-automations, after T5, T7)   T9 (bis-frontend, after T7)
Wave E:                T11
Wave F:                T12
Checkpoint:            T13
Rollout:               T14 (orchestrator, LAST)
```

Disjointness: T3b (`record.ts`, `lib/record/*`, the timelines, the drawer's maps, the reads test), T5 (`scan-client*`, `scan-version*`) and T7 (`documents-load*`, `document-view.ts`, `scan-state*`, the two route tests) share no file. T6 (actions, `read-gate.test.ts`), T8 (automations, ops) and T9 (card, viewer, demo, two fixture tests) share no file. T4 and T10 touch nothing under `apps/web/src` or `packages/`. The orchestrator may apply 0079 to bis-ci (Task 14 step 2) as soon as Task 1's review approves, so the e2e job's migration check (`.github/scripts/ci-migrations-applied.sh`) is green on the first push. The Fly app (Task 14 steps 1–5) can be created as soon as Task 4's review approves: it does not depend on the app code.

---

## Task 0: Confirm the base (orchestrator)

- [ ] **Step 1.** In `<WT>`: `git log --oneline -3` shows the plan commit, then `5d74ee58 docs(spec): the document vault part 2 …`, then `de3f3551 A file can get a new version …`. `git fetch origin && git log --oneline origin/main -1`; if `main` moved past `de3f3551`, `git merge origin/main` (never rebase in the shared tree) and re-run Step 2.
- [ ] **Step 1b.** `pnpm install --frozen-lockfile` in `<WT>` if `node_modules` is absent.
- [ ] **Step 2.** Confirm, and stop if any line differs:
  - `ls packages/db/supabase/migrations | tail -1` → `0078_document_space_used.sql`; `git log --all --oneline -- 'packages/db/supabase/migrations/0079*'` → nothing (if another branch holds a 0079, this plan's number becomes the next free one and every `0079` below is renamed in one commit, and 2b's numbers move with it).
  - `grep -n '"documents.status.purging.es"' apps/web/src/lib/messages.ts` → `3993:`; `wc -l < apps/web/src/lib/messages.test.ts` → `265`.
  - `grep -n 'scan_status: "skipped"' packages/db/src/documents.ts` → `115:`.
  - `grep -rn "createSignedUrl(" apps/web/src packages/db/src --include=*.ts | grep -v "\.test\.ts"` → exactly one line, `documents-actions.ts:312`.
  - `grep -n "const MEASURED = 24" "apps/web/src/app/api/accounts/[accountId]/contacts/[contactId]/summary/route.reads.test.ts"` → `58:`; `grep -nF 'rlsOff).toEqual(["document_version_timeline"])' packages/db/src/test/schema-grants-guard.test.ts` → `113:`.
  - `grep -n '"documentsSweep", "weeklyClientReport"' apps/web/src/lib/automations/sentinel.test.ts` → `280:`.
  - `ls <KITSRC>/postgrest.exe <KITSRC>/make-jwt.js <KITSRC>/proxy.mjs` → all three exist.
  - `docker version` answers (Task 4 builds the image locally; if Docker is absent on this machine, Task 4's step 7 moves to the CI job only, and the report says so).
- [x] **Step 3. DONE 2026-10-15:** danlo created the Fly.io account (org `personal`, card added); flyctl v0.4.118 is at `<FLYCTL>` and logged in. Confirm with `"/c/Users/danlo/.fly/bin/flyctl.exe" auth whoami` and `"/c/Users/danlo/.fly/bin/flyctl.exe" orgs list` (expect `personal`); no `fly` alias exists, so never type `fly …`.

---

## Task 1: Migration 0079 and its proof on the replica; the replica kit (bis-db-schema)

**Review:** opus. **Runs beside:** Tasks 2 and 4. **Scratch:** `<SCRATCH>/s07c-t1-impl/`, replica port `55560` (reviewer `s07c-t1-review/`, `55561`).

**Files**
- Create: `<SCRATCH>/s07c-kit/replica.sh`, `<SCRATCH>/s07c-kit/pgrst.sh` (outside the repo; the text is in "The replica kit")
- Create: `packages/db/supabase/migrations/0079_document_scan.sql`
- Create: `packages/db/src/test/document-scan.test.ts`
- Modify: `packages/db/src/test/schema-grants-guard.test.ts:113` and its comment (`:16-18`)

**Interfaces**
- Consumes (SQL): `public.document_versions`, `public.documents` (0077); `app.is_agency()`, `app.current_account_id()`; the `documents` RLS policies (`0077:133-145`); test helpers `withRollback`, `actAs`, `actAsMember` (`packages/db/src/test/db.ts:4-42`).
- Produces (SQL):
  - `document_versions.scan_status text not null default 'pending'` in (`pending`, `clean`, `infected`, `unscannable`); `scan_attempts integer not null default 0` (≥ 0); `scanned_at timestamptz`; `scan_tried_at timestamptz` (the retry pass's stamp, re-review N2b); `scan_signature text` (1–200 chars when set). Constraint `document_versions_scan_coherent`: `scanned_at` is null exactly while pending; a signature only on `infected` or `unscannable` (owner ruling 2026-10-15: an unscannable version keeps clamd's named cause); an `uploading` version is always `pending`.
  - Index `document_versions_scan_pending on (created_at) where status = 'ready' and scan_status = 'pending'`.
  - `documents.scan_status` default `'skipped'` (deviation 2).
  - `public.record_document_scan(p_account_id uuid, p_version_id uuid, p_verdict text, p_signature text) returns jsonb`, `SECURITY INVOKER`, `search_path = ''`, EXECUTE for `service_role` only. Answers `{"status":"ok","attempts":<int>,"document_id":"<uuid>"}` or `{"status":"stale"}`; raises `22004` on a null required argument or an infected verdict with no signature, `22023` on an unknown verdict.
  - `public.document_scan_timeline` (view, `security_invoker = true`): `id` (the version's), `document_id`, `account_id`, `scan_status`, `scanned_at`, `scan_signature`, `title`, `category`, `contact_id`, `client_group_id`, `deleted_at`; one row per READY version whose scan is `infected` or `unscannable`; SELECT for `authenticated` and `service_role`.

- [ ] **Step 1: Write the kit and build your replica.** Write both kit scripts exactly as "The replica kit" gives them (`chmod +x`). Then:

```bash
bash "/c/Users/danlo/AppData/Local/Temp/claude/C--Users-danlo-bis-platform/f54a0255-9568-420c-ad87-a4d62d6b9a05/scratchpad/s07c-kit/replica.sh" 55560 "/c/Users/danlo/AppData/Local/Temp/claude/C--Users-danlo-bis-platform/f54a0255-9568-420c-ad87-a4d62d6b9a05/scratchpad/s07c-t1-impl"
```

Expected: no `FAILED at` line, then `post = pre (no 0079 yet)`. Run the faithfulness digest on `pre` and on bis-ci; paste both; stop if they differ.

- [ ] **Step 2: Write the failing test** `packages/db/src/test/document-scan.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import type { Client } from "pg";
import { withRollback, actAs, actAsMember } from "./db";

/**
 * 0079, virus scanning's data (spec 3.2; plan deviations 1-3). As the table owner inside a rolled-back
 * transaction unless a case switches role. A refused statement runs under a savepoint (`attempt`), so
 * one refusal does not abort the rest of the case (25P02).
 */
const RUN = Math.random().toString(36).slice(2, 10);
const ORG = `org_scan_${RUN}`;
const FN = "public.record_document_scan(uuid,uuid,text,text)";

async function attempt(c: Client, sql: string, args: unknown[] = []) {
  await c.query("savepoint attempt");
  try { const r = await c.query(sql, args); await c.query("release savepoint attempt"); return r; }
  catch (e) { await c.query("rollback to savepoint attempt"); throw e; }
}

async function seed(c: Client) {
  const one = async (sql: string, args: unknown[]) => (await c.query<{ id: string }>(sql, args)).rows[0]!.id;
  const { rows: [agency] } = await c.query<{ id: string }>("select id from agencies limit 1");
  const acct = await one("insert into accounts (agency_id, clerk_org_id, name, client_access_enabled) values ($1,$2,'Scan Co',true) returning id", [agency!.id, ORG]);
  const other = await one("insert into accounts (agency_id, clerk_org_id, name, client_access_enabled) values ($1,$2,'Scan B',true) returning id", [agency!.id, `${ORG}_b`]);
  const ana = await one("insert into contacts (account_id, first_name) values ($1,'Ana') returning id", [acct]);
  const bea = await one("insert into contacts (account_id, first_name) values ($1,'Bea') returning id", [other]);
  return { acct, other, ana, bea };
}

/** A document on a contact, as the table owner. NO scan_status: 0079's default must fill it (deviation 2). */
async function doc(c: Client, acct: string, contact: string, o: { ownersOnly?: boolean; title?: string } = {}) {
  const { rows: [d] } = await c.query<{ id: string }>(
    `insert into documents (account_id, contact_id, title, category, source, created_by, owners_only)
     values ($1,$2,$3,'insurance','upload','user_sc',$4) returning id`,
    [acct, contact, o.title ?? "Lease", o.ownersOnly ?? false]);
  return d!.id;
}

/** A version row, ready (hashed) or still uploading, with NO scan columns: 0079's defaults fill them. */
async function version(c: Client, acct: string, documentId: string, ready = true) {
  const { rows: [v] } = await c.query<{ id: string }>("select gen_random_uuid() as id");
  await c.query(
    `insert into document_versions (id, document_id, account_id, storage_path, bytes, content_type, uploaded_by, status, sha256)
     values ($1,$2,$3,$4,10,'application/pdf','user_sc',$5,$6)`,
    [v!.id, documentId, acct, `${acct}/${documentId}/${v!.id}`, ready ? "ready" : "uploading", ready ? "c".repeat(64) : null]);
  return v!.id;
}

const record = async (c: Client, acct: string, versionId: string, verdict: string, signature: string | null = null) =>
  (await attempt(c, "select public.record_document_scan($1::uuid,$2::uuid,$3,$4) as r", [acct, versionId, verdict, signature]))
    .rows[0]!.r as { status: string; attempts?: number; document_id?: string };
const state = async (c: Client, versionId: string) =>
  (await c.query<{ scan_status: string; scan_attempts: number; scanned: boolean; scan_signature: string | null }>(
    "select scan_status, scan_attempts, scanned_at is not null as scanned, scan_signature from document_versions where id = $1", [versionId])).rows[0]!;

describe("0079 columns: every version starts pending, part 1's included (spec 3.2)", () => {
  it("a version inserted with no scan columns is pending, 0 attempts, unscanned; a document with no scan_status reads 'skipped' (mutations: default 'clean' -> FAILS; drop the documents default -> the insert FAILS 23502)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      const d = await doc(c, s.acct, s.ana);
      const v = await version(c, s.acct, d);
      expect(await state(c, v)).toEqual({ scan_status: "pending", scan_attempts: 0, scanned: false, scan_signature: null });
      const { rows: [row] } = await c.query<{ scan_status: string }>("select scan_status from documents where id = $1", [d]);
      expect(row!.scan_status).toBe("skipped");
    }));

  it("the coherence check refuses a scanned pending row, a signature on a clean one, and a clean uploading one (mutation: drop any one clause of document_versions_scan_coherent -> FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      const d = await doc(c, s.acct, s.ana);
      const ready = await version(c, s.acct, d);
      const uploading = await version(c, s.acct, d, false);
      for (const [sql, id] of [
        ["update document_versions set scanned_at = now() where id = $1", ready],
        ["update document_versions set scan_status = 'clean', scanned_at = now(), scan_signature = 'X' where id = $1", ready],
        ["update document_versions set scan_status = 'clean', scanned_at = now() where id = $1", uploading],
      ] as const) {
        await expect(attempt(c, sql, [id])).rejects.toMatchObject({ code: "23514", constraint: "document_versions_scan_coherent" });
      }
      await expect(attempt(c, "update document_versions set scan_status = 'quarantined' where id = $1", [ready]))
        .rejects.toMatchObject({ code: "23514", constraint: "document_versions_scan_status_check" });
    }));
});

describe("record_document_scan: a compare-and-set from pending (spec 3.2 bullet 5; plan deviation 3)", () => {
  it("clean: one attempt, scanned, no signature; a second verdict for the same version is stale (mutation: drop `scan_status = 'pending'` from the update -> the second answers ok -> FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      const d = await doc(c, s.acct, s.ana);
      const v = await version(c, s.acct, d);
      expect(await record(c, s.acct, v, "clean")).toEqual({ status: "ok", attempts: 1, document_id: d });
      expect(await state(c, v)).toEqual({ scan_status: "clean", scan_attempts: 1, scanned: true, scan_signature: null });
      expect(await record(c, s.acct, v, "infected", "Eicar-Test-Signature")).toEqual({ status: "stale" });
      expect((await state(c, v)).scan_status).toBe("clean");
    }));

  it("error: adds an attempt and stays pending, unscanned (mutation: map 'error' to 'unscannable' -> FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      const v = await version(c, s.acct, await doc(c, s.acct, s.ana));
      expect(await record(c, s.acct, v, "error")).toMatchObject({ status: "ok", attempts: 1 });
      expect(await record(c, s.acct, v, "error")).toMatchObject({ status: "ok", attempts: 2 });
      expect(await state(c, v)).toEqual({ scan_status: "pending", scan_attempts: 2, scanned: false, scan_signature: null });
    }));

  it("infected keeps the signature, trimmed and cut to 200; unscannable keeps none (mutation: drop left(...,200) -> the check refuses -> FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      const d = await doc(c, s.acct, s.ana);
      const a = await version(c, s.acct, d);
      const b = await version(c, s.acct, d);
      await record(c, s.acct, a, "infected", `  ${"W".repeat(250)}  `);
      expect(await state(c, a)).toEqual({ scan_status: "infected", scan_attempts: 1, scanned: true, scan_signature: "W".repeat(200) });
      await record(c, s.acct, b, "unscannable");
      expect(await state(c, b)).toEqual({ scan_status: "unscannable", scan_attempts: 1, scanned: true, scan_signature: null });
    }));

  it("an unscannable verdict keeps clamd's named cause (a password) and none when it names none (owner ruling 2026-10-15; mutation: keep the old 'infected only' CASE -> the cause is lost -> FAILS; drop the nullif -> an empty cause trips the length check -> FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      const d = await doc(c, s.acct, s.ana);
      const locked = await version(c, s.acct, d);
      const blank = await version(c, s.acct, d);
      await record(c, s.acct, locked, "unscannable", " Heuristics.Encrypted.PDF ");
      await record(c, s.acct, blank, "unscannable", "  ");
      expect(await state(c, locked)).toEqual({ scan_status: "unscannable", scan_attempts: 1, scanned: true, scan_signature: "Heuristics.Encrypted.PDF" });
      expect((await state(c, blank)).scan_signature).toBeNull();
    }));

  it("'tried' stamps scan_tried_at and nothing else; a non-pending version is stale (re-review N2b; mutations: count 'tried' as an attempt -> FAILS; stamp a scanned version -> FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      const v = await version(c, s.acct, await doc(c, s.acct, s.ana));
      expect(await record(c, s.acct, v, "tried")).toMatchObject({ status: "ok", attempts: 0 });
      const { rows: [t] } = await c.query<{ tried: boolean; scan_status: string; scan_attempts: number }>(
        "select scan_tried_at is not null as tried, scan_status, scan_attempts from document_versions where id = $1", [v]);
      expect(t).toEqual({ tried: true, scan_status: "pending", scan_attempts: 0 });
      await record(c, s.acct, v, "clean");
      expect(await record(c, s.acct, v, "tried")).toEqual({ status: "stale" });
    }));

  it("never an uploading version, never another account's (mutations: drop `status = 'ready'` -> FAILS; drop the account filter -> FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      const d = await doc(c, s.acct, s.ana);
      const uploading = await version(c, s.acct, d, false);
      expect(await record(c, s.acct, uploading, "clean")).toEqual({ status: "stale" });
      const theirs = await version(c, s.other, await doc(c, s.other, s.bea));
      expect(await record(c, s.acct, theirs, "clean")).toEqual({ status: "stale" });
      expect((await state(c, theirs)).scan_status).toBe("pending");
    }));

  it("refuses nulls (22004), an infected verdict with no signature (22004) and an unknown verdict (22023) (mutation: drop the signature guard -> FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      const v = await version(c, s.acct, await doc(c, s.acct, s.ana));
      await expect(record(c, s.acct, v, null as unknown as string)).rejects.toMatchObject({ code: "22004" });
      await expect(record(c, s.acct, v, "infected", "   ")).rejects.toMatchObject({ code: "22004" });
      await expect(record(c, s.acct, v, "maybe")).rejects.toMatchObject({ code: "22023" });
      expect((await state(c, v)).scan_attempts).toBe(0);
    }));

  it("executable by service_role only, SECURITY INVOKER, search_path empty (mutation: grant execute to authenticated -> FAILS)", () =>
    withRollback(async (c) => {
      const { rows } = await c.query<{ r: string; ok: boolean }>(
        `select r, has_function_privilege(r, '${FN}', 'EXECUTE') as ok
           from (values ('anon'), ('authenticated'), ('service_role')) v(r) order by 1`);
      expect(rows).toEqual([{ r: "anon", ok: false }, { r: "authenticated", ok: false }, { r: "service_role", ok: true }]);
      const { rows: [f] } = await c.query<{ prosecdef: boolean; proconfig: string[] }>(
        `select prosecdef, proconfig from pg_proc where oid = '${FN}'::regprocedure`);
      expect(f).toEqual({ prosecdef: false, proconfig: ['search_path=""'] });
    }));
});

const scanTimeline = async (c: Client) =>
  (await attempt(c, "select id, scan_status, title from public.document_scan_timeline order by scanned_at desc, id desc")).rows as
    { id: string; scan_status: string; title: string }[];

describe("document_scan_timeline: a row per removed version, under the caller's RLS (spec 3.5)", () => {
  it("infected and unscannable ready versions only, with their document's title (mutations: add 'clean' to the filter -> FAILS; drop `v.status = 'ready'` is caught by the coherence check, so the title join is the probe: join on v.id -> FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      const d = await doc(c, s.acct, s.ana, { title: "Lease" });
      const bad = await version(c, s.acct, d);
      const unread = await version(c, s.acct, d);
      const good = await version(c, s.acct, d);
      await version(c, s.acct, d); // stays pending
      await record(c, s.acct, bad, "infected", "Eicar-Test-Signature");
      await record(c, s.acct, unread, "unscannable");
      await record(c, s.acct, good, "clean");
      await actAsMember(c, s.acct, ORG, "owner");
      const rows = await scanTimeline(c);
      expect(rows.map((r) => r.id).sort()).toEqual([bad, unread].sort());
      expect(new Set(rows.map((r) => r.title))).toEqual(new Set(["Lease"]));
      expect(rows.find((r) => r.id === bad)!.scan_status).toBe("infected");
    }));

  it("Staff never see an Owners-only file's row, and another account's member sees none (mutation: security_invoker = false -> FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      const v = await version(c, s.acct, await doc(c, s.acct, s.ana, { ownersOnly: true }));
      await record(c, s.acct, v, "infected", "Eicar-Test-Signature");
      await actAsMember(c, s.acct, ORG, "owner");
      expect(await scanTimeline(c)).toHaveLength(1);
      await c.query("reset role");
      await actAsMember(c, s.acct, ORG, "staff");
      expect(await scanTimeline(c)).toEqual([]);
      await c.query("reset role");
      await actAsMember(c, s.other, `${ORG}_b`, "owner");
      expect(await scanTimeline(c)).toEqual([]);
      await c.query("reset role");
      await actAs(c, { app_role: "agency_admin", sub: `user_agency_${RUN}` });
      expect(await scanTimeline(c)).toHaveLength(1);
    }));

  it("security_invoker, SELECT for authenticated and service_role only, no write for anyone (mutation: drop the revoke -> authenticated INSERT appears -> FAILS)", () =>
    withRollback(async (c) => {
      const { rows: [v] } = await c.query<{ reloptions: string[] }>("select reloptions from pg_class where oid = 'public.document_scan_timeline'::regclass");
      expect(v!.reloptions).toEqual(["security_invoker=true"]);
      const { rows } = await c.query<{ r: string; sel: boolean; ins: boolean }>(
        `select r, has_table_privilege(r, 'public.document_scan_timeline', 'SELECT') as sel,
                has_table_privilege(r, 'public.document_scan_timeline', 'INSERT') as ins
           from (values ('anon'), ('authenticated'), ('service_role')) x(r) order by 1`);
      expect(rows).toEqual([
        { r: "anon", sel: false, ins: false }, { r: "authenticated", sel: true, ins: false }, { r: "service_role", sel: true, ins: false }]);
    }));
});

describe("the retry pass's index exists and is partial on ready + pending (spec 3.4)", () => {
  it("document_versions_scan_pending: partial on ready + pending, keyed (scan_tried_at nulls first, created_at, id) (mutations: drop the index -> FAILS; key it on created_at alone -> FAILS)", () =>
    withRollback(async (c) => {
      const { rows } = await c.query<{ def: string }>("select pg_get_indexdef('public.document_versions_scan_pending'::regclass) as def");
      expect(rows[0]!.def).toMatch(/WHERE \(\(status = 'ready'::text\) AND \(scan_status = 'pending'::text\)\)/);
      // Final check minor 2: the KEY is the retry order (never tried first, then least recently tried, then age).
      expect(rows[0]!.def).toMatch(/\(scan_tried_at NULLS FIRST, created_at, id\)/);
    }));
});
```

(Every case is red on `pre`: the columns, the function and the view do not exist. The index case's regex holds a backslash; that is a TEST file, not the migration.)

- [ ] **Step 3: Run it red** on `post` (still = `pre`):

```bash
cd /c/Users/danlo/bis-platform/.claude/worktrees/s07-2a
SUPABASE_DB_URL=postgresql://postgres@localhost:55560/post pnpm --filter @bis/db exec vitest run src/test/document-scan.test.ts > "/c/Users/danlo/AppData/Local/Temp/claude/C--Users-danlo-bis-platform/f54a0255-9568-420c-ad87-a4d62d6b9a05/scratchpad/s07c-t1-impl/red.log" 2>&1; echo $? > "/c/Users/danlo/AppData/Local/Temp/claude/C--Users-danlo-bis-platform/f54a0255-9568-420c-ad87-a4d62d6b9a05/scratchpad/s07c-t1-impl/red.exit"
```

Expected: the summary block shows 14 failed. (If the db suite's harness reads a different variable for its pg connection, use the one `packages/db/src/test/db.ts` reads; the kit's `env-run.sh` names it.)

- [ ] **Step 4: Write the migration** `packages/db/supabase/migrations/0079_document_scan.sql`:

```sql
-- 0079_document_scan.sql - the document vault, part 2a: virus scanning
-- (docs/superpowers/specs/2026-10-15-document-vault-part2-design.md section 3;
--  docs/superpowers/plans/2026-10-15-document-vault-pr2a.md)
--
-- Every stored version is scanned before anyone can open it (owner decision P3). The state lives
-- on the VERSION: pending until a verdict, then clean, infected or unscannable. Part 1's rows take
-- the default, pending, which is what makes the retry pass scan them once (the catch-up).
-- documents.current_version_id keeps 0077's meaning (the newest ready version, which lists the
-- file): what may be OPENED is decided by the one mint function in packages/db/src/documents.ts,
-- which re-reads the version and refuses unless it is clean (plan deviation 1). So 0077's trigger
-- and mark_document_version_ready are untouched.
-- documents.scan_status (0077, per document, always 'skipped') is retired: the app stops writing
-- it with this migration's build and it gets a default here. It is NOT dropped here: this file
-- applies before the merge, and the build running then still writes it (plan deviation 2). The
-- drop is the first statement of 0080.
--
-- 1. Scan columns on document_versions and one check that keeps them coherent.
-- 2. The retry pass's partial index.
-- 3. record_document_scan: the one write of a verdict. A compare-and-set from pending on a READY
--    version of that account; error adds an attempt and stays pending. SECURITY INVOKER with an
--    empty search_path, EXECUTE for service_role only (record_heartbeat's shape, 0057): it writes
--    with service_role's own grants (0077 section 3). The app deletes an infected object BEFORE it
--    records the verdict, so a crash leaves the version pending and the next pass finds it again.
-- 4. document_scan_timeline: the removed-file timeline rows, security_invoker so the documents
--    policies decide (0078's view's shape). The second reviewed view in public
--    (schema-grants-guard.test.ts).
--
-- APPLY ORDER: CI project (ci-project-setup.yml: push-dry-run, then push), then production (MCP
-- apply_migration, once), then the parity check, then merge. Additive for the build before it:
-- that build reads none of the new columns and keeps writing documents.scan_status.
-- ROLLBACK (revert the app first):
--   drop view public.document_scan_timeline;
--   drop function public.record_document_scan(uuid, uuid, text, text);
--   drop index public.document_versions_scan_pending;
--   alter table public.document_versions drop constraint document_versions_scan_coherent, drop column scan_tried_at,
--     drop column scan_signature, drop column scanned_at, drop column scan_attempts, drop column scan_status;
--   alter table public.documents alter column scan_status drop default;
--
-- ASCII only, no backslash anywhere.

set local lock_timeout = '5s';

-- 1. The scan state. A constant default is a catalog-only change; the checks read every row once.
alter table public.document_versions
  add column scan_status text not null default 'pending'
    constraint document_versions_scan_status_check check (scan_status in ('pending', 'clean', 'infected', 'unscannable')),
  add column scan_attempts integer not null default 0
    constraint document_versions_scan_attempts_check check (scan_attempts >= 0),
  add column scanned_at timestamptz,
  add column scan_tried_at timestamptz,
  add column scan_signature text
    constraint document_versions_scan_signature_check check (scan_signature is null or char_length(scan_signature) between 1 and 200);

alter table public.document_versions add constraint document_versions_scan_coherent check (
  (scan_status = 'pending') = (scanned_at is null)
  and (scan_signature is null or scan_status in ('infected', 'unscannable'))
  and (status = 'ready' or scan_status = 'pending'));

comment on column public.document_versions.scan_status is
  'Virus scan (0079): pending until a verdict, then clean, infected or unscannable. Only a clean version may be opened (the mint function in packages/db/src/documents.ts). An infected or unscannable version has had its object deleted.';
comment on column public.document_versions.scan_signature is
  'clamd''s name for an infected version, or for an unscannable one when clamd named its cause (Heuristics.Encrypted.* = password-protected; owner ruling 2026-10-15) (0079). Staff-only through the documents RLS; never in an event payload or a browser.';

alter table public.documents alter column scan_status set default 'skipped';
comment on column public.documents.scan_status is
  'Retired by 0079: the scan state lives on document_versions.scan_status. Nothing reads it; 0079''s build stops writing it; 0080 drops it.';

-- 2. The retry pass reads ready + pending versions never tried first, then least recently tried, then
--    oldest (re-review N2b: a version that always times out must not head every run).
create index document_versions_scan_pending on public.document_versions (scan_tried_at nulls first, created_at, id)
  where status = 'ready' and scan_status = 'pending';

-- 3. The one write of a verdict.
create function public.record_document_scan(p_account_id uuid, p_version_id uuid, p_verdict text, p_signature text)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare v_attempts integer; v_document uuid;
begin
  if p_account_id is null or p_version_id is null or p_verdict is null then
    raise exception 'record_document_scan: a required argument is null' using errcode = '22004';
  end if;
  if p_verdict not in ('clean', 'infected', 'unscannable', 'error', 'tried') then
    raise exception 'record_document_scan: unknown verdict' using errcode = '22023';
  end if;
  if p_verdict = 'infected' and coalesce(btrim(p_signature), '') = '' then
    raise exception 'record_document_scan: an infected verdict names its signature' using errcode = '22004';
  end if;
  -- 'tried': the retry pass stamps a version before it scans it; nothing else changes.
  if p_verdict = 'tried' then
    update public.document_versions v set scan_tried_at = now()
     where v.id = p_version_id and v.account_id = p_account_id and v.status = 'ready' and v.scan_status = 'pending'
    returning v.scan_attempts, v.document_id into v_attempts, v_document;
    if not found then return jsonb_build_object('status', 'stale'); end if;
    return jsonb_build_object('status', 'ok', 'attempts', v_attempts, 'document_id', v_document);
  end if;
  update public.document_versions v
     set scan_attempts = v.scan_attempts + 1,
         scan_tried_at = now(),
         scan_status = case when p_verdict = 'error' then 'pending' else p_verdict end,
         scanned_at = case when p_verdict = 'error' then null else now() end,
         scan_signature = case when p_verdict = 'infected' then left(btrim(p_signature), 200)
                               when p_verdict = 'unscannable' then nullif(left(btrim(coalesce(p_signature, '')), 200), '')
                               else null end
   where v.id = p_version_id and v.account_id = p_account_id and v.status = 'ready' and v.scan_status = 'pending'
  returning v.scan_attempts, v.document_id into v_attempts, v_document;
  if not found then return jsonb_build_object('status', 'stale'); end if;
  return jsonb_build_object('status', 'ok', 'attempts', v_attempts, 'document_id', v_document);
end $$;

revoke all on function public.record_document_scan(uuid, uuid, text, text) from public, anon, authenticated, service_role;
grant execute on function public.record_document_scan(uuid, uuid, text, text) to service_role;

-- 4. The removed-file timeline rows (spec 3.5): the automation removed a file, at its verdict.
create view public.document_scan_timeline with (security_invoker = true) as
  select v.id, v.document_id, v.account_id, v.scan_status, v.scanned_at, v.scan_signature,
         d.title, d.category, d.contact_id, d.client_group_id, d.deleted_at
    from public.document_versions v
    join public.documents d on d.id = v.document_id and d.account_id = v.account_id
   where v.status = 'ready' and v.scan_status in ('infected', 'unscannable');

revoke all on public.document_scan_timeline from public, anon, authenticated, service_role;
grant select on public.document_scan_timeline to authenticated, service_role;

comment on view public.document_scan_timeline is
  'One row per removed version (0079): infected or unscannable, at scanned_at. security_invoker, so the RLS of documents and document_versions decides what each caller sees.';
```

- [ ] **Step 5: ASCII and backslash check, with a positive control:**

```bash
cd /c/Users/danlo/bis-platform/.claude/worktrees/s07-2a
node -e 'const fs=require("fs");const chk=(b)=>[...b].filter(x=>x>127||x===92).length;const f=fs.readFileSync("packages/db/supabase/migrations/0079_document_scan.sql");console.log("0079 bad bytes:",chk(f));console.log("control (expect 3):",chk(Buffer.from("a"+String.fromCharCode(92)+String.fromCharCode(233),"utf8")))'
```

Expected: `0079 bad bytes: 0` and `control (expect 3): 3` (the control holds one backslash byte and the two bytes of é, so the counter is proven to see both kinds). Any nonzero first number: fix the file.

- [ ] **Step 6: Rebuild and run green.** Re-run Step 1's `replica.sh` (now `post = pre + 0079`), then Step 3's command → the summary block shows 14 passed.

- [ ] **Step 7: The guard.** In `packages/db/src/test/schema-grants-guard.test.ts:113` change `toEqual(["document_version_timeline"])` to `toEqual(["document_scan_timeline", "document_version_timeline"])`, and extend the comment at `:16-18` with one sentence: "0079 adds the second, document_scan_timeline (security_invoker; removed-file timeline rows), reviewed in the S-07 2a plan." Run `schema-grants-guard.test.ts`, `document-vault-schema.test.ts`, `document-vault-rls.test.ts`, `document-vault-reserve-lock.test.ts` and `document-space-used.test.ts` on `post` → all pass (deviation 2: their explicit `scan_status` inserts stand).

- [ ] **Step 8: Probes, red BY NAME, restored by editing back** (rebuild the replica after each SQL probe): (1) `default 'clean'` → case 1; (2) remove `and v.scan_status = 'pending'` → the clean case; (3) `case when p_verdict = 'error' then 'unscannable'` (and `now()` for scanned_at) → the error case; (4) remove `and v.status = 'ready'` → the uploading half of its case (the coherence check then refuses the clean update with 23514, which the case's `toEqual({status:"stale"})` also catches: report which); (5) `security_invoker = false` → the Staff case; (6) grant execute to authenticated → the ACL case; (7) drop the signature guard → its case.

- [ ] **Step 9: Commit.** `git add -- packages/db/supabase/migrations/0079_document_scan.sql packages/db/src/test/document-scan.test.ts` then `git commit -m "feat(db): 0079, a scan state per document version, the one verdict write, the removed-file timeline view (S-07 part 2a)" -- packages/db/supabase/migrations/0079_document_scan.sql packages/db/src/test/document-scan.test.ts packages/db/src/test/schema-grants-guard.test.ts`

---

## Task 2: Every key (bis-crm; messages.ts, the only writer)

**Review:** sonnet. **Runs beside:** Tasks 1 and 4.

**Files**
- Modify: `apps/web/src/lib/messages.ts` (a block directly after `"documents.status.purging.es"`, line 3993)
- Modify: `apps/web/src/lib/messages.test.ts` (one new `describe` after line 265, the file's last)

**Interfaces**
- Produces (every later task uses exactly these keys; nothing else is added anywhere):

| Key | English | Spanish |
|---|---|---|
| `documents.status.scanning` | Checking | Revisando |
| `documents.status.scanSlow` | Taking longer than usual | Tarda más de lo normal |
| `documents.status.virusRemoved` | Removed: it had a virus | Quitado: tenía un virus |
| `documents.status.unscannable` | Couldn't check this file | No se pudo revisar este archivo |
| `documents.viewer.scanning` | This file opens once it has been checked for viruses. That usually takes a few seconds. | Este archivo se abre cuando termine la revisión de virus. Normalmente tarda unos segundos. |
| `documents.viewer.virusRemoved` | This file had a virus, so it was removed. Move it to the trash, or upload a new version. | Este archivo tenía un virus, así que se quitó. Muévalo a la papelera o suba una versión nueva. |
| `documents.viewer.unscannable` | We couldn't check this file for viruses, so it was removed. Upload it again. | No pudimos revisar este archivo, así que se quitó. Vuelva a subirlo. |
| `documents.error.scanning` | This file is still being checked. Try again in a moment. | Este archivo todavía se está revisando. Intente de nuevo en un momento. |
| `documents.error.removed` | This file was removed and can't be opened. | Este archivo se quitó y no se puede abrir. |
| `timeline.documentRemoved` | removed {title}: it had a virus | quitó {title}: tenía un virus |
| `timeline.documentUnscannable` | removed {title}: it couldn't be checked | quitó {title}: no se pudo revisar |
| `documents.status.passwordRemoved` | Password-protected: remove the password and upload it again | Tiene contraseña: quítela y vuelva a subirlo |
| `documents.viewer.passwordRemoved` | This file has a password, so we couldn't check it for viruses and it was removed. Remove the password and upload it again. | Este archivo tiene contraseña, así que no pudimos revisarlo y se quitó. Quítele la contraseña y vuelva a subirlo. |
| `timeline.documentPassword` | removed {title}: it has a password | quitó {title}: tiene contraseña |

The three password keys are the owner's ruling of 2026-10-15 ("remove, and say why"), in usted; the generic unscannable keys stay for every other cause.

The two timeline verbs follow `timeline.documentVersion`'s voice (`messages.ts:3990-3991`): third person after the mark (deviation 10). No key names a vendor or the word "scanner".

- [ ] **Step 1: Write the failing test.** Append to `apps/web/src/lib/messages.test.ts`, after line 265:

```ts
describe("the document vault's copy, PR 2a (virus scanning)", () => {
  const WANT: Record<string, [string, string]> = {
    "documents.status.scanning": ["Checking", "Revisando"],
    "documents.status.scanSlow": ["Taking longer than usual", "Tarda más de lo normal"],
    "documents.status.virusRemoved": ["Removed: it had a virus", "Quitado: tenía un virus"],
    "documents.status.unscannable": ["Couldn't check this file", "No se pudo revisar este archivo"],
    "documents.viewer.scanning": ["This file opens once it has been checked for viruses. That usually takes a few seconds.", "Este archivo se abre cuando termine la revisión de virus. Normalmente tarda unos segundos."],
    "documents.viewer.virusRemoved": ["This file had a virus, so it was removed. Move it to the trash, or upload a new version.", "Este archivo tenía un virus, así que se quitó. Muévalo a la papelera o suba una versión nueva."],
    "documents.viewer.unscannable": ["We couldn't check this file for viruses, so it was removed. Upload it again.", "No pudimos revisar este archivo, así que se quitó. Vuelva a subirlo."],
    "documents.error.scanning": ["This file is still being checked. Try again in a moment.", "Este archivo todavía se está revisando. Intente de nuevo en un momento."],
    "documents.error.removed": ["This file was removed and can't be opened.", "Este archivo se quitó y no se puede abrir."],
    "timeline.documentRemoved": ["removed {title}: it had a virus", "quitó {title}: tenía un virus"],
    "timeline.documentUnscannable": ["removed {title}: it couldn't be checked", "quitó {title}: no se pudo revisar"],
    "documents.status.passwordRemoved": ["Password-protected: remove the password and upload it again", "Tiene contraseña: quítela y vuelva a subirlo"],
    "documents.viewer.passwordRemoved": ["This file has a password, so we couldn't check it for viruses and it was removed. Remove the password and upload it again.", "Este archivo tiene contraseña, así que no pudimos revisarlo y se quitó. Quítele la contraseña y vuelva a subirlo."],
    "timeline.documentPassword": ["removed {title}: it has a password", "quitó {title}: tiene contraseña"],
  };
  it("every new key is the plan's wording, in both languages (mutation: any word changed, or a tú form such as 'Mueve' -> FAILS)", () => {
    for (const [k, [en, es]] of Object.entries(WANT)) {
      expect([m[k as MessageKey], m[`${k}.es` as MessageKey]], k).toEqual([en, es]);
    }
  });
  it("no new string names the machinery (mutation: 'The scanner is checking this file' -> FAILS)", () => {
    for (const k of Object.keys(WANT)) {
      for (const text of [m[k as MessageKey], m[`${k}.es` as MessageKey]]) {
        expect(typeof text, k).toBe("string");
        expect(/clamav|scanner|escáner|fly|supabase|signature|firma|storage/i.test(text ?? "x"), k).toBe(false);
      }
    }
  });
});
```

(Both cases are red today: `m[k]` is `undefined`; in case 2 `toMatch` on `undefined` throws.)

- [ ] **Step 2: Run it.** `pnpm --filter web exec vitest run src/lib/messages.test.ts` → the two new cases FAIL by name.

- [ ] **Step 3: Add the keys.** Directly after line 3993 (`"documents.status.purging.es": "Se está borrando",`), insert:

```ts
  // S-07 part 2a: virus scanning (plan 2026-10-15). Rule 3: each state is drawn as a dot AND these words.
  "documents.status.scanning": "Checking",
  "documents.status.scanning.es": "Revisando",
  "documents.status.scanSlow": "Taking longer than usual",
  "documents.status.scanSlow.es": "Tarda más de lo normal",
  "documents.status.virusRemoved": "Removed: it had a virus",
  "documents.status.virusRemoved.es": "Quitado: tenía un virus",
  "documents.status.unscannable": "Couldn't check this file",
  "documents.status.unscannable.es": "No se pudo revisar este archivo",
  "documents.viewer.scanning": "This file opens once it has been checked for viruses. That usually takes a few seconds.",
  "documents.viewer.scanning.es": "Este archivo se abre cuando termine la revisión de virus. Normalmente tarda unos segundos.",
  "documents.viewer.virusRemoved": "This file had a virus, so it was removed. Move it to the trash, or upload a new version.",
  "documents.viewer.virusRemoved.es": "Este archivo tenía un virus, así que se quitó. Muévalo a la papelera o suba una versión nueva.",
  "documents.viewer.unscannable": "We couldn't check this file for viruses, so it was removed. Upload it again.",
  "documents.viewer.unscannable.es": "No pudimos revisar este archivo, así que se quitó. Vuelva a subirlo.",
  "documents.error.scanning": "This file is still being checked. Try again in a moment.",
  "documents.error.scanning.es": "Este archivo todavía se está revisando. Intente de nuevo en un momento.",
  "documents.error.removed": "This file was removed and can't be opened.",
  "documents.error.removed.es": "Este archivo se quitó y no se puede abrir.",
  "timeline.documentRemoved": "removed {title}: it had a virus",
  "timeline.documentRemoved.es": "quitó {title}: tenía un virus",
  "timeline.documentUnscannable": "removed {title}: it couldn't be checked",
  "timeline.documentUnscannable.es": "quitó {title}: no se pudo revisar",
  // Owner ruling 2026-10-15: a password-protected file is removed AND the note says why.
  "documents.status.passwordRemoved": "Password-protected: remove the password and upload it again",
  "documents.status.passwordRemoved.es": "Tiene contraseña: quítela y vuelva a subirlo",
  "documents.viewer.passwordRemoved": "This file has a password, so we couldn't check it for viruses and it was removed. Remove the password and upload it again.",
  "documents.viewer.passwordRemoved.es": "Este archivo tiene contraseña, así que no pudimos revisarlo y se quitó. Quítele la contraseña y vuelva a subirlo.",
  "timeline.documentPassword": "removed {title}: it has a password",
  "timeline.documentPassword.es": "quitó {title}: tiene contraseña",
```

- [ ] **Step 4: Run.** `pnpm --filter web exec vitest run src/lib/messages.test.ts src/lib/i18n/ratchet.test.ts` → the new describe PASSES; the ratchet's twin check passes (its baseline count may fail ONLY on the new keys until Task 11; say so). `pnpm --filter web typecheck` → clean.

- [ ] **Step 5: Probes.** (a) `documents.viewer.virusRemoved.es` → "Muévelo…" (tú) → case 1 FAILS naming the key; revert. (b) `documents.status.scanning` → "Scanner checking" → case 2 FAILS; revert.

- [ ] **Step 6: Commit.** `git commit -m "feat(i18n): the document vault's scanning copy, both languages (S-07 part 2a)" -- apps/web/src/lib/messages.ts apps/web/src/lib/messages.test.ts`

---

## Task 3: `@bis/db`: scan state in the reads, the read gate, the scanner's URL, the verdict, the pending reads (bis-crm)

**Review:** opus. **After:** Task 1 (0079 committed). **Scratch:** `<SCRATCH>/s07c-t3-impl/`; replica + PostgREST on `55562`/`55563`/`55564` (reviewer `55565`/`55566`/`55567`), built with the kit. **Never against bis-ci.**

**Files**
- Modify: `packages/db/src/documents.ts` (types and `VERSION_COLS` at `:22-35`; `createDocument` at `:108-119`; new functions appended after `listDocumentVersionTimeline`, `:503-516`)
- Modify: `packages/db/src/index.ts` (the documents export block, `:270-280`, and the document-rules block below it)
- Modify: `packages/db/src/document-rules.ts` (one helper, Step 4b; owner ruling 2026-10-15)
- Modify: `packages/db/src/test/documents.test.ts` (import list `:6-13`; one new `describe` at the end)

**Interfaces**
- Consumes: 0079's columns, `record_document_scan`, `document_scan_timeline` (Task 1); `withTimelinePage(q, column, page)` (`packages/db/src/timeline-cursor.ts:75-79`, any column) and `forContacts`, both already imported at `documents.ts:3`; `emitAfter` (`documents.ts:45-53`).
- Produces (exact names and types; Tasks 3b, 5, 6, 7, 8 rely on them):

```ts
export type ScanStatus = "pending" | "clean" | "infected" | "unscannable";
// DocumentVersionRow gains: scan_status: ScanStatus   (VERSION_COLS gains "scan_status"; every embed carries it)
export type ReadUrlOutcome = { status: "ok"; url: string } | { status: "pending" | "removed" | "not_ready" | "not_found" };
export async function signedDocumentReadUrl(db: SupabaseClient, accountId: string, versionId: string, o: { seconds: number; download?: string }): Promise<ReadUrlOutcome>;
export const SCANNER_URL_SECONDS = 120;
export async function signedScannerUrl(db: SupabaseClient, storagePath: string): Promise<string>;
export type ScanVerdictInput = "clean" | "infected" | "unscannable" | "error" | "tried";
export type RecordScanOutcome = { status: "ok"; attempts: number } | { status: "stale" };
export async function recordDocumentScan(db: SupabaseClient, a: { accountId: string; versionId: string; verdict: ScanVerdictInput; signature?: string | null }): Promise<RecordScanOutcome>;
export type PendingScan = { id: string; account_id: string; document_id: string; storage_path: string; scan_attempts: number; created_at: string; scan_tried_at: string | null };
export async function listPendingScans(db: SupabaseClient, limit: number): Promise<PendingScan[]>;
export async function oldestPendingScanAt(db: SupabaseClient): Promise<string | null>;
export type TimelineDocumentScan = { id: string; document_id: string; scan_status: "infected" | "unscannable"; scan_signature: string | null; scanned_at: string; title: string; category: DocumentCategory; deleted_at: string | null; contact_id: string | null; client_group_id: string | null };
export async function listDocumentScanTimeline(db: SupabaseClient, accountId: string, who: string | readonly string[], groupId: string | null, page: TimelinePageOpts): Promise<TimelineDocumentScan[]>;
```

- [ ] **Step 1: Build your replica and PostgREST** with the kit (`replica.sh 55562 …/s07c-t3-impl`, then `pgrst.sh 55562 55563 55564 …/s07c-t3-impl`). Expect `post = pre + 0079`.

- [ ] **Step 2: Write the failing tests.** In `packages/db/src/test/documents.test.ts`, add to the `../documents` import list (`:6-13`): `signedDocumentReadUrl, signedScannerUrl, recordDocumentScan, listPendingScans, oldestPendingScanAt, listDocumentScanTimeline`. Append at the end of the file:

```ts
describe("virus scanning's reads and writes (S-07 2a; spec 3.2-3.4)", () => {
  /** A version's verdict as the service client records it after a scan, for the read cases. */
  const verdict = (db: SupabaseClient, accountId: string, versionId: string, v: "clean" | "infected" | "unscannable") =>
    recordDocumentScan(db, { accountId, versionId, verdict: v, signature: v === "infected" ? "Eicar-Test-Signature" : null });

  it("the card's read carries each version's scan state; a new upload is pending (mutation: drop scan_status from VERSION_COLS -> undefined -> FAILS)", () =>
    withTestAccount(async (db, accountId) => {
      const ana = (await createContact(db, accountId, { firstName: "Ana" }, ACTOR)).id;
      const d = await readyDoc(db, accountId, ana);
      const list = await listRecordDocuments(db, accountId, { kind: "contact", id: ana });
      expect(list.live[0]!.version.scan_status).toBe("pending");
      expect(list.live[0]!.versions.map((v) => v.scan_status)).toEqual(["pending"]);
      await verdict(db, accountId, d.versionId, "clean");
      const again = await listRecordDocuments(db, accountId, { kind: "contact", id: ana });
      expect(again.live[0]!.version.scan_status).toBe("clean");
    }));

  it("the read gate refuses every state but clean WITHOUT touching storage (the replica's gateway 404s any storage call, so a mint would throw) (mutation: drop the scan checks -> the pending case reaches storage and throws -> FAILS)", () =>
    withTestAccount(async (db, accountId) => {
      const ana = (await createContact(db, accountId, { firstName: "Ana" }, ACTOR)).id;
      const pending = await readyDoc(db, accountId, ana, { title: "P" });
      const infected = await readyDoc(db, accountId, ana, { title: "I" });
      const unscannable = await readyDoc(db, accountId, ana, { title: "U" });
      await verdict(db, accountId, infected.versionId, "infected");
      await verdict(db, accountId, unscannable.versionId, "unscannable");
      const id = await createDocument(db, { accountId, record: { kind: "contact", id: ana }, title: "Up", category: "other", expiresOn: null, ownersOnly: false, source: "upload", createdBy: ACTOR });
      const up = await reserveDocumentVersion(db, { accountId, documentId: id, bytes: 10, contentType: "application/pdf", originalName: null, uploadedBy: ACTOR });
      if (up.status !== "ok") throw new Error(up.status);
      const ask = (versionId: string) => signedDocumentReadUrl(db, accountId, versionId, { seconds: 120 });
      expect(await ask(pending.versionId)).toEqual({ status: "pending" });
      expect(await ask(infected.versionId)).toEqual({ status: "removed" });
      expect(await ask(unscannable.versionId)).toEqual({ status: "removed" });
      expect(await ask(up.versionId)).toEqual({ status: "not_ready" });
      expect(await ask("00000000-0000-4000-8000-000000000000")).toEqual({ status: "not_found" });
    }));

  it("the read gate reads the version ITSELF, scoped to the account: another account's clean version is not_found (mutation: drop .eq('account_id') -> it reaches storage and throws -> FAILS)", () =>
    withTestAccount(async (db, accountId) =>
      withTestAccount(async (dbB, accountB) => {
        const bea = (await createContact(dbB, accountB, { firstName: "Bea" }, ACTOR)).id;
        const theirs = await readyDoc(dbB, accountB, bea);
        await verdict(dbB, accountB, theirs.versionId, "clean");
        expect(await signedDocumentReadUrl(db, accountId, theirs.versionId, { seconds: 120 })).toEqual({ status: "not_found" });
      })));

  it("a verdict is a compare-and-set; a virus or an unscannable file is announced with the document and version ids only, as the system (mutations: put the title in the payload -> FAILS; emit as 'user' -> FAILS; emit document.virus_removed for every verdict -> FAILS)", () =>
    withTestAccount(async (db, accountId) => {
      const ana = (await createContact(db, accountId, { firstName: "Ana" }, ACTOR)).id;
      const a = await readyDoc(db, accountId, ana, { title: "Lease" });
      const b = await readyDoc(db, accountId, ana, { title: "Plan" });
      const c = await readyDoc(db, accountId, ana, { title: "Ok" });
      expect(await recordDocumentScan(db, { accountId, versionId: a.versionId, verdict: "error" })).toEqual({ status: "ok", attempts: 1 });
      expect(await recordDocumentScan(db, { accountId, versionId: a.versionId, verdict: "infected", signature: "Eicar-Test-Signature" })).toEqual({ status: "ok", attempts: 2 });
      expect(await recordDocumentScan(db, { accountId, versionId: a.versionId, verdict: "clean" })).toEqual({ status: "stale" });
      await recordDocumentScan(db, { accountId, versionId: b.versionId, verdict: "unscannable" });
      await recordDocumentScan(db, { accountId, versionId: c.versionId, verdict: "clean" });
      expect(await events(db, accountId, "document.virus_removed")).toEqual([
        { actor_type: "system", actor_id: "documents-scan", payload: { documentId: a.id, versionId: a.versionId } }]);
      expect(await events(db, accountId, "document.unscannable")).toEqual([
        { actor_type: "system", actor_id: "documents-scan", payload: { documentId: b.id, versionId: b.versionId } }]);
    }));

  it("the retry pass reads ready + pending versions oldest first, with their attempts; never an uploading one, never a scanned one; the oldest pending instant likewise (mutations: drop .eq('status','ready') -> FAILS; order descending -> FAILS)", () =>
    withTestAccount(async (db, accountId) => {
      const ana = (await createContact(db, accountId, { firstName: "Ana" }, ACTOR)).id;
      const first = await readyDoc(db, accountId, ana, { title: "First" });
      const second = await readyDoc(db, accountId, ana, { title: "Second" });
      const done = await readyDoc(db, accountId, ana, { title: "Done" });
      await verdict(db, accountId, done.versionId, "clean");
      await recordDocumentScan(db, { accountId, versionId: second.versionId, verdict: "error" });
      const id = await createDocument(db, { accountId, record: { kind: "contact", id: ana }, title: "Up", category: "other", expiresOn: null, ownersOnly: false, source: "upload", createdBy: ACTOR });
      const up = await reserveDocumentVersion(db, { accountId, documentId: id, bytes: 10, contentType: "application/pdf", originalName: null, uploadedBy: ACTOR });
      if (up.status !== "ok") throw new Error(up.status);
      // Other accounts' rows may exist on a shared stack: judge only this account's.
      const mine = (await listPendingScans(db, 1000)).filter((p) => p.account_id === accountId);
      expect(mine.map((p) => [p.id, p.scan_attempts])).toEqual([[first.versionId, 0], [second.versionId, 1]]);
      expect(mine[0]!.storage_path).toBe(first.path);
      const oldest = await oldestPendingScanAt(db);
      expect(oldest).not.toBeNull();
      expect(Date.parse(oldest!)).toBeLessThanOrEqual(Date.parse(mine[0]!.created_at));
    }));

  it("a version just TRIED goes behind every untried one, even an older one; the oldest-pending instant still reads by age (re-review N2b; mutations: drop the scan_tried_at order -> FAILS; read oldestPendingScanAt through the tried order -> FAILS)", () =>
    withTestAccount(async (db, accountId) => {
      const ana = (await createContact(db, accountId, { firstName: "Ana" }, ACTOR)).id;
      const older = await readyDoc(db, accountId, ana, { title: "Older" });
      const newer = await readyDoc(db, accountId, ana, { title: "Newer" });
      expect(await recordDocumentScan(db, { accountId, versionId: older.versionId, verdict: "tried" })).toMatchObject({ status: "ok", attempts: 0 });
      const mine = (await listPendingScans(db, 1000)).filter((p) => p.account_id === accountId);
      expect(mine.map((p) => p.id)).toEqual([newer.versionId, older.versionId]);
      expect(mine[1]!.scan_tried_at).not.toBeNull();
      const oldest = await oldestPendingScanAt(db);
      expect(Date.parse(oldest!)).toBeLessThanOrEqual(Date.parse(mine[1]!.created_at));
    }));

  it("the scanner's URL is a 120-second signed GET on the documents bucket for that one path (mutation: sign the account folder -> FAILS)", async () => {
    const createSignedUrl = vi.fn(async (path: string, seconds: number) => ({ data: { signedUrl: `https://x.supabase.co/storage/v1/object/sign/documents/${path}?token=t&s=${seconds}` }, error: null }));
    const from = vi.fn(() => ({ createSignedUrl }));
    const db = { storage: { from } } as unknown as SupabaseClient;
    const url = await signedScannerUrl(db, "a/b/c");
    expect(from).toHaveBeenCalledWith("documents");
    expect(createSignedUrl).toHaveBeenCalledWith("a/b/c", 120);
    expect(url).toBe("https://x.supabase.co/storage/v1/object/sign/documents/a/b/c?token=t&s=120");
  });

  it("the removed-file timeline read: a contact's rows and a group's own (mutation: read the group's own rows without .eq('client_group_id') -> FAILS)", () =>
    withTestAccount(async (db, accountId) => {
      const ana = (await createContact(db, accountId, { firstName: "Ana" }, ACTOR)).id;
      const g = await createGroupWithMember(db, accountId, ana, "household", "Casa", null, ACTOR);
      if (g.status !== "ok") throw new Error(g.status);
      const mine = await readyDoc(db, accountId, ana, { title: "Mine" });
      const gid = await createDocument(db, { accountId, record: { kind: "group", id: g.groupId }, title: "Ours", category: "other", expiresOn: null, ownersOnly: false, source: "upload", createdBy: ACTOR });
      const r = await reserveDocumentVersion(db, { accountId, documentId: gid, bytes: 10, contentType: "application/pdf", originalName: null, uploadedBy: ACTOR });
      if (r.status !== "ok") throw new Error(r.status);
      expect(await markDocumentVersionReady(db, { accountId, documentId: gid, versionId: r.versionId, bytes: 10, sha256: HASH, actorId: ACTOR })).toBe(true);
      await verdict(db, accountId, mine.versionId, "infected");
      await verdict(db, accountId, r.versionId, "unscannable");
      const contactOnly = await listDocumentScanTimeline(db, accountId, ana, null, { limit: 10 });
      expect(contactOnly.map((x) => [x.id, x.scan_status, x.title])).toEqual([[mine.versionId, "infected", "Mine"]]);
      const both = await listDocumentScanTimeline(db, accountId, ana, g.groupId, { limit: 10 });
      expect(both.map((x) => x.id).sort()).toEqual([mine.versionId, r.versionId].sort());
    }));
});
```

(Every case is red: the six names do not exist yet. The scanner-URL case runs without a database; the rest need the replica's PostgREST. If the group read's `forContacts` refuses a lone contact id with a group, mirror `listDocumentVersionTimeline`'s own test, `documents.test.ts:211-235`, for the call shape.)

- [ ] **Step 3: Run red.** `source <dir>/env-run.sh && pnpm --filter @bis/db exec vitest run src/test/documents.test.ts > <dir>/red.log 2>&1; echo $? > <dir>/red.exit` → the new describe fails (an import error counts as one failed file; that is the red).

- [ ] **Step 4: Implement** in `packages/db/src/documents.ts`.

  (a) Types and columns. Replace `:22-25` and `:35`:

```ts
export type ScanStatus = "pending" | "clean" | "infected" | "unscannable";
export type DocumentVersionRow = {
  id: string; document_id: string; account_id: string; storage_path: string; bytes: number;
  content_type: DocumentContentType; original_name: string | null; status: "uploading" | "ready"; created_at: string;
  /** 0079: only a clean version may be opened (signedDocumentReadUrl). */
  scan_status: ScanStatus;
  /** 0079: clamd's name for an infected or unscannable version; staff-only under RLS, never sent to a browser (removedReason reads it). */
  scan_signature: string | null;
};
```

```ts
const VERSION_COLS = "id, document_id, account_id, storage_path, bytes, content_type, original_name, status, created_at, scan_status, scan_signature";
```

  (b) `createDocument` stops writing the retired column (deviation 2). Replace the comment at `:108` with `/** Service client. The scan state lives on each version (0079); documents.scan_status is retired (0080 drops it). */` and delete `scan_status: "skipped", ` from the insert at `:115`. (No test can tell a write of `'skipped'` from the default; the reviewer greps for `scan_status` in `documents.ts` and expects only the new version reads, and 0080's drop will fail any writer left.)

  (c) Append after `listDocumentVersionTimeline` (end of file):

```ts
export type ReadUrlOutcome = { status: "ok"; url: string } | { status: "pending" | "removed" | "not_ready" | "not_found" };

/**
 * THE ONE place a signed READ URL for a stored version is minted (spec 3.3; owner decision P3: every
 * file waits until clean). Service client, after the caller's request-client proof. It re-reads the
 * version ITSELF, by id and account, and refuses unless the version is ready and its scan is clean: a
 * caller can never hand it a stale or forged state. apps/web/src/lib/documents/read-gate.test.ts pins
 * that no other file mints a signed URL. `download` names the saved file (Content-Disposition); omitted,
 * the URL is for viewing. THROWS on a read or storage error.
 */
export async function signedDocumentReadUrl(
  db: SupabaseClient, accountId: string, versionId: string, o: { seconds: number; download?: string },
): Promise<ReadUrlOutcome> {
  const { data, error } = await db.from("document_versions").select("storage_path, status, scan_status")
    .eq("account_id", accountId).eq("id", versionId).maybeSingle();
  if (error) throw new Error(`signedDocumentReadUrl (read) failed: ${error.message}`);
  const v = data as { storage_path: string; status: "uploading" | "ready"; scan_status: ScanStatus } | null;
  if (!v) return { status: "not_found" };
  if (v.status !== "ready") return { status: "not_ready" };
  if (v.scan_status === "pending") return { status: "pending" };
  if (v.scan_status !== "clean") return { status: "removed" };
  const { data: signed, error: signError } = await db.storage.from(DOCUMENT_BUCKET)
    .createSignedUrl(v.storage_path, o.seconds, o.download ? { download: o.download } : undefined);
  if (signError || !signed) throw new Error(`signedDocumentReadUrl (sign) failed: ${signError?.message ?? "no data"}`);
  return { status: "ok", url: signed.signedUrl };
}

/** Spec 3.1: the scanner's URL lives 120 seconds; the worker fetches it at once. */
export const SCANNER_URL_SECONDS = 120;

/**
 * The scanner's OWN signed GET for one stored object (spec 3.3: a separate, server-only function).
 * It does not check the scan state: it exists so the object CAN be scanned. Used only by
 * apps/web/src/lib/documents/scan-version.ts (read-gate.test.ts pins that); never returned to a
 * browser. Service client. THROWS on a storage error.
 */
export async function signedScannerUrl(db: SupabaseClient, storagePath: string): Promise<string> {
  const { data, error } = await db.storage.from(DOCUMENT_BUCKET).createSignedUrl(storagePath, SCANNER_URL_SECONDS);
  if (error || !data) throw new Error(`signedScannerUrl failed: ${error?.message ?? "no data"}`);
  return data.signedUrl;
}

export type ScanVerdictInput = "clean" | "infected" | "unscannable" | "error" | "tried";
export type RecordScanOutcome = { status: "ok"; attempts: number } | { status: "stale" };

/**
 * Service client: public.record_document_scan (0079), the one write of a verdict. A compare-and-set
 * from pending on a READY version of the account; `error` adds an attempt and stays pending; `stale`
 * when the version is no longer pending (another scan answered first) or is not this account's. The
 * CALLER deletes an infected or unscannable object BEFORE recording it (scan-version.ts). After the
 * write, document.virus_removed or document.unscannable (plan deviation 8), as the system, with the
 * document and version ids only (no title: PR 1a deviation 3; no virus name: it stays on the row,
 * staff-only). THROWS on an RPC error or an answer it does not know.
 */
export async function recordDocumentScan(db: SupabaseClient, a: {
  accountId: string; versionId: string; verdict: ScanVerdictInput; signature?: string | null;
}): Promise<RecordScanOutcome> {
  const { data, error } = await db.rpc("record_document_scan", {
    p_account_id: a.accountId, p_version_id: a.versionId, p_verdict: a.verdict, p_signature: a.signature ?? null,
  });
  if (error) throw new Error(`recordDocumentScan failed: ${error.message}`);
  const r = data as { status: string; attempts?: number; document_id?: string };
  if (r.status === "stale") return { status: "stale" };
  if (r.status !== "ok" || typeof r.attempts !== "number" || typeof r.document_id !== "string") {
    throw new Error(`recordDocumentScan: unexpected answer ${JSON.stringify(r)}`);
  }
  if (a.verdict === "infected" || a.verdict === "unscannable") {
    await emitAfter(db, a.accountId, a.verdict === "infected" ? "document.virus_removed" : "document.unscannable", "documents-scan",
      { documentId: r.document_id, versionId: a.versionId }, "system");
  }
  return { status: "ok", attempts: r.attempts };
}

export type PendingScan = { id: string; account_id: string; document_id: string; storage_path: string; scan_attempts: number; created_at: string; scan_tried_at: string | null };

/**
 * Service client (the retry pass): READY versions still pending, across accounts (0079's partial index):
 * never tried first, then the least recently tried, then the oldest (re-review N2b).
 */
export async function listPendingScans(db: SupabaseClient, limit: number): Promise<PendingScan[]> {
  const { data, error } = await db.from("document_versions")
    .select("id, account_id, document_id, storage_path, scan_attempts, created_at, scan_tried_at")
    .eq("status", "ready").eq("scan_status", "pending")
    .order("scan_tried_at", { ascending: true, nullsFirst: true })
    .order("created_at", { ascending: true }).order("id", { ascending: true }).limit(limit);
  if (error) throw new Error(`listPendingScans failed: ${error.message}`);
  return (data ?? []) as PendingScan[];
}

/** Service client (the heartbeat): the created_at of the oldest READY version still pending, or null (plan deviation 6). */
export async function oldestPendingScanAt(db: SupabaseClient): Promise<string | null> {
  // Its own read: listPendingScans orders by the last try, not by age (re-review N2b).
  const { data, error } = await db.from("document_versions").select("created_at")
    .eq("status", "ready").eq("scan_status", "pending").order("created_at", { ascending: true }).limit(1);
  if (error) throw new Error(`oldestPendingScanAt failed: ${error.message}`);
  return ((data ?? [])[0] as { created_at: string } | undefined)?.created_at ?? null;
}

export type TimelineDocumentScan = {
  id: string; document_id: string; scan_status: "infected" | "unscannable"; scan_signature: string | null; scanned_at: string; title: string;
  category: DocumentCategory; deleted_at: string | null; contact_id: string | null; client_group_id: string | null;
};
const SCAN_TIMELINE_COLS = "id, document_id, scan_status, scan_signature, scanned_at, title, category, deleted_at, contact_id, client_group_id";

/**
 * The timeline's removed-file rows (spec 3.5): 0079's view, one row per infected or unscannable
 * version, at its verdict, on the caller's REQUEST client (security_invoker: RLS decides). Paged as
 * listDocumentVersionTimeline is, on scanned_at and the version's own id; a group page also reads the
 * group's own files. record.ts merges, sorts and slices every source together.
 */
export async function listDocumentScanTimeline(
  db: SupabaseClient, accountId: string, who: string | readonly string[], groupId: string | null, page: TimelinePageOpts,
): Promise<TimelineDocumentScan[]> {
  const base = () => db.from("document_scan_timeline").select(SCAN_TIMELINE_COLS).eq("account_id", accountId);
  const reads = [withTimelinePage(forContacts(base(), "contact_id", who), "scanned_at", page)];
  if (groupId) reads.push(withTimelinePage(base().eq("client_group_id", groupId), "scanned_at", page));
  const results = await Promise.all(reads);
  const out: TimelineDocumentScan[] = [];
  for (const { data, error } of results) {
    if (error) throw new Error(`listDocumentScanTimeline failed: ${error.message}`);
    out.push(...((data ?? []) as TimelineDocumentScan[]));
  }
  return out;
}
```

  (d) `packages/db/src/index.ts`: add to the documents block (`:270-280`) `signedDocumentReadUrl, signedScannerUrl, recordDocumentScan, listPendingScans, oldestPendingScanAt, listDocumentScanTimeline, SCANNER_URL_SECONDS,` and the types `type ScanStatus, type ReadUrlOutcome, type ScanVerdictInput, type RecordScanOutcome, type PendingScan, type TimelineDocumentScan`.

- [ ] **Step 4b (owner ruling 2026-10-15): the removed file's REASON, in data.** Also modify `packages/db/src/document-rules.ts` (this task's, the browser-safe subpath 2b's public page will import):

```ts
/**
 * Why a removed version was removed, read from its scan state and clamd's name for it (0079's
 * scan_signature). Owner ruling 2026-10-15 ("remove, and say why"): content clamd reports as
 * Heuristics.Encrypted.* is password-protected, and the person is told so; every other unscannable
 * cause (a limit, three clamd errors) is "unscannable". Pure and browser-safe: the card's read and 2b's
 * customer page both call it, so the two can never word the reason differently. The signature itself
 * never leaves the server.
 */
export type RemovedReason = "virus" | "password" | "unscannable";
export const PASSWORD_SIGNATURE_PREFIX = "Heuristics.Encrypted.";
export function removedReason(scanStatus: string, signature: string | null): RemovedReason | null {
  if (scanStatus === "infected") return "virus";
  if (scanStatus !== "unscannable") return null;
  return signature?.startsWith(PASSWORD_SIGNATURE_PREFIX) ? "password" : "unscannable";
}
```

  `VERSION_COLS`, `DocumentVersionRow`, `TimelineDocumentScan` and `SCAN_TIMELINE_COLS` above already carry `scan_signature` (read on the request client under the documents RLS, staff-only; Task 7 maps it away before anything reaches a browser). Export `removedReason`, `PASSWORD_SIGNATURE_PREFIX`, `type RemovedReason` from `./document-rules` in `index.ts`'s document-rules block. Add to the new describe in `documents.test.ts`:

```ts
  it("an unscannable version keeps its named cause on the read, and removedReason reads a password from it (owner ruling 2026-10-15; mutation: drop scan_signature from VERSION_COLS -> FAILS)", () =>
    withTestAccount(async (db, accountId) => {
      const ana = (await createContact(db, accountId, { firstName: "Ana" }, ACTOR)).id;
      const d = await readyDoc(db, accountId, ana, { title: "Locked" });
      await recordDocumentScan(db, { accountId, versionId: d.versionId, verdict: "unscannable", signature: "Heuristics.Encrypted.PDF" });
      const v = (await listRecordDocuments(db, accountId, { kind: "contact", id: ana })).live[0]!.version;
      expect([v.scan_status, v.scan_signature, removedReason(v.scan_status, v.scan_signature)]).toEqual(["unscannable", "Heuristics.Encrypted.PDF", "password"]);
    }));
```

  (import `removedReason` from `../document-rules`.) The helper's own cases live in Task 7's `scan-state.test.ts` (a pure test needs no database): infected → virus; unscannable with `Heuristics.Encrypted.PDF`, `Heuristics.Encrypted.Zip` → password; unscannable with `Heuristics.Limits.Exceeded.MaxFileSize` or null → unscannable; clean and pending → null.

- [ ] **Step 5: Run green.** The Step 3 command → every case in `documents.test.ts` passes (summary block: 0 failed). `pnpm --filter @bis/db typecheck` → clean. Every EXISTING `documents.test.ts` case still passes: the "listed" rule did not change (deviation 1). `pnpm --filter web typecheck` will now show errors only where a `DocumentVersionRow` literal lacks `scan_status` in web tests: list them in the report; Tasks 7 and 9 fix their own files.

- [ ] **Step 6: Probes, red BY NAME, restored:** (1) drop `, scan_status` from `VERSION_COLS` → the card-read case; (2) in `signedDocumentReadUrl` delete the two scan `if`s → the gate case throws on storage (the gateway's 404); (3) drop `.eq("account_id", accountId)` from the gate's read → the cross-account case; (4) emit `"document.virus_removed"` for every verdict → the verdict case; (5) `ascending: false` on `created_at` in `listPendingScans` → the pass case; (6) `createSignedUrl(storagePath.split("/")[0]!, …)` → the scanner-URL case.

- [ ] **Step 7: Commit.** `git commit -m "feat(db): the one read gate, the scanner's URL, the verdict write and the pending reads (S-07 part 2a)" -- packages/db/src/documents.ts packages/db/src/index.ts packages/db/src/test/documents.test.ts`

---

## Task 3b: The timeline's removed-file rows (bis-crm)

**Review:** opus. **After:** Tasks 1, 2, 3. **Scratch:** `<SCRATCH>/s07c-t3b-impl/`; replica + PostgREST on `55568`/`55569`/`55570` for `record.test.ts`.

**Files**
- Modify: `packages/db/src/record.ts` (`:14` import; `TimelineEntry` union `:288-298`; the documents settle `:369-381`)
- Modify: `packages/db/src/test/record.test.ts` (one case after the new-version case, which ends at `:599`)
- Modify: `apps/web/src/lib/record/author-mark.ts` (`authorOf`, after `:52`) and `author-mark.test.ts` (after `:128`)
- Modify: `apps/web/src/lib/record/timeline-rows.ts` (after the `documentVersion` case, `:100-104`) and `timeline-rows.test.ts` (after `:163`)
- Modify: `apps/web/src/lib/record/recent-rows.ts` (`:47`) and `recent-rows.test.ts` (after `:101`)
- Modify: `…/contacts/[contactId]/activity-timeline.tsx` (`:186-187`) and `activity-timeline.rows.test.ts` (after `:207`)
- Modify: `…/groups/[groupId]/group-timeline.tsx` (`:130-131`) and `…/groups/[groupId]/group-timeline.test.ts` (its `documentVersion` render case is the model; `group-timeline.lang.test.ts` beside it is not touched)
- Modify: `…/contacts/contact-drawer.tsx` (`ROW_ICON`, `:64-67`)
- Modify: `apps/web/src/lib/contacts/drawer-summary.ts` (`ROW_KINDS`, `:52-55`) and `drawer-summary.test.ts` (after `:104`)
- Modify: `…/api/contacts/[contactId]/summary/route.reads.test.ts` (`MEASURED`, `:50-58`)

**Interfaces**
- Consumes: `listDocumentScanTimeline`, `TimelineDocumentScan`, `recordDocumentScan` (Task 3); keys `timeline.documentRemoved`, `timeline.documentUnscannable`, `documents.status.virusRemoved`, `documents.status.unscannable` (Task 2); `provenance.automation` (`messages.ts:2645-2646`).
- Produces: `TimelineEntry` variant `{ kind: "documentRemoved"; id: string; at: string; contactId: string; scan: TimelineDocumentScan }`, `id` = the version's id, `at` = `scanned_at`. Author: `{ kind: "automation", personId: null }`.

- [ ] **Step 1: Write the failing tests.**

  `packages/db/src/test/record.test.ts`, after the new-version case (add `recordDocumentScan` to the `../documents` import at `:14`):

```ts
  it("a removed file is its own row at its verdict, under the same documents source (spec 3.5; mutation: drop the scan read from the documents settle -> FAILS)", () =>
    withTestAccount(async (db, accountId) => {
      const ana = (await createContact(db, accountId, { firstName: "Ana" }, "user_t")).id;
      const id = await createDocument(db, { accountId, record: { kind: "contact", id: ana }, title: "Lease", category: "contract", expiresOn: null, ownersOnly: false, source: "upload", createdBy: "user_t" });
      const r = await reserveDocumentVersion(db, { accountId, documentId: id, bytes: 5, contentType: "application/pdf", originalName: null, uploadedBy: "user_t" });
      if (r.status !== "ok") throw new Error(r.status);
      if (!(await markDocumentVersionReady(db, { accountId, documentId: id, versionId: r.versionId, bytes: 5, sha256: "c".repeat(64), actorId: "user_t" }))) throw new Error("not ready");
      expect(await recordDocumentScan(db, { accountId, versionId: r.versionId, verdict: "infected", signature: "Eicar-Test-Signature" })).toMatchObject({ status: "ok" });
      const page = await listTimelinePage(db, accountId, [ana]);
      expect(page.failed).toEqual([]);
      const removed = page.items.filter((i) => i.kind === "documentRemoved");
      expect(removed.map((i) => i.id)).toEqual([r.versionId]);
      const e = removed[0]!;
      expect(e.kind === "documentRemoved" && [e.scan.title, e.scan.scan_status, e.contactId, e.at === e.scan.scanned_at]).toEqual(["Lease", "infected", ana, true]);
    }));
```

  `apps/web/src/lib/record/author-mark.test.ts`, after `:128`:

```ts
describe("a removed file's author (spec 3.5)", () => {
  const removed: TimelineEntry = { kind: "documentRemoved", id: "v9", at: AT, contactId: "c1", scan: {
    id: "v9", document_id: "d1", scan_status: "infected", scan_signature: null, scanned_at: AT, title: "Lease", category: "contract",
    deleted_at: null, contact_id: "c1", client_group_id: null } };
  it("is the automation, and asks the names read for nobody (mutation: a person mark with a null id -> FAILS)", () => {
    expect(authorOf(removed)).toEqual({ kind: "automation", personId: null });
    expect(personIdsOf([removed])).toEqual([]);
  });
});
```

  `apps/web/src/lib/record/timeline-rows.test.ts`, after `:163` (import `TimelineDocumentScan` beside `TimelineDocumentVersion`):

```ts
describe("a removed file's row (spec 3.5)", () => {
  const removed = (over: Partial<TimelineDocumentScan> = {}): TimelineEntry => ({
    kind: "documentRemoved", id: "v9", at: "2026-10-15T15:00:00.000Z", contactId: "c1",
    scan: { id: "v9", document_id: "d1", scan_status: "infected", scan_signature: null, scanned_at: "2026-10-15T15:00:00.000Z", title: "Lease",
      category: "contract", deleted_at: null, contact_id: "c1", client_group_id: null, ...over },
  });
  const author = (tr: Tr) => ({ viewerId: "user_me", names: {}, personaName: null, tr });
  it("reads 'Automation removed <title>: it had a virus', a crit dot and word, the category as detail (mutations: reuse timeline.documentVersion -> FAILS; tone 'muted' -> FAILS)", () => {
    const tr = makeTr("en");
    const [row] = timelineRows([removed()], { zone: "America/Chicago", tr, author: author(tr) });
    expect([row!.verb, row!.detail, row!.mark, row!.status, row!.key]).toEqual([
      "removed Lease: it had a virus", "Contract", { kind: "automation", label: "Automation" },
      { tone: "crit", word: "Removed: it had a virus" }, "documentRemoved-v9"]);
  });
  it("in Spanish, and an unscannable file reads its own words (mutation: one verb for both states -> FAILS)", () => {
    const tr = makeTr("es");
    const [row] = timelineRows([removed({ scan_status: "unscannable" })], { zone: "America/Chicago", tr, author: author(tr) });
    expect(row!.verb).toBe(m["timeline.documentUnscannable.es"].replace("{title}", "Lease"));
    expect(row!.status).toEqual({ tone: "crit", word: m["documents.status.unscannable.es"] });
    expect(row!.mark).toEqual({ kind: "automation", label: m["provenance.automation.es"] });
  });
});
```

  (A trashed file's removed row keeps the crit status: the removal is the news; the trash shows on the file's own rows.)

  `apps/web/src/lib/record/recent-rows.test.ts`, after `:101`:

```ts
describe("a removed file in the drawer's Recent (spec 3.5)", () => {
  it("is its head only, its own kind, never an excerpt (mutation: map it to kind 'document' -> FAILS)", () => {
    const removed: TimelineEntry = { kind: "documentRemoved", id: "v9", at: AT, contactId: "c1", scan: {
      id: "v9", document_id: "d1", scan_status: "infected", scan_signature: null, scanned_at: AT, title: "Lease", category: "contract",
      deleted_at: null, contact_id: "c1", client_group_id: null } };
    const [d] = view([removed]);
    expect([d!.kind, d!.verb, d!.excerpt]).toEqual(["documentRemoved", "removed Lease: it had a virus", null]);
  });
});
```

  `apps/web/src/lib/contacts/drawer-summary.test.ts`, after `:104`:

```ts
  it("a removed-file row (S-07 2a) parses and is kept (mutation: drop documentRemoved from ROW_KINDS -> FAILS)", () => {
    const body = clone();
    const removed = { key: "documentRemoved-v9", kind: "documentRemoved", mark: { kind: "automation", label: "Automation" }, verb: "removed Lease: it had a virus",
      status: { tone: "crit", word: "Removed: it had a virus" }, detail: "Contract", time: "Oct 9, 2026, 11:12 AM", dateTime: "2026-10-09T16:12:00Z", excerpt: null };
    (body.recent as { rows: unknown[] }).rows = [removed];
    expect(parseDrawerSummary(body)!.recent).toEqual({
      status: "ready", rows: [removed], failedText: null, emptyText: null, seeAllHref: "/dashboard/accounts/a1/contacts/c1#record-timeline",
    });
  });
```

  `activity-timeline.rows.test.ts`, after `:207` (and the same case in the group timeline's test, built with that file's own base props as its existing `documentVersion` case builds them):

```ts
  it("a removed-file row renders as one: its verb, the automation mark and the crit word (S-07 2a; mutation: return null for the documentRemoved case -> FAILS)", () => {
    const entries: TimelineEntry[] = [{ kind: "documentRemoved", id: "v9", at: AT, contactId: "c1", scan: { id: "v9", document_id: "d1",
      scan_status: "infected", scan_signature: null, scanned_at: AT, title: "Lease", category: "contract", deleted_at: null, contact_id: "c1", client_group_id: null } }];
    const tr = makeTr("es");
    const rows = timelineRows(entries, { zone: "America/Chicago", tr, author: { viewerId: "user_me", names: {}, personaName: null, tr } });
    const base = legacyTimeline({ accountId: "a1", contactId: "c1", timezone: "America/Chicago", locale: "es", emailAction: async () => {}, smsAction: async () => {} });
    const html = renderToStaticMarkup(createElement(ActivityTimeline, { ...base, rows, emptyText: null } as never));
    const row = html.match(/<div data-timeline-item="documentRemoved"[\s\S]*?<\/li>/)?.[0] ?? "";
    expect(row).toContain(`>${m["timeline.documentRemoved.es"].replace("{title}", "Lease")}<`);
    expect(row).toContain(`>${m["provenance.automation.es"]}<`);
    expect(row).toContain(`>${m["documents.status.virusRemoved.es"]}<`);
  });
```

  **Owner ruling 2026-10-15 (password-protected files):** add to `timeline-rows.test.ts`'s new describe

```ts
  it("a password-protected file's row says so, in both languages, never the generic words (owner ruling 2026-10-15; mutation: ignore the cause -> the generic verb -> FAILS)", () => {
    for (const locale of ["en", "es"] as const) {
      const tr = makeTr(locale);
      const [row] = timelineRows([removed({ scan_status: "unscannable", scan_signature: "Heuristics.Encrypted.PDF" })], { zone: "America/Chicago", tr, author: author(tr) });
      const sfx = locale === "es" ? ".es" : "";
      expect(row!.verb).toBe(m[`timeline.documentPassword${sfx}` as keyof typeof m].replace("{title}", "Lease"));
      expect(row!.status).toEqual({ tone: "crit", word: m[`documents.status.passwordRemoved${sfx}` as keyof typeof m] });
      expect(row!.verb).not.toBe(m[`timeline.documentUnscannable${sfx}` as keyof typeof m].replace("{title}", "Lease"));
    }
  });
```

  (every `TimelineDocumentScan` fixture in this task's tests gains `scan_signature: null`), and implement the row through the shared helper:

```ts
    case "documentRemoved": {
      const why = removedReason(entry.scan.scan_status, entry.scan.scan_signature);
      const verb = why === "virus" ? "timeline.documentRemoved" : why === "password" ? "timeline.documentPassword" : "timeline.documentUnscannable";
      const word = why === "virus" ? "documents.status.virusRemoved" : why === "password" ? "documents.status.passwordRemoved" : "documents.status.unscannable";
      return { verb: tr.text(verb, { title: entry.scan.title }), status: { tone: "crit", word: tr.text(word) }, detail: tr.text(`documents.category.${entry.scan.category}`) };
    }
```

  (`removedReason` from `@bis/db/document-rules`; Step 3's block above already uses it.)

- [ ] **Step 2: Run red.** `pnpm --filter web exec vitest run src/lib/record src/lib/contacts/drawer-summary.test.ts "src/app/(dashboard)/dashboard/accounts/[accountId]/contacts/[contactId]/activity-timeline.rows.test.ts" "src/app/(dashboard)/dashboard/accounts/[accountId]/groups/[groupId]/group-timeline.test.ts"` → the new cases fail (`tsc` also refuses the unknown kind: expected). `record.test.ts` on your replica behind PostgREST → its new case fails.

- [ ] **Step 3: Implement.**

  `packages/db/src/record.ts`: import `listDocumentScanTimeline, type TimelineDocumentScan` at `:14`; add to the union after `:298`:

```ts
  /** S-07 2a (spec 3.5): one row per removed version (a virus, or it could not be checked), read from 0079's view so RLS decides. `id` is the version's; `at` its verdict. */
  | { kind: "documentRemoved"; id: string; at: string; contactId: string; scan: TimelineDocumentScan };
```

  and the documents settle (`:369-381`) reads three:

```ts
    // S-07: one source, three kinds. A file's "added" row (from documents), each NEW version's row
    // (owner ruling R2, from 0078's view) and each REMOVED version's row (spec 3.5, from 0079's view),
    // all under the caller's RLS, all paged on (at, id); a failed read of any is the one "documents" failure.
    settle("documents", async () => {
      const [docs, versions, removed] = await Promise.all([
        listDocumentTimeline(db, accountId, who, opts.groupId ?? null, page),
        listDocumentVersionTimeline(db, accountId, who, opts.groupId ?? null, page),
        listDocumentScanTimeline(db, accountId, who, opts.groupId ?? null, page),
      ]);
      return [
        ...docs.map((d): TimelineEntry => ({ kind: "document", id: d.id, at: d.created_at, contactId: d.contact_id ?? "", document: d })),
        ...versions.map((v): TimelineEntry => ({ kind: "documentVersion", id: v.id, at: v.created_at, contactId: v.contact_id ?? "", version: v })),
        ...removed.map((s): TimelineEntry => ({ kind: "documentRemoved", id: s.id, at: s.scanned_at, contactId: s.contact_id ?? "", scan: s })),
      ];
    }),
```

  `author-mark.ts` `authorOf`, after the `documentVersion` case:

```ts
    // S-07 2a: the scan removed it; nobody on the team did (DESIGN.md "Provenance": the automation mark).
    case "documentRemoved": return { kind: "automation", personId: null };
```

  `timeline-rows.ts`, after the `documentVersion` case:

```ts
    // S-07 2a (spec 3.5): a removed file, its own words per state, the state as a crit dot and word (rule 3).
    // Owner ruling 2026-10-15: a password-protected file says why; removedReason (@bis/db/document-rules) decides.
    case "documentRemoved": {
      const why = removedReason(entry.scan.scan_status, entry.scan.scan_signature);
      const verb = why === "virus" ? "timeline.documentRemoved" : why === "password" ? "timeline.documentPassword" : "timeline.documentUnscannable";
      const word = why === "virus" ? "documents.status.virusRemoved" : why === "password" ? "documents.status.passwordRemoved" : "documents.status.unscannable";
      return { verb: tr.text(verb, { title: entry.scan.title }), status: { tone: "crit", word: tr.text(word) }, detail: tr.text(`documents.category.${entry.scan.category}`) };
    }
```

  `recent-rows.ts` `:47`: add `case "documentRemoved": return null;`.

  `activity-timeline.tsx` and `group-timeline.tsx`: import `ShieldAlert` from `lucide-react` beside `Paperclip`, and after the `documentVersion` case:

```tsx
    // S-07 2a: a removed file wears a shield (the row's own crit dot and word carry the state).
    case "documentRemoved":
      return <TimelineItem {...head} icon={ShieldAlert} />;
```

  `contact-drawer.tsx` `ROW_ICON`: `document: Paperclip, documentVersion: Paperclip, documentRemoved: ShieldAlert,` (import `ShieldAlert`). `drawer-summary.ts` `ROW_KINDS`: add `documentRemoved: true,`.

  `route.reads.test.ts`: run it FIRST, unchanged, and read the measured count and the new read's name off its failure. If they are not 25 and `request:document_scan_timeline`, STOP and report. Then append to the comment at `:50-57`: `// Raised 24 -> 25 on 2026-10-15 by S-07 part 2a (spec 3.5): a removed file is its own timeline row,` / `// read from 0079's view document_scan_timeline (security_invoker, so the same RLS decides), inside the same documents source.` and set `const MEASURED = 25; // measured 2026-10-15: 25 reads (+1 prefs), the 25th is request:document_scan_timeline; 24 before S-07 2a, 23 before S-07 1b, 22 before S-07, 20 with non-uuid fixture ids, 7 (+0) before S-03 part 3`.

- [ ] **Step 4: Run green.** Step 2's command plus `"src/app/api/accounts/[accountId]/contacts/[contactId]/summary"` → PASS; `pnpm --filter web typecheck` → clean in the files this task owns; `record.test.ts` and `timeline-merge.test.ts` on the replica behind PostgREST → PASS.

- [ ] **Step 5: Probes, red BY NAME, restored:** (1) drop the third read from the settle → the record case; (2) `authorOf` returns `{ kind: "person", personId: null }` → the author case; (3) `tone: "muted"` → the row case; (4) one verb for both states → the Spanish unscannable case; (5) `case "documentRemoved": return null;` in `activity-timeline.tsx`'s switch → its render case; (6) remove `documentRemoved` from `ROW_KINDS` (a `// @ts-expect-error` on the map for the probe only) → the drawer case.

- [ ] **Step 6: Commit.** `git commit -m "feat(record): a removed file is its own timeline row with the automation mark, in both timelines and the drawer (S-07 part 2a)" -- <every file in this task's Files list>`, each path quoted.

---

## Task 4: The worker: shim, image, fly.toml, tests, the fake clamd (bis-platform)

**Review:** opus. **Runs beside:** Tasks 1 and 2. Nothing here is under the pnpm workspace (`pnpm-workspace.yaml` lists `apps/*` and `packages/*` only), so `pnpm check` never sees it; its tests are `node:test`, run by Node 24 directly and by the CI `scanner` job (Task 10). No dependency of any kind: `node:http`, `node:net`, `node:crypto`, `node:zlib`, global `fetch`.

**Files**
- Create: `services/scanner/src/hmac.mjs`, `config.mjs`, `allow.mjs`, `clamd.mjs`, `scan.mjs`, `server.mjs`
- Create: `services/scanner/test/eicar.mjs`, `fake-clamd.mjs`, `real-clamd.mjs`, `hmac.test.mjs`, `allow.test.mjs`, `server.test.mjs`
- Create: `services/scanner/Dockerfile`, `services/scanner/.dockerignore`, `services/scanner/start.sh`, `services/scanner/fly.toml`

**Interfaces**
- Produces (the wire contract Task 5's client speaks; change one side, change both):
  - Every request carries `x-bis-scan-timestamp` (Unix seconds) and `x-bis-scan-signature` = lowercase hex HMAC-SHA256, keyed by the caller's secret, over `` `${timestamp}.${METHOD}.${path}.${body}` `` (`body` is `""` for GET). Accepted within ±60 s. The fixed vector both sides pin: secret `test-secret`, timestamp `1760000000`, `POST /scan` with body `{"url":"https://abc.supabase.co/storage/v1/object/sign/documents/a/b/c?token=t"}` → `414f5bcfa4ebd5bb5e060b45bf091d4abfca66fd7bda2dfc2d8e752e64eaec01`; `GET /health` with body `""` → `9b16b5e0e7895ed3b63577ae46200cc556595994f9e89e9323a8bd08568a5996` (computed 2026-10-15 with `node:crypto`).
  - `POST /scan` `{"url": "<signed GET>"}` → 200 `{"verdict":"clean"}` | `{"verdict":"infected","signature":"<name>"}` | `{"verdict":"unscannable","signature":"Heuristics.…"}` (a limit or encryption, plan review C2) | `{"verdict":"error","stage":"clamd"|"missing"|"transport"}` (plan review C1, final check R2: `clamd` only when clamd answered ERROR about this stream; `missing` only when storage said this object does not exist; anything else, every timeout included, is `transport`); 401 bad or stale signature (nothing fetched); 403 a URL outside the caller's origin or not `/storage/v1/object/sign/documents/…?token=…` (nothing fetched); 400 bad JSON; 413 a body over 8 KiB; 404 any other route.
  - `GET /health` → 200 `{"clamd":true,"signaturesAt":"<ISO>"}` | `{"clamd":false}`; 401 as above.
  - Env: `SCANNER_CLIENTS` (`<secret>@<origin>` entries separated by commas or spaces; secret ≥ 16 characters; the process refuses to start without one), `PORT` (8080), `CLAMD_HOST` (127.0.0.1), `CLAMD_PORT` (3310).
  - `services/scanner/test/fake-clamd.mjs`: `startFakeClamd(port?: number): Promise<{ port: number; close(): Promise<void> }>`; run as `node services/scanner/test/fake-clamd.mjs <port>`.
  - `services/scanner/test/eicar.mjs`: `eicar(): string`, `eicarDocx(): Buffer`, `cleanPdf(bytes: number): Buffer`; run as `node services/scanner/test/eicar.mjs <out.docx>` to write the DOCX Task 14 uploads.

- [ ] **Step 1: Read the base image (Assumptions A5, A9).** If Docker is available:

```bash
docker pull clamav/clamav:1.4
docker run --rm --entrypoint sh clamav/clamav:1.4 -c 'grep -nE "^(TCPSocket|TCPAddr|LocalSocket|StreamMaxLength|ConcurrentDatabaseReload|Foreground|User)" /etc/clamav/clamd.conf; grep -nE "^(Foreground|DatabaseOwner|Checks)" /etc/clamav/freshclam.conf; id clamav; ls -ld /var/lib/clamav /run/clamav /tmp; apk info nodejs 2>/dev/null | head -1'
docker run --rm --entrypoint sh clamav/clamav:1.4 -c 'clamconf -n 2>/dev/null | grep -nE "^(MaxRecursion|MaxFiles|AlertExceedsMax|AlertEncrypted|AlertEncryptedArchive|AlertEncryptedDoc|MaxFileSize|MaxScanSize|StreamMaxLength|TCPAddr|TCPSocket|ConcurrentDatabaseReload) "; clamconf 2>/dev/null | grep -nE "AlertExceedsMax|AlertEncrypted|MaxFileSize|TCPAddr" | head -20'
```

Paste the output. Expected: a `TCPSocket 3310` line, a `clamav` user, both directories owned by `clamav`, and `clamconf` naming every directive the Dockerfile sets (Assumption A13). A directive `clamconf` does not know: STOP and report its real name; do not guess (clamd refuses to start on an unknown one). If `TCPSocket` is absent, the Dockerfile below appends it the same way it appends `StreamMaxLength`; if the directories are owned by root, STOP and report (the image's own unprivileged entrypoint then needs reading). Without Docker, say so; the CI job is then the first proof.

- [ ] **Step 2: Write the tests first.**

`services/scanner/test/eicar.mjs`:

```js
import { crc32, deflateRawSync } from "node:zlib";
import { writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

// The EICAR antivirus test string, joined at run time from two halves so that no file in this repo
// carries it whole (an antivirus on a developer's machine quarantines such a file).
const HEAD = "X5O!P%@AP[4\\PZX54(P^)7CC)7}$";
const TAIL = "EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*";
export const eicar = () => HEAD + TAIL;

/**
 * A ZIP of [name, bytes, method?] entries: STORED by default, so a member's bytes appear verbatim;
 * "deflate" compresses one (an Office file's own XML members are deflated, which is what makes a
 * small upload unpack to many times its size).
 */
export function zipOf(entries) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const [name, data, method] of entries) {
    const n = Buffer.from(name, "utf8");
    const crc = crc32(data);
    const body = method === "deflate" ? deflateRawSync(data) : data;
    const how = method === "deflate" ? 8 : 0;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(how, 8); local.writeUInt16LE(0x21, 12);
    local.writeUInt32LE(crc, 14); local.writeUInt32LE(body.length, 18); local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(n.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6);
    central.writeUInt16LE(how, 10); central.writeUInt16LE(0x21, 14);
    central.writeUInt32LE(crc, 16); central.writeUInt32LE(body.length, 20); central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(n.length, 28); central.writeUInt32LE(offset, 42);
    locals.push(local, n, body);
    centrals.push(central, n);
    offset += 30 + n.length + body.length;
  }
  const cd = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}
export const storedZip = (entries) => zipOf(entries);

const CONTENT_TYPES = Buffer.from('<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>');

/**
 * A DOCX-shaped ZIP (the app's type check, apps/web/src/lib/documents/content-check.ts:47-51, wants
 * [Content_Types].xml and an entry under word/) with the EICAR string as a stored member: the file
 * the Preview check uploads, since a raw EICAR file is refused as the wrong type before any scan.
 */
export const eicarDocx = () => zipOf([
  ["[Content_Types].xml", CONTENT_TYPES],
  ["word/document.xml", Buffer.from("<w:document/>")],
  ["eicar.com", Buffer.from(eicar())],
]);

/**
 * An XLSX-shaped ZIP whose one sheet is `unpackedBytes` of repetitive XML, DEFLATED (plan re-review
 * N1): a legitimate export far smaller than 25 MiB that unpacks to hundreds of MB. It must scan CLEAN
 * under the image's limits; the CI job also reports its scan time and the machine's peak memory (A1).
 */
export function xlsxExpanding(unpackedBytes) {
  const sheet = Buffer.alloc(unpackedBytes, '<row r="1"><c r="A1" t="n"><v>12345</v></c><c r="B1" t="s"><v>7</v></c></row>');
  return zipOf([["[Content_Types].xml", CONTENT_TYPES], ["xl/worksheets/sheet1.xml", sheet, "deflate"]]);
}

/** A clean PDF-shaped file of exactly `bytes` bytes (at least 32). */
export function cleanPdf(bytes) {
  const head = "%PDF-1.4\n%";
  const tail = "\n%%EOF\n";
  return Buffer.concat([Buffer.from(head), Buffer.alloc(bytes - head.length - tail.length, 0x30), Buffer.from(tail)]);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const out = process.argv[2];
  if (!out) { console.error("usage: node services/scanner/test/eicar.mjs <out.docx>"); process.exit(2); }
  writeFileSync(out, eicarDocx());
  console.log(`wrote ${out}`);
}
```

`services/scanner/test/fake-clamd.mjs`:

```js
import net from "node:net";
import { pathToFileURL } from "node:url";
import { eicar } from "./eicar.mjs";

/**
 * A stand-in for clamd's TCP protocol (zPING, zVERSION, zINSTREAM), answering by CONTENT: a stream
 * holding the EICAR string is FOUND; one holding FAKE-CLAMD-ENCRYPTED is reported as clamd reports
 * an encrypted document (Heuristics.Encrypted.PDF FOUND); one holding FAKE-CLAMD-ERROR gets clamd's
 * own error line; anything else is OK. `broken: true` answers EVERY stream with clamd's out-of-memory
 * error, so a worker-wide fault (and its failing self-test) can be tested. For the shim's tests and the e2e stack
 * (apps/web/playwright.config.ts starts it beside the real shim). NEVER in the image: the Dockerfile
 * copies src/ only and .dockerignore drops test/ (plan deviation 5).
 */
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** clamd's date form, as in "ClamAV 1.4.3/27791/Wed Oct 15 08:27:02 2026" (C's ctime, in UTC). */
export const ctime = (d) => `${DAYS[d.getUTCDay()]} ${MONTHS[d.getUTCMonth()]} ${String(d.getUTCDate()).padStart(2, " ")} ${
  [d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds()].map((x) => String(x).padStart(2, "0")).join(":")} ${d.getUTCFullYear()}`;

export function startFakeClamd(port = 0, host = "127.0.0.1", { broken = false } = {}) {
  const needle = Buffer.from(eicar());
  const answer = (all) => {
    if (broken) return "Can't allocate memory ERROR\0";
    if (all.includes(needle)) return "stream: Eicar-Test-Signature FOUND\0";
    if (all.includes(Buffer.from("FAKE-CLAMD-ENCRYPTED"))) return "stream: Heuristics.Encrypted.PDF FOUND\0";
    if (all.includes(Buffer.from("FAKE-CLAMD-ERROR"))) return "INSTREAM size limit exceeded. ERROR\0";
    return "stream: OK\0";
  };
  const server = net.createServer((socket) => {
    let buf = Buffer.alloc(0);
    let cmd = null;
    const chunks = [];
    socket.on("error", () => {});
    socket.on("data", (d) => {
      buf = Buffer.concat([buf, d]);
      if (cmd === null) {
        const end = buf.indexOf(0);
        if (end < 0) return;
        cmd = buf.subarray(0, end).toString("utf8");
        buf = buf.subarray(end + 1);
        if (cmd === "zPING") { socket.end("PONG\0"); return; }
        if (cmd === "zVERSION") { socket.end(`ClamAV 1.4.3/27000/${ctime(new Date())}\0`); return; }
        if (cmd !== "zINSTREAM") { socket.end("UNKNOWN COMMAND\0"); return; }
      }
      while (buf.length >= 4) {
        const len = buf.readUInt32BE(0);
        if (len === 0) {
          socket.end(answer(Buffer.concat(chunks)));
          buf = Buffer.alloc(0);
          return;
        }
        if (buf.length < 4 + len) return;
        chunks.push(buf.subarray(4, 4 + len));
        buf = buf.subarray(4 + len);
      }
    });
  });
  return new Promise((resolve) => server.listen(port, host, () => resolve({
    port: server.address().port,
    close: () => new Promise((r) => server.close(() => r())),
  })));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  startFakeClamd(Number(process.argv[2] ?? 3399)).then(({ port }) => console.log(`fake clamd listening on ${port}`));
}
```

`services/scanner/test/hmac.test.mjs`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { sign, verify, MAX_SKEW_SECONDS } from "../src/hmac.mjs";

const BODY = JSON.stringify({ url: "https://abc.supabase.co/storage/v1/object/sign/documents/a/b/c?token=t" });

test("the shared vector; apps/web/src/lib/documents/scan-client.test.ts pins the same two strings (mutation: a newline for '.' in the canonical string -> FAILS here AND there)", () => {
  assert.equal(sign("test-secret", 1760000000, "POST", "/scan", BODY), "414f5bcfa4ebd5bb5e060b45bf091d4abfca66fd7bda2dfc2d8e752e64eaec01");
  assert.equal(sign("test-secret", 1760000000, "GET", "/health", ""), "9b16b5e0e7895ed3b63577ae46200cc556595994f9e89e9323a8bd08568a5996");
});

test("verify answers the client whose secret signed it; stale, future, another path, a tampered body, an unknown secret or junk answer null (mutations: drop the skew check -> FAILS; drop the path from the canonical string -> FAILS)", () => {
  const a = { secret: "a".repeat(20), origin: "https://one.supabase.co" };
  const b = { secret: "b".repeat(20), origin: "https://two.supabase.co" };
  const ts = 1760000000;
  const h = (secret, t = ts, path = "/scan", body = BODY) =>
    ({ "x-bis-scan-timestamp": String(t), "x-bis-scan-signature": sign(secret, t, "POST", path, body) });
  assert.equal(verify([a, b], h(b.secret), "POST", "/scan", BODY, ts), b);
  assert.equal(verify([a, b], h(a.secret, ts - MAX_SKEW_SECONDS - 1), "POST", "/scan", BODY, ts), null);
  assert.equal(verify([a, b], h(a.secret, ts + MAX_SKEW_SECONDS + 1), "POST", "/scan", BODY, ts), null);
  assert.equal(verify([a, b], h(a.secret, ts, "/health", BODY), "POST", "/scan", BODY, ts), null);
  assert.equal(verify([a, b], h(a.secret), "POST", "/scan", BODY.replace("/c?", "/d?"), ts), null);
  assert.equal(verify([a, b], h("c".repeat(20)), "POST", "/scan", BODY, ts), null);
  assert.equal(verify([a, b], { "x-bis-scan-timestamp": String(ts), "x-bis-scan-signature": "zz" }, "POST", "/scan", BODY, ts), null);
  assert.equal(verify([a, b], {}, "POST", "/scan", BODY, ts), null);
});
```

`services/scanner/test/allow.test.mjs`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { allowedObjectUrl } from "../src/allow.mjs";
import { parseClients } from "../src/config.mjs";

const O = "https://abc.supabase.co";

test("only a signed GET on the documents bucket, at the caller's own origin (mutations: drop the origin check -> FAILS; startsWith '/storage/v1/object/' -> FAILS; drop the encoded-slash refusal -> the %2F case FAILS)", () => {
  assert.equal(allowedObjectUrl(`${O}/storage/v1/object/sign/documents/acct/doc/ver?token=t`, O), true);
  for (const bad of [
    "https://evil.example/storage/v1/object/sign/documents/a?token=t",
    `${O}/storage/v1/object/sign/logos/a?token=t`,
    `${O}/storage/v1/object/public/documents/a?token=t`,
    `${O}/storage/v1/object/sign/documents/../../object/sign/logos/a?token=t`,
    `${O}/storage/v1/object/sign/documents/%2e%2e/%2e%2e/x?token=t`,
    `${O}/storage/v1/object/sign/documents/a%2F..%2F..%2Flogos%2Fx?token=t`,
    `${O}/storage/v1/object/sign/documents/a%5c..%5clogos?token=t`,
    "https://user:pw@abc.supabase.co/storage/v1/object/sign/documents/a?token=t",
    `${O}/storage/v1/object/sign/documents/a`,
    `${O}/storage/v1/object/sign/documents/?token=t`,
    "http://abc.supabase.co/storage/v1/object/sign/documents/a?token=t",
    "not a url",
  ]) assert.equal(allowedObjectUrl(bad, O), false, bad);
});

test("parseClients binds each secret to an origin; refuses a short secret, an origin with a path, or nothing, never echoing a secret (mutation: accept an empty list -> FAILS)", () => {
  const s1 = "s".repeat(16);
  const s2 = "t".repeat(24);
  assert.deepEqual(parseClients(`${s1}@https://one.supabase.co, ${s2}@http://127.0.0.1:54321`),
    [{ secret: s1, origin: "https://one.supabase.co" }, { secret: s2, origin: "http://127.0.0.1:54321" }]);
  for (const bad of ["", "   ", "short@https://one.supabase.co", `${s1}@https://one.supabase.co/storage`, `${s1}`]) {
    assert.throws(() => parseClients(bad), (e) => !String(e.message).includes(s1), bad);
  }
});
```

`services/scanner/test/server.test.mjs`:

```js
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { createScanner } from "../src/server.mjs";
import { sign } from "../src/hmac.mjs";
import { startFakeClamd } from "./fake-clamd.mjs";
import { eicar, cleanPdf } from "./eicar.mjs";

const SECRET = "server-test-secret-0001";
let clamd, storage, elsewhere, scanner, base, origin, elsewhereOrigin;
const logs = [];
const hits = [];
const elsewhereHits = [];
const FILES = {
  "clean.pdf": cleanPdf(2048),
  "bad.pdf": Buffer.concat([Buffer.from("%PDF-1.4\n% "), Buffer.from(eicar()), Buffer.from("\n%%EOF\n")]),
  "err.pdf": Buffer.concat([cleanPdf(100), Buffer.from("FAKE-CLAMD-ERROR")]),
  "locked.pdf": Buffer.concat([cleanPdf(100), Buffer.from("FAKE-CLAMD-ENCRYPTED")]),
  "big-declared.pdf": cleanPdf(5000),
  "big-chunked.pdf": cleanPdf(5000),
};
const listen = (server) => new Promise((r) => server.listen(0, "127.0.0.1", () => r(server.address().port)));

before(async () => {
  clamd = await startFakeClamd();
  elsewhere = http.createServer((req, res) => { elsewhereHits.push(req.url); res.writeHead(200, { "content-length": "2048" }).end(cleanPdf(2048)); });
  elsewhereOrigin = `http://127.0.0.1:${await listen(elsewhere)}`;
  storage = http.createServer((req, res) => {
    hits.push(req.url);
    const name = new URL(req.url, "http://x").pathname.split("/").pop();
    if (name === "moved.pdf") {
      res.writeHead(302, { location: `${elsewhereOrigin}/storage/v1/object/sign/documents/acct/doc/clean.pdf?token=t` }).end();
      return;
    }
    // Storage's refusals (final check R2): only a real "not found" is "missing"; every other refusal is transport.
    if (name === "forbidden.pdf") { res.writeHead(403, { "content-type": "application/json" }).end('{"statusCode":"403","error":"Unauthorized"}'); return; }
    if (name === "busy.pdf") { res.writeHead(429).end(); return; }
    if (name === "gone400.pdf") { res.writeHead(400, { "content-type": "application/json" }).end('{"statusCode":"404","error":"not_found","message":"Object not found"}'); return; }
    if (name === "bad400.pdf") { res.writeHead(400, { "content-type": "application/json" }).end('{"statusCode":"400","error":"InvalidJWT"}'); return; }
    if (name === "slow.pdf") { res.writeHead(200); res.write("%PDF-1.4\n"); return; } // never ends
    const f = FILES[name];
    if (!f) { res.writeHead(404).end(); return; }
    if (name === "big-chunked.pdf") {
      // Plan review I1: NO content-length, so only the streaming byte counter can refuse it.
      res.writeHead(200);
      for (let at = 0; at < f.length; at += 1000) res.write(f.subarray(at, at + 1000));
      res.end();
      return;
    }
    res.writeHead(200, { "content-length": String(f.length) }).end(f);
  });
  origin = `http://127.0.0.1:${await listen(storage)}`;
  scanner = createScanner({
    clients: [{ secret: SECRET, origin }], clamd: { host: "127.0.0.1", port: clamd.port }, maxBytes: 4096,
    log: { log: (s) => logs.push(s), error: (s) => logs.push(s) },
  });
  base = `http://127.0.0.1:${await listen(scanner)}`;
});
after(async () => { scanner.close(); storage.closeAllConnections(); storage.close(); elsewhere.close(); await clamd.close(); });

const call = (method, path, body = "", secret = SECRET, ts = Math.floor(Date.now() / 1000)) => fetch(`${base}${path}`, {
  method, body: method === "POST" ? body : undefined,
  headers: { "x-bis-scan-timestamp": String(ts), "x-bis-scan-signature": sign(secret, ts, method, path, body) },
});
const objectUrl = (name, o = origin) => `${o}/storage/v1/object/sign/documents/acct/doc/${name}?token=secret-token`;
const scan = async (name) => (await call("POST", "/scan", JSON.stringify({ url: objectUrl(name) }))).json();

test("a clean file is clean, the EICAR file is infected with its name (mutations: treat every reply as clean -> FAILS; drop the FOUND parse -> FAILS)", async () => {
  assert.deepEqual(await scan("clean.pdf"), { verdict: "clean" });
  assert.deepEqual(await scan("bad.pdf"), { verdict: "infected", signature: "Eicar-Test-Signature" });
});

test("clamd's own ERROR about this stream is stage clamd; an encrypted document is unscannable, never clean or infected (plan review C1, C2; mutations: stage 'transport' for a clamd reply -> FAILS; drop the Heuristics mapping -> 'infected' -> FAILS)", async () => {
  assert.deepEqual(await scan("err.pdf"), { verdict: "error", stage: "clamd" });
  assert.deepEqual(await scan("locked.pdf"), { verdict: "unscannable", signature: "Heuristics.Encrypted.PDF" });
});

test("storage's own not-found (a 404, or its 400 saying 404 / not_found) is 'missing'; every OTHER refusal (403, 429, any other 400) is transport and never counts (final check R2; mutations: 'missing' for any 4xx -> the 403, 429 and 400 cases FAIL; drop the 400-body check -> gone400 FAILS)", async () => {
  assert.deepEqual(await scan("nothing-here.pdf"), { verdict: "error", stage: "missing" });
  assert.deepEqual(await scan("gone400.pdf"), { verdict: "error", stage: "missing" });
  assert.deepEqual(await scan("forbidden.pdf"), { verdict: "error", stage: "transport" });
  assert.deepEqual(await scan("busy.pdf"), { verdict: "error", stage: "transport" });
  assert.deepEqual(await scan("bad400.pdf"), { verdict: "error", stage: "transport" });
});

test("a timeout is transport, never the file's: slow storage or a busy clamd can never count against a file (final check R2; mutation: stage 'missing' or 'clamd' on abort -> FAILS)", async () => {
  const quick = createScanner({ clients: [{ secret: SECRET, origin }], clamd: { host: "127.0.0.1", port: clamd.port }, timeoutMs: 300, log: { log() {}, error() {} } });
  const port = await listen(quick);
  const ts = Math.floor(Date.now() / 1000);
  const body = JSON.stringify({ url: objectUrl("slow.pdf") });
  const r = await fetch(`http://127.0.0.1:${port}/scan`, { method: "POST", body, headers: { "x-bis-scan-timestamp": String(ts), "x-bis-scan-signature": sign(SECRET, ts, "POST", "/scan", body) } });
  assert.deepEqual(await r.json(), { verdict: "error", stage: "transport" });
  quick.close();
});

test("a file over the limit is an error that never counts, never clean: refused by its declared length AND, served chunked with no length, by the streaming counter (plan review I1; mutation: drop the byte counter in clamd.mjs -> the chunked file reads clean -> FAILS)", async () => {
  assert.deepEqual(await scan("big-declared.pdf"), { verdict: "error", stage: "transport" });
  assert.deepEqual(await scan("big-chunked.pdf"), { verdict: "error", stage: "transport" });
});

test("a redirect is refused: a transport error, and the place it pointed to is never asked (plan review I2; mutation: redirect 'follow' -> clean, and a hit elsewhere -> FAILS)", async () => {
  assert.deepEqual(await scan("moved.pdf"), { verdict: "error", stage: "transport" });
  assert.equal(elsewhereHits.length, 0);
});

test("a bad signature is 401 and a foreign URL is 403, and NEITHER fetches anything (mutation: fetch before verifying -> the hit count moves -> FAILS)", async () => {
  const before = hits.length;
  assert.equal((await call("POST", "/scan", JSON.stringify({ url: objectUrl("clean.pdf") }), "wrong-secret-wrong-0001")).status, 401);
  assert.equal((await call("POST", "/scan", JSON.stringify({ url: objectUrl("clean.pdf") }), SECRET, Math.floor(Date.now() / 1000) - 120)).status, 401);
  assert.equal((await call("POST", "/scan", JSON.stringify({ url: objectUrl("clean.pdf", "http://127.0.0.2:9") }))).status, 403);
  assert.equal((await call("POST", "/scan", "{")).status, 400);
  assert.equal(hits.length, before);
});

test("health: clamd reachable with its signature date; with clamd down, health says so and a scan is a TRANSPORT error (mutations: answer clamd:true without a PING -> FAILS; stage 'clamd' when clamd is unreachable -> FAILS)", async () => {
  const ok = await (await call("GET", "/health")).json();
  assert.equal(ok.clamd, true);
  assert.equal(ok.selfTest, true);
  assert.ok(Math.abs(Date.now() - Date.parse(ok.signaturesAt)) < 120_000, ok.signaturesAt);
  const down = createScanner({ clients: [{ secret: SECRET, origin }], clamd: { host: "127.0.0.1", port: 1 }, log: { log() {}, error() {} } });
  const port = await listen(down);
  const ts = Math.floor(Date.now() / 1000);
  const signed = (method, path, body) => ({ "x-bis-scan-timestamp": String(ts), "x-bis-scan-signature": sign(SECRET, ts, method, path, body) });
  const r = await fetch(`http://127.0.0.1:${port}/health`, { headers: signed("GET", "/health", "") });
  assert.deepEqual(await r.json(), { clamd: false });
  const body = JSON.stringify({ url: objectUrl("clean.pdf") });
  const s = await fetch(`http://127.0.0.1:${port}/scan`, { method: "POST", body, headers: signed("POST", "/scan", body) });
  assert.deepEqual(await s.json(), { verdict: "error", stage: "transport" });
  down.close();
});

test("a clamd that answers PING but cannot scan FAILS its self-test, and every scan is stage clamd (re-review N2a; mutation: report selfTest:true without the INSTREAM -> FAILS)", async () => {
  const sick = await startFakeClamd(0, "127.0.0.1", { broken: true });
  const s2 = createScanner({ clients: [{ secret: SECRET, origin }], clamd: { host: "127.0.0.1", port: sick.port }, log: { log() {}, error() {} } });
  const port = await listen(s2);
  const ts = Math.floor(Date.now() / 1000);
  const signed = (method, path, body) => ({ "x-bis-scan-timestamp": String(ts), "x-bis-scan-signature": sign(SECRET, ts, method, path, body) });
  const h = await (await fetch(`http://127.0.0.1:${port}/health`, { headers: signed("GET", "/health", "") })).json();
  assert.equal(h.clamd, true);
  assert.equal(h.selfTest, false);
  const body = JSON.stringify({ url: objectUrl("clean.pdf") });
  assert.deepEqual(await (await fetch(`http://127.0.0.1:${port}/scan`, { method: "POST", body, headers: signed("POST", "/scan", body) })).json(), { verdict: "error", stage: "clamd" });
  s2.close();
  await sick.close();
});

test("other routes are 404, a body over 8 KiB is 413, and no log line ever carries the URL's token (mutation: log the url -> FAILS)", async () => {
  assert.equal((await call("GET", "/scan")).status, 404);
  assert.equal((await call("POST", "/scan", "x".repeat(9000))).status, 413);
  assert.ok(logs.length > 0);
  assert.equal(logs.filter((l) => l.includes("secret-token") || l.includes("/storage/")).length, 0);
});
```

- [ ] **Step 3: Run red.** From `<WT>`: `node --test "services/scanner/test/*.test.mjs"` → every test fails (the `src/` modules do not exist). Read the `# fail` line.

- [ ] **Step 4: Write the shim.**

`services/scanner/src/hmac.mjs`:

```js
import { createHmac, timingSafeEqual } from "node:crypto";

/** Spec 3.1: a request older or newer than this is refused before anything is fetched. */
export const MAX_SKEW_SECONDS = 60;

/** The canonical string is `${timestamp}.${METHOD}.${path}.${body}`; apps/web/src/lib/documents/scan-client.ts signs the same. */
export function sign(secret, timestamp, method, path, body) {
  return createHmac("sha256", secret).update(`${timestamp}.${method}.${path}.${body}`).digest("hex");
}

/** The client whose secret signed this request within the skew, or null. Constant-time per candidate. */
export function verify(clients, headers, method, path, body, nowSeconds) {
  const ts = Number(headers["x-bis-scan-timestamp"]);
  const got = String(headers["x-bis-scan-signature"] ?? "");
  if (!Number.isInteger(ts) || Math.abs(nowSeconds - ts) > MAX_SKEW_SECONDS) return null;
  if (!/^[0-9a-f]{64}$/.test(got)) return null;
  const given = Buffer.from(got, "hex");
  for (const client of clients) {
    if (timingSafeEqual(Buffer.from(sign(client.secret, ts, method, path, body), "hex"), given)) return client;
  }
  return null;
}
```

`services/scanner/src/config.mjs`:

```js
/**
 * SCANNER_CLIENTS: `<secret>@<origin>` entries, separated by commas or spaces (plan deviation 4).
 * Each caller (Production, Preview, the e2e stack) has its own secret, and a request signed with it
 * may only fetch from that caller's own storage origin. Errors never echo a secret.
 */
export function parseClients(raw) {
  const entries = String(raw ?? "").split(/[\s,]+/).filter(Boolean);
  if (entries.length === 0) throw new Error("SCANNER_CLIENTS is empty: refusing to start");
  return entries.map((entry) => {
    const at = entry.indexOf("@");
    if (at < 16) throw new Error("SCANNER_CLIENTS: each entry is <secret of 16 or more characters>@<origin>");
    const originText = entry.slice(at + 1).replace(/\/$/, "");
    let origin;
    try { origin = new URL(originText).origin; } catch { throw new Error("SCANNER_CLIENTS: an origin is not a URL"); }
    if (origin !== originText) throw new Error("SCANNER_CLIENTS: an origin is scheme://host[:port] only");
    return { secret: entry.slice(0, at), origin };
  });
}
```

`services/scanner/src/allow.mjs`:

```js
/** Spec 3.1: the shim fetches only a signed GET on the documents bucket, at the caller's own origin. */
export const OBJECT_PREFIX = "/storage/v1/object/sign/documents/";

export function allowedObjectUrl(raw, origin) {
  let u;
  try { u = new URL(raw); } catch { return false; }
  if (u.origin !== origin || u.username !== "" || u.password !== "") return false;
  // The URL parser resolves "..", "." and their %2e forms before this check, but it does NOT decode
  // an encoded slash or backslash (%2F, %5C): a path carrying either could be decoded into another
  // directory further along, so it is refused outright. Real object paths are account/document/version
  // uuids and never contain one.
  if (/%2f|%5c/i.test(u.pathname)) return false;
  if (!u.pathname.startsWith(OBJECT_PREFIX) || u.pathname.length === OBJECT_PREFIX.length) return false;
  return u.searchParams.has("token");
}
```

`services/scanner/src/clamd.mjs`:

```js
import net from "node:net";
import { once } from "node:events";

/** clamd's TCP protocol (clamd(8)): z-prefixed commands, NUL-terminated replies; INSTREAM takes length-prefixed chunks and a zero length to end. */
const CHUNK = 64 * 1024;

function connect({ host, port }, signal) {
  const socket = net.connect({ host, port });
  const abort = () => socket.destroy(new Error("clamd: timed out"));
  signal?.addEventListener("abort", abort, { once: true });
  socket.once("close", () => signal?.removeEventListener("abort", abort));
  return socket;
}

function replyOf(socket) {
  const reply = new Promise((resolve, reject) => {
    let acc = "";
    socket.on("data", (d) => {
      acc += d.toString("utf8");
      const end = acc.indexOf("\0");
      if (end >= 0) resolve(acc.slice(0, end));
    });
    socket.on("end", () => resolve(acc));
    socket.on("error", reject);
  });
  reply.catch(() => {}); // awaited by the caller; never an unhandled rejection meanwhile
  return reply;
}

export async function command(clamd, name, timeoutMs = 5000) {
  const socket = connect(clamd, AbortSignal.timeout(timeoutMs));
  const reply = replyOf(socket);
  try {
    await once(socket, "connect");
    socket.write(`z${name}\0`);
    return (await reply).trim();
  } finally {
    socket.destroy();
  }
}

/** Streams `body` (an async iterable of bytes) to clamd and answers its reply. Throws past `maxBytes`. */
export async function instream(clamd, body, { maxBytes, signal }) {
  const socket = connect(clamd, signal);
  const reply = replyOf(socket);
  try {
    await once(socket, "connect");
    socket.write("zINSTREAM\0");
    let total = 0;
    for await (const piece of body) {
      const buf = Buffer.from(piece);
      total += buf.length;
      if (total > maxBytes) throw new Error("too large");
      for (let at = 0; at < buf.length; at += CHUNK) {
        const part = buf.subarray(at, at + CHUNK);
        const head = Buffer.alloc(4);
        head.writeUInt32BE(part.length, 0);
        if (!socket.write(Buffer.concat([head, part]))) await once(socket, "drain");
      }
    }
    socket.write(Buffer.alloc(4));
    return (await reply).trim();
  } finally {
    socket.destroy();
  }
}
```

`services/scanner/src/scan.mjs`:

```js
import { instream } from "./clamd.mjs";

/**
 * WHERE an error came from decides whether it may count against the file (plan review C1; final
 * check R2, orchestrator ruling): "clamd": clamd read this stream and answered ERROR about it.
 * "missing": storage said THIS object does not exist (404, or Supabase storage's 400 carrying
 * statusCode "404" / error "not_found"); the app re-checks existence with its own service-role client
 * before it counts. Everything else is "transport" and never counts: any other 4xx (400, 401, 403,
 * 429), any 5xx, a redirect, a network failure, ANY timeout (fetch or clamd, so slow storage or a
 * signature reload can never walk files to "unscannable"), the size limit, clamd unreachable or silent.
 * Plan review C2: with AlertExceedsMax and the AlertEncrypted* options on (Dockerfile), content clamd
 * could not fully read is reported as a Heuristics.Limits.Exceeded.* or Heuristics.Encrypted.* FOUND:
 * that is neither clean nor a virus, it is "unscannable".
 */
const LIMIT_OR_ENCRYPTED = /^Heuristics\.(Limits\.Exceeded|Encrypted)/;

export function parseReply(reply) {
  const r = reply.trim();
  if (r === "stream: OK") return { verdict: "clean" };
  const found = /^stream: (.+) FOUND$/.exec(r);
  if (found) {
    const name = found[1].slice(0, 200);
    return LIMIT_OR_ENCRYPTED.test(name) ? { verdict: "unscannable", signature: name } : { verdict: "infected", signature: name };
  }
  return { verdict: "error", stage: "clamd", reason: r.slice(0, 120) };
}

/** Storage's own "this object does not exist": a 404, or a 400 whose JSON body says 404 / not_found. */
async function saysMissing(res) {
  if (res.status === 404) return true;
  if (res.status !== 400) return false;
  try {
    const body = JSON.parse((await res.text()).slice(0, 2000));
    return String(body?.statusCode) === "404" || body?.error === "not_found";
  } catch {
    return false;
  }
}

/** Fetches ONE signed object and streams it to clamd. Never throws; never logs the URL. */
export async function scanUrl(url, { clamd, maxBytes, timeoutMs, fetchImpl = fetch }) {
  const signal = AbortSignal.timeout(timeoutMs);
  const error = (stage, reason) => ({ verdict: "error", stage, reason });
  let res;
  try {
    res = await fetchImpl(url, { redirect: "error", signal });
  } catch {
    return error("transport", "fetch failed");
  }
  if (!res.ok || !res.body) return error((await saysMissing(res)) ? "missing" : "transport", `fetch answered ${res.status}`);
  const declared = Number(res.headers.get("content-length") ?? Number.NaN);
  if (Number.isFinite(declared) && declared > maxBytes) return error("transport", "too large");
  let reply;
  try {
    reply = await instream(clamd, res.body, { maxBytes, signal });
  } catch (e) {
    return error("transport", String(e?.message ?? e).slice(0, 120));
  }
  if (reply.trim() === "") return error("transport", "clamd closed without a reply");
  return parseReply(reply);
}
```

`services/scanner/src/server.mjs`:

```js
import http from "node:http";
import { pathToFileURL } from "node:url";
import { verify } from "./hmac.mjs";
import { parseClients } from "./config.mjs";
import { allowedObjectUrl } from "./allow.mjs";
import { command, instream } from "./clamd.mjs";
import { scanUrl, parseReply } from "./scan.mjs";

/**
 * The document vault's scanner (docs/superpowers/specs/2026-10-15-document-vault-part2-design.md 3.1).
 * Two routes, both HMAC-signed: POST /scan { url } and GET /health. It writes nothing anywhere and
 * holds no database or storage credential; it can only scan a URL a caller hands it, from that
 * caller's own storage origin. A scan answers clean, infected, unscannable (a limit or encryption,
 * plan review C2) or error with its stage (clamd, file or transport, plan review C1 and re-review N3).
 * /health also runs a SELF-TEST (re-review N2a): a tiny fixed clean buffer streamed through INSTREAM
 * must answer OK. A clamd that answers PING but cannot scan (out of memory, a broken signature set)
 * fails it, and the app then spends no attempt on any file.
 */
export const MAX_BODY = 8192;
export const MAX_BYTES = 26214400; // 25 MiB: document-rules.ts's DOCUMENT_MAX_BYTES
export const SCAN_TIMEOUT_MS = 25000;
export const SELF_TEST = Buffer.from("BIS scanner self-test: a fixed, clean buffer.\n");

/** "ClamAV 1.4.3/27791/Wed Oct 15 08:27:02 2026" -> the signature database's date, ISO; null when unreadable. */
export function signaturesAt(version) {
  const date = String(version).split("/")[2];
  if (!date) return null;
  const t = Date.parse(`${date.trim()} UTC`);
  return Number.isNaN(t) ? null : new Date(t).toISOString();
}

async function readBody(req, max) {
  let size = 0;
  const parts = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > max) return null;
    parts.push(chunk);
  }
  return Buffer.concat(parts).toString("utf8");
}

/** The wire answer: never the reason text (it can name an internal error), only the verdict, a name, or the stage. */
export function wireVerdict(v) {
  if (v.verdict === "infected" || v.verdict === "unscannable") return { verdict: v.verdict, signature: v.signature };
  if (v.verdict === "error") return { verdict: "error", stage: v.stage };
  return { verdict: "clean" };
}

export function createScanner({ clients, clamd, maxBytes = MAX_BYTES, timeoutMs = SCAN_TIMEOUT_MS, now = () => Math.floor(Date.now() / 1000), fetchImpl = fetch, log = console }) {
  return http.createServer(async (req, res) => {
    const send = (status, body) => {
      res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
      res.end(body === undefined ? "" : JSON.stringify(body));
    };
    try {
      const path = new URL(req.url ?? "/", "http://scanner").pathname;
      const route = `${req.method} ${path}`;
      if (route !== "POST /scan" && route !== "GET /health") return send(404);
      const body = await readBody(req, MAX_BODY);
      if (body === null) return send(413);
      const client = verify(clients, req.headers, req.method, path, body, now());
      if (!client) return send(401);
      if (route === "GET /health") {
        try {
          if ((await command(clamd, "PING")) !== "PONG") return send(200, { clamd: false });
          const at = signaturesAt(await command(clamd, "VERSION"));
          let selfTest = false;
          try {
            selfTest = parseReply(await instream(clamd, [SELF_TEST], { maxBytes: 1024, signal: AbortSignal.timeout(5000) })).verdict === "clean";
          } catch { selfTest = false; }
          return send(200, { clamd: true, signaturesAt: at, selfTest });
        } catch {
          return send(200, { clamd: false });
        }
      }
      let url;
      try { url = JSON.parse(body)?.url; } catch { return send(400); }
      if (typeof url !== "string" || !allowedObjectUrl(url, client.origin)) return send(403);
      const started = Date.now();
      const v = await scanUrl(url, { clamd, maxBytes, timeoutMs, fetchImpl });
      log.log(JSON.stringify({ scan: v.verdict, ...(v.stage ? { stage: v.stage } : {}), ms: Date.now() - started, ...(v.reason ? { reason: v.reason } : {}) }));
      return send(200, wireVerdict(v));
    } catch (e) {
      log.error(`scanner: ${String(e?.message ?? e).slice(0, 200)}`);
      return send(500);
    }
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const clients = parseClients(process.env.SCANNER_CLIENTS);
  const clamd = { host: process.env.CLAMD_HOST ?? "127.0.0.1", port: Number(process.env.CLAMD_PORT ?? 3310) };
  const port = Number(process.env.PORT ?? 8080);
  createScanner({ clients, clamd }).listen(port, "0.0.0.0", () => console.log(`scanner listening on ${port} for ${clients.length} caller(s)`));
}
```

- [ ] **Step 5: Run green.** `node --test "services/scanner/test/*.test.mjs"` → `# fail 0`, and the `# pass` count equals the number of `test(` calls in the three files (14). (The plan writer ran this exact code: 14 of 14 on Node 24.13, and the I1, I2, C1, %2F, self-test and "missing for any 4xx" mutations each turned one test red by name.) Also read the defaults Step 1 printed for `MaxFileSize`, `MaxScanSize`, `StreamMaxLength`, `MaxRecursion`, `MaxFiles`: if any default is ABOVE the Dockerfile's value, raise the Dockerfile's to it (N1: never below the default) and say so.

- [ ] **Step 6: The image and the deploy config.**

`services/scanner/Dockerfile`:

```dockerfile
# The document vault's virus scanner (spec 2026-10-15 section 3.1): the official ClamAV image, its
# signatures preloaded, plus a dependency-free Node shim. clamd and freshclam run as daemons beside it.
FROM clamav/clamav:1.4

# Every directive this file owns is deleted first, then set once, so a value in the base image can never
# survive beside ours. Each name is read off the 1.4 image in plan Task 4 step 1 (assumption A13 until then).
# NO LIMIT IS SET BELOW 1.4's OWN DEFAULT (plan re-review N1: 1.4's clamd.conf.sample gives MaxFileSize
# 100M and MaxScanSize 400M; a limit applies to every member unpacked from an Office file, so lowering it
# would delete ordinary exports). MaxRecursion and MaxFiles keep their defaults (not set here).
#   StreamMaxLength 100M: at least 1.4's default; the shim itself refuses past 25 MiB, so this never binds.
#   MaxFileSize 400M / MaxScanSize 1000M: a 25 MiB Office upload whose XML unpacks to hundreds of MB still
#     scans in full (the CI job proves a 300 MiB expansion is clean and reports its time and peak memory,
#     A1, A15). ORCHESTRATOR RULING 2026-10-15: anything that expands past these is treated as a
#     decompression bomb: unscannable, removed, the generic note (accepted residual, deviation 16).
#   AlertExceedsMax yes: content skipped under any limit is REPORTED (Heuristics.Limits.Exceeded.*), never
#     a silent OK; the shim maps it to "unscannable" (plan review C2).
#   AlertEncrypted / AlertEncryptedArchive / AlertEncryptedDoc yes: content clamd cannot read because it is
#     encrypted is reported (Heuristics.Encrypted.*), never a silent OK; "unscannable", and the note says
#     the file has a password (owner ruling 2026-10-15).
#   ConcurrentDatabaseReload no: one signature set in memory during a reload, so 2 GB holds (deviation 12).
#   TCPSocket 3310 / TCPAddr 127.0.0.1: clamd answers the shim on loopback only, never the machine's network.
#   Foreground no: both daemonise, and start.sh runs the shim in the foreground.
RUN apk add --no-cache nodejs \
 && for d in StreamMaxLength MaxFileSize MaxScanSize AlertExceedsMax AlertEncrypted AlertEncryptedArchive AlertEncryptedDoc ConcurrentDatabaseReload TCPSocket TCPAddr Foreground; do \
      sed -i -e "/^${d} /d" /etc/clamav/clamd.conf; \
    done \
 && printf '%s\n' 'StreamMaxLength 100M' 'MaxFileSize 400M' 'MaxScanSize 1000M' 'AlertExceedsMax yes' 'AlertEncrypted yes' 'AlertEncryptedArchive yes' 'AlertEncryptedDoc yes' 'ConcurrentDatabaseReload no' 'TCPSocket 3310' 'TCPAddr 127.0.0.1' 'Foreground no' >> /etc/clamav/clamd.conf \
 && sed -i -e '/^Foreground /d' /etc/clamav/freshclam.conf \
 && printf '%s\n' 'Foreground no' >> /etc/clamav/freshclam.conf \
 && node --version

COPY --chown=clamav:clamav src/ /app/src/
COPY --chown=clamav:clamav start.sh /app/start.sh
RUN chmod 0755 /app/start.sh

USER clamav
EXPOSE 8080
ENTRYPOINT ["/app/start.sh"]
```

`services/scanner/.dockerignore`:

```
test/
fly.toml
*.md
```

`services/scanner/start.sh` (LF line endings; `.gitattributes` already forces `eol=lf`):

```sh
#!/bin/sh
# Signature updates and clamd as daemons, then the shim in the foreground: if the shim dies, the
# machine restarts; if clamd dies, /health answers clamd:false and the app's heartbeat goes red.
# freshclam is allowed to fail at start (a mirror refusing, a network blip): the image's preloaded
# signatures stand, and if they grow old the heartbeat says "signatures N hours old" (assumption A14:
# whether `freshclam --daemon` exits non-zero on a failed first update is read in plan Task 4 step 7
# and the CI job's log). clamd is NOT allowed to fail: set -eu stops the machine, and Fly restarts it.
set -eu
freshclam --daemon || echo "start.sh: freshclam did not start; the image's signatures stand until it does"
clamd
exec node /app/src/server.mjs
```

`services/scanner/fly.toml`:

```toml
# The document vault's virus scanner (spec 2026-10-15 section 3.1; docs/runbooks/scanner.md).
# One always-on machine: clamd must stay warm, so nothing stops it (P2). It holds no database or
# storage credential: its one secret, SCANNER_CLIENTS, is set with `<FLYCTL> secrets set`, never here.
app = "bis-scanner"
primary_region = "iad"

[build]
  dockerfile = "Dockerfile"

[env]
  PORT = "8080"
  CLAMD_HOST = "127.0.0.1"
  CLAMD_PORT = "3310"

[http_service]
  internal_port = 8080
  force_https = true
  auto_stop_machines = "off"
  auto_start_machines = false
  min_machines_running = 1

# A TCP check only: both routes are signed, and a health check cannot sign.
[checks]
  [checks.alive]
    type = "tcp"
    port = 8080
    interval = "30s"
    timeout = "5s"
    grace_period = "180s"

[[vm]]
  size = "shared-cpu-1x"
  memory = "2gb"
```

The app name `bis-scanner` is a placeholder the orchestrator may change at `<FLYCTL> launch` (Fly app names are global); `SCANNER_URL` follows whatever it becomes.

`services/scanner/test/real-clamd.mjs` (the CI job runs it against the built image; also runnable locally after Step 7's `docker run`):

```js
import http from "node:http";
import assert from "node:assert/strict";
import { sign } from "../src/hmac.mjs";
import { eicar, eicarDocx, cleanPdf, storedZip, xlsxExpanding } from "./eicar.mjs";

/**
 * The worker against the REAL clamd (spec 7): EICAR is infected; the EICAR DOCX the Preview check
 * uploads is infected (A6); a clean 25 MiB PDF is clean; a 25 MiB file whose LAST member is EICAR is
 * infected, which proves clamd read the whole stream under the configured limits rather than skipping
 * past one (A3, plan review C2); an XLSX-shaped file of about 1 MB that unpacks to 300 MB of XML is
 * CLEAN, its scan time printed (A15) and the machine's peak memory read by the CI step after this one
 * (A1; re-review N1: no limit may delete an ordinary export); /health's self-test passes (N2a); the
 * signature date reads (A7); a refused request fetches nothing.
 * Serves its files itself, as storage would, on 127.0.0.1:8098; the scanner must allow that origin
 * (SCANNER_CLIENTS=<secret>@http://127.0.0.1:8098).
 */
const SCANNER = process.env.SCANNER_URL ?? "http://127.0.0.1:8080";
const SECRET = process.env.SCANNER_SECRET;
if (!SECRET) throw new Error("SCANNER_SECRET is required");
const MiB = 1024 * 1024;
const tail = storedZip([
  ["[Content_Types].xml", Buffer.from('<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>')],
  ["word/filler.bin", Buffer.alloc(24 * MiB, 0x20)],
  ["eicar.com", Buffer.from(eicar())],
]);
const FILES = { "eicar.txt": Buffer.from(eicar()), "eicar.docx": eicarDocx(), "clean.pdf": cleanPdf(2048), "big.pdf": cleanPdf(25 * MiB), "tail.docx": tail, "export.xlsx": xlsxExpanding(300 * MiB) };
assert.ok(tail.length <= 25 * MiB, `tail.docx is ${tail.length} bytes, over the 25 MiB the bucket allows`);
let hits = 0;
const storage = http.createServer((req, res) => {
  hits++;
  const f = FILES[new URL(req.url, "http://x").pathname.split("/").pop()];
  if (!f) { res.writeHead(404).end(); return; }
  res.writeHead(200, { "content-length": String(f.length) }).end(f);
});
await new Promise((r) => storage.listen(8098, "127.0.0.1", r));

const call = (method, path, body = "", secret = SECRET) => {
  const ts = Math.floor(Date.now() / 1000);
  return fetch(`${SCANNER}${path}`, { method, body: method === "POST" ? body : undefined,
    headers: { "x-bis-scan-timestamp": String(ts), "x-bis-scan-signature": secret ? sign(secret, ts, method, path, body) : "0".repeat(64) } });
};
const url = (name, origin = "http://127.0.0.1:8098") => `${origin}/storage/v1/object/sign/documents/ci/${name}?token=t`;
const scan = async (name) => (await call("POST", "/scan", JSON.stringify({ url: url(name) }))).json();

let health = null;
for (const deadline = Date.now() + 300_000; Date.now() < deadline; await new Promise((r) => setTimeout(r, 5000))) {
  try { const r = await call("GET", "/health"); if (r.ok) { health = await r.json(); if (health.clamd) break; } } catch { /* not up yet */ }
}
assert.equal(health?.clamd, true, "clamd never answered PING (assumptions A5, A13, A14)");
assert.ok(Date.now() - Date.parse(health.signaturesAt) < 7 * 86_400_000, `signatures dated ${health.signaturesAt} (A7)`);
assert.equal(health.selfTest, true, "the INSTREAM self-test on a clean buffer (re-review N2a)");
const raw = await scan("eicar.txt");
assert.equal(raw.verdict, "infected");
assert.match(raw.signature, /eicar/i);
assert.equal((await scan("eicar.docx")).verdict, "infected", "EICAR inside a stored DOCX member (A6)");
assert.deepEqual(await scan("clean.pdf"), { verdict: "clean" });
assert.deepEqual(await scan("big.pdf"), { verdict: "clean" }, "a clean 25 MiB stream (A3)");
const tailVerdict = await scan("tail.docx");
assert.equal(tailVerdict.verdict, "infected", `EICAR at the tail of a 25 MiB file (A3): ${JSON.stringify(tailVerdict)}`);
const started = Date.now();
const expanding = await scan("export.xlsx");
const expandMs = Date.now() - started;
console.log(JSON.stringify({ a15: { xlsxUnpacked: "300 MiB", scanMs: expandMs } }));
assert.deepEqual(expanding, { verdict: "clean" }, `a 300 MiB-unpacking XLSX must be clean, not limited or timed out (re-review N1, A15): ${JSON.stringify(expanding)} after ${expandMs} ms`);
assert.ok(expandMs < 20_000, `the 300 MiB-unpacking XLSX took ${expandMs} ms: over the pass's 20 s start window (A15)`);
const before = hits;
assert.equal((await call("POST", "/scan", JSON.stringify({ url: url("eicar.txt", "http://127.0.0.2:8098") }))).status, 403);
assert.equal((await call("POST", "/scan", JSON.stringify({ url: url("eicar.txt") }), null)).status, 401);
assert.equal(hits, before, "a refused request fetched nothing");
console.log(JSON.stringify({ ok: true, health, eicar: raw.signature }));
storage.close();
```

- [ ] **Step 7: The real thing, locally, if Docker is available.** From `<WT>`:

```bash
docker build -t bis-scanner-local services/scanner
docker run -d --rm --name bis-scanner-local --network host -e PORT=8080 -e "SCANNER_CLIENTS=local_scanner_check_only@http://127.0.0.1:8098" bis-scanner-local
SCANNER_URL=http://127.0.0.1:8080 SCANNER_SECRET=local_scanner_check_only node services/scanner/test/real-clamd.mjs
docker stats --no-stream bis-scanner-local
docker stop bis-scanner-local
```

Expected: the build prints `node --version` ≥ v20 (A9); `real-clamd.mjs` prints `{"ok":true,…}`; `docker stats` shows MEM USAGE (paste it: A1's first reading); `docker logs bis-scanner-local` shows whether freshclam started or printed start.sh's line (A14). Docker Desktop on Windows does not support `--network host` for Linux containers the same way; if the script cannot reach 8080, use `-p 8080:8080` and `SCANNER_CLIENTS=…@http://host.docker.internal:8098` with the script's origin changed to match, or leave this step to the CI job and say so.

- [ ] **Step 8: Probes, red BY NAME, restored:** (1) `sign` over `` `${timestamp}\n${method}…` `` → the vector test (and, after Task 5, the app's too); (2) drop `Math.abs(…) > MAX_SKEW_SECONDS` → the verify test; (3) in `allowedObjectUrl`, `startsWith("/storage/v1/object/")` → the allow test; (4) in the server, call `scanUrl` before `verify` → the "NEITHER fetches" test; (5) `parseReply` returns clean for everything → the infected test; (6) log `url` in the scan line → the token test; (7) delete the `total > maxBytes` line in `clamd.mjs` → the chunked over-the-limit test (I1); (8) `redirect: "follow"` → the redirect test (I2); (9) `stage: "transport"` for clamd's own error line → the C1/C2 test; (10) drop the `%2f|%5c` refusal → the allow test; (11) drop the Heuristics mapping → the C1/C2 test (`infected`); (12) answer `selfTest: true` without running the INSTREAM → the self-test test (N2a); (13) `missing` for any storage 4xx → the storage-refusals test (403, 429 and a non-not-found 400 must stay transport; R2); (14) a non-transport stage when the scan times out → the timeout test (R2).

- [ ] **Step 9: Commit.** `git add -- services/scanner` then `git commit -m "feat(scanner): the ClamAV worker, a signed two-route shim, its image, fly.toml and tests; a fake clamd for e2e (S-07 part 2a)" -- services/scanner`

---

## Task 5: The app's scan client and the one-version scan procedure (bis-crm)

**Review:** opus. **After:** Task 3 (the `@bis/db` names) and Task 4 (the wire contract and its vector). Server-only modules: they import `node:crypto` and the `@bis/db` barrel, and neither mentions `serviceDb` (they take the caller's client).

**Files**
- Create: `apps/web/src/lib/documents/scan-client.ts`, `apps/web/src/lib/documents/scan-client.test.ts`
- Create: `apps/web/src/lib/documents/scan-version.ts`, `apps/web/src/lib/documents/scan-version.test.ts`

**Interfaces**
- Consumes: `signedScannerUrl`, `recordDocumentScan`, `DOCUMENT_BUCKET`, `SupabaseClient` (Task 3); the wire contract and HMAC vector (Task 4).
- Produces:

```ts
// scan-client.ts
export const SCAN_TIMEOUT_MS = 25_000;
export const HEALTH_TIMEOUT_MS = 5_000;
export const SCANNER_HEARTBEAT_KEY = "documents.scanner";
export type ScanVerdict = { verdict: "clean" } | { verdict: "infected"; signature: string } | { verdict: "unscannable"; signature: string } | { verdict: "error"; cause: "clamd" | "missing" | "transport" };
export type ScannerConfig = { origin: string; secret: string };
export type ScannerHealth = { ok: true; signaturesAt: string } | { ok: false; reason: "not_configured" | "unreachable" | "clamd_down" | "bad_answer" };
export type ScanClientDeps = { env?: Record<string, string | undefined>; fetchImpl?: typeof fetch; nowSeconds?: () => number };
export function scannerConfig(env?: Record<string, string | undefined>): ScannerConfig | null;
export function scanSignature(secret: string, timestamp: number, method: "GET" | "POST", path: string, body: string): string;
export async function requestScan(objectUrl: string, d?: ScanClientDeps): Promise<ScanVerdict>;   // never throws
export async function scannerHealth(d?: ScanClientDeps): Promise<ScannerHealth>;                  // never throws
// scan-version.ts
export const MAX_SCAN_ATTEMPTS = 3;
export type ScanTarget = { accountId: string; versionId: string; storagePath: string; attempts: number };
export type ScanResult = "clean" | "infected" | "unscannable" | "pending" | "stale" | "unreached" | "held";
export type ScanDeps = { configured: () => boolean; scan: (objectUrl: string) => Promise<ScanVerdict> };
export type ScanOptions = { holdErrors?: boolean };
export async function scanVersion(db: SupabaseClient, v: ScanTarget, deps?: ScanDeps, opts?: ScanOptions): Promise<ScanResult>;  // throws only when an object could not be removed
export async function spendScanError(db: SupabaseClient, v: ScanTarget): Promise<ScanResult>;  // the pass spends a held clamd error with it
```

- [ ] **Step 1: Write the failing tests.**

`apps/web/src/lib/documents/scan-client.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { scannerConfig, scanSignature, requestScan, scannerHealth } from "./scan-client";

const ENV = { SCANNER_URL: "https://bis-scanner.fly.dev", SCANNER_SECRET: "app-test-secret-0001" };
const BODY = JSON.stringify({ url: "https://abc.supabase.co/storage/v1/object/sign/documents/a/b/c?token=t" });
const answer = (status: number, body: unknown) => vi.fn(async () => new Response(typeof body === "string" ? body : JSON.stringify(body), { status }));
const URL_ = "https://abc.supabase.co/storage/v1/object/sign/documents/x/y/z?token=t";

describe("the wire contract (spec 3.1; plan Task 4)", () => {
  it("signs exactly as the worker verifies: the shared vector (mutation: a newline for '.' in the canonical string -> FAILS here AND in services/scanner/test/hmac.test.mjs)", () => {
    expect(scanSignature("test-secret", 1760000000, "POST", "/scan", BODY)).toBe("414f5bcfa4ebd5bb5e060b45bf091d4abfca66fd7bda2dfc2d8e752e64eaec01");
    expect(scanSignature("test-secret", 1760000000, "GET", "/health", "")).toBe("9b16b5e0e7895ed3b63577ae46200cc556595994f9e89e9323a8bd08568a5996");
  });

  it("config: both values, https, or http on loopback only (mutations: accept http anywhere -> FAILS; drop the secret check -> FAILS)", () => {
    expect(scannerConfig(ENV)).toEqual({ origin: "https://bis-scanner.fly.dev", secret: "app-test-secret-0001" });
    expect(scannerConfig({ ...ENV, SCANNER_URL: "http://127.0.0.1:8399" })).toEqual({ origin: "http://127.0.0.1:8399", secret: "app-test-secret-0001" });
    expect(scannerConfig({ ...ENV, SCANNER_URL: "http://bis-scanner.fly.dev" })).toBeNull();
    expect(scannerConfig({ ...ENV, SCANNER_SECRET: " " })).toBeNull();
    expect(scannerConfig({ SCANNER_SECRET: "x" })).toBeNull();
    expect(scannerConfig({ ...ENV, SCANNER_URL: "not a url" })).toBeNull();
  });
});

describe("requestScan: one signed POST, never throws (spec 3.4)", () => {
  it("posts the URL with a fresh timestamp and its signature, and maps clean, infected and unscannable (mutations: sign with the path '/' -> FAILS; map infected to clean -> FAILS; map unscannable to infected -> FAILS)", async () => {
    const fetchImpl = answer(200, { verdict: "infected", signature: "Eicar-Test-Signature" });
    expect(await requestScan(URL_, { env: ENV, fetchImpl, nowSeconds: () => 1760000123 })).toEqual({ verdict: "infected", signature: "Eicar-Test-Signature" });
    const [target, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit & { headers: Record<string, string> }];
    expect(target).toBe("https://bis-scanner.fly.dev/scan");
    expect(init.method).toBe("POST");
    expect(init.body).toBe(JSON.stringify({ url: URL_ }));
    expect(init.headers["x-bis-scan-timestamp"]).toBe("1760000123");
    expect(init.headers["x-bis-scan-signature"]).toBe(scanSignature(ENV.SCANNER_SECRET, 1760000123, "POST", "/scan", JSON.stringify({ url: URL_ })));
    expect(await requestScan(URL_, { env: ENV, fetchImpl: answer(200, { verdict: "clean" }) })).toEqual({ verdict: "clean" });
    expect(await requestScan(URL_, { env: ENV, fetchImpl: answer(200, { verdict: "unscannable", signature: "Heuristics.Encrypted.PDF" }) }))
      .toEqual({ verdict: "unscannable", signature: "Heuristics.Encrypted.PDF" });
  });

  it("ONLY a well-formed 200 naming clamd or a missing object carries a countable cause; every other answer is transport (plan review C1, final check R2; mutations: any error as clamd -> FAILS; a 403 as countable -> FAILS; the old 'file' stage as countable -> FAILS)", async () => {
    expect(await requestScan(URL_, { env: ENV, fetchImpl: answer(200, { verdict: "error", stage: "clamd" }) })).toEqual({ verdict: "error", cause: "clamd" });
    expect(await requestScan(URL_, { env: ENV, fetchImpl: answer(200, { verdict: "error", stage: "missing" }) })).toEqual({ verdict: "error", cause: "missing" });
    expect(await requestScan(URL_, { env: ENV, fetchImpl: answer(200, { verdict: "error", stage: "file" }) })).toEqual({ verdict: "error", cause: "transport" });
    for (const fetchImpl of [
      answer(200, { verdict: "error", stage: "transport" }), answer(200, { verdict: "error" }),
      answer(401, ""), answer(403, { verdict: "error", stage: "clamd" }), answer(500, ""), answer(200, "nope"),
      answer(200, { verdict: "infected" }), answer(200, { verdict: "maybe" }),
      vi.fn(async () => { throw new Error("ECONNREFUSED"); }),
    ]) {
      expect(await requestScan(URL_, { env: ENV, fetchImpl: fetchImpl as unknown as typeof fetch })).toEqual({ verdict: "error", cause: "transport" });
    }
    const never = vi.fn();
    expect(await requestScan(URL_, { env: {}, fetchImpl: never as unknown as typeof fetch })).toEqual({ verdict: "error", cause: "transport" });
    expect(never).not.toHaveBeenCalled();
  });
});

describe("scannerHealth (spec 3.4: the heartbeat's input)", () => {
  it("maps the worker's answer (mutations: treat clamd:false as ok -> FAILS; accept a missing date -> FAILS)", async () => {
    const at = "2026-10-15T08:27:02.000Z";
    expect(await scannerHealth({ env: ENV, fetchImpl: answer(200, { clamd: true, signaturesAt: at, selfTest: true }) })).toEqual({ ok: true, signaturesAt: at });
    // Re-review N2a: PING alone is not health; a clamd that cannot scan fails (mutation: ignore selfTest -> FAILS).
    expect(await scannerHealth({ env: ENV, fetchImpl: answer(200, { clamd: true, signaturesAt: at, selfTest: false }) })).toEqual({ ok: false, reason: "self_test_failed" });
    expect(await scannerHealth({ env: ENV, fetchImpl: answer(200, { clamd: true, signaturesAt: at }) })).toEqual({ ok: false, reason: "self_test_failed" });
    expect(await scannerHealth({ env: ENV, fetchImpl: answer(200, { clamd: false }) })).toEqual({ ok: false, reason: "clamd_down" });
    expect(await scannerHealth({ env: ENV, fetchImpl: answer(200, { clamd: true, signaturesAt: null, selfTest: true }) })).toEqual({ ok: false, reason: "bad_answer" });
    expect(await scannerHealth({ env: ENV, fetchImpl: answer(401, "") })).toEqual({ ok: false, reason: "unreachable" });
    expect(await scannerHealth({ env: ENV, fetchImpl: vi.fn(async () => { throw new Error("x"); }) as unknown as typeof fetch })).toEqual({ ok: false, reason: "unreachable" });
    expect(await scannerHealth({ env: {} })).toEqual({ ok: false, reason: "not_configured" });
  });
});
```

`apps/web/src/lib/documents/scan-version.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const calls: string[] = [];
const recordDocumentScan = vi.fn();
const signedScannerUrl = vi.fn();
vi.mock("@bis/db", () => ({
  DOCUMENT_BUCKET: "documents",
  recordDocumentScan: (...a: unknown[]) => { calls.push(`record:${(a[1] as { verdict: string }).verdict}`); return recordDocumentScan(...a); },
  signedScannerUrl: (...a: unknown[]) => { calls.push("mint"); return signedScannerUrl(...a); },
}));
const { scanVersion, spendScanError, MAX_SCAN_ATTEMPTS } = await import("./scan-version");

const remove = vi.fn();
const list = vi.fn();
const DB = { storage: { from: vi.fn(() => ({
  remove: (...a: unknown[]) => { calls.push("remove"); return remove(...a); },
  list: (...a: unknown[]) => { calls.push("list"); return list(...a); },
})) } } as never;
const V = { accountId: "acc", versionId: "ver", storagePath: "acc/doc/ver", attempts: 0 };
const deps = (verdict: unknown, configured = true) => ({
  configured: () => configured,
  scan: vi.fn(async () => { calls.push("scan"); return verdict as never; }),
});

beforeEach(() => {
  calls.length = 0;
  recordDocumentScan.mockReset(); signedScannerUrl.mockReset(); remove.mockReset(); list.mockReset();
  signedScannerUrl.mockResolvedValue("https://s/sign");
  remove.mockResolvedValue({ data: [], error: null });
  list.mockResolvedValue({ data: [], error: null });
});

describe("scanVersion (spec 3.2-3.4; owner decision P4: nothing infected is kept)", () => {
  it("not configured: Checking stays, nothing is minted, scanned, recorded or removed (mutation: scan anyway -> FAILS)", async () => {
    expect(await scanVersion(DB, V, deps({ verdict: "clean" }, false))).toBe("pending");
    expect(calls).toEqual([]);
  });

  it("clean: mint the scanner's own URL for THIS path, scan it, record clean; nothing removed (mutation: mint for another path -> FAILS)", async () => {
    recordDocumentScan.mockResolvedValue({ status: "ok", attempts: 1 });
    const d = deps({ verdict: "clean" });
    expect(await scanVersion(DB, V, d)).toBe("clean");
    expect(signedScannerUrl).toHaveBeenCalledWith(DB, "acc/doc/ver");
    expect(d.scan).toHaveBeenCalledWith("https://s/sign");
    expect(calls).toEqual(["mint", "scan", "record:clean"]);
  });

  it("infected: the OBJECT goes first, then the verdict with its name (mutation: record before removing -> the order FAILS)", async () => {
    recordDocumentScan.mockResolvedValue({ status: "ok", attempts: 1 });
    expect(await scanVersion(DB, V, deps({ verdict: "infected", signature: "Eicar-Test-Signature" }))).toBe("infected");
    expect(calls).toEqual(["mint", "scan", "remove", "record:infected"]);
    expect(remove).toHaveBeenCalledWith(["acc/doc/ver"]);
    expect(recordDocumentScan).toHaveBeenCalledWith(DB, { accountId: "acc", versionId: "ver", verdict: "infected", signature: "Eicar-Test-Signature" });
  });

  it("content clamd could not read is removed as unscannable at once, object first, and clamd's named cause is KEPT so the note can say 'it has a password' (plan review C2; owner ruling 2026-10-15; mutations: treat it as clean -> FAILS; pass null for the signature -> FAILS)", async () => {
    recordDocumentScan.mockResolvedValue({ status: "ok", attempts: 1 });
    expect(await scanVersion(DB, V, deps({ verdict: "unscannable", signature: "Heuristics.Encrypted.PDF" }))).toBe("unscannable");
    expect(calls).toEqual(["mint", "scan", "remove", "record:unscannable"]);
    expect(recordDocumentScan).toHaveBeenCalledWith(DB, { accountId: "acc", versionId: "ver", verdict: "unscannable", signature: "Heuristics.Encrypted.PDF" });
  });

  it("the unscannable path SPECIFICALLY carries the signature it was given, whatever it says (a limit as well as a password) (final check R1; mutation: drop or replace the signature on the unscannable branch only -> FAILS, while the infected case above stays green)", async () => {
    recordDocumentScan.mockResolvedValue({ status: "ok", attempts: 1 });
    await scanVersion(DB, V, deps({ verdict: "unscannable", signature: "Heuristics.Limits.Exceeded.MaxScanSize" }));
    const unscannableCalls = recordDocumentScan.mock.calls.filter((c) => (c[1] as { verdict: string }).verdict === "unscannable");
    expect(unscannableCalls.map((c) => (c[1] as { signature: string | null }).signature)).toEqual(["Heuristics.Limits.Exceeded.MaxScanSize"]);
  });

  it("an object that will not go THROWS and records nothing, so the version stays pending for the next pass (mutation: record anyway -> FAILS)", async () => {
    remove.mockResolvedValue({ data: null, error: { message: "storage down" } });
    await expect(scanVersion(DB, V, deps({ verdict: "infected", signature: "X" }))).rejects.toThrow(/not removed/);
    expect(recordDocumentScan).not.toHaveBeenCalled();
  });

  it("a transport error (a 403, a 429, any timeout) never counts and writes nothing, even with attempts at two (plan review C1, final check R2; mutation: count it -> FAILS)", async () => {
    expect(await scanVersion(DB, { ...V, attempts: 2 }, deps({ verdict: "error", cause: "transport" }))).toBe("unreached");
    expect(calls).toEqual(["mint", "scan"]);
  });

  it("'missing' counts ONLY when the app confirms the object is gone with its own storage list (final check R2; mutations: count without the list -> the 'found' half FAILS; never count -> the 'gone' half FAILS)", async () => {
    // The object IS there: storage's not-found was wrong (or a race); nothing counts.
    list.mockResolvedValueOnce({ data: [{ name: "ver" }], error: null });
    expect(await scanVersion(DB, V, deps({ verdict: "error", cause: "missing" }), { holdErrors: true })).toBe("unreached");
    expect(list).toHaveBeenCalledWith("acc/doc", { search: "ver", limit: 10 });
    // The list itself fails: cannot confirm, nothing counts.
    list.mockResolvedValueOnce({ data: null, error: { message: "storage down" } });
    expect(await scanVersion(DB, V, deps({ verdict: "error", cause: "missing" }), { holdErrors: true })).toBe("unreached");
    // Confirmed gone: it is held for the pass to spend.
    list.mockResolvedValueOnce({ data: [{ name: "other" }], error: null });
    expect(await scanVersion(DB, V, deps({ verdict: "error", cause: "missing" }), { holdErrors: true })).toBe("held");
    expect(recordDocumentScan).not.toHaveBeenCalled();
  });

  it("a clamd error spends an attempt and stays Checking; the THIRD removes the object and records unscannable with the generic cause (mutations: MAX 4 -> FAILS; skip the remove -> FAILS)", async () => {
    recordDocumentScan.mockResolvedValueOnce({ status: "ok", attempts: 1 });
    expect(await scanVersion(DB, V, deps({ verdict: "error", cause: "clamd" }))).toBe("pending");
    expect(calls).toEqual(["mint", "scan", "record:error"]);
    calls.length = 0;
    recordDocumentScan.mockResolvedValueOnce({ status: "ok", attempts: MAX_SCAN_ATTEMPTS }).mockResolvedValueOnce({ status: "ok", attempts: MAX_SCAN_ATTEMPTS + 1 });
    expect(await scanVersion(DB, { ...V, attempts: 2 }, deps({ verdict: "error", cause: "clamd" }))).toBe("unscannable");
    expect(calls).toEqual(["mint", "scan", "record:error", "remove", "record:unscannable"]);
    expect(MAX_SCAN_ATTEMPTS).toBe(3);
  });

  it("holdErrors: a clamd error is HELD, nothing written, for the pass to spend or not (its breaker); spendScanError spends it later (mutation: write while holding -> FAILS)", async () => {
    expect(await scanVersion(DB, V, deps({ verdict: "error", cause: "clamd" }), { holdErrors: true })).toBe("held");
    expect(calls).toEqual(["mint", "scan"]);
    calls.length = 0;
    recordDocumentScan.mockResolvedValueOnce({ status: "ok", attempts: 1 });
    expect(await spendScanError(DB, V)).toBe("pending");
    expect(calls).toEqual(["record:error"]);
  });

  it("a version that already used its three attempts is given up WITHOUT another scan (a crash between the third error and its removal) (mutation: scan again -> FAILS)", async () => {
    recordDocumentScan.mockResolvedValue({ status: "ok", attempts: 4 });
    expect(await scanVersion(DB, { ...V, attempts: 3 }, deps({ verdict: "clean" }))).toBe("unscannable");
    expect(calls).toEqual(["remove", "record:unscannable"]);
  });

  it("a verdict someone else recorded first is stale, and the caller learns it (mutation: answer clean on stale -> FAILS)", async () => {
    recordDocumentScan.mockResolvedValue({ status: "stale" });
    expect(await scanVersion(DB, V, deps({ verdict: "clean" }))).toBe("stale");
  });
});
```

- [ ] **Step 2: Run red.** `pnpm --filter web exec vitest run src/lib/documents/scan-client.test.ts src/lib/documents/scan-version.test.ts` → both files fail (modules missing).

- [ ] **Step 3: Implement.**

`apps/web/src/lib/documents/scan-client.ts`:

```ts
import { createHmac } from "node:crypto";

/**
 * The app's side of the document vault's scanner (spec 3.1, 3.4; services/scanner). Two calls, each
 * signed with this deployment's SCANNER_SECRET over `${timestamp}.${METHOD}.${path}.${body}` (the
 * worker's own canonical string, services/scanner/src/hmac.mjs; both tests pin one vector). SERVER
 * ONLY. Neither call ever throws: every failure is an error verdict or an unhealthy answer, so a down
 * worker leaves files Checking (owner decision P3), never open. SCANNER_URL must be https, except on
 * loopback for the e2e stack (apps/web/playwright.config.ts).
 * Plan review C1; final check R2 (orchestrator ruling): an error carries its CAUSE. "clamd": the worker
 * answered a well-formed 200 saying clamd failed on this stream. "missing": the worker says storage
 * reported THIS object not found; scanVersion re-checks that itself with the service-role client and
 * counts it only when the object is confirmed gone. Everything else (a non-200 from the worker such as
 * a 401/403 from a misconfigured binding, stage "transport", a network failure, junk) is "transport"
 * and never counts. Even a countable error is only HELD by scanVersion; the retry pass spends it after
 * the worker's self-test passes again in the same run (re-review N2a), and the finish never spends one.
 */
export const SCAN_TIMEOUT_MS = 25_000;
export const HEALTH_TIMEOUT_MS = 5_000;
/** The heartbeat the retry pass writes and /api/ops/health reads (0057's ops_heartbeats; not a cron.pass key). */
export const SCANNER_HEARTBEAT_KEY = "documents.scanner";

export type ScanVerdict =
  | { verdict: "clean" }
  | { verdict: "infected"; signature: string }
  | { verdict: "unscannable"; signature: string }
  | { verdict: "error"; cause: "clamd" | "missing" | "transport" };
export type ScannerConfig = { origin: string; secret: string };
export type ScannerHealth = { ok: true; signaturesAt: string } | { ok: false; reason: "not_configured" | "unreachable" | "clamd_down" | "self_test_failed" | "bad_answer" };
export type ScanClientDeps = { env?: Record<string, string | undefined>; fetchImpl?: typeof fetch; nowSeconds?: () => number };

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const NOT_SPENT: ScanVerdict = { verdict: "error", cause: "transport" };

export function scannerConfig(env: Record<string, string | undefined> = process.env): ScannerConfig | null {
  const raw = env.SCANNER_URL?.trim();
  const secret = env.SCANNER_SECRET?.trim();
  if (!raw || !secret) return null;
  let u: URL;
  try { u = new URL(raw); } catch { return null; }
  const loopback = u.hostname === "127.0.0.1" || u.hostname === "localhost";
  if (!(u.protocol === "https:" || (u.protocol === "http:" && loopback))) return null;
  return { origin: u.origin, secret };
}

export function scanSignature(secret: string, timestamp: number, method: "GET" | "POST", path: string, body: string): string {
  return createHmac("sha256", secret).update(`${timestamp}.${method}.${path}.${body}`).digest("hex");
}

async function call(cfg: ScannerConfig, method: "GET" | "POST", path: string, body: string, d: ScanClientDeps, timeoutMs: number): Promise<Response> {
  const ts = (d.nowSeconds ?? (() => Math.floor(Date.now() / 1000)))();
  return (d.fetchImpl ?? fetch)(`${cfg.origin}${path}`, {
    method, body: method === "POST" ? body : undefined, cache: "no-store", signal: AbortSignal.timeout(timeoutMs),
    headers: { "content-type": "application/json", "x-bis-scan-timestamp": String(ts), "x-bis-scan-signature": scanSignature(cfg.secret, ts, method, path, body) },
  });
}

/** Asks the worker to scan ONE signed object URL. Never throws; anything but a well-formed verdict is an unspent error. */
export async function requestScan(objectUrl: string, d: ScanClientDeps = {}): Promise<ScanVerdict> {
  const cfg = scannerConfig(d.env ?? process.env);
  if (!cfg) return NOT_SPENT;
  try {
    const res = await call(cfg, "POST", "/scan", JSON.stringify({ url: objectUrl }), d, SCAN_TIMEOUT_MS);
    if (res.status !== 200) return NOT_SPENT;
    const body: unknown = await res.json();
    if (!isObj(body)) return NOT_SPENT;
    if (body.verdict === "clean") return { verdict: "clean" };
    const name = typeof body.signature === "string" ? body.signature.trim().slice(0, 200) : "";
    if ((body.verdict === "infected" || body.verdict === "unscannable") && name !== "") return { verdict: body.verdict, signature: name };
    if (body.verdict === "error" && (body.stage === "clamd" || body.stage === "missing")) return { verdict: "error", cause: body.stage };
    return NOT_SPENT;
  } catch {
    return NOT_SPENT;
  }
}

/** The worker's /health, its INSTREAM self-test included (re-review N2a): ok only when clamd scanned the fixed clean buffer clean. Never throws. */
export async function scannerHealth(d: ScanClientDeps = {}): Promise<ScannerHealth> {
  const cfg = scannerConfig(d.env ?? process.env);
  if (!cfg) return { ok: false, reason: "not_configured" };
  try {
    const res = await call(cfg, "GET", "/health", "", d, HEALTH_TIMEOUT_MS);
    if (res.status !== 200) return { ok: false, reason: "unreachable" };
    const body: unknown = await res.json();
    if (!isObj(body)) return { ok: false, reason: "bad_answer" };
    if (body.clamd !== true) return { ok: false, reason: "clamd_down" };
    if (body.selfTest !== true) return { ok: false, reason: "self_test_failed" };
    if (typeof body.signaturesAt !== "string" || Number.isNaN(Date.parse(body.signaturesAt))) return { ok: false, reason: "bad_answer" };
    return { ok: true, signaturesAt: body.signaturesAt };
  } catch {
    return { ok: false, reason: "unreachable" };
  }
}
```

`apps/web/src/lib/documents/scan-version.ts`:

```ts
import { recordDocumentScan, signedScannerUrl, DOCUMENT_BUCKET, type SupabaseClient } from "@bis/db";
import { requestScan, scannerConfig, type ScanVerdict } from "./scan-client";

/**
 * Scans ONE ready version and records what happened (spec 3.2-3.4). Called by the finish action at
 * once and by the retry pass for whatever is still pending; 2b's customer finish will call it too.
 * `db` is the caller's service client, after its own proof. Owner decision P4, nothing infected is
 * kept: on a virus, on content clamd could not read (a limit or encryption, plan review C2), or on the
 * third counted error, the OBJECT is removed FIRST and only then is the verdict recorded, so a crash in
 * between leaves the version pending and the next pass finds it again (attempts already at three:
 * removed without another scan). A removal that fails THROWS and records nothing.
 * Owner ruling 2026-10-15: an unscannable verdict keeps clamd's named cause (Heuristics.Encrypted.* =
 * a password), so the note can say why.
 * Counting (plan review C1; final check R2, orchestrator ruling): only two causes may count against a
 * file. "clamd": clamd failed on this stream. "missing": the worker says storage reported the object
 * not found, AND this module confirms it with the service-role client (a list of the exact path); if
 * the object is there after all, or the check itself fails, nothing counts. Every other failure answers
 * "unreached" and writes nothing. A countable error is HELD (`holdErrors`); the retry pass spends it
 * only after the worker's self-test passes again in the same run, and the finish never spends. With no
 * scanner configured the file stays Checking (plan deviation 14).
 * Accepted residual (plan review 8): the finish and the pass can scan the same fresh version at
 * once. The first verdict recorded wins and the other answers "stale"; the finish never spends, so the
 * two can never disagree into a removal under a clean verdict.
 */
export const MAX_SCAN_ATTEMPTS = 3;
export type ScanTarget = { accountId: string; versionId: string; storagePath: string; attempts: number };
export type ScanResult = "clean" | "infected" | "unscannable" | "pending" | "stale" | "unreached" | "held";
export type ScanDeps = { configured: () => boolean; scan: (objectUrl: string) => Promise<ScanVerdict> };
export type ScanOptions = { holdErrors?: boolean };

const REAL: ScanDeps = { configured: () => scannerConfig() !== null, scan: (u) => requestScan(u) };

async function removeThenRecord(
  db: SupabaseClient, v: ScanTarget, verdict: "infected" | "unscannable", signature: string | null,
): Promise<ScanResult> {
  const { error } = await db.storage.from(DOCUMENT_BUCKET).remove([v.storagePath]);
  if (error) throw new Error(`scan: version ${v.versionId}'s object was not removed, so it stays pending for the next pass: ${error.message}`);
  const r = await recordDocumentScan(db, { accountId: v.accountId, versionId: v.versionId, verdict, signature });
  return r.status === "ok" ? verdict : "stale";
}

/** Final check R2: the object is CONFIRMED gone only when a list of its own folder answers without error and without it. */
async function confirmedMissing(db: SupabaseClient, storagePath: string): Promise<boolean> {
  const cut = storagePath.lastIndexOf("/");
  const name = storagePath.slice(cut + 1);
  const { data, error } = await db.storage.from(DOCUMENT_BUCKET).list(storagePath.slice(0, cut), { search: name, limit: 10 });
  if (error) return false;
  return !(data ?? []).some((o: { name: string }) => o.name === name);
}

/** Spends ONE attempt for a countable error; the third removes the object and records unscannable. */
export async function spendScanError(db: SupabaseClient, v: ScanTarget): Promise<ScanResult> {
  const r = await recordDocumentScan(db, { accountId: v.accountId, versionId: v.versionId, verdict: "error" });
  if (r.status === "stale") return "stale";
  return r.attempts >= MAX_SCAN_ATTEMPTS ? removeThenRecord(db, v, "unscannable", null) : "pending";
}

export async function scanVersion(db: SupabaseClient, v: ScanTarget, deps: ScanDeps = REAL, opts: ScanOptions = {}): Promise<ScanResult> {
  if (!deps.configured()) return "pending";
  if (v.attempts >= MAX_SCAN_ATTEMPTS) return removeThenRecord(db, v, "unscannable", null);
  const verdict = await deps.scan(await signedScannerUrl(db, v.storagePath));
  if (verdict.verdict === "clean") {
    const r = await recordDocumentScan(db, { accountId: v.accountId, versionId: v.versionId, verdict: "clean" });
    return r.status === "ok" ? "clean" : "stale";
  }
  if (verdict.verdict === "infected") return removeThenRecord(db, v, "infected", verdict.signature);
  // Owner ruling 2026-10-15: keep clamd's named cause (Heuristics.Encrypted.* = a password) so the note can say why.
  if (verdict.verdict === "unscannable") return removeThenRecord(db, v, "unscannable", verdict.signature);
  if (verdict.cause === "transport") return "unreached";
  if (verdict.cause === "missing" && !(await confirmedMissing(db, v.storagePath))) return "unreached";
  if (opts.holdErrors) return "held";
  return spendScanError(db, v);
}
```

- [ ] **Step 4: Run green.** Step 2's command → PASS, and the summary counts 5 + 12 tests. `pnpm --filter web exec eslint src/lib/documents/scan-client.ts src/lib/documents/scan-version.ts src/lib/documents/scan-client.test.ts src/lib/documents/scan-version.test.ts` → clean. `grep -c serviceDb apps/web/src/lib/documents/scan-*.ts` → 0 each.

- [ ] **Step 5: Probes, red BY NAME, restored:** (1) canonical string with `\n` → the vector case; (2) `u.protocol === "http:"` alone (no loopback rule) → the config case; (3) `return { verdict: "clean" }` in requestScan's catch → the failure case; (4) swap `remove` and `recordDocumentScan` in `removeThenRecord` → the infected order case; (5) `MAX_SCAN_ATTEMPTS = 4` → the third-error case; (6) in `scanVersion`, drop the `attempts >= MAX` early return → the given-up case; (7) drop `if (!deps.configured())` → the not-configured case; (8) count a `transport` cause → the transport case (C1, R2); (8b) skip `confirmedMissing` → the 'missing' case's found half (R2); (8c) pass `null` as the unscannable signature → BOTH the C2 case and the unscannable-path case (R1); (9) spend when `holdErrors` → the held case; (10) in the client, any `verdict: "error"` as `clamd` → the cause case (C1); (11) map `unscannable` to `infected` in the client → the mapping case.

- [ ] **Step 6: Commit.** `git add -- apps/web/src/lib/documents/scan-client.ts apps/web/src/lib/documents/scan-client.test.ts apps/web/src/lib/documents/scan-version.ts apps/web/src/lib/documents/scan-version.test.ts` then `git commit -m "feat(documents): the signed scan client and the one-version scan, object first on a virus (S-07 part 2a)" -- <the same four paths>`

---

## Task 6: The finish scans; the URL action through the gate; the source scan (bis-crm)

**Review:** opus. **After:** Tasks 2, 3, 5.

**Files**
- Modify: `…/contacts/documents-actions.ts` (imports `:6-16`; `finishDocumentUploadAction` `:211-278`; `getDocumentUrlAction` `:298-320`)
- Modify: `…/contacts/documents-actions.test.ts` (the `@bis/db` mock `:9-25`; the finish cases `:110-…`; the URL cases `:195-230`)
- Create: `apps/web/src/lib/documents/read-gate.test.ts`

**Interfaces**
- Consumes: `signedDocumentReadUrl` (Task 3); `scanVersion`, `ScanResult` (Task 5); keys `documents.error.scanning`, `documents.error.removed` (Task 2).
- Produces: `finishDocumentUploadAction(accountId, documentId, versionId): Promise<{ ok: true; scan: ScanResult } | DocFail>` (the upload client reads only `.ok`, `upload-client.ts:65-66`, so it is unchanged); `getDocumentUrlAction` answers `documents.error.scanning` for a pending version and `documents.error.removed` for an infected or unscannable one.

- [ ] **Step 1: Write the failing tests.**

  In `documents-actions.test.ts`: add `signedDocumentReadUrl: vi.fn()` to the `db` object (`:13-18`), and add above `const A = await import(…)`:

```ts
const scanVersion = vi.fn();
vi.mock("@/lib/documents/scan-version", () => ({ scanVersion: (...a: unknown[]) => scanVersion(...a) }));
```

  In the `beforeEach` that resets mocks (or a new one at the top of each new describe), `scanVersion.mockReset(); scanVersion.mockResolvedValue("clean");`. Every existing finish case that answered `toEqual({ ok: true })` (`:112`, `:140`) now answers `toEqual({ ok: true, scan: "clean" })`. Replace the URL cases at `:195-230` so that each asserts on `db.signedDocumentReadUrl` instead of `storage.createSignedUrl`, keeping their names and mutations: the Word case expects `toHaveBeenCalledWith(SERVICE, ACC, V, { seconds: 120, download: "Lease.docx" })`; Excel `{ seconds: 120, download: "Lease.xlsx" }`; the inline PDF `{ seconds: 120, download: undefined }`; the not-found and uploading cases `not.toHaveBeenCalled()`; each `mockResolvedValue({ status: "ok", url: "https://x/sign" })` where the old one returned `{ data: { signedUrl: … } }`. Then add:

```ts
describe("virus scanning in the actions (S-07 2a; spec 3.3, 3.4)", () => {
  it("the finish scans ONCE, after the version is ready, with its own path and no attempts, and answers the scan's outcome (mutations: scan before markDocumentVersionReady -> the order FAILS; drop the scan -> FAILS)", async () => {
    requireAccountAccess.mockResolvedValue(OWNER);
    db.getDocument.mockResolvedValue(DOC);
    db.getUploadingVersion.mockResolvedValue({ id: V, document_id: D, account_id: ACC, storage_path: `${ACC}/${D}/${V}`, bytes: PDF.length, content_type: "application/pdf", status: "uploading" });
    storage.download.mockResolvedValue({ data: new Blob([PDF], { type: "application/pdf" }), error: null });
    db.markDocumentVersionReady.mockResolvedValue(true);
    scanVersion.mockResolvedValue("infected");
    expect(await A.finishDocumentUploadAction(ACC, D, V)).toEqual({ ok: true, scan: "infected" });
    expect(scanVersion).toHaveBeenCalledTimes(1);
    // Re-review N2a: the finish holds any countable error; only the pass spends (mutation: drop holdErrors -> FAILS).
    expect(scanVersion).toHaveBeenCalledWith(SERVICE, { accountId: ACC, versionId: V, storagePath: `${ACC}/${D}/${V}`, attempts: 0 }, undefined, { holdErrors: true });
    expect(db.markDocumentVersionReady.mock.invocationCallOrder[0]!).toBeLessThan(scanVersion.mock.invocationCallOrder[0]!);
  });

  it("a scan that throws never fails the upload: the file is stored and stays Checking (mutation: let the throw reach the catch -> documents.error.upload -> FAILS)", async () => {
    requireAccountAccess.mockResolvedValue(OWNER);
    db.getDocument.mockResolvedValue(DOC);
    db.getUploadingVersion.mockResolvedValue({ id: V, document_id: D, account_id: ACC, storage_path: "p", bytes: PDF.length, content_type: "application/pdf", status: "uploading" });
    storage.download.mockResolvedValue({ data: new Blob([PDF], { type: "application/pdf" }), error: null });
    db.markDocumentVersionReady.mockResolvedValue(true);
    scanVersion.mockRejectedValue(new Error("storage down"));
    expect(await A.finishDocumentUploadAction(ACC, D, V)).toEqual({ ok: true, scan: "pending" });
  });

  it("a refused finish never scans (mutation: scan before checking mark's answer -> FAILS)", async () => {
    requireAccountAccess.mockResolvedValue(OWNER);
    db.getDocument.mockResolvedValue(DOC);
    db.getUploadingVersion.mockResolvedValue({ id: V, document_id: D, account_id: ACC, storage_path: "p", bytes: PDF.length, content_type: "application/pdf", status: "uploading" });
    storage.download.mockResolvedValue({ data: new Blob([PDF], { type: "application/pdf" }), error: null });
    db.markDocumentVersionReady.mockResolvedValue(false);
    expect(await A.finishDocumentUploadAction(ACC, D, V)).toEqual({ ok: false, error: "documents.error.refused" });
    expect(scanVersion).not.toHaveBeenCalled();
  });

  it("the URL goes through the one gate on the SERVICE client after the request-client proof, and says why it refused (mutations: answer fileNotFound for pending -> FAILS; mint without the gate -> FAILS)", async () => {
    requireAccountAccess.mockResolvedValue(STAFF);
    db.getDocumentVersion.mockResolvedValue(readyVersion("application/pdf"));
    db.getDocument.mockResolvedValue(DOC);
    db.signedDocumentReadUrl.mockResolvedValueOnce({ status: "pending" });
    expect(await A.getDocumentUrlAction(ACC, V, "view")).toEqual({ ok: false, error: "documents.error.scanning" });
    db.signedDocumentReadUrl.mockResolvedValueOnce({ status: "removed" });
    expect(await A.getDocumentUrlAction(ACC, V, "download")).toEqual({ ok: false, error: "documents.error.removed" });
    db.signedDocumentReadUrl.mockResolvedValueOnce({ status: "not_found" });
    expect(await A.getDocumentUrlAction(ACC, V, "view")).toEqual({ ok: false, error: "documents.error.fileNotFound" });
    expect(db.getDocumentVersion).toHaveBeenCalledWith(REQUEST, ACC, V);
    expect(db.signedDocumentReadUrl.mock.calls.every((c) => c[0] === SERVICE)).toBe(true);
    expect(storage.createSignedUrl).not.toHaveBeenCalled();
  });
});
```

  (If `readyVersion` lacks `scan_status`, add `scan_status: "clean"` to it: the action no longer reads it, the gate does.)

  `apps/web/src/lib/documents/read-gate.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Spec 3.3, "every file waits" BY CONSTRUCTION: a signed READ URL for a stored file is minted in ONE
 * place, signedDocumentReadUrl, which refuses unless the version is clean; the scanner's own URL in
 * one other, signedScannerUrl, called only by the scan procedure. This scan of the source fails the
 * moment a third mint appears (the PR 1a action minted its own, documents-actions.ts:312 before 2a).
 * Test files and e2e specs are not scanned: they may sign URLs to check storage.
 */
const ROOT = fileURLToPath(new URL("../../../../../", import.meta.url));
const TREES = ["apps/web/src", "packages/db/src"];

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === "node_modules" || name === "test" ? [] : sources(path);
    return /\.(ts|tsx)$/.test(name) && !/\.test\.(ts|tsx)$/.test(name) ? [path] : [];
  });
}
const files = TREES.flatMap((t) => sources(join(ROOT, t))).map((p) => ({ rel: relative(ROOT, p).split("\\").join("/"), text: readFileSync(p, "utf8") }));

describe("the read gate (spec 3.3)", () => {
  it("scans a real tree (positive control: it finds documents.ts and this module's own sibling)", () => {
    expect(files.map((f) => f.rel)).toEqual(expect.arrayContaining(["packages/db/src/documents.ts", "apps/web/src/lib/documents/scan-version.ts"]));
  });

  it("storage's signed-URL methods are named in exactly two places, both in documents.ts: a call, a createSignedUrls batch call or a destructured name all count (plan review 9; mutations: mint in documents-actions.ts again -> FAILS; `const { createSignedUrl } = svc.storage.from(b)` anywhere -> FAILS)", () => {
    const hits = files.flatMap((f) => (f.text.match(/\bcreateSignedUrls?\b/g) ?? []).map(() => f.rel));
    expect(hits).toEqual(["packages/db/src/documents.ts", "packages/db/src/documents.ts"]);
  });

  it("the scanner's URL is asked for only by the scan procedure (mutation: call signedScannerUrl from an action or a route -> FAILS)", () => {
    const users = files.filter((f) => f.text.includes("signedScannerUrl") && !f.rel.startsWith("packages/db/src/"));
    expect(users.map((f) => f.rel)).toEqual(["apps/web/src/lib/documents/scan-version.ts"]);
  });
});
```

- [ ] **Step 2: Run red.** `pnpm --filter web exec vitest run "src/app/(dashboard)/dashboard/accounts/[accountId]/contacts/documents-actions.test.ts" src/lib/documents/read-gate.test.ts` → the new and changed cases fail (the gate case: `createSignedUrl` still has a third caller).

- [ ] **Step 3: Implement** in `documents-actions.ts`.

  Imports: add `signedDocumentReadUrl` to the `@bis/db` import (`:6-11`) and `import { scanVersion, type ScanResult } from "@/lib/documents/scan-version";` after `:16`. Change the finish's return type to `Promise<{ ok: true; scan: ScanResult } | DocFail>` and replace `:269-273`:

```ts
    const ok = await markDocumentVersionReady(svc, { accountId, documentId: docId, versionId: verId, bytes: bytes.length, sha256, actorId: access.userId });
    // false: the database refused (size_mismatch, or the row is no longer uploading because another
    // finish made it ready). Nothing is removed here: the object may be that ready version's. A
    // reservation still uploading is the sweep's.
    if (!ok) return fail(REFUSED);
    // Spec 3.4: scanned at once, so a file normally reads "Checking" for a second or two only. A scan
    // that fails never fails the upload: the file is stored, stays Checking, and the retry pass
    // (passes/documents-scan.ts) scans it. A fresh version has spent no attempt.
    // Re-review N2a: the finish NEVER spends an attempt (holdErrors): only the retry pass does, after the
    // worker's self-test passes again in its own run.
    const scan = await scanVersion(svc, { accountId, versionId: verId, storagePath: version.storage_path, attempts: 0 }, undefined, { holdErrors: true })
      .catch((e: unknown): ScanResult => { log("finish: scan", accountId, e); return "pending"; });
    return { ok: true, scan };
```

  Replace `:310-315` in `getDocumentUrlAction`:

```ts
    // Word and Excel are never rendered (spec 4.3): always a download, named after the title.
    const download = mode === "download" || OFFICE_TYPES.includes(version.content_type);
    // Spec 3.3: the ONE gate mints, on the service client, AFTER the request-client proof above; it
    // re-reads the version and refuses anything not scanned clean (owner decision P3).
    const r = await signedDocumentReadUrl(serviceDb(), accountId, version.id, {
      seconds: URL_SECONDS, download: download ? `${doc.title}.${extensionForType(version.content_type)}` : undefined });
    if (r.status === "pending") return fail("documents.error.scanning");
    if (r.status === "removed") return fail("documents.error.removed");
    if (r.status !== "ok") return fail("documents.error.fileNotFound");
    return { ok: true, url: r.url, contentType: version.content_type };
```

  Update the file's header comment (`:18-28`) with one sentence: "A signed read URL is minted only through signedDocumentReadUrl (spec 3.3), never here."

- [ ] **Step 4: Run green.** Step 2's command → PASS. `pnpm --filter web typecheck` → clean in this task's files (`upload-client.ts` compiles unchanged: it reads `finished.ok` only). Also run `"src/app/(dashboard)/dashboard/accounts/[accountId]/in-account-service-reads.test.ts"` and `src/lib/documents/upload-client.test.ts` → PASS.

- [ ] **Step 5: Probes, red BY NAME, restored:** (1) call `scanVersion` before `markDocumentVersionReady` → the order case; (2) remove the `.catch` → the throw case; (3) `if (r.status === "pending") return fail("documents.error.fileNotFound")` → the gate case; (4) re-add a `serviceDb().storage.from(DOCUMENT_BUCKET).createSignedUrl(…)` line anywhere in the action → `read-gate.test.ts`'s two-places case; (5) import `signedScannerUrl` into the action and call it once → the scanner-URL case.

- [ ] **Step 6: Commit.** `git add -- apps/web/src/lib/documents/read-gate.test.ts` then `git commit -m "feat(documents): the finish scans at once; opening and downloading go through the one read gate, pinned by a source scan (S-07 part 2a)" -- "apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/contacts/documents-actions.ts" "apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/contacts/documents-actions.test.ts" apps/web/src/lib/documents/read-gate.test.ts`

---

## Task 7: The card's read: scan state in the view and the parser, `scan-state.ts` (bis-crm)

**Review:** sonnet. **After:** Tasks 2, 3.

**Files**
- Modify: `apps/web/src/lib/documents/document-view.ts` (`documentView`, `:27-39`)
- Modify: `apps/web/src/lib/documents/documents-load.ts` (types `:13-29`; `isVersionView` `:36-39`; `isView` `:46-58`; read 2026-10-15)
- Modify: `apps/web/src/lib/documents/documents-load.test.ts` (its fixture and two new cases)
- Modify: both documents route tests (fixtures gain `scan_status` on every version row they build, and the expected views gain `scan`/`createdAt`)
- Create: `apps/web/src/lib/documents/scan-state.ts`, `apps/web/src/lib/documents/scan-state.test.ts`

**Interfaces**
- Consumes: `ListedDocument` with `scan_status` on every version (Task 3); keys from Task 2.
- Produces (Task 9 and Task 8 use exactly these):

```ts
// documents-load.ts
export type ScanState = "pending" | "clean" | "infected" | "unscannable" | "locked";
export type DocumentVersionView = { id: string; contentType: DocumentContentType; bytes: number; createdAt: string; addedOn: string; scan: ScanState };
// DocumentView.version: { id: string; contentType: DocumentContentType; bytes: number; scan: ScanState; createdAt: string }
//   = the newest CLEAN ready version; when none is clean, the newest ready version with its state (plan deviation 1).
// scan-state.ts (browser-safe: no @bis/db barrel, no node: import)
export const SCAN_SLOW_MS = 15 * 60_000;
export const POLL_FAST_MS = 5_000;
export const POLL_SLOW_MS = 30_000;
export const POLL_FAST_FOR_MS = 2 * 60_000;
export type RowScan = { kind: "ok" } | { kind: "pending"; slow: boolean } | { kind: "infected" } | { kind: "unscannable" } | { kind: "locked" };
export function rowScan(doc: DocumentView, now: string): RowScan;
export function scanLabel(s: RowScan | ScanState, locale: Locale): { tone: "warn" | "crit"; text: string } | null;
export function nextPollMs(load: DocumentsLoad): number | null;
export function viewerNotice(doc: DocumentView): MessageKey | null;
```

- [ ] **Step 1: Write the failing tests.**

`apps/web/src/lib/documents/scan-state.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { m } from "@/lib/messages";
import type { DocumentView, DocumentsLoad } from "./documents-load";
import { rowScan, scanLabel, nextPollMs, viewerNotice, SCAN_SLOW_MS, POLL_FAST_MS, POLL_SLOW_MS } from "./scan-state";

const NOW = "2026-10-15T15:00:00.000Z";
const ago = (ms: number) => new Date(Date.parse(NOW) - ms).toISOString();
const doc = (scan: DocumentView["version"]["scan"], createdAt = ago(60_000), versions: Partial<DocumentView["versions"][number]>[] = []): DocumentView => ({
  id: "d1", title: "Lease", category: "contract", expiresOn: null, ownersOnly: false, source: "upload",
  addedBy: { you: true, name: null }, createdAt, addedOn: "2026-10-15", deletedAt: null, purging: false,
  version: { id: "v1", contentType: "application/pdf", bytes: 10, scan, createdAt },
  versions: [{ id: "v1", contentType: "application/pdf", bytes: 10, createdAt, addedOn: "2026-10-15", scan }, ...versions.map((v, i) => ({
    id: `v${i + 2}`, contentType: "application/pdf" as const, bytes: 10, createdAt, addedOn: "2026-10-15", scan: "clean" as const, ...v }))],
});
const load = (live: DocumentView[]): DocumentsLoad => ({ status: "ready", data: { today: "2026-10-15", now: NOW, record: { kind: "contact", id: "c1" }, live, trashed: [], capped: false, space: null } });

describe("a row's scan state (spec 3.5)", () => {
  it("clean is an ordinary row; pending is Checking, slow past 15 minutes; infected and unscannable are their own (mutation: SCAN_SLOW_MS 10 minutes -> FAILS)", () => {
    expect(rowScan(doc("clean"), NOW)).toEqual({ kind: "ok" });
    expect(rowScan(doc("pending", ago(SCAN_SLOW_MS - 1000)), NOW)).toEqual({ kind: "pending", slow: false });
    expect(rowScan(doc("pending", ago(SCAN_SLOW_MS + 1000)), NOW)).toEqual({ kind: "pending", slow: true });
    expect(rowScan(doc("infected"), NOW)).toEqual({ kind: "infected" });
    expect(rowScan(doc("unscannable"), NOW)).toEqual({ kind: "unscannable" });
    expect(SCAN_SLOW_MS).toBe(15 * 60_000);
  });

  it("its words and tone in both languages, rule 3 (mutations: one tone for every state -> FAILS; drop the slow words -> FAILS)", () => {
    expect(scanLabel({ kind: "ok" }, "en")).toBeNull();
    expect(scanLabel({ kind: "pending", slow: false }, "es")).toEqual({ tone: "warn", text: m["documents.status.scanning.es"] });
    expect(scanLabel({ kind: "pending", slow: true }, "es")).toEqual({ tone: "warn", text: `${m["documents.status.scanning.es"]} · ${m["documents.status.scanSlow.es"]}` });
    expect(scanLabel({ kind: "infected" }, "es")).toEqual({ tone: "crit", text: m["documents.status.virusRemoved.es"] });
    expect(scanLabel("unscannable", "en")).toEqual({ tone: "crit", text: m["documents.status.unscannable"] });
    expect(scanLabel("clean", "es")).toBeNull();
  });

  it("the viewer's notice: none for a clean file, one per other state (mutation: a notice for clean -> FAILS)", () => {
    expect([viewerNotice(doc("clean")), viewerNotice(doc("pending")), viewerNotice(doc("infected")), viewerNotice(doc("unscannable"))])
      .toEqual([null, "documents.viewer.scanning", "documents.viewer.virusRemoved", "documents.viewer.unscannable"]);
  });
});

describe("the card's re-read while a file is Checking (spec 3.4: 'Revisando' -> the ordinary row)", () => {
  it("every 5 s while the youngest Checking version is under two minutes old, then every 30 s, and never when nothing is Checking, a NEWER pending version included (mutations: look only at doc.version -> the pending newer version FAILS; poll forever -> FAILS)", () => {
    expect(nextPollMs(load([doc("clean")]))).toBeNull();
    expect(nextPollMs(load([doc("pending", ago(30_000))]))).toBe(POLL_FAST_MS);
    expect(nextPollMs(load([doc("pending", ago(10 * 60_000))]))).toBe(POLL_SLOW_MS);
    expect(nextPollMs(load([doc("clean", ago(60_000), [{ scan: "pending", createdAt: ago(20_000) }])]))).toBe(POLL_FAST_MS);
    expect(nextPollMs({ status: "loading" })).toBeNull();
  });
});
```

  `documents-load.test.ts`: its `view` fixture's `version` gains `scan: "clean", createdAt: <its first version's createdAt>` and each `versions` entry gains `scan: "clean"`. Add two rows to its refusal table (`:30-37`): `["a version with an unknown scan state", res({ ...body, live: [{ ...view, versions: [{ ...view.versions[0], scan: "quarantined" }, view.versions[1]] }] })]` and `["a shown version with no scan state", res({ ...body, live: [{ ...view, version: { ...view.version, scan: undefined } }] })]`. (Mutation: drop `isScan` from either check → its row parses → FAILS.)

  Each route test's document fixture gains `scan_status` on its `version` and `versions` rows; add one case to the contact route test (`…/api/contacts/[contactId]/documents/route.test.ts`):

```ts
  it("shows the newest CLEAN version while a newer one is still Checking, and lists both with their states (plan deviation 1; mutation: show d.version, the newest ready -> FAILS)", async () => {
    const v2 = { id: "v1", document_id: "d1", account_id: ACC, storage_path: "p", bytes: 1200, content_type: "image/jpeg", original_name: "x.jpg", status: "ready", created_at: "2026-10-01T00:00:00Z", scan_status: "pending" };
    const v1 = { id: "v0", document_id: "d1", account_id: ACC, storage_path: "q", bytes: 800, content_type: "application/pdf", original_name: "x.pdf", status: "ready", created_at: "2026-09-20T15:00:00Z", scan_status: "clean" };
    db.listRecordDocuments.mockResolvedValue({ live: [row({ version: v2, versions: [v2, v1] })], trashed: [], liveMore: false, trashedMore: false });
    const body = await (await call()).json();
    expect(body.live[0].version).toEqual({ id: "v0", contentType: "application/pdf", bytes: 800, scan: "clean", createdAt: "2026-09-20T15:00:00Z" });
    expect(body.live[0].versions.map((v: { id: string; scan: string }) => [v.id, v.scan])).toEqual([["v1", "pending"], ["v0", "clean"]]);
  });
```

  (`row(over)` is the file's own builder, `route.test.ts:21-31`; its default `version` and `versions` rows gain `scan_status: "clean"` in this task, so every existing case keeps reading a clean file.)

  **Owner ruling 2026-10-15 (password-protected files): a fifth VIEW state, `"locked"`** (already in this task's code blocks; the tests below pin it). The database keeps four states; the card's view adds `"locked"` = unscannable BECAUSE of a password, derived once in `documentView` with `removedReason` (Task 3 Step 4b), and the signature never reaches the JSON. So: `ScanState` in `documents-load.ts` is `"pending" | "clean" | "infected" | "unscannable" | "locked"` and `isScan` accepts `"locked"`; `documentView` maps each version with

```ts
const viewScan = (v: { scan_status: ScanStatus; scan_signature: string | null }): ScanState =>
  removedReason(v.scan_status, v.scan_signature) === "password" ? "locked" : v.scan_status;
```

  (for `version.scan` and every `versions[].scan`); `scan-state.ts`'s `RowScan` gains `{ kind: "locked" }` (`rowScan` returns `{ kind: v.scan }` for it as for the other removed states), `WORD.locked = "documents.status.passwordRemoved"` (tone crit), and `viewerNotice` answers `"documents.viewer.passwordRemoved"` for it. Tests, each red if the reason collapses into the generic note:

```ts
// scan-state.test.ts
describe("a password-protected file says why (owner ruling 2026-10-15)", () => {
  it("removedReason: a password only from Heuristics.Encrypted.*, the generic cause otherwise (mutation: every unscannable is 'password' -> FAILS; none is -> FAILS)", () => {
    expect([removedReason("infected", "Eicar-Test-Signature"), removedReason("unscannable", "Heuristics.Encrypted.PDF"), removedReason("unscannable", "Heuristics.Encrypted.Zip"),
      removedReason("unscannable", "Heuristics.Limits.Exceeded.MaxFileSize"), removedReason("unscannable", null), removedReason("clean", null), removedReason("pending", null)])
      .toEqual(["virus", "password", "password", "unscannable", "unscannable", null, null]);
  });
  it("the row and the viewer name the password in both languages, never the generic words (mutation: WORD.locked = the unscannable key -> FAILS)", () => {
    for (const [locale, sfx] of [["en", ""], ["es", ".es"]] as const) {
      expect(scanLabel({ kind: "locked" }, locale)).toEqual({ tone: "crit", text: m[`documents.status.passwordRemoved${sfx}` as keyof typeof m] });
      expect(scanLabel({ kind: "locked" }, locale)!.text).not.toBe(m[`documents.status.unscannable${sfx}` as keyof typeof m]);
    }
    expect(viewerNotice(doc("locked"))).toBe("documents.viewer.passwordRemoved");
    expect(viewerNotice(doc("unscannable"))).toBe("documents.viewer.unscannable");
  });
});
```

```ts
// …/api/contacts/[contactId]/documents/route.test.ts
  it("a password-protected file reads 'locked', a limit 'unscannable', and clamd's name never reaches the JSON (owner ruling 2026-10-15; mutation: send scan_status through unmapped -> FAILS; send the signature -> FAILS)", async () => {
    const locked = { id: "v1", document_id: "d1", account_id: ACC, storage_path: "p", bytes: 1200, content_type: "application/pdf", original_name: "x.pdf", status: "ready", created_at: "2026-10-01T00:00:00Z", scan_status: "unscannable", scan_signature: "Heuristics.Encrypted.PDF" };
    const limit = { ...locked, id: "v9", scan_signature: "Heuristics.Limits.Exceeded.MaxFileSize" };
    db.listRecordDocuments.mockResolvedValue({ live: [row({ version: locked, versions: [locked] }), row({ id: "d2", version: limit, versions: [limit] })], trashed: [], liveMore: false, trashedMore: false });
    const res = await call();
    const text = await res.text();
    expect(text).not.toContain("Heuristics");
    const body = JSON.parse(text) as { live: { version: { scan: string } }[] };
    expect(body.live.map((d) => d.version.scan)).toEqual(["locked", "unscannable"]);
  });
```

  (`documents-load.test.ts`'s refusal table keeps refusing an unknown state; add one row proving `"locked"` PARSES: a body whose `version.scan` and `versions[0].scan` are `"locked"` loads `status: "ready"`. Every `DocumentVersionRow` fixture in this task's files gains `scan_signature: null`.)

- [ ] **Step 2: Run red.** `pnpm --filter web exec vitest run src/lib/documents "src/app/api/accounts/[accountId]/contacts/[contactId]/documents" "src/app/api/accounts/[accountId]/groups/[groupId]/documents"` → the new cases fail.

- [ ] **Step 3: Implement.**

  `documents-load.ts`: add after the imports

```ts
export type ScanState = "pending" | "clean" | "infected" | "unscannable" | "locked";
const isScan = (v: unknown): v is ScanState => v === "pending" || v === "clean" || v === "infected" || v === "unscannable" || v === "locked";
```

  `DocumentVersionView` gains `scan: ScanState`; `DocumentView.version` becomes `{ id: string; contentType: DocumentContentType; bytes: number; scan: ScanState; createdAt: string }` with the comment `/** The newest CLEAN ready version; when none is clean, the newest ready version with its state (S-07 2a, plan deviation 1). */`. `isVersionView` gains `&& isScan(v.scan)`; `isView` gains `&& isScan(v.version.scan) && instant(v.version.createdAt)`.

  `document-view.ts` `documentView` (imports: `removedReason` from `@bis/db/document-rules`, `type ScanStatus` from `@bis/db`, `type ScanState` from `./documents-load`):

```ts
/** Owner ruling 2026-10-15: unscannable BECAUSE of a password is its own view state; clamd's name never reaches the JSON. */
const viewScan = (v: { scan_status: ScanStatus; scan_signature: string | null }): ScanState =>
  removedReason(v.scan_status, v.scan_signature) === "password" ? "locked" : v.scan_status;

export function documentView(d: ListedDocument, viewerId: string, names: Readonly<Record<string, string>>, zone: string): DocumentView {
  const you = d.created_by === viewerId;
  // S-07 2a (plan deviation 1): what opens is the newest CLEAN version (d.versions is newest first);
  // with none clean, the row describes the newest ready version and its state.
  const shown = d.versions.find((v) => v.scan_status === "clean") ?? d.version;
  return {
    id: d.id, title: d.title, category: d.category, expiresOn: d.expires_on, ownersOnly: d.owners_only, source: d.source,
    addedBy: { you, name: you ? null : (Object.hasOwn(names, d.created_by) ? names[d.created_by]! : null) },
    createdAt: d.created_at, addedOn: dayKeyInZone(new Date(d.created_at), zone), deletedAt: d.deleted_at,
    version: { id: shown.id, contentType: shown.content_type, bytes: shown.bytes, scan: viewScan(shown), createdAt: shown.created_at },
    purging: d.deleted_at !== null && d.deleted_by === DOCUMENT_PURGING_MARK,
    versions: d.versions.map((v) => ({
      id: v.id, contentType: v.content_type, bytes: v.bytes, createdAt: v.created_at, addedOn: dayKeyInZone(new Date(v.created_at), zone), scan: viewScan(v),
    })),
  };
}
```

  `apps/web/src/lib/documents/scan-state.ts`:

```ts
import type { Locale } from "@/lib/i18n/locale";
import { t } from "@/lib/i18n/t";
import { m, type MessageKey } from "@/lib/messages";
import type { DocumentView, DocumentsLoad, ScanState } from "./documents-load";

/**
 * What the Documents card shows about virus scanning (spec 3.5), as pure functions the card, the
 * viewer and their tests share. Browser-safe. A row's state is its SHOWN version's (documentView:
 * the newest clean one, else the newest ready one), so a pending NEW version never hides a clean
 * older one; the Versions list shows each version's own state.
 */
export const SCAN_SLOW_MS = 15 * 60_000;
export const POLL_FAST_MS = 5_000;
export const POLL_SLOW_MS = 30_000;
export const POLL_FAST_FOR_MS = 2 * 60_000;

export type RowScan = { kind: "ok" } | { kind: "pending"; slow: boolean } | { kind: "infected" } | { kind: "unscannable" } | { kind: "locked" };

/** `now` is the read's own server instant (DocumentsResponse.now), never the browser's clock. Deviation 6: age from the version's reservation. */
export function rowScan(doc: DocumentView, now: string): RowScan {
  const v = doc.version;
  if (v.scan === "clean") return { kind: "ok" };
  if (v.scan === "pending") return { kind: "pending", slow: Date.parse(now) - Date.parse(v.createdAt) > SCAN_SLOW_MS };
  return { kind: v.scan };
}

const WORD: Readonly<Record<ScanState, MessageKey | null>> = {
  clean: null, pending: "documents.status.scanning", infected: "documents.status.virusRemoved", unscannable: "documents.status.unscannable",
  locked: "documents.status.passwordRemoved",
};

/** Rule 3: the dot's tone and the words, in the reader's language; null for a clean file (the ordinary row). */
export function scanLabel(s: RowScan | ScanState, locale: Locale): { tone: "warn" | "crit"; text: string } | null {
  const state: ScanState = typeof s === "string" ? s : s.kind === "ok" ? "clean" : s.kind;
  const key = WORD[state];
  if (!key) return null;
  const slow = typeof s !== "string" && s.kind === "pending" && s.slow;
  const text = slow ? `${t(m, key, locale)} · ${t(m, "documents.status.scanSlow", locale)}` : t(m, key, locale);
  return { tone: state === "pending" ? "warn" : "crit", text };
}

/** Re-read while any live file has a version Checking: fast for its first two minutes, then slow; null when none is. */
export function nextPollMs(load: DocumentsLoad): number | null {
  if (load.status !== "ready") return null;
  const now = Date.parse(load.data.now);
  let youngest = Number.POSITIVE_INFINITY;
  for (const d of load.data.live) {
    for (const v of d.versions) if (v.scan === "pending") youngest = Math.min(youngest, now - Date.parse(v.createdAt));
  }
  if (youngest === Number.POSITIVE_INFINITY) return null;
  return youngest < POLL_FAST_FOR_MS ? POLL_FAST_MS : POLL_SLOW_MS;
}

/** The viewer's sentence for a file that cannot be opened; null when it can. */
export function viewerNotice(doc: DocumentView): MessageKey | null {
  switch (doc.version.scan) {
    case "clean": return null;
    case "pending": return "documents.viewer.scanning";
    case "infected": return "documents.viewer.virusRemoved";
    case "unscannable": return "documents.viewer.unscannable";
    case "locked": return "documents.viewer.passwordRemoved";
  }
}
```

  `SCAN_SLOW_MS` is also the pass's backlog threshold (Task 8 imports it), so the row's "Taking longer than usual" and the health check's "a file has waited" agree.

- [ ] **Step 4: Run green.** Step 2's command → PASS. `pnpm --filter web typecheck` → the only remaining errors are in Task 9's files (the viewer, the card, the handlers, purge-dialog and demo fixtures); list them, do not edit them.

- [ ] **Step 5: Probes, red BY NAME, restored:** (1) `const shown = d.version` → the route case; (2) drop `isScan(v.scan)` → the load table row; (3) `SCAN_SLOW_MS = 10 * 60_000` → the row-state case; (4) `tone: "warn"` for every state → the words case; (5) in `nextPollMs`, read only `d.version.scan` → the newer-pending case.

- [ ] **Step 6: Commit.** `git add -- apps/web/src/lib/documents/scan-state.ts apps/web/src/lib/documents/scan-state.test.ts` then `git commit -m "feat(documents): the card's read carries each version's scan state; the newest clean version is the one that opens (S-07 part 2a)" -- apps/web/src/lib/documents/document-view.ts apps/web/src/lib/documents/documents-load.ts apps/web/src/lib/documents/documents-load.test.ts apps/web/src/lib/documents/scan-state.ts apps/web/src/lib/documents/scan-state.test.ts "apps/web/src/app/api/accounts/[accountId]/contacts/[contactId]/documents/route.test.ts" "apps/web/src/app/api/accounts/[accountId]/groups/[groupId]/documents/route.test.ts"`

---

## Task 8: The retry pass, the heartbeat, ops health, the watch label (bis-automations)

**Review:** opus. **After:** Tasks 3, 5, 7.

**Files**
- Create: `apps/web/src/lib/automations/passes/documents-scan.ts`, `documents-scan.test.ts`
- Modify: `apps/web/src/lib/automations/registry.ts` (`:13`, `:57` and the order comment `:40-42`)
- Modify: `apps/web/src/lib/automations/sentinel.test.ts` (`:263`, `:280`)
- Modify: `apps/web/src/lib/automations/cron-coupling.test.ts` (`:15-16` imports, `:313-335`)
- Modify: `apps/web/src/lib/automations/caps.ts` (the prose at `:116-125` only)
- Modify: `apps/web/src/app/api/cron/reminders/route.test.ts` (the `@bis/db` factory `:15-190`; `EMPTY_DOCUMENTS_SCAN` beside `:314`; the seven exact bodies)
- Modify: `apps/web/src/lib/ops/watch.ts` (`describeKey`, `:84-95`) and `watch.test.ts`
- Modify: `apps/web/src/app/api/ops/health/route.ts` (`:37-50`) and `route.test.ts`

**Interfaces**
- Consumes: `listPendingScans`, `oldestPendingScanAt`, `recordHeartbeat` (`@bis/db`; the last at `packages/db/src/ops.ts:77-94`, never throws); `scannerConfig`, `scannerHealth`, `SCAN_TIMEOUT_MS`, `SCANNER_HEARTBEAT_KEY`, `ScannerHealth` (Task 5); `scanVersion`, `spendScanError`, `ScanTarget` (Task 5); `SCAN_SLOW_MS` (Task 7).
- Produces: `documentsScanPass` (key `documentsScan`), registered directly after `documentsSweepPass`; `DOCUMENT_SCAN_BUDGET_MS = 45_000`; `DOCUMENT_SCAN_BATCH = 50`; `SIGNATURES_MAX_AGE_MS = 3 * 86_400_000`; `scannerProblem(health, oldestPendingAt, now): string | null`. `scannerProblem(health, oldestPendingAt, now, pass?: { failures, verdicts, unreached, breaker })`. Counters: `{ scanned, clean, infected, unscannable, stillPending, unreached, failed, deferred, breaker, notConfigured }`. The breaker (deviations 15, 17; re-review N2a): held errors are spent only when `scannerHealth()` (whose ok now includes the INSTREAM self-test) passes AGAIN after the loop; each version is stamped `tried` (`recordDocumentScan(…, verdict: "tried")`) before its scan (N2b). Worst-case wall clock about 50 s against the declared 45 s, inside the coupling test's headroom (the pass's header comment states the arithmetic; plan review 6). The health route's 503 body may name `"documents.scanner"`.

- [ ] **Step 1: Write the failing tests.**

`apps/web/src/lib/automations/passes/documents-scan.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const listPendingScans = vi.fn();
const oldestPendingScanAt = vi.fn();
const recordHeartbeat = vi.fn();
const recordDocumentScan = vi.fn();
vi.mock("@bis/db", () => ({
  listPendingScans: (...a: unknown[]) => listPendingScans(...a),
  oldestPendingScanAt: (...a: unknown[]) => oldestPendingScanAt(...a),
  recordHeartbeat: (...a: unknown[]) => recordHeartbeat(...a),
  recordDocumentScan: (...a: unknown[]) => recordDocumentScan(...a),
}));
const scannerConfig = vi.fn();
const scannerHealth = vi.fn();
vi.mock("@/lib/documents/scan-client", () => ({
  scannerConfig: () => scannerConfig(), scannerHealth: () => scannerHealth(), SCAN_TIMEOUT_MS: 25_000, SCANNER_HEARTBEAT_KEY: "documents.scanner",
}));
const scanVersion = vi.fn();
const spendScanError = vi.fn();
vi.mock("@/lib/documents/scan-version", () => ({
  scanVersion: (...a: unknown[]) => scanVersion(...a), spendScanError: (...a: unknown[]) => spendScanError(...a),
}));

const { documentsScanPass, scannerProblem, DOCUMENT_SCAN_BUDGET_MS, DOCUMENT_SCAN_BATCH } = await import("./documents-scan");

const NOW = new Date("2026-10-15T15:00:00.000Z");
const DB = { tag: "service" } as never;
const ctx = { db: DB, now: NOW, origin: "https://app.example.com" } as never;
const row = (id: string, attempts = 0) => ({ id, account_id: "acc", document_id: "doc", storage_path: `acc/doc/${id}`, scan_attempts: attempts, created_at: "2026-10-15T14:59:00.000Z" });
const target = (id: string, attempts = 0) => ({ accountId: "acc", versionId: id, storagePath: `acc/doc/${id}`, attempts });
const FRESH = new Date(NOW.getTime() - 3_600_000).toISOString();
const ZERO = { scanned: 0, clean: 0, infected: 0, unscannable: 0, stillPending: 0, unreached: 0, failed: 0, deferred: 0, breaker: 0, notConfigured: 0 };

beforeEach(() => {
  for (const f of [listPendingScans, oldestPendingScanAt, recordHeartbeat, recordDocumentScan, scannerConfig, scannerHealth, scanVersion, spendScanError]) f.mockReset();
  recordDocumentScan.mockResolvedValue({ status: "ok", attempts: 0 });
  scannerConfig.mockReturnValue({ origin: "https://s", secret: "x" });
  scannerHealth.mockResolvedValue({ ok: true, signaturesAt: FRESH });
  oldestPendingScanAt.mockResolvedValue(null);
  listPendingScans.mockResolvedValue([]);
  spendScanError.mockResolvedValue("pending");
});
afterEach(() => vi.restoreAllMocks());

describe("documentsScan, the retry pass (spec 3.4)", () => {
  it("not configured: no read, one failing heartbeat, its own counter (mutation: list anyway -> FAILS)", async () => {
    scannerConfig.mockReturnValue(null);
    expect(await documentsScanPass.run(ctx)).toEqual({ ...ZERO, notConfigured: 1 });
    expect(listPendingScans).not.toHaveBeenCalled();
    expect(recordHeartbeat).toHaveBeenCalledWith(DB, "documents.scanner", { ok: false, error: "not configured (SCANNER_URL or SCANNER_SECRET unset)" });
  });

  it("scans every pending version oldest first with its own attempts, HOLDING clamd errors, counts each outcome, and beats ok (mutations: pass attempts 0 -> FAILS; scan without holdErrors -> FAILS)", async () => {
    listPendingScans.mockResolvedValue([row("a"), row("b", 2), row("c")]);
    scanVersion.mockResolvedValueOnce("clean").mockResolvedValueOnce("unscannable").mockResolvedValueOnce("infected");
    expect(await documentsScanPass.run(ctx)).toEqual({ ...ZERO, scanned: 3, clean: 1, unscannable: 1, infected: 1 });
    expect(listPendingScans).toHaveBeenCalledWith(DB, DOCUMENT_SCAN_BATCH);
    expect(scanVersion.mock.calls.map((c) => [c[1], c[3]])).toEqual([
      [target("a"), { holdErrors: true }], [target("b", 2), { holdErrors: true }], [target("c"), { holdErrors: true }]]);
    expect(recordHeartbeat).toHaveBeenCalledWith(DB, "documents.scanner", { ok: true });
  });

  it("stamps each version TRIED before scanning it, so a version that always times out goes to the back of the line (re-review N2b; mutation: stamp after the scan -> the order FAILS)", async () => {
    listPendingScans.mockResolvedValue([row("a"), row("b")]);
    scanVersion.mockResolvedValue("clean");
    await documentsScanPass.run(ctx);
    expect(recordDocumentScan.mock.calls.map((c) => [c[1].versionId, c[1].verdict])).toEqual([["a", "tried"], ["b", "tried"]]);
    expect(recordDocumentScan.mock.invocationCallOrder[0]!).toBeLessThan(scanVersion.mock.invocationCallOrder[0]!);
    expect(recordDocumentScan.mock.invocationCallOrder[1]!).toBeLessThan(scanVersion.mock.invocationCallOrder[1]!);
  });

  it("a version another scan finished first (its stamp answers stale) is skipped, not scanned (mutation: scan anyway -> FAILS)", async () => {
    listPendingScans.mockResolvedValue([row("a")]);
    recordDocumentScan.mockResolvedValueOnce({ status: "stale" });
    await documentsScanPass.run(ctx);
    expect(scanVersion).not.toHaveBeenCalled();
  });

  it("ONE pending file, ONE held error, and the self-test passes again after the loop: the error is spent (re-review N2a; mutation: never spend -> FAILS)", async () => {
    listPendingScans.mockResolvedValue([row("b", 1)]);
    scanVersion.mockResolvedValueOnce("held");
    expect(await documentsScanPass.run(ctx)).toEqual({ ...ZERO, scanned: 1, stillPending: 1 });
    expect(spendScanError).toHaveBeenCalledWith(DB, target("b", 1));
    expect(scannerHealth).toHaveBeenCalledTimes(2);
  });

  it("THE BREAKER with ONE pending file: the worker fails its self-test after the loop, so the held error is NOT spent and the heartbeat is red (re-review N2a; mutations: spend without the second self-test -> FAILS; the old count rule never trips on one file -> FAILS)", async () => {
    listPendingScans.mockResolvedValue([row("a", 2)]);
    scanVersion.mockResolvedValueOnce("held");
    scannerHealth.mockResolvedValueOnce({ ok: true, signaturesAt: FRESH }).mockResolvedValueOnce({ ok: false, reason: "self_test_failed" });
    expect(await documentsScanPass.run(ctx)).toEqual({ ...ZERO, scanned: 1, breaker: 1 });
    expect(spendScanError).not.toHaveBeenCalled();
    expect(recordHeartbeat).toHaveBeenCalledWith(DB, "documents.scanner", { ok: false, error: "the self-test failed after 1 file error; none were counted" });
  });

  it("a self-test that fails at the START scans nothing at all (mutation: scan when health is not ok -> FAILS)", async () => {
    scannerHealth.mockResolvedValue({ ok: false, reason: "self_test_failed" });
    listPendingScans.mockResolvedValue([row("a")]);
    expect(await documentsScanPass.run(ctx)).toEqual(ZERO);
    expect(scanVersion).not.toHaveBeenCalled();
    expect(recordHeartbeat).toHaveBeenCalledWith(DB, "documents.scanner", { ok: false, error: "worker self test failed" });
  });

  it("a misconfigured binding (every scan a 403: 'unreached') spends nothing and is named even for one file (plan review C1; mutation: count unreached as a verdict -> FAILS)", async () => {
    listPendingScans.mockResolvedValue([row("a", 2)]);
    scanVersion.mockResolvedValueOnce("unreached");
    expect(await documentsScanPass.run(ctx)).toEqual({ ...ZERO, scanned: 1, unreached: 1 });
    expect(spendScanError).not.toHaveBeenCalled();
    expect(recordHeartbeat).toHaveBeenCalledWith(DB, "documents.scanner", { ok: false, error: "1 file could not be reached" });
  });

  it("a worker that is down scans NOTHING, so an outage never spends a file's attempts (plan deviation 7; mutation: scan anyway -> FAILS)", async () => {
    scannerHealth.mockResolvedValue({ ok: false, reason: "unreachable" });
    listPendingScans.mockResolvedValue([row("a")]);
    expect(await documentsScanPass.run(ctx)).toEqual(ZERO);
    expect(scanVersion).not.toHaveBeenCalled();
    expect(recordHeartbeat).toHaveBeenCalledWith(DB, "documents.scanner", { ok: false, error: "worker unreachable" });
  });

  it("one version that throws is counted, the others still scan, the heartbeat is written, then the pass throws (mutation: stop at the first throw -> FAILS)", async () => {
    listPendingScans.mockResolvedValue([row("a"), row("b")]);
    scanVersion.mockRejectedValueOnce(new Error("storage down")).mockResolvedValueOnce("clean");
    await expect(documentsScanPass.run(ctx)).rejects.toThrow(/"failed":1/);
    expect(scanVersion).toHaveBeenCalledTimes(2);
    expect(recordHeartbeat).toHaveBeenCalledTimes(1);
  });

  it("stops STARTING scans once one more could overrun its 45-second budget; the rest wait for the next tick (mutation: drop the budget check -> FAILS)", async () => {
    listPendingScans.mockResolvedValue([row("a"), row("b"), row("c")]);
    let clock = 1_000_000;
    vi.spyOn(Date, "now").mockImplementation(() => clock);
    scanVersion.mockImplementation(async () => { clock += DOCUMENT_SCAN_BUDGET_MS - 25_000 + 1; return "clean"; });
    expect(await documentsScanPass.run(ctx)).toMatchObject({ scanned: 1, deferred: 2 });
  });
});

describe("scannerProblem: the heartbeat's words (spec 3.4; BIS staff read them in the ops email)", () => {
  it("names a stale signature set past 3 days and a file waiting past 15 minutes; nothing when healthy (mutations: 4 days -> FAILS; 10 minutes -> FAILS)", () => {
    const ok = { ok: true as const, signaturesAt: FRESH };
    expect(scannerProblem(ok, null, NOW)).toBeNull();
    expect(scannerProblem(ok, new Date(NOW.getTime() - 14 * 60_000).toISOString(), NOW)).toBeNull();
    expect(scannerProblem(ok, new Date(NOW.getTime() - 16 * 60_000).toISOString(), NOW)).toBe("a file has waited 16 minutes");
    expect(scannerProblem({ ok: true, signaturesAt: new Date(NOW.getTime() - 73 * 3_600_000).toISOString() }, null, NOW)).toBe("signatures 73 hours old");
    expect(scannerProblem({ ok: true, signaturesAt: new Date(NOW.getTime() - 71 * 3_600_000).toISOString() }, null, NOW)).toBeNull();
    expect(scannerProblem({ ok: false, reason: "clamd_down" }, new Date(NOW.getTime() - 20 * 60_000).toISOString(), NOW)).toBe("worker clamd down; a file has waited 20 minutes");
  });
});
```

  `cron-coupling.test.ts`: import `DOCUMENT_SCAN_BUDGET_MS` from `./passes/documents-scan`; the sum at `:333` becomes `RELEASE_BUDGET_MS + USAGE_REPORT_BUDGET_MS + WEEKLY_REPORT_BUDGET_MS + DOCUMENT_SCAN_BUDGET_MS`; its title says "the four wall-clock budgets"; its comment adds "and, since S-07 2a, the document scan pass (DOCUMENT_SCAN_BUDGET_MS, 45 s): 285 s of 300". (Mutation: `DOCUMENT_SCAN_BUDGET_MS = 61_000` → FAILS.) `apps/web/src/lib/automations/caps.ts:116-125`'s prose counts "THREE passes" and "180 s": change it to "THREE passes carry a 60 s budget and, since S-07 2a, the document scan pass a 45 s one (passes/documents-scan.ts)" and "225 s against the route's 300 s `maxDuration`" (prose only; no constant in caps.ts changes).

  `sentinel.test.ts:280`: insert `"documentsScan"` after `"documentsSweep"`; after `:263` add `expect(results.documentsScan).toEqual({ scanned: 0, clean: 0, infected: 0, unscannable: 0, stillPending: 0, unreached: 0, failed: 0, deferred: 0, breaker: 0, notConfigured: 1 });` (the suite sets no `SCANNER_URL`). If the sentinel's `@bis/db` mock lacks `recordHeartbeat`, add `recordHeartbeat: async () => undefined`.

  `route.test.ts` (cron): beside `:314`, `const EMPTY_DOCUMENTS_SCAN = { scanned: 0, clean: 0, infected: 0, unscannable: 0, stillPending: 0, unreached: 0, failed: 0, deferred: 0, breaker: 0, notConfigured: 1 };`; in every exact body, `documentsSweep: EMPTY_DOCUMENTS_SWEEP, documentsScan: EMPTY_DOCUMENTS_SCAN,`.   (`apps/web/vitest.config.ts` pins `SCANNER_URL` and `SCANNER_SECRET` blank, Task 10 step 2b, so a developer's shell cannot change these bodies.) The factory already has `recordHeartbeat` (`:184`).

  `watch.test.ts`: add

```ts
  it("names the scanner's heartbeat in plain words and alerts on its first failure, like a webhook (S-07 2a; mutation: drop the describeKey case -> the raw key reaches the email -> FAILS)", () => {
    expect(describeKey("documents.scanner")).toBe("virus scanning of uploaded files");
    // The email names it in plain words, not the raw key (plan review 12: isFailing alone already held for any non-pass key).
    const at = new Date("2026-10-15T15:00:00Z");
    const mail = composeOpsEmail(evaluate([{ key: "documents.scanner", lastOkAt: new Date(at.getTime() - 60_000), lastErrorAt: at, lastError: "worker unreachable", consecutiveFailures: 1, alertedAt: null }], at));
    expect(mail?.body).toContain("- virus scanning of uploaded files");
    expect(mail?.body).not.toContain("- documents.scanner");
  });
```

  `api/ops/health/route.test.ts`: add

```ts
  it("503 naming documents.scanner when its last error is newer than its last success; a recovered or absent scanner row is healthy (S-07 2a; mutation: ignore the scanner row -> FAILS)", async () => {
    const tickRow = tick(60_000)[0]!;
    const scanner = (okAgo: number | null, errAgo: number | null) => ({ key: "documents.scanner",
      lastOkAt: okAgo === null ? null : new Date(NOW.getTime() - okAgo).toISOString(),
      lastErrorAt: errAgo === null ? null : new Date(NOW.getTime() - errAgo).toISOString(), lastError: "x", consecutiveFailures: 1, alertedAt: null });
    listHeartbeatsMock.mockResolvedValue([tickRow, scanner(10 * 60_000, 60_000)]);
    let res = await GET(req("Bearer health-test-secret"));
    expect([res.status, await res.json()]).toEqual([503, { ok: false, failing: ["documents.scanner"] }]);
    listHeartbeatsMock.mockResolvedValue([tickRow, scanner(60_000, 10 * 60_000)]);
    res = await GET(req("Bearer health-test-secret"));
    expect(res.status).toBe(200);
    listHeartbeatsMock.mockResolvedValue([tickRow, scanner(null, 60_000)]);
    expect((await GET(req("Bearer health-test-secret"))).status).toBe(503);
    listHeartbeatsMock.mockResolvedValue([{ ...tickRow, lastOkAt: new Date(NOW.getTime() - 46 * 60_000).toISOString() }, scanner(10 * 60_000, 60_000)]);
    expect(await (await GET(req("Bearer health-test-secret"))).json()).toEqual({ ok: false, failing: ["cron.tick", "documents.scanner"] });
  });
```

- [ ] **Step 2: Run red.** `pnpm --filter web exec vitest run src/lib/automations src/lib/ops src/app/api/ops src/app/api/cron` → the new and changed cases fail.

- [ ] **Step 3: Implement.**

`apps/web/src/lib/automations/passes/documents-scan.ts`:

```ts
import { listPendingScans, oldestPendingScanAt, recordDocumentScan, recordHeartbeat } from "@bis/db";
import { scannerConfig, scannerHealth, SCAN_TIMEOUT_MS, SCANNER_HEARTBEAT_KEY, type ScannerHealth } from "@/lib/documents/scan-client";
import { scanVersion, spendScanError, type ScanTarget } from "@/lib/documents/scan-version";
import { SCAN_SLOW_MS } from "@/lib/documents/scan-state";
import type { Pass } from "../context";

/**
 * The document vault's virus scan, retried (spec 3.4). Not a recipe; it sends nothing. EVERY tick:
 * if the worker's /health is good, scan the ready versions still pending, oldest first (part 1's files
 * the first time: the catch-up), each through scanVersion (object first on a virus or unreadable
 * content). A down worker scans nothing (plan deviation 7).
 * Each version is stamped `tried` BEFORE it is scanned (re-review N2b), and the read orders never-tried
 * versions first, then the least recently tried: one that always times out can no longer sit at the head
 * and push every run past its 20 s start window.
 * THE BREAKER (re-review N2a, replacing plan review C1's count): countable errors (clamd's own, or an
 * object the app CONFIRMED missing; final check R2) are HELD during the loop and spent, one attempt each (the third
 * removes the file as unscannable, the generic note), ONLY when the worker's self-test passes AGAIN after
 * the loop. A worker-wide fault (out of memory, a broken signature set) fails the self-test, so nothing
 * is spent, even with one pending file. "unreached" (a 403 from a wrong binding, a network failure)
 * never spends.
 * Then ONE heartbeat, documents.scanner (0057): failing while the worker is not configured or
 * unreachable, clamd is down or fails its self-test, its signatures are over 3 days old, the breaker tripped, a pass with no
 * verdict could not reach a file, or a file has been pending over 15 minutes; the alert pass emails
 * on its first failure (lib/ops/watch.ts: not a cron.pass key) and /api/ops/health reports it.
 * A version whose scan threw (an object that would not delete) is counted and the pass THROWS after
 * the heartbeat, so cron.pass.documentsScan fails too.
 * BUDGET: no scan STARTS after 20 s (45 s budget minus one 25 s scan timeout), the health call
 * included. Worst case, measured from the pass's start: the last scan started at 20 s ends by 45 s,
 * then its object delete and verdict, a second self-test (5 s at most) when an error was held, the held
 * errors' verdicts (at most one per scan started), the oldest-pending read and the heartbeat: a few seconds of round trips that no timeout bounds (supabase-
 * js sets none), so about 50 s, not 45. cron-coupling.test.ts asserts the budgets plus 60 s of headroom
 * fit the route's 300 s (60 + 60 + 60 + 45 + 60 = 285): the ~5 s overrun comes out of the 15 s left over
 * and, past that, out of the 60 s the test reserves for the unbudgeted passes. Plan review 6.
 * Every @bis/db export is dereferenced inside run(), never at module scope.
 */
export const DOCUMENT_SCAN_BUDGET_MS = 45_000;
export const DOCUMENT_SCAN_BATCH = 50;
export const SIGNATURES_MAX_AGE_MS = 3 * 86_400_000;

export type PassOutcome = { failures: number; verdicts: number; unreached: number; breaker: boolean };
const QUIET: PassOutcome = { failures: 0, verdicts: 0, unreached: 0, breaker: false };

/** The heartbeat's words: plain English for BIS staff, never a URL, a token or a file name. */
export function scannerProblem(health: ScannerHealth, oldestPendingAt: string | null, now: Date, pass: PassOutcome = QUIET): string | null {
  const problems: string[] = [];
  if (!health.ok) {
    problems.push(health.reason === "not_configured" ? "not configured (SCANNER_URL or SCANNER_SECRET unset)" : `worker ${health.reason.replaceAll("_", " ")}`);
  } else {
    const age = now.getTime() - Date.parse(health.signaturesAt);
    if (age > SIGNATURES_MAX_AGE_MS) problems.push(`signatures ${Math.floor(age / 3_600_000)} hours old`);
  }
  if (pass.breaker) problems.push(`the self-test failed after ${pass.failures} file error${pass.failures === 1 ? "" : "s"}; none were counted`);
  else if (pass.verdicts === 0 && pass.unreached > 0) problems.push(`${pass.unreached} file${pass.unreached === 1 ? "" : "s"} could not be reached`);
  if (oldestPendingAt) {
    const waited = now.getTime() - Date.parse(oldestPendingAt);
    if (waited > SCAN_SLOW_MS) problems.push(`a file has waited ${Math.floor(waited / 60_000)} minutes`);
  }
  return problems.length > 0 ? problems.join("; ") : null;
}

export const documentsScanPass: Pass = {
  key: "documentsScan",
  async run(ctx) {
    const c = { scanned: 0, clean: 0, infected: 0, unscannable: 0, stillPending: 0, unreached: 0, failed: 0, deferred: 0, breaker: 0, notConfigured: 0 };
    if (!scannerConfig()) {
      c.notConfigured = 1;
      await recordHeartbeat(ctx.db, SCANNER_HEARTBEAT_KEY, { ok: false, error: scannerProblem({ ok: false, reason: "not_configured" }, null, ctx.now)! });
      return c;
    }
    const startedAt = Date.now();
    const health = await scannerHealth();
    const held: ScanTarget[] = [];
    if (health.ok) {
      const due = await listPendingScans(ctx.db, DOCUMENT_SCAN_BATCH);
      for (const [i, v] of due.entries()) {
        // Stop STARTING a scan once one more could overrun the budget (release-held.ts's shape).
        if (Date.now() - startedAt > DOCUMENT_SCAN_BUDGET_MS - SCAN_TIMEOUT_MS) { c.deferred = due.length - i; break; }
        c.scanned++;
        const target: ScanTarget = { accountId: v.account_id, versionId: v.id, storagePath: v.storage_path, attempts: v.scan_attempts };
        try {
          // Stamp it tried first (re-review N2b): whatever happens next, it goes to the back of the line.
          if ((await recordDocumentScan(ctx.db, { accountId: v.account_id, versionId: v.id, verdict: "tried" })).status === "stale") continue;
          const r = await scanVersion(ctx.db, target, undefined, { holdErrors: true });
          if (r === "clean") c.clean++;
          else if (r === "infected") c.infected++;
          else if (r === "unscannable") c.unscannable++;
          else if (r === "unreached") c.unreached++;
          else if (r === "held") held.push(target);
        } catch (e) {
          c.failed++;
          console.error(`documents scan: version ${v.id} (account ${v.account_id}): ${String(e)}`);
        }
      }
    }
    const verdicts = c.clean + c.infected + c.unscannable;
    const failures = held.length;
    // Re-review N2a: a held error is spent only if the worker can STILL scan a known-clean buffer now.
    const breaker = held.length > 0 && !(await scannerHealth()).ok;
    if (breaker) {
      c.breaker = 1;
    } else {
      for (const h of held) {
        try {
          const r = await spendScanError(ctx.db, h);
          if (r === "pending") c.stillPending++;
          else if (r === "unscannable") c.unscannable++;
        } catch (e) {
          c.failed++;
          console.error(`documents scan: version ${h.versionId} (account ${h.accountId}): ${String(e)}`);
        }
      }
    }
    const problem = scannerProblem(health, await oldestPendingScanAt(ctx.db), ctx.now, { failures, verdicts, unreached: c.unreached, breaker });
    await recordHeartbeat(ctx.db, SCANNER_HEARTBEAT_KEY, problem ? { ok: false, error: problem } : { ok: true });
    if (c.failed > 0) throw new Error(`documents scan: ${JSON.stringify(c)}`);
    return c;
  },
};
```

  `registry.ts`: import `documentsScanPass` from `./passes/documents-scan`; in `PASSES`, `documentsSweepPass, documentsScanPass,`; in the comment after "The documents sweep (S-07) follows it for the same reason", add "and the document scan (S-07 2a) follows the sweep: it reads and writes only the vault and the documents.scanner heartbeat, which opsWatch (last) reads in the same tick."

  `lib/ops/watch.ts` `describeKey`, before `default`: `case "documents.scanner": return "virus scanning of uploaded files";`.

  `api/ops/health/route.ts`: extend the header comment ("…and, since S-07 2a, whether the document scanner's heartbeat (documents.scanner, written by the documentsScan pass) last failed: a down worker, stale signatures, or a file waiting over 15 minutes; a missing row is healthy, silence is the cron's to report"), import `SCANNER_HEARTBEAT_KEY` from `@/lib/documents/scan-client`, and replace `:37-50`:

```ts
  let tickAt: string | null = null;
  let scannerFailing = false;
  try {
    const rows = await listHeartbeats(serviceDb());
    tickAt = rows.find((r) => r.key === "cron.tick")?.lastOkAt ?? null;
    const scanner = rows.find((r) => r.key === SCANNER_HEARTBEAT_KEY);
    scannerFailing = scanner !== undefined && scanner.lastErrorAt !== null
      && (scanner.lastOkAt === null || Date.parse(scanner.lastErrorAt) > Date.parse(scanner.lastOkAt));
  } catch (e) {
    console.error(`ops health: database read failed: ${String(e)}`);
    return Response.json({ ok: false, failing: ["database"] }, { status: 503 });
  }

  const failing: string[] = [];
  const age = tickAt ? Date.now() - Date.parse(tickAt) : Number.POSITIVE_INFINITY;
  if (!(age < STALE_AFTER_MS)) failing.push("cron.tick");
  if (scannerFailing) failing.push(SCANNER_HEARTBEAT_KEY);
  if (failing.length > 0) return Response.json({ ok: false, failing }, { status: 503 });
  return Response.json({ ok: true });
```

  Add `vi.mock("@/lib/documents/scan-client", () => ({ SCANNER_HEARTBEAT_KEY: "documents.scanner" }))` to the health route test if importing the real module pulls `node:crypto` into a test that should stay light (it is a server test; the real import is fine, prefer it).

- [ ] **Step 4: Run green.** Step 2's command → PASS; the summary block's failed count is 0. `pnpm --filter web typecheck` → clean in this task's files. `grep -c serviceDb apps/web/src/lib/automations/passes/documents-scan.ts` → 0.

- [ ] **Step 5: Probes, red BY NAME, restored:** (1) pass `attempts: 0` → the scan case; (2) scan when `!health.ok` → the outage case; (3) `throw` inside the loop's catch → the one-throws case; (4) drop the budget `if` → the budget case; (4b) spend the held errors without the second self-test → the one-file breaker case (N2a); (4b2) stamp `tried` after the scan → the order case (N2b); (4c) never spend held errors → the spent-after-a-verdict case; (4d) count `unreached` as a verdict → the misconfigured-binding case; (5) `SIGNATURES_MAX_AGE_MS = 4 * 86_400_000` → the words case; (6) remove `documentsScanPass` from `PASSES` → sentinel's order case and the cron bodies; (7) ignore `scannerFailing` in the health route → its new case.

- [ ] **Step 6: Commit.** `git add -- apps/web/src/lib/automations/passes/documents-scan.ts apps/web/src/lib/automations/passes/documents-scan.test.ts` then `git commit -m "feat(automations): the document scan retry pass with its 45 s budget and the documents.scanner heartbeat; ops health and the alert name it (S-07 part 2a)" -- <every file in this task's Files list>`

---

## Task 9: The card and the viewer: states, re-read, Download only when clean; `/styleguide` (bis-frontend)

**Review:** opus. **After:** Tasks 2, 7. The DESIGN.md definition of done in Global Constraints applies line by line; a bis-design-reviewer pass on a running build is part of Task 13.

**Files**
- Modify: `…/contacts/documents-card.tsx` (`rowMenuItems` `:100-108`; `DocumentRow` `:157-238`; `DocumentsCardView`'s row map `:325-330`; `DocumentsCard` `:375-520`) and `documents-card.test.ts`
- Modify: `…/contacts/document-viewer.tsx` (`DocumentViewerBody` `:73-94`; `DocumentVersionsList` `:101-129`; `DocumentViewer` `:131-195`) and `document-viewer.test.ts`
- Modify: `…/contacts/documents-card-handlers.test.ts`, `…/contacts/document-purge-dialog.test.ts` (fixtures only: `version.scan`, `version.createdAt`, `versions[].scan`)
- Modify: `apps/web/src/app/(dashboard)/dashboard/styleguide/documents-demo.tsx` and `documents-demo.test.ts`

**Interfaces**
- Consumes: `rowScan`, `scanLabel`, `nextPollMs`, `viewerNotice` (Task 7); `DocumentView.version.scan`, `.createdAt`, `DocumentVersionView.scan` (Task 7); keys from Task 2.
- Produces: hooks for Task 12: on a row, `[data-document-scan="pending"|"infected"|"unscannable"]` (absent on a clean row); in the viewer, `[data-viewer-notice]`; in the Versions list, `[data-version-scan="<state>"]` on a version that cannot be downloaded.

- [ ] **Step 1: Write the failing tests.**

  Fixtures first, in every file listed (they are red under `tsc` since Task 7): `version` gains `scan: "clean", createdAt: "2026-10-10T15:00:00.000Z"` and each `versions` entry gains `scan: "clean"`. In `documents-card.test.ts` that is `view()` at `:17-23`.

  Append to `documents-card.test.ts`:

```ts
describe("virus scanning on the card (S-07 2a; spec 3.5; rule 3)", () => {
  const pending = (createdAt: string) => view({ id: "dp", title: "Scan", version: { id: "vp", contentType: "application/pdf", bytes: 10, scan: "pending", createdAt },
    versions: [{ id: "vp", contentType: "application/pdf", bytes: 10, createdAt, addedOn: "2026-10-13", scan: "pending" }] });
  const removed = view({ id: "dx", title: "Bad", version: { id: "vx", contentType: "application/pdf", bytes: 10, scan: "infected", createdAt: "2026-10-13T14:00:00.000Z" },
    versions: [{ id: "vx", contentType: "application/pdf", bytes: 10, createdAt: "2026-10-13T14:00:00.000Z", addedOn: "2026-10-13", scan: "infected" }] });

  it("a Checking row is a warn dot AND the word, in Spanish too; after 15 minutes it adds the slow words; a clean row draws neither (mutations: drop the dot -> FAILS; drop the word -> FAILS)", () => {
    const html = render(ready([view(), pending("2026-10-13T14:59:00.000Z"), { ...pending("2026-10-13T14:30:00.000Z"), id: "ds" }]), { locale: "es" });
    const fresh = rowOf(html, "dp");
    expect(fresh).toContain('data-document-scan="pending"');
    expect(fresh).toContain("bg-[var(--warn)]");
    expect(renderedText(fresh)).toContain(m["documents.status.scanning.es"]);
    expect(renderedText(fresh)).not.toContain(m["documents.status.scanSlow.es"]);
    expect(renderedText(rowOf(html, "ds"))).toContain(`${m["documents.status.scanning.es"]} · ${m["documents.status.scanSlow.es"]}`);
    expect(rowOf(html, "d1")).not.toContain("data-document-scan");
  });

  it("a removed row is a crit dot and 'Removed: it had a virus', and its menu keeps Move to trash but has no Download (mutations: crit -> warn -> FAILS; keep Download -> FAILS)", () => {
    const row = rowOf(render(ready([removed]), { locale: "es" }), "dx");
    expect(row).toContain('data-document-scan="infected"');
    expect(row).toContain("bg-[var(--crit)]");
    expect(renderedText(row)).toContain(m["documents.status.virusRemoved.es"]);
    expect(renderedText(rowOf(render(ready([removed])), "dx"))).toContain(m["documents.status.virusRemoved"]);
    expect(rowMenuItems(removed as never, true).map((i) => i.id)).toEqual(["edit", "ownersOnly", "newVersion", "trash"]);
    expect(rowMenuItems(pending("2026-10-13T14:59:00.000Z") as never, false).map((i) => i.id)).toEqual(["edit", "newVersion", "trash"]);
    expect(rowMenuItems(view() as never, false).map((i) => i.id)).toEqual(["edit", "newVersion", "download", "trash"]);
  });

  it("the card still has exactly ONE primary button with Checking and removed rows on it (rule 8; mutation: a primary 'Retry scan' -> FAILS)", () => {
    const html = render(ready([view(), pending("2026-10-13T14:59:00.000Z"), removed]));
    expect(html.match(/data-variant="default"/g) ?? []).toHaveLength(1);
  });
});
```

  Append to `document-viewer.test.ts` (build a `DocumentView` with the file's own `doc()` helper, adding `version.scan`/`createdAt` and `versions[].scan`; the cases below name the fields they set):

```ts
describe("the viewer and virus scanning (S-07 2a; spec 3.3, 3.5)", () => {
  const withScan = (scan: "clean" | "pending" | "infected" | "unscannable") => {
    const d = doc("application/pdf");
    return { ...d, version: { ...d.version, scan, createdAt: "2026-10-13T14:59:00.000Z" }, versions: d.versions.map((v) => ({ ...v, scan })) };
  };
  it("a file that cannot be opened shows its sentence in both languages and never a frame or an image, whatever the state says (mutations: render the iframe for pending -> FAILS; one sentence for every state -> FAILS)", () => {
    const ready = { status: "ready" as const, url: "https://x/sign", contentType: "application/pdf" as const };
    for (const [scan, key] of [["pending", "documents.viewer.scanning"], ["infected", "documents.viewer.virusRemoved"], ["unscannable", "documents.viewer.unscannable"]] as const) {
      const html = renderToStaticMarkup(createElement(DocumentViewerBody, { doc: withScan(scan) as never, state: ready, locale: "es", onRetry: vi.fn(), onImageError: vi.fn() }));
      expect(html).toContain("data-viewer-notice");
      expect(renderedText(html)).toContain(m[`${key}.es` as keyof typeof m]);
      expect(html).not.toContain("<iframe");
      expect(html).not.toContain("<img");
    }
  });
  it("the Versions list: the shown clean version is Current, an older clean one downloads, a newer Checking one shows its dot and word and no button (mutation: offer Download on a pending version -> FAILS)", () => {
    const d = withScan("clean");
    const twoMore = { ...d, versions: [
      { id: "v3", contentType: "application/pdf" as const, bytes: 9, createdAt: "2026-10-13T14:59:00.000Z", addedOn: "2026-10-13", scan: "pending" as const },
      { ...d.versions[0]!, scan: "clean" as const },
      { id: "v0", contentType: "application/pdf" as const, bytes: 8, createdAt: "2026-10-01T10:00:00.000Z", addedOn: "2026-10-01", scan: "clean" as const },
    ] };
    const html = renderToStaticMarkup(createElement(DocumentVersionsList, { doc: twoMore as never, locale: "es", when: () => "hoy", onDownload: vi.fn() }));
    const rowFor = (id: string) => html.slice(html.indexOf(`data-document-version-row="${id}"`), html.indexOf("</li>", html.indexOf(`data-document-version-row="${id}"`)));
    expect(rowFor("v3")).toContain('data-version-scan="pending"');
    expect(renderedText(rowFor("v3"))).toContain(m["documents.status.scanning.es"]);
    expect(rowFor("v3")).not.toContain("<button");
    expect(renderedText(rowFor(d.version.id))).toContain(m["documents.versionCurrent.es"]);
    expect(rowFor("v0")).toContain("<button");
  });
});
```

  **Owner ruling 2026-10-15 (password-protected files):** add to `documents-card.test.ts`'s new describe

```ts
  it("a password-protected file's row says so as a crit dot and the owner's words, in both languages, never 'Couldn't check this file' (mutation: draw the generic word for locked -> FAILS)", () => {
    const locked = view({ id: "dl", title: "Bank", version: { id: "vl", contentType: "application/pdf", bytes: 10, scan: "locked", createdAt: "2026-10-13T14:00:00.000Z" },
      versions: [{ id: "vl", contentType: "application/pdf", bytes: 10, createdAt: "2026-10-13T14:00:00.000Z", addedOn: "2026-10-13", scan: "locked" }] });
    for (const [locale, sfx] of [["en", ""], ["es", ".es"]] as const) {
      const row = rowOf(render(ready([locked]), { locale }), "dl");
      expect(row).toContain('data-document-scan="locked"');
      expect(row).toContain("bg-[var(--crit)]");
      expect(renderedText(row)).toContain(m[`documents.status.passwordRemoved${sfx}` as keyof typeof m]);
      expect(renderedText(row)).not.toContain(m[`documents.status.unscannable${sfx}` as keyof typeof m]);
    }
    expect(rowMenuItems(locked as never, true).map((i) => i.id)).toEqual(["edit", "ownersOnly", "newVersion", "trash"]);
  });
```

  and to `document-viewer.test.ts`'s loop, the pair `["locked", "documents.viewer.passwordRemoved"]` (the viewer's `withScan` type gains `"locked"`). No component change is needed beyond Task 7's types: `ScanStatus` and `VersionScan` draw whatever `scanLabel` answers. The demo adds one locked row beside its removed one.

  `documents-demo.test.ts`: add a case asserting the demo renders one Checking row and one removed row (their words via `renderedText`, both languages if the demo has a Spanish toggle; else English) and still no server action (its existing inert-handler case stays).

- [ ] **Step 2: Run red.** `pnpm --filter web exec vitest run "src/app/(dashboard)/dashboard/accounts/[accountId]/contacts/documents-card.test.ts" "src/app/(dashboard)/dashboard/accounts/[accountId]/contacts/document-viewer.test.ts" "src/app/(dashboard)/dashboard/styleguide/documents-demo.test.ts"` → the new cases fail.

- [ ] **Step 3: Implement.**

  `documents-card.tsx`:

  (a) imports: `import { rowScan, scanLabel, nextPollMs, type RowScan } from "@/lib/documents/scan-state";`.

  (b) `rowMenuItems`: Download only when the shown version is clean (deviation 13):

```ts
export function rowMenuItems(doc: DocumentView, canManage: boolean): RowMenuItem[] {
  const items: RowMenuItem[] = [{ id: "edit", labelKey: "documents.edit" }];
  if (canManage) items.push({ id: "ownersOnly", labelKey: doc.ownersOnly ? "documents.makeTeam" : "documents.makeOwnersOnly" });
  items.push({ id: "newVersion", labelKey: "documents.newVersion" });
  // S-07 2a: a file not yet scanned clean has nothing to download (the server's gate refuses too).
  if (doc.version.scan === "clean") items.push({ id: "download", labelKey: "documents.download" });
  items.push({ id: "trash", labelKey: "documents.trash" });
  return items;
}
```

  (c) a small presentational piece above `DocumentRow`:

```tsx
/** Rule 3: a scan state is a dot AND the words (spec 3.5); a clean row draws nothing. */
function ScanStatus({ scan, locale }: { scan: RowScan; locale: Locale }) {
  const label = scanLabel(scan, locale);
  if (!label || scan.kind === "ok") return null;
  return (
    <span data-document-scan={scan.kind} className="inline-flex items-center gap-1">
      <span aria-hidden="true" className={cn("size-1.5 shrink-0 rounded-full", label.tone === "crit" ? "bg-[var(--crit)]" : "bg-[var(--warn)]")} />
      {label.text}
    </span>
  );
}
```

  (d) `DocumentRow` gains a `now: string` prop and draws `<ScanStatus scan={rowScan(doc, now)} locale={locale} />` right after the category word's `·` separator group (before `sourceLine`), so the state is the second thing read; `DocumentsCardView` passes `now={data.now}`.

  (e) `DocumentsCard`: after `const reload = …` (`:401`):

```tsx
  // Spec 3.4/3.5: while any file is Checking, re-read on a timer, fast for its first two minutes, then
  // slower; the timer's callback bumps the read, never the effect body (react-hooks/set-state-in-effect).
  const pollMs = nextPollMs(load);
  useEffect(() => {
    if (pollMs === null) return;
    const timer = setTimeout(() => setNonce((n) => n + 1), pollMs);
    return () => clearTimeout(timer);
  }, [pollMs, load]);
```

  `document-viewer.tsx`:

  (a) import `viewerNotice, scanLabel` from `@/lib/documents/scan-state`.

  (b) `DocumentViewerBody` begins:

```tsx
  // S-07 2a (spec 3.3): a file not scanned clean is never shown, whatever a stale state says.
  const notice = viewerNotice(doc);
  if (notice) return <p data-viewer-notice className="text-sm text-muted-foreground">{tt(notice)}</p>;
```

  (c) `DocumentVersionsList`'s row end becomes:

```tsx
              {v.id === doc.version.id && v.scan === "clean" ? (
                <span className="text-xs text-muted-foreground">{tt("documents.versionCurrent")}</span>
              ) : v.scan === "clean" ? (
                <Button type="button" variant="ghost" size="sm" className="min-h-11 md:min-h-8"
                  aria-label={tt("documents.downloadVersion", { n })} onClick={() => onDownload(v.id)}>{tt("documents.download")}</Button>
              ) : (
                <VersionScan scan={v.scan} locale={locale} />
              )}
```

  with, above the list:

```tsx
/** A version that cannot be downloaded says why: a dot AND the word (rule 3). */
function VersionScan({ scan, locale }: { scan: DocumentView["versions"][number]["scan"]; locale: Locale }) {
  const label = scanLabel(scan, locale);
  if (!label) return null;
  return (
    <span data-version-scan={scan} className="inline-flex items-center gap-1 text-xs text-muted-foreground">
      <span aria-hidden="true" className={cn("size-1.5 shrink-0 rounded-full", label.tone === "crit" ? "bg-[var(--crit)]" : "bg-[var(--warn)]")} />
      {label.text}
    </span>
  );
}
```

  (import `cn` from `@/lib/utils`).

  (d) `DocumentViewer`: `const scan = doc?.version.scan ?? null;` beside `contentType`; the effect's first line becomes `if (!versionId || !contentType || scan !== "clean" || OFFICE_TYPES.includes(contentType) || !fetchKey) return;` with `scan` added to its dependency list (no URL is ever asked for an unchecked file); the dialog's Download is drawn only when `doc.version.scan === "clean"`:

```tsx
            {doc.version.scan === "clean" ? (
              <div className="flex justify-end">
                <Button type="button" className="min-h-11 md:min-h-8" onClick={() => onDownload(doc)}>{tt("documents.download")}</Button>
              </div>
            ) : null}
```

  `documents-demo.tsx`: add two rows to its demo data: one Checking (`version.scan: "pending"`, `createdAt` a minute before the demo's `now`) titled from an existing demo copy key or a demo-only literal already allowed by the demo's own pattern (read how the demo names its rows; it must stay free of JSX literal copy), and one removed (`scan: "infected"`).

- [ ] **Step 4: Run green.** Step 2's command plus `"src/app/(dashboard)/dashboard/accounts/[accountId]/contacts/documents-card-handlers.test.ts" "src/app/(dashboard)/dashboard/accounts/[accountId]/contacts/document-purge-dialog.test.ts" src/components/ui/material.test.ts src/lib/i18n/ratchet.test.ts` → PASS (the ratchet may fail ONLY on the baseline count until Task 11; say so). `pnpm --filter web typecheck` → clean everywhere now. eslint on every touched file → clean, including `react-hooks/set-state-in-effect`.

- [ ] **Step 5: Probes, red BY NAME, restored:** (1) drop the dot `<span>` in `ScanStatus` → the Checking case; (2) `label.tone === "crit" ? "bg-[var(--warn)]"…` → the removed case; (3) always push Download → the menu assertions; (4) remove the `notice` early return → the viewer case; (5) offer the Download button for every non-current version → the Versions case; (6) make `ScanStatus` a `Button variant="default"` → the one-primary case. The polling effect has no unit test (no DOM); `nextPollMs` is Task 7's, and Task 12's test 3 sees the row change without a reload, which is the effect's proof.

- [ ] **Step 6: Commit.** `git commit -m "feat(documents): Checking and Removed as a dot and a word on the card and in the viewer; nothing unchecked opens or downloads; the card re-reads while a file is Checking (S-07 part 2a)" -- <every file in this task's Files list, quoted>`

---

## Task 10: CI job, Playwright's fake scanner, `.env.example`, the runbook (bis-platform)

**Review:** sonnet. **After:** Task 4.

**Files**
- Modify: `.github/workflows/ci.yml` (one new job, `scanner`, after `e2e`)
- Modify: `apps/web/playwright.config.ts` (the `webServer` entry, `:201-223`)
- Modify: `.env.example` (one block after `OPS_HEALTH_SECRET=`, `:325`)
- Modify: `apps/web/vitest.config.ts` (`test.env`, `:28`)
- Create: `docs/runbooks/scanner.md`

**Interfaces**
- Consumes: `services/scanner/test/fake-clamd.mjs`, `services/scanner/src/server.mjs`, `services/scanner/test/real-clamd.mjs` (Task 4).
- Produces: in every Playwright run, a fake clamd on `127.0.0.1:3399`, the real shim on `127.0.0.1:8399` allowing exactly the run's storage origin, and the app started with `SCANNER_URL=http://127.0.0.1:8399` and `SCANNER_SECRET=bis_e2e_scanner_fixture_only` (a fixed literal, not a secret, like `STRIPE_WEBHOOK_SECRET`'s at `ci.yml:329`).

- [ ] **Step 1: The CI job.** Append to `.github/workflows/ci.yml` under `jobs:` (after the `e2e` job's last step):

```yaml
  # The document vault's scanner (services/scanner; S-07 2a). NOT a required check: the ruleset on
  # main requires verify and e2e only, and this job holds no secret and no Supabase value. What covers
  # it: the orchestrator reads it green on the head SHA before every merge that touches services/
  # (plan Task 14 step 7), and the REQUIRED e2e job runs the same shim (src/) in front of a fake clamd
  # on every push, so a shim that cannot start or sign fails a required check anyway. A red run of THIS
  # job is the real-clamd half (EICAR, limits, memory) and blocks a merge by that reading rule. It runs the
  # shim's own tests against a fake clamd, then builds the real image and proves, against the REAL
  # clamd, that EICAR is infected (raw and inside a DOCX), a clean PDF and a 25 MiB file are clean, and
  # a refused request fetches nothing (services/scanner/test/real-clamd.mjs). The secret below is a
  # fixed literal for this runner only. Memory after the scans is printed for assumption A1.
  scanner:
    runs-on: ubuntu-latest
    timeout-minutes: 20
    steps:
      - uses: actions/checkout@v5
      - uses: actions/setup-node@v5
        with:
          node-version: 24
      - name: The shim's tests (fake clamd)
        run: node --test "services/scanner/test/*.test.mjs"
      - name: Build the scanner image
        run: docker build -t bis-scanner-ci services/scanner
      - name: Start it beside the real clamd
        run: docker run -d --name bis-scanner-ci --network host -e PORT=8080 -e "SCANNER_CLIENTS=ci_scanner_fixture_only@http://127.0.0.1:8098" bis-scanner-ci
      - name: EICAR, a clean PDF and a 25 MiB file against the real clamd
        env:
          SCANNER_URL: http://127.0.0.1:8080
          SCANNER_SECRET: ci_scanner_fixture_only
        run: node services/scanner/test/real-clamd.mjs
      - name: Memory and logs (assumption A1)
        if: always()
        run: |
          docker stats --no-stream bis-scanner-ci || true
          echo "peak memory (cgroup v2 memory.peak, bytes; A1, A15):"
          docker exec bis-scanner-ci sh -c 'cat /sys/fs/cgroup/memory.peak 2>/dev/null || cat /sys/fs/cgroup/memory/memory.max_usage_in_bytes' || true
          docker logs --tail 60 bis-scanner-ci || true
```

  Run `pnpm --filter web exec vitest run ci/ci-workflow.test.ts` (the repo's own pins on `ci.yml`, `apps/web/ci/ci-workflow.test.ts:350-390`: they bind `verify` and `e2e` by name and `arrayContaining` the job list, so a third job must leave them green). If any case fails, STOP and report the case: do not edit that test.

- [ ] **Step 2: Playwright.** In `apps/web/playwright.config.ts`, above `export default defineConfig(`, add:

```ts
/**
 * The document vault's scanner in every e2e run (S-07 2a; plan deviation 5): the REAL shim
 * (services/scanner/src/server.mjs) in front of a FAKE clamd (services/scanner/test/fake-clamd.mjs,
 * EICAR -> FOUND, anything else -> OK). Nothing here is in the app: a Vercel build never contains
 * either process, and the Docker image copies src/ only. The shim allows exactly this run's storage
 * origin (CI: the runner's local stack; a developer: bis-ci), signed by a fixed e2e literal that is
 * not a secret.
 */
const E2E_SCANNER_SECRET = "bis_e2e_scanner_fixture_only";
const FAKE_CLAMD_PORT = 3399;
const SCANNER_PORT = 8399;
const storageOrigin = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? fileEnv.NEXT_PUBLIC_SUPABASE_URL ?? "http://127.0.0.1:54321").origin;
const SCANNER_SERVERS = [
  {
    command: `node ../../services/scanner/test/fake-clamd.mjs ${FAKE_CLAMD_PORT}`,
    port: FAKE_CLAMD_PORT,
    reuseExistingServer: false,
    timeout: 20_000,
  },
  {
    command: "node ../../services/scanner/src/server.mjs",
    url: `http://127.0.0.1:${SCANNER_PORT}/health`,
    // /health is signed: an unsigned GET answers 401, which is "up" enough for the wait.
    ignoreHTTPSErrors: true,
    env: { PORT: String(SCANNER_PORT), CLAMD_HOST: "127.0.0.1", CLAMD_PORT: String(FAKE_CLAMD_PORT), SCANNER_CLIENTS: `${E2E_SCANNER_SECRET}@${storageOrigin}` },
    reuseExistingServer: false,
    timeout: 20_000,
  },
];
```

  and make `webServer` an array: `webServer: [...SCANNER_SERVERS, { …the existing entry…, env: { BIS_I18N_QA: "1", SCANNER_URL: \`http://127.0.0.1:${SCANNER_PORT}\`, SCANNER_SECRET: E2E_SCANNER_SECRET } }]`. **Assumption A8:** Playwright treats any HTTP answer below 404 as up for a `url` entry; a 401 is NOT below 404 on every version. Read `node_modules/playwright/lib/plugins/webServerPlugin.js` (`isURLAvailable`): if a 401 does not count, use `port: SCANNER_PORT` for the shim entry instead of `url` (a TCP wait), and say which in the report. Then `pnpm --filter web exec playwright test --list` → the suite lists with no config error.

- [ ] **Step 2b: Pin the scanner off for the unit suite** (plan review 7), as `APP_ORIGIN` is (`apps/web/vitest.config.ts:18-28`): `env: { APP_ORIGIN: "", SCANNER_URL: "", SCANNER_SECRET: "" }`, and extend the comment above it with one sentence: "SCANNER_URL/SCANNER_SECRET likewise (S-07 2a): a developer's shell holding the real worker's values would otherwise turn the cron route's and the sentinel's not-configured counters into a live scan; `scannerConfig` trims and nulls a blank." Run `pnpm --filter web exec vitest run src/app/api/cron src/lib/automations/sentinel.test.ts` once with `SCANNER_URL=https://x SCANNER_SECRET=y` exported in the shell → still PASS (the pin wins).

- [ ] **Step 3: `.env.example`.** After `OPS_HEALTH_SECRET=` (`:325`), add:

```
# The document vault's virus scanner (S-07 2a; docs/runbooks/scanner.md). Every uploaded file waits
# ("Checking") until the scanner on Fly.io says it is clean; nothing opens unscanned. SCANNER_URL is
# the worker's https origin; SCANNER_SECRET is THIS deployment's own key, one of the worker's
# SCANNER_CLIENTS entries, bound there to this deployment's storage origin. Production and Preview
# hold DIFFERENT values (Preview's is bound to bis-ci). Unset (a developer's machine) uploads stay
# "Checking" and the documents.scanner heartbeat fails; the e2e suite starts its own scanner
# (apps/web/playwright.config.ts) and needs neither value here.
SCANNER_URL=
SCANNER_SECRET=
```

- [ ] **Step 4: The runbook** `docs/runbooks/scanner.md`, these sections, each with its exact commands:
  1. **What it is.** One Fly machine (`iad`, `shared-cpu-1x`, 2 GB, always on): ClamAV + the shim. Holds `SCANNER_CLIENTS` only. Who calls it: Production and Preview (each its own secret, each bound to its own storage origin).
  2. **Create** (once, with the owner's Fly account): `<FLYCTL> auth login`; from `services/scanner/`, `<FLYCTL> launch --no-deploy --copy-config --name <app>` (keep `fly.toml`); `<FLYCTL> config validate`; generate two secrets (`node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`, twice); `<FLYCTL> secrets set SCANNER_CLIENTS="<prodSecret>@https://tlbkbmlrfafquucsmsmm.supabase.co <previewSecret>@https://odnobiodsftffphuuosz.supabase.co"`; `<FLYCTL> deploy`; `<FLYCTL> status`.
  3. **Read its health** without exposing a secret: a one-line `node` snippet that signs `GET /health` with `SCANNER_SECRET` read from the environment (the same canonical string as `services/scanner/src/hmac.mjs`), printing only the JSON answer.
  4. **Vercel:** `SCANNER_URL=https://<app>.fly.dev` in Production and Preview; `SCANNER_SECRET` = prodSecret in Production only, previewSecret in Preview only (`vercel env add`, never both values in one environment).
  5. **Rotate** a caller: add the new entry to `SCANNER_CLIENTS` beside the old, `<FLYCTL> deploy` (or `<FLYCTL> secrets set` restarts it), change the Vercel value, redeploy, then remove the old entry.
  6. **When it is red** (`/api/ops/health` names `documents.scanner`, or the alert email): the heartbeat's words say which (not configured; worker unreachable; clamd down; signatures N hours old; a file has waited N minutes). `<FLYCTL> logs`, `<FLYCTL> machine restart`, `<FLYCTL> ssh console -C "clamdscan --version"`. Files wait meanwhile; nothing opens unscanned.
  7. **Memory** (A1): `<FLYCTL> machine status` / the metrics page after a freshclam reload; if it crosses 1.6 GiB, `<FLYCTL> scale memory 4096` (deviation 12: the owner decides the cost).
  8. **A file that stays "Checking"** (re-review N2c, N3; final check R2). Read why: `select id, account_id, scan_attempts, scan_tried_at, created_at from document_versions where status='ready' and scan_status='pending' order by created_at limit 20` (read-only), beside the heartbeat's words and the shim's per-scan log line (`<FLYCTL> logs`: verdict, stage, ms; never a URL). (a) The heartbeat says "could not be reached" for every file: the wiring (a `SCANNER_CLIENTS` binding, §4) or the network; nothing counts; fix the binding. (b) The self-test fails: the worker; `<FLYCTL> machine restart`, then `<FLYCTL> logs`. (c) ONE version's object is confirmed missing (its log lines say stage `missing`): it counts one attempt per run and is removed as unscannable at the third, by itself. (d) ONE version keeps failing for a transport reason while others scan clean (its log lines say `transport`: it always times out, or storage refuses it with something other than not-found): it never counts, so it stays "Checking" until someone decides. The deliberate end goes through the APP's own verdict path, so `document.unscannable` is emitted exactly as an automatic removal emits it: prefer this app path to raw SQL. Concretely, on the branch or on `main`, run from `apps/web` with that project's service values in the environment for this one command only (production's are in Vercel Production; never write them to a file): `pnpm exec tsx -e "import('@bis/db').then(async (b) => { const db = b.serviceDb(); const v = { accountId: '<account>', versionId: '<version>', storagePath: '<account>/<document>/<version>' }; const { error } = await db.storage.from(b.DOCUMENT_BUCKET).remove([v.storagePath]); if (error) throw error; console.log(await b.recordDocumentScan(db, { accountId: v.accountId, versionId: v.versionId, verdict: 'unscannable', signature: null })); })"` (object first, then the verdict, as the pass does; `recordDocumentScan` emits the event). If production's service key cannot be put in a shell (the rule since 2026-10-07 is that it lives only in Vercel Production), use the fallback and SAY so in the ledger: through MCP `execute_sql`, in ONE statement, so a stale verdict records no event: `with v as (select public.record_document_scan('<account>', '<version>', 'unscannable', null) as r) insert into public.events (account_id, type, actor_type, actor_id, payload) select '<account>', 'document.unscannable', 'system', 'documents-scan', jsonb_build_object('documentId', v.r->>'document_id', 'versionId', '<version>') from v where v.r->>'status' = 'ok' returning id;` (the exact row `emit` writes, `packages/db/src/events.ts:34-36`; no row returned means the version was no longer pending and nothing was written), after removing the object through the storage dashboard. The card then reads "Couldn't check this file". Never mark a version clean by hand.
  9. **Roll back:** the app side reverts with the PR; the machine can be stopped with `<FLYCTL> scale count 0` (files then wait); 0079's rollback is in its header.

- [ ] **Step 5: Commit.** `git add -- docs/runbooks/scanner.md` then `git commit -m "ci(scanner): a job that proves EICAR against the real clamd; e2e runs the shim with a fake clamd; env and runbook (S-07 part 2a)" -- .github/workflows/ci.yml apps/web/playwright.config.ts apps/web/vitest.config.ts .env.example docs/runbooks/scanner.md`

---

## Task 11: Regenerate the i18n baselines (bis-crm)

**Review:** sonnet. **After:** Tasks 2, 3b, 6, 7 and 9 committed.

- [ ] **Step 1.** `pnpm --filter web exec tsx scripts/generate-i18n-baseline.ts` (the one command, `lib/i18n/ratchet.test.ts:1-9`).
- [ ] **Step 2.** `git diff --stat -- apps/web/src/lib/i18n/` shows only the two baseline files. In `ratchet-baseline.json`, no file's count rises and no NEW file appears with a nonzero count (`scan-state.ts` builds its words through `t()`; the card and viewer add no JSX literal copy); if one does, STOP and send it back to its task's owner rather than baselining it.
- [ ] **Step 3.** `pnpm --filter web exec vitest run src/lib/i18n src/lib/messages.test.ts` → PASS.
- [ ] **Step 4. Commit.** `git commit -m "chore(i18n): baselines after the document vault's scanning copy (S-07 part 2a)" -- apps/web/src/lib/i18n/catalogue-baseline.json apps/web/src/lib/i18n/ratchet-baseline.json`

---

## Task 12: The e2e spec (bis-e2e-qa)

**Review:** sonnet. **After:** Tasks 9, 10, 11. **Write only; the orchestrator runs it** (Task 14). Its own file and its own stamped contact, so `documents.spec.ts`'s and `documents-versions.spec.ts`'s counts are untouched.

**Files**
- Create: `apps/web/e2e/documents-scan.spec.ts`

**Interfaces**
- Consumes: the per-run fixture account (`readClientFixture()`, `e2e/support.ts:103-111`); `recordPage` (`support.ts:132-134`); the card's hooks `[data-record-card="documents"] [data-documents-card]`, `[data-document-row]`, `[data-documents-panel]`, and this PR's `[data-document-scan]`, `[data-viewer-notice]`, `[data-timeline-item="documentRemoved"]`; keys from Task 2; the scanner Playwright starts (Task 10).

- [ ] **Step 1: Write `apps/web/e2e/documents-scan.spec.ts`:**

```ts
import { test, expect, type Page } from "./fixtures/test";
import { config as loadEnv } from "dotenv";
import { serviceDb, createContact, DOCUMENT_BUCKET } from "@bis/db";
import { m } from "../src/lib/messages";
import { readClientFixture, recordPage } from "./support";

loadEnv({ path: "apps/web/.env.local" });
loadEnv({ path: ".env.local" });

/**
 * The document vault, PR 2a (spec 7's e2e line): every file waits until clean, end to end, through
 * the REAL shim and a fake clamd that Playwright starts (playwright.config.ts; plan deviation 5).
 * ON THE PER-RUN FIXTURE ACCOUNT ONLY, on one contact made here with a stamped last name; never Test
 * Client One. afterAll removes every object and row this file made, checking each error, and re-reads.
 * SERIAL: test 1's clean file is test 3's.
 */
test.describe.configure({ mode: "serial", timeout: 90_000 });

const STAMP = `DocsScan${Date.now()}`;
const ACTOR = "e2e-documents-scan";
let accountId = "";
let contactId = "";
const db = () => serviceDb();

// The EICAR test string, joined here from two halves so no file carries it whole (Global Constraints).
const EICAR = ["X5O!P%@AP[4\\PZX54(P^)7CC)7}$", "EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*"].join("");
const pdf = (marker: string) => Buffer.from(
  `%PDF-1.4\n% ${marker}\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj 2 0 obj<</Type/Pages/Kids[]/Count 0>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n`, "binary");

const card = (page: Page) => recordPage(page).locator('[data-record-card="documents"] [data-documents-card]');
const rowByTitle = (page: Page, title: string) => card(page).locator("[data-document-row]").filter({ hasText: title });
const contactUrl = () => `/dashboard/accounts/${accountId}/contacts/${contactId}`;

async function open(page: Page) {
  await page.goto(contactUrl());
  await expect(card(page).getByText(/^\d+ files?$/)).toBeVisible();
}
async function upload(page: Page, name: string, buffer: Buffer) {
  await card(page).locator('input[type="file"][multiple]').setInputFiles([{ name, mimeType: "application/pdf", buffer }]);
  await card(page).locator("[data-documents-panel]").getByRole("button", { name: m["documents.upload"], exact: true }).click();
}
async function versionOf(title: string): Promise<{ docId: string; id: string; scan_status: string; storage_path: string }> {
  const { data, error } = await db().from("documents").select("id, versions:document_versions!document_versions_document_fkey(id, scan_status, storage_path)")
    .eq("account_id", accountId).eq("contact_id", contactId).eq("title", title);
  if (error) throw new Error(`documents read: ${error.message}`);
  expect(data ?? [], `exactly one stored document titled "${title}"`).toHaveLength(1);
  const d = (data ?? [])[0] as { id: string; versions: { id: string; scan_status: string; storage_path: string }[] };
  expect(d.versions).toHaveLength(1);
  return { docId: d.id, ...d.versions[0]! };
}

test.beforeAll(async () => {
  const fixture = readClientFixture();
  if (!fixture) throw new Error("documents-scan.spec: no per-run fixture account (e2e/.auth/client-fixture.json). Run the full suite.");
  accountId = fixture.accountId;
  const c = await createContact(db(), accountId, { firstName: "Scan", lastName: STAMP }, ACTOR);
  if (c.existing) throw new Error("documents-scan.spec: the stamped contact matched an existing one; refusing to use (or delete) it.");
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
  const { data: left, error: lErr } = await svc.from("documents").select("id").eq("contact_id", contactId);
  if (lErr) throw new Error(`cleanup: re-read: ${lErr.message}`);
  expect(left ?? []).toEqual([]);
  for (const id of ids) {
    const { data: objects, error: listErr } = await svc.storage.from(DOCUMENT_BUCKET).list(`${accountId}/${id}`);
    if (listErr) throw new Error(`cleanup: bucket re-read ${id}: ${listErr.message}`);
    expect(objects ?? [], `no object left under ${accountId}/${id}`).toEqual([]);
  }
});

test("1. a clean upload is scanned at once: an ordinary row, clean in the database, and it opens (mutation: skip the finish's scan -> the row reads Checking -> FAILS)", async ({ page }) => {
  await open(page);
  await upload(page, "Insurance.pdf", pdf("clean"));
  await expect(rowByTitle(page, "Insurance")).toHaveCount(1, { timeout: 30_000 });
  await expect(rowByTitle(page, "Insurance").locator("[data-document-scan]")).toHaveCount(0);
  const v = await versionOf("Insurance");
  expect(v.scan_status).toBe("clean");
  await rowByTitle(page, "Insurance").click({ position: { x: 10, y: 10 } });
  const viewer = page.locator("[data-document-viewer]");
  await expect(viewer.locator("iframe")).toHaveAttribute("src", new RegExp(`/storage/v1/object/sign/documents/${accountId}/${v.docId}/${v.id}\\?`));
  await page.keyboard.press("Escape");
});

test("2. a file with a virus is removed at once: the row says so as a dot and a word, the object is gone, one event with ids only, and a timeline row with the automation mark (mutations: skip the object removal in scanVersion -> the object survives -> FAILS; emit the title -> FAILS)", async ({ page }) => {
  await open(page);
  await upload(page, "Lease.pdf", Buffer.concat([pdf("bad"), Buffer.from(`\n% ${EICAR}\n`)]));
  const row = rowByTitle(page, "Lease");
  await expect(row).toHaveCount(1, { timeout: 30_000 });
  await expect(row.locator('[data-document-scan="infected"]')).toHaveText(m["documents.status.virusRemoved"]);
  const v = await versionOf("Lease");
  expect(v.scan_status).toBe("infected");
  const { data: blob } = await db().storage.from(DOCUMENT_BUCKET).download(v.storage_path);
  expect(blob, "the infected object is gone").toBeNull();
  const { data: events, error } = await db().from("events").select("actor_type, payload").eq("account_id", accountId).eq("type", "document.virus_removed");
  if (error) throw new Error(`events read: ${error.message}`);
  expect((events ?? []).filter((e: { payload: { documentId?: string } }) => e.payload?.documentId === v.docId))
    .toEqual([{ actor_type: "system", payload: { documentId: v.docId, versionId: v.id } }]);
  // The viewer says why and asks for no URL (spec 3.3).
  const signs: string[] = [];
  page.on("request", (r) => { if (r.url().includes("/object/sign/documents/")) signs.push(r.url()); });
  await row.click({ position: { x: 10, y: 10 } });
  await expect(page.locator("[data-document-viewer] [data-viewer-notice]")).toHaveText(m["documents.viewer.virusRemoved"]);
  await page.keyboard.press("Escape");
  expect(signs).toEqual([]);
  // The row menu keeps Move to trash and offers no Download.
  await card(page).getByRole("button", { name: m["documents.menu"].replace("{title}", "Lease"), exact: true }).click();
  await expect(page.getByRole("menuitem", { name: m["documents.download"], exact: true })).toHaveCount(0);
  await expect(page.getByRole("menuitem", { name: m["documents.trash"], exact: true })).toHaveCount(1);
  await page.keyboard.press("Escape");
  // Assumption A10: the removed row reaches the timeline through 0079's view, with the automation mark.
  await page.reload();
  const removed = recordPage(page).locator('[data-timeline-item="documentRemoved"]');
  await expect(removed).toHaveCount(1);
  await expect(removed).toContainText(m["timeline.documentRemoved"].replace("{title}", "Lease"));
  await expect(removed).toContainText(m["provenance.automation"]);
});

test("3. Checking, then 'Taking longer than usual', then the ordinary row WITHOUT a reload (the card re-reads); nothing opens meanwhile (mutation: drop the card's re-read timer -> the row stays Checking -> FAILS)", async ({ page }) => {
  const v = await versionOf("Insurance");
  // Put test 1's clean file back to Checking, as a file the worker has not answered yet.
  const back = await db().from("document_versions").update({ scan_status: "pending", scanned_at: null, scan_attempts: 1 }).eq("id", v.id).select("id");
  if (back.error || (back.data ?? []).length !== 1) throw new Error(`reset to pending: ${back.error?.message ?? "no row"}`);
  await open(page);
  const scan = rowByTitle(page, "Insurance").locator('[data-document-scan="pending"]');
  await expect(scan).toHaveText(m["documents.status.scanning"]);
  await rowByTitle(page, "Insurance").click({ position: { x: 10, y: 10 } });
  await expect(page.locator("[data-document-viewer] [data-viewer-notice]")).toHaveText(m["documents.viewer.scanning"]);
  await page.keyboard.press("Escape");
  // Twenty minutes old: the slow words join (deviation 6: age from the reservation).
  const old = new Date(Date.now() - 20 * 60_000).toISOString();
  const aged = await db().from("document_versions").update({ created_at: old }).eq("id", v.id).select("id");
  if (aged.error) throw new Error(`age: ${aged.error.message}`);
  await page.reload();
  await expect(scan).toHaveText(`${m["documents.status.scanning"]} · ${m["documents.status.scanSlow"]}`);
  // The verdict lands elsewhere (as the retry pass would record it); the open card re-reads by itself.
  const done = await db().rpc("record_document_scan", { p_account_id: accountId, p_version_id: v.id, p_verdict: "clean", p_signature: null });
  if (done.error) throw new Error(`verdict: ${done.error.message}`);
  await expect(rowByTitle(page, "Insurance").locator("[data-document-scan]")).toHaveCount(0, { timeout: 45_000 });
});

test("4. a password-protected file is removed and its row SAYS it has a password, never the generic words (owner ruling 2026-10-15; the fake clamd answers Heuristics.Encrypted.PDF for FAKE-CLAMD-ENCRYPTED; mutation: map locked to the unscannable words -> FAILS)", async ({ page }) => {
  await open(page);
  await upload(page, "Bank.pdf", Buffer.concat([pdf("locked"), Buffer.from("\n% FAKE-CLAMD-ENCRYPTED\n")]));
  const row = rowByTitle(page, "Bank");
  await expect(row).toHaveCount(1, { timeout: 30_000 });
  await expect(row.locator('[data-document-scan="locked"]')).toHaveText(m["documents.status.passwordRemoved"]);
  await expect(row).not.toContainText(m["documents.status.unscannable"]);
  const v = await versionOf("Bank");
  expect(v.scan_status).toBe("unscannable");
  const { data: blob } = await db().storage.from(DOCUMENT_BUCKET).download(v.storage_path);
  expect(blob, "the password-protected object is gone").toBeNull();
  await row.click({ position: { x: 10, y: 10 } });
  await expect(page.locator("[data-document-viewer] [data-viewer-notice]")).toHaveText(m["documents.viewer.passwordRemoved"]);
  await page.keyboard.press("Escape");
});
```

- [ ] **Step 2: Check it loads.** From `<WT>/apps/web`: `pnpm exec playwright test --list e2e/documents-scan.spec.ts` → 4 tests listed under `chromium`, no error. `pnpm exec eslint e2e/documents-scan.spec.ts` → clean. Do NOT run the tests (the orchestrator does, Task 14 step 6).
- [ ] **Step 3: Probes, written, not run.** In the report, beside each test, the mutation that fails it (in its title) and the line that asserts it. Note for test 3: the card polls every 30 s for a version older than two minutes (`POLL_SLOW_MS`), so its last wait is 45 s; if the orchestrator's run shows it near that bound, the fix is a re-read on window focus, not a longer wait.
- [ ] **Step 4: Commit.** `git add -- apps/web/e2e/documents-scan.spec.ts` then `git commit -m "test(e2e): a clean file opens, a virus is removed with its row, event and timeline row, and Checking turns ordinary without a reload, on the fixture account (S-07 part 2a)" -- apps/web/e2e/documents-scan.spec.ts`

---

## Task 13: Whole-branch final review (checkpoint, not an implementer task)

**Reviewer:** opus, fresh context. Runs after Tasks 1–12.

- [ ] **Step 1.** Read the spec end to end and this plan's Deviations, then `git diff 5d74ee58...HEAD` in `<WT>`; walk the coverage table below row by row against the diff.
- [ ] **Step 2.** Web tests by path: every test file Tasks 2, 3b and 5–9 touched, plus `src/lib/i18n/ratchet.test.ts`, `src/lib/messages.test.ts`, `src/components/ui/material.test.ts`, `ci/ci-workflow.test.ts`, `"src/app/(dashboard)/dashboard/accounts/[accountId]/in-account-service-reads.test.ts"`; `pnpm --filter web typecheck`. The shim: `node --test "services/scanner/test/*.test.mjs"`. The db suites on a replica of your own (the kit, ports `55571`/`55572`/`55573`): `document-scan.test.ts`, `document-vault-schema.test.ts`, `document-vault-rls.test.ts`, `document-space-used.test.ts`, `schema-grants-guard.test.ts` on `post`, and `documents.test.ts`, `record.test.ts`, `timeline-merge.test.ts`, `contacts.test.ts` behind PostgREST. Re-run two probes of your own choosing, by name. A bis-design-reviewer pass on a running build (both themes, the blur fallback, a Checking row, a removed row, the viewer's notice) if the orchestrator provides one.
- [ ] **Step 3.** Hunt specifically: (a) any name matching `\bcreateSignedUrls?\b` (a call, a `createSignedUrls` batch call or a destructured name: the source-scan test's own pattern) outside `packages/db/src/documents.ts`'s two functions, and any path that hands a browser a URL without `signedDocumentReadUrl`; (b) an infected or unscannable verdict recorded BEFORE its object's removal, anywhere; (c) a scan path that can mark a file clean on an error (the client's catch, the shim's parse, the pass's counters); (d) `serviceDb` in any new file under `lib/`, `…/accounts/`, `…/api/`; (e) a title, a category or a virus name in an event payload, a log line or a heartbeat; (f) the HMAC canonical string differing between `services/scanner/src/hmac.mjs` and `scan-client.ts` (both tests pin one vector), or a skew check missing; (g) the shim fetching before verifying, or fetching any URL not on the caller's own origin and the documents sign path; (h) a production value, a Supabase key or a non-literal secret in `services/scanner/`, `fly.toml`, `ci.yml`'s `scanner` job or `playwright.config.ts`; (i) the EICAR string whole in any file (`grep -rn "EICAR-STANDARD-ANTIVIRUS-TEST-FILE" -- . ':!*.md'` must show it only beside its separate head); (j) 0079's ASCII rule, its grants (`record_document_scan` for `service_role` only; the view SELECT-only), `security_invoker`; (k) the pass scanning while the worker is unhealthy (deviation 7), or its budget missing from `cron-coupling.test.ts`; (l) a status drawn by colour alone, a second `data-variant="default"`, a spinner or pulse; (m) `set-state-in-effect` in the card's timer or the viewer; (n) a test that cannot fail (memory "Vacuous test shapes"): a Spanish assertion against `t()`'s output, a raw-markup negative on an apostrophe string; (o) the `documentRemoved` kind missing from any exhaustive map or switch (`ROW_KINDS`, `ROW_ICON`, `authorOf`, `timeline-rows`, `recent-rows`, both timelines); (p) `MEASURED` raised without its comment.
- [ ] **Step 4.** Report findings by severity with file:line; the orchestrator routes fixes to the owning task's agent.

---

## Task 14: Rollout (orchestrator; LAST; not a coding task)

Additive migration, so it applies before the merge. The worker must be up and the Vercel env set BEFORE the merge deploys, or every upload after the deploy waits until it is. Each step reads its own evidence; nothing is inferred from an earlier run.

- [ ] **Step 1. Fly account and price.** DONE: danlo created the Fly.io account (org `personal`, card added) and `<FLYCTL>` is logged in (Task 0 step 3). Read fly.io/docs/about/pricing for an always-on `shared-cpu-1x` with 2 GB in `iad`; write the monthly number in the ledger and the PR body (Assumption A2). If it is not about $10–12, tell the owner before Step 3.
- [ ] **Step 2. bis-ci** (as soon as Task 1's review approves, so the e2e job's migration check is green on the first push). `gh workflow run ci-project-setup.yml -f step=push-dry-run --ref feat/s07-vault-2a` → its log lists exactly `0079_document_scan.sql`; then `-f step=push`. Post-apply, read-only with `pnpm --filter @bis/db ci:sql`: `select column_name, column_default from information_schema.columns where table_schema='public' and table_name='document_versions' and column_name like 'scan%' order by 1` → FIVE rows, `scan_attempts`, `scan_signature`, `scan_status`, `scan_tried_at`, `scanned_at`, with `scan_status` defaulting to `'pending'::text`; `select has_function_privilege('service_role','public.record_document_scan(uuid,uuid,text,text)','EXECUTE'), has_function_privilege('authenticated','public.record_document_scan(uuid,uuid,text,text)','EXECUTE')` → `t | f`; `select reloptions from pg_class where oid = 'public.document_scan_timeline'::regclass` → `{security_invoker=true}`. From here on the `@bis/db` suites may run against bis-ci again.
- [ ] **Step 3. The worker.** Follow `docs/runbooks/scanner.md` §2 from `<WT>/services/scanner`: `<FLYCTL> launch --no-deploy --copy-config --name <app>`, `<FLYCTL> config validate` (Assumption A11), generate the two caller secrets, `<FLYCTL> secrets set SCANNER_CLIENTS=…` (production's bound to `https://tlbkbmlrfafquucsmsmm.supabase.co`, Preview's to `https://odnobiodsftffphuuosz.supabase.co`), `<FLYCTL> deploy`, `<FLYCTL> status` → one machine, started. Never paste a secret into a log, the ledger or the PR.
- [ ] **Step 4. Read `/health`** with the runbook's §3 snippet, once with each secret → `{"clamd":true,"signaturesAt":"…"}` within 3 days. A wrong secret answers 401 (check once, deliberately).
- [ ] **Step 4b. Prove production's binding BEFORE the merge (plan review C1).** The origin written after production's secret in `SCANNER_CLIENTS` must equal production's `NEXT_PUBLIC_SUPABASE_URL` origin exactly. Neither is a secret. `vercel env ls production` shows only that `NEXT_PUBLIC_SUPABASE_URL` is SET, not its value; read the value from a production page's network panel (it is public: `https://tlbkbmlrfafquucsmsmm.supabase.co`) and compare it, character for character, with the origin you typed in step 3 (keep the `SCANNER_CLIENTS` value you set in a scratch file under `<SCRATCH>`, delete it after this step; `<FLYCTL> secrets list` shows only a digest). Do the same for Preview against `https://odnobiodsftffphuuosz.supabase.co`. A mismatch is a 403 on every scan. Since C1 that is harmless to the files (a 403 never counts; they wait) and loud (the heartbeat says "could not be reached"), so this step saves time, not data; fix any mismatch before merging all the same.
- [ ] **Step 5. Memory (A1).** `<FLYCTL> machine status` and the Fly metrics page after the machine has run an hour (a freshclam check has happened): resident memory under 1.6 GiB. Over it: stop, and put deviation 12's 4 GB choice to the owner with A2's price.
- [ ] **Step 6. Vercel env.** `SCANNER_URL=https://<app>.fly.dev` in Production and Preview; `SCANNER_SECRET` = the production caller's secret in Production ONLY, the Preview caller's in Preview ONLY (CLAUDE.md production isolation). Redeploy the branch's Preview so it picks them up.
- [ ] **Step 7. Push and CI.** Push the branch; read `verify`, `e2e` and `scanner` ON THE HEAD SHA (`scanner` is not a required check; this reading is what makes it one in practice, plan review 15) (`gh api repos/{owner}/{repo}/commits/<sha>/check-runs`). `scanner`'s log carries A3, A5, A6, A7 and A1's CI reading; `e2e` runs `documents-scan.spec.ts` through the real shim and the fake clamd (A8, A10). A CI-vs-local disagreement is an environment finding first (memory "CI vs local divergence").
- [ ] **Step 8. Gates, one at a time:** `pnpm check`, `pnpm --filter web build`, `pnpm --filter web test:e2e` (check no `screenshots.yml` run is in progress first; a local e2e run uses bis-ci, which Step 2 gave 0079, and starts its own fake scanner). The `forms.spec` unread-badge flake is unrelated; never loosen it.
- [ ] **Step 9. The real EICAR on Preview (spec 7, 8; owner and orchestrator together).** `node services/scanner/test/eicar.mjs <SCRATCH>/eicar.docx`. On the branch's Preview (bis-ci), as the agency, on a throwaway contact of the per-run-style test account (never Test Client One): upload `eicar.docx`. Expected within seconds: the row reads "Removed: it had a virus" with a red dot; `select scan_status, scan_signature from document_versions where id = '<the version>'` on bis-ci (read-only, `ci:sql`) → `infected | Eicar-Test-Signature`-like; the object is gone (the storage dashboard, or a service-role download answers not found). Then upload a clean PDF → it opens; then an owner-locked PDF (no password to open) → it opens (A13; if it reads "Couldn't check this file", stop and tell the orchestrator: deviation 16's consequence is wider than stated). This proves A4 (Fly reaches bis-ci's signed URLs) and A6 in the real path. Delete the throwaway contact and its files afterwards (Delete forever, then the contact).
- [ ] **Step 10. Production.** Pre-flight, read-only through MCP `execute_sql` on `tlbkbmlrfafquucsmsmm`: `select count(*) from information_schema.columns where table_name='document_versions' and column_name='scan_status'` → 0; `select max(version) from supabase_migrations.schema_migrations` → the 0078 apply; `select count(*) from document_versions where status='ready'` → the catch-up's size. Tell the owner how long, from the pass's real numbers (plan review 5; corrected, final whole-branch review M4): each 15-minute tick reads at most 50 pending versions (`DOCUMENT_SCAN_BATCH`) and starts no scan after 15 s (45 s `DOCUMENT_SCAN_BUDGET_MS` minus one 30 s `SCAN_TIMEOUT_MS`); a small file scans in roughly 1 s, so about 15 a tick (60 an hour), fewer when files are large. N files take about N/15 ticks, never fewer than N/50. Then `apply_migration` with 0079's exact text, ONCE (Task 1 step 5 proved no backslash). Then Step 2's reads. Ledger line: `0079 APPLIED <date> on bis-ci and production — NEVER RE-APPLY`.
- [ ] **Step 11. Parity and the advisor.** `docs/runbooks/ci-supabase-project.md` §5: `fingerprint.sql` on both; the function, the view, the columns and their checks equal. MCP `get_advisors` (security): a finding about `document_scan_timeline` would be unexpected (it is `security_invoker`): stop and read it.
- [ ] **Step 12. Merge** (squash, through the PR, after the head SHA's `verify` and `e2e` are green, `scanner` is green, and Task 13's findings are closed). The PR body names: deviations 1–16 (1 and 12 ACCEPTED 2026-10-15 by the orchestrator), deviation 16's consequence for password-protected files, that bis-ci's part-1 files stay "Checking" on Preview because no cron runs there (plan review 14: Vercel runs crons on Production only; a new upload on Preview is scanned at its finish, an old one only if the orchestrator runs the pass by hand against Preview's deployment), Assumptions A1–A12 and where each was proven, the pinned tests this PR changes, "Not in this PR" (0080 must drop `documents.scan_status` first), the Fly price and machine size, and the 0079 apply lines.
- [ ] **Step 13. After the deploy.** The deploy reads READY on the merge SHA. **Do not walk away until the FIRST production verdict has landed clean** (plan review C1): `select scan_status, scanned_at from document_versions where status='ready' order by scanned_at desc nulls last limit 5` on production (read-only, MCP `execute_sql`) shows a `clean` row with a `scanned_at` after the deploy, within one tick (15 minutes) of it. Production holds NO document versions today (re-review minor 1), so make one: as the agency, on an AGENCY-OWNED production record (a contact on the agency's own account, never a client's), upload one small clean PDF; watch its row go from "Checking" to the ordinary row and `scan_status` read `clean`; read its scan time in `<FLYCTL> logs` (A15); then trash it and Delete forever, and re-read that no row or object is left; if instead the heartbeat names "could not be reached" or the breaker, production's binding is wrong (step 4b): fix `SCANNER_CLIENTS` at once (nothing was spent). Within 30 minutes: `select count(*) from document_versions where status='ready' and scan_status='pending'` on production falls tick by tick to 0 (the catch-up, spec §8); `select scan_status, count(*) from document_versions where status='ready' group by 1` → all clean (an infected part-1 file, if any, is now removed: tell the owner which account). `/api/ops/health` answers 200 once the catch-up is done (until then it may name `documents.scanner` for "a file has waited": expected, deviation 6). Ledger: the item 6 / F-005 tracker row stays `in_progress` (spec §8) with "part 2a (scanning) shipped #<n>".

---

## Spec coverage

| Spec | Where |
|---|---|
| §1 row 2a: the worker on Fly.io | Task 4 (shim, image, fly.toml), Task 10 (CI job, runbook), Task 14 steps 1, 3–5 |
| §1 row 2a: per-version scan state, migration 0079 | Task 1; deviation 2 (the retired column) |
| §1 row 2a: the single read gate | Task 3 (`signedDocumentReadUrl`), Task 6 (the action through it; `read-gate.test.ts`), Task 9 (nothing unchecked asks), Task 12 tests 1–3 |
| §1 row 2a: the retry pass | Task 8; deviation 7 |
| §1 row 2a: the virus-removed state | Tasks 2, 3, 3b, 5, 7, 9; Task 12 test 2 |
| §1 row 2a: the catch-up scan of part 1's files | Task 1 (default `pending`), Task 8 (the pass), Task 14 steps 10, 13 |
| P1 ClamAV as an always-on daemon | Task 4 (`clamav/clamav:1.4`, `start.sh`), fly.toml `auto_stop_machines = "off"` |
| P2 Fly.io, one ~2 GB machine in `iad` | Task 4 fly.toml; deviation 12; A1, A2 |
| P3 every file waits until clean; scanner down → files wait; catch-up | Tasks 3, 5, 6, 8, 9; deviations 1, 7, 14 |
| P4 infected deleted at once, visible note, timeline row, event | Task 5 (object first), Task 3 (event), Task 3b (row), Task 9 (note); Task 12 test 2 |
| §3.1 `POST /scan`, verdicts, never writes | Task 4 |
| §3.1 HMAC over body and timestamp, 60 s, 401 without fetching | Task 4 (`hmac.mjs`, the "NEITHER fetches" test), Task 5 (client, shared vector) |
| §3.1 storage-origin allow-list | Task 4 (`allow.mjs`, `config.mjs`); deviation 4 |
| §3.1 `GET /health` with clamd and signature age | Task 4, Task 5 (`scannerHealth`), Task 8 |
| §3.1 no database or storage credential on the worker | Task 4 (env), Global Constraints, Task 14 step 3 |
| §3.1 production and Preview call one worker | deviation 4; runbook §2, §4 |
| §3.2 columns, defaults, part 1 left pending | Task 1 |
| §3.2 `documents.scan_status` dropped | deviation 2: default now, drop in 0080 |
| §3.2 pointer moves only on clean; trigger | deviation 1 (ACCEPTED 2026-10-15; spec amended) |
| §3.2 verdict RPC, compare-and-set, storage first | Task 1, Task 3, Task 5; deviation 3 |
| §3.3 one minting function; scanner's separate one | Task 3, Task 6 (`read-gate.test.ts`) |
| §3.4 scan at the finish | Task 6 |
| §3.4 retry pass, budget, 3 attempts, unscannable fail-closed | Tasks 5, 8 |
| §3.4 (amended) only file-specific errors count; the self-test breaker; the finish never spends; the tried order | Task 1 (`scan_tried_at`, `tried`), Task 3 (order), Task 4 (stages, self-test), Task 5 (`spend`, `holdErrors`), Task 6 (finish holds), Task 8 (stamp, breaker); deviations 15, 17 |
| Re-review N1: no limit below clamd 1.4's defaults; past them is a bomb (orchestrator ruling) | Task 4 (Dockerfile, the 300 MiB-expansion case), Task 10 (peak memory); deviation 16; A15 |
| Owner ruling 2026-10-15: a password-protected file is removed AND its note says why; the reason is data for 2b too | Task 1 (0079 keeps the cause), Task 2 (three keys), Task 3 Step 4b (`removedReason`), Task 3b (row words), Task 5 (cause passed on), Task 7 (`locked` view state), Task 9 (card, viewer) |
| §3.4 (amended) skipped or encrypted content is unscannable, never clean | Task 4 (Dockerfile, `parseReply`, real-clamd tail EICAR), Task 5 (mapping); deviation 16 |
| §3.4 heartbeat; ops health red on unreachable / stale signatures / pending > 15 min | Task 8 |
| §3.5 "Revisando", "Tarda más de lo normal", never reads as lost | Tasks 2, 7, 9; Task 12 test 3; deviations 6, 11 |
| §3.5 a pending NEW version leaves the clean one current | Task 7 (`documentView`), Task 9 (Versions list); deviation 1 |
| §3.5 infected: note, Move to trash, timeline row (automation), event (ids only) | Tasks 3, 3b, 9; Task 12 test 2; deviation 10 |
| §3.5 unscannable reads its own words | Tasks 2, 3b, 7, 9; deviation 8 |
| §3.5 English and Spanish | Task 2, every UI test asserts both |
| §6 cards fail on their own; scanner unreachable → files wait | unchanged boundaries; Task 8; Task 9 |
| §7 worker tests, real clamd, EICAR, clean PDF, bad HMAC, disallowed URL | Task 4, Task 10's job |
| §7 app: client mocked at HTTP; gate refuses non-clean; retry budget and 3-attempt rule; storage before verdict | Tasks 3, 5, 6, 8 |
| §7 `@bis/db`: RLS and grants for 0079; the verdict's compare-and-set | Task 1, Task 3 |
| §7 e2e with a fake scanner behind the same HMAC | Task 10, Task 12; deviation 5 |
| §7 one manual EICAR on Preview | Task 14 step 9 |
| §8 rollout order, Fly account, secrets, Vercel env, catch-up read | Task 14 |
| §9 A1–A4 | Assumptions A1–A4, each with its check |
| 2b, 2c | "Not in this PR" |

## Self-review notes (the writer's own pass, 2026-10-15)

- **Run, not just written:** the twelve `services/scanner` code blocks were extracted from this plan into a scratch tree and `node --test "services/scanner/test/*.test.mjs"` passed 9 of 9 on Node 24.13 (one fixture bug caught and fixed on the way: the "over the limit" file was smaller than the limit). The EICAR DOCX was read back through a JavaScript copy of `content-check.ts`'s `zipEntryNames` and is accepted as a DOCX (`[Content_Types].xml`, `word/document.xml`, `eicar.com`). The HMAC vector was computed with `node:crypto`. `Date.parse` reads clamd's ctime form, single- and double-digit days. Nothing else in this plan was executed; the app and db code is written against the files read at `5d74ee58`.
- **Vacuity pass:** every prescribed test names its mutation. Caught while writing: a messages case that asserted `toMatch(/^[^]*$/)` (true for any string; replaced by a type check); a byte-count control that MSYS's argument handling turned into a backspace (rebuilt from `String.fromCharCode`). The scan procedure's order tests read ONE call log shared by the storage and RPC fakes, so "object first" is an order assertion, not two independent `toHaveBeenCalled`s. The source-scan test has a positive control (it must find `documents.ts` and `scan-version.ts`), so an empty walk cannot pass it.
- **Request-client proof:** the only new service-client paths are the finish's scan (after the finish's existing proof and `markDocumentVersionReady`) and the URL action's gate (after its existing request-client reads); the pass runs as the cron, on ids it read itself.
- **Types across tasks:** `ScanStatus` (Task 3) → `DocumentVersionRow.scan_status` → `documentView` (Task 7) → `DocumentView.version.scan` / `ScanState` → `rowScan`, `scanLabel`, `viewerNotice`, `nextPollMs` (Task 7) → the card and viewer (Task 9). `ScanVerdict`, `ScannerHealth`, `SCANNER_HEARTBEAT_KEY` (Task 5) → the pass and the health route (Task 8). `ScanResult` (Task 5) → the finish's answer (Task 6). `TimelineDocumentScan` (Task 3) → the `documentRemoved` entry (Task 3b). `SCAN_SLOW_MS` is defined once (Task 7) and read by the pass (Task 8).
- **Revision of 2026-10-15 (plan review of 4771f63a):** C1, C2, I1, I2 and minors 2–15 applied; the revised shim was re-extracted from this plan and run: 12 of 12, and the I1 (byte counter), I2 (redirect), C1 (stage) and %2F mutations each turned one test red by name. Task 7's route-test case is now written out with the file's `row(over)` builder (`route.test.ts:21-31`, read).
