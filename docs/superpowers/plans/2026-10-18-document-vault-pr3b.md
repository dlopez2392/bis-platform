# The document vault, PR 3b (S-07 + F-005 part 3, migration 0085): share links, implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Anyone who can see a scan-clean, live file makes a link to ONE version of it from the record's Documents card (row menu) or the viewer (on the card and on the Documents page): "Link copied. It works for 24 hours." The card says "Shared · expires in 18 h" while a link is live and offers **Stop sharing**, which takes effect at once with an Undo. A stranger opens `/s/<token>` with no sign-in, on the business's brand (rule 9), sees the file's title, type and size and one **Download**; the first real download (never a page load) puts "The link's recipient opened Seguro 2026.pdf" on the record's timeline. Expired, revoked, trashed and removed links each get their own plain page naming the business and its phone. Closes item 6 / F-005.

**Architecture:** One migration, **0085**: a key `document_versions (account_id, document_id, id)`; the table `document_shares` (composite same-account FKs to the document and the version, `token_hash` unique, `expires_at = created_at + 24 h` CHECK, coherent revoke and open pairs, `open_count`); the table `document_share_downloads` (one row per download, an HMAC of the address, for the rate limit; deviation 1); one service-only function `claim_document_share_download` that locks the share, re-proves it open and clean, applies the forms limiter's numbers to (share, address), records the download and sets `first_opened_at` only the first time; a `security_invoker` view `document_share_timeline` for the record's two new timeline rows. Members read a share exactly when they can read its document (a restrictive policy whose subquery runs under `documents`' own RLS); the client role writes nothing. A new `@bis/db` module `document-shares.ts`. The token is 32 random bytes, base64url (43 characters, the 2b shape, so `isTokenShape` and `tokenHash` are reused); only `sha256(token)` is stored. The staff actions (`document-shares-actions.ts`) prove the document on the REQUEST client and write on the service client. The public page `/s/[token]` and `POST /api/s/[token]/download` bypass Clerk (the proxy's lookahead gains `s/`), prove the token first and pass the token row's own `account_id`, `document_id` and `version_id` to every later read; the download mints a 120 s signed URL through 2a's one gate, `signedDocumentReadUrl`, for the SHARED version.

**Tech Stack:** Postgres 17 (Supabase) migration; supabase-js 2.110.8 (`rpc`, `storage.createSignedUrl` through `signedDocumentReadUrl`); Next.js 16.3.6 App Router (server actions, route handlers, a public root layout, `next.config.ts` `headers()`); React 19.2.4; vitest 4 (`renderToStaticMarkup`, no DOM; `vi.mock`); `node:crypto` (`randomBytes`, sha256, the forms `hashIp`); sonner toasts; lucide-react; the `@bis/db` suites on a local PG18 replica (with a local PostgREST for `withTestAccount`) and CI `verify`; Playwright (bis-e2e-qa writes it, the orchestrator runs it).

**Revision:** 2026-10-18, after the opus plan review of `10c7c5b5` (CHANGES REQUESTED): rulings O1–O3 and R-V below; findings F1, F2, F4–F7, F9–F12 applied where each is named; the spec carries matching "Amended 2026-10-18" lines (§4.1, §4.2).

