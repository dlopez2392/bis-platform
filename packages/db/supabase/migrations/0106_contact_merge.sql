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
-- WHAT (part B, sections 14-19).
--   app.merge_side, app.merge_push, app.merge_target: three small helpers, owner only.
--   app.merge_fields_of(contacts): the merge's one field list as jsonb (keep_before, keep_after, the preview's
--     fields, and through md5 the stale fingerprint), pinned to UTC so a timestamp prints the same in every session.
--   app.follow_merge(), app.follow_merge_related(): DEFINER trigger functions; 19 triggers (15 insert-or-update-of-
--     contact_id, 3 insert-only on the fixed tables ai_acts, proposals and consent_events, and one on
--     contact_relationships.related_contact_id) land a write that names a tombstone on the kept record, walking the
--     pointer through app.merge_target until it ends, every read FOR KEY SHARE (the foreign key's own lock), so a
--     write racing a merge or an Undo waits for it and lands where the pointer ends once it commits.
--   public.merge_contacts(...): DEFINER; who, lock, refuse, tombstone, flags, fields, rows, log (section 16).
--   public.undo_contact_merge(...): DEFINER; the tombstone cleared first, then exactly the recorded rows back.
--   public.contact_merge_preview(...): INVOKER; the compare screen's counts, fields and fingerprints.
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
-- Part B: merge_contacts, undo_contact_merge and contact_merge_preview EXECUTE for authenticated and service_role;
-- app.merge_fields_of the same (the preview calls it as the invoker); app.merge_side, app.merge_push and
-- app.merge_target the owner only;
-- the two follow functions lose PUBLIC, anon and authenticated. Four definers join EXPECTED_DEFINERS (32 -> 36):
-- app.follow_merge, app.follow_merge_related, public.merge_contacts, public.undo_contact_merge.
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
--   Part B's 19 create trigger statements take SHARE ROW EXCLUSIVE on 18 tables until the file commits.
--   One merge locks its two contacts FOR UPDATE (section 16 says why not FOR NO KEY UPDATE) and their threads, and
--     every write naming either record waits for it. MEASURED on the same replica (post = pre + 0106, the other record
--     holding 10,000 messages on its thread, service role, three runs): merge_contacts 427 to 490 ms; its Undo 298 to
--     429 ms, all 10,000 back on the other thread.
--
-- LOAD-BEARING. From plan Task 4 on, the app names merged_into in contacts' COLS and in every list read, so it
-- merges only after this file is on production. The app before that keeps working, with one change in kind:
-- a pair it writes that the trigger already filed answers 23505, which every TypeScript writer treats as the
-- designed no-op, so the pair carries the trigger's reason (plan correction 6; plan Task 4 moves the live pins).
--
-- ROLLBACK (roll the app back first; undo every live merge first, see part B), in this order:
--   Part B first. Undo every live merge, newest first (select id from public.contact_merges where undone_at is null
--     order by id desc), with public.undo_contact_merge as service_role and a p_actor. A merge past its 30 days cannot
--     be undone: the orchestrator lists those and the owner decides before any rollback. Then:
--   drop trigger <t>_follow_merge on public.<t> for each t of automation_log, bookings, calls, client_group_members,
--     contact_relationships, contact_tags, conversations, document_requests, document_requirement_skips, documents,
--     form_submissions, notes, opportunities, places, tasks, ai_acts, proposals, consent_events;
--   drop trigger contact_relationships_follow_merge_related on public.contact_relationships;
--   drop function app.follow_merge(), app.follow_merge_related(), app.merge_target(uuid);
--   drop function public.contact_merge_preview(uuid, uuid, uuid), public.undo_contact_merge(uuid, bigint, text),
--     public.merge_contacts(uuid, uuid, uuid, jsonb, jsonb, text);
--   drop function app.merge_fields_of(public.contacts), app.merge_push(jsonb, text, jsonb), app.merge_side(text, text, text);
--   then part A:
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

-- ================================================================================================================
-- PART B (plan Task 3): the merge, its Undo, the compare screen's preview, and the backstop.
-- ================================================================================================================

-- 14. Two small helpers (owner only; the definers below call them as the owner), and the merge's one field list.
-- Which side a field's value comes from: a blank never wins, equal values are the kept record's, and only a real
-- disagreement reads the person's choice.
create function app.merge_side(p_keep text, p_other text, p_choice text) returns text
language sql immutable parallel safe set search_path = pg_catalog, pg_temp as $$
  select case
           when nullif(pg_catalog.btrim(coalesce(p_other, '')), '') is null then 'keep'
           when nullif(pg_catalog.btrim(coalesce(p_keep, '')), '') is null then 'other'
           when p_keep = p_other then 'keep'
           when p_choice = 'other' then 'other'
           else 'keep'
         end
$$;
create function app.merge_push(p_obj jsonb, p_key text, p_value jsonb) returns jsonb
language sql immutable parallel safe set search_path = pg_catalog, pg_temp as $$
  select coalesce(p_obj, '{}'::jsonb)
         || pg_catalog.jsonb_build_object(p_key, coalesce(p_obj -> p_key, '[]'::jsonb) || pg_catalog.jsonb_build_array(p_value))
$$;
revoke all on function app.merge_side(text, text, text) from public, anon, authenticated, service_role;
revoke all on function app.merge_push(jsonb, text, jsonb) from public, anon, authenticated, service_role;

-- The merge's ONE field list, as jsonb: keep_before, keep_after, the preview's fields, and (through md5) the
-- fingerprint stale compares (plan review m3: assignment.ts:339, contacts.ts:1295,1313,1540, automations.ts:1855 and
-- 0076:107 write contacts without stamping updated_at). STABLE, not immutable. to_jsonb prints a timestamptz in the
-- session's TimeZone ("2026-10-29T07:00:00-05:00" in a Chicago session, "...T12:00:00+00:00" in a UTC one, measured
-- on PostgreSQL 17.6), so the function pins it to UTC: a fingerprint read in a session that is not UTC (psql, a
-- script, any caller outside PostgREST) equals the one the merge computes, and Undo compares fields in one format.
create function app.merge_fields_of(p_row public.contacts) returns jsonb
language sql stable parallel safe set search_path = pg_catalog, pg_temp set timezone = 'UTC' as $$
  select coalesce(pg_catalog.jsonb_object_agg(e.key, e.value), '{}'::jsonb)
    from pg_catalog.jsonb_each(pg_catalog.to_jsonb(p_row)) as e
   where e.key = any (array['first_name', 'last_name', 'email', 'phone', 'phone_country_unconfirmed', 'assigned_to',
     'custom', 'language', 'language_source', 'language_set_at', 'last_language_signal', 'last_language_signal_source',
     'last_language_signal_at', 'language_hint_kept_at', 'marketing_email_opted_out_at', 'dnd', 'reactivation_sent_at',
     'archived_at', 'archived_by'])
$$;
revoke all on function app.merge_fields_of(public.contacts) from public, anon;
grant execute on function app.merge_fields_of(public.contacts) to authenticated, service_role;

