-- Append-only: once this migration has reached bis-ci it is never edited. A fix is a new migration
-- (pnpm --filter @bis/db migration:new <slug>). docs/runbooks/ci-supabase-project.md, section 6.
--
-- ai_apps: ask your business from your own AI app, the read-only MCP server's switch and access log (focus row 13,
-- PR A of docs/superpowers/plans/2026-11-19-mcp-server.md, sections 2 D1, D2, D4, 3.4 and 3.5). Inert: no account
-- has the switch on, and nothing calls note_ai_app_read until the /api/mcp route (plan PR B) ships.
--
-- WHAT.
--   public.accounts.ai_apps_enabled_at: the business's switch; null = off, the default for every account (D2).
--     ai_apps_changed_at and ai_apps_changed_by: WHEN it last moved and WHICH Owner moved it (users.id). Unlike the
--     owner line (0115 stores a who-KIND, never a person, because BIS staff may set that switch and every member
--     reads accounts), only the business's own Owner ever moves this one (D2: not Staff, not the agency), so the
--     stored person is always one of the business's Owners, whom every member already sees on the Team page.
--     ai_apps_changed_by is a foreign key to users ON DELETE SET NULL (20261115190749's connected_by is the
--     precedent): a deleted person leaves the switch as it was and the record without a name, and never blocks the
--     delete. It has no index: accounts holds tens of rows, so a users delete's scan of it is that many rows.
--   app.ai_apps_insert_guard (copied from 0115's app.owner_line_insert_guard): no account is born with any of the
--     three set, by any role. authenticated holds a TABLE-level INSERT on accounts (schema-grants-guard.test.ts
--     EXPECTED_WRITES), so a column grant cannot express it; without the trigger the agency's createAccount path
--     could create a business with AI apps already on, against D2.
--   app.ai_apps_switch_record_guard (copied from 0115's app.owner_line_switch_record_guard): an UPDATE that moves
--     ai_apps_enabled_at must move ai_apps_changed_at to a new, non-null value AND name ai_apps_changed_by, and that
--     person must hold an account-scope OWNER membership of this account (D2 in the database, as 0115 put owner
--     ruling Q-A in accounts_owner_line_agency_off_check). Staff, a Technician, another business's Owner and an
--     agency person are refused. A write that does not move the switch is not touched (the WHEN clause).
--     accounts_ai_apps_on_has_record_check (0115's review m-B): an ON switch always has its time. The who may go
--     null later (the set-null above), so it is not in the CHECK; the trigger is what requires it on every move.
--   The access log learns ai_app_read (plan D4): agency_visits.actor_kind gains 'ai_app', reason gains
--     'ai_app_read', and agency_visits_ai_app_check makes the two travel together (0115's owner-line pairing,
--     copied). agency_visit_items.kind gains the five ai_app_ kinds. Every list is 0115 section 3's text plus these.
--     access_log_page already reads actor_kind = 'agency' only (0115), so the Team page's BIS access section never
--     shows these rows and is not changed here. The Owner reads them on the AI apps card (plan 3.6) through RLS
--     (0105: the agency, or this account's Owner).
--   agency_visit_live (0105) gains v.actor_kind = 'agency', as 0115's header requires of "anything that ever writes
--     another session shape into agency_visits": an AI-app visit's session is 'ai_app:<request id>'.
--   note_agency_open (0115's text) refuses ai_app_ kinds too (22023), for 0115 review m-3's reason: parseVisit
--     (packages/db/src/access-log.ts) accepts only ACCESS_LOG_KINDS, so one such item on an agency visit would make
--     the Team page's BIS access section throw. AI-app items come only from note_ai_app_read.
--   public.note_ai_app_read(account, actor Clerk user id, actor name, kind, request id): one visit and one item per
--     tool call. It re-checks, inside, everything the route checked, and FAILS CLOSED with a raise, writing nothing:
--       'note_ai_app_read: not_allowed' (P0001) unless the actor (users.clerk_user_id) holds an account-scope
--         membership of THIS account with role owner or staff (D1: never a Technician, never an agency-scope
--         membership, which carries no account_id), AND the account has client_access_enabled, is not archived, and
--         has ai_apps_enabled_at set (D2: off stops the next read at once). Every boolean is coalesced to a refusal
--         (the plpgsql NULL-guard lesson): a missing account or membership reads as no.
--       'note_ai_app_read: rate_limited' (P0001) when this person already has 60 ai_app visits started in the last
--         10 minutes, or 500 in the last 24 hours, across EVERY account (plan 3.5), counted from agency_visits
--         itself (no new table) through agency_visits_ai_app_rate. Owner-line and agency visits never count.
--     THE KEY. The owner line keys its visit on the call (record_id = calls.id, clerk_session_id 'call:<id>'); an
--     AI-app read has no record. agency_visits.clerk_session_id is NOT NULL and non-blank (0105
--     agency_visits_session_check): it holds 'ai_app:<p_request_id>', which never meets a Clerk session id
--     ('sess_...') or an owner-line one ('call:...'). agency_visit_items.record_id must be non-null for every kind
--     but customer_list_export (0105 agency_visit_items_record_check) and item_count must be null (0105
--     agency_visit_items_export_count_check): record_id holds p_request_id, the uuid the route makes per request, so
--     the item names the same request its visit does, the once-index (visit_id, kind, record_id) holds trivially
--     (one item per visit), and no record check moves. It is NOT a record id; the AI apps card reads only kind and
--     time, and the Team page never sees these rows.
--     THE RACE. The count and the insert run under pg_advisory_xact_lock(hashtextextended('ai_app_read|' || actor)),
--     taken before anything is read, so one person's reads run one at a time to commit: under READ COMMITTED each
--     statement after the lock takes a fresh snapshot and sees the previous holder's committed visit. Two reads
--     racing at the 59th row cannot both pass (ai-apps-concurrency.test.ts). Different people never wait on each other
--     beyond a hash collision.
-- FUNCTIONS. All SECURITY INVOKER with set search_path = pg_catalog, pg_temp (0096's rule). note_ai_app_read,
--   agency_visit_live and note_agency_open: EXECUTE revoked from public, anon, authenticated and service_role by name
--   (0043's lesson), then granted to service_role only (agency_visit_live's and note_agency_open's 0105 grants
--   restated). The two trigger functions are executable by no role (a trigger's function is checked for EXECUTE only
--   when the trigger is created). Only service_role runs them and it already holds what they touch, so a definer would
--   add privilege and nothing else (0115's and 0104's reasoning). EXPECTED_DEFINERS does not change.
-- GRANTS. The three accounts columns get no column grant: authenticated holds table-level SELECT on accounts (a
--   member reads them under the existing row policies) and no UPDATE on any of them (0013 revoked UPDATE and grants
--   it back per column); service_role writes them. No table grant moves, so EXPECTED_WRITES is unchanged.
--   service_role already inserts agency_visits.actor_kind (0115).
-- LOCKS. Four tables, taken up front inside a do block with lock_timeout 5s; the second do block raises
--   ai_apps_not_one_transaction unless the rest of the file runs in that same transaction (0115 section 0, 0088's
--   self-check). CHILDREN FIRST, accounts LAST (0115's reason: a live writer takes its child table first and its
--   parent second in one statement; note_agency_open holds agency_visit_items, then needs agency_visits; a visit
--   insert holds agency_visits, then needs accounts):
--     agency_visit_items, agency_visits (ACCESS EXCLUSIVE: constraint swaps, the index), then users (SHARE ROW
--     EXCLUSIVE: the new foreign key), then accounts (ACCESS EXCLUSIVE: new columns, the CHECK and two triggers).
--   users before accounts: a users delete holds users and, after this file, sets accounts.ai_apps_changed_by null.
--   Residual risk, named: a transaction that holds accounts and then writes users, in the milliseconds between this
--   file's users lock and its accounts lock, deadlocks with it (40P01). If the file is the victim it applies nothing
--   and is re-run. Account deletion (accounts first, then its children) can deadlock the same way (0115 review m-4):
--   apply outside business hours, and not during an account deletion.
--   An added column with no default and no NOT NULL is a catalog change only: no table rewrite. The new CHECKs and
--   the foreign key are added valid, so each scans its table once under the lock already held.
-- APPLY ORDER. bis-ci (CI, once the PR is ready), then production (CI, after danlo's approval), then the parity
--   check. Additive: the running build names none of these objects; every new CHECK accepts every existing row
--   (the old lists are subsets) and the re-created functions keep their signatures.
--
-- Rollback (by hand, in this order; revert the app first). It destroys every AI-app access-log entry:
--   drop function public.note_ai_app_read(uuid, text, text, text, uuid);
--   re-run 0115's note_agency_open (its section 3) as create or replace, with its revoke and grant lines;
--   re-run 0105's agency_visit_live as create or replace, with its revoke and grant lines;
--   drop index public.agency_visits_ai_app_rate;
--   by OWNER DECISION ONLY (it deletes access-log rows): delete from public.agency_visits where actor_kind = 'ai_app';
--   alter table public.agency_visits drop constraint agency_visits_ai_app_check;
--   restore 0115's agency_visit_items_kind_check, agency_visits_actor_kind_check and agency_visits_reason_check;
--   drop trigger accounts_ai_apps_switch_record on public.accounts; drop function app.ai_apps_switch_record_guard();
--   drop trigger accounts_ai_apps_insert_guard on public.accounts; drop function app.ai_apps_insert_guard();
--   alter table public.accounts drop constraint accounts_ai_apps_on_has_record_check,
--     drop column ai_apps_changed_by, drop column ai_apps_changed_at, drop column ai_apps_enabled_at;
--
-- ASCII only, no backslash anywhere, and every dollar sign in this file is part of a dollar-quote pair.

-- 0. One transaction, holding the locks, or nothing at all (0115 section 0).
do $$
begin
  perform pg_catalog.set_config('lock_timeout', '5s', true);
  perform pg_catalog.set_config('bis.m_ai_apps_xid', pg_catalog.txid_current()::text, true);
  -- Children first, accounts last (LOCKS). One statement per table, so the order is the order written.
  lock table public.agency_visit_items in access exclusive mode;
  lock table public.agency_visits in access exclusive mode;
  lock table public.users in share row exclusive mode;
  lock table public.accounts in access exclusive mode;
end $$;
do $$
begin
  if pg_catalog.current_setting('bis.m_ai_apps_xid', true) is distinct from pg_catalog.txid_current()::text
     or pg_catalog.current_setting('lock_timeout') <> '5s'
     or (select count(*) from pg_catalog.pg_locks l
          where l.pid = pg_catalog.pg_backend_pid() and l.granted and l.locktype = 'relation'
            and ((l.relation in ('public.accounts'::regclass, 'public.agency_visits'::regclass,
                                 'public.agency_visit_items'::regclass)
                  and l.mode = 'AccessExclusiveLock')
              or (l.relation = 'public.users'::regclass and l.mode = 'ShareRowExclusiveLock'))) <> 4 then
    raise exception 'ai_apps_not_one_transaction' using errcode = 'P0001';
  end if;
end $$;

-- 1. The switch and its record: when, and which Owner (D2).
alter table public.accounts
  add column ai_apps_enabled_at timestamptz,
  add column ai_apps_changed_at timestamptz,
  add column ai_apps_changed_by uuid
    constraint accounts_ai_apps_changed_by_fkey references public.users (id) on delete set null,
  add constraint accounts_ai_apps_on_has_record_check
    check (ai_apps_enabled_at is null or ai_apps_changed_at is not null);
comment on column public.accounts.ai_apps_enabled_at is
  'MCP (ai_apps): when the business''s Owner let Owners and Staff ask about the business from their own AI app; null = off (the default). Only the business''s Owner turns it on or off (D2).';
comment on column public.accounts.ai_apps_changed_by is
  'MCP (ai_apps): the Owner (users.id) who last turned AI apps on or off; null once that person is deleted.';

create function app.ai_apps_insert_guard() returns trigger
language plpgsql security invoker set search_path = pg_catalog, pg_temp as $$
begin
  if new.ai_apps_enabled_at is not null or new.ai_apps_changed_at is not null
     or new.ai_apps_changed_by is not null then
    raise exception 'accounts: AI apps start off; only the business''s Owner turns them on' using errcode = '23514';
  end if;
  return new;
end $$;
revoke all on function app.ai_apps_insert_guard() from public, anon, authenticated, service_role;
create trigger accounts_ai_apps_insert_guard before insert on public.accounts
  for each row execute function app.ai_apps_insert_guard();

create function app.ai_apps_switch_record_guard() returns trigger
language plpgsql security invoker set search_path = pg_catalog, pg_temp as $$
begin
  if new.ai_apps_changed_at is null
     or new.ai_apps_changed_at is not distinct from old.ai_apps_changed_at
     or new.ai_apps_changed_by is null then
    raise exception 'accounts: turning AI apps on or off must record when and who' using errcode = '23514';
  end if;
  if not exists (select 1 from public.memberships m
                  where m.scope = 'account' and m.account_id = new.id and m.user_id = new.ai_apps_changed_by
                    and m.role = 'owner') then
    raise exception 'accounts: only the business''s Owner turns AI apps on or off' using errcode = '23514';
  end if;
  return new;
end $$;
revoke all on function app.ai_apps_switch_record_guard() from public, anon, authenticated, service_role;
create trigger accounts_ai_apps_switch_record before update on public.accounts
  for each row when (old.ai_apps_enabled_at is distinct from new.ai_apps_enabled_at)
  execute function app.ai_apps_switch_record_guard();

-- 2. The access log learns ai_app_read (D4). Each list is 0115 section 3's, plus the new values.
alter table public.agency_visits drop constraint agency_visits_actor_kind_check;
alter table public.agency_visits add constraint agency_visits_actor_kind_check
  check (actor_kind in ('agency', 'owner_line', 'ai_app'));
alter table public.agency_visits drop constraint agency_visits_reason_check;
alter table public.agency_visits add constraint agency_visits_reason_check
  check (reason in ('setup', 'support', 'fix', 'billing', 'owner_line_call', 'ai_app_read'));
alter table public.agency_visits add constraint agency_visits_ai_app_check
  check ((actor_kind = 'ai_app') = (reason = 'ai_app_read'));
alter table public.agency_visit_items drop constraint agency_visit_items_kind_check;
alter table public.agency_visit_items add constraint agency_visit_items_kind_check check (kind in (
  'contact', 'group', 'call', 'conversation', 'document_view', 'document_download', 'document_share',
  'form_answers', 'customer_list_export', 'record_history_export',
  'owner_line_calls_and_messages', 'owner_line_appointments', 'owner_line_needs_attention', 'owner_line_lookup_customer',
  'ai_app_calls_and_messages', 'ai_app_appointments', 'ai_app_needs_attention', 'ai_app_lookup_customer',
  'ai_app_my_businesses'));
-- The limits' count: one person's AI-app visits, newest first. Partial, so agency and owner-line visits add nothing.
create index agency_visits_ai_app_rate on public.agency_visits (actor_clerk_user_id, started_at desc)
  where actor_kind = 'ai_app';

-- agency_visit_live: 0105's text with one filter, actor_kind = 'agency' (0115's header rule for a new session shape).
create or replace function public.agency_visit_live(p_account_id uuid, p_actor text, p_session text)
returns uuid language sql stable security invoker set search_path = pg_catalog, pg_temp as $$
  select v.id from public.agency_visits v
   where v.actor_clerk_user_id = p_actor and v.clerk_session_id = p_session and v.account_id = p_account_id
     and v.actor_kind = 'agency'
     and v.started_at > pg_catalog.now() - app.agency_visit_window()
   order by v.started_at desc, v.id desc
   limit 1
$$;
revoke all on function public.agency_visit_live(uuid, text, text) from public, anon, authenticated, service_role;
grant execute on function public.agency_visit_live(uuid, text, text) to service_role;

-- note_agency_open: 0115's text with one more guard. An ai_app_ kind is note_ai_app_read's alone; on an agency visit
-- it would blank the BIS access section (parseVisit).
create or replace function public.note_agency_open(
  p_account_id uuid, p_actor text, p_session text, p_kind text, p_record_id uuid, p_item_count integer)
returns text language plpgsql security invoker set search_path = pg_catalog, pg_temp as $$
declare v_visit uuid;
begin
  if p_account_id is null or p_actor is null or p_session is null or p_kind is null then
    raise exception 'note_agency_open: a required argument is null' using errcode = '22004';
  end if;
  if left(p_kind, 11) = 'owner_line_' then
    raise exception 'note_agency_open: owner_line_ kinds belong to note_owner_line_call' using errcode = '22023';
  end if;
  if left(p_kind, 7) = 'ai_app_' then
    raise exception 'note_agency_open: ai_app_ kinds belong to note_ai_app_read' using errcode = '22023';
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
revoke all on function public.note_agency_open(uuid, text, text, text, uuid, integer) from public, anon, authenticated, service_role;
grant execute on function public.note_agency_open(uuid, text, text, text, uuid, integer) to service_role;

-- 3. One AI-app read: re-check who and the switch, then the limits, then one visit and one item. Fails closed.
create function public.note_ai_app_read(
  p_account_id uuid, p_actor text, p_actor_name text, p_kind text, p_request_id uuid)
returns uuid language plpgsql security invoker set search_path = pg_catalog, pg_temp as $$
declare v_role text; v_open boolean; v_ten bigint; v_day bigint; v_visit uuid;
begin
  if p_account_id is null or p_actor is null or p_kind is null or p_request_id is null then
    raise exception 'note_ai_app_read: a required argument is null' using errcode = '22004';
  end if;
  if left(p_kind, 7) <> 'ai_app_' then
    raise exception 'note_ai_app_read: only ai_app_ kinds' using errcode = '22023';
  end if;
  -- One person's reads one at a time, to commit (THE RACE in the header): the count below sees every earlier read.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('ai_app_read|' || p_actor, 0));
  select m.role into v_role
    from public.memberships m join public.users u on u.id = m.user_id
   where u.clerk_user_id = p_actor and m.scope = 'account' and m.account_id = p_account_id;
  select coalesce(a.client_access_enabled, false) and a.status <> 'archived' and a.ai_apps_enabled_at is not null
    into v_open from public.accounts a where a.id = p_account_id;
  if not (coalesce(v_role in ('owner', 'staff'), false) and coalesce(v_open, false)) then
    raise exception 'note_ai_app_read: not_allowed' using errcode = 'P0001';
  end if;
  select count(*) filter (where v.started_at > pg_catalog.now() - interval '10 minutes'), count(*)
    into v_ten, v_day
    from public.agency_visits v
   where v.actor_kind = 'ai_app' and v.actor_clerk_user_id = p_actor
     and v.started_at > pg_catalog.now() - interval '24 hours';
  if coalesce(v_ten >= 60 or v_day >= 500, true) then
    raise exception 'note_ai_app_read: rate_limited' using errcode = 'P0001';
  end if;
  insert into public.agency_visits (account_id, actor_kind, actor_clerk_user_id, actor_name, clerk_session_id, reason)
  values (p_account_id, 'ai_app', p_actor, nullif(pg_catalog.btrim(p_actor_name), ''), 'ai_app:' || p_request_id::text,
          'ai_app_read')
  returning id into v_visit;
  insert into public.agency_visit_items (visit_id, account_id, kind, record_id, item_count)
  values (v_visit, p_account_id, p_kind, p_request_id, null);
  return v_visit;
end $$;
revoke all on function public.note_ai_app_read(uuid, text, text, text, uuid) from public, anon, authenticated, service_role;
grant execute on function public.note_ai_app_read(uuid, text, text, text, uuid) to service_role;
