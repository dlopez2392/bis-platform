# The document vault, PR 2b (S-07 + F-005 part 2, migration 0080): customer upload links ("Pedir al cliente"), implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Staff ask a customer for named documents from the Documents card ("Ask the customer" / "Pedir al cliente", P5); the request goes out by text, email or a copied link (P6), in the customer's language; the customer opens `/d/<token>` with no sign-in, on the client's brand (DESIGN.md rule 9), and uploads each item (or takes a photo) through the same three-step upload staff use; every customer file is scanned exactly like a staff file (2a), filed under the requested category with the **customer** author mark, and the request completes itself when every item has a clean file. Staff see news on the timeline ("Customer sent Insurance", "Ana asked for 2 documents") and ONE work-queue item per request ("Ana García sent documents · Review").

**Architecture:** One migration, **0080**, whose FIRST statement drops the retired `documents.scan_status` (2a deviation 2). It widens `documents.source` with `customer`, adds `documents.request_id` / `request_item_key`, creates `document_requests` (server-written, members read under the record's visibility as `documents`), a service-only function `start_document_request_upload` (locks the request, re-proves it open, counts today's starts, creates the document and reserves its version through 0077's `reserve_document_version` in ONE transaction), a trigger that sets `completed_at` when the last item gets a clean file (fires on the verdict, so the finish and the retry pass are both covered by construction), the `document_request` source on `automation_log` (quiet-hours holds and "What went out"), and two link columns on `tasks` for the work-queue item (guarded like `call_id` by `app.keep_task_links`). The token is 32 bytes, base64url, **derived** as HMAC-SHA256 of the request id under `DOCUMENT_LINK_SECRET` (deviation 1, ACCEPTED), so the database holds only its sha256 and staff can still Copy link later. The public page `/d/[token]` and its two routes `POST /api/d/[token]/start` and `/finish` bypass Clerk (the proxy's negative lookahead gains `d/`), use the service client after a hash lookup, and pass `account_id` + the request id to every query. The finish is the staff finish's own body, extracted into `lib/documents/finish-upload.ts` and called by both, so a customer file is checked, hashed, marked ready and scanned with `holdErrors` exactly as a staff file. Delivery reuses the consent gate (`decideSms`/`deliverSms`, `sendEmail`) with two new `informational` kinds (stops apply, quiet hours apply), holds through `writeHeld` and a releaser, and writes the conversation row (person mark) and the `automation_log` row.

**Tech Stack:** Postgres 17 (Supabase) migration; supabase-js 2.110.8 (`rpc`, `storage.createSignedUploadUrl`); Next.js 16.3.6 App Router (server actions, route handlers, a public root layout per tree); React 19.2.4; vitest 4 (`renderToStaticMarkup`, no DOM; `vi.mock`); `node:crypto` (HMAC, sha256); the consent gate (`lib/consent/gate.ts`, `email-gate.ts`); sonner toasts; the `@bis/db` suites on a local PG18 replica (with a local PostgREST for `withTestAccount`) and CI `verify`; Playwright (bis-e2e-qa writes it, the orchestrator runs it), with 2a's real shim and fake clamd already in `webServer`.

**Revision:** 2026-10-15, after the plan review of `9748f88d` (I1–I11, M1, M2, M6, M7, M11, M13; orchestrator rulings: deviation 1 ACCEPTED, `DOCUMENT_LINK_SECRET` REQUIRED (I10), the lost-To-do reconcile (I5), a completed or expired request still finishes a version it already reserved (I6), 0080 goes to bis-ci after Task 13). M3, M4, M5, M8, M9, M10, M12 are carried to Task 13's hunt. The spec carries matching "Amended 2026-10-15 (2b plan review)" notes.

**Spec:** `docs/superpowers/specs/2026-10-15-document-vault-part2-design.md` (owner-approved 2026-10-15): §1 row 2b, §2 P5 and P6, §4 entirely, the 2b parts of §6–§8, and every 2a amendment that reaches 2b (per-caller scanner secrets, `removedReason` for the customer page, the finish never spends). Template: `docs/superpowers/plans/2026-10-15-document-vault-pr2a.md` (shipped as #260). Base: `main` at `3eb5b246` (#260, PR 2a merged; **0079 is on bis-ci and production: never re-apply**). Every file:line below was read off this worktree at `3eb5b246`; anything not read is labelled **Assumption**.

`<WT>` = `C:\Users\danlo\bis-platform\.claude\worktrees\s07-2b` (Git Bash: `/c/Users/danlo/bis-platform/.claude/worktrees/s07-2b`), branch `feat/s07-vault-2b`. `<SCRATCH>` = `C:\Users\danlo\AppData\Local\Temp\claude\C--Users-danlo-bis-platform\f54a0255-9568-420c-ad87-a4d62d6b9a05\scratchpad` (Git Bash: `/c/Users/danlo/AppData/Local/Temp/claude/C--Users-danlo-bis-platform/f54a0255-9568-420c-ad87-a4d62d6b9a05/scratchpad`); write it out literally in every command. `<KITSRC>` = `/c/Users/danlo/AppData/Local/Temp/claude/C--Users-danlo-bis-platform/db21dcfe-6aee-47cd-8939-ff4f82a45810/scratchpad/s07-t3-impl` (read 2026-10-15: `postgrest.exe`, `make-jwt.js`, `proxy.mjs` present). `…/contacts/` = `apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/contacts/`. `…/groups/` = `apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/groups/`. `…/api/` = `apps/web/src/app/api/accounts/[accountId]/`.

## Global Constraints

- **NEVER `git stash`, `git reset`, `git checkout --`, `--amend`, or any history rewrite** in the shared worktree (2a's ledger: a reviewer used `git checkout --` on `messages.ts` to revert its own probe; banned). Another agent's uncommitted work lives in the same tree. To undo your own edit, edit it back. To see committed text, `git show HEAD:<path>`. Never `rm -rf` anything under `<WT>` (memory "No rm -rf on worktrees"); scratch directories under `<SCRATCH>` are yours to delete. Commit with `git commit -m "…" -- <every path>`, never `-A` or `.`.
- **Ownership (tag on every task; no task edits a file its owner does not own).**
  - **bis-db-schema:** `packages/db/supabase/migrations/0080_document_requests.sql` (new), `packages/db/src/test/document-requests-schema.test.ts` (new), and the `documents.scan_status` lines of the five db test files listed under "Pinned tests" plus `document-scan.test.ts`'s first case. Writes the migration and proves it on a replica; never applies it.
  - **bis-crm:** `apps/web/src/lib/messages.ts` and one new `describe` in `apps/web/src/lib/messages.test.ts` (**Task 2 only**); `packages/db/src/{document-requests,documents,document-rules,record,activities,index}.ts` and their tests (Tasks 3, 3b); `apps/web/src/lib/record/*`, both timelines, the drawer maps, `route.reads.test.ts` (Task 3b); `apps/web/src/lib/documents/{finish-upload,upload-core,upload-client,scan-version,documents-load}.ts` and tests, `…/contacts/documents-actions.ts` (+ test) (Task 4); `apps/web/src/lib/document-requests/request-task.ts` (+ test) (Task 4); `apps/web/src/lib/document-requests/{token,customer-upload,customer-state}.ts` and tests, `apps/web/src/app/api/d/[token]/{start,finish}/route.ts` and tests (Task 5); `…/contacts/document-requests-actions.ts` (+ test), `…/api/contacts/[contactId]/document-requests/route.ts`, `…/api/groups/[groupId]/document-requests/route.ts` (+ tests), `apps/web/src/lib/document-requests/requests-load.ts` (+ test), the one `ALLOWED` line in `…/accounts/[accountId]/in-account-service-reads.test.ts` (Task 7); `apps/web/src/lib/i18n/{catalogue,ratchet}-baseline.json` (Task 11, regenerated, never hand-edited).
  - **bis-comms:** `apps/web/src/lib/consent/classes.ts` (two kinds), `apps/web/src/lib/consent/scans.test.ts` (`SITES` row), `apps/web/src/lib/document-requests/deliver.ts` (+ test, new), `apps/web/src/lib/email/templates/document-request.ts` (+ test, new), `packages/db/src/automation-log.ts` (the one source), `apps/web/src/lib/automations/log-titles.ts` (the one title), `apps/web/src/lib/automations/passes/release-held.ts` (the one `RELEASERS` line) (Task 6).
  - **bis-frontend:** `…/contacts/{documents-card.tsx,documents-card-handlers.ts,document-request-dialog.tsx,document-requests-list.tsx}` and their tests, `apps/web/src/app/(dashboard)/dashboard/styleguide/{documents-demo.tsx,documents-demo.test.ts}` (Task 8); `apps/web/src/app/d/**` (the public tree, new) and `apps/web/src/lib/document-requests/customer-client.ts` (+ test) (Task 9).
  - **bis-automations:** `apps/web/src/lib/automations/passes/documents-scan.ts` (+ test), `apps/web/src/lib/automations/sentinel.test.ts` (the pass's counters), `apps/web/src/app/api/cron/reminders/route.test.ts` (`EMPTY_DOCUMENTS_SCAN`) (Task 6b).
  - **bis-platform:** `apps/web/src/proxy.ts` and `apps/web/src/proxy.test.ts`, `.env.example` (one block), `apps/web/playwright.config.ts` (the app server's `env` and the runner's `process.env`, one line each) (Task 10).
  - **bis-e2e-qa:** `apps/web/e2e/document-requests.spec.ts` (new) (Task 12).
  - **Orchestrator:** the ledger, the bis-ci and production applies of 0080, the parity check, the gates, the PR, the merge, the roadmap tracker row, and the decision on deviation 1. No `DESIGN.md` edit: the module contract already routes this module (a card on the record, its news to the timeline, its work to the queue), and the customer page follows the booking page's pattern (rule 9).
- **Shared files, one task at a time.**
  - `apps/web/src/lib/messages.ts`: **Task 2 only**. Every key in this plan is listed in Task 2. A later task that finds a key missing STOPS and reports it; the orchestrator re-opens Task 2. A `.es` twin goes on the line directly under its English key.
  - `packages/db/src/{document-requests,documents,document-rules,index}.ts`: **Task 3 only**. `packages/db/src/record.ts`, `activities.ts` and `lib/record/*`: **Task 3b only**.
  - `apps/web/src/lib/documents/*` and `…/contacts/documents-actions.ts`: **Task 4 only**.
  - `apps/web/src/lib/document-requests/request-task.ts`: **Task 4 only**; `apps/web/src/lib/document-requests/{token,customer-upload,customer-state}.ts`: **Task 5 only** (Tasks 6, 7, 9 consume them).
  - `…/contacts/documents-card.tsx` and its handlers: **Task 8 only**.
  - `apps/web/src/lib/i18n/*-baseline.json`: **Task 11 only**, after every copy-bearing task has committed.
- **Every test must be able to fail, and the plan writer checked each one; the implementer re-checks.** Each test names the mutation that breaks it. Run the probe, see the test fail BY NAME, paste the failing assertion line into the report, revert by editing back. Shapes a reviewer rejects on sight (memory "Vacuous test shapes"): `toBeTruthy`/`toBeDefined` on content; an English-only assertion where a Spanish twin exists (assert BOTH, the Spanish compared against the literal string, never `t()`'s output, which falls back to English silently); a mock that satisfies itself; an assertion on a value the fixture already contained before the code ran; a negative `not.toContain` against raw `renderToStaticMarkup` output on a string with an apostrophe (use `renderedText()` from `apps/web/src/lib/rendered-text.ts:25` for EVERY copy assertion); a source scan by regex over code that can contain `/*` in a string (2a Task 6: use the TypeScript AST, as `read-gate.test.ts` does). A `-t` filter that matches nothing passes silently: check the run count in vitest's summary block.
- **2a's defects, designed out here.** (1) **No `fetch` follows a redirect on a token route or the delivery path:** the browser PUT goes to storage's signed upload URL only; server `fetch` is not used by this PR. (2) **A poll effect fires more than once:** the customer page's re-read uses a pure `nextCustomerPollMs(states, reads)` and a `reads` counter in the effect's deps, exactly like the card's `pollTimerKey(pollMs, reads)` (`documents-card.tsx:392-394`, `:441-448`), and the e2e spec holds a file "Checking" across at least three polls before releasing it (Task 12). (3) **An error never spends anything:** the customer finish calls the same `scanVersion(…, { holdErrors: true })` the staff finish does (`documents-actions.ts:281-282`), never `spendScanError`; a failed send never revokes or expires a request. (4) **No vacuous test:** every case below names its mutation.
- **0053, server-only writes; the request-client proof (staff side).** Every service-role call on an id that came from the browser runs AFTER `requireAccountAccess(accountId)` and a request-client read (`dbForRequest()`, `apps/web/src/lib/db.ts:21-26`) that returns that record or that request under RLS. `document-requests-actions.ts` is added to `in-account-service-reads.test.ts`'s `ALLOWED` as `proven-target` (Task 7). **No new file under `apps/web/src/lib`, `…/accounts/` or `…/api/` contains the token `serviceDb`, not even in a comment** (that test scans `lib` too, `:34`): every lib function takes the caller's client as a parameter.
- **The public rule (study §3.4, "every public link follows one rule").** A token route proves the token FIRST (shape check, then a lookup by its sha256, then open: not expired, not revoked, not completed) and every later query carries `.eq("account_id", request.account_id)` AND the request id (or, for the record, the request's own `contact_id`/`client_group_id`, read inside SQL from the locked request row). The customer never names a record, a category or a storage path: the start takes only an item key (the record and the category come from the request row inside `start_document_request_upload`), the finish takes a document id and a version id that must belong to THIS request in THIS account. Nothing logs the token: route and page logs name the request id only; no route echoes the token in an error.
- **The customer never sees or downloads anything stored** (spec §4.3). `read-gate.test.ts` (2a) must stay green: no new `createSignedUrl`/`createSignedUrls`, and `signedScannerUrl` stays in `scan-version.ts`. The customer page shows per-file states (a dot and a word), never a file name, a title of a stored file, a size or a link.
- **SQL rules.** The migration is ASCII only with no backslash anywhere (memory "MCP SQL escapes"; checked with the node byte count in Task 1, which has a positive control). A boolean built from a nullable value is `coalesce(…, false)` (memory "plpgsql NULL guard"). A Supabase `head: true` count throws on `count === null` (memory "head-count null"); this plan adds none.
- **DESIGN.md definition of done for every UI task (8, 9):** tokens only (radii `rounded-[var(--radius-ctl)]`, pills `rounded-full`; no hex, no literal shadow); both themes via the `.dark` class on the dashboard; on the public page, the tenant theme from `publicFormTheme` with `var(--token, fallback)` CSS as `/u` does (`apps/web/src/app/u/[token]/page.tsx:57-61`, public trees do not load `globals.css`, so `--surface-0` is reached as `var(--background, …)` the way `/b` and `/u` do it); the blur fallback; **rule 3: every state is a dot AND a word**; rule 5 (loaded, empty, error); rule 6 (Revoke runs at once with Undo in the toast); rule 7 (no spinner: "Uploading 45 %" is a word and a number, "Checking" a dot and a word, nothing pulses); rule 8 (the Documents card keeps exactly ONE `data-variant="default"` button, Upload; "Ask the customer" is ghost; the dialog's one primary is Send/Create link; the customer page's one primary per item is Upload, Take photo is ghost); rule 9 (the customer page carries the client's logo and colour, and "Powered by BIS"); controls `min-h-11 md:min-h-8` on the dashboard and `min-height: 44px` on the public page; nothing animates on scroll.
- **Copy.** Every new string through `t(m, key, locale, params)` with an `.es` twin in the same commit (`apps/web/src/lib/i18n/ratchet.test.ts`). New `.tsx` code carries no JSX literal copy with a letter in it. Usted for every new Spanish string. No vendor or internal words in copy ("token", "hash", "scanner", "Supabase", "storage", "signed URL", "request id"). One message is in one language end to end (DESIGN.md "A customer's language"): the text, the email's subject, body and button, and the customer page all use the REQUEST's `language`.
- **Browser code imports the vault's rules from `@bis/db/document-rules`**, never the `@bis/db` barrel. `lib/document-requests/{customer-state,requests-load,customer-client}.ts` and `lib/documents/upload-core.ts` are browser-safe (no barrel import, no `node:` import); `token.ts`, `customer-upload.ts`, `request-task.ts`, `deliver.ts` are server-only.
- **The `vi.mock` factory check.** A task that adds a NEW named import to a module adds that name to every mock factory that reaches the module: `grep -rln 'vi.mock("@bis/db"' apps/web/src | xargs grep -ln "<module basename>"`. In particular `scan-version.ts` gains an import of `request-task.ts` (Task 4), which imports `documentRequestTarget`, `ensureDocumentRequestTask` and `getDocumentRequestForVersion` from `@bis/db`: a test whose bare `@bis/db` factory drives the REAL `afterClean` through a clean verdict gains those three names (`documents-actions.test.ts` mocks `scan-version` whole, `:27`; `scan-version.test.ts` injects its own deps; `passes/documents-scan.test.ts` is read and run, not edited).
- **Running tests.** Only the affected tests, by path: `pnpm --filter web exec vitest run "<path>" …`, `pnpm --filter web typecheck`, `pnpm --filter web exec eslint "<touched files>"`. `@bis/db` suites only on a replica (the kit below), judged by vitest's summary block (capture the exit code to a file with nothing after the command; the `ERR_PNPM_RECURSIVE_EXEC_FIRST_FAIL` trailer lies); in `packages/db` run vitest as `node node_modules/vitest/vitest.mjs run <files>` (2a ledger: there is no vitest shim there). **No `@bis/db` vitest may run against bis-ci until Task 14 step 2 has applied 0080 there** (0080 drops a column five suites used to insert and `documents.ts` reads the new columns). Never the gates (`pnpm check`, `pnpm --filter web build`, `pnpm --filter web test:e2e`) and never Playwright: the orchestrator runs them, one at a time (memory "Agent test scope"). Never pass the folder `…/accounts/` to vitest (it holds `calls/[callId]/actions.test.ts`, a live test).
- **A unit test that reaches `requestToken`** (directly, or through `requestUrl`, `deliver.ts` or the create action) sets the secret itself (re-review m2): `beforeEach(() => vi.stubEnv("DOCUMENT_LINK_SECRET", "bis_unit_document_link_fixture_only_000000000"))` and `afterEach(() => vi.unstubAllEnvs())`. Never a real value, never a shared setup file that would also hide a MISSING secret from `token.test.ts`'s own required-secret case (which deletes the variable inside its test). Tasks 5 (`token.test.ts` sets its own values per case), 6 (`deliver.test.ts`) and 7 (`document-requests-actions.test.ts`) apply it.
- **Mutating e2e only on the per-run fixture account** (`readClientFixture()`, `apps/web/e2e/support.ts:103-110`), never `Test Client One`; every seeded row and stored object deleted in `afterAll`, each error checked, then re-read to confirm none is left.
- **Nothing sends, nothing calls a real provider.** No test sends a real text or email: the SMS provider outside production is the fake (`lib/sms/index.ts`, `getSmsProvider`), and every delivery unit test injects its sender. No test calls the Fly worker; e2e uses 2a's fake clamd behind the real shim.
- **No production credential anywhere.** `DOCUMENT_LINK_SECRET` (deviation 1) is REQUIRED (orchestrator ruling I10): a fresh random value of at least 32 bytes, DIFFERENT in Production and Preview, set by the orchestrator in Task 14; there is NO fallback to the service-role key (a link key derived from it would tie every customer link to a credential rotated for other reasons, and put production's key into the link's derivation). Tests and Playwright use the literal fixture `bis_e2e_document_link_fixture_only_0000000000` (Task 10), never a real value. Never read, print or parse an `.env` value with code that can throw (memory "Env secret reads"); `token.ts`'s error names the variable, never a value.
- **Commits** (every "Commit" step below, whatever its short form) carry the trailer lines `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>` and `Claude-Session: https://claude.ai/code/session_013RThMy9QC8x7FZ94Lxib9p`. If `.git/index.lock` exists, wait and retry; never delete it. Never push (the orchestrator pushes). Never touch `main`.
- **Never** apply a migration outside your own replica, run SQL that writes to a shared project, mutate Test Client One, create or edit `.env*` (except Task 10's `.env.example`), or set a Vercel secret. Those are the orchestrator's, in Task 14.

## The replica kit (every `@bis/db` task and its reviewer)

Ports, one set per agent, never `5432`: Task 1 implementer `55580`, Task 1 reviewer `55581`; Task 3 implementer Postgres `55582`, PostgREST `55583`, gateway `55584`; Task 3 reviewer `55585`/`55586`/`55587`; Task 3b implementer `55588`/`55589`/`55590`; Task 13 (final review) `55591`/`55592`/`55593`. Each agent works in its own `<SCRATCH>/s07d-t<N>-<impl|review>/`.

2a's kit (`<SCRATCH>/s07c-kit/replica.sh`, `pgrst.sh`; both present, read 2026-10-15), copied and re-pointed by Task 1 to `<SCRATCH>/s07d-kit/`: `WT` becomes `/c/Users/danlo/bis-platform/.claude/worktrees/s07-2b`; `pre` is every migration through **0079** (with the storage stub 0077 needs); `post` is `pre` plus the branch's **0080** if it exists yet. The only lines that change in `replica.sh` are the `WT=` line, the `case "$f" in *0079_*)` skip (becomes `*0080_*`), and the `post` block's file name (`0080_document_requests.sql`) and messages (`post = pre + 0080`, `0080 FAILED`, `post = pre (no 0080 yet)`). `pgrst.sh` is copied unchanged except the JWT secret string, which becomes `s07d-local-postgrest-jwt-secret-not-used-anywhere-real-0000`. Task 1 writes both with `sed` from the 2a copies and shows `diff` output in its report: exactly those lines differ.

The proxy (from `<KITSRC>`) forwards `/rest/v1/*` to PostgREST and answers `DELETE /storage/v1/object/documents` with `200 []`; any other storage call gets 404, so a db test that unexpectedly reaches storage fails loudly.

Stop your own kit only (never `taskkill /IM postgrest.exe`): `touch "<dir>/stop"`, then in PowerShell `Get-Process postgrest | Where-Object { $_.Path -eq '<dir as a Windows path>\postgrest.exe' } | Stop-Process -Confirm:$false` and `Get-NetTCPConnection -LocalPort <gatewayPort> -State Listen | ForEach-Object { Stop-Process -Id $_.OwningProcess -Confirm:$false }`; then `"/c/Program Files/PostgreSQL/18/bin/pg_ctl" -D "<dir>/pgdata" stop -m fast`. A SQL mutation probe on `post` needs `psql … -d post -c "notify pgrst, 'reload schema'"`.

**Faithfulness** (once per kit build, read-only on bis-ci with `pnpm --filter @bis/db ci:sql`): the client-write-surface digest on `pre` equals bis-ci's (bis-ci has 0079 and not 0080 until Task 14 step 2). The query is 2a's (plan `2026-10-15-document-vault-pr2a.md`, "The replica kit"):

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

- **The `documents.scan_status` drop (0080's first statement).** Six db test files name the column; each loses it (Task 1): `packages/db/src/test/document-space-used.test.ts:33`, `document-vault-reserve-lock.test.ts:29`, `document-vault-rls.test.ts:42` (the column and its `'skipped'` value leave the insert list), `document-vault-schema.test.ts:44-47` (the builder's `scan_status` field and column), `:101-112` (the case keeps category and source; the `scan_status` loop and its `documents_scan_status_check` expectation are REPLACED by "the column is gone": `select count(*) from information_schema.columns where table_name='documents' and column_name='scan_status'` → 0), `:222` (the literal insert), `documents.test.ts:65` (the seed row), and `document-scan.test.ts`'s first case (`:57-64`: the "a document with no scan_status reads 'skipped'" half is removed; the version half stays). The app has not written the column since 2a (`packages/db/src/documents.ts:113-121`, `createDocument` writes no `scan_status`; `git grep scan_status -- apps/web/src packages/db/src ':!*test*'` shows version reads only).
- `document-vault-schema.test.ts:101-112`: the closed source set becomes `upload`, `camera`, `customer` and must match `DOCUMENT_SOURCES` in `packages/db/src/document-rules.ts:25` (Task 1 writes the SQL; Task 3 writes the TS list; the test reads both).
- `packages/db/src/test/record.test.ts:296` and `timeline-merge.test.ts`: `TIMELINE_SOURCES` is UNCHANGED (the request rows join the existing `documents` source, as 1b's and 2a's rows did); `timeline-merge.test.ts:146`'s `TIMELINE_SOURCES.length + 2` becomes `+ 3` (the fourth read inside the documents source) and `:169-183` gains a case for a refused `document_requests` read (Task 3b).
- `apps/web/src/app/api/accounts/[accountId]/contacts/[contactId]/summary/route.reads.test.ts:61`: `MEASURED` 25 → **26** (Task 3b), its comment naming `request:document_requests`.
- `…/contacts/documents-actions.test.ts`: unchanged in behaviour; it must pass UNEDITED after the finish's body moves to `lib/documents/finish-upload.ts` (Task 4: that is the extraction's proof). If its `vi.mock("@bis/db")` factory lacks a name the moved code imports, the factory gains it, and nothing else changes.
- `apps/web/src/lib/documents/documents-load.ts:56` and its test: the parser accepts `source: "customer"` (Task 4); every fixture is unchanged.
- `packages/db/src/test/automations-b-schema.test.ts:168-187` (plan review I3): the catalogue case reads `automation_log_source_check`'s text whole; it gains `'document_request'::text` after `'textback'::text`, and its title "fourteen sources" becomes "fifteen sources (0054 added textback, 0080 document_request)" (Task 1).
- `packages/db/src/test/document-vault-schema.test.ts:107-108` (plan review I3): today it inserts every `DOCUMENT_SOURCES` value and expects `customer` REFUSED; once `customer` is a source those two lines cannot hold (a bare customer row fails `documents_request_coherent`). They become a comparison of `documents_source_check`'s text with `DOCUMENT_SOURCES` (the same shape as the catalogue case above), and the inserts keep `STAFF_DOCUMENT_SOURCES` only (Task 1 writes the comparison against the literal list; Task 3 switches it to the imported constants and re-runs it).
- `apps/web/src/lib/consent/classes.test.ts:31-33` (SMS kinds 14 → 15; `SPEC_TABLE` at `:11` gains the SMS kind's row), `:59` `EMAIL_TABLE` (gains the email kind's row) and `:94-96` (the email count "twenty-six" 26 → 27), `:104-109` (the footer rule holds unchanged: an informational kind carries the unsubscribe footer), `:112-121` (`emailReadsLedger`'s list gains `"staff.document_request_email"`) (Task 6).
- `apps/web/src/lib/consent/scans.test.ts:268`: "all fourteen SMS kinds and all twenty-six email kinds, 36 distinct" → fifteen, twenty-seven, **38** (Task 6). `SITES` (`:760`) is `Record<EmailKind, …>`: ONLY the email kind gains a row there; the SMS kind is reached by the scan at `:268` through `deliver.ts`'s literal.
- `apps/web/src/app/api/cron/reminders/route.test.ts:322` (`EMPTY_DOCUMENTS_SCAN` gains `requestTasks: 0`) and `apps/web/src/lib/automations/sentinel.test.ts:263` (the pass's not-configured counters gain it) (Task 6b, plan review I5).
- `apps/web/src/proxy.test.ts:21-26` gains `/d/sometoken` in the skip list and `:28-33` gains `/docs` and `/dashboard/d` in the run list; `:36`'s "only the four trees" becomes "only the five trees" (Task 10).
- `apps/web/src/lib/consent/scans.test.ts:760-787`: `SITES` gains one row for each new kind's single send site (Task 6).
- `apps/web/src/app/(dashboard)/dashboard/styleguide/documents-demo.test.ts`: its exact counts (`data-documents-card` = 6, `data-document-purge` = 6, `data-expiry-dot` = 6) stay; the demo gains the dialog form and the requests list under NEW markers only (`data-document-request-form`, `data-document-requests`), each counted (Task 8).
- **Unchanged, checked:** `read-gate.test.ts` (no new mint; Task 5's customer finish never mints a read URL); `schema-grants-guard.test.ts` (0080 adds a TABLE with RLS on and no client write, and no view; `EXPECTED_WRITES` keeps `"authenticated tasks": IUD` because the two new task columns are guarded by `app.keep_task_links`, not by grants); `in-account-service-reads.test.ts` except the one `ALLOWED` line Task 7 adds.

## Not in this PR

- PR 2c (the "7 de 9" checklist, migration 0081): its "Pedir al cliente with that item ticked" will open THIS PR's dialog with a preset (`initialItems`, Task 8 exposes the prop; 2c wires it).
- Expiry reminders, share links, the account-wide Documents view (spec part 3).
- A customer seeing, renaming or deleting anything stored; a customer uploading a new VERSION of a file (each customer upload is its own file).
- Reminding a customer whose link is about to expire; re-sending a request (staff Copy link and send it themselves, or make a new request).
- An event for a request's creation, revoke or completion (deviation 7).
- Server-side EXIF stripping (part 1 §5.3 strips in the browser; a customer who bypasses the page uploads what they upload, scanned like everything else).
- A `lang` attribute on the branded email shell (`lib/email/templates/shell.ts:105` writes none today; a shell-wide change for every email kind, named as a follow-up).
- Billing a customer upload (M7a bills texts SENT; the request text is billed like any customer text through the gate's existing usage record, Task 6).

## Deviations from the spec, and spec-vs-code mismatches (the source decided; evidence cited)

1. **ACCEPTED 2026-10-15 (orchestrator ruling). The token is derived, not stored random: `token = base64url(HMAC-SHA256(linkKey, "document-request:v1:" + requestId))`, 32 bytes** (spec §4.1: "32 random bytes … The database keeps its sha256"). Spec §4.2 also gives every OPEN request a **Copy link**, which needs the URL again days later; with only a hash and random bytes there is nothing to copy (re-issuing a token would kill the link already texted). The derived token keeps what §4.1 asks for: 32 bytes of HMAC output, unguessable without the key, and no `document_requests` column holds it (only its sha256, `token_hash`); our own code never logs it (route and page logs name the request id). Stated plainly (plan review M1): the link DOES travel in the text or email body we send (that is its purpose), so the stored `messages` row of a text and the provider's copy hold it, and Vercel's request logs record the path `/d/<token>` of every visit; those are the link's legitimate carriers and none of them is a database column of ours that a read could leak. `linkKey()` = sha256 of `"bis-document-link:" + DOCUMENT_LINK_SECRET`, the forms token key's shape (`lib/forms/guards.ts:36-42`) WITHOUT its service-key fallback: the secret is required (ruling I10) and must be at least 32 characters. Consequence, named: rotating it breaks every open link; links live 7 days, so the runbook says rotate, then tell staff to Copy link again for any request still open. It also lets the quiet-hours releaser rebuild the link without storing it (Task 6). The alternative, a stored sealed token (`token_sealed` encrypted with the same key), was rejected: a second copy of the same secret in the database for no gain.
2. **`documents.scan_status` is dropped as 0080's first statement** (spec §3.2 as amended; 2a deviation 2). Six db tests change (Pinned tests).
3. **Delivery for a household or business goes to the group's primary contact** (`client_group_members.is_primary_contact`, 0075); with no primary contact, or one with no phone or email, only Copy link is offered (spec §4.2 is silent on groups; the card exists on group pages, §4.2 bullet 1). The language is that contact's, then the account's, then English (`recipientLanguage`, `packages/db/src/spanish-box.ts:20`).
4. **The work-queue item is a To-do (`tasks`) carrying two new link columns, `document_request_id` and `document_request_kind`** (`received` | `storage_full`), unique on the pair (spec §4.5: "ONE work-queue item per request"; §4.4: over quota "staff get a work-queue item"). The work queue has no table of its own: it is built from open `tasks`, unread conversations and stale bookings (`packages/db/src/work-queue.ts:7`, `:162`). The two kinds are separate so a "storage is full" item never swallows the later "sent documents" one. The columns are guarded in `app.keep_task_links` (0074:44-60) like `call_id`, so a member can never forge or relabel one. `tasks.contact_id` is the request's contact, or the group's primary contact (nullable, `0003:109`). The task's title is written in the ACCOUNT's language (staff read it; `work-list.tsx:103` shows titles as stored). A To-do linked to a request carries the **automation** mark on the timeline (as a consent To-do does, `author-mark.ts:29-31`).
5. **The per-file timeline row reads "Customer sent Insurance" / "Cliente mandó Seguro"** (the timeline's grammar, "{mark} {verb}", 2a deviation 10), not "Ana subió *Seguro*": the customer mark's word is `provenance.customer` ("Customer"/"Cliente", `messages.ts:2643-2644`) and the timeline never names a customer as an author. The row is the existing `document` row, its verb chosen by `source = 'customer'`. **A customer file's title is its item's label in the request's language** (the category's name, or the Other note), and the customer's own file name is kept as the version's `original_name` (the Versions list shows it). Two files for one item are two files with the same title (titles are not unique).
6. **The request row reads "Ana asked for 2 documents" with the person mark** ("{mark} asked for {count} documents"), its detail the items in the reader's language. It is a fourth read inside the existing `documents` timeline source (`record.ts:374-385`), so `TIMELINE_SOURCES` is unchanged.
7. **No new event** for a request's creation, revoke, completion or expiry (spec §4.2: "Revoke and expiry are not timeline rows"; no event is named). A customer file emits `document.added` through the shared finish, as a staff file does, with actor `customer:<requestId>` and actor type `system` (`markDocumentVersionReady` gains an optional `actorType`, Task 3); `events.actor_type` allows only `user`, `system`, `ai` (`0001_tenancy.sql:62`).
8. **The completion is a trigger; the work-queue item is opened by the app.** `completed_at` is set by `app.document_request_on_clean()`, an AFTER UPDATE trigger on `document_versions.scan_status` → `clean`, which locks the request row and checks every item; so the finish and the retry pass (`passes/documents-scan.ts`, bis-automations, not touched) both complete a request by construction. The "sent documents" To-do needs copy from `messages.ts` and the account's language, so `scanVersion` opens it after a clean verdict (`lib/documents/scan-version.ts`, one call to `openRequestTask`, best-effort and logged; both the finish and the pass call `scanVersion`). The crash window between the verdict and the To-do is CLOSED by a bounded reconcile in the existing `documentsScan` pass (orchestrator ruling I5, Task 6b): each tick it reads open requests and requests completed in the last 24 hours that have a ready, clean customer file and no `received` To-do, and opens it (idempotent through the unique index). `ensureDocumentRequestTask` emits `task.created` when it creates the row, as `ensureConsentTask` does (`activities.ts:141`), and answers `created: false` on the unique index's 23505.
9. **"20 starts per request per UTC day" counts reserved versions of the request's files created since UTC midnight** (spec §4.4), inside `start_document_request_upload` under the request row's lock, so concurrent starts cannot pass 20. A failed PUT's reservation is NOT given back by the customer page (spec §4.4 names two routes, start and finish; no abandon route): it counts until the documents sweep removes it (3 hours, `documents-sweep.ts:21`), and counts against the quota until then, exactly like a staff reservation the sweep cleans.
10. **The customer page re-reads itself while a file is Checking** with `router.refresh()` on a pure schedule (`nextCustomerPollMs`, 5 s for the first minute, then 15 s, stopping after 15 minutes), rather than a third public route. The server component re-derives every file's state from the database on each refresh (`listRequestFiles`).
11. **Two new consent-gate kinds, both `informational`**: `staff.document_request_sms` (`hours: "automated"`, `footer: "stop_line"`) and `staff.document_request_email` (`hours: "automated"`, `footer: "unsubscribe"`) (spec §4.2: "consent holds and stops apply, quiet hours apply"). `staff.composer_sms` is `staff_typed` with `hours: "any"` (`classes.ts:41`), which would skip both. A send inside quiet hours is HELD (`writeHeld`, `hold-or-send.ts:267`) under the new `automation_log` source `document_request`, released by `releaseDocumentRequest` (Task 6) only while the request is still open; "What went out" (`activity/page.tsx`, reads `automation_log` only) shows every send, hold and refusal. The text also appears in the customer's conversation (a `messages` row written before the send, person mark, as the composer does, `conversations/actions.ts:220-232`); the email too (`createMessage(channel: "email")`, as `sendEmailAction` does). **At most once** (re-review R1): `release-held.ts:94-120` never writes the held row; only the releaser's own `sent` write dequeues it, and since a log write may now fail quietly (I4), a held request could otherwise be texted again on the next tick. So a request carries `sent_at`, claimed by compare-and-set inside the text's `prepare` (after the gate cleared it, before the provider) and before `sendEmail`, cleared when that send did not go out; the releaser writes the row `sent` and sends nothing for a request whose stamp is set. Residual, named: a crash between the claim and the provider call leaves a stamp on a request whose message never left; staff see no "sent" row in What went out and use Copy link.
12. **Expired is computed, never written**: `expires_at <= now()` reads expired; no pass sweeps requests (spec: expiry is not a timeline row).
13. **A finish for a version THIS request already reserved is accepted when the request has since COMPLETED or EXPIRED; only a REVOKED request refuses it** (orchestrator ruling I6; spec §4.5 amended). A customer who started two files a moment before the first one completed the request, or whose 25 MB upload outlasted the 7th day, has already been given a reservation and a signed URL by us; refusing their finish would strand the object until the sweep and tell them "not accepted" for a file the business asked for. The START still refuses on completed and expired (0080's function), so no NEW file can begin. Revoked means staff withdrew the link: the finish refuses, and the reservation is the sweep's.
14. **The customer page's re-read follows each Checking file's own age** (server now minus that version's `created_at`; plan review I9), not the moment the page was opened: a reload, or a customer coming back an hour later, must not restart the fast schedule for a file that has been Checking for an hour.

## Assumptions (not verified by reading; each has a named check)

- **A1** `date_trunc('day', now(), 'UTC')` (the three-argument form, Postgres 12+) returns UTC midnight as a `timestamptz` on PG17 (Supabase) and PG18 (the replica). Check: Task 1's rate-limit case on the replica; CI `verify` on the Supabase CLI image.
- **A2** A browser on the public page can `PUT` to the signed upload URL with the same headers the staff card sends (`xhrPut`, `upload-client.ts:111`), with no CSP in the way: the repo sets none (`apps/web/next.config.ts` has no `headers()`, read by the research pass). Check: Task 12's e2e test 1 uploads through `/d/<token>`.
- **A3** `router.refresh()` from a client component under a public root layout (no Clerk, no Toaster) re-runs the page's server component and re-renders the client child with new props, keeping its own state. Check: Task 12's test 2 (the Checking file turns Received with no reload).
- **A4** `listPhoneNumbersForAccount(db, accountId)` (`packages/db/src/voice.ts:847`) answers the account's numbers with `status` and `e164`, and a `live` one is the number customers call. Check: Task 5's test reads it through a fake shaped from that function's own select; Task 12's dead-end page shows the fixture account's live number when it has one, and the no-phone sentence when not.
- **A5** The SMS composer's `prepare` callback and `deliverSms`'s re-read of the ledger behave for a non-`automation.*` kind exactly as for `voice.textback` (`lib/voice/textback.ts:249-300`). Check: Task 6's tests drive `decideSms`/`deliverSms` through the gate with the fake provider and an injected ledger, for a stopped number, a held number, quiet hours and a clean send.
- **A6** The email gate's unsubscribe ledger applies to an `informational` kind (`emailReadsLedger`, `classes.ts`) and its footer marker is replaced for `footer: "unsubscribe"`. Check: Task 6's email test asserts an unsubscribed address is `blocked` and the sent HTML carries the unsubscribe row.
- **A9** (plan review I10) On Preview, a text or email reaches a real phone or inbox only when the provider is real there; outside production the SMS provider is the fake unless `SMS_DEV_REDIRECT_TO` and `TELNYX_API_KEY` are both set (`lib/sms/index.ts`, `getSmsProvider`), and the email provider likewise. Check: Task 14 step 7 verifies a send by the contact's conversation row and the "What went out" row (status `sent`), never by "it arrived on the phone"; arrival is a bonus only if the orchestrator confirms the redirect is set. If Text is not offered on Preview at all (bis-ci has no A2P-approved live number, so `requestChannels` answers `text: false` and the dialog shows only Email and Copy link), step 7(a) is skipped and Task 6's unit tests are the proof of the text path (re-review m4).
- **A7** Playwright can drive a page with no Clerk session through `test.use({ storageState: { cookies: [], origins: [] } })` (`e2e/public-form-theme.spec.ts:64`) while the same spec's other tests use the signed-in state. Check: Task 12 splits the two into two `describe` blocks; the orchestrator's run.
- (Not an assumption, read: `client_group_members.is_primary_contact` (0075:51) has a unique partial index, `client_group_members_one_primary_contact` (0075:52), so a group has at most one primary contact.)

## File Structure

**Created**

| Path | Owner | Responsibility |
|---|---|---|
| `packages/db/supabase/migrations/0080_document_requests.sql` | bis-db-schema | drop `documents.scan_status`; the `customer` source; `document_requests`; the request link on `documents`; `start_document_request_upload`; the completion trigger; the `document_request` log source; the task links and their guard |
| `packages/db/src/test/document-requests-schema.test.ts` | bis-db-schema | 0080 on the replica: checks, RLS, grants, the start function (open/closed/rate/quota/record), the trigger, the task guard |
| `packages/db/src/document-requests.ts` (+ `test/document-requests.test.ts`) | bis-crm | every request read and write the app makes; the pure `requestState` |
| `apps/web/src/lib/documents/finish-upload.ts` (+ test) | bis-crm | the finish's body, shared by the staff action and the customer route |
| `apps/web/src/lib/documents/upload-core.ts` | bis-crm | browser-safe `prepareFile`, `xhrPut`, `UPLOAD_STALL_MS`, moved out of `upload-client.ts` so the public page never imports the dashboard actions |
| `apps/web/src/lib/document-requests/token.ts` (+ test) | bis-crm | the derived token, its hash, its shape, the link |
| `apps/web/src/lib/document-requests/customer-upload.ts` (+ test) | bis-crm | the public rule: resolve a token, the customer start and finish, the page's per-file states |
| `apps/web/src/lib/document-requests/request-task.ts` (+ test) | bis-crm | the work-queue To-do's title and opening |
| `apps/web/src/lib/document-requests/customer-state.ts` (+ test) | bis-crm | browser-safe: a customer file's state, its words' keys, the page's re-read schedule |
| `apps/web/src/app/api/d/[token]/start/route.ts`, `…/finish/route.ts` (+ tests) | bis-crm | the two public routes |
| `apps/web/src/lib/document-requests/deliver.ts` (+ test) | bis-comms | text or email through the gate, hold, release, the log row, the conversation row |
| `apps/web/src/lib/email/templates/document-request.ts` (+ test) | bis-comms | the branded email |
| `…/contacts/document-requests-actions.ts` (+ test) | bis-crm | create, copy link, revoke, undo revoke |
| `…/api/contacts/[contactId]/document-requests/route.ts`, `…/api/groups/[groupId]/document-requests/route.ts` (+ tests) | bis-crm | the card's open requests and the channels on offer |
| `apps/web/src/lib/document-requests/requests-load.ts` (+ test) | bis-crm | browser-safe parser of that route's answer |
| `…/contacts/document-request-dialog.tsx`, `…/contacts/document-requests-list.tsx` (+ tests) | bis-frontend | the dialog and the card's open requests |
| `apps/web/src/app/d/[token]/{layout.tsx,page.tsx,data.ts,customer-upload-list.tsx}` (+ tests) | bis-frontend | the customer's page |
| `apps/web/src/lib/document-requests/customer-client.ts` (+ test) | bis-frontend | browser: one customer file's journey (prepare, start, PUT with one retry, finish) |
| `apps/web/e2e/document-requests.spec.ts` | bis-e2e-qa | the staff dialog, the customer page end to end without Clerk, the virus path, a revoked link |

**Modified:** `packages/db/src/{documents,document-rules,record,activities,index,automation-log}.ts` and their tests; six db tests (Pinned tests); `apps/web/src/lib/record/{author-mark,timeline-rows,recent-rows}.ts` (+ tests); both timelines (+ tests); `…/contacts/contact-drawer.tsx` (`ROW_ICON`); `apps/web/src/lib/contacts/drawer-summary.ts` (`ROW_KINDS`) (+ test); `…/summary/route.reads.test.ts`; `apps/web/src/lib/messages.ts`, `messages.test.ts`; `apps/web/src/lib/documents/{upload-client,scan-version,documents-load}.ts` (+ tests); `…/contacts/documents-actions.ts`; `…/contacts/{documents-card.tsx,documents-card-handlers.ts}` (+ tests); the styleguide demo (+ test); `apps/web/src/lib/consent/{classes.ts,scans.test.ts}`; `apps/web/src/lib/automations/{log-titles.ts,passes/release-held.ts}`; `…/accounts/[accountId]/in-account-service-reads.test.ts`; `apps/web/src/proxy.ts` (+ test); `.env.example`; `apps/web/src/lib/i18n/{catalogue,ratchet}-baseline.json`.

## Task list, owners, order

| # | Task | Owner | Review | Depends on | Files |
|---|---|---|---|---|---|
| 0 | Confirm the base; rule on deviation 1 | orchestrator | n/a | — | none |
| 1 | Migration 0080 and its proof on the replica; the six pinned db tests; the kit | bis-db-schema | **opus** | 0 | the migration, `document-requests-schema.test.ts`, six db tests, `<SCRATCH>/s07d-kit/*` |
| 2 | Every key (**messages.ts, the only writer**) | bis-crm | sonnet | 0 | `lib/messages.ts`, `lib/messages.test.ts` |
| 3 | `@bis/db`: the request module, the `customer` source, the actor type | bis-crm | **opus** | 1 | `packages/db/src/{document-requests,documents,document-rules,index}.ts`, `test/document-requests.test.ts`, `test/documents.test.ts` |
| 3b | The timeline: the request row, the customer mark, the request To-do's mark | bis-crm | **opus** | 1, 2, 3 | `record.ts`, `activities.ts`, their tests, `timeline-merge.test.ts`, `lib/record/*`, both timelines, the drawer maps, `route.reads.test.ts` |
| 4 | The shared finish; the browser upload core; the card's read accepts `customer`; `scanVersion` opens the To-do | bis-crm | **opus** | 2, 3 | `lib/documents/{finish-upload,upload-core,upload-client,scan-version,documents-load}*`, `lib/document-requests/request-task*`, `…/contacts/documents-actions.ts` |
| 5 | The token, the public rule, the two public routes, the To-do | bis-crm | **opus** | 2, 3, 4 | `lib/document-requests/{token,customer-upload,customer-state}*`, `app/api/d/[token]/**` |
| 6 | Delivery: two kinds, the email, the hold and release, "What went out" | bis-comms | **opus** | 2, 3, 5 | `lib/consent/{classes.ts,scans.test.ts}`, `lib/document-requests/deliver*`, `lib/email/templates/document-request*`, `automation-log.ts`, `log-titles.ts`, `release-held.ts` |
| 6b | The lost-To-do reconcile in the scan pass | bis-automations | sonnet | 3, 4, 6 | `passes/documents-scan*`, `sentinel.test.ts`, `api/cron/reminders/route.test.ts` |
| 7 | Staff actions and the card's requests read | bis-crm | **opus** | 3, 5, 6 | `…/contacts/document-requests-actions*`, the two `document-requests` routes, `lib/document-requests/requests-load*`, the `ALLOWED` line |
| 8 | The card: Ask the customer, the dialog, open requests, the customer's files; `/styleguide` | bis-frontend | **opus** | 2, 4, 7 | `…/contacts/{documents-card,documents-card-handlers,document-request-dialog,document-requests-list}*`, `styleguide/documents-demo*` |
| 9 | The customer's page `/d/[token]` | bis-frontend | **opus** | 2, 4, 5 | `app/d/**`, `lib/document-requests/customer-client*` |
| 10 | The proxy carve-out; `.env.example`; the e2e link secret | bis-platform | sonnet | 0 | `proxy.ts`, `proxy.test.ts`, `.env.example`, `playwright.config.ts` (env lines) |
| 11 | Regenerate the i18n baselines | bis-crm | sonnet | 2, 3b, 8, 9 | `lib/i18n/*-baseline.json` |
| 12 | The e2e spec | bis-e2e-qa | sonnet | 8, 9, 10, 11 | `e2e/document-requests.spec.ts` |
| 13 | Whole-branch final review (checkpoint) | reviewer | **opus** | 1–12, 3b | none |
| 14 | Rollout (orchestrator; LAST) | orchestrator | n/a | 13 | none in the repo |

```
Wave A (three lanes):  T1 (bis-db-schema)          T2 (bis-crm)            T10 (bis-platform)
Wave B:                T3 (bis-crm, after T1)
Wave C (two lanes):    T3b (bis-crm, after T1-T3)  T4 (bis-crm 2nd instance, after T2, T3)
Wave D:                T5 (bis-crm, after T4)
Wave E (two lanes):    T6 (bis-comms, after T5)    T9 (bis-frontend, after T5)
Wave F (two lanes):    T7 (bis-crm, after T6)      T6b (bis-automations, after T6)      (T9 may still be running)
Wave G:                T8 (bis-frontend, after T7)
Wave H:                T11, then T12
Checkpoint:            T13
Rollout:               T14 (orchestrator, LAST)
```

Disjointness: T3b (`record.ts`, `activities.ts`, `lib/record/*`, the timelines, the drawer maps, the reads tests) and T4 (`lib/documents/*`, `documents-actions.ts`) share no file. T6 (consent, the email template, `deliver.ts`, the log source, title and releaser) and T9 (`app/d/**`, `customer-client.ts`) share no file. T7 (`document-requests-actions*`, the two routes, `requests-load*`, one `ALLOWED` line) and T9 share no file. T6b runs in Wave F, AFTER T6 (re-review R2): both may edit `apps/web/src/app/api/cron/reminders/route.test.ts` (T6 only to add a missing name to its bare `@bis/db` factory, T6b for `EMPTY_DOCUMENTS_SCAN` and `listRequestsMissingReceivedTask`); T6b and T7 share no file. T10 touches only `proxy*`, `.env.example` and two env lines of `playwright.config.ts`. **0080 goes to bis-ci only AFTER Task 13 approves** (orchestrator ruling, as 2a did with 0079): a finding in the final review that changes 0080 must not need a second migration. Until then the e2e job's migration check is red on every push, expected and named in each CI reading. 0080 drops a column, but no deployed code names it: 2a's build stopped writing and reading `documents.scan_status` (`documents.ts:113-121`; `DOC_COLS` at `:38-39` has none), so 0080 may apply to production BEFORE the merge like every other migration; Task 14 step 4 re-proves that against the deployed `main` first.

---

## Task 0: Confirm the base; rule on deviation 1 (orchestrator)

- [ ] **Step 1.** In `<WT>`: `git log --oneline -2` shows the plan commit, then `3eb5b246 Every stored file is scanned for viruses …`. `git fetch origin && git log --oneline origin/main -1`; if `main` moved past `3eb5b246`, `git merge origin/main` (never rebase in the shared tree) and re-run Step 2.
- [ ] **Step 1b.** `pnpm install --frozen-lockfile` in `<WT>` if `node_modules` is absent.
- [ ] **Step 2.** Confirm, and stop if any line differs:
  - `ls packages/db/supabase/migrations | tail -1` → `0079_document_scan.sql`; `git log --all --oneline -- 'packages/db/supabase/migrations/0080*'` → nothing.
  - `git grep -n "scan_status" -- apps/web/src packages/db/src ':!*.test.ts' ':!packages/db/src/test'` → hits only in `packages/db/src/documents.ts` (the version type, `VERSION_COLS`, the gate, the pending reads, `SCAN_TIMELINE_COLS`, and the `:113` comment), `apps/web/src/lib/documents/document-view.ts` and `apps/web/src/lib/record/timeline-rows.ts`, every one a VERSION's column; none reads `documents.scan_status`.
  - `grep -n '"documents.viewer.passwordRemoved.es"' apps/web/src/lib/messages.ts` → `4021:`; `wc -l < apps/web/src/lib/messages.test.ts` → `297`.
  - `grep -n 'u/|' apps/web/src/proxy.ts` → the matcher line carrying `"/((?!_next|c/|f/|b/|u/|.*\\..*).*)"`.
  - `grep -n "const MEASURED = 25" "apps/web/src/app/api/accounts/[accountId]/contacts/[contactId]/summary/route.reads.test.ts"` → `61:`.
  - `grep -n 'v.source === "upload" || v.source === "camera"' apps/web/src/lib/documents/documents-load.ts` → `56:`.
  - `grep -n "await scanVersion(svc" "apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/contacts/documents-actions.ts"` → `281:`.
  - `grep -n '"textback",' packages/db/src/automation-log.ts` → `27:`; `grep -n "'textback'));" packages/db/supabase/migrations/0054_consent_ledger.sql` → `129:`.
  - `grep -n '"staff.composer_sms"' apps/web/src/lib/consent/classes.ts` → one line.
  - `ls <KITSRC>/postgrest.exe <KITSRC>/make-jwt.js <KITSRC>/proxy.mjs "<SCRATCH>/s07c-kit/replica.sh" "<SCRATCH>/s07c-kit/pgrst.sh"` → all five exist.
- [x] **Step 3. Deviation 1. DONE 2026-10-15:** the orchestrator ACCEPTED the derived token, with `DOCUMENT_LINK_SECRET` required (ruling I10).
- [ ] **Step 4. The local secret.** The orchestrator (never an agent) adds `DOCUMENT_LINK_SECRET=<a fresh random value>` to danlo's `apps/web/.env.local` (generated with `node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"`, never printed into the ledger), so a local dev server can mint links. Unit tests and Playwright set their own fixture value (Task 10).

---

## Task 1: Migration 0080 and its proof on the replica; the six pinned db tests; the kit (bis-db-schema)

**Review:** opus. **Runs beside:** Tasks 2 and 10. **Scratch:** `<SCRATCH>/s07d-t1-impl/`, replica port `55580` (reviewer `s07d-t1-review/`, `55581`).

**Files**
- Create: `<SCRATCH>/s07d-kit/replica.sh`, `<SCRATCH>/s07d-kit/pgrst.sh` (outside the repo; "The replica kit")
- Create: `packages/db/supabase/migrations/0080_document_requests.sql`
- Create: `packages/db/src/test/document-requests-schema.test.ts`
- Modify: `packages/db/src/test/{document-space-used,document-vault-reserve-lock,document-vault-rls,document-vault-schema,documents,document-scan}.test.ts` (the `documents.scan_status` lines; `document-vault-schema.test.ts:107-108`'s source comparison; Pinned tests), `packages/db/src/test/automations-b-schema.test.ts:168-187` (the source CHECK's text; Pinned tests)

**Interfaces**
- Consumes (SQL): `public.documents`, `public.document_versions` (0077, 0079); `public.reserve_document_version` (0077:166-191); `public.mark_document_version_ready` (0077:199-223); `public.record_document_scan` (0079); `app.is_agency()`, `app.current_account_id()`, `app.sees_all_customers()`, `app.my_contact_ids()`, `app.my_client_group_ids()` (0077:133-138); `app.tidy_text(text, int)` (`0071_places_and_equipment.sql:29`); `app.keep_task_links()` (0074:44-60); `automation_log_source_check` (0054:123-129).
- Produces (SQL); every name below is read by a later task:
  - `documents.scan_status` gone. `documents_source_check`: `source in ('upload', 'camera', 'customer')`. `documents.request_id uuid`, `documents.request_item_key text`; `documents_request_coherent`: `(request_id is null) = (request_item_key is null)` and `(source = 'customer') = (request_id is not null)` and `(source <> 'customer' or created_by = 'customer:' || request_id::text)`; FK `documents_request_fkey (account_id, request_id) → document_requests (account_id, id)`; index `documents_by_request`.
  - `public.document_requests`: `id uuid primary key` (NO default: the app mints it, deviation 1), `account_id`, `contact_id`, `client_group_id`, `items jsonb`, `language`, `token_hash`, `channel`, `created_by`, `created_at`, `expires_at`, `revoked_at`, `revoked_by`, `completed_at` (spec §4.1 exactly), plus `sent_at` (the at-most-once send stamp, re-review R1; null until a text or email is handed to the provider). RLS on; `authenticated` SELECT under `document_requests_member_read` + `document_requests_technician_scope`; `service_role` all.
  - `app.document_request_items_ok(jsonb) returns boolean` (immutable).
  - `public.start_document_request_upload(p_account_id uuid, p_request_id uuid, p_item_key text, p_bytes bigint, p_content_type text, p_original_name text, p_title text) returns jsonb`, SECURITY INVOKER, EXECUTE for `service_role` only. Answers `{"status":"ok","version_id","storage_path","used","document_id"}` or `{"status": "not_found" | "revoked" | "completed" | "expired" | "no_item" | "rate_limited" | "over_quota" | "too_large"}` (`over_quota` also carries `used`); raises `22004` on a null required argument.
  - `app.document_request_on_clean()` and trigger `document_versions_request_on_clean`.
  - `automation_log_source_check` gains `'document_request'`.
  - `tasks.document_request_id`, `tasks.document_request_kind` (`received` | `storage_full`), `tasks_document_request_coherent`, unique index `tasks_document_request_once`, and `app.keep_task_links()` re-created to cover both.

- [ ] **Step 1: Build the kit.** `mkdir -p <SCRATCH>/s07d-kit`; then

```bash
S=/c/Users/danlo/AppData/Local/Temp/claude/C--Users-danlo-bis-platform/f54a0255-9568-420c-ad87-a4d62d6b9a05/scratchpad
sed -e 's#/worktrees/s07-2a#/worktrees/s07-2b#' -e 's#\*0079_\*#*0080_*#' -e 's#0079_document_scan.sql#0080_document_requests.sql#g' \
    -e 's#post = pre + 0079#post = pre + 0080#' -e 's#0079 FAILED#0080 FAILED#' -e 's#(no 0079 yet)#(no 0080 yet)#' \
    "$S/s07c-kit/replica.sh" > "$S/s07d-kit/replica.sh"
sed -e 's#s07c-local-postgrest#s07d-local-postgrest#' "$S/s07c-kit/pgrst.sh" > "$S/s07d-kit/pgrst.sh"
diff "$S/s07c-kit/replica.sh" "$S/s07d-kit/replica.sh"; diff "$S/s07c-kit/pgrst.sh" "$S/s07d-kit/pgrst.sh"
```
Paste both diffs: only the lines named in "The replica kit" differ. Run `bash "$S/s07d-kit/replica.sh" 55580 "$S/s07d-t1-impl"` → `post = pre (no 0080 yet)`. Run the faithfulness query on `pre` and on bis-ci; paste both; stop if they differ.

- [ ] **Step 2: Read before writing.** `sed -n 30,60p packages/db/supabase/migrations/0046_automation_log.sql` (the NOT NULL columns of `automation_log`; the test below inserts `account_id, source, channel, subject_key, status, held_until` and assumes nothing else is required without a default: if `contact_id` or another column is, add it to both inserts and say so) and `sed -n 40,64p packages/db/supabase/migrations/0074_*.sql` (the guard 0080 re-creates).

- [ ] **Step 3: Write the failing test** `packages/db/src/test/document-requests-schema.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import type { Client } from "pg";
import { withRollback, actAs } from "./db";

/**
 * 0080 (S-07 2b, spec 4.1, 4.4, 4.5): the request table and its checks, who reads it, the one start
 * function (the request re-proved open under its lock, today's starts, the record and the category
 * taken from the request, the quota through reserve_document_version), the completion trigger, the
 * task links and their guard, the log source, and the retired documents.scan_status. Its own seed,
 * in the vault RLS suite's shape (document-vault-rls.test.ts:22-58).
 */
const RUN = Math.random().toString(36).slice(2, 10);
const ORG = `org_drq_${RUN}`;
const ORG_B = `org_drqb_${RUN}`;
const SUB = { owner: `u_dr_owner_${RUN}`, tech: `u_dr_tech_${RUN}`, tech2: `u_dr_tech2_${RUN}`, ownerB: `u_dr_ownerb_${RUN}` } as const;
const HASH = (n: number) => n.toString(16).padStart(64, "0");
const ITEMS = JSON.stringify([{ key: "insurance", category: "insurance", note: null }, { key: "other", category: "other", note: "Pool permit" }]);

async function attempt<T extends object = Record<string, unknown>>(c: Client, sql: string, args: unknown[] = []) {
  await c.query("savepoint s");
  try {
    const r = await c.query<T>(sql, args);
    await c.query("release savepoint s");
    return r;
  } catch (e) {
    await c.query("rollback to savepoint s");
    throw e;
  }
}
async function one(c: Client, sql: string, args: unknown[]): Promise<string> {
  return (await c.query<{ id: string }>(sql, args)).rows[0]!.id;
}

async function seed(c: Client) {
  const { rows: [agency] } = await c.query<{ id: string }>("select id from agencies limit 1");
  const acct = await one(c, "insert into accounts (agency_id, clerk_org_id, name, client_access_enabled) values ($1,$2,'DRQ Co',true) returning id", [agency!.id, ORG]);
  const acctB = await one(c, "insert into accounts (agency_id, clerk_org_id, name, client_access_enabled) values ($1,$2,'DRQ B',true) returning id", [agency!.id, ORG_B]);
  const u = {} as Record<keyof typeof SUB, string>;
  for (const k of Object.keys(SUB) as (keyof typeof SUB)[]) u[k] = await one(c, "insert into users (clerk_user_id, email) values ($1, $1 || '@example.com') returning id", [SUB[k]]);
  await c.query(
    "insert into memberships (user_id, scope, account_id, role) values ($1,'account',$5,'owner'), ($2,'account',$5,'technician'), ($3,'account',$5,'technician'), ($4,'account',$6,'owner')",
    [u.owner, u.tech, u.tech2, u.ownerB, acct, acctB]);
  const ana = await one(c, "insert into contacts (account_id, first_name, assigned_to) values ($1,'Ana',$2) returning id", [acct, u.tech]);
  const bo = await one(c, "insert into contacts (account_id, first_name, assigned_to) values ($1,'Bo',$2) returning id", [acct, u.tech2]);
  const casa = await one(c, "insert into client_groups (account_id, kind, name) values ($1,'household','Casa Ana') returning id", [acct]);
  await c.query("insert into client_group_members (account_id, client_group_id, contact_id, is_primary) values ($1,$2,$3,true)", [acct, casa, ana]);
  return { acct, acctB, ana, bo, casa };
}

type Req = { contact_id?: string | null; client_group_id?: string | null; items?: string; language?: string;
  token_hash?: string; channel?: string; created_at?: string; revoked?: boolean; completed?: boolean };
let hashN = 1;
async function request(c: Client, acct: string, r: Req): Promise<string> {
  const created = r.created_at ?? new Date().toISOString();
  const { rows: [row] } = await attempt<{ id: string }>(c,
    `insert into document_requests (id, account_id, contact_id, client_group_id, items, language, token_hash, channel, created_by,
                                    created_at, expires_at, revoked_at, revoked_by, completed_at)
     values (gen_random_uuid(), $1, $2, $3, $4::jsonb, $5, $6, $7, 'user_seed', $8::timestamptz, $8::timestamptz + interval '7 days',
             case when $9 then now() end, case when $9 then 'user_seed' end, case when $10 then now() end) returning id`,
    [acct, r.contact_id === undefined ? null : r.contact_id, r.client_group_id ?? null, r.items ?? ITEMS, r.language ?? "es",
     r.token_hash ?? HASH(hashN++), r.channel ?? "link", created, r.revoked ?? false, r.completed ?? false]);
  return row!.id;
}
type Started = { status: string; document_id?: string; version_id?: string };
const start = async (c: Client, acct: string, req: string, key = "insurance", bytes = 10): Promise<Started> =>
  (await attempt<{ r: Started }>(c,
    "select public.start_document_request_upload($1, $2, $3, $4, 'application/pdf', 'scan.pdf', 'Seguro') as r", [acct, req, key, bytes])).rows[0]!.r;
const ready = (c: Client, acct: string, s: Started) =>
  c.query("select public.mark_document_version_ready($1, $2, $3, 10, $4)", [acct, s.document_id, s.version_id, "a".repeat(64)]);
const verdict = (c: Client, acct: string, versionId: string, v: string) =>
  c.query("select public.record_document_scan($1, $2, $3, $4)", [acct, versionId, v, v === "infected" ? "Eicar-Test-Signature" : null]);

describe("0080: documents.scan_status is gone; customer is a source (spec 3.2 as amended, 4.1)", () => {
  it("the retired column no longer exists (mutation: drop the DROP COLUMN statement -> FAILS)", () =>
    withRollback(async (c) => {
      const { rows: [r] } = await c.query<{ n: string }>(
        "select count(*)::text as n from information_schema.columns where table_schema='public' and table_name='documents' and column_name='scan_status'");
      expect(r!.n).toBe("0");
    }));

  it("a customer document needs its request, its item and 'customer:<request id>' as its author, and nothing else may claim the source (mutation: drop any clause of documents_request_coherent -> FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      const req = await request(c, s.acct, { contact_id: s.ana });
      const ins = (source: string, createdBy: string, reqId: string | null, key: string | null) => attempt(c,
        "insert into documents (account_id, contact_id, title, category, source, created_by, request_id, request_item_key) values ($1,$2,'X','insurance',$3,$4,$5,$6)",
        [s.acct, s.ana, source, createdBy, reqId, key]);
      await ins("customer", `customer:${req}`, req, "insurance");
      for (const [source, by, reqId, key] of [
        ["customer", "user_seed", req, "insurance"], ["customer", `customer:${req}`, null, null], ["upload", "user_seed", req, "insurance"],
        ["customer", `customer:${req}`, req, null],
      ] as const) {
        await expect(ins(source, by, reqId, key)).rejects.toMatchObject({ code: "23514", constraint: "documents_request_coherent" });
      }
      await expect(ins("fax", "user_seed", null, null)).rejects.toMatchObject({ code: "23514", constraint: "documents_source_check" });
    }));
});

describe("0080: document_requests checks (spec 4.1)", () => {
  it("items: 1 to 9, key = category, one of the nine, distinct, a note only on other and at most 80 characters (mutations: drop the 9-item bound, the key = category clause, or the note rule from app.document_request_items_ok -> FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      const eight = ["id", "contract", "estimate", "invoice", "photo", "permit", "insurance", "warranty"].map((k) => ({ key: k, category: k, note: null }));
      const other = { key: "other", category: "other", note: "x" };
      await request(c, s.acct, { contact_id: s.ana, items: JSON.stringify([...eight, other]) });
      for (const items of [
        "[]",
        JSON.stringify([...eight, other, { key: "id2", category: "id", note: null }]),
        JSON.stringify([{ key: "id", category: "insurance", note: null }]),
        JSON.stringify([{ key: "receipt", category: "receipt", note: null }]),
        JSON.stringify([{ key: "id", category: "id", note: null }, { key: "id", category: "id", note: null }]),
        JSON.stringify([{ key: "id", category: "id", note: "why" }]),
        JSON.stringify([{ key: "other", category: "other", note: null }]),
        JSON.stringify([{ key: "other", category: "other", note: "x".repeat(81) }]),
        JSON.stringify([{ key: "id", category: "id" }]),
        JSON.stringify({ key: "id", category: "id", note: null }),
      ]) {
        await expect(request(c, s.acct, { contact_id: s.ana, items })).rejects.toMatchObject({ code: "23514", constraint: "document_requests_items_check" });
      }
    }));

  it("exactly one record, a unique 64-hex token hash, a known channel and language, expiry = created + 7 days, revoke coherent (mutation: drop any one of these constraints -> FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      await request(c, s.acct, { contact_id: s.ana, token_hash: HASH(900) });
      await expect(request(c, s.acct, { contact_id: s.ana, token_hash: HASH(900) })).rejects.toMatchObject({ code: "23505", constraint: "document_requests_token_hash_key" });
      await expect(request(c, s.acct, { contact_id: s.ana, client_group_id: s.casa })).rejects.toMatchObject({ code: "23514", constraint: "document_requests_one_record" });
      await expect(request(c, s.acct, { contact_id: null })).rejects.toMatchObject({ code: "23514", constraint: "document_requests_one_record" });
      await expect(request(c, s.acct, { contact_id: s.ana, token_hash: "XYZ" })).rejects.toMatchObject({ code: "23514", constraint: "document_requests_token_hash_check" });
      await expect(request(c, s.acct, { contact_id: s.ana, channel: "fax" })).rejects.toMatchObject({ code: "23514", constraint: "document_requests_channel_check" });
      await expect(request(c, s.acct, { contact_id: s.ana, language: "fr" })).rejects.toMatchObject({ code: "23514", constraint: "document_requests_language_check" });
      await expect(attempt(c, "update document_requests set expires_at = expires_at + interval '1 day' where account_id = $1", [s.acct]))
        .rejects.toMatchObject({ code: "23514", constraint: "document_requests_expiry" });
      await expect(attempt(c, "update document_requests set revoked_at = now() where account_id = $1", [s.acct]))
        .rejects.toMatchObject({ code: "23514", constraint: "document_requests_revoke_coherent" });
    }));
});

describe("0080: the at-most-once send stamp (re-review R1)", () => {
  it("sent_at exists, is nullable and starts null (mutation: drop the column or give it a default -> FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      const req = await request(c, s.acct, { contact_id: s.ana });
      const { rows: [r] } = await c.query<{ sent_at: string | null }>("select sent_at from document_requests where id = $1", [req]);
      expect(r!.sent_at).toBeNull();
    }));
});

describe("0080: who reads a request (spec 4.1: members, under the record's visibility, as documents)", () => {
  it.each([
    ["owner", ["Ana", "Bo", "Casa Ana"]], ["tech", ["Ana", "Casa Ana"]], ["tech2", ["Bo"]], ["ownerB", []],
  ] as const)("%s reads %j (mutations: drop document_requests_technician_scope -> tech reads Bo -> FAILS; drop member_read's account clause -> ownerB reads -> FAILS)", (who, want) =>
    withRollback(async (c) => {
      const s = await seed(c);
      await request(c, s.acct, { contact_id: s.ana });
      await request(c, s.acct, { contact_id: s.bo });
      await request(c, s.acct, { contact_id: null, client_group_id: s.casa });
      await actAs(c, { org_id: who === "ownerB" ? ORG_B : ORG, sub: SUB[who] });
      const { rows } = await c.query<{ who: string }>(
        `select coalesce(ct.first_name, g.name) as who from document_requests r
           left join contacts ct on ct.id = r.contact_id left join client_groups g on g.id = r.client_group_id order by 1`);
      expect(rows.map((r) => r.who)).toEqual(want);
    }));

  it("the client role can write nothing and cannot run the start function (mutation: grant insert or update to authenticated, or execute on the function -> FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      const req = await request(c, s.acct, { contact_id: s.ana });
      await actAs(c, { org_id: ORG, sub: SUB.owner });
      await expect(attempt(c, "update document_requests set revoked_at = now(), revoked_by = 'x' where id = $1", [req])).rejects.toMatchObject({ code: "42501" });
      await expect(attempt(c,
        "insert into document_requests (id, account_id, contact_id, items, language, token_hash, channel, created_by, expires_at) values (gen_random_uuid(), $1, $2, $3::jsonb, 'en', $4, 'link', 'x', now() + interval '7 days')",
        [s.acct, s.ana, ITEMS, HASH(77)])).rejects.toMatchObject({ code: "42501" });
      await expect(attempt(c, "select public.start_document_request_upload($1, $2, 'insurance', 10, 'application/pdf', 'a.pdf', 'X')", [s.acct, req]))
        .rejects.toMatchObject({ code: "42501" });
    }));
});

describe("0080: start_document_request_upload (spec 4.4)", () => {
  it("files the upload on the REQUEST's record under the ITEM's category, as the customer, Owners-only off (mutations: take the category from the title; set owners_only true; take the record from an argument -> FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      const req = await request(c, s.acct, { contact_id: s.ana });
      const r = await start(c, s.acct, req, "other");
      expect(r.status).toBe("ok");
      const { rows: [d] } = await c.query("select contact_id, client_group_id, category, source, created_by, owners_only, request_id, request_item_key, title from documents where id = $1", [r.document_id]);
      expect(d).toEqual({ contact_id: s.ana, client_group_id: null, category: "other", source: "customer", created_by: `customer:${req}`, owners_only: false, request_id: req, request_item_key: "other", title: "Seguro" });
      const { rows: [v] } = await c.query("select uploaded_by, status, scan_status, original_name from document_versions where id = $1", [r.version_id]);
      expect(v).toEqual({ uploaded_by: `customer:${req}`, status: "uploading", scan_status: "pending", original_name: "scan.pdf" });
      const g = await request(c, s.acct, { contact_id: null, client_group_id: s.casa });
      const rg = await start(c, s.acct, g, "insurance");
      const { rows: [dg] } = await c.query("select contact_id, client_group_id from documents where id = $1", [rg.document_id]);
      expect(dg).toEqual({ contact_id: null, client_group_id: s.casa });
    }));

  it("refuses another account's request, an unknown item, and a revoked, completed or expired request, writing nothing (mutation: drop the account filter, or any one state check -> FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      const open = await request(c, s.acct, { contact_id: s.ana });
      const old = new Date(Date.now() - 8 * 86_400_000).toISOString();
      const cases: [string, string, string, string][] = [
        [s.acctB, open, "insurance", "not_found"],
        [s.acct, open, "warranty", "no_item"],
        [s.acct, await request(c, s.acct, { contact_id: s.ana, revoked: true }), "insurance", "revoked"],
        [s.acct, await request(c, s.acct, { contact_id: s.ana, completed: true }), "insurance", "completed"],
        [s.acct, await request(c, s.acct, { contact_id: s.ana, created_at: old }), "insurance", "expired"],
      ];
      for (const [acct, req, key, want] of cases) expect([want, (await start(c, acct, req, key)).status]).toEqual([want, want]);
      const { rows: [n] } = await c.query<{ n: string }>("select count(*)::text as n from documents where account_id = $1", [s.acct]);
      expect(n!.n).toBe("0");
    }));

  it("the 21st start of a UTC day is rate_limited; yesterday's starts do not count (mutation: count every start ever, or allow 21 -> FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      const req = await request(c, s.acct, { contact_id: s.ana });
      const first = await start(c, s.acct, req);
      await c.query("update document_versions set created_at = date_trunc('day', now(), 'UTC') - interval '1 minute' where id = $1", [first.version_id]);
      for (let i = 0; i < 20; i++) expect((await start(c, s.acct, req)).status).toBe("ok");
      expect((await start(c, s.acct, req)).status).toBe("rate_limited");
    }));

  it("over quota answers over_quota and too large answers too_large, each leaving no document behind (mutation: keep the document on a refused reservation -> FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      const req = await request(c, s.acct, { contact_id: s.ana });
      const big = await one(c, "insert into documents (account_id, contact_id, title, category, source, created_by) values ($1,$2,'Big','other','upload','user_seed') returning id", [s.acct, s.ana]);
      for (let i = 0; i < 204; i++) await c.query("select public.reserve_document_version($1, $2, 26214400, 'application/pdf', 'b.pdf', 'user_seed')", [s.acct, big]);
      expect((await start(c, s.acct, req, "insurance", 26_214_400)).status).toBe("over_quota");
      expect((await start(c, s.acct, req, "insurance", 26_214_401)).status).toBe("too_large");
      const { rows: [n] } = await c.query<{ n: string }>("select count(*)::text as n from documents where request_id = $1", [req]);
      expect(n!.n).toBe("0");
    }));
});

describe("0080: the request completes on its last clean file (spec 4.5)", () => {
  it("the decisive clean verdict completes the request only when EVERY other item has a ready, CLEAN file: a ready-pending or ready-infected file does not answer its item (plan review I1; mutation: drop 'and v.scan_status = ''clean''' from the trigger -> Insurance's verdict completes it -> FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      const req = await request(c, s.acct, { contact_id: s.ana });
      const done = async () => (await c.query<{ c: boolean }>("select completed_at is not null as c from document_requests where id = $1", [req])).rows[0]!.c;
      // Item Y (other) holds ONLY a ready-infected and a ready-pending file.
      const bad = await start(c, s.acct, req, "other");
      await ready(c, s.acct, bad);
      await verdict(c, s.acct, bad.version_id!, "infected");
      const waiting = await start(c, s.acct, req, "other");
      await ready(c, s.acct, waiting);
      // The decisive verdict: item X (insurance) gets a clean file. Y has ready files, none clean.
      const a = await start(c, s.acct, req, "insurance");
      await ready(c, s.acct, a);
      await verdict(c, s.acct, a.version_id!, "clean");
      expect(await done()).toBe(false);
      // Y's pending file turns clean: now every item is answered.
      await verdict(c, s.acct, waiting.version_id!, "clean");
      expect(await done()).toBe(true);
    }));

  it("a trashed clean file does not answer its item (mutation: drop 'and d.deleted_at is null' from the trigger -> FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      const req = await request(c, s.acct, { contact_id: s.ana });
      const done = async () => (await c.query<{ c: boolean }>("select completed_at is not null as c from document_requests where id = $1", [req])).rows[0]!.c;
      const a = await start(c, s.acct, req, "insurance");
      await ready(c, s.acct, a);
      await verdict(c, s.acct, a.version_id!, "clean");
      await c.query("update documents set deleted_at = now(), deleted_by = 'user_seed' where id = $1", [a.document_id]);
      const b = await start(c, s.acct, req, "other");
      await ready(c, s.acct, b);
      await verdict(c, s.acct, b.version_id!, "clean");
      expect(await done()).toBe(false);
    }));

  it("a staff document's clean verdict touches no request (mutation: drop the request_id-is-null early return -> FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      const req = await request(c, s.acct, { contact_id: s.ana, items: JSON.stringify([{ key: "insurance", category: "insurance", note: null }]) });
      const d = await one(c, "insert into documents (account_id, contact_id, title, category, source, created_by) values ($1,$2,'Mine','insurance','upload','user_seed') returning id", [s.acct, s.ana]);
      const { rows: [r] } = await c.query<{ r: { version_id: string } }>("select public.reserve_document_version($1, $2, 10, 'application/pdf', 'a.pdf', 'user_seed') as r", [s.acct, d]);
      await ready(c, s.acct, { status: "ok", document_id: d, version_id: r!.r.version_id });
      await verdict(c, s.acct, r!.r.version_id, "clean");
      const { rows: [q] } = await c.query<{ open: boolean }>("select completed_at is null as open from document_requests where id = $1", [req]);
      expect(q!.open).toBe(true);
    }));
});

describe("0080: the request's work-queue To-do (spec 4.5; deviation 4)", () => {
  it("one per request and kind; a client-role insert cannot set the links and an update cannot change them (mutations: drop the unique index, or either keep_task_links line -> FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      const req = await request(c, s.acct, { contact_id: s.ana });
      const task = (kind: string) => attempt<{ id: string }>(c,
        "insert into tasks (account_id, contact_id, title, document_request_id, document_request_kind) values ($1,$2,'T',$3,$4) returning id", [s.acct, s.ana, req, kind]);
      const t1 = (await task("received")).rows[0]!;
      await task("storage_full");
      await expect(task("received")).rejects.toMatchObject({ code: "23505", constraint: "tasks_document_request_once" });
      await expect(attempt(c, "insert into tasks (account_id, title, document_request_id) values ($1,'T',$2)", [s.acct, req]))
        .rejects.toMatchObject({ code: "23514", constraint: "tasks_document_request_coherent" });
      await expect(task("lost")).rejects.toMatchObject({ code: "23514", constraint: "tasks_document_request_kind_check" });
      await actAs(c, { org_id: ORG, sub: SUB.owner });
      const { rows: [mine] } = await c.query<{ document_request_id: string | null; document_request_kind: string | null }>(
        "insert into tasks (account_id, contact_id, title, document_request_id, document_request_kind) values ($1,$2,'Forged',$3,'received') returning document_request_id, document_request_kind",
        [s.acct, s.ana, req]);
      expect(mine).toEqual({ document_request_id: null, document_request_kind: null });
      const { rows: [kept] } = await c.query<{ document_request_kind: string }>(
        "update tasks set document_request_kind = 'storage_full', title = 'T2' where id = $1 returning document_request_kind", [t1.id]);
      expect(kept!.document_request_kind).toBe("received");
    }));
});

describe("0080: automation_log knows the document_request source (spec 4.2; deviation 11)", () => {
  it("a held document_request row is accepted; an unknown source is not (mutation: leave the source out of the CHECK -> FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      await attempt(c, "insert into automation_log (account_id, source, channel, subject_key, status, held_until) values ($1,'document_request','sms','document_request:x','held', now() + interval '1 hour')", [s.acct]);
      await expect(attempt(c, "insert into automation_log (account_id, source, channel, subject_key, status) values ($1,'document_requests','sms','x','sent')", [s.acct]))
        .rejects.toMatchObject({ code: "23514", constraint: "automation_log_source_check" });
    }));
});
```

Note on the Technician case: `tech` is assigned Ana and reads Ana's household through `app.my_client_group_ids()` (the documents fence's own rule, 0077:135-138); if the replica shows otherwise for `Casa Ana`, read `app.my_client_group_ids()` and report: the expected list follows the function, not this plan.

- [ ] **Step 4: Run it to see it fail.** `cd packages/db && SUPABASE_DB_URL=postgresql://postgres@localhost:55580/post node node_modules/vitest/vitest.mjs run src/test/document-requests-schema.test.ts; echo $? > "$S/s07d-t1-impl/exit"`. Expected: every case FAILS (no table, no function, the column still there). Paste the summary block.

- [ ] **Step 5: Write the migration** `packages/db/supabase/migrations/0080_document_requests.sql` (ASCII only, no backslash):

```sql
-- 0080_document_requests.sql - the document vault, part 2b: customer upload links
-- (docs/superpowers/specs/2026-10-15-document-vault-part2-design.md section 4;
--  docs/superpowers/plans/2026-10-15-document-vault-pr2b.md)
--
-- Staff ask a customer for named documents; the customer uploads them through /d/<token> with no
-- sign-in. A request names 1 to 9 items (a category, or other with a note), lives 7 days, and is
-- reached by a token the database never stores: only its sha256 (token_hash). The app mints the
-- request id itself, because the token is derived from it (plan deviation 1).
-- A customer file is an ordinary document with source 'customer', created_by 'customer:<request id>',
-- linked to its request and item. Every customer start goes through ONE function that locks the
-- request, re-proves it open, counts today's starts, and creates the document and reserves its
-- version through 0077's reserve_document_version in one transaction, so the record and the
-- category always come from the request row, never from the browser.
-- A request completes when its last item gets a clean file: a trigger on the verdict, so the
-- finish and the retry pass both complete it.
-- Also: documents.scan_status (retired by 0079, unread and unwritten since 2a) is dropped FIRST;
-- automation_log gains the document_request source (quiet-hours holds, What went out); tasks gain
-- the request links for the one work-queue To-do per request and kind, guarded like call_id.
--
-- Rollback (by hand, in this order):
--   drop trigger document_versions_request_on_clean on public.document_versions;
--   drop function app.document_request_on_clean();
--   drop function public.start_document_request_upload(uuid, uuid, text, bigint, text, text, text);
--   re-create 0074's app.keep_task_links() exactly;
--   drop index public.tasks_document_request_once;
--   alter table public.tasks drop constraint tasks_document_request_coherent,
--     drop column document_request_kind, drop column document_request_id;
--   delete the document_request rows of automation_log, then re-add 0054's automation_log_source_check exactly;
--   delete the customer documents (their objects first), then
--   alter table public.documents drop constraint documents_request_coherent,
--     drop constraint documents_request_fkey, drop column request_item_key, drop column request_id;
--   re-add 0077's documents_source_check exactly;
--   drop table public.document_requests; drop function app.document_request_items_ok(jsonb);
--   alter table public.documents add column scan_status text not null default 'skipped'
--     constraint documents_scan_status_check check (scan_status in ('skipped', 'pending', 'clean', 'infected'));

-- 0. Fail fast instead of queueing behind a long lock on documents, tasks or automation_log (plan review I2):
--    the drop and the constraint swaps take ACCESS EXCLUSIVE locks, and a queued one blocks every later reader.
set local lock_timeout = '5s';

-- 1. The retired per-document scan state (0079 gave it a default; nothing reads or writes it).
alter table public.documents drop column scan_status;

-- 2. Items: 1 to 9, each {key, category, note}, key = category, distinct, a note only on other.
create function app.document_request_items_ok(p_items jsonb) returns boolean
language sql immutable set search_path = '' as $$
  select coalesce(
    jsonb_typeof(p_items) = 'array'
    and jsonb_array_length(p_items) between 1 and 9
    and (select bool_and(
          jsonb_typeof(e) = 'object'
          and e ? 'key' and e ? 'category' and e ? 'note'
          and jsonb_typeof(e -> 'key') = 'string'
          and e ->> 'key' = e ->> 'category'
          and e ->> 'category' in ('id', 'contract', 'estimate', 'invoice', 'photo', 'permit', 'insurance', 'warranty', 'other')
          and case when e ->> 'category' = 'other'
                   then jsonb_typeof(e -> 'note') = 'string'
                        and char_length(e ->> 'note') between 1 and 80
                        and app.tidy_text(e ->> 'note', 80)
                   else jsonb_typeof(e -> 'note') = 'null' end)
         from jsonb_array_elements(case when jsonb_typeof(p_items) = 'array' then p_items else '[]'::jsonb end) e)
    and (select count(distinct e ->> 'key') = jsonb_array_length(p_items)
         from jsonb_array_elements(case when jsonb_typeof(p_items) = 'array' then p_items else '[]'::jsonb end) e),
    false)
$$;
revoke all on function app.document_request_items_ok(jsonb) from public, anon;
grant execute on function app.document_request_items_ok(jsonb) to authenticated, service_role;

-- 3. The request. Server-written only; members read under the record's visibility (as documents).
create table public.document_requests (
  id uuid primary key,
  account_id uuid not null references public.accounts(id) on delete cascade,
  contact_id uuid,
  client_group_id uuid,
  items jsonb not null constraint document_requests_items_check check (app.document_request_items_ok(items)),
  language text not null constraint document_requests_language_check check (language in ('en', 'es')),
  token_hash text not null constraint document_requests_token_hash_key unique
    constraint document_requests_token_hash_check check (token_hash ~ '^[0-9a-f]{64}$'),
  channel text not null constraint document_requests_channel_check check (channel in ('text', 'email', 'link')),
  created_by text not null constraint document_requests_created_by_check check (btrim(created_by) <> ''),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  revoked_by text,
  completed_at timestamptz,
  -- The at-most-once send stamp (2b plan re-review R1): set just before a text or email is handed to the
  -- provider, cleared when that send did not go out; a held release skips a request that carries it.
  sent_at timestamptz,
  constraint document_requests_one_record check (num_nonnulls(contact_id, client_group_id) = 1),
  constraint document_requests_expiry check (expires_at = created_at + interval '7 days'),
  constraint document_requests_revoke_coherent check ((revoked_at is null) = (revoked_by is null)),
  constraint document_requests_contact_fkey foreign key (account_id, contact_id)
    references public.contacts (account_id, id) on delete cascade,
  constraint document_requests_group_fkey foreign key (account_id, client_group_id)
    references public.client_groups (account_id, id) on delete cascade,
  constraint document_requests_account_id_id_key unique (account_id, id)
);
create index document_requests_by_contact on public.document_requests (account_id, contact_id) where contact_id is not null;
create index document_requests_by_group on public.document_requests (account_id, client_group_id) where client_group_id is not null;
comment on table public.document_requests is
  'A request for documents sent to a customer (0080). Reached by /d/<token>; only sha256(token) is stored. Server-written only; authenticated reads under the record''s visibility. Expired once expires_at has passed (computed, never written).';

alter table public.document_requests enable row level security;
revoke all on public.document_requests from anon, authenticated;
grant select on public.document_requests to authenticated;
grant select, insert, update, delete on public.document_requests to service_role;
create policy document_requests_member_read on public.document_requests for select to authenticated
  using (app.is_agency() or account_id = app.current_account_id());
create policy document_requests_technician_scope on public.document_requests as restrictive for select to authenticated
  using ((select app.sees_all_customers(app.current_account_id()))
         or contact_id in (select app.my_contact_ids())
         or client_group_id in (select app.my_client_group_ids()));

-- 4. A customer file names its request and item; nothing else may claim the customer source.
alter table public.documents drop constraint documents_source_check;
alter table public.documents add constraint documents_source_check check (source in ('upload', 'camera', 'customer'));
alter table public.documents add column request_id uuid, add column request_item_key text;
alter table public.documents add constraint documents_request_coherent check (
  (request_id is null) = (request_item_key is null)
  and (source = 'customer') = (request_id is not null)
  and (source <> 'customer' or created_by = 'customer:' || request_id::text));
alter table public.documents add constraint documents_request_fkey foreign key (account_id, request_id)
  references public.document_requests (account_id, id);
create index documents_by_request on public.documents (account_id, request_id) where request_id is not null;

-- 5. The one start: the request locked and re-proved open, today's starts counted (UTC day), the
--    document created on the REQUEST's record under the ITEM's category, then 0077's reservation.
--    A refused reservation removes the document it just made. service_role only.
create function public.start_document_request_upload(
  p_account_id uuid, p_request_id uuid, p_item_key text, p_bytes bigint, p_content_type text,
  p_original_name text, p_title text)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare r public.document_requests%rowtype; v_item jsonb; v_today integer; v_doc uuid; v_res jsonb;
begin
  if p_account_id is null or p_request_id is null or p_item_key is null or p_bytes is null
     or p_content_type is null or p_title is null then
    raise exception 'start_document_request_upload: a required argument is null' using errcode = '22004';
  end if;
  if p_bytes < 1 or p_bytes > 26214400 then
    return jsonb_build_object('status', 'too_large');
  end if;
  select * into r from public.document_requests
   where id = p_request_id and account_id = p_account_id for no key update;
  if not found then return jsonb_build_object('status', 'not_found'); end if;
  if r.revoked_at is not null then return jsonb_build_object('status', 'revoked'); end if;
  if r.completed_at is not null then return jsonb_build_object('status', 'completed'); end if;
  if r.expires_at <= now() then return jsonb_build_object('status', 'expired'); end if;
  select e into v_item from jsonb_array_elements(r.items) e where e ->> 'key' = p_item_key;
  if v_item is null then return jsonb_build_object('status', 'no_item'); end if;
  select count(*) into v_today
    from public.document_versions v
    join public.documents d on d.id = v.document_id and d.account_id = v.account_id
   where d.account_id = p_account_id and d.request_id = p_request_id
     and v.created_at >= date_trunc('day', now(), 'UTC');
  if v_today >= 20 then return jsonb_build_object('status', 'rate_limited'); end if;
  insert into public.documents (account_id, contact_id, client_group_id, title, category, source, created_by,
                                owners_only, request_id, request_item_key)
  values (p_account_id, r.contact_id, r.client_group_id, p_title, v_item ->> 'category', 'customer',
          'customer:' || r.id::text, false, r.id, p_item_key)
  returning id into v_doc;
  v_res := public.reserve_document_version(p_account_id, v_doc, p_bytes, p_content_type, p_original_name,
                                           'customer:' || r.id::text);
  if v_res ->> 'status' <> 'ok' then
    delete from public.documents where id = v_doc and account_id = p_account_id;
    return v_res;
  end if;
  return v_res || jsonb_build_object('document_id', v_doc);
end $$;
revoke all on function public.start_document_request_upload(uuid, uuid, text, bigint, text, text, text)
  from public, anon, authenticated, service_role;
grant execute on function public.start_document_request_upload(uuid, uuid, text, bigint, text, text, text)
  to service_role;

-- 6. Completion: on a version's clean verdict, a customer file's request completes once every item
--    has a non-trashed document with a ready, clean version. The request row is locked first, so two
--    verdicts landing together serialise and the second sees the first. Plain, not definer: it runs
--    as the verdict's writer (service_role, 0079's record_document_scan).
create function app.document_request_on_clean() returns trigger
language plpgsql set search_path = '' as $$
declare v_req uuid; r public.document_requests%rowtype;
begin
  select d.request_id into v_req from public.documents d
   where d.id = new.document_id and d.account_id = new.account_id;
  if v_req is null then return null; end if;
  select * into r from public.document_requests
   where id = v_req and account_id = new.account_id for no key update;
  if not found or r.completed_at is not null then return null; end if;
  if not exists (
    select 1 from jsonb_array_elements(r.items) i
     where not exists (
       select 1 from public.documents d
         join public.document_versions v on v.document_id = d.id and v.account_id = d.account_id
        where d.account_id = r.account_id and d.request_id = r.id and d.request_item_key = i ->> 'key'
          and d.deleted_at is null and v.status = 'ready' and v.scan_status = 'clean')) then
    update public.document_requests set completed_at = now()
     where id = r.id and account_id = r.account_id and completed_at is null;
  end if;
  return null;
end $$;
revoke all on function app.document_request_on_clean() from public, anon;
grant execute on function app.document_request_on_clean() to service_role;
create trigger document_versions_request_on_clean
  after update of scan_status on public.document_versions
  for each row when (new.scan_status = 'clean' and old.scan_status is distinct from 'clean')
  execute function app.document_request_on_clean();

-- 7. Quiet-hours holds and What went out for the request's text or email.
alter table public.automation_log drop constraint automation_log_source_check;
alter table public.automation_log add constraint automation_log_source_check
  check (source in (
    'reminders', 'followups', 'review_request', 'no_show_nudge', 'sms_reminder',
    'instant_reply', 'weekly_report', 'concierge', 'voice',
    'appointment_confirm', 'referral_ask', 'reactivation', 'quote_followup',
    'textback', 'document_request'));

-- 8. The work-queue To-do: one per request and kind (received, storage_full). The client role can
--    neither set nor change the links (0074's guard, extended; create or replace keeps its ACL and
--    the tasks_keep_links trigger).
alter table public.tasks
  add column document_request_id uuid references public.document_requests(id) on delete cascade,
  add column document_request_kind text
    constraint tasks_document_request_kind_check check (document_request_kind in ('received', 'storage_full'));
alter table public.tasks add constraint tasks_document_request_coherent
  check ((document_request_id is null) = (document_request_kind is null));
create unique index tasks_document_request_once on public.tasks (document_request_id, document_request_kind)
  where document_request_id is not null;

create or replace function app.keep_task_links() returns trigger
language plpgsql set search_path = '' as $$
begin
  if coalesce(current_user = 'authenticated', false) then
    if tg_op = 'INSERT' then
      new.call_id := null;
      new.consent_event_id := null;
      new.document_request_id := null;
      new.document_request_kind := null;
    else
      new.call_id := old.call_id;
      new.consent_event_id := old.consent_event_id;
      new.document_request_id := old.document_request_id;
      new.document_request_kind := old.document_request_kind;
    end if;
  end if;
  return new;
end $$;
```

- [ ] **Step 5b: Read the lock line back.** `head -40 packages/db/supabase/migrations/0080_document_requests.sql | grep -n "lock_timeout"` shows `set local lock_timeout = '5s';` BEFORE the `drop column` line (plan review I2; a `set local` outside a transaction is a warning, not an error, and both the replica's `psql -1` and MCP `apply_migration` run the file in one transaction).

- [ ] **Step 6: ASCII and backslash check**, with a positive control:

```bash
node -e '
const fs=require("fs");const f="packages/db/supabase/migrations/0080_document_requests.sql";
const b=fs.readFileSync(f);let bad=0,bs=0;for(const x of b){if(x>127)bad++;if(x===92)bs++;}
const ctl=Buffer.from("a"+String.fromCharCode(92)+"b");let c=0;for(const x of ctl)if(x===92)c++;
console.log(JSON.stringify({nonAscii:bad,backslash:bs,control:c}));'
```
Expected `{"nonAscii":0,"backslash":0,"control":1}`. Paste it and `md5sum packages/db/supabase/migrations/0080_document_requests.sql`.

- [ ] **Step 7: The six pinned db tests lose the column** (nothing else in those files changes; read each line first and find it by its text if the number moved): delete `scan_status` and its value from the inserts at `document-space-used.test.ts:33`, `document-vault-reserve-lock.test.ts:29`, `document-vault-rls.test.ts:42`, `document-vault-schema.test.ts:44-47` (the builder's field and column) and `:222`, `documents.test.ts:65`. In `document-vault-schema.test.ts:101-112`, replace the `scan_status` loop and its `documents_scan_status_check` expectation with:

```ts
      const { rows: [gone] } = await c.query<{ n: string }>(
        "select count(*)::text as n from information_schema.columns where table_schema='public' and table_name='documents' and column_name='scan_status'");
      expect(gone!.n).toBe("0");
```
and rename the case "the category and source sets are closed and match document-rules; documents.scan_status is gone (mutation: add 'receipt' to documents_category_check -> FAILS; re-add scan_status -> FAILS)"; and replace its two source lines (`:107-108`, which insert every `DOCUMENT_SOURCES` value and expect `customer` refused; plan review I3) with a comparison of the CHECK's text, the catalogue case's shape (`automations-b-schema.test.ts:168-187`), plus inserts of the two staff sources only (a bare `customer` row fails `documents_request_coherent`, proven in `document-requests-schema.test.ts`):

```ts
      for (const source of ["upload", "camera"]) await doc(c, s.acct, { contact_id: s.ana, source });
      const { rows: [src] } = await c.query<{ def: string }>("select pg_get_constraintdef(oid) as def from pg_constraint where conname = 'documents_source_check'");
      // Task 3 replaces this literal list with DOCUMENT_SOURCES (it adds customer to document-rules.ts) and re-runs the case.
      const want = ["upload", "camera", "customer"];
      expect(src!.def).toBe(`CHECK ((source = ANY (ARRAY[${want.map((x) => `'${x}'::text`).join(", ")}])))`);
```

In `automations-b-schema.test.ts:168-187`, the expected `automation_log_source_check` text gains `, 'document_request'::text` after `'textback'::text`, and the case's title reads "fifteen sources (0054 added textback, 0080 document_request)". In `document-scan.test.ts:57-64` delete the two lines that read `documents.scan_status` and expect `"skipped"`, and drop "; a document with no scan_status reads 'skipped'" and "drop the documents default -> the insert FAILS 23502" from the case name.

- [ ] **Step 8: Run on the replica, post = pre + 0080.** `bash "$S/s07d-kit/replica.sh" 55580 "$S/s07d-t1-impl"` → `post = pre + 0080`. On `post`: `document-requests-schema.test.ts`, `document-vault-schema.test.ts`, `document-vault-rls.test.ts`, `document-vault-reserve-lock.test.ts`, `document-space-used.test.ts`, `document-scan.test.ts`, `schema-grants-guard.test.ts`. Expected: all PASS; `schema-grants-guard` unchanged. (`documents.test.ts` needs PostgREST: Task 3 runs it.) Paste the summary blocks.

- [ ] **Step 9: Mutation probes, each by name** (a `create or replace`, `alter` or `drop` on the replica's `post`, run the named case, then rebuild with `replica.sh`; never edit the committed file for a probe): (a) `items_ok` without `and e ->> 'key' = e ->> 'category'` → the items case FAILS; (b) the start without its `revoked` check → the refusal case FAILS on `revoked`; (c) `v_today >= 21` → the rate case FAILS; (d) the start without the `delete` on a refused reservation → the quota case FAILS; (e) the trigger without `and v.scan_status = 'clean'` → "the decisive clean verdict…" FAILS at its first `toBe(false)` (Insurance's clean verdict completes the request while Other holds only a ready-infected and a ready-pending file); (e2) the trigger without `and d.deleted_at is null` → "a trashed clean file…" FAILS; (f) the guard without `new.document_request_id := null;` → the To-do case FAILS; (g) `drop policy document_requests_technician_scope` → the `tech` row FAILS. Paste each failing assertion line.

- [ ] **Step 10: Commit.**

```bash
git add packages/db/supabase/migrations/0080_document_requests.sql packages/db/src/test/document-requests-schema.test.ts
git commit -m "db(0080): document requests, the customer source, one start function, completion on the last clean file; drop documents.scan_status" \
  -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>" -m "Claude-Session: https://claude.ai/code/session_013RThMy9QC8x7FZ94Lxib9p" -- \
  packages/db/supabase/migrations/0080_document_requests.sql packages/db/src/test/document-requests-schema.test.ts \
  packages/db/src/test/document-space-used.test.ts packages/db/src/test/document-vault-reserve-lock.test.ts \
  packages/db/src/test/document-vault-rls.test.ts packages/db/src/test/document-vault-schema.test.ts \
  packages/db/src/test/documents.test.ts packages/db/src/test/document-scan.test.ts packages/db/src/test/automations-b-schema.test.ts
```

---

## Task 2: Every key (bis-crm; messages.ts, the only writer)

**Review:** sonnet. **Runs beside:** Tasks 1 and 10.

**Files**
- Modify: `apps/web/src/lib/messages.ts` (insert after `"documents.viewer.passwordRemoved.es"`, `:4021`; the three `timeline.*` keys go beside the other `timeline.document*` keys, `:4013-4027`; the one `activity.source.*` key beside its siblings)
- Modify: `apps/web/src/lib/messages.test.ts` (one new `describe` at the end, after `:297`)

**Interfaces**
- Produces: every key below (English, then `.es` on the next line). Later tasks use these names exactly; a task that needs another STOPS. Plurals follow the house pattern: `<key>` for the count form and `<key>One` for one (`plural(m, base, count, locale, params)`, `lib/i18n/t.ts:54-64`).

- [ ] **Step 1: Write the failing test** at the end of `messages.test.ts`:

```ts
describe("the document vault's copy, PR 2b (customer upload links)", () => {
  const WANT: Record<string, [string, string]> = {
    "documents.request.open": ["Ask the customer", "Pedir al cliente"],
    "documents.request.title": ["Ask {name} for documents", "Pedir documentos a {name}"],
    "documents.request.what": ["What do you need?", "¿Qué necesita?"],
    "documents.request.otherNote": ["What is it?", "¿Qué es?"],
    "documents.request.how": ["How should it go?", "¿Cómo se lo enviamos?"],
    "documents.request.channel.text": ["Text", "Mensaje de texto"],
    "documents.request.channel.email": ["Email", "Correo"],
    "documents.request.channel.link": ["Copy link", "Copiar enlace"],
    "documents.request.textOff": ["Texting isn't available for this customer.", "No se le pueden enviar mensajes de texto a este cliente."],
    "documents.request.emailOff": ["There's no email address on file.", "No hay un correo en el expediente."],
    "documents.request.send": ["Send request", "Enviar pedido"],
    "documents.request.createLink": ["Create link", "Crear enlace"],
    "documents.request.cancel": ["Cancel", "Cancelar"],
    "documents.request.pickOne": ["Pick at least one document.", "Elija al menos un documento."],
    "documents.request.noteNeeded": ["Say what you need under Other.", "Diga qué necesita en Otro."],
    "documents.request.sentText": ["Request sent by text.", "Pedido enviado por mensaje de texto."],
    "documents.request.sentEmail": ["Request sent by email.", "Pedido enviado por correo."],
    "documents.request.held": ["Request saved. It goes out at {time}, after quiet hours.", "Pedido guardado. Sale a las {time}, después del horario de descanso."],
    "documents.request.linkCopied": ["Link copied. It works for 7 days.", "Enlace copiado. Funciona por 7 días."],
    "documents.request.copyFailed": ["Your browser didn't let us copy it. Here's the link to copy yourself:", "Su navegador no nos dejó copiarlo. Este es el enlace para copiarlo usted:"],
    "documents.request.notSent": ["Request saved, but not sent: {reason}. Copy the link instead.", "Pedido guardado, pero no se envió: {reason}. Copie el enlace en su lugar."],
    "documents.request.failed": ["Couldn't create the request. Try again.", "No se pudo crear el pedido. Intente de nuevo."],
    "documents.request.reason.textsStopped": ["they asked not to get texts", "pidió no recibir mensajes de texto"],
    "documents.request.reason.noPhone": ["there's no number we can text", "no hay un número para mensajes de texto"],
    "documents.request.reason.textSetup": ["texting isn't set up yet", "los mensajes de texto aún no están configurados"],
    "documents.request.reason.noEmail": ["there's no email address", "no hay un correo"],
    "documents.request.reason.emailStopped": ["they asked not to get these emails", "pidió no recibir estos correos"],
    "documents.request.reason.bounced": ["this email address bounced", "este correo rebotó"],
    "documents.request.reason.failed": ["it couldn't be delivered", "no se pudo entregar"],
    "documents.request.task.received": ["{name} sent documents · Review", "{name} mandó documentos · Revisar"],
    "documents.request.task.storageFull": ["{name} couldn't send documents: your storage is full", "{name} no pudo mandar documentos: su espacio está lleno"],
    "documents.requests.label": ["Asked for", "Pedido"],
    "documents.requests.expires": ["expires in {count} days", "vence en {count} días"],
    "documents.requests.expiresOne": ["expires in 1 day", "vence en 1 día"],
    "documents.requests.expiresToday": ["expires today", "vence hoy"],
    "documents.requests.received": ["Received", "Recibido"],
    "documents.requests.waiting": ["Waiting", "Pendiente"],
    "documents.requests.copy": ["Copy link", "Copiar enlace"],
    "documents.requests.revoke": ["Revoke", "Anular"],
    "documents.requests.revoked": ["Request revoked.", "Pedido anulado."],
    "documents.requests.loadFailed": ["Couldn't load the requests.", "No se pudieron cargar los pedidos."],
    "documents.addedByCustomer": ["Sent by the customer · {when}", "Enviado por el cliente · {when}"],
    "timeline.documentRequest": ["asked for {count} documents", "pidió {count} documentos"],
    "timeline.documentRequestOne": ["asked for 1 document", "pidió 1 documento"],
    "timeline.documentCustomer": ["sent {title}", "mandó {title}"],
    "activity.source.documentRequest": ["Document request", "Pedido de documentos"],
    "documentRequest.sms": ["{business}: please send us {items}. Upload them here:", "{business}: por favor envíenos {items}. Súbalos aquí:"],
    "documentRequest.email.subject": ["{business} needs a few documents", "{business} necesita unos documentos"],
    "documentRequest.email.body": ["Please send us: {items}. The link works for 7 days, and you don't need an account.", "Por favor envíenos: {items}. El enlace funciona por 7 días y no necesita una cuenta."],
    "documentRequest.email.button": ["Upload documents", "Subir documentos"],
    "customerDocs.pageTitle": ["Send documents", "Enviar documentos"],
    "customerDocs.heading": ["{business} asks for these documents", "{business} le pide estos documentos"],
    "customerDocs.intro": ["Upload each one below. Only {business} will see them.", "Suba cada uno abajo. Solo {business} los verá."],
    "customerDocs.upload": ["Upload", "Subir"],
    "customerDocs.takePhoto": ["Take photo", "Tomar foto"],
    "customerDocs.uploading": ["Uploading {percent} %", "Subiendo {percent} %"],
    "customerDocs.checking": ["Checking", "Revisando"],
    "customerDocs.received": ["Received", "Recibido"],
    "customerDocs.refused": ["We couldn't accept this file", "No pudimos aceptar este archivo"],
    "customerDocs.why.type": ["Use a PDF, a photo, or a Word or Excel file.", "Use un PDF, una foto o un archivo de Word o Excel."],
    "customerDocs.why.size": ["It's over 25 MB.", "Pesa más de 25 MB."],
    "customerDocs.why.virus": ["It had a virus.", "Tenía un virus."],
    "customerDocs.why.password": ["It has a password: remove it and upload it again.", "Tiene contraseña: quítela y vuelva a subirlo."],
    "customerDocs.why.unscannable": ["We couldn't check it. Try another copy.", "No pudimos revisarlo. Pruebe con otra copia."],
    "customerDocs.why.full": ["Please call {business} at {phone}.", "Por favor llame a {business} al {phone}."],
    "customerDocs.why.fullNoPhone": ["Please call {business}.", "Por favor llame a {business}."],
    "customerDocs.why.limit": ["That's a lot of files for one day. Try again tomorrow.", "Son muchos archivos para un día. Intente mañana."],
    "customerDocs.failed": ["Didn't upload. Try again.", "No se subió. Intente de nuevo."],
    "customerDocs.done": ["Thank you. {business} has everything it asked for.", "Gracias. {business} ya tiene todo lo que pidió."],
    "customerDocs.expired": ["This link has expired.", "Este enlace venció."],
    "customerDocs.revoked": ["This link is no longer active.", "Este enlace ya no está activo."],
    "customerDocs.notFound": ["This link doesn't work.", "Este enlace no funciona."],
    "customerDocs.ask": ["Ask {business} for a new link.", "Pida a {business} un enlace nuevo."],
    "customerDocs.call": ["Questions? Call {business} at {phone}.", "¿Preguntas? Llame a {business} al {phone}."],
    "customerDocs.callNoPhone": ["Questions? Contact {business}.", "¿Preguntas? Comuníquese con {business}."],
    "customerDocs.business": ["the business", "el negocio"],
    "customerDocs.poweredBy": ["Powered by BIS", "Con tecnología de BIS"],
    "customerDocs.error.title": ["Something went wrong on our side.", "Algo salió mal de nuestro lado."],
    "customerDocs.error.body": ["Please try again in a moment.", "Por favor intente de nuevo en un momento."],
    "customerDocs.error.retry": ["Try again", "Intentar de nuevo"],
  };
  it("every new key is the plan's wording, in both languages (mutation: any word changed, or a tú form such as 'Sube' -> FAILS)", () => {
    for (const [k, [en, es]] of Object.entries(WANT)) {
      expect([m[k as MessageKey], m[`${k}.es` as MessageKey]], k).toEqual([en, es]);
    }
  });
  it("no new string names the machinery (mutation: 'Your upload token expired' -> FAILS)", () => {
    for (const k of Object.keys(WANT)) {
      for (const text of [m[k as MessageKey], m[`${k}.es` as MessageKey]]) {
        expect(typeof text, k).toBe("string");
        expect(/token|hash|scanner|escáner|supabase|storage|signed|firmad|request id|bucket/i.test(text ?? "x"), k).toBe(false);
      }
    }
  });
  it("a placeholder in English is a placeholder in Spanish (mutation: drop {items} from documentRequest.sms.es -> FAILS)", () => {
    const holes = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((x) => x[1]).sort().join(",");
    for (const k of Object.keys(WANT)) expect(holes(m[`${k}.es` as MessageKey]), k).toBe(holes(m[k as MessageKey]));
  });
});
```

- [ ] **Step 2: Run it to see it fail.** `pnpm --filter web exec vitest run src/lib/messages.test.ts` → the new describe FAILS (keys missing; `m[k]` is `undefined`).
- [ ] **Step 3: Add the keys** to `messages.ts`, each English line followed directly by its `.es` line, with exactly the strings in `WANT` (copy them from the test; the middle dot is `·`, U+00B7, as in `documents.addedBy`, `:3849`).
- [ ] **Step 4: Run it to pass**, plus `src/lib/i18n/ratchet.test.ts` (every new key has a `.es` twin) → PASS. `pnpm --filter web typecheck` → 0.
- [ ] **Step 5: Probe.** Change `"customerDocs.upload.es"` to `"Sube"` → case 1 FAILS by name; revert by editing back. Delete `{items}` from `"documentRequest.sms.es"` → case 3 FAILS; revert. Paste both failing lines.
- [ ] **Step 6: Commit** `git commit -m "copy: the document vault PR 2b keys, English and Spanish" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>" -m "Claude-Session: https://claude.ai/code/session_013RThMy9QC8x7FZ94Lxib9p" -- apps/web/src/lib/messages.ts apps/web/src/lib/messages.test.ts`.

---

## Task 3: `@bis/db`: the request module, the `customer` source, the actor type (bis-crm)

**Review:** opus. **Scratch:** `<SCRATCH>/s07d-t3-impl/`, ports `55582`/`55583`/`55584` (reviewer `55585`/`55586`/`55587`).

**Files**
- Create: `packages/db/src/document-requests.ts`, `packages/db/src/test/document-requests.test.ts`
- Modify: `packages/db/src/document-rules.ts` (the sources, the request rules), `packages/db/src/documents.ts` (`markDocumentVersionReady`'s actor type; `TimelineDocument` keeps its shape), `packages/db/src/index.ts` (the documents export block), `packages/db/src/test/documents.test.ts` (one case), `packages/db/src/test/document-vault-schema.test.ts` (Task 1's literal `want` list becomes `DOCUMENT_SOURCES`, and its staff inserts loop over `STAFF_DOCUMENT_SOURCES`, both imported from `../document-rules`)

**Interfaces**
- Consumes: 0080 (Task 1): `document_requests`, `start_document_request_upload`, `documents.request_id`/`request_item_key`, `tasks.document_request_id`/`document_request_kind`. `emit` (`events.ts:16`), `forContacts`, `withTimelinePage`, `TimelinePageOpts` (`timeline-cursor.ts:8, :68, :75`), `DocumentRecordRef` (`documents.ts:15`).
- Produces (browser-safe, `@bis/db/document-rules`):
  - `DOCUMENT_SOURCES = ["upload", "camera", "customer"] as const`; `STAFF_DOCUMENT_SOURCES = ["upload", "camera"] as const`; `CUSTOMER_AUTHOR_PREFIX = "customer:"`; `isCustomerAuthor(by: string | null | undefined): boolean`.
  - `DOCUMENT_REQUEST_DAYS = 7`, `DOCUMENT_REQUEST_DAILY_STARTS = 20`, `DOCUMENT_REQUEST_MAX_ITEMS = 9`, `DOCUMENT_REQUEST_NOTE_MAX = 80`.
  - `type DocumentRequestItem = { key: DocumentCategory; category: DocumentCategory; note: string | null }`; `type DocumentRequestChannel = "text" | "email" | "link"`; `type DocumentRequestState = "open" | "expired" | "revoked" | "completed"`.
  - `cleanRequestItems(raw: unknown): DocumentRequestItem[] | null` (the SQL check's rules, in TS; notes trimmed).
  - `documentRequestState(r: { revoked_at: string | null; completed_at: string | null; expires_at: string }, now: Date): DocumentRequestState` (revoked, then completed, then expired: the SQL order).
- Produces (`@bis/db` barrel, server):
  - `type DocumentRequestRow = { id: string; account_id: string; contact_id: string | null; client_group_id: string | null; items: DocumentRequestItem[]; language: "en" | "es"; channel: DocumentRequestChannel; created_by: string; created_at: string; expires_at: string; revoked_at: string | null; revoked_by: string | null; completed_at: string | null }` (never `token_hash`).
  - `createDocumentRequest(db, a: { id: string; accountId: string; record: DocumentRecordRef; items: DocumentRequestItem[]; language: "en" | "es"; tokenHash: string; channel: DocumentRequestChannel; createdBy: string; now: Date }): Promise<DocumentRequestRow>`
  - `findDocumentRequestByTokenHash(db, tokenHash: string): Promise<DocumentRequestRow | null>`
  - `getDocumentRequest(db, accountId: string, requestId: string): Promise<DocumentRequestRow | null>`
  - `type RequestStartOutcome = { status: "ok"; documentId: string; versionId: string; storagePath: string } | { status: "not_found" | "revoked" | "completed" | "expired" | "no_item" | "rate_limited" | "over_quota" | "too_large" }`; `startDocumentRequestUpload(db, a: { accountId: string; requestId: string; itemKey: string; bytes: number; contentType: DocumentContentType; originalName: string | null; title: string }): Promise<RequestStartOutcome>`
  - `type RequestDocument = { id: string; account_id: string; request_id: string; request_item_key: string; deleted_at: string | null }`; `getRequestDocument(db, accountId, requestId, documentId): Promise<RequestDocument | null>`
  - `type RequestFile = { documentId: string; itemKey: string; versionId: string; ready: boolean; scanStatus: ScanStatus; scanSignature: string | null; createdAt: string }`; `listRequestFiles(db, accountId, requestId): Promise<RequestFile[]>` (non-trashed files of the request, each with its NEWEST version, oldest file first)
  - `type OpenDocumentRequest = { id: string; items: (DocumentRequestItem & { answered: boolean })[]; channel: DocumentRequestChannel; createdAt: string; expiresAt: string }`; `listOpenDocumentRequests(db, accountId, record: DocumentRecordRef, now: Date): Promise<OpenDocumentRequest[]>` (newest first)
  - `revokeDocumentRequest(db, accountId, requestId, actorId: string, now: Date): Promise<{ revokedAt: string } | null>` (only an open one; null otherwise); `restoreDocumentRequest(db, accountId, requestId, expectedRevokedAt: string): Promise<boolean>`
  - `type TimelineDocumentRequest = { id: string; items: DocumentRequestItem[]; channel: DocumentRequestChannel; created_by: string; created_at: string; contact_id: string | null; client_group_id: string | null }`; `listDocumentRequestTimeline(db, accountId, who: string | readonly string[], groupId: string | null, page: TimelinePageOpts): Promise<TimelineDocumentRequest[]>`
  - `type DocumentRequestTarget = { name: string; contactId: string | null; language: string | null; phone: string | null; email: string | null; phoneCountryUnconfirmed: boolean | null }`; `documentRequestTarget(db, accountId, ref: { contact_id: string | null; client_group_id: string | null }): Promise<DocumentRequestTarget | null>` (a contact: itself; a group: its name, and its primary contact's id, language, phone and email, all null without one)
  - `ensureDocumentRequestTask(db, accountId, input: { requestId: string; kind: "received" | "storage_full"; contactId: string | null; title: string; dueAt: string }, actorId: string, actorType?: ActorType): Promise<{ id: string; created: boolean }>`
  - `getDocumentRequestForVersion(db, accountId, versionId): Promise<DocumentRequestRow | null>` (the request a version's file answers; null for a staff file).
  - `claimDocumentRequestSend(db, accountId, requestId, now: Date): Promise<boolean>` (compare-and-set `sent_at` from null; true only for the caller that set it) and `clearDocumentRequestSend(db, accountId, requestId): Promise<void>` (re-review R1; service client).
  - `listRequestsMissingReceivedTask(db, now: Date, limit: number): Promise<DocumentRequestRow[]>` (plan review I5: not revoked; open, or completed in the last 24 hours; with a non-trashed customer file whose version is ready and clean; and no `received` To-do; newest first, at most `limit`; service client, every account).
  - `markDocumentVersionReady(db, a: { …; actorId: string; actorType?: ActorType })` (default `"user"`, unchanged for every staff caller).

- [ ] **Step 1: Read before writing.** `sed -n 1,60p packages/db/src/documents.ts`, `sed -n 140,180p packages/db/src/documents.ts`, `sed -n 600,650p packages/db/src/documents.ts` (the scan timeline read this module copies), `sed -n 1,40p packages/db/src/document-rules.ts`, `sed -n 265,300p packages/db/src/index.ts`, `sed -n 141,162p packages/db/src/activities.ts` (`ensureConsentTask`, the shape `ensureDocumentRequestTask` copies). Start the kit: `bash <SCRATCH>/s07d-kit/replica.sh 55582 <SCRATCH>/s07d-t3-impl && bash <SCRATCH>/s07d-kit/pgrst.sh 55582 55583 55584 <SCRATCH>/s07d-t3-impl` → `post = pre + 0080`.

- [ ] **Step 2: Write the failing test** `packages/db/src/test/document-requests.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { withTestAccount } from "./fixtures";
import { createContact } from "../contacts";
import { createGroupWithMember } from "../client-groups";
import { markDocumentVersionReady, recordDocumentScan } from "../documents";
import {
  createDocumentRequest, findDocumentRequestByTokenHash, getDocumentRequest, startDocumentRequestUpload, getRequestDocument,
  listRequestFiles, listOpenDocumentRequests, revokeDocumentRequest, restoreDocumentRequest, listDocumentRequestTimeline,
  documentRequestTarget, ensureDocumentRequestTask,
} from "../document-requests";
import { cleanRequestItems, documentRequestState, isCustomerAuthor, DOCUMENT_SOURCES } from "../document-rules";

/**
 * The request module (spec 4.1-4.5) on the service client (the routes and the actions hold one AFTER
 * their proof), behind PostgREST on the replica. RLS itself is document-requests-schema.test.ts's job.
 */
const ACTOR = "user_drq_test";
const NOW = new Date();
const HEX = (n: number) => n.toString(16).padStart(64, "0");
const ITEMS = [
  { key: "insurance", category: "insurance", note: null },
  { key: "other", category: "other", note: "Pool permit" },
] as const;
let n = 1;
async function made(db: SupabaseClient, accountId: string, contactId: string, over: { now?: Date } = {}) {
  return createDocumentRequest(db, {
    id: crypto.randomUUID(), accountId, record: { kind: "contact", id: contactId }, items: [...ITEMS], language: "es",
    tokenHash: HEX(n++), channel: "link", createdBy: ACTOR, now: over.now ?? NOW,
  });
}
async function cleanFile(db: SupabaseClient, accountId: string, requestId: string, itemKey: string) {
  const s = await startDocumentRequestUpload(db, { accountId, requestId, itemKey, bytes: 10, contentType: "application/pdf", originalName: "a.pdf", title: "Seguro" });
  if (s.status !== "ok") throw new Error(s.status);
  expect(await markDocumentVersionReady(db, { accountId, documentId: s.documentId, versionId: s.versionId, bytes: 10, sha256: "a".repeat(64), actorId: `customer:${requestId}`, actorType: "system" })).toBe(true);
  await recordDocumentScan(db, { accountId, versionId: s.versionId, verdict: "clean" });
  return s;
}

describe("document-rules: the request's pure rules (spec 4.1)", () => {
  it("cleanRequestItems keeps the SQL check's rules (mutations: allow 10 items; allow a note on insurance; allow a duplicate -> FAILS)", () => {
    expect(cleanRequestItems([{ key: "id", category: "id", note: null }, { key: "other", category: "other", note: "  Pool permit " }]))
      .toEqual([{ key: "id", category: "id", note: null }, { key: "other", category: "other", note: "Pool permit" }]);
    const nine = ["id", "contract", "estimate", "invoice", "photo", "permit", "insurance", "warranty", "other"]
      .map((k) => ({ key: k, category: k, note: k === "other" ? "x" : null }));
    expect(cleanRequestItems(nine)).toHaveLength(9);
    for (const bad of [[], [...nine, nine[0]], [{ key: "id", category: "id", note: "x" }], [{ key: "other", category: "other", note: "" }],
      [{ key: "other", category: "other", note: "x".repeat(81) }], [{ key: "id", category: "insurance", note: null }],
      [{ key: "id", category: "id", note: null }, { key: "id", category: "id", note: null }], "id", null]) {
      expect(cleanRequestItems(bad), JSON.stringify(bad)).toBeNull();
    }
  });
  it("documentRequestState answers revoked, then completed, then expired, else open (mutation: check expiry first -> FAILS)", () => {
    const at = "2026-10-20T00:00:00.000Z";
    const now = new Date("2026-10-21T00:00:00.000Z");
    expect(documentRequestState({ revoked_at: at, completed_at: at, expires_at: at }, now)).toBe("revoked");
    expect(documentRequestState({ revoked_at: null, completed_at: at, expires_at: at }, now)).toBe("completed");
    expect(documentRequestState({ revoked_at: null, completed_at: null, expires_at: at }, now)).toBe("expired");
    expect(documentRequestState({ revoked_at: null, completed_at: null, expires_at: "2026-10-22T00:00:00.000Z" }, now)).toBe("open");
  });
  it("customer is a source and 'customer:' marks a customer author (mutation: drop customer from DOCUMENT_SOURCES -> FAILS)", () => {
    expect(DOCUMENT_SOURCES).toEqual(["upload", "camera", "customer"]);
    expect([isCustomerAuthor("customer:abc"), isCustomerAuthor("user_1"), isCustomerAuthor(null)]).toEqual([true, false, false]);
  });
});

describe("document-requests: create, find, start (spec 4.1, 4.4)", () => {
  it("creates a request that expires 7 days on and finds it by its hash, never answering the hash (mutation: expires_at +6 days -> the insert FAILS; select token_hash -> FAILS)", () =>
    withTestAccount(async (db, accountId) => {
      const ana = (await createContact(db, accountId, { firstName: "Ana" }, ACTOR)).id;
      const r = await made(db, accountId, ana);
      expect(Date.parse(r.expires_at) - Date.parse(r.created_at)).toBe(7 * 86_400_000);
      const found = await findDocumentRequestByTokenHash(db, HEX(n - 1));
      expect(found?.id).toBe(r.id);
      expect(Object.keys(found!)).not.toContain("token_hash");
      expect(await findDocumentRequestByTokenHash(db, HEX(999_999))).toBeNull();
      expect((await getDocumentRequest(db, accountId, r.id))?.items).toEqual(ITEMS);
    }));

  it("start answers ok with the ids and every refusal by name; getRequestDocument reads only this request's file in this account (mutation: drop .eq('request_id') -> FAILS)", () =>
    withTestAccount(async (db, accountId) => {
      const ana = (await createContact(db, accountId, { firstName: "Ana" }, ACTOR)).id;
      const a = await made(db, accountId, ana);
      const b = await made(db, accountId, ana);
      const s = await startDocumentRequestUpload(db, { accountId, requestId: a.id, itemKey: "insurance", bytes: 10, contentType: "application/pdf", originalName: "a.pdf", title: "Seguro" });
      expect(s.status).toBe("ok");
      if (s.status !== "ok") return;
      expect(s.storagePath).toBe(`${accountId}/${s.documentId}/${s.versionId}`);
      expect((await getRequestDocument(db, accountId, a.id, s.documentId))?.request_item_key).toBe("insurance");
      expect(await getRequestDocument(db, accountId, b.id, s.documentId)).toBeNull();
      expect((await startDocumentRequestUpload(db, { accountId, requestId: a.id, itemKey: "warranty", bytes: 10, contentType: "application/pdf", originalName: null, title: "X" })).status).toBe("no_item");
    }));
});

describe("document-requests: what the card and the page read (spec 4.2, 4.3, 4.5)", () => {
  it("an item is answered only by a clean, ready, non-trashed file; a completed request leaves the open list (mutation: count a pending file as answered -> FAILS)", () =>
    withTestAccount(async (db, accountId) => {
      const ana = (await createContact(db, accountId, { firstName: "Ana" }, ACTOR)).id;
      const r = await made(db, accountId, ana);
      const pending = await startDocumentRequestUpload(db, { accountId, requestId: r.id, itemKey: "other", bytes: 10, contentType: "application/pdf", originalName: "p.pdf", title: "Pool permit" });
      if (pending.status !== "ok") throw new Error(pending.status);
      await markDocumentVersionReady(db, { accountId, documentId: pending.documentId, versionId: pending.versionId, bytes: 10, sha256: "b".repeat(64), actorId: `customer:${r.id}`, actorType: "system" });
      await cleanFile(db, accountId, r.id, "insurance");
      const [open] = await listOpenDocumentRequests(db, accountId, { kind: "contact", id: ana }, new Date());
      expect(open!.items.map((i) => [i.key, i.answered])).toEqual([["insurance", true], ["other", false]]);
      const files = await listRequestFiles(db, accountId, r.id);
      expect(files.map((f) => [f.itemKey, f.ready, f.scanStatus])).toEqual([["other", true, "pending"], ["insurance", true, "clean"]]);
      await recordDocumentScan(db, { accountId, versionId: pending.versionId, verdict: "clean" });
      expect(await listOpenDocumentRequests(db, accountId, { kind: "contact", id: ana }, new Date())).toEqual([]);
      expect((await getDocumentRequest(db, accountId, r.id))?.completed_at).not.toBeNull();
    }));

  it("revoke is compare-and-set on an open request and its undo restores only that revoke (mutation: drop .is('revoked_at', null) -> a second revoke answers -> FAILS)", () =>
    withTestAccount(async (db, accountId) => {
      const ana = (await createContact(db, accountId, { firstName: "Ana" }, ACTOR)).id;
      const r = await made(db, accountId, ana);
      const first = await revokeDocumentRequest(db, accountId, r.id, ACTOR, new Date());
      expect(first?.revokedAt).toMatch(/^\d{4}-/);
      expect(await revokeDocumentRequest(db, accountId, r.id, ACTOR, new Date())).toBeNull();
      expect(await restoreDocumentRequest(db, accountId, r.id, "2000-01-01T00:00:00.000Z")).toBe(false);
      expect(await restoreDocumentRequest(db, accountId, r.id, first!.revokedAt)).toBe(true);
      expect((await getDocumentRequest(db, accountId, r.id))?.revoked_at).toBeNull();
      expect(await listOpenDocumentRequests(db, accountId, { kind: "contact", id: ana }, new Date())).toHaveLength(1);
    }));

  it("the timeline read pages on created_at and covers a group's own requests (mutation: drop the group read -> FAILS)", () =>
    withTestAccount(async (db, accountId) => {
      const ana = (await createContact(db, accountId, { firstName: "Ana" }, ACTOR)).id;
      const g = await createGroupWithMember(db, accountId, ana, "household", "Casa", null, ACTOR);
      if (g.status !== "ok") throw new Error(g.status);
      const mine = await made(db, accountId, ana);
      const casa = await createDocumentRequest(db, { id: crypto.randomUUID(), accountId, record: { kind: "group", id: g.groupId }, items: [{ key: "id", category: "id", note: null }], language: "en", tokenHash: HEX(n++), channel: "email", createdBy: ACTOR, now: new Date() });
      const rows = await listDocumentRequestTimeline(db, accountId, [ana], g.groupId, { limit: 10 });
      expect(rows.map((x) => x.id).sort()).toEqual([mine.id, casa.id].sort());
      expect(rows.find((x) => x.id === casa.id)).toMatchObject({ client_group_id: g.groupId, contact_id: null, channel: "email", created_by: ACTOR });
    }));

  it("the target of a group request is its primary contact; of a contact, itself (mutation: read the first member instead of is_primary_contact -> FAILS)", () =>
    withTestAccount(async (db, accountId) => {
      const ana = (await createContact(db, accountId, { firstName: "Ana", lastName: "García", email: "ana@example.com" }, ACTOR)).id;
      const bo = (await createContact(db, accountId, { firstName: "Bo" }, ACTOR)).id;
      const g = await createGroupWithMember(db, accountId, bo, "household", "Casa García", null, ACTOR);
      if (g.status !== "ok") throw new Error(g.status);
      await db.from("client_group_members").insert({ account_id: accountId, client_group_id: g.groupId, contact_id: ana, is_primary_contact: true });
      expect(await documentRequestTarget(db, accountId, { contact_id: ana, client_group_id: null }))
        .toMatchObject({ name: "Ana García", contactId: ana, email: "ana@example.com" });
      expect(await documentRequestTarget(db, accountId, { contact_id: null, client_group_id: g.groupId }))
        .toMatchObject({ name: "Casa García", contactId: ana, email: "ana@example.com" });
    }));

  it("ensureDocumentRequestTask opens one To-do per request and kind (mutation: no 23505 read-back -> the second call throws -> FAILS)", () =>
    withTestAccount(async (db, accountId) => {
      const ana = (await createContact(db, accountId, { firstName: "Ana" }, ACTOR)).id;
      const r = await made(db, accountId, ana);
      const a = await ensureDocumentRequestTask(db, accountId, { requestId: r.id, kind: "received", contactId: ana, title: "Ana sent documents · Review", dueAt: new Date().toISOString() }, "documents-request");
      const again = await ensureDocumentRequestTask(db, accountId, { requestId: r.id, kind: "received", contactId: ana, title: "x", dueAt: new Date().toISOString() }, "documents-request");
      expect([a.created, again.created, again.id === a.id]).toEqual([true, false, true]);
      const { data } = await db.from("tasks").select("title, document_request_kind").eq("id", a.id).single();
      expect(data).toEqual({ title: "Ana sent documents · Review", document_request_kind: "received" });
    }));
});
```

(The group test inserts a second member with `is_primary_contact: true` through the service client; if `client_group_members` needs a `role` or other NOT NULL column without a default, add it. `createContact`'s input fields `lastName`, `email` are read from `CreateContactInput`; adjust names to that type if they differ, and say so.)

- [ ] **Step 3: Run it to see it fail.** `source <SCRATCH>/s07d-t3-impl/env-run.sh && cd packages/db && node node_modules/vitest/vitest.mjs run src/test/document-requests.test.ts; echo $? > <SCRATCH>/s07d-t3-impl/exit` → FAIL (module missing).

- [ ] **Step 4: `document-rules.ts`.** Replace `:24-26` and add, after `DOCUMENT_TRASH_DAYS`:

```ts
/** Part 1's two sources, and part 2b's customer upload (0080 widens the CHECK with this list). */
export const DOCUMENT_SOURCES = ["upload", "camera", "customer"] as const;
export type DocumentSource = (typeof DOCUMENT_SOURCES)[number];
/** The sources a STAFF upload may claim; `customer` is only ever written by start_document_request_upload. */
export const STAFF_DOCUMENT_SOURCES = ["upload", "camera"] as const;
/** A customer file's created_by / uploaded_by is "customer:<request id>" (0080's documents_request_coherent). */
export const CUSTOMER_AUTHOR_PREFIX = "customer:";
export const isCustomerAuthor = (by: string | null | undefined): boolean => typeof by === "string" && by.startsWith(CUSTOMER_AUTHOR_PREFIX);

/** Customer upload links (spec P5, 4.1, 4.4); the SQL literals in 0080 are these. */
export const DOCUMENT_REQUEST_DAYS = 7;
export const DOCUMENT_REQUEST_DAILY_STARTS = 20;
export const DOCUMENT_REQUEST_MAX_ITEMS = 9;
export const DOCUMENT_REQUEST_NOTE_MAX = 80;
export type DocumentRequestItem = { key: DocumentCategory; category: DocumentCategory; note: string | null };
export type DocumentRequestChannel = "text" | "email" | "link";
export type DocumentRequestState = "open" | "expired" | "revoked" | "completed";

/** 0080's app.document_request_items_ok, in TypeScript: the dialog's and the action's check. A note is trimmed. */
export function cleanRequestItems(raw: unknown): DocumentRequestItem[] | null {
  if (!Array.isArray(raw) || raw.length < 1 || raw.length > DOCUMENT_REQUEST_MAX_ITEMS) return null;
  const out: DocumentRequestItem[] = [];
  const seen = new Set<string>();
  for (const x of raw) {
    if (typeof x !== "object" || x === null || Array.isArray(x)) return null;
    const { key, category, note } = x as Record<string, unknown>;
    if (!isDocumentCategory(category) || key !== category || seen.has(category)) return null;
    seen.add(category);
    if (category === "other") {
      if (typeof note !== "string") return null;
      const t = note.trim();
      if (t.length < 1 || t.length > DOCUMENT_REQUEST_NOTE_MAX) return null;
      out.push({ key: category, category, note: t });
    } else {
      if (note !== null) return null;
      out.push({ key: category, category, note: null });
    }
  }
  return out;
}

/** The order 0080's start function checks them in: revoked, completed, expired. */
export function documentRequestState(
  r: { revoked_at: string | null; completed_at: string | null; expires_at: string }, now: Date,
): DocumentRequestState {
  if (r.revoked_at) return "revoked";
  if (r.completed_at) return "completed";
  return Date.parse(r.expires_at) <= now.getTime() ? "expired" : "open";
}
```

(`isDocumentCategory` is declared at `:31`; move these lines below it, or the arrow `const` is used before its declaration at module evaluation time only inside a function call, which is safe; place them after `:33` for reading order.) **Check `app.tidy_text`'s rule** (`sed -n 29,45p packages/db/supabase/migrations/0071_places_and_equipment.sql`): if it refuses something `trim()` keeps (control characters, inner runs of spaces), mirror that refusal here and add the case to Step 2's list.

- [ ] **Step 5: `documents.ts`, the actor type.** In `markDocumentVersionReady`'s parameter type add `actorType?: ActorType` (import `type ActorType` from `./events`), and pass `a.actorType ?? "user"` as `emit`'s sixth argument (`:167`). Nothing else in `documents.ts` changes.

- [ ] **Step 6: Write `packages/db/src/document-requests.ts`:**

```ts
import type { SupabaseClient } from "@supabase/supabase-js";
import { emit, type ActorType } from "./events";
import { forContacts, withTimelinePage, type TimelinePageOpts } from "./timeline-cursor";
import {
  DOCUMENT_REQUEST_DAYS, type DocumentContentType, type DocumentRequestChannel, type DocumentRequestItem,
} from "./document-rules";
import type { DocumentRecordRef, ScanStatus } from "./documents";

/**
 * Customer upload links (0080; spec section 4). READS take the caller's client (RLS decides on a
 * request client; the public routes hold the service client after proving the token, and pass the
 * request's own account and id to every read). WRITES take the service client. token_hash is
 * written once and read only as a lookup key: no read here returns it. THROWS on a read or write
 * error, as documents.ts does.
 */
export type DocumentRequestRow = {
  id: string; account_id: string; contact_id: string | null; client_group_id: string | null;
  items: DocumentRequestItem[]; language: "en" | "es"; channel: DocumentRequestChannel; created_by: string;
  created_at: string; expires_at: string; revoked_at: string | null; revoked_by: string | null; completed_at: string | null;
  /** Re-review R1: set just before a send is handed to the provider; null when nothing went out. */
  sent_at: string | null;
};
const REQUEST_COLS = "id, account_id, contact_id, client_group_id, items, language, channel, created_by, created_at, expires_at, revoked_at, revoked_by, completed_at, sent_at";
const DAY_MS = 86_400_000;

export async function createDocumentRequest(db: SupabaseClient, a: {
  id: string; accountId: string; record: DocumentRecordRef; items: DocumentRequestItem[]; language: "en" | "es";
  tokenHash: string; channel: DocumentRequestChannel; createdBy: string; now: Date;
}): Promise<DocumentRequestRow> {
  const created = a.now.toISOString();
  const { data, error } = await db.from("document_requests").insert({
    id: a.id, account_id: a.accountId,
    contact_id: a.record.kind === "contact" ? a.record.id : null,
    client_group_id: a.record.kind === "group" ? a.record.id : null,
    items: a.items, language: a.language, token_hash: a.tokenHash, channel: a.channel, created_by: a.createdBy,
    created_at: created, expires_at: new Date(a.now.getTime() + DOCUMENT_REQUEST_DAYS * DAY_MS).toISOString(),
  }).select(REQUEST_COLS).single();
  if (error) throw new Error(`createDocumentRequest failed: ${error.message}`);
  return data as DocumentRequestRow;
}

/** The public routes' first read: the request whose token hashes to this, in any account (the token IS the proof). */
export async function findDocumentRequestByTokenHash(db: SupabaseClient, tokenHash: string): Promise<DocumentRequestRow | null> {
  const { data, error } = await db.from("document_requests").select(REQUEST_COLS).eq("token_hash", tokenHash).maybeSingle();
  if (error) throw new Error(`findDocumentRequestByTokenHash failed: ${error.message}`);
  return (data as DocumentRequestRow | null) ?? null;
}

export async function getDocumentRequest(db: SupabaseClient, accountId: string, requestId: string): Promise<DocumentRequestRow | null> {
  const { data, error } = await db.from("document_requests").select(REQUEST_COLS).eq("account_id", accountId).eq("id", requestId).maybeSingle();
  if (error) throw new Error(`getDocumentRequest failed: ${error.message}`);
  return (data as DocumentRequestRow | null) ?? null;
}

export type RequestStartOutcome =
  | { status: "ok"; documentId: string; versionId: string; storagePath: string }
  | { status: "not_found" | "revoked" | "completed" | "expired" | "no_item" | "rate_limited" | "over_quota" | "too_large" };
const START_REFUSALS = new Set(["not_found", "revoked", "completed", "expired", "no_item", "rate_limited", "over_quota", "too_large"]);

/** Service client. 0080's start_document_request_upload: the request locked and re-proved open, the record and category its own. */
export async function startDocumentRequestUpload(db: SupabaseClient, a: {
  accountId: string; requestId: string; itemKey: string; bytes: number; contentType: DocumentContentType; originalName: string | null; title: string;
}): Promise<RequestStartOutcome> {
  const { data, error } = await db.rpc("start_document_request_upload", {
    p_account_id: a.accountId, p_request_id: a.requestId, p_item_key: a.itemKey, p_bytes: a.bytes,
    p_content_type: a.contentType, p_original_name: a.originalName, p_title: a.title,
  });
  if (error) throw new Error(`startDocumentRequestUpload failed: ${error.message}`);
  const r = data as { status: string; document_id?: string; version_id?: string; storage_path?: string };
  if (r.status === "ok" && r.document_id && r.version_id && r.storage_path) {
    return { status: "ok", documentId: r.document_id, versionId: r.version_id, storagePath: r.storage_path };
  }
  if (START_REFUSALS.has(r.status)) return { status: r.status as Exclude<RequestStartOutcome["status"], "ok"> };
  throw new Error(`startDocumentRequestUpload: unexpected answer ${JSON.stringify(r.status)}`);
}

export type RequestDocument = { id: string; account_id: string; request_id: string; request_item_key: string; deleted_at: string | null };

/** The customer finish's proof: THIS request's file in THIS account, or null. */
export async function getRequestDocument(db: SupabaseClient, accountId: string, requestId: string, documentId: string): Promise<RequestDocument | null> {
  const { data, error } = await db.from("documents").select("id, account_id, request_id, request_item_key, deleted_at")
    .eq("account_id", accountId).eq("request_id", requestId).eq("id", documentId).maybeSingle();
  if (error) throw new Error(`getRequestDocument failed: ${error.message}`);
  return (data as RequestDocument | null) ?? null;
}

export type RequestFile = {
  documentId: string; itemKey: string; versionId: string; ready: boolean; scanStatus: ScanStatus; scanSignature: string | null; createdAt: string;
};
type FileRow = {
  id: string; request_item_key: string; created_at: string;
  versions: { id: string; status: "uploading" | "ready"; scan_status: ScanStatus; scan_signature: string | null; created_at: string }[];
};

/** The customer page's read: each non-trashed file of the request with its NEWEST version, oldest file first. */
export async function listRequestFiles(db: SupabaseClient, accountId: string, requestId: string): Promise<RequestFile[]> {
  const { data, error } = await db.from("documents")
    .select("id, request_item_key, created_at, versions:document_versions!document_versions_document_fkey(id, status, scan_status, scan_signature, created_at)")
    .eq("account_id", accountId).eq("request_id", requestId).is("deleted_at", null)
    .order("created_at", { ascending: true }).order("id", { ascending: true });
  if (error) throw new Error(`listRequestFiles failed: ${error.message}`);
  const out: RequestFile[] = [];
  for (const d of (data ?? []) as FileRow[]) {
    const v = [...d.versions].sort((x, y) => (x.created_at < y.created_at ? 1 : x.created_at > y.created_at ? -1 : 0))[0];
    if (!v) continue;
    out.push({ documentId: d.id, itemKey: d.request_item_key, versionId: v.id, ready: v.status === "ready", scanStatus: v.scan_status, scanSignature: v.scan_signature, createdAt: v.created_at });
  }
  return out;
}

export type OpenDocumentRequest = {
  id: string; items: (DocumentRequestItem & { answered: boolean })[]; channel: DocumentRequestChannel; createdAt: string; expiresAt: string;
};

/** The card's read: this record's OPEN requests (not revoked, not completed, not expired), newest first, each item answered or not. */
export async function listOpenDocumentRequests(db: SupabaseClient, accountId: string, record: DocumentRecordRef, now: Date): Promise<OpenDocumentRequest[]> {
  const { data, error } = await db.from("document_requests").select(REQUEST_COLS)
    .eq("account_id", accountId).eq(record.kind === "contact" ? "contact_id" : "client_group_id", record.id)
    .is("revoked_at", null).is("completed_at", null).gt("expires_at", now.toISOString())
    .order("created_at", { ascending: false }).limit(50);
  if (error) throw new Error(`listOpenDocumentRequests failed: ${error.message}`);
  const rows = (data ?? []) as DocumentRequestRow[];
  if (rows.length === 0) return [];
  const { data: docs, error: docErr } = await db.from("documents")
    .select("request_id, request_item_key, versions:document_versions!document_versions_document_fkey(status, scan_status)")
    .eq("account_id", accountId).in("request_id", rows.map((r) => r.id)).is("deleted_at", null);
  if (docErr) throw new Error(`listOpenDocumentRequests (files) failed: ${docErr.message}`);
  const answered = new Set<string>();
  for (const d of (docs ?? []) as { request_id: string; request_item_key: string; versions: { status: string; scan_status: string }[] }[]) {
    if (d.versions.some((v) => v.status === "ready" && v.scan_status === "clean")) answered.add(`${d.request_id}/${d.request_item_key}`);
  }
  return rows.map((r) => ({
    id: r.id, channel: r.channel, createdAt: r.created_at, expiresAt: r.expires_at,
    items: r.items.map((i) => ({ ...i, answered: answered.has(`${r.id}/${i.key}`) })),
  }));
}

/** Service client. Revokes an OPEN request (compare-and-set); null when it was not open. */
export async function revokeDocumentRequest(db: SupabaseClient, accountId: string, requestId: string, actorId: string, now: Date): Promise<{ revokedAt: string } | null> {
  const { data, error } = await db.from("document_requests").update({ revoked_at: now.toISOString(), revoked_by: actorId })
    .eq("account_id", accountId).eq("id", requestId).is("revoked_at", null).is("completed_at", null).gt("expires_at", now.toISOString())
    .select("revoked_at").maybeSingle();
  if (error) throw new Error(`revokeDocumentRequest failed: ${error.message}`);
  return data ? { revokedAt: (data as { revoked_at: string }).revoked_at } : null;
}

/** Service client. Undo: clears exactly THAT revoke (compare-and-set on its time). */
export async function restoreDocumentRequest(db: SupabaseClient, accountId: string, requestId: string, expectedRevokedAt: string): Promise<boolean> {
  const { data, error } = await db.from("document_requests").update({ revoked_at: null, revoked_by: null })
    .eq("account_id", accountId).eq("id", requestId).eq("revoked_at", expectedRevokedAt).select("id");
  if (error) throw new Error(`restoreDocumentRequest failed: ${error.message}`);
  return (data ?? []).length === 1;
}

export type TimelineDocumentRequest = {
  id: string; items: DocumentRequestItem[]; channel: DocumentRequestChannel; created_by: string; created_at: string;
  contact_id: string | null; client_group_id: string | null;
};
const TIMELINE_COLS = "id, items, channel, created_by, created_at, contact_id, client_group_id";

/** The timeline's request rows (plan deviation 6), on the caller's client so RLS decides; paged on created_at. */
export async function listDocumentRequestTimeline(
  db: SupabaseClient, accountId: string, who: string | readonly string[], groupId: string | null, page: TimelinePageOpts,
): Promise<TimelineDocumentRequest[]> {
  const base = () => db.from("document_requests").select(TIMELINE_COLS).eq("account_id", accountId);
  const reads = [withTimelinePage(forContacts(base(), "contact_id", who), "created_at", page)];
  if (groupId) reads.push(withTimelinePage(base().eq("client_group_id", groupId), "created_at", page));
  const results = await Promise.all(reads);
  const out: TimelineDocumentRequest[] = [];
  for (const { data, error } of results) {
    if (error) throw new Error(`listDocumentRequestTimeline failed: ${error.message}`);
    out.push(...((data ?? []) as TimelineDocumentRequest[]));
  }
  return out;
}

export type DocumentRequestTarget = {
  name: string; contactId: string | null; language: string | null; phone: string | null; email: string | null; phoneCountryUnconfirmed: boolean | null;
};
type ContactBits = { id: string; first_name: string | null; last_name: string | null; language: string | null; phone: string | null; email: string | null; phone_country_unconfirmed: boolean | null };
const CONTACT_BITS = "id, first_name, last_name, language, phone, email, phone_country_unconfirmed";
const nameOf = (c: ContactBits): string => [c.first_name, c.last_name].filter((x) => x && x.trim()).join(" ").trim();

/** Who a request speaks to (plan deviation 3): a contact itself; a group by its name, delivered to its primary contact. */
export async function documentRequestTarget(
  db: SupabaseClient, accountId: string, ref: { contact_id: string | null; client_group_id: string | null },
): Promise<DocumentRequestTarget | null> {
  const asTarget = (name: string, c: ContactBits | null): DocumentRequestTarget => ({
    name, contactId: c?.id ?? null, language: c?.language ?? null, phone: c?.phone ?? null, email: c?.email ?? null,
    phoneCountryUnconfirmed: c?.phone_country_unconfirmed ?? null,
  });
  if (ref.contact_id) {
    const { data, error } = await db.from("contacts").select(CONTACT_BITS).eq("account_id", accountId).eq("id", ref.contact_id).maybeSingle();
    if (error) throw new Error(`documentRequestTarget failed: ${error.message}`);
    return data ? asTarget(nameOf(data as ContactBits), data as ContactBits) : null;
  }
  if (!ref.client_group_id) return null;
  const { data: g, error: gErr } = await db.from("client_groups").select("id, name").eq("account_id", accountId).eq("id", ref.client_group_id).maybeSingle();
  if (gErr) throw new Error(`documentRequestTarget (group) failed: ${gErr.message}`);
  if (!g) return null;
  const { data: m, error: mErr } = await db.from("client_group_members").select(`contact:contacts!inner(${CONTACT_BITS})`)
    .eq("account_id", accountId).eq("client_group_id", ref.client_group_id).eq("is_primary_contact", true).maybeSingle();
  if (mErr) throw new Error(`documentRequestTarget (primary contact) failed: ${mErr.message}`);
  return asTarget((g as { name: string }).name, (m as { contact: ContactBits } | null)?.contact ?? null);
}

/** Service client. The ONE To-do per request and kind (0080's tasks_document_request_once); emits task.created only when it made the row. */
export async function ensureDocumentRequestTask(
  db: SupabaseClient, accountId: string,
  input: { requestId: string; kind: "received" | "storage_full"; contactId: string | null; title: string; dueAt: string },
  actorId: string, actorType: ActorType = "system",
): Promise<{ id: string; created: boolean }> {
  const { data, error } = await db.from("tasks").insert({
    account_id: accountId, contact_id: input.contactId, title: input.title, due_at: input.dueAt,
    document_request_id: input.requestId, document_request_kind: input.kind,
  }).select("id").single();
  if (!error && data) {
    await emit(db, accountId, "task.created", actorId,
      { taskId: (data as { id: string }).id, contactId: input.contactId, documentRequestId: input.requestId }, actorType);
    return { id: (data as { id: string }).id, created: true };
  }
  if (error?.code !== "23505") throw new Error(`ensureDocumentRequestTask failed: ${error?.message ?? "no row"}`);
  const { data: found, error: readErr } = await db.from("tasks").select("id")
    .eq("account_id", accountId).eq("document_request_id", input.requestId).eq("document_request_kind", input.kind).maybeSingle();
  if (readErr || !found) throw new Error(`ensureDocumentRequestTask: already there but unreadable: ${readErr?.message ?? "no row"}`);
  return { id: (found as { id: string }).id, created: false };
}
```

and, at the end of the module (scanVersion's clean hook, Task 4):

```ts
/** The request a version's file answers, or null for a staff file. */
export async function getDocumentRequestForVersion(db: SupabaseClient, accountId: string, versionId: string): Promise<DocumentRequestRow | null> {
  const { data, error } = await db.from("document_versions").select("document:documents!document_versions_document_fkey(request_id)")
    .eq("account_id", accountId).eq("id", versionId).maybeSingle();
  if (error) throw new Error(`getDocumentRequestForVersion failed: ${error.message}`);
  const requestId = (data as { document: { request_id: string | null } | null } | null)?.document?.request_id ?? null;
  return requestId ? getDocumentRequest(db, accountId, requestId) : null;
}
```

with one more case in Step 2's "what the card and the page read" describe: `getDocumentRequestForVersion` answers the request for a customer file's version and `null` for a staff file's version (mutation: read `documents.id` instead of `request_id` -> FAILS).

And the reconcile read (plan review I5):

```ts
/** The scan pass's reconcile (plan review I5): requests that should have a "received" To-do and do not. Service client, every account. */
export async function listRequestsMissingReceivedTask(db: SupabaseClient, now: Date, limit: number): Promise<DocumentRequestRow[]> {
  // Re-review m1: read from the clean customer files' side, inside an 8-day window (a request lives 7
  // days; one more for a verdict that lands late), then their requests in batches of 100.
  const since = new Date(now.getTime() - 8 * DAY_MS).toISOString();
  const { data: files, error } = await db.from("documents")
    .select("request_id, versions:document_versions!document_versions_document_fkey!inner(id)")
    .eq("source", "customer").is("deleted_at", null).gte("created_at", since)
    .eq("versions.status", "ready").eq("versions.scan_status", "clean")
    .order("created_at", { ascending: false }).limit(500);
  if (error) throw new Error(`listRequestsMissingReceivedTask (files) failed: ${error.message}`);
  const ids = [...new Set(((files ?? []) as { request_id: string }[]).map((d) => d.request_id))];
  const dayAgo = now.getTime() - DAY_MS;
  // Open, or completed in the last 24 hours, or expired in the last 24 hours (deviation 13: a file
  // reserved before the expiry may finish after it).
  const recent = (r: DocumentRequestRow): boolean =>
    r.completed_at ? Date.parse(r.completed_at) > dayAgo : Date.parse(r.expires_at) > dayAgo;
  const out: DocumentRequestRow[] = [];
  for (let i = 0; i < ids.length && out.length < limit; i += 100) {
    const batch = ids.slice(i, i + 100);
    const [reqs, tasks] = await Promise.all([
      db.from("document_requests").select(REQUEST_COLS).in("id", batch).is("revoked_at", null),
      db.from("tasks").select("document_request_id").eq("document_request_kind", "received").in("document_request_id", batch),
    ]);
    if (reqs.error) throw new Error(`listRequestsMissingReceivedTask (requests) failed: ${reqs.error.message}`);
    if (tasks.error) throw new Error(`listRequestsMissingReceivedTask (tasks) failed: ${tasks.error.message}`);
    const hasTask = new Set(((tasks.data ?? []) as { document_request_id: string }[]).map((t) => t.document_request_id));
    out.push(...((reqs.data ?? []) as DocumentRequestRow[]).filter((r) => !hasTask.has(r.id) && recent(r)));
  }
  return out.slice(0, limit);
}

/** Re-review R1: the at-most-once send stamp. True only for the caller that moved sent_at from null. */
export async function claimDocumentRequestSend(db: SupabaseClient, accountId: string, requestId: string, now: Date): Promise<boolean> {
  const { data, error } = await db.from("document_requests").update({ sent_at: now.toISOString() })
    .eq("account_id", accountId).eq("id", requestId).is("sent_at", null).select("id");
  if (error) throw new Error(`claimDocumentRequestSend failed: ${error.message}`);
  return (data ?? []).length === 1;
}

/** Re-review R1: the send did not go out (blocked, deferred, failed): the stamp goes, so a later send may try. */
export async function clearDocumentRequestSend(db: SupabaseClient, accountId: string, requestId: string): Promise<void> {
  const { error } = await db.from("document_requests").update({ sent_at: null }).eq("account_id", accountId).eq("id", requestId);
  if (error) throw new Error(`clearDocumentRequestSend failed: ${error.message}`);
}
```

with a case in Step 2: a request with a clean customer file and no To-do is listed; after `ensureDocumentRequestTask(…, kind: "received")` it is not; a revoked request with a clean file is not; a request whose only customer file is pending is not; a request completed 2 days ago is not (set `completed_at` back through the service client); a request EXPIRED 2 hours ago with a clean file IS listed and one expired 2 days ago is not (set `created_at` and `expires_at` back together; re-review m1, deviation 13); with 101 missing requests the batch loop still answers the newest `limit` (mutations: drop the `.is("revoked_at", null)`, the clean filter, the task subtraction, or the expired-24h branch -> FAILS). And the stamp: `claimDocumentRequestSend` answers true, then false for a second claim; after `clearDocumentRequestSend` a claim answers true again (mutation: drop `.is("sent_at", null)` -> the second claim answers true -> FAILS).

(The embedded select `versions:document_versions!document_versions_document_fkey(…)` is the name 2a's e2e reads with, `e2e/documents-scan.spec.ts:46`. The `contact:contacts!inner(…)` embed relies on `client_group_members`' foreign key to `contacts`; if PostgREST answers PGRST201 (ambiguous), name the constraint as `contacts!client_group_members_contact_fkey` after reading `0069_client_groups.sql`, and say so.)

- [ ] **Step 7: Export** from `packages/db/src/index.ts` (beside the documents block, `:269-288`): every function and type above from `./document-requests`, and `STAFF_DOCUMENT_SOURCES`, `CUSTOMER_AUTHOR_PREFIX`, `isCustomerAuthor`, `DOCUMENT_REQUEST_DAYS`, `DOCUMENT_REQUEST_DAILY_STARTS`, `DOCUMENT_REQUEST_MAX_ITEMS`, `DOCUMENT_REQUEST_NOTE_MAX`, `cleanRequestItems`, `documentRequestState` and the three types from `./document-rules`.

- [ ] **Step 8: `documents.test.ts` gains one case** (inside its existing `markDocumentVersionReady` describe; read it first):

```ts
  it("a customer's ready version emits document.added as the system actor (mutation: drop actorType from emit -> actor_type 'user' -> FAILS)", () =>
    withTestAccount(async (db, accountId) => {
      const ana = (await createContact(db, accountId, { firstName: "Ana" }, ACTOR)).id;
      const docId = await createDocument(db, { accountId, record: { kind: "contact", id: ana }, title: "Seguro", category: "insurance", expiresOn: null, ownersOnly: false, source: "upload", createdBy: ACTOR });
      const r = await reserveDocumentVersion(db, { accountId, documentId: docId, bytes: 10, contentType: "application/pdf", originalName: "a.pdf", uploadedBy: ACTOR });
      if (r.status !== "ok") throw new Error(r.status);
      await markDocumentVersionReady(db, { accountId, documentId: docId, versionId: r.versionId, bytes: 10, sha256: "c".repeat(64), actorId: "customer:x", actorType: "system" });
      const { data } = await db.from("events").select("actor_type, actor_id").eq("account_id", accountId).eq("type", "document.added").single();
      expect(data).toEqual({ actor_type: "system", actor_id: "customer:x" });
    }));
```
(`events`' actor columns are named in `0001_tenancy.sql:62`; read the line and use its column names.)

- [ ] **Step 9: Run** on the replica behind PostgREST: `document-requests.test.ts`, `documents.test.ts`, `document-vault-schema.test.ts` (now comparing the CHECK with the imported `DOCUMENT_SOURCES`; probe: drop `customer` from `DOCUMENT_SOURCES` → that case FAILS), `document-requests-schema.test.ts`. All PASS; paste the summary blocks. `pnpm --filter web typecheck` → 0 (the barrel's new names compile; `DocumentSource` gained `customer`: every exhaustive switch on it must now handle `customer`; if typecheck names a web file, that file belongs to Task 4 (`documents-load.ts`) or Task 3b (`timeline-rows.ts`): leave it and report, do not edit another task's file).
- [ ] **Step 10: Probes, by name:** (a) `listOpenDocumentRequests` counting `status === "ready"` without `scan_status === "clean"` → "an item is answered only by…" FAILS; (b) `revokeDocumentRequest` without `.is("revoked_at", null)` → the revoke case FAILS; (c) `getRequestDocument` without `.eq("request_id", …)` → the start case FAILS; (d) `documentRequestTarget` reading `.eq("is_primary", true)` → the target case FAILS; (e) `cleanRequestItems` allowing 10 → the rules case FAILS. Paste each.
- [ ] **Step 11: Commit** `-- packages/db/src/document-requests.ts packages/db/src/test/document-requests.test.ts packages/db/src/document-rules.ts packages/db/src/documents.ts packages/db/src/index.ts packages/db/src/test/documents.test.ts packages/db/src/test/document-vault-schema.test.ts`, message "db: the request module; customer is a source; a customer file's event is the system's (S-07 2b)".

---

## Task 3b: The timeline: the request row, the customer mark, the request To-do's mark (bis-crm)

**Review:** opus. **Scratch:** ports `55588`/`55589`/`55590`.

**Files**
- Modify: `packages/db/src/record.ts` (the union, the documents source's fourth read), `packages/db/src/activities.ts` (`TASK_COLS` gains `document_request_id`), `packages/db/src/test/record.test.ts` (one case), `packages/db/src/test/timeline-merge.test.ts` (`+ 2` → `+ 3` at `:146`; a refused `document_requests` read beside `:169-183`)
- Modify: `apps/web/src/lib/record/{author-mark,timeline-rows,recent-rows}.ts` and their tests; `…/contacts/[contactId]/activity-timeline.tsx` (+ `activity-timeline.rows.test.ts`); `…/groups/[groupId]/group-timeline.tsx` (+ its test); `…/contacts/contact-drawer.tsx` (`ROW_ICON` only); `apps/web/src/lib/contacts/drawer-summary.ts` (`ROW_KINDS` only) (+ test); `…/api/contacts/[contactId]/summary/route.reads.test.ts` (`MEASURED` and its comment only)

**Interfaces**
- Consumes: `listDocumentRequestTimeline`, `TimelineDocumentRequest`, `isCustomerAuthor` (Task 3); keys `timeline.documentRequest`, `timeline.documentRequestOne`, `timeline.documentCustomer`, `documents.category.*` (Task 2).
- Produces: `TimelineEntry` gains `{ kind: "documentRequest"; id: string; at: string; contactId: string; request: TimelineDocumentRequest }`; `TimelineTask` gains `document_request_id?: string | null` (optional, so no task fixture changes).

- [ ] **Step 1: Read** `sed -n 280,300p packages/db/src/record.ts`, `:360-390`; `sed -n 20,60p apps/web/src/lib/record/author-mark.ts`; `sed -n 60,115p apps/web/src/lib/record/timeline-rows.ts`; `sed -n 20,50p apps/web/src/lib/record/recent-rows.ts`; `activity-timeline.tsx:175-195`; `group-timeline.tsx:120-140`; `grep -n "ROW_ICON\|ROW_KINDS" contact-drawer.tsx drawer-summary.ts`; `timeline-merge.test.ts:140-185`; `route.reads.test.ts:50-72`.

- [ ] **Step 2: Failing tests.**
  - `apps/web/src/lib/record/author-mark.test.ts`, three cases:

```ts
  it("a customer's file and its versions carry the customer mark (mutation: drop the customer: branch -> person -> FAILS)", () => {
    const doc = { kind: "document", id: "d1", at: AT, contactId: "c1", document: { id: "d1", title: "Seguro", category: "insurance", source: "customer", created_by: "customer:r1", created_at: AT, deleted_at: null, contact_id: "c1", client_group_id: null } } as TimelineEntry;
    const ver = { kind: "documentVersion", id: "v2", at: AT, contactId: "c1", version: { id: "v2", document_id: "d1", title: "Seguro", category: "insurance", uploaded_by: "customer:r1", created_at: AT, deleted_at: null, contact_id: "c1", client_group_id: null } } as TimelineEntry;
    expect([authorOf(doc), authorOf(ver)]).toEqual([{ kind: "customer", personId: null }, { kind: "customer", personId: null }]);
  });
  it("a request row carries the person who asked (mutation: automation -> FAILS)", () => {
    const req = { kind: "documentRequest", id: "r1", at: AT, contactId: "c1", request: { id: "r1", items: [{ key: "id", category: "id", note: null }], channel: "text", created_by: "u_ana", created_at: AT, contact_id: "c1", client_group_id: null } } as TimelineEntry;
    expect(authorOf(req)).toEqual({ kind: "person", personId: "u_ana" });
  });
  it("a To-do opened for a request carries the automation mark (mutation: drop the document_request_id branch -> person -> FAILS)", () => {
    const task = { kind: "task", id: "t1", at: AT, contactId: "c1", task: { id: "t1", title: "Ana sent documents · Review", due_at: AT, completed_at: null, created_at: AT, consent_event_id: null, call_id: null, assigned_to: null, created_by: null, document_request_id: "r1" } } as TimelineEntry;
    expect(authorOf(task)).toEqual({ kind: "automation", personId: null });
  });
```
  (`AT` and `TimelineEntry` are this file's own; read its imports.)
  - `apps/web/src/lib/record/timeline-rows.test.ts`, two cases, each asserting BOTH languages against literals:

```ts
  it("a request row reads 'asked for N documents' with the items in the reader's language (mutation: the One key for 2 -> FAILS)", () => {
    const req = (items: { key: string; category: string; note: string | null }[]) => ({ kind: "documentRequest", id: "r1", at: AT, contactId: "c1",
      request: { id: "r1", items, channel: "text", created_by: "u1", created_at: AT, contact_id: "c1", client_group_id: null } }) as TimelineEntry;
    const two = [{ key: "insurance", category: "insurance", note: null }, { key: "other", category: "other", note: "Pool permit" }];
    for (const [locale, verb, detail] of [["en", "asked for 2 documents", "Insurance, Pool permit"], ["es", "pidió 2 documentos", `${m["documents.category.insurance.es"]}, Pool permit`]] as const) {
      const [row] = timelineRows([req(two)], { zone: "America/Chicago", tr: trFor(locale), author: author(trFor(locale)) });
      expect([row!.verb, row!.detail]).toEqual([verb, detail]);
    }
    const [one] = timelineRows([req([two[0]!])], { zone: "America/Chicago", tr: trFor("es"), author: author(trFor("es")) });
    expect(one!.verb).toBe("pidió 1 documento");
  });
  it("a customer's file reads 'sent <title>' (mutation: keep 'added a file' for source customer -> FAILS)", () => {
    const doc = { kind: "document", id: "d1", at: AT, contactId: "c1", document: { id: "d1", title: "Seguro", category: "insurance", source: "customer", created_by: "customer:r1", created_at: AT, deleted_at: null, contact_id: "c1", client_group_id: null } } as TimelineEntry;
    expect(timelineRows([doc], { zone: "America/Chicago", tr: trFor("en"), author: author(trFor("en")) })[0]!.verb).toBe("sent Seguro");
    expect(timelineRows([doc], { zone: "America/Chicago", tr: trFor("es"), author: author(trFor("es")) })[0]!.verb).toBe("mandó Seguro");
  });
```
  (`trFor`, `author` and `m` are names this test file already builds its translators with; read the top of the file and use its own helpers under their own names. The English detail "Insurance" is `m["documents.category.insurance"]`; compare with that literal value read from `messages.ts`, not with `t()`.)
  - `recent-rows.test.ts`: a `documentRequest` entry's excerpt is `null` (mutation: return the items -> FAILS). `drawer-summary.test.ts`: `ROW_KINDS` includes `"documentRequest"` (its existing exhaustiveness case, extended). Both timelines' row tests: a `documentRequest` row renders its verb with the Send icon marker the file uses for kinds (follow the `documentRemoved` case at `activity-timeline.rows.test.ts:211` and `group-timeline.test.ts:156`).
  - `packages/db/src/test/record.test.ts` (behind PostgREST): a contact with one request reads a `documentRequest` entry whose `at` is the request's `created_at` and whose `request.items` equals what was created (mutation: drop the fourth read -> FAILS).
  - `timeline-merge.test.ts`: `:146` `TIMELINE_SOURCES.length + 2` → `+ 3`; a new case: a refused `document_requests` read fails the `documents` source (copy the `document_scan_timeline` case at `:169-183` with the relation name changed).

- [ ] **Step 3: Run them to see them fail** (web by path; db on the replica). Expected: each new case FAILS, typecheck errors on the new kind.

- [ ] **Step 4: Implement.**
  - `record.ts`: the union gains `/** S-07 2b (plan deviation 6): one row per request, read from document_requests so RLS decides. `id` is the request's. */ | { kind: "documentRequest"; id: string; at: string; contactId: string; request: TimelineDocumentRequest }`; in the `documents` settle, `Promise.all` gains `listDocumentRequestTimeline(db, accountId, who, opts.groupId ?? null, page)` as a fourth read, mapped `(r): TimelineEntry => ({ kind: "documentRequest", id: r.id, at: r.created_at, contactId: r.contact_id ?? "", request: r })`; the comment above it says "four kinds". `TimelineTask` gains `document_request_id?: string | null;`.
  - `activities.ts:50`: `TASK_COLS` gains `, document_request_id` at the end.
  - `author-mark.ts`: 

```ts
    case "task":
      if (entry.task.call_id) return { kind: "ai", personId: null };
      if (entry.task.consent_event_id || entry.task.document_request_id) return { kind: "automation", personId: null };
      return { kind: "person", personId: entry.task.created_by };
    // S-07 2b: a customer's upload is "customer:<request id>" (0080), the customer mark; staff files stay the person's.
    case "document": return isCustomerAuthor(entry.document.created_by) ? { kind: "customer", personId: null } : { kind: "person", personId: entry.document.created_by };
    case "documentVersion": return isCustomerAuthor(entry.version.uploaded_by) ? { kind: "customer", personId: null } : { kind: "person", personId: entry.version.uploaded_by };
    // S-07 2b: the person who asked.
    case "documentRequest": return { kind: "person", personId: entry.request.created_by };
```
  (`isCustomerAuthor` from `@bis/db/document-rules`; this module is browser-reached.)
  - `timeline-rows.ts`: the `document` case's verb key becomes `entry.document.source === "camera" ? "timeline.documentPhoto" : entry.document.source === "customer" ? "timeline.documentCustomer" : "timeline.document"`; a new case:

```ts
    // S-07 2b (plan deviation 6): "{person} asked for N documents", the items in the reader's language.
    case "documentRequest": {
      const n = entry.request.items.length;
      return {
        verb: tr.text(n === 1 ? "timeline.documentRequestOne" : "timeline.documentRequest", { count: n }),
        status: null,
        detail: entry.request.items.map((i) => (i.category === "other" && i.note ? i.note : tr.text(`documents.category.${i.category}` as MessageKey))).join(", "),
      };
    }
```
  - `recent-rows.ts`: `case "documentRequest": return null;`. Both timelines: a `documentRequest` case beside `documentRemoved`, icon `Send` from `lucide-react`. `contact-drawer.tsx` `ROW_ICON`: `documentRequest: Send`. `drawer-summary.ts` `ROW_KINDS`: add `"documentRequest"`.
  - `route.reads.test.ts:61`: `const MEASURED = 26; // measured <date>: 26 reads (+1 prefs), the 26th is request:document_requests (S-07 2b); 25 before S-07 2b, …` (keep the rest of the comment). Run the test first with the new read in place and READ the measured count from its failure message; if it is not 26, stop and report.

- [ ] **Step 5: Run** every file this task touched (web by path; `record.test.ts`, `timeline-merge.test.ts`, `documents.test.ts` on the replica) plus `src/lib/i18n/ratchet.test.ts`; `pnpm --filter web typecheck`; `pnpm --filter web exec eslint <touched files>`. All PASS.
- [ ] **Step 6: Probes:** (a) `author-mark.ts` without the `isCustomerAuthor` branch on `document` → the customer case FAILS; (b) the fourth read removed from `record.ts` → `record.test.ts`'s case and `timeline-merge`'s `+ 3` FAIL; (c) `timelineRows` with `timeline.documentRequest` for one item → "pidió 1 documento" FAILS; (d) `MEASURED` left at 25 → `route.reads.test.ts` FAILS. Paste each.
- [ ] **Step 7: Commit** every path above, message "timeline: a request row with the person who asked, the customer mark on a customer's file, the automation mark on its To-do (S-07 2b)".

---

## Task 4: The shared finish; the browser upload core; the card's read accepts `customer`; `scanVersion` opens the To-do (bis-crm)

**Review:** opus. **Runs beside:** Task 3b.

**Files**
- Create: `apps/web/src/lib/documents/finish-upload.ts` (+ `finish-upload.test.ts`), `apps/web/src/lib/documents/upload-core.ts`, `apps/web/src/lib/document-requests/request-task.ts` (+ `request-task.test.ts`)
- Modify: `…/contacts/documents-actions.ts` (the finish's body and `cleanUp` move out; nothing else), `apps/web/src/lib/documents/upload-client.ts` (re-exports), `apps/web/src/lib/documents/scan-version.ts` (+ test), `apps/web/src/lib/documents/documents-load.ts:56` (+ test)

**Interfaces**
- Consumes: `markDocumentVersionReady(…, actorType)`, `getDocumentRequestForVersion`, `documentRequestTarget`, `ensureDocumentRequestTask`, `DocumentRequestRow` (Task 3); keys `documents.request.task.received`, `documents.request.task.storageFull` (Task 2).
- Produces:
  - `finishStoredUpload(svc: SupabaseClient, a: { accountId: string; documentId: string; versionId: string; trashed: boolean; actorId: string; actorType?: ActorType }): Promise<{ ok: true; scan: ScanResult } | { ok: false; error: string }>` (the error is a `documents.error.*` key, exactly the staff finish's), and `cleanUpUpload(svc, accountId, documentId, versionId, path): Promise<void>` (never throws).
  - `upload-core.ts`: `prepareFile`, `xhrPut`, `UPLOAD_STALL_MS`, `type Refusal` moved verbatim; `upload-client.ts` re-exports the first three so every existing import stays valid.
  - `openRequestTask(db: SupabaseClient, accountId: string, request: DocumentRequestRow, kind: "received" | "storage_full", now: Date): Promise<void>` (never throws; logs by request id) and `openReceivedTaskFor(db: SupabaseClient, v: { accountId: string; versionId: string }, now: Date): Promise<void>` (the clean hook; a staff file does nothing).
  - `ScanDeps` gains `afterClean?: (db: SupabaseClient, v: ScanTarget, now: Date) => Promise<void>`; `REAL` sets it to `openReceivedTaskFor`; `ScanOptions` gains `now?: Date` (the pass passes `ctx.now`, Task 6b; plan review M2).

- [ ] **Step 1: Read** `documents-actions.ts:196-306` (the clean-up, the finish, the abandon), `upload-client.ts:1-141`, `scan-version.ts:1-100`, `scan-version.test.ts:1-40`, `documents-load.ts:40-82`, and `grep -rn "scan-version" apps/web/src --include=*.test.ts` (every test that reaches `scanVersion`: `documents-actions.test.ts` mocks the module, `:27`; read how `passes/documents-scan.test.ts` reaches it).

- [ ] **Step 2: Failing tests.**
  - `apps/web/src/lib/documents/finish-upload.test.ts` (fakes for the service client's `storage.from().download/remove` and the `@bis/db` calls, one shared call log as 2a's `scan-version.test.ts` does):

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const calls: string[] = [];
const getUploadingVersion = vi.fn();
const getDocumentVersion = vi.fn();
const markDocumentVersionReady = vi.fn();
const discardDocumentUpload = vi.fn(async () => { calls.push("rows"); });
vi.mock("@bis/db", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@bis/db")>()),
  getUploadingVersion: (...a: unknown[]) => getUploadingVersion(...a),
  getDocumentVersion: (...a: unknown[]) => getDocumentVersion(...a),
  markDocumentVersionReady: (...a: unknown[]) => markDocumentVersionReady(...a),
  discardDocumentUpload: (...a: unknown[]) => discardDocumentUpload(...a),
}));
const scanVersion = vi.fn();
vi.mock("@/lib/documents/scan-version", () => ({ scanVersion: (...a: unknown[]) => scanVersion(...a) }));
const { finishStoredUpload } = await import("./finish-upload");

const PDF = new TextEncoder().encode("%PDF-1.7\n%%EOF\n");
function svc(blob: Blob | null) {
  return {
    storage: { from: () => ({
      download: async () => (blob ? { data: blob, error: null } : { data: null, error: { message: "gone" } }),
      remove: async () => { calls.push("object"); return { data: [], error: null }; },
    }) },
  } as never;
}
const V = { id: "v1", document_id: "d1", account_id: "a1", storage_path: "a1/d1/v1", bytes: PDF.length, content_type: "application/pdf", status: "uploading" };
const A = { accountId: "a1", documentId: "d1", versionId: "v1", trashed: false, actorId: "customer:r1", actorType: "system" as const };

beforeEach(() => { calls.length = 0; vi.clearAllMocks(); getUploadingVersion.mockResolvedValue(V); markDocumentVersionReady.mockResolvedValue(true); scanVersion.mockResolvedValue("clean"); });

describe("finishStoredUpload: the staff finish's body, now shared (spec 4.4: customer uploads are checked and scanned exactly like staff uploads)", () => {
  it("checks the bytes, marks ready as the given actor, and scans with holdErrors (mutation: drop holdErrors -> FAILS; drop actorType -> FAILS)", async () => {
    const r = await finishStoredUpload(svc(new Blob([PDF], { type: "application/pdf" })), A);
    expect(r).toEqual({ ok: true, scan: "clean" });
    expect(markDocumentVersionReady.mock.calls[0]![1]).toMatchObject({ accountId: "a1", documentId: "d1", versionId: "v1", bytes: PDF.length, actorId: "customer:r1", actorType: "system" });
    expect(scanVersion.mock.calls[0]![1]).toEqual({ accountId: "a1", versionId: "v1", storagePath: "a1/d1/v1", attempts: 0 });
    expect(scanVersion.mock.calls[0]![3]).toEqual({ holdErrors: true });
  });
  it("a size that differs from the reservation removes the object THEN the rows, and refuses (mutation: rows first -> FAILS)", async () => {
    const r = await finishStoredUpload(svc(new Blob([PDF, PDF], { type: "application/pdf" })), A);
    expect(r).toEqual({ ok: false, error: "documents.error.upload" });
    expect(calls).toEqual(["object", "rows"]);
    expect(markDocumentVersionReady).not.toHaveBeenCalled();
  });
  it("bytes that are not the declared type answer badType (mutation: skip checkDocumentBytes -> FAILS)", async () => {
    const fake = new TextEncoder().encode("MZ".padEnd(PDF.length, "x"));
    expect(await finishStoredUpload(svc(new Blob([fake], { type: "application/pdf" })), A)).toEqual({ ok: false, error: "documents.error.badType" });
  });
  it("a trashed file's upload is removed and refused; no object downloadable leaves the rows for the sweep (mutation: clean up on a failed download -> FAILS)", async () => {
    expect(await finishStoredUpload(svc(new Blob([PDF], { type: "application/pdf" })), { ...A, trashed: true })).toEqual({ ok: false, error: "documents.error.trashed" });
    calls.length = 0;
    expect(await finishStoredUpload(svc(null), A)).toEqual({ ok: false, error: "documents.error.upload" });
    expect(calls).toEqual([]);
  });
  it("no uploading row: an orphan object at the reserved path is removed only when no row of that id exists (mutation: remove when a ready row exists -> FAILS)", async () => {
    getUploadingVersion.mockResolvedValue(null);
    getDocumentVersion.mockResolvedValue({ id: "v1", status: "ready" });
    expect(await finishStoredUpload(svc(null), A)).toEqual({ ok: false, error: "documents.error.refused" });
    expect(calls).toEqual([]);
    getDocumentVersion.mockResolvedValue(null);
    await finishStoredUpload(svc(null), A);
    expect(calls).toEqual(["object"]);
  });
});
```
  (`checkDocumentBytes` accepts this tiny PDF when it begins `%PDF-` and ends `%%EOF`; read `content-check.ts:1-60` and build the fixture from its own rule if it needs more.)
  - `apps/web/src/lib/document-requests/request-task.test.ts`: with `@bis/db` mocked (`documentRequestTarget`, `ensureDocumentRequestTask`, `getDocumentRequestForVersion`) and a fake `db.from("accounts")` answering `{ language: "es" }`: `openRequestTask(db, "a1", REQ, "received", NOW)` calls `ensureDocumentRequestTask` with `{ requestId: REQ.id, kind: "received", contactId: "c9", title: "Ana García mandó documentos · Revisar", dueAt: NOW.toISOString() }` (the title compared with the LITERAL Spanish string; mutation: the request's language instead of the account's -> with REQ.language "en" FAILS); `"storage_full"` uses `documents.request.task.storageFull`; a target of `null` opens nothing; an `ensureDocumentRequestTask` that throws is logged with the request id and never rethrown, and the log line does not contain any 43-character base64url string (mutation: rethrow -> FAILS); `openReceivedTaskFor` with `getDocumentRequestForVersion` → `null` calls nothing (mutation: open for a staff file -> FAILS).
  - `scan-version.test.ts`, two cases: a clean verdict recorded `ok` calls `deps.afterClean` with `(db, target, opts.now)` exactly once (and with a `Date` when `opts.now` is absent) (mutation: call it before `recordDocumentScan` or on `stale` -> FAILS: assert order in the shared call log and that a `stale` answer does not call it); an `afterClean` that rejects still answers `"clean"` (mutation: await it unguarded -> FAILS).
  - `documents-load.test.ts`: a document with `source: "customer"` parses (mutation: keep the two-source check at `:56` -> the whole load reads as an error -> FAILS); a `source: "fax"` still fails the parse.

- [ ] **Step 3: Run them to see them fail** (by path). `finish-upload.ts`, `request-task.ts` missing; the scan and load cases FAIL.

- [ ] **Step 4: `finish-upload.ts`.** Move `cleanUp` (rename `cleanUpUpload`, export), `mediaType`, and the finish's body from `const version = await getUploadingVersion(…)` through `return { ok: true, scan };` (`documents-actions.ts:229-283`) into:

```ts
import { createHash } from "node:crypto";
import {
  getUploadingVersion, getDocumentVersion, markDocumentVersionReady, discardDocumentUpload, DOCUMENT_BUCKET,
  type SupabaseClient, type ActorType,
} from "@bis/db";
import { loggableError } from "@/lib/loggable-error";
import { checkDocumentBytes } from "@/lib/documents/content-check";
import { scanVersion, type ScanResult } from "@/lib/documents/scan-version";

/**
 * The finish step's body (spec 5.1 of part 1; 3.4 of part 2): shared by the staff action, after its
 * request-client proof, and by the customer route (S-07 2b), after its token proof. `svc` is the
 * caller's service client; every read and write is scoped to `accountId`. The object is checked
 * (size = the reservation, the stored type = the declared one, the bytes that type), hashed, marked
 * ready as the caller's actor, and scanned at once with holdErrors: the finish NEVER spends an
 * attempt (2a re-review N2a). Answers a documents.error.* key; never throws.
 */
type Finish = { ok: true; scan: ScanResult } | { ok: false; error: string };
const REFUSED = "documents.error.refused";

function log(where: string, accountId: string, e: unknown): void {
  console.error(`documents ${where} (account ${accountId}): ${loggableError(e)}`);
}
const mediaType = (t: string): string => t.split(";")[0]!.trim().toLowerCase();

/** Removes a refused or failed upload: the object first, then the rows; rows kept for the sweep if the object stays. Never throws. */
export async function cleanUpUpload(svc: SupabaseClient, accountId: string, documentId: string, versionId: string, path: string): Promise<void> {
  const { error } = await svc.storage.from(DOCUMENT_BUCKET).remove([path]);
  if (error) {
    log(`cleanup: object ${path} not removed, rows kept for the sweep`, accountId, error);
    return;
  }
  await discardDocumentUpload(svc, accountId, documentId, versionId).catch((e: unknown) => log("cleanup: rows", accountId, e));
}

export async function finishStoredUpload(svc: SupabaseClient, a: {
  accountId: string; documentId: string; versionId: string; trashed: boolean; actorId: string; actorType?: ActorType;
}): Promise<Finish> {
  const { accountId, documentId: docId, versionId: verId } = a;
  try {
    // … the moved body, unchanged except: `doc.deleted_at !== null` becomes `a.trashed`, `cleanUp` becomes
    // `cleanUpUpload`, `fail(x)` becomes `{ ok: false, error: x }`, and markDocumentVersionReady receives
    // `actorId: a.actorId, actorType: a.actorType`. Every comment moves with its line.
  } catch (e) {
    log("finish", accountId, e);
    return { ok: false, error: "documents.error.upload" };
  }
}
```
  The `// …` above is NOT a placeholder for new code: it is the instruction to MOVE `documents-actions.ts:229-283` verbatim with exactly those four mechanical substitutions; the reviewer diffs the moved block against `git show HEAD:"apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/contacts/documents-actions.ts"` lines 229-283 and expects only those substitutions. `REFUSED` covers the moved `fail(REFUSED)` lines.
  In `documents-actions.ts`: delete the moved `cleanUp`, `mediaType` and body; `finishDocumentUploadAction` keeps its proof (`:214-226`) and then `return finishStoredUpload(serviceDb(), { accountId, documentId: docId, versionId: verId, trashed: doc.deleted_at !== null, actorId: access.userId });`; `abandonDocumentUploadAction` calls `cleanUpUpload`; remove imports nothing else uses (`createHash`, `checkDocumentBytes`, `scanVersion`, `ScanResult` only if unused; `ScanResult` stays as the return type's import).
- [ ] **Step 5: `upload-core.ts`.** Move `Refusal`, `refusal`, `prepareFile` (`upload-client.ts:26-48`), `UPLOAD_STALL_MS` and `xhrPut` (`:100-131`) verbatim into `apps/web/src/lib/documents/upload-core.ts` (imports: `DOCUMENT_MAX_BYTES`, `isDocumentContentType`, `DocumentContentType` from `@bis/db/document-rules`; `typeForFile`, `isImageType`, `shownSize` from `./rules`; `stripImage`, `ImageType` from `./strip-image`; NO import of any action). `upload-client.ts` imports them from `./upload-core` and adds `export { prepareFile, xhrPut, UPLOAD_STALL_MS } from "./upload-core";`. `upload-client.test.ts` passes unchanged. Add to `upload-core.ts`'s header: "Browser-safe; no server action is imported here, so a public page can use it (S-07 2b)."
- [ ] **Step 6: `request-task.ts`.**

```ts
import {
  documentRequestTarget, ensureDocumentRequestTask, getDocumentRequestForVersion,
  type DocumentRequestRow, type SupabaseClient,
} from "@bis/db";
import { m } from "@/lib/messages";
import { t } from "@/lib/i18n/t";
import { loggableError } from "@/lib/loggable-error";

/**
 * The ONE work-queue To-do per request and kind (spec 4.4, 4.5; plan deviation 4): "Ana García sent
 * documents · Review" on the first clean file, "… couldn't send documents: your storage is full" on
 * an over-quota start. Titled in the ACCOUNT's language (staff read it). Never throws: a To-do that
 * cannot be opened is logged by request id; the file's own timeline row still says it arrived.
 */
const KEY = { received: "documents.request.task.received", storage_full: "documents.request.task.storageFull" } as const;
const ACTOR = "documents-request";

export async function openRequestTask(
  db: SupabaseClient, accountId: string, request: DocumentRequestRow, kind: "received" | "storage_full", now: Date,
): Promise<void> {
  try {
    const target = await documentRequestTarget(db, accountId, request);
    if (!target) return;
    const { data, error } = await db.from("accounts").select("language").eq("id", accountId).maybeSingle();
    if (error) throw new Error(`account language: ${error.message}`);
    const lang = (data as { language: string | null } | null)?.language === "es" ? "es" : "en";
    await ensureDocumentRequestTask(db, accountId, {
      requestId: request.id, kind, contactId: target.contactId, title: t(m, KEY[kind], lang, { name: target.name }), dueAt: now.toISOString(),
    }, ACTOR, "system");
  } catch (e) {
    console.error(`document request ${request.id} (account ${accountId}): the ${kind} To-do was not opened: ${loggableError(e)}`);
  }
}

/** scanVersion's clean hook: a customer file's first clean version opens its request's "received" To-do. */
export async function openReceivedTaskFor(db: SupabaseClient, v: { accountId: string; versionId: string }, now: Date): Promise<void> {
  try {
    const request = await getDocumentRequestForVersion(db, v.accountId, v.versionId);
    if (request) await openRequestTask(db, v.accountId, request, "received", now);
  } catch (e) {
    console.error(`documents scan (account ${v.accountId}): the request To-do check failed for version ${v.versionId}: ${loggableError(e)}`);
  }
}
```
  (If `t`'s path or signature differs from `lib/i18n/t.ts:36`, `t(catalogue, key, locale, params)`, use the real one. `request-task.ts` contains no `serviceDb`: its callers pass their client.)
- [ ] **Step 7: `scan-version.ts`.** `ScanOptions` gains `now?: Date`; `ScanDeps` gains `afterClean?: (db: SupabaseClient, v: ScanTarget, now: Date) => Promise<void>`; `REAL` gains `afterClean: openReceivedTaskFor` (import from `@/lib/document-requests/request-task`); the clean branch becomes:

```ts
  if (verdict.verdict === "clean") {
    const r = await recordDocumentScan(db, { accountId: v.accountId, versionId: v.versionId, verdict: "clean" });
    if (r.status !== "ok") return "stale";
    // S-07 2b: a customer file's clean verdict opens its request's To-do (0080's trigger already set
    // completed_at when it was the last item). Best-effort: the verdict stands whatever happens here.
    await deps.afterClean?.(db, v, opts.now ?? new Date()).catch(() => undefined);
    return "clean";
  }
```
- [ ] **Step 8: `documents-load.ts:56`:** `&& (v.source === "upload" || v.source === "camera" || v.source === "customer")` (or `DOCUMENT_SOURCES.includes(v.source)` from `@bis/db/document-rules`).
- [ ] **Step 9: Run** `finish-upload.test.ts`, `request-task.test.ts`, `scan-version.test.ts`, `documents-load.test.ts`, `upload-client.test.ts`, `…/contacts/documents-actions.test.ts` (**UNEDITED**: if it fails, the move changed behaviour; fix the move, never the test, except a missing name in its `@bis/db` factory), `apps/web/src/lib/automations/passes/documents-scan.test.ts` (unchanged; if it fails on `afterClean`, read why and report: the pass is bis-automations' file and is not edited here), `src/lib/documents/read-gate.test.ts`, `"src/app/(dashboard)/dashboard/accounts/[accountId]/in-account-service-reads.test.ts"`; `pnpm --filter web typecheck`; eslint on touched files. All PASS.
- [ ] **Step 10: Probes:** (a) `finishStoredUpload` without `{ holdErrors: true }` → case 1 FAILS; (b) clean-up rows before object → case 2 FAILS; (c) `afterClean` before `recordDocumentScan` → the scan-version order case FAILS; (d) `openRequestTask` with the request's language → the request-task title case FAILS. Paste each.
- [ ] **Step 11: Commit** every path above, message "documents: one finish for staff and customers; the browser upload core; a customer file's clean verdict opens its request's To-do (S-07 2b)".

---

## Task 5: The token, the public rule, the two public routes, the customer page's state (bis-crm)

**Review:** opus.

**Files**
- Create: `apps/web/src/lib/document-requests/{token,customer-upload,customer-state}.ts` and their tests; `apps/web/src/app/api/d/[token]/start/route.ts`, `apps/web/src/app/api/d/[token]/finish/route.ts` and their `route.test.ts`

**Interfaces**
- Consumes: Task 3's module; `finishStoredUpload`, `cleanUpUpload`, `openRequestTask` (Task 4); `removedReason` (`@bis/db/document-rules:46`); `getBranding`, `brandDisplayName`, `brandLogoUrl` (`packages/db/src/branding.ts:345, :415, :164`); `listPhoneNumbersForAccount` (`voice.ts:847`); `extensionAllowed` (`lib/documents/rules.ts`).
- Produces:
  - `token.ts` (server-only): `requestToken(requestId: string): string` (43 base64url characters), `tokenHash(token: string): string` (64 hex), `isTokenShape(t: unknown): t is string`, `requestUrl(origin: string, requestId: string): string` (`<origin>/d/<token>`).
  - `customer-state.ts` (browser-safe): `type CustomerFileState = "checking" | "received" | "virus" | "password" | "unscannable"`; `type CustomerFile = { state: CustomerFileState; ageMs: number }` (`ageMs` = the server's now minus the version's `created_at`, computed on the server at render; plan review I9); `customerFileState(f: { ready: boolean; scanStatus: string; scanSignature: string | null }): CustomerFileState | null`; `CUSTOMER_STATE_KEY: Record<CustomerFileState, MessageKey>`; `itemLabel(item: DocumentRequestItem, locale: "en" | "es"): string`; `itemsSentence(items: readonly DocumentRequestItem[], locale): string` (labels joined with ", "); `nextCustomerPollMs(files: readonly CustomerFile[]): number | null` (ONE signature everywhere, plan review M6: 5 000 while the youngest Checking file is at most a minute old, 15 000 while it is at most 15 minutes old, else `null`; `null` when nothing is Checking); `pollKey(ms: number | null, reads: number): string`; `formatPhone(e164: string): string`.
  - `customer-upload.ts` (server; takes the caller's client): `type Resolved = { kind: "open" | "expired" | "revoked" | "completed"; request: DocumentRequestRow } | { kind: "not_found" }`; `resolveToken(db, token: string, now: Date): Promise<Resolved>`; `type RouteAnswer = { status: number; body: Record<string, unknown> }`; `customerStart(db, token: string, body: unknown, now: Date): Promise<RouteAnswer>`; `customerFinish(db, token: string, body: unknown, now: Date): Promise<RouteAnswer>`; `type CustomerPage = { state: Resolved["kind"]; language: "en" | "es"; business: string; logoUrl: string | null; branding: Branding | null; phone: string | null; items: { key: string; label: string; files: CustomerFile[] }[] }`; `customerPage(db, token: string, now: Date): Promise<CustomerPage>`.
  - Answers of the two routes (the page's client reads them): start `200 { documentId, versionId, uploadUrl }`; refusals `{ error }` with `404 not_found`, `410 expired | revoked | completed`, `400 bad_request | bad_type | no_item`, `413 too_large`, `429 rate_limited`, `409 over_quota` (with `phone` when the account has a live number), `503 failed`. Finish `200 { state: CustomerFileState }`; refusals as above plus `400 refused | bad_type | upload`; a finish on a COMPLETED or EXPIRED request is accepted for a version of that request still uploading (deviation 13); only `revoked` (410) and an unknown token (404) refuse it. Every answer carries `Cache-Control: no-store`.

- [ ] **Step 1: Read** `apps/web/src/lib/forms/guards.ts:30-50` (the key shape `token.ts` copies), `apps/web/src/app/api/unsubscribe/[token]/route.ts` and its test (the public route shape), `packages/db/src/branding.ts:160-180, :340-420`, `packages/db/src/voice.ts:840-860`, `apps/web/src/lib/documents/rules.ts` (`extensionAllowed`).

- [ ] **Step 2: Failing tests.**
  - `token.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createHash, createHmac } from "node:crypto";
import { requestToken, tokenHash, isTokenShape, requestUrl } from "./token";

const ID = "2b1f7d7e-5b1c-4c55-9a43-6f0f1b2c3d4e";
let saved: Record<string, string | undefined>;
beforeEach(() => { saved = { a: process.env.DOCUMENT_LINK_SECRET, b: process.env.SUPABASE_SERVICE_ROLE_KEY }; });
afterEach(() => { process.env.DOCUMENT_LINK_SECRET = saved.a; process.env.SUPABASE_SERVICE_ROLE_KEY = saved.b; if (saved.a === undefined) delete process.env.DOCUMENT_LINK_SECRET; if (saved.b === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY; });

describe("the request's link (plan deviation 1)", () => {
  it("is HMAC-SHA256 of the id under the domain-separated key: 43 base64url characters, the same for the same id (mutation: drop the 'bis-document-link:' prefix -> FAILS)", () => {
    process.env.DOCUMENT_LINK_SECRET = "s3cret-s3cret-s3cret-s3cret-0032";
    const key = createHash("sha256").update("bis-document-link:s3cret-s3cret-s3cret-s3cret-0032").digest();
    const want = createHmac("sha256", key).update(`document-request:v1:${ID}`).digest("base64url");
    expect(requestToken(ID)).toBe(want);
    expect(requestToken(ID.toUpperCase())).toBe(want);
    expect(want).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(requestToken("3c1f7d7e-5b1c-4c55-9a43-6f0f1b2c3d4e")).not.toBe(want);
  });
  it("a different secret gives a different link (mutation: a constant key -> FAILS)", () => {
    process.env.DOCUMENT_LINK_SECRET = "a".repeat(32);
    const a = requestToken(ID);
    process.env.DOCUMENT_LINK_SECRET = "b".repeat(32);
    expect(requestToken(ID)).not.toBe(a);
  });
  it("the secret is REQUIRED and at least 32 characters; there is no fallback to the service key; the error names the variable, never a value (ruling I10; mutations: fall back to SUPABASE_SERVICE_ROLE_KEY; accept 31 characters; echo the value -> FAILS)", () => {
    delete process.env.DOCUMENT_LINK_SECRET;
    process.env.SUPABASE_SERVICE_ROLE_KEY = "svc-key-present";
    expect(() => requestToken(ID)).toThrow("DOCUMENT_LINK_SECRET is required (at least 32 characters)");
    process.env.DOCUMENT_LINK_SECRET = "x".repeat(31);
    let msg = "";
    try { requestToken(ID); } catch (e) { msg = (e as Error).message; }
    expect(msg).toBe("DOCUMENT_LINK_SECRET is required (at least 32 characters)");
    expect(msg).not.toContain("x".repeat(31));
  });
  it("the database keeps sha256 hex of the token; the shape check refuses anything but 43 base64url characters (mutation: accept 44 -> FAILS)", () => {
    expect(tokenHash("abc")).toBe(createHash("sha256").update("abc").digest("hex"));
    expect([isTokenShape("A".repeat(43)), isTokenShape("A".repeat(44)), isTokenShape("A".repeat(42) + "="), isTokenShape(null)]).toEqual([true, false, false, false]);
    process.env.DOCUMENT_LINK_SECRET = "s3cret-s3cret-s3cret-s3cret-0032";
    expect(requestUrl("https://app.example.com/", ID)).toBe(`https://app.example.com/d/${requestToken(ID)}`);
  });
});
```
  - `customer-state.test.ts`: `customerFileState` maps not ready → `null`; ready+pending → `checking`; clean → `received`; infected → `virus`; unscannable with `Heuristics.Encrypted.PDF` → `password`; unscannable otherwise → `unscannable` (mutation: map unscannable-with-password to `unscannable` -> FAILS; this goes through `removedReason`, so the 2a helper is the one source). `itemLabel({ key: "insurance", … }, "es")` equals `m["documents.category.insurance.es"]`'s literal value read with `m[…]`, and the `other` item answers its note; `itemsSentence` joins with ", ". `nextCustomerPollMs([{ state: "checking", ageMs: 1_000 }])` → 5000; `([{ state: "checking", ageMs: 61_000 }])` → 15000; `([{ state: "checking", ageMs: 61_000 }, { state: "checking", ageMs: 2_000 }])` → 5000 (the YOUNGEST checking file decides; mutation: the oldest -> FAILS); `([{ state: "checking", ageMs: 15 * 60_000 + 1 }])` → `null`; `([{ state: "received", ageMs: 0 }])` → `null` (mutation: keep polling with nothing checking -> FAILS); `pollKey(5000, 1) !== pollKey(5000, 2)` (the 2a defect: the key must change on every read, mutation: drop `reads` from the key -> FAILS). `formatPhone("+19565550123")` → `"(956) 555-0123"`; a non-NANP number is returned unchanged.
  - `customer-upload.test.ts` (a recording fake client: every `from()`/`rpc()` call with its `.eq` arguments, as 2a's `documents.test.ts:719` does; `@bis/db`'s request functions spied through `vi.mock` with `importOriginal`; `finishStoredUpload`, `cleanUpUpload`, `openRequestTask` mocked):
    1. A token of the wrong shape answers `404 not_found` and makes NO database call (mutation: look it up anyway -> FAILS).
    2. An unknown hash → `404` on both routes. START: an expired, a revoked and a completed request → `410` with `error` equal to the state, and `startDocumentRequestUpload` is not called (mutation: drop the state check -> FAILS). FINISH (deviation 13, ruling I6): a REVOKED request → `410 { error: "revoked" }` and `finishStoredUpload` is not called (mutation: accept revoked -> FAILS); a COMPLETED and an EXPIRED request whose `getRequestDocument` answers this request's document → `finishStoredUpload` IS called and the answer is `200 { state }` (mutation: refuse completed or expired -> FAILS).
    3. Start: `startDocumentRequestUpload` receives `{ accountId: request.account_id, requestId: request.id, itemKey: "insurance", bytes, contentType: "application/pdf", originalName: "scan.pdf", title: <the Spanish label for a Spanish request> }`; the body's own `accountId`, `contactId`, `category` or `title` fields, if sent, are IGNORED (send them with other values; mutation: read any of them from the body -> FAILS); the answer is `200 { documentId, versionId, uploadUrl }` from the fake `createSignedUploadUrl`.
    4. Start validation: size 0, size > 25 MiB (`413 too_large`), a `.exe` name or an unknown content type (`400 bad_type`), a non-category item key (`400 no_item`), a non-object body (`400 bad_request`); none reaches the RPC.
    5. `over_quota` → `409 { error: "over_quota", phone: "(956) 555-0123" }` when the account has a `live` number, and `openRequestTask(db, account, request, "storage_full", now)` was called once (mutation: no To-do -> FAILS); `rate_limited` → `429`.
    6. A failed `createSignedUploadUrl` calls `cleanUpUpload` with the reserved ids and answers `503 failed`.
    7. Finish: `getRequestDocument` is called with `(request.account_id, request.id, documentId)` and, when it answers `null` (a document of another request or account), the answer is `404` and `finishStoredUpload` is NOT called (mutation: skip the proof -> FAILS); otherwise `finishStoredUpload` receives `{ accountId: request.account_id, documentId, versionId, trashed: false, actorId: "customer:<request id>", actorType: "system" }`; scan `clean` → `200 { state: "received" }`, `pending`/`held`/`unreached`/`stale` → `checking`, `infected` → `virus`, `unscannable` with a version whose signature is `Heuristics.Encrypted.PDF` → `password`.
    8. **Nothing logs the token:** with `console.error` spied, a start whose RPC throws answers `503 failed`, and no logged string contains the token (mutation: log `token` -> FAILS).
    9. Every refusal body is exactly `{ error }` (plus `phone` on over-quota): no request id, no account id, no path (mutation: add `requestId` -> FAILS).
    10. `customerPage`: an open Spanish request answers `language: "es"`, `business` = `brandDisplayName(branding)` or `m["customerDocs.business.es"]` when empty, `phone` formatted from the first `live` number or `null`, and each item with its label and its files as `{ state, ageMs }` in order (`listRequestFiles` → `customerFileState`, not-ready files dropped, `ageMs` = `now` minus the version's `createdAt`: a fixture version created 90 s before `now` reads `ageMs: 90_000`; mutation: page-open time -> FAILS); a branding read that throws still answers the page (`branding: null`); an unknown token answers `state: "not_found"` with no branding read.
  - `start/route.test.ts`, `finish/route.test.ts` (mock `@/lib/document-requests/customer-upload` and `serviceDb`): the route passes `params.token`, the parsed body and a `Date` through; a body that is not JSON answers `400 { error: "bad_request" }` WITHOUT calling the module; every answer carries `Cache-Control: no-store`; the module's status and body are returned unchanged (mutation: always 200 -> FAILS). `finish/route.ts` exports `maxDuration = 60` (the scan waits up to 30 s; 2a's `SCAN_TIMEOUT_MS`).

- [ ] **Step 3: Run them to see them fail.**

- [ ] **Step 4: Implement `token.ts`:**

```ts
import { createHash, createHmac } from "node:crypto";

/**
 * The customer's link (spec 4.1; plan deviation 1): 32 bytes, base64url, DERIVED from the request id
 * under a server key, so staff can Copy link again and the quiet-hours release can rebuild it, while
 * the database keeps only sha256(token). The key is the forms token key's shape
 * (lib/forms/guards.ts:36-42) WITHOUT its service-key fallback: DOCUMENT_LINK_SECRET is required, at
 * least 32 characters, different in Production and Preview (ruling I10). Rotating it ends every open
 * link (they live 7 days). Our code never logs it; the link itself travels in the text or email we
 * send, and Vercel's request log records /d/<token> (plan review M1).
 */
const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;

function linkKey(): Buffer {
  const secret = process.env.DOCUMENT_LINK_SECRET;
  if (!secret || secret.length < 32) throw new Error("DOCUMENT_LINK_SECRET is required (at least 32 characters)");
  return createHash("sha256").update(`bis-document-link:${secret}`).digest();
}

export function requestToken(requestId: string): string {
  return createHmac("sha256", linkKey()).update(`document-request:v1:${requestId.toLowerCase()}`).digest("base64url");
}
export const isTokenShape = (t: unknown): t is string => typeof t === "string" && TOKEN_RE.test(t);
export const tokenHash = (token: string): string => createHash("sha256").update(token).digest("hex");
export const requestUrl = (origin: string, requestId: string): string => `${origin.replace(/\/+$/, "")}/d/${requestToken(requestId)}`;
```

- [ ] **Step 5: Implement `customer-state.ts`:**

```ts
import { removedReason, type DocumentRequestItem } from "@bis/db/document-rules";
import { m, type MessageKey } from "@/lib/messages";
import { t } from "@/lib/i18n/t";

/** Browser-safe: what the customer's page says about each file (spec 4.3), and when it re-reads (plan deviation 10). */
export type CustomerFileState = "checking" | "received" | "virus" | "password" | "unscannable";

export function customerFileState(f: { ready: boolean; scanStatus: string; scanSignature: string | null }): CustomerFileState | null {
  if (!f.ready) return null;
  if (f.scanStatus === "clean") return "received";
  if (f.scanStatus === "pending") return "checking";
  const why = removedReason(f.scanStatus, f.scanSignature);
  return why === "virus" ? "virus" : why === "password" ? "password" : "unscannable";
}

export const CUSTOMER_STATE_KEY: Record<CustomerFileState, MessageKey> = {
  checking: "customerDocs.checking", received: "customerDocs.received",
  virus: "customerDocs.why.virus", password: "customerDocs.why.password", unscannable: "customerDocs.why.unscannable",
};

export function itemLabel(item: DocumentRequestItem, locale: "en" | "es"): string {
  return item.category === "other" && item.note ? item.note : t(m, `documents.category.${item.category}` as MessageKey, locale);
}
export const itemsSentence = (items: readonly DocumentRequestItem[], locale: "en" | "es"): string => items.map((i) => itemLabel(i, locale)).join(", ");

const FAST_MS = 5_000;
const SLOW_MS = 15_000;
const FAST_FOR_MS = 60_000;
const GIVE_UP_MS = 15 * 60_000;
export type CustomerFile = { state: CustomerFileState; ageMs: number };
/**
 * Re-read while a file is Checking, by the YOUNGEST Checking file's own age (server now minus its
 * version's created_at; plan review I9), never by when the page was opened: every 5 s for its first
 * minute, then every 15 s, and not after 15 minutes. One signature everywhere (plan review M6).
 */
export function nextCustomerPollMs(files: readonly CustomerFile[]): number | null {
  const ages = files.filter((f) => f.state === "checking").map((f) => f.ageMs);
  if (ages.length === 0) return null;
  const youngest = Math.min(...ages);
  if (youngest > GIVE_UP_MS) return null;
  return youngest <= FAST_FOR_MS ? FAST_MS : SLOW_MS;
}
/** The effect's key: it MUST change on every read, or the timer fires once (2a Task 9's defect). */
export const pollKey = (ms: number | null, reads: number): string => `${ms ?? "off"}:${reads}`;

export function formatPhone(e164: string): string {
  const d = /^\+1(\d{3})(\d{3})(\d{4})$/.exec(e164);
  return d ? `(${d[1]}) ${d[2]}-${d[3]}` : e164;
}
```

- [ ] **Step 6: Implement `customer-upload.ts`** (server; the service client is the CALLER's, so the file names no `serviceDb`):

```ts
import {
  findDocumentRequestByTokenHash, startDocumentRequestUpload, getRequestDocument, getDocumentVersion, listRequestFiles,
  getBranding, brandDisplayName, brandLogoUrl, listPhoneNumbersForAccount, documentRequestState,
  DOCUMENT_BUCKET, DOCUMENT_MAX_BYTES, isDocumentCategory, isDocumentContentType,
  type Branding, type DocumentRequestRow, type SupabaseClient,
} from "@bis/db";
import { m } from "@/lib/messages";
import { t } from "@/lib/i18n/t";
import { isUuid } from "@/lib/assign/action-guards";
import { loggableError } from "@/lib/loggable-error";
import { extensionAllowed } from "@/lib/documents/rules";
import { finishStoredUpload, cleanUpUpload } from "@/lib/documents/finish-upload";
import { openRequestTask } from "@/lib/document-requests/request-task";
import { isTokenShape, tokenHash } from "./token";
import { customerFileState, formatPhone, itemLabel, type CustomerFile, type CustomerFileState } from "./customer-state";

/**
 * The public rule (study 3.4; spec 4.4): a token is proven FIRST (its shape, then a lookup by its
 * sha256, then open), and every later read or write carries the request's own account and id. The
 * customer names only an item key (start) or a document and version of THIS request (finish); the
 * record and the category come from the request row inside 0080's start function. Logs name the
 * request id, never the token. Answers are bare error words with no id in them.
 */
export type Resolved = { kind: "open" | "expired" | "revoked" | "completed"; request: DocumentRequestRow } | { kind: "not_found" };
export type RouteAnswer = { status: number; body: Record<string, unknown> };
const answer = (status: number, body: Record<string, unknown>): RouteAnswer => ({ status, body });
const refuse = (status: number, error: string): RouteAnswer => answer(status, { error });

export async function resolveToken(db: SupabaseClient, token: string, now: Date): Promise<Resolved> {
  if (!isTokenShape(token)) return { kind: "not_found" };
  const request = await findDocumentRequestByTokenHash(db, tokenHash(token));
  if (!request) return { kind: "not_found" };
  return { kind: documentRequestState(request, now), request };
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const closed = (r: Resolved): RouteAnswer | null =>
  r.kind === "not_found" ? refuse(404, "not_found") : r.kind === "open" ? null : refuse(410, r.kind);

async function livePhone(db: SupabaseClient, accountId: string): Promise<string | null> {
  try {
    const live = (await listPhoneNumbersForAccount(db, accountId)).find((p) => p.status === "live");
    return live ? formatPhone(live.e164) : null;
  } catch {
    return null;
  }
}

export async function customerStart(db: SupabaseClient, token: string, body: unknown, now: Date): Promise<RouteAnswer> {
  let requestId = "unknown";
  try {
    const r = await resolveToken(db, token, now);
    const shut = closed(r);
    if (shut || r.kind === "not_found") return shut ?? refuse(404, "not_found");
    const request = r.request;
    requestId = request.id;
    if (!isObj(body)) return refuse(400, "bad_request");
    const { itemKey, name, size, contentType } = body;
    if (!isDocumentCategory(itemKey)) return refuse(400, "no_item");
    if (typeof size !== "number" || !Number.isInteger(size) || size < 1) return refuse(400, "bad_request");
    if (size > DOCUMENT_MAX_BYTES) return refuse(413, "too_large");
    if (typeof name !== "string" || !extensionAllowed(name) || !isDocumentContentType(contentType)) return refuse(400, "bad_type");
    const item = request.items.find((i) => i.key === itemKey);
    if (!item) return refuse(400, "no_item");
    const s = await startDocumentRequestUpload(db, {
      accountId: request.account_id, requestId: request.id, itemKey, bytes: size, contentType,
      originalName: name.slice(0, 255) || null, title: itemLabel(item, request.language),
    });
    if (s.status === "over_quota") {
      await openRequestTask(db, request.account_id, request, "storage_full", now);
      const phone = await livePhone(db, request.account_id);
      return answer(409, phone ? { error: "over_quota", phone } : { error: "over_quota" });
    }
    if (s.status === "rate_limited") return refuse(429, "rate_limited");
    if (s.status === "too_large") return refuse(413, "too_large");
    if (s.status === "no_item") return refuse(400, "no_item");
    if (s.status === "not_found") return refuse(404, "not_found");
    if (s.status !== "ok") return refuse(410, s.status);
    const { data, error } = await db.storage.from(DOCUMENT_BUCKET).createSignedUploadUrl(s.storagePath);
    if (error || !data) {
      await cleanUpUpload(db, request.account_id, s.documentId, s.versionId, s.storagePath);
      throw new Error(`createSignedUploadUrl: ${error?.message ?? "no data"}`);
    }
    return answer(200, { documentId: s.documentId, versionId: s.versionId, uploadUrl: data.signedUrl });
  } catch (e) {
    console.error(`document request ${requestId}: customer start failed: ${loggableError(e)}`);
    return refuse(503, "failed");
  }
}

const ERROR_WORD: Record<string, [number, string]> = {
  "documents.error.badType": [400, "bad_type"], "documents.error.trashed": [400, "refused"],
  "documents.error.refused": [400, "refused"], "documents.error.upload": [400, "upload"],
};

export async function customerFinish(db: SupabaseClient, token: string, body: unknown, now: Date): Promise<RouteAnswer> {
  let requestId = "unknown";
  try {
    const r = await resolveToken(db, token, now);
    if (r.kind === "not_found") return refuse(404, "not_found");
    // Deviation 13 (ruling I6): a version THIS request already reserved may still finish after the request
    // completed or expired (the start refuses new files then); only a revoked link refuses it.
    if (r.kind === "revoked") return refuse(410, "revoked");
    const request = r.request;
    requestId = request.id;
    if (!isObj(body) || !isUuid(body.documentId) || !isUuid(body.versionId)) return refuse(400, "bad_request");
    const documentId = body.documentId.toLowerCase();
    const versionId = body.versionId.toLowerCase();
    const doc = await getRequestDocument(db, request.account_id, request.id, documentId);
    if (!doc) return refuse(404, "not_found");
    const f = await finishStoredUpload(db, {
      accountId: request.account_id, documentId, versionId, trashed: doc.deleted_at !== null,
      actorId: `customer:${request.id}`, actorType: "system",
    });
    if (!f.ok) {
      const [status, word] = ERROR_WORD[f.error] ?? [400, "upload"];
      return refuse(status, word);
    }
    let state: CustomerFileState = "checking";
    if (f.scan === "clean") state = "received";
    else if (f.scan === "infected") state = "virus";
    else if (f.scan === "unscannable") {
      const v = await getDocumentVersion(db, request.account_id, versionId);
      state = customerFileState({ ready: true, scanStatus: "unscannable", scanSignature: v?.scan_signature ?? null }) ?? "unscannable";
    }
    return answer(200, { state });
  } catch (e) {
    console.error(`document request ${requestId}: customer finish failed: ${loggableError(e)}`);
    return refuse(503, "failed");
  }
}

export type CustomerPage = {
  state: Resolved["kind"]; language: "en" | "es"; business: string; logoUrl: string | null; branding: Branding | null;
  phone: string | null; items: { key: string; label: string; files: CustomerFile[] }[];
};

/** The page's whole read (spec 4.3): server-rendered, re-run by router.refresh() while a file is Checking. */
export async function customerPage(db: SupabaseClient, token: string, now: Date): Promise<CustomerPage> {
  const r = await resolveToken(db, token, now);
  if (r.kind === "not_found") return { state: "not_found", language: "en", business: m["customerDocs.business"], logoUrl: null, branding: null, phone: null, items: [] };
  const { request } = r;
  let branding: Branding | null = null;
  try {
    branding = await getBranding(db, request.account_id);
  } catch (e) {
    // Decorative (the /u page's rule): a branding blip never costs the customer the page.
    console.error(`document request ${request.id}: branding unreadable: ${loggableError(e)}`);
  }
  const business = (branding && brandDisplayName(branding)) || t(m, "customerDocs.business", request.language);
  const phone = await livePhone(db, request.account_id);
  const files = r.kind === "open" ? await listRequestFiles(db, request.account_id, request.id) : [];
  return {
    state: r.kind, language: request.language, business, branding, phone,
    logoUrl: branding?.brandLogoPath ? brandLogoUrl(branding.brandLogoPath) : null,
    items: request.items.map((i) => ({
      key: i.key, label: itemLabel(i, request.language),
      files: files.filter((f) => f.itemKey === i.key).flatMap((f): CustomerFile[] => {
        const state = customerFileState(f);
        return state ? [{ state, ageMs: Math.max(0, now.getTime() - Date.parse(f.createdAt)) }] : [];
      }),
    })),
  };
}
```
  (`listRequestFiles` returns `RequestFile`, whose `ready`, `scanStatus`, `scanSignature` are exactly `customerFileState`'s argument. If `listPhoneNumbersForAccount`'s row names its fields otherwise than `status` and `e164`, use its names: read `voice.ts:840-860` first.)

- [ ] **Step 7: The routes.** `apps/web/src/app/api/d/[token]/start/route.ts`:

```ts
import { NextResponse } from "next/server";
import { serviceDb } from "@bis/db";
import { customerStart } from "@/lib/document-requests/customer-upload";

/** POST /api/d/<token>/start (spec 4.4): no sign-in; the token is the proof (customer-upload.ts). Never cached. */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const NO_STORE = { "Cache-Control": "no-store" };

export async function POST(req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad_request" }, { status: 400, headers: NO_STORE });
  }
  const r = await customerStart(serviceDb(), token, body, new Date());
  return NextResponse.json(r.body, { status: r.status, headers: NO_STORE });
}
```
  `…/finish/route.ts` is the same with `customerFinish` and, after `dynamic`, `export const maxDuration = 60; // the finish waits for the scan (2a: up to 30 s)`.
- [ ] **Step 8: Run** the five new test files plus `read-gate.test.ts` and `in-account-service-reads.test.ts` (no `serviceDb` in `lib`; the routes are outside its roots); typecheck; eslint. All PASS.
- [ ] **Step 9: Probes, by name:** (a) `customerStart` passing `body.title` as the title → test 3 FAILS; (b) `customerFinish` without the `getRequestDocument` proof → test 7 FAILS; (c) `resolveToken` treating `expired` as open → test 2 FAILS; (d) the catch logging `token` → test 8 FAILS; (e) `pollKey` without `reads` → the state test FAILS. Paste each.
- [ ] **Step 10: Commit** every path above, message "documents: the customer's link, the public rule and the two public routes (S-07 2b)".

---

## Task 6: Delivery: two kinds, the email, the hold and release, "What went out" (bis-comms)

**Review:** opus. **Runs beside:** Task 9.

**Files**
- Create: `apps/web/src/lib/document-requests/deliver.ts` (+ `deliver.test.ts`), `apps/web/src/lib/email/templates/document-request.ts` (+ `document-request.test.ts`)
- Modify: `apps/web/src/lib/consent/classes.ts` (two kinds), `apps/web/src/lib/consent/classes.test.ts` (`:31-33` count 14 → 15 and `SPEC_TABLE`'s row at `:11`; `EMAIL_TABLE`'s row at `:59` and `:94-96`'s count 26 → 27; `:112-121` `emailReadsLedger`'s list), `apps/web/src/lib/consent/scans.test.ts` (`:268` 36 → 38; `SITES` one row, the EMAIL kind only), `packages/db/src/automation-log.ts` (the source, after `"textback"`), `apps/web/src/lib/automations/log-titles.ts` (the title), `apps/web/src/lib/automations/passes/release-held.ts` (one import, one `RELEASERS` entry)

**Interfaces**
- Consumes: `sendSms` (`lib/consent/gate.ts:294`), `sendEmail` (`lib/consent/email-gate.ts:219`), `writeHeld`, `BLOCK_REASONS`, `EMAIL_BLOCK_REASONS`, `REASONS`, `logSkipped`, `subjectOf`, `type Releaser` (`lib/automations/hold-or-send.ts`), `recordAutomationLog` (`packages/db/src/automation-log.ts:67`), `ensureConversation`, `createMessage`, `updateMessageStatus` (`packages/db/src/messaging.ts:94, :133, :179`), `withTrailingLink` (`lib/automations/sms-link.ts:12`), `emailBrand` (`lib/email/templates/shell.ts:68`), `proseWithButton` (`lib/email/templates/prose-button.ts:11`), `getBranding`, `brandDisplayName`, `recipientLanguage`, `normalisePhone` (`packages/db/src/phone.ts:93`), `resolveSmsSender` (`lib/sms/sender.ts:30`, the function `softSmsGate` wraps at `lib/record/loaders.ts:166`), `smsRecipientState` (`lib/consent/recipient-state.ts:21`, `{ kind: "ok" | … }`); `documentRequestTarget`, `getDocumentRequest`, `documentRequestState` (Task 3); `requestUrl` (Task 5); `itemsSentence` (Task 5); keys `documentRequest.*`, `documents.request.reason.*`, `activity.source.documentRequest` (Task 2).
- Produces:
  - Kinds `"staff.document_request_sms": { class: "informational", hours: "automated", footer: "stop_line" }` and `"staff.document_request_email": { class: "informational", hours: "automated", footer: "unsubscribe" }`.
  - `AUTOMATION_LOG_SOURCES` gains `"document_request"`; `SOURCE_TITLES.document_request = m["activity.source.documentRequest"]`; `RELEASERS.document_request = releaseDocumentRequest`.
  - `type DeliverOutcome = { kind: "sent" } | { kind: "held"; until: string; zone: string } | { kind: "blocked"; reason: MessageKey } | { kind: "failed" }`.
  - `deliverDocumentRequest(db: SupabaseClient, a: { request: DocumentRequestRow; channel: "text" | "email"; actorId: string; origin: string; now: Date }): Promise<DeliverOutcome>` (never throws).
  - `requestChannels(db: SupabaseClient, ledger: SupabaseClient, accountId: string, target: DocumentRequestTarget | null): Promise<{ text: boolean; email: boolean }>` (P6: text only when the account can text, the target has a number we can text, and the number has not stopped or been held; email when the target has an address).
  - `releaseDocumentRequest: Releaser`.
  - `documentRequestEmail(a: { brand: EmailBrand; business: string; items: string; url: string; locale: "en" | "es" }): { subject: string; html: string; text: string }`.

- [ ] **Step 1: Read** `lib/consent/classes.ts:1-140`, `lib/consent/gate.ts:59-160, :186-300`, `lib/consent/email-gate.ts:62-120, :219-260`, `lib/automations/hold-or-send.ts:52-84, :226-300, :345-360`, `lib/voice/textback.ts:240-300, :405-470` (the working non-cron model), `conversations/actions.ts:48-120` (the email composer's rows) and `:181-285` (the text composer's `prepare`, statuses and `recordUsageSafely`, with its import line), `lib/email/templates/no-show-nudge.ts` and `prose-button.ts`, `lib/consent/scans.test.ts:740-800`, `lib/automations/log-titles.ts`, `lib/automations/passes/release-held.ts:60-90`, `classes.test.ts` if it exists (any rule that a `staff.*` kind must be `staff_typed`: if one exists, STOP and report; the orchestrator decides the kind names, the class does not change).

- [ ] **Step 2: Failing tests.**
  - `document-request.test.ts` (the email): for `locale: "es"` the subject is `"Casa Verde necesita unos documentos"`, the text part contains `"Por favor envíenos: Seguro, Pool permit."` and the URL, the HTML contains the button label `"Subir documentos"` and the URL as an `href`, and NO English word from the English twins appears in the Spanish HTML (`renderedText`; check `"Upload documents"` and `"needs a few"` are absent) (mutation: an English button in the Spanish email -> FAILS; DESIGN.md "one message is in one language"); `locale: "en"` the mirror.
  - `deliver.test.ts` (its `beforeEach`/`afterEach` stub `DOCUMENT_LINK_SECRET` as Global Constraints say): the gate and the database are faked at their module boundary (`vi.mock("@/lib/consent/gate")`, `vi.mock("@/lib/consent/email-gate")`, `vi.mock("@bis/db", importOriginal)` for `documentRequestTarget`, `getBranding`, `ensureConversation`, `createMessage`, `updateMessageStatus`, `recordAutomationLog`, `getDocumentRequest`; `vi.mock("@/lib/automations/hold-or-send", importOriginal)` spying `writeHeld`, `logSkipped`); one shared call log. Cases (each names its mutation):
    1. Text, a Spanish request: `sendSms` receives `kind: "staff.document_request_sms"`, `to` the target's phone, `language: "es"`, `accountZone` the account's zone, and a body equal to `withTrailingLink("Casa Verde: por favor envíenos Seguro, Pool permit. Súbalos aquí:", "<origin>/d/<token>")` (mutation: the account's language -> FAILS; a staff_typed kind -> FAILS).
    2. Text sent: `prepare` wrote the conversation and the message row BEFORE the provider (order in the call log), the row's actor is the staff `actorId` with actor type `"user"` (person mark), the message is then `"sent"` with the provider id, `recordAutomationLog` gets `{ source: "document_request", channel: "sms", subjectKey: "document_request:<id>", status: "sent", contactId }`, usage is recorded when `billable`, and the answer is `{ kind: "sent" }`.
    3. Text deferred (quiet hours): `writeHeld` gets the subject with `payload: { channel: "text", actorId }`, the gate's `until` and `zone`; no message row is written; the answer is `{ kind: "held", until, zone }` (mutation: write the message row before the hold -> FAILS).
    4. Text blocked `stopped` → `recordAutomationLog` `status: "skipped"` with `BLOCK_REASONS.stopped`, answer `{ kind: "blocked", reason: "documents.request.reason.textsStopped" }`; `a2p_not_approved` / `no_live_number` / `no_number` → `textSetup`; `unconfirmed_number` → `noPhone`; `ledger_unavailable` → held for 15 minutes with `REASONS.ledgerRetry` (the text-back's rule) (mutation: send on ledger_unavailable -> FAILS).
    5. A target with no phone: no gate call; skipped with `REASONS.noPhone`; `{ kind: "blocked", reason: "documents.request.reason.noPhone" }`.
    6. Email: `sendEmail` receives `kind: "staff.document_request_email"`, `to` the target's email, `language`, `origin`, the subject and parts from `documentRequestEmail`, `fromName` the business, `replyTo` the account's reply-to; on `sent` the conversation row (`channel: "email"`) and `recordAutomationLog` `channel: "email"` are written AFTER the send; on `deferred` → `writeHeld`; on `blocked` `stopped` → `emailStopped`, `suppressed` → `bounced`, `no_address` → `noEmail`.
    7. Nothing throws out: a `sendSms` that rejects answers `{ kind: "failed" }` and logs by request id with no token in the log (mutation: rethrow -> FAILS).
    8. `releaseDocumentRequest`: a held row whose request is revoked, completed or expired → `logSkipped(…, REASONS.noLongerDue)` and `"skipped"`, no send (mutation: send a revoked request's link -> FAILS); an open one → `deliverDocumentRequest` with the payload's channel and actor and `ctx.origin`; `sent` → `"sent"`, `held` → `"held"`, `blocked` → `"skipped"`, `failed` → `"failed"`; a malformed subject key → `"skipped"`.
    9. `requestChannels`: text true only when `resolveSmsSender` answers `ok` (a read error counts as no), `normalisePhone(target.phone)` is not null, and `smsRecipientState` answers `{ kind: "ok" }` (mutations: drop any one of the three -> FAILS); email true when the target has a non-empty address; a `null` target → both false.
  - `scans.test.ts` (plan review I3): `SITES` (`:760`) is `Record<EmailKind, readonly string[]>`, so ONLY `"staff.document_request_email": ["apps/web/src/lib/document-requests/deliver.ts"]` is added there (the SMS kind would not type-check in it); the positive control at `:264-270` becomes "all fifteen SMS kinds and all twenty-seven email kinds, 38 distinct" with `toHaveLength(38)`; run both red first (the email kind with no `SITES` row, and 36, FAIL by name).
  - `classes.test.ts` (plan review I3): `:31-33` "fourteen kinds" → fifteen and `toHaveLength(15)`, `SPEC_TABLE` (`:11`) gains `"staff.document_request_sms": ["informational", "automated", "stop_line"]`; `EMAIL_TABLE` (`:59`) gains `"staff.document_request_email": ["informational", "automated", "unsubscribe"]`, and `:94-96`'s "twenty-six send sites" → twenty-seven with `toHaveLength(27)`; `:104-109`'s footer rule holds unchanged (the new email kind is neither operator nor staff_typed, so it must carry the footer: it does); `:112-121`'s `emailReadsLedger` list gains `"staff.document_request_email"` in sorted place. Red first: the new rows FAIL until Step 4.
    10. **After a successful send nothing turns the outcome into `failed`** (plan review I4): a sent text whose `updateMessageStatus` rejects AND whose `recordAutomationLog` rejects still answers `{ kind: "sent" }`, still records usage when billable, and logs both failures by request id; a sent email whose conversation-row write and log write both reject still answers `{ kind: "sent" }` (mutations: let either rejection reach the outer catch -> `failed` -> FAILS).
    11. **At most once on release** (re-review R1): with a stateful fake `claimDocumentRequestSend`/`clearDocumentRequestSend`/`getDocumentRequest` (one in-memory request row) and `recordAutomationLog` REJECTING, a first `releaseDocumentRequest` of a held text row answers `"sent"` and calls `sendSms` once; a second release of the SAME row then calls `sendSms` ZERO more times and answers `"sent"` (mutation: drop the `request?.sent_at` check -> a second `sendSms` -> FAILS). Also: a blocked, deferred or failed text clears the stamp (the fake row's `sent_at` is null again; mutation: no clear -> FAILS); a lost claim in `prepare` sends nothing and answers `{ kind: "sent" }`; an email whose `sendEmail` rejects clears the stamp before the error reaches the outer catch.

- [ ] **Step 3: Run them to see them fail.**

- [ ] **Step 4: The kinds, the source, the title.** `classes.ts` `SMS_KINDS` gains, after `"staff.composer_sms"`, `"staff.document_request_sms": { class: "informational", hours: "automated", footer: "stop_line" },` with the comment `// S-07 2b (plan deviation 11): a staff-chosen request, but its text is ours, so stops and quiet hours apply.`; `EMAIL_KINDS` gains `"staff.document_request_email": { class: "informational", hours: "automated", footer: "unsubscribe" },` with the same comment. `automation-log.ts`: after `"textback",` add `// S-07 2b (0080): a document request's text or email, held outside the sending hours.` and `"document_request",`. `log-titles.ts`: `document_request: m["activity.source.documentRequest"],`. `release-held.ts`: `import { releaseDocumentRequest } from "@/lib/document-requests/deliver";` and `document_request: releaseDocumentRequest,`.

- [ ] **Step 5: The email template** `apps/web/src/lib/email/templates/document-request.ts`:

```ts
import { m } from "@/lib/messages";
import { t } from "@/lib/i18n/t";
import { proseWithButton } from "./prose-button";
import type { EmailBrand } from "./shell";

/** A document request by email (spec 4.2): one language end to end (subject, body, button), the client's brand. */
export function documentRequestEmail(a: { brand: EmailBrand; business: string; items: string; url: string; locale: "en" | "es" }): { subject: string; html: string; text: string } {
  const body = t(m, "documentRequest.email.body", a.locale, { items: a.items });
  const { html, text } = proseWithButton(a.brand, body, a.url, t(m, "documentRequest.email.button", a.locale));
  return { subject: t(m, "documentRequest.email.subject", a.locale, { business: a.business }), html, text };
}
```
  (If `proseWithButton`'s `text` does not carry the URL, append `\n\n${a.url}` to `text`; the test pins that the text part has the link.)

- [ ] **Step 6: `deliver.ts`:**

```ts
import {
  documentRequestTarget, getDocumentRequest, documentRequestState, getBranding, brandDisplayName, normalisePhone,
  claimDocumentRequestSend, clearDocumentRequestSend,
  ensureConversation, createMessage, updateMessageStatus, recordAutomationLog,
  type DocumentRequestRow, type DocumentRequestTarget, type SupabaseClient,
} from "@bis/db";
import { sendSms } from "@/lib/consent/gate";
import { sendEmail } from "@/lib/consent/email-gate";
import { smsRecipientState } from "@/lib/consent/recipient-state";
import { resolveSmsSender } from "@/lib/sms/sender";
import {
  writeHeld, logSkipped, subjectOf, BLOCK_REASONS, EMAIL_BLOCK_REASONS, REASONS, type LogSubject, type Releaser,
} from "@/lib/automations/hold-or-send";
import { withTrailingLink } from "@/lib/automations/sms-link";
import { emailBrand } from "@/lib/email/templates/shell";
import { documentRequestEmail } from "@/lib/email/templates/document-request";
import { m, type MessageKey } from "@/lib/messages";
import { t } from "@/lib/i18n/t";
import { loggableError } from "@/lib/loggable-error";
import { requestUrl } from "./token";
import { itemsSentence } from "./customer-state";

/**
 * A document request's text or email (spec 4.2; plan deviation 11). Through THE gates: two
 * informational kinds, so a stopped or held number and an unsubscribed address are refused and the
 * automated sending hours apply. Outside them the send is HELD in automation_log (source
 * document_request, one row per request) and released by releaseDocumentRequest while the request is
 * still open. The text's conversation row is written before it leaves (the composer's WRITE THEN
 * SEND), with the staff member as its author (the person mark); an email's after it is sent. One
 * language end to end: the request's. Never throws; logs name the request id, never the link.
 */
export type DeliverOutcome = { kind: "sent" } | { kind: "held"; until: string; zone: string } | { kind: "blocked"; reason: MessageKey } | { kind: "failed" };
const LEDGER_RETRY_MS = 15 * 60_000;

/** A log write never changes what happened (hold-or-send.ts:201-207's rule; plan review I4): a failed write is logged, never thrown. */
async function logQuietly(db: SupabaseClient, requestId: string, w: Parameters<typeof recordAutomationLog>[1]): Promise<void> {
  try {
    await recordAutomationLog(db, w);
  } catch (e) {
    console.error(`document request ${requestId}: What went out not written (${w.status}): ${loggableError(e)}`);
  }
}

const SMS_REASON: Record<string, MessageKey> = {
  stopped: "documents.request.reason.textsStopped", held: "documents.request.reason.textsStopped",
  no_number: "documents.request.reason.textSetup", a2p_not_approved: "documents.request.reason.textSetup",
  no_live_number: "documents.request.reason.textSetup", unconfirmed_number: "documents.request.reason.noPhone",
};
const EMAIL_REASON: Record<string, MessageKey> = {
  stopped: "documents.request.reason.emailStopped", held: "documents.request.reason.emailStopped",
  suppressed: "documents.request.reason.bounced", no_address: "documents.request.reason.noEmail",
};

async function accountZone(db: SupabaseClient, accountId: string): Promise<string | null> {
  const { data, error } = await db.from("accounts").select("timezone").eq("id", accountId).maybeSingle();
  if (error) throw new Error(`account zone: ${error.message}`);
  return (data as { timezone: string | null } | null)?.timezone ?? null;
}

export async function deliverDocumentRequest(db: SupabaseClient, a: {
  request: DocumentRequestRow; channel: "text" | "email"; actorId: string; origin: string; now: Date;
}): Promise<DeliverOutcome> {
  const { request, channel, actorId, now } = a;
  const accountId = request.account_id;
  const lang = request.language;
  const subject: LogSubject = {
    accountId, source: "document_request", channel: channel === "text" ? "sms" : "email",
    subjectKey: `document_request:${request.id}`, contactId: null, payload: { channel, actorId },
  };
  try {
    const target = await documentRequestTarget(db, accountId, request);
    subject.contactId = target?.contactId ?? null;
    const branding = await getBranding(db, accountId);
    const business = brandDisplayName(branding) || t(m, "customerDocs.business", lang);
    const items = itemsSentence(request.items, lang);
    const url = requestUrl(a.origin, request.id);
    const zone = await accountZone(db, accountId);
    if (channel === "text") return await deliverText(db, { request, target, actorId, now, zone, subject, business, items, url });
    return await deliverEmail(db, { request, target, actorId, now, zone, subject, business, items, url, branding, origin: a.origin });
  } catch (e) {
    console.error(`document request ${request.id}: delivery by ${channel} failed: ${loggableError(e)}`);
    await logQuietly(db, request.id, { ...subject, status: "failed", reason: REASONS.failed }).catch(() => undefined);
    return { kind: "failed" };
  }
}

type Ctx = {
  request: DocumentRequestRow; target: DocumentRequestTarget | null; actorId: string; now: Date; zone: string | null;
  subject: LogSubject; business: string; items: string; url: string;
};

async function deliverText(db: SupabaseClient, c: Ctx): Promise<DeliverOutcome> {
  const { request, target, actorId, now, subject } = c;
  const accountId = request.account_id;
  if (!target?.contactId || !normalisePhone(target.phone)) {
    await logQuietly(db, request.id, { ...subject, status: "skipped", reason: REASONS.noPhone });
    return { kind: "blocked", reason: "documents.request.reason.noPhone" };
  }
  const contactId = target.contactId;
  // Re-review R1: at most once. The stamp is claimed inside prepare, i.e. after the gate cleared the send
  // and BEFORE the provider is called; a lost claim (another release sent it) sends nothing.
  let claimed = false;
  let lost = false;
  const body = withTrailingLink(t(m, "documentRequest.sms", request.language, { business: c.business, items: c.items }), c.url);
  const row: { messageId: string | null } = { messageId: null };
  const result = await sendSms(db, {
    accountId, kind: "staff.document_request_sms", to: target.phone!, body, contactId, language: request.language,
    now, accountZone: c.zone,
  }, {
    prepare: async ({ body: sentBody }) => {
      claimed = await claimDocumentRequestSend(db, accountId, request.id, now);
      if (!claimed) { lost = true; throw new Error("this request's text already went out"); }
      const convo = await ensureConversation(db, accountId, contactId, actorId);
      row.messageId = (await createMessage(db, accountId, { conversationId: convo.id, channel: "sms", direction: "outbound", body: sentBody }, actorId)).id;
    },
  });
  if (lost) return { kind: "sent" };
  if (claimed && result.kind !== "sent") {
    await clearDocumentRequestSend(db, accountId, request.id)
      .catch((e: unknown) => console.error(`document request ${request.id}: the send stamp was not cleared after a send that did not go out: ${loggableError(e)}`));
  }
  if (result.kind === "deferred") {
    await writeHeld({ db }, subject, result.until, result.zone);
    return { kind: "held", until: result.until.toISOString(), zone: result.zone };
  }
  if (result.kind === "blocked") {
    if (result.reason === "ledger_unavailable") {
      const until = new Date(now.getTime() + LEDGER_RETRY_MS);
      await writeHeld({ db }, subject, until, "UTC", REASONS.ledgerRetry);
      return { kind: "held", until: until.toISOString(), zone: "UTC" };
    }
    const why = BLOCK_REASONS[result.reason as keyof typeof BLOCK_REASONS] ?? REASONS.failed;
    await logQuietly(db, request.id, { ...subject, status: "skipped", reason: why });
    return { kind: "blocked", reason: SMS_REASON[result.reason] ?? "documents.request.reason.failed" };
  }
  if (result.kind === "failed") {
    if (row.messageId) await updateMessageStatus(db, accountId, row.messageId, "failed", undefined, actorId).catch(() => undefined);
    await logQuietly(db, request.id, { ...subject, status: "failed", reason: REASONS.failed });
    return { kind: "failed" };
  }
  // sent: the text HAS left the building, so nothing below may turn this into "failed" (plan review I4).
  // The composer's order (conversations/actions.ts:266-283): the status first, then usage; each caught on its own.
  if (row.messageId) {
    await updateMessageStatus(db, accountId, row.messageId, "sent", { providerMessageId: result.providerMessageId }, actorId)
      .catch((e: unknown) => console.error(`document request ${request.id}: sent, but the message status was not written: ${loggableError(e)}`));
    if (result.billable) {
      await recordUsageSafely(db, { accountId, meter: "sms", quantity: result.segments, occurredAt: now, sourceRef: `message:${row.messageId}` }, `document request ${request.id}`);
    }
  }
  await logQuietly(db, request.id, { ...subject, status: "sent" });
  return { kind: "sent" };
}

async function deliverEmail(db: SupabaseClient, c: Ctx & { branding: Awaited<ReturnType<typeof getBranding>>; origin: string }): Promise<DeliverOutcome> {
  const { request, target, actorId, now, subject } = c;
  const accountId = request.account_id;
  const to = target?.email?.trim();
  if (!target?.contactId || !to) {
    await logQuietly(db, request.id, { ...subject, status: "skipped", reason: REASONS.noEmail });
    return { kind: "blocked", reason: "documents.request.reason.noEmail" };
  }
  const mail = documentRequestEmail({ brand: emailBrand(c.branding), business: c.business, items: c.items, url: c.url, locale: request.language });
  // Re-review R1: at most once. The stamp is claimed BEFORE the email is handed to the gate; cleared below
  // when it did not go out (or the gate threw).
  if (!(await claimDocumentRequestSend(db, accountId, request.id, now))) return { kind: "sent" };
  const unclaim = () => clearDocumentRequestSend(db, accountId, request.id)
    .catch((e: unknown) => console.error(`document request ${request.id}: the send stamp was not cleared: ${loggableError(e)}`));
  const result = await sendEmail({
    accountId, kind: "staff.document_request_email", contactId: target.contactId, to, fromName: c.business,
    replyTo: c.branding.replyToEmail ?? undefined, subject: mail.subject, body: mail.text, html: mail.html,
    language: request.language, origin: c.origin, now, accountZone: c.zone,
  }, { db }).catch(async (e: unknown) => { await unclaim(); throw e; });
  if (result.kind !== "sent") await unclaim();
  if (result.kind === "deferred") {
    await writeHeld({ db }, subject, result.until, result.zone);
    return { kind: "held", until: result.until.toISOString(), zone: result.zone };
  }
  if (result.kind === "blocked") {
    if (result.reason === "ledger_unavailable" || result.reason === "unsubscribe_unavailable") {
      const until = new Date(now.getTime() + LEDGER_RETRY_MS);
      await writeHeld({ db }, subject, until, "UTC", REASONS.ledgerRetry);
      return { kind: "held", until: until.toISOString(), zone: "UTC" };
    }
    const why = EMAIL_BLOCK_REASONS[result.reason as keyof typeof EMAIL_BLOCK_REASONS] ?? REASONS.failed;
    await logQuietly(db, request.id, { ...subject, status: "skipped", reason: why });
    return { kind: "blocked", reason: EMAIL_REASON[result.reason] ?? "documents.request.reason.failed" };
  }
  if (result.kind === "failed") {
    await logQuietly(db, request.id, { ...subject, status: "failed", reason: REASONS.failed });
    return { kind: "failed" };
  }
  // The thread's row AFTER the send (a held email must leave no row); a crash between the two loses the
  // thread row only, never the email or its log line below.
  try {
    const convo = await ensureConversation(db, accountId, target.contactId, actorId);
    const msg = await createMessage(db, accountId, { conversationId: convo.id, channel: "email", direction: "outbound", subject: mail.subject, body: mail.text }, actorId);
    await updateMessageStatus(db, accountId, msg.id, "sent", undefined, actorId);
  } catch (e) {
    console.error(`document request ${request.id}: the email went out but its conversation row was not written: ${loggableError(e)}`);
  }
  await logQuietly(db, request.id, { ...subject, status: "sent" });
  return { kind: "sent" };
}

/** P6: what the dialog may offer. Text: the account can text, the target has a number we can text, and it has not stopped or been held. */
export async function requestChannels(
  db: SupabaseClient, ledger: SupabaseClient, accountId: string, target: DocumentRequestTarget | null,
): Promise<{ text: boolean; email: boolean }> {
  if (!target?.contactId) return { text: false, email: false };
  const email = Boolean(target.email?.trim());
  if (!normalisePhone(target.phone)) return { text: false, email };
  const [gate, state] = await Promise.all([
    resolveSmsSender(db, accountId).catch(() => null),
    smsRecipientState(ledger, accountId, { phone: target.phone, phone_country_unconfirmed: target.phoneCountryUnconfirmed }),
  ]);
  return { text: gate?.ok === true && state.kind === "ok", email };
}

/** A held request leaves only while it is still open: a revoked, completed or expired one is "No longer due". */
export const releaseDocumentRequest: Releaser = async (ctx, row) => {
  const match = /^document_request:([0-9a-f-]{36})$/.exec(row.subject_key);
  const payload = row.payload as { channel?: unknown; actorId?: unknown } | null;
  const channel = payload?.channel === "text" || payload?.channel === "email" ? payload.channel : null;
  const actorId = typeof payload?.actorId === "string" ? payload.actorId : null;
  if (!match || !channel || !actorId) {
    await logSkipped(ctx, subjectOf(row), REASONS.noLongerDue);
    return "skipped";
  }
  const request = await getDocumentRequest(ctx.db, row.account_id, match[1]!);
  // Re-review R1: release-held.ts never writes the held row itself; only this releaser's own "sent" write
  // dequeues it. A request whose stamp is set already went out (the release that sent it could not write
  // its row): write the row now and NEVER send again. A failed write here throws to release-held's catch
  // (errored), and the next tick tries the write again; it still sends nothing.
  if (request?.sent_at) {
    await recordAutomationLog(ctx.db, { ...subjectOf(row), status: "sent" });
    return "sent";
  }
  if (!request || documentRequestState(request, ctx.now) !== "open") {
    await logSkipped(ctx, subjectOf(row), REASONS.noLongerDue);
    return "skipped";
  }
  const out = await deliverDocumentRequest(ctx.db, { request, channel, actorId, origin: ctx.origin, now: ctx.now });
  return out.kind === "sent" ? "sent" : out.kind === "held" ? "held" : out.kind === "blocked" ? "skipped" : "failed";
};
```
  Import `recordUsageSafely` from where `conversations/actions.ts` imports it (Step 1 read its import line). Read `createMessage`'s `NewMessage` type before writing the email row: if it has no `subject` field, drop it and follow `sendEmailAction`'s own call exactly (`conversations/actions.ts:48-120`). If `SmsRequest.accountZone` or `EmailRequest.accountZone` is not `string | null`, convert as the text-back does. `deliver.ts` names no `serviceDb` and no `ledgerDb`: its callers pass the clients.

- [ ] **Step 7: Run** `deliver.test.ts`, `document-request.test.ts`, `src/lib/consent/scans.test.ts`, `src/lib/consent/classes.test.ts` (if present), `src/lib/automations/passes/release-held.test.ts`, `src/app/api/cron/reminders/route.test.ts` (its `@bis/db` factory may need nothing new: `release-held.ts` imports `deliver.ts`, which imports from `@bis/db`; if the bare factory makes the route test throw at import, add exactly the missing names to that factory and say so), `src/lib/i18n/ratchet.test.ts`; typecheck; eslint. All PASS.
- [ ] **Step 8: Probes:** (a) the SMS kind as `staff_typed`/`hours: "any"` → case 1 FAILS (the test asserts the kind's spec from `SMS_KINDS`); (b) the message row written before `writeHeld` on a deferral → case 3 FAILS; (c) the releaser sending a revoked request → case 8 FAILS; (d) `requestChannels` ignoring `smsRecipientState` → case 9 FAILS. Paste each.
- [ ] **Step 9: Commit** every path above, message "comms: a document request goes out by text or email through the gates, holds in quiet hours and shows in What went out (S-07 2b)".

---

## Task 6b: The lost-To-do reconcile in the scan pass (bis-automations)

**Review:** sonnet. **Runs:** after Task 6 (both may edit the cron route test; re-review R2), beside Task 7.

**Files**
- Modify: `apps/web/src/lib/automations/passes/documents-scan.ts` (+ `documents-scan.test.ts`), `apps/web/src/lib/automations/sentinel.test.ts` (the pass's counters, `:263`), `apps/web/src/app/api/cron/reminders/route.test.ts` (`EMPTY_DOCUMENTS_SCAN`, `:322`)

**Interfaces**
- Consumes: `listRequestsMissingReceivedTask(db, now, limit)` (Task 3), `openRequestTask(db, accountId, request, "received", now)` (Task 4), `scanVersion(…, opts)` with `opts.now` (Task 4).
- Produces: the pass's counters gain `requestTasks: number` (To-dos the reconcile opened this tick); `REQUEST_TASK_RECONCILE_LIMIT = 20`.

- [ ] **Step 1: Read** `documents-scan.ts` whole (the not-configured early return at `:73-77`, the scan loop, the spend loop's budget check at `:123`, the heartbeat at the end), its test, `sentinel.test.ts:255-285`, `route.test.ts:315-330`, and `cron-coupling.test.ts` (the budget sum: the reconcile is bounded by count, not time, and adds at most 20 × (two reads + one insert) on the service client, well inside the 75 s spare the 2a review measured; say so in the pass's BUDGET comment, do not add a fourth budget).
- [ ] **Step 2: Failing tests** in `documents-scan.test.ts` (its existing fakes; `vi.mock("@/lib/document-requests/request-task")` and `listRequestsMissingReceivedTask` added to its `@bis/db` factory):
  1. The reconcile runs EVERY tick, before the not-configured early return (a request's clean file may predate a worker outage): with `scannerConfig()` null and two missing requests, `openRequestTask` is called twice with `(ctx.db, request.account_id, request, "received", ctx.now)` and the answer carries `requestTasks: 2` and `notConfigured: 1` (mutation: run it after the early return -> FAILS).
  2. Bounded: `listRequestsMissingReceivedTask` is called with `(ctx.db, ctx.now, 20)` (mutation: no limit -> FAILS).
  3. A reconcile read that throws is logged and counted as `failed` for the tick's error, and the scan still runs (mutation: let it abort the scan loop -> FAILS).
  4. The scan loop passes `{ now: ctx.now }` in `scanVersion`'s options alongside its existing ones (plan review M2; mutation: omit it -> FAILS).
  - `sentinel.test.ts:263` and `route.test.ts:322`: the not-configured counters gain `requestTasks: 0` (the suites set no scanner and the route test's `@bis/db` factory answers no request: add `listRequestsMissingReceivedTask: async () => []` to that bare factory, `route.test.ts:15-25`, 2a's Global Constraint).
- [ ] **Step 3: Run them red.**
- [ ] **Step 4: Implement.** At the top of `run`, before `if (!scannerConfig())`:

```ts
    // Plan review I5 (S-07 2b): a clean customer file whose request has no "received" To-do (a crash
    // between the verdict and openRequestTask, or a verdict that landed while the hook failed) gets it
    // now. Bounded by count; idempotent through tasks_document_request_once (0080).
    try {
      for (const request of await listRequestsMissingReceivedTask(ctx.db, ctx.now, REQUEST_TASK_RECONCILE_LIMIT)) {
        await openRequestTask(ctx.db, request.account_id, request, "received", ctx.now);
        c.requestTasks++;
      }
    } catch (e) {
      c.failed++;
      console.error(`documents scan: the request To-do reconcile failed: ${String(e)}`);
    }
```
  with `requestTasks: 0` added to `c`'s initialiser, `export const REQUEST_TASK_RECONCILE_LIMIT = 20;` beside the pass's other constants, and `now: ctx.now` added to every `scanVersion` call's options object. (`openRequestTask` never throws, so a failure inside it is a logged line, not a counter; the count says how many were attempted.) The not-configured early return keeps returning `c`, now with `requestTasks`. If `c.failed` is set by the reconcile and the early return is taken, the pass must still throw as it does for `failed > 0` at the end: move the throw check into a helper both exits call, and say so in the report.
- [ ] **Step 5: Run** `documents-scan.test.ts`, `sentinel.test.ts`, `cron-coupling.test.ts`, `src/app/api/cron/reminders/route.test.ts`; typecheck; eslint. All PASS.
- [ ] **Step 6: Probes:** (a) the reconcile after the early return → case 1 FAILS; (b) no limit → case 2 FAILS. Paste each.
- [ ] **Step 7: Commit** every path above, message "automations: the scan pass opens any request's missing To-do (S-07 2b)".

---

## Task 7: Staff actions and the card's requests read (bis-crm)

**Review:** opus.

**Files**
- Create: `…/contacts/document-requests-actions.ts` (+ `document-requests-actions.test.ts`); `apps/web/src/app/api/accounts/[accountId]/contacts/[contactId]/document-requests/route.ts` and `apps/web/src/app/api/accounts/[accountId]/groups/[groupId]/document-requests/route.ts` (+ `route.test.ts` each); `apps/web/src/lib/document-requests/requests-load.ts` (+ `requests-load.test.ts`)
- Modify: `"apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/in-account-service-reads.test.ts"` (`ALLOWED` gains the action file and the two routes as `proven-target`, each with its reason)

**Interfaces**
- Consumes: Task 3's module; `requestToken`, `tokenHash`, `requestUrl` (Task 5); `deliverDocumentRequest`, `requestChannels`, `DeliverOutcome` (Task 6); `originFrom` (`lib/email/origin.ts:33`); `recipientLanguage` (`packages/db/src/spanish-box.ts:20`); `ledgerDb` (`lib/consent/ledger-db.ts`); `apiAccountAccess` (`lib/auth`), `dbForRequest` (`lib/db.ts`).
- Produces:
  - `createDocumentRequestAction(accountId: string, input: { record: DocRecordArg; items: unknown; channel: unknown }): Promise<{ ok: true; requestId: string; url: string; delivery: DeliverOutcome | { kind: "link" } } | DocFail>`
  - `documentRequestLinkAction(accountId: string, requestId: string): Promise<{ ok: true; url: string } | DocFail>` (an OPEN request only)
  - `revokeDocumentRequestAction(accountId: string, requestId: string): Promise<{ ok: true; revokedAt: string } | DocFail>`
  - `undoRevokeDocumentRequestAction(accountId: string, requestId: string, revokedAt: string): Promise<{ ok: true } | DocFail>`
  - The routes answer `DocumentRequestsResponse = { now: string; channels: { text: boolean; email: boolean }; requests: OpenDocumentRequest[] }` (404 `{}` when the record is not the caller's; 500 `{}` on a read error).
  - `requests-load.ts` (browser-safe): `type DocumentRequestsLoad = { kind: "loading" } | { kind: "error" } | { kind: "ready"; data: DocumentRequestsResponse }`; `parseDocumentRequests(body: unknown): DocumentRequestsResponse | null` (strict, as `documentsLoadFrom`); `documentRequestsLoadFrom(res: Response): Promise<DocumentRequestsLoad>`; `expiresInDays(expiresAt: string, now: string): number` (whole days left, rounded UP, never below 0); `documentRequestsRouteFor(accountId: string, record: { kind: "contact" | "group"; id: string }): string`.

- [ ] **Step 1: Read** `documents-actions.ts:1-80` (the tree's conventions: `fail`, `recordOf`, `recordVisible`, keys not text), `contacts/[contactId]/documents/route.ts` (the read shape above), `contacts/[contactId]/page.tsx:80-100` (`ledgerDb()` after the request-client proof), `in-account-service-reads.test.ts:30-160`, `lib/email/origin.ts:30-60`.

- [ ] **Step 2: Failing tests.**
  - `document-requests-actions.test.ts` (`DOCUMENT_LINK_SECRET` stubbed in `beforeEach`/`afterEach`, Global Constraints; mocks: `@/lib/auth`, `@/lib/db` → a REQUEST client fake, `@bis/db` with `importOriginal` spying the request functions and `serviceDb`, `@/lib/document-requests/deliver`, `next/headers` → `{ headers: async () => new Headers({ host: "app.example.com", "x-forwarded-proto": "https" }) }` or whatever `originFrom` reads):
    1. Create: an invalid record, items that `cleanRequestItems` refuses, or a channel outside text/email/link → `fail("documents.error.refused")` with NO service call (mutation: skip `cleanRequestItems` -> FAILS).
    2. Create: the record is proven on the REQUEST client before anything on the service client (call-log order; mutation: service first -> FAILS); a record the request client cannot see → `fail("documents.error.notFound")`.
    3. Create: `createDocumentRequest` gets a fresh uuid `id`, `tokenHash === tokenHash(requestToken(id))`, `language` = `recipientLanguage(target.language, account.language)` (a Spanish contact on an English account → `"es"`; mutation: the account's -> FAILS), `channel`, `createdBy` = the user, and the answer's `url` = `requestUrl(origin, id)`; the database never receives the token itself (assert no argument of any call equals the token; mutation: store the token -> FAILS).
    4. Create with `link`: no delivery call; `delivery: { kind: "link" }`. With `text`: `deliverDocumentRequest` is called once with `{ request, channel: "text", actorId: user, origin, now }`, and its outcome is returned as `delivery` while the request STANDS even when the outcome is `blocked` or `failed` (mutation: delete the request on a failed send -> FAILS).
    5. Link: answers `requestUrl(origin, id)` for an open request read on the REQUEST client; a revoked, completed or expired request → `fail("documents.error.refused")`.
    6. Revoke: proof on the request client, then `revokeDocumentRequest(svc, …)`; `null` → `fail("documents.error.refused")`; Undo passes the `revokedAt` it was given (mutation: undo with `now` -> FAILS).
    7. The channel is re-checked (plan review M13): with `requestChannels` answering `{ text: false, email: true }`, a `text` create answers `fail("documents.request.textOff")` and `createDocumentRequest` is NOT called; `{ text: true, email: false }` with `email` → `documents.request.emailOff`; `link` never calls `requestChannels` (mutation: skip the check -> FAILS).
  - Each route's test (`route.test.ts`, the documents route tests' shape): `apiAccountAccess` null → 404; the record read on the request client returns null → 404; otherwise `listOpenDocumentRequests(db, accountId, record, now)` on the REQUEST client and `requestChannels(db, ledger, accountId, target)` with the target read on the request client, answered as `{ now, channels, requests }` (mutation: the service client for the list -> FAILS: assert the client identity passed); a thrown read → 500 `{}`.
  - `requests-load.test.ts`: a valid body parses; a request with an item whose `answered` is not a boolean, or a channel outside the three, makes the whole parse `null` (mutation: accept it -> FAILS); `expiresInDays("2026-10-22T10:00:00Z", "2026-10-15T11:00:00Z")` → 7, `(…"2026-10-15T10:00:00Z", "2026-10-15T09:00:00Z")` → 1, an instant past → 0; `documentRequestsRouteFor("a", { kind: "group", id: "g" })` → `/api/accounts/a/groups/g/document-requests`.
  - `in-account-service-reads.test.ts`: run first WITHOUT the new `ALLOWED` lines → it FAILS naming the action file and the two routes (they mention `serviceDb` / `ledgerDb`); then add them.

- [ ] **Step 3: Run them to see them fail.**

- [ ] **Step 4: `document-requests-actions.ts`:**

```ts
"use server";

import { randomUUID } from "node:crypto";
import { headers } from "next/headers";
import { requireAccountAccess } from "@/lib/auth";
import { dbForRequest } from "@/lib/db";
import {
  serviceDb, getContact, readGroup, documentRequestTarget, createDocumentRequest, getDocumentRequest, revokeDocumentRequest,
  restoreDocumentRequest, documentRequestState, recipientLanguage, cleanRequestItems,
  type SupabaseClient, type DocumentRecordRef,
} from "@bis/db";
import { isUuid } from "@/lib/assign/action-guards";
import { loggableError } from "@/lib/loggable-error";
import { originFrom } from "@/lib/email/origin";
import { requestToken, tokenHash, requestUrl } from "@/lib/document-requests/token";
import { deliverDocumentRequest, requestChannels, type DeliverOutcome } from "@/lib/document-requests/deliver";
import { ledgerDb } from "@/lib/consent/ledger-db";
import type { DocRecordArg, DocFail } from "./documents-actions";

/**
 * "Ask the customer" (spec 4.2). Every action: requireAccountAccess, then a REQUEST-client read of the
 * record or the request (RLS decides), and only then the service client, scoped to the same account
 * (0053; listed proven-target in in-account-service-reads.test.ts). The link is built from the
 * request id (plan deviation 1) and is never stored; only its sha256 is. A failed send never undoes
 * the request: staff can Copy link. Answers are messages.ts keys.
 */
const fail = (error: string): DocFail => ({ ok: false, error });
const REFUSED = "documents.error.refused";
const CHANNELS = new Set(["text", "email", "link"]);

function log(where: string, accountId: string, e: unknown): void {
  console.error(`document requests ${where} (account ${accountId}): ${loggableError(e)}`);
}
function recordOf(raw: unknown): DocumentRecordRef | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;
  if (!isUuid(r.id)) return null;
  const id = r.id.toLowerCase();
  return r.kind === "contact" ? { kind: "contact", id } : r.kind === "group" ? { kind: "group", id } : null;
}
async function recordVisible(db: SupabaseClient, accountId: string, r: DocumentRecordRef): Promise<boolean> {
  return r.kind === "group" ? Boolean(await readGroup(db, accountId, r.id)) : Boolean(await getContact(db, accountId, r.id));
}
const refOf = (r: DocumentRecordRef) => ({ contact_id: r.kind === "contact" ? r.id : null, client_group_id: r.kind === "group" ? r.id : null });

export async function createDocumentRequestAction(
  accountId: string, input: { record: DocRecordArg; items: unknown; channel: unknown },
): Promise<{ ok: true; requestId: string; url: string; delivery: DeliverOutcome | { kind: "link" } } | DocFail> {
  const access = await requireAccountAccess(accountId);
  const record = recordOf(input?.record);
  const items = cleanRequestItems(input?.items);
  const channel = typeof input?.channel === "string" && CHANNELS.has(input.channel) ? (input.channel as "text" | "email" | "link") : null;
  if (!record || !items || !channel) return fail(REFUSED);
  try {
    if (!(await recordVisible(await dbForRequest(), accountId, record))) return fail("documents.error.notFound");
  } catch (e) {
    log("create: record read", accountId, e);
    return fail("documents.request.failed");
  }
  const origin = originFrom(await headers());
  if (!origin) return fail("documents.request.failed");
  const svc = serviceDb();
  try {
    const now = new Date();
    const target = await documentRequestTarget(svc, accountId, refOf(record));
    // Plan review M13: the chosen channel must be on offer NOW (a stale dialog, or a crafted call, must
    // not text a number that has stopped texts); checked before anything is written.
    if (channel !== "link") {
      const offered = await requestChannels(svc, ledgerDb(), accountId, target);
      if (!offered[channel]) return fail(channel === "text" ? "documents.request.textOff" : "documents.request.emailOff");
    }
    const { data: acct, error } = await svc.from("accounts").select("language").eq("id", accountId).maybeSingle();
    if (error) throw new Error(`account language: ${error.message}`);
    const language = recipientLanguage(target?.language, (acct as { language: string | null } | null)?.language);
    const id = randomUUID();
    const request = await createDocumentRequest(svc, {
      id, accountId, record, items, language, tokenHash: tokenHash(requestToken(id)), channel, createdBy: access.userId, now,
    });
    const url = requestUrl(origin, id);
    if (channel === "link") return { ok: true, requestId: id, url, delivery: { kind: "link" } };
    const delivery = await deliverDocumentRequest(svc, { request, channel, actorId: access.userId, origin, now });
    return { ok: true, requestId: id, url, delivery };
  } catch (e) {
    log("create", accountId, e);
    return fail("documents.request.failed");
  }
}

/** The request, proven on the REQUEST client (RLS: the record's visibility). */
async function visibleRequest(accountId: string, requestId: string) {
  if (!isUuid(requestId)) return null;
  return getDocumentRequest(await dbForRequest(), accountId, requestId.toLowerCase());
}

export async function documentRequestLinkAction(accountId: string, requestId: string): Promise<{ ok: true; url: string } | DocFail> {
  await requireAccountAccess(accountId);
  try {
    const request = await visibleRequest(accountId, requestId);
    if (!request || documentRequestState(request, new Date()) !== "open") return fail(REFUSED);
    const origin = originFrom(await headers());
    return origin ? { ok: true, url: requestUrl(origin, request.id) } : fail("documents.request.failed");
  } catch (e) {
    log("link", accountId, e);
    return fail("documents.request.failed");
  }
}

export async function revokeDocumentRequestAction(accountId: string, requestId: string): Promise<{ ok: true; revokedAt: string } | DocFail> {
  const access = await requireAccountAccess(accountId);
  try {
    const request = await visibleRequest(accountId, requestId);
    if (!request) return fail(REFUSED);
    const r = await revokeDocumentRequest(serviceDb(), accountId, request.id, access.userId, new Date());
    return r ? { ok: true, revokedAt: r.revokedAt } : fail(REFUSED);
  } catch (e) {
    log("revoke", accountId, e);
    return fail("documents.error.failed");
  }
}

export async function undoRevokeDocumentRequestAction(accountId: string, requestId: string, revokedAt: string): Promise<{ ok: true } | DocFail> {
  await requireAccountAccess(accountId);
  if (typeof revokedAt !== "string" || !revokedAt) return fail(REFUSED);
  try {
    const request = await visibleRequest(accountId, requestId);
    if (!request) return fail(REFUSED);
    return (await restoreDocumentRequest(serviceDb(), accountId, request.id, revokedAt)) ? { ok: true } : fail(REFUSED);
  } catch (e) {
    log("undo revoke", accountId, e);
    return fail("documents.error.failed");
  }
}
```
  (`DocRecordArg`/`DocFail` are TYPE imports from a `"use server"` file, which is allowed; if lint forbids it, re-declare the two types here and say so. `recipientLanguage`'s exact name and barrel export: `packages/db/src/spanish-box.ts:20`, re-exported from `@bis/db` per its header.)
- [ ] **Step 5: The two routes.** The contact route:

```ts
import { NextResponse } from "next/server";
import { getContact, listOpenDocumentRequests, documentRequestTarget } from "@bis/db";
import { apiAccountAccess } from "@/lib/auth";
import { dbForRequest } from "@/lib/db";
import { ledgerDb } from "@/lib/consent/ledger-db";
import { isUuid } from "@/lib/assign/action-guards";
import { loggableError } from "@/lib/loggable-error";
import { requestChannels } from "@/lib/document-requests/deliver";
import type { DocumentRequestsResponse } from "@/lib/document-requests/requests-load";

export const dynamic = "force-dynamic";

/**
 * The Documents card's requests (spec 4.2): this contact's OPEN requests, each item answered or not,
 * and the channels the dialog may offer (P6). Request client for every record read (RLS decides); the
 * ledger client for the consent state only, built after getContact proved the contact is the
 * caller's (the contact page's own rule, page.tsx:85-98). Loads and fails on its own (spec 6).
 */
export async function GET(_req: Request, { params }: { params: Promise<{ accountId: string; contactId: string }> }) {
  const { accountId, contactId: raw } = await params;
  const access = await apiAccountAccess(accountId);
  if (!access || !isUuid(raw)) return NextResponse.json({}, { status: 404 });
  const contactId = raw.toLowerCase();
  const db = await dbForRequest();
  try {
    if (!(await getContact(db, accountId, contactId))) return NextResponse.json({}, { status: 404 });
    const now = new Date();
    const [requests, target] = await Promise.all([
      listOpenDocumentRequests(db, accountId, { kind: "contact", id: contactId }, now),
      documentRequestTarget(db, accountId, { contact_id: contactId, client_group_id: null }),
    ]);
    const channels = await requestChannels(db, ledgerDb(), accountId, target);
    const body: DocumentRequestsResponse = { now: now.toISOString(), channels, requests };
    return NextResponse.json(body);
  } catch (e) {
    console.error(`document requests read (account ${accountId}, contact ${contactId}): ${loggableError(e)}`);
    return NextResponse.json({}, { status: 500 });
  }
}
```
  The group route is the same with `readGroup(db, accountId, groupId)` as the proof, `{ kind: "group", id: groupId }`, and `{ contact_id: null, client_group_id: groupId }` (its target is the primary contact, deviation 3).
- [ ] **Step 6: `requests-load.ts`** (browser-safe; imports only from `@bis/db/document-rules`):

```ts
import { isDocumentCategory, type DocumentRequestChannel, type DocumentRequestItem } from "@bis/db/document-rules";

export type OpenRequestView = { id: string; items: (DocumentRequestItem & { answered: boolean })[]; channel: DocumentRequestChannel; createdAt: string; expiresAt: string };
export type DocumentRequestsResponse = { now: string; channels: { text: boolean; email: boolean }; requests: OpenRequestView[] };
export type DocumentRequestsLoad = { kind: "loading" } | { kind: "error" } | { kind: "ready"; data: DocumentRequestsResponse };

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isIso = (v: unknown): v is string => typeof v === "string" && !Number.isNaN(Date.parse(v));
const CHANNELS = new Set(["text", "email", "link"]);

function item(v: unknown): (DocumentRequestItem & { answered: boolean }) | null {
  if (!isObj(v) || !isDocumentCategory(v.category) || v.key !== v.category || typeof v.answered !== "boolean") return null;
  if (!(v.note === null || typeof v.note === "string")) return null;
  return { key: v.category, category: v.category, note: v.note as string | null, answered: v.answered };
}
function request(v: unknown): OpenRequestView | null {
  if (!isObj(v) || typeof v.id !== "string" || !Array.isArray(v.items) || !CHANNELS.has(v.channel as string) || !isIso(v.createdAt) || !isIso(v.expiresAt)) return null;
  const items = v.items.map(item);
  if (items.length === 0 || items.some((i) => i === null)) return null;
  return { id: v.id, items: items as OpenRequestView["items"], channel: v.channel as DocumentRequestChannel, createdAt: v.createdAt, expiresAt: v.expiresAt };
}

export function parseDocumentRequests(body: unknown): DocumentRequestsResponse | null {
  if (!isObj(body) || !isIso(body.now) || !isObj(body.channels) || typeof body.channels.text !== "boolean"
    || typeof body.channels.email !== "boolean" || !Array.isArray(body.requests)) return null;
  const requests = body.requests.map(request);
  if (requests.some((r) => r === null)) return null;
  return { now: body.now, channels: { text: body.channels.text, email: body.channels.email }, requests: requests as OpenRequestView[] };
}

export async function documentRequestsLoadFrom(res: Response): Promise<DocumentRequestsLoad> {
  if (!res.ok) return { kind: "error" };
  const data = parseDocumentRequests(await res.json().catch(() => null));
  return data ? { kind: "ready", data } : { kind: "error" };
}

const DAY = 86_400_000;
export const expiresInDays = (expiresAt: string, now: string): number => Math.max(0, Math.ceil((Date.parse(expiresAt) - Date.parse(now)) / DAY));
export const documentRequestsRouteFor = (accountId: string, record: { kind: "contact" | "group"; id: string }): string =>
  `/api/accounts/${accountId}/${record.kind === "group" ? "groups" : "contacts"}/${record.id}/document-requests`;
```
  (`OpenRequestView` mirrors `OpenDocumentRequest` from `@bis/db` without importing the barrel. In the routes, `requests` is typed `OpenDocumentRequest[]`, which is assignable.)
- [ ] **Step 7: `ALLOWED`** gains three entries in the file's own shape, reason `proven-target`, each naming its proof: the action file ("record or request read on the request client first"), the two routes ("getContact / readGroup on the request client first; ledgerDb for the consent state after that proof").
- [ ] **Step 8: Run** the new tests, `in-account-service-reads.test.ts`, `src/lib/consent/scans.test.ts`, typecheck, eslint. All PASS.
- [ ] **Step 9: Probes:** (a) create without the request-client proof → case 2 FAILS; (b) the route listing on a service client → its client-identity case FAILS; (c) `expiresInDays` rounding down → its case FAILS. Paste each.
- [ ] **Step 10: Commit** every path above, message "documents: staff ask the customer, copy the link, revoke with Undo; the card's requests read (S-07 2b)".

---

## Task 8: The card: Ask the customer, the dialog, open requests, the customer's files; `/styleguide` (bis-frontend)

**Review:** opus.

**Files**
- Create: `…/contacts/document-request-dialog.tsx` (+ `document-request-dialog.test.ts`), `…/contacts/document-requests-list.tsx` (+ `document-requests-list.test.ts`)
- Modify: `…/contacts/documents-card.tsx` (+ `documents-card.test.ts`), `…/contacts/documents-card-handlers.ts` (+ `documents-card-handlers.test.ts`), `apps/web/src/app/(dashboard)/dashboard/styleguide/documents-demo.tsx` (+ `documents-demo.test.ts`)

**Interfaces**
- Consumes: the four actions (Task 7); `documentRequestsLoadFrom`, `documentRequestsRouteFor`, `expiresInDays`, `DocumentRequestsLoad`, `OpenRequestView` (Task 7); `cleanRequestItems`, `DOCUMENT_CATEGORIES`, `DOCUMENT_REQUEST_NOTE_MAX`, `isCustomerAuthor` (`@bis/db/document-rules`); keys from Task 2; `Dialog*` (`@/components/ui/dialog`), `Checkbox` (`@/components/ui/checkbox`), `Button`, `nativeFieldClass` (`@/components/ui/input`), sonner's `toast`.
- Produces:
  - `DocumentRequestForm` (presentational, no portal; the styleguide and tests render it) with props `{ locale: Locale; name: string; channels: { text: boolean; email: boolean }; initialItems?: readonly DocumentCategory[]; busy: boolean; error: MessageKey | null; onSubmit: (items: DocumentRequestItem[], channel: "text" | "email" | "link") => void; onCancel: () => void }`, and `DocumentRequestDialog` `{ open: boolean; …the form's props; onClose: () => void }` (the purge dialog's split, `document-purge-dialog.tsx:27-97`). `initialItems` is 2c's seam (Not in this PR).
  - `DocumentRequestsList` `{ locale: Locale; load: DocumentRequestsLoad; onRetry: () => void; onCopy: (id: string) => void; onRevoke: (id: string) => void }`: nothing drawn when ready and empty; a skeleton row while loading; `documents.requests.loadFailed` with a ghost Retry on error (its own failure, never the files', spec 6).
  - `DocumentHandlers` gains `askCustomer(input: { record; items; channel }): Promise<void>`, `copyRequestLink(id: string): Promise<void>`, `revokeRequest(id: string): Promise<void>`.

- [ ] **Step 1: Read** `documents-card.tsx` whole (567 lines: the container `:403-567`, the view `:279-381`, the header's one primary `:326-333`, the poll `:436-448`), `documents-card-handlers.ts:1-80` (`offer`, `say`, `once`), `document-purge-dialog.tsx`, `document-upload-panel.tsx:50-100` (the native select and the checkbox label), `billing-card.tsx:65-85` (the clipboard pattern), `styleguide/documents-demo.tsx` and its test, `apps/web/src/styles/tokens.css:90-96` (`--good`, `--warn`, `--crit`).

- [ ] **Step 2: Failing tests** (`renderToStaticMarkup`, `renderedText`, both languages against literals):
  - `document-request-dialog.test.ts`: (1) the form lists the nine categories as checkboxes with their labels, the Other note field, and the channel choice; with `channels: { text: true, email: true }` Text is selected; with `{ text: false, email: true }` Email is selected and Text is disabled with `documents.request.textOff`'s words beside it; with neither, only Copy link (mutation: pre-select Email when Text is available -> FAILS). (2) exactly ONE `data-variant="default"` button: "Send request" for text or email, "Create link" for link; Cancel is ghost (mutation: a second primary -> FAILS). (3) `initialItems: ["insurance"]` renders Insurance checked. (4) Spanish renders "¿Qué necesita?", "Pedir documentos a Ana" and "Enviar pedido" (usted; compared with literals). (5) the submit helper `requestFromForm(state)` (export it from the dialog file, pure) answers `{ error: "documents.request.pickOne" }` for nothing ticked, `{ error: "documents.request.noteNeeded" }` for Other with an empty note, and the `cleanRequestItems` result otherwise (mutation: submit Other with no note -> FAILS).
  - `document-requests-list.test.ts`: a ready load with one request renders the label "Asked for", each item as a dot AND a word ("Insurance · Received" with the `--good` dot, "Pool permit · Waiting" with the `--warn` dot; rule 3: assert the word, not only the colour), "expires in 6 days" from `expiresInDays`, and ghost Copy link and Revoke (no `data-variant="default"` at all; mutation: Revoke as a primary -> FAILS); an empty ready list draws nothing (`""`); loading draws a skeleton with no copy and no spinner (no `animate-spin`); error draws `documents.requests.loadFailed` with Retry; Spanish "vence en 1 día", "Pendiente".
  - `documents-card.test.ts`: the header gains a ghost "Ask the customer" beside Take photo while no panel is open, and the card STILL has exactly one `data-variant="default"` (Upload) (the existing assertions at `:48-49` stay; mutation: the new button as default -> FAILS); a document with `source: "customer"` reads "Sent by the customer · <when>" instead of "Added by …" (and "Enviado por el cliente · …" in Spanish).
  - `documents-card-handlers.test.ts`: `askCustomer` with a `link` answer writes the URL to the clipboard and toasts `documents.request.linkCopied`; with the clipboard refused it toasts `documents.request.copyFailed` with the URL as its description and `duration: Infinity` (billing-card's pattern); `sent` by text toasts `sentText`; `held` toasts `held` with the time in the returned zone; `blocked` toasts `notSent` with the reason's words; every path calls `reload` for the requests list once. `revokeRequest` runs at once and offers Undo (`offer`), whose action calls `undoRevokeDocumentRequestAction(accountId, id, revokedAt)` with the time the revoke answered (mutation: undo with `new Date()` -> FAILS). `copyRequestLink` calls `documentRequestLinkAction` and copies its URL.
  - `documents-demo.test.ts`: the existing exact counts unchanged (mutation: the demo renders a second Documents card -> `data-documents-card` 7 -> FAILS); `data-document-request-form` occurs twice (English and Spanish) and `data-document-requests` twice (one loaded with a received and a waiting item, one error).

- [ ] **Step 3: Run them to see them fail.**

- [ ] **Step 4: Implement.**
  - `document-request-dialog.tsx`: the form keeps its state locally (`useState`: a `Set<DocumentCategory>` seeded from `initialItems`, the Other note, the channel seeded `channels.text ? "text" : channels.email ? "email" : "link"`); categories as `<label><Checkbox …/> {tt(`documents.category.${c}`)}</label>` rows in `DOCUMENT_CATEGORIES` order; when Other is ticked, a text input (`nativeFieldClass`, `maxLength={DOCUMENT_REQUEST_NOTE_MAX}`, its label `documents.request.otherNote`); the channel as three native radio inputs in a `<fieldset>` with the `documents.request.how` legend, Text and Email `disabled` when not offered with their `…Off` sentence in `--text-2`; the error (from `requestFromForm` or the action) under the fields with `role="alert"`; footer: ghost Cancel, primary Send request / Create link (`disabled={busy}`; no spinner: the label stays). `export function requestFromForm(s: { picked: ReadonlySet<DocumentCategory>; note: string }): { items: DocumentRequestItem[] } | { error: MessageKey }`, building `{ key: c, category: c, note: c === "other" ? note.trim() : null }` in `DOCUMENT_CATEGORIES` order and running `cleanRequestItems`. Controls `min-h-11 md:min-h-8`, radii `rounded-[var(--radius-ctl)]`, every colour a token. The dialog wrapper is the purge dialog's (`Dialog` `open`/`onOpenChange`, `DialogContent data-document-request-dialog`, `DialogTitle` = `documents.request.title` with `{ name }`; Esc closes, focus returns to the "Ask the customer" button).
  - `document-requests-list.tsx`: a flat section under the file list, `data-document-requests`: a mono label (`documents.requests.label`, the Label role: Geist Mono 500, 10px, `+0.14em`, uppercase, as the card's other labels); one row per request: the items (each `label · word` with a 6px dot in `--good` when answered, `--warn` when waiting; the label is the category's words or the Other note), then `expires in N days` (`plural(m, "documents.requests.expires", n, locale)`, `documents.requests.expiresToday` at 0), then ghost `size="sm"` Copy link and Revoke. Rows have no hover target of their own (they are not openable); their buttons carry the visible focus ring.
  - `documents-card.tsx`: the container keeps a second load (`requestsLoad`, `requestsNonce`) fetched from `documentRequestsRouteFor(accountId, record)` with `cache: "no-store"` through `documentRequestsLoadFrom`, independently of the files' load (its failure never touches the files); `askOpen` state; the header (only while `p.panel` is null, beside Take photo) gains `<Button type="button" variant="ghost" className={control} data-ask-customer onClick={…}>{tt("documents.request.open")}</Button>` (shown only when `requestsLoad.kind === "ready"`, because the dialog needs `channels`); the view renders `<DocumentRequestsList …/>` after the file list and before the trash; the row's "added by" line reads `documents.addedByCustomer` for `doc.source === "customer"` (the view's `addedBy` is not consulted for it). The dialog submits through `handlers.askCustomer`, closes on success, and stays open with the action's error key on failure.
  - `documents-card-handlers.ts`: the three handlers, using the existing `offer`/`say`/`once` helpers; the clipboard write exactly as `billing-card.tsx:70-81` (with this tree's keys); the held time with `new Intl.DateTimeFormat(locale === "es" ? "es-US" : "en-US", { hour: "numeric", minute: "2-digit", timeZone: zone }).format(new Date(until))`.
  - `documents-demo.tsx`: add `DocumentRequestForm` (English, `channels { text: true, email: true }`) and in a `lang="es"` box (`channels { text: false, email: true }`, error `documents.request.noteNeeded`), and `DocumentRequestsList` loaded (one request: Insurance received, Other "Pool permit" waiting, expiring in 6 days) and in its error state. One customer file in the demo's live list (`source: "customer"`) so "Sent by the customer" is drawn; this changes no counted marker (it is a row in the existing card).

- [ ] **Step 5: Run** the five test files, `src/components/ui/material.test.ts`, `src/lib/i18n/ratchet.test.ts`, typecheck, eslint. All PASS.
- [ ] **Step 6: Probes:** (a) "Ask the customer" as the default variant → the card's one-primary assertion FAILS; (b) the list drawing state by colour only (drop the word) → the list case FAILS; (c) Undo with `new Date()` → the handlers case FAILS; (d) the channel seeded `"email"` → the dialog case FAILS. Paste each.
- [ ] **Step 7: Commit** every path above, message "documents card: Ask the customer, its dialog, the open requests with Copy link and Revoke, the customer's files (S-07 2b)".

---

## Task 9: The customer's page `/d/[token]` (bis-frontend)

**Review:** opus. **Runs beside:** Task 6.

**Files**
- Create: `apps/web/src/app/d/[token]/layout.tsx`, `apps/web/src/app/d/[token]/page.tsx`, `apps/web/src/app/d/[token]/data.ts`, `apps/web/src/app/d/[token]/customer-upload-list.tsx`, `apps/web/src/app/d/[token]/error.tsx` and tests `page.test.ts`, `layout.test.ts`, `error.test.ts`, `customer-upload-list.test.ts` (no `not-found.tsx`: the page never calls `notFound()`; an unknown token is the page's own `not_found` state); `apps/web/src/lib/document-requests/customer-client.ts` (+ `customer-client.test.ts`)

**Interfaces**
- Consumes: `customerPage`, `CustomerPage` (Task 5); `CustomerFileState`, `CUSTOMER_STATE_KEY`, `nextCustomerPollMs`, `pollKey` (Task 5); `prepareFile`, `xhrPut` (Task 4, `upload-core.ts`); `stripImage` (`lib/documents/strip-image.ts:22`); `PublicHtml` (`components/public/public-html.tsx`), `PublicBrand` (`components/public-brand.tsx:20`), `publicFormTheme`, `parseHostMode` (`lib/branding/public-form-theme.ts:234, :102`); keys `customerDocs.*` (Task 2). The two routes' answers (Task 5).
- Produces:
  - `type CustomerPhase = { kind: "uploading"; percent: number } | { kind: "checking" } | { kind: "received" } | { kind: "refused"; why: MessageKey; params?: Record<string, string> } | { kind: "closed" } | { kind: "failed" }`.
  - `uploadCustomerFile(token: string, itemKey: string, file: File, deps: CustomerDeps, onPhase: (p: CustomerPhase) => void): Promise<CustomerPhase>` with `CustomerDeps = { post: (path: string, body: unknown) => Promise<{ status: number; body: Record<string, unknown> }>; put: typeof xhrPut; strip: typeof stripImage }` and `browserCustomerDeps(): CustomerDeps` (`fetch` with `redirect: "error"`, `cache: "no-store"`, JSON in and out).

- [ ] **Step 1: Read** `apps/web/src/app/u/layout.tsx`, `apps/web/src/app/u/[token]/page.tsx` (the whole page: metadata, `UNBRANDED`, the theme on `<main>`, `PublicBrand`, the CSS-in-a-string convention with `var(--token, fallback)` and its "no backticks inside" rule), `apps/web/src/app/f/[publicId]/layout.tsx:1-80` (a layout that resolves `lang` from `params` with a `cache()`d loader), `components/public/public-html.tsx`, `components/public-brand.tsx`, `lib/documents/upload-core.ts` (Task 4), and `documents-card.tsx:436-448` (the poll pattern to copy).

- [ ] **Step 2: Failing tests.**
  - `customer-client.test.ts` (fake deps, one call log):
    1. A PDF: `post("/api/d/<token>/start", { itemKey, name, size, contentType })` → `put(uploadUrl, …)` → `post("/api/d/<token>/finish", { documentId, versionId })` → `{ state: "received" }` answers `{ kind: "received" }`, with `uploading 0 … 100` then `checking` reported on the way (mutation: finish before the PUT -> FAILS).
    2. A failed PUT is retried ONCE with the same URL; a second failure answers `{ kind: "failed" }` and never calls finish (spec 6: "a failed PUT is retried once"; mutation: no retry, or two retries -> FAILS by the call count).
    3. Start refusals map to words: `bad_type` → `customerDocs.why.type`; `too_large` → `customerDocs.why.size`; `rate_limited` → `customerDocs.why.limit`; `over_quota` with `phone` → `customerDocs.why.full` with `{ phone }`, without → `customerDocs.why.fullNoPhone`; `expired`/`revoked`/`completed`/`not_found` → `{ kind: "closed" }`; a 503 or a network error → `failed`. `prepareFile`'s own refusals: `documents.error.badType` → `why.type`, `documents.error.tooLarge` → `why.size`, else `failed`.
    4. Finish states: `virus` → `refused` with `customerDocs.why.virus`, `password` → `why.password`, `unscannable` → `why.unscannable`, `checking` → `checking`.
    5. An image goes through `strip` before start, and the stripped blob's size is what start is told (part 1 §5.3; mutation: send `file.size` -> FAILS).
    6. `browserCustomerDeps().post` calls `fetch` with `redirect: "error"` (2a's redirect defect, designed out; assert the init object with a stubbed global `fetch`).
  - `customer-upload-list.test.ts` (`renderToStaticMarkup` of the presentational `CustomerUploadView`, exported beside the client container; plan review I7): a local `refused` phase with `why: "customerDocs.why.full"` and `params: { phone: "(956) 555-0123" }`, rendered with `business: "Casa Verde"`, reads "Please call Casa Verde at (956) 555-0123." and, in Spanish, "Por favor llame a Casa Verde al (956) 555-0123."; `customerDocs.why.fullNoPhone` reads "Please call Casa Verde." / "Por favor llame a Casa Verde."; `renderedText` of every case contains no `{` (mutation: drop `business` from the view's params -> "{business}" is left -> FAILS); and: each item's label with one primary Upload and a ghost Take photo (`capture="environment"`, `accept="image/*"`), exactly one primary per item; server file states drawn as dot + word ("Received", "Checking", "We couldn't accept this file · It had a virus."); a local phase `uploading 45` reads "Uploading 45 %" (no spinner, no `animate-`); Spanish "Subiendo 45 %", "Revisando", "Tomar foto" (literals); the copy names no file and no size (mutation: render the file name -> FAILS: the fixture's file name must not appear).
  - `layout.test.ts` and `error.test.ts` (plan review I8): the layout's loader never throws (`loadPageSafe`: a rejected `customerPage` answers `null`, and the layout renders `PublicHtml` with `lang="en"`; mutation: await the throwing loader -> the shell is lost -> FAILS); `error.tsx` renders `customerDocs.error.title`, `.body` and a Retry button calling `reset`, in English AND Spanish stacked (the `/u` tree's bilingual pattern, since an error boundary gets no locale), compared with the literal strings, and its source imports nothing from `@bis/db` (an AST import check, as `read-gate.test.ts` reads imports; mutation: import the barrel -> FAILS).
  - `page.test.ts` (mock `./data`'s loader; render the server component's output with `renderToStaticMarkup`): an open Spanish request renders `lang`-correct copy ("Casa Verde le pide estos documentos"), the logo through `PublicBrand`, the tenant theme on `<main>` (`data-tenant-theme` when themed), and "Con tecnología de BIS" in the footer; an expired one renders `customerDocs.expired`, `customerDocs.ask` and the call line with the phone ("¿Preguntas? Llame a Casa Verde al (956) 555-0123."); revoked and not_found their own sentence; completed renders `customerDocs.done`; no state renders an upload control except open (mutation: render the list for an expired request -> FAILS). `generateMetadata` answers `robots: { index: false, follow: false }`, `referrer: "no-referrer"` and the title in the request's language.

- [ ] **Step 3: Run them to see them fail.**

- [ ] **Step 4: `customer-client.ts`:**

```ts
import type { MessageKey } from "@/lib/messages";
import { prepareFile, xhrPut } from "@/lib/documents/upload-core";
import { stripImage } from "@/lib/documents/strip-image";

/**
 * One customer file's journey (spec 4.3, 4.4; part 1's V6): prepare (an image redrawn without its
 * location data, the size checked AS STORED), start (the server reserves under the request), PUT the
 * bytes straight to storage (retried once, spec 6), finish (the server checks and scans them). Every
 * answer is a phase the page words; nothing here names a file. Browser-safe: no server action, no
 * barrel import.
 */
export type CustomerPhase =
  | { kind: "uploading"; percent: number } | { kind: "checking" } | { kind: "received" }
  | { kind: "refused"; why: MessageKey; params?: Record<string, string> } | { kind: "closed" } | { kind: "failed" };
export type CustomerDeps = {
  post: (path: string, body: unknown) => Promise<{ status: number; body: Record<string, unknown> }>;
  put: typeof xhrPut; strip: typeof stripImage;
};
const refused = (why: MessageKey, params?: Record<string, string>): CustomerPhase => (params ? { kind: "refused", why, params } : { kind: "refused", why });
const CLOSED = new Set(["expired", "revoked", "completed", "not_found"]);

function startRefusal(error: unknown, body: Record<string, unknown>): CustomerPhase {
  if (typeof error === "string" && CLOSED.has(error)) return { kind: "closed" };
  if (error === "bad_type") return refused("customerDocs.why.type");
  if (error === "too_large") return refused("customerDocs.why.size");
  if (error === "rate_limited") return refused("customerDocs.why.limit");
  if (error === "over_quota") return typeof body.phone === "string" ? refused("customerDocs.why.full", { phone: body.phone }) : refused("customerDocs.why.fullNoPhone");
  return { kind: "failed" };
}
const FINISHED: Record<string, CustomerPhase> = {
  received: { kind: "received" }, checking: { kind: "checking" },
  virus: { kind: "refused", why: "customerDocs.why.virus" }, password: { kind: "refused", why: "customerDocs.why.password" },
  unscannable: { kind: "refused", why: "customerDocs.why.unscannable" },
};

export async function uploadCustomerFile(
  token: string, itemKey: string, file: File, deps: CustomerDeps, onPhase: (p: CustomerPhase) => void,
): Promise<CustomerPhase> {
  const prepared = await prepareFile(file, deps.strip);
  if (!prepared.ok) {
    return prepared.error === "documents.error.badType" ? refused("customerDocs.why.type")
      : prepared.error === "documents.error.tooLarge" ? refused("customerDocs.why.size") : { kind: "failed" };
  }
  const base = `/api/d/${encodeURIComponent(token)}`;
  const start = await deps.post(`${base}/start`, { itemKey, name: file.name, size: prepared.blob.size, contentType: prepared.contentType })
    .catch(() => null);
  if (!start) return { kind: "failed" };
  if (start.status !== 200) return startRefusal(start.body.error, start.body);
  const { documentId, versionId, uploadUrl } = start.body as { documentId?: unknown; versionId?: unknown; uploadUrl?: unknown };
  if (typeof documentId !== "string" || typeof versionId !== "string" || typeof uploadUrl !== "string") return { kind: "failed" };
  const progress = (percent: number) => onPhase({ kind: "uploading", percent });
  onPhase({ kind: "uploading", percent: 0 });
  // Spec 6: a failed PUT is retried once, to the same signed URL; then "Didn't upload. Try again."
  const put = (await deps.put(uploadUrl, prepared.blob, prepared.contentType, progress).catch(() => false))
    || (await deps.put(uploadUrl, prepared.blob, prepared.contentType, progress).catch(() => false));
  if (!put) return { kind: "failed" };
  onPhase({ kind: "checking" });
  const finish = await deps.post(`${base}/finish`, { documentId, versionId }).catch(() => null);
  if (!finish) return { kind: "failed" };
  if (finish.status !== 200) return typeof finish.body.error === "string" && CLOSED.has(finish.body.error) ? { kind: "closed" } : finish.body.error === "bad_type" ? refused("customerDocs.why.type") : { kind: "failed" };
  return FINISHED[String(finish.body.state)] ?? { kind: "failed" };
}

export const browserCustomerDeps = (): CustomerDeps => ({
  post: async (path, body) => {
    const res = await fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), cache: "no-store", redirect: "error" });
    const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    return { status: res.status, body: json };
  },
  put: xhrPut, strip: stripImage,
});
```
  (If `prepareFile`'s refusal type names its field otherwise than `error`, use its name: `upload-core.ts` is Task 4's verbatim move of `upload-client.ts:26-48`.)
- [ ] **Step 5: The page.** `data.ts`: `export const loadPage = cache((token: string) => customerPage(serviceDb(), token, new Date()));` (React `cache`, the `/f` tree's `loadForm` pattern; `serviceDb` here is the public tree's, outside `in-account-service-reads`' roots, and `customerPage` proves the token before any other read) and `export async function loadPageSafe(token: string): Promise<CustomerPage | null> { try { return await loadPage(token); } catch { return null; } }` (plan review I8, `app/f/[publicId]/data.ts`'s `loadFormSafe` pair). `layout.tsx`: `export default async function Layout({ children, params }: { children: React.ReactNode; params: Promise<{ token: string }> }) { const { token } = await params; const page = await loadPageSafe(token); return <PublicHtml lang={page?.language ?? "en"}>{children}</PublicHtml>; }`: the shell always stands, so `error.tsx` (colocated at `[token]`, `"use client"`, `({ reset }) => …`, the two languages stacked, `m` imported for its six strings and nothing else, plain CSS classes from the page's `DOCREQ_CSS` names, no `@bis/db`) has somewhere to render when the page's own call to the same rejected promise throws; read `app/f/[publicId]/error.tsx`'s header for why the two fixes are a pair. `page.tsx`: `export const dynamic = "force-dynamic";` `generateMetadata` as above; the component: `const page = await loadPage(token)`, `const tt = (k, p?) => t(m, k, page.language, p)`, `publicFormTheme(page.branding ?? UNBRANDED, false, parseHostMode(undefined))` on `<main className="bis-docreq-page" lang={page.language} …>` exactly as `/u` does, `<PublicBrand name={page.business} logoUrl={page.logoUrl} />`, then by `page.state`: `open` → the heading (`customerDocs.heading`), the intro, and `<CustomerUploadList token={token} locale={page.language} business={page.business} items={page.items} />`; `completed` → `customerDocs.done`; `expired` / `revoked` / `not_found` → their sentence and `customerDocs.ask`; every state but `not_found` ends with the call line (`customerDocs.call` with `{ business, phone }`, or `customerDocs.callNoPhone`); the footer `customerDocs.poweredBy` linking `https://bis-rgv.com` (`/u`'s footer). `UNBRANDED` is `/u`'s constant (copy it). CSS: a `DOCREQ_CSS` string in `/u`'s convention (no backticks inside): copy `UNSUB_CSS`'s page, measure, title, detail, primary, ghost, focus and powered-by rules renamed `bis-docreq-*`, and add `.bis-docreq-item` (a row: label, then its files, then its two buttons; a 1px `var(--border, #e4e4e7)` rule between items), `.bis-docreq-dot` (8px, `border-radius: 999px`), and the three state colours `var(--good, #15803D)`, `var(--warn, #B45309)`, `var(--crit, #B91C1C)` (the light tokens' own values, `tokens.css:93-95`, as `/u`'s fallbacks are), buttons `min-height: 44px`, and `@media (prefers-reduced-motion: reduce)` disabling any transition. Rule 9: the client's logo and colour via `publicFormTheme`; `--surface-0` is not loaded in public trees (they never import `globals.css`), so the page's ground is `var(--background, transparent)` as `/u`'s.
- [ ] **Step 6: `customer-upload-list.tsx`** (`"use client"`): the presentational `CustomerUploadView` (props: `locale`, `business: string`, `items: { key; label; files: CustomerFile[]; local: CustomerPhase[] }[]`, `onPick: (itemKey: string, file: File) => void`; every word with params is rendered with `{ business, ...params }`, plan review I7) and the container `CustomerUploadList` (props `token`, `locale`, `business`, `items` from the server):
  - each item: its label; its server files, each a dot + word (`CUSTOMER_STATE_KEY`, removed states prefixed by `customerDocs.refused`); its local in-flight phases (uploading `customerDocs.uploading` with `{ percent }`, failed `customerDocs.failed`, refused with its `why`); a hidden `<input type="file" accept=".pdf,.jpg,.jpeg,.png,.webp,.docx,.xlsx,application/pdf,image/*">` behind the primary Upload, and a hidden `<input type="file" accept="image/*" capture="environment">` behind the ghost Take photo (shown only on a coarse pointer or a narrow screen, the card's rule `documents-card.tsx:328-330`).
  - picking a file runs `uploadCustomerFile(token, itemKey, file, browserCustomerDeps(), onPhase)`; the local entry tracks its phases; when it ends `checking`, `received` or `refused` with a scan word, the local entry is DROPPED and `router.refresh()` runs (the server now lists that file); `closed` → `router.refresh()` (the page turns into its dead end); `failed` or a pre-upload refusal stays as a local line.
  - the re-read, exactly the card's shape (`documents-card.tsx:436-448`), scheduled from each Checking file's own age as the SERVER computed it at this render (plan review I9; never `Date.now()` in the browser, never the page-open time): `const [reads, setReads] = useState(0);`, `const ms = nextCustomerPollMs(items.flatMap((i) => i.files));`, `const key = pollKey(ms, reads);`, an effect keyed `[key]` that, when `ms !== null`, sets a timeout whose CALLBACK does `router.refresh(); setReads((r) => r + 1);` and clears it on cleanup (the same `eslint-disable-next-line react-hooks/exhaustive-deps` line and reason as the card). No `setState` in the effect body.
- [ ] **Step 7: Run** the three test files, `src/lib/i18n/ratchet.test.ts`, `src/lib/documents/read-gate.test.ts` (the page mints nothing), typecheck, eslint. All PASS.
- [ ] **Step 8: Probes:** (a) no PUT retry → client case 2 FAILS; (b) an effect keyed on `ms` alone → no unit test can see it (no DOM): say so in the report; Task 12 test 3 is its proof (2a Task 9's lesson); (c) the file name rendered → the view case FAILS; (d) an expired page drawing the list → the page case FAILS. Paste each.
- [ ] **Step 9: Commit** every path above, message "the customer's upload page /d/<token>: branded, in their language, upload or take a photo, Checking then Received (S-07 2b)".

---

## Task 10: The proxy carve-out; `.env.example` (bis-platform)

**Review:** sonnet. **Runs beside:** Tasks 1 and 2.

**Files**
- Modify: `apps/web/src/proxy.ts` (the matcher and its comment), `apps/web/src/proxy.test.ts`, `.env.example`, `apps/web/playwright.config.ts` (two env lines; plan review I10)

- [ ] **Step 1: Failing test.** In `proxy.test.ts`: add `"/d/sometoken"` and `"/d/AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"` to the skip list (`:21-26`); add `"/docs"`, `"/dashboard/d"` and `"/api/d/sometoken/start"` (an API path still runs the proxy, unprotected, as `/api/unsubscribe/tok` does) to the run list (`:28-33`); rename `:36`'s case "only the five trees are carved out" and add `"/dx"` to its list. Run → the `/d/…` skip cases FAIL.
- [ ] **Step 2: Implement.** `proxy.ts`'s matcher becomes `"/((?!_next|c/|f/|b/|u/|d/|.*\\..*).*)"`; its comment (`:9-28`) gains one sentence: "`/d/<token>` (S-07 2b) is the customer's document upload page, reached from a text or an email, with no sign-in, the same reason as `/u`." Run → PASS. `isProtected` stays `["/dashboard(.*)"]`.
- [ ] **Step 3: `.env.example`**, beside the other server secrets:

```
# Customer document links (S-07 2b). REQUIRED: a fresh random value of at least 32 characters
# (node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"), different in
# Production and Preview; there is no fallback. Rotating it ends every open customer upload link
# (they live 7 days); staff then use Copy link again on any request still open.
DOCUMENT_LINK_SECRET=
```
- [ ] **Step 3b: Playwright's link secret** (plan review I10). In `apps/web/playwright.config.ts`, beside the scanner fixture constants: `const DOCUMENT_LINK_FIXTURE = "bis_e2e_document_link_fixture_only_0000000000";` and `process.env.DOCUMENT_LINK_SECRET = DOCUMENT_LINK_FIXTURE;` (the runner's own env, so the spec's `requestToken` matches the app's), and `DOCUMENT_LINK_SECRET: DOCUMENT_LINK_FIXTURE` in the app server's `env` (beside `SCANNER_SECRET`). Set unconditionally: a developer's `.env.local` value must not make the runner and the app disagree. `pnpm --filter web exec playwright test --list` still loads the config.
- [ ] **Step 4: Probe:** drop `d/` from the matcher → the skip cases FAIL; paste. **Commit** `-- apps/web/src/proxy.ts apps/web/src/proxy.test.ts .env.example apps/web/playwright.config.ts`, message "proxy: /d/<token> skips Clerk like the other public trees (S-07 2b)".

---

## Task 11: Regenerate the i18n baselines (bis-crm)

**Review:** sonnet (or orchestrator-checked if byte-identical).

- [ ] **Step 1.** After Tasks 2, 3b, 8, 9 have committed: `pnpm --filter web exec tsx scripts/generate-i18n-baseline.ts` (ratchet.test.ts:6). Expected: byte-identical, or ONLY reductions (new files start at zero; every new key has a `.es` twin). If the generator ADDS any count or frozen key, STOP: a task admitted a violation; report the file and the string.
- [ ] **Step 2.** `pnpm --filter web exec vitest run src/lib/i18n/ratchet.test.ts src/lib/messages.test.ts` → PASS. Commit the two baseline files if changed, message "i18n: baselines after S-07 2b".

---

## Task 12: The e2e spec (bis-e2e-qa)

**Review:** sonnet. **Runs:** never by the agent (the orchestrator runs Playwright).

**Files**
- Create: `apps/web/e2e/document-requests.spec.ts`

- [ ] **Step 1: Read** `apps/web/e2e/documents-scan.spec.ts` whole (2a's: env loading, the fixture contact, the card locators, the EICAR two-half join, the version reads, the afterAll that removes objects and rows and re-reads), `e2e/support.ts:100-135`, `e2e/public-form-theme.spec.ts:60-70` (an anonymous `storageState`), `e2e/booking.spec.ts:262-266` (a second, anonymous browser context), `apps/web/playwright.config.ts:133-153, :235-264` (the real shim and the fake clamd already run in every e2e).
- [ ] **Step 2: Write the spec.** `import { test, expect } from "./fixtures/test"` (never `@playwright/test`: `clerk-cookie-guard.test.ts`). `test.describe.configure({ mode: "serial", timeout: 150_000 })`. `STAMP = \`DocReq${Date.now()}\``. `beforeAll`: `readClientFixture()` (throw if missing) and one contact on the fixture account through `createContact(serviceDb(), accountId, { firstName: "Ana", lastName: STAMP }, ACTOR)` (refuse `existing`). The link is computed in the test with `requestToken(id)` imported from `apps/web/src/lib/document-requests/token.ts`; the runner and the app server share the fixture `DOCUMENT_LINK_SECRET` set in `playwright.config.ts` (Task 10), and test 1 ALSO compares it with the clipboard's text, so a mismatch fails loudly rather than silently. The tests:
  1. **Staff asks, by link.** On the contact's page (signed-in state): the Documents card's "Ask the customer" → the dialog → tick Insurance and Other, type "Pool permit" → choose Copy link → "Create link" (the one primary). Grant `clipboard-read`; the toast says "Link copied. It works for 7 days."; the clipboard holds `<baseURL>/d/<requestToken(id)>`, where `id` is read back from `document_requests` for this contact (service client; exactly one row, `channel = 'link'`, `items` as ticked, no `token` column exists to read). The card lists "Insurance · Waiting", "Pool permit · Waiting", "expires in 7 days". The contact's timeline shows "You asked for 2 documents" (or the fixture user's mark as the timeline words it).
  2. **The customer uploads, with no sign-in** (a NEW context with `storageState: { cookies: [], origins: [] }`): goto the link → the page shows the account's name in the heading and "Powered by BIS"; `html[lang]` is the request's language; no Clerk cookie is set (the cookie guard). Upload a small clean PDF on Insurance → "Uploading …" then "Received" (fake clamd: clean). Upload `bad.pdf` on Other, built exactly as 2a's fixture is (`Buffer.concat([pdf("bad"), Buffer.from("\n% " + EICAR + "\n")])`, `e2e/documents-scan.spec.ts:108`, with `EICAR` joined at run time from the two halves declared on separate lines as at `:27-29`; plan review I11) → "We couldn't accept this file" and "It had a virus." Upload a clean PDF on Other → "Received" → after the refresh the page reads "Thank you. <business> has everything it asked for." Then, service client: `document_requests.completed_at` is set; two `documents` rows with `source = 'customer'`, `created_by = 'customer:<id>'`, categories `insurance` and `other`, each with a clean version, and one removed (infected) version on a third; ONE `tasks` row with `document_request_id = <id>` and `document_request_kind = 'received'`. The staff page (first context, reloaded): the timeline shows "Customer sent …" rows; the work queue (`/dashboard/accounts/<id>/tasks`) lists "<name> sent documents · Review".
  3. **Checking holds, then turns, with no reload** (the poll's only proof; 2a Task 9's carry; plan review I9: no reload anywhere before or during the wait). Seed everything BEFORE the customer's page is first opened, with the service client: a request for the contact (a fresh uuid, `token_hash = sha256(requestToken(id))`, TWO items `id` and `permit` so one file cannot complete it, channel `link`, `created_by` the fixture actor); `rpc("start_document_request_upload", …)` on `id`; `storage.from("documents").upload(storage_path, <a clean PDF>, { contentType: "application/pdf" })`; `rpc("mark_document_version_ready", { …, p_sha256: <its sha256> })`. No finish runs, so no scan runs: the version is ready and pending, and a few seconds old. The customer's FIRST `goto` of the link; ASSERT that item reads "Checking" first, and only then start the clock (re-review m3). Count the page's own re-reads with `page.on("request")` (requests to the page's URL after that assertion). Wait 18 s from the assertion: still "Checking", and at least 3 re-reads were seen (the schedule is 5 s while the file is under a minute old). Then `rpc("record_document_scan", { …, p_verdict: "clean" })`, and WITHOUT any reload expect "Received" within 20 s (mutations it catches: an effect keyed on `ms` alone fires once, so fewer than 3 re-reads and never "Received"; a schedule from the page-open time is not caught here, the unit test is its proof).
  4. **A revoked link is a dead end.** Staff: on the card, Revoke the request from test 3 (if not completed; else make one more) → toast "Request revoked." with Undo (do NOT press it); the row leaves the list. Customer: the link reads "This link is no longer active." and "Ask <business> for a new link."; a direct `POST /api/d/<token>/start` answers 410 `{ "error": "revoked" }`.
  `afterAll`: delete every storage object of the contact's documents, then `tasks` with `document_request_id` in the test's requests, the documents, the requests, the contact; check every `error`; re-read that no row and no object is left.
- [ ] **Step 3:** `pnpm --filter web exec playwright test --list e2e/document-requests.spec.ts` lists four tests (listing does not run them). `pnpm --filter web exec eslint e2e/document-requests.spec.ts`. Commit, message "e2e: a customer upload link end to end without Clerk, the virus path, Checking turning Received without a reload, a revoked link (S-07 2b)".

---

## Task 13: Whole-branch final review (checkpoint, not an implementer task)

**Reviewer:** opus, fresh context. Runs after Tasks 1–12.

- [ ] **Step 1.** Read the spec end to end and this plan's Deviations, then `git diff 3eb5b246...HEAD` in `<WT>`; walk the coverage table below row by row against the diff.
- [ ] **Step 2.** Web tests by path: every test file Tasks 2–9 touched, plus `src/lib/i18n/ratchet.test.ts`, `src/lib/messages.test.ts`, `src/components/ui/material.test.ts`, `src/lib/documents/read-gate.test.ts`, `src/lib/consent/scans.test.ts`, `src/proxy.test.ts`, `src/app/api/cron/reminders/route.test.ts`, `"src/app/(dashboard)/dashboard/accounts/[accountId]/in-account-service-reads.test.ts"`; `pnpm --filter web typecheck`. The db suites on a replica of your own (ports `55591`/`55592`/`55593`): `document-requests-schema.test.ts`, the six pinned files, `schema-grants-guard.test.ts` on `post`, and `document-requests.test.ts`, `documents.test.ts`, `record.test.ts`, `timeline-merge.test.ts` behind PostgREST. Re-run two probes of your own choosing, by name. A bis-design-reviewer pass on a running build (the card's dialog and list in both themes, the customer page on a phone width with a themed and an unthemed account) if the orchestrator provides one.
- [ ] **Step 3.** Hunt specifically: (a) any query on a token route without `.eq("account_id", …)` and the request id (or done inside 0080's function from the locked request row); a record, category, path or title read from the customer's body; (b) the token in any log line, error body, database column, event payload or `automation_log` payload (`git grep -n "token" -- apps/web/src/lib/document-requests apps/web/src/app/api/d apps/web/src/app/d` and read each hit); (c) a customer route that answers before proving the token, or treats an expired, revoked or completed request as open (start AND finish); (d) any new `createSignedUrl`/`createSignedUrls` or a stored file's name, size or link on the customer page; (e) the finish path differing between staff and customer (`finish-upload.ts` is the one body; `holdErrors: true`; never `spendScanError`); (f) `serviceDb` or `ledgerDb` in any new file under `lib/` or not listed in `ALLOWED`; (g) a send that bypasses the gate, a `staff_typed` or `hours: "any"` kind for the request, a held request released after revoke/expiry, a message row for a held send, an email or text in two languages; (h) the work-queue To-do opened twice for one request and kind, or not guarded by `keep_task_links`; (i) 0080's ASCII rule, its grants (`start_document_request_upload` for `service_role` only), the column drop FIRST, `document_requests` RLS and the technician fence; (j) rule 8 (exactly one `data-variant="default"` on the card, one per dialog, one per customer item), rule 3 (every state a dot and a word), rule 7 (no spinner or pulse), rule 9 (the customer page's brand and footer); (k) the customer page's poll keyed so it re-arms on every read; (l) a test that cannot fail (memory "Vacuous test shapes"), a Spanish assertion against `t()`'s output, a raw-markup negative on an apostrophe string; (m) the `documentRequest` kind missing from any exhaustive map (`authorOf`, `timeline-rows`, `recent-rows`, both timelines, `ROW_ICON`, `ROW_KINDS`); (n) `MEASURED` raised without its comment; (o) the reconcile (Task 6b) unbounded, or able to open a To-do for a revoked request or a staff file; (p) a finish refused on a completed or expired request for a version it already reserved, or accepted on a revoked one (deviation 13); (q) `DOCUMENT_LINK_SECRET` with any fallback, or any real value in a test, `.env.example` or `playwright.config.ts`; (r) **the plan review's carried minors M3, M4, M5, M8, M9, M10 and M12** (their text is in the orchestrator's review of `9748f88d`, recorded in the ledger): check each against the diff and report each as fixed, still open, or not applicable.
- [ ] **Step 4.** Report findings by severity with file:line; the orchestrator routes fixes to the owning task's agent.

---

## Task 14: Rollout (orchestrator; LAST; not a coding task)

Each step reads its own evidence; nothing is inferred from an earlier run.

- [ ] **Step 1. Deviation 1** is ruled (Task 0 step 3); the ledger records the ruling.
- [ ] **Step 1b. The link secret** (ruling I10). Generate TWO values with `node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"` into a scratch file under `<SCRATCH>` (never the ledger, the PR or a log); set `DOCUMENT_LINK_SECRET` in Vercel Production (sensitive, Production ONLY) to one and in Preview (sensitive, Preview ONLY) to the other; redeploy the branch's Preview; delete the scratch file once both are set. Production must have it BEFORE the merge deploys, or every Ask the customer fails with `documents.request.failed`.
- [ ] **Step 2. bis-ci** (only AFTER Task 13 approves; orchestrator ruling, as 2a did): `gh workflow run ci-project-setup.yml -f step=push-dry-run --ref feat/s07-vault-2b` → its log lists exactly `0080_document_requests.sql`; then `-f step=push`. Post-apply, read-only with `pnpm --filter @bis/db ci:sql`: `select count(*) from information_schema.columns where table_name='documents' and column_name='scan_status'` → 0; `select relrowsecurity from pg_class where oid='public.document_requests'::regclass` → `t`; `select has_function_privilege('service_role','public.start_document_request_upload(uuid,uuid,text,bigint,text,text,text)','EXECUTE'), has_function_privilege('authenticated','public.start_document_request_upload(uuid,uuid,text,bigint,text,text,text)','EXECUTE')` → `t | f`; `select pg_get_constraintdef(oid) from pg_constraint where conname='automation_log_source_check'` names `document_request`. From here on the `@bis/db` suites may run against bis-ci again.
- [ ] **Step 3. Push and CI.** Until Step 2, `e2e` is red on its migration check by design (0080 not on bis-ci); after Step 2, re-run and read `verify` and `e2e` ON THE HEAD SHA (`gh api repos/{owner}/{repo}/commits/<sha>/check-runs`). `e2e` runs `document-requests.spec.ts` through the real shim and the fake clamd. A CI-vs-local disagreement is an environment finding first (memory "CI vs local divergence").
- [ ] **Step 4. Production pre-flight** (read-only, MCP `execute_sql` on `tlbkbmlrfafquucsmsmm`): `select count(*) from information_schema.columns where table_name='documents' and column_name='scan_status'` → 1 (still there); `select max(version) from supabase_migrations.schema_migrations` → the 0079 apply (`20261015175953`); and on the deployed code: `git grep -n "scan_status" origin/main -- apps/web/src packages/db/src ':!*test*'` shows only VERSION reads (no `documents.scan_status` reader or writer in the build that is live), so dropping it cannot break the running deploy. Then `apply_migration` with 0080's exact text, ONCE (Task 1 step 6 proved no backslash; md5 equals Task 1's). Ledger line: `0080 APPLIED <date> on bis-ci and production — NEVER RE-APPLY`.
- [ ] **Step 5. Parity and the advisor.** `docs/runbooks/ci-supabase-project.md` §5: `fingerprint.sql` on both; the table, the function, the trigger, the constraints, `keep_task_links`' body equal. MCP `get_advisors` (security): a finding about `document_requests` would be unexpected (RLS on, two policies): stop and read it.
- [ ] **Step 6. Gates, one at a time:** `pnpm check`, `pnpm --filter web build`, `pnpm --filter web test:e2e` (check no `screenshots.yml` run is in progress first).
- [ ] **Step 7. Preview, by hand (owner and orchestrator together):** on the branch's Preview (bis-ci), on a throwaway contact of the per-run-style test account (never Test Client One), with danlo's own phone and email as the contact's: (a) Ask the customer by **Text** → verified by the contact's conversation row (Spanish when the contact's language is Spanish, the link last, the STOP line, the person mark) and the "What went out" row `sent` (Assumption A9: Preview's SMS provider is the fake unless the orchestrator has set `SMS_DEV_REDIRECT_TO`; arrival on danlo's phone is checked only then); (b) open the link on the phone: the client's logo and colour, "Tomar foto" opens the rear camera, a photo uploads and reads "Recibido"; (c) **Email** a second request → its conversation row and the "What went out" row `sent`; only if the email provider is real on Preview (A9), the branded email in one language end to end, its button opening the page; (d) upload `bad.pdf`, the PDF+EICAR fixture built as `e2e/documents-scan.spec.ts:108` builds it (written to `<SCRATCH>` by a two-line node script joining the two halves; plan review I11) → "No pudimos aceptar este archivo · Tenía un virus." (the real worker); (e) Revoke → the page's dead end; (f) a request sent after 21:00 in the account's zone shows "It goes out at 8:00 AM" and is held in "What went out" (only if the timing allows; otherwise read the unit test). Delete the throwaway contact and its files afterwards.
- [ ] **Step 8. Merge** (squash, through the PR, after the head SHA's `verify` and `e2e` are green and Task 13's findings are closed). The PR body names: deviations 1–12 (1 with its ruling), the pinned tests this PR changes, "Not in this PR", the Preview check's results, and the 0080 apply lines.
- [ ] **Step 9. After the deploy.** The deploy reads READY on the merge SHA. On an AGENCY-OWNED production record (never a client's): Ask the customer with **Copy link** (no text to anyone), open the link in a private window, upload one small clean PDF → "Received"; `select completed_at from document_requests where id = '<id>'` (read-only) is set when it was the only item; the To-do is in the work queue; then trash and Delete forever the file, and re-read that no object is left. Tracker: item 6 / F-005 stay `in_progress` (spec §8) with "part 2b (customer upload links) shipped #<n>".

---

## Spec coverage

| Spec | Where |
|---|---|
| §1 row 2b: the request, migration 0080 | Task 1; deviation 2 (the retired column first) |
| §1 row 2b: delivery by text, email or copied link | Task 6 (text, email), Task 7 (link, create), Task 8 (dialog); deviations 3, 11 |
| §1 row 2b: the public page `/d/[token]` | Tasks 5, 9, 10 |
| §1 row 2b: customer uploads filed under the requested category | Task 1 (`start_document_request_upload`), Task 5 (start, title) |
| P5 named documents, Other with a note, 7 days, 25 MB, 20 a day | Task 1 (checks, expiry, rate), Task 3 (`cleanRequestItems`), Task 5 (size), Task 8 (dialog); deviation 9 |
| P6 Text only when allowed and pre-selected, Email with an address, Copy link always | Task 6 (`requestChannels`), Task 7 (route), Task 8 (dialog's seed) |
| §4.1 `document_requests` columns, server-written, members read | Task 1; deviation 1 (no default id) |
| §4.1 answered derived from `request_id` + `request_item_key` | Task 1 (columns, trigger), Task 3 (`listOpenDocumentRequests`) |
| §4.1 `source = 'customer'`, `customer:<requestId>` → the customer mark | Task 1 (coherence), Task 3 (`isCustomerAuthor`), Task 3b (`authorOf`) |
| §4.1 token: 32 bytes, base64url, URL only, sha256 stored, never logged by our code (amended: derived, `DOCUMENT_LINK_SECRET` required) | Task 5 (`token.ts`, test 8), Task 13 step 3(b); deviation 1 |
| §4.2 Pedir al cliente on contact and group pages; the dialog | Task 8; deviation 3 (groups) |
| §4.2 composed in the request's language through the send paths; consent, stops, quiet hours, What went out | Task 6; deviation 11 |
| §4.2 Copy link sends nothing, `channel = 'link'` | Task 7 (create, case 4) |
| §4.2 the card lists open requests, "vence en 6 días", Copy link, Revoke with Undo | Tasks 7, 8 |
| §4.2 timeline "Ana pidió 2 documentos" (person mark); revoke and expiry not rows | Task 3b; deviations 6, 12 |
| §4.3 brand, `--surface-0` ground, Powered by BIS, request language with `lang` | Task 9 (rule 9 via `publicFormTheme`, `PublicHtml lang`) |
| §4.3 Subir and Tomar foto (rear camera, EXIF stripped) | Task 9 (`capture="environment"`, `prepareFile` with `stripImage`) |
| §4.3 per-file Subiendo → Revisando → Recibido, or "No pudimos aceptar este archivo" (type, size, virus, quota) | Tasks 5, 9; the password reason via `removedReason` |
| §4.3 the customer never sees stored files | Global Constraints; Task 9 view test; `read-gate.test.ts` |
| §4.3 expired, revoked, completed pages naming the business and its phone | Tasks 5 (`customerPage`), 9 |
| §4.4 two public routes, each re-proving the token; explicit account and record filters | Tasks 1, 5; Task 13 step 3(a), (c) |
| §4.4 limits; over quota: call us, and a work-queue item | Task 1, Task 5 (409 with phone, `openRequestTask("storage_full")`); deviation 4 |
| §4.4 filed, `owners_only = false`, source customer, linked, scanned (2a) | Task 1, Task 4 (`finishStoredUpload`, `holdErrors`) |
| §4.5 a clean file answers its item; completion stops the link | Task 1 (trigger), Task 5 (`completed` refused); deviation 8 |
| §4.5 news per file (customer mark); ONE work-queue item per request | Task 3b, Task 4 (`openReceivedTaskFor`), Task 6b (the reconcile, ruling I5); deviations 4, 8 |
| §4.5 (amended): a reserved version still finishes after completion or expiry; revoked refuses | Task 5 (`customerFinish`, case 2); deviation 13 |
| §6 each card fails on its own; customer PUT retried once, then "No se subió" | Task 8 (requests load separate), Task 9 (client case 2) |
| §7 token isolation, expired/revoked/completed refuse both routes, record A cannot file onto B | Task 1 (start cases), Task 3 (`getRequestDocument`), Task 5 (cases 2, 3, 7) |
| §7 e2e customer upload through `/d/[token]` without Clerk | Task 12 |
| §8 rollout: bis-ci first, production once, parity; 2b reads next.config and the proxy | Task 14; Task 10 (proxy; `next.config.ts` has no CSP, Assumption A2) |
| Amended 2a notes: per-caller scanner secrets, the finish never spends, `removedReason` for the customer page | unchanged worker; Task 4 (`holdErrors`); Task 5 (`customerFileState`) |
| 2a deviation 2: 0080 drops `documents.scan_status` first | Task 1 step 5 (statement 1), Task 14 step 4 |
| 2c | "Not in this PR"; Task 8's `initialItems` seam |

## Self-review notes (the writer's own pass, 2026-10-15)

- **Spec coverage:** every §4 bullet maps to a task above; the one spec instruction not followed literally is "32 random bytes" (deviation 1, ACCEPTED by the orchestrator 2026-10-15), because "Copy link" on an open request cannot exist with a stored hash of random bytes.
- **Vacuity pass:** every prescribed test names its mutation; the order-sensitive ones (finish's object-then-rows, deliver's row-before-provider, scan-version's verdict-then-hook) assert ONE shared call log, never two independent `toHaveBeenCalled`s; every copy assertion uses `renderedText` and literal Spanish; the poll's only real proof is e2e test 3, and Task 9 step 8 says so instead of pretending a unit test covers it.
- **Public rule:** the customer supplies only an item key (start) or a document and version id (finish); the record, category and author are set inside 0080's function from the locked request row, so "a token for record A cannot file onto record B" holds by construction and is still tested (Task 1, Task 5 case 3 and 7).
- **Types across tasks:** `DocumentRequestItem`, `DocumentRequestChannel`, `DocumentRequestState`, `cleanRequestItems`, `documentRequestState`, `isCustomerAuthor` (Task 3, document-rules) → Tasks 3b, 5, 7, 8; `DocumentRequestRow`, `OpenDocumentRequest`, `RequestFile`, `DocumentRequestTarget`, `RequestStartOutcome` (Task 3) → Tasks 4, 5, 6, 7; `finishStoredUpload`, `cleanUpUpload`, `openRequestTask`, `openReceivedTaskFor`, `prepareFile`/`xhrPut` in `upload-core.ts` (Task 4) → Tasks 5, 9; `requestToken`, `tokenHash`, `requestUrl`, `CustomerFileState`, `itemsSentence`, `nextCustomerPollMs`, `pollKey`, `customerPage` (Task 5) → Tasks 6, 7, 9, 12; `DeliverOutcome`, `deliverDocumentRequest`, `requestChannels` (Task 6) → Task 7; `DocumentRequestsResponse`, `OpenRequestView`, `documentRequestsLoadFrom`, `expiresInDays` (Task 7) → Task 8.
- **Not executed:** nothing in this plan was run; the SQL and TypeScript are written against the files read at `3eb5b246` and are marked where a name must be confirmed by a read (the `automation_log` NOT NULL columns, `CreateContactInput`'s fields, PostgREST's embed names, `NewMessage`'s fields, `listPhoneNumbersForAccount`'s row, `recordUsageSafely`'s import). Each such read is a named step, not an assumption left open.
- **Revision of 2026-10-15 (plan review of `9748f88d`):** I1 (the completion test now makes its decisive clean verdict while the other item holds only ready-pending and ready-infected files, plus a separate trashed-file case; probe (e) restated), I2 (`set local lock_timeout = '5s'` first), I3 (five more pinned tests named with their owners; `SITES` takes the email kind only), I4 (`logQuietly`; the post-send status write caught on its own; tests on the throw paths), I5 (Task 6b, the reconcile), I6 (deviation 13), I7 (`business` reaches the customer view; literal en+es tests), I8 (`loadPageSafe` and a bilingual `error.tsx`; three keys in Task 2), I9 (the schedule from each Checking file's server-computed age; the e2e seeds a pending file before the first visit and never reloads), I10 (the secret required, no fallback; Playwright's fixture; Task 0 step 4 and Task 14 step 1b; Assumption A9), I11 (the PDF+EICAR fixture), M1, M2, M6, M7, M11, M13 applied; M3, M4, M5, M8, M9, M10, M12 carried to Task 13 step 3(r). Re-read: not executed, as before.
- **Second revision, 2026-10-15 (re-review of `b5803de1`):** R1 (the at-most-once `sent_at` stamp: 0080's column, Task 3's claim and clear, `deliver.ts` claims in the text's `prepare` and before `sendEmail` and clears on a send that did not go out, the releaser skips a stamped request; Task 6 case 11; deviation 11), R2 (Task 6b moved to Wave F after Task 6), m1 (the reconcile reads from the clean files' side in an 8-day window, batches of 100, expired-in-24h included), m2 (the unit-test secret stub, named in Global Constraints and applied in Tasks 6 and 7), m3 (the e2e clock starts after the first Checking), m4 (A9: no Text on Preview means the unit tests are the proof), m5 (no "Your files are safe"), m6 (the `classes.test.ts` citations re-read: `:11`, `:31-33`, `:59`, `:94-96`, `:104-109`, `:112-121`).
