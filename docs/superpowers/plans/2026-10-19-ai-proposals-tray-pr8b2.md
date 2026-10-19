# The tray everywhere a suggestion is read, PR 8b-2 (S-14 + F-019, first release item 8, migrations 0089 and 0090): implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax. **Ceremony is tiered PER TASK** (owner, 2026-10-19, binding): read each task's tier before dispatching it.

**Goal:** the cards 8b-1 built show wherever a suggestion is read.
- The To do tray is grouped by customer, then by source.
- The agency Work page shows the same cards, with their actions, grouped by account and capped at 50 per account.
- The customer record's What's next card gains a flat "Waiting for you" section.
- Every accepted suggestion gets a timeline row with the accepter's person mark.
- A card links to the exact transcript turn.
- `call_proposals`, its mirror, its guard and the copy function are dropped.

It also folds in 8b-1's follow-ups:
- (1) a client-side rejection says to reload the page;
- (2) Undo gets a production smoke;
- (3) streamed-route locators are scoped to `<main>`;
- (4) the bridge-era tests go with the table.

**Spec:** `docs/superpowers/specs/2026-10-19-ai-proposals-review-tray-design.md` as on `main` at `8afbbd37`. This plan covers §5, §4.6 (the drop and its evidence), §7's 8b-2 strings, §8's 8b-2 tests and §10's 8b-2 line. P1–P22 are owner-approved and not reopened here. Every file:line below was read off this worktree at `8afbbd37`.

