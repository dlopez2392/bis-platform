-- 0111_record_changes.sql - the change log every contact write fills, in observe mode (F-115 part 1 / S-04)
-- (docs/superpowers/specs/2026-11-02-record-history-design.md sections 2.2, 2.3 and 5;
--  docs/superpowers/plans/2026-11-02-record-history.md, Task 1)
--
-- WHY. No edit of a customer's own facts is recorded with its values today: the events ledger says that a
-- contact changed, never which field, what it was or what it became, and some writers record nothing at all.
-- About 690 serviceDb() call sites and several SQL definers write contacts, so a log kept by TypeScript would
-- drift from the truth the way events.ts:8-13 already records. A trigger sees every write inside the write's
-- own transaction: no change row can be lost after a commit, and no write can commit without its row.
--
-- WHAT.
--   public.record_changes: one row per changed audited field (op update), or one snapshot row per insert or
--     delete (field null). account_id cascades with the account; record_id has NO foreign key, so the log
--     outlives a removed row (0105's reason). record_type's CHECK already lists the eight Q1 types, so 0112
--     never alters it. xact (txid_current()) groups one write's rows; created_at is now(). author_kind is
--     NULLABLE in observe mode only; 0113 sets NOT NULL. author_id only with person or import.
--     Indexes: (account_id, contact_id, created_at desc, id desc) for a record's timeline;
--     (account_id, client_group_id, created_at desc, id desc) where client_group_id is not null, for a group;
--     (account_id, record_type, record_id, created_at desc) for one record's history;
--     (created_at) where author_kind is null, for the daily audit's count of unattributed rows (0113 drops it).
--   app.record_changes_settings: exactly one row (id boolean primary key, check (id)); enforce false here.
--     0113 turns it on; CI's throwaway stacks turn it on after migrating (plan Task 2, Step 9).
--   app.record_change_fields(record_type) -> text[]: the AUDITED columns per type, contacts only in this file
--     (first_name, last_name, email, phone, assigned_to, dnd, source, marketing_email_opted_out_at, language,
--     custom; custom is diffed per key as field 'custom.<key>'). Every other contacts column is EXCLUDED with a
--     reason, pinned in record-changes-schema.test.ts: a new contacts column fails that test until decided.
--   app.record_changes_capture(): the trigger function, SECURITY DEFINER (it writes a table no API role can
--     write). tg_argv[0] is the record_type, tg_argv[1] is 'client' or 'server'. Who made the write, strongest
--     evidence first (spec 2.3, with plan corrections 4 and 9):
--       1. 'client' (current_user = 'authenticated': a signed-in PostgREST write): person with the token's sub.
--          The x-bis-author header can relabel it import (the sub kept: a person can only relabel their own
--          write) and can carry via 'restore:<digits>'; any other kind or via a browser sends is dropped.
--       2. 'server' and bis.author set (set_config(..., true) by a definer that knows who acted): that kind,
--          bis.author_id and bis.via.
--       3. 'server' and the SESSION role is authenticated (a definer a person called): person with the sub. Any
--          header is ignored: a signed-in browser can attach any header to an rpc.
--       4. 'server', the SESSION role is service_role, and the x-bis-author header names a valid author
--          (one of the five kinds; person needs an id): that kind, id and via. Only BIS server code holds the
--          service key.
--       5. a direct session (the session role is none of anon, authenticated, service_role: a migration, psql,
--          pg_cron, a test fixture seeding as the owner): automation with via 'sql', never refused.
--       6. anything else: observe mode writes author_kind NULL (counted unattributed); enforce mode raises
--          42501 'record_changes: a server write must say who made it', and the write rolls back.
--     The role is current_setting('role'), never a claim (0110's rule: a definer does not change it, and a
--     JWT claim is not trusted for it). Only the header's x-bis-author key is read: request.headers also holds
--     the bearer token, and nothing else from it is copied into a row.
--     UPDATE first works out which audited columns are DISTINCT; with none (a no-op, or only EXCLUDED columns
--     changed) it returns before the author is decided, so it writes nothing and is never refused: enforce mode
--     refuses exactly what observe mode would record unattributed (review I1). Otherwise one row per changed
--     field. INSERT writes the
--     audited snapshot as after; DELETE writes the old row as before, except a contact: its value-bearing rows
--     are deleted and ONE values-free delete row is written (the old values do not outlive a deletion the
--     Owner asked for; the fact does). A delete whose account row is already gone (a cascade from accounts)
--     records nothing (plan correction 6).
--   Two AFTER ROW triggers on public.contacts: record_changes_client (WHEN current_user = 'authenticated') and
--     record_changes_server (WHEN current_user <> 'authenticated').
--   Two policies on record_changes, the events pair renamed: record_changes_read (0109's InitPlan form of
--     events_read) and record_changes_technician_none (0068's events_technician_none). Owners, Staff and the
--     agency read their account's rows; a Technician reads none (Q2).
--
-- GRANTS. record_changes: everything revoked from public, anon, authenticated and service_role (the default ACL
-- grants anon and authenticated by name), then SELECT to authenticated (through the two policies) and
-- service_role. No API role holds INSERT, UPDATE, DELETE or TRUNCATE (plan correction 5: the capture definer is
-- the only writer, so BIS server code cannot forge a row). Its identity sequence: everything revoked from the
-- three roles (no role inserts). app.record_changes_settings: nothing to any API role. app.record_change_fields:
-- EXECUTE to authenticated and service_role only. app.record_changes_capture: EXECUTE to nobody (a trigger
-- function needs no EXECUTE to fire). The client-write digest does not move (anon and authenticated write
-- nothing here). One definer joins EXPECTED_DEFINERS (38 -> 39). EXPECTED_WRITES is unchanged.
--
-- SEARCH PATHS. Every function here says set search_path = pg_catalog, pg_temp (the 0096 rule), and names
-- every relation and function by schema.
--
-- LOCKS AND COST. The file runs as one transaction; lock_timeout 5s below bounds only the WAIT to take each
-- lock. contacts: the two create trigger statements take SHARE ROW EXCLUSIVE until the file commits (no scan,
-- no rewrite). accounts: creating the account_id foreign key takes SHARE ROW EXCLUSIVE on public.accounts until
-- the file commits (no scan: record_changes is new and empty), so an account insert, update or delete waits for the
-- file. Every other object is new. record_changes_unattributed_idx is built on the new, empty table: no lock on
-- any existing table and no scan, so its cost is nil. MEASURED on a PostgreSQL 17.6 replica (pre = 0001-0110, post = pre +
-- this file, one account, laptop SSD, a fresh database per run, the update or the merge timed alone):
--   500-contact bulk assign (as an Owner, one update statement): before 211.6 ms, after 348.3 ms (+65%), median of
--     6 runs (two sets of 3: 142.7 -> 373.5 ms, then interleaved 215.6 -> 342.6 ms); 500 change rows. EXPLAIN
--     ANALYZE: Trigger record_changes_client time=125.4 ms calls=500 (0.25 ms a row). MISSES the +20% target.
--   merge moving 10,000 messages (as an Owner): before 406.2 ms, after 451.4 ms (+11%), median of the same 6 runs
--     (307.3 -> 460.5 ms, then 414.7 -> 432.3 ms); 2 change rows (the kept record's email and phone).
--   216 bytes per change row (pg_column_size avg over the 500).
--   Accepted 2026-11-02 (orchestrator): +65% relative is 0.25 ms per row absolute. Revisit (statement-level triggers
--   with transition tables) before any account's bulk write exceeds ~5,000 rows.
--   Re-measured after review I1 (the changed fields gathered first, one insert per update; 3 runs, same replica):
--     bulk assign median 257.8 ms, merge median 376.8 ms: no worse than the figures above.
--
-- LOAD-BEARING.
--   1. The role test sits in each trigger's WHEN, never in the body: inside a definer body current_user is the
--      owner, never 'authenticated' (0103's lesson, 0103:200-203).
--   2. The definer is the only writer of record_changes. Nothing else may be granted INSERT.
--   3. Observe until 0113: production writes NULL for an unattributed server write; it never refuses one.
--   4. A later data migration that writes an audited table either runs set_config('bis.author', 'automation',
--      true) first, or accepts automation/'sql' (a direct session).
--   5. Plan correction 6: a delete whose account no longer exists records nothing, or account teardown would
--      fail on this table's foreign key.
--   6. A definer that sets bis.author, bis.author_id or bis.via sets all three back to '' before it returns
--      (plan correction 7): a set_config(..., true) lives to the end of the transaction.
--   7. The server path splits on the SESSION role, current_setting('role'), never on a claim (0110:23-34: a definer
--      does not change it, and a JWT claim is not trusted for it): authenticated is the person who called the
--      definer (the sub); service_role is BIS server code (the x-bis-author header); anything else is a direct
--      session (migrations, psql, pg_cron, a fixture seeding as the owner) and is automation/'sql', never refused.
--
-- ROLLBACK (revert the app first):
--   drop trigger record_changes_client on public.contacts; drop trigger record_changes_server on public.contacts;
--   drop function app.record_changes_capture(); drop function app.record_change_fields(text);
--   drop table app.record_changes_settings;
--   drop index public.record_changes_unattributed_idx;
--   then, by OWNER DECISION ONLY and after an export: drop table public.record_changes; (it DESTROYS history).
--
-- ASCII only, no backslash anywhere, and every dollar sign in this file is part of a dollar-quote pair.

-- 0. Fail fast instead of queueing behind a long lock.
do $$
begin
  perform pg_catalog.set_config('lock_timeout', '5s', true);
end $$;

-- 1. The log. No FK on record_id: the log outlives a removed row (0105's reason).
create table public.record_changes (
  id bigint generated always as identity primary key,
  account_id uuid not null references public.accounts (id) on delete cascade,
  record_type text not null constraint record_changes_record_type check (record_type in
    ('contact', 'client_group', 'client_group_member', 'place', 'equipment', 'opportunity',
     'contact_relationship', 'contact_tag')),
  record_id uuid not null,
  contact_id uuid,
  client_group_id uuid,
  op text not null constraint record_changes_op check (op in ('insert', 'update', 'delete')),
  field text,
  before jsonb,
  after jsonb,
  xact bigint not null default pg_catalog.txid_current(),
  author_kind text constraint record_changes_author_kind check (author_kind in ('person', 'ai', 'automation', 'customer', 'import')),
  author_id text,
  via text,
  created_at timestamptz not null default pg_catalog.now(),
  constraint record_changes_field_shape check ((op = 'update') = (field is not null)),
  constraint record_changes_author_id check (author_id is null or author_kind in ('person', 'import'))
);
comment on table public.record_changes is
  'F-115 (0111): one row per changed audited field of a customer''s own record. Append-only by grants; written only by app.record_changes_capture().';
create index record_changes_contact_idx on public.record_changes (account_id, contact_id, created_at desc, id desc);
create index record_changes_group_idx on public.record_changes (account_id, client_group_id, created_at desc, id desc)
  where client_group_id is not null;
create index record_changes_record_idx on public.record_changes (account_id, record_type, record_id, created_at desc);
-- The daily audit (record-changes-audit.ts, every 15 minutes, service client) counts the unattributed rows of the
-- last 24 hours across every account; the three above lead with account_id, so without this that count scans a
-- table that is never swept. Partial: it holds only the NULL-author rows. 0113 sets author_kind NOT NULL, and
-- drops this index then.
create index record_changes_unattributed_idx on public.record_changes (created_at) where author_kind is null;

-- 2. Observe or enforce. One row; 0113 turns enforce on.
create table app.record_changes_settings (
  id boolean primary key default true constraint record_changes_settings_one check (id),
  enforce boolean not null default false
);
insert into app.record_changes_settings default values;
revoke all on app.record_changes_settings from public, anon, authenticated, service_role;

-- 3. The audited columns per type. 0112 replaces this with every Q1 type.
create function app.record_change_fields(p_type text) returns text[]
language sql immutable set search_path = pg_catalog, pg_temp as $$
  select case p_type
    when 'contact' then array['first_name', 'last_name', 'email', 'phone', 'assigned_to', 'dnd', 'source',
                              'marketing_email_opted_out_at', 'language', 'custom']
  end
$$;
revoke all on function app.record_change_fields(text) from public, anon, authenticated, service_role;
grant execute on function app.record_change_fields(text) to authenticated, service_role;

-- 4. The capture. DEFINER: it writes a table no API role can write.
create function app.record_changes_capture() returns trigger
language plpgsql security definer set search_path = pg_catalog, pg_temp as $$
declare
  v_type text := tg_argv[0];
  v_path text := tg_argv[1];
  v_fields text[] := coalesce(app.record_change_fields(tg_argv[0]), '{}'::text[]);
  v_old jsonb := case when tg_op <> 'INSERT' then pg_catalog.to_jsonb(old) end;
  v_new jsonb := case when tg_op <> 'DELETE' then pg_catalog.to_jsonb(new) end;
  v_row jsonb := coalesce(v_new, v_old);
  v_account uuid := (v_row ->> 'account_id')::uuid;
  v_role text := coalesce(pg_catalog.current_setting('role', true), 'none');
  v_claims jsonb;
  v_sub text;
  v_raw text;
  v_hdr jsonb;
  v_kind text; v_id text; v_via text;
  v_contact uuid; v_group uuid; v_record uuid;
  v_f text[] := '{}'::text[];
  v_b jsonb[] := '{}'::jsonb[];
  v_a jsonb[] := '{}'::jsonb[];
  f text; k text;
begin
  -- Plan correction 6: a cascade from the account (teardown) records nothing.
  if tg_op = 'DELETE' and not exists (select 1 from public.accounts a where a.id = v_account) then
    return null;
  end if;

  -- An update: what changed, BEFORE who made it (review I1). An update that changes no audited field writes
  -- nothing, so it is never refused either: enforce mode refuses exactly the writes observe mode would record
  -- without an author, and a stamp of an EXCLUDED column (reactivation_sent_at) is never blocked.
  if tg_op = 'UPDATE' then
    foreach f in array v_fields loop
      if f = 'custom'
         and pg_catalog.jsonb_typeof(coalesce(v_old -> 'custom', '{}'::jsonb)) = 'object'
         and pg_catalog.jsonb_typeof(coalesce(v_new -> 'custom', '{}'::jsonb)) = 'object' then
        for k in select pg_catalog.jsonb_object_keys(coalesce(v_old -> 'custom', '{}'::jsonb))
                 union select pg_catalog.jsonb_object_keys(coalesce(v_new -> 'custom', '{}'::jsonb)) loop
          if (v_old -> 'custom' -> k) is distinct from (v_new -> 'custom' -> k) then
            v_f := pg_catalog.array_append(v_f, 'custom.' || k);
            v_b := pg_catalog.array_append(v_b, v_old -> 'custom' -> k);
            v_a := pg_catalog.array_append(v_a, v_new -> 'custom' -> k);
          end if;
        end loop;
      elsif (v_old -> f) is distinct from (v_new -> f) then
        v_f := pg_catalog.array_append(v_f, f);
        v_b := pg_catalog.array_append(v_b, v_old -> f);
        v_a := pg_catalog.array_append(v_a, v_new -> f);
      end if;
    end loop;
    if pg_catalog.cardinality(v_f) = 0 then
      return null;
    end if;
  end if;

  v_claims := nullif(pg_catalog.current_setting('request.jwt.claims', true), '')::jsonb;
  v_sub := nullif(pg_catalog.btrim(v_claims ->> 'sub'), '');
  -- Only the x-bis-author key: request.headers also carries the bearer token.
  v_raw := nullif(pg_catalog.current_setting('request.headers', true), '')::jsonb ->> 'x-bis-author';
  if v_raw is not null then
    begin
      v_hdr := v_raw::jsonb;
    exception when invalid_text_representation then
      v_hdr := null;   -- a malformed header is no author
    end;
    if pg_catalog.jsonb_typeof(v_hdr) is distinct from 'object' then
      v_hdr := null;
    end if;
  end if;

  -- Who made the write (spec 2.3; plan corrections 4 and 9).
  if v_path = 'client' then
    v_kind := case when v_hdr ->> 'kind' = 'import' then 'import' else 'person' end;
    v_id := v_sub;
    v_via := v_hdr ->> 'via';
    if not coalesce(pg_catalog.left(v_via, 8) = 'restore:' and pg_catalog.length(v_via) between 9 and 27
                    and pg_catalog.substr(v_via, 9) !~ '[^0-9]', false) then
      v_via := null;
    end if;
  elsif nullif(pg_catalog.current_setting('bis.author', true), '') is not null then
    v_kind := pg_catalog.current_setting('bis.author', true);
    v_id := nullif(pg_catalog.current_setting('bis.author_id', true), '');
    v_via := nullif(pg_catalog.current_setting('bis.via', true), '');
  elsif v_role = 'authenticated' then
    v_kind := 'person';
    v_id := v_sub;
  elsif v_role = 'service_role'
        and v_hdr ->> 'kind' in ('person', 'ai', 'automation', 'customer', 'import')
        and (v_hdr ->> 'kind' <> 'person' or nullif(pg_catalog.btrim(v_hdr ->> 'id'), '') is not null) then
    v_kind := v_hdr ->> 'kind';
    v_id := nullif(pg_catalog.btrim(v_hdr ->> 'id'), '');
    v_via := nullif(v_hdr ->> 'via', '');
  elsif v_role not in ('anon', 'authenticated', 'service_role') then
    v_kind := 'automation';
    v_via := 'sql';
  elsif (select s.enforce from app.record_changes_settings s) then
    raise exception 'record_changes: a server write must say who made it' using errcode = '42501';
  end if;
  if v_kind is distinct from 'person' and v_kind is distinct from 'import' then
    v_id := null;
  end if;

  -- Where it shows.
  v_record := (v_row ->> 'id')::uuid;
  v_contact := case v_type when 'contact' then v_record else (v_row ->> 'contact_id')::uuid end;
  v_group := (v_row ->> 'client_group_id')::uuid;

  if tg_op = 'INSERT' then
    insert into public.record_changes (account_id, record_type, record_id, contact_id, client_group_id, op, after,
                                       author_kind, author_id, via)
    select v_account, v_type, v_record, v_contact, v_group, 'insert',
           (select pg_catalog.jsonb_object_agg(x, v_new -> x) from pg_catalog.unnest(v_fields) as x),
           v_kind, v_id, v_via;
  elsif tg_op = 'DELETE' then
    if v_type = 'contact' then
      -- Spec 2.2: the old values do not outlive a deletion the Owner asked for; the fact does.
      delete from public.record_changes r where r.account_id = v_account and r.contact_id = v_record;
      insert into public.record_changes (account_id, record_type, record_id, contact_id, op, author_kind, author_id, via)
      values (v_account, v_type, v_record, v_record, 'delete', v_kind, v_id, v_via);
    else
      insert into public.record_changes (account_id, record_type, record_id, contact_id, client_group_id, op, before,
                                         author_kind, author_id, via)
      values (v_account, v_type, v_record, v_contact, v_group, 'delete', v_old, v_kind, v_id, v_via);
    end if;
  else
    insert into public.record_changes (account_id, record_type, record_id, contact_id, client_group_id, op, field,
                                       before, after, author_kind, author_id, via)
    select v_account, v_type, v_record, v_contact, v_group, 'update', u.f, u.b, u.a, v_kind, v_id, v_via
      from unnest(v_f, v_b, v_a) as u(f, b, a);   -- multi-argument unnest is FROM-clause syntax; it takes no schema
  end if;
  return null;
end $$;
revoke all on function app.record_changes_capture() from public, anon, authenticated, service_role;

-- 5. Contacts. The role test is in WHEN, which runs in the caller's context (0103:200-203).
create trigger record_changes_client after insert or update or delete on public.contacts
  for each row when (current_user = 'authenticated')
  execute function app.record_changes_capture('contact', 'client');
create trigger record_changes_server after insert or update or delete on public.contacts
  for each row when (current_user <> 'authenticated')
  execute function app.record_changes_capture('contact', 'server');

-- 6. Read: Owners, Staff, the agency. Technicians none (Q2). The events pair (0109's events_read, 0068's
--    events_technician_none), renamed, every function call in an InitPlan.
alter table public.record_changes enable row level security;
revoke all on public.record_changes from public, anon, authenticated, service_role;
revoke all on sequence public.record_changes_id_seq from public, anon, authenticated, service_role;
grant select on public.record_changes to authenticated, service_role;
create policy record_changes_read on public.record_changes
  for select to authenticated
  using (((select app.is_agency()) OR (account_id = (select app.current_account_id()))));
create policy record_changes_technician_none on public.record_changes as restrictive for select to authenticated
  using ((select app.sees_all_customers(app.current_account_id())));
