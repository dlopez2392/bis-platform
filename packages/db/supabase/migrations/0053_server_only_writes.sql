-- 0053_server_only_writes.sql
--
-- WHO WRITES WHAT, from this file on. The tables that record what happened
-- are written by server code: the service role, or a SECURITY DEFINER
-- function that decides for itself what it writes. The signed-in client role
-- (`authenticated`) keeps SELECT on them, under the same RLS as before.
--
--   events             appended by the service role, or by
--                      public.record_event(), which takes the actor from the
--                      request's JWT (actor_type 'user', actor_id = sub).
--   form_submissions   service role only (public form, intake, concierge,
--                      the instant-reply stamp).
--   conversations      service role only (the composer and mark-read run in
--   messages           server actions with the service client).
--   bookings           service role only (0016 already held UPDATE back).
--   calendars          INSERT/DELETE: service role only. The settings
--                      columns stay client-editable (0016, 0018, 0022).
--   call_proposals     service role only; a decided row names its decider.
--   contacts,          the client role's UPDATE becomes a column list: the
--   opportunities      operator's fields, without the once-ever automation
--                      stamps (0047) and without identity columns.
--
-- Schema-wide: `authenticated` holds no TRUNCATE, REFERENCES, TRIGGER or
-- MAINTAIN on any public table, and `anon` holds nothing but SELECT on any.
-- schema-grants-guard.test.ts pins the resulting client write surface table
-- by table, so a later migration that grants more fails there by name.
--
-- A COLUMN ADDED to contacts or opportunities after this file is NOT client-
-- updatable until a migration grants it by name (the 0013 accounts pattern).
--
-- APPLY ORDER: this file removes privileges the previous app build used. On
-- production it is applied AFTER the build that no longer uses them is live;
-- the CI project gets it first, as always. Once this file is applied, the app
-- build that preceded it can no longer run against the database: its
-- request-client writes to these tables are refused. Rolling the app back
-- past this migration's merge therefore needs the ROLLBACK below applied
-- first.
--
-- ROLLBACK, section by section:
--   1  grant insert on public.events to authenticated; recreate events_insert
--      (0001); drop function public.record_event(uuid, text, jsonb).
--   2  grant insert, update, delete on form_submissions, conversations,
--      messages to authenticated; grant insert, delete on bookings; grant
--      update (status, decided_at, decided_by) on call_proposals; drop the
--      five *_read policies and recreate the dropped ones (0005, 0006, 0017,
--      0040).
--   3  grant insert, delete on public.calendars to authenticated.
--   4  alter table public.call_proposals drop constraint
--      call_proposals_decision_complete.
--   5  grant update on public.contacts, public.opportunities to authenticated
--      (the column lists become redundant); restore 0049's column comment.
--   6  grant execute on function public.increment_conversation_unread(uuid,
--      uuid) to anon, authenticated.
--   7  grant truncate, references, trigger, maintain on all tables in schema
--      public to authenticated; grant insert, update, delete, truncate,
--      references, trigger, maintain on all tables in schema public to anon.

