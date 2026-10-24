-- 0097_one_switch.sql - the one switch (open, closed today, running late, storm) and planned closed days
-- (S-47 part d; F-084; decision 28 as its middle option; owner decisions D1 to D11)
-- (docs/superpowers/specs/2026-10-23-one-switch-design.md section 4;
--  docs/superpowers/plans/2026-10-23-one-switch-pr47d.md, Task 1)
--
-- WHY. Until this file nothing in the product knew that a business was closed for the day, running
-- behind, or shut by a storm, and nothing knew about a holiday: the booking page kept selling, Sofia said
-- the business was open, and every reminder went out on its own timer. One switch per account now says
-- which of four states it is in, a list of planned closed days says when it will be shut, and the app
-- reads both everywhere a customer is answered (owner decisions D1 to D7).
--
-- WHAT THIS FILE ADDS:
--   public.business_status  one row per account, absent = open. state is open, closed_today,
--     running_late or storm; late_minutes (15, 30, 60, or 120 for over an hour) only while running late;
--     until is when the state ends by itself (expiry is computed on read, no cron): midnight in the account
--     zone for closed today (owner decision D12) and running late, midnight starting the back-on date for
--     a dated storm, NULL for open and for a storm until further notice. The reopening said to
--     callers is computed on read from the hours. set_by and set_at are stamped by a trigger from the
--     token, never taken from the request.
--   public.closed_days  planned whole-day closures: a date or a range of at most 92 days, with an
--     optional reason from a fixed list (holiday, vacation, other; never free text, because it reaches
--     the receptionist prompt). created_by and created_at are stamped by a trigger, which also refuses a
--     range that starts more than two days before the UTC date or ends more than 367 days after it (a
--     CHECK may not read the clock; the action enforces the exact window in the account zone).
--   public.calls.business_status  the status each call started under, one code from a closed set; NULL
--     for every call before this file and for one whose status could not be read.
--   public.tasks.closure_kind and public.tasks.closure_on  the link of the one To-do a closure files per
--     account, kind and date (tasks_closure_once), so a second filing is a 23505 the server treats as
--     already filed (the 0080 and 0084 dedupe).
--   public.bookings.closure_kept_at  the owner kept this appointment through a closure, so its reminders
--     are not held.
--   app.business_status_stamp, app.closed_days_stamp (plain plpgsql triggers, not definer), and
--   app.keep_task_links re-created with the two task columns.
--
-- WHO WRITES. business_status: the server creates the one row of an account (ensureBusinessStatusRow,
-- service_role, insert on conflict do nothing, as getOrCreateCalendar does for calendars); a signed-in
-- Owner or the agency then UPDATEs its three columns under RLS, and a Staff member may move only between
-- open and running late (D8; an expired closure counts as open), with an end no more than 26 hours out.
-- closed_days: a signed-in Owner or the agency INSERTs four columns and DELETEs rows; nobody updates one
-- (a change is a remove and an add).
-- calls.business_status: startCallRow, server only. The two task columns: server code only, through
-- service_role (keep_task_links below). bookings.closure_kept_at: keepAppointmentAction, service_role.
--
-- GRANTS AND POLICIES. business_status: everything revoked from public, anon, authenticated and
-- service_role; SELECT to authenticated and service_role; UPDATE (state, late_minutes, until) to
-- authenticated; INSERT to service_role. closed_days: everything revoked; SELECT to authenticated and
-- service_role; INSERT (account_id, starts_on, ends_on, reason) and DELETE to authenticated; INSERT and
-- DELETE to service_role (fixtures and the local sweep). RLS on both. Every member reads (0077 tenant
-- shape, Technicians included, D7). The update policy has an Owner branch (0066 shape) and a Staff branch
-- (D8); the closed_days insert and delete policies have the Owner branch only. Every helper is coalesced
-- and sits in a scalar subquery, so it runs once per statement. The client-write digest moves from
-- 51|0dd3e2d7e19f3f3649a893cfd9967d94 to 52|b66203ca5d355155540b520af510d120: its one new table-level
-- write is authenticated DELETE on closed_days (the column grants do not count there).
--
-- TEARDOWN. Neither table goes in ACCOUNT_OWNED_TABLES (packages/db/src/account-teardown.ts): the
-- account row delete carries both away, and service_role holds no DELETE on business_status.
--
-- LOCKS. The ALTERs take ACCESS EXCLUSIVE on calls, tasks and bookings for the length of this file; the
-- lock_timeout of 5s below is the protection. Every added column is nullable with no default, so no
-- table is rewritten.
--
-- SEARCH PATHS (0096 rule). Every function this file creates or re-creates writes
-- set search_path = pg_catalog, pg_temp, so pg_temp is searched last. No definer function is added, so
-- EXPECTED_DEFINERS in definer-search-path.test.ts does not change.
--
-- APPLY ORDER: after 0096 everywhere. CI project (ci-project-setup.yml: push-dry-run, then push), then
-- production (MCP apply_migration, once), then the parity check, then merge.
-- LOAD-BEARING: PostgREST refuses a request naming a column or table it does not know, and the build
-- after this file names them on every slot computation (the booking page, its move flow and three
-- receptionist tools), every in-account navigation (the shell reads business_status), every call start,
-- every chat turn, the browser voice demo, every call page, every To do page and the dashboard work
-- count, every cron tick, the Calendar page and every Voice page knowledge save.
-- SAFE UNDER THE RUNNING BUILD: additive. The running build names none of these objects; the new columns
-- are nullable with no default, and the re-created keep_task_links nulls two columns that build never
-- sends.
--
-- ROLLBACK (roll the app back first), in this order. Dropping either table loses every planned closed
-- day and the current switch, and dropping calls.business_status loses what each call was told: each of
-- those is an owner decision.
--   re-create app.keep_task_links() exactly as 0084 wrote it, with set search_path = pg_catalog, pg_temp
--     (FIRST: it names the two task columns, and every task insert fails once they are gone);
--   drop index public.tasks_closure_once;
--   alter table public.tasks drop constraint tasks_closure_coherent, drop column closure_on,
--     drop column closure_kind;   (lost: each closure To-do link; the To-dos stay as plain To-dos)
--   alter table public.bookings drop column closure_kept_at;   (lost: which appointments were kept)
--   alter table public.calls drop column business_status;   (owner decision)
--   drop table public.closed_days;   (owner decision; its trigger goes too)
--   drop table public.business_status;   (owner decision; its trigger goes too)
--   drop function app.closed_days_stamp();
--   drop function app.business_status_stamp();
--
-- ASCII only, no backslash anywhere, and every dollar sign in this file is part of a dollar-quote pair.