**Spec:** `docs/superpowers/specs/2026-10-17-document-vault-part3-design.md` (owner-approved 2026-10-17): §4 whole (4.1–4.4), E3 in §2, and the 3b parts of §5, §6 and §7. NOT §3 (3a, shipped as #268). Owner-accepted implementer choices (2026-10-17): **the first open is counted on the first successful Download, not on the page load** (link previewers); **the first-open row's mark is the customer kind, worded as the link's recipient**, checked below against the closed author set (ruling O1, 2026-10-18). Templates: `docs/superpowers/plans/2026-10-17-document-vault-pr3a.md` (#268, the house shape) and `docs/superpowers/plans/2026-10-15-document-vault-pr2b.md` (#261, the public token route `/d/[token]`). Base: `main` at `38fc8776` (#268). **0077–0084 are on bis-ci and production: never re-apply.** Every file:line below was read off this worktree at `38fc8776`; anything not read is labelled **Assumption**.

`<WT>` = `C:\Users\danlo\bis-platform\.claude\worktrees\s07-3b` (Git Bash: `/c/Users/danlo/bis-platform/.claude/worktrees/s07-3b`), branch `feat/s07-vault-3b`. `<SCRATCH>` = `C:\Users\danlo\AppData\Local\Temp\claude\C--Users-danlo-bis-platform\efc99fd8-2a23-42ec-987c-f80cb2c56ca1\scratchpad` (Git Bash: `/c/Users/danlo/AppData/Local/Temp/claude/C--Users-danlo-bis-platform/efc99fd8-2a23-42ec-987c-f80cb2c56ca1/scratchpad`); write it out literally in every command. `<KIT3A>` = `<SCRATCH>/s07f-kit` (3a's kit, read 2026-10-18: `replica.sh` with `WT=…/worktrees/s07-3`, the `*0084_*` skip and the `0084_document_expiry_tasks.sql` post block; `pgrst.sh` with `PATH` naming PG18's bin and `SECRET="s07f-local-postgrest-jwt-secret-not-used-anywhere-real-0000"`, copying `postgrest.exe`, `make-jwt.js`, `proxy.mjs` from `/c/Users/danlo/AppData/Local/Temp/claude/C--Users-danlo-bis-platform/db21dcfe-6aee-47cd-8939-ff4f82a45810/scratchpad/s07-t3-impl`, all three present). `…/acct/` = `apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/`. `…/contacts/` = `…/acct/contacts/`. `…/documents/` = `…/acct/documents/`.

## Owner and orchestrator rulings (2026-10-18, after the opus plan review)

| # | Ruling | Where it lands |
|---|---|---|
| O1 | **(a).** The first-open row is the CUSTOMER kind labelled "The link's recipient" / "Quien recibió el enlace", a second word inside one kind as "Someone on the team" is inside the person kind (DESIGN.md, decided 2026-10-12), never a sixth kind. Why it needed a ruling: the closed set is typed (`apps/web/src/lib/record/author-mark.ts:10-13`, `KINDS`) and the customer kind's one word is `provenance.customer`, "Customer"/"Cliente" (`messages.ts:2668-2669`; `authorLabel`, `author-mark.ts:85`). | Task 2 (`provenance.linkRecipient`), Task 4 (`authorMark`'s one-row label swap), **Task 12 lands the DESIGN.md Provenance line (no longer conditional).** |
| O2 | **Revoke.** Switching a file to Owners only stops every live share link on it at once: `revokeDocumentShares` beside 3a's R1 delete in `setOwnersOnlyAction` (`…/contacts/documents-actions.ts:308`), after the request-client read and the Owners-only write, on the service client, scoped to the account and the document, failing exactly as R1's call does there (inside the action's `try`: a throw answers `documents.error.failed`). An Undo that writes Owners only BACK (`undoOwnersOnlyAction` with `prior === true`) stops them the same way, beside R1's twin there. **Undoing Owners only does NOT un-revoke.** | Task 6 (both actions, tests, probes: remove the call; move it before the write). Spec §4.1 amended. |
| O3 | **Keep `document_share_downloads`, and add a per-link total cap inside the claim: 100 downloads per link** (finding 8). Over the cap the claim answers `rate_limited`, records nothing. | Task 1 (0085's claim, `p_link_max`; tests and probe), Task 3 (`linkMax`), Task 5 (`SHARE_LINK_MAX_DOWNLOADS = 100`). |
| R-V | **Orchestrator (finding 3; replaces old deviation 9):** a link shares the version the reader SEES, computed on the server exactly as `documentView` computes it (`lib/documents/document-view.ts:36-38`: the newest CLEAN ready version; with none clean, the current one), never from an id the browser sends. With no clean version the share is refused: "still being checked" when the current one is pending, "removed" when it is infected or unscannable. | Task 3 (`shareableVersion`, `listReadyVersionScans`), Task 6 (the action and its cases). Spec §4.1 amended. |

## Deviations from the spec, and spec-vs-code mismatches (the source decided; evidence cited)

1. **There is no shared "IP + token" limiter to reuse, so 0085 adds `document_share_downloads`.** Spec §4.2: "reuses the forms and upload-link limiter keyed on IP + token hash". The FORMS limiter is a pattern, not a module: `clientIp(h)` and `hashIp(ip)` (`apps/web/src/lib/forms/guards.ts:111-117`, `:128-130`, an HMAC of the address, 32 hex) plus `RATE_LIMIT_MAX = 5` per `RATE_LIMIT_WINDOW_MS = 600_000` (`:9-10`), applied by COUNTING the surface's own rows (`countRecentSubmissions(db, form.id, ipHash, windowStart)`, `app/f/[publicId]/actions.ts:150`; the booking move does the same on bookings, `app/b/[publicId]/move/[token]/actions.ts:117-121`). The UPLOAD-LINK limiter is not keyed on an address at all: it is 20 starts per request per UTC day inside 0080's start function (`0080_document_requests.sql:169`). This plan reuses `clientIp`, `hashIp`, `RATE_LIMIT_MAX` and `RATE_LIMIT_WINDOW_MS` exactly, keyed on (the share the token hash found, the address hash), which needs rows to count: `document_share_downloads` (account, share, `ip_hash`, `created_at`), service-only, going with its share (cascade). §4.4 lists one table; this is a second. Kept by ruling O3, which adds a per-link total cap of 100 downloads inside the same claim.
2. **The Documents page has no row menu, so its "Copy share link" is the viewer's.** Spec §4.1: "in the document row menu (record card and Documents page) and in the viewer header". 3a's page rows are one open button and the filed-on link (`…/documents/documents-list.tsx:33-60`), no menu; adding one would be a new control on a list whose rule-4 row is a single target. The viewer is shared by the card and the page (`documents-list.tsx:66`, `documents-card.tsx:874`), so its header's **Copy share link** serves both; the record card ALSO gets it in the row menu, and **Stop sharing** lives on the card only (spec §4.1 places the "Shared" line and Stop sharing on the record's card).
3. **Each Copy share link makes a NEW link.** Spec §4.1: "mints a random token, stores sha256(token)". With only a hash, an existing link cannot be shown again (2b's deviation 1 derived its token for that reason; the spec here chose random, and nothing needs a re-copy: the card offers Stop sharing, not Copy again). So a file can have several live links; the card shows the latest expiry; **Stop sharing stops every live link of that file** (one compare-and-set update); its Undo puts back exactly the links that stop wrote (`ids` and `revoked_at` from its own answer), only the actor's own, only while each is unexpired.
4. **The timeline reads "{mark} shared {title}" and "{mark} opened {title}".** Spec §4.1: "Ana shared Seguro 2026.pdf"; §4.3: "Opened by the link's recipient". The timeline's grammar is "{mark} {verb}" (`apps/web/src/lib/record/timeline-rows.ts:66-138`; 2b deviation 5 made the same move). With O1 (a): "The link's recipient opened Seguro 2026.pdf" / "Quien recibió el enlace abrió Seguro 2026.pdf". Both rows come from ONE share row through the view `document_share_timeline` (0078 and 0079's pattern: a `security_invoker` view so the documents' RLS decides), as 2c's skip and un-skip rows come from one row (`document-requirements.ts:128-139`). `schema-grants-guard.test.ts:115`'s `rlsOff` list gains the view.
5. **The first open is counted inside the claim, before the URL is minted.** The claim function locks the share and decides "first" under that lock, so concurrent downloads produce exactly one `first_opened_at` (spec §6). It runs before `signedDocumentReadUrl`, so a storage failure AFTER a won claim records an open whose URL never left (residual, named: rare, logged by share id, never the token). A page load never claims (the owner's choice: link previewers).
6. **Every download refusal is the same answer.** `POST /api/s/<token>/download` answers `410 { "error": "unavailable" }` for a malformed, unknown, expired, revoked, trashed or removed token alike (spec §4.2 as amended 2026-10-18: "the download route answers every refusal identically, and an unknown token's page names no business"); `429 { "error": "rate_limited" }` and `503 { "error": "failed" }` only after the token proved open. The PAGE renders 200 for every state; its refusal pages name the business (spec §4.2), which only the holder of a real token can see; a malformed token and an unknown one render the same not-found page and read nothing past the shape check.
7. **`Cache-Control: no-store` on the page comes from `dynamic = "force-dynamic"`, not from `next.config.ts`.** Next overrides a configured `Cache-Control` on pages in production (**Assumption A1**); a force-dynamic page answers `private, no-cache, no-store, max-age=0, must-revalidate`. `Referrer-Policy: no-referrer` and `X-Robots-Tag: noindex` come from `next.config.ts` `headers()` (the file has no `headers()` today, `apps/web/next.config.ts:1-23`) and, belt and braces, the page's metadata (`robots`, `referrer`), as `/d` does (`app/d/[token]/page.tsx:16-24`). The download route sets all three itself. The e2e reads the page's real headers (Task 11).
8. **Refusal words in the staff action.** Spec §4.1: "This file is still being checked" or "This file was removed". Pending → `documents.error.scanning` ("This file is still being checked. Try again in a moment.", `messages.ts:4036`); infected or unscannable → `documents.error.removed` ("This file was removed and can't be opened.", `:4038`); a TRASHED file → `documents.error.trashed` ("This file is in the trash. Restore it first.", `:3979`), which tells staff what to do.
9. **The shared version is the one the reader sees (ruling R-V, replacing this plan's first draft).** The brief said "the version current at share time", but the card and the viewer SHOW the newest CLEAN version (`lib/documents/document-view.ts:36-38`, 2a deviation 1), which differs from `current_version_id` while a newer version is still being checked or was removed. The action computes it on the server the same way (`shareableVersion`, Task 3) from the document's ready versions read on the REQUEST client, never from a browser id: current infected + older clean → the older clean; current pending + older clean → the older clean; no clean version → refused (pending → "still being checked", infected/unscannable → "removed").
10. **No events.** The spec names none; 2b made the same call for requests (2b deviation 7). Nothing reads a share event. (A public route never emits `"user"` holds trivially.)
11. **The version link is same-account explicitly.** Spec §4.4: "version_id (composite FKs on account)". `document_versions` has `unique (document_id, id)` (`0077:94`) but no key with `account_id`; 0085 adds `document_versions_account_document_id_key unique (account_id, document_id, id)` (an index build on a live table, under `lock_timeout`) so the FK is `(account_id, document_id, version_id)`.
12. **Teardown lists both tables** (spec §4.4) in `ACCOUNT_OWNED_TABLES` (`packages/db/src/account-teardown.ts:21-29`) before `documents`, although the cascades already carry them; the fixture sweep runs that same list (`apps/web/e2e/fixtures/sweep.ts:125`), so one edit covers both.

## Assumptions (not verified by reading; each has a named check)

- **A1** A `force-dynamic` page's response carries `Cache-Control` containing `no-store`, and `next.config.ts` `headers()` with `source: "/s/:token"` adds `Referrer-Policy` and `X-Robots-Tag` to that page's response. Check: Task 11 test 2 reads `response.headers()` of `page.goto("/s/<token>")`.
- **A2** `make_interval(secs => p_window_seconds)` accepts an `integer` argument on PG17 and PG18 (its `secs` is `double precision`; an integer widens implicitly). Check: Task 1's rate case on the replica; CI `verify` on the Supabase CLI image.
- **A3** `public.document_shares%rowtype` resolves inside a function with `set search_path = ''`. Check: 0085 applies on `post` (Task 1 step 4).
- **A4** Playwright's `download` event fires when the page assigns `window.location` to a storage signed URL carrying `download=<name>` (attachment). Check: Task 11 test 2; if it does not fire, Task 11 STOPS and reports (the alternative, asserting the storage request, is the orchestrator's call).
- **A5** `lucide-react` exports `Link2` and `Download`. Check: `pnpm --filter web typecheck` in Tasks 4 and 8.
- **A6** PostgREST matches `.eq("revoked_at", <the value it returned>)` on a `timestamptz` (precedent `restoreDocumentRequest`, `packages/db/src/document-requests.ts:153-158`). Check: Task 3's restore case.
- (Read, not assumed: `canOpen(scan)` is `scan === "clean"` (`…/contacts/document-viewer.tsx:41-43`); `signedDocumentReadUrl(db, accountId, versionId, { seconds, download })` re-reads the version by account and id and refuses unless ready and clean (`packages/db/src/documents.ts:528-557`), and `read-gate.test.ts` pins it as the one mint; `requireAccountAccess` answers `{ userId, isAgency, role, canManage }`, `canManage` = Owner or agency (`apps/web/src/lib/auth.ts:36-60`); `isTokenShape` accepts exactly 43 base64url characters and `tokenHash` is sha256 hex (`lib/document-requests/token.ts:12`, `:23-24`); `originFrom(headers)` answers APP_ORIGIN first (`lib/email/origin.ts:33`); `brandDisplayName` answers the trimmed brand name or `""` (`packages/db/src/branding.ts:415-417`).)

## Global Constraints

- **NEVER `git stash`, `git reset`, `git restore`, `git checkout -- <file>`, `git commit --amend`, or any history rewrite** in the shared worktree. Another agent's uncommitted work lives in the same tree. To undo your own edit, edit it back. To see committed text, `git show HEAD:<path>`. Reviewers revert their probes BY HAND and prove it with `cmp` against `git show HEAD:<path> > <SCRATCH>/<dir>/orig` (`cmp` prints nothing). Never `rm -rf` anything under `<WT>` (memory "No rm -rf on worktrees"); scratch directories under `<SCRATCH>` are yours. Stage new files with `git add -- <new paths>`, then `git commit -m "…" -- <every path>`, never `-A` or `.`. If `.git/index.lock` exists, wait and retry; never delete it. Never push (the orchestrator pushes). Never touch `main`. Nobody merges or rebases but the orchestrator.
- **Commits** carry the trailer lines `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>` and `Claude-Session: https://claude.ai/code/session_013RThMy9QC8x7FZ94Lxib9p`.
- **Every public link follows one rule** (study §3.4). The token is re-proved on EVERY request (shape, then the sha256 lookup, then open: not revoked, not expired, the document not trashed, the version ready and clean). Every later query uses the service client with explicit `.eq("account_id", share.account_id)` AND the document (`share.document_id`) AND, for a version, `share.version_id`, all from the TOKEN ROW, never from the request. The browser sends nothing but the token in the path. The download route answers every refusal identically, and an unknown token's page names no business (deviation 6). Every page and route answer carries `Cache-Control: no-store`, `Referrer-Policy: no-referrer` and `X-Robots-Tag: noindex` (deviation 7). **Our code never logs the token or the link**: logs name the share id (or the account), never either. Named residual (as 2b's `token.ts` comment says for `/d`): the token is in the PATH, so Vercel's request log records `/s/<token>` and `/api/s/<token>/download` for every visit; that log is the platform's, not a column or a line of ours, and the link expires in 24 hours.
- **0085 is NOT on bis-ci until Task 14 step 2.** Until then: **no `@bis/db` vitest and no live web test may run against bis-ci** (a schema without the tables would report environment failures as code failures, and a mutation probe could write there). Every `@bis/db` suite runs on YOUR local PG18 replica ("The replica kit"), or is left to CI `verify` (which builds its own stack from the branch's migrations). `packages/db/.env` does NOT exist on this machine: never `pnpm --filter @bis/db exec vitest` with the default env, and never `pnpm --filter @bis/db ci:sql`. bis-ci reads are the orchestrator's, through the Supabase MCP `execute_sql`, read-only, on project `odnobiodsftffphuuosz`.
- **0085's byte and SQL rules.** ASCII only; no backslash anywhere; no `$` except the `$$` pairs that open and close a function body (so no `~ '…$'` anchors: shapes are written `char_length(x) = n and x !~ '[^0-9a-f]'`); every control byte for a positive control is written with `node`, never Git Bash `printf`. `set local lock_timeout = '5s'` is the first statement. RLS read through `exists`-shaped access on `documents` under the reader's own RLS (the restrictive `document_id in (select d.id from public.documents d)`, 0077's `document_versions_through_document` shape, `0077:149-150`); NO client write grant on either table; composite same-account FKs; the expiry CHECK; the coherent revoke pair; teardown and sweep list both tables; the rollback note in the header. A boolean from a nullable value is `coalesce(…, false)` (memory "plpgsql NULL guard"); the policies reuse 0077's helpers, which already coalesce.
- **Writes are server-only, after the action's request-client read** (0053). Every staff action: `requireAccountAccess(accountId)`, then a REQUEST-client read (`dbForRequest()`) that returns the document under RLS, and only then the service client, scoped to the same account and document. The new actions file is added to `in-account-service-reads.test.ts`'s `ALLOWED` as `proven-target`. **No new file under `apps/web/src/lib` contains the token `serviceDb`, not even in a comment** (that test scans `lib`): lib functions take the caller's client.
- **Ownership (tag on every task; no task edits a file its owner does not own).**
  - **bis-db-schema:** `packages/db/supabase/migrations/0085_document_shares.sql` (new), `packages/db/src/test/document-shares-schema.test.ts` (new), `packages/db/src/test/schema-grants-guard.test.ts` (`:115` only), `packages/db/src/account-teardown.ts` (`ACCOUNT_OWNED_TABLES` only), `<SCRATCH>/s07g-kit/*` (Task 1).
  - **bis-crm:** `apps/web/src/lib/messages.ts` + one `describe` in `messages.test.ts` (Task 2 only); `packages/db/src/document-shares.ts`, `packages/db/src/index.ts`, `packages/db/src/test/document-shares.test.ts` (Task 3); `packages/db/src/record.ts`, `packages/db/src/test/{record,timeline-merge}.test.ts`, `apps/web/src/lib/record/{author-mark,timeline-rows,recent-rows}.ts` (+ tests), `…/contacts/[contactId]/activity-timeline.tsx` (+ `activity-timeline.rows.test.ts`), `…/acct/groups/[groupId]/group-timeline.tsx` (+ test), `…/contacts/contact-drawer.tsx` (`ROW_ICON` only), `apps/web/src/lib/contacts/drawer-summary.ts` (`ROW_KINDS` only) (+ test), `apps/web/src/app/api/accounts/[accountId]/contacts/[contactId]/summary/route.reads.test.ts` (`MEASURED` only) (Task 4); `apps/web/src/lib/document-shares/{share-token,public-share}.ts` (+ tests), `apps/web/src/app/api/s/[token]/download/route.ts` (+ test) (Task 5); `…/contacts/document-shares-actions.ts` (+ test), O2's lines in `…/contacts/documents-actions.ts` (+ `documents-actions.test.ts`), `apps/web/src/lib/documents/{document-view,documents-load}.ts` (+ `documents-load.test.ts`), the two documents GET routes `apps/web/src/app/api/accounts/[accountId]/{contacts/[contactId],groups/[groupId]}/documents/route.ts` (+ tests), one `ALLOWED` line in `…/acct/in-account-service-reads.test.ts` (Task 6); `apps/web/src/lib/i18n/{catalogue,ratchet}-baseline.json` (Task 10, regenerated, never hand-edited).
  - **bis-platform:** `apps/web/src/proxy.ts` (+ `proxy.test.ts`), `apps/web/next.config.ts`, `apps/web/src/next-config.test.ts` (new) (Task 7).
  - **bis-frontend:** `…/contacts/{documents-card.tsx,documents-card-handlers.ts,document-viewer.tsx}` and their tests, `…/documents/documents-list.tsx` (+ test), `apps/web/src/app/(dashboard)/dashboard/styleguide/{documents-demo.tsx,documents-demo.test.ts}` (Task 8); `apps/web/src/app/s/**` (new) (Task 9).
  - **bis-e2e-qa:** `apps/web/e2e/document-shares.spec.ts` (new) (Task 11).
  - **Orchestrator:** Task 0, DESIGN.md (Task 12), the ledger, the bis-ci and production applies of 0085, the parity check, the gates, the PR, the merge, the tracker.
- **Shared files, one task at a time.** `apps/web/src/lib/messages.ts`: **Task 2 only** (every key this plan uses is listed there; a later task that finds one missing STOPS and reports; the orchestrator re-opens Task 2). `packages/db/src/index.ts`: **Task 3 only**. `packages/db/src/record.ts` and `lib/record/*`: **Task 4 only**. `…/contacts/documents-card*` and `document-viewer.tsx`: **Task 8 only**. `apps/web/src/lib/documents/{document-view,documents-load}.ts`: **Task 6 only** (Task 8 consumes `DocumentView.share`). `apps/web/src/lib/i18n/*-baseline.json`: Task 10 only, after every copy-bearing task.
- **Every test must be able to fail; the plan writer named each one's mutation, and the implementer RUNS it.** Run the probe, see the test fail BY NAME, paste the failing assertion line into the report, revert by editing back (and `cmp` it). A named mutation that does not fail its test is a finding: say so and substitute one that does. Shapes a reviewer rejects on sight (memory "Vacuous test shapes"): `toBeTruthy`/`toBeDefined` on content; a count-only guard where the content can be asserted; a WANT constant compared with a value built from the same constant; an English-only assertion where a Spanish twin exists (assert BOTH, the Spanish against the literal string, never `t()`'s output, which falls back to English silently); a mock that satisfies itself; an assertion on a value the fixture already held before the code ran; an assertion another element on the page could satisfy (scope every e2e locator to its row or its `data-*` marker); a negative `not.toContain` on raw `renderToStaticMarkup` output for a string with an apostrophe (use `renderedText()` from `apps/web/src/lib/rendered-text.ts` for EVERY copy assertion). A `-t` filter that matches nothing passes silently: read the run count in vitest's summary block.
- **DESIGN.md definition of done for every UI task (8, 9):** tokens only on the dashboard (radii `rounded-[var(--radius-ctl)]`, pills `rounded-full`; no hex, no literal shadow); on the public page, `var(--token, fallback)` CSS through `DOCREQ_CSS` and `publicFormTheme` exactly as `/d` (`app/d/[token]/page.tsx:47-92`; public trees never load `globals.css`); both themes via `.dark`; the blur fallback; rule 3 (the "Shared" line is words with an icon, no colour carries meaning; refusal pages are words); rule 5 (loaded, refusal and error states; the error boundary); rule 6 (Stop sharing runs at once with Undo in its toast; no "Are you sure?"); rule 7 (no spinner: a busy Download is a disabled button with the same word); rule 8 (the card keeps exactly ONE `data-variant="default"` button; Copy share link and Stop sharing are menu items or ghost; the viewer's one primary stays Download; the public page's one primary is Download); rule 9 (the public page carries the client's logo, colour and "Powered by BIS"); rule 11 (no `data-hero`); dashboard controls `min-h-11 md:min-h-8`, public controls `min-height: 44px` (`DOCREQ_CSS`); nothing animates on scroll; renders at 360 px with the pseudo-locale's +35%.
- **Copy.** Every new string through `t(m, key, locale, params)` with an `.es` twin on the line under it, in the same commit (`apps/web/src/lib/i18n/ratchet.test.ts`). Spanish is **usted**. New `.tsx` code carries no JSX literal copy with a letter in it. No vendor or internal words in copy ("token", "hash", "signed URL", "storage", "RLS", "share id"). The public page reads the ACCOUNT's language (`accounts.language`), then English (spec §5); the dashboard reads the reader's locale. A name shown to a customer is the brand name (`brandDisplayName`), never `accounts.name`; with no brand name every sentence that would name the business is its own no-name sentence (2b's `docCopy` rule, `app/d/[token]/copy.ts:1-28`).
- **Browser code imports the vault's rules from `@bis/db/document-rules`**, never the `@bis/db` barrel. `app/s/[token]/{copy.ts,share-download.tsx}`, `…/contacts/documents-card*.ts*`, `document-viewer.tsx`, `lib/documents/documents-load.ts` stay browser-safe (no barrel import, no `node:` import). `lib/document-shares/{share-token,public-share}.ts` are server-only.
- **The `vi.mock` factory check.** A task that adds a NEW named import from `@bis/db` to a module adds that name to every mock factory that reaches the module: `grep -rln 'vi.mock("@bis/db"' apps/web/src | xargs grep -ln "<module basename>"`. A component test that renders a module importing a `"use server"` file mocks that file (`documents-card.test.ts:5-13` is the shape).
- **Running tests.** Only the affected tests, by path: `pnpm --filter web exec vitest run "<path>" …`, **`pnpm --filter web typecheck` in EVERY task that touches a `.ts`/`.tsx` file, including e2e specs** (it covers `e2e/`; eslint alone missed a TS2532 in 3a), `pnpm --filter web exec eslint "<touched files>"`. `@bis/db` suites only on your replica, run in `packages/db` as `node node_modules/vitest/vitest.mjs run <files>` after sourcing the kit's env, judged by vitest's summary block (capture the exit code to a file with nothing after the command in the same block; the pnpm `ERR_PNPM_RECURSIVE_EXEC_FIRST_FAIL` trailer lies). Never the gates (`pnpm check`, `pnpm --filter web build`, `pnpm --filter web test:e2e`), never Playwright: the orchestrator runs them, one at a time (memory "Agent test scope"). Never pass the folder `…/accounts/` to vitest (it holds a live test).
- **Mutating e2e only on the per-run fixture account** (`readClientFixture()`, `apps/web/e2e/support.ts`), never `Test Client One`; every row and stored object deleted in `afterAll`, each error checked, then re-read.
- **Nothing sends, nothing calls a real provider.** 3b sends nothing: staff copy the link and send it themselves.
- **Never** apply a migration outside your own replica, run SQL that writes to a shared project, mutate Test Client One, create or edit `.env*`, or set a Vercel secret. Those are the orchestrator's, in Task 14.

## The replica kit (every `@bis/db` task and its reviewer)

This lane's ports are **55640–55649**, never `5432`. Assignment (a port set is free again only after its owner stopped its own kit): Task 1 implementer `55640`; Task 1 reviewer `55641`; **set A** (Postgres `55642`, PostgREST `55643`, gateway `55644`) for the Task 3 then the Task 4 implementer; **set B** (`55645`/`55646`/`55647`) for the Task 3 then the Task 4 reviewer; Task 13 (final review) Postgres `55641` (Task 1's reviewer is long done), PostgREST `55648`, gateway `55649`. Each agent works in its own `<SCRATCH>/s07g-t<N>-<impl|review>/`.

`<KIT3A>`'s `replica.sh` and `pgrst.sh`, copied and re-pointed by Task 1 to `<SCRATCH>/s07g-kit/`: `WT` becomes `/c/Users/danlo/bis-platform/.claude/worktrees/s07-3b`; `pre` is every migration through **0084** (with the storage stub 0077 needs); `post` is `pre` plus the branch's **0085** if it exists yet. The only lines that change in `replica.sh`: the `WT=` line, the `case "$f" in *0084_*)` skip (becomes `*0085_*`), and the `post` block's file name (`0085_document_shares.sql`) and three messages (`post = pre + 0085`, `0085 FAILED`, `post = pre (no 0085 yet)`). `pgrst.sh` changes ONLY its `SECRET=` string, to `s07g-local-postgrest-jwt-secret-not-used-anywhere-real-0000` (its `PATH` line already puts PG18's bin first for `libpq.dll`). Task 1 writes both with `sed` and shows the `diff` output: exactly those lines differ.

Bring up PostgREST for a `withTestAccount` suite: `bash <SCRATCH>/s07g-kit/replica.sh <pg> <dir>` then `bash <SCRATCH>/s07g-kit/pgrst.sh <pg> <pgrst> <gateway> <dir>`, then `source <dir>/env-run.sh` in the same shell that runs vitest. The proxy forwards `/rest/v1/*` to PostgREST and answers `DELETE /storage/v1/object/documents` with `200 []`; anything else storage gets 404, so a db test that unexpectedly reaches storage fails loudly.

Stop your own kit only (never `taskkill /IM postgrest.exe`): `touch "<dir>/stop"`, then in PowerShell `Get-Process postgrest | Where-Object { $_.Path -eq '<dir as a Windows path>\postgrest.exe' } | Stop-Process -Confirm:$false` and `Get-NetTCPConnection -LocalPort <gatewayPort> -State Listen | ForEach-Object { Stop-Process -Id $_.OwningProcess -Confirm:$false }`; then `"/c/Program Files/PostgreSQL/18/bin/pg_ctl" -D "<dir>/pgdata" stop -m fast`. A SQL mutation probe on `post` needs `psql … -d post -c "notify pgrst, 'reload schema'"` afterwards.

**Faithfulness** (once per kit build): the client-write-surface digest on `pre` equals bis-ci's (bis-ci has 0084 and not 0085 until Task 14 step 2). The agent runs it on `pre`; **the ORCHESTRATOR runs it on bis-ci through the Supabase MCP `execute_sql` (read-only, project `odnobiodsftffphuuosz`) in Task 0 step 2 and puts the value in Task 1's brief** (no agent reads bis-ci). The query:

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

- `packages/db/src/test/schema-grants-guard.test.ts:115`: `rlsOff` becomes `["document_scan_timeline", "document_share_timeline", "document_version_timeline"]`, its comment naming 0085's view (Task 1). `EXPECTED_WRITES` is UNCHANGED (0085 grants no client write; the guard proves it).
- `packages/db/src/test/timeline-merge.test.ts:145-149`: `TIMELINE_SOURCES.length + 5` becomes `+ 7` (0085's two `document_share_timeline` reads: a share at `created_at`, an open at `first_opened_at`), its comment naming them; a sibling line `expect(paged.filter((r) => r.table === "document_share_timeline").map((r) => r.limit)).toEqual([TIMELINE_PAGE_SIZE + 1, TIMELINE_PAGE_SIZE + 1]);`; one new case beside `:215`: a refused `document_share_timeline` read fails the `documents` source (Task 4).
- `apps/web/src/app/api/accounts/[accountId]/contacts/[contactId]/summary/route.reads.test.ts:69`: `MEASURED` 29 → **31**, the comment naming `request:document_share_timeline` twice (Task 4; read the number off the failure first, stop if it is not 31).
- `…/contacts/documents-card.test.ts:191-194` and `:384`: a clean file's menu gains `"share"` after `"download"`: `["edit", "newVersion", "download", "share", "trash"]` and `[["edit", "documents.edit"], ["ownersOnly", "documents.makeOwnersOnly"], ["newVersion", "documents.newVersion"], ["download", "documents.download"], ["share", "documents.share"], ["trash", "documents.trash"]]`. `:382`, `:383`, `:402` (removed, pending, locked) are UNCHANGED (no share for a non-clean file) (Task 8).
- `apps/web/src/proxy.test.ts`: the skip list (`:23-26`) gains `"/s/sometoken"` and `"/s/AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"`; the run list (`:28-31`) gains `"/api/s/sometoken/download"`, `"/settings"`, `"/s"`; the drop-list mutation in the skip case's title names `s/`; the last case's title "only the five trees" becomes "only the six trees" and its list gains `"/sx"`, `"/support"` (Task 7).
- `apps/web/src/app/api/accounts/[accountId]/contacts/[contactId]/documents/route.test.ts:10-13` and the group route's test: the `db` mock gains `listLiveDocumentShares: vi.fn()` (set to `async () => ({})` in `beforeEach`); every existing `toEqual` on a document view stays EXACTLY equal (a view carries `share` ONLY when a live link exists); one new case each (Task 6).
- `…/contacts/documents-actions.test.ts:13-25` (ruling O2): the `db` mock object gains `revokeDocumentShares: vi.fn()`; every existing case stays; new O2 cases (Task 6).
- `…/acct/in-account-service-reads.test.ts`: `ALLOWED` gains `"app/(dashboard)/dashboard/accounts/[accountId]/contacts/document-shares-actions.ts": "proven-target"` beside `:105` (Task 6).
- `apps/web/src/app/(dashboard)/dashboard/styleguide/documents-demo.test.ts`: every existing exact count stays; one new count, `data-document-shared` = 1 (Task 8).
- `apps/web/src/lib/messages.test.ts`: one new `describe` at the end (Task 2).
- **Unchanged, checked:** `apps/web/src/lib/documents/read-gate.test.ts` (no new mint: the download calls `signedDocumentReadUrl`, the one gate); `packages/db/src/test/record.test.ts`'s existing cases (one new case appended); `TIMELINE_SOURCES` (`record.ts:272`, the share rows join the existing `documents` source).

## Not in this PR

- A configurable lifetime (fixed 24 h), multi-file or zip shares (spec §1).
- Copying an existing link again (deviation 3), sending a link by text or email from the product, an event per share (deviation 10).
- Revoking live links when a file goes to the trash (the download refuses while it is trashed and a restore brings the link back while it is unexpired). Going Owners only DOES revoke them (ruling O2); undoing Owners only never un-revokes.
- A sweep of old `document_shares` / `document_share_downloads` rows (they go with their document or account; volume is one row per link and per download).
- A row menu on the Documents page (deviation 2).

## File Structure

**Created**

| Path | Owner | Responsibility |
|---|---|---|
| `packages/db/supabase/migrations/0085_document_shares.sql` | bis-db-schema | the version key, `document_shares`, `document_share_downloads`, RLS and grants, the claim function, the timeline view |
| `packages/db/src/test/document-shares-schema.test.ts` | bis-db-schema | 0085 on the replica: checks, FKs, cascade, RLS, no client write, the claim (open, closed, rate, first), the lock, the view |
| `packages/db/src/document-shares.ts` (+ `test/document-shares.test.ts`) | bis-crm | every share read and write the app makes |
| `apps/web/src/lib/document-shares/share-token.ts` (+ test) | bis-crm | the random token and the link |
| `apps/web/src/lib/document-shares/public-share.ts` (+ test) | bis-crm | the public rule: resolve a token, the page's read, the download |
| `apps/web/src/app/api/s/[token]/download/route.ts` (+ test) | bis-crm | the one public route |
| `…/contacts/document-shares-actions.ts` (+ test) | bis-crm | Copy share link, Stop sharing, its Undo |
| `apps/web/src/next-config.test.ts` | bis-platform | the `/s` page's two headers |
| `apps/web/src/app/s/[token]/{layout.tsx,page.tsx,data.ts,copy.ts,share-download.tsx,error.tsx}` (+ tests) | bis-frontend | the public page |
| `apps/web/e2e/document-shares.spec.ts` | bis-e2e-qa | share, open in a fresh context, download, timeline row, Stop sharing, revoked page, Undo |

**Modified:** `packages/db/src/{account-teardown,record,index}.ts`; `packages/db/src/test/{schema-grants-guard,timeline-merge,record}.test.ts`; `apps/web/src/lib/messages.ts` (+ test); `apps/web/src/lib/record/{author-mark,timeline-rows,recent-rows}.ts` (+ tests); both timelines (+ tests); `…/contacts/contact-drawer.tsx`; `apps/web/src/lib/contacts/drawer-summary.ts` (+ test); `…/summary/route.reads.test.ts`; `apps/web/src/lib/documents/{document-view,documents-load}.ts` (+ test); both documents GET routes (+ tests); `…/acct/in-account-service-reads.test.ts`; `apps/web/src/proxy.ts` (+ test); `apps/web/next.config.ts`; `…/contacts/{documents-card.tsx,documents-card-handlers.ts,document-viewer.tsx}` (+ tests); `…/documents/documents-list.tsx` (+ test); the styleguide demo (+ test); `apps/web/src/lib/i18n/{catalogue,ratchet}-baseline.json`; `DESIGN.md` (Task 12, only on O1 (a)).

## Task list, owners, order

| # | Task | Suggested agent | Review | Depends on | Files |
|---|---|---|---|---|---|
| 0 | Confirm the base; record the rulings; bis-ci's digest | orchestrator | n/a | — | none |
| 1 | Migration 0085 and its proof on the replica; the kit; teardown; the grants guard | bis-db-schema | **opus** | 0 | the migration, `document-shares-schema.test.ts`, `schema-grants-guard.test.ts:115`, `account-teardown.ts`, `<SCRATCH>/s07g-kit/*` |
| 2 | Every key (**messages.ts, the only writer**) | bis-crm | sonnet | 0 | `lib/messages.ts`, `lib/messages.test.ts` |
| 3 | `@bis/db`: the share module and the barrel | bis-crm | **opus** | 1 | `document-shares.ts`, `index.ts`, its test |
| 4 | The timeline: shared and opened rows, the recipient's mark | bis-crm | sonnet | 2, 3 | `record.ts`, `lib/record/*`, both timelines, the drawer maps, three pinned tests |
| 5 | The token, the public rule, the download route | bis-crm | **opus** | 2, 3 | `lib/document-shares/*`, `app/api/s/[token]/download/*` |
| 6 | Staff actions; the card's read carries the live link | bis-crm | **opus** | 2, 3 | `contacts/document-shares-actions*`, `lib/documents/{document-view,documents-load}*`, the two documents routes, one `ALLOWED` line |
| 7 | The proxy carve-out and the page's headers | bis-platform | **opus** | 0 | `proxy.ts`, `proxy.test.ts`, `next.config.ts`, `next-config.test.ts` |
| 8 | The card, the viewer, the handlers, the Documents page's viewer; `/styleguide` | bis-frontend | sonnet | 2, 6 | `contacts/{documents-card,documents-card-handlers,document-viewer}*`, `documents/documents-list*`, `styleguide/documents-demo*` |
| 9 | The public page `/s/[token]` | bis-frontend | **opus** | 2, 5, 7 | `app/s/**` |
| 10 | Regenerate the i18n baselines | bis-crm | sonnet | 2, 4, 8, 9 | `lib/i18n/*-baseline.json` |
| 11 | The e2e spec | bis-e2e-qa | sonnet | 4, 5, 6, 7, 8, 9, 10 | `e2e/document-shares.spec.ts` |
| 12 | DESIGN.md Provenance line (ruling O1) | orchestrator | n/a | 0 | `DESIGN.md` |
| 13 | Whole-branch final review (checkpoint) | reviewer | **opus** | 1–12 | none |
| 14 | Rollout (orchestrator; LAST) | orchestrator | n/a | 13 | none in the repo |

```
Wave A (three lanes):  T1 (bis-db-schema)        T2 (bis-crm)                 T7 (bis-platform)          T12 (orchestrator, DESIGN.md)
Wave B:                T3 (bis-crm, after T1)
Wave C (three lanes):  T4 (bis-crm, after T2,T3) T5 (bis-crm 2nd, after T2,T3) T6 (bis-crm 3rd, after T2,T3)
Wave D (two lanes):    T8 (bis-frontend, after T6)                            T9 (bis-frontend 2nd, after T5, T7)
Wave E:                T10, then T11
Checkpoint:            T13
Rollout:               T14 (orchestrator, LAST)
```

Disjointness: T4 (`record.ts`, `lib/record/*`, the two timelines, `contact-drawer.tsx`'s `ROW_ICON`, `drawer-summary.ts`, `timeline-merge`/`record`/`route.reads` tests), T5 (`lib/document-shares/*`, `app/api/s/**`) and T6 (`contacts/document-shares-actions*`, `lib/documents/{document-view,documents-load}*`, the two documents routes, one `ALLOWED` line) share no file; only T4 runs a db suite (replica set A, after T3's implementer stopped its kit). T8 (`contacts/documents-card*`, `document-viewer*`, `documents/documents-list*`, the styleguide demo) and T9 (`app/s/**`) share no file. **0085 goes to bis-ci only AFTER Task 13 approves it unchanged** (a finding that changes 0085 must not need a second migration). Until then the e2e job's migration check is red on every push, expected and named in each CI reading. 0085 is additive (two new tables, a view, a function, and a unique key every existing version row satisfies, `id` being the primary key), so it applies to production BEFORE the merge; the code needs it, so **the migration goes before the code deploy** (spec §7).

---

## Task 0: Confirm the base; record the rulings; bis-ci's digest (orchestrator)

- [ ] **Step 1.** In `<WT>`: `git log --oneline -2` shows this plan's commit, then `38fc8776 A Documents page shows every file expiring soon …`. `git fetch origin && git log --oneline origin/main -1`; if `main` moved past `38fc8776`, read what moved it; if it touched any file in "File Structure", `git merge origin/main` into `<WT>` ONCE now (never rebase), before any lane starts.
- [ ] **Step 1b.** `pnpm install --frozen-lockfile` in `<WT>` (read 2026-10-18: this worktree has no `node_modules`). `git status --short` shows no lockfile change.
- [ ] **Step 2.** Confirm, and stop if any line differs:
  - `ls packages/db/supabase/migrations | tail -1` → `0084_document_expiry_tasks.sql`; `git log --all --oneline -- 'packages/db/supabase/migrations/0085*'` → nothing.
  - `grep -n 'expect((await writeSurface(c)).rlsOff)' packages/db/src/test/schema-grants-guard.test.ts` → `115:`.
  - `grep -n "TIMELINE_SOURCES.length + 5" packages/db/src/test/timeline-merge.test.ts` → `147:`; `grep -n "const MEASURED = 29" "apps/web/src/app/api/accounts/[accountId]/contacts/[contactId]/summary/route.reads.test.ts"` → `69:`.
  - `grep -n '"documents", "opportunities"' packages/db/src/account-teardown.ts` → `26:`.
  - `grep -n 'u/|d/|' apps/web/src/proxy.ts` → the matcher line `"/((?!_next|c/|f/|b/|u/|d/|.*\\..*).*)"`.
  - `grep -n 'documents-actions.ts": "proven-target"' "apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/in-account-service-reads.test.ts"` → `101:`.
  - `grep -n '"record.facts.channel.chat.es"' apps/web/src/lib/messages.ts` → `4911:` (the catalogue's last key); `wc -l < apps/web/src/lib/messages.test.ts` → `818`.
  - `ls "<KIT3A>/replica.sh" "<KIT3A>/pgrst.sh"` and the three files `pgrst.sh` copies → all exist.
  - Read-only, MCP `execute_sql`: on production (`tlbkbmlrfafquucsmsmm`) and bis-ci (`odnobiodsftffphuuosz`), `select max(version) from supabase_migrations.schema_migrations` names the 0084 apply on both. On bis-ci, the Faithfulness query above: record its value for Task 1's brief.
- [ ] **Step 3.** Record the rulings O1–O3 and R-V (2026-10-18) in the ledger. Run Task 12 in Wave A.

---

## Task 1: Migration 0085 and its proof on the replica; the kit; teardown; the grants guard (bis-db-schema)

**Review:** opus. **Runs beside:** Tasks 2 and 7. **Scratch:** `<SCRATCH>/s07g-t1-impl/`, replica port `55640` (reviewer `s07g-t1-review/`, `55641`).

**Files**
- Create: `<SCRATCH>/s07g-kit/replica.sh`, `<SCRATCH>/s07g-kit/pgrst.sh` (outside the repo)
- Create: `packages/db/supabase/migrations/0085_document_shares.sql`
- Create: `packages/db/src/test/document-shares-schema.test.ts`
- Modify: `packages/db/src/test/schema-grants-guard.test.ts:112-115`; `packages/db/src/account-teardown.ts:21-29`

**Interfaces**
- Consumes (SQL): `public.documents` (0077:53-81, `documents_account_id_id_key`), `public.document_versions` (0077:83-95; 0079's `scan_status`), `app.is_agency()`, `app.current_account_id()` (0077's policies use them, `:139-150`).
- Produces (SQL), every name read by a later task:
  - `document_versions_account_document_id_key unique (account_id, document_id, id)`.
  - `public.document_shares (id, account_id, document_id, version_id, token_hash, created_by, created_at, expires_at, revoked_at, revoked_by, first_opened_at, open_count)` with constraints `document_shares_token_hash_key`, `document_shares_token_hash_check`, `document_shares_created_by_check`, `document_shares_open_count_check`, `document_shares_expiry`, `document_shares_revoke_coherent`, `document_shares_opened_coherent`, `document_shares_document_fkey`, `document_shares_version_fkey`, `document_shares_account_id_id_key`; index `document_shares_by_document`; policies `document_shares_member_read`, `document_shares_through_document`.
  - `public.document_share_downloads (id, account_id, share_id, ip_hash, created_at)`, `document_share_downloads_share_fkey`, index `document_share_downloads_recent`.
  - `public.claim_document_share_download(p_account_id uuid, p_share_id uuid, p_ip_hash text, p_max integer, p_window_seconds integer, p_link_max integer) returns jsonb`: `{status:'ok', first:boolean}` | `{status:'not_found'}` | `{status:'closed'}` | `{status:'rate_limited'}` (the address limit in the window, OR the link's total `open_count >= p_link_max`, ruling O3); service_role only.
  - `public.document_share_timeline` (security_invoker): `id, account_id, document_id, created_by, created_at, expires_at, revoked_at, first_opened_at, title, category, contact_id, client_group_id, deleted_at`.
  - `ACCOUNT_OWNED_TABLES` gains `"document_share_downloads", "document_shares"` right before `"documents"`.

- [ ] **Step 1: Build the kit.**

```bash
S=/c/Users/danlo/AppData/Local/Temp/claude/C--Users-danlo-bis-platform/efc99fd8-2a23-42ec-987c-f80cb2c56ca1/scratchpad
K=$S/s07f-kit
mkdir -p "$S/s07g-kit" "$S/s07g-t1-impl"
sed -e 's#/worktrees/s07-3$#/worktrees/s07-3b#' -e 's#\*0084_\*#*0085_*#' -e 's#0084_document_expiry_tasks.sql#0085_document_shares.sql#g' \
    -e 's#post = pre + 0084#post = pre + 0085#' -e 's#0084 FAILED#0085 FAILED#' -e 's#(no 0084 yet)#(no 0085 yet)#' \
    "$K/replica.sh" > "$S/s07g-kit/replica.sh"
sed -e 's#s07f-local-postgrest#s07g-local-postgrest#' "$K/pgrst.sh" > "$S/s07g-kit/pgrst.sh"
diff "$K/replica.sh" "$S/s07g-kit/replica.sh"; diff "$K/pgrst.sh" "$S/s07g-kit/pgrst.sh"
```

Paste both diffs: only the lines named in "The replica kit" differ. Run `bash "$S/s07g-kit/replica.sh" 55640 "$S/s07g-t1-impl"` → `post = pre (no 0085 yet)`. Run the Faithfulness query on `pre` (`"/c/Program Files/PostgreSQL/18/bin/psql" -h localhost -p 55640 -U postgres -d pre -Atc "<query>"`); compare with the bis-ci value in your brief; stop if they differ.

- [ ] **Step 2: Read before writing.** `sed -n 1,200p packages/db/supabase/migrations/0077_document_vault.sql` (the tables, keys, grants and the two version policies 0085 copies), `sed -n 40,70p packages/db/supabase/migrations/0078_document_space_used.sql` (the view's shape and grants), `sed -n 1,140p packages/db/supabase/migrations/0080_document_requests.sql` (header, rollback note, the table and its policies), `sed -n 1,90p packages/db/src/test/document-vault-rls.test.ts` (the seed with Owner, Staff, two Technicians, a second account, the agency), `packages/db/src/test/document-vault-reserve-lock.test.ts` (the committed-seed lock test this one copies), `packages/db/src/test/db.ts` (`withRollback`, `actAs`), `sed -n 1,40p packages/db/src/account-teardown.ts`, `sed -n 100,120p packages/db/src/test/schema-grants-guard.test.ts`.

- [ ] **Step 3: Write the failing test** `packages/db/src/test/document-shares-schema.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { Client } from "pg";
import { randomBytes } from "node:crypto";
import { withRollback, actAs } from "./db";
import { TEST_ORG_ID_PREFIX } from "../org-id";
import { ACCOUNT_OWNED_TABLES } from "../account-teardown";

/**
 * 0085 (S-07 3b, spec 4.4; plan deviations 1, 4, 5, 11, 12): the share, its same-account keys, its
 * checks, who reads it (exactly who reads its document), that the client role writes nothing, the
 * claim (open, closed, the forms limiter's numbers per link and address, the first open once), the
 * lock that makes "first" exactly once, and the timeline view. Its own seed, in
 * document-vault-rls.test.ts's shape.
 */
const RUN = Math.random().toString(36).slice(2, 10);
const ORG = `org_dsh_${RUN}`;
const ORG_B = `org_dshb_${RUN}`;
const SUB = { owner: `u_dsh_owner_${RUN}`, staff: `u_dsh_staff_${RUN}`, tech: `u_dsh_tech_${RUN}`, tech2: `u_dsh_tech2_${RUN}`, ownerB: `u_dsh_ownerb_${RUN}` } as const;
type Who = keyof typeof SUB | "agency";
const claims = (p: Who) =>
  p === "agency" ? { app_role: "agency_admin", sub: `u_dsh_agency_${RUN}` } : { org_id: p === "ownerB" ? ORG_B : ORG, sub: SUB[p] };
const hex = (bytes: number) => randomBytes(bytes).toString("hex");
const IP = "a".repeat(32);

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
const one = async (c: Client, sql: string, args: unknown[]) => (await c.query<{ id: string }>(sql, args)).rows[0]!.id;

/** A ready, clean version of `doc`, made current (the app's path is reserve, then the finish, then the scan). */
async function cleanVersion(c: Client, acct: string, doc: string): Promise<string> {
  const { rows: [r] } = await c.query<{ r: { version_id: string } }>(
    "select public.reserve_document_version($1, $2, 10, 'application/pdf', 'x.pdf', 'user_seed') as r", [acct, doc]);
  const v = r!.r.version_id;
  // 0079's document_versions_scan_coherent: a non-pending scan has its scanned_at (review F2).
  await c.query("update document_versions set status = 'ready', sha256 = repeat('a', 64), scan_status = 'clean', scanned_at = now() where id = $1", [v]);
  await c.query("update documents set current_version_id = $2 where id = $1", [doc, v]);
  return v;
}
const share = (c: Client, acct: string, doc: string, ver: string, o: { hash?: string; createdAt?: string; hours?: number } = {}) =>
  attempt<{ id: string }>(c,
    `insert into document_shares (account_id, document_id, version_id, token_hash, created_by, created_at, expires_at)
     values ($1, $2, $3, $4, 'user_seed', $5::timestamptz, $5::timestamptz + make_interval(hours => $6)) returning id`,
    [acct, doc, ver, o.hash ?? hex(32), o.createdAt ?? new Date().toISOString(), o.hours ?? 24]);
const claim = async (c: Client, acct: string, id: string, ip = IP, max = 5, windowSeconds = 600, linkMax = 100) =>
  (await c.query<{ r: { status: string; first?: boolean } }>(
    "select public.claim_document_share_download($1, $2, $3, $4, $5, $6) as r", [acct, id, ip, max, windowSeconds, linkMax])).rows[0]!.r;

async function seed(c: Client) {
  const { rows: [agency] } = await c.query<{ id: string }>("select id from agencies limit 1");
  const acct = await one(c, "insert into accounts (agency_id, clerk_org_id, name, client_access_enabled) values ($1,$2,'DSH Co',true) returning id", [agency!.id, ORG]);
  const acctB = await one(c, "insert into accounts (agency_id, clerk_org_id, name, client_access_enabled) values ($1,$2,'DSH B',true) returning id", [agency!.id, ORG_B]);
  const u = {} as Record<keyof typeof SUB, string>;
  for (const k of Object.keys(SUB) as (keyof typeof SUB)[]) u[k] = await one(c, "insert into users (clerk_user_id, email) values ($1, $1 || '@example.com') returning id", [SUB[k]]);
  await c.query(
    `insert into memberships (user_id, scope, account_id, role) values
       ($1,'account',$6,'owner'), ($2,'account',$6,'staff'), ($3,'account',$6,'technician'), ($4,'account',$6,'technician'), ($5,'account',$7,'owner')`,
    [u.owner, u.staff, u.tech, u.tech2, u.ownerB, acct, acctB]);
  const ct = (who: string, name: string) => one(c, "insert into contacts (account_id, first_name, assigned_to) values ($1,$2,$3) returning id", [acct, name, who]);
  const mine = await ct(u.tech, "Mine");
  const theirs = await ct(u.tech2, "Theirs");
  const d = (contact: string, ownersOnly: boolean, title: string) =>
    one(c, `insert into documents (account_id, contact_id, title, category, owners_only, source, created_by)
            values ($1,$2,$3,'insurance',$4,'upload','user_seed') returning id`, [acct, contact, title, ownersOnly]);
  const docs = { mine: await d(mine, false, "mine"), mineOwners: await d(mine, true, "mineOwners"), theirs: await d(theirs, false, "theirs") };
  const vers = { mine: await cleanVersion(c, acct, docs.mine), mineOwners: await cleanVersion(c, acct, docs.mineOwners), theirs: await cleanVersion(c, acct, docs.theirs) };
  const shares = {
    mine: (await share(c, acct, docs.mine, vers.mine)).rows[0]!.id,
    mineOwners: (await share(c, acct, docs.mineOwners, vers.mineOwners)).rows[0]!.id,
    theirs: (await share(c, acct, docs.theirs, vers.theirs)).rows[0]!.id,
  };
  return { acct, acctB, mine, docs, vers, shares };
}

describe("0085: the share's own rules (spec 4.4)", () => {
  it("lives exactly 24 hours (mutation: drop document_shares_expiry -> the 23-hour insert succeeds -> FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      await expect(share(c, s.acct, s.docs.mine, s.vers.mine, { hours: 23 })).rejects.toMatchObject({ code: "23514", constraint: "document_shares_expiry" });
    }));

  it("a revoke has both its time and its author, an open both its time and its count (mutations: drop document_shares_revoke_coherent; drop document_shares_opened_coherent -> FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      await expect(attempt(c, "update document_shares set revoked_at = now() where id = $1", [s.shares.mine]))
        .rejects.toMatchObject({ code: "23514", constraint: "document_shares_revoke_coherent" });
      await expect(attempt(c, "update document_shares set first_opened_at = now() where id = $1", [s.shares.mine]))
        .rejects.toMatchObject({ code: "23514", constraint: "document_shares_opened_coherent" });
    }));

  it("one row per token hash, and the hash is 64 lower-case hex (mutations: drop the unique key; drop the shape check -> FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      const h = hex(32);
      await share(c, s.acct, s.docs.mine, s.vers.mine, { hash: h });
      await expect(share(c, s.acct, s.docs.mine, s.vers.mine, { hash: h })).rejects.toMatchObject({ code: "23505", constraint: "document_shares_token_hash_key" });
      await expect(share(c, s.acct, s.docs.mine, s.vers.mine, { hash: h.toUpperCase().slice(0, 63) + "A" }))
        .rejects.toMatchObject({ code: "23514", constraint: "document_shares_token_hash_check" });
    }));

  it("a share names a document of ITS account and a version of THAT document (mutations: the document FK without account_id; the version FK on version_id alone -> FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      await expect(share(c, s.acctB, s.docs.mine, s.vers.mine)).rejects.toMatchObject({ code: "23503", constraint: "document_shares_document_fkey" });
      await expect(share(c, s.acct, s.docs.mine, s.vers.theirs)).rejects.toMatchObject({ code: "23503", constraint: "document_shares_version_fkey" });
    }));

  it("deleting the document deletes its shares and their downloads (mutations: no cascade on BOTH share FKs, document_fkey and version_fkey (one alone still cascades through the other path) -> the delete FAILS 23503; no cascade on document_share_downloads_share_fkey -> FAILS 23503)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      expect((await claim(c, s.acct, s.shares.mine)).status).toBe("ok");
      await c.query("delete from documents where id = $1", [s.docs.mine]);
      const { rows: [n] } = await c.query<{ s: string; d: string }>(
        "select (select count(*) from document_shares where id = $1)::text as s, (select count(*) from document_share_downloads where share_id = $1)::text as d", [s.shares.mine]);
      expect(n).toEqual({ s: "0", d: "0" });
    }));

  it("the teardown list deletes both tables before documents (spec 4.4; mutation: drop either name -> FAILS)", () => {
    const at = (t: string) => ACCOUNT_OWNED_TABLES.indexOf(t as (typeof ACCOUNT_OWNED_TABLES)[number]);
    expect(at("document_share_downloads")).toBeGreaterThan(-1);
    expect(at("document_share_downloads")).toBeLessThan(at("document_shares"));
    expect(at("document_shares")).toBeLessThan(at("documents"));
  });
});

describe("0085: who reads a share (spec 4.4, 6: exactly who reads its document)", () => {
  // The share table ALONE (no join to documents): a join would let the documents policies hide a row even
  // with document_shares_through_document dropped, and the case could not fail. Ids map to names here.
  const read = async (c: Client, who: Who, scope: string[], names: Record<string, string>) => {
    await actAs(c, claims(who));
    const { rows } = await c.query<{ document_id: string }>(
      "select document_id from document_shares where account_id = any($1::uuid[])", [scope]);
    await c.query("reset role");
    return rows.map((r) => names[r.document_id] ?? "unknown").sort();
  };
  // [who, the titles whose share they read, the mutation that fails the case]
  const cases: [Who, string[], string][] = [
    ["owner", ["mine", "mineOwners", "theirs"], "drop policy document_shares_member_read"],
    ["agency", ["mine", "mineOwners", "theirs"], "document_shares_member_read without app.is_agency()"],
    ["staff", ["mine", "theirs"], "drop policy document_shares_through_document"],
    ["tech", ["mine"], "drop policy document_shares_through_document"],
    ["tech2", ["theirs"], "drop policy document_shares_through_document"],
    // Two layers deep for another account (the share's tenant check AND its document's), so no single policy
    // mutation can fail this row; its mutation is the pair, said so (document-vault-rls.test.ts's precedent).
    ["ownerB", [], "member_read as using (true) AND through_document dropped, together"],
  ];
  it.each(cases)("%s reads %j (mutation: %s -> FAILS)", (who, want) =>
    withRollback(async (c) => {
      const s = await seed(c);
      const names = Object.fromEntries(Object.entries(s.docs).map(([k, id]) => [id, k]));
      expect(await read(c, who, [s.acct, s.acctB], names)).toEqual(want);
    }));

  it("the timeline view follows the same rules: Staff never see an Owners-only file's share (mutation: create the view without security_invoker -> FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      await actAs(c, claims("staff"));
      const { rows } = await c.query<{ title: string }>("select title from document_share_timeline where account_id = $1 order by 1", [s.acct]);
      expect(rows.map((r) => r.title)).toEqual(["mine", "theirs"]);
    }));
});

describe("0085: the client role writes nothing (spec 4.4)", () => {
  it("no INSERT, UPDATE or DELETE on either table for anon or authenticated, no SELECT on downloads, no EXECUTE on the claim; service_role holds them (mutations: grant insert on document_shares to authenticated; grant execute to authenticated -> FAILS)", () =>
    withRollback(async (c) => {
      const { rows } = await c.query<{ x: string }>(`
        select r || ' ' || t || ' ' || p || ' ' || has_table_privilege(r, 'public.' || t, p)::text as x
          from (values ('anon'), ('authenticated'), ('service_role')) a(r)
         cross join (values ('document_shares'), ('document_share_downloads')) b(t)
         cross join (values ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE')) d(p) order by 1`);
      const has = (r: string, t: string, p: string) => rows.some((x) => x.x === `${r} ${t} ${p} true`);
      for (const r of ["anon", "authenticated"]) for (const t of ["document_shares", "document_share_downloads"]) for (const p of ["INSERT", "UPDATE", "DELETE"]) expect(has(r, t, p)).toBe(false);
      expect([has("authenticated", "document_shares", "SELECT"), has("authenticated", "document_share_downloads", "SELECT"), has("anon", "document_shares", "SELECT")]).toEqual([true, false, false]);
      for (const p of ["SELECT", "INSERT", "UPDATE", "DELETE"]) expect(has("service_role", "document_shares", p) && has("service_role", "document_share_downloads", p)).toBe(true);
      const { rows: [fx] } = await c.query<{ a: boolean; s: boolean }>(
        `select has_function_privilege('authenticated', 'public.claim_document_share_download(uuid, uuid, text, integer, integer, integer)', 'execute') as a,
                has_function_privilege('service_role', 'public.claim_document_share_download(uuid, uuid, text, integer, integer, integer)', 'execute') as s`);
      expect(fx).toEqual({ a: false, s: true });
    }));

  it("a signed-in Owner's insert is refused (mutation: grant insert -> the insert succeeds -> FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      await actAs(c, claims("owner"));
      await expect(attempt(c,
        "insert into document_shares (account_id, document_id, version_id, token_hash, created_by, created_at, expires_at) values ($1,$2,$3,$4,'x',now(),now() + interval '24 hours')",
        [s.acct, s.docs.mine, s.vers.mine, hex(32)])).rejects.toMatchObject({ code: "42501" });
    }));
});

describe("0085: claim_document_share_download (spec 4.2, 4.3; plan deviations 1, 5)", () => {
  it("the first claim is the first open; the next is not, and both count (mutation: return first = true always -> FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      expect(await claim(c, s.acct, s.shares.mine)).toEqual({ status: "ok", first: true });
      const { rows: [a] } = await c.query<{ f: string; n: number }>("select first_opened_at::text as f, open_count as n from document_shares where id = $1", [s.shares.mine]);
      expect(await claim(c, s.acct, s.shares.mine)).toEqual({ status: "ok", first: false });
      const { rows: [b] } = await c.query<{ f: string; n: number }>("select first_opened_at::text as f, open_count as n from document_shares where id = $1", [s.shares.mine]);
      expect([a!.n, b!.n, b!.f === a!.f, a!.f === null]).toEqual([1, 2, true, false]);
    }));

  it("refuses a revoked, an expired, a trashed and a not-clean link as closed, writing nothing (mutations: drop any one of the four checks -> FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      const fresh = async (doc: string, ver: string, o = {}) => (await share(c, s.acct, doc, ver, o)).rows[0]!.id;
      const revoked = await fresh(s.docs.mine, s.vers.mine);
      await c.query("update document_shares set revoked_at = now(), revoked_by = 'u' where id = $1", [revoked]);
      const expired = await fresh(s.docs.mine, s.vers.mine, { createdAt: new Date(Date.now() - 25 * 3_600_000).toISOString() });
      await c.query("update documents set deleted_at = now(), deleted_by = 'u' where id = $1", [s.docs.theirs]);
      await c.query("update document_versions set scan_status = 'infected' where id = $1", [s.vers.mineOwners]);
      const answers = [await claim(c, s.acct, revoked), await claim(c, s.acct, expired), await claim(c, s.acct, s.shares.theirs), await claim(c, s.acct, s.shares.mineOwners)];
      expect(answers).toEqual([{ status: "closed" }, { status: "closed" }, { status: "closed" }, { status: "closed" }]);
      const { rows: [n] } = await c.query<{ n: string }>("select count(*)::text as n from document_share_downloads where account_id = $1", [s.acct]);
      expect(n!.n).toBe("0");
    }));

  it("another account's id never finds the share (mutation: lock the share by id alone -> FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      expect(await claim(c, s.acctB, s.shares.mine)).toEqual({ status: "not_found" });
    }));

  it("counts this link and this address in the window: at the limit it refuses and records nothing; another address still downloads (mutations: count by share alone; count by address alone; >= replaced by > -> FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      const other = await (await share(c, s.acct, s.docs.mine, s.vers.mine)).rows[0]!.id;
      expect((await claim(c, s.acct, s.shares.mine, IP, 2)).status).toBe("ok");
      expect((await claim(c, s.acct, other, IP, 2)).status).toBe("ok");
      expect((await claim(c, s.acct, s.shares.mine, IP, 2)).status).toBe("ok");
      expect(await claim(c, s.acct, s.shares.mine, IP, 2)).toEqual({ status: "rate_limited" });
      expect((await claim(c, s.acct, s.shares.mine, "b".repeat(32), 2)).status).toBe("ok");
      const { rows: [n] } = await c.query<{ n: number }>("select open_count as n from document_shares where id = $1", [s.shares.mine]);
      expect(n!.n).toBe(3);
    }));

  it("a link is downloaded at most p_link_max times in all, from any address; over it the claim records nothing (ruling O3; mutation: drop the open_count cap line -> FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      expect((await claim(c, s.acct, s.shares.mine, "1".repeat(32), 5, 600, 2)).status).toBe("ok");
      expect((await claim(c, s.acct, s.shares.mine, "2".repeat(32), 5, 600, 2)).status).toBe("ok");
      expect(await claim(c, s.acct, s.shares.mine, "3".repeat(32), 5, 600, 2)).toEqual({ status: "rate_limited" });
      const { rows: [n] } = await c.query<{ n: number; d: string }>(
        "select open_count as n, (select count(*) from document_share_downloads where share_id = $1)::text as d from document_shares where id = $1", [s.shares.mine]);
      expect(n).toEqual({ n: 2, d: "2" });
    }));

  it("a download older than the window no longer counts (mutation: ignore created_at -> FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      expect((await claim(c, s.acct, s.shares.mine, IP, 1)).status).toBe("ok");
      await c.query("update document_share_downloads set created_at = now() - interval '11 minutes' where share_id = $1", [s.shares.mine]);
      expect((await claim(c, s.acct, s.shares.mine, IP, 1, 600)).status).toBe("ok");
    }));

  it("an address hash is 32 lower-case hex (mutation: drop document_share_downloads_ip_hash_check -> FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      await expect(attempt(c, "select public.claim_document_share_download($1, $2, 'not-a-hash', 5, 600, 100)", [s.acct, s.shares.mine]))
        .rejects.toMatchObject({ code: "23514" });
    }));
});

