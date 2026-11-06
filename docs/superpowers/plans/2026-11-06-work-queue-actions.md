# F-077 part 1 — the work queue finishes what it shows: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Two of the three loose ends this part names become real rows on the To do queue, each with one inline action and a real undo. A failed transfer (a caller who asked for a person and never reached one) gets a derived "Waiting" row with **Done**, worded "Called back". A booking change Sofía made live (`ai_acts.kind` in `booking_created`/`booking_rescheduled`/`booking_cancelled`) gets a derived "Waiting" row with **Accept**. The third loose end, callbacks, already works and needs no code — only a regression test. Both new rows appear, read-only, on the agency-wide screen too.

**Architecture:** Two new, narrow, additive columns (migration 0114): `calls.transfer_followup_at` and `ai_acts.accepted_at`/`accepted_by`. Two new local functions in `packages/db/src/work-queue.ts` (`failedTransfers`) and `packages/db/src/ai-acts.ts` (`listPendingBookingActs`) extend `listAccountWork`'s existing `Promise.all` fan-out, producing the same `WorkRow` shape every other source already produces. Two pairs of compare-and-swap writers (`setTransferFollowedUp`/`clearTransferFollowup` in `voice.ts`; `stampAiActAccepted`/`unstampAiActAccepted` in `ai-acts.ts`) mirror the existing `stampAiActUndone`/`clearAiActUndone` shape exactly. Neither `calls` nor `ai_acts` grants `authenticated` any write at all (confirmed below — a spec correction), so both new server actions write through `serviceDb()` behind a request-client visibility proof (`callerCanSee`, widened), the same shape `setBookingStatusAction`/`proveBooking` already use for `bookings`, which has the identical grant shape. Both tables are explicitly outside F-115's `record_changes` Q1 set, so neither write uses `withAuthor`.

**Tech Stack:** PostgreSQL 17 (Supabase), supabase-js, Next.js App Router (server actions, server components), vitest, Playwright (bis-e2e-qa only).

**Spec:** `docs/superpowers/specs/2026-11-06-work-queue-actions-design.md`. Its §8 Owner rulings (2026-11-06) are BINDING: booking acts only (not contact-created/field-filled); a derived row only for a failed transfer (no stored task, no alert); Accept's own reversal reuses `common.undo`; no "Not now" on either new row; the failed-transfer button says "Called back"; migration number **0114**, held until F-115's 0113 is on production (≥ 2026-11-11). Every file and line below was read at `b3400794` on `feat/f077-work-queue`, in the worktree `/c/Users/danlo/bis-platform/.claude/worktrees/f077`.

## Global Constraints

- **Migration number 0114.** On 2026-11-06 the newest file in this worktree's `packages/db/supabase/migrations/` is `0112_record_changes_q1.sql` (confirmed: `ls … | tail -3` → `0110_contact_match.sql`, `0111_record_changes.sql`, `0112_record_changes_q1.sql`). F-115's own `0113_record_changes_enforce.sql` is reserved but does not exist as a file yet (gated to not-before 2026-11-11, per the user's own memory and the owner ruling). The implementer re-checks immediately before writing the migration: `git fetch origin main -q && git ls-tree --name-only origin/main packages/db/supabase/migrations/ | tail -3`. If a file numbered 0113 or 0114 already exists on `main` by then, renumber this plan's file (and every reference to "0114" below) in one commit; never edit 0111 or 0112.
- **Migrations reach bis-ci in number order** (`db:push:ci` refuses `--include-all`). This PR is built, reviewed and pushed now; `verify`'s own test run goes green against its fresh, from-scratch local stack (which applies every migration file present in the branch, 0001 through 0114, regardless of what bis-ci's remote history holds). The `e2e` job's SEPARATE migration-history check (`ci-migrations-applied.sh`) stays red, naming 0113 then 0114, until the orchestrator has pushed F-115's 0113 to bis-ci and then this plan's 0114 to bis-ci, in that order, both after 2026-11-11. That red is expected and does not mean the code is wrong — see the Orchestrator checklist. Because the repo's branch-protection ruleset requires BOTH `verify` and `e2e` green on the head SHA with no bypass actor, this PR mechanically cannot merge before the hold clears; the ruleset enforces the hold, not just orchestrator discipline.
- **`calls` and `ai_acts` are NOT in F-115's `record_changes` Q1 set.** Q1 (`docs/superpowers/specs/2026-11-02-record-history-design.md` §9, carried in `docs/superpowers/plans/2026-11-02-record-history.md`'s Global Constraints) is contacts (with tags and custom fields), households/businesses and their members, places, equipment, deals and relationships — explicitly NOT "To-dos or bookings," and `calls`/`ai_acts` are absent from that list entirely. Every write this plan makes therefore uses plain `(by: string)` / `"user"` columns, never `withAuthor`/`RowAuthor`.
- **Neither new write grants `authenticated` anything.** `calls`: migration `0020_voice_grants_revoke.sql` REVOKES `insert, update, delete, truncate, references, trigger on public.calls … from authenticated` (0019 had granted `select` only, and nothing since has re-granted a write — confirmed by `grep -rn "grant.*calls" packages/db/supabase/migrations/*.sql`, which returns only the one `select` grant). `ai_acts`: `0091_ai_acts.sql:117-119` grants `authenticated` `select` only; `insert, update, delete` go to `service_role` alone. Both new writes therefore run on `serviceDb()`, behind a widened `callerCanSee` (see Task 4) — see "Corrections to the spec," item 1.
- **No new SECURITY DEFINER function, no trigger edit.** `app.ai_acts_act_is_fixed()` (0091) checks exactly 11 named columns by `is distinct from`; it has no catch-all "anything else" branch, so the two new `ai_acts` columns are already free to move the instant they exist — see "Corrections," item 2. `definer-search-path.test.ts`'s pin (39 definers today, confirmed at that file's own header comment and `EXPECTED_DEFINERS`) needs no change.
- **Author/event shape:** `setTransferFollowedUp`/`clearTransferFollowup` emit no event (no write on `calls` emits one anywhere in this codebase today — `setCallOutcome`, `voice.ts:541-549`, is the standing precedent). `stampAiActAccepted`/`unstampAiActAccepted` also emit nothing, mirroring `stampAiActUndone`/`clearAiActUndone` exactly (`ai-acts.ts:149-168`).
- **Copy:** English and *usted* Spanish, every English key's `.es` twin on the very next line of `apps/web/src/lib/messages.ts` (the existing, scattered convention this file already follows — confirmed by the surrounding `work.*` keys, e.g. `work.done`/`work.done.es` adjacent). No milestone codes, no `{{template}}`, no arrows (`messages.test.ts`'s global `INTERNAL_MILESTONE` sweep covers every key in `m` unconditionally — this copy is operator-facing, not client-facing, but the sweep makes no such distinction and our new copy carries no codes regardless).
- **DESIGN.md:** tokens only; status is dot + word (unaffected — these two rows reuse the existing bucket chip, unchanged); reversible actions run at once with an Undo toast (rule 6; both new actions do); exactly one action per row SOURCE (`work-row-actions.tsx`'s own documented rule, line 10-21); whole-row click target and `data-contact-row`-style identity are unaffected (these are `WorkRow`s, identified by `data-work-row`, already handled generically).
- **Speed process:** the migration task is HIGH (full brief, implementer, a bis-reviewer pass with named mutation probes on the reviewer's OWN replica). The two DB-layer tasks and the web-actions task are MEDIUM (implementer plus one review). The two UI tasks are LOW-MEDIUM (implementer, folded review). e2e is MEDIUM. At most 2 lanes run at once.

## Rules for every agent (shared worktrees)

Worktree: `C:\Users\danlo\bis-platform\.claude\worktrees\f077` (Git Bash: `/c/Users/danlo/bis-platform/.claude/worktrees/f077`, branch `feat/f077-work-queue`, head `b3400794`). Start every Bash command with `cd /c/Users/danlo/bis-platform/.claude/worktrees/f077 && …`.

1. **Never** run `git checkout`, `git switch`, `git stash` (any form), `git reset`, `git rebase`, `git commit --amend`, `git add -A`/`git add .`, `rm -rf`, or a push. Commit only your task's named paths: `git add <paths>` then `git commit -m "<type(scope): what and why>" -- <paths>`. End every commit message with this plan's attribution lines (see the end of this document). If `.git/index.lock` exists, wait and retry; never delete it. Remove a worktree only with `git worktree remove`.
2. **Your own replica, never a Supabase project** — this applies to the migration task (T1) only; see its own Steps for the exact script. Binaries: `C:\Users\danlo\AppData\Local\Temp\claude\C--Users-danlo-bis-platform\88d51cd6-6c5b-4497-af8a-63647f233ba6\scratchpad\ca-t1\pg17\pgsql\bin` (confirm `postgres.exe --version` answers `17.6`). Driver script to copy: `C:\Users\danlo\AppData\Local\Temp\claude\C--Users-danlo-bis-platform\6aad36e9-1c5f-4846-8e5b-164fe1f316ea\scratchpad\rp\pg17-rp.sh`. Copy it into YOUR OWN scratchpad and edit exactly: `S` = your scratchpad; `D="$S/t1"`; the port, everywhere it appears, to **55996** (reviewer: **56096**); `W` = this worktree's path; the `init` skip pattern to `0114_*`; the `post` section to apply `packages/db/supabase/migrations/0114_work_queue_actions.sql`. PG18 (`C:\Program Files\PostgreSQL\18`) is NOT a substitute: production is PG17.
3. **This worktree has no `packages/db/.env` and no `apps/web/.env.local`** (confirmed: `ls packages/db/.env apps/web/.env.local` → both "No such file or directory"). Never create, copy or edit one. This means every test file that imports `withTestAccount` from `./fixtures` — `work-queue.test.ts`, `voice.test.ts`, `ai-acts.test.ts` all already do — **cannot be run inside this worktree**: `serviceDb()` throws on the missing env the moment such a test calls it. Write these tests, read them for correctness, and say so in your report; they are proven by CI's `verify` job only, read by the orchestrator FOR THE HEAD SHA. The migration task's `withRollback`-based schema tests (T1) are the one exception: they run against your own local PG17.6 replica with `SUPABASE_DB_URL=postgresql://postgres@localhost:<port>/post` on that one command line and no other Supabase variable in the shell, and they DO run inside this worktree.
4. Judge every vitest run by its own summary block (`Test Files … | Tests …`), never the exit code. `@bis/db` prints a trailing `ERR_PNPM_RECURSIVE_EXEC_FIRST_FAIL "Command vitest not found"` after the real results. A `-t` filter matching nothing skips silently — paste the summary showing the expected count.
5. **Red first, and the red is real.** Paste the failing assertion line, then the green summary line. Run each named mutation and show it failing BY NAME; if a mutation cannot fail, say so and substitute one that can.
6. Every TS task's green step also runs `pnpm --filter @bis/db typecheck` and/or `pnpm --filter web typecheck` and `pnpm --filter web lint` (0 errors). No component body calls `Date.now()` or a no-argument `new Date()`.
7. Before this PR pushes, the orchestrator runs these CI-scoped (repo-wide) gates once, not per task: `apps/web/src/lib/i18n/*.test.ts` (pseudo-locale, accents guard, document-lang), `apps/web/src/lib/consent/scans.test.ts`, and `apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/access-log-routes.test.ts` (Task 4 below adds four names to its existing `tasks/actions.ts` entry — missing that update fails this sweep by name, listing the four new exported actions as unclassified).
8. Stay inside your task's file list. A file another task owns is read-only to you; if you need it changed, stop and say so in your report.
9. e2e runs only on the per-run fixture account. `Test Client One` is READ-ONLY. Only bis-e2e-qa writes Playwright, and only the orchestrator runs the gates (`pnpm check`, `pnpm --filter web build`, `pnpm --filter web test:e2e`), one at a time.

## Corrections to the spec made while planning (the source wins)

1. **§4.2's grant claim is backwards.** The spec says `calls.transfer_followup_at` needs "no new grant needed, calls already grants UPDATE to authenticated per 0020's table-level grant, inherited by this column." Read directly, `0020_voice_grants_revoke.sql:8-10` does the OPPOSITE: `revoke insert, update, delete, truncate, references, trigger on public.phone_numbers, public.voice_profiles, public.calls from authenticated;`. No later migration re-grants a write on `calls` to `authenticated` (`grep -rn "grant.*calls" packages/db/supabase/migrations/*.sql` returns only 0019's `select`). `ai_acts` is the same shape (`0091_ai_acts.sql:117-119`: `authenticated` gets `select` only). This means `setTransferFollowedUp`/`clearTransferFollowup`/`stampAiActAccepted`/`unstampAiActAccepted` would all raise a grant-level `42501` if called on `dbForRequest()` (the request client), the way `completeWorkTask`/`reopenWorkTask` call `completeTask`/`reopenTask`. The fix is not a new grant; it is the pattern this codebase already uses for exactly this situation — `bookings` has the identical shape (`booking-grants.test.ts`: `authenticated` gets no UPDATE at all), and `setBookingStatusAction`'s own doc comment (`calendar/actions.ts:185-198`) states the fix: prove the row with the caller's own client (`proveBooking` → `callerCanSee`), then write with `serviceDb()`, re-scoped by `account_id`. Task 4 below follows this precedent for all four new writes, widening the existing, already-generic `callerCanSee`/`ProvableTable` (`apps/web/src/lib/auth/visible.ts:11,14-19`) rather than inventing a parallel mechanism. This also resolves Technician visibility correctly for free (see item 3) rather than needing a bespoke check.
2. **§4.2's "trigger change required" is unnecessary; no `create or replace` of `app.ai_acts_act_is_fixed()` ships in this migration.** Read directly (`0091_ai_acts.sql:93-108`), the function's body is an ALLOWLIST BY OMISSION: it raises only when one of eleven NAMED columns (`id, account_id, actor, call_id, chat_id, contact_id, kind, target, before, after, created_at`) is `is distinct from` its old value. It has no "anything else is forbidden" branch. `undone_at`/`undone_by`/`undo_notified` already move freely today not because the function was ever told about them, but because it was never told to FORBID them. The same is true of `accepted_at`/`accepted_by` the moment migration 0114 adds the columns: zero function edits are needed for Accept to work, and zero risk of accidentally reverting the function's `search_path` (which 0096 altered on this exact function, from the `''` the 0091 file's own CREATE text still shows, to `pg_catalog, pg_temp` — confirmed by reading `0096_definer_search_path.sql`'s own loop at lines 90-121, which alters every function in `public`/`app` that sets a search_path, definer or not, and whose `r.path = '""'` branch is exactly `app.ai_acts_act_is_fixed()`'s case). Had a `create or replace` genuinely been needed, it would have had to write `set search_path = pg_catalog, pg_temp`, not the `set search_path = ''` both the 0091 file text and the spec's own §4.2 snippet show — this is now moot, since the migration does not touch the function at all. A new test (Task 1, Step 5 below) still proves the function continues to protect `target`/`before`/`after` even when `accepted_at` moves in the SAME statement, by a mutation performed and reverted entirely inside the test's own transaction — not by shipping any function edit.
3. **§3.2's "Who may" undersells the real RLS, confirmed against 0068 and 0091.** For failed transfers, the spec says "anyone with account access who can see the call (RLS; today's `calls_tenant` policy)." `0068_mine_unassigned_technician.sql:109-121`'s generic loop ALSO creates a restrictive `calls_technician_scope` policy: `using (sees_all_customers(...) or contact_id in (select app.my_contact_ids()))`, with **no carve-out for `contact_id is null`** (unlike `tasks_technician_scope`'s own 4d case, which explicitly admits a contact-less task assigned to the Technician). A Technician who is not an Owner/Staff/agency member therefore sees **zero** failed-transfer rows whose caller is unidentified, even though Owner/Staff/agency see them. This is not a defect this part is asked to fix — it is the SAME scoping every other contact-keyed row (`conversations`, `bookings`, `notes`, …) already has from 0068 — but it must not be built around or silently relied on as "uniform visibility." For booking acts, `ai_acts_technician_scope` (`0091_ai_acts.sql:122-124`) is narrower-looking but correctly scoped: its `exists (select 1 from public.contacts c where c.id = ai_acts.contact_id)` subquery runs under the SAME caller's RLS, so it is really asking "can I also see this act's contact" via `contacts_technician_scope`'s own `assigned_to = me` restriction — `ai_acts.contact_id` is never null (confirmed, `0091_ai_acts.sql:62`), so this one is airtight. The widened `callerCanSee` (correction 1) enforces both automatically, since it reads through the real request client.
4. **No existing db-level compare-and-swap test exists to "mirror" for `stampAiActAccepted`,** contrary to the spec's "grep its own test for the exact pattern to mirror" instruction for `stampAiActUndone`. `grep -rn "stampAiActUndone\|clearAiActUndone" packages/db/src/test` returns nothing: both functions are exercised today only through a bare `vi.mock("@bis/db", …)` in `apps/web/src/lib/ai-acts/actions.test.ts`, which proves the WEB action calls them with the right arguments, never that the SQL itself is a real compare-and-swap. Task 3 below writes the first db-level CAS test for this shape from scratch, modeled on `setCallOutcome`'s own "throw on no match, account-scoped" test (`voice.test.ts:806-824`, the nearest genuine precedent) for the throwing half, and on the general "second call returns false" shape already established across this codebase's other CAS writers for the boolean half.
5. **`clearTransferFollowup`'s signature is incomplete in the spec's own prose.** §3.2 writes "**Undo:** `clearTransferFollowup(db, accountId, callId)` sets the column back to `null`, compare-and-swap on `transfer_followup_at = at`" — the explicit parameter list omits `at`, even though the very next clause requires comparing against it. This plan's Task 2 gives it the parameter the compare-and-swap needs: `clearTransferFollowup(db, accountId, callId, at: Date): Promise<boolean>`.
6. **§6 task-list item 7 (styleguide) does not apply, confirmed by reading the file.** `work-tray-demo.tsx` demos only the suggestion tray — `SuggestionSection`, `WaitingSuggestions`, `AgencySuggestionSection` — built from `buildSuggestionView`/`groupSuggestions`. It has never demoed a `WorkList`/`AgencyWorkList` task, conversation or booking row (no code path in that file touches `WorkList` at all). There is no established pattern to extend for the two new row kinds, and the spec's own task-list item 7 is explicitly conditional ("if the DoD's checkbox applies… confirm… before assuming it needs the addition"). Confirmed: it does not apply. Dropped from the task list below, not built.

