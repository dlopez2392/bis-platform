-- 0107_calendar_agenda.sql - staff put phoned-in jobs on the calendar (F-046 part 1)
-- (docs/superpowers/specs/2026-10-30-calendar-agenda-design.md sections 3, 4 and 7;
--  docs/superpowers/plans/2026-10-30-calendar-agenda.md Task 1)
--
-- WHY. Nothing on the dashboard writes a booking, and the database refuses every overlap: 0016's
-- bookings_no_overlap binds every live row. The owner's rulings (spec section 2): a job staff book may
-- overlap other bookings (R1) and still blocks that time for customers (R2); the overlap rule narrows
-- to customer-made rows, a check refuses a customer-made row over any live booking, and every booking
-- write locks its calendar row (R11). Staff-made is author_kind = 'person' (0073).
--
-- WHAT THIS FILE ADDS:
--   bookings.place_id         the job's address, one of the account's places (composite FK onto
--                             places (account_id, id), NO ACTION: a job's address cannot vanish).
--   bookings.meeting_type     in_person | phone | video. NULL means the calendar's own type, which is
--                             what every earlier row means; readers coalesce with calendars.meeting_type.
--   bookings.hold_until       a staff add or move: the end of its Undo window plus the grace.
--   bookings.hold_settled_at  the one claim on that hold (the after() job or the jobHolds cron pass).
--   bookings.notice_wanted    'confirmation' | 'moved' | NULL: the email the settle sends.
--   bookings.notice_sent_at   stamped after the email gate answered SENT.
--   Five CHECKs and one FK on them; indexes bookings_place, bookings_hold_due, bookings_staff_live.
--   bookings_no_overlap, re-added under the same name: live customer-made rows only.
--   app.bookings_slot_guard() and its trigger: every live-booking write waits on its calendar row, and a
--     customer-made live row overlapping a live staff job is refused 23P01 (exclusion_violation), which
--     createBooking, setBookingStatus, moveBooking and undo_ai_booking_act already map.
--   public.undo_staff_move(...): the Undo of a staff move in one transaction, calendar row locked FIRST.
--   public.undo_ai_booking_act, replaced with one added statement: it locks the calendar row right after
--     its ai_acts lock. Its reschedule branch deletes one booking and then restores another; taking the
--     calendar lock only at the restore (the trigger) deadlocks with a customer insert that took it first
--     and then waits on the uncommitted delete (plan review 2026-10-30, item 1). Body, search_path,
--     SECURITY INVOKER and grants are otherwise exactly 0091's as 0096 left them.
--
-- WHO WRITES. Only service_role, as since 0053: the Calendar page's agenda actions, their after() job
-- and the cron pass write the new columns after their own checks.
--
-- GRANTS. No table grant changes: authenticated keeps its table-level SELECT on bookings and so reads
-- the new columns; it writes nothing. EXPECTED_WRITES (schema-grants-guard.test.ts) and the client-write
-- digest (proposals-drop.test.ts) are unchanged. undo_staff_move: EXECUTE to service_role only.
--
-- SEARCH PATHS (0096 rule). Both functions set search_path = pg_catalog, pg_temp. app.bookings_slot_guard
-- is SECURITY DEFINER (a check run under a caller's RLS fails OPEN for a future client writer whose policy
-- hides a staff job) and joins EXPECTED_DEFINERS (definer-search-path.test.ts, 36 -> 37).
-- undo_staff_move is SECURITY INVOKER, 0091's undo_ai_booking_act shape.
--
-- LOCKS. Dropping and re-adding the exclusion constraint and building bookings_staff_live take ACCESS
-- EXCLUSIVE on bookings for two small gist builds; the FK takes SHARE ROW EXCLUSIVE on places.
-- lock_timeout 5s. ASSUMPTION: production holds a few hundred bookings at most (33 on 2026-10-08, 0061's
-- note); the orchestrator reads the count before applying.
--
-- APPLY ORDER: after 0106 everywhere. CI project (ci-project-setup.yml: push-dry-run, then push), then
-- production (MCP apply_migration, name calendar_agenda), then the parity check, then merge.
-- LOAD-BEARING: from the agenda's first build on, the app names every new column and calls
-- undo_staff_move, so production gets this file BEFORE the merge deploy.
-- ONE TRANSACTION. ASSUMPTION: MCP apply_migration runs the file as one transaction (the replica runs it with
-- psql -1). The constraint swap does not rely on it: its drop and re-add are ONE ALTER TABLE statement, so no
-- moment exists without an overlap rule. A partial apply would leave columns without their trigger or functions,
-- which the running build never names; the orchestrator confirms the whole file applied (checklist step 7).
-- SAFE UNDER THE RUNNING BUILD: its customer rows meet the same exclusion constraint as before plus a
-- trigger that finds no live staff job to collide with; its person-made rows (the demo seed, whose slots
-- never overlap) gain only the freedom to overlap.
--
-- ROLLBACK (roll the app back first). 0016's constraint cannot be re-added while two live rows overlap.
-- List them first:
--   select a.id, b.id from public.bookings a join public.bookings b
--     on a.calendar_id = b.calendar_id and a.id < b.id
--    where a.status = 'booked' and b.status = 'booked'
--      and tstzrange(a.starts_at, a.ends_at) && tstzrange(b.starts_at, b.ends_at);
-- and the owner decides each pair (cancel one, or keep 0107). Then:
--   drop trigger bookings_slot_guard on public.bookings;
--   drop function app.bookings_slot_guard();
--   drop function public.undo_staff_move(uuid, uuid, uuid, timestamptz, timestamptz);
--   (undo_ai_booking_act keeps its added calendar lock: harmless without the trigger.)
--   drop index public.bookings_staff_live, public.bookings_place, public.bookings_hold_due;
--   alter table public.bookings drop constraint bookings_no_overlap;
--   alter table public.bookings drop column place_id, drop column meeting_type, drop column hold_until,
--     drop column hold_settled_at, drop column notice_wanted, drop column notice_sent_at;
--   alter table public.bookings add constraint bookings_no_overlap
--     exclude using gist (calendar_id with =, tstzrange(starts_at, ends_at) with &&) where (status = 'booked');
--
-- ASCII only, no backslash anywhere, and every dollar sign in this file is part of a dollar-quote pair.

-- 0. Fail fast instead of queueing behind a long lock (0094 reason: inside a do block).
do $$
begin
  perform pg_catalog.set_config('lock_timeout', '5s', true);
end $$;

-- 1. The columns and their rules.
alter table public.bookings
  add column place_id uuid,
  add column meeting_type text,
  add column hold_until timestamptz,
  add column hold_settled_at timestamptz,
  add column notice_wanted text,
  add column notice_sent_at timestamptz,
  add constraint bookings_meeting_type_check
    check (meeting_type is null or meeting_type in ('in_person', 'phone', 'video')),
  add constraint bookings_place_fkey foreign key (account_id, place_id)
    references public.places (account_id, id),
  add constraint bookings_hold_staff_only check (hold_until is null or author_kind = 'person'),
  add constraint bookings_hold_settled_pair check (hold_settled_at is null or hold_until is not null),
  add constraint bookings_notice_wanted_check
    check (notice_wanted is null or (notice_wanted in ('confirmation', 'moved') and hold_until is not null)),
  add constraint bookings_notice_sent_after check (notice_sent_at is null or hold_settled_at is not null);

create index bookings_place on public.bookings (place_id) where place_id is not null;
create index bookings_hold_due on public.bookings (hold_until)
  where hold_until is not null and hold_settled_at is null;

comment on column public.bookings.place_id is
  'F-046: the job address, one of this account''s places. NULL = none. NO ACTION: a place a job names is archived, never deleted (removePlace).';
comment on column public.bookings.meeting_type is
  'F-046: in_person, phone or video for this booking. NULL = the calendar''s meeting_type; readers coalesce.';
comment on column public.bookings.hold_until is
  'F-046: a staff add or move, the end of its Undo window plus grace. Due-lists skip a row whose hold is still open.';
comment on column public.bookings.hold_settled_at is
  'F-046: the one claim on the hold (claimJobHold): the after() job or the jobHolds pass. The Undo deletes only while this is NULL.';

-- 2. The overlap rule: the constraint for customer-made rows, the trigger for customer against staff.
-- ONE statement: the drop and the re-add are atomic even if the apply were not one transaction.
alter table public.bookings
  drop constraint bookings_no_overlap,
  add constraint bookings_no_overlap
  exclude using gist (calendar_id with =, tstzrange(starts_at, ends_at) with &&)
  where (status = 'booked' and author_kind <> 'person');
create index bookings_staff_live on public.bookings
  using gist (calendar_id, tstzrange(starts_at, ends_at))
  where status = 'booked' and author_kind = 'person';

create function app.bookings_slot_guard() returns trigger
language plpgsql security definer set search_path = pg_catalog, pg_temp as $$
begin
  if new.status <> 'booked' then
    return new;
  end if;
  -- R11: every live-booking write on this calendar waits here, so the check below always sees a staff
  -- job that committed first. FOR NO KEY UPDATE does not conflict with the FOR KEY SHARE an FK check
  -- into calendars takes. The exists below is a new statement, so it reads a snapshot taken after the
  -- lock was granted (READ COMMITTED).
  perform 1 from public.calendars c where c.id = new.calendar_id for no key update;
  if new.author_kind <> 'person' and exists (
       select 1 from public.bookings b
        where b.calendar_id = new.calendar_id and b.status = 'booked' and b.id <> new.id
          and b.author_kind = 'person'
          and tstzrange(b.starts_at, b.ends_at) && tstzrange(new.starts_at, new.ends_at)) then
    raise exception 'bookings_no_overlap: overlaps a job staff booked' using errcode = 'exclusion_violation';
  end if;
  return new;
end $$;
comment on function app.bookings_slot_guard() is
  'F-046 (0107): locks the calendar row for every live-booking write, and refuses (23P01) a customer-made live row overlapping a live staff job.';
create trigger bookings_slot_guard
  before insert or update of status, starts_at, ends_at, calendar_id, author_kind on public.bookings
  for each row execute function app.bookings_slot_guard();
revoke all on function app.bookings_slot_guard() from public, anon, authenticated;

-- 3. The Undo of a staff move (0091's reschedule branch for a staff move). Answers undone, gone,
--    too_late (the hold settled: the moved email went or is going), time_taken (the old row could not
--    come back over a staff job), changed.
create function public.undo_staff_move(
  p_account_id uuid, p_new_id uuid, p_old_id uuid, p_cancelled_at timestamptz, p_now timestamptz)
returns text
language plpgsql
security invoker
set search_path = pg_catalog, pg_temp
as $$
declare
  v_n integer;
  v_settled timestamptz;
begin
  -- The calendar row FIRST, before the delete: the restore below fires bookings_slot_guard, which takes
  -- this lock; taken only there, it deadlocks with a customer insert holding it and waiting on our delete.
  perform 1 from public.calendars c where c.account_id = p_account_id for no key update;
  begin
    delete from public.bookings b
     where b.account_id = p_account_id and b.id = p_new_id and b.status = 'booked'
       and b.rescheduled_from_id = p_old_id and b.author_kind = 'person'
       and b.hold_until is not null and b.hold_settled_at is null
       and not exists (select 1 from public.bookings r
                        where r.account_id = p_account_id and r.rescheduled_from_id = p_new_id);
    get diagnostics v_n = row_count;
    if v_n = 0 then
      raise exception 'undo_staff_move: the new booking cannot be taken back' using errcode = 'ZA003';
    end if;
    update public.bookings b set status = 'booked', updated_at = p_now
     where b.account_id = p_account_id and b.id = p_old_id and b.status = 'cancelled'
       and b.updated_at = p_cancelled_at;
    get diagnostics v_n = row_count;
    if v_n = 0 then
      raise exception 'undo_staff_move: the old booking changed' using errcode = 'ZA004';
    end if;
  exception
    when exclusion_violation then
      return 'time_taken';
    when sqlstate 'ZA004' then
      return 'changed';
    when sqlstate 'ZA003' then
      select b.hold_settled_at into v_settled
        from public.bookings b where b.account_id = p_account_id and b.id = p_new_id;
      if not found then
        return 'gone';
      end if;
      if v_settled is not null then
        return 'too_late';
      end if;
      return 'changed';
  end;
  return 'undone';
end;
$$;
comment on function public.undo_staff_move(uuid, uuid, uuid, timestamptz, timestamptz) is
  'F-046 (0107): the Undo of a staff move. Deletes the new row while its hold is unsettled and restores the old row by the move''s own version, in one transaction. Service role only.';
revoke all on function public.undo_staff_move(uuid, uuid, uuid, timestamptz, timestamptz) from public, anon, authenticated, service_role;
grant execute on function public.undo_staff_move(uuid, uuid, uuid, timestamptz, timestamptz) to service_role;

-- 4. undo_ai_booking_act (0091, search_path as 0096 left it): the same body with ONE added statement, the
--    calendar lock right after the act lock and before any booking write (item 1 of the plan review).
--    SECURITY INVOKER, volatile, EXECUTE service_role only: create or replace keeps the grants and comment.
create or replace function public.undo_ai_booking_act(p_account_id uuid, p_act_id uuid, p_by text, p_now timestamptz)
returns text
language plpgsql
security invoker
set search_path = pg_catalog, pg_temp
as $$
declare
  v_kind text;
  v_undone timestamptz;
  v_target jsonb;
  v_before jsonb;
  v_after jsonb;
  v_id uuid;
  v_from uuid;
  v_status text;
  v_starts timestamptz;
  v_n integer;
begin
  select a.kind, a.undone_at, a.target, a.before, a.after
    into v_kind, v_undone, v_target, v_before, v_after
    from public.ai_acts a
   where a.account_id = p_account_id and a.id = p_act_id
   for update;
  if not found then
    return 'gone';
  end if;
  if v_kind not in ('booking_created', 'booking_rescheduled', 'booking_cancelled') then
    raise exception 'undo_ai_booking_act: not a booking act: %', p_act_id using errcode = '22023';
  end if;
  if v_undone is not null then
    return 'already_undone';
  end if;
  -- 0107: the calendar row before any booking write (bookings_slot_guard takes it on the restore below;
  -- taken only there, the reschedule branch deadlocks with a customer insert waiting on its delete).
  perform 1 from public.calendars c where c.account_id = p_account_id for no key update;
  v_id := (v_target ->> 'bookingId')::uuid;

  if v_kind = 'booking_created' then
    update public.bookings b set status = 'cancelled', updated_at = p_now
     where b.account_id = p_account_id and b.id = v_id and b.status = 'booked' and b.starts_at > p_now;
    get diagnostics v_n = row_count;
    if v_n = 0 then
      select b.status, b.starts_at into v_status, v_starts
        from public.bookings b where b.account_id = p_account_id and b.id = v_id;
      if not found then
        return 'gone';
      end if;
      if v_status <> 'booked' then
        return 'already_cancelled';
      end if;
      return 'already_happened';
    end if;

  elsif v_kind = 'booking_cancelled' then
    begin
      update public.bookings b set status = 'booked', updated_at = p_now
       where b.account_id = p_account_id and b.id = v_id and b.status = 'cancelled'
         and b.updated_at = (v_after ->> 'version')::timestamptz
         and b.starts_at > p_now
         and not exists (select 1 from public.bookings r
                          where r.account_id = p_account_id and r.rescheduled_from_id = v_id);
      get diagnostics v_n = row_count;
    exception when exclusion_violation then
      return 'time_taken';
    end;
    if v_n = 0 then
      select b.status, b.starts_at into v_status, v_starts
        from public.bookings b where b.account_id = p_account_id and b.id = v_id;
      if not found then
        return 'gone';
      end if;
      if v_status = 'booked' then
        return 'rebooked';
      end if;
      if v_starts <= p_now then
        return 'time_passed';
      end if;
      return 'changed';
    end if;

  else
    v_from := (v_target ->> 'fromBookingId')::uuid;
    begin
      delete from public.bookings b
       where b.account_id = p_account_id and b.id = v_id and b.status = 'booked' and b.starts_at > p_now
         and not exists (select 1 from public.bookings r
                          where r.account_id = p_account_id and r.rescheduled_from_id = v_id);
      get diagnostics v_n = row_count;
      if v_n = 0 then
        raise exception 'undo_ai_booking_act: the new booking changed' using errcode = 'ZA001';
      end if;
      update public.bookings b set status = 'booked', updated_at = p_now
       where b.account_id = p_account_id and b.id = v_from and b.status = 'cancelled'
         and b.updated_at = (v_before ->> 'version')::timestamptz
         and b.starts_at > p_now;
      get diagnostics v_n = row_count;
      if v_n = 0 then
        raise exception 'undo_ai_booking_act: the old booking changed' using errcode = 'ZA002';
      end if;
    exception
      when exclusion_violation then
        return 'old_time_taken';
      when sqlstate 'ZA001' then
        return 'changed';
      when sqlstate 'ZA002' then
        return 'changed';
    end;
  end if;

  update public.ai_acts a set undone_at = p_now, undone_by = p_by
   where a.account_id = p_account_id and a.id = p_act_id;
  return 'undone';
end;
$$;
