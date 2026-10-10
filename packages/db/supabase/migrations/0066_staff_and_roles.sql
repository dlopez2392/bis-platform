-- 0066_staff_and_roles.sql — Staff and roles (docs/superpowers/specs/2026-10-10-staff-and-roles-design.md §5, §7)
--
-- BIS owns the role; Clerk owns who belongs to which organisation. Roles: owner | staff.
-- Owner-only, refused HERE for a client token (the browser holds the token and the public key):
--   contacts DELETE, calendars UPDATE (the settings columns), account_billing SELECT, usage_events SELECT.
-- Each is a RESTRICTIVE policy calling app.is_account_owner(), ANDed with the existing permissive
-- tenant policy, so nothing that policy refused becomes allowed.
--
-- Membership and user rows are written by server code only (serviceDb(): the webhook, the
-- request fallback, the Team actions). `authenticated` keeps SELECT on its own company's rows.
-- The last-Owner guard lives in two service_role-only functions that serialise on the account row.
--
-- APPLY ORDER: CI project, then production, then parity. On production apply it, then the
-- backfill SQL (Task 5), then merge: between this file and the backfill an existing client login
-- has no membership and so cannot delete contacts, change calendar settings or read billing.
--
-- ROLLBACK (section by section):
--   6  drop function public.remove_account_member(uuid, uuid); drop function public.set_account_member_role(uuid, uuid, text);
--   5  grant insert, update, delete on public.users, public.memberships to authenticated; recreate
--      users_agency_all / memberships_agency_all as FOR ALL (0001); drop policy users_member_read on public.users;
--   4  drop policy contacts_owner_delete on public.contacts; drop policy calendars_owner_update on public.calendars;
--      drop policy account_billing_owner_read on public.account_billing; drop policy usage_events_owner_read on public.usage_events;
--   3  drop function app.is_account_owner(uuid); drop function app.account_role(uuid);
--   2  alter table public.users drop column language;
--   1  restore memberships_role_check to ('admin','member') after mapping owner->admin, staff->member;
--      drop constraint memberships_account_user_key; restore both FKs without on delete cascade.

set local lock_timeout = '5s';

-- 1. memberships: roles, the upsert key, and cascades (a membership is derived from Clerk;
--    deleting the account or the user carries it away, so account-teardown.ts needs no entry).
update public.memberships set role = 'owner' where role = 'admin';
update public.memberships set role = 'staff' where role = 'member';
alter table public.memberships drop constraint memberships_role_check;
alter table public.memberships add constraint memberships_role_check check (role in ('owner', 'staff'));
alter table public.memberships add constraint memberships_account_user_key unique (account_id, user_id);
alter table public.memberships
  drop constraint memberships_account_id_fkey,
  add constraint memberships_account_id_fkey foreign key (account_id) references public.accounts(id) on delete cascade,
  drop constraint memberships_user_id_fkey,
  add constraint memberships_user_id_fkey foreign key (user_id) references public.users(id) on delete cascade;

-- 2. A language per person. NULL = follow the account's language (the Spanish runtime reads user -> account -> default).
alter table public.users add column language text constraint users_language_check check (language in ('en', 'es'));
comment on column public.users.language is
  'The person''s own language, en or es. NULL = follow the account''s language. Written by the Team actions and the invitation''s bis_language; the person''s own control arrives with F-096.';

-- 3. Role helpers. p_account_id, not account_id: in a SQL function a column outranks a same-named parameter.
create function app.account_role(p_account_id uuid) returns text
language sql stable security definer set search_path = '' as $$
  select m.role
    from public.memberships m
    join public.users u on u.id = m.user_id
   where m.scope = 'account'
     and m.account_id = p_account_id
     and u.clerk_user_id = nullif(app.jwt() ->> 'sub', '')
$$;