-- 0. Fail fast instead of queueing behind a long lock (0094 reason: inside a do block, so it is always in
--    the block transaction).
do $$
begin
  perform pg_catalog.set_config('lock_timeout', '5s', true);
end $$;

-- 1. The switch.
create table public.business_status (
  account_id uuid primary key references public.accounts(id) on delete cascade,
  state text not null default 'open'
    constraint business_status_state_check check (state in ('open', 'closed_today', 'running_late', 'storm')),
  late_minutes integer
    constraint business_status_late_minutes_check check (late_minutes in (15, 30, 60, 120)),
  until timestamptz,
  set_by text not null default 'system',
  set_at timestamptz not null default now(),
  constraint business_status_shape_check check (
    (state = 'open' and late_minutes is null and until is null)
    or (state = 'closed_today' and late_minutes is null and until is not null)
    or (state = 'running_late' and late_minutes is not null and until is not null)
    or (state = 'storm' and late_minutes is null)),
  constraint business_status_until_check check (
    until is null or (until > set_at and until <= set_at + interval '100 days'))
);

create function app.business_status_stamp() returns trigger
language plpgsql set search_path = pg_catalog, pg_temp as $$
declare
  v_sub text := app.jwt() ->> 'sub';
begin
  new.set_at := pg_catalog.now();
  new.set_by := case when pg_catalog.length(v_sub) > 0 then v_sub else 'system' end;
  return new;
end $$;
create trigger business_status_stamp before insert or update on public.business_status
  for each row execute function app.business_status_stamp();
revoke all on function app.business_status_stamp() from public, anon;
grant execute on function app.business_status_stamp() to authenticated, service_role;

-- 2. Planned closed days.
create table public.closed_days (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  starts_on date not null,
  ends_on date not null,
  reason text
    constraint closed_days_reason_check check (reason is null or reason in ('holiday', 'vacation', 'other')),
  created_by text not null,
  created_at timestamptz not null default now(),
  constraint closed_days_range_check check (ends_on >= starts_on and ends_on - starts_on <= 91)
);
create index closed_days_account_ends on public.closed_days (account_id, ends_on);

