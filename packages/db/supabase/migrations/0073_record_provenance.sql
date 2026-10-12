-- 0073_record_provenance.sql - who made each row on a customer's timeline (S-03 part 1, PR 1b)
-- (docs/superpowers/specs/2026-10-12-record-page-design.md section 5)
--
-- DESIGN.md, Provenance: every timeline row states who did it, from one closed set: a person, the AI
-- receptionist, an automation, the customer, an import. Rows a signed-in person writes directly
-- (notes, tasks, opportunities: client-writable under 0053) get their author stamped by the database
-- from the JWT sub, 0071's convention. Rows only server code writes (messages, bookings,
-- form_submissions: server-only since 0053) get an explicit author_kind from that code
-- (packages/db/src/provenance.ts). calls need nothing: every calls row is a call the receptionist
-- took (0059 and 0039 keep forwarded and refused calls out of it).
--
--   1. Columns and CHECKs. messages.author_kind and bookings.author_kind start NULLABLE: the build
--      before 1b inserts without them. The follow-up (0074) re-runs the backfill and sets NOT NULL.
--      author_id goes only with a person; the CHECK coalesces, so an id with no kind is refused too.
--   2. The mapping as SQL: app.message_author and app.booking_author, the twins of provenance.ts
--      (provenance-parity.test.ts). A NULL actor means the row's event is missing.
--   3. Triggers, plain (not definer), so current_user is the caller (0068 section 5's shape). Only
--      the client role is held: the service role and the owner may still correct a value.
--   4. Indexes for the record's per-customer reads.
--   5. The backfill, as a function this file runs once and 0074 runs again.
--
-- APPLY ORDER: after 0072 on each project. CI project (ci-project-setup.yml: push-dry-run, then
-- push), then production (MCP apply_migration), then the parity check, then merge 1b. Safe under the
-- running build: the triggers only fill columns it never sends, and the nullable columns accept its
-- inserts. The app that writes author_kind (1b) must never run before this file: a missing column
-- fails every send.
--
-- ROLLBACK (revert the app first; the columns are harmless to the 1a build). Dropping the columns
-- drops recorded authors, so only on an owner decision:
--   drop trigger tasks_stamp_created_by on public.tasks;
--   drop trigger tasks_keep_created_by on public.tasks;
--   drop trigger opportunities_stamp_created_by on public.opportunities;
--   drop trigger notes_author_guard on public.notes;
--   drop function app.keep_created_by(), app.notes_author_guard(), app.backfill_record_provenance(),
--     app.message_author(text, text), app.booking_author(text, boolean);
--   drop index public.bookings_account_contact, public.tasks_account_contact, public.calls_account_contact;
--   alter table public.tasks drop column created_by;
--   alter table public.opportunities drop column created_by;
--   alter table public.messages drop column author_kind, drop column author_id;
--   alter table public.bookings drop column author_kind, drop column author_id;
--   alter table public.form_submissions drop column author_kind;
--
-- ASCII only, no backslash anywhere.

set local lock_timeout = '5s';

-- 1. Columns.
alter table public.tasks add column created_by text;
alter table public.opportunities add column created_by text;

alter table public.messages
  add column author_kind text,
  add column author_id text,
  add constraint messages_author_kind_check
    check (author_kind in ('person', 'ai', 'automation', 'customer', 'import')),
  add constraint messages_author_id_person
    check (author_id is null or coalesce(author_kind = 'person', false));

alter table public.bookings
  add column author_kind text,
  add column author_id text,
  add constraint bookings_author_kind_check
    check (author_kind in ('person', 'ai', 'automation', 'customer', 'import')),
  add constraint bookings_author_id_person
    check (author_id is null or coalesce(author_kind = 'person', false));

alter table public.form_submissions
  add column author_kind text not null default 'customer',
  add constraint form_submissions_author_kind_check check (author_kind in ('customer', 'ai'));

-- 2. The mapping, as SQL. p_actor_type NULL = no event (an emit that failed after its insert).
create function app.message_author(p_actor_type text, p_direction text) returns text
language sql immutable parallel safe set search_path = '' as $$
  select case
    when p_actor_type = 'ai' then 'ai'
    when p_direction = 'inbound' then 'customer'
    when p_actor_type = 'user' then 'person'
    when p_actor_type is null then 'person'
    else 'automation'
  end
$$;

create function app.booking_author(p_actor_type text, p_has_ip boolean) returns text
language sql immutable parallel safe set search_path = '' as $$
  select case
    when p_actor_type = 'ai' then 'ai'
    when p_actor_type = 'system' then 'customer'
    when p_actor_type = 'user' then 'person'
    when coalesce(p_has_ip, false) then 'customer'
    else 'ai'
  end
$$;

-- 3. Triggers. tasks and opportunities reuse 0071's stamp unchanged (a signed-in insert stores its
--    sub, a client value is discarded, the service role stores NULL).
create trigger tasks_stamp_created_by before insert on public.tasks
  for each row execute function app.stamp_created_by();
create trigger opportunities_stamp_created_by before insert on public.opportunities
  for each row execute function app.stamp_created_by();

-- tasks holds a table-wide UPDATE grant for the client role (schema-grants-guard.test.ts), so a
-- signed-in UPDATE could rewrite created_by: put it back. opportunities needs none: its UPDATE grant
-- is a column list (0053 section 5) and created_by is not in it.
create function app.keep_created_by() returns trigger
language plpgsql set search_path = '' as $$
begin
  if current_user = 'authenticated' then
    new.created_by := old.created_by;
  end if;
  return new;
end $$;
create trigger tasks_keep_created_by before update on public.tasks
  for each row execute function app.keep_created_by();