describe("0085: the first open is decided under the share's lock (spec 6; review F1)", () => {
  // An OUTCOME test, not a lock-timeout test: without `for update`, session B would still block (on the
  // row update and the downloads FK's key-share lock) but would have read the share and the window count
  // BEFORE A committed, so it answers { ok, first: true } where the lock makes it see A's open.
  const conn = () => new Client({ connectionString: process.env.SUPABASE_DB_URL, connectionTimeoutMillis: 10_000 });
  /** Polls until `pid` is waiting on a lock; throws after ~5 s so a run that never blocks fails loudly. */
  async function waitUntilBlocked(watch: Client, pid: number): Promise<void> {
    for (let i = 0; i < 100; i++) {
      const { rows } = await watch.query<{ w: string | null }>("select wait_event_type as w from pg_stat_activity where pid = $1", [pid]);
      if (rows[0]?.w === "Lock") return;
      await new Promise((r) => setTimeout(r, 50));
    }
    throw new Error(`session ${pid} never waited on a lock`);
  }
  const SHARE_SQL = `insert into document_shares (account_id, document_id, version_id, token_hash, created_by, created_at, expires_at)
                     values ($1, $2, $3, $4, 'user_lock', now(), now() + interval '24 hours') returning id`;

  // [address limit, what the waiting claim must answer, the mutation that fails it]
  const cases: [number, Record<string, unknown>, string][] = [
    [1, { status: "rate_limited" }, "drop `for update` -> B counted 0 downloads -> { ok, first: true } -> FAILS"],
    [5, { status: "ok", first: false }, "drop `for update` -> B read first_opened_at unset -> first: true -> FAILS"],
  ];
  it.each(cases)("with an address limit of %i, a claim that waited for another answers %j (mutation: %s)", async (max, want) => {
    const seedC = conn(); const a = conn(); const b = conn();
    await Promise.all([seedC.connect(), a.connect(), b.connect()]);
    let acct: string | null = null;
    try {
      const { rows: [agency] } = await seedC.query<{ id: string }>("select id from agencies limit 1");
      acct = await one(seedC, "insert into accounts (agency_id, clerk_org_id, name) values ($1,$2,'DSH Lock') returning id", [agency!.id, `${TEST_ORG_ID_PREFIX}dshlock${max}_${RUN}`]);
      const contact = await one(seedC, "insert into contacts (account_id, first_name) values ($1,'Lock') returning id", [acct]);
      const doc = await one(seedC, "insert into documents (account_id, contact_id, title, category, source, created_by) values ($1,$2,'Lock','other','upload','user_lock') returning id", [acct, contact]);
      const ver = await cleanVersion(seedC, acct, doc);
      const id = await one(seedC, SHARE_SQL, [acct, doc, ver, hex(32)]);
      const { rows: [pb] } = await b.query<{ pid: number }>("select pg_backend_pid() as pid");

      await a.query("begin");
      expect(await claim(a, acct, id, IP, max)).toEqual({ status: "ok", first: true });
      const waiting = claim(b, acct, id, IP, max); // no lock_timeout: B waits as long as A holds the row
      await waitUntilBlocked(seedC, pb!.pid);
      await a.query("commit");
      expect(await waiting).toEqual(want);
    } finally {
      await a.query("rollback").catch(() => {});
      if (acct) {
        await seedC.query("delete from documents where account_id = $1", [acct]); // shares and downloads cascade
        await seedC.query("delete from contacts where account_id = $1", [acct]);
        await seedC.query("delete from accounts where id = $1", [acct]);
      }
      await Promise.all([seedC.end(), a.end(), b.end()]);
    }
  });
});
```

(The lock test seeds on a committed connection, so it inserts its share with `SHARE_SQL` directly, never through `share()`'s `attempt`, whose savepoint needs a transaction.)

- [ ] **Step 4: Run it on `post` to see it fail** (no 0085 yet). In `packages/db`, with `SUPABASE_DB_URL=postgresql://postgres@localhost:55640/post`: `node node_modules/vitest/vitest.mjs run src/test/document-shares-schema.test.ts > "$S/s07g-t1-impl/red.txt" 2>&1; echo $? > "$S/s07g-t1-impl/red.exit"`. Expected: every case FAILS (`relation "document_shares" does not exist`, or the teardown case's `expected -1 to be greater than -1`). Paste one failing assertion line.

- [ ] **Step 5: Write the migration** `packages/db/supabase/migrations/0085_document_shares.sql`:

```sql
-- 0085_document_shares.sql - the document vault, part 3b: share links
-- (docs/superpowers/specs/2026-10-17-document-vault-part3-design.md section 4;
--  docs/superpowers/plans/2026-10-18-document-vault-pr3b.md)
--
-- Staff make a link to ONE version of ONE file: /s/<token>, no sign-in, 24 hours, revocable. The
-- token is 32 random bytes the app mints; only sha256(token) is stored (token_hash). A share names
-- the version that was current when it was made, so a newer version never changes what an old link
-- serves. Every link to a document or a version is a same-account composite key; a share and its
-- downloads go with their document (on delete cascade), as the purge and the teardown need.
-- Written by server code only (0053's pattern): the client role reads a share exactly when it can
-- read its document (the restrictive policy's subquery runs under documents' own policies: the
-- tenant, the Technician fence, Owners only) and writes nothing. One service-only function claims
-- a download: it locks the share, re-proves it open (not revoked, not expired, the document not in
-- the trash, the version ready and clean), refuses past the link's total cap (p_link_max), counts this
-- address's downloads of this link inside the window (the forms limiter's numbers, passed by the app),
-- records the download, and sets
-- first_opened_at only the first time: under the lock, exactly one claim sees it unset.
-- document_share_downloads keeps an HMAC of the address (lib/forms/guards.ts hashIp), never the
-- address. A security_invoker view feeds the record's timeline (a share made, its first open).
--
-- APPLY ORDER: CI project (ci-project-setup.yml: push-dry-run, then push), then production (MCP
-- apply_migration, once), then the parity check, then merge. Additive: the build before it reads
-- none of it, and every existing version row satisfies the new key (id is its primary key). The
-- build after it needs it: the migration goes BEFORE the code deploy.
--
-- Rollback (by hand, in this order; revert the app first):
--   drop view public.document_share_timeline;
--   drop function public.claim_document_share_download(uuid, uuid, text, integer, integer, integer);
--   drop table public.document_share_downloads;
--   drop table public.document_shares;
--   alter table public.document_versions drop constraint document_versions_account_document_id_key;
--
-- ASCII only, no backslash anywhere.

-- 0. Fail fast instead of queueing behind a long lock on document_versions.
set local lock_timeout = '5s';

-- 1. The key a same-account version link needs (plan deviation 11). id is the primary key, so no
--    existing row can refuse it.
alter table public.document_versions
  add constraint document_versions_account_document_id_key unique (account_id, document_id, id);

-- 2. The share.
create table public.document_shares (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  document_id uuid not null,
  version_id uuid not null,
  token_hash text not null constraint document_shares_token_hash_key unique
    constraint document_shares_token_hash_check check (char_length(token_hash) = 64 and token_hash !~ '[^0-9a-f]'),
  created_by text not null constraint document_shares_created_by_check check (btrim(created_by) <> ''),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  revoked_by text,
  first_opened_at timestamptz,
  open_count integer not null default 0 constraint document_shares_open_count_check check (open_count >= 0),
  constraint document_shares_expiry check (expires_at = created_at + interval '24 hours'),
  constraint document_shares_revoke_coherent check ((revoked_at is null) = (revoked_by is null)),
  constraint document_shares_opened_coherent check ((first_opened_at is null) = (open_count = 0)),
  constraint document_shares_document_fkey foreign key (account_id, document_id)
    references public.documents (account_id, id) on delete cascade,
  constraint document_shares_version_fkey foreign key (account_id, document_id, version_id)
    references public.document_versions (account_id, document_id, id) on delete cascade,
  constraint document_shares_account_id_id_key unique (account_id, id)
);
create index document_shares_by_document on public.document_shares (account_id, document_id);
comment on table public.document_shares is
  'A link to one version of one document (0085). Reached by /s/<token>; only sha256(token) is stored. Server-written only; authenticated reads a share exactly when it reads its document. Expired once expires_at has passed (computed, never written).';

-- 3. Each download, for the per-link, per-address limit (plan deviation 1). Service only.
create table public.document_share_downloads (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  share_id uuid not null,
  ip_hash text not null
    constraint document_share_downloads_ip_hash_check check (char_length(ip_hash) = 32 and ip_hash !~ '[^0-9a-f]'),
  created_at timestamptz not null default now(),
  constraint document_share_downloads_share_fkey foreign key (account_id, share_id)
    references public.document_shares (account_id, id) on delete cascade
);
create index document_share_downloads_recent on public.document_share_downloads (share_id, ip_hash, created_at);
comment on table public.document_share_downloads is
  'One row per download through a share link (0085): an HMAC of the address, never the address. Service role only.';

-- 4. Grants and who reads. SELECT on shares for the client role, nothing else; downloads are the
--    service role's alone (RLS on, no policy). A new table gets Supabase's default ALL.
alter table public.document_shares enable row level security;
alter table public.document_share_downloads enable row level security;
revoke all on public.document_shares, public.document_share_downloads from anon, authenticated;
grant select on public.document_shares to authenticated;
grant select, insert, update, delete on public.document_shares, public.document_share_downloads to service_role;
create policy document_shares_member_read on public.document_shares for select to authenticated
  using (app.is_agency() or account_id = app.current_account_id());
-- A share is visible exactly when its document is: the subquery runs under documents' own policies.
create policy document_shares_through_document on public.document_shares as restrictive for select to authenticated
  using (document_id in (select d.id from public.documents d));

-- 5. The one claim of a download (spec 4.2, 4.3). Locks the share row, so concurrent claims queue
--    and exactly one sees first_opened_at unset.
create function public.claim_document_share_download(
  p_account_id uuid, p_share_id uuid, p_ip_hash text, p_max integer, p_window_seconds integer, p_link_max integer)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_share public.document_shares%rowtype; v_recent integer;
begin
  if p_account_id is null or p_share_id is null or p_ip_hash is null or p_max is null or p_window_seconds is null or p_link_max is null then
    raise exception 'claim_document_share_download: a required argument is null' using errcode = '22004';
  end if;
  select * into v_share from public.document_shares
   where account_id = p_account_id and id = p_share_id
     for update;
  if not found then return jsonb_build_object('status', 'not_found'); end if;
  if v_share.revoked_at is not null or v_share.expires_at <= now() then
    return jsonb_build_object('status', 'closed');
  end if;
  perform 1 from public.documents d
    join public.document_versions v on v.account_id = d.account_id and v.document_id = d.id
   where d.account_id = p_account_id and d.id = v_share.document_id and v.id = v_share.version_id
     and d.deleted_at is null and v.status = 'ready' and v.scan_status = 'clean';
  if not found then return jsonb_build_object('status', 'closed'); end if;
  -- Ruling O3: a link is downloaded at most p_link_max times in all, from any address.
  if v_share.open_count >= p_link_max then return jsonb_build_object('status', 'rate_limited'); end if;
  select count(*) into v_recent from public.document_share_downloads
   where share_id = p_share_id and ip_hash = p_ip_hash
     and created_at > now() - make_interval(secs => p_window_seconds);
  if v_recent >= p_max then return jsonb_build_object('status', 'rate_limited'); end if;
  insert into public.document_share_downloads (account_id, share_id, ip_hash) values (p_account_id, p_share_id, p_ip_hash);
  update public.document_shares
     set open_count = open_count + 1, first_opened_at = coalesce(first_opened_at, now())
   where account_id = p_account_id and id = p_share_id;
  return jsonb_build_object('status', 'ok', 'first', v_share.first_opened_at is null);
end $$;
revoke all on function public.claim_document_share_download(uuid, uuid, text, integer, integer, integer) from public, anon, authenticated, service_role;
grant execute on function public.claim_document_share_download(uuid, uuid, text, integer, integer, integer) to service_role;

-- 6. The record's timeline (plan deviation 4): a share made (created_at) and its first open
--    (first_opened_at), one row each, read from this view. security_invoker: the view runs with the
--    CALLER's privileges, so document_shares' and documents' policies decide every row, as for the
--    card. SELECT only; schema-grants-guard.test.ts lists it, a reviewed decision.
create view public.document_share_timeline with (security_invoker = true) as
  select s.id, s.account_id, s.document_id, s.created_by, s.created_at, s.expires_at, s.revoked_at, s.first_opened_at,
         d.title, d.category, d.contact_id, d.client_group_id, d.deleted_at
    from public.document_shares s
    join public.documents d on d.account_id = s.account_id and d.id = s.document_id;
revoke all on public.document_share_timeline from public, anon, authenticated, service_role;
grant select on public.document_share_timeline to authenticated, service_role;
comment on view public.document_share_timeline is
  'One row per share link (0085), with its document''s title and record. security_invoker, so the RLS of document_shares and documents decides what each caller sees.';
```