create function app.closed_days_stamp() returns trigger
language plpgsql set search_path = pg_catalog, pg_temp as $$
declare
  v_sub text := app.jwt() ->> 'sub';
begin
  if new.starts_on < current_date - 2 or new.ends_on > current_date + 367 then
    raise exception 'closed_days: a closed day must not start in the past or end more than a year ahead'
      using errcode = '23514';
  end if;
  new.created_at := pg_catalog.now();
  new.created_by := case when pg_catalog.length(v_sub) > 0 then v_sub else 'system' end;
  return new;
end $$;
create trigger closed_days_stamp before insert on public.closed_days
  for each row execute function app.closed_days_stamp();
revoke all on function app.closed_days_stamp() from public, anon;
grant execute on function app.closed_days_stamp() to authenticated, service_role;

-- 3. What each call was told.
alter table public.calls
  add column business_status text
    constraint calls_business_status_check check (business_status in ('open', 'closed_today', 'running_late_15',
      'running_late_30', 'running_late_60', 'running_late_120', 'storm', 'closed_day'));

-- 4. The closure To-do link, once per account, kind and date.
alter table public.tasks
  add column closure_kind text
    constraint tasks_closure_kind_check check (closure_kind in ('status', 'closed_day')),
  add column closure_on date;
alter table public.tasks add constraint tasks_closure_coherent
  check ((closure_kind is null) = (closure_on is null));
create unique index tasks_closure_once on public.tasks (account_id, closure_kind, closure_on)
  where closure_kind is not null;

-- 5. An appointment the owner kept through a closure.
alter table public.bookings add column closure_kept_at timestamptz;

-- 6. Only server code sets or changes a To-do link (0074 guard, extended by 0080 and 0084, now by 0097;
--    create or replace keeps its ACL and the tasks_keep_links trigger).
create or replace function app.keep_task_links() returns trigger
language plpgsql set search_path = pg_catalog, pg_temp as $$
begin
  if coalesce(current_user = 'authenticated', false) then
    if tg_op = 'INSERT' then
      new.call_id := null;
      new.consent_event_id := null;
      new.document_request_id := null;
      new.document_request_kind := null;
      new.document_expiry_id := null;
      new.document_expiry_on := null;
      new.closure_kind := null;
      new.closure_on := null;
    else
      new.call_id := old.call_id;
      new.consent_event_id := old.consent_event_id;
      new.document_request_id := old.document_request_id;
      new.document_request_kind := old.document_request_kind;
      new.document_expiry_id := old.document_expiry_id;
      new.document_expiry_on := old.document_expiry_on;
      new.closure_kind := old.closure_kind;
      new.closure_on := old.closure_on;
    end if;
  end if;
  return new;
end $$;

-- 7. Grants.
revoke all on public.business_status from public, anon, authenticated, service_role;
grant select on public.business_status to authenticated, service_role;
grant update (state, late_minutes, until) on public.business_status to authenticated;
grant insert on public.business_status to service_role;

revoke all on public.closed_days from public, anon, authenticated, service_role;
grant select on public.closed_days to authenticated, service_role;
grant insert (account_id, starts_on, ends_on, reason), delete on public.closed_days to authenticated;
grant insert, delete on public.closed_days to service_role;

-- 8. Row level security.
alter table public.business_status enable row level security;
alter table public.closed_days enable row level security;

create policy business_status_member_read on public.business_status for select to authenticated
  using (app.is_agency() or account_id = app.current_account_id());

-- USING reads the row as it is (the old state), WITH CHECK the row as written (the new state). Staff may
-- move only between open and running late, never to a closure and never out of one in force; an expired
-- closure (until passed; an open-ended storm never qualifies) already reads as open everywhere. A Staff
-- running late may end no more than 26 hours out (the app always writes the end of today).
create policy business_status_update on public.business_status for update to authenticated
  using (
    (select coalesce(app.is_agency(), false))
    or (account_id = (select app.current_account_id())
        and ((select app.is_account_owner(app.current_account_id()))
             or ((select coalesce(app.account_role(app.current_account_id()) = 'staff', false))
                 and (state in ('open', 'running_late')
                      or (until is not null and until <= now()))))))
  with check (
    (select coalesce(app.is_agency(), false))
    or (account_id = (select app.current_account_id())
        and ((select app.is_account_owner(app.current_account_id()))
             or ((select coalesce(app.account_role(app.current_account_id()) = 'staff', false))
                 and state in ('open', 'running_late')
                 and (state = 'open' or until <= now() + interval '26 hours')))));

