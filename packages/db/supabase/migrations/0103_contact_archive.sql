-- 0103_contact_archive.sql - archive a contact, bring them back, and delete for good only internal-only contacts
-- (docs/superpowers/specs/2026-10-28-contact-archive-design.md sections 3 and 5;
--  docs/superpowers/plans/2026-10-28-contact-archive.md, Task 1)
--
-- WHY. Junk callers, wrong numbers and test records pile up in the contact list, and the only way out today is
-- a delete that either fails on a booking or a conversation, or erases a customer's history. The owner ruled
-- (spec section 11): staff archive any contact at once with Undo; the customer's own sign (a text, an email, a
-- meaningful call, a booking, a form, a chat) brings them back; a permanent delete takes only a contact with
-- nothing but internal work on it, and only an Owner (or the agency) may do it.
--
-- WHAT.
--   contacts.archived_at timestamptz, contacts.archived_by text: archived_at is the one client-writable column
--     (a column grant); archived_by is never client-written. contacts_archived_by_needs_at: no author without
--     an instant.
--   app.contacts_archive_stamp(): plain, not definer (0098's contacts_holding_server_only shape). For a
--     signed-in session it refuses (42501) archiving a shared number's holding record or any archive by a
--     Technician (ruling Q3), stamps archived_at with now() and archived_by with the token's sub on archive,
--     clears archived_by on restore, and on INSERT stores neither (a signed-in insert is never born archived,
--     so no archive goes unstamped or unlogged). An update that is neither an archive nor a restore (an
--     archived contact archived again) keeps the first archive's instant and person and logs nothing. The
--     Technician and holding refusals apply to a restore as much as to an archive. Server code is not limited.
--   public.contact_archive_log: one row per archive or restore, append-only for every client: account,
--     contact, action, author kind (person or customer), the person's sub, the customer's sign. Cascades with
--     its contact. Read by members through the contacts they can see; written only by the two writers below.
--   app.contacts_archive_log(): DEFINER (it writes a table authenticated cannot). Fired AFTER a signed-in
--     archive or restore; the role test is in the trigger's WHEN, which runs in the caller's context, because
--     inside a definer body current_user is the owner and a test there would log nothing.
--   public.restore_contact_on_sign(account, contact, sign): service_role only. Restores an archived contact of
--     that account and logs ONE customer row with the sign; an active contact answers false and writes
--     nothing.
--   public.contact_delete_blockers(account, ids): service_role only. ONE row per blocked contact (at most 500
--     ids, so at most 500 rows, under PostgREST max_rows) with its reasons sorted: messages (any channel but
--     note), inbound_email, calls (by contact, or on the contact's conversation with no contact), forms,
--     consent, automations (sent only), bookings, deals. Definer: a reason the caller's RLS hid would read as
--     no reason (fail open).
--   public.delete_internal_contacts(account, ids): executable by authenticated and service_role, and keeps its
--     own Owner check: a service_role JWT, the agency, or an Owner of THIS account whose token is in it. Locks
--     the contacts and then their conversations in id order, re-reads the blockers inside the lock, and
--     deletes each free contact with its note messages and its empty conversation in its own subtransaction,
--     so a row the purge left behind (a document: documents_contact_fkey is NO ACTION) keeps that one contact.
--     Returns the ids it deleted.
--   contacts_account_archived_created: the Archived view's default order, archived rows only.
--   Six indexes for Postgres 17 (section 11): production has no skip scan, so each single-column foreign key a
--     contact or conversation delete checks or clears gets an index leading on its own column, and the
--     blockers read them too (calls by contact and by conversation, automation_log and form_submissions by
--     contact, messages by conversation, conversations by contact).
--   conversations.contact_archived (trigger-maintained) and conversations.inbox_visible (generated: not
--     contact_archived or unread_count > 0): the inbox rule (owner decision 2026-10-28) is one stored column the
--     inbox and search filter on, so neither needs an OR across an embed. app.conversations_follow_contact_archive()
--     copies an archive or restore onto the contact's conversations; app.conversation_contact_archived()
--     re-derives the flag on EVERY conversation insert and update, so a stale flag heals at the next write.
--
-- GRANTS. One client column grant: update (archived_at) on contacts to authenticated. EXPECTED_WRITES in
-- schema-grants-guard.test.ts and the two contacts column-grant pins (contacts-marketing-optout-schema.test.ts,
-- server-only-writes-grants.test.ts) gain it. The client-write digest does NOT change
-- (proposals-drop.test.ts, 52|b66203ca5d355155540b520af510d120: it counts table privileges only, and
-- contact_archive_log gives anon and authenticated no write). contact_archive_log: select to authenticated
-- (through its policy), select/insert/update/delete to service_role (the 0091 pattern). Functions:
-- restore_contact_on_sign and contact_delete_blockers execute for service_role only; delete_internal_contacts
-- for authenticated and service_role; anon executes none (the default ACL grants anon by name, so each revoke
-- names it). Six definers join EXPECTED_DEFINERS in definer-search-path.test.ts (23 -> 29; 0102 adds none).
--
-- SEARCH PATHS. Every function here says set search_path = pg_catalog, pg_temp (the 0096 rule), and names
-- every relation and app function by schema.
--
-- LOCKS AND COST. The file runs as one transaction; lock_timeout 5s below bounds only the WAIT to take each
-- lock, not the work done under it.
--   contacts: the two ADD COLUMNs are catalogue-only; the CHECK validates in one scan (every row is NULL and
--     passes); the partial index indexes no existing row. ACCESS EXCLUSIVE on contacts for that time.
--   conversations: adding the STORED generated column inbox_visible REWRITES conversations and its indexes under
--     ACCESS EXCLUSIVE, held to the end of the file. For the length of the rewrite every inbound text, email and
--     call filing on every account waits, as do the inbox reads; the SMS route answers 503 if it times out, and
--     Telnyx retries. MEASURED on a PG18 replica (pre = 0001-0102, then this file with psql -1, laptop SSD,
--     one conversation per contact): 5,000 conversations (2352 kB with indexes) rewrite in 59 ms, the whole
--     file in 0.47 s; 50,000 (21 MB) in 414 ms, the whole file in 0.73 s. The orchestrator reads
--       select count(*), pg_size_pretty(pg_total_relation_size('public.conversations')) from public.conversations
--     on production at apply time; above 100,000 rows, apply off-peak.
--   section 11's six indexes: a plain CREATE INDEX (CONCURRENTLY cannot run in a transaction) takes SHARE on
--     its table, held to the end of the file: reads go on, but inserts and updates of messages, calls,
--     automation_log and form_submissions wait until the file commits. MEASURED on a real Postgres 17.6
--     replica (one account: 20,500 contacts and conversations, 300,400 messages, 20,100 calls, 20,000
--     automation rows, 5,000 form submissions): calls_contact_id 23 ms, calls_conversation_id 21 ms,
--     automation_log_contact_id 21 ms, form_submissions_contact_id 8 ms, messages_conversation_id 332 ms,
--     conversations_contact_id 11 ms; the conversations rewrite 125 ms; the whole file 1.05 s. Because the file
--     holds conversations (ACCESS EXCLUSIVE) and then waits for SHARE on messages, a concurrent filing that
--     holds messages and wants conversations can deadlock with it: Postgres aborts one side within a second.
--     The file is all or nothing; if it is the side aborted (or lock_timeout fires), run it again.
--   What the indexes buy, on that Postgres 17.6 replica, warm (the 500-id calls the app makes): before them
--     (and before the account term on messages and the calls split), contact_delete_blockers 22.6 s and
--     delete_internal_contacts 33.0 s, each reading all 300,400 messages per contact; after, 19 ms and 168 ms.
--     Without messages_conversation_id and conversations_contact_id (the two NO ACTION checks a delete makes),
--     the delete still takes 6.6 s. A PG18 replica hides all of this: its skip scan read the account-led
--     indexes (before: 2.4 s and 3.5 s there).
--
-- LOAD-BEARING. The app after this file names archived_at in contacts' COLS and in every list read, and
-- inbox_visible in the inbox reads, so it merges only after this file is on production.
--
-- ROLLBACK (roll the app back first), in this order:
--   drop index public.calls_contact_id, public.calls_conversation_id, public.automation_log_contact_id,
--     public.form_submissions_contact_id, public.messages_conversation_id, public.conversations_contact_id;
--   drop trigger conversations_contact_archived on public.conversations;
--   drop function app.conversation_contact_archived();
--   drop trigger contacts_archive_to_conversations on public.contacts;
--   drop function app.conversations_follow_contact_archive();
--   alter table public.conversations drop column inbox_visible;
--   alter table public.conversations drop column contact_archived;
--   drop index public.contacts_account_archived_created;
--   drop function public.delete_internal_contacts(uuid, uuid[]);
--   drop function public.contact_delete_blockers(uuid, uuid[]);
--   drop function public.restore_contact_on_sign(uuid, uuid, text);
--   drop trigger contacts_archive_log on public.contacts;
--   drop function app.contacts_archive_log();
--   drop trigger contacts_archive_stamp on public.contacts;
--   drop function app.contacts_archive_stamp();
--   drop table public.contact_archive_log;
--   revoke update (archived_at) on public.contacts from authenticated;
--   alter table public.contacts drop constraint contacts_archived_by_needs_at;
--   alter table public.contacts drop column archived_by, drop column archived_at;
--     (archived contacts then read as active ones again; contacts deleted for good stay deleted)
--
-- ASCII only, no backslash anywhere, and every dollar sign in this file is part of a dollar-quote pair.

-- 0. Fail fast instead of queueing behind a long lock.
do $$
begin
  perform pg_catalog.set_config('lock_timeout', '5s', true);
end $$;

-- 1. The columns.
alter table public.contacts
  add column archived_at timestamptz,
  add column archived_by text;
alter table public.contacts
  add constraint contacts_archived_by_needs_at check (archived_by is null or archived_at is not null);

-- 2. Only archived_at is client-writable; the stamp trigger owns archived_by and the instant.
grant update (archived_at) on public.contacts to authenticated;

-- 3. The history.
create table public.contact_archive_log (
  id bigint generated always as identity primary key,
  account_id uuid not null,
  contact_id uuid not null,
  action text not null constraint contact_archive_log_action_check check (action in ('archived', 'restored')),
  author_kind text not null constraint contact_archive_log_author_check check (author_kind in ('person', 'customer')),
  author_id text,
  sign text constraint contact_archive_log_sign_check check (sign in ('text', 'email', 'call', 'booking', 'form', 'chat')),
  created_at timestamptz not null default pg_catalog.now(),
  constraint contact_archive_log_sign_shape check ((author_kind = 'customer') = (sign is not null)),
  constraint contact_archive_log_contact_fkey foreign key (account_id, contact_id)
    references public.contacts (account_id, id) on delete cascade
);
create index contact_archive_log_contact
  on public.contact_archive_log (account_id, contact_id, created_at desc, id desc);
alter table public.contact_archive_log enable row level security;
revoke all on public.contact_archive_log from anon, authenticated;
grant select on public.contact_archive_log to authenticated;
grant select, insert, update, delete on public.contact_archive_log to service_role;
create policy contact_archive_log_read on public.contact_archive_log for select to authenticated
  using (exists (select 1 from public.contacts c
                  where c.account_id = contact_archive_log.account_id and c.id = contact_archive_log.contact_id));

-- 4. The stamp: plain, not definer (0098's contacts_holding_server_only shape).
create function app.contacts_archive_stamp() returns trigger
language plpgsql set search_path = pg_catalog, pg_temp as $$
begin
  if coalesce(current_user = 'authenticated', false) then
    if tg_op = 'INSERT' then
      -- A signed-in insert is never born archived: an archive is always an update, stamped and logged.
      new.archived_at := null;
      new.archived_by := null;
    elsif (new.archived_at is null) = (old.archived_at is null) then
      -- Not an archive and not a restore (an archived contact archived again, a stale tab): the first archive
      -- stands as it was, with its own instant and person, and nothing is logged (the log trigger compares
      -- the stored values, which this leaves unchanged).
      new.archived_at := old.archived_at;
      new.archived_by := old.archived_by;
    else
      if old.holds_shared_number then
        raise exception 'A shared number holding record is never archived' using errcode = '42501';
      end if;
      if coalesce(app.is_technician(new.account_id), false) then
        raise exception 'A Technician cannot archive a customer' using errcode = '42501';
      end if;
      if new.archived_at is not null then
        new.archived_at := pg_catalog.now();
        -- Bare nullif: it is a SQL keyword construct, not a catalogue function, so it cannot be schema-qualified
        -- (pg_catalog.nullif does not exist) and no search_path can shadow it.
        new.archived_by := nullif(app.jwt() ->> 'sub', '');
      else
        new.archived_by := null;
      end if;
    end if;
  end if;
  return new;
end $$;
revoke all on function app.contacts_archive_stamp() from public, anon;
create trigger contacts_archive_stamp before insert or update of archived_at on public.contacts
  for each row execute function app.contacts_archive_stamp();

-- 5. The person's log row. DEFINER (it writes a table authenticated cannot). The role test is in WHEN,
--    which runs in the caller's context: inside a definer body current_user is the owner, never
--    'authenticated', so a test there would log nothing.
create function app.contacts_archive_log() returns trigger
language plpgsql security definer set search_path = pg_catalog, pg_temp as $$
begin
  insert into public.contact_archive_log (account_id, contact_id, action, author_kind, author_id)
  values (new.account_id, new.id,
          case when new.archived_at is null then 'restored' else 'archived' end,
          'person',
          coalesce(new.archived_by, nullif(app.jwt() ->> 'sub', '')));
  return null;
end $$;
revoke all on function app.contacts_archive_log() from public, anon, authenticated;
create trigger contacts_archive_log after update of archived_at on public.contacts
  for each row
  when (old.archived_at is distinct from new.archived_at and current_user = 'authenticated')
  execute function app.contacts_archive_log();

-- 6. The customer's own sign brings them back (owner ruling Q1). Service role only.
create function public.restore_contact_on_sign(p_account_id uuid, p_contact_id uuid, p_sign text)
returns boolean
language plpgsql security definer set search_path = pg_catalog, pg_temp as $$
declare
  v_id uuid;
begin
  update public.contacts set archived_at = null, archived_by = null
   where account_id = p_account_id and id = p_contact_id and archived_at is not null
  returning id into v_id;
  if v_id is null then
    return false;
  end if;
  insert into public.contact_archive_log (account_id, contact_id, action, author_kind, sign)
  values (p_account_id, v_id, 'restored', 'customer', p_sign);
  return true;
end $$;
revoke all on function public.restore_contact_on_sign(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.restore_contact_on_sign(uuid, uuid, text) to service_role;

-- 7. What keeps a contact from being deleted for good (spec section 5.1). ONE row per blocked contact,
--    so 500 ids answer at most 500 rows, under PostgREST max_rows. Definer: a reason the caller's RLS
--    hid would read as no reason (fail open).
create function public.contact_delete_blockers(p_account_id uuid, p_contact_ids uuid[])
returns table (contact_id uuid, reasons text[])
language plpgsql stable security definer set search_path = pg_catalog, pg_temp as $$
begin
  if p_contact_ids is null or pg_catalog.cardinality(p_contact_ids) > 500 then
    raise exception 'contact_delete_blockers: between 0 and 500 ids' using errcode = '22023';
  end if;
  return query
  select k.id, r.reasons
    from public.contacts k
    cross join lateral (
      select pg_catalog.array_agg(x.reason order by x.reason) as reasons from (
        select 'messages'::text as reason where exists (
          select 1 from public.conversations cv join public.messages m on m.conversation_id = cv.id
           where cv.account_id = p_account_id and cv.contact_id = k.id
             and m.account_id = p_account_id and m.channel <> 'note')
        union all select 'inbound_email' where exists (
          select 1 from public.conversations cv join public.inbound_emails ie
                 on ie.account_id = cv.account_id and ie.conversation_id = cv.id
           where cv.account_id = p_account_id and cv.contact_id = k.id)
        -- Two EXISTS, not one OR: each reads its own index (calls_contact_id, calls_conversation_id), where an OR
        -- across the two columns read every call of the account per contact.
        union all select 'calls' where exists (
          select 1 from public.calls x where x.account_id = p_account_id and x.contact_id = k.id)
          or exists (
          select 1 from public.conversations cv join public.calls x on x.conversation_id = cv.id
           where cv.account_id = p_account_id and cv.contact_id = k.id and x.account_id = p_account_id)
        union all select 'forms' where exists (
          select 1 from public.form_submissions x where x.account_id = p_account_id and x.contact_id = k.id)
        union all select 'consent' where exists (
          select 1 from public.consent_events x where x.account_id = p_account_id and x.contact_id = k.id)
        union all select 'automations' where exists (
          select 1 from public.automation_log x where x.account_id = p_account_id and x.contact_id = k.id and x.status = 'sent')
        union all select 'bookings' where exists (
          select 1 from public.bookings x where x.account_id = p_account_id and x.contact_id = k.id)
        union all select 'deals' where exists (
          select 1 from public.opportunities x where x.account_id = p_account_id and x.contact_id = k.id)
      ) x
    ) r
   where k.account_id = p_account_id and k.id = any (p_contact_ids) and r.reasons is not null;
end $$;
revoke all on function public.contact_delete_blockers(uuid, uuid[]) from public, anon, authenticated;
grant execute on function public.contact_delete_blockers(uuid, uuid[]) to service_role;

-- 8. Delete for good, internal-only contacts. The DATABASE keeps the Owner check (review I9): an Owner of THIS
--    account (app.is_account_owner, 0066:63, the agency included, with the 0066 policy's own account term), or
--    server code with a service_role JWT (PostgREST verifies the token before it sets request.jwt.claims, so a
--    client cannot claim the role; the e2e cleanup and the live suites call it so). Locks the contacts, then
--    their conversations, in id order, then re-reads the blockers inside the lock: each statement takes a fresh
--    snapshot under READ COMMITTED (the 0083 section 3 approach). The re-read is what keeps a contact that
--    gained a call, a form, a consent event, a sent automation or an inbound email after the caller read the
--    blockers: those foreign keys are ON DELETE SET NULL or cascade with the conversation, so nothing else
--    would stop the delete. Each contact in its own subtransaction, so one file the purge left behind
--    (documents_contact_fkey, NO ACTION) keeps that contact alone.
create function public.delete_internal_contacts(p_account_id uuid, p_contact_ids uuid[])
returns uuid[]
language plpgsql security definer set search_path = pg_catalog, pg_temp as $$
declare
  v_id uuid;
  v_deleted uuid[] := '{}';
begin
  -- The Owner check is the FIRST statement, before any validation or early return: the app's Owner pre-flight
  -- (deleteContacts, before the vault purge) calls this with an EMPTY array, so an "empty array, return early"
  -- above it would wave everyone through. An empty array is valid (0 to 500 ids), takes no lock and touches no row.
  -- The NULL path (re-review Critical, proven on PG18): app.current_account_id() is NULL when the account's
  -- client access is off or the token names no org (0008_client_access.sql:13-18), while is_account_owner keys
  -- on the token's sub alone (0066:63-66) and stays true. Bare, the account term is NULL, the whole test is
  -- `not (false or false or (NULL and true))` = NULL, and IF NULL never raises: it would fail OPEN. Two
  -- coalesces stand in the way, the one on the account term and the outer one on the whole expression; each
  -- alone refuses, and contact-archive-schema.test.ts proves the NULL path by removing both.
  if not coalesce(
       coalesce(app.jwt() ->> 'role', '') = 'service_role'
       or coalesce(app.is_agency(), false)
       or (coalesce(p_account_id = app.current_account_id(), false)
           and coalesce(app.is_account_owner(p_account_id), false)),
       false) then
    raise exception 'delete_internal_contacts: Owners only' using errcode = '42501';
  end if;
  if p_contact_ids is null or pg_catalog.cardinality(p_contact_ids) > 500 then
    raise exception 'delete_internal_contacts: between 0 and 500 ids' using errcode = '22023';
  end if;
  perform 1 from public.contacts k
   where k.account_id = p_account_id and k.id = any (p_contact_ids) order by k.id for update;
  perform 1 from public.conversations cv
   where cv.account_id = p_account_id and cv.contact_id = any (p_contact_ids) order by cv.id for update;
  for v_id in
    select k.id from public.contacts k
     where k.account_id = p_account_id and k.id = any (p_contact_ids)
       and not exists (select 1 from public.contact_delete_blockers(p_account_id, array[k.id]))
     order by k.id
  loop
    begin
      delete from public.messages m using public.conversations cv
       where m.conversation_id = cv.id and cv.account_id = p_account_id and cv.contact_id = v_id
         and m.account_id = p_account_id and m.channel = 'note';
      delete from public.conversations cv where cv.account_id = p_account_id and cv.contact_id = v_id;
      delete from public.contacts k where k.account_id = p_account_id and k.id = v_id;
      v_deleted := v_deleted || v_id;
    exception when foreign_key_violation then
      null;  -- kept: a row still points at it (a file the purge did not clear). The caller reports it.
    end;
  end loop;
  return v_deleted;
end $$;
revoke all on function public.delete_internal_contacts(uuid, uuid[]) from public, anon;
grant execute on function public.delete_internal_contacts(uuid, uuid[]) to authenticated, service_role;

-- 9. The Archived view: keyed on its DEFAULT order (created_at desc, id desc; listContacts' default sort,
--    contacts.ts SORT_COLUMN), so its first page and its count read only archived rows (review M4). The other
--    sorts (name, company) use the existing sort indexes with this filter.
create index contacts_account_archived_created on public.contacts (account_id, created_at desc, id desc)
  where archived_at is not null;

-- 10. The inbox rule (owner decision 2026-10-28, review I8): an archived contact's thread leaves the inbox only
--     while nothing in it is unread. contact_archived follows the contact; inbox_visible is the one column the
--     inbox and search filter on, so neither needs an OR across an embed.
alter table public.conversations
  add column contact_archived boolean not null default false,
  add column inbox_visible boolean generated always as (not contact_archived or unread_count > 0) stored;

create function app.conversations_follow_contact_archive() returns trigger
language plpgsql security definer set search_path = pg_catalog, pg_temp as $$
begin
  update public.conversations set contact_archived = (new.archived_at is not null)
   where account_id = new.account_id and contact_id = new.id;
  return null;
end $$;
revoke all on function app.conversations_follow_contact_archive() from public, anon, authenticated;
create trigger contacts_archive_to_conversations after update of archived_at on public.contacts
  for each row when (old.archived_at is distinct from new.archived_at)
  execute function app.conversations_follow_contact_archive();

create function app.conversation_contact_archived() returns trigger
language plpgsql security definer set search_path = pg_catalog, pg_temp as $$
begin
  new.contact_archived := coalesce((select k.archived_at is not null from public.contacts k
                                     where k.account_id = new.account_id and k.id = new.contact_id), false);
  return new;
end $$;
revoke all on function app.conversation_contact_archived() from public, anon, authenticated;
-- On EVERY insert and update, not only `of contact_id` (re-review minor): an archive that commits while a
-- conversation row is being written can leave contact_archived stale, and re-deriving it on each touch (every
-- message bumps last_message_at, every read clears unread) heals it at the next write. One PK lookup per write.
create trigger conversations_contact_archived before insert or update on public.conversations
  for each row execute function app.conversation_contact_archived();

-- 11. Indexes for the delete and the blockers on Postgres 17 (production), which has no skip scan: a lookup on a
--     column that only appears second in an index (messages_thread, calls_account_contact,
--     form_submissions_contact, conversations_account_contact_unique all lead on account_id) reads the whole
--     index or table there. Each foreign key that a contact or conversation delete has to check or clear gets an
--     index leading on its own column; the blockers read the same ones. Partial where the column is nullable:
--     the foreign key's lookup (col equal to a value) implies col is not null, so the partial index serves it.
create index calls_contact_id on public.calls (contact_id) where contact_id is not null;
create index calls_conversation_id on public.calls (conversation_id) where conversation_id is not null;
create index automation_log_contact_id on public.automation_log (contact_id) where contact_id is not null;
create index form_submissions_contact_id on public.form_submissions (contact_id) where contact_id is not null;
create index messages_conversation_id on public.messages (conversation_id);
create index conversations_contact_id on public.conversations (contact_id);