- [ ] **Step 5b: Teardown and the guard.** `packages/db/src/account-teardown.ts:26`: the line becomes `"document_share_downloads", "document_shares", "documents", "opportunities", "pipeline_stages", "pipelines", "custom_fields",`, with a comment line above the array's `"documents"` row: `// S-07 3b (0085): a share's downloads, then its share, before documents (both cascade too; spec 4.4 lists them).` `schema-grants-guard.test.ts:112-115`: the comment gains `0085 (S-07 3b) adds document_share_timeline, the same shape, reviewed in docs/superpowers/plans/2026-10-18-document-vault-pr3b.md deviation 4.` and the assertion becomes `expect((await writeSurface(c)).rlsOff).toEqual(["document_scan_timeline", "document_share_timeline", "document_version_timeline"]);`.

- [ ] **Step 6: The bytes.** Write the checker with a quoted heredoc (no shell expansion):

```bash
cat > "$S/s07g-t1-impl/bytes.mjs" <<'EOF'
import { readFileSync } from "node:fs";
const b = readFileSync(process.argv[2]);
let nonAscii = 0, backslash = 0;
for (const x of b) { if (x > 127) nonAscii++; if (x === 92) backslash++; }
const loneDollar = (b.toString("latin1").split("$$").join("").match(/[$]/g) ?? []).length;
console.log(JSON.stringify({ nonAscii, backslash, loneDollar }));
EOF
node "$S/s07g-t1-impl/bytes.mjs" packages/db/supabase/migrations/0085_document_shares.sql
node -e "const f=require('fs');f.writeFileSync(process.argv[2],Buffer.concat([f.readFileSync(process.argv[1]),Buffer.from([0xc3,0xa9,0x5c,0x24])]))" packages/db/supabase/migrations/0085_document_shares.sql "$S/s07g-t1-impl/control.sql"
node "$S/s07g-t1-impl/bytes.mjs" "$S/s07g-t1-impl/control.sql"
md5sum packages/db/supabase/migrations/0085_document_shares.sql
```

Expected: `{"nonAscii":0,"backslash":0,"loneDollar":0}`, then the control `{"nonAscii":2,"backslash":1,"loneDollar":1}` (the checker can fail). Paste all three lines and the md5 (Task 14 compares it).

- [ ] **Step 7: Apply and run green.** `bash "$S/s07g-kit/replica.sh" 55640 "$S/s07g-t1-impl"` again → `post = pre + 0085`. Run `document-shares-schema.test.ts`, `schema-grants-guard.test.ts`, `document-vault-schema.test.ts`, `document-vault-rls.test.ts`, `document-space-used.test.ts`, `document-vault-reserve-lock.test.ts` on `post` (exit code to a file, nothing after it). Paste each summary line. Expected: all PASS.

- [ ] **Step 8: Probes, by name** (each a temporary edit of the migration, re-applied with `replica.sh`, reverted by hand and `cmp`-checked): (a) drop `for update` → BOTH cases of "with an address limit of …, a claim that waited for another answers …" FAIL (B answers `{ ok, first: true }`); the run also proves B really waited (`waitUntilBlocked` returned) in both builds; (b) drop the `perform 1 from public.documents d …` block → "refuses a revoked, an expired, a trashed and a not-clean link" FAILS; (c) `document_shares_through_document` dropped → the staff/tech cases FAIL; (d) (it rests on the RI triggers firing in creation order, so the document FK's error is reported first; the probe run settles it, and if the unmutated build reports `document_shares_version_fkey` for this insert the reviewer reports that instead of weakening the case) the document FK as `foreign key (document_id) references public.documents (id)` (no account; `id` is the primary key) → the cross-account insert is then caught by the version FK instead, so the case FAILS on its constraint name (`document_shares_version_fkey` where it expects `document_shares_document_fkey`); (d2) the version FK as `foreign key (version_id) references public.document_versions (id)` → the cross-document insert succeeds and the case FAILS; (e) the address count by share alone (drop `and ip_hash = p_ip_hash`) → "counts this link and this address in the window" FAILS on "another address still downloads"; (e2) drop the `open_count >= p_link_max` line → "a link is downloaded at most p_link_max times" FAILS; (f) `grant insert on public.document_shares to authenticated` → both write-surface cases FAIL; (g) the view without `security_invoker` → the view case FAILS. Paste each failing line.
- [ ] **Step 9: Stop your kit.** **Commit** `git add -- packages/db/supabase/migrations/0085_document_shares.sql packages/db/src/test/document-shares-schema.test.ts` then `git commit -m "db: 0085 share links: a revocable 24-hour link to one clean version, read exactly as its document, claimed once per download under a lock (S-07 3b)" -- packages/db/supabase/migrations/0085_document_shares.sql packages/db/src/test/document-shares-schema.test.ts packages/db/src/test/schema-grants-guard.test.ts packages/db/src/account-teardown.ts` (with the trailers).

---

## Task 2: Every key (bis-crm; messages.ts, the only writer)

**Review:** sonnet. **Runs beside:** Tasks 1 and 7.

**Files**
- Modify: `apps/web/src/lib/messages.ts` (keys appended after `"record.facts.channel.chat.es"`, `:4911`, the catalogue's last key), `apps/web/src/lib/messages.test.ts` (one `describe` appended at the end)

**Interfaces**
- Produces: every key below, each English line followed by its `.es` twin. Later tasks reference these names exactly.

| Key | English | Spanish |
|---|---|---|
| `documents.share` | Copy share link | Copiar enlace para compartir |
| `documents.share.copied` | Link copied. It works for 24 hours. | Enlace copiado. Funciona por 24 horas. |
| `documents.share.live` | Shared · expires in {hours} h | Compartido · vence en {hours} h |
| `documents.share.stop` | Stop sharing | Dejar de compartir |
| `documents.share.stopped` | Stopped sharing {title}. | Ya no se comparte {title}. |
| `documents.share.failed` | Couldn't make a link. Try again. | No se pudo crear el enlace. Intente de nuevo. |
| `documents.share.ownersOnlyRole` | Only an Owner can share a file marked Owners only. | Solo un dueño puede compartir un archivo marcado Solo dueños. |
| `documents.share.notShared` | This file has no link to stop. | Este archivo no tiene un enlace que detener. |
| `documents.share.ended` | That link has already ended, so nothing was undone. | Ese enlace ya terminó, así que no se deshizo nada. |
| `documents.share.refused` | You can't share that file. | No puede compartir ese archivo. |
| `timeline.documentShared` | shared {title} | compartió {title} |
| `timeline.documentShareOpened` | opened {title} | abrió {title} |
| `provenance.linkRecipient` | The link's recipient | Quien recibió el enlace |
| `sharePage.pageTitle` | A file from {business} | Un archivo de {business} |
| `sharePage.pageTitleNoName` | A shared file | Un archivo compartido |
| `sharePage.heading` | {business} shared a file with you | {business} compartió un archivo con usted |
| `sharePage.headingNoName` | A file was shared with you | Se compartió un archivo con usted |
| `sharePage.details` | {type} file · {size} | Archivo {type} · {size} |
| `sharePage.download` | Download | Descargar |
| `sharePage.limit` | Too many downloads from here. Try again in a few minutes. | Demasiadas descargas desde aquí. Intente de nuevo en unos minutos. |
| `sharePage.failed` | The download didn't start. Try again. | La descarga no empezó. Intente de nuevo. |
| `sharePage.revoked` | This link was turned off. | Este enlace se desactivó. |
| `sharePage.trashed` | This file isn't available any more. | Este archivo ya no está disponible. |
| `sharePage.removed` | This file was removed for safety. | Este archivo se quitó por seguridad. |
| `sharePage.ask` | Ask {business} to send it again. | Pida a {business} que se lo envíe de nuevo. |
| `sharePage.askNoName` | Ask the business that sent it to send it again. | Pida al negocio que se lo envió que lo mande de nuevo. |

Reused, not added (read 2026-10-18; review F10: the public page's expired and not-found sentences are 2b's own, `customerDocs.expired` "This link has expired." / "Este enlace venció." and `customerDocs.notFound` "This link doesn't work." / "Este enlace no funciona.", `messages.ts:4326-4331`, so the two customer pages say the same thing; a refused SHARE says `documents.share.refused`, never `documents.error.refused`'s "You can't change that file."): `documents.error.scanning` (`:4036`), `documents.error.removed` (`:4038`), `documents.error.trashed` (`:3979`), `documents.error.refused` (`:3936`), `documents.request.copyFailed` (`:4088`), `common.undo` (`:298`), `customerDocs.call`, `customerDocs.callNoPhone`, `customerDocs.callNoName`, `customerDocs.callNoPhoneNoName` (`:4334-4343`), `customerDocs.poweredBy` (`:4346`), `customerDocs.error.title`, `customerDocs.error.body`, `customerDocs.error.retry` (`:4348-4353`).

- [ ] **Step 1: Read** `messages.ts:2660-2672` (the provenance block), `:3880-3940` and `:4030-4040` (the `documents.*` block), `:4330-4370` (`customerDocs.*`, `timeline.*`), the end of the file (`:4905-4914`), and `messages.test.ts`' last two `describe`s (the shape to copy, incl. its imports of `m` and `t`).

- [ ] **Step 2: Write the failing test** (append to `messages.test.ts`):

```ts
describe("S-07 3b: share links (plan Task 2)", () => {
  const KEYS_3B = [
    "documents.share", "documents.share.copied", "documents.share.live", "documents.share.stop", "documents.share.stopped",
    "documents.share.failed", "documents.share.ownersOnlyRole", "documents.share.notShared", "documents.share.ended", "documents.share.refused",
    "timeline.documentShared", "timeline.documentShareOpened", "provenance.linkRecipient",
    "sharePage.pageTitle", "sharePage.pageTitleNoName", "sharePage.heading", "sharePage.headingNoName", "sharePage.details",
    "sharePage.download", "sharePage.limit", "sharePage.failed", "sharePage.revoked", "sharePage.trashed",
    "sharePage.removed", "sharePage.ask", "sharePage.askNoName",
  ] as const;

  it("every key has a Spanish twin (mutation: delete any one .es line -> FAILS naming it)", () => {
    expect(KEYS_3B.filter((k) => !(k in m) || !(`${k}.es` in m))).toEqual([]);
  });

  it("the spec's sentences, in both languages (spec 4.1, 4.3; mutation: change either side of any pair -> FAILS)", () => {
    expect([m["documents.share.copied"], m["documents.share.copied.es"]]).toEqual(["Link copied. It works for 24 hours.", "Enlace copiado. Funciona por 24 horas."]);
    expect([t(m, "documents.share.live", "en", { hours: 18 }), t(m, "documents.share.live", "es", { hours: 18 })])
      .toEqual(["Shared · expires in 18 h", "Compartido · vence en 18 h"]);
    expect([m["provenance.linkRecipient"], m["provenance.linkRecipient.es"]]).toEqual(["The link's recipient", "Quien recibió el enlace"]);
    expect([t(m, "timeline.documentShareOpened", "en", { title: "Seguro 2026.pdf" }), t(m, "timeline.documentShareOpened", "es", { title: "Seguro 2026.pdf" })])
      .toEqual(["opened Seguro 2026.pdf", "abrió Seguro 2026.pdf"]);
    expect([t(m, "sharePage.heading", "en", { business: "Casa Verde" }), t(m, "sharePage.heading", "es", { business: "Casa Verde" })])
      .toEqual(["Casa Verde shared a file with you", "Casa Verde compartió un archivo con usted"]);
  });

  it("no copy says token, hash, link id or storage (mutation: 'token' in any value -> FAILS)", () => {
    const all = KEYS_3B.flatMap((k) => [m[k], m[`${k}.es` as keyof typeof m] as string]);
    for (const s of all) expect(s).not.toMatch(/\b(token|hash|storage|signed|supabase)\b/i);
  });

  it("Spanish is usted, never tu (mutation: 'Intenta' or 'tu' in any .es -> FAILS)", () => {
    const es = KEYS_3B.map((k) => m[`${k}.es` as keyof typeof m] as string);
    for (const s of es) expect(s).not.toMatch(/\b(intenta|pide|abre|usa|tu|tus|contigo)\b/i);
  });
});
```

- [ ] **Step 3: Run it** (`pnpm --filter web exec vitest run src/lib/messages.test.ts`) → the new cases FAIL (`expected [ …27 keys ] to deeply equal []`). Paste the line.
- [ ] **Step 4: Add the keys** after `:4911` (`"record.facts.channel.chat.es"`), each English line then its `.es` line, in the table's order, under a comment `// S-07 3b: share links (plan 2026-10-18-document-vault-pr3b.md).`
- [ ] **Step 5: Run** `src/lib/messages.test.ts`, `src/lib/i18n/ratchet.test.ts`; `pnpm --filter web typecheck`. PASS (the ratchet may report new counts: that is Task 10's; if it FAILS on a new key, paste it and stop).
- [ ] **Step 6: Probe:** delete `"sharePage.ask.es"` → the twin case FAILS naming it; change `"abrió {title}"` to `"abre {title}"` → the spec-sentences case FAILS. Revert by hand.
- [ ] **Step 7: Commit** both files, message "i18n: the share-link words, English and Spanish (S-07 3b)".

---

## Task 3: `@bis/db`: the share module and the barrel (bis-crm)

**Review:** opus. **Scratch:** replica set A (`55642`/`55643`/`55644`), dir `<SCRATCH>/s07g-t3-impl/`; reviewer set B.

**Files**
- Create: `packages/db/src/document-shares.ts`, `packages/db/src/test/document-shares.test.ts`
- Modify: `packages/db/src/index.ts` (after the S-07 3a block, `:337-341`)

**Interfaces**
- Consumes: 0085 (Task 1); `forContacts`, `withTimelinePage`, `TimelinePageOpts` (`packages/db/src/timeline-cursor.ts:68-79`); `DocumentRecordRef`, `ScanStatus` (`documents.ts:15`, `:21`); `DocumentCategory`, `DocumentContentType` (`document-rules.ts`).
- Produces (every name exported from the barrel):

```ts
export const DOCUMENT_SHARE_HOURS = 24;
export type DocumentShareRow = { id: string; account_id: string; document_id: string; version_id: string; created_by: string; created_at: string; expires_at: string; revoked_at: string | null; revoked_by: string | null; first_opened_at: string | null; open_count: number };
export function createDocumentShare(db: SupabaseClient, a: { accountId: string; documentId: string; versionId: string; tokenHash: string; createdBy: string; now: Date }): Promise<DocumentShareRow>;
export function findDocumentShareByTokenHash(db: SupabaseClient, tokenHash: string): Promise<DocumentShareRow | null>;
export type DocumentShareLife = "open" | "expired" | "revoked";
export function documentShareState(s: Pick<DocumentShareRow, "revoked_at" | "expires_at">, now: Date): DocumentShareLife;
export type ShareTarget = { document: { id: string; title: string; deleted_at: string | null }; version: { id: string; content_type: DocumentContentType; bytes: number; status: "uploading" | "ready"; scan_status: ScanStatus } };
export function getShareTarget(db: SupabaseClient, s: Pick<DocumentShareRow, "account_id" | "document_id" | "version_id">): Promise<ShareTarget | null>;
export function listLiveDocumentShares(db: SupabaseClient, accountId: string, record: DocumentRecordRef, now: Date): Promise<Record<string, string>>;
export function revokeDocumentShares(db: SupabaseClient, accountId: string, documentId: string, actorId: string, now: Date): Promise<{ ids: string[]; revokedAt: string } | null>;
export function restoreDocumentShares(db: SupabaseClient, a: { accountId: string; documentId: string; ids: readonly string[]; revokedAt: string; actorId: string; now: Date }): Promise<number>;
export type ShareClaim = { status: "ok"; first: boolean } | { status: "not_found" | "closed" | "rate_limited" };
export function claimDocumentShareDownload(db: SupabaseClient, a: { accountId: string; shareId: string; ipHash: string; max: number; windowSeconds: number; linkMax: number }): Promise<ShareClaim>;
export type ReadyVersionScan = { id: string; scan_status: ScanStatus; created_at: string };
export function listReadyVersionScans(db: SupabaseClient, accountId: string, documentId: string): Promise<ReadyVersionScan[]>;
export type Shareable = { kind: "clean"; versionId: string } | { kind: "pending" | "removed" };
export function shareableVersion(versions: readonly ReadyVersionScan[], currentVersionId: string | null): Shareable;
export type TimelineDocumentShare = { id: string; document_id: string; title: string; category: DocumentCategory; created_by: string; created_at: string; first_opened_at: string | null; contact_id: string | null; client_group_id: string | null; deleted_at: string | null };
export function listDocumentShareTimeline(db: SupabaseClient, accountId: string, who: string | readonly string[], groupId: string | null, page: TimelinePageOpts): Promise<{ shares: TimelineDocumentShare[]; opens: TimelineDocumentShare[] }>;
```

- [ ] **Step 1: Read** `packages/db/src/document-requests.ts:1-60`, `:140-180` (find by hash, revoke, restore, the timeline read: this module's shape), `packages/db/src/document-requirements.ts:120-140` (two timeline reads from one row), `packages/db/src/documents.ts:1-60`, `:90-102`, `packages/db/src/timeline-cursor.ts:60-80`, `packages/db/src/test/document-requests.test.ts:1-60` (seeding through `createDocument`, `reserveDocumentVersion`, `markDocumentVersionReady`, `recordDocumentScan` behind `withTestAccount`), `packages/db/src/test/fixtures.ts:140-149`, `packages/db/src/contacts.ts:414-425` (`createContact` answers `{ id, existing, flagged }`).

- [ ] **Step 2: Failing tests** `packages/db/src/test/document-shares.test.ts` (behind PostgREST; every case `withTestAccount`). A local `cleanDoc(db, accountId)` helper: `createContact(db, accountId, { firstName: "Ana" }, "user_test")` → `createDocument(db, { accountId, record: { kind: "contact", id }, title: "Seguro", category: "insurance", expiresOn: null, ownersOnly: false, source: "upload", createdBy: "user_test" })` → `reserveDocumentVersion(… bytes: 10 …)` → `markDocumentVersionReady(… sha256: "a".repeat(64), actorId: "user_test" …)` → `recordDocumentScan(… verdict: "clean")`; answers `{ contactId, documentId, versionId }`. Cases, each with its mutation in the title:
  1. `createDocumentShare` stores the hash and answers the row; `expires_at` is exactly 24 h after `created_at` (`Date.parse` difference `86_400_000`); `findDocumentShareByTokenHash` with that hash answers the same `id`; with another hash, `null` (mutation: store `tokenHash.toUpperCase()` → the insert FAILS the shape check → FAILS).
  2. `documentShareState` (pure; no db): revoked wins over expired; `expires_at <= now` is expired; else open (mutation: `<` for `<=` → the boundary case `now = expires_at` FAILS).
  3. `getShareTarget` answers the SHARED version even after a newer clean version became current (reserve, mark ready and clean a second version, then read: `target.version.id === first versionId`) (spec 6; mutation: read `documents.current_version_id` instead → FAILS); a pick whose `account_id` is another account's (`withTestAccount` nested, as `document-requests.test.ts:108` does) answers `null` (mutation: drop `.eq("account_id", …)` from either read → FAILS); a pick naming another document of the SAME account with this version id answers `null` (mutation: drop `.eq("document_id", …)` from the version read → FAILS).
  4. `listLiveDocumentShares` for the contact: two live shares of one file answer its LATER `expires_at`; a revoked one and an expired one (insert with `now` 25 h ago) are absent; another contact's file is absent (mutation: drop `.is("revoked_at", null)` → FAILS).
  5. `revokeDocumentShares` revokes every live share of THAT document and answers their ids and the stored `revoked_at`; a second call answers `null`; another document's live share is untouched (mutation: drop `.eq("document_id", …)` → FAILS).
  6. `restoreDocumentShares` with those ids and that `revokedAt` and the same actor puts them back (answers 2, both read live again); with another actor answers 0; with a `revokedAt` one millisecond off answers 0; for an expired share answers 0 (Assumption A6; mutations: drop the actor filter; drop the `expires_at` filter → FAILS).
  7. `claimDocumentShareDownload` answers `{ status: "ok", first: true }`, then `first: false`; for a revoked share `{ status: "closed" }`; throws on an RPC error (call it with `ipHash: "nope"`: the check refuses, `rejects.toThrow("claimDocumentShareDownload failed")`).
  9. `shareableVersion` (pure, no db; ruling R-V): `[clean v2, clean v1]` → `v2`; current `infected` v3 + older clean v1 (`[infected v3, clean v1]`, current v3) → `v1`; current `pending` v3 + older clean v1 → `v1`; `[pending v1]` → `pending`; `[infected v1]` and `[unscannable v1]` → `removed`; `[]` → `pending` (mutations: always the current version → the infected and pending cases FAIL; the OLDEST clean → the first case FAILS).
  10. `listReadyVersionScans` answers only READY versions of THAT document, newest first: with an uploading reservation and a second document's version present, it answers exactly the two ready ids in order (mutations: drop `.eq("status", "ready")`; drop `.eq("document_id", …)` → FAILS).
  7b. `claimDocumentShareDownload` passes `linkMax`: with `linkMax: 1` the second claim from another address answers `{ status: "rate_limited" }` (mutation: omit `p_link_max` from the RPC call → the RPC errors and the call throws → FAILS).
  8. `listDocumentShareTimeline(db, accountId, contactId, null, { limit: 31 })`: one share made and opened once reads ONE `shares` row and ONE `opens` row, both the share's id, `opens[0].first_opened_at` set; a share never opened adds a `shares` row only (mutation: drop `.not("first_opened_at", "is", null)` → FAILS).

- [ ] **Step 3: Run them to see them fail** on set A: `bash "$S/s07g-kit/replica.sh" 55642 "$S/s07g-t3-impl" && bash "$S/s07g-kit/pgrst.sh" 55642 55643 55644 "$S/s07g-t3-impl"`, then in `packages/db`: `source "$S/s07g-t3-impl/env-run.sh"; node node_modules/vitest/vitest.mjs run src/test/document-shares.test.ts > "$S/s07g-t3-impl/red.txt" 2>&1; echo $? > "$S/s07g-t3-impl/red.exit"`. Expected: FAIL (`Cannot find module '../document-shares'`).

- [ ] **Step 4: Implement** `packages/db/src/document-shares.ts`:

```ts
import type { SupabaseClient } from "@supabase/supabase-js";
import { forContacts, withTimelinePage, type TimelinePageOpts } from "./timeline-cursor";
import type { DocumentCategory, DocumentContentType } from "./document-rules";
import type { DocumentRecordRef, ScanStatus } from "./documents";

/**
 * Share links (0085; spec 4). READS take the caller's client: on a request client RLS decides (a share
 * is visible exactly when its document is); the public tree passes the service client AFTER proving
 * the token, and every read below then carries the token row's own account, document and version.
 * WRITES take the service client a server action holds after its request-client proof (0053). Only
 * sha256(token) is ever stored or read here. THROWS on a read or write error.
 */
export const DOCUMENT_SHARE_HOURS = 24;
const HOUR_MS = 3_600_000;

export type DocumentShareRow = {
  id: string; account_id: string; document_id: string; version_id: string; created_by: string; created_at: string;
  expires_at: string; revoked_at: string | null; revoked_by: string | null; first_opened_at: string | null; open_count: number;
};
const SHARE_COLS = "id, account_id, document_id, version_id, created_by, created_at, expires_at, revoked_at, revoked_by, first_opened_at, open_count";

/** Service client. created_at and expires_at from ONE instant, so 0085's document_shares_expiry holds exactly. */
export async function createDocumentShare(db: SupabaseClient, a: {
  accountId: string; documentId: string; versionId: string; tokenHash: string; createdBy: string; now: Date;
}): Promise<DocumentShareRow> {
  const { data, error } = await db.from("document_shares").insert({
    account_id: a.accountId, document_id: a.documentId, version_id: a.versionId, token_hash: a.tokenHash, created_by: a.createdBy,
    created_at: a.now.toISOString(), expires_at: new Date(a.now.getTime() + DOCUMENT_SHARE_HOURS * HOUR_MS).toISOString(),
  }).select(SHARE_COLS).single();
  if (error) throw new Error(`createDocumentShare failed: ${error.message}`);
  return data as DocumentShareRow;
}

/** The public tree's first read: by the token's hash alone (the hash is the proof). */
export async function findDocumentShareByTokenHash(db: SupabaseClient, tokenHash: string): Promise<DocumentShareRow | null> {
  const { data, error } = await db.from("document_shares").select(SHARE_COLS).eq("token_hash", tokenHash).maybeSingle();
  if (error) throw new Error(`findDocumentShareByTokenHash failed: ${error.message}`);
  return (data as DocumentShareRow | null) ?? null;
}

export type DocumentShareLife = "open" | "expired" | "revoked";
/** Revoked first (someone stopped it), then expired; computed, never written. */
export function documentShareState(s: Pick<DocumentShareRow, "revoked_at" | "expires_at">, now: Date): DocumentShareLife {
  if (s.revoked_at !== null) return "revoked";
  return Date.parse(s.expires_at) <= now.getTime() ? "expired" : "open";
}

export type ShareTarget = {
  document: { id: string; title: string; deleted_at: string | null };
  version: { id: string; content_type: DocumentContentType; bytes: number; status: "uploading" | "ready"; scan_status: ScanStatus };
};
/**
 * The shared file and the SHARED version (never the current one: spec 6), each read with the token
 * row's account, document and version ids. null when either is gone.
 */
export async function getShareTarget(
  db: SupabaseClient, s: Pick<DocumentShareRow, "account_id" | "document_id" | "version_id">,
): Promise<ShareTarget | null> {
  const [doc, ver] = await Promise.all([
    db.from("documents").select("id, title, deleted_at").eq("account_id", s.account_id).eq("id", s.document_id).maybeSingle(),
    db.from("document_versions").select("id, content_type, bytes, status, scan_status")
      .eq("account_id", s.account_id).eq("document_id", s.document_id).eq("id", s.version_id).maybeSingle(),
  ]);
  if (doc.error) throw new Error(`getShareTarget (document) failed: ${doc.error.message}`);
  if (ver.error) throw new Error(`getShareTarget (version) failed: ${ver.error.message}`);
  if (!doc.data || !ver.data) return null;
  const v = ver.data as ShareTarget["version"];
  return { document: doc.data as ShareTarget["document"], version: { ...v, bytes: Number(v.bytes) } };
}

/** Plan deviation 3: the card's "Shared" line, the latest live expiry per document of one record, from the view (RLS decides). */
const MAX_LIVE_SHARES_READ = 1000;
export async function listLiveDocumentShares(
  db: SupabaseClient, accountId: string, record: DocumentRecordRef, now: Date,
): Promise<Record<string, string>> {
  const { data, error } = await db.from("document_share_timeline").select("document_id, expires_at")
    .eq("account_id", accountId).eq(record.kind === "contact" ? "contact_id" : "client_group_id", record.id)
    .is("revoked_at", null).gt("expires_at", now.toISOString()).is("deleted_at", null)
    .order("expires_at", { ascending: false }).limit(MAX_LIVE_SHARES_READ);
  if (error) throw new Error(`listLiveDocumentShares failed: ${error.message}`);
  const out: Record<string, string> = {};
  for (const r of (data ?? []) as { document_id: string; expires_at: string }[]) {
    if (!Object.hasOwn(out, r.document_id)) out[r.document_id] = r.expires_at;
  }
  return out;
}

/** Service client. Stop sharing: every LIVE share of this document, one compare-and-set; null when none was live. */
export async function revokeDocumentShares(
  db: SupabaseClient, accountId: string, documentId: string, actorId: string, now: Date,
): Promise<{ ids: string[]; revokedAt: string } | null> {
  const at = now.toISOString();
  const { data, error } = await db.from("document_shares").update({ revoked_at: at, revoked_by: actorId })
    .eq("account_id", accountId).eq("document_id", documentId).is("revoked_at", null).gt("expires_at", at)
    .select("id, revoked_at");
  if (error) throw new Error(`revokeDocumentShares failed: ${error.message}`);
  const rows = (data ?? []) as { id: string; revoked_at: string }[];
  return rows.length === 0 ? null : { ids: rows.map((r) => r.id), revokedAt: rows[0]!.revoked_at };
}

/** Service client. Undo: exactly THOSE shares, THAT revoke (its stored time and author), each only while unexpired. */
export async function restoreDocumentShares(db: SupabaseClient, a: {
  accountId: string; documentId: string; ids: readonly string[]; revokedAt: string; actorId: string; now: Date;
}): Promise<number> {
  if (a.ids.length === 0) return 0;
  const { data, error } = await db.from("document_shares").update({ revoked_at: null, revoked_by: null })
    .eq("account_id", a.accountId).eq("document_id", a.documentId).in("id", [...a.ids])
    .eq("revoked_at", a.revokedAt).eq("revoked_by", a.actorId).gt("expires_at", a.now.toISOString()).select("id");
  if (error) throw new Error(`restoreDocumentShares failed: ${error.message}`);
  return (data ?? []).length;
}

export type ShareClaim = { status: "ok"; first: boolean } | { status: "not_found" | "closed" | "rate_limited" };
/** Service client: public.claim_document_share_download (0085). THROWS on an RPC error or an answer it does not know. */
export async function claimDocumentShareDownload(db: SupabaseClient, a: {
  accountId: string; shareId: string; ipHash: string; max: number; windowSeconds: number; linkMax: number;
}): Promise<ShareClaim> {
  const { data, error } = await db.rpc("claim_document_share_download", {
    p_account_id: a.accountId, p_share_id: a.shareId, p_ip_hash: a.ipHash, p_max: a.max, p_window_seconds: a.windowSeconds, p_link_max: a.linkMax,
  });
  if (error) throw new Error(`claimDocumentShareDownload failed: ${error.message}`);
  const r = data as { status: string; first?: unknown };
  if (r.status === "ok" && typeof r.first === "boolean") return { status: "ok", first: r.first };
  if (r.status === "not_found" || r.status === "closed" || r.status === "rate_limited") return { status: r.status };
  throw new Error(`claimDocumentShareDownload: unexpected answer ${JSON.stringify(r.status)}`);
}

export type ReadyVersionScan = { id: string; scan_status: ScanStatus; created_at: string };
/** Every READY version of one document, newest first (created_at, then id), on the CALLER's client (RLS decides). */
export async function listReadyVersionScans(db: SupabaseClient, accountId: string, documentId: string): Promise<ReadyVersionScan[]> {
  const { data, error } = await db.from("document_versions").select("id, scan_status, created_at")
    .eq("account_id", accountId).eq("document_id", documentId).eq("status", "ready")
    .order("created_at", { ascending: false }).order("id", { ascending: false }).limit(200);
  if (error) throw new Error(`listReadyVersionScans failed: ${error.message}`);
  return (data ?? []) as ReadyVersionScan[];
}

export type Shareable = { kind: "clean"; versionId: string } | { kind: "pending" | "removed" };
/**
 * Ruling R-V: the version a link shares is the one the reader SEES, by documentView's own rule
 * (apps/web/src/lib/documents/document-view.ts:36-38): the newest clean ready version; with none clean,
 * the current version decides the refusal (pending -> still being checked, else removed). Pure.
 */
export function shareableVersion(versions: readonly ReadyVersionScan[], currentVersionId: string | null): Shareable {
  const clean = versions.find((v) => v.scan_status === "clean");
  if (clean) return { kind: "clean", versionId: clean.id };
  const current = versions.find((v) => v.id === currentVersionId) ?? versions[0];
  return !current || current.scan_status === "pending" ? { kind: "pending" } : { kind: "removed" };
}

export type TimelineDocumentShare = {
  id: string; document_id: string; title: string; category: DocumentCategory; created_by: string; created_at: string;
  first_opened_at: string | null; contact_id: string | null; client_group_id: string | null; deleted_at: string | null;
};
const SHARE_TIMELINE_COLS = "id, document_id, title, category, created_by, created_at, first_opened_at, contact_id, client_group_id, deleted_at";

/**
 * The timeline's share rows (plan deviation 4), on the caller's client so RLS decides: each share at its
 * created_at, and each OPENED share again at its first_opened_at (2c's skip/un-skip shape). A group page
 * also reads the group's own files.
 */
export async function listDocumentShareTimeline(
  db: SupabaseClient, accountId: string, who: string | readonly string[], groupId: string | null, page: TimelinePageOpts,
): Promise<{ shares: TimelineDocumentShare[]; opens: TimelineDocumentShare[] }> {
  const base = () => db.from("document_share_timeline").select(SHARE_TIMELINE_COLS).eq("account_id", accountId);
  const opened = () => base().not("first_opened_at", "is", null);
  const shareReads = [withTimelinePage(forContacts(base(), "contact_id", who), "created_at", page)];
  const openReads = [withTimelinePage(forContacts(opened(), "contact_id", who), "first_opened_at", page)];
  if (groupId) {
    shareReads.push(withTimelinePage(base().eq("client_group_id", groupId), "created_at", page));
    openReads.push(withTimelinePage(opened().eq("client_group_id", groupId), "first_opened_at", page));
  }
  const [s, o] = await Promise.all([Promise.all(shareReads), Promise.all(openReads)]);
  const rows = (results: typeof s, what: string) => results.flatMap(({ data, error }) => {
    if (error) throw new Error(`listDocumentShareTimeline (${what}) failed: ${error.message}`);
    return (data ?? []) as TimelineDocumentShare[];
  });
  return { shares: rows(s, "shares"), opens: rows(o, "opens") };
}
```

  `packages/db/src/index.ts`, after the 3a block:

```ts
// S-07 3b: share links. See ./document-shares.ts.
export {
  DOCUMENT_SHARE_HOURS, createDocumentShare, findDocumentShareByTokenHash, documentShareState, getShareTarget,
  listLiveDocumentShares, revokeDocumentShares, restoreDocumentShares, claimDocumentShareDownload, listDocumentShareTimeline,
  listReadyVersionScans, shareableVersion, type ReadyVersionScan, type Shareable,
  type DocumentShareRow, type DocumentShareLife, type ShareTarget, type ShareClaim, type TimelineDocumentShare,
} from "./document-shares";
```

- [ ] **Step 5: Run green** on set A: `document-shares.test.ts`, `documents.test.ts`, `document-requests.test.ts`; `pnpm --filter @bis/db exec tsc --noEmit` is NOT run (pnpm exec trailer): run `node node_modules/typescript/bin/tsc --noEmit -p .` in `packages/db`, and `pnpm --filter web typecheck`. Paste every summary line.
- [ ] **Step 6: Probes, by name** (each reverted by hand, `cmp`-checked): (a) `getShareTarget`'s version read without `.eq("document_id", …)` → case 3 FAILS; (b) `revokeDocumentShares` without `.eq("document_id", …)` → case 5 FAILS; (c) `restoreDocumentShares` without `.eq("revoked_by", …)` → case 6 FAILS; (d) `listDocumentShareTimeline`'s `opened()` as `base()` → case 8 FAILS; (e) `documentShareState` with `<` → case 2 FAILS; (f) `shareableVersion` returning the current version first → case 9 FAILS. Paste each.
- [ ] **Step 7: Stop your kit. Commit** `git add -- packages/db/src/document-shares.ts packages/db/src/test/document-shares.test.ts` then `git commit -m "db: share links' reads and writes, each scoped to the token row's account, document and version (S-07 3b)" -- packages/db/src/document-shares.ts packages/db/src/test/document-shares.test.ts packages/db/src/index.ts`.

---

## Task 4: The timeline: shared and opened rows, the recipient's mark (bis-crm)

**Review:** sonnet. **Scratch:** replica set A after Task 3's implementer stopped it (dir `<SCRATCH>/s07g-t4-impl/`); reviewer set B. **Runs beside:** Tasks 5 and 6.

**Files**
- Modify: `packages/db/src/record.ts` (the union `:301-322`, the `documents` settle `:444-462`), `packages/db/src/test/record.test.ts` (one case appended), `packages/db/src/test/timeline-merge.test.ts` (`:145-149`, one new case beside `:215`)
- Modify: `apps/web/src/lib/record/{author-mark,timeline-rows,recent-rows}.ts` and their tests; `…/contacts/[contactId]/activity-timeline.tsx` (+ `activity-timeline.rows.test.ts`); `…/acct/groups/[groupId]/group-timeline.tsx` (+ `group-timeline.test.ts`); `…/contacts/contact-drawer.tsx` (`ROW_ICON`, `:64-68`); `apps/web/src/lib/contacts/drawer-summary.ts` (`ROW_KINDS`, `:52-55`) (+ `drawer-summary.test.ts`); `…/api/accounts/[accountId]/contacts/[contactId]/summary/route.reads.test.ts` (`MEASURED` and its comment, `:69`)

**Interfaces**
- Consumes: `listDocumentShareTimeline`, `TimelineDocumentShare` (Task 3); keys `timeline.documentShared`, `timeline.documentShareOpened`, `provenance.linkRecipient`, `documents.category.*`, `documents.status.trashed` (Task 2 / existing).
- Produces: `TimelineEntry` gains `{ kind: "documentShared"; id: string; at: string; contactId: string; share: TimelineDocumentShare }` (`at` = `created_at`) and `{ kind: "documentShareOpened"; id: string; at: string; contactId: string; share: TimelineDocumentShare }` (`at` = `first_opened_at`).

- [ ] **Step 1: Read** `sed -n 295,325p packages/db/src/record.ts`, `:440-465`; `apps/web/src/lib/record/author-mark.ts` whole; `sed -n 60,140p apps/web/src/lib/record/timeline-rows.ts`; `sed -n 30,60p apps/web/src/lib/record/recent-rows.ts`; `activity-timeline.tsx:175-200`; `group-timeline.tsx:120-145`; `contact-drawer.tsx:60-70`; `drawer-summary.ts:45-56`; `timeline-merge.test.ts:140-220`; `route.reads.test.ts:55-80`; the `documentSkip`/`documentUnskip` cases in each test file (`author-mark.test.ts:160-170`, `timeline-rows.test.ts:220-235`, `recent-rows.test.ts:130-140`, `drawer-summary.test.ts:126-135`, and the two timelines' tests), whose shape every new case copies; `packages/db/src/test/record.test.ts:690-715`.

- [ ] **Step 2: Failing tests.**
  - `author-mark.test.ts`, one case (O1 (a)):

```ts
  it("a share is the sharer's (a person); its first open is the customer kind, worded as the link's recipient in both languages (O1; mutations: the person mark for the open; the plain 'Customer' word; a sixth kind -> FAILS)", () => {
    const share = { id: "s1", document_id: "d1", title: "Seguro 2026.pdf", category: "insurance", created_by: "u_ana", created_at: AT, first_opened_at: AT, contact_id: "c1", client_group_id: null, deleted_at: null };
    const shared = { kind: "documentShared", id: "s1", at: AT, contactId: "c1", share } as TimelineEntry;
    const opened = { kind: "documentShareOpened", id: "s1", at: AT, contactId: "c1", share } as TimelineEntry;
    expect([authorOf(shared), authorOf(opened)]).toEqual([{ kind: "person", personId: "u_ana" }, { kind: "customer", personId: null }]);
    expect(authorMark(opened, ctx())).toEqual({ kind: "customer", label: "The link's recipient" });
    expect(authorMark(opened, ctx({ tr: makeTr("es") }))).toEqual({ kind: "customer", label: "Quien recibió el enlace" });
    expect(authorMark({ kind: "chat", id: "x", at: AT, contactId: "c1", chat: { conversationId: "v", count: 1, matchedExisting: true } } as TimelineEntry, ctx()).label).toBe("Customer");
  });
```
  (`ctx` and `makeTr` are the file's own, `author-mark.test.ts:32-33`. The last line proves the swap is limited to the one row.)
  - `timeline-rows.test.ts`, one case (the file's own `trFor`/`author` helpers, as its `documentSkip` case at `:220` does):

```ts
  it("a share reads 'shared <title>' and its first open 'opened <title>', both languages, the category as detail, a trashed file's status, distinct keys (mutations: one verb for both; no trashed status -> FAILS)", () => {
    const share = { id: "s1", document_id: "d1", title: "Seguro 2026.pdf", category: "insurance", created_by: "u1", created_at: AT, first_opened_at: "2026-10-16T16:00:00.000Z", contact_id: "c1", client_group_id: null, deleted_at: "2026-10-17T10:00:00.000Z" };
    const entries = [
      { kind: "documentShareOpened", id: "s1", at: "2026-10-16T16:00:00.000Z", contactId: "c1", share },
      { kind: "documentShared", id: "s1", at: AT, contactId: "c1", share },
    ] as TimelineEntry[];
    const en = timelineRows(entries, { zone: "America/Chicago", tr: trFor("en"), author: author(trFor("en")) });
    expect(en.map((r) => [r.verb, r.detail, r.status?.word])).toEqual([
      ["opened Seguro 2026.pdf", "Insurance", "In the trash"], ["shared Seguro 2026.pdf", "Insurance", "In the trash"]]);
    const es = timelineRows(entries, { zone: "America/Chicago", tr: trFor("es"), author: author(trFor("es")) });
    expect(es.map((r) => r.verb)).toEqual(["abrió Seguro 2026.pdf", "compartió Seguro 2026.pdf"]);
    expect(new Set(en.map((r) => r.key)).size).toBe(2);
  });
```
  (Read 2026-10-18: `documents.category.insurance` is "Insurance" (`messages.ts:3870`), `documents.status.trashed` "In the trash" (`:3930`).)
  - `recent-rows.test.ts`: a `documentShared` and a `documentShareOpened` entry each read with `excerpt` `null` and their verb (mutation: return the title as the excerpt → FAILS). `drawer-summary.test.ts`: `ROW_KINDS` accepts `"documentShared"` and `"documentShareOpened"` (copy the skip case at `:126`; mutation: drop either → FAILS). Both timelines' row tests: `documentShared` wears the `Link2` icon and `documentShareOpened` the `Download` icon (follow the `documentSkip` case's icon assertion; mutations: return null; wear the Paperclip → FAILS).
  - `packages/db/src/test/record.test.ts` (behind PostgREST): a contact whose clean file was shared and then downloaded once (`claimDocumentShareDownload` with `ipHash: "a".repeat(32), max: 5, windowSeconds: 600, linkMax: 100`) reads exactly TWO share entries, `documentShareOpened` (its `at` = `first_opened_at`) then `documentShared` (its `at` = `created_at`), both the share's id (mutation: drop the opens read from `record.ts` → FAILS).
  - `timeline-merge.test.ts`: `:145-147`'s comment adds "and 0085's two document_share_timeline reads (a share at created_at, an open at first_opened_at), so there are seven reads more than there are sources" and the line becomes `expect(paged.map((r) => r.limit)).toEqual(Array(TIMELINE_SOURCES.length + 7).fill(TIMELINE_PAGE_SIZE + 1));`; after `:149` add `expect(paged.filter((r) => r.table === "document_share_timeline").map((r) => r.limit)).toEqual([TIMELINE_PAGE_SIZE + 1, TIMELINE_PAGE_SIZE + 1]);`. A new case beside `:215`: a refused `document_share_timeline` read fails the `documents` source (copy the `document_requirement_skips` case with the relation name changed).

- [ ] **Step 3: Run them to see them fail** (web by path; db on set A). Expected: each new case FAILS; typecheck errors on the new kinds.

- [ ] **Step 4: Implement.**
  - `record.ts`: import `listDocumentShareTimeline, type TimelineDocumentShare` from `./document-shares`; the union gains, after `documentUnskip`:

```ts
  /** S-07 3b (plan deviation 4): one row per share link, at its created_at, from 0085's document_share_timeline so RLS decides. `id` is the share's. */
  | { kind: "documentShared"; id: string; at: string; contactId: string; share: TimelineDocumentShare }
  /** S-07 3b: the link's first download, at its first_opened_at, from the same row. The kind keeps its key apart from the share's. */
  | { kind: "documentShareOpened"; id: string; at: string; contactId: string; share: TimelineDocumentShare };
```
    The `documents` settle's `Promise.all` gains `listDocumentShareTimeline(db, accountId, who, opts.groupId ?? null, page)` as a sixth read, destructured as `shares`, mapped after the un-skips:

```ts
        ...shares.shares.map((s): TimelineEntry => ({ kind: "documentShared", id: s.id, at: s.created_at, contactId: s.contact_id ?? "", share: s })),
        ...shares.opens.map((s): TimelineEntry => ({ kind: "documentShareOpened", id: s.id, at: s.first_opened_at!, contactId: s.contact_id ?? "", share: s })),
```
    The comment above the settle says "eight kinds" and names "each share link and its first open (S-07 3b, from 0085's document_share_timeline)".
  - `author-mark.ts`, `authorOf`: `case "documentShared": return { kind: "person", personId: entry.share.created_by };` and `case "documentShareOpened": return { kind: "customer", personId: null };` with the comment `// S-07 3b (O1): whoever holds the link is not known to be the customer; the customer mark, worded as the link's recipient (authorMark).` `authorMark` becomes:

```ts
export function authorMark(entry: TimelineEntry, ctx: AuthorCtx): AuthorMarkView {
  const { kind, personId } = authorOf(entry);
  // S-07 3b (O1): the first open of a share link is the customer KIND, labelled as the link's recipient
  // (the "Someone on the team" precedent: a second word inside one kind, never a sixth kind).
  if (entry.kind === "documentShareOpened") return { kind, label: ctx.tr.text("provenance.linkRecipient") };
  return { kind, label: authorLabel(kind, personId, ctx) };
}
```
  - `timeline-rows.ts`, after `documentUnskip`:

```ts
    // S-07 3b: "{person} shared <title>" and "{the link's recipient} opened <title>"; a trashed file's status, the category as detail.
    case "documentShared":
    case "documentShareOpened": return {
      verb: tr.text(entry.kind === "documentShared" ? "timeline.documentShared" : "timeline.documentShareOpened", { title: entry.share.title }),
      status: entry.share.deleted_at ? { tone: "muted", word: tr.text("documents.status.trashed") } : null,
      detail: tr.text(`documents.category.${entry.share.category}`),
    };
```
  - `recent-rows.ts`: `case "documentShared": case "documentShareOpened": return null;` with `// S-07 3b: the head already names the file.` Both timelines: a case for each beside `documentUnskip`, `documentShared` → `<TimelineItem {...head} icon={Link2} />`, `documentShareOpened` → `<TimelineItem {...head} icon={Download} />` (from `lucide-react`; Assumption A5). `contact-drawer.tsx` `ROW_ICON`: `documentShared: Link2, documentShareOpened: Download`. `drawer-summary.ts` `ROW_KINDS`: add both.
  - `route.reads.test.ts:69`: run the test first with the new reads in place and READ the measured count from its failure message; expected 31. Then `const MEASURED = 31; // measured <date>: 31 reads (+1 prefs), the two added are request:document_share_timeline twice (S-07 3b: a share at created_at, its first open at first_opened_at); 29 measured 2026-10-17: …` (keep the rest of the comment). If it is not 31, stop and report.

- [ ] **Step 5: Run** every file this task touched (web by path; `record.test.ts`, `timeline-merge.test.ts` on set A) plus `src/lib/i18n/ratchet.test.ts`; `pnpm --filter web typecheck`; `pnpm --filter web exec eslint <touched files>`. All PASS; paste the summary lines.
- [ ] **Step 6: Probes:** (a) `authorMark` without the swap → the author case FAILS on "The link's recipient"; (b) the opens map removed from `record.ts` → `record.test.ts`'s case and `timeline-merge`'s `+ 7` FAIL; (c) `timeline.documentShared` used for both kinds → the rows case FAILS; (d) `MEASURED` left at 29 → `route.reads.test.ts` FAILS. Paste each.
- [ ] **Step 7: Stop your kit. Commit** every path above, message "timeline: a share link reads 'shared <file>' with the sharer's mark, its first download 'opened <file>' with the link's recipient (S-07 3b)".

---

## Task 5: The token, the public rule, the download route (bis-crm)

**Review:** opus. **Runs beside:** Tasks 4 and 6.

**Files**
- Create: `apps/web/src/lib/document-shares/share-token.ts` (+ `share-token.test.ts`), `apps/web/src/lib/document-shares/public-share.ts` (+ `public-share.test.ts`), `apps/web/src/app/api/s/[token]/download/route.ts` (+ `route.test.ts`)

**Interfaces**
- Consumes: Task 3's module; `isTokenShape`, `tokenHash` (`lib/document-requests/token.ts:23-24`); `formatPhone` (`lib/document-requests/customer-state.ts`); `extensionForType`, `formatMb` (`lib/documents/rules.ts:26`, `:48`); `clientIp`, `hashIp`, `RATE_LIMIT_MAX`, `RATE_LIMIT_WINDOW_MS` (`lib/forms/guards.ts:9-10`, `:111`, `:128`); `signedDocumentReadUrl`, `getBranding`, `brandLogoUrl`, `listPhoneNumbersForAccount` (`@bis/db`); `loggableError`.
- Produces:
  - `share-token.ts` (server-only): `newShareToken(): string` (43 base64url characters from 32 random bytes); `shareUrl(origin: string, token: string): string` (`<origin>/s/<token>`).
  - `public-share.ts` (server-only; takes the caller's client): `SHARE_URL_SECONDS = 120`; `SHARE_LINK_MAX_DOWNLOADS = 100`; `type ShareState = "open" | "expired" | "revoked" | "trashed" | "removed" | "not_found"`; `type ResolvedShare = { state: Exclude<ShareState, "not_found">; share: DocumentShareRow; target: ShareTarget } | { state: "not_found" }`; `resolveShare(db, token: string, now: Date): Promise<ResolvedShare>`; `type SharePage = { state: ShareState; language: "en" | "es"; branding: Branding | null; logoUrl: string | null; phone: string | null; file: { title: string; type: string; size: string } | null }`; `sharePage(db, token, now): Promise<SharePage>`; `shareSize(bytes: number, language: "en" | "es"): string`; `shareFileName(title: string, contentType: DocumentContentType): string`; `type RouteAnswer = { status: number; body: Record<string, unknown> }`; `shareDownload(db, token: string, ipHash: string, now: Date): Promise<RouteAnswer>`.
  - The route: `POST /api/s/<token>/download` → `200 { url }` | `410 { error: "unavailable" }` | `429 { error: "rate_limited" }` | `503 { error: "failed" }`, every answer with the three headers.

- [ ] **Step 1: Read** `apps/web/src/lib/document-requests/token.ts`, `customer-upload.ts` whole (the shape this copies), `customer-state.ts` (`formatPhone`), `apps/web/src/app/api/d/[token]/start/route.ts` and its `route.test.ts`, `apps/web/src/lib/forms/guards.ts:1-130`, `packages/db/src/documents.ts:520-557` (`signedDocumentReadUrl`), `packages/db/src/branding.ts:160-170`, `:340-420`, `packages/db/src/voice.ts:840-860` (`listPhoneNumbersForAccount`'s row fields).

- [ ] **Step 2: Failing tests.**
  - `share-token.test.ts`: `newShareToken()` passes `isTokenShape` and two calls differ (mutation: a constant → FAILS); `tokenHash(newShareToken())` is 64 hex; `shareUrl("https://app.example.com/", "A".repeat(43))` → `https://app.example.com/s/AAAA…` (mutation: keep the trailing slash → FAILS).
  - `public-share.test.ts` (`vi.mock("@bis/db", async (orig) => ({ ...(await orig()), findDocumentShareByTokenHash: vi.fn(), getShareTarget: vi.fn(), claimDocumentShareDownload: vi.fn(), signedDocumentReadUrl: vi.fn(), getBranding: vi.fn(), listPhoneNumbersForAccount: vi.fn() }))`; `vi.stubEnv("FORM_TOKEN_SECRET", "unit-only-form-secret")` in `beforeEach`, `vi.unstubAllEnvs()` after; a fake `db` whose `from("accounts").select("language").eq("id", id).maybeSingle()` answers `{ data: { language: "es" }, error: null }` and RECORDS the id; the token `TOK = "A".repeat(43)`; `SHARE` a row with `account_id: ACC`, `document_id: DOC`, `version_id: VER`, `expires_at` an hour after `NOW`; `TARGET` clean, ready, not trashed):
    1. A malformed token (`"short"`, `"A".repeat(44)`, `"A".repeat(42) + "="`) → `resolveShare` answers `not_found` and NO `@bis/db` function was called (mutation: look it up anyway → FAILS).
    2. `findDocumentShareByTokenHash` is called with `tokenHash(TOK)` (64 hex), never with the token (mutation: pass the token → FAILS).
    3. **Isolation:** `getShareTarget` is called with an object whose `account_id`, `document_id`, `version_id` are EXACTLY the share row's (send a fake whose answer differs by account to prove nothing else is passed); `claimDocumentShareDownload` receives `{ accountId: ACC, shareId: SHARE.id, ipHash, max: 5, windowSeconds: 600, linkMax: 100 }`; `signedDocumentReadUrl` receives `(db, ACC, VER, { seconds: 120, download: "Seguro 2026.pdf" })` for a target titled `Seguro 2026` with `content_type: "application/pdf"` — the SHARED version, even when the fixture's document says another version is current (review F6: the `getShareTarget` mock answers a `version.id` DIFFERENT from `SHARE.version_id`, so minting with `r.target.version.id` fails this case; mutation: mint with `r.target.version.id` → FAILS); the language read's recorded id is `ACC`.
    4. States: revoked → `revoked`; expired (`expires_at = NOW`) → `expired`; a trashed target → `trashed`; a `pending`, an `infected`, an `unscannable` and an `uploading` version → `removed`; `getShareTarget` answering null → `not_found` (mutations: drop any one check → FAILS).
    5. **Uniform refusals:** `shareDownload` answers EXACTLY `{ status: 410, body: { error: "unavailable" } }` for a malformed token, an unknown token, and each of revoked, expired, trashed, removed; and for a claim answering `not_found` or `closed`; and for `signedDocumentReadUrl` answering `pending`, `removed`, `not_ready`, `not_found` (`it.each`; mutation: answer `410 { error: "revoked" }` for a revoked link → FAILS). `claimDocumentShareDownload` is NOT called for any refused state (mutation: claim first → FAILS).
    6. A `rate_limited` claim → `429 { error: "rate_limited" }` and NO mint (mutation: mint anyway → FAILS); an `ok` claim and an `ok` mint → `200 { url }`.
    6b. **The first open is logged by id (review F7: the claim's `first` is used, not dropped):** with `console.info` spied, a claim answering `{ ok, first: true }` logs exactly one line, `document share <SHARE.id>: first opened`, containing neither `TOK` nor the title; a claim answering `first: false` logs nothing (mutation: log on every download → FAILS; log the title → FAILS).
    7. **Nothing logs the token:** with `console.error` spied, a `claimDocumentShareDownload` that throws answers `503 { error: "failed" }` and no logged string contains `TOK` (mutation: log the token → FAILS); the logged line names `SHARE.id`.
    8. `sharePage`: an open share answers `{ state: "open", language: "es", phone: "(956) 555-0123", file: { title: "Seguro 2026", type: "PDF", size: "1.2 MB" } }` for 1 258 291 bytes in Spanish (read 2026-10-18: `formatMb` formats with `es-US`, whose decimal mark is a period: `1.2`), `logoUrl` from `brandLogoUrl` when the branding has a logo path; a revoked share answers `file: null` with the branding and phone still read (the refusal page names the business); a branding read that throws still answers the page (`branding: null`); an unknown token answers the not-found page with NO branding, phone or language read (mutation: read the branding first → FAILS).
    9. `shareSize(10, "en")` → `"1 KB"`; `shareSize(512_000, "en")` → `"500 KB"`; `shareSize(1_258_291, "en")` → `"1.2 MB"` (mutation: always `formatMb` → "0 MB" → FAILS).
  - `route.test.ts` (`vi.mock("@/lib/document-shares/public-share")` and `@bis/db`'s `serviceDb`; `vi.stubEnv("FORM_TOKEN_SECRET", "unit-only-form-secret")`): the route passes `params.token`, `hashIp(clientIp(req.headers))` for a request with `x-vercel-forwarded-for: 203.0.113.9` (compare with the real `hashIp("203.0.113.9")`; mutation: pass the raw address → FAILS) and a `Date`; returns the module's status and body unchanged (mutation: always 200 → FAILS); every answer carries `Cache-Control: no-store`, `Referrer-Policy: no-referrer`, `X-Robots-Tag: noindex` (mutation: drop one → FAILS); a `hashIp` that throws (unstub the env and delete `SUPABASE_SERVICE_ROLE_KEY` inside the case) answers `503 { error: "failed" }` with the headers and never calls the module.

- [ ] **Step 3: Run them to see them fail.**

- [ ] **Step 4: Implement `share-token.ts`:**

```ts
import { randomBytes } from "node:crypto";

/**
 * A share link's token (spec 4.1): 32 random bytes, base64url, 43 characters (2b's shape, so
 * isTokenShape and tokenHash in ../document-requests/token.ts serve both). Only sha256(token) is
 * stored; the link exists once, in the toast and the clipboard. Our code never logs it; the link
 * itself travels wherever staff send it, and Vercel's request log records /s/<token> and
 * /api/s/<token>/download for every visit (review F9; 2b's token.ts names the same residual for /d).
 * Server only.
 */
export const newShareToken = (): string => randomBytes(32).toString("base64url");
export const shareUrl = (origin: string, token: string): string => `${origin.replace(/\/+$/, "")}/s/${token}`;
```

- [ ] **Step 5: Implement `public-share.ts`:**

```ts
import {
  findDocumentShareByTokenHash, documentShareState, getShareTarget, claimDocumentShareDownload, signedDocumentReadUrl,
  getBranding, brandLogoUrl, listPhoneNumbersForAccount,
  type Branding, type DocumentContentType, type DocumentShareRow, type ShareTarget, type SupabaseClient,
} from "@bis/db";
import { isTokenShape, tokenHash } from "@/lib/document-requests/token";
import { formatPhone } from "@/lib/document-requests/customer-state";
import { extensionForType, formatMb } from "@/lib/documents/rules";
import { RATE_LIMIT_MAX, RATE_LIMIT_WINDOW_MS } from "@/lib/forms/guards";
import { loggableError } from "@/lib/loggable-error";

/**
 * The public rule for a share link (study 3.4; spec 4.2): the token is proven FIRST on every request
 * (its shape, then a lookup by its sha256, then open: not revoked, not expired, the document not
 * trashed, the shared version ready and clean), and every later read carries the TOKEN ROW's account,
 * document and version. The browser sends nothing else. Every refused download is the same answer
 * (plan deviation 6); the page states differ only for a real token's holder. Logs name the share id,
 * never the token. The service client is the CALLER's (the route's or the page's); this file names no
 * service client of its own. The one mint is signedDocumentReadUrl, 2a's gate.
 */
export const SHARE_URL_SECONDS = 120;
/** Ruling O3: a link is downloaded at most this many times in all, from any address (0085's p_link_max). */
export const SHARE_LINK_MAX_DOWNLOADS = 100;
export type ShareState = "open" | "expired" | "revoked" | "trashed" | "removed" | "not_found";
export type ResolvedShare = { state: Exclude<ShareState, "not_found">; share: DocumentShareRow; target: ShareTarget } | { state: "not_found" };

export async function resolveShare(db: SupabaseClient, token: string, now: Date): Promise<ResolvedShare> {
  if (!isTokenShape(token)) return { state: "not_found" };
  const share = await findDocumentShareByTokenHash(db, tokenHash(token));
  if (!share) return { state: "not_found" };
  const target = await getShareTarget(db, share);
  if (!target) return { state: "not_found" };
  const life = documentShareState(share, now);
  if (life !== "open") return { state: life, share, target };
  if (target.document.deleted_at !== null) return { state: "trashed", share, target };
  if (target.version.status !== "ready" || target.version.scan_status !== "clean") return { state: "removed", share, target };
  return { state: "open", share, target };
}

export const shareFileName = (title: string, contentType: DocumentContentType): string => `${title}.${extensionForType(contentType)}`;
/** Under a megabyte reads in KB (never "0 MB"); the rest as the vault's own MB words. */
export function shareSize(bytes: number, language: "en" | "es"): string {
  return bytes < 1_048_576 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : formatMb(bytes, language);
}

export type SharePage = {
  state: ShareState; language: "en" | "es"; branding: Branding | null; logoUrl: string | null; phone: string | null;
  file: { title: string; type: string; size: string } | null;
};
const NOT_FOUND_PAGE: SharePage = { state: "not_found", language: "en", branding: null, logoUrl: null, phone: null, file: null };

/** Decorative reads (the /d page's rule): a blip never costs the visitor the page; logged by share id. */
async function accountLanguage(db: SupabaseClient, accountId: string, shareId: string): Promise<"en" | "es"> {
  try {
    const { data, error } = await db.from("accounts").select("language").eq("id", accountId).maybeSingle();
    if (error) throw new Error(error.message);
    return (data as { language: string | null } | null)?.language === "es" ? "es" : "en";
  } catch (e) {
    console.error(`document share ${shareId}: language unreadable: ${loggableError(e)}`);
    return "en";
  }
}
async function brandingOf(db: SupabaseClient, accountId: string, shareId: string): Promise<Branding | null> {
  try {
    return await getBranding(db, accountId);
  } catch (e) {
    console.error(`document share ${shareId}: branding unreadable: ${loggableError(e)}`);
    return null;
  }
}
async function livePhone(db: SupabaseClient, accountId: string, shareId: string): Promise<string | null> {
  try {
    const live = (await listPhoneNumbersForAccount(db, accountId)).find((p) => p.status === "live");
    return live ? formatPhone(live.e164) : null;
  } catch (e) {
    console.error(`document share ${shareId}: phone number unreadable: ${loggableError(e)}`);
    return null;
  }
}

/** The page's whole read (spec 4.2). A refusal page still names the business and its phone. */
export async function sharePage(db: SupabaseClient, token: string, now: Date): Promise<SharePage> {
  const r = await resolveShare(db, token, now);
  if (r.state === "not_found") return NOT_FOUND_PAGE;
  const accountId = r.share.account_id;
  const [language, branding, phone] = await Promise.all([
    accountLanguage(db, accountId, r.share.id), brandingOf(db, accountId, r.share.id), livePhone(db, accountId, r.share.id)]);
  return {
    state: r.state, language, branding, phone,
    logoUrl: branding?.brandLogoPath ? brandLogoUrl(branding.brandLogoPath) : null,
    file: r.state === "open" ? {
      title: r.target.document.title,
      type: extensionForType(r.target.version.content_type).toUpperCase(),
      size: shareSize(r.target.version.bytes, language),
    } : null,
  };
}

export type RouteAnswer = { status: number; body: Record<string, unknown> };
const unavailable = (): RouteAnswer => ({ status: 410, body: { error: "unavailable" } });

/**
 * The Download (spec 4.2, 4.3): re-proves the token, claims the download (0085: re-proved open and
 * clean under the share's lock, the forms limiter's numbers per link and address, the first open
 * exactly once), then mints a 120 s URL for the SHARED version through the one gate. Counted before
 * the mint (plan deviation 5).
 */
export async function shareDownload(db: SupabaseClient, token: string, ipHash: string, now: Date): Promise<RouteAnswer> {
  let shareId = "unknown";
  try {
    const r = await resolveShare(db, token, now);
    if (r.state !== "open") return unavailable();
    shareId = r.share.id;
    const claim = await claimDocumentShareDownload(db, {
      accountId: r.share.account_id, shareId: r.share.id, ipHash, max: RATE_LIMIT_MAX, windowSeconds: RATE_LIMIT_WINDOW_MS / 1000,
      linkMax: SHARE_LINK_MAX_DOWNLOADS,
    });
    if (claim.status === "rate_limited") return { status: 429, body: { error: "rate_limited" } };
    if (claim.status !== "ok") return unavailable();
    // Review F7: the one moment the timeline gains its "opened" row; ids only, never the token or the title.
    if (claim.first) console.info(`document share ${r.share.id}: first opened`);
    const signed = await signedDocumentReadUrl(db, r.share.account_id, r.share.version_id, {
      seconds: SHARE_URL_SECONDS, download: shareFileName(r.target.document.title, r.target.version.content_type),
    });
    if (signed.status !== "ok") return unavailable();
    return { status: 200, body: { url: signed.url } };
  } catch (e) {
    console.error(`document share ${shareId}: download failed: ${loggableError(e)}`);
    return { status: 503, body: { error: "failed" } };
  }
}
```
  (If `listPhoneNumbersForAccount`'s row names its fields otherwise than `status` and `e164`, use its names: `customer-upload.ts:42-50` reads exactly these. If `DocumentContentType` is not on the barrel, import it from `@bis/db/document-rules`.)

- [ ] **Step 6: The route** `apps/web/src/app/api/s/[token]/download/route.ts`:

```ts
import { NextResponse } from "next/server";
import { serviceDb } from "@bis/db";
import { clientIp, hashIp } from "@/lib/forms/guards";
import { shareDownload } from "@/lib/document-shares/public-share";
import { loggableError } from "@/lib/loggable-error";

/**
 * POST /api/s/<token>/download (spec 4.2): no sign-in; the token is the proof (public-share.ts proves it
 * before anything else is read). Rate-limited per link and per address with the forms limiter's own
 * address hash. Never cached, never indexed, never sends a Referer on; never logs the token.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const HEADERS = { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer", "X-Robots-Tag": "noindex" };

export async function POST(req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  let ipHash: string;
  try {
    ipHash = hashIp(clientIp(req.headers));
  } catch (e) {
    console.error(`document share download: no address key: ${loggableError(e)}`);
    return NextResponse.json({ error: "failed" }, { status: 503, headers: HEADERS });
  }
  const r = await shareDownload(serviceDb(), token, ipHash, new Date());
  return NextResponse.json(r.body, { status: r.status, headers: HEADERS });
}
```

- [ ] **Step 7: Run** the three new test files plus `src/lib/documents/read-gate.test.ts` and `"src/app/(dashboard)/dashboard/accounts/[accountId]/in-account-service-reads.test.ts"` (no `serviceDb` in `lib`; the route is outside its roots); `pnpm --filter web typecheck`; eslint on the new files. All PASS.
- [ ] **Step 8: Probes, by name:** (a) `resolveShare` without the trashed check → case 4 FAILS; (b) the mint using `r.target.version.id` instead of `r.share.version_id` → case 3 FAILS (its mock answers a different version id, review F6); (c) a revoked link answering `410 { error: "revoked" }` → case 5 FAILS; (d) the catch logging `token` → case 7 FAILS; (d2) the first-open line on every download → case 6b FAILS; (e) the route without `X-Robots-Tag` → the route case FAILS. Paste each.
- [ ] **Step 9: Commit** `git add --` the six new files, then `git commit -m "documents: share links' public rule and the one download route, re-proving the token on every request and minting only the shared version (S-07 3b)" -- <the six files>`.

---

## Task 6: Staff actions; Owners only stops live links (O2); the card's read carries the live link (bis-crm)

**Review:** opus. **Runs beside:** Tasks 4 and 5.

**Files**
- Create: `…/contacts/document-shares-actions.ts` (+ `document-shares-actions.test.ts`)
- Modify (ruling O2): `…/contacts/documents-actions.ts` (`setOwnersOnlyAction` `:297-314`, `undoOwnersOnlyAction` `:316-331`, one import) (+ `documents-actions.test.ts`: its `db` mock object `:13-25` gains `revokeDocumentShares: vi.fn()`)
- Modify: `apps/web/src/lib/documents/documents-load.ts` (`DocumentView`, `isView`) (+ `documents-load.test.ts`); `apps/web/src/lib/documents/document-view.ts` (`documentView`); `apps/web/src/app/api/accounts/[accountId]/contacts/[contactId]/documents/route.ts` and `…/groups/[groupId]/documents/route.ts` (+ both `route.test.ts`); `…/acct/in-account-service-reads.test.ts` (one `ALLOWED` line)

**Interfaces**
- Consumes: `getDocument`, `listReadyVersionScans`, `shareableVersion` (Task 3; ruling R-V), `createDocumentShare`, `revokeDocumentShares`, `restoreDocumentShares`, `listLiveDocumentShares` (`@bis/db`); `newShareToken`, `shareUrl` (Task 5); `tokenHash`; `originFrom`; `DocFail` (`documents-actions.ts:31`); keys from Task 2.
- Produces:
  - `createDocumentShareAction(accountId: string, documentId: string): Promise<{ ok: true; url: string } | DocFail>`
  - `stopSharingAction(accountId: string, documentId: string): Promise<{ ok: true; ids: string[]; revokedAt: string } | DocFail>`
  - `undoStopSharingAction(accountId: string, documentId: string, ids: unknown, revokedAt: unknown): Promise<{ ok: true } | DocFail>`
  - `DocumentView.share?: { expiresAt: string }` — present ONLY when the file has a live link; `documentView(d, viewerId, names, zone, shareExpiresAt?: string | null)`.

- [ ] **Step 1: Read** `…/contacts/documents-actions.ts:1-70` (the proof shape, `fail`, `log`), `…/contacts/document-requests-actions.ts:1-60`, `:110-170` (link, revoke, undo), their two test files' mock headers, `apps/web/src/lib/documents/documents-load.ts` whole, `apps/web/src/lib/documents/document-view.ts:1-60`, both documents routes and their tests (`route.test.ts:1-60`).

- [ ] **Step 2: Failing tests.**
  - `document-shares-actions.test.ts` (mocks: `@/lib/auth` → `requireAccountAccess: vi.fn(async () => access)` with `access = { userId: "u_ana", isAgency: false, role: "staff", canManage: false }` per case; `@/lib/db` → `dbForRequest: async () => REQUEST`; `@bis/db` → `async (orig) => ({ ...(await orig()), serviceDb: () => SERVICE, getDocument: vi.fn(), listReadyVersionScans: vi.fn(), createDocumentShare: vi.fn(), revokeDocumentShares: vi.fn(), restoreDocumentShares: vi.fn() })` (the real `shareableVersion` stays); `next/headers` → `headers: async () => new Headers({ host: "app.example.com", "x-forwarded-proto": "https" })`; `@/lib/document-shares/share-token` → `{ newShareToken: () => "T".repeat(43), shareUrl: (o: string, t: string) => \`${o}/s/${t}\` }`):
    1. A clean, live, team file: `getDocument` is called with `(REQUEST, ACC, DOC)` BEFORE `createDocumentShare` (check `mock.invocationCallOrder`), `listReadyVersionScans` with `(REQUEST, ACC, DOC)`, `shareableVersion` is the REAL one (the `@bis/db` mock spreads `importOriginal` for it), and `createDocumentShare` with `(SERVICE, { accountId: ACC, documentId: DOC, versionId: VER, tokenHash: tokenHash("T".repeat(43)), createdBy: "u_ana", now: expect.any(Date) })`; the answer is `{ ok: true, url: "https://app.example.com/s/TTTT…" }` (mutations: write on the request client; write before the read; store the token → FAILS).
    1b. **Ruling R-V, the version the reader sees:** current `infected` v3 + older clean v1 → shares `v1`; current `pending` v3 + older clean v1 → shares `v1` (`createDocumentShare`'s `versionId`; mutations: share `doc.current_version_id`; refuse whenever the current one is not clean → FAILS). No version comes from the browser: the action takes only `documentId`.
    2. Refusals, each with NO write: a non-uuid id → `documents.share.refused`; `getDocument` null → `documents.share.refused` (review F10: never `documents.error.refused`'s "You can't change that file."); trashed → `documents.error.trashed`; no ready version, or only a `pending` current one → `documents.error.scanning`; only `infected` or `unscannable` → `documents.error.removed`; Owners only for Staff (`canManage: false`) → `documents.share.ownersOnlyRole`, and for an Owner (`canManage: true`) it shares (mutation: drop the role check → the Staff case writes → FAILS).
    3. No origin (`headers` with no `host`, `APP_ORIGIN` unset) → `documents.share.failed` and NO share row (mutation: write first → FAILS).
    4. `createDocumentShare` throwing → `documents.share.failed`; `console.error` was called with a line naming the account and the document id and NOT containing `"T".repeat(43)` (mutation: log the url → FAILS).
    5. `stopSharingAction`: proves on the request client, then `revokeDocumentShares(SERVICE, ACC, DOC, "u_ana", expect.any(Date))`; answers `{ ok: true, ids, revokedAt }`; `null` → `documents.share.notShared`; Owners only for Staff → `documents.share.ownersOnlyRole`, no write.
    6. `undoStopSharingAction`: `restoreDocumentShares(SERVICE, { accountId: ACC, documentId: DOC, ids: ["<lowercased>"], revokedAt, actorId: "u_ana", now: expect.any(Date) })` after the request-client proof; `0` → `documents.share.ended`; ids not an array, empty, 51 long, or holding a non-uuid, or a `revokedAt` that is not an instant → `documents.share.refused` with no read (mutations: accept 51 ids; skip the proof → FAILS).
  - `documents-actions.test.ts` (ruling O2): `setOwnersOnlyAction(ACC, DOC, true)` on a visible file calls `revokeDocumentShares(SERVICE, ACC, DOC, "u_ana", expect.any(Date))` once, AFTER `setDocumentOwnersOnly` (`mock.invocationCallOrder`) and after the request-client read; `value: false` never calls it; a `"changed"` write never calls it; `revokeDocumentShares` throwing answers `documents.error.failed`, exactly as R1's `deleteOpenExpiryTasks` throwing does there (mutations: remove the call → FAILS; move it before `setDocumentOwnersOnly` → the order assertion FAILS). `undoOwnersOnlyAction(ACC, DOC, true, false)` (an Undo writing Owners only BACK) calls it once after its write; `undoOwnersOnlyAction(ACC, DOC, false, true)` (undoing a switch TO Owners only) calls neither `revokeDocumentShares` nor `restoreDocumentShares` (mutation: un-revoke on undo → FAILS).
  - `documents-load.test.ts`: a view with `share: { expiresAt: "2026-10-19T12:00:00Z" }` parses ready; a view without `share` parses ready; `share: { expiresAt: "soon" }` and `share: "x"` answer `error` (mutation: accept any `share` → FAILS).
  - Both documents route tests: the `db` mock gains `listLiveDocumentShares: vi.fn()`, set in `beforeEach` to `async () => ({})`. New case: with `listLiveDocumentShares` answering `{ d1: "2026-10-19T12:00:00Z" }`, `body.live[0].share` equals `{ expiresAt: "2026-10-19T12:00:00Z" }`, the other rows have NO `share` key (`"share" in row` is false), and the call was `(REQUEST, ACC, { kind: "contact", id: C }, expect.any(Date))` (the group route: `{ kind: "group", id: G }`); with it throwing, the response is still 200, no row has `share`, and `console.error` names the account (mutations: `share: null` on every row → the existing exact `toEqual` at `:53` FAILS; let the throw fail the route → FAILS).

- [ ] **Step 3: Run them to see them fail.**

- [ ] **Step 4: Implement** `…/contacts/document-shares-actions.ts`:

```ts
"use server";

import { headers } from "next/headers";
import { requireAccountAccess } from "@/lib/auth";
import { dbForRequest } from "@/lib/db";
import {
  serviceDb, getDocument, listReadyVersionScans, shareableVersion, createDocumentShare, revokeDocumentShares, restoreDocumentShares,
  type DocumentRow,
} from "@bis/db";
import { isUuid } from "@/lib/assign/action-guards";
import { loggableError } from "@/lib/loggable-error";
import { originFrom } from "@/lib/email/origin";
import { tokenHash } from "@/lib/document-requests/token";
import { newShareToken, shareUrl } from "@/lib/document-shares/share-token";
import type { DocFail } from "./documents-actions";

/**
 * Share links (spec 4.1, E3). Every action: requireAccountAccess, then a REQUEST-client read of the
 * document (RLS: the record's visibility, the Technician fence, Owners only), and only then the service
 * client, scoped to the same account and document (0053; listed proven-target in
 * in-account-service-reads.test.ts). An Owners-only file is shared or stopped by an Owner or the agency
 * only (E3), checked here as well as by RLS. The shared version is the one the reader SEES, computed here
 * by documentView's rule (ruling R-V: the newest clean ready version), never taken from the browser. The
 * link is built once and never stored or logged: only its sha256 is kept. Answers are messages.ts keys.
 */
const fail = (error: string): DocFail => ({ ok: false, error });
const REFUSED = "documents.share.refused";
const FAILED = "documents.share.failed";
const ROLE = "documents.share.ownersOnlyRole";
const MAX_UNDO_IDS = 50;

function log(where: string, accountId: string, e: unknown, documentId: string): void {
  console.error(`document shares ${where} (account ${accountId}, document ${documentId}): ${loggableError(e)}`);
}

/** The proof: the document under the caller's RLS, and the Owners-only rule (E3). */
async function provenDocument(accountId: string, documentId: string, canManage: boolean): Promise<DocumentRow | string> {
  const doc = await getDocument(await dbForRequest(), accountId, documentId);
  if (!doc) return REFUSED;
  if (doc.owners_only && !canManage) return ROLE;
  return doc;
}

export async function createDocumentShareAction(accountId: string, documentId: string): Promise<{ ok: true; url: string } | DocFail> {
  const access = await requireAccountAccess(accountId);
  if (!isUuid(documentId)) return fail(REFUSED);
  const docId = documentId.toLowerCase();
  try {
    const doc = await provenDocument(accountId, docId, access.canManage);
    if (typeof doc === "string") return fail(doc);
    if (doc.deleted_at !== null) return fail("documents.error.trashed");
    // Ruling R-V: the version the reader sees, read on the request client, by documentView's own rule.
    const pick = shareableVersion(await listReadyVersionScans(await dbForRequest(), accountId, doc.id), doc.current_version_id);
    if (pick.kind === "pending") return fail("documents.error.scanning");
    if (pick.kind === "removed") return fail("documents.error.removed");
    const origin = originFrom(await headers());
    if (!origin) return fail(FAILED);
    const token = newShareToken();
    await createDocumentShare(serviceDb(), {
      accountId, documentId: doc.id, versionId: pick.versionId, tokenHash: tokenHash(token), createdBy: access.userId, now: new Date(),
    });
    return { ok: true, url: shareUrl(origin, token) };
  } catch (e) {
    log("create", accountId, e, docId);
    return fail(FAILED);
  }
}

export async function stopSharingAction(accountId: string, documentId: string): Promise<{ ok: true; ids: string[]; revokedAt: string } | DocFail> {
  const access = await requireAccountAccess(accountId);
  if (!isUuid(documentId)) return fail(REFUSED);
  const docId = documentId.toLowerCase();
  try {
    const doc = await provenDocument(accountId, docId, access.canManage);
    if (typeof doc === "string") return fail(doc);
    const r = await revokeDocumentShares(serviceDb(), accountId, doc.id, access.userId, new Date());
    return r ? { ok: true, ids: r.ids, revokedAt: r.revokedAt } : fail("documents.share.notShared");
  } catch (e) {
    log("stop", accountId, e, docId);
    return fail("documents.error.failed");
  }
}

const isInstant = (v: unknown): v is string => typeof v === "string" && v.length <= 40 && !Number.isNaN(Date.parse(v));

/** Undo (rule 6): exactly the links THIS caller's stop wrote, at that instant, while each is unexpired. */
export async function undoStopSharingAction(accountId: string, documentId: string, ids: unknown, revokedAt: unknown): Promise<{ ok: true } | DocFail> {
  const access = await requireAccountAccess(accountId);
  if (!isUuid(documentId) || !Array.isArray(ids) || ids.length === 0 || ids.length > MAX_UNDO_IDS || !ids.every(isUuid) || !isInstant(revokedAt)) {
    return fail(REFUSED);
  }
  const docId = documentId.toLowerCase();
  try {
    const doc = await provenDocument(accountId, docId, access.canManage);
    if (typeof doc === "string") return fail(doc);
    const n = await restoreDocumentShares(serviceDb(), {
      accountId, documentId: doc.id, ids: ids.map((i) => i.toLowerCase()), revokedAt, actorId: access.userId, now: new Date(),
    });
    return n > 0 ? { ok: true } : fail("documents.share.ended");
  } catch (e) {
    log("undo stop", accountId, e, docId);
    return fail("documents.error.failed");
  }
}
```

  **Ruling O2**, `…/contacts/documents-actions.ts`: import `revokeDocumentShares` from `@bis/db`; in `setOwnersOnlyAction`, right after R1's line (`:308`):

```ts
    // Ruling O2 (S-07 3b): an Owners-only file keeps no live share link. Service client, account and document
    // scoped, after the read and the write; a throw fails the action exactly as R1's delete does. Switching
    // back off holds nothing: a stopped link stays stopped.
    if (r === "updated" && value) await revokeDocumentShares(serviceDb(), accountId, docId, access.userId, new Date());
```

    and in `undoOwnersOnlyAction`, right after R1's twin (`:325`): `if (r === "updated" && prior) await revokeDocumentShares(serviceDb(), accountId, docId, access.userId, new Date());` with the comment "Ruling O2: an Undo that writes Owners only back stops live links too; undoing Owners only never un-revokes." Nothing else in either action changes.

  `documents-load.ts`: `DocumentView` gains `/** S-07 3b: present ONLY while the file has a live share link (the latest expiry). */ share?: { expiresAt: string };`; `isView` gains `&& (v.share === undefined || (isObj(v.share) && instant(v.share.expiresAt)))`. `document-view.ts`: `documentView(d, viewerId, names, zone, shareExpiresAt: string | null = null)` returns `{ …, ...(shareExpiresAt ? { share: { expiresAt: shareExpiresAt } } : {}) }`. Each documents route: import `listLiveDocumentShares`; inside the `Promise.all`, add a fourth read:

```ts
      listLiveDocumentShares(db, accountId, { kind: "contact", id: contactId }, new Date()).catch((e: unknown) => {
        // Decorative (the space line's rule): a failed read omits the "Shared" line, never the card.
        console.error(`documents read shares (account ${accountId}): ${loggableError(e)}`);
        return {} as Record<string, string>;
      }),
```
  (the group route passes `{ kind: "group", id: groupId }`), destructured as `shares`, and the `live` map passes `shares[d.id] ?? null` as the fifth argument (trashed rows pass nothing). `in-account-service-reads.test.ts`: `ALLOWED` gains, after the `document-requests-actions.ts` line, `"app/(dashboard)/dashboard/accounts/[accountId]/contacts/document-shares-actions.ts": "proven-target",` with a comment `// S-07 3b: share links; the document is read on the request client first.`

- [ ] **Step 5: Run** the new and modified tests plus `in-account-service-reads.test.ts`, `src/lib/documents/read-gate.test.ts`, `"src/app/(dashboard)/dashboard/accounts/[accountId]/documents/page.test.ts"` (the page calls `documentView` with four arguments: unchanged); `pnpm --filter web typecheck`; eslint. All PASS.
- [ ] **Step 6: Probes:** (a) `createDocumentShareAction` without the Owners-only check → case 2 FAILS; (a2) sharing `doc.current_version_id` → case 1b FAILS; (a3) O2's call removed → the Owners-only case FAILS; (a4) O2's call moved above `setDocumentOwnersOnly` → its order assertion FAILS; (b) `undoStopSharingAction` without `MAX_UNDO_IDS` → case 6 FAILS; (c) `documentView` writing `share: null` always → the route's exact `toEqual` FAILS; (d) `ALLOWED` line removed → `in-account-service-reads.test.ts` FAILS. Paste each.
- [ ] **Step 7: Commit** `git add -- <the two new files>` then `git commit -m "documents: Copy share link (the version the reader sees), Stop sharing and its Undo; Owners only stops live links; the card's read says when a link is live (S-07 3b)" -- <every path above, including documents-actions.ts and its test>`.

---

## Task 7: The proxy carve-out and the page's headers (bis-platform)

**Review:** opus. **Runs beside:** Tasks 1 and 2.

**Files**
- Modify: `apps/web/src/proxy.ts` (the matcher and the comment), `apps/web/src/proxy.test.ts`, `apps/web/next.config.ts`
- Create: `apps/web/src/next-config.test.ts`

- [ ] **Step 1: Read** `apps/web/src/proxy.ts`, `apps/web/src/proxy.test.ts`, `apps/web/next.config.ts`, `apps/web/vitest.config.ts` (`include: ["src/**/*.test.ts", …]`).
- [ ] **Step 2: Failing tests.** `proxy.test.ts` per "Pinned tests". `next-config.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import config from "../next.config";

describe("next.config.ts: a shared file's page (S-07 3b, spec 4.2; plan deviation 7)", () => {
  it("/s/:token is never indexed and never sends its address on; nothing else gains a header (mutations: drop either header; source '/s/:path*' -> FAILS)", async () => {
    expect(await config.headers!()).toEqual([
      { source: "/s/:token", headers: [{ key: "Referrer-Policy", value: "no-referrer" }, { key: "X-Robots-Tag", value: "noindex" }] },
    ]);
  });
});
```
- [ ] **Step 3: Run them to see them fail** (`pnpm --filter web exec vitest run src/proxy.test.ts src/next-config.test.ts`). Review F11: `apps/web/src/lib/i18n/request-locale.test.ts:69-73` says next.config.ts "expects the Next.js build runtime" and is NOT safe to import from a vitest worker, which is why that test scans the file's text. The red run decides: if importing `../next.config` throws or warns for a reason other than the missing `headers`, STOP and switch `next-config.test.ts` to a text scan (read the file, assert it contains `source: "/s/:token"` with both header objects, with the same mutations), and say so in the report.
- [ ] **Step 4: Implement.** `proxy.ts`: the matcher becomes `"/((?!_next|c/|f/|b/|u/|d/|s/|.*\\..*).*)"`; the comment's list of trees gains "and /s (share links)" and a paragraph: "`/s/<token>` (S-07 3b) is a shared file's page, opened by whoever got the link, with no sign-in, the same reason as `/d`. Its download route `/api/s/…` stays matched: the page calls it with `fetch`, which is not a document request, so Clerk never hands it a handshake." `next.config.ts` gains, after `experimental`:

```ts
  /**
   * S-07 3b (spec 4.2): a shared file's page is never indexed and never sends its address on. Cache-Control
   * comes from the page itself (force-dynamic answers no-store; Next overrides a configured Cache-Control
   * on pages in production), checked by the e2e spec (plan deviation 7, Assumption A1).
   */
  async headers() {
    return [
      { source: "/s/:token", headers: [{ key: "Referrer-Policy", value: "no-referrer" }, { key: "X-Robots-Tag", value: "noindex" }] },
    ];
  },
```
- [ ] **Step 5: Run** both tests; `pnpm --filter web typecheck`; eslint on the four files. PASS.
- [ ] **Step 6: Probes:** drop `s/` from the matcher → the skip case FAILS for `/s/sometoken`; widen it to `s` (no slash) → the run case FAILS for `/settings`; drop `X-Robots-Tag` → `next-config.test.ts` FAILS. Paste each.
- [ ] **Step 7: Commit** `git add -- apps/web/src/next-config.test.ts` then `git commit -m "platform: /s share links skip Clerk like /d, and their page is never indexed or referred on (S-07 3b)" -- apps/web/src/proxy.ts apps/web/src/proxy.test.ts apps/web/next.config.ts apps/web/src/next-config.test.ts`.

---

## Task 8: The card, the viewer, the handlers, the Documents page's viewer; `/styleguide` (bis-frontend)

**Review:** sonnet. **Runs beside:** Task 9.

**Files**
- Modify: `…/contacts/documents-card.tsx` (`RowMenuItem`, `rowMenuItems`, `DocumentRow`, the viewer mount `:874-878`) (+ `documents-card.test.ts`), `…/contacts/documents-card-handlers.ts` (+ `documents-card-handlers.test.ts`), `…/contacts/document-viewer.tsx` (+ `document-viewer.test.ts`), `…/documents/documents-list.tsx` (the viewer mount `:66-70`) (+ `documents-list.test.ts`), `apps/web/src/app/(dashboard)/dashboard/styleguide/documents-demo.tsx` (+ `documents-demo.test.ts`)

**Interfaces**
- Consumes: `createDocumentShareAction`, `stopSharingAction`, `undoStopSharingAction` (Task 6); `DocumentView.share` (Task 6); keys (Task 2).
- Produces: `DocumentHandlers.copyShareLink(doc: DocumentView): Promise<void>`, `DocumentHandlers.stopSharing(doc: DocumentView): Promise<void>`; `RowMenuItem["id"]` gains `"share" | "stopSharing"`; `rowMenuItems(doc, canManage, now?: string)`; `shareHoursLeft(doc: Pick<DocumentView, "share">, now: string): number | null`; `DocumentViewer`'s optional prop `onShare?: (doc: DocumentView) => void`; `DocumentViewerShare` (exported); markers `data-document-shared`, `data-document-share`.

- [ ] **Step 1: Read** `documents-card.tsx:120-284` (the menu, the row), `:860-882`; `documents-card-handlers.ts` whole; `document-viewer.tsx:170-252`; `documents-list.tsx` whole; `styleguide/documents-demo.tsx:1-100` and its test; the `rowMenuItems` cases in `documents-card.test.ts:185-200`, `:375-405`; the handler tests' mock header (`documents-card-handlers.test.ts:1-40`) and its `revokeRequest` case (the Undo shape).
- [ ] **Step 2: Failing tests.**
  - `documents-card.test.ts`: the pinned changes (`:191-194`, `:384`). New: `rowMenuItems(view({ share: { expiresAt: "2026-10-19T06:00:00.000Z" } }) as never, false, "2026-10-18T12:00:00.000Z").map((i) => i.id)` → `["edit", "newVersion", "download", "share", "stopSharing", "trash"]`; with `now` past the expiry → no `stopSharing`; with no `now` → no `stopSharing` (mutations: offer Stop sharing on an expired link → FAILS). `shareHoursLeft({ share: { expiresAt: "2026-10-19T06:00:00.000Z" } }, "2026-10-18T12:00:00.000Z")` → 18; one minute left → 1; expired → null; no share → null (mutation: `Math.floor` → the one-minute case reads 0 → FAILS). A rendered card with a shared row shows `renderedText` containing "Shared · expires in 18 h" inside `[data-document-shared]` exactly once, and in Spanish "Compartido · vence en 18 h" (mutation: render it for an expired link → FAILS); the card still has exactly ONE `data-variant="default"` (rule 8).
  - `documents-card-handlers.test.ts` (mock `./document-shares-actions`; stub `navigator.clipboard.writeText`; spy `toast.success`/`toast.error`): `copyShareLink` calls `createDocumentShareAction(ACC, doc.id)`, writes the url to the clipboard, toasts `"Link copied. It works for 24 hours."` (Spanish reader: `"Enlace copiado. Funciona por 24 horas."`) and reloads (mutations: the request's 7-day words; no reload → FAILS); a refusal toasts its key's words in the reader's language and writes nothing to the clipboard; a refused clipboard shows `documents.request.copyFailed`'s words with the url as the description (`duration: Infinity`). `stopSharing` calls `stopSharingAction`, reloads, toasts `"Stopped sharing Seguro."` with an Undo whose click calls `undoStopSharingAction(ACC, doc.id, ids, revokedAt)` with EXACTLY the stop's own answer (mutation: Undo with fresh ids → FAILS); an Undo answering `documents.share.ended` toasts its words; a second click while the first is in flight is ignored (the `once` lock).
  - `document-viewer.test.ts`: `DocumentViewerShare` renders ONE ghost button (`data-variant="ghost"`, `data-document-share`) "Copy share link" for a clean live doc with `onShare`; nothing without `onShare`, for each non-clean scan, and for a trashed doc (mutations: render it for `pending` → FAILS).
  - `documents-list.test.ts`: the list passes `onShare` to the viewer (render with an open row the way its existing viewer case does, or assert the prop through the file's own render helper; if the list's viewer is only reachable through state, assert with a structure pin that `onShare={(d) => void handlers.copyShareLink(d)}` is present in the source between the `<DocumentViewer` and its closing `/>`, both `indexOf`s asserted before slicing).
  - `documents-demo.test.ts`: `data-document-shared` count 1; every existing count unchanged.
- [ ] **Step 3: Run them to see them fail.**
- [ ] **Step 4: Implement.**
  - Handlers: `DocumentHandlers` gains `/** S-07 3b: makes a link to the file's current clean version and copies it. */ copyShareLink(doc: DocumentView): Promise<void>;` and `/** At once, with an Undo (rule 6). */ stopSharing(doc: DocumentView): Promise<void>;`. `copyLink(url)` becomes `copyLink(url: string, copiedKey: MessageKey = "documents.request.linkCopied")` (the request path unchanged). Add `const shareRow = (id: string) => \`share:${id}\`;` and:

```ts
    async copyShareLink(doc) {
      const r = await once(shareRow(doc.id), () => createDocumentShareAction(accountId, doc.id).catch(() => ({ ok: false as const, error: "documents.share.failed" })));
      if (!r) return;
      if (!r.ok) { say(r); return; }
      await copyLink(r.url, "documents.share.copied");
      reload();
    },
    async stopSharing(doc) {
      const r = await once(shareRow(doc.id), () => stopSharingAction(accountId, doc.id).catch(() => failed));
      if (!r) return;
      if (!r.ok) { say(r); reload(); return; }
      reload();
      // The Undo puts back exactly the links THIS stop wrote, at its instant (plan deviation 3).
      offer(tt("documents.share.stopped", { title: doc.title }), shareRow(doc.id), () => undoStopSharingAction(accountId, doc.id, r.ids, r.revokedAt));
    },
```
  - `documents-card.tsx`: `RowMenuItem`'s id union gains `"share" | "stopSharing"`; after the `download` push:

```ts
  // S-07 3b (spec 4.1): a clean file can be shared; a live link can be stopped. canOpen is the one "clean" predicate.
  if (canOpen(doc.version.scan)) items.push({ id: "share", labelKey: "documents.share" });
  if (now && shareHoursLeft(doc, now) !== null) items.push({ id: "stopSharing", labelKey: "documents.share.stop" });
```
    with the signature `rowMenuItems(doc: DocumentView, canManage: boolean, now?: string)`; the exported helper:

```ts
/** S-07 3b: whole hours left on the file's live link, rounded UP (one minute left reads "1 h"); null when none is live. */
export function shareHoursLeft(doc: Pick<DocumentView, "share">, now: string): number | null {
  if (!doc.share) return null;
  const ms = Date.parse(doc.share.expiresAt) - Date.parse(now);
  return ms > 0 ? Math.ceil(ms / 3_600_000) : null;
}
```
    `DocumentRow`'s `choose` gains `else if (item.id === "share") void handlers.copyShareLink(doc); else if (item.id === "stopSharing") void handlers.stopSharing(doc);` before the final `else`; the menu maps `rowMenuItems(doc, canManage, now)`; the facts line gains, after the Owners-only marker:

```tsx
            {shareHours !== null ? (
              <span data-document-shared className="inline-flex items-center gap-1 tabular-nums">
                <Link2 aria-hidden="true" className="size-3" />{tt("documents.share.live", { hours: shareHours })}
              </span>
            ) : null}
```
    with `const shareHours = shareHoursLeft(doc, now);` at the top of `DocumentRow`. The card's `<DocumentViewer` gains `onShare={(d) => void handlers.copyShareLink(d)}`.
  - `document-viewer.tsx`:

```tsx
/** S-07 3b (spec 4.1): the viewer's Copy share link, ghost (the dialog's one primary stays Download); only for a clean, live file. */
export function DocumentViewerShare({ doc, locale, onShare }: { doc: DocumentView; locale: Locale; onShare?: (doc: DocumentView) => void }) {
  if (!onShare || !canOpen(doc.version.scan) || doc.deletedAt !== null) return null;
  return (
    <Button type="button" variant="ghost" size="sm" data-document-share className="min-h-11 self-start md:min-h-8" onClick={() => onShare(doc)}>
      <Link2 aria-hidden="true" />{t(m, "documents.share", locale)}
    </Button>
  );
}
```
    `DocumentViewer`'s props gain `onShare?: (doc: DocumentView) => void`, and `<DocumentViewerShare doc={doc} locale={locale} onShare={onShare} />` renders inside `DialogHeader`, after `DialogDescription`.
  - `documents-list.tsx`: its `<DocumentViewer` gains `onShare={(d) => void handlers.copyShareLink(d)}`.
  - `styleguide/documents-demo.tsx`: `demoHandlers` gains `copyShareLink: async () => {}, stopSharing: async () => {}`; ONE existing clean demo document gains `share: { expiresAt: <the demo's own now + 18 h, built from the same constant the demo uses for now> }`.
- [ ] **Step 5: Run** every touched test plus `src/components/ui/material.test.ts`; `pnpm --filter web typecheck` (A5: `Link2`); eslint. PASS.
- [ ] **Step 6: Probes:** (a) `stopSharing` offered with no `now` check → the expired case FAILS; (b) `copyShareLink` toasting `documents.request.linkCopied` → the handler case FAILS; (c) `DocumentViewerShare` with `variant="default"` → the viewer case FAILS; (d) the Undo built from new ids → FAILS. Paste each.
- [ ] **Step 7: Commit** every path above, message "documents: Copy share link in the row menu and the viewer, 'Shared · expires in 18 h' on the card, Stop sharing with Undo (S-07 3b)".

---

## Task 9: The public page `/s/[token]` (bis-frontend)

**Review:** opus. **Runs beside:** Task 8.

**Files**
- Create: `apps/web/src/app/s/[token]/layout.tsx` (+ `layout.test.ts`), `page.tsx` (+ `page.test.ts`), `data.ts`, `copy.ts` (+ `copy.test.ts`), `share-download.tsx` (+ `share-download.test.ts`), `error.tsx` (+ `error.test.ts`)

**Interfaces**
- Consumes: `sharePage`, `SharePage`, `ShareState` (Task 5); `DOCREQ_CSS` (`app/d/[token]/docreq-css.ts`, reused so the two customer pages cannot drift); `PublicHtml`, `PublicBrand`, `publicFormTheme`, `parseHostMode` (as `app/d/[token]/page.tsx:1-11`); keys (Task 2).
- Produces: the page; `shareCopy(locale, business): ShareCopy`; `downloadOutcome(status: number, body: unknown): DownloadOutcome`; `ShareDownload` (client).

- [ ] **Step 1: Read** `apps/web/src/app/d/[token]/*` whole (every file and test: this tree is its twin), `apps/web/src/components/public/public-html.tsx`, `apps/web/src/lib/branding/public-form-theme.ts` (its signature).
- [ ] **Step 2: Failing tests** (copy `/d`'s test shapes; `vi.mock("./data")`, `vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }))`; `renderedText` for every copy assertion, the `<style>` stripped):
  - `page.test.ts`: `dynamic === "force-dynamic"`; an open Spanish page with a themed branding: `<main class="bis-docreq-page" lang="es"`, `data-tenant-theme=""`, the logo through `PublicBrand`, the heading "Casa Verde compartió un archivo con usted", the title in an element with `lang=""`, "Archivo PDF · 1.2 MB", ONE `[data-share-download]` button reading "Descargar", the phone line "¿Preguntas? Llame a Casa Verde al (956) 555-0123." and "Con tecnología de BIS" (mutations: `lang` from the reader; the account name; a second primary → FAILS); each refusal (`expired`, `revoked`, `trashed`, `removed`) in English shows its own sentence (`it.each` with the four literals: "This link has expired." (`customerDocs.expired`) and Task 2's `sharePage.revoked`, `sharePage.trashed`, `sharePage.removed`), "Ask Casa Verde to send it again.", the phone line, NO download button and NO file title (mutation: render the title on a refusal → FAILS); with no brand name, "A file was shared with you" / "Ask the business that sent it to send it again." / "Questions? Call the business at …" (never "{business}" or "the business shared"); `not_found` shows "This link doesn't work." (`customerDocs.notFound`) and NO phone line and NO business sentence; `generateMetadata` answers `robots: { index: false, follow: false }`, `referrer: "no-referrer"`, and the title "Un archivo de Casa Verde" for the Spanish page.
  - `copy.test.ts`: `shareCopy("es", null)("sharePage.heading")` → "Se compartió un archivo con usted"; `shareCopy("en", "Casa Verde")("customerDocs.call", { phone: "(956) 555-0123" })` → "Questions? Call Casa Verde at (956) 555-0123." (mutation: drop a NO_NAME line → FAILS).
  - `share-download.test.ts`: `downloadOutcome(200, { url: "https://x.supabase.co/storage/v1/object/sign/documents/a?token=t&download=f" })` → `go`; `(200, { url: "http://127.0.0.1:54321/…" })` → `go` (the CI stack); `(200, { url: "javascript:alert(1)" })` → `failed`; `(200, {})` → `failed`; `(410, …)` → `refresh`; `(429, …)` → `limit`; `(503, …)` → `failed` (mutation: accept any string url → FAILS). The component renders one `bis-docreq-primary` button with its label (rule 8).
  - `layout.test.ts`: `<html lang>` is the page's language, `en` when `loadPageSafe` answers null (copy `/d`'s).
  - `error.test.ts`: both languages stacked, each in its own `lang`, the retry button (copy `/d`'s).
- [ ] **Step 3: Run them to see them fail.**
- [ ] **Step 4: Implement.**
  - `data.ts`:

```ts
import { cache } from "react";
import { serviceDb } from "@bis/db";
import { sharePage, type SharePage } from "@/lib/document-shares/public-share";
import { loggableError } from "@/lib/loggable-error";

/** The page's one read, shared by layout, page and metadata through React's cache (the /d tree's shape). sharePage proves the token first. */
export const loadPage = cache((token: string) => sharePage(serviceDb(), token, new Date()));

/** For the layout and the metadata: never throws (a cached rejection would escape every error.tsx). Never logs the token. */
export const loadPageSafe = cache(async (token: string): Promise<SharePage | null> => {
  try {
    return await loadPage(token);
  } catch (e) {
    console.error(`shared file page: read failed: ${loggableError(e)}`);
    return null;
  }
});
```
  - `copy.ts`:

```ts
import { m, type MessageKey } from "@/lib/messages";
import { t } from "@/lib/i18n/t";

/** Each sentence that names the business has its own sentence for an account with NO brand name (app/d/[token]/copy.ts's rule). Browser-safe. */
const NO_NAME: Partial<Record<MessageKey, MessageKey>> = {
  "sharePage.pageTitle": "sharePage.pageTitleNoName",
  "sharePage.heading": "sharePage.headingNoName",
  "sharePage.ask": "sharePage.askNoName",
  "customerDocs.call": "customerDocs.callNoName",
  "customerDocs.callNoPhone": "customerDocs.callNoPhoneNoName",
};
export type ShareCopy = (key: MessageKey, params?: Record<string, string | number>) => string;
export function shareCopy(locale: "en" | "es", business: string | null): ShareCopy {
  return (key, params) => (business ? t(m, key, locale, { business, ...params }) : t(m, NO_NAME[key] ?? key, locale, params));
}
```
  - `share-download.tsx`:

```tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export type DownloadOutcome = { kind: "go"; url: string } | { kind: "refresh" } | { kind: "limit" } | { kind: "failed" };
/** The route's answer, as the button acts on it. Only an http(s) URL is followed. 410 re-reads the page into its refusal. */
export function downloadOutcome(status: number, body: unknown): DownloadOutcome {
  const url = typeof body === "object" && body !== null ? (body as Record<string, unknown>).url : undefined;
  if (status === 200) return typeof url === "string" && /^https?:\/\//.test(url) ? { kind: "go", url } : { kind: "failed" };
  if (status === 410) return { kind: "refresh" };
  if (status === 429) return { kind: "limit" };
  return { kind: "failed" };
}

/**
 * The one Download (spec 4.2): a fetch POST (not a form: a document request would meet Clerk's handshake
 * on /api for a signed-in visitor), then the browser goes to the 120 s URL, which downloads. Only the
 * token and the words cross to the browser. No spinner (rule 7): the button is disabled while it asks.
 */
export function ShareDownload({ token, label, limitText, failedText }: { token: string; label: string; limitText: string; failedText: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  async function onClick() {
    if (busy) return;
    setBusy(true);
    setNote(null);
    try {
      const res = await fetch(`/api/s/${encodeURIComponent(token)}/download`, { method: "POST", cache: "no-store", referrerPolicy: "no-referrer" });
      const o = downloadOutcome(res.status, await res.json().catch(() => null));
      if (o.kind === "go") window.location.assign(o.url);
      else if (o.kind === "refresh") router.refresh();
      else setNote(o.kind === "limit" ? limitText : failedText);
    } catch {
      setNote(failedText);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="bis-docreq-actions">
      <button type="button" className="bis-docreq-primary" data-share-download disabled={busy} aria-busy={busy} onClick={() => void onClick()}>{label}</button>
      {note ? <p role="status" className="bis-docreq-detail" data-share-note>{note}</p> : null}
    </div>
  );
}
```
  - `layout.tsx`: `/d`'s layout with `loadPageSafe` from `./data` and the comment naming `/s` (spec 4.2).
  - `error.tsx`: `/d`'s `error.tsx` verbatim but named `SharedFileError`, its comment naming `/s/<token>` (the `customerDocs.error.*` words are generic; reused).
  - `page.tsx`:

```tsx
import type { Metadata } from "next";
import { brandDisplayName, type Branding } from "@bis/db";
import { publicFormTheme, parseHostMode } from "@/lib/branding/public-form-theme";
import { PublicBrand } from "@/components/public-brand";
import type { MessageKey } from "@/lib/messages";
import type { ShareState } from "@/lib/document-shares/public-share";
import { DOCREQ_CSS } from "../../d/[token]/docreq-css";
import { loadPage, loadPageSafe } from "./data";
import { shareCopy } from "./copy";
import { ShareDownload } from "./share-download";
import "@/styles/public-brand.css";

export const dynamic = "force-dynamic";

const UNBRANDED: Branding = {
  brandName: null, brandLogoPath: null, brandColor: null,
  brandNeutral: null, brandCorners: null, brandType: null, brandMode: null,
  replyToEmail: null,
};
const REFUSAL: Record<Exclude<ShareState, "open">, MessageKey> = {
  // Review F10: expired and not-found are 2b's own sentences (customerDocs.*), shared by both customer pages.
  expired: "customerDocs.expired", revoked: "sharePage.revoked", trashed: "sharePage.trashed",
  removed: "sharePage.removed", not_found: "customerDocs.notFound",
};

/** Never indexed, no Referer on; the title in the account's language (spec 4.2; plan deviation 7). */
export async function generateMetadata({ params }: { params: Promise<{ token: string }> }): Promise<Metadata> {
  const { token } = await params;
  const page = await loadPageSafe(token);
  const business = (page?.branding && brandDisplayName(page.branding)) || null;
  return {
    title: shareCopy(page?.language ?? "en", business)("sharePage.pageTitle"),
    robots: { index: false, follow: false },
    referrer: "no-referrer",
  };
}

/**
 * `/s/<token>` (S-07 3b, spec 4.2): a shared file's page. No sign-in: the token is the proof, checked by
 * sharePage before anything else is read. On the client's brand (rule 9), in the ACCOUNT's language.
 * Open: the title, its type and size, one Download; nothing else about the customer. Refused: its own
 * sentence naming the business and how to reach it. A failed read throws to error.tsx.
 */
export default async function SharedFilePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const page = await loadPage(token);
  const lang = page.language;
  const business = (page.branding && brandDisplayName(page.branding)) || null;
  const tt = shareCopy(lang, business);
  const { style, darkCss, themed } = publicFormTheme(page.branding ?? UNBRANDED, false, parseHostMode(undefined));

  const body = page.state === "open" && page.file ? (
    <>
      <h1 className="bis-docreq-title" data-share-state="open">{tt("sharePage.heading")}</h1>
      <p className="bis-docreq-label" lang="">{page.file.title}</p>
      <p className="bis-docreq-detail" data-share-file>{tt("sharePage.details", { type: page.file.type, size: page.file.size })}</p>
      <ShareDownload token={token} label={tt("sharePage.download")} limitText={tt("sharePage.limit")} failedText={tt("sharePage.failed")} />
    </>
  ) : (
    <>
      <h1 className="bis-docreq-title" data-share-state={page.state}>{tt(page.state === "open" ? "customerDocs.notFound" : REFUSAL[page.state])}</h1>
      {page.state === "not_found" ? null : <p className="bis-docreq-detail">{tt("sharePage.ask")}</p>}
    </>
  );

  return (
    <main className="bis-docreq-page" lang={lang} style={style} {...(themed ? { "data-tenant-theme": "" } : {})}>
      {darkCss ? <style>{darkCss}</style> : null}
      <style>{DOCREQ_CSS}</style>
      <PublicBrand name={business} logoUrl={page.logoUrl} />
      <div className="bis-docreq">
        {body}
        {page.state === "not_found" ? null : (
          <p className="bis-docreq-call">
            {page.phone ? tt("customerDocs.call", { phone: page.phone }) : tt("customerDocs.callNoPhone")}
          </p>
        )}
        <p className="bis-docreq-poweredby">
          <a href="https://bis-rgv.com" target="_blank" rel="noopener noreferrer">{tt("customerDocs.poweredBy")}</a>
        </p>
      </div>
    </main>
  );
}
```
  (Read `/d`'s imports for `PublicBrand`'s and `public-brand.css`'s exact paths and use them; the code above copies `/d/[token]/page.tsx:1-11`.)
- [ ] **Step 5: Run** every new test; `pnpm --filter web typecheck`; eslint on the tree. PASS.
- [ ] **Step 6: Probes:** (a) the refusal branch rendering `page.file?.title` → the refusal case FAILS; (b) `lang` hard-coded `"en"` → the Spanish case FAILS; (c) `downloadOutcome` following any string → FAILS; (d) the not-found page with the phone line → FAILS. Paste each.
- [ ] **Step 7: Commit** `git add --` the twelve new files, then `git commit -m "documents: the shared file's page, on the business's brand in its language, with one Download and a plain page for every link that no longer works (S-07 3b)" -- <the twelve files>`.

---

## Task 10: Regenerate the i18n baselines (bis-crm)

**Review:** sonnet (or orchestrator-checked if byte-identical).

- [ ] **Step 1.** After Tasks 2, 4, 8 and 9 have committed: `pnpm --filter web exec tsx scripts/generate-i18n-baseline.ts` (the script `ratchet.test.ts:6` names). Expected: byte-identical, or ONLY reductions. If the generator ADDS any count or frozen key, STOP: a task admitted a violation; report the file and the string.
- [ ] **Step 2.** `pnpm --filter web exec vitest run src/lib/i18n/ratchet.test.ts src/lib/messages.test.ts` → PASS. Commit the two baseline files if changed, message "i18n: baselines after S-07 3b".

---

## Task 11: The e2e spec (bis-e2e-qa)

**Review:** sonnet. **Runs:** never by the agent (the orchestrator runs Playwright).

**Files**
- Create: `apps/web/e2e/document-shares.spec.ts`

- [ ] **Step 1: Read** `apps/web/e2e/documents-scan.spec.ts` whole (the card upload helper, the fake clamd's clean file, `versionOf`, the `afterAll` that removes objects and rows and re-reads), `apps/web/e2e/document-requests.spec.ts:100-200` (clipboard permissions and focus, the anonymous `browser.newContext({ storageState: { cookies: [], origins: [] } })`), `apps/web/e2e/support.ts:100-135` (`readClientFixture`, `recordPage`), `apps/web/playwright.config.ts:150-185`.
- [ ] **Step 2: Write the spec.** `import { test, expect, type Page } from "./fixtures/test"` (never `@playwright/test`). `import { serviceDb, DOCUMENT_BUCKET } from "@bis/db"; import { tokenHash } from "../src/lib/document-requests/token"; import { m } from "../src/lib/messages";`. `test.describe.configure({ mode: "serial", timeout: 180_000 })`. `STAMP = \`Share3b${Date.now()}\``. `beforeAll`: `readClientFixture()` (throw if missing); READ the account's `language` (service client) as `lang`; one contact `{ firstName: "Lia", lastName: STAMP }` (refuse `existing`). Every test starts with `page.goto(…)`. Words come from `m` in `lang` (`m[key]` for en, `m[\`${key}.es\`]` for es), never hard-coded.
  1. **Copy share link** (spec 6 "share: copy"). On the contact's page, upload `${STAMP}.pdf` through the card (documents-scan's helper, the fake clamd's CLEAN content) and wait until its row has no `[data-document-scan]`. `page.context().grantPermissions(["clipboard-read", "clipboard-write"])`. Row menu (scoped: `[data-document-row="<docId>"]`'s menu button) → "Copy share link". The toast reads `documents.share.copied`. Clipboard (focus first, as `document-requests.spec.ts:152-155` does) matches `^<BASE_URL>/s/[A-Za-z0-9_-]{43}$`; keep the token. The database holds exactly one `document_shares` row for the document, its `token_hash = tokenHash(token)`, its `version_id` = the document's `current_version_id`, `expires_at − created_at` = 24 h, `first_opened_at` null, `open_count` 0. The row's `[data-document-shared]` reads `documents.share.live` with `hours: 24`. The timeline holds ONE `[data-timeline-item="documentShared"]` naming `${STAMP}` with the person mark "You" (`provenance.you`).
  2. **Open in a fresh context, download** (spec 6). `const anon = await browser.newContext({ storageState: { cookies: [], origins: [] } })`; `const res = await p.goto(\`/s/${token}\`)`; `res.headers()["cache-control"]` contains `no-store`, `["referrer-policy"]` is `no-referrer`, `["x-robots-tag"]` contains `noindex` (A1). The page shows the file's title, `[data-share-file]`, ONE `[data-share-download]`; `<main lang>` = `lang`. **The page load counted nothing:** `first_opened_at` null, `open_count` 0. `const [dl] = await Promise.all([p.waitForEvent("download"), p.click("[data-share-download]")])` (A4); `dl.suggestedFilename()` is `${STAMP}.pdf`. Then `first_opened_at` set and `open_count` 1. Download again: `open_count` 2 and `first_opened_at` unchanged.
  3. **The timeline row** (spec 6). Staff's contact page: exactly ONE `[data-timeline-item="documentShareOpened"]`, its text naming `${STAMP}` and the mark `provenance.linkRecipient` (O1 (a)).
  4. **Stop sharing, the revoked page, uniform refusals** (spec 6). Row menu → "Stop sharing"; the toast reads `documents.share.stopped` with the title; the share's `revoked_at` is set; the row has no `[data-document-shared]`. Anonymous `p.goto(\`/s/${token}\`)` (never `reload`): `[data-share-state="revoked"]` reads `sharePage.revoked`, no `[data-share-download]`. `anon.request.post(\`/api/s/${token}/download\`)` → 410 `{ error: "unavailable" }`; the same POST with a random 43-character token → 410 and a body EQUAL to the first (deviation 6).
  5. **Undo.** Back on staff, Stop sharing again is not offered; trigger a fresh share and stop it, then click the toast's Undo → that share's `revoked_at` is null again and the anonymous page shows `[data-share-download]` again.
  `afterAll`: remove the stored objects of every version of the spec's documents (`DOCUMENT_BUCKET`, check the error), delete the documents (their shares and downloads cascade), then the contact; check every `error`; re-read that no `document_shares` row for those documents and no document is left; close the anonymous context.
- [ ] **Step 3:** `pnpm --filter web exec playwright test --list e2e/document-shares.spec.ts` lists the five tests (listing loads every import; if it fails, STOP and report). `pnpm --filter web typecheck` (covers `e2e/`). `pnpm --filter web exec eslint e2e/document-shares.spec.ts`. Commit `git add -- apps/web/e2e/document-shares.spec.ts` then `git commit -m "e2e: share a clean file, open and download it with no sign-in, the timeline's first-open row, Stop sharing, the revoked page and Undo (S-07 3b)" -- apps/web/e2e/document-shares.spec.ts`.

---

## Task 12: DESIGN.md Provenance line (orchestrator; ruling O1, Wave A)

- [ ] **Step 1.** DESIGN.md, "Record page, documents and provenance" › **Provenance**, appended after the "Someone on the team" sentence:

> **Amended 2026-10-18 (S-07 part 3b):** whoever opens a shared file's link is not known to be the customer, so that row's mark is the CUSTOMER kind labelled "The link's recipient" ("Quien recibió el enlace") — a second word inside one kind, as "Someone on the team" is inside the person kind; never a sixth kind.

- [ ] **Step 2.** Commit `git commit -m "docs: DESIGN.md names the link's recipient as a customer-kind mark (S-07 3b, O1)" -- DESIGN.md`.

---

## Task 13: Whole-branch final review (checkpoint, not an implementer task)

**Reviewer:** opus, fresh context. Runs after Tasks 1–12.

- [ ] **Step 1.** Read spec §2 E3, §4, §5–§7 (3b parts), this plan's rulings (O1–O3, R-V) and deviations, then `git diff 38fc8776...HEAD` in `<WT>`; walk "Spec coverage" below row by row against the diff.
- [ ] **Step 2.** Web tests by path: every test file Tasks 2 and 4–9 touched, plus `src/lib/i18n/ratchet.test.ts`, `src/lib/messages.test.ts`, `src/components/ui/material.test.ts`, `src/lib/documents/read-gate.test.ts`, `"src/app/(dashboard)/dashboard/accounts/[accountId]/in-account-service-reads.test.ts"`, `src/proxy.test.ts`, `src/next-config.test.ts`; `pnpm --filter web typecheck`. The db suites on your own replica (Postgres `55641`, PostgREST `55648`, gateway `55649`): `document-shares-schema.test.ts`, `schema-grants-guard.test.ts`, `document-vault-schema.test.ts`, `document-vault-rls.test.ts` on `post`; `document-shares.test.ts`, `record.test.ts`, `timeline-merge.test.ts`, `documents.test.ts` behind PostgREST. Re-run two probes of your own choosing, by name. Re-run Task 1's byte check and md5 (must equal Task 1's).
- [ ] **Step 3.** Hunt specifically: (a) any public read or write that takes an id from the request instead of the token row, or misses `account_id`, the document or the version; (b) a refusal answer that differs by state, a token or link in any log line, an error body naming an id; (c) a page or route answer missing one of the three headers; a page state that reveals more than its sentence; the open page showing anything but title, type, size; (d) 0085: ASCII, no backslash, no lone `$`, `lock_timeout` first, both FKs composite and cascading, the expiry and coherence checks, no client write grant, the claim's lock, its clean/trash/expiry/revoke checks, the rate count keyed on share AND address, the view `security_invoker` and SELECT-only, the rollback order; (e) a staff write before the request-client read, or on the request client; Owners-only shared by Staff; the shared version not the CURRENT one; the Undo restoring someone else's stop or an expired link; (f) a page load that claims; "first" decided outside the lock; (g) the author mark a sixth kind, or the swap reaching any other row; (h) rule 6 (Stop sharing at once, Undo in the toast), rule 7 (no spinner), rule 8 (one primary on the card, the viewer, the public page), rule 9 (logo, colour, Powered by BIS), copy in tú, vendor words, `accounts.name` on the public page; (i) a test that cannot fail (memory "Vacuous test shapes"); (j) the e2e touching anything but the per-run fixture account. (k) ruling R-V: a share whose version is not the one documentView shows, or a version id taken from the browser; (l) ruling O2: an Owners-only switch (or an Undo writing it back) that leaves a live link, a revoke before the write or on the request client, an Undo of Owners only that un-revokes; (m) ruling O3: the per-link cap missing, counted per address, or recording a download it refused.
- [ ] **Step 4.** Report findings by severity with file:line; the orchestrator routes fixes to the owning task's agent. **0085 goes to bis-ci only when this review approves it UNCHANGED.**

---

## Task 14: Rollout (orchestrator; LAST; not a coding task)

Each step reads its own evidence; nothing is inferred from an earlier run.

- [ ] **Step 1. The rulings** O1–O3 and R-V (2026-10-18) are in the ledger, and every change they named has landed and been reviewed.
- [ ] **Step 2. bis-ci** (only AFTER Task 13 approves 0085 unchanged): `gh workflow run ci-project-setup.yml -f step=push-dry-run --ref feat/s07-vault-3b` → its log lists exactly `0085_document_shares.sql`; then `-f step=push`. Post-apply, read-only through MCP `execute_sql` on `odnobiodsftffphuuosz`: `select relname from pg_class where relname in ('document_shares','document_share_downloads','document_share_timeline') order by 1` → all three; `select conname from pg_constraint where conname in ('document_versions_account_document_id_key','document_shares_expiry','document_shares_version_fkey','document_shares_document_fkey') order by 1` → all four; `select has_function_privilege('authenticated','public.claim_document_share_download(uuid,uuid,text,integer,integer,integer)','execute')` → `f`; the Faithfulness digest on bis-ci is UNCHANGED from Task 0 (0085 adds no client write). From here on the `@bis/db` suites may run against bis-ci again.
- [ ] **Step 3. Push and CI.** Until Step 2, `e2e` is red on its migration check by design (0085 not on bis-ci); after Step 2, re-run and read `verify` and `e2e` ON THE HEAD SHA (`gh api repos/{owner}/{repo}/commits/<sha>/check-runs`). The e2e share spec must have run (spec §7). A CI-vs-local disagreement is an environment finding first (memory "CI vs local divergence").
- [ ] **Step 4. Production** (MCP on `tlbkbmlrfafquucsmsmm`): read-only pre-flight `select max(version) from supabase_migrations.schema_migrations` → the 0084 apply; then `apply_migration` with 0085's exact text, ONCE (Task 1 step 6 proved no backslash and no lone `$`; the text's md5 equals Task 1's). Additive, and the code needs it, so it goes BEFORE the merge (spec §7: migration before code deploy). Ledger line: `0085 APPLIED <date> on bis-ci and production — NEVER RE-APPLY`.
- [ ] **Step 5. Parity.** `docs/runbooks/ci-supabase-project.md` §5: `fingerprint.sql` on both projects; the three relations, the constraints, the function's ACL and body, the view's definition and options, and the grants are equal; the client-write digest is equal on both.
- [ ] **Step 6. Gates, one at a time:** `pnpm check`, `pnpm --filter web build`, `pnpm --filter web test:e2e` (check no `screenshots.yml` run is in progress first).
- [ ] **Step 7. Preview, by hand (owner and orchestrator together)**, on the branch's Preview (bis-ci), on a test account (never Test Client One): share a clean file from the card and from the Documents page's viewer; the "Shared · expires in 24 h" line; open the link in a private window (both themes of the tenant, a phone width, the Spanish account); Download; the timeline's two rows; Stop sharing and the revoked page; Undo. Delete what you made.
- [ ] **Step 8. Merge** through the PR, after the head SHA's `verify` and `e2e` are green and Task 13's findings are closed: `gh pr merge <n> --squash --match-head-commit <sha>` (pinned to the reviewed head; never `--auto` without the pin). The PR body names: the rulings O1–O3 and R-V; that repeated Copy share link on one file makes one link and one "shared" timeline row per press, accepted (review F12, deviation 3); deviations 1–12; the pinned tests changed; "Not in this PR"; the Preview results; the 0085 apply lines.
- [ ] **Step 9. After the deploy** (spec §7, owed): the deploy reads READY on the merge SHA. **Production smoke on an AGENCY-owned record:** upload or pick a clean file; Copy share link; open it in a private window; Download; the record's timeline shows "You shared …" and "The link's recipient opened …"; Stop sharing; the private window's reload shows the revoked page. Tracker: item 6 / F-005 → `done`, "part 3b (share links) shipped #<n>".

---

## Spec coverage

| Spec | Where |
|---|---|
| §1 3b row: share links, 24 h, revocable, view-tracked, one version of one file, 0085 | Tasks 1, 3, 5, 6, 8, 9 |
| §1 "Not in part 3": lifetime fixed, no multi-file/zip, no model reads a document | "Not in this PR"; `DOCUMENT_SHARE_HOURS` and 0085's CHECK |
| E3 anyone who can see the file; Owners-only by Owners and the agency; ONE version; 24 h; revocable; scan-clean and untrashed only; first open a timeline row; 2b's token pattern | Task 6 (proof, role, current version, clean, trash), Task 1 (CHECK, claim), Task 4 (row), Task 5 (`isTokenShape`, `tokenHash`) |
| §4.1 Copy share link in the row menu and the viewer header; Documents page | Task 8; deviation 2 (the page through the viewer) |
| §4.1 RLS read through the request client first; Owners only for Owners and agency | Task 6 (`provenDocument`), Task 1 (RLS) |
| §4.1 refused for trashed and not-clean, plain copy | Task 6; deviation 8 |
| §4.1 amendment (R-V): the version the reader sees, computed on the server | Task 3 (`shareableVersion`, `listReadyVersionScans`), Task 6 (case 1b); deviation 9 |
| §4.1 amendment (O2): Owners only stops every live link; undoing it never un-revokes | Task 6 (`setOwnersOnlyAction`, `undoOwnersOnlyAction`) |
| O3: a per-link total cap of 100 downloads | Task 1 (`p_link_max`), Task 3 (`linkMax`), Task 5 (`SHARE_LINK_MAX_DOWNLOADS`) |
| §4.1 random token, sha256 stored, `${APP_ORIGIN}/s/${token}`, toast "Link copied. It works for 24 hours." | Task 5 (`newShareToken`, `shareUrl`), Task 6 (`originFrom`, `tokenHash`), Tasks 2, 8 |
| §4.1 "Shared · expires in 18 h" with Stop sharing; at once; Undo compare-and-set on `revoked_at` while unexpired | Tasks 3 (`revokeDocumentShares`, `restoreDocumentShares`), 6, 8; deviation 3 |
| §4.1 timeline "Ana shared …" (person mark); revoking is not a row | Task 4; deviation 4 |
| §4.2 Clerk bypassed; service client with explicit account, document and version from the token row | Task 7 (proxy), Task 5 (`resolveShare`, `getShareTarget`, the claim, the mint) |
| §4.2 page: logo, name, brand colour; title, type, size; one Download → POST route; re-prove; 120 s URL for the shared version; no other customer data; Powered by BIS | Tasks 5, 9 |
| §4.2 refusal pages: expired, revoked, trashed, infected-or-removed, each naming business and phone; never says whether a token exists | Tasks 5, 9; deviation 6 |
| §4.2 Cache-Control no-store, Referrer-Policy no-referrer, X-Robots-Tag noindex | Task 5 (route), Task 7 (`next.config.ts`), Task 9 (`dynamic`, metadata); deviation 7; Task 11 test 2 |
| §4.2 rate limiting reusing the forms/upload-link limiter keyed on IP + token hash; the plan names it | Task 1 (`document_share_downloads`, the claim), Task 5 (`clientIp`, `hashIp`, `RATE_LIMIT_MAX`, `RATE_LIMIT_WINDOW_MS`); deviation 1; O3 |
| §4.3 first successful Download (not page load) sets `first_opened_at` by compare-and-set; that win adds the row; later downloads increment `open_count` | Task 1 (the claim under the lock), Task 5 (claim only on Download), Task 4 (the opened row); deviation 5 |
| §4.3 the mark "the customer" kind worded as the recipient; checked against the closed set; raised to the owner | ruling O1; Task 4; Task 12 |
| §4.4 columns, composite FKs on account, `token_hash` unique, expiry CHECK, coherent revoke pair, `open_count` default 0 | Task 1; deviation 11 |
| §4.4 RLS via documents under the reader's RLS; server-only writes; no client write grants | Task 1 |
| §4.4 teardown and fixture sweep list the table | Task 1 step 5b; deviation 12 |
| §5 every string in the catalogue, English and Spanish (usted); the public page in the account's language then English; pseudo-locale at 360 px; `lang` | Task 2; Task 5 (`accountLanguage`); Task 9 (`lang`, layout); Task 14 step 7 |
| §6 0085 RLS (Staff never an Owners-only file's shares; a Technician only assigned customers'); no client write grants | Task 1 |
| §6 token isolation: never another account's, document's or version's rows; expired, revoked, trashed refuse page and download; a share before a new version serves its own; first-open once under concurrency | Task 1 (FKs, claim, lock), Task 3 (cases 3, 4), Task 5 (cases 3–5), Task 11 |
| §6 e2e: copy, open in a fresh context, download, timeline row, Stop sharing, revoked page | Task 11 |
| §6 mutation probes run by each reviewer | every task's probe step; Task 13 step 2 |
| §7 0085 bis-ci → production → parity; migration before code; e2e share spec on CI; tracker done; the production smoke | Task 14 |

## Self-review notes (the writer's own pass, 2026-10-18)

- **Spec coverage:** every §4 bullet maps to a row above. Where the code made the spec's words impossible or ambiguous: deviations 1–12, each with the file:line that decided it; the author mark went to the owner and is ruling O1, not an invented kind.
- **Placeholder scan:** no TBD/TODO. The values a test pins were read off the source on 2026-10-18 (author-mark.test.ts's `ctx`/`makeTr`, `:32-33`; `formatMb`'s es-US output `1.2`, run with node; "Insurance", "In the trash"). Two steps carry a read-then-adapt rule (`listPhoneNumbersForAccount`'s row field names; the documents list's viewer test, through a render or a structure pin), each keeping the assertion's meaning fixed. Task 1's lock test names the one place its seed must not use `attempt` (no transaction on a committed connection).
- **Type consistency:** `DocumentShareRow`, `DocumentShareLife`, `documentShareState`, `ShareTarget`, `getShareTarget`, `createDocumentShare`, `findDocumentShareByTokenHash`, `listLiveDocumentShares(db, accountId, record, now)`, `revokeDocumentShares`, `restoreDocumentShares(db, { …, revokedAt, actorId, now })`, `claimDocumentShareDownload(db, { accountId, shareId, ipHash, max, windowSeconds })`, `ShareClaim`, `listDocumentShareTimeline`, `TimelineDocumentShare` (Task 3) → Tasks 4, 5, 6; `newShareToken`, `shareUrl`, `resolveShare`, `sharePage`, `SharePage`, `ShareState`, `shareDownload`, `shareSize`, `shareFileName`, `SHARE_URL_SECONDS` (Task 5) → Tasks 6, 9; `createDocumentShareAction`, `stopSharingAction`, `undoStopSharingAction`, `DocumentView.share`, `documentView(…, shareExpiresAt)` (Task 6) → Task 8; `copyShareLink`, `stopSharing`, `rowMenuItems(doc, canManage, now?)`, `shareHoursLeft`, `DocumentViewerShare`, `onShare` (Task 8) → Task 11's selectors; `documentShared`, `documentShareOpened`, `provenance.linkRecipient` (Tasks 2, 4) → Task 11; markers `data-document-shared`, `data-document-share`, `data-share-download`, `data-share-state`, `data-share-file`, `data-timeline-item="documentShareOpened"` → Task 11.
- **Vacuity pass:** every prescribed test names its mutation; copy is asserted in both languages against literals; the isolation cases assert the exact ids passed, not "was called"; the uniform-refusal case compares whole answers; the lock is proven by a lock timeout, not by timing; Task 1's byte check has a positive control; the route's header case fails on any one header dropped.
- **Revision 2026-10-18:** O1 (Task 12 unconditional), O2 (Task 6, `setOwnersOnlyAction`/`undoOwnersOnlyAction`), O3 (`p_link_max` = 100 through Tasks 1, 3, 5), R-V (Tasks 3, 6; deviation 9 replaced); F1 (the lock test is an outcome test: two concurrent claims, `pg_stat_activity` shows B waiting, B's answer checked at limits 1 and 5), F2 (`scanned_at = now()` in `cleanVersion`), F4 (cascade mutation names both FKs and the downloads FK), F5 (probe (d) rests on trigger order, the run settles it), F6 (Task 5 case 3's mock answers a different version id), F7 (the `first` flag logs one id-only line, case 6b), F9 (the Vercel request-log residual named in Global Constraints and `share-token.ts`), F10 (`customerDocs.expired`/`notFound` reused; `documents.share.refused` added), F11 (Task 7 step 3), F12 (the PR body).
- **Not executed:** nothing in this plan was run; every name was read off `38fc8776` except where an Assumption says otherwise (A1–A6), each with its check.
