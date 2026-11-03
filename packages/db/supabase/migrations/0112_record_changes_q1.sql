-- 0112_record_changes_q1.sql - the change log reaches households, places, equipment, deals, relationships and
-- tags; Undo of a merge names its author; Put back for one custom field; the history download's access-log kind
-- (F-115 part 1 / S-04; docs/superpowers/specs/2026-11-02-record-history-design.md sections 2.1 to 2.4 and 9;
--  docs/superpowers/plans/2026-11-02-record-history.md, Task 3)
--
-- WHY. 0111 records every change to a contact's own fields. The owner's Q1 ruling covers the rest of a customer's
-- record too: households and businesses and their members, places, equipment, deals, relationships and tags. The
-- same trigger, on the same evidence for who made the write, covers them here. A definer that knows who acted must
-- say so, or its rows land unlinked (observe) or refused (enforce); and Put back needs one compare-and-swap write
-- for a single custom key, which PostgREST cannot express as an update. An agency download of a record's history
-- is noted in the BIS access log (owner ruling Q5), which needs its own kind.
--
-- WHAT.
--   app.record_change_fields(record_type): every Q1 type. Each type's AUDITED list is below; every other column of
--     its table is EXCLUDED with a reason, pinned in record-changes-q1-schema.test.ts, so a new column fails there
--     until it is decided. The rule: what a person typed or chose is AUDITED; ids, account_id, timestamps, derived
--     keys and creation provenance are EXCLUDED. A column named 'custom' is diffed per key ('custom.<key>').
--       client_group         AUDITED name, kind, billing_address, custom.
--                            EXCLUDED id, account_id, name_key and search_name (generated), created_at, updated_at.
--       client_group_member  AUDITED role, is_primary, is_billing, is_primary_contact.
--                            EXCLUDED id, account_id, client_group_id and contact_id (the parents, on every row;
--                            only a merge re-points contact_id, and 0106's log holds that), created_at.
--       place                AUDITED label, address, landmark, directions, city, region, postal_code, country,
--                            archived_at (archiving a place is a person's act, and no other log holds it),
--                            contact_id and client_group_id (who the place belongs to: Owners and Staff move a
--                            place between a person and a group, setPlaceOwner).
--                            EXCLUDED id, account_id, created_by (creation provenance, 0073), created_at,
--                            updated_at.
--       equipment            AUDITED name, make, model, serial, notes, installed_on, warranty_until, replaces_id.
--                            EXCLUDED id, account_id, place_id (the parent: a unit's contact and group are read
--                            from its place), created_by, created_at, updated_at.
--       opportunity          AUDITED name, pipeline_id, stage_id, status, monetary_value, assigned_to, custom.
--                            EXCLUDED id, account_id, contact_id (the parent), stage_changed_at and
--                            status_changed_at (stamped with stage and status), quote_followup_sent_at and
--                            quote_followup_sms_failed_at (the quote follow-up pass's bookkeeping), created_by,
--                            created_at, updated_at.
--       contact_relationship AUDITED related_contact_id, label_key, custom_label, contact_form, related_form,
--                            contact_can_pick_up, contact_is_emergency, related_can_pick_up, related_is_emergency.
--                            EXCLUDED id, account_id, contact_id (the parent), created_at, updated_at.
--       contact_tag          AUDITED nothing: a tag is added or removed (an insert or a delete row), never edited.
--                            EXCLUDED contact_id (the parent), tag_id (the record), account_id.
--   app.record_changes_capture(): 0111's body, plus (the reviewer diffs it against 0111):
--     a. contact_tags has no id column: a tag row's record_id is its tag_id (plan correction 8).
--     b. a client_group row's client_group_id is its own id, so the group's page finds its own rows.
--     c. equipment shows where its place shows: its contact_id and client_group_id are read from its place.
--     d. a child's DELETE whose contact (either side of a relationship), group or place no longer exists records
--        nothing (plan correction 6): the parent's own delete row is the record of that removal, and a contact's
--        purge leaves only its one values-free row, nothing of its places, units, tags, memberships or links.
--        Decided before the author, like 0111's account check, so a cascade is never refused.
--   Two AFTER ROW triggers on each of public.client_groups, client_group_members, places, equipment,
--     opportunities, contact_relationships and contact_tags: record_changes_client (WHEN current_user =
--     'authenticated') and record_changes_server (WHEN current_user <> 'authenticated').
--   public.undo_contact_merge: 0106's body, plus bis.author 'person', bis.author_id v_actor and bis.via
--     'merge:<p_merge_id>' once the actor is known, and all three set back to '' before each of its five returns
--     (plan correction 7). v_actor, not the plan's coalesce(p_actor, sub): 0106 already takes p_actor only from a
--     service-role JWT, and a signed-in caller can pass any p_actor (a coalesce would let them write another
--     person's id into the log).
--   NOT CHANGED, on purpose:
--     public.merge_contacts. Its step 6 overwrites the kept record's audited fields (0106:1032-1053), and its steps
--       4 and 7 move and remove group memberships, relationships and tags, all BEFORE the contact_merges row is
--       inserted and its id is known (0106:1207). The brief says stop and report rather than reorder; the change
--       that would let it say 'merge:<id>' waits for that ruling. Until then a merge's rows are the person's (step 3
--       of 0111's precedence: the session role is authenticated) or the header's (a service call), with no via.
--     public.restore_contact_on_sign writes archived_at and archived_by only, both EXCLUDED for contacts, so 0111's
--       no-change return writes nothing and never refuses it: it needs no author.
--     public.delete_internal_contacts: a signed-in Owner's call is the person (step 3), and deleteContacts sends
--       x-bis-author on a service client (PR A). Its one values-free row is pinned in the Q1 test.
--     The 0069 and 0075 group functions are INVOKER and service_role only: their writes take the header (step 4),
--       which their TypeScript callers must send (plan Task 3 Step 7, bis-crm).
--   public.put_back_contact_custom(account, contact, key, expected, value) -> boolean: INVOKER (RLS decides), sets
--     or removes one custom key only while it still holds expected; null when it did not. Not a definer.
--   agency_visit_items' kind CHECK gains 'record_history_export' (an agency download of one record's history;
--     record_id is the contact's or the group's id; no count). 0105's record_check and export_count_check hold for
--     it unchanged. access_log_page counts it. note_agency_open is unchanged (its record branch fits).
--   Unattributed rows of the seven new types are counted by the daily audit exactly as contacts' are, through 0111's
--     record_changes_unattributed_idx (0113 drops it with the NOT NULL); nothing here touches that index.
--
-- GRANTS. put_back_contact_custom: everything revoked from public, anon, authenticated and service_role, then
-- EXECUTE to authenticated only (a service client would bypass the RLS that keeps a Technician out). Every replaced
-- function keeps its grants; the file restates each one's own revoke and grant lines from 0111, 0106 and 0105.
-- No table grant moves: the client-write digest is unchanged, EXPECTED_WRITES is unchanged, and EXPECTED_DEFINERS
-- stays 39 (undo_contact_merge is replaced, not added; put_back_contact_custom is an invoker).
--
-- SEARCH PATHS. Every function here says set search_path = pg_catalog, pg_temp, and names every relation and
-- function by schema (0096's rule). No function in public or app sets bis.* except the listed definers; the Q1
-- test enumerates every set_config in their bodies against that list.
--
-- LOCKS AND COST. The file runs as one transaction; lock_timeout 5s bounds only the WAIT for each lock.
-- client_groups, client_group_members, places, equipment, opportunities, contact_relationships, contact_tags: each
-- create trigger takes SHARE ROW EXCLUSIVE until the file commits (no scan, no rewrite), so a write to any of them
-- waits for the file. agency_visit_items: the CHECK swap takes ACCESS EXCLUSIVE until the file commits and scans
-- the table once to validate (an append-only log of ids, small), so an agency open waits for the file. Replacing a
-- function locks no table.
-- MEASURED on a PostgreSQL 17.6 replica (pre = 0001-0111, post = pre + this file; T1's method: one account, a fresh
-- database per run, the merge timed alone, as an Owner):
--   merge moving 10,000 messages (T1's seed: no Q1 rows on either record), 2026-11-03: before 378.6 ms, after
--     386.3 ms (+2%), median of 3 (342.5, 378.6, 396.6 -> 348.7, 386.3, 421.2); 2 change rows, as under 0111 alone.
--   the same merge with Q1 rows on the other record (2 places, 4 units, 3 tags, a shared household, 2 relationships,
--     2 deals), before and after interleaved, median of 3: the merge 394.8 ms -> 372.7 ms (within noise), 5 change
--     rows (the 2 fields, the 2 places' new owner, the removed membership; no via, see merge_contacts above); its
--     Undo 427.4 ms -> 441.4 ms (+3%), 5 change rows, every one the person's with via merge:<id>.
--
-- LOAD-BEARING.
--   1. The role test sits in each trigger's WHEN, never in the body (0111 load-bearing 1).
--   2. A child's cascaded delete returns BEFORE the author is decided: a purge or a group's removal is recorded once,
--      by its parent, and is never refused because a cascade has no header of its own.
--   3. A definer that sets bis.author, bis.author_id or bis.via sets all three back to '' before EVERY return
--      (correction 7). A new one is added to EXPECTED_BIS_SETTERS in record-changes-q1-schema.test.ts.
--   4. Group writes are service-only: until their TypeScript callers send x-bis-author (bis-crm, plan Task 3 Step 7),
--      production records them unattributed (observe) and CI refuses them (enforce).
--
-- ROLLBACK (revert the app first). Each line restores what 0111, 0106 or 0105 shipped:
--   drop trigger record_changes_client on public.<table>; drop trigger record_changes_server on public.<table>;
--     for each of client_groups, client_group_members, places, equipment, opportunities, contact_relationships,
--     contact_tags;
--   re-run 0111 section 3's and section 4's function bodies as create or replace (contacts only, no child rules);
--   re-run 0106 section 17's undo_contact_merge as create or replace;
--   drop function public.put_back_contact_custom(uuid, uuid, text, jsonb, jsonb);
--   re-run 0105's access_log_page as create or replace; then, by OWNER DECISION ONLY (it deletes access-log rows,
--     which nothing else may), delete the record_history_export items and restore 0105's kind CHECK.
--   The change rows already written stay: they are history (0111's rule).
--
-- ASCII only, no backslash anywhere, and every dollar sign in this file is part of a dollar-quote pair.

-- 0. Fail fast instead of queueing behind a long lock.
do $$
begin
  perform pg_catalog.set_config('lock_timeout', '5s', true);
end $$;

-- 1. The audited columns of every Q1 type (0111 listed contacts only). Grants unchanged (0111).
create or replace function app.record_change_fields(p_type text) returns text[]
language sql immutable set search_path = pg_catalog, pg_temp as $$
  select case p_type
    when 'contact' then array['first_name', 'last_name', 'email', 'phone', 'assigned_to', 'dnd', 'source',
                              'marketing_email_opted_out_at', 'language', 'custom']
    when 'client_group' then array['name', 'kind', 'billing_address', 'custom']
    when 'client_group_member' then array['role', 'is_primary', 'is_billing', 'is_primary_contact']
    when 'place' then array['label', 'address', 'landmark', 'directions', 'city', 'region', 'postal_code', 'country',
                            'archived_at', 'contact_id', 'client_group_id']
    when 'equipment' then array['name', 'make', 'model', 'serial', 'notes', 'installed_on', 'warranty_until', 'replaces_id']
    when 'opportunity' then array['name', 'pipeline_id', 'stage_id', 'status', 'monetary_value', 'assigned_to', 'custom']
    when 'contact_relationship' then array['related_contact_id', 'label_key', 'custom_label', 'contact_form', 'related_form',
                                           'contact_can_pick_up', 'contact_is_emergency', 'related_can_pick_up',
                                           'related_is_emergency']
    when 'contact_tag' then '{}'::text[]
  end
$$;
revoke all on function app.record_change_fields(text) from public, anon, authenticated, service_role;
grant execute on function app.record_change_fields(text) to authenticated, service_role;

-- 2. The capture: 0111's body, plus a tag's record id, a group's own group id, a unit's place, and a child's
--    cascaded delete recording nothing. Grants unchanged (0111: EXECUTE to nobody).
create or replace function app.record_changes_capture() returns trigger
language plpgsql security definer set search_path = pg_catalog, pg_temp as $$
declare
  v_type text := tg_argv[0];
  v_path text := tg_argv[1];
  v_fields text[] := coalesce(app.record_change_fields(tg_argv[0]), '{}'::text[]);
  v_old jsonb := case when tg_op <> 'INSERT' then pg_catalog.to_jsonb(old) end;
  v_new jsonb := case when tg_op <> 'DELETE' then pg_catalog.to_jsonb(new) end;
  v_row jsonb := coalesce(v_new, v_old);
  v_account uuid := (v_row ->> 'account_id')::uuid;
  v_role text := coalesce(pg_catalog.current_setting('role', true), 'none');
  v_claims jsonb;
  v_sub text;
  v_raw text;
  v_hdr jsonb;
  v_kind text; v_id text; v_via text;
  v_contact uuid; v_group uuid; v_record uuid;
  v_f text[] := '{}'::text[];
  v_b jsonb[] := '{}'::jsonb[];
  v_a jsonb[] := '{}'::jsonb[];
  f text; k text;
begin
  -- Plan correction 6: a cascade from the account (teardown) records nothing.
  if tg_op = 'DELETE' and not exists (select 1 from public.accounts a where a.id = v_account) then
    return null;
  end if;
  -- 0112, plan correction 6 for a child: a delete whose contact (either side of a relationship), group or place is
  -- already gone was cascaded from that parent's removal, and the parent's own delete row is the record of it. A
  -- contact's purge leaves its one values-free row and nothing of its places, units, tags, memberships or links.
  if tg_op = 'DELETE' and v_type not in ('contact', 'client_group') and (
       ((v_old ->> 'contact_id') is not null
         and not exists (select 1 from public.contacts k where k.id = (v_old ->> 'contact_id')::uuid))
    or ((v_old ->> 'related_contact_id') is not null
         and not exists (select 1 from public.contacts k where k.id = (v_old ->> 'related_contact_id')::uuid))
    or ((v_old ->> 'client_group_id') is not null
         and not exists (select 1 from public.client_groups g where g.id = (v_old ->> 'client_group_id')::uuid))
    or ((v_old ->> 'place_id') is not null
         and not exists (select 1 from public.places p where p.id = (v_old ->> 'place_id')::uuid))) then
    return null;
  end if;

  -- An update: what changed, BEFORE who made it (review I1). An update that changes no audited field writes
  -- nothing, so it is never refused either: enforce mode refuses exactly the writes observe mode would record
  -- without an author, and a stamp of an EXCLUDED column (reactivation_sent_at) is never blocked.
  if tg_op = 'UPDATE' then
    foreach f in array v_fields loop
      if f = 'custom'
         and pg_catalog.jsonb_typeof(coalesce(v_old -> 'custom', '{}'::jsonb)) = 'object'
         and pg_catalog.jsonb_typeof(coalesce(v_new -> 'custom', '{}'::jsonb)) = 'object' then
        for k in select pg_catalog.jsonb_object_keys(coalesce(v_old -> 'custom', '{}'::jsonb))
                 union select pg_catalog.jsonb_object_keys(coalesce(v_new -> 'custom', '{}'::jsonb)) loop
          if (v_old -> 'custom' -> k) is distinct from (v_new -> 'custom' -> k) then
            v_f := pg_catalog.array_append(v_f, 'custom.' || k);
            v_b := pg_catalog.array_append(v_b, v_old -> 'custom' -> k);
            v_a := pg_catalog.array_append(v_a, v_new -> 'custom' -> k);
          end if;
        end loop;
      elsif (v_old -> f) is distinct from (v_new -> f) then
        v_f := pg_catalog.array_append(v_f, f);
        v_b := pg_catalog.array_append(v_b, v_old -> f);
        v_a := pg_catalog.array_append(v_a, v_new -> f);
      end if;
    end loop;
    if pg_catalog.cardinality(v_f) = 0 then
      return null;
    end if;
  end if;

  v_claims := nullif(pg_catalog.current_setting('request.jwt.claims', true), '')::jsonb;
  v_sub := nullif(pg_catalog.btrim(v_claims ->> 'sub'), '');
  -- Only the x-bis-author key: request.headers also carries the bearer token.
  v_raw := nullif(pg_catalog.current_setting('request.headers', true), '')::jsonb ->> 'x-bis-author';
  if v_raw is not null then
    begin
      v_hdr := v_raw::jsonb;
    exception when invalid_text_representation then
      v_hdr := null;   -- a malformed header is no author
    end;
    if pg_catalog.jsonb_typeof(v_hdr) is distinct from 'object' then
      v_hdr := null;
    end if;
  end if;

  -- Who made the write (spec 2.3; plan corrections 4 and 9).
  if v_path = 'client' then
    v_kind := case when v_hdr ->> 'kind' = 'import' then 'import' else 'person' end;
    v_id := v_sub;
    v_via := v_hdr ->> 'via';
    if not coalesce(pg_catalog.left(v_via, 8) = 'restore:' and pg_catalog.length(v_via) between 9 and 27
                    and pg_catalog.substr(v_via, 9) !~ '[^0-9]', false) then
      v_via := null;
    end if;
  elsif nullif(pg_catalog.current_setting('bis.author', true), '') is not null then
    v_kind := pg_catalog.current_setting('bis.author', true);
    v_id := nullif(pg_catalog.current_setting('bis.author_id', true), '');
    v_via := nullif(pg_catalog.current_setting('bis.via', true), '');
  elsif v_role = 'authenticated' then
    v_kind := 'person';
    v_id := v_sub;
  elsif v_role = 'service_role'
        and v_hdr ->> 'kind' in ('person', 'ai', 'automation', 'customer', 'import')
        and (v_hdr ->> 'kind' <> 'person' or nullif(pg_catalog.btrim(v_hdr ->> 'id'), '') is not null) then
    v_kind := v_hdr ->> 'kind';
    v_id := nullif(pg_catalog.btrim(v_hdr ->> 'id'), '');
    v_via := nullif(v_hdr ->> 'via', '');
  elsif v_role not in ('anon', 'authenticated', 'service_role') then
    v_kind := 'automation';
    v_via := 'sql';
  elsif (select s.enforce from app.record_changes_settings s) then
    raise exception 'record_changes: a server write must say who made it' using errcode = '42501';
  end if;
  if v_kind is distinct from 'person' and v_kind is distinct from 'import' then
    v_id := null;
  end if;

  -- Where it shows.
  v_record := case v_type when 'contact_tag' then (v_row ->> 'tag_id')::uuid else (v_row ->> 'id')::uuid end;   -- 0112: no id
  v_contact := case v_type when 'contact' then v_record else (v_row ->> 'contact_id')::uuid end;
  v_group := case v_type when 'client_group' then v_record else (v_row ->> 'client_group_id')::uuid end;   -- 0112
  -- 0112: a unit shows where its place shows.
  if v_type = 'equipment' then
    select p.contact_id, p.client_group_id into v_contact, v_group from public.places p where p.id = (v_row ->> 'place_id')::uuid;
  end if;

  if tg_op = 'INSERT' then
    insert into public.record_changes (account_id, record_type, record_id, contact_id, client_group_id, op, after,
                                       author_kind, author_id, via)
    select v_account, v_type, v_record, v_contact, v_group, 'insert',
           (select pg_catalog.jsonb_object_agg(x, v_new -> x) from pg_catalog.unnest(v_fields) as x),
           v_kind, v_id, v_via;
  elsif tg_op = 'DELETE' then
    if v_type = 'contact' then
      -- Spec 2.2: the old values do not outlive a deletion the Owner asked for; the fact does.
      delete from public.record_changes r where r.account_id = v_account and r.contact_id = v_record;
      insert into public.record_changes (account_id, record_type, record_id, contact_id, op, author_kind, author_id, via)
      values (v_account, v_type, v_record, v_record, 'delete', v_kind, v_id, v_via);
    else
      insert into public.record_changes (account_id, record_type, record_id, contact_id, client_group_id, op, before,
                                         author_kind, author_id, via)
      values (v_account, v_type, v_record, v_contact, v_group, 'delete', v_old, v_kind, v_id, v_via);
    end if;
  else
    insert into public.record_changes (account_id, record_type, record_id, contact_id, client_group_id, op, field,
                                       before, after, author_kind, author_id, via)
    select v_account, v_type, v_record, v_contact, v_group, 'update', u.f, u.b, u.a, v_kind, v_id, v_via
      from unnest(v_f, v_b, v_a) as u(f, b, a);   -- multi-argument unnest is FROM-clause syntax; it takes no schema
  end if;
  return null;
end $$;
revoke all on function app.record_changes_capture() from public, anon, authenticated, service_role;

-- 3. The seven tables. The role test is in WHEN, as for contacts (0111 section 5; 0103:200-203).
create trigger record_changes_client after insert or update or delete on public.client_groups
  for each row when (current_user = 'authenticated')
  execute function app.record_changes_capture('client_group', 'client');
create trigger record_changes_server after insert or update or delete on public.client_groups
  for each row when (current_user <> 'authenticated')
  execute function app.record_changes_capture('client_group', 'server');
create trigger record_changes_client after insert or update or delete on public.client_group_members
  for each row when (current_user = 'authenticated')
  execute function app.record_changes_capture('client_group_member', 'client');
create trigger record_changes_server after insert or update or delete on public.client_group_members
  for each row when (current_user <> 'authenticated')
  execute function app.record_changes_capture('client_group_member', 'server');
create trigger record_changes_client after insert or update or delete on public.places
  for each row when (current_user = 'authenticated')
  execute function app.record_changes_capture('place', 'client');
create trigger record_changes_server after insert or update or delete on public.places
  for each row when (current_user <> 'authenticated')
  execute function app.record_changes_capture('place', 'server');
create trigger record_changes_client after insert or update or delete on public.equipment
  for each row when (current_user = 'authenticated')
  execute function app.record_changes_capture('equipment', 'client');
create trigger record_changes_server after insert or update or delete on public.equipment
  for each row when (current_user <> 'authenticated')
  execute function app.record_changes_capture('equipment', 'server');
create trigger record_changes_client after insert or update or delete on public.opportunities
  for each row when (current_user = 'authenticated')
  execute function app.record_changes_capture('opportunity', 'client');
create trigger record_changes_server after insert or update or delete on public.opportunities
  for each row when (current_user <> 'authenticated')
  execute function app.record_changes_capture('opportunity', 'server');
create trigger record_changes_client after insert or update or delete on public.contact_relationships
  for each row when (current_user = 'authenticated')
  execute function app.record_changes_capture('contact_relationship', 'client');
create trigger record_changes_server after insert or update or delete on public.contact_relationships
  for each row when (current_user <> 'authenticated')
  execute function app.record_changes_capture('contact_relationship', 'server');
create trigger record_changes_client after insert or update or delete on public.contact_tags
  for each row when (current_user = 'authenticated')
  execute function app.record_changes_capture('contact_tag', 'client');
create trigger record_changes_server after insert or update or delete on public.contact_tags
  for each row when (current_user <> 'authenticated')
  execute function app.record_changes_capture('contact_tag', 'server');

-- 4. undo_contact_merge names its author (plan Task 3 item 3). merge_contacts is NOT changed here: see the header.
create or replace function public.undo_contact_merge(p_account_id uuid, p_merge_id bigint, p_actor text default null)
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
  -- 0112 (F-115): every change row this Undo writes is the person's (v_actor: the token's sub, or p_actor on a
  -- service-role JWT only, never a signed-in caller's p_actor), linked to the merge it undoes. Plan correction 7:
  -- all three go back to '' before every return below.
  perform pg_catalog.set_config('bis.author', 'person', true);
  perform pg_catalog.set_config('bis.author_id', v_actor, true);
  perform pg_catalog.set_config('bis.via', 'merge:' || p_merge_id::text, true);

  -- 1. The merge row, locked: two Undos of one merge serialise here.
  select * into g from public.contact_merges m where m.account_id = p_account_id and m.id = p_merge_id for update;
  if not found then
    perform pg_catalog.set_config('bis.author', '', true), pg_catalog.set_config('bis.author_id', '', true),
            pg_catalog.set_config('bis.via', '', true);   -- 0112
    return pg_catalog.jsonb_build_object('status', 'not_found');
  end if;
  if g.undone_at is not null then
    perform pg_catalog.set_config('bis.author', '', true), pg_catalog.set_config('bis.author_id', '', true),
            pg_catalog.set_config('bis.via', '', true);   -- 0112
    return pg_catalog.jsonb_build_object('status', 'already_undone');
  end if;
  if pg_catalog.now() > g.undo_until then
    perform pg_catalog.set_config('bis.author', '', true), pg_catalog.set_config('bis.author_id', '', true),
            pg_catalog.set_config('bis.via', '', true);   -- 0112
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
    perform pg_catalog.set_config('bis.author', '', true), pg_catalog.set_config('bis.author_id', '', true),
            pg_catalog.set_config('bis.via', '', true);   -- 0112
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
  perform pg_catalog.set_config('bis.author', '', true), pg_catalog.set_config('bis.author_id', '', true),
          pg_catalog.set_config('bis.via', '', true);   -- 0112
  return pg_catalog.jsonb_build_object('status', 'undone', 'otherId', g.other_id, 'keptNew', v_kept_new,
                                       'keptEdits', pg_catalog.to_jsonb(v_edits));
end $$;
revoke all on function public.undo_contact_merge(uuid, bigint, text) from public, anon;
grant execute on function public.undo_contact_merge(uuid, bigint, text) to authenticated, service_role;

-- 5. Put back one custom field (plan Task 3 item 4). INVOKER: RLS decides, and a signed-in caller's write takes the
--    client path (a person mark; a restore:<n> via from the header). Lands only while the key still holds p_expected
--    (compare and swap); a stale value answers null and writes nothing. A null p_value takes the key away.
create function public.put_back_contact_custom(p_account_id uuid, p_contact_id uuid, p_key text, p_expected jsonb,
                                               p_value jsonb)
returns boolean
language sql volatile security invoker set search_path = pg_catalog, pg_temp as $$
  update public.contacts
     set custom = case when p_value is null then coalesce(custom, '{}'::jsonb) - p_key
                       else pg_catalog.jsonb_set(coalesce(custom, '{}'::jsonb), array[p_key], p_value) end
   where account_id = p_account_id and id = p_contact_id
     and (custom -> p_key) is not distinct from p_expected
  returning true
$$;
revoke all on function public.put_back_contact_custom(uuid, uuid, text, jsonb, jsonb) from public, anon, authenticated, service_role;
grant execute on function public.put_back_contact_custom(uuid, uuid, text, jsonb, jsonb) to authenticated;

-- 6. The access log learns an agency download of one record's history (owner ruling Q5; plan Task 8). Its record_id
--    is the contact's or the group's id and it carries no count, so 0105's record_check and export_count_check
--    already hold for it unchanged; note_agency_open's record branch writes it once per record per visit.
alter table public.agency_visit_items drop constraint agency_visit_items_kind_check;
alter table public.agency_visit_items add constraint agency_visit_items_kind_check check (kind in (
  'contact', 'group', 'call', 'conversation', 'document_view', 'document_download', 'document_share',
  'form_answers', 'customer_list_export', 'record_history_export'));
create or replace function public.access_log_page(
  p_account_id uuid, p_before_started timestamptz, p_before_id uuid, p_limit integer)
returns jsonb language plpgsql stable security invoker set search_path = pg_catalog, pg_temp as $$
declare v_total bigint; v_visits jsonb;
begin
  if p_account_id is null or p_limit is null then
    raise exception 'access_log_page: a required argument is null' using errcode = '22004';
  end if;
  if p_limit < 1 or p_limit > 50 then
    raise exception 'access_log_page: p_limit must be 1 to 50' using errcode = '22023';
  end if;
  if (p_before_started is null) <> (p_before_id is null) then
    raise exception 'access_log_page: a cursor needs both halves' using errcode = '22023';
  end if;
  select count(*) into v_total from public.agency_visits v where v.account_id = p_account_id;
  select coalesce(jsonb_agg(pg.visit order by pg.started_at desc, pg.id desc), '[]'::jsonb) into v_visits
  from (
    select v.id, v.started_at, jsonb_build_object(
      'id', v.id, 'actor_name', v.actor_name, 'reason', v.reason, 'started_at', v.started_at,
      'ended_at', (select max(i.first_opened_at) from public.agency_visit_items i where i.visit_id = v.id),
      'counts', (select jsonb_build_object(
          'contact', count(*) filter (where i.kind = 'contact'),
          'group', count(*) filter (where i.kind = 'group'),
          'call', count(*) filter (where i.kind = 'call'),
          'conversation', count(*) filter (where i.kind = 'conversation'),
          'file', count(distinct i.record_id) filter (where i.kind in ('document_view', 'document_download', 'document_share')),
          'form_answers', count(*) filter (where i.kind = 'form_answers'),
          'customer_list_export', count(*) filter (where i.kind = 'customer_list_export'),
          'record_history_export', count(*) filter (where i.kind = 'record_history_export'))
        from public.agency_visit_items i where i.visit_id = v.id),
      'item_total', (select count(*) from public.agency_visit_items i where i.visit_id = v.id),
      'items', (select coalesce(jsonb_agg(jsonb_build_object(
            'kind', x.kind, 'record_id', x.record_id, 'item_count', x.item_count, 'first_opened_at', x.first_opened_at)
            order by x.first_opened_at desc, x.id desc), '[]'::jsonb)
        from (select i.id, i.kind, i.record_id, i.item_count, i.first_opened_at
                from public.agency_visit_items i where i.visit_id = v.id
               order by i.first_opened_at desc, i.id desc limit 100) x)
    ) as visit
    from public.agency_visits v
    where v.account_id = p_account_id
      and (p_before_started is null or (v.started_at, v.id) < (p_before_started, p_before_id))
    order by v.started_at desc, v.id desc
    limit p_limit + 1
  ) pg;
  return jsonb_build_object('total', v_total, 'visits', v_visits);
end $$;
revoke all on function public.access_log_page(uuid, timestamptz, uuid, integer) from public, anon, authenticated, service_role;
grant execute on function public.access_log_page(uuid, timestamptz, uuid, integer) to authenticated;
