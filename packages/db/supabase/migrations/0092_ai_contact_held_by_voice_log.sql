-- 0092_ai_contact_held_by_voice_log.sql - a contact Sofia made on a call is still hers to remove when her
-- call's own log row names it (first release item 8, part 8c; final whole-branch review I-1)
--
-- 0091's ai_contact_held_by counted as hers, in automation_log, only her call's text-back. But finishCall
-- (apps/web/src/lib/voice/finish-call.ts, the "Part C" block at lines 694-704) writes, on EVERY call with a
-- call row, one more automation_log row: source 'voice', channel 'ai', subject_key 'call:' || the call's id,
-- contact_id = the contact the call resolved, which on a lead or message call is the contact she just made,
-- status 'sent' or 'skipped'. So every contact she made on a real call answered {automation_log}, the undo
-- answered has_activity, and removing an untouched contact she made (D4) was never offered on the voice path.
--
-- The change: the automation_log clause also counts as hers a row with source 'voice' and subject_key
-- 'call:' || the act's call id, whatever its status (a hang-up's row is 'skipped'). A voice row for ANY OTHER
-- call still holds the contact. Everything else in the function is 0091's, byte for byte: same signature,
-- stable, security invoker, search_path ''. CREATE OR REPLACE keeps the function's oid, owner and grants
-- (authenticated and service_role execute, PUBLIC none), so they are not re-stated; ai-acts-schema.test.ts
-- pins them after this file. undo_ai_contact_created calls this function by name, so it takes the new rule
-- with no change of its own.
--
-- APPLY ORDER: CI project (ci-project-setup.yml: push-dry-run, then push), then production (MCP
-- apply_migration, once), then the parity check. It may go before or after the code: it only widens what
-- counts as hers by one row kind, and the running build calls the function the same way.
--
-- ROLLBACK: re-run 0091's original definition of public.ai_contact_held_by (0091_ai_acts.sql, section 5, the
-- create function statement and its comment) as create or replace. The grants stay as they are.
--
-- ASCII only, no backslash anywhere.

-- 0. Fail fast instead of queueing behind a long lock (0091's reason: inside a do block, so it is always in
--    the block's transaction).
do $$
begin
  perform pg_catalog.set_config('lock_timeout', '5s', true);
end $$;

-- 1. ai_contact_held_by, 0091's body with the automation_log clause widened.
create or replace function public.ai_contact_held_by(p_account_id uuid, p_act_id uuid)
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
  -- blocks until the release pass resolves it (review I-3). And finishCall's own row for her call (source
  -- voice), whatever its status (0092).
  if exists (select 1 from public.automation_log l
              where l.contact_id = v_contact
                and not coalesce((l.source = 'textback' and l.subject_key = 'call:' || v_call::text
                                  and l.status in ('sent', 'skipped', 'failed'))
                                 or (l.source = 'voice' and l.subject_key = 'call:' || v_call::text), false)) then
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
  'What holds a contact Sofia created (0091; 0092 counts her call''s own voice log row as hers): the tables '
  'holding anything that is not her own call or chat. Empty means it is safe to delete. Invoker rights; the '
  'client role and the service role.';
