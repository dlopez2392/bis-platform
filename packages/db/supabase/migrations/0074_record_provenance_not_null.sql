-- 0074_record_provenance_not_null.sql - every message and booking names who made it, and a To-do's
-- call or consent link is the server's to set (S-03 part 1, PR 1b follow-up)
-- (docs/superpowers/specs/2026-10-12-record-page-design.md sections 5.1 and 13 step 4)
--
--   1. 0073 added messages.author_kind and bookings.author_kind as NULLABLE, because the build before
--      1b inserted without them. 1b is deployed and writes them on every insert (createMessage,
--      createBooking), so: re-run 0073's backfill for any row the previous build wrote in the window
--      (measured 0 on both projects before this file; the re-run is a no-op kept for safety), then
--      close the columns.
--   2. The timeline reads a To-do with tasks.call_id as the AI receptionist's and one with
--      tasks.consent_event_id as an automation's (apps/web/src/lib/record/author-mark.ts). The client
--      role holds table-wide INSERT and UPDATE on tasks (schema-grants-guard.test.ts), so a member
--      could relabel their own To-do by sending either column. Only server code sets them
--      (ensureCallbackTask, ensureConsentTask, both on the service role). A trigger in 0073's shape
--      (plain, not definer, so current_user is the caller) holds the client role: a signed-in insert
--      stores NULL for both, a signed-in update keeps the stored values. The service role and the
--      owner (and an FK's on delete set null, which runs as the table owner) are untouched.
--
-- APPLY ORDER: only after 1b is deployed. CI project (ci-project-setup.yml: push-dry-run, then push),
-- then production (MCP apply_migration), then the parity check, then merge this PR.
--
-- ROLLBACK (before reverting the 1b app, which does not need this):
--   alter table public.messages alter column author_kind drop not null;
--   alter table public.bookings alter column author_kind drop not null;
--   drop trigger tasks_keep_links on public.tasks;
--   drop function app.keep_task_links();
--
-- ASCII only, no backslash anywhere.

set local lock_timeout = '5s';

-- 1. The re-run, then NOT NULL.
do $$
declare r record;
begin
  for r in select * from app.backfill_record_provenance() loop
    raise notice 'record provenance backfill (0074 re-run): % = %', r.bucket, r.row_count;
  end loop;
end $$;

alter table public.messages alter column author_kind set not null;
alter table public.bookings alter column author_kind set not null;

-- 2. A To-do's call and consent links: the client role cannot write them.
create function app.keep_task_links() returns trigger
language plpgsql set search_path = '' as $$
begin
  if coalesce(current_user = 'authenticated', false) then
    if tg_op = 'INSERT' then
      new.call_id := null;
      new.consent_event_id := null;
    else
      new.call_id := old.call_id;
      new.consent_event_id := old.consent_event_id;
    end if;
  end if;
  return new;
end $$;
create trigger tasks_keep_links before insert or update on public.tasks
  for each row execute function app.keep_task_links();

revoke all on function app.keep_task_links() from public, anon;
grant execute on function app.keep_task_links() to authenticated, service_role;
