-- 0102_jobs.sql
-- F-196 part 1: the job queue (docs/superpowers/specs/2026-10-28-background-job-runner-design.md,
-- section 7, as amended 2026-10-28; plan docs/superpowers/plans/2026-10-28-background-job-runner.md,
-- Task 1).
--
-- WHY. Every piece of background work today rides the 15-minute cron as a pass that must finish
-- inside one tick. One-off, retryable work (a single send to retry, a slow provider call) has no
-- home: a pass cannot hold it across ticks, and a failure inside a request path is simply lost. This
-- table is that home: a row per unit of work, claimed under a lease, retried with backoff computed in
-- TypeScript, and moved to dead when it runs out of attempts.
--
-- ADDITIVE ONLY. The build before this file never reads or writes the table or calls either
-- function, so production takes this file BEFORE the merge deploy (0057's order), and the build after
-- it can rely on it from its first request.
--
-- 1. public.jobs. account_id is set when the work belongs to one account and null for platform
--    work; deleting an account deletes its jobs (on delete cascade), and "jobs" is on
--    ACCOUNT_OWNED_TABLES (packages/db/src/account-teardown.ts). States: queued -> running ->
--    succeeded, or running -> retrying -> running again, or -> dead. succeeded and dead are final
--    and are the only states with a finished_at; running is the only state with a lease and a token.
--    The kind pattern uses [.] for a literal dot, never an escaped one (see the byte rule below).
--    Idempotency is per account: unique nulls not distinct (kind, account_id, idempotency_key)
--    (PostgreSQL 15+; bis-ci and production run 17), so two accounts' identical keys are two jobs and
--    a platform key (null account) still collides with itself. The payload is ids and small facts
--    only, at most 8192 bytes as jsonb text, never an address, a phone number, a token or a message
--    body: a dead job's error reaches an email, and payloads are read by hand in the runbook.
-- 2. public.claim_jobs(p_kinds, p_limit): the one thing PostgREST cannot express. First moves every
--    running row whose lease ran out on its LAST attempt to dead ("the worker stopped before
--    finishing"); then takes up to p_limit due rows of the given kinds (queued or retrying with
--    run_after <= now(), or running with a run-out lease) with FOR UPDATE SKIP LOCKED, so two
--    workers never take one row and neither waits for the other. A claim sets state running,
--    attempts + 1, a fresh claim_token, and lease_until = now() + timeout_ms + 30 s. p_limit is 1
--    to 50 (22023 otherwise). p_kinds is the drain's own handler list, so a kind enqueued by a newer
--    build is never claimed by an older one.
-- 3. public.sweep_jobs(p_limit): retention. Deletes up to p_limit rows, oldest finished first, that
--    are succeeded more than 7 days ago or dead more than 30 days ago, and nothing else. p_limit is
--    1 to 5000 (22023 otherwise). Returns how many it deleted.
--    Both functions are SECURITY INVOKER with search_path pg_catalog, pg_temp (0096's rule): only
--    service_role calls them, and it already holds the table grants (0057's reasoning). Neither has
--    a policy check inside, so the plpgsql IF NOT (...) NULL trap does not arise.
--
-- WHO WRITES WHAT. service_role only, through packages/db/src/jobs.ts: enqueue inserts, the drain
-- claims through claim_jobs, completes and fails with plain updates fenced by
-- id + claim_token + state = 'running', and sweeps through sweep_jobs. RLS on with NO policy, and no
-- grant of any kind to anon or authenticated: a client session can neither see nor write a job.
-- service_role gets SELECT, INSERT, UPDATE and DELETE (delete for the sweep and the runbook), after
-- 0054's revoke-all-then-grant-back (the default ACL hands ALL, MAINTAIN included, to all three roles
-- by name). Each function: EXECUTE revoked from public, anon, authenticated and service_role by name
-- (0043's lesson), then granted to service_role.
--
-- No backslash and no non-ASCII byte anywhere in this file (the MCP apply rule).
--
-- ROLLBACK (roll the app back first; the build after this file enqueues and drains):
--   drop function public.sweep_jobs(integer);
--   drop function public.claim_jobs(text[], integer);
--   drop table public.jobs;

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
  constraint jobs_kind_key unique nulls not distinct (kind, account_id, idempotency_key),
  constraint jobs_running_has_lease check ((state = 'running') = (lease_until is not null and claim_token is not null)),
  constraint jobs_finished_has_time check ((state in ('succeeded', 'dead')) = (finished_at is not null))
);

create index jobs_due_idx on public.jobs (run_after, id) where state in ('queued', 'retrying');
create index jobs_lease_idx on public.jobs (lease_until) where state = 'running';
create index jobs_finished_idx on public.jobs (finished_at) where state in ('succeeded', 'dead');
create index jobs_account_idx on public.jobs (account_id) where account_id is not null;

comment on table public.jobs is
  'F-196 (0102): one-off, retryable background work. One row per job: kind, the owning account (null for platform work), an idempotency key unique per (kind, account), a small payload of ids (at most 8192 bytes, never an address, phone number, token or message body), its state, when it may next run, attempts against its maximum, and the lease of the worker holding it. Claimed through public.claim_jobs, retained through public.sweep_jobs. service_role only; no grant to anon or authenticated.';

alter table public.jobs enable row level security;
-- No policy: RLS on with none refuses every row to every role that does not bypass it, and the
-- grants below refuse anon and authenticated outright.
revoke all on public.jobs from anon, authenticated, service_role;
grant select, insert, update, delete on public.jobs to service_role;

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

comment on function public.claim_jobs(text[], integer) is
  'F-196 (0102): first moves every running job whose lease ran out on its last attempt to dead (last_error: the worker stopped before finishing), then claims up to p_limit (1 to 50, else 22023) due jobs of the given kinds, oldest run_after first, with FOR UPDATE SKIP LOCKED: state running, attempts + 1, a fresh claim_token, lease_until = now() + timeout_ms + 30 s. Returns the claimed rows. Security invoker; service_role only, through packages/db/src/jobs.ts.';

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

comment on function public.sweep_jobs(integer) is
  'F-196 (0102): retention. Deletes up to p_limit (1 to 5000, else 22023) jobs, oldest finished_at first, that succeeded more than 7 days ago or died more than 30 days ago, and nothing else; returns how many. Security invoker; service_role only, called by the drain at the end of every run.';

-- Default privileges hand EXECUTE to anon, authenticated and service_role BY NAME, so revoking from
-- PUBLIC alone would leave them (0043's lesson).
revoke all on function public.claim_jobs(text[], integer) from public, anon, authenticated, service_role;
grant execute on function public.claim_jobs(text[], integer) to service_role;
revoke all on function public.sweep_jobs(integer) from public, anon, authenticated, service_role;
grant execute on function public.sweep_jobs(integer) to service_role;
