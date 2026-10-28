# Background jobs: the fan-out tick and the job queue (F-196)

Plan: `docs/superpowers/plans/2026-10-28-background-job-runner.md`. Spec:
`docs/superpowers/specs/2026-10-28-background-job-runner-design.md`.

Audience: danlo (switching it on, SQL by hand) and the orchestrator
(watching ticks, the rollout checklist).

## 1. What it is

Every 15 minutes, `/api/cron/reminders` runs every registered automation
pass (reminders, review requests, the weekly reports, and the rest — 20 in
all), plus a drain for one-off retryable work. Today it runs them all in
one function call, one after another. With the switch on, it instead calls
each pass as its own function (POSTing to `/api/cron/pass/<key>`, or
`/api/cron/pass/jobsDrain` for the drain), in dependency order, so one slow
or crashing pass can no longer delay or break the others.

The `jobs` table (migration 0102) holds one-off work a producer enqueues —
nothing enqueues into it yet, as of this write. `claim_jobs` picks up due
rows under a lease so two workers never run the same job twice, a job is
kept as `dead` once it runs out of retries rather than disappearing, and
`sweep_jobs` deletes old finished rows (section 7).

## 2. The switch: `CRON_FANOUT`

```
CRON_FANOUT=
```
Exactly `"1"` turns fan-out on; anything else, or `APP_ORIGIN` unset, runs
today's single tick instead. **Vercel Production only — never Preview**
(Preview has no `APP_ORIGIN` and sits behind Vercel Authentication, so a
pass route there could only fail). An environment change reaches new
deployments only: redeploy after changing it.

## 3. Switching it on, in production

Do this once, in order, after the merge is deployed with the switch off and
watched clean for a couple of ticks.

1. Confirm the 429-retry work (bis-comms, F-196 Task 4) is in the deployed
   build — it ships in the same merge, so this is a sanity check, not a
   separate deploy.
2. Dry run: a local fan-out run against bis-ci (`next dev`, with
   `CRON_SECRET`, `CRON_FANOUT=1` and `APP_ORIGIN=http://localhost:3000` set
   for that one shell only — never in an `.env*` file). Under `next dev`
   both providers are the fakes unless `EMAIL_DEV_REDIRECT_TO` or
   `SMS_DEV_REDIRECT_TO` is set, so first confirm, BY NAME ONLY, that
   neither is in `apps/web/.env.local` (never print a value):
   `grep -c "^EMAIL_DEV_REDIRECT_TO=\|^SMS_DEV_REDIRECT_TO=" apps/web/.env.local`
   must answer `0`. Setting them blank in the shell would only unset them
   and let the file's value load. Call the dispatcher and expect a 200 whose
   JSON is the `reminders` pass's counters at the top level plus 20 nested
   keys (the 19 other passes and `jobsDrain`), the same shape as today's
   single tick; a fresh `cron.pass.<key>` row for each of the 21 keys on
   bis-ci, a fresh `cron.tick`, and `jobs.dead`/`jobs.backlog` both ok. Enqueue one
   throwaway `platform.ping` row by SQL and run the dispatcher again: the
   row ends up `succeeded`. Delete it. Check first that no `screenshots.yml`
   run is using the same seeded account.
3. Confirm Production's `APP_ORIGIN` is `https://app.bis-rgv.com` (by name
   and target only — never by reading the value anywhere else).
4. Set `CRON_FANOUT=1` on Vercel Production (Remove-then-Add if the name
   already exists — "Add New" on an existing name silently does nothing),
   then redeploy.
5. Watch two production ticks:
   - the cron's JSON carries no `noAnswer`, `notStarted`, `unreadable` or
     `errored` key anywhere (an `errored` alone, with nothing else, usually
     means a pass's function was refused before it ran — a firewall 403,
     say);
   - every `cron.pass.*` row and `cron.tick` are fresh;
   - `jobs.dead` and `jobs.backlog` are both ok;
   - no ops alert email arrives;
   - Vercel's logs show 21 `/api/cron/pass/*` invocations per tick.
6. After a week, read the project's Usage page and record what the extra
   invocations cost.

## 4. Reading dead jobs

A job reaches `dead` once it runs out of retries (`max_attempts`). It stays
exactly as it failed until a person acts on it:
```sql
select kind, account_id, attempts, last_error, finished_at
from jobs where state = 'dead' order by finished_at desc;
```

## 5. Requeueing or discarding a dead job

Requeue it (it runs again on the next drain):
```sql
update jobs set state = 'queued', attempts = 0, run_after = now(),
  finished_at = null, last_error = null, updated_at = now()
where id = '<id>' and state = 'dead';
```
Discard it, when the work is no longer wanted:
```sql
delete from jobs where id = '<id>' and state = 'dead';
```

## 6. What `jobs.dead` and `jobs.backlog` mean

Two heartbeats the drain pass writes every tick, read by the ops alert pass
(`opsWatch`). Unlike a `cron.pass.*` key, which alerts at two failures in a
row, each alerts on its FIRST failure, as a webhook key does. (`/api/ops/health`
does not read them; it watches `cron.tick` and the scanner only.)
- `jobs.dead` fails while any job is `dead`, naming each kind and its count
  ("2 jobs gave up: calendar.push (2)"; past 1000 dead rows it says "1000 or
  more" rather than a count). It clears on its own the next tick after every
  dead job is requeued or discarded (section 5).
- `jobs.backlog` fails when the oldest due job (`queued` or `retrying`, its
  `run_after` passed) has waited more than 60 minutes, and the alert names
  that job's kind ("the oldest waiting job (calendar.push) has waited 61
  minutes"). It clears on its own once the drain catches up.

Once alerted, either keeps re-alerting every six hours until it clears, by
design (the owner's Q3 decision) — that repeat is the point, not a bug.

## 7. Retention

`sweep_jobs` (run from the drain pass) deletes `succeeded` rows after 7
days and `dead` rows after 30.

## 8. Before the merge: 0102 on production

0102 must be on production BEFORE the PR merges, not after: the daily demo
re-seed's `deleteAccountCascade` walks `ACCOUNT_OWNED_TABLES`, which names
`jobs` from the first deploy, so a production without the table fails that
re-seed. Order: bis-ci (the `ci-project-setup.yml` workflow), then
production, then the parity check (`docs/runbooks/ci-supabase-project.md`),
then merge.

## 9. Rollback

**Fast:** unset `CRON_FANOUT` and redeploy. The single tick returns exactly
as it is today; jobs already in the table wait, harmlessly, with no
producer to notice.

**Slow:** revert the PR, then drop 0102's objects — production first, then
bis-ci:
```sql
drop function public.sweep_jobs(integer);
drop function public.claim_jobs(text[], integer);
drop table public.jobs;
```

**Either way, before you call it done:**

1. First settle any dead jobs (section 5) — once there is no drain left to
   write `jobs.dead`/`jobs.backlog`, a row that is already failing cannot
   clear itself.
2. Then clear the two heartbeat rows. They are not `cron.pass.*` keys, so
   ops-watch never treats them as stale on their own, and with nothing left
   to write them an already-failing row would re-alert every six hours
   forever:
   ```sql
   delete from ops_heartbeats where key in ('jobs.dead', 'jobs.backlog');
   ```
   `service_role` holds no DELETE grant on `ops_heartbeats` (0057, by
   design) — run this as the table owner in the Supabase SQL editor, never
   through a client session.