## Deviations the spec leaves silent (resolved here, flagged for the owner)

- **Mine/Unassigned filtering on the two new sources.** The spec's §3.2/§3.3 never say whether `failedTransfers`/`listPendingBookingActs` honor `listAccountWork`'s `opts.assignee`. Today every one of the three existing sources (`openTasks`, `unansweredConversations`, `staleBookings`) honors it uniformly. Decided here: both new sources ALSO accept and honor the same `AssigneeFilter`, via the identical `contacts!inner(assigned_to)` embed `staleBookings` already uses, so a Staff member filtering "Mine" does not silently see a queue that quietly ignores two of five row kinds. Flagged for the owner in case this reads as scope creep; it costs no new column and reuses an existing helper (`withAssigneeOn`) verbatim.
- **The agency screen's new row text is English-only, matching its own existing precedent.** `agency-work-list.tsx`'s current `primaryLabel`/`secondaryLine` read `m["work.conversation"]`/`m["work.booking"]` directly (no `tr`, no locale) — this screen's bucketed rows are English-only today, unlike its suggestion-tray section below them (which does take `tr`). The booking-act row's text comes from `describeAct`, which needs a `Tr`; Task 6 passes `makeTr("en")` to match this screen's own existing posture for every OTHER bucketed row, rather than introducing new localization plumbing this task was not asked to add.

## Shared facts and interfaces

```text
Migration 0114_work_queue_actions.sql:
  alter table public.calls add column transfer_followup_at timestamptz;
  alter table public.ai_acts add column accepted_at timestamptz, add column accepted_by text;
  alter table public.ai_acts add constraint ai_acts_accepted_pair check ((accepted_at is null) = (accepted_by is null));
  alter table public.ai_acts add constraint ai_acts_not_both_accepted_and_undone
    check (not (accepted_at is not null and undone_at is not null));
  -- No grant change. No function edit. No new SECURITY DEFINER. No RLS policy change.

packages/db/src/work-queue.ts:
  export type WorkSource = "task" | "conversation" | "booking" | "failed_transfer" | "booking_act";
  // WorkRow gains two optional fields:
  callbackNumber?: string | null;     // failed_transfer only
  bookingAct?: AiAct;                  // booking_act only, always set on that source
  // (module-private) async function failedTransfers(db, accountId, assignee?): Promise<WorkRow[]>

packages/db/src/voice.ts:
  export async function setTransferFollowedUp(db: SupabaseClient, accountId: string, callId: string, by: string, at: Date): Promise<void>;
    // throws on no match (wrong id, OR already followed up) — mirrors reopenTask/setCallOutcome
  export async function clearTransferFollowup(db: SupabaseClient, accountId: string, callId: string, at: Date): Promise<boolean>;
    // compare-and-swap on transfer_followup_at = at; false = stale, nothing cleared

packages/db/src/ai-acts.ts:
  export async function listPendingBookingActs(db: SupabaseClient, accountId: string, assignee?: AssigneeFilter): Promise<WorkRow[]>;
  export async function stampAiActAccepted(db: SupabaseClient, accountId: string, actId: string, by: string, at: Date): Promise<boolean>;
  export async function unstampAiActAccepted(db: SupabaseClient, accountId: string, actId: string, by: string, at: Date): Promise<boolean>;

apps/web/src/lib/auth/visible.ts:
  export type ProvableTable = "bookings" | "conversations" | "calls" | "ai_acts";   // additive widen only

apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/tasks/actions.ts:
  export type FailedTransferDoneResult = { ok: true; at: string } | { ok: false; error: string; errorKey?: WorkActionErrorKey };
  export type AcceptBookingActResult = { ok: true; at: string } | { ok: false; error: string; errorKey?: WorkActionErrorKey };
  export async function completeFailedTransfer(accountId: string, callId: string): Promise<FailedTransferDoneResult>;
  export async function reopenFailedTransfer(accountId: string, callId: string, at: string): Promise<ActionResult>;
  export async function acceptBookingAct(accountId: string, actId: string): Promise<AcceptBookingActResult>;
  export async function unacceptBookingAct(accountId: string, actId: string, at: string): Promise<ActionResult>;
```

## Task list

| # | Title | Tier | Owner | Lane |
|---|---|---|---|---|
| T1 | Migration 0114: `calls.transfer_followup_at`; `ai_acts.accepted_at`/`accepted_by` + 2 CHECKs | **HIGH** | bis-db-schema | 1 |
| T2 | DB layer: failed transfers (`work-queue.ts`, `voice.ts`) | MEDIUM | bis-crm (work-queue.ts) + bis-voice (voice.ts) | 1 |
| T3 | DB layer: booking acts (`ai-acts.ts`, `work-queue.ts` wiring) | MEDIUM | bis-crm | 2 |
| T4 | Web actions, `callerCanSee` widen, copy, access-log classification | MEDIUM | bis-crm | 1 |
| T5 | Per-account UI (`work-list.tsx`, `work-row-actions.tsx`) | LOW-MEDIUM | bis-frontend | 1 |
| T6 | Agency UI (`agency-work-list.tsx`) | LOW-MEDIUM | bis-frontend | 2 |
| T7 | e2e (written now, run after the migration hold clears) | MEDIUM | bis-e2e-qa | 2 |
| T8 | Roadmap/tracker row | LOW | orchestrator | — |

**Lanes (2 at most):** Lane 1: T1 → T2 → T4 → T5. Lane 2: T3 (starts once T1's migration file is committed; independent of T2's files) → T6 → T7 (needs T4, T5, T6 all landed). T8 last, by the orchestrator, after the PR merges.

---

### Task 1: Migration 0114

**Tier:** HIGH · **Owner:** bis-db-schema · **Lane:** 1 · **Port:** 55996 (reviewer: 56096)

**Files:**
- Create: `packages/db/supabase/migrations/0114_work_queue_actions.sql`
- Create: `packages/db/src/test/work-queue-actions-schema.test.ts` (new; `calls.transfer_followup_at` column pin, grants-unchanged, digest)
- Modify: `packages/db/src/test/ai-acts-schema.test.ts` (the FIXED-column list test at lines 264-269 must include the two new columns; two new CHECK-constraint tests; one new combined-update test)

**Interfaces:** produces the two new columns and two new CHECK constraints listed in "Shared facts." No new SECURITY DEFINER; `definer-search-path.test.ts` needs no change (confirmed, not assumed — see Correction 2).

