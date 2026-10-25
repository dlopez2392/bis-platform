-- 0098_shared_number_holding.sql - one "Caller" holding record per shared number (S-47e, owner decision E8)
-- (docs/superpowers/specs/2026-10-24-caller-identity-ladder-design.md section 4.1;
--  docs/superpowers/plans/2026-10-24-caller-identity-ladder-pr47e.md, Task 1)
--
-- WHY. A phone several customers share carries no name, so a missed-call text-back and the replies to it
-- cannot be filed on any one of them (S-47e E7). E8: they live on ONE holding record per number, which no
-- booking, lead, name or customer detail ever reaches, and staff move the thread to the right person.
--
-- WHAT.
--   public.contacts.holds_shared_number boolean not null default false: the mark. Set only by server code
--     (ensureHoldingContact, service_role); a signed-in insert stores false; no client UPDATE grant names it.
--   contacts_holding_shape: a holding record is first name Caller, no last name, no email, no business
--     name, and an E.164 phone of 8 to 16 characters. Written null-safe: a CHECK passes on NULL, so every
--     term is true or false, never NULL. The business name is company_name, which only the business group
--     sync writes (app.sync_company_name, a definer, so the trigger below never sees a signed-in session);
--     the CHECK is what refuses it, for every writer.
--   contacts_one_holding_per_number: unique (account_id, phone) where holds_shared_number. The exact E.164,
--     not phone_key: two numbers of two countries can share a digits key, never an E.164.
--   app.contacts_holding_server_only(): plain, not definer. For a signed-in session it stores false on
--     insert, keeps the mark on update, and refuses (42501) any change to a holding record except who it is
--     assigned to; server code (service_role) is not limited.
--   public.move_holding_thread(...): moves the messages and calls of a holding thread to the conversation of
--     a person, recording what it moved on its own conversation.moved event (actor_type system, actor_id and
--     payload by the person, payload writer move_holding_thread), or moves back exactly what one such event
--     recorded (Undo, which names that event and nothing else). The unread count goes with the texts: a
--     move records what it handed over, and its Undo hands that back, at most what the person thread still
--     has unread, and nothing when it moves nothing. An event a client wrote through record_event
--     is actor_type user (0053), so it can never be undone from. A move that finds nothing to move (a second
--     move of the same thread, or a stale tab) answers empty and writes nothing. SECURITY DEFINER, executed
--     by service_role only, behind the role check of the app.
--
-- GRANTS. No table-level privilege changes: the client-write digest (proposals-drop.test.ts,
-- 52|b66203ca5d355155540b520af510d120 after 0097) is unchanged, and EXPECTED_WRITES in
-- schema-grants-guard.test.ts is unchanged for contacts (no column grant names holds_shared_number). The new
-- definer is added to EXPECTED_DEFINERS in definer-search-path.test.ts (22 -> 23).
--
-- SEARCH PATHS. Both functions say set search_path = pg_catalog, pg_temp (the 0096 rule).
--
-- LOCKS AND COST. The file runs as one transaction. ADD COLUMN with a constant default is catalogue-only
-- but takes ACCESS EXCLUSIVE on contacts, held to the end of the file; the CHECK validation (one scan, every
-- existing row is false and passes) and the partial unique index build (it indexes no existing row) run
-- under that same lock. The lock_timeout of 5s below bounds the wait to take it.
--
-- LOAD-BEARING. The build after this file names holds_shared_number in every contact dedupe, the contact
-- list and count, the contact reads, the inbox reads, the CSV import match index and the voice reads, and
-- calls move_holding_thread (plan SD list), so it merges only after this file is on production.
--
-- ROLLBACK (roll the app back first):
--   drop function public.move_holding_thread(uuid, uuid, uuid, text, bigint);
--   drop trigger contacts_holding_server_only on public.contacts;
--   drop function app.contacts_holding_server_only();
--   drop index public.contacts_one_holding_per_number;
--   alter table public.contacts drop constraint contacts_holding_shape;
--   alter table public.contacts drop column holds_shared_number;
--     (holding records then read as ordinary Caller contacts, threads and all)
--
-- ASCII only, no backslash anywhere, and every dollar sign in this file is part of a dollar-quote pair.

-- 0. Fail fast instead of queueing behind a long lock (0094 reason: inside a do block, so it is always in
--    the block transaction).
do $$
begin
  perform pg_catalog.set_config('lock_timeout', '5s', true);
end $$;

-- 1. The mark.
alter table public.contacts
  add column holds_shared_number boolean not null default false;

-- 2. Its shape.
alter table public.contacts
  add constraint contacts_holding_shape check (
    not holds_shared_number
    or (first_name is not distinct from 'Caller' and last_name is null and email is null
        and company_name is null
        and phone is not null and pg_catalog.length(phone) between 8 and 16
        and pg_catalog.substr(phone, 1, 1) = '+' and pg_catalog.substr(phone, 2) !~ '[^0-9]')
  ) not valid;
