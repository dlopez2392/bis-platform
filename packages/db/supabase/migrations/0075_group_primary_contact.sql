-- 0075_group_primary_contact.sql - who we call first in a household or business (S-03 part 2, PR 2a)
-- (docs/superpowers/specs/2026-10-13-group-record-page-design.md section 5, owner ruling R1)
--
-- client_group_members.is_primary is the CONTACT's main group (at most one per contact, 0069), so it
-- cannot say whose phone a household's Call reaches. This adds a second flag, at most one per GROUP,
-- with no backfill: every group starts with none and the People card asks. Written by server code only,
-- through 0069's member-write path: a plain plpgsql function, executable by service_role only, behind a
-- server action that proved the group and the membership on the request client. The client role keeps
-- SELECT only: 0069 section 3 revoked insert, update and delete on the TABLE, which covers this column.
-- No policy changes: RLS on client_group_members is row-level, so the flag is as visible as its row.
--
-- app.restore_member (0069 section 5) is replaced so the Undo of a removal puts the flag back when no
-- other member holds it now. public.undo_set_business (0069 section 7) is replaced so the Business
-- name Undo, whose snapshot comes back from ANY reader's browser, never sets it.
-- Both lock the group row FOR NO KEY UPDATE: it serialises two choosers and two restores (the partial
-- index's race) without queueing member inserts, which take FOR KEY SHARE through the group FK.
-- The sync trigger fires on update of is_primary, client_group_id, contact_id only (0069 section 6),
-- so choosing who we call first never touches anyone's Business name.
-- ASCII only, no backslash anywhere (0050's rule; the MCP apply has mangled escapes before).
--
-- APPLY ORDER: CI project (ci-project-setup.yml push-dry-run, then push), then production (MCP
-- apply_migration, once), then the parity check, then merge PR 2a.
--
-- ROLLBACK (revert the app first; the old build never reads the column):
--   drop function public.set_group_primary_contact(uuid, uuid, uuid);
--   re-run 0069's "create function app.restore_member" and "create function public.undo_set_business"
--   statements verbatim, each as "create or replace function";
--   drop index public.client_group_members_one_primary_contact;
--   alter table public.client_group_members drop column is_primary_contact;
--   Lost: the call-first choices made since.

set local lock_timeout = '5s';

-- 1. The flag: at most one per group. "Exactly one" is not kept: a group may have none.
alter table public.client_group_members add column is_primary_contact boolean not null default false;
create unique index client_group_members_one_primary_contact
  on public.client_group_members (client_group_id) where is_primary_contact;

-- 2. The write. p_member_id null clears. Answers the member that held it before, or null.
create function public.set_group_primary_contact(p_account_id uuid, p_group_id uuid, p_member_id uuid)
returns jsonb language plpgsql set search_path = '' as $$
declare v_previous uuid;
begin
  perform 1 from public.client_groups where id = p_group_id and account_id = p_account_id for no key update;
  if not found then return jsonb_build_object('status', 'not_found'); end if;
  if p_member_id is not null then
    perform 1 from public.client_group_members
     where id = p_member_id and client_group_id = p_group_id and account_id = p_account_id;
    if not found then return jsonb_build_object('status', 'not_found'); end if;
  end if;
  select id into v_previous from public.client_group_members where client_group_id = p_group_id and is_primary_contact;
  if v_previous is distinct from p_member_id then
    update public.client_group_members set is_primary_contact = false where client_group_id = p_group_id and is_primary_contact;
    if p_member_id is not null then
      update public.client_group_members set is_primary_contact = true where id = p_member_id;
    end if;
  end if;
  return jsonb_build_object('status', 'ok', 'previous', v_previous);
end $$;

-- 3. The restore. 0069's body, plus the flag: back only when no other member of the group holds it.
create or replace function app.restore_member(p_account_id uuid, p_snapshot jsonb) returns text
language plpgsql set search_path = '' as $$
declare
  v_contact uuid := (p_snapshot ->> 'contact_id')::uuid;
  v_group uuid := (p_snapshot ->> 'client_group_id')::uuid;
  v_primary boolean := coalesce((p_snapshot ->> 'is_primary')::boolean, false);
  v_call_first boolean := coalesce((p_snapshot ->> 'is_primary_contact')::boolean, false);
begin
  perform 1 from public.client_groups where id = v_group and account_id = p_account_id for no key update;
  if not found then return 'not_found'; end if;
  perform 1 from public.contacts where id = v_contact and account_id = p_account_id;
  if not found then return 'not_found'; end if;
  if exists (select 1 from public.client_group_members where client_group_id = v_group and contact_id = v_contact) then
    return 'ok';
  end if;
  if v_primary then
    update public.client_group_members set is_primary = false where contact_id = v_contact and is_primary;
  end if;
  if v_call_first and exists (select 1 from public.client_group_members where client_group_id = v_group and is_primary_contact) then
    v_call_first := false;
  end if;
  insert into public.client_group_members
    (id, account_id, client_group_id, contact_id, role, is_primary, is_billing, is_primary_contact, created_at)
  values ((p_snapshot ->> 'id')::uuid, p_account_id, v_group, v_contact, p_snapshot ->> 'role', v_primary,
          coalesce((p_snapshot ->> 'is_billing')::boolean, false), v_call_first,
          coalesce((p_snapshot ->> 'created_at')::timestamptz, now()));
  return 'ok';
end $$;

-- 4. The Business name Undo. 0069's body, except the snapshot loses is_primary_contact first.
create or replace function public.undo_set_business(p_account_id uuid, p_contact_id uuid, p_added uuid, p_removed jsonb)
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
    -- 0075: who we call first is chosen by Owner, Staff and the agency, never restored from a browser here.
    perform app.restore_member(p_account_id, p_removed - 'is_primary_contact');
  end if;
  perform app.promote_primary(p_contact_id);
  return 'ok';
end $$;

-- 5. Grants. Default privileges hand EXECUTE to anon, authenticated and service_role BY NAME (0043);
--    create or replace keeps the old ACL, re-stated here so this file alone is the record.
do $$
declare f text;
begin
  foreach f in array array[
    'public.set_group_primary_contact(uuid,uuid,uuid)', 'app.restore_member(uuid,jsonb)',
    'public.undo_set_business(uuid,uuid,uuid,jsonb)'] loop
    execute format('revoke all on function %s from public, anon, authenticated, service_role', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end $$;
