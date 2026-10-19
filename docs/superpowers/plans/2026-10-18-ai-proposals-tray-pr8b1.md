# One table for every AI suggestion, and the one review tray, PR 8b-1 (S-14 + F-019, first release item 8, migration 0088): implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every AI suggestion lives in one `proposals` table with a kind registry. Today's `call_proposals` rows are copied in. A mirror and a guard keep old tabs working, and keep them from deciding twice, through the deploy gap. The call generator writes to the new table. One decision module offers Accept, Edit and accept, Discard and Undo (Undo from a 10-second toast, accepted by the server for 2 minutes). One bilingual suggestion card replaces the three hand-copied renderings. It shows on the call page and in the Suggestions section of the account's To do page, which becomes the tray. The agency Work page reads the new table and stays read-only.

**Architecture:** One migration, **0088** (`proposals`). It opens with a self-check that it runs in one transaction holding a share-row-exclusive lock on `call_proposals`. It then creates the table with its CHECKs, same-account composite FKs to `calls` and `contacts`, an immutability trigger, five indexes, two read policies (member, plus a restrictive `exists` on the row's contact) and no client write grant. Three throwaway functions follow: `app.copy_call_proposals()`, the mirror (`after insert or update on call_proposals`) and the guard (`before update on call_proposals`, `select … for update` on the matching `proposals` row). The file then copies and re-checks. In `@bis/db`, `proposals.ts` replaces `call-proposals.ts`. The pure parts (`PROPOSAL_KINDS`, `PROPOSAL_SOURCES`, the statuses, the reasons, `effectiveStatus`, `proposalExpiresAt`, the payload types) live in a new subpath, `@bis/db/proposal-rules`, so no bare `vi.mock("@bis/db")` factory can blank them. In the web app:
- `lib/proposals/kinds/` is the registry: one module per kind, typed `Record<ProposalKind, KindDef>`.
- `lib/proposals/decide.ts` holds the decisions. It is injected with the request client and the service client and never imports `serviceDb`.
- `lib/proposals/actions.ts` holds four server actions. It is the only file that builds the service client, after the request client has read the row.
- `lib/proposals/view.ts` builds the card's plain data.
- `components/proposals/` holds the card (server), its client actions and their pure handlers.
- The call page, the To do page and the agency Work page are rewired to these.

**Tech Stack:** Postgres 17 (Supabase) migration, plpgsql triggers; supabase-js 2.110.8; Next.js 16 App Router server components and server actions; React 19; sonner toasts; vitest 4 (`renderToStaticMarkup`, no DOM, no jsdom); the `@bis/db` suites on a local PG18 replica (plus a local PostgREST for `withTestAccount` and the live decision tests) and CI `verify`; Playwright (bis-e2e-qa writes it, the orchestrator runs it).

**Spec:** `docs/superpowers/specs/2026-10-19-ai-proposals-review-tray-design.md` at `61772cac`, approved by the owner as written on 2026-10-18 (P1–P22). This plan covers ONLY the spec's 8b-1: §1's 8b-1 row, §2 P1–P22 as they bear on 8b-1, §3, **§4 whole**, §6, §7, §8 (8b-1 parts), §9, and §10's 8b-1 lines. 8b-2 (§5, 0089) gets its own plan. Base: `88019834` (= `origin/main`, #271, 8a-2 merged); the spec commits sit on it at `61772cac`. **0077–0087 are on bis-ci and production: never re-apply.** Every file:line below was read off this worktree at `61772cac`. Anything not read is labelled **Assumption**.

`<WT>` = `C:\Users\danlo\bis-platform\.claude\worktrees\s15-8b` (Git Bash: `/c/Users/danlo/bis-platform/.claude/worktrees/s15-8b`), branch `feat/item8b-review-tray`. `<SCRATCH>` = `/c/Users/danlo/AppData/Local/Temp/claude/C--Users-danlo-bis-platform/8a8a7081-d1c5-4710-8a6f-a94d0f61efd1/scratchpad` (the orchestrator may substitute its own session's scratchpad once, in Task 0, and every brief then carries that path literally). `<KIT8A2>` = `<SCRATCH>/s15b-kit`. Read 2026-10-18:
- `replica.sh` has `WT=/c/Users/danlo/bis-platform/.claude/worktrees/s15-8a2` at `:6`, the `*0087_*` skip at `:31`, and the `0087_record_summaries.sql` post block at `:36-41`.
- `pgrst.sh` has `SECRET="s15b-local-postgrest-jwt-secret-not-used-anywhere-real-0000"` at `:6` and `K=` naming `…/db21dcfe-6aee-47cd-8939-ff4f82a45810/scratchpad/s07-t3-impl`.
- Its `env-run.sh` exports `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` and `SUPABASE_DB_URL` (`:24-29`).

Path abbreviations:
- `…/calls/[callId]/` = `apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/calls/[callId]/`
- `…/tasks/` = `apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/tasks/`
- `…/work/` = `apps/web/src/app/(dashboard)/dashboard/work/`
- `…/styleguide/` = `apps/web/src/app/(dashboard)/dashboard/styleguide/`
- `ISR` = `apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/in-account-service-reads.test.ts`

## Owner rulings this plan builds on

The owner accepted P1–P22 wholesale on 2026-10-18 and approved the spec at `61772cac` the same day. The 8b-1 subset:

| # | Ruling | Where it lands |
|---|---|---|
| P1 | Two PRs; this is 8b-1 (0088) | whole plan |
| P2 | A new table, rows copied with their ids; mirror and guard until 0089 | Task 1 |
| P3 | The registry in code; the lists in `@bis/db`; CHECKs; a parity test | Tasks 1, 4, 5 |
| P4 | `source` plus one nullable FK per source; a CHECK per source | Task 1 |
| P5 | The kinds are `task`, `contact_field`, `opportunity_stage` | Tasks 1, 5 |
| P6 | The tray is the To do page's Suggestions section, plus the card on the call page; no new page or nav item | Task 8 |
| P7 | Edit and accept edits only each kind's editable fields; the stage goes forward only and never to the last stage | Task 5 (`validateEdit`) |
| P8 | Undo in the 10-second toast; the server accepts 2 minutes, by the decider only | Tasks 6, 7 |
| P9 | Undo returns the row to pending, keeps `undone_*` and clears `decided_*` / `applied_*` | Tasks 4, 6 |
| P10 | Out of date is stored with a reason; age is derived through `effectiveStatus`; superseded | Tasks 4, 6 |
| P11 | No Accept all | not built |
| P12 | Each card is its own view with one primary (Accept, or Save and accept in edit mode); no card wraps the stack | Task 7 |
| P13 | The applied write is the person's; the card carries the persona's AI mark | Tasks 6, 7 |
| P14 | Technicians see and decide only their assigned customers' suggestions; no-customer rows are Owner and Staff only | Task 1 (RLS); Task 6 (request client) |
| P15 | Compare-and-swap; the loser is told who answered | Tasks 4, 6 |
| P16 | The stop-request hold stays on the To do queue; `consent_hold` reserved in the registry | Task 5 (a comment and a type, no CHECK value) |
| P17 | No change to Sofía's live writes | not touched; Task 11 checks `finish-call.ts` changes only the two lines named in Task 4 |
| P18 | The model's to-do title stays English and carries `lang="en"`; the words around it follow the reader | Tasks 5, 7 |
| P19 | Today's pending rows age from the migration | Task 1 (copy) |
| P20 | The drawer does not change | Task 11 (no drawer file in the diff) |
| P21 | No weekly acceptance line | not built |
| P22 | A plain Accept of a past-due to-do is refused; the card shows "Was due …" | Tasks 5, 6, 7 |

## Reviewer notes on the approved spec, folded in

These four notes arrived with the brief. Each is fixed here and cited by the task that implements it.

1. **The two-session lock test names its error (probe at spec :368).** Without `for update`, the guard's plain read sees the row as pending and lets the old update through. The mirror's `status is not distinct from old.status` update then blocks on the new code's row lock, re-reads, matches nothing and raises `call_proposals_mirror_missed`. The old side still fails, just under a different name. A test that checks only "one side decides" therefore passes on the mutation. **Task 1** asserts `call_proposals_superseded` by name. It also pins the mirror's status condition in its own case, with the guard disabled (`call_proposals_mirror_missed` by name).
2. **Undo's sibling restore can meet the one-pending index.** A re-delivered webhook may have made a new pending row for the same call, kind and customer in the meantime. When the restore hits `23505`, the sibling stays `expired / superseded` and the collision is logged by id. Each sibling's compare-and-swap is scoped by `status = 'expired' and expired_reason = 'superseded' and decided_by = 'system' and decided_at = <the decided_at this Accept stamped>`. Accept stamps every sibling it supersedes with **its own** `decided_at` instant (**Tasks 4, 6**).
3. **Every refusing case gets its own `withRollback`.** A refusal aborts the transaction (`25P02` on the next statement). No two refusals share one transaction, unless one sits inside its own `savepoint` (`attempt()`, as in 8a-2). **Task 1** uses one `withRollback` per refusing case.
4. **Seed with `alter table … disable trigger`**, never `session_replication_role = replica`. That statement takes an **ACCESS EXCLUSIVE** lock on `call_proposals` until the `withRollback` ends. vitest runs `packages/db` files in parallel (no `fileParallelism: false` in `packages/db/vitest.config.ts`), so any other file that touches `call_proposals` waits while a copy test runs. In this PR that is any teardown that deletes `calls`, which cascades into it. Waiting is correct, but it is slow, so each disabled-trigger case is kept short: seed, enable, call, assert, nothing else (**Task 1**).

## Deviations from the spec, and spec-vs-code mismatches (the source decided; evidence cited)

1. **0088 proves its own transaction.** The spec asks for a `pg_locks` read from a second session, for each apply path (§4.1). The replica can run that check for `psql -1` and for the Supabase CLI path. It cannot run it for MCP `apply_migration`, which only reaches hosted projects, and using bis-ci or production as the test bed would write migration history.
   - **What 0088 does about it (plan fix I-1).** Its FIRST statement is a `do` block that sets `lock_timeout` to `5s` and stamps `txid_current()` into `bis.m0088_xid` (both with `set_config(…, true)`, transaction-local) and takes `lock table public.call_proposals in share row exclusive mode`. Inside a `do` block all three always run in the block's own transaction, on every PostgreSQL version and every client protocol. A bare `set local` or `lock table` as the second statement of a multi-statement string is NOT safe on PostgreSQL 17.6 (bis-ci, CI's stacks, production), and the CLI push already warns `SET LOCAL can only be used in transaction blocks`. The SECOND statement, another `do` block, raises `0088_not_one_transaction` unless the setting still equals `txid_current()`, `lock_timeout` reads `5s`, and `pg_locks` shows this backend holding `ShareRowExclusiveLock` on `call_proposals`. The same check runs again as the file's last statement.
   - **Why that fails closed.** A path that commits between statements (autocommit, or one transaction per statement) loses the transaction-local settings and releases the lock when the first block ends, so the second block raises before any DDL runs. The plan review proved this exact variant on the CLI pipeline, under `psql -1`, as a single simple-query string, and under autocommit (where it refused).
   - Task 2 runs the spec's second-session check on the replica for the paths it can reach, and runs a positive control for the self-check. **A PG18 replica result does not stand in for 17.6**: the decisive evidence for the CLI path is CI `verify` (PostgreSQL 17) applying 0088, which happens early because Task 1 Step 11 pushes the branch right after Task 1's commit.
2. **The pure parts live in a new subpath, `@bis/db/proposal-rules`.** That is `PROPOSAL_KINDS`, `PROPOSAL_SOURCES`, `PROPOSAL_STATUSES`, `EXPIRED_REASONS`, `PROPOSAL_MAX_AGE_MS`, `UNDO_WINDOW_MS`, `effectiveStatus`, `proposalExpiresAt`, `parse*` and the payload types. The barrel re-exports them as well. Precedent: `@bis/db/document-rules`, imported by `lib/record/author-mark.ts:2`. Web code imports these values from the subpath, so none of the **63** bare `vi.mock("@bis/db", () => ({` factories can blank them (read 2026-10-18: `grep -rln 'vi.mock("@bis/db", () => ({' apps/web/src apps/web/e2e | wc -l` → 63).
3. **The function names stay; the type is `Proposal`.** `insertProposal`, `listProposalsForCall`, `listPendingProposals`, `getProposal` and `listPendingProposalsForAgency` keep their names and argument lists, so the two bare factories that name them (`…/calls/[callId]/page.test.ts:77`, `…/work/page.test.ts:58-65`) keep resolving. `markProposalDecided` is replaced by `decideProposal` and its siblings (Task 4). `CallProposal` is renamed `Proposal`. Every literal and reader is fixed in the task that renames it (Task 4's list).
4. **`insertProposal` takes `expiresAt` explicitly** (`proposalExpiresAt(now)` = `now + 30 days`). The generator passes the call's own instant (`input.now`, which is `meta.endedAt`), not the database's `created_at`. The difference is the seconds between hang-up and insert, and the generator tests stay deterministic. The mirror and the copy follow §4.6 exactly.
5. **`groundedTurn` is added beside `groundedEvidence`, which is unchanged.** `grounding.ts:145` returns the turn's text and `grounding.test.ts` pins that. The new `groundedTurn(quote, transcript) → { text, index, at } | null` uses the same matcher (`findLastIndex` over the same predicate), and `groundedEvidence` becomes `groundedTurn(...)?.text ?? null`. The generator stores `evidence_ref = { turn: index, at }`.
6. **The generator takes `language: "en" | "es"`.** `finishCall` passes `spokenLanguage` (`finish-call.ts:392`); that is one added line at `:930-941`. The spec's §4.3 says "the call's `calls.language` at insert". `calls.language` is written from that same value (`finish-call.ts:387-392` "computed once, read twice"), so the two are equal by construction.
7. **The mirror's insert branch copies NEW's status and decision columns**, rather than forcing `pending`. For the only old writer, `insertProposal` (pending only, `call-proposals.ts:86-112`), this is identical. For any other insert (a test seed, a hand repair) it stays in sync instead of diverging.
8. **`(account_id, contact_id)` is a full index, not a partial one.** It serves the 8b-2 record read and also the contact FK's `on delete cascade`, which would otherwise scan every decided row. `(call_id, created_at desc)` already serves the call FK's cascade.
9. **The call page shows an unresolved stage move**, with "Review the stage change on this deal." It used to hide it (`proposals.tsx:117-123`, `:174`). The To do and agency screens already showed it that way (`work-list.tsx:212`, `agency-work-list.tsx:285`). One registry means one rule, and a suggestion nobody can see can never be discarded. Accept still runs `stillHolds`, which reads the deal.
10. **Undo's to-do helper carries what it compares.** It is `deleteTaskForUndo(db, accountId, taskId, actorId, expect: { title, dueAt })`. The spec's 4-argument signature cannot check "with the accepted title and due date" without it.
11. **`fillContactBlanksReport(...) → { fields, flagged }`** is the body of `fillContactBlanks`, which becomes `(await fillContactBlanksReport(...)).fields`. Undo's toast must know whether the fill raised a duplicate flag (§4.4: "Undone. The possible duplicate it found is still in Duplicates."). `fillContactBlanks` throws that fact away today (`contacts.ts:650`), while `flagDuplicatesAfterWrite` returns it (`contacts.ts:385-388`). It is one write path, so the "existing write path only" rule holds. Every other caller is unchanged.
12. **The old app action is not re-run in the guard's C1 test.** `…/calls/[callId]/actions.ts` leaves the tree in this PR (Task 8). Task 1's C1 case runs its exact SQL (`update call_proposals set status = 'accepted', decided_at = now(), decided_by = $2 where account_id = $1 and id = $3 and status = 'pending'`, the statement `call-proposals.ts:241-244` builds). It asserts `call_proposals_superseded`, an unchanged `proposals.decided_by` and an unchanged `tasks` count. The old action's reaction to that throw is read off the base source:
    - `markProposalDecided` throws at `call-proposals.ts:245`;
    - `acceptProposal` decides at `actions.ts:211` before any write at `:240`;
    - its catch answers `m["proposals.failed"]` at `:307-322`.

    The real pre-deploy tab is Task 12's owed smoke.
13. **The `call_proposals` grep after 8b-1 has four more allowed hits, all in `packages/db/src/test`.** The old table still exists until 0089, so its coverage stays (plan fix M2):
    - `proposals-bridge.test.ts` (the mirror, the guard, the copy);
    - `call-proposals-grants.test.ts`, kept whole until 8b-2;
    - `technician-scope.test.ts` and `server-only-writes-grants.test.ts`, which keep their `call_proposals` entries and gain `proposals` entries beside them.

    0089's PR deletes or retargets all four. So `grep -rn "call_proposals" apps packages/db/src` returns the gateway feature name (`ai-gateway.ts:11`, `ai-gateway-schema.test.ts:75`), those four test files, and nothing under `apps`.

    Comment-only mentions of a file that THIS PR deletes are retargeted by the task that owns the mentioning file:
    - `call-proposals.ts` (`finish-call.ts:258`, Task 4);
    - `call-proposals.test.ts` (`buckets.test.ts:98`, Task 4);
    - `call-proposals.spec.ts` (`session-state.ts:27`, `relationships.spec.ts:71`, Task 10).

    Mentions of `call-proposals-grants.test.ts` (`record-event.test.ts:6`, `automation-log-grants.test.ts:50`, `billing-schema.test.ts:109`, `:248`, `voice-web-sessions-grants.test.ts:19-188`) stay true and are left alone.
14. **The agency Work page also moves to the registry's `describe`.** It is English (an operator), read-only, and still links to the call (spec §4.3). §3 names three copies of the sentence builder; this removes the third (`agency-work-list.tsx:270-300`). The link keeps the `#call-proposals` anchor, so the call page's section keeps `id="call-proposals"`.
15. **The obsolete `proposals.*` keys stay in `messages.ts`, with no new readers.** All new copy is under `suggestions.*`. `proposals.work.heading` and `proposals.work.body` stay in use on the agency page (English, read-only, unchanged copy). The rest of the `proposals.*` keys lose their last reader in Task 8. They are left for 8b-2 to remove with the old table, so this PR deletes nothing from the catalogue that a baseline pins. Spec §7's "today's `proposals.*` keys gain their Spanish twins" is therefore replaced by new bilingual `suggestions.*` keys.
16. **Retry uses `common.retry`** (`messages.ts:300-301`, "Retry" / "Intentar de nuevo"), not the spec's "Reintentar". The catalogue already has one Retry, and a second key for the same button is how two words for one action start.
17. **Due dates read as `formatDateInZone(iso, zone, locale)`** (`lib/format.ts:84-92`: month, day and year). Examples: "Due Oct 21, 2026" / "Vence el 21 oct 2026". The spec's examples omit the year. This is the helper today's card uses (`proposals.tsx:99`), and a year-ahead due date (`MAX_DUE_AT_FORWARD_MS`, `generate.ts:58`) needs its year.
18. **The source label's date is `Intl` with `weekday: "short", month: "short", day: "numeric"`** in the account's zone. On node 24 here it reads `"Wed, Oct 14"` / `"mié, 14 de oct"` for `2026-10-14T14:42Z` in America/Chicago. The spec wrote "Tue, Oct 14" (an example) and "mar. 14 de oct.". The plan pins Intl's own output (Assumption A1 for CI's Node 22).
19. **The tray's cap is read as 201 rows.** `listPendingProposals` asks for 201, filtered to `expires_at > now`. The page shows 200 and says "Showing the newest 200." when it got 201. Today's silent `.limit(500)` is at `call-proposals.ts:139`.
20. **A test seam: `DecideDeps.afterRead?: () => Promise<void>`**. `decide.ts` awaits it between the read and the compare-and-swap. Only the barrier test sets it. The spec's barrier test (§8.1) needs a point to hold both Accepts at, and the alternative, wrapping supabase-js's builder chain, would test the wrapper.
21. **The decision tests are live tests on the replica.** They use real PostgREST and real write paths, as `…/calls/[callId]/actions.test.ts` does today (its header, `:41-55`). They run ONLY with the replica kit's `env-run.sh` sourced (Global Constraints). In CI `verify` they run against the runner's local stack, as the existing live tests do.
22. **`describe` returns `{ parts, detail, pastDue }`, not the spec's `{ before, after, detail }`** (§4.2; plan fix M12). The card must put `lang="en"` on the model's own words inside the line (P18), and a single string cannot carry that, so the line is a list of parts, each with an optional `lang`. `pastDue` tells the card to say "Was due …" and the decision to refuse a plain Accept (P22) from one computation. A contact field's "before" is always "(empty)" by construction (only blank fields are proposed), so it lives in the sentence, not in a field.

## Assumptions (not verified by reading; each has a named check)

- **A1** Node 22's ICU (CI `verify`) formats the source and decided-by dates exactly as node 24 does here, once `\u00A0` and `\u202F` become spaces. Check: Task 7's cases on CI `verify`. If CI differs, the reviewer pastes CI's output and the literal changes; the assertion's meaning does not.
- **A2** Supabase CLI `db push` (the `ci-project-setup.yml` path, `packages/db/src/ci/push.ts`) runs each migration file in one transaction on PostgreSQL 17.6, the version bis-ci, CI's stacks and production run. **The local replica is PG18 and does not stand in for 17.6.** Checks: Task 2 Step 2 on the replica (the CLI connects; it is supporting evidence only), and, decisively, 0088's self-check (deviation 1) on CI `verify` (PostgreSQL 17), whose `ci-local-supabase.sh:305` applies migrations with that same `supabase db push`. Task 1 Step 11 pushes the branch right after Task 1's commit, so `verify` applies 0088 long before Task 11, and the orchestrator reads that log in Task 2 Step 4.
- **A3** MCP `apply_migration` runs the file's text in one transaction. A search did not settle it (`supabase/mcp` issue #241 only says it calls `POST /v1/projects/{ref}/database/migrations`). Check: 0088's self-check fails closed before any DDL if not (deviation 1), and Task 12 step 5 reads the result. If it raises on production, see Question 1.
- **A4** Vercel's project API returns the skew-protection maximum age as a field of `GET /v9/projects/{idOrName}`, believed to be named `skewProtectionMaxAge`, in seconds. The Vercel MCP `get_project` does not expose it (ledger, 8b spec fix). Check: Task 12 step 1 reads it on the dashboard (Project → Settings → Advanced → Skew Protection), with the API as a cross-check. The spec's own assumption is "about 12 hours".
- **A5** `record_event` (the user-client path of `emit`, `events.ts:20-22`) accepts any event type string, so `task.deleted` needs no allow-list change. Check: Task 6's to-do Undo case reads the `events` row back.
- (Read, not assumed:
  - `emit(db, accountId, type: string, …)` at `events.ts:16-18`;
  - `addTask` at `activities.ts:35-50`;
  - `moveOpportunityToStage` at `opportunities.ts:54-72`, which returns early when already there;
  - `updateContact` and `toRow` at `contacts.ts:519-560` and `:117-152` (the phone through `phoneFields`; an empty string clears email and phone; names are stored as given);
  - `fillContactBlanks` at `contacts.ts:570-651`, with the "Caller" placeholder rule at `:580`;
  - `normalisePhone` at `phone.ts:93`;
  - `taskAssigneeFor` and `readPersonId` in the barrel at `index.ts:253`;
  - `listPeopleNames(db, ids)` at `record.ts:496`;
  - `getVoiceProfile(db, accountId)` at `voice.ts:159`, whose `persona_name` the call page reads at `page.tsx:180-194`;
  - `requestLocale` at `request-locale.ts:35-64`;
  - `makeTr(locale, pseudo)` at `record/copy.ts:15`;
  - `t()` at `i18n/t.ts:36-45`;
  - `UNDO_WINDOW_MS = 2 * 60 * 1000` at `lib/consent/staff-actions.ts:51`;
  - the toast-with-Undo shape in `…/calendar/cancel-booking.ts:69-91`, a pure handler with an injected `schedule`, tested without a DOM;
  - `tasks` writable by `authenticated` under `0003`'s member policy and 0068's fence (`0068:134-141`);
  - `calls.language not null default 'en'` at `0019_voice_core.sql:52`;
  - `app.sees_all_customers` covering the agency at `0068:75-78`;
  - `calls_account_id_id_key` at `0064_call_card.sql:103-104`;
  - `contacts_account_id_id_key` at `0050_same_account_fks.sql:94-95`.)

## Global Constraints

### Git and commits

- **NEVER `git stash`, `git reset`, `git restore`, `git checkout`, `git commit --amend`, or any history rewrite** in the shared worktree. Another agent's uncommitted work lives in the same tree.
- To undo your own edit, edit it back. To see committed text, use `git show HEAD:<path>`.
- Reviewers revert their probes BY HAND and prove it with `cmp` against `git show HEAD:<path> > <SCRATCH>/<dir>/orig` (`cmp` prints nothing).
- Never `rm -rf` anything under `<WT>` (memory "No rm -rf on worktrees"). Scratch directories under `<SCRATCH>` are yours.
- Stage new files with `git add -- <new paths>`, then commit with `git commit -m "…" -- <every path>`, never `-A` or `.`. A deleted file is named in the commit's path list.
- If `.git/index.lock` exists, wait and retry; never delete it.
- Never push (the orchestrator pushes). Never touch `main`. Nobody merges or rebases but the orchestrator.
- **Commits** end with the two trailer lines `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>` and `Claude-Session: https://claude.ai/code/session_013RThMy9QC8x7FZ94Lxib9p`.

### The database and the projects

- **0088 is NOT on bis-ci until Task 12 step 2.** Until then:
  - **No `@bis/db` vitest and none of the three LIVE web tests may run against bis-ci.** The db suite's globalSetup sweep and the fixture teardown walk `ACCOUNT_OWNED_TABLES`, which will name `proposals`, a table bis-ci does not have yet.
  - The three live web tests are `apps/web/src/lib/reports/weekly-metrics.live.test.ts`, `…/calls/[callId]/actions.test.ts` (deleted in Task 8) and `apps/web/src/app/f/[publicId]/actions.returning-lead.test.ts`. This PR adds a fourth, `apps/web/src/lib/proposals/decide.live.test.ts`.
  - Never pass a folder that contains one of them to vitest (`…/accounts/`, `apps/web/src/app/f/`, `apps/web/src/lib/reports/`, `apps/web/src/lib/proposals/`); name each file.
  - Every `@bis/db` suite and every live web test runs on YOUR local PG18 replica ("The replica kit") with its `env-run.sh` sourced, or is left to CI `verify`.
  - `packages/db/.env` and `apps/web/.env.local` do NOT exist in `<WT>`. Never create either. Never run `pnpm --filter @bis/db exec vitest` with the default env, and never `pnpm --filter @bis/db ci:sql`.
- **Nobody but the orchestrator applies 0088 anywhere but their own replica.** The order is bis-ci (Task 12 step 2), then the e2e run, then production, then parity, then merge. bis-ci and production reads belong to the orchestrator, through the Supabase MCP, read-only.
- **No production credential in Preview, ever.** This PR adds no env var anywhere.

### 0088's byte and SQL rules

- ASCII only and no backslash anywhere. The only `$` characters are the `$$` pairs around the seven bodies (three `do` blocks and four functions), so 28 `$` characters in 14 `$$`. Character classes are written as `'[^0-9a-f]'`, never with an anchor.
- The first two statements are the self-check (deviation 1): a `do` block that sets `lock_timeout` to `5s` and takes the lock, then a `do` block that checks it. There is no bare `set local` and no bare `lock table` anywhere in the file.
- RLS is on. SELECT for `authenticated` comes through the member policy plus the restrictive contact policy. No INSERT, UPDATE or DELETE for `anon` or `authenticated`; `service_role` holds all four.
- Every function is `set search_path = ''` with every name schema-qualified. The three bridge functions are `security definer`. Every function has `revoke all … from public, anon, authenticated, service_role`.
- The rollback note in the header is in §4.1's order.

### Who builds which client

- **The request client authorises; the service client decides.** Every read that authorises a decision (`getProposal`) runs on the REQUEST client under RLS. Every `proposals` write runs on the service client, scoped by `account_id`, `id` and the status compare-and-swap. Every CRM write (`addTask`, `fillContactBlanksReport`, `moveOpportunityToStage`, `updateContact`, `deleteTaskForUndo`) runs on the REQUEST client, so RLS refuses what the person could not do by hand (P14).
- `lib/proposals/actions.ts` is the only new file that names `serviceDb`. It joins `ISR`'s `ALLOWED` as `"proven-target"`. `decide.ts`, the registry and `view.ts` take clients as parameters and never name it.

### `@bis/db` mocks

- Web code imports the pure values (`effectiveStatus`, `PROPOSAL_KINDS`, `proposalExpiresAt`, `UNDO_WINDOW_MS`, `PROPOSAL_MAX_AGE_MS`) ONLY from `@bis/db/proposal-rules` (deviation 2).
- No module under `lib/proposals/` or `components/proposals/` reads a value from `@bis/db` at import time. A kind module's `apply: (…) => addTask(…)` is a function, never `apply: addTask` (that would be an import-time read under a bare factory).
- **Which bare factories meet the new graph** (plan fix M4). A test file imports the page or list it tests, not `lib/proposals`, so a grep for `lib/proposals` imports inside test files answers EMPTY and proves nothing. The right question is which bare-factory tests import a module that imports the new code. Task 8 runs:

  ```
  grep -rln 'vi.mock("@bis/db", () => ({' apps/web/src | xargs grep -lE "from ['\"]\./(page|work-list|agency-work-list)['\"]"
  ```

  and keeps only results under `…/calls/[callId]/`, `…/tasks/` and `…/work/`. **Expected output: exactly `…/calls/[callId]/page.test.ts` and `…/work/page.test.ts`** (read 2026-10-19: `…/tasks/page.test.ts:105` and `…/tasks/actions.test.ts:32` use `async (importOriginal)` factories; the agency list's test imports `./agency-work-list`, which only Step 3 changes, and it is in the grep's pattern too, so a bare factory there would show). A different output is a finding to read, not a pattern to widen. For each file listed, list every `@bis/db` value the new import graph CALLS during its tests and add it to the factory.
- The grep matches IMPORTS, not text (the 8a-2 final review: a text grep matched a URL in an assertion and could never answer empty).

### Ownership (tag on every task; no task edits a file its owner does not own)

- **bis-db-schema:**
  - Task 1: `packages/db/supabase/migrations/0088_proposals.sql`, `packages/db/src/test/proposals-schema.test.ts`, `packages/db/src/test/proposals-bridge.test.ts`, `packages/db/src/test/technician-scope.test.ts` (`:28`, `:75`, additions only), `packages/db/src/test/server-only-writes-grants.test.ts` (additions beside `:54`, `:85`, `:154`, `:217`, `:244-245`, `:304-330`), `packages/db/src/account-teardown.ts` (`ACCOUNT_OWNED_TABLES` `:24` and the `call_proposals` paragraph `:62-71`), and `<SCRATCH>/s15c-kit/*`. `packages/db/src/test/call-proposals-grants.test.ts` is NOT edited or deleted (plan fix M2; 8b-2 removes it with the table).
  - Task 2: `<SCRATCH>/s15c-t2/*` only; it makes no repo change unless 0088's text must change.
- **bis-crm:**
  - Task 3: `apps/web/src/lib/messages.ts` and one `describe` appended to `apps/web/src/lib/messages.test.ts`.
  - Task 4: `packages/db/src/proposals.ts`, `packages/db/src/proposal-rules.ts`, `packages/db/src/call-proposals.ts` (deleted), `packages/db/package.json` (one `exports` line), `packages/db/src/index.ts` (the block at `:165-169`), `packages/db/src/contacts.ts` (`fillContactBlanksReport`), `packages/db/src/activities.ts` (`deleteTaskForUndo`), `packages/db/src/test/proposals.test.ts` (from `call-proposals.test.ts`, deleted), `apps/web/src/lib/proposals/{generate,grounding}.ts` and their three tests, `apps/web/src/lib/voice/finish-call.ts` (`:930-941`, one line; `:258`, one comment word), `apps/web/src/lib/db.ts:13` and `apps/web/src/lib/automations/passes/quote-followup.ts:34` (comment words), plus the type-only and literal edits Task 4 names in web files.
  - Task 5: `apps/web/src/lib/proposals/kinds/*` (+ tests) and `apps/web/src/lib/proposals/local-day.ts` (+ test).
  - Task 9: `apps/web/src/lib/i18n/{catalogue,ratchet}-baseline.json`.
- **bis-platform:**
  - Task 6: `apps/web/src/lib/proposals/{decide,actions}.ts`, `decide.live.test.ts`, `actions.test.ts`, and one `ALLOWED` line in `ISR`.
- **bis-frontend:**
  - Task 7: `apps/web/src/lib/proposals/view.ts` (+ test), `apps/web/src/components/proposals/*` (+ tests), `…/styleguide/page.tsx` (the "Proposal status" section `:594-610` and the `STATUS_TREATMENT` import `:27`, `:75`) and its test if one pins that section; `apps/web/src/lib/format.ts:7` (`export` on `tag` only, M11).
  - Task 8: `…/calls/[callId]/{page.tsx,page.test.ts}`; the deletions `…/calls/[callId]/{actions.ts,actions.test.ts,proposals.tsx,proposals.test.ts,proposal-actions.tsx,proposal-actions.test.ts}`; `…/tasks/{page.tsx,page.test.ts,work-list.tsx,loading.tsx}`; `…/work/{agency-work-list.tsx,agency-work-list.test.ts,page.tsx,page.test.ts}`; `apps/web/src/lib/work/buckets.test.ts:95-115`; and `ISR` (one line out: `:72`). Task 6's line in `ISR` lands first; Task 8 starts after Task 6.
- **bis-e2e-qa:** Task 10: `apps/web/e2e/suggestions.spec.ts` (replaces `apps/web/e2e/call-proposals.spec.ts`, deleted), and the comment lines `apps/web/e2e/fixtures/session-state.ts:27` and `apps/web/e2e/relationships.spec.ts:71`.
- **Orchestrator:** Task 0, the ledger, the bis-ci and production applies of 0088, the parity check, the gates, the PR, the merge and the tracker (Task 12).

### Shared files, one task at a time

- `apps/web/src/lib/messages.ts`: **Task 3 only**. Every key this plan uses is listed there. A later task that finds one missing STOPS and reports; the orchestrator re-opens Task 3 sequentially, never beside another catalogue edit.
- `packages/db/src/index.ts`: **Task 4 only**.
- `ISR`: Task 6 (one line in), then Task 8 (one line out), never at once.
- `apps/web/src/lib/i18n/*-baseline.json`: Task 9 only, after every copy-bearing task.

### Every test must be able to fail

- The plan names each test's mutation, and the implementer RUNS it: run the probe, see the test fail BY NAME, paste the failing assertion line, then revert by editing back (and `cmp` it). A named mutation that does not fail its test is a finding: say so and substitute one that does.
- Shapes a reviewer rejects on sight (memory "Vacuous test shapes"):
  - `toBeTruthy` or `toBeDefined` on content;
  - a count-only guard where content can be asserted;
  - a WANT built from the function under test (the dates are typed out, never `formatX(...)` inside the assertion);
  - an English-only assertion where a Spanish twin exists;
  - a mock that satisfies itself;
  - an e2e locator another element could satisfy (scope to `[data-suggestion="<id>"]`);
  - `not.toContain` on raw `renderToStaticMarkup` output for a string with an apostrophe (use `renderedText()` from `apps/web/src/lib/rendered-text.ts`).
- A `-t` filter that matches nothing passes silently: read the run count.
- **Every probe changes code the test actually exercises, and the plan says why the test then fails.**

### Every account-scoped read has a second-account case in which the OTHER account holds matching rows

- The schema's RLS: an Owner of account B reads none of A's rows while B has its own.
- Each `@bis/db` read (`listProposalsForCall`, `listPendingProposals`, `getProposal`, the sibling read): account B's id with A's call, contact or id answers nothing while B holds a matching row of its own.
- Each `@bis/db` write (`decideProposal`, `revertProposalDecision`, `undoProposalDecision`, `expireProposals`, `restoreSiblings`, `setAppliedRef`): account B's id moves nothing of A's.
- The decisions: an Accept through account B's action for A's suggestion is "This suggestion isn't available." and writes nothing.
- The copy's pre-check: a cross-account row.

### DESIGN.md definition of done for Tasks 7 and 8

- Tokens only (`rounded-[var(--radius-card)]` for the card, `--radius-ctl` for controls, no hex, no literal shadow); both themes via `.dark`; the blur fallback (the card adds no blur).
- Rule 3: status is dot plus word.
- Rule 5: loaded, empty (section absent) and error ("Couldn't load suggestions." with Retry).
- Rule 6: Undo in the toast.
- Rule 7: skeleton cards while loading, never a spinner.
- Rule 8: one primary per card (Accept, or Save and accept in edit mode); Edit and accept, Discard and Cancel are `variant="ghost"`; no card wraps the stack.
- Rule 11: no `data-hero`; numbers in text colour.
- Keyboard: every control is a `<button>` or a form control with the visible focus ring, and Esc cancels edit mode. `lang` goes on the section, on the model's to-do title (`en`) and on the evidence (`evidence_lang`). Controls are `min-h-11 md:min-h-8`.
- English, Spanish and the pseudo-locale at 360 px. `/styleguide` shows the card in all five states.

### Copy

- Every new string goes through `tr.text(key, params)` (`makeTr`), with an `.es` twin on the next line in the same commit (`apps/web/src/lib/i18n/ratchet.test.ts`). Spanish is **usted**.
- New `.tsx` code carries no JSX literal copy with a letter in it.
- No vendor or plumbing words in copy ("OpenAI", "model", "proposal", "registry", "payload", "token", "RPC").

### Running tests

- Only the affected tests, by path: `pnpm --filter web exec vitest run "<path>" …`.
- **`pnpm --filter web typecheck` in EVERY task that touches a `.ts`/`.tsx` file**, and `pnpm --filter @bis/db typecheck` in every task that touches `packages/db/src`. Web typecheck must be GREEN at every task's commit. A task that cannot keep it green STOPS and reports; it never commits red.
- `pnpm --filter web exec eslint "<touched files>"`.
- `@bis/db` suites run only on your replica, in `packages/db`, as `node node_modules/vitest/vitest.mjs run <files>` after sourcing the kit's env (`export SUPABASE_DB_URL=…` for a `withRollback` suite; `source <dir>/env-run.sh` for a `withTestAccount` or live suite). Judge by vitest's summary block. Capture the exit code to a file, with nothing after the command in the same block; the pnpm `ERR_PNPM_RECURSIVE_EXEC_FIRST_FAIL` trailer lies.
- Never run the gates (`pnpm check`, `pnpm --filter web build`, `pnpm --filter web test:e2e`). Never run Playwright except `--list`. The orchestrator runs them, one at a time (memory "Agent test scope").
- **No jsdom in this repo.** A client component's effect or toast behaviour is proven by a pure handler with injected `toast` and `schedule` (the `cancel-booking.ts` shape), and in the browser only by the e2e (Task 10).

### Other rules

- **Mutating e2e only on the per-run fixture account** (`readClientFixture()`, `apps/web/e2e/support.ts:103`), never `Test Client One`. Every row it writes is deleted in `afterAll`, each error checked, then re-read.
- **Never** apply a migration outside your own replica, run SQL that writes to a shared project, mutate Test Client One, create or edit any `.env*` file, set a Vercel secret, or call a real model.

## The replica kit (every `@bis/db` task, every live web test, and their reviewers)

This lane's ports are **55670–55679**, never `5432`, never 8a-2's 55660–55669. Each agent works in its own `<SCRATCH>/s15c-t<N>-<impl|review>/`.

| Who | Postgres | PostgREST | gateway |
|---|---|---|---|
| Task 1 implementer | `55670` | — | — |
| Task 1 reviewer, then Task 2, then Task 11 (in that order; each stops it before the next) | `55671` | Task 11 only: `55678` | Task 11 only: `55679` |
| **Set A**: Task 4 implementer, then Task 6 implementer (Task 4 stops its kit first) | `55672` | `55673` | `55674` |
| **Set B**: Task 4 reviewer, then Task 6 reviewer | `55675` | `55676` | `55677` |

Task 1 builds `<SCRATCH>/s15c-kit/` from `<KIT8A2>` with `sed` and shows the `diff`. Only these lines may differ:
- in `replica.sh`: the `WT=` line (`:6`, becomes `/c/Users/danlo/bis-platform/.claude/worktrees/s15-8b`), the skip (`:31`, `*0087_*` → `*0088_*`), the post block's file name (`0087_record_summaries.sql` → `0088_proposals.sql`, `:36-37`) and its three messages (`post = pre + 0088`, `0088 FAILED`, `post = pre (no 0088 yet)`);
- in `pgrst.sh`: only `SECRET=` (`:6`, becomes `s15c-local-postgrest-jwt-secret-not-used-anywhere-real-0000`).

`pre` is every migration through **0087**; `post` is `pre` plus the branch's 0088. The kit applies each file with `psql -1` (`replica.sh:32`, `:37`): one transaction per file.

Bring up PostgREST for a `withTestAccount` or live suite: `bash <SCRATCH>/s15c-kit/replica.sh <pg> <dir>`, then `bash <SCRATCH>/s15c-kit/pgrst.sh <pg> <pgrst> <gateway> <dir>`, then `source <dir>/env-run.sh` in the same shell that runs vitest.

A live web test (`decide.live.test.ts`) runs from `apps/web` with the same env sourced. `loadEnv({ path: ".env.local" })` finds no file in `<WT>`, and dotenv never overrides a set variable, so the replica's values are the ones used. `refuseProduction` passes them, since they name `127.0.0.1`.

Stop your own kit only (never `taskkill /IM postgrest.exe`):
1. `touch "<dir>/stop"`.
2. In PowerShell: `Get-Process postgrest | Where-Object { $_.Path -eq '<dir as a Windows path>\postgrest.exe' } | Stop-Process -Confirm:$false`.
3. In PowerShell: `Get-NetTCPConnection -LocalPort <gatewayPort> -State Listen | ForEach-Object { Stop-Process -Id $_.OwningProcess -Confirm:$false }`.
4. `"/c/Program Files/PostgreSQL/18/bin/pg_ctl" -D "<dir>/pgdata" stop -m fast`.

A SQL mutation probe on `post` needs `psql … -d post -c "notify pgrst, 'reload schema'"` afterwards when PostgREST is up.

**Faithfulness** (once per kit build): the client-write-surface digest on `pre` must equal bis-ci's. bis-ci has 0087 and not 0088 until Task 12 step 2. **The orchestrator runs the query on bis-ci through MCP `execute_sql` (read-only, `odnobiodsftffphuuosz`) in Task 0 and puts the value in Task 1's brief.** The query:

```sql
select count(*) || '|' || md5(string_agg(x, ',' order by x)) from (
  select r || ' ' || c.relname || ' ' || p as x
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  cross join (values ('anon'), ('authenticated')) v(r)
  cross join (values ('INSERT'), ('UPDATE'), ('DELETE')) w(p)
  where n.nspname = 'public' and c.relkind = 'r' and has_table_privilege(r, c.oid, p)) s;
```

Stop if `pre` differs from bis-ci. 0088 must leave it UNCHANGED on `post`, because it adds no client write grant. The 8a-2 value was `51|0dd3e2d7e19f3f3649a893cfd9967d94` (ledger, Task 0 of 8a-2). 0087 added no client write, so Task 0 expects the same value and reads it fresh.

## Pinned tests this PR changes (stated outright)

- `packages/db/src/test/call-proposals.test.ts` (491 lines) → `proposals.test.ts` (Task 4). Every case is kept and retargeted. The `markProposalDecided` cases (`:115-181`) become `decideProposal` cases with the same mutations (`drop .eq("status","pending")`, `drop .eq("account_id")`). The work-queue no-contamination case (`:426-491`) is kept unchanged in force.
- `packages/db/src/test/call-proposals-grants.test.ts` (475 lines): UNCHANGED and still run (plan fix M2). With 0088, its inserts are mirrored, which none of its assertions reads. Its cases are also re-stated for `proposals` in `proposals-schema.test.ts` (Task 1). 8b-2 deletes it with the table.
- `packages/db/src/test/technician-scope.test.ts:28`, `:75` (plan fix M2): `call_proposals` stays, and `PER_CONTACT` gains `proposals: "id"` beside it. The seed inserts ONLY the `call_proposals` row (`:75`, unchanged); the mirror makes its `proposals` twin with the same id, so the seed map gets `proposals` = that same id (one line). The table-by-table case's mutation ("drop any one table's restrictive policy") now also covers `proposals_technician_scope`. That fence reads the row's own contact, which the mirror copied from the call proposal, so the expected visibility is the same as the old table's.
- `packages/db/src/test/server-only-writes-grants.test.ts` (plan fix M2; every `call_proposals` line stays):
  - `:54` still seeds `call_proposals`, and the mirror makes the twin (`s.proposalId` names both);
  - beside `:85`, add `{ table: "proposals", policy: "proposals_member_read", fence: { name: "proposals_technician_scope", cmd: "SELECT" } }` (FOR SELECT, not ALL);
  - beside `:154`, add `["proposals", "proposalId"]`;
  - beside `:217` and `:244-245`, add the same refused update against `proposals`;
  - after `:304-330`, add "0088: `proposals_decision_complete`", a twin of that block with `proposals_decision_complete` in the regex.
- `apps/web/src/lib/proposals/generate.test.ts`:
  - `base` (`:146`) gains `language: "en"`.
  - The three whole-row `toEqual({`s (`:237`, `:382` and the third) gain `source: "call"`, `evidence_ref: { turn: 1, at: "2026-09-18T12:00:00.000Z" }`, `evidence_lang: "en"` and `expires_at: "<base.now + 30 days, typed out>"`.
  - `:270` `["call_proposals"]` becomes `["proposals"]`.
  - Every other assertion is UNCHANGED (Task 4).
- `apps/web/src/lib/proposals/generate.fallback.test.ts:16`: `base` gains `language: "en" as const` (Task 4).
- `apps/web/src/lib/proposals/grounding.test.ts`: UNCHANGED; new `groundedTurn` cases appended (Task 4).
- `apps/web/src/lib/voice/finish-call.test.ts`: ONE `toHaveBeenCalledWith(expect.objectContaining({` (`:1116`) gains `language: <that test's spoken language>`. The other nine are UNCHANGED (Task 4).
- `…/tasks/page.test.ts:171-180`, `…/work/page.test.ts` (its `proposal()` builder), `…/work/agency-work-list.test.ts:39-46`, `…/calls/[callId]/page.test.ts` (its proposal literal) and `…/calls/[callId]/proposals.test.ts`: each builder's base literal gains the new `Proposal` fields (Task 4, one edit each). Task 8 then rewrites the assertions that move (to-do rows become cards).
- `apps/web/src/lib/work/buckets.test.ts:95-115`: `CallProposal` → `Proposal`. The `@ts-expect-error` stays true, because a `Proposal` now has a `source` but still no `title`, `dueAt` or `occurredAt`. Its comment says so (Task 4). Not weakened.
- `ISR`: `:72` (`calls/[callId]/actions.ts`) leaves (Task 8); `"lib/proposals/actions.ts": "proven-target",` enters (Task 6); `:74` (`calls/[callId]/page.tsx`) stays.
- `packages/db/src/account-teardown.ts`: `"proposals",` goes directly before `"calls",`, with one comment line; the `call_proposals` paragraph (`:62-71`) is rewritten for `proposals` (Task 1).
- **Unchanged, checked:**
  - `packages/db/src/test/schema-grants-guard.test.ts`, whose allow-list does not change;
  - `packages/db/src/test/ai-gateway-schema.test.ts:75` (the feature name);
  - `apps/web/src/lib/i18n/request-locale-callers.test.ts` (every new `requestLocale(` call passes `userLanguage` through a named variable, as `tasks/page.tsx:62-63` does);
  - `…/[contactId]/` and the drawer (P20; no file there is in the diff);
  - `apps/web/src/lib/consent/*` and `…/tasks/consent-hold-actions.tsx` (P16).

## Not in this PR

- §5 whole: the tray's grouping, the agency Work page's actions, the record's "Waiting for you", the timeline row, "See it in the transcript", the agency RPC, and dropping `call_proposals`, the mirror, the guard and the copy function (0089).
- The drawer (P20), Accept all (P11), the weekly acceptance line (P21), the stop hold's move (P16), new sources or kinds, Spanish model text (P18), Sofía's live writes (P17).
- **A note for the 8b-2 plan (plan fix M15).** On **bis-ci**, the deploy gap never closes at READY plus the skew age. Every other branch's Vercel Preview still runs pre-8b code against bis-ci until that branch merges `main`, so old-code writes to `call_proposals` on bis-ci can arrive at any time. 0089's evidence item 1 (spec §4.6, "no `call_proposals` row created or decided after READY + max age") can therefore hold on production but not on bis-ci. 8b-2 needs another basis for bis-ci. One option: list the open Preview deployments whose commit predates 8b-1's merge, and apply 0089 to bis-ci only when none is left; or accept that bis-ci's leftover `call_proposals` rows are test data and say so in the ledger. The 8b-2 plan decides; this PR records only the READY time and the skew age (Task 12).

## File Structure

**Created**

| Path | Owner | Responsibility |
|---|---|---|
| `packages/db/supabase/migrations/0088_proposals.sql` | bis-db-schema | the self-check, the table, RLS, grants, the immutability trigger, the copy, the mirror, the guard, the copy call |
| `packages/db/src/test/proposals-schema.test.ts` | bis-db-schema | columns, CHECKs, FKs, cascades, the index, the trigger, who reads, grants, the parity of the CHECK lists |
| `packages/db/src/test/proposals-bridge.test.ts` | bis-db-schema | the copy, the mirror, the guard, the two-session lock (deleted with them in 8b-2) |
| `packages/db/src/proposal-rules.ts` | bis-crm | the pure lists, types, `effectiveStatus`, `proposalExpiresAt`, the windows; subpath `@bis/db/proposal-rules` |
| `packages/db/src/proposals.ts` (+ `test/proposals.test.ts`) | bis-crm | insert, reads, and the decision writes (compare-and-swap) |
| `apps/web/src/lib/proposals/local-day.ts` (+ test) | bis-crm | `localDateKey`, `firstInstantOfLocalDay`, `addLocalDays` |
| `apps/web/src/lib/proposals/kinds/{types,task,contact-field,opportunity-stage,index}.ts` (+ tests) | bis-crm | the registry |
| `apps/web/src/lib/proposals/decide.ts` (+ `decide.live.test.ts`) | bis-platform | Accept, Edit and accept, Discard, Undo |
| `apps/web/src/lib/proposals/actions.ts` (+ `actions.test.ts`) | bis-platform | four server actions: the auth, the clients, the revalidation |
| `apps/web/src/lib/proposals/view.ts` (+ test) | bis-frontend | `SuggestionView` from a row |
| `apps/web/src/components/proposals/{suggestion-card.tsx,suggestion-actions.tsx,suggestion-handlers.ts,suggestion-section.tsx}` (+ tests) | bis-frontend | the card, its client controls, their pure handlers, the section (heading, cap, error, skeleton) |
| `apps/web/e2e/suggestions.spec.ts` | bis-e2e-qa | the tray and the call page on the fixture account |

**Deleted:**
- `packages/db/src/call-proposals.ts`, `packages/db/src/test/call-proposals.test.ts`;
- `…/calls/[callId]/{actions.ts,actions.test.ts,proposals.tsx,proposals.test.ts,proposal-actions.tsx,proposal-actions.test.ts}`;
- `apps/web/e2e/call-proposals.spec.ts`.

**Modified:** everything in "Pinned tests" above, plus:
- `packages/db/package.json`, `packages/db/src/{index,contacts,activities,account-teardown}.ts`;
- `apps/web/src/lib/proposals/{generate,grounding}.ts`, `apps/web/src/lib/voice/finish-call.ts`;
- `apps/web/src/lib/messages.ts` (+ test);
- `…/calls/[callId]/page.tsx`, `…/tasks/{page.tsx,work-list.tsx}`, `…/work/{page.tsx,agency-work-list.tsx}`, `…/styleguide/page.tsx`;
- `apps/web/src/lib/i18n/*-baseline.json`.

## Task list, owners, order

| # | Task | Agent | Review | Depends on | Files |
|---|---|---|---|---|---|
| 0 | Confirm the base; install; read bis-ci and production | orchestrator | n/a | — | none |
| 1 | Migration 0088 and its proof on the replica; the kit; teardown; retarget the db tests | bis-db-schema | **opus** | 0 | 0088, two test files, retargets, `account-teardown.ts` |
| 2 | The one-transaction check | bis-db-schema | **opus** (orchestrator reads it) | 1 reviewed | scratch only |
| 3 | Every key (**messages.ts, the only writer**) | bis-crm | sonnet | 0 | `messages.ts`, `messages.test.ts` |
| 4 | `@bis/db`: rules, module, helpers, barrel; the generator; every literal the rename breaks | bis-crm | **opus** | 1 (table on the replica), 3 (keys for the interim status map) | see Task 4 |
| 5 | The kind registry and local days | bis-crm (2nd agent) | **opus** | 3, **4's commit** (types) | `lib/proposals/kinds/*`, `local-day*` |
| 6 | Decide and the four actions | bis-platform | **opus** | 4, 5 | `lib/proposals/{decide,actions}*`, one `ISR` line |
| 7 | The card, the section, the view, the styleguide | bis-frontend | **opus** | 3, 5 | `components/proposals/*`, `lib/proposals/view*`, styleguide |
| 8 | Wire the call page, the tray and the agency page; delete the old block | bis-frontend | **opus** | 6, 7 | see Task 8 |
| 9 | Regenerate the i18n baselines | bis-crm | sonnet | 3, 7, 8 | `lib/i18n/*-baseline.json` |
| 10 | The e2e spec | bis-e2e-qa | sonnet | 8, 9 | `e2e/suggestions.spec.ts`, two comment lines |
| 11 | Whole-branch final review (checkpoint) | bis-reviewer, then bis-design-reviewer | **opus** | 1–10 | none |
| 12 | Rollout (orchestrator; LAST) | orchestrator | n/a | 11 | none in the repo |

```
Wave A (two lanes):   T1 (bis-db-schema)              T3 (bis-crm, messages.ts)
Wave B (two lanes):   T2 (bis-db-schema, after T1's review)   T4 (bis-crm, after T1's commit and T3's commit)
Wave C:               T5 (bis-crm 2nd agent, after T4's COMMIT)
Wave D (two lanes):   T6 (bis-platform, after T4, T5)   T7 (bis-frontend, after T3, T5)
Wave E:               T8 (bis-frontend, after T6 and T7 commits)
Wave F:               T9, then T10
Checkpoint:           T11
Rollout:              T12 (orchestrator, LAST)
```

**Why these waits.**
- **T4 waits for T1's commit** because its `proposals.test.ts` runs on `post`, which needs 0088.
- **T4 also waits for T3's commit**, because the interim status map in `…/calls/[callId]/proposals.tsx` (deleted in T8) needs the two new status keys.
- **T5 waits for T4's commit**: it imports `Proposal`, `ProposalKind`, the payload types and `ExpiredReason` from `@bis/db/proposal-rules` (lesson: a task depending on another task's types waits for that task's commit). If Task 4 runs long, it may land Step 3's `proposal-rules.ts`, its `package.json` line and the barrel block as an early commit, reviewed with the rest, and T5 starts on that commit.
- **T6 and T7 share no file.** T7 builds the card against the action TYPES this plan fixes in Task 6's Interfaces block (`SuggestionActionResult`, `UndoResult`), declared in `components/proposals/suggestion-handlers.ts` by T7. T6's `actions.ts` imports them from there, so T6 waits for T7's handlers file. T6 Step 0 checks it exists. If it does not exist yet, T6 writes `decide.ts` first and `actions.ts` last.
- **T8 waits for both T6 and T7.**
- **Only Task 3 writes `messages.ts`.**

**0088 goes to bis-ci only AFTER Task 11 approves it UNCHANGED.** Until then, the e2e job's migration check is red on every push; that is expected and is named in each CI reading. 0088 is additive, and the new code reads only `proposals`, so **the migration goes to production BEFORE the merge** (spec §10).

---

## Task 0: Confirm the base; install; read bis-ci and production (orchestrator)

- [ ] **Step 1.** In `<WT>`, `git log --oneline -3` shows this plan's commit, then `61772cac`, `b4a52cca`, `126c440c`, on `88019834`. Run `git fetch origin && git log --oneline origin/main -1`.
  - If `main` moved past `88019834`, read what moved it.
  - If it touched any file in "File Structure" or added a migration, `git merge origin/main` into `<WT>` ONCE now (never rebase).
  - If it added `0088_*`, STOP: the number is taken.
- [ ] **Step 2.** `pnpm install --frozen-lockfile` in `<WT>` (this worktree has no `node_modules`). `git status --short` shows no lockfile change.
- [ ] **Step 3.** Confirm each line, and stop if any differs:
  - `ls packages/db/supabase/migrations | tail -1` → `0087_record_summaries.sql`; `git log --all --oneline -- 'packages/db/supabase/migrations/0088*'` → nothing.
  - `grep -n 'from "./call-proposals"' packages/db/src/index.ts` → `169:`.
  - `grep -n '"calls", "bookings", "calendars", "events",' packages/db/src/account-teardown.ts` → `24:`.
  - `grep -n 'calls/\[callId\]/actions.ts": "proven-target"' "$ISR"` → `72:`.
  - `grep -n '"aiSettings.summariesToday.es"' apps/web/src/lib/messages.ts` → `5049:` (the catalogue's last key); `wc -l < apps/web/src/lib/messages.test.ts` → `930`.
  - `grep -n 'const base = {' apps/web/src/lib/proposals/generate.test.ts apps/web/src/lib/proposals/generate.fallback.test.ts` → `:146`, `:16`.
  - `grep -n 'expect(db.tablesTouched).toEqual(\["call_proposals"\])' apps/web/src/lib/proposals/generate.test.ts` → `270:`.
  - `grep -c 'vi.mock("@bis/db", () => ({' $(grep -rl 'vi.mock("@bis/db", () => ({' apps/web/src apps/web/e2e) | wc -l` → `63`.
  - `ls "<KIT8A2>/replica.sh" "<KIT8A2>/pgrst.sh"` and the three files `pgrst.sh` copies (`…/db21dcfe-…/scratchpad/s07-t3-impl/{postgrest.exe,make-jwt.js,proxy.mjs}`) all exist.
- [ ] **Step 4. Read-only MCP** (the orchestrator; no agent reads a shared project). Write every value in the ledger. On production (`tlbkbmlrfafquucsmsmm`) and on bis-ci (`odnobiodsftffphuuosz`):
  - `select max(version) from supabase_migrations.schema_migrations` names the **0087** apply on both; `select to_regclass('public.proposals')` → null on both.
  - `select status, count(*) from public.call_proposals group by status order by 1` (the copy's expected `by_status`).
  - **The copy's pre-check, read early:**

    ```sql
    select count(*) from public.call_proposals cp join public.calls k on k.id = cp.call_id
      left join public.contacts c on c.id = cp.contact_id
     where k.account_id <> cp.account_id or (cp.contact_id is not null and c.account_id is distinct from cp.account_id);
    ```

    It must return **0** on both, or 0088 will raise at apply time. If it is not 0, STOP and report to the owner before Task 1 starts.
  - **The fence's meaning, read early:**

    ```sql
    select count(*) from public.call_proposals cp join public.calls k on k.id = cp.call_id
     where cp.contact_id is distinct from k.contact_id;
    ```

    0068 fences `call_proposals` through the CALL's contact (`0068:127-129`); 0088 fences through the row's own contact (spec §4.1). Every generator write passes the call's contact (`generate.ts:446`, `:518`, `:596`), so the expected count is 0. A non-zero count is not a stop. Record it in the ledger and in Task 11's brief: those rows' Technician visibility changes with 0088.
  - On bis-ci only: the Faithfulness query. Record its value for Task 1's brief.
- [ ] **Step 5.** Ledger line: "8b-1 plan executing; P1–P22 owner-approved 2026-10-18 at 61772cac; 0088 not yet on any project; prod call_proposals by_status = …; pre-check 0/0; fence-meaning count prod … bis-ci …; bis-ci faithfulness …".

---

## Task 1: Migration 0088 and its proof on the replica; the kit; teardown; the db tests retargeted (bis-db-schema)

**Review:** opus. **Runs beside:** Task 3. **Scratch:** `<SCRATCH>/s15c-t1-impl/`, replica port `55670` (the reviewer uses `s15c-t1-review/` and `55671`). **No `@bis/db` vitest against bis-ci** (Global Constraints).

**Files**
- Create: `<SCRATCH>/s15c-kit/replica.sh`, `<SCRATCH>/s15c-kit/pgrst.sh` (outside the repo)
- Create: `packages/db/supabase/migrations/0088_proposals.sql`
- Create: `packages/db/src/test/proposals-schema.test.ts`, `packages/db/src/test/proposals-bridge.test.ts`
- Modify: `packages/db/src/account-teardown.ts:24` and `:62-71`; `packages/db/src/test/technician-scope.test.ts:28`, `:75`; `packages/db/src/test/server-only-writes-grants.test.ts:54`, `:85`, `:154`, `:217`, `:244-245`, `:304-330`; the comment mentions listed in deviation 13 that this task owns.

**Interfaces**
- Consumes (SQL): `public.accounts(id)`; `public.calls (account_id, id)` (`calls_account_id_id_key`); `public.contacts (account_id, id)` (`contacts_account_id_id_key`); `public.calls.language`; `app.is_agency()`, `app.current_account_id()`, `app.sees_all_customers(uuid)` (`0068:75-78`); `public.call_proposals` (0040, 0053, 0068).
- Produces (SQL), every name a later task reads:
  - `public.proposals (id, account_id, source, call_id, contact_id, kind, payload, applied_payload, applied_ref, evidence, evidence_ref, evidence_lang, status, expired_reason, decided_at, decided_by, undone_at, undone_by, expires_at, created_at)`.
  - Constraints `proposals_source_check`, `proposals_kind_check`, `proposals_status_check`, `proposals_expired_reason_check`, `proposals_evidence_lang_check`, `proposals_evidence_nonempty`, `proposals_source_key`, `proposals_applied_when_accepted`, `proposals_edited_changes`, `proposals_expired_has_reason`, `proposals_decision_complete`, `proposals_undone_pair`, `proposals_call_fkey`, `proposals_contact_fkey`.
  - Index `proposals_one_pending_per_call`.
  - Policies `proposals_member_read`, `proposals_technician_scope`.
  - Trigger `proposals_proposed_is_fixed` (error message `proposals_proposed_is_fixed`).
  - `app.copy_call_proposals() returns jsonb` → `{copied, skipped, by_status}`.
  - Triggers `call_proposals_mirror`, `call_proposals_guard`; error messages `call_proposals_superseded: <id>`, `call_proposals_mirror_missed: <id>`, `proposals_copy_cross_account: <n> rows`, `proposals_copy_mismatch: …`, `0088_not_one_transaction`.
  - `ACCOUNT_OWNED_TABLES` holds `"proposals"` directly before `"calls"`.

- [ ] **Step 1: Build the kit.**

```bash
S=/c/Users/danlo/AppData/Local/Temp/claude/C--Users-danlo-bis-platform/8a8a7081-d1c5-4710-8a6f-a94d0f61efd1/scratchpad
K="$S/s15b-kit"
mkdir -p "$S/s15c-kit" "$S/s15c-t1-impl"
sed -e 's#/worktrees/s15-8a2$#/worktrees/s15-8b#' -e 's#\*0087_\*#*0088_*#' -e 's#0087_record_summaries.sql#0088_proposals.sql#g' \
    -e 's#post = pre + 0087#post = pre + 0088#' -e 's#0087 FAILED#0088 FAILED#' -e 's#(no 0087 yet)#(no 0088 yet)#' \
    "$K/replica.sh" > "$S/s15c-kit/replica.sh"
sed -e 's#s15b-local-postgrest#s15c-local-postgrest#' "$K/pgrst.sh" > "$S/s15c-kit/pgrst.sh"
diff "$K/replica.sh" "$S/s15c-kit/replica.sh"; diff "$K/pgrst.sh" "$S/s15c-kit/pgrst.sh"
```

Paste both diffs: only the lines named in "The replica kit" may differ. Run `bash "$S/s15c-kit/replica.sh" 55670 "$S/s15c-t1-impl"` → `post = pre (no 0088 yet)`. Run the Faithfulness query on `pre` and compare it with the bis-ci value in your brief; stop if they differ. Then seed one row on `pre` to rehearse the copy: `psql … -d pre -c "select count(*) from call_proposals"` → 0 (expected on a fresh replica; the copy tests seed their own).

- [ ] **Step 2: Read before writing.**
  - `cat -n packages/db/supabase/migrations/0040_call_proposals.sql` (whole);
  - `sed -n 115,135p packages/db/supabase/migrations/0053_server_only_writes.sql`;
  - `sed -n 120,130p packages/db/supabase/migrations/0068_mine_unassigned_technician.sql`;
  - `sed -n 1,75p packages/db/supabase/migrations/0087_record_summaries.sql` (header, the rollback note, `lock_timeout`, the composite FK, the two-policy fence with `exists`, grants);
  - `packages/db/src/test/db.ts` (`withRollback`, `actAs`, `actAsMember`, `actAsOwner`);
  - `sed -n 1,120p packages/db/src/test/record-summaries-schema.test.ts` (the seed with owner, staff, two technicians and a second account; `attempt()` with its savepoint);
  - `sed -n 295,346p packages/db/src/test/document-shares-schema.test.ts` (the two-session pattern: three `Client`s, `waitUntilBlocked`, committed rows deleted in `finally`);
  - `cat -n packages/db/src/test/call-proposals-grants.test.ts` (whole: its cases are re-stated for `proposals`; the file itself stays);
  - `sed -n 1,140p packages/db/src/test/technician-scope.test.ts`;
  - `sed -n 40,100p;200,335p packages/db/src/test/server-only-writes-grants.test.ts`.

- [ ] **Step 3: Write the failing tests.**

**`packages/db/src/test/proposals-schema.test.ts`.** Shape: `record-summaries-schema.test.ts`'s seed (accounts A and B; in A, an owner, staff, `tech` assigned to contact `Mine` and `tech2` assigned to contact `Theirs`; a call per contact, plus one call with no contact; in B, its own contact, call and pending proposal). A helper:

```ts
const ins = (c: Client, o: { acct: string; call: string; contact: string | null; kind?: string; status?: string; extra?: string }) =>
  c.query<{ id: string }>(
    `insert into proposals (account_id, source, call_id, contact_id, kind, payload, evidence, expires_at${o.extra ? ", " + o.extra.split("=")[0] : ""})
     values ($1, 'call', $2, $3, $4, '{"title":"Send the quote","dueAt":null}', 'I need a quote', now() + interval '30 days'${o.extra ? ", " + o.extra.split("=")[1] : ""}) returning id`,
    [o.acct, o.call, o.contact, o.kind ?? "task"]);
```

(The implementer may write `ins` more plainly. Its meaning is fixed: one valid pending row, with optional overrides.)

Cases. **Each refusing case runs in its own `withRollback`** (reviewer note 3), and each names its mutation in its title:

1. "the table exists" (`to_regclass`): guards every case below from vacuity.
2. "anon holds nothing; authenticated holds exactly SELECT; service_role holds DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE; the full grant set across every role including PUBLIC is exactly this". Plan fix M1: the project's default ACL also gives `service_role` REFERENCES, TRIGGER and TRUNCATE, exactly as `call-proposals-grants.test.ts:184-190` lists for the old table. The query is the `information_schema.role_table_grants` one from `call-proposals-grants.test.ts:175-210`, retargeted; the expected list is that file's list with the table name changed. Mutation: `grant insert on public.proposals to authenticated` → FAILS.
3. "authenticated holds UPDATE on no column" (`information_schema.column_privileges`). Mutation: `grant update (status) on public.proposals to authenticated` → FAILS. This is the spec's probe :362, "Grant `update (payload)` to `authenticated`".
4. "a client cannot INSERT a proposal, even for its own account and call": `actAs` owner of A, insert → `42501`. Mutation: as in case 2.
5. "who reads" (one `withRollback`, reads only; nothing refuses). Seed A rows for `Mine`, `Theirs` and a no-contact call, and B's own row.
   - Owner of A reads exactly A's three ids (sorted).
   - Staff reads the same.
   - `tech` reads exactly the `Mine` row.
   - The agency reads all four.
   - Owner of B reads exactly B's one id.

   Mutations:
   - drop `proposals_technician_scope` → `tech` reads three, FAILS;
   - replace `exists (…)` with `true` → FAILS;
   - drop `proposals_member_read`'s `account_id = app.current_account_id()` arm (leave `app.is_agency()`) → the owner reads none, FAILS;
   - remove the account predicate: `using (true)` → the B owner reads A's rows, FAILS (the second-account case, with B holding its own row).
6. "the composite FKs refuse a call from another account" (its own `withRollback`): insert with A's account and B's call → `23503`, the message naming `proposals_call_fkey`. Mutation: FK `references public.calls (id)` on `call_id` alone → FAILS.
7. "…and a contact from another account" (its own `withRollback`): A's account, A's call, B's contact → `23503` naming `proposals_contact_fkey`. Mutation: as case 6, for the contact.
8. "deleting a call removes its rows; deleting a contact removes its rows" (one `withRollback`, no refusal). Mutation: `on delete no action` on either → FAILS with `23503` at the delete.
9. "account teardown lists `proposals` before `calls`": `ACCOUNT_OWNED_TABLES.indexOf("proposals")` is ≥ 0 and `<` `indexOf("calls")`. Mutation: move it after `"calls"` → FAILS.
10. Each in its own `withRollback`, each a refusal with the constraint name in the message (`23514`), each with its mutation (drop that constraint → FAILS):
    - a pending row with `decided_at` set (`proposals_decision_complete`);
    - an `accepted` row with `decided_*` but no `applied_payload` (`proposals_applied_when_accepted`);
    - a pending row WITH an `applied_payload` (same constraint, the other direction);
    - an `edited` row whose `applied_payload` equals `payload` (`proposals_edited_changes`);
    - an `expired` row with no `expired_reason` (`proposals_expired_has_reason`);
    - a `pending` row WITH a reason (same constraint);
    - `source = 'call'` with `call_id` null (`proposals_source_key`);
    - `kind = 'note'` (`proposals_kind_check`);
    - `status = 'done'` (`proposals_status_check`);
    - `expired_reason = 'stale'` (`proposals_expired_reason_check`);
    - `evidence_lang = 'fr'` (`proposals_evidence_lang_check`);
    - whitespace-only evidence (`proposals_evidence_nonempty`);
    - `undone_at` without `undone_by` (`proposals_undone_pair`).
11. "an insert without `expires_at` fails" (its own `withRollback`): `23502` (not null). Mutation: `expires_at timestamptz not null default now() + interval '30 days'` → FAILS (the insert succeeds).
12. "the immutability trigger refuses a change to `payload`, `evidence`, `expires_at`, `contact_id` or `kind`, from the service role too". Five cases, each its own `withRollback`, `set local role service_role` first. Each expects a raise whose message contains `proposals_proposed_is_fixed`. A sixth case, "decision columns move freely", sets `status = 'dismissed', decided_at = now(), decided_by = 'u'` and must succeed. Mutation: drop the `payload` line from the trigger → the payload case FAILS.
13. "the one-pending index refuses a second pending row for the same call, kind and customer, including when the customer is null" (two `withRollback`s: one with a contact, one without). Expect `23505` naming `proposals_one_pending_per_call`. A third, non-refusing case: once the first is dismissed, a second pending row is accepted. Mutation: drop the `coalesce` (index on `(call_id, kind, contact_id)`) → the null-contact case FAILS.
14. "the CHECK lists equal the code's lists": read `pg_get_constraintdef` for `proposals_kind_check` and `proposals_source_check`, extract the quoted values with `/'([a-z_]+)'/g`, sort, and compare with `[...PROPOSAL_KINDS].sort()` and `[...PROPOSAL_SOURCES].sort()` from `../proposal-rules`. **This case lands RED in Task 1 if `proposal-rules.ts` does not exist yet. Task 1 therefore writes this case as `it.todo("parity with proposal-rules (Task 4 turns this on)")`, and Task 4 replaces the `todo` with the real case** (one `it` in this file, Task 4's edit, named in Task 4). Task 5 adds the third side (`Object.keys(KINDS)`) in a web test.
15. "the Faithfulness digest is unchanged by 0088": this is asserted in Step 7 by query, not as a test.

**`packages/db/src/test/proposals-bridge.test.ts`.** This file is deleted with the bridge in 8b-2, and its header says so. A seed of its own: accounts A and B, each with a contact, a phone number and a call (whatever `calls` requires, copied from `technician-scope.test.ts`'s seed). Two helpers:

```ts
const offSql = "alter table public.call_proposals disable trigger call_proposals_mirror, disable trigger call_proposals_guard";
const onSql  = "alter table public.call_proposals enable trigger call_proposals_mirror, enable trigger call_proposals_guard";
const cp = (c: Client, acct: string, call: string, contact: string | null, status = "pending", kind = "task") =>
  c.query<{ id: string }>(
    `insert into call_proposals (account_id, call_id, contact_id, kind, payload, evidence, status, decided_at, decided_by)
     values ($1, $2, $3, $4, '{"title":"Send the quote","dueAt":null}', 'I need a quote', $5,
             case when $5 = 'pending' then null else now() end, case when $5 = 'pending' then null else 'user_old' end)
     returning id`, [acct, call, contact, kind, status]);
```

The file's header carries reviewer note 4: `alter table … disable trigger` takes ACCESS EXCLUSIVE on `call_proposals` until the `withRollback` ends. Every case that uses it does only seed, enable, call and assert. vitest runs `packages/db` files in parallel, so another file's teardown that deletes `calls` waits on this lock for the length of one case.

Cases (one `withRollback` each unless stated):

1. **The copy, by status.** `offSql`. Seed `pending`, `accepted` and `dismissed` rows, plus one more `pending` on a second kind. Assert `select count(*) from proposals where id = any($1)` → **0**. That assertion is what makes the case unable to pass on mirrored rows. Then `onSql`; `select app.copy_call_proposals() as r`.
   - `r` equals `{ copied: 4, skipped: 0, by_status: { pending: 2, accepted: 1, dismissed: 1 } }`.
   - Each copied row has `id`, `status`, `decided_at` and `decided_by` equal to its source.
   - `applied_payload` equals `payload` for the `accepted` row and is null for the others.
   - `evidence_ref` is `{}`; `evidence_lang` is the call's `language`.
   - `expires_at` equals `greatest(created_at, now()) + interval '30 days'`, compared in SQL as `abs(extract(epoch from expires_at - (greatest(created_at, now()) + interval '30 days'))) < 1`. A seeded `created_at` 40 days ago still expires 30 days from now (P19).

   Mutations: map `accepted` → `pending` in the copy's select (`case when cp.status = 'accepted' then 'pending' else cp.status end`) → FAILS (the post-check raises `proposals_copy_mismatch`, or the by-status assertion fails; either way the case is red; the spec's probe :365). Separately, `expires_at = cp.created_at + interval '30 days'` → the 40-day-old row's assertion FAILS.
2. **A second call copies nothing new.** As case 1, then call the copy again → `{ copied: 0, skipped: 4, … }`. Mutation: drop `on conflict (id) do nothing` → the second call raises `23505`, FAILS.
3. **The cross-account pre-check** (its own `withRollback`). `offSql`. Seed one good row, then one `call_proposals` row whose `account_id` is A but whose `call_id` is B's call. `call_proposals` has no composite FK, so the seed succeeds with the triggers off. `onSql`. `select app.copy_call_proposals()` raises a message matching `/^proposals_copy_cross_account: 1 rows/`. The case then reads, in a savepoint before the call, that `proposals` holds 0 of both ids. After the raise the transaction is aborted, so "copied nothing" is proven by the raise happening BEFORE the insert: the case's second half runs the copy in a savepoint (`attempt()`) and, after `rollback to savepoint`, `count(*) from proposals where id = any(…)` → 0. Mutation: drop the pre-check → the insert hits `proposals_call_fkey` (`23503`), and the case FAILS on the message (spec probe :366).
4. **The cross-account contact pre-check** (its own `withRollback`): as case 3, with A's call and B's contact. Mutation: drop the contact half of the pre-check's `where` → FAILS on the message.
5. **The mirror's insert.** Triggers on (the default). `cp(c, A, callA, contactA)` → the same id appears in `proposals` with `source 'call'`, `status 'pending'`, `evidence_lang` the call's language, `evidence_ref '{}'`, and `expires_at` equal to `created_at + 30 days` (to the second). Mutation: drop the `insert` branch → FAILS (no row).
6. **An old-code Accept through `call_proposals` succeeds and sets `applied_payload`.** Insert (mirrored), then `update call_proposals set status = 'accepted', decided_at = now(), decided_by = 'user_old' where id = $1 and status = 'pending'` → 1 row. `proposals` row: `status 'accepted'`, `decided_by 'user_old'`, `applied_payload = payload`, `expires_at` unchanged from before the update. Mutation: the update branch sets `status`, `decided_*` only (no `applied_payload`) → the update raises `23514` `proposals_applied_when_accepted`, FAILS (spec probe :370).
7. **An old-code revert of its own Accept clears `applied_payload`.** As case 6, then `update call_proposals set status = 'pending', decided_at = null, decided_by = null where id = $1 and status = 'accepted' and decided_by = 'user_old'` → 1 row. `proposals`: pending, `decided_*` null, `applied_payload` null, `expires_at` unchanged. Mutation: `applied_payload = case when new.status = 'accepted' then p.payload else p.applied_payload end` → FAILS (`23514`, the pending-with-payload direction).
8. **A mirror that cannot write blocks the old write** (its own `withRollback`). `cp(c, A, callA, contactB)`: B's contact on A's row. `call_proposals`' plain FK accepts it, but the mirror's insert into `proposals` meets `proposals_contact_fkey` → the insert, run inside `attempt()`, fails with `23503`. After `rollback to savepoint`, `select count(*) from call_proposals where contact_id = $B` → 0. Mutation: wrap the mirror's insert in `begin … exception when others then null; end` → FAILS (the row lands in `call_proposals` alone).
9. **The guard (C1).** Insert (mirrored). As the service role, the new code's compare-and-swap: `update proposals set status = 'accepted', decided_at = now(), decided_by = 'user_new', applied_payload = payload where id = $1 and status = 'pending'` → 1 row. Then, in `attempt()`, the old code's exact statement from deviation 12 (`update call_proposals set status = 'accepted', decided_at = now(), decided_by = 'user_old' where account_id = $1 and id = $2 and status = 'pending'`) raises a message matching `/^call_proposals_superseded: /`. After `rollback to savepoint`:
   - `proposals.decided_by` = `'user_new'`;
   - `call_proposals.status` = `'pending'`;
   - `select count(*) from tasks where account_id = $A` is unchanged from before, because the old action decides before it writes (deviation 12) and this case writes no task.

   Mutation: drop the guard trigger → the old update succeeds, then the mirror's update meets `p.status = 'accepted'` ≠ `old.status 'pending'` and raises `call_proposals_mirror_missed`. **So the case asserts the error BY NAME, `call_proposals_superseded`**, and the mutation FAILS it on the name (spec probe :367; reviewer note 1's logic applies here too).
10. **The guard lets an old-code revert of its own Accept through.** As case 6 (old Accept, mirrored), then the old revert → 1 row, no raise. Mutation: make the guard raise whenever `v_status <> 'pending'` → FAILS.
11. **The guard over a missing `proposals` row raises, asserted BY NAME** (plan fix I-6). `offSql`; insert into `call_proposals` (no mirror, so no `proposals` row); `onSql`; in `attempt()`, the old Accept update raises a message matching `/^call_proposals_superseded: /`.

    Mutation (a): replace `if not v_found or v_status is distinct from old.status` with `if v_status <> old.status`. A null `v_status` makes the `if` null, so the guard lets the update through, and the MIRROR's update then matches no row and raises `call_proposals_mirror_missed`. The update still fails, but under the wrong name, so the `toMatch` FAILS (spec probe :369).
11b. **The same, with the mirror disabled** (its own `withRollback`): `offSql`; insert into `call_proposals`; then `alter table public.call_proposals enable trigger call_proposals_guard` only (the mirror stays off); the old Accept update raises `call_proposals_superseded` by name. Mutation (a) → the update goes through (`rowCount` 1, no error), FAILS. This isolates the guard from the mirror's own refusal.

    **The `not v_found` arm is recorded as redundant, and its probe is dropped.** With no row, `v_status` is null, and `null is distinct from old.status` is already true for every `old.status` (the column is `not null`), so dropping `not v_found` cannot change any outcome. It stays in the function for the reader, and no test claims to pin it.
12. **The mirror's status condition, with the guard disabled (reviewer note 1).** `alter table public.call_proposals disable trigger call_proposals_guard` (the mirror stays on). Insert (mirrored). New-code compare-and-swap to `accepted` by `'user_new'` (as case 9). Then, in `attempt()`, the old Accept update raises a message matching `/^call_proposals_mirror_missed: /`. After `rollback to savepoint`, `proposals.decided_by` = `'user_new'`. Mutation: drop `and p.status is not distinct from old.status` from the mirror's update → the old update succeeds and overwrites `decided_by` with `'user_old'`, FAILS.
13. **The guard's lock, two sessions (R1), order 1: the new code first.** NOT in `withRollback`: real commits. Three `Client`s (`seedC`, `a`, `b`) as in `document-shares-schema.test.ts:295-346`.
    1. `seedC` creates a throwaway account, contact, number and call, then inserts a `call_proposals` row. The mirror creates the `proposals` row, and `seedC` commits.
    2. `a`: `begin; set local role service_role; update proposals set status = 'accepted', decided_at = now(), decided_by = 'user_new', applied_payload = payload where id = $1 and status = 'pending'` → 1 row, uncommitted.
    3. `b` (old code, as service role): `const waiting = b.query("update call_proposals set status = 'accepted', decided_at = now(), decided_by = 'user_old' where id = $1 and status = 'pending'", [id]).then(() => "ok", (e) => String(e.message))`.
    4. `waitUntilBlocked(seedC, b's pid)`, which proves B waits on a lock.
    5. `a.query("commit")`.
    6. `expect(await waiting).toMatch(/^call_proposals_superseded: /)`. **By name, not "one side decided"** (reviewer note 1).
    7. Then `proposals.decided_by` = `'user_new'` and `call_proposals.status` = `'pending'`.

    `finally`: roll back `a` (ignore errors); delete the throwaway account's `call_proposals` (by call), `proposals`, `calls`, `phone_numbers`, `contacts` and `accounts` rows; end all three clients. Mutation: `select … from public.proposals where id = old.id` without `for update` → B's guard reads `pending` (A uncommitted), passes, and B's mirror update blocks on A's row lock. After A commits, the update re-checks, matches nothing and raises `call_proposals_mirror_missed`. The `toMatch(/^call_proposals_superseded/)` FAILS (spec probe :368; reviewer note 1).
14. **The guard's lock, order 2: the old code first.** As case 13, but:
    1. `b` begins and runs the old Accept update (succeeds: guard in sync, mirror sets `proposals` to accepted by `user_old`), uncommitted.
    2. `a`: `const waiting = a.query(<the new compare-and-swap>)` blocks; `waitUntilBlocked`.
    3. `b` commits.
    4. `expect((await waiting).rowCount).toBe(0)`.
    5. `proposals.decided_by` = `'user_old'`.

    Mutation: none needed beyond case 13's. This order proves the new code loses cleanly (0 rows, not an error) and never overwrites. Its own probe: change the new compare-and-swap's `and status = 'pending'` to nothing → `rowCount` 1, FAILS. That probe is on the test's own statement, which mirrors `decideProposal`'s filter: Task 4 pins the same filter in `proposals.test.ts`.

- [ ] **Step 4: Run them red.** `bash "$S/s15c-kit/replica.sh" 55670 "$S/s15c-t1-impl"` (no 0088 yet). In `packages/db`, `export SUPABASE_DB_URL=postgresql://postgres@localhost:55670/post`, then `node node_modules/vitest/vitest.mjs run src/test/proposals-schema.test.ts src/test/proposals-bridge.test.ts > "$S/s15c-t1-impl/red.out" 2>&1; echo $? > "$S/s15c-t1-impl/red.code"`. Every case fails on "relation proposals does not exist" (or `app.copy_call_proposals` missing). Paste the summary block.

- [ ] **Step 5: Write `packages/db/supabase/migrations/0088_proposals.sql`.** The full text:

```sql
-- 0088_proposals.sql - one table for every AI suggestion (first release item 8, part 8b-1; S-14, F-019)
-- (docs/superpowers/specs/2026-10-19-ai-proposals-review-tray-design.md section 4.1 and 4.6;
--  docs/superpowers/plans/2026-10-18-ai-proposals-tray-pr8b1.md)
--
-- A suggestion is a QUESTION about work, never work itself (0040's reason stands): nothing here reaches
-- the CRM without a person's Accept, and the app writes this table through the service role only.
-- source says where the suggestion came from; each source has its own nullable foreign key (call_id
-- today) so losing the call loses its suggestions. payload is what was proposed and never changes;
-- applied_payload is what was written (the payload, or the edited form); applied_ref is what Undo needs.
-- An aged pending row (past expires_at) is out of date to every reader through effectiveStatus in
-- @bis/db/proposal-rules; nothing here sweeps it.
--
-- THE BRIDGE (dropped by 0089): today's call_proposals rows are copied here with their ids. Until
-- 0089, a pre-deploy tab still runs the old code, which writes call_proposals: the mirror copies each
-- such write here, and the guard refuses an old-code decision once the new code has decided or undone
-- the same suggestion (it locks this table's row with for update, so a racing new-code decision waits
-- or wins; it never decides twice).
--
-- ONE TRANSACTION (spec 4.1): the share-row-exclusive lock on call_proposals, taken before anything is
-- created, keeps any old-code write from landing between the copy and the triggers. The lock and the
-- settings are taken inside the first do block; the second and the last do blocks raise
-- 0088_not_one_transaction unless the whole file runs in the one transaction that took the lock: a
-- path that commits between statements fails before any DDL.
--
-- APPLY ORDER: CI project (ci-project-setup.yml: push-dry-run, then push), then production (MCP
-- apply_migration, once), then the parity check, then merge. The migration goes BEFORE the code: the
-- build before it keeps working (its writes are mirrored), the build after it reads only proposals.
--
-- Rollback (by hand, in this order, for a rollback of the code to the 8a build while call_proposals
-- still exists):
--   1. drop trigger call_proposals_mirror on public.call_proposals;
--      drop trigger call_proposals_guard on public.call_proposals;
--   2. insert into public.call_proposals (id, account_id, call_id, contact_id, kind, payload, evidence,
--        status, decided_at, decided_by, created_at)
--      select p.id, p.account_id, p.call_id, p.contact_id, p.kind, p.payload, p.evidence,
--        case p.status when 'pending' then 'pending' when 'dismissed' then 'dismissed'
--          when 'expired' then 'dismissed' else 'accepted' end,
--        case when p.status = 'pending' then null else p.decided_at end,
--        case when p.status = 'pending' then null else p.decided_by end, p.created_at
--      from public.proposals p where p.source = 'call'
--        and not exists (select 1 from public.call_proposals c where c.id = p.id);
--   3. update public.call_proposals c set
--        status = case p.status when 'pending' then 'pending' when 'dismissed' then 'dismissed'
--          when 'expired' then 'dismissed' else 'accepted' end,
--        decided_at = case when p.status = 'pending' then null else p.decided_at end,
--        decided_by = case when p.status = 'pending' then null else p.decided_by end
--      from public.proposals p where p.id = c.id;
--      (payload stays the proposed one: an edited Accept's applied form is lost to the old code.)
--   4. optionally: drop table public.proposals; drop function app.copy_call_proposals();
--      drop function app.mirror_call_proposal(); drop function app.guard_call_proposal();
--      drop function app.proposals_proposed_is_fixed();
--
-- ASCII only, no backslash anywhere.

-- 0. One transaction, holding the lock, or nothing at all. The settings and the lock are taken INSIDE a
--    do block (plan fix I-1): on PostgreSQL 17 (bis-ci, CI's stacks, production) a bare SET LOCAL or
--    LOCK TABLE as a later statement of a multi-statement string is not guaranteed to be inside a
--    transaction block, and the CLI push already warns "SET LOCAL can only be used in transaction blocks".
--    Inside a do block both always run in the block's transaction. The second do block then proves the
--    NEXT statement is still that transaction and still holds the lock; a path that commits between
--    statements (autocommit) has lost the transaction-local settings and fails here, before any DDL.
do $$
begin
  perform pg_catalog.set_config('lock_timeout', '5s', true);
  perform pg_catalog.set_config('bis.m0088_xid', pg_catalog.txid_current()::text, true);
  lock table public.call_proposals in share row exclusive mode;
end $$;
do $$
begin
  if pg_catalog.current_setting('bis.m0088_xid', true) is distinct from pg_catalog.txid_current()::text
     or pg_catalog.current_setting('lock_timeout') <> '5s'
     or not exists (select 1 from pg_catalog.pg_locks l
                     where l.locktype = 'relation' and l.relation = 'public.call_proposals'::regclass
                       and l.pid = pg_catalog.pg_backend_pid() and l.mode = 'ShareRowExclusiveLock' and l.granted) then
    raise exception '0088_not_one_transaction' using errcode = 'P0001';
  end if;
end $$;

-- 1. The table.
create table public.proposals (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  source text not null constraint proposals_source_check check (source in ('call')),
  call_id uuid,
  contact_id uuid,
  kind text not null constraint proposals_kind_check check (kind in ('task', 'contact_field', 'opportunity_stage')),
  payload jsonb not null,
  applied_payload jsonb,
  applied_ref jsonb,
  evidence text not null constraint proposals_evidence_nonempty check (length(btrim(evidence)) > 0),
  evidence_ref jsonb not null default '{}'::jsonb,
  evidence_lang text constraint proposals_evidence_lang_check check (evidence_lang in ('en', 'es')),
  status text not null default 'pending' constraint proposals_status_check
    check (status in ('pending', 'accepted', 'edited', 'dismissed', 'expired')),
  expired_reason text constraint proposals_expired_reason_check
    check (expired_reason in ('field_filled', 'name_mismatch', 'deal_moved', 'deal_closed', 'deal_gone', 'superseded', 'aged')),
  decided_at timestamptz,
  -- A Clerk user id, or 'system' when the app decided (out of date). Not an FK (0040's reason).
  decided_by text,
  undone_at timestamptz,
  undone_by text,
  -- No default: every writer sets it (insertProposal, the mirror, the copy).
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  -- One clause per source; a later source adds its column and its clause.
  constraint proposals_source_key check ((source = 'call') = (call_id is not null)),
  constraint proposals_applied_when_accepted check ((applied_payload is not null) = (status in ('accepted', 'edited'))),
  constraint proposals_edited_changes check (status <> 'edited' or applied_payload <> payload),
  constraint proposals_expired_has_reason check ((status = 'expired') = (expired_reason is not null)),
  constraint proposals_decision_complete check (
    (status = 'pending' and decided_at is null and decided_by is null)
    or (status <> 'pending' and decided_at is not null and decided_by is not null and btrim(decided_by) <> '')),
  constraint proposals_undone_pair check ((undone_at is null) = (undone_by is null)),
  constraint proposals_call_fkey foreign key (account_id, call_id)
    references public.calls (account_id, id) on delete cascade,
  constraint proposals_contact_fkey foreign key (account_id, contact_id)
    references public.contacts (account_id, id) on delete cascade
);
comment on table public.proposals is
  'AI suggestions, every source and kind (0088). Never work itself: nothing reaches the CRM without a '
  'person''s Accept. Server-written only; authenticated reads a row when it reads the account and, for '
  'a Technician, the row''s customer.';

-- 2. What was proposed never changes; only the decision columns move.
create function app.proposals_proposed_is_fixed() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.id is distinct from old.id or new.account_id is distinct from old.account_id
     or new.source is distinct from old.source or new.call_id is distinct from old.call_id
     or new.contact_id is distinct from old.contact_id or new.kind is distinct from old.kind
     or new.payload is distinct from old.payload or new.evidence is distinct from old.evidence
     or new.evidence_ref is distinct from old.evidence_ref or new.evidence_lang is distinct from old.evidence_lang
     or new.created_at is distinct from old.created_at or new.expires_at is distinct from old.expires_at then
    raise exception 'proposals_proposed_is_fixed' using errcode = 'P0001';
  end if;
  return new;
end $$;
revoke all on function app.proposals_proposed_is_fixed() from public, anon, authenticated, service_role;
create trigger proposals_proposed_is_fixed before update on public.proposals
  for each row execute function app.proposals_proposed_is_fixed();

-- 3. Indexes. COALESCE is load-bearing (0040's reason): NULLs are distinct in a unique index.
create unique index proposals_one_pending_per_call on public.proposals
  (call_id, kind, coalesce(contact_id, '00000000-0000-0000-0000-000000000000'::uuid))
  where status = 'pending' and source = 'call';
create index proposals_account_pending_idx on public.proposals (account_id, created_at desc) where status = 'pending';
-- Full, not partial (plan deviation 8): the record's read and the contact FK's cascade.
create index proposals_account_contact_idx on public.proposals (account_id, contact_id);
create index proposals_call_idx on public.proposals (call_id, created_at desc);
create index proposals_contact_decided_idx on public.proposals (account_id, contact_id, decided_at desc)
  where status in ('accepted', 'edited');

-- 4. Who reads: the account's members (or the agency); a Technician only for a customer they can read,
--    and never a row with no customer. Who writes: service_role only.
alter table public.proposals enable row level security;
revoke all on public.proposals from anon, authenticated;
grant select on public.proposals to authenticated;
grant select, insert, update, delete on public.proposals to service_role;
create policy proposals_member_read on public.proposals for select to authenticated
  using (app.is_agency() or account_id = app.current_account_id());
create policy proposals_technician_scope on public.proposals as restrictive for select to authenticated
  using ((select app.sees_all_customers(app.current_account_id()))
         or exists (select 1 from public.contacts c where c.id = proposals.contact_id));

-- 5. The copy (spec 4.6). Called once below, as the owner; no client role may run it.
create function app.copy_call_proposals() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_bad bigint; v_copied bigint; v_total bigint; v_missing bigint; v_differs bigint; v_by jsonb;
begin
  select count(*) into v_bad
    from public.call_proposals cp
    join public.calls k on k.id = cp.call_id
    left join public.contacts c on c.id = cp.contact_id
   where k.account_id <> cp.account_id
      or (cp.contact_id is not null and c.account_id is distinct from cp.account_id);
  if v_bad > 0 then
    raise exception 'proposals_copy_cross_account: % rows', v_bad using errcode = 'P0001';
  end if;
  insert into public.proposals (id, account_id, source, call_id, contact_id, kind, payload, applied_payload,
      applied_ref, evidence, evidence_ref, evidence_lang, status, expired_reason, decided_at, decided_by,
      expires_at, created_at)
    select cp.id, cp.account_id, 'call', cp.call_id, cp.contact_id, cp.kind, cp.payload,
           case when cp.status = 'accepted' then cp.payload end, null,
           cp.evidence, '{}'::jsonb, k.language, cp.status, null, cp.decided_at, cp.decided_by,
           greatest(cp.created_at, now()) + interval '30 days', cp.created_at
      from public.call_proposals cp join public.calls k on k.id = cp.call_id
    on conflict (id) do nothing;
  get diagnostics v_copied = row_count;
  select count(*) into v_total from public.call_proposals;
  select count(*) into v_missing from public.call_proposals cp
   where not exists (select 1 from public.proposals p where p.id = cp.id);
  select count(*) into v_differs from public.call_proposals cp join public.proposals p on p.id = cp.id
   where p.status is distinct from cp.status;
  if v_missing > 0 or v_differs > 0 then
    raise exception 'proposals_copy_mismatch: % missing, % with another status', v_missing, v_differs
      using errcode = 'P0001';
  end if;
  select coalesce(jsonb_object_agg(s.status, s.n), '{}'::jsonb) into v_by
    from (select cp.status, count(*) as n from public.call_proposals cp group by cp.status) s;
  return jsonb_build_object('copied', v_copied, 'skipped', v_total - v_copied, 'by_status', v_by);
end $$;
revoke all on function app.copy_call_proposals() from public, anon, authenticated, service_role;

-- 6. The mirror: an old-code write to call_proposals lands here too. A failure raises and so blocks
--    the old write (the old code then answers its own failure copy; nothing is half-written).
create function app.mirror_call_proposal() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_n integer;
begin
  if tg_op = 'INSERT' then
    insert into public.proposals (id, account_id, source, call_id, contact_id, kind, payload, applied_payload,
        evidence, evidence_ref, evidence_lang, status, decided_at, decided_by, expires_at, created_at)
      select new.id, new.account_id, 'call', new.call_id, new.contact_id, new.kind, new.payload,
             case when new.status = 'accepted' then new.payload end,
             new.evidence, '{}'::jsonb, k.language, new.status, new.decided_at, new.decided_by,
             new.created_at + interval '30 days', new.created_at
        from public.calls k where k.id = new.call_id
      on conflict (id) do nothing;
    return null;
  end if;
  update public.proposals p
     set status = new.status, decided_at = new.decided_at, decided_by = new.decided_by,
         applied_payload = case when new.status = 'accepted' then p.payload else null end
   where p.id = new.id and p.status is not distinct from old.status;
  get diagnostics v_n = row_count;
  if v_n = 0 then
    raise exception 'call_proposals_mirror_missed: %', new.id using errcode = 'P0001';
  end if;
  return null;
end $$;
revoke all on function app.mirror_call_proposal() from public, anon, authenticated, service_role;

-- 7. The guard: an old-code decision is refused once proposals has moved past it. The for update
--    holds the proposals row until the old code's transaction ends, so a racing new-code
--    compare-and-swap waits and then loses, and one that committed first is seen here.
create function app.guard_call_proposal() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_status text; v_found boolean;
begin
  select p.status into v_status from public.proposals p where p.id = old.id for update;
  v_found := found;
  if not v_found or v_status is distinct from old.status then
    raise exception 'call_proposals_superseded: %', old.id using errcode = 'P0001';
  end if;
  return new;
end $$;
revoke all on function app.guard_call_proposal() from public, anon, authenticated, service_role;

create trigger call_proposals_guard before update on public.call_proposals
  for each row execute function app.guard_call_proposal();
create trigger call_proposals_mirror after insert or update on public.call_proposals
  for each row execute function app.mirror_call_proposal();

-- 8. Copy today's rows, inside the lock.
select app.copy_call_proposals();

-- 9. Still the one transaction, still holding the lock.
do $$
begin
  if pg_catalog.current_setting('bis.m0088_xid', true) is distinct from pg_catalog.txid_current()::text
     or not exists (select 1 from pg_catalog.pg_locks l
                     where l.locktype = 'relation' and l.relation = 'public.call_proposals'::regclass
                       and l.pid = pg_catalog.pg_backend_pid() and l.mode = 'ShareRowExclusiveLock' and l.granted) then
    raise exception '0088_not_one_transaction' using errcode = 'P0001';
  end if;
end $$;
```

(Notes for the implementer. In the guard, `found` after `select … into` is set by plpgsql. `%` in `raise` is not a `$`. The comment's doubled `''` is SQL quoting, not a backslash. If any line here fails on the replica, fix it and say exactly what changed and why in the report. The reviewer compares the committed file with this text, and every difference must have a reason.)

- [ ] **Step 6: Teardown and retargets.**
  - `packages/db/src/account-teardown.ts:24`: change `"calls", "bookings", "calendars", "events",` to

    ```ts
      // Item 8b-1 (0088): AI suggestions, before calls (call_id and contact_id cascade too; spec 4.1 lists it).
      "proposals",
      "calls", "bookings", "calendars", "events",
    ```

  - Rewrite the `call_proposals` paragraph (`:62-71`): `call_proposals` (0040) stays off the list until 0089 drops it (its rows ride `calls`' cascade), and `proposals` (0088) is ON it, before `calls`.
  - Apply the additions in "Pinned tests" for `technician-scope.test.ts` and `server-only-writes-grants.test.ts`. Every existing `call_proposals` line stays (plan fix M2).
  - `call-proposals-grants.test.ts` is NOT touched. In the report, list each of its 18 `it`s by title, with the `proposals-schema.test.ts` case that re-states it for `proposals`, or why it has no twin: the column-level UPDATE grant cases (`:320-435`) have none, because no client role holds any UPDATE on `proposals`, and case 3 pins that.

- [ ] **Step 7: Rebuild and run green.**
  - `bash "$S/s15c-kit/replica.sh" 55670 "$S/s15c-t1-impl"` → `post = pre + 0088`.
  - Run Step 4's command (with `green.*` files) → exit 0. Read the count: 47 tests and 1 todo. That is 32 in `proposals-schema.test.ts` (cases 1–9 one each = 9, case 10 = 13, case 11 = 1, case 12 = 6, case 13 = 3, plus case 14 as the `todo`) and 15 in `proposals-bridge.test.ts` (cases 1–14 plus 11b); correct the arithmetic in the report if your count differs, and say why.
  - Also on `post`: `node node_modules/vitest/vitest.mjs run src/test/schema-grants-guard.test.ts src/test/technician-scope.test.ts src/test/server-only-writes-grants.test.ts src/test/ai-gateway-schema.test.ts src/test/record-summaries-schema.test.ts` → all pass. `call-proposals-grants.test.ts` is a `withTestAccount` suite: run it behind a PostgREST on your replica (`pgrst.sh 55670 55678 55679 …`; those ports are free until Task 11) → it passes UNCHANGED, with 0088's mirror firing under it.
  - The Faithfulness query on `post` equals `pre`'s.
- [ ] **Step 8: Byte check.**

  ```
  node -e 'const b=require("fs").readFileSync(process.argv[1]);const bad=[...b].filter((x)=>x>127||x===92).length;const s=b.toString();console.log(JSON.stringify({nonAsciiOrBackslash:bad,dollars:(s.match(/\$/g)||[]).length,doubleDollar:(s.match(/\$\$/g)||[]).length}))' packages/db/supabase/migrations/0088_proposals.sql
  ```

  → `{"nonAsciiOrBackslash":0,"dollars":28,"doubleDollar":14}`. Positive control: copy the file to `$S/s15c-t1-impl/ctl.sql`, append byte `0x5c`, rerun → `nonAsciiOrBackslash: 1`. Then `md5sum packages/db/supabase/migrations/0088_proposals.sql` → paste it (Tasks 2, 11 and 12 compare it).
- [ ] **Step 9: Mutation probes.** Each runs on a copy applied to a fresh `post`: edit the migration, rebuild the replica, run the one case by `-t`, read that its count is 1 and that it FAILS, edit back, and `cmp`. Run every mutation named in Step 3, each by its case. **Paste each failing assertion line.** The ones the spec names (§8.3 :362–:370) are mandatory, and the report lists them by spec line: :362 (case 3), :363 (who reads), :364 (case 14, after Task 4 turns it on: deferred to Task 4's probes), :365 and :366 (bridge 1, 3), :367 (bridge 9), :368 (bridge 13, **failing on the name**), :369 (bridge 11 by name, and 11b with the mirror off; the `not v_found` arm is redundant and has no probe), :370 (bridge 6).
- [ ] **Step 10: Commit.** `git add -- packages/db/supabase/migrations/0088_proposals.sql packages/db/src/test/proposals-schema.test.ts packages/db/src/test/proposals-bridge.test.ts`, then `git commit -m "db: 0088 proposals, one table for every AI suggestion, with today's call_proposals copied in and a mirror and guard for the deploy gap (item 8b-1)" -- <those three> packages/db/src/account-teardown.ts packages/db/src/test/technician-scope.test.ts packages/db/src/test/server-only-writes-grants.test.ts`. **Never apply 0088 anywhere but your replica.** Stop your replica.
- [ ] **Step 11: Push early (orchestrator).** As soon as Task 1's commit lands (before its review finishes), the orchestrator pushes `feat/item8b-review-tray`, so CI `verify` applies 0088 on PostgreSQL 17 through `supabase db push` (`ci-local-supabase.sh:305`) long before Task 11. `e2e` will be red on its migration check (0088 is not on bis-ci); that is expected and named in the reading. `verify`'s db and web suites run on the runner's own stack, never on bis-ci. Task 2 Step 4 reads the result.

---

## Task 2: The one-transaction check (bis-db-schema; the orchestrator reads it)

**Review:** opus (the reviewer re-runs Step 3's positive control and reads the evidence). **After:** Task 1's review approves 0088. **Scratch:** `<SCRATCH>/s15c-t2/`, Postgres `55671` (Task 1's reviewer is done with it). **Never** connects to bis-ci or production.

This is the spec's §4.1 check, made a task by the brief. It proves, for each path that can be reached here, that 0088's lock on `call_proposals` is held by the migration's own transaction until it commits. For the paths that cannot be reached, it proves 0088 refuses to run (deviation 1).

- [ ] **Step 1: psql `-1` (the replica kit's path).**
  1. Build `pre` only: run the kit with 0088 moved aside by a scratch copy of `replica.sh` that skips `*0088_*` and has no post block. `diff` it against the kit and paste the diff.
  2. Make a scratch copy of 0088 at `$S/s15c-t2/0088_sleep.sql` with `select pg_catalog.pg_sleep(8);` inserted directly after step 8's `select app.copy_call_proposals();`.
  3. Session 1: `psql … -d pre -1 -f "$S/s15c-t2/0088_sleep.sql" &`.
  4. Session 2, after 3 s: `select l.pid, l.mode, l.granted, a.backend_xid is not null as has_xid, a.state from pg_locks l join pg_stat_activity a on a.pid = l.pid where l.relation = 'public.call_proposals'::regclass and l.mode = 'ShareRowExclusiveLock'` → one row, `granted t`, in the migrating backend.
  5. Also from session 2, `insert into call_proposals …` with `set lock_timeout = '1s'` → `55P03` lock timeout (the lock blocks a write).
  6. After session 1 ends: the same `pg_locks` read → no row.

  Paste all three reads.
- [ ] **Step 2: the Supabase CLI path (`ci-project-setup.yml` → `db:push:ci` → `supabase db push`).** Assumption A2.
  1. Find the binary: `ls packages/db/node_modules/.bin/supabase*` or `pnpm --filter @bis/db exec supabase --version`.
  2. In a scratch workdir (`$S/s15c-t2/cli/supabase/migrations/`), place copies of `0001…0087` named as the repo names them, then `0088_sleep.sql` renamed `0088_proposals.sql`.
  3. Against a fresh EMPTY replica database (`createdb cli`, plus the bootstrap and storage stub `replica.sh:15-29` apply), run `supabase db push --db-url "postgresql://postgres@127.0.0.1:55671/cli?sslmode=disable" --workdir "$S/s15c-t2/cli" --yes`.
  4. Mid-run, read Step 1's `pg_locks` query from a second session. (The CLI connects to the replica; per the plan review it negotiates a self-signed SSL connection. If it does not, that is a finding to report, not a branch to work around.)

  This run is on PG18 and is supporting evidence only (Assumption A2). The decisive evidence is Step 4's read of CI `verify` on PostgreSQL 17.
- [ ] **Step 3: the self-check's positive controls.** On a fresh `pre`, each of (a) and (b) must fail with `0088_not_one_transaction` raised by the SECOND `do` block (in autocommit, the first block commits on its own and releases the lock and the transaction-local settings), and `select to_regclass('public.proposals')` must stay null after each:
  - **(a)** `psql … -d pre -f 0088_proposals.sql` WITHOUT `-1` and with `ON_ERROR_STOP=1`: autocommit, statement by statement.
  - **(b)** A scratch copy with `commit; begin;` inserted between the first and the second `do` block, run with `psql -f`. The lock is released and a new transaction begins, so the second `do` block's xid check fails.
  - **(c)** The whole file sent as ONE simple-query string (`psql … -d pre -c "$(cat 0088_proposals.sql)"`): this must SUCCEED (one implicit transaction), and a second-session `pg_locks` read mid-run (with the `pg_sleep` copy) shows the lock held. This is the shape the Supabase dashboard's SQL editor sends (Question 1, decided).

  Paste each error. These are the evidence that the MCP path (A3) cannot half-apply.
- [ ] **Step 4: Read CI `verify` on PostgreSQL 17 (the orchestrator).** Task 1 Step 11 pushed the branch at Task 1's commit. Read that commit's `verify` run (`gh api repos/{owner}/{repo}/commits/<sha>/check-runs`, then the job log): the local stack's `supabase db push` applied `0088_proposals.sql` with no `0088_not_one_transaction` and no `SET LOCAL can only be used in transaction blocks` warning for 0088, and the stack's `select version()` line (or the `server_version_num` check at `ci-local-supabase.sh:296`) names 17. Paste the lines. If `verify` raised `0088_not_one_transaction`, STOP: 0088 changes only through Task 1's owner with a re-review.
- [ ] **Step 5: Report** the paths' results and the md5 of the unchanged 0088 (it equals Task 1's). Make no repo change. If any path shows the lock not held through to commit, STOP: the orchestrator decides with the owner (Question 1), and 0088 changes only through Task 1's owner with a re-review.

---

## Task 3: Every key (bis-crm; messages.ts, the only writer)

**Review:** sonnet. **Runs beside:** Task 1.

**Files:** Modify `apps/web/src/lib/messages.ts` (insert the block below directly before the closing `} as const;`, after `"aiSettings.summariesToday.es"` at `:5049`), and append one `describe` at the end of `apps/web/src/lib/messages.test.ts` (930 lines).

**Interfaces:** Produces every `suggestions.*` key below; Tasks 5–8 read them through `tr.text(key, params)` / `tr.count(…)`. No other task adds a key.

- [ ] **Step 1: Write the failing test** (appended to `messages.test.ts`):

```ts
describe("suggestions.* keys (item 8b-1)", () => {
  const KEYS = [
    "suggestions.heading", "suggestions.subhead", "suggestions.empty", "suggestions.cap", "suggestions.loadFailed",
    "suggestions.loading", "suggestions.source.call", "suggestions.source.callNoName", "suggestions.evidence",
    "suggestions.status.pending", "suggestions.status.accepted", "suggestions.status.edited",
    "suggestions.status.dismissed", "suggestions.status.expired",
    "suggestions.decided.accepted", "suggestions.decided.edited", "suggestions.decided.dismissed", "suggestions.decided.expired",
    "suggestions.accept", "suggestions.editAccept", "suggestions.discard", "suggestions.saveAccept", "suggestions.cancel",
    "suggestions.task", "suggestions.due", "suggestions.wasDue", "suggestions.field",
    "suggestions.field.firstName", "suggestions.field.lastName", "suggestions.field.email", "suggestions.field.phone",
    "suggestions.stage", "suggestions.stage.skipped", "suggestions.stage.skippedOne", "suggestions.stage.unresolved",
    "suggestions.toast.task", "suggestions.toast.field", "suggestions.toast.stage", "suggestions.toast.dismissed",
    "suggestions.undone", "suggestions.undoneDuplicate",
    "suggestions.answer.unavailable", "suggestions.answer.answeredBy", "suggestions.answer.answeredBySomeone",
    "suggestions.answer.pastDue", "suggestions.answer.maybeFailed", "suggestions.answer.failed",
    "suggestions.answer.tooLate", "suggestions.answer.changed", "suggestions.answer.undoStranded",
    "suggestions.out.field_filled", "suggestions.out.name_mismatch", "suggestions.out.deal_moved",
    "suggestions.out.deal_closed", "suggestions.out.deal_gone", "suggestions.out.aged", "suggestions.out.superseded",
    "suggestions.reason.field_filled", "suggestions.reason.name_mismatch", "suggestions.reason.deal_moved",
    "suggestions.reason.deal_closed", "suggestions.reason.deal_gone", "suggestions.reason.aged", "suggestions.reason.superseded",
    "suggestions.edit.title", "suggestions.edit.due", "suggestions.edit.stage",
    "suggestions.edit.titleRequired", "suggestions.edit.titleTooLong", "suggestions.edit.dueInvalid",
    "suggestions.edit.valueRequired", "suggestions.edit.phoneInvalid", "suggestions.edit.emailInvalid",
    "suggestions.edit.stageInvalid",
  ] as const;
  it("every key has a Spanish twin that differs from the English (mutation: drop one .es line -> FAILS)", () => {
    const cat = m as Record<string, string>;
    const missing = KEYS.filter((k) => !cat[k] || !cat[`${k}.es`] || cat[k] === cat[`${k}.es`]);
    expect(missing).toEqual([]);
  });
  it("pins the spec's own sentences, both languages (mutation: change one word -> FAILS)", () => {
    expect([m["suggestions.heading"], m["suggestions.heading.es"]]).toEqual(["Suggestions", "Sugerencias"]);
    expect([m["suggestions.subhead"], m["suggestions.subhead.es"]]).toEqual([
      "From {persona}. Nothing changes until you accept.", "De {persona}. Nada cambia hasta que usted acepte."]);
    expect([m["suggestions.answer.answeredBy"], m["suggestions.answer.answeredBy.es"]]).toEqual([
      "{name} already answered this one.", "{name} ya respondió esta."]);
    expect([m["suggestions.answer.pastDue"], m["suggestions.answer.pastDue.es"]]).toEqual([
      "Its due date has passed. Use Edit and accept to pick a new one.",
      "Su fecha ya pasó. Use Editar y aceptar para elegir otra."]);
    expect([m["suggestions.out.aged"], m["suggestions.out.aged.es"]]).toEqual([
      "Out of date: this suggestion is more than 30 days old.", "Ya no aplica: esta sugerencia tiene más de 30 días."]);
    expect([m["suggestions.answer.undoStranded"], m["suggestions.answer.undoStranded.es"]]).toEqual([
      "The change was undone, but this suggestion didn't update. Refresh before doing anything else.",
      "El cambio se deshizo, pero esta sugerencia no se actualizó. Actualice la página antes de hacer otra cosa."]);
  });
  it("no plumbing words reach the reader (mutation: write 'proposal' into one key -> FAILS)", () => {
    const cat = m as Record<string, string>;
    const bad = KEYS.flatMap((k) => [cat[k], cat[`${k}.es`]]).filter((s) => /proposal|payload|model|registry|token/i.test(s ?? ""));
    expect(bad).toEqual([]);
  });
});
```

- [ ] **Step 2:** `pnpm --filter web exec vitest run src/lib/messages.test.ts -t "suggestions"` → FAIL (keys missing). Paste the line.
- [ ] **Step 3: Add the keys** (English, then `.es` on the next line). The words are §4.7 and §7 of the spec verbatim, except where a deviation says otherwise:

```ts
  // Item 8b-1: the suggestion card, the tray and every answer a decision gives (spec 4.5, 4.7, 7).
  "suggestions.heading": "Suggestions",
  "suggestions.heading.es": "Sugerencias",
  "suggestions.subhead": "From {persona}. Nothing changes until you accept.",
  "suggestions.subhead.es": "De {persona}. Nada cambia hasta que usted acepte.",
  "suggestions.empty": "Suggestions appear here after a call. Nothing changes until you accept.",
  "suggestions.empty.es": "Las sugerencias aparecen aquí después de una llamada. Nada cambia hasta que usted acepte.",
  "suggestions.cap": "Showing the newest {n}.",
  "suggestions.cap.es": "Se muestran las {n} más recientes.",
  "suggestions.loadFailed": "Couldn't load suggestions.",
  "suggestions.loadFailed.es": "No se pudieron cargar las sugerencias.",
  "suggestions.loading": "Loading suggestions…",
  "suggestions.loading.es": "Cargando sugerencias…",
  "suggestions.source.call": "From the call on {date} · {caller}",
  "suggestions.source.call.es": "De la llamada del {date} · {caller}",
  "suggestions.source.callNoName": "From the call on {date}",
  "suggestions.source.callNoName.es": "De la llamada del {date}",
  "suggestions.evidence": "Because the caller said",
  "suggestions.evidence.es": "Porque quien llamó dijo",
  "suggestions.status.pending": "Suggested",
  "suggestions.status.pending.es": "Pendiente",
  "suggestions.status.accepted": "Accepted",
  "suggestions.status.accepted.es": "Aceptada",
  "suggestions.status.edited": "Edited",
  "suggestions.status.edited.es": "Editada",
  "suggestions.status.dismissed": "Discarded",
  "suggestions.status.dismissed.es": "Descartada",
  "suggestions.status.expired": "Out of date",
  "suggestions.status.expired.es": "Vencida",
  "suggestions.decided.accepted": "Accepted by {name} · {time}",
  "suggestions.decided.accepted.es": "Aceptada por {name} · {time}",
  "suggestions.decided.edited": "Edited by {name} · {time}",
  "suggestions.decided.edited.es": "Editada por {name} · {time}",
  "suggestions.decided.dismissed": "Discarded by {name} · {time}",
  "suggestions.decided.dismissed.es": "Descartada por {name} · {time}",
  "suggestions.decided.expired": "Marked out of date · {time}",
  "suggestions.decided.expired.es": "Marcada como vencida · {time}",
  "suggestions.accept": "Accept",
  "suggestions.accept.es": "Aceptar",
  "suggestions.editAccept": "Edit and accept",
  "suggestions.editAccept.es": "Editar y aceptar",
  "suggestions.discard": "Discard",
  "suggestions.discard.es": "Descartar",
  "suggestions.saveAccept": "Save and accept",
  "suggestions.saveAccept.es": "Guardar y aceptar",
  "suggestions.cancel": "Cancel",
  "suggestions.cancel.es": "Cancelar",
  "suggestions.task": "Add a to-do: {title}",
  "suggestions.task.es": "Agregar un pendiente: {title}",
  "suggestions.due": "Due {date}",
  "suggestions.due.es": "Vence el {date}",
  "suggestions.wasDue": "Was due {date}",
  "suggestions.wasDue.es": "Vencía el {date}",
  "suggestions.field": "{field}: (empty) → {value}",
  "suggestions.field.es": "{field}: (vacío) → {value}",
  "suggestions.field.firstName": "First name",
  "suggestions.field.firstName.es": "Nombre",
  "suggestions.field.lastName": "Last name",
  "suggestions.field.lastName.es": "Apellido",
  "suggestions.field.email": "Email",
  "suggestions.field.email.es": "Correo",
  "suggestions.field.phone": "Phone",
  "suggestions.field.phone.es": "Teléfono",
  "suggestions.stage": "Move from {from} to {to}",
  "suggestions.stage.es": "Mover de {from} a {to}",
  "suggestions.stage.skipped": "{count} stages are skipped in between.",
  "suggestions.stage.skipped.es": "Se saltan {count} etapas.",
  "suggestions.stage.skippedOne": "A stage is skipped in between.",
  "suggestions.stage.skippedOne.es": "Se salta una etapa.",
  "suggestions.stage.unresolved": "Review the stage change on this deal.",
  "suggestions.stage.unresolved.es": "Revise el cambio de etapa de esta oportunidad.",
  "suggestions.toast.task": "Added to your to-do list",
  "suggestions.toast.task.es": "Agregado a sus pendientes",
  "suggestions.toast.field": "{field} saved",
  "suggestions.toast.field.es": "{field} guardado",
  "suggestions.toast.stage": "Moved to {stage}",
  "suggestions.toast.stage.es": "Movido a {stage}",
  "suggestions.toast.dismissed": "Discarded",
  "suggestions.toast.dismissed.es": "Descartada",
  "suggestions.undone": "Undone.",
  "suggestions.undone.es": "Se deshizo.",
  "suggestions.undoneDuplicate": "Undone. The possible duplicate it found is still in Duplicates.",
  "suggestions.undoneDuplicate.es": "Se deshizo. El posible duplicado que encontró sigue en Duplicados.",
  "suggestions.answer.unavailable": "This suggestion isn't available.",
  "suggestions.answer.unavailable.es": "Esta sugerencia no está disponible.",
  "suggestions.answer.answeredBy": "{name} already answered this one.",
  "suggestions.answer.answeredBy.es": "{name} ya respondió esta.",
  "suggestions.answer.answeredBySomeone": "Someone on the team already answered this one.",
  "suggestions.answer.answeredBySomeone.es": "Alguien del equipo ya respondió esta.",
  "suggestions.answer.pastDue": "Its due date has passed. Use Edit and accept to pick a new one.",
  "suggestions.answer.pastDue.es": "Su fecha ya pasó. Use Editar y aceptar para elegir otra.",
  "suggestions.answer.maybeFailed": "That may not have gone through. Check before trying again.",
  "suggestions.answer.maybeFailed.es": "Puede que no se haya guardado. Revise antes de intentarlo otra vez.",
  "suggestions.answer.failed": "That didn't go through. Try again.",
  "suggestions.answer.failed.es": "No se guardó. Inténtelo otra vez.",
  "suggestions.answer.tooLate": "Too late to undo here. Change it by hand.",
  "suggestions.answer.tooLate.es": "Ya no se puede deshacer aquí. Cámbielo a mano.",
  "suggestions.answer.changed": "It has changed since. Change it by hand.",
  "suggestions.answer.changed.es": "Cambió desde entonces. Cámbielo a mano.",
  "suggestions.answer.undoStranded": "The change was undone, but this suggestion didn't update. Refresh before doing anything else.",
  "suggestions.answer.undoStranded.es": "El cambio se deshizo, pero esta sugerencia no se actualizó. Actualice la página antes de hacer otra cosa.",
  "suggestions.out.field_filled": "Out of date: the {field} was filled in since.",
  "suggestions.out.field_filled.es": "Ya no aplica: el {field} se llenó después.",
  "suggestions.out.name_mismatch": "Out of date: the name on file doesn't match this caller.",
  "suggestions.out.name_mismatch.es": "Ya no aplica: el nombre registrado no coincide con quien llamó.",
  "suggestions.out.deal_moved": "Out of date: this deal has moved since.",
  "suggestions.out.deal_moved.es": "Ya no aplica: esta oportunidad cambió de etapa.",
  "suggestions.out.deal_closed": "Out of date: this deal has been closed.",
  "suggestions.out.deal_closed.es": "Ya no aplica: esta oportunidad se cerró.",
  "suggestions.out.deal_gone": "Out of date: this deal was deleted.",
  "suggestions.out.deal_gone.es": "Ya no aplica: esta oportunidad se eliminó.",
  "suggestions.out.aged": "Out of date: this suggestion is more than 30 days old.",
  "suggestions.out.aged.es": "Ya no aplica: esta sugerencia tiene más de 30 días.",
  "suggestions.out.superseded": "Out of date: another suggestion covered this.",
  "suggestions.out.superseded.es": "Ya no aplica: otra sugerencia ya lo cubrió.",
  "suggestions.reason.field_filled": "The {field} was filled in since.",
  "suggestions.reason.field_filled.es": "El {field} se llenó después.",
  "suggestions.reason.name_mismatch": "The name on file doesn't match this caller.",
  "suggestions.reason.name_mismatch.es": "El nombre registrado no coincide con quien llamó.",
  "suggestions.reason.deal_moved": "This deal has moved since.",
  "suggestions.reason.deal_moved.es": "Esta oportunidad cambió de etapa.",
  "suggestions.reason.deal_closed": "This deal has been closed.",
  "suggestions.reason.deal_closed.es": "Esta oportunidad se cerró.",
  "suggestions.reason.deal_gone": "This deal was deleted.",
  "suggestions.reason.deal_gone.es": "Esta oportunidad se eliminó.",
  "suggestions.reason.aged": "More than 30 days old.",
  "suggestions.reason.aged.es": "Tiene más de 30 días.",
  "suggestions.reason.superseded": "Another suggestion covered this.",
  "suggestions.reason.superseded.es": "Otra sugerencia ya lo cubrió.",
  "suggestions.edit.title": "Title",
  "suggestions.edit.title.es": "Título",
  "suggestions.edit.due": "Due date",
  "suggestions.edit.due.es": "Fecha",
  "suggestions.edit.stage": "Stage",
  "suggestions.edit.stage.es": "Etapa",
  "suggestions.edit.titleRequired": "Write a title.",
  "suggestions.edit.titleRequired.es": "Escriba un título.",
  "suggestions.edit.titleTooLong": "Keep the title under 200 characters.",
  "suggestions.edit.titleTooLong.es": "Use menos de 200 caracteres en el título.",
  "suggestions.edit.dueInvalid": "Pick a date from today to a year from now.",
  "suggestions.edit.dueInvalid.es": "Elija una fecha entre hoy y dentro de un año.",
  "suggestions.edit.valueRequired": "Write a value.",
  "suggestions.edit.valueRequired.es": "Escriba un valor.",
  "suggestions.edit.phoneInvalid": "That doesn't look like a phone number.",
  "suggestions.edit.phoneInvalid.es": "Eso no parece un número de teléfono.",
  "suggestions.edit.emailInvalid": "That doesn't look like an email address.",
  "suggestions.edit.emailInvalid.es": "Eso no parece un correo electrónico.",
  "suggestions.edit.stageInvalid": "Pick a later stage that isn't the last one.",
  "suggestions.edit.stageInvalid.es": "Elija una etapa posterior que no sea la última.",
```

(`suggestions.stage.skipped` / `skippedOne` are a `PluralKey` pair for `tr.count`, as `t.ts:47-53` requires. The `{field}` inside `suggestions.out.field_filled` and `suggestions.reason.field_filled` takes the field's label lowercased in English ("phone") and lowercased in Spanish ("teléfono"); every Spanish field word is masculine with "el".)

- [ ] **Step 4:** `pnpm --filter web exec vitest run src/lib/messages.test.ts src/lib/i18n/ratchet.test.ts` → pass (read the counts). `pnpm --filter web typecheck`.
- [ ] **Step 5: Probes.** (a) Delete `"suggestions.cap.es"` → case 1 FAILS. (b) Change "Sugerencias" to "Sugerencia" → case 2 FAILS. (c) Write "proposal" into `suggestions.toast.task` → case 3 FAILS. Paste each line, then revert and `cmp`.
- [ ] **Step 6: Commit** `git commit -m "copy: every word of the suggestion card, the tray and the answers a decision gives, in English and Spanish (item 8b-1)" -- apps/web/src/lib/messages.ts apps/web/src/lib/messages.test.ts`.

---

## Task 4: `@bis/db` proposals; the generator; every literal the rename breaks (bis-crm)

**Review:** opus. **After:** Task 1's commit (0088 on the replica) and Task 3's commit. **Scratch:** `<SCRATCH>/s15c-t4-impl/`, set A (`55672`/`55673`/`55674`). **No `@bis/db` vitest against bis-ci.**

**Files**
- Create: `packages/db/src/proposal-rules.ts`, `packages/db/src/proposals.ts`, `packages/db/src/test/proposals.test.ts`
- Delete: `packages/db/src/call-proposals.ts`, `packages/db/src/test/call-proposals.test.ts`
- Modify:
  - `packages/db/package.json` (`exports`: add `"./proposal-rules": "./src/proposal-rules.ts",` after `:15`);
  - `packages/db/src/index.ts:165-169`;
  - `packages/db/src/contacts.ts:570-651` (`fillContactBlanksReport`);
  - `packages/db/src/activities.ts` (`deleteTaskForUndo`, after `addTask`);
  - `packages/db/src/test/proposals-schema.test.ts` (the parity `it.todo` becomes an `it`);
  - `apps/web/src/lib/proposals/grounding.ts` (+ `grounding.test.ts`, cases appended);
  - `apps/web/src/lib/proposals/generate.ts` (+ `generate.test.ts`, `generate.fallback.test.ts`);
  - `apps/web/src/lib/voice/finish-call.ts:930-941`, `:258` (+ `finish-call.test.ts:1116`);
  - comment words in `apps/web/src/lib/db.ts:13` and `apps/web/src/lib/automations/passes/quote-followup.ts:34`.
- **Modify (type and literal only; no behaviour; each file is rewritten or deleted by Task 8):**
  - `…/calls/[callId]/proposals.tsx` (`STATUS_TREATMENT` gains `edited` and `expired`, reading `suggestions.status.edited` / `.expired`, with chip and dot as `accepted` / `dismissed`; the `CallProposal` import → `Proposal`);
  - `…/calls/[callId]/actions.ts` (`:5-7` imports; `:211` and `:354` `markProposalDecided(…)` → `decideProposal(writer, accountId, proposalId, { to: "accepted", decidedBy: userId, appliedPayload: proposal.payload, now: new Date() })` and `{ to: "dismissed", … }`; `revertToPending` → `revertProposalDecision(writer, accountId, proposalId, userId)`);
  - `…/calls/[callId]/page.tsx:13-14` (the type name);
  - `…/tasks/page.tsx:8`, `…/tasks/work-list.tsx:11`;
  - `…/work/agency-work-list.tsx:30` and its `AgencyProposal` alias;
  - the five builder literals in "Pinned tests";
  - **web typecheck includes the e2e specs and the live tests (plan fix I-2):**
    - `apps/web/e2e/call-proposals.spec.ts:119`: the `insertProposal` call gains `evidenceRef: {}, evidenceLang: "en", expiresAt: proposalExpiresAt(new Date())`, with `proposalExpiresAt` imported from `@bis/db/proposal-rules` (Task 10 deletes the file);
    - `…/calls/[callId]/actions.test.ts` (live; Task 8 deletes it): `:59` imports `insertProposal as insertProposalRaw`, `decideProposal` and `getProposal` instead of `insertProposal, getProposal, markProposalDecided`. Two local shims are added directly under the imports, so its 30 `insertProposal(` calls (`:322`, `:372`, `:404`, `:425`, … `:767`) and its 2 `markProposalDecided(` calls (`:456`, `:1068`) keep their text:

      ```ts
      // Item 8b-1 (Task 4): type-only shims so this file, deleted in Task 8, still compiles.
      const insertProposal = (db: Db, a: string, input: Omit<Parameters<typeof insertProposalRaw>[2], "evidenceRef" | "evidenceLang" | "expiresAt">) =>
        insertProposalRaw(db, a, { evidenceRef: {}, evidenceLang: "en", expiresAt: proposalExpiresAt(new Date()), ...input } as Parameters<typeof insertProposalRaw>[2]);
      const markProposalDecided = async (db: Db, a: string, id: string, status: "accepted" | "dismissed", by: string) => {
        const row = await getProposal(db, a, id);
        return status === "accepted"
          ? decideProposal(db, a, id, { to: "accepted", decidedBy: by, appliedPayload: row?.payload ?? null, now: new Date() })
          : decideProposal(db, a, id, { to: "dismissed", decidedBy: by, now: new Date() });
      };
      ```

      (Place them after `type Db = …` at `:87`, which they use, and add `import { proposalExpiresAt } from "@bis/db/proposal-rules";` beside the `@bis/db` import.) The live file is not run until 0088 is on bis-ci; Task 8 deletes it.
  - `apps/web/src/lib/work/buckets.test.ts:95-115`.

  This list is exactly what `pnpm --filter web typecheck` reports after the rename (Step 9 proves it). Any other error is a STOP, not an edit.

**Interfaces**
- Consumes: 0088's table and names (Task 1); `suggestions.status.edited`, `suggestions.status.expired` (Task 3).
- Produces (later tasks import exactly these):

```ts
// @bis/db/proposal-rules (and re-exported by "@bis/db")
export const PROPOSAL_KINDS = ["task", "contact_field", "opportunity_stage"] as const;
export const PROPOSAL_SOURCES = ["call"] as const;
export const PROPOSAL_STATUSES = ["pending", "accepted", "edited", "dismissed", "expired"] as const;
export const EXPIRED_REASONS = ["field_filled", "name_mismatch", "deal_moved", "deal_closed", "deal_gone", "superseded", "aged"] as const;
export type ProposalKind = (typeof PROPOSAL_KINDS)[number];
export type ProposalSource = (typeof PROPOSAL_SOURCES)[number];
export type ProposalStatus = (typeof PROPOSAL_STATUSES)[number];
export type ExpiredReason = (typeof EXPIRED_REASONS)[number];
export const PROPOSAL_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
export const UNDO_WINDOW_MS = 2 * 60 * 1000;          // P8; the consent controls' value (staff-actions.ts:51)
export const SYSTEM_DECIDER = "system";
export type ContactFieldName = "firstName" | "lastName" | "email" | "phone";
export type TaskPayload = { title: string; dueAt: string | null };
export type ContactFieldPayload = { field: ContactFieldName; value: string };
export type OpportunityStagePayload = { opportunityId: string; fromStageId: string; toStageId: string };
export type ProposalPayload = TaskPayload | ContactFieldPayload | OpportunityStagePayload;
export type ProposalInput =
  | { kind: "task"; payload: TaskPayload }
  | { kind: "contact_field"; payload: ContactFieldPayload }
  | { kind: "opportunity_stage"; payload: OpportunityStagePayload };
export type EvidenceRef = { turn: number; at: string } | Record<string, never>;
type ProposalBase = {
  id: string; accountId: string; source: ProposalSource; callId: string | null; contactId: string | null;
  evidence: string; evidenceRef: EvidenceRef; evidenceLang: "en" | "es" | null;
  status: ProposalStatus; expiredReason: ExpiredReason | null;
  appliedPayload: unknown; appliedRef: unknown;           // parsed by the kind's registry module, never cast here
  decidedAt: string | null; decidedBy: string | null; undoneAt: string | null; undoneBy: string | null;
  expiresAt: string; createdAt: string;
};
export type Proposal =
  | (ProposalBase & { kind: "task"; payload: TaskPayload })
  | (ProposalBase & { kind: "contact_field"; payload: ContactFieldPayload })
  | (ProposalBase & { kind: "opportunity_stage"; payload: OpportunityStagePayload });
/** P10: a pending row past expires_at is out of date to every reader. Pure. */
export function effectiveStatus(row: { status: ProposalStatus; expiresAt: string }, now: Date):
  { status: ProposalStatus; reason: ExpiredReason | null };
export function proposalExpiresAt(now: Date): string;   // new Date(now.getTime() + PROPOSAL_MAX_AGE_MS).toISOString()
/** The read boundary for payloads (replaces the bare cast at call-proposals.ts:58-64): null when the shape is wrong. */
export function parseTaskPayload(v: unknown): TaskPayload | null;
export function parseContactFieldPayload(v: unknown): ContactFieldPayload | null;
export function parseOpportunityStagePayload(v: unknown): OpportunityStagePayload | null;

// "@bis/db" (proposals.ts)
export function insertProposal(db, accountId: string, input: {
  callId: string; contactId?: string | null; evidence: string; evidenceRef: EvidenceRef;
  evidenceLang: "en" | "es"; expiresAt: string;
} & ProposalInput): Promise<{ id: string } | null>;                          // NEVER throws (unchanged contract)
export function listProposalsForCall(db, accountId: string, callId: string): Promise<Proposal[]>;      // ≤ 500, newest first
export function listPendingProposals(db, accountId: string, now?: Date): Promise<Proposal[]>;          // pending, expires_at > now, ≤ 201
export function listPendingProposalsForAgency(db, now?: Date): Promise<(Proposal & { brandName: string; timezone: string })[]>;
export function getProposal(db, accountId: string, id: string): Promise<Proposal | null>;
export function listPendingSiblings(db, accountId: string, q: { kind: ProposalKind; contactId: string; exceptId: string }): Promise<Proposal[]>;
export function decideProposal(writer, accountId: string, id: string, d:
  | { to: "accepted" | "edited"; decidedBy: string; appliedPayload: unknown; now: Date }
  | { to: "dismissed"; decidedBy: string; now: Date }
  | { to: "expired"; reason: ExpiredReason; now: Date }): Promise<boolean>;  // CAS on status = 'pending'
export function revertProposalDecision(writer, accountId: string, id: string, decidedBy: string):
  Promise<"reverted" | "missed" | "collision">;                              // accepted|edited -> pending, clears applied_*
export function setAppliedRef(writer, accountId: string, id: string, ref: unknown): Promise<boolean>;
export function expireProposals(writer, accountId: string, ids: string[], reason: ExpiredReason, decidedAt: string):
  Promise<string[]>;                                                          // moved ids only
export function undoProposalDecision(writer, accountId: string, id: string, u: { decidedBy: string; from: ProposalStatus[]; now: Date }):
  Promise<"undone" | "missed" | "collision">;                                // -> pending, clears decided_* applied_* expired_reason, stamps undone_*
export function expireAfterUndoCollision(writer, accountId: string, id: string, decidedBy: string, now: Date): Promise<boolean>;
export function restoreSiblings(writer, accountId: string, ids: string[], decidedAt: string):
  Promise<{ restored: string[]; collided: string[] }>;                      // reviewer note 2
export function fillContactBlanksReport(db, accountId, contactId, input, actorId, actorType?):
  Promise<{ fields: string[]; flagged: boolean }>;
export function deleteTaskForUndo(db, accountId: string, taskId: string, actorId: string,
  expect: { title: string; dueAt: string | null }): Promise<boolean>;        // true = deleted (open, same title and due)
```

- [ ] **Step 1: Read before writing:**
  - `cat -n packages/db/src/call-proposals.ts` (whole) and `packages/db/src/test/call-proposals.test.ts` (whole);
  - `sed -n 30,50p packages/db/src/activities.ts`;
  - `sed -n 380,400p;565,652p packages/db/src/contacts.ts`;
  - `sed -n 1,30p packages/db/src/document-rules.ts` (the subpath's shape);
  - `apps/web/src/lib/proposals/grounding.ts` (whole) and `generate.ts:241-611`;
  - `sed -n 140,160p;220,275p;375,392p apps/web/src/lib/proposals/generate.test.ts`;
  - `sed -n 1100,1125p apps/web/src/lib/voice/finish-call.test.ts`.
- [ ] **Step 2: Bring up set A.** `bash $S/s15c-kit/replica.sh 55672 $S/s15c-t4-impl` → `post = pre + 0088`. `bash $S/s15c-kit/pgrst.sh 55672 55673 55674 $S/s15c-t4-impl`.
- [ ] **Step 3: Write the failing tests.**

  **`packages/db/src/test/proposals.test.ts`** (`withTestAccount`; carry every case of `call-proposals.test.ts` over, retargeted). Each case keeps its old title and mutation unless a new one is given. Additions:
  1. "insertProposal stores source, evidence_ref, evidence_lang and the given expires_at; a row read back has every field" (whole-object `toEqual` on `getProposal`'s result; `expiresAt` typed out). Mutation: drop `expires_at` from the insert → `insertProposal` returns null and logs an UNEXPECTED fault (`23502`), FAILS.
  2. "parse at the read boundary: a row whose payload does not fit its kind is skipped and logged by id, never returned". Seed through the service client: a `task` row with payload `{"field":"phone","value":"x"}`. `listProposalsForCall` returns the other rows only; `console.error` was called with a string containing the row's id and NOT the payload's text. Mutation: return the row unparsed → FAILS.
  3. "listPendingProposals leaves out a row past expires_at, and stops at 201": seed 202 pending rows over 202 calls, plus one with `expires_at` in the past → length 201 and the expired id absent. Mutations: drop `.gt("expires_at", now)` → the expired row appears, FAILS; `.limit(500)` → 202, FAILS.
  4. "decideProposal is a compare-and-swap": the first decide → true; a second by another user → false, and `decided_by` stays the first; decided `accepted` carries `applied_payload` (`edited` likewise, and refusing an `edited` whose payload equals the stored one is the CHECK's job: assert the `23514` is turned into a throw with the constraint name). Mutation: drop `.eq("status","pending")` → FAILS.
  5. "decideProposal to expired writes decided_by 'system' and the reason". Mutation: write `decided_by: null` → `23514`, FAILS.
  6. **Second-account cases (A and B each hold matching rows):** `getProposal(db, B, A's id)` → null while B has its own proposal on its own call; `listProposalsForCall(db, B, A's call)` → `[]`; `listPendingProposals(db, B)` → only B's ids; `listPendingSiblings(db, B, {kind, contactId: A's contact, …})` → `[]`; `decideProposal(writer, B, A's id, …)` → false and A's row unchanged; likewise `revertProposalDecision`, `undoProposalDecision`, `setAppliedRef`, `expireProposals` and `restoreSiblings`, each B-scoped call moving nothing of A's. Mutation: drop `.eq("account_id", accountId)` from any one → that one's case FAILS. **Run each removal separately; there are 11 functions. Name the ones you ran, and paste the line.**
  7. "revertProposalDecision reverts accepted AND edited, clearing applied_payload and applied_ref; 'missed' when another decider holds it; 'collision' on the one-pending index" (the third seeds a fresh pending row for the same call and kind first). Mutation: `.eq("status","accepted")` only → the edited case FAILS (spec probe :355).
  8. "undoProposalDecision returns the row to pending, clears decided_*, applied_*, expired_reason, stamps undone_*; only for the decider; 'collision' on the one-pending index". Mutation: drop `.eq("decided_by", u.decidedBy)` → the other-person case FAILS.
  9. "expireProposals moves only pending ids and answers the ids it moved, stamped with the given decided_at" (one of three ids is already dismissed → answers two). Mutation: drop `.eq("status","pending")` → answers three, FAILS.
  10. "restoreSiblings gives back siblings superseded at exactly this decided_at; a sibling expired at another instant, or since restored and re-decided, stays; a sibling whose call has a new pending row stays expired and is reported collided" (reviewer note 2). Seed:
      - S1, superseded at `T`;
      - S2, superseded at `T + 1 ms`;
      - S3, superseded at `T`, then a new pending row inserted for S3's call and kind.

      Calling with `T` → `{ restored: [S1], collided: [S3] }`, S2 still expired, S3 still `expired/superseded`, and `console.error` named S3's id. Mutations: drop `.eq("decided_at", decidedAt)` → S2 is restored, FAILS; treat `23505` as a thrown error → the call throws, FAILS.
  11. "fillContactBlanksReport says when the fill raised a duplicate flag": the contact gets an email that another contact of the same account holds → `{ fields: ["email"], flagged: true }`; a fresh email → `flagged: false`. `fillContactBlanks` still returns `["email"]` (unchanged contract). Mutation: `flagged: false` hard-coded → FAILS.
  12. "deleteTaskForUndo deletes only an open task with the same title and due date, and emits task.deleted with the person as actor": four tasks — the match (deleted, `true`, `events` row `task.deleted` with `actor_id` the given id); retitled (`false`, kept); completed (`false`, kept); another due date (`false`, kept). Second account: B's id with A's task → `false`, kept. Mutations: drop `.is("completed_at", null)` → the completed task is deleted, FAILS; drop the title condition → the retitled task is deleted, FAILS.
  13. Parity (replacing Task 1's `it.todo` in `proposals-schema.test.ts`): the case as Task 1 Step 3 case 14 describes. Mutation: add `"note"` to `PROPOSAL_KINDS` without touching the CHECK → FAILS (spec probe :364, first half); add `'note'` to the CHECK on a rebuilt replica → FAILS (second half).
  14. `effectiveStatus`: pending with `expiresAt` 1 ms after `now` → `pending`; exactly at `now` → `expired`/`aged`; any decided status is unchanged whatever the date. Mutation: `>` for `>=` → FAILS.

  **`apps/web/src/lib/proposals/grounding.test.ts`** (append):
  - "groundedTurn returns the LAST matching caller turn's text, index and at" (a transcript where the phrase appears in caller turns 1 and 3 → index 3, its `at`). Mutation: `findIndex` for `findLastIndex` → FAILS.
  - "groundedEvidence equals groundedTurn(...)?.text for every existing case" (loop over this file's existing fixtures). Mutation: return the needle → FAILS.

  **`apps/web/src/lib/proposals/generate.test.ts`:** the pinned edits in "Pinned tests" (`base.language`, three whole rows, `["proposals"]`) plus one new case: "stores the caller's turn index and the call's language: a Spanish call's row has evidence_lang 'es' and evidence_ref {turn, at} of the grounded turn" (`language: "es"`, transcript index 1). Mutations: store `evidenceLang: "en"` always → FAILS; store `turn: 0` → FAILS. The whole-row `expires_at` literal is `"2026-10-18T13:00:00.000Z"` if `base.now` is `2026-09-18T13:00:00.000Z` (read `base.now` off `:146-160` and type the sum out; never compute it in the assertion).
- [ ] **Step 4: Run them red.**
  - db: `cd packages/db && source $S/s15c-t4-impl/env-run.sh && node node_modules/vitest/vitest.mjs run src/test/proposals.test.ts src/test/proposals-schema.test.ts > red.out 2>&1; echo $? > red.code`.
  - web: `pnpm --filter web exec vitest run src/lib/proposals/grounding.test.ts src/lib/proposals/generate.test.ts`.

  Paste each summary.
- [ ] **Step 5: Write `proposal-rules.ts`** (pure; imports nothing). Every member is in Interfaces. `effectiveStatus` reads `row.status === "pending" && Date.parse(row.expiresAt) <= now.getTime()` → `{ status: "expired", reason: "aged" }`.
- [ ] **Step 6: Write `proposals.ts`.** The rules:
  - `COLS` lists every column of 0088.
  - `toProposal(r)` parses `payload` by `kind` with the three `parse*` functions, and **returns null and logs `listX: skipped proposal <id>: payload does not fit kind <kind>`** for a mismatch (never the payload).
  - `insertProposal` keeps `call-proposals.ts:86-112`'s never-throws contract and both log branches word for word, with the table name changed. It inserts `source: "call"`, `evidence_ref`, `evidence_lang` and `expires_at: input.expiresAt`.
  - Every read and write carries `.eq("account_id", accountId)` (except the agency read, which keeps `call-proposals.ts:172-213`'s shape and its brand and zone join, and adds `.gt("expires_at", now.toISOString())`).
  - Every write has `.select("id")`, so a match on nothing is knowable (the `call-proposals.ts:228-236` doc, kept).
  - `decideProposal` (`to: accepted|edited`) updates `{ status, decided_at: now.toISOString(), decided_by, applied_payload }` where `account_id`, `id` and `status = 'pending'`. `to: expired` writes `decided_by: SYSTEM_DECIDER`, `expired_reason`. `to: dismissed` writes no `applied_payload`.
  - `revertProposalDecision` updates `{ status: "pending", decided_at: null, decided_by: null, applied_payload: null, applied_ref: null }` where `account_id`, `id`, `.in("status", ["accepted","edited"])` and `decided_by`. It maps `23505` → `"collision"` (logged as `actions.ts:56-68` does today) and an empty result → `"missed"` (logged).
  - `undoProposalDecision` updates `{ status: "pending", decided_at: null, decided_by: null, applied_payload: null, applied_ref: null, expired_reason: null, undone_at: now, undone_by: decidedBy }` where `account_id`, `id`, `.in("status", u.from)` and `decided_by`. `23505` → `"collision"`.
  - `expireAfterUndoCollision` updates `{ status: "expired", expired_reason: "superseded", decided_by: "system", decided_at: now, applied_payload: null, applied_ref: null }` where `account_id`, `id`, `.in("status", ["accepted","edited"])` and `decided_by = <the decider>` (the inverse already ran; the row is no longer the decider's Accept).
  - `restoreSiblings` loops ids, each `update {status:"pending", decided_at:null, decided_by:null, expired_reason:null}` where `account_id`, `id`, `status = 'expired'`, `expired_reason = 'superseded'`, `decided_by = 'system'` and `decided_at = decidedAt`. `23505` → push to `collided` and `console.error("restoreSiblings: sibling <id> (account <a>) stays out of date: a new suggestion for the same call is pending")`. Any other error throws.
  - `listPendingSiblings` reads pending rows `kind = q.kind`, `contact_id = q.contactId`, `id ≠ q.exceptId`, `expires_at > now`, ≤ 50.
  - The `index.ts` block at `:165-169` becomes `export * from "./proposal-rules";` plus a named export block from `./proposals` listing every function above and nothing from `./call-proposals`.
  - Add `"./proposal-rules": "./src/proposal-rules.ts",` to `package.json` `exports`.
- [ ] **Step 7: `contacts.ts` and `activities.ts`.**
  - Rename the body of `fillContactBlanks` to `export async function fillContactBlanksReport(…): Promise<{ fields: string[]; flagged: boolean }>`, which returns `{ fields: [], flagged: false }` where today's returns `[]`, and `{ fields: reportedFields, flagged: await flagDuplicatesAfterWrite(…) }` at the end.
  - `export async function fillContactBlanks(...args) { return (await fillContactBlanksReport(...args)).fields; }` with the same signature and doc.
  - Export `fillContactBlanksReport` from the barrel beside `fillContactBlanks`.
  - Widen `ContactInput` (`contacts.ts:14-17`): `firstName?: string | null; lastName?: string | null;` (plan fix M16, for Undo's restore of a null name). `toRow` needs no change; every existing caller passes strings. Run `pnpm --filter web typecheck` and `pnpm --filter @bis/db typecheck`; a caller that reads `ContactInput.firstName` as a `string` and now fails is fixed with `?? ""` at that call site, and listed.
  - `deleteTaskForUndo`:

```ts
/** Undo of an accepted to-do suggestion (item 8b-1, spec 4.4): deletes the task only while it is still
 *  open and still has the title and due date the Accept wrote; true when it deleted. Request client. */
export async function deleteTaskForUndo(
  db: SupabaseClient, accountId: string, taskId: string, actorId: string,
  expect: { title: string; dueAt: string | null },
): Promise<boolean> {
  let q = db.from("tasks").delete()
    .eq("account_id", accountId).eq("id", taskId).is("completed_at", null).eq("title", expect.title);
  q = expect.dueAt === null ? q.is("due_at", null) : q.eq("due_at", expect.dueAt);
  const { data, error } = await q.select("id");
  if (error) throw new Error(`deleteTaskForUndo failed: ${error.message}`);
  if ((data ?? []).length === 0) return false;
  await emit(db, accountId, "task.deleted", actorId, { taskId });
  return true;
}
```

- [ ] **Step 8: The generator.**
  - **`grounding.ts`:** add `export function groundedTurn(quote, transcript): { text: string; index: number; at: string } | null` using `transcript.findLastIndex(<the same predicate>)`. `groundedEvidence` becomes `return groundedTurn(quote, transcript)?.text ?? null;`. The doc block at `:100-144` moves to `groundedTurn` and is kept whole.
  - **`generate.ts`:**
    - `input` gains `language: "en" | "es"` with a doc line (the call's spoken language, `finishCall`'s `spokenLanguage`, written to `calls.language` from the same value).
    - Each of the three `groundedEvidence(evidence, input.transcript)` calls (`:439`, `:511`, `:558`) becomes `const turn = groundedTurn(evidence, input.transcript); if (turn === null) continue;`.
    - Each `insertProposal(…)` passes `evidence: turn.text, evidenceRef: { turn: turn.index, at: turn.at }, evidenceLang: input.language, expiresAt: proposalExpiresAt(input.now)`.
    - Import `insertProposal` from `@bis/db` (unchanged), and `proposalExpiresAt` from `@bis/db/proposal-rules`.
    - The doc at `:237-240` names `proposals.ts`.
  - **`finish-call.ts:930-941`:** add `language: spokenLanguage,` after `now: meta.endedAt, timezone: ctx.timezone,`. At `:258`, `call-proposals.ts` → `proposals.ts` (comment).
  - **`finish-call.test.ts:1116`:** that `objectContaining` gains `language: "en"` (read the test's transcript; if it is Spanish, `"es"`). Mutation: drop the new line from `finish-call.ts` → FAILS.
  - **`generate.fallback.test.ts:16`:** `base` gains `language: "en" as const`.
- [ ] **Step 9: Keep web typecheck green.**
  1. Run `pnpm --filter web typecheck > tc.out 2>&1` and paste the error list.
  2. Fix exactly the files named under "Modify (type and literal only)": the type rename `CallProposal` → `Proposal`; `STATUS_TREATMENT` gains `edited` and `expired`; the five builders gain the new fields (`source: "call", evidenceRef: {}, evidenceLang: "en", expiredReason: null, appliedPayload: null, appliedRef: null, undoneAt: null, undoneBy: null, expiresAt: "2026-10-01T00:00:00Z"`); `actions.ts`'s two decides and the revert; the buckets type test; `e2e/call-proposals.spec.ts:119`; and `actions.test.ts`'s import line and two shims (I-2).
  3. Re-run → 0 errors.

  **Any error outside that list STOPS the task.**
- [ ] **Step 10: Run green.**
  - db, on set A: `proposals.test.ts`, `proposals-schema.test.ts`, `server-only-writes-grants.test.ts`, `technician-scope.test.ts` → pass (read the counts).
  - web: `src/lib/proposals/grounding.test.ts`, `src/lib/proposals/generate.test.ts`, `src/lib/proposals/generate.fallback.test.ts`, `src/lib/voice/finish-call.test.ts`, `"src/app/(dashboard)/dashboard/accounts/[accountId]/tasks/page.test.ts"`, `"src/app/(dashboard)/dashboard/work/page.test.ts"`, `"src/app/(dashboard)/dashboard/work/agency-work-list.test.ts"`, `"src/app/(dashboard)/dashboard/accounts/[accountId]/calls/[callId]/page.test.ts"`, `"src/app/(dashboard)/dashboard/accounts/[accountId]/calls/[callId]/proposals.test.ts"`, `src/lib/work/buckets.test.ts` → pass, each by path. **Not** `…/calls/[callId]/actions.test.ts` (live; Task 8 deletes it).
  - `pnpm --filter web typecheck` and `pnpm --filter @bis/db typecheck` → 0.
  - eslint on every touched file.
- [ ] **Step 11: Probes.** Run every mutation named in Step 3 by its case. Paste each failing line, then revert and `cmp`.
- [ ] **Step 12: Commit** (one commit; the early-commit option for Task 5 is in "Task list"). `git add -- <new files>`, then `git commit -m "db: proposals module and rules subpath replace call-proposals; the generator writes the turn and the call's language; Undo's helpers (item 8b-1)" -- <every path above, deleted ones included>`. Stop set A.

---

## Task 5: The kind registry and local days (bis-crm, second agent)

**Review:** opus. **After:** Task 4's commit (types) and Task 3's commit (keys). **No database.** Every test here is a unit test. `stillHolds`, `apply` and `inverse` are proven against the replica by Task 6's live tests, and here by fakes that record calls.

**Files**
- Create: `apps/web/src/lib/proposals/local-day.ts` (+ `local-day.test.ts`)
- Create: `apps/web/src/lib/proposals/kinds/types.ts`, `task.ts`, `contact-field.ts`, `opportunity-stage.ts`, `index.ts` (+ `task.test.ts`, `contact-field.test.ts`, `opportunity-stage.test.ts`, `index.test.ts`)

**Interfaces**
- Consumes: `Proposal`, `ProposalKind`, `TaskPayload`, `ContactFieldPayload`, `OpportunityStagePayload`, `ExpiredReason`, `PROPOSAL_KINDS`, `parse*` from `@bis/db/proposal-rules`; `addTask`, `taskAssigneeFor`, `readPersonId`, `fillContactBlanksReport`, `getContact`, `updateContact`, `moveOpportunityToStage`, `deleteTaskForUndo` from `@bis/db` (called inside functions only); `normalisePhone` from `@bis/db/phone`; `spokenPhone` (`lib/voice/phone-number`); `isValidEmail` (`lib/forms/guards`); `Tr` (`lib/record/copy`).
- Produces:

```ts
// lib/proposals/local-day.ts
export function localDateKey(at: Date, zone: string): string;                // "YYYY-MM-DD" in zone (en-CA)
export function firstInstantOfLocalDay(dateKey: string, zone: string): string; // ISO; the first instant whose local date is dateKey
export function addLocalDays(dateKey: string, days: number): string;          // calendar arithmetic on the key, zone-free

// lib/proposals/kinds/types.ts
export type Db = Parameters<typeof import("@bis/db").addTask>[0];
export type DescribeCtx = { tr: Tr; zone: string; stages: Readonly<Record<string, { name: string; position: number }>>; now: Date };
export type Part = { text: string; lang?: "en" };                             // lang only on the model's own words (P18)
export type Description = { parts: Part[]; detail: string | null; pastDue: boolean };
export type EditInput = Record<string, unknown>;                              // what the form posted; only the kind's fields are read
export type EditCtx = { zone: string; now: Date; stages: ReadonlyArray<{ id: string; position: number; pipelineId: string }>; pipelineIdOfDeal: string | null };
export type EditError = { field: string; key: MessageKey };
export type StillHolds = { ok: true } | { ok: false; reason: ExpiredReason };
export type ApplyCtx = { db: Db; accountId: string; userId: string; contactId: string | null };
export type Applied = { ref: Record<string, unknown>; noWrite?: "field_filled" | "name_mismatch"; flagged?: boolean };
export type Inverse = { undo: (ctx: ApplyCtx, ref: unknown) => Promise<"undone" | "changed"> } | { irreversible: MessageKey };
export type KindDef<K extends ProposalKind, P> = {
  kind: K; sources: readonly ["call"]; needsContact: boolean; dataClass: "facts";
  parse(v: unknown): P | null;
  describe(p: P, ctx: DescribeCtx): Description;
  editable: readonly string[];                                                 // task: title, dueAt; contact_field: value; opportunity_stage: toStageId
  validateEdit(stored: P, input: EditInput, ctx: EditCtx): { ok: true; payload: P } | { ok: false; error: EditError };
  normalise(p: P): P;
  stillHolds(db: Db, row: Proposal & { kind: K }): Promise<StillHolds>;
  apply(ctx: ApplyCtx, p: P): Promise<Applied>;
  inverse: Inverse;
  toast(p: P, tr: Tr, stages: DescribeCtx["stages"]): string;
  targetKey(p: P, contactId: string | null): string | null;                    // contact:<id>:<field>, deal:<id>; a to-do: null
};
// lib/proposals/kinds/index.ts
export const KINDS: { task: KindDef<"task", TaskPayload>; contact_field: KindDef<"contact_field", ContactFieldPayload>;
                      opportunity_stage: KindDef<"opportunity_stage", OpportunityStagePayload> };   // satisfies Record<ProposalKind, …>
export function kindOf<K extends ProposalKind>(k: K): (typeof KINDS)[K];
/** P16: reserved, not built. The tray takes the stop hold over after 1 Dec 2026 and counsel's step-6 read, or with decision 6. */
export type ReservedKind = "consent_hold";
```

- [ ] **Step 1: Read before writing:**
  - `generate.ts:380-526` (the generator's rules, which `validateEdit` must equal);
  - `…/calls/[callId]/actions.ts:170-294` (today's still-holds and writes, the stage checks and the contact-field "already filled" vs "mismatch" split at `:254-284`);
  - `…/calls/[callId]/proposals.tsx:116-155` (the stage skip count);
  - `contacts.ts:570-651`;
  - `opportunities.ts:54-72`;
  - `lib/record/copy.ts`;
  - `lib/voice/phone-number.ts` (`spokenPhone`);
  - `lib/forms/guards.ts` (`isValidEmail`).
- [ ] **Step 2: Write the failing tests.**

  **`local-day.test.ts`** (values worked out with node 24 here, 2026-10-19; typed out):
  - `firstInstantOfLocalDay("2026-11-01", "America/Havana")` → `"2026-11-01T04:00:00.000Z"` (fall back: 00:59 → 00:00 at 05:00Z; midnight exists twice, the earlier is taken).
  - `firstInstantOfLocalDay("2027-03-14", "America/Havana")` → `"2027-03-14T05:00:00.000Z"` (spring forward: 23:59 → 01:00; midnight does not exist, so 01:00 is taken).
  - `firstInstantOfLocalDay("2026-10-21", "America/Chicago")` → `"2026-10-21T05:00:00.000Z"`; `firstInstantOfLocalDay("2026-10-20", "Asia/Beirut")` → `"2026-10-19T21:00:00.000Z"`.
  - `localDateKey(new Date("2026-10-20T04:30:00Z"), "America/Chicago")` → `"2026-10-19"` (late evening, the UTC day is the 20th); `localDateKey(new Date("2026-10-19T22:30:00Z"), "Asia/Beirut")` → `"2026-10-20"` (early morning, the UTC day is the 19th).
  - `addLocalDays("2026-12-31", 1)` → `"2027-01-01"`; `addLocalDays("2026-10-19", 365)` → `"2027-10-19"`.

  Mutations: compute the first instant as `Date.UTC(y,m,d) - offsetAtNoon` → the Havana spring case gives `04:00Z` (a time that reads as the 13th), FAILS; take the LAST matching hour in the scan → the fall-back case FAILS.

  **`task.test.ts`** (a fake `tr` built with `makeTr("en")` and `makeTr("es")`; `zone` America/Chicago; `now` = `2026-10-19T15:00:00Z`):
  - `parse` accepts `{title, dueAt}` and refuses a `contact_field` and a `stage` payload (and `{title: 5}`). Mutation: accept any object → FAILS.
  - `describe({title:"Send the quote", dueAt:"2026-10-21T05:00:00.000Z"})`:
    - English: `parts` = `[{text:"Add a to-do: "}, {text:"Send the quote", lang:"en"}]`, `detail` = `"Due Oct 21, 2026"`, `pastDue: false`.
    - Spanish: `parts[0].text` = `"Agregar un pendiente: "`, `parts[1]` `{text:"Send the quote", lang:"en"}`, `detail` = `"Vence el 21 oct 2026"`.

    Read the two date strings with node first and type them out (A1).
  - `describe` with `dueAt` `"2026-10-14T05:00:00.000Z"` (before local today) → `detail` `"Was due Oct 14, 2026"` / `"Vencía el 14 oct 2026"`, `pastDue: true`. Mutation: compare against the UTC day → a late-evening case (`now` `2026-10-20T04:30Z`, dueAt `2026-10-19T05:00Z`): `pastDue` must be `false` (local today is the 19th), FAILS under the mutation.
  - `validateEdit`:
    - `{title:"  Call Ana  ", dueAt:"2026-10-25"}` → `payload` `{title:"Call Ana", dueAt: firstInstantOfLocalDay("2026-10-25","America/Chicago")}` (typed out `"2026-10-25T05:00:00.000Z"`).
    - Empty title → `{field:"title", key:"suggestions.edit.titleRequired"}`; 201 characters → `titleTooLong`.
    - `dueAt` `"2026-10-18"` (before local today) → `dueInvalid`; `"2027-10-20"` (past local today + 365) → `dueInvalid`; `""` → `dueAt: null`.
    - **An input carrying `field`, `opportunityId` or `fromStageId` is ignored**: the result carries only the stored payload's keys plus the edited ones (`toEqual` the whole payload). Mutation: spread `input` into the result → FAILS (spec probe :352).
  - `normalise` trims the title; `normalise(validateEdit(stored, {title: stored.title + " ", dueAt: <stored as a local key>}).payload)` deep-equals `normalise(stored)` → the decision is `accepted`, not `edited`. Mutation: `normalise = (p) => p` (no trim) → FAILS.
  - `targetKey` → null. `toast` → `"Added to your to-do list"` / `"Agregado a sus pendientes"`.
  - `apply` with a recording fake `db` and `vi.mock("@bis/db", async (io) => ({ ...(await io()), addTask: spy, taskAssigneeFor: spy2, readPersonId: spy3 }))`: calls `addTask(db, accountId, { contactId, title, dueAt, assignedTo }, userId)` with the assignee `taskAssigneeFor` returned, and returns `ref: { taskId, title, dueAt }`. Mutation: write `db.from("tasks").insert(...)` directly → `addTask` spy not called, FAILS (spec probe :351; the event side effect is asserted live in Task 6).
  - `inverse.undo`: calls `deleteTaskForUndo(db, a, ref.taskId, userId, { title: ref.title, dueAt: ref.dueAt })`; `true` → `"undone"`, `false` → `"changed"`. Mutation: always `"undone"` → FAILS.

  **`contact-field.test.ts`:**
  - `describe({field:"phone", value:"+528990000000"})` → `parts` `[{text:"Phone: (empty) → +528990000000"}]`; Spanish `"Teléfono: (vacío) → +528990000000"`; no `lang` part.
  - `validateEdit`:
    - phone `"899 000 0000"` → the `spokenPhone` value (read it with node, typed out);
    - `"abc"` → `phoneInvalid` (spec probe :353: "Skip `validateEdit`" makes the Task 6 action case accept it, and here the mutation `return { ok: true, payload: { ...stored, value: input.value } }` FAILS);
    - email `"Sam@Example.com"` → `"sam@example.com"`; `"sam@"` → `emailInvalid`;
    - an input carrying `field: "email"` for a stored `phone` payload keeps `field: "phone"` (spec probe :352).
  - `stillHolds` with a fake `db` whose `getContact` answers:
    - the field filled → `{ok:false, reason:"field_filled"}`;
    - `first_name "Caller"`, `last_name null`, field `firstName` → `{ok:true}` (the placeholder is blank, `contacts.ts:580`);
    - `first_name "Caller"`, `last_name "Lopez"`, field `firstName` → `field_filled`;
    - field `lastName`, `first_name "Roberto"` (a real name) and the payload's name not matching → `{ok:true}`. Name mismatch is reported only after the fill writes nothing (`apply` → `noWrite`), as today at `actions.ts:278-283`.

    Mutation: drop the placeholder rule → the "Caller" case FAILS (spec probe :354, second half).
  - `apply`:
    - reads `before` with `getContact` and calls `fillContactBlanksReport(db, a, contactId, { [field]: value }, userId)`;
    - on `{fields: []}` returns `noWrite: "field_filled"` when the column is now non-blank, else `"name_mismatch"`;
    - on success, `ref = { field, before: <raw column value or null>, value: <the stored form> }`, where the stored form for a phone is `normalisePhone(value)?.e164 ?? value.trim()` and for an email the lowercased value;
    - `flagged` passes through.

    Mutation: `before: null` always → the "Caller" undo case below FAILS.
  - `inverse.undo`:
    - field still `value` → `updateContact(db, a, c, { [field]: before }, userId)`, `"undone"`. **`before` is passed as stored, null included** (plan fix M16): Task 4 widens `ContactInput`'s `firstName` and `lastName` to `string | null` (`contacts.ts:14-17`; `toRow` already passes them through as given, `:119-120`), so a first name that was null is restored to null, not to `""`. Email and phone already map an empty or null value to null (`toRow:121-123`, `phoneFields`);
    - a first name filled over "Caller" restores `"Caller"`;
    - one filled from null restores null (not `""`; mutation: `before ?? ""` → FAILS);
    - a phone re-saved as `"(899) 000-0000"` whose E.164 is still `ref.value` → `"undone"` (compare `normalisePhone(current)?.e164 ?? current`);
    - a field edited since → `"changed"`, and `updateContact` not called.

    Mutation: restore `""` instead of `before` → the "Caller" case FAILS (spec probe :361).
  - `targetKey({field:"phone"}, "c1")` → `"contact:c1:phone"`. `toast` → `"Phone saved"` / `"Teléfono guardado"`.

  **`opportunity-stage.test.ts`** (`stages`: New 0, Contacted 1, Quote sent 2, Won 3, all in pipeline P; another pipeline Q's stage):
  - `describe` from New to Quote sent → `"Move from New to Quote sent"`, `detail` `"A stage is skipped in between."` / `"Se salta una etapa."`; New to Won is never proposed, so for the count case use a five-stage list (New to Booked skipping two → `"2 stages are skipped in between."` / `"Se saltan 2 etapas."`). An unresolved id → `parts` `[{text:"Review the stage change on this deal."}]` / Spanish (deviation 9).
  - `validateEdit({opportunityId:"o1", fromStageId:New, toStageId:Contacted}, {toStageId: X})`:
    - X = Quote sent → ok;
    - X = New (the current stage) → `stageInvalid`; X earlier → `stageInvalid`; X = Won (the last) → `stageInvalid`; X = Q's stage (another pipeline) → `stageInvalid`;
    - an input carrying `opportunityId: "o2"` or `fromStageId` keeps the stored ones (spec probe :352).

    Mutation: drop the last-stage check → the Won case FAILS.
  - `stillHolds`, with a fake `db` answering the deal: gone → `deal_gone`; `status 'won'` → `deal_closed`; `stage_id ≠ fromStageId` → `deal_moved`; else ok. Checks run in that order, so a closed deal at the same stage reads `deal_closed` (`actions.ts:195-201`'s reason). Mutation: check the stage before the status → the closed-at-same-stage case reads `deal_moved`, FAILS.
  - `apply` calls `moveOpportunityToStage(db, a, opportunityId, toStageId, userId)` and returns `ref {opportunityId, fromStageId, toStageId}`.
  - `inverse.undo`: deal still open at `toStageId` → `moveOpportunityToStage(… fromStageId …)`, `"undone"`; moved or closed → `"changed"`.
  - `targetKey` → `"deal:o1"`. `toast` → `"Moved to Quote sent"` / `"Movido a Quote sent"` (stage names are the account's own words).

  **`index.test.ts`:**
  - `Object.keys(KINDS).sort()` equals `[...PROPOSAL_KINDS].sort()` (the third side of the parity; Task 4 pinned the CHECK side). Mutation: delete `opportunity_stage` from `KINDS` → typecheck fails, and this test FAILS.
  - Every kind's `sources` is `["call"]` and `dataClass` is `"facts"`.
  - Each `parse` refuses the other two kinds' sample payloads (spec §8.1's first item).
  - Every `inverse` is reversible (`"undo" in inverse`).
  - No kind module reads a `@bis/db` value at import time: `vi.mock("@bis/db", () => ({}))` (a bare empty factory), then `await import("./index")` resolves without throwing. Mutation: write `apply: addTask` in one kind → FAILS (`[vitest] No "addTask" export is defined on the mock`).
- [ ] **Step 3: Run red** (`pnpm --filter web exec vitest run src/lib/proposals/local-day.test.ts src/lib/proposals/kinds/`; this folder has no live test). Paste the summary.
- [ ] **Step 4: Implement.**
  - `firstInstantOfLocalDay` is exactly:

    ```ts
    const key = (t: number) => localDateKey(new Date(t), zone);
    const [y, m, d] = dateKey.split("-").map(Number);
    let t = Date.UTC(y!, m! - 1, d!) - 15 * 3_600_000;
    while (key(t) < dateKey) t += 3_600_000;
    t -= 3_600_000;
    while (key(t) < dateKey) t += 60_000;
    return new Date(t).toISOString();
    ```

    `localDateKey` uses `new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit" })`.
  - Each kind module follows its tests.
  - `describe` builds every word through `ctx.tr.text(...)` / `ctx.tr.count("suggestions.stage.skipped", n)`.
  - Dates use `formatDateInZone(iso, ctx.zone, ctx.tr.locale)`.
  - The model's title is its own `Part` with `lang: "en"`.
  - No `"use client"`, no import-time `@bis/db` value read.
- [ ] **Step 5: Green**, then probes: every mutation named in Step 2; paste each line, revert and `cmp`. `pnpm --filter web typecheck`; eslint.
- [ ] **Step 6: Commit** `git add -- apps/web/src/lib/proposals/local-day.ts apps/web/src/lib/proposals/local-day.test.ts apps/web/src/lib/proposals/kinds`, then `git commit -m "proposals: the kind registry (parse, describe, edit, still-holds, apply, inverse) and local days in the account's zone (item 8b-1)" -- <those paths>`.

---

## Task 6: Decide, and the four actions (bis-platform)

**Review:** opus. **After:** Tasks 4 and 5. **Step 0:** `ls apps/web/src/components/proposals/suggestion-handlers.ts`. If it exists (Task 7 committed it), import its types. If not, write `decide.ts` and its live test first; `actions.ts` comes last and waits for that file. **Scratch:** `<SCRATCH>/s15c-t6-impl/`, set A. **The live test runs only with set A's `env-run.sh` sourced** (Global Constraints).

**Files**
- Create: `apps/web/src/lib/proposals/decide.ts`, `apps/web/src/lib/proposals/decide.live.test.ts`, `apps/web/src/lib/proposals/actions.ts`, `apps/web/src/lib/proposals/actions.test.ts`
- Modify: `ISR` (one line, after `:72`): `"lib/proposals/actions.ts": "proven-target",`

**Interfaces**
- Consumes: Task 4's `@bis/db` functions; Task 5's `KINDS`, `kindOf`, `localDateKey`; `makeTr`; `listPeopleNames` (`record.ts:496`); `requireAccountAccess` (`lib/auth`); `dbForRequest` (`lib/db`); `serviceDb` (`@bis/db`, in `actions.ts` ONLY); `getPersonPrefs`, `requestLocale`.
- Produces:

```ts
// lib/proposals/decide.ts
export type DecideDeps = {
  db: Db; writer: Db; accountId: string; userId: string; now: Date; zone: string; tr: Tr;
  /** Test seam only (plan deviation 20): awaited between the read and the compare-and-swap. */
  afterRead?: () => Promise<void>;
};
export type DecideOutcome =
  | { ok: true; status: "accepted" | "edited" | "dismissed"; toast: string }
  | { ok: false; error: string; field?: string };          // field: an edit error's field name
export type UndoOutcome = { ok: true; message: string } | { ok: false; error: string };
export function acceptSuggestion(d: DecideDeps, id: string, edit?: EditInput): Promise<DecideOutcome>;
export function discardSuggestion(d: DecideDeps, id: string): Promise<DecideOutcome>;
export function undoSuggestion(d: DecideDeps, id: string): Promise<UndoOutcome>;
export function revalidateFor(accountId: string, row: { callId: string | null; contactId: string | null }): string[];

// lib/proposals/actions.ts ("use server")
export async function acceptSuggestionAction(accountId: string, id: string): Promise<SuggestionActionResult>;
export async function editAcceptSuggestionAction(accountId: string, id: string, edit: Record<string, string>): Promise<SuggestionActionResult>;
export async function discardSuggestionAction(accountId: string, id: string): Promise<SuggestionActionResult>;
export async function undoSuggestionAction(accountId: string, id: string): Promise<UndoResult>;
// SuggestionActionResult / UndoResult are DecideOutcome / UndoOutcome, re-declared in
// components/proposals/suggestion-handlers.ts by Task 7 (that file is the client boundary's source of truth).
```

- [ ] **Step 1: Read before writing:**
  - `…/calls/[callId]/actions.ts` (whole: the posture `stranded`, `written`, and why revalidation failures never report failure);
  - `…/calls/[callId]/actions.test.ts:1-130` (the live harness: `refuseProduction`, the hoisted mocks, `serviceDbImpl`, `seedCall`);
  - `ISR:1-80`, `:195-210`;
  - `lib/consent/staff-actions.ts:44-60` (the undo window's shape).
- [ ] **Step 2: Write `decide.live.test.ts`** (the harness copied from `actions.test.ts:1-130`: `loadEnv`, `refuseProduction`, `vi.mock("next/cache")`, `requireAccountAccess` hoisted, `dbForRequest` → the real service client, `afterAll` deleting the throwaway accounts through `deleteAccountCascade`). `decide.ts` is called directly with `DecideDeps` built from the real clients, `tr = makeTr("en")` (one Spanish case), `zone` America/Chicago, and an injected `now`. Seed with `insertProposal` exactly as the generator would.

  Cases. Each title names its mutation, and the spec's §8.1 and §8.3 items are each covered:
  1. **Accept a to-do** writes through `addTask` (a `tasks` row whose `created_by` is the user; an `events` row `task.created` with `actor_id` the user). The row is `accepted`, `decided_by` the user, `applied_payload` = `payload`, `applied_ref` `{taskId, title, dueAt, superseded: []}`. The answer is `{ok:true, status:"accepted", toast:"Added to your to-do list"}`. Mutation: replace `kind.apply` with a direct `tasks` insert → no `events` row, FAILS (spec :351).
  2. **Edit and accept a phone** (`{value: "899 000 0000"}`) → `edited`, `applied_payload.value` the `spokenPhone` form, the contact's phone the E.164, `applied_ref.before` null. An edit equal to the stored one → `accepted` (not `edited`).
  3. **Edit with a bad phone "abc"** → `{ok:false, field:"value", error:"That doesn't look like a phone number."}`, and the row still pending and the contact untouched. Mutation: skip `validateEdit` → FAILS (spec :353).
  4. **Edit carrying `field: "email"`** on a phone suggestion → the phone is written, never the email. Mutation as Task 5's (spec :352, at the action level).
  5. **A field filled since** → `{ok:false, error:"Out of date: the phone was filled in since."}`, and the row is `expired / field_filled` by `system`. **A first name over "Caller"** with no last name → accepted and filled. Mutation: skip `stillHolds` → the first case answers ok, FAILS (spec :354).
  6. **A name mismatch** (`lastName` on a contact named Roberto, with a mismatching first name in the payload chain) → the fill writes nothing, the row is reverted to pending (with `decided_*`, `applied_payload` and `applied_ref` cleared), and the answer is `"Out of date: the name on file doesn't match this caller."`. **The same for an `edited` decision** (an edited `lastName`). Mutation: `revertProposalDecision` matches `accepted` only → the edited row stays decided, FAILS (spec :355).
  7. **A throwing write is stranded**: wrap the request client so `contacts` updates reject once. The answer is `"That may not have gone through. Check before trying again."`, the row stays `accepted`, and `console.error` names the id and `STRANDED`. Mutation: revert on a throw → FAILS.
  8. **A deal moved, closed or deleted** → `deal_moved` / `deal_closed` / `deal_gone`, each with its own sentence (three cases).
  9. **Siblings superseded:** two pending `contact_field` phone suggestions for the same contact (two calls); accept one. The other is `expired / superseded` by `system`, with `decided_at` equal to the accepted row's `decided_at`, and `applied_ref.superseded` = `[sibling id]`. A pending `email` suggestion for the same contact is untouched. Mutation: supersede by contact only (ignore the field) → the email one moves, FAILS.
  10. **Past `expires_at`** (seeded with `expiresAt` in the past) → `"Out of date: this suggestion is more than 30 days old."`, and the row is `expired / aged` by `system`. Mutation: drop the server-side age check → the Accept succeeds, FAILS (spec :356).
  11. **P22:** a to-do whose `dueAt` is before the account's local today → `"Its due date has passed. Use Edit and accept to pick a new one."`, the row still pending. Edit and accept with a new date → `edited`.
  12. **Discard** → `dismissed`, row kept, toast `"Discarded"`. **Discard of an aged row** → `expired / aged` by `system` and the aged sentence.
  13. **The loser's answer:**
      - Accept after another user (with a `users` row named "Ana López") decided → `"Ana López already answered this one."`;
      - after a user with no name → `"Someone on the team already answered this one."`;
      - after `system` → its "Out of date: …" sentence;
      - in Spanish (`tr = makeTr("es")`) → `"Ana López ya respondió esta."`.
  14. **Missing or another account's:** an unknown id → `"This suggestion isn't available."`. Account B's `DecideDeps` with A's suggestion id, while B holds a pending suggestion of its own → the same sentence, and A's row and B's row both unchanged (the second-account case).
  15. **The barrier.** Two Accepts on one to-do suggestion, both with `afterRead` set to one shared barrier that resolves when both have arrived. `Promise.all` → exactly one `{ok:true}` and one answer naming the winner; `select count(*) from tasks where title = <the title>` → **1**. Mutations: drop `.eq("status","pending")` from `decideProposal` → 2 tasks, FAILS (spec :349); move `apply` before `decideProposal` → 2 tasks, FAILS (spec :350).
  16. **Undo** (the decider, within 2 minutes; `now` injected):
      - **to-do:** the task is deleted, an `events` row `task.deleted` with the user as actor exists, the row is `pending` with `undone_by` the user and `decided_*` / `applied_*` null, and the answer is `"Undone."`;
      - **phone:** the field is cleared;
      - **first name over "Caller":** restored to `"Caller"` (spec :361);
      - **stage:** moved back.
  17. **Undo refused:** after 2 minutes (`now` + 120 001 ms), and by another user → `"Too late to undo here. Change it by hand."`, row still decided. Mutation: window `Infinity` or drop the decider check → FAILS (spec :357).
  18. **Undo finds it changed** (to-do retitled, to-do completed, field edited, deal moved): `"It has changed since. Change it by hand."`, nothing written, row still decided. Mutations: run the status compare-and-swap before the inverse → the row is pending though the record was not restored, FAILS (spec :358); skip the "still as Accept left it" condition in `deleteTaskForUndo` → the retitled task is deleted, FAILS (spec :359).
  19. **Undo whose inverse throws** (the request client rejects `tasks` deletes once) → `"That may not have gone through. Check before trying again."`, row still decided, `STRANDED` logged.
  20. **Undo whose inverse succeeded but whose compare-and-swap matched nothing** (a wrapped `writer` whose first `proposals` update after the inverse answers 0 rows) → `"The change was undone, but this suggestion didn't update. Refresh before doing anything else."`, and `console.error` names the id with "inverse done, status not moved". The inverse is not retried (the task stays deleted, and no second delete is attempted: spy count 1).
  21. **Undo gives back the siblings** this Accept superseded (`pending` again). A sibling that moved since (dismissed by hand meanwhile) stays as it is. **A sibling whose call has a new pending row** (seeded between Accept and Undo) stays `expired / superseded` and is logged by id (reviewer note 2). Mutation: skip `restoreSiblings` → the first sibling stays out of date, FAILS (spec :360).
  22. **Undo's one-pending collision on the row itself** (a new pending row for the same call, kind and contact seeded after the Accept) → the inverse runs, the row goes `expired / superseded`, and the answer is `"Undone."`.
  23. **Undo after Discard** → `pending`, `decided_*` cleared, `undone_*` stamped.
  24. **Undo of a fill that raised a duplicate flag** → `"Undone. The possible duplicate it found is still in Duplicates."`, and the flag row is still there.
  25. **A best-effort step after the write fails, and the Accept still answers ok** (plan fix I-4). Accept a phone suggestion while a pending sibling for the same field exists, with a wrapped `writer` whose `expireProposals` path (the first `proposals` update with `expired_reason = 'superseded'`) rejects. The answer is `{ok:true}`; the contact holds the phone exactly once (one `contact.updated` event); and for a to-do variant (a wrapped `writer` whose `setAppliedRef` update rejects), `select count(*) from tasks where title = <the title>` → **exactly 1**, and the row is `accepted`. `console.error` names the id. Mutation: let the throw propagate (remove the `try` around the siblings) → the answer is a failure, FAILS.
  26. **A kind that needs a customer, with none** (plan fix M8): a `contact_field` row seeded with `contact_id` null (through the service client) → `"That didn't go through. Try again."`, the row still pending, nothing written. Mutation: drop the `needsContact` guard → `kind.apply` is reached with a null contact and throws, so the row is left STRANDED and the answer is `maybeFailed`, FAILS.
  27. **Generation writes no CRM row** (retargeted, spec §8.1's last item): `generate.test.ts:270`'s `["proposals"]` already proves it at the unit level; nothing here repeats it.

- [ ] **Step 3: Write `actions.test.ts`** (unit, with mocks; not live). `vi.mock("@/lib/auth")`, `vi.mock("@/lib/db")`, `vi.mock("@bis/db", async (io) => ({ ...(await io()), serviceDb: () => SERVICE }))`, `vi.mock("./decide", …)` with spies, and `vi.mock("next/cache")`.
  1. Each action calls `requireAccountAccess(accountId)` before anything else (call-order recorder). Mutation: move it after `dbForRequest` → FAILS.
  2. Each action hands `decide` the REQUEST client as `db` and the SERVICE client as `writer` (`toHaveBeenCalledWith(expect.objectContaining({ db: REQUEST, writer: SERVICE, accountId: "A", userId: "u1" }), "p1", …)`). Mutation: swap them → FAILS.
  3. `editAcceptSuggestionAction` passes only `title`, `dueAt`, `value` and `toStageId` from the form (string-typed). A posted `field` key does not reach `decide`. Mutation: pass the whole object → FAILS.
  4. A successful decision revalidates exactly the paths `revalidateFor` returns: the call page, `/dashboard/accounts/A/tasks`, `/dashboard/work` and the record page `/dashboard/accounts/A/contacts/<contactId>`, read off the row `decide` returns. A `revalidatePath` throw after success still answers ok. Mutation: drop the record page → FAILS.
  5. The locale: `tr` is built from `requestLocale({ account, isOperator, userLanguage })`, so a client user with `users.language = "es"` gets Spanish (the `decide` spy receives a `tr` whose `tr.text("suggestions.accept")` is `"Aceptar"`).
  6. `ISR` passes with the new line, and FAILS without it (the "new importer" case).
  7. **The test seam is never set in production** (plan fix M7): the deps object each action hands `decide` has EXACTLY the keys `["accountId", "db", "now", "tr", "userId", "writer", "zone"]` (`Object.keys(deps).sort()` `toEqual` that literal). Mutation: pass `afterRead: async () => {}` → FAILS.
  8. **The answers follow the reader's stored language** (plan fix M14): a client user whose `users.language` is `es` gets `tr.locale === "es"`. The QA override `?locale=` is NOT available to a server action (it has no `searchParams`), so the e2e asserts toast words only in English and checks Spanish on the server-rendered card (Task 10). This is a stated gap, not a defect: a real reader's preference reaches the action.
- [ ] **Step 4: Run red** (live: `cd apps/web && source $S/s15c-t6-impl/env-run.sh && pnpm exec vitest run src/lib/proposals/decide.live.test.ts`; unit: `pnpm --filter web exec vitest run src/lib/proposals/actions.test.ts`).
- [ ] **Step 5: Implement `decide.ts`.** Accept, exactly in §4.4's order:

```ts
export async function acceptSuggestion(d: DecideDeps, id: string, edit?: EditInput): Promise<DecideOutcome> {
  const row = await getProposal(d.db, d.accountId, id);                     // 1. request client, RLS
  if (!row) return fail(d.tr.text("suggestions.answer.unavailable"));
  if (row.status !== "pending") return await answered(d, row);              //    names the decider, or Out of date
  if (Date.parse(row.expiresAt) <= d.now.getTime()) {                        // 2. age, server-side
    await decideProposal(d.writer, d.accountId, id, { to: "expired", reason: "aged", now: d.now });
    return fail(d.tr.text("suggestions.out.aged"));
  }
  const kind = kindOf(row.kind);                                             // 3. parse, validate, P22
  let payload = row.payload;
  if (edit) {
    const v = kind.validateEdit(row.payload as never, edit, await editCtx(d, row));
    if (!v.ok) return { ok: false, error: d.tr.text(v.error.key), field: v.error.field };
    payload = v.payload;
  } else if (row.kind === "task" && row.payload.dueAt
             && localDateKey(new Date(row.payload.dueAt), d.zone) < localDateKey(d.now, d.zone)) {
    return fail(d.tr.text("suggestions.answer.pastDue"));
  }
  if (kind.needsContact && !row.contactId) {                                 // plan fix M8: nothing to write to
    console.error(`acceptSuggestion: proposal ${id} (account ${d.accountId}) of kind ${row.kind} has no customer; refused`);
    return fail(d.tr.text("suggestions.answer.failed"));
  }
  const holds = await kind.stillHolds(d.db, row as never);                   // 4. still holds
  if (!holds.ok) {
    await decideProposal(d.writer, d.accountId, id, { to: "expired", reason: holds.reason, now: d.now });
    return fail(outOfDate(d.tr, holds.reason, row));
  }
  await d.afterRead?.();
  const edited = !deepEqual(kind.normalise(payload as never), kind.normalise(row.payload as never));
  const decidedAt = d.now;
  if (!(await decideProposal(d.writer, d.accountId, id,                      // 5. decide first
        { to: edited ? "edited" : "accepted", decidedBy: d.userId, appliedPayload: payload, now: decidedAt }))) {
    const again = await getProposal(d.db, d.accountId, id);
    return again ? await answered(d, again) : fail(d.tr.text("suggestions.answer.unavailable"));
  }
  let applied: Applied;
  try {                                                                       // 6. the write, request client
    applied = await kind.apply({ db: d.db, accountId: d.accountId, userId: d.userId, contactId: row.contactId }, payload as never);
  } catch (e) {
    console.error(`acceptSuggestion: STRANDED - proposal ${id} (account ${d.accountId}) left decided; its write may or may not have landed: ${loggableError(e)}`);
    return fail(d.tr.text("suggestions.answer.maybeFailed"));
  }
  if (applied.noWrite) {
    await revertProposalDecision(d.writer, d.accountId, id, d.userId);
    return fail(outOfDate(d.tr, applied.noWrite, row));
  }
  // FROM HERE ON THE WRITE HAS LANDED (plan fix I-4): every step below is best-effort. A failure is
  // logged with ids only and the answer is still ok, never an error that would invite a second Accept.
  // 8 before 7, so the ref can carry the siblings in one write.
  let superseded: string[] = [];
  try {
    const target = kind.targetKey(payload as never, row.contactId);
    if (target && row.contactId) {
      const sibs = (await listPendingSiblings(d.db, d.accountId, { kind: row.kind, contactId: row.contactId, exceptId: id }))
        .filter((s) => kindOf(s.kind).targetKey(s.payload as never, s.contactId) === target);
      superseded = await expireProposals(d.writer, d.accountId, sibs.map((s) => s.id), "superseded", decidedAt.toISOString());
    }
  } catch (e) {
    console.error(`acceptSuggestion: siblings not superseded for proposal ${id} (account ${d.accountId}): ${loggableError(e)}`);
  }
  try {
    if (!(await setAppliedRef(d.writer, d.accountId, id, { ...applied.ref, superseded, flagged: !!applied.flagged }))) {
      console.error(`acceptSuggestion: applied_ref not stored for proposal ${id} (account ${d.accountId}); Undo will answer "changed"`);
    }
  } catch (e) {
    console.error(`acceptSuggestion: applied_ref not stored for proposal ${id} (account ${d.accountId}): ${loggableError(e)}`);
  }
  let toast = d.tr.text("suggestions.status.accepted");                       // the fallback word if the toast text cannot be built
  try {
    toast = kind.toast(payload as never, d.tr, await stagesFor(d, row));
  } catch (e) {
    console.error(`acceptSuggestion: toast text not built for proposal ${id} (account ${d.accountId}): ${loggableError(e)}`);
  }
  return { ok: true, status: edited ? "edited" : "accepted", toast };
}
```

  The rest of `decide.ts`:
  - `answered(d, row)` reads `listPeopleNames(d.db, [row.decidedBy])` for a person (`"Someone on the team"` when absent), or the reason sentence when `decidedBy === "system"`.
  - `outOfDate(tr, reason, row)` fills `{field}` with the lowercased field label for `field_filled`.
  - `discardSuggestion` is §4.4 item 2 (the aged branch first).
  - `undoSuggestion` is §4.4 item 3, inverse first:
    1. Read the row on the request client (missing → `unavailable`).
    2. Refuse unless `decidedBy === d.userId`, `d.now - decidedAt < UNDO_WINDOW_MS` and the status is one of `accepted|edited|dismissed` → `tooLate`.
    3. Dismissed → `undoProposalDecision(… from: ["dismissed"] …)`.
    4. Otherwise run `kind.inverse.undo` on the request client:
       - `changed` → `changed`;
       - a throw → STRANDED, `maybeFailed`;
       - `undone` → `undoProposalDecision(… from: ["accepted","edited"] …)`. On `"collision"`, `expireAfterUndoCollision(…)`; on `"missed"` or a thrown error, log "STRANDED - proposal <id>: inverse done, status not moved" and answer `undoStranded`.
    5. Then `restoreSiblings(d.writer, d.accountId, ref.superseded ?? [], row.decidedAt!)`. **Best-effort** (plan fix I-4): the row is already undone, so a throw here is logged with ids and the answer stays ok.
    6. The message is `undoneDuplicate` when `ref.flagged`, else `undone`.

    Logs carry ids and state words only, never a title, a value or evidence.
- [ ] **Step 6: Implement `actions.ts`** (`"use server"`):
  - The order, stated (plan fix M13): `requireAccountAccess` → `dbForRequest()` → the account row (`timezone`, `language`) on the request client → `getPersonPrefs()` → `requestLocale({ account: accountLanguage, isOperator: access.isAgency, userLanguage: prefs.language })` with a named variable (`request-locale-callers.test.ts`) → `makeTr(locale)` → `renderZone(account.timezone)` → `serviceDb()` → `decide…`.
  - On ok, revalidate `revalidateFor(...)`, each in a `try`; a throw is logged and the action still answers ok.
  - The whole body sits in one `try`; an unexpected throw before the decision answers `failed`.
- [ ] **Step 7: Green; probes** (every mutation in Steps 2–3; paste each line; revert; `cmp`). `pnpm --filter web exec vitest run "$ISR" src/lib/proposals/actions.test.ts src/lib/i18n/request-locale-callers.test.ts`. The live test is run only as in Step 4. `pnpm --filter web typecheck`; eslint.
- [ ] **Step 8: Commit** `git add -- apps/web/src/lib/proposals/decide.ts apps/web/src/lib/proposals/decide.live.test.ts apps/web/src/lib/proposals/actions.ts apps/web/src/lib/proposals/actions.test.ts`, then `git commit -m "proposals: one decision module (Accept, Edit and accept, Discard, Undo inverse-first) behind four server actions (item 8b-1)" -- <those> "$ISR"`. Stop set A.

---

## Task 7: The card, the section, the view, the styleguide (bis-frontend)

**Review:** opus. **After:** Tasks 3 and 5. **Runs beside:** Task 6.

**Files**
- Create: `apps/web/src/lib/proposals/view.ts` (+ `view.test.ts`)
- Create: `apps/web/src/components/proposals/suggestion-handlers.ts` (+ test), `suggestion-actions.tsx` (+ test), `suggestion-card.tsx` (+ test), `suggestion-section.tsx` (+ test), `suggestion-retry.tsx` (+ test; M6)
- Modify: `apps/web/src/lib/format.ts:7` (`export` on `tag` only, if not already exported; M11)
- Modify: `…/styleguide/page.tsx` (`:27`, `:75`, `:594-610`: the "Proposal status" section becomes "Suggestion card", showing the five states in English, Spanish and the pseudo-locale)

**Interfaces**
- Consumes: Task 5's `KINDS` / `describe`; `effectiveStatus` from `@bis/db/proposal-rules`; `makeTr`, `pseudoLocale`; `AiAuthorMark`'s classes (`…/calls/ai-author-mark.tsx:10-19`); `Button`; `toast` from `sonner`; `UNDO_WINDOW_MS` is NOT the toast's life (the toast lives 10 000 ms, P8).
- Produces:

```ts
// lib/proposals/view.ts (server; pure given its inputs)
export type SuggestionEdit =
  | { kind: "task"; title: string; dueDate: string }                          // dueDate "YYYY-MM-DD" in the account's zone, or ""
  | { kind: "contact_field"; label: string; value: string }
  | { kind: "opportunity_stage"; options: { id: string; name: string }[]; toStageId: string };
export type SuggestionView = {
  id: string; lang: "en" | "es";
  sourceLabel: string;                                     // "From the call on Wed, Oct 14 · Ana López"
  parts: Part[]; detail: string | null;
  evidence: string; evidenceLang: "en" | "es";
  personaMark: string;                                     // "Sofía · AI" / "Sofía · IA"
  status: ProposalStatus; statusWord: string; reasonLine: string | null; decidedLine: string | null;
  canAct: boolean;                                         // effectiveStatus === "pending"
  edit: SuggestionEdit;
  labels: SuggestionLabels;                                // every button and field word, resolved server-side
};
export type SuggestionLabels = { accept: string; editAccept: string; discard: string; saveAccept: string; cancel: string;
  undo: string; title: string; due: string; stage: string; crashed: string };
export function buildSuggestionView(row: Proposal, ctx: {
  tr: Tr; zone: string; now: Date; stages: DescribeCtx["stages"];
  pipelineStages: ReadonlyArray<{ id: string; name: string; position: number; pipelineId: string }>;
  callerName: string | null; callStartedAt: string | null; personaName: string; names: Readonly<Record<string, string>>;
  viewerId: string | null;
}): SuggestionView;

// components/proposals/suggestion-handlers.ts (no "use client"; pure, injected toast and schedule)
export type SuggestionActionResult = { ok: true; status: "accepted" | "edited" | "dismissed"; toast: string } | { ok: false; error: string; field?: string };
export type UndoResult = { ok: true; message: string } | { ok: false; error: string };
export const SUGGESTION_TOAST_MS = 10_000;
export async function runDecision(deps: {
  act: () => Promise<SuggestionActionResult>; undo: () => Promise<UndoResult>;
  toast: { success: typeof import("sonner").toast.success; error: typeof import("sonner").toast.error; dismiss: typeof import("sonner").toast.dismiss };
  schedule: (fn: () => void, ms: number) => void; labels: { undo: string; crashed: string };
}): Promise<{ ok: true } | { ok: false; field?: string; error: string }>;
```

- [ ] **Step 1: Read before writing:**
  - `…/calendar/cancel-booking.ts` (whole) and its test (the handler shape, no DOM);
  - `…/calls/[callId]/proposals.tsx` (whole; the evidence note at `:231-251` stands);
  - `…/calls/ai-author-mark.tsx`;
  - `components/record/record-card.tsx:18-40` (the skeleton and Retry shapes);
  - `apps/web/src/lib/rendered-text.ts`;
  - `…/styleguide/page.tsx:20-110`, `:590-615`;
  - `lib/ai/client-boundary.test.ts` (the client-import guard's shape).
- [ ] **Step 2: Write the failing tests.**

  **`suggestion-handlers.test.ts`** (fake `toast` recording calls; fake `schedule` recording `[fn, ms]`):
  1. ok → `toast.success(result.toast, { action: { label: "Undo", onClick }, duration: 10_000 })`, plus `schedule(…, 10_000)` that dismisses that toast. Mutation: `duration: UNDO_WINDOW_MS` → FAILS.
  2. Clicking the action calls `undo()` once. Its ok message is toasted with `success`, its error with `error`. Mutation: call `act` again instead of `undo` → FAILS.
  3. Not ok → `toast.error(error)` and `{ok:false, field}` returned (so the edit form can show it under the field), and no Undo.
  4. `act` throws → `toast.error(labels.crashed)`.

  **`suggestion-actions.test.ts`** (`renderToStaticMarkup`; no DOM):
  - pending: exactly ONE `variant="default"` button (Accept) and two ghost buttons (`data-variant="ghost"`, or the class the `Button` emits for ghost; read `components/ui/button.tsx`);
  - in edit mode (the `initialMode="edit"` prop exists for this test and the styleguide): exactly one default (Save and accept), and Cancel ghost;
  - every button `type="button"`, except Save and accept, which is `type="submit"` inside a `<form>`;
  - the task form has an `<input type="date">` with the view's `dueDate`;
  - the stage form a `<select>` with exactly the view's options.

  Mutations: make Discard `variant="default"` → FAILS; render Accept in edit mode → two defaults, FAILS. The file imports no value from `@/lib/proposals/kinds` or `@bis/db` (read the file's text: `expect(src).not.toMatch(/from ["']@bis\/db["']|lib\/proposals\/kinds/)`). Mutation: import `KINDS` → FAILS.

  **`suggestion-card.test.ts`** (views built by `buildSuggestionView` from typed-out rows):
  1. **Five states in English**, by `renderedText`: "Suggested", "Accepted", "Edited", "Discarded", "Out of date"; each with a dot element (`data-status-dot`) and the word (rule 3). The decided ones carry "Accepted by Ana López · 9:42 AM" (typed out from node; A1). The out-of-date one carries its reason line ("This deal has moved since.") and NO buttons. A pending row past `expiresAt` renders "Out of date" with "More than 30 days old." and no buttons (`effectiveStatus`).
  2. **The same five in Spanish**: "Pendiente", "Aceptada", "Editada", "Descartada", "Vencida", and "Aceptada por Ana López · 9:42 a.m.". Mutation: render `statusWord` from an English map → FAILS (spec :372).
  3. **`lang`**: the root `<article lang="es">` for a Spanish reader; the model's title inside `<span lang="en">`; the evidence `<q lang="es">` for an `evidenceLang` "es" row read by an English reader. Mutation: drop the title's `lang` → FAILS.
  4. **The persona mark** reads `"Ana · AI"` when the persona is Ana (never a hard-coded "Sofía"), and `"Ana · IA"` in Spanish.
  5. **The evidence is never clamped**: no `line-clamp` class in the card's markup. Mutation: add one → FAILS.
  6. **The pseudo-locale**: with `makeTr("en", true)`, every visible string except the model's title and the evidence is pseudo-localised (a regex for the pseudo brackets the module emits; read `pseudo-locale.ts`).
  7. **Tokens only**: the card's markup contains no `#` hex colour and no `rounded-` class other than `rounded-[var(--radius-card)]`, `rounded-[var(--radius-ctl)]` and `rounded-full`.
  8. The root carries `data-suggestion={id}` and `data-status={status}` (the e2e's scope).

  **`suggestion-section.test.ts`**:
  - loaded: a mono-label `<h2>` "Suggestions" / "Sugerencias" with `lang` on the `<section>`, the subhead with the persona, the cards, and **no element wrapping the cards with the card class** (the section has no `rounded-[var(--radius-card)]` of its own). Mutation: wrap the stack in `CARD` → FAILS (spec P12).
  - `capped: true` → "Showing the newest 200." / "Se muestran las 200 más recientes.".
  - error → "Couldn't load suggestions." / Spanish, with a `common.retry` button, and NO cards. **Retry** (plan fix M6) is a small client component, `components/proposals/suggestion-retry.tsx` (`"use client"`), whose `onClick` calls `useRouter().refresh()` from `next/navigation`. The page's server reads run again, and no other state is touched. Its test reads the file text: `useRouter` is imported from `next/navigation` and `.refresh()` is called. Mutation: `router.push(…)` → FAILS.
  - empty → renders nothing (`null`).
  - loading (`SuggestionSectionSkeleton`) → two skeleton cards shaped like the card (`data-skeleton`), with a `role="status"` line "Loading suggestions…", and no `animate-spin`. Mutation: render a spinner → FAILS.

  **`view.test.ts`**:
  - The source label's date is built with `lib/format.ts`'s `tag(locale)` (`format.ts:7`, `en-US` / `es-US`; plan fix M11), never a hand-written locale string. Export `tag` from `format.ts` if it is not exported (one word; `format.ts` is otherwise untouched). The label reads `"From the call on Wed, Oct 14 · Ana López"` / `"De la llamada del mié, 14 de oct · Ana López"` for `callStartedAt` `2026-10-14T14:42:00Z` in America/Chicago (node 24, typed out; A1). With no caller name → `"From the call on Wed, Oct 14"`.
  - The stage edit options are exactly the stages in the deal's pipeline after `fromStageId` and before the last.
  - `canAct` follows `effectiveStatus`.
  - `decidedLine` for `decided_by` = the viewer → "Accepted by You · …" using `provenance.you` (read the key's words).

  **Styleguide**: `…/styleguide/page.tsx` renders the "Suggestion card" section with one card per state for each of en, es and pseudo, and the section skeleton and error. If a styleguide test pins section titles (grep `"Proposal status"` under `…/styleguide/`), retarget it.
- [ ] **Step 3: Run red; implement; run green.**
  - `suggestion-actions.tsx` is `"use client"`. It holds the mode (`view` | `edit`) and `useTransition` (every button disabled while one runs). Esc in the edit form calls cancel. It receives the four actions as props (`accept`, `editAccept`, `discard`, `undo`), each a server action the page has bound to the account with `.bind(null, accountId)` (plan fix I-3; a server component cannot pass an inline closure to a client component, which is why today's `proposals.tsx:264-265` binds too), and calls each with the suggestion id (`accept(id)`, `editAccept(id, form)`, …). It calls `runDecision` with `toast` from sonner and `setTimeout` as `schedule`. A field error renders under its field (`aria-describedby`).
  - `suggestion-card.tsx` (server) renders the view, top to bottom: the mono-label source line; the change (`parts`, each part with its `lang`); the `detail`; the evidence ("Because the caller said" plus `<q lang={evidenceLang}>`); the persona mark; the status (dot and word, the reason line, the decided line); and `SuggestionActions` when `canAct`.
  - Classes: `rounded-[var(--radius-card)] border border-[var(--line)] bg-[var(--surface-1)] shadow-[var(--shadow-card)] p-5 flex flex-col gap-2.5`. The mono label uses the house class `font-mono text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground`. Controls are `min-h-11 md:min-h-8`.
  - Status dots: `bg-primary` (pending), `bg-success` (accepted, edited), `bg-muted-foreground/60` (dismissed, expired), the treatments today's `STATUS_TREATMENT` uses (`proposals.tsx:44-60`).
- [ ] **Step 4: Probes** (every mutation above; paste each line; revert; `cmp`). `pnpm --filter web exec vitest run src/lib/proposals/view.test.ts src/components/proposals/ "src/app/(dashboard)/dashboard/styleguide/" src/lib/ai/client-boundary.test.ts src/components/ui/material.test.ts`. The styleguide folder holds no live test; check with `ls` first. `pnpm --filter web typecheck`; eslint.
- [ ] **Step 5: Commit** `git add -- <new files>`, then `git commit -m "ui: one bilingual suggestion card with Accept, Edit and accept, Discard and a 10-second Undo; the section's loading, error and cap; the styleguide (item 8b-1)" -- <every path>`.

---

## Task 8: Wire the call page, the tray and the agency page; delete the old block (bis-frontend)

**Review:** opus, then bis-design-reviewer on the UI diff. **After:** Tasks 6 and 7.

**Files**
- Modify:
  - `…/calls/[callId]/page.tsx` (`:13-14`, `:35`, the reads at `:131-170`, the slot at `:382-388`) and `page.test.ts`;
  - `…/tasks/page.tsx` (`:8`, `:104-133`, the props at `:178-194`), `…/tasks/work-list.tsx` (`:11`, `:38-40`, `:182-284`, `:547-569`), `…/tasks/page.test.ts`, `…/tasks/loading.tsx` (M5);
  - `…/work/agency-work-list.tsx` (`:30`, `:262-360`), `agency-work-list.test.ts`, `…/work/page.tsx` (only if a type moves), `page.test.ts` (the bare factory: add any value the new graph calls);
  - `ISR` (`:72` out).
- Delete: `…/calls/[callId]/{actions.ts,actions.test.ts,proposals.tsx,proposals.test.ts,proposal-actions.tsx,proposal-actions.test.ts}`.

- [ ] **Step 1: The call page.**
  - Replace `CallProposals` with `<SuggestionSection id="call-proposals" …>`. The `id` stays, so the agency's `#call-proposals` links land (deviation 14).
  - The page resolves `requestLocale(...)` (its own named-variable call, with `userLanguage`) and `makeTr(locale, requestPseudoMode(searchParams))` **for this section only**. The rest of the page stays English (spec §4.5).
  - Rows come from `listProposalsForCall` (pending first, as `proposals.tsx:191-197` sorted). The stage names come from today's best-effort read (`:139-170`).
  - The persona name is already read (`:180-194`). Decider names come from one `listPeopleNames(db, decidedBy ids)`. The other reads are in the table under Step 2.
  - The four actions are passed as `acceptSuggestionAction.bind(null, accountId)`, `editAcceptSuggestionAction.bind(null, accountId)`, `discardSuggestionAction.bind(null, accountId)` and `undoSuggestionAction.bind(null, accountId)` (plan fix I-3; never an inline closure, which a server component cannot hand to a client component; today's `proposals.tsx:264-265` binds the same way). The tray (Step 2) binds them the same way.
  - A failed read renders the section's error state (rule 5), not nothing. `page.test.ts`: replace every assertion on the old block with:
    - the section renders cards for the mocked rows, pending first;
    - a read failure renders "Couldn't load suggestions." and the rest of the page;
    - a Spanish reader gets "Sugerencias" while the page title stays English.
- [ ] **Step 2: The tray** (`…/tasks/page.tsx`, `work-list.tsx`).
  - `listPendingProposals(db, accountId)` (201 rows, deviation 19). On error, `proposalsError = true` (no longer swallowed to `[]`, spec §4.5).
  - **Every new read the tray and the call page need, named** (plan fix I-5). All of them run on the REQUEST client, carry `.eq("account_id", accountId)` where the table has the column, and are bounded:

    | Read | Where | Query | Bound |
    |---|---|---|---|
    | persona name | tray (new); call page (exists, `page.tsx:180-194`) | `getVoiceProfile(db, accountId)` → `persona_name`, best-effort, falling back to "Sofía" exactly as the call page does | one row |
    | the calls behind the rows (`callStartedAt`, the caller's contact) | tray (new); call page (exists: the page's own call row) | `db.from("calls").select("id, started_at, contact_id").eq("account_id", accountId).in("id", callIds)` | `.limit(callIds.length)` (≤ 200) |
    | caller names | tray: the existing contacts batch (`tasks/page.tsx:136-160`), whose `contactIds` gain the calls' `contact_id`s; call page: its own contact read | unchanged query: `.eq("account_id", accountId).in("id", contactIds)` | the id list |
    | the deals behind stage suggestions (their `pipeline_id`) | both (new) | `db.from("opportunities").select("id, pipeline_id").eq("account_id", accountId).in("id", opportunityIds)` | `.limit(opportunityIds.length)` |
    | the full stage lists of those pipelines (for `describe`'s names and positions and the Edit options) | both (replaces today's two-id stage read, `tasks/page.tsx:117-128`, `calls/[callId]/page.tsx:139-170`) | `db.from("pipeline_stages").select("id, name, position, pipeline_id").eq("account_id", accountId).in("pipeline_id", pipelineIds)` | `.limit(500)` |
    | decider names | call page only (the tray shows pending rows only, so it names no decider) | `listPeopleNames(db, decidedByIds)` (`record.ts:496`; `users`, not account-scoped, capped at the ids asked) | the id list |

    A read that fails puts the section into its error state (tray, call page); none of them is silently swallowed.

    **One page-test case per read, each with a second-account case** in the touched `page.test.ts`. The fake request client records each `from(table)` call's filters, and holds rows for BOTH `acct1` and `acct2` with matching ids. Each case asserts:
    - the read ran with `.eq("account_id", "acct1")` and `.in(<column>, <exactly the ids the rows name>)`;
    - only `acct1`'s value reaches the render (for example, `acct2`'s stage name "Other Co stage" with the same stage id never appears; `acct2`'s call `started_at` never shapes the source label).

    Mutation: drop `.eq("account_id", …)` from any one read → its case FAILS (the other account's value renders). Run each of the five account-scoped reads' removals separately and paste each line.
  - `WorkList` receives `suggestions: { views: SuggestionView[]; capped: boolean; error: boolean }`. `PendingProposalRow` and `pendingProposalSummary` (`:182-284`) are deleted, and the section at `:547-569` becomes `<SuggestionSection …>`.
  - The empty-state gate at `:494-497` reads `views.length === 0 && !error`.
  - **Loading (plan fix M5):** the route's skeleton is `…/tasks/loading.tsx` (a route `loading.tsx`; the page awaits its reads, so there is no `Suspense` boundary to mount it in). Task 8 adds `<SuggestionSectionSkeleton />` under the bucket skeleton there, inside the same `aria-busy` region. If `…/calls/[callId]/` has a `loading.tsx` (it has none at `61772cac`), the same line goes there; otherwise the call page is left without one, as today.
  - **No contamination:** suggestions never enter `buckets` (keep and run `work-list.*.test.ts` and the bucket section-isolation assertions in `page.test.ts`; spec §8.1).
  - `page.test.ts`'s proposal cases become:
    - cards with Accept, not links to the call (no `href=".../calls/` inside `[data-suggestion]`);
    - "Showing the newest 200." when 201 come back, and exactly 200 cards;
    - the error state when `listPendingProposals` rejects, with the buckets still rendered;
    - **second account:** the page asks `listPendingProposals` for the URL's account only (`toHaveBeenCalledWith(REQUEST, "acct1")`).

    Mutation: drop `.slice(0, 200)` → 201 cards, FAILS.
- [ ] **Step 3: The agency page.** `AgencyProposalRow` keeps its link and read-only posture. Its summary becomes the registry's `describe` with `makeTr("en")` and the row's own zone, with `parts` joined and the title's `lang="en"` span kept. `proposalSummary` (`:262-300`) is deleted. `agency-work-list.test.ts`: the summary assertions are retargeted to the new words ("Add a to-do: Call back"). Its no-contamination and brand cases are UNCHANGED.
- [ ] **Step 4: Delete the old block** and its tests (the files list). Remove `ISR:72`. Run the mock grep from Global Constraints → expect only the two named files. For each, list the values the new graph calls in that test and add them to its factory.
- [ ] **Step 5: Green.**
  - `pnpm --filter web exec vitest run "$ISR" "<each touched test by path>" "src/app/(dashboard)/dashboard/accounts/[accountId]/tasks/work-list.callback.test.ts" "…/work-list.consent.test.ts" "…/work-list.held.test.ts" "…/work-list.href.test.ts" src/lib/work/buckets.test.ts src/lib/i18n/request-locale-callers.test.ts src/lib/i18n/ratchet.test.ts`.
  - `pnpm --filter web typecheck`.
  - eslint.
  - `grep -rn "call_proposals" apps packages/db/src` → only `ai-gateway.ts:11`, `ai-gateway-schema.test.ts:75`, `proposals-bridge.test.ts`, `call-proposals-grants.test.ts`, `technician-scope.test.ts` and `server-only-writes-grants.test.ts` (deviation 13), and nothing under `apps` except the gateway name's test; paste it.
  - `grep -rn "CallProposals\|proposal-actions\|STATUS_TREATMENT\|acceptProposal\|dismissProposal" apps/web/src` → nothing.
- [ ] **Step 6: Probes:** the tray's cap (Step 2); render the To do suggestions inside a bucket's `<section>` → the isolation case FAILS; drop the error state (swallow to `[]`) → the error case FAILS. Paste each line.
- [ ] **Step 7: Commit** `git commit -m "ui: the suggestion card on the call page and in the To do tray, the agency page on the registry's words; the old proposals block removed (item 8b-1)" -- <every path, deleted ones included>`.

---

## Task 9: Regenerate the i18n baselines (bis-crm)

**Review:** sonnet. **After:** Tasks 3, 7 and 8.

- [ ] **Step 1.** Read `apps/web/src/lib/i18n/ratchet.test.ts` and `catalogue-baseline.json`'s header for the regenerate command (8a-2 Task 9 used it). Run it. `git diff --stat apps/web/src/lib/i18n/` shows only the two baseline files, OR NOTHING (plan fix M3).
  - **No diff is a valid outcome.** If the baselines record only English-only keys or ratchet counts, and every new `suggestions.*` key has its `.es` twin, there is nothing to regenerate. 8a-2's Task 9 came out byte-identical for the same reason (ledger: "baselines byte-identical, 1101 keys").
  - A non-empty diff is read line by line: every added entry is a `suggestions.*` key, and nothing is removed (deviation 15).
- [ ] **Step 2.** `pnpm --filter web exec vitest run src/lib/i18n/ src/lib/messages.test.ts` → pass.
- [ ] **Step 3: Commit** only if Step 1 changed a file (otherwise report "no baseline change" and commit nothing): `git commit -m "i18n: baselines for the suggestion card's keys (item 8b-1)" -- apps/web/src/lib/i18n/catalogue-baseline.json apps/web/src/lib/i18n/ratchet-baseline.json`.

---

## Task 10: The e2e spec (bis-e2e-qa)

**Review:** sonnet. **After:** Tasks 8 and 9. **Never run Playwright beyond `--list`** (the orchestrator runs it after 0088 is on bis-ci, Task 12 step 3).

**Files:** Create `apps/web/e2e/suggestions.spec.ts`; delete `apps/web/e2e/call-proposals.spec.ts`; comment words in `e2e/fixtures/session-state.ts:27` and `e2e/relationships.spec.ts:71`.

- [ ] **Step 1: Read** `apps/web/e2e/call-proposals.spec.ts` (whole: its seed through `assignPhoneNumber`, `startCallRow`, `finishCallRow` and `insertProposal`, its fixture discipline and its cleanup through the call's cascade, `:176-177`), `apps/web/e2e/support.ts:95-115` (`readClientFixture`) and `apps/web/playwright.config.ts:160-175` (`workers: 1`).
- [ ] **Step 2: Write the spec.**
  - **Fixture account ONLY.** It `test.skip`s with a reason when `readClientFixture()` is null.
  - The seed: one call on the fixture account with a contact whose phone is blank, an open deal at stage 0 in a pipeline of at least four stages, and three suggestions through the new `insertProposal`: a to-do with no due date, a phone, and a stage move from stage 0 to stage 2. `evidenceLang` is "es" on the phone one, with a Spanish caller turn.
  - **Accept the to-do:** On `/dashboard/accounts/<id>/tasks`, the card `[data-suggestion="<taskId>"]` → its Accept. The toast "Added to your to-do list" appears, and a `tasks` row with that title exists (read through `serviceDb()`).
  - **Undo from the toast:** the row is gone, and the card's `data-status` is `pending` with the word "Suggested".
  - **Edit and accept the phone with a bad value:** On the call page, the phone card's Edit and accept, then type "abc" and Save and accept. "That doesn't look like a phone number." shows under the field, and the contact's phone is still null.
  - **Then a good value:** type "899 000 0000", Save and accept. The card says "Edited", and the contact's phone is the E.164.
  - **Discard the stage move, then Undo:** the card returns to "Suggested", and the deal is still at stage 0.
  - **The reader in Spanish:** set the reader to Spanish (`?locale=es`, the QA override, `request-locale.ts:55-59`, on in Playwright's webServer env). The tray's heading is "Sugerencias" and the to-do card's button reads "Aceptar". The evidence `<q>` on the phone card has `lang="es"`, and the to-do title span has `lang="en"`.
  - **360 px with `?locale=pseudo`:** no element inside `[data-suggestion]` overflows (the 8a-2 spec's overflow check, `record-summary.spec.ts:2600-2603`).
  - **`afterAll`:** delete the seeded call (its suggestions cascade), the task if any, the contact and the deal, each `error` checked, then re-read to prove they are gone.
- [ ] **Step 3.** `pnpm --filter web exec playwright test --list e2e/suggestions.spec.ts` lists the tests (listing loads every import). `pnpm --filter web typecheck`. eslint.
- [ ] **Step 4: Commit** `git commit -m "e2e: the suggestion card on the fixture account: Accept and Undo, Edit and accept refused then saved, Discard and Undo, Spanish, 360 px pseudo (item 8b-1)" -- apps/web/e2e/suggestions.spec.ts apps/web/e2e/call-proposals.spec.ts apps/web/e2e/fixtures/session-state.ts apps/web/e2e/relationships.spec.ts`.

---

## Task 11: Whole-branch final review (checkpoint, not an implementer task)

**Reviewer:** bis-reviewer, opus, fresh context, after Tasks 1–10; then bis-design-reviewer on Tasks 7–8's UI diff (with a running build if the orchestrator provides one). Replica: Postgres `55671`, PostgREST `55678`, gateway `55679`.

- [ ] **Step 1.** Read spec §1, §2, §3, §4, §6, §7, §8 (8b-1), §9 and §10; this plan's deviations, assumptions and reviewer notes; then `git diff 88019834...HEAD` in `<WT>`. Walk "Spec coverage" row by row against the diff.
- [ ] **Step 2.**
  - Run every web test file Tasks 3–9 touched, by path; `ISR`; `src/lib/i18n/`; `src/lib/ai/client-boundary.test.ts`; `src/components/ui/material.test.ts`; `pnpm --filter web typecheck`.
  - On your replica, run `proposals-schema`, `proposals-bridge`, `proposals`, `technician-scope`, `server-only-writes-grants`, `schema-grants-guard`, `record-summaries-schema` and `ai-gateway-schema`, and the live `decide.live.test.ts` with `env-run.sh` sourced.
  - Re-run four probes of your own choosing, including **bridge case 13's** (`for update` dropped → FAILS on the name).
  - Re-run Task 1's byte check and md5 (must equal Task 1's unless Task 1's review changed 0088, in which case the latest reviewed md5).
  - Never run a live test against bis-ci.
- [ ] **Step 3. Hunt specifically:**
  - (a) A `proposals` write on the request client, or a CRM write on the service client; a decision made before `getProposal` on the request client; `serviceDb` named anywhere in `lib/proposals` other than `actions.ts`.
  - (b) Any path where Undo writes the status before the inverse; a sibling restore not scoped by `decided_at`; a `23505` on restore that throws or restores.
  - (c) A log line carrying a title, a value, evidence or a payload (grep every `console.` in `lib/proposals/*` and `packages/db/src/proposals.ts`).
  - (d) 0088:
    - ASCII, no backslash, `$` only in the 14 `$$`;
    - the self-check first (the lock taken inside the first `do` block, checked by the second) and last; no bare `set local` or `lock table`;
    - RLS on, both policies, no client write;
    - every function `search_path = ''`, schema-qualified, with execute revoked;
    - the guard's `for update` and `is distinct from`, and the missing-row raise;
    - the mirror's status condition and its `applied_payload` mapping;
    - the copy's pre-check before its insert, and the post-check;
    - `expires_at` with no default;
    - the rollback order in the header.
  - (e) Task 0's fence-meaning count: if non-zero, say which rows' Technician visibility changes, and whether that is acceptable under P14 (a recommendation to the orchestrator, not a change).
  - (f) The UI: one primary per card; no card around the stack; the drawer untouched (no `…/[contactId]/` file in the diff); `lang` placements; tokens; skeleton not spinner; usted; no plumbing words; the call page's other sections still English.
  - (g) A bare `@bis/db` factory that reaches the new graph and lacks a value it calls; an import-time `@bis/db` value read in `lib/proposals/kinds` or `components/proposals`.
  - (h) A test that cannot fail (memory "Vacuous test shapes"), especially:
    - a guard test asserting only "one side decided";
    - a copy test whose seed ran with the triggers on;
    - two refusals in one transaction;
    - a date asserted by calling the formatter;
    - an English-only copy assertion.
  - (i) The e2e touching anything but the fixture account.
  - (j) `finish-call.ts`'s diff is exactly the `language:` line and one comment word (P17).
- [ ] **Step 4.** Report findings by severity with file:line. The orchestrator routes fixes to the owning task's agent. **0088 goes to bis-ci only when this review approves it UNCHANGED** (its md5 recorded).

---

## Task 12: Rollout (orchestrator; LAST; not a coding task)

Each step reads its own evidence; nothing is inferred from an earlier run.

**The first Playwright run of this branch happens only after 0088 is on bis-ci (step 2).** Before then CI's `e2e` stops at its migration check by design, and a local run reads bis-ci, where the pages would fail without the table.

- [ ] **Step 1. The skew-protection maximum age** (spec §4.6, §10; Assumption A4). Read it on the Vercel dashboard: Project → Settings → Advanced → Skew Protection (enabled or not, and its maximum age). Cross-check with the API: `GET https://api.vercel.com/v9/projects/<project id>` with a token the owner provides, field `skewProtectionMaxAge` (seconds; the field name is an assumption). The Vercel MCP's `get_project` does not expose it. Write the value in the ledger. **It gates 0089:** 0089's earliest date is this PR's production deploy READY time plus this age. If skew protection is off, the gap ends at READY (old tabs then fail on server actions they cannot reach, and write nothing). This PR changes nothing in Vercel.
- [ ] **Step 2. bis-ci** (only AFTER Task 11 approves 0088 unchanged):
  1. `gh workflow run ci-project-setup.yml -f step=push-dry-run --ref feat/item8b-review-tray` → its log lists exactly `0088_proposals.sql`.
  2. Then `-f step=push`. Its log shows no `0088_not_one_transaction`.
  3. Post-apply, read-only MCP on `odnobiodsftffphuuosz`:
     - `select to_regclass('public.proposals')` → the table;
     - `select polname, polcmd, polpermissive from pg_policy where polrelid = 'public.proposals'::regclass order by 1` → the two policies;
     - `select tgname from pg_trigger where tgrelid = 'public.call_proposals'::regclass and not tgisinternal order by 1` → `call_proposals_guard`, `call_proposals_mirror`;
     - `select count(*), count(*) filter (where status = 'pending') from public.proposals` against Task 0's `call_proposals` counts → equal;
     - the Faithfulness digest UNCHANGED from Task 0.
  4. The copy's own `{copied, skipped, by_status}` is not returned by the CLI. Re-derive it: `select status, count(*) from proposals group by 1` equals Task 0's `call_proposals` `by_status`. Ledger line.

  From here on the `@bis/db` suites and the live web tests may run against bis-ci again.
- [ ] **Step 3. Push and CI.** Re-run and read `verify` and `e2e` ON THE HEAD SHA (`gh api repos/{owner}/{repo}/commits/<sha>/check-runs`). `verify`'s log for the local stack shows 0088 applied with no `0088_not_one_transaction` (Assumption A2's evidence, Task 2 step 2). The e2e `suggestions.spec.ts` must have run. A CI-vs-local disagreement is an environment finding first (memory "CI vs local divergence"). Then the local gates, one at a time: `pnpm check`, `pnpm --filter web build`, `pnpm --filter web test:e2e` (check that no `screenshots.yml` run is in progress first).
- [ ] **Step 4. Preview, by hand** (owner and orchestrator), on the branch's Preview (bis-ci), on a test account (never Test Client One):
  - the call page's section and the To do tray in both themes, at 360 px, for an English and a Spanish reader;
  - Accept → Undo; Edit and accept; Discard → Undo;
  - a Technician on an assigned customer's suggestion sees it, and on an unassigned one does not;
  - the agency Work page still lists suggestions read-only.
- [ ] **Step 5. Production** (MCP on `tlbkbmlrfafquucsmsmm`):
  1. Read-only pre-flight: `select max(version) from supabase_migrations.schema_migrations` → the 0087 apply. Task 0's pre-check query → still 0.
  2. `apply_migration` with 0088's exact text, ONCE (its md5 equals Task 11's; memory "MCP SQL escapes": 0088 has no backslash).
  3. **If it fails with `0088_not_one_transaction`** (Assumption A3), nothing was created (the self-check runs before any DDL). Confirm with `select to_regclass('public.proposals')` → null, then follow Question 1 (decided): the unchanged file through the SQL editor, then the history row as written there. Do not retry through MCP, and do not edit 0088.
  4. Post-checks, read-only: step 2's reads, and the copy's counts against Task 0's production `by_status`. Do this BEFORE the merge (spec §10).
  5. Ledger line: `0088 APPLIED <date> on bis-ci and production - NEVER RE-APPLY; copy by_status prod …`.
- [ ] **Step 6. Parity.** `docs/runbooks/ci-supabase-project.md` §5: `fingerprint.sql` on both projects. Equal across both: the table, its constraints, indexes, policies and trigger; the four functions' ACL, `prosecdef`, `proconfig` and bodies; the two triggers on `call_proposals`; the client-write digest.
- [ ] **Step 7. Merge** through the PR, after the head SHA's `verify` and `e2e` are green and Task 11's findings are closed: `gh pr merge <n> --squash --match-head-commit <sha>`. The PR body names:
  - the owner's approval of P1–P22 at `61772cac`;
  - the four reviewer notes and where they landed;
  - deviations 1–22 and assumptions A1–A5;
  - the pinned tests changed;
  - "Not in this PR";
  - the Preview results and the 0088 apply lines;
  - that no env var changes.
- [ ] **Step 8. After the deploy** (spec §10, owed):
  1. The deployment reads READY on the merge SHA and is aliased to `app.bis-rgv.com`. **Write the READY time in the ledger beside step 1's maximum age: their sum is the earliest 0089.**
  2. Smokes: `/` 200, `/sign-in` 200, `/api/cron/reminders` 401, `/b/bogus` 404.
  3. **Owner smoke, on the test account** (the smoke-identities rule), one real call that makes a suggestion. Read-only MCP: `select id, source, evidence_ref, evidence_lang, expires_at - created_at as age from proposals order by created_at desc limit 3` → a row with `{turn, at}` and an age of about 30 days.
  4. Accept, Undo, Edit and accept, and Discard on the call page and in To do.
  5. If a pre-deploy tab is open, a suggestion already decided in a new tab answers "That didn't go through. Try again." there and makes no to-do.
  6. Tracker (memory "Roadmap tracker"): item 8's S-14 and F-019 rows note "8b-1 shipped"; they stay `in_progress` until 8b-2 (spec §10).

---

## Spec coverage

| Spec | Where |
|---|---|
| §1 8b-1 row: one table, copy, mirror, guard, generator, decision module, one bilingual card on the call page and the To do tray, the agency page reading the new table read-only; 0088 | Tasks 1, 4, 5, 6, 7, 8 |
| §2 P1–P22 (8b-1 subset) | "Owner rulings" table |
| §3 what exists (every reference moved) | Task 4 (module, generator), Task 8 (screens), deviation 13 (the grep) |
| §4.1 0088: lock, order, columns, CHECKs, immutability, indexes, RLS, grants, teardown, rollback; the one-transaction check | Task 1; Task 2; deviations 1, 7, 8 |
| §4.2 the registry: parse, describe, edit and `validateEdit` (fields only; DST; local today), normalise, still-holds (placeholder), apply (existing paths), inverse, toast and targetKey, dataClass; the parity test | Task 5; Task 4 (the CHECK side); Task 1 (`it.todo` → Task 4) |
| §4.3 the generator (turn, language, `expires_at`, never throws); every reference moved | Task 4; deviations 4, 5, 6 |
| §4.4 Accept (steps 1–9), Discard, Undo (inverse first, stranded, collision, siblings), the duplicate note, revalidation | Task 6; Task 4 (writes); reviewer note 2 |
| §4.5 the card (content, states, buttons, toast, layout, language, tokens, styleguide); where it shows; empty; error | Tasks 7, 8 |
| §4.6 the copy, the mirror, the guard; the gap; 0089's evidence (recorded, not built) | Task 1; Task 12 steps 1, 2, 5, 8 |
| §4.7 answers in the moment, both languages | Task 3 (keys); Task 6 (cases 5–24) |
| §6 authorship (person's write, persona's mark, the decision recorded) | Tasks 5 (actor ids), 6 (case 1: `created_by`, `events`), 7 (mark) |
| §7 copy, usted, `{persona}`, pseudo-locale, 360 px | Tasks 3, 7, 10; deviations 15–18 |
| §8.1 unit and action tests | Tasks 5, 6, 7, 8 |
| §8.2 database tests (replica, then bis-ci) | Tasks 1, 4; reviewer notes 1, 3, 4 |
| §8.3 probes :349–:372 (8b-1 ones; :371 is 8b-2) | Task 1 Step 9 (:362, :363, :365–:370), Task 4 (:355, :364), Task 5 (:351–:354, :361), Task 6 (:349, :350, :353, :356–:361), Task 7 (:372) |
| §8.4 e2e (8b-1 part) | Task 10 |
| §9 not in 8b; revisits listed | "Not in this PR"; P16 reserved name (Task 5) |
| §10 8b-1 rollout: skew age, bis-ci → prod → parity, migration before code, owed smoke | Task 12 |
| §11 unsure items | 30-day age: `PROPOSAL_MAX_AGE_MS` (Task 4, re-read after a month); skew age: Task 12 step 1; Caller restore: Task 5/6 cases; throwaway bridge: `proposals-bridge.test.ts` is deleted with it in 8b-2 |

## Questions for the owner

Only new questions; everything else is decided in P1–P22.

None open. **Both were decided by the owner on 2026-10-18, as recommended** ("go with your recommendations").

1. **If MCP `apply_migration` does not run 0088 in one transaction on production. DECIDED.** 0088 then refuses with `0088_not_one_transaction` before any DDL and creates nothing (Assumption A3). In that case:
   - The owner pastes the **unchanged** file into the Supabase dashboard's SQL editor and runs it once. The editor sends the text as ONE simple-query message, which PostgreSQL runs as one implicit transaction (Task 2 Step 3 (c) proves this shape on the replica), so **the bytes stay identical** to bis-ci's and the md5 parity holds. No `begin`/`commit` wrapper is added (plan fix M9).
   - Then the orchestrator, in the same session, records the history row by hand. The runbook has no such section, so the statement is written out here. MCP's own rows use a UTC timestamp as `version` and the file name without its number as `name` (ledger: 0087 is `20261018215623`, `record_summaries`).
     1. First, read-only: `select column_name, data_type from information_schema.columns where table_schema = 'supabase_migrations' and table_name = 'schema_migrations' order by ordinal_position;` and `select version, name, array_length(statements, 1) from supabase_migrations.schema_migrations where name = 'record_summaries';`. Write the row in the same shape the 0087 row has. If the columns differ from `(version, name, statements)`, STOP and report.
     2. Then:

        ```sql
        insert into supabase_migrations.schema_migrations (version, name, statements)
        values ('<the apply's UTC time as YYYYMMDDHHMMSS>', 'proposals', array[$m0088$<0088's exact text>$m0088$]);
        ```

        Use the dollar-quote tag `$m0088$`, which 0088 itself never contains (it uses only `$$`).
     3. Then the post-checks of Task 12 step 5, and the parity check.
2. **Task 0's fence-meaning count. DECIDED: accept it.** If any production `call_proposals` row has a `contact_id` different from its call's contact, those rows' Technician visibility changes with 0088 (spec §4.1's fence reads the row's customer; 0068's read the call's). The generator has always written the call's contact, so the expected count is 0, and P14 is stated in terms of the suggestion's customer. The plan only reports the number.

## Self-review notes (the writer's own pass, 2026-10-19)

- **Spec coverage:** every §4 bullet, §6, §7, §8's 8b-1 items and §10's 8b-1 lines map to a row above. Where the code made the spec's words impossible or ambiguous, deviations 1–22 say so, with the file:line that decided it. The most important are 1 (one transaction proven in-file), 2 (the subpath that keeps bare mocks safe), 3 (names kept) and 13 (the grep's four extra hits, all old-table tests that 8b-2 removes).
- **The brief's four reviewer notes:** note 1 is in bridge cases 12 and 13; note 2 in Task 4 case 10 and Task 6 case 21; note 3 in every refusing case's own `withRollback`; note 4 in the bridge file's header and helpers.
- **The 8a-2 lessons:**
  - type dependencies wait for commits (T5 on T4; T6 on T7's handlers file);
  - literals are fixed in the renaming task (Task 4's list and Step 9's stop rule);
  - second-account cases with matching rows (Task 1 case 5, Task 4 case 6, Task 6 case 14, Task 8 step 2);
  - the IMPORT grep (Global Constraints);
  - probes that hit exercised code, with the reason stated;
  - the free-text heuristic settled up front (this PR adds none: `targetKey` is structural and `validateEdit` reuses the generator's checks);
  - no jsdom (handlers pure, e2e for the browser);
  - e2e only after bis-ci;
  - no seeded-account record opens added (the e2e uses the fixture account; no existing spec gains a suggestion read on Test Client One, because the tray and call page read only that account's rows, and Test Client One's seed has no `proposals` rows);
  - mutating specs on the fixture account only.
- **Placeholder scan:** no TBD or TODO. Values set "by reading node" (the Intl strings, `spokenPhone`'s form) are typed out by the implementer from the stated one-liner, never computed in an assertion. Task 1's test count is stated with its arithmetic and must be corrected in the report if the count differs.
- **Type consistency:**
  - `Proposal`, `ProposalKind`, `ProposalStatus`, `ExpiredReason`, `EvidenceRef`, `effectiveStatus`, `proposalExpiresAt`, `UNDO_WINDOW_MS`, `PROPOSAL_MAX_AGE_MS`, `SYSTEM_DECIDER` (Task 4) → Tasks 5–8;
  - `insertProposal(…, { evidenceRef, evidenceLang, expiresAt })` → Task 4 generator, Task 6, Task 10;
  - `decideProposal`, `revertProposalDecision`, `undoProposalDecision`, `expireAfterUndoCollision`, `expireProposals`, `restoreSiblings`, `setAppliedRef`, `listPendingSiblings`, `fillContactBlanksReport`, `deleteTaskForUndo` (Task 4) → Tasks 5, 6;
  - `KindDef`, `KINDS`, `kindOf`, `Description`, `Part`, `localDateKey`, `firstInstantOfLocalDay` (Task 5) → Tasks 6, 7;
  - `acceptSuggestion`, `discardSuggestion`, `undoSuggestion`, `DecideDeps`, `revalidateFor`, the four `…Action`s (Task 6) → Task 8;
  - `SuggestionView`, `buildSuggestionView`, `SuggestionActionResult`, `UndoResult`, `runDecision`, `SuggestionSection`, `data-suggestion`, `data-status` (Task 7) → Tasks 6, 8, 10.
- **Not executed:** nothing in this plan was run except the reads, the greps and the node one-liners named (the Intl strings; the Havana, Chicago and Beirut instants). Every name was read off `61772cac` except where an Assumption says otherwise.