alter table public.contacts validate constraint contacts_holding_shape;

-- 3. One per account and number.
create unique index contacts_one_holding_per_number
  on public.contacts (account_id, phone) where holds_shared_number;

-- 4. Only server code sets, clears or edits it.
create function app.contacts_holding_server_only() returns trigger
language plpgsql set search_path = pg_catalog, pg_temp as $$
begin
  if coalesce(current_user = 'authenticated', false) then
    if tg_op = 'INSERT' then
      new.holds_shared_number := false;
    else
      if old.holds_shared_number
         and (new.first_name, new.last_name, new.email, new.phone, new.phone_country_unconfirmed, new.source,
              new.custom, new.attribution, new.dnd, new.marketing_email_opted_out_at)
             is distinct from
             (old.first_name, old.last_name, old.email, old.phone, old.phone_country_unconfirmed, old.source,
              old.custom, old.attribution, old.dnd, old.marketing_email_opted_out_at) then
        raise exception 'A shared number holding record is changed by server code only'
          using errcode = '42501';
      end if;
      new.holds_shared_number := old.holds_shared_number;
    end if;
  end if;
  return new;
end $$;
create trigger contacts_holding_server_only before insert or update on public.contacts
  for each row execute function app.contacts_holding_server_only();

-- 5. Move a holding thread to a person, or move back exactly what one earlier move recorded (Undo).
create function public.move_holding_thread(
  p_account_id uuid, p_from_conversation uuid, p_to_conversation uuid, p_actor text,
  p_undo_of bigint default null)
returns jsonb
language plpgsql security definer set search_path = pg_catalog, pg_temp as $$
declare
  v_from_contact uuid;
  v_to_contact uuid;
  v_from_unread integer;
  v_from_holding boolean;
  v_to_holding boolean;
  v_undo jsonb;
  v_want_messages uuid[];
  v_want_calls uuid[];
  v_messages uuid[];
  v_calls uuid[];
  v_event bigint;
  v_hand integer;
