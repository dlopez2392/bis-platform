-- Append-only: once this migration has reached bis-ci it is never edited. A fix is a new migration
-- (pnpm --filter @bis/db migration:new <slug>). docs/runbooks/ci-supabase-project.md, section 6.
--
-- owner_brief_subscriptions: who opted in to the daily owner brief, per person per business (focus row 14, PR 1).
-- docs/superpowers/plans/2026-11-15-daily-owner-brief.md, D1 (who receives), D2 (this table) and D4 (the claim).
--
-- WHAT. One row per (business, person) who turned the 7 AM email on in their own Preferences. Row present = on;
-- turning it off deletes the row. The three per-day columns are the pass's idempotency stamp, kept next to the
-- opt-in they guard: last_handled_day is the ACCOUNT-local day last decided (sent or quiet) or held by a claim in
-- flight, last_sent_day the day one actually went out (Preferences shows it as "Last one"), last_outcome which of
-- the two the last decided day was. The claim is ONE conditional UPDATE in packages/db/src/owner-brief.ts, so no
-- function is added.
--
-- CHECKS. last_outcome is 'sent' or 'quiet'. last_sent_day is never after last_handled_day (a sent day is a handled
-- day; a release only ever moves the handled day back to an earlier HANDLED day, never past a sent one), and never
-- set while last_handled_day is null.
--
-- FOREIGN KEYS. All three cascade: a person deleted, a business deleted, or a person removed from that business's
-- team takes the subscription with them. The composite key to memberships (0066's memberships_account_user_key,
-- 0115's owner_line_enrollments shape) is what lets the due-list read the person's CURRENT role in the same
-- statement (DAILY_BRIEF_ROLES, D1), and it refuses a subscription for someone not on that team. A role change
-- keeps the row; the send-time role filter decides. Not restrict (0017): a subscription is not a lead.
-- The unique pair is (account_id, user_id), the composite key's order, so it serves the membership cascade and an
-- account delete; a person's own read is by user_id over a table of at most one row per opted-in member.
--
-- WHO READS AND WRITES. Server code only (0104's and 0115's pattern, D2): RLS on with no policy, every client
-- privilege revoked, service_role alone holds the table. Its UPDATE is column-level, the three per-day columns
-- only, so no server write can move a subscription to another person or business, or reset when it was enabled.
--
-- GRANTS. The default ACL hands ALL (MAINTAIN included) on a new table to anon, authenticated and service_role by
-- name, so the table's privileges are revoked from all three and PUBLIC, then service_role gets back SELECT,
-- INSERT, DELETE and UPDATE on the three per-day columns (0054's revoke-all-then-grant-back).
--
-- LOCKS AND COST. A new, empty table. Its foreign keys take SHARE ROW EXCLUSIVE on public.accounts, public.users
-- and public.memberships for the rest of the transaction, which blocks writes to them for the few milliseconds
-- this file runs; lock_timeout 5s bounds the wait to take them.
--
-- APPLY ORDER. bis-ci (CI, once the PR is ready), then production (CI, after danlo's approval), then the parity
-- check. Additive: nothing reads the table before the code that does, which ships inert (no row can exist until
-- the Preferences card, plan PR 4).
--
-- Rollback (by hand, app reverted first):
--   drop table public.owner_brief_subscriptions;
--
-- ASCII only, no backslash anywhere.

-- Fail fast instead of queueing behind a lock (0104's form: inside a do block, so it is always in the
-- block's transaction).
do $$
begin
  perform pg_catalog.set_config('lock_timeout', '5s', true);
end $$;

create table public.owner_brief_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null
    constraint owner_brief_subscriptions_user_id_fkey references public.users (id) on delete cascade,
  account_id uuid not null
    constraint owner_brief_subscriptions_account_id_fkey references public.accounts (id) on delete cascade,
  enabled_at timestamptz not null default now(),
  last_handled_day date,
  last_sent_day date,
  last_outcome text
    constraint owner_brief_subscriptions_last_outcome_check check (last_outcome in ('sent', 'quiet')),
  created_at timestamptz not null default now(),
  constraint owner_brief_subscriptions_one_per_member unique (account_id, user_id),
  constraint owner_brief_subscriptions_member_fkey foreign key (account_id, user_id)
    references public.memberships (account_id, user_id) on delete cascade,
  constraint owner_brief_subscriptions_sent_day_check
    check (last_sent_day is null or (last_handled_day is not null and last_sent_day <= last_handled_day))
);
comment on table public.owner_brief_subscriptions is
  'The daily owner brief: one row per person per business who turned it on (row present = on), and the '
  'account-local day it last handled and last sent. Server-written and server-read only.';

alter table public.owner_brief_subscriptions enable row level security;
-- No policy: RLS on with none refuses every row to every role that does not bypass it, and the grants below
-- refuse anon and authenticated outright.
revoke all on public.owner_brief_subscriptions from public, anon, authenticated, service_role;
grant select, insert, delete on public.owner_brief_subscriptions to service_role;
grant update (last_handled_day, last_sent_day, last_outcome) on public.owner_brief_subscriptions to service_role;
