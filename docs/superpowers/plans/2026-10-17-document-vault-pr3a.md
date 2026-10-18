# The document vault, PR 3a (S-07 + F-005 part 3, migration 0084): the Documents page, expiry To-dos, the Owner's Required documents card, implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An account-wide **Documents** page under CRM (right after Contacts) lists every live file filed on a customer or a household/business, "Expiring soon" by default, with Expired / All and a category filter, a real total and cursor paging; thirty days before a file's expiry a cron pass opens ONE To-do on the record ("Ana García's insurance expires on Nov 16"), linked to the record's Documents card with that file in focus and **Ask the customer** pre-ticked for its category; and a client Owner (or the agency) edits the account's required-documents list from a **Required documents** card at the top of that page, with its own Save, toast and Undo. Closes the 2c note that P7 is not met for client Owners.

**Architecture:** One migration, **0084**: two `tasks` columns (`document_expiry_id`, `document_expiry_on`) with a coherence CHECK, a composite FK to `documents (account_id, id)` ON DELETE CASCADE, a unique partial index `tasks_document_expiry_once`, 0080's `app.keep_task_links()` re-created with the two new columns held for the client role, and three `documents` indexes (page's expiry order, the pass's cross-account window, the page's All order). Two new `@bis/db` modules: `document-expiry.ts` (the pass's candidate read, the existing-key read, the one-To-do insert with 23505 dedupe) and `account-documents.ts` (the page's filtered, cursor-paged read and its head count that throws on `null`). A new cron pass `documentsExpiry` (registered after `documentsScan`, every tick, idempotent) uses pure helpers in `lib/documents/expiry-task.ts` (the account-zone window, the due instant, the To-do's title in the account's language). The page is a server component reading through the REQUEST client only; its rows open the existing viewer. The work queue learns the To-do's link from its `document_expiry_id`; the Documents card learns `?document=` (focus) and `?ask=` (pre-tick). The Owner card reuses 2c's save action and adds a compare-and-set Undo.

**Tech Stack:** Postgres 17 (Supabase) migration; supabase-js 2.110.8; Next.js 16.3.6 App Router (server components, server actions, `error.tsx`/`loading.tsx` boundaries); React 19.2.4; vitest 4 (`renderToStaticMarkup`, no DOM; `vi.mock`); sonner toasts; lucide-react; the `@bis/db` suites on a local PG18 replica (with a local PostgREST for `withTestAccount`) and CI `verify`; Playwright (bis-e2e-qa writes it, the orchestrator runs it).