create policy closed_days_member_read on public.closed_days for select to authenticated
  using (app.is_agency() or account_id = app.current_account_id());
create policy closed_days_owner_insert on public.closed_days for insert to authenticated
  with check (
    (select coalesce(app.is_agency(), false))
    or (account_id = (select app.current_account_id())
        and (select app.is_account_owner(app.current_account_id()))));
create policy closed_days_owner_delete on public.closed_days for delete to authenticated
  using (
    (select coalesce(app.is_agency(), false))
    or (account_id = (select app.current_account_id())
        and (select app.is_account_owner(app.current_account_id()))));

-- 9. Comments: who writes each, through what, and what NULL means.
comment on table public.business_status is
  'The one switch of an account (S-47d, F-084). One row per account; no row means open. Created by the server (ensureBusinessStatusRow, service_role); its state, late_minutes and until are UPDATEd by a signed-in Owner or the agency, or by Staff between open and running late (policy business_status_update). Expiry is computed on read: a row whose until has passed reads as open. History is the business_status.changed events, not this row.';
comment on column public.business_status.account_id is 'The account this switch belongs to. Written once, by ensureBusinessStatusRow (service_role).';
comment on column public.business_status.state is 'open, closed_today, running_late or storm. Written by setBusinessStatusAction and its Undo through the signed-in client.';
comment on column public.business_status.late_minutes is 'How far behind while running late: 15, 30, 60, or 120 for over an hour (D11). NULL in every other state.';
comment on column public.business_status.until is 'When the state ends by itself, computed by the server when the switch is set: midnight at the end of the day in the account zone for closed_today (owner decision D12) and for running_late, midnight starting the back-on date in the account zone for a dated storm. NULL for open and for a storm until further notice. The reopening said to callers is computed on read from the hours.';
comment on column public.business_status.set_by is 'The Clerk user id from the token of whoever set it, or system for a server write. Stamped by app.business_status_stamp; anything sent is ignored.';
comment on column public.business_status.set_at is 'When it was last set. Stamped by app.business_status_stamp; the Undo compares it (compare-and-set).';
comment on table public.closed_days is
  'Planned whole-day closures of an account (S-47d, D5): the booking page offers no time on them and the receptionist says so. Added and removed by a signed-in Owner or the agency (addClosedDayAction, removeClosedDayAction); never updated. Fixtures and the local sweep write through service_role.';
comment on column public.closed_days.id is 'Row id.';
comment on column public.closed_days.account_id is 'The account. Sent by the signed-in insert; policy closed_days_owner_insert binds it to the token account.';
comment on column public.closed_days.starts_on is 'The first closed date, in the account time zone.';
comment on column public.closed_days.ends_on is 'The last closed date, in the account time zone; equal to starts_on for one day. At most 92 days in all.';
comment on column public.closed_days.reason is 'holiday, vacation or other; NULL when none was given. A fixed list, never free text, because it reaches the receptionist prompt.';
comment on column public.closed_days.created_by is 'The Clerk user id from the token, or system. Stamped by app.closed_days_stamp.';
comment on column public.closed_days.created_at is 'Stamped by app.closed_days_stamp.';
comment on column public.calls.business_status is
  'The status this call started under (S-47d, S6): open, closed_today, running_late_15, running_late_30, running_late_60, running_late_120, storm or closed_day. Stamped by startCallRow, server only. NULL for a call before 0097 and for one whose status could not be read.';
comment on column public.tasks.closure_kind is
  'status (a Closed today or Storm switch) or closed_day: this To-do lists the appointments a closure covers. Set only by server code (service_role); a signed-in insert stores NULL and a signed-in update keeps it (app.keep_task_links). NULL for every other To-do.';
comment on column public.tasks.closure_on is
  'The date the closure To-do was filed for: today in the account zone for status, the first closed date for closed_day. NULL exactly when closure_kind is NULL (tasks_closure_coherent).';
comment on column public.bookings.closure_kept_at is
  'When an Owner, Staff member or the agency kept this appointment through a closure (keepAppointmentAction, service_role), so its reminders, confirmations and follow-ups are not held. NULL when nobody kept it.';
