-- 0115_owner_line.sql - the owner line (F-032 PR 1)
-- (docs/superpowers/specs/2026-11-09-owner-line-design.md sections 3.4, 4 and 6;
--  docs/superpowers/plans/2026-11-09-owner-line.md, Task 1, spec corrections SC-3 to SC-9 and SC-13)
--
-- DRAFT (2026-11-09). Written and replica-tested against 0112 plus 0114 (read from feat/f077-work-queue with git
-- show), because 0113 (F-115 PR D) does not exist yet. RE-READ AFTER 0113 IS MERGED (plan O-2, Task 1 Step 1), and
-- delete this paragraph when the file is final:
--   a. section 3's agency_visit_items_kind_check list: copied from 0112 section 6. If 0113 replaces it, copy 0113's.
--   b. section 3's agency_visits_actor_kind_check and agency_visits_reason_check: copied from 0105. Same rule.
--   c. section 3's access_log_page: 0112 section 6's text plus the two actor_kind filters. If 0113 replaces the
--      function, re-copy 0113's body and re-add the two filters.
--   d. section 3's grant insert (actor_kind) on agency_visits: if 0113 changes agency_visits' column grants, the
--      eleven-column pin in access-log-schema.test.ts moves with it.
--   e. section 0's lock order: if 0113 locks any of agency_visit_items, calls, agency_visits, memberships or
--      accounts, keep this file's children-first order consistent with it.
--   f. the number: if the highest migration is not 0114, renumber to the next free one.
--   g. section 3's note_agency_open: 0105's text plus the owner_line_ guard (0112 left it unchanged). If 0113
--      replaces it, re-copy 0113's body and re-add the guard.
--
-- WHAT.
--   public.owner_line_enrollments: one row per (account, person) who calls in to hear the day. The cell (e164) is
--     unique per account, so one cell is one person per business. A pending call-in code (verify_*, sha256 hex the
--     APP computes), the PIN as an scrypt string the APP computes (pin_hash; SQL only compares, 0036's split), the
--     wrong-PIN counter and the lock. The composite FK to memberships cascades: a person removed from the team, a
--     deleted user and a deleted account take the row with them.
--   public.accounts.owner_line_enabled_at: the business's switch; null = off, the default. owner_line_changed_at and
--     owner_line_changed_by_kind ('owner' or 'agency'): WHEN it last changed and WHAT KIND of person changed it, never
--     WHO. Owner ruling 2026-11-09, "Say BIS, keep names private": every member reads accounts (authenticated holds
--     table-level SELECT), so no person's id is stored here; the card says "Turned on by the Owner" or "Turned off by
--     BIS". Which BIS person did it is BIS's own record, written by the app outside this table (plan Task 5).
--     Both set together or neither (accounts_owner_line_change_check). Owner ruling Q-A in the database: the agency
--     may turn it OFF, never ON, so a row whose last change was BIS's is off (accounts_owner_line_agency_off_check).
--     No account is born with any of the three set: a trigger refuses each on INSERT, for every role. And the switch
--     never moves without its record (review m-2): a second trigger refuses any UPDATE that changes
--     owner_line_enabled_at unless owner_line_changed_at changes with it to a non-null value (the pair CHECK then
--     needs the who-kind). A writer that forgets the record, or leaves a stale one, is refused.
--   public.calls.owner_line_user_id: the person an owner-line call was for; null on every customer call. No foreign
--     key on purpose: the mark must outlive a deleted user, or the call would start counting as a customer's.
--   app.owner_line_day_start(zone, instant): the first instant of the instant's local date in that zone (owner
--     ruling Q-F: "per day" is the ACCOUNT's day). The 10-a-day limit counts from it.
--   The access log learns the owner_line_call entry (SC-13): agency_visits.actor_kind gains 'owner_line', reason gains
--     'owner_line_call' (the two travel together), agency_visit_items.kind gains one kind per owner-line tool, and
--     service_role may insert actor_kind. access_log_page reads actor_kind = 'agency' only, so the Team page's BIS
--     access section is unchanged (its parser, parseVisit in packages/db/src/access-log.ts, refuses any reason
--     outside setup, support, fix and billing, so an unfiltered page would break that section outright).
--     agency_visit_live (0105) is NOT changed and does not filter on actor_kind. It finds a visit by actor, account
--     AND clerk_session_id, and it stays agency-only because the two session shapes never meet: an owner-line visit's
--     is 'call:<calls.id>', a Clerk session id is 'sess_...'. Anything that ever writes another session shape into
--     agency_visits must add actor_kind = 'agency' to agency_visit_live first.
--     note_agency_open (0105) is re-created with one guard (review m-3): it refuses every owner_line_ kind (22023).
--     Those kinds now pass the items CHECK, and parseVisit accepts only ACCESS_LOG_KINDS, so an agency visit carrying
--     one would make the Team page's BIS access section throw. Owner-line items come only from note_owner_line_call.
-- FUNCTIONS. Seven callable, all SECURITY INVOKER with set search_path = pg_catalog, pg_temp (0096's rule), EXECUTE
--   to service_role only: app.owner_line_day_start, owner_line_answer_lookup, owner_line_start_verification,
--   owner_line_attempt_verify, owner_line_attempt_pin, owner_line_session_check, note_owner_line_call. Plus two
--   trigger functions, app.owner_line_insert_guard and app.owner_line_switch_record_guard, executable by no role (a
--   trigger's function is checked for EXECUTE only when the trigger is created). note_agency_open (0105) is
--   re-created, still an invoker, with 0105's grants restated. Only service_role runs them and it already holds what they touch,
--   so a definer would add privilege and nothing else (0104's reasoning). EXPECTED_DEFINERS does not change (39).
--   Every policy-like NULL is coalesced to a refusal (the plpgsql NULL-guard lesson).
-- GRANTS. The default ACL hands ALL on a new table to anon, authenticated and service_role by name: revoked from all
--   three, then SELECT, INSERT, UPDATE, DELETE back to service_role (0104's shape). RLS on, no policy. No client
--   grant moves, so EXPECTED_WRITES in schema-grants-guard.test.ts is unchanged. The new accounts and calls columns
--   get no column grant: authenticated holds table-level SELECT on both (so a member reads them under the existing
--   row policies) and no UPDATE on either column.
-- LOCKS. Five tables, taken up front inside a do block with lock_timeout 5s. The Supabase CLI does not run a file
--   inside a transaction block, and a bare LOCK TABLE there fails 25P01 (0114's header). The second do block raises
--   0115_not_one_transaction unless the rest of the file runs in that same transaction (0088's self-check), so a path
--   that commits between statements fails before any DDL. Apply only with a client that stops on the first error
--   (the CLI, apply_migration, psql -v ON_ERROR_STOP=1); a bare psql -f would carry on past the raise.
--   THE ORDER IS CHILDREN FIRST, accounts LAST:
--     agency_visit_items, calls, agency_visits (ACCESS EXCLUSIVE: new columns and constraint swaps), then
--     memberships (SHARE ROW EXCLUSIVE: the new FK), then accounts (ACCESS EXCLUSIVE: new columns and the trigger).
--   Why: a live writer takes its child table first and its parent second, in one statement. A call's startCallRow
--   holds calls, then its FK check needs accounts; note_agency_open holds agency_visit_items, then needs
--   agency_visits. Taking a parent first deadlocks such a writer: the file holds accounts and waits for calls while
--   the writer holds calls and waits for accounts (40P01). 0114 recorded exactly this on the PG 17.6 replica
--   (feat/f077-work-queue, 0114 LOCKS AND COST), and there the victim can be a live call's row. Children first, the
--   file simply waits behind the writer. Proven on the PG18 replica, 2026-11-09 (plan Task 1 Step 6b): with a call
--   insert held open, this order waited and applied; accounts first deadlocked the same writer.
--   0114 locks ai_acts then calls; this file does not lock ai_acts, so the two orders cannot cross.
--   Residual risk, named: public.set_account_member_role (0066) locks the account row and then updates memberships.
--   If an Owner changes a role in the milliseconds between this file's memberships lock and its accounts lock, one
--   side fails 40P01. If the file is the victim it applies nothing and is re-run; if the role change is, the Owner
--   presses Save again.
--   Residual risk, named (review m-4): deleting an account takes accounts first and then cascades into its
--   children (memberships, agency_visits and agency_visit_items; calls by its own statement first, through
--   deleteAccountCascade's ACCOUNT_OWNED_TABLES). A delete that has locked its accounts row when this file reaches
--   accounts holds what the file waits for while waiting on a child the file holds: one side fails 40P01. If the
--   file is the victim it applies nothing and is re-run; if the delete is, the agency runs it again. Account
--   deletion is agency-only and rare. Apply outside business hours, and not during an account deletion.
--   An added column with no default and no NOT NULL is a catalog change only: no table rewrite. The new CHECKs on
--   accounts, agency_visits and agency_visit_items are added valid, so each scans its table once under the lock
--   already held.
-- APPLY ORDER: after 0113 and 0114. CI project (ci-project-setup.yml: push-dry-run, then push), then production (MCP
--   apply_migration, once), then the parity check, then merge. Additive: the build before it reads none of this; the
--   build after it selects calls.owner_line_user_id in listCalls, so it goes BEFORE the deploy.
--
-- Rollback (by hand, in this order; revert the app first). It destroys every enrollment and every owner-line
-- access-log entry:
--   drop function public.note_owner_line_call(uuid, uuid, text, text, text[]);
--   drop function public.owner_line_session_check(uuid, uuid, text, integer);
--   drop function public.owner_line_attempt_pin(uuid, text, integer);
--   drop function public.owner_line_attempt_verify(uuid, text, text);
--   drop function public.owner_line_start_verification(uuid, uuid, text, text, integer);
--   drop function public.owner_line_answer_lookup(uuid, text, integer);
--   drop function app.owner_line_day_start(text, timestamptz);
--   drop trigger accounts_owner_line_switch_record on public.accounts; drop function app.owner_line_switch_record_guard();
--   drop trigger accounts_owner_line_insert_guard on public.accounts; drop function app.owner_line_insert_guard();
--   re-run 0105's note_agency_open as create or replace, with its revoke and grant lines;
--   alter table public.accounts drop constraint accounts_owner_line_agency_off_check,
--     drop constraint accounts_owner_line_change_check, drop column owner_line_changed_by_kind,
--     drop column owner_line_changed_at;
--   re-run 0112's access_log_page (its section 6) as create or replace;
--   by OWNER DECISION ONLY (it deletes access-log rows): delete from public.agency_visits where actor_kind = 'owner_line';
--   restore 0112's agency_visit_items_kind_check, 0105's agency_visits_actor_kind_check and agency_visits_reason_check;
--   alter table public.agency_visits drop constraint agency_visits_owner_line_check;
--   revoke insert (actor_kind) on public.agency_visits from service_role;
--   drop index public.calls_owner_line_idx; alter table public.calls drop column owner_line_user_id;
--   alter table public.accounts drop column owner_line_enabled_at;
--   drop table public.owner_line_enrollments;
--
-- ASCII only, no backslash anywhere, and every dollar sign in this file is part of a dollar-quote pair.

-- 0. One transaction, holding the locks, or nothing at all (0088 section 0).
do $$
begin
  perform pg_catalog.set_config('lock_timeout', '5s', true);
  perform pg_catalog.set_config('bis.m0115_xid', pg_catalog.txid_current()::text, true);
  -- Children first, accounts last (LOCKS). One statement per table, so the order is the order written.
  lock table public.agency_visit_items in access exclusive mode;
  lock table public.calls in access exclusive mode;
  lock table public.agency_visits in access exclusive mode;
  lock table public.memberships in share row exclusive mode;
  lock table public.accounts in access exclusive mode;
end $$;
do $$
begin
  if pg_catalog.current_setting('bis.m0115_xid', true) is distinct from pg_catalog.txid_current()::text
     or pg_catalog.current_setting('lock_timeout') <> '5s'
     or (select count(*) from pg_catalog.pg_locks l
          where l.pid = pg_catalog.pg_backend_pid() and l.granted and l.locktype = 'relation'
            and ((l.relation in ('public.accounts'::regclass, 'public.calls'::regclass,
                                 'public.agency_visits'::regclass, 'public.agency_visit_items'::regclass)
                  and l.mode = 'AccessExclusiveLock')
              or (l.relation = 'public.memberships'::regclass and l.mode = 'ShareRowExclusiveLock'))) <> 5 then
    raise exception '0115_not_one_transaction' using errcode = 'P0001';
  end if;
end $$;

-- 1. The enrollments.
create table public.owner_line_enrollments (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null,
  user_id uuid not null,
  e164 text not null constraint owner_line_enrollments_e164_check
    check (substr(e164, 1, 1) = '+' and substr(e164, 2, 1) <> '0' and substr(e164, 2) !~ '[^0-9]'
           and char_length(e164) between 9 and 16),
  verified_at timestamptz,
  verify_code_hash text constraint owner_line_enrollments_code_hash_check
    check (verify_code_hash is null or (char_length(verify_code_hash) = 64 and verify_code_hash !~ '[^0-9a-f]')),
  verify_expires_at timestamptz,
  verify_attempts integer not null default 0 constraint owner_line_enrollments_verify_attempts_check
    check (verify_attempts between 0 and 3),
  pin_hash text constraint owner_line_enrollments_pin_hash_check
    check (pin_hash is null or (char_length(pin_hash) = 80 and substr(pin_hash, 1, 14) = 'scrypt:17:8:1:'
           and substr(pin_hash, 15) !~ '[^A-Za-z0-9_:-]')),
  pin_set_at timestamptz,
  failed_attempts integer not null default 0 constraint owner_line_enrollments_failed_attempts_check
    check (failed_attempts between 0 and 2),
  locked_until timestamptz,
  created_at timestamptz not null default now(),
  constraint owner_line_enrollments_member_fkey foreign key (account_id, user_id)
    references public.memberships (account_id, user_id) on delete cascade,
  constraint owner_line_enrollments_one_per_member unique (account_id, user_id),
  constraint owner_line_enrollments_one_cell unique (account_id, e164),
  constraint owner_line_enrollments_pin_pair_check check ((pin_hash is null) = (pin_set_at is null)),
  constraint owner_line_enrollments_code_pair_check check ((verify_code_hash is null) = (verify_expires_at is null)),
  constraint owner_line_enrollments_pin_needs_cell_check check (pin_hash is null or verified_at is not null)
);
comment on table public.owner_line_enrollments is
  'F-032 (0115): a person''s registered cell and PIN for calling in to hear the day. Server-written and server-read only.';

alter table public.owner_line_enrollments enable row level security;
-- No policy: RLS on with none refuses every row to every role that does not bypass it, and the grants below
-- refuse anon and authenticated outright (0104's shape, SC-4).
revoke all on public.owner_line_enrollments from anon, authenticated, service_role;
grant select, insert, update, delete on public.owner_line_enrollments to service_role;

-- 2. The switch and its record: when, and what kind of person, never who (owner ruling 2026-11-09).
alter table public.accounts
  add column owner_line_enabled_at timestamptz,
  add column owner_line_changed_at timestamptz,
  add column owner_line_changed_by_kind text constraint accounts_owner_line_changed_by_kind_check
    check (owner_line_changed_by_kind in ('owner', 'agency')),
  add constraint accounts_owner_line_change_check
    check ((owner_line_changed_at is null) = (owner_line_changed_by_kind is null)),
  add constraint accounts_owner_line_agency_off_check
    check (owner_line_changed_by_kind is distinct from 'agency' or owner_line_enabled_at is null);
comment on column public.accounts.owner_line_enabled_at is
  'F-032 (0115): when the Owner let the team call in to hear the day; null = off (the default). Only the client''s Owner turns it on; the agency may turn it off (owner ruling Q-A).';
comment on column public.accounts.owner_line_changed_by_kind is
  'F-032 (0115): who last turned the switch on or off, as a kind only: owner (the client''s Owner) or agency (BIS). Never a person''s id (owner ruling 2026-11-09: every member reads accounts). BIS may only turn it off (accounts_owner_line_agency_off_check).';

-- The switch is never ON at birth (spec 3.3: the client's Owner decides), and no account is born carrying a record of
-- a change nobody made. authenticated holds a TABLE-level INSERT on accounts (schema-grants-guard.test.ts
-- EXPECTED_WRITES), so a column grant cannot express this; a trigger can, for every role, service_role's
-- createAccount included (it never sets these columns). It tests each of the three columns by name, so its own
-- refusal (this message, no constraint name) comes before any CHECK could refuse the same row.
create function app.owner_line_insert_guard() returns trigger
language plpgsql security invoker set search_path = pg_catalog, pg_temp as $$
begin
  if new.owner_line_enabled_at is not null or new.owner_line_changed_at is not null
     or new.owner_line_changed_by_kind is not null then
    raise exception 'accounts: the owner line starts off; only the client''s Owner turns it on' using errcode = '23514';
  end if;
  return new;
end $$;
revoke all on function app.owner_line_insert_guard() from public, anon, authenticated, service_role;
create trigger accounts_owner_line_insert_guard before insert on public.accounts
  for each row execute function app.owner_line_insert_guard();

-- The switch never moves without a fresh record (review m-2). When owner_line_enabled_at changes, the same UPDATE must
-- move owner_line_changed_at to a new, non-null value; the pair CHECK then requires the who-kind, and the agency-off
-- CHECK holds BIS to off. A stale record (the time unchanged) or a cleared one is refused. A write that does not move
-- the switch is not touched (the WHEN clause), so every other accounts UPDATE costs nothing.
create function app.owner_line_switch_record_guard() returns trigger
language plpgsql security invoker set search_path = pg_catalog, pg_temp as $$
begin
  if new.owner_line_changed_at is null
     or new.owner_line_changed_at is not distinct from old.owner_line_changed_at then
    raise exception 'accounts: turning the owner line on or off must record when and who-kind' using errcode = '23514';
  end if;
  return new;
end $$;
revoke all on function app.owner_line_switch_record_guard() from public, anon, authenticated, service_role;
create trigger accounts_owner_line_switch_record before update on public.accounts
  for each row when (old.owner_line_enabled_at is distinct from new.owner_line_enabled_at)
  execute function app.owner_line_switch_record_guard();

-- The ACCOUNT's local day (owner ruling Q-F): the first instant whose local date, in p_zone, is p_at's local date.
-- The local midnight, back to an instant; then two bounded corrections, 15 minutes at a time (no zone moves its
-- clocks by more than 2 hours, and every transition falls on a quarter hour):
--   forward, while that instant is still on the previous date (a defensive guard: PostgreSQL already reads a
--     midnight that does not exist, America/Santiago's 2026-09-06, as the instant the clocks jump);
--   back, while the instant 15 minutes earlier is still on this date (load-bearing: PostgreSQL reads a midnight that
--     happens TWICE, America/Havana's 2026-11-01, as the LATER one, an hour after the day began).
create function app.owner_line_day_start(p_zone text, p_at timestamptz) returns timestamptz
language plpgsql stable security invoker set search_path = pg_catalog, pg_temp as $$
declare v_day date; v_start timestamptz; i integer := 0;
begin
  if p_zone is null or p_at is null then
    raise exception 'owner_line_day_start: a required argument is null' using errcode = '22004';
  end if;
  v_day := (p_at at time zone p_zone)::date;
  v_start := (v_day::timestamp) at time zone p_zone;
  while (v_start at time zone p_zone)::date < v_day and i < 8 loop
    v_start := v_start + interval '15 minutes';
    i := i + 1;
  end loop;
  while ((v_start - interval '15 minutes') at time zone p_zone)::date = v_day and i < 16 loop
    v_start := v_start - interval '15 minutes';
    i := i + 1;
  end loop;
  return v_start;
end $$;
revoke all on function app.owner_line_day_start(text, timestamptz) from public, anon, authenticated, service_role;
grant execute on function app.owner_line_day_start(text, timestamptz) to service_role;

-- The call mark, and the read behind the 10-a-day limit.
alter table public.calls add column owner_line_user_id uuid;
comment on column public.calls.owner_line_user_id is
  'F-032 (0115): the person an owner-line call was for; null on every customer call. No FK: the mark outlives the user.';
create index calls_owner_line_idx on public.calls (account_id, owner_line_user_id, started_at desc)
  where owner_line_user_id is not null;

-- 3. The access log learns owner_line_call (SC-13). The kind list is 0112 section 6's, plus four (DRAFT note a).
alter table public.agency_visits drop constraint agency_visits_actor_kind_check;
alter table public.agency_visits add constraint agency_visits_actor_kind_check check (actor_kind in ('agency', 'owner_line'));
alter table public.agency_visits drop constraint agency_visits_reason_check;
alter table public.agency_visits add constraint agency_visits_reason_check
  check (reason in ('setup', 'support', 'fix', 'billing', 'owner_line_call'));
alter table public.agency_visits add constraint agency_visits_owner_line_check
  check ((actor_kind = 'owner_line') = (reason = 'owner_line_call'));
alter table public.agency_visit_items drop constraint agency_visit_items_kind_check;
alter table public.agency_visit_items add constraint agency_visit_items_kind_check check (kind in (
  'contact', 'group', 'call', 'conversation', 'document_view', 'document_download', 'document_share',
  'form_answers', 'customer_list_export', 'record_history_export',
  'owner_line_calls_and_messages', 'owner_line_appointments', 'owner_line_needs_attention', 'owner_line_lookup_customer'));
grant insert (actor_kind) on public.agency_visits to service_role;

-- note_agency_open: 0105's text with one guard (review m-3; DRAFT note g). An owner_line_ kind is
-- note_owner_line_call's alone; on an agency visit it would blank the BIS access section (parseVisit).
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

-- access_log_page: 0112's text with one change, actor_kind = 'agency' on the count and on the page.
create or replace function public.access_log_page(
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
  select count(*) into v_total from public.agency_visits v where v.account_id = p_account_id and v.actor_kind = 'agency';
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
          'customer_list_export', count(*) filter (where i.kind = 'customer_list_export'),
          'record_history_export', count(*) filter (where i.kind = 'record_history_export'))
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
    where v.account_id = p_account_id and v.actor_kind = 'agency'
      and (p_before_started is null or (v.started_at, v.id) < (p_before_started, p_before_id))
    order by v.started_at desc, v.id desc
    limit p_limit + 1
  ) pg;
  return jsonb_build_object('total', v_total, 'visits', v_visits);
end $$;
revoke all on function public.access_log_page(uuid, timestamptz, uuid, integer) from public, anon, authenticated, service_role;
grant execute on function public.access_log_page(uuid, timestamptz, uuid, integer) to authenticated;

-- 4. What the answer route does for this caller on this business. One unique-index read for a stranger.
create function public.owner_line_answer_lookup(
  p_account_id uuid, p_caller_e164 text, p_max integer)
returns jsonb language plpgsql stable security invoker set search_path = pg_catalog, pg_temp as $$
declare e public.owner_line_enrollments%rowtype; v_role text; v_name text; v_lang text; v_acct_lang text;
        v_open boolean; v_on timestamptz; v_zone text; v_count bigint; v_base jsonb;
begin
  if p_account_id is null or p_caller_e164 is null or p_max is null then
    raise exception 'owner_line_answer_lookup: a required argument is null' using errcode = '22004';
  end if;
  select * into e from public.owner_line_enrollments where account_id = p_account_id and e164 = p_caller_e164;
  if not found then return jsonb_build_object('status', 'none'); end if;
  select m.role into v_role from public.memberships m
   where m.scope = 'account' and m.account_id = e.account_id and m.user_id = e.user_id;
  if not coalesce(v_role in ('owner', 'staff', 'technician'), false) then return jsonb_build_object('status', 'none'); end if;
  select coalesce(a.client_access_enabled, false) and a.status <> 'archived', a.owner_line_enabled_at, a.language, a.timezone
    into v_open, v_on, v_acct_lang, v_zone from public.accounts a where a.id = e.account_id;
  if not coalesce(v_open, false) then return jsonb_build_object('status', 'none'); end if;
  select u.name, u.language into v_name, v_lang from public.users u where u.id = e.user_id;
  v_base := jsonb_build_object('enrollment_id', e.id, 'user_id', e.user_id, 'role', v_role, 'name', v_name,
    'language', v_lang, 'account_language', v_acct_lang);
  if e.verified_at is null then
    if e.verify_code_hash is not null and e.verify_expires_at > now() and e.verify_attempts < 3 then
      return v_base || jsonb_build_object('status', 'verify');
    end if;
    return jsonb_build_object('status', 'none');
  end if;
  if e.pin_hash is null then return jsonb_build_object('status', 'none'); end if;
  if v_on is null then return jsonb_build_object('status', 'off'); end if;
  if e.locked_until is not null and e.locked_until > now() then return jsonb_build_object('status', 'locked'); end if;
  select count(*) into v_count from public.calls c
   where c.account_id = e.account_id and c.owner_line_user_id = e.user_id
     and c.started_at >= app.owner_line_day_start(v_zone, now());
  if v_count >= p_max then return v_base || jsonb_build_object('status', 'over_limit'); end if;
  return v_base || jsonb_build_object('status', 'pin', 'pin_params', substr(e.pin_hash, 1, 36));
end $$;

-- 5. (Re)start a call-in code. A new cell clears the verification, the PIN, the counter and the lock.
create function public.owner_line_start_verification(
  p_account_id uuid, p_user_id uuid, p_e164 text, p_code_hash text, p_minutes integer)
returns text language plpgsql security invoker set search_path = pg_catalog, pg_temp as $$
begin
  if p_account_id is null or p_user_id is null or p_e164 is null or p_code_hash is null or p_minutes is null then
    raise exception 'owner_line_start_verification: a required argument is null' using errcode = '22004';
  end if;
  begin
    insert into public.owner_line_enrollments as e (account_id, user_id, e164, verify_code_hash, verify_expires_at)
    values (p_account_id, p_user_id, p_e164, p_code_hash, now() + make_interval(mins => p_minutes))
    on conflict (account_id, user_id) do update
       set e164 = excluded.e164,
           verify_code_hash = excluded.verify_code_hash,
           verify_expires_at = excluded.verify_expires_at,
           verify_attempts = 0,
           verified_at = case when e.e164 = excluded.e164 then e.verified_at end,
           pin_hash = case when e.e164 = excluded.e164 then e.pin_hash end,
           pin_set_at = case when e.e164 = excluded.e164 then e.pin_set_at end,
           failed_attempts = case when e.e164 = excluded.e164 then e.failed_attempts else 0 end,
           locked_until = case when e.e164 = excluded.e164 then e.locked_until end;
  exception when unique_violation then
    return 'taken';
  end;
  return 'ok';
end $$;

-- 6. One call-in code attempt, under the row lock.
create function public.owner_line_attempt_verify(p_account_id uuid, p_caller_e164 text, p_code_hash text)
returns text language plpgsql security invoker set search_path = pg_catalog, pg_temp as $$
declare e public.owner_line_enrollments%rowtype;
begin
  if p_account_id is null or p_caller_e164 is null or p_code_hash is null then
    raise exception 'owner_line_attempt_verify: a required argument is null' using errcode = '22004';
  end if;
  select * into e from public.owner_line_enrollments
   where account_id = p_account_id and e164 = p_caller_e164 for update;
  if not found or e.verified_at is not null or e.verify_code_hash is null then return 'none'; end if;
  if e.verify_expires_at <= now() or e.verify_attempts >= 3 then
    update public.owner_line_enrollments set verify_code_hash = null, verify_expires_at = null where id = e.id;
    return 'spent';
  end if;
  if e.verify_code_hash = p_code_hash then
    update public.owner_line_enrollments
       set verified_at = now(), verify_code_hash = null, verify_expires_at = null, verify_attempts = 0
     where id = e.id;
    return 'verified';
  end if;
  if e.verify_attempts + 1 >= 3 then
    update public.owner_line_enrollments
       set verify_attempts = 3, verify_code_hash = null, verify_expires_at = null where id = e.id;
    return 'spent';
  end if;
  update public.owner_line_enrollments set verify_attempts = e.verify_attempts + 1 where id = e.id;
  return 'wrong';
end $$;

-- 7. One PIN attempt, under the row lock. Owns the counter (per enrollment, so a redial never resets it) and the lock.
create function public.owner_line_attempt_pin(p_enrollment_id uuid, p_candidate text, p_lock_minutes integer)
returns jsonb language plpgsql security invoker set search_path = pg_catalog, pg_temp as $$
declare e public.owner_line_enrollments%rowtype; v_until timestamptz;
begin
  if p_enrollment_id is null or p_candidate is null or p_lock_minutes is null then
    raise exception 'owner_line_attempt_pin: a required argument is null' using errcode = '22004';
  end if;
  select * into e from public.owner_line_enrollments where id = p_enrollment_id for update;
  if not found or e.verified_at is null or e.pin_hash is null then return jsonb_build_object('status', 'none'); end if;
  if e.locked_until is not null and e.locked_until > now() then
    return jsonb_build_object('status', 'locked', 'locked_until', e.locked_until);
  end if;
  if e.pin_hash = p_candidate then
    update public.owner_line_enrollments set failed_attempts = 0, locked_until = null where id = e.id;
    return jsonb_build_object('status', 'ok');
  end if;
  if e.failed_attempts + 1 >= 3 then
    update public.owner_line_enrollments
       set failed_attempts = 0, locked_until = now() + make_interval(mins => p_lock_minutes)
     where id = e.id returning locked_until into v_until;
    return jsonb_build_object('status', 'locked_now', 'locked_until', v_until);
  end if;
  update public.owner_line_enrollments set failed_attempts = e.failed_attempts + 1 where id = e.id;
  return jsonb_build_object('status', 'wrong', 'failed_attempts', e.failed_attempts + 1);
end $$;

-- 8. The live re-read: the SIP webhook (with p_max) and every owner tool call (p_max null). The day is the account's (Q-F).
create function public.owner_line_session_check(
  p_account_id uuid, p_user_id uuid, p_role text, p_max integer)
returns jsonb language plpgsql stable security invoker set search_path = pg_catalog, pg_temp as $$
declare e public.owner_line_enrollments%rowtype; v_role text; v_open boolean; v_on timestamptz; v_org text;
        v_zone text; v_acct_lang text; v_name text; v_lang text; v_clerk text; v_count bigint;
begin
  if p_account_id is null or p_user_id is null or p_role is null then
    raise exception 'owner_line_session_check: a required argument is null' using errcode = '22004';
  end if;
  select m.role into v_role from public.memberships m
   where m.scope = 'account' and m.account_id = p_account_id and m.user_id = p_user_id;
  if v_role is null then return jsonb_build_object('ok', false, 'reason', 'not_a_member'); end if;
  if v_role is distinct from p_role then return jsonb_build_object('ok', false, 'reason', 'role_changed'); end if;
  select coalesce(a.client_access_enabled, false) and a.status <> 'archived', a.owner_line_enabled_at, a.clerk_org_id,
         a.timezone, a.language
    into v_open, v_on, v_org, v_zone, v_acct_lang from public.accounts a where a.id = p_account_id;
  if not coalesce(v_open, false) then return jsonb_build_object('ok', false, 'reason', 'no_client_access'); end if;
  if v_on is null then return jsonb_build_object('ok', false, 'reason', 'switch_off'); end if;
  select * into e from public.owner_line_enrollments where account_id = p_account_id and user_id = p_user_id;
  if not found or e.verified_at is null or e.pin_hash is null then
    return jsonb_build_object('ok', false, 'reason', 'not_enrolled');
  end if;
  if e.locked_until is not null and e.locked_until > now() then return jsonb_build_object('ok', false, 'reason', 'locked'); end if;
  if p_max is not null then
    select count(*) into v_count from public.calls c
     where c.account_id = p_account_id and c.owner_line_user_id = p_user_id
       and c.started_at >= app.owner_line_day_start(v_zone, now());
    if v_count >= p_max then return jsonb_build_object('ok', false, 'reason', 'over_limit'); end if;
  end if;
  select u.name, u.language, u.clerk_user_id into v_name, v_lang, v_clerk from public.users u where u.id = p_user_id;
  return jsonb_build_object('ok', true, 'name', v_name, 'language', v_lang, 'clerk_user_id', v_clerk,
    'clerk_org_id', v_org, 'timezone', v_zone, 'account_language', v_acct_lang);
end $$;

-- 9. The access-log entry for one owner-line call: one visit, one item per tool that ran (duplicates folded).
create function public.note_owner_line_call(
  p_account_id uuid, p_call_id uuid, p_actor text, p_actor_name text, p_kinds text[])
returns uuid language plpgsql security invoker set search_path = pg_catalog, pg_temp as $$
declare v_visit uuid;
begin
  if p_account_id is null or p_call_id is null or p_actor is null or p_kinds is null then
    raise exception 'note_owner_line_call: a required argument is null' using errcode = '22004';
  end if;
  if exists (select 1 from unnest(p_kinds) k where k is null or left(k, 11) <> 'owner_line_') then
    raise exception 'note_owner_line_call: only owner_line_ kinds' using errcode = '22023';
  end if;
  insert into public.agency_visits (account_id, actor_kind, actor_clerk_user_id, actor_name, clerk_session_id, reason)
  values (p_account_id, 'owner_line', p_actor, nullif(pg_catalog.btrim(p_actor_name), ''), 'call:' || p_call_id::text,
          'owner_line_call')
  returning id into v_visit;
  insert into public.agency_visit_items (visit_id, account_id, kind, record_id, item_count)
  select v_visit, p_account_id, k, p_call_id, null from (select distinct unnest(p_kinds) as k) x;
  return v_visit;
end $$;

-- 10. Function privileges: everything revoked by name (0043's lesson), then EXECUTE to service_role.
revoke all on function public.owner_line_answer_lookup(uuid, text, integer) from public, anon, authenticated, service_role;
revoke all on function public.owner_line_start_verification(uuid, uuid, text, text, integer) from public, anon, authenticated, service_role;
revoke all on function public.owner_line_attempt_verify(uuid, text, text) from public, anon, authenticated, service_role;
revoke all on function public.owner_line_attempt_pin(uuid, text, integer) from public, anon, authenticated, service_role;
revoke all on function public.owner_line_session_check(uuid, uuid, text, integer) from public, anon, authenticated, service_role;
revoke all on function public.note_owner_line_call(uuid, uuid, text, text, text[]) from public, anon, authenticated, service_role;
grant execute on function public.owner_line_answer_lookup(uuid, text, integer) to service_role;
grant execute on function public.owner_line_start_verification(uuid, uuid, text, text, integer) to service_role;
grant execute on function public.owner_line_attempt_verify(uuid, text, text) to service_role;
grant execute on function public.owner_line_attempt_pin(uuid, text, integer) to service_role;
grant execute on function public.owner_line_session_check(uuid, uuid, text, integer) to service_role;
grant execute on function public.note_owner_line_call(uuid, uuid, text, text, text[]) to service_role;
