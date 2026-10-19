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
