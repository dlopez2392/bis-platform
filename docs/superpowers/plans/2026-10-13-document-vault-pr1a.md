# The document vault, PR 1a (S-07 + F-005 part 1, migration 0077): implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Staff keep a customer's or a household's/business's files on its record: a Documents card in the "what they have" column of the contact and group pages, uploads (including the phone camera, with location data stripped in the browser) that go straight to a private Supabase bucket through a server-reserved signed URL, a viewer, inline edits with a compare-and-set Undo, Owners only, trash with Undo and Restore, a row on the record's timeline, and a clean-up pass on every cron tick. Migration 0077 lands the whole schema of spec §3 (both tables, the bucket, RLS, the quota function), including what PR 1b's versions UI will use.

**Architecture:** 0077 creates the private `documents` bucket, `documents` and `document_versions` (SELECT-only for `authenticated`, RLS by the record's own visibility plus an Owners-only fence), and `public.reserve_document_version` (service role only, locks the account row, sums every version, refuses past 5 GiB). Every write is a server action: `requireAccountAccess`, a request-client (RLS) read that proves the caller sees the record or the document, then a `serviceDb()` write (the 0053 pattern, `apps/web/src/lib/db.ts:11-19`). Uploads never cross a Vercel function body: `startDocumentUploadAction` reserves and returns a signed upload URL, the browser PUTs the (EXIF-stripped) bytes with progress, `finishDocumentUploadAction` downloads the object with the service role, checks its real size and leading bytes against the declared type, hashes it, and only then marks it ready. The card is a client component that reads its own route (the Properties card's shape, `places-card.tsx:28-31`). The timeline gains one source, `documents`, read from the `documents` table on the request client so RLS alone decides who sees a row. The pass `documentsSweep`, on every tick, purges 30-day-old trash and abandoned uploads, object first, row second.

**Tech Stack:** Postgres 17 (Supabase) migration; supabase-js 2.110.8 (`@supabase/storage-js` 2.110.8: `createSignedUploadUrl`, `createSignedUrl`, `download`, `remove`); Next.js 16.3.6 App Router (server actions, route handlers, client components); React 19.2.4; vitest 4 (`renderToStaticMarkup`, no DOM; `vi.mock`); the `@bis/db` suites proven on a local PG18 replica and by CI `verify`; Playwright (bis-e2e-qa writes it, the orchestrator runs it).

**Spec:** `docs/superpowers/specs/2026-10-13-document-vault-design.md` (owner-approved 2026-10-13: V1 staff vault first; V2 one record per file; V3 RLS visibility + Owners only + server-minted signed URLs; V4 5 GB per account, 25 MB per file; V5 nine categories; V6 server-reserved direct uploads). Base: `main` at `dc3e4ab6` (#257) plus the spec commit `809b31a7`. Every file:line below was read off this worktree at `809b31a7`; anything not read is labelled **Assumption**.

`<WT>` = `C:\Users\danlo\bis-platform\.claude\worktrees\s07-vault` (Git Bash: `/c/Users/danlo/bis-platform/.claude/worktrees/s07-vault`), branch `feat/s07-vault`. `<SCRATCH>` = the session scratchpad, written out as a literal absolute path in every command. `…/accounts/` = `apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/`. `…/api/` = `apps/web/src/app/api/accounts/[accountId]/`.

## Global Constraints

- **NEVER `git stash`, `git reset`, `git checkout --`, `--amend`, or any history rewrite** in the shared worktree. Another agent's uncommitted work lives in the same tree. To undo your own edit, edit it back. To see committed text, `git show HEAD:<path>`.
- **Ownership (tag on every task; no task edits a file its owner does not own).**
  - **bis-db-schema:** `packages/db/supabase/migrations/0077_document_vault.sql`; `packages/db/src/document-rules.ts` (new, the constants the tests pin); `packages/db/src/test/{document-vault-schema,document-vault-rls,document-vault-reserve-lock}.test.ts` (new); `packages/db/src/account-teardown.ts` (one list entry, `ACCOUNT_OWNED_TABLES`, and the stored-objects leg of `deleteAccountCascade`) and `packages/db/src/__tests__/account-teardown-storage.test.ts` (new); `packages/db/src/test/places.test.ts:144-149` (one added ordering line). Writes the migration, never applies it.
  - **bis-crm:** `packages/db/src/documents.ts` (new) and `packages/db/src/test/documents.test.ts` (new); `packages/db/package.json` (one subpath export, `./document-rules`, Task 3); `packages/db/src/record.ts` (the `documents` timeline source), `packages/db/src/test/record.test.ts` (one case), `packages/db/src/test/timeline-sources.test.ts` (the source list); `packages/db/src/contacts.ts:1009-1035` (`deleteContacts`' purge hook) and `packages/db/src/test/contacts.test.ts` (one expectation, one describe); `…/accounts/contacts/{actions.ts,actions.test.ts,bulk-action-bar.tsx,bulk-action-bar.test.ts}` (Task 17: the delete takes the files with it); `packages/db/src/index.ts` (own lines only); `apps/web/src/lib/documents/{rules,content-check,expiry,documents-load,document-view}.ts` and their tests (new); `…/accounts/contacts/documents-actions.ts` and its test (new); `…/api/contacts/[contactId]/documents/route.ts`, `…/api/groups/[groupId]/documents/route.ts` and their tests (new); `…/accounts/in-account-service-reads.test.ts` (one line); `apps/web/src/lib/record/{record-cards,timeline-rows,author-mark,recent-rows,loaders,group-loaders}.ts` and their tests; `…/accounts/contacts/[contactId]/{page.tsx,activity-timeline.tsx}` and their tests; `…/accounts/groups/[groupId]/{page.tsx,group-timeline.tsx,loading.test.ts}` and their tests; `apps/web/src/lib/messages.ts` and one `describe` in `apps/web/src/lib/messages.test.ts` (**Task 2 only**); `apps/web/src/lib/i18n/{catalogue,ratchet}-baseline.json` (regenerated in Task 13, never hand-edited).
  - **bis-frontend:** `apps/web/src/lib/documents/{strip-image,upload-client}.ts` and their tests (new); `…/accounts/contacts/{documents-card.tsx,documents-card-handlers.ts,document-upload-panel.tsx,document-viewer.tsx}` and their tests (new); `apps/web/src/app/(dashboard)/dashboard/styleguide/{documents-demo.tsx,documents-demo.test.ts}` (new) and `styleguide/page.tsx` (one import, one section).
  - **bis-automations:** `apps/web/src/lib/automations/passes/documents-sweep.ts` and its test (new); `apps/web/src/lib/automations/registry.ts` (one import, one array entry); `apps/web/src/lib/automations/cron-coupling.test.ts` (one case); `apps/web/src/lib/automations/sentinel.test.ts:274` (the registry's pinned key list).
  - **bis-e2e-qa:** `apps/web/e2e/fixtures/sweep.ts`, `apps/web/e2e/fixtures/sweep.test.ts`, `apps/web/e2e/auth.teardown.ts` (the documents leg); `apps/web/e2e/documents.spec.ts` (new); `apps/web/e2e/record-page.spec.ts:48,165` and `apps/web/e2e/group-page.spec.ts:207-208` (the card order lists).
  - **Orchestrator:** the ledger, the bis-ci and production applies of 0077, the parity check, the gates, the PR, the roadmap tracker row. No `DESIGN.md` edit: its "Record page, documents and provenance" section (Documents paragraph) already states this PR's rules.
- **Shared files, one task at a time, in this order.**
  - `apps/web/src/lib/messages.ts`: **Task 2 only.** A `.es` twin goes on the line directly under its English key; the block goes directly after `"places.title.es"` (`messages.ts:3804`); Step 3b adds five twins to existing keys. No other task adds a key; a task that finds one missing STOPS and reports it, and the orchestrator re-opens Task 2.
  - `packages/db/src/index.ts`: **Task 3 only** (the documents block directly after the places block's closing line `} from "./places";`, and `document-rules` beside it); **Task 8** adds nothing (the timeline types are re-exported by the existing record block, `index.ts` record block, which already exports `TimelineEntry`/`TimelineSource`).
  - `packages/db/src/record.ts`: **Task 8 only.**
  - `packages/db/src/contacts.ts` (+ `test/contacts.test.ts`): **Task 3 only.**
  - `…/accounts/in-account-service-reads.test.ts`: **Task 5 → Task 17** (17 edits one comment).
  - `…/accounts/contacts/[contactId]/page.tsx` and `…/groups/[groupId]/page.tsx` (+ tests): **Task 8 → Task 11** (8 touches only timeline wiring; 11 adds the card slot).
  - `apps/web/src/lib/record/record-cards.ts` (+ test): **Task 11 only.**
  - `apps/web/src/lib/i18n/*-baseline.json`: **Task 13 only**, after Tasks 2, 7, 8, 9, 10, 11, 12 and 17 have committed.
- **Migrations (memory "Local DB replica"; bis-ci and production are applied by the orchestrator only).** bis-db-schema writes 0077 and proves it on a **local PG18 replica on its own port** (Task 1), red on `pre` and green on `post`, every mutation probe red BY NAME. **No `@bis/db` vitest may run against bis-ci until Task 15 step 2 has applied 0077 there.** The reason is concrete: every `@bis/db` run starts with `src/test/global-setup.ts:25-45`, whose `sweepAbandonedFixtures` deletes through `ACCOUNT_OWNED_TABLES`, which Task 1 extends with `documents`, a table bis-ci does not have yet; and every `withTestAccount` teardown (`test/fixtures.ts:140-149`) runs the same list. Db tests are therefore proven on the replica (`withRollback` suites), on the replica behind a local PostgREST (`withTestAccount` suites, memory "Local DB replica" 2026-10-08 additions), or by CI `verify`'s in-runner stack after the orchestrator pushes.
- **Replica ports (one per agent, never `5432`):** Task 1 implementer `55520`, Task 1 reviewer `55521`; Task 3 implementer Postgres `55522`, PostgREST `55523`, gateway `55524`; Task 3 reviewer `55525`/`55526`/`55527`; Task 8 `55528`/`55529`/`55530`; spare `55531`. Scratch: `<SCRATCH>/s07-t<N>-impl/` and `<SCRATCH>/s07-t<N>-review/`.
- **SQL rules:** the migration file is ASCII only with no backslash anywhere (memory "MCP SQL escapes"; checked with a node byte count that has a positive control, because `grep -P` exits 2 silently in Git Bash). A null in a policy or guard fails CLOSED: every boolean built from a nullable value is `coalesce(…, false)` (memory "plpgsql NULL guard"; `app.is_account_owner` and `app.sees_all_customers` already coalesce, `0066_staff_and_roles.sql:62-66`, `0068_mine_unassigned_technician.sql:75-78`). `reserve_document_version` raises on a NULL argument before it reads anything. A Supabase `head: true` count throws on `count === null` (memory "head-count null"); this plan adds no head count, and a reviewer who finds one checks it.
- **0053, server-only writes.** `authenticated` gets SELECT and nothing else on both tables (the schema-wide guard `packages/db/src/test/schema-grants-guard.test.ts:63` lists every client write; a new table with none needs no entry, and a missed revoke fails there by name). Every write runs on `serviceDb()` AFTER `requireAccountAccess(accountId)` and a request-client read (`dbForRequest()`, `apps/web/src/lib/db.ts:21-26`) that returns the record or the document. A file that mentions `serviceDb` under `…/accounts/`, `…/api/` or `apps/web/src/lib` needs its line in `…/accounts/in-account-service-reads.test.ts:62` (`ALLOWED`) with its reason; this plan adds exactly one, `documents-actions.ts: "proven-target"`.
- **DESIGN.md definition of done for every UI task (8–12):** tokens only, no hard-coded colours, radii or shadows (radii `rounded-[var(--radius-ctl)]` 8px, `rounded-[var(--radius-card)]` 12px, pills `rounded-full`); both themes via the `.dark` class; the blur fallback (the card is a card: no `backdrop-filter`; the viewer is a Dialog overlay and inherits `components/ui/dialog.tsx`'s own glass); **rule 3:** an expiry 30 days away or less, or past, and "In the trash" are a dot AND a word, never colour alone; Owners only is a lock icon AND the word; **rule 4:** the whole row opens the viewer, hover `--surface-3`, a visible `:focus-visible` ring, no checkboxes on rows; **rule 5:** loaded, empty (the spec's sentence plus Upload), error (the card's own "Couldn't load documents." with Retry, inside the record card's own boundary, `components/record/record-card.tsx:95-100`); **rule 6:** trash, restore and every inline edit run at once with an Undo toast; no confirmation dialog anywhere in PR 1a (the typed-name purge is PR 1b); **rule 7:** skeleton rows, never a spinner; **rule 8:** the card is its own view with exactly ONE primary button: Upload when the panel is closed, the panel's Upload when it is open (the header's Upload is not rendered while the panel is open); Take photo, Retry, Restore and every menu item are `ghost`; controls `min-h-11 md:min-h-8`; nothing animates on scroll; `prefers-reduced-motion` respected (the progress bar has no transition under it). The record page names no hero (rule 11): nothing on the card uses `--gradient-hero`.
- **Browser code imports the vault's rules from `@bis/db/document-rules`** (the pure subpath Task 3 adds), never from the `@bis/db` barrel, which carries server code.
- **Copy:** every new string through `t(m, key, locale, params)` / `tr.text()` / `plural()` with an `.es` twin in the same commit (the ratchet, `apps/web/src/lib/i18n/ratchet.test.ts`, admits no new key without one). New `.tsx` code carries no JSX literal copy with a letter in it (`ratchet-scan.ts`). Usted for every new Spanish string (spec §4.5, Q5). The spec's §2 category words and §4.2/§4.5 sentences verbatim. No `{{…}}`, no milestone codes, no vendor jargon (never "Supabase", "bucket", "signed URL", "EXIF" in copy). Every server action answers a messages.ts KEY with params; the card translates it in the reader's language (the places-actions convention, `places-actions.ts:33-36`). Every Spanish assertion compares against the literal Spanish string from `m["….es"]`, never against `t()`'s output (a missing twin falls back to English silently).
- **Every test can fail.** Each test names the mutation that breaks it. Run the probe, see the test fail BY NAME, paste the failing assertion line into the report, revert by editing back. A `-t` filter that matches nothing passes silently: check the run count in vitest's summary block. Where a rule exists twice, probe both copies: the visibility rule is RLS on `documents` AND the same rule reached through `document_versions` (probe both policies); the card renders on the contact page AND the group page (probe both slots); the request-client proof precedes the service write in EVERY action (probe two actions, not one).
- **The `vi.mock("@bis/db")` factory check.** A task that adds a NEW named import from `@bis/db` to an existing module adds that name to every bare factory reaching the module: `grep -rln 'vi.mock("@bis/db"' apps/web/src | xargs grep -ln "<module basename>"`. A factory built on `importOriginal` gets the real function unless the name is added to its mock object; add it there too so no test reaches a real database call.
- **Running tests.** Only the affected tests, by path: `pnpm --filter web exec vitest run "<path>" …`, `pnpm --filter web typecheck`, `pnpm --filter web exec eslint "<touched files>"`. `@bis/db` suites only on the replica (above), judged by vitest's summary block (the `ERR_PNPM_RECURSIVE_EXEC_FIRST_FAIL` trailer lies about the exit; capture an exit code to a file with nothing after the command). Never the gates (`pnpm check`, `pnpm --filter web build`, `pnpm --filter web test:e2e`) and never Playwright: the orchestrator runs them, one at a time (memory "Agent test scope"). Never pass the folder `…/accounts/` to vitest (it holds `calls/[callId]/actions.test.ts`, a live test); never run `src/app/f/[publicId]/actions.returning-lead.test.ts` or `weekly-metrics.live.test.ts`.
- **Mutating e2e only on the per-run fixture account** (`e2e/.auth/client-fixture.json`, `readClientFixture()`, `e2e/support.ts:103-111`), never `Test Client One`; every seeded row and every stored object deleted in `afterAll`, each error checked, then re-read to confirm none is left.
- **Nothing sends, nothing calls a real provider.** No script, REPL or test writes to bis-ci or production storage except the orchestrator's e2e runs on the fixture account.
- **Commits:** `git add -- <new files>` then `git commit -m "<type>(<scope>): <what and why>" -- <every path>`. Never `-A` or `.`. If `.git/index.lock` exists, wait and retry; never delete it. Never push (the orchestrator pushes). Never touch `main`. Trailer lines on every commit: `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>` and `Claude-Session: https://claude.ai/code/session_013RThMy9QC8x7FZ94Lxib9p`.
- **Never** apply a migration outside your own replica, run SQL that writes to a shared project, mutate Test Client One, create or edit `.env*`, or delete a storage object outside the fixture account.

## Not in this PR (PR 1b)

- Upload a new version, the viewer's Versions list, and "Version 2" on a row (0077's `document_versions` and `reserve_document_version` already serve them; PR 1a only ever writes a document's first version).
- Delete forever with the typed title (the trash list in 1a offers Restore only, and says "Deleted for good in N days").
- (Moved INTO 1a by plan review I5: `deleteAccountCascade` removes the account's stored objects before its rows, Task 1 Step 11b, because the demo tenant is rebuilt through it every Monday in production.)
- The "4.1 of 5 GB used" line above 80%.

## Deviations from the spec (the source decided; evidence cited)

1. **Column names `client_group_id` and `place_id`, not `group_id` and `property_id`** (spec §3.2). Every table that names a group calls it `client_group_id` (`0069_client_groups.sql:62`, `0071_places_and_equipment.sql:40`), and properties are `public.places` (`0071_places_and_equipment.sql:36`); there is no `properties` table. The indexes are renamed with them: `documents_by_contact (account_id, contact_id) where contact_id is not null`, `documents_by_group (account_id, client_group_id) where client_group_id is not null`, `documents_trashed (deleted_at) where deleted_at is not null`.
2. **Deleting a customer deletes their files, objects first** (spec silent; owner ruling 2026-10-13, replacing this plan's first answer, which blocked the delete). The order is fixed, and every step is the app's: (1) `bulkDeleteContactsAction` (Owner-only, `…/contacts/actions.ts:466-486`) has `deleteContacts` (`packages/db/src/contacts.ts:1019-1035`) compute the deletable ids exactly as today (bookings, deals and conversations still block, `:1024`); (2) for those ids, `purgeContactDocuments` (service role, Task 3) removes each document's stored objects from the `documents` bucket, then deletes that document's row (its versions cascade), then emits `document.purged` with actor `user` (the Owner); (3) only then are the contact rows deleted. The record FKs stay composite same-account keys (0050's shape, as `places_contact_fkey`, `0071:53-56`) with **NO ACTION, not CASCADE**: the app has already removed every document row before step 3, and the FK is the backstop that makes "no contact row is deleted while a document row still points at it" a database fact, not a hope. Consequences, each named and tested (Tasks 3 and 17): a document uploaded between steps 2 and 3 makes step 3 fail on the FK for the whole statement, the action answers "Delete failed — please try again." and the retry purges it, so nothing is orphaned; a storage removal that fails keeps THAT customer (and the rows of its documents not yet purged), logs the contact and document ids, and the toast says "kept N whose files couldn't be deleted" — one remove call per document, and in 1a a document has exactly one version, so at most that one document's object is in doubt, and the retry finds it again because removing a missing object is not an error (A4). The confirmation dialog states how many files go, counted on the Owner's request client (`countContactDocuments`, a `head: true` count that throws on `count === null`), trashed files included. `ACCOUNT_OWNED_TABLES` (`account-teardown.ts:19-28`) still gains `documents` before `equipment` (deleting `documents` cascades `document_versions`), or every `withTestAccount` teardown and the e2e fixture teardown would fail on the FK. **Groups cannot be deleted in the app today:** nothing under `packages/db/src` or `apps/web/src` calls `.from("client_groups").delete()` (the only `client_groups` write is the update at `client-groups.ts:430`), and 0069's functions remove memberships, never a group (`remove_group_membership`, `0069:367-380`); only the account teardown deletes groups. A future group delete must purge first, and the NO ACTION FK refuses it until it does. `opportunity_id` is a plain FK (`opportunities` has no `(account_id, id)` key, `0050_same_account_fks.sql:94-97` adds one only to contacts and calendars), unused in part 1.
3. **The timeline row is read from `documents`, not from `events`, and the event payload carries no title** (spec §3.6). `events_read` lets every Owner and Staff read every event in the account (`0001_tenancy.sql:99`), so a title in `document.added`'s payload would show an Owners-only file's name to Staff through the API; and `events_technician_none` (`0068:144-145`) hides every event from a Technician, so their customers' document rows would vanish. Reading `documents` on the request client lets RLS decide (Technician scope and Owners only included). The row: "{who} added a file: {title}" (or "took a photo: {title}" for a camera file) at `created_at`, the person mark from `created_by`, and the status "In the trash" (a dot and the word, rule 3) while it is trashed. Trashing, restoring and purging are recorded as events (`document.trashed`, `document.restored`, `document.purged`, plus `document.added`) with payload `{ documentId, contactId | groupId }` (no title and no category: an Owners-only file's metadata must not reach Staff through `events_read`, plan review minor 1); a purged file leaves the timeline because it is gone for good. One row per document keeps the source on the timeline's single cursor column (`timeline-cursor.ts:74-79`); two rows per document would collide on `(at, id)`.
4. **The sweep's failures reach the agency through opsWatch, not `automation_log`** (spec §5.4, amended by plan review I4). A run that counted any failure logs its counters and throws: `runPasses` records a failure only on a throw (`apps/web/src/lib/automations/harness.ts:34-45`), and opsWatch alerts when a cron pass fails on two consecutive ticks (`apps/web/src/lib/ops/watch.ts:52-56`); the pass runs every tick, so two failing runs are 30 minutes apart, and a one-off blip heals without an alert. `automation_log` is the client-readable history of what automations sent on a client's behalf, its `source` and `channel` are closed CHECKs (`0046_automation_log.sql:33-39`, channel in `sms|email|ai`), and a new source must arrive with a releaser and a title (`packages/db/src/automation-log.ts:9-27`). The row stays for the next run, as the spec says.
5. **The card's count is in its first row ("3 files"), not in the card title** (spec §4.1). `RecordCard`'s title is a string the server page builds before the client card reads its own route (`components/record/record-card.tsx:108-124`; `places.title` likewise has no count).
6. **The sweep runs on EVERY tick, not once a day** (spec §5.4, amended with this plan after review I4): with nothing due it is two reads on partial indexes (`document_versions_uploading`, `documents_trashed`) and no write, and only an every-tick pass can fail twice in a row inside an hour, which is what opsWatch alerts on (deviation 4). An upload counts as abandoned three hours after its reservation, an hour past its signed URL's two-hour life (`cron-coupling.test.ts` pins `ABANDONED_UPLOAD_MS >= SIGNED_UPLOAD_URL_MS + one tick`).
7. **DOCX/XLSX: the ZIP's central directory must name `[Content_Types].xml` and an entry under `word/` (DOCX) or `xl/` (XLSX)** (spec §5.2 says "the `[Content_Types].xml` part naming word or xl"). Entry names are stored uncompressed in the central directory (read from the end-of-central-directory record, so a writer that uses data descriptors is still read), so this needs no inflate; the content of `[Content_Types].xml` itself is deflated. Same outcome: a renamed `.exe` or any other ZIP is refused.
8. **Undo of an inline edit and of the Owners-only switch is a server-built payload** (`InlineField`'s `undoWith`, `components/inline-field.tsx:109-113`), so the compare-and-set runs on the server against the value the save actually stored; the toast's Undo of "Move to trash" restores only while `deleted_at` still equals the instant the trash wrote, and the Undo of Restore trashes only while `deleted_at` is still null.
9. **The list reads at most 200 live and 200 trashed documents per record** (`MAX_DOCUMENTS_READ`); spec §4.1 names no cap. A record past 200 shows "Showing the newest 200." (key `documents.capped`). Paging waits for part 3's account-wide view.

## Spec findings (raised to the orchestrator; resolved here as stated)

- **F1 — the bucket on the in-runner stacks.** `ci-local-supabase.sh` starts the stack, then runs the bootstrap with `psql "$db_url"` (`.github/scripts/ci-local-supabase.sh:304`, script line `psql "$db_url" -X -q -v ON_ERROR_STOP=1 --single-transaction -f "$BOOTSTRAP"`), whose `insert into storage.buckets` (`bootstrap/ci-project.sql:93-97`) already works there, and then `supabase db push --local --workdir packages/db --yes` (script line 305) on the same database. A migration's `insert into storage.buckets` therefore runs against a `storage` schema that exists. **Assumption:** `db push` connects as the same `postgres` role the bootstrap's `$db_url` uses (not read in the CLI source); CI `verify` is the proof, and if it fails the bucket moves to the bootstrap as well (one statement, the same values) and this plan's Task 1 says why. No bootstrap change is made up front: a fresh environment must get the bucket from the migration (spec §3.1).
- **F2 — production's `apply_migration` and `storage.buckets`.** **Assumption:** a hosted project accepts a direct `insert into storage.buckets` in a migration. Evidence: bis-ci got `brand-logos` from the same direct insert (`docs/runbooks/ci-supabase-project.md` §2), and the parity fingerprint compares bucket rows (`packages/db/supabase/parity/fingerprint.sql:153-154`) without listing the bucket as an allowed difference (runbook §5). bis-ci is applied first (Task 15 step 2): if it refuses, the whole migration rolls back there and the orchestrator stops before production.
- **F3 — CSP.** No content-security policy exists: `apps/web/next.config.ts` has no `headers()`, `apps/web/vercel.json` holds only the cron, and `apps/web/src/proxy.ts` sets no header (grep for `Content-Security-Policy`, `img-src`, `connect-src` under `apps/web/src`, `next.config.ts` and `vercel.json`: no hit). No change is needed for the viewer's image, the PDF frame or the upload PUT (spec §7's conditional).
- **F4 — `serverActions.bodySizeLimit` stays `2mb`** (`next.config.ts:19`). No upload passes through an action body; the start and finish actions carry only metadata.

## Assumptions (not verified by reading; each has a named check)

- **A1** A browser `PUT` to the URL `createSignedUploadUrl` returns, with headers `content-type`, `x-upsert: false` and `cache-control: max-age=3600` and the raw file as the body, stores the object with no `apikey` or `Authorization` header (the token in the URL authorises it). Read: `uploadToSignedUrl` sends exactly those headers for a non-Blob body (`node_modules/.pnpm/@supabase+storage-js@2.110.8/…/dist/index.mjs:756-789`), plus the client's own default headers, which the browser does not have. Check: the e2e upload (Task 14) on the CI stack and on bis-ci.
- **A2** Supabase Storage answers that cross-origin PUT with permissive CORS. Check: Task 14.
- **A3** Storage refuses an upload whose `content-type` is outside the bucket's `allowed_mime_types` or larger than `file_size_limit`, and a download answers with the content type the upload declared (the Blob's `type`). The finish step relies on the second half: it refuses an object whose stored type is not the version's declared type (Task 5); Task 14 proves it end to end. The first half is a second line of defence only (the finish step checks the real bytes and size), so a wrong assumption costs nothing but a second line of defence.
- **A4** `storage.from(b).remove([paths])` answers with no error for a path that does not exist. The sweep and the failure path treat an error as "try again next run", so a wrong assumption only delays a purge.
- **A5** A signed URL for a PDF renders in an `<iframe>` (Storage sends no `X-Frame-Options: DENY`) and serves `Content-Type: application/pdf` inline when no `download` option is given. Check: Task 14 asserts the frame's `src` is set; the orchestrator opens one by hand on Preview.
- **A6** `createImageBitmap(file, { imageOrientation: "from-image" })` applies EXIF orientation, and `canvas.toBlob` output carries no EXIF APP1 segment, in Chromium (Playwright), Safari and Chrome on Android. Task 14 proves the Chromium half (the stored object has no `Exif\0\0`); Safari is a manual check on Preview, named in the PR body.
- **A7** On Safari, `canvas.toBlob(…, "image/webp")` returns a PNG. Handled, not assumed away: the upload declares `blob.type`, whatever the browser produced (Task 9).
- **A8** A phone camera's file input hands over a JPEG (iOS converts on capture). A HEIC that arrives anyway is refused with the "kind of file" message (spec §3.1).
- **A9** PostgREST v14 embeds through a composite foreign key named with `!constraint` (Task 3's `version:document_versions!documents_current_version_fkey(...)` and `versions:document_versions!document_versions_document_fkey(...)`). Check: Task 3's `documents.test.ts` on the replica's PostgREST and CI `verify`; the fallback is named in Task 3.
- **A11** A backend-created Clerk user with a password signs in on the development instance without an email code (Task 15 step 7). Fallback named there.
- **A12** Clerk's sign-in page accepts `?__clerk_ticket=<token>` (Task 15 step 7's fallback only).
- **A10** `db push` (CI's in-runner stack) runs migrations as the same role the bootstrap's `psql "$db_url"` uses, so 0077's `insert into storage.buckets` succeeds there (spec finding F1). Check: CI `verify`.

## File Structure

**Created**

| Path | Owner | Responsibility |
|---|---|---|
| `packages/db/supabase/migrations/0077_document_vault.sql` | bis-db-schema | bucket, two tables, RLS, grants, the current-is-ready trigger, `reserve_document_version` |
| `packages/db/src/document-rules.ts` | bis-db-schema | the constants SQL and app share: quota, per-file limit, types, categories, trash days |
| `packages/db/src/test/document-vault-schema.test.ts` | bis-db-schema | checks, bucket, grants, function ACL, quota maths, constants parity |
| `packages/db/src/test/document-vault-rls.test.ts` | bis-db-schema | the visibility matrix on both tables |
| `packages/db/src/test/document-vault-reserve-lock.test.ts` | bis-db-schema | two reservations serialise on the account row |
| `packages/db/src/documents.ts` (+ `test/documents.test.ts`) | bis-crm | reads (RLS client) and service writes, events, sweep queries, the timeline read |
| `apps/web/src/lib/documents/rules.ts` (+ test) | bis-crm | file name → type, title from file name, default category, size words |
| `apps/web/src/lib/documents/content-check.ts` (+ test) | bis-crm | the leading-bytes check (§5.2) |
| `apps/web/src/lib/documents/expiry.ts` (+ test) | bis-crm | expiry and purge words, the "soon" band |
| `apps/web/src/lib/documents/documents-load.ts` (+ test) | bis-crm | the card route's response type and its parser |
| `…/accounts/contacts/documents-actions.ts` (+ test) | bis-crm | start, finish, abandon, URL, edit, undo, Owners only, trash, restore |
| `…/api/contacts/[contactId]/documents/route.ts` (+ test) | bis-crm | the card's read for a contact |
| `…/api/groups/[groupId]/documents/route.ts` (+ test) | bis-crm | the card's read for a group |
| `apps/web/src/lib/documents/document-view.ts` | bis-crm | the row mapper both routes share (a route file may export only handlers) |
| `apps/web/src/lib/documents/strip-image.ts` (+ test) | bis-frontend | canvas re-encode, orientation, 4096 px cap |
| `apps/web/src/lib/documents/upload-client.ts` (+ test) | bis-frontend | one file's journey: prepare, start, PUT with progress, finish |
| `…/accounts/contacts/document-upload-panel.tsx` (+ test) | bis-frontend | the inline batch panel |
| `…/accounts/contacts/document-viewer.tsx` (+ test) | bis-frontend | the dialog |
| `…/accounts/contacts/documents-card.tsx`, `documents-card-handlers.ts` (+ tests) | bis-frontend | the card, its rows, menu, trash list, toasts |
| `apps/web/src/app/(dashboard)/dashboard/styleguide/documents-demo.tsx` (+ test) | bis-frontend | the card in every state, both languages |
| `apps/web/src/lib/automations/passes/documents-sweep.ts` (+ test) | bis-automations | the clean-up pass, every tick |
| `apps/web/e2e/documents.spec.ts` | bis-e2e-qa | upload, view, rename + Undo, Owners only, trash + Undo, restore |

**Modified:** `packages/db/src/{account-teardown,contacts,record,index}.ts`; `packages/db/src/test/{places,contacts,record,timeline-sources}.test.ts`; `apps/web/src/lib/messages.ts`; `apps/web/src/lib/record/{record-cards,timeline-rows,author-mark,recent-rows,group-loaders}.ts` (+ tests); `…/accounts/contacts/[contactId]/{page,activity-timeline}.tsx` (+ tests); `…/accounts/groups/[groupId]/{page,group-timeline}.tsx`, `loading.test.ts`, `page.test.ts`; `…/accounts/in-account-service-reads.test.ts`; `apps/web/src/lib/automations/{registry.ts,cron-coupling.test.ts,sentinel.test.ts}`; `apps/web/src/lib/messages.test.ts`; `packages/db/package.json`; `apps/web/src/app/(dashboard)/dashboard/styleguide/page.tsx`; `apps/web/e2e/{fixtures/sweep.ts,fixtures/sweep.test.ts,auth.teardown.ts,record-page.spec.ts,group-page.spec.ts}`; `apps/web/src/lib/i18n/{catalogue,ratchet}-baseline.json`.

## Task list, owners, order

| # | Task | Owner | Review | Depends on | Files (disjoint per wave) |
|---|---|---|---|---|---|
| 0 | Confirm the base | orchestrator | n/a | — | none |
| 1 | Migration 0077, `document-rules.ts`, `ACCOUNT_OWNED_TABLES`, and their proof on the replica | bis-db-schema | **opus** | 0 | the migration, `document-rules.ts`, three new tests, `account-teardown.ts`, `places.test.ts` |
| 2 | Every key (**messages.ts, the only writer**) | bis-crm | sonnet | 0 | `lib/messages.ts` |
| 3 | `@bis/db` `documents.ts`, `deleteContacts`' purge hook, the barrel, the `./document-rules` subpath | bis-crm | **opus** | 1 | `packages/db/src/{documents,contacts,index}.ts`, `packages/db/package.json`, `test/{documents,contacts}.test.ts` |
| 4 | Pure web rules: file rules, the content check, expiry words, the load parser | bis-crm | sonnet | 2, 3 | `lib/documents/{rules,content-check,expiry,documents-load}*` |
| 5 | The server actions | bis-crm | **opus** | 3, 4 | `…/contacts/documents-actions*`, `in-account-service-reads.test.ts` |
| 6 | The two read routes | bis-crm | sonnet | 3, 4 | `…/api/{contacts,groups}/…/documents/route*`, `lib/documents/document-view.ts` |
| 7 | `strip-image.ts` and `upload-client.ts` | bis-frontend | **opus** | 4, 5 | `lib/documents/{strip-image,upload-client}*` |
| 8 | The timeline's `documents` source | bis-crm | **opus** | 2, 3 | `packages/db/src/record.ts`, `test/{record,timeline-sources}.test.ts`, `lib/record/{timeline-rows,author-mark,recent-rows,group-loaders}*`, `[contactId]/activity-timeline*`, `groups/[groupId]/group-timeline*`, `groups/[groupId]/page.tsx:104` |
| 9 | Upload panel and viewer | bis-frontend | sonnet | 2, 4, 5, 7 | `…/contacts/{document-upload-panel,document-viewer}*` |
| 10 | The Documents card, its handlers, `/styleguide` | bis-frontend | **opus** | 6, 9 | `…/contacts/{documents-card,documents-card-handlers}*`, `styleguide/{documents-demo*,page.tsx}` |
| 11 | The card on both record pages | bis-crm | sonnet | 8, 10 | `lib/record/record-cards*`, `[contactId]/page*`, `groups/[groupId]/{page*,loading.test.ts}` |
| 12 | The sweep pass (every tick) | bis-automations | sonnet | 3 | `passes/documents-sweep*`, `registry.ts`, `cron-coupling.test.ts`, `sentinel.test.ts` |
| 13 | Regenerate the i18n baselines | bis-crm | sonnet | 2, 7–12, 17 | `lib/i18n/*-baseline.json` |
| 17 | Deleting a customer deletes their files (owner ruling) | bis-crm | **opus** | 2, 3, 5 | `…/contacts/{actions,bulk-action-bar}*`, one comment in `in-account-service-reads.test.ts` |
| 14 | The e2e sweep's documents leg, and the spec | bis-e2e-qa | sonnet | 11, 13, 17 | `e2e/{fixtures/sweep*,auth.teardown.ts,documents.spec.ts,record-page.spec.ts,group-page.spec.ts}` |
| 16 | Whole-branch final review (checkpoint) | reviewer | **opus** | 1–14, 17 | none |
| 15 | Rollout (orchestrator; LAST) | orchestrator | n/a | 16 | none in the repo |

(Task 15 is listed before 16 by number only; it runs LAST, after Task 16.)

**Dependency graph (lanes on disjoint files, 2–3 at a time).**

```
Wave A (two lanes):    T1 (bis-db-schema)          T2 (bis-crm)
Wave B:                T3 (bis-crm, after T1)
Wave C (three lanes):  T4 (bis-crm, after T2+T3)   T8 (bis-crm, 2nd instance, after T2+T3)   T12 (bis-automations, after T3)
Wave D (two lanes):    T5 (bis-crm, after T4)      T6 (bis-crm, 2nd instance, after T4)
Wave E (two lanes):    T7 (bis-frontend, after T4+T5)   T17 (bis-crm, after T2+T3+T5)
Wave F:                T9 (bis-frontend, after T7)
Wave G:                T10 (bis-frontend, after T6+T9)
Wave H:                T11 (bis-crm, after T8+T10)
Wave I:                T13 (after T2, T7–T12, T17)
Wave J:                T14 (after T11+T13+T17)
Checkpoint:            T16
Rollout:               T15 (orchestrator, LAST)
```

Disjointness: T5 and T6 share no file (actions vs routes + `document-view.ts`). T4, T8 and T12 share no file (`lib/documents/*` vs `record.ts` + `lib/record/*` + the two timelines + one argument in the group `page.tsx` vs automations files). T8 edits `groups/[groupId]/page.tsx:104` only (the group id into `loadGroupTimeline`); T11 adds the card slot to the same file after T8 committed (the shared-files order).

---

## Task 0: Confirm the base (orchestrator)

- [ ] **Step 1.** In `<WT>`: `git log --oneline -2` → `<plan commit>`, `809b31a7 docs(spec): the document vault part 1, the staff vault …`. `git fetch origin && git log --oneline origin/main -1`; if `main` moved past `dc3e4ab6`, `git merge origin/main` (never rebase in the shared tree) and re-run Step 2.
- [ ] **Step 1b.** `pnpm install --frozen-lockfile` in `<WT>` (the worktree has no `node_modules`; the command CI runs, `.github/workflows/ci.yml:193`).
- [ ] **Step 2.** Confirm, and stop if any line differs:
  - `ls packages/db/supabase/migrations | tail -1` → `0076_customer_language.sql`.
  - `git log --all --oneline -- 'packages/db/supabase/migrations/0077*'` → nothing (if another branch holds a 0077, this plan's number becomes the next free one and every `0077` below is renamed in the same commit).
  - `grep -n '"custom_values", "tags", "equipment", "places"' packages/db/src/account-teardown.ts` → `26:`.
  - `grep -n 'for (const table of \["opportunities", "conversations", "bookings"\] as const)' packages/db/src/contacts.ts` → `1024:`.
  - `grep -n '"places.title.es"' apps/web/src/lib/messages.ts` → `3804:`.
  - `grep -n 'export const PASSES' apps/web/src/lib/automations/registry.ts` → `54:`.
  - `grep -c "documents" packages/db/src/record.ts` → `0`.

---

## Task 1: Migration 0077 and its proof on the replica (bis-db-schema)

**Review:** opus. **Runs beside:** Task 2. **Scratch:** `<SCRATCH>/s07-t1-impl/`, replica port `55520` (reviewer `s07-t1-review/`, `55521`).

**Files**
- Create: `packages/db/supabase/migrations/0077_document_vault.sql`
- Create: `packages/db/src/document-rules.ts`
- Create: `packages/db/src/test/document-vault-schema.test.ts`
- Create: `packages/db/src/test/document-vault-rls.test.ts`
- Create: `packages/db/src/test/document-vault-reserve-lock.test.ts`
- Modify: `packages/db/src/account-teardown.ts:26` (one entry) and `:106-113` (the stored objects first, Step 11b)
- Create: `packages/db/src/__tests__/account-teardown-storage.test.ts`
- Modify: `packages/db/src/test/places.test.ts:144-149` (one ordering line)

**Interfaces**
- Consumes (SQL): `app.is_agency()` (`0001:9-12`), `app.current_account_id()` (`0008:13-18`), `app.sees_all_customers(uuid)`, `app.my_contact_ids()` (`0068:75-88`), `app.my_client_group_ids()` (`0069:94-98`), `app.is_account_owner(uuid)` (`0066:62-66`), `app.tidy_text(text, int)` (`0071:29-33`), the composite keys `contacts_account_id_id_key` (`0050:94`), `client_groups_account_id_id_key` (`0069:56`), `places_account_id_id_key` (`0071:59`).
- Produces (SQL), every later task relies on these exact names:
  - bucket `documents`: `public = false`, `file_size_limit = 26214400`, `allowed_mime_types = {application/pdf,image/jpeg,image/png,image/webp,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet}` in that order.
  - `public.documents` columns `id, account_id, contact_id, client_group_id, place_id, opportunity_id, title, category, expires_on, owners_only, client_visible, source, scan_status, current_version_id, created_by, created_at, updated_at, deleted_at, deleted_by`; constraints `documents_title_check`, `documents_category_check`, `documents_source_check`, `documents_scan_status_check`, `documents_created_by_check`, `documents_one_record`, `documents_trash_coherent`, `documents_contact_fkey`, `documents_group_fkey`, `documents_place_fkey`, `documents_account_id_id_key`, `documents_current_version_fkey`.
  - `public.document_versions` columns `id, document_id, account_id, storage_path, bytes, content_type, sha256, original_name, uploaded_by, status, created_at`; constraints `document_versions_storage_path_key`, `document_versions_bytes_check`, `document_versions_content_type_check`, `document_versions_sha256_check`, `document_versions_original_name_check`, `document_versions_uploaded_by_check`, `document_versions_status_check`, `document_versions_document_fkey`, `document_versions_path_shape`, `document_versions_ready_hashed`, `document_versions_document_id_id_key`.
  - `public.reserve_document_version(p_account_id uuid, p_document_id uuid, p_bytes bigint, p_content_type text, p_original_name text, p_uploaded_by text) returns jsonb`: `{status:'ok', version_id, storage_path, used}` | `{status:'over_quota', used}` | `{status:'too_large'}` | `{status:'not_found'}`; raises `22004` on a NULL required argument; execute to `service_role` only.
  - `app.documents_current_is_ready()`; trigger `documents_current_is_ready`.
  - `public.mark_document_version_ready(p_account_id uuid, p_document_id uuid, p_version_id uuid, p_bytes bigint, p_sha256 text) returns jsonb`: `{status:'ok', first}` | `{status:'not_found'}`; one transaction moves the version to ready AND the document's pointer to it; raises `22004` on a NULL argument; execute to `service_role` only.
- Produces (TS), `packages/db/src/document-rules.ts`:

```ts
export const DOCUMENT_QUOTA_BYTES: number;            // 5_368_709_120
export const DOCUMENT_MAX_BYTES: number;              // 26_214_400
export const DOCUMENT_CONTENT_TYPES: readonly [ "application/pdf", "image/jpeg", "image/png", "image/webp", DOCX, XLSX ];
export type DocumentContentType = (typeof DOCUMENT_CONTENT_TYPES)[number];
export const DOCUMENT_CATEGORIES: readonly ["id","contract","estimate","invoice","photo","permit","insurance","warranty","other"];
export type DocumentCategory = (typeof DOCUMENT_CATEGORIES)[number];
export const DOCUMENT_SOURCES: readonly ["upload", "camera"];
export type DocumentSource = (typeof DOCUMENT_SOURCES)[number];
export const DOCUMENT_TITLE_MAX: number;              // 200
export const DOCUMENT_TRASH_DAYS: number;             // 30
export const DOCUMENT_BUCKET: "documents";
export const isDocumentCategory: (v: unknown) => v is DocumentCategory;
export const isDocumentContentType: (v: unknown) => v is DocumentContentType;
```

- [ ] **Step 1: Build your replica** (memory "Local DB replica"; the storage stub is new: the replica has no `storage` schema, and 0077 inserts into `storage.buckets`). Write the env file:

```bash
mkdir -p "<SCRATCH>/s07-t1-impl"
cat > "<SCRATCH>/s07-t1-impl/env.sh" <<'EOF'
S="<SCRATCH>/s07-t1-impl"
PGBIN="/c/Program Files/PostgreSQL/18/bin"
P() { "$PGBIN/psql" -h localhost -p 55520 -U postgres -v ON_ERROR_STOP=1 -q "$@"; }
EOF
```

Then from `<WT>` in Git Bash:

```bash
source "<SCRATCH>/s07-t1-impl/env.sh"
"$PGBIN/initdb" -U postgres -A trust -E UTF8 --locale=C --locale-provider=icu --icu-locale=en-US -D "$S/pgdata" > "$S/initdb.log" 2>&1
"$PGBIN/pg_ctl" -D "$S/pgdata" -o "-p 55520" -l "$S/pg.log" start </dev/null >/dev/null 2>&1
P -c "create role anon nologin noinherit; create role authenticated nologin noinherit; create role service_role nologin noinherit bypassrls; grant anon, authenticated, service_role to postgres;"
P -c "create database pre"
P -d pre -c "alter database pre set timezone to 'UTC'"
P -d pre -c "create schema if not exists app; create schema if not exists extensions;"
sed -n '58,63p;72,73p' packages/db/supabase/bootstrap/ci-project.sql | P -d pre
# The storage stub: only the two relations 0077 and its tests touch. NOT the real storage schema;
# the bucket and storage.objects cases are proven for real by CI verify's in-runner stack.
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
  case "$f" in *0077_*) continue;; esac
  P -d pre -1 -f "$f" || { echo "FAILED at $f"; break; }
done
P -c "create database post template pre"
P -d post -c "alter database post set timezone to 'UTC'"
```

Expected: no `FAILED at` line. Faithfulness: the client-write-surface digest on `pre` equals bis-ci's, read-only on bis-ci with `pnpm --filter @bis/db ci:sql` (the query is PR 1's, `2026-10-13-customer-language-pr1.md` Task 1 Step 1):

```sql
select count(*) || '|' || md5(string_agg(x, ',' order by x)) from (
  select r || ' ' || c.relname || ' ' || p as x
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  cross join (values ('anon'), ('authenticated')) v(r)
  cross join (values ('INSERT'), ('UPDATE'), ('DELETE')) w(p)
  where n.nspname = 'public' and c.relkind = 'r' and has_table_privilege(r, c.oid, p)) s;
```

Paste both values; stop if they differ.

- [ ] **Step 2: Write `packages/db/src/document-rules.ts`** (the module the app reads and the schema test pins against the SQL):

```ts
/**
 * The document vault's fixed rules (spec V4, V5, section 3), in ONE module: the app reads them, and
 * test/document-vault-schema.test.ts pins each against 0077's SQL, so a number changed on one side
 * fails by name. Pure: no client, no I/O, safe in the browser.
 */
export const DOCUMENT_BUCKET = "documents" as const;
/** 5 GiB per account, trashed files included until purged (V4). 0077's reserve_document_version holds the same literal. */
export const DOCUMENT_QUOTA_BYTES = 5_368_709_120;
/** 25 MiB per file (V4). The bucket's file_size_limit and document_versions_bytes_check hold the same literal. */
export const DOCUMENT_MAX_BYTES = 26_214_400;
/** The bucket's allowed_mime_types, IN THIS ORDER (the parity fingerprint compares the array as text). */
export const DOCUMENT_CONTENT_TYPES = [
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
] as const;
export type DocumentContentType = (typeof DOCUMENT_CONTENT_TYPES)[number];
/** Stored as keys; the words live in messages.ts as documents.category.<key> (V5). */
export const DOCUMENT_CATEGORIES = ["id", "contract", "estimate", "invoice", "photo", "permit", "insurance", "warranty", "other"] as const;
export type DocumentCategory = (typeof DOCUMENT_CATEGORIES)[number];
/** Part 1's two sources; parts 2+ widen the CHECK and this list together. */
export const DOCUMENT_SOURCES = ["upload", "camera"] as const;
export type DocumentSource = (typeof DOCUMENT_SOURCES)[number];
export const DOCUMENT_TITLE_MAX = 200;
/** A trashed file is purged this many days after it was trashed (spec section 5.4). */
export const DOCUMENT_TRASH_DAYS = 30;

export const isDocumentCategory = (v: unknown): v is DocumentCategory =>
  typeof v === "string" && (DOCUMENT_CATEGORIES as readonly string[]).includes(v);
export const isDocumentContentType = (v: unknown): v is DocumentContentType =>
  typeof v === "string" && (DOCUMENT_CONTENT_TYPES as readonly string[]).includes(v);
```

- [ ] **Step 3: Write the failing schema test** `packages/db/src/test/document-vault-schema.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import type { Client } from "pg";
import { withRollback, actAs, actAsMember } from "./db";
import {
  DOCUMENT_QUOTA_BYTES, DOCUMENT_MAX_BYTES, DOCUMENT_CONTENT_TYPES, DOCUMENT_CATEGORIES, DOCUMENT_SOURCES,
} from "../document-rules";

/**
 * 0077, the document vault's schema (spec section 3). As the table owner inside a rolled-back
 * transaction unless a case switches role. A refused statement runs under a savepoint (`attempt`), so
 * one refusal does not abort the rest of the case (25P02).
 */
const RUN = Math.random().toString(36).slice(2, 10);
const ORG = `org_dv_${RUN}`;
const RESERVE = "public.reserve_document_version(uuid,uuid,bigint,text,text,text)";

async function attempt(c: Client, sql: string, args: unknown[] = []) {
  await c.query("savepoint attempt");
  try { const r = await c.query(sql, args); await c.query("release savepoint attempt"); return r; }
  catch (e) { await c.query("rollback to savepoint attempt"); throw e; }
}

async function seed(c: Client) {
  const one = async (sql: string, args: unknown[]) => (await c.query<{ id: string }>(sql, args)).rows[0]!.id;
  const { rows: [agency] } = await c.query<{ id: string }>("select id from agencies limit 1");
  const acct = await one("insert into accounts (agency_id, clerk_org_id, name, client_access_enabled) values ($1,$2,'DV Co',true) returning id", [agency!.id, ORG]);
  const other = await one("insert into accounts (agency_id, clerk_org_id, name, client_access_enabled) values ($1,$2,'DV B',true) returning id", [agency!.id, `${ORG}_b`]);
  const ana = await one("insert into contacts (account_id, first_name) values ($1,'Ana') returning id", [acct]);
  const bea = await one("insert into contacts (account_id, first_name) values ($1,'Bea') returning id", [other]);
  const casa = await one("insert into client_groups (account_id, kind, name) values ($1,'household','Casa') returning id", [acct]);
  return { acct, other, ana, bea, casa };
}

const doc = (c: Client, acct: string, over: Record<string, unknown> = {}) => {
  const row = { contact_id: null, client_group_id: null, title: "Contract", category: "contract", source: "upload",
    scan_status: "skipped", created_by: "user_dv", ...over };
  return attempt(c, `insert into documents (account_id, contact_id, client_group_id, title, category, source, scan_status, created_by)
    values ($1,$2,$3,$4,$5,$6,$7,$8) returning id`,
    [acct, row.contact_id, row.client_group_id, row.title, row.category, row.source, row.scan_status, row.created_by])
    .then((r) => (r.rows[0] as { id: string }).id);
};

const reserve = async (c: Client, a: unknown[]) =>
  (await attempt(c, `select public.reserve_document_version($1::uuid,$2::uuid,$3::bigint,$4::text,$5::text,$6::text) as r`, a)).rows[0]!.r as
    { status: string; version_id?: string; storage_path?: string; used?: number };

describe("the documents bucket (spec section 3.1)", () => {
  it("exists, private, 25 MiB, exactly the six types in document-rules' order (mutation: public = true in 0077 -> FAILS)", () => withRollback(async (c) => {
    const { rows } = await c.query<{ public: boolean; file_size_limit: string; allowed_mime_types: string[] }>(
      "select public, file_size_limit, allowed_mime_types from storage.buckets where id = 'documents'");
    expect(rows).toHaveLength(1);
    expect(rows[0]!.public).toBe(false);
    expect(Number(rows[0]!.file_size_limit)).toBe(DOCUMENT_MAX_BYTES);
    expect(rows[0]!.allowed_mime_types).toEqual([...DOCUMENT_CONTENT_TYPES]);
  }));

  it("no storage.objects policy names the documents bucket: only the service role reaches its objects (mutation: add a select policy for authenticated naming 'documents' -> FAILS)", () =>
    withRollback(async (c) => {
      const { rows } = await c.query<{ policyname: string }>(
        `select policyname from pg_policies where schemaname = 'storage' and tablename = 'objects'
           and (coalesce(qual, '') || coalesce(with_check, '')) like '%documents%'`);
      expect(rows).toEqual([]);
    }));
});

describe("documents and document_versions: checks (spec sections 3.2, 3.3)", () => {
  it("exactly one record (mutation: drop documents_one_record -> FAILS)", () => withRollback(async (c) => {
    const s = await seed(c);
    await expect(doc(c, s.acct)).rejects.toMatchObject({ code: "23514", constraint: "documents_one_record" });
    await expect(doc(c, s.acct, { contact_id: s.ana, client_group_id: s.casa }))
      .rejects.toMatchObject({ code: "23514", constraint: "documents_one_record" });
    expect(await doc(c, s.acct, { contact_id: s.ana })).toMatch(/^[0-9a-f-]{36}$/);
    expect(await doc(c, s.acct, { client_group_id: s.casa })).toMatch(/^[0-9a-f-]{36}$/);
  }));

  it("a record from another account is refused by the same-account key (mutation: make documents_contact_fkey reference contacts(id) alone -> FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      await expect(doc(c, s.acct, { contact_id: s.bea })).rejects.toMatchObject({ code: "23503", constraint: "documents_contact_fkey" });
    }));

  it("the category, source and scan_status sets are closed and match document-rules (mutation: add 'receipt' to documents_category_check -> FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      for (const category of DOCUMENT_CATEGORIES) await doc(c, s.acct, { contact_id: s.ana, category });
      await expect(doc(c, s.acct, { contact_id: s.ana, category: "receipt" }))
        .rejects.toMatchObject({ code: "23514", constraint: "documents_category_check" });
      for (const source of DOCUMENT_SOURCES) await doc(c, s.acct, { contact_id: s.ana, source });
      await expect(doc(c, s.acct, { contact_id: s.ana, source: "customer" }))
        .rejects.toMatchObject({ code: "23514", constraint: "documents_source_check" });
      for (const scan of ["skipped", "pending", "clean", "infected"]) await doc(c, s.acct, { contact_id: s.ana, scan_status: scan });
      await expect(doc(c, s.acct, { contact_id: s.ana, scan_status: "unknown" }))
        .rejects.toMatchObject({ code: "23514", constraint: "documents_scan_status_check" });
      const { rows } = await c.query<{ d: string }>(
        "select pg_get_constraintdef(oid) as d from pg_constraint where conname = 'documents_category_check'");
      for (const k of DOCUMENT_CATEGORIES) expect(rows[0]!.d).toContain(`'${k}'`);
    }));

  it("a title is 1 to 200 characters with no edge space; a blank creator is refused (mutation: drop documents_title_check -> FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      for (const title of ["", " Contract", "x".repeat(201)]) {
        await expect(doc(c, s.acct, { contact_id: s.ana, title })).rejects.toMatchObject({ code: "23514", constraint: "documents_title_check" });
      }
      expect(await doc(c, s.acct, { contact_id: s.ana, title: "x".repeat(200) })).toBeTruthy();
      await expect(doc(c, s.acct, { contact_id: s.ana, created_by: " " }))
        .rejects.toMatchObject({ code: "23514", constraint: "documents_created_by_check" });
    }));

  it("trash is coherent: deleted_at and deleted_by together (mutation: drop documents_trash_coherent -> FAILS)", () => withRollback(async (c) => {
    const s = await seed(c);
    const id = await doc(c, s.acct, { contact_id: s.ana });
    await expect(attempt(c, "update documents set deleted_at = now() where id = $1", [id]))
      .rejects.toMatchObject({ code: "23514", constraint: "documents_trash_coherent" });
    await attempt(c, "update documents set deleted_at = now(), deleted_by = 'user_dv' where id = $1", [id]);
  }));

  it("a version's path is account/document/version and never a file name (mutation: drop document_versions_path_shape -> FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      const id = await doc(c, s.acct, { contact_id: s.ana });
      await expect(attempt(c, `insert into document_versions (document_id, account_id, storage_path, bytes, content_type, uploaded_by, status)
        values ($1,$2,$3,10,'application/pdf','user_dv','uploading')`, [id, s.acct, `${s.acct}/${id}/contract.pdf`]))
        .rejects.toMatchObject({ code: "23514", constraint: "document_versions_path_shape" });
    }));

  it("a ready version carries its hash; the type set is the bucket's (mutation: drop document_versions_ready_hashed -> FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      const id = await doc(c, s.acct, { contact_id: s.ana });
      const r = await reserve(c, [s.acct, id, 10, "application/pdf", "c.pdf", "user_dv"]);
      await expect(attempt(c, "update document_versions set status = 'ready' where id = $1", [r.version_id]))
        .rejects.toMatchObject({ code: "23514", constraint: "document_versions_ready_hashed" });
      await expect(attempt(c, "update document_versions set content_type = 'image/svg+xml' where id = $1", [r.version_id]))
        .rejects.toMatchObject({ code: "23514", constraint: "document_versions_content_type_check" });
    }));

  it("current_version_id names only a READY version of the SAME document (mutation: drop trigger documents_current_is_ready -> FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      const a = await doc(c, s.acct, { contact_id: s.ana });
      const b = await doc(c, s.acct, { contact_id: s.ana });
      const va = await reserve(c, [s.acct, a, 10, "application/pdf", "a.pdf", "user_dv"]);
      const vb = await reserve(c, [s.acct, b, 10, "application/pdf", "b.pdf", "user_dv"]);
      await expect(attempt(c, "update documents set current_version_id = $1 where id = $2", [va.version_id, a]))
        .rejects.toMatchObject({ code: "23514" });
      await c.query("update document_versions set status = 'ready', sha256 = repeat('a', 64) where id in ($1, $2)", [va.version_id, vb.version_id]);
      // Another document's ready version: the trigger fires before the composite FK and refuses it.
      await expect(attempt(c, "update documents set current_version_id = $1 where id = $2", [vb.version_id, a]))
        .rejects.toMatchObject({ code: "23514" });
      await attempt(c, "update documents set current_version_id = $1 where id = $2", [va.version_id, a]);
    }));

  it("deleting a document takes its versions with it (mutation: document_versions_document_fkey without on delete cascade -> FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      const id = await doc(c, s.acct, { contact_id: s.ana });
      await reserve(c, [s.acct, id, 10, "application/pdf", "c.pdf", "user_dv"]);
      await c.query("delete from documents where id = $1", [id]);
      expect((await c.query("select 1 from document_versions where document_id = $1", [id])).rowCount).toBe(0);
    }));

  it("a contact row cannot be deleted while a document row points at it (the backstop behind deviation 2's order; mutation: documents_contact_fkey on delete cascade -> FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      await doc(c, s.acct, { contact_id: s.ana });
      await expect(attempt(c, "delete from contacts where id = $1", [s.ana])).rejects.toMatchObject({ code: "23503", constraint: "documents_contact_fkey" });
    }));
});

describe("who may write (spec section 3.4, 0053)", () => {
  it("authenticated holds SELECT and nothing else on both tables; anon holds nothing (mutation: grant insert on documents to authenticated -> FAILS)", () =>
    withRollback(async (c) => {
      const { rows } = await c.query<{ k: string }>(
        `select r || ' ' || t || ' ' || p as k from (values ('anon'), ('authenticated')) v(r)
          cross join (values ('documents'), ('document_versions')) w(t)
          cross join (values ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE'), ('TRUNCATE'), ('REFERENCES'), ('TRIGGER'), ('MAINTAIN')) x(p)
         where has_table_privilege(r, 'public.' || t, p) order by 1`);
      expect(rows.map((r) => r.k)).toEqual(["authenticated document_versions SELECT", "authenticated documents SELECT"]);
    }));

  it("reserve_document_version is executable by service_role only, and is SECURITY DEFINER (mutation: grant execute to authenticated -> FAILS)", () =>
    withRollback(async (c) => {
      const { rows } = await c.query<{ r: string; ok: boolean }>(
        `select r, has_function_privilege(r, '${RESERVE}', 'EXECUTE') as ok
           from (values ('anon'), ('authenticated'), ('service_role')) v(r) order by 1`);
      expect(rows).toEqual([{ r: "anon", ok: false }, { r: "authenticated", ok: false }, { r: "service_role", ok: true }]);
      const { rows: [f] } = await c.query<{ prosecdef: boolean }>(`select prosecdef from pg_proc where oid = '${RESERVE}'::regprocedure`);
      expect(f!.prosecdef).toBe(true);
    }));

  it("a signed-in Owner cannot insert, even through the function (mutation: grant execute on reserve_document_version to authenticated -> FAILS on the second expect; grant insert AND add a permissive insert policy -> FAILS on the first)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      await actAsMember(c, s.acct, ORG, "owner");
      await expect(attempt(c, "insert into documents (account_id, contact_id, title, category, source, scan_status, created_by) values ($1,$2,'X','other','upload','skipped','me')", [s.acct, s.ana]))
        .rejects.toMatchObject({ code: "42501" });
      await expect(reserve(c, [s.acct, s.ana, 10, "application/pdf", "x.pdf", "me"])).rejects.toMatchObject({ code: "42501" });
    }));
});

describe("mark_document_version_ready: one transaction (plan review minor 4)", () => {
  const MARK = "public.mark_document_version_ready(uuid,uuid,uuid,bigint,text)";
  const mark = async (c: Client, a: unknown[]) =>
    (await attempt(c, "select public.mark_document_version_ready($1::uuid,$2::uuid,$3::uuid,$4::bigint,$5::text) as r", a)).rows[0]!.r as
      { status: string; first?: boolean };
  it("the version turns ready AND becomes current together; first is true once (mutation: drop the documents update -> FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      const id = await doc(c, s.acct, { contact_id: s.ana });
      const r = await reserve(c, [s.acct, id, 10, "application/pdf", "c.pdf", "user_dv"]);
      expect(await mark(c, [s.acct, id, r.version_id, 10, "a".repeat(64)])).toEqual({ status: "ok", first: true });
      const { rows } = await c.query("select d.current_version_id = v.id as current, v.status from documents d join document_versions v on v.document_id = d.id where d.id = $1", [id]);
      expect(rows).toEqual([{ current: true, status: "ready" }]);
      expect(await mark(c, [s.acct, id, r.version_id, 10, "a".repeat(64)])).toEqual({ status: "not_found" });
    }));
  it("another document's version, or another account, changes nothing (mutation: drop `and document_id = p_document_id` -> FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      const a = await doc(c, s.acct, { contact_id: s.ana });
      const b = await doc(c, s.acct, { contact_id: s.ana });
      const vb = await reserve(c, [s.acct, b, 10, "application/pdf", "b.pdf", "user_dv"]);
      expect(await mark(c, [s.acct, a, vb.version_id, 10, "a".repeat(64)])).toEqual({ status: "not_found" });
      expect(await mark(c, [s.other, b, vb.version_id, 10, "a".repeat(64)])).toEqual({ status: "not_found" });
      const { rows } = await c.query("select status from document_versions where id = $1", [vb.version_id]);
      expect(rows).toEqual([{ status: "uploading" }]);
    }));
  it("executable by service_role only; a NULL argument raises 22004 (mutation: grant execute to authenticated -> FAILS)", () =>
    withRollback(async (c) => {
      const { rows } = await c.query<{ r: string; ok: boolean }>(
        `select r, has_function_privilege(r, '${MARK}', 'EXECUTE') as ok from (values ('anon'), ('authenticated'), ('service_role')) v(r) order by 1`);
      expect(rows).toEqual([{ r: "anon", ok: false }, { r: "authenticated", ok: false }, { r: "service_role", ok: true }]);
      const s = await seed(c);
      await expect(mark(c, [s.acct, null, null, 1, "x"])).rejects.toMatchObject({ code: "22004" });
    }));
});

describe("reserve_document_version: the quota (spec section 3.5)", () => {
  it("the SQL literals equal document-rules (mutation: change 5368709120 in 0077 -> FAILS)", () => withRollback(async (c) => {
    const { rows: [f] } = await c.query<{ d: string }>(`select pg_get_functiondef('${RESERVE}'::regprocedure) as d`);
    expect(f!.d).toContain(String(DOCUMENT_QUOTA_BYTES));
    expect(f!.d).toContain(String(DOCUMENT_MAX_BYTES));
    const { rows: [k] } = await c.query<{ d: string }>(
      "select pg_get_constraintdef(oid) as d from pg_constraint where conname = 'document_versions_bytes_check'");
    expect(k!.d).toContain(String(DOCUMENT_MAX_BYTES));
  }));

  it("reserves an uploading version at account/document/version and answers its id (mutation: return storage_path without the version id -> FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      const id = await doc(c, s.acct, { contact_id: s.ana });
      const r = await reserve(c, [s.acct, id, 1000, "application/pdf", "c.pdf", "user_dv"]);
      expect(r.status).toBe("ok");
      expect(r.storage_path).toBe(`${s.acct}/${id}/${r.version_id}`);
      const { rows } = await c.query("select status, bytes from document_versions where id = $1", [r.version_id]);
      expect(rows).toEqual([{ status: "uploading", bytes: "1000" }]);
    }));

  it("counts ready AND uploading versions, trashed documents included, and refuses one byte past 5 GiB (mutation: sum only status = 'ready' -> FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      const trashed = await doc(c, s.acct, { contact_id: s.ana });
      const live = await doc(c, s.acct, { contact_id: s.ana });
      // Fill to exactly the quota minus 10 bytes, half in a trashed document's READY version, half still uploading.
      const half = Math.floor((DOCUMENT_QUOTA_BYTES - 10) / 2);
      const put = async (d: string, bytes: number, ready: boolean) => {
        const vid = (await c.query<{ id: string }>("select gen_random_uuid() as id")).rows[0]!.id;
        await c.query(`insert into document_versions (id, document_id, account_id, storage_path, bytes, content_type, uploaded_by, status, sha256)
          values ($1,$2,$3,$4,$5,'application/pdf','user_dv',$6,$7)`,
          [vid, d, s.acct, `${s.acct}/${d}/${vid}`, bytes, ready ? "ready" : "uploading", ready ? "a".repeat(64) : null]);
      };
      // document_versions_bytes_check caps one row at 25 MiB, so the fill is many rows; drop the cap for the fill only.
      await c.query("alter table document_versions drop constraint document_versions_bytes_check");
      await put(trashed, half, true);
      await put(live, DOCUMENT_QUOTA_BYTES - 10 - half, false);
      await c.query("update documents set deleted_at = now(), deleted_by = 'user_dv' where id = $1", [trashed]);
      expect((await reserve(c, [s.acct, live, 11, "application/pdf", "x.pdf", "user_dv"])).status).toBe("over_quota");
      expect((await reserve(c, [s.acct, live, 10, "application/pdf", "x.pdf", "user_dv"])).status).toBe("ok");
    }));

  it("another account's usage never counts (mutation: drop `where v.account_id = p_account_id` -> FAILS)", () => withRollback(async (c) => {
    const s = await seed(c);
    const theirs = await doc(c, s.other, { contact_id: s.bea });
    await c.query("alter table document_versions drop constraint document_versions_bytes_check");
    const vid = (await c.query<{ id: string }>("select gen_random_uuid() as id")).rows[0]!.id;
    await c.query(`insert into document_versions (id, document_id, account_id, storage_path, bytes, content_type, uploaded_by, status)
      values ($1,$2,$3,$4,$5,'application/pdf','user_dv','uploading')`, [vid, theirs, s.other, `${s.other}/${theirs}/${vid}`, DOCUMENT_QUOTA_BYTES]);
    const mine = await doc(c, s.acct, { contact_id: s.ana });
    expect((await reserve(c, [s.acct, mine, 1000, "application/pdf", "x.pdf", "user_dv"])).status).toBe("ok");
  }));

  it("over 25 MiB is too_large; a document of another account is not_found; a NULL argument raises 22004 (mutation: drop the null guard -> FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      const id = await doc(c, s.acct, { contact_id: s.ana });
      expect((await reserve(c, [s.acct, id, DOCUMENT_MAX_BYTES + 1, "application/pdf", "x.pdf", "user_dv"])).status).toBe("too_large");
      expect((await reserve(c, [s.other, id, 10, "application/pdf", "x.pdf", "user_dv"])).status).toBe("not_found");
      for (const i of [0, 1, 2, 3, 5]) {
        const args: unknown[] = [s.acct, id, 10, "application/pdf", "x.pdf", "user_dv"];
        args[i] = null;
        await expect(reserve(c, args)).rejects.toMatchObject({ code: "22004" });
      }
    }));
});
```

(The `actAs` import is used by Task 1's RLS file, not this one; drop it if eslint flags it.)

- [ ] **Step 4: Write the failing RLS matrix** `packages/db/src/test/document-vault-rls.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import type { Client } from "pg";
import { withRollback, actAs } from "./db";

/**
 * V3 (spec section 3.4): a document is visible to whoever sees its record (a Technician only through
 * a customer assigned to them, or that customer's household or business), and an Owners-only
 * document only to an Owner or the agency. Versions follow their document. Its own seed: one
 * account with an Owner, Staff, two Technicians, a member with no membership, a second account.
 */
const RUN = Math.random().toString(36).slice(2, 10);
const ORG = `org_dvr_${RUN}`;
const ORG_B = `org_dvrb_${RUN}`;
const SUB = {
  owner: `u_dv_owner_${RUN}`, staff: `u_dv_staff_${RUN}`, tech: `u_dv_tech_${RUN}`, tech2: `u_dv_tech2_${RUN}`,
  none: `u_dv_none_${RUN}`, ownerB: `u_dv_ownerb_${RUN}`,
} as const;
type Who = keyof typeof SUB | "agency";
const claims = (p: Who) =>
  p === "agency" ? { app_role: "agency_admin", sub: `u_dv_agency_${RUN}` } : { org_id: p === "ownerB" ? ORG_B : ORG, sub: SUB[p] };

async function seed(c: Client) {
  const one = async (sql: string, args: unknown[]) => (await c.query<{ id: string }>(sql, args)).rows[0]!.id;
  const { rows: [agency] } = await c.query<{ id: string }>("select id from agencies limit 1");
  const acct = await one("insert into accounts (agency_id, clerk_org_id, name, client_access_enabled) values ($1,$2,'DVR Co',true) returning id", [agency!.id, ORG]);
  const acctB = await one("insert into accounts (agency_id, clerk_org_id, name, client_access_enabled) values ($1,$2,'DVR B',true) returning id", [agency!.id, ORG_B]);
  const u = {} as Record<keyof typeof SUB, string>;
  for (const k of Object.keys(SUB) as (keyof typeof SUB)[]) u[k] = await one("insert into users (clerk_user_id, email) values ($1, $1 || '@example.com') returning id", [SUB[k]]);
  await c.query(
    `insert into memberships (user_id, scope, account_id, role) values
       ($1,'account',$6,'owner'), ($2,'account',$6,'staff'), ($3,'account',$6,'technician'), ($4,'account',$6,'technician'), ($5,'account',$7,'owner')`,
    [u.owner, u.staff, u.tech, u.tech2, u.ownerB, acct, acctB]);
  const ct = (who: string | null, name: string) => one("insert into contacts (account_id, first_name, assigned_to) values ($1,$2,$3) returning id", [acct, name, who]);
  const mine = await ct(u.tech, "Mine");
  const theirs = await ct(u.tech2, "Theirs");
  const g = (name: string) => one("insert into client_groups (account_id, kind, name) values ($1,'household',$2) returning id", [acct, name]);
  const casaMine = await g("Casa Mine");
  const casaTheirs = await g("Casa Theirs");
  await c.query("insert into client_group_members (account_id, client_group_id, contact_id, is_primary) values ($1,$2,$3,true), ($1,$4,$5,true)",
    [acct, casaMine, mine, casaTheirs, theirs]);
  const d = (owner: { contact_id?: string; client_group_id?: string }, ownersOnly: boolean, title: string) =>
    one(`insert into documents (account_id, contact_id, client_group_id, title, category, owners_only, source, scan_status, created_by)
         values ($1,$2,$3,$4,'other',$5,'upload','skipped','user_seed') returning id`,
      [acct, owner.contact_id ?? null, owner.client_group_id ?? null, title, ownersOnly]);
  const docs = {
    mine: await d({ contact_id: mine }, false, "mine"),
    mineOwners: await d({ contact_id: mine }, true, "mineOwners"),
    theirs: await d({ contact_id: theirs }, false, "theirs"),
    casaMine: await d({ client_group_id: casaMine }, false, "casaMine"),
    casaMineOwners: await d({ client_group_id: casaMine }, true, "casaMineOwners"),
    casaTheirs: await d({ client_group_id: casaTheirs }, false, "casaTheirs"),
  };
  // One uploading version per document (the reserve function as the owner; service_role bypasses RLS in the app).
  for (const id of Object.values(docs)) {
    await c.query("select public.reserve_document_version($1, $2, 10, 'application/pdf', 'x.pdf', 'user_seed')", [acct, id]);
  }
  return { acct, acctB, docs };
}

const titles = async (c: Client) =>
  (await c.query<{ title: string }>("select title from documents order by title")).rows.map((r) => r.title);
const versionDocs = async (c: Client) =>
  (await c.query<{ title: string }>(
    "select d.title from document_versions v join documents d on d.id = v.document_id order by 1")).rows.map((r) => r.title);

const ALL = ["casaMine", "casaMineOwners", "casaTheirs", "mine", "mineOwners", "theirs"];
const TEAM = ["casaMine", "casaTheirs", "mine", "theirs"];

describe("V3: who sees which document, on both tables", () => {
  const cases: [Who, string[], string][] = [
    ["owner", ALL, "drop policy documents_member_read"],
    ["agency", ALL, "is_account_owner without the is_agency branch"],
    ["staff", TEAM, "drop policy documents_owners_only"],
    ["tech", ["casaMine", "mine"], "drop policy documents_technician_scope"],
    ["tech2", ["casaTheirs", "theirs"], "drop policy documents_technician_scope"],
    ["none", [], "drop policy documents_technician_scope (the tenant policy alone admits a member-less login of the account)"],
    ["ownerB", [], "drop the account clause of documents_member_read"],
  ];
  it.each(cases)("%s sees exactly %j (mutation: %s -> FAILS)", (who, expected) => withRollback(async (c) => {
    await seed(c);
    await actAs(c, claims(who));
    expect(await titles(c)).toEqual(expected);
  }));
  it.each(cases)("%s reaches exactly the versions of %j (mutation: drop policy document_versions_through_document -> FAILS)", (who, expected) =>
    withRollback(async (c) => {
      await seed(c);
      await actAs(c, claims(who));
      // documents' own RLS also applies to the join, so read versions alone too: the version policy must hold by itself.
      expect(await versionDocs(c)).toEqual(expected);
      const { rows } = await c.query<{ n: string }>("select count(*)::text as n from document_versions");
      expect(Number(rows[0]!.n)).toBe(expected.length);
    }));
});
```

- [ ] **Step 5: Write the failing lock test** `packages/db/src/test/document-vault-reserve-lock.test.ts`. Two real connections; the seed is COMMITTED (the second session must see it) and deleted in `finally`:

```ts
import { describe, it, expect } from "vitest";
import { Client } from "pg";
import "dotenv/config";

/**
 * Spec section 3.5: "Two simultaneous uploads therefore cannot both slip under the limit." The
 * reservation locks the account row FOR NO KEY UPDATE (which conflicts with itself, and not with the FOR KEY SHARE a child insert takes) before it sums; a second session's reservation waits
 * for the first to end. Proven by holding session A's reservation open and asking session B to
 * reserve with a 300 ms lock timeout: B must fail with 55P03 (lock_not_available). Without the lock,
 * B would sum A's uncommitted row as absent and pass. Committed seed, deleted in finally.
 */
const URL = process.env.SUPABASE_DB_URL;
const RUN = Math.random().toString(36).slice(2, 10);
const conn = () => new Client({ connectionString: URL, connectionTimeoutMillis: 10_000 });

describe("reserve_document_version serialises on the account row", () => {
  it("a second reservation waits for the first (mutation: drop `for no key update` from the account lock -> FAILS)", async () => {
    const seedC = conn(); const a = conn(); const b = conn();
    await Promise.all([seedC.connect(), a.connect(), b.connect()]);
    let acct: string | null = null;
    try {
      const { rows: [agency] } = await seedC.query<{ id: string }>("select id from agencies limit 1");
      acct = (await seedC.query<{ id: string }>(
        "insert into accounts (agency_id, clerk_org_id, name) values ($1,$2,'DV Lock') returning id", [agency!.id, `org_dvlock_${RUN}`])).rows[0]!.id;
      const contact = (await seedC.query<{ id: string }>("insert into contacts (account_id, first_name) values ($1,'Lock') returning id", [acct])).rows[0]!.id;
      const doc = (await seedC.query<{ id: string }>(
        `insert into documents (account_id, contact_id, title, category, source, scan_status, created_by)
         values ($1,$2,'Lock','other','upload','skipped','user_lock') returning id`, [acct, contact])).rows[0]!.id;

      await a.query("begin");
      const ra = await a.query("select public.reserve_document_version($1,$2,10,'application/pdf','a.pdf','user_lock') as r", [acct, doc]);
      expect((ra.rows[0] as { r: { status: string } }).r.status).toBe("ok");

      await b.query("begin");
      await b.query("set local lock_timeout = '300ms'");
      await expect(b.query("select public.reserve_document_version($1,$2,10,'application/pdf','b.pdf','user_lock') as r", [acct, doc]))
        .rejects.toMatchObject({ code: "55P03" });
      await b.query("rollback");
      await a.query("rollback");
    } finally {
      await a.query("rollback").catch(() => {});
      await b.query("rollback").catch(() => {});
      if (acct) {
        await seedC.query("delete from documents where account_id = $1", [acct]);
        await seedC.query("delete from contacts where account_id = $1", [acct]);
        await seedC.query("delete from accounts where id = $1", [acct]);
      }
      await Promise.all([seedC.end(), a.end(), b.end()]);
    }
  });
});
```

- [ ] **Step 6: Run all three on `pre` and see them fail.** From `<WT>/packages/db`:

```bash
source "<SCRATCH>/s07-t1-impl/env.sh"
SUPABASE_DB_URL=postgresql://postgres@localhost:55520/pre pnpm exec vitest run src/test/document-vault-schema.test.ts src/test/document-vault-rls.test.ts src/test/document-vault-reserve-lock.test.ts > "$S/pre.log" 2>&1; echo $? > "$S/pre.exit"
```

Expected: every case FAILS (no bucket, no `documents` relation, no function). Paste the summary block.

- [ ] **Step 7: Write the migration** `packages/db/supabase/migrations/0077_document_vault.sql`:

```sql
-- 0077_document_vault.sql - the document vault, part 1: the staff vault
-- (docs/superpowers/specs/2026-10-13-document-vault-design.md section 3)
--
-- A document is filed on exactly one record: a contact or a client group in part 1 (place and
-- opportunity links exist and stay unused). Each upload is a document_versions row; the stored object
-- lives in the PRIVATE documents bucket at {account_id}/{document_id}/{version_id}, never a name the
-- uploader chose. Written by server code only (0053's pattern): the client role reads both tables
-- under the tenant policy, 0068's Technician fence and an Owners-only fence, and writes nothing.
-- No storage.objects policy is added for anon or authenticated: only the service role reaches the
-- objects, through URLs it mints after an RLS read. reserve_document_version holds the 5 GiB quota
-- under a lock on the account row. The record FKs are NO ACTION: the app removes a contact's objects and
-- document rows BEFORE the contact row (deleteContacts' purge hook), and the FK refuses any delete it did not clear.
--
-- APPLY ORDER: CI project (ci-project-setup.yml: push-dry-run, then push), then production (MCP
-- apply_migration, once), then the parity check (the fingerprint compares the bucket row), then merge.
-- Additive: the build before it reads neither table.
--
-- ROLLBACK (revert the app first; this drops every stored file's record, so only on an owner decision,
-- after the objects are exported or removed through the Storage API, which Postgres refuses to do):
--   drop table public.documents cascade;  -- takes document_versions' FK and the current-version FK
--   drop table public.document_versions;
--   drop function public.reserve_document_version(uuid, uuid, bigint, text, text, text);
--   drop function public.mark_document_version_ready(uuid, uuid, uuid, bigint, text);
--   drop function app.documents_current_is_ready();
--   delete from storage.buckets where id = 'documents';  -- only once the bucket is empty
--
-- ASCII only, no backslash anywhere.

set local lock_timeout = '5s';

-- 1. The bucket. Private; 25 MiB; the six types the finish step can recognise (spec 5.2), in the order
--    packages/db/src/document-rules.ts lists them (the parity fingerprint compares the array as text).
--    No HEIC: the browser cannot strip its location data. No SVG or HTML, ever.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('documents', 'documents', false, 26214400, array[
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet']);

-- 2. Tables.
create table public.documents (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  contact_id uuid,
  client_group_id uuid,
  place_id uuid,
  opportunity_id uuid references public.opportunities(id),
  title text not null constraint documents_title_check check (app.tidy_text(title, 200)),
  category text not null constraint documents_category_check
    check (category in ('id', 'contract', 'estimate', 'invoice', 'photo', 'permit', 'insurance', 'warranty', 'other')),
  expires_on date,
  owners_only boolean not null default false,
  client_visible boolean not null default false,
  source text not null constraint documents_source_check check (source in ('upload', 'camera')),
  scan_status text not null constraint documents_scan_status_check check (scan_status in ('skipped', 'pending', 'clean', 'infected')),
  current_version_id uuid,
  created_by text not null constraint documents_created_by_check check (btrim(created_by) <> ''),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  deleted_by text,
  constraint documents_one_record check (num_nonnulls(contact_id, client_group_id, place_id, opportunity_id) = 1),
  constraint documents_trash_coherent check ((deleted_at is null) = (deleted_by is null)),
  constraint documents_contact_fkey foreign key (account_id, contact_id) references public.contacts (account_id, id),
  constraint documents_group_fkey foreign key (account_id, client_group_id) references public.client_groups (account_id, id),
  constraint documents_place_fkey foreign key (account_id, place_id) references public.places (account_id, id),
  constraint documents_account_id_id_key unique (account_id, id)
);

create table public.document_versions (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null,
  account_id uuid not null references public.accounts(id) on delete cascade,
  storage_path text not null constraint document_versions_storage_path_key unique,
  bytes bigint not null constraint document_versions_bytes_check check (bytes between 1 and 26214400),
  content_type text not null constraint document_versions_content_type_check check (content_type in (
    'application/pdf', 'image/jpeg', 'image/png', 'image/webp',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')),
  sha256 text constraint document_versions_sha256_check check (sha256 is null or sha256 ~ '^[0-9a-f]{64}$'),
  original_name text constraint document_versions_original_name_check
    check (original_name is null or char_length(original_name) between 1 and 255),
  uploaded_by text not null constraint document_versions_uploaded_by_check check (btrim(uploaded_by) <> ''),
  status text not null constraint document_versions_status_check check (status in ('uploading', 'ready')),
  created_at timestamptz not null default now(),
  constraint document_versions_document_fkey foreign key (account_id, document_id)
    references public.documents (account_id, id) on delete cascade,
  constraint document_versions_path_shape
    check (storage_path = account_id::text || '/' || document_id::text || '/' || id::text),
  constraint document_versions_ready_hashed check (status = 'uploading' or sha256 is not null),
  constraint document_versions_document_id_id_key unique (document_id, id)
);

-- The current version is a version of THIS document (the composite key) and a ready one (section 4).
alter table public.documents add constraint documents_current_version_fkey
  foreign key (id, current_version_id) references public.document_versions (document_id, id);

create index documents_by_contact on public.documents (account_id, contact_id) where contact_id is not null;
create index documents_by_group on public.documents (account_id, client_group_id) where client_group_id is not null;
create index documents_trashed on public.documents (deleted_at) where deleted_at is not null;
create index document_versions_by_account on public.document_versions (account_id);
create index document_versions_uploading on public.document_versions (created_at) where status = 'uploading';

comment on table public.documents is
  'A file on a record (0077). Server-written only; authenticated reads under the record''s visibility and the Owners-only fence. Listed once current_version_id names a ready version; in the trash while deleted_at is set.';
comment on table public.document_versions is
  'One stored upload of a document (0077), at storage_path in the private documents bucket. uploading until the finish step checks its bytes; counted against the account quota in either status.';

-- 3. Grants: SELECT for the client role, nothing else (a new table gets Supabase's default ALL).
alter table public.documents enable row level security;
alter table public.document_versions enable row level security;
revoke all on public.documents, public.document_versions from anon, authenticated;
grant select on public.documents, public.document_versions to authenticated;
grant select, insert, update, delete on public.documents, public.document_versions to service_role;

-- 4. Who reads. The tenant policy (0069's shape), 0068's Technician fence (a customer assigned to them,
--    or that customer's household or business, as places_technician_scope), and Owners only. Every
--    helper coalesces (0066, 0068), so a NULL never opens a row.
create policy documents_member_read on public.documents for select to authenticated
  using (app.is_agency() or account_id = app.current_account_id());
create policy documents_technician_scope on public.documents as restrictive for select to authenticated
  using ((select app.sees_all_customers(app.current_account_id()))
         or contact_id in (select app.my_contact_ids())
         or client_group_id in (select app.my_client_group_ids()));
create policy documents_owners_only on public.documents as restrictive for select to authenticated
  using (not owners_only or (select app.is_account_owner(app.current_account_id())));
-- A version is visible exactly when its document is: the subquery runs under documents' own policies.
create policy document_versions_member_read on public.document_versions for select to authenticated
  using (app.is_agency() or account_id = app.current_account_id());
create policy document_versions_through_document on public.document_versions as restrictive for select to authenticated
  using (document_id in (select d.id from public.documents d));

-- 5. current_version_id names a READY version. Plain, not definer: it runs as the writer (service_role).
create function app.documents_current_is_ready() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.current_version_id is not null and not exists (
       select 1 from public.document_versions v
        where v.id = new.current_version_id and v.document_id = new.id and v.status = 'ready') then
    raise exception 'documents: the current version must be a ready version of this document' using errcode = '23514';
  end if;
  return new;
end $$;
create trigger documents_current_is_ready before insert or update of current_version_id on public.documents
  for each row execute function app.documents_current_is_ready();
revoke all on function app.documents_current_is_ready() from public, anon;
grant execute on function app.documents_current_is_ready() to authenticated, service_role;

-- 6. The quota (spec 3.5). Locks the account row (FOR NO KEY UPDATE: two reservations queue, child inserts do not), sums EVERY version of the account (ready and
--    uploading; trashed documents included until purged), refuses past 5 GiB, else inserts the
--    uploading row. The literals are document-rules.ts's DOCUMENT_QUOTA_BYTES and DOCUMENT_MAX_BYTES.
create function public.reserve_document_version(
  p_account_id uuid, p_document_id uuid, p_bytes bigint, p_content_type text, p_original_name text, p_uploaded_by text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_used bigint; v_id uuid := gen_random_uuid(); v_path text;
begin
  if p_account_id is null or p_document_id is null or p_bytes is null or p_content_type is null or p_uploaded_by is null then
    raise exception 'reserve_document_version: a required argument is null' using errcode = '22004';
  end if;
  if p_bytes < 1 or p_bytes > 26214400 then
    return jsonb_build_object('status', 'too_large');
  end if;
  perform 1 from public.accounts where id = p_account_id for no key update;
  if not found then return jsonb_build_object('status', 'not_found'); end if;
  perform 1 from public.documents where id = p_document_id and account_id = p_account_id;
  if not found then return jsonb_build_object('status', 'not_found'); end if;
  select coalesce(sum(v.bytes), 0) into v_used from public.document_versions v where v.account_id = p_account_id;
  if v_used + p_bytes > 5368709120 then
    return jsonb_build_object('status', 'over_quota', 'used', v_used);
  end if;
  v_path := p_account_id::text || '/' || p_document_id::text || '/' || v_id::text;
  insert into public.document_versions (id, document_id, account_id, storage_path, bytes, content_type, original_name, uploaded_by, status)
  values (v_id, p_document_id, p_account_id, v_path, p_bytes, p_content_type, p_original_name, p_uploaded_by, 'uploading');
  return jsonb_build_object('status', 'ok', 'version_id', v_id, 'storage_path', v_path, 'used', v_used + p_bytes);
end $$;
revoke all on function public.reserve_document_version(uuid, uuid, bigint, text, text, text) from public, anon, authenticated, service_role;
grant execute on function public.reserve_document_version(uuid, uuid, bigint, text, text, text) to service_role;

-- 7. A version becomes ready and current in ONE transaction (plan review minor 4): the version row and
--    the document's pointer move together or not at all, so a document is never left with a ready
--    version that nothing lists (which would count against the quota forever). Only an UPLOADING
--    version of THIS document qualifies; `first` tells the caller whether to emit document.added.
create function public.mark_document_version_ready(
  p_account_id uuid, p_document_id uuid, p_version_id uuid, p_bytes bigint, p_sha256 text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_prior uuid;
begin
  if p_account_id is null or p_document_id is null or p_version_id is null or p_bytes is null or p_sha256 is null then
    raise exception 'mark_document_version_ready: a required argument is null' using errcode = '22004';
  end if;
  select current_version_id into v_prior from public.documents
   where id = p_document_id and account_id = p_account_id for no key update;
  if not found then return jsonb_build_object('status', 'not_found'); end if;
  update public.document_versions set status = 'ready', bytes = p_bytes, sha256 = p_sha256
   where id = p_version_id and document_id = p_document_id and account_id = p_account_id and status = 'uploading';
  if not found then return jsonb_build_object('status', 'not_found'); end if;
  update public.documents set current_version_id = p_version_id, updated_at = now() where id = p_document_id;
  return jsonb_build_object('status', 'ok', 'first', v_prior is null);
end $$;
revoke all on function public.mark_document_version_ready(uuid, uuid, uuid, bigint, text) from public, anon, authenticated, service_role;
grant execute on function public.mark_document_version_ready(uuid, uuid, uuid, bigint, text) to service_role;
```

- [ ] **Step 8: ASCII and backslash check** (node, with a positive control):

```bash
cd "<WT>" && node -e '
const fs=require("fs");const f="packages/db/supabase/migrations/0077_document_vault.sql";
const b=fs.readFileSync(f);let bad=0;for(const x of b){if(x>127||x===92)bad++}
const ctl=Buffer.from("a\\b\u00e9");let c=0;for(const x of ctl){if(x>127||x===92)c++}
console.log(JSON.stringify({file:bad,control:c}))'
```

Expected: `{"file":0,"control":3}`.

- [ ] **Step 9: Apply to `post` and run green.**

```bash
source "<SCRATCH>/s07-t1-impl/env.sh"
P -d post -1 -f packages/db/supabase/migrations/0077_document_vault.sql
cd packages/db && SUPABASE_DB_URL=postgresql://postgres@localhost:55520/post pnpm exec vitest run src/test/document-vault-schema.test.ts src/test/document-vault-rls.test.ts src/test/document-vault-reserve-lock.test.ts > "$S/post.log" 2>&1; echo $? > "$S/post.exit"
```

Expected: all pass (the bucket/storage-policy cases pass against the stub; CI's real storage schema is their authority). Also run the neighbours that read every table: `src/test/schema-grants-guard.test.ts src/test/technician-scope.test.ts src/test/places-rls.test.ts` on `post` → all pass (the guard passes because `documents` grants no write).

- [ ] **Step 10: The mutation probes, each red BY NAME on `post`**, each reverted by re-running Step 9's apply on a fresh `create database post2 template pre`:
  1. `drop policy documents_owners_only on public.documents;` → the `staff` matrix case.
  2. `drop policy documents_technician_scope on public.documents;` → the `tech` and `tech2` cases.
  3. `drop policy document_versions_through_document on public.document_versions;` → the version cases for `staff` and `tech`.
  4. `create or replace` the reserve function with `where v.status = 'ready'` → "counts ready AND uploading".
  5. `create or replace` it without `for no key update` → the lock test.
  9. `create or replace` `mark_document_version_ready` without its `update public.documents` → "the version turns ready AND becomes current together".
  6. `grant insert on public.documents to authenticated;` → "authenticated holds SELECT and nothing else" AND `schema-grants-guard.test.ts` naming `authenticated documents`.
  7. `drop trigger documents_current_is_ready on public.documents;` → "current_version_id names only a READY version".
  8. `alter table public.documents drop constraint documents_contact_fkey, add constraint documents_contact_fkey foreign key (account_id, contact_id) references public.contacts (account_id, id) on delete cascade;` → "a contact with a document cannot be deleted".
- [ ] **Step 11: `ACCOUNT_OWNED_TABLES`.** In `packages/db/src/account-teardown.ts:26`, insert `"documents", ` immediately before `"equipment"`:

```ts
  "custom_values", "tags", "documents", "equipment", "places", "contact_relationships", "client_group_members", "client_groups", "contacts",
```

and add one paragraph at the end of the doc block (before its closing `*/` at `:89`):

```ts
 *
 * `documents` (0077) sits before `equipment`, `places`, `client_groups` and `contacts`: its record FKs are
 * NO ACTION toward all three (a file's record cannot vanish under it), and deleting it cascades its
 * `document_versions`. The ROWS only: the stored objects are not Postgres's to delete (the e2e sweep
 * removes the fixture account's; PR 1b gives this function its own storage leg).
```

In `packages/db/src/test/places.test.ts`, after line 148 (`expect(at("places")).toBeLessThan(at("contacts"));`) add:

```ts
    // 0077: documents' record FKs are NO ACTION toward places, groups and contacts.
    expect(at("documents")).toBeGreaterThanOrEqual(0);
    expect(at("documents")).toBeLessThan(at("equipment"));
```

Mutation: move `"documents"` after `"contacts"` → this case FAILS. (`places.test.ts` is a `withTestAccount` suite; it runs on the replica behind PostgREST or in CI `verify`, never against bis-ci before Task 15.)
- [ ] **Step 11b: The account's stored objects go first** (plan review I5: `dropDemoAccount`, `packages/db/src/demo/seed.ts:229`, runs `deleteAccountCascade` every Monday in production through `seed-demo.yml`, so 1a cannot leave objects behind). In `packages/db/src/account-teardown.ts`, `import { DOCUMENT_BUCKET } from "./document-rules";` and, at the top of `deleteAccountCascade` (`:106-113`, before the table loop):

```ts
  // 0077: the document vault's objects BEFORE any row, because the rows are the only map to them. Read from
  // document_versions (every status), paged; no storage call at all for an account that has none. A failed
  // removal throws like every other leg here, before a single row is gone, so a retry finds them again.
  const paths: string[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db.from("document_versions").select("storage_path")
      .eq("account_id", accountId).order("id").range(from, from + 999);
    if (error) throw new Error(`${caller} cleanup failed reading document paths: ${error.message}`);
    const page = (data ?? []) as { storage_path: string }[];
    paths.push(...page.map((r) => r.storage_path));
    if (page.length < 1000) break;
  }
  for (let i = 0; i < paths.length; i += 100) {
    const { error } = await db.storage.from(DOCUMENT_BUCKET).remove(paths.slice(i, i + 100));
    if (error) throw new Error(`${caller} cleanup failed removing document objects: ${error.message}`);
  }
```

and a pure test, `packages/db/src/__tests__/account-teardown-storage.test.ts` (no database; `__tests__` runs anywhere):

```ts
import { describe, it, expect } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { deleteAccountCascade } from "../account-teardown";

function fakeDb(paths: string[], removeError: string | null) {
  const log: string[] = [];
  const db = {
    from: (table: string) => ({
      select: () => ({ eq: () => ({ order: () => ({ range: async () => ({ data: table === "document_versions" ? paths.map((p) => ({ storage_path: p })) : [], error: null }) }) }) }),
      delete: () => ({ eq: async () => { log.push(`rows:${table}`); return { error: null }; } }),
    }),
    storage: { from: (b: string) => ({ remove: async (ps: string[]) => { log.push(`objects:${b}:${ps.join(",")}`); return { data: [], error: removeError ? { message: removeError } : null }; } }) },
  };
  return { db: db as unknown as SupabaseClient, log };
}

describe("deleteAccountCascade removes the document vault's objects before any row (plan review I5)", () => {
  it("objects first, then the rows (mutation: move the storage leg after the table loop -> FAILS)", async () => {
    const { db, log } = fakeDb(["a/d/v1", "a/d/v2"], null);
    await deleteAccountCascade(db, "a", "test", { keepBlueprints: true });
    expect(log[0]).toBe("objects:documents:a/d/v1,a/d/v2");
    expect(log.slice(1).every((l) => l.startsWith("rows:"))).toBe(true);
  });
  it("no paths, no storage call (mutation: always call remove -> FAILS)", async () => {
    const { db, log } = fakeDb([], null);
    await deleteAccountCascade(db, "a", "test", { keepBlueprints: true });
    expect(log.some((l) => l.startsWith("objects:"))).toBe(false);
  });
  it("a failed removal throws before any row is deleted (mutation: log and continue -> FAILS)", async () => {
    const { db, log } = fakeDb(["a/d/v1"], "storage down");
    await expect(deleteAccountCascade(db, "a", "test", { keepBlueprints: true })).rejects.toThrow(/document objects/);
    expect(log.some((l) => l.startsWith("rows:"))).toBe(false);
  });
});
```

(The fake's `.delete().eq()` is the chain every leg of `deleteAccountCascade` uses, `account-teardown.ts:110-124`.) **Replica note:** a `withTestAccount` suite that leaves `document_versions` rows now calls the Storage API at teardown; the replica has none, so the agent's local proxy (memory "Local DB replica", 2026-10-08) answers `DELETE /storage/v1/object/documents` with `200 []`. CI `verify` keeps the real `storage-api` (`ci-local-supabase.sh` keeps it out of `EXCLUDE`, script line 96).

- [ ] **Step 12: Commit.**

```bash
git add -- packages/db/supabase/migrations/0077_document_vault.sql packages/db/src/document-rules.ts packages/db/src/test/document-vault-schema.test.ts packages/db/src/test/document-vault-rls.test.ts packages/db/src/test/document-vault-reserve-lock.test.ts packages/db/src/__tests__/account-teardown-storage.test.ts
git commit -m "feat(db): migration 0077, the document vault's schema, bucket and quota (S-07 part 1)" -- packages/db/supabase/migrations/0077_document_vault.sql packages/db/src/document-rules.ts packages/db/src/test/document-vault-schema.test.ts packages/db/src/test/document-vault-rls.test.ts packages/db/src/test/document-vault-reserve-lock.test.ts packages/db/src/account-teardown.ts packages/db/src/test/places.test.ts packages/db/src/__tests__/account-teardown-storage.test.ts
```

---

## Task 2: Every key (bis-crm; messages.ts, the only writer)

**Review:** sonnet. **Runs beside:** Task 1.

**Files**
- Modify: `apps/web/src/lib/messages.ts` (one block, directly after `"places.title.es": "Propiedades",` at `:3804`)
- Modify: `apps/web/src/lib/messages.test.ts` (one added `describe`)

**Interfaces**
- Produces: every key below, each with its `.es` twin. A plural is a base key (other) plus `<key>One` (`lib/i18n/t.ts:16-18,54-62`). Later tasks name these keys exactly.

- [ ] **Step 1: Write the failing test** — append to `apps/web/src/lib/messages.test.ts`:

```ts
describe("the document vault's copy (S-07 part 1)", () => {
  const CATEGORIES = ["id", "contract", "estimate", "invoice", "photo", "permit", "insurance", "warranty", "other"] as const;
  it("the nine category words are the spec's table, in both languages (mutation: change documents.category.estimate.es -> FAILS)", () => {
    const want: Record<(typeof CATEGORIES)[number], [string, string]> = {
      id: ["ID", "Identificación"], contract: ["Contract", "Contrato"], estimate: ["Estimate or quote", "Presupuesto"],
      invoice: ["Invoice or receipt", "Factura o recibo"], photo: ["Photo", "Foto"], permit: ["Permit or license", "Permiso o licencia"],
      insurance: ["Insurance", "Seguro"], warranty: ["Warranty", "Garantía"], other: ["Other", "Otro"],
    };
    for (const k of CATEGORIES) {
      expect([m[`documents.category.${k}` as MessageKey], m[`documents.category.${k}.es` as MessageKey]], k).toEqual(want[k]);
    }
  });
  it("the empty sentence is the spec's, in usted (mutation: 'Sube' for 'Suba' -> FAILS)", () => {
    expect(m["documents.empty.contact"]).toBe("Contracts, IDs, photos and receipts for this customer are kept here. Upload a file or take a photo.");
    expect(m["documents.empty.contact.es"]).toBe("Aquí se guardan los contratos, identificaciones, fotos y recibos de este cliente. Suba un archivo o tome una foto.");
  });
  it("the four upload failures are the spec's words (mutation: drop 'or contact BIS' -> FAILS)", () => {
    expect(m["documents.error.tooLarge"]).toBe("Too large: {size}. The limit is 25 MB.");
    expect(m["documents.error.badType"]).toBe("This kind of file can't be kept here. Use PDF, JPG, PNG, WebP, Word or Excel.");
    expect(m["documents.error.quota"]).toBe("Your account's 5 GB is full. Delete files you no longer need, or contact BIS.");
    expect(m["documents.error.upload"]).toBe("Couldn't upload. Try again.");
  });
  it("the delete dialog's file line is the owner's wording, both languages (mutation: 'Esto también borra' -> FAILS)", () => {
    expect(m["contacts.delete.alsoFiles"]).toBe("This also deletes {count} files.");
    expect(m["contacts.delete.alsoFiles.es"]).toBe("También se borrarán {count} archivos.");
  });
});
```

(If `messages.test.ts` does not already import them: `import { m, type MessageKey } from "./messages";`.)

- [ ] **Step 2: Run it, see it fail.** `pnpm --filter web exec vitest run src/lib/messages.test.ts` → every new case FAILS (`undefined`).

- [ ] **Step 3: Add the block** after `messages.ts:3804`:

```ts
  // The document vault, part 1 (S-07 + F-005; spec 2026-10-13-document-vault-design.md). Usted (Q5).
  "documents.title": "Documents",
  "documents.title.es": "Documentos",
  "documents.count": "{count} files",
  "documents.count.es": "{count} archivos",
  "documents.countOne": "{count} file",
  "documents.countOne.es": "{count} archivo",
  "documents.capped": "Showing the newest 200.",
  "documents.capped.es": "Se muestran los 200 más recientes.",
  "documents.upload": "Upload",
  "documents.upload.es": "Subir",
  "documents.takePhoto": "Take photo",
  "documents.takePhoto.es": "Tomar foto",
  "documents.empty.contact": "Contracts, IDs, photos and receipts for this customer are kept here. Upload a file or take a photo.",
  "documents.empty.contact.es": "Aquí se guardan los contratos, identificaciones, fotos y recibos de este cliente. Suba un archivo o tome una foto.",
  "documents.empty.household": "Contracts, IDs, photos and receipts for this household are kept here. Upload a file or take a photo.",
  "documents.empty.household.es": "Aquí se guardan los contratos, identificaciones, fotos y recibos de este hogar. Suba un archivo o tome una foto.",
  "documents.empty.business": "Contracts, IDs, photos and receipts for this business are kept here. Upload a file or take a photo.",
  "documents.empty.business.es": "Aquí se guardan los contratos, identificaciones, fotos y recibos de este negocio. Suba un archivo o tome una foto.",
  "documents.loadFailed": "Couldn't load documents.",
  "documents.loadFailed.es": "No se pudieron cargar los documentos.",
  "documents.category.id": "ID",
  "documents.category.id.es": "Identificación",
  "documents.category.contract": "Contract",
  "documents.category.contract.es": "Contrato",
  "documents.category.estimate": "Estimate or quote",
  "documents.category.estimate.es": "Presupuesto",
  "documents.category.invoice": "Invoice or receipt",
  "documents.category.invoice.es": "Factura o recibo",
  "documents.category.photo": "Photo",
  "documents.category.photo.es": "Foto",
  "documents.category.permit": "Permit or license",
  "documents.category.permit.es": "Permiso o licencia",
  "documents.category.insurance": "Insurance",
  "documents.category.insurance.es": "Seguro",
  "documents.category.warranty": "Warranty",
  "documents.category.warranty.es": "Garantía",
  "documents.category.other": "Other",
  "documents.category.other.es": "Otro",
  "documents.addedBy": "Added by {name} · {when}",
  "documents.addedBy.es": "Agregado por {name} · {when}",
  "documents.photoBy": "Photo taken by {name} · {when}",
  "documents.photoBy.es": "Foto tomada por {name} · {when}",
  "documents.expires.in": "Expires in {count} days",
  "documents.expires.in.es": "Vence en {count} días",
  "documents.expires.inOne": "Expires in {count} day",
  "documents.expires.inOne.es": "Vence en {count} día",
  "documents.expires.today": "Expires today",
  "documents.expires.today.es": "Vence hoy",
  "documents.expires.ago": "Expired {count} days ago",
  "documents.expires.ago.es": "Venció hace {count} días",
  "documents.expires.agoOne": "Expired {count} day ago",
  "documents.expires.agoOne.es": "Venció hace {count} día",
  "documents.ownersOnly": "Owners only",
  "documents.ownersOnly.es": "Solo dueños",
  "documents.menu": "More for {title}",
  "documents.menu.es": "Más opciones para {title}",
  "documents.open": "Open {title}",
  "documents.open.es": "Abrir {title}",
  "documents.field.title": "Name",
  "documents.field.title.es": "Nombre",
  "documents.field.category": "Category",
  "documents.field.category.es": "Categoría",
  "documents.field.expires": "Expires on",
  "documents.field.expires.es": "Vence el",
  "documents.makeOwnersOnly": "Make Owners only",
  "documents.makeOwnersOnly.es": "Hacer solo para dueños",
  "documents.makeTeam": "Let the team see it",
  "documents.makeTeam.es": "Dejar que el equipo lo vea",
  "documents.madeOwnersOnly": "{title} is now Owners only.",
  "documents.madeOwnersOnly.es": "{title} ahora es solo para dueños.",
  "documents.madeTeam": "The team can see {title} again.",
  "documents.madeTeam.es": "El equipo puede ver {title} de nuevo.",
  "documents.edit": "Edit details",
  "documents.edit.es": "Editar los datos",
  "documents.download": "Download",
  "documents.download.es": "Descargar",
  "documents.trash": "Move to trash",
  "documents.trash.es": "Mover a la papelera",
  "documents.trashed": "{title} moved to the trash.",
  "documents.trashed.es": "{title} se movió a la papelera.",
  "documents.restore": "Restore",
  "documents.restore.es": "Restaurar",
  "documents.restored": "{title} is back.",
  "documents.restored.es": "{title} se restauró.",
  "documents.trashList": "Trash ({count})",
  "documents.trashList.es": "Papelera ({count})",
  "documents.purgeIn": "Deleted for good in {count} days",
  "documents.purgeIn.es": "Se borra para siempre en {count} días",
  "documents.purgeInOne": "Deleted for good in {count} day",
  "documents.purgeInOne.es": "Se borra para siempre en {count} día",
  "documents.purgeToday": "Deleted for good today",
  "documents.purgeToday.es": "Se borra para siempre hoy",
  "documents.status.trashed": "In the trash",
  "documents.status.trashed.es": "En la papelera",
  "documents.undoChanged": "Someone changed it after you, so nothing was undone.",
  "documents.undoChanged.es": "Alguien lo cambió después de usted, así que no se deshizo nada.",
  "documents.error.failed": "Couldn't save that. Try again.",
  "documents.error.failed.es": "No se pudo guardar. Intente de nuevo.",
  "documents.error.refused": "You can't change that file.",
  "documents.error.refused.es": "No puede cambiar ese archivo.",
  "documents.error.ownersOnlyRole": "Only an Owner can choose who sees a file.",
  "documents.error.ownersOnlyRole.es": "Solo un dueño puede elegir quién ve un archivo.",
  "documents.error.tooLarge": "Too large: {size}. The limit is 25 MB.",
  "documents.error.tooLarge.es": "Demasiado grande: {size}. El límite es de 25 MB.",
  "documents.error.badType": "This kind of file can't be kept here. Use PDF, JPG, PNG, WebP, Word or Excel.",
  "documents.error.badType.es": "Este tipo de archivo no se puede guardar aquí. Use PDF, JPG, PNG, WebP, Word o Excel.",
  "documents.error.quota": "Your account's 5 GB is full. Delete files you no longer need, or contact BIS.",
  "documents.error.quota.es": "Los 5 GB de su cuenta están llenos. Borre los archivos que ya no necesite o comuníquese con BIS.",
  "documents.error.upload": "Couldn't upload. Try again.",
  "documents.error.upload.es": "No se pudo subir. Intente de nuevo.",
  "documents.error.tooMany": "Choose up to 10 files at a time.",
  "documents.error.tooMany.es": "Elija hasta 10 archivos a la vez.",
  "documents.error.open": "Couldn't open this file. Try again.",
  "documents.error.open.es": "No se pudo abrir este archivo. Intente de nuevo.",
  "documents.progress.uploading": "Uploading {percent}%",
  "documents.progress.uploading.es": "Subiendo {percent}%",
  "documents.progress.checking": "Checking",
  "documents.progress.checking.es": "Revisando",
  "documents.retry": "Retry",
  "documents.retry.es": "Reintentar",
  "documents.cancel": "Cancel",
  "documents.cancel.es": "Cancelar",
  "documents.removeFile": "Remove {name} from the list",
  "documents.removeFile.es": "Quitar {name} de la lista",
  "documents.panel.ownersOnly": "Owners only: only Owners can see these files",
  "documents.panel.ownersOnly.es": "Solo dueños: solo los dueños pueden ver estos archivos",
  "documents.panel.expires": "Expires on (optional)",
  "documents.panel.expires.es": "Vence el (opcional)",
  "documents.viewer.noPreview": "This file opens in Word or Excel. Download it to see it.",
  "documents.viewer.noPreview.es": "Este archivo se abre en Word o Excel. Descárguelo para verlo.",
  "documents.you": "you",
  "documents.you.es": "usted",
  "documents.error.notFound": "We can't find this record anymore. Reload the page.",
  "documents.error.notFound.es": "Ya no encontramos este registro. Vuelva a cargar la página.",
  "documents.untitled": "Untitled file",
  "documents.untitled.es": "Archivo sin nombre",
  "timeline.document": "added a file: {title}",
  "timeline.document.es": "agregó un archivo: {title}",
  "timeline.documentPhoto": "took a photo: {title}",
  "timeline.documentPhoto.es": "tomó una foto: {title}",
  "timeline.what.documents": "documents",
  "timeline.what.documents.es": "documentos",
  // Owner ruling 2026-10-13: deleting a customer deletes their files; the dialog says how many.
  "contacts.delete.alsoFiles": "This also deletes {count} files.",
  "contacts.delete.alsoFiles.es": "También se borrarán {count} archivos.",
  "contacts.delete.alsoFilesOne": "This also deletes {count} file.",
  "contacts.delete.alsoFilesOne.es": "También se borrará {count} archivo.",
  "contacts.delete.filesFailed": "Couldn't check for files. Close this and try again.",
  "contacts.delete.filesFailed.es": "No se pudo revisar si hay archivos. Cierre esto e intente de nuevo.",
  "contacts.delete.keptFiles": "Deleted {count} · kept {kept} whose files couldn't be deleted. Try again.",
  "contacts.delete.keptFiles.es": "Se borraron {count} · se conservaron {kept} cuyos archivos no se pudieron borrar. Intente de nuevo.",
  "contacts.delete.filesGoneKept": "The files were deleted, but the customers were kept: a new file arrived while deleting. Try again.",
  "contacts.delete.filesGoneKept.es": "Los archivos se borraron, pero los clientes se conservaron: llegó un archivo nuevo mientras se borraba. Intente de nuevo.",
```

- [ ] **Step 3b: Spanish twins for the bulk delete DIALOG's own strings** (plan review minor 10; Task 17 renders that dialog in the reader's language), each on the line directly under its English key: `"common.cancel.es": "Cancelar",` under `messages.ts:294`; `"bulk.delete.es": "Borrar…",` under `:620`; `"bulk.confirmTitle.es": "¿Borrar {count} contactos?",` under `:622`; `"bulk.confirmTitleOne.es": "¿Borrar 1 contacto?",` under `:628`; `"bulk.confirmBody.es": "Esto no se puede deshacer. Escriba {count} para confirmar.",` under `:629` (line numbers before this task's own block is added; insert from the bottom up). Adding a twin to a frozen key only shrinks the catalogue baseline (Task 13 regenerates it). Add to the Step 1 test: `it("the bulk delete dialog has Spanish (mutation: drop bulk.confirmBody.es -> FAILS)", () => { for (const k of ["common.cancel", "bulk.delete", "bulk.confirmTitle", "bulk.confirmTitleOne", "bulk.confirmBody"]) expect(m[(k + ".es") as MessageKey], k).toBeTruthy(); });`
- [ ] **Step 4: Run** `pnpm --filter web exec vitest run src/lib/messages.test.ts src/lib/record/record-cards.test.ts` → PASS. Do NOT regenerate the baselines here (Task 13 does, once). If `src/lib/i18n/ratchet.test.ts` reports the new keys as unbaselined, that is expected until Task 13; a key reported WITHOUT a twin is this task's defect.
- [ ] **Step 5: Commit.** `git commit -m "feat(i18n): the document vault's copy, English and Spanish (S-07 part 1)" -- apps/web/src/lib/messages.ts apps/web/src/lib/messages.test.ts`

---

## Task 3: `@bis/db` `documents.ts`, `deleteContacts`' purge hook, the barrel (bis-crm)

**Review:** opus. **Scratch:** `<SCRATCH>/s07-t3-impl/`; replica + local PostgREST on `55522`/`55523`/`55524` (memory "Local DB replica", 2026-10-08 additions), built with Task 1's recipe through 0077 (`git show HEAD:packages/db/supabase/migrations/0077_document_vault.sql` once Task 1 has committed). **Never against bis-ci** (Global Constraints).

**Files**
- Create: `packages/db/src/documents.ts`
- Create: `packages/db/src/test/documents.test.ts`
- Modify: `packages/db/src/contacts.ts:1009-1035` (`deleteContacts`: the `beforeDelete` purge hook; its answer gains `skippedFiles`)
- Modify: `packages/db/src/test/contacts.test.ts` (the expectation at `:823`, one describe)
- Modify: `packages/db/src/index.ts` (one block after the places block's `} from "./places";`)
- Modify: `packages/db/package.json:5-13` (one subpath export, `"./document-rules"`)

**Interfaces**
- Consumes: Task 1's tables, `reserve_document_version`, `document-rules.ts`; `emit` (`events.ts:16-39`); `forContacts`, `withTimelinePage`, `TimelinePageOpts` (`timeline-cursor.ts:8,68-79`).
- Produces (exported from `@bis/db`; the pure rules ALSO from `@bis/db/document-rules`, safe in the browser):

```ts
export type DocumentRecordRef = { kind: "contact"; id: string } | { kind: "group"; id: string };
export type DocumentRow = {
  id: string; account_id: string; contact_id: string | null; client_group_id: string | null;
  title: string; category: DocumentCategory; expires_on: string | null; owners_only: boolean; source: DocumentSource;
  current_version_id: string | null; created_by: string; created_at: string; updated_at: string;
  deleted_at: string | null; deleted_by: string | null;
};
export type DocumentVersionRow = {
  id: string; document_id: string; account_id: string; storage_path: string; bytes: number;
  content_type: DocumentContentType; original_name: string | null; status: "uploading" | "ready"; created_at: string;
};
export type ListedDocument = DocumentRow & { version: DocumentVersionRow };
export type RecordDocuments = { live: ListedDocument[]; trashed: ListedDocument[]; liveMore: boolean; trashedMore: boolean };
export const MAX_DOCUMENTS_READ = 200;
export function listRecordDocuments(db, accountId: string, record: DocumentRecordRef): Promise<RecordDocuments>;
export function getDocument(db, accountId: string, documentId: string): Promise<DocumentRow | null>;
export function getDocumentVersion(db, accountId: string, versionId: string): Promise<DocumentVersionRow | null>;
export function createDocument(db, a: { accountId: string; record: DocumentRecordRef; title: string; category: DocumentCategory; expiresOn: string | null; ownersOnly: boolean; source: DocumentSource; createdBy: string }): Promise<string>;
export type ReserveOutcome = { status: "ok"; versionId: string; storagePath: string } | { status: "over_quota" | "too_large" | "not_found" };
export function reserveDocumentVersion(db, a: { accountId: string; documentId: string; bytes: number; contentType: DocumentContentType; originalName: string | null; uploadedBy: string }): Promise<ReserveOutcome>;
export function getUploadingVersion(db, accountId: string, documentId: string, versionId: string): Promise<DocumentVersionRow | null>;
export function markDocumentVersionReady(db, a: { accountId: string; documentId: string; versionId: string; bytes: number; sha256: string; actorId: string }): Promise<boolean>;   // rpc mark_document_version_ready
export function discardDocumentUpload(db, accountId: string, documentId: string, versionId: string | null): Promise<void>;
export type DocumentField = "title" | "category" | "expires_on";
export type CasOutcome = "updated" | "changed";
export function updateDocumentField(db, accountId: string, documentId: string, field: DocumentField, value: string | null, expected?: { value: string | null }): Promise<CasOutcome>;
export function setDocumentOwnersOnly(db, accountId: string, documentId: string, value: boolean, expected?: boolean): Promise<CasOutcome>;
export function trashDocument(db, accountId: string, documentId: string, actorId: string): Promise<{ status: "trashed"; deletedAt: string } | { status: "changed" }>;
export function restoreDocument(db, accountId: string, documentId: string, expectedDeletedAt: string, actorId: string): Promise<CasOutcome>;
export type SweepVersion = { id: string; account_id: string; document_id: string; storage_path: string };
export function listAbandonedUploads(db, cutoffIso: string, limit: number): Promise<SweepVersion[]>;
export function deleteAbandonedVersion(db, version: SweepVersion): Promise<void>;
export type PurgeCandidate = { id: string; account_id: string; contact_id: string | null; client_group_id: string | null; category: DocumentCategory; paths: string[] };
export function listPurgeableDocuments(db, cutoffIso: string, limit: number): Promise<PurgeCandidate[]>;
export function purgeDocumentRow(db, doc: PurgeCandidate): Promise<boolean>;
export type TimelineDocument = {
  id: string; title: string; category: DocumentCategory; source: DocumentSource; created_by: string;
  created_at: string; deleted_at: string | null; contact_id: string | null; client_group_id: string | null;
};
export function listDocumentTimeline(db, accountId: string, who: string | readonly string[], groupId: string | null, page: TimelinePageOpts): Promise<TimelineDocument[]>;
// Owner ruling 2026-10-13 (deviation 2): a customer's files go with them.
export function countContactDocuments(db, accountId: string, contactIds: readonly string[]): Promise<number>;   // request client; throws on a null count
export type ContactPurge = { purgedDocuments: number; keptContacts: string[] };
export function purgeContactDocuments(db, accountId: string, contactIds: readonly string[], actorId: string): Promise<ContactPurge>;   // service client
// packages/db/src/contacts.ts
export function deleteContacts(db, accountId: string, contactIds: string[], opts?: { beforeDelete?: (deletable: string[]) => Promise<string[]> }):
  Promise<{ deleted: number; skippedBlocked: number; skippedFiles: number }>;
```

**Assumption A9:** PostgREST v14 embeds through a composite FK named with `!constraint` (`version:document_versions!documents_current_version_fkey(...)` as a to-one, `versions:document_versions!document_versions_document_fkey(storage_path)` as a to-many). Proven by this task's `documents.test.ts` on the replica's PostgREST v14.14 and by CI `verify`; if it fails, replace each embed with a second query by `document_id` in chunks of 100 ids and say so in the report.

- [ ] **Step 1: Write the failing test** `packages/db/src/test/documents.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { withTestAccount } from "./fixtures";
import { createContact } from "../contacts";
import { createGroupWithMember } from "../client-groups";
import {
  createDocument, reserveDocumentVersion, markDocumentVersionReady, discardDocumentUpload, listRecordDocuments,
  getDocument, updateDocumentField, setDocumentOwnersOnly, trashDocument, restoreDocument, listAbandonedUploads,
  listPurgeableDocuments, purgeDocumentRow, deleteAbandonedVersion, listDocumentTimeline,
} from "../documents";

/**
 * The document vault's data layer (spec sections 3 and 5), on the service client a server action
 * holds AFTER its request-client proof. RLS itself is document-vault-rls.test.ts's job.
 */
const ACTOR = "user_docs_test";
const HASH = "b".repeat(64);

async function readyDoc(db: SupabaseClient, accountId: string, contactId: string, over: Partial<{ title: string }> = {}) {
  const id = await createDocument(db, {
    accountId, record: { kind: "contact", id: contactId }, title: over.title ?? "Contract", category: "contract",
    expiresOn: null, ownersOnly: false, source: "upload", createdBy: ACTOR,
  });
  const r = await reserveDocumentVersion(db, { accountId, documentId: id, bytes: 100, contentType: "application/pdf", originalName: "c.pdf", uploadedBy: ACTOR });
  if (r.status !== "ok") throw new Error(`reserve: ${r.status}`);
  expect(await markDocumentVersionReady(db, { accountId, documentId: id, versionId: r.versionId, bytes: 90, sha256: HASH, actorId: ACTOR })).toBe(true);
  return { id, versionId: r.versionId, path: r.storagePath };
}

const events = async (db: SupabaseClient, accountId: string, type: string) => {
  const { data, error } = await db.from("events").select("actor_type, actor_id, payload").eq("account_id", accountId).eq("type", type);
  if (error) throw error;
  return data ?? [];
};

describe("an upload's life (spec 5.1)", () => {
  it("listed only once ready; ready stores the real size; document.added once, with no title (mutation: drop the current_version_id filter -> FAILS)", () =>
    withTestAccount(async (db, accountId) => {
      const ana = (await createContact(db, accountId, { firstName: "Ana" }, ACTOR)).id;
      const pending = await createDocument(db, { accountId, record: { kind: "contact", id: ana }, title: "Pending", category: "other", expiresOn: null, ownersOnly: false, source: "upload", createdBy: ACTOR });
      await reserveDocumentVersion(db, { accountId, documentId: pending, bytes: 10, contentType: "application/pdf", originalName: null, uploadedBy: ACTOR });
      const d = await readyDoc(db, accountId, ana);
      const list = await listRecordDocuments(db, accountId, { kind: "contact", id: ana });
      expect(list.live.map((x) => x.id)).toEqual([d.id]);
      expect(list.live[0]!.version).toMatchObject({ id: d.versionId, bytes: 90, status: "ready", content_type: "application/pdf" });
      expect(await events(db, accountId, "document.added")).toEqual([
        { actor_type: "user", actor_id: ACTOR, payload: { documentId: d.id, contactId: ana } }]);
    }));

  it("a second finish is refused: only an uploading version becomes ready (mutation: drop `and status = 'uploading'` from mark_document_version_ready -> FAILS)", () =>
    withTestAccount(async (db, accountId) => {
      const ana = (await createContact(db, accountId, { firstName: "Ana" }, ACTOR)).id;
      const d = await readyDoc(db, accountId, ana);
      expect(await markDocumentVersionReady(db, { accountId, documentId: d.id, versionId: d.versionId, bytes: 1, sha256: HASH, actorId: ACTOR })).toBe(false);
      expect(await events(db, accountId, "document.added")).toHaveLength(1);
    }));

  it("discarding a failed first upload removes version and document; never a ready document (mutation: drop .is('current_version_id', null) -> FAILS)", () =>
    withTestAccount(async (db, accountId) => {
      const ana = (await createContact(db, accountId, { firstName: "Ana" }, ACTOR)).id;
      const id = await createDocument(db, { accountId, record: { kind: "contact", id: ana }, title: "Bad", category: "other", expiresOn: null, ownersOnly: false, source: "upload", createdBy: ACTOR });
      const r = await reserveDocumentVersion(db, { accountId, documentId: id, bytes: 10, contentType: "application/pdf", originalName: null, uploadedBy: ACTOR });
      if (r.status !== "ok") throw new Error(r.status);
      await discardDocumentUpload(db, accountId, id, r.versionId);
      expect(await getDocument(db, accountId, id)).toBeNull();
      const d = await readyDoc(db, accountId, ana);
      await discardDocumentUpload(db, accountId, d.id, d.versionId);
      expect(await getDocument(db, accountId, d.id)).not.toBeNull();
    }));
});

describe("edits, trash and restore are compare-and-set (spec 4.1, 4.4)", () => {
  it("an Undo whose expected value no longer holds changes nothing (mutation: drop the expected-value filter -> FAILS)", () =>
    withTestAccount(async (db, accountId) => {
      const ana = (await createContact(db, accountId, { firstName: "Ana" }, ACTOR)).id;
      const d = await readyDoc(db, accountId, ana);
      expect(await updateDocumentField(db, accountId, d.id, "title", "Signed contract")).toBe("updated");
      expect(await updateDocumentField(db, accountId, d.id, "title", "Third")).toBe("updated");
      expect(await updateDocumentField(db, accountId, d.id, "title", "Contract", { value: "Signed contract" })).toBe("changed");
      expect((await getDocument(db, accountId, d.id))!.title).toBe("Third");
      expect(await updateDocumentField(db, accountId, d.id, "expires_on", "2026-12-01", { value: null })).toBe("updated");
      expect(await setDocumentOwnersOnly(db, accountId, d.id, true, false)).toBe("updated");
      expect(await setDocumentOwnersOnly(db, accountId, d.id, false, false)).toBe("changed");
    }));

  it("trash answers the stored instant; restore only while it still holds; both emit; a trashed file refuses edits (mutation: restore without .eq('deleted_at', expected) -> FAILS)", () =>
    withTestAccount(async (db, accountId) => {
      const ana = (await createContact(db, accountId, { firstName: "Ana" }, ACTOR)).id;
      const d = await readyDoc(db, accountId, ana);
      const t1 = await trashDocument(db, accountId, d.id, ACTOR);
      if (t1.status !== "trashed") throw new Error("not trashed");
      expect(await trashDocument(db, accountId, d.id, ACTOR)).toEqual({ status: "changed" });
      const list = await listRecordDocuments(db, accountId, { kind: "contact", id: ana });
      expect([list.live.length, list.trashed.map((x) => x.id)]).toEqual([0, [d.id]]);
      expect(await restoreDocument(db, accountId, d.id, "2000-01-01T00:00:00+00:00", ACTOR)).toBe("changed");
      expect(await restoreDocument(db, accountId, d.id, t1.deletedAt, ACTOR)).toBe("updated");
      expect(await events(db, accountId, "document.trashed")).toHaveLength(1);
      expect(await events(db, accountId, "document.restored")).toHaveLength(1);
      await trashDocument(db, accountId, d.id, ACTOR);
      expect(await updateDocumentField(db, accountId, d.id, "title", "X")).toBe("changed");
    }));
});

describe("the sweep's reads (spec 5.4)", () => {
  it("purgeable = trashed before the cutoff, with every path; purge emits as the system (mutation: .lt -> .gt on deleted_at -> FAILS)", () =>
    withTestAccount(async (db, accountId) => {
      const ana = (await createContact(db, accountId, { firstName: "Ana" }, ACTOR)).id;
      const old = await readyDoc(db, accountId, ana, { title: "Old" });
      const fresh = await readyDoc(db, accountId, ana, { title: "Fresh" });
      const { error } = await db.from("documents").update({ deleted_at: "2026-01-01T00:00:00Z", deleted_by: ACTOR }).eq("id", old.id);
      if (error) throw error;
      await trashDocument(db, accountId, fresh.id, ACTOR);
      const due = (await listPurgeableDocuments(db, "2026-02-01T00:00:00Z", 50)).filter((x) => x.account_id === accountId);
      expect(due.map((x) => [x.id, x.paths])).toEqual([[old.id, [old.path]]]);
      expect(await purgeDocumentRow(db, due[0]!)).toBe(true);
      expect(await getDocument(db, accountId, old.id)).toBeNull();
      expect(await events(db, accountId, "document.purged")).toEqual([
        { actor_type: "system", actor_id: "documents-sweep", payload: { documentId: old.id, contactId: ana } }]);
    }));

  it("abandoned = still uploading before the cutoff; deleting one takes a never-ready document too (mutation: drop the document delete in discardDocumentUpload -> FAILS)", () =>
    withTestAccount(async (db, accountId) => {
      const ana = (await createContact(db, accountId, { firstName: "Ana" }, ACTOR)).id;
      const id = await createDocument(db, { accountId, record: { kind: "contact", id: ana }, title: "Stuck", category: "other", expiresOn: null, ownersOnly: false, source: "upload", createdBy: ACTOR });
      await reserveDocumentVersion(db, { accountId, documentId: id, bytes: 10, contentType: "application/pdf", originalName: null, uploadedBy: ACTOR });
      const future = new Date(Date.now() + 60_000).toISOString();
      const stuck = (await listAbandonedUploads(db, future, 500)).filter((v) => v.account_id === accountId);
      expect(stuck.map((v) => v.document_id)).toEqual([id]);
      await deleteAbandonedVersion(db, stuck[0]!);
      expect(await getDocument(db, accountId, id)).toBeNull();
      expect((await listAbandonedUploads(db, "2000-01-01T00:00:00Z", 500)).filter((v) => v.account_id === accountId)).toEqual([]);
    }));
});

describe("the timeline read (plan deviation 3)", () => {
  it("a contact's ready documents, trashed ones included; a group page adds the group's own (mutation: drop the group read -> FAILS)", () =>
    withTestAccount(async (db, accountId) => {
      const ana = (await createContact(db, accountId, { firstName: "Ana" }, ACTOR)).id;
      const g = await createGroupWithMember(db, accountId, ana, "household", "Casa", null, ACTOR);
      if (g.status !== "ok") throw new Error(g.status);
      const a = await readyDoc(db, accountId, ana, { title: "Mine" });
      const gid = await createDocument(db, { accountId, record: { kind: "group", id: g.groupId }, title: "Ours", category: "permit", expiresOn: null, ownersOnly: false, source: "camera", createdBy: ACTOR });
      const r = await reserveDocumentVersion(db, { accountId, documentId: gid, bytes: 10, contentType: "image/jpeg", originalName: null, uploadedBy: ACTOR });
      if (r.status !== "ok") throw new Error(r.status);
      await markDocumentVersionReady(db, { accountId, documentId: gid, versionId: r.versionId, bytes: 10, sha256: HASH, actorId: ACTOR });
      await trashDocument(db, accountId, a.id, ACTOR);
      const page = { limit: 10 };
      expect((await listDocumentTimeline(db, accountId, ana, null, page)).map((x) => [x.title, x.deleted_at !== null])).toEqual([["Mine", true]]);
      const both = await listDocumentTimeline(db, accountId, [ana], g.groupId, page);
      expect(both.map((x) => x.title).sort()).toEqual(["Mine", "Ours"]);
      expect(both.find((x) => x.title === "Ours")).toMatchObject({ source: "camera", client_group_id: g.groupId, contact_id: null });
    }));
});
```

Append to the same `documents.test.ts` (owner ruling 2026-10-13: a customer's files go with them). Storage is not part of the replica, so these cases wrap the real service client with a fake `storage` (`withStorage`); the rows, the FK and the events are real:

```ts
import { countContactDocuments, purgeContactDocuments } from "../documents";

/** The real client, with `storage.from(..).remove` replaced: Postgres stays real, the bucket is faked. */
function withStorage(db: SupabaseClient, remove: (paths: string[]) => Promise<{ data: unknown; error: { message: string } | null }>): SupabaseClient {
  return new Proxy(db, { get: (t, p) => (p === "storage" ? { from: () => ({ remove }) } : Reflect.get(t, p, t)) }) as SupabaseClient;
}

describe("a customer's files go with them (deviation 2)", () => {
  it("purge: objects first, then the row, then document.purged as the user, trashed files too (mutation: delete the row before the remove -> FAILS on the order)", () =>
    withTestAccount(async (db, accountId) => {
      const ana = (await createContact(db, accountId, { firstName: "Ana" }, ACTOR)).id;
      const a = await readyDoc(db, accountId, ana, { title: "A" });
      const b = await readyDoc(db, accountId, ana, { title: "B" });
      await trashDocument(db, accountId, b.id, ACTOR);
      const order: string[] = [];
      const svc = withStorage(db, async (paths) => {
        for (const p of paths) order.push(`object:${p}`);
        const { data } = await db.from("documents").select("id").in("id", [a.id, b.id]);
        order.push(`rows-left:${(data ?? []).length}`);
        return { data: [], error: null };
      });
      expect(await purgeContactDocuments(svc, accountId, [ana], "user_owner")).toEqual({ purgedDocuments: 2, keptContacts: [] });
      expect(order.filter((x) => x.startsWith("object:")).sort()).toEqual([`object:${a.path}`, `object:${b.path}`].sort());
      expect(order.filter((x) => x.startsWith("rows-left:"))[0]).toBe("rows-left:2");   // the first object went while both rows stood
      expect(await getDocument(db, accountId, a.id)).toBeNull();
      expect((await events(db, accountId, "document.purged")).map((e) => (e as { actor_type: string; actor_id: string }).actor_type + ":" + (e as { actor_id: string }).actor_id))
        .toEqual(["user:user_owner", "user:user_owner"]);
    }));

  it("a failed removal keeps that customer and its rows, says so in keptContacts, and a retry finishes (mutation: delete the row when remove failed -> FAILS)", () =>
    withTestAccount(async (db, accountId) => {
      const ana = (await createContact(db, accountId, { firstName: "Ana" }, ACTOR)).id;
      const bea = (await createContact(db, accountId, { firstName: "Bea" }, ACTOR)).id;
      const a = await readyDoc(db, accountId, ana, { title: "A" });
      const b = await readyDoc(db, accountId, bea, { title: "B" });
      const errors = vi.spyOn(console, "error").mockImplementation(() => {});
      const failing = withStorage(db, async (paths) => (paths.includes(a.path) ? { data: null, error: { message: "storage down" } } : { data: [], error: null }));
      expect(await purgeContactDocuments(failing, accountId, [ana, bea], "user_owner")).toEqual({ purgedDocuments: 1, keptContacts: [ana] });
      expect(await getDocument(db, accountId, a.id)).not.toBeNull();
      expect(await getDocument(db, accountId, b.id)).toBeNull();
      expect(errors.mock.calls.some(([msg]) => String(msg).includes(a.id) && String(msg).includes(ana))).toBe(true);
      errors.mockRestore();
      const ok = withStorage(db, async () => ({ data: [], error: null }));
      expect(await purgeContactDocuments(ok, accountId, [ana], "user_owner")).toEqual({ purgedDocuments: 1, keptContacts: [] });
      expect(await getDocument(db, accountId, a.id)).toBeNull();
    }));

  it("a contact with more documents than one page is purged completely (mutation: drop the paging loop -> FAILS with 501)", () =>
    withTestAccount(async (db, accountId) => {
      const ana = (await createContact(db, accountId, { firstName: "Ana" }, ACTOR)).id;
      for (let n = 0; n < 501; n++) {
        await createDocument(db, { accountId, record: { kind: "contact", id: ana }, title: `D${n}`, category: "other", expiresOn: null, ownersOnly: false, source: "upload", createdBy: ACTOR });
      }
      const ok = withStorage(db, async () => ({ data: [], error: null }));
      expect((await purgeContactDocuments(ok, accountId, [ana], "user_owner")).purgedDocuments).toBe(501);
      expect(await countContactDocuments(db, accountId, [ana])).toBe(0);
    }));

  it("the dialog's count includes trashed files and other contacts' files never count (mutation: filter deleted_at is null -> FAILS)", () =>
    withTestAccount(async (db, accountId) => {
      const ana = (await createContact(db, accountId, { firstName: "Ana" }, ACTOR)).id;
      const bea = (await createContact(db, accountId, { firstName: "Bea" }, ACTOR)).id;
      await readyDoc(db, accountId, ana, { title: "A" });
      const t = await readyDoc(db, accountId, ana, { title: "T" });
      await trashDocument(db, accountId, t.id, ACTOR);
      await readyDoc(db, accountId, bea, { title: "B" });
      expect(await countContactDocuments(db, accountId, [ana])).toBe(2);
      expect(await countContactDocuments(db, accountId, [ana, bea])).toBe(3);
    }));

  it("a null head count throws, never reads as zero (mutation: `count ?? 0` -> FAILS)", async () => {
    const chain = { select: () => chain, eq: () => chain, in: async () => ({ count: null, error: null }) };
    const fake = { from: () => chain } as unknown as SupabaseClient;
    await expect(countContactDocuments(fake, "acc", ["c1"])).rejects.toThrow(/null/);
  });
});
```

(Add `vi` to this file's `vitest` import, and fold the `countContactDocuments, purgeContactDocuments` import into the file's existing `../documents` import at the top.)

And in `packages/db/src/test/contacts.test.ts` (add `createDocument` from `"../documents"` to its imports; `deleteContacts` and `getContact` are already imported, `contacts.test.ts:9`): the existing case at `:822-823` becomes `expect(r).toEqual({ deleted: 1, skippedBlocked: 1, skippedFiles: 0 });` (the return gains a field), and a new describe at the end of the file:

```ts
describe("deleteContacts and a customer's files (0077, deviation 2)", () => {
  it("beforeDelete sees only the deletable ids, and an id it keeps is not deleted (mutation: delete the kept ids anyway -> FAILS)", () =>
    withTestAccount(async (db, accountId) => {
      const keep = (await createContact(db, accountId, { firstName: "Keep" }, "user_t")).id;
      const go = (await createContact(db, accountId, { firstName: "Go" }, "user_t")).id;
      const seen: string[][] = [];
      const r = await deleteContacts(db, accountId, [keep, go], { beforeDelete: async (ids) => { seen.push([...ids].sort()); return [keep]; } });
      expect(seen).toEqual([[keep, go].sort()]);
      expect(r).toEqual({ deleted: 1, skippedBlocked: 0, skippedFiles: 1 });
      expect(await getContact(db, accountId, keep)).not.toBeNull();
      expect(await getContact(db, accountId, go)).toBeNull();
    }));

  it("without the purge, a contact with a document is NOT deleted: the FK refuses the statement (the backstop; mutation: documents_contact_fkey on delete cascade -> FAILS)", () =>
    withTestAccount(async (db, accountId) => {
      const c = (await createContact(db, accountId, { firstName: "Has file" }, "user_t")).id;
      await createDocument(db, { accountId, record: { kind: "contact", id: c }, title: "ID", category: "id", expiresOn: null, ownersOnly: false, source: "upload", createdBy: "user_t" });
      await expect(deleteContacts(db, accountId, [c])).rejects.toThrow(/documents_contact_fkey|foreign key/);
      expect(await getContact(db, accountId, c)).not.toBeNull();
    }));
});
```

- [ ] **Step 2: Build the replica with PostgREST and run; see it fail** (`../documents` does not exist).
- [ ] **Step 3: Write `packages/db/src/documents.ts`:**

```ts
import type { SupabaseClient } from "@supabase/supabase-js";
import { emit } from "./events";
import { forContacts, withTimelinePage, type TimelinePageOpts } from "./timeline-cursor";
import { DOCUMENT_BUCKET, type DocumentCategory, type DocumentContentType, type DocumentSource } from "./document-rules";

/**
 * The document vault's data layer (0077; spec sections 3 and 5). READS take the caller's client:
 * on a request client RLS decides what is visible (the record's visibility, the Technician fence,
 * Owners only), and a server action's proof is exactly such a read. WRITES take the service client
 * a server action holds AFTER that proof (0053): `authenticated` has no write grant on either table.
 * Every write is scoped to `accountId`. Event payloads carry the document id and its record, never its
 * title or category: events_read (0001) shows every event to every Owner and Staff, and an
 * Owners-only title must not reach Staff that way (plan deviation 3). THROWS on a read or write error.
 */
export type DocumentRecordRef = { kind: "contact"; id: string } | { kind: "group"; id: string };
export type DocumentRow = {
  id: string; account_id: string; contact_id: string | null; client_group_id: string | null;
  title: string; category: DocumentCategory; expires_on: string | null; owners_only: boolean; source: DocumentSource;
  current_version_id: string | null; created_by: string; created_at: string; updated_at: string;
  deleted_at: string | null; deleted_by: string | null;
};
export type DocumentVersionRow = {
  id: string; document_id: string; account_id: string; storage_path: string; bytes: number;
  content_type: DocumentContentType; original_name: string | null; status: "uploading" | "ready"; created_at: string;
};
export type ListedDocument = DocumentRow & { version: DocumentVersionRow };
export type RecordDocuments = { live: ListedDocument[]; trashed: ListedDocument[]; liveMore: boolean; trashedMore: boolean };

/** Plan deviation 9: the card reads at most this many live and this many trashed documents. */
export const MAX_DOCUMENTS_READ = 200;

const DOC_COLS = "id, account_id, contact_id, client_group_id, title, category, expires_on, owners_only, source, "
  + "current_version_id, created_by, created_at, updated_at, deleted_at, deleted_by";
const VERSION_COLS = "id, document_id, account_id, storage_path, bytes, content_type, original_name, status, created_at";

const recordColumn = (r: DocumentRecordRef) => (r.kind === "contact" ? "contact_id" : "client_group_id");
/** The payload's record key: contactId or groupId, never both (documents_one_record). */
const recordPayload = (row: { contact_id: string | null; client_group_id: string | null }) =>
  row.contact_id ? { contactId: row.contact_id } : { groupId: row.client_group_id };
/** bigint arrives as a number from PostgREST below 2^53, as a string from pg; both read as a number here. */
const asVersion = (v: DocumentVersionRow): DocumentVersionRow => ({ ...v, bytes: Number(v.bytes) });

/** Best-effort event after a committed write: the write stands, a lost event is logged (restoreContactLanguage's shape, contacts.ts:1205-1210). */
async function emitAfter(
  db: SupabaseClient, accountId: string, type: string, actorId: string, payload: object, actorType: "user" | "system" = "user",
): Promise<void> {
  try {
    await emit(db, accountId, type, actorId, payload, actorType);
  } catch (e) {
    console.error(`documents: account ${accountId}: ${type} emit failed after the write committed: ${(e as Error).message}`);
  }
}

/** The card's read: live documents newest first, trashed ones by when they were trashed. Listed only once a version is ready. */
export async function listRecordDocuments(db: SupabaseClient, accountId: string, record: DocumentRecordRef): Promise<RecordDocuments> {
  const read = async (trashed: boolean) => {
    let q = db.from("documents")
      .select(`${DOC_COLS}, version:document_versions!documents_current_version_fkey(${VERSION_COLS})`)
      .eq("account_id", accountId).eq(recordColumn(record), record.id).not("current_version_id", "is", null);
    q = trashed
      ? q.not("deleted_at", "is", null).order("deleted_at", { ascending: false })
      : q.is("deleted_at", null).order("created_at", { ascending: false });
    const { data, error } = await q.order("id", { ascending: false }).limit(MAX_DOCUMENTS_READ + 1);
    if (error) throw new Error(`listRecordDocuments failed: ${error.message}`);
    return ((data ?? []) as unknown as (DocumentRow & { version: DocumentVersionRow | null })[])
      .flatMap((r) => (r.version ? [{ ...r, version: asVersion(r.version) }] : []));
  };
  const [live, trashed] = await Promise.all([read(false), read(true)]);
  return {
    live: live.slice(0, MAX_DOCUMENTS_READ), trashed: trashed.slice(0, MAX_DOCUMENTS_READ),
    liveMore: live.length > MAX_DOCUMENTS_READ, trashedMore: trashed.length > MAX_DOCUMENTS_READ,
  };
}

export async function getDocument(db: SupabaseClient, accountId: string, documentId: string): Promise<DocumentRow | null> {
  const { data, error } = await db.from("documents").select(DOC_COLS).eq("account_id", accountId).eq("id", documentId).maybeSingle();
  if (error) throw new Error(`getDocument failed: ${error.message}`);
  return (data as DocumentRow | null) ?? null;
}

export async function getDocumentVersion(db: SupabaseClient, accountId: string, versionId: string): Promise<DocumentVersionRow | null> {
  const { data, error } = await db.from("document_versions").select(VERSION_COLS).eq("account_id", accountId).eq("id", versionId).maybeSingle();
  if (error) throw new Error(`getDocumentVersion failed: ${error.message}`);
  return data ? asVersion(data as DocumentVersionRow) : null;
}

/** The finish step's read: an UPLOADING version of this document, or null. */
export async function getUploadingVersion(
  db: SupabaseClient, accountId: string, documentId: string, versionId: string,
): Promise<DocumentVersionRow | null> {
  const { data, error } = await db.from("document_versions").select(VERSION_COLS)
    .eq("account_id", accountId).eq("document_id", documentId).eq("id", versionId).eq("status", "uploading").maybeSingle();
  if (error) throw new Error(`getUploadingVersion failed: ${error.message}`);
  return data ? asVersion(data as DocumentVersionRow) : null;
}

/** Service client. scan_status is honestly 'skipped' for a staff upload (spec 3.2). */
export async function createDocument(db: SupabaseClient, a: {
  accountId: string; record: DocumentRecordRef; title: string; category: DocumentCategory; expiresOn: string | null;
  ownersOnly: boolean; source: DocumentSource; createdBy: string;
}): Promise<string> {
  const { data, error } = await db.from("documents").insert({
    account_id: a.accountId, [recordColumn(a.record)]: a.record.id, title: a.title, category: a.category,
    expires_on: a.expiresOn, owners_only: a.ownersOnly, source: a.source, scan_status: "skipped", created_by: a.createdBy,
  }).select("id").single();
  if (error) throw new Error(`createDocument failed: ${error.message}`);
  return (data as { id: string }).id;
}

export type ReserveOutcome = { status: "ok"; versionId: string; storagePath: string } | { status: "over_quota" | "too_large" | "not_found" };

/** Service client: public.reserve_document_version (0077), executable by service_role only. */
export async function reserveDocumentVersion(db: SupabaseClient, a: {
  accountId: string; documentId: string; bytes: number; contentType: DocumentContentType; originalName: string | null; uploadedBy: string;
}): Promise<ReserveOutcome> {
  const { data, error } = await db.rpc("reserve_document_version", {
    p_account_id: a.accountId, p_document_id: a.documentId, p_bytes: a.bytes, p_content_type: a.contentType,
    p_original_name: a.originalName, p_uploaded_by: a.uploadedBy,
  });
  if (error) throw new Error(`reserveDocumentVersion failed: ${error.message}`);
  const r = data as { status: string; version_id?: string; storage_path?: string };
  if (r.status === "ok" && r.version_id && r.storage_path) return { status: "ok", versionId: r.version_id, storagePath: r.storage_path };
  if (r.status === "over_quota" || r.status === "too_large" || r.status === "not_found") return { status: r.status };
  throw new Error(`reserveDocumentVersion: unexpected answer ${JSON.stringify(r.status)}`);
}

/**
 * Service client, after the finish step checked the object's bytes. Only an UPLOADING version of
 * this document becomes ready (a second finish is false). The document's current version moves to
 * it; document.added is emitted for a document's FIRST ready version only.
 */
export async function markDocumentVersionReady(db: SupabaseClient, a: {
  accountId: string; documentId: string; versionId: string; bytes: number; sha256: string; actorId: string;
}): Promise<boolean> {
  // public.mark_document_version_ready (0077): the version and the pointer move in ONE transaction.
  const { data, error } = await db.rpc("mark_document_version_ready", {
    p_account_id: a.accountId, p_document_id: a.documentId, p_version_id: a.versionId, p_bytes: a.bytes, p_sha256: a.sha256,
  });
  if (error) throw new Error(`markDocumentVersionReady failed: ${error.message}`);
  const r = data as { status: string; first?: boolean };
  if (r.status !== "ok") return false;
  if (r.first) {
    const doc = await getDocument(db, a.accountId, a.documentId);
    if (doc) await emitAfter(db, a.accountId, "document.added", a.actorId, { documentId: doc.id, ...recordPayload(doc) });
  }
  return true;
}

/**
 * Service client: a refused or failed upload. The version goes (none when the reservation itself was
 * refused, `versionId` null); a document that never had a ready version goes too.
 */
export async function discardDocumentUpload(db: SupabaseClient, accountId: string, documentId: string, versionId: string | null): Promise<void> {
  if (versionId) {
    const { error } = await db.from("document_versions").delete()
      .eq("account_id", accountId).eq("document_id", documentId).eq("id", versionId).eq("status", "uploading");
    if (error) throw new Error(`discardDocumentUpload (version) failed: ${error.message}`);
  }
  const { error: docError } = await db.from("documents").delete()
    .eq("account_id", accountId).eq("id", documentId).is("current_version_id", null);
  if (docError) throw new Error(`discardDocumentUpload (document) failed: ${docError.message}`);
}

export type DocumentField = "title" | "category" | "expires_on";
export type CasOutcome = "updated" | "changed";

/**
 * Service client. An edit passes no `expected` and writes; an Undo passes `expected` = the value its
 * edit wrote, and changes nothing ("changed") when someone wrote after it (spec 4.1: compare-and-set,
 * never a blind restore). A trashed document is never edited.
 */
export async function updateDocumentField(
  db: SupabaseClient, accountId: string, documentId: string, field: DocumentField, value: string | null,
  expected?: { value: string | null },
): Promise<CasOutcome> {
  let q = db.from("documents").update({ [field]: value, updated_at: new Date().toISOString() })
    .eq("account_id", accountId).eq("id", documentId).is("deleted_at", null);
  if (expected) q = expected.value === null ? q.is(field, null) : q.eq(field, expected.value);
  const { data, error } = await q.select("id");
  if (error) throw new Error(`updateDocumentField failed: ${error.message}`);
  return (data ?? []).length > 0 ? "updated" : "changed";
}

/** Service client; the CALLER has checked the role (Owner or agency, spec 3.4). Same compare-and-set. */
export async function setDocumentOwnersOnly(
  db: SupabaseClient, accountId: string, documentId: string, value: boolean, expected?: boolean,
): Promise<CasOutcome> {
  let q = db.from("documents").update({ owners_only: value, updated_at: new Date().toISOString() })
    .eq("account_id", accountId).eq("id", documentId).is("deleted_at", null);
  if (expected !== undefined) q = q.eq("owners_only", expected);
  const { data, error } = await q.select("id");
  if (error) throw new Error(`setDocumentOwnersOnly failed: ${error.message}`);
  return (data ?? []).length > 0 ? "updated" : "changed";
}

/** Service client. Answers the stored instant exactly as PostgREST returned it; the Undo's restore compares against it. */
export async function trashDocument(
  db: SupabaseClient, accountId: string, documentId: string, actorId: string,
): Promise<{ status: "trashed"; deletedAt: string } | { status: "changed" }> {
  const now = new Date().toISOString();
  const { data, error } = await db.from("documents")
    .update({ deleted_at: now, deleted_by: actorId, updated_at: now })
    .eq("account_id", accountId).eq("id", documentId).is("deleted_at", null)
    .select("id, contact_id, client_group_id, category, deleted_at");
  if (error) throw new Error(`trashDocument failed: ${error.message}`);
  const row = (data ?? [])[0] as { id: string; contact_id: string | null; client_group_id: string | null; category: string; deleted_at: string } | undefined;
  if (!row) return { status: "changed" };
  await emitAfter(db, accountId, "document.trashed", actorId, { documentId: row.id, ...recordPayload(row) });
  return { status: "trashed", deletedAt: row.deleted_at };
}

/** Service client. Restores only while deleted_at still equals the instant the caller saw. */
export async function restoreDocument(
  db: SupabaseClient, accountId: string, documentId: string, expectedDeletedAt: string, actorId: string,
): Promise<CasOutcome> {
  const { data, error } = await db.from("documents")
    .update({ deleted_at: null, deleted_by: null, updated_at: new Date().toISOString() })
    .eq("account_id", accountId).eq("id", documentId).eq("deleted_at", expectedDeletedAt)
    .select("id, contact_id, client_group_id, category");
  if (error) throw new Error(`restoreDocument failed: ${error.message}`);
  const row = (data ?? [])[0] as { id: string; contact_id: string | null; client_group_id: string | null; category: string } | undefined;
  if (!row) return "changed";
  await emitAfter(db, accountId, "document.restored", actorId, { documentId: row.id, ...recordPayload(row) });
  return "updated";
}

export type SweepVersion = { id: string; account_id: string; document_id: string; storage_path: string };

/** Service client (the clean-up pass): versions still uploading, created before the cutoff, oldest first, across accounts. */
export async function listAbandonedUploads(db: SupabaseClient, cutoffIso: string, limit: number): Promise<SweepVersion[]> {
  const { data, error } = await db.from("document_versions").select("id, account_id, document_id, storage_path")
    .eq("status", "uploading").lt("created_at", cutoffIso).order("created_at", { ascending: true }).limit(limit);
  if (error) throw new Error(`listAbandonedUploads failed: ${error.message}`);
  return (data ?? []) as SweepVersion[];
}

/** Service client, AFTER its object is gone: the row, then its document if it never had a ready version. */
export async function deleteAbandonedVersion(db: SupabaseClient, v: SweepVersion): Promise<void> {
  await discardDocumentUpload(db, v.account_id, v.document_id, v.id);
}

export type PurgeCandidate = {
  id: string; account_id: string; contact_id: string | null; client_group_id: string | null; category: DocumentCategory; paths: string[];
};

/** Service client (the clean-up pass): documents trashed before the cutoff, with EVERY version's path. */
export async function listPurgeableDocuments(db: SupabaseClient, cutoffIso: string, limit: number): Promise<PurgeCandidate[]> {
  const { data, error } = await db.from("documents")
    .select("id, account_id, contact_id, client_group_id, category, versions:document_versions!document_versions_document_fkey(storage_path)")
    .not("deleted_at", "is", null).lt("deleted_at", cutoffIso).order("deleted_at", { ascending: true }).limit(limit);
  if (error) throw new Error(`listPurgeableDocuments failed: ${error.message}`);
  return ((data ?? []) as unknown as (Omit<PurgeCandidate, "paths"> & { versions: { storage_path: string }[] | null })[])
    .map(({ versions, ...d }) => ({ ...d, paths: (versions ?? []).map((v) => v.storage_path) }));
}

/** Service client, AFTER every object is gone: the row (its versions cascade), then document.purged as the system. */
export async function purgeDocumentRow(db: SupabaseClient, doc: PurgeCandidate): Promise<boolean> {
  const { data, error } = await db.from("documents").delete()
    .eq("account_id", doc.account_id).eq("id", doc.id).not("deleted_at", "is", null).select("id");
  if (error) throw new Error(`purgeDocumentRow failed: ${error.message}`);
  if ((data ?? []).length === 0) return false;
  await emitAfter(db, doc.account_id, "document.purged", "documents-sweep",
    { documentId: doc.id, ...recordPayload(doc) }, "system");
  return true;
}

/** Owner's request client (RLS-safe): how many documents a delete of these contacts takes with it, trashed ones included. A null count is a failure, never zero (memory "head-count null"). */
export async function countContactDocuments(db: SupabaseClient, accountId: string, contactIds: readonly string[]): Promise<number> {
  let total = 0;
  for (let i = 0; i < contactIds.length; i += 100) {
    const { count, error } = await db.from("documents").select("id", { count: "exact", head: true })
      .eq("account_id", accountId).in("contact_id", [...contactIds.slice(i, i + 100)]);
    if (error) throw new Error(`countContactDocuments failed: ${error.message}`);
    if (count === null) throw new Error("countContactDocuments: the count came back null");
    total += count;
  }
  return total;
}

export type ContactPurge = { purgedDocuments: number; keptContacts: string[] };

/**
 * Service client, BEFORE the contacts are deleted (owner ruling 2026-10-13: a customer's files go
 * with them; plan deviation 2 states the order). Per document: every version's object out of the
 * bucket (ONE remove call), then the row (its versions cascade), then document.purged with actor
 * `user`. A failed remove or row delete keeps that CONTACT: its remaining documents are not touched,
 * the ids are logged, and it is answered in keptContacts, so the caller does not delete it. Removing
 * an object that is already gone is not an error (plan A4), so a retry finishes what a failure left.
 */
export async function purgeContactDocuments(
  db: SupabaseClient, accountId: string, contactIds: readonly string[], actorId: string,
): Promise<ContactPurge> {
  const kept = new Set<string>();
  let purged = 0;
  for (let i = 0; i < contactIds.length; i += 100) {
    // Read EVERY document of this chunk first (paged, so PostgREST's row cap can never truncate it
    // silently), then delete: deleting while paging would shift the pages.
    type Row = { id: string; contact_id: string; versions: { storage_path: string }[] | null };
    const rows: Row[] = [];
    for (let from = 0; ; from += 500) {
      const { data, error } = await db.from("documents")
        .select("id, contact_id, versions:document_versions!document_versions_document_fkey(storage_path)")
        .eq("account_id", accountId).in("contact_id", [...contactIds.slice(i, i + 100)])
        .order("id").range(from, from + 499);
      if (error) throw new Error(`purgeContactDocuments (read) failed: ${error.message}`);
      const page = (data ?? []) as unknown as Row[];
      rows.push(...page);
      if (page.length < 500) break;
    }
    for (const d of rows) {
      if (kept.has(d.contact_id)) continue;
      const paths = (d.versions ?? []).map((v) => v.storage_path);
      if (paths.length > 0) {
        const { error: rm } = await db.storage.from(DOCUMENT_BUCKET).remove(paths);
        if (rm) {
          kept.add(d.contact_id);
          console.error(`purgeContactDocuments: account ${accountId} contact ${d.contact_id} document ${d.id}: objects not removed, contact kept: ${rm.message}`);
          continue;
        }
      }
      const { error: del } = await db.from("documents").delete().eq("account_id", accountId).eq("id", d.id);
      if (del) {
        kept.add(d.contact_id);
        console.error(`purgeContactDocuments: account ${accountId} contact ${d.contact_id} document ${d.id}: objects removed but the row was not, contact kept for the retry: ${del.message}`);
        continue;
      }
      purged++;
      await emitAfter(db, accountId, "document.purged", actorId, { documentId: d.id, contactId: d.contact_id });
    }
  }
  return { purgedDocuments: purged, keptContacts: [...kept] };
}

export type TimelineDocument = {
  id: string; title: string; category: DocumentCategory; source: DocumentSource; created_by: string;
  created_at: string; deleted_at: string | null; contact_id: string | null; client_group_id: string | null;
};
const TIMELINE_COLS = "id, title, category, source, created_by, created_at, deleted_at, contact_id, client_group_id";

/**
 * The timeline's documents source (plan deviation 3): one row per listed document, at created_at, on
 * the caller's client so RLS decides. `who` is one contact (`.eq`) or a group's members (`.in`); a
 * group page also passes its own id, and the group's own documents are a second page-read, merged by
 * record.ts (which sorts and slices every source together).
 */
export async function listDocumentTimeline(
  db: SupabaseClient, accountId: string, who: string | readonly string[], groupId: string | null, page: TimelinePageOpts,
): Promise<TimelineDocument[]> {
  const base = () => db.from("documents").select(TIMELINE_COLS).eq("account_id", accountId).not("current_version_id", "is", null);
  const reads = [withTimelinePage(forContacts(base(), "contact_id", who), "created_at", page)];
  if (groupId) reads.push(withTimelinePage(base().eq("client_group_id", groupId), "created_at", page));
  const results = await Promise.all(reads);
  const out: TimelineDocument[] = [];
  for (const { data, error } of results) {
    if (error) throw new Error(`listDocumentTimeline failed: ${error.message}`);
    out.push(...((data ?? []) as TimelineDocument[]));
  }
  return out;
}
```

- [ ] **Step 4: `deleteContacts` takes a purge hook** (deviation 2). In `packages/db/src/contacts.ts:1019-1035`, the tuple at `:1024` is UNCHANGED (documents never block); the signature and the tail become:

```ts
export async function deleteContacts(
  db: SupabaseClient, accountId: string, contactIds: string[],
  opts: {
    /** Runs on the deletable ids (blocked ones already removed) BEFORE any contact row is deleted; answers
     *  the ids it could not clear, which are then kept. The document vault's purge (0077, deviation 2). */
    beforeDelete?: (deletable: string[]) => Promise<string[]>;
  } = {},
): Promise<{ deleted: number; skippedBlocked: number; skippedFiles: number }> {
  if (contactIds.length === 0) return { deleted: 0, skippedBlocked: 0, skippedFiles: 0 };
  const blocked = new Set<string>();
  for (const table of ["opportunities", "conversations", "bookings"] as const) {
    const { data, error } = await db.from(table).select("contact_id")
      .eq("account_id", accountId).in("contact_id", contactIds);
    if (error) throw new Error(`deleteContacts ${table} pre-read failed: ${error.message}`);
    for (const r of data ?? []) if (r.contact_id) blocked.add(r.contact_id);
  }
  const deletable = contactIds.filter((id) => !blocked.has(id));
  const kept = new Set(deletable.length > 0 && opts.beforeDelete ? await opts.beforeDelete(deletable) : []);
  const go = deletable.filter((id) => !kept.has(id));
  if (go.length === 0) return { deleted: 0, skippedBlocked: blocked.size, skippedFiles: kept.size };
  const { data, error } = await db.from("contacts").delete()
    .eq("account_id", accountId).in("id", go).select("id");
  if (error) throw new Error(`deleteContacts failed: ${error.message}`);
  return { deleted: (data ?? []).length, skippedBlocked: blocked.size, skippedFiles: kept.size };
}
```

and its doc comment (`:1009-1018`) gains: "`documents (account_id, contact_id)` is NO ACTION (0077): a contact's files are purged by `beforeDelete` first (objects, then rows; owner ruling 2026-10-13), and the FK refuses the delete of any contact a purge did not clear, so no stored object is ever stranded."
- [ ] **Step 5: The barrel and the subpath.** In `packages/db/src/index.ts`, directly after the places block's `} from "./places";`:

```ts
// The document vault (0077). See ./documents.ts and ./document-rules.ts.
export {
  listRecordDocuments, getDocument, getDocumentVersion, getUploadingVersion, createDocument, reserveDocumentVersion,
  markDocumentVersionReady, discardDocumentUpload, updateDocumentField, setDocumentOwnersOnly, trashDocument, restoreDocument,
  listAbandonedUploads, deleteAbandonedVersion, listPurgeableDocuments, purgeDocumentRow, listDocumentTimeline, MAX_DOCUMENTS_READ,
  countContactDocuments, purgeContactDocuments, type ContactPurge,
  type DocumentRecordRef, type DocumentRow, type DocumentVersionRow, type ListedDocument, type RecordDocuments, type ReserveOutcome,
  type DocumentField, type CasOutcome, type SweepVersion, type PurgeCandidate, type TimelineDocument,
} from "./documents";
export {
  DOCUMENT_BUCKET, DOCUMENT_QUOTA_BYTES, DOCUMENT_MAX_BYTES, DOCUMENT_CONTENT_TYPES, DOCUMENT_CATEGORIES, DOCUMENT_SOURCES,
  DOCUMENT_TITLE_MAX, DOCUMENT_TRASH_DAYS, isDocumentCategory, isDocumentContentType,
  type DocumentCategory, type DocumentContentType, type DocumentSource,
} from "./document-rules";
```

In `packages/db/package.json`'s `exports` (`:5-13`), after `"./relationship-keys": "./src/relationship-keys.ts"`, add `"./document-rules": "./src/document-rules.ts"` (comma on the line before). Browser code (Tasks 4, 7, 9, 10) imports the rules from `@bis/db/document-rules` only, never from the `@bis/db` barrel, which carries server code.

- [ ] **Step 6: Run on the replica + PostgREST** (`documents.test.ts`, the new `contacts.test.ts` case, `places.test.ts`) → PASS. Mutation probes, each red by name: drop `.not("current_version_id", "is", null)` in `listRecordDocuments`; drop `and status = 'uploading'` in `mark_document_version_ready` (on the replica); drop the `expected` filter in `updateDocumentField`; drop `.eq("deleted_at", expectedDeletedAt)` in `restoreDocument`; `.lt` → `.gt` in `listPurgeableDocuments`; drop the group read in `listDocumentTimeline`; delete the kept ids anyway in `deleteContacts`; delete the row before the remove in `purgeContactDocuments`; `count ?? 0` in `countContactDocuments`; `documents_contact_fkey on delete cascade` on the replica (the backstop case).
- [ ] **Step 7:** `pnpm --filter @bis/db typecheck` and `pnpm --filter web typecheck` → clean.
- [ ] **Step 8: Commit.** `git add -- packages/db/src/documents.ts packages/db/src/test/documents.test.ts` then `git commit -m "feat(db): the document vault's reads, compare-and-set writes, sweep reads and timeline read (S-07 part 1)" -- packages/db/src/documents.ts packages/db/src/test/documents.test.ts packages/db/src/contacts.ts packages/db/src/test/contacts.test.ts packages/db/src/index.ts packages/db/package.json`

---

## Task 4: Pure web rules — file rules, the content check, expiry words, the load parser (bis-crm)

**Review:** sonnet. **Runs beside:** Tasks 8 and 12, after Task 3 (it imports `@bis/db/document-rules`, the subpath Task 3 adds to `packages/db/package.json`).

**Files**
- Create: `apps/web/src/lib/documents/rules.ts`, `rules.test.ts`
- Create: `apps/web/src/lib/documents/content-check.ts`, `content-check.test.ts`
- Create: `apps/web/src/lib/documents/expiry.ts`, `expiry.test.ts`
- Create: `apps/web/src/lib/documents/documents-load.ts`, `documents-load.test.ts`

**Interfaces**
- Consumes: `@bis/db/document-rules` (Task 1, subpath from Task 3); `cleanEdgeSpace`, `codePoints` (`lib/inline-rule.ts:26-29`); `t`, `plural` (`lib/i18n/t.ts:36,54`); `m`, `MessageKey` (`lib/messages.ts`).
- Produces:

```ts
// rules.ts
export const MAX_BATCH = 10;
export function extensionOf(name: string): string;                       // lowercase, no dot; "" when none
export function extensionAllowed(name: string): boolean;                 // pdf jpg jpeg png webp docx xlsx
export function typeForFile(name: string, browserType: string): DocumentContentType | null; // ext and browser type agree (browser "" accepted)
export function isImageType(t: DocumentContentType): boolean;
export function defaultCategory(t: DocumentContentType): DocumentCategory; // photo for images, other otherwise
export function titleFromFileName(name: string): string | null;          // extension off, edges cleaned, cut to 200 code points
export function formatMb(bytes: number, locale: Locale): string;         // "31 MB", "31.5 MB"
export function extensionForType(t: DocumentContentType): string;        // pdf jpg png webp docx xlsx
export const OFFICE_TYPES: readonly DocumentContentType[];               // the two never rendered inline
export function isDay(v: unknown): v is string;                          // a real YYYY-MM-DD
// content-check.ts
export function sniffDocumentType(bytes: Uint8Array): DocumentContentType | null;
export function checkDocumentBytes(bytes: Uint8Array, declared: DocumentContentType): "ok" | "mismatch";
// expiry.ts
export const EXPIRY_SOON_DAYS = 30;
export type ExpiryView = { band: "future" | "today" | "past"; days: number; soon: boolean };
export function dayDiff(from: string, to: string): number;               // whole days, YYYY-MM-DD, UTC arithmetic
export function expiryView(expiresOn: string | null, today: string): ExpiryView | null;
export function expiryText(v: ExpiryView, locale: Locale): string;
export function purgeDaysLeft(deletedAt: string, now: string): number;   // ceil, never below 0
export function purgeText(daysLeft: number, locale: Locale): string;
// documents-load.ts
export type DocumentView = {
  id: string; title: string; category: DocumentCategory; expiresOn: string | null; ownersOnly: boolean; source: DocumentSource;
  addedBy: { you: boolean; name: string | null }; createdAt: string; deletedAt: string | null;
  version: { id: string; contentType: DocumentContentType; bytes: number };
};
export type DocumentsResponse = {
  today: string; now: string; record: { kind: "contact"; id: string } | { kind: "group"; id: string; groupKind: "household" | "business" };
  live: DocumentView[]; trashed: DocumentView[]; capped: boolean;
};
export type DocumentsLoad = { status: "loading" } | { status: "error" } | { status: "ready"; data: DocumentsResponse };
export function documentsLoadFrom(res: Response): Promise<DocumentsLoad>;
```

- [ ] **Step 1: Write the failing tests.**

`apps/web/src/lib/documents/content-check.test.ts` (real byte prefixes, spec §6 "the content checker on real byte prefixes"):

```ts
import { describe, it, expect } from "vitest";
import { sniffDocumentType, checkDocumentBytes } from "./content-check";

const DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const bytes = (...xs: number[]) => new Uint8Array(xs);
const ascii = (s: string) => new TextEncoder().encode(s);

/** A minimal, valid ZIP (stored, no compression) with the named entries and a central directory. */
function zipOf(names: string[]): Uint8Array {
  const parts: number[] = [];
  const central: number[] = [];
  const le16 = (n: number) => [n & 0xff, (n >> 8) & 0xff];
  const le32 = (n: number) => [n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, (n >>> 24) & 0xff];
  for (const name of names) {
    const nb = [...ascii(name)];
    const offset = parts.length;
    parts.push(0x50, 0x4b, 0x03, 0x04, ...le16(20), ...le16(0), ...le16(0), ...le16(0), ...le16(0), ...le32(0), ...le32(0), ...le32(0),
      ...le16(nb.length), ...le16(0), ...nb);
    central.push(0x50, 0x4b, 0x01, 0x02, ...le16(20), ...le16(20), ...le16(0), ...le16(0), ...le16(0), ...le16(0), ...le32(0), ...le32(0), ...le32(0),
      ...le16(nb.length), ...le16(0), ...le16(0), ...le16(0), ...le16(0), ...le32(0), ...le32(offset), ...nb);
  }
  const cdOffset = parts.length;
  const eocd = [0x50, 0x4b, 0x05, 0x06, ...le16(0), ...le16(0), ...le16(names.length), ...le16(names.length),
    ...le32(central.length), ...le32(cdOffset), ...le16(0)];
  return new Uint8Array([...parts, ...central, ...eocd]);
}

describe("sniffDocumentType reads the leading bytes, never the name (spec 5.2)", () => {
  it.each([
    ["PDF", ascii("%PDF-1.7\n%..."), "application/pdf"],
    ["JPEG", bytes(0xff, 0xd8, 0xff, 0xe0, 0, 0x10), "image/jpeg"],
    ["PNG", bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0), "image/png"],
    ["WebP", new Uint8Array([...ascii("RIFF"), 1, 2, 3, 4, ...ascii("WEBPVP8 ")]), "image/webp"],
    ["DOCX", zipOf(["[Content_Types].xml", "_rels/.rels", "word/document.xml"]), DOCX],
    ["XLSX", zipOf(["[Content_Types].xml", "xl/workbook.xml"]), XLSX],
  ])("%s (mutation: drop its branch -> FAILS)", (_l, b, want) => {
    expect(sniffDocumentType(b)).toBe(want);
  });

  it.each([
    ["an EXE renamed .pdf", new Uint8Array([...ascii("MZ"), 0x90, 0])],
    ["a WAV (RIFF without WEBP)", new Uint8Array([...ascii("RIFF"), 1, 2, 3, 4, ...ascii("WAVEfmt ")])],
    ["SVG", ascii("<svg xmlns='http://www.w3.org/2000/svg'><script/></svg>")],
    ["HTML", ascii("<!doctype html><script>alert(1)</script>")],
    ["a plain ZIP", zipOf(["a.txt"])],
    ["a ZIP with word/ but no [Content_Types].xml", zipOf(["word/document.xml"])],
    ["HEIC", new Uint8Array([0, 0, 0, 0x18, ...ascii("ftypheic")])],
    ["empty", new Uint8Array()],
    ["a truncated PDF magic", ascii("%PD")],
  ])("refuses %s (mutation: accept any ZIP as DOCX -> FAILS on the plain ZIP)", (_l, b) => {
    expect(sniffDocumentType(b)).toBeNull();
  });
});

describe("checkDocumentBytes compares with the DECLARED type (spec 5.2)", () => {
  it("a PNG declared as JPEG is a mismatch; a PNG declared PNG is ok (mutation: return ok when both are images -> FAILS)", () => {
    const png = bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);
    expect(checkDocumentBytes(png, "image/jpeg")).toBe("mismatch");
    expect(checkDocumentBytes(png, "image/png")).toBe("ok");
    expect(checkDocumentBytes(zipOf(["[Content_Types].xml", "xl/workbook.xml"]), DOCX)).toBe("mismatch");
  });
});
```

`apps/web/src/lib/documents/expiry.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { m } from "@/lib/messages";
import { expiryView, expiryText, purgeDaysLeft, purgeText, dayDiff } from "./expiry";

describe("expiry in words (spec 4.1), each band in both languages", () => {
  const TODAY = "2026-10-13";
  it("dayDiff is calendar days, across a month end and the spring-forward night, in a zone that HAS one (mutation: Math.floor of the local-midnight difference -> FAILS on 2026-03-09)", () => {
    // Pinned here, not inherited: vitest's TZ may be UTC, where no local-time mutation can fail.
    const tz = process.env.TZ;
    process.env.TZ = "America/Chicago";
    try {
      expect(dayDiff("2026-03-07", "2026-03-09")).toBe(2);   // 47 local hours
      expect(dayDiff("2026-10-31", "2026-11-02")).toBe(2);
    } finally {
      process.env.TZ = tz;
    }
    expect(dayDiff("2026-10-13", "2026-10-25")).toBe(12);
    expect(dayDiff("2026-10-13", "2026-10-10")).toBe(-3);
  });
  it("future, 31 days out: not soon (no dot); 30 days: soon (mutation: soon = days < 30 -> FAILS)", () => {
    expect(expiryView("2026-11-13", TODAY)).toEqual({ band: "future", days: 31, soon: false });
    expect(expiryView("2026-11-12", TODAY)).toEqual({ band: "future", days: 30, soon: true });
  });
  it("words: in 12 days, in 1 day, today, 3 days ago, 1 day ago (mutation: swap the One forms -> FAILS)", () => {
    const en = (d: string) => expiryText(expiryView(d, TODAY)!, "en");
    const es = (d: string) => expiryText(expiryView(d, TODAY)!, "es");
    expect(en("2026-10-25")).toBe("Expires in 12 days");
    expect(en("2026-10-14")).toBe("Expires in 1 day");
    expect(en("2026-10-13")).toBe("Expires today");
    expect(en("2026-10-10")).toBe("Expired 3 days ago");
    expect(en("2026-10-12")).toBe("Expired 1 day ago");
    expect(es("2026-10-25")).toBe(m["documents.expires.in.es"].replace("{count}", "12"));
    expect(es("2026-10-13")).toBe(m["documents.expires.today.es"]);
    expect(es("2026-10-10")).toBe(m["documents.expires.ago.es"].replace("{count}", "3"));
    expect(expiryView("2026-10-10", TODAY)).toMatchObject({ band: "past", soon: true });
    expect(expiryView(null, TODAY)).toBeNull();
  });
  it("purge: trashed 3 days ago has 27 days left; past the 30 days reads today (mutation: Math.floor -> FAILS)", () => {
    expect(purgeDaysLeft("2026-10-10T12:00:00.000Z", "2026-10-13T11:00:00.000Z")).toBe(28);
    expect(purgeDaysLeft("2026-10-10T12:00:00.000Z", "2026-10-13T12:00:00.000Z")).toBe(27);
    expect(purgeDaysLeft("2026-09-01T00:00:00.000Z", "2026-10-13T00:00:00.000Z")).toBe(0);
    expect(purgeText(27, "en")).toBe("Deleted for good in 27 days");
    expect(purgeText(1, "es")).toBe(m["documents.purgeInOne.es"].replace("{count}", "1"));
    expect(purgeText(0, "en")).toBe("Deleted for good today");
  });
});
```

`apps/web/src/lib/documents/rules.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { typeForFile, extensionAllowed, titleFromFileName, defaultCategory, formatMb, isDay } from "./rules";

describe("file rules (spec 4.2, 5.1)", () => {
  it("the extension and the browser's type must agree; an unknown or empty browser type defers to the extension (mutation: ignore the browser type -> FAILS)", () => {
    expect(typeForFile("Contract.PDF", "application/pdf")).toBe("application/pdf");
    expect(typeForFile("lease.docx", "")).toBe("application/vnd.openxmlformats-officedocument.wordprocessingml.document");
    expect(typeForFile("photo.jpg", "image/png")).toBeNull();
    expect(typeForFile("photo.heic", "image/heic")).toBeNull();
    expect(typeForFile("page.html", "text/html")).toBeNull();
    expect(typeForFile("logo.svg", "image/svg+xml")).toBeNull();
    expect(extensionAllowed("x.webp")).toBe(true);
    expect(extensionAllowed("x.exe")).toBe(false);
  });
  it("a title is the name without its extension, cleaned, at most 200 characters (mutation: keep the extension -> FAILS)", () => {
    expect(titleFromFileName("  Signed lease.pdf ")).toBe("Signed lease");
    expect(titleFromFileName("archive.tar.pdf")).toBe("archive.tar");
    expect(titleFromFileName(".pdf")).toBeNull();
    expect([...titleFromFileName(`${"é".repeat(250)}.pdf`)!].length).toBe(200);
  });
  it("images default to Photo, everything else to Other; sizes read in MB (mutation: default every file to other -> FAILS)", () => {
    expect(defaultCategory("image/webp")).toBe("photo");
    expect(defaultCategory("application/pdf")).toBe("other");
    expect(formatMb(31 * 1048576, "en")).toBe("31 MB");
    expect(formatMb(Math.round(25.5 * 1048576), "en")).toBe("25.5 MB");
    expect(isDay("2026-02-30")).toBe(false);
    expect(isDay("2026-02-28")).toBe(true);
  });
});
```

`apps/web/src/lib/documents/documents-load.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { documentsLoadFrom, type DocumentsResponse } from "./documents-load";

const view = {
  id: "d1", title: "Lease", category: "contract", expiresOn: "2026-11-01", ownersOnly: false, source: "upload",
  addedBy: { you: false, name: "Ana" }, createdAt: "2026-10-01T00:00:00Z", deletedAt: null,
  version: { id: "v1", contentType: "application/pdf", bytes: 1200 },
};
const body: DocumentsResponse = {
  today: "2026-10-13", now: "2026-10-13T15:00:00.000Z", record: { kind: "contact", id: "c1" },
  live: [view as DocumentsResponse["live"][number]], trashed: [], capped: false,
};
const res = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { "content-type": "application/json" } });

describe("documentsLoadFrom: anything but a well-formed 200 is the card's error state (places-load's rule)", () => {
  it("parses a good body", async () => {
    expect(await documentsLoadFrom(res(body))).toEqual({ status: "ready", data: body });
  });
  it.each([
    ["a 500", res({}, 500)],
    ["a category outside the nine", res({ ...body, live: [{ ...view, category: "receipt" }] })],
    ["an SVG version", res({ ...body, live: [{ ...view, version: { ...view.version, contentType: "image/svg+xml" } }] })],
    ["a bad expiry day", res({ ...body, live: [{ ...view, expiresOn: "2026-13-01" }] })],
    ["no today", res({ ...body, today: undefined })],
  ])("refuses %s (mutation: skip the version check -> FAILS on the SVG case)", async (_l, r) => {
    expect(await documentsLoadFrom(r)).toEqual({ status: "error" });
  });
});
```

- [ ] **Step 2: Run, see each file fail** (modules missing): `pnpm --filter web exec vitest run src/lib/documents`.
- [ ] **Step 3: Write the four modules.**

`apps/web/src/lib/documents/rules.ts`:

```ts
import {
  DOCUMENT_TITLE_MAX, type DocumentCategory, type DocumentContentType,
} from "@bis/db/document-rules";
import { cleanEdgeSpace } from "@/lib/inline-rule";
import type { Locale } from "@/lib/i18n/locale";

/** Spec 4.2: up to 10 files open the panel at once. */
export const MAX_BATCH = 10;

const DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document" as const;
const XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" as const;
const BY_EXTENSION: Readonly<Record<string, DocumentContentType>> = {
  pdf: "application/pdf", jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", docx: DOCX, xlsx: XLSX,
};
const EXTENSION_FOR: Readonly<Record<DocumentContentType, string>> = {
  "application/pdf": "pdf", "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", [DOCX]: "docx", [XLSX]: "xlsx",
};
/** Word and Excel files are never rendered; the viewer offers Download only (spec 4.3). */
export const OFFICE_TYPES: readonly DocumentContentType[] = [DOCX, XLSX];

export function extensionOf(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot < 0 ? "" : name.slice(dot + 1).trim().toLowerCase();
}
export const extensionAllowed = (name: string): boolean => Object.hasOwn(BY_EXTENSION, extensionOf(name));
export const extensionForType = (t: DocumentContentType): string => EXTENSION_FOR[t];

/** The type a chosen file declares: its extension decides, and a browser type that disagrees refuses it. */
export function typeForFile(name: string, browserType: string): DocumentContentType | null {
  const ext = extensionOf(name);
  if (!Object.hasOwn(BY_EXTENSION, ext)) return null;
  const byExt = BY_EXTENSION[ext]!;
  return browserType === "" || browserType === byExt ? byExt : null;
}

export const isImageType = (t: DocumentContentType): boolean => t.startsWith("image/");
export const defaultCategory = (t: DocumentContentType): DocumentCategory => (isImageType(t) ? "photo" : "other");

/** The name without its extension, edges cleaned, cut to 200 code points; null when nothing is left. */
export function titleFromFileName(name: string): string | null {
  const trimmed = cleanEdgeSpace(name);
  const dot = trimmed.lastIndexOf(".");
  const base = cleanEdgeSpace(dot > 0 ? trimmed.slice(0, dot) : dot === 0 ? "" : trimmed);
  if (!base) return null;
  return cleanEdgeSpace([...base].slice(0, DOCUMENT_TITLE_MAX).join("")) || null;
}

export function formatMb(bytes: number, locale: Locale): string {
  const n = new Intl.NumberFormat(locale === "es" ? "es-US" : "en-US", { maximumFractionDigits: 1 }).format(bytes / 1048576);
  return `${n} MB`;
}

const DAY = /^(\d{4})-(\d{2})-(\d{2})$/;
export function isDay(v: unknown): v is string {
  if (typeof v !== "string") return false;
  const p = DAY.exec(v);
  if (!p) return false;
  const at = new Date(Date.UTC(Number(p[1]), Number(p[2]) - 1, Number(p[3])));
  return at.getUTCFullYear() === Number(p[1]) && at.getUTCMonth() === Number(p[2]) - 1 && at.getUTCDate() === Number(p[3]);
}
```

`apps/web/src/lib/documents/content-check.ts`:

```ts
import type { DocumentContentType } from "@bis/db/document-rules";

/**
 * What a stored file IS, from its leading bytes (spec 5.2), never from its name or the browser's
 * word for it; validate-logo.ts's allowlist shape (lib/branding/validate-logo.ts:16-31). SVG and
 * HTML have no branch, so they are refused like everything else that is not provably one of six.
 * DOCX and XLSX are ZIPs: the central directory (whose entry names are stored uncompressed) must
 * name [Content_Types].xml and an entry under word/ or xl/ (plan deviation 7).
 */
const DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

function startsWith(b: Uint8Array, sig: readonly number[], offset = 0): boolean {
  return b.length >= offset + sig.length && sig.every((x, i) => b[offset + i] === x);
}
const u16 = (b: Uint8Array, o: number) => b[o]! | (b[o + 1]! << 8);
const u32 = (b: Uint8Array, o: number) => (b[o]! | (b[o + 1]! << 8) | (b[o + 2]! << 16) | (b[o + 3]! << 24)) >>> 0;

/** Entry names from the ZIP's central directory; null when it is not a well-formed ZIP. */
function zipEntryNames(b: Uint8Array): string[] | null {
  // The end-of-central-directory record sits in the last 22 + 65535 bytes (its comment is at most 65535).
  const floor = Math.max(0, b.length - 22 - 65535);
  let eocd = -1;
  for (let i = b.length - 22; i >= floor; i--) {
    if (startsWith(b, [0x50, 0x4b, 0x05, 0x06], i)) { eocd = i; break; }
  }
  if (eocd < 0) return null;
  const count = u16(b, eocd + 10);
  let at = u32(b, eocd + 16);
  const names: string[] = [];
  const decoder = new TextDecoder("utf-8", { fatal: false });
  for (let n = 0; n < count; n++) {
    if (!startsWith(b, [0x50, 0x4b, 0x01, 0x02], at) || at + 46 > b.length) return null;
    const nameLen = u16(b, at + 28), extraLen = u16(b, at + 30), commentLen = u16(b, at + 32);
    if (at + 46 + nameLen > b.length) return null;
    names.push(decoder.decode(b.subarray(at + 46, at + 46 + nameLen)));
    at += 46 + nameLen + extraLen + commentLen;
  }
  return names;
}

export function sniffDocumentType(bytes: Uint8Array): DocumentContentType | null {
  if (startsWith(bytes, [0x25, 0x50, 0x44, 0x46, 0x2d])) return "application/pdf";            // %PDF-
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return "image/jpeg";
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png";
  if (startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) && startsWith(bytes, [0x57, 0x45, 0x42, 0x50], 8)) return "image/webp";
  if (startsWith(bytes, [0x50, 0x4b, 0x03, 0x04])) {
    const names = zipEntryNames(bytes);
    if (!names || !names.includes("[Content_Types].xml")) return null;
    if (names.some((n) => n.startsWith("word/"))) return DOCX;
    if (names.some((n) => n.startsWith("xl/"))) return XLSX;
  }
  return null;
}

export function checkDocumentBytes(bytes: Uint8Array, declared: DocumentContentType): "ok" | "mismatch" {
  return sniffDocumentType(bytes) === declared ? "ok" : "mismatch";
}
```

`apps/web/src/lib/documents/expiry.ts`:

```ts
import { DOCUMENT_TRASH_DAYS } from "@bis/db/document-rules";
import { m } from "@/lib/messages";
import { t, plural } from "@/lib/i18n/t";
import type { Locale } from "@/lib/i18n/locale";

/** Spec 4.1: 30 days away or less, or past, is a dot and the word (rule 3). */
export const EXPIRY_SOON_DAYS = 30;
export type ExpiryView = { band: "future" | "today" | "past"; days: number; soon: boolean };
const DAY_MS = 86_400_000;

/** Whole calendar days from `from` to `to` (both YYYY-MM-DD), on UTC midnights so a DST change never shifts it. */
export function dayDiff(from: string, to: string): number {
  const at = (d: string) => Date.UTC(Number(d.slice(0, 4)), Number(d.slice(5, 7)) - 1, Number(d.slice(8, 10)));
  return Math.round((at(to) - at(from)) / DAY_MS);
}

/** `today` is the ACCOUNT's day (accountToday), never the browser's. */
export function expiryView(expiresOn: string | null, today: string): ExpiryView | null {
  if (!expiresOn) return null;
  const d = dayDiff(today, expiresOn);
  if (d === 0) return { band: "today", days: 0, soon: true };
  if (d < 0) return { band: "past", days: -d, soon: true };
  return { band: "future", days: d, soon: d <= EXPIRY_SOON_DAYS };
}

export function expiryText(v: ExpiryView, locale: Locale): string {
  if (v.band === "today") return t(m, "documents.expires.today", locale);
  return plural(m, v.band === "future" ? "documents.expires.in" : "documents.expires.ago", v.days, locale, { count: v.days });
}

/** Days until the clean-up pass purges a file trashed at `deletedAt` (spec 4.4), counted from the server's `now`. */
export function purgeDaysLeft(deletedAt: string, now: string): number {
  const left = (Date.parse(deletedAt) + DOCUMENT_TRASH_DAYS * DAY_MS - Date.parse(now)) / DAY_MS;
  return Math.max(0, Math.ceil(left));
}

export function purgeText(daysLeft: number, locale: Locale): string {
  return daysLeft <= 0 ? t(m, "documents.purgeToday", locale) : plural(m, "documents.purgeIn", daysLeft, locale, { count: daysLeft });
}
```

(`plural` picks the form from `count` but interpolates only `params`, so `{ count }` is passed explicitly, as `makeTr` does, `lib/record/copy.ts:20`.)

`apps/web/src/lib/documents/documents-load.ts`:

```ts
import {
  isDocumentCategory, isDocumentContentType, type DocumentCategory, type DocumentContentType, type DocumentSource,
} from "@bis/db/document-rules";
import { isDay } from "./rules";

/**
 * The Documents card's own read (spec 4.5: it loads and fails on its own), the route's response
 * parsed. Anything but a well-formed 200 is the card's error state (lib/contacts/places-load.ts's rule),
 * so a server newer than this tab's bundle gets "Couldn't load documents." instead of a row that throws.
 * The author's Clerk id never travels: the route sends `addedBy` already resolved.
 */
export type DocumentView = {
  id: string; title: string; category: DocumentCategory; expiresOn: string | null; ownersOnly: boolean; source: DocumentSource;
  addedBy: { you: boolean; name: string | null }; createdAt: string; deletedAt: string | null;
  version: { id: string; contentType: DocumentContentType; bytes: number };
};
export type DocumentsResponse = {
  today: string; now: string;
  record: { kind: "contact"; id: string } | { kind: "group"; id: string; groupKind: "household" | "business" };
  live: DocumentView[]; trashed: DocumentView[]; capped: boolean;
};
export type DocumentsLoad = { status: "loading" } | { status: "error" } | { status: "ready"; data: DocumentsResponse };

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown): v is string => typeof v === "string" && v.length > 0;
const instant = (v: unknown) => str(v) && !Number.isNaN(Date.parse(v));

function isView(v: unknown, trashed: boolean): boolean {
  if (!isObj(v) || !isObj(v.addedBy) || !isObj(v.version)) return false;
  return str(v.id) && typeof v.title === "string" && isDocumentCategory(v.category)
    && (v.expiresOn === null || isDay(v.expiresOn)) && typeof v.ownersOnly === "boolean"
    && (v.source === "upload" || v.source === "camera")
    && typeof v.addedBy.you === "boolean" && (v.addedBy.name === null || typeof v.addedBy.name === "string")
    && instant(v.createdAt) && (trashed ? instant(v.deletedAt) : v.deletedAt === null)
    && str(v.version.id) && isDocumentContentType(v.version.contentType)
    && typeof v.version.bytes === "number" && v.version.bytes > 0;
}

function isRecord(v: unknown): boolean {
  if (!isObj(v) || !str(v.id)) return false;
  return v.kind === "contact" || (v.kind === "group" && (v.groupKind === "household" || v.groupKind === "business"));
}

export async function documentsLoadFrom(res: Response): Promise<DocumentsLoad> {
  if (!res.ok) return { status: "error" };
  let body: unknown;
  try { body = await res.json(); } catch { return { status: "error" }; }
  if (!isObj(body)) return { status: "error" };
  const ok = isDay(body.today) && instant(body.now) && isRecord(body.record)
    && Array.isArray(body.live) && body.live.every((x) => isView(x, false))
    && Array.isArray(body.trashed) && body.trashed.every((x) => isView(x, true))
    && typeof body.capped === "boolean";
  return ok ? { status: "ready", data: body as DocumentsResponse } : { status: "error" };
}
```

- [ ] **Step 4: Run** `pnpm --filter web exec vitest run src/lib/documents` → PASS; each mutation named in a test title red by name, then reverted.
- [ ] **Step 5: Commit.** `git add -- apps/web/src/lib/documents` then `git commit -m "feat(documents): file rules, the leading-bytes check, expiry words and the card's load parser (S-07 part 1)" -- apps/web/src/lib/documents/rules.ts apps/web/src/lib/documents/rules.test.ts apps/web/src/lib/documents/content-check.ts apps/web/src/lib/documents/content-check.test.ts apps/web/src/lib/documents/expiry.ts apps/web/src/lib/documents/expiry.test.ts apps/web/src/lib/documents/documents-load.ts apps/web/src/lib/documents/documents-load.test.ts`

---

## Task 5: The server actions (bis-crm)

**Review:** opus.

**Files**
- Create: `…/accounts/contacts/documents-actions.ts`, `documents-actions.test.ts`
- Modify: `…/accounts/in-account-service-reads.test.ts:62-120` (one `ALLOWED` line, alphabetical, after `contacts/actions.ts`)

**Interfaces**
- Consumes: Task 3's `@bis/db` functions; Task 4's `rules`, `content-check`; `requireAccountAccess` (`lib/auth.ts:36-61`: `{ userId, isAgency, role, canManage }`, `canManage` true for the agency and an Owner); `dbForRequest` (`lib/db.ts:21`); `getContact` (`contacts.ts:810`), `readGroup` (`client-groups.ts:154`); `isUuid` (`lib/assign/action-guards.ts`); `validateInlineRule` (`lib/inline-rule.ts:40`); `loggableError`.
- Produces (every answer `{ ok: true, … } | { ok: false; error: MessageKey string; params? }`; nothing throws except `requireAccountAccess`'s redirect, the convention of every action in this tree):

```ts
export type DocRecordArg = { kind: "contact" | "group"; id: string };
export type DocFail = { ok: false; error: string; params?: Record<string, string | number> };
export type StartUploadInput = {
  record: DocRecordArg; name: string; title: string; size: number; contentType: string;
  category: string; expiresOn: string | null; ownersOnly: boolean; source: "upload" | "camera";
};
export function startDocumentUploadAction(accountId: string, input: StartUploadInput): Promise<{ ok: true; documentId: string; versionId: string; uploadUrl: string } | DocFail>;
export function finishDocumentUploadAction(accountId: string, documentId: string, versionId: string): Promise<{ ok: true } | DocFail>;
export function abandonDocumentUploadAction(accountId: string, documentId: string, versionId: string): Promise<{ ok: true } | DocFail>;
export function getDocumentUrlAction(accountId: string, versionId: string, mode: "view" | "download"): Promise<{ ok: true; url: string; contentType: DocumentContentType } | DocFail>;
export type DocumentUndo = { documentId: string; field: "title" | "category" | "expires_on"; prior: string | null; written: string | null };
export function updateDocumentFieldAction(accountId: string, documentId: string, field: DocumentUndo["field"], raw: string): Promise<{ ok: true; shown: string; undoPayload: DocumentUndo } | DocFail>;
export function undoDocumentFieldAction(accountId: string, payload: unknown): Promise<{ ok: true } | DocFail>;
export function setOwnersOnlyAction(accountId: string, documentId: string, value: boolean): Promise<{ ok: true; prior: boolean } | DocFail>;
export function undoOwnersOnlyAction(accountId: string, documentId: string, prior: boolean, written: boolean): Promise<{ ok: true } | DocFail>;
export function trashDocumentAction(accountId: string, documentId: string): Promise<{ ok: true; deletedAt: string } | DocFail>;
export function restoreDocumentAction(accountId: string, documentId: string, expectedDeletedAt: string): Promise<{ ok: true } | DocFail>;
```

- [ ] **Step 1: Write the failing test** `…/accounts/contacts/documents-actions.test.ts` (the places-actions test's harness shape, `places-actions.test.ts:1-70`: the request client is a sentinel by identity, the service client another, and every `@bis/db` function a `vi.fn`):

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

type Access = { userId: string; isAgency: boolean; role: "owner" | "staff" | "technician" | null; canManage: boolean };
const requireAccountAccess = vi.fn<(id: string) => Promise<Access>>();
vi.mock("@/lib/auth", () => ({ requireAccountAccess: (id: string) => requireAccountAccess(id) }));
const REQUEST = { tag: "request-db" };
vi.mock("@/lib/db", () => ({ dbForRequest: async () => REQUEST }));

const storage = {
  createSignedUploadUrl: vi.fn(), download: vi.fn(), remove: vi.fn(), createSignedUrl: vi.fn(),
};
const SERVICE = { tag: "service-db", storage: { from: vi.fn(() => storage) } };
const db = {
  getContact: vi.fn(), readGroup: vi.fn(), getDocument: vi.fn(), getDocumentVersion: vi.fn(), getUploadingVersion: vi.fn(),
  createDocument: vi.fn(), reserveDocumentVersion: vi.fn(), markDocumentVersionReady: vi.fn(), discardDocumentUpload: vi.fn(),
  updateDocumentField: vi.fn(), setDocumentOwnersOnly: vi.fn(), trashDocument: vi.fn(), restoreDocument: vi.fn(),
  serviceDb: vi.fn(() => SERVICE),
};
vi.mock("@bis/db", async (importOriginal) => {
  const real = await importOriginal<typeof import("@bis/db")>();
  return { ...db, DOCUMENT_BUCKET: real.DOCUMENT_BUCKET, DOCUMENT_MAX_BYTES: real.DOCUMENT_MAX_BYTES,
    isDocumentCategory: real.isDocumentCategory, isDocumentContentType: real.isDocumentContentType };
});
const A = await import("./documents-actions");

const ACC = "44444444-4444-4444-8444-444444444444";
const C = "11111111-1111-4111-8111-111111111111";
const D = "22222222-2222-4222-8222-222222222222";
const V = "33333333-3333-4333-8333-333333333333";
const OWNER: Access = { userId: "user_owner", isAgency: false, role: "owner", canManage: true };
const STAFF: Access = { userId: "user_staff", isAgency: false, role: "staff", canManage: false };
const PDF = new TextEncoder().encode("%PDF-1.7 hello");
const DOC = { id: D, account_id: ACC, contact_id: C, client_group_id: null, title: "Lease", category: "contract", expires_on: null,
  owners_only: false, source: "upload", current_version_id: null, created_by: "user_owner", created_at: "2026-10-01T00:00:00Z",
  updated_at: "2026-10-01T00:00:00Z", deleted_at: null, deleted_by: null };
const input = (over: Partial<Parameters<typeof A.startDocumentUploadAction>[1]> = {}) => ({
  record: { kind: "contact" as const, id: C }, name: "Lease.pdf", title: "Lease", size: 1200, contentType: "application/pdf",
  category: "contract", expiresOn: null, ownersOnly: false, source: "upload" as const, ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  requireAccountAccess.mockResolvedValue(OWNER);
  db.getContact.mockResolvedValue({ id: C });
  db.createDocument.mockResolvedValue(D);
  db.reserveDocumentVersion.mockResolvedValue({ status: "ok", versionId: V, storagePath: `${ACC}/${D}/${V}` });
  storage.createSignedUploadUrl.mockResolvedValue({ data: { signedUrl: "https://x/upload?token=t", token: "t", path: "p" }, error: null });
  db.getDocument.mockResolvedValue(DOC);
  db.getUploadingVersion.mockResolvedValue({ id: V, document_id: D, account_id: ACC, storage_path: `${ACC}/${D}/${V}`, bytes: PDF.length, content_type: "application/pdf", original_name: "Lease.pdf", status: "uploading", created_at: "x" });
  storage.download.mockResolvedValue({ data: new Blob([PDF], { type: "application/pdf" }), error: null });
  storage.remove.mockResolvedValue({ data: [], error: null });
  db.markDocumentVersionReady.mockResolvedValue(true);
});

describe("startDocumentUploadAction (spec 5.1)", () => {
  it("proves the record on the REQUEST client before any service write, and returns the signed upload URL (mutation: skip getContact -> FAILS)", async () => {
    expect(await A.startDocumentUploadAction(ACC, input())).toEqual({ ok: true, documentId: D, versionId: V, uploadUrl: "https://x/upload?token=t" });
    expect(db.getContact).toHaveBeenCalledWith(REQUEST, ACC, C);
    expect(db.getContact.mock.invocationCallOrder[0]!).toBeLessThan(db.createDocument.mock.invocationCallOrder[0]!);
    expect(db.createDocument.mock.calls[0]![0]).toBe(SERVICE);
    expect(storage.createSignedUploadUrl).toHaveBeenCalledWith(`${ACC}/${D}/${V}`);
  });
  it("a record the caller cannot see is 'not found' and writes nothing (mutation: treat a null getContact as visible -> FAILS)", async () => {
    db.getContact.mockResolvedValue(null);
    expect(await A.startDocumentUploadAction(ACC, input())).toEqual({ ok: false, error: "documents.error.notFound" });
    expect(db.createDocument).not.toHaveBeenCalled();
  });
  it("a group record is proven with readGroup (mutation: prove every record with getContact -> FAILS)", async () => {
    db.readGroup.mockResolvedValue({ id: D, kind: "household", name: "Casa", billingAddress: null });
    await A.startDocumentUploadAction(ACC, input({ record: { kind: "group", id: D } }));
    expect(db.readGroup).toHaveBeenCalledWith(REQUEST, ACC, D);
    expect(db.getContact).not.toHaveBeenCalled();
  });
  it("Owners only from Staff is refused before any read (mutation: drop the canManage check -> FAILS)", async () => {
    requireAccountAccess.mockResolvedValue(STAFF);
    expect(await A.startDocumentUploadAction(ACC, input({ ownersOnly: true }))).toEqual({ ok: false, error: "documents.error.ownersOnlyRole" });
    expect(db.createDocument).not.toHaveBeenCalled();
  });
  it.each([
    ["oversize", input({ size: 26_214_401 }), { ok: false, error: "documents.error.tooLarge", params: { size: "25 MB" } }],
    ["a disallowed type", input({ name: "x.svg", contentType: "image/svg+xml" }), { ok: false, error: "documents.error.badType" }],
    ["an allowed type with a disallowed extension", input({ name: "x.exe" }), { ok: false, error: "documents.error.badType" }],
    ["an unknown category", input({ category: "receipt" }), { ok: false, error: "documents.error.refused" }],
    ["a bad expiry", input({ expiresOn: "2026-02-30" }), { ok: false, error: "documents.error.refused" }],
  ])("refuses %s without writing (mutation: drop that check -> FAILS)", async (_l, i, want) => {
    expect(await A.startDocumentUploadAction(ACC, i)).toEqual(want);
    expect(db.createDocument).not.toHaveBeenCalled();
  });
  it("quota full: the empty document is removed and the answer is the quota sentence (mutation: leave the document -> FAILS)", async () => {
    db.reserveDocumentVersion.mockResolvedValue({ status: "over_quota" });
    expect(await A.startDocumentUploadAction(ACC, input())).toEqual({ ok: false, error: "documents.error.quota" });
    expect(db.discardDocumentUpload).toHaveBeenCalledWith(SERVICE, ACC, D, null);
  });
});

describe("finishDocumentUploadAction (spec 5.1, 5.2)", () => {
  it("checks the real bytes against the reserved size and the stored type, hashes them, and marks the version ready (mutation: skip the size comparison -> FAILS on the next case)", async () => {
    expect(await A.finishDocumentUploadAction(ACC, D, V)).toEqual({ ok: true });
    const call = db.markDocumentVersionReady.mock.calls[0]![1] as { bytes: number; sha256: string };
    expect(call.bytes).toBe(PDF.length);
    expect(call.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(db.getDocument).toHaveBeenCalledWith(REQUEST, ACC, D);
  });
  it.each([
    ["a missing object", () => storage.download.mockResolvedValue({ data: null, error: { message: "not found" } }), "documents.error.upload"],
    ["a stored size other than the reserved size (an understated size; mutation: drop the size comparison -> FAILS)",
      () => storage.download.mockResolvedValue({ data: new Blob([PDF, new Uint8Array(1)], { type: "application/pdf" }), error: null }), "documents.error.upload"],
    ["a type mismatch (an EXE named .pdf)", () => storage.download.mockResolvedValue({ data: new Blob([new TextEncoder().encode("MZ\u0090".padEnd(PDF.length, " "))], { type: "application/pdf" }), error: null }), "documents.error.badType"],
    ["a stored content type other than the declared one (mutation: drop the blob.type comparison -> FAILS)",
      () => storage.download.mockResolvedValue({ data: new Blob([PDF], { type: "image/png" }), error: null }), "documents.error.badType"],
  ])("%s: the object, then the version and the never-ready document, are removed (mutation: skip the cleanup -> FAILS)", async (_l, arrange, error) => {
    arrange();
    expect(await A.finishDocumentUploadAction(ACC, D, V)).toEqual({ ok: false, error });
    expect(storage.remove).toHaveBeenCalledWith([`${ACC}/${D}/${V}`]);
    expect(db.discardDocumentUpload).toHaveBeenCalledWith(SERVICE, ACC, D, V);
    expect(db.markDocumentVersionReady).not.toHaveBeenCalled();
  });
  it("a storage removal that fails leaves the rows for the sweep (plan review I3; mutation: discard the rows anyway -> FAILS)", async () => {
    storage.download.mockResolvedValue({ data: new Blob([PDF, new Uint8Array(1)], { type: "application/pdf" }), error: null });
    storage.remove.mockResolvedValue({ data: null, error: { message: "storage down" } });
    expect(await A.finishDocumentUploadAction(ACC, D, V)).toEqual({ ok: false, error: "documents.error.upload" });
    expect(db.discardDocumentUpload).not.toHaveBeenCalled();
  });
  it("no uploading row and no row at all: the derivable path is removed; a READY row is never touched (mutation: remove the path when a ready row exists -> FAILS)", async () => {
    db.getUploadingVersion.mockResolvedValue(null);
    db.getDocumentVersion.mockResolvedValue(null);
    expect(await A.finishDocumentUploadAction(ACC, D, V)).toEqual({ ok: false, error: "documents.error.refused" });
    expect(storage.remove).toHaveBeenCalledWith([`${ACC}/${D}/${V}`]);
    expect(db.discardDocumentUpload).toHaveBeenCalledWith(SERVICE, ACC, D, null);
    vi.clearAllMocks();
    db.getDocument.mockResolvedValue(DOC);
    db.getUploadingVersion.mockResolvedValue(null);
    db.getDocumentVersion.mockResolvedValue({ id: V, document_id: D, status: "ready" });
    expect(await A.finishDocumentUploadAction(ACC, D, V)).toEqual({ ok: false, error: "documents.error.refused" });
    expect(storage.remove).not.toHaveBeenCalled();
  });
  it("a document the caller cannot see is refused before the service read (mutation: read the version first -> FAILS)", async () => {
    db.getDocument.mockResolvedValue(null);
    expect(await A.finishDocumentUploadAction(ACC, D, V)).toEqual({ ok: false, error: "documents.error.refused" });
    expect(db.getUploadingVersion).not.toHaveBeenCalled();
  });
});

describe("getDocumentUrlAction (spec 5.1)", () => {
  it("refuses a version the reader cannot see (RLS read on the request client) and mints nothing (mutation: read the version on the service client -> FAILS)", async () => {
    db.getDocumentVersion.mockResolvedValue(null);
    expect(await A.getDocumentUrlAction(ACC, V, "view")).toEqual({ ok: false, error: "documents.error.refused" });
    expect(db.getDocumentVersion).toHaveBeenCalledWith(REQUEST, ACC, V);
    expect(storage.createSignedUrl).not.toHaveBeenCalled();
  });
  it("mints 120 seconds; Word is always a download named after the title (mutation: mint Word inline -> FAILS)", async () => {
    db.getDocumentVersion.mockResolvedValue({ id: V, document_id: D, account_id: ACC, storage_path: "p", bytes: 1, status: "ready", original_name: null, created_at: "x",
      content_type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" });
    storage.createSignedUrl.mockResolvedValue({ data: { signedUrl: "https://x/sign" }, error: null });
    expect(await A.getDocumentUrlAction(ACC, V, "view")).toMatchObject({ ok: true, url: "https://x/sign" });
    expect(storage.createSignedUrl).toHaveBeenCalledWith("p", 120, { download: "Lease.docx" });
  });
});

describe("inline edits and their compare-and-set Undo (spec 4.1)", () => {
  it("the save answers the stored value and an Undo payload of prior and written (mutation: undoPayload.prior = the new value -> FAILS)", async () => {
    db.updateDocumentField.mockResolvedValue("updated");
    expect(await A.updateDocumentFieldAction(ACC, D, "title", "  Signed lease ")).toEqual({
      ok: true, shown: "Signed lease", undoPayload: { documentId: D, field: "title", prior: "Lease", written: "Signed lease" } });
    expect(db.updateDocumentField).toHaveBeenCalledWith(SERVICE, ACC, D, "title", "Signed lease");
  });
  it("Undo writes the prior value only where the written one still stands; otherwise says so (mutation: call without expected -> FAILS)", async () => {
    db.updateDocumentField.mockResolvedValue("changed");
    expect(await A.undoDocumentFieldAction(ACC, { documentId: D, field: "title", prior: "Lease", written: "Signed lease" }))
      .toEqual({ ok: false, error: "documents.undoChanged" });
    expect(db.updateDocumentField).toHaveBeenCalledWith(SERVICE, ACC, D, "title", "Lease", { value: "Signed lease" });
  });
  it("a forged Undo payload is refused before any read (mutation: trust the field name -> FAILS)", async () => {
    expect(await A.undoDocumentFieldAction(ACC, { documentId: D, field: "owners_only", prior: "x", written: "y" }))
      .toEqual({ ok: false, error: "documents.error.refused" });
    expect(db.getDocument).not.toHaveBeenCalled();
  });
  it("Owners only is the Owner's and the agency's; Staff is refused even with a document they see (mutation: drop the role check -> FAILS)", async () => {
    requireAccountAccess.mockResolvedValue(STAFF);
    expect(await A.setOwnersOnlyAction(ACC, D, true)).toEqual({ ok: false, error: "documents.error.ownersOnlyRole" });
    expect(await A.undoOwnersOnlyAction(ACC, D, false, true)).toEqual({ ok: false, error: "documents.error.ownersOnlyRole" });
    expect(db.setDocumentOwnersOnly).not.toHaveBeenCalled();
  });
});

describe("trash and restore (spec 4.4)", () => {
  it("trash answers the stored instant for the Undo; restore compares against it (mutation: restore ignores the instant -> FAILS)", async () => {
    db.trashDocument.mockResolvedValue({ status: "trashed", deletedAt: "2026-10-13T15:00:00.123456+00:00" });
    expect(await A.trashDocumentAction(ACC, D)).toEqual({ ok: true, deletedAt: "2026-10-13T15:00:00.123456+00:00" });
    db.getDocument.mockResolvedValue({ ...DOC, deleted_at: "2026-10-13T15:00:00.123456+00:00", deleted_by: "user_owner" });
    db.restoreDocument.mockResolvedValue("changed");
    expect(await A.restoreDocumentAction(ACC, D, "2026-10-13T15:00:00.123456+00:00")).toEqual({ ok: false, error: "documents.undoChanged" });
    expect(db.restoreDocument).toHaveBeenCalledWith(SERVICE, ACC, D, "2026-10-13T15:00:00.123456+00:00", "user_owner");
  });
  it("a document the caller cannot see is never trashed (mutation: skip the request-client read -> FAILS)", async () => {
    db.getDocument.mockResolvedValue(null);
    expect(await A.trashDocumentAction(ACC, D)).toEqual({ ok: false, error: "documents.error.refused" });
    expect(db.trashDocument).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run, see it fail** (module missing): `pnpm --filter web exec vitest run "src/app/(dashboard)/dashboard/accounts/[accountId]/contacts/documents-actions.test.ts"`.
- [ ] **Step 3: Write `…/accounts/contacts/documents-actions.ts`:**

```ts
"use server";

import { createHash } from "node:crypto";
import { requireAccountAccess } from "@/lib/auth";
import { dbForRequest } from "@/lib/db";
import {
  serviceDb, getContact, readGroup, getDocument, getDocumentVersion, getUploadingVersion, createDocument,
  reserveDocumentVersion, markDocumentVersionReady, discardDocumentUpload, updateDocumentField, setDocumentOwnersOnly,
  trashDocument, restoreDocument, DOCUMENT_BUCKET, DOCUMENT_MAX_BYTES, isDocumentCategory, isDocumentContentType,
  type SupabaseClient, type DocumentRecordRef, type DocumentContentType, type DocumentRow,
} from "@bis/db";
import { isUuid } from "@/lib/assign/action-guards";
import { loggableError } from "@/lib/loggable-error";
import { validateInlineRule } from "@/lib/inline-rule";
import { extensionAllowed, extensionForType, formatMb, isDay, OFFICE_TYPES } from "@/lib/documents/rules";
import { checkDocumentBytes } from "@/lib/documents/content-check";

/**
 * The document vault's actions (spec 5.1). Every one: requireAccountAccess, then a REQUEST-client
 * read that returns the record or the document (RLS: the record's visibility, the Technician fence,
 * Owners only), and only then a write on the service client, scoped to the same account (0053;
 * in-account-service-reads.test.ts lists this file as proven-target). Every answer is a messages.ts
 * KEY with params, never translated text: the card translates it in the reader's language. Ids from
 * the browser are lowercased (PostgREST echoes them lowercase) and every payload is re-validated.
 * Nothing throws out of an action except requireAccountAccess's redirect (this tree's convention).
 */
export type DocRecordArg = { kind: "contact" | "group"; id: string };
export type DocFail = { ok: false; error: string; params?: Record<string, string | number> };
export type StartUploadInput = {
  record: DocRecordArg; name: string; title: string; size: number; contentType: string;
  category: string; expiresOn: string | null; ownersOnly: boolean; source: "upload" | "camera";
};
export type DocumentUndo = { documentId: string; field: "title" | "category" | "expires_on"; prior: string | null; written: string | null };

const fail = (error: string, params?: Record<string, string | number>): DocFail => (params ? { ok: false, error, params } : { ok: false, error });
const REFUSED = "documents.error.refused";
const FAILED = "documents.error.failed";
const TITLE_RULE = { kind: "text", max: 200, required: true } as const;
const DATE_RULE = { kind: "date", required: false } as const;
/** Spec 4.3: a URL lives 120 seconds and is minted again on demand. */
const URL_SECONDS = 120;

function log(where: string, accountId: string, e: unknown): void {
  console.error(`documents ${where} (account ${accountId}): ${loggableError(e)}`);
}
const isRecordObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

function recordOf(raw: unknown): DocumentRecordRef | null {
  if (!isRecordObj(raw) || !isUuid(raw.id)) return null;
  const id = (raw.id as string).toLowerCase();
  return raw.kind === "contact" ? { kind: "contact", id } : raw.kind === "group" ? { kind: "group", id } : null;
}

async function recordVisible(db: SupabaseClient, accountId: string, r: DocumentRecordRef): Promise<boolean> {
  return r.kind === "group" ? Boolean(await readGroup(db, accountId, r.id)) : Boolean(await getContact(db, accountId, r.id));
}

/** The request-client proof for an existing document: visible to the caller (RLS), optionally not in the trash. */
async function visibleDocument(accountId: string, documentId: string, live: boolean): Promise<DocumentRow | null> {
  const doc = await getDocument(await dbForRequest(), accountId, documentId.toLowerCase());
  if (!doc) return null;
  return live && doc.deleted_at !== null ? null : doc;
}

/** One field's value as the database will store it, or null when it is not one. */
function cleanField(field: DocumentUndo["field"], raw: unknown): { ok: true; value: string | null } | { ok: false } {
  if (field === "title") {
    if (typeof raw !== "string") return { ok: false };
    const r = validateInlineRule(TITLE_RULE, raw);
    return r.ok ? { ok: true, value: r.value } : { ok: false };
  }
  if (field === "category") return isDocumentCategory(raw) ? { ok: true, value: raw } : { ok: false };
  if (raw === null || raw === "") return { ok: true, value: null };
  return isDay(raw) ? { ok: true, value: raw } : { ok: false };
}

export async function startDocumentUploadAction(
  accountId: string, input: StartUploadInput,
): Promise<{ ok: true; documentId: string; versionId: string; uploadUrl: string } | DocFail> {
  const access = await requireAccountAccess(accountId);
  const record = recordOf(input?.record);
  if (!record || !isRecordObj(input)) return fail(REFUSED);
  if (input.ownersOnly === true && !access.canManage) return fail("documents.error.ownersOnlyRole");
  if (!Number.isInteger(input.size) || input.size < 1) return fail("documents.error.upload");
  if (input.size > DOCUMENT_MAX_BYTES) return fail("documents.error.tooLarge", { size: formatMb(input.size, "en") });
  if (typeof input.name !== "string" || !extensionAllowed(input.name) || !isDocumentContentType(input.contentType)) {
    return fail("documents.error.badType");
  }
  const title = typeof input.title === "string" ? validateInlineRule(TITLE_RULE, input.title) : null;
  if (!title?.ok || !isDocumentCategory(input.category) || !(input.expiresOn === null || isDay(input.expiresOn))
    || (input.source !== "upload" && input.source !== "camera") || typeof input.ownersOnly !== "boolean") {
    return fail(REFUSED);
  }
  try {
    if (!(await recordVisible(await dbForRequest(), accountId, record))) return fail("documents.error.notFound");
  } catch (e) {
    log("start: record read", accountId, e);
    return fail("documents.error.upload");
  }
  const svc = serviceDb();
  let documentId: string | null = null;
  try {
    documentId = await createDocument(svc, {
      accountId, record, title: title.value, category: input.category, expiresOn: input.expiresOn,
      ownersOnly: input.ownersOnly, source: input.source, createdBy: access.userId,
    });
    const r = await reserveDocumentVersion(svc, {
      accountId, documentId, bytes: input.size, contentType: input.contentType,
      originalName: input.name.slice(0, 255) || null, uploadedBy: access.userId,
    });
    if (r.status !== "ok") {
      await discardDocumentUpload(svc, accountId, documentId, null);
      return fail(r.status === "over_quota" ? "documents.error.quota" : r.status === "too_large" ? "documents.error.tooLarge" : REFUSED,
        r.status === "too_large" ? { size: formatMb(input.size, "en") } : undefined);
    }
    const { data, error } = await svc.storage.from(DOCUMENT_BUCKET).createSignedUploadUrl(r.storagePath);
    if (error || !data) {
      await discardDocumentUpload(svc, accountId, documentId, r.versionId);
      throw new Error(`createSignedUploadUrl: ${error?.message ?? "no data"}`);
    }
    return { ok: true, documentId, versionId: r.versionId, uploadUrl: data.signedUrl };
  } catch (e) {
    log("start", accountId, e);
    if (documentId) await discardDocumentUpload(svc, accountId, documentId, null).catch((x: unknown) => log("start: cleanup", accountId, x));
    return fail("documents.error.upload");
  }
}

/**
 * Removes a refused or failed upload: the object first, then the rows (spec 5.1 step 3). Never throws.
 * If the object cannot be removed, the rows are LEFT: the version stays `uploading`, so it still counts
 * against the quota and the sweep (passes/documents-sweep.ts) removes object and rows once it is older
 * than ABANDONED_UPLOAD_MS. Deleting the rows first would strand an object nothing could find.
 */
async function cleanUp(svc: SupabaseClient, accountId: string, documentId: string, versionId: string, path: string): Promise<void> {
  const { error } = await svc.storage.from(DOCUMENT_BUCKET).remove([path]);
  if (error) {
    log(`cleanup: object ${path} not removed, rows kept for the sweep`, accountId, error);
    return;
  }
  await discardDocumentUpload(svc, accountId, documentId, versionId).catch((e: unknown) => log("cleanup: rows", accountId, e));
}

export async function finishDocumentUploadAction(accountId: string, documentId: string, versionId: string): Promise<{ ok: true } | DocFail> {
  const access = await requireAccountAccess(accountId);
  if (!isUuid(documentId) || !isUuid(versionId)) return fail(REFUSED);
  const docId = documentId.toLowerCase();
  const verId = versionId.toLowerCase();
  try {
    if (!(await visibleDocument(accountId, docId, false))) return fail(REFUSED);
  } catch (e) {
    log("finish: document read", accountId, e);
    return fail("documents.error.upload");
  }
  const svc = serviceDb();
  try {
    const version = await getUploadingVersion(svc, accountId, docId, verId);
    if (!version) {
      // No uploading row. If NO row of that id exists at all (the sweep took it, or a cleanup ran), an
      // object the browser PUT afterwards could still sit at the path the server would have reserved:
      // remove it. A row that exists (already ready) is never touched.
      if (!(await getDocumentVersion(svc, accountId, verId))) {
        const { error } = await svc.storage.from(DOCUMENT_BUCKET).remove([`${accountId}/${docId}/${verId}`]);
        if (error) log("finish: orphan object", accountId, error);
        await discardDocumentUpload(svc, accountId, docId, null).catch((e: unknown) => log("finish: orphan rows", accountId, e));
      }
      return fail(REFUSED);
    }
    const { data: blob, error } = await svc.storage.from(DOCUMENT_BUCKET).download(version.storage_path);
    if (error || !blob) {
      await cleanUp(svc, accountId, docId, verId, version.storage_path);
      return fail("documents.error.upload");
    }
    const bytes = new Uint8Array(await blob.arrayBuffer());
    // Spec 3.5/5.1 (plan review I2): the stored size must be the RESERVED size, or a client that
    // understated it would slip past the quota. The reserved size is at most 25 MiB, so this also caps it.
    if (bytes.length !== version.bytes) {
      await cleanUp(svc, accountId, docId, verId, version.storage_path);
      return fail("documents.error.upload");
    }
    // The type storage holds for the object must be the declared one, and the bytes must be that type.
    if (blob.type !== version.content_type || checkDocumentBytes(bytes, version.content_type) !== "ok") {
      await cleanUp(svc, accountId, docId, verId, version.storage_path);
      return fail("documents.error.badType");
    }
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    const ok = await markDocumentVersionReady(svc, { accountId, documentId: docId, versionId: verId, bytes: bytes.length, sha256, actorId: access.userId });
    return ok ? { ok: true } : fail(REFUSED);
  } catch (e) {
    log("finish", accountId, e);
    return fail("documents.error.upload");
  }
}

/** The browser's PUT failed: remove what start reserved now, rather than waiting for the clean-up pass. */
export async function abandonDocumentUploadAction(accountId: string, documentId: string, versionId: string): Promise<{ ok: true } | DocFail> {
  await requireAccountAccess(accountId);
  if (!isUuid(documentId) || !isUuid(versionId)) return fail(REFUSED);
  const docId = documentId.toLowerCase();
  const verId = versionId.toLowerCase();
  try {
    if (!(await visibleDocument(accountId, docId, false))) return fail(REFUSED);
    const svc = serviceDb();
    const version = await getUploadingVersion(svc, accountId, docId, verId);
    if (version) await cleanUp(svc, accountId, docId, verId, version.storage_path);
    return { ok: true };
  } catch (e) {
    log("abandon", accountId, e);
    return fail(FAILED);
  }
}

export async function getDocumentUrlAction(
  accountId: string, versionId: string, mode: "view" | "download",
): Promise<{ ok: true; url: string; contentType: DocumentContentType } | DocFail> {
  await requireAccountAccess(accountId);
  if (!isUuid(versionId) || (mode !== "view" && mode !== "download")) return fail(REFUSED);
  try {
    const db = await dbForRequest();
    const version = await getDocumentVersion(db, accountId, versionId.toLowerCase());
    if (!version || version.status !== "ready") return fail(REFUSED);
    const doc = await getDocument(db, accountId, version.document_id);
    if (!doc) return fail(REFUSED);
    const download = mode === "download" || OFFICE_TYPES.includes(version.content_type);
    const { data, error } = await serviceDb().storage.from(DOCUMENT_BUCKET).createSignedUrl(
      version.storage_path, URL_SECONDS, download ? { download: `${doc.title}.${extensionForType(version.content_type)}` } : undefined);
    if (error || !data) throw new Error(`createSignedUrl: ${error?.message ?? "no data"}`);
    return { ok: true, url: data.signedUrl, contentType: version.content_type };
  } catch (e) {
    log("url", accountId, e);
    return fail("documents.error.open");
  }
}

const FIELDS: readonly DocumentUndo["field"][] = ["title", "category", "expires_on"];

export async function updateDocumentFieldAction(
  accountId: string, documentId: string, field: DocumentUndo["field"], raw: string,
): Promise<{ ok: true; shown: string; undoPayload: DocumentUndo } | DocFail> {
  await requireAccountAccess(accountId);
  if (!isUuid(documentId) || !FIELDS.includes(field)) return fail(REFUSED);
  const value = cleanField(field, raw);
  if (!value.ok) return fail(REFUSED);
  const docId = documentId.toLowerCase();
  try {
    const doc = await visibleDocument(accountId, docId, true);
    if (!doc) return fail(REFUSED);
    const r = await updateDocumentField(serviceDb(), accountId, docId, field, value.value);
    if (r === "changed") return fail(REFUSED);
    return { ok: true, shown: value.value ?? "", undoPayload: { documentId: docId, field, prior: doc[field], written: value.value } };
  } catch (e) {
    log(`edit ${field}`, accountId, e);
    return fail(FAILED);
  }
}

export async function undoDocumentFieldAction(accountId: string, payload: unknown): Promise<{ ok: true } | DocFail> {
  await requireAccountAccess(accountId);
  if (!isRecordObj(payload) || !isUuid(payload.documentId) || !FIELDS.includes(payload.field as DocumentUndo["field"])) return fail(REFUSED);
  const field = payload.field as DocumentUndo["field"];
  const prior = cleanField(field, payload.prior);
  const written = cleanField(field, payload.written);
  if (!prior.ok || !written.ok) return fail(REFUSED);
  const docId = (payload.documentId as string).toLowerCase();
  try {
    if (!(await visibleDocument(accountId, docId, true))) return fail(REFUSED);
    const r = await updateDocumentField(serviceDb(), accountId, docId, field, prior.value, { value: written.value });
    return r === "updated" ? { ok: true } : fail("documents.undoChanged");
  } catch (e) {
    log(`undo ${field}`, accountId, e);
    return fail(FAILED);
  }
}

export async function setOwnersOnlyAction(accountId: string, documentId: string, value: boolean): Promise<{ ok: true; prior: boolean } | DocFail> {
  const access = await requireAccountAccess(accountId);
  if (!access.canManage) return fail("documents.error.ownersOnlyRole");
  if (!isUuid(documentId) || typeof value !== "boolean") return fail(REFUSED);
  const docId = documentId.toLowerCase();
  try {
    const doc = await visibleDocument(accountId, docId, true);
    if (!doc) return fail(REFUSED);
    const r = await setDocumentOwnersOnly(serviceDb(), accountId, docId, value);
    return r === "updated" ? { ok: true, prior: doc.owners_only } : fail(REFUSED);
  } catch (e) {
    log("owners only", accountId, e);
    return fail(FAILED);
  }
}

export async function undoOwnersOnlyAction(accountId: string, documentId: string, prior: boolean, written: boolean): Promise<{ ok: true } | DocFail> {
  const access = await requireAccountAccess(accountId);
  if (!access.canManage) return fail("documents.error.ownersOnlyRole");
  if (!isUuid(documentId) || typeof prior !== "boolean" || typeof written !== "boolean") return fail(REFUSED);
  const docId = documentId.toLowerCase();
  try {
    if (!(await visibleDocument(accountId, docId, true))) return fail(REFUSED);
    const r = await setDocumentOwnersOnly(serviceDb(), accountId, docId, prior, written);
    return r === "updated" ? { ok: true } : fail("documents.undoChanged");
  } catch (e) {
    log("undo owners only", accountId, e);
    return fail(FAILED);
  }
}

export async function trashDocumentAction(accountId: string, documentId: string): Promise<{ ok: true; deletedAt: string } | DocFail> {
  const access = await requireAccountAccess(accountId);
  if (!isUuid(documentId)) return fail(REFUSED);
  const docId = documentId.toLowerCase();
  try {
    if (!(await visibleDocument(accountId, docId, true))) return fail(REFUSED);
    const r = await trashDocument(serviceDb(), accountId, docId, access.userId);
    return r.status === "trashed" ? { ok: true, deletedAt: r.deletedAt } : fail(REFUSED);
  } catch (e) {
    log("trash", accountId, e);
    return fail(FAILED);
  }
}

const isInstant = (v: unknown): v is string => typeof v === "string" && v.length <= 40 && !Number.isNaN(Date.parse(v));

export async function restoreDocumentAction(accountId: string, documentId: string, expectedDeletedAt: string): Promise<{ ok: true } | DocFail> {
  const access = await requireAccountAccess(accountId);
  if (!isUuid(documentId) || !isInstant(expectedDeletedAt)) return fail(REFUSED);
  const docId = documentId.toLowerCase();
  try {
    if (!(await visibleDocument(accountId, docId, false))) return fail(REFUSED);
    const r = await restoreDocument(serviceDb(), accountId, docId, expectedDeletedAt, access.userId);
    return r === "updated" ? { ok: true } : fail("documents.undoChanged");
  } catch (e) {
    log("restore", accountId, e);
    return fail(FAILED);
  }
}
```

- [ ] **Step 4: The service-reads list.** In `…/accounts/in-account-service-reads.test.ts`, after the `contacts/actions.ts` entry (`:85`), add:

```ts
  // The document vault (S-07): every service write and every minted URL follows a request-client read of the
  // record (getContact / readGroup) or the document (getDocument / getDocumentVersion, 0077's RLS).
  "app/(dashboard)/dashboard/accounts/[accountId]/contacts/documents-actions.ts": "proven-target",
```

- [ ] **Step 5: Run** the actions test and `in-account-service-reads.test.ts` → PASS; `pnpm --filter web typecheck`; eslint on the two files. Probes: each `(mutation: …)` in a test title, red by name; plus remove the new `ALLOWED` line → `in-account-service-reads.test.ts` fails naming `documents-actions.ts`.
- [ ] **Step 6: Commit.** `git add -- "apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/contacts/documents-actions.ts" "apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/contacts/documents-actions.test.ts"` then `git commit -m "feat(documents): upload, finish, URL, edit, Owners only, trash and restore actions, each proven on the request client first (S-07 part 1)" -- "apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/contacts/documents-actions.ts" "apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/contacts/documents-actions.test.ts" "apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/in-account-service-reads.test.ts"`

---

## Task 6: The two read routes (bis-crm)

**Review:** sonnet. **Runs beside:** Task 5 (no shared file).

**Files**
- Create: `…/api/contacts/[contactId]/documents/route.ts`, `route.test.ts`
- Create: `…/api/groups/[groupId]/documents/route.ts`, `route.test.ts`
- Create: `apps/web/src/lib/documents/document-view.ts` (the row mapper both routes share; a route file may export only HTTP handlers and route config, or `next build` refuses it)

**Interfaces**
- Consumes: `apiAccountAccess` (`lib/auth.ts:178-190`, `{ userId, isAgency } | null`); `dbForRequest`; `getContact`; `readGroup`; `listRecordDocuments`, `listPeopleNames` (`record.ts:385`); `accountToday` (`lib/contacts/account-today.ts:24`); Task 4's `DocumentsResponse`, `DocumentView`.
- Produces: `GET` → `200 DocumentsResponse` | `404 {}` (no access, malformed id, record not visible) | `500 {}`. Never `serviceDb` (the places route's rule, `contacts/[contactId]/places/route.ts:44`).

- [ ] **Step 1: Write the failing test** `…/api/contacts/[contactId]/documents/route.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const apiAccountAccess = vi.fn();
vi.mock("@/lib/auth", () => ({ apiAccountAccess: (id: string) => apiAccountAccess(id) }));
const REQUEST = { tag: "request-db" };
vi.mock("@/lib/db", () => ({ dbForRequest: async () => REQUEST }));
vi.mock("@/lib/contacts/account-today", () => ({ accountToday: async () => "2026-10-13" }));
const db = { getContact: vi.fn(), listRecordDocuments: vi.fn(), listPeopleNames: vi.fn(), serviceDb: vi.fn(() => { throw new Error("never"); }) };
vi.mock("@bis/db", () => db);
const { GET } = await import("./route");

const ACC = "44444444-4444-4444-8444-444444444444";
const C = "11111111-1111-4111-8111-111111111111";
const row = (over: Record<string, unknown> = {}) => ({
  id: "d1", account_id: ACC, contact_id: C, client_group_id: null, title: "Lease", category: "contract", expires_on: null,
  owners_only: false, source: "camera", current_version_id: "v1", created_by: "user_ana", created_at: "2026-10-01T00:00:00Z",
  updated_at: "2026-10-01T00:00:00Z", deleted_at: null, deleted_by: null,
  version: { id: "v1", document_id: "d1", account_id: ACC, storage_path: "p", bytes: 1200, content_type: "image/jpeg", original_name: "x.jpg", status: "ready", created_at: "x" },
  ...over,
});
const call = (id = C) => GET(new Request("http://x"), { params: Promise.resolve({ accountId: ACC, contactId: id }) });

beforeEach(() => {
  vi.clearAllMocks();
  apiAccountAccess.mockResolvedValue({ userId: "user_me", isAgency: false });
  db.getContact.mockResolvedValue({ id: C });
  db.listRecordDocuments.mockResolvedValue({ live: [row()], trashed: [], liveMore: false, trashedMore: false });
  db.listPeopleNames.mockResolvedValue({ user_ana: "Ana" });
});

describe("the Documents card's read for a contact", () => {
  it("reads on the request client, names the author without sending their Clerk id (mutation: send created_by -> FAILS)", async () => {
    const res = await call();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(db.listRecordDocuments).toHaveBeenCalledWith(REQUEST, ACC, { kind: "contact", id: C });
    expect(body.live[0]).toEqual({
      id: "d1", title: "Lease", category: "contract", expiresOn: null, ownersOnly: false, source: "camera",
      addedBy: { you: false, name: "Ana" }, createdAt: "2026-10-01T00:00:00Z", deletedAt: null,
      version: { id: "v1", contentType: "image/jpeg", bytes: 1200 },
    });
    expect(JSON.stringify(body)).not.toContain("user_ana");
    expect(body).toMatchObject({ today: "2026-10-13", record: { kind: "contact", id: C }, capped: false });
  });
  it("the reader's own file says you; an unreadable name is null, the card's 'Someone on the team' (mutation: name the viewer from names -> FAILS)", async () => {
    db.listRecordDocuments.mockResolvedValue({ live: [row({ created_by: "user_me" }), row({ id: "d2", created_by: "user_gone" })], trashed: [], liveMore: false, trashedMore: true });
    const body = await (await call()).json();
    expect(body.live.map((d: { addedBy: unknown }) => d.addedBy)).toEqual([{ you: true, name: null }, { you: false, name: null }]);
    expect(body.capped).toBe(true);
  });
  it("404 for no access, a malformed id or a contact the caller cannot see; never lists (mutation: list before getContact -> FAILS)", async () => {
    db.getContact.mockResolvedValue(null);
    expect((await call()).status).toBe(404);
    expect((await call("nope")).status).toBe(404);
    apiAccountAccess.mockResolvedValue(null);
    expect((await call()).status).toBe(404);
    expect(db.listRecordDocuments).not.toHaveBeenCalled();
  });
  it("a read failure is a 500 (the card's error state), never a partial body", async () => {
    db.listRecordDocuments.mockRejectedValue(new Error("down"));
    expect((await call()).status).toBe(500);
  });
});
```

The group route's test is the same file with `readGroup` (returning `{ id, kind: "household", name: "Casa", billingAddress: null }`) in place of `getContact`, `params: { accountId, groupId }`, the asserted record `{ kind: "group", id, groupKind: "household" }`, and the mutation "prove the group with getContact -> FAILS". Write it out in full; do not import from the contact route's test.

- [ ] **Step 2: Run, see both fail.**
- [ ] **Step 3: Write the shared mapper** `apps/web/src/lib/documents/document-view.ts`:

```ts
import type { ListedDocument } from "@bis/db";
import type { DocumentView } from "./documents-load";

/** The author's Clerk id never leaves the server: the card gets "you", a name, or null ("Someone on the team"). */
export function documentView(d: ListedDocument, viewerId: string, names: Readonly<Record<string, string>>): DocumentView {
  const you = d.created_by === viewerId;
  return {
    id: d.id, title: d.title, category: d.category, expiresOn: d.expires_on, ownersOnly: d.owners_only, source: d.source,
    addedBy: { you, name: you ? null : (Object.hasOwn(names, d.created_by) ? names[d.created_by]! : null) },
    createdAt: d.created_at, deletedAt: d.deleted_at,
    version: { id: d.version.id, contentType: d.version.content_type, bytes: d.version.bytes },
  };
}
```

Then `…/api/contacts/[contactId]/documents/route.ts`:

```ts
import { NextResponse } from "next/server";
import { getContact, listRecordDocuments, listPeopleNames } from "@bis/db";
import { apiAccountAccess } from "@/lib/auth";
import { dbForRequest } from "@/lib/db";
import { isUuid } from "@/lib/assign/action-guards";
import { loggableError } from "@/lib/loggable-error";
import { accountToday } from "@/lib/contacts/account-today";
import type { DocumentsResponse } from "@/lib/documents/documents-load";
import { documentView } from "@/lib/documents/document-view";

export const dynamic = "force-dynamic";

/**
 * The Documents card's own read for a contact (spec 4.5: it loads and fails on its own). Request
 * client only: 0077's RLS decides (the contact's visibility, the Technician fence, Owners only).
 * `today` is the account's own day, for expiry words; `now` the server's instant, for purge words.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ accountId: string; contactId: string }> }) {
  const { accountId, contactId: raw } = await params;
  const access = await apiAccountAccess(accountId);
  if (!access || !isUuid(raw)) return NextResponse.json({}, { status: 404 });
  const contactId = raw.toLowerCase();
  const db = await dbForRequest(); // RLS-scoped: NEVER serviceDb here
  try {
    if (!(await getContact(db, accountId, contactId))) return NextResponse.json({}, { status: 404 });
    const [docs, today] = await Promise.all([listRecordDocuments(db, accountId, { kind: "contact", id: contactId }), accountToday(db, accountId)]);
    const all = [...docs.live, ...docs.trashed];
    const names = await listPeopleNames(db, [...new Set(all.map((d) => d.created_by))]).catch((e: unknown) => {
      console.error(`documents read names (account ${accountId}): ${loggableError(e)}`);
      return {} as Record<string, string>;
    });
    const body: DocumentsResponse = {
      today, now: new Date().toISOString(), record: { kind: "contact", id: contactId },
      live: docs.live.map((d) => documentView(d, access.userId, names)),
      trashed: docs.trashed.map((d) => documentView(d, access.userId, names)),
      capped: docs.liveMore || docs.trashedMore,
    };
    return NextResponse.json(body);
  } catch (e) {
    console.error(`documents read (account ${accountId}, contact ${contactId}): ${loggableError(e)}`);
    return NextResponse.json({}, { status: 500 });
  }
}
```

`…/api/groups/[groupId]/documents/route.ts` is the same file with `readGroup` in place of `getContact` (keep the row: `const group = await readGroup(db, accountId, groupId); if (!group) return NextResponse.json({}, { status: 404 });`), `params: Promise<{ accountId: string; groupId: string }>`, `listRecordDocuments(db, accountId, { kind: "group", id: groupId })` and `record: { kind: "group", id: groupId, groupKind: group.kind }`. Write it out in full; it imports `documentView` from `@/lib/documents/document-view`, never from the contact route.

- [ ] **Step 4: Run** both route tests → PASS. Probes as named.
- [ ] **Step 5: Commit.** `git add` the five new files, then `git commit -m "feat(documents): the Documents card's reads for a contact and a group, on the request client (S-07 part 1)" -- "apps/web/src/app/api/accounts/[accountId]/contacts/[contactId]/documents/route.ts" "apps/web/src/app/api/accounts/[accountId]/contacts/[contactId]/documents/route.test.ts" "apps/web/src/app/api/accounts/[accountId]/groups/[groupId]/documents/route.ts" "apps/web/src/app/api/accounts/[accountId]/groups/[groupId]/documents/route.test.ts" apps/web/src/lib/documents/document-view.ts`

---

## Task 7: `strip-image.ts` and `upload-client.ts` (bis-frontend)

**Review:** opus.

**Files**
- Create: `apps/web/src/lib/documents/strip-image.ts`, `strip-image.test.ts`
- Create: `apps/web/src/lib/documents/upload-client.ts`, `upload-client.test.ts`

**Interfaces**
- Consumes: Task 4's `typeForFile`, `isImageType`, `formatMb`; `@bis/db/document-rules`'s `DOCUMENT_MAX_BYTES`, `isDocumentContentType`; Task 5's `startDocumentUploadAction`, `finishDocumentUploadAction`, `abandonDocumentUploadAction` and their types.
- Produces:

```ts
// strip-image.ts (browser)
export const MAX_IMAGE_EDGE = 4096;
export type ImageType = "image/jpeg" | "image/png" | "image/webp";
export function fitWithin(width: number, height: number, max?: number): { width: number; height: number };
export function encodeArgs(type: ImageType): { type: ImageType; quality: number | undefined };
export function stripImage(file: Blob, type: ImageType): Promise<Blob>;
// upload-client.ts (browser)
export type UploadPhase =
  | { kind: "uploading"; percent: number } | { kind: "checking" } | { kind: "done" }
  | { kind: "failed"; error: string; params?: Record<string, string | number> };
export type UploadBatch = { record: DocRecordArg; ownersOnly: boolean; expiresOn: string | null; source: "upload" | "camera" };
export type UploadItem = { file: File; title: string; category: DocumentCategory };
export type UploadDeps = {
  start: typeof startDocumentUploadAction; finish: typeof finishDocumentUploadAction; abandon: typeof abandonDocumentUploadAction;
  put: (url: string, body: Blob, contentType: string, onProgress: (percent: number) => void) => Promise<boolean>;
  strip: (file: Blob, type: ImageType) => Promise<Blob>;
};
export function prepareFile(file: File, strip: UploadDeps["strip"]): Promise<{ ok: true; blob: Blob; contentType: DocumentContentType } | { ok: false; error: string; params?: Record<string, string | number> }>;
export function uploadOne(accountId: string, item: UploadItem, batch: UploadBatch, deps: UploadDeps, onPhase: (p: UploadPhase) => void): Promise<UploadPhase>;
export function xhrPut(url: string, body: Blob, contentType: string, onProgress: (percent: number) => void): Promise<boolean>;
export const browserDeps: () => UploadDeps;   // the real actions, xhrPut and stripImage
```

- [ ] **Step 1: Write the failing tests.**

`apps/web/src/lib/documents/strip-image.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { fitWithin, encodeArgs, MAX_IMAGE_EDGE } from "./strip-image";

describe("the browser re-encode's pure parts (spec 5.3)", () => {
  it("over 4096 px on the long side scales down to 4096, keeping the ratio; smaller images keep their size (mutation: scale by the short side -> FAILS)", () => {
    expect(fitWithin(8192, 6144)).toEqual({ width: 4096, height: 3072 });
    expect(fitWithin(3000, 9000)).toEqual({ width: 1365, height: 4096 });
    expect(fitWithin(4000, 3000)).toEqual({ width: 4000, height: 3000 });
    expect(MAX_IMAGE_EDGE).toBe(4096);
  });
  it("JPEG at 0.9; PNG stays PNG with no quality; WebP stays WebP (mutation: encode every image as JPEG -> FAILS)", () => {
    expect(encodeArgs("image/jpeg")).toEqual({ type: "image/jpeg", quality: 0.9 });
    expect(encodeArgs("image/png")).toEqual({ type: "image/png", quality: undefined });
    expect(encodeArgs("image/webp")).toEqual({ type: "image/webp", quality: 0.9 });
  });
});
```

`apps/web/src/lib/documents/upload-client.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import type { UploadDeps } from "./upload-client";
// "use server" modules cannot load in vitest; every dependency is injected through UploadDeps below.
vi.mock("@/app/(dashboard)/dashboard/accounts/[accountId]/contacts/documents-actions", () => ({
  startDocumentUploadAction: vi.fn(), finishDocumentUploadAction: vi.fn(), abandonDocumentUploadAction: vi.fn(),
}));
const { prepareFile, uploadOne } = await import("./upload-client");

const C = "11111111-1111-4111-8111-111111111111";
const batch = { record: { kind: "contact" as const, id: C }, ownersOnly: false, expiresOn: null, source: "upload" as const };
const file = (name: string, type: string, size = 10) => new File([new Uint8Array(size)], name, { type });

function deps(over: Partial<UploadDeps> = {}): UploadDeps & { calls: string[] } {
  const calls: string[] = [];
  const d = {
    calls,
    strip: vi.fn(async (f: Blob) => { calls.push("strip"); return new Blob([await f.arrayBuffer()], { type: f.type }); }),
    start: vi.fn(async () => { calls.push("start"); return { ok: true as const, documentId: "d", versionId: "v", uploadUrl: "https://u" }; }),
    put: vi.fn(async (_u: string, _b: Blob, _t: string, p: (n: number) => void) => { calls.push("put"); p(45); p(100); return true; }),
    finish: vi.fn(async () => { calls.push("finish"); return { ok: true as const }; }),
    abandon: vi.fn(async () => { calls.push("abandon"); return { ok: true as const }; }),
    ...over,
  };
  return d as unknown as UploadDeps & { calls: string[] };
}

describe("prepareFile (spec 4.2, 5.3)", () => {
  it("an image is re-encoded before anything is sent; a PDF is sent as given (mutation: strip every file -> FAILS)", async () => {
    const d = deps();
    await prepareFile(file("a.jpg", "image/jpeg"), d.strip);
    await prepareFile(file("a.pdf", "application/pdf"), d.strip);
    expect(d.strip).toHaveBeenCalledTimes(1);
  });
  it("the declared type is what the browser produced (Safari's WebP comes back PNG) (mutation: declare the input's type -> FAILS)", async () => {
    const r = await prepareFile(file("a.webp", "image/webp"), async () => new Blob([new Uint8Array(5)], { type: "image/png" }));
    expect(r).toMatchObject({ ok: true, contentType: "image/png" });
  });
  it("HEIC and SVG are refused with the kind-of-file sentence; oversize AFTER the re-encode with the size (mutation: check the size before the re-encode -> FAILS)", async () => {
    expect(await prepareFile(file("a.heic", "image/heic"), deps().strip)).toEqual({ ok: false, error: "documents.error.badType" });
    expect(await prepareFile(file("a.svg", "image/svg+xml"), deps().strip)).toEqual({ ok: false, error: "documents.error.badType" });
    const big = await prepareFile(file("a.png", "image/png", 10), async () => new Blob([new Uint8Array(26_214_401)], { type: "image/png" }));
    expect(big).toEqual({ ok: false, error: "documents.error.tooLarge", params: { size: "25 MB" } });
  });
});

describe("uploadOne: start, PUT, finish, in that order (spec 4.2, V6)", () => {
  it("reports Uploading n%, then Checking, then done (mutation: report done before finish -> FAILS)", async () => {
    const d = deps();
    const phases: unknown[] = [];
    const end = await uploadOne("acc", { file: file("a.pdf", "application/pdf"), title: "a", category: "other" }, batch, d, (p) => phases.push(p));
    expect(d.calls).toEqual(["start", "put", "finish"]);
    expect(phases).toEqual([{ kind: "uploading", percent: 0 }, { kind: "uploading", percent: 45 }, { kind: "uploading", percent: 100 }, { kind: "checking" }]);
    expect(end).toEqual({ kind: "done" });
  });
  it("a failed PUT abandons the reservation at once and says Couldn't upload (mutation: skip abandon -> FAILS)", async () => {
    const d = deps({ put: vi.fn(async () => false) });
    const end = await uploadOne("acc", { file: file("a.pdf", "application/pdf"), title: "a", category: "other" }, batch, d, () => {});
    expect(d.abandon).toHaveBeenCalledWith("acc", "d", "v");
    expect(end).toEqual({ kind: "failed", error: "documents.error.upload" });
    expect(d.finish).not.toHaveBeenCalled();
  });
  it("the server's refusal is passed through with its key and params; nothing is PUT (mutation: PUT before start answers -> FAILS)", async () => {
    const d = deps({ start: vi.fn(async () => ({ ok: false as const, error: "documents.error.quota" })) });
    expect(await uploadOne("acc", { file: file("a.pdf", "application/pdf"), title: "a", category: "other" }, batch, d, () => {}))
      .toEqual({ kind: "failed", error: "documents.error.quota" });
    expect(d.put).not.toHaveBeenCalled();
  });
  it("sends the batch's Owners only, expiry and source with each file (mutation: drop ownersOnly from the start input -> FAILS)", async () => {
    const d = deps();
    await uploadOne("acc", { file: file("a.jpg", "image/jpeg"), title: "a", category: "photo" },
      { ...batch, ownersOnly: true, expiresOn: "2026-12-01", source: "camera" }, d, () => {});
    expect((d.start as ReturnType<typeof vi.fn>).mock.calls[0]![1]).toMatchObject({
      ownersOnly: true, expiresOn: "2026-12-01", source: "camera", contentType: "image/jpeg", category: "photo", name: "a.jpg", title: "a" });
  });
});
```


- [ ] **Step 2: Run, see both fail.**
- [ ] **Step 3: Write `apps/web/src/lib/documents/strip-image.ts`:**

```ts
/**
 * Spec 5.3: an image is decoded and redrawn on a canvas IN THE BROWSER, orientation applied, and
 * re-encoded, which drops its GPS and camera metadata; over 4096 px on its long side it is scaled
 * down. Stated limit: a modified client can skip this; part 2's server-side pipeline is where
 * customer uploads get enforcement. HEIC never reaches here (the bucket refuses it, spec 3.1).
 */
export const MAX_IMAGE_EDGE = 4096;
export type ImageType = "image/jpeg" | "image/png" | "image/webp";

export function fitWithin(width: number, height: number, max = MAX_IMAGE_EDGE): { width: number; height: number } {
  const long = Math.max(width, height);
  if (long <= max) return { width, height };
  const scale = max / long;
  return { width: Math.round(width * scale), height: Math.round(height * scale) };
}

export function encodeArgs(type: ImageType): { type: ImageType; quality: number | undefined } {
  return { type, quality: type === "image/png" ? undefined : 0.9 };
}

/** Browser only. The Blob's own `type` is what the browser actually produced (Safari has no WebP encoder: PNG). */
export async function stripImage(file: Blob, type: ImageType): Promise<Blob> {
  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  try {
    const { width, height } = fitWithin(bitmap.width, bitmap.height);
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("stripImage: no 2d context");
    ctx.drawImage(bitmap, 0, 0, width, height);
    const { type: outType, quality } = encodeArgs(type);
    return await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("stripImage: encode failed"))), outType, quality));
  } finally {
    bitmap.close();
  }
}
```

`apps/web/src/lib/documents/upload-client.ts`:

```ts
import { DOCUMENT_MAX_BYTES, isDocumentContentType, type DocumentCategory, type DocumentContentType } from "@bis/db/document-rules";
import {
  startDocumentUploadAction, finishDocumentUploadAction, abandonDocumentUploadAction, type DocRecordArg,
} from "@/app/(dashboard)/dashboard/accounts/[accountId]/contacts/documents-actions";
import { typeForFile, isImageType, formatMb } from "./rules";
import { stripImage, type ImageType } from "./strip-image";

/**
 * One file's journey (spec 4.2, V6): prepare (re-encode an image, check its type and its size AS
 * STORED), start (the server reserves and answers a signed upload URL), PUT the bytes straight to
 * storage with progress (never through a function body, capped at 4.5 MB), finish (the server checks
 * the real bytes). A failed PUT gives the reservation back at once. Every failure is a messages.ts
 * key the card translates. The PUT's headers are the ones storage-js's uploadToSignedUrl sends for a
 * raw body (plan Assumption A1).
 */
export type UploadPhase =
  | { kind: "uploading"; percent: number } | { kind: "checking" } | { kind: "done" }
  | { kind: "failed"; error: string; params?: Record<string, string | number> };
export type UploadBatch = { record: DocRecordArg; ownersOnly: boolean; expiresOn: string | null; source: "upload" | "camera" };
export type UploadItem = { file: File; title: string; category: DocumentCategory };
export type UploadDeps = {
  start: typeof startDocumentUploadAction; finish: typeof finishDocumentUploadAction; abandon: typeof abandonDocumentUploadAction;
  put: (url: string, body: Blob, contentType: string, onProgress: (percent: number) => void) => Promise<boolean>;
  strip: (file: Blob, type: ImageType) => Promise<Blob>;
};
type Refusal = { ok: false; error: string; params?: Record<string, string | number> };
const refusal = (error: string, params?: Record<string, string | number>): Refusal => (params ? { ok: false, error, params } : { ok: false, error });

export async function prepareFile(file: File, strip: UploadDeps["strip"]): Promise<{ ok: true; blob: Blob; contentType: DocumentContentType } | Refusal> {
  const declared = typeForFile(file.name, file.type);
  if (!declared) return refusal("documents.error.badType");
  let blob: Blob = file;
  let contentType: DocumentContentType = declared;
  if (isImageType(declared)) {
    try {
      blob = await strip(file, declared as ImageType);
    } catch {
      return refusal("documents.error.upload");
    }
    contentType = isDocumentContentType(blob.type) ? blob.type : declared;
  }
  if (blob.size > DOCUMENT_MAX_BYTES) return refusal("documents.error.tooLarge", { size: formatMb(blob.size, "en") });
  if (blob.size < 1) return refusal("documents.error.upload");
  return { ok: true, blob, contentType };
}

export async function uploadOne(
  accountId: string, item: UploadItem, batch: UploadBatch, deps: UploadDeps, onPhase: (p: UploadPhase) => void,
): Promise<UploadPhase> {
  const failed = (r: Refusal): UploadPhase => (r.params ? { kind: "failed", error: r.error, params: r.params } : { kind: "failed", error: r.error });
  const prepared = await prepareFile(item.file, deps.strip);
  if (!prepared.ok) return failed(prepared);
  const started = await deps.start(accountId, {
    record: batch.record, name: item.file.name, title: item.title, size: prepared.blob.size, contentType: prepared.contentType,
    category: item.category, expiresOn: batch.expiresOn, ownersOnly: batch.ownersOnly, source: batch.source,
  }).catch((): Refusal => refusal("documents.error.upload"));
  if (!started.ok) return failed(started);
  onPhase({ kind: "uploading", percent: 0 });
  const put = await deps.put(started.uploadUrl, prepared.blob, prepared.contentType, (percent) => onPhase({ kind: "uploading", percent }))
    .catch(() => false);
  if (!put) {
    await deps.abandon(accountId, started.documentId, started.versionId).catch(() => undefined);
    return { kind: "failed", error: "documents.error.upload" };
  }
  onPhase({ kind: "checking" });
  const finished = await deps.finish(accountId, started.documentId, started.versionId).catch((): Refusal => refusal("documents.error.upload"));
  return finished.ok ? { kind: "done" } : failed(finished);
}

/** Browser only: XHR, because fetch reports no upload progress. */
export function xhrPut(url: string, body: Blob, contentType: string, onProgress: (percent: number) => void): Promise<boolean> {
  return new Promise((resolve) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    xhr.setRequestHeader("content-type", contentType);
    xhr.setRequestHeader("x-upsert", "false");
    xhr.setRequestHeader("cache-control", "max-age=3600");
    xhr.upload.onprogress = (e) => { if (e.lengthComputable) onProgress(Math.min(100, Math.round((e.loaded / e.total) * 100))); };
    xhr.onload = () => resolve(xhr.status >= 200 && xhr.status < 300);
    xhr.onerror = () => resolve(false);
    xhr.onabort = () => resolve(false);
    xhr.send(body);
  });
}

export const browserDeps = (): UploadDeps => ({
  start: startDocumentUploadAction, finish: finishDocumentUploadAction, abandon: abandonDocumentUploadAction,
  put: xhrPut, strip: stripImage,
});
```

- [ ] **Step 4: Run** both tests → PASS; probes as named. `pnpm --filter web typecheck`.
- [ ] **Step 5: Commit** the four files: `git add -- apps/web/src/lib/documents/strip-image.ts apps/web/src/lib/documents/strip-image.test.ts apps/web/src/lib/documents/upload-client.ts apps/web/src/lib/documents/upload-client.test.ts` then `git commit -m "feat(documents): strip location data in the browser and upload straight to storage with progress (S-07 part 1)" -- apps/web/src/lib/documents/strip-image.ts apps/web/src/lib/documents/strip-image.test.ts apps/web/src/lib/documents/upload-client.ts apps/web/src/lib/documents/upload-client.test.ts`

---

## Task 8: The timeline's `documents` source (bis-crm)

**Review:** opus. **Replica:** `55528`/`55529`/`55530` for `record.test.ts` and `timeline-sources.test.ts` (`withTestAccount`).

**Files**
- Modify: `packages/db/src/record.ts:262-370` (the source type and list, the entry union, `listTimelinePage`)
- Modify: `packages/db/src/test/record.test.ts` (one case), `packages/db/src/test/timeline-sources.test.ts` (the source list)
- Modify: `apps/web/src/lib/record/timeline-rows.ts:36-39,62-91` (`SOURCE_KEY`, `phrase`) and `timeline-rows.test.ts`
- Modify: `apps/web/src/lib/record/author-mark.ts:26-48` (`authorOf`) and `author-mark.test.ts`
- Modify: `apps/web/src/lib/record/recent-rows.ts:23-44` (`excerptOf`) and `recent-rows.test.ts`
- Modify: `apps/web/src/lib/record/group-loaders.ts:137-161` (`loadGroupTimeline` takes the group id) and `group-loaders.test.ts`
- Modify: `…/accounts/contacts/[contactId]/activity-timeline.tsx:1-2,146-245` and `activity-timeline.rows.test.ts`
- Modify: `…/accounts/groups/[groupId]/group-timeline.tsx:1-2,103-175` and `group-timeline.test.ts`
- Modify: `…/accounts/groups/[groupId]/page.tsx:104` (one argument: `group.id`)

**Interfaces**
- Consumes: Task 3's `listDocumentTimeline`, `TimelineDocument`; Task 2's `timeline.document`, `timeline.documentPhoto`, `timeline.what.documents`, `documents.status.trashed`, `documents.category.*`.
- Produces: `TimelineSource` gains `"documents"` (last in `TIMELINE_SOURCES`); `TimelineEntry` gains `{ kind: "document"; id: string; at: string; contactId: string; document: TimelineDocument }` (`contactId` is `""` for a group's own file, so the group page's subject line is empty for it); `listTimelinePage(db, accountId, contactIds, before?, opts: { limit?; onError?; groupId?: string })`; `loadGroupTimeline(db, accountId, contactIds, before?, groupId?: string)`.

- [ ] **Step 1: Write the failing tests.**

In `packages/db/src/test/record.test.ts` (imports: `createDocument, reserveDocumentVersion, markDocumentVersionReady` from `"../documents"`), add:

```ts
describe("the documents source (S-07, plan deviation 3)", () => {
  it("a ready document is one row at its created_at, merged with the others; a group page also reads the group's own (mutation: drop the documents settle -> FAILS)", () =>
    withTestAccount(async (db, accountId) => {
      const ana = (await createContact(db, accountId, { firstName: "Ana" }, "user_t")).id;
      const g = await createGroupWithMember(db, accountId, ana, "household", "Casa", null, "user_t");
      if (g.status !== "ok") throw new Error(g.status);
      const add = async (record: { kind: "contact" | "group"; id: string }, title: string) => {
        const id = await createDocument(db, { accountId, record, title, category: "other", expiresOn: null, ownersOnly: false, source: "upload", createdBy: "user_t" });
        const r = await reserveDocumentVersion(db, { accountId, documentId: id, bytes: 5, contentType: "application/pdf", originalName: null, uploadedBy: "user_t" });
        if (r.status !== "ok") throw new Error(r.status);
        await markDocumentVersionReady(db, { accountId, documentId: id, versionId: r.versionId, bytes: 5, sha256: "c".repeat(64), actorId: "user_t" });
        return id;
      };
      const mine = await add({ kind: "contact", id: ana }, "Mine");
      const ours = await add({ kind: "group", id: g.groupId }, "Ours");
      const contactPage = await listTimelinePage(db, accountId, [ana]);
      expect(contactPage.items.filter((i) => i.kind === "document").map((i) => i.id)).toEqual([mine]);
      const groupPage = await listTimelinePage(db, accountId, [ana], undefined, { groupId: g.groupId });
      expect(groupPage.items.filter((i) => i.kind === "document").map((i) => i.id).sort()).toEqual([mine, ours].sort());
      expect(groupPage.failed).toEqual([]);
    }));
});
```

In `timeline-sources.test.ts`, the pinned list (find it with `grep -n "TIMELINE_SOURCES" packages/db/src/test/timeline-sources.test.ts`) gains `"documents"` last; mutation: drop it from `TIMELINE_SOURCES` → FAILS.

In `apps/web/src/lib/record/timeline-rows.test.ts`, add (build `tr` with `makeTr` as the file's existing cases do):

```ts
describe("a document row (S-07, plan deviation 3)", () => {
  const doc = (over: Partial<TimelineDocument> = {}): TimelineEntry => ({
    kind: "document", id: "d1", at: "2026-10-13T15:00:00.000Z", contactId: "c1",
    document: { id: "d1", title: "Signed lease", category: "contract", source: "upload", created_by: "user_ana",
      created_at: "2026-10-13T15:00:00.000Z", deleted_at: null, contact_id: "c1", client_group_id: null, ...over },
  });
  const author = (tr: Tr) => ({ viewerId: "user_me", names: { user_ana: "Ana" }, personaName: null, tr });
  it("reads '<who> added a file: <title>', its category as the detail, the person mark; a camera file reads 'took a photo' (mutation: drop the camera branch -> FAILS)", () => {
    const tr = makeTr("en");
    const [row] = timelineRows([doc()], { zone: "America/Chicago", tr, author: author(tr) });
    expect([row!.verb, row!.detail, row!.mark, row!.status]).toEqual(["added a file: Signed lease", "Contract", { kind: "person", label: "Ana" }, null]);
    const [photo] = timelineRows([doc({ source: "camera" })], { zone: "America/Chicago", tr, author: author(tr) });
    expect(photo!.verb).toBe("took a photo: Signed lease");
  });
  it("a trashed file carries 'In the trash' as a dot and a word, in Spanish too (mutation: drop the trashed status -> FAILS)", () => {
    const tr = makeTr("es");
    const [row] = timelineRows([doc({ deleted_at: "2026-10-14T00:00:00.000Z" })], { zone: "America/Chicago", tr, author: author(tr) });
    expect(row!.status).toEqual({ tone: "muted", word: m["documents.status.trashed.es"] });
    expect(row!.verb).toBe(m["timeline.document.es"].replace("{title}", "Signed lease"));
    expect(row!.detail).toBe(m["documents.category.contract.es"]);
  });
  it("a failed documents source is named (mutation: drop documents from SOURCE_KEY -> typecheck FAILS; at runtime the word is missing)", () => {
    expect(timelineFailedText(["documents"], makeTr("en"))).toBe("Couldn't load documents.");
  });
});
```

(imports: `type TimelineDocument, type TimelineEntry` from `@bis/db`; `makeTr`, `type Tr` from `./copy`; `m` from `@/lib/messages`.)

In `author-mark.test.ts`: `authorOf(<the doc entry>)` → `{ kind: "person", personId: "user_ana" }` (mutation: return `unnamed()` for documents → FAILS); `personIdsOf([<doc entry>])` → `["user_ana"]`.

In `recent-rows.test.ts`: a document entry yields a row with `excerpt: null` (mutation: excerpt the title → FAILS).

In `group-loaders.test.ts`: `loadGroupTimeline(db, ACC, ["c1"], undefined, "g1")` calls `listTimelinePage` with `opts` containing `groupId: "g1"` (mutation: drop the groupId pass-through → FAILS).

In `activity-timeline.rows.test.ts` and `group-timeline.test.ts`: render a page holding one document row (build it with `timelineRows`, as each file's existing deal case does) and assert the markup contains `data-timeline-item="document"` and the verb text (mutation: return `null` for the document case → FAILS).

- [ ] **Step 2: Run, see them fail** (web: `pnpm --filter web exec vitest run src/lib/record "src/app/(dashboard)/dashboard/accounts/[accountId]/contacts/[contactId]/activity-timeline.rows.test.ts" "src/app/(dashboard)/dashboard/accounts/[accountId]/groups/[groupId]/group-timeline.test.ts"`; db on the replica).
- [ ] **Step 3: `packages/db/src/record.ts`.** Import at the top: `import { listDocumentTimeline, type TimelineDocument } from "./documents";`. Replace `:262-263` with:

```ts
export type TimelineSource = "notes" | "todos" | "deals" | "forms" | "messages" | "bookings" | "calls" | "documents";
export const TIMELINE_SOURCES: readonly TimelineSource[] = ["notes", "todos", "deals", "forms", "messages", "bookings", "calls", "documents"];
```

Add to the `TimelineEntry` union (`:286-293`), after the `call` variant:

```ts
  /** S-07 (plan deviation 3): one row per listed document, read from `documents` so RLS decides. A group's own file has contactId "". */
  | { kind: "document"; id: string; at: string; contactId: string; document: TimelineDocument };
```

In `listTimelinePage` (`:318-370`): the `opts` type gains `groupId?: string`; after the `calls` settle add:

```ts
    settle("documents", async () => (await listDocumentTimeline(db, accountId, who, opts.groupId ?? null, page))
      .map((d): TimelineEntry => ({ kind: "document", id: d.id, at: d.created_at, contactId: d.contact_id ?? "", document: d }))),
```

and `listContactTimelinePage`'s `opts` type stays as it is (a contact page never passes a group). Re-export `type TimelineDocument` from the record block of `index.ts`? NO: Task 3 already exports it from the documents block; `index.ts` is Task 3's only.

- [ ] **Step 4: The web side.**
  - `timeline-rows.ts`: `SOURCE_KEY` gains `documents: "timeline.what.documents"`; `phrase` gains:

```ts
    case "document": return {
      verb: tr.text(entry.document.source === "camera" ? "timeline.documentPhoto" : "timeline.document", { title: entry.document.title }),
      status: entry.document.deleted_at ? { tone: "muted", word: tr.text("documents.status.trashed") } : null,
      detail: tr.text(`documents.category.${entry.document.category}` as MessageKey),
    };
```

  - `author-mark.ts` `authorOf`: `case "document": return { kind: "person", personId: entry.document.created_by };`
  - `recent-rows.ts` `excerptOf`: `case "document": return null;`
  - `group-loaders.ts`: `loadGroupTimeline(db, accountId, contactIds, before?, groupId?: string)` passes `{ onError: …, groupId }` to `listTimelinePage`; `groups/[groupId]/page.tsx:104` becomes `ids ? loadGroupTimeline(db, accountId, ids, before, group.id) : noSet,`.
  - `activity-timeline.tsx` and `group-timeline.tsx`: add `FileText` to the `lucide-react` import (line 1-2) and, after `case "deal":`, `case "document": return <TimelineItem {...head} icon={FileText} />;`.
- [ ] **Step 5: Run** every test named above → PASS; the probes red by name. `pnpm --filter web typecheck` (the `Record<TimelineSource, MessageKey>` and every exhaustive `switch` now demand the new kind: a missed site is a compile error, which is the point).
- [ ] **Step 6: Commit.** `git commit -m "feat(record): document rows on the contact and group timelines, read under RLS (S-07 part 1)" -- packages/db/src/record.ts packages/db/src/test/record.test.ts packages/db/src/test/timeline-sources.test.ts apps/web/src/lib/record/timeline-rows.ts apps/web/src/lib/record/timeline-rows.test.ts apps/web/src/lib/record/author-mark.ts apps/web/src/lib/record/author-mark.test.ts apps/web/src/lib/record/recent-rows.ts apps/web/src/lib/record/recent-rows.test.ts apps/web/src/lib/record/group-loaders.ts apps/web/src/lib/record/group-loaders.test.ts "<…>/contacts/[contactId]/activity-timeline.tsx" "<…>/contacts/[contactId]/activity-timeline.rows.test.ts" "<…>/groups/[groupId]/group-timeline.tsx" "<…>/groups/[groupId]/group-timeline.test.ts" "<…>/groups/[groupId]/page.tsx"` (`<…>` = `apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]`).

Known edge (not fixed here, named in the PR): a group whose visible member set is EMPTY short-circuits `listTimelinePage` (`record.ts:323`) before any source runs, so its own documents do not reach its timeline; its Documents card still lists them.

---

## Task 9: The upload panel and the viewer (bis-frontend)

**Review:** sonnet.

**Files**
- Create: `…/accounts/contacts/document-upload-panel.tsx`, `document-upload-panel.test.ts`
- Create: `…/accounts/contacts/document-viewer.tsx`, `document-viewer.test.ts`

**Interfaces**
- Consumes: Task 4's `DocumentView`, `expiryView`/`expiryText`, `OFFICE_TYPES`, `isImageType`; Task 7's `UploadPhase`; Task 5's `getDocumentUrlAction`; `Button` (`components/ui/button.tsx`, `data-variant` on every button), `Checkbox` (`components/ui/checkbox.tsx`), `nativeFieldClass` (`components/ui/input.tsx:34`), `Dialog*` (`components/ui/dialog.tsx`), `Skeleton`; `t`, `plural`, `m`.
- Produces:

```ts
export type PanelFile = { key: string; file: File; title: string; category: DocumentCategory; phase: UploadPhase | null };
export function DocumentUploadPanel(p: {
  files: PanelFile[]; ownersOnly: boolean; expiresOn: string; canChooseOwnersOnly: boolean; busy: boolean; locale: Locale;
  onCategory: (key: string, c: DocumentCategory) => void; onRemove: (key: string) => void;
  onOwnersOnly: (v: boolean) => void; onExpires: (v: string) => void;
  onUpload: () => void; onRetry: (key: string) => void; onCancel: () => void;
}): JSX.Element;
export type ViewerState = { status: "loading" } | { status: "error" } | { status: "ready"; url: string; contentType: DocumentContentType };
export function DocumentViewerBody(p: { doc: DocumentView; state: ViewerState; locale: Locale; onRetry: () => void }): JSX.Element;
export function DocumentViewer(p: {
  accountId: string; doc: DocumentView | null; header: { source: string; expiry: string | null }; locale: Locale;
  onClose: () => void; onDownload: (doc: DocumentView) => void;
}): JSX.Element;
```

- [ ] **Step 1: Write the failing tests** (no DOM: `renderToStaticMarkup`, `renderedText`, as `styleguide/places-demo.test.ts:1-20`).

`document-upload-panel.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { m } from "@/lib/messages";
import { renderedText } from "@/lib/rendered-text";
import { DocumentUploadPanel, type PanelFile } from "./document-upload-panel";

const f = (key: string, name: string, phase: PanelFile["phase"] = null): PanelFile =>
  ({ key, file: new File([new Uint8Array(3)], name), title: name.replace(/\..*$/, ""), category: name.endsWith(".jpg") ? "photo" : "other", phase });
const noop = vi.fn();
const render = (over: Partial<Parameters<typeof DocumentUploadPanel>[0]> = {}) => renderToStaticMarkup(createElement(DocumentUploadPanel, {
  files: [f("a", "lease.pdf"), f("b", "roof.jpg")], ownersOnly: false, expiresOn: "", canChooseOwnersOnly: true, busy: false, locale: "en",
  onCategory: noop, onRemove: noop, onOwnersOnly: noop, onExpires: noop, onUpload: noop, onRetry: noop, onCancel: noop, ...over,
}));

describe("the upload panel (spec 4.2)", () => {
  it("one category select per file, defaulted; ONE primary button, the panel's Upload (rule 8; mutation: make Cancel default -> FAILS)", () => {
    const html = render();
    expect(html.match(/data-panel-file=/g)).toHaveLength(2);
    expect(html).toMatch(/<option value="other" selected="">/);
    expect(html).toMatch(/<option value="photo" selected="">/);
    expect(html.match(/data-variant="default"/g)).toHaveLength(1);
    expect(renderedText(html)).toContain(m["documents.upload"]);
  });
  it("Owners only is offered to an Owner only, once for the batch (mutation: drop the canChooseOwnersOnly guard -> FAILS)", () => {
    expect(render()).toContain("data-panel-owners-only");
    expect(render({ canChooseOwnersOnly: false })).not.toContain("data-panel-owners-only");
  });
  it("progress words, then a failed file keeps its reason and a ghost Retry; Spanish too (mutation: drop the failed branch -> FAILS)", () => {
    const html = render({ files: [f("a", "a.pdf", { kind: "uploading", percent: 45 }), f("b", "b.pdf", { kind: "checking" }),
      f("c", "c.pdf", { kind: "failed", error: "documents.error.tooLarge", params: { size: "31 MB" } })] });
    const text = renderedText(html);
    expect(text).toContain("Uploading 45%");
    expect(text).toContain(m["documents.progress.checking"]);
    expect(text).toContain("Too large: 31 MB. The limit is 25 MB.");
    expect(html).toMatch(/data-panel-retry[^>]*data-variant="ghost"|data-variant="ghost"[^>]*data-panel-retry/);
    expect(renderedText(render({ locale: "es", files: [f("a", "a.pdf", { kind: "checking" })] }))).toContain(m["documents.progress.checking.es"]);
  });
});
```

`document-viewer.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
vi.mock("./documents-actions", () => ({ getDocumentUrlAction: vi.fn() }));
const { m } = await import("@/lib/messages");
const { DocumentViewerBody } = await import("./document-viewer");

const doc = (contentType: string) => ({
  id: "d", title: "Lease", category: "contract" as const, expiresOn: null, ownersOnly: false, source: "upload" as const,
  addedBy: { you: true, name: null }, createdAt: "2026-10-01T00:00:00Z", deletedAt: null,
  version: { id: "v", contentType: contentType as never, bytes: 10 },
});
const body = (contentType: string, state: Parameters<typeof DocumentViewerBody>[0]["state"]) =>
  renderToStaticMarkup(createElement(DocumentViewerBody, { doc: doc(contentType), state, locale: "en", onRetry: vi.fn() }));

describe("the viewer's body (spec 4.3)", () => {
  it("an image renders inline from the minted URL; a PDF in a frame (mutation: render a PDF as <img> -> FAILS)", () => {
    expect(body("image/jpeg", { status: "ready", url: "https://s/x", contentType: "image/jpeg" })).toMatch(/<img[^>]+src="https:\/\/s\/x"/);
    expect(body("application/pdf", { status: "ready", url: "https://s/y", contentType: "application/pdf" })).toMatch(/<iframe[^>]+src="https:\/\/s\/y"/);
  });
  it("Word and Excel are never rendered: the sentence, no frame, no image (mutation: render office in the frame -> FAILS)", () => {
    const html = body("application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      { status: "ready", url: "https://s/z", contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" });
    expect(html).not.toMatch(/<iframe|<img/);
    expect(html).toContain(m["documents.viewer.noPreview"]);
  });
  it("loading is a skeleton, never a spinner; an error says so with Retry (rule 7, rule 5)", () => {
    expect(body("application/pdf", { status: "loading" })).toContain("data-viewer-skeleton");
    expect(body("application/pdf", { status: "error" })).toContain(m["documents.error.open"]);
  });
});
```

- [ ] **Step 2: Run, see both fail.**
- [ ] **Step 3: Write `document-upload-panel.tsx`:**

```tsx
"use client";

import { useId } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { nativeFieldClass } from "@/components/ui/input";
import { DOCUMENT_CATEGORIES, type DocumentCategory } from "@bis/db/document-rules";
import type { Locale } from "@/lib/i18n/locale";
import { t } from "@/lib/i18n/t";
import { m, type MessageKey } from "@/lib/messages";
import type { UploadPhase } from "@/lib/documents/upload-client";
import { cn } from "@/lib/utils";

/**
 * The inline batch panel (spec 4.2): one category per file, ONE Owners-only choice and ONE optional
 * expiry for the batch, made BEFORE the file exists (an Owners-only file is never visible to the team,
 * even briefly), then the card's one primary, Upload (rule 8). Presentational: the card holds the state.
 */
export type PanelFile = { key: string; file: File; title: string; category: DocumentCategory; phase: UploadPhase | null };

const focusRing = "outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50";

function phaseText(phase: UploadPhase | null, locale: Locale): string | null {
  if (!phase) return null;
  if (phase.kind === "uploading") return t(m, "documents.progress.uploading", locale, { percent: phase.percent });
  if (phase.kind === "checking") return t(m, "documents.progress.checking", locale);
  if (phase.kind === "failed") return t(m, phase.error as MessageKey, locale, phase.params);
  return null;
}

export function DocumentUploadPanel(p: {
  files: PanelFile[]; ownersOnly: boolean; expiresOn: string; canChooseOwnersOnly: boolean; busy: boolean; locale: Locale;
  onCategory: (key: string, c: DocumentCategory) => void; onRemove: (key: string) => void;
  onOwnersOnly: (v: boolean) => void; onExpires: (v: string) => void;
  onUpload: () => void; onRetry: (key: string) => void; onCancel: () => void;
}) {
  const id = useId();
  const tt = (key: MessageKey, params?: Record<string, string | number>) => t(m, key, p.locale, params);
  return (
    <div data-documents-panel className="space-y-3 rounded-[var(--radius-ctl)] border border-[var(--line)] bg-[var(--surface-2)] p-3">
      <ul className="space-y-2">
        {p.files.map((f) => {
          const status = phaseText(f.phase, p.locale);
          const failed = f.phase?.kind === "failed";
          return (
            <li key={f.key} data-panel-file={f.key} className="grid gap-1.5 border-t border-[var(--row-line)] pt-2 first:border-t-0 first:pt-0">
              <div className="flex min-w-0 items-center gap-2">
                <span lang="" className="min-w-0 flex-1 truncate text-sm text-card-foreground" title={f.file.name}>{f.file.name}</span>
                {!p.busy && !f.phase ? (
                  <Button type="button" variant="ghost" size="icon-sm" className={cn("min-h-11 md:min-h-8", focusRing)}
                    aria-label={tt("documents.removeFile", { name: f.file.name })} onClick={() => p.onRemove(f.key)}>
                    <X aria-hidden="true" />
                  </Button>
                ) : null}
              </div>
              <label className="grid gap-1 text-xs text-muted-foreground">
                {tt("documents.field.category")}
                <select className={cn(nativeFieldClass, "min-h-11 md:min-h-8")} value={f.category} disabled={p.busy}
                  onChange={(e) => p.onCategory(f.key, e.target.value as DocumentCategory)}>
                  {DOCUMENT_CATEGORIES.map((c) => (
                    <option key={c} value={c}>{tt(`documents.category.${c}` as MessageKey)}</option>
                  ))}
                </select>
              </label>
              {status ? (
                <div className="flex items-center gap-2 text-xs" aria-live="polite">
                  <span className={failed ? "text-[var(--crit)]" : "text-muted-foreground"}>{status}</span>
                  {f.phase?.kind === "uploading" ? (
                    <span aria-hidden="true" className="h-1 flex-1 overflow-hidden rounded-full bg-[var(--surface-3)]">
                      <span className="block h-full bg-[var(--accent)] motion-safe:transition-[width] motion-safe:duration-150" style={{ width: `${f.phase.percent}%` }} />
                    </span>
                  ) : null}
                  {failed ? (
                    <Button type="button" variant="ghost" size="sm" data-panel-retry className={cn("min-h-11 md:min-h-8", focusRing)}
                      onClick={() => p.onRetry(f.key)}>{tt("documents.retry")}</Button>
                  ) : null}
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
      {p.canChooseOwnersOnly ? (
        <label data-panel-owners-only className="flex items-center gap-2 text-sm">
          <Checkbox id={`${id}-owners`} checked={p.ownersOnly} disabled={p.busy} onCheckedChange={(v) => p.onOwnersOnly(v === true)} />
          {tt("documents.panel.ownersOnly")}
        </label>
      ) : null}
      <label className="grid gap-1 text-xs text-muted-foreground">
        {tt("documents.panel.expires")}
        <input type="date" className={cn(nativeFieldClass, "min-h-11 md:min-h-8")} value={p.expiresOn} disabled={p.busy}
          onChange={(e) => p.onExpires(e.target.value)} />
      </label>
      <div className="flex flex-wrap justify-end gap-2">
        <Button type="button" variant="ghost" className={cn("min-h-11 md:min-h-8", focusRing)} disabled={p.busy} onClick={p.onCancel}>
          {tt("documents.cancel")}
        </Button>
        <Button type="button" className={cn("min-h-11 md:min-h-8", focusRing)} disabled={p.busy || p.files.length === 0} onClick={p.onUpload}>
          {tt("documents.upload")}
        </Button>
      </div>
    </div>
  );
}
```

`document-viewer.tsx`:

```tsx
"use client";

import { useCallback, useEffect, useState } from "react";
import { Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { DocumentContentType } from "@bis/db/document-rules";
import type { Locale } from "@/lib/i18n/locale";
import { t } from "@/lib/i18n/t";
import { m, type MessageKey } from "@/lib/messages";
import { OFFICE_TYPES, isImageType } from "@/lib/documents/rules";
import type { DocumentView } from "@/lib/documents/documents-load";
import { getDocumentUrlAction } from "./documents-actions";

/**
 * The viewer (spec 4.3): a dialog over the page (Esc closes, the Dialog's own behaviour). Images and
 * PDFs show inline from a 120-second URL minted when it opens and again on Retry; Word and Excel are
 * never rendered, only downloaded. Versions arrive with PR 1b.
 */
export type ViewerState = { status: "loading" } | { status: "error" } | { status: "ready"; url: string; contentType: DocumentContentType };

export function DocumentViewerBody({ doc, state, locale, onRetry }: { doc: DocumentView; state: ViewerState; locale: Locale; onRetry: () => void }) {
  const tt = (key: MessageKey) => t(m, key, locale);
  if (OFFICE_TYPES.includes(doc.version.contentType)) {
    return <p className="text-sm text-muted-foreground">{tt("documents.viewer.noPreview")}</p>;
  }
  if (state.status === "loading") return <Skeleton data-viewer-skeleton className="h-[60vh] w-full rounded-[var(--radius-ctl)]" />;
  if (state.status === "error") {
    return (
      <div className="flex items-center gap-2 text-sm">
        <span>{tt("documents.error.open")}</span>
        <Button type="button" variant="ghost" size="sm" onClick={onRetry}>{tt("documents.retry")}</Button>
      </div>
    );
  }
  if (isImageType(state.contentType)) {
    // eslint-disable-next-line @next/next/no-img-element -- a short-lived private URL; next/image would cache it.
    return <img src={state.url} alt={doc.title} className="mx-auto max-h-[70vh] w-auto rounded-[var(--radius-ctl)]" onError={onRetry} />;
  }
  return <iframe src={state.url} title={doc.title} className="h-[70vh] w-full rounded-[var(--radius-ctl)] border border-[var(--line)]" />;
}

export function DocumentViewer({ accountId, doc, header, locale, onClose, onDownload }: {
  accountId: string; doc: DocumentView | null; header: { source: string; expiry: string | null }; locale: Locale;
  onClose: () => void; onDownload: (doc: DocumentView) => void;
}) {
  const [state, setState] = useState<ViewerState>({ status: "loading" });
  const versionId = doc?.version.id ?? null;
  const mint = useCallback(() => {
    if (!versionId) return;
    setState({ status: "loading" });
    void getDocumentUrlAction(accountId, versionId, "view")
      .then((r) => setState(r.ok ? { status: "ready", url: r.url, contentType: r.contentType } : { status: "error" }))
      .catch(() => setState({ status: "error" }));
  }, [accountId, versionId]);
  useEffect(() => {
    if (versionId && doc && !OFFICE_TYPES.includes(doc.version.contentType)) mint();
  }, [versionId, doc, mint]);
  const tt = (key: MessageKey) => t(m, key, locale);
  return (
    <Dialog open={doc !== null} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-w-3xl" data-document-viewer>
        {doc ? (
          <>
            <DialogHeader>
              <DialogTitle lang="">{doc.title}</DialogTitle>
              <DialogDescription className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <span>{tt(`documents.category.${doc.category}` as MessageKey)}</span>
                <span aria-hidden="true">·</span>
                <span>{header.source}</span>
                {header.expiry ? <><span aria-hidden="true">·</span><span>{header.expiry}</span></> : null}
                {doc.ownersOnly ? (
                  <span className="inline-flex items-center gap-1"><Lock aria-hidden="true" className="size-3" />{tt("documents.ownersOnly")}</span>
                ) : null}
              </DialogDescription>
            </DialogHeader>
            <DocumentViewerBody doc={doc} state={state} locale={locale} onRetry={mint} />
            <div className="flex justify-end">
              <Button type="button" className="min-h-11 md:min-h-8" onClick={() => onDownload(doc)}>{tt("documents.download")}</Button>
            </div>
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
```

(The viewer is its own view; Download is its one primary, rule 8.)

- [ ] **Step 4: Run** both tests → PASS; probes as named. eslint the two `.tsx` files; `pnpm --filter web typecheck`.
- [ ] **Step 5: Commit** the four files: `git add` the four, then `git commit -m "feat(documents): the upload panel and the viewer (S-07 part 1)" -- "apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/contacts/document-upload-panel.tsx" "apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/contacts/document-upload-panel.test.ts" "apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/contacts/document-viewer.tsx" "apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/contacts/document-viewer.test.ts"`

---

## Task 10: The Documents card, its handlers, and `/styleguide` (bis-frontend)

**Review:** opus.

**Files**
- Create: `…/accounts/contacts/documents-card.tsx`, `documents-card.test.ts`
- Create: `…/accounts/contacts/documents-card-handlers.ts`, `documents-card-handlers.test.ts`
- Create: `apps/web/src/app/(dashboard)/dashboard/styleguide/documents-demo.tsx`, `documents-demo.test.ts`
- Modify: `apps/web/src/app/(dashboard)/dashboard/styleguide/page.tsx` (one import beside `PlacesDemo`'s at `:49`, one section after `<PlacesDemo />` at `:259`)

**Interfaces**
- Consumes: Tasks 4–9; `InlineField` (`components/inline-field.tsx`: `rule`, `options`, `inputType: "date"`, `display: "date"`, `save` returning `{ ok: true; undoPayload; shown }`, `undoWith`, `locale`); `DropdownMenu*` (`components/ui/dropdown-menu.tsx`); `useLocale` (`components/locale-provider.tsx:17`); `toast` (`sonner`); `RecordCardSkeleton`, `RecordCardError` (`components/record/record-card.tsx:18-46`).
- Produces:

```ts
export type DocumentHandlers = {
  trash(doc: DocumentView): Promise<void>;
  restore(doc: DocumentView): Promise<void>;
  setOwnersOnly(doc: DocumentView, value: boolean): Promise<void>;
  download(doc: DocumentView): Promise<void>;
  changed(): void;
};
export function documentHandlers(a: { accountId: string; locale: Locale; reload: () => void; inFlight?: Set<string> }): DocumentHandlers;
export function documentsRouteFor(accountId: string, record: { kind: "contact" | "group"; id: string }): string;
export function addedWhen(createdAt: string, now: string, locale: Locale): string;   // Intl.RelativeTimeFormat, numeric "auto"
export function sourceLine(doc: DocumentView, now: string, locale: Locale): string;   // "Added by Ana · 3 days ago"
export type RowMenuItem = { id: "edit" | "ownersOnly" | "download" | "trash"; labelKey: MessageKey };
export function rowMenuItems(doc: DocumentView, canManage: boolean): RowMenuItem[];   // the row menu, in order; Owners only for canManage
export function DocumentsCardView(p: {
  accountId: string; load: DocumentsLoad; canManage: boolean; emptyText: string; locale: Locale; handlers: DocumentHandlers;
  onRetry: () => void; onFiles: (files: File[], source: "upload" | "camera") => void; onOpen: (doc: DocumentView) => void;
  panel: React.ReactNode | null;
}): JSX.Element;
export function DocumentsCard(p: { accountId: string; record: { kind: "contact" | "group"; id: string }; canManage: boolean; emptyText: string }): JSX.Element;
```

- [ ] **Step 1: Write the failing tests.**

`documents-card-handlers.test.ts` (sonner mocked; the toast's Undo is invoked by calling the captured `action.onClick`):

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
const toast = { success: vi.fn(), error: vi.fn(), info: vi.fn() };
vi.mock("sonner", () => ({ toast }));
const actions = {
  trashDocumentAction: vi.fn(), restoreDocumentAction: vi.fn(), setOwnersOnlyAction: vi.fn(), undoOwnersOnlyAction: vi.fn(),
  getDocumentUrlAction: vi.fn(),
};
vi.mock("./documents-actions", () => actions);
const { documentHandlers } = await import("./documents-card-handlers");
const { m } = await import("@/lib/messages");

const DOC = { id: "d1", title: "Lease", category: "contract" as const, expiresOn: null, ownersOnly: false, source: "upload" as const,
  addedBy: { you: true, name: null }, createdAt: "2026-10-01T00:00:00Z", deletedAt: null, version: { id: "v1", contentType: "application/pdf" as const, bytes: 1 } };
const undoOf = () => (toast.success.mock.calls.at(-1)![1] as { action: { onClick: () => void } }).action.onClick;
const flush = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => vi.clearAllMocks());

describe("trash, restore and Owners only run at once with an Undo (rule 6)", () => {
  it("Move to trash toasts with Undo; Undo restores against the instant the trash wrote (mutation: undo passes the row's old deletedAt -> FAILS)", async () => {
    const reload = vi.fn();
    actions.trashDocumentAction.mockResolvedValue({ ok: true, deletedAt: "2026-10-13T15:00:00.1+00:00" });
    actions.restoreDocumentAction.mockResolvedValue({ ok: true });
    const h = documentHandlers({ accountId: "acc", locale: "en", reload });
    await h.trash(DOC);
    expect(toast.success.mock.calls[0]![0]).toBe("Lease moved to the trash.");
    undoOf()();
    await flush();
    expect(actions.restoreDocumentAction).toHaveBeenCalledWith("acc", "d1", "2026-10-13T15:00:00.1+00:00");
    expect(reload).toHaveBeenCalledTimes(2);
  });
  it("an Undo that lost the race says so, in the reader's language (mutation: swallow the undo error -> FAILS)", async () => {
    actions.trashDocumentAction.mockResolvedValue({ ok: true, deletedAt: "x" });
    actions.restoreDocumentAction.mockResolvedValue({ ok: false, error: "documents.undoChanged" });
    const h = documentHandlers({ accountId: "acc", locale: "es", reload: vi.fn() });
    await h.trash(DOC);
    undoOf()();
    await flush();
    expect(toast.error).toHaveBeenCalledWith(m["documents.undoChanged.es"]);
  });
  it("Restore from the trash toasts with an Undo that trashes again (mutation: no Undo on restore -> FAILS)", async () => {
    actions.restoreDocumentAction.mockResolvedValue({ ok: true });
    actions.trashDocumentAction.mockResolvedValue({ ok: true, deletedAt: "y" });
    const h = documentHandlers({ accountId: "acc", locale: "en", reload: vi.fn() });
    await h.restore({ ...DOC, deletedAt: "2026-10-10T00:00:00Z" });
    expect(actions.restoreDocumentAction).toHaveBeenCalledWith("acc", "d1", "2026-10-10T00:00:00Z");
    undoOf()();
    await flush();
    expect(actions.trashDocumentAction).toHaveBeenCalledWith("acc", "d1");
  });
  it("Owners only: the Undo is a compare-and-set of prior against written (mutation: undo calls setOwnersOnlyAction(prior) blind -> FAILS)", async () => {
    actions.setOwnersOnlyAction.mockResolvedValue({ ok: true, prior: false });
    actions.undoOwnersOnlyAction.mockResolvedValue({ ok: true });
    const h = documentHandlers({ accountId: "acc", locale: "en", reload: vi.fn() });
    await h.setOwnersOnly(DOC, true);
    expect(toast.success.mock.calls[0]![0]).toBe("Lease is now Owners only.");
    undoOf()();
    await flush();
    expect(actions.undoOwnersOnlyAction).toHaveBeenCalledWith("acc", "d1", false, true);
  });
  it("a second click while a write is in flight does nothing (mutation: drop the inFlight guard -> FAILS)", async () => {
    let release!: (v: unknown) => void;
    actions.trashDocumentAction.mockReturnValue(new Promise((r) => { release = r; }));
    const h = documentHandlers({ accountId: "acc", locale: "en", reload: vi.fn() });
    const first = h.trash(DOC);
    await h.trash(DOC);
    release({ ok: true, deletedAt: "z" });
    await first;
    expect(actions.trashDocumentAction).toHaveBeenCalledTimes(1);
  });
});
```

`documents-card.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
vi.mock("./documents-actions", () => ({
  trashDocumentAction: vi.fn(), restoreDocumentAction: vi.fn(), setOwnersOnlyAction: vi.fn(), undoOwnersOnlyAction: vi.fn(),
  getDocumentUrlAction: vi.fn(), updateDocumentFieldAction: vi.fn(), undoDocumentFieldAction: vi.fn(),
  startDocumentUploadAction: vi.fn(), finishDocumentUploadAction: vi.fn(), abandonDocumentUploadAction: vi.fn(),
}));
const { m } = await import("@/lib/messages");
const { renderedText } = await import("@/lib/rendered-text");
const { DocumentsCardView, addedWhen, sourceLine, rowMenuItems } = await import("./documents-card");
type Load = Parameters<typeof DocumentsCardView>[0]["load"];

const view = (over: Record<string, unknown> = {}) => ({
  id: "d1", title: "Signed lease", category: "contract", expiresOn: null, ownersOnly: false, source: "upload",
  addedBy: { you: false, name: "Ana" }, createdAt: "2026-10-10T15:00:00.000Z", deletedAt: null,
  version: { id: "v1", contentType: "application/pdf", bytes: 1200 }, ...over,
});
const ready = (live: unknown[], trashed: unknown[] = []): Load => ({ status: "ready", data: {
  today: "2026-10-13", now: "2026-10-13T15:00:00.000Z", record: { kind: "contact", id: "c1" }, live, trashed, capped: false } } as Load);
const handlers = { trash: vi.fn(), restore: vi.fn(), setOwnersOnly: vi.fn(), download: vi.fn(), changed: vi.fn() };
const render = (load: Load, over: Record<string, unknown> = {}) => renderToStaticMarkup(createElement(DocumentsCardView, {
  accountId: "acc", load, canManage: true, emptyText: m["documents.empty.contact"], locale: "en", handlers,
  onRetry: vi.fn(), onFiles: vi.fn(), onOpen: vi.fn(), panel: null, ...over,
} as Parameters<typeof DocumentsCardView>[0]));

describe("the Documents card (spec 4.1, 4.5)", () => {
  it("loaded: newest first, count, category word, source line, ONE primary (Upload), Take photo is ghost (mutation: make Take photo default -> FAILS)", () => {
    const html = render(ready([view(), view({ id: "d2", title: "Roof", category: "photo", source: "camera", addedBy: { you: true, name: null } })]));
    const text = renderedText(html);
    expect(html.match(/data-document-row=/g)).toHaveLength(2);
    expect(text).toContain("2 files");
    expect(text).toContain("Contract");
    expect(text).toContain("Added by Ana · 3 days ago");
    expect(text).toContain("Photo taken by you · 3 days ago");
    expect(html.match(/data-variant="default"/g)).toHaveLength(1);
    expect(html).toMatch(/data-take-photo[^>]*data-variant="ghost"|data-variant="ghost"[^>]*data-take-photo/);
  });
  it("expiry: 12 days out is a dot AND the words; 31 days out is words with no dot (rule 3; mutation: drop the dot -> FAILS)", () => {
    const html = render(ready([view({ expiresOn: "2026-10-25" }), view({ id: "d2", expiresOn: "2026-11-13" }), view({ id: "d3", expiresOn: "2026-10-10" })]));
    expect(html.match(/data-expiry-dot/g)).toHaveLength(2);
    const text = renderedText(html);
    expect(text).toContain("Expires in 12 days");
    expect(text).toContain("Expires in 31 days");
    expect(text).toContain("Expired 3 days ago");
  });
  it("Owners only is a lock and the word (mutation: drop the word -> FAILS)", () => {
    const html = render(ready([view({ ownersOnly: true })]));
    expect(html).toContain("data-owners-only");
    expect(renderedText(html)).toContain(m["documents.ownersOnly"]);
  });
  it("trashed files leave the list and the count, and sit under Trash (n) with 'Deleted for good in N days' and Restore (mutation: count trashed files -> FAILS)", () => {
    const html = render(ready([view()], [view({ id: "t1", title: "Old ID", deletedAt: "2026-10-10T15:00:00.000Z" })]));
    const text = renderedText(html);
    expect(text).toContain("1 file");
    expect(text).toContain("Trash (1)");
    expect(text).toContain("Deleted for good in 27 days");
    expect(html.match(/data-document-row=/g)).toHaveLength(1);
    expect(html).toContain("data-document-restore");
  });
  it("empty: the spec's sentence and Upload; loading: skeleton rows; error: the card's own sentence with Retry (rule 5, rule 7)", () => {
    expect(renderedText(render(ready([])))).toContain(m["documents.empty.contact"]);
    expect(render({ status: "loading" })).toContain("data-documents-skeleton");
    expect(renderedText(render({ status: "error" }))).toContain(m["documents.loadFailed"]);
  });
  it("Spanish: the count, a category, the source line and an expiry (mutation: hard-code an English word -> FAILS)", () => {
    const text = renderedText(render(ready([view({ expiresOn: "2026-10-13" })]), { locale: "es", emptyText: m["documents.empty.contact.es"] }));
    expect(text).toContain(m["documents.countOne.es"].replace("{count}", "1"));
    expect(text).toContain(m["documents.category.contract.es"]);
    expect(text).toContain(m["documents.addedBy.es"].replace("{name}", "Ana").replace("{when}", "hace 3 días"));
    expect(text).toContain(m["documents.expires.today.es"]);
  });
  it("the row menu offers Owners only to an Owner only, with the word for the file's current state (mutation: drop the canManage guard in rowMenuItems -> FAILS)", () => {
    expect(rowMenuItems(view() as never, false).map((i) => i.id)).toEqual(["edit", "download", "trash"]);
    expect(rowMenuItems(view() as never, true).map((i) => [i.id, i.labelKey])).toEqual([
      ["edit", "documents.edit"], ["ownersOnly", "documents.makeOwnersOnly"], ["download", "documents.download"], ["trash", "documents.trash"]]);
    expect(rowMenuItems(view({ ownersOnly: true }) as never, true).find((i) => i.id === "ownersOnly")!.labelKey).toBe("documents.makeTeam");
  });
});

describe("addedWhen and sourceLine", () => {
  it("relative days in the reader's language; a name the reader cannot read is 'Someone on the team' (mutation: show null as blank -> FAILS)", () => {
    expect(addedWhen("2026-10-13T09:00:00.000Z", "2026-10-13T15:00:00.000Z", "en")).toBe("today");
    expect(addedWhen("2026-10-12T09:00:00.000Z", "2026-10-13T15:00:00.000Z", "es")).toBe("ayer");
    expect(sourceLine(view({ addedBy: { you: false, name: null } }) as never, "2026-10-13T15:00:00.000Z", "en")).toBe("Added by Someone on the team · 3 days ago");
  });
});
```

(The DropdownMenu content renders in a portal only when open, so the static render cannot see menu items: the menu's contents are the pure `rowMenuItems`, which the component maps one to one, and the test asserts on it.)

`styleguide/documents-demo.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
vi.mock("../accounts/[accountId]/contacts/documents-actions", () => ({
  trashDocumentAction: vi.fn(), restoreDocumentAction: vi.fn(), setOwnersOnlyAction: vi.fn(), undoOwnersOnlyAction: vi.fn(),
  getDocumentUrlAction: vi.fn(), updateDocumentFieldAction: vi.fn(), undoDocumentFieldAction: vi.fn(),
  startDocumentUploadAction: vi.fn(), finishDocumentUploadAction: vi.fn(), abandonDocumentUploadAction: vi.fn(),
}));
const { DocumentsDemo } = await import("./documents-demo");
const { m } = await import("@/lib/messages");
const { renderedText } = await import("@/lib/rendered-text");

describe("styleguide: the Documents card in every state (DoD: /styleguide gains the new component)", () => {
  const html = renderToStaticMarkup(createElement(DocumentsDemo));
  const text = renderedText(html);
  it("loaded in English and Spanish, empty, loading, error, and the upload panel with progress and a failure (mutation: drop a state -> FAILS)", () => {
    expect(html.match(/data-documents-card/g)).toHaveLength(5);
    expect(text).toContain(m["documents.empty.contact"]);
    expect(text).toContain(m["documents.loadFailed"]);
    expect(html).toContain("data-documents-skeleton");
    expect(html).toContain("data-documents-panel");
    expect(text).toContain(m["documents.error.quota"]);
    expect(text).toContain(m["documents.ownersOnly.es"]);
  });
});
```

- [ ] **Step 2: Run, see the three fail.**
- [ ] **Step 3: Write `documents-card-handlers.ts`:**

```ts
import { toast } from "sonner";
import type { Locale } from "@/lib/i18n/locale";
import { t } from "@/lib/i18n/t";
import { m, type MessageKey } from "@/lib/messages";
import type { DocumentView } from "@/lib/documents/documents-load";
import {
  trashDocumentAction, restoreDocumentAction, setOwnersOnlyAction, undoOwnersOnlyAction, getDocumentUrlAction,
} from "./documents-actions";

/**
 * What the Documents card does on trash, restore, Owners only and Download (spec 4.4, rule 6: at
 * once, every toast with an Undo, no "Are you sure?"). Each Undo is a compare-and-set on the server
 * (plan deviation 8): it changes nothing, and says so, when someone wrote after it. Kept out of the
 * component so it is tested without a DOM (places-card-handlers.ts's shape). `inFlight` ignores a
 * second click on a row whose write has not settled.
 */
export type DocumentHandlers = {
  trash(doc: DocumentView): Promise<void>;
  restore(doc: DocumentView): Promise<void>;
  setOwnersOnly(doc: DocumentView, value: boolean): Promise<void>;
  download(doc: DocumentView): Promise<void>;
  changed(): void;
};
type Answer = { ok: true } | { ok: false; error: string; params?: Record<string, string | number> };
const failed = { ok: false as const, error: "documents.error.failed" };

export function documentHandlers({ accountId, locale, reload, inFlight = new Set<string>() }: {
  accountId: string; locale: Locale; reload: () => void; inFlight?: Set<string>;
}): DocumentHandlers {
  const tt = (key: string, params?: Record<string, string | number>) => t(m, key as MessageKey, locale, params);
  const say = (a: { error: string; params?: Record<string, string | number> }) => toast.error(tt(a.error, a.params));
  async function once<R>(id: string, run: () => Promise<R>): Promise<R | null> {
    if (inFlight.has(id)) return null;
    inFlight.add(id);
    try { return await run(); } finally { inFlight.delete(id); }
  }
  function offer(message: string, row: string, undo: () => Promise<Answer>) {
    toast.success(message, { action: { label: tt("common.undo"), onClick: () => {
      void once(row, () => undo().catch(() => failed)).then((u) => { if (!u) return; if (u.ok) reload(); else say(u); });
    } } });
  }
  return {
    async trash(doc) {
      const r = await once(doc.id, () => trashDocumentAction(accountId, doc.id).catch(() => failed));
      if (!r) return;
      if (!r.ok) { say(r); return; }
      reload();
      offer(tt("documents.trashed", { title: doc.title }), doc.id, () => restoreDocumentAction(accountId, doc.id, r.deletedAt));
    },
    async restore(doc) {
      if (!doc.deletedAt) return;
      const r = await once(doc.id, () => restoreDocumentAction(accountId, doc.id, doc.deletedAt!).catch(() => failed));
      if (!r) return;
      if (!r.ok) { say(r.error === "documents.undoChanged" ? failed : r); reload(); return; }
      reload();
      offer(tt("documents.restored", { title: doc.title }), doc.id, async () => {
        const again = await trashDocumentAction(accountId, doc.id);
        return again.ok ? { ok: true } : again;
      });
    },
    async setOwnersOnly(doc, value) {
      const r = await once(doc.id, () => setOwnersOnlyAction(accountId, doc.id, value).catch(() => failed));
      if (!r) return;
      if (!r.ok) { say(r); return; }
      reload();
      offer(tt(value ? "documents.madeOwnersOnly" : "documents.madeTeam", { title: doc.title }), doc.id,
        () => undoOwnersOnlyAction(accountId, doc.id, r.prior, value));
    },
    async download(doc) {
      const r = await getDocumentUrlAction(accountId, doc.version.id, "download").catch(() => ({ ok: false as const, error: "documents.error.open" }));
      if (!r.ok) { say(r); return; }
      window.location.assign(r.url);
    },
    changed: reload,
  };
}
```

- [ ] **Step 4: Write `documents-card.tsx`:**

```tsx
"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { FileText, Lock, MoreHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { InlineField } from "@/components/inline-field";
import { RecordCardSkeleton, RecordCardError } from "@/components/record/record-card";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useLocale } from "@/components/locale-provider";
import { DOCUMENT_CATEGORIES, type DocumentCategory } from "@bis/db/document-rules";
import type { Locale } from "@/lib/i18n/locale";
import { t, plural } from "@/lib/i18n/t";
import { m, type MessageKey } from "@/lib/messages";
import { cn } from "@/lib/utils";
import { documentsLoadFrom, type DocumentsLoad, type DocumentView } from "@/lib/documents/documents-load";
import { expiryView, expiryText, purgeDaysLeft, purgeText } from "@/lib/documents/expiry";
import { MAX_BATCH, defaultCategory, titleFromFileName, typeForFile } from "@/lib/documents/rules";
import { browserDeps, uploadOne, type UploadBatch } from "@/lib/documents/upload-client";
import { updateDocumentFieldAction, undoDocumentFieldAction } from "./documents-actions";
import { documentHandlers, type DocumentHandlers } from "./documents-card-handlers";
import { DocumentUploadPanel, type PanelFile } from "./document-upload-panel";
import { DocumentViewer } from "./document-viewer";
import { toast } from "sonner";

export type { DocumentHandlers } from "./documents-card-handlers";

/** The card's own read (spec 4.5): a contact's route or the group's own. */
export function documentsRouteFor(accountId: string, record: { kind: "contact" | "group"; id: string }): string {
  return record.kind === "group" ? `/api/accounts/${accountId}/groups/${record.id}/documents` : `/api/accounts/${accountId}/contacts/${record.id}/documents`;
}

const DAY_MS = 86_400_000;
export function addedWhen(createdAt: string, now: string, locale: Locale): string {
  const days = Math.floor((Date.parse(now) - Date.parse(createdAt)) / DAY_MS);
  return new Intl.RelativeTimeFormat(locale === "es" ? "es-US" : "en-US", { numeric: "auto" }).format(-Math.max(0, days), "day");
}
export function sourceLine(doc: DocumentView, now: string, locale: Locale): string {
  const name = doc.addedBy.you ? t(m, "documents.you", locale) : doc.addedBy.name ?? t(m, "assign.someone", locale);
  return t(m, doc.source === "camera" ? "documents.photoBy" : "documents.addedBy", locale, { name, when: addedWhen(doc.createdAt, now, locale) });
}

/** The row menu (spec 4.1), as data: the component maps it one to one, and the test reads it. Owners only is the Owner's and the agency's. */
export type RowMenuItem = { id: "edit" | "ownersOnly" | "download" | "trash"; labelKey: MessageKey };
export function rowMenuItems(doc: DocumentView, canManage: boolean): RowMenuItem[] {
  return [
    { id: "edit", labelKey: "documents.edit" },
    ...(canManage ? [{ id: "ownersOnly" as const, labelKey: (doc.ownersOnly ? "documents.makeTeam" : "documents.makeOwnersOnly") as MessageKey }] : []),
    { id: "download", labelKey: "documents.download" },
    { id: "trash", labelKey: "documents.trash" },
  ];
}

const focusRing = "outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50";
const control = cn("min-h-11 md:min-h-8", focusRing);
const ACCEPT = ".pdf,.jpg,.jpeg,.png,.webp,.docx,.xlsx,application/pdf,image/jpeg,image/png,image/webp";

function ExpiryLine({ expiresOn, today, locale }: { expiresOn: string | null; today: string; locale: Locale }) {
  const v = expiryView(expiresOn, today);
  if (!v) return null;
  return (
    <span className="inline-flex items-center gap-1">
      {v.soon ? <span data-expiry-dot aria-hidden="true" className={cn("size-1.5 rounded-full", v.band === "past" ? "bg-[var(--crit)]" : "bg-[var(--warn)]")} /> : null}
      {expiryText(v, locale)}
    </span>
  );
}

function DocumentRow({ accountId, doc, today, now, canManage, locale, handlers, onOpen }: {
  accountId: string; doc: DocumentView; today: string; now: string; canManage: boolean; locale: Locale;
  handlers: DocumentHandlers; onOpen: (d: DocumentView) => void;
}) {
  const tt = (key: MessageKey, params?: Record<string, string | number>) => t(m, key, locale, params);
  const [editing, setEditing] = useState(false);
  const save = (field: "title" | "category" | "expires_on") => async (value: string) => {
    const r = await updateDocumentFieldAction(accountId, doc.id, field, value).catch(() => ({ ok: false as const, error: "documents.error.failed" }));
    if (!r.ok) return { ok: false as const, error: tt(r.error as MessageKey, "params" in r ? r.params : undefined) };
    handlers.changed();
    return { ok: true as const, undoPayload: r.undoPayload, shown: r.shown };
  };
  const undoWith = async (payload: unknown) => {
    const r = await undoDocumentFieldAction(accountId, payload).catch(() => ({ ok: false as const, error: "documents.error.failed" }));
    if (r.ok) handlers.changed();
    return r.ok ? { ok: true as const } : { ok: false as const, error: tt(r.error as MessageKey) };
  };
  return (
    <li data-document-row={doc.id} className="relative border-t border-[var(--row-line)] first:border-t-0 hover:bg-[var(--surface-3)] motion-safe:transition-colors motion-safe:duration-150">
      <div className="flex items-start gap-2 px-1 py-2">
        <FileText aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
        <button type="button" onClick={() => onOpen(doc)} aria-label={tt("documents.open", { title: doc.title })}
          className={cn("min-w-0 flex-1 rounded-[var(--radius-ctl)] text-left after:absolute after:inset-0 after:content-['']", focusRing)}>
          <span lang="" className="block truncate text-sm font-medium text-card-foreground">{doc.title}</span>
          <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
            <span>{tt(`documents.category.${doc.category}` as MessageKey)}</span>
            <span aria-hidden="true">·</span>
            <span>{sourceLine(doc, now, locale)}</span>
            <ExpiryLine expiresOn={doc.expiresOn} today={today} locale={locale} />
            {doc.ownersOnly ? (
              <span data-owners-only className="inline-flex items-center gap-1"><Lock aria-hidden="true" className="size-3" />{tt("documents.ownersOnly")}</span>
            ) : null}
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
              <DropdownMenuItem key={item.id} onSelect={() => {
                if (item.id === "edit") setEditing((e) => !e);
                else if (item.id === "ownersOnly") void handlers.setOwnersOnly(doc, !doc.ownersOnly);
                else if (item.id === "download") void handlers.download(doc);
                else void handlers.trash(doc);
              }}>{tt(item.labelKey)}</DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      {editing ? (
        <dl className="relative z-10 grid grid-cols-1 gap-1 px-1 pb-2 text-sm">
          <InlineField label={tt("documents.field.title")} value={doc.title} rule={{ kind: "text", max: 200, required: true }}
            save={save("title")} undoWith={undoWith} locale={locale} />
          <InlineField label={tt("documents.field.category")} value={doc.category}
            options={DOCUMENT_CATEGORIES.map((c) => ({ value: c, label: tt(`documents.category.${c}` as MessageKey) }))}
            save={save("category")} undoWith={undoWith} locale={locale} />
          <InlineField label={tt("documents.field.expires")} value={doc.expiresOn} rule={{ kind: "date", required: false }}
            inputType="date" display="date" save={save("expires_on")} undoWith={undoWith} locale={locale} />
        </dl>
      ) : null}
    </li>
  );
}

export function DocumentsCardView(p: {
  accountId: string; load: DocumentsLoad; canManage: boolean; emptyText: string; locale: Locale; handlers: DocumentHandlers;
  onRetry: () => void; onFiles: (files: File[], source: "upload" | "camera") => void; onOpen: (doc: DocumentView) => void;
  panel: ReactNode | null;
}) {
  const tt = (key: MessageKey, params?: Record<string, string | number>) => t(m, key, p.locale, params);
  const uploadRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const pick = (source: "upload" | "camera") => (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = [...(e.target.files ?? [])];
    e.target.value = "";
    if (files.length > 0) p.onFiles(files, source);
  };
  if (p.load.status === "loading") return <div data-documents-card><div data-documents-skeleton><RecordCardSkeleton rows={3} /></div></div>;
  if (p.load.status === "error") {
    return <div data-documents-card><RecordCardError text={tt("documents.loadFailed")} retryLabel={tt("documents.retry")} onRetry={p.onRetry} /></div>;
  }
  const { data } = p.load;
  return (
    <div data-documents-card
      className={cn("space-y-2 rounded-[var(--radius-ctl)]", dragging && "ring-[3px] ring-ring/50")}
      onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => { e.preventDefault(); setDragging(false); const files = [...e.dataTransfer.files]; if (files.length) p.onFiles(files, "upload"); }}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs text-muted-foreground tabular-nums">{plural(m, "documents.count", data.live.length, p.locale, { count: data.live.length })}</span>
        {p.panel ? null : (
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="ghost" data-take-photo className={cn("hidden max-md:inline-flex [@media(pointer:coarse)]:inline-flex", control)}
              onClick={() => cameraRef.current?.click()}>{tt("documents.takePhoto")}</Button>
            <Button type="button" className={control} onClick={() => uploadRef.current?.click()}>{tt("documents.upload")}</Button>
          </div>
        )}
        <input ref={uploadRef} type="file" multiple accept={ACCEPT} hidden onChange={pick("upload")} />
        <input ref={cameraRef} type="file" accept="image/*" capture="environment" hidden onChange={pick("camera")} />
      </div>
      {p.panel}
      {data.live.length === 0 && !p.panel ? (
        <p className="text-sm text-muted-foreground">{p.emptyText}</p>
      ) : (
        <ul>
          {data.live.map((doc) => (
            <DocumentRow key={doc.id} accountId={p.accountId} doc={doc} today={data.today} now={data.now} canManage={p.canManage}
              locale={p.locale} handlers={p.handlers} onOpen={p.onOpen} />
          ))}
        </ul>
      )}
      {data.capped ? <p className="text-xs text-muted-foreground">{tt("documents.capped")}</p> : null}
      {data.trashed.length > 0 ? (
        <details data-documents-trash className="text-sm">
          <summary className={cn("cursor-pointer rounded-[var(--radius-ctl)] text-xs text-muted-foreground", focusRing)}>
            {tt("documents.trashList", { count: data.trashed.length })}
          </summary>
          <ul className="mt-1">
            {data.trashed.map((doc) => (
              <li key={doc.id} data-document-trashed={doc.id} className="flex items-center gap-2 border-t border-[var(--row-line)] py-1.5 first:border-t-0">
                <span className="min-w-0 flex-1">
                  <span lang="" className="block truncate text-card-foreground">{doc.title}</span>
                  <span className="text-xs text-muted-foreground">{purgeText(purgeDaysLeft(doc.deletedAt!, data.now), p.locale)}</span>
                </span>
                <Button type="button" variant="ghost" size="sm" data-document-restore className={control}
                  onClick={() => void p.handlers.restore(doc)}>{tt("documents.restore")}</Button>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  );
}

let panelSeq = 0;

/** The container: reads its own route, holds the upload panel's state and the viewer. */
export function DocumentsCard({ accountId, record, canManage, emptyText }: {
  accountId: string; record: { kind: "contact" | "group"; id: string }; canManage: boolean; emptyText: string;
}) {
  const locale = useLocale();
  const [load, setLoad] = useState<DocumentsLoad>({ status: "loading" });
  const [tick, setTick] = useState(0);
  const reload = useCallback(() => setTick((n) => n + 1), []);
  const inFlight = useRef(new Set<string>()).current;
  const handlers = useMemo(() => documentHandlers({ accountId, locale, reload, inFlight }), [accountId, locale, reload, inFlight]);
  const [files, setFiles] = useState<PanelFile[]>([]);
  const [source, setSource] = useState<"upload" | "camera">("upload");
  const [ownersOnly, setOwnersOnly] = useState(false);
  const [expiresOn, setExpiresOn] = useState("");
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState<DocumentView | null>(null);

  useEffect(() => {
    let live = true;
    void fetch(documentsRouteFor(accountId, record), { cache: "no-store" })
      .then(documentsLoadFrom).catch((): DocumentsLoad => ({ status: "error" }))
      .then((l) => { if (live) setLoad(l); });
    return () => { live = false; };
  }, [accountId, record.kind, record.id, tick]); // eslint-disable-line react-hooks/exhaustive-deps

  const onFiles = (chosen: File[], from: "upload" | "camera") => {
    if (chosen.length > MAX_BATCH) { toast.error(t(m, "documents.error.tooMany", locale)); return; }
    setSource(from);
    setFiles(chosen.map((file) => {
      const type = typeForFile(file.name, file.type);
      const category: DocumentCategory = type ? defaultCategory(type) : "other";
      return { key: `f${++panelSeq}`, file, title: titleFromFileName(file.name) ?? t(m, "documents.untitled", locale), category, phase: null };
    }));
  };
  const setPhase = (key: string, phase: PanelFile["phase"]) => setFiles((fs) => fs.map((f) => (f.key === key ? { ...f, phase } : f)));
  const runOne = async (f: PanelFile, batch: UploadBatch) => {
    const end = await uploadOne(accountId, { file: f.file, title: f.title, category: f.category }, batch, browserDeps(), (ph) => setPhase(f.key, ph));
    setPhase(f.key, end);
    return end.kind === "done";
  };
  const batch = (): UploadBatch => ({ record, ownersOnly: canManage && ownersOnly, expiresOn: expiresOn || null, source });
  const onUpload = async () => {
    setBusy(true);
    const results: [string, boolean][] = [];
    for (const f of files) results.push([f.key, await runOne(f, batch())]);
    setBusy(false);
    reload();
    const done = new Set(results.filter(([, ok]) => ok).map(([k]) => k));
    setFiles((fs) => fs.filter((f) => !done.has(f.key)));
  };
  const onRetry = async (key: string) => {
    const f = files.find((x) => x.key === key);
    if (!f) return;
    setBusy(true);
    const ok = await runOne(f, batch());
    setBusy(false);
    if (ok) { reload(); setFiles((fs) => fs.filter((x) => x.key !== key)); }
  };
  const panel = files.length > 0 ? (
    <DocumentUploadPanel files={files} ownersOnly={ownersOnly} expiresOn={expiresOn} canChooseOwnersOnly={canManage} busy={busy} locale={locale}
      onCategory={(k, c) => setFiles((fs) => fs.map((f) => (f.key === k ? { ...f, category: c } : f)))}
      onRemove={(k) => setFiles((fs) => fs.filter((f) => f.key !== k))}
      onOwnersOnly={setOwnersOnly} onExpires={setExpiresOn} onUpload={() => void onUpload()} onRetry={(k) => void onRetry(k)}
      onCancel={() => { setFiles([]); setOwnersOnly(false); setExpiresOn(""); }} />
  ) : null;
  const now = load.status === "ready" ? load.data.now : new Date().toISOString();
  const today = load.status === "ready" ? load.data.today : now.slice(0, 10);
  const expiryLine = open ? expiryView(open.expiresOn, today) : null;
  return (
    <>
      <DocumentsCardView accountId={accountId} load={load} canManage={canManage} emptyText={emptyText} locale={locale} handlers={handlers}
        onRetry={reload} onFiles={onFiles} onOpen={setOpen} panel={panel} />
      <DocumentViewer accountId={accountId} doc={open} locale={locale} onClose={() => setOpen(null)} onDownload={(d) => void handlers.download(d)}
        header={{ source: open ? sourceLine(open, now, locale) : "", expiry: expiryLine ? expiryText(expiryLine, locale) : null }} />
    </>
  );
}
```

- [ ] **Step 5: `styleguide/documents-demo.tsx`** (client component; handlers are no-ops, as `places-demo.tsx:44-55`):

```tsx
"use client";

import type { DocumentsLoad } from "@/lib/documents/documents-load";
import { DocumentsCardView } from "../accounts/[accountId]/contacts/documents-card";
import { DocumentUploadPanel } from "../accounts/[accountId]/contacts/document-upload-panel";
import { m } from "@/lib/messages";

/**
 * The Documents card (S-07 part 1, spec 4) in every state it has, in both languages, and its upload
 * panel mid-batch. Tab through it to see the focus rings; the expiry dots are the warn and crit tokens.
 */
const base = { addedBy: { you: false, name: "Ana" }, deletedAt: null, ownersOnly: false, source: "upload" as const, expiresOn: null,
  version: { id: "sg-v", contentType: "application/pdf" as const, bytes: 120_000 } };
const READY: DocumentsLoad = { status: "ready", data: {
  today: "2026-10-13", now: "2026-10-13T15:00:00.000Z", record: { kind: "contact", id: "sg-c" }, capped: false,
  live: [
    { ...base, id: "sg-1", title: "Signed contract", category: "contract", createdAt: "2026-10-10T15:00:00.000Z", expiresOn: "2026-10-25" },
    { ...base, id: "sg-2", title: "Roof, before", category: "photo", source: "camera", createdAt: "2026-10-12T15:00:00.000Z",
      addedBy: { you: true, name: null }, version: { id: "sg-v2", contentType: "image/jpeg", bytes: 800_000 } },
    { ...base, id: "sg-3", title: "Driver's license", category: "id", createdAt: "2026-09-01T15:00:00.000Z", ownersOnly: true, expiresOn: "2026-10-01" },
  ],
  trashed: [{ ...base, id: "sg-4", title: "Old estimate", category: "estimate", createdAt: "2026-08-01T15:00:00.000Z", deletedAt: "2026-10-10T15:00:00.000Z" }],
} };
const EMPTY: DocumentsLoad = { status: "ready", data: { ...(READY as Extract<DocumentsLoad, { status: "ready" }>).data, live: [], trashed: [] } };
const noop = () => {};
const handlers = { trash: async () => {}, restore: async () => {}, setOwnersOnly: async () => {}, download: async () => {}, changed: noop };
const common = { accountId: "sg", canManage: true, handlers, onRetry: noop, onFiles: noop, onOpen: noop, panel: null };
const box = "min-w-0 rounded-[var(--radius-card)] border border-border p-4";
const file = (name: string) => new File([new Uint8Array(1)], name);

export function DocumentsDemo() {
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <div className={box}><DocumentsCardView {...common} load={READY} emptyText={m["documents.empty.contact"]} locale="en" /></div>
      <div className={box} lang="es"><DocumentsCardView {...common} load={READY} emptyText={m["documents.empty.contact.es"]} locale="es" /></div>
      <div className={box}><DocumentsCardView {...common} load={EMPTY} emptyText={m["documents.empty.contact"]} locale="en" /></div>
      <div className={box}><DocumentsCardView {...common} load={{ status: "loading" }} emptyText="" locale="en" /></div>
      <div className={box}><DocumentsCardView {...common} load={{ status: "error" }} emptyText="" locale="en" /></div>
      <div className={box}>
        <DocumentUploadPanel locale="en" ownersOnly expiresOn="" canChooseOwnersOnly busy={false}
          files={[
            { key: "a", file: file("lease.pdf"), title: "lease", category: "contract", phase: { kind: "uploading", percent: 45 } },
            { key: "b", file: file("roof.jpg"), title: "roof", category: "photo", phase: { kind: "checking" } },
            { key: "c", file: file("plans.pdf"), title: "plans", category: "other", phase: { kind: "failed", error: "documents.error.quota" } },
          ]}
          onCategory={noop} onRemove={noop} onOwnersOnly={noop} onExpires={noop} onUpload={noop} onRetry={noop} onCancel={noop} />
      </div>
    </div>
  );
}
```

In `styleguide/page.tsx`: `import { DocumentsDemo } from "./documents-demo";` beside `PlacesDemo`'s import (`:49`), and after the section holding `<PlacesDemo />` (`:259`) a section of the same shape (`aria-labelledby="sg-documents"`, `data-testid="styleguide-documents"`, heading "Documents card" — the styleguide is agency-only and English, the existing sections' convention) holding `<DocumentsDemo />`.

- [ ] **Step 6: Run** the three tests → PASS; probes as named. eslint every touched `.tsx`; `pnpm --filter web typecheck`; `pnpm --filter web exec vitest run src/components/ui/material.test.ts` (radii guard) → PASS.
- [ ] **Step 7: Commit** the six new files and `styleguide/page.tsx`: `git add` the six new files, then `git commit -m "feat(documents): the Documents card, its rows, trash and Undo toasts, and its styleguide entry (S-07 part 1)" -- "apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/contacts/documents-card.tsx" "apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/contacts/documents-card.test.ts" "apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/contacts/documents-card-handlers.ts" "apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/contacts/documents-card-handlers.test.ts" "apps/web/src/app/(dashboard)/dashboard/styleguide/documents-demo.tsx" "apps/web/src/app/(dashboard)/dashboard/styleguide/documents-demo.test.ts" "apps/web/src/app/(dashboard)/dashboard/styleguide/page.tsx"`

---

## Task 11: The card on both record pages (bis-crm)

**Review:** sonnet.

**Files**
- Modify: `apps/web/src/lib/record/record-cards.ts:4-7,16-37` and `record-cards.test.ts:12,23,49,52-58,66,76`
- Modify: `…/accounts/contacts/[contactId]/page.tsx:191-251` (the `slots` object) and `page.test.ts:617,663`
- Modify: `…/accounts/groups/[groupId]/page.tsx:189-236` (the `slots` object), `page.test.ts:271`, `loading.test.ts:27`

**Interfaces**
- Consumes: Task 10's `DocumentsCard`; `access.canManage` (`lib/auth.ts:36-61`); the group's `kind` (`groups/[groupId]/page.tsx:72`).
- Produces: `RecordCardId` and `GroupRecordCardId` gain `"documents"`.

- [ ] **Step 1: Write the failing tests.** In `record-cards.test.ts`:
  - `:12` phone order becomes `["summary", "next-up", "timeline", "groups", "properties", "deals", "documents", "details", "tags", "related-people"]`;
  - `:23` collapsible set becomes `["deals", "documents", "groups", "properties"]`;
  - `:49` group phone order becomes `["summary", "next-up", "timeline", "properties", "deals", "documents", "people", "details"]`;
  - `:66` group collapsible set becomes `["deals", "documents", "properties"]`;
  - `:76` the contact's runs list gains `"documents"` after `"deals"` in the "have" run;
  - new case: `it("the Documents card sits last in 'what they have' on both pages, closed on a phone, titled documents.title (spec 4.1; mutation: put it in the who column -> FAILS)", () => { for (const cards of [RECORD_CARDS, GROUP_RECORD_CARDS]) { const d = cards.find((c) => c.id === "documents")!; expect([d.column, d.collapsibleOnPhone, d.titleKey, d.skeletonRows]).toEqual(["have", true, "documents.title", 3]); const have = cards.filter((c) => c.column === "have").sort((a, b) => a.deskOrder - b.deskOrder); expect(have.at(-1)!.id).toBe("documents"); } });`
  - In `[contactId]/page.test.ts:617` the slice becomes `slice(3, 7)` → `["groups", "properties", "deals", "documents"]`; `:663` gains `"documents"` after `"deals"`. Add one case: the rendered page holds `data-record-card="documents"` and the `DocumentsCard` mock (mock `../documents-card` with `DocumentsCard: (p) => createElement("div", { "data-documents-mock": JSON.stringify(p) })`) receives `{ accountId, record: { kind: "contact", id: <contact id> }, canManage, emptyText: m["documents.empty.contact"] }` (mutation: pass `canManage: true` always → FAILS for a Staff `requireAccountAccess` stub).
  - In `groups/[groupId]/page.test.ts:271` and `loading.test.ts:27` the order gains `"documents"` after `"deals"`; add the same props case for a household (`emptyText: m["documents.empty.household"]`, `record: { kind: "group", id }`) and one for a business (`m["documents.empty.business"]`) (mutation: use the household sentence for both → FAILS).
- [ ] **Step 2: Run, see them fail.**
- [ ] **Step 3: `record-cards.ts`:** `RecordCardId` gains `| "documents"`; `GroupRecordCardId` gains `| "documents"`. `RECORD_CARDS`: after the `deals` row insert `{ id: "documents", column: "have", deskOrder: 4, phoneOrder: 7, collapsibleOnPhone: true, titleKey: "documents.title", skeletonRows: 3 },` and renumber `details`, `tags`, `related-people` to phoneOrder 8, 9, 10. `GROUP_RECORD_CARDS`: after `deals` insert `{ id: "documents", column: "have", deskOrder: 3, phoneOrder: 6, collapsibleOnPhone: true, titleKey: "documents.title", skeletonRows: 3 },` and renumber `people`, `details` to 7, 8.
- [ ] **Step 4: The slots.** Contact page (`[contactId]/page.tsx`): `import { DocumentsCard } from "../documents-card";` beside `PlacesCard`'s import (`:31`), and in `slots` after `properties` (`:235`):

```tsx
    documents: {
      node: <DocumentsCard accountId={accountId} record={{ kind: "contact", id: contactId }} canManage={access.canManage}
        emptyText={tr.text("documents.empty.contact")} />,
    },
```

(`access` is the page's `requireAccountAccess(accountId)` result; read its variable name at the top of the page's function and use it.) Group page (`groups/[groupId]/page.tsx`): `import { DocumentsCard } from "../../contacts/documents-card";` beside `PlacesCard`'s (`:31`); a `DOCUMENTS_EMPTY_KEY = { household: "documents.empty.household", business: "documents.empty.business" } as const satisfies Record<GroupKind, MessageKey>;` beside `PLACES_EMPTY_KEY` (`:46-48`); in `slots` after `properties` (`:213-216`):

```tsx
    documents: {
      node: <DocumentsCard accountId={accountId} record={{ kind: "group", id: group.id }} canManage={access.canManage}
        emptyText={tr.text(DOCUMENTS_EMPTY_KEY[group.kind])} />,
    },
```

The `satisfies Record<RecordCardId, Slot>` / `Record<GroupRecordCardId, Slot>` on each `slots` makes a missing slot a compile error. Both `loading.tsx` files render from the card lists and need no edit.
- [ ] **Step 5: Run** every test above, `pnpm --filter web typecheck`, eslint on the touched files → clean; probes red by name.
- [ ] **Step 6: Commit.** `git commit -m "feat(record): the Documents card in 'what they have' on the contact and group pages (S-07 part 1)" -- apps/web/src/lib/record/record-cards.ts apps/web/src/lib/record/record-cards.test.ts "<…>/contacts/[contactId]/page.tsx" "<…>/contacts/[contactId]/page.test.ts" "<…>/groups/[groupId]/page.tsx" "<…>/groups/[groupId]/page.test.ts" "<…>/groups/[groupId]/loading.test.ts"`

---

## Task 12: The sweep pass (bis-automations)

**Review:** sonnet. **Runs beside:** Tasks 4 and 8 (after Task 3).

**Files**
- Create: `apps/web/src/lib/automations/passes/documents-sweep.ts`, `documents-sweep.test.ts`
- Modify: `apps/web/src/lib/automations/registry.ts:1-16,18-54` (one import, one doc sentence, one entry after `siteTrafficPass`)
- Modify: `apps/web/src/lib/automations/cron-coupling.test.ts` (one case)
- Modify: `apps/web/src/lib/automations/sentinel.test.ts` (its `dbMocks` gain the two sweep reads answering `[]`; the registry's pinned key list at `:274` gains `"documentsSweep"` after `"siteTraffic"`)

**Interfaces**
- Consumes: Task 3's `listAbandonedUploads`, `deleteAbandonedVersion`, `listPurgeableDocuments`, `purgeDocumentRow`, `DOCUMENT_BUCKET`, `DOCUMENT_TRASH_DAYS`; `Pass`, `PassContext` (`context.ts:15-58`); `runPasses` (`harness.ts:29-50`: a pass that THROWS is recorded `{ errored: 1 }` and its heartbeat `ok: false`); `CRON_PASS_FAILURES_TO_ALERT = 2` (`lib/ops/watch.ts:52-56`: opsWatch alerts when a `cron.pass.*` key fails twice in a row).
- Produces: `documentsSweepPass: Pass` (key `"documentsSweep"`); `ABANDONED_UPLOAD_MS = 10_800_000` (3 h); `SIGNED_UPLOAD_URL_MS = 7_200_000` (storage-js: a signed upload URL is "valid for 2 hours", `@supabase/storage-js` 2.110.8 `dist/index.mjs:792-793`); `DOCUMENTS_SWEEP_BATCH = 200`. Counters: `abandoned, purged, objectDeleteFailed, rowDeleteFailed`.

**How a failure reaches the agency (deviation 4, as revised by plan review I4).** The pass runs on EVERY tick; with nothing due it is two indexed reads (`document_versions_uploading`, `documents_trashed`, Task 1) and writes nothing. A run that counted any failure logs its counters and then THROWS, so `runPasses` marks the heartbeat failed; the row stays and the next tick (15 minutes later) tries again; a second failing tick in a row is opsWatch's alert. A one-off blip heals on the next tick without an alert.

- [ ] **Step 1: Write the failing tests.** `passes/documents-sweep.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
const dbMocks = {
  listAbandonedUploads: vi.fn(), deleteAbandonedVersion: vi.fn(), listPurgeableDocuments: vi.fn(), purgeDocumentRow: vi.fn(),
};
vi.mock("@bis/db", async (importOriginal) => ({ ...(await importOriginal<object>()), ...dbMocks }));
const { documentsSweepPass } = await import("./documents-sweep");

const NOW = new Date("2026-10-13T14:00:24Z");
const order: string[] = [];
const remove = vi.fn(async (paths: string[]) => { order.push(`object:${paths.join(",")}`); return { data: [], error: null as null | { message: string } }; });
const storageFrom = vi.fn(() => ({ remove }));
const ctx = () => ({ db: { storage: { from: storageFrom } }, now: NOW, origin: "x", email: {}, sms: {} }) as never;

beforeEach(() => {
  vi.clearAllMocks();
  order.length = 0;
  remove.mockImplementation(async (paths: string[]) => { order.push(`object:${paths.join(",")}`); return { data: [], error: null }; });
  dbMocks.listAbandonedUploads.mockResolvedValue([{ id: "v1", account_id: "a", document_id: "d1", storage_path: "a/d1/v1" }]);
  dbMocks.listPurgeableDocuments.mockResolvedValue([{ id: "d2", account_id: "a", contact_id: "c", client_group_id: null, category: "id", paths: ["a/d2/v2", "a/d2/v3"] }]);
  dbMocks.deleteAbandonedVersion.mockImplementation(async (v: { id: string }) => { order.push(`row:${v.id}`); });
  dbMocks.purgeDocumentRow.mockImplementation(async (d: { id: string }) => { order.push(`row:${d.id}`); return true; });
});

describe("documentsSweep (spec 5.4, plan review I4)", () => {
  it("every tick: object first, row second, for an upload abandoned 3 h ago and a file trashed 30 days ago (mutation: delete the row before the object -> FAILS)", async () => {
    const c = await documentsSweepPass.run(ctx());
    expect(order).toEqual(["object:a/d1/v1", "row:v1", "object:a/d2/v2,a/d2/v3", "row:d2"]);
    expect(c).toEqual({ abandoned: 1, purged: 1, objectDeleteFailed: 0, rowDeleteFailed: 0 });
    expect(dbMocks.listAbandonedUploads.mock.calls[0]![1]).toBe("2026-10-13T11:00:24.000Z");
    expect(dbMocks.listPurgeableDocuments.mock.calls[0]![1]).toBe("2026-09-13T14:00:24.000Z");
  });
  it("nothing due: no storage client is even built, counters are zero (mutation: build the bucket before the reads -> FAILS)", async () => {
    dbMocks.listAbandonedUploads.mockResolvedValue([]);
    dbMocks.listPurgeableDocuments.mockResolvedValue([]);
    expect(await documentsSweepPass.run(ctx())).toEqual({ abandoned: 0, purged: 0, objectDeleteFailed: 0, rowDeleteFailed: 0 });
    expect(storageFrom).not.toHaveBeenCalled();
  });
  it("a failed object delete keeps its row, the rest still runs, and the run THROWS so the heartbeat fails (mutation: return the counters instead of throwing -> FAILS)", async () => {
    remove.mockResolvedValueOnce({ data: [], error: { message: "storage down" } });
    await expect(documentsSweepPass.run(ctx())).rejects.toThrow(/objectDeleteFailed":1/);
    expect(dbMocks.deleteAbandonedVersion).not.toHaveBeenCalled();
    expect(dbMocks.purgeDocumentRow).toHaveBeenCalledTimes(1);
  });
  it("a row that fails after its object went is counted and thrown too (mutation: swallow it -> FAILS)", async () => {
    dbMocks.deleteAbandonedVersion.mockRejectedValueOnce(new Error("pg down"));
    await expect(documentsSweepPass.run(ctx())).rejects.toThrow(/rowDeleteFailed":1/);
    expect(dbMocks.purgeDocumentRow).toHaveBeenCalledTimes(1);
  });
});
```

In `cron-coupling.test.ts`, import `{ ABANDONED_UPLOAD_MS, SIGNED_UPLOAD_URL_MS } from "./passes/documents-sweep"` and add inside the describe:

```ts
  it("an upload is called abandoned only after its signed URL has expired and one more tick has passed, so the sweep never deletes a reservation a browser can still fill (mutation: ABANDONED_UPLOAD_MS = 1 h -> FAILS)", () => {
    const tick = tickIntervalMs(entry!.schedule);
    expect(SIGNED_UPLOAD_URL_MS).toBe(2 * 60 * MINUTE);
    expect(ABANDONED_UPLOAD_MS).toBeGreaterThanOrEqual(SIGNED_UPLOAD_URL_MS + tick);
  });
```

`sentinel.test.ts`: add `listAbandonedUploads: vi.fn(async () => [])` and `listPurgeableDocuments: vi.fn(async () => [])` to its `dbMocks` (`:30-47` area; its `ctx.db` is `{}`), assert `expect(results.documentsSweep).toEqual({ abandoned: 0, purged: 0, objectDeleteFailed: 0, rowDeleteFailed: 0 });` beside the `siteTraffic` assertions, and add `"documentsSweep"` after `"siteTraffic"` in the pinned list at `:274` (its title gains "the documents sweep" after "site traffic"; mutation: register the pass after `opsWatch` → FAILS).

- [ ] **Step 2: Run, see them fail.**
- [ ] **Step 3: Write `passes/documents-sweep.ts`:**

```ts
import {
  listAbandonedUploads, deleteAbandonedVersion, listPurgeableDocuments, purgeDocumentRow, DOCUMENT_BUCKET, DOCUMENT_TRASH_DAYS,
} from "@bis/db";
import type { Pass } from "../context";

/**
 * The document vault's clean-up (spec 5.4). Not a recipe; it sends nothing. EVERY tick (with nothing
 * due it is two indexed reads and no write):
 *   1. versions still uploading ABANDONED_UPLOAD_MS after they were reserved (their signed upload URL
 *      expired an hour ago), with their objects if present, and any document left with no ready version;
 *   2. documents trashed more than 30 days ago: every version's object, then the row (its versions
 *      cascade), then document.purged as the system.
 * The OBJECT first and the ROW second: a failed object delete leaves the row, so the next tick finds it
 * again (and the quota keeps counting it, honestly). A run that counted any failure logs its counters
 * and THROWS: runPasses (harness.ts:34-45) marks the heartbeat failed, and two failing ticks in a row
 * are opsWatch's alert (lib/ops/watch.ts:52-56). Plan deviation 4: not automation_log, the client's own
 * history of what was sent. Every @bis/db export is dereferenced inside run(), never at module scope
 * (the cron route test's bare mock throws on a dereference).
 */
export const SIGNED_UPLOAD_URL_MS = 2 * 60 * 60 * 1000;
export const ABANDONED_UPLOAD_MS = 3 * 60 * 60 * 1000;
export const DOCUMENTS_SWEEP_BATCH = 200;
const DAY_MS = 86_400_000;

export const documentsSweepPass: Pass = {
  key: "documentsSweep",
  async run(ctx) {
    const c = { abandoned: 0, purged: 0, objectDeleteFailed: 0, rowDeleteFailed: 0 };
    const abandoned = await listAbandonedUploads(ctx.db, new Date(ctx.now.getTime() - ABANDONED_UPLOAD_MS).toISOString(), DOCUMENTS_SWEEP_BATCH);
    const due = await listPurgeableDocuments(ctx.db, new Date(ctx.now.getTime() - DOCUMENT_TRASH_DAYS * DAY_MS).toISOString(), DOCUMENTS_SWEEP_BATCH);
    if (abandoned.length === 0 && due.length === 0) return c;
    const bucket = ctx.db.storage.from(DOCUMENT_BUCKET);

    for (const v of abandoned) {
      const { error } = await bucket.remove([v.storage_path]);
      if (error) {
        c.objectDeleteFailed++;
        console.error(`documents sweep: object ${v.storage_path} (account ${v.account_id}) not deleted, row kept for the next tick: ${error.message}`);
        continue;
      }
      try {
        await deleteAbandonedVersion(ctx.db, v);
        c.abandoned++;
      } catch (e) {
        c.rowDeleteFailed++;
        console.error(`documents sweep: version ${v.id} (account ${v.account_id}) row not deleted after its object: ${String(e)}`);
      }
    }

    for (const d of due) {
      if (d.paths.length > 0) {
        const { error } = await bucket.remove(d.paths);
        if (error) {
          c.objectDeleteFailed++;
          console.error(`documents sweep: objects of document ${d.id} (account ${d.account_id}) not deleted, row kept for the next tick: ${error.message}`);
          continue;
        }
      }
      try {
        if (await purgeDocumentRow(ctx.db, d)) c.purged++;
      } catch (e) {
        c.rowDeleteFailed++;
        console.error(`documents sweep: document ${d.id} (account ${d.account_id}) row not deleted after its objects: ${String(e)}`);
      }
    }
    if (c.objectDeleteFailed + c.rowDeleteFailed > 0) {
      throw new Error(`documents sweep: ${JSON.stringify(c)}`);
    }
    return c;
  },
};
```

- [ ] **Step 4: `registry.ts`:** `import { documentsSweepPass } from "./passes/documents-sweep";` after the `siteTrafficPass` import (`:12`); in the doc comment after "The site-traffic pull runs after both — it touches no booking state and sends nothing." add "The documents sweep (S-07) follows it for the same reason: it reads and writes only the document vault."; and in `PASSES` (`:54`) insert `documentsSweepPass` directly after `siteTrafficPass`.
- [ ] **Step 5: Run** `pnpm --filter web exec vitest run src/lib/automations/passes/documents-sweep.test.ts src/lib/automations/cron-coupling.test.ts src/lib/automations/sentinel.test.ts src/lib/automations/harness.test.ts src/lib/consent/scans.test.ts` → PASS; probes red by name.
- [ ] **Step 6: Commit.** `git commit -m "feat(automations): the documents sweep, every tick, object first and row second, failing loudly (S-07 part 1)" -- apps/web/src/lib/automations/passes/documents-sweep.ts apps/web/src/lib/automations/passes/documents-sweep.test.ts apps/web/src/lib/automations/registry.ts apps/web/src/lib/automations/cron-coupling.test.ts apps/web/src/lib/automations/sentinel.test.ts`

---

## Task 13: Regenerate the i18n baselines (bis-crm)

**Review:** sonnet. **After:** Tasks 2, 7, 8, 9, 10, 11, 12 and 17 committed.

- [ ] **Step 1.** `pnpm --filter web exec tsx scripts/generate-i18n-baseline.ts` (the one command, `lib/i18n/ratchet.test.ts:1-9`).
- [ ] **Step 2.** `git diff --stat -- apps/web/src/lib/i18n/` shows only the two baseline files. In `ratchet-baseline.json`, no NEW file appears with a nonzero count (every new `.tsx` in this PR carries no JSX literal copy); if one does, STOP and send it back to its task's owner rather than baselining it.
- [ ] **Step 3.** `pnpm --filter web exec vitest run src/lib/i18n` → PASS.
- [ ] **Step 4. Commit.** `git commit -m "chore(i18n): baselines after the document vault's copy (S-07 part 1)" -- apps/web/src/lib/i18n/catalogue-baseline.json apps/web/src/lib/i18n/ratchet-baseline.json`

---

## Task 14: The e2e sweep's documents leg, and the spec (bis-e2e-qa)

**Review:** sonnet. **Runs:** after Tasks 11 and 13. The orchestrator runs Playwright (Global Constraints).

**Files**
- Modify: `apps/web/e2e/fixtures/sweep.ts:50,249-310,343-360` (a documents leg beside `brand-logos`)
- Modify: `apps/web/e2e/fixtures/sweep.test.ts` (one describe)
- Modify: `apps/web/e2e/auth.teardown.ts:69-79` (the fixture account's document objects, before the row cascade)
- Modify: `apps/web/e2e/record-page.spec.ts:48,165` and `apps/web/e2e/group-page.spec.ts:207-208` (the card order lists)
- Create: `apps/web/e2e/documents.spec.ts`

**Interfaces**
- Consumes: `serviceDb`, `DOCUMENT_BUCKET` from `@bis/db`; `readClientFixture`, `recordPage` (`e2e/support.ts:103,132`); `m` (`src/lib/messages`).
- Produces: `export async function removeDocumentObjects(db: Db, accountId: string, report: SweepReport, dryRun: boolean): Promise<string[]>` in `sweep.ts`.

- [ ] **Step 1: Write the failing sweep test** (append to `fixtures/sweep.test.ts`):

```ts
describe("removeDocumentObjects: the documents bucket is two folders deep (account/document/version)", () => {
  it("lists the account's document folders, then each folder's objects, and removes them all (mutation: list one level only, as brand-logos does -> FAILS)", async () => {
    const removed: string[][] = [];
    const tree: Record<string, { name: string; id: string | null }[]> = {
      acct: [{ name: "doc1", id: null }, { name: "doc2", id: null }],
      "acct/doc1": [{ name: "v1", id: "o1" }],
      "acct/doc2": [{ name: "v2", id: "o2" }, { name: "v3", id: "o3" }],
    };
    const db = { storage: { from: (b: string) => {
      expect(b).toBe("documents");
      return {
        list: async (prefix: string) => ({ data: tree[prefix] ?? [], error: null }),
        remove: async (paths: string[]) => { removed.push(paths); return { data: [], error: null }; },
      };
    } } } as unknown as Parameters<typeof removeDocumentObjects>[0];
    const report = emptySweepReport();
    const paths = await removeDocumentObjects(db, "acct", report, false);
    expect(paths.sort()).toEqual(["acct/doc1/v1", "acct/doc2/v2", "acct/doc2/v3"]);
    expect(removed.flat().sort()).toEqual(paths.sort());
    expect(report.errors).toEqual([]);
  });
  it("dry run removes nothing", async () => {
    const remove = vi.fn();
    const db = { storage: { from: () => ({ list: async (p: string) => ({ data: p === "acct" ? [{ name: "d", id: null }] : [{ name: "v", id: "o" }], error: null }), remove }) } } as unknown as Parameters<typeof removeDocumentObjects>[0];
    expect(await removeDocumentObjects(db, "acct", emptySweepReport(), true)).toEqual(["acct/d/v"]);
    expect(remove).not.toHaveBeenCalled();
  });
});
```

(import `removeDocumentObjects` beside the file's existing `sweep.ts` imports.)

- [ ] **Step 2: `sweep.ts`.** After `const BUCKET = "brand-logos";` (`:50`) add `const DOCUMENTS = DOCUMENT_BUCKET;` (import `DOCUMENT_BUCKET` from `@bis/db` beside `serviceDb`), and after `removePrefix` (`:292-310`):

```ts
/**
 * The document vault's objects for one account (0077: `{account}/{document}/{version}`, two folders
 * deep, so brand-logos' one-level list would find only folders). The bucket is PRIVATE; these objects
 * still outlive their rows, which is why the fixture's teardown and this sweep remove them.
 */
export async function removeDocumentObjects(db: Db, accountId: string, report: SweepReport, dryRun: boolean): Promise<string[]> {
  const bucket = db.storage.from(DOCUMENTS);
  const { data: folders, error } = await bucket.list(accountId, { limit: 1000 });
  if (error) {
    report.errors.push(`documents list ${accountId}: ${error.message}`);
    return [];
  }
  const paths: string[] = [];
  for (const folder of folders ?? []) {
    const { data: files, error: e } = await bucket.list(`${accountId}/${folder.name}`, { limit: 1000 });
    if (e) { report.errors.push(`documents list ${accountId}/${folder.name}: ${e.message}`); continue; }
    paths.push(...(files ?? []).map((f: { name: string }) => `${accountId}/${folder.name}/${f.name}`));
  }
  if (paths.length > 0 && !dryRun) {
    for (let i = 0; i < paths.length; i += 100) {
      const { error: rmError } = await bucket.remove(paths.slice(i, i + 100));
      if (rmError) report.errors.push(`documents remove ${accountId}: ${rmError.message}`);
    }
  }
  return paths;
}
```

In `sweepStaleAccounts` (`:262-264`), after `report.orphanObjects.push(...objects);` add `report.orphanObjects.push(...(await removeDocumentObjects(db, account.id, report, dryRun)));`. In `sweepStaleFixtures`'s orphan leg (`:343-360`), add a second loop of the same shape over `db.storage.from(DOCUMENTS).list()` whose uuid-named prefixes have no `accounts` row, calling `removeDocumentObjects`. The existing `fakeDb` in `sweep.test.ts:168-178` already answers `list` with `[]` for any bucket, so the accounts-leg cases stay green.

- [ ] **Step 3: `auth.teardown.ts`.** After the brand-logo block (`:72-78`) and before the row cascade (`:80`):

```ts
  // The document vault's objects (0077): the rows go with the cascade below, the objects do not.
  try {
    const report = emptySweepReport();
    await removeDocumentObjects(db, fixture.accountId, report, false);
    for (const err of report.errors) console.error(`e2e teardown: ${err}`);
  } catch (e) {
    console.error(`e2e teardown: document objects: ${String(e)}`);
  }
```

(import `removeDocumentObjects` beside `deleteAccountCascade, emptySweepReport` at `:6`.)

- [ ] **Step 4: The order lists.** `record-page.spec.ts:48` → `["summary", "next-up", "timeline", "groups", "properties", "deals", "documents", "details", "tags", "related-people"]`; `:165` → `["groups", "properties", "deals", "documents"]`. `group-page.spec.ts:207` → `["summary", "next-up", "timeline", "properties", "deals", "documents", "people", "details"]`; `:208` → `["properties", "deals", "documents"]`.

- [ ] **Step 5: Write `apps/web/e2e/documents.spec.ts`:**

```ts
import { test, expect, type Page } from "./fixtures/test";
import { config as loadEnv } from "dotenv";
import { serviceDb, setClientAccess, createContact, DOCUMENT_BUCKET } from "@bis/db";
import { m } from "../src/lib/messages";
import { readClientFixture, recordPage } from "./support";

loadEnv({ path: "apps/web/.env.local" });
loadEnv({ path: ".env.local" });

/**
 * The document vault, PR 1a (spec 6, end to end). The PER-RUN fixture account only (auth.setup.ts
 * makes it, auth.teardown.ts deletes it and, since S-07, its stored objects); never Test Client One.
 * One contact, made here with a stamped last name; afterAll removes every object under each document
 * this file made (by storage_path, read first), then the document rows, then the contact, checking
 * each error and re-reading to confirm none is left. Serial: each step reads what the one before left.
 *
 * MUTATION PROBES (static; the orchestrator's run is the real red/green): skip the browser re-encode
 * (upload-client prepareFile returns the File) -> the "no Exif" assertion FAILS; drop the trash
 * Undo's restore -> "back after Undo" FAILS; drop documents_owners_only's role check in the action
 * (setOwnersOnlyAction without canManage) -> nothing here (the Owner is allowed); that is
 * documents-actions.test.ts's job.
 */
test.describe.configure({ mode: "serial", timeout: 90_000 });

const STAMP = `Docs${Date.now()}`;
let accountId = "";
let contactId = "";
const db = serviceDb();

/** A real JPEG from the browser's own encoder, with an EXIF APP1 segment spliced in after SOI. */
async function jpegWithExif(page: Page): Promise<Buffer> {
  const b64 = await page.evaluate(async () => {
    const c = document.createElement("canvas"); c.width = 40; c.height = 30;
    const ctx = c.getContext("2d")!; ctx.fillStyle = "#3a6"; ctx.fillRect(0, 0, 40, 30);
    const blob: Blob = await new Promise((r) => c.toBlob((b) => r(b!), "image/jpeg", 0.9));
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let s = ""; for (const x of bytes) s += String.fromCharCode(x); return btoa(s);
  });
  const jpeg = Buffer.from(b64, "base64");
  // APP1: FF E1, length (2 bytes, includes itself), "Exif\0\0", a big-endian TIFF header and an empty IFD.
  const payload = Buffer.concat([Buffer.from("Exif\0\0", "binary"), Buffer.from([0x4d, 0x4d, 0x00, 0x2a, 0x00, 0x00, 0x00, 0x08, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00])]);
  const app1 = Buffer.concat([Buffer.from([0xff, 0xe1, (payload.length + 2) >> 8, (payload.length + 2) & 0xff]), payload]);
  return Buffer.concat([jpeg.subarray(0, 2), app1, jpeg.subarray(2)]);
}

const PDF = Buffer.from("%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj 2 0 obj<</Type/Pages/Kids[]/Count 0>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n", "binary");

test.beforeAll(async () => {
  const fixture = readClientFixture();
  if (!fixture) throw new Error("documents.spec: no per-run fixture account (e2e/.auth/client-fixture.json)");
  accountId = fixture.accountId;
  await setClientAccess(db, accountId, true, "e2e");
  contactId = (await createContact(db, accountId, { firstName: "Vault", lastName: STAMP }, "e2e")).id;
});

test.afterAll(async () => {
  const { data: docs, error } = await db.from("documents").select("id").eq("account_id", accountId).eq("contact_id", contactId);
  if (error) throw error;
  const ids = (docs ?? []).map((d: { id: string }) => d.id);
  if (ids.length > 0) {
    const { data: versions, error: vErr } = await db.from("document_versions").select("storage_path").in("document_id", ids);
    if (vErr) throw vErr;
    const paths = (versions ?? []).map((v: { storage_path: string }) => v.storage_path);
    if (paths.length > 0) {
      const { error: rmErr } = await db.storage.from(DOCUMENT_BUCKET).remove(paths);
      if (rmErr) throw rmErr;
    }
    const { error: dErr } = await db.from("documents").delete().in("id", ids);
    if (dErr) throw dErr;
  }
  const { error: cErr } = await db.from("contacts").delete().eq("id", contactId);
  if (cErr) throw cErr;
  const { data: left } = await db.from("documents").select("id").eq("contact_id", contactId);
  expect(left ?? []).toEqual([]);
});

const card = (page: Page) => recordPage(page).locator('[data-record-card="documents"] [data-documents-card]');
const open = async (page: Page) => {
  await page.goto(`/dashboard/accounts/${accountId}/contacts/${contactId}`);
  await expect(card(page)).toBeVisible();
};

test("1. upload a PDF and a JPEG; the JPEG's location data is gone; both open in the viewer", async ({ page }) => {
  await open(page);
  await expect(card(page)).toContainText(m["documents.empty.contact"]);
  const jpeg = await jpegWithExif(page);
  expect(jpeg.includes(Buffer.from("Exif\0\0", "binary"))).toBe(true);   // the fixture HAS EXIF
  await card(page).locator('input[type="file"][multiple]').setInputFiles([
    { name: "Signed lease.pdf", mimeType: "application/pdf", buffer: PDF },
    { name: "Roof before.jpg", mimeType: "image/jpeg", buffer: jpeg },
  ]);
  const panel = card(page).locator("[data-documents-panel]");
  await expect(panel.locator("[data-panel-file]")).toHaveCount(2);
  await panel.getByRole("button", { name: m["documents.upload"], exact: true }).click();
  await expect(card(page).locator("[data-document-row]")).toHaveCount(2, { timeout: 30_000 });
  await expect(card(page)).toContainText("2 files");
  await expect(card(page)).toContainText(m["documents.category.photo"]);

  const { data: rows } = await db.from("documents").select("id, title, current_version_id").eq("contact_id", contactId);
  const photo = (rows ?? []).find((r: { title: string }) => r.title === "Roof before")!;
  const { data: v } = await db.from("document_versions").select("storage_path, status, content_type").eq("id", photo.current_version_id).single();
  expect(v).toMatchObject({ status: "ready", content_type: "image/jpeg" });
  const { data: blob } = await db.storage.from(DOCUMENT_BUCKET).download((v as { storage_path: string }).storage_path);
  const stored = Buffer.from(await blob!.arrayBuffer());
  expect(stored.subarray(0, 3)).toEqual(Buffer.from([0xff, 0xd8, 0xff]));
  expect(stored.includes(Buffer.from("Exif\0\0", "binary"))).toBe(false);

  await card(page).getByRole("button", { name: `Open Roof before` }).click();
  const viewer = page.locator("[data-document-viewer]");
  await expect(viewer.locator("img")).toHaveAttribute("src", /token=/);
  await page.keyboard.press("Escape");
  await expect(viewer).toHaveCount(0);
  await card(page).getByRole("button", { name: `Open Signed lease` }).click();
  await expect(viewer.locator("iframe")).toHaveAttribute("src", /token=/);
  await page.keyboard.press("Escape");
});

test("2. rename with Undo puts the old name back", async ({ page }) => {
  await open(page);
  const row = card(page).locator("[data-document-row]").filter({ hasText: "Signed lease" });
  await row.getByRole("button", { name: m["documents.menu"].replace("{title}", "Signed lease") }).click();
  await page.getByRole("menuitem", { name: m["documents.edit"] }).click();
  const field = row.getByRole("button", { name: /Signed lease/ }).last();
  await field.click();
  const input = row.locator("input").first();
  await input.fill("Lease, signed");
  await input.press("Enter");
  await expect(card(page)).toContainText("Lease, signed");
  const storedTitles = async () => ((await db.from("documents").select("title").eq("contact_id", contactId)).data ?? [])
    .map((d: { title: string }) => d.title).sort();
  await expect.poll(storedTitles).toEqual(["Lease, signed", "Roof before"]);   // the save reached the database
  await page.getByRole("button", { name: m["common.undo"] }).click();
  await expect(card(page)).toContainText("Signed lease");
  await expect.poll(storedTitles).toEqual(["Roof before", "Signed lease"]);   // and so did the Undo
});

test("3. Owners only: the lock and the word", async ({ page }) => {
  await open(page);
  const row = card(page).locator("[data-document-row]").filter({ hasText: "Signed lease" });
  await row.getByRole("button", { name: m["documents.menu"].replace("{title}", "Signed lease") }).click();
  await page.getByRole("menuitem", { name: m["documents.makeOwnersOnly"] }).click();
  await expect(row.locator("[data-owners-only]")).toContainText(m["documents.ownersOnly"]);
  const { data } = await db.from("documents").select("owners_only").eq("contact_id", contactId).eq("title", "Signed lease").single();
  expect(data).toEqual({ owners_only: true });
});

test("4. move to trash with Undo, trash again, then Restore from the trash", async ({ page }) => {
  await open(page);
  const rowFor = () => card(page).locator("[data-document-row]").filter({ hasText: "Roof before" });
  await rowFor().getByRole("button", { name: m["documents.menu"].replace("{title}", "Roof before") }).click();
  await page.getByRole("menuitem", { name: m["documents.trash"] }).click();
  await expect(rowFor()).toHaveCount(0);
  await page.getByRole("button", { name: m["common.undo"] }).click();
  await expect(rowFor()).toHaveCount(1);   // back after Undo

  await rowFor().getByRole("button", { name: m["documents.menu"].replace("{title}", "Roof before") }).click();
  await page.getByRole("menuitem", { name: m["documents.trash"] }).click();
  await expect(rowFor()).toHaveCount(0);
  const trash = card(page).locator("[data-documents-trash]");
  await trash.locator("summary").click();
  await expect(trash).toContainText("Deleted for good in 30 days");
  await trash.locator("[data-document-trashed]").filter({ hasText: "Roof before" }).getByRole("button", { name: m["documents.restore"] }).click();
  await expect(rowFor()).toHaveCount(1);
  const { data } = await db.from("documents").select("deleted_at").eq("contact_id", contactId).eq("title", "Roof before").single();
  expect(data).toEqual({ deleted_at: null });
});

test("5. deleting the customer from the list says how many files go, then deletes the files with them (owner ruling 2026-10-13)", async ({ page }) => {
  // Both files are live again after test 4. Read their paths BEFORE the delete.
  const { data: docs } = await db.from("documents").select("id, current_version_id").eq("contact_id", contactId);
  const ids = (docs ?? []).map((d: { id: string }) => d.id);
  expect(ids).toHaveLength(2);
  const { data: versions } = await db.from("document_versions").select("storage_path").in("document_id", ids);
  const paths = (versions ?? []).map((v: { storage_path: string }) => v.storage_path);

  // The list's bulk delete, as contacts-drawer.spec.ts:676-760 drives it (read those lines for the row
  // checkbox, the Delete… button and the typed-count input; reuse its locators, never invent new ones).
  await page.goto(`/dashboard/accounts/${accountId}/contacts`);
  const row = page.locator("main [data-contact-row]").filter({ hasText: STAMP });
  await row.getByRole("checkbox").check();
  await page.getByRole("button", { name: m["bulk.delete"] }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.locator("[data-delete-files]")).toHaveText("This also deletes 2 files.");
  await dialog.getByRole("textbox").fill("1");
  await dialog.getByRole("button", { name: m["bulk.delete"] }).click();
  await expect(page.getByText(m["bulk.deletedOne"])).toBeVisible();

  const { data: contact } = await db.from("contacts").select("id").eq("id", contactId).maybeSingle();
  expect(contact).toBeNull();
  const { data: rows } = await db.from("documents").select("id").in("id", ids);
  expect(rows ?? []).toEqual([]);
  for (const p of paths) {
    const { data: blob } = await db.storage.from(DOCUMENT_BUCKET).download(p);
    expect(blob, `object ${p} is gone`).toBeNull();
  }
  const { data: purged } = await db.from("events").select("actor_type").eq("account_id", accountId).eq("type", "document.purged")
    .in("payload->>documentId", ids);
  expect((purged ?? []).map((e: { actor_type: string }) => e.actor_type)).toEqual(["user", "user"]);
});
```

(The `afterAll` above already tolerates a contact and documents that are gone: its reads find nothing and its deletes delete nothing. MUTATION PROBE, static: drop `beforeDelete` from `bulkDeleteContactsAction` → the delete fails on `documents_contact_fkey`, the toast is "Delete failed", and `contact` is not null → test 5 FAILS.)

(Selectors that depend on `InlineField`'s internals — the click-to-edit button and its input in test 2 — are read from `components/inline-field.tsx` before running and adjusted to its real roles; the assertion stays: the stored title is back after Undo.)

- [ ] **Step 6: Static checks only** (the orchestrator runs Playwright): `pnpm --filter web exec vitest run e2e/fixtures/sweep.test.ts e2e/fixtures/fixture-names.test.ts`, `pnpm --filter web exec tsc --noEmit -p e2e` (or the e2e typecheck the repo uses: `grep -n "e2e" apps/web/package.json`), eslint on the touched files.
- [ ] **Step 7: Commit.** `git add -- apps/web/e2e/documents.spec.ts` then `git commit -m "test(e2e): the document vault on the fixture account, and its objects in the sweep and teardown (S-07 part 1)" -- apps/web/e2e/documents.spec.ts apps/web/e2e/fixtures/sweep.ts apps/web/e2e/fixtures/sweep.test.ts apps/web/e2e/auth.teardown.ts apps/web/e2e/record-page.spec.ts apps/web/e2e/group-page.spec.ts`

---

## Task 17: Deleting a customer deletes their files (bis-crm; owner ruling 2026-10-13)

**Review:** opus. **After:** Tasks 2, 3 and 5 (Task 5 commits `in-account-service-reads.test.ts` first; this task edits one comment there).

**Files**
- Modify: `…/accounts/contacts/actions.ts:466-486` (`bulkDeleteContactsAction`) and a new `countContactDocumentsAction` beside it; `actions.test.ts:152-165` and its `dbMocks` (`:30`)
- Modify: `…/accounts/contacts/bulk-action-bar.tsx:3-18` (imports), `:108-160` (state, open, toast), `:228-233` (the Delete button), `:240-268` (the dialog); `bulk-action-bar.test.ts`
- Modify: `…/accounts/in-account-service-reads.test.ts` (the comment above the existing `contacts/actions.ts` entry, `:80-85`; the entry itself and its reason, `proven-target`, are unchanged)

**Interfaces**
- Consumes: Task 3's `countContactDocuments`, `purgeContactDocuments`, `deleteContacts(db, accountId, ids, { beforeDelete })`; Task 2's `contacts.delete.alsoFiles` (+`One`), `contacts.delete.filesFailed`, `contacts.delete.keptFiles`; `requireAccountOwner` (`lib/auth.ts:70-78`, returns `{ userId, isAgency }`); `useLocale` (`components/locale-provider.tsx:17`; the contacts list renders under the account layout's provider, and outside one it answers `"en"`, the bar's language today); `Skeleton`.
- Produces:

```ts
export function countContactDocumentsAction(accountId: string, contactIds: string[]): Promise<{ ok: true; count: number } | { ok: false }>;
export function bulkDeleteContactsAction(accountId: string, contactIds: string[]):
  Promise<{ ok: true; deleted: number; skippedBlocked: number; skippedFiles: number } | { ok: false; error: string; errorKey?: "contacts.delete.filesGoneKept" }>;
// bulk-action-bar.tsx
export type FilesState = { status: "loading" } | { status: "ready"; count: number } | { status: "error" };
export function DeleteFilesLine(p: { state: FilesState; locale: Locale }): JSX.Element | null;
export function canConfirmDelete(typed: string, count: number, files: FilesState): boolean;
export function deleteDialogCopy(count: number, locale: Locale): { title: string; body: string; cancel: string; confirm: string };   // the dialog's own strings, in the reader's language
```

- [ ] **Step 1: Write the failing tests.**

In `actions.test.ts`, add `countContactDocuments: vi.fn()`, `purgeContactDocuments: vi.fn()` and `serviceDb: vi.fn(() => SERVICE)` (with `const SERVICE = { tag: "service-db" };`) to `dbMocks` if absent (the `vi.mock("@bis/db")` factory check), then in the `bulkDeleteContactsAction` describe:

```ts
  it("purges each deletable customer's files on the SERVICE client, as the Owner, BEFORE the contacts go, and keeps the ones it could not clear (owner ruling; mutation: call deleteContacts without beforeDelete -> FAILS)", async () => {
    dbMocks.purgeContactDocuments.mockResolvedValue({ purgedDocuments: 3, keptContacts: ["y"] });
    dbMocks.deleteContacts.mockImplementation(async (_db: unknown, _a: string, _ids: string[], opts?: { beforeDelete?: (ids: string[]) => Promise<string[]> }) => {
      const kept = await opts!.beforeDelete!(["x", "y"]);
      return { deleted: 1, skippedBlocked: 0, skippedFiles: kept.length };
    });
    expect(await bulkDeleteContactsAction("a1", ["x", "y"])).toEqual({ ok: true, deleted: 1, skippedBlocked: 0, skippedFiles: 1 });
    expect(dbMocks.purgeContactDocuments).toHaveBeenCalledWith(SERVICE, "a1", ["x", "y"], "user_1");
  });
  it("a purge that throws fails the whole delete, never a silent success (mutation: catch the purge's throw and return [] -> FAILS)", async () => {
    dbMocks.purgeContactDocuments.mockRejectedValue(new Error("db down"));
    dbMocks.deleteContacts.mockImplementation(async (_db: unknown, _a: string, _ids: string[], opts?: { beforeDelete?: (ids: string[]) => Promise<string[]> }) => {
      await opts!.beforeDelete!(["x"]);
      return { deleted: 1, skippedBlocked: 0, skippedFiles: 0 };
    });
    expect((await bulkDeleteContactsAction("a1", ["x"])).ok).toBe(false);
  });
  it("a file that arrives mid-delete: the FK keeps the customers and the answer says the files already went (mutation: drop the errorKey branch -> FAILS)", async () => {
    dbMocks.purgeContactDocuments.mockResolvedValue({ purgedDocuments: 2, keptContacts: [] });
    dbMocks.deleteContacts.mockImplementation(async (_db: unknown, _a: string, _ids: string[], opts?: { beforeDelete?: (ids: string[]) => Promise<string[]> }) => {
      await opts!.beforeDelete!(["x"]);
      throw new Error('deleteContacts failed: update or delete on table "contacts" violates foreign key constraint "documents_contact_fkey" on table "documents"');
    });
    expect(await bulkDeleteContactsAction("a1", ["x"])).toEqual({ ok: false, error: "Delete failed — please try again.", errorKey: "contacts.delete.filesGoneKept" });
  });
});

describe("countContactDocumentsAction", () => {
  it("counts on the REQUEST client after the Owner check; a failed or null count is ok:false, never 0 (mutation: return { ok: true, count: 0 } on error -> FAILS; count on serviceDb() -> FAILS)", async () => {
    const REQUEST = { tag: "request-db" };
    dbForRequest.mockResolvedValue(REQUEST);   // actions.test.ts:16's mock
    dbMocks.countContactDocuments.mockResolvedValue(4);
    const C = "11111111-1111-4111-8111-111111111111";
    expect(await countContactDocumentsAction("a1", [C])).toEqual({ ok: true, count: 4 });
    expect(requireAccountOwner).toHaveBeenCalledWith("a1");
    expect(dbMocks.countContactDocuments.mock.calls[0]![0]).toBe(REQUEST);   // the request client, by identity
    dbMocks.countContactDocuments.mockRejectedValue(new Error("countContactDocuments: the count came back null"));
    expect(await countContactDocumentsAction("a1", [C])).toEqual({ ok: false });
    expect(await countContactDocumentsAction("a1", ["not-a-uuid"])).toEqual({ ok: false });
  });
```

(import `countContactDocumentsAction` beside `bulkDeleteContactsAction` at `:66`; the existing "passes through honest counts" case's mock gains `skippedFiles: 0` and its expectation follows.)

In `bulk-action-bar.test.ts` (the action module is already mocked there for the bar's other actions; add `countContactDocumentsAction: vi.fn()` to that mock), add:

```ts
describe("the delete dialog says how many files go (owner ruling 2026-10-13)", () => {
  const line = (state: FilesState, locale: "en" | "es" = "en") => renderedText(renderToStaticMarkup(createElement(DeleteFilesLine, { state, locale })));
  it("in English and Spanish, singular and plural, the owner's words (mutation: drop the One form -> FAILS)", () => {
    expect(line({ status: "ready", count: 4 })).toBe("This also deletes 4 files.");
    expect(line({ status: "ready", count: 4 }, "es")).toBe("También se borrarán 4 archivos.");
    expect(line({ status: "ready", count: 1 })).toBe("This also deletes 1 file.");
    expect(line({ status: "ready", count: 1 }, "es")).toBe("También se borrará 1 archivo.");
  });
  it("no files, no line; counting is a skeleton; a failed count says so (rule 7, rule 5; mutation: show nothing on error -> FAILS)", () => {
    expect(line({ status: "ready", count: 0 })).toBe("");
    expect(renderToStaticMarkup(createElement(DeleteFilesLine, { state: { status: "loading" }, locale: "en" }))).toContain("data-delete-files-skeleton");
    expect(line({ status: "error" })).toBe(m["contacts.delete.filesFailed"]);
  });
  it("Delete is enabled only with the typed count AND a known file count (mutation: ignore the file count -> FAILS)", () => {
    expect(canConfirmDelete("2", 2, { status: "ready", count: 3 })).toBe(true);
    expect(canConfirmDelete("2", 2, { status: "loading" })).toBe(false);
    expect(canConfirmDelete("2", 2, { status: "error" })).toBe(false);
    expect(canConfirmDelete("3", 2, { status: "ready", count: 0 })).toBe(false);
  });
});
```

(imports: `DeleteFilesLine, canConfirmDelete, type FilesState` from `./bulk-action-bar`; `renderedText` from `@/lib/rendered-text`.)

- [ ] **Step 2: Run, see them fail.**
- [ ] **Step 3: `actions.ts`.** Add `countContactDocuments, purgeContactDocuments` to the `@bis/db` import (`:6-11`; `serviceDb` is already there). Replace `bulkDeleteContactsAction` (`:466-486`) and add the count action after it:

```ts
export async function bulkDeleteContactsAction(
  accountId: string, contactIds: string[],
): Promise<{ ok: true; deleted: number; skippedBlocked: number; skippedFiles: number } | { ok: false; error: string; errorKey?: "contacts.delete.filesGoneKept" }> {
  // (the existing Owner-only comment, unchanged)
  const { userId } = await requireAccountOwner(accountId);
  if (contactIds.length === 0) return { ok: false, error: "Nothing selected." };
  try {
    // Owner ruling 2026-10-13: a customer's files go with them. deleteContacts computes the deletable
    // ids on the request client; the purge then removes each document's objects and row on the service
    // client (0077: authenticated has no write on documents and none on storage.objects), BEFORE any
    // contact row is deleted. A customer whose files could not all be removed is kept (skippedFiles),
    // and the NO ACTION FK refuses the delete of any contact whose document rows remain.
  let purged = 0;
  try {
    const r = await deleteContacts(await dbForRequest(), accountId, contactIds, {
      beforeDelete: async (deletable) => {
        const p = await purgeContactDocuments(serviceDb(), accountId, deletable, userId);
        purged = p.purgedDocuments;
        return p.keptContacts;
      },
    });
    revalidatePath(contactsPath(accountId));
    return { ok: true, ...r };
  } catch (e) {
    // A file added between the purge and the contact delete: the FK (NO ACTION) refused every contact in
    // the statement, after other files were already gone. Say exactly that (plan review minor 8).
    if (purged > 0 && /documents_contact_fkey/.test(String(e))) {
      revalidatePath(contactsPath(accountId));
      return { ok: false, error: "Delete failed — please try again.", errorKey: "contacts.delete.filesGoneKept" };
    }
    return { ok: false, error: "Delete failed — please try again." };
  }
}

/** The delete dialog's file count (owner ruling 2026-10-13), on the Owner's request client. Never 0 on a failure. */
export async function countContactDocumentsAction(accountId: string, contactIds: string[]): Promise<{ ok: true; count: number } | { ok: false }> {
  await requireAccountOwner(accountId);
  if (!Array.isArray(contactIds) || !contactIds.every((id) => isUuid(id))) return { ok: false };
  if (contactIds.length === 0) return { ok: true, count: 0 };
  try {
    return { ok: true, count: await countContactDocuments(await dbForRequest(), accountId, contactIds.map((id) => id.toLowerCase())) };
  } catch (e) {
    console.error(`contacts delete: file count failed (account ${accountId}): ${loggableError(e)}`);
    return { ok: false };
  }
}
```

- [ ] **Step 4: `bulk-action-bar.tsx`.** Imports: `useLocale` from `@/components/locale-provider`, `Skeleton` from `@/components/ui/skeleton`, `t` beside `plural` (`:15`), `type Locale` from `@/lib/i18n/locale`, and `countContactDocumentsAction` in the actions import (`:18-20`). Add, above the component:

```tsx
/** The delete dialog's file line (owner ruling 2026-10-13): what else goes, in the reader's language. */
export type FilesState = { status: "loading" } | { status: "ready"; count: number } | { status: "error" };

export function DeleteFilesLine({ state, locale }: { state: FilesState; locale: Locale }) {
  if (state.status === "loading") return <Skeleton data-delete-files-skeleton className="h-4 w-48" />;
  if (state.status === "error") return <p data-delete-files="error" className="text-sm text-[var(--crit)]">{t(m, "contacts.delete.filesFailed", locale)}</p>;
  if (state.count === 0) return null;
  return <p data-delete-files={state.count} className="text-sm text-card-foreground">{plural(m, "contacts.delete.alsoFiles", state.count, locale, { count: state.count })}</p>;
}

/** Delete needs the typed count AND a known file count: the dialog must say how many files go before anything goes. */
export function canConfirmDelete(typed: string, count: number, files: FilesState): boolean {
  return typed.trim() === String(count) && files.status === "ready";
}
```

In `doDelete` (`:143`), the failure line becomes `if (!r.ok) { toast.error("errorKey" in r && r.errorKey ? t(m, r.errorKey, locale) : r.error); return; }`. **The dialog in the reader's language** (plan review minor 10; the twins are Task 2 Step 3b): `confirmTitle` (`:113-115`) becomes `count === 1 ? t(m, "bulk.confirmTitleOne", locale) : t(m, "bulk.confirmTitle", locale, { count })`; the dialog's body (`:246`) `t(m, "bulk.confirmBody", locale, { count })`; its Cancel (`:257`) `t(m, "common.cancel", locale)`; its destructive button (`:264`) `t(m, "bulk.delete", locale)`. The bar's own buttons outside the dialog stay as they are. Add to `bulk-action-bar.test.ts`: render `BulkActionBar` inside `<LocaleProvider locale="es">` with the dialog forced open is not possible statically, so export the dialog's copy as a pure `deleteDialogCopy(count, locale)` returning `{ title, body, cancel, confirm }` and assert `deleteDialogCopy(2, "es")` equals `{ title: "¿Borrar 2 contactos?", body: "Esto no se puede deshacer. Escriba 2 para confirmar.", cancel: "Cancelar", confirm: "Borrar…" }` and `deleteDialogCopy(1, "en").title` is `"Delete 1 contact?"` (mutation: read `m["bulk.confirmBody"]` directly -> FAILS); the dialog renders from it.

In the component: `const locale = useLocale();` and `const [files, setFiles] = useState<FilesState>({ status: "loading" });` beside the existing state (`:108-110`), and

```tsx
  function openConfirm() {
    const ids = [...selectedIds];
    setFiles({ status: "loading" });
    setConfirmOpen(true);
    void countContactDocumentsAction(accountId, ids)
      .then((r) => setFiles(r.ok ? { status: "ready", count: r.count } : { status: "error" }))
      .catch(() => setFiles({ status: "error" }));
  }
```

The Delete button (`:229`) calls `openConfirm` instead of `setConfirmOpen(true)`. In the dialog, after `</DialogDescription>` inside `<DialogHeader>`: `<DeleteFilesLine state={files} locale={locale} />`. The destructive button's `disabled` becomes `!canConfirmDelete(typed, count, files)`. In `doDelete` (`:137-157`), after the existing success toast:

```tsx
    if (r.skippedFiles > 0) {
      toast.error(t(m, "contacts.delete.keptFiles", locale, { count: r.deleted, kept: r.skippedFiles }));
    }
```

- [ ] **Step 5: The service-reads comment.** In `in-account-service-reads.test.ts`, the comment above the `contacts/actions.ts` entry (`:80-84`) gains: "bulkDeleteContactsAction (0077, owner ruling 2026-10-13): the documents purge runs on the service client only for the ids deleteContacts' request-client pre-read left deletable, scoped to the same account, and only after requireAccountOwner."
- [ ] **Step 6: Run** the two tests, `in-account-service-reads.test.ts`, `pnpm --filter web typecheck`, eslint on the touched files → clean; probes red by name.
- [ ] **Step 7: Commit.** `git commit -m "feat(contacts): deleting a customer deletes their files, objects first, and the dialog says how many (S-07 part 1, owner ruling)" -- "apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/contacts/actions.ts" "apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/contacts/actions.test.ts" "apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/contacts/bulk-action-bar.tsx" "apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/contacts/bulk-action-bar.test.ts" "apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/in-account-service-reads.test.ts"`

---

## Task 16: Whole-branch final review (checkpoint, not an implementer task)

**Reviewer:** opus, fresh context. Runs after Tasks 1–14.

- [ ] **Step 1.** Read the spec end to end, then `git diff dc3e4ab6...HEAD` in `<WT>`; walk the coverage table below row by row against the diff.
- [ ] **Step 2.** Web tests by path: every test file Tasks 2 and 4–14 touched, plus `src/lib/i18n/ratchet.test.ts`, `src/lib/messages.test.ts`, `src/components/ui/material.test.ts`, `"src/app/(dashboard)/dashboard/accounts/[accountId]/in-account-service-reads.test.ts"`, `src/lib/consent/scans.test.ts`; `pnpm --filter web typecheck`. The db suites on a replica of your own (Task 1's recipe, port `55521`; PostgREST on `55526`/`55527` for `documents.test.ts`, `record.test.ts`, `contacts.test.ts`, `places.test.ts`), never bis-ci. Re-run two probes of your own choosing, by name.
- [ ] **Step 3.** Hunt specifically: (a) a service write, a minted URL or a storage call that is not preceded by a request-client read of the record or the document (every export of `documents-actions.ts`); (b) a `serviceDb` mention outside `documents-actions.ts` under the in-account roots; (c) a title in any event payload; (d) a policy or guard built on a nullable boolean without `coalesce`; (e) a second primary in the card, the panel or the viewer (`data-variant="default"`); (f) a colour-only status; (g) a new key without its twin, a JSX literal with a letter, a tú form in new Spanish; (h) a test that cannot fail (memory "vacuous test shapes"), in particular a Spanish assertion compared against `t()`'s output; (i) the migration's ASCII rule; (j) an upload path that crosses a function body (any `File`/`Blob` argument to a server action); (k) the object-then-row order in the finish failure path, the abandon action, the sweep, the e2e teardown AND the contact delete (`purgeContactDocuments` before any contact row; a kept contact never deleted; the FK still NO ACTION); (l) the delete dialog's count read on the request client, throwing on a null count.
- [ ] **Step 4.** Report findings by severity with file:line; the orchestrator routes fixes to the owning task's agent.

---

## Task 15: Rollout (orchestrator; LAST; not a coding task)

Additive migration, so it applies before the merge. Each step reads its own evidence; nothing is inferred from an earlier run.

- [ ] **Step 1.** Merge `origin/main` into `feat/s07-vault`; `ls packages/db/supabase/migrations | tail -1` is still `0077_document_vault.sql` and nothing on `main` holds a 0077.
- [ ] **Step 2. bis-ci.** `gh workflow run ci-project-setup.yml -f step=push-dry-run --ref feat/s07-vault` → its log lists exactly `0077_document_vault.sql`; then `-f step=push`. If the push fails on `storage.buckets` (spec finding F2), STOP: nothing was applied (one transaction); report to danlo before production. Post-apply, read-only with `pnpm --filter @bis/db ci:sql`: `select id, public, file_size_limit, allowed_mime_types from storage.buckets where id = 'documents'`; `select relname, relrowsecurity from pg_class where relname in ('documents','document_versions')`; `select proacl from pg_proc where proname = 'reserve_document_version'` (service_role only); `select policyname from pg_policies where tablename in ('documents','document_versions') order by 1` (five). From here on `@bis/db` suites may run against bis-ci again.
- [ ] **Step 3. Push and CI.** Push the branch; CI `verify` (the in-runner stack runs every db suite, the new ones included, against the REAL storage schema: the bucket and storage-policy cases are proven here, not on the replica) and `e2e` green ON THE HEAD SHA, read from `gh api repos/{owner}/{repo}/commits/<sha>/check-runs`. A CI-vs-local disagreement is an environment finding first (memory "CI vs local divergence").
- [ ] **Step 4. Gates, one at a time:** `pnpm check`, `pnpm --filter web build`, `pnpm --filter web test:e2e` (after checking no `screenshots.yml` run is in progress; a local e2e run uses bis-ci, whose bucket Step 2 made). The `forms.spec` unread-badge flake is unrelated; never loosen it.
- [ ] **Step 5. Production.** Pre-flight, read-only through the MCP `execute_sql` on `tlbkbmlrfafquucsmsmm`: `select to_regclass('public.documents'), to_regclass('public.document_versions')` → both null; `select count(*) from storage.buckets where id = 'documents'` → 0; `select to_regprocedure('public.reserve_document_version(uuid,uuid,bigint,text,text,text)')` → null. Then `apply_migration` with 0077's exact text, ONCE. Then Step 2's post-apply reads. Ledger line: `0077 APPLIED <date> on bis-ci and production — NEVER RE-APPLY`.
- [ ] **Step 6. Parity** (`docs/runbooks/ci-supabase-project.md` §5): `fingerprint.sql` on both; the `bucket` kind and the two tables' columns, constraints, policies and privileges equal. An allowed difference is only one the runbook already lists.
- [ ] **Step 7. The Safari check on Vercel Preview, on a throwaway fixture account (owner ruling 2026-10-13: never Test Client One, never a live account).** Proves Assumptions A1, A2 and the Safari half of A6 on a real iPhone. Preview runs on bis-ci and the Clerk development instance, so a fixture made the way `auth.setup.ts` makes the per-run client fixture (`apps/web/e2e/auth.setup.ts:166-218`: a Clerk user, an org created by that user, `createAccount`, `setClientAccess`, `createContact`, named `E2E Client Co <stamp>` so the stale-fixture sweep, `e2e/fixtures/sweep.ts:249-280` with `isStaleFixtureAccount`, reclaims it if cleanup is ever missed) can sign in there. The orchestrator writes this script to `<WT>/apps/web/e2e/.auth/safari-check.ts` (`apps/web/.gitignore:15` ignores `/e2e/.auth/`, so it is never committed) and runs it from `<WT>/apps/web` with `pnpm exec tsx e2e/.auth/safari-check.ts <create|verify|cleanup>`:

```ts
import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });
import { readFileSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { clerkClient } from "@clerk/nextjs/server";
import { serviceDb, createAccount, setClientAccess, createContact, deleteAccountCascade, DOCUMENT_BUCKET } from "@bis/db";
import { refuseProduction } from "../fixtures/production-guard";
import { removeDocumentObjects, emptySweepReport } from "../fixtures/sweep";

refuseProduction(process.env, "The Safari check");          // bis-ci only; production throws here, naming the variable
const STATE = "e2e/.auth/safari-check.json";
const db = serviceDb();

async function create() {
  const stamp = Date.now();
  const email = `e2e-safari-${stamp}@example.com`;
  const password = randomBytes(18).toString("base64url");
  const clerk = await clerkClient();
  const user = await clerk.users.createUser({ emailAddress: [email], password, firstName: "E2E", lastName: "Safari", skipLegalChecks: true });
  const org = await clerk.organizations.createOrganization({ name: `E2E Client Co ${stamp}`, createdBy: user.id });
  const { id: accountId } = await createAccount(db, { clerkOrgId: org.id, name: `E2E Client Co ${stamp}`, actorId: user.id });
  await setClientAccess(db, accountId, true, user.id);
  const { id: contactId } = await createContact(db, accountId, { firstName: "Safari", lastName: `Check ${stamp}` }, user.id);
  writeFileSync(STATE, JSON.stringify({ email, userId: user.id, orgId: org.id, accountId, contactId }));
  // Printed for danlo only, never pasted into a report or a commit.
  console.log(`Sign in on the Preview as ${email} / ${password}, then open /dashboard/accounts/${accountId}/contacts/${contactId}`);
}

/** The stored photo: a JPEG, no APP1 segment at all (no EXIF, so no GPS and no orientation tag; no XMP), and portrait pixels for an upright portrait shot. */
async function verify() {
  const s = JSON.parse(readFileSync(STATE, "utf8")) as { accountId: string; contactId: string };
  const { data: docs, error } = await db.from("documents").select("id, source, current_version_id")
    .eq("account_id", s.accountId).eq("contact_id", s.contactId);
  if (error) throw error;
  const photo = (docs ?? []).find((d: { source: string; current_version_id: string | null }) => d.source === "camera" && d.current_version_id);
  if (!photo) throw new Error("no camera file on the fixture contact yet");
  const { data: v, error: vErr } = await db.from("document_versions").select("storage_path, content_type, bytes").eq("id", photo.current_version_id).single();
  if (vErr) throw vErr;
  const { data: signed, error: sErr } = await db.storage.from(DOCUMENT_BUCKET).createSignedUrl(v.storage_path, 120);
  if (sErr || !signed) throw sErr ?? new Error("no signed URL");
  const bytes = Buffer.from(await (await fetch(signed.signedUrl)).arrayBuffer());
  const isJpeg = bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  // Walk the header segments up to the image data (SOS, FF DA). Metadata lives ONLY there, so a scan of
  // the compressed data (where any byte pair can occur) is never needed. APP1 (FF E1) is where EXIF,
  // and with it GPS, and XMP live: a stripped photo has none. SOF0/SOF2 carry height then width.
  const app1: string[] = [];
  let height = 0, width = 0;
  for (let i = 2; i + 4 <= bytes.length && bytes[i] === 0xff;) {
    const marker = bytes[i + 1]!;
    if (marker === 0xda) break;
    const len = bytes.readUInt16BE(i + 2);
    if (marker === 0xe1) app1.push(bytes.subarray(i + 4, i + 4 + Math.min(len - 2, 29)).toString("latin1"));
    if (marker === 0xc0 || marker === 0xc2) { height = bytes.readUInt16BE(i + 5); width = bytes.readUInt16BE(i + 7); }
    i += 2 + len;
  }
  const hasExif = app1.some((h) => h.startsWith("Exif"));
  const hasXmp = app1.some((h) => h.startsWith("http://ns.adobe.com/xap/"));
  console.log(JSON.stringify({ contentType: v.content_type, bytes: v.bytes, isJpeg, app1Segments: app1.length, hasExif, hasXmp, width, height, portrait: height > width }));
}

async function cleanup() {
  const s = JSON.parse(readFileSync(STATE, "utf8")) as { userId: string; orgId: string; accountId: string };
  const report = emptySweepReport();
  await removeDocumentObjects(db, s.accountId, report, false);   // objects first (Task 14's helper)
  await deleteAccountCascade(db, s.accountId, "safari-check");     // then every row, documents included
  const clerk = await clerkClient();
  await clerk.organizations.deleteOrganization(s.orgId);
  await clerk.users.deleteUser(s.userId);
  if (report.errors.length) throw new Error(report.errors.join("; "));
  console.log("cleaned up");
}

const step = process.argv[2];
await (step === "create" ? create() : step === "verify" ? verify() : step === "cleanup" ? cleanup() : Promise.reject(new Error("create | verify | cleanup")));
```

  Order: (a) check no `screenshots.yml` run is in progress; `create`; hand danlo the sign-in line privately. (b) danlo, on an iPhone in Safari, signs in on the branch's Preview, opens the contact, holds the phone UPRIGHT (portrait), taps **Take photo** once, takes the photo, taps the panel's Upload, and waits for the row. (c) `verify`, read-only: pass only when `isJpeg` is true, `app1Segments` is 0 (so no EXIF, no GPS, no XMP), `contentType` is `image/jpeg` and `portrait` is true; then danlo opens the row in the viewer and confirms the picture is upright (the stored pixels carry the rotation, since no orientation tag survives). (d) `cleanup`, always, pass or fail; then `select count(*) from accounts where id = '<accountId>'` with `ci:sql` → 0. Record the JSON line and danlo's "upright" in the PR body. **Assumption A11:** a backend-created user with a password signs in on the development instance without an email code (backend-created addresses are auto-verified, `auth.setup.ts:163-164`); if Clerk asks for a code anyway, mint a sign-in token instead (`clerk.signInTokens.createSignInToken({ userId, expiresInSeconds: 600 })`, the call `e2e/fixtures/clerk-identities.ts:70` makes) and open `<preview>/sign-in?__clerk_ticket=<token>` (**Assumption A12:** Clerk's sign-in page accepts the ticket parameter).
- [ ] **Step 8. Merge** (squash, through the PR, after the head SHA's `verify` and `e2e` are green and Task 16's findings are closed). The PR body names: deviations 1–9, findings F1–F4, Assumptions A1–A12 and which were proven where, the known edge in Task 8 (an empty group's own documents miss its timeline), and "Not in this PR".
- [ ] **Step 9.** Ledger: the migration line; the roadmap tracker row for item 6 moves to `in_progress` (spec §7: `done` only after parts 2 and 3); the `cron.pass.documentsSweep` heartbeat read `ok` on the first tick after the deploy.

---

## Spec coverage

| Spec | Where |
|---|---|
| §1 scope (part 1; not in part 1: customer-facing, properties/deals, drawer, scanning, AI, off switch) | whole plan; `client_visible` has no writer (Task 3); no drawer change (Task 11 touches pages only) |
| V1 staff vault first | whole plan |
| V2 one record, exactly one | Task 1 (`documents_one_record`, deviation 1) |
| V3 RLS visibility, Owners only, server-minted URLs | Task 1 (policies, matrix), Task 5 (`getDocumentUrlAction` after an RLS read; role checks) |
| V4 5 GB / 25 MB | Task 1 (bucket, check, function), `document-rules.ts`; Task 5 (size refusal); Task 7 (size after re-encode) |
| V5 nine categories, bilingual | Task 1 (check), Task 2 (words), Task 4 (default), Task 10 (select) |
| V6 server-reserved direct uploads | Tasks 5, 7 |
| §3.1 bucket, no objects policy, CI stacks | Task 1, spec finding F1 |
| §3.2 `documents` | Task 1 (+ deviation 1) |
| §3.3 `document_versions` | Task 1 |
| §3.4 RLS and writes | Task 1, Task 5, deviation 2 |
| §3.5 quota and the lock | Task 1 (schema test, lock test), Task 5 (quota message) |
| §3.6 timeline events and rows | Task 3 (events), Task 8 (rows), deviation 3 |
| §4.1 card, placement, title + count, actions, rows, menu, inline edits + CAS Undo | Tasks 10, 11 (+ deviations 5, 8) |
| §4.2 uploading: panel, progress, failures, camera re-encode | Tasks 7, 9, 10 |
| §4.2 item 4 space used | PR 1b ("Not in this PR") |
| §4.3 viewer | Task 9 (Versions list: PR 1b) |
| §4.4 trash, Undo, Restore | Tasks 3, 5, 10 (Delete forever: PR 1b) |
| §4.5 states, language, design, styleguide | Tasks 2, 10, 13 |
| §5.1 actions | Task 5 |
| §5.2 content check | Task 4 (+ deviation 7) |
| §5.3 EXIF stripping | Task 7, Task 14 (the stored JPEG has no `Exif\0\0`) |
| §5.4 the clean-up job (every tick, amended) | Tasks 3, 12 (+ deviations 4, 6) |
| §5.5 teardown and test hygiene | Task 1 (rows in `ACCOUNT_OWNED_TABLES`, and `deleteAccountCascade`'s storage leg, Step 11b), Task 14 (e2e sweep and teardown objects) |
| §6 database tests | Task 1 (matrix, grants, checks, quota, lock, bucket), Task 3 |
| §6 app tests | Tasks 4–12 |
| §6 e2e (PR 1a rows) | Task 14 |
| §7 rollout, CSP, tracker | Task 15, spec finding F3 |
| Owner ruling 2026-10-13: a customer's files go with them (objects, then rows, then the contact; the dialog's count; bulk delete) | Tasks 2, 3, 17, 14 (test 5); deviation 2 |
| Owner ruling 2026-10-13: the Safari check on Preview with a throwaway fixture account | Task 15 step 7 |
| §8 open items | untouched (named, not decided) |

## Self-review notes (the writer's own pass, 2026-10-13)

- Placeholder scan: every code step carries its code; the two places that point at a file's existing shape (Task 8's render cases in `activity-timeline.rows.test.ts` and `group-timeline.test.ts`, Task 14's `InlineField` selectors) name the exact assertion that must hold and the file to read for the harness, because both depend on fixtures this plan did not open line by line.
- Owner rulings 2026-10-13 re-checked: deviation 2 now states the delete order (objects, document rows, contact rows) with the FK kept NO ACTION as the backstop, and every failure path is named and tested (Task 3: a failed removal keeps the customer, a retry finishes, a null count throws; Task 17: a throwing purge fails the delete; Task 14 test 5: the objects are gone after a list delete). Groups have no delete path today (deviation 2 cites the evidence). Step 7 never touches Test Client One. `deleteContacts`' new `skippedFiles` field is reflected in its two callers' tests (`contacts.test.ts:823`, `actions.test.ts`'s honest-counts case) and in `bulkDeleteContactsAction`'s return type.
- Plan review of 3104203b (2026-10-13) applied: I1 line numbers and `pnpm install`; I2 the finish step refuses a stored size other than the reserved one; I3 a failed removal keeps the rows for the sweep; I4 the sweep runs every tick and throws on a failure (spec §5.4 amended); I5 `deleteAccountCascade` removes objects first (spec §7 amended); I6 `rowMenuItems`; minors 1-10 as listed in the commit message. Re-checked: every new refusal has its test and its mutation; `discardDocumentUpload` is never called after a failed removal; `mark_document_version_ready` replaces the two-statement write; no event payload carries a title or a category.
- Type consistency: `discardDocumentUpload(db, accountId, documentId, versionId: string | null)` (Task 3) is called with `null` by Task 5's quota branch; `DocumentView` (Task 4) is produced by `documentView` (Task 6) and consumed by Tasks 9 and 10; `UploadPhase` (Task 7) by Task 9's panel; `TimelineDocument` (Task 3) by Task 8; `DocumentHandlers` (Task 10) by the styleguide demo.