- [ ] **Step 1: Replica.** Copy the driver script per Rule 2 above to `<your scratchpad>/t1/pg17-t1.sh`, port 55996, `init` skip pattern `0114_*`. Run `sh pg17-t1.sh init`. Expected last line: `pre = 112 files applied, last 0112_record_changes_q1.sql, on 17.6` (or `113 files … last 0113_record_changes_enforce.sql` if F-115's PR D has landed by the time you run this — either is fine; paste whichever you see). On `pre`, record the client-write digest and the definer count, then paste both:

```sql
select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where p.prosecdef and n.nspname in ('public','app');                                   -- expect 39
select count(*) || '|' || md5(string_agg(x, ',' order by x)) as digest from (
  select r || ' ' || c.relname || ' ' || p as x
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   cross join (values ('anon'), ('authenticated')) v(r)
   cross join (values ('INSERT'), ('UPDATE'), ('DELETE')) w(p)
   where n.nspname = 'public' and c.relkind = 'r' and has_table_privilege(r, c.oid, p)) s;   -- record it: 0114 must not move it
```

- [ ] **Step 2: The schema tests, red first.** Create `work-queue-actions-schema.test.ts`. Copy the helpers `seedAccount`/`actAsMember`/`asService` pattern from `call-handoff-grants.test.ts` (grep its own imports from `./db`). Cases:

```ts
import { describe, it, expect } from "vitest";
import { withRollback, actAsOwner } from "./db";

describe("0114: calls.transfer_followup_at", () => {
  it("exists, nullable, no default (mutation: add a default -> FAILS)", () =>
    withRollback(async (c) => {
      const { rows } = await c.query(
        `select is_nullable, column_default from information_schema.columns
          where table_schema = 'public' and table_name = 'calls' and column_name = 'transfer_followup_at'`);
      expect(rows).toEqual([{ is_nullable: "YES", column_default: null }]);
    }));

  it("authenticated gains no write privilege on calls from this migration (mutation: grant update on calls to authenticated -> FAILS)", () =>
    withRollback(async (c) => {
      const { rows } = await c.query<{ p: string }>(
        `select p from (values ('INSERT'),('UPDATE'),('DELETE'),('TRUNCATE'),('REFERENCES'),('TRIGGER')) w(p)
          where has_table_privilege('authenticated', 'public.calls', w.p)`);
      expect(rows).toEqual([]);
    }));
});

describe("0114: ai_acts.accepted_at / accepted_by", () => {
  it("exist, nullable, no default", () =>
    withRollback(async (c) => {
      const { rows } = await c.query(
        `select column_name, is_nullable, column_default from information_schema.columns
          where table_schema = 'public' and table_name = 'ai_acts' and column_name in ('accepted_at','accepted_by')
          order by column_name`);
      expect(rows).toEqual([
        { column_name: "accepted_at", is_nullable: "YES", column_default: null },
        { column_name: "accepted_by", is_nullable: "YES", column_default: null },
      ]);
    }));

  it("ai_acts_accepted_pair: one set without the other violates the CHECK (mutation: drop the constraint -> the lone-column update succeeds -> FAILS)", () =>
    withRollback(async (c) => {
      await actAsOwner(c);
      // seed an account/contact/call/chat-free act the way ai-acts-schema.test.ts's own `seed`/`insAct` helpers do;
      // reuse those two helpers verbatim rather than re-deriving the insert shape.
      const id = await insActForTest(c);
      await expect(c.query("update public.ai_acts set accepted_at = now() where id = $1", [id]))
        .rejects.toMatchObject({ code: "23514", constraint: "ai_acts_accepted_pair" });
    }));

  it("ai_acts_not_both_accepted_and_undone: enforced at the database, not only in application code (mutation: drop the constraint -> FAILS)", () =>
    withRollback(async (c) => {
      await actAsOwner(c);
      const id = await insActForTest(c);
      await c.query("update public.ai_acts set undone_at = now(), undone_by = 'u1' where id = $1", [id]);
      await expect(c.query("update public.ai_acts set accepted_at = now(), accepted_by = 'u2' where id = $1", [id]))
        .rejects.toMatchObject({ code: "23514", constraint: "ai_acts_not_both_accepted_and_undone" });
    }));

  it("the existing trigger still refuses target to move even in the SAME statement as accepted_at (mutation, performed and reverted inside this test's own transaction: drop `or new.target is distinct from old.target` from app.ai_acts_act_is_fixed() -> the combined update that should raise P0001 instead succeeds -> FAILS)", () =>
    withRollback(async (c) => {
      await actAsOwner(c);
      const id = await insActForTest(c);
      await expect(c.query(
        "update public.ai_acts set accepted_at = now(), accepted_by = 'u1', target = '{\"field\":\"email\"}'::jsonb where id = $1", [id]))
        .rejects.toMatchObject({ code: "P0001", message: expect.stringMatching(/ai_acts_act_is_fixed/) });
      // Now prove the test is not vacuous: replace the function with target's own
      // comparison dropped, inside this SAME rolled-back transaction, and show the
      // combined update that should fail now succeeds.
      await c.query(`create or replace function app.ai_acts_act_is_fixed() returns trigger
        language plpgsql set search_path = pg_catalog, pg_temp as $f$
        begin
          if new.id is distinct from old.id or new.account_id is distinct from old.account_id
             or new.actor is distinct from old.actor or new.call_id is distinct from old.call_id
             or new.chat_id is distinct from old.chat_id or new.contact_id is distinct from old.contact_id
             or new.kind is distinct from old.kind
             or new.before is distinct from old.before or new.after is distinct from old.after
             or new.created_at is distinct from old.created_at then
            raise exception 'ai_acts_act_is_fixed' using errcode = 'P0001';
          end if;
          return new;
        end $f$;`);
      const second = await insActForTest(c);
      const r = await c.query(
        "update public.ai_acts set accepted_at = now(), accepted_by = 'u1', target = '{\"field\":\"phone\"}'::jsonb where id = $1", [second]);
      expect(r.rowCount).toBe(1);
    }));
});
```

  `insActForTest` is a tiny local helper that seeds one agency/account/contact and one `booking_cancelled`-shaped act, in the shape `ai-acts-schema.test.ts`'s own `seed`/`actRow`/`insAct` helpers already build — copy those three verbatim rather than re-deriving the insert. Run: `cd packages/db && SUPABASE_DB_URL=postgresql://postgres@localhost:55996/pre pnpm exec vitest run src/test/work-queue-actions-schema.test.ts`. Expected red: every case fails with `column "transfer_followup_at" does not exist` / `column "accepted_at" does not exist` / constraint not found. Paste the summary.

- [ ] **Step 3: Extend `ai-acts-schema.test.ts`.** At lines 264-269, the existing test `"the list is every column but the three undo columns"` asserts the full `attname` list equals `[...FIXED.map(f=>f.col), "undo_notified", "undone_at", "undone_by"]`. Change the expected list to append `"accepted_at", "accepted_by"` — **this existing test goes red the moment 0114's columns exist, and must be updated or it fails as an unintended regression, not a deliberate one.** Add one new case mirroring the existing `"the undo columns move freely"` test (lines 278-287), proving `accepted_at`/`accepted_by` also move freely together:

```ts
it("the accept columns move freely, together only (mutation: allow accepted_at alone -> the pair CHECK's own test above catches it, not this one)", () =>
  withRollback(async (c) => {
    const s = await seed(c);
    const id = await insAct(c, actRow(s));
    await svc(c, async () => {
      expect((await c.query("update ai_acts set accepted_at = now(), accepted_by = 'u' where id = $1", [id])).rowCount).toBe(1);
      expect((await c.query("update ai_acts set accepted_at = null, accepted_by = null where id = $1", [id])).rowCount).toBe(1);
    });
  }));
```

  Run against `/post` (after Step 4 writes the migration): `SUPABASE_DB_URL=postgresql://postgres@localhost:55996/post pnpm exec vitest run src/test/ai-acts-schema.test.ts`. Confirm the previously-passing FIXED-list test is red before your edit (paste the failing line: `expected [...] to equal [...]`, naming the missing two columns), then green after.

- [ ] **Step 4: Write the migration.** Header sections (WHY / WHAT / GRANTS / SEARCH PATHS / LOCKS AND COST / LOAD-BEARING / ROLLBACK), ASCII only, the `lock_timeout` 5s `do` block first (copy `0106`'s verbatim block). Body:

```sql
-- 1. calls: when a person marked a failed transfer handled (called the caller back) from the To do queue.
alter table public.calls add column transfer_followup_at timestamptz;
comment on column public.calls.transfer_followup_at is
  'When a person marked a failed transfer (asked for a person, handoff_requested_at set, outcome '
  'abandoned) handled, from the To do queue. NULL = not yet followed up, or not a failed transfer. '
  'Written by setTransferFollowedUp on the SERVICE client, behind a request-client read that proves '
  'the caller may see this call (callerCanSee) -- calls grants authenticated no write at all (0020), '
  'so this column needs no grant either.';

-- 2. ai_acts: a queue-only "I saw this" stamp, independent of the booking's own Undo (undone_at).
--    The existing app.ai_acts_act_is_fixed() trigger (0091) already permits these to move: it checks
--    eleven NAMED columns, not "everything but three"; no function edit is needed or made here.
alter table public.ai_acts
  add column accepted_at timestamptz,
  add column accepted_by text;  -- a Clerk id, not an FK (0091's own reason for undone_by)
comment on column public.ai_acts.accepted_at is
  'When someone marked this booking change seen on the To do queue (F-077 part 1). Independent of '
  'undone_at -- accepting touches no booking, and the record''s own Undo is unaffected. NULL = not '
  'yet accepted.';

alter table public.ai_acts
  add constraint ai_acts_accepted_pair check ((accepted_at is null) = (accepted_by is null)),
  add constraint ai_acts_not_both_accepted_and_undone
    check (not (accepted_at is not null and undone_at is not null));
```

  ROLLBACK: `alter table public.ai_acts drop constraint ai_acts_not_both_accepted_and_undone, drop constraint ai_acts_accepted_pair, drop column accepted_at, drop column accepted_by; alter table public.calls drop column transfer_followup_at;`. LOCKS AND COST: both `alter table … add column` with no default take a brief metadata-only lock (no table rewrite, PG11+); state this and the table sizes read at Step 1.

- [ ] **Step 5: Green on the replica.** Run `sh pg17-t1.sh post`; expected `0114 apply exit 0`. Run both test files against `/post`; expected all green, including the Step 3 update. Run each named mutation (drop a constraint; the trigger-function swap inside Step 2's last test) and paste the failing line, then confirm it reverts clean (the trigger swap is inside its own `withRollback` transaction, so no revert step is needed outside the test). Re-run the Step 1 digest and definer-count queries on `post`; paste both, confirming NEITHER moved.
- [ ] **Step 6: Commit** `feat(db): 0114 calls.transfer_followup_at and ai_acts.accepted_at/accepted_by, with their CHECKs (F-077 part 1)` -- the three paths.

---

### Task 2: DB layer — failed transfers

**Tier:** MEDIUM · **Owners:** bis-crm (`work-queue.ts`, its test) + bis-voice (`voice.ts`, its test) · **Lane:** 1 · **Depends on:** T1 committed (migration file exists)

**Files:**
- Modify: `packages/db/src/work-queue.ts` (WorkSource union; `WorkRow.callbackNumber`; new `failedTransfers` function; `listAccountWork` wiring)
- Modify: `packages/db/src/voice.ts` (new `setTransferFollowedUp`, `clearTransferFollowup`)
- Modify: `packages/db/src/test/work-queue.test.ts` (failed-transfer appearance, suppression-not-reused, second-account isolation)
- Modify: `packages/db/src/test/voice.test.ts` (the two new functions' CAS behavior)

**Interfaces:** consumes nothing new. Produces `failedTransfers` (module-private) and the two exported `voice.ts` functions in "Shared facts." `voice.ts` is re-exported wholesale (`export * from "./voice";`, `index.ts:176`) — no index.ts change needed for the two new functions.

**Note on running these tests (Rule 3):** both files import `withTestAccount`; you cannot run them in this worktree. Write them, read them against the actual signatures above, and report "written, not run here — proven by CI `verify`."

- [ ] **Step 1: `voice.ts`, red first.** Append to `voice.test.ts` (model the account-scoping assertion directly on `setCallOutcome`'s own test at lines 806-824):

```ts
describe("setTransferFollowedUp / clearTransferFollowup (F-077 part 1)", () => {
  it("stamps a failed transfer, account-scoped; a second stamp throws (mutation: drop .is('transfer_followup_at', null) -> the second call silently succeeds -> FAILS)", async () => {
    await withTestAccount(async (db, accountId) => {
      const { data: pn } = await db.from("phone_numbers").insert({ account_id: accountId, e164: testPhoneNumber() }).select("id").single();
      const { data: call } = await db.from("calls").insert({
        account_id: accountId, phone_number_id: pn!.id, outcome: "abandoned",
        handoff_requested_at: new Date().toISOString(),
      }).select("id").single();
      const at = new Date("2026-11-06T15:00:00Z");
      await setTransferFollowedUp(db, accountId, call!.id, "user_test", at);
      const { data: row } = await db.from("calls").select("transfer_followup_at").eq("id", call!.id).single();
      expect(row!.transfer_followup_at).toBe(at.toISOString());
      await expect(setTransferFollowedUp(db, accountId, call!.id, "user_test", new Date())).rejects.toThrow(/matched no row/);
    });
  });

  it("is account-scoped: another account's call id matches nothing (mutation: drop .eq('account_id', accountId) -> cross-account write succeeds -> FAILS)", async () => {
    await withTestAccount(async (dbA, accountA) => {
      await withTestAccount(async (dbB, accountB) => {
        const { data: pn } = await dbB.from("phone_numbers").insert({ account_id: accountB, e164: testPhoneNumber() }).select("id").single();
        const { data: call } = await dbB.from("calls").insert({
          account_id: accountB, phone_number_id: pn!.id, outcome: "abandoned", handoff_requested_at: new Date().toISOString(),
        }).select("id").single();
        await expect(setTransferFollowedUp(dbA, accountA, call!.id, "user_test", new Date())).rejects.toThrow(/matched no row/);
      });
    });
  });

  it("clearTransferFollowup only clears the exact instant it was given (mutation: drop .eq('transfer_followup_at', at.toISOString()) -> a later Done is clobbered by a stale Undo -> FAILS)", async () => {
    await withTestAccount(async (db, accountId) => {
      const { data: pn } = await db.from("phone_numbers").insert({ account_id: accountId, e164: testPhoneNumber() }).select("id").single();
      const { data: call } = await db.from("calls").insert({
        account_id: accountId, phone_number_id: pn!.id, outcome: "abandoned", handoff_requested_at: new Date().toISOString(),
      }).select("id").single();
      const at1 = new Date("2026-11-06T15:00:00Z");
      await setTransferFollowedUp(db, accountId, call!.id, "user_a", at1);
      const stale = await clearTransferFollowup(db, accountId, call!.id, new Date("2026-11-06T16:00:00Z"));
      expect(stale).toBe(false);
      const { data: still } = await db.from("calls").select("transfer_followup_at").eq("id", call!.id).single();
      expect(still!.transfer_followup_at).toBe(at1.toISOString());
      expect(await clearTransferFollowup(db, accountId, call!.id, at1)).toBe(true);
    });
  });
});
```

- [ ] **Step 2: Implement** in `voice.ts`, placed beside `setCallOutcome` (after line 549):

```ts
/**
 * Marks a failed transfer handled (F-077 part 1: a caller who asked for a person and never reached
 * one, To do queue). Throws on no match -- wrong id, or already followed up -- mirroring reopenTask's
 * own "no task" throw (activities.ts:140) and setCallOutcome's select-back check (above). No emit():
 * no write on `calls` emits an event anywhere in this codebase today.
 */
export async function setTransferFollowedUp(
  db: SupabaseClient, accountId: string, callId: string, by: string, at: Date,
): Promise<void> {
  const { data, error } = await db.from("calls")
    .update({ transfer_followup_at: at.toISOString() })
    .eq("id", callId).eq("account_id", accountId).is("transfer_followup_at", null)
    .select("id");
  if (error) throw new Error(`setTransferFollowedUp failed: ${error.message}`);
  if (!data || data.length === 0) throw new Error("setTransferFollowedUp matched no row");
}

/**
 * Undo of setTransferFollowedUp. Compare-and-swap on the exact instant written, so a second Done
 * elsewhere between click and undo-click is not silently clobbered -- same shape as
 * clearAiActUndone (ai-acts.ts). Returns false, not a throw, when stale: an Undo toast's own failure
 * path already handles a false result.
 */
export async function clearTransferFollowup(
  db: SupabaseClient, accountId: string, callId: string, at: Date,
): Promise<boolean> {
  const { data, error } = await db.from("calls")
    .update({ transfer_followup_at: null })
    .eq("id", callId).eq("account_id", accountId).eq("transfer_followup_at", at.toISOString())
    .select("id");
  if (error) throw new Error(`clearTransferFollowup failed: ${error.message}`);
  return (data ?? []).length > 0;
}
```

  Add `by` to the function signature even though it is unused in the write (future callers may need it for a later feature; matches `stampAiActUndone`'s own `by` parameter, which it DOES use). Run `pnpm --filter @bis/db typecheck`.

- [ ] **Step 3: `work-queue.ts`, red first.** Append to `work-queue.test.ts`:

```ts
describe("failedTransfers (F-077 part 1)", () => {
  it("appears only when handoff was requested, the call is abandoned, and it is not yet followed up", async () => {
    await withTestAccount(async (db, accountId) => {
      const { data: pn } = await db.from("phone_numbers").insert({ account_id: accountId, e164: testPhoneNumber() }).select("id").single();
      const plain = await db.from("calls").insert({ account_id: accountId, phone_number_id: pn!.id, outcome: "abandoned" }).select("id").single();
      const transferredAnswered = await db.from("calls").insert({
        account_id: accountId, phone_number_id: pn!.id, outcome: "transferred", handoff_requested_at: new Date().toISOString(),
      }).select("id").single();
      const followedUp = await db.from("calls").insert({
        account_id: accountId, phone_number_id: pn!.id, outcome: "abandoned",
        handoff_requested_at: new Date().toISOString(), transfer_followup_at: new Date().toISOString(),
      }).select("id").single();
      const failed = await db.from("calls").insert({
        account_id: accountId, phone_number_id: pn!.id, outcome: "abandoned",
        handoff_requested_at: new Date(Date.now() - 3_600_000).toISOString(), callback_number: "9565551212",
      }).select("id").single();

      const rows = await listAccountWork(db, accountId);
      const ids = rows.map((r) => r.id);
      expect(ids).not.toContain(`failed_transfer:${plain.data!.id}`);
      expect(ids).not.toContain(`failed_transfer:${transferredAnswered.data!.id}`);
      expect(ids).not.toContain(`failed_transfer:${followedUp.data!.id}`);
      expect(ids).toContain(`failed_transfer:${failed.data!.id}`);
      const row = rows.find((r) => r.id === `failed_transfer:${failed.data!.id}`)!;
      expect(row.callbackNumber).toBe("9565551212");
      expect(row.source).toBe("failed_transfer");
    });
  });

  it("suppression is NOT reused: an open task on the same contact does not hide a failed-transfer row (mutation: add failed_transfer to listAccountWork's suppressed filter -> FAILS)", async () => {
    await withTestAccount(async (db, accountId) => {
      const { data: c } = await withAuthor(db.from("contacts")
        .insert({ account_id: accountId, first_name: "Lee", last_name: "Park" }), SEED_AUTHOR, SEED_VIA).select("id").single();
      const { data: pn } = await db.from("phone_numbers").insert({ account_id: accountId, e164: testPhoneNumber() }).select("id").single();
      const { data: call } = await db.from("calls").insert({
        account_id: accountId, phone_number_id: pn!.id, contact_id: c!.id, outcome: "abandoned",
        handoff_requested_at: new Date().toISOString(),
      }).select("id").single();
      await addTask(db, accountId, { contactId: c!.id, title: "Call Lee back" }, "user_test");

      const rows = await listAccountWork(db, accountId);
      expect(rows.map((r) => r.id)).toContain(`failed_transfer:${call!.id}`);
    });
  });

  it("is account-scoped: account A does not see account B's failed transfer", async () => {
    await withTestAccount(async (dbA, accountA) => {
      await withTestAccount(async (dbB, accountB) => {
        const { data: pn } = await dbB.from("phone_numbers").insert({ account_id: accountB, e164: testPhoneNumber() }).select("id").single();
        const { data: call } = await dbB.from("calls").insert({
          account_id: accountB, phone_number_id: pn!.id, outcome: "abandoned", handoff_requested_at: new Date().toISOString(),
        }).select("id").single();
        const rowsA = await listAccountWork(dbA, accountA);
        expect(rowsA.map((r) => r.id)).not.toContain(`failed_transfer:${call!.id}`);
      });
    });
  });
});
```

- [ ] **Step 4: Implement.** In `work-queue.ts`, widen the type and add the function, placed after `staleBookings` (after line 169):

```ts
export type WorkSource = "task" | "conversation" | "booking" | "failed_transfer" | "booking_act";
```

Add to `WorkRow` (after `closureFocus`, line 37):

```ts
  /** F-077 part 1: a failed-transfer row's own number to call back -- calls.callback_number, else
   *  calls.caller_e164, else null (withheld caller ID). Present ONLY on a failed_transfer row. */
  callbackNumber?: string | null;
  /** F-077 part 1: a booking-act row's own act, in full, so the UI can call describeAct() with it --
   *  never re-derived from a partial projection. Present and ALWAYS set on a booking_act row (Task 3). */
  bookingAct?: AiAct;
```

Add the import `import type { AiAct } from "./ai-act-rules";` at the top (this is a type-only import from a leaf module with no dependency back on `work-queue.ts`, so it introduces no runtime cycle even though `ai-acts.ts`, in Task 3, imports `type { WorkRow }` from this same file — the two directions are type-only one way, runtime the other, which TypeScript erases at compile time).

```ts
async function failedTransfers(db: SupabaseClient, accountId: string, assignee?: AssigneeFilter): Promise<WorkRow[]> {
  // The one abandoned call that is never a wrong number or a robocall: the caller explicitly asked
  // for a person (handoff_requested_at) and never reached one, and nobody has followed up yet.
  const embed = assignee ? ", contacts!inner(assigned_to)" : "";
  let q = db.from("calls")
    .select(`id, contact_id, callback_number, caller_e164, started_at${embed}`)
    .eq("account_id", accountId).eq("outcome", "abandoned")
    .not("handoff_requested_at", "is", null).is("transfer_followup_at", null);
  q = withAssigneeOn(q, assignee, "contacts.assigned_to");
  const { data, error } = await q.order("started_at", { ascending: true }).limit(200);
  if (error) throw new Error(`failedTransfers failed: ${error.message}`);
  return ((data ?? []) as unknown as {
    id: string; contact_id: string | null; callback_number: string | null; caller_e164: string | null; started_at: string;
  }[]).map((c) => ({
    id: `failed_transfer:${c.id}`, source: "failed_transfer" as const, accountId,
    contactId: c.contact_id, title: "",
    dueAt: null, occurredAt: c.started_at,
    callbackNumber: c.callback_number ?? c.caller_e164 ?? null,
  }));
}
```

In `listAccountWork` (lines 177-188), add the new source to the fan-out WITHOUT routing it through the suppression filter (same treatment as `bookings`):

```ts
export async function listAccountWork(
  db: SupabaseClient, accountId: string, opts: { assignee?: AssigneeFilter } = {},
): Promise<WorkRow[]> {
  const [tasks, convos, bookings, transfers] = await Promise.all([
    openTasks(db, accountId, opts.assignee),
    unansweredConversations(db, accountId, opts.assignee),
    staleBookings(db, accountId, opts.assignee),
    failedTransfers(db, accountId, opts.assignee),
  ]);
  const suppressed = new Set(tasks.map((t) => t.contactId).filter(Boolean) as string[]);
  const keep = (r: WorkRow) => !r.contactId || !suppressed.has(r.contactId);
  return [...tasks, ...convos.filter(keep), ...bookings, ...transfers];
}
```

  (Task 3 below adds the fifth element, `bookingActs`, to this same `Promise.all` and spread — note it here so your diff and Task 3's do not silently clobber each other; coordinate the exact line if you land second.)

- [ ] **Step 5: Report as written, not run.** Per the worktree's missing env (Rule 3), paste the full diff and state explicitly which assertions you traced by hand against the real column names (`calls.callback_number`, `calls.caller_e164`, `calls.started_at`, `calls.handoff_requested_at`, `calls.transfer_followup_at`, `calls.outcome`) and against `withAssigneeOn`'s real signature (`contacts.ts:1046-1050`). Run `pnpm --filter @bis/db typecheck`.
- [ ] **Step 6: Commit** `feat(db): a failed transfer is a derived To-do row, with its own Done/Undo (F-077 part 1)` -- the four paths.

---

### Task 3: DB layer — booking acts

**Tier:** MEDIUM · **Owner:** bis-crm · **Lane:** 2 · **Depends on:** T1 committed; T2's `WorkRow`/`WorkSource` edits (coordinate the `listAccountWork` diff, see T2 Step 4's note)

**Files:**
- Modify: `packages/db/src/ai-acts.ts` (new `listPendingBookingActs`, `stampAiActAccepted`, `unstampAiActAccepted`)
- Modify: `packages/db/src/work-queue.ts` (the fifth `Promise.all` element; `"booking_act"` already added to `WorkSource`/`WorkRow` by T2)
- Modify: `packages/db/src/index.ts` (additive: three new names in the existing `ai-acts.ts` export list)
- Modify: `packages/db/src/test/ai-acts.test.ts` (the two new CAS functions; `listPendingBookingActs`'s filters)

**Interfaces:** consumes `AssigneeFilter` (`import type { AssigneeFilter } from "./assignment";`), `WorkRow` (`import type { WorkRow } from "./work-queue";` — type-only, see T2 Step 4's cycle note), `parseAiAct`/`AiAct` (already imported in this file), `withAssigneeOn` (`import { withAssigneeOn } from "./contacts";`).

- [ ] **Step 1: Red first.** Append to `ai-acts.test.ts`:

```ts
import { listPendingBookingActs, stampAiActAccepted, unstampAiActAccepted } from "../ai-acts";

describe("listPendingBookingActs (F-077 part 1)", () => {
  it("surfaces only control:booking kinds, un-undone and un-accepted (mutation: widen the kind filter to include contact_field_filled -> FAILS)", async () => {
    await withTestAccount(async (db, accountId) => {
      const callId = await seedCall(db, accountId);
      const { id: contactId } = await createContact(db, accountId, { firstName: "Ana" }, "user_test");
      const booking = { kind: "booking_cancelled" as const, actor: "voice" as const, callId, chatId: null, contactId,
        target: { bookingId: "bk_1" }, before: { startsAt: "2026-11-01T10:00:00Z", endsAt: "2026-11-01T11:00:00Z" },
        after: { version: "2026-11-01T09:00:00Z" } };
      const field = { kind: "contact_field_filled" as const, actor: "voice" as const, callId, chatId: null, contactId,
        target: { field: "email" as const }, before: { value: null }, after: { value: "a@b.com" } };
      await insertAiActs(db, accountId, [booking, field]);

      const rows = await listPendingBookingActs(db, accountId);
      expect(rows).toHaveLength(1);
      expect(rows[0]!.source).toBe("booking_act");
      expect(rows[0]!.bookingAct!.kind).toBe("booking_cancelled");
      expect(rows[0]!.contactId).toBe(contactId);
    });
  });

  it("excludes an already-undone or already-accepted act (mutation: drop .is('accepted_at', null) -> FAILS)", async () => {
    await withTestAccount(async (db, accountId) => {
      const callId = await seedCall(db, accountId);
      const { id: contactId } = await createContact(db, accountId, { firstName: "Bo" }, "user_test");
      const act = { kind: "booking_created" as const, actor: "voice" as const, callId, chatId: null, contactId,
        target: { bookingId: "bk_2" }, before: null, after: { startsAt: "2026-11-02T10:00:00Z", endsAt: "2026-11-02T11:00:00Z" } };
      await insertAiActs(db, accountId, [act]);
      const { data: row } = await db.from("ai_acts").select("id").eq("account_id", accountId).eq("kind", "booking_created").single();
      await db.from("ai_acts").update({ accepted_at: new Date().toISOString(), accepted_by: "user_test" }).eq("id", row!.id);

      const rows = await listPendingBookingActs(db, accountId);
      expect(rows.map((r) => r.id)).not.toContain(`booking_act:${row!.id}`);
    });
  });

  it("is account-scoped: account A does not see account B's booking act", async () => {
    await withTestAccount(async (dbA, accountA) => {
      await withTestAccount(async (dbB, accountB) => {
        const callId = await seedCall(dbB, accountB);
        const { id: contactId } = await createContact(dbB, accountB, { firstName: "Cy" }, "user_test");
        await insertAiActs(dbB, accountB, [{ kind: "booking_cancelled", actor: "voice", callId, chatId: null, contactId,
          target: { bookingId: "bk_3" }, before: { startsAt: "2026-11-03T10:00:00Z", endsAt: "2026-11-03T11:00:00Z" },
          after: { version: "2026-11-03T09:00:00Z" } }]);
        const rowsA = await listPendingBookingActs(dbA, accountA);
        expect(rowsA).toHaveLength(0);
      });
    });
  });
});

describe("stampAiActAccepted / unstampAiActAccepted (F-077 part 1)", () => {
  it("is a real compare-and-swap: the second stamp returns false (mutation: drop .is('accepted_at', null) -> the second call also returns true -> FAILS)", async () => {
    await withTestAccount(async (db, accountId) => {
      const callId = await seedCall(db, accountId);
      const { id: contactId } = await createContact(db, accountId, { firstName: "Dee" }, "user_test");
      await insertAiActs(db, accountId, [{ kind: "booking_cancelled", actor: "voice", callId, chatId: null, contactId,
        target: { bookingId: "bk_4" }, before: { startsAt: "2026-11-04T10:00:00Z", endsAt: "2026-11-04T11:00:00Z" },
        after: { version: "2026-11-04T09:00:00Z" } }]);
      const { data: row } = await db.from("ai_acts").select("id").eq("account_id", accountId).eq("kind", "booking_cancelled").single();
      const at = new Date("2026-11-06T15:00:00Z");
      expect(await stampAiActAccepted(db, accountId, row!.id, "user_a", at)).toBe(true);
      expect(await stampAiActAccepted(db, accountId, row!.id, "user_b", new Date())).toBe(false);
    });
  });

  it("unstampAiActAccepted only clears the exact instant it was given (mutation: drop .eq('accepted_at', at.toISOString()) -> FAILS)", async () => {
    await withTestAccount(async (db, accountId) => {
      const callId = await seedCall(db, accountId);
      const { id: contactId } = await createContact(db, accountId, { firstName: "Em" }, "user_test");
      await insertAiActs(db, accountId, [{ kind: "booking_cancelled", actor: "voice", callId, chatId: null, contactId,
        target: { bookingId: "bk_5" }, before: { startsAt: "2026-11-05T10:00:00Z", endsAt: "2026-11-05T11:00:00Z" },
        after: { version: "2026-11-05T09:00:00Z" } }]);
      const { data: row } = await db.from("ai_acts").select("id").eq("account_id", accountId).eq("kind", "booking_cancelled").single();
      const at1 = new Date("2026-11-06T15:00:00Z");
      await stampAiActAccepted(db, accountId, row!.id, "user_a", at1);
      expect(await unstampAiActAccepted(db, accountId, row!.id, "user_b", new Date("2026-11-06T16:00:00Z"))).toBe(false);
      expect(await unstampAiActAccepted(db, accountId, row!.id, "user_a", at1)).toBe(true);
    });
  });
});
```

  `seedCall` is the existing helper already declared at the top of `ai-acts.test.ts` (lines 18-25) — reuse it, do not re-derive.

- [ ] **Step 2: Implement**, placed after `markAiActNotified` (end of `ai-acts.ts`):

```ts
import type { AssigneeFilter } from "./assignment";
import { withAssigneeOn } from "./contacts";
import type { WorkRow } from "./work-queue";

const BOOKING_ACT_KINDS = ["booking_created", "booking_rescheduled", "booking_cancelled"] as const;

/** F-077 part 1: Sofia's booking changes, un-undone and un-accepted, for the To do queue. No stillSafe
 *  computation (that answers "may the record page still OFFER Undo"; this row never offers Undo
 *  itself -- Accept only means "I saw this"). THROWS on a database error; an unparseable row is
 *  skipped and logged, never thrown, matching listContactAiActs's own rule. */
export async function listPendingBookingActs(
  db: SupabaseClient, accountId: string, assignee?: AssigneeFilter,
): Promise<WorkRow[]> {
  const embed = assignee ? ", contacts!inner(assigned_to)" : "";
  let q = db.from("ai_acts")
    .select(`${COLS}${embed}`)
    .eq("account_id", accountId).in("kind", BOOKING_ACT_KINDS)
    .is("undone_at", null).is("accepted_at", null);
  q = withAssigneeOn(q, assignee, "contacts.assigned_to");
  const { data, error } = await q.order("created_at", { ascending: true }).limit(200);
  if (error) throw new Error(`listPendingBookingActs failed: ${error.message}`);
  const out: WorkRow[] = [];
  for (const r of (data ?? []) as unknown as Row[]) {
    const act = parseAiAct(r);
    if (!act) { console.error(`listPendingBookingActs: skipped ai_act ${(r as { id?: string }).id}: payload does not fit kind`); continue; }
    out.push({
      id: `booking_act:${act.id}`, source: "booking_act" as const, accountId,
      contactId: act.contactId, title: "",
      dueAt: null, occurredAt: act.createdAt,
      bookingAct: act,
    });
  }
  return out;
}

/** Stamps an act "seen" on the To do queue -- the exact shape of stampAiActUndone, with its own
 *  column. Compare-and-swap on `accepted_at is null`: true when THIS call moved it. THROWS on a
 *  database error. No emit(): matches stampAiActUndone's own silence. */
export async function stampAiActAccepted(db: SupabaseClient, accountId: string, actId: string, by: string, at: Date): Promise<boolean> {
  const { data, error } = await db.from("ai_acts")
    .update({ accepted_at: at.toISOString(), accepted_by: by })
    .eq("account_id", accountId).eq("id", actId).is("accepted_at", null)
    .select("id");
  if (error) throw new Error(`stampAiActAccepted failed: ${error.message}`);
  return (data ?? []).length > 0;
}

/** Undo of stampAiActAccepted -- the exact shape of clearAiActUndone. THROWS on a database error. */
export async function unstampAiActAccepted(db: SupabaseClient, accountId: string, actId: string, by: string, at: Date): Promise<boolean> {
  const { data, error } = await db.from("ai_acts")
    .update({ accepted_at: null, accepted_by: null })
    .eq("account_id", accountId).eq("id", actId).eq("accepted_by", by).eq("accepted_at", at.toISOString())
    .select("id");
  if (error) throw new Error(`unstampAiActAccepted failed: ${error.message}`);
  return (data ?? []).length > 0;
}
```

  In `work-queue.ts`'s `listAccountWork`, add the fifth source (coordinate with T2's own edit to the same function — land both in one combined diff if both tasks finish close together):

```ts
  const [tasks, convos, bookings, transfers, bookingActs] = await Promise.all([
    openTasks(db, accountId, opts.assignee),
    unansweredConversations(db, accountId, opts.assignee),
    staleBookings(db, accountId, opts.assignee),
    failedTransfers(db, accountId, opts.assignee),
    listPendingBookingActs(db, accountId, opts.assignee),
  ]);
  const suppressed = new Set(tasks.map((t) => t.contactId).filter(Boolean) as string[]);
  const keep = (r: WorkRow) => !r.contactId || !suppressed.has(r.contactId);
  return [...tasks, ...convos.filter(keep), ...bookings, ...transfers, ...bookingActs];
```

  with `import { listPendingBookingActs } from "./ai-acts";` added at the top of `work-queue.ts`.

- [ ] **Step 3: index.ts (additive).** At lines 435-439, add the three new names to the existing list (touch only this one line, per the hot-shared-file rule):

```ts
export {
  insertAiActs, getAiAct, listContactAiActs, undoAiBookingAct, aiContactHeldBy, undoAiContactCreated,
  stampAiActUndone, clearAiActUndone, markAiActNotified,
  listPendingBookingActs, stampAiActAccepted, unstampAiActAccepted,
  type AiBookingUndoOutcome, type AiContactUndoOutcome,
} from "./ai-acts";
```

- [ ] **Step 4: Report as written, not run** (Rule 3; same reasoning as T2 Step 5). Run `pnpm --filter @bis/db typecheck`.
- [ ] **Step 5: Commit** `feat(db): a booking change Sofia made is a derived To-do row, with its own Accept/Undo (F-077 part 1)` -- the four paths.

---

### Task 4: Web actions, `callerCanSee` widen, copy, access-log classification

**Tier:** MEDIUM · **Owner:** bis-crm · **Lane:** 1 · **Depends on:** T2, T3 committed

**Files:**
- Modify: `apps/web/src/lib/auth/visible.ts` (widen `ProvableTable`)
- Modify: `apps/web/src/lib/auth/visible.test.ts` (two new cases proving the widened literals)
- Modify: `apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/tasks/actions.ts` (four new actions, two new result types)
- Modify: `apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/tasks/actions.test.ts`
- Modify: `apps/web/src/lib/messages.ts` (five new `work.*` key pairs)
- Modify: `apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/access-log-routes.test.ts` (four new names in the existing `tasks/actions.ts` entry)

**Interfaces:** consumes `WorkActionErrorKey`/`ActionResult` (`tasks/actions.ts:49-52`), `callerCanSee` (widened), `serviceDb`/`setTransferFollowedUp`/`clearTransferFollowup`/`stampAiActAccepted`/`unstampAiActAccepted` from `@bis/db`. Produces the four actions and two result types in "Shared facts."

- [ ] **Step 1: Widen `visible.ts`, red first.** Append to `visible.test.ts`:

```ts
it.each(["calls", "ai_acts"] as const)("accepts %s as a provable table too (F-077 part 1)", async (table) => {
  fake.results[table] = row({ id: "x1" });
  expect(await callerCanSee(table, "acct_1", "x1")).toBe(true);
});
```

  Run `pnpm --filter web exec vitest run src/lib/auth/visible.test.ts`. Expected red: TypeScript error, `Argument of type '"calls"' is not assignable to parameter of type 'ProvableTable'`.
- [ ] **Step 2: Implement.** In `visible.ts:11`: `export type ProvableTable = "bookings" | "conversations" | "calls" | "ai_acts";`. The function body (lines 14-19) needs no change — it is already generic over `table`. Green: `pnpm --filter web exec vitest run src/lib/auth/visible.test.ts`.
- [ ] **Step 3: Copy, red first.** Append to `messages.ts` right after `work.actionFailed.es` (line 4816), before the "Task 5's dashboard row" comment block:

```ts
  "work.failedTransfer": "Call back at {number} — they asked for a person",
  "work.failedTransfer.es": "Devuelva la llamada al {number} — pidió hablar con alguien",
  "work.failedTransfer.bare": "A caller asked for a person and couldn't reach one",
  "work.failedTransfer.bare.es": "Alguien que llamó pidió hablar con una persona y no pudo comunicarse",
  "work.failedTransfer.done": "Called back",
  "work.failedTransfer.done.es": "Llamada devuelta",
  "work.act.accept": "Accept",
  "work.act.accept.es": "Aceptar",
  "work.act.accept.toast": "Accepted.",
  "work.act.accept.toast.es": "Aceptado.",
```

  Add a matching assertion to `messages.test.ts` in the same spirit as its other scoped `WANT` blocks (a small new `describe` block is fine; do not fold into an unrelated existing one):

```ts
describe("work.failedTransfer / work.act.accept (F-077 part 1)", () => {
  const WANT: Record<string, string> = {
    "work.failedTransfer": "Call back at {number} — they asked for a person",
    "work.failedTransfer.es": "Devuelva la llamada al {number} — pidió hablar con alguien",
    "work.failedTransfer.bare": "A caller asked for a person and couldn't reach one",
    "work.failedTransfer.bare.es": "Alguien que llamó pidió hablar con una persona y no pudo comunicarse",
    "work.failedTransfer.done": "Called back",
    "work.failedTransfer.done.es": "Llamada devuelta",
    "work.act.accept": "Accept",
    "work.act.accept.es": "Aceptar",
    "work.act.accept.toast": "Accepted.",
    "work.act.accept.toast.es": "Aceptado.",
  };
  it("has every key with exactly this text (mutation: change any .es string -> FAILS naming it)", () => {
    for (const [k, v] of Object.entries(WANT)) expect((m as Record<string, string>)[k], k).toBe(v);
  });
  it("every English key has its .es twin on the very next line (mutation: move a twin -> FAILS)", () => {
    const src = readFileSync(join(__dirname, "messages.ts"), "utf8").split("\n");
    for (const k of Object.keys(WANT).filter((x) => !x.endsWith(".es"))) {
      const i = src.findIndex((l) => l.trimStart().startsWith(`"${k}":`));
      expect(i, k).toBeGreaterThan(-1);
      expect(src[i + 1]!.trimStart().startsWith(`"${k}.es":`), k).toBe(true);
    }
  });
});
```

  Run `pnpm --filter web exec vitest run src/lib/messages.test.ts -t "work.failedTransfer"`. Expected red before Step 3's copy lands: `expected undefined to be 'Call back at {number}...'`.
- [ ] **Step 4: Actions, red first.** Append to `actions.test.ts`. Add to the hoisted `dbMocks` object: `setTransferFollowedUp: vi.fn(), clearTransferFollowup: vi.fn(), stampAiActAccepted: vi.fn(), unstampAiActAccepted: vi.fn()`. Add a new mock for `@/lib/auth/visible`:

```ts
const callerCanSeeMock = vi.hoisted(() => vi.fn(async () => true));
vi.mock("@/lib/auth/visible", () => ({ callerCanSee: callerCanSeeMock }));
const serviceDbMock = vi.hoisted(() => ({ tag: "service-db" }));
```

Add `serviceDb: () => serviceDbMock` to the `@bis/db` mock factory's spread. Then:

```ts
import { completeFailedTransfer, reopenFailedTransfer, acceptBookingAct, unacceptBookingAct } from "./actions";
import { setTransferFollowedUp, clearTransferFollowup, stampAiActAccepted, unstampAiActAccepted } from "@bis/db";

describe("completeFailedTransfer / reopenFailedTransfer (F-077 part 1)", () => {
  it("proves the call through the request client, then writes through serviceDb (mutation: write through dbForRequest instead -> the write hits a table authenticated has no grant on, in real use -> this test would still pass, which is exactly why Step 1's db-level test matters too; HERE the mutation is: call setTransferFollowedUp with dbForRequest's own return value -> FAILS the identity assertion below)", async () => {
    const r = await completeFailedTransfer("acct_1", "call_1");
    expect(callerCanSeeMock).toHaveBeenCalledWith("calls", "acct_1", "call_1");
    expect(vi.mocked(setTransferFollowedUp)).toHaveBeenCalledWith(serviceDbMock, "acct_1", "call_1", "user_1", expect.any(Date));
    expect(r).toEqual({ ok: true, at: expect.any(String) });
  });

  it("refuses when callerCanSee says no, without writing anything (mutation: skip the check -> FAILS)", async () => {
    callerCanSeeMock.mockResolvedValueOnce(false);
    const r = await completeFailedTransfer("acct_1", "call_1");
    expect(r.ok).toBe(false);
    expect(vi.mocked(setTransferFollowedUp)).not.toHaveBeenCalled();
  });

  it("reopenFailedTransfer passes the exact `at` it was given", async () => {
    vi.mocked(unstampAiActAccepted);  // keep both mocks referenced for lint
    await reopenFailedTransfer("acct_1", "call_1", "2026-11-06T15:00:00.000Z");
    expect(vi.mocked(clearTransferFollowup)).toHaveBeenCalledWith(
      serviceDbMock, "acct_1", "call_1", new Date("2026-11-06T15:00:00.000Z"));
  });
});

describe("acceptBookingAct / unacceptBookingAct (F-077 part 1)", () => {
  it("proves the act through the request client, then writes through serviceDb", async () => {
    const r = await acceptBookingAct("acct_1", "act_1");
    expect(callerCanSeeMock).toHaveBeenCalledWith("ai_acts", "acct_1", "act_1");
    expect(vi.mocked(stampAiActAccepted)).toHaveBeenCalledWith(serviceDbMock, "acct_1", "act_1", "user_1", expect.any(Date));
    expect(r).toEqual({ ok: true, at: expect.any(String) });
  });

  it("unacceptBookingAct passes the exact `at` it was given", async () => {
    await unacceptBookingAct("acct_1", "act_1", "2026-11-06T15:00:00.000Z");
    expect(vi.mocked(unstampAiActAccepted)).toHaveBeenCalledWith(
      serviceDbMock, "acct_1", "act_1", "user_1", new Date("2026-11-06T15:00:00.000Z"));
  });
});
```

  Run `pnpm --filter web exec vitest run "src/app/(dashboard)/dashboard/accounts/[accountId]/tasks/actions.test.ts"`. Expected red: `completeFailedTransfer is not a function` (module export missing).
- [ ] **Step 5: Implement**, placed after `closeOutBooking` (after line 192) in `actions.ts`:

```ts
export type FailedTransferDoneResult = { ok: true; at: string } | { ok: false; error: string; errorKey?: WorkActionErrorKey };
export type AcceptBookingActResult = { ok: true; at: string } | { ok: false; error: string; errorKey?: WorkActionErrorKey };

/**
 * "Called back" -- the failed-transfer row's own Done (F-077 part 1). `calls` grants `authenticated`
 * no write at all (0020) and `ai_acts` grants it no write either (0091), the SAME shape `bookings`
 * has -- so this writes through `serviceDb()`, behind a request-client proof that the caller may
 * see this call (`callerCanSee`, widened), exactly as `setBookingStatusAction` -> `proveBooking`
 * already does for bookings.
 */
export async function completeFailedTransfer(accountId: string, callId: string): Promise<FailedTransferDoneResult> {
  const { userId } = await requireAccountAccess(accountId);
  try {
    if (!(await callerCanSee("calls", accountId, callId))) return { ...ACTION_FAILED };
    const at = new Date();
    await setTransferFollowedUp(serviceDb(), accountId, callId, userId, at);
    revalidatePath(tasksPath(accountId));
    return { ok: true, at: at.toISOString() };
  } catch (e) {
    console.error(`completeFailedTransfer: call ${callId} (account ${accountId}): ${String(e)}`);
    return { ...ACTION_FAILED };
  }
}

/** Undo of completeFailedTransfer. */
export async function reopenFailedTransfer(accountId: string, callId: string, at: string): Promise<ActionResult> {
  // requireAccountAccess is the membership check itself; clearTransferFollowup's own column pair
  // (calls.transfer_followup_at alone, no "by" column -- unlike ai_acts.accepted_by) has nothing
  // for its returned userId to be written into, so it is not destructured.
  await requireAccountAccess(accountId);
  try {
    if (!(await callerCanSee("calls", accountId, callId))) return { ...ACTION_FAILED };
    if (!(await clearTransferFollowup(serviceDb(), accountId, callId, new Date(at)))) return { ...ACTION_FAILED };
    revalidatePath(tasksPath(accountId));
    return { ok: true };
  } catch (e) {
    console.error(`reopenFailedTransfer: call ${callId} (account ${accountId}): ${String(e)}`);
    return { ...ACTION_FAILED };
  }
}

/** "Accept" -- a booking-act row's own queue-only "I saw this" (F-077 part 1). Same serviceDb-behind-
 *  callerCanSee shape as completeFailedTransfer, for the same grant reason (ai_acts grants
 *  authenticated no write either, 0091_ai_acts.sql:117-119). */
export async function acceptBookingAct(accountId: string, actId: string): Promise<AcceptBookingActResult> {
  const { userId } = await requireAccountAccess(accountId);
  try {
    if (!(await callerCanSee("ai_acts", accountId, actId))) return { ...ACTION_FAILED };
    const at = new Date();
    if (!(await stampAiActAccepted(serviceDb(), accountId, actId, userId, at))) return { ...ACTION_FAILED };
    revalidatePath(tasksPath(accountId));
    return { ok: true, at: at.toISOString() };
  } catch (e) {
    console.error(`acceptBookingAct: act ${actId} (account ${accountId}): ${String(e)}`);
    return { ...ACTION_FAILED };
  }
}

/** Undo of acceptBookingAct. Never confused with the booking's OWN Undo (the record page's button,
 *  untouched by this action) -- the two never share a screen. */
export async function unacceptBookingAct(accountId: string, actId: string, at: string): Promise<ActionResult> {
  const { userId } = await requireAccountAccess(accountId);
  try {
    if (!(await callerCanSee("ai_acts", accountId, actId))) return { ...ACTION_FAILED };
    if (!(await unstampAiActAccepted(serviceDb(), accountId, actId, userId, new Date(at)))) return { ...ACTION_FAILED };
    revalidatePath(tasksPath(accountId));
    return { ok: true };
  } catch (e) {
    console.error(`unacceptBookingAct: act ${actId} (account ${accountId}): ${String(e)}`);
    return { ...ACTION_FAILED };
  }
}
```

  Add imports: `callerCanSee` from `@/lib/auth/visible`; `serviceDb, setTransferFollowedUp, clearTransferFollowup, stampAiActAccepted, unstampAiActAccepted` added to the existing `@bis/db` import at the top of the file.
- [ ] **Step 6: Green.** Re-run Step 4's test file; expected all green. Run `pnpm --filter web typecheck` and `pnpm --filter web lint` (0 errors).
- [ ] **Step 7: access-log-routes.test.ts.** At lines 163-164, widen the existing array (additive — do not touch the `W` constant or any other line):

```ts
  ...each(`${A}/tasks/actions.ts`, ["completeWorkTask", "reopenWorkTask", "dismissToTask", "closeOutBooking", "confirmStopFromTask",
    "notAStopFromTask", "undoHoldDecisionFromTask", "setTaskAssigneeAction",
    "completeFailedTransfer", "reopenFailedTransfer", "acceptBookingAct", "unacceptBookingAct"], W),
```

  Run `pnpm --filter web exec vitest run "src/app/(dashboard)/dashboard/accounts/[accountId]/access-log-routes.test.ts"`. Confirm red BEFORE this edit (paste the failing line naming the four new unclassified exports), green after.
- [ ] **Step 8: Commit** `feat(web): Called back and Accept, the two new To-do actions, write through serviceDb behind a visibility proof (F-077 part 1)` -- all seven paths.

---

### Task 5: Per-account UI

**Tier:** LOW-MEDIUM · **Owner:** bis-frontend · **Lane:** 1 · **Depends on:** T2, T3, T4

**Files:**
- Modify: `apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/tasks/work-list.tsx` (`primaryLabel` gains `zone` and two branches; `WorkRowItem`'s call site passes `timezone`)
- Modify: `apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/tasks/work-row-actions.tsx` (two new source branches; new props)
- Create: `apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/tasks/work-list.failedTransfer.test.ts`
- Create: `apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/tasks/work-list.bookingAct.test.ts`
- Modify: `apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/tasks/work-row-actions.test.ts` (regression lock for callbacks)

**Note:** `secondaryLine` (`work-list.tsx:116-119`) needs **no change** — its existing fallback (`return row.contactId ? contactName : null;`) already covers both new sources correctly (confirmed by reading the function: only `"conversation"` gets special treatment).

- [ ] **Step 1: Red first — failed transfer.** Create `work-list.failedTransfer.test.ts`, following `work-list.callback.test.ts`'s own structure exactly (same mocks, same `renderToStaticMarkup` pattern):

```ts
import { describe, it, expect, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { makeTr } from "@/lib/record/copy";
import type { WorkRow } from "@bis/db";
import { m } from "@/lib/messages";

vi.mock("./actions", () => ({
  completeWorkTask: vi.fn(), reopenWorkTask: vi.fn(), dismissToTask: vi.fn(), closeOutBooking: vi.fn(),
  confirmStopFromTask: vi.fn(), notAStopFromTask: vi.fn(), undoHoldDecisionFromTask: vi.fn(),
  completeFailedTransfer: vi.fn(), reopenFailedTransfer: vi.fn(), acceptBookingAct: vi.fn(), unacceptBookingAct: vi.fn(),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {} }) }));

const { WorkList } = await import("./work-list");

const transfer = (id: string, contactId: string | null, callbackNumber: string | null): WorkRow => ({
  id: `failed_transfer:${id}`, source: "failed_transfer", accountId: "a1", contactId, title: "",
  dueAt: null, occurredAt: "2026-11-06T15:00:00Z", callbackNumber,
});

describe("a failed-transfer row (F-077 part 1)", () => {
  it("renders the numbered sentence and the \"Called back\" button, in English and Spanish", () => {
    const en = renderToStaticMarkup(createElement(WorkList, {
      buckets: { overdue: [], today: [], waiting: [transfer("c1", "ct1", "9565551212")] },
      accountId: "a1", contactNames: { ct1: "Rio Flores" }, timezone: "America/Chicago", tr: makeTr("en"),
    }));
    expect(en).toContain(m["work.failedTransfer"].replace("{number}", "9565551212"));
    expect(en).toContain(`>${m["work.failedTransfer.done"]}<`);

    const es = renderToStaticMarkup(createElement(WorkList, {
      buckets: { overdue: [], today: [], waiting: [transfer("c1", "ct1", "9565551212")] },
      accountId: "a1", contactNames: { ct1: "Rio Flores" }, timezone: "America/Chicago", tr: makeTr("es"),
    }));
    expect(es).toContain(m["work.failedTransfer.es"].replace("{number}", "9565551212"));
    expect(es).toContain(`>${m["work.failedTransfer.done.es"]}<`);
  });

  it("falls back to the bare sentence with no number (mutation: swap the .bare branch's condition -> a numbered row renders bare or vice versa -> FAILS)", () => {
    const out = renderToStaticMarkup(createElement(WorkList, {
      buckets: { overdue: [], today: [], waiting: [transfer("c1", null, null)] },
      accountId: "a1", contactNames: {}, timezone: "America/Chicago", tr: makeTr("en"),
    }));
    expect(out).toContain(m["work.failedTransfer.bare"]);
    expect(out).not.toContain(m["work.failedTransfer"].split(" {number}")[0]);
  });

  it("a contact-less row renders as the non-link <div> branch, not a <Link href=\"#\"> (mutation: default href to \"#\" instead of null -> FAILS)", () => {
    const out = renderToStaticMarkup(createElement(WorkList, {
      buckets: { overdue: [], today: [], waiting: [transfer("c1", null, "9565551212")] },
      accountId: "a1", contactNames: {}, timezone: "America/Chicago", tr: makeTr("en"),
    }));
    const row = out.split("<li").slice(1).find((r) => r.includes("9565551212"))!;
    expect(row).not.toMatch(/<a\s/);
    expect(row).toMatch(/<div[^>]*data-work-row-link/);
  });
});
```

- [ ] **Step 2: Red first — booking act.** Create `work-list.bookingAct.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { makeTr } from "@/lib/record/copy";
import type { WorkRow } from "@bis/db";
import type { AiAct } from "@bis/db/ai-act-rules";
import { m } from "@/lib/messages";

vi.mock("./actions", () => ({
  completeWorkTask: vi.fn(), reopenWorkTask: vi.fn(), dismissToTask: vi.fn(), closeOutBooking: vi.fn(),
  confirmStopFromTask: vi.fn(), notAStopFromTask: vi.fn(), undoHoldDecisionFromTask: vi.fn(),
  completeFailedTransfer: vi.fn(), reopenFailedTransfer: vi.fn(), acceptBookingAct: vi.fn(), unacceptBookingAct: vi.fn(),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {} }) }));

const { WorkList } = await import("./work-list");

const ACT: AiAct = {
  id: "act1", accountId: "a1", actor: "voice", callId: "call1", chatId: null, contactId: "ct1",
  kind: "booking_cancelled", target: { bookingId: "bk1" },
  before: { startsAt: "2026-11-10T16:00:00Z", endsAt: "2026-11-10T17:00:00Z" }, after: { version: "2026-11-10T15:00:00Z" },
  createdAt: "2026-11-06T15:00:00Z", undoneAt: null, undoneBy: null, undoNotified: false,
};
const bookingActRow = (): WorkRow => ({
  id: "booking_act:act1", source: "booking_act", accountId: "a1", contactId: "ct1", title: "",
  dueAt: null, occurredAt: "2026-11-06T15:00:00Z", bookingAct: ACT,
});

describe("a booking-act row (F-077 part 1)", () => {
  it("renders describeAct's own verb verbatim and offers exactly one button, Accept/Aceptar (mutation: render a second button -> the exactly-one-child-button assertion FAILS)", () => {
    const en = renderToStaticMarkup(createElement(WorkList, {
      buckets: { overdue: [], today: [], waiting: [bookingActRow()] },
      accountId: "a1", contactNames: { ct1: "Pat Nunez" }, timezone: "America/Chicago", tr: makeTr("en"),
    }));
    const row = en.split("<li").slice(1).find((r) => r.includes("Pat Nunez"))!;
    expect(row).toContain(">" + m["work.act.accept"] + "<");
    const buttons = row.match(/<button[^>]*>/g) ?? [];
    expect(buttons.length).toBe(1);

    const es = renderToStaticMarkup(createElement(WorkList, {
      buckets: { overdue: [], today: [], waiting: [bookingActRow()] },
      accountId: "a1", contactNames: { ct1: "Pat Nunez" }, timezone: "America/Chicago", tr: makeTr("es"),
    }));
    expect(es).toContain(">" + m["work.act.accept.es"] + "<");
  });
});
```

- [ ] **Step 3: Regression lock for callbacks.** Append to `work-row-actions.test.ts` (or `work-list.callback.test.ts`, whichever already imports `WorkList` with a `callId`-bearing task row — reuse that file's existing `task(...)` helper):

```ts
it("a callback task row's action is the generic task Done button, never the failed-transfer branch (mutation: route callId-bearing task rows through the failed_transfer branch by mistake -> this row's Undo would be missing, since that branch has none -> FAILS)", () => {
  const out = renderToStaticMarkup(createElement(WorkList, {
    buckets: { overdue: [], today: [task("t1", "Call back at 9565061545: Roof leak", "call1")], waiting: [] },
    accountId: "a1", contactNames: { c1: "Ana Reyes" }, timezone: "America/Chicago", tr: makeTr("en"),
  }));
  expect(out).toContain(`>${m["work.done"]}<`);
  expect(out).not.toContain(m["work.failedTransfer.done"]);
});
```

- [ ] **Step 4: Run all four new/modified test files; expected red** (module exports / branches missing), paste the exact failing lines.
- [ ] **Step 5: Implement.** In `work-list.tsx`, import `describeAct` (`import { describeAct } from "@/lib/ai-acts/kinds";`) and widen `primaryLabel` (lines 102-106):

```ts
function primaryLabel(row: WorkRow, contactName: string, tr: Tr, zone: string): string {
  if (row.source === "task") return row.title;
  if (row.source === "conversation") return tr.text("work.conversation", { name: contactName });
  if (row.source === "failed_transfer") {
    return row.callbackNumber
      ? tr.text("work.failedTransfer", { number: row.callbackNumber })
      : tr.text("work.failedTransfer.bare");
  }
  if (row.source === "booking_act") return describeAct(row.bookingAct!, { tr, zone }).verb;
  return tr.text("work.booking");
}
```

  At the one call site inside `WorkRowItem` (around line 220), pass `timezone`: `const primary = primaryLabel(row, contactName, tr, timezone);`.

  In `work-row-actions.tsx`, `WorkRowActions` destructures its props directly in the function signature (lines 60-84: `{ source, rawId, contactId, label, completeWorkTask, reopenWorkTask, dismissToTask, closeOutBooking }: { ... }`). Add the four new names to BOTH the destructuring list and its type:

```ts
export function WorkRowActions({
  source, rawId, contactId, label,
  completeWorkTask, reopenWorkTask, dismissToTask, closeOutBooking,
  completeFailedTransfer, reopenFailedTransfer, acceptBookingAct, unacceptBookingAct,
}: {
  source: WorkSource;
  rawId: string;
  contactId: string | null;
  label: string;
  completeWorkTask: (taskId: string) => Promise<ActionResult>;
  reopenWorkTask: (taskId: string) => Promise<ActionResult>;
  dismissToTask: (row: { source: WorkSource; contactId: string | null; title: string }) => Promise<DismissResult>;
  closeOutBooking: (bookingId: string, status: "completed" | "no_show") => Promise<ActionResult>;
  completeFailedTransfer: (callId: string) => Promise<FailedTransferDoneResult>;
  reopenFailedTransfer: (callId: string, at: string) => Promise<ActionResult>;
  acceptBookingAct: (actId: string) => Promise<AcceptBookingActResult>;
  unacceptBookingAct: (actId: string, at: string) => Promise<ActionResult>;
}) {
```

  Add `FailedTransferDoneResult, AcceptBookingActResult` to this file's existing `import type { ActionResult, DismissResult, WorkActionErrorKey } from "./actions";` line.

  Add two handler functions beside `runComplete`/`runDismiss`/`runBooking`:

```ts
  function runFailedTransferDone() {
    startTransition(async () => {
      const result = await completeFailedTransfer(rawId);
      if (!result.ok) { toast.error(failureText(result, locale)); return; }
      toast.success(t(m, "work.done.toast", locale), {
        action: {
          label: t(m, "common.undo", locale),
          onClick: () => startTransition(async () => {
            const r = await reopenFailedTransfer(rawId, result.at);
            if (!r.ok) toast.error(failureText(r, locale));
          }),
        },
      });
    });
  }

  function runAcceptBookingAct() {
    startTransition(async () => {
      const result = await acceptBookingAct(rawId);
      if (!result.ok) { toast.error(failureText(result, locale)); return; }
      toast.success(t(m, "work.act.accept.toast", locale), {
        action: {
          label: t(m, "common.undo", locale),
          onClick: () => startTransition(async () => {
            const r = await unacceptBookingAct(rawId, result.at);
            if (!r.ok) toast.error(failureText(r, locale));
          }),
        },
      });
    });
  }
```

  Add the two branches, before the final `booking` fallback (after the `"conversation"` branch, around line 158):

```ts
  if (source === "failed_transfer") {
    return (
      <Button data-work-row-done type="button" variant="ghost" size="sm" className={TOUCH} disabled={pending} onClick={runFailedTransferDone}>
        {t(m, "work.failedTransfer.done", locale)}
      </Button>
    );
  }

  if (source === "booking_act") {
    return (
      <Button type="button" variant="ghost" size="sm" className={TOUCH} disabled={pending} onClick={runAcceptBookingAct}>
        {t(m, "work.act.accept", locale)}
      </Button>
    );
  }
```

  In `work-list.tsx`, widen the `WorkActionProps` type (lines 44-52) with the same four fields `work-row-actions.tsx` now declares:

```ts
type WorkActionProps = {
  completeWorkTask: (taskId: string) => Promise<ActionResult>;
  reopenWorkTask: (taskId: string) => Promise<ActionResult>;
  dismissToTask: (row: { source: WorkSource; contactId: string | null; title: string }) => Promise<DismissResult>;
  closeOutBooking: (bookingId: string, status: "completed" | "no_show") => Promise<ActionResult>;
  confirmStopFromTask: (taskId: string) => Promise<TextsActionResult>;
  notAStopFromTask: (taskId: string) => Promise<TextsActionResult>;
  undoHoldDecisionFromTask: (contactId: string, eventId: string, reopenTaskIds: string[]) => Promise<TextsActionResult>;
  completeFailedTransfer: (callId: string) => Promise<FailedTransferDoneResult>;
  reopenFailedTransfer: (callId: string, at: string) => Promise<ActionResult>;
  acceptBookingAct: (actId: string) => Promise<AcceptBookingActResult>;
  unacceptBookingAct: (actId: string, at: string) => Promise<ActionResult>;
};
```

  Add `FailedTransferDoneResult, AcceptBookingActResult` to `work-list.tsx`'s existing `import type { ActionResult, DismissResult } from "./actions";` line. In the `actions: WorkActionProps` object built inside `WorkList` (lines 437-445), add the four bound actions:

```ts
  const actions: WorkActionProps = {
    completeWorkTask: completeWorkTask.bind(null, accountId),
    reopenWorkTask: reopenWorkTask.bind(null, accountId),
    dismissToTask: dismissToTask.bind(null, accountId),
    closeOutBooking: closeOutBooking.bind(null, accountId),
    confirmStopFromTask: confirmStopFromTask.bind(null, accountId),
    notAStopFromTask: notAStopFromTask.bind(null, accountId),
    undoHoldDecisionFromTask: undoHoldDecisionFromTask.bind(null, accountId),
    completeFailedTransfer: completeFailedTransfer.bind(null, accountId),
    reopenFailedTransfer: reopenFailedTransfer.bind(null, accountId),
    acceptBookingAct: acceptBookingAct.bind(null, accountId),
    unacceptBookingAct: unacceptBookingAct.bind(null, accountId),
  };
```

  Add `completeFailedTransfer, reopenFailedTransfer, acceptBookingAct, unacceptBookingAct` to `work-list.tsx`'s existing `./actions` import (line 24-27). At the `WorkRowActions` call site inside `WorkRowItem` (lines 332-341), pass the four new props straight through from `actions`:

```tsx
            <WorkRowActions
              source={row.source}
              rawId={rawRowId(row)}
              contactId={row.contactId}
              label={primary}
              completeWorkTask={actions.completeWorkTask}
              reopenWorkTask={actions.reopenWorkTask}
              dismissToTask={actions.dismissToTask}
              closeOutBooking={actions.closeOutBooking}
              completeFailedTransfer={actions.completeFailedTransfer}
              reopenFailedTransfer={actions.reopenFailedTransfer}
              acceptBookingAct={actions.acceptBookingAct}
              unacceptBookingAct={actions.unacceptBookingAct}
            />
```
- [ ] **Step 6: Green.** Re-run all four test files; expected all green. Run each named mutation and paste the failing-by-name line. Run `pnpm --filter web typecheck` and `pnpm --filter web lint`.
- [ ] **Step 7: Commit** `feat(web): the To do queue renders a failed-transfer row and a booking-act row, each with its one action (F-077 part 1)` -- all six paths.

---

### Task 6: Agency UI

**Tier:** LOW-MEDIUM · **Owner:** bis-frontend · **Lane:** 2 · **Depends on:** T2, T3

**Files:**
- Modify: `apps/web/src/app/(dashboard)/dashboard/work/agency-work-list.tsx` (`primaryLabel` gains two branches, matching this screen's existing English-only posture — see "Deviations")
- Modify: `apps/web/src/app/(dashboard)/dashboard/work/agency-work-list.test.ts` (text-only, zero-buttons assertions for both new sources)

**Note:** `secondaryLine` (lines 86-89) needs no change, same reasoning as Task 5.

- [ ] **Step 1: Red first.** Append to `agency-work-list.test.ts`:

```ts
describe("the two new sources on the agency screen (F-077 part 1)", () => {
  it("renders the failed-transfer sentence and NO button (mutation: render a button for either new source -> the zero-buttons assertion FAILS)", () => {
    const out = renderToStaticMarkup(createElement(AgencyWorkList, {
      buckets: { overdue: [], today: [], waiting: [{
        id: "failed_transfer:c1", source: "failed_transfer", accountId: "a1", contactId: "ct1", title: "",
        dueAt: null, occurredAt: "2026-11-06T15:00:00Z", callbackNumber: "9565551212",
        brandName: "Rio Roofing", timezone: "America/Chicago", suppressed: false,
      }] },
      contactNames: { ct1: "Rio Flores" }, tr: makeTr("en"),
    }));
    expect(out).toContain(m["work.failedTransfer"].replace("{number}", "9565551212"));
    expect(out.match(/<button/g)).toBeNull();
  });

  it("renders describeAct's own verb for a booking-act row, and NO button", () => {
    const out = renderToStaticMarkup(createElement(AgencyWorkList, {
      buckets: { overdue: [], today: [], waiting: [{
        id: "booking_act:act1", source: "booking_act", accountId: "a1", contactId: "ct1", title: "",
        dueAt: null, occurredAt: "2026-11-06T15:00:00Z", bookingAct: ACT,
        brandName: "Rio Roofing", timezone: "America/Chicago", suppressed: false,
      }] },
      contactNames: { ct1: "Pat Nunez" }, tr: makeTr("en"),
    }));
    expect(out.match(/<button/g)).toBeNull();
    expect(out).toContain("Pat Nunez");
  });
});
```

  (`ACT` is the same fixture Task 5 Step 2 defines; declare it locally in this file too, or factor it into a tiny shared fixture module if both files already import from one — check `components/proposals/suggestion-specimens.ts` first, since `work-tray-demo.tsx` already reuses specimens from there; if the two files share none today, declare it locally rather than inventing a new shared module for two call sites.) Run the test file; expected red: TypeScript error (the two new `WorkSource` literals are not yet handled, or a runtime `undefined` call into `describeAct`).

- [ ] **Step 2: Implement.** Import `describeAct` (`import { describeAct } from "../accounts/[accountId]/calls/../../ai-acts/kinds";` — resolve the real relative path from this file's location, or use the `@/lib/ai-acts/kinds` absolute alias, which is simpler and already used elsewhere in this tree; prefer the alias) and `makeTr` (`import { makeTr } from "@/lib/record/copy";`). Widen `primaryLabel` (lines 80-84):

```ts
function primaryLabel(row: AgencyWorkRow, contactName: string): string {
  if (row.source === "task") return row.title;
  if (row.source === "conversation") return m["work.conversation"].replace("{name}", () => contactName);
  if (row.source === "failed_transfer") {
    return row.callbackNumber
      ? m["work.failedTransfer"].replace("{number}", () => row.callbackNumber!)
      : m["work.failedTransfer.bare"];
  }
  if (row.source === "booking_act") return describeAct(row.bookingAct!, { tr: makeTr("en"), zone: row.timezone }).verb;
  return m["work.booking"];
}
```

- [ ] **Step 3: Green.** Re-run the test file; expected all green. Run `pnpm --filter web typecheck` and `pnpm --filter web lint`.
- [ ] **Step 4: Commit** `feat(web): the agency work queue shows the two new sources, read-only, same as every other row there (F-077 part 1)` -- both paths.

---

### Task 7: e2e

**Tier:** MEDIUM · **Owner:** bis-e2e-qa · **Lane:** 2 · **Depends on:** T4, T5, T6. Written now; the orchestrator runs it, and it cannot go fully green until the migration hold clears (see Orchestrator checklist)

**Files:** create `apps/web/e2e/work-queue-actions.spec.ts`.

The spec runs on the per-run fixture account only (copy how `contacts-merge.spec.ts` or `record-history.spec.ts` makes and uses one), never `Test Client One`. Scope locators to `getByRole("main")`.

1. Seed a failed transfer directly against the fixture account's own database connection (an `abandoned` call with `handoff_requested_at` set, no `transfer_followup_at`, a `callback_number`) and a pending `booking_cancelled` `ai_acts` row for a contact the fixture already has a booking for — mirror how `calendar.spec.ts` or `record-history.spec.ts` seeds rows outside the UI for a scenario the UI itself cannot create.
2. Open `/dashboard/accounts/<fixture>/tasks`. Both rows appear in "Waiting," each with its one button ("Called back" / "Accept").
3. Click "Called back." The row disappears, an Undo toast appears. Click Undo. The row reappears.
4. Click "Accept." The row disappears, an Undo toast appears. Click Undo. The row reappears.
5. Open the contact's own record page; confirm the booking-act row's provenance mark on the timeline is unchanged (still names Sofía, still offers its OWN Undo) — Accept must not have altered it.

**Mutation probe:** in a scratch copy, make `listAccountWork` drop the `failed_transfers`/`listPendingBookingActs` sources from its `Promise.all`. Step 2 then FAILS by name (neither row appears); revert. Commit `test(e2e): the two new To-do rows show, act, and undo (F-077 part 1)`.

---

### Task 8: Roadmap and tracker

**Tier:** LOW · **Owner:** orchestrator · after merge. Update `docs/crm-features.md:1427` (F-077 part 1, from its current status to done, naming migration 0114 and the two new sources) and the roadmap tracker's F-077 row. Add a ledger entry naming the corrections above (grants, the unnecessary trigger edit, Technician visibility).

---

## Copy (every new string; English then *usted* Spanish)

| Key | English | Spanish |
|---|---|---|
| `work.failedTransfer` | Call back at {number} — they asked for a person | Devuelva la llamada al {number} — pidió hablar con alguien |
| `work.failedTransfer.bare` | A caller asked for a person and couldn't reach one | Alguien que llamó pidió hablar con una persona y no pudo comunicarse |
| `work.failedTransfer.done` | Called back | Llamada devuelta |
| `work.act.accept` | Accept | Aceptar |
| `work.act.accept.toast` | Accepted. | Aceptado. |

Toasts for the failed-transfer row reuse the existing, generic `work.done.toast` ("Marked done." / "Marcado como hecho."). Both Undos reuse the existing `common.undo` / "Deshacer" (owner ruling 3) — never a new word.

## PR split

**One PR**, built and reviewed in full now, pushed and held. The spec's own owner ruling frames this as singular ("this part's PR is built now and its migration is applied only after 0113 is on production, the same hold as F-115 PR E"), and unlike F-115's multi-stage observe/enforce rollout, this migration is a single small additive step with no backfill and no correctness window to wait out — the only gate is migration-NUMBER ordering against bis-ci. `verify`'s own test run goes green on push (its fresh local stack applies every migration file in the branch, 0114 included, regardless of bis-ci's remote state). `e2e`'s separate migration-history check stays red, by name, until 0113 then 0114 are pushed to bis-ci (both after 2026-11-11) — and because the branch-protection ruleset requires both checks green on the head SHA with no bypass actor, the PR mechanically cannot merge before that, which is the enforcement mechanism, not merely a reminder in this plan.

## Orchestrator checklist (in order)

1. Confirm the migration number is still free (Global Constraints) immediately before T1 starts.
2. T1 HIGH review: a bis-reviewer on their OWN replica (port 56096) runs every named mutation in Task 1, confirms the pre/post digest and definer count are unchanged, and confirms by inspection (not by running) that no `create or replace function` appears anywhere in `0114_work_queue_actions.sql`.
3. T2-T6 reviews (one pass each, per their MEDIUM/LOW-MEDIUM tier), then the repo-wide gates from Rule 7 above, then push the branch.
4. Read `verify` and `e2e` FOR THE HEAD SHA (`gh api repos/:owner/:repo/commits/<sha>/check-runs`), never an earlier run. Expect `verify` green. Expect `e2e`'s migration-history sub-step red, naming `0113_record_changes_enforce.sql` (if it does not yet exist on bis-ci) and `0114_work_queue_actions.sql` — this is the expected, held state; every OTHER part of `e2e` (the app's own test run against its fresh local stack) should still be green, since that stack applies every migration in the branch regardless of bis-ci.
5. Hold the PR open. Do not push `ci-project-setup.yml` for 0114 until AFTER the orchestrator has confirmed F-115's own 0113 is on bis-ci AND on production (that is a different plan's checklist item, read `docs/superpowers/plans/2026-11-02-record-history.md`'s own D0-D2 for its gate). Re-check `git ls-tree --name-only origin/main packages/db/supabase/migrations/ | tail -3` on or after 2026-11-11.
6. Once 0113 is confirmed on bis-ci and production: push 0114 to bis-ci (`ci-project-setup.yml`, `push-dry-run` then `push`), re-run the pre/post-checks below, then to production (MCP `apply_migration`, name `work_queue_actions`, the file's exact text), then the parity check (`docs/runbooks/ci-supabase-project.md`).
7. Re-read `e2e` for a fresh push's head SHA; its migration-history check should now be green. Run `pnpm --filter web test:e2e` for Task 7's new spec specifically (one gate at a time, per the top-level working rules), on the per-run fixture account.
8. Merge. Then Task 8.

**Pre-checks (read-only, before each apply):** the definer count (39, unchanged) and the client-write digest (Task 1 Step 1's query). `select to_regclass('public.calls')`/`'public.ai_acts'` both non-null already. **Post-checks:** the same two values, unchanged. `select column_name from information_schema.columns where table_name = 'calls' and column_name = 'transfer_followup_at'` returns one row. `select conname from pg_constraint where conrelid = 'public.ai_acts'::regclass and conname in ('ai_acts_accepted_pair','ai_acts_not_both_accepted_and_undone')` returns both. `has_table_privilege('authenticated','public.calls','UPDATE')` and the same for `public.ai_acts` are both `false`. Any other answer: stop before the next project and report.

## Not in this plan

Everything part 2 owns, named in the spec's §2 "Out" list: a general dismissals table, contact-created/contact-field-filled `ai_acts` as loose ends, the alert half of F-035, "Not now" for either new source, and a reply box in the queue. The callback row's own regression test (§6, Task 5 Step 3) is the only work this part does for callbacks — no code changes there, confirmed (Correction-adjacent finding, not a correction: `work-row-actions.tsx`'s task branch is untouched by this plan).

## Findings outside scope (unfixed, for the ledger)

- `listAccountWork`'s `Promise.all` fan-out already fails the WHOLE queue read when any ONE source errors (`work-queue.ts`'s own existing behavior, pre-dating this part); this plan's two new sources inherit that same failure boundary rather than fixing it, matching the spec's own §5 "Error" note.
- A Technician's visibility into an unidentified-caller failed transfer is zero (Correction 3) because `0068`'s `calls_technician_scope` has no null-`contact_id` carve-out the way `tasks_technician_scope` does. This may be worth a small, separate migration someday (adding a `contact_id is null and <some per-call assignment> ` clause analogous to tasks' own 4d case) but is out of this part's named scope and not built here.
- `agency-work-list.tsx`'s bucketed rows (task/conversation/booking, and now failed_transfer/booking_act) are English-only; its OWN suggestion-tray section below them is already bilingual. Nobody has asked for the bucketed rows to be localized, and this plan does not change that; flagged only because Task 6 had to make an explicit choice about it (see "Deviations").

## Self-review (2026-11-06)

- **Spec coverage.** §1-2 (scope, what exists) → Global Constraints, Correction 6. §3.1 (callbacks) → Task 5 Step 3 (regression lock), "Not in this plan." §3.2 (failed transfers) → T1 (column), T2 (reader + writers), T4 (actions), T5/T6 (UI); its "Who may" is corrected (Correction 3) and its grant claim is corrected (Correction 1). §3.3 (booking acts) → T1 (columns + the trigger non-edit, Correction 2), T3 (reader + writers), T4 (actions), T5/T6 (UI). §4 (migrations) → T1, with Corrections 1-2 removing the grant and the trigger edit the spec called for. §5 (UI, states, copy) → T5, T6, Copy section. §6 (risks, tests, task list) → every named test is placed in a task above; item 7 (styleguide) is Correction 6, dropped. §7 (owner decisions) and §8 (binding rulings) → Global Constraints, Deviations section, and the per-task Steps that implement them (booking-only kinds in T3's `BOOKING_ACT_KINDS`; no stored task/no alert in T2's doc comment; `common.undo` reuse in T5's `runAcceptBookingAct`; no "Not now" — absent from every new branch; "Called back" wording — `work.failedTransfer.done`).
- **Placeholders.** None found by `grep -n "TBD\|TODO\|implement later\|fill in\|appropriate error handling\|add validation\|handle edge cases\|Similar to Task"` over this file. Every code block is complete, runnable TypeScript or SQL, not a sketch.
- **Type consistency.** `FailedTransferDoneResult`/`AcceptBookingActResult` are spelled identically in "Shared facts," Task 4's implementation, and Task 5's `WorkRowActions` props. `WorkSource`'s two new literals (`failed_transfer`, `booking_act`) are spelled identically everywhere they appear (T2, T3, T5, T6). `callbackNumber`/`bookingAct` on `WorkRow` are spelled identically in "Shared facts," T2, T3, T5 and T6. `setTransferFollowedUp`/`clearTransferFollowup`/`stampAiActAccepted`/`unstampAiActAccepted` keep the same parameter order and names (`db, accountId, <id>, by, at` for the stamps; `db, accountId, <id>, at` for `clearTransferFollowup`, which genuinely has no `by`-bearing column — see Correction 5) everywhere they are called, including inside T4's mocked action tests.
