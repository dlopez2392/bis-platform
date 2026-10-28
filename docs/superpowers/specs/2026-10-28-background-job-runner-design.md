# F-196 — Room to run: the fan-out tick and the job queue (part 1)

Date: 2026-10-28 · Status: design for owner review; the three decisions in §2 are settled
Plan sources: `docs/crm-features.md:948` (§3.2 rule 9, "one background job runner"), `:1445` (the F-196
row: "before calendar sync, money and every new scheduled pass"), `:3341` (F-196 retires automations
spec B's "no second scheduler"). Dependants: S-22, S-29, S-32, S-21, F-071, F-121, F-123, F-136
(`docs/crm-features.md:1419, 1518, 1521, 1533, 1542, 1581, 1582, 1594`).

## 1. Purpose

Every scheduled thing the platform does runs inside ONE function invocation every 15 minutes, and
twenty passes share its 300 seconds. Six of them carry wall-clock budgets that already sum, with the
headroom the rest share, to exactly the ceiling: 60 + 60 + 60 + 45 + 15 + 10 = 250 s of budgets plus
50 s of headroom = 300 s (`cron-coupling.test.ts:338-357`). The next budgeted pass has nowhere to go,
and the work queued behind F-196 (calendar sync, exports, money, retries) is not "a pass every tick":
it is one-off work that must be retried until it succeeds or a person is told it never will.

This part gives the platform room in two ways: every pass runs in its own invocation with its own
ceiling, and a jobs table in our own Postgres takes one-off and retryable work. It converts no pass
into a job and adds no UI.

## 2. Owner decisions (2026-10-28)

| # | Question | Decision |
|---|---|---|
| R1 | Runner | A `jobs` table in our Supabase Postgres; claims with `FOR UPDATE SKIP LOCKED`; leases, retries with backoff, an idempotency key, and a dead-letter state that the ops-watch alert pass surfaces. No new vendor (not Vercel Queues, not Vercel Workflow). |
| R2 | Scope | (a) **Fan-out**: each registered pass runs in its OWN invocation with its own `maxDuration`; (b) **the queue**: the table plus `enqueue()`. Passes keep their logic; none becomes a job. |
| R3 | Cadence | **No 1-minute cron.** The 15-minute tick stays (`apps/web/vercel.json:5-6`). A faster start is an open question (§14 Q1), not part of the design. |

## 3. What the code does today (read at `a932a2dd`)

- **The tick.** `apps/web/vercel.json:3-12`: `/api/cron/reminders` every 15 minutes and
  `/api/cron/demo-refresh` once a day. The route declares `maxDuration = 300`
  (`api/cron/reminders/route.ts:16`), refuses with 503 when `CRON_SECRET` is unset and 401 on a
  mismatched bearer through a constant-time compare (`:40-50`; the demo route copies it,
  `demo-refresh/route.ts:29-37`), takes `APP_ORIGIN` else the request's origin (`:55`), and calls
  `runPasses(PASSES, ctx)` with ONE `now` (`:57-58`). The reminder pass's counters stay top-level,
  every other pass nests under its key (`:60-67`).
- **The harness.** `runPasses` runs passes in order, each in its own try/catch (`harness.ts:33-45`),
  writes `cron.pass.<key>` after each one (`:49`) and `cron.tick` once at the end (`:53`).
- **The registry.** `registry.ts:73`, in order: billingPause, releaseHeld, cancelNotices, reminders,
  followups, reviewRequest, referralAsk, noShowNudge, smsReminder, appointmentConfirm, reactivation,
  quoteFollowup, siteTraffic, documentsSweep, documentsScan, documentsExpiry, weeklyClientReport,
  weeklyAgencyReport, usageReport, opsWatch. Twenty passes.
- **The budgets.** RELEASE_BUDGET_MS 60 s (`passes/release-held.ts:73`), USAGE_REPORT_BUDGET_MS 60 s
  (`caps.ts:141`), WEEKLY_REPORT_BUDGET_MS 60 s (`caps.ts:199`), DOCUMENT_SCAN_BUDGET_MS 45 s
  (`passes/documents-scan.ts:63`), EXPIRY_BUDGET_MS 15 s (`passes/documents-expiry.ts:41`),
  CANCEL_NOTICE_BUDGET_MS 10 s (`passes/cancel-notices.ts:54`). The documents SWEEP has no budget
  (`passes/documents-sweep.ts:20-23` declares none). Sum 250 s; with `MIN_HEADROOM_MS` 50 s
  (`cron-coupling.test.ts:353`) that is exactly 300 = `maxDuration`. The ledger's line is right.
- **Heartbeats.** `ops_heartbeats` and `record_heartbeat` (0057:63-74, 91-120): service_role only,
  RLS on with no policy (`:85-89`). The alert pass reads them and must run last
  (`passes/ops-watch.ts:11-13`). Its rules (`lib/ops/watch.ts:7-19`): a `cron.pass.*` key alerts at
  two consecutive failures (`:56`); any other key alerts while its last error is newer than its last
  success (`:57-58`); a `cron.pass.*` row silent for an hour is ignored as retired (`:50, 66`);
  `cron.tick` is the health route's (`api/ops/health/route.ts:30, 46, 57`: 503 after 45 minutes).
- **The tallest ceiling in the app** is the voice route's `maxDuration = 800`
  (`api/voice/incoming/route.ts:119`), so this project already deploys an 800 s function.
- **Service-only shape.** 0057's: revoke all from anon, authenticated AND service_role, grant back
  only what service_role needs, RLS on with no policy, functions SECURITY INVOKER (`0057:88-89, 94,
  127-128`). 0096 made every function's path end in `pg_temp` (`0096_definer_search_path.sql:5-18`):
  a new function sets `search_path = pg_catalog, pg_temp` directly.
- **Account teardown.** `ACCOUNT_OWNED_TABLES` (`packages/db/src/account-teardown.ts:20-23`) lists
  every account-owned table even when it also cascades (`ai_ledger` is the precedent).

## 4. The fan-out mechanism

### 4.1 The options

| | A. One cron per pass | B1. Dispatcher, awaited, in sequence | B2. Dispatcher, fire-and-forget | **C. Dispatcher, awaited, as a dependency graph** |
|---|---|---|---|---|
| Own invocation and ceiling per pass | yes | yes | yes | yes |
| Order between passes | **lost**: twenty schedules fire independently; staggering minutes is timing, not a guarantee | kept (a strict sequence) | **lost** | kept where the audit (§5) finds a dependency, dropped everywhere else |
| One slow pass starves the rest | no | **yes**: the sequence waits; worst case is 20 ceilings in a row | no | only its own dependants wait |
| Auth | CRON_SECRET from Vercel's cron on 21 routes | CRON_SECRET from the cron on the dispatcher; the dispatcher sends the same bearer to each pass route | same as B1 | same as B1 |
| Dispatcher dies part-way | n/a | passes not yet started skip this tick | started passes run on; their outcome is never seen | as B1; §4.3 |
| Knows a pass was killed at its ceiling | no: a killed pass writes no heartbeat | yes: the 504 arrives at the dispatcher | no | yes |
| `cron.tick` meaning | gone: no single tick completes | kept | weakened (written before passes finish) | kept |
| `vercel.json` | 21 entries (ASSUMPTION: Vercel Pro allows 40 cron jobs per project; verify on Vercel's "Cron Jobs, usage and pricing" page) | unchanged | unchanged | unchanged |

**A is disqualified by §5**: release-before-recipes and follow-up-before-review are real same-tick
dependencies, and breaking the first can send a customer the same message twice. **B2** has the same
fault. **B1** keeps order but not the point of the item: a slow release pass still delays every
recipe. **Recommendation: C.**

### 4.2 Option C in detail

- **The dispatcher stays `/api/cron/reminders`.** `vercel.json` does not change, so
  `cron-coupling.test.ts:45-51` and `route.test.ts` stand. Its `maxDuration` becomes 800.
- **One pass route**, `app/api/cron/pass/[key]/route.ts`, `POST`, `maxDuration = 90`
  (PASS_ROUTE_MAX_S). Each call is its own invocation with its own 90 s. A pass that needs more gets
  a static sibling (`app/api/cron/pass/<key>/route.ts`; a static segment wins over `[key]`); the
  jobs drain is the first (§9, 300 s). The pass route:
  1. `CRON_SECRET` unset → 503, zero queries; bearer mismatch → 401, zero queries (one shared
     `cronAuthorized(req)` helper replaces the two copies at `reminders/route.ts:43-50` and
     `demo-refresh/route.ts:32-37`).
  2. `GET` → 405. A key not in `PASSES` (or `jobsDrain`) → 404, zero queries.
  3. Body `{ now }`, the dispatcher's tick instant, so ONE tick still has ONE now (`context.ts:18-21`).
     Refused (400) unless `Date.now() − 900 s ≤ now ≤ Date.now() + 60 s`, so a replayed body cannot
     run a pass at an arbitrary instant.
  4. Origin: `configuredOrigin()` (`lib/email/origin.ts:49-53`). Fan-out runs only with `APP_ORIGIN`
     set (§4.4), so a pass's links never fall back to a `vercel.app` origin.
  5. Runs `runPass(pass, ctx)`: the body of today's loop (`harness.ts:38-49`) extracted, so the
     route writes `cron.pass.<key>` and never `cron.tick`. Answers `200 { counters }`. A pass that
     throws is still 200 with `{ errored: 1 }`, exactly as today (`harness.ts:41-45`).
- **The plan** (`lib/automations/fanout.ts`): each node names the passes it waits for and how.
  - `settled` (the default): start once every predecessor has ANSWERED (any HTTP status: a 504 means
    its function was ended, so it is no longer running; ASSUMPTION about Vercel's timeout response,
    checked on Preview in §12) or was not started. A predecessor with NO answer (network failure, or
    the dispatcher's own wait for it ran out) may still be running, so its dependants are not started
    this tick.
  - `completed`: start only if every predecessor answered 200 (its harness ran to the end).
  - `regardless`: start once every predecessor has answered, been skipped or run out its wait; never
    blocked. Only the two read-and-report passes at the end use it.

| Node | Waits for | Rule | Why (§5 row) |
|---|---|---|---|
| billingPause | (none) | | 1 |
| releaseHeld | billingPause | settled | 1 |
| cancelNotices | billingPause | settled | 1 |
| reminders, followups, noShowNudge, smsReminder, appointmentConfirm, quoteFollowup | releaseHeld | settled | 2 |
| reviewRequest | followups | **completed** | 3 |
| referralAsk | reviewRequest | **completed** | 4 |
| reactivation | cancelNotices, reminders, referralAsk, noShowNudge, smsReminder, appointmentConfirm | settled | 5 |
| siteTraffic, documentsSweep, weeklyClientReport, jobsDrain | billingPause | settled | 1 |
| documentsScan | documentsSweep | settled | 6 |
| documentsExpiry | documentsScan | settled | 6 |
| weeklyAgencyReport | weeklyClientReport | settled | 7 |
| usageReport | every node above | regardless | 8 |
| opsWatch | every node, usageReport included | regardless | 9 |

  Every edge runs from an earlier to a later entry of `PASSES`, so today's sequence is still a valid
  order of the graph. That is what makes the single tick a safe rollback (§12), and a test pins it.
- **The executor** starts every node whose predecessors allow it, at once, and awaits each pass
  route with `AbortSignal.timeout(ceiling + 5 s)`. On each answer:
  - 200 → its counters go under its key; the pass route already wrote its heartbeat.
  - any other status → `{ errored: 1 }` under the key, and the DISPATCHER writes
    `cron.pass.<key>` failed ("the pass's function answered HTTP 504"). This closes a gap that exists
    today: a pass killed at the ceiling writes no heartbeat at all.
  - no answer → `{ errored: 1, noAnswer: 1 }`, the same failed heartbeat, and its `settled` and
    `completed` dependants are recorded `{ notStarted: 1 }` with no heartbeat (their predecessor's
    failure is the alert; two ticks of it reach the inbox, `watch.ts:52`).
  - The dispatcher writes every failure heartbeat BEFORE it starts opsWatch, so the alert pass reads
    this tick's rows, as today (`harness.ts:46-49`).
  - When every node has answered or been skipped, the dispatcher writes `cron.tick`. Its meaning is
    unchanged: a tick completed. The health route needs no change.
  - The JSON merges as today: `reminders`' counters top-level, every other key nested
    (`route.ts:58-67`), plus `jobsDrain` beside them.

### 4.3 When things go wrong

- **The dispatcher dies part-way.** Passes already started run to their own end (ASSUMPTION: Vercel
  does not end a callee because its caller's connection dropped; every pass is safe either way,
  because each stamps after it sends and a row left unstamped is due again next tick). Nodes not yet
  started skip this tick. No `cron.tick` is written; three such ticks in a row trip the hourly health
  check (`health/route.ts:30`).
- **Overlapping ticks.** The dispatcher's 800 s is under the 900 s interval, and every pass route's
  ceiling is under the dispatcher's, so one tick's passes have ended before the next tick starts. A
  test pins `800 < 900`.
- **Vercel delivering one cron event twice** (ASSUMPTION: Vercel's cron documentation advises
  idempotent cron handlers because an event may be delivered more than once). That is a property of
  today's single tick too; fan-out does not change it. Recorded in §15, not designed here.
- **Load.** After the release pass settles, up to eleven pass invocations run at once. Each costs one
  narrow indexed read when nothing is due (`route.ts:29-31`), and supabase-js talks HTTP to
  PostgREST, so no connection pool is at stake. **The real new pressure is the email provider**:
  today every send in a tick is sequential; under fan-out up to nine sending passes may send at
  once, and neither `lib/email/resend.ts` nor the SMS provider handles HTTP 429 today (no match for
  `429`, `rate limit` or `Retry-After` under `lib/email` or `lib/sms`). A refused send is unstamped
  and retried next tick by every pass, so the price is a 15-minute delay, except the window-bound
  text reminder (three attempts, `cron-coupling.test.ts:289-299`). §14 Q4.

### 4.4 Which address the dispatcher calls

The dispatcher calls `${APP_ORIGIN}/api/cron/pass/<key>`, the production custom domain, which
Vercel Authentication does not cover. With `APP_ORIGIN` unset it does not fan out: it runs today's
single tick in-process and logs that it did. Calling its own `vercel.app` deployment URL instead
would pin one build end to end, but generated deployment URLs sit behind Vercel Authentication
(ASSUMPTION: Standard Protection covers every deployment URL except the production domains), so that
path needs the "Protection Bypass for Automation" secret, a Vercel setting. §14 Q2.

### 4.5 Cost

96 ticks a day × (1 dispatcher + 21 pass invocations) = 2,112 invocations a day, about 64,000 a
month, against 96 a day today. The dispatcher spends its life waiting on fetches. ASSUMPTION: on
Fluid compute an idle wait bills provisioned memory, not active CPU, and Pro's monthly inclusion is
far above 64,000 invocations. Check the project's Usage page after the first week; nothing here
needs a plan change.

## 5. The ordering audit

A pass depends on an earlier one if, in the same tick, it reads a row, column or heartbeat the
earlier one writes. Each pass's due query, gate inputs and writes were read; "none" means none
found.

| # | Pair | Evidence | Under fan-out |
|---|---|---|---|
| 1 | billingPause → every gate | "a pause stamped this tick is read by every send gate below in the same tick" (`registry.ts:25-28`; `passes/billing-pause.ts:7-9`) | Kept: every node waits for it. It is cheap: no Stripe call, no budget (`billing-pause.ts:9-10`). `settled`, so a dead billingPause function cannot block the tick. |
| 2 | releaseHeld → every recipe with a releaser | A held subject is NOT stamped (`hold-or-send.ts:32-34`), so its own pass keeps listing it: the reminder query filters only `reminder_sent_at is null` (`packages/db/src/booking.ts:1466`). The release pass "runs BEFORE the domain passes so a subject released here is stamped before its own pass's due-list runs; the sequential harness is what makes a double send impossible" (`passes/release-held.ts:26-28`). Run side by side at the 08:00 opening, both would send the same subject. | **Kept, and it is the riskiest edge.** Every recipe whose source appears in `RELEASERS` (`release-held.ts:75-91`) waits for releaseHeld to settle. A release function with no answer may still be sending, so its dependants do not start. A test pins the edge to every pass-backed source in `RELEASERS`. |
| 3 | followups → reviewRequest | The review request sends only on a strictly later local day than `followup_sent_at` (`packages/db/src/automations.ts:164`, selected at `:268, 278`), but a null `followup_sent_at` defers nothing (`review-request-gate.ts:54-57`). Run first or side by side, "how did it go?" and "would you leave a review?" land the same morning (`registry.ts:31-34`). | Kept as **completed**: if the follow-up's function is killed part-way, rows it never reached still have no stamp, so the review request does not start this tick. That is what today's single tick does when it is killed. |
| 4 | reviewRequest → referralAsk | Reads `review_requested_at` (`automations.ts:1084, 1096`); also defers explicitly through `reviewRequestStillOwed` (`referral-ask-gate.ts:20-40, 96`), so the order "is a rule rather than a property of this array" (`registry.ts:38-42`) | Kept as **completed**, as row 3. Belt and braces: the explicit rule already holds. |
| 5 | earlier senders → reactivation | Reactivation's quiet check reads the conversation (`passes/reactivation.ts:172-174`), which a send by any earlier pass can write | Kept: it waits for every earlier sender. quoteFollowup is LATER in today's order, so reactivation never saw its sends; they stay side by side. |
| 6 | documentsSweep → documentsScan → documentsExpiry | The sweep purges trashed documents with their versions (`passes/documents-sweep.ts:7-12`); the scan works on versions; the expiry To-dos follow the scan "so a version the scan just cleared opens its To-do this same tick" (`registry.ts:53-58`) | Kept as a chain (`settled`). |
| 7 | weeklyClientReport → weeklyAgencyReport | "a reading convenience, not a dependency" (`registry.ts:59-63`) | Kept anyway: it costs nothing off the longest path. |
| 8 | every SMS sender → usageReport | Senders record usage as they send; running last means "a text sent this tick reaches Stripe this tick". "Nothing reads what it writes" (`registry.ts:64-67`) | Kept as `regardless`. A sender with no answer cannot hold billing up; its texts reach Stripe next tick, which Stripe accepts ("Stripe takes events up to 35 days old", `caps.ts:109`). |
| 9 | every pass → opsWatch | Reads the heartbeats this tick wrote (`passes/ops-watch.ts:11-13`), including `documents.scanner` from the scan (`registry.ts:55-56`; `lib/documents/scan-client.ts:28`) | Kept as `regardless`, last. The dispatcher writes its own failure heartbeats before starting it. |
| | cancelNotices | Reads and writes only `booking_cancel_notices`, its thread row and the booking's claim (`registry.ts:44-47`; `passes/cancel-notices.ts:7-25`) | Starts right after billingPause, ahead of the recipes, which helps a customer waiting to hear their appointment is off. |
| | reminders, smsReminder, appointmentConfirm, noShowNudge, quoteFollowup, siteTraffic | Each filters on its own stamp. The day caps count each pass's OWN stamp column (`caps.ts:19-23`), so passes side by side cannot overrun one another's cap. The confirmation ask and the email reminder are kept apart by their windows, not by order (`cron-coupling.test.ts:94-108`). quoteFollowup reads inbound messages, which no pass writes. siteTraffic sends nothing and touches no booking state (`registry.ts:51-53`). | Side by side. |

## 6. The budgets and the new coupling

- **The six budgets stay, unchanged, inside their passes.** Each now bounds its pass against its
  own 90 s route, not a shared 300 s. A pass's budget stops it STARTING a row; the rest of its
  ceiling is for the row in flight. The new invariant per pass is `budget + 30 s ≤ PASS_ROUTE_MAX_S`
  (90): 60, 60, 60, 45, 15 and 10 all fit. Every unbudgeted pass gets 90 s to itself, where today
  all of them share 50.
- **The shared sum goes away for fan-out, and stays for the fallback.** While the in-process tick
  exists as the rollback (§12), its test (`cron-coupling.test.ts:338-357`) must still hold, but it
  reads the route's `maxDuration`, which moves to 800 and would silently weaken it. It is retargeted
  to a constant `LEGACY_TICK_CEILING_S = 300`, and the in-process path keeps its own 300 s rule. It
  is deleted together with the in-process path.
- **The new coupling** (added to `cron-coupling.test.ts`, which reads every literal with the
  whole-line anchored regex it already uses at `:307`, so a commented-out export cannot match):
  1. the pass route's `maxDuration` equals PASS_ROUTE_MAX_S, and every pass budget + 30 s fits it;
  2. the drain route: `JOBS_DRAIN_BUDGET_MS + 30 s ≤ its maxDuration`, and
     `JOB_TIMEOUT_MAX_MS ≤ JOBS_DRAIN_BUDGET_MS`;
  3. **the longest path through the plan**, counting each node's ceiling + 5 s of wait, plus 20 s of
     slack, is ≤ the dispatcher's `maxDuration`. Today that path is billingPause → releaseHeld →
     followups → reviewRequest → referralAsk → reactivation → usageReport → opsWatch:
     8 × 95 = 760 s, + 20 = 780 ≤ 800. The drain's path is 95 + 305 + 95 + 95 = 590;
  4. the dispatcher's `maxDuration` is under the tick interval (800 < 900), so ticks never overlap.
  The rule that replaces "the next budget must come out of a neighbour" (`:349`) is: **a node added
  to the longest path must come out of a ceiling or move off that path.**

## 7. The jobs table (migration 0102, `0102_jobs.sql`)

Additive only: nothing in the build before it reads the table, so production takes the file before
the merge deploy (0057's order, `0057:14-16`). No backslash and no non-ASCII byte in the file (the
MCP apply rule, `0057:55-56`): the kind pattern uses `[.]`, not an escaped dot.

```sql
create table public.jobs (
  id uuid primary key default gen_random_uuid(),
  kind text not null
    constraint jobs_kind_check check (char_length(kind) <= 60 and kind ~ '^[a-z][a-z0-9_]*([.][a-z][a-z0-9_]*)+$'),
  account_id uuid references public.accounts(id) on delete cascade,  -- null: platform work
  idempotency_key text not null
    constraint jobs_idempotency_key_check check (char_length(idempotency_key) between 1 and 200),
  payload jsonb not null default '{}'::jsonb
    constraint jobs_payload_size_check check (octet_length(payload::text) <= 8192),
  state text not null default 'queued'
    constraint jobs_state_check check (state in ('queued', 'running', 'retrying', 'succeeded', 'dead')),
  run_after timestamptz not null default now(),
  attempts integer not null default 0 constraint jobs_attempts_check check (attempts >= 0),
  max_attempts integer not null constraint jobs_max_attempts_check check (max_attempts between 1 and 25),
  timeout_ms integer not null constraint jobs_timeout_ms_check check (timeout_ms between 1000 and 60000),
  claim_token uuid,
  lease_until timestamptz,
  last_error text constraint jobs_last_error_check check (char_length(last_error) <= 300),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  finished_at timestamptz,
  constraint jobs_kind_key unique (kind, idempotency_key),
  constraint jobs_running_has_lease check ((state = 'running') = (lease_until is not null and claim_token is not null)),
  constraint jobs_finished_has_time check ((state in ('succeeded', 'dead')) = (finished_at is not null))
);
```

- **States.** `queued` (waiting for `run_after`) → `running` (claimed, under lease) → `succeeded`;
  or → `retrying` (failed, will retry at `run_after`) → `running` again; or → `dead` (out of
  attempts, refused as permanent, or a payload that cannot parse). `succeeded` and `dead` are final.
- **Lease and visibility timeout.** A claim sets `lease_until = now() + timeout_ms + 30 s` and a fresh
  `claim_token`. While the lease holds, no other claim can take the row. A lease that runs out means
  the worker died: the next claim takes the row again, with `attempts + 1`, so a crash counts as an
  attempt. A run-out lease on the LAST attempt goes to `dead` ("the worker stopped before
  finishing"), not back to work. With leases of at most 90 s and a 15-minute tick, every lease has
  run out before the next drain.
- **Backoff and attempts.** `attempts` rises at each claim. The next `run_after` is computed in
  TypeScript (§8), where it is a pure function under test.
- **Idempotency.** `unique (kind, idempotency_key)`. An enqueue that collides returns the existing
  job and creates nothing. The key de-duplicates for as long as the row is kept (§7, retention):
  after a succeeded row is swept, the same key enqueues new work.
- **Payload.** Ids and small facts only, at most 8 KB as text. Never an address, a phone number, a
  token or a message body: a dead job's error reaches an email, and payloads are read by hand in
  the runbook. Bulk data lives in its own table or in storage, referenced by id.
- **Account scope.** `account_id` is set when the work belongs to one account and null for platform
  work. Deleting an account deletes its jobs (`on delete cascade`), and `jobs` is added to
  `ACCOUNT_OWNED_TABLES` beside `ai_ledger`'s precedent, ordered before `accounts`. A job running when
  its account goes finds its row gone on completion; the drain counts it `vanished`, not failed.
- **Indexes.**
  ```sql
  create index jobs_due_idx on public.jobs (run_after, id) where state in ('queued', 'retrying');
  create index jobs_lease_idx on public.jobs (lease_until) where state = 'running';
  create index jobs_finished_idx on public.jobs (finished_at) where state in ('succeeded', 'dead');
  create index jobs_account_idx on public.jobs (account_id) where account_id is not null;
  ```
- **The claim**, the one thing PostgREST cannot express:
  ```sql
  create function public.claim_jobs(p_kinds text[], p_limit integer default 1)
  returns setof public.jobs
  language plpgsql
  security invoker
  set search_path = pg_catalog, pg_temp
  as $$
  begin
    if p_limit is null or p_limit < 1 or p_limit > 50 then
      raise exception 'claim_jobs: p_limit must be 1 to 50' using errcode = '22023';
    end if;
    -- A lease that ran out on the last allowed attempt is dead, not re-claimed.
    update public.jobs set state = 'dead', finished_at = now(), lease_until = null, claim_token = null,
           last_error = 'the worker stopped before finishing (lease expired)', updated_at = now()
     where id in (select id from public.jobs
                   where state = 'running' and lease_until < now() and attempts >= max_attempts
                   for update skip locked);
    return query
    with picked as (
      select id from public.jobs
       where kind = any(p_kinds)
         and ((state in ('queued', 'retrying') and run_after <= now())
              or (state = 'running' and lease_until < now()))
       order by run_after, id
       for update skip locked
       limit p_limit)
    update public.jobs j
       set state = 'running', attempts = j.attempts + 1, claim_token = gen_random_uuid(),
           lease_until = now() + make_interval(secs => j.timeout_ms / 1000.0 + 30), updated_at = now()
      from picked
     where j.id = picked.id
    returning j.*;
  end;
  $$;
  ```
  SECURITY INVOKER, not definer: only service_role calls it, and it already holds the table grants
  (0057's reasoning, `0057:42-44`). There is no policy check inside, so the plpgsql
  `IF NOT (...)` NULL trap (`0053:77-80`'s `coalesce`) does not arise. `p_kinds` is the drain's own
  handler list, so a kind enqueued by a newer build is never claimed by an older one (it waits, and
  the backlog heartbeat shows it, §10).
- **Completing and failing** are plain PostgREST updates fenced by the claim:
  `.eq("id", id).eq("claim_token", token).eq("state", "running")`, with `.select("id")` to see whether
  a row matched. A worker whose lease ran out and was re-claimed cannot overwrite the new claim.
- **Retention**, swept by the drain at the end of every run through
  `sweep_jobs(p_limit integer) returns integer` (same shape, same grants): deletes up to `p_limit`
  rows that are `succeeded` with `finished_at` older than 7 days or `dead` older than 30 days, oldest
  first, and nothing else. §14 Q3.
- **Grants and RLS** (0057's shape): `alter table public.jobs enable row level security` with no
  policy; `revoke all on public.jobs from anon, authenticated, service_role`; `grant select, insert,
  update, delete on public.jobs to service_role` (delete for the sweep and the runbook). Each
  function: `revoke all ... from public, anon, authenticated, service_role; grant execute ... to
  service_role`. A client session can neither see nor write a job.
- **Rollback** (code first): `drop function public.sweep_jobs(integer); drop function
  public.claim_jobs(text[], integer); drop table public.jobs;`

## 8. The runner API

Everything lives under `apps/web/src/lib/automations/jobs/`, so `imports.test.ts` already scans it:
a handler cannot reach a provider factory, and sends through `ctx.email`/`ctx.sms`, the gates that
honour `outbound_suppressed` and the billing pause.

```ts
// types.ts
export type JobContext = PassContext & {
  job: { id: string; kind: string; attempt: number; maxAttempts: number; accountId: string | null; signal: AbortSignal };
};
export type JobHandler<P> = {
  readonly kind: string;                 // "calendar.push": a dot-separated name, matched by 0102's CHECK
  readonly maxAttempts: number;          // 1-25; stated by every handler, no default
  readonly timeoutMs: number;            // 1,000 to JOB_TIMEOUT_MAX_MS (60 s)
  readonly backoff?: { baseMs: number; capMs: number };  // default 15 min doubling, cap 24 h
  parse(payload: unknown): P;            // throws → dead at once: a payload that cannot parse never will
  run(ctx: JobContext, payload: P): Promise<void>;       // returns → succeeded; throws → retry or dead
};
export class PermanentJobError extends Error {}           // dead now, no retry (a 404 for a deleted calendar)
export class RetryJobAfter extends Error {                // retry no sooner than afterMs (a Retry-After header)
  constructor(readonly afterMs: number, message: string) { super(message); }
}

// registry.ts: typed like PASSES, one line per kind
export const JOB_HANDLERS = { [platformPing.kind]: platformPing } as const satisfies Record<string, JobHandler<unknown>>;
export type JobKind = keyof typeof JOB_HANDLERS;
export type JobPayload<K extends JobKind> = ReturnType<(typeof JOB_HANDLERS)[K]["parse"]>;

// enqueue.ts (server-only)
export async function enqueue<K extends JobKind>(
  kind: K, payload: JobPayload<K>,
  opts: { idempotencyKey: string; accountId: string | null; runAfter?: Date; db?: SupabaseClient },
): Promise<{ id: string; created: boolean }>;
```

- `enqueue` writes through `serviceDb()` (the table is service-only), copies `maxAttempts` and
  `timeoutMs` from the handler onto the row (so the claim needs no registry), refuses an oversize
  payload before the insert, and on a key collision reads the existing row back and answers
  `created: false`. `accountId` is required, null included, so every author decides it. The caller
  authorises the work before enqueueing it; `enqueue` checks nothing about who asked.
- **Backoff** (`backoff.ts`, pure): after failed attempt n, wait `min(base × 2^(n−1), cap)` with ±20%
  jitter; `RetryJobAfter` replaces the computed wait (still capped). With the default base and five
  attempts, retries come about 15 min, 30 min, 1 h and 2 h apart, and the job is dead after about four
  hours of failing. Nothing retries sooner than the next tick.
- **The one handler that ships**, `platform.ping` (payload `{}`, one attempt, 5 s, does nothing), is
  the rollout check (§12): it proves enqueue → claim → complete on the real database.
- **At-least-once: the rule handler authors must follow.** A handler may run more than once for the
  same job, and two runs may overlap (a lease that ran out while the first run was still working, or
  a run that ignored its abort signal). Therefore:
  1. Every handler is idempotent. It checks its own result before acting (a stamp, a stored external
     id), or hands the external system an idempotency key derived from the job (`job.id` as Stripe's
     `Idempotency-Key`), never "it ran, so it is done".
  2. It finishes inside `timeoutMs` and stops when `ctx.job.signal` aborts. Work longer than 60 s is
     split into jobs that enqueue their own next step (F-121's export is the first that must).
  3. Its errors carry no address, phone number, token or payload: the first 300 characters reach
     `last_error` and the ops email.
  4. It reads `ctx.now`, never `new Date()`, like every pass.

## 9. Who drains the queue, and when

The drain is a node in the plan, `jobsDrain`, run by the 15-minute tick through its own static route,
`app/api/cron/pass/jobsDrain/route.ts`, `maxDuration = 300`. It is NOT added to `PASSES`: the
in-process fallback never drains (its 300 s is already spent, §3), and no producer exists until a
later part, whose spec must require fan-out on. Each drain:

1. Loops: stops claiming when `elapsed + JOB_TIMEOUT_MAX_MS > JOBS_DRAIN_BUDGET_MS` (240 s), or after
   JOBS_PER_DRAIN (100) claims, or when a claim returns nothing. It claims ONE job per call
   (`claim_jobs(kinds, 1)`), so no claimed job waits on another's lease.
2. Runs the handler with `AbortSignal.timeout(job.timeout_ms)`, raced against the timeout.
   Returns → `succeeded`. Throws → `retrying` with the backoff, or `dead` when `attempts =
   max_attempts`, on `PermanentJobError`, or when `parse` throws.
3. Sweeps finished rows (`sweep_jobs(500)`).
4. Writes the two queue heartbeats (§10).
5. Answers `{ claimed, succeeded, retried, dead, vanished, notStartedBudget, swept, oldestWaitMinutes }`.

Concurrency is safe beyond one drain: `SKIP LOCKED` and the claim token let any number of drains run
at once. One drain per tick is the starting point; nothing in the table assumes it.

## 10. Observability

- `cron.pass.<key>` for every pass, written by the pass route, or by the dispatcher when the route
  never answered 200 (§4.2). `cron.pass.jobsDrain` the same way.
- `cron.tick`, written by the dispatcher once every node has answered or been skipped. Same meaning,
  same reader.
- **`jobs.dead`**, written by every drain: failed while any `dead` row exists, with a last error
  naming kinds and counts only ("2 jobs gave up: calendar.push (2)"); ok when none does. It is not a
  `cron.pass.*` key, so ops-watch alerts on its FIRST failure (`watch.ts:57-58`), repeats every six
  hours while dead rows remain (`:51, 68`), and sends one "working again" when none do. A person
  clears it by requeueing or deleting the rows (runbook, §12) or it clears itself when retention
  sweeps them.
- **`jobs.backlog`**, written by every drain: failed when the oldest due job has waited more than an
  hour (four ticks), naming its kind; ok otherwise. This catches a kind nobody can claim and a drain
  that never keeps up.
- `describeKey` gets a plain label for each ("background jobs that gave up", "background jobs
  waiting too long"), pinned by `watch.test.ts` the way the webhook keys are (`watch.ts:86-95`).
- **What the agency sees: nothing new.** The queue is platform plumbing, and the module contract
  (DESIGN.md, "The module contract") admits no new surface for it. The first producer that a person
  waits on (an export) shows its own state on its own surface, in its own spec. F-136's cockpit may
  later read job counts per account; that is its decision.

## 11. Tests

Every case names its mutation. **Constraint:** on a branch whose migration adds a table, no
`@bis/db` vitest runs locally until 0102 is on bis-ci. The db cases are proven by CI `verify` (its
throwaway stack applies every migration) or by the local PG18 replica, not by a local run against
bis-ci.

**Database** (`packages/db/src/test/jobs-schema.test.ts`, `jobs.test.ts`):

1. anon and authenticated: select, insert, update and delete on `jobs` refused (42501); execute on
   `claim_jobs` and `sweep_jobs` refused. service_role: all allowed. *Grant select to
   authenticated → FAILS.*
2. RLS on and zero policies (`pg_class.relrowsecurity`, `pg_policies`). *Disable RLS → FAILS.*
3. CHECKs: a 9 KB payload, a bad state, `max_attempts` 0, `timeout_ms` 61,000, a kind with no dot,
   a 301-character error, `running` without a lease each refused 23514. *Drop the payload CHECK →
   FAILS.*
4. `unique (kind, idempotency_key)`: the second insert 23505; the same key under another kind is
   accepted. *Make the key unique alone → the second case FAILS.*
5. **The claim race**, on two connections (the holder/waiter shape of
   `consent-writes-schema.test.ts:330-350`): two due jobs; the holder claims one inside an open
   transaction; the waiter, `lock_timeout = '300ms'`, claims and gets the OTHER job at once. *Drop
   `skip locked` → the waiter blocks, 55P03, FAILS. Drop `for update` → the waiter gets the same job,
   FAILS.*
6. Lease run-out re-claim: a `running` row whose lease has run out is claimed again with
   `attempts + 1` and a new token; one under a live lease is not. *Drop the lease clause → FAILS.*
7. Lease run-out on the last attempt → `dead` with the lease-expired error, not re-claimed. *Drop the
   dead-letter update → it is re-claimed, FAILS.*
8. `run_after` in the future is not claimed; a kind outside `p_kinds` is not claimed. *Drop either
   predicate → FAILS.*
9. Account deletion removes that account's jobs and leaves platform jobs; `ACCOUNT_OWNED_TABLES`
   holds `jobs` before `accounts` (the index check of `ai-acts-schema.test.ts:368`). *Drop the
   cascade → FAILS.*
10. `sweep_jobs` deletes old `succeeded` and `dead` rows only, at most `p_limit`. *Drop the state
    filter → a queued row is deleted, FAILS.*

**Web** (`apps/web`, by path):

11. `backoff.test.ts`: the doubling, the cap, the jitter bounds, `RetryJobAfter`. *Drop the cap →
    FAILS.*
12. `passes/jobs-drain.test.ts` (bare `@bis/db` mock): success completes; a throw retries with the
    backoff; a throw on the last attempt, `PermanentJobError` and a `parse` throw each dead-letter; a
    stale claim token counts `vanished`; the handler timeout fires (*drop the race → FAILS*); no job
    is claimed once the longest timeout would overrun the budget (*drop the fit check → FAILS*);
    `jobs.dead` and `jobs.backlog` written ok and failed.
13. `enqueue.test.ts`: `created: false` on a collision; an unknown kind is a type error
    (`@ts-expect-error`) and a runtime refusal; an oversize payload is refused before any insert
    (*drop the size check → the insert is attempted, FAILS*); `maxAttempts` and `timeoutMs` copied
    from the handler.
14. `jobs/registry.test.ts`: every handler's `timeoutMs ≤ JOB_TIMEOUT_MAX_MS` and `maxAttempts` in
    1-25, and every kind matches 0102's pattern. `imports.test.ts` gains a case proving it scans
    `jobs/` (*add `getSmsProvider` to a handler → FAILS*).
15. `fanout.test.ts`, the plan: its nodes are exactly `PASSES` plus `jobsDrain`; every edge runs
    earlier → later in `PASSES` (*add reminders → releaseHeld → FAILS*); releaseHeld precedes every
    pass-backed `RELEASERS` source (*drop the edge to reminders → FAILS*); followups → reviewRequest
    and reviewRequest → referralAsk are `completed` (*make either `settled` → FAILS*); usageReport and
    opsWatch follow every node.
16. `fanout.test.ts`, the executor (an injected `invoke`, deferred promises): reminders and
    siteTraffic are both in flight before either answers (*await in sequence → FAILS*); no recipe
    starts before releaseHeld answers; a 504 from followups leaves reviewRequest `notStarted`
    (*treat non-200 as completed → FAILS*); no answer from releaseHeld leaves every recipe
    `notStarted` while opsWatch still runs; failure heartbeats are written for non-200 and no-answer
    and never for 200 (*write one on 200 → FAILS*), all before opsWatch starts; `cron.tick` is written
    once, after opsWatch; every call carries the same `now`.
17. Routes. The dispatcher: with `CRON_FANOUT` unset, today's `route.test.ts` passes untouched; with
    `"1"` and `APP_ORIGIN` set, the merged JSON has the same shape (`reminders` top-level); with `"1"`
    and no `APP_ORIGIN`, the in-process tick runs and one error line names why. The pass route: 503
    with zero queries, 401 with zero queries, 405 on GET, 404 on an unknown key with zero queries, 400
    on a `now` outside the window, and 200 running exactly one pass that writes `cron.pass.<key>` and
    never `cron.tick` (*call `runPasses` → `cron.tick` written, FAILS*).
18. `cron-coupling.test.ts` additions (§6): *PASS_ROUTE_MAX_S 120 → the longest path is 8 × 125 =
    1,000 > 800, FAILS; add an edge that lengthens the longest path → FAILS; dispatcher
    `maxDuration` 900 → FAILS; comment out any `maxDuration` → `NaN`, FAILS.* The legacy sum case is
    retargeted to `LEGACY_TICK_CEILING_S`, its mutations unchanged.
19. `watch.test.ts`: `jobs.dead` and `jobs.backlog` have plain labels. *Remove one → FAILS.*

## 12. Rollout and rollback

1. **0102** to bis-ci first (`ci-project-setup.yml`), then production, then the parity check
   (`docs/runbooks/ci-supabase-project.md`). Additive: the running build never touches it.
2. **Merge with the switch off.** `CRON_FANOUT` (exactly `"1"` is on, the shape of
   `BILLING_ENFORCE`, `lib/billing/enforce.ts:10-12`) is unset at merge: the dispatcher runs today's
   in-process tick, and the merged build behaves as today plus a table nobody writes.
3. **Preview** (bis-ci): set `CRON_FANOUT=1` for Preview, invoke the dispatcher once by hand through
   Preview's protection bypass, and read on bis-ci: a 200 with every key, one fresh `cron.pass.*` row
   per pass, `cron.tick`, the two `jobs.*` rows ok. Enqueue one `platform.ping` and run the dispatcher
   again: the row is `succeeded`. This is also where the two ASSUMPTIONS in §4.2 and §4.3 (a 504 at the
   ceiling; a callee outliving its caller) are checked, with a test-only slow pass behind a Preview-only
   variable, or recorded as not checked.
4. **Production:** set `CRON_FANOUT=1`, redeploy (an environment change needs a redeploy, as
   `enforce.ts:8` says of its own switch), and watch two ticks: the cron log's JSON, every heartbeat
   fresh, no ops email.
5. **Rollback, fast:** unset `CRON_FANOUT` and redeploy. The single tick returns exactly as it is
   today; the edges are a sub-order of `PASSES` (test 15), so the sequence honours every one. Jobs
   wait, harmlessly, with no producer. **Slow:** revert the PR, then drop 0102's objects.
6. **Retiring the fallback** is a later, separate change: after four clean weeks on fan-out, delete
   the in-process path, `LEGACY_TICK_CEILING_S` and its test.
7. **Runbook (proposed, for bis-platform to land):** `docs/runbooks/background-jobs.md`: reading a
   dead job (`select kind, account_id, attempts, last_error, finished_at from jobs where state =
   'dead'`), requeueing one (`state = 'queued', attempts = 0, run_after = now(), finished_at = null,
   last_error = null`), discarding one, and the switch.

## 13. Out of scope

- Converting any pass into jobs. The passes keep their queries, gates, sends and stamps.
- A 1-minute or any faster cron (R3).
- Any UI, agency or client. A producer's own UI comes with that producer.
- A second scheduler of any kind: `run_after` on the next tick is the only clock.
- The first real producer (S-22's calendar push or F-121's export): its own spec, which must require
  fan-out on.
- Guarding against a doubly-delivered cron event (§4.3, §15).

## 14. Open questions for the owner

**Q1. Should a new job start sooner than the next tick?** A "kick" would have `enqueue()` invoke
the drain route once, right after the insert, so a job starts within seconds instead of within
15 minutes. It is safe (`SKIP LOCKED` lets a kicked drain and the tick's drain run side by side) and
costs one invocation per enqueue. *Recommendation: not in this part. Nothing enqueues yet. Decide
with S-22, the first producer where a person may notice the wait ("I booked it, why isn't it in my
Outlook yet?").*

**Q2. Which address does the dispatcher call?** (a) `APP_ORIGIN`, the custom domain: no Vercel
setting changes, but for the instant of a promotion one tick may run passes from two builds; or
(b) the dispatcher's own deployment URL with Vercel's "Protection Bypass for Automation" secret:
one build per tick, but it needs that setting turned on and its secret in Production.
*Recommendation: (a). Every pass is safe across builds (stamps, not order, prevent repeats), the
edges do not change from one build to the next, and fan-out stays off wherever `APP_ORIGIN` is
unset.*

**Q3. How long are finished jobs kept, and how long may a dead job nag?** *Recommendation:
succeeded rows 7 days (which is also how long a key de-duplicates); dead rows 30 days, with the
`jobs.dead` alert repeating every six hours until a person requeues or deletes them. A dead job is
work a customer or a client is missing, and the repeat is the point.*

**Q4. Today's sends run one at a time; with fan-out, up to nine sending passes may send at once,
and neither the email nor the SMS provider handles a rate-limit refusal (HTTP 429).** (a) Before
the switch goes on, bis-comms teaches both providers to wait out one 429 (honour `Retry-After`,
retry once); or (b) the dispatcher caps sending passes in flight at two, which weakens the time
bound in §6. *Recommendation: (a). It fixes the risk where it lives, and leaves the plan's time
bound true. A refused send is not lost either way: it is unstamped and goes next tick.*

## 15. Findings outside this item (for the ledger, unfixed)

- §3.2 rule 9 (`docs/crm-features.md:948`) let the tick take "at most six new passes, each named
  here". The tick has taken five of the named ones (the vault's three, the alert pass, the billing
  pause) and one that is not named: `cancelNotices` (F-048). The consent reconciliation pass is
  named but not registered.
- Stale counts in comments: `cron-coupling.test.ts:313` says `PASSES` has "seventeen entries today"
  (it has twenty); `caps.ts:120-127` says the budgets sum to 240 s leaving 60 s (it is 250 s and
  50 s since the cancel-notice budget); `documents-scan.ts:59` cites a four-pass sum of 285 s.
- A cron event delivered twice would run every pass twice at once, today as under fan-out (§4.3).
  If that is ever seen, a tick-slot row with a unique 15-minute key is the cheap guard.
- `lib/email` and `lib/sms` have no handling for HTTP 429 (§4.3, Q4).

## 16. Files, and whose they are

- bis-automations: `lib/automations/fanout.ts`, `cron-auth.ts`, `harness.ts` (extract `runPass`),
  `jobs/{types,registry,enqueue,backoff,platform-ping}.ts`, `passes/jobs-drain.ts`;
  `app/api/cron/reminders/route.ts`, `app/api/cron/pass/[key]/route.ts`,
  `app/api/cron/pass/jobsDrain/route.ts`; `packages/db/src/jobs.ts`; the tests in §11.
- bis-db-schema: `0102_jobs.sql`, its grants test, and the `ACCOUNT_OWNED_TABLES` line in
  `account-teardown.ts`.
- Whoever owns `lib/ops`: the two `describeKey` labels in `watch.ts` and their `watch.test.ts` pin.
- bis-comms: the 429 handling in Q4, if (a).
- bis-platform: `docs/runbooks/background-jobs.md`; `CRON_FANOUT` in Preview and Production;
  `.env.example` gains `CRON_FANOUT` with a one-line comment. `vercel.json` does not change.
