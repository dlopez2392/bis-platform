# F-196 part 1: the fan-out tick and the job queue, Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every registered pass runs in its own invocation behind a dependency-graph dispatcher (switch `CRON_FANOUT`, off at merge), and a `jobs` table (migration 0102) with `enqueue()` and a drain takes one-off, retryable work.

**Architecture:** `/api/cron/reminders` stays the one cron. With `CRON_FANOUT=1` and `APP_ORIGIN` set it walks `PLAN` (`lib/automations/fanout.ts`) and POSTs each node to `${APP_ORIGIN}/api/cron/pass/<key>` (90 s) or `/api/cron/pass/jobsDrain` (300 s), awaiting each, starting a node only when its predecessors allow. With the switch off, or `APP_ORIGIN` unset, it runs today's in-process `runPasses`. The queue is Postgres: `claim_jobs` (`FOR UPDATE SKIP LOCKED`, leases, dead-letter on a run-out last attempt), `sweep_jobs` (retention), plain PostgREST writes fenced by `claim_token`.

**Tech Stack:** Next.js 16.3.6 route handlers, Supabase Postgres 17 (service-only table), `@supabase/supabase-js`, vitest, `resend` ^6.18.1, Node `fetch`.

**Spec:** `docs/superpowers/specs/2026-10-28-background-job-runner-design.md` (all of it; §14 holds the owner's four rulings). Where this plan differs, see "Spec corrections" below; nothing else deviates.

## Global Constraints

- **Tiers per TASK** (binding since 2026-10-19). HIGH: brief review, opus review with the probes below, re-review. MEDIUM: implementer + one review. LOW: implementer only, covered by the end-of-PR review.
- **The switch.** `fanoutEnabled(env) = env.CRON_FANOUT === "1"`; nothing else is on (not `"true"`, not `" 1"`). Off at merge. Off is the fast rollback (unset + redeploy).
- **One tick, one now.** The dispatcher's `now` travels in every pass body; a pass route builds its context from that `now`, never `new Date()`. A pass route refuses a `now` older than 900 s or more than 60 s ahead of its own clock.
- **Auth unchanged in shape:** `CRON_SECRET` unset → 503 with zero queries; bearer mismatch → 401 with zero queries, constant-time compare. One helper, `cronAuthorized`, serves the dispatcher, both pass routes and `demo-refresh`.
- **Links never from a request host under fan-out:** the dispatcher fans out only with `APP_ORIGIN` set; a pass route with `APP_ORIGIN` unset answers 503 with zero queries.
- **Heartbeats:** the pass route writes `cron.pass.<key>` (through `runPass`), never `cron.tick`. The dispatcher writes `cron.pass.<key>` failed for a non-200 or no answer, before any `regardless` node starts, and `cron.tick` once at the end. Queue keys: `jobs.dead`, `jobs.backlog` (both fit 0057's `^[A-Za-z0-9_.-]{1,80}$`, `packages/db/src/ops.ts:33`).
- **Pass keys are the registry's own `key` fields** (pinned at `lib/automations/sentinel.test.ts:305`), not the export names. Twenty passes, in order: billingPause, releaseHeld, cancelNotices, reminders, followups, reviewRequests, referralAsks, noShowNudges, smsReminders, appointmentConfirms, reactivations, quoteFollowups, siteTraffic, documentsSweep, documentsScan, documentsExpiry, weeklyClientReport, weeklyAgencyReport, usageReport, opsWatch. `PLAN` has those twenty plus `jobsDrain`: 21 nodes.
- **0102 is additive, ASCII only, no backslash** (the MCP apply rule). Functions are SECURITY INVOKER with `set search_path = pg_catalog, pg_temp` (0096's rule; `definer-search-path.test.ts` scans it).
- **DB tests (`packages/db`).** No `@bis/db` vitest runs locally against bis-ci on this branch until the orchestrator has 0102 on bis-ci: `jobs` joins `ACCOUNT_OWNED_TABLES`, which the globalSetup sweep (`src/test/global-setup.ts` → `sweepAbandonedFixtures`) walks, so every db test file fails on a missing table. `withRollback` tests are proven on a local PG18 replica (ledger kit, memory `bis-local-db-replica`: PG18 at `C:\Program Files\PostgreSQL\18`, `initdb -E UTF8 --locale=C --locale-provider=icu --icu-locale=en-US`, `alter database … set timezone to 'UTC'` on BOTH dbs, roles, bootstrap privileges from `packages/db/supabase/bootstrap/ci-project.sql:58-63,72-73`, every migration with `psql -1 -f`, `pre` then `post = template pre` + 0102). Each agent uses its own port from 55700 up and its own scratch subdirectory, blanks every Supabase credential for the run, and sets only `SUPABASE_DB_URL=postgresql://postgres@localhost:<port>/<db>`. `serviceDb` tests (`jobs-store.test.ts`) are proven by CI `verify` only.
- **Mocks.** No existing `vi.mock("@bis/db", …)` factory needs a new export, provided the import rules below hold. Grep at write time (run it again before each wave): `grep -rl 'vi.mock("@bis/db"' --include=*.test.ts apps/web/src/lib/automations apps/web/src/app/api/cron` → 28 files; of those, 3 are bare factories: `passes/cancel-notices.test.ts` and `passes/documents-scan.test.ts` (`() => ({`), and `passes/ops-watch.test.ts:8` (`() => db`). None of the three imports the harness, the routes or anything under `jobs/`. The rules: `fanout.ts`, `cron-auth.ts`, `pass-route.ts` and `harness.ts` import NO new `@bis/db` symbol (heartbeat keys are template strings, as `harness.ts:49` does today; `recordHeartbeat` is already in `route.test.ts:191`); only `jobs/enqueue.ts` and `passes/jobs-drain.ts` import the new `jobs.ts` exports, and only new test files import those two. A task that breaks a rule lists every factory it must extend.
- **Tests run by path, never the gates** (`pnpm check`, build, e2e are the orchestrator's). Judge by vitest's own summary line.
- **Commits:** `git add <explicit paths>` then `git commit -m "…" -- <same paths>`; never `-A`, never `git stash`, `git checkout` or `--amend`; never push.
- **No e2e** (bis-e2e-qa not engaged): nothing here renders, and Playwright cannot drive Vercel's cron or a server-to-server fan-out; the proof is the unit and replica suites plus the orchestrator's local fan-out run and production watch (checklist).

## Spec corrections (file:line evidence; the plan follows the code)

1. **Pass keys.** The spec's plan table (§4.2) names nodes `reviewRequest`, `referralAsk`, `noShowNudge`, `smsReminder`, `appointmentConfirm`, `reactivation`, `quoteFollowup`. The registry keys are `reviewRequests`, `referralAsks`, `noShowNudges`, `smsReminders`, `appointmentConfirms`, `reactivations`, `quoteFollowups` (`sentinel.test.ts:305`; e.g. `passes/review-request.ts` `key: "reviewRequests"`). The key is the URL segment and the heartbeat name, so the plan uses the keys.
2. **`settled` lets reactivations run beside a release that may still be sending.** As written (§4.2: "start once every predecessor has ANSWERED … or was not started"), a releaseHeld with no answer leaves reminders, noShowNudges, smsReminders and appointmentConfirms not started, and reviewRequests/referralAsks not started through `completed`; every predecessor of reactivations is then "not started", so it starts. `reactivation` has a releaser (`passes/release-held.ts:84`), so that is §5 row 2's double send, and it contradicts §11 test 16 ("no answer from releaseHeld leaves every recipe notStarted"). Fix: a not-started node records WHY. `blocked` (some ancestor gave no answer, so may still be running) propagates: `settled` and `completed` treat a `blocked` predecessor like a no-answer. `skipped` (a `completed` predecessor answered non-200) does not. Pinned by a test and a probe (Task 3).
3. **`imports.test.ts` scans import specifiers, not names** (`lib/automations/imports.test.ts:21-30`): "add `getSmsProvider` to a handler" (§11 test 14) can only fail as an import line, `import { getSmsProvider } from "@/lib/sms";`.
4. **`ACCOUNT_OWNED_TABLES` holds no `accounts` entry** (`packages/db/src/account-teardown.ts:20-37`; the account row is deleted after the loop). "Ordered before accounts" (§7, §11 test 9) reduces to "on the list"; the test asserts presence.
5. **Payload size (revised after the plan review; the first version's 4,096-byte bound is WITHDRAWN).** `octet_length(payload::text)` measures jsonb's own rendering, which no fixed ratio of `JSON.stringify` bounds: `{"a":1e300}` is 11 bytes as JSON and 308 as `jsonb::text` (numbers print in full). So `enqueue` keeps the spec's 8,192-byte pre-check on `JSON.stringify` AND maps a 23514 naming `jobs_payload_size_check` from the insert to the same refusal (`JobPayloadTooLarge`).
6. **Two spec probes cannot fail as written.** §11 test 5, "drop `for update` → the waiter gets the same job": without the lock the waiter's UPDATE blocks on the holder's row lock and raises 55P03; still red, for a different reason (the probe text below says so). §11 test 10, "drop the state filter → a queued row is deleted": `jobs_finished_has_time` keeps `finished_at` null on every non-final row, so the age test alone never matches a queued row. Substitute: drop `state = 'succeeded' and` from the first branch → a 10-day-old dead row is swept → FAILS.
7. **The second maxDuration reader.** Besides the sum test the spec names (`cron-coupling.test.ts:338-357`), `:301-316` also reads the route's `maxDuration` (≥ 2 × release budget). Both are retargeted to `LEGACY_TICK_CEILING_S`; the anchored live-export check moves to the new dispatcher case.
8. **§12 step 3 cannot run on Preview as written.** Preview leaves `APP_ORIGIN` unset (`docs/runbooks/production-isolation.md:863`) and holds no protection bypass ("Do not create 'Protection Bypass for Automation'", `:389-391`), and every Preview URL is behind Vercel Authentication. A Preview dispatcher therefore either runs in-process (no fan-out exercised) or, with `APP_ORIGIN` pointed at a preview URL, receives Vercel's login refusal from its own pass routes. Replacement in the orchestrator checklist: a local fan-out run against bis-ci, then production with the switch on and two ticks watched. The two Vercel ASSUMPTIONS (§4.2 a 504 at the ceiling; §4.3 a callee outliving its caller) are recorded "not checked". With correction 11 in place each failure direction is conservative for the one edge where a still-running predecessor causes a double send: under releaseHeld, ANY answer but 200 (a 504, or a 502/503 from Vercel's proxy while the function may still run) and no answer both block every recipe. Elsewhere a `settled` edge still releases on any answer; those edges order sends, not prevent duplicates (§5 rows 3-9), so a predecessor still running past a non-200 costs ordering at worst. A callee killed with its caller leaves rows unstamped, due next tick.
9. **A pass route with `APP_ORIGIN` unset** is not specified; §4.2 item 4 names `configuredOrigin()` only. The plan answers 503 with zero queries.
10. **Timeouts are `setTimeout` + `AbortController`**, not `AbortSignal.timeout`, in the drain, so vitest's fake timers drive the timeout test (ASSUMPTION: vitest's fake timers do not fake `AbortSignal.timeout`). Same behaviour.
11. **The release edge needs more than `settled`** (plan review I3). Under `settled` any HTTP answer releases the recipes, but a 502/503/5xx from Vercel's proxy does not prove the release function ended (ASSUMPTION either way), and the reminder due-list filters only on `reminder_sent_at is null` (`packages/db/src/booking.ts:1466`), so releaseHeld and reminders could send one subject twice in one tick. New rule `released`: start only on a 200 (with readable counters); any other answer or no answer → `blocked`, which propagates. The six recipes directly after releaseHeld use it.
12. **Idempotency is per account** (plan review I7; spec §7 amended in the same commit): `constraint jobs_kind_key unique nulls not distinct (kind, account_id, idempotency_key)` (PG15+; bis-ci and production are PG17, the replica PG18), so two accounts' identical keys are two jobs and a platform key (null account) still collides with itself. `insertJob`/`enqueue` answer `{ id, created, state }` so a caller can tell a dead duplicate from a live one.
13. **"Behaves as today" with the switch off is not literal** (spec §12.2 amended): the merged build's in-process tick has 800 s, not 300 s, and Task 4's one 429 retry is live on EVERY send path, request paths and `after()` callbacks included, from the merge. The PR body says so.

Findings, not corrections (record in the ledger): `fetch` in Node (undici) has a default 300 s headers timeout (ASSUMPTION), so `JOBS_DRAIN_BUDGET_MS` is 200 s (spec §9 said 240 s; amended), leaving a drain's normal finish well under it. A drain that still runs to its 300 s ceiling surfaces as a failure either way, and its only dependants are `regardless`, so nothing is blocked. The ctx's closure loader is now built per pass invocation rather than once per tick (`harness.ts:20`): more reads, the same answers.

## File map

| File | Task | Responsibility |
|---|---|---|
| `packages/db/supabase/migrations/0102_jobs.sql` | 1 | table, indexes, `claim_jobs`, `sweep_jobs`, grants |
| `packages/db/src/test/jobs-schema.test.ts` | 1 | grants, RLS, CHECKs, unique, claim race, lease, dead-letter, sweep, cascade |
| `packages/db/src/account-teardown.ts` | 1 | `jobs` on `ACCOUNT_OWNED_TABLES` |
| `packages/db/src/jobs.ts` | 2 | typed PostgREST/RPC calls |
| `packages/db/src/index.ts` | 2 | barrel lines for `jobs.ts` |
| `packages/db/src/test/jobs-store.test.ts` | 2 | `jobs.ts` against PostgREST (CI only) |
| `apps/web/src/lib/automations/cron-auth.ts` (+ `.test.ts`) | 3 | `cronAuthorized` |
| `apps/web/src/lib/automations/harness.ts` (+ `harness.test.ts`) | 3 | extract `runPass` |
| `apps/web/src/lib/automations/fanout.ts` (+ `.test.ts`) | 3 | constants, `PLAN`, `runFanout`, `longestPathS`, `httpInvoke`, `fanoutEnabled` |
| `apps/web/src/app/api/cron/demo-refresh/route.ts` | 3 | use `cronAuthorized` |
| `apps/web/src/lib/http/retry-after.ts` (+ `.test.ts`) | 4 | `Retry-After` parsing, the wait cap, `SEND_TIMEOUT_MS` (neutral: both providers import it) |
| `apps/web/src/lib/email/resend.ts` (+ `resend.test.ts`) | 4 | one 429 retry |
| `apps/web/src/lib/sms/telnyx.ts` (+ `telnyx.test.ts`) | 4 | one 429 retry |
| `docs/runbooks/background-jobs.md`, `.env.example`, `apps/web/vitest.config.ts` | 5 | runbook, `CRON_FANOUT` line, env pin |
| `apps/web/src/lib/automations/jobs/{types,backoff,platform-ping,registry,enqueue}.ts` (+ `backoff.test.ts`, `enqueue.test.ts`, `registry.test.ts`) | 6 | the runner API |
| `apps/web/src/lib/automations/imports.test.ts` | 6, 8 | fixture reaches `jobs/` and the drain |
| `apps/web/src/lib/automations/pass-route.ts` (+ `.test.ts`) | 7 | `handlePassRequest`, `parseTickNow` |
| `apps/web/src/app/api/cron/pass/[key]/route.ts` (+ `route.test.ts`) | 7 | the 90 s pass route |
| `apps/web/src/app/api/cron/reminders/route.ts`, `route.fanout.test.ts` | 7 | the dispatcher |
| `apps/web/src/lib/automations/cron-coupling.test.ts` | 7, 8 | the new coupling |
| `apps/web/src/lib/automations/passes/jobs-drain.ts` (+ `.test.ts`) | 8 | the drain |
| `apps/web/src/app/api/cron/pass/jobsDrain/route.ts` (+ `route.test.ts`) | 8 | the 300 s drain route |
| `apps/web/src/lib/ops/watch.ts` (+ `watch.test.ts`) | 8 | two `describeKey` labels |

## Waves (one shared worktree; files are disjoint within a wave)

| Wave | Tasks (parallel) | Waits for |
|---|---|---|
| 1 | 1 (HIGH, bis-db-schema), 2 (MEDIUM, bis-automations), 3 (MEDIUM, bis-automations), 4 (HIGH, bis-comms), 5 (LOW, bis-platform) | nothing |
| 2 | 6 (MEDIUM, bis-automations), 7 (HIGH, bis-automations) | 6 ← 1, 2 (`jobs/registry.test.ts` reads 0102's file); 7 ← 3 |
| 3 | 8 (MEDIUM, bis-automations) | 2, 6, 7 |
| — | Orchestrator checklist | all |

`cron-coupling.test.ts` and `imports.test.ts` are each touched in two waves (7 then 8; 6 then 8), never twice in one wave.

---

### Task 1 (HIGH, bis-db-schema): migration 0102 and its proof

Writes the migration and its tests; never applies it anywhere but the local replica.

**Files:**
- Create: `packages/db/supabase/migrations/0102_jobs.sql`
- Create: `packages/db/src/test/jobs-schema.test.ts`
- Modify: `packages/db/src/account-teardown.ts:20-22`: add `"jobs",` on its OWN line directly AFTER the `"ai_ledger", "account_ai_settings",` line, with the comment `// F-196 (0102): background jobs (cascade too; spec 7 lists it).` The first two entries must stay `["ai_ledger", "account_ai_settings"]`: `ai-gateway-schema.test.ts:131` and `record-summaries-schema.test.ts:108` pin `ACCOUNT_OWNED_TABLES.slice(0, 2)`.
- Affected existing tests (run on `post`): `src/test/ai-gateway-schema.test.ts`, `src/test/record-summaries-schema.test.ts`, `src/test/schema-grants-guard.test.ts`, `src/test/definer-search-path.test.ts`.

**Interfaces — Produces:** table `public.jobs` (columns exactly as spec §7), `public.claim_jobs(p_kinds text[], p_limit integer default 1) returns setof public.jobs`, `public.sweep_jobs(p_limit integer) returns integer`, constraint names `jobs_kind_check`, `jobs_idempotency_key_check`, `jobs_payload_size_check`, `jobs_state_check`, `jobs_attempts_check`, `jobs_max_attempts_check`, `jobs_timeout_ms_check`, `jobs_last_error_check`, `jobs_kind_key`, `jobs_running_has_lease`, `jobs_finished_has_time`.

- [ ] **Step 1: Build the replica `pre`** on your port (55701) and DB `pre` with every migration through 0101 (kit in Global Constraints). Run the guard suites on `pre` to know the baseline: `cd packages/db && SUPABASE_DB_URL=postgresql://postgres@localhost:55701/pre pnpm exec vitest run src/test/schema-grants-guard.test.ts src/test/definer-search-path.test.ts`.

- [ ] **Step 2: Write `jobs-schema.test.ts`** (withRollback except the race case). Use `withRollback`/`actAs` from `./db` (`src/test/db.ts:4`), the matrix query of `ops-heartbeats-grants.test.ts:22-35`, a local `refusedWith(c, sql, params)` helper as `consent-writes-schema.test.ts` uses, and a local `account(c)` insert helper as that file does. Platform rows use `account_id null`. Cases, each title naming its probe:
  1. Privilege matrix over anon, authenticated, public, service_role × SELECT/INSERT/UPDATE/DELETE/TRUNCATE/REFERENCES/TRIGGER/MAINTAIN on `public.jobs` equals exactly service_role's DELETE, INSERT, SELECT, UPDATE. No column privilege for anon/authenticated/public (`has_any_column_privilege`).
  2. `relrowsecurity` true and zero rows in `pg_policy` for the table.
  3. `has_function_privilege` EXECUTE on `public.claim_jobs(text[], integer)` and `public.sweep_jobs(integer)`: true for service_role only.
  4. Each CHECK refuses 23514 naming its constraint: payload of 9,000 bytes (`jsonb_build_object('x', repeat('a', 9000))`), state `'paused'`, `max_attempts` 0, `timeout_ms` 61000, kind `'nodot'`, kind of 61 chars, `last_error` of 301 chars, idempotency key `''`, state `'running'` with null lease, state `'succeeded'` with null `finished_at`.
  5. `jobs_kind_key` is `unique nulls not distinct (kind, account_id, idempotency_key)` (Spec correction 12): a second platform insert (null account) of the same (kind, key) → 23505 `jobs_kind_key`; the same key under another kind is accepted; the same (kind, key) under two different accounts is accepted for BOTH; a second insert for the same account → 23505.
  6. **The claim race** (two `pg.Client`s as `consent-writes-schema.test.ts:330-350`; rows COMMITTED because both connections must see them): insert two due platform jobs of kind `t<RUN>.race` (RUN = random lowercase letters) and commit; holder `begin; set local role service_role; select * from claim_jobs(array['t<RUN>.race'], 1)` → one row; waiter `begin; set local role service_role; set local lock_timeout = '300ms'` claims → exactly one row, a DIFFERENT id, no error. `finally`: rollback both, `end()` both, then delete the two rows by kind on a third connection.
  7. A `running` row with `lease_until` in the past, attempts 1 of 3, token T → claimed again: same id, attempts 2, a new token ≠ T, a lease in the future. A `running` row under a live lease is not returned.
  8. A `running` row with a run-out lease and attempts 3 of 3 → not returned; afterwards `state = 'dead'`, `finished_at` set, lease and token null, `last_error = 'the worker stopped before finishing (lease expired)'`.
  9. A `queued` row with `run_after` an hour ahead is not claimed; a due row of a kind outside `p_kinds` is not claimed.
  10. `claim_jobs(…, 0)` and `(…, 51)` raise 22023.
  11. `sweep_jobs(10)`: deletes succeeded 8 days old and dead 31 days old; keeps succeeded 6 days, dead 10 days and 29 days, queued, retrying, running. With three sweepable rows `sweep_jobs(2)` returns 2 and deletes the two oldest.
  12. Deleting an account deletes its job; a platform job stays.
  13. `(ACCOUNT_OWNED_TABLES as readonly string[]).indexOf("jobs") >= 0` (pure; no DB).
  14. `jobs_kind_check`'s definition (`pg_get_constraintdef`) contains the literal `'^[a-z][a-z0-9_]*([.][a-z][a-z0-9_]*)+$'` (Task 6's twin reads the same literal from the file).

- [ ] **Step 3: Red on `pre`.** `cd packages/db && SUPABASE_DB_URL=postgresql://postgres@localhost:55701/pre pnpm exec vitest run src/test/jobs-schema.test.ts`. Expected: every DB case fails on `relation "public.jobs" does not exist` / 42883; case 13 fails (no `jobs` yet). Paste one failing assertion line.

- [ ] **Step 4: Write `0102_jobs.sql`.** Header comment in 0057's shape (WHY, ADDITIVE ONLY, WHO WRITES WHAT, the ASCII/backslash rule, ROLLBACK: `drop function public.sweep_jobs(integer); drop function public.claim_jobs(text[], integer); drop table public.jobs;`). Body: the spec §7 `create table` verbatim (as amended: `constraint jobs_kind_key unique nulls not distinct (kind, account_id, idempotency_key)`), the four indexes verbatim, then:

```sql
alter table public.jobs enable row level security;
revoke all on public.jobs from anon, authenticated, service_role;
grant select, insert, update, delete on public.jobs to service_role;

-- claim_jobs: spec section 7 "The claim", verbatim body.

create function public.sweep_jobs(p_limit integer)
returns integer
language plpgsql
security invoker
set search_path = pg_catalog, pg_temp
as $$
declare
  v_n integer;
begin
  if p_limit is null or p_limit < 1 or p_limit > 5000 then
    raise exception 'sweep_jobs: p_limit must be 1 to 5000' using errcode = '22023';
  end if;
  with doomed as (
    select id from public.jobs
     where (state = 'succeeded' and finished_at < now() - interval '7 days')
        or (state = 'dead' and finished_at < now() - interval '30 days')
     order by finished_at, id
     limit p_limit
     for update skip locked)
  delete from public.jobs j using doomed where j.id = doomed.id;
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

revoke all on function public.claim_jobs(text[], integer) from public, anon, authenticated, service_role;
grant execute on function public.claim_jobs(text[], integer) to service_role;
revoke all on function public.sweep_jobs(integer) from public, anon, authenticated, service_role;
grant execute on function public.sweep_jobs(integer) to service_role;
```

Add a `comment on` for the table and each function (plain ASCII). Check the file is ASCII with no backslash using a node byte scan WITH a positive control (memory: `grep -P` silently passes in Git Bash): `node -e "const b=require('fs').readFileSync('packages/db/supabase/migrations/0102_jobs.sql');const bad=[...b].filter(x=>x>127||x===92).length;const ctl=[...Buffer.from('a\\\\b')].filter(x=>x===92).length;console.log({bad,ctl})"` → expect `{ bad: 0, ctl: 1 }`.

- [ ] **Step 5: Green on `post`.** `create database post template pre`, `alter database post set timezone to 'UTC'`, `psql -1 -f` 0102 into `post`, add `"jobs"` to `ACCOUNT_OWNED_TABLES`, then run `jobs-schema.test.ts` and the four affected tests listed under Files on `post`. Paste the summary line.

- [ ] **Step 6: Probes, each applied to `post` (SQL) or the file (TS), run, red BY NAME, then reset `post` (drop and re-create from `pre` + 0102):**

| Probe | Red case |
|---|---|
| `grant select on public.jobs to authenticated` | 1 |
| `alter table public.jobs disable row level security` | 2 |
| `grant execute on function public.claim_jobs(text[], integer) to authenticated` | 3 |
| `alter table public.jobs drop constraint jobs_payload_size_check` | 4 (payload) |
| drop `jobs_kind_key`, add `unique (idempotency_key)` | 5 (other kind) |
| drop `jobs_kind_key`, add `unique nulls not distinct (kind, idempotency_key)` | 5 (two accounts) |
| drop `jobs_kind_key`, add `unique (kind, account_id, idempotency_key)` (nulls distinct) | 5 (second platform insert accepted) |
| move `"jobs"` to the front of `ACCOUNT_OWNED_TABLES` | `ai-gateway-schema.test.ts` slice(0, 2) |
| `create or replace` claim_jobs without `skip locked` | 6 (55P03) |
| `create or replace` claim_jobs without `for update skip locked` (waiter's UPDATE blocks on the holder's row lock) | 6 (55P03) |
| claim_jobs without `or (state = 'running' and lease_until < now())` | 7 |
| claim_jobs without the dead-letter UPDATE | 8 |
| claim_jobs without `and run_after <= now()` | 9 (future) |
| claim_jobs without `kind = any(p_kinds) and` | 9 (kind) |
| claim_jobs without the p_limit guard | 10 |
| sweep_jobs without `state = 'succeeded' and` | 11 (dead 10 days swept) |
| sweep_jobs with `'30 days'` → `'7 days'` | 11 (dead 10 days swept) |
| sweep_jobs without `limit p_limit` | 11 (limit) |
| recreate the FK without `on delete cascade` | 12 (23503) |
| remove `"jobs"` from `ACCOUNT_OWNED_TABLES` | 13 |

- [ ] **Step 7: Commit.**

```bash
git add packages/db/supabase/migrations/0102_jobs.sql packages/db/src/test/jobs-schema.test.ts packages/db/src/account-teardown.ts
git commit -m "feat(db): 0102 jobs table with claim, lease, dead letter and retention (F-196)" -- packages/db/supabase/migrations/0102_jobs.sql packages/db/src/test/jobs-schema.test.ts packages/db/src/account-teardown.ts
```

Report: the replica's red line, green summary, every probe's red test name. CI `verify` is the authority on PG17.

---

### Task 2 (MEDIUM, bis-automations): `packages/db/src/jobs.ts`

**Files:**
- Create: `packages/db/src/jobs.ts`
- Create: `packages/db/src/test/jobs-store.test.ts`
- Modify: `packages/db/src/index.ts` (one export block for `./jobs`, appended; touch no other line)

**Interfaces — Produces** (every name below is consumed by Tasks 6 and 8):

```ts
import type { SupabaseClient } from "@supabase/supabase-js";

export type JobState = "queued" | "running" | "retrying" | "succeeded" | "dead";
export type JobRow = {
  id: string; kind: string; account_id: string | null; idempotency_key: string; payload: unknown;
  state: JobState; run_after: string; attempts: number; max_attempts: number; timeout_ms: number;
  claim_token: string | null; lease_until: string | null; last_error: string | null;
  created_at: string; updated_at: string; finished_at: string | null;
};
export type NewJob = {
  kind: string; accountId: string | null; idempotencyKey: string; payload: unknown;
  runAfter: string; maxAttempts: number; timeoutMs: number;
};
export type JobFence = { id: string; claimToken: string };
export const JOB_ERROR_MAX_CHARS = 300;
export function boundJobError(error: string): string;          // NUL dropped, cut by code point to 300
export class JobPayloadTooLarge extends Error {}               // the one refusal for an oversize payload, app-side or 0102's CHECK
export async function insertJob(db: SupabaseClient, job: NewJob): Promise<{ id: string; created: boolean; state: JobState }>;
export async function claimJob(db: SupabaseClient, kinds: readonly string[]): Promise<JobRow | null>;
export async function completeJob(db: SupabaseClient, fence: JobFence, atIso: string): Promise<boolean>;
export async function retryJob(db: SupabaseClient, fence: JobFence, runAfterIso: string, error: string, atIso: string): Promise<boolean>;
export async function killJob(db: SupabaseClient, fence: JobFence, error: string, atIso: string): Promise<boolean>;
export async function sweepJobs(db: SupabaseClient, limit: number): Promise<number>;
export async function deadJobCounts(db: SupabaseClient): Promise<Record<string, number>>;
export async function oldestDueJob(db: SupabaseClient, nowIso: string): Promise<{ kind: string; runAfter: string } | null>;
```

Shape of the bodies (all throw `new Error("<fn> failed: " + error.message)` on a PostgREST error, as `listHeartbeats` does at `ops.ts:106`):
- `insertJob`: `.from("jobs").insert({ kind, account_id, idempotency_key, payload, run_after, max_attempts, timeout_ms }).select("id, state").single()` → `{ id, created: true, state }`; on `error.code === "23514"` with `jobs_payload_size_check` in the message → throw `new JobPayloadTooLarge("the job's payload is over 8 KB")` (Spec correction 5); on `error.code === "23505"`, read back `.select("id, state").eq("kind", …).eq("idempotency_key", …)` plus `.is("account_id", null)` for a platform job or `.eq("account_id", …)` otherwise (Spec correction 12), `.maybeSingle()`, and return `{ id, created: false, state }`; a read-back with no row throws.
- `claimJob`: `db.rpc("claim_jobs", { p_kinds: [...kinds], p_limit: 1 })`; `kinds` empty → return null without a call.
- The three finishers: `.update({...}).eq("id", fence.id).eq("claim_token", fence.claimToken).eq("state", "running").select("id")`, return `data.length === 1`. `completeJob` sets `state: "succeeded", finished_at: atIso, lease_until: null, claim_token: null, updated_at: atIso`; `retryJob` sets `state: "retrying", run_after, last_error: boundJobError(error), lease_until: null, claim_token: null, updated_at`; `killJob` sets `state: "dead", finished_at, last_error: boundJobError(error), lease_until: null, claim_token: null, updated_at`.
- `sweepJobs`: `db.rpc("sweep_jobs", { p_limit: limit })` → `Number(data)`.
- `deadJobCounts`: `.select("kind").eq("state", "dead").limit(1000)`, grouped in TS.
- `oldestDueJob`: `.select("kind, run_after").in("state", ["queued", "retrying"]).lte("run_after", nowIso).order("run_after", { ascending: true }).limit(1).maybeSingle()`.

- [ ] **Step 1: Write `jobs-store.test.ts`** (`serviceDb()` from `../service`; platform jobs only, kind `s<RUN>.store`, every row deleted by kind in `afterAll`). Cases and probes:
  1. `insertJob` twice with one key → `{ created: true, state: "queued" }` then `{ same id, created: false, state: "queued" }`; after `killJob`, a third insert answers `state: "dead"`. *Probe: drop the 23505 branch → second call throws, FAILS. Probe: drop the account filter from the read-back and insert the same key for a fixture account first → the wrong id comes back, FAILS (use one `withTestAccount` account for that half).*
  1b. A payload of `{ a: 1e300 }` repeated past 8,192 bytes of `jsonb::text` but under 8,192 of JSON (e.g. 30 keys of `1e300`: about 330 bytes as JSON, about 9,300 as jsonb text) → rejects with `JobPayloadTooLarge`. *Probe: drop the 23514 mapping → a plain Error, FAILS.*
  2. `claimJob([kind])` then `completeJob` with a WRONG token → false and the row still `running`; with the right token → true, `succeeded`, `finished_at` set, lease and token null. *Probe: drop `.eq("claim_token", …)` → the wrong-token call returns true, FAILS.*
  3. `retryJob` with a 400-character error → true, `retrying`, `last_error` 300 characters. *Probe: write `error` unbounded → 23514, FAILS.*
  4. `killJob` → `dead`, `finished_at` set.
  5. `deadJobCounts` counts this run's two dead rows under its kind.
  6. `oldestDueJob`: insert one queued row of this run's kind with `run_after` ten years ago. Called with `nowIso` = now → this run's kind and that `runAfter` (nothing else on any stack is older). Called with `nowIso` = eleven years ago → `null`. *Probe: drop `.lte("run_after", nowIso)` → the second call returns the row, FAILS.*
  7. `sweepJobs(1)` returns a number ≥ 0 (behaviour is Task 1's).
- [ ] **Step 2: Write `jobs.ts`** and the barrel block.
- [ ] **Step 3: Typecheck** `pnpm --filter @bis/db exec tsc --noEmit` (or the package's typecheck script). Do NOT run `jobs-store.test.ts` locally against bis-ci (Global Constraints, DB tests); it runs in CI `verify`. If the local PostgREST kit from the ledger is up on your replica, you may run it there and report so.
- [ ] **Step 4: Commit** `packages/db/src/jobs.ts packages/db/src/test/jobs-store.test.ts packages/db/src/index.ts` with `feat(db): jobs store calls fenced by the claim token (F-196)`.

Reviewer probes: cases 1, 2, 3, 6 above, read off CI `verify` on the branch (or the local PostgREST kit).

---

### Task 3 (MEDIUM, bis-automations): `cronAuthorized`, `runPass`, the plan and the executor

**Files:**
- Create: `apps/web/src/lib/automations/cron-auth.ts`, `cron-auth.test.ts`
- Create: `apps/web/src/lib/automations/fanout.ts`, `fanout.test.ts`
- Modify: `apps/web/src/lib/automations/harness.ts:33-55` (extract `runPass`), `harness.test.ts` (one case)
- Modify: `apps/web/src/app/api/cron/demo-refresh/route.ts:29-37` (use `cronAuthorized`)

**Interfaces — Produces:**

```ts
// cron-auth.ts
export type CronAuth = "ok" | "unset" | "denied";
export function cronAuthorized(req: Request, env: NodeJS.ProcessEnv = process.env): CronAuth;
// "unset" when CRON_SECRET is unset or ""; "denied" unless the header is exactly `Bearer ${secret}`
// (length check first, then timingSafeEqual: today's code at reminders/route.ts:46-49).

// harness.ts
export async function runPass(pass: Pass, ctx: PassContext, beat: HeartbeatWriter = defaultBeat): Promise<PassCounters>;
// today's loop body (harness.ts:38-49): run in try/catch, { errored: 1 } on throw, then safeBeat(cron.pass.<key>).
// runPasses becomes: for (const pass of passes) results[pass.key] = await runPass(pass, ctx, beat); then cron.tick.

// fanout.ts (imports only types from ./context and ./harness; NO @bis/db, NO ./registry)
export const PASS_ROUTE_MAX_S = 90;
export const JOBS_DRAIN_MAX_S = 300;
export const DISPATCHER_MAX_S = 800;
export const LEGACY_TICK_CEILING_S = 300;
export const ANSWER_GRACE_S = 5;
export const DISPATCH_SLACK_S = 20;
export const JOBS_DRAIN_KEY = "jobsDrain";
export type WaitRule = "settled" | "completed" | "released" | "regardless";
// released (Spec correction 11): start only on a completed (200, readable) answer; anything else blocks.
export type PlanNode = { readonly key: string; readonly after: readonly string[]; readonly rule: WaitRule; readonly ceilingS: number };
export const PLAN: readonly PlanNode[];
export function fanoutEnabled(env: NodeJS.ProcessEnv = process.env): boolean;      // env.CRON_FANOUT === "1"
export function longestPathS(plan: readonly PlanNode[], graceS?: number): number;
export type Answer = { status: number; counters: PassCounters | null };
export type Invoke = (key: string, body: { now: string }, signal: AbortSignal) => Promise<Answer>;
export type FanoutBeat = (key: string, outcome: HeartbeatOutcome) => Promise<void>;
export async function runFanout(input: { plan: readonly PlanNode[]; now: Date; invoke: Invoke; beat: FanoutBeat }): Promise<Record<string, PassCounters>>;
export function httpInvoke(origin: string, secret: string, fetchImpl?: typeof fetch): Invoke;
```

`PLAN`, in `PASSES` order with `jobsDrain` after `weeklyAgencyReport` (rule `settled` and ceiling `PASS_ROUTE_MAX_S` unless shown):

```ts
const n = (key: string, after: readonly string[], rule: WaitRule = "settled", ceilingS = PASS_ROUTE_MAX_S): PlanNode => ({ key, after, rule, ceilingS });
const R = ["releaseHeld"] as const;
const rel = (key: string): PlanNode => n(key, R, "released");
const HEAD: readonly PlanNode[] = [
  n("billingPause", []),
  n("releaseHeld", ["billingPause"]),
  n("cancelNotices", ["billingPause"]),
  rel("reminders"), rel("followups"),
  n("reviewRequests", ["followups"], "completed"),
  n("referralAsks", ["reviewRequests"], "completed"),
  rel("noShowNudges"), rel("smsReminders"), rel("appointmentConfirms"),
  n("reactivations", ["cancelNotices", "reminders", "referralAsks", "noShowNudges", "smsReminders", "appointmentConfirms"]),
  rel("quoteFollowups"),
  n("siteTraffic", ["billingPause"]), n("documentsSweep", ["billingPause"]),
  n("documentsScan", ["documentsSweep"]), n("documentsExpiry", ["documentsScan"]),
  n("weeklyClientReport", ["billingPause"]), n("weeklyAgencyReport", ["weeklyClientReport"]),
  n(JOBS_DRAIN_KEY, ["billingPause"], "settled", JOBS_DRAIN_MAX_S),
];
const usage = n("usageReport", HEAD.map((x) => x.key), "regardless");
export const PLAN = [...HEAD, usage, n("opsWatch", [...HEAD.map((x) => x.key), usage.key], "regardless")];
```

`runFanout` (the decision rule carries Spec correction 2):

```ts
type Outcome =
  | { kind: "answered"; status: number; counters: PassCounters | null }
  | { kind: "noAnswer"; error: string }
  | { kind: "skipped" }    // a `completed` predecessor did not answer 200
  | { kind: "blocked" };   // some ancestor gave no answer and may still be running

function decide(node: PlanNode, done: ReadonlyMap<string, Outcome>): "wait" | "start" | "skipped" | "blocked" {
  const preds = node.after.map((k) => done.get(k));
  if (preds.some((p) => p === undefined)) return "wait";
  if (node.rule === "regardless") return "start";
  if (preds.some((p) => p!.kind === "noAnswer" || p!.kind === "blocked")) return "blocked";
  const completed = (p: Outcome) => p.kind === "answered" && p.status === 200 && p.counters !== null;
  if (node.rule === "released" && !preds.every((p) => completed(p!))) return "blocked";
  if (node.rule === "completed" && !preds.every((p) => completed(p!))) return "skipped";
  return "start";
}
```

Loop: scan `plan` for undecided nodes; `start` launches `invoke(key, { now: now.toISOString() }, AbortSignal.timeout((ceilingS + ANSWER_GRACE_S) * 1000))` without awaiting; `skipped`/`blocked` are recorded at once and the scan repeats; when a scan changes nothing, `await Promise.race(inFlight)`; if nothing is in flight and nodes remain, throw (unknown predecessor or cycle). A finishing node writes its failure heartbeat (awaited, wrapped in try/catch so a throwing writer never fails the tick) BEFORE it is recorded in `done`: non-200 → `cron.pass.<key>` `{ ok: false, error: "the pass's function answered HTTP <status>" }`; no answer → `{ ok: false, error: "the pass's function did not answer: <String(e)>" }`; 200 → no write. After every node is decided: `cron.tick` `{ ok: true }`. Counters per node: 200 → `counters`, or `{ unreadable: 1 }` when the body could not be read (`counters: null`; such an answer is NOT completed for `completed` or `released`); other status → `{ errored: 1 }`; no answer → `{ errored: 1, noAnswer: 1 }`; skipped or blocked → `{ notStarted: 1 }`.

`httpInvoke`: `fetchImpl(\`${origin}/api/cron/pass/${key}\`, { method: "POST", headers: { authorization: \`Bearer ${secret}\`, "content-type": "application/json" }, body: JSON.stringify(body), signal, cache: "no-store", redirect: "manual" })` (a redirect is a non-200 answer, never followed with the bearer); status 200 → `counters = await res.json()`, a parse failure or a non-object → `null`; any other status → `null`. It never logs or returns the secret.

- [ ] **Step 1: Tests first.** `cron-auth.test.ts`: unset and `""` → `"unset"`; missing header, wrong secret of equal length, wrong length → `"denied"`; exact → `"ok"`. *Probe: drop the length check → `timingSafeEqual` throws on the wrong-length case, FAILS.* `harness.test.ts` adds: "runPass runs one pass and writes cron.pass.<key>, never cron.tick" (beats equal `[["cron.pass.a", { ok: true }]]`). *Probe: make runPass call `runPasses([pass], ctx, beat)` → `cron.tick` appears, FAILS.* The existing harness cases stay unchanged and green.

  `fanout.test.ts`, the plan (imports `PASSES` from `./registry` and `RELEASERS` from `./passes/release-held`, both real, as `cron-coupling.test.ts` imports real `@bis/db`):
  1. `PLAN` keys are exactly `PASSES` keys plus `jobsDrain`, each once.
  2. Every edge between two `PASSES` members runs earlier → later in `PASSES`; `jobsDrain`'s only dependants are usageReport and opsWatch. *Probe: add `"reminders"` to releaseHeld's `after` → FAILS.*
  3. Every non-null `RELEASERS` source is classified: `{ reminders: "reminders", followups: "followups", review_request: "reviewRequests", no_show_nudge: "noShowNudges", sms_reminder: "smsReminders", appointment_confirm: "appointmentConfirms", referral_ask: "referralAsks", reactivation: "reactivations", quote_followup: "quoteFollowups" }` or the non-pass list `["instant_reply", "textback", "document_request"]` (12 non-null today: 9 + 3); each mapped key has releaseHeld among its transitive predecessors. *Probe: change reminders' `after` to `["billingPause"]` → FAILS; a new releaser source left unclassified → FAILS.*
  4. the six nodes after releaseHeld (reminders, followups, noShowNudges, smsReminders, appointmentConfirms, quoteFollowups) are `released`, and no other node is (*probe: make reminders `settled` → FAILS*); reviewRequests and referralAsks are `completed`; usageReport and opsWatch are `regardless` and follow every other node; opsWatch follows usageReport. *Probe: make reviewRequests `settled` → FAILS.*
  5. `longestPathS` on a toy graph a(10), b(10) after a, c(50) after a, d(10) after b and c, grace 5: a 15, b 30, c 70, d 85 → 85. *Probe: add the predecessors' paths instead of taking the max → d is 115, FAILS.*

  `fanout.test.ts`, the executor (injected `invoke` returning deferred promises; `beat` records into an array shared with an `events` log):
  6. siteTraffic is invoked as soon as billingPause answers, while releaseHeld is still in flight; once releaseHeld answers, reminders and followups are both in flight before either answers. *Probe: await each invoke before starting the next → FAILS.*
  7. No recipe (`reminders`, `followups`, `noShowNudges`, `smsReminders`, `appointmentConfirms`, `quoteFollowups`) starts before releaseHeld answers.
  8. followups answers 504 → reviewRequests and referralAsks `{ notStarted: 1 }`, reactivations STARTS, `cron.pass.followups` failed with "HTTP 504". *Probe: treat any answer as completed → reviewRequests starts, FAILS.*
  9. releaseHeld rejects (no answer), and separately releaseHeld answers 502 (Spec correction 11) → in both runs reminders, followups, reviewRequests, referralAsks, noShowNudges, smsReminders, appointmentConfirms, reactivations, quoteFollowups all `{ notStarted: 1 }`; cancelNotices, siteTraffic, the documents chain, the reports, jobsDrain, usageReport and opsWatch run. *Probe (Spec correction 2): in `decide`, test only `noAnswer`, not `blocked` → reactivations starts in the no-answer run, FAILS. Probe (correction 11): drop the `released` line → the recipes start on the 502, FAILS.* A third run: releaseHeld answers 200 with an unreadable body → the same nodes `{ notStarted: 1 }`. *Probe: treat `counters: null` as completed → FAILS.*
  10. Failure heartbeats: written for 504 and no answer, never for 200 (*probe: write one on 200 too → FAILS*). Ordering, not by inspection of a log but by holding the beat open: the fake `beat` for `cron.pass.weeklyAgencyReport` (which answers 504) returns a DEFERRED; with every other node answered, assert opsWatch's invoke has NOT been called (and usageReport's neither) while that deferred is pending; resolve it; then assert opsWatch is invoked. *Probe: record `done` before awaiting the beat → opsWatch is invoked while the beat is pending, FAILS.*
  11. `cron.tick` written once, after opsWatch answers. *Probe: write it before awaiting the last node → FAILS.*
  12. Every invoke receives the same `{ now }` (the input instant's ISO string).
  13. A beat that throws never rejects `runFanout`.
  14. `httpInvoke` with an injected fetch: URL `https://app.example.com/api/cron/pass/reminders`, POST, the bearer, the JSON body, `cache: "no-store"`, `redirect: "manual"`; a 200 answer's JSON is the counters; a 200 with `not json` → `counters: null`; a 504 or a 307 answer → its status, `counters: null`. *Probe: drop `redirect` → the init assertion FAILS.*
  15. `fanoutEnabled`: `"1"` true; `"true"`, `" 1"`, `""`, unset false. *Probe: `!!env.CRON_FANOUT` → FAILS.*

- [ ] **Step 2: Run red:** `pnpm --filter web exec vitest run src/lib/automations/fanout.test.ts src/lib/automations/cron-auth.test.ts src/lib/automations/harness.test.ts` → module-not-found / missing export. Paste one line.
- [ ] **Step 3: Implement** `cron-auth.ts`, `runPass`, `fanout.ts`; switch `demo-refresh/route.ts` to `cronAuthorized` (503 for `"unset"`, 401 for `"denied"`; the rest of that route unchanged).
- [ ] **Step 4: Green:** the three files above plus `src/app/api/cron/demo-refresh/route.test.ts`, `src/app/api/cron/reminders/route.test.ts` (unchanged, must pass: the route still calls `runPasses`), `src/lib/automations/sentinel.test.ts` (it calls `runPasses`, `:266`), `src/lib/automations/imports.test.ts`; `pnpm --filter web exec tsc --noEmit`; `pnpm --filter web lint`.
- [ ] **Step 5: Commit** the six paths with `feat(automations): the fan-out plan and executor, runPass and one cron auth helper (F-196)`.

---

### Task 4 (HIGH, bis-comms): both providers wait out one rate-limit refusal, inside a bounded send

Owner ruling Q4(a). Customer-facing sends, hence HIGH.

**The bound (plan review I4).** A pass checks its budget before a row, so the row in flight may run past it. Under fan-out that row must end inside the 90 s pass route. One send's worst case is attempt + wait + attempt. Telnyx already times each attempt out at 10 s (`telnyx.ts:8`); Resend has no timeout at all today. So: (1) both providers time each attempt out at `SEND_TIMEOUT_MS` (10 s); (2) the 429 wait cap is 3 s, not 10 s; (3) Task 7 pins `max budget + 2 × SEND_TIMEOUT_MS + RATE_LIMIT_MAX_WAIT_MS + 5 s margin ≤ PASS_ROUTE_MAX_S × 1000` (60 + 20 + 3 + 5 = 88 ≤ 90). Lowering the cap alone would leave Resend unbounded, and the pin alone fails at a 10 s cap (60 + 20 + 10 + 5 = 95), so all three. A rate limit that asks for more than 3 s fails the send now; the row is unstamped and the next tick retries it. A Resend attempt abandoned at 10 s may still have been accepted, so the row could be sent again next tick: the same outcome as the pass being killed mid-send, which is what the timeout replaces.

**Files:**
- Create: `apps/web/src/lib/http/retry-after.ts`, `retry-after.test.ts` (a neutral directory: both providers import it; bis-comms owns it)
- Modify: `apps/web/src/lib/email/resend.ts:17-48`, `resend.test.ts`
- Modify: `apps/web/src/lib/sms/telnyx.ts:8, 17-40` (the constant moves to the neutral module), `telnyx.test.ts`

**Interfaces — Produces** (Task 7's coupling test imports the three constants):

```ts
// lib/http/retry-after.ts
export const SEND_TIMEOUT_MS = 10_000;             // one provider attempt (was telnyx.ts:8, now shared)
export const RATE_LIMIT_DEFAULT_WAIT_MS = 1_000;   // no header, or one we cannot read
export const RATE_LIMIT_MAX_WAIT_MS = 3_000;       // a longer ask is not waited for: the send fails now, the next tick retries
export function rateLimitWaitMs(header: string | null | undefined, nowMs: number): number | null;
// delta-seconds or an HTTP-date; null when the wait exceeds RATE_LIMIT_MAX_WAIT_MS (do not retry); a past date → 0.
export type Sleep = (ms: number) => Promise<void>;
export const realSleep: Sleep;
```

- `resendEmailProvider(apiKey, fromAddress, redirectTo?, sleep: Sleep = realSleep)`. In `send`, build the request object once and ONE `idempotencyKey = crypto.randomUUID()`; each attempt is `this.#client.emails.send(req, { idempotencyKey })` (the SDK's option, `node_modules/resend/dist/index.d.mts:176-184`) raced against a `SEND_TIMEOUT_MS` timer that rejects with `resend did not answer within 10 s` (cleared in `finally`; ASSUMPTION: the SDK's `send` takes no abort signal, so the request is abandoned, not cancelled). If `r.error?.name === "rate_limit_exceeded"` (the SDK's code, `index.d.mts:121`; NOT `daily_quota_exceeded` or `monthly_quota_exceeded`, which a retry cannot fix), `ms = rateLimitWaitMs(r.headers?.["retry-after"] ?? null, Date.now())` (headers on every response: `index.d.mts:122-130`); null → throw as today; else `await sleep(ms)` and ONE more attempt with the same key; the second result is handled as today (`resend.ts:45-47`). ASSUMPTIONS: Resend's header is `retry-after` (absent, the 1 s default applies); its idempotency window covers the seconds between the two attempts.
- `telnyxSmsProvider(apiKey, redirectTo?, sleep: Sleep = realSleep)`. A 429 (`res.status === 429`) → `rateLimitWaitMs(res.headers.get("retry-after"), Date.now())`; null → throw `SmsProviderError` as today; else sleep and POST once more with a FRESH `AbortController` and a fresh `SEND_TIMEOUT_MS` timer; the second answer is handled as today. ASSUMPTION: Telnyx may omit `Retry-After`; the default applies.
- Callers compile unchanged (`grep -rn "resendEmailProvider(\|telnyxSmsProvider(" apps/web/src`); the new parameter is optional. Existing `resend.test.ts` assertions written as `toHaveBeenCalledWith(expect.objectContaining(…))` now see a second argument; change them to read `sendMock.mock.calls[0]![0]` (same claim, no loosening).

- [ ] **Step 1: Tests first** (inject `sleep`; fake timers only where stated):
  - `retry-after.test.ts`: `"2"` → 2000; `"0"` → 0; an HTTP-date 2 s ahead → 2000; a past date → 0; `null`/`"soon"` → 1000; exactly `"3"` → 3000; `"4"` → null. *Probe: drop the max check → `"4"` returns 4000, FAILS.* Pins `SEND_TIMEOUT_MS === 10_000` and `RATE_LIMIT_MAX_WAIT_MS === 3_000` (the coupling's inputs).
  - `resend.test.ts`: (a) first `{ error: { name: "rate_limit_exceeded", statusCode: 429, message: "x" }, data: null, headers: { "retry-after": "1" } }`, then success → resolves with the second id; `sendMock` called twice; both calls' first argument equal; both calls' `{ idempotencyKey }` defined and EQUAL; `sleep` called once with 1000. *Probes: delete the retry → rejects, FAILS; mint the key per attempt → keys differ, FAILS.* (b) two rate-limit errors → rejects, exactly 2 calls. *Probe: retry twice → 3 calls, FAILS.* (c) `daily_quota_exceeded` → rejects after 1 call, no sleep. *Probe: retry on any error → 2 calls, FAILS.* (d) `retry-after: "30"` → rejects after 1 call, no sleep. (e) timeout, fake timers: `sendMock` returns a never-settling promise; advance 9_999 ms → still pending; advance 1 ms → rejects with the timeout text. *Probe: drop the race → never settles, the test times out, FAILS.*
  - `telnyx.test.ts` (its `stubFetch`, `:21-22`): (a) 429 with `retry-after: 2` then 200 → resolves, 2 fetches, sleep(2000). (b) 429 twice → rejects `SmsProviderError` with status 429, 2 fetches. (c) 500 → rejects after 1 fetch. *Probe: retry on any non-ok → 2 fetches, FAILS.* (d) the retry's own timeout, fake timers, `sleep = (ms) => new Promise((r) => setTimeout(r, ms))`: the first fetch answers 429 with `retry-after: 2` at once; the second fetch returns a promise that rejects only when its `init.signal` aborts. At t = 2_000 + 9_999 the second signal is NOT aborted; at t = 2_000 + 10_000 it IS and `send` rejects. *Probe: arm one timer for both attempts at t = 0 → the second signal aborts at 10_000, before 11_999, FAILS.*
- [ ] **Step 2: Red, then implement, then green:** `pnpm --filter web exec vitest run src/lib/http src/lib/email src/lib/sms src/lib/consent/scans.test.ts`; `pnpm --filter web exec tsc --noEmit`.
- [ ] **Step 3: Commit** the six paths with `feat(sms): email and text sends time out at 10 s and wait out one short rate-limit refusal (F-196 Q4)`.

---

### Task 5 (LOW, bis-platform): runbook, `.env.example`, the test env pin

**Files:**
- Create: `docs/runbooks/background-jobs.md`
- Modify: `.env.example` (a block after `CRON_SECRET=` at line 336)
- Modify: `apps/web/vitest.config.ts:36` (add `CRON_FANOUT: ""` to the `env` pin, so a developer's ambient `CRON_FANOUT=1` cannot flip `route.test.ts` onto the fan-out path)

Content (spec §12 item 7): what the switch does and that a change needs a redeploy; reading dead jobs (`select kind, account_id, attempts, last_error, finished_at from jobs where state = 'dead' order by finished_at desc;`); requeueing one (`update jobs set state = 'queued', attempts = 0, run_after = now(), finished_at = null, last_error = null, updated_at = now() where id = '<id>' and state = 'dead';`); discarding one (`delete from jobs where id = '<id>' and state = 'dead';`); what `jobs.dead` and `jobs.backlog` alerts mean and how they clear; retention (7 days succeeded, 30 days dead); rollback fast (unset `CRON_FANOUT`, redeploy) and slow (revert, then 0102's rollback lines). On EITHER rollback, a step that clears the two queue heartbeats: they are not `cron.pass.*` keys, so ops-watch never treats them as stale (`lib/ops/watch.ts:66`), and with no drain left to write them a failed `jobs.dead` would re-alert every six hours forever. First read and settle any dead jobs, then, as the table owner in the SQL editor (service_role holds no DELETE on `ops_heartbeats`, 0057), `delete from ops_heartbeats where key in ('jobs.dead', 'jobs.backlog');`. Runs only through the service role or the SQL editor, never a client session. `.env.example`:

```
# F-196: the fan-out tick. Exactly "1" runs each scheduled pass in its own
# function, called at APP_ORIGIN; anything else (or APP_ORIGIN unset) runs the
# single tick as before. Production only; needs a redeploy. Never on Preview.
CRON_FANOUT=
```

- [ ] Write both; run `pnpm --filter web exec vitest run src/lib/automations/cron-coupling.test.ts` (it reads nothing here, a smoke that the config still loads). Commit the three paths with `docs(automations): background jobs runbook and the CRON_FANOUT switch (F-196)`.

---

### Task 6 (MEDIUM, bis-automations): the runner API (Wave 2, after Tasks 1 and 2)

**Files:**
- Create under `apps/web/src/lib/automations/jobs/`: `types.ts`, `backoff.ts`, `backoff.test.ts`, `platform-ping.ts`, `registry.ts`, `registry.test.ts`, `enqueue.ts`, `enqueue.test.ts`
- Modify: `apps/web/src/lib/automations/imports.test.ts:56-60` (fixture list gains `"jobs/enqueue.ts"`, `"jobs/platform-ping.ts"`)

**Interfaces — Consumes:** `insertJob`, `NewJob` (Task 2); `PassContext` (`context.ts:16`). **Produces:**

```ts
// types.ts — spec section 8 verbatim, plus:
export const JOB_TIMEOUT_MAX_MS = 60_000;
export const JOB_PAYLOAD_MAX_BYTES = 8_192;                       // the app pre-check; 0102's CHECK is mapped to the same refusal (Spec correction 5)
export const JOB_KIND_PATTERN = /^[a-z][a-z0-9_]*([.][a-z][a-z0-9_]*)+$/;   // twin of 0102's jobs_kind_check
export const DEFAULT_BACKOFF = { baseMs: 15 * 60_000, capMs: 24 * 60 * 60_000 } as const;

// backoff.ts
export function nextRunAfter(input: {
  attempt: number;              // the attempt that just failed, 1-based
  now: Date;
  backoff?: { baseMs: number; capMs: number };
  retryAfterMs?: number;        // from RetryJobAfter
  random?: () => number;        // [0, 1); default Math.random
}): Date;
// wait = retryAfterMs ?? base * 2 ** (attempt - 1); jittered = wait * (0.8 + 0.4 * random()); final = min(jittered, cap)

// platform-ping.ts
export const platformPing: JobHandler<Record<string, never>>;   // kind "platform.ping", maxAttempts 1, timeoutMs 5_000;
// parse: a plain object → {}; anything else throws "platform.ping takes an empty object"; run: resolves, does nothing.

// registry.ts — spec section 8 verbatim, plus:
export const JOB_KINDS: readonly string[];                     // Object.keys(JOB_HANDLERS)
export function handlerFor(kind: string): JobHandler<unknown> | null;

// enqueue.ts — spec section 8's signature verbatim. Order: unknown kind → throw before anything;
// idempotencyKey length 1..200 else throw; Buffer.byteLength(JSON.stringify(payload)) > JOB_PAYLOAD_MAX_BYTES → throw JobPayloadTooLarge (from @bis/db);
// the answer is insertJob's { id, created, state } (spec section 8 amended: state added);
// insertJob(opts.db ?? serviceDb(), { kind, accountId: opts.accountId, idempotencyKey, payload,
//   runAfter: (opts.runAfter ?? new Date()).toISOString(), maxAttempts: h.maxAttempts, timeoutMs: h.timeoutMs }).
```

- [ ] **Step 1: Tests first.**
  - `backoff.test.ts` (random fixed at 0.5 unless stated; now = `2026-10-28T12:00:00Z`): attempt 1 → +15 min; attempt 3 → +60 min; attempt 20 → +24 h; random 0 at attempt 1 → +12 min; random 0.999 at attempt 1 → under +18 min; `retryAfterMs` 5 min → +5 min; `retryAfterMs` 48 h → +24 h; a handler's own `{ baseMs: 60_000, capMs: 600_000 }` at attempt 5 → +10 min. *Probes: drop the cap → attempt 20 FAILS; drop the jitter → random 0 FAILS; use `2 ** attempt` → attempt 1 FAILS; ignore `retryAfterMs` → 5-min case FAILS.*
  - `registry.test.ts`: every handler `timeoutMs` in [1000, `JOB_TIMEOUT_MAX_MS`], `maxAttempts` integer in 1-25, `kind` matches `JOB_KIND_PATTERN` and equals its registry key; `JOB_KIND_PATTERN.source` equals the literal between the quotes of `kind ~ '…'` read from `packages/db/supabase/migrations/0102_jobs.sql` with `readFileSync`. *Probes: platformPing `timeoutMs: 61_000` → FAILS; edit either pattern → FAILS.*
  - `enqueue.test.ts` (bare `vi.mock("@bis/db", () => ({ insertJob: …, serviceDb: … }))`): copies `maxAttempts` 1 and `timeoutMs` 5000 from platformPing; `runAfter` defaults to now; a collision answer `{ id, created: false, state: "dead" }` passes through with its `state`; a `JobPayloadTooLarge` thrown by `insertJob` (0102's CHECK, the `1e300` case) propagates as that class; `// @ts-expect-error` on `enqueue("nope.kind", {}, …)` and the runtime throw happens before `insertJob`; an 8,193-byte payload throws `JobPayloadTooLarge` before `insertJob` (*probe: drop the size check → insertJob called, FAILS*); the bare factory therefore also defines `JobPayloadTooLarge` (a missing export throws when touched); an empty and a 201-character idempotency key throw before `insertJob`; `opts.db` is used when given, `serviceDb()` otherwise.
  - `imports.test.ts` fixture names the two jobs files. *Probe: add `import { getSmsProvider } from "@/lib/sms";` to `jobs/platform-ping.ts` → the scan FAILS naming it (Spec correction 3).*
- [ ] **Step 2: Red** `pnpm --filter web exec vitest run src/lib/automations/jobs src/lib/automations/imports.test.ts`; implement; green; `tsc --noEmit`; lint.
- [ ] **Step 3: Commit** the nine paths with `feat(automations): job handlers, backoff and enqueue (F-196)`.

---

### Task 7 (HIGH, bis-automations): the pass route and the dispatcher (Wave 2, after Task 3)

HIGH: route auth, and the dispatcher schedules every customer send.

**Files:**
- Create: `apps/web/src/lib/automations/pass-route.ts`, `pass-route.test.ts`
- Create: `apps/web/src/app/api/cron/pass/[key]/route.ts`, `route.test.ts`
- Modify: `apps/web/src/app/api/cron/reminders/route.ts` (whole file: auth helper, `maxDuration = 800`, the switch)
- Create: `apps/web/src/app/api/cron/reminders/route.fanout.test.ts`
- Modify: `apps/web/src/lib/automations/cron-coupling.test.ts:301-357` (retarget) and append one `describe`

**Interfaces — Consumes:** Task 3's `cronAuthorized`, `runPass`, `PLAN`, `runFanout`, `httpInvoke`, `fanoutEnabled`, the constants. **Produces:**

```ts
// pass-route.ts
export const TICK_NOW_MAX_AGE_MS = 900_000;
export const TICK_NOW_MAX_AHEAD_MS = 60_000;
export function parseTickNow(body: unknown, wallMs: number): Date | null;
// body must be { now: string } whose Date.parse is finite and wallMs - 900_000 <= t <= wallMs + 60_000 (both bounds inclusive)
export async function handlePassRequest(req: Request, pass: Pass | null): Promise<Response>;
// 1 cronAuthorized: "unset" → 503, "denied" → 401   (no serviceDb, no pass.run)
// 2 pass null → 404                                   (no serviceDb)
// 3 body via req.json() (a throw is a bad body) → parseTickNow null → 400
// 4 configuredOrigin() null → 503
// 5 ctx = buildPassContext({ db: serviceDb(), now, origin }); return Response.json(await runPass(pass, ctx))
```

```ts
// app/api/cron/pass/[key]/route.ts (POST only: Next answers 405 to GET)
export const dynamic = "force-dynamic";
export const maxDuration = 90;
type Params = { params: Promise<{ key: string }> };
export async function POST(req: Request, { params }: Params): Promise<Response> {
  const { key } = await params;
  return handlePassRequest(req, PASSES.find((p) => p.key === key) ?? null);
}
```

Dispatcher (`reminders/route.ts` `GET`): `cronAuthorized` (503/401 as today); `const now = new Date()`; if `fanoutEnabled()` and `configuredOrigin()` is set → `runFanout({ plan: PLAN, now, invoke: httpInvoke(origin, process.env.CRON_SECRET!), beat: (key, o) => recordHeartbeat(serviceDb(), key, o) })`; if `fanoutEnabled()` and no origin → `console.error("cron: CRON_FANOUT is on but APP_ORIGIN is unset, so the single in-process tick runs")` and fall through; otherwise today's path (`route.ts:55-58`). Both paths end `const { reminders, ...rest } = results; return Response.json({ ...reminders, ...rest });`. `export const maxDuration = 800;` with a comment naming `DISPATCHER_MAX_S` and `cron-coupling.test.ts`. Rewrite the file's stale ceiling comment (`route.ts:9-16`) to the new coupling.

- [ ] **Step 1: Tests first.**
  - `pass-route.test.ts`: `parseTickNow` accepts exactly 900 s old and exactly 60 s ahead; refuses 900_001 ms old, 60_001 ms ahead, a missing `now`, `"yesterday"`, a number. *Probe: widen the age bound to 1 h → FAILS.*
  - `pass/[key]/route.test.ts`. Mocks: `vi.mock("@/lib/automations/registry", () => ({ PASSES: [fakeA, fakeBoom] }))` (`fakeA.run` resolves `{ sent: 1 }`, `fakeBoom.run` throws); `vi.mock("@bis/db", async (o) => ({ ...(await o<object>()), serviceDb: serviceDbSpy, recordHeartbeat: beatSpy }))`; the consent gate and email gate mocked as `harness.test.ts:3-6` does; `vi.stubEnv` for `CRON_SECRET` and `APP_ORIGIN`. Cases: 503 when `CRON_SECRET` unset, `serviceDbSpy` and both `run`s not called; 401 wrong bearer, same; 404 for key `nope`, `serviceDbSpy` not called; 400 for a stale `now`; 503 when `APP_ORIGIN` is `""`, `serviceDbSpy` not called; 200 for `a`: body `{ sent: 1 }`, `fakeA.run` called once with `ctx.now` equal to the body's instant and `ctx.origin` the stubbed origin, `fakeBoom.run` not called, `beatSpy` calls are exactly `[[db, "cron.pass.a", { ok: true }]]` (*probe: call `runPasses([pass], ctx)` in `handlePassRequest` → a `cron.tick` beat appears, FAILS*); 200 `{ errored: 1 }` for `boom` with a failed beat; the module exports no `GET` (`expect("GET" in mod).toBe(false)`; *probe: export a GET → FAILS*).
  - `reminders/route.fanout.test.ts`. Mocks: `vi.mock("@/lib/automations/harness", async (o) => ({ ...(await o<object>()), runPasses: runPassesSpy, buildPassContext: () => ({}) }))` with `runPassesSpy` resolving `{ reminders: { sent: 2 }, followups: { sent: 0 } }`; `@bis/db` spread-actual with `serviceDb` and `recordHeartbeat` spies; `vi.stubGlobal("fetch", fetchSpy)` answering every pass URL 200 with `{ sent: 0 }` except `/reminders` with `{ sent: 2, failed: 0 }`. Cases: (a) `CRON_FANOUT` unset → `runPassesSpy` called once, `fetchSpy` never; (b) `"1"` + `APP_ORIGIN=https://app.example.com` → `fetchSpy` called 21 times, each URL `https://app.example.com/api/cron/pass/<key>` for every `PLAN` key, every body the same `now`, every bearer `Bearer <secret>`; the JSON has `sent: 2, failed: 0` top-level and `followups`, `jobsDrain`, `opsWatch` nested; `runPassesSpy` not called; one `cron.tick` beat (*probe: spread `reminders` nested instead of top-level → FAILS*); (c) `"1"` + `APP_ORIGIN=""` → `runPassesSpy` called, `fetchSpy` never, one `console.error` containing `APP_ORIGIN`; (d) `"true"` → in-process.
  - The existing `reminders/route.test.ts` is NOT edited and must pass (spec §11 test 17).
  - `cron-coupling.test.ts`: retarget `:301-316` and `:338-357` to `LEGACY_TICK_CEILING_S` (import from `./fanout`), keep their probes; fix the stale "seventeen entries" comment (`:313`, twenty today; better, drop the number). Append `describe("fan-out: each pass in its own function, the plan inside the dispatcher's ceiling", …)`, reading literals with the anchored `/^export const maxDuration = (\d+);$/m` (`:307`) from `../../app/api/cron/pass/[key]/route.ts` and `../../app/api/cron/reminders/route.ts`:
    1. pass route literal === `PASS_ROUTE_MAX_S`; each of the six budgets (`RELEASE_BUDGET_MS`, `USAGE_REPORT_BUDGET_MS`, `WEEKLY_REPORT_BUDGET_MS`, `DOCUMENT_SCAN_BUDGET_MS`, `EXPIRY_BUDGET_MS`, `CANCEL_NOTICE_BUDGET_MS`) + 30_000 ≤ `PASS_ROUTE_MAX_S * 1000`. *Probes: route literal 60 → FAILS; `RELEASE_BUDGET_MS` 61_000 → FAILS; comment the export out → FAILS.*
    2. every `PLAN` node's `ceilingS` is `PASS_ROUTE_MAX_S` except `jobsDrain`, which is `JOBS_DRAIN_MAX_S`.
    3. `longestPathS(PLAN) + DISPATCH_SLACK_S` ≤ dispatcher literal; today `longestPathS(PLAN)` is 760 (8 × 95; assert the number so a longer path is seen in review). *Probes: `PASS_ROUTE_MAX_S` 120 → 8 × 125 = 1,000, FAILS; add `"reactivations"` to siteTraffic's `after` → siteTraffic, usageReport and opsWatch each move one step down the longest path, 9 × 95 = 855 + 20 > 800, FAILS. (Adding documentsExpiry to reactivations' `after` cannot fail: that path is 665 s, under 760.)*
    4. dispatcher literal === `DISPATCHER_MAX_S` and `< tickIntervalMs(entry.schedule) / 1000` (800 < 900). *Probes: literal 900 → FAILS; comment it out → FAILS.*
    5. the row in flight past a budget ends inside the pass route (plan review I4): `max(six budgets) + 2 * SEND_TIMEOUT_MS + RATE_LIMIT_MAX_WAIT_MS + 5_000 <= PASS_ROUTE_MAX_S * 1000` (60 + 20 + 3 + 5 = 88 ≤ 90), the constants imported from `@/lib/http/retry-after` (Task 4). *Probes: `RATE_LIMIT_MAX_WAIT_MS` 10_000 → 95 > 90, FAILS; `SEND_TIMEOUT_MS` 15_000 → FAILS.*
- [ ] **Step 2: Red** `pnpm --filter web exec vitest run src/lib/automations/pass-route.test.ts "src/app/api/cron/pass" src/app/api/cron/reminders src/lib/automations/cron-coupling.test.ts` (the new files fail on missing modules; paste one line).
- [ ] **Step 3: Implement; green** on the same command plus `src/lib/automations/harness.test.ts src/lib/automations/sentinel.test.ts src/lib/automations/imports.test.ts`; `tsc --noEmit`; lint.
- [ ] **Step 4: Commit** the seven paths with `feat(automations): each pass in its own function behind CRON_FANOUT, the dispatcher awaiting the plan (F-196)`.

---

### Task 8 (MEDIUM, bis-automations): the drain, its route, the queue heartbeats (Wave 3)

**Files:**
- Create: `apps/web/src/lib/automations/passes/jobs-drain.ts`, `jobs-drain.test.ts`
- Create: `apps/web/src/app/api/cron/pass/jobsDrain/route.ts`, `route.test.ts`
- Modify: `apps/web/src/lib/ops/watch.ts:85-96` (two cases), `watch.test.ts` (one case)
- Modify: `apps/web/src/lib/automations/cron-coupling.test.ts` (append the drain cases)
- Modify: `apps/web/src/lib/automations/imports.test.ts` (fixture gains `"passes/jobs-drain.ts"`)

**Interfaces — Consumes:** Task 2's `claimJob`, `completeJob`, `retryJob`, `killJob`, `sweepJobs`, `deadJobCounts`, `oldestDueJob`, `JobRow`; Task 6's `JOB_HANDLERS`, `JobHandler`, `PermanentJobError`, `RetryJobAfter`, `JOB_TIMEOUT_MAX_MS`, `nextRunAfter`; Task 7's `handlePassRequest`; Task 3's `JOBS_DRAIN_MAX_S`. **Produces:**

```ts
export const JOBS_DRAIN_BUDGET_MS = 200_000;   // spec section 9 said 240 s; lowered under Node fetch's 300 s headers timeout (ASSUMPTION)
export const JOBS_PER_DRAIN = 100;
export const JOBS_SWEEP_LIMIT = 500;
export const JOBS_BACKLOG_ALERT_MS = 60 * 60_000;
export const JOBS_DEAD_KEY = "jobs.dead";
export const JOBS_BACKLOG_KEY = "jobs.backlog";
export type DrainDeps = {
  handlers: Readonly<Record<string, JobHandler<unknown>>>;
  clock: () => number;          // wall clock for the budget and bookkeeping timestamps; handlers read ctx.now
  random: () => number;
  beat: (db: SupabaseClient, key: string, outcome: HeartbeatOutcome) => Promise<void>;   // default recordHeartbeat
};
export function makeJobsDrainPass(deps?: Partial<DrainDeps>): Pass;   // key "jobsDrain"
export const jobsDrainPass: Pass;
```

The loop (spec §9), per claimed `job`:
1. Before each claim: `if (clock() - startedAt + JOB_TIMEOUT_MAX_MS > JOBS_DRAIN_BUDGET_MS) { notStartedBudget = 1; break; }`; stop at `JOBS_PER_DRAIN` claims; `claimJob(db, Object.keys(handlers))` null → stop.
2. `fence = { id: job.id, claimToken: job.claim_token! }`; `h = handlers[job.kind]`; `payload = h.parse(job.payload)` — a throw → `killJob(…, "the job's payload could not be read")` (fixed text: a parse error may quote the payload).
3. Run: `ac = new AbortController(); timer = setTimeout(() => ac.abort(), job.timeout_ms)`; `await Promise.race([h.run({ ...ctx, job: { id, kind, attempt: job.attempts, maxAttempts: job.max_attempts, accountId: job.account_id, signal: ac.signal } }, payload), timeoutPromise])` where `timeoutPromise` rejects with `"the job ran past its timeout (<ms> ms)"` on abort; `clearTimeout` in `finally`.
4. Resolve → `completeJob`. Throw → `killJob` if `e instanceof PermanentJobError` or `job.attempts >= job.max_attempts` (the ROW's max, copied at enqueue), else `retryJob(…, nextRunAfter({ attempt: job.attempts, now: new Date(clock()), backoff: h.backoff, retryAfterMs: e instanceof RetryJobAfter ? e.afterMs : undefined, random }).toISOString(), …)`. Error text is `e instanceof Error ? e.message : String(e)`; never the payload.
5. A finisher returning false → `vanished += 1` (the row is gone or re-claimed); otherwise count `succeeded`/`retried`/`dead`.
After the loop: `swept = await sweepJobs(db, JOBS_SWEEP_LIMIT)`; a throw is held, not swallowed (see the end of this paragraph); then `deadJobCounts` → `{}` → beat `jobs.dead` ok, else failed `"<n> job(s) gave up: <kind> (<count>), …"` sorted by kind (for 2 of one kind: `"2 jobs gave up: calendar.push (2)"`); then `oldestDueJob(db, new Date(clock()).toISOString())` → `oldestWaitMinutes = floor(wait / 60_000)`; wait > `JOBS_BACKLOG_ALERT_MS` → `jobs.backlog` failed `"the oldest waiting job (<kind>) has waited <m> minutes"`, else ok. A read that throws is logged and its key is not written. A `claimJob` throw propagates (the harness records `errored` and a failed `cron.pass.jobsDrain`). Answer `{ claimed, succeeded, retried, dead, vanished, notStartedBudget, swept, oldestWaitMinutes }`. A sweep that threw is rethrown AFTER both heartbeats are written (the counters logged first): the harness then records `cron.pass.jobsDrain` failed, and two such ticks reach ops-watch's inbox (`watch.ts:56`). No third heartbeat key: a broken sweep only lets finished rows accumulate, the drain's own key is the right place for it, and a new key would need its own label and alert rule.

Route: `export const dynamic = "force-dynamic"; export const maxDuration = 300;` and `POST(req) { return handlePassRequest(req, jobsDrainPass); }`.

`watch.ts` `describeKey`: `case "jobs.dead": return "background jobs that gave up";` and `case "jobs.backlog": return "background jobs waiting too long";`.

- [ ] **Step 1: Tests first.**
  - `jobs-drain.test.ts` (bare `vi.mock("@bis/db", () => ({ claimJob, completeJob, retryJob, killJob, sweepJobs, deadJobCounts, oldestDueJob, recordHeartbeat }))`; a handlers map with a test handler whose `run` is a spy; `clock` and `random` (0.5) injected; `ctx` a plain object with `db: {}` and `now`):
    1. success → `completeJob` with the fence; counters `claimed: 1, succeeded: 1`; the handler saw `ctx.now` and `job.attempt`/`maxAttempts`/`accountId` from the row. *Probe: skip `completeJob` → FAILS.*
    2. throw on attempt 1 of 3 → `retryJob` with `runAfter` = clock + 15 min. *Probe: pass `job.attempts + 1` → +30 min, FAILS.*
    3. throw on attempt 3 of 3 → `killJob`, no `retryJob`. *Probe: `>` for `>=` → retry, FAILS.*
    4. `PermanentJobError` on attempt 1 → `killJob`. *Probe: drop the instanceof → retry, FAILS.*
    5. `RetryJobAfter(5 * 60_000)` → `runAfter` +5 min. *Probe: ignore `afterMs` → +15 min, FAILS.*
    6. `parse` throws with a message quoting a marker from the payload → `killJob` with the fixed text, error string excludes the marker, `run` not called. *Probe: pass the parse error's message → FAILS.*
    7. `completeJob` false → `vanished: 1, succeeded: 0`. *Probe: count success regardless → FAILS.*
    8. timeout: `vi.useFakeTimers()`, handler `timeoutMs: 1000` never resolves; advance 1000 ms → `retryJob` with the timeout text, and the handler's `ctx.job.signal.aborted` is true. *Probe: drop the race → the drain never settles, the test times out, FAILS.*
    9. budget: a test-owned `let t = t0` with `clock: () => t`; the handler's `run` does `t += 140_001` (time passes while the job works, independent of how often the drain reads the clock). The first check (elapsed 0) claims one job; the second (140_001 + 60_000 > 200_000) stops with `notStartedBudget: 1`, so `claimJob` is called once. *Probe: drop the fit check → `claimJob` called twice, FAILS.*
    10. cap: `claimJob` always returns a fresh job (and `null` after 150 as a guard) → exactly 100 claims. *Probe: drop the cap → 150, FAILS.*
    11. `claimJob` is called with exactly the handler map's keys. *Probe: pass `[]` → FAILS.*
    12. `deadJobCounts` `{ "calendar.push": 2 }` → beat `jobs.dead` `{ ok: false, error: "2 jobs gave up: calendar.push (2)" }`; `{}` → ok. *Probe: always ok → FAILS.*
    13. `oldestDueJob` 61 min old → `jobs.backlog` failed naming the kind, `oldestWaitMinutes: 61`; 59 min → ok. *Probe: always ok → FAILS.*
    14. `sweepJobs` called with 500; its count is `swept`. A throwing sweep still writes both heartbeats AND the pass rejects (so the harness beats `cron.pass.jobsDrain` failed). *Probe: swallow the sweep error → the pass resolves, FAILS.*
  - `jobsDrain/route.test.ts`: mock `@/lib/automations/passes/jobs-drain` with a fake pass; 503/401 with zero queries; 200 runs it once and beats `cron.pass.jobsDrain`.
  - `watch.test.ts`: both keys have a label that is not the raw key, and `isFailing` is true on a first failure. *Probe: remove either case → FAILS.*
  - `cron-coupling.test.ts` appended: drain route literal (`../../app/api/cron/pass/jobsDrain/route.ts`) === `JOBS_DRAIN_MAX_S`; `JOBS_DRAIN_BUDGET_MS + 30_000 ≤ JOBS_DRAIN_MAX_S * 1000`; `JOB_TIMEOUT_MAX_MS ≤ JOBS_DRAIN_BUDGET_MS`. *Probes: `JOBS_DRAIN_BUDGET_MS` 280_000 → FAILS; drain literal 120 → FAILS.* (Today: 200 + 30 = 230 ≤ 300; 60 ≤ 200.)
  - `imports.test.ts` fixture names `passes/jobs-drain.ts`.
- [ ] **Step 2: Red, implement, green:** `pnpm --filter web exec vitest run src/lib/automations src/app/api/cron src/lib/ops`; `tsc --noEmit`; lint.
- [ ] **Step 3: Commit** the eight paths with `feat(automations): the jobs drain, its 300-second route and the queue's two alerts (F-196)`.

---

## Orchestrator checklist (not agent tasks)

**A. Reviews** — read every task's report against its probes. HIGH tasks 1, 4 and 7 get their own reviews; then one end-of-PR opus review and one fix agent.

**B. 0102 to bis-ci, BEFORE the gates** (CLAUDE.md's order; `e2e` runs `.github/scripts/ci-migrations-applied.sh`, `.github/workflows/ci.yml:399`, and is red until bis-ci holds 0102)
1. `ci-project-setup.yml`: `push-dry-run`, then `push`, then `migrations` (0102 listed). From here, local `@bis/db` suites run again.
2. Gates, one at a time: `pnpm check`, `pnpm --filter web build`, `pnpm --filter web test:e2e` (or CI's `verify` and `e2e`, read FOR THE HEAD SHA).

**B2. Production, then parity** (`docs/runbooks/ci-supabase-project.md`), before the merge
1. Production through the Supabase MCP `apply_migration`, name `0102_jobs`, the file's bytes (ASCII, no backslash, so no MCP escape trap). Read back: `select count(*) from information_schema.tables where table_name = 'jobs'` = 1, and the two functions' `proconfig` show `search_path=pg_catalog, pg_temp`.
2. Parity: `fingerprint` on bis-ci and the same digest on production for `jobs`, `claim_jobs`, `sweep_jobs` (grants, constraints, columns). Equal, or stop.
3. Production before merge is required: `deleteAccountCascade` (the demo re-seed) names `jobs` from the first deploy.

**C. The PR**
1. The PR body states plainly (Spec correction 13) what changes with the switch OFF: the in-process tick's ceiling is 800 s, not 300 s, and every email and text send (cron, request paths and `after()` callbacks alike) now times out at 10 s per attempt and waits out one rate-limit refusal of up to 3 s. Nothing else changes until the switch is on.
2. Merge with `CRON_FANOUT` unset everywhere. Verify the deploy as bis-platform's list does (READY on the merge SHA, `/api/cron/reminders` 401 without the bearer, and `/api/cron/pass/reminders` 401 for a POST without it, a marker only this work emits).
3. Watch two production ticks on the in-process path: the cron JSON unchanged, no ops email.

**D. Before switching on** (replaces spec §12 step 3; Spec correction 8)
1. Task 4 (the 429 retry) is in the deployed build (owner ruling Q4: before the switch goes on).
2. Local fan-out run against bis-ci under `next dev`, where both providers are the fakes unless `EMAIL_DEV_REDIRECT_TO` or `SMS_DEV_REDIRECT_TO` is set (`lib/email/index.ts:22-45`, `lib/sms/index.ts:25`). First confirm by NAME only that neither is in `apps/web/.env.local` (`grep -c "^EMAIL_DEV_REDIRECT_TO=\|^SMS_DEV_REDIRECT_TO=" apps/web/.env.local` → 0; never print a value); setting them blank in the shell would only unset them and let the file's value load. Run `cmd //c "set CRON_SECRET=local-only&& set CRON_FANOUT=1&& set APP_ORIGIN=http://localhost:3000&& pnpm --filter web dev"` (no `.env*` edit), then `curl -s -H "authorization: Bearer local-only" http://localhost:3000/api/cron/reminders`. Expect: 200 JSON with `reminders`' counters top-level and 20 nested keys including `jobsDrain`; on bis-ci, a fresh `cron.pass.<key>` row for each of the 21 keys, a fresh `cron.tick`, `jobs.dead` and `jobs.backlog` ok. Then insert one `platform.ping` row on bis-ci by SQL (`insert into jobs (kind, idempotency_key, max_attempts, timeout_ms) values ('platform.ping', 'rollout-<date>', 1, 5000)`), call the dispatcher again: the row is `succeeded`. Delete it. Check first that no `screenshots.yml` run is in progress (shared seeded account).
3. Record the two Vercel ASSUMPTIONS (a 504 at the ceiling; a callee outliving its caller) as NOT CHECKED, with the reason in Spec correction 8. If the owner wants them checked, the only path is a probe branch (never merged) whose Preview gets a test-only sleeping pass, `APP_ORIGIN` set to that Preview's URL and a Protection Bypass for Automation; that is a Vercel setting the runbook says not to create (`production-isolation.md:389-391`), so it is the owner's call.

**E. Switching on (production)**
1. Confirm Production's `APP_ORIGIN` is `https://app.bis-rgv.com` (by name and target, never reading the value elsewhere). Preview keeps `CRON_FANOUT` unset.
2. Set `CRON_FANOUT=1` in Production (Remove-then-Add if the name exists), redeploy.
3. Watch two ticks: the cron log's JSON has every key with no `noAnswer`, `notStarted`, `unreadable` or `errored` key anywhere (an `errored` with no other key is a pass function refused before it ran, a firewall 403 for instance); every `cron.pass.*` row and `cron.tick` fresh; `jobs.dead` and `jobs.backlog` ok; no ops email. In Vercel's logs, 21 `/api/cron/pass/*` invocations per tick.
4. After a week, read the project's Usage page (spec §4.5's ASSUMPTION on cost) and record it.
5. Rollback, fast: unset `CRON_FANOUT`, redeploy. Slow: revert the PR, then 0102's rollback lines on production, then bis-ci. Either way, then clear `jobs.dead` and `jobs.backlog` as the runbook says (they never go stale, `watch.ts:66`).

**F. Ledger** (after merge): the spec §15 findings and this plan's "Findings, not corrections"; the retirement of the in-process path after four clean weeks (spec §12 item 6) as its own later item.

## Self-review

- Spec coverage: §4.2 pass route and dispatcher (Tasks 3, 7), the plan table (Task 3, keys corrected), §4.3 overlap bound (Task 7 case 4), §4.4 APP_ORIGIN (Tasks 3, 7), §6 couplings (Tasks 7, 8), §7 table/claim/sweep/grants/teardown (Task 1), store calls (Task 2), §8 API (Task 6), §9 drain (Task 8), §10 heartbeats and labels (Task 8), §11 tests 1-19 (Tasks 1, 3, 6, 7, 8), §12 rollout (checklist, step 3 replaced), §14 Q3 retention (Task 1), Q4 (Task 4), §16 runbook/env (Task 5).
- Counts read off files at write time: 20 passes (`sentinel.test.ts:305`), 21 plan nodes, 6 budgets (`grep -n "BUDGET_MS\s*=" -r apps/web/src/lib/automations`), 12 non-null and 3 null `RELEASERS` entries (`release-held.ts:75-91`), 28 `@bis/db` mock files of which 3 are bare factories (two `() => ({`, one `() => db`).
- Names used across tasks: `runPass`, `PLAN`, `runFanout`, `httpInvoke`, `fanoutEnabled`, `longestPathS`, `PASS_ROUTE_MAX_S`, `JOBS_DRAIN_MAX_S`, `DISPATCHER_MAX_S`, `LEGACY_TICK_CEILING_S`, `handlePassRequest`, `jobsDrainPass`, `insertJob`/`claimJob`/`completeJob`/`retryJob`/`killJob`/`sweepJobs`/`deadJobCounts`/`oldestDueJob`, `nextRunAfter`, `JOB_HANDLERS`, `JOB_TIMEOUT_MAX_MS`: each defined once, in the task that produces it.

## Revision 2 (opus plan review: 0 Critical, 7 Important, all applied after checking each against the code)

| Finding | Where it landed |
|---|---|
| I1 teardown order (`ai-gateway-schema.test.ts:131`, `record-summaries-schema.test.ts:108` pin the first two entries) | Task 1 Files, affected tests, one probe |
| I2 bis-ci before the gates (`ci.yml:399`) | Checklist B |
| I3 the release edge on a non-200 (`booking.ts:1466`) | Spec correction 11, `released` rule, Task 3 cases 4 and 9, correction 8 amended |
| I4 the row in flight vs the 90 s route | Task 4 (10 s attempt timeout on both providers, 3 s wait cap), Task 7 coupling case 5 |
| I5 a probe that could not fail | Task 7 case 3 (siteTraffic after reactivations: 875 > 800) |
| I6 two vacuous tests | Task 3 case 10 (held beat), Task 4 telnyx (d) (fake-timer abort at +10 s, not +9.999 s) |
| I7 idempotency per account | Spec correction 12, spec §7/§8/§11 amended, Task 1 case 5, Task 2 case 1 |
| Minors | correction 5 withdrawn and replaced (23514 mapped, `JobPayloadTooLarge`); 3 bare mock factories; `context.ts:16`, `ops.ts:33`; correction 13 and spec §12.2 ("behaves as today"); runbook and checklist E5 clear `jobs.*` heartbeats; `httpInvoke` `redirect: "manual"`, unreadable 200 not completed; `JOBS_DRAIN_BUDGET_MS` 200 s (spec §9 amended); `sentinel.test.ts` in Task 3; one Resend `idempotencyKey` per send; `lib/http/retry-after.ts`; checklist E3 no `errored`; a sweep failure fails `cron.pass.jobsDrain` (no new key, reason in Task 8); Task 8 case 9 clock advanced by the handler; Task 6 waits for Task 1 |
