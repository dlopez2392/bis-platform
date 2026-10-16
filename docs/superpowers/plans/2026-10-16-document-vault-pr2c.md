# The document vault, PR 2c (S-07 + F-005 part 2, migration 0081): the "7 de 9" checklist, implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An Owner (or the agency) picks the documents every customer must have; each customer's Documents card then says how many they have ("Required 2 of 3"), names each gap ("Missing: Insurance", "Expired: ID"), and offers **Ask the customer** (2b's dialog with that item ticked) and **Upload** (the category preset) beside it; a gap that does not apply to one customer is marked **Not needed** and can be made **Needed again**, both at once with an Undo toast and a timeline row; when nothing is missing the card says **Complete**. Off for every account until someone opts in.

**Architecture:** One migration, **0081**: `accounts.required_document_categories text[]` (empty = off, a CHECK through an immutable helper), `document_requirement_skips` (server-written, members read under the contact's visibility, one ACTIVE skip per contact and category, an un-skip stamps the row instead of deleting it so both moves keep their timeline rows; deviation 1), and one read function `public.document_requirements(account, contact, today)`, SECURITY DEFINER like 0078's `document_space_used`, which re-checks the account AND the contact's visibility itself and answers one row per required category with its state (`met`, `checking`, `expired`, `missing`, `skipped`), never a file, a title or an id (deviation 3, owner decision D7). The app adds a `@bis/db` module (`document-requirements.ts`), a request-client route for the card (`…/contacts/[contactId]/document-requirements`), four skip actions (proof on the request client, then the service client, the actor's own Undo within 10 minutes), a Settings card on the agency's Settings page registered in ⌘K, two timeline kinds, and a checklist section inside the Documents card that re-reads itself only when a files read changed something it depends on (no timer of its own).

**Tech Stack:** Postgres 17 (Supabase) migration; supabase-js 2.110.8 (`rpc`, `from`); Next.js 16.3.6 App Router (server actions, route handlers); React 19.2.4; vitest 4 (`renderToStaticMarkup`, no DOM; `vi.mock`); sonner toasts; the `@bis/db` suites on a local PG18 replica (with a local PostgREST for `withTestAccount`) and CI `verify`; Playwright (bis-e2e-qa writes it, the orchestrator runs it), with 2a's real shim and fake clamd already in `webServer`.