**Base:** `8afbbd37` (#273, 8b-1 merged). **0088 is on bis-ci and production: never re-apply.**
- `<WT>` = `C:\Users\danlo\bis-platform\.claude\worktrees\s15-8b2` (Git Bash: `/c/Users/danlo/bis-platform/.claude/worktrees/s15-8b2`), branch `feat/item8b2-work-tray`.
- `<SCRATCH>` = the orchestrator's session scratchpad. Each brief carries it literally.
- `<KIT8B1>` = `/c/Users/danlo/AppData/Local/Temp/claude/C--Users-danlo-bis-platform/8a8a7081-d1c5-4710-8a6f-a94d0f61efd1/scratchpad/s15c-kit` (`replica.sh`, `pgrst.sh`; read 2026-10-19).

Path abbreviations, as in the 8b-1 plan:
- `…/tasks/` = `apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/tasks/`
- `…/work/` = `apps/web/src/app/(dashboard)/dashboard/work/`
- `…/calls/[callId]/` = `apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/calls/[callId]/`
- `…/[contactId]/` = `apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/contacts/[contactId]/`
- `…/styleguide/` = `apps/web/src/app/(dashboard)/dashboard/styleguide/`

---

## The migration decision: two files. 0089 adds the agency read now; 0090 drops the bridge once the gap has closed

**Decision: split.**
- **`0089_agency_suggestions_read.sql`** is additive. It holds only the RPC `list_pending_proposals_for_agency(p_per_account int)`.
- **`0090_drop_call_proposals.sql`** is the drop. It holds a self-check of §4.6 evidence item 2, then drops `call_proposals`, its two triggers (they go with the table) and the three bridge functions.

This deviates from the spec's single "0089" (§1, §5.2, §4.6). The contents and the evidence are unchanged; only the file boundary moves.

**Why split, not one file applied after the gap:**
1. **The two have different gates.**
   - The RPC must exist before the code that calls it deploys (migration before code). It is safe to apply at any moment: 8b-1's running code never calls it.
   - The drop may be applied only after **2026-10-20T05:35:46Z** (8b-1's READY at 2026-10-19T17:35:46Z plus the owner-read 12 h skew age; ledger) **and** once §4.6's evidence holds.
   - In one file, the UI would be held hostage by the drop's evidence. A surprise in that evidence (an unexplained late write) would also block shipping placement work that has nothing to do with it.
2. **The drop does not depend on 8b-2's code.** 8b-1's code already reads and writes only `proposals`. The `call_proposals` hits in `apps` are the gateway feature's name and nothing else (`generate.ts:336`, `generate.fallback.test.ts:47,52`; §4.3's allow-list).
   - So 0090 can land on production before or after 8b-2's code.
   - If its evidence fails at merge time, Task 2's commit (0090 plus the bridge-era test edits, one commit by rule) is moved to a follow-up PR without touching 0089 or any UI. Because 0090 reaches bis-ci only after production's E1 and E2 read green (Task 10 step 5), a peeled-off 0090 has not reached bis-ci either, so bis-ci never runs ahead of `main`.
3. **The review is cleaner.**
   - 0089 is a small invoker function with a grants proof.
   - 0090 is the irreversible step, the "point of no rollback to pre-8b code" (§4.6).
   - Each gets its own md5, its own HIGH review and its own apply line in the ledger.

**Rollout order** (Task 10; corrected 2026-10-19 after the plan review):
1. 0089 to bis-ci, ALONE, as soon as it is reviewed.
2. 0089 to production at any time after that.
3. At or after **2026-10-20T05:35:46Z**, production's E1 and E2 are read. Only when they read green does 0090 go to bis-ci, then to production.
4. The PR's `e2e` is re-run.
5. Parity, then merge.

Why 0090 does not go to bis-ci early: bis-ci would then be ahead of `main`. The four bridge-era test files on `main` (and on every other lane) would fail any local run against bis-ci. And **(Assumption A9)** another lane's `supabase db push` may refuse a remote history holding a version its branch does not have.
- `ci-project-setup.yml`'s `push` applies whatever is pending. The 0089 push is therefore made from a ref that holds 0089 and NOT 0090: Task 1's commit, or a throwaway ref at it (`git push origin <task1-sha>:refs/heads/tmp/8b2-0089`, deleted after). The dry-run must list exactly the files intended.
- The branch's e2e migration check (`.github/scripts/ci-migrations-applied.sh`) needs both files on bis-ci, so the PR's `e2e` is red on that check until step 3. That is expected. `verify` (local stacks, all migrations) is the signal until then.
- **Do not enable auto-merge on this PR until 0090 is on production** (memory "Speed process": auto-merge on green). A green PR must not merge with an unapplied migration on `main`.

**The basis for bis-ci (the 8b-1 plan's note M15, `…pr8b1.md:349`):** on bis-ci the gap never closes. Every other branch's Preview runs pre-8b code against bis-ci until that branch merges `main`, so a `call_proposals` write can arrive at any time. Waiting for every such Preview to disappear is not a gate anyone can read. **Recommendation:**
- On bis-ci, the gate is evidence items **2** (every id copied; every decided row's status equal; 0090 enforces this itself) and **3** (the grep).
- Evidence item 1 is **recorded, not gating**: the counts and ids of rows written after the gap.
- The ledger line states that bis-ci's leftover `call_proposals` rows are test data from pre-8b Previews. A pre-8b Preview opened after the drop fails on its call and To do pages, on bis-ci only. That is the accepted cost.
- Production keeps all three items as gates.

This relaxes the spec's "on both projects" for bis-ci. **Owner answer, 2026-10-19: YES.** The copy check and the grep gate 0090 on bis-ci; "no late writes" (E1) is recorded only.

---

## Tiers (binding, per task)

| Task | What | Tier | Owner | Review |
|---|---|---|---|---|
| 0 | Base, install, pre-reads (orchestrator) | — | orchestrator | — |
| 1 | Migration 0089 (the agency RPC) and its proof | **HIGH** | bis-db-schema (opus) | brief, opus review with mutation probes on the replica, re-review; orchestrator applies once |
| 2 | Migration 0090 (the drop), its self-check, the four bridge-era test files, the teardown comment | **HIGH** | bis-db-schema (opus, second agent) | as Task 1 |
| 3 | Every new key, English and Spanish | LOW | bis-crm | none (end-of-PR review) |
| 4 | `@bis/db` reads: the agency read on the RPC, the record section's read, the `suggestions` timeline source | MEDIUM | bis-crm | one review (sonnet) |
| 5 | Web server side: the record's loaders, the timeline row and its mark, the grouping, the agency context read, the transcript link, the reload label | MEDIUM | bis-crm | one review (opus) |
| 6 | The UI: tray groups, agency cards, the record section, transcript anchors, the reload toast, pages, loading files | LOW | bis-frontend | none |
| 7 | Styleguide and i18n baselines | LOW | bis-frontend | none |
| 8 | The e2e spec | LOW | bis-e2e-qa | none |
| 9 | Whole-branch final review, design review, ONE fix agent | — | bis-reviewer (opus), bis-design-reviewer (opus), one fixer | checkpoint |
| 10 | Rollout | — | orchestrator | — |

**Order:**
- **Wave A:** Tasks 1, 2 and 3, all in parallel. They touch no shared file, and each bis-db-schema agent uses its own ports.
- **Wave B:** Task 4, after Tasks 1 and 3. It needs 0089 on its replica and `timeline.what.suggestions` in the catalogue.
- **Wave C:** Task 5, after Task 4.
- **Wave D:** Task 6, then Task 7, then Task 8.
- **Then:** Task 9, then Task 10.
- The orchestrator pushes after Task 2's review so CI `verify` applies both files on PostgreSQL 17 early.

---

## File map

| File | Task | Change |
|---|---|---|
| `packages/db/supabase/migrations/0089_agency_suggestions_read.sql` | 1 | new |
| `packages/db/src/test/proposals-agency-read.test.ts` | 1 | new |
| `packages/db/supabase/migrations/0090_drop_call_proposals.sql` | 2 | new |
| `packages/db/src/test/proposals-drop.test.ts` | 2 | new |
| `packages/db/src/test/proposals-bridge.test.ts` (357 lines), `call-proposals-grants.test.ts` (475 lines) | 2 | **deleted** |
| `packages/db/src/test/server-only-writes-grants.test.ts` | 2 | the seed at `:53-55` inserts into `proposals` directly. These go: the `call_proposals` rows at `:85`, `:156`, `:221` and `:249-250`, and the 0053 describe at `:311-342`. The 0088 describe's seed read (`:353`) is retargeted. The comment at `:179` that cites `call-proposals-grants.test.ts` is re-pointed |
| `packages/db/src/test/technician-scope.test.ts` | 2 | the `call_proposals` entries at `:28`, `:67` and `:76` go; the `proposals` case at `:78`, which reused `callProposal` (the mirrored twin), inserts into `proposals` directly with `contact_id` set |
| `packages/db/src/account-teardown.ts` | 2 | the paragraph at `:64-72` is rewritten in the past tense ("dropped by 0090"); it still names the table, so it stays on the allow-list |
| `packages/db/src/test/proposals-schema.test.ts:16` | 2 | the comment saying the old test "stays (the old table lives until 0089)" |
| comments citing the deleted test file: `automation-log-grants.test.ts:50`, `billing-schema.test.ts:109,248`, `record-event.test.ts:6`, `voice-web-sessions-grants.test.ts:19,42,49,66,188` | 2 | point at `proposals-schema.test.ts` (or say "the deleted 0040-era grants test") |
| `apps/web/src/lib/messages.ts` (+ one `describe` in `messages.test.ts`) | 3 | new keys. The deletion of `proposals.work.heading`/`.body` (`:3196-3197`) is Task 6's, once their reader is gone |
| `packages/db/src/proposal-rules.ts` | 4 | `AGENCY_PER_ACCOUNT = 50`, `WAITING_LIMIT = 5` |
| `packages/db/src/proposals.ts` | 4 | `listPendingProposalsForAgency` on the RPC (`:156-191`); new `listPendingProposalsForContact`; export the payload parser for `applied_payload` |
| `packages/db/src/record.ts` | 4 | `TimelineSource` adds `"suggestions"` (`:272-273`); new `TimelineEntry` kind `suggestion`; `listTimelinePage` gets `opts.suggestions` and returns `sources` (`:400-481`) |
| `packages/db/src/index.ts` | 4 | export the new read |
| `packages/db/src/test/proposals.test.ts`, `packages/db/src/test/timeline-merge.test.ts` (`:197`'s exact `toEqual` gains `sources`) | 4 | cases |
| mocked timeline pages that must carry `sources`: `apps/web/src/lib/record/loaders.test.ts:20`, `group-loaders.test.ts:26`, `…/[contactId]/page.test.ts`, `…/groups/[groupId]/page.test.ts`, `apps/web/src/app/api/accounts/[accountId]/contacts/[contactId]/summary/route.test.ts:36` | 4 | add `sources` (the drawer's route TEST changes; its UI and `route.reads.test.ts` do not) |
| `apps/web/src/lib/record/author-mark.ts` (`:26-75`), `timeline-rows.ts` (`:40-44`, `:66`, `:153-173`) | 4 | the exhaustive cases, so web typecheck stays green |
| `apps/web/src/lib/record/loaders.ts` | 5 | `loadTimeline` (`:51-82`) passes `suggestions: true` and reads the stage names softly; new `loadWaitingSuggestions` |
| `apps/web/src/lib/proposals/group.ts` (+ test) | 5 | new: `groupSuggestions`, `groupByAccount` |
| `apps/web/src/lib/proposals/view.ts` (`:22`, `:28-44`, `:180`), `view-reads.ts` | 5 | `transcript` link; `reload` label; `crashed` → the reload sentence; `readAgencySuggestionContext` |
| `apps/web/src/components/proposals/*` | 6 | `suggestion-group.tsx`, `suggestion-row.tsx` (new); section, card, actions, handlers |
| `…/tasks/page.tsx` (`:107-195`), `…/tasks/work-list.tsx` (`:444-451`), `…/tasks/loading.tsx` | 6 | groups |
| `…/work/page.tsx` (`:66-80`, `:86-145`), `…/work/agency-work-list.tsx` (`:208-294`, `:370-392`) + test | 6 | cards per account |
| `…/[contactId]/page.tsx` (`:96-125`, `:228-231`), `next-up-card.tsx`, `loading.tsx`, `page.test.ts` (`:274-279`) | 6 | the Waiting section |
| `…/calls/[callId]/transcript-view.tsx` (`:38-44`, `:84-99`) | 6 | `id="turn-{raw index}"` |
| `…/styleguide/page.tsx`, `apps/web/src/lib/i18n/{catalogue,ratchet}-baseline.json` | 7 | |
| `apps/web/e2e/suggestions-tray.spec.ts` | 8 | new (NOT `suggestions.spec.ts`; see Task 8) |

**Not touched:**
- `generate.ts`, `finish-call.ts`, `decide.ts`, `actions.ts` (the four actions already revalidate `/dashboard/work` and the record page, `decide.ts:292-300`).
- The contact drawer (`contacts/contact-drawer.tsx`, `api/…/summary/route.ts`): P20. Its read fence `route.reads.test.ts:72` (`MEASURED = 31`) must pass **unchanged**.
- The group page.

---

## Assumptions (each with its check)

- **A1** `evidence_ref.turn` indexes the transcript array exactly as `calls.transcript` stores it.
  - Read so far: `groundedTurn` (`grounding.ts:147`, of which `groundedEvidence` at `:164` keeps only the text) returns `transcript.findLastIndex(…)` over the array it is given. `finishCall` passes `state.transcript` (`finish-call.ts:932`), the same array it writes to the row (`:642`).
  - `TranscriptView` renders `usableTurns(transcript)`, a FILTERED copy (`transcript-view.tsx:38-44`), and keys by the filtered `i` (`:84-99`). The anchor must therefore carry the raw index.
  - Check: Task 5 reads `finishCallRow` to confirm it stores the array unchanged. Task 6's test renders a transcript with an empty turn before the cited one and asserts the anchor lands on the raw index.
- **A2** supabase-js `db.rpc(fn, args)` on a function that `returns setof public.proposals` accepts `.select(COLS)`. Check: Task 4's `withTestAccount` case on the replica's PostgREST.
- **A3** MCP `apply_migration` runs a file in one transaction. This was evidenced on production by 0088: its in-file self-check (`0088_proposals.sql:65-80`, `:260-269`) passed (ledger: "0088 APPLIED … MCP version 20261019173226"). 0090 nevertheless carries 0088's one-transaction proof (the `bis.m0090_xid` stamp; Task 2). A path that is not one transaction then fails before anything is dropped.
- **A4** A full document reload reaches the newest deployment, while `router.refresh()` from a skew-pinned tab fetches from the tab's own deployment. Check: Task 10's owner smoke step 6.
- **A5** No other lane has claimed migration number 0089 or 0090. Check: Task 0 runs `git log --all --oneline -- 'packages/db/supabase/migrations/0089*' 'packages/db/supabase/migrations/0090*'`, which must print nothing.
- **A6 (read, no longer an assumption)** `voice_profiles` has at most one row per account: `account_id uuid not null unique` (`0019_voice_core.sql:24`). `getVoiceProfile` reads it `.maybeSingle()` (`voice.ts:159-166`), so one batch read keyed by `account_id` is exact.
- **A7** Supabase grants EXECUTE on a new `public` function to `anon` and `authenticated` by default privilege. Check: Task 1's grants case. The revoke must name `public, anon, authenticated`, as `0080_document_requests.sql:185-187` does.
- **A9** Another lane's `supabase db push` (the CLI) may refuse to push when the remote history holds a version its own `migrations` folder lacks. This is why 0090 reaches bis-ci only when it can reach production the same day (Task 10). Check: none needed; the ordering avoids the case.
- **A8** A suggestion in production for the owner's smoke needs one real call to the BIS account's own line, as in the 8b-1 smoke (ledger 2026-10-19). Check: Task 10 step 6 reads `proposals` for a new pending row before the smoke.

---

## Global constraints (short form; the 8b-1 plan's "Global Constraints" section, `…pr8b1.md:144-271`, binds where this is silent)

- **Git:**
  - Never `git stash`, `git reset`, `git restore`, `git checkout`, `--amend`, `rm -rf` under `<WT>`.
  - Commit with `git commit -m "…" -- <every path>`; a deleted file is named in the path list.
  - Never push; the orchestrator pushes.
  - Commits end with the two trailer lines `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>` and `Claude-Session: https://claude.ai/code/session_013RThMy9QC8x7FZ94Lxib9p`.
- **Databases:**
  - **Until Task 10 has applied 0089 and 0090 to bis-ci**, no `@bis/db` vitest and no live web test runs against bis-ci. Each runs on your own PG18 replica, or is left to CI `verify`.
  - `packages/db/.env` and `apps/web/.env.local` do not exist in `<WT>`; never create either.
  - Only the orchestrator applies a migration anywhere but your replica.
- **The replica kit:** build `<SCRATCH>/s15d-kit/` from `<KIT8B1>` with `sed` and show the `diff`. Only these lines may differ:
  - `replica.sh:6` `WT=` becomes `<WT>`.
  - `replica.sh:31` skips `*0089_*|*0090_*`.
  - `replica.sh:36-41` apply `0089_agency_suggestions_read.sql`, then `0090_drop_call_proposals.sql`, each with `psql -1` and each only if present, and echo `post = pre + <the files applied>`.
  - `pgrst.sh:6` `SECRET=` becomes `s15d-local-postgrest-jwt-secret-not-used-anywhere-real-0000`.
  - `pre` is everything through 0088.
- **Ports:** this lane uses **55680-55689** only.

  | Who | Postgres | PostgREST | gateway |
  |---|---|---|---|
  | Task 1 implementer, then Task 1 reviewer | 55680, then 55681 | — | — |
  | Task 2 implementer, then Task 2 reviewer | 55682, then 55683 | — | — |
  | Task 4 implementer, then Task 4 reviewer | 55684, then 55687 | 55685, then 55688 | 55686, then 55689 |
  | Task 9 reviewer | 55681 (after Task 1's review stops it) | 55688 | 55689 |

  Stop your own kit only, exactly as `…pr8b1.md` "The replica kit" says.
- **Faithfulness:** the client-write digest on `pre` must equal bis-ci's. Task 0 reads it (expected `51|0dd3e2d7e19f3f3649a893cfd9967d94`, the value after 0088, ledger). Neither migration may change it on `post`.
- **SQL byte rules for 0089 and 0090:**
  - ASCII only, no backslash anywhere (memory "MCP SQL escapes").
  - `$` only in `$$` pairs.
  - `set search_path = ''` and every name schema-qualified.
  - No `cascade` anywhere: a hidden dependency must fail the drop loudly.
  - No `begin;`/`commit;` wrapper.
- **Tests must be able to fail:**
  - Each named mutation is run by the implementer, who pastes the failing assertion line and reverts by hand (prove it with `cmp`).
  - The "Vacuous test shapes" memory applies.
  - Every account-scoped read has a second-account case in which the OTHER account holds matching rows.
- **`@bis/db` mocks:**
  - Pure values come from `@bis/db/proposal-rules` only.
  - No import-time `@bis/db` value read under `lib/proposals/` or `components/proposals/`.
  - Task 5 and Task 6 each run the bare-factory grep from `…pr8b1.md:181-192`, widened to the pages they touch: `…/tasks/`, `…/work/` and `…/[contactId]/`. They list every `@bis/db` value the new graph calls, and add each one to the factory.
- **Copy:**
  - Every string goes through `tr.text(key, params)` with an `.es` twin in the same commit. Spanish is **usted**.
  - No JSX literal copy.
  - No plumbing words ("proposal", "RPC", "server", "model", "payload").
  - The persona is always `{persona}`, never a hard-coded "Sofía" in a key.
  - `apps/web/src/lib/messages.ts` is **Task 3's only**. A later task that finds a key missing STOPS and reports it.
- **Running tests:**
  - Only the affected files, by path.
  - `pnpm --filter web typecheck` and `pnpm --filter @bis/db typecheck` must be green at every commit.
  - Run eslint on the touched files.
  - Never run the gates or Playwright beyond `--list`.
  - Never pass a folder containing a live test to vitest (`decide.live.test.ts`, `weekly-metrics.live.test.ts`, `f/[publicId]/actions.returning-lead.test.ts`).
- **e2e (follow-up 3):**
  - On every route with a `loading.tsx` (To do, Work, the record page, the call page), page-level locators are scoped to `page.getByRole("main")`. React 19.2's streamed reveal can briefly hold a hidden duplicate of the page (ledger :11329, closed PR #166, and the duplicate `<article>` in run 39283437434).
  - A card is addressed by `[data-suggestion="<id>"]` **inside** `main`.

---

## Task 0: Base and pre-reads (orchestrator)

- [ ] `git -C <WT> log --oneline -1`. It must print `8afbbd37`, unless `main` has moved; if it has, read `git log 8afbbd37..origin/main` and re-read every file:line in the File map. Run `pnpm install`. Check A5.
- [ ] Read-only MCP `execute_sql`, on **both** `tlbkbmlrfafquucsmsmm` and `odnobiodsftffphuuosz`:
  - `select max(version) from supabase_migrations.schema_migrations` (production: the 0088 apply, `20261019173226`).
  - The Faithfulness digest (`…pr8b1.md:301-311`).
  - Task 10's evidence queries E1 and E2, as a baseline for the ledger.
- [ ] Ledger line `8b-2 T0: …` with every value. Put the digest into Tasks 1 and 2's briefs.

---

## Task 1 (HIGH): Migration 0089, the agency read (bis-db-schema)

**Files:** create `packages/db/supabase/migrations/0089_agency_suggestions_read.sql` and `packages/db/src/test/proposals-agency-read.test.ts`.

**The function** (spec §5.2):
- Name and signature: `public.list_pending_proposals_for_agency(p_per_account integer) returns setof public.proposals`.
- `language plpgsql stable security invoker set search_path = ''`.
- Behaviour:
  - It raises `22023` when `p_per_account` is null or below 1.
  - It returns the `proposals` rows (the table's own row type, every column, nothing added) with `status = 'pending' and expires_at > now()`.
  - Per account, it keeps the `p_per_account` newest by `row_number() over (partition by account_id order by created_at desc, id desc)`.
  - The result is ordered `account_id, created_at desc, id desc`.
- It is served by `proposals_account_pending_idx` (`0088_proposals.sql:149`).
- Grants: `revoke all on function public.list_pending_proposals_for_agency(integer) from public, anon, authenticated;` then `grant execute … to service_role;` (A7).
- The header carries:
  - why `security invoker` (only the service role runs it, and it bypasses RLS; nothing else may);
  - the apply order (bis-ci, then production, then parity; before the code that calls it);
  - the rollback (`drop function public.list_pending_proposals_for_agency(integer);` after the code is rolled back).

**Steps:**
- [ ] Build the kit (Global constraints). `pre` digest = Task 0's value.
- [ ] Write the tests first, `withRollback` on `post`, each with its mutation:
  1. "returns at most p_per_account pending rows per account, newest first, for every account at once". Three accounts with 3, 1 and 0 pending rows, with account ids chosen so A sorts before B (fixed uuids ending `…0a` and `…0b`), called with 2: rows A3, A2, B1 in that order. **Mutation:** `<= p_per_account` → `<` **FAILS**; drop the `partition by` **FAILS**.
  2. "leaves out a pending row past expires_at and every decided row". A pending row with `expires_at = now() - 1 minute`, one accepted, one dismissed, one expired; only the fresh pending row returns. **Mutation:** drop the `expires_at` filter **FAILS**.
  3. "a tie on created_at is broken by id, so the cap never returns a different row on a second call". Two rows with equal `created_at`, called with 1, twice: same id both times, the greater id. **Mutation:** drop `id desc` **FAILS** (assert the id, not the count).
  4. "refuses 0 and null". `22023` both times. **Mutation:** drop the guard **FAILS**.
  5. "only service_role may execute it". `has_function_privilege` is false for `anon` and `authenticated` and true for `service_role`; and `set role authenticated; select … ` raises `42501`. **Mutation:** `grant execute … to authenticated` **FAILS**.
  6. "it is security invoker with an empty search_path". `pg_proc.prosecdef = false`, and `proconfig` is `{search_path=""}`. **Mutation:** `security definer` **FAILS**.
- [ ] Faithfulness digest on `post` UNCHANGED. Run `proposals-schema.test.ts` and `schema-grants-guard.test.ts` on `post` → green.
- [ ] Byte check: `LC_ALL=C grep -nP '[^\x00-\x7F]|\\' 0089_*.sql` prints nothing. Record `md5sum`.
- [ ] Commit `db: one read for every account's pending suggestions, at most N per account (item 8b-2, migration 0089)`.

**Acceptance:** six cases green on `post`; each mutation fails by name; digest unchanged; md5 in the report.

**Review (HIGH):** opus bis-reviewer on 55681. It re-runs three probes of its choosing (one must be case 5's), checks the bytes, and reads `explain` for case 1's query to confirm the partial index is usable (a note, not a gate). A re-review follows any fix. The orchestrator applies it once (Task 10).

---

## Task 2 (HIGH): Migration 0090, the drop, and the bridge-era tests (bis-db-schema, second agent)

**Files:** create `0090_drop_call_proposals.sql` and `packages/db/src/test/proposals-drop.test.ts`. Delete `proposals-bridge.test.ts` and `call-proposals-grants.test.ts`. Edit the bridge-era test files, the teardown comment and the comment citations exactly as the File map says. **Everything in ONE commit**: CI `verify` applies 0090, so a commit with 0090 and without the test edits is red.

**The file:**
1. **One `do` block:**
   - `set_config('lock_timeout','5s',true)`, and `set_config('bis.m0090_xid', txid_current()::text, true)` (0088's pattern, `0088_proposals.sql:65-80`).
   - `lock table public.call_proposals in access exclusive mode`.
   - **Evidence item 2, enforced:**
     - count the `call_proposals` ids with no `proposals` row (`missing`);
     - count the `call_proposals` rows with `status <> 'pending'` whose `proposals` twin's status `is distinct from` theirs (`differ`);
     - if either is non-zero, `raise exception '0090_not_copied: % missing, % differ', missing, differ using errcode = 'P0001'`.
   - A pending `call_proposals` row whose twin the new code decided is expected, never a difference. Production holds two such rows from the 8b-1 smoke: f59881f9 accepted, 78281abd edited.
   A second `do` block raises `0090_not_one_transaction` unless the stamp equals `txid_current()`, `lock_timeout` reads `5s`, and `pg_locks` shows this backend holding `AccessExclusiveLock` on `call_proposals`. A path that commits between statements therefore fails before any drop (A3).
2. `drop table public.call_proposals;`. This takes `call_proposals_guard`, `call_proposals_mirror`, 0053's and 0068's policies, its indexes and its constraints.
3. `drop function app.mirror_call_proposal(); drop function app.guard_call_proposal(); drop function app.copy_call_proposals();`
4. No `cascade` anywhere.
5. The header states:
   - that this is **the point of no rollback to pre-8b code** (spec §4.6);
   - that recreating the table means 0040 + 0053 + 0068's definitions plus 0088's rollback steps 2-3 (header `:28-53`), untested;
   - the gate: production only after 2026-10-20T05:35:46Z with evidence items 1-3 in the ledger; bis-ci on items 2 and 3.

**Steps:**
- [ ] Build your own kit (55682). `post` = pre + 0089 (if Task 1 has committed it; otherwise pre + 0090 alone) + 0090.
- [ ] `proposals-drop.test.ts` on `post`:
  1. "call_proposals and the three bridge functions are gone". `to_regclass('public.call_proposals')` is null; `to_regprocedure('app.copy_call_proposals()')` and the other two are null.
  2. "proposals, its trigger, its two policies and its six indexes (five, plus `proposals_pkey`) are untouched". Name each, read off `pg_trigger`, `pg_policy` and `pg_indexes`.
  3. "the client-write digest is unchanged".
- [ ] **The self-check, proven by the implementer on the replica (not vitest, which runs after the drop):**
  - Make `chk` from `pre` (+0089).
  - Inside one `psql -1` session: `alter table public.call_proposals disable trigger call_proposals_mirror`; insert a `call_proposals` row with no `proposals` twin; enable the trigger again; then `\i 0090_drop_call_proposals.sql`.
  - It must raise `0090_not_copied: 1 missing, 0 differ`, and `to_regclass('public.call_proposals')` must still be non-null after the rollback.
  - Repeat with a decided row whose twin's status differs: `0 missing, 1 differ`.
  - Paste both outputs. **Mutation:** delete the `differ` count from the check → the second run drops the table (paste that too, then revert).
- [ ] The retargets:
  - `server-only-writes-grants.test.ts`'s seed inserts `proposals` directly (`source 'call'`, `expires_at now() + interval '30 days'`), so `proposalId` keeps naming a row every remaining case reads.
  - Delete the `call_proposals` entries listed in the File map, and the `describe("0053: call_proposals_decision_complete")` block at `:311-342`.
  - `technician-scope.test.ts`: the `call_proposals` key (`:28`), seed (`:67`) and entry (`:76`) go. The `proposals` case (`:78`) reused `callProposal`, the mirrored twin, so it now inserts into `proposals` directly with `contact_id` set to the case's customer.
- [ ] Prove the one-transaction check: running 0090 through `psql` WITHOUT `-1` (autocommit) on a fresh `chk` raises `0090_not_one_transaction` and drops nothing. Paste the output.
- [ ] Run on `post`: `proposals-drop`, `proposals-schema`, `proposals`, `server-only-writes-grants`, `technician-scope`, `schema-grants-guard`, `record-event`, `automation-log-grants`, `billing-schema`, `voice-web-sessions-grants`. All green.
- [ ] `grep -rn "call_proposals" apps packages/db/src` → exactly the allow-list:
  - `packages/db/src/ai-gateway.ts:11`
  - `packages/db/src/test/ai-gateway-schema.test.ts:75`
  - `apps/web/src/lib/proposals/generate.ts:336`
  - `apps/web/src/lib/proposals/generate.fallback.test.ts:47,52`
  - the rewritten `account-teardown.ts` paragraph

  Paste it. This is evidence item 3's branch half.
- [ ] Byte check and md5. Commit `db: drop call_proposals, its mirror, guard and copy, after checking every row was copied (item 8b-2, migration 0090)`, with every path, the two deletions included.

**Acceptance:** the self-check refuses both seeded mismatches and drops nothing; the drop tests and every retargeted suite are green on `post`; the grep equals the allow-list; md5 is in the report.

**Review (HIGH):** opus on 55683. It re-runs the self-check's two refusals and one mutation of its own. It confirms no surviving test seeds or reads `call_proposals`. It confirms no SQL object outside `call_proposals` itself references the table: `select … from pg_depend` on `post` before the drop, and a `pg_proc.prosrc ilike '%call_proposals%'` scan of `pre` showing only the three bridge functions. A re-review follows any fix. The orchestrator applies it (Task 10).

---

## Task 3 (LOW): Every new key (bis-crm)

**Files:** `apps/web/src/lib/messages.ts`; one `describe` appended to `apps/web/src/lib/messages.test.ts` asserting each new key and its `.es` twin exist with the params named below.

| Key | English | Spanish (usted) |
|---|---|---|
| `suggestions.group.call` | {name} · from the call on {date} | {name} · de la llamada del {date} |
| `suggestions.group.noCustomer` | No customer yet | Sin cliente todavía |
| `suggestions.capAccount` | Showing the newest {n} for this account. | Se muestran las {n} más recientes de esta cuenta. |
| `suggestions.waiting.heading` | Waiting for you | Esperan su respuesta |
| `suggestions.waiting.seeAll` | Edit or see all in To do | Editar o ver todas en Pendientes |
| `suggestions.transcript` | See it in the transcript · {time} | Ver en la transcripción · {time} |
| `suggestions.transcript.noTime` | See it in the transcript | Ver en la transcripción |
| `suggestions.answer.unreachable` | That didn't reach us. Reload the page, then check before trying again. | No nos llegó. Recargue la página y revise antes de intentarlo otra vez. |
| `suggestions.reload` | Reload | Recargar |
| `timeline.suggestion` | accepted {persona}'s suggestion: {change} | aceptó la sugerencia de {persona}: {change} |
| `timeline.suggestionEdited` | accepted {persona}'s suggestion with changes: {change} | aceptó la sugerencia de {persona} con cambios: {change} |
| `timeline.suggestion.original` | Suggested: {change} | Se sugirió: {change} |
| `timeline.what.suggestions` | accepted suggestions | sugerencias aceptadas |

- Do NOT delete `proposals.work.heading`/`.body` here: `agency-work-list.tsx:379-380` still reads them, so typecheck would go red. Task 6 deletes them in the same commit that removes that reader, as the only `messages.ts` writer at that time.
- Agency card and record-row words reuse 8b-1's `suggestions.*` keys (`suggestions.accept`, `suggestions.discard`, `suggestions.loadFailed`, `common.retry`, `common.undo`).
- [ ] `pnpm --filter web exec vitest run src/lib/messages.test.ts src/lib/i18n/` and typecheck. Commit `copy: the grouped tray, the agency cap, Waiting for you, the transcript link, the reload answer and the suggestion timeline row, English and Spanish (item 8b-2)`.

---

## Task 4 (MEDIUM): `@bis/db` reads and the timeline source (bis-crm)

**After:** Tasks 1 and 3. **Kit:** 55684/55685/55686, `post` with 0089 (and 0090 if committed).

**Files:**
- `packages/db/src/proposal-rules.ts`, `proposals.ts`, `record.ts`, `index.ts`;
- `packages/db/src/test/proposals.test.ts`, plus the `listTimelinePage` test file (`grep -ln "listTimelinePage" packages/db/src/test`);
- `apps/web/src/lib/record/author-mark.ts`, `timeline-rows.ts`, the three "all failed" lines (`loaders.ts:63`, `:108`, `group-loaders.ts:149`) and their tests;
- every mocked timeline page in the File map's `sources` row (without `sources`, `page.sources.length` throws a TypeError in `loadRecent`'s tests).

**What:**
1. **`listPendingProposalsForAgency(db, now?)`** (`proposals.ts:156-191`):
   - **PostgREST caps every response at `max_rows = 1000`** (`packages/db/supabase/config.toml:18`), the RPC included. With 51 per account, past about 19 busy accounts the later accounts would be cut off silently, with `accountCapped` false. So the read PAGES with `.range(from, from + 999)` over the RPC's own order (`account_id, created_at desc, id desc`) until an EMPTY page. That is `billing.ts:145-160`'s precedent: a page shorter than asked is not proof of the end under a lower `max_rows`. A hard stop after 20 pages throws (fail closed: the page's existing catch turns it into no suggestions section, logged).
   - Each page calls `db.rpc("list_pending_proposals_for_agency", { p_per_account: AGENCY_PER_ACCOUNT + 1 }).select(COLS)` (A2). The read keeps the newest `AGENCY_PER_ACCOUNT` per account, and returns each row with `accountCapped: boolean` beside `brandName` and `timezone` (the field is additive, so `work/page.tsx` still compiles).
   - Asking for 51 to state a cap of 50 is the tray's own 201/200 shape (`proposals.ts:133-141`).
   - Rewrite the doc paragraph at `:153-155`: the cap is per account now.
2. **`listPendingProposalsForContact(db, accountId, contactId, now?)`:**
   - pending and `expires_at > now`, `.eq("account_id").eq("contact_id")`, newest first, `.limit(WAITING_LIMIT)`;
   - on the REQUEST client the caller passes (P14 through RLS);
   - throws on error; served by `proposals_account_contact_idx`.
3. **The `suggestions` timeline source** (spec §5.4):
   - `TimelineSource` and `TIMELINE_SOURCES` gain `"suggestions"`.
   - The new entry kind is `{ kind: "suggestion"; id; at: decided_at; contactId; suggestion: { proposal: Proposal; applied: <that kind's payload> | null } }`. `applied` is `applied_payload` parsed by the row's kind with the same `@bis/db/proposal-rules` parsers; null when it does not parse, and then the row describes `payload`.
   - The read: `status in ('accepted','edited')`, `forContacts`, `withTimelinePage(…, "decided_at", page)` (the `listContactChats` shape, `record.ts:351-365`), on `proposals_contact_decided_idx`.
   - It runs **only when `opts.suggestions === true`** (owner decision 1, 2026-10-19: not on the drawer or household timelines). `listContactTimelinePage`'s opts type (`record.ts:483-488`) widens to carry `suggestions`, because `loadTimeline` calls it, not `listTimelinePage`.
   - `TimelinePage` gains `sources: readonly TimelineSource[]`, the sources actually read. Every "all failed" comparison becomes `page.failed.length > 0 && page.failed.length >= page.sources.length`. The `> 0` is load-bearing: `listTimelinePage` returns early with no source read when `contactIds` is empty (`record.ts:406`), which the household page passes when the reader sees no members (`groups/[groupId]/page.tsx:96`, `:112`), and `0 >= 0` would turn that empty timeline into the error state. The early return names `sources: []`. Read 2026-10-19, there are three: `loaders.ts:63` (`loadTimeline`), `loaders.ts:108` (`loadRecent`) and `group-loaders.ts:149`. Without this, the drawer and the group page, which do not read the tenth source, could never reach their "every source failed" error state.
4. **Web, so typecheck stays green:**
   - `authorOf` gets `case "suggestion": return { kind: "person", personId: entry.suggestion.proposal.decidedBy }`, so the person mark is from the closed set and "Someone on the team" applies when unnamed.
   - `SOURCE_KEY` gets `suggestions: "timeline.what.suggestions"`.
   - `phrase` gets `case "suggestion"`. It calls `describeRow` (`lib/proposals/view.ts`) on the applied form, with `now = new Date(entry.at)` so a to-do never reads "Was due". The verb is `timeline.suggestion`, or `timeline.suggestionEdited` when the status is `edited`, with `{ persona, change }`. For `edited`, `detail` is `timeline.suggestion.original` with the original's `change`.
   - `timelineRows`' ctx gains an optional `suggestionStages` (`DescribeCtx["stages"]`, default `{}`). An unresolved stage reads the registry's honest sentence (`opportunity-stage.ts:32`).

**Tests (each with its mutation, run):**
- **Agency read:**
  - a stubbed client whose first page answers exactly 1000 rows, whose second answers 3 and whose third is empty: all 1003 are read, and the second page's account is present (**mutation:** read one page only → **FAILS**); a stub that never answers an empty page throws after 20 pages;
  - a per-account cap with `accountCapped` true for the account that had 51 and false for one with 50 (**mutation:** pass `AGENCY_PER_ACCOUNT` instead of `+ 1` → **FAILS**);
  - a quiet account still listed beside a busy one;
  - brand and zone per account (existing cases kept).
- **Record section read:**
  - account B's id with A's contact answers nothing while B has its own pending row;
  - a Technician (`withTestAccount`) reads none for an unassigned customer;
  - an aged row is left out;
  - at most 5, newest first.
  - **Mutation:** drop `.eq("account_id")` → the second-account case **FAILS**.
- **Timeline source:**
  - an empty contact set returns `{ items: [], older: null, failed: [], sources: [] }`, and the group loader reads it as an empty timeline, not an error (**mutation:** drop the `> 0` → **FAILS**);
  - `timeline-merge.test.ts:197`'s every-source-failing case asserts the exact `sources` too;
  - one row per accepted and per edited suggestion, at `decided_at`, none for dismissed, expired or pending;
  - an Undo (status back to pending) removes the row;
  - cursor paging across the boundary;
  - the source is absent unless `opts.suggestions`;
  - `sources` names what was read;
  - a failed suggestions read is named in `failed`, and the other nine still render.
  - **Mutation:** read `status = 'accepted'` only → the edited case **FAILS**.
- **Web** (`author-mark.test.ts`, `timeline-rows.test.ts`):
  - person mark, named, "You" for the viewer, "Someone on the team" unnamed (**mutation:** `kind: "ai"` → **FAILS**, spec §8.3 :386);
  - the English and Spanish verb with the persona's name typed out;
  - edited → "with changes" plus the original as detail;
  - a stage suggestion with no stage names reads the honest sentence.

- [ ] Run the touched `@bis/db` files on the replica (`env-run.sh` for `withTestAccount`), the web tests by path, both typechecks and eslint. Commit `db: every account's suggestions capped per account, a customer's pending suggestions, and accepted suggestions as timeline rows (item 8b-2)`.

**Review (MEDIUM):** sonnet bis-reviewer on 55687-55689. It runs the cases and two probes, one a second-account probe.

---

## Task 5 (MEDIUM): Web server side (bis-crm)

**After:** Task 4.

**Files:**
- `apps/web/src/lib/record/loaders.ts` (+ `loaders.test.ts`);
- `apps/web/src/lib/proposals/group.ts` (new, + test);
- `apps/web/src/lib/proposals/view.ts` (+ `view.test.ts`);
- `apps/web/src/lib/proposals/view-reads.ts` (+ a test file `view-reads.test.ts` if none exists).

**What:**
1. **`loadTimeline`** passes `{ suggestions: true }`. After the page read, a soft `readSuggestionStages(db, accountId, <the suggestion entries' proposals>)` joins the existing three soft reads (`loaders.ts:65-80`); a failure means `{}`, logged. The load returns `suggestionStages`. `loadRecent` (the drawer) and the group loader do **not** pass `suggestions` (P20). Their only change is Task 4's one "all failed" line.
2. **`loadWaitingSuggestions(db, accountId, contactId, now)`** → `{ status: "ready"; rows; stages } | { status: "error" }`.
   - It never throws, and logs the card name and account only.
   - It runs `listPendingProposalsForContact`, then `readSuggestionStages` only when a stage row is present.
   - The persona is NOT read here: the page reuses `timeline.personaName` (one query for the section, spec §5.3).
3. **`group.ts`:**
   - `groupSuggestions(rows: Proposal[], views: Map<id, SuggestionView>, ctx: { tr; zone; contactNames; callsById })` → `SuggestionGroup[]` = `{ key: string; heading: string; views: SuggestionView[] }`.
   - The key is `(contactId ?? "none", source, callId)`. The customer is **the row's `contact_id`** (P14's customer).
   - The heading is `suggestions.group.call` with the customer's name, or `suggestions.group.noCustomer` as `{name}`, and the call's day formatted as `buildSuggestionView`'s source label formats it (`view.ts:130-131`).
   - Groups are ordered by their newest card; cards inside a group keep the read's order (newest first).
   - `groupByAccount(rows)` groups the agency rows by `accountId` (accounts ordered by their newest card), each with its `brandName` and `accountCapped`.
4. **`view.ts`:**
   - `SuggestionView` gains `transcript: { href: string; label: string } | null`.
     - When `evidenceRef.turn` is an integer ≥ 0 and the row has a call: `href` is `/dashboard/accounts/{accountId}/calls/{callId}#turn-{turn}`. `label` is `suggestions.transcript` with `{time}` = the elapsed time since the call's start, `m:ss`, from `evidenceRef.at − callStartedAt`; `suggestions.transcript.noTime` when either instant is missing or the difference is negative.
     - A copied row (`evidenceRef` `{}`) links to the call page with `noTime`.
     - `buildSuggestionView`'s ctx gains `onCallPage?: boolean`. On the call page the href is just `#turn-{turn}`, and a copied row gets no link at all.
   - `labels.crashed` reads **`suggestions.answer.unreachable`** (`view.ts:180`; follow-up 1). Add `labels.reload` (`suggestions.reload`).
5. **`view-reads.ts` → `readAgencySuggestionContext(db, rows)`** (the agency page's service client):
   - per account present: `readSuggestionStages(db, accountId, thatAccountsRows)` (bounded by the accounts with a stage row);
   - ONE `voice_profiles.select("account_id, persona_name").in("account_id", ids)` (A6);
   - ONE `calls.select("id, account_id, started_at, contact_id").in("id", callIds)`.
   - It throws on a read error (the section's error state); the persona read alone is soft ("Sofía").

**Tests (with mutations):**
- **Grouping:**
  - two customers and a no-customer row → three headings in newest-first order, the Spanish heading typed out;
  - two calls for one customer → two groups;
  - the customer is the row's `contact_id` even when the call's contact differs.
  - **Mutation:** order groups by oldest → **FAILS**.
- **Transcript link:**
  - turn 4 at 2:14 after the start → `#turn-4` and "· 2:14" in English and Spanish;
  - no `at` → `noTime`;
  - a copied row → the call page, `noTime`; on the call page → no link.
  - **Mutation:** compute the time from `createdAt` → **FAILS**.
- **Labels:** `labels.crashed` equals the typed-out reload sentence in both languages (**mutation:** back to `maybeFailed` → **FAILS**).
- **Loaders:**
  - `loadWaitingSuggestions` returns `error` on a throw and never throws (**mutation:** rethrow → **FAILS**);
  - `loadTimeline` passes `suggestions: true` and `loadRecent` does not (**mutation:** pass it in `loadRecent` → **FAILS**).
- **Agency context:**
  - one voice-profile read for three accounts (assert the call count and its `.in` ids);
  - a failed persona read → "Sofía", not the error state;
  - a failed stage read → the error state.

- [ ] Typecheck, eslint, the touched tests by path. Commit `web: grouped suggestions, the agency's per-account context, the record's Waiting read and the timeline's stage names, and the transcript link (item 8b-2)`.

**Review (MEDIUM):** opus bis-reviewer (source and tests; no replica needed). Hunt:
- a read without its account filter;
- a `serviceDb` outside the agency page and `lib/proposals/actions.ts`;
- the drawer's loader touched;
- a log carrying a title, a value or evidence.

---

## Task 6 (LOW): The UI and the pages (bis-frontend)

**After:** Task 5. No per-task review (covered by Task 9). This task also deletes the two `proposals.work.*` keys (Task 3's note), sequentially, being the only `messages.ts` writer at that time.

**What, per surface:**
- **Tray** (spec §5.1):
  - `SuggestionSection` takes `groups: SuggestionGroup[]` (the call page keeps passing one ungrouped stack: an optional `views` path stays).
  - Each group is `suggestion-group.tsx`: an `<h3>` in `MONO_LABEL` over its cards, never a card around cards (P12).
  - `…/tasks/page.tsx` builds the groups after the views (`:177-195`); `work-list.tsx:444-451` passes them.
  - The cap line and the error state are unchanged. The focus rule (a decided card leaves; the next card's Accept takes focus) must still hold across a group boundary.
- **Agency** (spec §5.2):
  - `…/work/page.tsx` uses `readAgencySuggestionContext` and `buildSuggestionView` per row, in that row's account zone. The locale is `requestLocale({ account: null, isOperator: true, userLanguage: prefs.language })`.
  - `agency-work-list.tsx` replaces `AgencyProposalRow` (`:235-294`) and the read-only section (`:370-392`) with one `<section>` per account: the account's brand name as its mono heading, then that account's groups as in the tray, then `suggestions.capAccount` (`{n}` 50) when `accountCapped`.
  - Actions are bound `acceptSuggestionAction.bind(null, accountId)` (etc.) per account section, `.bind`, never closures.
  - The `#call-proposals` link rows and `agencyDescription`'s fallback go. The empty state (`:327-345`) and the bucket sections are unchanged.
  - **No-contamination:** the proposals still never reach `bucketAgencyWork`. The existing test stays and is retargeted.
- **Record** (spec §5.3):
  - `…/[contactId]/page.tsx` adds `loadWaitingSuggestions` to the `Promise.all` (`:96-125`) and builds the views after it (`personaName` from `timeline.personaName ?? "Sofía"`).
  - `NextUpBody` gains an optional `waiting` prop. Only the record page passes it; the drawer and the group page do not.
  - The section renders ABOVE the rows:
    - `suggestions.waiting.heading` as a mono label;
    - each row as `suggestion-row.tsx` (the change, the evidence `<q lang>`, the persona mark, dot and word), separated by `--row-line` rules, never a glass card (DESIGN.md "never a glass card inside the glass sheet");
    - each row's actions are `SuggestionActions` with `variant="row"`: **ghost** Accept and Discard only, no Edit and no primary (DESIGN.md rule 8, "A flat suggestion row inside a record card has no primary at all");
    - then the link `suggestions.waiting.seeAll` to `/dashboard/accounts/{id}/tasks`.
  - States:
    - Empty: nothing at all.
    - Error: one line `suggestions.loadFailed` with `common.retry`; the What's next rows still render.
    - When What's next's own read fails, the card's error stands and the section is not shown (spec ambiguity 7).
    - Loading: the record page's `loading.tsx` gives the next-up card two flat skeleton rows above its own.
  - `page.test.ts:274-279`'s fence gains `listPendingProposalsForContact` by name.
- **Timeline:** the row renders through the existing `ActivityTimeline` from Task 4's `TimelineRow`. Pass `suggestionStages` into `timelineRows` (`page.tsx:184-187`).
- **Transcript:**
  - `transcript-view.tsx` keeps each turn's RAW index through `usableTurns` (A1) and puts `id="turn-{raw}"` with `scroll-mt-20` on its `<li>`.
  - The card renders `view.transcript` as a link under the evidence (ghost text link, `min-h-11 md:min-h-8`).
  - The call page passes `onCallPage: true`.
- **Client rejection** (follow-up 1):
  - `runDecision` (`suggestion-handlers.ts:30-74`) takes a `reload: () => void` dependency.
  - On a throw from `act()` or `undo()`, `toast.error(say(labels.crashed), { action: { label: say(labels.reload), onClick: reload } })`.
  - `suggestion-actions.tsx` passes `() => window.location.reload()`, never `router.refresh()` (A4).
  - The server's own `maybeFailed` answer (a write that may have landed, `decide.ts:163`, `:262`) is unchanged.

**Tests** (`renderToStaticMarkup`, no jsdom, as 8b-1):
- groups render `<h3>` headings with no element wrapping the cards in a card class;
- one primary per card in the tray and on the agency page;
- **zero** primary buttons in a flat row and exactly two ghost buttons;
- `lang` on the section, on the English title and on the evidence;
- the capped account's line;
- the Waiting section's error line beside rendered What's next rows;
- the drawer's `NextUpBody` call site renders no Waiting section;
- `route.reads.test.ts` passes unchanged (`MEASURED = 31`);
- the transcript anchor on the raw index;
- `runDecision`'s reload action: the injected `reload` is called on click (**mutation:** drop the action → **FAILS**).

Every mutation is named in its test's title and run.

- [ ] The bare-factory grep (Global constraints) and its additions. Typecheck, eslint, the touched tests by path, `src/lib/i18n/`. Commit `ui: the To do tray grouped by customer and call, the same cards on the agency Work page per account, Waiting for you on the record, transcript turns linked, and a reload answer when the page can't reach the server (item 8b-2)`.

---

## Task 7 (LOW): Styleguide and baselines (bis-frontend)

- [ ] `…/styleguide/page.tsx`:
  - the flat row in all five states, in English, Spanish and the pseudo-locale;
  - a two-group tray specimen;
  - the agency account section with its cap line;
  - the transcript link.
  - Reuse `suggestion-specimens.ts`.
- [ ] Regenerate the i18n baselines (the command in `ratchet.test.ts`'s header). The diff adds only the Task 3 keys and removes `proposals.work.*`. Read it line by line.
- [ ] `pnpm --filter web exec vitest run src/lib/i18n/ src/lib/messages.test.ts "<styleguide test if any>"`, then typecheck. Commit `styleguide and i18n baselines for the grouped tray, the flat row and the agency section (item 8b-2)`.

---

## Task 8 (LOW): The e2e spec (bis-e2e-qa)

**Files:** create `apps/web/e2e/suggestions-tray.spec.ts`.
- A NEW file, so it never collides with lane B's edit of `suggestions.spec.ts` (branch `fix/e2e-flakes-oct19`, ledger 2026-10-19).
- If Task 6's grouping breaks a locator in `suggestions.spec.ts`, STOP and report rather than edit it. The orchestrator sequences it after lane B merges.

**Rules:**
- Fixture account only (`readClientFixture()`, `support.ts:103`); skip with a reason when null.
- Serial mode, as `suggestions.spec.ts:56`.
- Every page-level locator is inside `page.getByRole("main")`, and cards are addressed as `main.locator('[data-suggestion="<id>"]')` (follow-up 3).
- `afterAll` deletes every seeded call (its suggestions cascade), task, contact and deal, checks each `error`, and re-reads.

**Seed:**
- two contacts, A (blank phone) and B;
- one call per contact, with a transcript array whose cited caller turn is at index 3, preceded by one empty turn (A1);
- suggestions through `insertProposal` with `evidenceRef { turn: 3, at }`: A gets a phone and a to-do; B gets a to-do; plus one to-do with no contact on a third call.

**Tests:**
1. **To do, grouped:** three group headings in newest-first order, "No customer yet" among them; each card under its own heading.
2. **Record, Waiting for you:**
   - on A's record, the section lists A's two rows and no Edit button;
   - ghost Accept on the phone → toast → the timeline shows "accepted Sofía's suggestion: Phone" with the person mark "You";
   - **Undo** from the toast → the timeline row is gone and the row is back.
3. **Agency Work page** (the agency admin session, as `work-queue.spec.ts:129`): the fixture account's section (by its brand name), Accept B's to-do there → a `tasks` row with that title exists.
4. **Transcript:** the phone card's link reads "See it in the transcript · " plus `m:ss` and points at `#turn-3`; on the call page `#turn-3` holds the cited words.
5. **Spanish:** on A's record with `?locale=es`: "Esperan su respuesta", "Aceptar"; the evidence keeps its `lang`.
6. **360 px, `?locale=pseudo`:** no element inside the Waiting section or a tray group overflows (the `overflow-check.ts` helper, skipping `.sr-only`, as 29d9e51d).

- [ ] `pnpm --filter web exec playwright test --list e2e/suggestions-tray.spec.ts`, typecheck, eslint. Commit `e2e: the grouped tray, Waiting for you with Undo and its timeline row, the agency Work page accepting, the transcript link, Spanish and 360 px (item 8b-2)`.

---

## Task 9: Final review, design review, one fix agent (checkpoint)

- [ ] **bis-reviewer, opus, fresh context, on `git diff 8afbbd37...HEAD`** (replica 55681/55688/55689). Read spec §4.6, §5, §7, §8 and §10, and this plan. Run every touched test file by path, both typechecks, the db suites Tasks 1, 2 and 4 named on `post`, and three probes of its own choosing: one in 0090's self-check, one second-account probe, one primary-count probe on the flat row. Re-check both md5s. **Hunt:**
  - the drawer or group page reading suggestions (P20, §5.3);
  - an agency card in the wrong account zone or with a closure-bound action;
  - a `call_proposals` hit outside the allow-list;
  - a `cascade` in 0090;
  - a timeline row marked AI;
  - a log carrying words;
  - an e2e locator outside `main` on a streamed route;
  - a vacuous test (memory).
- [ ] **bis-design-reviewer, opus**, on Task 6 and 7's UI diff, with a running build if the orchestrator provides one (the Playwright MCP failed to connect this session; source audit otherwise). Check:
  - the DESIGN.md definition of done;
  - rule 8 (review stacks; no primary in the flat row);
  - "never a glass card inside the glass sheet";
  - both themes and the blur fallback;
  - 360 px pseudo;
  - **the group heading versus the card's own source label repeating it** (spec ambiguity 2: keep, or drop the card's label inside a group).
- [ ] **ONE fix agent** takes both reports' Critical, Important and agreed Minor items. Then one sonnet fix-review. **0089 and 0090 go to bis-ci only with their reviewed md5s UNCHANGED**, or with a re-review of any change.

---

## Task 10: Rollout (orchestrator)

Each step reads its own evidence; nothing is inferred from an earlier run.

- [ ] **1. bis-ci, 0089 ONLY** (after Task 1's review approves it; it need not wait for Task 9):
  - From a ref holding 0089 and not 0090 (the migration decision): `gh workflow run ci-project-setup.yml --ref tmp/8b2-0089 -f step=push-dry-run`. Its log lists exactly `0089_agency_suggestions_read.sql`. Then `-f step=push`.
  - Read-only MCP post-checks:
    - `select proname, prosecdef, proconfig, proacl from pg_proc where proname = 'list_pending_proposals_for_agency'`;
    - the digest is unchanged.
  - **One live call through PostgREST as the service role:** `serviceDb().rpc("list_pending_proposals_for_agency", { p_per_account: 51 })` from a local script on bis-ci's env (memory "Env secret reads": never parse an env value with code that can throw). It answers an array, not a PGRST202.
  - Delete `tmp/8b2-0089`. Ledger line.
- [ ] **2. Push and CI.** Read `verify` and `e2e` ON THE HEAD SHA (`gh api repos/{owner}/{repo}/commits/<sha>/check-runs`). `suggestions-tray.spec.ts` and `suggestions.spec.ts` must both have run. Then the local gates, one at a time, after checking that no `screenshots.yml` run is in progress.
- [ ] **3. Preview by hand** (bis-ci, a test account, never Test Client One):
  - the grouped tray;
  - the agency page with an account section;
  - the record's Waiting section and timeline row in both themes, English and Spanish, at 360 px;
  - a Technician sees Waiting rows only for an assigned customer.
- [ ] **4. Production 0089** (MCP `apply_migration`, `tlbkbmlrfafquucsmsmm`, name `agency_suggestions_read`, the exact reviewed text, ONCE). Pre-flight `max(version)` = Task 0's. Post: the `pg_proc` read as in step 1, plus one live call as the service role through MCP, in ONE `execute_sql`: `set local role service_role; select count(*) from public.list_pending_proposals_for_agency(51);`. It is read-only, and no production credential leaves Vercel. The PostgREST path on production is then proven after the merge (step 8): the production function logs for `/dashboard/work` show no `listPendingProposalsForAgency` error. Ledger: `0089 APPLIED … NEVER RE-APPLY`.
- [ ] **5. Production 0090, gated.** Not before **2026-10-20T05:35:46Z**: check `select now() >= '2026-10-20T05:35:46Z'::timestamptz` is true. Then, read-only:
  - **E1** (gate: `after_gap = 0`; `created_after_ready` is expected 0, because webhooks are not pinned and the old generator stopped at READY):
    ```sql
    select count(*) as total,
      count(*) filter (where created_at > '2026-10-19T17:35:46Z') as created_after_ready,
      count(*) filter (where decided_at > '2026-10-19T17:35:46Z') as decided_after_ready,
      count(*) filter (where created_at > '2026-10-20T05:35:46Z' or decided_at > '2026-10-20T05:35:46Z') as after_gap,
      max(greatest(created_at, coalesce(decided_at, created_at))) as last_touch
    from public.call_proposals;
    ```
  - **E2** (gate: `missing = 0` and `differ = 0`; the two rows the 8b-1 smoke decided in `proposals`, f59881f9 and 78281abd, are `pending` here and are NOT a difference):
    ```sql
    select
      (select count(*) from public.call_proposals c
        where not exists (select 1 from public.proposals p where p.id = c.id)) as missing,
      (select count(*) from public.call_proposals c join public.proposals p on p.id = c.id
        where c.status <> 'pending' and p.status is distinct from c.status) as differ,
      (select jsonb_object_agg(status, n) from (select status, count(*) n from public.call_proposals group by 1) s) as by_status;
    ```
  - **E3:** `grep -rn "call_proposals" apps packages/db/src` on `origin/main` returns the allow-list plus the four bridge-era test files (tests do not ship; no runtime code names the table). The same grep on the branch head returns the allow-list only (Task 2's paste). Both go in the ledger.
  - **If any gate fails:** do not apply anywhere; 0090 has not reached bis-ci either. Move Task 2's commit to a follow-up PR (spec ambiguity 11), record why, and merge with 0089 alone. The branch then holds no unapplied file, and bis-ci and production agree.
  - **Otherwise, in this order:**
    1. **bis-ci:** run E1 and E2 on bis-ci and write them in the ledger (E2 must be `missing 0, differ 0`; E1 is recorded only, owner decision 2). Then `ci-project-setup.yml --ref feat/item8b2-work-tray -f step=push-dry-run`, which lists exactly `0090_drop_call_proposals.sql`, then `-f step=push`. Its log shows no `0090_not_copied` and no `0090_not_one_transaction`.
    2. **Production:** `apply_migration` name `drop_call_proposals`, ONCE. A `0090_not_copied` or `0090_not_one_transaction` raise means nothing was dropped. Read the counts and STOP.
    3. **Re-run the PR's `e2e`**: its migration check now passes. Read it on the head SHA.
  - Post-check on both projects: `to_regclass('public.call_proposals')` is null; the three `to_regprocedure`s are null; the digest is unchanged. Ledger: `0090 APPLIED … NEVER RE-APPLY; point of no rollback to pre-8b code`.
- [ ] **6. Parity.** Runbook §5 (`docs/runbooks/ci-supabase-project.md:184-206`): `-f step=fingerprint` on bis-ci, and `packages/db/supabase/parity/fingerprint.sql` on production. Equal: no `call_proposals` on either, none of the three bridge functions on either, and the RPC's `prosrc` md5, `prosecdef`, `proconfig` and ACL. The documented cosmetic kinds may differ (8b-1 step 6). After the fingerprint, one more live call of the RPC as the service role on each project, as in steps 1 and 4.
- [ ] **7. PR and merge.** The PR body names:
  - P1–P22 (owner-approved);
  - the split decision and the bis-ci basis (owner decision 2, 2026-10-19);
  - the follow-ups folded in;
  - the deviations below;
  - E1–E3 for both projects;
  - both apply lines;
  - "No env var changes; nothing added to Preview".

  Merge only after 0090 is on production (or peeled off), with the head SHA's `verify` and `e2e` green: `gh pr merge <n> --squash --match-head-commit <sha>`.
- [ ] **8. After the deploy:**
  - The deployment is READY on the merge SHA and aliased to `app.bis-rgv.com` (ledger: READY time).
  - Smokes: `/` 200, `/sign-in` 200, `/api/cron/reminders` 401, `/b/bogus` 404.
  - **Owner smoke** on the BIS account (the smoke-identities rule; A8). First, one real call to the BIS line that makes at least two suggestions. Read-only check: `select id, kind, status, evidence_ref from proposals where status = 'pending' order by created_at desc limit 5` shows a `{turn, at}`. Then:
    1. **To do:** the suggestions sit under one heading naming the caller and the call's day.
    2. **The record:** open the caller's customer record. "Waiting for you" lists them, with ghost Accept and Discard and the "Edit or see all in To do" link. Switch the reader to Spanish (Preferences): "Esperan su respuesta".
    3. **Undo, in production** (follow-up 2): Accept one row and press **Undo in the toast within 10 seconds**. The row is back as Suggested, the written change is gone (the to-do deleted, or the field restored), and no timeline row remains. Read-only: `select status, undone_at, undone_by from proposals where id = '<id>'` → `pending` with `undone_*` set.
    4. **Timeline:** Accept it again (no Undo). The record's timeline shows "accepted Sofía's suggestion: …" with the owner's person mark ("You").
    5. **Agency Work page:** the BIS account's section lists the remaining suggestion as a card; Accept it there. It leaves the list, and the To do tray agrees on reload.
    6. **Transcript and reload:** "See it in the transcript · m:ss" opens the call at that turn. If a tab opened before this deploy is still around, an action in it shows "That didn't reach us. Reload the page…" with Reload, and Reload loads the new build (A4). This is not forced if no such tab exists.
  - **Tracker** (memory "Roadmap tracker"): item 8's **S-14 and F-019 → `done`**; F-022 stays open for 8c. Ledger line `8b-2 DONE`.
  - Ask the owner whether the To do page's streamed duplicate (follow-up 3) has recurred since lane B. It remains lane B's item.

---

## Deviations from the spec (each decided here; the spec's text is corrected in the final fix round's docs commit)

1. **Two files, 0089 and 0090, not one 0089** (§1, §5.2, §4.6). See the decision above.
2. **The bis-ci basis** for evidence item 1 (§4.6, §10 "on both projects"): recorded, not gating, on bis-ci. **Owner decision 2, 2026-10-19: yes.**
3. **Evidence item 2 is enforced inside 0090** (§4.6 lists it as a ledger check only). The file refuses to drop if it fails.
4. **The agency RPC is called with 51 to state a cap of 50** (§5.2 says `<= p_per_account`). The function is as specified; the caller asks for one more, as the tray does.
5. **`proposals.work.heading`/`.body` are deleted** (§7 kept them for the read-only agency page, which this PR replaces with cards).
6. **The `suggestions` timeline source is read on the customer record page only**, not by the drawer's Recent or the group page's timeline. **Owner decision 1, 2026-10-19: record page only.**

## Spec ambiguities resolved here (not owner-level unless marked)

1. **Owner-level, decided 2026-10-19 (owner decision 1: record page only):** does the drawer's Recent (and the household page's timeline) show accepted-suggestion rows? P20 says the drawer does not change in 8b, and 8a §7 treats its unchanged fence as proof. DESIGN.md says the drawer shows "the five newest timeline rows", and every earlier timeline source raised `MEASURED` (`route.reads.test.ts:72`). Default: record page only.
2. Inside a tray group, the card's own source label ("From the call on Tue, Oct 14 · Ana López") repeats the group heading. Default: keep the card unchanged (§4.5); the design review judges.
3. "See it in the transcript · 2:14": the time is elapsed since the call's start (`m:ss`), from `evidence_ref.at` minus `calls.started_at`. The turn index is the raw transcript index, not `TranscriptView`'s filtered one (A1).
4. A copied row (no turn) links to the call with no time, and shows no link on the call page itself.
5. The edited timeline row's wording: "accepted {persona}'s suggestion with changes: {change}", with "Suggested: {original}" as the detail.
6. Evidence item 3's "grep on main" is read on both `main` (runtime code) and the branch head (tests too); see E3.
7. When What's next's own read fails, the Waiting section is not shown (§5.3 states only the reverse).
8. "By customer" uses the row's `contact_id` (P14's customer); the card's source label still names the call's caller. They differ only where the fence-meaning count was non-zero (0 on production, 8b-1 Task 0).
9. The agency page's cards follow `requestLocale` for an operator: English unless the operator has their own language set.
10. The agency persona is per account (one batch read), never the agency's own.
11. If 0090's gate fails at merge time, the drop moves to a follow-up PR and 8b-2 ships with 0089 only. 0090 never reached bis-ci, so nothing is ahead of `main`. S-14 and F-019 then wait for that PR before `done`.

## Owner decisions (2026-10-19)

1. **Accepted suggestions in the contact drawer's five newest rows and on household and business timelines: NOT in 8b-2** (owner, 2026-10-19; the plan's recommendation). The `suggestions` source is read on the customer record page only. P20's drawer and its measured read fence (`MEASURED = 31`) stay unchanged. It may be revisited with Surface 6's "the same card in the drawer".
2. **bis-ci's 0090 gate: YES, relaxed** (owner, 2026-10-19). On bis-ci the copy check (E2, also enforced inside 0090) and the grep (E3) gate the drop. "No late writes" (E1) is recorded only, as test data from pre-8b Previews. Production keeps all three gates.

## Spec coverage

| Spec | Where |
|---|---|
| §5.1 tray grouped by customer then source; "No customer yet"; heading is a label | Tasks 5 (`group.ts`), 6, 8 test 1 |
| §5.2 agency cards with actions, per account, own zone, cap 50, the RPC | Tasks 1, 4, 5, 6, 8 test 3 |
| §5.3 Waiting for you: flat rows, ghost only, ≤ 5, link to tray, own boundary, phone order, one read, read fence by name, customers only | Tasks 4, 5, 6 (`page.test.ts:274-279`), 8 tests 2, 5, 6 |
| §5.4 the timeline source, person mark, words, edited detail, Undo removes it | Task 4, Task 5 (stages), Task 8 test 2 |
| §5.5 transcript anchors and the link; copied rows link to the call | Tasks 5, 6, 8 test 4 |
| §4.6 0089's drop (here 0090), evidence 1–3 on both projects | Task 2, Task 10 step 5; deviations 1–3 |
| §7 copy, usted, `{persona}` | Task 3 |
| §8.2 "the agency RPC returns at most `p_per_account` per account, none past `expires_at`" | Task 1 cases 1–2 |
| §8.3 :386 the timeline row is not the AI kind | Task 4 web case |
| §8.4 8b-2 e2e additions | Task 8 |
| §10 8b-2 rollout, owed smokes, tracker | Task 10 |
| 8b-1 follow-ups 1–4 | Task 5/6 (reload), Task 10 step 8.3 (Undo), Global constraints and Task 8 (`main`), Task 2 (bridge-era tests and the allow-list) |