-- The policy swaps and the CHECK take ACCESS EXCLUSIVE locks on busy tables;
-- wait at most 5s for each rather than queue behind a long transaction
-- (0050's precedent).
set local lock_timeout = '5s';

-- 1. events: the client role appends through record_event only.
create function public.record_event(p_account_id uuid, p_type text, p_payload jsonb default '{}'::jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor text := nullif(app.jwt() ->> 'sub', '');
begin
  if v_actor is null then
    raise exception 'record_event: no user on this request' using errcode = '42501';
  end if;
  -- The rule events_insert (0001) enforced as a policy, enforced here. The
  -- coalesce is load-bearing: app.is_agency() is NULL, not false, for a token
  -- with no app_role claim (every client user's), and a policy treats a NULL
  -- check as a refusal while a plpgsql IF treats it as "not taken".
  if not coalesce(app.is_agency() or (p_account_id is not null and p_account_id = app.current_account_id()), false) then
    raise exception 'record_event: not a member of this account' using errcode = '42501';
  end if;
  if p_type is null or char_length(p_type) not between 1 and 100 then
    raise exception 'record_event: type must be 1 to 100 characters' using errcode = '22023';
  end if;
  insert into public.events (account_id, type, actor_type, actor_id, payload)
  values (p_account_id, p_type, 'user', v_actor, coalesce(p_payload, '{}'::jsonb));
end;
$$;

comment on function public.record_event(uuid, text, jsonb) is
  'Appends one event for the signed-in user: actor_type user, actor_id = the JWT sub, account checked like the old events_insert policy. The only way the client role writes to events.';

-- Default privileges hand EXECUTE to anon, authenticated and service_role BY
-- NAME, so revoking from PUBLIC alone would leave them (0043's lesson).
revoke all on function public.record_event(uuid, text, jsonb) from public, anon, authenticated, service_role;
grant execute on function public.record_event(uuid, text, jsonb) to authenticated;

drop policy events_insert on public.events;
revoke insert, update, delete on public.events from authenticated;

-- 2. Server-written tables: SELECT only for the client role, under a
--    SELECT-only policy with the same using clause as before.
revoke insert, update, delete on public.form_submissions, public.conversations, public.messages,
  public.bookings, public.call_proposals from authenticated;

drop policy form_submissions_member_all on public.form_submissions;
create policy form_submissions_member_read on public.form_submissions for select to authenticated
  using (app.is_agency() or account_id = app.current_account_id());

drop policy conversations_member_all on public.conversations;
create policy conversations_member_read on public.conversations for select to authenticated
  using (app.is_agency() or account_id = app.current_account_id());

drop policy messages_member_all on public.messages;
create policy messages_member_read on public.messages for select to authenticated
  using (app.is_agency() or account_id = app.current_account_id());

drop policy bookings_tenant on public.bookings;
create policy bookings_tenant_read on public.bookings for select to authenticated
  using (app.is_agency() or account_id = app.current_account_id());

drop policy call_proposals_member_all on public.call_proposals;
create policy call_proposals_member_read on public.call_proposals for select to authenticated
  using (app.is_agency() or account_id = app.current_account_id());

-- 3. calendars: identity is server-written; the settings UPDATE grant stays.
revoke insert, delete on public.calendars from authenticated;

-- 4. call_proposals: a decision names who and when; pending names neither.
alter table public.call_proposals add constraint call_proposals_decision_complete check (
  (status = 'pending' and decided_at is null and decided_by is null)
  or (status <> 'pending' and decided_at is not null and decided_by is not null and btrim(decided_by) <> '')
);

-- 5. The once-ever stamps leave the client role's UPDATE set.
revoke update on public.contacts from authenticated;
grant update (first_name, last_name, email, phone, company_name, source, assigned_to, dnd, custom,
              attribution, updated_at, marketing_email_opted_out_at)
  on public.contacts to authenticated;

revoke update on public.opportunities from authenticated;
grant update (contact_id, pipeline_id, stage_id, name, status, monetary_value, assigned_to, custom,
              stage_changed_at, status_changed_at, updated_at)
  on public.opportunities to authenticated;

-- 0049's comment named the table-level grant this section replaces.
comment on column public.contacts.marketing_email_opted_out_at is
  'When the operator recorded that this contact asked not to get marketing email. NULL = may receive it. Read by the reactivation recipe (excluded in its query) and by the referral ask on the email channel (skipped with a reason); quote follow-ups and transactional email ignore it. Client-writable through its column UPDATE grant (0053) and contacts_member_all; clearing it to NULL undoes the opt-out. contacts.dnd (0003) is unrelated and dead.';

-- 6. increment_conversation_unread (0006) runs as its caller; only server
--    paths call it.
revoke execute on function public.increment_conversation_unread(uuid, uuid) from public, anon, authenticated;

-- 7. Schema-wide.
revoke truncate, references, trigger, maintain on all tables in schema public from authenticated;
revoke insert, update, delete, truncate, references, trigger, maintain on all tables in schema public from anon;
