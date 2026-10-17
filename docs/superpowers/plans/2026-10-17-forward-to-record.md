# Forward to a record, and never record (S-06 part 2, migration 0083), implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every customer's existing reply address doubles as a **forwarding address**, shown on the record's "who they are" column with Copy; mail a teammate forwards to it (anyone with a membership in the account, any role, or the account's own reply-to mailbox, AND Resend's forgery check passing; BIS agency staff are NOT the team, owner ruling G1) files on that customer's thread as the teammate's message (the person mark, "Forwarded by Maria · team", no unread, no owner copy, no stop); automatic mail (out-of-office, auto-responders, bounces; a teammate's automatic forwarding rule excepted, ruling G10) and mail from an account's **Never record** list (addresses or whole domains, edited by the agency on Settings and by Owners on Branding, Add/Remove with Undo) is dropped before anything is stored.

**Architecture:** One migration, **0083**: a server-written `inbound_never_log` table (members read, agency all, a Technician nothing). `@bis/db` gains `never-log.ts` (list, add, remove), a pure subpath module `never-log-rules.ts` (parse a pattern, match a sender), `matchTeamSender` in `inbound-email.ts` (account members and the reply-to mailbox), and an explicit `author` override on `createMessage`. The web adds a pure automatic-mail detector (with a class for a lone `Auto-Submitted: auto-forwarded`, ruling G10), three new steps in the part 1 pipeline (automatic → dropped unless it is a teammate's forwarding rule, never record → dropped, team → the forward path) with `file.ts` learning the forward path, two shared server actions with a plain handler module, one shared client list component rendered in Settings' Sending address card and in its own card on Branding, a Forwarding address row in the record's Details card, and a "Forwarded by" line on the thread's bubble.

**Tech Stack:** Postgres 17 (Supabase) migration; supabase-js; Next.js 16 App Router (server actions, server components); React 19; vitest 4 (`renderToStaticMarkup`, no DOM; `vi.mock`); sonner toasts; the `@bis/db` suites on a local PG18 replica (plus a local PostgREST for service-client functions) and CI `verify`; Playwright on the per-run fixture account.

**Spec:** `docs/superpowers/specs/2026-10-17-forward-to-record-design.md` (approved 2026-10-17, commit `fa6e48b0`; the source of truth; this plan does not re-decide it, and every place the code forces a choice the spec does not make is a row in "Spec gaps" below, for the owner). Part 1's plan, merged as #264: `docs/superpowers/plans/2026-10-16-inbound-email.md`. Base: branch `feat/s06-forward-to-record` at `fa6e48b0` (on `main` at `09496978`, #265; migrations through **0082** are on `main`; **0082 is applied on bis-ci and production: never re-apply**). Every file:line below was read off this worktree at `fa6e48b0`; anything not read is labelled **ASSUMPTION**.

`<WT>` = `C:\Users\danlo\bis-platform\.claude\worktrees\s06-1` (Git Bash: `/c/Users/danlo/bis-platform/.claude/worktrees/s06-1`), branch `feat/s06-forward-to-record`. `<SCRATCH>` = `C:\Users\danlo\AppData\Local\Temp\claude\C--Users-danlo-bis-platform\16ea02fa-4bbf-472b-babe-a260f83c4097\scratchpad` (Git Bash: `/c/Users/danlo/AppData/Local/Temp/claude/C--Users-danlo-bis-platform/16ea02fa-4bbf-472b-babe-a260f83c4097/scratchpad`); write it out literally in every command. `<KIT1>` = `<SCRATCH>/s06-kit` (part 1's kit, read 2026-10-17: `replica.sh` skips `*0082_*` and applies `0082_inbound_email.sql` as `post`; `pgrst.sh` takes `PG PR GW DIR` and copies `postgrest.exe`, `make-jwt.js`, `proxy.mjs` from `/c/Users/danlo/AppData/Local/Temp/claude/C--Users-danlo-bis-platform/db21dcfe-6aee-47cd-8939-ff4f82a45810/scratchpad/s07-t3-impl`). `…/acct/` = `apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/`. `…/conv/` = `…/acct/conversations/`. `…/settings/` = `…/acct/settings/`. `…/record/` = `…/acct/contacts/[contactId]/`.

## External facts and assumptions (read before any task)

**Read in the code at `fa6e48b0`:**
- Agency staff are NOT in `public.users`. The Clerk webhook skips them: `apps/web/src/app/api/webhooks/clerk/route.ts:70-72` ("an agency user (app_role: "agency_admin") is never synced into a client team's `users` row"), and no code writes a `memberships` row with `scope = 'agency'` (`grep -rn "scope: \"agency\"" packages/db/src apps/web/src` → nothing; `team.ts:109` writes `scope: "account"` only). Agency identity is the Clerk `public_metadata.app_role === "agency_admin"` (`packages/db/src/team.ts:75`, `isAgencyMetadata`). This was gap **G1**; the owner RULED 2026-10-17 that the agency is not "the team", so nothing in this plan looks agency staff up.
- Every person column stores the **Clerk user id**, not `users.id`: `apps/web/src/lib/record/author-mark.ts:6-7` ("`viewerId` is the signed-in person's Clerk id … the same id every person column stores"); `listPeopleNames(db, clerkUserIds)` (`packages/db/src/record.ts:426-441`) names them from `users` (gap **G2**).
- `messageAuthor(actorType, actorId, direction)` (`packages/db/src/provenance.ts:19-24`) answers `customer` for EVERY inbound message; `createMessage` (`packages/db/src/messaging.ts:136-158`) always uses it (gap **G3**). 0073's CHECK `messages_author_id_person` allows `author_id` only with `author_kind = 'person'` (`0073_record_provenance.sql:56-57`); 0074 made `author_kind` NOT NULL.
- The inbox thread reads `listMessages` with `MESSAGE_COLS` (`messaging.ts:75-76`), which carries `meta` and no author columns (gap **G4**).
- `app.sees_all_customers(p)` = agency OR the caller's role in `('owner', 'staff')` (`0068_mine_unassigned_technician.sql:75-78`).
- The Branding page admits Owners AND staff (`requireNotTechnician`, `…/acct/branding/page.tsx:55`; `lib/auth.ts:125-132`); `requireAccountOwner` admits the agency and an Owner and redirects anyone else (`lib/auth.ts:70-77`); `canManage` is `true` for the agency and an Owner (`lib/auth.ts:44,60`).
- The Branding panel's "where your customers' replies go" line sits INSIDE the branding `<form>` (`components/branding-panel.tsx:231` opens it, `:281-284` the line, `:526` closes it). Settings' Replies row is OUTSIDE the Sending address card's form (`…/settings/sending-address-card.tsx:253`, after the form closes) (gap **G6**).
- `replyAddressFor(token, settings)` lives in `apps/web/src/lib/email/inbound/address.ts:85-89` (the email gate imports it from there, `lib/consent/email-gate.ts:5`).
- `emailKey` is NOT exported from `@bis/db`'s index (`grep -n emailKey packages/db/src/index.ts` → nothing); it lives in `packages/db/src/contacts.ts:198-203`.
- The pipeline already parses the raw header block (`pipeline.ts:176`, `parseHeaderBlock(email.rawHeaders ?? "")`), which is the TOP-LEVEL header block only (`auth-results.ts:9-23` stops at the first blank line), so the top-level `Content-Type` is in it.
- **Production's `RESEND_API_KEY` is a Full access key** (confirmed by the 2026-10-17 production smoke and #265's runbook change; part 1's A1/A2 both verified on a real Gmail reply). This part fetches nothing new from Resend.

**ASSUMPTIONS (each has a named check):**
- **A1** A hand forward from Gmail or Outlook carries none of the automatic markers at its top level (`Auto-Submitted`, `X-Autoreply`/`X-Autorespond`/`X-Autoresponse`, `Precedence: auto_reply|bulk|junk`, `multipart/report; report-type=delivery-status`). Check: Task 12 step 8 (the forward files, not dropped).
- **A2** A Gmail vacation reply carries `Auto-Submitted: auto-replied` (RFC 3834), and an Outlook/Exchange automatic forwarding rule carries `Auto-Submitted: auto-forwarded` and nothing else from the automatic list (the basis of ruling G10). Check: Task 12 step 8, optional (a vacation responder on a test mailbox, its reply dropped with the "automatic" log line; a member's forwarding rule, filed).
- **A3** A teammate's forward passes part 1's `senderAuthenticated` exactly as a customer's reply does (their own domain's DMARC, or `dmarc=none` with SPF and DKIM on the From domain). Check: Task 12 step 8; a teammate on a domain with neither is held `unverified` (spec failure table, "as part 1"), which is safe.

## Spec gaps and contradictions (RULED by the owner, danlo, 2026-10-17, tiles: G1 and G10 CHANGED as their rows say; G2–G9 and G11–G18 ACCEPTED as proposed; the spec is amended to match; implementers do not re-ask)

| # | What the spec said / omitted | What the code says | Ruled 2026-10-17 |
|---|---|---|---|
| G1 | "a user with the agency role" is on the team (§3) | Agency staff have no `users` row and no `memberships` row (above); only Clerk knows who they are | **RULED: the agency is NOT on the team.** The team is anyone with a membership in the account (any role) plus the account's `reply_to_email` mailbox, answered by `matchTeamSender` alone (`{ userId } \| { mailbox: true } \| null`). No Clerk lookup, no timeout, no extra 503. A forward from BIS agency staff is held in Needs a look (`not_on_record`, or `unverified` when the forgery check fails) like any non-team sender. Spec Decision 2 and §3 amended. |
| G2 | "`author_id` = the matched user's id" | Person columns hold the Clerk id (above) | **Accepted:** `author_id` = the member's `users.clerk_user_id`; null for the reply-to mailbox, as the spec says. |
| G3 | "`author_kind='person'`" on an inbound message | `createMessage` maps every inbound to `customer` | **Accepted.** `NewMessage` gains an optional `author: { kind: "person"; id: string \| null }`; when set, `createMessage` writes it instead of `messageAuthor`'s answer. Only `file.ts`'s forward path sets it; every other writer is unchanged, and `messageAuthor`'s SQL twin (`provenance-parity.test.ts`) is untouched. |
| G4 | the bubble reads "Forwarded by Maria · team" | the thread's reader has no author column | **Accepted.** `meta.forwarded = true` (the spec) PLUS `meta.forwarded_by = <Clerk id or null>`, so the inbox keeps `MESSAGE_COLS` (pinned) and names the forwarder with ONE `listPeopleNames` read on the request client. The record timeline needs nothing new: its author mark already names a person row from `author_id`. |
| G5 | "a Resend retry … (stateless)" for drops; silent on a retried FORWARD | part 1's resume path (`pipeline.ts:37-65`) re-files a recorded row as a customer reply: unread raised, owner copy sent, the stop rule run | **Accepted.** A webhook-filed forward's `inbound_emails.decided_by` is `"email-inbound-forward"` (no schema change; `decided_by` is free text, `0082`'s coherence CHECK only pairs it with `decided_at`). A retry reads that marker, re-runs the team lookup for the author (null if the person has since left), and files it as a forward. |
| G6 | Branding: the list sits "below the 'where your customers' replies go' line" | that line is inside the branding `<form>`; a form inside a form is invalid HTML and Enter in the Add input would submit Save branding | **Accepted.** On Branding the list is its own card directly BELOW the Branding panel (outside its form). On Settings it sits inside the Sending address card below the Replies row, as the spec says (already outside that card's form). |
| G7 | RLS "members of the account read … no Technician read (a restrictive policy using `app.sees_all_customers`)"; UI "staff without the Owner role cannot see or edit it" | `sees_all_customers` is true for staff | **Accepted.** 0083 follows the spec's RLS literally: staff CAN read the rows through the API; no page shows them to staff and both actions refuse them (`requireAccountOwner`). Alternative for the owner: an Owner-only restrictive policy (`app.is_account_owner(account_id)`, 0066). |
| G8 | "Owners may add and remove on their own account; … staff … cannot see or edit it" | the Branding page admits staff | **Accepted.** The Branding card (and its read) renders only when `access.canManage` (agency or Owner). |
| G9 | "No raw headers (null): not treated as automatic" AND "a sender local part of `mailer-daemon` or `postmaster`" | the From comes from the API, not the raw block | **Accepted.** The header rules need the raw block; the `mailer-daemon` / `postmaster` rule reads the API's `from` and applies even when the raw block is null. |
| G10 | "`Auto-Submitted` present and not `no`" → dropped | RFC 3834's `auto-forwarded` value is what an Outlook/Exchange automatic-forward RULE stamps | **RULED: a TEAM sender's `Auto-Submitted: auto-forwarded` is NOT dropped** (a teammate's forwarding rule files normally, through the usual sender check); from anyone else it is dropped as automatic. The detector answers a third class, `"auto_forwarded"`, only when that is the sole marker (any other marker beside it is `"automatic"`); the pipeline then asks the team lookup BEFORE anything is stored (a read only) and drops when the sender is not on the team. A failed lookup answers 503. Spec §2 step 1 amended. |
| G11 | "At most 200 entries per account" | — | **Accepted.** Enforced in `addNeverLog` (count, then insert); two concurrent adds at 199 can land 201. The pipeline reads up to 1000 so every stored entry still drops. No DB trigger. |
| G12 | "the Copy button toasts 'Copied'" | the clipboard API can refuse (permissions, an insecure context) | **Accepted.** A refused copy toasts "Couldn't copy. Select the address and copy it by hand." (new key), and the address is plain selectable text. |
| G13 | "else team member + authenticated → the forward path" | — | **Accepted:** the team lookup runs for the sender check only when the forgery check passed and the sender is not the customer; an unauthenticated sender is held `unverified` without it (the same outcome). The one other caller is G10's auto-forwarded exemption, and the two share one memoised lookup. |
| G14 | "Shown to Owners in their language" | the Branding page is English-only today (`branding/page.tsx:79`, `m[...]`) | **Accepted.** The new card resolves the reader's locale (`requestLocale`, as the record page does) and sets `lang`; the rest of Branding stays as it is. Settings stays English (part 1 G14). |
| G15 | "The token is created lazily (`ensureReplyToken`) when the page renders the row" | this writes a conversation and a token on a page GET, through the service client | **Accepted.** As the spec says, only while Replies is not off; the record page's `getContact` on the request client has already proved the customer is the viewer's. A failed read or write is the row's own error state (new key), never the card's or the page's. |
| G16 | (silent) a Never record entry added between a delivery and its Resend retry | part 1 resumes an already-recorded row before anything else (`pipeline.ts:150-166`) | **Accepted.** The drops run only for a message with no stored row; an already-stored row resumes. A drop is never retroactive. |
| G17 | "Index on `account_id`" | the unique `(account_id, pattern)` index leads with `account_id` | **Accepted.** No second index (the unique index serves every `account_id` read). Task 1 pins the unique index's column order. |
| G18 | (silent) a held team forward that staff then file by hand from Needs a look | part 1's manual File files it as the customer's message (author `customer`) | **Accepted.** Unchanged in this PR (part 1's path); named in the PR body as a follow-up. |

## Global Constraints

- **NEVER `git stash`, `git reset`, `git checkout --`, `--amend`, or any history rewrite** in the shared worktree. To undo your own edit, edit it back; to see committed text, `git show HEAD:<path>`. Never `rm -rf` anything under `<WT>` (memory "No rm -rf on worktrees"); scratch directories under `<SCRATCH>` are yours. Commit with `git add <every path> && git commit -m "…" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>" -m "Claude-Session: https://claude.ai/code/session_013RThMy9QC8x7FZ94Lxib9p" -- <every path>`, never `-A` or `.`. If `.git/index.lock` exists, wait and retry; never delete it. Never push, never touch `main` (the orchestrator pushes).
- **0083 is written and proven by Task 1 and APPLIED only by the orchestrator, once: bis-ci first (`ci-project-setup.yml`, `push-dry-run` then `push`), then production (MCP `apply_migration`, once), then the parity check (Task 12).** No other task applies anything anywhere. 0083 is purely additive (one new table) and safe for the build before it, so it may reach production BEFORE the merge; the code must not ship before it (every inbound email would 503 on the Never record read, and Settings and Branding would lose their list to the error state).
- **No `@bis/db` vitest runs against bis-ci until Task 12 step 2 has applied 0083 there.** `@bis/db` suites run only on the replica kit below, or in CI `verify` (its own Supabase stack). In `packages/db`, run vitest as `node node_modules/vitest/vitest.mjs run <files>`; capture the exit code to a file with nothing after the command and judge by vitest's summary block (the `ERR_PNPM_RECURSIVE_EXEC_FIRST_FAIL` trailer lies). The kit exports `PGCLIENTENCODING=UTF8` (part 1 finding: without it `voice_profiles`' default reads as mojibake on the kit only).
- **Agents run only the affected tests, by path:** `pnpm --filter web exec vitest run "<path>" …`, `pnpm --filter web typecheck`, `pnpm --filter web exec eslint "<touched files>"`. Never the gates (`pnpm check`, `pnpm --filter web build`, `pnpm --filter web test:e2e`) and never Playwright runs: the orchestrator runs them, one at a time (memory "Agent test scope"). Never pass the folder `…/acct/` to vitest (it holds a live test).
- **Never production Supabase (`tlbkbmlrfafquucsmsmm`), never a production credential anywhere, never create or edit `.env*`, never set a Vercel secret.** No new environment variable. **No test calls Clerk, Resend or DNS** (G1 as ruled: nothing in this PR calls Clerk at all).
- **0053, server-only writes.** `authenticated` gets SELECT on `inbound_never_log` and nothing else. Every new action file that touches `serviceDb` is added to `…/acct/in-account-service-reads.test.ts`'s `ALLOWED` with its reason. **No new file under `apps/web/src/lib` contains the token `serviceDb` or `ledgerDb`, not even in a comment** (that test's `ROOTS` include `lib`): lib functions take the caller's client, or a thunk, as a parameter; pages and actions pass `serviceDb()`.
- **Bind every browser-supplied id to an RLS-proven target before any service write** (part 1, Task 11a). The two actions take `accountId` from the route-bound argument, prove it with `requireAccountOwner(accountId)` (Clerk session + the caller's own account) BEFORE any database call, and every service read or write is scoped `.eq("account_id", accountId)`; an entry id is never trusted alone. The record page's token write comes after `getContact` on the REQUEST client found the contact.
- **Never a token, an address, a pattern, a subject or a body in any log line.** The two new drops log exactly `inbound email: dropped (automatic) account=<id>` and `inbound email: dropped (never record) account=<id>`. The actions log the account id and `loggableError(e)` (kind, code and status only, `lib/loggable-error.ts:18-24`), never the input. The forwarding view logs a fixed sentence plus the account id.
- **The client/server module boundary (part 1, Task 11b CRITICAL).** A server component never CALLS a value exported from a `"use client"` module (Next turns it into a client reference and the call throws at runtime; vitest does not apply the RSC transform, so no unit test sees it). Every function a server component calls lives in a module with NO directive (`forwarding-view.ts`, `inbound-meta.ts`); `"use client"` modules export components only. Each UI task's test pins the import SITE of every such function (read the file's text: the server file imports it from the plain module, never from the `"use client"` one).
- **Server-compute render-deciding state** (part 1, Task 11b). Whether the Forwarding row shows, what it shows, and the forwarder's name on a bubble are decided on the server and passed as data; a client component never reads the database or guesses a state the server did not hand it.
- **A thrown server action toasts `common.actionCrashed`** (part 1, Tasks 10b, 11b, 12b). Every call from a client component into a server action goes through a PLAIN handler module (`components/never-log-handlers.ts`, `…/record/forwarding-copy.ts`) with a `try/catch`, unit-tested with a rejecting action; the component only wires state. Undo buttons go through the same handlers.
- **`lang={locale}` on every block rendered in the staff member's locale** (part 1, Task 11b/12b Important). The Never record list sets `lang` on its root; the Forwarding row inherits the record page's `lang` (`RecordLayout lang={locale}`, `…/record/page.tsx:279`); the thread's "Forwarded by" line sets `lang={locale}` because the bubble's body carries the CUSTOMER's `lang`.
- **SQL rules.** 0083 is ASCII only with no backslash anywhere (memory "MCP SQL escapes"; Task 1 step 6 checks with a positive control): regexes use `[.]`, never `\.`. `set local lock_timeout = '5s';` before the first statement. Every boolean from a nullable is `coalesce(…, false)` (memory "plpgsql NULL guard"). A Supabase `head: true` count throws on `count === null` (memory "head-count null").
- **The `vi.mock` factory check.** A task that adds a NEW named import from `@bis/db` to a module adds that name to every mock factory that reaches it: `grep -rln 'vi.mock("@bis/db"' apps/web/src | xargs grep -ln "<module basename>"`. A `"use server"` module is never imported into vitest without a `vi.mock` for it. The pure rules are imported from the SUBPATH `@bis/db/never-log-rules` precisely so a test that mocks `@bis/db` still runs the real matcher (a mocked matcher would let the never-record test pass on any code).
- **Every test must be able to fail.** Each test names the mutation that breaks it; the implementer runs the probe, sees the test fail BY NAME, pastes the failing assertion line, and edits back (memory "Vacuous test shapes": no `toBeTruthy` on content, no mock that satisfies itself, no assertion on a value the fixture already held, no `-t` filter that matches nothing; check the run count in vitest's summary). **A mock never answers a state production cannot reach** (part 1, Task 11b re-review): a `getContact` mock that ignores RLS, a `listNeverLog` mock that returns entries for another account, a Clerk port that returns a user whose addresses do not include the asked one — each is either removed or the test says which real state it stands for.
- **DESIGN.md definition of done for every UI task (7, 8):** tokens only (radii `rounded-[var(--radius-ctl)]` / `rounded-[var(--radius-card)]`, pills `rounded-full`; no hex, no literal shadow); both themes through the `.dark` class; the blur fallback; rule 5 (the list has loaded, empty and error states; the Forwarding row has address, turn-on, hidden and error states; one failing never blanks its card); rule 6 (Add and Remove run at once with Undo in the toast; nothing asks "Are you sure?"); rule 7 (no spinner; the data is server-rendered, so there is no loading state to draw); rule 8 (Add, Remove and Copy are ghost; the Sending address card keeps its ONE primary Save; the Branding list card has no primary; the record header's Call stays its one primary); controls `min-h-11 md:min-h-8`; nothing animates on scroll; the module contract (one row in an existing card, one section in an existing Settings card, one card on an existing page, one line on an existing bubble); `/styleguide` gains a demo for each new component.
- **Copy.** Plain words a business owner reads at 7 AM; no "token", "DKIM", "DMARC", "SES", "webhook", "Resend", "MX" in any of this PR's strings. Every key is added by **Task 2 only**, an English line followed directly by its `.es` line, Spanish in **usted**. New `.tsx` code carries no JSX literal copy with a letter in it (`lib/i18n/ratchet.test.ts`). Every copy assertion goes through `renderedText()` (`apps/web/src/lib/rendered-text.ts`) and asserts BOTH languages against literal strings, never against `t()`'s output (it falls back to English silently).
- **Mutating e2e only on the per-run fixture account** (`readClientFixture()`, `apps/web/e2e/support.ts`), never `Test Client One`; every seeded row is deleted in `afterAll`, each error checked, then EVERY table it deleted from is re-read to confirm none is left (part 1, Task 14 fix). Locators never match two places at once: an entry is addressed by its `data-never-log-entry` attribute, never by its text (part 1's strict-mode failure matched the inbox's list preview AND the bubble; the toast here repeats the pattern).

## Ownership (no task edits a file its owner does not own)

- **bis-db-schema:** `packages/db/supabase/migrations/0083_inbound_never_log.sql` (new), `packages/db/src/test/inbound-never-log-schema.test.ts` (new), `<SCRATCH>/s06b-kit/*` (Task 1).
- **bis-comms:** `apps/web/src/lib/messages.ts` + one new `describe` in `apps/web/src/lib/messages.test.ts` (**Task 2 only**); `packages/db/src/{never-log,never-log-rules,inbound-email,messaging,index}.ts`, `packages/db/package.json` (one `exports` line), `packages/db/src/test/never-log.test.ts` (new), `apps/web/src/lib/email/inbound/never-log-rules.test.ts` (new) (Task 3); `apps/web/src/lib/email/inbound/automatic.ts` + test (Task 4); `apps/web/src/lib/email/inbound/{pipeline,file}.ts` + tests, `docs/runbooks/inbound-email.md` (Task 5); `…/acct/never-log-actions.ts` + test, `apps/web/src/components/never-log-handlers.ts` + test, one `ALLOWED` line (Task 6); `apps/web/src/lib/i18n/{catalogue,ratchet}-baseline.json` (Task 9, regenerated, never hand-edited).
- **bis-frontend:** `apps/web/src/components/never-log-list.tsx` + test, `…/settings/{sending-address-card.tsx,sending-address-card.test.ts,page.tsx,page.test.ts}`, `…/acct/branding/{page.tsx,page.test.ts}`, `…/styleguide/never-log-demo.tsx` + test and one line in `…/styleguide/page.tsx` (Task 7); `apps/web/src/lib/email/inbound/forwarding-view.ts` + test, `…/record/{forwarding-address-row.tsx,forwarding-copy.ts}` + tests, `…/record/contact-fields-panel.tsx` (one prop, one row), `…/record/page.tsx` (one read, one prop) + `page.test.ts`, `…/conv/{inbound-meta.ts,message-thread.tsx,page.tsx}` + tests, `…/styleguide/forwarding-demo.tsx` + test and one line in `…/styleguide/page.tsx` (Task 8, AFTER Task 7's styleguide commit).
- **bis-e2e-qa:** `apps/web/e2e/never-record.spec.ts` (new) (Task 10).
- **Orchestrator:** Task 0's confirmations and the owner's rulings on G1–G18, the ledger, the bis-ci and production applies, the parity check, the gates, the PR, the merge, the roadmap tracker row (Task 12).

**Shared files, one task at a time:** `apps/web/src/lib/messages.ts` (**Task 2 only**: a later task that finds a key missing STOPS and reports; the orchestrator re-opens Task 2). `packages/db/src/{inbound-email,messaging,index}.ts` and `package.json` (**Task 3 only**). `…/styleguide/page.tsx` (Task 7, then Task 8). `…/acct/in-account-service-reads.test.ts` (Task 6 only). `apps/web/src/lib/i18n/*-baseline.json` (**Task 9 only**).

## The replica kit (every `@bis/db` task and its reviewer)

Ports, one set per agent, never `5432`, clear of part 1's `55620`–`55630`: Task 1 implementer `55640`, Task 1 reviewer `55641`; Task 3 implementer Postgres `55642`, PostgREST `55643`, gateway `55644`; Task 3 reviewer `55645`/`55646`/`55647`; Task 11 (final review) `55648`/`55649`/`55650`. Each agent works in `<SCRATCH>/s06b-t<N>-<impl|review>/`.

Task 1 copies `<KIT1>` to `<SCRATCH>/s06b-kit/` with `sed`; exactly these lines change in `replica.sh`: a new line `export PGCLIENTENCODING=UTF8` right after `set -u`; the skip `*0082_*` → `*0083_*`; the post block's file name `0082_inbound_email.sql` → `0083_inbound_never_log.sql` (twice) and its three messages (`post = pre + 0083`, `0083 FAILED`, `post = pre (no 0083 yet)`). In `pgrst.sh` only the JWT secret string changes, to `s06b-local-postgrest-jwt-secret-not-used-anywhere-real-0000`. `pre` is every migration through **0082**; `post` is `pre` + 0083. `pgrst.sh` is `bash pgrst.sh <pgPort> <postgrestPort> <gatewayPort> <dir>`; read its tail for the two variables it prints (`NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`) and export exactly those for a PostgREST-backed run. Stop your own kit only: `touch "<dir>/stop"`; PowerShell `Get-Process postgrest | Where-Object { $_.Path -eq '<dir as a Windows path>\postgrest.exe' } | Stop-Process -Confirm:$false`; `Get-NetTCPConnection -LocalPort <gatewayPort> -State Listen | ForEach-Object { Stop-Process -Id $_.OwningProcess -Confirm:$false }`; then `"/c/Program Files/PostgreSQL/18/bin/pg_ctl" -D "<dir>/pgdata" stop -m fast`.

**Faithfulness** (once per kit build, read-only on bis-ci with `pnpm --filter @bis/db ci:sql`): the client-write-surface digest on `pre` equals bis-ci's (bis-ci has 0082 and not 0083 until Task 12 step 2; part 1's ledger recorded `51|0dd3e2d7e19f3f3649a893cfd9967d94` on both projects after 0082):

```sql
select count(*) || '|' || md5(string_agg(x, ',' order by x)) from (
  select r || ' ' || c.relname || ' ' || p as x
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  cross join (values ('anon'), ('authenticated')) v(r)
  cross join (values ('INSERT'), ('UPDATE'), ('DELETE')) w(p)
  where n.nspname = 'public' and c.relkind = 'r' and has_table_privilege(r, c.oid, p)) s;
```

Paste both values; stop if they differ. On `post` the digest must be UNCHANGED (0083 grants no client write).

## Pinned tests this PR changes (stated outright)

- `apps/web/src/lib/email/inbound/pipeline.test.ts:3-7`: the hoisted `db` mock gains `matchTeamSender` and `listNeverLog`; `deps` is unchanged; `beforeEach` gives `listNeverLog` `[]` and `matchTeamSender` `null` (the states a customer reply really meets: no list, sender not on the team). Every existing case keeps its assertions (Task 5).
- `apps/web/src/app/api/webhooks/resend/route.ts` and `route.test.ts`: **unchanged** (G1 as ruled: the pipeline gains no dependency); Task 5 step 8 runs the route test to prove it.
- `apps/web/src/lib/email/inbound/file.test.ts`: new cases only; the existing `createMessage` call assertions (`:31-37`) stay byte-for-byte (a customer reply's insert has no `author`) (Task 5).
- `…/acct/in-account-service-reads.test.ts`: `ALLOWED` gains `"app/(dashboard)/dashboard/accounts/[accountId]/never-log-actions.ts": "owner-only"` (Task 6). The record page (`:79`, `proven-target`), Settings (`:122`, `agency-only`) and Branding (`:68`, `configuration`) are already listed; their reasons still hold (Tasks 7, 8 add reads there, each behind the same guard).
- `…/conv/inbound-meta.test.ts`: new cases for `forwarded`; the existing ones unchanged (Task 8).
- `packages/db/src/messaging.ts:12-36` `NewMessage` gains `author`; `MESSAGE_COLS` (`:75-76`) is **unchanged** (G4).
- **Unchanged, checked (each task that could disturb one runs it):** `packages/db/src/test/schema-grants-guard.test.ts` (0083 adds a TABLE with RLS on and no client write); `packages/db/src/test/provenance-parity.test.ts` (`messageAuthor` untouched); `packages/db/src/account-teardown.ts`' `ACCOUNT_OWNED_TABLES` (unchanged: `inbound_never_log` cascades on its account; Task 1 proves the cascade); `apps/web/src/lib/consent/scans.test.ts` (no new email kind, no new `resend` importer); `lib/i18n/request-locale-callers.test.ts` (every new `requestLocale` call names `userLanguage` and passes a NAMED variable).

## File Structure

**Created**

| Path | Owner | Responsibility |
|---|---|---|
| `packages/db/supabase/migrations/0083_inbound_never_log.sql` | bis-db-schema | the table, its CHECKs, unique pattern, RLS and grants |
| `packages/db/src/test/inbound-never-log-schema.test.ts` | bis-db-schema | 0083 on the replica: CHECKs, uniqueness, cascade, RLS, grants |
| `packages/db/src/never-log-rules.ts` | bis-comms | pure: parse an entry, match a sender, the cap (subpath `@bis/db/never-log-rules`) |
| `packages/db/src/never-log.ts` (+ `test/never-log.test.ts`) | bis-comms | list, add (duplicate, full), remove, on the caller's client |
| `apps/web/src/lib/email/inbound/never-log-rules.test.ts` | bis-comms | the pure rules, without a database |
| `apps/web/src/lib/email/inbound/automatic.ts` (+ test) | bis-comms | is this automatic mail, or a lone auto-forward (G10) |
| `…/acct/never-log-actions.ts` (+ test) | bis-comms | Add and Remove, Owner or agency, account-bound |
| `apps/web/src/components/never-log-handlers.ts` (+ test) | bis-comms | every client call into those actions, Undo included, crash-safe |
| `apps/web/src/components/never-log-list.tsx` (+ test) | bis-frontend | the list: entries, empty, error, Add, Remove |
| `apps/web/src/lib/email/inbound/forwarding-view.ts` (+ test) | bis-frontend | what the Forwarding row shows, decided on the server |
| `…/record/forwarding-address-row.tsx` (+ test), `…/record/forwarding-copy.ts` (+ test) | bis-frontend | the row and its Copy |
| `…/styleguide/never-log-demo.tsx`, `…/styleguide/forwarding-demo.tsx` (+ tests) | bis-frontend | the two demos |
| `apps/web/e2e/never-record.spec.ts` | bis-e2e-qa | add an entry, see it, Undo it; remove, Undo |

**Modified:** `packages/db/src/{inbound-email,messaging,index}.ts`, `packages/db/package.json`; `apps/web/src/lib/messages.ts`, `messages.test.ts`; `apps/web/src/lib/email/inbound/{pipeline,file}.ts` and tests; `…/settings/{sending-address-card,page}.tsx` and tests; `…/acct/branding/page.tsx` and test; `…/record/{contact-fields-panel,page}.tsx` and `page.test.ts`; `…/conv/{inbound-meta.ts,message-thread.tsx,page.tsx}` and tests; `…/acct/in-account-service-reads.test.ts`; `…/styleguide/page.tsx`; `docs/runbooks/inbound-email.md`; `apps/web/src/lib/i18n/{catalogue,ratchet}-baseline.json`.

## Task list, owners, order

| # | Task | Owner | Review | Depends on |
|---|---|---|---|---|
| 0 | Confirm the base; the owner rules on G1–G18 | orchestrator | n/a | — |
| 1 | Migration 0083 and its proof on the replica; the kit | bis-db-schema | **opus** | 0 |
| 2 | Every key (**messages.ts, the only writer**) | bis-comms | sonnet | 0 |
| 3 | `@bis/db`: the never-record module and rules, `matchTeamSender`, `createMessage`'s author | bis-comms | **opus** | 1 |
| 4 | The automatic-mail detector | bis-comms | **opus** | 0 |
| 5 | The pipeline's three new steps, the forward path in `file.ts`, the route, the runbook | bis-comms | **opus** | 3, 4 |
| 6 | The Never record actions and their crash-safe handlers | bis-comms | **opus** | 2, 3 |
| 7 | The Never record list on Settings and Branding; its demo | bis-frontend | **opus** | 2, 6 |
| 8 | The Forwarding address row; "Forwarded by" on the thread; its demo | bis-frontend | **opus** | 2, 3, 5, 7 (styleguide only) |
| 9 | Regenerate the i18n baselines | bis-comms | sonnet | 2, 7, 8 |
| 10 | The e2e spec | bis-e2e-qa | sonnet | 7, 9 |
| 11 | Whole-branch final review (checkpoint) | reviewer | **opus** | 1–10 |
| 12 | Rollout (orchestrator; LAST) | orchestrator | n/a | 11 |

```
Wave A (three lanes):  T1 (bis-db-schema)    T2 (bis-comms)    T4 (bis-comms, 2nd instance)
Wave B:                T3 (after T1)
Wave C (two lanes):    T5 (after T3, T4)                       T6 (after T2, T3)
Wave D:                T7 (after T6), then T8's styleguide step; T8's other steps may start once T5 is in
Wave E:                T9, then T10
Checkpoint:            T11
Rollout:               T12 (orchestrator, LAST)
```

Disjointness: T4 shares no file with T1–T3. T5 and T6 share no file (T5: `lib/email/inbound/{pipeline,file}.ts`, the route; T6: the actions and handlers). T7 and T8 share only `…/styleguide/page.tsx` (T7 first). **0083 goes to bis-ci only AFTER Task 11 approves**; until then CI `e2e`'s migration check is red on every push, expected and named in each CI reading.

---

## Task 0: Confirm the base; the owner rules on G1–G18 (orchestrator)

- [ ] **Step 1.** In `<WT>`: `git log --oneline -3` shows this plan's commit, then `fa6e48b0 Spec: forward to a record, and never record (S-06 part 2)`, `09496978 Runbook: inbound email needs a Full access Resend key…`. `git fetch origin && git log --oneline origin/main -1`. If `main` moved past `09496978`, read what moved it; if it touched any file in "File Structure", merge `origin/main` ONCE here (never rebase) before any lane starts.
- [ ] **Step 2.** Confirm, and stop if any line differs:
  - `ls packages/db/supabase/migrations | tail -1` → `0082_inbound_email.sql`; `git log --all --oneline -- 'packages/db/supabase/migrations/0083*'` → nothing.
  - `grep -n 'isAgencyMetadata(d.public_metadata)' apps/web/src/app/api/webhooks/clerk/route.ts` → `72:` (G1).
  - `grep -n 'if (direction === "inbound") return { authorKind: "customer"' packages/db/src/provenance.ts` → `21:` (G3).
  - `grep -n 'const MESSAGE_COLS' packages/db/src/messaging.ts` → `75:` (G4).
  - `grep -n '<form' apps/web/src/components/branding-panel.tsx` → `231:` only; `grep -n 'data-replies-line' apps/web/src/components/branding-panel.tsx` → `283:` (G6).
  - `grep -n '^} as const;' apps/web/src/lib/messages.ts` → `4749:`; `wc -l < apps/web/src/lib/messages.test.ts` → `611`.
  - `ls "<SCRATCH>/s06-kit/replica.sh" "<SCRATCH>/s06-kit/pgrst.sh" "/c/Users/danlo/AppData/Local/Temp/claude/C--Users-danlo-bis-platform/db21dcfe-6aee-47cd-8939-ff4f82a45810/scratchpad/s07-t3-impl/postgrest.exe"` → all three exist.
  - Read-only, MCP `execute_sql` on production and `pnpm --filter @bis/db ci:sql` on bis-ci: `select max(version) from supabase_migrations.schema_migrations` names the 0082 apply on both (production `20261016231609`).
- [x] **Step 3. RULED 2026-10-17 (danlo, tiles):** G1 CHANGED (the agency is not on the team: members of the account, any role, plus its `reply_to_email` mailbox; no Clerk lookup; an agency forward is held in Needs a look like any non-team sender). G10 CHANGED (a team sender's lone `Auto-Submitted: auto-forwarded` is not dropped; anyone else's is). G2–G9 and G11–G18 ACCEPTED as proposed. The spec's Decision 2, §2 step 1, §3 and "Tests" were amended in the same commit as this plan; each gap row reads its ruling. Record the rulings in the ledger; no implementer re-asks.

---

## Task 1: Migration 0083 and its proof on the replica; the kit (bis-db-schema)

**Review:** opus. **Runs beside:** Tasks 2, 4. **Scratch:** `<SCRATCH>/s06b-t1-impl/`, replica port `55640` (reviewer `s06b-t1-review/`, `55641`).

**Files**
- Create: `<SCRATCH>/s06b-kit/replica.sh`, `<SCRATCH>/s06b-kit/pgrst.sh` (outside the repo)
- Create: `packages/db/supabase/migrations/0083_inbound_never_log.sql`
- Create: `packages/db/src/test/inbound-never-log-schema.test.ts`

**Interfaces**
- Consumes (SQL): `public.accounts`, `public.users`, `public.memberships`; `app.is_agency()`, `app.current_account_id()`, `app.sees_all_customers(uuid)` (0068:75-78).
- Produces (SQL), read by Tasks 3 and 12:
  - `public.inbound_never_log (id uuid pk, account_id uuid not null fk accounts on delete cascade, pattern text not null, kind text not null, added_by text not null, created_at timestamptz not null default now())`.
  - `inbound_never_log_account_pattern_key unique (account_id, pattern)`; CHECK `inbound_never_log_kind_check` (`address` | `domain`); CHECK `inbound_never_log_pattern_check` (lowercase, at most 254, an address shape for `address`, a domain shape for `domain`).
  - RLS on; `inbound_never_log_member_read` (SELECT) + restrictive `inbound_never_log_no_technician` (SELECT); `authenticated` SELECT only, `service_role` all.

- [ ] **Step 1: Build the kit.**

```bash
S=/c/Users/danlo/AppData/Local/Temp/claude/C--Users-danlo-bis-platform/16ea02fa-4bbf-472b-babe-a260f83c4097/scratchpad
mkdir -p "$S/s06b-kit"
sed -e 's#^set -u$#set -u\nexport PGCLIENTENCODING=UTF8#' -e 's#\*0082_\*#*0083_*#' -e 's#0082_inbound_email.sql#0083_inbound_never_log.sql#g' \
    -e 's#post = pre + 0082#post = pre + 0083#' -e 's#0082 FAILED#0083 FAILED#' -e 's#(no 0082 yet)#(no 0083 yet)#' \
    "$S/s06-kit/replica.sh" > "$S/s06b-kit/replica.sh"
sed -e 's#s06-local-postgrest-jwt-secret-not-used-anywhere-real-00000#s06b-local-postgrest-jwt-secret-not-used-anywhere-real-0000#' "$S/s06-kit/pgrst.sh" > "$S/s06b-kit/pgrst.sh"
diff "$S/s06-kit/replica.sh" "$S/s06b-kit/replica.sh"; diff "$S/s06-kit/pgrst.sh" "$S/s06b-kit/pgrst.sh"
```

Paste both diffs: only the lines named in "The replica kit" differ. `bash "$S/s06b-kit/replica.sh" 55640 "$S/s06b-t1-impl"` → `post = pre (no 0083 yet)`. Run the faithfulness query on `pre` (`"/c/Program Files/PostgreSQL/18/bin/psql" -h localhost -p 55640 -U postgres -d pre -c "<query>"`) and on bis-ci; paste both; stop if they differ.

- [ ] **Step 2: Read before writing.** `sed -n 1,60p packages/db/supabase/migrations/0082_inbound_email.sql` (the header shape and the apply-order paragraph), `sed -n 520,562p packages/db/supabase/migrations/0082_inbound_email.sql` (the table, RLS and grant block this copies), `sed -n 1,80p packages/db/src/test/inbound-email-schema.test.ts` (the seed and helpers), `sed -n 1,45p packages/db/src/test/db.ts` (`actAs`, `withRollback`, the env name `SUPABASE_DB_URL`).

- [ ] **Step 3: Write the failing test** `packages/db/src/test/inbound-never-log-schema.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import type { Client } from "pg";
import { withRollback, actAs } from "./db";

/**
 * 0083 (S-06 part 2, spec "Data model"; plan G7, G17): the account's Never record list. Server-written
 * (0053); members of the account read it, the agency every account's, a Technician none, another
 * account none. Its own seed, in 0082's schema test's shape.
 */
const RUN = Math.random().toString(36).slice(2, 10);
const ORG = `org_nl_${RUN}`;
const ORG_B = `org_nlb_${RUN}`;
const SUB = { owner: `u_nl_owner_${RUN}`, staff: `u_nl_staff_${RUN}`, tech: `u_nl_tech_${RUN}`, ownerB: `u_nl_ownerb_${RUN}` } as const;

async function attempt(c: Client, sql: string, args: unknown[] = []) {
  await c.query("savepoint s");
  try {
    const r = await c.query(sql, args);
    await c.query("release savepoint s");
    return r;
  } catch (e) {
    await c.query("rollback to savepoint s");
    throw e;
  }
}
const code = async (p: Promise<unknown>) => { try { await p; return "ok"; } catch (e) { return (e as { code?: string }).code ?? "?"; } };
const one = async (c: Client, sql: string, args: unknown[]) => (await c.query<{ id: string }>(sql, args)).rows[0]!.id;
const entry = (c: Client, acct: string, pattern: string, kind: string) =>
  attempt(c, "insert into inbound_never_log (account_id, pattern, kind, added_by) values ($1,$2,$3,'u_x') returning id", [acct, pattern, kind]);

async function seed(c: Client) {
  const { rows: [agency] } = await c.query<{ id: string }>("select id from agencies limit 1");
  const acct = await one(c, "insert into accounts (agency_id, clerk_org_id, name, client_access_enabled) values ($1,$2,'NL Co',true) returning id", [agency!.id, ORG]);
  const acctB = await one(c, "insert into accounts (agency_id, clerk_org_id, name, client_access_enabled) values ($1,$2,'NL B',true) returning id", [agency!.id, ORG_B]);
  const u = {} as Record<keyof typeof SUB, string>;
  for (const k of Object.keys(SUB) as (keyof typeof SUB)[]) u[k] = await one(c, "insert into users (clerk_user_id, email) values ($1, $1 || '@example.com') returning id", [SUB[k]]);
  await c.query(
    `insert into memberships (user_id, scope, account_id, role) values ($1,'account',$5,'owner'), ($2,'account',$5,'staff'), ($3,'account',$5,'technician'), ($4,'account',$6,'owner')`,
    [u.owner, u.staff, u.tech, u.ownerB, acct, acctB]);
  const addr = (await entry(c, acct, "billing@supplier.com", "address")).rows[0]!.id as string;
  const dom = (await entry(c, acct, "supplier.com", "domain")).rows[0]!.id as string;
  const other = (await entry(c, acctB, "vendor.com", "domain")).rows[0]!.id as string;
  return { agencyId: agency!.id, acct, acctB, addr, dom, other };
}

describe("0083: inbound_never_log's shape", () => {
  it("takes a lowercase address or a lowercase dotted domain, consistent with its kind, at most 254 characters (mutation: drop inbound_never_log_pattern_check → 'Supplier.com' is ok, FAILS; drop the kind half of it → an address stored as a domain is ok, FAILS)", async () => {
    await withRollback(async (c) => {
      const s = await seed(c);
      expect(await code(entry(c, s.acct, "Supplier.com", "domain"))).toBe("23514");
      expect(await code(entry(c, s.acct, "supplier", "domain"))).toBe("23514");
      expect(await code(entry(c, s.acct, "a@supplier.com", "domain"))).toBe("23514");
      expect(await code(entry(c, s.acct, "supplier.com", "address"))).toBe("23514");
      expect(await code(entry(c, s.acct, "a@@supplier.com", "address"))).toBe("23514");
      expect(await code(entry(c, s.acct, "a b@supplier.com", "address"))).toBe("23514");
      expect(await code(entry(c, s.acct, "a+tag@supplier.com", "address"))).toBe("23514");
      expect(await code(entry(c, s.acct, "x.com", "other"))).toBe("23514");
      expect(await code(entry(c, s.acct, `${"a".repeat(250)}.com`, "domain"))).toBe("23514");
      expect(await code(entry(c, s.acct, "ana.lopez@mail.example.co", "address"))).toBe("ok");
      expect(await code(entry(c, s.acct, "mail.example.co", "domain"))).toBe("ok");
    });
  });

  it("one pattern once per account, the same pattern on another account is fine; the unique index leads with account_id (G17; mutation: drop the unique constraint → the second insert is ok, FAILS)", async () => {
    await withRollback(async (c) => {
      const s = await seed(c);
      expect(await code(entry(c, s.acct, "billing@supplier.com", "address"))).toBe("23505");
      expect(await code(entry(c, s.acctB, "billing@supplier.com", "address"))).toBe("ok");
      const { rows: [ix] } = await c.query<{ def: string }>("select pg_get_indexdef(indexrelid) as def from pg_index where indexrelid = 'public.inbound_never_log_account_pattern_key'::regclass");
      expect(ix!.def).toContain("(account_id, pattern)");
    });
  });

  it("goes with its account (mutation: account_id without on delete cascade → the delete fails 23503, FAILS)", async () => {
    await withRollback(async (c) => {
      const s = await seed(c);
      const bare = await one(c, "insert into accounts (agency_id, clerk_org_id, name) values ($1,$2,'NL bare') returning id", [s.agencyId, `org_nlc_${RUN}`]);
      await entry(c, bare, "gone.com", "domain");
      await c.query("delete from accounts where id = $1", [bare]);
      expect((await c.query("select count(*)::int as n from inbound_never_log where account_id = $1", [bare])).rows[0]).toEqual({ n: 0 });
    });
  });
});

describe("0083: who reads inbound_never_log", () => {
  it("the account's Owner and staff read its rows, the agency every account's, a Technician none, another account's Owner none (G7; mutation: drop inbound_never_log_no_technician → the tech sees two, FAILS; member_read using (true) → ownerB sees three, FAILS)", async () => {
    await withRollback(async (c) => {
      const s = await seed(c);
      const seen = async (claims: { org_id?: string; app_role?: string; sub: string }) => {
        await actAs(c, claims);
        const ids = (await c.query<{ id: string }>("select id from inbound_never_log where id = any($1::uuid[]) order by id", [[s.addr, s.dom, s.other]])).rows.map((r) => r.id);
        await c.query("reset role");
        return ids;
      };
      expect(await seen({ org_id: ORG, sub: SUB.owner })).toEqual([s.addr, s.dom].sort());
      expect(await seen({ org_id: ORG, sub: SUB.staff })).toEqual([s.addr, s.dom].sort());
      expect(await seen({ org_id: ORG, sub: SUB.tech })).toEqual([]);
      expect(await seen({ org_id: ORG_B, sub: SUB.ownerB })).toEqual([s.other]);
      expect(await seen({ app_role: "agency_admin", sub: `u_nl_agency_${RUN}` })).toEqual([s.addr, s.dom, s.other].sort());
    });
  });

  it("no client role writes; authenticated has SELECT only, anon nothing (0053; mutation: grant insert to authenticated → the owner's insert is ok, FAILS)", async () => {
    await withRollback(async (c) => {
      const s = await seed(c);
      await actAs(c, { org_id: ORG, sub: SUB.owner });
      expect(await code(attempt(c, "insert into inbound_never_log (account_id, pattern, kind, added_by) values ($1,'x.com','domain','u')", [s.acct]))).toBe("42501");
      expect(await code(attempt(c, "update inbound_never_log set pattern = 'y.com' where id = $1", [s.dom]))).toBe("42501");
      expect(await code(attempt(c, "delete from inbound_never_log where id = $1", [s.dom]))).toBe("42501");
      await c.query("reset role");
      const { rows: [g] } = await c.query(
        `select has_table_privilege('authenticated','public.inbound_never_log','SELECT') as a_sel,
                has_table_privilege('authenticated','public.inbound_never_log','INSERT') as a_ins,
                has_table_privilege('authenticated','public.inbound_never_log','UPDATE') as a_upd,
                has_table_privilege('authenticated','public.inbound_never_log','DELETE') as a_del,
                has_table_privilege('anon','public.inbound_never_log','SELECT') as n_sel,
                (select relrowsecurity from pg_class where oid = 'public.inbound_never_log'::regclass) as rls`);
      expect(g).toEqual({ a_sel: true, a_ins: false, a_upd: false, a_del: false, n_sel: false, rls: true });
    });
  });
});
```

If the bare-account insert needs more columns (read `0001_tenancy.sql:20-30` and any later `not null` without default on `accounts`), add them and say so in the report.

- [ ] **Step 4: Run it to see it fail.** `cd packages/db && SUPABASE_DB_URL=postgresql://postgres@localhost:55640/post node node_modules/vitest/vitest.mjs run src/test/inbound-never-log-schema.test.ts > "$S/s06b-t1-impl/red.log" 2>&1; echo $? > "$S/s06b-t1-impl/red.exit"`. Expected: every case FAILS (`relation "inbound_never_log" does not exist`). Paste the summary block.

- [ ] **Step 5: Write the migration** `packages/db/supabase/migrations/0083_inbound_never_log.sql`:

```sql
-- 0083_inbound_never_log.sql - inbound email, part 2: the Never record list
-- (docs/superpowers/specs/2026-10-17-forward-to-record-design.md "Data model";
--  docs/superpowers/plans/2026-10-17-forward-to-record.md)
--
-- Each account keeps a list of addresses and whole domains whose mail is dropped by the inbound
-- pipeline before anything is stored, even when the sender is a customer. An address entry is the
-- sender's email key (lowercase, +tag stripped, the app's emailKey); a domain entry matches that
-- domain and every subdomain of it (the app's neverLogMatches). The agency edits it on Settings, an
-- Owner on Branding; both go through server actions on the service client (0053: server-only
-- writes). Members of the account read it, the agency every account's, a Technician none (plan G7:
-- staff can read it here; no page shows it to them).
-- One unique (account_id, pattern) index; it leads with account_id, so it serves every per-account
-- read and no second index is made (plan G17).
--
-- APPLY ORDER: CI project (ci-project-setup.yml: push-dry-run, then push), then production (MCP
-- apply_migration, once), then the parity check, then merge. Purely additive: safe for the build
-- before it, which never reads this table. The app that reads it must not run before this file
-- (every inbound email would answer 503 on the list read).
--
-- Rollback (by hand; revert the app first): drop table public.inbound_never_log;
--   Lost: every account's Never record entries.
--
-- ASCII only, no backslash anywhere.

-- 0. Fail fast instead of queueing behind a long lock.
set local lock_timeout = '5s';

-- 1. The table.
create table public.inbound_never_log (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  pattern text not null,
  kind text not null,
  added_by text not null,
  created_at timestamptz not null default now(),
  constraint inbound_never_log_account_pattern_key unique (account_id, pattern),
  constraint inbound_never_log_kind_check check (kind in ('address', 'domain')),
  constraint inbound_never_log_pattern_check check (
    pattern = lower(pattern)
    and char_length(pattern) <= 254
    and (
      (kind = 'address'
        and pattern ~ '^[a-z0-9.!#$%&''*/=?^_`{|}~-]+@([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?[.])+[a-z]{2,63}$')
      or (kind = 'domain'
        and pattern ~ '^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?[.])+[a-z]{2,63}$')))
);

-- 2. Who reads it. Server-written only (0053).
alter table public.inbound_never_log enable row level security;
create policy inbound_never_log_member_read on public.inbound_never_log for select to authenticated
  using (coalesce(app.is_agency(), false) or account_id = app.current_account_id());
create policy inbound_never_log_no_technician on public.inbound_never_log as restrictive for select to authenticated
  using (coalesce(app.sees_all_customers(account_id), false));
revoke all on public.inbound_never_log from anon, authenticated;
grant select on public.inbound_never_log to authenticated;
grant select, insert, update, delete on public.inbound_never_log to service_role;
```

(The address class leaves out `+` on purpose: an address entry is stored as its email key, which has no `+tag`; Task 3's `parseNeverLogPattern` is the app twin. `''` is SQL's escaped quote inside the literal, not a backslash.)

- [ ] **Step 6: ASCII and backslash check, with a positive control.**

```bash
node -e 'const b=require("fs").readFileSync(process.argv[1]);let n=0,s=0;for(const x of b){if(x>127)n++;if(x===92)s++;}console.log(`non-ascii=${n} backslash=${s}`)' packages/db/supabase/migrations/0083_inbound_never_log.sql
printf 'a\\b\xc3\xa9' > "$S/s06b-t1-impl/control.sql"
node -e 'const b=require("fs").readFileSync(process.argv[1]);let n=0,s=0;for(const x of b){if(x>127)n++;if(x===92)s++;}console.log(`non-ascii=${n} backslash=${s}`)' "$S/s06b-t1-impl/control.sql"
md5sum packages/db/supabase/migrations/0083_inbound_never_log.sql
```

Expected: `non-ascii=0 backslash=0`, then the control's `non-ascii=2 backslash=1`. Paste the md5 (Task 12 compares).

- [ ] **Step 7: Run on the replica, post = pre + 0083.** `bash "$S/s06b-kit/replica.sh" 55640 "$S/s06b-t1-impl"` → `post = pre + 0083`. On `post`: `inbound-never-log-schema.test.ts`, `schema-grants-guard.test.ts`, `inbound-email-schema.test.ts` (0082's, unchanged). Expected: all PASS. The faithfulness digest on `post` equals the one on `pre`. Paste the summary blocks and the digest.

- [ ] **Step 8: Mutation probes, each by name** (on the replica's `post` with `alter`/`drop`/`create policy`, run the named case, then rebuild with `replica.sh`; never edit the committed file for a probe): (a) `alter table inbound_never_log drop constraint inbound_never_log_pattern_check` → the shape case FAILS on `'Supplier.com'`; (b) the CHECK re-added without its `kind` halves (pattern lowercase and length only) → FAILS on `a@supplier.com` as a domain; (c) `drop constraint inbound_never_log_account_pattern_key` → the unique case FAILS; (d) the account FK re-made without `on delete cascade` → the cascade case FAILS; (e) `drop policy inbound_never_log_no_technician` → the read case FAILS on `tech`; (f) `inbound_never_log_member_read` re-created `using (true)` → FAILS on `ownerB`; (g) `grant insert on inbound_never_log to authenticated` → the writes case FAILS. Paste each failing assertion line.

- [ ] **Step 9: Commit** `-- packages/db/supabase/migrations/0083_inbound_never_log.sql packages/db/src/test/inbound-never-log-schema.test.ts`, message "db: 0083 the Never record list: inbound_never_log, members read, no Technician (S-06 part 2)".

---

## Task 2: Every key (bis-comms; messages.ts, the only writer)

**Review:** sonnet. **Runs beside:** Tasks 1, 4.

**Files**
- Modify: `apps/web/src/lib/messages.ts` (insert before `} as const;` at `:4749`)
- Modify: `apps/web/src/lib/messages.test.ts` (one new `describe` at the end; `readFileSync` and `join` are already imported, `:2-3`)

**Interfaces**
- Produces: every key below (each `.es` twin directly under its English key). Later tasks use exactly these names: 28 English keys, 56 lines.

- [ ] **Step 1: Write the failing test** at the end of `messages.test.ts`:

```ts
describe("S-06 part 2: forward to a record and Never record keys, English and Spanish (plan Task 2)", () => {
  const WANT: Record<string, string> = {
    "contact.forwarding.label": "Forwarding address",
    "contact.forwarding.label.es": "Dirección para reenviar",
    "contact.forwarding.hint": "Forward an email here to save it on this customer.",
    "contact.forwarding.hint.es": "Reenvíe un correo a esta dirección para guardarlo con este cliente.",
    "contact.forwarding.copy": "Copy",
    "contact.forwarding.copy.es": "Copiar",
    "contact.forwarding.copyLabel": "Copy the forwarding address",
    "contact.forwarding.copyLabel.es": "Copiar la dirección para reenviar",
    "contact.forwarding.copied": "Copied",
    "contact.forwarding.copied.es": "Copiado",
    "contact.forwarding.copyFailed": "Couldn't copy. Select the address and copy it by hand.",
    "contact.forwarding.copyFailed.es": "No se pudo copiar. Seleccione la dirección y cópiela a mano.",
    "contact.forwarding.turnOn": "Turn on Replies in Settings to get a forwarding address",
    "contact.forwarding.turnOn.es": "Active Respuestas en Configuración para obtener una dirección para reenviar",
    "contact.forwarding.failed": "We couldn't load the forwarding address. Reload the page to try again.",
    "contact.forwarding.failed.es": "No pudimos cargar la dirección para reenviar. Vuelva a cargar la página para intentarlo de nuevo.",
    "conversations.forward.by": "Forwarded by {name} · team",
    "conversations.forward.by.es": "Reenviado por {name} · equipo",
    "conversations.forward.bySomeone": "Forwarded by someone on the team",
    "conversations.forward.bySomeone.es": "Reenviado por alguien del equipo",
    "neverLog.title": "Never record",
    "neverLog.title.es": "No registrar nunca",
    "neverLog.body": "Mail from these addresses or domains is dropped and never saved, even when it comes from a customer.",
    "neverLog.body.es": "El correo de estas direcciones o dominios se descarta y nunca se guarda, aunque venga de un cliente.",
    "neverLog.empty": "Mail from addresses or domains you add here is never saved.",
    "neverLog.empty.es": "El correo de las direcciones o dominios que agregue aquí nunca se guarda.",
    "neverLog.loadFailed": "We couldn't load this list. Reload the page to try again.",
    "neverLog.loadFailed.es": "No pudimos cargar esta lista. Vuelva a cargar la página para intentarlo de nuevo.",
    "neverLog.inputLabel": "Address or domain",
    "neverLog.inputLabel.es": "Dirección o dominio",
    "neverLog.placeholder": "billing@supplier.com or supplier.com",
    "neverLog.placeholder.es": "facturas@proveedor.com o proveedor.com",
    "neverLog.add": "Add",
    "neverLog.add.es": "Agregar",
    "neverLog.remove": "Remove",
    "neverLog.remove.es": "Quitar",
    "neverLog.removeLabel": "Remove {pattern}",
    "neverLog.removeLabel.es": "Quitar {pattern}",
    "neverLog.kind.address": "Address",
    "neverLog.kind.address.es": "Dirección",
    "neverLog.kind.domain": "Whole domain",
    "neverLog.kind.domain.es": "Todo el dominio",
    "neverLog.added": "Mail from {pattern} will never be saved.",
    "neverLog.added.es": "El correo de {pattern} nunca se guardará.",
    "neverLog.removed": "{pattern} is off the list.",
    "neverLog.removed.es": "{pattern} ya no está en la lista.",
    "neverLog.undone": "Back as it was.",
    "neverLog.undone.es": "Quedó como estaba.",
    "neverLog.duplicate": "Already on the list.",
    "neverLog.duplicate.es": "Ya está en la lista.",
    "neverLog.invalid": "Enter an address like name@example.com or a domain like example.com.",
    "neverLog.invalid.es": "Escriba una dirección como nombre@ejemplo.com o un dominio como ejemplo.com.",
    "neverLog.full": "The list is full (200). Remove one to add another.",
    "neverLog.full.es": "La lista está llena (200). Quite una para agregar otra.",
    "neverLog.failed": "That didn't save. Try again.",
    "neverLog.failed.es": "No se guardó. Inténtelo de nuevo.",
  };

  it("has every key with exactly this text (mutation: change any .es string → FAILS naming it)", () => {
    for (const [k, v] of Object.entries(WANT)) expect((m as Record<string, string>)[k], k).toBe(v);
  });

  it("is 28 English keys, each with its .es twin on the very next line (mutation: move a twin → FAILS)", () => {
    const en = Object.keys(WANT).filter((x) => !x.endsWith(".es"));
    expect(en).toHaveLength(28);
    const src = readFileSync(join(__dirname, "messages.ts"), "utf8").split("\n");
    for (const k of en) {
      const i = src.findIndex((l) => l.trimStart().startsWith(`"${k}":`));
      expect(i, k).toBeGreaterThan(-1);
      expect(src[i + 1]!.trimStart().startsWith(`"${k}.es":`), k).toBe(true);
    }
  });

  it("Spanish is usted, and every placeholder survives translation (mutation: 'Vuelve a cargar' in .failed.es → FAILS; drop {pattern} from added.es → FAILS)", () => {
    const TU = /\b(vuelve|inténtalo|revisa|escribe|agrégalo|puedes|tienes|tus?|reenvía|selecciona|quita|activa)\b/i;
    for (const k of Object.keys(WANT).filter((x) => x.endsWith(".es"))) {
      expect(TU.test(WANT[k]!), k).toBe(false);
      const en = WANT[k.slice(0, -3)]!;
      const ph = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((x) => x[1]).sort();
      expect(ph(WANT[k]!), k).toEqual(ph(en));
    }
  });

  it("no key uses provider or internal words (mutation: 'token' in contact.forwarding.hint → FAILS)", () => {
    const BANNED = /\b(token|dkim|dmarc|spf|ses|webhook|resend|mx|clerk|pattern)\b/i;
    for (const [k, v] of Object.entries(WANT)) expect(BANNED.test(v.replace(/\{pattern\}/g, "")), k).toBe(false);
  });
});
```

- [ ] **Step 2: Run it to see it fail.** `pnpm --filter web exec vitest run src/lib/messages.test.ts` → the new describe FAILS (keys missing).
- [ ] **Step 3: Add the keys** to `messages.ts` before `} as const;`, each English line followed directly by its `.es` line, copying every string from `WANT` (the middle dot in `conversations.forward.by` is `·`, U+00B7).
- [ ] **Step 4: Run to pass**, plus `src/lib/i18n/ratchet.test.ts` and `src/lib/i18n/accents-guard.test.ts` → PASS. `pnpm --filter web typecheck` → 0.
- [ ] **Step 5: Probes.** Change `"contact.forwarding.failed.es"` to `"No pudimos cargar la dirección para reenviar. Vuelve a cargar la página para intentarlo de nuevo."` → cases 1 and 3 FAIL by name; edit back. Delete `{pattern}` from `"neverLog.added.es"` → cases 1 and 3 FAIL; edit back. Paste both failing lines.
- [ ] **Step 6: Commit** `-- apps/web/src/lib/messages.ts apps/web/src/lib/messages.test.ts`, message "copy: forwarding address and Never record keys, English and Spanish (S-06 part 2)".

---

## Task 3: `@bis/db`: the never-record module and rules, `matchTeamSender`, `createMessage`'s author (bis-comms)

**Review:** opus. **After:** Task 1. **Scratch:** `<SCRATCH>/s06b-t3-impl/`, ports `55642`/`55643`/`55644`.

**Files**
- Create: `packages/db/src/never-log-rules.ts`, `packages/db/src/never-log.ts`
- Create: `packages/db/src/test/never-log.test.ts`, `apps/web/src/lib/email/inbound/never-log-rules.test.ts`
- Modify: `packages/db/package.json` (`exports` gains `"./never-log-rules": "./src/never-log-rules.ts"`)
- Modify: `packages/db/src/inbound-email.ts` (append `matchTeamSender`)
- Modify: `packages/db/src/messaging.ts:12-36` (`NewMessage.author`), `:136-153` (`createMessage` honours it)
- Modify: `packages/db/src/index.ts` (export the new names beside part 1's block, `:78-85`)

**Interfaces**
- Produces (`@bis/db/never-log-rules`, pure): `type NeverLogKind = "address" | "domain"`; `type NeverLogPattern = { pattern: string; kind: NeverLogKind }`; `NEVER_LOG_MAX = 200`; `parseNeverLogPattern(input: string): NeverLogPattern | null`; `neverLogMatches(entries: readonly NeverLogPattern[], fromAddress: string | null): boolean`; re-export `emailKey`.
- Produces (`@bis/db`): `type NeverLogEntry = NeverLogPattern & { id: string; addedBy: string; createdAt: string }`; `listNeverLog(db, accountId): Promise<NeverLogEntry[]>` (newest first, up to 1000, THROWS on error); `addNeverLog(db, accountId, p: NeverLogPattern, actorId): Promise<{ outcome: "added"; entry: NeverLogEntry } | { outcome: "duplicate" } | { outcome: "full" }>`; `removeNeverLog(db, accountId, id, actorId): Promise<NeverLogEntry | null>`; `type TeamSender = { userId: string } | { mailbox: true }`; `matchTeamSender(db, accountId, fromEmail): Promise<TeamSender | null>`; `NewMessage.author?: { kind: "person"; id: string | null }`.

- [ ] **Step 1: Read before writing.** `sed -n 1,30p packages/db/src/inbound-email.ts`, `sed -n 296,328p packages/db/src/inbound-email.ts` (the head-count rule and `matchSender`'s shape), `sed -n 10,40p packages/db/src/messaging.ts`, `sed -n 130,170p packages/db/src/messaging.ts`, `sed -n 1,30p packages/db/src/provenance.ts`, `sed -n 195,205p packages/db/src/contacts.ts`, `sed -n 1,30p packages/db/src/test/inbound-email.test.ts` (the `withTestAccount` shape). Then `grep -rn "createMessage(" packages/db/src/test apps/web/src --include=*.test.ts | head` to see which tests pin `createMessage`'s insert (none may change).

- [ ] **Step 2: Write the failing pure-rules test** `apps/web/src/lib/email/inbound/never-log-rules.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { parseNeverLogPattern, neverLogMatches, NEVER_LOG_MAX, type NeverLogPattern } from "@bis/db/never-log-rules";

/** S-06 part 2 (spec "The Never record list", "Pipeline order" 2, "Tests"). The real module, never a mock. */
describe("parseNeverLogPattern", () => {
  it("an address becomes its email key; a domain stays itself, lowercase (mutation: skip emailKey → '+tag' survives, FAILS)", () => {
    expect(parseNeverLogPattern("  Billing+Q3@Supplier.COM ")).toEqual({ pattern: "billing@supplier.com", kind: "address" });
    expect(parseNeverLogPattern("Supplier.com")).toEqual({ pattern: "supplier.com", kind: "domain" });
    expect(parseNeverLogPattern("mail.supplier.co")).toEqual({ pattern: "mail.supplier.co", kind: "domain" });
  });

  it("refuses everything else (mutation: accept a dotless domain → 'supplier' parses, FAILS)", () => {
    for (const bad of ["", "   ", "supplier", "@supplier.com", "a@@supplier.com", "a b@supplier.com", "a@supplier", "+x@supplier.com", "supplier..com", "-supplier.com", `${"a".repeat(250)}.com`, "a@b@c.com", "http://supplier.com"]) {
      expect(parseNeverLogPattern(bad), bad).toBeNull();
    }
  });

  it("the cap is 200 (spec; mutation: 100 → FAILS)", () => {
    expect(NEVER_LOG_MAX).toBe(200);
  });
});

describe("neverLogMatches", () => {
  const LIST: NeverLogPattern[] = [{ pattern: "billing@vendor.com", kind: "address" }, { pattern: "supplier.com", kind: "domain" }];

  it("an address entry matches the sender's email key exactly (mutation: compare the raw address → the +tag sender escapes, FAILS)", () => {
    expect(neverLogMatches(LIST, "billing@vendor.com")).toBe(true);
    expect(neverLogMatches(LIST, "billing+x@vendor.com")).toBe(true);
    expect(neverLogMatches(LIST, "sales@vendor.com")).toBe(false);
  });

  it("a domain entry matches the domain and any subdomain, never a lookalike (mutation: endsWith(pattern) without the dot → notsupplier.com matches, FAILS)", () => {
    expect(neverLogMatches(LIST, "ana@supplier.com")).toBe(true);
    expect(neverLogMatches(LIST, "ana@mail.supplier.com")).toBe(true);
    expect(neverLogMatches(LIST, "ana@notsupplier.com")).toBe(false);
    expect(neverLogMatches(LIST, "ana@supplier.com.evil.io")).toBe(false);
  });

  it("an unparseable From (null) never matches, and an empty list matches nothing (mutation: treat null as '' and match a '' domain → FAILS)", () => {
    expect(neverLogMatches(LIST, null)).toBe(false);
    expect(neverLogMatches([], "ana@supplier.com")).toBe(false);
  });
});
```

- [ ] **Step 3: Write the failing db test** `packages/db/src/test/never-log.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import "dotenv/config";
import { withTestAccount } from "./fixtures";
import { listNeverLog, addNeverLog, removeNeverLog } from "../never-log";
import { matchTeamSender } from "../inbound-email";
import { createMessage, ensureConversation } from "../messaging";
import { createContact } from "../contacts";

const ACTOR = "user_test";
const RUN = Math.random().toString(36).slice(2, 10);

describe("the Never record list (0083)", () => {
  it("adds, refuses a duplicate, lists newest first, removes once, scoped to its account (mutation: drop .eq('account_id') from removeNeverLog → account B's remove deletes A's row, FAILS)", async () => {
    await withTestAccount(async (db, a) => {
      await withTestAccount(async (_db, b) => {
        const one = await addNeverLog(db, a, { pattern: `x${RUN}.com`, kind: "domain" }, ACTOR);
        const two = await addNeverLog(db, a, { pattern: `billing@y${RUN}.com`, kind: "address" }, ACTOR);
        expect(one.outcome).toBe("added");
        expect(await addNeverLog(db, a, { pattern: `x${RUN}.com`, kind: "domain" }, ACTOR)).toEqual({ outcome: "duplicate" });
        expect((await listNeverLog(db, a)).map((e) => e.pattern)).toEqual([`billing@y${RUN}.com`, `x${RUN}.com`]);
        const id = one.outcome === "added" ? one.entry.id : "";
        expect(await removeNeverLog(db, b, id, ACTOR)).toBeNull();
        expect((await listNeverLog(db, a))).toHaveLength(2);
        expect(await removeNeverLog(db, a, id, ACTOR)).toMatchObject({ id, pattern: `x${RUN}.com`, kind: "domain", addedBy: ACTOR });
        expect(await removeNeverLog(db, a, id, ACTOR)).toBeNull();
        expect(two.outcome).toBe("added");
      });
    });
  });

  it("answers full at 200 entries and adds nothing (mutation: >= → > → the 201st lands, FAILS)", async () => {
    await withTestAccount(async (db, a) => {
      const rows = Array.from({ length: 200 }, (_, i) => ({ account_id: a, pattern: `d${i}.${RUN}.com`, kind: "domain", added_by: ACTOR }));
      const { error } = await db.from("inbound_never_log").insert(rows);
      expect(error).toBeNull();
      expect(await addNeverLog(db, a, { pattern: `last.${RUN}.com`, kind: "domain" }, ACTOR)).toEqual({ outcome: "full" });
      expect(await listNeverLog(db, a)).toHaveLength(200);
    });
  });
});

describe("matchTeamSender (spec §3)", () => {
  it("a member of this account by email key (any role), then the account's reply-to mailbox; never another account's member (mutation: drop .eq('account_id') → B's member matches on A, FAILS; drop the mailbox branch → FAILS)", async () => {
    await withTestAccount(async (db, a) => {
      await withTestAccount(async (_db, b) => {
        const mk = async (sub: string, email: string, acct: string, role: string) => {
          const { data: u, error } = await db.from("users").insert({ clerk_user_id: sub, email }).select("id").single();
          expect(error).toBeNull();
          const { error: e2 } = await db.from("memberships").insert({ user_id: u!.id, scope: "account", account_id: acct, role });
          expect(e2).toBeNull();
          return u!.id as string;
        };
        const users: string[] = [];
        try {
          users.push(await mk(`u_tech_${RUN}`, `Maria.Tech+bis@Example.com`, a, "technician"));
          users.push(await mk(`u_other_${RUN}`, `luis.${RUN}@example.com`, b, "owner"));
          expect(await matchTeamSender(db, a, "maria.tech@example.com")).toEqual({ userId: `u_tech_${RUN}` });
          expect(await matchTeamSender(db, a, `luis.${RUN}@example.com`)).toBeNull();
          const { error } = await db.from("accounts").update({ reply_to_email: `Office+in@Shop${RUN}.com` }).eq("id", a);
          expect(error).toBeNull();
          expect(await matchTeamSender(db, a, `office@shop${RUN}.com`)).toEqual({ mailbox: true });
          expect(await matchTeamSender(db, a, "stranger@example.com")).toBeNull();
          expect(await matchTeamSender(db, a, "")).toBeNull();
        } finally {
          await db.from("memberships").delete().in("user_id", users);
          const { error } = await db.from("users").delete().in("id", users);
          expect(error).toBeNull();
        }
      });
    });
  });
});

describe("createMessage's explicit author (plan G3)", () => {
  it("an inbound message with author person stores the person mark and its id; without it, inbound stays the customer's (mutation: ignore input.author → author_kind customer, FAILS)", async () => {
    await withTestAccount(async (db, a) => {
      const { id: contactId } = await createContact(db, a, { firstName: "Ana", email: `ana.${RUN}@example.com` }, ACTOR);
      const { id: conversationId } = await ensureConversation(db, a, contactId, ACTOR, "system");
      const fwd = await createMessage(db, a, { conversationId, channel: "email", direction: "inbound", body: "fw", author: { kind: "person", id: `u_m_${RUN}` } }, "email-inbound", "system");
      const box = await createMessage(db, a, { conversationId, channel: "email", direction: "inbound", body: "fw2", author: { kind: "person", id: null } }, "email-inbound", "system");
      const cust = await createMessage(db, a, { conversationId, channel: "email", direction: "inbound", body: "hi" }, "email-inbound", "system");
      const { data } = await db.from("messages").select("id, author_kind, author_id").in("id", [fwd.id, box.id, cust.id]);
      const by = new Map((data ?? []).map((r) => [r.id, { kind: r.author_kind, id: r.author_id }]));
      expect(by.get(fwd.id)).toEqual({ kind: "person", id: `u_m_${RUN}` });
      expect(by.get(box.id)).toEqual({ kind: "person", id: null });
      expect(by.get(cust.id)).toEqual({ kind: "customer", id: null });
    });
  });
});
```

If `withTestAccount` cannot nest (read `fixtures.ts:140-149`; it can: each call makes its own account), keep it; if `createContact`'s or `ensureConversation`'s signature differs, follow the file and say so.

- [ ] **Step 4: Run both to see them fail.** `pnpm --filter web exec vitest run src/lib/email/inbound/never-log-rules.test.ts` → FAILS (no module `@bis/db/never-log-rules`). The db test: build the kit's `post` (`bash "$S/s06b-kit/replica.sh" 55642 "$S/s06b-t3-impl"`), start PostgREST (`bash "$S/s06b-kit/pgrst.sh" 55642 55643 55644 "$S/s06b-t3-impl"`), export the two variables it prints, then `cd packages/db && node node_modules/vitest/vitest.mjs run src/test/never-log.test.ts > "$S/s06b-t3-impl/red.log" 2>&1; echo $? > "$S/s06b-t3-impl/red.exit"` → FAILS (no module). Paste both summary blocks.

- [ ] **Step 5: Write `packages/db/src/never-log-rules.ts`:**

```ts
import { emailKey } from "./contacts";

/**
 * S-06 part 2 (0083): the Never record list's two pure rules. Imported by the web from the SUBPATH
 * `@bis/db/never-log-rules`, so a test that mocks `@bis/db` still runs the real matcher.
 * SQL twin of parseNeverLogPattern: 0083's inbound_never_log_pattern_check.
 */
export { emailKey };
export type NeverLogKind = "address" | "domain";
export type NeverLogPattern = { pattern: string; kind: NeverLogKind };
/** Spec: at most 200 entries per account (enforced by addNeverLog; plan G11). */
export const NEVER_LOG_MAX = 200;

const DOMAIN = /^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;
// RFC 5322 atext, lowercase, without "+": an address entry is stored as its email key, which has no +tag.
const LOCAL = /^[a-z0-9.!#$%&'*/=?^_`{|}~-]+$/;

export function parseNeverLogPattern(input: string): NeverLogPattern | null {
  const v = input.trim().toLowerCase();
  if (!v || v.length > 254 || /\s/.test(v)) return null;
  const at = v.indexOf("@");
  if (at === -1) return DOMAIN.test(v) ? { pattern: v, kind: "domain" } : null;
  if (at === 0 || at !== v.lastIndexOf("@")) return null;
  const key = emailKey(v);
  const k = key.indexOf("@");
  const local = key.slice(0, k);
  const domain = key.slice(k + 1);
  if (!local || !LOCAL.test(local) || !DOMAIN.test(domain) || key.length > 254) return null;
  return { pattern: key, kind: "address" };
}

/** The sender is on the list: an address entry equals its email key; a domain entry is its domain or a parent of it. */
export function neverLogMatches(entries: readonly NeverLogPattern[], fromAddress: string | null): boolean {
  if (!fromAddress) return false;
  const key = emailKey(fromAddress);
  const at = key.lastIndexOf("@");
  if (at <= 0 || at === key.length - 1) return false;
  const domain = key.slice(at + 1);
  return entries.some((e) => (e.kind === "address" ? e.pattern === key : domain === e.pattern || domain.endsWith(`.${e.pattern}`)));
}
```

Add `"./never-log-rules": "./src/never-log-rules.ts"` to `packages/db/package.json`'s `exports`, after `"./document-rules"`.

- [ ] **Step 6: Write `packages/db/src/never-log.ts`:**

```ts
import type { SupabaseClient } from "@supabase/supabase-js";
import { emit } from "./events";
import { NEVER_LOG_MAX, type NeverLogKind, type NeverLogPattern } from "./never-log-rules";

/**
 * S-06 part 2 (0083): the account's Never record list. Writes are server-only (0053): callers pass the
 * service client after their own role proof (the actions' requireAccountOwner). Every read and write
 * is scoped to the account; an entry id is never trusted alone.
 */
export type NeverLogEntry = NeverLogPattern & { id: string; addedBy: string; createdAt: string };
export type AddNeverLogResult = { outcome: "added"; entry: NeverLogEntry } | { outcome: "duplicate" } | { outcome: "full" };

const COLS = "id, pattern, kind, added_by, created_at";
/** PostgREST's max_rows. Above NEVER_LOG_MAX on purpose: a race past the cap (plan G11) still drops. */
const READ_LIMIT = 1000;
type Raw = { id: string; pattern: string; kind: NeverLogKind; added_by: string; created_at: string };
const toEntry = (r: Raw): NeverLogEntry => ({
  id: r.id, pattern: r.pattern, kind: r.kind, addedBy: r.added_by, createdAt: new Date(r.created_at).toISOString(),
});

export async function listNeverLog(db: SupabaseClient, accountId: string): Promise<NeverLogEntry[]> {
  const { data, error } = await db.from("inbound_never_log").select(COLS).eq("account_id", accountId)
    .order("created_at", { ascending: false }).order("id", { ascending: false }).limit(READ_LIMIT);
  if (error) throw new Error(`listNeverLog failed: ${error.message}`);
  return ((data ?? []) as Raw[]).map(toEntry);
}

export async function addNeverLog(db: SupabaseClient, accountId: string, p: NeverLogPattern, actorId: string): Promise<AddNeverLogResult> {
  const { data: same, error: sErr } = await db.from("inbound_never_log").select("id")
    .eq("account_id", accountId).eq("pattern", p.pattern).maybeSingle();
  if (sErr) throw new Error(`addNeverLog duplicate read failed: ${sErr.message}`);
  if (same) return { outcome: "duplicate" };
  const { count, error: cErr } = await db.from("inbound_never_log").select("id", { count: "exact", head: true }).eq("account_id", accountId);
  if (cErr) throw new Error(`addNeverLog count failed: ${cErr.message}`);
  if (count === null) throw new Error("addNeverLog: no count");
  if (count >= NEVER_LOG_MAX) return { outcome: "full" };
  const { data, error } = await db.from("inbound_never_log")
    .insert({ account_id: accountId, pattern: p.pattern, kind: p.kind, added_by: actorId }).select(COLS).single();
  if (error?.code === "23505") return { outcome: "duplicate" };
  if (error || !data) throw new Error(`addNeverLog failed: ${error?.message}`);
  const entry = toEntry(data as Raw);
  // The event names the row and its kind, never the pattern (an address is personal data).
  await emit(db, accountId, "account.never_log_added", actorId, { id: entry.id, kind: entry.kind });
  return { outcome: "added", entry };
}

export async function removeNeverLog(db: SupabaseClient, accountId: string, id: string, actorId: string): Promise<NeverLogEntry | null> {
  const { data, error } = await db.from("inbound_never_log").delete().eq("account_id", accountId).eq("id", id).select(COLS);
  if (error) throw new Error(`removeNeverLog failed: ${error.message}`);
  const row = ((data ?? []) as Raw[])[0];
  if (!row) return null;
  await emit(db, accountId, "account.never_log_removed", actorId, { id: row.id, kind: row.kind });
  return toEntry(row);
}
```

- [ ] **Step 7: Append `matchTeamSender` to `packages/db/src/inbound-email.ts`:**

```ts
/** S-06 part 2 (spec §3; G1 as ruled 2026-10-17, G2): the team is the account's members (any role) and
 *  its reply-to mailbox, by email key. BIS agency staff are NOT the team. userId is the Clerk id every
 *  person column stores. */
export type TeamSender = { userId: string } | { mailbox: true };

export async function matchTeamSender(db: SupabaseClient, accountId: string, fromEmail: string): Promise<TeamSender | null> {
  const key = emailKey(fromEmail);
  if (!key || !key.includes("@")) return null;
  const { data, error } = await db.from("memberships").select("users!inner(clerk_user_id, email)")
    .eq("scope", "account").eq("account_id", accountId);
  if (error) throw new Error(`matchTeamSender members read failed: ${error.message}`);
  const hit = ((data ?? []) as unknown as { users: { clerk_user_id: string; email: string } }[])
    .filter((r) => emailKey(r.users.email) === key).map((r) => r.users.clerk_user_id).sort()[0];
  if (hit) return { userId: hit };
  const { data: acct, error: aErr } = await db.from("accounts").select("reply_to_email").eq("id", accountId).maybeSingle();
  if (aErr) throw new Error(`matchTeamSender mailbox read failed: ${aErr.message}`);
  const mailbox = (acct as { reply_to_email: string | null } | null)?.reply_to_email ?? null;
  return mailbox && emailKey(mailbox) === key ? { mailbox: true } : null;
}
```

- [ ] **Step 8: `createMessage`'s explicit author.** In `messaging.ts`, `NewMessage` gains, after `meta`:

```ts
  /** S-06 part 2 (plan G3): the author when it is not the default mapping. Only the inbound pipeline's
   *  team forward sets it (an inbound message a teammate sent); every other writer leaves it unset. */
  author?: { kind: "person"; id: string | null };
```

and in `createMessage` replace `const author = messageAuthor(actorType, actorId, input.direction);` with:

```ts
  const author = input.author
    ? { authorKind: "person" as const, authorId: input.author.id?.trim() || null }
    : messageAuthor(actorType, actorId, input.direction);
```

- [ ] **Step 9: Export** from `packages/db/src/index.ts`, beside part 1's block: `matchTeamSender, type TeamSender` (add to the `./inbound-email` export list) and a new line `export { listNeverLog, addNeverLog, removeNeverLog, type NeverLogEntry, type AddNeverLogResult } from "./never-log";` plus `export { NEVER_LOG_MAX, parseNeverLogPattern, neverLogMatches, type NeverLogKind, type NeverLogPattern } from "./never-log-rules";`.

- [ ] **Step 10: Run to pass.** The web rules test → PASS. On the kit behind PostgREST: `never-log.test.ts`, `inbound-email.test.ts` (part 1's, unchanged), `provenance-parity.test.ts` → PASS. `pnpm --filter @bis/db typecheck` and `pnpm --filter web typecheck` → 0. Paste the summary blocks.

- [ ] **Step 11: Probes, each by name, edited back:** (a) `neverLogMatches` with `domain.endsWith(e.pattern)` (no dot) → the lookalike case FAILS; (b) `parseNeverLogPattern` returning `v` instead of `key` for an address → the `+Q3` case FAILS; (c) `removeNeverLog` without `.eq("account_id", accountId)` → the account-B remove FAILS; (d) `count >= NEVER_LOG_MAX` → `count > NEVER_LOG_MAX` → the full case FAILS; (e) `matchTeamSender` without `.eq("account_id", accountId)` → FAILS on `luis`; (f) `createMessage` ignoring `input.author` → the author case FAILS. Paste each failing assertion line.

- [ ] **Step 12: Commit** `-- packages/db/src/never-log-rules.ts packages/db/src/never-log.ts packages/db/src/test/never-log.test.ts packages/db/src/inbound-email.ts packages/db/src/messaging.ts packages/db/src/index.ts packages/db/package.json apps/web/src/lib/email/inbound/never-log-rules.test.ts`, message "db: the Never record list and its rules, the team sender match, an explicit message author (S-06 part 2)".

---

## Task 4: The automatic-mail detector (bis-comms)

**Review:** opus (a drop is irreversible: a false positive loses a customer's email for good). **Runs beside:** Tasks 1, 2.

**Files**
- Create: `apps/web/src/lib/email/inbound/automatic.ts` (+ `automatic.test.ts`)

**Interfaces**
- Consumes: `HeaderList` from `./auth-results` (`auth-results.ts:7`).
- Produces: `type AutomaticClass = "none" | "automatic" | "auto_forwarded"`; `classifyAutomatic(headers: HeaderList | null, fromAddress: string | null): AutomaticClass`. `"auto_forwarded"` means the ONLY marker is `Auto-Submitted: auto-forwarded` (G10 as ruled: the pipeline files it when the sender is on the team and drops it otherwise); any other marker, alone or beside it, is `"automatic"`.

- [ ] **Step 1: Read before writing.** `sed -n 1,30p apps/web/src/lib/email/inbound/auth-results.ts`.

- [ ] **Step 2: Write the failing test** `automatic.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { parseHeaderBlock } from "./auth-results";
import { classifyAutomatic } from "./automatic";

/** S-06 part 2, spec "Pipeline order" 1 and "Tests". Real header blocks through the real parser. */
const H = (block: string) => parseHeaderBlock(block);
const GMAIL_REPLY = H([
  "Authentication-Results: amazonses.com; spf=pass; dkim=pass header.i=@gmail.com; dmarc=pass header.from=gmail.com;",
  "From: Ana Ruiz <ana@gmail.com>",
  "Subject: Re: Thursday",
  "Content-Type: multipart/alternative; boundary=\"000000000000abc\"",
  "",
  "body",
].join("\r\n"));

describe("classifyAutomatic", () => {
  it("a normal Gmail reply is none (mutation: treat any Content-Type multipart as a report → FAILS)", () => {
    expect(classifyAutomatic(GMAIL_REPLY, "ana@gmail.com")).toBe("none");
  });

  it("Auto-Submitted present and not 'no' is automatic, any value or case; 'no' is none (mutation: only 'auto-replied' → auto-generated passes, FAILS)", () => {
    expect(classifyAutomatic(H("Auto-Submitted: auto-replied\r\n"), "ana@gmail.com")).toBe("automatic");
    expect(classifyAutomatic(H("auto-submitted: Auto-Generated\r\n"), "ana@gmail.com")).toBe("automatic");
    expect(classifyAutomatic(H("Auto-Submitted: auto-replied; owner-email=\"a@b.com\"\r\n"), "ana@gmail.com")).toBe("automatic");
    expect(classifyAutomatic(H("Auto-Submitted: No\r\n"), "ana@gmail.com")).toBe("none");
    expect(classifyAutomatic(H("Auto-Submitted: no (a person wrote this)\r\n"), "ana@gmail.com")).toBe("none");
  });

  it("auto-forwarded alone is its own class; beside any other marker it is automatic (G10 as ruled; mutation: answer automatic for auto-forwarded → a teammate's rule drops, FAILS; let auto-forwarded win over Precedence: bulk → a forwarded newsletter files, FAILS)", () => {
    expect(classifyAutomatic(H("Auto-Submitted: Auto-Forwarded\r\n"), "maria@rio.com")).toBe("auto_forwarded");
    expect(classifyAutomatic(H("Auto-Submitted: auto-forwarded\r\nPrecedence: bulk\r\n"), "maria@rio.com")).toBe("automatic");
    expect(classifyAutomatic(H("Precedence: bulk\r\nAuto-Submitted: auto-forwarded\r\n"), "maria@rio.com")).toBe("automatic");
    expect(classifyAutomatic(H("Auto-Submitted: auto-forwarded\r\n"), "mailer-daemon@rio.com")).toBe("automatic");
  });

  it("X-Autoreply, X-Autorespond or X-Autoresponse present is automatic (mutation: drop X-Autorespond → FAILS)", () => {
    for (const h of ["X-Autoreply: yes", "X-Autorespond: on", "X-AutoResponse: 1"]) expect(classifyAutomatic(H(`${h}\r\n`), "ana@gmail.com"), h).toBe("automatic");
  });

  it("Precedence auto_reply, bulk or junk is automatic; list is none (mutation: add list → a mailing-list reply drops, FAILS)", () => {
    for (const v of ["auto_reply", "bulk", "Junk"]) expect(classifyAutomatic(H(`Precedence: ${v}\r\n`), "ana@gmail.com"), v).toBe("automatic");
    expect(classifyAutomatic(H("Precedence: list\r\n"), "ana@gmail.com")).toBe("none");
  });

  it("a delivery-status report is automatic; another multipart/report is none (mutation: match multipart/report alone → a read receipt drops, FAILS)", () => {
    expect(classifyAutomatic(H("Content-Type: multipart/report; report-type=delivery-status; boundary=\"b\"\r\n"), "x@example.com")).toBe("automatic");
    expect(classifyAutomatic(H("Content-Type: Multipart/Report; boundary=\"b\"; report-type=\"delivery-status\"\r\n"), "x@example.com")).toBe("automatic");
    expect(classifyAutomatic(H("Content-Type: multipart/report; report-type=disposition-notification; boundary=\"b\"\r\n"), "x@example.com")).toBe("none");
  });

  it("a mailer-daemon or postmaster sender is automatic, even with no raw headers (G9; mutation: return none when headers are null before the From check → FAILS)", () => {
    expect(classifyAutomatic(null, "mailer-daemon@googlemail.com")).toBe("automatic");
    expect(classifyAutomatic(GMAIL_REPLY, "postmaster@example.com")).toBe("automatic");
    expect(classifyAutomatic(null, "ana@gmail.com")).toBe("none");
    expect(classifyAutomatic(null, null)).toBe("none");
    expect(classifyAutomatic(GMAIL_REPLY, "mailer-daemon.fan@example.com")).toBe("none");
  });

  it("a marker below the top-level block (inside the body) is not read (mutation: scan the whole raw text → FAILS)", () => {
    expect(classifyAutomatic(H("From: a@b.com\r\n\r\nAuto-Submitted: auto-replied\r\n"), "a@b.com")).toBe("none");
  });
});
```

- [ ] **Step 3: Run it to see it fail** (no module). Paste the summary.

- [ ] **Step 4: Write `automatic.ts`:**

```ts
import type { HeaderList } from "./auth-results";

/**
 * S-06 part 2, spec "Pipeline order" 1: automatic mail (out-of-office, auto-responders, bounces) is
 * dropped before anything is stored. Reads only the TOP-LEVEL header block (parseHeaderBlock stops at
 * the first blank line), never the body. G9: the mailer-daemon / postmaster rule reads the From the
 * API gives, so it applies even when the raw block is missing; every header rule needs the block.
 * G10 (ruled 2026-10-17): `Auto-Submitted: auto-forwarded` as the ONLY marker is "auto_forwarded"; the
 * pipeline files it for a team sender (a teammate's forwarding rule) and drops it for anyone else.
 */
export type AutomaticClass = "none" | "automatic" | "auto_forwarded";

const AUTO_REPLY_HEADERS = new Set(["x-autoreply", "x-autorespond", "x-autoresponse"]);
const PRECEDENCE = new Set(["auto_reply", "bulk", "junk"]);
const DAEMONS = new Set(["mailer-daemon", "postmaster"]);

function isDeliveryReport(contentType: string): boolean {
  const parts = contentType.toLowerCase().split(";").map((p) => p.trim());
  if (parts[0] !== "multipart/report") return false;
  return parts.slice(1).some((p) => p.replace(/\s+/g, "").replace(/"/g, "") === "report-type=delivery-status");
}

export function classifyAutomatic(headers: HeaderList | null, fromAddress: string | null): AutomaticClass {
  const at = fromAddress ? fromAddress.lastIndexOf("@") : -1;
  if (fromAddress && at > 0 && DAEMONS.has(fromAddress.slice(0, at).toLowerCase())) return "automatic";
  if (!headers) return "none";
  let autoForwarded = false;
  for (const [name, value] of headers) {
    if (name === "auto-submitted") {
      const v = value.toLowerCase().split(/[;(]/)[0]!.trim();
      if (v === "auto-forwarded") autoForwarded = true;
      else if (v !== "no") return "automatic";
    } else if (AUTO_REPLY_HEADERS.has(name)) {
      return "automatic";
    } else if (name === "precedence" && PRECEDENCE.has(value.trim().toLowerCase())) {
      return "automatic";
    } else if (name === "content-type" && isDeliveryReport(value)) {
      return "automatic";
    }
  }
  return autoForwarded ? "auto_forwarded" : "none";
}
```

- [ ] **Step 5: Run to pass**; `pnpm --filter web typecheck`; `pnpm --filter web exec eslint src/lib/email/inbound/automatic.ts`; `"src/app/(dashboard)/dashboard/accounts/[accountId]/in-account-service-reads.test.ts"` → PASS (no `serviceDb` in the new lib file).
- [ ] **Step 6: Probes, each by name, edited back:** (a) `isDeliveryReport` returning `parts[0] === "multipart/report"` → the read-receipt case FAILS; (b) `if (!headers) return "none";` moved above the daemon check → the null-headers case FAILS; (c) `v !== "no"` → `v === "auto-replied"` → the auto-generated case FAILS; (d) `auto-forwarded` answering `"automatic"` → the auto-forwarded case FAILS; (e) answering `"auto_forwarded"` the moment it is seen → the `Precedence: bulk` after it case FAILS. Paste each failing line.
- [ ] **Step 7: Commit** `-- apps/web/src/lib/email/inbound/automatic.ts apps/web/src/lib/email/inbound/automatic.test.ts`, message "inbound email: the automatic-mail detector, with the team forwarding-rule class (S-06 part 2)".

---

## Task 5: The pipeline's three new steps, the forward path in `file.ts`, the runbook (bis-comms)

**Review:** opus. **After:** Tasks 3, 4.

**Files**
- Modify: `apps/web/src/lib/email/inbound/pipeline.ts` (+ `pipeline.test.ts`)
- Modify: `apps/web/src/lib/email/inbound/file.ts` (+ `file.test.ts`)
- Modify: `docs/runbooks/inbound-email.md` (one new section)
- Unchanged: `apps/web/src/app/api/webhooks/resend/route.ts` (no new dependency: G1 as ruled removed the agency lookup) and `route.test.ts`; Step 8 runs `route.test.ts` to prove it.

**Interfaces**
- Consumes: `listNeverLog`, `matchTeamSender` (`@bis/db`, Task 3); `neverLogMatches` (`@bis/db/never-log-rules`, Task 3); `classifyAutomatic` (Task 4); `createMessage`'s `author` (Task 3).
- Produces: `PipelineOutcome`'s 503 results gain `"lookup_failed"` (`PipelineDeps` is unchanged); `FORWARD_ACTOR_ID = "email-inbound-forward"` (exported from `pipeline.ts`); `FileInput.forward?: { authorId: string | null }`; a forwarded message's `meta` is `{ inbound_email_id, attachment_count, forwarded: true, forwarded_by: <Clerk id or null>, consent: { kind: "none" } }` (Task 8 reads `forwarded` and `forwarded_by`).

**The order (spec "Pipeline order", G10 as ruled):** after the part 1 steps that resolve the thread and resume a stored row: (1) `classifyAutomatic` → `"automatic"` is dropped; `"auto_forwarded"` asks the team lookup FIRST (a read, nothing stored) and is dropped unless the sender is on the team; (2) Never record → dropped; (3) the sender check: the customer + authenticated → part 1's filed path; else the team + authenticated → the forward path; else held. The team answer is looked up at most once per delivery (memoised), so an auto-forwarded teammate's mail does not pay for it twice.

- [ ] **Step 1: Read before writing.** `pipeline.ts` whole, `file.ts` whole, `sed -n 1,60p apps/web/src/lib/email/inbound/pipeline.test.ts`, `sed -n 1,40p apps/web/src/lib/email/inbound/file.test.ts`, `docs/runbooks/inbound-email.md` (its section list).

- [ ] **Step 2: Write the failing pipeline tests.** In `pipeline.test.ts`: the hoisted `db` (`:3-7`) gains `matchTeamSender: vi.fn(), listNeverLog: vi.fn()`, and `beforeEach` adds `db.listNeverLog.mockResolvedValue([]); db.matchTeamSender.mockResolvedValue(null);` (the states a customer reply really meets: an empty list, a sender not on the team). Then append:

```ts
describe("S-06 part 2: drops, Never record, the team's forwards (spec 'Pipeline order', 'Failure behaviour')", () => {
  const MARIA_FWD = "---------- Forwarded message ---------\nFrom: Ana Ruiz <ana@gmail.com>\nDate: Tue\n\nCan we move Thursday?";
  const TEAM = (over: Record<string, unknown> = {}) => EMAIL({
    from: "Maria Lopez <maria@rio.com>", text: MARIA_FWD,
    rawHeaders: SES_OK.replace(/gmail\.com/g, "rio.com"), ...over,
  });

  it("automatic mail is dropped before anything is stored, logging only the account (mutation: run the drop after recordInboundEmail → a row is stored, FAILS)", async () => {
    fetchEmail.mockResolvedValue(EMAIL({ rawHeaders: `Auto-Submitted: auto-replied\r\n${SES_OK}` }));
    expect(await handleReceivedEmail(deps, { email_id: "re_1" })).toEqual({ status: 200, result: "dropped" });
    expect(db.recordInboundEmail).not.toHaveBeenCalled();
    expect(db.listNeverLog).not.toHaveBeenCalled();
    expect(db.matchTeamSender).not.toHaveBeenCalled();
    expect(log.mock.calls.map((c) => c[0])).toEqual(["inbound email: dropped (automatic) account=acc"]);
  });

  it("a bounce from mailer-daemon with no raw headers is dropped (G9; mutation: skip the detector when rawHeaders is null → it is held, FAILS)", async () => {
    fetchEmail.mockResolvedValue(EMAIL({ from: "Mail Delivery Subsystem <mailer-daemon@googlemail.com>", rawHeaders: null }));
    expect(await handleReceivedEmail(deps, { email_id: "re_1" })).toEqual({ status: 200, result: "dropped" });
    expect(db.recordInboundEmail).not.toHaveBeenCalled();
  });

  it("auto-forwarded mail from a teammate is NOT dropped: it files as their forward (G10 as ruled; mutation: drop every auto_forwarded → FAILS)", async () => {
    fetchEmail.mockResolvedValue(TEAM({ rawHeaders: `Auto-Submitted: auto-forwarded\r\n${SES_OK.replace(/gmail\.com/g, "rio.com")}` }));
    db.matchSender.mockResolvedValue(null);
    db.matchTeamSender.mockResolvedValue({ userId: "user_maria" });
    expect(await handleReceivedEmail(deps, { email_id: "re_1" })).toEqual({ status: 200, result: "filed" });
    expect(db.matchTeamSender).toHaveBeenCalledTimes(1);   // memoised: asked once for the exemption, reused for the sender check
    expect(file.fileInboundEmail.mock.calls[0]![1]).toMatchObject({ raiseUnread: false, forward: { authorId: "user_maria" } });
  });

  it("auto-forwarded mail from anyone not on the team is dropped as automatic, before the list read (G10 as ruled; mutation: exempt every auto_forwarded → the customer's own forwarding rule files, FAILS)", async () => {
    fetchEmail.mockResolvedValue(EMAIL({ rawHeaders: `Auto-Submitted: auto-forwarded\r\n${SES_OK}` }));
    expect(await handleReceivedEmail(deps, { email_id: "re_1" })).toEqual({ status: 200, result: "dropped" });
    expect(db.matchTeamSender).toHaveBeenCalledWith(deps.db, "acc", "ana@gmail.com");
    expect(db.listNeverLog).not.toHaveBeenCalled();
    expect(db.recordInboundEmail).not.toHaveBeenCalled();
    expect(log.mock.calls.map((c) => c[0])).toEqual(["inbound email: dropped (automatic) account=acc"]);
  });

  it("the team lookup failing for an auto-forwarded message answers 503, nothing stored (spec failure table; mutation: treat a failed lookup as not-team → dropped, FAILS)", async () => {
    fetchEmail.mockResolvedValue(TEAM({ rawHeaders: `Auto-Submitted: auto-forwarded\r\n${SES_OK.replace(/gmail\.com/g, "rio.com")}` }));
    db.matchTeamSender.mockRejectedValue(new Error("db"));
    expect(await handleReceivedEmail(deps, { email_id: "re_1" })).toEqual({ status: 503, result: "lookup_failed" });
    expect(db.recordInboundEmail).not.toHaveBeenCalled();
  });

  it("a listed sender is dropped even when the sender IS the customer, logging no address or pattern (mutation: check the list after the customer match → the customer files, FAILS)", async () => {
    db.listNeverLog.mockResolvedValue([{ id: "n1", pattern: "gmail.com", kind: "domain", addedBy: "u", createdAt: "x" }]);
    expect(await handleReceivedEmail(deps, { email_id: "re_1" })).toEqual({ status: 200, result: "dropped" });
    expect(db.listNeverLog).toHaveBeenCalledWith(deps.db, "acc");
    expect(db.recordInboundEmail).not.toHaveBeenCalled();
    expect(db.matchSender).not.toHaveBeenCalled();
    const lines = log.mock.calls.map((c) => c[0] as string);
    expect(lines).toEqual(["inbound email: dropped (never record) account=acc"]);
    expect(lines.join(" ")).not.toMatch(/gmail|ana@|re_1/);
  });

  it("a lookalike domain on the list does not drop (the real matcher runs; mutation: endsWith without the dot → dropped, FAILS)", async () => {
    db.listNeverLog.mockResolvedValue([{ id: "n1", pattern: "mail.com", kind: "domain", addedBy: "u", createdAt: "x" }]);
    expect(await handleReceivedEmail(deps, { email_id: "re_1" })).toEqual({ status: 200, result: "filed" });
  });

  it("the list read failing answers 503 and stores nothing (spec failure table; mutation: treat a failed read as an empty list → filed, FAILS)", async () => {
    db.listNeverLog.mockRejectedValue(new Error("db down"));
    expect(await handleReceivedEmail(deps, { email_id: "re_1" })).toEqual({ status: 503, result: "lookup_failed" });
    expect(db.recordInboundEmail).not.toHaveBeenCalled();
  });

  it("a member's authenticated forward is filed as a forward: the whole text, the forward marker, no unread, no owner copy, the member's Clerk id (mutation: raiseUnread true → FAILS; strip the quote → the customer's original is lost, FAILS)", async () => {
    fetchEmail.mockResolvedValue(TEAM());
    db.matchSender.mockResolvedValue(null);
    db.matchTeamSender.mockResolvedValue({ userId: "user_maria" });
    expect(await handleReceivedEmail(deps, { email_id: "re_1" })).toEqual({ status: 200, result: "filed" });
    expect(db.recordInboundEmail.mock.calls[0]![1]).toMatchObject({ status: "filed", holdReason: null, decidedBy: "email-inbound-forward", fromEmail: "maria@rio.com", text: MARIA_FWD });
    expect(file.fileInboundEmail.mock.calls[0]![1]).toMatchObject({ raiseUnread: false, sender: null, forward: { authorId: "user_maria" } });
    expect(forward).not.toHaveBeenCalled();
  });

  it("the reply-to mailbox files with no author id (spec §3; mutation: default the id → FAILS)", async () => {
    fetchEmail.mockResolvedValue(TEAM());
    db.matchSender.mockResolvedValue(null);
    db.matchTeamSender.mockResolvedValue({ mailbox: true });
    await handleReceivedEmail(deps, { email_id: "re_1" });
    expect(file.fileInboundEmail.mock.calls[0]![1].forward).toEqual({ authorId: null });
  });

  it("an unauthenticated teammate is held unverified with no team lookup (G13; mutation: file a team match without authentication → FAILS)", async () => {
    fetchEmail.mockResolvedValue(TEAM({ rawHeaders: null }));
    db.matchSender.mockResolvedValue(null);
    db.matchTeamSender.mockResolvedValue({ userId: "user_maria" });
    expect(await handleReceivedEmail(deps, { email_id: "re_1" })).toEqual({ status: 200, result: "held" });
    expect(db.recordInboundEmail.mock.calls[0]![1]).toMatchObject({ status: "held", holdReason: "unverified" });
    expect(db.matchTeamSender).not.toHaveBeenCalled();
    expect(file.fileInboundEmail).not.toHaveBeenCalled();
  });

  it("an authenticated sender who is neither the customer nor the team (a stranger, or BIS agency staff: G1 as ruled) is held not_on_record as in part 1 (mutation: file any authenticated sender → FAILS)", async () => {
    fetchEmail.mockResolvedValue(TEAM({ from: "Dan <dan@bis-rgv.com>", rawHeaders: SES_OK.replace(/gmail\.com/g, "bis-rgv.com") }));
    db.matchSender.mockResolvedValue(null);
    expect(await handleReceivedEmail(deps, { email_id: "re_1" })).toEqual({ status: 200, result: "held" });
    expect(db.recordInboundEmail.mock.calls[0]![1]).toMatchObject({ status: "held", holdReason: "not_on_record" });
    expect(file.fileInboundEmail).not.toHaveBeenCalled();
  });

  it("the customer still files exactly as part 1, and the team is never asked (mutation: check the team first → a customer who is also staff files as a forward, FAILS)", async () => {
    db.matchTeamSender.mockResolvedValue({ userId: "user_ana" });
    expect(await handleReceivedEmail(deps, { email_id: "re_1" })).toEqual({ status: 200, result: "filed" });
    expect(db.matchTeamSender).not.toHaveBeenCalled();
    expect(file.fileInboundEmail.mock.calls[0]![1]).toMatchObject({ raiseUnread: true });
    expect(file.fileInboundEmail.mock.calls[0]![1].forward).toBeUndefined();
    expect(forward).toHaveBeenCalledTimes(1);
  });

  it("the team lookup failing answers 503, nothing stored (spec failure table; mutation: catch and hold → FAILS)", async () => {
    fetchEmail.mockResolvedValue(TEAM());
    db.matchSender.mockResolvedValue(null);
    db.matchTeamSender.mockRejectedValue(new Error("db"));
    expect(await handleReceivedEmail(deps, { email_id: "re_1" })).toEqual({ status: 503, result: "lookup_failed" });
    expect(db.recordInboundEmail).not.toHaveBeenCalled();
  });

  it("a retried forward (row recorded, never linked) re-files as a forward with a fresh author lookup, still no unread and no owner copy (G5; mutation: resume ignoring decided_by → raiseUnread true and an owner copy, FAILS)", async () => {
    db.findInboundEmailByProviderId.mockResolvedValue({
      id: "ie_1", accountId: "acc", conversationId: "conv", status: "filed", holdReason: null, messageId: null,
      decidedBy: "email-inbound-forward", fromEmail: "maria@rio.com", fromName: "Maria Lopez", attachmentCount: 0, text: MARIA_FWD,
    });
    db.matchTeamSender.mockResolvedValue({ userId: "user_maria" });
    expect(await handleReceivedEmail(deps, { email_id: "re_1" })).toEqual({ status: 200, result: "filed" });
    expect(db.recordInboundEmail).not.toHaveBeenCalled();
    expect(db.matchSender).not.toHaveBeenCalled();
    expect(file.fileInboundEmail.mock.calls[0]![1]).toMatchObject({ raiseUnread: false, forward: { authorId: "user_maria" } });
    expect(forward).not.toHaveBeenCalled();
  });

  it("an entry added after the first delivery does not drop a row already stored (G16; mutation: run the drops before the existing-row branch → dropped, FAILS)", async () => {
    db.findInboundEmailByProviderId.mockResolvedValue({ id: "ie_1", accountId: "acc", conversationId: "conv", status: "held", holdReason: "not_on_record", messageId: null, decidedBy: null, fromEmail: "ana@gmail.com", attachmentCount: 0, text: "x" });
    db.listNeverLog.mockResolvedValue([{ id: "n1", pattern: "gmail.com", kind: "domain", addedBy: "u", createdAt: "x" }]);
    expect(await handleReceivedEmail(deps, { email_id: "re_1" })).toEqual({ status: 200, result: "duplicate" });
  });
});
```

(Every `listNeverLog` and `matchTeamSender` answer above is for THE thread's account `acc`, the only state production's account-scoped reads can reach. `findInboundEmailByProviderId`'s rows carry the columns `resumeExisting` reads.)

- [ ] **Step 3: Write the failing `file.ts` tests**, appended to `file.test.ts`:

```ts
describe("S-06 part 2: a team forward (spec §4)", () => {
  const FWD = { ...ROW, fromEmail: "maria@rio.com", text: "STOP\n\n---------- Forwarded message ---------\nFrom: Ana", decidedBy: "email-inbound-forward" };

  it("files the whole text as the teammate's message: the person mark, forwarded and forwarded_by in meta, no sender, no stop, unread untouched (mutation: classify the forward's STOP → recordInboundStop runs, FAILS)", async () => {
    expect(await fileInboundEmail({ db: DB, now: () => new Date() }, input({ row: FWD, sender: null, raiseUnread: false, forward: { authorId: "user_maria" } })))
      .toEqual({ messageId: "msg_1", created: true, consent: { kind: "none" } });
    expect(stop.recordInboundStop).not.toHaveBeenCalled();
    expect(db.getContact).not.toHaveBeenCalled();
    expect(db.createMessage).toHaveBeenCalledWith(DB, "acc", {
      conversationId: "conv", channel: "email", direction: "inbound", status: "delivered", subject: "Re: Hi", body: FWD.text,
      providerMessageId: "re_1",
      meta: { inbound_email_id: "re_1", attachment_count: 2, forwarded: true, forwarded_by: "user_maria", consent: { kind: "none" } },
      author: { kind: "person", id: "user_maria" },
    }, "email-inbound", "system");
    expect(db.incrementUnreadCount).not.toHaveBeenCalled();
    expect(db.setInboundMessage).toHaveBeenCalledWith(DB, "acc", "ie_1", "msg_1");
  });

  it("the reply-to mailbox's forward carries a null author id (spec: 'Someone on the team'; mutation: default the id to the actor → 'email-inbound', FAILS)", async () => {
    await fileInboundEmail({ db: DB, now: () => new Date() }, input({ row: FWD, sender: null, raiseUnread: false, forward: { authorId: null } }));
    expect(db.createMessage.mock.calls[0]![2]).toMatchObject({ author: { kind: "person", id: null }, meta: { forwarded: true, forwarded_by: null } });
  });

  it("a forward never raises unread even if a caller passes raiseUnread true (defence; mutation: drop the !forward guard → FAILS)", async () => {
    await fileInboundEmail({ db: DB, now: () => new Date() }, input({ row: FWD, sender: null, raiseUnread: true, forward: { authorId: "user_maria" } }));
    expect(db.incrementUnreadCount).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 4: Run to see them fail.** `pnpm --filter web exec vitest run src/lib/email/inbound/pipeline.test.ts src/lib/email/inbound/file.test.ts` → the new cases FAIL, the existing ones PASS. Paste the summary.

- [ ] **Step 5: Implement `file.ts`.** `FileInput` gains `forward?: { authorId: string | null };` with the comment "S-06 part 2: a teammate's forward (spec §4). The whole text, the person mark, no stop, no unread." In `fileInboundEmail`, after the `row.messageId !== null` early return:

```ts
  const forward = i.forward ?? null;
  let consent: MessageConsent = { kind: "none" };
  // Spec §4: the stop rule does NOT run on a forward (a forwarded STOP is not the customer's live
  // request; staff can press Stop emails).
  if (!forward) {
    // … the existing block, unchanged: stopFor, cls, bare, address, and the three consent branches …
  }
```

Move the existing lines from `const stopFor = …` through the `else if (cls.kind === "unclear" || cls.kind === "clear") { … }` block inside that `if`, unchanged (delete the old `let consent` line they declared). In the `else` branch that creates the message:

```ts
    const meta: Record<string, unknown> = { inbound_email_id: row.providerEmailId, attachment_count: i.attachmentCount };
    if (forward) {
      meta.forwarded = true;
      meta.forwarded_by = forward.authorId;   // G4: the inbox names the forwarder from this
    } else if (i.sender?.viaGroup) {
      meta.sender = { contact_id: i.sender.contactId, first_name: i.sender.firstName, last_name: i.sender.lastName };
    }
    meta.consent = consent;
    ({ id: messageId } = await createMessage(db, row.accountId, {
      conversationId: row.conversationId, channel: "email", direction: "inbound", status: "delivered",
      subject: row.subject ?? undefined, body: row.text, providerMessageId: row.providerEmailId, meta,
      ...(forward ? { author: { kind: "person" as const, id: forward.authorId } } : {}),
    }, i.actor.id, i.actor.type));
```

and change the unread line to `if (i.raiseUnread && !forward) await incrementUnreadCount(db, row.accountId, row.conversationId);`.

- [ ] **Step 6: Implement `pipeline.ts`.**
  - Imports: add `listNeverLog, matchTeamSender, type TeamSender` to the `@bis/db` import; `import { neverLogMatches } from "@bis/db/never-log-rules";`; `import { classifyAutomatic } from "./automatic";`.
  - `PipelineOutcome`'s 503 union becomes `"fetch_failed" | "write_failed" | "lookup_failed"`. `PipelineDeps` is unchanged.
  - After `const ACTOR = …`:

```ts
/** S-06 part 2 (G5): the decided_by of a webhook-filed team forward, the durable marker a retry reads. */
export const FORWARD_ACTOR_ID = "email-inbound-forward";
type Filing = { kind: "customer"; sender: SenderMatch | null } | { kind: "forward"; authorId: string | null };
/** Spec §3 (G1 as ruled): the account's members (any role) and its reply-to mailbox; never the agency. */
const authorOf = (t: TeamSender): string | null => ("userId" in t ? t.userId : null);
```

  - `resumeExisting`'s last parameter becomes `precomputed?: Filing`, and its `try` body becomes:

```ts
    let filing: Filing;
    if (precomputed) filing = precomputed;
    else if (row.decidedBy === FORWARD_ACTOR_ID) {
      // A retry of a forward: the author is looked up again (null if the person has since left).
      const bare = row.messageId === null ? bareAddress(row.fromEmail) : null;
      const t = bare ? await matchTeamSender(deps.db, row.accountId, bare) : null;
      filing = { kind: "forward", authorId: t ? authorOf(t) : null };
    } else {
      filing = { kind: "customer", sender: row.messageId !== null ? null : await matchSender(deps.db, row.accountId, contactId, row.fromEmail) };
    }
    const isForward = filing.kind === "forward";
    const result = await fileInboundEmail({ db: deps.db, now: deps.now }, {
      row, contactId, sender: filing.kind === "customer" ? filing.sender : null, attachmentCount: row.attachmentCount,
      raiseUnread: !isForward, actor: ACTOR, ...(filing.kind === "forward" ? { forward: { authorId: filing.authorId } } : {}),
    });
    // Spec §4: the owner's forwarded copy is NOT sent for a teammate's forward.
    if (result.created && !isForward) {
      // … the existing forward-to-owner try/catch, unchanged …
    }
    return { status: 200, result: result.created ? "filed" : "duplicate" };
```

  - After the `if (existingRow) { … }` block and BEFORE `let row: InboundEmailRow;`, the drops:

```ts
  // S-06 part 2, spec "Pipeline order" 1 and 2: dropped before anything is stored, stateless (a Resend
  // retry is dropped again). G16: a row already stored resumed above; a drop is never retroactive.
  const fromEmail = bareAddress(email.from);
  // The team answer, looked up at most once per delivery (the auto-forwarded exemption and the sender
  // check share it). THROWS on a read failure: each caller answers 503.
  let teamMemo: Promise<TeamSender | null> | null = null;
  const teamOf = () => (teamMemo ??= fromEmail ? matchTeamSender(deps.db, thread.accountId, fromEmail) : Promise.resolve(null));
  const auto = classifyAutomatic(email.rawHeaders ? parseHeaderBlock(email.rawHeaders) : null, fromEmail);
  let autoDrop = auto === "automatic";
  if (auto === "auto_forwarded") {
    // G10 as ruled: a teammate's forwarding rule files normally; anyone else's is automatic mail.
    try {
      autoDrop = (await teamOf()) === null;
    } catch {
      deps.log("inbound email: the team lookup failed; 503 so Resend retries");
      return { status: 503, result: "lookup_failed" };
    }
  }
  if (autoDrop) {
    deps.log(`inbound email: dropped (automatic) account=${thread.accountId}`);
    return { status: 200, result: "dropped" };
  }
  let neverLog: Awaited<ReturnType<typeof listNeverLog>>;
  try {
    neverLog = await listNeverLog(deps.db, thread.accountId);
  } catch {
    deps.log("inbound email: reading the never record list failed; 503 so Resend retries");
    return { status: 503, result: "lookup_failed" };
  }
  if (neverLogMatches(neverLog, fromEmail)) {
    deps.log(`inbound email: dropped (never record) account=${thread.accountId}`);
    return { status: 200, result: "dropped" };
  }
```

  - Inside the existing `try`: delete its own `const fromEmail = bareAddress(email.from);` (now above); rename `firstRunMatch` to `firstRunFiling: Filing | undefined`; after `const match = …`:

```ts
    // Spec "Pipeline order" 3 and G13: the team only when the customer did not match and the forgery
    // check passed; an unauthenticated sender is held unverified without a lookup.
    let team: { authorId: string | null } | null = null;
    if (authenticated && match === null && fromEmail) {
      try {
        const t = await teamOf();
        team = t ? { authorId: authorOf(t) } : null;
      } catch {
        deps.log("inbound email: the team lookup failed; 503 so Resend retries");
        return { status: 503, result: "lookup_failed" };
      }
    }
    const filed = authenticated && (match !== null || team !== null);
    const whole = email.text?.trim() ? email.text : (email.html ? htmlToText(email.html) : "");
    // Spec §4: a forward keeps the whole text (the customer's original is the point of it).
    const text = team ? whole.trim() : newText(whole);
    firstRunFiling = team ? { kind: "forward", authorId: team.authorId } : { kind: "customer", sender: match };
```

    and in the `recordInboundEmail` call `decidedBy: filed ? (team ? FORWARD_ACTOR_ID : ACTOR.id) : null`. The final line becomes `return await resumeExisting(deps, row, thread.contactId, rowCreated ? firstRunFiling : undefined);`.

- [ ] **Step 7: The runbook.** Append to `docs/runbooks/inbound-email.md` a section "Forwarding to a record, and Never record (S-06 part 2)": the forwarding address is the customer's reply address, shown on their record; who counts as the team (anyone with a membership in the account, any role, and the account's reply-to mailbox; NOT BIS agency staff, whose forwards wait in Needs a look like any other sender) and that the forgery check still applies; automatic mail and Never record senders are dropped and never stored, with the two log lines verbatim; a teammate's automatic forwarding rule (`Auto-Submitted: auto-forwarded`) files normally, anyone else's is dropped; the 503 cases (the list read, the team lookup); how to read a dropped message (Resend's dashboard still has it; BIS stores nothing).

- [ ] **Step 8: Run to pass**: the two test files, plus `src/lib/email/inbound/` whole by path (`pnpm --filter web exec vitest run src/lib/email/inbound`) and `src/app/api/webhooks/resend/route.test.ts` (unchanged, still green), `pnpm --filter web typecheck`, eslint on the touched files. Paste the summary (the run count must equal the files' case count).

- [ ] **Step 9: Probes, each by name, edited back:** (a) the drops moved below `recordInboundEmail` → the automatic case FAILS; (b) `neverLogMatches` call removed → the listed-customer case FAILS; (c) `team` computed without `authenticated &&` → the unverified-teammate case FAILS; (d) `raiseUnread: !isForward` → `true` → the member-forward case FAILS; (e) `resumeExisting` ignoring `FORWARD_ACTOR_ID` → the retry case FAILS; (f) `file.ts`'s classification run on a forward → the stop case FAILS; (g) the `listNeverLog` catch returning `[]` → the 503 case FAILS; (h) `autoDrop = auto !== "none"` (no exemption) → the teammate auto-forwarded case FAILS; (i) `teamOf` without the memo → the `toHaveBeenCalledTimes(1)` assertion FAILS. Paste each failing line.

- [ ] **Step 10: Commit** `-- apps/web/src/lib/email/inbound/pipeline.ts apps/web/src/lib/email/inbound/pipeline.test.ts apps/web/src/lib/email/inbound/file.ts apps/web/src/lib/email/inbound/file.test.ts docs/runbooks/inbound-email.md`, message "inbound email: automatic mail and Never record senders dropped, the team's forwards filed on the record (S-06 part 2)".

---

## Task 6: The Never record actions and their crash-safe handlers (bis-comms)

**Review:** opus. **After:** Tasks 2, 3.

**Files**
- Create: `…/acct/never-log-actions.ts` (+ `never-log-actions.test.ts`)
- Create: `apps/web/src/components/never-log-handlers.ts` (+ `never-log-handlers.test.ts`)
- Modify: `…/acct/in-account-service-reads.test.ts` (one `ALLOWED` line)

**Interfaces**
- Consumes: `addNeverLog`, `removeNeverLog`, `serviceDb` (`@bis/db`); `parseNeverLogPattern`, `NeverLogKind` (`@bis/db/never-log-rules`); `requireAccountOwner` (`lib/auth.ts:70`); `loggableError`.
- Produces: `type NeverLogView = { id: string; pattern: string; kind: NeverLogKind }`; `type AddNeverLogActionResult = { ok: true; entry: NeverLogView } | { ok: false; error: "invalid" | "duplicate" | "full" | "failed" }`; `type RemoveNeverLogActionResult = { ok: true; removed: NeverLogView | null } | { ok: false; error: "failed" }`; `addNeverLogAction(accountId: string, input: string)`; `removeNeverLogAction(accountId: string, id: string)`; handlers `runAddNeverLog(deps: NeverLogDeps, input: string): Promise<boolean>` and `runRemoveNeverLog(deps: NeverLogDeps, entry: NeverLogView): Promise<boolean>` with `type NeverLogDeps = { add, remove, toast: NeverLogToast, locale: Locale, onAdded(e), onRemoved(id), onInlineError(message | null) }`.

- [ ] **Step 1: Read before writing.** `sed -n 425,460p …/settings/actions.ts` (an agency action's shape), `sed -n 1,80p …/conv/held-email-handlers.ts` (the handler pattern), `sed -n 60,130p …/acct/in-account-service-reads.test.ts`.

- [ ] **Step 2: Write the failing actions test** `never-log-actions.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const order: string[] = [];
const db = vi.hoisted(() => ({ addNeverLog: vi.fn(), removeNeverLog: vi.fn(), serviceDb: vi.fn(() => ({ svc: true })) }));
vi.mock("@bis/db", () => db);
const auth = vi.hoisted(() => ({ requireAccountOwner: vi.fn() }));
vi.mock("@/lib/auth", () => auth);
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
import { addNeverLogAction, removeNeverLogAction } from "./never-log-actions";

const ID = "11111111-1111-4111-8111-111111111111";
beforeEach(() => {
  order.length = 0;
  for (const f of [...Object.values(db), ...Object.values(auth)]) f.mockReset();
  db.serviceDb.mockReturnValue({ svc: true });
  auth.requireAccountOwner.mockImplementation(async () => { order.push("auth"); return { userId: "user_owner", isAgency: false }; });
  db.addNeverLog.mockImplementation(async (_d: unknown, _a: string, p: { pattern: string; kind: string }) => { order.push("add"); return { outcome: "added", entry: { id: ID, pattern: p.pattern, kind: p.kind, addedBy: "user_owner", createdAt: "x" } }; });
  db.removeNeverLog.mockImplementation(async () => { order.push("remove"); return { id: ID, pattern: "supplier.com", kind: "domain", addedBy: "u", createdAt: "x" }; });
});

describe("addNeverLogAction", () => {
  it("proves the caller is the account's Owner or the agency BEFORE any write, then adds the normalised entry on the service client (mutation: write before requireAccountOwner → order differs, FAILS)", async () => {
    expect(await addNeverLogAction("acc", " Billing+Q3@Supplier.com ")).toEqual({ ok: true, entry: { id: ID, pattern: "billing@supplier.com", kind: "address" } });
    expect(order).toEqual(["auth", "add"]);
    expect(auth.requireAccountOwner).toHaveBeenCalledWith("acc");
    expect(db.addNeverLog).toHaveBeenCalledWith({ svc: true }, "acc", { pattern: "billing@supplier.com", kind: "address" }, "user_owner");
  });

  it("an invalid entry writes nothing; a duplicate and a full list answer their own error (mutation: map duplicate to failed → FAILS)", async () => {
    expect(await addNeverLogAction("acc", "not a domain")).toEqual({ ok: false, error: "invalid" });
    expect(await addNeverLogAction("acc", 42 as unknown as string)).toEqual({ ok: false, error: "invalid" });
    expect(db.addNeverLog).not.toHaveBeenCalled();
    db.addNeverLog.mockResolvedValueOnce({ outcome: "duplicate" });
    expect(await addNeverLogAction("acc", "supplier.com")).toEqual({ ok: false, error: "duplicate" });
    db.addNeverLog.mockResolvedValueOnce({ outcome: "full" });
    expect(await addNeverLogAction("acc", "supplier.com")).toEqual({ ok: false, error: "full" });
  });

  it("a database failure answers failed and logs no pattern (mutation: log the input → the line carries it, FAILS)", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    db.addNeverLog.mockRejectedValueOnce(Object.assign(new Error("boom supplier.com"), { code: "XX000" }));
    expect(await addNeverLogAction("acc", "supplier.com")).toEqual({ ok: false, error: "failed" });
    expect(err.mock.calls.flat().join(" ")).not.toContain("supplier.com");
    err.mockRestore();
  });

  it("a refused caller never reaches the database (requireAccountOwner redirects by throwing; mutation: catch around the guard → FAILS)", async () => {
    auth.requireAccountOwner.mockRejectedValueOnce(new Error("NEXT_REDIRECT"));
    await expect(addNeverLogAction("acc", "supplier.com")).rejects.toThrow("NEXT_REDIRECT");
    expect(db.addNeverLog).not.toHaveBeenCalled();
  });
});

describe("removeNeverLogAction", () => {
  it("removes by id WITHIN the proved account, after the guard (mutation: pass another account id → FAILS)", async () => {
    expect(await removeNeverLogAction("acc", ID)).toEqual({ ok: true, removed: { id: ID, pattern: "supplier.com", kind: "domain" } });
    expect(order).toEqual(["auth", "remove"]);
    expect(db.removeNeverLog).toHaveBeenCalledWith({ svc: true }, "acc", ID, "user_owner");
  });

  it("a non-uuid id writes nothing; an already-gone entry answers removed null (mutation: skip the uuid check → the DB is asked, FAILS)", async () => {
    expect(await removeNeverLogAction("acc", "'; drop")).toEqual({ ok: false, error: "failed" });
    expect(db.removeNeverLog).not.toHaveBeenCalled();
    db.removeNeverLog.mockResolvedValueOnce(null);
    expect(await removeNeverLogAction("acc", ID)).toEqual({ ok: true, removed: null });
  });
});
```

- [ ] **Step 3: Write the failing handlers test** `apps/web/src/components/never-log-handlers.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { runAddNeverLog, runRemoveNeverLog, type NeverLogDeps } from "./never-log-handlers";

const E = { id: "n1", pattern: "supplier.com", kind: "domain" as const };
function deps(over: Partial<NeverLogDeps> = {}) {
  const toast = { success: vi.fn(), error: vi.fn() };
  const d: NeverLogDeps = {
    add: vi.fn(async () => ({ ok: true as const, entry: E })), remove: vi.fn(async () => ({ ok: true as const, removed: E })),
    toast, locale: "en", onAdded: vi.fn(), onRemoved: vi.fn(), onInlineError: vi.fn(), ...over,
  };
  return { d, toast };
}
const undoOf = (toast: { success: ReturnType<typeof vi.fn> }) => (toast.success.mock.calls[0]![1] as { action: { label: string; onClick: () => void } }).action;
const flush = () => new Promise((r) => setTimeout(r, 0));

describe("runAddNeverLog (rule 6: at once, with Undo)", () => {
  it("adds, toasts with an Undo that removes the new entry (mutation: Undo calls add → FAILS)", async () => {
    const { d, toast } = deps();
    expect(await runAddNeverLog(d, "supplier.com")).toBe(true);
    expect(d.onAdded).toHaveBeenCalledWith(E);
    expect(toast.success.mock.calls[0]![0]).toBe("Mail from supplier.com will never be saved.");
    expect(undoOf(toast).label).toBe("Undo");
    undoOf(toast).onClick(); await flush();
    expect(d.remove).toHaveBeenCalledWith("n1");
    expect(d.onRemoved).toHaveBeenCalledWith("n1");
    expect(toast.success.mock.calls[1]![0]).toBe("Back as it was.");
  });

  it("in Spanish, the same toasts in Spanish (mutation: hard-code 'en' → FAILS)", async () => {
    const { d, toast } = deps({ locale: "es" });
    await runAddNeverLog(d, "supplier.com");
    expect(toast.success.mock.calls[0]![0]).toBe("El correo de supplier.com nunca se guardará.");
    expect(undoOf(toast).label).toBe("Deshacer");
  });

  it("invalid, duplicate and full are inline messages, failed a toast; nothing is added (mutation: toast the duplicate → FAILS)", async () => {
    for (const [error, inline] of [["invalid", "Enter an address like name@example.com or a domain like example.com."], ["duplicate", "Already on the list."], ["full", "The list is full (200). Remove one to add another."]] as const) {
      const { d, toast } = deps({ add: vi.fn(async () => ({ ok: false as const, error })) });
      expect(await runAddNeverLog(d, "x")).toBe(false);
      expect(d.onInlineError).toHaveBeenLastCalledWith(inline);
      expect(toast.error).not.toHaveBeenCalled();
      expect(d.onAdded).not.toHaveBeenCalled();
    }
    const { d, toast } = deps({ add: vi.fn(async () => ({ ok: false as const, error: "failed" as const })) });
    await runAddNeverLog(d, "x");
    expect(toast.error).toHaveBeenCalledWith("That didn't save. Try again.");
  });

  it("a THROWN action toasts common.actionCrashed, and so does a thrown Undo (part 1 lesson; mutation: no catch → the promise rejects, FAILS)", async () => {
    const { d, toast } = deps({ add: vi.fn(async () => { throw new Error("stale deploy"); }) });
    expect(await runAddNeverLog(d, "x")).toBe(false);
    expect(toast.error).toHaveBeenCalledWith("That didn't go through — this page may be out of date. Reload it and try again.");
    const two = deps({ remove: vi.fn(async () => { throw new Error("x"); }) });
    await runAddNeverLog(two.d, "supplier.com");
    undoOf(two.toast).onClick(); await flush();
    expect(two.toast.error).toHaveBeenCalledWith("That didn't go through — this page may be out of date. Reload it and try again.");
    expect(two.d.onRemoved).not.toHaveBeenCalled();
  });
});

describe("runRemoveNeverLog", () => {
  it("removes, toasts with an Undo that adds the same pattern back (mutation: Undo re-adds by id → FAILS)", async () => {
    const { d, toast } = deps();
    expect(await runRemoveNeverLog(d, E)).toBe(true);
    expect(d.onRemoved).toHaveBeenCalledWith("n1");
    expect(toast.success.mock.calls[0]![0]).toBe("supplier.com is off the list.");
    undoOf(toast).onClick(); await flush();
    expect(d.add).toHaveBeenCalledWith("supplier.com");
    expect(d.onAdded).toHaveBeenCalledWith(E);
  });

  it("an entry someone else already removed leaves the list as the server says and toasts no Undo (mutation: offer Undo on removed null → FAILS)", async () => {
    const { d, toast } = deps({ remove: vi.fn(async () => ({ ok: true as const, removed: null })) });
    expect(await runRemoveNeverLog(d, E)).toBe(true);
    expect(d.onRemoved).toHaveBeenCalledWith("n1");
    expect(toast.success).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 4: Run both to see them fail** (no modules). Paste the summary.

- [ ] **Step 5: Write `never-log-actions.ts`:**

```ts
"use server";

import { revalidatePath } from "next/cache";
import { addNeverLog, removeNeverLog, serviceDb } from "@bis/db";
import { parseNeverLogPattern, type NeverLogKind } from "@bis/db/never-log-rules";
import { requireAccountOwner } from "@/lib/auth";
import { loggableError } from "@/lib/loggable-error";

/**
 * S-06 part 2, spec "The Never record list": Add and Remove, for the agency (Settings) and the
 * account's Owners (Branding). requireAccountOwner proves the caller (agency, or this account's Owner)
 * BEFORE any database call; every write is scoped to that account; an entry id is never trusted alone.
 * Logs carry the account id and loggableError only (kind, code, status), never the input.
 */
export type NeverLogView = { id: string; pattern: string; kind: NeverLogKind };
export type AddNeverLogActionResult = { ok: true; entry: NeverLogView } | { ok: false; error: "invalid" | "duplicate" | "full" | "failed" };
export type RemoveNeverLogActionResult = { ok: true; removed: NeverLogView | null } | { ok: false; error: "failed" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const view = (e: NeverLogView): NeverLogView => ({ id: e.id, pattern: e.pattern, kind: e.kind });

function revalidate(accountId: string) {
  revalidatePath(`/dashboard/accounts/${accountId}/settings`);
  revalidatePath(`/dashboard/accounts/${accountId}/branding`);
}

export async function addNeverLogAction(accountId: string, input: string): Promise<AddNeverLogActionResult> {
  const { userId } = await requireAccountOwner(accountId);
  const p = typeof input === "string" ? parseNeverLogPattern(input) : null;
  if (!p) return { ok: false, error: "invalid" };
  try {
    const r = await addNeverLog(serviceDb(), accountId, p, userId);
    if (r.outcome !== "added") return { ok: false, error: r.outcome };
    revalidate(accountId);
    return { ok: true, entry: view(r.entry) };
  } catch (e) {
    console.error(`addNeverLogAction: account ${accountId} failed: ${loggableError(e)}`);
    return { ok: false, error: "failed" };
  }
}

export async function removeNeverLogAction(accountId: string, id: string): Promise<RemoveNeverLogActionResult> {
  const { userId } = await requireAccountOwner(accountId);
  if (typeof id !== "string" || !UUID.test(id)) return { ok: false, error: "failed" };
  try {
    const removed = await removeNeverLog(serviceDb(), accountId, id, userId);
    revalidate(accountId);
    return { ok: true, removed: removed ? view(removed) : null };
  } catch (e) {
    console.error(`removeNeverLogAction: account ${accountId} failed: ${loggableError(e)}`);
    return { ok: false, error: "failed" };
  }
}
```

- [ ] **Step 6: Write `components/never-log-handlers.ts`:**

```ts
import { m } from "@/lib/messages";
import { t } from "@/lib/i18n/t";
import type { Locale } from "@/lib/i18n/locale";
import type { AddNeverLogActionResult, RemoveNeverLogActionResult, NeverLogView } from "@/app/(dashboard)/dashboard/accounts/[accountId]/never-log-actions";

/**
 * Every call NeverLogList makes into the server, Undo included, goes through here so a THROWN action
 * (a stale deployment, an expired session) toasts common.actionCrashed instead of doing nothing (part 1,
 * Tasks 10b/11b/12b). State is written by the caller's callbacks only AFTER the server answered ok.
 */
export type NeverLogToast = {
  success: (message: string, opts?: { action: { label: string; onClick: () => void } }) => unknown;
  error: (message: string) => unknown;
};
export type NeverLogDeps = {
  add: (input: string) => Promise<AddNeverLogActionResult>;
  remove: (id: string) => Promise<RemoveNeverLogActionResult>;
  toast: NeverLogToast;
  locale: Locale;
  onAdded: (entry: NeverLogView) => void;
  onRemoved: (id: string) => void;
  onInlineError: (message: string | null) => void;
};

const INLINE = { invalid: "neverLog.invalid", duplicate: "neverLog.duplicate", full: "neverLog.full" } as const;

async function guarded<T>(d: NeverLogDeps, run: () => Promise<T>): Promise<T | null> {
  try {
    return await run();
  } catch {
    d.toast.error(t(m, "common.actionCrashed", d.locale));
    return null;
  }
}

function undoButton(d: NeverLogDeps, onClick: () => Promise<void>) {
  return { action: { label: t(m, "common.undo", d.locale), onClick: () => { void onClick(); } } };
}

export async function runAddNeverLog(d: NeverLogDeps, input: string): Promise<boolean> {
  d.onInlineError(null);
  const r = await guarded(d, () => d.add(input));
  if (!r) return false;
  if (!r.ok) {
    if (r.error === "failed") d.toast.error(t(m, "neverLog.failed", d.locale));
    else d.onInlineError(t(m, INLINE[r.error], d.locale));
    return false;
  }
  const entry = r.entry;
  d.onAdded(entry);
  d.toast.success(t(m, "neverLog.added", d.locale, { pattern: entry.pattern }), undoButton(d, async () => {
    const u = await guarded(d, () => d.remove(entry.id));
    if (!u) return;
    if (!u.ok) { d.toast.error(t(m, "neverLog.failed", d.locale)); return; }
    d.onRemoved(entry.id);
    d.toast.success(t(m, "neverLog.undone", d.locale));
  }));
  return true;
}

export async function runRemoveNeverLog(d: NeverLogDeps, entry: NeverLogView): Promise<boolean> {
  const r = await guarded(d, () => d.remove(entry.id));
  if (!r) return false;
  if (!r.ok) { d.toast.error(t(m, "neverLog.failed", d.locale)); return false; }
  d.onRemoved(entry.id);
  if (!r.removed) return true;   // someone else removed it first: nothing of ours to undo
  const removed = r.removed;
  d.toast.success(t(m, "neverLog.removed", d.locale, { pattern: removed.pattern }), undoButton(d, async () => {
    const u = await guarded(d, () => d.add(removed.pattern));
    if (!u) return;
    if (!u.ok) { d.toast.error(t(m, u.error === "failed" ? "neverLog.failed" : INLINE[u.error], d.locale)); return; }
    d.onAdded(u.entry);
    d.toast.success(t(m, "neverLog.undone", d.locale));
  }));
  return true;
}
```

(The type-only import from the `"use server"` module is erased at build time; the handlers test never imports the actions module at runtime.)

- [ ] **Step 7: `ALLOWED`.** Add `"app/(dashboard)/dashboard/accounts/[accountId]/never-log-actions.ts": "owner-only",` in `in-account-service-reads.test.ts`'s `ALLOWED`, in its sorted place.
- [ ] **Step 8: Run to pass**: both new tests, `in-account-service-reads.test.ts`, typecheck, eslint. Paste the summary.
- [ ] **Step 9: Probes, each by name, edited back:** (a) `addNeverLog` called before `requireAccountOwner` → the order case FAILS; (b) the remove action without the UUID check → FAILS; (c) `guarded` rethrowing → the crash case FAILS; (d) the add Undo calling `d.add` → FAILS; (e) `removed: null` still toasting → FAILS. Paste each failing line.
- [ ] **Step 10: Commit** `-- "apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/never-log-actions.ts" "apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/never-log-actions.test.ts" apps/web/src/components/never-log-handlers.ts apps/web/src/components/never-log-handlers.test.ts "apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/in-account-service-reads.test.ts"`, message "never record: Add and Remove for Owners and the agency, with Undo, crash-safe (S-06 part 2)".

---

## Task 7: The Never record list on Settings and Branding; its demo (bis-frontend)

**Review:** opus (plus a bis-design-reviewer pass if the orchestrator provides a running build). **After:** Tasks 2, 6.

**Files**
- Create: `apps/web/src/components/never-log-list.tsx` (+ `never-log-list.test.ts`)
- Modify: `…/settings/sending-address-card.tsx` (one optional `neverLog` slot under the Replies row) + `sending-address-card.test.ts`
- Modify: `…/settings/page.tsx` (one read, one prop) + `page.test.ts`
- Modify: `…/acct/branding/page.tsx` (capture the access, one read, one card) + `page.test.ts`
- Create: `…/styleguide/never-log-demo.tsx` (+ test); Modify: `…/styleguide/page.tsx` (one line)

**Interfaces**
- Consumes: `NeverLogView`, `addNeverLogAction`, `removeNeverLogAction` (Task 6); `runAddNeverLog`, `runRemoveNeverLog` (Task 6); `listNeverLog` (`@bis/db`, Task 3).
- Produces: `NeverLogList({ entries: NeverLogView[] | null; add; remove; locale: Locale; idPrefix: string })`, root `data-never-log` with `lang`, entries `data-never-log-entry="<pattern>"`, empty `data-never-log-empty`, error `data-never-log-error` (Task 10's locators).

- [ ] **Step 1: Read before writing.** `sending-address-card.tsx` whole; `sed -n 60,130p` and `:225-240` of `…/settings/page.tsx`; `…/acct/branding/page.tsx` whole; `sed -n 1,60p …/settings/sending-address-card.test.ts` (its render harness); `…/styleguide/held-emails-demo.tsx` and its test (the demo pattern); `grep -n "HeldEmailsDemo\|held-emails-demo" "…/styleguide/page.tsx"`; `sed -n 115,130p …/record/page.tsx` (how a page resolves the reader's locale; `request-locale-callers.test.ts` scans each call's braces for a NAMED variable).

- [ ] **Step 2: Write the failing component test** `never-log-list.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { renderedText } from "@/lib/rendered-text";
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
import { NeverLogList } from "./never-log-list";

const ENTRIES = [{ id: "n1", pattern: "billing@supplier.com", kind: "address" as const }, { id: "n2", pattern: "supplier.com", kind: "domain" as const }];
const html = (entries: typeof ENTRIES | null, locale: "en" | "es" = "en") => renderToStaticMarkup(createElement(NeverLogList, {
  entries, locale, idPrefix: "t", add: async () => ({ ok: false as const, error: "failed" as const }), remove: async () => ({ ok: false as const, error: "failed" as const }),
}));

describe("NeverLogList (spec 'The Never record list'; rule 5's three states)", () => {
  it("loaded: each entry with its kind in words and its Remove, ghost buttons only, lang set (mutation: drop lang → FAILS; a default-variant Add → a second primary, FAILS)", () => {
    const h = html(ENTRIES);
    expect(h).toContain('data-never-log=""');
    expect(h).toContain('lang="en"');
    expect(h).toContain('data-never-log-entry="billing@supplier.com"');
    expect(h).toContain('data-never-log-entry="supplier.com"');
    const text = renderedText(h);
    expect(text).toContain("Never record");
    expect(text).toContain("Whole domain");
    expect(text).toContain("Address or domain");
    expect(h).toContain('aria-label="Remove supplier.com"');
    expect(h).not.toMatch(/data-variant="default"/);
  });

  it("empty: the sentence that sells it, and the input (mutation: render the empty line when entries exist → FAILS)", () => {
    expect(renderedText(html([]))).toContain("Mail from addresses or domains you add here is never saved.");
    expect(html(ENTRIES)).not.toContain("data-never-log-empty");
  });

  it("error: the load-failed line and no input (mutation: show an empty list on a failed read → FAILS)", () => {
    const h = html(null);
    expect(h).toContain("data-never-log-error");
    expect(renderedText(h)).toContain("We couldn't load this list. Reload the page to try again.");
    expect(h).not.toContain("<input");
  });

  it("Spanish, end to end (mutation: one key read in English → FAILS)", () => {
    const text = renderedText(html(ENTRIES, "es"));
    expect(html(ENTRIES, "es")).toContain('lang="es"');
    for (const s of ["No registrar nunca", "Todo el dominio", "Dirección o dominio", "Agregar", "Quitar"]) expect(text, s).toContain(s);
    expect(renderedText(html([], "es"))).toContain("El correo de las direcciones o dominios que agregue aquí nunca se guarda.");
  });

  it("tokens only: no hex, no literal radius or shadow (mutation: text-[#c00] → FAILS)", () => {
    const h = html(ENTRIES) + html(null);
    expect(h).not.toMatch(/#[0-9a-f]{3,8}\b/i);
    expect(h).not.toMatch(/rounded-\[(?!var\()/);
    expect(h).not.toMatch(/shadow-\[(?!var\()/);
  });
});
```

(If `Button` in this repo marks its variant with another attribute than `data-variant`, read `components/ui/button.tsx` and assert on that; the point is "no default-variant button in the list".)

- [ ] **Step 3: Run to see it fail.** Paste the summary.

- [ ] **Step 4: Write `components/never-log-list.tsx`:**

```tsx
"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { m } from "@/lib/messages";
import { t } from "@/lib/i18n/t";
import type { Locale } from "@/lib/i18n/locale";
import type { AddNeverLogActionResult, RemoveNeverLogActionResult, NeverLogView } from "@/app/(dashboard)/dashboard/accounts/[accountId]/never-log-actions";
import { runAddNeverLog, runRemoveNeverLog, type NeverLogDeps } from "./never-log-handlers";

/**
 * S-06 part 2: the account's Never record list, on Settings (agency) and Branding (Owner). Server-rendered
 * entries (null = the read failed: rule 5's error state); Add and Remove run at once with Undo (rule 6),
 * both ghost (rule 8: the host card keeps its own one primary). No <form>: on Branding the card sits next
 * to the branding form (plan G6), and Enter here must never submit anything else.
 */
export function NeverLogList({ entries, add, remove, locale, idPrefix }: {
  entries: NeverLogView[] | null;
  add: (input: string) => Promise<AddNeverLogActionResult>;
  remove: (id: string) => Promise<RemoveNeverLogActionResult>;
  locale: Locale;
  idPrefix: string;
}) {
  const [list, setList] = useState<NeverLogView[]>(entries ?? []);
  const [value, setValue] = useState("");
  const [inline, setInline] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const deps: NeverLogDeps = {
    add, remove, toast, locale,
    onAdded: (e) => setList((l) => [e, ...l.filter((x) => x.id !== e.id && x.pattern !== e.pattern)]),
    onRemoved: (id) => setList((l) => l.filter((x) => x.id !== id)),
    onInlineError: setInline,
  };
  const titleId = `${idPrefix}-never-log-title`;
  const inputId = `${idPrefix}-never-log-input`;
  const errorId = `${inputId}-error`;

  async function submit() {
    if (pending) return;
    setPending(true);
    try {
      if (await runAddNeverLog(deps, value)) setValue("");
    } finally {
      setPending(false);
    }
  }

  return (
    <section data-never-log="" lang={locale} aria-labelledby={titleId} className="space-y-3">
      <div className="space-y-1">
        <h3 id={titleId} className="text-sm font-semibold text-card-foreground">{t(m, "neverLog.title", locale)}</h3>
        <p className="text-xs text-muted-foreground">{t(m, "neverLog.body", locale)}</p>
      </div>
      {entries === null ? (
        <p data-never-log-error="" role="alert" className="text-sm text-[var(--crit)]">{t(m, "neverLog.loadFailed", locale)}</p>
      ) : (
        <>
          {list.length === 0 ? (
            <p data-never-log-empty="" className="text-sm text-muted-foreground">{t(m, "neverLog.empty", locale)}</p>
          ) : (
            <ul className="divide-y divide-[var(--line)] rounded-[var(--radius-ctl)] border border-[var(--line)]">
              {list.map((e) => (
                <li key={e.id} data-never-log-entry={e.pattern} className="flex min-h-11 items-center gap-3 px-3 md:min-h-8">
                  <span className="min-w-0 flex-1 truncate text-sm text-card-foreground">{e.pattern}</span>
                  <span className="text-xs text-muted-foreground">{t(m, e.kind === "domain" ? "neverLog.kind.domain" : "neverLog.kind.address", locale)}</span>
                  <Button type="button" variant="ghost" size="sm" className="min-h-11 md:min-h-8"
                    aria-label={t(m, "neverLog.removeLabel", locale, { pattern: e.pattern })}
                    onClick={() => { void runRemoveNeverLog(deps, e); }}>
                    {t(m, "neverLog.remove", locale)}
                  </Button>
                </li>
              ))}
            </ul>
          )}
          <div className="space-y-1.5">
            <Label htmlFor={inputId}>{t(m, "neverLog.inputLabel", locale)}</Label>
            <div className="flex gap-2">
              <Input id={inputId} value={value} placeholder={t(m, "neverLog.placeholder", locale)}
                autoComplete="off" spellCheck={false}
                aria-invalid={inline ? true : undefined} aria-describedby={inline ? errorId : undefined}
                onChange={(ev) => { setValue(ev.target.value); if (inline) setInline(null); }}
                onKeyDown={(ev) => { if (ev.key === "Enter") { ev.preventDefault(); void submit(); } }} />
              <Button type="button" variant="ghost" className="min-h-11 md:min-h-8" disabled={pending} onClick={() => { void submit(); }}>
                {t(m, "neverLog.add", locale)}
              </Button>
            </div>
            {inline ? <p id={errorId} role="alert" className="text-xs text-[var(--crit)]">{inline}</p> : null}
          </div>
        </>
      )}
    </section>
  );
}
```

- [ ] **Step 5: Settings.** `SendingAddressCard` gains an optional prop `neverLog?: React.ReactNode` (doc: "S-06 part 2: the Never record list, below the Replies row; outside the card's form") rendered after `<RepliesRow …/>` as `{neverLog ? <div className="mt-6 border-t border-[var(--line)] pt-4">{neverLog}</div> : null}`. In `…/settings/page.tsx`, add `listNeverLog` to the `@bis/db` import, read it beside the other reads on the request client `db` (the agency's own; this page is `requireAgencyOnlyAccountAccess`):

```ts
    // S-06 part 2: the Never record list. A failed read is the list's own error state, never the page's.
    listNeverLog(db, accountId).then(
      (rows) => rows.map((e) => ({ id: e.id, pattern: e.pattern, kind: e.kind })),
      (e: unknown) => { console.error(`settings: account ${accountId} never-record list read failed: ${loggableError(e)}`); return null; },
    ),
```

and pass `neverLog={<NeverLogList entries={neverLog} add={addNeverLogAction.bind(null, accountId)} remove={removeNeverLogAction.bind(null, accountId)} locale="en" idPrefix="settings" />}` to `SendingAddressCard` (English, part 1 G14). Import `NeverLogList` (a component, rendered as JSX, never called) and the two actions.

- [ ] **Step 6: Branding.** In `…/acct/branding/page.tsx`: `const access = await requireNotTechnician(accountId);` (it already runs; keep its return). Only when `access.canManage` (plan G8), read beside the existing `Promise.all`: `getPersonPrefs()`, the account's language (`serviceDb().from("accounts").select("language").eq("id", accountId).maybeSingle()`), and `listNeverLog(serviceDb(), accountId)` mapped to views with the same `.then(…, … return null)` as Settings (logging `branding: account … never-record list read failed: ${loggableError(e)}`). Resolve the locale exactly as the record page does, with a NAMED variable:

```ts
  const accountLanguage = { language: (accountRow?.language as Locale | null | undefined) ?? null };
  const locale = requestLocale({ account: accountLanguage, isOperator: access.isAgency, userLanguage: prefs.language });
```

Render, after `<BrandingPanel …/>` and before `<AlertPhoneCard …/>`, only when `access.canManage`:

```tsx
      {neverLog !== undefined ? (
        <Card id="never-record">
          <CardContent className="pt-6">
            <NeverLogList entries={neverLog} add={addNeverLogAction.bind(null, accountId)}
              remove={removeNeverLogAction.bind(null, accountId)} locale={locale} idPrefix="branding" />
          </CardContent>
        </Card>
      ) : null}
```

(`neverLog` is `undefined` for staff, so nothing is read or rendered for them.) Update the file's top comment: the page now has ONE conditional read, gated on `canManage`, and its write path is the two Owner-guarded actions.

- [ ] **Step 7: Page tests.** In `…/settings/page.test.ts` (read its harness first): with `listNeverLog` mocked to `[ENTRY]` the rendered HTML contains `data-never-log-entry`; mocked to reject, it contains `data-never-log-error` AND the rest of the page still renders (mutation: drop the `.then` rejection handler → the page throws, FAILS). In `…/acct/branding/page.test.ts`: an Owner (`requireNotTechnician` → `{ canManage: true, isAgency: false, role: "owner" }`) sees `data-never-log`; staff (`canManage: false, role: "staff"`) sees no `data-never-log` AND `listNeverLog` was never called (mutation: drop the `canManage` gate → FAILS twice); an Owner whose account language is `es` gets `lang="es"` on the list. Add `listNeverLog` (and `getPersonPrefs`'s module, if the page test does not already mock it) to each test's mock factory (the `vi.mock` factory check).

- [ ] **Step 8: Sending address card test.** In `sending-address-card.test.ts`: with `neverLog={createElement("p", { "data-x": "1" })}` the slot renders AFTER the Replies row and OUTSIDE the `<form>` (assert the index of `data-x` is after `</form>` in the markup; mutation: render the slot inside the form → FAILS); the card still has exactly ONE default-variant button (Save).

- [ ] **Step 9: The demo.** `…/styleguide/never-log-demo.tsx` (`"use client"`, the `held-emails-demo.tsx` shape): four `NeverLogList`s — two entries (en), two entries (es, wrapped `lang="es"`), empty (en), error (`entries={null}`) — with inert `add`/`remove` that answer `{ ok: false, error: "failed" }`; root `data-testid="styleguide-never-log"`. Its test renders it and asserts the four states' attributes. One line in `…/styleguide/page.tsx` beside the held-emails demo, with a heading taken from `m["neverLog.title"]`.

- [ ] **Step 10: Run to pass** every test this task touched, plus `src/components/ui/material.test.ts`, `src/lib/i18n/ratchet.test.ts`, `src/lib/i18n/request-locale-callers.test.ts`, `"src/app/(dashboard)/dashboard/accounts/[accountId]/in-account-service-reads.test.ts"`; typecheck; eslint on the touched files. Paste the summary.
- [ ] **Step 11: Probes, each by name, edited back:** (a) `lang` dropped from the list root → the Spanish case FAILS; (b) the Branding gate removed → the staff case FAILS; (c) Settings' rejection handler removed → the page case FAILS; (d) the slot moved inside the form → the card case FAILS. Paste each failing line.
- [ ] **Step 12: Commit** every path above, message "never record: the list on Settings' Sending address card and the Owner's Branding page, in their language (S-06 part 2)".

---

## Task 8: The Forwarding address row; "Forwarded by" on the thread; its demo (bis-frontend)

**Review:** opus (plus a bis-design-reviewer pass if a running build is provided). **After:** Tasks 2, 3, 5 (the `meta` shape); its styleguide step after Task 7's commit.

**Files**
- Create: `apps/web/src/lib/email/inbound/forwarding-view.ts` (+ `forwarding-view.test.ts`)
- Create: `…/record/forwarding-address-row.tsx` (+ `forwarding-address-row.test.ts`), `…/record/forwarding-copy.ts` (+ `forwarding-copy.test.ts`)
- Modify: `…/record/contact-fields-panel.tsx` (`DetailsProps.forwarding?: ForwardingView`, one row inside the `<dl>`)
- Modify: `…/record/page.tsx` (one read, one prop) + `page.test.ts`
- Modify: `…/conv/inbound-meta.ts` (+ test), `…/conv/message-thread.tsx` (+ test), `…/conv/page.tsx` (one read)
- Create: `…/styleguide/forwarding-demo.tsx` (+ test); Modify: `…/styleguide/page.tsx` (one line)

**Interfaces**
- Consumes: `getInboundSettings`, `ensureReplyToken`, `serviceDb`, `listPeopleNames` (`@bis/db`); `replyAddressFor` (`lib/email/inbound/address.ts:85`); the forward `meta` keys `forwarded`, `forwarded_by` (Task 5).
- Produces: `type ForwardingView = { kind: "address"; address: string } | { kind: "turnOn" } | { kind: "none" } | { kind: "failed" }`; `loadForwardingView(d: { settings: () => Promise<InboundSettings>; token: () => Promise<{ token: string }>; log: (line: string) => void }, viewer: { isAgency: boolean }): Promise<ForwardingView>`; `InboundMeta.forwarded: { byId: string | null } | null`; `MessageThread`'s new prop `forwardedNames: ReadonlyMap<string, string>` (Clerk id → name; a missing id reads "someone on the team").

- [ ] **Step 1: Read before writing.** `…/record/page.tsx:75-135` and `:225-292`; `contact-fields-panel.tsx:1-130`; `…/conv/inbound-meta.ts` whole and its test; `…/conv/message-thread.tsx:1-80` and `:138-175`; `…/conv/page.tsx:240-345`; `sed -n 420,441p packages/db/src/record.ts` (`listPeopleNames`); `…/styleguide/held-emails-demo.tsx`.

- [ ] **Step 2: Write the failing view test** `forwarding-view.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { loadForwardingView } from "./forwarding-view";

const T = "0123456789abcdef01234567";
const deps = (mode: "off" | "bis" | "own_domain", over: Partial<Parameters<typeof loadForwardingView>[0]> = {}) => ({
  settings: vi.fn(async () => ({ mode, domain: mode === "own_domain" ? "reply.rio.com" : null })),
  token: vi.fn(async () => ({ token: T })), log: vi.fn(), ...over,
});

describe("loadForwardingView (spec §1; decided on the server)", () => {
  it("Replies on: the customer's reply address, on the account's domain (mutation: always BIS's domain → own_domain wrong, FAILS)", async () => {
    expect(await loadForwardingView(deps("bis"), { isAgency: false })).toEqual({ kind: "address", address: `r-${T}@reply.bis-rgv.com` });
    expect(await loadForwardingView(deps("own_domain"), { isAgency: false })).toEqual({ kind: "address", address: `r-${T}@reply.rio.com` });
  });

  it("Replies off: the agency is told to turn it on, everyone else sees nothing, and no token is made (mutation: make the token first → token called, FAILS)", async () => {
    const d = deps("off");
    expect(await loadForwardingView(d, { isAgency: true })).toEqual({ kind: "turnOn" });
    expect(await loadForwardingView(d, { isAgency: false })).toEqual({ kind: "none" });
    expect(d.token).not.toHaveBeenCalled();
  });

  it("a failed read or write is the row's error state, logged without the token (mutation: rethrow → the card fails, FAILS)", async () => {
    const a = deps("bis", { settings: vi.fn(async () => { throw new Error("db"); }) });
    expect(await loadForwardingView(a, { isAgency: false })).toEqual({ kind: "failed" });
    const b = deps("bis", { token: vi.fn(async () => { throw new Error(`token ${T}`); }) });
    expect(await loadForwardingView(b, { isAgency: false })).toEqual({ kind: "failed" });
    expect(b.log.mock.calls.flat().join(" ")).not.toContain(T);
  });
});
```

- [ ] **Step 3: Write `forwarding-view.ts`** (NO directive; a server component calls it):

```ts
import type { InboundSettings } from "@bis/db";
import { replyAddressFor } from "./address";

/**
 * S-06 part 2, spec §1: what the record's Forwarding address row shows, decided on the SERVER (plan
 * G15). The caller passes thunks so this module never names a service client. Never logs the token.
 */
export type ForwardingView = { kind: "address"; address: string } | { kind: "turnOn" } | { kind: "none" } | { kind: "failed" };
export type ForwardingDeps = { settings: () => Promise<InboundSettings>; token: () => Promise<{ token: string }>; log: (line: string) => void };

export async function loadForwardingView(d: ForwardingDeps, viewer: { isAgency: boolean }): Promise<ForwardingView> {
  let s: InboundSettings;
  try {
    s = await d.settings();
  } catch {
    d.log("the Replies setting could not be read; the forwarding row shows its error");
    return { kind: "failed" };
  }
  if (s.mode === "off") return viewer.isAgency ? { kind: "turnOn" } : { kind: "none" };
  try {
    const { token } = await d.token();
    const address = replyAddressFor(token, s);
    return address ? { kind: "address", address } : { kind: "none" };
  } catch {
    d.log("the forwarding address could not be made; the forwarding row shows its error");
    return { kind: "failed" };
  }
}
```

- [ ] **Step 4: The copy handler and its test.** `…/record/forwarding-copy.ts` (no directive):

```ts
import { m } from "@/lib/messages";
import { t } from "@/lib/i18n/t";
import type { Locale } from "@/lib/i18n/locale";

/** Spec §1: Copy toasts "Copied", no Undo. Plan G12: a refused clipboard says how to copy by hand. */
export async function copyForwardingAddress(
  address: string, clipboard: { writeText: (s: string) => Promise<void> } | undefined,
  toast: { success: (s: string) => unknown; error: (s: string) => unknown }, locale: Locale,
): Promise<boolean> {
  try {
    if (!clipboard) throw new Error("no clipboard");
    await clipboard.writeText(address);
    toast.success(t(m, "contact.forwarding.copied", locale));
    return true;
  } catch {
    toast.error(t(m, "contact.forwarding.copyFailed", locale));
    return false;
  }
}
```

Its test: a resolving `writeText` → `toast.success("Copied")` and `writeText` called with the address; `es` → `"Copiado"`; a rejecting `writeText` and an `undefined` clipboard → `toast.error("Couldn't copy. Select the address and copy it by hand.")` and no success (mutation: no catch → rejects, FAILS).

- [ ] **Step 5: The row and its test.** `…/record/forwarding-address-row.tsx`:

```tsx
"use client";

import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useLocale } from "@/components/locale-provider";
import { m } from "@/lib/messages";
import { t } from "@/lib/i18n/t";
import type { ForwardingView } from "@/lib/email/inbound/forwarding-view";
import { copyForwardingAddress } from "./forwarding-copy";

/** S-06 part 2, spec §1: one row in the Details card ("who they are"). The view is the server's. */
export function ForwardingAddressRow({ view }: { view: ForwardingView }) {
  const locale = useLocale();
  if (view.kind === "none") return null;
  return (
    <div data-forwarding-row={view.kind} className="space-y-0.5">
      <dt className="text-muted-foreground text-xs">{t(m, "contact.forwarding.label", locale)}</dt>
      <dd className="space-y-1">
        {view.kind === "address" ? (
          <>
            <div className="flex items-center gap-2">
              <span className="min-w-0 select-all break-all font-mono text-xs text-card-foreground">{view.address}</span>
              <Button type="button" variant="ghost" size="sm" className="min-h-11 md:min-h-8"
                aria-label={t(m, "contact.forwarding.copyLabel", locale)}
                onClick={() => { void copyForwardingAddress(view.address, typeof navigator === "undefined" ? undefined : navigator.clipboard, toast, locale); }}>
                {t(m, "contact.forwarding.copy", locale)}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">{t(m, "contact.forwarding.hint", locale)}</p>
          </>
        ) : view.kind === "turnOn" ? (
          <p className="text-xs text-muted-foreground">{t(m, "contact.forwarding.turnOn", locale)}</p>
        ) : (
          <p role="alert" className="text-xs text-[var(--crit)]">{t(m, "contact.forwarding.failed", locale)}</p>
        )}
      </dd>
    </div>
  );
}
```

Its test renders each kind inside `createElement(LocaleProvider, { locale }, …)` (read `components/locale-provider.tsx` for the provider's export), in `en` and `es`, against literal strings: address (the address, "Copy", the hint; `Copiar`, `Reenvíe un correo a esta dirección para guardarlo con este cliente.`), turnOn (`Turn on Replies in Settings to get a forwarding address` / `Active Respuestas en Configuración para obtener una dirección para reenviar`), failed (`role="alert"` and both sentences), none (empty markup; mutation: render a label for none → FAILS); no hex, no literal radius.

- [ ] **Step 6: Wire it.** `contact-fields-panel.tsx`: `DetailsProps` gains `/** S-06 part 2: the Forwarding address row, decided on the server (page.tsx). Absent = not shown. */ forwarding?: ForwardingView;` (type-only import from `@/lib/email/inbound/forwarding-view`); render `{forwarding ? <ForwardingAddressRow view={forwarding} /> : null}` as the LAST child of the Details `<dl>` (after the assignee row). `…/record/page.tsx`: add `getInboundSettings, ensureReplyToken, serviceDb` to the `@bis/db` import and `loadForwardingView` from `@/lib/email/inbound/forwarding-view`; inside the existing `Promise.all` (after `getContact` proved the customer on the request client), add:

```ts
    // S-06 part 2 (spec §1, plan G15): the Forwarding address. getContact above, on the request client,
    // proved this customer is the viewer's; only then is the token made, on the service client.
    loadForwardingView({
      settings: () => getInboundSettings(serviceDb(), accountId),
      token: () => ensureReplyToken(serviceDb(), accountId, contactId, "record-page"),
      log: (line) => console.error(`contact page: account ${accountId} ${line}`),
    }, { isAgency: access.isAgency }),
```

and pass `forwarding={forwarding}` to `ContactDetailsBody`. The drawer is untouched (spec §1).

- [ ] **Step 7: Record page test.** In `…/record/page.test.ts` (its mock factory gains `getInboundSettings`, `ensureReplyToken`, `serviceDb`): Replies `bis` → the markup contains `data-forwarding-row="address"` and `r-<token>@reply.bis-rgv.com`; `off` + an Owner → no `data-forwarding-row`, and `ensureReplyToken` never called; `off` + the agency → `data-forwarding-row="turnOn"`; `getContact` answering `null` (what RLS answers a Technician for a customer not theirs: the page 404s) → `notFound` thrown and `ensureReplyToken` never called (mutation: run the forwarding read before `getContact` → called, FAILS). Pin the import site: the page's source imports `loadForwardingView` from `@/lib/email/inbound/forwarding-view` and nothing from `./forwarding-address-row` except the component (read the file's text; mutation: export the loader from the `"use client"` row file → FAILS).

- [ ] **Step 8: The thread.** `inbound-meta.ts`: `InboundMeta` gains `forwarded: { byId: string | null } | null`; `RawMeta` gains `forwarded?: boolean; forwarded_by?: string | null`; `readInboundMeta` sets `forwarded: raw.forwarded === true ? { byId: typeof raw.forwarded_by === "string" && raw.forwarded_by ? raw.forwarded_by : null } : null`. Its test: a forward's meta → `{ byId: "user_maria" }`; `forwarded_by: null` → `{ byId: null }`; a customer reply → `null`; `forwarded: "yes"` → `null` (mutation: truthy check → FAILS). `…/conv/page.tsx`: after `messages` is read, collect `const forwarderIds = [...new Set(messages.flatMap((msg) => { const f = msg.direction === "inbound" && msg.channel === "email" ? readInboundMeta(msg.meta)?.forwarded : null; return f?.byId ? [f.byId] : []; }))];` and `const forwardedNames = new Map(Object.entries(forwarderIds.length ? await listPeopleNames(db, forwarderIds).catch((e: unknown) => { console.error(\`conversations: account ${accountId} forwarder names read failed: ${loggableError(e)}\`); return {}; }) : {}));` on the REQUEST client (a person the reader cannot see stays unnamed), and pass `forwardedNames={forwardedNames}` to `MessageThread`. `message-thread.tsx`: the new prop `forwardedNames: ReadonlyMap<string, string>`; inside the existing inbound-email IIFE (`:142-170`), BEFORE `<InboundNotice …/>`, when `meta.forwarded`:

```tsx
                  {meta.forwarded ? (
                    <p lang={locale} data-forwarded="" className="mt-1 text-xs text-muted-foreground">
                      {meta.forwarded.byId && forwardedNames.get(meta.forwarded.byId)
                        ? t(m, "conversations.forward.by", locale, { name: forwardedNames.get(meta.forwarded.byId)! })
                        : t(m, "conversations.forward.bySomeone", locale)}
                    </p>
                  ) : null}
```

(Return a fragment holding that line and the existing `<InboundNotice …/>`.) Its test, in `message-thread.test.ts`'s harness: a forward with `forwarded_by: "user_maria"` and names `{ user_maria: "Maria Lopez" }` → `Forwarded by Maria Lopez · team` with `lang="en"` on that `<p>`, while the body `<p>` keeps the customer's `lang`; `es` → `Reenviado por Maria Lopez · equipo`; an unnamed id and `forwarded_by: null` → `Forwarded by someone on the team` / `Reenviado por alguien del equipo`; a customer reply has no `data-forwarded` (mutation: render the line for every inbound email → FAILS; drop `lang={locale}` → FAILS). Pin the import site: `message-thread.tsx` imports `readInboundMeta` from `./inbound-meta`, never from `./inbound-notice` (the existing guard in `inbound-meta.test.ts` stays green).

- [ ] **Step 9: The demo** (after Task 7's styleguide commit). `…/styleguide/forwarding-demo.tsx` (`"use client"`): the row's four kinds in `en` and the address kind in `es` (inside `LocaleProvider`), root `data-testid="styleguide-forwarding"`; its test asserts the kinds; one line in `…/styleguide/page.tsx` beside Task 7's demo.

- [ ] **Step 10: Run to pass** every test this task touched, plus `src/components/ui/material.test.ts`, `src/lib/i18n/ratchet.test.ts`, `src/lib/i18n/request-locale-callers.test.ts`, `"src/app/(dashboard)/dashboard/accounts/[accountId]/in-account-service-reads.test.ts"` (the record page is already `proven-target`; nothing under `lib/` names `serviceDb`), `…/conv/page.test.ts` and `page.sender-visibility.test.ts` (their mock factories gain `listPeopleNames` if they reach it); typecheck; eslint. Paste the summary.
- [ ] **Step 11: Probes, each by name, edited back:** (a) `loadForwardingView` calling `token` before the mode check → the off case FAILS; (b) the row rendering a label for `none` → FAILS; (c) the thread line without `lang` → FAILS; (d) the page's forwarding read moved above `getContact` → FAILS. Paste each failing line.
- [ ] **Step 12: Commit** every path above, message "record: the customer's forwarding address with Copy; the thread names who forwarded (S-06 part 2)".

---

## Task 9: Regenerate the i18n baselines (bis-comms)

- [ ] **Step 1.** Read `apps/web/src/lib/i18n/ratchet.test.ts`'s header for the regeneration command (part 1 Task 13 used it; the ledger records "generator byte-identical: ratchet 19 files, catalogue 1105 keys"). Run it; `git diff --stat apps/web/src/lib/i18n/` shows only the two baseline files.
- [ ] **Step 2.** `pnpm --filter web exec vitest run src/lib/i18n src/lib/messages.test.ts` → PASS. The catalogue's key count grows by exactly 28 English keys (read both counts off the regenerated file and the previous one; paste both).
- [ ] **Step 3.** Commit `-- apps/web/src/lib/i18n/catalogue-baseline.json apps/web/src/lib/i18n/ratchet-baseline.json` (only the files that changed), message "i18n: baselines for the forwarding and Never record copy (S-06 part 2)".

---

## Task 10: The e2e spec (bis-e2e-qa)

**Files**
- Create: `apps/web/e2e/never-record.spec.ts`

- [ ] **Step 1: Read** `apps/web/e2e/inbound-email.spec.ts` whole (env loading, the fixture account, the checked deletes, the re-read, part 1's locator fix), `apps/web/e2e/support.ts` (`readClientFixture`), `apps/web/playwright.config.ts` (projects and the agency storage state; one worker).
- [ ] **Step 2: Write the spec.**

```ts
import { test, expect, type Page } from "./fixtures/test";
import { config as loadEnv } from "dotenv";
import { serviceDb } from "@bis/db";
import { m } from "../src/lib/messages";
import { readClientFixture } from "./support";

loadEnv({ path: "apps/web/.env.local" });
loadEnv({ path: ".env.local" });

/**
 * S-06 part 2 (spec "Tests": "add a Never record entry, see it, Undo it"; plan Task 10). As the agency,
 * on Settings' Sending address card, ON THE PER-RUN FIXTURE ACCOUNT ONLY, never Test Client One. Each
 * pattern is stamped; afterAll deletes every row this run could have left (checking the error), then
 * re-reads the table to confirm none is left. Entries are addressed by data-never-log-entry, never by
 * text: the toast repeats the pattern.
 */
test.describe.configure({ mode: "serial", timeout: 120_000 });

const STAMP = `nr${Date.now()}`;
const ADDED = `${STAMP}-a.example.com`;
const REMOVED = `${STAMP}-b.example.com`;
let accountId = "";
const db = () => serviceDb();
const settings = () => `/dashboard/accounts/${accountId}/settings`;
const list = (page: Page) => page.locator("#sending-address [data-never-log]");
const entry = (page: Page, p: string) => list(page).locator(`[data-never-log-entry="${p}"]`);
const toastWith = (page: Page, text: string) => page.locator("[data-sonner-toast]").filter({ hasText: text });
const stored = async (p: string) => {
  const { count, error } = await db().from("inbound_never_log").select("id", { count: "exact", head: true }).eq("account_id", accountId).eq("pattern", p);
  expect(error).toBeNull();
  return count;
};

test.beforeAll(() => {
  const fixture = readClientFixture();
  if (!fixture) throw new Error("never-record.spec: no per-run fixture account (e2e/.auth/client-fixture.json). Run the full suite.");
  accountId = fixture.accountId;
});

test.afterAll(async () => {
  if (!accountId) return;
  const { error } = await db().from("inbound_never_log").delete().eq("account_id", accountId).like("pattern", `${STAMP}%`);
  expect(error).toBeNull();
  const { count, error: e2 } = await db().from("inbound_never_log").select("id", { count: "exact", head: true }).eq("account_id", accountId).like("pattern", `${STAMP}%`);
  expect(e2).toBeNull();
  expect(count).toBe(0);
});

async function add(page: Page, pattern: string) {
  await list(page).getByLabel(m["neverLog.inputLabel"]).fill(pattern);
  await list(page).getByRole("button", { name: m["neverLog.add"], exact: true }).click();
}

test("adding an entry shows it at once and stores it; Undo takes it off again", async ({ page }) => {
  await page.goto(settings());
  await add(page, ADDED);
  await expect(entry(page, ADDED)).toHaveCount(1);
  const toast = toastWith(page, m["neverLog.added"].replace("{pattern}", ADDED));
  await expect(toast).toBeVisible();
  expect(await stored(ADDED)).toBe(1);
  await toast.getByRole("button", { name: m["common.undo"] }).click();
  await expect(toastWith(page, m["neverLog.undone"])).toBeVisible();
  await expect(entry(page, ADDED)).toHaveCount(0);
  expect(await stored(ADDED)).toBe(0);
  await page.goto(settings());
  await expect(entry(page, ADDED)).toHaveCount(0);
});

test("a duplicate is refused in words; an invalid entry too; nothing extra is stored", async ({ page }) => {
  await page.goto(settings());
  await add(page, REMOVED);
  await expect(entry(page, REMOVED)).toHaveCount(1);
  await add(page, REMOVED.toUpperCase());
  await expect(list(page).getByRole("alert")).toHaveText(m["neverLog.duplicate"]);
  await add(page, "not a domain");
  await expect(list(page).getByRole("alert")).toHaveText(m["neverLog.invalid"]);
  expect(await stored(REMOVED)).toBe(1);
});

test("removing an entry takes it off at once; Undo puts it back", async ({ page }) => {
  await page.goto(settings());
  await expect(entry(page, REMOVED)).toHaveCount(1);
  await entry(page, REMOVED).getByRole("button", { name: m["neverLog.removeLabel"].replace("{pattern}", REMOVED) }).click();
  await expect(entry(page, REMOVED)).toHaveCount(0);
  const toast = toastWith(page, m["neverLog.removed"].replace("{pattern}", REMOVED));
  await toast.getByRole("button", { name: m["common.undo"] }).click();
  await expect(entry(page, REMOVED)).toHaveCount(1);
  expect(await stored(REMOVED)).toBe(1);
});
```

(Every test `goto`s its own page. The second test leaves `REMOVED` for the third on purpose, serially; afterAll removes both stamped patterns either way.)
- [ ] **Step 3:** `pnpm --filter web exec playwright test --list e2e/never-record.spec.ts` lists three tests (listing does not run them). `pnpm --filter web exec eslint e2e/never-record.spec.ts`. Commit `-- apps/web/e2e/never-record.spec.ts`, message "e2e: a Never record entry added, refused twice, undone; removed and undone (S-06 part 2)".

---

## Task 11: Whole-branch final review (checkpoint, not an implementer task)

**Review:** opus. Ports `55648`/`55649`/`55650`.

- [ ] **Step 1.** Read the spec whole, this plan's G1–G18 AS RULED in Task 0, then `git diff 09496978...HEAD` in `<WT>`; walk "Spec coverage" below row by row against the diff.
- [ ] **Step 2.** Web tests by path: every test file Tasks 2–8 touched, plus `src/lib/i18n/ratchet.test.ts`, `src/lib/i18n/request-locale-callers.test.ts`, `src/lib/messages.test.ts`, `src/components/ui/material.test.ts`, `src/lib/consent/scans.test.ts`, `"src/app/(dashboard)/dashboard/accounts/[accountId]/in-account-service-reads.test.ts"`, `src/lib/email/inbound` (the folder); `pnpm --filter web typecheck`. The db suites on a replica of your own: `inbound-never-log-schema.test.ts`, `schema-grants-guard.test.ts`, `inbound-email-schema.test.ts` on `post`; `never-log.test.ts`, `inbound-email.test.ts`, `provenance-parity.test.ts` behind PostgREST. Re-run two probes of your own choosing, by name.
- [ ] **Step 3.** Hunt specifically: (a) any path that FILES mail without the forgery check, or files a forward from a sender who is neither a member of the account nor its mailbox (an agency sender must be held, G1 as ruled); an `Auto-Submitted: auto-forwarded` message from a non-team sender that is not dropped, or a teammate's that is (G10 as ruled); (b) a drop that stores anything, or a drop AFTER `recordInboundEmail`; a stored row dropped on retry; (c) the matcher mocked anywhere it decides a test's outcome; a lookalike domain that matches; (d) an address, a pattern, a token, a subject or a body in any log line (grep every new `console.error` and `deps.log`); (e) a forward that raises unread, sends the owner's copy, runs the stop rule, strips the quoted text, or carries a `customer` author; a retried forward that loses any of those; (f) a team lookup failure that answers 200; (g) an action that reads or writes before `requireAccountOwner`, or a write not scoped to the proved account; (h) `serviceDb`/`ledgerDb` in any new file under `lib/`; (i) a server component calling a value from a `"use client"` module (`grep -rn "from \"./forwarding-address-row\"\|never-log-list\"" apps/web/src --include=page.tsx`, then read each import); (j) 0083's ASCII rule, `lock_timeout` first, RLS on, SELECT-only grant, the restrictive policy; (k) rule 8 (the Sending address card's one primary; no primary in the list), rule 5 (each list and row state), rule 6 (Add, Remove and both Undos), `lang` on the list and the thread line; staff never sees the Branding card; (l) a Spanish assertion against `t()`'s output, a test that cannot fail, a mock answering a state production cannot reach; (m) the e2e spec touching anything but the fixture account, a locator that can match a toast and an entry at once, or a table it deletes from that afterAll does not re-read.
- [ ] **Step 4.** Report findings by severity with file:line; the orchestrator routes fixes to the owning task's agent; a re-review follows every fix round.

---

## Task 12: Rollout (orchestrator; LAST; not a coding task)

- [ ] **Step 1.** The rulings on G1–G18 are in the ledger (Task 0 step 3), and the spec carries every ruling that changed it.
- [ ] **Step 2. bis-ci** (only AFTER Task 11 approves): `gh workflow run ci-project-setup.yml -f step=push-dry-run --ref feat/s06-forward-to-record` → its log lists exactly `0083_inbound_never_log.sql`; then `-f step=push`. Post-apply, read-only with `pnpm --filter @bis/db ci:sql`: `select relrowsecurity from pg_class where oid='public.inbound_never_log'::regclass` → `t`; `select has_table_privilege('authenticated','public.inbound_never_log','INSERT'), has_table_privilege('authenticated','public.inbound_never_log','SELECT')` → `f, t`; `select polname, polpermissive from pg_policy where polrelid='public.inbound_never_log'::regclass order by 1` → `inbound_never_log_member_read t`, `inbound_never_log_no_technician f`; the faithfulness digest unchanged from Task 1's. Ledger line: `0083 APPLIED to bis-ci <date> (run <id>, file md5 <Task 1 step 6>) — NEVER RE-APPLY on bis-ci`. From here on the `@bis/db` suites may run against bis-ci again.
- [ ] **Step 3. Push and CI.** Until Step 2, `e2e` is red on its migration check by design; after Step 2, re-run and read `verify` and `e2e` ON THE HEAD SHA (`gh api repos/{owner}/{repo}/commits/<sha>/check-runs`), never an earlier run. A CI-vs-local disagreement is an environment finding first (memory "CI vs local divergence").
- [ ] **Step 4. Production** (MCP on `tlbkbmlrfafquucsmsmm`): read-only pre-flight `select max(version) from supabase_migrations.schema_migrations` → `20261016231609` (0082) and `select to_regclass('public.inbound_never_log')` → null; then `apply_migration` (name `inbound_never_log`) with 0083's exact text, ONCE (md5 equals Task 1 step 6's). `notify pgrst, 'reload schema'`. Ledger line: `0083 APPLIED TO PRODUCTION <date> (version <v>) — NEVER RE-APPLY`.
- [ ] **Step 5. Parity and the advisor.** `docs/runbooks/ci-supabase-project.md` §5: the table's columns, CHECKs (`pg_get_constraintdef`), the unique index, both policies (`pg_policy` `polqual` md5) and the grants equal on both projects; the client-write digest equal on both. MCP `get_advisors` (security): no new finding naming `inbound_never_log`.
- [ ] **Step 6. Gates, one at a time:** `pnpm check`, `pnpm --filter web build`, `pnpm --filter web test:e2e` (check no `screenshots.yml` run is in progress first).
- [ ] **Step 7. Merge** (squash, through the PR, after the head SHA's `verify` and `e2e` are green and Task 11's findings are closed; auto-merge on green, memory "Speed process"). The PR body names: G1–G18 and their rulings; ASSUMPTIONS A1–A3 and how each is checked; the pinned tests this PR changes; "Not in this PR"; that a teammate's automatic forwarding rule files and anyone else's is dropped (G10, as ruled); that a forward from BIS agency staff waits in Needs a look (G1, as ruled); that a held teammate forward filed by hand files as the customer's (G18); the 0083 apply lines.
- [ ] **Step 8. After the deploy:** on BIS's own production account only (Replies already `bis` since the part 1 smoke): open a test customer's record, Copy the Forwarding address; from the account's own reply-to mailbox forward a mail to it → it files on the thread with "Forwarded by someone on the team" (A1, A3); from an account member's mailbox (if one exists on that account) → "Forwarded by <name> · team"; from danlo's agency mailbox → it waits in Needs a look (G1 as ruled); add the sender's domain to Never record on Settings, send again → nothing new on the thread, the log shows `dropped (never record) account=<id>`, then remove it; optionally a vacation responder's reply → `dropped (automatic)`, and a member's automatic forwarding rule → filed (A2). Record each outcome in the ledger. If the mailbox's or a member's forward held `unverified` or `not_on_record`, stop and report before telling clients about forwarding. Tracker: item 7 / S-06 row updated to "part 2 (forward to a record, Never record) shipped #<n>" (memory "Roadmap tracker").

---

## Not in this PR

- Saving forwarded (or replied) attachments into the vault: the bubble still says "not saved yet" (spec "Out of scope").
- A separate token per record kind (a job, a child); the forwarding address on a household's or a business's page, or in the drawer (spec "Out of scope").
- Parsing the original sender out of a forwarded message (spec "Out of scope").
- A held teammate forward filed by hand from Needs a look keeps part 1's customer authorship (G18).
- A database-enforced 200 cap (G11).
- Web chat in the inbox and the channel-following composer (S-06 part 3).

## Spec coverage

| Spec section / requirement | Task |
|---|---|
| Decision 1: the forwarding address IS the reply address (same token) | 8 (`loadForwardingView` uses `ensureReplyToken` + `replyAddressFor`) |
| Decision 2 + §3 (as amended): team = members (any role) and the reply-to mailbox, never the agency; authenticated; else held | 3 (`matchTeamSender`, G1), 5 (pipeline, G13) |
| Decision 3 + Pipeline 1 (as amended): automatic mail dropped, every header case, null headers, mailer-daemon/postmaster, a team sender's lone auto-forward kept, log account + "automatic" | 4 (`classifyAutomatic`, G9, G10), 5 |
| Decision 4 + Pipeline 2: Never record dropped even for a customer; address by email key, domain + subdomain, lookalike, unparseable From; log account + "never record" | 3 (rules), 5 |
| Pipeline 3: customer first (part 1 unchanged), then team, else held | 5 |
| §1: the Forwarding row, Copy + "Copied", the hint, lazily made token, the domain follows the mode, off → agency hint / others nothing, Technician by the page's own scope, not in the drawer, EN + ES | 8, 2 (G12, G15) |
| §4: stored as filed, person mark (null id → "Someone on the team"), `meta.forwarded`, "Forwarded by Maria · team" EN + ES, whole text, no unread, no owner copy, no stop, attachments counted | 3 (`author`, G2, G3), 5 (file.ts, G5), 8 (thread line, G4) |
| §5: the list on Settings' Sending address card and on Branding, one component, Remove, "Address or domain" + Add ghost, Undo, empty state, validation, 200 cap, duplicate, Owners + agency only, Owner's language | 6, 7 (G6, G7, G8, G11, G14), 2, 3 |
| Data model 0083 | 1 (G17) |
| Failure table: automatic 200, never-record 200, team lookup 503, never-record lookup 503, unauthenticated team held | 5 |
| Tests: unit, route/pipeline, db/RLS, UI, e2e | 3, 4, 5, 1, 6, 7, 8, 10 |
| Applied bis-ci first, then production, then parity | 12 |

## Self-review notes (the writer's own pass, 2026-10-17)

- Counts read off this file: G1–G18 is eighteen rows (G1 and G10 changed by the owner, the other sixteen accepted); A1–A3 is three; Task 2's `WANT` holds 28 English keys and 28 `.es` twins (56 entries), and its second case asserts 28; Task 10's spec lists three tests; Task 12 has eight steps; Task 1's probes are (a)–(g), seven; the task table has thirteen rows (0–12).
- Names checked across tasks: `parseNeverLogPattern`, `neverLogMatches`, `NEVER_LOG_MAX` (Tasks 3, 5, 6); `listNeverLog`, `addNeverLog`, `removeNeverLog` (Tasks 3, 5, 6, 7, 10's table); `matchTeamSender` → `{ userId } | { mailbox: true } | null` (Tasks 3, 5); `classifyAutomatic` → `"none" | "automatic" | "auto_forwarded"` (Tasks 4, 5); `FORWARD_ACTOR_ID = "email-inbound-forward"` (Task 5, G5); `FileInput.forward: { authorId }` and meta `forwarded` / `forwarded_by` (Tasks 5, 8); `NewMessage.author` (Tasks 3, 5); `NeverLogView`, `AddNeverLogActionResult`, `RemoveNeverLogActionResult`, `runAddNeverLog`, `runRemoveNeverLog` (Tasks 6, 7); `ForwardingView`, `loadForwardingView` (Task 8); `data-never-log`, `data-never-log-entry`, `data-never-log-empty`, `data-never-log-error` (Tasks 7, 10).