-- 15. The backstop (spec 7.2; correction 12): a write that names a tombstone lands on the record it now belongs to.
--     DEFINER, so the pointer is read whatever the writer's RLS sees (a Technician assigned to the kept record cannot
--     see the tombstone). Every read is locked (plan review I2): a write that began before a merge committed waits on
--     the merge's row lock and then reads the COMMITTED pointer; an unlocked read saw the pre-merge snapshot and the
--     write landed on the hidden record.
--     FOR KEY SHARE, not the plan's FOR SHARE (T3, measured on PostgreSQL 17.6): it is the lock the foreign-key check
--     on the same row already takes, so the backstop adds no lock conflict 0106 did not have before. FOR SHARE also
--     conflicts with a plain UPDATE of the contact: with it, an open transaction that had inserted a task naming a
--     contact made an update of that contact's name wait (lock_timeout 1s hit), and two writers that each insert a row
--     naming a contact and then update it could deadlock; with FOR KEY SHARE that update took 16 ms, as with the
--     foreign key alone (17 ms).
--     FOR KEY SHARE waits only for FOR UPDATE. merge_contacts and undo_contact_merge hold FOR UPDATE on the two records
--     they join or part, but they re-point OLDER tombstones (the chain flattened, and un-flattened by Undo) with plain
--     updates, which FOR KEY SHARE does not wait for (T3 review I1). So app.merge_target walks the pointer until it
--     ends (at most four hops), every read locked: a write naming T, merged into O earlier, while O is being merged
--     into K reads T -> O, waits on O's FOR UPDATE, then reads O -> K. And when the start was a tombstone it walks
--     again from the start, with a fresh snapshot, until two walks end on the same record: a write naming T while an
--     Undo of O -> K runs reads T -> K, waits on K, finds K live, then the second walk reads the committed T -> O and
--     the write lands on O, the record T points to now, not on K. A live contact costs one read, as before.
--     A redirected insert that collides with a row the kept record already has (an active skip of the same
--     category, a membership of the same group) answers 23505, and nothing is written: each caller already reports a
--     duplicate or a failure (plan review m8b). A tag upsert (insert ... on conflict do nothing) is a no-op, because
--     ON CONFLICT is judged on the redirected row. Both are pinned in contact-merge-schema.test.ts.
create function app.merge_target(p_id uuid) returns uuid
language plpgsql volatile set search_path = pg_catalog, pg_temp as $$
declare
  v_at uuid;
  v_to uuid;
  v_end uuid;
  v_hops integer;
begin
  if p_id is null then
    return null;
  end if;
  for w in 1..3 loop
    v_at := p_id;
    v_hops := 0;
    for i in 1..4 loop
      select k.merged_into into v_to from public.contacts k where k.id = v_at for key share;
      exit when v_to is null;
      v_at := v_to;
      v_hops := v_hops + 1;
    end loop;
    exit when v_hops = 0 or v_at is not distinct from v_end;
    v_end := v_at;
  end loop;
  return v_at;
end $$;
revoke all on function app.merge_target(uuid) from public, anon, authenticated, service_role;
create function app.follow_merge() returns trigger
language plpgsql security definer set search_path = pg_catalog, pg_temp as $$
begin
  if new.contact_id is not null then
    new.contact_id := app.merge_target(new.contact_id);
  end if;
  return new;
end $$;
create function app.follow_merge_related() returns trigger
language plpgsql security definer set search_path = pg_catalog, pg_temp as $$
begin
  if new.related_contact_id is not null then
    new.related_contact_id := app.merge_target(new.related_contact_id);
  end if;
  return new;
end $$;
revoke all on function app.follow_merge() from public, anon, authenticated;
revoke all on function app.follow_merge_related() from public, anon, authenticated;
do $$
declare
  t text;
begin
  foreach t in array array['automation_log', 'bookings', 'calls', 'client_group_members', 'contact_relationships', 'contact_tags',
                           'conversations', 'document_requests', 'document_requirement_skips', 'documents', 'form_submissions',
                           'notes', 'opportunities', 'places', 'tasks'] loop
    execute pg_catalog.format(
      'create trigger %I before insert or update of contact_id on public.%I for each row execute function app.follow_merge()',
      t || '_follow_merge', t);
  end loop;
  -- Fixed rows (0091, 0088, 0054): their own triggers refuse an update, and a new row is not history yet.
  foreach t in array array['ai_acts', 'proposals', 'consent_events'] loop
    execute pg_catalog.format(
      'create trigger %I before insert on public.%I for each row execute function app.follow_merge()', t || '_follow_merge', t);
  end loop;
end $$;
create trigger contact_relationships_follow_merge_related before insert or update of related_contact_id
  on public.contact_relationships for each row execute function app.follow_merge_related();

-- 16. The merge (spec 4.4, 5.2, 5.3). The order is load-bearing: who, lock, refuse, the tombstone first, the flags,
--     the fields, the rows, the log.
--     LOCK CHOICE: both contacts FOR UPDATE, not FOR NO KEY UPDATE (measured on PostgreSQL 17.6, plan Task 3). The
--     merge changes no key column, so FOR NO KEY UPDATE would serialise two merges and a merge and an archive, but
--     not the backstop: app.follow_merge reads the pointer FOR KEY SHARE (section 15), which waits only for FOR
--     UPDATE. FOR UPDATE is what makes a write racing the merge wait and land on the kept record, and it also holds
--     back the foreign-key check of every write naming either record from a table with no follow_merge trigger (the
--     flag trigger of a contact inserted elsewhere, record_summaries, contact_archive_log). That keeps the before and
--     after read of the kept record's flags below exact: a pair another session files for the kept record cannot
--     commit between the two reads and be claimed (and removed by Undo) as the merge's own. The older tombstones the
--     flatten re-points are NOT locked FOR UPDATE (a writer holding one of them while it waits on the other record
--     would deadlock with this function): app.merge_target walks through them to a record this function does lock.
create function public.merge_contacts(
  p_account_id uuid, p_keep uuid, p_other uuid, p_choices jsonb, p_seen jsonb, p_actor text default null)
returns jsonb
language plpgsql security definer set search_path = pg_catalog, pg_temp as $$
declare
  c_moves constant text[] := array['automation_log', 'bookings', 'calls', 'document_requests', 'documents',
    'form_submissions', 'notes', 'opportunities', 'places', 'tasks'];
  v_actor text;
  k public.contacts%rowtype;
  o public.contacts%rowtype;
  v_oc public.conversations%rowtype;
  v_kc uuid;
  v_moved jsonb := '{}'::jsonb;
  v_removed jsonb := '{}'::jsonb;
  v_choices jsonb := '{}'::jsonb;
  v_counts jsonb;
  v_ids text[];
  v_t text;
  v_key text;
  v_side text;
  v_s_first text; v_s_last text; v_s_email text; v_s_phone text; v_s_assigned text; v_s_lang text;
  v_custom jsonb;
  v_before jsonb;
  v_after jsonb;
  v_hand integer := 0;
  v_token text;
  v_pair uuid;
  v_new uuid;
  v_x uuid;
  v_km public.client_group_members%rowtype;
  v_merge bigint;
  v_flags_before uuid[];
  r record;
