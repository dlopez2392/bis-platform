-- 0105_access_log.sql - see when BIS looked (F-118 part 1)
-- (docs/superpowers/specs/2026-10-29-access-log-design.md sections 3 to 5;
--  docs/superpowers/plans/2026-10-29-access-log.md, Task 1)
--
-- WHAT. public.agency_visits: one row each time a BIS (agency) person chooses a reason before entering an
-- account. A visit is live for app.agency_visit_window() (two hours) from its started_at, for the same Clerk
-- user, the same Clerk session and the same account; nothing extends it. public.agency_visit_items: one row
-- per record opened per visit (the first time), or per customer-list download. Ids only, never customer
-- data: the reader resolves names under its own RLS. record_id has no foreign key on purpose: the log
-- outlives the record.
-- APPEND-ONLY BY GRANTS (0054's shape). After this file no role holds UPDATE, DELETE, TRUNCATE, REFERENCES,
-- TRIGGER or MAINTAIN on either table; service_role inserts only the named columns, so started_at and
-- first_opened_at are always the database's own now(). Rows leave only with their account, through
-- on delete cascade, which runs as the table owner. Neither table is on ACCOUNT_OWNED_TABLES (consent_events'
-- reason): the teardown's per-table delete would be refused. The owner role itself is not bound by grants
-- (the trust pack says so).
-- WHO READS. authenticated, under RLS: the agency, or this account's Owner while client access is on
-- (0066's expression, each call in an InitPlan). Staff, Technicians and every other account read nothing.
-- Column SELECT on agency_visits: id, account_id, actor_kind, actor_name, reason, started_at only, so an Owner
-- never reads BIS staff's Clerk user or session ids; service_role reads every column (the gate needs them).
-- FUNCTIONS. All SECURITY INVOKER, set search_path = pg_catalog, pg_temp (0096's rule), names schema-
-- qualified; EXECUTE revoked from public, anon, authenticated and service_role by name (0043's lesson), then
-- granted: start_agency_visit, agency_visit_live, note_agency_open and app.agency_visit_window to
-- service_role; access_log_page to authenticated (RLS bounds it). No definer, so EXPECTED_DEFINERS in
-- definer-search-path.test.ts does not change.
-- LOCKS. Two new, empty tables. The foreign key to accounts takes SHARE ROW EXCLUSIVE on public.accounts for
-- the few milliseconds this file runs; lock_timeout 5s bounds the wait.
-- APPLY ORDER: CI project (ci-project-setup.yml: push-dry-run, then push), then production (MCP
-- apply_migration, once), then the parity check, then merge. Additive: the build before this file never
-- reads it; the build after it calls these functions on every agency request, so it goes BEFORE the deploy.
--
-- Rollback (by hand, in this order; revert the app first). IT DESTROYS THE LOG:
--   drop function public.access_log_page(uuid, timestamptz, uuid, integer);
--   drop function public.note_agency_open(uuid, text, text, text, uuid, integer);
--   drop function public.start_agency_visit(uuid, text, text, text, text);
--   drop function public.agency_visit_live(uuid, text, text);
--   drop function app.agency_visit_window();
--   drop table public.agency_visit_items, public.agency_visits;
--
-- ASCII only, no backslash anywhere.

do $$
begin
  perform pg_catalog.set_config('lock_timeout', '5s', true);
end $$;

create table public.agency_visits (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  actor_kind text not null default 'agency'
    constraint agency_visits_actor_kind_check check (actor_kind in ('agency')),
  actor_clerk_user_id text not null constraint agency_visits_actor_check check (btrim(actor_clerk_user_id) <> ''),
  actor_name text constraint agency_visits_actor_name_check
    check (actor_name is null or char_length(btrim(actor_name)) between 1 and 200),
  clerk_session_id text not null constraint agency_visits_session_check check (btrim(clerk_session_id) <> ''),
  reason text not null constraint agency_visits_reason_check check (reason in ('setup', 'support', 'fix', 'billing')),
  started_at timestamptz not null default now(),
  constraint agency_visits_id_account_key unique (id, account_id)
);
create index agency_visits_page on public.agency_visits (account_id, started_at desc, id desc);
create index agency_visits_live on public.agency_visits (actor_clerk_user_id, clerk_session_id, account_id, started_at desc);
comment on table public.agency_visits is
  'F-118 (0105): one row per reason a BIS person chose before entering an account. Append-only by grants.';

create table public.agency_visit_items (
  id uuid primary key default gen_random_uuid(),
  visit_id uuid not null,
  account_id uuid not null,
  kind text not null constraint agency_visit_items_kind_check check (kind in (
    'contact', 'group', 'call', 'conversation', 'document_view', 'document_download', 'document_share',
    'form_answers', 'customer_list_export')),
  record_id uuid,
  item_count integer constraint agency_visit_items_item_count_check check (item_count is null or item_count >= 0),
  first_opened_at timestamptz not null default now(),
  constraint agency_visit_items_record_check check ((kind = 'customer_list_export') = (record_id is null)),
  constraint agency_visit_items_export_count_check check ((kind = 'customer_list_export') = (item_count is not null)),
  constraint agency_visit_items_visit_fkey foreign key (visit_id, account_id)
    references public.agency_visits (id, account_id) on delete cascade
);
create unique index agency_visit_items_once on public.agency_visit_items (visit_id, kind, record_id)
  where record_id is not null;
create index agency_visit_items_visit on public.agency_visit_items (visit_id, first_opened_at desc);
comment on table public.agency_visit_items is
  'F-118 (0105): each record a visit opened (first time only) and each customer-list download. Ids only.';

alter table public.agency_visits enable row level security;
alter table public.agency_visit_items enable row level security;
create policy agency_visits_read on public.agency_visits for select to authenticated
  using ((select coalesce(app.is_agency(), false))
         or (account_id = (select app.current_account_id())
             and (select app.is_account_owner(app.current_account_id()))));
create policy agency_visit_items_read on public.agency_visit_items for select to authenticated
  using ((select coalesce(app.is_agency(), false))
         or (account_id = (select app.current_account_id())
             and (select app.is_account_owner(app.current_account_id()))));

revoke all on public.agency_visits, public.agency_visit_items from anon, authenticated, service_role;
-- An Owner reads who, why and when, never BIS staff's Clerk user or session id (review m3): column SELECT.
grant select (id, account_id, actor_kind, actor_name, reason, started_at) on public.agency_visits to authenticated;
grant select on public.agency_visit_items to authenticated;
grant select on public.agency_visits, public.agency_visit_items to service_role;
grant insert (account_id, actor_clerk_user_id, actor_name, clerk_session_id, reason)
  on public.agency_visits to service_role;
grant insert (visit_id, account_id, kind, record_id, item_count)
  on public.agency_visit_items to service_role;

create function app.agency_visit_window() returns interval
language sql immutable set search_path = pg_catalog, pg_temp as $$
  select interval '2 hours'
$$;

create function public.agency_visit_live(p_account_id uuid, p_actor text, p_session text)
returns uuid language sql stable security invoker set search_path = pg_catalog, pg_temp as $$
  select v.id from public.agency_visits v
   where v.actor_clerk_user_id = p_actor and v.clerk_session_id = p_session and v.account_id = p_account_id
     and v.started_at > pg_catalog.now() - app.agency_visit_window()
   order by v.started_at desc, v.id desc
   limit 1
$$;

create function public.start_agency_visit(
  p_account_id uuid, p_actor text, p_actor_name text, p_session text, p_reason text)
returns uuid language plpgsql security invoker set search_path = pg_catalog, pg_temp as $$
declare v_id uuid;
begin
  if p_account_id is null or p_actor is null or p_session is null or p_reason is null then
    raise exception 'start_agency_visit: a required argument is null' using errcode = '22004';
  end if;
  -- Two taps, or two tabs, make one visit.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_actor || '|' || p_session || '|' || p_account_id::text, 0));
  v_id := public.agency_visit_live(p_account_id, p_actor, p_session);
  if v_id is not null then return v_id; end if;
  insert into public.agency_visits (account_id, actor_clerk_user_id, actor_name, clerk_session_id, reason)
  values (p_account_id, p_actor, nullif(pg_catalog.btrim(p_actor_name), ''), p_session, p_reason)
  returning id into v_id;
  return v_id;
end $$;

create function public.note_agency_open(
  p_account_id uuid, p_actor text, p_session text, p_kind text, p_record_id uuid, p_item_count integer)
returns text language plpgsql security invoker set search_path = pg_catalog, pg_temp as $$
declare v_visit uuid;
begin
  if p_account_id is null or p_actor is null or p_session is null or p_kind is null then
    raise exception 'note_agency_open: a required argument is null' using errcode = '22004';
  end if;
  -- The live visit for THIS person, session and account: a caller can never name another visit.
  v_visit := public.agency_visit_live(p_account_id, p_actor, p_session);
  if v_visit is null then return 'no_visit'; end if;
  if p_kind = 'customer_list_export' then
    insert into public.agency_visit_items (visit_id, account_id, kind, record_id, item_count)
    values (v_visit, p_account_id, p_kind, null, p_item_count);
  else
    insert into public.agency_visit_items (visit_id, account_id, kind, record_id, item_count)
    values (v_visit, p_account_id, p_kind, p_record_id, null)
    on conflict (visit_id, kind, record_id) where record_id is not null do nothing;
  end if;
  return 'ok';
end $$;

create function public.access_log_page(
  p_account_id uuid, p_before_started timestamptz, p_before_id uuid, p_limit integer)
returns jsonb language plpgsql stable security invoker set search_path = pg_catalog, pg_temp as $$
declare v_total bigint; v_visits jsonb;
begin
  if p_account_id is null or p_limit is null then
    raise exception 'access_log_page: a required argument is null' using errcode = '22004';
  end if;
  if p_limit < 1 or p_limit > 50 then
    raise exception 'access_log_page: p_limit must be 1 to 50' using errcode = '22023';
  end if;
  if (p_before_started is null) <> (p_before_id is null) then
    raise exception 'access_log_page: a cursor needs both halves' using errcode = '22023';
  end if;
  select count(*) into v_total from public.agency_visits v where v.account_id = p_account_id;
  select coalesce(jsonb_agg(pg.visit order by pg.started_at desc, pg.id desc), '[]'::jsonb) into v_visits
  from (
    select v.id, v.started_at, jsonb_build_object(
      'id', v.id, 'actor_name', v.actor_name, 'reason', v.reason, 'started_at', v.started_at,
      'ended_at', (select max(i.first_opened_at) from public.agency_visit_items i where i.visit_id = v.id),
      'counts', (select jsonb_build_object(
          'contact', count(*) filter (where i.kind = 'contact'),
          'group', count(*) filter (where i.kind = 'group'),
          'call', count(*) filter (where i.kind = 'call'),
          'conversation', count(*) filter (where i.kind = 'conversation'),
          'file', count(distinct i.record_id) filter (where i.kind in ('document_view', 'document_download', 'document_share')),
          'form_answers', count(*) filter (where i.kind = 'form_answers'),
          'customer_list_export', count(*) filter (where i.kind = 'customer_list_export'))
        from public.agency_visit_items i where i.visit_id = v.id),
      'item_total', (select count(*) from public.agency_visit_items i where i.visit_id = v.id),
      'items', (select coalesce(jsonb_agg(jsonb_build_object(
            'kind', x.kind, 'record_id', x.record_id, 'item_count', x.item_count, 'first_opened_at', x.first_opened_at)
            order by x.first_opened_at desc, x.id desc), '[]'::jsonb)
        from (select i.id, i.kind, i.record_id, i.item_count, i.first_opened_at
                from public.agency_visit_items i where i.visit_id = v.id
               order by i.first_opened_at desc, i.id desc limit 100) x)
    ) as visit
    from public.agency_visits v
    where v.account_id = p_account_id
      and (p_before_started is null or (v.started_at, v.id) < (p_before_started, p_before_id))
    order by v.started_at desc, v.id desc
    limit p_limit + 1
  ) pg;
  return jsonb_build_object('total', v_total, 'visits', v_visits);
end $$;

revoke all on function app.agency_visit_window() from public, anon, authenticated, service_role;
revoke all on function public.agency_visit_live(uuid, text, text) from public, anon, authenticated, service_role;
revoke all on function public.start_agency_visit(uuid, text, text, text, text) from public, anon, authenticated, service_role;
revoke all on function public.note_agency_open(uuid, text, text, text, uuid, integer) from public, anon, authenticated, service_role;
revoke all on function public.access_log_page(uuid, timestamptz, uuid, integer) from public, anon, authenticated, service_role;
grant execute on function app.agency_visit_window() to service_role;
grant execute on function public.agency_visit_live(uuid, text, text) to service_role;
grant execute on function public.start_agency_visit(uuid, text, text, text, text) to service_role;
grant execute on function public.note_agency_open(uuid, text, text, text, uuid, integer) to service_role;
grant execute on function public.access_log_page(uuid, timestamptz, uuid, integer) to authenticated;