**Spec:** `docs/superpowers/specs/2026-10-17-document-vault-part3-design.md` (owner-approved 2026-10-17): §1 (scope, "Not in part 3"), §2 E0–E2, §3 whole (3.1–3.4), and the 3a parts of §5, §6, §7. NOT §4 (3b, share links). Owner-accepted implementer choice (2026-10-17): **a To-do's due is the expiry date minus 7 days, at 09:00 in the account's zone.** Templates: `docs/superpowers/plans/2026-10-16-document-vault-pr2c.md` (shipped as #263) and `docs/superpowers/plans/2026-10-15-document-vault-pr2b.md` (#261). Base: `main` at `d806ec5c` (#267) plus the spec commit `ac252552`. **0077–0083 are on bis-ci and production: never re-apply.** Every file:line below was read off this worktree at `ac252552`; anything not read is labelled **Assumption**.

`<WT>` = `C:\Users\danlo\bis-platform\.claude\worktrees\s07-3` (Git Bash: `/c/Users/danlo/bis-platform/.claude/worktrees/s07-3`), branch `feat/s07-vault-3`. `<SCRATCH>` = `C:\Users\danlo\AppData\Local\Temp\claude\C--Users-danlo-bis-platform\efc99fd8-2a23-42ec-987c-f80cb2c56ca1\scratchpad` (Git Bash: `/c/Users/danlo/AppData/Local/Temp/claude/C--Users-danlo-bis-platform/efc99fd8-2a23-42ec-987c-f80cb2c56ca1/scratchpad`); write it out literally in every command. `<KIT6B>` = `/c/Users/danlo/AppData/Local/Temp/claude/C--Users-danlo-bis-platform/16ea02fa-4bbf-472b-babe-a260f83c4097/scratchpad/s06b-kit` (the newest kit, built for 0083; read 2026-10-17: `replica.sh`, `pgrst.sh` present; its `pgrst.sh` copies `postgrest.exe`, `make-jwt.js`, `proxy.mjs` from `/c/Users/danlo/AppData/Local/Temp/claude/C--Users-danlo-bis-platform/db21dcfe-6aee-47cd-8939-ff4f82a45810/scratchpad/s07-t3-impl`, present). `…/acct/` = `apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/`. `…/contacts/` = `…/acct/contacts/`. `…/documents/` = `…/acct/documents/` (new).

## Deviations from the spec, and spec-vs-code mismatches (the source decided; evidence cited; each goes to the owner)

1. **"Once a day, in the same daily window as the sweep": the sweep has no daily window.** `passes/documents-sweep.ts:6` says "EVERY tick (with nothing due it is two indexed reads and no write)"; the cron runs every 15 minutes (`apps/web/vercel.json`: `*/15 * * * *`). The expiry pass therefore runs every tick too, idempotently: one candidate read, one existing-key read, and inserts only for keys with no To-do (0084's unique index is the last word, 23505 = already there). A To-do opens on the first tick of the account-zone day a file enters the 30-day window, and a file whose newest version only turns clean later in the day is picked up on that tick, not tomorrow. Heartbeat key `cron.pass.documentsExpiry` (written by `runPasses`, `harness.ts:46`, for every registered pass; nothing to add).
2. **The FK is ON DELETE CASCADE** (spec §3.2 is silent on delete). `purgeDocumentRow` (`packages/db/src/documents.ts:375-384`, the sweep's 30-day purge), `deletePurgedDocument` and `purgeContactDocuments` DELETE document rows; a NO ACTION FK would make every purge of a file that ever had an expiry To-do fail with 23503. 0080 chose the same for request To-dos (`0080_document_requests.sql:244-246`). A purged file's To-do goes with it.
3. **The grants guard test does not change.** Spec §3.4 says "The grants guard test is updated for the new columns", but `tasks` is allow-listed as table-wide `IUD` for `authenticated` (`packages/db/src/test/schema-grants-guard.test.ts:106`), so adding columns changes no grant the guard reads. The control is 0084's `keep_task_links` (the client role's insert stores NULL, its update keeps the stored values), proven in Task 1. The guard is still RE-RUN in Task 1 to prove it is unchanged.
4. **Indexes.** Spec §3.4's `documents (account_id, expires_on) where deleted_at is null and expires_on is not null` cannot serve the pass's CROSS-account window read on Postgres 17 (no skip scan; the leading column is `account_id`). 0084 therefore makes three: `documents_by_expiry (account_id, expires_on, id) where deleted_at is null and expires_on is not null` (the page's two expiry filters; `id` for the cursor's tiebreak), `documents_expiry_window (expires_on) where deleted_at is null and expires_on is not null and not owners_only` (the pass), and `documents_live_by_created (account_id, created_at desc, id desc) where deleted_at is null` (the All filter). 0077 has no `created_at` index on `documents` (`0077_document_vault.sql:111-114`: by contact, by group, by opportunity, trashed), so the All index is needed.
5. **"The To-do links to the record's Documents card with the document in focus."** A task has no link of its own: the work queue links a task row to its contact (`…/acct/tasks/work-list.tsx:370-374`; `apps/web/src/app/(dashboard)/dashboard/work/agency-work-list.tsx:194`). The link is therefore DERIVED from the task's `document_expiry_id`: the work-queue read embeds the document's `category` and `client_group_id`, and one pure function builds `…/contacts/<contactId>?document=<id>&ask=<category>`, or, for a household/business file, `…/groups/<groupId>?document=<id>&ask=<category>` (a contact's card does not list its group's files: `listRecordDocuments` filters on `contact_id`, `documents.ts:75-77`). "In focus" = the card scrolls that row into view and focuses its open button once its files read is ready; the viewer is NOT opened by itself.
6. **`?ask=<category>` pre-ticks; it does not open the dialog.** Spec §3.2: "Pedir al cliente accepts a pre-selected category … a small change to the 2b dialog's initial state." The card's header "Ask the customer" opens the dialog with `[ask]` ticked (`openAsk(items)`, `documents-card.tsx:707`; the dialog already takes `initialItems`, `:829`). Only the eight requirable categories (2c D8, `REQUIRABLE_DOCUMENT_CATEGORIES`, `document-rules.ts:121`) are carried: an `other` file's To-do link has no `ask` (2b's dialog needs a note for Other).
7. **The candidate read is bounded.** The pass reads at most 1000 window candidates per tick (newest expiry first, so files entering the window and renewals come first), and logs when the read came back full. Above ~1000 files expiring within a month across ALL accounts, a file uploaded with an expiry already inside the window could wait. Not reached at this agency's scale; the log line is the signal. (The alternative, a SQL anti-join function in 0084, was not taken: the spec lists 0084's contents.)
8. **The pager's words.** DESIGN.md "Paged lists" names "Older"/"Newer". On "Expiring soon" (sorted soonest first) "Older" would point at LATER dates. This plan uses **"Next"** / **"Back to the start"** ("Siguiente" / "Volver al principio"), same `?before=` mechanics, exactly one pager; "Back to the start" returns to the head, as the contact list's "Newer" does (`…/contacts/page.tsx:73-77`). Two keys in Task 2; flipping them back is one edit.
9. **The Owner card's Undo is a compare-and-set on the whole list** (restore the previous list only while the stored list is still exactly what this save wrote), not 2c's "the actor's own, within 10 minutes" (a per-row rule: the account column has no author or time). A concurrent edit (the agency on Settings) makes the Undo answer "changed" instead of clobbering it.
10. **A pass run with any failed document throws at the end** (the sweep's pattern, `documents-sweep.ts:72-74`), after every other document in the run was processed, so the heartbeat records the failure and two failing ticks are opsWatch's alert. Spec §3.2's "one document's failure never stops the pass" holds within the run.
11. **The Owner card's words are its own.** 2c's save action answers English display text (`m[...]`, `…/acct/settings/document-requirements-actions.ts:21-30`). The bilingual card ignores `error` and toasts its own usted sentence (`documents.required.failed`) in the reader's language.
12. **A To-do can be due in the past.** A file uploaded with an expiry 5 days out enters the window at once; its due (expiry − 7 days, 09:00) is already past, so the To-do lands under Overdue. The owner-accepted formula, kept; stated so nobody "fixes" it.

## Assumptions (not verified by reading; each has a named check)

- **A1** PostgREST embeds the account through the default FK name `documents_account_id_fkey` (`0077:55`, `account_id uuid not null references public.accounts(id)`; Postgres names it `<table>_<column>_fkey`). Check: Task 3's test reads `account_timezone`.
- **A2** `version:document_versions!documents_current_version_fkey!inner(scan_status)` with `.eq("version.scan_status", "clean")` drops parent rows whose current version is not clean. Check: Task 3's "pending is excluded" case.
- **A3** PostgREST embeds `documents` from `tasks` through the composite `tasks_document_expiry_fkey` (0077 already embeds `document_versions!document_versions_document_fkey`, a composite key, `documents.ts:75`). Check: Task 6's work-queue case.
- **A4** `.eq("required_document_categories", "{id,insurance}")` matches an equal `text[]` (PostgREST passes the array literal to `=`). Check: Task 4's restore case.
- **A5** Playwright resolves the `@/` alias inside app modules the spec imports (the pass module). Check: Task 12 step 3's `playwright test --list` loads every import; if it fails, Task 12 STOPS and reports (the fix is a relative-import shim the orchestrator assigns).
- **A6** `lucide-react` exports `FolderOpen`. Check: `pnpm --filter web typecheck` in Task 8.
- **A7** `Intl.DateTimeFormat("es-US", { month: "short", day: "numeric" })` prints "16 nov" (no period). Evidence, not proof: `apps/web/src/lib/contacts/language.test.ts:72` asserts "3 oct" through the same call. Check: Task 5's Spanish title case.
- (Read, not assumed: `tasks.contact_id` is nullable and cascades on contact delete (`0003_crm_core.sql:109`); `tasks` has no `client_group_id`; `client_group_members.is_primary_contact` is at most one per group (`0075:51-53`); `documentRequestTarget` answers a group's name and its primary contact (`document-requests.ts:196-216`); `accounts.language` is read by `request-task.ts:28-29`; `ACCOUNT_OWNED_TABLES` deletes `tasks` before `documents` (`account-teardown.ts:24-25`), so teardown needs no change.)

## Global Constraints

- **NEVER `git stash`, `git reset`, `git checkout -- <file>`, `git commit --amend`, or any history rewrite** in the shared worktree. Another agent's uncommitted work lives in the same tree. To undo your own edit, edit it back. To see committed text, `git show HEAD:<path>`. Never `rm -rf` anything under `<WT>` (memory "No rm -rf on worktrees"); scratch directories under `<SCRATCH>` are yours. Commit with `git commit -m "…" -- <every path>`, never `-A` or `.`. If `.git/index.lock` exists, wait and retry; never delete it. Never push (the orchestrator pushes). Never touch `main`. Nobody merges or rebases but the orchestrator.
- **Commits** carry the trailer lines `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>` and `Claude-Session: https://claude.ai/code/session_013RThMy9QC8x7FZ94Lxib9p`.
- **0084 is NOT on bis-ci until Task 15 step 2.** Until then: **no `@bis/db` vitest and no live web test may run against bis-ci** (the suites would hit a schema without the new columns and report environment failures as code failures, and a mutation probe could write there). Every `@bis/db` suite runs on YOUR local PG18 replica ("The replica kit" below), or is left to CI `verify` (which builds its own stack from the branch's migrations). Never `pnpm --filter @bis/db exec vitest` with the default env.
- **Ownership (tag on every task; no task edits a file its owner does not own).**
  - **bis-db-schema:** `packages/db/supabase/migrations/0084_document_expiry_tasks.sql` (new), `packages/db/src/test/document-expiry-schema.test.ts` (new), `<SCRATCH>/s07f-kit/*` (Task 1).
  - **bis-crm:** `apps/web/src/lib/messages.ts` + one `describe` in `messages.test.ts` (Task 2 only); `packages/db/src/{document-expiry,document-rules}.ts`, `packages/db/src/index.ts` (Task 3), `packages/db/src/test/document-expiry.test.ts`; `packages/db/src/{account-documents,documents,document-requirements}.ts`, `packages/db/src/index.ts` (Task 4, after Task 3), `packages/db/src/test/account-documents.test.ts`, `…/documents/required-documents-actions.ts` (+ test), one line in `…/acct/settings/document-requirements-actions.ts`, one `ALLOWED` line in `…/acct/in-account-service-reads.test.ts` (Task 4); `packages/db/src/{work-queue,activities,record}.ts`, `packages/db/src/test/work-queue.test.ts`, `apps/web/src/lib/record/author-mark.ts` (+ test), `apps/web/src/lib/documents/card-focus.ts` (+ test), `…/acct/tasks/work-list.tsx`, `apps/web/src/app/(dashboard)/dashboard/work/agency-work-list.tsx` (Task 6); `apps/web/src/lib/i18n/{catalogue,ratchet}-baseline.json` (Task 11, regenerated).
  - **bis-automations:** `apps/web/src/lib/documents/expiry-task.ts` (+ test), `apps/web/src/lib/automations/passes/documents-expiry.ts` (+ test), `apps/web/src/lib/automations/registry.ts`, `apps/web/src/lib/automations/sentinel.test.ts`, `apps/web/src/app/api/cron/reminders/route.test.ts` (Task 5).
  - **bis-frontend:** `…/contacts/documents-card.tsx` (+ `documents-card.test.ts`, one `describe` appended to `documents-card-structure.test.ts`), `…/contacts/[contactId]/page.tsx` (+ `page.test.ts`), `…/acct/groups/[groupId]/page.tsx` (+ `page.test.ts`) (Task 7); `apps/web/src/lib/nav-groups.ts` (+ test), `apps/web/src/components/app-sidebar.tsx`, `apps/web/src/lib/palette/registry.ts` (+ test) (Task 8); `apps/web/src/lib/documents/account-list.ts` (+ test), `…/documents/{page.tsx,page.test.ts,loading.tsx,error.tsx,documents-list.tsx,documents-list.test.ts,category-filter.tsx}`, `…/acct/technician-guards.test.ts` (one case) (Task 9); `…/documents/{required-documents-summary.tsx,required-documents-summary.test.ts,required-documents-handlers.ts,required-documents-handlers.test.ts}`, the summary's mount in `…/documents/page.tsx` (+ one `page.test.ts` case), `apps/web/src/app/(dashboard)/dashboard/styleguide/{documents-page-demo.tsx,documents-page-demo.test.ts,page.tsx}` (Task 10).
  - **bis-e2e-qa:** `apps/web/e2e/documents-page.spec.ts` (new) (Task 12).
  - **Orchestrator:** Task 0, `DESIGN.md` and the part-2 spec's amendment line (Task 13), the ledger, the bis-ci and production applies of 0084, the parity check, the gates, the PR, the merge, the tracker.
- **Shared files, one task at a time.** `apps/web/src/lib/messages.ts`: **Task 2 only** (every key this plan uses is listed there; a later task that finds one missing STOPS and reports; the orchestrator re-opens Task 2). `packages/db/src/index.ts`: Task 3, then Task 4 (sequential). `…/contacts/documents-card.tsx`: **Task 7 only** (it also EXPORTS `ExpiryLine` and `ScanStatus` for Task 9). `…/documents/page.tsx`: Task 9 creates it, Task 10 adds the summary's mount after Task 9 has committed. `apps/web/src/lib/palette/registry.ts`, `nav-groups.ts`: Task 8 only ("add a line, never reorder"). `apps/web/src/lib/i18n/*-baseline.json`: Task 11 only, after every copy-bearing task.
- **Every test must be able to fail; the plan writer named each one's mutation, and the implementer runs it.** Run the probe, see the test fail BY NAME, paste the failing assertion line into the report, revert by editing back. Shapes a reviewer rejects on sight (memory "Vacuous test shapes"): `toBeTruthy`/`toBeDefined` on content; a count-only guard where the content can be asserted; an English-only assertion where a Spanish twin exists (assert BOTH, the Spanish against the literal string, never `t()`'s output, which falls back to English silently); a mock that satisfies itself; an assertion on a value the fixture already held before the code ran; a WANT constant compared with itself; a negative `not.toContain` on raw `renderToStaticMarkup` output for a string with an apostrophe (use `renderedText()` from `apps/web/src/lib/rendered-text.ts` for EVERY copy assertion). A `-t` filter that matches nothing passes silently: check the run count in vitest's summary block.
- **Reads go through the request client.** The page, its count and the Required list read on `dbForRequest()` (`apps/web/src/lib/db.ts`), never `serviceDb()`: 0077's RLS (the record's visibility, 0068's Technician fence, the Owners-only fence) decides every row. No new file under `apps/web/src/lib` contains the token `serviceDb`, not even in a comment (lib functions take the caller's client). The pass uses `ctx.db` (the cron's service client). The one new service-client file, `…/documents/required-documents-actions.ts`, is added to `in-account-service-reads.test.ts`'s `ALLOWED` as `owner-only` (Task 4).
- **Head counts throw on `{ count: null }`** (memory "Head-count null"); never `count ?? 0`. `countAccountDocuments` follows `countContacts` (`packages/db/src/contacts.ts:872-883`).
- **SQL rules.** The migration is ASCII only with no backslash anywhere (memory "MCP SQL escapes"; checked by Task 1's byte count, which has a positive control); `set local lock_timeout = '5s'` first (0080's step 0); a boolean from a nullable value is `coalesce(…, false)` (memory "plpgsql NULL guard": `keep_task_links` already wraps `current_user = 'authenticated'`).
- **DESIGN.md definition of done for every UI task (7, 8, 9, 10):** tokens only (radii `rounded-[var(--radius-ctl)]` / `rounded-[var(--radius-card)]`, pills `rounded-full`; no hex, no literal shadow); both themes via `.dark`; the blur fallback; rule 3 (expiry soon/past and scan states are a dot AND a word: reuse the card's `ExpiryLine`/`ScanStatus`); rule 4 (the whole row opens the viewer, `--surface-3` hover, visible focus ring, NO checkboxes on the list: no bulk actions); rule 5 (loaded, three empty states, error with Retry; the Required card fails on its own); rule 6 (the Owner card's Save runs at once with Undo in the toast); rule 7 (skeletons shaped like the rows; no spinner); rule 8 (the page has NO primary; the Required card has exactly ONE primary, Save); rule 11 (**no hero**, no `data-hero`); controls `min-h-11 md:min-h-8`; nothing animates on scroll; renders at 360 px with the pseudo-locale's +35%.
- **Copy.** Every new string through `t(m, key, locale, params)` with an `.es` twin on the line under it, in the same commit (`apps/web/src/lib/i18n/ratchet.test.ts`). Spanish is **usted**. New `.tsx` code carries no JSX literal copy with a letter in it. No vendor or internal words ("RLS", "cursor", "pass", "cron", "token", "category key"). The page reads the reader's locale (`requestLocale`, with `userLanguage` named, `request-locale-callers.test.ts`); To-do titles read the ACCOUNT's language (staff read them; `request-task.ts:28-30`'s rule). Never reuse `common.actionCrashed` in bilingual copy (its Spanish is tú, 2c M9).
- **Browser code imports the vault's rules from `@bis/db/document-rules`**, never the `@bis/db` barrel. `documents-list.tsx`, `category-filter.tsx`, `required-documents-summary.tsx`, `required-documents-handlers.ts`, `lib/documents/card-focus.ts` are browser-safe (no barrel import, no `node:` import, no `Buffer`).
- **The `vi.mock` factory check.** A task that adds a NEW named import from `@bis/db` to a module adds that name to every mock factory that reaches the module: `grep -rln 'vi.mock("@bis/db"' apps/web/src | xargs grep -ln "<module basename>"`. A component test that renders a module importing a `"use server"` file mocks that file (`documents-card.test.ts:5-13` is the shape).
- **Running tests.** Only the affected tests, by path: `pnpm --filter web exec vitest run "<path>" …`, `pnpm --filter web typecheck`, `pnpm --filter web exec eslint "<touched files>"`. `@bis/db` suites only on your replica, run in `packages/db` as `node node_modules/vitest/vitest.mjs run <files>` after sourcing the kit's env, judged by vitest's summary block (capture the exit code to a file with nothing after the command; the pnpm `ERR_PNPM_RECURSIVE_EXEC_FIRST_FAIL` trailer lies). Never the gates (`pnpm check`, `pnpm --filter web build`, `pnpm --filter web test:e2e`), never Playwright: the orchestrator runs them, one at a time (memory "Agent test scope"). Never pass the folder `…/accounts/` to vitest (it holds a live test).
- **Mutating e2e only on the per-run fixture account** (`readClientFixture()`, `apps/web/e2e/support.ts`), never `Test Client One`. The pass is run in the spec ONLY through `openExpiryTasks(db, now, { accountId })` scoped to the fixture account (an unscoped run would open To-dos on every account on the database, Test Client One included).
- **Nothing sends, nothing calls a real provider.** 3a sends nothing (spec E1: staff press Ask the customer themselves).
- **Never** apply a migration outside your own replica, run SQL that writes to a shared project, mutate Test Client One, create or edit `.env*`, or set a Vercel secret. Those are the orchestrator's, in Task 15.

## The replica kit (every `@bis/db` task and its reviewer)

This lane's ports are **55630–55639**, never `5432`. Assignment (a port set is free again only after its owner stopped its own kit): Task 1 implementer `55630`; Task 1 reviewer `55631`; **set A** (Postgres `55632`, PostgREST `55633`, gateway `55634`) for the Task 3, Task 4 and Task 6 implementers in turn; **set B** (`55635`/`55636`/`55637`) for the Task 3, Task 4 and Task 6 reviewers in turn; Task 14 (final review) Postgres `55631` (Task 1's reviewer is long done), PostgREST `55638`, gateway `55639`. Each agent works in its own `<SCRATCH>/s07f-t<N>-<impl|review>/`.

`<KIT6B>`'s `replica.sh` and `pgrst.sh`, copied and re-pointed by Task 1 to `<SCRATCH>/s07f-kit/`: `WT` becomes `/c/Users/danlo/bis-platform/.claude/worktrees/s07-3`; `pre` is every migration through **0083** (with the storage stub 0077 needs); `post` is `pre` plus the branch's **0084** if it exists yet. The only lines that change in `replica.sh`: the `WT=` line, the `case "$f" in *0083_*)` skip (becomes `*0084_*`), and the `post` block's file name (`0084_document_expiry_tasks.sql`) and messages (`post = pre + 0084`, `0084 FAILED`, `post = pre (no 0084 yet)`). `pgrst.sh` changes ONLY its `SECRET=` string, to `s07f-local-postgrest-jwt-secret-not-used-anywhere-real-0000`. Task 1 writes both with `sed` and shows `diff` output: exactly those lines differ.

Bring up PostgREST for a `withTestAccount` suite: `bash <SCRATCH>/s07f-kit/replica.sh <pg> <dir>` then `bash <SCRATCH>/s07f-kit/pgrst.sh <pg> <pgrst> <gateway> <dir>`, then `source <dir>/env-run.sh` in the same shell that runs vitest. The proxy forwards `/rest/v1/*` to PostgREST and answers `DELETE /storage/v1/object/documents` with `200 []`; anything else storage gets 404, so a db test that unexpectedly reaches storage fails loudly.

Stop your own kit only (never `taskkill /IM postgrest.exe`): `touch "<dir>/stop"`, then in PowerShell `Get-Process postgrest | Where-Object { $_.Path -eq '<dir as a Windows path>\postgrest.exe' } | Stop-Process -Confirm:$false` and `Get-NetTCPConnection -LocalPort <gatewayPort> -State Listen | ForEach-Object { Stop-Process -Id $_.OwningProcess -Confirm:$false }`; then `"/c/Program Files/PostgreSQL/18/bin/pg_ctl" -D "<dir>/pgdata" stop -m fast`. A SQL mutation probe on `post` needs `psql … -d post -c "notify pgrst, 'reload schema'"` afterwards.

**Faithfulness** (once per kit build, read-only on bis-ci with `pnpm --filter @bis/db ci:sql`): the client-write-surface digest on `pre` equals bis-ci's (bis-ci has 0083 and not 0084 until Task 15 step 2). The query:

```sql
select count(*) || '|' || md5(string_agg(x, ',' order by x)) from (
  select r || ' ' || c.relname || ' ' || p as x
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  cross join (values ('anon'), ('authenticated')) v(r)
  cross join (values ('INSERT'), ('UPDATE'), ('DELETE')) w(p)
  where n.nspname = 'public' and c.relkind = 'r' and has_table_privilege(r, c.oid, p)) s;
```

Paste both values; stop if they differ.

## Pinned tests this PR changes (stated outright)

- `apps/web/src/lib/automations/sentinel.test.ts`: `dbMocks` (`:16-50`) gains `listExpiringDocuments: vi.fn(async () => [])`; `beforeEach` (`:200-250` area) sets it to `[]` again beside the sweep's two; a new `expect(results.documentsExpiry).toEqual({ opened: 0, alreadyOpen: 0, failed: 0, unresolvableTimezone: 0, capped: 0 })` after `:269`; the registry-order case (`:285-286`) gains `"documentsExpiry"` right after `"documentsScan"`, and its title names "the documents expiry To-dos after the scan" (Task 5).
- `apps/web/src/app/api/cron/reminders/route.test.ts`: the bare `@bis/db` factory (`:14-60`) gains `listExpiringDocuments: async () => []` (an unlisted export throws in this factory, `:16-21`); a new `const EMPTY_DOCUMENTS_EXPIRY = { opened: 0, alreadyOpen: 0, failed: 0, unresolvableTimezone: 0, capped: 0 };` beside `:323-324`; every exact body that lists `documentsScan: EMPTY_DOCUMENTS_SCAN` gains `documentsExpiry: EMPTY_DOCUMENTS_EXPIRY` right after it: `:412`, `:435`, `:458`, `:474`, `:567`, `:597`, `:640` (seven) (Task 5). Read the count off `grep -c "documentsScan: EMPTY_DOCUMENTS_SCAN"` first; if it is not 7, stop and report.
- `apps/web/src/lib/nav-groups.test.ts`: `:58` CRM list becomes `["nav.contacts", "nav.documents", "nav.opportunities"]`; the Technician case `:142-150` gains `${BASE}/documents` after `${BASE}/contacts`; the snapshot `:154-173` gains `${BASE}/documents` after `${BASE}/contacts` in `owner` (so `staff`, derived, too) and `agency`; its comment says "S-07 3a added Documents after Contacts". (Task 8)
- `apps/web/src/lib/palette/registry.test.ts`: two new cases (Documents keywords; the Owner's Required documents entry) (Task 8).
- `…/acct/technician-guards.test.ts`: one new case: `documents/page.tsx` never calls `requireNotTechnician` (Task 9).
- `apps/web/src/lib/record/author-mark.test.ts`: one new case (an expiry To-do is the automation's) (Task 6). `packages/db/src/activities.ts:50` `TASK_COLS` gains `document_expiry_id`; Task 6 greps every test that pins that select string or a task fixture's exact keys and updates it (report each file).
- `packages/db/src/test/work-queue.test.ts`: every existing row stays exactly equal (`documentFocus` is present ONLY on a task with `document_expiry_id`); one new case (Task 6).
- `…/contacts/[contactId]/page.test.ts:700` and `…/acct/groups/[groupId]/page.test.ts:287, :296`: UNCHANGED (the card's `focus` prop is passed only when the URL carries one); each gains one new case (Task 7).
- `…/contacts/documents-card-structure.test.ts`: every existing pin stays; one `describe` APPENDED (Task 7).
- `apps/web/src/lib/messages.test.ts`: one new `describe` at the end (Task 2).
- `…/acct/in-account-service-reads.test.ts`: `ALLOWED` gains one line beside `:136` (Task 4).
- **Re-run unchanged, because 0084 re-creates `keep_task_links` (Task 1):** `packages/db/src/test/document-requests-schema.test.ts` (0080's task-link case, `:368-397`) and `packages/db/src/test/record-provenance-schema.test.ts` (`:291`, 0074's call and consent links). A lost 0074/0080 line in the re-created function fails one of them.
- **Unchanged, checked:** `schema-grants-guard.test.ts` (deviation 3); `account-teardown.ts`' `ACCOUNT_OWNED_TABLES` (tasks before documents, `:24-25`, and the FK cascades anyway); `apps/web/src/app/api/ops/health/route.ts` (it reads only `cron.tick` and the scanner heartbeat, `:7-21`; it lists no pass); `cron-coupling.test.ts` (the pass is bounded by count, not time: no fourth budget, a `BUDGET` comment in the pass says so).

## Not in this PR

- Share links (3b, migration 0085).
- Any message to a customer about an expiring file (E1); a configurable window (fixed 30 days); closing an old To-do automatically when a file is renewed (spec §3.2 "Re-arm").
- An Owners-only file's To-do (spec §3.2: a title would reveal it to Staff).
- Documents on properties or deals; checkboxes or bulk actions on the Documents page.
- A blueprint carrying the required list (2c D12 stands).

## File Structure

**Created**

| Path | Owner | Responsibility |
|---|---|---|
| `packages/db/supabase/migrations/0084_document_expiry_tasks.sql` | bis-db-schema | the two task columns, their check, FK, unique index, the trigger extension, three documents indexes |
| `packages/db/src/test/document-expiry-schema.test.ts` | bis-db-schema | 0084 on the replica |
| `packages/db/src/document-expiry.ts` (+ `test/document-expiry.test.ts`) | bis-crm | the pass's candidate read, existing keys, the one-To-do insert |
| `packages/db/src/account-documents.ts` (+ `test/account-documents.test.ts`) | bis-crm | the page's filtered, paged read and its count |
| `…/documents/required-documents-actions.ts` (+ test) | bis-crm | the Owner card's compare-and-set Undo |
| `apps/web/src/lib/documents/card-focus.ts` (+ test) | bis-crm | the To-do → card URL contract (`?document=`, `?ask=`), both directions |
| `apps/web/src/lib/documents/expiry-task.ts` (+ test) | bis-automations | the account-zone day, the window, the due instant, the title |
| `apps/web/src/lib/automations/passes/documents-expiry.ts` (+ test) | bis-automations | the pass |
| `apps/web/src/lib/documents/account-list.ts` (+ test) | bis-frontend | the page's URL query, hrefs, pager, filed-on view |
| `…/documents/page.tsx` (+ test), `loading.tsx`, `error.tsx` | bis-frontend | the page and its boundaries |
| `…/documents/documents-list.tsx` (+ test), `category-filter.tsx` | bis-frontend | the rows and the viewer; the category select |
| `…/documents/required-documents-summary.tsx` (+ test), `required-documents-handlers.ts` (+ test) | bis-frontend | the Owner card |
| `apps/web/src/app/(dashboard)/dashboard/styleguide/documents-page-demo.tsx` (+ test) | bis-frontend | `/styleguide` entries |
| `apps/web/e2e/documents-page.spec.ts` | bis-e2e-qa | page filters and paging, the Owner card with Undo, an expiry To-do and its link |

**Modified:** `packages/db/src/{document-rules,documents,document-requirements,work-queue,activities,record,index}.ts`; `packages/db/src/test/work-queue.test.ts`; `apps/web/src/lib/messages.ts` (+ test); `apps/web/src/lib/automations/{registry.ts,sentinel.test.ts}`; `apps/web/src/app/api/cron/reminders/route.test.ts`; `apps/web/src/lib/record/author-mark.ts` (+ test); `…/acct/tasks/work-list.tsx`; `…/dashboard/work/agency-work-list.tsx`; `…/contacts/documents-card.tsx` (+ tests); `…/contacts/[contactId]/page.tsx` (+ test); `…/acct/groups/[groupId]/page.tsx` (+ test); `apps/web/src/lib/nav-groups.ts` (+ test); `apps/web/src/components/app-sidebar.tsx`; `apps/web/src/lib/palette/registry.ts` (+ test); `…/acct/technician-guards.test.ts`; `…/acct/settings/document-requirements-actions.ts`; `…/acct/in-account-service-reads.test.ts`; `…/styleguide/page.tsx`; `apps/web/src/lib/i18n/{catalogue,ratchet}-baseline.json`; `DESIGN.md`; `docs/superpowers/specs/2026-10-15-document-vault-part2-design.md`.

## Task list, owners, order

| # | Task | Owner | Review | Depends on | Files |
|---|---|---|---|---|---|
| 0 | Confirm the base | orchestrator | n/a | — | none |
| 1 | Migration 0084 and its proof on the replica; the kit | bis-db-schema | **opus** | 0 | the migration, `document-expiry-schema.test.ts`, `<SCRATCH>/s07f-kit/*` |
| 2 | Every key (**messages.ts, the only writer**) | bis-crm | sonnet | 0 | `lib/messages.ts`, `lib/messages.test.ts` |
| 3 | `@bis/db`: the expiry module, two rules, the barrel | bis-crm | **opus** | 1 | `document-expiry.ts`, `document-rules.ts`, `index.ts`, its test |
| 4 | `@bis/db`: the page's read and count, the list's restore; the Undo action | bis-crm | **opus** | 1, 2, 3 | `account-documents.ts`, `documents.ts`, `document-requirements.ts`, `index.ts`, tests, the action, two one-line edits |
| 5 | The pure expiry helpers and the `documentsExpiry` pass | bis-automations | **opus** | 2, 3 | `lib/documents/expiry-task*`, `passes/documents-expiry*`, `registry.ts`, `sentinel.test.ts`, `route.test.ts` |
| 6 | The To-do's link: the work queue, the author mark, the URL contract | bis-crm | sonnet | 1, 3 | `work-queue.ts`, `activities.ts`, `record.ts`, `author-mark*`, `card-focus*`, both work lists |
| 7 | The Documents card: focus and the pre-ticked Ask; the two pages pass it | bis-frontend | **opus** | 2, 6 | `documents-card*`, `[contactId]/page*`, `groups/[groupId]/page*` |
| 8 | The nav entry, its icon, ⌘K | bis-frontend | sonnet | 2 | `nav-groups*`, `app-sidebar.tsx`, `palette/registry*` |
| 9 | The Documents page | bis-frontend | **opus** | 2, 4, 7, 8 | `lib/documents/account-list*`, `…/documents/*` (page, boundaries, list, filter), one `technician-guards.test.ts` case |
| 10 | The Required documents card on the page; `/styleguide` | bis-frontend | sonnet | 2, 4, 9 | `…/documents/required-documents-*`, the page's mount, the styleguide demo |
| 11 | Regenerate the i18n baselines | bis-crm | sonnet | 2, 5, 7, 9, 10 | `lib/i18n/*-baseline.json` |
| 12 | The e2e spec | bis-e2e-qa | sonnet | 5, 6, 7, 9, 10, 11 | `e2e/documents-page.spec.ts` |
| 13 | DESIGN.md and the part-2 spec amendment | orchestrator | n/a | 9 | `DESIGN.md`, part-2 spec |
| 14 | Whole-branch final review (checkpoint) | reviewer | **opus** | 1–13 | none |
| 15 | Rollout (orchestrator; LAST) | orchestrator | n/a | 14 | none in the repo |

```
Wave A (two lanes):    T1 (bis-db-schema)                 T2 (bis-crm)
Wave B:                T3 (bis-crm, after T1)             T8 (bis-frontend, after T2)
Wave C (three lanes):  T4 (bis-crm, after T3)             T5 (bis-automations, after T2, T3)     T6 (bis-crm 2nd instance, after T1, T3)
Wave D:                T7 (bis-frontend, after T6)
Wave E:                T9 (bis-frontend, after T4, T7, T8), then T10
Wave F:                T11, then T12; T13 any time after T9
Checkpoint:            T14
Rollout:               T15 (orchestrator, LAST)
```

Disjointness: T4 (`account-documents.ts`, `documents.ts` exports, `document-requirements.ts`, the barrel, the new action) and T5 (`lib/documents/expiry-task*`, the pass, the registry, two pass-pinning tests) and T6 (`work-queue.ts`, `activities.ts`, `record.ts`, `author-mark*`, `card-focus*`, the two work lists) share no file. T6 runs its db test on replica set A only after T4's implementer has stopped its kit, or T6 builds set A after T4 commits (the orchestrator sequences the ports; the code is disjoint). T7 is the only task that edits `documents-card.tsx`. **0084 goes to bis-ci only AFTER Task 14 approves** (as 2a–2c did): a finding that changes 0084 must not need a second migration. Until then the e2e job's migration check is red on every push, expected and named in each CI reading. 0084 is additive (two nullable columns, a check that holds for every existing row, an FK that every existing row satisfies vacuously, indexes, and a trigger function that sets two more columns the build before it never sends), so it may apply to production BEFORE the merge; the pass and the trigger extension need the columns, so **the migration goes before the code deploy** (spec §7).

---

## Task 0: Confirm the base (orchestrator)

- [ ] **Step 1.** In `<WT>`: `git log --oneline -2` shows this plan's commit, then `ac252552 Spec: document vault part 3 …`, and `git log --oneline -3` includes `d806ec5c`. `git fetch origin && git log --oneline origin/main -1`. If `main` moved past `d806ec5c`, read what moved it; if it touched any file in "File Structure", merge `origin/main` into `<WT>` ONCE now (never rebase), before any lane starts.
- [ ] **Step 2.** Confirm, and stop if any line differs:
  - `ls packages/db/supabase/migrations | tail -1` → `0083_inbound_never_log.sql`; `git log --all --oneline -- 'packages/db/supabase/migrations/0084*'` → nothing.
  - `grep -n "documentsSweepPass, documentsScanPass, weeklyClientReportPass" apps/web/src/lib/automations/registry.ts` → `60:`.
  - `grep -c "documentsScan: EMPTY_DOCUMENTS_SCAN" apps/web/src/app/api/cron/reminders/route.test.ts` → `7` (`:412`, `:435`, `:458`, `:474`, `:567`, `:597`, `:640`; Task 5 updates all seven).
  - `grep -n '"authenticated tasks": IUD' packages/db/src/test/schema-grants-guard.test.ts` → `106:` (deviation 3's premise).
  - `grep -n "new.document_request_kind := old.document_request_kind;" packages/db/supabase/migrations/0080_document_requests.sql` → one hit (the function 0084 re-creates).
  - `grep -n '"nav.contacts.es"' apps/web/src/lib/messages.ts` → `40:`; `grep -n '"documents.request.task.storageFullNoName.es"' apps/web/src/lib/messages.ts` → `4121:`; `wc -l < apps/web/src/lib/messages.test.ts` → `771`.
  - `ls "<KIT6B>/replica.sh" "<KIT6B>/pgrst.sh"` and `ls /c/Users/danlo/AppData/Local/Temp/claude/C--Users-danlo-bis-platform/db21dcfe-6aee-47cd-8939-ff4f82a45810/scratchpad/s07-t3-impl/{postgrest.exe,make-jwt.js,proxy.mjs}` → all exist.
  - Read-only, MCP `execute_sql` on production and `pnpm --filter @bis/db ci:sql` on bis-ci: `select max(version) from supabase_migrations.schema_migrations` names the 0083 apply on both.
- [ ] **Step 3.** Put the deviations (1–12) in front of the owner with the PR's first CI reading at the latest; none blocks Tasks 1–12 (each is written into the code as stated). Record the answers in the ledger.

---

## Task 1: Migration 0084 and its proof on the replica; the kit (bis-db-schema)

**Review:** opus. **Runs beside:** Task 2. **Scratch:** `<SCRATCH>/s07f-t1-impl/`, replica port `55630` (reviewer `s07f-t1-review/`, `55631`).

**Files**
- Create: `<SCRATCH>/s07f-kit/replica.sh`, `<SCRATCH>/s07f-kit/pgrst.sh` (outside the repo)
- Create: `packages/db/supabase/migrations/0084_document_expiry_tasks.sql`
- Create: `packages/db/src/test/document-expiry-schema.test.ts`

**Interfaces**
- Consumes (SQL): `public.tasks` (0003:106-116; 0055, 0064, 0073, 0080 columns), `public.documents` (0077:53-81; `documents_account_id_id_key unique (account_id, id)`, `:80`), `app.keep_task_links()` as 0080 left it (`0080:252-271`), its trigger `tasks_keep_links` (0074:59-60).
- Produces (SQL), every name read by a later task:
  - `tasks.document_expiry_id uuid`, `tasks.document_expiry_on date`; `tasks_document_expiry_coherent` CHECK (both null or both set); `tasks_document_expiry_fkey (account_id, document_expiry_id) → documents (account_id, id) on delete cascade`; unique partial index `tasks_document_expiry_once (document_expiry_id, document_expiry_on) where document_expiry_id is not null`.
  - `app.keep_task_links()` re-created: for `current_user = 'authenticated'`, an INSERT stores NULL in `call_id`, `consent_event_id`, `document_request_id`, `document_request_kind`, `document_expiry_id`, `document_expiry_on`; an UPDATE keeps all six stored values.
  - Indexes `documents_by_expiry`, `documents_expiry_window`, `documents_live_by_created` (deviation 4).

- [ ] **Step 1: Build the kit.**

```bash
S=/c/Users/danlo/AppData/Local/Temp/claude/C--Users-danlo-bis-platform/efc99fd8-2a23-42ec-987c-f80cb2c56ca1/scratchpad
K=/c/Users/danlo/AppData/Local/Temp/claude/C--Users-danlo-bis-platform/16ea02fa-4bbf-472b-babe-a260f83c4097/scratchpad/s06b-kit
mkdir -p "$S/s07f-kit"
sed -e 's#/worktrees/s06-1$#/worktrees/s07-3#' -e 's#\*0083_\*#*0084_*#' -e 's#0083_inbound_never_log.sql#0084_document_expiry_tasks.sql#g' \
    -e 's#post = pre + 0083#post = pre + 0084#' -e 's#0083 FAILED#0084 FAILED#' -e 's#(no 0083 yet)#(no 0084 yet)#' \
    "$K/replica.sh" > "$S/s07f-kit/replica.sh"
sed -e 's#s06b-local-postgrest#s07f-local-postgrest#' "$K/pgrst.sh" > "$S/s07f-kit/pgrst.sh"
diff "$K/replica.sh" "$S/s07f-kit/replica.sh"; diff "$K/pgrst.sh" "$S/s07f-kit/pgrst.sh"
```

Paste both diffs: only the lines named in "The replica kit" differ (`WT=`, the skip, the `post` block's file name and three messages; `SECRET=`). Run `bash "$S/s07f-kit/replica.sh" 55630 "$S/s07f-t1-impl"` → `post = pre (no 0084 yet)`. Run the faithfulness query on `pre` (`"/c/Program Files/PostgreSQL/18/bin/psql" -h localhost -p 55630 -U postgres -d pre -Atc "<query>"`) and on bis-ci (`pnpm --filter @bis/db ci:sql`); paste both; stop if they differ.

- [ ] **Step 2: Read before writing.** `sed -n 236,275p packages/db/supabase/migrations/0080_document_requests.sql` (the function, verbatim: 0084 re-creates it with two more lines per branch), `sed -n 40,64p packages/db/supabase/migrations/0074_record_provenance_not_null.sql` (the trigger and its ACL), `sed -n 53,81p packages/db/supabase/migrations/0077_document_vault.sql`, `sed -n 1,60p packages/db/src/test/document-requests-schema.test.ts` and `:360-397` (the seed and the task-link case this test copies), `packages/db/src/test/db.ts` (`withRollback`, `actAs`).

- [ ] **Step 3: Write the failing test** `packages/db/src/test/document-expiry-schema.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import type { Client } from "pg";
import { withRollback, actAs } from "./db";

/**
 * 0084 (S-07 3a, spec 3.2, 3.4; plan deviations 2-4): the expiry To-do's two columns, their
 * coherence, the same-account FK and its cascade, one To-do per document and expiry date, the
 * client-role guard extended to both columns, and the three documents indexes. Its own seed, in
 * document-requests-schema.test.ts's shape.
 */
const RUN = Math.random().toString(36).slice(2, 10);
const ORG = `org_dex_${RUN}`;
const ORG_B = `org_dexb_${RUN}`;
const OWNER = `u_dex_owner_${RUN}`;

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
  const acct = await one(c, "insert into accounts (agency_id, clerk_org_id, name, client_access_enabled) values ($1,$2,'DEX Co',true) returning id", [agency!.id, ORG]);
  const acctB = await one(c, "insert into accounts (agency_id, clerk_org_id, name, client_access_enabled) values ($1,$2,'DEX B',true) returning id", [agency!.id, ORG_B]);
  const owner = await one(c, "insert into users (clerk_user_id, email) values ($1, $1 || '@example.com') returning id", [OWNER]);
  await c.query("insert into memberships (user_id, scope, account_id, role) values ($1,'account',$2,'owner')", [owner, acct]);
  const ana = await one(c, "insert into contacts (account_id, first_name) values ($1,'Ana') returning id", [acct]);
  const doc = await one(c,
    "insert into documents (account_id, contact_id, title, category, expires_on, source, created_by) values ($1,$2,'Seguro','insurance','2026-11-16','upload','user_seed') returning id",
    [acct, ana]);
  return { acct, acctB, ana, doc };
}
const task = (c: Client, acct: string, doc: string | null, on: string | null, contact: string | null = null) =>
  attempt<{ id: string }>(c,
    "insert into tasks (account_id, contact_id, title, document_expiry_id, document_expiry_on) values ($1,$2,'T',$3,$4::date) returning id",
    [acct, contact, doc, on]);

describe("0084: the expiry To-do's link (spec 3.2, 3.4)", () => {
  it("one To-do per document and expiry date; a new date is a new key (mutations: drop tasks_document_expiry_once -> the duplicate succeeds -> FAILS; make it unique on document_expiry_id alone -> the re-arm insert FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      await task(c, s.acct, s.doc, "2026-11-16", s.ana);
      await expect(task(c, s.acct, s.doc, "2026-11-16", s.ana)).rejects.toMatchObject({ code: "23505", constraint: "tasks_document_expiry_once" });
      const rearmed = await task(c, s.acct, s.doc, "2027-11-16", s.ana);
      expect(rearmed.rows).toHaveLength(1);
    }));

  it("both columns or neither (mutation: drop tasks_document_expiry_coherent -> FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      await expect(task(c, s.acct, s.doc, null)).rejects.toMatchObject({ code: "23514", constraint: "tasks_document_expiry_coherent" });
      await expect(task(c, s.acct, null, "2026-11-16")).rejects.toMatchObject({ code: "23514", constraint: "tasks_document_expiry_coherent" });
    }));

  it("another account cannot link its To-do to this account's document (mutation: an FK on document_expiry_id alone -> FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      await expect(task(c, s.acctB, s.doc, "2026-11-16")).rejects.toMatchObject({ code: "23503", constraint: "tasks_document_expiry_fkey" });
    }));

  it("deleting the document deletes its expiry To-do (deviation 2; mutation: on delete no action -> the delete FAILS 23503)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      const t = (await task(c, s.acct, s.doc, "2026-11-16", s.ana)).rows[0]!.id;
      await c.query("delete from documents where id = $1", [s.doc]);
      const { rows: [n] } = await c.query<{ n: string }>("select count(*)::text as n from tasks where id = $1", [t]);
      expect(n!.n).toBe("0");
    }));

  it("a signed-in insert cannot set either column and a signed-in update cannot change them; the rest of the row still updates (mutations: drop either new line from either branch of keep_task_links -> FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      const t1 = (await task(c, s.acct, s.doc, "2026-11-16", s.ana)).rows[0]!.id;
      await actAs(c, { org_id: ORG, sub: OWNER });
      const { rows: [forged] } = await c.query<{ document_expiry_id: string | null; document_expiry_on: string | null }>(
        "insert into tasks (account_id, contact_id, title, document_expiry_id, document_expiry_on) values ($1,$2,'Forged',$3,'2027-01-01') returning document_expiry_id, document_expiry_on::text",
        [s.acct, s.ana, s.doc]);
      expect(forged).toEqual({ document_expiry_id: null, document_expiry_on: null });
      const { rows: [kept] } = await c.query<{ document_expiry_id: string; document_expiry_on: string; title: string }>(
        "update tasks set document_expiry_id = null, document_expiry_on = null, title = 'T2' where id = $1 returning document_expiry_id, document_expiry_on::text, title",
        [t1]);
      expect(kept).toEqual({ document_expiry_id: s.doc, document_expiry_on: "2026-11-16", title: "T2" });
    }));
});

describe("0084: the documents indexes (deviation 4)", () => {
  it.each([
    ["tasks_document_expiry_once", "CREATE UNIQUE INDEX tasks_document_expiry_once ON public.tasks USING btree (document_expiry_id, document_expiry_on) WHERE (document_expiry_id IS NOT NULL)"],
    ["documents_by_expiry", "CREATE INDEX documents_by_expiry ON public.documents USING btree (account_id, expires_on, id) WHERE ((deleted_at IS NULL) AND (expires_on IS NOT NULL))"],
    ["documents_expiry_window", "CREATE INDEX documents_expiry_window ON public.documents USING btree (expires_on) WHERE ((deleted_at IS NULL) AND (expires_on IS NOT NULL) AND (NOT owners_only))"],
    ["documents_live_by_created", "CREATE INDEX documents_live_by_created ON public.documents USING btree (account_id, created_at DESC, id DESC) WHERE (deleted_at IS NULL)"],
  ])("%s is exactly as designed (mutations: drop any predicate clause or column -> FAILS)", (name, def) =>
    withRollback(async (c) => {
      const { rows } = await c.query<{ indexdef: string }>("select indexdef from pg_indexes where schemaname = 'public' and indexname = $1", [name]);
      expect(rows.map((r) => r.indexdef)).toEqual([def]);
    }));
});
```

Postgres' own deparse is the authority for the four `indexdef` strings: if the replica prints one with different whitespace or parentheses but the same columns and predicate, paste the replica's text into the test and say so in the report; a run with a dropped predicate clause must still fail.

- [ ] **Step 4: Run it on `pre` to see it fail.** In `packages/db`: `PGHOST=localhost PGPORT=55630 PGUSER=postgres PGDATABASE=pre node node_modules/vitest/vitest.mjs run src/test/document-expiry-schema.test.ts > "$S/s07f-t1-impl/red.log" 2>&1; echo $? > "$S/s07f-t1-impl/red.exit"` (read `db.ts` first for the variable names it connects with; if it reads `SUPABASE_DB_URL`, set `SUPABASE_DB_URL=postgresql://postgres@localhost:55630/pre` instead). Expected: every case FAILS (`column "document_expiry_id" of relation "tasks" does not exist`, and the index cases answer `[]`). Paste one failing assertion line.

- [ ] **Step 5: Write the migration** `packages/db/supabase/migrations/0084_document_expiry_tasks.sql`:

```sql
-- 0084_document_expiry_tasks.sql - the document vault, part 3a: expiry To-dos and the Documents page
-- (docs/superpowers/specs/2026-10-17-document-vault-part3-design.md sections 3.2 and 3.4;
--  docs/superpowers/plans/2026-10-17-document-vault-pr3a.md)
--
-- Thirty days before a file's expiry, the documentsExpiry cron pass opens ONE To-do on its record.
-- The To-do names the document and the expiry date it was opened for (tasks.document_expiry_id,
-- tasks.document_expiry_on): one per document AND date (tasks_document_expiry_once), so a renewed
-- file with a new date gets its own To-do, and the pass relies on 23505 to dedupe, as the request
-- To-do does (0080). The link is same-account (the composite FK) and goes with the document when the
-- document is purged (on delete cascade: the sweep and the contact purge delete document rows, and
-- NO ACTION would refuse every such purge; plan deviation 2). Only server code sets the two columns:
-- 0080's keep_task_links is re-created with them (create or replace keeps its ACL and the
-- tasks_keep_links trigger), so a signed-in insert stores NULL and a signed-in update keeps them.
-- Three documents indexes serve the Documents page's expiry filters, the pass's cross-account window
-- and the page's All filter (plan deviation 4). No new table, no new grant: tasks keeps its
-- table-wide client grants and its policies.
--
-- APPLY ORDER: CI project (ci-project-setup.yml: push-dry-run, then push), then production (MCP
-- apply_migration, once), then the parity check, then merge. Additive for the build before it, which
-- never sends the two columns. The build after it needs them (the pass inserts them): the migration
-- goes BEFORE the code deploy.
--
-- Rollback (by hand, in this order; revert the app first):
--   re-create 0080's app.keep_task_links() exactly (FIRST: the function names the two columns, and
--     every task insert would fail once they are gone);
--   drop index public.documents_live_by_created;
--   drop index public.documents_expiry_window;
--   drop index public.documents_by_expiry;
--   drop index public.tasks_document_expiry_once;
--   alter table public.tasks drop constraint tasks_document_expiry_coherent,
--     drop constraint tasks_document_expiry_fkey, drop column document_expiry_on, drop column document_expiry_id;
--   Lost: every expiry To-do's link (the To-dos themselves stay, as plain To-dos).
--
-- ASCII only, no backslash anywhere.

-- 0. Fail fast instead of queueing behind a long lock on tasks or documents.
set local lock_timeout = '5s';

-- 1. The expiry To-do's link.
alter table public.tasks
  add column document_expiry_id uuid,
  add column document_expiry_on date;
alter table public.tasks add constraint tasks_document_expiry_fkey
  foreign key (account_id, document_expiry_id) references public.documents (account_id, id)
  on delete cascade;
alter table public.tasks add constraint tasks_document_expiry_coherent
  check ((document_expiry_id is null) = (document_expiry_on is null));
create unique index tasks_document_expiry_once on public.tasks (document_expiry_id, document_expiry_on)
  where document_expiry_id is not null;

-- 2. Only server code sets or changes a To-do's links (0074's guard, extended by 0080, now by 0084).
create or replace function app.keep_task_links() returns trigger
language plpgsql set search_path = '' as $$
begin
  if coalesce(current_user = 'authenticated', false) then
    if tg_op = 'INSERT' then
      new.call_id := null;
      new.consent_event_id := null;
      new.document_request_id := null;
      new.document_request_kind := null;
      new.document_expiry_id := null;
      new.document_expiry_on := null;
    else
      new.call_id := old.call_id;
      new.consent_event_id := old.consent_event_id;
      new.document_request_id := old.document_request_id;
      new.document_request_kind := old.document_request_kind;
      new.document_expiry_id := old.document_expiry_id;
      new.document_expiry_on := old.document_expiry_on;
    end if;
  end if;
  return new;
end $$;

-- 3. The Documents page's expiry filters (expires_on, then id for the cursor's tiebreak).
create index documents_by_expiry on public.documents (account_id, expires_on, id)
  where deleted_at is null and expires_on is not null;

-- 4. The pass's window, across every account (a leading account_id cannot serve it).
create index documents_expiry_window on public.documents (expires_on)
  where deleted_at is null and expires_on is not null and not owners_only;

-- 5. The Documents page's All filter (0077 has no created_at index on documents).
create index documents_live_by_created on public.documents (account_id, created_at desc, id desc)
  where deleted_at is null;
```

Before writing section 2, diff your function body against 0080's (`sed -n 252,271p`): the ONLY difference is the four new assignment lines. Paste `diff` of the two bodies in the report.

- [ ] **Step 6: The byte rule, with a positive control.**

```bash
F=packages/db/supabase/migrations/0084_document_expiry_tasks.sql
node -e "const b=require('fs').readFileSync(process.argv[1]);console.log([...b].filter(x=>x>127||x===92).length)" "$F"
printf 'a\\b\n' > "$S/s07f-t1-impl/ctrl.sql"
node -e "const b=require('fs').readFileSync(process.argv[1]);console.log([...b].filter(x=>x>127||x===92).length)" "$S/s07f-t1-impl/ctrl.sql"
node -e "console.log(require('crypto').createHash('md5').update(require('fs').readFileSync(process.argv[1])).digest('hex'))" "$F"
```

Expected: `0`, then `1` (the control), then the md5 (paste it: Task 15 compares it).

- [ ] **Step 7: Rebuild and run green.** `bash "$S/s07f-kit/replica.sh" 55630 "$S/s07f-t1-impl"` → `post = pre + 0084`. Run on `post`: `document-expiry-schema.test.ts`, `document-requests-schema.test.ts`, `record-provenance-schema.test.ts`, `schema-grants-guard.test.ts`, `document-vault-schema.test.ts`, `document-vault-rls.test.ts`. All PASS; paste each summary line. (The two re-run task-link suites prove the re-created function lost no 0074/0080 line.)
- [ ] **Step 8: Probes** (each on `post`, by `psql`, reverted by re-running `replica.sh` or the inverse DDL; each named test FAILS by name): (a) `drop index tasks_document_expiry_once` → the "one To-do per document" case; (b) `alter table tasks drop constraint tasks_document_expiry_coherent` → the coherence case; (c) replace the FK with `foreign key (document_expiry_id) references documents(id) on delete cascade` → the cross-account case; (d) replace the FK with `on delete no action` → the cascade case; (e) re-create `app.keep_task_links()` without `new.document_expiry_on := null;` → the client-role case; (f) re-create it without the `new.document_request_kind := old.document_request_kind;` line → `document-requests-schema.test.ts`'s task-link case (proves the re-run catches a lost 0080 line); (g) `drop index documents_expiry_window; create index documents_expiry_window on documents (expires_on) where deleted_at is null` → that index case. Paste each failing line.
- [ ] **Step 9: Commit** the migration and the test, message "db: 0084 expiry To-dos (one per document and date, server-set links) and the Documents page's indexes (S-07 3a)".

---

## Task 2: Every key (bis-crm; messages.ts, the only writer)

**Review:** sonnet. **Runs beside:** Task 1.

**Files**
- Modify: `apps/web/src/lib/messages.ts`, `apps/web/src/lib/messages.test.ts` (one `describe` appended at the end)

**Interfaces**
- Produces: every key below, each English line followed by its `.es` twin. Later tasks reference these names exactly.

- [ ] **Step 1: Read** `messages.ts:1-60` (the nav block), `:3836-3960` (the `documents.*` block and its order), `:4110-4125` (the request To-do titles), and `messages.test.ts`' last two `describe`s (the shape to copy, incl. any `INTERNAL_MILESTONE` guard).

- [ ] **Step 2: Write the failing test** (append to `messages.test.ts`):

```ts
describe("S-07 3a: the Documents page, the expiry To-dos and the Owner's Required card (plan Task 2)", () => {
  const KEYS_3A = [
    "nav.documents",
    "documents.page.title", "documents.page.count", "documents.page.countOne",
    "documents.page.show.label", "documents.page.show.expiring", "documents.page.show.expired", "documents.page.show.all",
    "documents.page.category.label", "documents.page.category.any",
    "documents.page.openRecord", "documents.page.noName",
    "documents.page.next", "documents.page.first",
    "documents.page.empty.all", "documents.page.empty.allBody",
    "documents.page.empty.expiring", "documents.page.empty.expiringBody", "documents.page.empty.expired",
    "documents.page.loadFailed",
    "documents.expiryTask.noName",
    "documents.expiryTask.id", "documents.expiryTask.contract", "documents.expiryTask.estimate", "documents.expiryTask.invoice",
    "documents.expiryTask.photo", "documents.expiryTask.permit", "documents.expiryTask.insurance", "documents.expiryTask.warranty",
    "documents.expiryTask.other",
    "documents.required.summary", "documents.required.summaryOff", "documents.required.loadFailed",
    "documents.required.restored", "documents.required.changed", "documents.required.failed", "documents.required.role",
    "documents.required.crashed",
  ] as const;

  it("every key has a Spanish twin (mutation: delete any one .es line -> FAILS naming it)", () => {
    const missing = KEYS_3A.filter((k) => !(`${k}.es` in m) || !(k in m));
    expect(missing).toEqual([]);
  });

  it("the To-do titles read as the spec's example in both languages (mutation: drop {date} or {name} from either -> FAILS)", () => {
    expect(t(m, "documents.expiryTask.insurance", "en", { name: "Ana García", date: "Nov 16" })).toBe("Ana García's insurance expires on Nov 16");
    expect(t(m, "documents.expiryTask.insurance", "es", { name: "Ana García", date: "16 nov" })).toBe("El seguro de Ana García vence el 16 nov");
    expect(t(m, "documents.expiryTask.other", "en", { name: "Bo", date: "Nov 16", title: "Pool permit" })).toBe("Bo's \"Pool permit\" expires on Nov 16");
    expect(t(m, "documents.expiryTask.other", "es", { name: "Bo", date: "16 nov", title: "Pool permit" })).toBe("\"Pool permit\" de Bo vence el 16 nov");
  });

  it("the empty states are the spec's sentences (spec 3.1)", () => {
    expect(`${m["documents.page.empty.all"]} ${m["documents.page.empty.allBody"]}`)
      .toBe("Files you upload to a customer or household show up here. Open a customer and use Documents to add one.");
    expect(`${m["documents.page.empty.expiring"]} ${m["documents.page.empty.expiringBody"]}`)
      .toBe("Nothing expires in the next 30 days. Files with an expiry date show up here a month before.");
    expect(m["documents.page.empty.expired"]).toBe("Nothing has expired.");
  });

  it("Spanish is usted, never tu (mutation: 'Revisa' or 'intenta' in any .es -> FAILS)", () => {
    const es = KEYS_3A.map((k) => m[`${k}.es` as keyof typeof m] as string);
    for (const s of es) expect(s).not.toMatch(/\b(revisa|intenta|vuelve|abre|usa|tu|tus)\b/i);
  });
});
```

(If `t` is not yet imported in `messages.test.ts`, add `import { t } from "./i18n/t";` at the top.)

- [ ] **Step 3: Run it to see it fail:** `pnpm --filter web exec vitest run src/lib/messages.test.ts` → the new cases FAIL (missing keys). Paste one line.

- [ ] **Step 4: Add the keys.** `"nav.documents"` / `.es` directly under `"nav.contacts.es"` (`:40`); the rest at the end of the `documents.*` block, after `"documents.request.task.storageFullNoName.es"` (`:4121`), in this order:

```ts
  "nav.documents": "Documents",
  "nav.documents.es": "Documentos",
```

```ts
  // S-07 3a: the account-wide Documents page (spec 3.1).
  "documents.page.title": "Documents",
  "documents.page.title.es": "Documentos",
  "documents.page.count": "{count} files",
  "documents.page.count.es": "{count} archivos",
  "documents.page.countOne": "{count} file",
  "documents.page.countOne.es": "{count} archivo",
  "documents.page.show.label": "Show",
  "documents.page.show.label.es": "Mostrar",
  "documents.page.show.expiring": "Expiring soon",
  "documents.page.show.expiring.es": "Vencen pronto",
  "documents.page.show.expired": "Expired",
  "documents.page.show.expired.es": "Vencidos",
  "documents.page.show.all": "All",
  "documents.page.show.all.es": "Todos",
  "documents.page.category.label": "Type",
  "documents.page.category.label.es": "Tipo",
  "documents.page.category.any": "Any type",
  "documents.page.category.any.es": "Cualquier tipo",
  "documents.page.openRecord": "Open {name}",
  "documents.page.openRecord.es": "Abrir {name}",
  "documents.page.noName": "No name",
  "documents.page.noName.es": "Sin nombre",
  "documents.page.next": "Next",
  "documents.page.next.es": "Siguiente",
  "documents.page.first": "Back to the start",
  "documents.page.first.es": "Volver al principio",
  "documents.page.empty.all": "Files you upload to a customer or household show up here.",
  "documents.page.empty.all.es": "Los archivos que suba a un cliente o a un hogar aparecen aquí.",
  "documents.page.empty.allBody": "Open a customer and use Documents to add one.",
  "documents.page.empty.allBody.es": "Abra un cliente y use Documentos para agregar uno.",
  "documents.page.empty.expiring": "Nothing expires in the next 30 days.",
  "documents.page.empty.expiring.es": "Nada vence en los próximos 30 días.",
  "documents.page.empty.expiringBody": "Files with an expiry date show up here a month before.",
  "documents.page.empty.expiringBody.es": "Los archivos con fecha de vencimiento aparecen aquí un mes antes.",
  "documents.page.empty.expired": "Nothing has expired.",
  "documents.page.empty.expired.es": "Nada ha vencido.",
  "documents.page.loadFailed": "Couldn't load the documents list. Check your connection, then try again.",
  "documents.page.loadFailed.es": "No se pudo cargar la lista de documentos. Revise su conexión e intente de nuevo.",
  // S-07 3a: the expiry To-do's title, in the ACCOUNT's language (spec 3.2). {name} is the customer or the household.
  "documents.expiryTask.noName": "A customer",
  "documents.expiryTask.noName.es": "un cliente",
  "documents.expiryTask.id": "{name}'s ID expires on {date}",
  "documents.expiryTask.id.es": "La identificación de {name} vence el {date}",
  "documents.expiryTask.contract": "{name}'s contract expires on {date}",
  "documents.expiryTask.contract.es": "El contrato de {name} vence el {date}",
  "documents.expiryTask.estimate": "{name}'s estimate expires on {date}",
  "documents.expiryTask.estimate.es": "El presupuesto de {name} vence el {date}",
  "documents.expiryTask.invoice": "{name}'s invoice expires on {date}",
  "documents.expiryTask.invoice.es": "La factura de {name} vence el {date}",
  "documents.expiryTask.photo": "{name}'s photo expires on {date}",
  "documents.expiryTask.photo.es": "La foto de {name} vence el {date}",
  "documents.expiryTask.permit": "{name}'s permit expires on {date}",
  "documents.expiryTask.permit.es": "El permiso de {name} vence el {date}",
  "documents.expiryTask.insurance": "{name}'s insurance expires on {date}",
  "documents.expiryTask.insurance.es": "El seguro de {name} vence el {date}",
  "documents.expiryTask.warranty": "{name}'s warranty expires on {date}",
  "documents.expiryTask.warranty.es": "La garantía de {name} vence el {date}",
  "documents.expiryTask.other": "{name}'s \"{title}\" expires on {date}",
  "documents.expiryTask.other.es": "\"{title}\" de {name} vence el {date}",
  // S-07 3a: the Owner's Required documents card on the Documents page (spec 3.3).
  "documents.required.summary": "Required for every customer: {list} ({count})",
  "documents.required.summary.es": "Requeridos para cada cliente: {list} ({count})",
  "documents.required.summaryOff": "Nothing is required for every customer yet.",
  "documents.required.summaryOff.es": "Todavía no se requiere nada para cada cliente.",
  "documents.required.loadFailed": "Couldn't load the required list.",
  "documents.required.loadFailed.es": "No se pudo cargar la lista de requeridos.",
  "documents.required.restored": "Put back the list you had.",
  "documents.required.restored.es": "Se restauró la lista que tenía.",
  "documents.required.changed": "Someone changed the list since. Reload the page to see it.",
  "documents.required.changed.es": "Alguien cambió la lista. Vuelva a cargar la página para verla.",
  "documents.required.failed": "Couldn't save the list. Try again.",
  "documents.required.failed.es": "No se pudo guardar la lista. Intente de nuevo.",
  "documents.required.role": "Only an Owner can change this list.",
  "documents.required.role.es": "Solo un dueño puede cambiar esta lista.",
  "documents.required.crashed": "That didn't finish. This page may be out of date: reload it and try again.",
  "documents.required.crashed.es": "Eso no se completó. Puede que esta página esté desactualizada: vuelva a cargarla e intente de nuevo.",
```

The card's title, body, off line and saved toasts REUSE `settings.requiredDocuments.title|body|off|saved|savedOff` (each already has its `.es`, `messages.ts:1136-1145`); `common.save` and `common.undo` have `.es` (`:292-297`); the viewer's words and `documents.retry` already exist.

- [ ] **Step 5: Run** `pnpm --filter web exec vitest run src/lib/messages.test.ts src/lib/i18n/ratchet.test.ts` → PASS; `pnpm --filter web typecheck`.
- [ ] **Step 6: Probes:** (a) delete `"documents.page.next.es"` → the twin case FAILS naming it; (b) change the insurance `.es` to "El seguro de {name} vence" (no date) → the title case FAILS; (c) set an `.es` to "Revisa su conexión" → the usted case FAILS. Paste each.
- [ ] **Step 7: Commit** both files, message "copy: the Documents page, expiry To-do titles and the Owner's Required card, English and Spanish (S-07 3a)".

---

## Task 3: `@bis/db`: the expiry module, two rules, the barrel (bis-crm)

**Review:** opus. **Runs:** after Task 1. **Replica:** set A (`55632`/`55633`/`55634`), `<SCRATCH>/s07f-t3-impl/`; reviewer set B.

**Files**
- Create: `packages/db/src/document-expiry.ts`, `packages/db/src/test/document-expiry.test.ts`
- Modify: `packages/db/src/document-rules.ts` (two exports appended), `packages/db/src/index.ts` (one export block, and two names added to the existing `./document-rules` block)

**Interfaces**
- Consumes: 0084's columns and index (Task 1); `emit`, `ActorType` (`./events`); `DocumentCategory`, `ScanStatus` types; `createDocument`, `reserveDocumentVersion`, `markDocumentVersionReady`, `recordDocumentScan` (`./documents`, in the test); `withTestAccount` (`./test/fixtures`).
- Produces:
  - `document-rules.ts`: `export const DOCUMENT_EXPIRY_WINDOW_DAYS = 30;` and `export function shiftDay(day: string, days: number): string` (calendar arithmetic on a `YYYY-MM-DD`, via `Date.UTC`, answering `YYYY-MM-DD`).
  - `document-expiry.ts`:
    - `export type ExpiringDocument = { id: string; account_id: string; contact_id: string | null; client_group_id: string | null; title: string; category: DocumentCategory; expires_on: string; owners_only: boolean; deleted_at: string | null; version_scan: ScanStatus; account_timezone: string | null; account_language: string | null }`
    - `export async function listExpiringDocuments(db: SupabaseClient, a: { fromDay: string; toDay: string; limit: number; accountId?: string }): Promise<ExpiringDocument[]>` (service client; newest expiry first)
    - `export const expiryTaskKey = (documentId: string, expiresOn: string): string => \`${documentId}|${expiresOn}\``
    - `export async function listDocumentExpiryTaskKeys(db: SupabaseClient, documentIds: readonly string[]): Promise<Set<string>>`
    - `export async function ensureDocumentExpiryTask(db: SupabaseClient, accountId: string, input: { documentId: string; expiresOn: string; contactId: string | null; title: string; dueAt: string }, actorId: string, actorType?: ActorType): Promise<{ id: string; created: boolean }>`
  - Barrel: all five `document-expiry.ts` names; `DOCUMENT_EXPIRY_WINDOW_DAYS`, `shiftDay` in the `./document-rules` block.

- [ ] **Step 1: Read** `packages/db/src/document-requests.ts:1-15, :180-240, :265-320` (the target read, the To-do insert and its 23505 path, the batched key read `listRequestsMissingReceivedTask`), `documents.ts:1-90, :340-385` (the column lists, the embeds by constraint name, the sweep reads), `document-rules.ts:1-50, :115-150`, `index.ts:280-330`, `test/document-requests.test.ts:1-60`, `test/fixtures.ts:130-160`.

- [ ] **Step 2: Write the failing test** `packages/db/src/test/document-expiry.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { withTestAccount } from "./fixtures";
import { createContact } from "../contacts";
import { createDocument, reserveDocumentVersion, markDocumentVersionReady, recordDocumentScan } from "../documents";
import { listExpiringDocuments, listDocumentExpiryTaskKeys, ensureDocumentExpiryTask, expiryTaskKey } from "../document-expiry";
import { shiftDay, DOCUMENT_EXPIRY_WINDOW_DAYS } from "../document-rules";

/** The pass's reads and its one write (spec 3.2), on the service client, behind PostgREST on the replica. */
const ACTOR = "user_dex_test";
type FileOpts = { expiresOn: string | null; ownersOnly?: boolean; verdict?: "clean" | "pending"; trashed?: boolean; category?: "insurance" | "other" };

async function file(db: SupabaseClient, accountId: string, contactId: string, o: FileOpts): Promise<string> {
  const id = await createDocument(db, {
    accountId, record: { kind: "contact", id: contactId }, title: "Seguro", category: o.category ?? "insurance",
    expiresOn: o.expiresOn, ownersOnly: o.ownersOnly ?? false, source: "upload", createdBy: ACTOR,
  });
  const r = await reserveDocumentVersion(db, { accountId, documentId: id, bytes: 10, contentType: "application/pdf", originalName: "a.pdf", uploadedBy: ACTOR });
  if (r.status !== "ok") throw new Error(r.status);
  expect(await markDocumentVersionReady(db, { accountId, documentId: id, versionId: r.versionId, bytes: 10, sha256: "a".repeat(64), actorId: ACTOR })).toBe(true);
  if ((o.verdict ?? "clean") === "clean") await recordDocumentScan(db, { accountId, versionId: r.versionId, verdict: "clean" });
  if (o.trashed) {
    const { error } = await db.from("documents").update({ deleted_at: new Date().toISOString(), deleted_by: ACTOR }).eq("id", id);
    if (error) throw new Error(error.message);
  }
  return id;
}
const FROM = "2030-03-01";
const TO = shiftDay(FROM, DOCUMENT_EXPIRY_WINDOW_DAYS);

describe("document-rules: shiftDay", () => {
  it("is calendar arithmetic across a month and a leap day (mutation: add 86_400_000 ms per day in local time -> FAILS on a DST-zone runner; drop the padding -> FAILS)", () => {
    expect(shiftDay("2028-02-28", 1)).toBe("2028-02-29");
    expect(shiftDay("2026-10-17", 30)).toBe("2026-11-16");
    expect(shiftDay("2026-11-16", -7)).toBe("2026-11-09");
    expect(shiftDay("2027-01-01", -1)).toBe("2026-12-31");
  });
});

describe("listExpiringDocuments (spec 3.2: who qualifies)", () => {
  it("answers a live, not Owners-only, clean file in the range, with its account's zone and language; never one trashed, Owners only, still being checked or outside the range (mutations: drop .is('deleted_at', null), .eq('owners_only', false), the !inner scan filter, or either bound -> FAILS)", () =>
    withTestAccount(async (db, accountId) => {
      const ana = (await createContact(db, accountId, { firstName: "Ana" }, ACTOR)).id;
      const ok = await file(db, accountId, ana, { expiresOn: shiftDay(FROM, 10) });
      const edgeLow = await file(db, accountId, ana, { expiresOn: FROM });
      const edgeHigh = await file(db, accountId, ana, { expiresOn: TO });
      await file(db, accountId, ana, { expiresOn: shiftDay(FROM, -1) });
      await file(db, accountId, ana, { expiresOn: shiftDay(TO, 1) });
      await file(db, accountId, ana, { expiresOn: shiftDay(FROM, 5), ownersOnly: true });
      await file(db, accountId, ana, { expiresOn: shiftDay(FROM, 5), trashed: true });
      await file(db, accountId, ana, { expiresOn: shiftDay(FROM, 5), verdict: "pending" });
      await file(db, accountId, ana, { expiresOn: null });
      const rows = await listExpiringDocuments(db, { fromDay: FROM, toDay: TO, limit: 50, accountId });
      expect(rows.map((r) => r.id).sort()).toEqual([ok, edgeLow, edgeHigh].sort());
      const row = rows.find((r) => r.id === ok)!;
      expect(row).toMatchObject({ account_id: accountId, contact_id: ana, client_group_id: null, category: "insurance", expires_on: shiftDay(FROM, 10), owners_only: false, deleted_at: null, version_scan: "clean", account_timezone: "America/Chicago" });
      expect(rows.map((r) => r.expires_on)).toEqual([...rows.map((r) => r.expires_on)].sort().reverse());
    }));

  it("is scoped to one account when asked (mutation: ignore accountId -> FAILS)", () =>
    withTestAccount(async (db, accountId) => {
      await withTestAccount(async (dbB, accountB) => {
        const bea = (await createContact(dbB, accountB, { firstName: "Bea" }, ACTOR)).id;
        const theirs = await file(dbB, accountB, bea, { expiresOn: shiftDay(FROM, 3) });
        const rows = await listExpiringDocuments(db, { fromDay: FROM, toDay: TO, limit: 50, accountId });
        expect(rows.map((r) => r.id)).not.toContain(theirs);
        const all = await listExpiringDocuments(db, { fromDay: FROM, toDay: TO, limit: 1000 });
        expect(all.map((r) => r.id)).toContain(theirs);
      });
    }));
});

describe("ensureDocumentExpiryTask and listDocumentExpiryTaskKeys (spec 3.2: exactly one per document and date)", () => {
  it("opens one To-do with both links and one task.created event; a second call finds it; a new date opens a second (mutations: no 23505 path -> the second call THROWS; emit on the found path -> two events -> FAILS)", () =>
    withTestAccount(async (db, accountId) => {
      const ana = (await createContact(db, accountId, { firstName: "Ana" }, ACTOR)).id;
      const doc = await file(db, accountId, ana, { expiresOn: shiftDay(FROM, 10) });
      const input = { documentId: doc, expiresOn: shiftDay(FROM, 10), contactId: ana, title: "Ana's insurance expires on Mar 11", dueAt: "2030-03-04T15:00:00.000Z" };
      const a = await ensureDocumentExpiryTask(db, accountId, input, "documents-expiry", "system");
      const b = await ensureDocumentExpiryTask(db, accountId, input, "documents-expiry", "system");
      expect(a.created).toBe(true);
      expect(b).toEqual({ id: a.id, created: false });
      const { data: t } = await db.from("tasks").select("contact_id, title, due_at, document_expiry_id, document_expiry_on").eq("id", a.id).single();
      expect(t).toMatchObject({ contact_id: ana, title: input.title, document_expiry_id: doc, document_expiry_on: input.expiresOn });
      expect(Date.parse((t as { due_at: string }).due_at)).toBe(Date.parse(input.dueAt));
      const { data: ev } = await db.from("events").select("actor_type, actor_id, payload").eq("account_id", accountId).eq("type", "task.created");
      expect(ev).toEqual([{ actor_type: "system", actor_id: "documents-expiry", payload: { taskId: a.id, contactId: ana, documentId: doc } }]);
      const c = await ensureDocumentExpiryTask(db, accountId, { ...input, expiresOn: shiftDay(FROM, 20) }, "documents-expiry", "system");
      expect(c.created).toBe(true);
      expect(c.id).not.toBe(a.id);
      const keys = await listDocumentExpiryTaskKeys(db, [doc]);
      expect([...keys].sort()).toEqual([expiryTaskKey(doc, shiftDay(FROM, 10)), expiryTaskKey(doc, shiftDay(FROM, 20))].sort());
      expect(await listDocumentExpiryTaskKeys(db, [])).toEqual(new Set());
    }));
});
```

- [ ] **Step 3: Run it to see it fail** on set A (`replica.sh 55632 …`, `pgrst.sh 55632 55633 55634 …`, `source <dir>/env-run.sh`, then in `packages/db` `node node_modules/vitest/vitest.mjs run src/test/document-expiry.test.ts`). Expected: FAIL on the missing module and exports. Paste one line.

- [ ] **Step 4: Implement.** Append to `document-rules.ts`:

```ts
/** S-07 3a (spec 3.2): a file opens its expiry To-do this many days before its expiry date. */
export const DOCUMENT_EXPIRY_WINDOW_DAYS = 30;

/** Calendar arithmetic on a YYYY-MM-DD day (UTC midnights, so no zone or DST can move it). */
export function shiftDay(day: string, days: number): string {
  const at = Date.UTC(Number(day.slice(0, 4)), Number(day.slice(5, 7)) - 1, Number(day.slice(8, 10)) + days);
  return new Date(at).toISOString().slice(0, 10);
}
```

Create `packages/db/src/document-expiry.ts`:

```ts
import type { SupabaseClient } from "@supabase/supabase-js";
import { emit, type ActorType } from "./events";
import type { DocumentCategory } from "./document-rules";
import type { ScanStatus } from "./documents";

/**
 * The expiry To-dos (0084; spec 3.2). Service client only: the documentsExpiry cron pass reads every
 * account's candidates and writes the To-dos; nothing here runs on a request client. A candidate is a
 * live document that is NOT Owners only (a To-do title would reveal it to Staff), filed on a contact or
 * a group, with an expiry date in [fromDay, toDay] and a CLEAN current version. The pass narrows the
 * coarse UTC range to each account's own day. THROWS on a read or write error.
 */
export type ExpiringDocument = {
  id: string; account_id: string; contact_id: string | null; client_group_id: string | null;
  title: string; category: DocumentCategory; expires_on: string; owners_only: boolean; deleted_at: string | null;
  version_scan: ScanStatus; account_timezone: string | null; account_language: string | null;
};

type Raw = Omit<ExpiringDocument, "version_scan" | "account_timezone" | "account_language"> & {
  version: { scan_status: ScanStatus } | null;
  account: { timezone: string | null; language: string | null } | null;
};

export async function listExpiringDocuments(
  db: SupabaseClient, a: { fromDay: string; toDay: string; limit: number; accountId?: string },
): Promise<ExpiringDocument[]> {
  // One chain (TS2589 otherwise, documents.ts:70-73): the optional account scope is a .match on an empty
  // object when absent. Embeds by constraint name (plan Assumptions A1, A2).
  const { data, error } = await db.from("documents")
    .select("id, account_id, contact_id, client_group_id, title, category, expires_on, owners_only, deleted_at, "
      + "version:document_versions!documents_current_version_fkey!inner(scan_status), account:accounts!documents_account_id_fkey(timezone, language)")
    .match(a.accountId ? { account_id: a.accountId } : {})
    .is("deleted_at", null).eq("owners_only", false)
    .gte("expires_on", a.fromDay).lte("expires_on", a.toDay)
    .is("place_id", null).is("opportunity_id", null)
    .eq("version.scan_status", "clean")
    .order("expires_on", { ascending: false }).order("id", { ascending: false })
    .limit(a.limit);
  if (error) throw new Error(`listExpiringDocuments failed: ${error.message}`);
  return ((data ?? []) as unknown as Raw[]).flatMap(({ version, account, ...d }) => (version ? [{
    ...d, version_scan: version.scan_status, account_timezone: account?.timezone ?? null, account_language: account?.language ?? null,
  }] : []));
}

export const expiryTaskKey = (documentId: string, expiresOn: string): string => `${documentId}|${expiresOn}`;

/** Every (document, date) that already has its To-do, for these documents. Batches of 100 ids (a URL's length). */
export async function listDocumentExpiryTaskKeys(db: SupabaseClient, documentIds: readonly string[]): Promise<Set<string>> {
  const keys = new Set<string>();
  for (let i = 0; i < documentIds.length; i += 100) {
    const { data, error } = await db.from("tasks").select("document_expiry_id, document_expiry_on")
      .in("document_expiry_id", [...documentIds.slice(i, i + 100)]);
    if (error) throw new Error(`listDocumentExpiryTaskKeys failed: ${error.message}`);
    for (const t of (data ?? []) as { document_expiry_id: string; document_expiry_on: string }[]) {
      keys.add(expiryTaskKey(t.document_expiry_id, t.document_expiry_on));
    }
  }
  return keys;
}

/** Service client. The ONE To-do per document and expiry date (0084's tasks_document_expiry_once); emits task.created only when it made the row. */
export async function ensureDocumentExpiryTask(
  db: SupabaseClient, accountId: string,
  input: { documentId: string; expiresOn: string; contactId: string | null; title: string; dueAt: string },
  actorId: string, actorType: ActorType = "system",
): Promise<{ id: string; created: boolean }> {
  const { data, error } = await db.from("tasks").insert({
    account_id: accountId, contact_id: input.contactId, title: input.title, due_at: input.dueAt,
    document_expiry_id: input.documentId, document_expiry_on: input.expiresOn,
  }).select("id").single();
  if (!error && data) {
    const id = (data as { id: string }).id;
    await emit(db, accountId, "task.created", actorId, { taskId: id, contactId: input.contactId, documentId: input.documentId }, actorType);
    return { id, created: true };
  }
  if (error?.code !== "23505") throw new Error(`ensureDocumentExpiryTask failed: ${error?.message ?? "no row"}`);
  const { data: found, error: readErr } = await db.from("tasks").select("id")
    .eq("account_id", accountId).eq("document_expiry_id", input.documentId).eq("document_expiry_on", input.expiresOn).maybeSingle();
  if (readErr || !found) throw new Error(`ensureDocumentExpiryTask: already there but unreadable: ${readErr?.message ?? "no row"}`);
  return { id: (found as { id: string }).id, created: false };
}
```

`index.ts`: after the `./document-requirements` block (`:325-329`), add

```ts
// S-07 3a: the expiry To-dos. See ./document-expiry.ts.
export {
  listExpiringDocuments, listDocumentExpiryTaskKeys, ensureDocumentExpiryTask, expiryTaskKey, type ExpiringDocument,
} from "./document-expiry";
```

and add `DOCUMENT_EXPIRY_WINDOW_DAYS, shiftDay,` to the `./document-rules` export block's S-07 2c line (`:318-319`).

- [ ] **Step 5: Run** `document-expiry.test.ts` on set A → PASS (paste the summary), then `pnpm --filter @bis/db typecheck` (read `packages/db/package.json`'s script name first; if it has none, `pnpm --filter web typecheck`).
- [ ] **Step 6: Probes:** (a) drop `.eq("owners_only", false)` → the "who qualifies" case FAILS; (b) drop `.eq("version.scan_status", "clean")` → the pending file comes back with `version_scan: "pending"` → FAILS (removing only `!inner` is NOT a probe: the embed then answers `version: null` for the pending file and the `flatMap` drops it, so the test cannot see it; say so in the report if a reviewer asks); (c) drop `.match(...)` → the scope case FAILS; (d) make the 23505 branch `throw` → the ensure case FAILS; (e) emit before the `if (!error …)` check (always) → the events assertion FAILS. Paste each.
- [ ] **Step 7: Stop your kit. Commit** the four paths, message "db: the expiry To-do's reads and its one insert, deduped by 0084 (S-07 3a)".

---

## Task 4: `@bis/db`: the page's read and count, the list's restore; the Owner card's Undo action (bis-crm)

**Review:** opus. **Runs:** after Task 3 (the barrel) and Task 2 (the action answers key names). **Replica:** set A after Task 3's implementer stopped it; reviewer set B.

**Files**
- Create: `packages/db/src/account-documents.ts`, `packages/db/src/test/account-documents.test.ts`
- Modify: `packages/db/src/documents.ts` (export four existing private names; no behaviour change), `packages/db/src/document-requirements.ts` (one function appended), `packages/db/src/index.ts` (one export block; one name added to the `./document-requirements` block), `packages/db/src/test/document-requirements.test.ts` (one case appended)
- Create: `…/documents/required-documents-actions.ts`, `…/documents/required-documents-actions.test.ts`
- Modify: `…/acct/settings/document-requirements-actions.ts` (one `revalidatePath` line) and its test if it pins the revalidated paths; `…/acct/in-account-service-reads.test.ts` (one `ALLOWED` line beside `:136`)

**Interfaces**
- Consumes: `DOCUMENT_EXPIRY_WINDOW_DAYS`, `shiftDay` (Task 3); 0084's indexes (Task 1); `cleanRequiredCategories`, `RequirableCategory` (`document-rules.ts:121-142`); `requireAccountAccess` (`apps/web/src/lib/auth.ts:38`, `{ userId, isAgency, role, canManage }`).
- Produces:
  - `documents.ts` now EXPORTS (unchanged bodies): `DOC_COLS`, `VERSION_COLS`, `asVersion`, `readyVersionsOf` (consumed by `account-documents.ts` only; NOT added to the barrel).
  - `account-documents.ts`:
    - `export const ACCOUNT_DOCUMENTS_SHOWS = ["expiring", "expired", "all"] as const;` `export type AccountDocumentsShow = (typeof ACCOUNT_DOCUMENTS_SHOWS)[number];`
    - `export type AccountDocumentsFilter = { show: AccountDocumentsShow; category: DocumentCategory | null; today: string };`
    - `export type AccountDocumentsCursor = { v: string; id: string };`
    - `export type AccountDocument = ListedDocument & { contact: { id: string; first_name: string | null; last_name: string | null } | null; group: { id: string; name: string; kind: "household" | "business" } | null };`
    - `export async function listAccountDocuments(db: SupabaseClient, accountId: string, f: AccountDocumentsFilter, opts: { before?: AccountDocumentsCursor; limit: number }): Promise<AccountDocument[]>` (throws `TypeError` on a cursor that does not fit `f.show`)
    - `export async function countAccountDocuments(db: SupabaseClient, accountId: string, f: AccountDocumentsFilter): Promise<number>` (throws on an error AND on `count === null`)
  - `document-requirements.ts`: `export async function restoreRequiredDocumentCategories(db: SupabaseClient, accountId: string, expected: unknown, previous: unknown): Promise<boolean>` (true = restored; false = the stored list is no longer `expected`).
  - Barrel: the six `account-documents.ts` names; `restoreRequiredDocumentCategories`.
  - `…/documents/required-documents-actions.ts` (`"use server"`): `export type RequiredUndoAnswer = { ok: true } | { ok: false; error: "documents.required.role" | "documents.required.changed" | "documents.required.failed" };` and `export async function undoRequiredDocumentsAction(accountId: string, expected: string[], previous: string[]): Promise<RequiredUndoAnswer>`.

- [ ] **Step 1: Read** `packages/db/src/documents.ts:36-90` (the column lists, `asVersion`, `readyVersionsOf`, `listRecordDocuments`' embeds and its TS2589 note), `contacts.ts:640-690, :760-806, :872-883` (the cursor's `.or()` and its value quoting; `countContacts`' null rule), `document-requirements.ts:1-62`, `test/document-requirements.test.ts:1-40`, `…/acct/settings/document-requirements-actions.ts` whole and its test, `…/acct/in-account-service-reads.test.ts:100-140`.

- [ ] **Step 2: Write the failing tests.** `packages/db/src/test/account-documents.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { withTestAccount } from "./fixtures";
import { createContact } from "../contacts";
import { createGroupWithMember } from "../client-groups";
import { createDocument, reserveDocumentVersion, markDocumentVersionReady, recordDocumentScan } from "../documents";
import { listAccountDocuments, countAccountDocuments, type AccountDocumentsFilter, type AccountDocumentsShow } from "../account-documents";
import { shiftDay } from "../document-rules";

/** The Documents page's read (spec 3.1) on the service client (RLS is 0077's, unchanged; its suites cover it), behind PostgREST. */
const ACTOR = "user_adl_test";
const TODAY = "2030-03-01";
type Opts = { expiresOn: string | null; category?: "insurance" | "photo"; trashed?: boolean; ready?: boolean; group?: string };
async function file(db: SupabaseClient, accountId: string, contactId: string, o: Opts): Promise<string> {
  const id = await createDocument(db, {
    accountId, record: o.group ? { kind: "group", id: o.group } : { kind: "contact", id: contactId }, title: "F",
    category: o.category ?? "insurance", expiresOn: o.expiresOn, ownersOnly: false, source: "upload", createdBy: ACTOR,
  });
  const r = await reserveDocumentVersion(db, { accountId, documentId: id, bytes: 10, contentType: "application/pdf", originalName: "a.pdf", uploadedBy: ACTOR });
  if (r.status !== "ok") throw new Error(r.status);
  if (o.ready === false) return id;
  expect(await markDocumentVersionReady(db, { accountId, documentId: id, versionId: r.versionId, bytes: 10, sha256: "a".repeat(64), actorId: ACTOR })).toBe(true);
  await recordDocumentScan(db, { accountId, versionId: r.versionId, verdict: "clean" });
  if (o.trashed) {
    const { error } = await db.from("documents").update({ deleted_at: new Date().toISOString(), deleted_by: ACTOR }).eq("id", id);
    if (error) throw new Error(error.message);
  }
  return id;
}
const F = (show: AccountDocumentsShow, category: AccountDocumentsFilter["category"] = null): AccountDocumentsFilter => ({ show, category, today: TODAY });
const ids = (rows: { id: string }[]) => rows.map((r) => r.id);

describe("listAccountDocuments / countAccountDocuments: the filters' bounds in the account's day (spec 3.1)", () => {
  it("Expiring soon is today..today+30, Expired is before today, All is every live listed file; the count matches each (mutations: lte -> lt, gte -> gt, Expired lte today, drop deleted_at or current_version_id -> FAILS)", () =>
    withTestAccount(async (db, accountId) => {
      const ana = (await createContact(db, accountId, { firstName: "Ana" }, ACTOR)).id;
      const d0 = await file(db, accountId, ana, { expiresOn: TODAY });
      const d30 = await file(db, accountId, ana, { expiresOn: shiftDay(TODAY, 30) });
      const d31 = await file(db, accountId, ana, { expiresOn: shiftDay(TODAY, 31) });
      const dPast = await file(db, accountId, ana, { expiresOn: shiftDay(TODAY, -1) });
      const dNone = await file(db, accountId, ana, { expiresOn: null });
      await file(db, accountId, ana, { expiresOn: shiftDay(TODAY, 5), trashed: true });
      await file(db, accountId, ana, { expiresOn: shiftDay(TODAY, 5), ready: false });
      const want: Record<AccountDocumentsShow, string[]> = { expiring: [d0, d30], expired: [dPast], all: [d0, d30, d31, dPast, dNone] };
      for (const show of ["expiring", "expired", "all"] as const) {
        const rows = await listAccountDocuments(db, accountId, F(show), { limit: 50 });
        expect(ids(rows).sort(), show).toEqual([...want[show]].sort());
        expect(await countAccountDocuments(db, accountId, F(show)), show).toBe(want[show].length);
      }
    }));

  it("the category filter narrows rows and count alike (mutation: drop the category eq -> FAILS)", () =>
    withTestAccount(async (db, accountId) => {
      const ana = (await createContact(db, accountId, { firstName: "Ana" }, ACTOR)).id;
      const ins = await file(db, accountId, ana, { expiresOn: null, category: "insurance" });
      await file(db, accountId, ana, { expiresOn: null, category: "photo" });
      expect(ids(await listAccountDocuments(db, accountId, F("all", "insurance"), { limit: 50 }))).toEqual([ins]);
      expect(await countAccountDocuments(db, accountId, F("all", "insurance"))).toBe(1);
    }));

  it("a household's file carries the group, a customer's the contact (the filed-on link)", () =>
    withTestAccount(async (db, accountId) => {
      const ana = (await createContact(db, accountId, { firstName: "Ana", lastName: "García" }, ACTOR)).id;
      const g = await createGroupWithMember(db, accountId, ana, "household", "Casa García", null, ACTOR);
      if (g.status !== "ok") throw new Error(g.status);
      const onGroup = await file(db, accountId, ana, { expiresOn: null, group: g.groupId });
      const onAna = await file(db, accountId, ana, { expiresOn: null });
      const rows = await listAccountDocuments(db, accountId, F("all"), { limit: 50 });
      expect(rows.find((r) => r.id === onGroup)).toMatchObject({ contact: null, group: { id: g.groupId, name: "Casa García", kind: "household" } });
      expect(rows.find((r) => r.id === onAna)).toMatchObject({ group: null, contact: { id: ana, first_name: "Ana", last_name: "García" } });
    }));
});

describe("listAccountDocuments: the order and the cursor round-trip (spec 3.1 Sort, Paging)", () => {
  it.each([
    ["expiring", "expires_on ascending, then id"],
    ["expired", "expires_on descending, then id"],
    ["all", "created_at descending, then id"],
  ] as const)("%s pages through every row exactly once in its order (%s) (mutations: the cursor's gt/lt as gte/lte -> a row twice; the id tiebreak the wrong way -> FAILS)", (show) =>
    withTestAccount(async (db, accountId) => {
      const ana = (await createContact(db, accountId, { firstName: "Ana" }, ACTOR)).id;
      const days = show === "expired" ? [-1, -1, -3, -2, -2] : [3, 3, 1, 2, 2];
      for (const d of days) await file(db, accountId, ana, { expiresOn: shiftDay(TODAY, d) });
      const whole = await listAccountDocuments(db, accountId, F(show), { limit: 50 });
      expect(whole).toHaveLength(5);
      const paged: string[] = [];
      let before: { v: string; id: string } | undefined;
      for (let page = 0; page < 5; page++) {
        const rows = await listAccountDocuments(db, accountId, F(show), { limit: 2, before });
        paged.push(...ids(rows));
        if (rows.length < 2) break;
        const last = rows[rows.length - 1]!;
        before = { v: show === "all" ? last.created_at : last.expires_on!, id: last.id };
      }
      expect(paged).toEqual(ids(whole));
      const keys = whole.map((r) => (show === "all" ? r.created_at : r.expires_on!));
      const sorted = [...keys].sort();
      expect(keys).toEqual(show === "expiring" ? sorted : sorted.reverse());
    }));

  it("a cursor that does not fit the list is refused, never sent to the database (mutation: skip the check -> FAILS)", () =>
    withTestAccount(async (db, accountId) => {
      await expect(listAccountDocuments(db, accountId, F("expiring"), { limit: 2, before: { v: "2030-03-01T00:00:00Z", id: crypto.randomUUID() } })).rejects.toThrow(TypeError);
      await expect(listAccountDocuments(db, accountId, F("all"), { limit: 2, before: { v: "2030-03-01", id: "x" } })).rejects.toThrow(TypeError);
    }));
});

describe("countAccountDocuments: a null count is a failure, never zero (memory head-count null)", () => {
  it("throws on {count: null, error: null} (mutation: count ?? 0 -> FAILS)", async () => {
    const b: Record<string, unknown> = {};
    for (const k of ["select", "eq", "is", "not", "gte", "lte", "lt", "or", "order", "limit", "match"]) b[k] = () => b;
    b.then = (ok: (v: unknown) => unknown, bad?: (e: unknown) => unknown) => Promise.resolve({ data: null, count: null, error: null }).then(ok, bad);
    const fake = { from: () => b } as unknown as SupabaseClient;
    await expect(countAccountDocuments(fake, "acct", F("all"))).rejects.toThrow("no count");
  });
});
```

In `packages/db/src/test/document-requirements.test.ts`, append (importing `restoreRequiredDocumentCategories`, `setRequiredDocumentCategories`, `getRequiredDocumentCategories` from `../document-requirements` if the file does not already):

```ts
describe("restoreRequiredDocumentCategories (S-07 3a: the Owner card's Undo; plan deviation 9)", () => {
  it("puts the previous list back only while the stored list is exactly the expected one (mutation: drop the list eq -> the second call answers true -> FAILS)", () =>
    withTestAccount(async (db, accountId) => {
      await setRequiredDocumentCategories(db, accountId, ["id", "insurance"]);
      expect(await restoreRequiredDocumentCategories(db, accountId, ["id", "insurance"], ["id"])).toBe(true);
      expect(await getRequiredDocumentCategories(db, accountId)).toEqual(["id"]);
      expect(await restoreRequiredDocumentCategories(db, accountId, ["id", "insurance"], [])).toBe(false);
      expect(await getRequiredDocumentCategories(db, accountId)).toEqual(["id"]);
      await setRequiredDocumentCategories(db, accountId, []);
      expect(await restoreRequiredDocumentCategories(db, accountId, [], ["warranty"])).toBe(true);
      expect(await getRequiredDocumentCategories(db, accountId)).toEqual(["warranty"]);
      await expect(restoreRequiredDocumentCategories(db, accountId, ["other"], [])).rejects.toThrow(TypeError);
    }));
});
```

`…/documents/required-documents-actions.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const access = vi.hoisted(() => ({ value: { userId: "u1", isAgency: false, role: "owner" as string | null, canManage: true } }));
const db = vi.hoisted(() => ({ restore: vi.fn(), serviceDb: vi.fn(() => ({ tag: "service" })) }));
const revalidatePath = vi.hoisted(() => vi.fn());
vi.mock("@/lib/auth", () => ({ requireAccountAccess: vi.fn(async () => access.value) }));
vi.mock("next/cache", () => ({ revalidatePath }));
vi.mock("@bis/db", async () => {
  const rules = await vi.importActual<typeof import("@bis/db/document-rules")>("@bis/db/document-rules");
  return { serviceDb: db.serviceDb, restoreRequiredDocumentCategories: db.restore, cleanRequiredCategories: rules.cleanRequiredCategories };
});
import { undoRequiredDocumentsAction } from "./required-documents-actions";

beforeEach(() => {
  vi.clearAllMocks();
  access.value = { userId: "u1", isAgency: false, role: "owner", canManage: true };
  db.restore.mockResolvedValue(true);
});

describe("undoRequiredDocumentsAction (spec 3.3; plan deviation 9)", () => {
  it("refuses a Staff member before any write (mutation: drop the canManage check -> restore is called -> FAILS)", async () => {
    access.value = { userId: "u2", isAgency: false, role: "staff", canManage: false };
    expect(await undoRequiredDocumentsAction("a1", ["id"], [])).toEqual({ ok: false, error: "documents.required.role" });
    expect(db.restore).not.toHaveBeenCalled();
  });

  it("refuses a list that is not requirable before any write (mutation: skip the clean -> FAILS)", async () => {
    expect(await undoRequiredDocumentsAction("a1", ["other"], [])).toEqual({ ok: false, error: "documents.required.failed" });
    expect(db.restore).not.toHaveBeenCalled();
  });

  it("restores on the service client with the cleaned lists in the vault's order and revalidates both pages (mutation: swap expected and previous -> FAILS)", async () => {
    expect(await undoRequiredDocumentsAction("a1", ["insurance", "id"], ["warranty"])).toEqual({ ok: true });
    expect(db.restore).toHaveBeenCalledWith({ tag: "service" }, "a1", ["id", "insurance"], ["warranty"]);
    expect(revalidatePath.mock.calls.map((c) => c[0]).sort()).toEqual(["/dashboard/accounts/a1/documents", "/dashboard/accounts/a1/settings"]);
  });

  it("answers changed when the stored list moved on, and failed when the write throws (mutation: answer ok on false -> FAILS)", async () => {
    db.restore.mockResolvedValueOnce(false);
    expect(await undoRequiredDocumentsAction("a1", ["id"], [])).toEqual({ ok: false, error: "documents.required.changed" });
    db.restore.mockRejectedValueOnce(new Error("boom"));
    expect(await undoRequiredDocumentsAction("a1", ["id"], [])).toEqual({ ok: false, error: "documents.required.failed" });
  });
});
```

(`cleanRequiredCategories` answers the vault's order, duplicates dropped: `document-rules.ts:133-140`, read 2026-10-17.)

- [ ] **Step 3: Run them to see them fail** (the db files on set A; the action with `pnpm --filter web exec vitest run "src/app/(dashboard)/dashboard/accounts/[accountId]/documents/required-documents-actions.test.ts"`). Paste one failing line from each.

- [ ] **Step 4: Implement.**
  - `documents.ts`: prefix `export` to `const DOC_COLS`, `const VERSION_COLS`, `const asVersion`, `function readyVersionsOf`, with one comment line above them: `// Exported for account-documents.ts (S-07 3a) only; not in the barrel.`
  - `packages/db/src/account-documents.ts`:

```ts
import type { SupabaseClient } from "@supabase/supabase-js";
import { DOCUMENT_EXPIRY_WINDOW_DAYS, shiftDay, type DocumentCategory } from "./document-rules";
import { DOC_COLS, VERSION_COLS, asVersion, readyVersionsOf, type DocumentRow, type DocumentVersionRow, type ListedDocument } from "./documents";

/**
 * The account-wide Documents page (S-07 3a, spec 3.1). The caller's REQUEST client: 0077's RLS decides
 * every row (the record's visibility, the Technician fence, Owners only). Live (not trashed), listed (a
 * ready version), filed on a contact or a group. `today` is the ACCOUNT's day (documentsClock); the
 * expiry filters compare dates, never instants. Cursor paging on (sort key, id); a head count that
 * THROWS on a null count (memory "head-count null"), never zero.
 */
export const ACCOUNT_DOCUMENTS_SHOWS = ["expiring", "expired", "all"] as const;
export type AccountDocumentsShow = (typeof ACCOUNT_DOCUMENTS_SHOWS)[number];
export type AccountDocumentsFilter = { show: AccountDocumentsShow; category: DocumentCategory | null; today: string };
export type AccountDocumentsCursor = { v: string; id: string };
export type AccountDocument = ListedDocument & {
  contact: { id: string; first_name: string | null; last_name: string | null } | null;
  group: { id: string; name: string; kind: "household" | "business" } | null;
};

const SELECT = `${DOC_COLS}, version:document_versions!documents_current_version_fkey(${VERSION_COLS}), `
  + `versions:document_versions!document_versions_document_fkey(${VERSION_COLS}), `
  + "contact:contacts!documents_contact_fkey(id, first_name, last_name), group:client_groups!documents_group_fkey(id, name, kind)";
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** PostgREST's own quoting inside an .or() string (contacts.ts' quoteFilterValue, redeclared: that one is private). */
const quote = (v: string) => `"${v.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;

/** The builder methods used here, structurally (contacts.ts:759's cast): a reassigned builder with embeds is too deep for tsc. */
type Q = {
  eq(c: string, v: unknown): Q; is(c: string, v: null): Q; not(c: string, op: string, v: unknown): Q;
  gte(c: string, v: string): Q; lte(c: string, v: string): Q; lt(c: string, v: string): Q;
  or(filters: string): Q; order(c: string, o: { ascending: boolean }): Q; limit(n: number): Q;
} & PromiseLike<{ data: unknown[] | null; count?: number | null; error: { message: string } | null }>;

function scoped(q: Q, accountId: string, f: AccountDocumentsFilter): Q {
  // documents_one_record (0077:74): exactly one record column is set, so "a contact or a group" is "no place, no deal".
  let r = q.eq("account_id", accountId).is("deleted_at", null).not("current_version_id", "is", null)
    .is("place_id", null).is("opportunity_id", null);
  if (f.category) r = r.eq("category", f.category);
  if (f.show === "expiring") r = r.gte("expires_on", f.today).lte("expires_on", shiftDay(f.today, DOCUMENT_EXPIRY_WINDOW_DAYS));
  if (f.show === "expired") r = r.lt("expires_on", f.today);
  return r;
}

export async function listAccountDocuments(
  db: SupabaseClient, accountId: string, f: AccountDocumentsFilter, opts: { before?: AccountDocumentsCursor; limit: number },
): Promise<AccountDocument[]> {
  const ascending = f.show === "expiring";
  const column = f.show === "all" ? "created_at" : "expires_on";
  let q = scoped(db.from("documents").select(SELECT) as unknown as Q, accountId, f);
  if (opts.before) {
    const { v, id } = opts.before;
    const fits = UUID.test(id) && (f.show === "all" ? /^\d{4}-\d{2}-\d{2}T/.test(v) && !Number.isNaN(Date.parse(v)) : DAY.test(v));
    if (!fits) throw new TypeError("listAccountDocuments: a cursor that does not fit this list");
    const cmp = ascending ? "gt" : "lt";
    q = q.or(`${column}.${cmp}.${quote(v)},and(${column}.eq.${quote(v)},id.${cmp}.${id})`);
  }
  const { data, error } = await q.order(column, { ascending }).order("id", { ascending }).limit(opts.limit);
  if (error) throw new Error(`listAccountDocuments failed: ${error.message}`);
  return ((data ?? []) as unknown as (DocumentRow & {
    version: DocumentVersionRow | null; versions: DocumentVersionRow[] | null;
    contact: AccountDocument["contact"]; group: AccountDocument["group"];
  })[]).flatMap((r) => (r.version ? [{ ...r, version: asVersion(r.version), versions: readyVersionsOf(r.version, r.versions ?? []) }] : []));
}

export async function countAccountDocuments(db: SupabaseClient, accountId: string, f: AccountDocumentsFilter): Promise<number> {
  const { count, error } = await scoped(db.from("documents").select("id", { count: "exact", head: true }) as unknown as Q, accountId, f);
  if (error) throw new Error(`countAccountDocuments failed: ${error.message}`);
  if (count === null || count === undefined) throw new Error("countAccountDocuments failed: no count returned");
  return count;
}
```

  - `document-requirements.ts`, appended:

```ts
/**
 * Service client, after the caller's role check (S-07 3a: the Owner card's Undo; plan deviation 9).
 * Back to `previous` only while the stored list is exactly `expected` (the save's own answer): a
 * compare-and-set, so an Undo never clobbers a newer edit. Answers false when the list moved on.
 */
export async function restoreRequiredDocumentCategories(
  db: SupabaseClient, accountId: string, expected: unknown, previous: unknown,
): Promise<boolean> {
  const e = cleanRequiredCategories(expected);
  const p = cleanRequiredCategories(previous);
  if (!e || !p) throw new TypeError("restoreRequiredDocumentCategories: not lists of requirable categories");
  const { data, error } = await db.from("accounts").update({ required_document_categories: p })
    .eq("id", accountId).eq("required_document_categories", `{${e.join(",")}}`).select("id");
  if (error) throw new Error(`restoreRequiredDocumentCategories failed: ${error.message}`);
  return (data ?? []).length === 1;
}
```

  - `index.ts`, after Task 3's block:

```ts
// S-07 3a: the account-wide Documents page. See ./account-documents.ts.
export {
  listAccountDocuments, countAccountDocuments, ACCOUNT_DOCUMENTS_SHOWS,
  type AccountDocumentsShow, type AccountDocumentsFilter, type AccountDocumentsCursor, type AccountDocument,
} from "./account-documents";
```

and `restoreRequiredDocumentCategories,` in the `./document-requirements` block.
  - `…/documents/required-documents-actions.ts`:

```ts
"use server";

import { revalidatePath } from "next/cache";
import { requireAccountAccess } from "@/lib/auth";
import { serviceDb, restoreRequiredDocumentCategories, cleanRequiredCategories } from "@bis/db";
import { loggableError } from "@/lib/loggable-error";

/**
 * The Owner's Required documents card's Undo (S-07 3a, spec 3.3). Admits who 2c's save admits
 * (canManage: an Owner or the agency). A compare-and-set on the whole list (plan deviation 9): the
 * previous list goes back only while the stored one is still what the save wrote. `error` is a
 * message KEY: the bilingual card says it in the reader's language.
 */
export type RequiredUndoAnswer =
  | { ok: true }
  | { ok: false; error: "documents.required.role" | "documents.required.changed" | "documents.required.failed" };

export async function undoRequiredDocumentsAction(accountId: string, expected: string[], previous: string[]): Promise<RequiredUndoAnswer> {
  const access = await requireAccountAccess(accountId);
  if (!access.canManage) return { ok: false, error: "documents.required.role" };
  const e = cleanRequiredCategories(expected);
  const p = cleanRequiredCategories(previous);
  if (!e || !p) return { ok: false, error: "documents.required.failed" };
  try {
    if (!(await restoreRequiredDocumentCategories(serviceDb(), accountId, e, p))) return { ok: false, error: "documents.required.changed" };
    revalidatePath(`/dashboard/accounts/${accountId}/documents`);
    revalidatePath(`/dashboard/accounts/${accountId}/settings`);
    return { ok: true };
  } catch (err) {
    console.error(`required documents undo (account ${accountId}): ${loggableError(err)}`);
    return { ok: false, error: "documents.required.failed" };
  }
}
```

  - `…/acct/settings/document-requirements-actions.ts`: add `` revalidatePath(`/dashboard/accounts/${accountId}/documents`); `` on the line BEFORE its `revalidatePath(…/settings)` (the Owner card reads the list there). Its test asserts `` expect(revalidatePath).toHaveBeenLastCalledWith(`/dashboard/accounts/${ACC}/settings`) `` (`settings/document-requirements-actions.test.ts:43`), which stays true with the new line first; add beside it `` expect(revalidatePath).toHaveBeenCalledWith(`/dashboard/accounts/${ACC}/documents`); `` (mutation: drop the new line -> FAILS).
  - `in-account-service-reads.test.ts`, beside `:136`: `"app/(dashboard)/dashboard/accounts/[accountId]/documents/required-documents-actions.ts": "owner-only",`.

- [ ] **Step 5: Run** on set A: `account-documents.test.ts`, `document-requirements.test.ts`, `documents.test.ts` (the export change is behaviour-neutral) → PASS. Web: the action test, `settings/document-requirements-actions.test.ts`, `in-account-service-reads.test.ts`, typecheck, eslint on the touched files → PASS. Paste summaries.
- [ ] **Step 6: Probes:** (a) `lte` → `lt` in `scoped` → the bounds case FAILS on `d30`; (b) the cursor `gt` → `gte` → the round-trip case FAILS; (c) `count ?? 0` → the null-count case FAILS; (d) drop the list `.eq` in `restoreRequiredDocumentCategories` → its case FAILS; (e) drop `if (!access.canManage)` in the action → the Staff case FAILS; (f) remove the new `ALLOWED` line → `in-account-service-reads.test.ts` FAILS naming the file. Paste each.
- [ ] **Step 7: Stop your kit. Commit** every path above, message "db: the Documents page's filtered, paged read and its real total; the required list's compare-and-set restore and its Undo action (S-07 3a)".

---

## Task 5: The pure expiry helpers and the `documentsExpiry` pass (bis-automations)

**Review:** opus. **Runs:** after Tasks 2 and 3 (beside Tasks 4 and 6).

**Files**
- Create: `apps/web/src/lib/documents/expiry-task.ts` (+ `expiry-task.test.ts`)
- Create: `apps/web/src/lib/automations/passes/documents-expiry.ts` (+ `documents-expiry.test.ts`)
- Modify: `apps/web/src/lib/automations/registry.ts` (import, one array entry after `documentsScanPass`, one doc-comment sentence), `apps/web/src/lib/automations/sentinel.test.ts`, `apps/web/src/app/api/cron/reminders/route.test.ts` (exactly the rows in "Pinned tests this PR changes")

**Interfaces**
- Consumes: `listExpiringDocuments`, `listDocumentExpiryTaskKeys`, `ensureDocumentExpiryTask`, `expiryTaskKey`, `ExpiringDocument`, `DOCUMENT_EXPIRY_WINDOW_DAYS`, `shiftDay` (Task 3); `documentRequestTarget` (`document-requests.ts:196`, `(db, accountId, { contact_id, client_group_id }) => Promise<DocumentRequestTarget | null>`, `name` and `contactId`); `resolveAccountZone` (`lib/booking/followup-timing.ts:122`); `partsInZone`, `zonedTimeToUtc` (`lib/booking/slots.ts:40, :82`); `dayDiff` (`lib/documents/expiry.ts:12`); keys `documents.expiryTask.*` (Task 2); `Pass` (`lib/automations/context.ts`).
- Produces:
  - `lib/documents/expiry-task.ts`: `EXPIRY_DUE_LEAD_DAYS = 7`, `EXPIRY_DUE_HOUR = 9`, `dayKeyIn(now: Date, zone: string): string`, `inExpiryWindow(expiresOn: string, today: string): boolean`, `expiryDueAt(expiresOn: string, zone: string): string` (an ISO instant), `expiryTaskTitle(a: { category: DocumentCategory; title: string; name: string; expiresOn: string }, lang: Locale): string`.
  - `passes/documents-expiry.ts`: `EXPIRY_TASKS_PER_RUN = 200`, `EXPIRY_CANDIDATES_PER_RUN = 1000`, `type ExpiryCounters = { opened: number; alreadyOpen: number; failed: number; unresolvableTimezone: number; capped: number }`, `openExpiryTasks(db: SupabaseClient, now: Date, scope?: { accountId?: string }): Promise<ExpiryCounters>`, `documentsExpiryPass: Pass` (key `"documentsExpiry"`). Task 12 imports `openExpiryTasks`.

- [ ] **Step 1: Read** `passes/documents-sweep.ts` and `passes/documents-scan.ts` whole (shape, logging, the end-of-run throw, the BUDGET comment), `lib/document-requests/request-task.ts` (the account-language title), `registry.ts`, `harness.ts:30-55`, `lib/booking/slots.ts:36-95`, `lib/booking/followup-timing.ts:100-130`, `lib/documents/expiry.ts`, `lib/loggable-error.ts`, `sentinel.test.ts:1-60, :195-290`, `route.test.ts:1-70, :315-330, :405-415, :585-645`.

- [ ] **Step 2: Write the failing tests.** `apps/web/src/lib/documents/expiry-task.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { dayKeyIn, inExpiryWindow, expiryDueAt, expiryTaskTitle } from "./expiry-task";

/** S-07 3a (spec 3.2): the account's own day, the 30-day window, the due instant (owner choice: expiry - 7 days at 09:00 in the zone), the title. */
const NOW = new Date("2026-11-01T03:00:00Z");   // 22:00 on Oct 31 in Chicago (CDT), 04:00 on Nov 1 in Berlin

describe("dayKeyIn: the account's calendar day, not UTC's", () => {
  it("is Oct 31 in Chicago and Nov 1 in Berlin at the same instant (mutation: now.toISOString().slice(0, 10) -> Chicago FAILS)", () => {
    expect(dayKeyIn(NOW, "America/Chicago")).toBe("2026-10-31");
    expect(dayKeyIn(NOW, "Europe/Berlin")).toBe("2026-11-01");
  });
});

describe("inExpiryWindow: today through today + 30, never a past date", () => {
  it.each([
    ["2026-10-31", true], ["2026-11-30", true], ["2026-12-01", false], ["2026-10-30", false],
  ])("%s on 2026-10-31 -> %s (mutations: < 30, a past day allowed, or <= 31 -> FAILS)", (expiresOn, want) => {
    expect(inExpiryWindow(expiresOn, "2026-10-31")).toBe(want);
  });
});

describe("expiryDueAt: the expiry date minus 7 calendar days, at 09:00 in the zone", () => {
  it.each([
    ["2026-11-16", "America/Chicago", "2026-11-09T15:00:00.000Z"],
    ["2026-11-16", "Europe/Berlin", "2026-11-09T08:00:00.000Z"],
    // Across the US fall-back (Nov 1 2026): 09:00 CDT on Oct 29. 7 x 24 h back from 09:00 CST on Nov 5 would be 10:00 CDT.
    ["2026-11-05", "America/Chicago", "2026-10-29T14:00:00.000Z"],
  ])("%s in %s -> %s (mutation: subtract 7 x 86_400_000 ms from the expiry day's 09:00 -> the DST case FAILS)", (expiresOn, zone, want) => {
    expect(expiryDueAt(expiresOn, zone)).toBe(want);
  });
});

describe("expiryTaskTitle: the account's language, the customer's or household's name, the file title for Other", () => {
  it("reads as the spec's example in English and Spanish (mutation: ignore lang -> the Spanish FAILS)", () => {
    expect(expiryTaskTitle({ category: "insurance", title: "Póliza", name: "Ana García", expiresOn: "2026-11-16" }, "en")).toBe("Ana García's insurance expires on Nov 16");
    expect(expiryTaskTitle({ category: "insurance", title: "Póliza", name: "Ana García", expiresOn: "2026-11-16" }, "es")).toBe("El seguro de Ana García vence el 16 nov");
  });
  it("Other names the file; no name reads as a customer (mutation: drop the noName fallback -> FAILS)", () => {
    expect(expiryTaskTitle({ category: "other", title: "Pool permit", name: "Bo", expiresOn: "2026-11-16" }, "en")).toBe("Bo's \"Pool permit\" expires on Nov 16");
    expect(expiryTaskTitle({ category: "insurance", title: "x", name: "  ", expiresOn: "2026-11-16" }, "en")).toBe("A customer's insurance expires on Nov 16");
    expect(expiryTaskTitle({ category: "insurance", title: "x", name: "", expiresOn: "2026-11-16" }, "es")).toBe("El seguro de un cliente vence el 16 nov");
  });
  it("the date is the expiry DAY whatever the server's zone (mutation: format without timeZone 'UTC' -> FAILS on a runner west of UTC)", () => {
    expect(expiryTaskTitle({ category: "permit", title: "x", name: "Bo", expiresOn: "2026-01-01" }, "en")).toBe("Bo's permit expires on Jan 1");
  });
});
```

`apps/web/src/lib/automations/passes/documents-expiry.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { ExpiringDocument } from "@bis/db";

const db = vi.hoisted(() => ({
  listExpiringDocuments: vi.fn(), listDocumentExpiryTaskKeys: vi.fn(), documentRequestTarget: vi.fn(), ensureDocumentExpiryTask: vi.fn(),
}));
vi.mock("@bis/db", async (importOriginal) => ({ ...(await importOriginal<object>()), ...db }));
import { expiryTaskKey } from "@bis/db";
import { openExpiryTasks, documentsExpiryPass, EXPIRY_TASKS_PER_RUN, EXPIRY_CANDIDATES_PER_RUN } from "./documents-expiry";

/** S-07 3a (spec 3.2, 6): who opens a To-do, once, where, titled and due how, and what a bad document does to the run. */
const NOW = new Date("2026-11-01T03:00:00Z");   // Chicago's day is Oct 31, Berlin's Nov 1
const FAKE_DB = { tag: "service" } as never;
let n = 0;
const row = (o: Partial<ExpiringDocument> = {}): ExpiringDocument => ({
  id: `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`, account_id: "acct-chi", contact_id: "c-ana", client_group_id: null,
  title: "Póliza", category: "insurance", expires_on: "2026-11-20", owners_only: false, deleted_at: null, version_scan: "clean",
  account_timezone: "America/Chicago", account_language: "en", ...o,
});
const BERLIN = { account_id: "acct-ber", account_timezone: "Europe/Berlin" } as const;
const opened = () => db.ensureDocumentExpiryTask.mock.calls.map((c) => (c[2] as { documentId: string }).documentId);
let errors: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.clearAllMocks();
  db.listDocumentExpiryTaskKeys.mockResolvedValue(new Set());
  db.documentRequestTarget.mockImplementation(async (_db: unknown, _a: string, ref: { contact_id: string | null }) =>
    ({ name: "Ana García", contactId: ref.contact_id, language: null, phone: null, email: null, phoneCountryUnconfirmed: null }));
  db.ensureDocumentExpiryTask.mockResolvedValue({ id: "t1", created: true });
  errors = vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => errors.mockRestore());

describe("the window, in each account's own day (spec 3.2)", () => {
  it("opens day 30 and day 0 in Chicago and day 30 in Berlin, never day 31 or a past date, across midnight UTC (mutation: the UTC day for every account -> FAILS)", async () => {
    const chi30 = row({ expires_on: "2026-11-30" }); const chi31 = row({ expires_on: "2026-12-01" }); const chi0 = row({ expires_on: "2026-10-31" });
    const ber30 = row({ ...BERLIN, expires_on: "2026-12-01" }); const berPast = row({ ...BERLIN, expires_on: "2026-10-31" });
    db.listExpiringDocuments.mockResolvedValue([chi30, chi31, chi0, ber30, berPast]);
    const c = await openExpiryTasks(FAKE_DB, NOW);
    expect(opened().sort()).toEqual([chi30.id, chi0.id, ber30.id].sort());
    expect(c).toEqual({ opened: 3, alreadyOpen: 0, failed: 0, unresolvableTimezone: 0, capped: 0 });
    expect(db.listExpiringDocuments).toHaveBeenCalledWith(FAKE_DB, { fromDay: "2026-10-31", toDay: "2026-12-02", limit: EXPIRY_CANDIDATES_PER_RUN, accountId: undefined });
  });

  it("re-checks the read's rules: Owners only, trashed, not clean, or on no customer opens nothing (mutation: drop the pass's own check -> FAILS)", async () => {
    db.listExpiringDocuments.mockResolvedValue([
      row({ owners_only: true }), row({ deleted_at: "2026-10-30T00:00:00Z" }), row({ version_scan: "pending" }), row({ contact_id: null, client_group_id: null }),
    ]);
    await openExpiryTasks(FAKE_DB, NOW);
    expect(db.ensureDocumentExpiryTask).not.toHaveBeenCalled();
  });

  it("an account whose zone cannot be resolved opens nothing and is counted once (mutation: fall back to UTC -> FAILS)", async () => {
    db.listExpiringDocuments.mockResolvedValue([row({ account_timezone: "Mars/Olympus" }), row({ account_timezone: "Mars/Olympus" })]);
    const c = await openExpiryTasks(FAKE_DB, NOW);
    expect(db.ensureDocumentExpiryTask).not.toHaveBeenCalled();
    expect(c.unresolvableTimezone).toBe(1);
  });

  it("scopes the read to one account when asked (the e2e's only way in; mutation: drop scope.accountId -> FAILS)", async () => {
    db.listExpiringDocuments.mockResolvedValue([]);
    await openExpiryTasks(FAKE_DB, NOW, { accountId: "acct-chi" });
    expect(db.listExpiringDocuments.mock.calls[0]![1]).toMatchObject({ accountId: "acct-chi" });
  });
});

describe("one To-do per document and date (spec 3.2 dedupe, re-arm)", () => {
  it("a key that already has its To-do is skipped and counted (mutation: ignore the keys -> FAILS)", async () => {
    const r = row();
    db.listExpiringDocuments.mockResolvedValue([r]);
    db.listDocumentExpiryTaskKeys.mockResolvedValue(new Set([expiryTaskKey(r.id, r.expires_on)]));
    const c = await openExpiryTasks(FAKE_DB, NOW);
    expect(db.ensureDocumentExpiryTask).not.toHaveBeenCalled();
    expect(c).toMatchObject({ opened: 0, alreadyOpen: 1 });
  });

  it("a new expiry date re-arms: the old date's To-do does not count (mutation: key on the document id alone -> FAILS)", async () => {
    const r = row({ expires_on: "2026-11-20" });
    db.listExpiringDocuments.mockResolvedValue([r]);
    db.listDocumentExpiryTaskKeys.mockResolvedValue(new Set([expiryTaskKey(r.id, "2026-11-10")]));
    await openExpiryTasks(FAKE_DB, NOW);
    expect(db.ensureDocumentExpiryTask.mock.calls[0]![2]).toMatchObject({ documentId: r.id, expiresOn: "2026-11-20" });
  });
});

describe("the To-do: where, titled and due how (spec 3.2)", () => {
  it("lands on the customer, titled in the ACCOUNT's language, due 7 days before at 09:00 there, by the system (mutations: the reader's language, or due on the expiry day -> FAILS)", async () => {
    const r = row({ account_language: "es", expires_on: "2026-11-30" });
    db.listExpiringDocuments.mockResolvedValue([r]);
    await openExpiryTasks(FAKE_DB, NOW);
    expect(db.ensureDocumentExpiryTask).toHaveBeenCalledWith(FAKE_DB, "acct-chi",
      { documentId: r.id, expiresOn: "2026-11-30", contactId: "c-ana", title: "El seguro de Ana García vence el 30 nov", dueAt: "2026-11-23T15:00:00.000Z" },
      "documents-expiry", "system");
  });

  it("a household's file lands on its primary contact, named by the household; with no primary, on nobody (mutation: pass the document's own contact_id -> FAILS)", async () => {
    const g1 = row({ contact_id: null, client_group_id: "g1" }); const g2 = row({ contact_id: null, client_group_id: "g2" });
    db.listExpiringDocuments.mockResolvedValue([g1, g2]);
    db.documentRequestTarget.mockImplementation(async (_db: unknown, _a: string, ref: { client_group_id: string | null }) =>
      ({ name: "Casa García", contactId: ref.client_group_id === "g1" ? "c-primary" : null, language: null, phone: null, email: null, phoneCountryUnconfirmed: null }));
    await openExpiryTasks(FAKE_DB, NOW);
    const byDoc = Object.fromEntries(db.ensureDocumentExpiryTask.mock.calls.map((c) => [(c[2] as { documentId: string }).documentId, c[2]]));
    expect(byDoc[g1.id]).toMatchObject({ contactId: "c-primary", title: "Casa García's insurance expires on Nov 20" });
    expect(byDoc[g2.id]).toMatchObject({ contactId: null, title: "Casa García's insurance expires on Nov 20" });
    expect(db.documentRequestTarget).toHaveBeenCalledWith(FAKE_DB, "acct-chi", expect.objectContaining({ contact_id: null, client_group_id: "g1" }));
  });
});

describe("the run's limits and failures (spec 3.2)", () => {
  it(`opens at most ${EXPIRY_TASKS_PER_RUN} To-dos and says it was capped (mutation: no cap -> FAILS)`, async () => {
    db.listExpiringDocuments.mockResolvedValue(Array.from({ length: EXPIRY_TASKS_PER_RUN + 1 }, () => row()));
    const c = await openExpiryTasks(FAKE_DB, NOW);
    expect(db.ensureDocumentExpiryTask).toHaveBeenCalledTimes(EXPIRY_TASKS_PER_RUN);
    expect(c.capped).toBe(1);
    expect(errors.mock.calls.flat().join(" ")).toContain("capped");
  });

  it("one document's failure does not stop the others; the run then throws with its counters, logging ids, never the file's title (mutations: rethrow at once -> the second is never opened; log the title -> FAILS)", async () => {
    const bad = row(); const good = row();
    db.listExpiringDocuments.mockResolvedValue([bad, good]);
    db.ensureDocumentExpiryTask.mockImplementation(async (_db: unknown, _a: string, input: { documentId: string }) => {
      if (input.documentId === bad.id) throw new Error("insert failed");
      return { id: "t2", created: true };
    });
    await expect(openExpiryTasks(FAKE_DB, NOW)).rejects.toThrow("\"failed\":1");
    expect(opened()).toEqual([bad.id, good.id]);
    const logged = errors.mock.calls.flat().join(" ");
    expect(logged).toContain(bad.id);
    expect(logged).toContain("acct-chi");
    expect(logged).not.toContain("Póliza");
  });
});

describe("the registered pass", () => {
  it("is documentsExpiry, runs on the tick's client and instant; nothing due is one read and zero counters (mutation: read the keys with no candidates -> FAILS)", async () => {
    db.listExpiringDocuments.mockResolvedValue([]);
    expect(documentsExpiryPass.key).toBe("documentsExpiry");
    const c = await documentsExpiryPass.run({ db: FAKE_DB, now: NOW, origin: "https://x", email: {} as never, sms: {} as never });
    expect(c).toEqual({ opened: 0, alreadyOpen: 0, failed: 0, unresolvableTimezone: 0, capped: 0 });
    expect(db.listDocumentExpiryTaskKeys).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 3: Run them to see them fail:** `pnpm --filter web exec vitest run src/lib/documents/expiry-task.test.ts src/lib/automations/passes/documents-expiry.test.ts`. Paste one failing line.

- [ ] **Step 4: Implement.** `apps/web/src/lib/documents/expiry-task.ts`:

```ts
import { DOCUMENT_EXPIRY_WINDOW_DAYS, shiftDay, type DocumentCategory } from "@bis/db/document-rules";
import { partsInZone, zonedTimeToUtc } from "@/lib/booking/slots";
import { dayDiff } from "@/lib/documents/expiry";
import { m, type MessageKey } from "@/lib/messages";
import { t } from "@/lib/i18n/t";
import type { Locale } from "@/lib/i18n/locale";

/**
 * The expiry To-do's pure rules (S-07 3a, spec 3.2). Every day is the ACCOUNT's calendar day
 * (partsInZone, the slot engine's own conversion); the window is today .. today + 30, so a file
 * already past its date never opens a To-do (the catch-up rule: the Documents page's Expired filter
 * covers those). Due: the expiry date minus 7 CALENDAR days, at 09:00 in the zone (owner choice
 * 2026-10-17), so a DST change in between never moves it to 08:00 or 10:00.
 */
export const EXPIRY_DUE_LEAD_DAYS = 7;
export const EXPIRY_DUE_HOUR = 9;
const pad = (v: number) => String(v).padStart(2, "0");

export function dayKeyIn(now: Date, zone: string): string {
  const p = partsInZone(now, zone);
  return `${p.y}-${pad(p.m)}-${pad(p.d)}`;
}

export function inExpiryWindow(expiresOn: string, today: string): boolean {
  const days = dayDiff(today, expiresOn);
  return days >= 0 && days <= DOCUMENT_EXPIRY_WINDOW_DAYS;
}

export function expiryDueAt(expiresOn: string, zone: string): string {
  const day = shiftDay(expiresOn, -EXPIRY_DUE_LEAD_DAYS);
  const y = Number(day.slice(0, 4)); const mo = Number(day.slice(5, 7)); const d = Number(day.slice(8, 10));
  // A 09:00 that does not exist (a DST gap at that hour, in no zone served today) falls to 09:00 UTC rather than no due date.
  return (zonedTimeToUtc(y, mo, d, EXPIRY_DUE_HOUR, 0, zone) ?? new Date(Date.UTC(y, mo - 1, d, EXPIRY_DUE_HOUR, 0))).toISOString();
}

export function expiryTaskTitle(a: { category: DocumentCategory; title: string; name: string; expiresOn: string }, lang: Locale): string {
  const name = a.name.trim() || t(m, "documents.expiryTask.noName", lang);
  const date = new Intl.DateTimeFormat(lang === "es" ? "es-US" : "en-US", { timeZone: "UTC", month: "short", day: "numeric" })
    .format(new Date(`${a.expiresOn}T00:00:00Z`));
  return t(m, `documents.expiryTask.${a.category}` as MessageKey, lang, { name, date, title: a.title });
}
```

(`partsInZone`'s answer has numeric `y`, `m`, `d`: confirm at `slots.ts:40-70` and adapt the field names if they differ.)

`apps/web/src/lib/automations/passes/documents-expiry.ts`:

```ts
import {
  listExpiringDocuments, listDocumentExpiryTaskKeys, ensureDocumentExpiryTask, documentRequestTarget, expiryTaskKey,
  DOCUMENT_EXPIRY_WINDOW_DAYS, shiftDay, type ExpiringDocument, type SupabaseClient,
} from "@bis/db";
import type { Pass } from "../context";
import { resolveAccountZone } from "@/lib/booking/followup-timing";
import { dayKeyIn, inExpiryWindow, expiryDueAt, expiryTaskTitle } from "@/lib/documents/expiry-task";
import { loggableError } from "@/lib/loggable-error";

/**
 * Expiry To-dos (S-07 3a, spec 3.2; plan deviations 1, 7, 10). Not a recipe; it sends nothing. EVERY
 * tick, idempotent: one candidate read over a coarse UTC range (today - 1 .. today + 31, wide enough for
 * every zone's own today), each candidate narrowed to its ACCOUNT's day, one read of the keys that
 * already have their To-do, then one insert per missing (document, date). 0084's unique index is the
 * last word (23505 = already there). Staff only (E1): nothing goes to a customer. The To-do lands on the
 * contact, or on a household's primary contact (documentRequestTarget, 2b), titled in the ACCOUNT's
 * language. Logs ids, never a title. A run with any failed document throws after the rest
 * (documents-sweep's pattern), so the heartbeat records it. BUDGET: bounded by count (1000 candidates,
 * 200 inserts with at most two reads each), not by time; cron-coupling.test.ts sums wall-clock budgets
 * only, and this adds none. Every @bis/db export is dereferenced inside a function, never at module
 * scope (the cron route test's bare mock throws on a dereference).
 */
export const EXPIRY_TASKS_PER_RUN = 200;
export const EXPIRY_CANDIDATES_PER_RUN = 1000;
const ACTOR = "documents-expiry";

export type ExpiryCounters = { opened: number; alreadyOpen: number; failed: number; unresolvableTimezone: number; capped: number };

const qualifies = (r: ExpiringDocument) =>
  !r.owners_only && r.deleted_at === null && r.version_scan === "clean" && (r.contact_id !== null || r.client_group_id !== null);

export async function openExpiryTasks(db: SupabaseClient, now: Date, scope: { accountId?: string } = {}): Promise<ExpiryCounters> {
  const c: ExpiryCounters = { opened: 0, alreadyOpen: 0, failed: 0, unresolvableTimezone: 0, capped: 0 };
  const utcToday = now.toISOString().slice(0, 10);
  const rows = await listExpiringDocuments(db, {
    fromDay: shiftDay(utcToday, -1), toDay: shiftDay(utcToday, DOCUMENT_EXPIRY_WINDOW_DAYS + 1),
    limit: EXPIRY_CANDIDATES_PER_RUN, accountId: scope.accountId,
  });
  if (rows.length === 0) return c;
  if (rows.length >= EXPIRY_CANDIDATES_PER_RUN) {
    c.capped = 1;
    console.error(`documents expiry: capped: the candidate read came back full (${EXPIRY_CANDIDATES_PER_RUN}); files beyond it wait for a later tick`);
  }
  const badZone = new Set<string>();
  const due: { r: ExpiringDocument; zone: string }[] = [];
  for (const r of rows) {
    if (!qualifies(r)) continue;
    const zone = resolveAccountZone(r.account_timezone);
    if (zone === null) {
      if (!badZone.has(r.account_id)) {
        badZone.add(r.account_id);
        c.unresolvableTimezone++;
        console.error(`documents expiry: account ${r.account_id}'s timezone cannot be resolved; its files open no To-do until it is fixed`);
      }
      continue;
    }
    if (inExpiryWindow(r.expires_on, dayKeyIn(now, zone))) due.push({ r, zone });
  }
  if (due.length === 0) return c;
  const have = await listDocumentExpiryTaskKeys(db, due.map((d) => d.r.id));
  let attempted = 0;
  for (const { r, zone } of due) {
    if (have.has(expiryTaskKey(r.id, r.expires_on))) { c.alreadyOpen++; continue; }
    if (attempted >= EXPIRY_TASKS_PER_RUN) {
      c.capped = 1;
      console.error(`documents expiry: capped at ${EXPIRY_TASKS_PER_RUN} To-dos this run; the rest open on the next tick`);
      break;
    }
    attempted++;
    try {
      const target = await documentRequestTarget(db, r.account_id, r);
      const title = expiryTaskTitle({ category: r.category, title: r.title, name: target?.name ?? "", expiresOn: r.expires_on },
        r.account_language === "es" ? "es" : "en");
      const t = await ensureDocumentExpiryTask(db, r.account_id, {
        documentId: r.id, expiresOn: r.expires_on, contactId: target?.contactId ?? null, title, dueAt: expiryDueAt(r.expires_on, zone),
      }, ACTOR, "system");
      if (t.created) c.opened++; else c.alreadyOpen++;
    } catch (e) {
      c.failed++;
      console.error(`documents expiry: document ${r.id} (account ${r.account_id}): the To-do was not opened: ${loggableError(e)}`);
    }
  }
  if (c.failed > 0) throw new Error(`documents expiry: ${JSON.stringify(c)}`);
  return c;
}

export const documentsExpiryPass: Pass = {
  key: "documentsExpiry",
  run: (ctx) => openExpiryTasks(ctx.db, ctx.now),
};
```

  - `registry.ts`: `import { documentsExpiryPass } from "./passes/documents-expiry";` after the scan's import; `documentsScanPass, documentsExpiryPass,` in `PASSES`; in the doc comment after "…which opsWatch (last) reads in the same tick." add: "The expiry To-dos (S-07 3a) follow the scan, so a version the scan just cleared opens its To-do this same tick; they read the vault and write only To-dos."
  - `sentinel.test.ts`, `route.test.ts`: exactly the rows in "Pinned tests this PR changes".

- [ ] **Step 5: Run** `expiry-task.test.ts`, `documents-expiry.test.ts`, `src/lib/automations/sentinel.test.ts`, `src/lib/automations/harness.test.ts`, `src/lib/automations/cron-coupling.test.ts`, `src/lib/automations/imports.test.ts`, `src/app/api/cron/reminders/route.test.ts`, typecheck, eslint. All PASS; paste each summary.
- [ ] **Step 6: Probes:** (a) `dayKeyIn` → `now.toISOString().slice(0, 10)` → the zone case AND the pass's window case FAIL; (b) `days <= DOCUMENT_EXPIRY_WINDOW_DAYS` → `<` → the window cases FAIL on day 30; (c) `expiryDueAt` as `Date.parse(expiresOn 09:00 in zone) - 7 * 86_400_000` → the DST case FAILS; (d) remove `if (attempted >= …)` → the cap case FAILS; (e) `throw e` inside the catch → the isolation case FAILS (the good one is never opened); (f) remove the pass from `PASSES` → the sentinel order case FAILS; (g) leave `listExpiringDocuments` out of `route.test.ts`' factory → the exact bodies FAIL with `documentsExpiry: { errored: 1 }`. Paste each.
- [ ] **Step 7: Commit** every path above, message "automations: the documents expiry pass opens one To-do per file and date 30 days ahead, in each account's own day (S-07 3a)".

---

## Task 6: The To-do's link: the work queue, the author mark, the URL contract (bis-crm)

**Review:** sonnet. **Runs:** after Tasks 1 and 3 (beside 4 and 5). **Replica:** set A once Task 4's implementer has stopped it (the orchestrator sequences the ports; the code is disjoint).

**Files**
- Create: `apps/web/src/lib/documents/card-focus.ts` (+ `card-focus.test.ts`), `…/acct/tasks/work-list.href.test.ts`
- Modify: `packages/db/src/work-queue.ts` (`WorkRow`, `openTasks`), `packages/db/src/test/work-queue.test.ts` (one case), `packages/db/src/activities.ts` (`TASK_COLS` `:50`, the row type `:63-75`), `packages/db/src/record.ts` (`TimelineTask` `:276-280`), `apps/web/src/lib/record/author-mark.ts` (`:32`) (+ `author-mark.test.ts`), `…/acct/tasks/work-list.tsx` (`:370-379`), `apps/web/src/app/(dashboard)/dashboard/work/agency-work-list.tsx` (`:194`)

**Interfaces**
- Consumes: 0084's columns and `tasks_document_expiry_fkey` (Task 1); `ensureDocumentExpiryTask` (Task 3, in the db test); `isRequirableCategory`, `RequirableCategory` (`@bis/db/document-rules`).
- Produces:
  - `WorkRow.documentFocus?: { documentId: string; category: DocumentCategory | null; groupId: string | null }`, present ONLY on a task with `document_expiry_id` (every existing exact row stays equal).
  - `TimelineTask.document_expiry_id?: string | null`; `listContactTasks` rows carry `document_expiry_id`.
  - `apps/web/src/lib/documents/card-focus.ts` (browser-safe): `export type CardFocus = { documentId: string | null; ask: RequirableCategory | null };` `export function cardFocusFrom(sp: { document?: unknown; ask?: unknown } | undefined): CardFocus | undefined` (undefined when neither is valid); `export function workRowHref(accountId: string, row: { contactId: string | null; documentFocus?: { documentId: string; category: string | null; groupId: string | null } | null }): string | null`. Task 7 consumes `cardFocusFrom` and `CardFocus`.

- [ ] **Step 1: Read** `packages/db/src/work-queue.ts:1-80, :160-200` (`openTasks`, `listAccountWork`, `listAgencyWork`), `test/work-queue.test.ts:1-60` and one case end to end, `activities.ts:45-80`, `record.ts:270-285`, `apps/web/src/lib/record/author-mark.ts:20-45` and its test's task cases, `…/acct/tasks/work-list.tsx:340-420`, `…/dashboard/work/agency-work-list.tsx:180-200`, `technician-guards.test.ts:38-63` (`stripComments`, copied below). Then `grep -rn "document_request_id" packages/db/src/test apps/web/src --include=*.test.ts` and `grep -rn "consent_event_id, call_id, assigned_to" apps/web/src packages/db/src`: every test that pins `TASK_COLS` or a task row's exact keys gets `document_expiry_id: null` in this task (list each file in the report).

- [ ] **Step 2: Write the failing tests.** `apps/web/src/lib/documents/card-focus.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { cardFocusFrom, workRowHref } from "./card-focus";

/** S-07 3a (spec 3.2; plan deviations 5, 6): the To-do's link and the card's reading of it, one contract. */
const DOC = "0f8fad5b-d9cb-469f-a165-70867728950e";
const A = "acct1";

describe("workRowHref", () => {
  it("an expiry To-do on a customer links to the customer with the file and its category (mutation: drop ask -> FAILS)", () => {
    expect(workRowHref(A, { contactId: "c1", documentFocus: { documentId: DOC, category: "insurance", groupId: null } }))
      .toBe(`/dashboard/accounts/acct1/contacts/c1?document=${DOC}&ask=insurance`);
  });
  it("a household's file links to the household, whether the To-do landed on its primary contact or on nobody (mutation: prefer the contact -> FAILS)", () => {
    expect(workRowHref(A, { contactId: "c1", documentFocus: { documentId: DOC, category: "permit", groupId: "g1" } }))
      .toBe(`/dashboard/accounts/acct1/groups/g1?document=${DOC}&ask=permit`);
    expect(workRowHref(A, { contactId: null, documentFocus: { documentId: DOC, category: "permit", groupId: "g1" } }))
      .toBe(`/dashboard/accounts/acct1/groups/g1?document=${DOC}&ask=permit`);
  });
  it("Other and an unreadable category carry no ask (2c D8); a plain To-do keeps its plain link; nothing to link is null", () => {
    expect(workRowHref(A, { contactId: "c1", documentFocus: { documentId: DOC, category: "other", groupId: null } })).toBe(`/dashboard/accounts/acct1/contacts/c1?document=${DOC}`);
    expect(workRowHref(A, { contactId: "c1", documentFocus: { documentId: DOC, category: null, groupId: null } })).toBe(`/dashboard/accounts/acct1/contacts/c1?document=${DOC}`);
    expect(workRowHref(A, { contactId: "c1" })).toBe("/dashboard/accounts/acct1/contacts/c1");
    expect(workRowHref(A, { contactId: null })).toBeNull();
  });
});

describe("cardFocusFrom", () => {
  it("reads back exactly what workRowHref wrote (mutation: rename either parameter on one side -> FAILS)", () => {
    const href = workRowHref(A, { contactId: "c1", documentFocus: { documentId: DOC, category: "warranty", groupId: null } })!;
    expect(cardFocusFrom(Object.fromEntries(new URL(href, "http://x").searchParams))).toEqual({ documentId: DOC, ask: "warranty" });
  });
  it("drops anything that is not a file id or a requirable category; nothing valid is undefined, so a page passes no prop (mutation: answer {null, null} -> FAILS)", () => {
    expect(cardFocusFrom({ document: DOC.toUpperCase(), ask: "other" })).toEqual({ documentId: DOC, ask: null });
    expect(cardFocusFrom({ document: "x\"]", ask: "insurance" })).toEqual({ documentId: null, ask: "insurance" });
    expect(cardFocusFrom({ document: [DOC], ask: ["id"] })).toBeUndefined();
    expect(cardFocusFrom({})).toBeUndefined();
    expect(cardFocusFrom(undefined)).toBeUndefined();
  });
});
```

`…/acct/tasks/work-list.href.test.ts` (a source pin; `stripComments` is copied VERBATIM from `technician-guards.test.ts:38-63`, the house scanner, so a link only in a comment cannot pass; the reviewer diffs the two copies):

```ts
import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";

/** S-07 3a: both work queues link a row through workRowHref, so an expiry To-do opens its file (plan deviation 5). */
function stripComments(src: string): string {
  let out = "";
  let mode: "code" | "line" | "block" | "sq" | "dq" | "tpl" = "code";
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    const d = src[i + 1];
    if (mode === "code") {
      if (c === "/" && d === "/") { mode = "line"; i++; continue; }
      if (c === "/" && d === "*") { mode = "block"; i++; continue; }
      if (c === "'") mode = "sq";
      else if (c === '"') mode = "dq";
      else if (c === "`") mode = "tpl";
      out += c;
      continue;
    }
    if (mode === "line") { if (c === "\n") { mode = "code"; out += c; } continue; }
    if (mode === "block") {
      if (c === "*" && d === "/") { mode = "code"; i++; } else if (c === "\n") out += c;
      continue;
    }
    if (c === "\\") { out += c + (d ?? ""); i++; continue; }
    if ((mode === "sq" && c === "'") || (mode === "dq" && c === '"') || (mode === "tpl" && c === "`")) mode = "code";
    out += c;
  }
  return out;
}
const AGENCY = path.resolve(__dirname, "../../../../work/agency-work-list.tsx");

describe("the work queues' row links", () => {
  it("the agency list's path resolves (a wrong path must fail, never skip)", () => {
    expect(existsSync(AGENCY)).toBe(true);
  });
  it.each([
    [path.resolve(__dirname, "work-list.tsx"), "workRowHref(accountId, row)"],
    [AGENCY, "workRowHref(row.accountId, row)"],
  ])("%s builds its link with %s, never the bare contact href (mutation: restore the template literal -> FAILS)", (file, call) => {
    const src = stripComments(readFileSync(file, "utf8"));
    expect(src).toContain(call);
    expect(src).not.toMatch(/href=\{`\/dashboard\/accounts\/\$\{(?:accountId|row\.accountId)\}\/contacts\/\$\{row\.contactId\}`\}/);
  });
});
```

(`…/acct/tasks/` is `apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/tasks/`, so `../../../../work/` reaches `apps/web/src/app/(dashboard)/dashboard/work/`; the first case proves it.)

`packages/db/src/test/work-queue.test.ts`, one case (with the file's own imports; add `createDocument` from `../documents`, `createGroupWithMember` from `../client-groups`, `ensureDocumentExpiryTask` from `../document-expiry` if missing; use `listAccountWork`'s signature as read in Step 1):

```ts
it("an expiry To-do carries its file, its category and its household; a plain To-do carries no such key (S-07 3a; mutations: always set documentFocus -> the plain row FAILS; drop the embed -> category null -> FAILS)", () =>
  withTestAccount(async (db, accountId) => {
    const ana = (await createContact(db, accountId, { firstName: "Ana" }, "user_wq")).id;
    const g = await createGroupWithMember(db, accountId, ana, "household", "Casa Ana", null, "user_wq");
    if (g.status !== "ok") throw new Error(g.status);
    const onAna = await createDocument(db, { accountId, record: { kind: "contact", id: ana }, title: "S", category: "insurance", expiresOn: "2030-03-10", ownersOnly: false, source: "upload", createdBy: "user_wq" });
    const onCasa = await createDocument(db, { accountId, record: { kind: "group", id: g.groupId }, title: "P", category: "permit", expiresOn: "2030-03-12", ownersOnly: false, source: "upload", createdBy: "user_wq" });
    await ensureDocumentExpiryTask(db, accountId, { documentId: onAna, expiresOn: "2030-03-10", contactId: ana, title: "A", dueAt: "2030-03-03T15:00:00Z" }, "documents-expiry");
    await ensureDocumentExpiryTask(db, accountId, { documentId: onCasa, expiresOn: "2030-03-12", contactId: ana, title: "B", dueAt: "2030-03-05T15:00:00Z" }, "documents-expiry");
    const { error } = await db.from("tasks").insert({ account_id: accountId, contact_id: ana, title: "Plain" });
    if (error) throw new Error(error.message);
    const rows = await listAccountWork(db, accountId);
    const byTitle = Object.fromEntries(rows.filter((r) => r.source === "task").map((r) => [r.title, r]));
    expect(byTitle.A!.documentFocus).toEqual({ documentId: onAna, category: "insurance", groupId: null });
    expect(byTitle.B!.documentFocus).toEqual({ documentId: onCasa, category: "permit", groupId: g.groupId });
    expect("documentFocus" in byTitle.Plain!).toBe(false);
  }));
```

`apps/web/src/lib/record/author-mark.test.ts`, one case beside the request To-do's: a `task` entry whose task has `document_expiry_id: "d1"`, `created_by: "user_x"`, every other link null → `{ kind: "automation", personId: null }` (mutation: drop the new condition → `{ kind: "person", personId: "user_x" }` → FAILS).

- [ ] **Step 3: Run them to see them fail** (web by path; the db case on set A). Paste one line each.
- [ ] **Step 4: Implement.**
  - `apps/web/src/lib/documents/card-focus.ts`:

```ts
import { isRequirableCategory, type RequirableCategory } from "@bis/db/document-rules";

/**
 * The To-do -> Documents card link (S-07 3a, spec 3.2; plan deviations 5, 6), both directions in one
 * place. `?document=<id>` scrolls the card to that file and focuses it; `?ask=<category>` pre-ticks it
 * when staff press Ask the customer (only the eight requirable categories: 2c D8). Browser-safe.
 */
export type CardFocus = { documentId: string | null; ask: RequirableCategory | null };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function cardFocusFrom(sp: { document?: unknown; ask?: unknown } | undefined): CardFocus | undefined {
  const documentId = typeof sp?.document === "string" && UUID.test(sp.document) ? sp.document.toLowerCase() : null;
  const ask = isRequirableCategory(sp?.ask) ? sp.ask : null;
  return documentId || ask ? { documentId, ask } : undefined;
}

export function workRowHref(
  accountId: string,
  row: { contactId: string | null; documentFocus?: { documentId: string; category: string | null; groupId: string | null } | null },
): string | null {
  const base = `/dashboard/accounts/${accountId}`;
  const f = row.documentFocus;
  if (f) {
    const q = new URLSearchParams({ document: f.documentId });
    if (isRequirableCategory(f.category)) q.set("ask", f.category);
    if (f.groupId) return `${base}/groups/${f.groupId}?${q}`;
    if (row.contactId) return `${base}/contacts/${row.contactId}?${q}`;
  }
  return row.contactId ? `${base}/contacts/${row.contactId}` : null;
}
```

  - `work-queue.ts`: `import type { DocumentCategory } from "./document-rules";`; `WorkRow` gains

```ts
  /** S-07 3a: an expiry To-do (0084's tasks.document_expiry_id) with its file's category and household, for the row's link
   *  (apps/web/src/lib/documents/card-focus.ts). Present ONLY on such a task. */
  documentFocus?: { documentId: string; category: DocumentCategory | null; groupId: string | null };
```

  `openTasks`' select string gains `, document_expiry_id, expiry_doc:documents!tasks_document_expiry_fkey(category, client_group_id)`; its row type gains `document_expiry_id: string | null; expiry_doc: { category: DocumentCategory; client_group_id: string | null } | null`; the mapped object gains, last, `...(t.document_expiry_id ? { documentFocus: { documentId: t.document_expiry_id, category: t.expiry_doc?.category ?? null, groupId: t.expiry_doc?.client_group_id ?? null } } : {})`.
  - `activities.ts:50`: `TASK_COLS` gains `, document_expiry_id`; the row type gains `/** S-07 3a (0084): the file whose expiry this To-do is about; the automation opened it. */ document_expiry_id: string | null;`.
  - `record.ts`, `TimelineTask`: `/** S-07 3a (0084): the file whose expiry this To-do is about; the automation opened it. Optional, so no task fixture changes. */ document_expiry_id?: string | null;`.
  - `author-mark.ts:32`: `if (entry.task.consent_event_id || entry.task.document_request_id || entry.task.document_expiry_id) return { kind: "automation", personId: null };`, its comment gaining "and S-07 3a's expiry To-do".
  - `work-list.tsx`: `import { workRowHref } from "@/lib/documents/card-focus";`; before the row's `return`, `const href = workRowHref(accountId, row);`; the branch becomes `{href ? (<Link href={href} className={cn(rowClassName, "min-w-0 flex-1")}>{body}</Link>) : (<div className={cn(rowClassName, "min-w-0 flex-1")}>{body}</div>)}`; the comment above it gains "S-07 3a: an expiry To-do links to its file (workRowHref)".
  - `agency-work-list.tsx:194`: the same with `workRowHref(row.accountId, row)`.
- [ ] **Step 5: Run** `card-focus.test.ts`, `work-list.href.test.ts`, every `…/acct/tasks/*.test.ts`, every `…/dashboard/work/*.test.ts`, `author-mark.test.ts`, the files Step 1's greps found, typecheck, eslint; on set A `work-queue.test.ts`, `activities.test.ts`, `record.test.ts`. All PASS.
- [ ] **Step 6: Probes:** (a) `workRowHref` tests `row.contactId` before `f.groupId` → the household case FAILS; (b) `openTasks` always sets `documentFocus` → the db plain-row assertion FAILS; (c) drop `|| entry.task.document_expiry_id` → the author-mark case FAILS; (d) restore the template-literal href in `work-list.tsx` → `work-list.href.test.ts` FAILS. Paste each.
- [ ] **Step 7: Stop your kit. Commit** every path above, message "work queue: an expiry To-do links to its file on the customer or household, and reads as the automation's (S-07 3a)".

---

## Task 7: The Documents card: focus and the pre-ticked Ask; the two pages pass it (bis-frontend)

**Review:** opus. **Runs:** after Tasks 2 and 6.

**Files**
- Modify: `…/contacts/documents-card.tsx` (+ `documents-card.test.ts`; one `describe` APPENDED to `documents-card-structure.test.ts`)
- Modify: `…/contacts/[contactId]/page.tsx` (+ `page.test.ts`), `…/acct/groups/[groupId]/page.tsx` (+ `page.test.ts`)

**Interfaces**
- Consumes: `cardFocusFrom`, `CardFocus` (Task 6); the card's `openAsk(items)` (`documents-card.tsx:706-707`) and `DocumentRequestDialog`'s `initialItems` (`:829`).
- Produces (read by Task 9):
  - `export function ExpiryLine(…)` and `export function ScanStatus(…)` (module-private today, `documents-card.tsx:163-190`; signatures unchanged).
  - The row's open button carries `data-document-open` (one per row).
  - `export function askPreset(focus: CardFocus | undefined): RequirableCategory[]`.
  - `DocumentsCard` gains an optional prop `focus?: CardFocus`.

- [ ] **Step 0: The base.** `pnpm --filter web exec vitest run "src/app/(dashboard)/dashboard/accounts/[accountId]/contacts/documents-card-structure.test.ts"` PASSES unedited (paste its summary). Read it whole: the `src`/`container`/`squash`/`body` helpers your `describe` reuses, and whether `body` is whitespace-squashed (write your expected strings in the same form).
- [ ] **Step 1: Read** `documents-card.tsx` whole (the row `:197-260`, `ExpiryLine`/`ScanStatus` `:163-190`, the container `:538-841`: `openAsk`, the header's `onAsk: () => openAsk()` at `:820`, the ready-files value the viewer reads at `:836`, every effect), `documents-card.test.ts`, `[contactId]/page.tsx:60-80, :240-260` and `page.test.ts:690-720`, `groups/[groupId]/page.tsx:60-75, :225-235` and `page.test.ts:280-300`.
- [ ] **Step 2: Failing tests.**
  - `documents-card.test.ts`: (1) `askPreset({ documentId: null, ask: "insurance" })` → `["insurance"]`; `askPreset(undefined)` → `[]`; `askPreset({ documentId: "d", ask: null })` → `[]` (mutation: `[focus.ask]` without the null check → `[null]` → FAILS). (2) A ready `DocumentsCardView` with two rows renders `data-document-open` exactly twice, each on the button whose `aria-label` is "Open <title>" (mutation: the attribute on the menu trigger → FAILS on the label).
  - `documents-card-structure.test.ts`, APPENDED:

```ts
describe("a To-do's link focuses its file and pre-ticks Ask (S-07 3a, spec 3.2; plan deviations 5, 6)", () => {
  it("the header's Ask the customer opens with the link's category (mutation: onAsk: () => openAsk() -> FAILS)", () => {
    expect(body).toContain("onAsk: () => openAsk(askPreset(focus))");
    expect(body).not.toContain("onAsk: () => openAsk(),");
  });

  it("the focus effect runs once, only after the files are ready, only for a row it found, and sets no state (mutations: drop the once guard or the row check; a setState in the effect -> FAILS)", () => {
    const from = body.indexOf("const focusedOnce = useRef(false);");
    const to = body.indexOf("}, [focusId, filesReady]);");
    expect(from).toBeGreaterThanOrEqual(0);
    expect(to).toBeGreaterThan(from);
    const effect = body.slice(from, to);
    expect(effect).toContain("if (focusedOnce.current || !focusId || !filesReady) return;");
    expect(effect).toContain("if (!button) return;");
    expect(effect.indexOf("focusedOnce.current = true;")).toBeGreaterThan(effect.indexOf("if (!button) return;"));
    expect(effect).not.toMatch(/\bset[A-Z]\w*\(/);
  });
});
```

  - `[contactId]/page.test.ts`, one case beside `:700`: render with `searchParams: Promise.resolve({ document: "0f8fad5b-d9cb-469f-a165-70867728950e", ask: "insurance" })`; the Documents mock's props equal the existing `:700` object PLUS `focus: { documentId: "0f8fad5b-d9cb-469f-a165-70867728950e", ask: "insurance" }` (mutation: never pass focus → FAILS). The existing `:700` case stays byte-identical and passes (no `focus` key without the params).
  - `groups/[groupId]/page.test.ts`: the same one case beside `:287`.
- [ ] **Step 3: Run them to see them fail** (the appended `describe` fails on `indexOf` misses; every existing pin still PASSES: paste that).
- [ ] **Step 4: Implement.**
  - `ExpiryLine`, `ScanStatus`: add `export`.
  - The row's open button (`:203`): add `data-document-open`.
  - `import type { CardFocus } from "@/lib/documents/card-focus";` and `export function askPreset(focus: CardFocus | undefined): RequirableCategory[] { return focus?.ask ? [focus.ask] : []; }`.
  - `DocumentsCard` props gain `focus?: CardFocus` (JSDoc: "S-07 3a: a To-do's link (?document=, ?ask=): the file's row is scrolled to and focused once; Ask the customer opens with its category ticked."). The header's `onAsk: () => openAsk()` becomes `onAsk: () => openAsk(askPreset(focus))`. After the LAST existing effect, add:

```ts
  // S-07 3a (plan deviation 5): a To-do's link names a file. Once the files are read, its row is scrolled to and
  // its open button focused, once; a file not on this card (trashed, or another record's) does nothing.
  const focusId = focus?.documentId ?? null;
  const filesReady = ready !== null;
  const focusedOnce = useRef(false);
  useEffect(() => {
    if (focusedOnce.current || !focusId || !filesReady) return;
    const button = document.querySelector<HTMLButtonElement>(`[data-document-row="${focusId}"] [data-document-open]`);
    if (!button) return;
    focusedOnce.current = true;
    button.scrollIntoView({ block: "center" });
    button.focus({ preventScroll: true });
  }, [focusId, filesReady]);
```

  (`ready` is the container's ready-files value `:836` reads; if its name or type differs, use the container's equivalent boolean and keep both string pins true. `focusId` is a validated uuid from `cardFocusFrom`, so the selector cannot be injected.)
  - `[contactId]/page.tsx`: the `searchParams` type gains `document?: string; ask?: string`; destructure them as `documentParam`, `askParam`; `const focus = cardFocusFrom({ document: documentParam, ask: askParam });`; on the card `{...(focus ? { focus } : {})}`. `groups/[groupId]/page.tsx`: the same.
- [ ] **Step 5: Run** `documents-card.test.ts`, `documents-card-structure.test.ts`, `documents-card-handlers.test.ts`, `[contactId]/page.test.ts`, `groups/[groupId]/page.test.ts`, `styleguide/documents-demo.test.ts`, typecheck, eslint. All PASS.
- [ ] **Step 6: Probes:** (a) `onAsk: () => openAsk()` restored → the structure case FAILS; (b) `focusedOnce.current = true;` moved above `if (!button) return;` → FAILS; (c) the page always passes `focus` (even `undefined`) → the existing `:700` exact-props case FAILS; (d) `askPreset` without the null check → its case FAILS. Paste each.
- [ ] **Step 7: Commit** every path above, message "documents card: a To-do's link focuses its file and pre-ticks Ask the customer (S-07 3a)".

---

## Task 8: The nav entry, its icon, ⌘K (bis-frontend)

**Review:** sonnet. **Runs:** after Task 2.

**Files**
- Modify: `apps/web/src/lib/nav-groups.ts` (+ `nav-groups.test.ts`), `apps/web/src/components/app-sidebar.tsx` (the icon import and one `NAV_ICONS` line), `apps/web/src/lib/palette/registry.ts` (+ `registry.test.ts`)

**Interfaces**
- Consumes: `nav.documents` (Task 2), `palette.settings.requiredDocuments` (`messages.ts:2878`).
- Produces: `NavIconKey` gains `"documents"`; the CRM group is Contacts, Documents, Opportunities; a Technician's CRM group is Contacts, Documents; palette entry `nav:<base>/documents` (derived from the nav) with keywords; a client-Owner-only palette entry `nav:required-documents` → `${base}/documents#required-documents` (Task 10 renders `id="required-documents"`).

- [ ] **Step 1: Read** `nav-groups.ts` whole, `nav-groups.test.ts` whole, `app-sidebar.tsx:1-40, :60-110`, every `src/components/app-sidebar*.test.ts` (any icon or count pin), `registry.ts` whole, `registry.test.ts:1-120, :200-340`.
- [ ] **Step 2: Failing tests.**
  - `nav-groups.test.ts`: the three pins in "Pinned tests this PR changes", plus "Documents sits right after Contacts in CRM for every role, with its own icon (spec 3.1, E2; mutation: append it after Opportunities -> FAILS)": for `(BASE, true, false)`, `(BASE, false, true)`, `(BASE, false, false)`, `(BASE, false, false, true)`, the CRM group's first two items are Contacts, then exactly `{ href: \`${BASE}/documents\`, labelKey: "nav.documents", iconKey: "documents" }`.
  - `registry.test.ts`: (1) "the Documents page is findable by its words in both languages (mutation: no NAV_KEYWORDS entry -> FAILS)": `filterEntries(buildPaletteEntries(BASE, false, false), "vencen")` and `(…, "expiring")` each include the entry with id `` `nav:${BASE}/documents` ``. (2) "a client Owner's Required documents opens the Documents page's card; Staff, a Technician and the agency get no such entry (spec 3.3; mutations: drop the isOwner check -> the Staff case FAILS; point it at settings -> FAILS)": `buildPaletteEntries(BASE, false, true)` contains an entry matching `{ id: "nav:required-documents", href: \`${BASE}/documents#required-documents\`, agencyOnly: false, group: "navigation" }`; `(BASE, false, false)`, `(BASE, false, false, true)` and `(BASE, true, false)` contain no `nav:required-documents`; the agency still has `settings:required-documents`.
- [ ] **Step 3: Run them to see them fail.** Paste one line.
- [ ] **Step 4: Implement.**
  - `nav-groups.ts`: `| "documents"` in `NavIconKey` after `"contacts"`; in the full nav's CRM items, between Contacts and Opportunities:

```ts
        // S-07 3a (spec 3.1, decision E2; DESIGN.md's sidebar pattern amended 2026-10-17): every file on a
        // customer or household, Expiring soon first. Every role, a Technician too (RLS, 0077 + 0068, bounds
        // their rows to assigned customers); the page itself calls requireAccountAccess only.
        { href: `${base}/documents`, labelKey: "nav.documents", iconKey: "documents" },
```

    and the Technician's CRM group becomes `items: [{ href: \`${base}/contacts\`, labelKey: "nav.contacts", iconKey: "contacts" }, { href: \`${base}/documents\`, labelKey: "nav.documents", iconKey: "documents" }]`, its comment's list of what a Technician keeps gaining Documents.
  - `app-sidebar.tsx`: `FolderOpen` in the lucide import; `documents: FolderOpen,` after `contacts: Users,` with the comment "`FolderOpen`, not `FileText`: Forms already has that".
  - `registry.ts`: `NAV_KEYWORDS` gains `"/documents": ["files", "vault", "expiring", "expired", "expiry", "insurance", "permit", "license", "warranty", "documentos", "archivos", "vencen", "vencidos"],`; after the `nav:team` block:

```ts
  // S-07 3a (spec 3.3): a client Owner edits the required-documents list on the Documents page's own card
  // (#required-documents). The agency keeps Settings' card (SETTINGS_SECTIONS); Staff and a Technician get neither.
  if (base && !isAgency && isOwner) {
    entries.push({
      kind: "href", id: "nav:required-documents", label: m["palette.settings.requiredDocuments"], group: "navigation", agencyOnly: false,
      keywords: ["documents", "checklist", "required", "missing", "documentos", "requeridos"],
      href: `${base}/documents#required-documents`,
    });
  }
```
- [ ] **Step 5: Run** `nav-groups.test.ts`, `registry.test.ts`, `src/components/app-sidebar*.test.ts`, `src/components/command-palette.test.ts`, typecheck (A6), eslint. All PASS.
- [ ] **Step 6: Probes:** (a) Documents appended after Opportunities → the placement case FAILS; (b) `NAV_KEYWORDS["/documents"]` removed → the keywords case FAILS; (c) the Owner entry gated on `base && !isAgency` only → the Staff case FAILS. Paste each.
- [ ] **Step 7: Commit** every path above, message "nav: Documents under CRM after Contacts for every role, in the command palette; an Owner's Required documents opens on it (S-07 3a)".

---

## Task 9: The Documents page (bis-frontend)

**Review:** opus. **Runs:** after Tasks 2, 4, 7 and 8.

**Files**
- Create: `apps/web/src/lib/documents/account-list.ts` (+ `account-list.test.ts`)
- Create: `…/documents/page.tsx` (+ `page.test.ts`), `…/documents/loading.tsx`, `…/documents/error.tsx`, `…/documents/documents-list.tsx` (+ `documents-list.test.ts`), `…/documents/category-filter.tsx`
- Modify: `…/acct/technician-guards.test.ts` (one case)

**Interfaces**
- Consumes: `listAccountDocuments`, `countAccountDocuments`, `listPeopleNames`, `AccountDocument`, `AccountDocumentsShow` (`@bis/db`, Task 4); `documentsClock`, `documentView` (`lib/documents/document-view.ts:20, :34`); `encodeCursor`, `parseCursor` (`lib/cursor.ts`); `requestLocale`, `requestPseudoMode` (`lib/i18n/request-locale.ts`); `makeTr` (`lib/record/copy.ts`); `getPersonPrefs`; `requireAccountAccess`; `dbForRequest`; `PageHeader` (`components/page-header.tsx`: `title`, `count`, `actions`, `filters`), `EmptyState` (`icon`, `title`, `body`, `action`, `lang`); `ExpiryLine`, `ScanStatus`, `sourceLine` (`…/contacts/documents-card.tsx`, Task 7); `documentHandlers` (`…/contacts/documents-card-handlers.ts:55`, `{ accountId, locale, reload, reloadRequests }`); `DocumentViewer` (`…/contacts/document-viewer.tsx:187`); `rowScan` (`lib/documents/scan-state.ts:20`); `expiryView`, `expiryText` (`lib/documents/expiry.ts`); keys `documents.page.*` (Task 2).
- Produces:
  - `lib/documents/account-list.ts` (server-side; imports `lib/cursor.ts`): `DOCUMENTS_PAGE_SIZE = 50`; `type DocumentsQuery = { show: AccountDocumentsShow; category: DocumentCategory | null; cursor: { v: string; id: string } | undefined }`; `documentsQuery(sp: { show?: unknown; category?: unknown; before?: unknown }): DocumentsQuery`; `documentsHref(base: string, q: { show: AccountDocumentsShow; category: DocumentCategory | null }, before?: string): string`; `documentsPagerHrefs(base: string, q: DocumentsQuery, hasMore: boolean, last: { id: string; created_at: string; expires_on: string | null } | undefined): { next: string | null; first: string | null }`; `type DocumentsRowView = { doc: DocumentView; filedOn: { name: string; href: string } }`; `filedOnView(accountId: string, d: Pick<AccountDocument, "contact" | "group" | "contact_id" | "client_group_id">, noName: string): { name: string; href: string }`.
  - The page renders `data-documents-page` on its list wrapper and `data-documents-page-row={id}` on each row. Task 10 adds the Required card above the list.

- [ ] **Step 1: Read** `…/contacts/page.tsx` whole (the established pager, header total, empty cold start vs. a cursored zero), `…/contacts/[contactId]/page.tsx:60-135` (the locale wiring), `apps/web/src/app/api/accounts/[accountId]/contacts/[contactId]/documents/route.ts` (the names read and `documentView`), `apps/web/src/components/assign/who-filter.tsx` (the pill links), `…/acct/tasks/loading.tsx`, `…/dashboard/preferences/error.tsx`, `documents-card.tsx:157-300` (the row's look and the stretched button), `document-viewer.tsx:187-240`, `lib/cursor.ts:1-80`, `…/contacts/page.test.ts:1-80` (how a server page is rendered in vitest here), `technician-guards.test.ts`.
- [ ] **Step 2: Failing tests.**
  - `apps/web/src/lib/documents/account-list.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { encodeCursor } from "@/lib/cursor";
import { documentsQuery, documentsHref, documentsPagerHrefs, filedOnView } from "./account-list";

const ID = "0f8fad5b-d9cb-469f-a165-70867728950e";
const BASE = "/dashboard/accounts/a1/documents";

describe("documentsQuery: the URL is hand-editable, so anything odd is the default (spec 3.1)", () => {
  it("Expiring soon by default; expired and all are kept; anything else is the default (mutation: default all -> FAILS)", () => {
    expect(documentsQuery({}).show).toBe("expiring");
    expect(documentsQuery({ show: "expired" }).show).toBe("expired");
    expect(documentsQuery({ show: "all" }).show).toBe("all");
    expect(documentsQuery({ show: "bogus" }).show).toBe("expiring");
    expect(documentsQuery({ show: ["all"] }).show).toBe("expiring");
  });
  it("a category is one of the nine or nothing", () => {
    expect(documentsQuery({ category: "insurance" }).category).toBe("insurance");
    expect(documentsQuery({ category: "other" }).category).toBe("other");
    expect(documentsQuery({ category: "receipt" }).category).toBeNull();
  });
  it("a cursor must fit its list: a day for the expiry lists, an instant for All (mutation: accept any cursor -> FAILS)", () => {
    const day = encodeCursor({ v: "2026-11-01", id: ID });
    const instant = encodeCursor({ v: "2026-10-17T10:00:00.000Z", id: ID });
    expect(documentsQuery({ before: day }).cursor).toEqual({ v: "2026-11-01", id: ID });
    expect(documentsQuery({ show: "all", before: day }).cursor).toBeUndefined();
    expect(documentsQuery({ show: "all", before: instant }).cursor).toEqual({ v: "2026-10-17T10:00:00.000Z", id: ID });
    expect(documentsQuery({ show: "expired", before: instant }).cursor).toBeUndefined();
    expect(documentsQuery({ before: encodeCursor({ v: null, id: ID }) }).cursor).toBeUndefined();
    expect(documentsQuery({ before: "not-base64" }).cursor).toBeUndefined();
  });
});

describe("documentsHref and the one pager", () => {
  it("writes the filter, the category and the cursor in the URL (spec 3.1)", () => {
    expect(documentsHref(BASE, { show: "expired", category: "insurance" }, "abc")).toBe(`${BASE}?show=expired&category=insurance&before=abc`);
    expect(documentsHref(BASE, { show: "expiring", category: null })).toBe(`${BASE}?show=expiring`);
  });
  it("Next carries the LAST row's sort key and id; the start link only once paged (mutation: build Next from created_at on an expiry list -> FAILS)", () => {
    const q = documentsQuery({ show: "expiring" });
    const last = { id: ID, created_at: "2026-10-01T00:00:00.000Z", expires_on: "2026-11-05" };
    expect(documentsPagerHrefs(BASE, q, true, last)).toEqual({ next: `${BASE}?show=expiring&before=${encodeCursor({ v: "2026-11-05", id: ID })}`, first: null });
    const all = documentsQuery({ show: "all" });
    expect(documentsPagerHrefs(BASE, all, true, last).next).toBe(`${BASE}?show=all&before=${encodeCursor({ v: "2026-10-01T00:00:00.000Z", id: ID })}`);
    expect(documentsPagerHrefs(BASE, q, false, last).next).toBeNull();
    const paged = documentsQuery({ show: "expiring", before: encodeCursor({ v: "2026-11-01", id: ID }) });
    expect(documentsPagerHrefs(BASE, paged, false, last).first).toBe(`${BASE}?show=expiring`);
  });
});

describe("filedOnView: the customer's or household's name, linking to its record", () => {
  it("a customer, a household, and a customer with no name (mutation: link a household's file to a contact -> FAILS)", () => {
    expect(filedOnView("a1", { contact: { id: "c1", first_name: "Ana", last_name: "García" }, group: null, contact_id: "c1", client_group_id: null }, "No name"))
      .toEqual({ name: "Ana García", href: "/dashboard/accounts/a1/contacts/c1" });
    expect(filedOnView("a1", { contact: null, group: { id: "g1", name: "Casa García", kind: "household" }, contact_id: null, client_group_id: "g1" }, "No name"))
      .toEqual({ name: "Casa García", href: "/dashboard/accounts/a1/groups/g1" });
    expect(filedOnView("a1", { contact: { id: "c1", first_name: null, last_name: " " }, group: null, contact_id: "c1", client_group_id: null }, "Sin nombre"))
      .toEqual({ name: "Sin nombre", href: "/dashboard/accounts/a1/contacts/c1" });
  });
});
```

  - `…/documents/documents-list.test.ts` (`renderToStaticMarkup`, `renderedText`; mock `next/navigation` (`useRouter: () => ({ refresh: vi.fn(), push: vi.fn() })`) and every `"use server"` module the list reaches through `documents-card.tsx`, `document-viewer.tsx` and `documents-card-handlers.ts`: `../contacts/documents-actions`, `../contacts/document-requests-actions`, `../contacts/document-requirements-actions`, each as `documents-card.test.ts:5-13` does). Fixture: three `DocumentsRowView`s built with a small `doc()` helper (`DocumentView` fields as `documents-load.ts:20-30` declares): A insurance, clean, `expiresOn` 12 days after `TODAY`, on "Ana García"; B permit, clean, expired 3 days before `TODAY`; C photo, `version.scan: "pending"`, no expiry, Owners only, on household "Casa García". Cases:
    1. Three `data-documents-page-row`; each row's filed-on `<a>` has the record href and is NOT inside the row's `<button>` (assert `/<button[^>]*data-document-open[^>]*>(?:(?!<\/button>)[\s\S])*<a\s/` does NOT match; mutation: put the link inside the button → FAILS).
    2. A reads "Expires in 12 days" with `data-expiry-dot`; B "Expired 3 days ago" with a `--crit` dot (rule 3; mutation: drop the dot → FAILS on the attribute).
    3. C carries `data-document-scan="pending"` and "Owners only"; A carries no `data-document-scan`.
    4. No `type="checkbox"`, no `role="checkbox"` (rule 4: no bulk actions) and no `data-variant="default"` (rule 8: the list has no primary).
    5. Spanish (`locale: "es"`): "Vence en 12 días", "Venció hace 3 días", "Seguro", "Solo dueños" (read `documents.ownersOnly.es` and use its literal), each against the literal.
  - `…/documents/page.test.ts`: mock `@bis/db` as `async (importOriginal) => ({ ...(await importOriginal<object>()), listAccountDocuments, countAccountDocuments, listPeopleNames })` (the page also imports `DOCUMENT_CATEGORIES`, which must stay real; Task 10 adds `getRequiredDocumentCategories` to the overrides), `@/lib/auth` (`requireAccountAccess` → `{ userId: "u1", isAgency: false, role: "owner", canManage: true }`), `@/lib/db` (`dbForRequest` → a fake whose `from("accounts").select().eq().maybeSingle()` answers `{ data: { language: null }, error: null }`), `@/lib/preferences/person-prefs` (`getPersonPrefs` → `{ language: null }`), `@/lib/documents/document-view` (`documentsClock` → `{ today: "2026-10-17", zone: "America/Chicago" }`; `documentView` from `vi.importActual`), and `./documents-list` and `./category-filter` as `createElement("div", { "data-…-mock": JSON.stringify(p) })` (the contact page test's shape). Render with `renderToStaticMarkup(await DocumentsPage({ params: Promise.resolve({ accountId: "a1" }), searchParams: Promise.resolve({...}) }))`. Cases:
    1. Default: `listAccountDocuments` called with `(db, "a1", { show: "expiring", category: null, today: "2026-10-17" }, { before: undefined, limit: 51 })`; `countAccountDocuments` with the same filter; with 2 rows and a count of 7 the header reads "7 files" (the REAL total; mutation: count = rows.length → "2 files" → FAILS).
    2. The count throws → the page rejects (the error boundary shows; mutation: `.catch(() => 0)` → FAILS).
    3. 51 rows → the list mock gets 50 rows and the page has a "Next" link whose href carries `before=`; no "Back to the start" without a cursor; exactly ONE pager (`data-documents-pager` once).
    4. Empty cold start, each filter: expiring → "Nothing expires in the next 30 days." and its body; expired → "Nothing has expired."; all → "Files you upload to a customer or household show up here." and "Open a customer and use Documents to add one." A cursored empty page shows the start link and NO empty state.
    5. The show pills: three links with `aria-current="page"` on the current one only; `?show=expired` marks Expired.
    6. Spanish (`prefs.language: "es"`): "Documentos", "Vencen pronto", "7 archivos".
    7. No `data-hero` anywhere (rule 11).
  - `technician-guards.test.ts`: "the Documents page admits a Technician: it never calls requireNotTechnician, and it does call requireAccountAccess (spec 3.1; RLS bounds the rows) (mutation: add requireNotTechnician(accountId) -> FAILS)": `read("documents/page.tsx")` `not.toContain("requireNotTechnician")` and `toContain("requireAccountAccess(accountId)")`.
- [ ] **Step 3: Run them to see them fail.** Paste one line each.
- [ ] **Step 4: Implement.**
  - `apps/web/src/lib/documents/account-list.ts`:

```ts
import { isDocumentCategory, type DocumentCategory } from "@bis/db/document-rules";
import type { AccountDocument, AccountDocumentsShow } from "@bis/db";
import type { DocumentView } from "@/lib/documents/documents-load";
import { encodeCursor, parseCursor } from "@/lib/cursor";

/**
 * The Documents page's URL and pager (S-07 3a, spec 3.1). Server-side (lib/cursor.ts uses Buffer). Every
 * parameter is hand-editable, so anything that does not fit reads as the default, never a throw: `show`
 * defaults to Expiring soon, a category must be one of the nine, and a cursor must fit its list (a day
 * for the two expiry lists, an instant for All). One pager: Next carries the last row's (sort key, id);
 * Back to the start drops the cursor (plan deviation 8).
 */
export const DOCUMENTS_PAGE_SIZE = 50;
export type DocumentsQuery = { show: AccountDocumentsShow; category: DocumentCategory | null; cursor: { v: string; id: string } | undefined };
export type DocumentsRowView = { doc: DocumentView; filedOn: { name: string; href: string } };
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const INSTANT = /^\d{4}-\d{2}-\d{2}T/;

export function documentsQuery(sp: { show?: unknown; category?: unknown; before?: unknown }): DocumentsQuery {
  const show: AccountDocumentsShow = sp.show === "expired" || sp.show === "all" ? sp.show : "expiring";
  const category = typeof sp.category === "string" && isDocumentCategory(sp.category) ? sp.category : null;
  const parsed = parseCursor(typeof sp.before === "string" ? sp.before : undefined);
  const v = parsed?.v;
  const fits = typeof v === "string" && (show === "all" ? INSTANT.test(v) && !Number.isNaN(Date.parse(v)) : DAY.test(v));
  return { show, category, cursor: fits && parsed ? { v, id: parsed.id } : undefined };
}

export function documentsHref(base: string, q: { show: AccountDocumentsShow; category: DocumentCategory | null }, before?: string): string {
  const p = new URLSearchParams({ show: q.show });
  if (q.category) p.set("category", q.category);
  if (before) p.set("before", before);
  return `${base}?${p}`;
}

export function documentsPagerHrefs(
  base: string, q: DocumentsQuery, hasMore: boolean, last: { id: string; created_at: string; expires_on: string | null } | undefined,
): { next: string | null; first: string | null } {
  const v = last ? (q.show === "all" ? last.created_at : last.expires_on) : null;
  return {
    next: hasMore && last && v ? documentsHref(base, q, encodeCursor({ v, id: last.id })) : null,
    first: q.cursor ? documentsHref(base, q) : null,
  };
}

export function filedOnView(
  accountId: string, d: Pick<AccountDocument, "contact" | "group" | "contact_id" | "client_group_id">, noName: string,
): { name: string; href: string } {
  const base = `/dashboard/accounts/${accountId}`;
  if (d.client_group_id) return { name: d.group?.name?.trim() || noName, href: `${base}/groups/${d.client_group_id}` };
  const name = [d.contact?.first_name, d.contact?.last_name].map((s) => s?.trim()).filter(Boolean).join(" ");
  return { name: name || noName, href: `${base}/contacts/${d.contact_id}` };
}
```

  - `…/documents/page.tsx`:

```tsx
import Link from "next/link";
import { FolderOpen, ArrowLeft, ArrowRight } from "lucide-react";
import { countAccountDocuments, listAccountDocuments, listPeopleNames, DOCUMENT_CATEGORIES, type DocumentCategory, type AccountDocumentsShow } from "@bis/db";
import { requireAccountAccess } from "@/lib/auth";
import { dbForRequest } from "@/lib/db";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { getPersonPrefs } from "@/lib/preferences/person-prefs";
import { requestLocale, requestPseudoMode } from "@/lib/i18n/request-locale";
import type { Locale } from "@/lib/i18n/locale";
import type { MessageKey } from "@/lib/messages";
import { makeTr } from "@/lib/record/copy";
import { documentsClock, documentView } from "@/lib/documents/document-view";
import { loggableError } from "@/lib/loggable-error";
import {
  DOCUMENTS_PAGE_SIZE, documentsQuery, documentsHref, documentsPagerHrefs, filedOnView, type DocumentsRowView,
} from "@/lib/documents/account-list";
import { DocumentsList } from "./documents-list";
import { CategoryFilter } from "./category-filter";

/**
 * The account-wide Documents page (S-07 3a, spec 3.1; DESIGN.md's sidebar and module contract amended
 * 2026-10-17). Every role: requireAccountAccess only, and every read on the REQUEST client, so 0077's RLS
 * decides each row (a Technician sees assigned customers' files; Owners-only files only Owners and the
 * agency). Server-side filter, sort and cursor paging; the header states the REAL total for the filter (a
 * null count throws to error.tsx, never "0"). No hero (rule 11), no checkboxes (rule 4), no primary (rule 8).
 */
const SHOWS: AccountDocumentsShow[] = ["expiring", "expired", "all"];
const EMPTY: Record<AccountDocumentsShow, { title: MessageKey; body?: MessageKey }> = {
  expiring: { title: "documents.page.empty.expiring", body: "documents.page.empty.expiringBody" },
  expired: { title: "documents.page.empty.expired" },
  all: { title: "documents.page.empty.all", body: "documents.page.empty.allBody" },
};

export default async function DocumentsPage({ params, searchParams }: {
  params: Promise<{ accountId: string }>;
  searchParams: Promise<{ show?: string; category?: string; before?: string; locale?: string }>;
}) {
  const { accountId } = await params;
  const sp = await searchParams;
  const access = await requireAccountAccess(accountId);
  const db = await dbForRequest(); // RLS-scoped: NEVER serviceDb here
  const q = documentsQuery(sp);
  const [prefs, account, clock] = await Promise.all([
    getPersonPrefs(),
    db.from("accounts").select("language").eq("id", accountId).maybeSingle(),
    documentsClock(db, accountId),
  ]);
  if (account.error) console.error(`documents page: account ${accountId} language read failed: ${account.error.message}`);
  // A named variable, not an inline literal: request-locale-callers.test.ts scans each call's braces.
  const accountLanguage = { language: (account.data as { language: Locale | null } | null)?.language ?? null };
  const locale = requestLocale({ account: accountLanguage, isOperator: access.isAgency, userLanguage: prefs.language }, { locale: sp.locale });
  const tr = makeTr(locale, requestPseudoMode({ locale: sp.locale }));
  const filter = { show: q.show, category: q.category, today: clock.today };
  const [rows, total] = await Promise.all([
    listAccountDocuments(db, accountId, filter, { before: q.cursor, limit: DOCUMENTS_PAGE_SIZE + 1 }),
    countAccountDocuments(db, accountId, filter),
  ]);
  const hasMore = rows.length > DOCUMENTS_PAGE_SIZE;
  const page = hasMore ? rows.slice(0, DOCUMENTS_PAGE_SIZE) : rows;
  const names = await listPeopleNames(db, [...new Set(page.map((d) => d.created_by))]).catch((e: unknown) => {
    console.error(`documents page names (account ${accountId}): ${loggableError(e)}`);
    return {} as Record<string, string>;
  });
  const base = `/dashboard/accounts/${accountId}/documents`;
  const views: DocumentsRowView[] = page.map((d) => ({
    doc: documentView(d, access.userId, names, clock.zone),
    filedOn: filedOnView(accountId, d, tr.text("documents.page.noName")),
  }));
  const pager = documentsPagerHrefs(base, q, hasMore, page[page.length - 1]);
  const categories = [
    { value: "", label: tr.text("documents.page.category.any"), href: documentsHref(base, { show: q.show, category: null }) },
    ...DOCUMENT_CATEGORIES.map((c: DocumentCategory) => ({
      value: c, label: tr.text(`documents.category.${c}` as MessageKey), href: documentsHref(base, { show: q.show, category: c }),
    })),
  ];
  const empty = EMPTY[q.show];

  return (
    <div lang={locale}>
      <PageHeader
        title={tr.text("documents.page.title")}
        count={tr.count("documents.page.count", total)}
        filters={
          <div className="flex min-w-0 flex-wrap items-center gap-3">
            <nav aria-label={tr.text("documents.page.show.label")} className="flex min-w-0 flex-wrap items-center gap-1">
              {SHOWS.map((s) => (
                <Link key={s} href={documentsHref(base, { show: s, category: q.category })} aria-current={q.show === s ? "page" : undefined}
                  className={cn(
                    "inline-flex min-h-11 items-center rounded-full px-3 text-sm whitespace-nowrap transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none md:min-h-8",
                    q.show === s ? "bg-[var(--accent-dim)] font-medium text-foreground" : "text-muted-foreground hover:bg-[var(--surface-3)] hover:text-foreground",
                  )}>
                  {tr.text(`documents.page.show.${s}` as MessageKey)}
                </Link>
              ))}
            </nav>
            <CategoryFilter label={tr.text("documents.page.category.label")} current={q.category ?? ""} options={categories} />
          </div>
        }
      />
      <div className="space-y-4 p-6">
        {page.length === 0 && !q.cursor ? (
          <EmptyState icon={FolderOpen} title={tr.text(empty.title)} body={empty.body ? tr.text(empty.body) : undefined} />
        ) : (
          <DocumentsList accountId={accountId} locale={locale} today={clock.today} now={new Date().toISOString()} rows={views} />
        )}
        {pager.next || pager.first ? (
          <div data-documents-pager className="flex items-center justify-between">
            <div>
              {pager.first ? (
                <Link href={pager.first} className={cn(buttonVariants({ variant: "outline", size: "sm" }), "min-h-11 md:min-h-8")}>
                  <ArrowLeft className="size-3.5" aria-hidden />{tr.text("documents.page.first")}
                </Link>
              ) : null}
            </div>
            <div>
              {pager.next ? (
                <Link href={pager.next} className={cn(buttonVariants({ variant: "outline", size: "sm" }), "min-h-11 md:min-h-8")}>
                  {tr.text("documents.page.next")}<ArrowRight className="size-3.5" aria-hidden />
                </Link>
              ) : null}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
```

  (`DOCUMENT_CATEGORIES`, `DocumentCategory` are on the barrel (`index.ts:303-306`). If `PageHeader` does not render `count` beside the title as the contacts page shows it, read `page-header.tsx` and follow it. "outline" is the contacts pager's variant (`…/contacts/page.tsx:296-302`), not a primary.)
  - `…/documents/category-filter.tsx` (`"use client"`; options are built on the server, so nothing here parses a URL):

```tsx
"use client";

import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";

/** The page's category select (spec 3.1): a change navigates to the server-built href for that choice; a filter change drops the cursor. */
export function CategoryFilter({ label, current, options }: {
  label: string; current: string; options: { value: string; label: string; href: string }[];
}) {
  const router = useRouter();
  return (
    <label className="flex items-center gap-2 text-sm text-muted-foreground">
      <span>{label}</span>
      <select value={current} onChange={(e) => { const o = options.find((x) => x.value === e.target.value); if (o) router.push(o.href); }}
        className={cn("min-h-11 rounded-[var(--radius-ctl)] border border-[var(--line-strong)] bg-[var(--surface-2)] px-2 text-sm text-foreground md:min-h-8",
          "outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50")}>
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </label>
  );
}
```

  - `…/documents/documents-list.tsx` (`"use client"`):

```tsx
"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FileText, Lock } from "lucide-react";
import type { Locale } from "@/lib/i18n/locale";
import { t } from "@/lib/i18n/t";
import { m, type MessageKey } from "@/lib/messages";
import { cn } from "@/lib/utils";
import { expiryView, expiryText } from "@/lib/documents/expiry";
import { rowScan } from "@/lib/documents/scan-state";
import type { DocumentsRowView } from "@/lib/documents/account-list";
import { DocumentViewer } from "../contacts/document-viewer";
import { ExpiryLine, ScanStatus, addedWhen, sourceLine } from "../contacts/documents-card";
import { documentHandlers } from "../contacts/documents-card-handlers";

/**
 * The Documents page's rows (spec 3.1). The WHOLE row opens the existing viewer (rule 4: the open
 * button's ::after is stretched over the row, its ring is the row's); the filed-on name is its own link
 * and focus target, raised above that overlay. --surface-3 hover. No checkboxes: no bulk actions here.
 * A row is a dot AND a word for expiry and scan state (rule 3), the card's own ExpiryLine/ScanStatus.
 */
export function DocumentsList({ accountId, locale, today, now, rows }: {
  accountId: string; locale: Locale; today: string; now: string; rows: DocumentsRowView[];
}) {
  const router = useRouter();
  const [openId, setOpenId] = useState<string | null>(null);
  const tt = (key: MessageKey, params?: Record<string, string | number>) => t(m, key, locale, params);
  const handlers = documentHandlers({ accountId, locale, reload: () => router.refresh(), reloadRequests: () => {} });
  const open = rows.find((r) => r.doc.id === openId)?.doc ?? null;
  const openExpiry = open ? expiryView(open.expiresOn, today) : null;
  return (
    <>
      <ul data-documents-page className="overflow-hidden rounded-[var(--radius-card)] border border-[var(--line)] bg-card">
        {rows.map(({ doc, filedOn }) => (
          <li key={doc.id} data-documents-page-row={doc.id}
            className="relative flex items-start gap-3 border-t border-[var(--row-line)] px-4 py-3 first:border-t-0 hover:bg-[var(--surface-3)] motion-safe:transition-colors motion-safe:duration-150">
            <FileText aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
            <button type="button" data-document-open onClick={() => setOpenId(doc.id)} aria-label={tt("documents.open", { title: doc.title })}
              className={cn("min-w-0 flex-1 text-left outline-none", "after:absolute after:inset-0 after:content-['']",
                "focus-visible:after:ring-[3px] focus-visible:after:ring-ring/50")}>
              <span lang="" className="block truncate text-sm font-medium text-card-foreground">{doc.title}</span>
              <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
                <span>{tt(`documents.category.${doc.category}` as MessageKey)}</span>
                <ScanStatus scan={rowScan(doc, now)} locale={locale} />
                <ExpiryLine expiresOn={doc.expiresOn} today={today} locale={locale} />
                <span>{sourceLine(doc, today, locale)}</span>
                {doc.ownersOnly ? (
                  <span data-owners-only className="inline-flex items-center gap-1"><Lock aria-hidden="true" className="size-3" />{tt("documents.ownersOnly")}</span>
                ) : null}
              </span>
            </button>
            <Link href={filedOn.href} aria-label={tt("documents.page.openRecord", { name: filedOn.name })}
              className="relative z-10 inline-flex min-h-11 shrink-0 items-center rounded-[var(--radius-ctl)] px-1 text-sm text-foreground underline-offset-4 outline-none hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/50 md:min-h-8">
              {filedOn.name}
            </Link>
          </li>
        ))}
      </ul>
      <DocumentViewer accountId={accountId} doc={open} locale={locale} onClose={() => setOpenId(null)}
        onDownload={(d) => void handlers.download(d)}
        onDownloadVersion={(d, versionId) => void handlers.download(d, versionId)}
        versionWhen={(day) => addedWhen(day, today, locale)}
        header={{ source: open ? sourceLine(open, today, locale) : "", expiry: openExpiry ? expiryText(openExpiry, locale) : null }} />
    </>
  );
}
```

  (`addedWhen` and `sourceLine` are already exported from `documents-card.tsx:69, :79`. If `ExpiryLine`/`ScanStatus`'s prop names differ from Task 7's export, use the exported ones.)
  - `…/documents/loading.tsx`: `tasks/loading.tsx`' shape: a header block, then a bordered `rounded-[var(--radius-card)]` list of five rows, each an icon square, a title bar (`w-2/3`, the third `w-1/2`) and a fact line (`w-5/6`), `aria-busy="true"` with an English `aria-label="Loading"` as the house's other loading files do (no visible copy, no spinner, nothing pulses beyond the Skeleton's own).
  - `…/documents/error.tsx`: `preferences/error.tsx`' shape with `data-documents-page-error`, `title={t(m, "documents.page.title", locale)}`, `body={t(m, "documents.page.loadFailed", locale)}`, and a ghost Retry (`documents.retry`) that runs `startTransition(() => { router.refresh(); reset(); })`; `console.error(error)` in its effect (the raw message never reaches the screen).
  - `technician-guards.test.ts`: the case from Step 2.
- [ ] **Step 5: Run** `account-list.test.ts`, `documents-list.test.ts`, `…/documents/page.test.ts`, `technician-guards.test.ts`, `src/lib/i18n/request-locale-callers.test.ts`, `…/acct/in-account-service-reads.test.ts` (the page has no service client), `src/components/ui/material.test.ts`, `src/lib/i18n/ratchet.test.ts`, typecheck, eslint. All PASS.
- [ ] **Step 6: Probes:** (a) `count={tr.count("documents.page.count", page.length)}` → the real-total case FAILS; (b) Next built from `created_at` on every list → the account-list pager case FAILS; (c) the filed-on `<Link>` moved inside the `<button>` → the list case FAILS; (d) `requireNotTechnician(accountId)` added → the technician case FAILS; (e) `documentsQuery` accepting any cursor → its cursor case FAILS. Paste each.
- [ ] **Step 7: Commit** every path above, message "documents page: every file on a customer or household, Expiring soon first, filtered and paged on the server with a real total (S-07 3a)".

---

## Task 10: The Required documents card on the page; `/styleguide` (bis-frontend)

**Review:** sonnet. **Runs:** after Tasks 2, 4 and 9.

**Files**
- Create: `…/documents/required-documents-summary.tsx` (+ `required-documents-summary.test.ts`), `…/documents/required-documents-handlers.ts` (+ `required-documents-handlers.test.ts`)
- Modify: `…/documents/page.tsx` (the read and the mount) (+ two `page.test.ts` cases)
- Create: `apps/web/src/app/(dashboard)/dashboard/styleguide/documents-page-demo.tsx` (+ `documents-page-demo.test.ts`); Modify: `…/styleguide/page.tsx` (one import, one mount after `<DocumentsDemo />`, `:270`)

**Interfaces**
- Consumes: `setRequiredDocumentCategoriesAction` (`…/acct/settings/document-requirements-actions.ts`, `(accountId, formData) => Promise<{ ok: true; list: string[] } | { ok: false; error: string }>`); `undoRequiredDocumentsAction`, `RequiredUndoAnswer` (Task 4); `requiredFormEntries` (`…/acct/settings/required-documents-card.tsx:26`); `getRequiredDocumentCategories` (`@bis/db`); `REQUIRABLE_DOCUMENT_CATEGORIES`, `cleanRequiredCategories`, `RequirableCategory` (`@bis/db/document-rules`); keys `documents.required.*`, `settings.requiredDocuments.title|body|off|saved|savedOff`, `common.save`, `common.undo` (Task 2 / existing).
- Produces: `RequiredDocumentsSummary({ required, locale, save, undo }: { required: RequirableCategory[] | null; locale: Locale; save: (formData: FormData) => Promise<{ ok: true; list: string[] } | { ok: false; error: string }>; undo: (expected: string[], previous: string[]) => Promise<RequiredUndoAnswer> })` with root `id="required-documents"` and `data-required-documents`; `requiredSummaryText(list: readonly RequirableCategory[], locale: Locale): string`; `requiredListHandlers({ locale, save, undo, onChange }): { submit(formData: FormData, before: RequirableCategory[]): Promise<void> }`.

- [ ] **Step 1: Read** `…/acct/settings/required-documents-card.tsx` whole (the pattern: `useFormSubmit`, hidden inputs from `requiredFormEntries`, one `SubmitButton`), `…/acct/submit-button.tsx`, `apps/web/src/lib/forms/use-form-submit.ts`, `…/contacts/document-checklist-handlers.ts:1-60` (the toast-with-Undo shape), `components/ui/checkbox.tsx`, `components/ui/card.tsx`, `styleguide/documents-demo.tsx` and its test, `styleguide/page.tsx:40-60, :260-280`.
- [ ] **Step 2: Failing tests.**
  - `required-documents-handlers.test.ts` (mock `sonner` as `{ toast: { success: vi.fn(), error: vi.fn() } }`):
    1. `submit(fd, ["id"])` with `save` answering `{ ok: true, list: ["id", "insurance"] }`: `onChange` called with `["id", "insurance"]`; `toast.success` called with "Saved. Each customer's Documents card shows the list." and `{ action: { label: "Undo", onClick } }`; calling `onClick` then awaiting a tick calls `undo(["id", "insurance"], ["id"])` (mutation: swap the arguments → FAILS), then `onChange(["id"])` and `toast.success("Put back the list you had.")`.
    2. An Undo answering `{ ok: false, error: "documents.required.changed" }` → `toast.error("Someone changed the list since. Reload the page to see it.")`, `onChange` not called again.
    3. `save` answering `{ ok: false, error: "anything in English" }` → `toast.error("Couldn't save the list. Try again.")` (its own words, deviation 11) and `onChange` never called; `save` throwing → `toast.error("That didn't finish. This page may be out of date: reload it and try again.")`.
    4. An empty saved list → "Saved. The list is off."
    5. Spanish: "Guardado. La tarjeta de Documentos de cada cliente muestra la lista." with the action label "Deshacer"; the crash sentence "Eso no se completó. Puede que esta página esté desactualizada: vuelva a cargarla e intente de nuevo." (literals; never `common.actionCrashed`).
  - `required-documents-summary.test.ts` (`renderToStaticMarkup`, `renderedText`; mock `sonner`):
    1. `required: ["id", "insurance"]` → `id="required-documents"`, a `<details>` whose `<summary>` reads "Required for every customer: ID, Insurance (2)" (spec 3.3's example; mutation: the stored order reversed → FAILS); Spanish "Requeridos para cada cliente: Identificación, Seguro (2)".
    2. Eight `role="checkbox"` (the eight requirable; no "Other"), ID and Insurance `data-state="checked"`; exactly ONE `data-variant="default"` (Save; rule 8; mutation: a second primary → FAILS).
    3. `required: []` → the summary reads "Nothing is required for every customer yet."
    4. `required: null` → "Couldn't load the required list.", no checkbox, no `data-variant="default"` (it fails on its own, rule 5; mutation: draw the picker → FAILS).
  - `…/documents/page.test.ts`, two cases: (1) an Owner (`canManage: true`) gets the summary mock with `required` equal to what `getRequiredDocumentCategories` answered, and it renders BEFORE `data-documents-page`/the empty state; (2) a Staff member (`role: "staff", canManage: false`) gets no summary and `getRequiredDocumentCategories` is never called (mutation: render it for everyone → FAILS). Mock `./required-documents-summary` as the others are.
  - `documents-page-demo.test.ts`: `data-required-documents` occurs 4 times (English partial, Spanish partial, off, failed) and `data-documents-page-row` 3 times; every `data-required-documents` block has at most one `data-variant="default"`.
- [ ] **Step 3: Run them to see them fail.**
- [ ] **Step 4: Implement.**
  - `required-documents-handlers.ts`:

```ts
import { toast } from "sonner";
import { cleanRequiredCategories, type RequirableCategory } from "@bis/db/document-rules";
import type { Locale } from "@/lib/i18n/locale";
import { t } from "@/lib/i18n/t";
import { m, type MessageKey } from "@/lib/messages";
import type { RequiredUndoAnswer } from "./required-documents-actions";

/**
 * What the Owner card's Save does (S-07 3a, spec 3.3; rule 6: at once, Undo in the toast). The save is 2c's
 * action (it admits an Owner); its English `error` is not shown (plan deviation 11): the card says its own
 * words in the reader's language. The Undo is a compare-and-set (plan deviation 9): it restores `before`
 * only while the stored list is still what this save wrote.
 */
type SaveAnswer = { ok: true; list: string[] } | { ok: false; error: string };

export function requiredListHandlers({ locale, save, undo, onChange }: {
  locale: Locale;
  save: (formData: FormData) => Promise<SaveAnswer>;
  undo: (expected: string[], previous: string[]) => Promise<RequiredUndoAnswer>;
  onChange: (list: RequirableCategory[]) => void;
}): { submit(formData: FormData, before: RequirableCategory[]): Promise<void> } {
  const tt = (key: MessageKey) => t(m, key, locale);
  return {
    async submit(formData, before) {
      let r: SaveAnswer;
      try { r = await save(formData); } catch { toast.error(tt("documents.required.crashed")); return; }
      if (!r.ok) { toast.error(tt("documents.required.failed")); return; }
      const after = cleanRequiredCategories(r.list) ?? [];
      onChange(after);
      toast.success(tt(after.length === 0 ? "settings.requiredDocuments.savedOff" : "settings.requiredDocuments.saved"), {
        action: { label: tt("common.undo"), onClick: () => {
          void (async () => {
            let u: RequiredUndoAnswer;
            try { u = await undo(after, before); } catch { toast.error(tt("documents.required.crashed")); return; }
            if (u.ok) { onChange(before); toast.success(tt("documents.required.restored")); } else toast.error(tt(u.error));
          })();
        } },
      });
    },
  };
}
```

  - `required-documents-summary.tsx` (`"use client"`):

```tsx
"use client";

import { useState } from "react";
import { REQUIRABLE_DOCUMENT_CATEGORIES, type RequirableCategory } from "@bis/db/document-rules";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { SubmitButton } from "../../submit-button";
import { useFormSubmit } from "@/lib/forms/use-form-submit";
import type { Locale } from "@/lib/i18n/locale";
import { t } from "@/lib/i18n/t";
import { m, type MessageKey } from "@/lib/messages";
import { requiredFormEntries } from "../settings/required-documents-card";
import { requiredListHandlers } from "./required-documents-handlers";
import type { RequiredUndoAnswer } from "./required-documents-actions";

/**
 * The Owner's Required documents card (S-07 3a, spec 3.3): at the top of the Documents page for an Owner
 * and the agency. A collapsed summary line that opens into 2c's eight-category picker. Its own view (rule
 * 8): one primary Save, its own toast and Undo. A failed read draws one sentence and no picker (rule 5).
 */
export function requiredSummaryText(list: readonly RequirableCategory[], locale: Locale): string {
  if (list.length === 0) return t(m, "documents.required.summaryOff", locale);
  const names = list.map((c) => t(m, `documents.category.${c}` as MessageKey, locale)).join(", ");
  return t(m, "documents.required.summary", locale, { list: names, count: list.length });
}

export function RequiredDocumentsSummary({ required, locale, save, undo }: {
  required: RequirableCategory[] | null; locale: Locale;
  save: (formData: FormData) => Promise<{ ok: true; list: string[] } | { ok: false; error: string }>;
  undo: (expected: string[], previous: string[]) => Promise<RequiredUndoAnswer>;
}) {
  const [saved, setSaved] = useState<RequirableCategory[]>(required ?? []);
  const [picked, setPicked] = useState<Set<RequirableCategory>>(() => new Set(required ?? []));
  const handlers = requiredListHandlers({ locale, save, undo, onChange: (list) => { setSaved(list); setPicked(new Set(list)); } });
  const { pending, onSubmit } = useFormSubmit((formData) => handlers.submit(formData, saved));
  const tt = (key: MessageKey) => t(m, key, locale);
  if (required === null) {
    return (
      <Card id="required-documents" data-required-documents className="scroll-mt-24">
        <CardContent><p role="alert" className="text-sm text-muted-foreground">{tt("documents.required.loadFailed")}</p></CardContent>
      </Card>
    );
  }
  return (
    <Card id="required-documents" data-required-documents className="scroll-mt-24">
      <CardContent>
        <details>
          <summary className="min-h-11 cursor-pointer rounded-[var(--radius-ctl)] py-2 text-sm font-medium text-foreground outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 md:min-h-8">
            {requiredSummaryText(saved, locale)}
          </summary>
          <form onSubmit={onSubmit} className="mt-3 flex flex-col gap-4">
            <p className="text-sm text-muted-foreground">{tt("settings.requiredDocuments.body")}</p>
            <div className="grid gap-2 sm:grid-cols-2">
              {REQUIRABLE_DOCUMENT_CATEGORIES.map((c) => (
                <label key={c} className="flex min-h-11 items-center gap-2 text-sm md:min-h-8">
                  <Checkbox checked={picked.has(c)} onCheckedChange={(v) => setPicked((prev) => {
                    const next = new Set(prev); if (v === true) next.add(c); else next.delete(c); return next;
                  })} />
                  {tt(`documents.category.${c}` as MessageKey)}
                </label>
              ))}
            </div>
            {requiredFormEntries(picked).map(([name, value]) => <input key={value} type="hidden" name={name} value={value} />)}
            {picked.size === 0 ? <p className="text-xs text-muted-foreground">{tt("settings.requiredDocuments.off")}</p> : null}
            <SubmitButton pending={pending}>{tt("common.save")}</SubmitButton>
          </form>
        </details>
      </CardContent>
    </Card>
  );
}
```

  (`useFormSubmit`'s callback signature: read `use-form-submit.ts`; the Settings card passes an async `(formData) => …`. `requiredFormEntries` is exported from a `"use client"` module, which a client module may import. If `Card` does not forward `data-*` props, put `data-required-documents` on an inner wrapper and keep `id` on the `Card`.)
  - `…/documents/page.tsx`: import `getRequiredDocumentCategories` (add to the `@bis/db` import), `setRequiredDocumentCategoriesAction` from `"../settings/document-requirements-actions"`, `undoRequiredDocumentsAction` from `"./required-documents-actions"`, `RequiredDocumentsSummary` from `"./required-documents-summary"`; after the `rows`/`total` read: `const required = access.canManage ? await getRequiredDocumentCategories(db, accountId).catch((e: unknown) => { console.error(\`documents page: required list (account ${accountId}): ${loggableError(e)}\`); return null; }) : undefined;`; first inside `<div className="space-y-4 p-6">`: `{access.canManage ? <RequiredDocumentsSummary required={required ?? null} locale={locale} save={setRequiredDocumentCategoriesAction.bind(null, accountId)} undo={undoRequiredDocumentsAction.bind(null, accountId)} /> : null}`.
  - `documents-page-demo.tsx`: `RequiredDocumentsSummary` four times (English `["id", "insurance"]`, a `lang="es"` wrapper with the same in Spanish, `[]`, `null`), every action a no-op resolving `{ ok: true, list: [] }` / `{ ok: true }`; `DocumentsList` once with three sample rows (the shapes of `documents-list.test.ts`' fixture). Mount it in `styleguide/page.tsx` after `<DocumentsDemo />` with its own heading (copy the neighbours' heading pattern).
- [ ] **Step 5: Run** both new tests, `…/documents/page.test.ts`, `documents-page-demo.test.ts`, `styleguide/documents-demo.test.ts`, `settings/required-documents-card.test.ts`, `src/components/ui/material.test.ts`, `src/lib/i18n/ratchet.test.ts`, typecheck, eslint. All PASS.
- [ ] **Step 6: Probes:** (a) the Undo calling `undo(before, after)` → the handlers case FAILS; (b) the card showing `r.error` → the English-error case FAILS; (c) the page rendering the summary for Staff → the page case FAILS; (d) `required: null` drawing the picker → the summary case FAILS. Paste each.
- [ ] **Step 7: Commit** every path above, message "documents page: an Owner's Required documents card with its own Save and Undo; styleguide entries (S-07 3a)".

---

## Task 11: Regenerate the i18n baselines (bis-crm)

**Review:** sonnet (or orchestrator-checked if byte-identical).

- [ ] **Step 1.** After Tasks 2, 5, 7, 9 and 10 have committed: `pnpm --filter web exec tsx scripts/generate-i18n-baseline.ts` (the script `ratchet.test.ts:6` names). Expected: byte-identical, or ONLY reductions. If the generator ADDS any count or frozen key, STOP: a task admitted a violation; report the file and the string.
- [ ] **Step 2.** `pnpm --filter web exec vitest run src/lib/i18n/ratchet.test.ts src/lib/messages.test.ts` → PASS. Commit the two baseline files if changed, message "i18n: baselines after S-07 3a".

---

## Task 12: The e2e spec (bis-e2e-qa)

**Review:** sonnet. **Runs:** never by the agent (the orchestrator runs Playwright).

**Files**
- Create: `apps/web/e2e/documents-page.spec.ts`

- [ ] **Step 1: Read** `apps/web/e2e/document-requirements.spec.ts` and `documents-scan.spec.ts` whole (env loading, the fixture contact, card locators, the afterAll that removes objects and rows and re-reads), `apps/web/e2e/support.ts:100-135` (`readClientFixture`, `recordPage`), `apps/web/playwright.config.ts:160-180` (one worker; the fake clamd), `…/contacts/document-request-dialog.tsx` (how a ticked item is marked in the markup), `…/acct/tasks/work-list.tsx` (a row's link).
- [ ] **Step 2: Write the spec.** `import { test, expect, type Page } from "./fixtures/test"` (never `@playwright/test`: `clerk-cookie-guard.test.ts`). `import { serviceDb, createContact, createDocument, reserveDocumentVersion, markDocumentVersionReady, recordDocumentScan, shiftDay } from "@bis/db";`, `import { openExpiryTasks } from "../src/lib/automations/passes/documents-expiry";`, `import { m } from "../src/lib/messages";`. `test.describe.configure({ mode: "serial", timeout: 180_000 })`. `STAMP = \`Docs3a${Date.now()}\``. `beforeAll`: `readClientFixture()` (throw if missing); READ and keep the account's `required_document_categories` and `timezone` (service client); compute the account's today with `Intl.DateTimeFormat("en-CA", { timeZone })` (YYYY-MM-DD); one contact `{ firstName: "Lia", lastName: STAMP }` (refuse `existing`); files through a `file(category, expiresOn, title)` helper (`createDocument` + `reserveDocumentVersion` + `markDocumentVersionReady` + `recordDocumentScan` "clean"; no stored object: nothing here opens the viewer): **A** insurance, `today + 10`, title `${STAMP} Póliza`; **B** permit, `today - 3`, `${STAMP} Permiso`; **C** photo, no expiry, `${STAMP} Foto`; and 51 × estimate, no expiry, titles `${STAMP} E01..E51`. Base URL `/dashboard/accounts/<id>/documents`. Every test starts with `page.goto(…)` (never `reload`).
  1. **Filters** (spec 6 "Documents page filters"). `goto(base)`: A's row is visible, B's and C's are not; Expired pill → B visible, A not; `?show=all&category=photo` → C visible, A and B not. On every one of these screens, when the screen holds one page, the header's number equals the count of `[data-documents-page-row]` (the real total equals the rows when there is no Next).
  2. **Paging.** `goto(base + "?show=all&category=estimate")`: read the header's number N (the per-run fixture account may hold another spec's estimates, so N ≥ 51 and N ≤ 100 are asserted rather than N = 51); the page has exactly 50 rows and one `[data-documents-pager]` with "Next" and no "Back to the start"; click "Next" → exactly N − 50 rows and a "Back to the start" link; collect the row titles of both pages: no title appears on both, and all 51 `${STAMP} E…` titles appear across the two; click "Back to the start" → 50 rows again.
  3. **The Owner card with Undo** (the default signed-in user is the agency, which the card admits). `goto(base)`: `#required-documents` summary reads the stored list's sentence; open it; tick Warranty; Save → the toast "Saved. Each customer's Documents card shows the list."; the database list contains `warranty`; click the toast's Undo → the toast "Put back the list you had."; the database list equals the one read in `beforeAll`.
  4. **An expiry To-do and its link** (spec 6). `await openExpiryTasks(serviceDb(), new Date(), { accountId })` (SCOPED: never an unscoped run, Global Constraints) → its `opened` is ≥ 1; the database holds exactly one task with `document_expiry_id = A` and `document_expiry_on = A's date`; run it again → that task count stays 1 (dedupe end to end). `goto` `/dashboard/accounts/<id>/tasks`; the row showing `expiryTaskTitle({ category: "insurance", title: \`${STAMP} Póliza\`, name: \`Lia ${STAMP}\`, expiresOn: <A's date> }, <the account's language, read in beforeAll, "es" or "en">)` (imported from `../src/lib/documents/expiry-task`, the function the pass used) is there; click it → the URL has `document=<A>` and `ask=insurance`; on the contact page, `[data-document-row="<A>"] [data-document-open]` is focused (`toBeFocused()`); click "Ask the customer" → the dialog opens with Insurance ticked (read the dialog's markup for how a ticked item shows).
  `afterAll`: restore the account's list (check the error; re-read it equal); delete the contact's tasks (`document_expiry_id` in the spec's documents) then the documents (their versions cascade; no stored objects were made) then the contact; check every `error`; re-read that no row is left.
- [ ] **Step 3:** `pnpm --filter web exec playwright test --list e2e/documents-page.spec.ts` lists four tests (listing loads every import: Assumption A5; if `@/` does not resolve, STOP and report). `pnpm --filter web exec eslint e2e/documents-page.spec.ts`. Commit, message "e2e: the Documents page's filters and paging, the Owner's Required card with Undo, an expiry To-do opening its file with Ask pre-ticked (S-07 3a)".

---

## Task 13: DESIGN.md and the part-2 spec amendment (orchestrator)

- [ ] **Step 1. DESIGN.md**, Key patterns › **Sidebar**, appended to that bullet:

> **Amended 2026-10-17 (S-07 part 3, decision E2):** CRM holds Contacts, then **Documents** (every live file on a customer or household, Expiring soon first), then Opportunities. A Technician's CRM group holds Contacts and Documents; RLS bounds their Documents rows to assigned customers.

  and **The module contract**, appended:

> **Amended 2026-10-17 (S-07 part 3):** the document vault earns ONE top-level surface, the Documents page under CRM, because "what expires across every customer" is a work list no record card can show. Its work still routes to the work queue (an expiry To-do per file and date) and its news to the record's timeline; it adds no second settings section (a client Owner's Required documents card sits on that page; the agency's stays on Settings).

- [ ] **Step 2. The part-2 spec** (`docs/superpowers/specs/2026-10-15-document-vault-part2-design.md`), §5.2's 2c amendment line, add: "**Amended 2026-10-17 (part 3, PR 3a):** a client Owner sets the list on the Documents page's Required documents card (spec part 3 §3.3); P7's Owner half and §8's 'until an Owner opts in' are met from PR 3a."
- [ ] **Step 3.** Commit both with `git commit -m "docs: DESIGN.md names the Documents page under CRM; P7 is met for client Owners (S-07 3a)" -- DESIGN.md docs/superpowers/specs/2026-10-15-document-vault-part2-design.md`.

---

## Task 14: Whole-branch final review (checkpoint, not an implementer task)

**Reviewer:** opus, fresh context. Runs after Tasks 1–13.

- [ ] **Step 1.** Read spec §1–§3, §5–§7 (3a parts), this plan's Deviations, then `git diff d806ec5c...HEAD` in `<WT>`; walk "Spec coverage" below row by row against the diff.
- [ ] **Step 2.** Web tests by path: every test file Tasks 2 and 4–10 touched, plus `src/lib/i18n/ratchet.test.ts`, `src/lib/messages.test.ts`, `src/components/ui/material.test.ts`, `src/lib/i18n/request-locale-callers.test.ts`, `"src/app/(dashboard)/dashboard/accounts/[accountId]/in-account-service-reads.test.ts"`, `"src/app/(dashboard)/dashboard/accounts/[accountId]/technician-guards.test.ts"`, `src/lib/automations/cron-coupling.test.ts`; `pnpm --filter web typecheck`. The db suites on your own replica (Postgres `55631`, PostgREST `55638`, gateway `55639`): `document-expiry-schema.test.ts`, `document-requests-schema.test.ts`, `record-provenance-schema.test.ts`, `schema-grants-guard.test.ts` on `post`; `document-expiry.test.ts`, `account-documents.test.ts`, `document-requirements.test.ts`, `work-queue.test.ts`, `documents.test.ts` behind PostgREST. Re-run two probes of your own choosing, by name. A bis-design-reviewer pass on a running build (the page in both themes at desktop and 360 px with the pseudo-locale, all three empty states, the error boundary, the Required card open and failed) if the orchestrator provides one.
- [ ] **Step 3.** Hunt specifically: (a) any page or count read on the service client, or `serviceDb` in a new `lib/` file; (b) `count ?? 0` or a count taken from the rows; (c) a filter or "today" computed from the server's UTC day instead of the account's (`documentsClock`, `dayKeyIn`); the expiring window inclusive at both ends, Expired strictly before today; (d) the pass opening a To-do for an Owners-only, trashed, unclean or already-expired file, or for a key that has one; the cap missing; a title in a log line; an unscoped `openExpiryTasks` anywhere but the registered pass; (e) 0084: ASCII, `lock_timeout` first, the FK composite and cascading, the unique index partial, the re-created `keep_task_links` identical to 0080's plus exactly four lines, the rollback order (function first); (f) the work-queue link wrong for a household file, or `documentFocus` present on a plain To-do; (g) the card's focus effect setting state, running more than once, or building its selector from an unvalidated value; `?ask=other` pre-ticking anything; (h) rule 3 (expiry and scan as dot AND word), rule 4 (no checkbox; the whole row opens the viewer; the filed-on link outside the button), rule 7 (skeletons), rule 8 (the page has no primary, the Required card exactly one), rule 11 (no `data-hero`); (i) Spanish in tú anywhere, a Spanish assertion against `t()`'s output, `common.actionCrashed` in bilingual copy; (j) the Owner card's Undo not compare-and-set, or shown to Staff; the palette's Owner entry for Staff or the agency; (k) a test that cannot fail (memory "Vacuous test shapes"); (l) the e2e mutating anything but the per-run fixture account, or running the pass unscoped.
- [ ] **Step 4.** Report findings by severity with file:line; the orchestrator routes fixes to the owning task's agent.

---

## Task 15: Rollout (orchestrator; LAST; not a coding task)

Each step reads its own evidence; nothing is inferred from an earlier run.

- [ ] **Step 1. The deviations** 1–12 are in front of the owner (Task 0 step 3); the ledger records the answers.
- [ ] **Step 2. bis-ci** (only AFTER Task 14 approves): `gh workflow run ci-project-setup.yml -f step=push-dry-run --ref feat/s07-vault-3` → its log lists exactly `0084_document_expiry_tasks.sql`; then `-f step=push`. Post-apply, read-only with `pnpm --filter @bis/db ci:sql`: `select column_name, data_type from information_schema.columns where table_name='tasks' and column_name like 'document_expiry_%' order by 1` → `document_expiry_id | uuid`, `document_expiry_on | date`; `select conname from pg_constraint where conname in ('tasks_document_expiry_fkey','tasks_document_expiry_coherent') order by 1` → both; `select indexname from pg_indexes where indexname in ('tasks_document_expiry_once','documents_by_expiry','documents_expiry_window','documents_live_by_created') order by 1` → all four; `select position('document_expiry_on' in prosrc) > 0 from pg_proc where proname = 'keep_task_links'` → `t`. From here on the `@bis/db` suites may run against bis-ci again.
- [ ] **Step 3. Push and CI.** Until Step 2, `e2e` is red on its migration check by design (0084 not on bis-ci); after Step 2, re-run and read `verify` and `e2e` ON THE HEAD SHA (`gh api repos/{owner}/{repo}/commits/<sha>/check-runs`). A CI-vs-local disagreement is an environment finding first (memory "CI vs local divergence").
- [ ] **Step 4. Production** (MCP on `tlbkbmlrfafquucsmsmm`): read-only pre-flight `select max(version) from supabase_migrations.schema_migrations` → the 0083 apply; then `apply_migration` with 0084's exact text, ONCE (Task 1 step 6 proved no backslash; its md5 equals Task 1's). Additive, and the code needs it, so it goes BEFORE the merge (spec §7: migration before code deploy). Ledger line: `0084 APPLIED <date> on bis-ci and production — NEVER RE-APPLY`.
- [ ] **Step 5. Parity.** `docs/runbooks/ci-supabase-project.md` §5: `fingerprint.sql` on both projects; the two columns, the constraint pair, the four indexes and `keep_task_links`' body are equal.
- [ ] **Step 6. Gates, one at a time:** `pnpm check`, `pnpm --filter web build`, `pnpm --filter web test:e2e` (check no `screenshots.yml` run is in progress first).
- [ ] **Step 7. Preview, by hand (owner and orchestrator together)**, on the branch's Preview (bis-ci), on a test account (never Test Client One): the sidebar shows Documents after Contacts; the page in both themes, at a phone width, in Spanish; the three filters, a category, Next and Back to the start; a row opens the viewer; the filed-on name opens the record; as a client Owner the Required card at the top, Save and Undo; as Staff no card; a Technician sees only assigned customers' files. Delete what you made.
- [ ] **Step 8. Merge** through the PR with `gh pr merge <n> --auto --squash`, after the head SHA's `verify` and `e2e` are green and Task 14's findings are closed. The PR body names: deviations 1–12 and the owner's answers; "Spec P7's Owner half and §8's 'until an Owner opts in' (part 2) are met from this PR: a client Owner sets the list on the Documents page."; the pinned tests changed; "Not in this PR"; the Preview results; the 0084 apply lines.
- [ ] **Step 9. After the deploy** (spec §7, owed): the deploy reads READY on the merge SHA. **Production smoke on an AGENCY-owned record:** set a file's expiry 20 days out; wait for the next tick (or read the next `cron.pass.documentsExpiry` heartbeat after it); the To-do "…'s <category> expires on <date>" is on the work queue, due 7 days before at 09:00 in the account's zone; open it → the file is focused and Ask the customer opens with its category ticked; then set the expiry back and close the To-do. Open the Documents page as a client Owner (an agency-owned test login) to check the Required documents card. Tracker: item 6 / F-005 stays `in_progress` with "part 3a (the Documents page, expiry To-dos, the Owner's Required card) shipped #<n>"; it goes `done` after 3b.

---

## Spec coverage

| Spec | Where |
|---|---|
| §1 3a row: the Documents page, the sidebar entry, DESIGN.md amended, expiry To-dos, the Owner's Required card, 0084 | Tasks 1, 5, 8, 9, 10, 13 |
| §1 "Not in part 3" (no customer message, fixed 30 days, no retention, no property/deal documents, no model reads a document) | "Not in this PR"; Task 5 sends nothing |
| E1 staff-only reminders; Ask the customer one click away, pre-filled | Tasks 5 (pass), 6 (link), 7 (`?ask=`) |
| E2 sidebar entry under CRM after Contacts; DESIGN.md amended | Tasks 8, 13 |
| §3.1 route, `nav.documents`, "Documents"/"Documentos", icon `documents`, Technicians too | Tasks 2, 8, 9 (technician pin) |
| §3.1 ⌘K jump target | Task 8 (derived from the nav, plus keywords) |
| §3.1 request-client reads only; visibility unchanged; no new policy | Task 4 (`account-documents.ts` takes the caller's client), Task 9 (`dbForRequest`); Task 14 (a) |
| §3.1 row contents (title, category, filed-on link as its own focus target, expiry dot + word, source line, Owners only, scan state) | Task 9 (`documents-list.tsx`), reusing Task 7's exports |
| §3.1 whole row opens the existing viewer; ring; `--surface-3`; no checkboxes | Task 9 |
| §3.1 filters (Expiring soon default, Expired, All, Category), in the URL | Task 4 (bounds), Task 9 (`documentsQuery`, pills, select) |
| §3.1 sort per filter, `id` tiebreak | Task 4 (order, cursor round-trip test) |
| §3.1 cursor paging, one pager, real total, throw on null count | Task 4 (`countAccountDocuments`), Task 9 (pager, header); deviation 8 (the words) |
| §3.1 skeleton, error with retry, three empty states, no hero | Task 2 (copy), Task 9 (`loading.tsx`, `error.tsx`, page) |
| §3.2 pass `documentsExpiry` in the registry beside sweep and scan; heartbeat `cron.pass.documentsExpiry` | Task 5; deviation 1 (every tick; the harness writes the heartbeat) |
| §3.2 who qualifies (not trashed, not Owners only, expiry set, on contact or group, current version clean, window in the account's zone); catch-up rule | Task 3 (read), Task 5 (pass re-check, window, tests) |
| §3.2 exactly one To-do per document and date; columns, check, composite FK, unique partial index, 23505 dedupe, trigger extended | Task 1 (0084), Task 3 (`ensureDocumentExpiryTask`); deviation 2 (cascade) |
| §3.2 re-arm on a new date; old To-do left alone | Task 5 (re-arm case), Task 1 (re-arm insert) |
| §3.2 title in the account's language, Other falls back to the file title, a no-name form | Tasks 2, 5 |
| §3.2 placement: contact; a group file on its primary contact; none → null and the title names the group | Task 5 (via `documentRequestTarget`) |
| §3.2 due: expiry date 09:00 in the zone minus 7 days (owner choice) | Task 5 (`expiryDueAt`, DST case); deviation 12 |
| §3.2 `task.created` with `documentId`, actor `documents-expiry`, type system | Task 3 (`ensureDocumentExpiryTask`, events assertion), Task 5 |
| §3.2 the To-do links to the card with the document in focus; `?ask=` pre-selects | Tasks 6, 7; deviations 5, 6 |
| §3.2 failures logged by ids, never the title; one failure never stops the pass; cap 200, logged | Task 5; deviation 10 |
| §3.3 the Required card at the top of the page for Owners and the agency; summary line; the picker; 2c's save; own Save, toast, Undo; agency Settings keeps its card | Tasks 4 (Undo action), 10 |
| §3.3 Settings ⌘K entry opens this card for Owners | Task 8 (`nav:required-documents` for Owners; the agency's `settings:required-documents` unchanged) |
| §3.3 the 2c note closed; the part-2 spec gets an amendment | Task 13 step 2; Task 15 step 8 (PR body) |
| §3.4 0084: columns, check, FK, unique index, trigger, the expiry index, the All index (0077 checked: none), rollback note, no new grants (guard) | Task 1; deviations 3, 4 |
| §5 every string in the catalogue, English and Spanish (usted); To-do titles in the account's language; the page in the reader's locale; pseudo-locale at 360 px; `lang` | Task 2; Task 9 (`requestLocale`, `lang={locale}`); Task 14 step 2 |
| §6 0084 tests (service-only columns, dedupe, cross-account FK) | Task 1 |
| §6 pass tests (edges at day 30 and 0 in two zones across midnight UTC; expired never; Owners-only/trashed/unclean skipped; dedupe; re-arm; group routing; cap; one error) | Task 5 |
| §6 page reads (bounds in the account zone, cursor round-trip, total throws on null) | Task 4 |
| §6 e2e (filters and paging; Owner card Save and Undo; an expiry To-do after a forced run; Ask pre-filled) | Task 12 |
| §6 mutation probes run by each reviewer | every task's Step 6; Task 14 step 2 |
| §7 0084: bis-ci, production, parity; migration before code; the 3a production smoke; tracker | Task 15 |

## Self-review notes (the writer's own pass, 2026-10-17)

- **Spec coverage:** every §3 bullet maps to a row above. The places where the code made the spec's words impossible or ambiguous are deviations 1–12, each with the file:line that decided it; none blocks a task.
- **Placeholder scan:** no TBD/TODO; every code step carries its code. Two steps name a read-then-adapt rule instead of guessing a name the plan writer could not see in full (the container's ready-files value in `documents-card.tsx` at `:836`; `partsInZone`'s field names); each keeps the test's pinned strings fixed so the adaptation cannot weaken them.
- **Type consistency:** `ExpiringDocument`, `listExpiringDocuments`, `listDocumentExpiryTaskKeys`, `ensureDocumentExpiryTask`, `expiryTaskKey`, `DOCUMENT_EXPIRY_WINDOW_DAYS`, `shiftDay` (Task 3) → Tasks 4, 5, 6, 12; `AccountDocument*`, `listAccountDocuments`, `countAccountDocuments`, `restoreRequiredDocumentCategories`, `undoRequiredDocumentsAction`, `RequiredUndoAnswer` (Task 4) → Tasks 9, 10; `openExpiryTasks`, `documentsExpiryPass` (Task 5) → Task 12; `CardFocus`, `cardFocusFrom`, `workRowHref`, `WorkRow.documentFocus` (Task 6) → Task 7; `ExpiryLine`, `ScanStatus`, `askPreset`, `data-document-open`, `DocumentsCard.focus` (Task 7) → Tasks 9, 12; `DocumentsRowView`, `documentsQuery`, `documentsHref`, `documentsPagerHrefs`, `filedOnView` (Task 9) → Task 10's demo; `nav:required-documents` → `#required-documents` (Tasks 8, 10).
- **Vacuity pass:** every prescribed test names its mutation; copy is asserted in both languages against literals; the one source-scan pin (`work-list.href.test.ts`) strips comments with the house scanner and proves its own path resolves; the structure pins on the card fail when an anchor is missing (both `indexOf`s asserted before slicing); the real-total case asserts a count different from the rows; probe (b) in Task 3 names why removing `!inner` alone is not a probe.
- **Not executed:** nothing in this plan was run; every name was read off `ac252552` except where an Assumption says otherwise (A1–A7), each with its check.