begin
  if p_from_conversation = p_to_conversation then
    return pg_catalog.jsonb_build_object('status', 'invalid');
  end if;

  -- Both conversations on this account, locked in a fixed order so two moves cannot deadlock.
  perform 1 from public.conversations c
   where c.account_id = p_account_id and c.id in (p_from_conversation, p_to_conversation)
   order by c.id for update;
  select c.contact_id, c.unread_count into v_from_contact, v_from_unread
    from public.conversations c where c.account_id = p_account_id and c.id = p_from_conversation;
  select c.contact_id into v_to_contact
    from public.conversations c where c.account_id = p_account_id and c.id = p_to_conversation;
  if v_from_contact is null or v_to_contact is null then
    return pg_catalog.jsonb_build_object('status', 'not_found');
  end if;

  select coalesce(k.holds_shared_number, false) into v_from_holding
    from public.contacts k where k.account_id = p_account_id and k.id = v_from_contact;
  select coalesce(k.holds_shared_number, false) into v_to_holding
    from public.contacts k where k.account_id = p_account_id and k.id = v_to_contact;
  -- Exactly one side is the holding record. A move goes away from it with no event named; an Undo goes
  -- toward it and must name the move it undoes.
  if v_from_holding is null or v_to_holding is null
     or v_from_holding = v_to_holding
     or (v_to_holding and p_undo_of is null)
     or (v_from_holding and p_undo_of is not null) then
    return pg_catalog.jsonb_build_object('status', 'invalid');
  end if;

  -- An Undo moves back only the ids that move recorded, between the same two threads. It never undoes an
  -- Undo: that would move away from the holding thread with an event named, which the guard above refuses.
  -- The event must be one this function wrote: record_event stamps every client event actor_type user (0053).
  if p_undo_of is not null then
    select e.payload into v_undo from public.events e
     where e.id = p_undo_of and e.account_id = p_account_id and e.type = 'conversation.moved'
       and e.actor_type = 'system' and (e.payload ->> 'writer') = 'move_holding_thread';
    if v_undo is null
       or (v_undo ->> 'fromConversationId') is distinct from p_to_conversation::text
       or (v_undo ->> 'toConversationId') is distinct from p_from_conversation::text then
      return pg_catalog.jsonb_build_object('status', 'invalid');
    end if;
    select coalesce(pg_catalog.array_agg(t.x::uuid), '{}') into v_want_messages
      from pg_catalog.jsonb_array_elements_text(v_undo -> 'messageIds') as t(x);
    select coalesce(pg_catalog.array_agg(t.x::uuid), '{}') into v_want_calls
      from pg_catalog.jsonb_array_elements_text(v_undo -> 'callIds') as t(x);
  end if;

  with moved as (
    update public.messages m
       set conversation_id = p_to_conversation, updated_at = pg_catalog.now()
     where m.account_id = p_account_id and m.conversation_id = p_from_conversation
       and (p_undo_of is null or m.id = any (v_want_messages))
    returning m.id)
  select coalesce(pg_catalog.array_agg(id), '{}') into v_messages from moved;

  with repointed as (
    update public.calls k
       set conversation_id = p_to_conversation,
           contact_id = case when v_to_holding then null else v_to_contact end
     where k.account_id = p_account_id and k.conversation_id = p_from_conversation
       and (p_undo_of is null or k.id = any (v_want_calls))
       and (k.contact_id is null or k.contact_id = v_from_contact)
    returning k.id)
  select coalesce(pg_catalog.array_agg(id), '{}') into v_calls from repointed;

  -- A move that found nothing left to move (a second move of the same thread, which waited on the lock
  -- above, or a stale tab) changes no count and writes no event, so nothing can claim or undo it.
  if p_undo_of is null
     and pg_catalog.cardinality(v_messages) = 0 and pg_catalog.cardinality(v_calls) = 0 then
    return pg_catalog.jsonb_build_object('status', 'empty');
  end if;

  -- The unread count goes with the texts. A move hands over all the holding thread has, and records it; an
  -- Undo hands back what that move recorded, at most what the person thread still has unread (some may have
  -- been read since), and nothing when it moved nothing (a second Undo of one move).
  if p_undo_of is null then
    v_hand := coalesce(v_from_unread, 0);
  elsif pg_catalog.cardinality(v_messages) = 0 and pg_catalog.cardinality(v_calls) = 0 then
    v_hand := 0;
  else
    v_hand := least(greatest(coalesce((v_undo ->> 'unread')::integer, 0), 0), coalesce(v_from_unread, 0));
  end if;

  -- The thread the texts leave gives up v_hand unread, the thread they reach gains it.
  update public.conversations c
     set last_message_at = (select pg_catalog.max(m.created_at) from public.messages m
                             where m.account_id = p_account_id and m.conversation_id = c.id),
         unread_count = case when c.id = p_to_conversation then c.unread_count + v_hand
                             else c.unread_count - v_hand end,
         updated_at = pg_catalog.now()
   where c.account_id = p_account_id and c.id in (p_from_conversation, p_to_conversation);

  insert into public.events (account_id, type, actor_type, actor_id, payload)
  values (p_account_id, 'conversation.moved', 'system', p_actor,
          pg_catalog.jsonb_build_object(
            'writer', 'move_holding_thread', 'by', p_actor,
            'fromConversationId', p_from_conversation, 'toConversationId', p_to_conversation,
            'fromContactId', v_from_contact, 'toContactId', v_to_contact,
            'messages', coalesce(pg_catalog.array_length(v_messages, 1), 0),
            'undo', p_undo_of is not null, 'undoOf', p_undo_of, 'unread', v_hand,
            'messageIds', pg_catalog.to_jsonb(v_messages), 'callIds', pg_catalog.to_jsonb(v_calls)))
  returning id into v_event;

  return pg_catalog.jsonb_build_object('status', 'ok', 'moveId', v_event,
    'messageIds', pg_catalog.to_jsonb(v_messages), 'callIds', pg_catalog.to_jsonb(v_calls));
end $$;

revoke all on function public.move_holding_thread(uuid, uuid, uuid, text, bigint)
  from public, anon, authenticated, service_role;
grant execute on function public.move_holding_thread(uuid, uuid, uuid, text, bigint) to service_role;

-- 6. Comments: each names its one writer.
comment on column public.contacts.holds_shared_number is
  'True for the one holding record of a phone several customers share (0098, S-47e E8): it holds the missed-call texts and texts from that number until staff move them to a person. Set only by ensureHoldingContact as service_role; a signed-in insert stores false, and a signed-in session may change nothing on such a record but who it is assigned to (app.contacts_holding_server_only). Whoever writes it, it carries no name but Caller, no email and no business name (contacts_holding_shape); no booking or lead is filed on it (every writer skips it).';
comment on function public.move_holding_thread(uuid, uuid, uuid, text, bigint) is
  'Moves a holding thread (contacts.holds_shared_number) to the conversation of a person, with the calls that pointed at it and its unread count, recording the moved ids and that count on its conversation.moved event; a move that finds nothing to move answers empty and writes no event. Or, given such an event as p_undo_of, moves back only those ids that are still on the person thread, with that unread count up to what the person thread still has unread (none when it moves nothing). service_role only, behind the Owner, Staff or agency check of the app (0098).';