**Spec:** `docs/superpowers/specs/2026-10-15-document-vault-part2-design.md` (owner-approved 2026-10-15): §1 row 2c and its "Not in part 2" line, §2 P7, §5 entirely, the 2c parts of §6–§8, and every 2a/2b amendment that reaches 2c (§3.2 as amended: what OPENS is the newest CLEAN ready version; §4.5 as amended 2026-10-16: a staff upload onto a requested document answers its item). Template: `docs/superpowers/plans/2026-10-15-document-vault-pr2b.md` (shipped as #261). Base: `main` at `6bf592f9` (#261, PR 2b merged; **0080 is on bis-ci and production: never re-apply**). Every file:line below was read off this worktree at `6bf592f9`; anything not read is labelled **Assumption**.

`<WT>` = `C:\Users\danlo\bis-platform\.claude\worktrees\s07-2c` (Git Bash: `/c/Users/danlo/bis-platform/.claude/worktrees/s07-2c`), branch `feat/s07-vault-2c`. `<SCRATCH>` = `C:\Users\danlo\AppData\Local\Temp\claude\C--Users-danlo-bis-platform\24e55561-31fd-4769-a14a-4ebbd9d987a9\scratchpad` (Git Bash: `/c/Users/danlo/AppData/Local/Temp/claude/C--Users-danlo-bis-platform/24e55561-31fd-4769-a14a-4ebbd9d987a9/scratchpad`); write it out literally in every command. `<KIT2B>` = `/c/Users/danlo/AppData/Local/Temp/claude/C--Users-danlo-bis-platform/f54a0255-9568-420c-ad87-a4d62d6b9a05/scratchpad/s07d-kit` (2b's kit; read 2026-10-16: `replica.sh`, `pgrst.sh` present). `<KITSRC>` = `/c/Users/danlo/AppData/Local/Temp/claude/C--Users-danlo-bis-platform/db21dcfe-6aee-47cd-8939-ff4f82a45810/scratchpad/s07-t3-impl` (read 2026-10-16: present). `…/contacts/` = `apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/contacts/`. `…/settings/` = `apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/settings/`. `…/api/` = `apps/web/src/app/api/accounts/[accountId]/`.

## The concurrent poll PR (read before scheduling)

A separate PR is in flight: branch `feat/s07-requests-poll`, worktree `.claude/worktrees/s07-poll`, commit `9fdfc4f7` on top of `6bf592f9` (brief `.claude/worktrees/s07-poll/.superpowers/sdd/poll-brief.md`, read 2026-10-16). It changes exactly three files: `…/contacts/documents-card.tsx` (+84/-4: `requestsPollMs`, `requestsChanged`, a `useSyncExternalStore` visibility store, `useRouter`, a `requestsReads` counter, a 20-second requests timer, and on a change `setNonce` (files re-read) plus `router.refresh()`), `…/contacts/documents-card.test.ts` (+58/-1), and `apps/web/e2e/document-requests.spec.ts` (+23/-9).

**2c fits around it, by construction:**
- 2c's checklist has **no timer of its own**. It re-reads when the FILES read changes something it depends on (`shouldReloadRequirements`, Task 5). The poll PR's "a customer file arrived" path already re-reads the files (`setNonce`), so a customer's upload reaches the checklist through the files read: requests tick → files re-read → checklist re-read. No second poll, nothing stacked.
- 2c's skip actions call the card's `router.refresh()` so the timeline shows the skip row; the poll PR adds `const router = useRouter()` to the container. Task 7 uses THAT `router` (it does not add a second `useRouter`).
- 2c's e2e is a NEW file (`apps/web/e2e/document-requirements.spec.ts`); it never edits `document-requests.spec.ts`.

**Dependency, stated outright: Task 7 (the card) starts only after the poll PR has MERGED to `main`, and its first step merges `origin/main` into `<WT>`** (never a rebase in a shared tree). Task 9 (e2e) and Task 8 (baselines) follow Task 7. **Tasks 1, 2, 3, 4, 5 and 6 touch none of the poll PR's three files and may run before it merges.**

## Owner decisions this plan needs (Task 0 asks them; the plan is written for every RECOMMENDED answer)

The spec leaves these open, or the code makes the spec's words impossible as written. Task 0 puts each to the owner as a tile, recommendation first. The plan below is written for the recommended answer; for each other answer, the exact lines that change are named.

| # | Question | Recommended | If ruled the other way |
|---|---|---|---|
| D1 | Does a Technician see the checklist, and may they mark an item Not needed? | **Sees it, may Upload and Ask (as on the card today), may NOT skip or un-skip** (a skip is a judgement about what the business requires; `seesWholeAccount`, `lib/auth-role.ts:15`). | Task 5's four actions drop the `seesWholeAccount` check and the `documents.checklist.skipRole` key; Task 7's `canSkip` is `true` for everyone who sees the card. |
| D2 | "Ask the customer" from a missing item: tick just that item, or every missing item? | **Just that item** (spec §5.4: "2b's dialog with that item ticked"; staff tick more in the dialog). | Task 7's `onAsk(category)` passes `open.map((i) => i.category)` instead of `[category]`. |
| D3 | Does a household/business page show the checklist? | **No: settled by spec §1** ("Not in part 2: the checklist on household/business pages or in the list drawer"). A group's files still COUNT for its members (§5.3). Listed so the owner sees it was not forgotten. | A new task: a group-level read (whose requirements? the members'?) that the spec has not designed. |
| D4 | What does "expired" mean when a category holds several files? | **Met if ANY live, clean file of that category (on the customer or a group they belong to) is unexpired; "Expired" only when none is met and at least one live, clean one has expired.** A renewed policy uploaded beside the old one is "met"; the old one does not make it "Expired". | "Newest file decides": Task 1's `st` CTE picks `distinct on (category)` by `created_at desc` before testing expiry; the "newer copy" case in Task 1 flips. |
| D5 | Does a skip expire? | **No.** It stays until someone presses "Needed again". | A `skips_until` column and a `p_today` comparison in the function; out of 2c's scope as designed. |
| D6 | Who edits the list? Spec §5.2 says "Owners and agency edit; others read", but the account Settings page is AGENCY-ONLY (`requireAgencyOnlyAccountAccess`, `…/settings/page.tsx:62`; the palette registers every Settings section `agencyOnly: true`, `lib/palette/registry.ts:26-32`), so a client Owner cannot reach it. | **2c ships the editor on Settings for the agency; the save action already admits a client Owner (`canManage`), so a client-Owner editor can arrive with part 3's account-wide Documents view with no database change.** Staff and Technicians "read" the list as its effect on each customer's card. | "Owners edit now": one more bis-frontend task: a client-Owner route on the Branding pattern (`nav-groups.ts`: Branding is a client-only nav item, "the agency reaches the same panel from Settings"), rendering the same `RequiredDocumentsCard`, registered in the palette for Owners; DESIGN.md's module contract allows "one settings section", so the orchestrator confirms a second entry point is not a new top-level surface. |
| D7 | A file marked **Owners only** (0077): does it meet the requirement for a Staff member who cannot see it? | **Yes.** The checklist is a fact about the customer, not about the reader: a Staff member told "Missing: Insurance" would ask the customer for a file the Owner already holds. The read is SECURITY DEFINER (0078's reason, "the number is the account's") and answers states only, never a file, title or id. | The function becomes SECURITY INVOKER (each reader's RLS decides); Task 1's Owners-only case flips to "missing" for Staff, and the function's own visibility checks go (RLS does them). |
| D8 | Can **Other** be required? Spec §5.2 says "the nine categories as checkboxes". | **No: eight.** Anything filed as Other would meet "Other", so it can never mean a particular document; and 2b's dialog needs a note for Other, so "Ask the customer" from an "Other" gap would open with an error. | `'other'` joins the SQL list in Task 1 (both CHECKs), `REQUIRABLE_DOCUMENT_CATEGORIES` becomes `DOCUMENT_CATEGORIES` in Task 3, and Task 1's "other is refused" lines move to the accepted set. |
| D9 | Where does "2 de 3" sit? Spec §5.4: "The card header reads DOCUMENTOS 2 de 3". The card's title is a fixed string the SERVER renders in `RecordCard` (`[contactId]/page.tsx:266`, `title={tr.text(def.titleKey)}`), while the count changes in the browser (a skip, an upload, a verdict). | **The checklist's own first line, directly under the card's header row: a mono label "Required" / "Requeridos" and "2 of 3" / "2 de 3"** (the same row style as "3 files"), so it changes at once with every move and never needs a page reload. | The page computes the count server-side into the title, and every skip, upload and verdict calls `router.refresh()`; a second read of the same facts, and a stale title until each refresh lands. |
| D10 | A file uploaded for a required category is still being checked (2a): what does the checklist say? | **"Checking: Insurance"** (dot + word), not counted as met, not called "Missing". The file is there; saying "Missing" for two seconds after staff uploaded it reads as a failure. | `checking` folds into `missing` in Task 1's function and the `documents.checklist.checking` key goes. |
| D11 | When everything required is met: spec says "Completo, and the list disappears". What about skipped items? | **"Complete" (dot + word); the gaps' list disappears; skipped items stay listed** as "Insurance · Not needed" with "Needed again", or a skip could never be undone after the fact. | Task 7 hides skipped rows when complete. |
| D12 | Does a blueprint carry the required list? | **No, not in 2c** (spec: F-171 "later fills 2c's setting"; `BUNDLE_SCHEMA_VERSION` unchanged). | `captureBlueprint`/`applyBlueprint` gain the column and the bundle version bumps; a task for bis-crm's blueprints owner. |

## Global Constraints

- **NEVER `git stash`, `git reset`, `git checkout --`, `--amend`, or any history rewrite** in the shared worktree. Another agent's uncommitted work lives in the same tree. To undo your own edit, edit it back. To see committed text, `git show HEAD:<path>`. Never `rm -rf` anything under `<WT>` (memory "No rm -rf on worktrees"); scratch directories under `<SCRATCH>` are yours to delete. Commit with `git commit -m "…" -- <every path>`, never `-A` or `.`. Merge `origin/main` when told to (Task 7 step 0); never rebase.
- **Ownership (tag on every task; no task edits a file its owner does not own).**
  - **bis-db-schema:** `packages/db/supabase/migrations/0081_document_requirements.sql` (new), `packages/db/src/test/document-requirements-schema.test.ts` (new), `<SCRATCH>/s07e-kit/*` (Task 1). Writes the migration and proves it on a replica; never applies it.
  - **bis-crm:** `apps/web/src/lib/messages.ts` and one new `describe` in `apps/web/src/lib/messages.test.ts` (**Task 2 only**); `packages/db/src/{document-requirements,document-rules,index}.ts` and `packages/db/src/test/document-requirements.test.ts` (Task 3); `packages/db/src/record.ts`, `packages/db/src/test/{record,timeline-merge}.test.ts`, `apps/web/src/lib/record/{author-mark,timeline-rows,recent-rows}.ts` and tests, both timelines and their row tests, `…/contacts/contact-drawer.tsx` (`ROW_ICON` only), `apps/web/src/lib/contacts/drawer-summary.ts` (`ROW_KINDS` only) and test, `…/api/contacts/[contactId]/summary/route.reads.test.ts` (`MEASURED` and its comment only) (Task 4); `…/api/contacts/[contactId]/document-requirements/route.ts` (+ test), `apps/web/src/lib/documents/requirements-load.ts` (+ test), `…/contacts/document-requirements-actions.ts` (+ test), `…/settings/document-requirements-actions.ts` (+ test), two `ALLOWED` lines in `…/accounts/[accountId]/in-account-service-reads.test.ts` (Task 5); `apps/web/src/lib/i18n/{catalogue,ratchet}-baseline.json` (Task 8, regenerated, never hand-edited).
  - **bis-frontend:** `…/settings/required-documents-card.tsx` (+ test), `…/settings/page.tsx` (one read column, one mount) and `…/settings/page.test.ts`, `apps/web/src/lib/palette/registry.ts` (one `SETTINGS_SECTIONS` line) and `registry.test.ts` (Task 6); `…/contacts/{documents-card.tsx,document-checklist.tsx,document-checklist-handlers.ts}` and their tests, `…/contacts/[contactId]/page.tsx` (one prop) and its `page.test.ts` (one expectation), `apps/web/src/app/(dashboard)/dashboard/styleguide/{documents-demo.tsx,documents-demo.test.ts}` (Task 7).
  - **bis-e2e-qa:** `apps/web/e2e/document-requirements.spec.ts` (new) (Task 9).
  - **Orchestrator:** the owner's decisions D1–D12 (Task 0), the ledger, the bis-ci and production applies of 0081, the parity check, the gates, the PR, the merge, the roadmap tracker row. No `DESIGN.md` edit: the module contract already routes this (a card on the record, its news to the timeline, one settings section), and D6's recommended answer adds no surface.
- **Shared files, one task at a time.**
  - `apps/web/src/lib/messages.ts`: **Task 2 only**. Every key in this plan is listed in Task 2. A later task that finds a key missing STOPS and reports it; the orchestrator re-opens Task 2. A `.es` twin goes on the line directly under its English key.
  - `packages/db/src/{document-requirements,document-rules,index}.ts`: **Task 3 only**. `packages/db/src/record.ts` and `lib/record/*`: **Task 4 only**.
  - `…/contacts/documents-card.tsx` and its test: **Task 7 only, after the poll PR merged.**
  - `…/accounts/[accountId]/in-account-service-reads.test.ts`: **Task 5 only** (two lines).
  - `apps/web/src/lib/palette/registry.ts`: **Task 6 only** (one line, appended; "add a line, never reorder").
  - `apps/web/src/lib/i18n/*-baseline.json`: **Task 8 only**, after every copy-bearing task has committed.
- **Every test must be able to fail, and the plan writer checked each one; the implementer re-checks.** Each test names the mutation that breaks it. Run the probe, see the test fail BY NAME, paste the failing assertion line into the report, revert by editing back. Shapes a reviewer rejects on sight (memory "Vacuous test shapes"): `toBeTruthy`/`toBeDefined` on content; an English-only assertion where a Spanish twin exists (assert BOTH, the Spanish compared against the literal string, never `t()`'s output, which falls back to English silently); a mock that satisfies itself; an assertion on a value the fixture already contained before the code ran; a negative `not.toContain` against raw `renderToStaticMarkup` output on a string with an apostrophe (use `renderedText()` from `apps/web/src/lib/rendered-text.ts` for EVERY copy assertion); a source scan by regex over code that can contain `/*` in a string. A `-t` filter that matches nothing passes silently: check the run count in vitest's summary block.
- **2b's lessons, designed in here.**
  - **Server reads behind browser ids.** Every action reads its target on the REQUEST client (`dbForRequest()`, `apps/web/src/lib/db.ts`) before any service write: the contact (`getContact`), the account's list (`getRequiredDocumentCategories`), the skip row (`getDocumentSkip` / `getActiveDocumentSkip`, under 0081's RLS). A Technician's RLS shows only their assigned customers (0068); the checklist function re-checks that itself (it is SECURITY DEFINER).
  - **Undo is the actor's own, within a short window.** A skip's Undo deletes only a row the SAME person skipped, still active, made within 10 minutes; an un-skip's Undo restores only the SAME person's un-skip, at the exact instant its toast named, within 10 minutes (`document-requests-actions.ts`' `UNDO_WINDOW_MS` shape). Never a blind restore.
  - **No-name and Spanish copy.** No new customer-facing key names `{business}` or `{name}` (every 2c string is staff-facing), so no no-name twin is needed; Task 2's test asserts no new key contains either placeholder. Spanish uses **usted** throughout (no new string addresses the reader in the second person singular; Task 2's test bans the tú forms it could plausibly carry).
  - **Tests that read every account.** No 2c function reads every account; every read is scoped to one account and one contact. If a reviewer finds one, its test filters to the test's own account and keeps any count the test's own rows guarantee.
  - **Starts and limits.** 2c adds no limit. (A skip is unique per contact and category; that is a constraint, not a count.)
  - **e2e page state.** Each Playwright test gets a fresh page: every test `goto`s the contact page; nothing calls `reload` to pick up another test's state.
  - **Polling.** The checklist has no timer. Its re-read is triggered once per change by a pure `shouldReloadRequirements(prev, next)` that answers `false` for the same read twice (Task 5 pins it), so the files' 5-second Checking poll and the poll PR's 20-second requests tick never re-read it for nothing.
  - **Briefs list every pinned test.** "Pinned tests this PR changes" below names every file that pins a list 2c changes; a task's brief carries its rows.
- **0053, server-only writes.** `authenticated` gets SELECT on `document_requirement_skips` and nothing else; no grant on `accounts.required_document_categories` (0031's rule, `0031_weekly_report.sql:33-46`: `accounts` is edited per column by clients, and a server-written column takes no grant). Both new action files are added to `in-account-service-reads.test.ts`'s `ALLOWED` (Task 5). **No new file under `apps/web/src/lib` contains the token `serviceDb`, not even in a comment**: lib functions take the caller's client as a parameter.
- **SQL rules.** The migration is ASCII only with no backslash anywhere (memory "MCP SQL escapes"; checked with the node byte count in Task 1, which has a positive control). A boolean built from a nullable value is `coalesce(…, false)` (memory "plpgsql NULL guard"); the definer function's two guards both coalesce, as 0078's do. A Supabase `head: true` count throws on `count === null` (memory "head-count null"); this plan adds none.
- **DESIGN.md definition of done for every UI task (6, 7):** tokens only (radii `rounded-[var(--radius-ctl)]`, pills `rounded-full`; no hex, no literal shadow); both themes via the `.dark` class; the blur fallback; **rule 3: every state is a dot AND a word** ("Missing: Insurance" with a `--warn` dot, "Expired: ID" with a `--crit` dot, "Checking: Warranty" with a `--warn` dot, "Complete" with a `--good` dot; the word always carries the state); rule 5 (the checklist loads, is off, and fails on its own, never blanking the files); rule 6 (Not needed and Needed again run at once with Undo in the toast); rule 7 (a skeleton line while loading, no spinner, nothing pulses); rule 8 (the Documents card keeps exactly ONE `data-variant="default"` button, Upload; every checklist button is ghost; the Settings card has ONE primary Save); rule 1 (the meter is "2 of 3" under the label "Required": the denominator is its context); controls `min-h-11 md:min-h-8`; nothing animates on scroll.
- **Copy.** Every new string through `t(m, key, locale, params)` with an `.es` twin in the same commit (`apps/web/src/lib/i18n/ratchet.test.ts`). New `.tsx` code carries no JSX literal copy with a letter in it. No vendor or internal words in copy ("token", "RLS", "definer", "skip row", "category key", "checklist" as a machine word is fine in neither language: the words are "Required", "Missing", "Not needed"). The Settings page is English today (`m["settings.…"]`, `…/settings/page.tsx:120-130`); the new card follows its neighbours and reads `m[...]` English, but every key still has its `.es` twin for D6's later client-Owner editor.
- **Browser code imports the vault's rules from `@bis/db/document-rules`**, never the `@bis/db` barrel. `lib/documents/requirements-load.ts`, `…/contacts/document-checklist.tsx` and `…/contacts/document-checklist-handlers.ts` are browser-safe (no barrel import, no `node:` import).
- **The `vi.mock` factory check.** A task that adds a NEW named import from `@bis/db` to a module adds that name to every mock factory that reaches the module: `grep -rln 'vi.mock("@bis/db"' apps/web/src | xargs grep -ln "<module basename>"`. A task that adds a new `"use server"` import to a component adds a `vi.mock` for it in that component's tests (`documents-card.test.ts:5-13` mocks both action modules today; Task 7 adds `./document-requirements-actions`).
- **Running tests.** Only the affected tests, by path: `pnpm --filter web exec vitest run "<path>" …`, `pnpm --filter web typecheck`, `pnpm --filter web exec eslint "<touched files>"`. `@bis/db` suites only on a replica (the kit below), judged by vitest's summary block (capture the exit code to a file with nothing after the command; the `ERR_PNPM_RECURSIVE_EXEC_FIRST_FAIL` trailer lies); in `packages/db` run vitest as `node node_modules/vitest/vitest.mjs run <files>`. **No `@bis/db` vitest may run against bis-ci until Task 11 step 2 has applied 0081 there.** Never the gates (`pnpm check`, `pnpm --filter web build`, `pnpm --filter web test:e2e`) and never Playwright: the orchestrator runs them, one at a time (memory "Agent test scope"). Never pass the folder `…/accounts/` to vitest (it holds `calls/[callId]/actions.test.ts`, a live test).
- **Mutating e2e only on the per-run fixture account** (`readClientFixture()`, `apps/web/e2e/support.ts`), never `Test Client One`; the account's required list is restored to what it was in `afterAll`, and every seeded row and stored object is deleted, each error checked, then re-read to confirm none is left. Playwright runs one worker (`apps/web/playwright.config.ts:166-171`, `fullyParallel: false`, `workers: 1`), so the account-level list set by this spec is never seen by another spec mid-run.
- **Nothing sends, nothing calls a real provider.** 2c sends nothing; "Ask the customer" from the checklist is 2b's dialog and 2b's tested path.
- **Commits** (every "Commit" step below, whatever its short form) carry the trailer lines `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>` and `Claude-Session: https://claude.ai/code/session_013RThMy9QC8x7FZ94Lxib9p`. If `.git/index.lock` exists, wait and retry; never delete it. Never push (the orchestrator pushes). Never touch `main`.
- **Never** apply a migration outside your own replica, run SQL that writes to a shared project, mutate Test Client One, create or edit `.env*`, or set a Vercel secret. Those are the orchestrator's, in Task 11.

## The replica kit (every `@bis/db` task and its reviewer)

Ports, one set per agent, never `5432`, and clear of 2b's `55580`–`55593` in case one of its kits is still up: Task 1 implementer `55600`, Task 1 reviewer `55601`; Task 3 implementer Postgres `55602`, PostgREST `55603`, gateway `55604`; Task 3 reviewer `55605`/`55606`/`55607`; Task 4 implementer `55608`/`55609`/`55610`; Task 10 (final review) `55611`/`55612`/`55613`. Each agent works in its own `<SCRATCH>/s07e-t<N>-<impl|review>/`.

2b's kit (`<KIT2B>/replica.sh`, `pgrst.sh`; both present, read 2026-10-16), copied and re-pointed by Task 1 to `<SCRATCH>/s07e-kit/`: `WT` becomes `/c/Users/danlo/bis-platform/.claude/worktrees/s07-2c`; `pre` is every migration through **0080** (with the storage stub 0077 needs); `post` is `pre` plus the branch's **0081** if it exists yet. The only lines that change in `replica.sh` are the `WT=` line, the `case "$f" in *0080_*)` skip (becomes `*0081_*`), and the `post` block's file name (`0081_document_requirements.sql`) and messages (`post = pre + 0081`, `0081 FAILED`, `post = pre (no 0081 yet)`). `pgrst.sh` is copied unchanged except the JWT secret string, which becomes `s07e-local-postgrest-jwt-secret-not-used-anywhere-real-0000`. Task 1 writes both with `sed` and shows `diff` output in its report: exactly those lines differ.

The proxy (from `<KITSRC>`) forwards `/rest/v1/*` to PostgREST and answers `DELETE /storage/v1/object/documents` with `200 []`; any other storage call gets 404, so a db test that unexpectedly reaches storage fails loudly.

Stop your own kit only (never `taskkill /IM postgrest.exe`): `touch "<dir>/stop"`, then in PowerShell `Get-Process postgrest | Where-Object { $_.Path -eq '<dir as a Windows path>\postgrest.exe' } | Stop-Process -Confirm:$false` and `Get-NetTCPConnection -LocalPort <gatewayPort> -State Listen | ForEach-Object { Stop-Process -Id $_.OwningProcess -Confirm:$false }`; then `"/c/Program Files/PostgreSQL/18/bin/pg_ctl" -D "<dir>/pgdata" stop -m fast`. A SQL mutation probe on `post` needs `psql … -d post -c "notify pgrst, 'reload schema'"`.

**Faithfulness** (once per kit build, read-only on bis-ci with `pnpm --filter @bis/db ci:sql`): the client-write-surface digest on `pre` equals bis-ci's (bis-ci has 0080 and not 0081 until Task 11 step 2). The query is 2a's:

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

- `packages/db/src/test/timeline-merge.test.ts:145-147`: "three reads more than there are sources" becomes **five** (`TIMELINE_SOURCES.length + 3` → `+ 5`; the comment names 0081's two `document_requirement_skips` reads); and a new case beside the refused `document_requests` read at `:179`: a refused `document_requirement_skips` read fails the `documents` source (Task 4).
- `apps/web/src/app/api/accounts/[accountId]/contacts/[contactId]/summary/route.reads.test.ts:63`: `MEASURED` 26 → **28** (the two skip reads), its comment naming both (Task 4). Read the number off the failing run first; if it is not 28, stop and report.
- `packages/db/src/test/record.test.ts`: one new case (a skip and an un-skip read as two entries) (Task 4). `TIMELINE_SOURCES` is UNCHANGED (`record.ts:265`; the skip rows join the existing `documents` source, as every vault row has); `record.test.ts`'s pin of it and `[contactId]/page.test.ts:80`'s fake stay as they are.
- The `TimelineEntry` union gains `documentSkip` and `documentUnskip` (`packages/db/src/record.ts:290-305`). Every exhaustive map of it changes and its test gains a case (Task 4): `apps/web/src/lib/record/author-mark.ts` (`:62` area) + `author-mark.test.ts`; `apps/web/src/lib/record/timeline-rows.ts` (`:118` area) + `timeline-rows.test.ts`; `apps/web/src/lib/record/recent-rows.ts` (`:50`) + `recent-rows.test.ts`; `…/contacts/[contactId]/activity-timeline.tsx` (`:192`) + `activity-timeline.rows.test.ts` (`:224` area); `…/groups/[groupId]/group-timeline.tsx` (`:136`) + `group-timeline.test.ts` (`:154` area); `…/contacts/contact-drawer.tsx` `ROW_ICON` (`:66`); `apps/web/src/lib/contacts/drawer-summary.ts` `ROW_KINDS` (`:52-55`) + `drawer-summary.test.ts`.
- `…/contacts/[contactId]/page.test.ts:680`: the Documents card's props are asserted EXACTLY (`toEqual`); they gain `checklist: { canSkip: <bool> }` (Task 7). Read which access that case runs under (`:46-48` defaults to the agency, so `canSkip: true`) and assert the value it computes. `…/groups/[groupId]/page.test.ts:284, :293`: UNCHANGED (a group passes no `checklist`); Task 7 runs it to prove so.
- `…/settings/page.test.ts:24-35`: the fake `accounts` row gains `required_document_categories: ["insurance"]`, the file gains `vi.mock("./document-requirements-actions", …)` (a `"use server"` module is never imported into vitest, `sections.test.ts:31` states the house rule), and one new case pins the card's mount and props (Task 6).
- `apps/web/src/lib/palette/registry.test.ts:214-237`: the anchor-parity case's `cardFiles` list gains `../../app/(dashboard)/dashboard/accounts/[accountId]/settings/required-documents-card.tsx`; one new registration case beside `:114` (Task 6).
- `…/accounts/[accountId]/in-account-service-reads.test.ts:62-130`: `ALLOWED` gains two lines (Task 5).
- `…/contacts/documents-card.test.ts:5-13`: gains a `vi.mock("./document-requirements-actions", …)`; its render helper (`:39-43`) is unchanged (the `checklist` prop is optional); the existing one-primary assertions stay and are re-run with a checklist drawn (Task 7).
- `apps/web/src/app/(dashboard)/dashboard/styleguide/documents-demo.test.ts`: its exact counts (`data-documents-card` 6 at `:26`, `data-ask-customer` 3 at `:122`, and the rest) stay; the checklist is drawn as its OWN component under a NEW marker, `data-document-checklist`, counted (Task 7).
- `apps/web/src/lib/messages.test.ts`: one new `describe` at the end (Task 2).
- **Unchanged, checked (each task that could disturb one runs it):** `packages/db/src/test/schema-grants-guard.test.ts` (0081 adds a TABLE with RLS on and no client write, and no view; `rlsOff` stays `["document_scan_timeline", "document_version_timeline"]`, `:115`); `weekly-report-grants.test.ts` and `alert-phone-grants.test.ts` (`ACCOUNTS_UPDATE_COLUMNS` stays exactly as it is: 0081 grants nothing on `accounts`); `packages/db/src/account-teardown.ts`' `ACCOUNT_OWNED_TABLES` (unchanged: the new table cascades on its account AND its contact, as `document_requests` does; Task 1 proves the contact cascade); `document-vault-schema.test.ts` (the category set is unchanged); `read-gate.test.ts` (2c mints no URL).

## Not in this PR

- The checklist on a household or business page, or in the contacts list's drawer (spec §1; D3).
- A client-Owner screen for the list (D6's recommended answer; the action already admits an Owner).
- Required *fields*; pack-supplied lists (F-171 later fills the same column); a blueprint carrying the list (D12).
- Expiry reminders ("Expired: ID" is shown on the card; telling anyone about it is part 3).
- An event for a skip, an un-skip or a change of the list (2b deviation 7's rule: the timeline row is the record; `events_read` shows every event to every Owner and Staff, and nothing here needs a subscriber).
- A count of customers with gaps (the account-wide Documents view is part 3).

## Deviations from the spec, and spec-vs-code mismatches (the source decided; evidence cited)

1. **`document_requirement_skips` keeps the un-skip on the row** (spec §5.1: `account_id, contact_id, category, skipped_by, created_at; unique on (contact_id, category)`). Spec §5.4 gives BOTH moves a timeline row ("Skip and un-skip … each gets a timeline row"). An un-skip that deleted the row would erase the skip's own row with it, and a unique `(contact_id, category)` would forbid a second skip after an un-skip. So the row gains `id` (the timeline's cursor needs one, `timeline-cursor.ts:56-60`), `unskipped_at` and `unskipped_by`; the uniqueness is a partial index over ACTIVE skips, `(account_id, contact_id, category) where unskipped_at is null`; `unskipped_at > created_at` is a CHECK, so a skip row's two timeline entries can never tie on their instant. The timeline reads the table twice (a skip at `created_at`, an un-skip at `unskipped_at`) as two kinds, `documentSkip` and `documentUnskip`, so the row key `${kind}-${id}` (`timeline-rows.ts:142`) never collides.
2. **Undo erases.** The Undo of a skip DELETES that row (the actor's own, still active, within 10 minutes), so neither the skip nor its timeline row survives; the Undo of an un-skip clears `unskipped_at`/`unskipped_by` (the actor's own, at the exact instant the toast named, within 10 minutes), so the "needed again" row disappears. An Undo is "it never happened", as the trash's restore is.
3. **The checklist's read is a SECURITY DEFINER function** (D7), `public.document_requirements(p_account_id, p_contact_id, p_today)`, EXECUTE for `authenticated` only, as 0078's `document_space_used` is. Because it bypasses RLS it re-checks both fences itself: the account (agency, or a member of that account's organisation; 0078's guard, both halves coalesced) AND the contact (Owner, Staff or agency through `app.sees_all_customers`, or a Technician to whom the contact is assigned through `app.my_contact_ids()`; 0068's rule), else 42501. It answers `(category, state)` rows only. The route still proves the contact on the request client first (`getContact`), as every vault read does.
4. **"Has a clean current version" is read as "has a ready, CLEAN version"** (spec §5.3). 2a's amendment kept `current_version_id` as the newest READY version; what OPENS is the newest clean one (`document-view.ts:38`, `d.versions.find((v) => v.scan_status === "clean") ?? d.version`). A document whose newest version is still being checked, or was just removed, still has an older clean version that opens; it meets the requirement. A document with NO clean version does not.
5. **A fifth state, `checking`** (D10): no file meets the category, but a live one has a ready version still pending its scan. Precedence: `skipped`, then `met`, then `checking`, then `expired`, then `missing`.
6. **"Today" comes from the app**, `documentsClock(db, accountId)` (`lib/documents/document-view.ts:20-26`: the account's zone through `renderZone`, the card's own clock), passed as `p_today date`, so the checklist's "expired" and the card's "Expired 3 days ago" can never use two clocks. A caller who passes another day only changes their own answer.
7. **The meter is the checklist's first line, not the RecordCard's title** (D9).
8. **The Settings card is agency-reached** (D6); its action admits `canManage` (an Owner or the agency) and is listed `owner-only`.
9. **Eight categories, not nine** (D8).

## Assumptions (not verified by reading; each has a named check)

- **A1** PostgREST exposes a SECURITY DEFINER `returns table (category text, state text)` plpgsql function as `rpc("document_requirements", …)` answering a JSON array of `{ category, state }` objects. Check: Task 3's route test fakes that shape; Task 9's e2e reads it end to end; Task 11 step 6's Preview check.
- **A2** `array_position(arr, null)` finds a NULL element (it compares with IS NOT DISTINCT FROM). Check: Task 1's CHECK case inserts `'{insurance,NULL}'` and expects 23514.
- **A3** A CHECK constraint may call an immutable SQL function that reads only its argument (0080's `app.document_request_items_ok` already does). Check: Task 1's replica run.
- **A4** `lucide-react` exports `ListChecks` (the skip rows' icon). Check: `pnpm --filter web typecheck` in Task 4.
- **A5** The poll PR merges as `9fdfc4f7` reads (its `requestsChanged` path calls `setNonce` then `router.refresh()`). Check: Task 7 step 0 reads `documents-card.tsx` on the merged main and STOPS if the router or the files re-read is gone.
- **A6** The e2e default signed-in user is the per-run AGENCY user (`e2e/auth.setup.ts:54-75`), so it reaches Settings. Check: Task 9 test 3 opens `settings#required-documents`.
- (Read, not assumed: `documents.expires_on` is a `date` (0077); `client_group_members` has hard rows, no soft delete (`0069_client_groups.sql:59-75`); `contacts (account_id, id)` is unique (0080's FKs reference it); `accounts` has table-level SELECT for `authenticated` (0031:46-49).)

## File Structure

**Created**

| Path | Owner | Responsibility |
|---|---|---|
| `packages/db/supabase/migrations/0081_document_requirements.sql` | bis-db-schema | the account's list and its CHECK; the skips table, its RLS and grants; the definer read |
| `packages/db/src/test/document-requirements-schema.test.ts` | bis-db-schema | 0081 on the replica: the CHECKs, the skips' constraints, RLS and grants, every state of the read, its two fences, the contact cascade |
| `packages/db/src/document-requirements.ts` (+ `test/document-requirements.test.ts`) | bis-crm | every read and write the app makes for the list, the skips and their timeline rows |
| `apps/web/src/app/api/accounts/[accountId]/contacts/[contactId]/document-requirements/route.ts` (+ test) | bis-crm | the card's checklist read, request client only |
| `apps/web/src/lib/documents/requirements-load.ts` (+ test) | bis-crm | browser-safe: the route's answer parsed, the card's view of it, when to re-read |
| `…/contacts/document-requirements-actions.ts` (+ test) | bis-crm | skip, un-skip, and each one's Undo |
| `…/settings/document-requirements-actions.ts` (+ test) | bis-crm | save the account's list |
| `…/settings/required-documents-card.tsx` (+ test) | bis-frontend | the Settings card |
| `…/contacts/document-checklist.tsx` (+ test) | bis-frontend | the checklist section, presentational |
| `…/contacts/document-checklist-handlers.ts` (+ test) | bis-frontend | what Not needed / Needed again do, toasts and Undo |
| `apps/web/e2e/document-requirements.spec.ts` | bis-e2e-qa | the meter, a skip with Undo, an Upload from a gap, the Settings card |

**Modified:** `packages/db/src/{document-rules,index,record}.ts`; `packages/db/src/test/{record,timeline-merge}.test.ts`; `apps/web/src/lib/record/{author-mark,timeline-rows,recent-rows}.ts` (+ tests); both timelines (+ tests); `…/contacts/contact-drawer.tsx`; `apps/web/src/lib/contacts/drawer-summary.ts` (+ test); `…/summary/route.reads.test.ts`; `apps/web/src/lib/messages.ts`, `messages.test.ts`; `…/accounts/[accountId]/in-account-service-reads.test.ts`; `…/settings/{page.tsx,page.test.ts}`; `apps/web/src/lib/palette/{registry.ts,registry.test.ts}`; `…/contacts/{documents-card.tsx,documents-card.test.ts}`; `…/contacts/[contactId]/{page.tsx,page.test.ts}`; the styleguide demo (+ test); `apps/web/src/lib/i18n/{catalogue,ratchet}-baseline.json`.

## Task list, owners, order

| # | Task | Owner | Review | Depends on | Touches the card? | Files |
|---|---|---|---|---|---|---|
| 0 | Confirm the base; the owner rules D1–D12 | orchestrator | n/a | — | no | none |
| 1 | Migration 0081 and its proof on the replica; the kit | bis-db-schema | **opus** | 0 | no | the migration, `document-requirements-schema.test.ts`, `<SCRATCH>/s07e-kit/*` |
| 2 | Every key (**messages.ts, the only writer**) | bis-crm | sonnet | 0 | no | `lib/messages.ts`, `lib/messages.test.ts` |
| 3 | `@bis/db`: the requirements module, the rules, the barrel | bis-crm | **opus** | 1 | no | `packages/db/src/{document-requirements,document-rules,index}.ts`, `test/document-requirements.test.ts` |
| 4 | The timeline: skip and un-skip rows | bis-crm | **opus** | 1, 2, 3 | no | `record.ts`, its tests, `lib/record/*`, both timelines, the drawer maps, `route.reads.test.ts` |
| 5 | The card's read, its browser parser, the skip actions, the Settings action | bis-crm | **opus** | 2, 3 | no | the route, `requirements-load*`, both action files, two `ALLOWED` lines |
| 6 | The Settings card, its mount, ⌘K | bis-frontend | sonnet | 2, 5 | no | `required-documents-card*`, `settings/page*`, `palette/registry*` |
| 7 | The checklist on the Documents card; the contact page's prop; `/styleguide` | bis-frontend | **opus** | 2, 5, **the poll PR merged** | **yes** | `documents-card*`, `document-checklist*`, `[contactId]/page*`, `styleguide/documents-demo*` |
| 8 | Regenerate the i18n baselines | bis-crm | sonnet | 2, 4, 6, 7 | no | `lib/i18n/*-baseline.json` |
| 9 | The e2e spec | bis-e2e-qa | sonnet | 6, 7, 8 | no | `e2e/document-requirements.spec.ts` |
| 10 | Whole-branch final review (checkpoint) | reviewer | **opus** | 1–9 | — | none |
| 11 | Rollout (orchestrator; LAST) | orchestrator | n/a | 10 | — | none in the repo |

```
Wave A (two lanes):    T1 (bis-db-schema)            T2 (bis-crm)
Wave B:                T3 (bis-crm, after T1)
Wave C (two lanes):    T4 (bis-crm, after T1-T3)     T5 (bis-crm 2nd instance, after T2, T3)
Wave D:                T6 (bis-frontend, after T5)
-- everything above may run before the poll PR merges --
Gate:                  the poll PR (feat/s07-requests-poll) is MERGED to main
Wave E:                T7 (bis-frontend; step 0 merges origin/main into <WT>)
Wave F:                T8, then T9
Checkpoint:            T10
Rollout:               T11 (orchestrator, LAST)
```

Disjointness: T4 (`record.ts`, `lib/record/*`, the timelines, `contact-drawer.tsx`'s `ROW_ICON`, `drawer-summary.ts`, the reads tests) and T5 (the new route, `requirements-load*`, the two action files, two `ALLOWED` lines) share no file. T6 (Settings and the palette) shares no file with T4. T7 is the only task that edits `documents-card.tsx`, and it runs after the poll PR has merged. **0081 goes to bis-ci only AFTER Task 10 approves** (as 2a and 2b did): a finding in the final review that changes 0081 must not need a second migration. Until then the e2e job's migration check is red on every push, expected and named in each CI reading. 0081 is additive (a column with a constant default, a new table, a new function; nothing the live build reads), so it may apply to production BEFORE the merge.

---

## Task 0: Confirm the base; the owner rules D1–D12 (orchestrator)

- [ ] **Step 1.** In `<WT>`: `git log --oneline -2` shows this plan's commit, then `6bf592f9 Staff ask a customer for documents …`. `git fetch origin && git log --oneline origin/main -1`. If `main` moved past `6bf592f9` and the poll PR is NOT what moved it, `git merge origin/main` (never rebase) and re-run Step 2.
- [ ] **Step 2.** Confirm, and stop if any line differs:
  - `ls packages/db/supabase/migrations | tail -1` → `0080_document_requests.sql`; `git log --all --oneline -- 'packages/db/supabase/migrations/0081*'` → nothing.
  - `grep -n "requireAgencyOnlyAccountAccess(accountId)" "apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/settings/page.tsx"` → `62:` (D6's premise).
  - `grep -n 'const MEASURED = 26' "apps/web/src/app/api/accounts/[accountId]/contacts/[contactId]/summary/route.reads.test.ts"` → `63:`.
  - `grep -n "TIMELINE_SOURCES.length + 3" packages/db/src/test/timeline-merge.test.ts` → `146:`.
  - `grep -n '"documents.addedByCustomer.es"' apps/web/src/lib/messages.ts` → `4120:`; `grep -n '"timeline.documentCustomer.es"' apps/web/src/lib/messages.ts` → `4222:`; `grep -n '"palette.settings.website"' apps/web/src/lib/messages.ts` → `2856:`; `wc -l < apps/web/src/lib/messages.test.ts` → `411`.
  - `grep -n '"documents": "proven-target"\|document-requests-actions.ts": "proven-target"' "apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/in-account-service-reads.test.ts"` → one hit, `:95`.
  - `ls "<KIT2B>/replica.sh" "<KIT2B>/pgrst.sh" "<KITSRC>/postgrest.exe" "<KITSRC>/make-jwt.js" "<KITSRC>/proxy.mjs"` → all five exist.
  - Read-only, MCP `execute_sql` on production and `pnpm --filter @bis/db ci:sql` on bis-ci: `select max(version) from supabase_migrations.schema_migrations` names the 0080 apply on both (0080 is applied; never re-apply).
- [ ] **Step 3. The owner rules D1–D12** (the table under "Owner decisions"), one tile each, the recommended answer first. Record each ruling in the ledger. For any ruling against the recommendation, write the named line changes into the affected task's brief BEFORE dispatching it.
- [ ] **Step 4. The poll PR.** `git -C /c/Users/danlo/bis-platform/.claude/worktrees/s07-poll log --oneline -1` and its PR state (`gh pr list --head feat/s07-requests-poll --state all`). Tasks 1–6 dispatch now; Task 7 waits for its merge.

---

## Task 1: Migration 0081 and its proof on the replica; the kit (bis-db-schema)

**Review:** opus. **Runs beside:** Task 2. **Scratch:** `<SCRATCH>/s07e-t1-impl/`, replica port `55600` (reviewer `s07e-t1-review/`, `55601`).

**Files**
- Create: `<SCRATCH>/s07e-kit/replica.sh`, `<SCRATCH>/s07e-kit/pgrst.sh` (outside the repo; "The replica kit")
- Create: `packages/db/supabase/migrations/0081_document_requirements.sql`
- Create: `packages/db/src/test/document-requirements-schema.test.ts`

**Interfaces**
- Consumes (SQL): `public.accounts`, `public.contacts (account_id, id)`, `public.client_group_members` (0069:59-75), `public.documents`, `public.document_versions` (0077, 0079: `status`, `scan_status`), `public.reserve_document_version`, `public.mark_document_version_ready` (0077), `public.record_document_scan` (0079, `(account, version, verdict, signature)`); `app.is_agency()`, `app.current_account_id()`, `app.sees_all_customers(uuid)`, `app.my_contact_ids()` (0068:75-97).
- Produces (SQL); every name below is read by a later task:
  - `accounts.required_document_categories text[] not null default '{}'`, constraint `accounts_required_document_categories_check` through `app.required_document_categories_ok(text[]) returns boolean` (immutable): one-dimensional, no NULL element, each one of the EIGHT requirable keys (D8: `id, contract, estimate, invoice, photo, permit, insurance, warranty`), no duplicate. Order is the writer's; the app writes the vault's order.
  - `public.document_requirement_skips`: `id uuid primary key default gen_random_uuid()`, `account_id`, `contact_id`, `category` (the eight), `skipped_by text`, `created_at timestamptz`, `unskipped_at timestamptz`, `unskipped_by text`. Constraints: `document_requirement_skips_category_check`, `document_requirement_skips_skipped_by_check` (non-blank), `document_requirement_skips_unskip_coherent` (`(unskipped_at is null) = (unskipped_by is null)`), `document_requirement_skips_unskip_after` (`unskipped_at is null or unskipped_at > created_at`), FK `document_requirement_skips_contact_fkey (account_id, contact_id) → contacts (account_id, id) on delete cascade`; unique partial index `document_requirement_skips_active (account_id, contact_id, category) where unskipped_at is null`; index `document_requirement_skips_by_contact (account_id, contact_id)`. RLS on; `authenticated` SELECT under `document_requirement_skips_member_read` + restrictive `document_requirement_skips_technician_scope`; `service_role` all.
  - `public.document_requirements(p_account_id uuid, p_contact_id uuid, p_today date) returns table (category text, state text)`, SECURITY DEFINER, stable, EXECUTE for `authenticated` only. `state` ∈ `met | checking | expired | missing | skipped`. Rows in the account's stored order; none when the list is empty. Raises `22004` on a null argument and `42501` when the caller is outside the account or cannot see the contact.

- [ ] **Step 1: Build the kit.** `mkdir -p <SCRATCH>/s07e-kit`; then

```bash
S=/c/Users/danlo/AppData/Local/Temp/claude/C--Users-danlo-bis-platform/24e55561-31fd-4769-a14a-4ebbd9d987a9/scratchpad
K=/c/Users/danlo/AppData/Local/Temp/claude/C--Users-danlo-bis-platform/f54a0255-9568-420c-ad87-a4d62d6b9a05/scratchpad/s07d-kit
sed -e 's#/worktrees/s07-2b#/worktrees/s07-2c#' -e 's#\*0080_\*#*0081_*#' -e 's#0080_document_requests.sql#0081_document_requirements.sql#g' \
    -e 's#post = pre + 0080#post = pre + 0081#' -e 's#0080 FAILED#0081 FAILED#' -e 's#(no 0080 yet)#(no 0081 yet)#' \
    "$K/replica.sh" > "$S/s07e-kit/replica.sh"
sed -e 's#s07d-local-postgrest#s07e-local-postgrest#' "$K/pgrst.sh" > "$S/s07e-kit/pgrst.sh"
diff "$K/replica.sh" "$S/s07e-kit/replica.sh"; diff "$K/pgrst.sh" "$S/s07e-kit/pgrst.sh"
```
Paste both diffs: only the lines named in "The replica kit" differ. Run `bash "$S/s07e-kit/replica.sh" 55600 "$S/s07e-t1-impl"` → `post = pre (no 0081 yet)`. Run the faithfulness query on `pre` and on bis-ci; paste both; stop if they differ.

- [ ] **Step 2: Read before writing.** `sed -n 1,40p packages/db/supabase/migrations/0078_document_space_used.sql` (the definer guard this function copies), `sed -n 75,97p packages/db/supabase/migrations/0068_mine_unassigned_technician.sql` (`sees_all_customers`, `my_contact_ids`), `sed -n 59,75p packages/db/supabase/migrations/0069_client_groups.sql`, `grep -n "create function public.record_document_scan" -A6 packages/db/supabase/migrations/0079_document_scan.sql` (its argument order; the test below calls it `(account, version, verdict, signature)` as 2b's tests do: if it differs, follow the file and say so), and `sed -n 22,58p packages/db/src/test/document-vault-rls.test.ts` (the seed shape this test copies).

- [ ] **Step 3: Write the failing test** `packages/db/src/test/document-requirements-schema.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import type { Client } from "pg";
import { withRollback, actAs } from "./db";

/**
 * 0081 (S-07 2c, spec 5.1, 5.3; plan deviations 1, 3-5): the account's required list and its CHECK,
 * the skips table (one ACTIVE skip per contact and category, the un-skip kept on the row), who reads
 * the skips, and the definer read's states and its two fences. Its own seed, in the vault RLS suite's
 * shape (document-vault-rls.test.ts:22-58).
 */
const RUN = Math.random().toString(36).slice(2, 10);
const ORG = `org_drq2_${RUN}`;
const ORG_B = `org_drq2b_${RUN}`;
const SUB = { owner: `u_rq_owner_${RUN}`, staff: `u_rq_staff_${RUN}`, tech: `u_rq_tech_${RUN}`, ownerB: `u_rq_ownerb_${RUN}` } as const;
const TODAY = "2026-10-16";
const YESTERDAY = "2026-10-15";

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
  const acct = await one(c, "insert into accounts (agency_id, clerk_org_id, name, client_access_enabled) values ($1,$2,'RQ Co',true) returning id", [agency!.id, ORG]);
  const acctB = await one(c, "insert into accounts (agency_id, clerk_org_id, name, client_access_enabled) values ($1,$2,'RQ B',true) returning id", [agency!.id, ORG_B]);
  const u = {} as Record<keyof typeof SUB, string>;
  for (const k of Object.keys(SUB) as (keyof typeof SUB)[]) u[k] = await one(c, "insert into users (clerk_user_id, email) values ($1, $1 || '@example.com') returning id", [SUB[k]]);
  await c.query(
    "insert into memberships (user_id, scope, account_id, role) values ($1,'account',$5,'owner'), ($2,'account',$5,'staff'), ($3,'account',$5,'technician'), ($4,'account',$6,'owner')",
    [u.owner, u.staff, u.tech, u.ownerB, acct, acctB]);
  const ana = await one(c, "insert into contacts (account_id, first_name, assigned_to) values ($1,'Ana',$2) returning id", [acct, u.tech]);
  const bo = await one(c, "insert into contacts (account_id, first_name) values ($1,'Bo') returning id", [acct]);
  const bea = await one(c, "insert into contacts (account_id, first_name) values ($1,'Bea') returning id", [acctB]);
  const casa = await one(c, "insert into client_groups (account_id, kind, name) values ($1,'household','Casa Ana') returning id", [acct]);
  await c.query("insert into client_group_members (account_id, client_group_id, contact_id, is_primary) values ($1,$2,$3,true)", [acct, casa, ana]);
  return { acct, acctB, ana, bo, bea, casa };
}

const setList = (c: Client, acct: string, list: string) =>
  attempt(c, "update accounts set required_document_categories = $2::text[] where id = $1", [acct, list]);

type FileOpts = {
  contact_id?: string | null; client_group_id?: string | null; category: string; expires_on?: string | null;
  verdict?: "clean" | "pending" | "infected" | "uploading"; trashed?: boolean; owners_only?: boolean;
};
/** A document with ONE version, taken as far as `verdict` says, through 0077/0079's own functions. */
async function file(c: Client, acct: string, o: FileOpts): Promise<string> {
  const doc = await one(c,
    `insert into documents (account_id, contact_id, client_group_id, title, category, expires_on, owners_only, source, created_by)
     values ($1,$2,$3,'F',$4,$5::date,$6,'upload','user_seed') returning id`,
    [acct, o.contact_id ?? null, o.client_group_id ?? null, o.category, o.expires_on ?? null, o.owners_only ?? false]);
  const { rows: [r] } = await c.query<{ r: { version_id: string } }>(
    "select public.reserve_document_version($1, $2, 10, 'application/pdf', 'a.pdf', 'user_seed') as r", [acct, doc]);
  const v = r!.r.version_id;
  const verdict = o.verdict ?? "clean";
  if (verdict !== "uploading") {
    await c.query("select public.mark_document_version_ready($1, $2, $3, 10, $4)", [acct, doc, v, "a".repeat(64)]);
    if (verdict !== "pending") {
      await c.query("select public.record_document_scan($1, $2, $3, $4)", [acct, v, verdict, verdict === "infected" ? "Eicar-Test-Signature" : null]);
    }
  }
  if (o.trashed) await c.query("update documents set deleted_at = now(), deleted_by = 'user_seed' where id = $1", [doc]);
  return doc;
}
const skip = (c: Client, acct: string, contact: string, category: string, by = "user_seed") =>
  attempt<{ id: string }>(c, "insert into document_requirement_skips (account_id, contact_id, category, skipped_by) values ($1,$2,$3,$4) returning id",
    [acct, contact, category, by]);
const states = async (c: Client, acct: string, contact: string, today = TODAY) =>
  (await attempt<{ category: string; state: string }>(c, "select category, state from public.document_requirements($1, $2, $3::date)", [acct, contact, today]))
    .rows.map((r) => [r.category, r.state]);

describe("0081: the account's required list (spec 5.1; D8)", () => {
  it("is empty by default, and an empty list answers no rows (mutation: a non-empty default -> FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      const { rows: [a] } = await c.query<{ l: string[] }>("select required_document_categories as l from accounts where id = $1", [s.acct]);
      expect(a!.l).toEqual([]);
      await actAs(c, { org_id: ORG, sub: SUB.owner });
      expect(await states(c, s.acct, s.ana)).toEqual([]);
    }));

  it("accepts the eight requirable keys in any order; refuses Other, an unknown key, a duplicate, a NULL element and a 2-D array (mutations: drop any clause of app.required_document_categories_ok, or add 'other' -> FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      await setList(c, s.acct, "{insurance,id,contract,estimate,invoice,photo,permit,warranty}");
      for (const bad of ["{other}", "{receipt}", "{id,id}", "{insurance,NULL}", "{{id},{photo}}"]) {
        await expect(setList(c, s.acct, bad), bad).rejects.toMatchObject({ code: "23514", constraint: "accounts_required_document_categories_check" });
      }
    }));
});

describe("0081: document_requirement_skips (spec 5.1; deviation 1)", () => {
  it("one ACTIVE skip per contact and category; after an un-skip the same category can be skipped again (mutation: a full unique on (contact_id, category), or drop the partial index -> FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      const first = (await skip(c, s.acct, s.ana, "insurance")).rows[0]!.id;
      await expect(skip(c, s.acct, s.ana, "insurance")).rejects.toMatchObject({ code: "23505", constraint: "document_requirement_skips_active" });
      await c.query("update document_requirement_skips set unskipped_at = created_at + interval '1 second', unskipped_by = 'user_seed' where id = $1", [first]);
      await skip(c, s.acct, s.ana, "insurance");
      await skip(c, s.acct, s.bo, "insurance");
    }));

  it("an un-skip names who and comes after the skip; Other and unknown keys are refused; another account's contact is refused (mutations: drop unskip_coherent, unskip_after, the category check, or the composite FK -> FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      const id = (await skip(c, s.acct, s.ana, "permit")).rows[0]!.id;
      await expect(attempt(c, "update document_requirement_skips set unskipped_at = created_at + interval '1 second' where id = $1", [id]))
        .rejects.toMatchObject({ code: "23514", constraint: "document_requirement_skips_unskip_coherent" });
      await expect(attempt(c, "update document_requirement_skips set unskipped_at = created_at, unskipped_by = 'x' where id = $1", [id]))
        .rejects.toMatchObject({ code: "23514", constraint: "document_requirement_skips_unskip_after" });
      await expect(skip(c, s.acct, s.ana, "other")).rejects.toMatchObject({ code: "23514", constraint: "document_requirement_skips_category_check" });
      await expect(skip(c, s.acct, s.ana, "  ", "  ")).rejects.toMatchObject({ code: "23514" });
      await expect(skip(c, s.acct, s.bea, "permit")).rejects.toMatchObject({ code: "23503", constraint: "document_requirement_skips_contact_fkey" });
    }));

  it("deleting the contact deletes its skips (mutation: on delete no action -> the delete FAILS 23503)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      await skip(c, s.acct, s.bo, "permit");
      await c.query("delete from contacts where id = $1", [s.bo]);
      const { rows: [n] } = await c.query<{ n: string }>("select count(*)::text as n from document_requirement_skips where contact_id = $1", [s.bo]);
      expect(n!.n).toBe("0");
    }));

  it.each([
    ["owner", ["Ana", "Bo"]], ["staff", ["Ana", "Bo"]], ["tech", ["Ana"]], ["ownerB", []],
  ] as const)("%s reads %j (mutations: drop the technician_scope policy -> tech reads Bo -> FAILS; drop member_read's account clause -> ownerB reads -> FAILS)", (who, want) =>
    withRollback(async (c) => {
      const s = await seed(c);
      await skip(c, s.acct, s.ana, "permit");
      await skip(c, s.acct, s.bo, "permit");
      await actAs(c, { org_id: who === "ownerB" ? ORG_B : ORG, sub: SUB[who] });
      const { rows } = await c.query<{ who: string }>(
        "select ct.first_name as who from document_requirement_skips k join contacts ct on ct.id = k.contact_id order by 1");
      expect(rows.map((r) => r.who)).toEqual(want);
    }));

  it("the client role writes nothing (mutation: grant insert, update or delete to authenticated -> FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      const id = (await skip(c, s.acct, s.ana, "permit")).rows[0]!.id;
      await actAs(c, { org_id: ORG, sub: SUB.owner });
      await expect(attempt(c, "insert into document_requirement_skips (account_id, contact_id, category, skipped_by) values ($1,$2,'insurance','x')", [s.acct, s.ana]))
        .rejects.toMatchObject({ code: "42501" });
      await expect(attempt(c, "update document_requirement_skips set unskipped_at = now(), unskipped_by = 'x' where id = $1", [id])).rejects.toMatchObject({ code: "42501" });
      await expect(attempt(c, "delete from document_requirement_skips where id = $1", [id])).rejects.toMatchObject({ code: "42501" });
      await expect(attempt(c, "update accounts set required_document_categories = '{insurance}' where id = $1", [s.acct])).rejects.toMatchObject({ code: "42501" });
    }));
});

describe("0081: document_requirements, what counts (spec 5.3; D4, D7, D10; deviations 3-5)", () => {
  it("every state, in the account's own order: a group's file meets its member's requirement; a trashed, an infected and an uploading file meet nothing; expiry on TODAY still counts (mutations: '>' for '>=', drop the group branch, drop deleted_at, drop scan_status = 'clean', drop the skip check -> FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      await setList(c, s.acct, "{id,contract,photo,permit,insurance,warranty}");
      await file(c, s.acct, { contact_id: s.ana, category: "id", expires_on: YESTERDAY });
      await file(c, s.acct, { contact_id: s.ana, category: "contract", trashed: true });
      await file(c, s.acct, { contact_id: s.ana, category: "contract", verdict: "infected" });
      await file(c, s.acct, { contact_id: s.ana, category: "contract", verdict: "uploading" });
      await file(c, s.acct, { contact_id: s.ana, category: "photo" });
      await skip(c, s.acct, s.ana, "photo");
      await file(c, s.acct, { client_group_id: s.casa, category: "permit" });
      await file(c, s.acct, { contact_id: s.ana, category: "insurance", expires_on: TODAY });
      await file(c, s.acct, { contact_id: s.ana, category: "warranty", verdict: "pending" });
      await actAs(c, { org_id: ORG, sub: SUB.owner });
      expect(await states(c, s.acct, s.ana)).toEqual([
        ["id", "expired"], ["contract", "missing"], ["photo", "skipped"], ["permit", "met"], ["insurance", "met"], ["warranty", "checking"],
      ]);
      // Bo shares nothing with Ana: Casa's permit is not his.
      expect(await states(c, s.acct, s.bo)).toEqual([
        ["id", "missing"], ["contract", "missing"], ["photo", "missing"], ["permit", "missing"], ["insurance", "missing"], ["warranty", "missing"],
      ]);
    }));

  it("D4: an unexpired copy beside an expired one is met; an expired one beside a pending upload reads checking; an un-skipped category counts again (mutations: newest-file-decides, 'expired' before 'checking', ignore unskipped_at -> FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      await setList(c, s.acct, "{id,insurance,permit}");
      await file(c, s.acct, { contact_id: s.ana, category: "id", expires_on: YESTERDAY });
      await file(c, s.acct, { contact_id: s.ana, category: "id", expires_on: null });
      await file(c, s.acct, { contact_id: s.ana, category: "insurance", expires_on: YESTERDAY });
      await file(c, s.acct, { contact_id: s.ana, category: "insurance", verdict: "pending" });
      const k = (await skip(c, s.acct, s.ana, "permit")).rows[0]!.id;
      await c.query("update document_requirement_skips set unskipped_at = created_at + interval '1 second', unskipped_by = 'user_seed' where id = $1", [k]);
      await actAs(c, { org_id: ORG, sub: SUB.owner });
      expect(await states(c, s.acct, s.ana)).toEqual([["id", "met"], ["insurance", "checking"], ["permit", "missing"]]);
    }));

  it("D7: an Owners-only file meets the requirement for Staff, who cannot read the file itself (mutation: security invoker -> Staff reads missing -> FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      await setList(c, s.acct, "{insurance}");
      await file(c, s.acct, { contact_id: s.ana, category: "insurance", owners_only: true });
      await actAs(c, { org_id: ORG, sub: SUB.staff });
      const { rows: [seen] } = await c.query<{ n: string }>("select count(*)::text as n from documents where contact_id = $1", [s.ana]);
      expect(seen!.n).toBe("0");
      expect(await states(c, s.acct, s.ana)).toEqual([["insurance", "met"]]);
    }));

  it("its fences: another account's member, and a Technician for a customer not theirs, get 42501; a null argument 22004; only authenticated may run it (mutations: drop either guard, or grant execute to anon -> FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      await setList(c, s.acct, "{insurance}");
      const { rows: [g] } = await c.query<{ anon: boolean; auth: boolean }>(
        "select has_function_privilege('anon', 'public.document_requirements(uuid, uuid, date)', 'EXECUTE') as anon, has_function_privilege('authenticated', 'public.document_requirements(uuid, uuid, date)', 'EXECUTE') as auth");
      expect(g).toEqual({ anon: false, auth: true });
      await actAs(c, { org_id: ORG_B, sub: SUB.ownerB });
      await expect(states(c, s.acct, s.ana)).rejects.toMatchObject({ code: "42501" });
      await actAs(c, { org_id: ORG, sub: SUB.tech });
      expect(await states(c, s.acct, s.ana)).toEqual([["insurance", "missing"]]);
      await expect(states(c, s.acct, s.bo)).rejects.toMatchObject({ code: "42501" });
      await expect(attempt(c, "select * from public.document_requirements($1, null, $2::date)", [s.acct, TODAY])).rejects.toMatchObject({ code: "22004" });
      await actAs(c, { org_id: ORG, sub: SUB.staff });
      expect(await states(c, s.acct, s.bo)).toEqual([["insurance", "missing"]]);
    }));
});
```

Note on the Technician: `tech` is assigned Ana (`contacts.assigned_to`), the rule `app.my_contact_ids()` reads (0068:83-89). If the replica shows otherwise, read `app.my_contact_ids()` and report: the expected list follows the function, not this plan.

- [ ] **Step 4: Run it to see it fail.** `cd packages/db && SUPABASE_DB_URL=postgresql://postgres@localhost:55600/post node node_modules/vitest/vitest.mjs run src/test/document-requirements-schema.test.ts > "$S/s07e-t1-impl/red.log" 2>&1; echo $? > "$S/s07e-t1-impl/red.exit"`. Expected: every case FAILS (no column, no table, no function). Paste the summary block.

- [ ] **Step 5: Write the migration** `packages/db/supabase/migrations/0081_document_requirements.sql` (ASCII only, no backslash):

```sql
-- 0081_document_requirements.sql - the document vault, part 2c: the "7 de 9" checklist
-- (docs/superpowers/specs/2026-10-15-document-vault-part2-design.md section 5;
--  docs/superpowers/plans/2026-10-16-document-vault-pr2c.md)
--
-- An account lists the documents every customer must have (accounts.required_document_categories;
-- empty = the checklist is off). A customer for whom one does not apply is skipped for it
-- (document_requirement_skips): one ACTIVE skip per contact and category; an un-skip stamps the row
-- (unskipped_at, unskipped_by) instead of deleting it, so the skip and the un-skip each keep their
-- timeline row (plan deviation 1). Server-written only; members read skips under the contact's
-- visibility. Other is never required (owner ruling D8): anything filed as Other would meet it.
-- One read, public.document_requirements, answers each required category's state for one customer:
-- met (a live document of that category, on the customer or on a household or business they belong
-- to, with a ready CLEAN version, not expired on p_today in the account's own zone), checking (none
-- met, but one has a ready version still pending its scan), expired (none met, one clean but past
-- its date), missing, or skipped. SECURITY DEFINER because the answer is the CUSTOMER's (owner
-- ruling D7): an Owners-only file meets the requirement for Staff too. It answers states only, never
-- a file, a title or an id, and re-checks both fences itself: the caller is the agency or a member of
-- the account's organisation (0078's guard), and can see the contact (0068: Owner, Staff and the
-- agency see every customer; a Technician only those assigned to them). Every guard coalesces:
-- app.is_agency() is NULL for a client token, and a NULL in an IF would fall through, open.
--
-- APPLY ORDER: CI project (ci-project-setup.yml: push-dry-run, then push), then production (MCP
-- apply_migration, once), then the parity check, then merge. Additive: the build before it reads none of it.
--
-- Rollback (by hand, in this order; revert the app first):
--   drop function public.document_requirements(uuid, uuid, date);
--   drop table public.document_requirement_skips;
--   alter table public.accounts drop constraint accounts_required_document_categories_check,
--     drop column required_document_categories;
--   drop function app.required_document_categories_ok(text[]);
--   Lost: every account's list and every skip.
--
-- ASCII only, no backslash anywhere.

-- 0. Fail fast instead of queueing behind a long lock on accounts (adding the column and its CHECK
--    takes ACCESS EXCLUSIVE briefly; a queued one blocks every later reader).
set local lock_timeout = '5s';

-- 1. The list. One-dimensional, no NULL, each one of the eight requirable keys, no duplicate. The
--    CASE keeps array_position away from a 2-D array (it raises on one) and makes the order explicit.
create function app.required_document_categories_ok(p_categories text[]) returns boolean
language sql immutable set search_path = '' as $$
  select case
    when p_categories is null then false
    when coalesce(array_ndims(p_categories), 1) <> 1 then false
    else coalesce(
      array_position(p_categories, null) is null
      and p_categories <@ array['id', 'contract', 'estimate', 'invoice', 'photo', 'permit', 'insurance', 'warranty']::text[]
      and cardinality(p_categories) = (select count(distinct x) from unnest(p_categories) as x),
      false)
  end
$$;
revoke all on function app.required_document_categories_ok(text[]) from public, anon;
grant execute on function app.required_document_categories_ok(text[]) to authenticated, service_role;

-- No grant on the column (0031's rule): accounts is edited per column by clients, and this one is
-- written only by the save action, through the service client, after its own role check.
alter table public.accounts add column required_document_categories text[] not null default '{}'
  constraint accounts_required_document_categories_check
  check (app.required_document_categories_ok(required_document_categories));
comment on column public.accounts.required_document_categories is
  'The documents every customer must have (0081). Empty = the Documents card shows no checklist. Service-client write only.';

-- 2. Skips. Server-written only; members read under the contact's visibility.
create table public.document_requirement_skips (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  contact_id uuid not null,
  category text not null constraint document_requirement_skips_category_check
    check (category in ('id', 'contract', 'estimate', 'invoice', 'photo', 'permit', 'insurance', 'warranty')),
  skipped_by text not null constraint document_requirement_skips_skipped_by_check check (btrim(skipped_by) <> ''),
  created_at timestamptz not null default now(),
  unskipped_at timestamptz,
  unskipped_by text,
  constraint document_requirement_skips_unskip_coherent check ((unskipped_at is null) = (unskipped_by is null)),
  constraint document_requirement_skips_unskip_after check (unskipped_at is null or unskipped_at > created_at),
  constraint document_requirement_skips_contact_fkey foreign key (account_id, contact_id)
    references public.contacts (account_id, id) on delete cascade
);
create unique index document_requirement_skips_active on public.document_requirement_skips (account_id, contact_id, category)
  where unskipped_at is null;
create index document_requirement_skips_by_contact on public.document_requirement_skips (account_id, contact_id);
comment on table public.document_requirement_skips is
  'A required document a customer does not need (0081). Active while unskipped_at is null. Server-written only; authenticated reads under the contact''s visibility.';

alter table public.document_requirement_skips enable row level security;
revoke all on public.document_requirement_skips from anon, authenticated;
grant select on public.document_requirement_skips to authenticated;
grant select, insert, update, delete on public.document_requirement_skips to service_role;
create policy document_requirement_skips_member_read on public.document_requirement_skips for select to authenticated
  using (app.is_agency() or account_id = app.current_account_id());
create policy document_requirement_skips_technician_scope on public.document_requirement_skips as restrictive for select to authenticated
  using ((select app.sees_all_customers(app.current_account_id())) or contact_id in (select app.my_contact_ids()));

-- 3. The read. One row per required category, in the account's stored order.
create function public.document_requirements(p_account_id uuid, p_contact_id uuid, p_today date)
returns table (category text, state text)
language plpgsql stable security definer set search_path = '' as $$
#variable_conflict use_column
begin
  if p_account_id is null or p_contact_id is null or p_today is null then
    raise exception 'document_requirements: a required argument is null' using errcode = '22004';
  end if;
  if not (coalesce(app.is_agency(), false) or coalesce(p_account_id = app.current_account_id(), false)) then
    raise exception 'document_requirements: not this account' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.contacts c
     where c.account_id = p_account_id and c.id = p_contact_id
       and (coalesce(app.sees_all_customers(p_account_id), false) or c.id in (select app.my_contact_ids()))) then
    raise exception 'document_requirements: not this contact' using errcode = '42501';
  end if;
  return query
  with req as (
    select r.cat, r.ord
      from public.accounts a
     cross join lateral unnest(a.required_document_categories) with ordinality as r(cat, ord)
     where a.id = p_account_id
  ),
  held as (
    select d.id, d.category as cat, d.expires_on
      from public.documents d
     where d.account_id = p_account_id and d.deleted_at is null
       and (d.contact_id = p_contact_id
            or d.client_group_id in (select m.client_group_id from public.client_group_members m
                                       where m.account_id = p_account_id and m.contact_id = p_contact_id))
  ),
  st as (
    select h.cat,
           coalesce(bool_or(cl.ok and (h.expires_on is null or h.expires_on >= p_today)), false) as met,
           coalesce(bool_or(cl.ok), false) as has_clean,
           coalesce(bool_or(pe.ok), false) as checking
      from held h
      left join lateral (select true as ok from public.document_versions v
                          where v.document_id = h.id and v.account_id = p_account_id
                            and v.status = 'ready' and v.scan_status = 'clean' limit 1) cl on true
      left join lateral (select true as ok from public.document_versions v
                          where v.document_id = h.id and v.account_id = p_account_id
                            and v.status = 'ready' and v.scan_status = 'pending' limit 1) pe on true
     group by h.cat
  )
  select req.cat,
         case
           when exists (select 1 from public.document_requirement_skips k
                         where k.account_id = p_account_id and k.contact_id = p_contact_id
                           and k.category = req.cat and k.unskipped_at is null) then 'skipped'
           when coalesce(st.met, false) then 'met'
           when coalesce(st.checking, false) then 'checking'
           when coalesce(st.has_clean, false) then 'expired'
           else 'missing'
         end
    from req left join st on st.cat = req.cat
   order by req.ord;
end $$;
revoke all on function public.document_requirements(uuid, uuid, date) from public, anon, authenticated, service_role;
grant execute on function public.document_requirements(uuid, uuid, date) to authenticated;
```

(`cl.ok` is NULL when the lateral finds nothing; `NULL and …` is NULL and `bool_or` skips NULLs, so `coalesce(…, false)` is what makes a category with only unclean files read `false`, not NULL. The CTE columns are named `cat`, not `category`, so they never meet the OUT parameter `category`; `#variable_conflict use_column` is a belt on top.)

- [ ] **Step 5b: Read the lock line back.** `head -40 packages/db/supabase/migrations/0081_document_requirements.sql | grep -n "lock_timeout"` shows `set local lock_timeout = '5s';` BEFORE the first `create` (a `set local` outside a transaction is a warning, not an error, and both the replica's `psql -1` and MCP `apply_migration` run the file in one transaction).

- [ ] **Step 6: ASCII and backslash check**, with a positive control:

```bash
node -e '
const fs=require("fs");const f="packages/db/supabase/migrations/0081_document_requirements.sql";
const b=fs.readFileSync(f);let bad=0,bs=0;for(const x of b){if(x>127)bad++;if(x===92)bs++;}
const ctl=Buffer.from("a"+String.fromCharCode(92)+"b");let c=0;for(const x of ctl)if(x===92)c++;
console.log(JSON.stringify({nonAscii:bad,backslash:bs,control:c}));'
```
Expected `{"nonAscii":0,"backslash":0,"control":1}`. Paste it and `md5sum packages/db/supabase/migrations/0081_document_requirements.sql`.

- [ ] **Step 7: Run on the replica, post = pre + 0081.** `bash "$S/s07e-kit/replica.sh" 55600 "$S/s07e-t1-impl"` → `post = pre + 0081`. On `post`: `document-requirements-schema.test.ts`, `schema-grants-guard.test.ts`, `weekly-report-grants.test.ts`, `alert-phone-grants.test.ts`, `document-vault-schema.test.ts`, `document-vault-rls.test.ts`. Expected: all PASS; the three guards unchanged. Paste the summary blocks.

- [ ] **Step 8: Mutation probes, each by name** (a `create or replace`, `alter` or `drop` on the replica's `post`, run the named case, then rebuild with `replica.sh`; never edit the committed file for a probe): (a) `app.required_document_categories_ok` with `'other'` in its list → the list case FAILS on `{other}`; (b) without the `count(distinct …)` clause → FAILS on `{id,id}`; (c) `drop index document_requirement_skips_active` → the one-active case FAILS; (d) `drop policy document_requirement_skips_technician_scope` → the `tech` row FAILS; (e) the function with `h.expires_on > p_today` → the every-state case FAILS on `insurance`; (f) without the `client_group_id in (…)` branch → FAILS on `permit`; (g) without `and d.deleted_at is null` → FAILS on `contract`; (h) without `and v.scan_status = 'clean'` in `cl` → FAILS on `contract` or `warranty`; (i) `alter function public.document_requirements(uuid, uuid, date) security invoker` → the D7 case FAILS; (j) the contact guard removed → the fences case FAILS on `bo` for `tech`. Paste each failing assertion line.

- [ ] **Step 9: Commit.**

```bash
git commit -m "db(0081): the account's required documents, per-customer skips kept on the row, and one definer read of each requirement's state" \
  -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>" -m "Claude-Session: https://claude.ai/code/session_013RThMy9QC8x7FZ94Lxib9p" -- \
  packages/db/supabase/migrations/0081_document_requirements.sql packages/db/src/test/document-requirements-schema.test.ts
```

---

## Task 2: Every key (bis-crm; messages.ts, the only writer)

**Review:** sonnet. **Runs beside:** Task 1.

**Files**
- Modify: `apps/web/src/lib/messages.ts` (the `documents.checklist.*` keys after `"documents.addedByCustomer.es"`, `:4120`; the two `timeline.*` keys after `"timeline.documentCustomer.es"`, `:4222`; the `settings.requiredDocuments.*` keys after the last `settings.alertPhone…` key (`:1134` area, read it); `palette.settings.requiredDocuments` after `"palette.settings.website"`, `:2856`)
- Modify: `apps/web/src/lib/messages.test.ts` (one new `describe` at the end, after `:411`)

**Interfaces**
- Produces: every key below (English, then `.es` on the next line). Later tasks use these names exactly; a task that needs another STOPS.

- [ ] **Step 1: Write the failing test** at the end of `messages.test.ts`:

```ts
describe("the document vault's copy, PR 2c (the required-documents checklist)", () => {
  const WANT: Record<string, [string, string]> = {
    "documents.checklist.label": ["Required", "Requeridos"],
    "documents.checklist.meter": ["{met} of {required}", "{met} de {required}"],
    "documents.checklist.complete": ["Complete", "Completo"],
    "documents.checklist.missing": ["Missing: {category}", "Falta: {category}"],
    "documents.checklist.expired": ["Expired: {category}", "Vencido: {category}"],
    "documents.checklist.checking": ["Checking: {category}", "Revisando: {category}"],
    "documents.checklist.notNeeded": ["{category} · Not needed", "{category} · No hace falta"],
    "documents.checklist.skip": ["Not needed", "No hace falta"],
    "documents.checklist.unskip": ["Needed again", "Hace falta otra vez"],
    "documents.checklist.skipped": ["{category} isn't needed for this customer.", "{category} no hace falta para este cliente."],
    "documents.checklist.unskipped": ["{category} is needed again.", "{category} hace falta otra vez."],
    "documents.checklist.loadFailed": ["Couldn't load the list.", "No se pudo cargar la lista."],
    "documents.checklist.skipRole": ["Only an Owner or Staff can change a customer's list.", "Solo un dueño o un empleado puede cambiar la lista de un cliente."],
    "documents.checklist.changed": ["Someone changed this first. Reload to see it.", "Alguien lo cambió primero. Vuelva a cargar para verlo."],
    "documents.checklist.notRequired": ["That document isn't on the list anymore.", "Ese documento ya no está en la lista."],
    "timeline.documentSkip": ["marked {category} as not needed", "marcó que {category} no hace falta"],
    "timeline.documentUnskip": ["marked {category} as needed again", "marcó que {category} hace falta otra vez"],
    "settings.requiredDocuments.title": ["Required documents", "Documentos requeridos"],
    "settings.requiredDocuments.body": ["Each customer's Documents card will show which of these they're missing.", "La tarjeta de Documentos de cada cliente mostrará cuáles de estos le faltan."],
    "settings.requiredDocuments.off": ["Nothing is required yet, so the list is off.", "Todavía no se requiere nada, así que la lista está apagada."],
    "settings.requiredDocuments.saved": ["Saved. Each customer's Documents card shows the list.", "Guardado. La tarjeta de Documentos de cada cliente muestra la lista."],
    "settings.requiredDocuments.savedOff": ["Saved. The list is off.", "Guardado. La lista está apagada."],
    "settings.requiredDocuments.role": ["Only an Owner can change this list.", "Solo un dueño puede cambiar esta lista."],
    "settings.requiredDocuments.failed": ["Couldn't save the list. Try again.", "No se pudo guardar la lista. Intente de nuevo."],
    "palette.settings.requiredDocuments": ["Required documents", "Documentos requeridos"],
  };
  it("every new key is the plan's wording, in both languages (mutation: any word changed, or a tú form such as 'Vuelve' -> FAILS)", () => {
    for (const [k, [en, es]] of Object.entries(WANT)) {
      expect([m[k as MessageKey], m[`${k}.es` as MessageKey]], k).toEqual([en, es]);
    }
  });
  it("no new string names the machinery or the customer (mutation: 'Couldn't load the skip rows' or a {name} -> FAILS)", () => {
    for (const k of Object.keys(WANT)) {
      for (const text of [m[k as MessageKey], m[`${k}.es` as MessageKey]]) {
        expect(typeof text, k).toBe("string");
        expect(/token|rls|definer|skip row|category key|supabase|bucket|\{name\}|\{business\}/i.test(text ?? "x"), k).toBe(false);
        expect(/\b(vuelve|intenta|elige|sube|pide)\b/i.test(text ?? "x"), k).toBe(false);
      }
    }
  });
  it("a placeholder in English is a placeholder in Spanish (mutation: drop {category} from documents.checklist.missing.es -> FAILS)", () => {
    const holes = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((x) => x[1]).sort().join(",");
    for (const k of Object.keys(WANT)) expect(holes(m[`${k}.es` as MessageKey]), k).toBe(holes(m[k as MessageKey]));
  });
});
```

- [ ] **Step 2: Run it to see it fail.** `pnpm --filter web exec vitest run src/lib/messages.test.ts` → the new describe FAILS (keys missing).
- [ ] **Step 3: Add the keys** to `messages.ts`, each English line followed directly by its `.es` line, with exactly the strings in `WANT` (copy them from the test; the middle dot is `·`, U+00B7, as in `documents.addedByCustomer`, `:4119`).
- [ ] **Step 4: Run it to pass**, plus `src/lib/i18n/ratchet.test.ts` → PASS. `pnpm --filter web typecheck` → 0.
- [ ] **Step 5: Probe.** Change `"documents.checklist.changed.es"` to `"Alguien lo cambió primero. Vuelve a cargar para verlo."` → cases 1 and 2 FAIL by name; edit back. Delete `{category}` from `"documents.checklist.missing.es"` → case 3 FAILS; edit back. Paste both failing lines.
- [ ] **Step 6: Commit** `git commit -m "copy: the document vault PR 2c keys, English and Spanish" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>" -m "Claude-Session: https://claude.ai/code/session_013RThMy9QC8x7FZ94Lxib9p" -- apps/web/src/lib/messages.ts apps/web/src/lib/messages.test.ts`.

---

## Task 3: `@bis/db`: the requirements module, the rules, the barrel (bis-crm)

**Review:** opus. **Scratch:** `<SCRATCH>/s07e-t3-impl/`, ports `55602`/`55603`/`55604` (reviewer `55605`/`55606`/`55607`).

**Files**
- Create: `packages/db/src/document-requirements.ts`, `packages/db/src/test/document-requirements.test.ts`
- Modify: `packages/db/src/document-rules.ts` (append the 2c block), `packages/db/src/index.ts` (one export block after the `./document-requests` block, `:294-301`, and the new rules names in the `./document-rules` block, `:283-293`)

**Interfaces**
- Consumes: 0081 (Task 1); `DOCUMENT_CATEGORIES`, `DocumentCategory` (`document-rules.ts:23-24`); `forContacts`, `withTimelinePage`, `TimelinePageOpts` (`timeline-cursor.ts`).
- Produces (browser-safe, `@bis/db/document-rules`):
  - `REQUIRABLE_DOCUMENT_CATEGORIES = ["id", "contract", "estimate", "invoice", "photo", "permit", "insurance", "warranty"] as const` (D8; 0081's two CHECKs hold the same list); `type RequirableCategory`; `isRequirableCategory(v: unknown): v is RequirableCategory`.
  - `REQUIREMENT_STATES = ["met", "checking", "expired", "missing", "skipped"] as const`; `type RequirementState`; `isRequirementState(v: unknown): v is RequirementState`.
  - `cleanRequiredCategories(raw: unknown): RequirableCategory[] | null`: an array of strings, each requirable; duplicates dropped; answered in `REQUIRABLE_DOCUMENT_CATEGORIES` order; `null` for anything else (not an array, a non-string, an unknown key, `other`). An empty array is `[]` (off).
  - `requirementsMeter(items: readonly { state: RequirementState }[]): { met: number; required: number }`: `required` counts every item not skipped, `met` the `met` ones.
  - `DOCUMENT_REQUIREMENT_UNDO_MS = 600_000` (10 minutes; the actions' window).
- Produces (`@bis/db` barrel, server):
  - `type DocumentRequirement = { category: RequirableCategory; state: RequirementState }`; `listDocumentRequirements(db, accountId: string, contactId: string, today: string): Promise<DocumentRequirement[]>` (the request client; `rpc("document_requirements")`; THROWS on an error, on a non-array answer, or on any row whose category or state is unknown).
  - `getRequiredDocumentCategories(db, accountId): Promise<RequirableCategory[]>` (THROWS on an error or a missing account; a stored list is re-cleaned, and an unknown element throws).
  - `setRequiredDocumentCategories(db, accountId, categories: unknown): Promise<RequirableCategory[]>` (service client; `cleanRequiredCategories` first, `TypeError` on `null`; writes the cleaned list; THROWS when no account row was updated; answers what it wrote).
  - `type DocumentSkipRow = { id: string; account_id: string; contact_id: string; category: RequirableCategory; skipped_by: string; created_at: string; unskipped_at: string | null; unskipped_by: string | null }`.
  - `getActiveDocumentSkip(db, accountId, contactId, category): Promise<DocumentSkipRow | null>`; `getDocumentSkip(db, accountId, skipId): Promise<DocumentSkipRow | null>` (the actions' proof reads, on the REQUEST client).
  - `skipDocumentRequirement(db, a: { accountId; contactId; category: RequirableCategory; actorId; now: Date }): Promise<{ status: "skipped"; skip: DocumentSkipRow } | { status: "already" }>` (service client; a 23505 on `document_requirement_skips_active` is `already`).
  - `undoDocumentSkip(db, accountId, skipId, actorId): Promise<boolean>` (service client; deletes only a row still active, skipped by `actorId`).
  - `unskipDocumentRequirement(db, accountId, skipId, actorId, now: Date): Promise<{ unskippedAt: string } | null>` (service client; compare-and-set from active; answers the stored instant exactly as PostgREST returned it).
  - `undoDocumentUnskip(db, accountId, skipId, expectedUnskippedAt: string, actorId): Promise<boolean>` (service client; clears only while `unskipped_at` equals `expectedUnskippedAt` and `unskipped_by = actorId`; a 23505 (another skip became active meanwhile) is `false`).
  - `type TimelineDocumentSkip = { id: string; category: RequirableCategory; contact_id: string; skipped_by: string; created_at: string; unskipped_by: string | null; unskipped_at: string | null }`; `listDocumentSkipTimeline(db, accountId, who: string | readonly string[], page: TimelinePageOpts): Promise<{ skips: TimelineDocumentSkip[]; unskips: TimelineDocumentSkip[] }>` (two reads: by `created_at`, and the un-skipped rows by `unskipped_at`; each paged with `withTimelinePage`).

- [ ] **Step 1: Read before writing.** `sed -n 1,60p packages/db/src/documents.ts`, `sed -n 1,80p packages/db/src/document-requests.ts` (its file header, its `REQ_COLS`-style select list, its revoke/restore compare-and-set at the matching lines: `grep -n "export async function revokeDocumentRequest\|export async function restoreDocumentRequest" -A20 packages/db/src/document-requests.ts`), `grep -n "export async function listDocumentScanTimeline" -A14 packages/db/src/documents.ts` (the timeline read this copies), `sed -n 1,40p packages/db/src/document-rules.ts`, `sed -n 265,302p packages/db/src/index.ts`, `sed -n 500,530p packages/db/src/test/documents.test.ts` (the fake-rpc shape for `documentSpaceUsed`). Start the kit: `bash <SCRATCH>/s07e-kit/replica.sh 55602 <SCRATCH>/s07e-t3-impl && bash <SCRATCH>/s07e-kit/pgrst.sh 55602 55603 55604 <SCRATCH>/s07e-t3-impl` → `post = pre + 0081`.

- [ ] **Step 2: Write the failing test** `packages/db/src/test/document-requirements.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { withTestAccount } from "./fixtures";
import { createContact } from "../contacts";
import {
  listDocumentRequirements, getRequiredDocumentCategories, setRequiredDocumentCategories, getActiveDocumentSkip, getDocumentSkip,
  skipDocumentRequirement, undoDocumentSkip, unskipDocumentRequirement, undoDocumentUnskip, listDocumentSkipTimeline,
} from "../document-requirements";
import { cleanRequiredCategories, requirementsMeter, REQUIRABLE_DOCUMENT_CATEGORIES, DOCUMENT_CATEGORIES } from "../document-rules";

/**
 * The requirements module (spec 5.1-5.4) on the service client behind PostgREST on the replica (the
 * actions hold one AFTER their proof), plus the read's wrapper on a fake rpc client: the definer read
 * refuses the service role by design (it has no account in its token), and its SQL is
 * document-requirements-schema.test.ts's job.
 */
const ACTOR = "user_drq2_test";
const OTHER = "user_drq2_other";
const NOW = new Date();
const later = (ms: number) => new Date(NOW.getTime() + ms);
const page = { limit: 31 };

describe("document-rules: the list's pure rules (spec 5.1; D8)", () => {
  it("cleanRequiredCategories keeps the SQL check's rules and the vault's order (mutations: allow 'other'; keep a duplicate; keep the caller's order -> FAILS)", () => {
    expect(cleanRequiredCategories(["warranty", "id", "id", "insurance"])).toEqual(["id", "insurance", "warranty"]);
    expect(cleanRequiredCategories([])).toEqual([]);
    for (const bad of [["other"], ["receipt"], [null], [1], "id", null, { id: true }]) {
      expect(cleanRequiredCategories(bad), JSON.stringify(bad)).toBeNull();
    }
    expect([...REQUIRABLE_DOCUMENT_CATEGORIES]).toEqual(DOCUMENT_CATEGORIES.filter((c) => c !== "other"));
  });
  it("requirementsMeter leaves skipped items out of both numbers (spec 5.3; mutation: count skipped as required -> FAILS)", () => {
    expect(requirementsMeter([{ state: "met" }, { state: "missing" }, { state: "skipped" }, { state: "checking" }, { state: "expired" }]))
      .toEqual({ met: 1, required: 4 });
    expect(requirementsMeter([{ state: "skipped" }])).toEqual({ met: 0, required: 0 });
  });
});

describe("listDocumentRequirements: the read's wrapper (fake rpc)", () => {
  const fake = (answer: { data: unknown; error: { message: string } | null }) => {
    const calls: unknown[][] = [];
    return { calls, client: { rpc: async (...a: unknown[]) => { calls.push(a); return answer; } } as unknown as SupabaseClient };
  };
  it("calls the function with the account, the contact and the account's today, and answers the rows (mutation: pass the server's UTC day -> FAILS)", async () => {
    const f = fake({ data: [{ category: "insurance", state: "met" }, { category: "id", state: "checking" }], error: null });
    expect(await listDocumentRequirements(f.client, "acc-1", "ct-1", "2026-10-16")).toEqual([
      { category: "insurance", state: "met" }, { category: "id", state: "checking" }]);
    expect(f.calls).toEqual([["document_requirements", { p_account_id: "acc-1", p_contact_id: "ct-1", p_today: "2026-10-16" }]]);
  });
  it("throws on an error, a null answer, an unknown category or state (mutation: answer [] for a null -> the card would read 'off' for a failure -> FAILS)", async () => {
    await expect(listDocumentRequirements(fake({ data: null, error: { message: "x" } }).client, "a", "c", "2026-10-16")).rejects.toThrow(/document_requirements/);
    await expect(listDocumentRequirements(fake({ data: null, error: null }).client, "a", "c", "2026-10-16")).rejects.toThrow(/unexpected answer/);
    await expect(listDocumentRequirements(fake({ data: [{ category: "other", state: "met" }], error: null }).client, "a", "c", "2026-10-16")).rejects.toThrow(/unexpected answer/);
    await expect(listDocumentRequirements(fake({ data: [{ category: "id", state: "done" }], error: null }).client, "a", "c", "2026-10-16")).rejects.toThrow(/unexpected answer/);
  });
});

describe("the list on the account (spec 5.2)", () => {
  it("set writes the cleaned list and get reads it back; a bad list writes nothing (mutations: write the raw input; swallow the TypeError -> FAILS)", () =>
    withTestAccount(async (db, accountId) => {
      expect(await getRequiredDocumentCategories(db, accountId)).toEqual([]);
      expect(await setRequiredDocumentCategories(db, accountId, ["insurance", "id", "insurance"])).toEqual(["id", "insurance"]);
      expect(await getRequiredDocumentCategories(db, accountId)).toEqual(["id", "insurance"]);
      await expect(setRequiredDocumentCategories(db, accountId, ["other"])).rejects.toThrow(TypeError);
      expect(await getRequiredDocumentCategories(db, accountId)).toEqual(["id", "insurance"]);
      await expect(setRequiredDocumentCategories(db, crypto.randomUUID(), ["id"])).rejects.toThrow(/no account/);
    }));
});

describe("skips: at once, with the actor's own Undo (spec 5.4; deviations 1, 2)", () => {
  it("skip, a second skip is 'already', the proof reads find it, un-skip stamps it, a new skip is allowed after (mutation: un-skip deletes the row -> FAILS)", () =>
    withTestAccount(async (db, accountId) => {
      const ana = (await createContact(db, accountId, { firstName: "Ana" }, ACTOR)).id;
      const s = await skipDocumentRequirement(db, { accountId, contactId: ana, category: "insurance", actorId: ACTOR, now: NOW });
      if (s.status !== "skipped") throw new Error(s.status);
      expect(await skipDocumentRequirement(db, { accountId, contactId: ana, category: "insurance", actorId: OTHER, now: NOW })).toEqual({ status: "already" });
      expect((await getActiveDocumentSkip(db, accountId, ana, "insurance"))?.id).toBe(s.skip.id);
      const u = await unskipDocumentRequirement(db, accountId, s.skip.id, OTHER, later(1000));
      expect(u).not.toBeNull();
      expect(await unskipDocumentRequirement(db, accountId, s.skip.id, OTHER, later(2000))).toBeNull();
      const row = await getDocumentSkip(db, accountId, s.skip.id);
      expect([row?.unskipped_by, row?.unskipped_at]).toEqual([OTHER, u!.unskippedAt]);
      expect(await getActiveDocumentSkip(db, accountId, ana, "insurance")).toBeNull();
      expect((await skipDocumentRequirement(db, { accountId, contactId: ana, category: "insurance", actorId: ACTOR, now: later(3000) })).status).toBe("skipped");
    }));

  it("Undo of a skip deletes only the actor's own active row; Undo of an un-skip restores only the actor's own, at the instant it named, and never over a newer skip (mutations: drop the skipped_by filter; restore with a fresh now; ignore the 23505 -> FAILS)", () =>
    withTestAccount(async (db, accountId) => {
      const ana = (await createContact(db, accountId, { firstName: "Ana" }, ACTOR)).id;
      const a = await skipDocumentRequirement(db, { accountId, contactId: ana, category: "id", actorId: ACTOR, now: NOW });
      if (a.status !== "skipped") throw new Error(a.status);
      expect(await undoDocumentSkip(db, accountId, a.skip.id, OTHER)).toBe(false);
      expect(await undoDocumentSkip(db, accountId, a.skip.id, ACTOR)).toBe(true);
      expect(await getDocumentSkip(db, accountId, a.skip.id)).toBeNull();

      const b = await skipDocumentRequirement(db, { accountId, contactId: ana, category: "id", actorId: ACTOR, now: later(1000) });
      if (b.status !== "skipped") throw new Error(b.status);
      const u = await unskipDocumentRequirement(db, accountId, b.skip.id, ACTOR, later(2000));
      expect(await undoDocumentUnskip(db, accountId, b.skip.id, later(2000).toISOString().replace("Z", "1Z"), ACTOR)).toBe(false);
      expect(await undoDocumentUnskip(db, accountId, b.skip.id, u!.unskippedAt, OTHER)).toBe(false);
      const c = await skipDocumentRequirement(db, { accountId, contactId: ana, category: "id", actorId: OTHER, now: later(3000) });
      expect(c.status).toBe("skipped");
      expect(await undoDocumentUnskip(db, accountId, b.skip.id, u!.unskippedAt, ACTOR)).toBe(false);
      if (c.status === "skipped") expect(await undoDocumentSkip(db, accountId, c.skip.id, OTHER)).toBe(true);
      expect(await undoDocumentUnskip(db, accountId, b.skip.id, u!.unskippedAt, ACTOR)).toBe(true);
      expect((await getActiveDocumentSkip(db, accountId, ana, "id"))?.id).toBe(b.skip.id);
    }));

  it("every write is scoped to its account (mutation: drop .eq('account_id') from the un-skip -> another account's row moves -> FAILS)", () =>
    withTestAccount(async (db, accountId) =>
      withTestAccount(async (dbB, accountB) => {
        const bea = (await createContact(dbB, accountB, { firstName: "Bea" }, ACTOR)).id;
        const s = await skipDocumentRequirement(dbB, { accountId: accountB, contactId: bea, category: "permit", actorId: ACTOR, now: NOW });
        if (s.status !== "skipped") throw new Error(s.status);
        expect(await unskipDocumentRequirement(db, accountId, s.skip.id, ACTOR, later(1000))).toBeNull();
        expect(await undoDocumentSkip(db, accountId, s.skip.id, ACTOR)).toBe(false);
        expect(await getDocumentSkip(db, accountId, s.skip.id)).toBeNull();
        expect((await getDocumentSkip(dbB, accountB, s.skip.id))?.unskipped_at).toBeNull();
      })));
});

describe("listDocumentSkipTimeline (spec 5.4: each move is a timeline row)", () => {
  it("a skip row at created_at, and its un-skip row at unskipped_at, for the asked contacts only (mutations: read un-skips by created_at; drop the contact filter -> FAILS)", () =>
    withTestAccount(async (db, accountId) => {
      const ana = (await createContact(db, accountId, { firstName: "Ana" }, ACTOR)).id;
      const bo = (await createContact(db, accountId, { firstName: "Bo" }, ACTOR)).id;
      const s = await skipDocumentRequirement(db, { accountId, contactId: ana, category: "warranty", actorId: ACTOR, now: NOW });
      await skipDocumentRequirement(db, { accountId, contactId: bo, category: "warranty", actorId: ACTOR, now: NOW });
      if (s.status !== "skipped") throw new Error(s.status);
      const u = await unskipDocumentRequirement(db, accountId, s.skip.id, OTHER, later(5000));
      const t = await listDocumentSkipTimeline(db, accountId, ana, page);
      expect(t.skips.map((r) => [r.id, r.category, r.skipped_by, r.created_at])).toEqual([[s.skip.id, "warranty", ACTOR, s.skip.created_at]]);
      expect(t.unskips.map((r) => [r.id, r.unskipped_by, r.unskipped_at])).toEqual([[s.skip.id, OTHER, u!.unskippedAt]]);
      expect((await listDocumentSkipTimeline(db, accountId, [ana, bo], page)).skips).toHaveLength(2);
    }));
});
```

- [ ] **Step 3: Run it to see it fail.** `cd packages/db && SUPABASE_URL=http://localhost:55604 SUPABASE_SERVICE_ROLE_KEY=$(cat <SCRATCH>/s07e-t3-impl/service.key) node node_modules/vitest/vitest.mjs run src/test/document-requirements.test.ts > <SCRATCH>/s07e-t3-impl/red.log 2>&1; echo $? > <SCRATCH>/s07e-t3-impl/red.exit` (use exactly the env names `pgrst.sh` prints at its end; 2b's Task 3 used the same kit). Expected: module not found. Paste the summary.

- [ ] **Step 4: Append to `document-rules.ts`:**

```ts
/**
 * S-07 2c: the "7 de 9" checklist. Every category but Other may be required (owner ruling D8): anything
 * filed as Other would meet "Other". 0081's two CHECKs hold this exact list; document-requirements-schema.test.ts
 * refuses 'other' there, and this module's test pins the list against DOCUMENT_CATEGORIES.
 */
export const REQUIRABLE_DOCUMENT_CATEGORIES = ["id", "contract", "estimate", "invoice", "photo", "permit", "insurance", "warranty"] as const;
export type RequirableCategory = (typeof REQUIRABLE_DOCUMENT_CATEGORIES)[number];
export const isRequirableCategory = (v: unknown): v is RequirableCategory =>
  typeof v === "string" && (REQUIRABLE_DOCUMENT_CATEGORIES as readonly string[]).includes(v);
/** 0081's document_requirements answers one of these per required category (precedence: skipped, met, checking, expired, missing). */
export const REQUIREMENT_STATES = ["met", "checking", "expired", "missing", "skipped"] as const;
export type RequirementState = (typeof REQUIREMENT_STATES)[number];
export const isRequirementState = (v: unknown): v is RequirementState =>
  typeof v === "string" && (REQUIREMENT_STATES as readonly string[]).includes(v);
/** The undo window for a skip or an un-skip: the actor's own, this long after (rule 6; 2b's revoke window). */
export const DOCUMENT_REQUIREMENT_UNDO_MS = 600_000;

/** The account's list as 0081 accepts it, in the vault's order, duplicates dropped; null for anything else. */
export function cleanRequiredCategories(raw: unknown): RequirableCategory[] | null {
  if (!Array.isArray(raw)) return null;
  if (!raw.every(isRequirableCategory)) return null;
  const picked = new Set<string>(raw);
  return REQUIRABLE_DOCUMENT_CATEGORIES.filter((c) => picked.has(c));
}

/** "2 of 3" (spec 5.3): skipped items are left out of both numbers. */
export function requirementsMeter(items: readonly { state: RequirementState }[]): { met: number; required: number } {
  const counted = items.filter((i) => i.state !== "skipped");
  return { met: counted.filter((i) => i.state === "met").length, required: counted.length };
}
```

- [ ] **Step 5: Write `packages/db/src/document-requirements.ts`:**

```ts
import type { SupabaseClient } from "@supabase/supabase-js";
import { forContacts, withTimelinePage, type TimelinePageOpts } from "./timeline-cursor";
import {
  cleanRequiredCategories, isRequirableCategory, isRequirementState, type RequirableCategory, type RequirementState,
} from "./document-rules";

/**
 * The "7 de 9" checklist's data layer (0081; spec section 5). READS take the caller's client: the
 * checklist's states come from the definer function (it re-checks the account and the contact), the
 * skip proof reads run under 0081's RLS. WRITES take the service client an action holds AFTER its
 * request-client proof (0053): `authenticated` has no write grant on the table or the column. Every
 * write is scoped to `accountId`. THROWS on a read or write error. No event is emitted (plan "Not in
 * this PR"): the timeline row is the record of a skip.
 */
export type DocumentRequirement = { category: RequirableCategory; state: RequirementState };
export type DocumentSkipRow = {
  id: string; account_id: string; contact_id: string; category: RequirableCategory; skipped_by: string; created_at: string;
  unskipped_at: string | null; unskipped_by: string | null;
};
export type TimelineDocumentSkip = {
  id: string; category: RequirableCategory; contact_id: string; skipped_by: string; created_at: string;
  unskipped_by: string | null; unskipped_at: string | null;
};

const SKIP_COLS = "id, account_id, contact_id, category, skipped_by, created_at, unskipped_at, unskipped_by";
const SKIP_TIMELINE_COLS = "id, category, contact_id, skipped_by, created_at, unskipped_by, unskipped_at";

/** The card's read (request client): one row per required category, in the account's order; [] when the list is off. */
export async function listDocumentRequirements(
  db: SupabaseClient, accountId: string, contactId: string, today: string,
): Promise<DocumentRequirement[]> {
  const { data, error } = await db.rpc("document_requirements", { p_account_id: accountId, p_contact_id: contactId, p_today: today });
  if (error) throw new Error(`document_requirements failed: ${error.message}`);
  if (!Array.isArray(data)) throw new Error(`document_requirements: unexpected answer ${JSON.stringify(data)}`);
  return data.map((r: unknown) => {
    const row = r as { category?: unknown; state?: unknown };
    if (!isRequirableCategory(row.category) || !isRequirementState(row.state)) {
      throw new Error(`document_requirements: unexpected answer ${JSON.stringify(r)}`);
    }
    return { category: row.category, state: row.state };
  });
}

export async function getRequiredDocumentCategories(db: SupabaseClient, accountId: string): Promise<RequirableCategory[]> {
  const { data, error } = await db.from("accounts").select("required_document_categories").eq("id", accountId).maybeSingle();
  if (error) throw new Error(`getRequiredDocumentCategories failed: ${error.message}`);
  if (!data) throw new Error("getRequiredDocumentCategories: no account");
  const list = cleanRequiredCategories((data as { required_document_categories: unknown }).required_document_categories);
  if (!list) throw new Error("getRequiredDocumentCategories: unexpected stored list");
  return list;
}

/** Service client, after the caller's role check. Writes the cleaned list and answers it. */
export async function setRequiredDocumentCategories(db: SupabaseClient, accountId: string, categories: unknown): Promise<RequirableCategory[]> {
  const list = cleanRequiredCategories(categories);
  if (!list) throw new TypeError("setRequiredDocumentCategories: not a list of requirable categories");
  const { data, error } = await db.from("accounts").update({ required_document_categories: list }).eq("id", accountId).select("id");
  if (error) throw new Error(`setRequiredDocumentCategories failed: ${error.message}`);
  if ((data ?? []).length !== 1) throw new Error("setRequiredDocumentCategories: no account");
  return list;
}

export async function getActiveDocumentSkip(
  db: SupabaseClient, accountId: string, contactId: string, category: RequirableCategory,
): Promise<DocumentSkipRow | null> {
  const { data, error } = await db.from("document_requirement_skips").select(SKIP_COLS)
    .eq("account_id", accountId).eq("contact_id", contactId).eq("category", category).is("unskipped_at", null).maybeSingle();
  if (error) throw new Error(`getActiveDocumentSkip failed: ${error.message}`);
  return (data as DocumentSkipRow | null) ?? null;
}

export async function getDocumentSkip(db: SupabaseClient, accountId: string, skipId: string): Promise<DocumentSkipRow | null> {
  const { data, error } = await db.from("document_requirement_skips").select(SKIP_COLS).eq("account_id", accountId).eq("id", skipId).maybeSingle();
  if (error) throw new Error(`getDocumentSkip failed: ${error.message}`);
  return (data as DocumentSkipRow | null) ?? null;
}

/** Service client. A second active skip for the same customer and category is "already" (0081's partial unique index). */
export async function skipDocumentRequirement(db: SupabaseClient, a: {
  accountId: string; contactId: string; category: RequirableCategory; actorId: string; now: Date;
}): Promise<{ status: "skipped"; skip: DocumentSkipRow } | { status: "already" }> {
  const { data, error } = await db.from("document_requirement_skips").insert({
    account_id: a.accountId, contact_id: a.contactId, category: a.category, skipped_by: a.actorId, created_at: a.now.toISOString(),
  }).select(SKIP_COLS).single();
  if (error) {
    if (error.code === "23505") return { status: "already" };
    throw new Error(`skipDocumentRequirement failed: ${error.message}`);
  }
  return { status: "skipped", skip: data as DocumentSkipRow };
}

/** Service client: the skip's Undo deletes the row (deviation 2), only while active and only the actor's own. */
export async function undoDocumentSkip(db: SupabaseClient, accountId: string, skipId: string, actorId: string): Promise<boolean> {
  const { data, error } = await db.from("document_requirement_skips").delete()
    .eq("account_id", accountId).eq("id", skipId).eq("skipped_by", actorId).is("unskipped_at", null).select("id");
  if (error) throw new Error(`undoDocumentSkip failed: ${error.message}`);
  return (data ?? []).length > 0;
}

/** Service client: compare-and-set from active. Answers the stored instant exactly as PostgREST returned it. */
export async function unskipDocumentRequirement(
  db: SupabaseClient, accountId: string, skipId: string, actorId: string, now: Date,
): Promise<{ unskippedAt: string } | null> {
  const { data, error } = await db.from("document_requirement_skips")
    .update({ unskipped_at: now.toISOString(), unskipped_by: actorId })
    .eq("account_id", accountId).eq("id", skipId).is("unskipped_at", null).select("unskipped_at");
  if (error) throw new Error(`unskipDocumentRequirement failed: ${error.message}`);
  const row = (data ?? [])[0] as { unskipped_at: string } | undefined;
  return row ? { unskippedAt: row.unskipped_at } : null;
}

/** Service client: the un-skip's Undo, only the actor's own at the instant its toast named; never over a newer active skip (23505). */
export async function undoDocumentUnskip(
  db: SupabaseClient, accountId: string, skipId: string, expectedUnskippedAt: string, actorId: string,
): Promise<boolean> {
  const { data, error } = await db.from("document_requirement_skips").update({ unskipped_at: null, unskipped_by: null })
    .eq("account_id", accountId).eq("id", skipId).eq("unskipped_at", expectedUnskippedAt).eq("unskipped_by", actorId).select("id");
  if (error) {
    if (error.code === "23505") return false;
    throw new Error(`undoDocumentUnskip failed: ${error.message}`);
  }
  return (data ?? []).length > 0;
}

/**
 * The timeline's two reads (spec 5.4; deviation 1), on the caller's client so RLS decides: every skip at
 * its created_at, and every un-skip at its unskipped_at. Each paged on (at, id).
 */
export async function listDocumentSkipTimeline(
  db: SupabaseClient, accountId: string, who: string | readonly string[], page: TimelinePageOpts,
): Promise<{ skips: TimelineDocumentSkip[]; unskips: TimelineDocumentSkip[] }> {
  const base = () => db.from("document_requirement_skips").select(SKIP_TIMELINE_COLS).eq("account_id", accountId);
  const [skips, unskips] = await Promise.all([
    withTimelinePage(forContacts(base(), "contact_id", who), "created_at", page),
    withTimelinePage(forContacts(base().not("unskipped_at", "is", null), "contact_id", who), "unskipped_at", page),
  ]);
  if (skips.error) throw new Error(`listDocumentSkipTimeline (skips) failed: ${skips.error.message}`);
  if (unskips.error) throw new Error(`listDocumentSkipTimeline (un-skips) failed: ${unskips.error.message}`);
  return { skips: (skips.data ?? []) as TimelineDocumentSkip[], unskips: (unskips.data ?? []) as TimelineDocumentSkip[] };
}
```

(If tsc refuses the `base().not(…)` chain through `forContacts`'s generic, as `documents.ts:70-73` warns about TS2589, split the two queries into two named constants; the behaviour must not change.)

- [ ] **Step 6: The barrel.** In `index.ts`, the `./document-rules` block gains `REQUIRABLE_DOCUMENT_CATEGORIES, isRequirableCategory, REQUIREMENT_STATES, isRequirementState, DOCUMENT_REQUIREMENT_UNDO_MS, cleanRequiredCategories, requirementsMeter, type RequirableCategory, type RequirementState,` under a `// S-07 2c: the required-documents checklist.` line; after the `./document-requests` block:

```ts
// S-07 2c: the required-documents checklist. See ./document-requirements.ts.
export {
  listDocumentRequirements, getRequiredDocumentCategories, setRequiredDocumentCategories, getActiveDocumentSkip, getDocumentSkip,
  skipDocumentRequirement, undoDocumentSkip, unskipDocumentRequirement, undoDocumentUnskip, listDocumentSkipTimeline,
  type DocumentRequirement, type DocumentSkipRow, type TimelineDocumentSkip,
} from "./document-requirements";
```

- [ ] **Step 7: Run to pass.** The test file above on the kit; `document-requirements-schema.test.ts` on `post`; `pnpm --filter @bis/db exec tsc --noEmit -p .` (or the package's typecheck script; read `packages/db/package.json`); `pnpm --filter web typecheck` (web imports db as source). All PASS; paste the summary blocks.
- [ ] **Step 8: Probes, each by name:** (a) `cleanRequiredCategories` without the order filter (`return [...picked]`) → the rules case FAILS; (b) `undoDocumentSkip` without `.eq("skipped_by", actorId)` → the Undo case FAILS; (c) `undoDocumentUnskip` with `if (error.code === "23505")` removed → the Undo case throws; (d) `unskipDocumentRequirement` without `.eq("account_id", accountId)` → the scoped case FAILS; (e) `listDocumentSkipTimeline`'s second read ordered by `created_at` → the timeline case FAILS; (f) `listDocumentRequirements` answering `[]` for `data === null` → the wrapper case FAILS. Paste each.
- [ ] **Step 9: Commit** `-- packages/db/src/document-requirements.ts packages/db/src/document-rules.ts packages/db/src/index.ts packages/db/src/test/document-requirements.test.ts`, message "db: the required-documents module: the list, skips with the actor's own Undo, the timeline reads (S-07 2c)".

---

## Task 4: The timeline: skip and un-skip rows (bis-crm)

**Review:** opus. **Scratch:** ports `55608`/`55609`/`55610`. **Runs beside:** Task 5.

**Files**
- Modify: `packages/db/src/record.ts` (the union `:290-305`, the `documents` settle `:376-393`), `packages/db/src/test/record.test.ts` (one case), `packages/db/src/test/timeline-merge.test.ts` (`:145-147`, one new case beside `:179`)
- Modify: `apps/web/src/lib/record/{author-mark,timeline-rows,recent-rows}.ts` and their tests; `…/contacts/[contactId]/activity-timeline.tsx` (+ `activity-timeline.rows.test.ts`); `…/groups/[groupId]/group-timeline.tsx` (+ `group-timeline.test.ts`); `…/contacts/contact-drawer.tsx` (`ROW_ICON` only, `:66`); `apps/web/src/lib/contacts/drawer-summary.ts` (`ROW_KINDS` only, `:52-55`) (+ `drawer-summary.test.ts`); `…/api/contacts/[contactId]/summary/route.reads.test.ts` (`MEASURED` and its comment only, `:51-63`)

**Interfaces**
- Consumes: `listDocumentSkipTimeline`, `TimelineDocumentSkip` (Task 3); keys `timeline.documentSkip`, `timeline.documentUnskip`, `documents.category.*` (Task 2).
- Produces: `TimelineEntry` gains `{ kind: "documentSkip"; id: string; at: string; contactId: string; skip: TimelineDocumentSkip }` (`at` = `created_at`) and `{ kind: "documentUnskip"; id: string; at: string; contactId: string; skip: TimelineDocumentSkip }` (`at` = `unskipped_at`).

- [ ] **Step 1: Read** `sed -n 285,310p packages/db/src/record.ts`, `:370-395`; `sed -n 20,70p apps/web/src/lib/record/author-mark.ts`; `sed -n 60,135p apps/web/src/lib/record/timeline-rows.ts`; `sed -n 20,55p apps/web/src/lib/record/recent-rows.ts`; `activity-timeline.tsx:175-195`; `group-timeline.tsx:120-140`; `grep -n "ROW_ICON\|ROW_KINDS" "…/contacts/contact-drawer.tsx" apps/web/src/lib/contacts/drawer-summary.ts`; `timeline-merge.test.ts:140-190`; `route.reads.test.ts:45-75`; the `documentRequest` cases in each test file (`author-mark.test.ts:148`, `timeline-rows.test.ts:201`, `recent-rows.test.ts:122`, `activity-timeline.rows.test.ts:224`, `group-timeline.test.ts:154`), whose shape every new case copies.

- [ ] **Step 2: Failing tests.**
  - `author-mark.test.ts`, one case:

```ts
  it("a skip carries the person who skipped, an un-skip the person who un-skipped (mutations: one personId for both; the automation mark -> FAILS)", () => {
    const skip = { id: "k1", category: "insurance", contact_id: "c1", skipped_by: "u_ana", created_at: AT, unskipped_by: "u_bo", unskipped_at: AT };
    const a = { kind: "documentSkip", id: "k1", at: AT, contactId: "c1", skip } as TimelineEntry;
    const b = { kind: "documentUnskip", id: "k1", at: AT, contactId: "c1", skip } as TimelineEntry;
    expect([authorOf(a), authorOf(b)]).toEqual([{ kind: "person", personId: "u_ana" }, { kind: "person", personId: "u_bo" }]);
  });
```
  - `timeline-rows.test.ts`, one case, both languages against literals (use the file's own `trFor`/`author` helpers, as the `documentRequest` case at `:201` does):

```ts
  it("a skip reads 'marked Insurance as not needed', an un-skip 'marked … as needed again', and their keys differ (mutations: one key for both; the category's raw key -> FAILS)", () => {
    const skip = { id: "k1", category: "insurance", contact_id: "c1", skipped_by: "u1", created_at: AT, unskipped_by: "u1", unskipped_at: "2026-10-16T16:00:00.000Z" };
    const entries = [
      { kind: "documentUnskip", id: "k1", at: "2026-10-16T16:00:00.000Z", contactId: "c1", skip },
      { kind: "documentSkip", id: "k1", at: AT, contactId: "c1", skip },
    ] as TimelineEntry[];
    const en = timelineRows(entries, { zone: "America/Chicago", tr: trFor("en"), author: author(trFor("en")) });
    expect(en.map((r) => r.verb)).toEqual(["marked Insurance as needed again", "marked Insurance as not needed"]);
    const es = timelineRows(entries, { zone: "America/Chicago", tr: trFor("es"), author: author(trFor("es")) });
    expect(es.map((r) => r.verb)).toEqual(["marcó que Seguro hace falta otra vez", "marcó que Seguro no hace falta"]);
    expect(new Set(en.map((r) => r.key)).size).toBe(2);
  });
```
  - `recent-rows.test.ts`: a `documentSkip` and a `documentUnskip` entry each read with `excerpt` `null` and their verb (mutation: return a detail as the excerpt -> FAILS). `drawer-summary.test.ts`: `ROW_KINDS` accepts `"documentSkip"` and `"documentUnskip"` (its existing exhaustiveness case, extended). Both timelines' row tests: each new kind renders its verb and wears the `ListChecks` icon marker (follow the `documentRequest` case; mutations: return null for the case, or wear the Paperclip -> FAILS).
  - `packages/db/src/test/record.test.ts` (behind PostgREST): a contact with one skip that was then un-skipped reads TWO entries, `documentUnskip` first (its `at` is `unskipped_at`) then `documentSkip` (its `at` is `created_at`), both with `id` the skip's id (mutation: drop the fifth read -> FAILS).
  - `timeline-merge.test.ts`: `:146` becomes `expect(paged.map((r) => r.limit)).toEqual(Array(TIMELINE_SOURCES.length + 5).fill(TIMELINE_PAGE_SIZE + 1));` with the comment at `:145` naming "0081's two document_requirement_skips reads, so there are five reads more than there are sources"; and `:147`'s sibling: `expect(paged.filter((r) => r.table === "document_requirement_skips").map((r) => r.limit)).toEqual([TIMELINE_PAGE_SIZE + 1, TIMELINE_PAGE_SIZE + 1]);`. A new case: a refused `document_requirement_skips` read fails the `documents` source (copy the `document_requests` case at `:179` with the relation name changed).

- [ ] **Step 3: Run them to see them fail** (web by path; db on the replica). Expected: each new case FAILS; typecheck errors on the new kinds.

- [ ] **Step 4: Implement.**
  - `record.ts`: import `listDocumentSkipTimeline, type TimelineDocumentSkip` from `./document-requirements`; the union gains

```ts
  /** S-07 2c (plan deviation 1): one row per skip, at its created_at, read from 0081's document_requirement_skips so RLS decides. `id` is the skip's. */
  | { kind: "documentSkip"; id: string; at: string; contactId: string; skip: TimelineDocumentSkip }
  /** S-07 2c: one row per un-skip, at its unskipped_at, from the same row. The kind keeps its key apart from the skip's. */
  | { kind: "documentUnskip"; id: string; at: string; contactId: string; skip: TimelineDocumentSkip };
```
    and the `documents` settle's `Promise.all` gains `listDocumentSkipTimeline(db, accountId, who, page)` as a fifth read (no group branch: a skip is always a contact's), mapped

```ts
        ...skips.skips.map((s): TimelineEntry => ({ kind: "documentSkip", id: s.id, at: s.created_at, contactId: s.contact_id, skip: s })),
        ...skips.unskips.map((s): TimelineEntry => ({ kind: "documentUnskip", id: s.id, at: s.unskipped_at!, contactId: s.contact_id, skip: s })),
```
    The comment above it says "six kinds".
  - `author-mark.ts`: `case "documentSkip": return { kind: "person", personId: entry.skip.skipped_by };` and `case "documentUnskip": return { kind: "person", personId: entry.skip.unskipped_by };`.
  - `timeline-rows.ts`:

```ts
    // S-07 2c (spec 5.4): "{person} marked Insurance as not needed" / "… as needed again"; no status, no detail.
    case "documentSkip":
      return { verb: tr.text("timeline.documentSkip", { category: tr.text(`documents.category.${entry.skip.category}` as MessageKey) }), status: null, detail: null };
    case "documentUnskip":
      return { verb: tr.text("timeline.documentUnskip", { category: tr.text(`documents.category.${entry.skip.category}` as MessageKey) }), status: null, detail: null };
```
    (If `detail` is not nullable in this file's return type, read its type and use what the `documentRequest` case's siblings use for "no detail".)
  - `recent-rows.ts`: `case "documentSkip": case "documentUnskip": return null;`. Both timelines: a case for each beside `documentRequest`, icon `ListChecks` from `lucide-react`. `contact-drawer.tsx` `ROW_ICON`: `documentSkip: ListChecks, documentUnskip: ListChecks`. `drawer-summary.ts` `ROW_KINDS`: add both.
  - `route.reads.test.ts:63`: run the test first with the new reads in place and READ the measured count from its failure message; expected 28. Then `const MEASURED = 28; // measured <date>: 28 reads (+1 prefs), the 27th and 28th are request:document_requirement_skips twice (S-07 2c: a skip at created_at, an un-skip at unskipped_at); 26 before S-07 2c, the 26th request:document_requests; …` (keep the rest of the comment). If it is not 28, stop and report.

- [ ] **Step 5: Run** every file this task touched (web by path; `record.test.ts`, `timeline-merge.test.ts` on the replica) plus `src/lib/i18n/ratchet.test.ts`; `pnpm --filter web typecheck`; `pnpm --filter web exec eslint <touched files>`. All PASS.
- [ ] **Step 6: Probes:** (a) `author-mark.ts` answering `skipped_by` for `documentUnskip` → the author case FAILS; (b) the fifth read removed from `record.ts` → `record.test.ts`'s case and `timeline-merge`'s `+ 5` FAIL; (c) `timeline.documentSkip` used for both kinds → the rows case FAILS; (d) `MEASURED` left at 26 → `route.reads.test.ts` FAILS. Paste each.
- [ ] **Step 7: Commit** every path above, message "timeline: a skip and an un-skip of a required document each read as a row with the person's mark (S-07 2c)".

---

## Task 5: The card's read, its browser parser, the skip actions, the Settings action (bis-crm)

**Review:** opus. **Runs beside:** Task 4.

**Files**
- Create: `…/api/contacts/[contactId]/document-requirements/route.ts` (+ `route.test.ts`)
- Create: `apps/web/src/lib/documents/requirements-load.ts` (+ `requirements-load.test.ts`)
- Create: `…/contacts/document-requirements-actions.ts` (+ `document-requirements-actions.test.ts`)
- Create: `…/settings/document-requirements-actions.ts` (+ `document-requirements-actions.test.ts`)
- Modify: `…/accounts/[accountId]/in-account-service-reads.test.ts` (two `ALLOWED` lines)

**Interfaces**
- Consumes: Task 3's module and rules; `documentsClock` (`lib/documents/document-view.ts:20`); `getContact` (`@bis/db`); `apiAccountAccess`, `requireAccountAccess` (`lib/auth.ts`); `seesWholeAccount` (`lib/auth-role.ts:15`, the pure module); `isUuid` (`lib/assign/action-guards`); `loggableError`; `DocumentsLoad` from `lib/documents/documents-load.ts`; keys from Task 2.
- Produces:
  - Route `GET /api/accounts/[accountId]/contacts/[contactId]/document-requirements` → `200 { items: { category, state }[] }` (empty when the list is off), `404 {}` (no access, a malformed id, or a contact the caller cannot see), `500 {}` (any read failed; logged with the account and the contact, never more).
  - `lib/documents/requirements-load.ts` (browser-safe): `type RequirementView = { category: RequirableCategory; state: RequirementState }`; `type RequirementsResponse = { items: RequirementView[] }`; `type RequirementsLoad = { kind: "loading" } | { kind: "error" } | { kind: "ready"; data: RequirementsResponse }`; `parseRequirements(body: unknown): RequirementsResponse | null` (strict: any bad item makes the whole answer `null`); `requirementsLoadFrom(res: Response): Promise<RequirementsLoad>`; `requirementsRouteFor(accountId: string, contactId: string): string`; `type ChecklistView = { kind: "off" } | { kind: "on"; met: number; required: number; complete: boolean; gaps: RequirementView[]; skipped: RequirementView[] }` and `checklistView(data: RequirementsResponse): ChecklistView` (`gaps` = missing, expired and checking items in the list's order; `complete` = `required > 0 ? met === required : true` when the list is on; D11); `shouldReloadRequirements(prev: DocumentsLoad | null, next: DocumentsLoad): boolean`; `keepRequirements(shown: { route: string; load: RequirementsLoad }, route: string, next: RequirementsLoad): { route: string; load: RequirementsLoad }` (a failed RE-read keeps a ready list, `keepRequests`' rule, `documents-card.tsx:447-451`).
  - `…/contacts/document-requirements-actions.ts` (`"use server"`): `skipDocumentRequirementAction(accountId: string, contactId: string, category: string): Promise<{ ok: true; skipId: string } | DocFail>`; `undoSkipDocumentRequirementAction(accountId: string, skipId: string): Promise<{ ok: true } | DocFail>`; `unskipDocumentRequirementAction(accountId: string, contactId: string, category: string): Promise<{ ok: true; skipId: string; unskippedAt: string } | DocFail>`; `undoUnskipDocumentRequirementAction(accountId: string, skipId: string, unskippedAt: string): Promise<{ ok: true } | DocFail>`. `DocFail` is `documents-actions.ts`' (`{ ok: false; error: string }`), every `error` a `messages.ts` key.
  - `…/settings/document-requirements-actions.ts` (`"use server"`): `setRequiredDocumentCategoriesAction(accountId: string, formData: FormData): Promise<{ ok: true; list: string[] } | { ok: false; error: string }>` (`error` is DISPLAY TEXT, English, as `setReportEmailsAction`'s is, `settings/actions.ts:182-199`; the card toasts it through `notifyActionResult`).

- [ ] **Step 1: Read** `…/api/contacts/[contactId]/document-requests/route.ts` and its test (the shape this route copies), `…/api/contacts/[contactId]/documents/route.test.ts:1-45` (the `REQUEST` fake whose `from("accounts")…maybeSingle()` answers the zone), `document-requests-actions.ts:1-60` and `:107-165` (the proof-then-service shape and the Undo window), `document-requests-actions.test.ts:1-60` (its mocks), `settings/actions.ts:182-199`, `lib/auth-role.ts`, `lib/document-requests/requests-load.ts` (the parser shape), `lib/documents/documents-load.ts` (the `DocumentsLoad` the re-read compares).

- [ ] **Step 2: Failing tests.**
  - `requirements-load.test.ts`:
    1. `parseRequirements` accepts `{ items: [{ category: "insurance", state: "met" }] }` and `{ items: [] }`; refuses (answers `null`) a missing `items`, an item with `category: "other"`, `state: "done"`, or an extra-less non-object (mutation: skip the per-item check -> FAILS).
    2. `requirementsLoadFrom` answers `{ kind: "error" }` for a 500, a 200 with a bad body, and a body that is not JSON; `{ kind: "ready", data }` otherwise.
    3. `checklistView`: `{ items: [] }` → `{ kind: "off" }`; `[met insurance, missing id, skipped photo, checking warranty, expired permit]` → `{ kind: "on", met: 1, required: 4, complete: false, gaps: [id missing, warranty checking, permit expired] (list order), skipped: [photo] }`; `[met, skipped]` → `complete: true`; `[skipped]` alone → `{ met: 0, required: 0, complete: true }` (D11; mutation: complete when required is 0 → false -> FAILS).
    4. `shouldReloadRequirements`: `false` when either read is not ready, and for the SAME ready read twice (the poll's loop guard; mutation: always true -> FAILS); `true` when a live file was added or removed, its `category`, `expiresOn` or `version.scan` changed, or its `version.id` changed; `false` when only `title`, `ownersOnly`, `addedBy` or the trashed list's order changed; `true` when a file moved from live to trashed (it is no longer live).
    5. `keepRequirements` keeps a ready list over a failed re-read of the same route; shows a first read's failure; shows another route's.
  - `route.test.ts` (mocks: `@/lib/auth`'s `apiAccountAccess`, `@/lib/db`'s `dbForRequest` → a `REQUEST` fake whose `accounts` read answers `{ timezone: "America/Chicago" }`, `@bis/db` with `getContact`, `listDocumentRequirements`, and `serviceDb: () => { throw new Error("never"); }`, `@/lib/zone` as the documents route test mocks it; fake timers at `2026-10-17T03:00:00.000Z`, which is still 2026-10-16 in Chicago):
    1. answers 200 `{ items }` from `listDocumentRequirements(REQUEST, ACC, C, "2026-10-16")` (the ACCOUNT's day; mutation: pass `new Date().toISOString().slice(0, 10)` = "2026-10-17" -> FAILS).
    2. 404 with no access, with a malformed id, and when `getContact` answers null, without calling `listDocumentRequirements` (mutation: read before the proof -> FAILS by the call count).
    3. 500 `{}` when the read throws; the log line names the account and the contact and nothing from the error's data (spy on `console.error`).
    4. never touches `serviceDb` (the mock throws).
  - `contacts/document-requirements-actions.test.ts` (mocks: `@/lib/auth` `requireAccountAccess`, `@/lib/db` `dbForRequest` → `REQUEST`, `@bis/db` with every function the file imports plus `serviceDb: () => SVC`; one shared call log `calls: string[]` every mock pushes to, so ORDER is asserted on one list, never two `toHaveBeenCalled`s):
    1. skip, as Staff: `requireAccountAccess` → `getContact(REQUEST…)` → `getRequiredDocumentCategories(REQUEST…)` → `skipDocumentRequirement(SVC, { accountId, contactId, category: "insurance", actorId: "user_me", now })` in that order; answers `{ ok: true, skipId }` (mutation: write before the proof -> FAILS by the order).
    2. skip refusals, each writing nothing: a Technician → `documents.checklist.skipRole` (D1); a malformed contact id or an unknown or `other` category → `documents.request.refused`; `getContact` null → `documents.error.notFound`; the category not on the account's list → `documents.checklist.notRequired`; `already` → `documents.checklist.changed`; a thrown read → `documents.error.failed` (mutation: skip the role check -> the Technician case writes -> FAILS).
    3. undo a skip: `getDocumentSkip(REQUEST…)` first; refused (writing nothing) when the row is gone, `skipped_by` is someone else, `unskipped_at` is set, or `created_at` is more than `DOCUMENT_REQUIREMENT_UNDO_MS` ago (fake timers); otherwise `undoDocumentSkip(SVC, accountId, skipId, "user_me")`, and its `false` → `documents.checklist.changed` (mutation: compare against `skipped_by` of the caller's own id only after the write -> FAILS by the order; mutation: no window -> the 11-minute case writes -> FAILS).
    4. un-skip: `getContact(REQUEST…)` → `getActiveDocumentSkip(REQUEST…)` → `unskipDocumentRequirement(SVC, accountId, skip.id, "user_me", now)`; answers `{ ok: true, skipId, unskippedAt }` with the instant the db answered (mutation: answer `now.toISOString()` instead -> FAILS); no active skip → `documents.checklist.changed`; a Technician → `skipRole`.
    5. undo an un-skip: refused unless the row's `unskipped_by` is the caller, its `unskipped_at` parses equal to the argument, and it is within the window; then `undoDocumentUnskip(SVC, accountId, skipId, unskippedAt, "user_me")` with the ARGUMENT's string (mutation: pass `new Date().toISOString()` -> FAILS); a malformed instant → `documents.request.refused` with no read.
  - `settings/document-requirements-actions.test.ts` (mocks: `requireAccountAccess`, `serviceDb`, `setRequiredDocumentCategories`, `next/cache`'s `revalidatePath`):
    1. an Owner's or the agency's `FormData` with `category=insurance`, `category=id`, `category=insurance` → `setRequiredDocumentCategories(SVC, accountId, ["insurance", "id", "insurance"])` (the db cleans), `revalidatePath("/dashboard/accounts/<id>/settings")`, `{ ok: true, list: ["id", "insurance"] }` (the db's answer).
    2. Staff (`canManage: false`) → `{ ok: false, error: m["settings.requiredDocuments.role"] }`, nothing written (mutation: drop the role check -> FAILS).
    3. a `category=other` → `{ ok: false, error: m["settings.requiredDocuments.failed"] }`, nothing written (the action cleans first with `cleanRequiredCategories` and refuses `null`; mutation: pass the raw list to the db -> the db's TypeError is caught as failed but the call log shows the write -> FAILS by the log).
    4. no `category` at all → writes `[]` (off) and answers `{ ok: true, list: [] }`.
  - `in-account-service-reads.test.ts`: run it BEFORE adding the lines: it FAILS naming both new files.

- [ ] **Step 3: Run them to see them fail.**

- [ ] **Step 4: Implement.**
  - The route (copy `document-requests/route.ts`' header and shape):

```ts
import { NextResponse } from "next/server";
import { getContact, listDocumentRequirements } from "@bis/db";
import { apiAccountAccess } from "@/lib/auth";
import { dbForRequest } from "@/lib/db";
import { isUuid } from "@/lib/assign/action-guards";
import { loggableError } from "@/lib/loggable-error";
import { documentsClock } from "@/lib/documents/document-view";
import type { RequirementsResponse } from "@/lib/documents/requirements-load";

export const dynamic = "force-dynamic";

/**
 * The Documents card's checklist (spec 5.3, 5.4): each required category's state for this customer,
 * on the account's own day. Request client only: getContact proves the contact first (RLS, the
 * Technician fence), and 0081's definer read re-checks both fences itself. Loads and fails on its own
 * (spec 6): the card's files never wait on it.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ accountId: string; contactId: string }> }) {
  const { accountId, contactId: raw } = await params;
  const access = await apiAccountAccess(accountId);
  if (!access || !isUuid(raw)) return NextResponse.json({}, { status: 404 });
  const contactId = raw.toLowerCase();
  const db = await dbForRequest(); // RLS-scoped: never the service client here
  try {
    if (!(await getContact(db, accountId, contactId))) return NextResponse.json({}, { status: 404 });
    const { today } = await documentsClock(db, accountId);
    const body: RequirementsResponse = { items: await listDocumentRequirements(db, accountId, contactId, today) };
    return NextResponse.json(body);
  } catch (e) {
    console.error(`document requirements read (account ${accountId}, contact ${contactId}): ${loggableError(e)}`);
    return NextResponse.json({}, { status: 500 });
  }
}
```
  - `requirements-load.ts`: the types above; `parseRequirements` checks `isObj(body) && Array.isArray(body.items)` and every item `isObj && isRequirableCategory(category) && isRequirementState(state)` (imports from `@bis/db/document-rules` only; `import type { DocumentsLoad } from "./documents-load"`); `requirementsLoadFrom` as `documentRequestsLoadFrom` (`requests-load.ts:43-47`); `checklistView` with `requirementsMeter`; and

```ts
/**
 * Re-read the checklist once when a files read changed something it depends on: a live file added or
 * gone, or its category, expiry or shown version (id or scan state) moved. Both reads must be ready. The
 * same read twice answers false, so the files' Checking poll (every 5 s) and the requests tick never
 * re-read it for nothing, and its own re-read touches no files read, so it cannot loop. A household's
 * file changed on ANOTHER page is not seen here; the next page load reads it (spec 5.3 counts it).
 */
export function shouldReloadRequirements(prev: DocumentsLoad | null, next: DocumentsLoad): boolean {
  if (prev?.status !== "ready" || next.status !== "ready") return false;
  const print = (l: Extract<DocumentsLoad, { status: "ready" }>) =>
    l.data.live.map((d) => `${d.id}|${d.category}|${d.expiresOn ?? ""}|${d.version.id}|${d.version.scan}`).sort().join("\n");
  return print(prev) !== print(next);
}
```
  - `contacts/document-requirements-actions.ts` (`"use server"`; the header comment says what `document-requests-actions.ts`' says, for skips): `const fail = (error: string): DocFail => ({ ok: false, error });`; `requireAccountAccess(accountId)`; `if (!seesWholeAccount(access)) return fail("documents.checklist.skipRole");` (D1; import from `@/lib/auth-role`); `isUuid` on every id; `isRequirableCategory(category)` else `fail("documents.request.refused")`; the reads on `await dbForRequest()`; only then `serviceDb()`; the window `Date.now() - Date.parse(row.created_at) > DOCUMENT_REQUIREMENT_UNDO_MS` (skip) or `- Date.parse(row.unskipped_at)` (un-skip); logs name the account and the skip id, never more; every `catch` answers `fail("documents.error.failed")`.
  - `settings/document-requirements-actions.ts` (`"use server"`): `const access = await requireAccountAccess(accountId); if (!access.canManage) return { ok: false, error: m["settings.requiredDocuments.role"] };` then `const list = cleanRequiredCategories(formData.getAll("category").map(String)); if (!list) return { ok: false, error: m["settings.requiredDocuments.failed"] };` then `try { const saved = await setRequiredDocumentCategories(serviceDb(), accountId, list); revalidatePath(\`/dashboard/accounts/${accountId}/settings\`); return { ok: true, list: saved }; } catch (e) { console.error(…); return { ok: false, error: m["settings.requiredDocuments.failed"] }; }`.
  - `in-account-service-reads.test.ts` `ALLOWED`, beside the vault's lines (`:89-95`):

```ts
  // The required-documents checklist (S-07 2c): every skip write follows a request-client read of the contact,
  // the account's list and the skip row (0081's RLS), and a role check; the Undo is the actor's own.
  "app/(dashboard)/dashboard/accounts/[accountId]/contacts/document-requirements-actions.ts": "proven-target",
```
    and beside the other Settings lines (`:111-114`):

```ts
  // The required-documents list (S-07 2c): an Owner or the agency only (canManage), one account column.
  "app/(dashboard)/dashboard/accounts/[accountId]/settings/document-requirements-actions.ts": "owner-only",
```

- [ ] **Step 5: Run** the five test files, `in-account-service-reads.test.ts` (by its full path, never the folder), `src/lib/i18n/ratchet.test.ts`, typecheck, eslint. All PASS.
- [ ] **Step 6: Probes:** (a) the route reading before `getContact` → route case 2 FAILS; (b) the route passing the UTC day → route case 1 FAILS; (c) the skip action without the role check → its Technician case FAILS; (d) the skip's Undo without the window → its case FAILS; (e) `undoUnskip` passing a fresh instant → its case FAILS; (f) `shouldReloadRequirements` answering `true` always → its same-read case FAILS; (g) the Settings action without `canManage` → its Staff case FAILS. Paste each.
- [ ] **Step 7: Commit** every path above, message "documents: the checklist's own read, Not needed and Needed again with the actor's own Undo, and saving the required list (S-07 2c)".

---

## Task 6: The Settings card, its mount, ⌘K (bis-frontend)

**Review:** sonnet. **Runs:** after Task 5; before or after the poll PR merges (it touches none of its files).

**Files**
- Create: `…/settings/required-documents-card.tsx` (+ `required-documents-card.test.ts`)
- Modify: `…/settings/page.tsx` (the accounts read `:79` gains `required_document_categories`; the card's mount after `<WeeklyReportCard …/>`, `:209-212`), `…/settings/page.test.ts` (the fake row `:29-31`, one `vi.mock`, one case)
- Modify: `apps/web/src/lib/palette/registry.ts` (one `SETTINGS_SECTIONS` line appended after `website`, `:44`), `apps/web/src/lib/palette/registry.test.ts` (one case; `cardFiles` gains the card, `:215-224`)

**Interfaces**
- Consumes: `setRequiredDocumentCategoriesAction` (Task 5); `REQUIRABLE_DOCUMENT_CATEGORIES`, `cleanRequiredCategories` (`@bis/db/document-rules`); `useFormSubmit`, `notifyActionResult` (`lib/forms/*`); `Card*`, `Checkbox`, `SubmitButton` (`../../submit-button`); keys `settings.requiredDocuments.*`, `documents.category.*`, `common.save`, `common.actionCrashed`, `palette.settings.requiredDocuments` (Task 2).
- Produces: `RequiredDocumentsCard({ required, action }: { required: readonly RequirableCategory[]; action: (formData: FormData) => Promise<{ ok: true; list: string[] } | { ok: false; error: string }> })` with `id="required-documents"`; a pure `requiredFormEntries(picked: ReadonlySet<RequirableCategory>): [string, string][]` (the hidden inputs it writes, in the vault's order).

- [ ] **Step 1: Read** `…/settings/weekly-report-card.tsx` whole (the pattern this card copies: client component, `useFormSubmit`, `notifyActionResult`, an `onSubmit` form, one `SubmitButton`), `…/settings/page.tsx:60-92, :190-215`, `…/settings/page.test.ts:16-110`, `apps/web/src/lib/palette/registry.ts:25-45, :175-188`, `registry.test.ts:100-118, :205-237`, `components/ui/checkbox.tsx`.

- [ ] **Step 2: Failing tests.**
  - `required-documents-card.test.ts` (`renderToStaticMarkup`, `renderedText`; mock nothing but the action prop):
    1. renders `id="required-documents"`, the title "Required documents", the sentence "Each customer's Documents card will show which of these they're missing.", EIGHT category rows in the vault's order with their words ("ID", "Contract", "Estimate or quote", …, "Warranty") and NO "Other" (D8; mutation: map DOCUMENT_CATEGORIES -> FAILS), with `required: ["insurance"]` drawing Insurance checked (`data-state="checked"` on its checkbox) and the others not.
    2. exactly ONE `data-variant="default"` button, Save (rule 8; mutation: a second primary -> FAILS).
    3. `required: []` draws `settings.requiredDocuments.off`'s words; `["id"]` does not (mutation: always draw it -> FAILS).
    4. `requiredFormEntries(new Set(["warranty", "id"]))` → `[["category", "id"], ["category", "warranty"]]` (the vault's order; mutation: insertion order -> FAILS).
  - `page.test.ts`: the fake `accounts` row gains `required_document_categories: ["insurance"]`; `vi.mock("./document-requirements-actions", () => ({ setRequiredDocumentCategoriesAction: noop }))` beside the other action mocks (define `noop` as `sections.test.ts:30` does if the file has none); a case "mounts the Required documents card with the stored list, bound to THIS account (mutation: drop the mount, or pass [] -> FAILS)": find the element whose `type === RequiredDocumentsCard` in `pageElements()` and assert `props.required` equals `["insurance"]` and `typeof props.action === "function"`.
  - `registry.test.ts`: a case beside `:114`: "registers the required documents settings section (mutation: remove the SETTINGS_SECTIONS entry -> FAILS)" asserting an entry `settings:required-documents` with `href` `${BASE}/settings#required-documents`, group `settings`, `agencyOnly: true`, and that `filterEntries` finds it by "checklist" and by "documentos"; and `cardFiles` gains the card's path, so the anchor-parity case covers it.

- [ ] **Step 3: Run them to see them fail.**

- [ ] **Step 4: Implement.**
  - `required-documents-card.tsx` (`"use client"`), on `weekly-report-card.tsx`'s pattern: state `picked` (a `Set<RequirableCategory>` seeded from `required`); a `<Card id="required-documents" className="scroll-mt-24">` with `CardTitle` `m["settings.requiredDocuments.title"]` and `CardDescription` `m["settings.requiredDocuments.body"]`; a `<form onSubmit={onSubmit}>` whose `useFormSubmit` callback runs `notifyActionResult(() => action(formData), toast, { success: …, crashed: m["common.actionCrashed"] })`, the success words `settings.requiredDocuments.saved` or `.savedOff` by whether `picked` is empty at submit; the eight rows as `<label className="flex min-h-11 items-center gap-2 text-sm md:min-h-8"><Checkbox checked={picked.has(c)} onCheckedChange={(v) => toggle(c, v === true)} />{m[`documents.category.${c}`]}</label>` in a two-column grid (`sm:grid-cols-2`); the hidden inputs from `requiredFormEntries(picked)` (`<input type="hidden" name="category" value={c} />`, so the form posts exactly what is shown, with no reliance on Radix's own form input); `settings.requiredDocuments.off` under the grid while `picked` is empty; one `<SubmitButton pending={pending}>{m["common.save"]}</SubmitButton>`. Tokens only; the checkbox keeps its sanctioned 4px.
  - `page.tsx`: the accounts select string gains `, required_document_categories`; import `RequiredDocumentsCard` and `setRequiredDocumentCategoriesAction`; after `<WeeklyReportCard …/>`: `<RequiredDocumentsCard required={cleanRequiredCategories(account.required_document_categories) ?? []} action={setRequiredDocumentCategoriesAction.bind(null, accountId)} />` (`cleanRequiredCategories` from `@bis/db/document-rules`; a bad stored value draws an empty list rather than throwing the page, and is logged once with `console.error` naming the account).
  - `registry.ts` `SETTINGS_SECTIONS`, appended: `{ anchor: "required-documents", label: m["palette.settings.requiredDocuments"], keywords: ["documents", "checklist", "required", "missing", "vault", "documentos", "requeridos"] },` with a one-line comment "S-07 2c: the required-documents list (settings/required-documents-card.tsx)".

- [ ] **Step 5: Run** the three test files, `src/components/ui/material.test.ts`, `src/lib/i18n/ratchet.test.ts`, typecheck, eslint. All PASS.
- [ ] **Step 6: Probes:** (a) the card drawing nine rows → case 1 FAILS; (b) the page passing `required={[]}` → the page case FAILS; (c) the registry line removed → both registry cases FAIL. Paste each.
- [ ] **Step 7: Commit** every path above, message "settings: the required documents list, one Save, in the command palette (S-07 2c)".

---

## Task 7: The checklist on the Documents card; the contact page's prop; `/styleguide` (bis-frontend)

**Review:** opus. **Runs:** ONLY after the poll PR (`feat/s07-requests-poll`) has merged to `main`.

**Files**
- Create: `…/contacts/document-checklist.tsx` (+ `document-checklist.test.ts`), `…/contacts/document-checklist-handlers.ts` (+ `document-checklist-handlers.test.ts`)
- Modify: `…/contacts/documents-card.tsx` (+ `documents-card.test.ts`), `…/contacts/[contactId]/page.tsx` (one prop, `:243-245`) (+ `page.test.ts:680`), `apps/web/src/app/(dashboard)/dashboard/styleguide/documents-demo.tsx` (+ `documents-demo.test.ts`)

**Interfaces**
- Consumes: the four skip actions and `requirementsRouteFor`, `requirementsLoadFrom`, `checklistView`, `shouldReloadRequirements`, `keepRequirements`, `RequirementsLoad`, `ChecklistView` (Task 5); `RequirableCategory`, `DOCUMENT_CATEGORIES`, `defaultCategory` (existing); keys from Task 2; the poll PR's `router` in `DocumentsCard`.
- Produces:
  - `DocumentChecklist` (presentational) props `{ locale: Locale; load: RequirementsLoad; canSkip: boolean; canAsk: boolean; onAsk: (c: RequirableCategory) => void; onUpload: (c: RequirableCategory) => void; onSkip: (c: RequirableCategory) => void; onUnskip: (c: RequirableCategory) => void; onRetry: () => void }`, root marker `data-document-checklist` (with `data-state="loading" | "error" | "on"`), nothing at all when the list is off.
  - `checklistHandlers({ accountId, contactId, locale, reload, refresh, inFlight }): { skip(c): Promise<void>; unskip(c): Promise<void> }` (`reload` re-reads the checklist; `refresh` is the card's `router.refresh`, so the timeline shows the row).
  - `DocumentsCard` gains an optional prop `checklist?: { canSkip: boolean }` (the contact page passes it; the group page does not, D3). `DocumentsCardView` gains an optional `checklist?: ChecklistSlot` with `ChecklistSlot = Omit<Parameters<typeof DocumentChecklist>[0], "locale">`, and `onFiles` gains an optional third argument `category?: RequirableCategory | null`.
  - A pure `panelFiles(chosen: File[], preset: DocumentCategory | null, locale: Locale): PanelFile[]` exported from `documents-card.tsx` (the container's mapping, so the preset is tested without a DOM).

- [ ] **Step 0: The base.** `git fetch origin && git log --oneline origin/main -3` shows the poll PR's squash commit. `git merge origin/main` in `<WT>` (never rebase; a conflict is impossible here because Tasks 1–6 touched none of its files, so any conflict is a STOP and a report). Then read the merged card: `grep -n "useRouter\|requestsChanged\|setNonce((n) => n + 1);\|router.refresh()" "…/contacts/documents-card.tsx"`: the router and the "a file arrived" path (`setNonce` then `router.refresh()`) must be there (Assumption A5); if not, STOP.

- [ ] **Step 1: Read** `documents-card.tsx` whole (as merged: the View `:298-409` before the merge, its header row, its `pick`, the container's files effect and its `shouldReloadRequests` call, the requests effect and the poll PR's timer), `documents-card-handlers.ts:1-80` (`offer`, `say`, `once`), `document-requests-list.tsx` (the flat-section look: mono label, row rules, ghost `size="sm"` buttons, dots), `document-request-dialog.tsx:154-167` (`DocumentRequestDialog` spreads the form's props, so `initialItems` passes straight through), `documents-card.test.ts` (as merged), `documents-card-handlers.test.ts:1-60`, `[contactId]/page.tsx:236-246`, `[contactId]/page.test.ts:670-690`, `styleguide/documents-demo.tsx` and its test, `apps/web/src/styles/tokens.css` (`--good`, `--warn`, `--crit`, `--text-3`).

- [ ] **Step 2: Failing tests** (`renderToStaticMarkup`, `renderedText`, both languages against literals).
  - `document-checklist.test.ts`:
    1. On, partial (`[met insurance, missing id, expired permit, checking warranty, skipped photo]`): the label "Required" and "1 of 4" (tabular), then the gaps in the list's order, each a dot AND its words: "Missing: ID" (`--warn` dot), "Expired: Permit or license" (`--crit` dot), "Checking: Warranty" (`--warn` dot); then "Photo · Not needed" with a ghost "Needed again"; each gap row with ghost "Ask the customer", ghost "Upload" and ghost "Not needed" (rule 3: assert the words, not only the dots; mutation: drop the word and keep the dot -> FAILS).
    2. No `data-variant="default"` anywhere in it (rule 8; mutation: Upload as primary -> FAILS).
    3. `canSkip: false` draws neither "Not needed" nor "Needed again" (D1); `canAsk: false` draws no "Ask the customer" (the requests read is not ready, so the dialog has no channels).
    4. Complete (`[met insurance, skipped photo]`): "Complete" with a `--good` dot, NO gap rows, and the skipped row still there with "Needed again" (D11; mutation: hide skipped rows when complete -> FAILS).
    5. Off (`{ items: [] }`): renders `""` (mutation: draw "0 of 0" -> FAILS).
    6. Loading: a skeleton line with no copy and no `animate-spin`; error: role="alert" "Couldn't load the list." and a ghost Retry ("Retry").
    7. Spanish: "Requeridos", "1 de 4", "Falta: Identificación", "Vencido: Permiso o licencia", "Revisando: Garantía", "Foto · No hace falta", "Hace falta otra vez", "Pedir al cliente", "Subir", "Completo", "No se pudo cargar la lista." (literals).
  - `document-checklist-handlers.test.ts` (mock `./document-requirements-actions` and `sonner`; one call log):
    1. `skip("insurance")` calls `skipDocumentRequirementAction(acc, contact, "insurance")`, then `reload` and `refresh` once each, and toasts "Insurance isn't needed for this customer." with an Undo; the Undo calls `undoSkipDocumentRequirementAction(acc, skipId)` with the skip id the action answered, then `reload` and `refresh` again (mutation: Undo with no id -> FAILS).
    2. `unskip("insurance")` toasts "Insurance is needed again." whose Undo calls `undoUnskipDocumentRequirementAction(acc, skipId, unskippedAt)` with the INSTANT the action answered (mutation: `new Date().toISOString()` -> FAILS).
    3. A refusal toasts its key's words (`documents.checklist.skipRole` → "Only an Owner or Staff can change a customer's list.") and calls neither `reload` nor `refresh`; a thrown action toasts `common.actionCrashed`'s words; a second click while the first is in flight does nothing (`inFlight`, keyed `skip:<category>`).
    4. Spanish toasts: "Seguro no hace falta para este cliente.", "Seguro hace falta otra vez." (literals).
  - `documents-card.test.ts` (add `vi.mock("./document-requirements-actions", () => ({ skipDocumentRequirementAction: vi.fn(), undoSkipDocumentRequirementAction: vi.fn(), unskipDocumentRequirementAction: vi.fn(), undoUnskipDocumentRequirementAction: vi.fn() }))`):
    1. With a `checklist` slot (on, one gap), the View draws `data-document-checklist` AFTER the header row and BEFORE the file list, and the card STILL has exactly one `data-variant="default"` (Upload) (the existing one-primary assertions, re-run with the checklist drawn; mutation: the checklist's Upload as default -> FAILS).
    2. Without a `checklist` slot (every existing case), no `data-document-checklist` (the group card; D3).
    3. While the files read is loading or failed, no checklist is drawn (the files' state alone, as the requests list).
    4. `panelFiles([pdf "lease.pdf", image "roof.jpg"], "insurance", "en")` files both under `insurance`; with `null`, under `defaultCategory` of each type (the existing rule; mutation: ignore the preset -> FAILS).
  - `[contactId]/page.test.ts:680`: the exact props gain `checklist: { canSkip: true }` (the default access is the agency); one case with `TECH` (`:507`) asserts `checklist: { canSkip: false }` (D1; mutation: pass `canSkip: true` always -> FAILS). Run `…/groups/[groupId]/page.test.ts` unchanged: its `:284`/`:293` exact props still pass (no `checklist`).
  - `documents-demo.test.ts`: the existing exact counts unchanged; `data-document-checklist(?=[\s>=])` occurs FIVE times (English partial, Spanish partial, complete, loading, error); within the demo's markup, every button inside a `data-document-checklist` block is `data-variant="ghost"`.

- [ ] **Step 3: Run them to see them fail.**

- [ ] **Step 4: Implement.**
  - `document-checklist.tsx` (`"use client"`, presentational): `const v = load.kind === "ready" ? checklistView(load.data) : null`. Loading → `<div data-document-checklist data-state="loading" aria-hidden="true"><Skeleton className="h-4 w-1/3 rounded-[var(--radius-ctl)]" /></div>`. Error → `<div data-document-checklist data-state="error" role="alert" className="space-y-1 text-sm">` the `documents.checklist.loadFailed` words and a ghost `size="sm"` Retry (`documents.retry`). Off → `null`. On → a flat section (`document-requests-list.tsx`' look: no box, `--row-line` rules between rows):
    - first line: the label in the Label role (Geist Mono 500, 10px, `tracking-[0.14em]`, uppercase, `text-muted-foreground`), `documents.checklist.label`; beside it `<span className="tabular-nums">{t(m, "documents.checklist.meter", locale, { met, required })}</span>`; when `complete`, a `size-1.5 rounded-full bg-[var(--good)]` dot and `documents.checklist.complete`'s word.
    - each gap: a 6px dot (`--crit` for `expired`, `--warn` otherwise) and `t(m, \`documents.checklist.${state}\`, locale, { category: label })` where `label = t(m, \`documents.category.${category}\`, locale)`; then, wrapping on a phone, ghost `size="sm"` buttons with `min-h-11 md:min-h-8` and the focus ring: "Ask the customer" (`documents.request.open`) when `canAsk`, "Upload" (`documents.upload`), "Not needed" (`documents.checklist.skip`) when `canSkip`. Each button carries `data-checklist-action="ask|upload|skip|unskip"` and `data-checklist-category={category}`.
    - each skipped item: muted `documents.checklist.notNeeded` with `{ category: label }`, and a ghost "Needed again" (`documents.checklist.unskip`) when `canSkip`.
  - `document-checklist-handlers.ts`: on `documents-card-handlers.ts`' `offer`/`say`/`once` shape (copy the three helpers; do not import private ones). Each success: `reload(); refresh();` then the toast with its Undo; each Undo success: `reload(); refresh();`; each refusal: `toast.error(words)`; a throw: `common.actionCrashed`. The category's words in the toast are `documents.category.<c>` in the reader's language.
  - `documents-card.tsx`:
    - View: `checklist?: ChecklistSlot` prop; render `{p.checklist ? <DocumentChecklist locale={p.locale} {...p.checklist} onUpload={(c) => { preset.current = c; uploadRef.current?.click(); }} /> : null}` right after the header row's closing `</div>` and before `{p.panel}`; `const preset = useRef<RequirableCategory | null>(null)`; the header's Upload sets `preset.current = null` before its click; `pick` passes `p.onFiles(files, source, source === "upload" ? preset.current : null)` and then clears `preset.current`; the drop handler passes `null`.
    - Container: `checklist?: { canSkip: boolean }` prop. When given: `requirementsRoute = requirementsRouteFor(accountId, record.id)`; state `{ route, load }` and `requirementsNonce`, one effect fetching it with `cache: "no-store"` through `requirementsLoadFrom`, settling through `keepRequirements` (its own read, its own failure; nothing on screen changes for a re-read until it lands, rule 7); in the FILES settle, before `lastReadyFiles.current = load`, `if (checklist && shouldReloadRequirements(lastReadyFiles.current, load)) setRequirementsNonce((n) => n + 1);` (the ONE trigger besides the handlers; no timer). `const checklistActs = checklistHandlers({ accountId, contactId: record.id, locale, reload: () => setRequirementsNonce((n) => n + 1), refresh: () => router.refresh(), inFlight })` using the poll PR's `router`. `openAsk(items: RequirableCategory[] = [])` sets an `askItems` state; the header's "Ask the customer" calls `openAsk()`; the checklist's `onAsk(c)` calls `openAsk([c])` (D2); `<DocumentRequestDialog … initialItems={askItems} />`. `onFiles(chosen, from, category)` maps through `panelFiles(chosen, category ?? null, locale)`. The View gets `checklist={checklist ? { load: requirementsLoad, canSkip: checklist.canSkip, canAsk: requestsLoad.kind === "ready", onAsk: (c) => openAsk([c]), onUpload: () => {}, onSkip: (c) => void checklistActs.skip(c), onUnskip: (c) => void checklistActs.unskip(c), onRetry: () => { setRequirementsState({ route: "", load: { kind: "loading" } }); setRequirementsNonce((n) => n + 1); } } : undefined}` (the View supplies `onUpload` itself, above).
    - A record that is a GROUP never passes `checklist` (D3); assert nothing about it beyond the group page test staying green.
  - `[contactId]/page.tsx`: `import { seesWholeAccount } from "@/lib/auth-role";` (the pure module, so the page test's `@/lib/auth` factory keeps working) and the card gains `checklist={{ canSkip: seesWholeAccount(access) }}`.
  - `documents-demo.tsx`: render `DocumentChecklist` standalone (outside any `DocumentsCardView`, so the card counts do not move) in five states: English partial, a `lang="es"` Spanish partial, complete with one skipped item, loading, error; `canSkip: true`, `canAsk: true`, every callback a no-op.

- [ ] **Step 5: Run** the six test files, `…/groups/[groupId]/page.test.ts`, `src/components/ui/material.test.ts`, `src/lib/i18n/ratchet.test.ts`, typecheck, eslint. All PASS.
- [ ] **Step 6: Probes:** (a) the checklist's Upload as the default variant → the card's one-primary assertion FAILS; (b) a gap drawn by its dot only → the checklist case FAILS; (c) the un-skip's Undo with `new Date()` → the handlers case FAILS; (d) `canSkip: true` for a Technician on the page → the page case FAILS; (e) the files settle calling `setRequirementsNonce` on EVERY settle (instead of through `shouldReloadRequirements`) → no unit test sees the extra reads (no DOM): say so in the report; Task 9 test 2's request count is its proof. Paste each.
- [ ] **Step 7: Commit** every path above, message "documents card: the required-documents checklist, a meter, each gap with Ask the customer and Upload, Not needed with Undo (S-07 2c)".

---

## Task 8: Regenerate the i18n baselines (bis-crm)

**Review:** sonnet (or orchestrator-checked if byte-identical).

- [ ] **Step 1.** After Tasks 2, 4, 6, 7 have committed: `pnpm --filter web exec tsx scripts/generate-i18n-baseline.ts` (`ratchet.test.ts:6` names it). Expected: byte-identical, or ONLY reductions. If the generator ADDS any count or frozen key, STOP: a task admitted a violation; report the file and the string. (The Settings card reads `m[...]` English as its neighbours do; if the generator freezes it as a new English-only file, report that too: the orchestrator decides whether D6's later work or this PR localises it.)
- [ ] **Step 2.** `pnpm --filter web exec vitest run src/lib/i18n/ratchet.test.ts src/lib/messages.test.ts` → PASS. Commit the two baseline files if changed, message "i18n: baselines after S-07 2c".

---

## Task 9: The e2e spec (bis-e2e-qa)

**Review:** sonnet. **Runs:** never by the agent (the orchestrator runs Playwright).

**Files**
- Create: `apps/web/e2e/document-requirements.spec.ts`

- [ ] **Step 1: Read** `apps/web/e2e/documents-scan.spec.ts` whole (env loading, the fixture contact, the card locators, the `pdf()` builder, the afterAll that removes objects and rows and re-reads), `apps/web/e2e/support.ts:100-135`, `apps/web/e2e/website.spec.ts:80-95` (opening a Settings anchor), `apps/web/playwright.config.ts:160-175` (one worker).
- [ ] **Step 2: Write the spec.** `import { test, expect, type Page } from "./fixtures/test"` (never `@playwright/test`: `clerk-cookie-guard.test.ts`). `test.describe.configure({ mode: "serial", timeout: 120_000 })`. `STAMP = \`DocReq2c${Date.now()}\``. `beforeAll`: `readClientFixture()` (throw if missing); READ and keep the account's current `required_document_categories` (service client), then set it to `{insurance,id}`; one contact on the fixture account through `createContact(serviceDb(), accountId, { firstName: "Lista", lastName: STAMP }, ACTOR)` (refuse `existing`). Locators: `card(page)` as `documents-scan.spec.ts:33`; `checklist(page) = card(page).locator("[data-document-checklist]")`; a gap's button by `[data-checklist-action="skip"][data-checklist-category="id"]`. Every test starts with `page.goto(contactUrl())` (never `reload`).
  1. **The meter and a skip with Undo** (spec §7). `checklist` reads "Required", "0 of 2", "Missing: Insurance", "Missing: ID". Click ID's "Not needed" → the toast "ID isn't needed for this customer." → "0 of 1" and "ID · Not needed". Click the toast's Undo → "0 of 2" and "Missing: ID" again; the database (service client) holds NO skip row for the contact. Click ID's "Not needed" again (keep it). `goto` the contact page: the timeline shows "marked ID as not needed" with the fixture user's mark. Click "Needed again" → "Missing: ID"; the timeline (after a `goto`) shows "marked ID as needed again" above it.
  2. **Upload from a gap, and the meter turns Complete without a reload.** Skip ID again (so only Insurance is required). Count the page's requests to `/document-requirements` from here with `page.on("request")`. Insurance's "Upload": `const chooser = page.waitForEvent("filechooser")`, click, `(await chooser).setFiles({ name: "Policy.pdf", mimeType: "application/pdf", buffer: pdf("policy") })`; the upload panel's category control shows Insurance (read its value; the preset); press the panel's Upload. The row appears; within 30 s and with NO `goto`/`reload`, the checklist reads "1 of 1" and "Complete" (the fake clamd answers clean; the files read sees the scan change and re-reads the checklist). Then wait 15 s more and assert the checklist was re-read at most 4 times in all since the count began (one per actual change: the upload, the verdict, plus slack; mutation it catches: a re-read on EVERY files settle, which the 5-second Checking poll would multiply).
  3. **The Settings card** (the agency's signed-in state, A6). `goto` `/dashboard/accounts/<id>/settings#required-documents`: Insurance and ID are ticked; there is no "Other" row. Untick ID, press Save → the toast "Saved. Each customer's Documents card shows the list."; the database reads `{insurance}`. `goto` the contact page: the checklist reads "1 of 1", "Complete", and no ID row at all (its skip still exists but ID is no longer required).
  `afterAll`: restore the account's list to the value read in `beforeAll` (check the error, re-read it equal); delete the contact's skip rows; remove every stored object of the contact's documents, then the documents, then the contact (`documents-scan.spec.ts`' order); check every `error`; re-read that no row and no object is left.
- [ ] **Step 3:** `pnpm --filter web exec playwright test --list e2e/document-requirements.spec.ts` lists three tests (listing does not run them). `pnpm --filter web exec eslint e2e/document-requirements.spec.ts`. Commit, message "e2e: the required-documents meter, a skip with Undo, an upload from a gap turning Complete without a reload, the Settings card (S-07 2c)".

---

## Task 10: Whole-branch final review (checkpoint, not an implementer task)

**Reviewer:** opus, fresh context. Runs after Tasks 1–9.

- [ ] **Step 1.** Read the spec's §5 and §1–§2, this plan's decisions (as ruled in Task 0) and Deviations, then `git diff 6bf592f9...HEAD` in `<WT>` (the poll PR's own commit arrives through Task 7's merge; review only 2c's paths); walk the coverage table below row by row against the diff.
- [ ] **Step 2.** Web tests by path: every test file Tasks 2–7 touched, plus `src/lib/i18n/ratchet.test.ts`, `src/lib/messages.test.ts`, `src/components/ui/material.test.ts`, `src/lib/documents/read-gate.test.ts`, `src/lib/palette/registry.test.ts`, `"src/app/(dashboard)/dashboard/accounts/[accountId]/in-account-service-reads.test.ts"`, `"src/app/(dashboard)/dashboard/accounts/[accountId]/groups/[groupId]/page.test.ts"`; `pnpm --filter web typecheck`. The db suites on a replica of your own (ports `55611`/`55612`/`55613`): `document-requirements-schema.test.ts`, `schema-grants-guard.test.ts`, `weekly-report-grants.test.ts`, `alert-phone-grants.test.ts` on `post`, and `document-requirements.test.ts`, `record.test.ts`, `timeline-merge.test.ts` behind PostgREST. Re-run two probes of your own choosing, by name. A bis-design-reviewer pass on a running build (the checklist in both themes at desktop and phone width, partial, complete and failed; the Settings card) if the orchestrator provides one.
- [ ] **Step 3.** Hunt specifically: (a) a service-client write in either action file before its request-client proof, or a read of the skip, the contact or the list on the service client; (b) the definer function: either guard without `coalesce`, a path that answers a row for a contact the caller cannot see, any column beyond `(category, state)`, EXECUTE for `anon` or `service_role`; (c) "met" counting a trashed document, an uploading or unclean version, an expired file on the wrong side of the day boundary, or a group the contact does not belong to; the day taken from the server's UTC clock anywhere; (d) a skip's or an un-skip's Undo that is not the actor's own, outside 10 minutes, or a blind restore (not compare-and-set on the instant); (e) the checklist re-reading on a timer, or on every files settle; any `useEffect` that sets state in its body; (f) rule 8 (exactly one `data-variant="default"` on the card with the checklist drawn; one primary on the Settings card), rule 3 (every state a dot AND a word), rule 7 (no spinner, no skeleton flash on a re-read), rule 1 (the meter's label); (g) `documentSkip`/`documentUnskip` missing from any exhaustive map (`authorOf`, `timeline-rows`, `recent-rows`, both timelines, `ROW_ICON`, `ROW_KINDS`); `MEASURED` raised without its comment; (h) a Technician able to skip through any path (D1), or the group page drawing a checklist (D3); (i) 0081's ASCII rule, `lock_timeout` first, no grant on `accounts`, RLS on the new table, the partial unique index; (j) a test that cannot fail (memory "Vacuous test shapes"), a Spanish assertion against `t()`'s output, a raw-markup negative on an apostrophe string; (k) `serviceDb` in any new file under `lib/`, or a new service-client file not in `ALLOWED`; (l) the e2e spec mutating anything but the per-run fixture account, or leaving the account's list changed; (m) any interaction with the poll PR's timer: two timers, a second `useRouter`, or the checklist's re-read feeding back into the requests tick.
- [ ] **Step 4.** Report findings by severity with file:line; the orchestrator routes fixes to the owning task's agent.

---

## Task 11: Rollout (orchestrator; LAST; not a coding task)

Each step reads its own evidence; nothing is inferred from an earlier run.

- [ ] **Step 1. The decisions** D1–D12 are ruled (Task 0 step 3); the ledger records each.
- [ ] **Step 2. bis-ci** (only AFTER Task 10 approves): `gh workflow run ci-project-setup.yml -f step=push-dry-run --ref feat/s07-vault-2c` → its log lists exactly `0081_document_requirements.sql`; then `-f step=push`. Post-apply, read-only with `pnpm --filter @bis/db ci:sql`: `select column_default from information_schema.columns where table_name='accounts' and column_name='required_document_categories'` → `'{}'::text[]`; `select relrowsecurity from pg_class where oid='public.document_requirement_skips'::regclass` → `t`; `select has_function_privilege('authenticated','public.document_requirements(uuid,uuid,date)','EXECUTE'), has_function_privilege('anon','public.document_requirements(uuid,uuid,date)','EXECUTE')` → `t | f`; `select prosecdef from pg_proc where proname='document_requirements'` → `t`; `select count(*) from information_schema.column_privileges where grantee='authenticated' and table_name='accounts' and column_name='required_document_categories' and privilege_type='UPDATE'` → 0. From here on the `@bis/db` suites may run against bis-ci again.
- [ ] **Step 3. Push and CI.** Until Step 2, `e2e` is red on its migration check by design (0081 not on bis-ci); after Step 2, re-run and read `verify` and `e2e` ON THE HEAD SHA (`gh api repos/{owner}/{repo}/commits/<sha>/check-runs`). A CI-vs-local disagreement is an environment finding first (memory "CI vs local divergence").
- [ ] **Step 4. Production** (MCP on `tlbkbmlrfafquucsmsmm`): read-only pre-flight `select max(version) from supabase_migrations.schema_migrations` → the 0080 apply; then `apply_migration` with 0081's exact text, ONCE (Task 1 step 6 proved no backslash; md5 equals Task 1's). Additive, so it may precede the merge. Ledger line: `0081 APPLIED <date> on bis-ci and production — NEVER RE-APPLY`.
- [ ] **Step 5. Parity and the advisor.** `docs/runbooks/ci-supabase-project.md` §5: `fingerprint.sql` on both; the column, its CHECK, the table, its policies and index, the function's body and ACL equal. MCP `get_advisors` (security): a finding about `document_requirements` (SECURITY DEFINER in `public`) is EXPECTED, as for 0078's `document_space_used`; read it, confirm it names only that, and record it in the ledger beside 0078's.
- [ ] **Step 6. Gates, one at a time:** `pnpm check`, `pnpm --filter web build`, `pnpm --filter web test:e2e` (check no `screenshots.yml` run is in progress first).
- [ ] **Step 7. Preview, by hand (owner and orchestrator together):** on the branch's Preview (bis-ci), on the per-run-style test account (never Test Client One): Settings → Required documents → tick Insurance and ID → Save; a throwaway contact: "0 of 2", "Missing: Insurance", "Missing: ID"; Not needed on ID → Undo → back; Upload from Insurance (the panel shows Insurance) → "Checking: Insurance" then "Complete" (the real worker); set an expiry date in the past on the file → "Expired: Insurance"; Ask the customer from the gap → the dialog opens with Insurance ticked; sign in as a Technician assigned to the contact (if the account has one) → the checklist shows, with no Not needed. Both themes; a phone width. Then untick everything → Save → the checklist is gone. Delete the throwaway contact and its files.
- [ ] **Step 8. Merge** (squash, through the PR, after the head SHA's `verify` and `e2e` are green and Task 10's findings are closed). The PR body names: the owner's rulings D1–D12, deviations 1–9, the pinned tests this PR changes, "Not in this PR", the Preview check's results, and the 0081 apply lines.
- [ ] **Step 9. After the deploy.** The deploy reads READY on the merge SHA. Spec §8: off for every account until an Owner opts in, so NO production account's list is set by us, except, if one exists, an AGENCY-OWNED production account: set it, read one contact's card ("0 of N"), then set it back to empty and re-read `'{}'`. Tracker: item 6 / F-005 stay `in_progress` (spec §8) with "part 2c (the required-documents checklist) shipped #<n>".

---

## Spec coverage

| Spec | Where |
|---|---|
| §1 row 2c: required categories (Settings), per-customer skips, the meter and the missing items on the Documents card, migration 0081 | Tasks 1, 3, 5, 6, 7 |
| §1 "Not in part 2": no checklist on household/business pages or the list drawer; no required fields; packs fill the setting later | D3; "Not in this PR"; D12 |
| P7 the list is the account's; Owners pick in Settings; empty = off | Task 1 (column, default `{}`), Task 5 (Settings action, `canManage`), Task 6 (card); D6 (who reaches it), D8 (eight) |
| P7 a per-customer "No hace falta" skip | Task 1 (table), Task 3 (writes), Task 5 (actions), Task 7 (buttons); deviations 1, 2 |
| P7 an expired file counts as missing ("Vencido") | Task 1 (`expired` state, `>= p_today`), Task 7 (words, `--crit` dot); D4 |
| §5.1 `accounts.required_document_categories text[] not null default '{}'`, each one of the keys | Task 1 (column, CHECK through `app.required_document_categories_ok`); D8 |
| §5.1 `document_requirement_skips`, unique on (contact, category), server-written, members read under the contact's visibility | Task 1 (partial unique on active skips, RLS, grants); deviation 1 |
| §5.2 a Documents section in Settings, registered in ⌘K, the categories as checkboxes, the sentence, one primary Save | Task 6; D6, D8 |
| §5.3 met = not trashed, clean version, not expired in the account's zone, on the customer or any household/business they belong to; skipped left out of both numbers | Task 1 (the function), Task 3 (`requirementsMeter`), Task 5 (`documentsClock`'s today); deviations 3, 4, 6; D7 |
| §5.4 the header reads "2 de 3" | Task 7 (the checklist's first line); D9, deviation 7 |
| §5.4 each unmet item named, "Falta" / "Vencido", with Pedir al cliente (that item ticked) and Subir (category preset) | Task 7 (`openAsk([c])`, `panelFiles` preset); D2, D10 |
| §5.4 skipped reads "No hace falta" with "Hace falta otra vez"; at once with Undo; each a timeline row (person mark) | Tasks 3, 4, 5, 7; deviation 2 |
| §5.4 all met: "Completo" (dot + word), the list disappears; off: nothing drawn | Task 5 (`checklistView`), Task 7; D11 |
| §6 the checklist's read failing shows "No se pudo cargar la lista" without blanking the files | Task 5 (own route), Task 7 (own load, error state) |
| §7 RLS and grants for 0081 | Task 1; Task 11 step 2 |
| §7 e2e: the checklist meter and a skip with Undo | Task 9 test 1 (plus tests 2 and 3) |
| §8 every migration: bis-ci first, production once, parity, merge; 2c off until an Owner opts in | Task 11 steps 2, 4, 5, 9 |
| §8 tracker: item 6 / F-005 stay in progress | Task 11 step 9 |
| 2a amendment §3.2: what opens is the newest clean ready version | deviation 4 (met = any ready clean version) |
| 2b amendment §4.5 (2026-10-16): a staff upload answers a request item | unchanged by 2c; a staff upload from a checklist gap is an ordinary staff upload, so it also answers an open request's item through 2b's trigger |

## Self-review notes (the writer's own pass, 2026-10-16)

- **Spec coverage:** every §5 bullet maps to a task above. Three of the spec's words are not followed literally, each because the code makes them impossible or wrong, and each is an owner decision in Task 0, not a silent change: "the nine categories" (D8), "the card header reads" (D9: the title is server-rendered), "Owners and agency edit" (D6: Settings is agency-only). The skips table's shape differs from §5.1 (deviation 1) because §5.4 needs both moves on the timeline.
- **The poll PR:** Tasks 1–6 touch none of `documents-card.tsx`, `documents-card.test.ts` or `document-requests.spec.ts`; Task 7 merges `origin/main` first and STOPS if the poll PR's router or "file arrived" path is not there; the checklist adds no timer and feeds nothing back into the requests tick.
- **Vacuity pass:** every prescribed test names its mutation; the order-sensitive ones (each action's proof-then-write) assert ONE shared call log; every copy assertion uses `renderedText` and literal Spanish; the checklist's "re-read once per change" has no DOM proof in vitest, and Task 7 step 6 says so and points at Task 9 test 2's request count instead of pretending.
- **Types across tasks:** `REQUIRABLE_DOCUMENT_CATEGORIES`, `RequirableCategory`, `RequirementState`, `cleanRequiredCategories`, `requirementsMeter`, `DOCUMENT_REQUIREMENT_UNDO_MS` (Task 3, document-rules) → Tasks 5, 6, 7; `DocumentRequirement`, `DocumentSkipRow`, `TimelineDocumentSkip`, the ten functions (Task 3) → Tasks 4, 5; `RequirementsLoad`, `RequirementsResponse`, `ChecklistView`, `checklistView`, `shouldReloadRequirements`, `keepRequirements`, `requirementsRouteFor`, `requirementsLoadFrom` (Task 5) → Task 7; the four skip actions (Task 5) → Task 7's handlers; `setRequiredDocumentCategoriesAction` (Task 5) → Task 6.
- **Not executed:** nothing in this plan was run; the SQL and TypeScript are written against the files read at `6bf592f9` (and the poll PR at `9fdfc4f7`) and are marked where a name must be confirmed by a read (`record_document_scan`'s argument order, the package typecheck script, `timeline-rows.ts`' `detail` type, the kit's env names). Each such read is a named step, not an assumption left open.
