-- 0069_client_groups.sql -- Client groups and the business name
-- (docs/superpowers/specs/2026-10-11-client-groups-design.md, section 5)
--
-- A customer can belong to households and business customers. Two tables, written by server code only
-- (0053's pattern): the client role reads them under the tenant policy plus 0068's restrictive Technician
-- policy, and writes nothing. contacts.company_name becomes a COPY the database keeps: the trigger in
-- section 6 sets it to the contact's business group name (main first, then oldest), and
-- reconcile_business_groups() (section 8) backfills a business group per distinct name per account.
-- ASCII only, no backslash anywhere (0050's rule; the MCP apply has mangled escapes before).
--
-- APPLY ORDER: CI project (ci-project-setup.yml push-dry-run, then push), then production (MCP
-- apply_migration), then the parity check, then merge. After the new app is live the orchestrator runs
-- select public.reconcile_business_groups(); once on each project (spec section 11).
-- Run that post-deploy reconcile only AFTER the old deployment has stopped serving: an old build still
-- taking requests can write company_name straight to the column after the reconcile has passed that
-- contact, and only the next reconcile would fold that write in.
--
-- ROLLBACK (revert the app first; the old build reads company_name, which stays filled):
--   drop table public.client_group_members; drop table public.client_groups;
--   drop function public.create_group_with_member(uuid,uuid,text,text,text), public.add_contact_to_group(uuid,uuid,uuid,text),
--     public.set_contacts_business(uuid,uuid[],text[]), public.undo_set_business(uuid,uuid,uuid,jsonb),
--     public.set_primary_group_membership(uuid,uuid), public.remove_group_membership(uuid,uuid),
--     public.restore_group_membership(uuid,jsonb), public.reconcile_business_groups(uuid);
--   drop function app.sync_company_name(), app.company_name_for(uuid), app.lock_contact(uuid,uuid), app.promote_primary(uuid),
--     app.link_member(uuid,uuid,uuid,text,boolean), app.find_or_create_business(uuid,text), app.restore_member(uuid,jsonb),
--     app.my_client_group_ids(), app.group_name_key(text), app.group_ws();
--   Lost: households, roles, main and pays flags and billing addresses made since. Export them first.

set local lock_timeout = '5s';

-- 1. The name key. 0034's explicit whitespace class, spelled with chr() so this file holds no backslash.
create function app.group_ws() returns text
language sql immutable parallel safe set search_path = '' as $$
  select ' ' || chr(9) || chr(10) || chr(11) || chr(12) || chr(13) || chr(160)
$$;
create function app.group_name_key(p_name text) returns text
language sql immutable parallel safe set search_path = '' as $$
  select lower(btrim(coalesce(p_name, ''), app.group_ws()))
$$;

-- 2. Tables. Composite FKs (0050) make a crossed row unwritable. account_id cascades so an old build's
--    teardown, which does not list these tables, still succeeds; contacts still refuse an account delete.
create table public.client_groups (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  kind text not null constraint client_groups_kind_check check (kind in ('household', 'business')),
  name text not null
    constraint client_groups_name_check check (char_length(btrim(name, app.group_ws())) between 1 and 120)
    constraint client_groups_name_trimmed check (name = btrim(name, app.group_ws())),
  name_key text generated always as (app.group_name_key(name)) stored,
  billing_address text constraint client_groups_billing_address_check
    check (billing_address is null or char_length(btrim(billing_address, app.group_ws())) between 1 and 300),
  custom jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint client_groups_account_id_id_key unique (account_id, id)
);

create table public.client_group_members (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  client_group_id uuid not null,
  contact_id uuid not null,
  role text constraint client_group_members_role_check check (role is null or char_length(role) between 1 and 60),
  is_primary boolean not null default false,
  is_billing boolean not null default false,
  -- clock_timestamp(), not now(): "oldest" orders the main-group fallback and the company_name copy, and
  -- now() is the same for every row one transaction writes (the backfill, an import batch, a test).
  created_at timestamptz not null default clock_timestamp(),
  constraint client_group_members_group_fkey foreign key (account_id, client_group_id)
    references public.client_groups(account_id, id) on delete cascade,
  constraint client_group_members_contact_fkey foreign key (account_id, contact_id)
    references public.contacts(account_id, id) on delete cascade,
  constraint client_group_members_group_contact_key unique (client_group_id, contact_id)
);

create unique index client_groups_business_key on public.client_groups (account_id, name_key) where kind = 'business';
create index client_groups_account_key on public.client_groups (account_id, name_key);
create unique index client_group_members_one_primary on public.client_group_members (contact_id) where is_primary;
create index client_group_members_contact on public.client_group_members (account_id, contact_id);

-- 3. Read-only for the client role. A new table gets Supabase's default ALL again.
alter table public.client_groups enable row level security;
alter table public.client_group_members enable row level security;
revoke all on public.client_groups, public.client_group_members from anon;
revoke insert, update, delete, truncate, references, trigger, maintain
  on public.client_groups, public.client_group_members from authenticated;
create policy client_groups_member_read on public.client_groups for select to authenticated
  using (app.is_agency() or account_id = app.current_account_id());
create policy client_group_members_member_read on public.client_group_members for select to authenticated
  using (app.is_agency() or account_id = app.current_account_id());

-- 4. The Technician (G8): a group only through a customer assigned to them, and only that member.
create function app.my_client_group_ids() returns setof uuid
language sql stable security definer set search_path = '' as $$
  select m.client_group_id from public.client_group_members m
   where m.account_id = app.current_account_id() and m.contact_id in (select app.my_contact_ids())
$$;
create policy client_group_members_technician_scope on public.client_group_members as restrictive for select to authenticated
  using ((select app.sees_all_customers(app.current_account_id())) or contact_id in (select app.my_contact_ids()));
create policy client_groups_technician_scope on public.client_groups as restrictive for select to authenticated
  using ((select app.sees_all_customers(app.current_account_id())) or id in (select app.my_client_group_ids()));

-- 5. Private helpers for the write functions.
create function app.company_name_for(p_contact_id uuid) returns text
language sql stable set search_path = '' as $$
  select g.name from public.client_group_members m
    join public.client_groups g on g.account_id = m.account_id and g.id = m.client_group_id
   where m.contact_id = p_contact_id and g.kind = 'business'
   order by m.is_primary desc, m.created_at, m.id
   limit 1
$$;

create function app.lock_contact(p_account_id uuid, p_contact_id uuid) returns boolean
language plpgsql set search_path = '' as $$
begin
  perform 1 from public.contacts where id = p_contact_id and account_id = p_account_id for no key update;
  return found;
end $$;

create function app.promote_primary(p_contact_id uuid) returns void
language plpgsql set search_path = '' as $$
begin
  if not exists (select 1 from public.client_group_members where contact_id = p_contact_id and is_primary) then
    update public.client_group_members set is_primary = true
     where id = (select id from public.client_group_members where contact_id = p_contact_id order by created_at, id limit 1);
  end if;
end $$;

create function app.link_member(p_account_id uuid, p_group_id uuid, p_contact_id uuid, p_role text, p_primary boolean)
returns uuid language plpgsql set search_path = '' as $$
declare v_member uuid;
begin
  if coalesce(p_primary, false) then
    update public.client_group_members set is_primary = false where contact_id = p_contact_id and is_primary;
  end if;
  insert into public.client_group_members (account_id, client_group_id, contact_id, role, is_primary)
  values (p_account_id, p_group_id, p_contact_id, nullif(btrim(coalesce(p_role, ''), app.group_ws()), ''),
          coalesce(p_primary, false)
          or not exists (select 1 from public.client_group_members x where x.contact_id = p_contact_id))
  on conflict (client_group_id, contact_id) do nothing
  returning id into v_member;
  if v_member is null then
    select id into v_member from public.client_group_members where client_group_id = p_group_id and contact_id = p_contact_id;
    if coalesce(p_primary, false) then
      update public.client_group_members set is_primary = true where id = v_member;
    end if;
  end if;
  return v_member;
end $$;

create function app.find_or_create_business(p_account_id uuid, p_name text, out group_id uuid, out existed boolean)
language plpgsql set search_path = '' as $$
declare v_name text := btrim(coalesce(p_name, ''), app.group_ws());
begin
  select g.id into group_id from public.client_groups g
   where g.account_id = p_account_id and g.kind = 'business' and g.name_key = app.group_name_key(v_name);
  if group_id is not null then existed := true; return; end if;
  insert into public.client_groups (account_id, kind, name) values (p_account_id, 'business', v_name)
  on conflict (account_id, name_key) where kind = 'business' do nothing
  returning id into group_id;
  existed := group_id is null;
  if group_id is null then
    select g.id into group_id from public.client_groups g
     where g.account_id = p_account_id and g.kind = 'business' and g.name_key = app.group_name_key(v_name);
  end if;
end $$;

create function app.restore_member(p_account_id uuid, p_snapshot jsonb) returns text
language plpgsql set search_path = '' as $$
declare
  v_contact uuid := (p_snapshot ->> 'contact_id')::uuid;
  v_group uuid := (p_snapshot ->> 'client_group_id')::uuid;
  v_primary boolean := coalesce((p_snapshot ->> 'is_primary')::boolean, false);
begin
  perform 1 from public.client_groups where id = v_group and account_id = p_account_id;
  if not found then return 'not_found'; end if;
  perform 1 from public.contacts where id = v_contact and account_id = p_account_id;
  if not found then return 'not_found'; end if;
  if exists (select 1 from public.client_group_members where client_group_id = v_group and contact_id = v_contact) then
    return 'ok';
  end if;
  if v_primary then
    update public.client_group_members set is_primary = false where contact_id = v_contact and is_primary;
  end if;
  insert into public.client_group_members (id, account_id, client_group_id, contact_id, role, is_primary, is_billing, created_at)
  values ((p_snapshot ->> 'id')::uuid, p_account_id, v_group, v_contact, p_snapshot ->> 'role', v_primary,
          coalesce((p_snapshot ->> 'is_billing')::boolean, false),
          coalesce((p_snapshot ->> 'created_at')::timestamptz, now()));
  return 'ok';
end $$;

-- 6. The company_name sync (spec A2). SECURITY DEFINER: it writes a column the request role may not, and
--    it fires inside cascades. It never touches updated_at and emits nothing. A household never sets it,
--    and neither a household change nor a role or "Pays the bills" edit recomputes it: an old build's
--    direct write to the column (spec section 11) is left alone until a contact's BUSINESS membership is
--    added, removed, made or unmade main, or moved, or one of its business groups is renamed or changes
--    kind. Only those columns fire the member trigger: a role or pays edit on a business membership once
--    recomputed the column and erased that direct write, which the next reconcile could not see to recover.
--    A membership whose group row is already gone is a cascade from a group delete, whose kind can no
--    longer be read, so it recomputes.
create function app.sync_company_name() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_table_name = 'client_groups' then
    update public.contacts c set company_name = app.company_name_for(c.id)
     where c.id in (select m.contact_id from public.client_group_members m where m.client_group_id = new.id)
       and c.company_name is distinct from app.company_name_for(c.id);
    return null;
  end if;
  if tg_op <> 'INSERT'
     and not exists (select 1 from public.client_groups g where g.id = old.client_group_id and g.kind = 'household') then
    update public.contacts c set company_name = app.company_name_for(c.id)
     where c.id = old.contact_id and c.company_name is distinct from app.company_name_for(c.id);
  end if;
  if tg_op <> 'DELETE'
     and not exists (select 1 from public.client_groups g where g.id = new.client_group_id and g.kind = 'household') then
    update public.contacts c set company_name = app.company_name_for(c.id)
     where c.id = new.contact_id and c.company_name is distinct from app.company_name_for(c.id);
  end if;
  return null;
end $$;
create trigger client_group_members_sync_company_name
  after insert or delete or update of is_primary, client_group_id, contact_id on public.client_group_members
  for each row execute function app.sync_company_name();
create trigger client_groups_sync_company_name
  after update of name, kind on public.client_groups
  for each row when ((old.kind = 'business' or new.kind = 'business')
                     and (old.name is distinct from new.name or old.kind is distinct from new.kind))
  execute function app.sync_company_name();

-- 7. Write functions, service_role only. Each one checks every row belongs to p_account_id and serialises
--    on the contact row, so "at least one main group when any exist" holds under concurrent edits.
create function public.create_group_with_member(p_account_id uuid, p_contact_id uuid, p_kind text, p_name text, p_role text default null)
returns jsonb language plpgsql set search_path = '' as $$
declare v_name text := btrim(coalesce(p_name, ''), app.group_ws()); v_group uuid; v_existed boolean := false;
begin
  if p_kind is null or p_kind not in ('household', 'business') then
    raise exception 'create_group_with_member: kind must be household or business' using errcode = '22023';
  end if;
  if char_length(v_name) not between 1 and 120 then return jsonb_build_object('status', 'invalid_name'); end if;
  if not app.lock_contact(p_account_id, p_contact_id) then return jsonb_build_object('status', 'not_found'); end if;
  if p_kind = 'business' then
    select f.group_id, f.existed into v_group, v_existed from app.find_or_create_business(p_account_id, v_name) f;
  else
    insert into public.client_groups (account_id, kind, name) values (p_account_id, 'household', v_name) returning id into v_group;
  end if;
  return jsonb_build_object('status', 'ok', 'group_id', v_group, 'existed', v_existed,
    'member_id', app.link_member(p_account_id, v_group, p_contact_id, p_role, false),
    'name', (select g.name from public.client_groups g where g.id = v_group));
end $$;

create function public.add_contact_to_group(p_account_id uuid, p_contact_id uuid, p_group_id uuid, p_role text default null)
returns jsonb language plpgsql set search_path = '' as $$
begin
  if not app.lock_contact(p_account_id, p_contact_id) then return jsonb_build_object('status', 'not_found'); end if;
  perform 1 from public.client_groups where id = p_group_id and account_id = p_account_id;
  if not found then return jsonb_build_object('status', 'not_found'); end if;
  return jsonb_build_object('status', 'ok', 'member_id', app.link_member(p_account_id, p_group_id, p_contact_id, p_role, false));
end $$;

create function public.set_contacts_business(p_account_id uuid, p_contact_ids uuid[], p_names text[])
returns jsonb language plpgsql set search_path = '' as $$
declare
  i int; v_name text; v_key text; v_shown public.client_group_members; v_shown_key text;
  v_group uuid; v_existed boolean; v_added uuid; v_removed jsonb; v_status text; v_out jsonb := '[]'::jsonb;
  v_n int := coalesce(array_length(p_contact_ids, 1), 0); v_res jsonb[];
begin
  if v_n <> coalesce(array_length(p_names, 1), 0) then
    raise exception 'set_contacts_business: ids and names differ in length' using errcode = '22023';
  end if;
  v_res := array_fill(null::jsonb, array[v_n]);
  -- Contacts are locked in id order, not input order, so two batches naming the same contacts in
  -- opposite orders queue behind each other instead of deadlocking. Results still come back in input order.
  for i in select t.ord::int from unnest(p_contact_ids) with ordinality as t(id, ord) order by t.id, t.ord loop
    v_added := null; v_removed := null; v_shown := null; v_shown_key := null;
    v_name := btrim(coalesce(p_names[i], ''), app.group_ws());
    v_key := app.group_name_key(v_name);
    if char_length(v_name) > 120 then
      v_status := 'too_long';
    elsif not app.lock_contact(p_account_id, p_contact_ids[i]) then
      v_status := 'not_found';
    else
      select m.* into v_shown from public.client_group_members m
        join public.client_groups g on g.account_id = m.account_id and g.id = m.client_group_id
       where m.contact_id = p_contact_ids[i] and g.kind = 'business'
       order by m.is_primary desc, m.created_at, m.id limit 1;
      if v_shown.id is not null then
        select g.name_key into v_shown_key from public.client_groups g where g.id = v_shown.client_group_id;
      end if;
      if v_key = '' and v_shown.id is null then
        v_status := 'unchanged';
      elsif v_key = '' then
        delete from public.client_group_members where id = v_shown.id;
        perform app.promote_primary(p_contact_ids[i]);
        v_removed := to_jsonb(v_shown); v_status := 'ok';
      elsif v_shown_key = v_key then
        v_status := 'unchanged';
      else
        select f.group_id, f.existed into v_group, v_existed from app.find_or_create_business(p_account_id, v_name) f;
        if v_shown.id is not null then
          delete from public.client_group_members where id = v_shown.id;
          v_removed := to_jsonb(v_shown);
        end if;
        if exists (select 1 from public.client_group_members where client_group_id = v_group and contact_id = p_contact_ids[i]) then
          if coalesce(v_shown.is_primary, false) then
            update public.client_group_members set is_primary = true
             where client_group_id = v_group and contact_id = p_contact_ids[i];
          end if;
        else
          v_added := app.link_member(p_account_id, v_group, p_contact_ids[i], null, coalesce(v_shown.is_primary, false));
        end if;
        perform app.promote_primary(p_contact_ids[i]);
        v_status := 'ok';
      end if;
    end if;
    v_res[i] := jsonb_build_object('contact_id', p_contact_ids[i], 'status', v_status, 'removed', v_removed, 'added', v_added);
  end loop;
  for i in 1 .. v_n loop
    v_out := v_out || jsonb_build_array(v_res[i]);
  end loop;
  return v_out;
end $$;

create function public.undo_set_business(p_account_id uuid, p_contact_id uuid, p_added uuid, p_removed jsonb)
returns text language plpgsql set search_path = '' as $$
begin
  if not app.lock_contact(p_account_id, p_contact_id) then return 'not_found'; end if;
  if p_removed is not null and (p_removed ->> 'contact_id')::uuid is distinct from p_contact_id then
    raise exception 'undo_set_business: the snapshot is for another contact' using errcode = '22023';
  end if;
  -- The snapshot comes back from the browser: it may name only a BUSINESS group of this account. A
  -- forged one naming a household (one a Technician cannot see) would otherwise join it.
  if p_removed is not null and not exists (
       select 1 from public.client_groups g
        where g.id = (p_removed ->> 'client_group_id')::uuid and g.account_id = p_account_id and g.kind = 'business') then
    return 'not_found';
  end if;
  if p_added is not null then
    delete from public.client_group_members where id = p_added and contact_id = p_contact_id;
  end if;
  if p_removed is not null then
    perform app.restore_member(p_account_id, p_removed);
  end if;
  perform app.promote_primary(p_contact_id);
  return 'ok';
end $$;

create function public.set_primary_group_membership(p_account_id uuid, p_member_id uuid)
returns jsonb language plpgsql set search_path = '' as $$
declare v_contact uuid; v_previous uuid;
begin
  select contact_id into v_contact from public.client_group_members where id = p_member_id and account_id = p_account_id;
  if v_contact is null then return jsonb_build_object('status', 'not_found'); end if;
  if not app.lock_contact(p_account_id, v_contact) then return jsonb_build_object('status', 'not_found'); end if;
  -- Read again under the lock: another session may have removed it while this one waited.
  perform 1 from public.client_group_members where id = p_member_id and account_id = p_account_id;
  if not found then return jsonb_build_object('status', 'not_found'); end if;
  select id into v_previous from public.client_group_members where contact_id = v_contact and is_primary;
  if v_previous is distinct from p_member_id then
    update public.client_group_members set is_primary = false where contact_id = v_contact and is_primary;
    update public.client_group_members set is_primary = true where id = p_member_id;
  end if;
  return jsonb_build_object('status', 'ok', 'previous', v_previous);
end $$;

create function public.remove_group_membership(p_account_id uuid, p_member_id uuid)
returns jsonb language plpgsql set search_path = '' as $$
declare v_contact uuid; v_row public.client_group_members;
begin
  select contact_id into v_contact from public.client_group_members where id = p_member_id and account_id = p_account_id;
  if v_contact is null then return jsonb_build_object('status', 'not_found'); end if;
  if not app.lock_contact(p_account_id, v_contact) then return jsonb_build_object('status', 'not_found'); end if;
  -- The snapshot Undo restores is read under the lock, so it carries what another session just changed.
  select * into v_row from public.client_group_members where id = p_member_id and account_id = p_account_id;
  if v_row.id is null then return jsonb_build_object('status', 'not_found'); end if;
  delete from public.client_group_members where id = p_member_id;
  perform app.promote_primary(v_row.contact_id);
  return jsonb_build_object('status', 'ok', 'removed', to_jsonb(v_row));
end $$;

create function public.restore_group_membership(p_account_id uuid, p_snapshot jsonb)
returns text language plpgsql set search_path = '' as $$
declare v_contact uuid := (p_snapshot ->> 'contact_id')::uuid; v_status text;
begin
  if v_contact is null or not app.lock_contact(p_account_id, v_contact) then return 'not_found'; end if;
  v_status := app.restore_member(p_account_id, p_snapshot);
  perform app.promote_primary(v_contact);
  return v_status;
end $$;

-- 8. The backfill (spec section 5.4), idempotent. Called below, and once more by the orchestrator after
--    the new app is live, to fold in what the old build wrote straight to company_name in between.
--    The loop locks each contact (app.lock_contact) and reads its company_name again under that lock, so
--    a direct write in flight is waited for and folded in, never overwritten. The locks are held to the
--    end of the call, so nothing writes a linked contact between its relink and the respell below. Id
--    order, as set_contacts_business locks, so the two queue behind each other rather than deadlock.
--    What the counts mean, per call:
--      groups_created    business groups inserted by the set-based first step (a group the loop creates
--                        for a name written while it ran is not counted);
--      members_added     contacts linked to a business for the first time;
--      members_replaced  contacts whose shown business moved to the one their column now names;
--      members_removed   contacts whose column is blank, unlinked from their shown business;
--      skipped_too_long  contacts whose trimmed company_name is over 120 characters, left exactly as they
--                        are. It counts what is there, not work done, so it never reaches zero while
--                        such a name exists: a second run returns zeros EXCEPT this count;
--      respelled         columns the final update put back to their own group's spelling. Spellings the
--                        sync trigger rewrote while the loop linked or relinked a contact are not in it
--                        (the orchestrator's pre-flight query counts those before the apply).
create function public.reconcile_business_groups(p_account_id uuid default null)
returns jsonb language plpgsql set search_path = '' as $$
declare
  r record; v_name text; v_shown public.client_group_members; v_shown_key text; v_group uuid;
  v_groups int := 0; v_added int := 0; v_replaced int := 0; v_removed int := 0; v_skipped int := 0; v_respelled int := 0;
begin
  insert into public.client_groups (account_id, kind, name)
  select distinct on (c.account_id, app.group_name_key(c.company_name))
         c.account_id, 'business', btrim(c.company_name, app.group_ws())
    from public.contacts c
   where (p_account_id is null or c.account_id = p_account_id)
     and char_length(btrim(coalesce(c.company_name, ''), app.group_ws())) between 1 and 120
   order by c.account_id, app.group_name_key(c.company_name), c.created_at, c.id
  on conflict (account_id, name_key) where kind = 'business' do nothing;
  get diagnostics v_groups = row_count;

  for r in
    select c.id, c.account_id
      from public.contacts c
     where (p_account_id is null or c.account_id = p_account_id)
       and (btrim(coalesce(c.company_name, ''), app.group_ws()) <> ''
            or exists (select 1 from public.client_group_members m
                         join public.client_groups g on g.account_id = m.account_id and g.id = m.client_group_id
                        where m.contact_id = c.id and g.kind = 'business'))
     order by c.id
  loop
    if not app.lock_contact(r.account_id, r.id) then continue; end if;
    select btrim(coalesce(c.company_name, ''), app.group_ws()) into v_name from public.contacts c where c.id = r.id;
    if char_length(v_name) > 120 then v_skipped := v_skipped + 1; continue; end if;
    v_shown := null; v_shown_key := null;
    select m.* into v_shown from public.client_group_members m
      join public.client_groups g on g.account_id = m.account_id and g.id = m.client_group_id
     where m.contact_id = r.id and g.kind = 'business'
     order by m.is_primary desc, m.created_at, m.id limit 1;
    if v_shown.id is not null then
      select g.name_key into v_shown_key from public.client_groups g where g.id = v_shown.client_group_id;
    end if;
    if v_name = '' then
      if v_shown.id is not null then
        delete from public.client_group_members where id = v_shown.id;
        perform app.promote_primary(r.id);
        v_removed := v_removed + 1;
      end if;
    elsif v_shown.id is null then
      select f.group_id into v_group from app.find_or_create_business(r.account_id, v_name) f;
      perform app.link_member(r.account_id, v_group, r.id, null, false);
      v_added := v_added + 1;
    elsif v_shown_key <> app.group_name_key(v_name) then
      select f.group_id into v_group from app.find_or_create_business(r.account_id, v_name) f;
      delete from public.client_group_members where id = v_shown.id;
      if exists (select 1 from public.client_group_members where client_group_id = v_group and contact_id = r.id) then
        if v_shown.is_primary then
          update public.client_group_members set is_primary = true where client_group_id = v_group and contact_id = r.id;
        end if;
      else
        perform app.link_member(r.account_id, v_group, r.id, null, v_shown.is_primary);
      end if;
      perform app.promote_primary(r.id);
      v_replaced := v_replaced + 1;
    end if;
  end loop;

  -- The respell. A column over 120 characters was skipped above and stays exactly as written.
  update public.contacts c set company_name = app.company_name_for(c.id)
   where (p_account_id is null or c.account_id = p_account_id)
     and char_length(btrim(coalesce(c.company_name, ''), app.group_ws())) <= 120
     and exists (select 1 from public.client_group_members m
                   join public.client_groups g on g.account_id = m.account_id and g.id = m.client_group_id
                  where m.contact_id = c.id and g.kind = 'business')
     and c.company_name is distinct from app.company_name_for(c.id);
  get diagnostics v_respelled = row_count;

  return jsonb_build_object('groups_created', v_groups, 'members_added', v_added, 'members_replaced', v_replaced,
                            'members_removed', v_removed, 'skipped_too_long', v_skipped, 'respelled', v_respelled);
end $$;

-- 9. Grants. Default privileges hand EXECUTE to anon, authenticated and service_role BY NAME (0043).
do $$
declare f text;
begin
  foreach f in array array[
    'public.create_group_with_member(uuid,uuid,text,text,text)', 'public.add_contact_to_group(uuid,uuid,uuid,text)',
    'public.set_contacts_business(uuid,uuid[],text[])', 'public.undo_set_business(uuid,uuid,uuid,jsonb)',
    'public.set_primary_group_membership(uuid,uuid)', 'public.remove_group_membership(uuid,uuid)',
    'public.restore_group_membership(uuid,jsonb)', 'public.reconcile_business_groups(uuid)',
    'app.company_name_for(uuid)', 'app.lock_contact(uuid,uuid)', 'app.promote_primary(uuid)',
    'app.link_member(uuid,uuid,uuid,text,boolean)', 'app.find_or_create_business(uuid,text)', 'app.restore_member(uuid,jsonb)',
    'app.sync_company_name()', 'app.group_ws()', 'app.group_name_key(text)'] loop
    execute format('revoke all on function %s from public, anon, authenticated, service_role', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end $$;
revoke all on function app.my_client_group_ids() from public, anon;
grant execute on function app.my_client_group_ids() to authenticated, service_role;

-- 10. The backfill, once, now.
select public.reconcile_business_groups();