-- notes is IUD for the client role too, and addNote sends author_id from the app. A signed-in insert
-- stores the caller's sub whatever was sent; a signed-in update keeps the stored author. The service
-- role's value is kept (no service path writes notes today).
create function app.notes_author_guard() returns trigger
language plpgsql set search_path = '' as $$
begin
  if current_user = 'authenticated' then
    if tg_op = 'INSERT' then
      new.author_id := nullif(btrim(app.jwt() ->> 'sub'), '');
    else
      new.author_id := old.author_id;
    end if;
  end if;
  return new;
end $$;
create trigger notes_author_guard before insert or update on public.notes
  for each row execute function app.notes_author_guard();

-- 4. Indexes for the record's per-customer reads (notes, messages, opportunities and submissions
--    already have one: 0003, 0005, 0006).
create index bookings_account_contact on public.bookings (account_id, contact_id);
create index tasks_account_contact on public.tasks (account_id, contact_id);
create index calls_account_contact on public.calls (account_id, contact_id);

-- 5. The backfill. Idempotent: it touches only rows still unset, so 0074 runs it again for rows the
--    previous build wrote between this file and 1b's deploy. Returns how many rows each bucket took.
create function app.backfill_record_provenance() returns table (bucket text, row_count bigint)
language plpgsql set search_path = '' as $$
#variable_conflict use_column
begin
  return query
  with ev as (
    select distinct on (e.payload ->> 'messageId')
           e.payload ->> 'messageId' as row_id, e.account_id, e.actor_type, e.actor_id
      from public.events e
     where e.type = 'message.created' and e.payload ->> 'messageId' is not null
     order by e.payload ->> 'messageId', e.id
  ), done as (
    update public.messages m
       set author_kind = app.message_author(ev.actor_type, src.direction),
           author_id = case when app.message_author(ev.actor_type, src.direction) = 'person'
                             and ev.actor_type = 'user'
                            then nullif(btrim(ev.actor_id), '') end
      from public.messages src
      left join ev on ev.row_id = src.id::text and ev.account_id = src.account_id
     where m.id = src.id and m.author_kind is null
    returning src.direction, m.author_kind, ev.actor_type is null as no_event
  )
  select 'messages ' || d.direction || ' ' || d.author_kind
         || case when d.no_event then ' (no event)' else '' end, count(*)
    from done d group by 1;

  return query
  with ev as (
    select distinct on (e.payload ->> 'bookingId')
           e.payload ->> 'bookingId' as row_id, e.account_id, e.actor_type, e.actor_id
      from public.events e
     where e.type = 'booking.created' and e.payload ->> 'bookingId' is not null
     order by e.payload ->> 'bookingId', e.id
  ), done as (
    update public.bookings b
       set author_kind = app.booking_author(ev.actor_type, src.ip_hash is not null),
           author_id = case when ev.actor_type = 'user' then nullif(btrim(ev.actor_id), '') end
      from public.bookings src
      left join ev on ev.row_id = src.id::text and ev.account_id = src.account_id
     where b.id = src.id and b.author_kind is null
    returning b.author_kind, ev.actor_type is null as no_event
  )
  select 'bookings ' || d.author_kind || case when d.no_event then ' (no event)' else '' end, count(*)
    from done d group by 1;

  return query
  with ev as (
    select distinct on (e.payload ->> 'taskId')
           e.payload ->> 'taskId' as row_id, e.account_id, nullif(btrim(e.actor_id), '') as actor_id
      from public.events e
     where e.type = 'task.created' and e.actor_type = 'user' and e.payload ->> 'taskId' is not null
     order by e.payload ->> 'taskId', e.id
  ), done as (
    update public.tasks t set created_by = ev.actor_id
      from ev
     where ev.row_id = t.id::text and ev.account_id = t.account_id and ev.actor_id is not null
       and t.created_by is null and t.call_id is null and t.consent_event_id is null
    returning t.id
  )
  select 'tasks person (from task.created)'::text, count(*) from done;

  return query
  with ev as (
    select distinct on (e.payload ->> 'opportunityId')
           e.payload ->> 'opportunityId' as row_id, e.account_id, nullif(btrim(e.actor_id), '') as actor_id
      from public.events e
     where e.type = 'opportunity.created' and e.actor_type = 'user' and e.payload ->> 'opportunityId' is not null
     order by e.payload ->> 'opportunityId', e.id
  ), done as (
    update public.opportunities o set created_by = ev.actor_id
      from ev
     where ev.row_id = o.id::text and ev.account_id = o.account_id and ev.actor_id is not null
       and o.created_by is null
    returning o.id
  )
  select 'opportunities person (from opportunity.created)'::text, count(*) from done;

  return query
  with done as (
    update public.form_submissions s set author_kind = 'ai'
     where s.author_kind <> 'ai'
       and s.id in (select c.submission_id from public.concierge_conversations c where c.submission_id is not null)
    returning s.id
  )
  select 'form_submissions ai (website chat)'::text, count(*) from done;
end $$;

revoke all on function app.message_author(text, text) from public, anon, authenticated, service_role;
revoke all on function app.booking_author(text, boolean) from public, anon, authenticated, service_role;
revoke all on function app.backfill_record_provenance() from public, anon, authenticated, service_role;
revoke all on function app.keep_created_by() from public, anon;
revoke all on function app.notes_author_guard() from public, anon;
grant execute on function app.keep_created_by() to authenticated, service_role;
grant execute on function app.notes_author_guard() to authenticated, service_role;

-- The first run. Its NOTICEs are the bucket counts the rollout reads (spec section 13 step 1 measured
-- them before apply; these should match).
do $$
declare r record;
begin
  for r in select * from app.backfill_record_provenance() loop
    raise notice 'record provenance backfill: % = %', r.bucket, r.row_count;
  end loop;
end $$;
