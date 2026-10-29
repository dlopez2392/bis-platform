-- 0106_contact_merge.sql - duplicates found the Valley way, and a reversible merge (F-006 part 1, with S-12)
-- (docs/superpowers/specs/2026-10-29-dedupe-merge-design.md sections 3, 4 and 14;
--  docs/superpowers/plans/2026-10-29-dedupe-merge.md, Task 1 (part A, sections 0-13) and Task 3 (part B))
--
-- WHY. The same customer lands in the contact list twice: once from a call (+52 1 899...), once from a form
-- (+52 899...); once as "Maria Garcia", once as "Maria Garcia Lopez" with the accents typed. The only queue for
-- such pairs (contact_duplicate_flags, 0033) is filled by a few TypeScript writers on a few paths, has no way
-- to say "not the same person", and nothing can merge a pair. The owner ruled (spec section 13): phone, email
-- and same-name pairs (name last), the older record kept by default, Undo for 30 days, and a phone or address
-- the merge did not keep still reaches the kept customer.
--
-- WHAT (part A).
--   app.phone_national(text), app.phone_family(text): the ten national digits of any +1 or +52 shape (legacy
--     521, 044, 045 and 01 too), else the digits key; and which family ('us', 'mx' or null) the digits are.
--   app.contact_name_fold(text), app.contact_name_key(text, text): one translate() maps A-Z, four separators,
--     six whitespace characters and the 48 accented letters of Spanish and Portuguese names; everything outside
--     [a-z0-9 ] is then dropped (no lower(): the answer cannot depend on the database's ctype). The key is
--     "first|first surname" (leading particles kept), null with no surname or a placeholder first name.
--     Their TypeScript twins: packages/db/src/dedupe-keys.ts, compared shape by shape in
--     contact-dedupe-schema.test.ts.
--   contacts.merged_into, contacts.merged_at: a merged-away record (a tombstone) points at the kept one. Both
--     null or both set; never itself; (account_id, merged_into) references contacts (NO ACTION).
--   contacts.phone_national, contacts.name_key: stored generated keys, account-first partial indexes.
--   app.contacts_tombstone_server_only(): plain, not definer (0098's contacts_holding_server_only shape). For a
--     signed-in session: an insert is never born a tombstone; a tombstone is never updated or deleted (42501);
--     the pointer never changes. Server code is not limited.
--   public.contact_merges: the merge log (written by part B's definers only), cascading with either contact.
--   contact_duplicate_flags: dismissed_at, dismissed_by, merge_id (-> contact_merges, on delete set null), and
--     strength, generated from reason (lower is stronger; same_name 9, last). Indexes on contact_a, contact_b,
--     merge_id and the open list; and tasks(contact_id).
--   app.contacts_flag_pairs(): DEFINER, after insert or update of phone, email, first_name, last_name: files each
--     pair by phone_national (same_phone, or same_digits across the +1 and +52 families), email_key (same_email)
--     and name_key (same_name), strongest first, at most 20 matches per key per write, skipping holding records
--     and tombstones, on conflict do nothing (which keeps the first reason AND a dismissal). Then a one-time
--     backfill in the same order.
--   app.may_merge(account): the one who-check (a service_role JWT, the agency, or an Owner or Staff of this
--     account whose token is in it), with 0103's two coalesces.
--   app.open_duplicate_pairs(...): INVOKER; the open pairs with the read-time filters (no tombstone or holding
--     side, no relationship between the two, no shared household for a phone reason), with the contact filter,
--     the cursor and the limit as its own parameters (a function that sets search_path is never inlined).
--   public.duplicate_pairs_page / duplicate_pairs_count / duplicate_pairs_of: INVOKER wrappers over it.
--   public.dismiss_duplicate_pair / undismiss_duplicate_pair: DEFINER, behind app.may_merge.
--   public.contact_delete_blockers: 0103's body plus the reason 'merges' (a merge not undone names both sides).
--   public.ai_contact_held_by: 0092's body plus the reason 'contact_merges' (the same rule).
--
-- GRANTS. contact_duplicate_flags: authenticated loses table INSERT, UPDATE and DELETE and keeps SELECT and
-- INSERT on four columns (account_id, contact_a, contact_b, reason) for the TypeScript writers (plan
-- correction 2): EXPECTED_WRITES in schema-grants-guard.test.ts changes, and the client-write digest in
-- proposals-drop.test.ts moves 52 -> 49. contact_merges: SELECT on ten columns to authenticated through its
-- policy (plan review m8c: never the snapshots or the reply token), select/insert/update/delete to
-- service_role, nothing to anon; its identity sequence keeps no anon or authenticated privilege. merged_into
-- and merged_at get no client grant (contacts' column UPDATE grants are unchanged; the guard owns INSERT).
-- Functions: the three key functions EXECUTE for authenticated and service_role (a stored generated column
-- runs its function as the WRITING role, plan correction 3); app.phone_family and app.may_merge the owner
-- only (plus service_role for phone_family); app.open_duplicate_pairs and the three list functions
-- authenticated and service_role; dismiss and undismiss authenticated and service_role; the two trigger functions
-- lose PUBLIC and anon, the definer one authenticated too (0103's shape; a trigger function cannot be called outside
-- its trigger). anon executes nothing (the default ACL grants anon by name, so every revoke names it).
-- Three definers join EXPECTED_DEFINERS in definer-search-path.test.ts (29 -> 32): app.contacts_flag_pairs,
-- public.dismiss_duplicate_pair, public.undismiss_duplicate_pair.
--
-- SEARCH PATHS. Every function here says set search_path = pg_catalog, pg_temp (the 0096 rule), and names
-- every relation and app function by schema.
--
-- LOCKS AND COST. The file runs as one transaction; lock_timeout 5s below bounds only the WAIT to take each
-- lock, not the work done under it.
--   contacts: the four columns go in ONE alter table, so the two STORED generated columns rewrite contacts
--     once, under ACCESS EXCLUSIVE held to the end of the file: every contact read and write waits for it.
--     MEASURED on a real PostgreSQL 17.6 replica (pre = 0001-0104, one account, 10,000 contacts, laptop SSD,
--     psql -1, three runs): the alter table 0.94 to 1.05 s; the whole file 1.58 to 1.77 s. (The plan's first draft,
--     with the name key a sql function calling a sql function, took 12.0 to 12.5 s for the same alter table: see
--     section 1.) Every contact insert, and every update of a phone or a name, computes both keys: about 0.1 ms.
--     Production held 53 contacts and 0 flags on 2026-10-29: no off-peak rule.
--   contact_duplicate_flags gains three plain columns and one stored generated column (a rewrite of a table
--     production holds 0 rows of), tasks one index (SHARE on tasks until the file commits).
--
-- LOAD-BEARING. From plan Task 4 on, the app names merged_into in contacts' COLS and in every list read, so it
-- merges only after this file is on production. The app before that keeps working, with one change in kind:
-- a pair it writes that the trigger already filed answers 23505, which every TypeScript writer treats as the
-- designed no-op, so the pair carries the trigger's reason (plan correction 6; plan Task 4 moves the live pins).
--
-- ROLLBACK (roll the app back first; undo every live merge first, see part B), in this order:
--   drop function public.undismiss_duplicate_pair(uuid, uuid, text), public.dismiss_duplicate_pair(uuid, uuid, text);
--   drop function public.duplicate_pairs_of(uuid, uuid), public.duplicate_pairs_count(uuid),
--     public.duplicate_pairs_page(uuid, integer, smallint, timestamptz, uuid);
--   drop function app.open_duplicate_pairs(uuid, uuid, smallint, timestamptz, uuid, integer), app.may_merge(uuid);
--   drop trigger contacts_flag_pairs on public.contacts; drop function app.contacts_flag_pairs();
--   drop trigger contacts_tombstone_server_only on public.contacts; drop function app.contacts_tombstone_server_only();
--   re-run 0103's create function public.contact_delete_blockers (section 7) as create or replace, and 0092's
--     public.ai_contact_held_by as create or replace with set search_path = pg_catalog, pg_temp (0096);
--   drop index public.tasks_contact_id;
--   drop index public.contact_duplicate_flags_open, public.contact_duplicate_flags_a, public.contact_duplicate_flags_b,
--     public.contact_duplicate_flags_merge;
--   alter table public.contact_duplicate_flags drop constraint contact_duplicate_flags_dismissed_pair,
--     drop column strength, drop column merge_id, drop column dismissed_by, drop column dismissed_at;
--   drop policy contact_duplicate_flags_member_insert on public.contact_duplicate_flags;
--   drop policy contact_duplicate_flags_member_read on public.contact_duplicate_flags;
--   create policy contact_duplicate_flags_member_all exactly as 0033 (0033_contact_dedupe_keys.sql, its last
--     statement) and grant insert, update, delete on public.contact_duplicate_flags to authenticated;
--   drop table public.contact_merges;
--   drop index public.contacts_account_name_key, public.contacts_account_phone_national, public.contacts_account_merged_into;
--   alter table public.contacts drop constraint contacts_merged_into_fkey, drop constraint contacts_not_merged_into_self,
--     drop constraint contacts_merged_pair, drop column name_key, drop column phone_national, drop column merged_at,
--     drop column merged_into;
--   drop function app.contact_name_key(text, text), app.contact_name_fold(text), app.phone_family(text), app.phone_national(text).
--   (Flags the trigger and the backfill filed stay: they are rows of a table that existed before this file. anon's
--   SELECT on contact_duplicate_flags, a default-ACL grant 0033 never revoked and no policy let anon read through,
--   is not restored. Proven on the PG17 replica: after these statements the columns, constraints, indexes and
--   policies of contacts, contact_duplicate_flags and tasks, the contacts triggers, every function body, setting and
--   ACL in public and app, and every anon and authenticated table and column privilege equal pre-0106 but that one.)
--
-- ASCII only, no backslash anywhere, and every dollar sign in this file is part of a dollar-quote pair.

-- 0. Fail fast instead of queueing behind a long lock.
do $$
begin
  perform pg_catalog.set_config('lock_timeout', '5s', true);
end $$;

-- 1. The comparison keys. A stored generated column runs its function as the WRITING role (plan correction 3),
--    so these keep EXECUTE for authenticated and service_role, and call no service-only helper.
--    k below holds digits only (every other character is stripped first), so a length and a prefix say what the
--    twin's anchored [0-9]{n} patterns say, with no dollar sign outside a dollar-quote pair.
create function app.phone_national(p_phone text) returns text
language sql immutable parallel safe set search_path = pg_catalog, pg_temp as $$
  select case
           when y.k is null then null
           when pg_catalog.length(y.k) = 10 then y.k
           when (pg_catalog.length(y.k) = 13 and pg_catalog.left(y.k, 3) in ('521', '044', '045'))
             or (pg_catalog.length(y.k) = 12 and pg_catalog.left(y.k, 2) in ('52', '01')) then pg_catalog.right(y.k, 10)
           else y.k
         end
    from (select case
                   when pg_catalog.length(x.d) = 11 and pg_catalog.left(x.d, 1) = '1' then pg_catalog.substr(x.d, 2)
                   else nullif(x.d, '')
                 end as k
            from (select pg_catalog.regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g') as d) as x) as y
$$;

create function app.phone_family(p_phone text) returns text
language sql immutable parallel safe set search_path = pg_catalog, pg_temp as $$
  select case
           when y.k is null then null
           when pg_catalog.length(y.k) = 10 then 'us'
           when (pg_catalog.length(y.k) = 13 and pg_catalog.left(y.k, 3) in ('521', '044', '045'))
             or (pg_catalog.length(y.k) = 12 and pg_catalog.left(y.k, 2) in ('52', '01')) then 'mx'
           else null
         end
    from (select case
                   when pg_catalog.length(x.d) = 11 and pg_catalog.left(x.d, 1) = '1' then pg_catalog.substr(x.d, 2)
                   else nullif(x.d, '')
                 end as k
            from (select pg_catalog.regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g') as d) as x) as y
$$;

-- No lower(): one translate maps A-Z, four separators, six whitespace characters and the 48 accented letters,
-- then everything outside [a-z0-9 ] is dropped. The answer cannot depend on the database's ctype.
-- The translate source is one constant expression (chr() is immutable), so the planner folds it once per plan:
-- built by a subquery (string_agg over an array) it cost 70 microseconds a call, and the rewrite of 10,000
-- contacts took 12.3 s instead of the time in LOCKS AND COST.
create function app.contact_name_fold(p text) returns text
language sql immutable parallel safe set search_path = pg_catalog, pg_temp as $$
  select pg_catalog.btrim(
           pg_catalog.regexp_replace(
             pg_catalog.regexp_replace(
               pg_catalog.translate(coalesce(p, ''),
                 'ABCDEFGHIJKLMNOPQRSTUVWXYZ-.,'''
                   || pg_catalog.chr(9) || pg_catalog.chr(10) || pg_catalog.chr(11) || pg_catalog.chr(12) || pg_catalog.chr(13) || pg_catalog.chr(160)
                   || pg_catalog.chr(192) || pg_catalog.chr(193) || pg_catalog.chr(194) || pg_catalog.chr(195) || pg_catalog.chr(196) || pg_catalog.chr(199) || pg_catalog.chr(200) || pg_catalog.chr(201)
                   || pg_catalog.chr(202) || pg_catalog.chr(203) || pg_catalog.chr(204) || pg_catalog.chr(205) || pg_catalog.chr(206) || pg_catalog.chr(207) || pg_catalog.chr(209) || pg_catalog.chr(210)
                   || pg_catalog.chr(211) || pg_catalog.chr(212) || pg_catalog.chr(213) || pg_catalog.chr(214) || pg_catalog.chr(217) || pg_catalog.chr(218) || pg_catalog.chr(219) || pg_catalog.chr(220)
                   || pg_catalog.chr(224) || pg_catalog.chr(225) || pg_catalog.chr(226) || pg_catalog.chr(227) || pg_catalog.chr(228) || pg_catalog.chr(231) || pg_catalog.chr(232) || pg_catalog.chr(233)
                   || pg_catalog.chr(234) || pg_catalog.chr(235) || pg_catalog.chr(236) || pg_catalog.chr(237) || pg_catalog.chr(238) || pg_catalog.chr(239) || pg_catalog.chr(241) || pg_catalog.chr(242)
                   || pg_catalog.chr(243) || pg_catalog.chr(244) || pg_catalog.chr(245) || pg_catalog.chr(246) || pg_catalog.chr(249) || pg_catalog.chr(250) || pg_catalog.chr(251) || pg_catalog.chr(252),
                 'abcdefghijklmnopqrstuvwxyz' || '    ' || '      '
                   || 'aaaaaceeeeiiiinooooouuuu' || 'aaaaaceeeeiiiinooooouuuu'),
               '[^a-z0-9 ]', '', 'g'),
             ' +', ' ', 'g'),
           ' ')
$$;

-- plpgsql, not sql: a sql function calling another sql function re-plans the inner one on every outer call (no
-- plan survives the outer call's executor), which made this key cost 1.4 ms a row on PG17. plpgsql keeps the
-- inner call's state for the transaction.
create function app.contact_name_key(p_first text, p_last text) returns text
language plpgsql immutable parallel safe set search_path = pg_catalog, pg_temp as $$
declare
  v_first text := app.contact_name_fold(p_first);
  v_surname text := pg_catalog.substring(app.contact_name_fold(p_last), '^(((de|del|la|las|los|y|san|santa) )*[a-z0-9]+)');
begin
  if v_first = '' or v_first = any (array['caller', 'unknown', 'desconocido', 'cliente', 'customer', 'na', 'none', 'sin nombre'])
     or v_surname is null or v_surname = '' then
    return null;
  end if;
  return v_first || '|' || v_surname;
end $$;

revoke all on function app.phone_national(text) from public, anon;
revoke all on function app.contact_name_fold(text) from public, anon;
revoke all on function app.contact_name_key(text, text) from public, anon;
grant execute on function app.phone_national(text) to authenticated, service_role;
grant execute on function app.contact_name_fold(text) to authenticated, service_role;
grant execute on function app.contact_name_key(text, text) to authenticated, service_role;
revoke all on function app.phone_family(text) from public, anon, authenticated;
grant execute on function app.phone_family(text) to service_role;

-- 2. The pointer and the keys, in ONE alter table: contacts is rewritten once.
alter table public.contacts
  add column merged_into uuid,
  add column merged_at timestamptz,
  add column phone_national text generated always as (app.phone_national(phone)) stored,
  add column name_key text generated always as (app.contact_name_key(first_name, last_name)) stored;
alter table public.contacts
  add constraint contacts_merged_pair check ((merged_into is null) = (merged_at is null)),
  add constraint contacts_not_merged_into_self check (merged_into is distinct from id),
  -- NO ACTION: a kept record with tombstones pointing at it cannot vanish under them.
  add constraint contacts_merged_into_fkey foreign key (account_id, merged_into) references public.contacts (account_id, id);
create index contacts_account_merged_into on public.contacts (account_id, merged_into) where merged_into is not null;
create index contacts_account_phone_national on public.contacts (account_id, phone_national) where phone_national is not null;
create index contacts_account_name_key on public.contacts (account_id, name_key) where name_key is not null;

-- 3. A tombstone is server code's alone (0098's contacts_holding_server_only shape: plain, not definer). For a signed-in
--    session: an insert is never born a tombstone; a tombstone is never updated or deleted; the pointer never changes.
create function app.contacts_tombstone_server_only() returns trigger
language plpgsql set search_path = pg_catalog, pg_temp as $$
begin
  if coalesce(current_user = 'authenticated', false) then
    if tg_op = 'INSERT' then
      new.merged_into := null;
      new.merged_at := null;
      return new;
    end if;
    if old.merged_into is not null then
      raise exception 'A merged record is changed by server code only' using errcode = '42501';
    end if;
    if tg_op = 'DELETE' then
      return old;
    end if;
    new.merged_into := old.merged_into;
    new.merged_at := old.merged_at;
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end $$;
revoke all on function app.contacts_tombstone_server_only() from public, anon;
create trigger contacts_tombstone_server_only before insert or update or delete on public.contacts
  for each row execute function app.contacts_tombstone_server_only();

-- 4. The merge log (spec 4.2; plan corrections 7, 9, 15).
create table public.contact_merges (
  id bigint generated always as identity primary key,
  account_id uuid not null,
  keep_id uuid not null,
  other_id uuid not null,
  merged_by text not null,
  merged_at timestamptz not null default pg_catalog.now(),
  undo_until timestamptz not null,
  keep_before jsonb not null,
  keep_after jsonb not null,
  choices jsonb not null,
  moved jsonb not null,
  moved_counts jsonb not null,
  removed jsonb not null,
  unread_handed integer not null default 0,
  other_reply_token text,
  undone_at timestamptz,
  undone_by text,
  constraint contact_merges_undone_pair check ((undone_at is null) = (undone_by is null)),
  constraint contact_merges_two check (keep_id <> other_id),
  constraint contact_merges_window check (undo_until = merged_at + interval '30 days'),
  constraint contact_merges_keep_fkey foreign key (account_id, keep_id) references public.contacts (account_id, id) on delete cascade,
  constraint contact_merges_other_fkey foreign key (account_id, other_id) references public.contacts (account_id, id) on delete cascade
);
create index contact_merges_keep on public.contact_merges (account_id, keep_id, merged_at desc, id desc);
create index contact_merges_other on public.contact_merges (account_id, other_id);
create unique index contact_merges_reply_token on public.contact_merges (other_reply_token)
  where other_reply_token is not null and undone_at is null;
alter table public.contact_merges enable row level security;
revoke all on public.contact_merges from anon, authenticated;
-- The default ACL also grants the identity sequence to anon and authenticated; nothing but service code inserts here.
revoke all on sequence public.contact_merges_id_seq from anon, authenticated;
-- Ten columns only (plan review m8c): the policy below admits a Technician to the merges of a kept record assigned to
-- them, and the snapshots (removed, moved, keep_before, keep_after, choices) and other_reply_token are not theirs to
-- read. These are exactly the columns the timeline selects (plan Task 9).
grant select (id, account_id, keep_id, other_id, merged_by, merged_at, undo_until, moved_counts, undone_at, undone_by)
  on public.contact_merges to authenticated;
grant select, insert, update, delete on public.contact_merges to service_role;
-- Through the kept record, so contacts' own policies (0068's Technician fence included) decide (0103's log shape).
create policy contact_merges_read on public.contact_merges for select to authenticated
  using (exists (select 1 from public.contacts c where c.account_id = contact_merges.account_id and c.id = contact_merges.keep_id));

-- 5. The pair queue gains a decision and an order.
alter table public.contact_duplicate_flags
  add column dismissed_at timestamptz,
  add column dismissed_by text,
  add column merge_id bigint references public.contact_merges (id) on delete set null,
  add column strength smallint generated always as (case reason
    when 'same_phone' then 1 when 'same_email' then 2 when 'email_phone_conflict' then 3
    when 'same_digits' then 4 when 'phone_country_twin' then 4 when 'phone_shared_new_person' then 5
    when 'hidden_match' then 6 when 'phone_match_on_edit' then 7 when 'email_match_on_edit' then 7
    when 'phone_country_pick' then 7 when 'same_name' then 9 else 8 end) stored;
alter table public.contact_duplicate_flags
  add constraint contact_duplicate_flags_dismissed_pair check ((dismissed_at is null) = (dismissed_by is null));
create index contact_duplicate_flags_open on public.contact_duplicate_flags (account_id, strength, created_at desc, id desc)
  where dismissed_at is null and merge_id is null;
-- Plan correction 1: the pair index leads on account_id, so neither contact column had an index of its own.
create index contact_duplicate_flags_a on public.contact_duplicate_flags (contact_a);
create index contact_duplicate_flags_b on public.contact_duplicate_flags (contact_b);
create index contact_duplicate_flags_merge on public.contact_duplicate_flags (merge_id) where merge_id is not null;
create index tasks_contact_id on public.tasks (contact_id) where contact_id is not null;

-- Plan correction 2: the client keeps INSERT on four columns (the TypeScript writers); dismissal and merge_id are
-- written only by the definers below. 0068's restrictive Technician policy stays as it is.
drop policy contact_duplicate_flags_member_all on public.contact_duplicate_flags;
create policy contact_duplicate_flags_member_read on public.contact_duplicate_flags for select to authenticated
  using (app.is_agency() or account_id = app.current_account_id());
create policy contact_duplicate_flags_member_insert on public.contact_duplicate_flags for insert to authenticated
  with check (app.is_agency() or account_id = app.current_account_id());
revoke all on public.contact_duplicate_flags from anon, authenticated;
grant select on public.contact_duplicate_flags to authenticated;
grant insert (account_id, contact_a, contact_b, reason) on public.contact_duplicate_flags to authenticated;

-- 6. The database files every pair (spec 3.5). DEFINER: a Technician's own client cannot see a contact outside their
--    assignment (0068), and a pair it cannot see must still be queued. Strongest reason first; on conflict do nothing
--    keeps the first reason AND a dismissal. At most 20 matches per key per write.
create function app.contacts_flag_pairs() returns trigger
language plpgsql security definer set search_path = pg_catalog, pg_temp as $$
begin
  if tg_op = 'UPDATE' and old.phone_national is not distinct from new.phone_national
     and old.email_key is not distinct from new.email_key and old.name_key is not distinct from new.name_key then
    return null;
  end if;
  if new.phone_national is not null then
    insert into public.contact_duplicate_flags (account_id, contact_a, contact_b, reason)
    select new.account_id, least(new.id, m.id), greatest(new.id, m.id),
           case when app.phone_family(new.phone) is not distinct from app.phone_family(m.phone) then 'same_phone' else 'same_digits' end
      from (select c.id, c.phone from public.contacts c
             where c.account_id = new.account_id and c.phone_national = new.phone_national and c.id <> new.id
               and not c.holds_shared_number and c.merged_into is null
             order by c.created_at, c.id limit 20) as m
    on conflict (account_id, contact_a, contact_b) do nothing;
  end if;
  if new.email_key is not null then
    insert into public.contact_duplicate_flags (account_id, contact_a, contact_b, reason)
    select new.account_id, least(new.id, m.id), greatest(new.id, m.id), 'same_email'
      from (select c.id from public.contacts c
             where c.account_id = new.account_id and c.email_key = new.email_key and c.id <> new.id
               and not c.holds_shared_number and c.merged_into is null
             order by c.created_at, c.id limit 20) as m
    on conflict (account_id, contact_a, contact_b) do nothing;
  end if;
  if new.name_key is not null then
    insert into public.contact_duplicate_flags (account_id, contact_a, contact_b, reason)
    select new.account_id, least(new.id, m.id), greatest(new.id, m.id), 'same_name'
      from (select c.id from public.contacts c
             where c.account_id = new.account_id and c.name_key = new.name_key and c.id <> new.id
               and not c.holds_shared_number and c.merged_into is null
             order by c.created_at, c.id limit 20) as m
    on conflict (account_id, contact_a, contact_b) do nothing;
  end if;
  return null;
end $$;
revoke all on function app.contacts_flag_pairs() from public, anon, authenticated;
create trigger contacts_flag_pairs after insert or update of phone, email, first_name, last_name on public.contacts
  for each row when (new.merged_into is null and not new.holds_shared_number)
  execute function app.contacts_flag_pairs();

-- 7. The backfill, once: phone, then email, then name, so the strongest reason stands.
insert into public.contact_duplicate_flags (account_id, contact_a, contact_b, reason)
select a.account_id, a.id, b.id,
       case when app.phone_family(a.phone) is not distinct from app.phone_family(b.phone) then 'same_phone' else 'same_digits' end
  from public.contacts a join public.contacts b on b.account_id = a.account_id and b.phone_national = a.phone_national and a.id < b.id
 where a.phone_national is not null and not a.holds_shared_number and not b.holds_shared_number
on conflict (account_id, contact_a, contact_b) do nothing;
insert into public.contact_duplicate_flags (account_id, contact_a, contact_b, reason)
select a.account_id, a.id, b.id, 'same_email'
  from public.contacts a join public.contacts b on b.account_id = a.account_id and b.email_key = a.email_key and a.id < b.id
 where a.email_key is not null and not a.holds_shared_number and not b.holds_shared_number
on conflict (account_id, contact_a, contact_b) do nothing;
insert into public.contact_duplicate_flags (account_id, contact_a, contact_b, reason)
select a.account_id, a.id, b.id, 'same_name'
  from public.contacts a join public.contacts b on b.account_id = a.account_id and b.name_key = a.name_key and a.id < b.id
 where a.name_key is not null and not a.holds_shared_number and not b.holds_shared_number
on conflict (account_id, contact_a, contact_b) do nothing;

-- 8. The one who-check (plan correction 20; 0103's shape, both coalesces: current_account_id() is NULL when client
--    access is off, and without them IF NOT (NULL) never raises).
create function app.may_merge(p_account_id uuid) returns boolean
language sql stable set search_path = pg_catalog, pg_temp as $$
  select coalesce(
           coalesce(app.jwt() ->> 'role', '') = 'service_role'
           or coalesce(app.is_agency(), false)
           or (coalesce(p_account_id = app.current_account_id(), false)
               and coalesce(app.sees_all_customers(p_account_id), false)),
           false)
$$;
revoke all on function app.may_merge(uuid) from public, anon, authenticated, service_role;

-- 9. The open pairs, with the read-time filters (spec 6.2; plan correction 14). INVOKER: the caller's RLS decides, so
--    a Technician reads nothing (0068's restrictive policy). Rows and total share this one function. The contact
--    filter, the cursor and the limit are its OWN parameters (plan review m5): a function that sets search_path is
--    never inlined, so a filter its caller applied would run only after every open pair of the account was read.
create function app.open_duplicate_pairs(
  p_account_id uuid, p_contact_id uuid default null, p_after_strength smallint default null,
  p_after_created_at timestamptz default null, p_after_id uuid default null, p_limit integer default null)
returns table (id uuid, contact_a uuid, contact_b uuid, reason text, strength smallint, created_at timestamptz,
               a_first_name text, a_last_name text, b_first_name text, b_last_name text)
language sql stable set search_path = pg_catalog, pg_temp as $$
  select f.id, f.contact_a, f.contact_b, f.reason, f.strength, f.created_at, a.first_name, a.last_name, b.first_name, b.last_name
    from public.contact_duplicate_flags f
    join public.contacts a on a.account_id = f.account_id and a.id = f.contact_a
    join public.contacts b on b.account_id = f.account_id and b.id = f.contact_b
   where f.account_id = p_account_id
     and f.dismissed_at is null and f.merge_id is null
     and (p_contact_id is null or f.contact_a = p_contact_id or f.contact_b = p_contact_id)
     and (p_after_id is null
          or f.strength > p_after_strength
          or (f.strength = p_after_strength
              and (f.created_at < p_after_created_at or (f.created_at = p_after_created_at and f.id < p_after_id))))
     and a.merged_into is null and b.merged_into is null
     and not a.holds_shared_number and not b.holds_shared_number
     and not exists (
       select 1 from public.contact_relationships r
        where r.account_id = f.account_id
          and ((r.contact_id = f.contact_a and r.related_contact_id = f.contact_b)
            or (r.contact_id = f.contact_b and r.related_contact_id = f.contact_a)))
     and not (f.reason in ('same_phone', 'same_digits', 'phone_country_twin', 'phone_shared_new_person', 'phone_match_on_edit', 'phone_country_pick')
              and exists (
                select 1 from public.client_group_members ma
                  join public.client_group_members mb on mb.account_id = ma.account_id and mb.client_group_id = ma.client_group_id
                  join public.client_groups g on g.account_id = ma.account_id and g.id = ma.client_group_id
                 where ma.account_id = f.account_id and ma.contact_id = f.contact_a
                   and mb.contact_id = f.contact_b and g.kind = 'household'))
   order by f.strength asc, f.created_at desc, f.id desc
   limit p_limit
$$;

create function public.duplicate_pairs_page(
  p_account_id uuid, p_limit integer, p_after_strength smallint default null,
  p_after_created_at timestamptz default null, p_after_id uuid default null)
returns table (id uuid, contact_a uuid, contact_b uuid, reason text, strength smallint, created_at timestamptz,
               a_first_name text, a_last_name text, b_first_name text, b_last_name text)
language sql stable set search_path = pg_catalog, pg_temp as $$
  select * from app.open_duplicate_pairs(p_account_id, null, p_after_strength, p_after_created_at, p_after_id,
                                         least(greatest(coalesce(p_limit, 50), 1), 101))
$$;

create function public.duplicate_pairs_count(p_account_id uuid) returns integer
language sql stable set search_path = pg_catalog, pg_temp as $$
  select pg_catalog.count(*)::integer from app.open_duplicate_pairs(p_account_id)
$$;

create function public.duplicate_pairs_of(p_account_id uuid, p_contact_id uuid)
returns table (id uuid, contact_a uuid, contact_b uuid, reason text, strength smallint, created_at timestamptz,
               a_first_name text, a_last_name text, b_first_name text, b_last_name text)
language sql stable set search_path = pg_catalog, pg_temp as $$
  select * from app.open_duplicate_pairs(p_account_id, p_contact_id, null, null, null, 20)
$$;

revoke all on function app.open_duplicate_pairs(uuid, uuid, smallint, timestamptz, uuid, integer) from public, anon;
grant execute on function app.open_duplicate_pairs(uuid, uuid, smallint, timestamptz, uuid, integer) to authenticated, service_role;
revoke all on function public.duplicate_pairs_page(uuid, integer, smallint, timestamptz, uuid) from public, anon;
grant execute on function public.duplicate_pairs_page(uuid, integer, smallint, timestamptz, uuid) to authenticated, service_role;
revoke all on function public.duplicate_pairs_count(uuid) from public, anon;
grant execute on function public.duplicate_pairs_count(uuid) to authenticated, service_role;
revoke all on function public.duplicate_pairs_of(uuid, uuid) from public, anon;
grant execute on function public.duplicate_pairs_of(uuid, uuid) to authenticated, service_role;

-- 10. "Not the same person" (D11): never suggested again, with Undo. Definers: the client holds no UPDATE here.
create function public.dismiss_duplicate_pair(p_account_id uuid, p_flag_id uuid, p_actor text default null)
returns jsonb
language plpgsql security definer set search_path = pg_catalog, pg_temp as $$
declare
  v_id uuid;
  v_actor text;
begin
  if not app.may_merge(p_account_id) then
    raise exception 'dismiss_duplicate_pair: Owners, Staff and the agency only' using errcode = '42501';
  end if;
  v_actor := case when coalesce(app.jwt() ->> 'role', '') = 'service_role' then nullif(p_actor, '')
                  else nullif(app.jwt() ->> 'sub', '') end;
  if v_actor is null then
    raise exception 'dismiss_duplicate_pair: no actor' using errcode = '22023';
  end if;
  update public.contact_duplicate_flags f set dismissed_at = pg_catalog.now(), dismissed_by = v_actor
   where f.account_id = p_account_id and f.id = p_flag_id and f.dismissed_at is null and f.merge_id is null
  returning f.id into v_id;
  return pg_catalog.jsonb_build_object('status', case when v_id is null then 'not_found' else 'dismissed' end);
end $$;

create function public.undismiss_duplicate_pair(p_account_id uuid, p_flag_id uuid, p_actor text default null)
returns jsonb
language plpgsql security definer set search_path = pg_catalog, pg_temp as $$
declare
  v_id uuid;
begin
  if not app.may_merge(p_account_id) then
    raise exception 'undismiss_duplicate_pair: Owners, Staff and the agency only' using errcode = '42501';
  end if;
  update public.contact_duplicate_flags f set dismissed_at = null, dismissed_by = null
   where f.account_id = p_account_id and f.id = p_flag_id and f.dismissed_at is not null
  returning f.id into v_id;
  return pg_catalog.jsonb_build_object('status', case when v_id is null then 'not_found' else 'restored' end);
end $$;
revoke all on function public.dismiss_duplicate_pair(uuid, uuid, text) from public, anon;
grant execute on function public.dismiss_duplicate_pair(uuid, uuid, text) to authenticated, service_role;
revoke all on function public.undismiss_duplicate_pair(uuid, uuid, text) from public, anon;
grant execute on function public.undismiss_duplicate_pair(uuid, uuid, text) to authenticated, service_role;

-- 11. What keeps a contact from being deleted for good: 0103's body (0103_contact_archive.sql, section 7) exactly,
--     plus 'merges': a merge not undone names both its sides. A merged record's history is the customer's, and the
--     kept record cannot vanish under its tombstone's pointer. create or replace keeps 0103's grants (service_role).
create or replace function public.contact_delete_blockers(p_account_id uuid, p_contact_ids uuid[])
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
        -- 0106: either side of a merge not undone (contact_merges_keep and contact_merges_other lead on account_id).
        union all select 'merges' where exists (
          select 1 from public.contact_merges x
           where x.account_id = p_account_id and (x.keep_id = k.id or x.other_id = k.id) and x.undone_at is null)
      ) x
    ) r
   where k.account_id = p_account_id and k.id = any (p_contact_ids) and r.reasons is not null;
end $$;

-- 12. What holds a contact Sofia created: 0092's body (0092_ai_contact_held_by_voice_log.sql, section 1) exactly,
--     with 0096's search_path, plus 'contact_merges': a contact that is part of a merge (either side, not undone) is a
--     person's decision, never hers to remove. create or replace keeps the oid, owner and grants (authenticated and
--     service_role execute), which ai-acts-schema.test.ts pins.
create or replace function public.ai_contact_held_by(p_account_id uuid, p_act_id uuid)
returns text[]
language plpgsql
stable
security invoker
set search_path = pg_catalog, pg_temp
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
  -- 0106: a contact that is part of a merge (either side, not undone) is a person's decision, never hers to remove.
  if exists (select 1 from public.contact_merges x
              where x.account_id = p_account_id and (x.keep_id = v_contact or x.other_id = v_contact) and x.undone_at is null) then
    v_held := v_held || 'contact_merges'::text;
  end if;
  -- The backstop: a person edited, assigned, tagged or re-languaged the contact (any user event naming it).
  if exists (select 1 from public.events e
              where e.account_id = p_account_id and e.actor_type = 'user' and e.payload ->> 'contactId' = v_contact::text) then
    v_held := v_held || 'edits'::text;
  end if;
  return v_held;
end;
$$;

-- 13. What each new column is, and its one writer (0098 section 6's form).
comment on column public.contacts.merged_into is
  'The kept record this one was merged into (0106, F-006): null for a live record. Set and cleared only by public.merge_contacts and public.undo_contact_merge (server code); a signed-in session can neither set it nor change, archive or delete a record that carries it (app.contacts_tombstone_server_only).';
comment on column public.contacts.phone_national is
  'The ten national digits of any +1 or +52 shape (legacy 521, 044, 045 and 01 too), else the digits key (0106). Generated from phone by app.phone_national, the twin of phoneNational in packages/db/src/dedupe-keys.ts. Read by app.contacts_flag_pairs.';
comment on column public.contacts.name_key is
  'first name and first surname, accents and case folded, as first|surname; null with no surname or a placeholder first name (0106). Generated from first_name and last_name by app.contact_name_key, the twin of nameKey in packages/db/src/dedupe-keys.ts. Read by app.contacts_flag_pairs.';
comment on table public.contact_merges is
  'One row per merge of two contacts (0106, F-006): what moved, what was removed and the kept record before and after, so undo_contact_merge can put it back for 30 days. Written only by public.merge_contacts and public.undo_contact_merge; a member reads ten columns of the merges of a kept record they can see.';
comment on column public.contact_duplicate_flags.strength is
  'The order of a pair in the duplicates list (0106): 1 same_phone, 2 same_email, 3 email_phone_conflict, 4 same_digits and phone_country_twin, 5 to 7 the TypeScript writers'' reasons, 8 any other, 9 same_name. Generated from reason; the twin is DUPLICATE_REASON_STRENGTH in packages/db/src/dedupe-keys.ts.';