-- Both coalesces are load-bearing: app.is_agency() is NULL for a client token, and account_role is NULL with no membership.
create function app.is_account_owner(p_account_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(app.is_agency(), false) or coalesce(app.account_role(p_account_id) = 'owner', false)
$$;

revoke all on function app.account_role(uuid) from public, anon;
revoke all on function app.is_account_owner(uuid) from public, anon;
grant execute on function app.account_role(uuid) to authenticated, service_role;
grant execute on function app.is_account_owner(uuid) to authenticated, service_role;

-- 4. Owner-only, as RESTRICTIVE policies (ANDed with each table's existing permissive policy).
create policy contacts_owner_delete on public.contacts as restrictive for delete to authenticated
  using (app.is_account_owner(account_id));
create policy calendars_owner_update on public.calendars as restrictive for update to authenticated
  using (app.is_account_owner(account_id)) with check (app.is_account_owner(account_id));
create policy account_billing_owner_read on public.account_billing as restrictive for select to authenticated
  using (app.is_account_owner(account_id));
create policy usage_events_owner_read on public.usage_events as restrictive for select to authenticated
  using (app.is_account_owner(account_id));

-- 5. Team rows: SELECT for the client role (own company), writes server-only.
revoke insert, update, delete on public.users, public.memberships from authenticated;
drop policy users_agency_all on public.users;
create policy users_agency_read on public.users for select to authenticated using (app.is_agency());
create policy users_member_read on public.users for select to authenticated
  using (exists (select 1 from public.memberships m
                  where m.user_id = users.id and m.scope = 'account' and m.account_id = app.current_account_id()));
drop policy memberships_agency_all on public.memberships;
create policy memberships_agency_read on public.memberships for select to authenticated using (app.is_agency());
-- memberships_member_read (0001) stays as is.

-- 6. Role change and removal with the last-Owner guard. Serialised on the account row, so two
--    Owners demoting each other at once cannot leave none. service_role only (the Team actions).
create function public.set_account_member_role(p_account_id uuid, p_user_id uuid, p_role text)
returns text language plpgsql set search_path = '' as $$
declare v_current text; v_owners int;
begin
  if p_role is null or p_role not in ('owner', 'staff') then
    raise exception 'set_account_member_role: role must be owner or staff' using errcode = '22023';
  end if;
  perform 1 from public.accounts where id = p_account_id for update;
  if not found then return 'not_found'; end if;
  select role into v_current from public.memberships
   where scope = 'account' and account_id = p_account_id and user_id = p_user_id;
  if v_current is null then return 'not_found'; end if;
  if v_current = p_role then return 'ok'; end if;
  if v_current = 'owner' then
    select count(*) into v_owners from public.memberships
     where scope = 'account' and account_id = p_account_id and role = 'owner';
    if v_owners <= 1 then return 'last_owner'; end if;
  end if;
  update public.memberships set role = p_role
   where scope = 'account' and account_id = p_account_id and user_id = p_user_id;
  return 'ok';
end $$;

create function public.remove_account_member(p_account_id uuid, p_user_id uuid)
returns text language plpgsql set search_path = '' as $$
declare v_current text; v_owners int;
begin
  perform 1 from public.accounts where id = p_account_id for update;
  if not found then return 'not_found'; end if;
  select role into v_current from public.memberships
   where scope = 'account' and account_id = p_account_id and user_id = p_user_id;
  if v_current is null then return 'not_found'; end if;
  if v_current = 'owner' then
    select count(*) into v_owners from public.memberships
     where scope = 'account' and account_id = p_account_id and role = 'owner';
    if v_owners <= 1 then return 'last_owner'; end if;
  end if;
  delete from public.memberships where scope = 'account' and account_id = p_account_id and user_id = p_user_id;
  return 'ok';
end $$;

revoke all on function public.set_account_member_role(uuid, uuid, text) from public, anon, authenticated, service_role;
revoke all on function public.remove_account_member(uuid, uuid) from public, anon, authenticated, service_role;
grant execute on function public.set_account_member_role(uuid, uuid, text) to service_role;
grant execute on function public.remove_account_member(uuid, uuid) to service_role;
