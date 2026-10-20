-- 0091_ai_acts.sql - Sofia's live acts, visible and reversible; who created each contact
-- (first release item 8, part 8c; F-022)
-- (docs/superpowers/specs/2026-10-19-ai-acts-reversible-design.md sections 4 and 5.3;
--  docs/superpowers/plans/2026-10-19-ai-acts-reversible-pr8c.md, "The model" and Task 1)
--
-- Every act Sofia (the phone receptionist) or the web chat takes live, with no person approving it, gets
-- one ai_acts row: what she did, from which call or chat, to which customer, what was there before and
-- what she wrote. The app writes it through the service role only; a client reads it like proposals
-- (0088): members of the account or the agency, a Technician only for a customer they can read. What was
-- acted on never changes after insert; only the undo columns move.
--
-- Three functions hold each still-safe check and its write in ONE transaction, so a race can never undo
-- twice or clobber a later change: the booking undo (a compare-and-swap per kind), the contact-created
-- check (which tables hold anything that is not Sofia's own call or chat), and the contact-created delete
-- (lock, then check on a fresh snapshot, then delete: 0083's delete_empty_conversations shape).
--
-- contacts gain author_kind/author_id (0073's shape on messages and bookings): who created the contact,
-- from the five provenance kinds. Existing contacts are backfilled from their first contact.created event;
-- the NOTICEs at the end of section 4 are the bucket counts the rollout compares with Task 0's reads.
--
-- APPLY ORDER: CI project (ci-project-setup.yml: push-dry-run, then push), then production (MCP
-- apply_migration, once), then the parity check, then merge. The migration goes BEFORE the code.
-- SAFE UNDER THE RUNNING BUILD: additive. Nothing in the running build reads or writes ai_acts or the three
-- functions. The two contact columns are nullable, so the running build's inserts land without them; the
-- guard only rewrites a signed-in insert's pair, which the running build never sends, and holds a signed-in
-- update's pair, which its column UPDATE grant (0053) already excludes. The new unique key on
-- concierge_conversations is redundant as a uniqueness rule (id is the primary key) and changes no write.
--
-- ROLLBACK (roll the app back first), in this order:
--   drop function public.undo_ai_contact_created(uuid, uuid);
--   drop function public.ai_contact_held_by(uuid, uuid);
--   drop function public.undo_ai_booking_act(uuid, uuid, text, timestamptz);
--   drop trigger contacts_author_guard on public.contacts;
--   drop function app.contacts_author_guard();
--   drop function app.backfill_contact_authors();
--   drop function app.contact_author(text, text);
--   drop table public.ai_acts;            (its trigger, index and policies go with it; the acts are lost)
--   drop function app.ai_acts_act_is_fixed();
--   alter table public.concierge_conversations drop constraint concierge_conversations_account_id_id_key;
--   Only on an owner decision, because it drops every recorded author:
--   alter table public.contacts drop column author_kind, drop column author_id;
--
-- ASCII only, no backslash anywhere.

-- 0. Fail fast instead of queueing behind a long lock. Inside a do block (0088's reason): on PostgreSQL 17
--    a bare SET LOCAL as a later statement of a multi-statement string is not guaranteed to be inside a
--    transaction block; inside a do block it always runs in the block's transaction.
do $$
begin
  perform pg_catalog.set_config('lock_timeout', '5s', true);
end $$;

-- 1. The web chat's (account_id, id), so an act can carry its account in its chat FK (0082's precedent).
alter table public.concierge_conversations
  add constraint concierge_conversations_account_id_id_key unique (account_id, id);

-- 2. The table.
create table public.ai_acts (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  actor text not null constraint ai_acts_actor_check check (actor in ('voice', 'webchat')),
  call_id uuid,
  -- A concierge_conversations id: the web chat that acted.
  chat_id uuid,
  contact_id uuid not null,
  kind text not null constraint ai_acts_kind_check check (kind in (
    'booking_created', 'booking_rescheduled', 'booking_cancelled', 'contact_created', 'contact_field_filled')),
  target jsonb not null,
  before jsonb,
  after jsonb,
  undone_at timestamptz,
  -- A Clerk user id. Not an FK (0040's reason).
  undone_by text,
  undo_notified boolean not null default false,
  created_at timestamptz not null default now(),
  -- Exactly one source, the one the actor names.
  constraint ai_acts_source check ((actor = 'voice') = (call_id is not null) and (actor = 'webchat') = (chat_id is not null)),
  constraint ai_acts_undone_pair check ((undone_at is null) = (undone_by is null)),
  constraint ai_acts_notified_when_undone check (not undo_notified or undone_at is not null),
  constraint ai_acts_call_fkey foreign key (account_id, call_id)
    references public.calls (account_id, id) on delete cascade,
  constraint ai_acts_chat_fkey foreign key (account_id, chat_id)
    references public.concierge_conversations (account_id, id) on delete cascade,
  constraint ai_acts_contact_fkey foreign key (account_id, contact_id)
    references public.contacts (account_id, id) on delete cascade
);
comment on table public.ai_acts is
  'Acts Sofia or the web chat took live, one row each (0091). Server-written only; authenticated reads a '
  'row when it reads the account and, for a Technician, the row''s customer. What was acted on never '
  'changes; only undone_at, undone_by and undo_notified move.';

-- What was acted on never changes, from any role; only the undo columns move.
create function app.ai_acts_act_is_fixed() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.id is distinct from old.id or new.account_id is distinct from old.account_id
     or new.actor is distinct from old.actor or new.call_id is distinct from old.call_id
     or new.chat_id is distinct from old.chat_id or new.contact_id is distinct from old.contact_id
     or new.kind is distinct from old.kind or new.target is distinct from old.target
     or new.before is distinct from old.before or new.after is distinct from old.after
     or new.created_at is distinct from old.created_at then
    raise exception 'ai_acts_act_is_fixed' using errcode = 'P0001';
  end if;
  return new;
end $$;
revoke all on function app.ai_acts_act_is_fixed() from public, anon, authenticated, service_role;
create trigger ai_acts_act_is_fixed before update on public.ai_acts
  for each row execute function app.ai_acts_act_is_fixed();

-- The record's timeline read (the 0088 cursor shape). No target index: every still-safe read goes by the
-- act's id or by a booking id.
create index ai_acts_contact_timeline on public.ai_acts (account_id, contact_id, created_at desc, id desc);

-- Who reads: the account's members (or the agency); a Technician only for a customer they can read.
-- Who writes: service_role only.
alter table public.ai_acts enable row level security;
revoke all on public.ai_acts from anon, authenticated;
grant select on public.ai_acts to authenticated;
grant select, insert, update, delete on public.ai_acts to service_role;
create policy ai_acts_member_read on public.ai_acts for select to authenticated
  using (app.is_agency() or account_id = app.current_account_id());
create policy ai_acts_technician_scope on public.ai_acts as restrictive for select to authenticated
  using ((select app.sees_all_customers(app.current_account_id()))
         or exists (select 1 from public.contacts c where c.id = ai_acts.contact_id));

-- 3. Who created each contact. Nullable (0073's shape): the running build inserts without them; a later
--    file re-runs the backfill and sets NOT NULL. author_id goes only with a person, and the CHECK
--    coalesces, so an id with no kind is refused too.
alter table public.contacts
  add column author_kind text,
  add column author_id text,
  add constraint contacts_author_kind_check
    check (author_kind in ('person', 'ai', 'automation', 'customer', 'import')),
  add constraint contacts_author_id_person
    check (author_id is null or coalesce(author_kind = 'person', false));

-- The mapping, as SQL: the twin of contactAuthor (packages/db/src/provenance.ts), pinned by
-- provenance-parity.test.ts. The two seeds' actor ids are imports whatever their actor type (owner, Q1);
-- any other system actor (the public form, the booking page, an inbound text) is the customer. btrim
-- strips spaces only, as the TypeScript twin does.
create function app.contact_author(p_actor_type text, p_actor_id text) returns text
language sql immutable parallel safe set search_path = '' as $$
  select case
    when p_actor_type = 'ai' then 'ai'
    when btrim(p_actor_id) in ('system_demo_seed', 'system_ci_seed') then 'import'
    when p_actor_type = 'user' then 'person'
    else 'customer'
  end
$$;

-- The guard, plain (not definer), so current_user is the caller (0073's notes guard). A signed-in INSERT
-- may say only "a person" (and then it is the caller, from the JWT sub) or "an import" (no id); anything
-- else becomes the caller. A signed-in UPDATE keeps the stored pair: the column UPDATE grant already names
-- neither column, and this is the belt. The service role and the owner may still set or correct a value.
create function app.contacts_author_guard() returns trigger
language plpgsql set search_path = '' as $$
begin
  if current_user = 'authenticated' then
    if tg_op = 'INSERT' then
      if new.author_kind is not distinct from 'import' then
        new.author_id := null;
      else
        new.author_kind := 'person';
        new.author_id := nullif(btrim(app.jwt() ->> 'sub'), '');
      end if;
    else
      new.author_kind := old.author_kind;
      new.author_id := old.author_id;
    end if;
  end if;
  return new;
end $$;
create trigger contacts_author_guard before insert or update on public.contacts
  for each row execute function app.contacts_author_guard();

-- The backfill. Idempotent: it touches only contacts still unset, so the follow-up file can run it again
-- for contacts the running build inserts between this file and 8c's deploy. Each contact takes the kind
-- its FIRST contact.created event gives. A contact the public form made (system, form) whose EARLIEST
-- submission is the AI's is a web-chat lead, and reads as the AI. A contact with no event reads as the
-- customer and is named in its own bucket (Task 0 read none on either project). Returns each bucket's count.
create function app.backfill_contact_authors() returns table (bucket text, row_count bigint)
language plpgsql set search_path = '' as $$
#variable_conflict use_column
begin
  return query
  with ev as (
    select distinct on (e.payload ->> 'contactId')
           e.payload ->> 'contactId' as row_id, e.account_id, e.actor_type, e.actor_id
      from public.events e
     where e.type = 'contact.created' and e.payload ->> 'contactId' is not null
     order by e.payload ->> 'contactId', e.id
  ), first_sub as (
    select distinct on (s.contact_id) s.contact_id, s.author_kind
      from public.form_submissions s
     where s.contact_id is not null
     order by s.contact_id, s.created_at, s.id
  ), m as (
    select src.id, ev.actor_type, ev.actor_id,
           coalesce(ev.actor_type = 'system' and btrim(ev.actor_id) = 'form' and fs.author_kind = 'ai', false) as webchat
      from public.contacts src
      left join ev on ev.row_id = src.id::text and ev.account_id = src.account_id
      left join first_sub fs on fs.contact_id = src.id
     where src.author_kind is null
  ), done as (
    update public.contacts c
       set author_kind = case when m.webchat then 'ai' else app.contact_author(m.actor_type, m.actor_id) end,
           author_id = case when not m.webchat and app.contact_author(m.actor_type, m.actor_id) = 'person'
                            then nullif(btrim(m.actor_id), '') end
      from m
     where c.id = m.id and c.author_kind is null
    returning c.author_kind, m.webchat, m.actor_type is null as no_event
  )
  select 'contacts ' || d.author_kind
         || case when d.webchat then ' (website chat)' else '' end
         || case when d.no_event then ' (no event)' else '' end, count(*)
    from done d group by 1;
end $$;

revoke all on function app.contact_author(text, text) from public, anon, authenticated, service_role;
revoke all on function app.backfill_contact_authors() from public, anon, authenticated, service_role;
revoke all on function app.contacts_author_guard() from public, anon;
grant execute on function app.contacts_author_guard() to authenticated, service_role;

-- The first run. Its NOTICEs are the bucket counts the rollout reads (Task 0 measured them before apply).
do $$
declare r record;
begin
  for r in select * from app.backfill_contact_authors() loop
    raise notice 'contact authors backfill: % = %', r.bucket, r.row_count;
  end loop;
end $$;

-- 4. The undo of a booking act. One compare-and-swap per kind, on the row the act names, after locking
--    the act; then the stamp. Service role only (the app proves the booking on the request client first).
--    Answers: undone, gone, already_undone, already_cancelled, already_happened, rebooked, time_passed,
--    time_taken, old_time_taken, changed. A non-booking act raises 22023. Events stay the caller's.
--    The reschedule undo DELETES the new booking rather than cancelling it (plan review I-4): a cancelled
--    new row would still name the old one in rescheduled_from_id, so the old booking would read as moved
--    and a later Calendar Undo of it would be refused as rescheduled. Its two steps sit in one inner block,
--    mapped by SQLSTATE (class ZA is unused by PostgreSQL), so the new booking is never gone without the old
--    one restored. calls.booking_id on the rescheduling call goes null by its FK.
create function public.undo_ai_booking_act(p_account_id uuid, p_act_id uuid, p_by text, p_now timestamptz)
returns text
language plpgsql
security invoker
set search_path = ''
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
comment on function public.undo_ai_booking_act(uuid, uuid, text, timestamptz) is
  'Undo of one of Sofia''s booking acts (0091): locks the act, then one compare-and-swap per kind, then '
  'stamps the act. Service role only.';
revoke all on function public.undo_ai_booking_act(uuid, uuid, text, timestamptz) from public, anon, authenticated, service_role;
grant execute on function public.undo_ai_booking_act(uuid, uuid, text, timestamptz) to service_role;

-- 5. What holds a contact Sofia created: the names of the tables holding anything that is NOT her own call
--    or chat, table by table against every FK into contacts (plan, "The model", function 2). Empty means
--    the contact is safe to delete. Invoker rights: a client (the display) reads under its own RLS; the
--    delete below calls it as the service role, the authoritative read. It never reads
--    concierge_conversations, which the client role cannot SELECT (review I-1): a web-chat act carries its
--    own submission id. Tables whose FK into contacts is the bare contact id (calls, tasks, conversations,
--    form_submissions, automation_log, notes, contact_tags) are matched on the contact alone, whatever the
--    row's account, because the delete acts on every row that names the contact. A contact_duplicate_flags
--    pair and a record_summaries paragraph are never activity. events is the backstop for a person's
--    field-only edits; it is not an FK.
create function public.ai_contact_held_by(p_account_id uuid, p_act_id uuid)
returns text[]
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_kind text;
  v_contact uuid;
  v_call uuid;
  v_chat uuid;
  v_target jsonb;
  v_held text[] := '{}';
begin
  select a.kind, a.contact_id, a.call_id, a.chat_id, a.target
    into v_kind, v_contact, v_call, v_chat, v_target
    from public.ai_acts a
   where a.account_id = p_account_id and a.id = p_act_id;
  if not found or v_kind <> 'contact_created' then
    raise exception 'ai_contact_held_by: not a contact_created act of this account: %', p_act_id using errcode = '22023';
  end if;

  -- calls: only her own call is hers.
  if exists (select 1 from public.calls k
              where k.contact_id = v_contact and not coalesce(k.id = v_call, false)) then
    v_held := v_held || 'calls'::text;
  end if;
  -- tasks: her callback To-do, untouched: from her call, open, unassigned, and no person's task event
  -- names it (completed, reopened or assigned by a person, it is theirs; review I-2).
  if exists (select 1 from public.tasks t
              where t.contact_id = v_contact
                and not coalesce(t.call_id = v_call and t.completed_at is null and t.assigned_to is null
                      and not exists (select 1 from public.events e
                                       where e.account_id = p_account_id and e.type like 'task.%'
                                         and e.actor_type = 'user' and e.payload ->> 'taskId' = t.id::text), false)) then
    v_held := v_held || 'tasks'::text;
  end if;
  -- conversations: what they hold. Her own words, and the one thread message the web chat filed.
  if exists (select 1 from public.messages m join public.conversations v on v.id = m.conversation_id
              where v.contact_id = v_contact
                and not coalesce(m.author_kind = 'ai' or m.id::text = v_target ->> 'messageId', false)) then
    v_held := v_held || 'messages'::text;
  end if;
  if exists (select 1 from public.inbound_emails i join public.conversations v on v.id = i.conversation_id
              where v.contact_id = v_contact) then
    v_held := v_held || 'inbound_emails'::text;
  end if;
  -- form_submissions: only the web chat's own submission.
  if exists (select 1 from public.form_submissions s
              where s.contact_id = v_contact and not coalesce(s.id::text = v_target ->> 'submissionId', false)) then
    v_held := v_held || 'form_submissions'::text;
  end if;
  -- automation_log: her call's text-back once it is sent, skipped or failed. A held one is not hers: it
  -- blocks until the release pass resolves it (review I-3).
  if exists (select 1 from public.automation_log l
              where l.contact_id = v_contact
                and not coalesce(l.source = 'textback' and l.subject_key = 'call:' || v_call::text
                                 and l.status in ('sent', 'skipped', 'failed'), false)) then
    v_held := v_held || 'automation_log'::text;
  end if;
  -- ai_acts: her acts from the same call or the same chat.
  if exists (select 1 from public.ai_acts x
              where x.account_id = p_account_id and x.contact_id = v_contact
                and not coalesce(x.call_id = v_call or x.chat_id = v_chat, false)) then
    v_held := v_held || 'ai_acts'::text;
  end if;
  -- proposals: her call's suggestions nobody decided (pending, or aged out). One a person accepted, edited
  -- or dismissed is theirs (review I-2).
  if exists (select 1 from public.proposals p
              where p.account_id = p_account_id and p.contact_id = v_contact
                and not coalesce(p.call_id = v_call and p.status in ('pending', 'expired'), false)) then
    v_held := v_held || 'proposals'::text;
  end if;
  -- Never hers. A booking is its own reason (owner Q4): a contact with any booking stays.
  if exists (select 1 from public.bookings b where b.account_id = p_account_id and b.contact_id = v_contact) then
    v_held := v_held || 'bookings'::text;
  end if;
  if exists (select 1 from public.opportunities o where o.account_id = p_account_id and o.contact_id = v_contact) then
    v_held := v_held || 'opportunities'::text;
  end if;
  if exists (select 1 from public.notes n where n.contact_id = v_contact) then
    v_held := v_held || 'notes'::text;
  end if;
  if exists (select 1 from public.contact_tags g where g.contact_id = v_contact) then
    v_held := v_held || 'contact_tags'::text;
  end if;
  if exists (select 1 from public.documents d where d.account_id = p_account_id and d.contact_id = v_contact) then
    v_held := v_held || 'documents'::text;
  end if;
  if exists (select 1 from public.document_requests q where q.account_id = p_account_id and q.contact_id = v_contact) then
    v_held := v_held || 'document_requests'::text;
  end if;
  if exists (select 1 from public.document_requirement_skips r
              where r.account_id = p_account_id and r.contact_id = v_contact) then
    v_held := v_held || 'document_requirement_skips'::text;
  end if;
  if exists (select 1 from public.places pl where pl.account_id = p_account_id and pl.contact_id = v_contact) then
    v_held := v_held || 'places'::text;
  end if;
  if exists (select 1 from public.contact_relationships cr
              where cr.account_id = p_account_id and (cr.contact_id = v_contact or cr.related_contact_id = v_contact)) then
    v_held := v_held || 'contact_relationships'::text;
  end if;
  if exists (select 1 from public.client_group_members gm where gm.account_id = p_account_id and gm.contact_id = v_contact) then
    v_held := v_held || 'client_group_members'::text;
  end if;
  if exists (select 1 from public.consent_events ce where ce.account_id = p_account_id and ce.contact_id = v_contact) then
    v_held := v_held || 'consent_events'::text;
  end if;
  -- The backstop: a person edited, assigned, tagged or re-languaged the contact (any user event naming it).
  if exists (select 1 from public.events e
              where e.account_id = p_account_id and e.actor_type = 'user' and e.payload ->> 'contactId' = v_contact::text) then
    v_held := v_held || 'edits'::text;
  end if;
  return v_held;
end;
$$;
comment on function public.ai_contact_held_by(uuid, uuid) is
  'What holds a contact Sofia created (0091): the tables holding anything that is not her own call or '
  'chat. Empty means it is safe to delete. Invoker rights; the client role and the service role.';
revoke all on function public.ai_contact_held_by(uuid, uuid) from public, anon, authenticated, service_role;
grant execute on function public.ai_contact_held_by(uuid, uuid) to authenticated, service_role;

-- 6. The undo of a contact Sofia created. Three statements (0083's reason): statement 1 only locks (the
--    act, then the contact, then its conversations; a concurrent FK insert holds FOR KEY SHARE on the row
--    it references, so it waits here or is waited on), statement 2 checks on a FRESH snapshot, statement 3
--    deletes her thread and the contact. Her To-dos, suggestions, acts (this one included), duplicate flags
--    and summary cascade; every To-do and suggestion left by then is an untouched one of hers, by statement
--    2. calls.contact_id, calls.conversation_id and form_submissions.contact_id go null by their own FKs:
--    the call stays in Calls, unlinked (D4). Answers deleted, has_activity, has_booking or gone.
create function public.undo_ai_contact_created(p_account_id uuid, p_act_id uuid)
returns text
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_kind text;
  v_contact uuid;
  v_held text[];
begin
  select a.kind, a.contact_id into v_kind, v_contact
    from public.ai_acts a
   where a.account_id = p_account_id and a.id = p_act_id
   for update;
  if not found then
    return 'gone';
  end if;
  if v_kind <> 'contact_created' then
    raise exception 'undo_ai_contact_created: not a contact_created act: %', p_act_id using errcode = '22023';
  end if;

  -- Statement 1: lock and wait only.
  perform 1 from public.contacts c where c.account_id = p_account_id and c.id = v_contact for update;
  perform 1 from public.conversations v where v.contact_id = v_contact for update;

  -- Statement 2: a fresh snapshot, so a row a statement-1 wait was waiting on is seen.
  select public.ai_contact_held_by(p_account_id, p_act_id) into v_held;
  if cardinality(v_held) > 0 then
    if 'bookings' = any(v_held) then
      return 'has_booking';
    end if;
    return 'has_activity';
  end if;

  -- Statement 3: her thread (messages first: their FK to conversations has no action), then the contact.
  delete from public.messages m using public.conversations v
   where m.conversation_id = v.id and v.contact_id = v_contact;
  delete from public.conversations v where v.contact_id = v_contact;
  delete from public.contacts c where c.account_id = p_account_id and c.id = v_contact;
  return 'deleted';
end;
$$;
comment on function public.undo_ai_contact_created(uuid, uuid) is
  'Undo of a contact Sofia created (0091): lock, check ai_contact_held_by on a fresh snapshot, then delete '
  'her thread and the contact. The call stays, unlinked. Service role only.';
revoke all on function public.undo_ai_contact_created(uuid, uuid) from public, anon, authenticated, service_role;
grant execute on function public.undo_ai_contact_created(uuid, uuid) to service_role;