begin
  -- 1. Who (app.may_merge: a service_role JWT, the agency, or an Owner or Staff of this account whose token is in it).
  if not app.may_merge(p_account_id) then
    raise exception 'merge_contacts: Owners, Staff and the agency only' using errcode = '42501';
  end if;
  v_actor := case when coalesce(app.jwt() ->> 'role', '') = 'service_role' then nullif(p_actor, '')
                  else nullif(app.jwt() ->> 'sub', '') end;
  if v_actor is null or p_keep is null or p_other is null
     or p_choices is null or pg_catalog.jsonb_typeof(p_choices) <> 'object'
     or p_seen is null or pg_catalog.jsonb_typeof(p_seen) <> 'object' then
    raise exception 'merge_contacts: an actor, two contacts, choices and seen are required' using errcode = '22023';
  end if;
  for v_key, v_side in select e.key, e.value #>> '{}' from pg_catalog.jsonb_each(p_choices) as e loop
    if v_side is null or v_side not in ('keep', 'other')
       or not (v_key in ('first_name', 'last_name', 'email', 'phone', 'assigned_to', 'language') or v_key like 'custom.%') then
      raise exception 'merge_contacts: unknown choice %', v_key using errcode = '22023';
    end if;
  end loop;
  if p_keep = p_other then
    return pg_catalog.jsonb_build_object('status', 'same');
  end if;

  -- 2. Lock both contacts (FOR UPDATE, see LOCK CHOICE above), then their conversations, each in id order (0103's
  --    order, so two merges cannot deadlock), then read them fresh.
  perform 1 from public.contacts c where c.account_id = p_account_id and c.id in (p_keep, p_other) order by c.id for update;
  select * into k from public.contacts c where c.account_id = p_account_id and c.id = p_keep;
  if not found then
    return pg_catalog.jsonb_build_object('status', 'not_found');
  end if;
  select * into o from public.contacts c where c.account_id = p_account_id and c.id = p_other;
  if not found then
    return pg_catalog.jsonb_build_object('status', 'not_found');
  end if;
  perform 1 from public.conversations cv
   where cv.account_id = p_account_id and cv.contact_id in (p_keep, p_other) order by cv.id for update;

  -- 3. Refusals, each a status the screen can word. stale: either row's merge fields changed since the preview the
  --    screen showed (correction 19: a fingerprint, because several writers never stamp updated_at).
  if k.holds_shared_number or o.holds_shared_number then
    return pg_catalog.jsonb_build_object('status', 'holding');
  end if;
  if k.merged_into is not null or o.merged_into is not null then
    return pg_catalog.jsonb_build_object('status', 'already_merged');
  end if;
  if pg_catalog.md5(app.merge_fields_of(k)::text) is distinct from (p_seen ->> 'keep')
     or pg_catalog.md5(app.merge_fields_of(o)::text) is distinct from (p_seen ->> 'other') then
    return pg_catalog.jsonb_build_object('status', 'stale');
  end if;
  v_before := app.merge_fields_of(k);

  -- 4. The tombstone FIRST, then the chain flattened (one hop for every lookup), so the flag trigger, which skips a
  --    tombstone, never pairs the kept record with the one it absorbs while the fields below are written.
  update public.contacts set merged_into = p_keep, merged_at = pg_catalog.now()
   where account_id = p_account_id and id = p_other;
  with f as (update public.contacts set merged_into = p_keep
              where account_id = p_account_id and merged_into = p_other returning id)
  select coalesce(pg_catalog.array_agg(f.id::text), '{}') into v_ids from f;
  v_moved := v_moved || pg_catalog.jsonb_build_object('contacts', pg_catalog.to_jsonb(v_ids));

  -- 5. Flags, BEFORE the fields (plan review I1). Every other pair naming the other record is re-filed on the kept one
  --    with its reason, its dismissal and its merge_id before the field update below can make the flag trigger file
  --    the same pair fresh (undismissed) and leave this re-file a silent, unrecorded conflict.
  select f.id into v_pair from public.contact_duplicate_flags f
   where f.account_id = p_account_id and f.contact_a = least(p_keep, p_other) and f.contact_b = greatest(p_keep, p_other);
  for r in select f.* from public.contact_duplicate_flags f
            where f.account_id = p_account_id and (f.contact_a = p_other or f.contact_b = p_other)
              and f.id is distinct from v_pair order by f.id loop
    delete from public.contact_duplicate_flags where id = r.id;
    v_removed := app.merge_push(v_removed, 'contact_duplicate_flags', pg_catalog.to_jsonb(r) - 'strength');
    v_x := case when r.contact_a = p_other then r.contact_b else r.contact_a end;
    v_new := null;
    if v_x <> p_keep then
      insert into public.contact_duplicate_flags (account_id, contact_a, contact_b, reason, dismissed_at, dismissed_by, merge_id, created_at)
      values (p_account_id, least(p_keep, v_x), greatest(p_keep, v_x), r.reason, r.dismissed_at, r.dismissed_by, r.merge_id, r.created_at)
      on conflict (account_id, contact_a, contact_b) do nothing
      returning id into v_new;
      if v_new is not null then
        v_moved := app.merge_push(v_moved, 'contact_duplicate_flags_added', pg_catalog.to_jsonb(v_new::text));
      end if;
    end if;
  end loop;

  -- 6. Fields (spec 5.2). A choice names a side; every value is read from the locked rows.
  v_s_first := app.merge_side(k.first_name, o.first_name, p_choices ->> 'first_name');
  v_s_last := app.merge_side(k.last_name, o.last_name, p_choices ->> 'last_name');
  v_s_email := app.merge_side(k.email, o.email, p_choices ->> 'email');
  v_s_phone := app.merge_side(k.phone, o.phone, p_choices ->> 'phone');
  v_s_assigned := app.merge_side(k.assigned_to::text, o.assigned_to::text, p_choices ->> 'assigned_to');
  if k.language is null then
    v_s_lang := 'other';
  elsif o.language is null or o.language = k.language then
    v_s_lang := 'keep';
  elsif p_choices ? 'language' then
    v_s_lang := p_choices ->> 'language';
  elsif k.language_source = 'staff' and o.language_source <> 'staff' then
    v_s_lang := 'keep';
  elsif o.language_source = 'staff' and k.language_source <> 'staff' then
    v_s_lang := 'other';
  elsif o.language_set_at < k.language_set_at then
    v_s_lang := 'other';
  else
    v_s_lang := 'keep';
  end if;
  v_custom := coalesce(o.custom, '{}'::jsonb) || coalesce(k.custom, '{}'::jsonb);
  for v_key in select e.key from pg_catalog.jsonb_each(coalesce(k.custom, '{}'::jsonb)) as e
                where coalesce(o.custom, '{}'::jsonb) ? e.key loop
    v_side := app.merge_side(k.custom ->> v_key, o.custom ->> v_key, p_choices ->> ('custom.' || v_key));
    if v_side = 'other' then
      v_custom := v_custom || pg_catalog.jsonb_build_object(v_key, o.custom -> v_key);
    end if;
    v_choices := v_choices || pg_catalog.jsonb_build_object('custom.' || v_key, v_side);
  end loop;
  v_choices := v_choices || pg_catalog.jsonb_build_object('first_name', v_s_first, 'last_name', v_s_last, 'email', v_s_email,
    'phone', v_s_phone, 'assigned_to', v_s_assigned, 'language', v_s_lang);

  -- The update below fires contacts_flag_pairs for K (a key K gains from O files K's pairs). Every flag it files is
  -- recorded, so the Undo removes it (plan review I1): the flag ids naming K, before and after.
  select coalesce(pg_catalog.array_agg(f.id), '{}') into v_flags_before from public.contact_duplicate_flags f
   where f.account_id = p_account_id and (f.contact_a = p_keep or f.contact_b = p_keep);
  update public.contacts c set
    first_name = case v_s_first when 'other' then o.first_name else k.first_name end,
    last_name = case v_s_last when 'other' then o.last_name else k.last_name end,
    email = case v_s_email when 'other' then o.email else k.email end,
    phone = case v_s_phone when 'other' then o.phone else k.phone end,
    phone_country_unconfirmed = case v_s_phone when 'other' then o.phone_country_unconfirmed else k.phone_country_unconfirmed end,
    assigned_to = case v_s_assigned when 'other' then o.assigned_to else k.assigned_to end,
    custom = v_custom,
    language = case v_s_lang when 'other' then o.language else k.language end,
    language_source = case v_s_lang when 'other' then o.language_source else k.language_source end,
    language_set_at = case v_s_lang when 'other' then o.language_set_at else k.language_set_at end,
    last_language_signal = case when k.last_language_signal is null then o.last_language_signal else k.last_language_signal end,
    last_language_signal_source = case when k.last_language_signal is null then o.last_language_signal_source else k.last_language_signal_source end,
    last_language_signal_at = case when k.last_language_signal is null then o.last_language_signal_at else k.last_language_signal_at end,
    language_hint_kept_at = coalesce(k.language_hint_kept_at, o.language_hint_kept_at),
    marketing_email_opted_out_at = least(k.marketing_email_opted_out_at, o.marketing_email_opted_out_at),
    dnd = case when coalesce(k.dnd, '{}'::jsonb) = '{}'::jsonb then o.dnd else k.dnd end,
    reactivation_sent_at = greatest(k.reactivation_sent_at, o.reactivation_sent_at),
    archived_at = case when o.archived_at is null then null else k.archived_at end,
    archived_by = case when o.archived_at is null then null else k.archived_by end,
    updated_at = pg_catalog.now()
   where c.account_id = p_account_id and c.id = p_keep;
  for v_new in select f.id from public.contact_duplicate_flags f
                where f.account_id = p_account_id and (f.contact_a = p_keep or f.contact_b = p_keep)
                  and not (f.id = any (v_flags_before)) order by f.id loop
    v_moved := app.merge_push(v_moved, 'contact_duplicate_flags_added', pg_catalog.to_jsonb(v_new::text));
  end loop;
  -- An archive is a person's act with a log row; inside a definer the 0103 log trigger (WHEN current_user =
  -- 'authenticated') does not fire, so the merge writes the row itself.
  if k.archived_at is not null and o.archived_at is null then
    insert into public.contact_archive_log (account_id, contact_id, action, author_kind, author_id)
    values (p_account_id, p_keep, 'restored', 'person', v_actor);
  end if;
  select app.merge_fields_of(c) into v_after from public.contacts c where c.id = p_keep;

  -- 7. Rows that simply move (spec 5.3). The ids are uuids and the table names come from the constant above, so
  --    format's %L and %I build the statement (no positional parameter: this file has no dollar sign outside a pair).
  foreach v_t in array c_moves loop
    execute pg_catalog.format(
      'with m as (update public.%I set contact_id = %L where account_id = %L and contact_id = %L returning id) '
      || 'select coalesce(pg_catalog.array_agg(m.id::text), %L) from m', v_t, p_keep, p_account_id, p_other, '{}')
      into v_ids;
    v_moved := v_moved || pg_catalog.jsonb_build_object(v_t, pg_catalog.to_jsonb(v_ids));
  end loop;

  -- Tags: one both had is removed from the other first (PK contact_id, tag_id); the rest move, keyed by tag_id.
  for r in select g.* from public.contact_tags g
            where g.account_id = p_account_id and g.contact_id = p_other
              and exists (select 1 from public.contact_tags x where x.contact_id = p_keep and x.tag_id = g.tag_id) loop
    delete from public.contact_tags where contact_id = p_other and tag_id = r.tag_id;
    v_removed := app.merge_push(v_removed, 'contact_tags', pg_catalog.to_jsonb(r));
  end loop;
  with m as (update public.contact_tags set contact_id = p_keep
              where account_id = p_account_id and contact_id = p_other returning tag_id)
  select coalesce(pg_catalog.array_agg(m.tag_id::text), '{}') into v_ids from m;
  v_moved := v_moved || pg_catalog.jsonb_build_object('contact_tags', pg_catalog.to_jsonb(v_ids));

  -- Groups (0069:63-79, 0075): a group both are in keeps the kept membership with is_billing and is_primary_contact
  -- OR'd (the other's row is removed first: one primary contact per group); one main group per contact.
  for r in select m.* from public.client_group_members m
            where m.account_id = p_account_id and m.contact_id = p_other order by m.id loop
    select * into v_km from public.client_group_members x
     where x.account_id = p_account_id and x.contact_id = p_keep and x.client_group_id = r.client_group_id;
    if found then
      delete from public.client_group_members where id = r.id;
      v_removed := app.merge_push(v_removed, 'client_group_members', pg_catalog.to_jsonb(r));
      if (r.is_billing and not v_km.is_billing) or (r.is_primary_contact and not v_km.is_primary_contact) then
        v_moved := app.merge_push(v_moved, 'client_group_members_flags', pg_catalog.jsonb_build_object(
          'id', v_km.id, 'is_billing', v_km.is_billing, 'is_primary_contact', v_km.is_primary_contact));
        update public.client_group_members
           set is_billing = is_billing or r.is_billing, is_primary_contact = is_primary_contact or r.is_primary_contact
         where id = v_km.id;
      end if;
    elsif r.is_primary and exists (select 1 from public.client_group_members x
                                    where x.account_id = p_account_id and x.contact_id = p_keep and x.is_primary) then
      update public.client_group_members set contact_id = p_keep, is_primary = false where id = r.id;
      v_moved := app.merge_push(v_moved, 'client_group_members', pg_catalog.to_jsonb(r.id::text));
      v_moved := app.merge_push(v_moved, 'client_group_members_unprimaried', pg_catalog.to_jsonb(r.id::text));
    else
      update public.client_group_members set contact_id = p_keep where id = r.id;
      v_moved := app.merge_push(v_moved, 'client_group_members', pg_catalog.to_jsonb(r.id::text));
    end if;
  end loop;

  -- Relationships (0070): one between the two becomes a self-row and is removed; one that repeats a relationship
  -- the kept record already has trips a unique index and is removed. Each move records which side it moved.
  for r in select x.* from public.contact_relationships x
            where x.account_id = p_account_id and (x.contact_id = p_other or x.related_contact_id = p_other) order by x.id loop
    if (case when r.contact_id = p_other then p_keep else r.contact_id end)
       = (case when r.related_contact_id = p_other then p_keep else r.related_contact_id end) then
      delete from public.contact_relationships where id = r.id;
      v_removed := app.merge_push(v_removed, 'contact_relationships', pg_catalog.to_jsonb(r));
    else
      begin
        update public.contact_relationships
           set contact_id = case when contact_id = p_other then p_keep else contact_id end,
               related_contact_id = case when related_contact_id = p_other then p_keep else related_contact_id end
         where id = r.id;
        v_moved := app.merge_push(v_moved, 'contact_relationships', pg_catalog.jsonb_build_object(
          'id', r.id, 'contact', r.contact_id = p_other, 'related', r.related_contact_id = p_other));
      exception when unique_violation then
        delete from public.contact_relationships where id = r.id;
        v_removed := app.merge_push(v_removed, 'contact_relationships', pg_catalog.to_jsonb(r));
      end;
    end if;
  end loop;

  -- Skips (0081:81, one active skip per category).
  for r in select s.* from public.document_requirement_skips s
            where s.account_id = p_account_id and s.contact_id = p_other order by s.id loop
    begin
      update public.document_requirement_skips set contact_id = p_keep where id = r.id;
      v_moved := app.merge_push(v_moved, 'document_requirement_skips', pg_catalog.to_jsonb(r.id::text));
    exception when unique_violation then
      delete from public.document_requirement_skips where id = r.id;
      v_removed := app.merge_push(v_removed, 'document_requirement_skips', pg_catalog.to_jsonb(r));
    end;
  end loop;

  -- Threads (correction 8): always into the kept record's thread, made here when it has none. messages is NO ACTION
  -- on its thread (0005:33), calls SET NULL (0019:49) and inbound_emails CASCADE (0082:93-94): all three move BEFORE
  -- the emptied thread is removed, so a missed one fails the merge closed or is caught by the test. The kept thread's
  -- assigned_to and last_message_at before the merge are recorded, so the Undo can put them back while they still
  -- hold what the merge set.
  select * into v_oc from public.conversations cv where cv.account_id = p_account_id and cv.contact_id = p_other;
  if found then
    select cv.id into v_kc from public.conversations cv where cv.account_id = p_account_id and cv.contact_id = p_keep;
    if v_kc is null then
      insert into public.conversations (account_id, contact_id) values (p_account_id, p_keep) returning id into v_kc;
      v_moved := v_moved || pg_catalog.jsonb_build_object('conversation_created', v_kc);
    end if;
    -- messages.updated_at is left as it was (plan review m8a): an Undo could not put it back.
    with m as (update public.messages set conversation_id = v_kc
                where account_id = p_account_id and conversation_id = v_oc.id returning id)
    select coalesce(pg_catalog.array_agg(m.id::text), '{}') into v_ids from m;
    v_moved := v_moved || pg_catalog.jsonb_build_object('messages', pg_catalog.to_jsonb(v_ids));
    with m as (update public.calls set conversation_id = v_kc
                where account_id = p_account_id and conversation_id = v_oc.id returning id)
    select coalesce(pg_catalog.array_agg(m.id::text), '{}') into v_ids from m;
    v_moved := v_moved || pg_catalog.jsonb_build_object('calls_thread', pg_catalog.to_jsonb(v_ids));
    with m as (update public.inbound_emails set conversation_id = v_kc
                where account_id = p_account_id and conversation_id = v_oc.id returning id)
    select coalesce(pg_catalog.array_agg(m.id::text), '{}') into v_ids from m;
    v_moved := v_moved || pg_catalog.jsonb_build_object('inbound_emails', pg_catalog.to_jsonb(v_ids));
    v_hand := coalesce(v_oc.unread_count, 0);
    select v_moved || pg_catalog.jsonb_build_object('conversation_assigned_before', pg_catalog.to_jsonb(cv.assigned_to),
                                                    'conversation_last_before', pg_catalog.to_jsonb(cv.last_message_at))
      into v_moved from public.conversations cv where cv.id = v_kc;
    update public.conversations cv
       set unread_count = cv.unread_count + v_hand,
           last_message_at = greatest(cv.last_message_at, v_oc.last_message_at),
           assigned_to = coalesce(cv.assigned_to, v_oc.assigned_to),
           updated_at = pg_catalog.now()
     where cv.id = v_kc;
    v_token := case when v_oc.reply_token is not null and v_oc.reply_token_revoked_at is null then v_oc.reply_token end;
    v_removed := v_removed || pg_catalog.jsonb_build_object('conversations', pg_catalog.jsonb_build_array(pg_catalog.to_jsonb(v_oc)));
    delete from public.conversations where id = v_oc.id;
  end if;

  -- A cache: regenerated, never snapshotted.
  delete from public.record_summaries where account_id = p_account_id and contact_id in (p_keep, p_other);

  -- 8. The log, the pair resolved, the event.
  select pg_catalog.jsonb_build_object(
           'messages', pg_catalog.jsonb_array_length(coalesce(v_moved -> 'messages', '[]'::jsonb)),
           'calls', (select pg_catalog.count(distinct u.x) from (
                      select pg_catalog.jsonb_array_elements_text(coalesce(v_moved -> 'calls', '[]'::jsonb)) as x
                      union select pg_catalog.jsonb_array_elements_text(coalesce(v_moved -> 'calls_thread', '[]'::jsonb))) as u),
           'bookings', pg_catalog.jsonb_array_length(v_moved -> 'bookings'),
           'documents', pg_catalog.jsonb_array_length(v_moved -> 'documents'),
           'opportunities', pg_catalog.jsonb_array_length(v_moved -> 'opportunities'),
           'notes', pg_catalog.jsonb_array_length(v_moved -> 'notes'),
           'tasks', pg_catalog.jsonb_array_length(v_moved -> 'tasks'),
           'form_submissions', pg_catalog.jsonb_array_length(v_moved -> 'form_submissions'))
    into v_counts;
  insert into public.contact_merges (account_id, keep_id, other_id, merged_by, merged_at, undo_until, keep_before, keep_after,
                                     choices, moved, moved_counts, removed, unread_handed, other_reply_token)
  values (p_account_id, p_keep, p_other, v_actor, pg_catalog.now(), pg_catalog.now() + interval '30 days', v_before, v_after,
          v_choices, v_moved, v_counts, v_removed, v_hand, v_token)
  returning id into v_merge;
  if v_pair is null then
    insert into public.contact_duplicate_flags (account_id, contact_a, contact_b, reason, merge_id)
    values (p_account_id, least(p_keep, p_other), greatest(p_keep, p_other), 'merged_by_hand', v_merge);
  else
    update public.contact_duplicate_flags set merge_id = v_merge where id = v_pair;
  end if;
  insert into public.events (account_id, type, actor_type, actor_id, payload)
  values (p_account_id, 'contact.merged', 'user', v_actor,
          pg_catalog.jsonb_build_object('contactId', p_keep, 'otherId', p_other, 'mergeId', v_merge));
  return pg_catalog.jsonb_build_object('status', 'merged', 'mergeId', v_merge, 'moved', v_counts);
