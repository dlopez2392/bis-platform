-- A proposal is a QUESTION about work, never work itself.
--
-- WHY THIS IS NOT A `tasks` ROW WITH A `proposed` STATUS. `bucketWork`
-- (lib/work/buckets.ts), the account dashboard's work row, and
-- `listAgencyWork` all read `tasks` without knowing about any status
-- column. Adding a state there means teaching EVERY existing reader to
-- exclude it, and the failure mode of missing one is that a machine's
-- guess renders as a real task a human believes. That is the exact defect
-- this feature exists to avoid producing. A separate table touches none of
-- them. Same reasoning as 0039_screened_calls.sql's refusal to be a
-- `calls` row.
create table public.call_proposals (
  id uuid primary key default gen_random_uuid(),
  -- Unlike screened_calls, every proposal HAS an account: it came from a
  -- call that reached one. Cascade, not restrict, so the account's own
  -- deletion carries these away (see account-teardown.ts's doc-block).
  account_id uuid not null references public.accounts(id) on delete cascade,
  -- The evidence. A proposal with no call is not reviewable, so losing the
  -- call must lose the proposal.
  call_id uuid not null references public.calls(id) on delete cascade,
  contact_id uuid references public.contacts(id) on delete cascade,
  kind text not null,
  payload jsonb not null,
  -- NOT NULL and non-empty: the generator does not get to assert, it has
  -- to point. A proposal whose evidence is absent from the stored
  -- transcript is dropped at write time (lib/proposals/grounding.ts).
  evidence text not null,
  status text not null default 'pending',
  decided_at timestamptz,
  -- A Clerk user id, deliberately NOT an FK: `users` is empty and
  -- assignment is dead throughout this codebase. A breadcrumb, not a
  -- relation.
  decided_by text,
  created_at timestamptz not null default now(),
  constraint call_proposals_kind_check check (kind in (
    'task', 'contact_field', 'opportunity_stage'
  )),
  constraint call_proposals_status_check check (status in (
    'pending', 'accepted', 'dismissed'
  )),
  constraint call_proposals_evidence_nonempty check (length(btrim(evidence)) > 0)
);

comment on table public.call_proposals is
  'Machine-suggested next steps from a finished call. Never work itself: nothing here reaches the CRM without a human accept.';

-- COALESCE IS LOAD-BEARING, NOT DEFENSIVE. `contact_id` is nullable and
-- Postgres treats NULLs as distinct in a unique index, so the bare
-- three-column form would constrain nothing for `task` proposals — which
-- are exactly the ones with no contact. Precedent: memberships_unique
-- (0001_tenancy.sql:54-55).
create unique index call_proposals_one_pending_unique
  on public.call_proposals (
    call_id, kind, coalesce(contact_id, '00000000-0000-0000-0000-000000000000'::uuid)
  )
  where status = 'pending';

-- The call detail page's read.
create index call_proposals_call_idx
  on public.call_proposals (call_id, created_at desc);
-- The work queue's read: pending only, newest first, per account.
create index call_proposals_account_pending_idx
  on public.call_proposals (account_id, created_at desc)
  where status = 'pending';

alter table public.call_proposals enable row level security;

-- Mirrors notes_member_all / contact_duplicate_flags_member_all exactly:
-- same account-scoping predicate, same `for all to authenticated`. Both
-- audiences review proposals, so this is NOT a service-role-only table
-- like screened_calls.
create policy call_proposals_member_all on public.call_proposals
  for all to authenticated
  using (app.is_agency() or account_id = app.current_account_id())
  with check (app.is_agency() or account_id = app.current_account_id());

-- ⚠️ THE GRANTS ARE THE SECURITY BOUNDARY HERE, NOT THE POLICY.
-- This project's default ACL auto-grants ALL privileges to `anon` AND
-- `authenticated` on every new table (verified live in pg_default_acl;
-- config.toml's auto_expose_new_tables block describes the LOCAL CLI and
-- is false here). 0020_voice_grants_revoke.sql exists because of exactly
-- this, and 0033 shipped without a grant block and still carries
-- INSERT/UPDATE/DELETE to `anon` today. So: revoke everything, then grant
-- back only what a reviewer needs.
revoke all on public.call_proposals from anon, authenticated;
grant select on public.call_proposals to authenticated;
-- COLUMN-LEVEL update (0016_booking.sql:84-88's shape): a reviewer answers
-- a proposal, they do not get to rewrite what was proposed. Without the
-- column list, a client could edit `payload` and then accept their own
-- edit through the trusted write path.
grant update (status, decided_at, decided_by) on public.call_proposals to authenticated;
-- INSERT belongs to the generator alone. A client that could insert could
-- manufacture a proposal and accept it, laundering an arbitrary write
-- through the accept path's trusted call to addTask/fillContactBlanks.
grant select, insert, update, delete on public.call_proposals to service_role;