end $$;
revoke all on function public.merge_contacts(uuid, uuid, uuid, jsonb, jsonb, text) from public, anon;
grant execute on function public.merge_contacts(uuid, uuid, uuid, jsonb, jsonb, text) to authenticated, service_role;

-- 17. The Undo (spec 4.5, corrections 5 and 8). Only what the merge recorded moves back, so a text or a call that
--     reached the kept record after the merge stays there (keptNew counts it), and a field someone edited since keeps
--     the edit (keptEdits names it).
create function public.undo_contact_merge(p_account_id uuid, p_merge_id bigint, p_actor text default null)
returns jsonb
language plpgsql security definer set search_path = pg_catalog, pg_temp as $$
declare
  -- The same literal as public.merge_contacts' c_moves (contact-merge-schema.test.ts parses both).
  c_moves constant text[] := array['automation_log', 'bookings', 'calls', 'document_requests', 'documents',
    'form_submissions', 'notes', 'opportunities', 'places', 'tasks'];
  -- Fields that restore together: a group restores only when EVERY member still equals keep_after (0076's language
  -- checks and 0103's contacts_archived_by_needs_at would refuse a half).
  c_groups constant text[] := array['first_name', 'last_name', 'email', 'phone,phone_country_unconfirmed', 'assigned_to',
    'custom', 'language,language_source,language_set_at', 'last_language_signal,last_language_signal_source,last_language_signal_at',
    'language_hint_kept_at', 'marketing_email_opted_out_at', 'dnd', 'reactivation_sent_at', 'archived_at,archived_by'];
  g public.contact_merges%rowtype;
  v_actor text;
  v_kc uuid;
  v_oc public.conversations%rowtype;
  v_t text;
  v_n integer;
  v_back integer := 0;
  v_hand integer := 0;
  v_cur jsonb;
  v_patch jsonb := '{}'::jsonb;
  v_edits text[] := '{}';
  v_group text;
  v_fields text[];
  v_f text;
  v_restore boolean;
  v_changed boolean;
  v_kept_new integer;
  e jsonb;
begin
  if not app.may_merge(p_account_id) then
    raise exception 'undo_contact_merge: Owners, Staff and the agency only' using errcode = '42501';
  end if;
  v_actor := case when coalesce(app.jwt() ->> 'role', '') = 'service_role' then nullif(p_actor, '')
                  else nullif(app.jwt() ->> 'sub', '') end;
  if v_actor is null or p_merge_id is null then
    raise exception 'undo_contact_merge: an actor and a merge are required' using errcode = '22023';
  end if;

  -- 1. The merge row, locked: two Undos of one merge serialise here.
  select * into g from public.contact_merges m where m.account_id = p_account_id and m.id = p_merge_id for update;
  if not found then
    return pg_catalog.jsonb_build_object('status', 'not_found');
  end if;
  if g.undone_at is not null then
    return pg_catalog.jsonb_build_object('status', 'already_undone');
  end if;
  if pg_catalog.now() > g.undo_until then
    return pg_catalog.jsonb_build_object('status', 'expired');
  end if;

  -- 2. Lock both contacts, then their conversations, in id order (as the merge). Only the newest merge into a record
  --    can be undone, so Undos unwind in order: later_merge when the kept record is now a tombstone, or a merge into it
  --    with a greater id is not undone.
  perform 1 from public.contacts c where c.account_id = p_account_id and c.id in (g.keep_id, g.other_id) order by c.id for update;
  perform 1 from public.conversations cv
   where cv.account_id = p_account_id and cv.contact_id in (g.keep_id, g.other_id) order by cv.id for update;
  if exists (select 1 from public.contacts c where c.account_id = p_account_id and c.id = g.keep_id and c.merged_into is not null)
     or exists (select 1 from public.contact_merges m
                 where m.account_id = p_account_id and m.keep_id = g.keep_id and m.id > g.id and m.undone_at is null) then
    return pg_catalog.jsonb_build_object('status', 'later_merge');
  end if;

  -- 3. The tombstone is cleared FIRST, then the flattening undone: the follow_merge triggers would otherwise send every
  --    row moved back below straight to the kept record again.
  update public.contacts set merged_into = null, merged_at = null
   where account_id = p_account_id and id = g.other_id and merged_into = g.keep_id;
  update public.contacts set merged_into = g.other_id
   where account_id = p_account_id and merged_into = g.keep_id
     and id::text in (select pg_catalog.jsonb_array_elements_text(coalesce(g.moved -> 'contacts', '[]'::jsonb)));

  -- 4. The thread: the other's comes back with its own id and reply token, and exactly the recorded messages, calls
  --    and inbound emails move back to it (messages.updated_at untouched, plan review m8a). The unread count goes back
  --    with them, at most what the kept thread still has unread and nothing when nothing moved (0098's rule). The kept
  --    thread's assigned_to and last_message_at return while they still hold what the merge set.
  select cv.id into v_kc from public.conversations cv where cv.account_id = p_account_id and cv.contact_id = g.keep_id;
  if g.removed ? 'conversations' then
    v_oc := pg_catalog.jsonb_populate_record(null::public.conversations, g.removed -> 'conversations' -> 0);
    insert into public.conversations (id, account_id, contact_id, last_message_at, unread_count, assigned_to, created_at,
                                      updated_at, reply_token, reply_token_revoked_at)
    values (v_oc.id, p_account_id, g.other_id, v_oc.last_message_at, 0, v_oc.assigned_to, v_oc.created_at,
            v_oc.updated_at, v_oc.reply_token, v_oc.reply_token_revoked_at)
    on conflict (id) do nothing;
    if v_kc is not null then
      with m as (update public.messages set conversation_id = v_oc.id
                  where account_id = p_account_id and conversation_id = v_kc
                    and id::text in (select pg_catalog.jsonb_array_elements_text(coalesce(g.moved -> 'messages', '[]'::jsonb)))
                 returning 1)
      select pg_catalog.count(*) into v_n from m;
      v_back := v_back + v_n;
      with m as (update public.calls set conversation_id = v_oc.id
                  where account_id = p_account_id and conversation_id = v_kc
                    and id::text in (select pg_catalog.jsonb_array_elements_text(coalesce(g.moved -> 'calls_thread', '[]'::jsonb)))
                 returning 1)
      select pg_catalog.count(*) into v_n from m;
      v_back := v_back + v_n;
      with m as (update public.inbound_emails set conversation_id = v_oc.id
                  where account_id = p_account_id and conversation_id = v_kc
                    and id::text in (select pg_catalog.jsonb_array_elements_text(coalesce(g.moved -> 'inbound_emails', '[]'::jsonb)))
                 returning 1)
      select pg_catalog.count(*) into v_n from m;
      v_back := v_back + v_n;
      if v_back > 0 then
        select least(greatest(g.unread_handed, 0), cv.unread_count) into v_hand from public.conversations cv where cv.id = v_kc;
      end if;
      update public.conversations cv
         set unread_count = cv.unread_count - v_hand,
             last_message_at = case
               when cv.last_message_at is not distinct from
                    greatest((g.moved ->> 'conversation_last_before')::timestamptz, v_oc.last_message_at)
               then (g.moved ->> 'conversation_last_before')::timestamptz else cv.last_message_at end,
             assigned_to = case
               when cv.assigned_to is not distinct from coalesce((g.moved ->> 'conversation_assigned_before')::uuid, v_oc.assigned_to)
               then (g.moved ->> 'conversation_assigned_before')::uuid else cv.assigned_to end,
             updated_at = pg_catalog.now()
       where cv.id = v_kc;
      update public.conversations set unread_count = v_hand where id = v_oc.id;
    end if;
    -- A thread the merge made for the kept record goes when nothing new reached it.
    if g.moved ? 'conversation_created' then
      delete from public.conversations cv
       where cv.account_id = p_account_id and cv.id = (g.moved ->> 'conversation_created')::uuid
         and not exists (select 1 from public.messages m where m.conversation_id = cv.id)
         and not exists (select 1 from public.calls x where x.conversation_id = cv.id)
         and not exists (select 1 from public.inbound_emails i where i.account_id = cv.account_id and i.conversation_id = cv.id);
    end if;
  end if;

  -- 5. Rows: every recorded key still on the kept record moves back.
  foreach v_t in array c_moves loop
    execute pg_catalog.format(
      'update public.%I set contact_id = %L where account_id = %L and contact_id = %L and id::text = any (%L::text[])',
      v_t, g.other_id, p_account_id, g.keep_id,
      array(select pg_catalog.jsonb_array_elements_text(coalesce(g.moved -> v_t, '[]'::jsonb))));
  end loop;
  update public.contact_tags set contact_id = g.other_id
   where account_id = p_account_id and contact_id = g.keep_id
     and tag_id::text in (select pg_catalog.jsonb_array_elements_text(coalesce(g.moved -> 'contact_tags', '[]'::jsonb)));
  -- Groups: the kept membership's flags first (one primary contact per group), then the removed memberships, then the
  -- moved ones, then is_primary back on the ones the merge took it from.
  for e in select x.v from pg_catalog.jsonb_array_elements(coalesce(g.moved -> 'client_group_members_flags', '[]'::jsonb)) as x(v) loop
    update public.client_group_members
       set is_billing = (e ->> 'is_billing')::boolean, is_primary_contact = (e ->> 'is_primary_contact')::boolean
     where account_id = p_account_id and id = (e ->> 'id')::uuid;
  end loop;
  -- A removed membership always comes back (T3 review I2: a bare on conflict do nothing let the one-primary-contact
  -- index swallow it). When someone took its group's primary contact, or its contact's main group, since the merge,
  -- it comes back without that flag: the later decision stands.
  insert into public.client_group_members (id, account_id, client_group_id, contact_id, role, is_primary, is_billing,
                                           created_at, is_primary_contact)
  select m.id, m.account_id, m.client_group_id, m.contact_id, m.role,
         m.is_primary and not exists (select 1 from public.client_group_members x
                                       where x.contact_id = m.contact_id and x.is_primary),
         m.is_billing, m.created_at,
         m.is_primary_contact and not exists (select 1 from public.client_group_members x
                                               where x.client_group_id = m.client_group_id and x.is_primary_contact)
    from pg_catalog.jsonb_array_elements(coalesce(g.removed -> 'client_group_members', '[]'::jsonb)) as x(v)
   cross join lateral pg_catalog.jsonb_populate_record(null::public.client_group_members, x.v) as m
  on conflict (id) do nothing;
  update public.client_group_members set contact_id = g.other_id
   where account_id = p_account_id and contact_id = g.keep_id
     and id::text in (select pg_catalog.jsonb_array_elements_text(coalesce(g.moved -> 'client_group_members', '[]'::jsonb)));
  update public.client_group_members set is_primary = true
   where account_id = p_account_id and contact_id = g.other_id
     and id::text in (select pg_catalog.jsonb_array_elements_text(coalesce(g.moved -> 'client_group_members_unprimaried', '[]'::jsonb)));
  -- Relationships: the recorded side(s) only, where they still name the kept record.
  for e in select x.v from pg_catalog.jsonb_array_elements(coalesce(g.moved -> 'contact_relationships', '[]'::jsonb)) as x(v) loop
    update public.contact_relationships
       set contact_id = case when (e ->> 'contact')::boolean and contact_id = g.keep_id then g.other_id else contact_id end,
           related_contact_id = case when (e ->> 'related')::boolean and related_contact_id = g.keep_id then g.other_id else related_contact_id end
     where account_id = p_account_id and id = (e ->> 'id')::uuid;
  end loop;
  insert into public.contact_relationships
  select (pg_catalog.jsonb_populate_record(null::public.contact_relationships, x.v)).*
    from pg_catalog.jsonb_array_elements(coalesce(g.removed -> 'contact_relationships', '[]'::jsonb)) as x(v)
  on conflict do nothing;
  update public.document_requirement_skips set contact_id = g.other_id
   where account_id = p_account_id and contact_id = g.keep_id
     and id::text in (select pg_catalog.jsonb_array_elements_text(coalesce(g.moved -> 'document_requirement_skips', '[]'::jsonb)));
  insert into public.document_requirement_skips
  select (pg_catalog.jsonb_populate_record(null::public.document_requirement_skips, x.v)).*
    from pg_catalog.jsonb_array_elements(coalesce(g.removed -> 'document_requirement_skips', '[]'::jsonb)) as x(v)
  on conflict do nothing;
  insert into public.contact_tags
  select (pg_catalog.jsonb_populate_record(null::public.contact_tags, x.v)).*
    from pg_catalog.jsonb_array_elements(coalesce(g.removed -> 'contact_tags', '[]'::jsonb)) as x(v)
  on conflict do nothing;

  -- 6. Flags: the ones the merge filed go, the ones it removed come back (an explicit column list: strength is
  --    generated), and the merged pair is a suggestion again (merged_by_hand, the merge's own row, goes).
  delete from public.contact_duplicate_flags
   where account_id = p_account_id
     and id::text in (select pg_catalog.jsonb_array_elements_text(coalesce(g.moved -> 'contact_duplicate_flags_added', '[]'::jsonb)));
  insert into public.contact_duplicate_flags (id, account_id, contact_a, contact_b, reason, created_at, dismissed_at, dismissed_by, merge_id)
  select f.id, f.account_id, f.contact_a, f.contact_b, f.reason, f.created_at, f.dismissed_at, f.dismissed_by, f.merge_id
    from pg_catalog.jsonb_array_elements(coalesce(g.removed -> 'contact_duplicate_flags', '[]'::jsonb)) as x(v)
   cross join lateral pg_catalog.jsonb_populate_record(null::public.contact_duplicate_flags, x.v) as f
  on conflict do nothing;
  delete from public.contact_duplicate_flags where account_id = p_account_id and merge_id = g.id and reason = 'merged_by_hand';
  update public.contact_duplicate_flags set merge_id = null where account_id = p_account_id and merge_id = g.id;

  -- 7. Fields: compare and restore, a group at a time (restoreContactFieldIf's rule, contacts.ts:726). Both sides are
  --    app.merge_fields_of's jsonb, so timestamps compare in one format whatever the session's time zone.
  select app.merge_fields_of(c) into v_cur from public.contacts c where c.id = g.keep_id;
  foreach v_group in array c_groups loop
    v_fields := pg_catalog.string_to_array(v_group, ',');
    v_restore := true;
    v_changed := false;
    foreach v_f in array v_fields loop
      if (v_cur -> v_f) is distinct from (g.keep_after -> v_f) then
        v_restore := false;
      end if;
      if (g.keep_before -> v_f) is distinct from (g.keep_after -> v_f) then
        v_changed := true;
      end if;
    end loop;
    if v_changed and v_restore then
      foreach v_f in array v_fields loop
        v_patch := v_patch || pg_catalog.jsonb_build_object(v_f, g.keep_before -> v_f);
      end loop;
    elsif v_changed then
      v_edits := v_edits || v_fields[1];
    end if;
  end loop;
  if v_patch <> '{}'::jsonb then
    update public.contacts c
       set (first_name, last_name, email, phone, phone_country_unconfirmed, assigned_to, custom, language, language_source,
            language_set_at, last_language_signal, last_language_signal_source, last_language_signal_at, language_hint_kept_at,
            marketing_email_opted_out_at, dnd, reactivation_sent_at, archived_at, archived_by)
         = (select p.first_name, p.last_name, p.email, p.phone, p.phone_country_unconfirmed, p.assigned_to, p.custom, p.language,
                   p.language_source, p.language_set_at, p.last_language_signal, p.last_language_signal_source,
                   p.last_language_signal_at, p.language_hint_kept_at, p.marketing_email_opted_out_at, p.dnd,
                   p.reactivation_sent_at, p.archived_at, p.archived_by
              from pg_catalog.jsonb_populate_record(c, v_patch) as p),
           updated_at = pg_catalog.now()
     where c.account_id = p_account_id and c.id = g.keep_id;
    -- The merge restored an archived kept record; putting the archive back is a person's act with its log row.
    if v_patch ? 'archived_at' and (v_patch ->> 'archived_at') is not null then
      insert into public.contact_archive_log (account_id, contact_id, action, author_kind, author_id)
      values (p_account_id, g.keep_id, 'archived', 'person', v_actor);
    end if;
  end if;
  -- A cache, out of date again: regenerated, never restored.
  delete from public.record_summaries where account_id = p_account_id and contact_id in (g.keep_id, g.other_id);

  -- 8. What reached the kept record after the merge, and stays there.
  select (select pg_catalog.count(*) from public.messages m
           where m.account_id = p_account_id and m.conversation_id = v_kc and m.created_at > g.merged_at)
       + (select pg_catalog.count(*) from public.calls x
           where x.account_id = p_account_id and x.contact_id = g.keep_id and x.started_at > g.merged_at)
       + (select pg_catalog.count(*) from public.inbound_emails i
           where i.account_id = p_account_id and i.conversation_id = v_kc and i.received_at > g.merged_at)
    into v_kept_new;

  -- 9. Stamped, and the event.
  update public.contact_merges set undone_at = pg_catalog.now(), undone_by = v_actor where id = g.id;
  insert into public.events (account_id, type, actor_type, actor_id, payload)
  values (p_account_id, 'contact.merge_undone', 'user', v_actor,
          pg_catalog.jsonb_build_object('contactId', g.keep_id, 'otherId', g.other_id, 'mergeId', g.id));
  return pg_catalog.jsonb_build_object('status', 'undone', 'otherId', g.other_id, 'keptNew', v_kept_new,
                                       'keptEdits', pg_catalog.to_jsonb(v_edits));
end $$;
revoke all on function public.undo_contact_merge(uuid, bigint, text) from public, anon;
grant execute on function public.undo_contact_merge(uuid, bigint, text) to authenticated, service_role;

-- 18. The compare screen's preview (correction 13): INVOKER, so the caller's RLS decides what it can read. The two
--     rows' merge fields and their fingerprints come from the same snapshot as the counts (a STABLE function reads one
--     snapshot), so the screen shows exactly what its `seen` vouches for (review m3). The counts are the other
--     record's rows the merge would move: calls by contact OR by its thread, counted once.
create function public.contact_merge_preview(p_account_id uuid, p_keep uuid, p_other uuid)
returns jsonb
language plpgsql stable set search_path = pg_catalog, pg_temp as $$
declare
  k public.contacts%rowtype;
  o public.contacts%rowtype;
  v_oc uuid;
begin
  if p_keep = p_other then
    return pg_catalog.jsonb_build_object('status', 'same');
  end if;
  select * into k from public.contacts c where c.account_id = p_account_id and c.id = p_keep;
  if not found then
    return pg_catalog.jsonb_build_object('status', 'not_found');
  end if;
  select * into o from public.contacts c where c.account_id = p_account_id and c.id = p_other;
  if not found then
    return pg_catalog.jsonb_build_object('status', 'not_found');
  end if;
  if k.holds_shared_number or o.holds_shared_number then
    return pg_catalog.jsonb_build_object('status', 'holding');
  end if;
  if k.merged_into is not null or o.merged_into is not null then
    return pg_catalog.jsonb_build_object('status', 'already_merged');
  end if;
  select cv.id into v_oc from public.conversations cv where cv.account_id = p_account_id and cv.contact_id = p_other;
  return pg_catalog.jsonb_build_object(
    'status', 'ok',
    'counts', pg_catalog.jsonb_build_object(
      'messages', (select pg_catalog.count(*) from public.messages m where m.account_id = p_account_id and m.conversation_id = v_oc),
      'calls', (select pg_catalog.count(*) from public.calls x
                 where x.account_id = p_account_id and (x.contact_id = p_other or x.conversation_id = v_oc)),
      'bookings', (select pg_catalog.count(*) from public.bookings x where x.account_id = p_account_id and x.contact_id = p_other),
      'documents', (select pg_catalog.count(*) from public.documents x where x.account_id = p_account_id and x.contact_id = p_other),
      'opportunities', (select pg_catalog.count(*) from public.opportunities x where x.account_id = p_account_id and x.contact_id = p_other),
      'notes', (select pg_catalog.count(*) from public.notes x where x.account_id = p_account_id and x.contact_id = p_other),
      'tasks', (select pg_catalog.count(*) from public.tasks x where x.account_id = p_account_id and x.contact_id = p_other),
      'form_submissions', (select pg_catalog.count(*) from public.form_submissions x where x.account_id = p_account_id and x.contact_id = p_other)),
    'fields', pg_catalog.jsonb_build_object('keep', app.merge_fields_of(k), 'other', app.merge_fields_of(o)),
    'seen', pg_catalog.jsonb_build_object('keep', pg_catalog.md5(app.merge_fields_of(k)::text),
                                          'other', pg_catalog.md5(app.merge_fields_of(o)::text)));
end $$;
revoke all on function public.contact_merge_preview(uuid, uuid, uuid) from public, anon;
grant execute on function public.contact_merge_preview(uuid, uuid, uuid) to authenticated, service_role;

-- 19. What each part B object is, and its one writer.
comment on function public.merge_contacts(uuid, uuid, uuid, jsonb, jsonb, text) is
  'Merge p_other into p_keep (0106, F-006): every row moves to the kept record or is removed with a snapshot, the other record stays as a tombstone pointing at the kept one, and contact_merges logs it all for undo_contact_merge. Owners, Staff, the agency and the service role (with p_actor). p_seen is contact_merge_preview''s seen; a changed record answers stale.';
comment on function public.undo_contact_merge(uuid, bigint, text) is
  'Undo a merge within 30 days (0106, F-006): the tombstone is cleared first, then exactly the recorded rows move back and the removed ones return; a field edited since the merge keeps the edit (keptEdits), and rows that reached the kept record after it stay (keptNew). Only the newest merge into a record can be undone (later_merge).';
comment on function public.contact_merge_preview(uuid, uuid, uuid) is
  'The compare screen''s read (0106, F-006): what a merge of p_other into p_keep would move, both records'' merge fields, and their fingerprints (seen) for merge_contacts'' stale check. Invoker: the caller''s RLS decides.';
comment on function app.merge_fields_of(public.contacts) is
  'The merge''s one field list (0106): keep_before, keep_after, the preview''s fields and, through md5, the stale fingerprint. Pinned to UTC so a timestamp prints the same in every session.';
comment on function app.follow_merge() is
  'The backstop (0106): a write that names a merged-away contact lands on the record it was merged into. The pointer is walked by app.merge_target until it ends, every read FOR KEY SHARE (the foreign key''s own lock), so a write racing a merge or an Undo waits for it and lands where the pointer ends.';
comment on column public.contact_merges.other_reply_token is
  'The merged-away thread''s reply token when it was live (0106): replies to email sent before the merge still find the kept thread through it (findReplyThread). Never readable by a signed-in member.';
