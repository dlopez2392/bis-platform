-- 0068_mine_unassigned_technician.sql — Mine, Unassigned and the Technician
-- (docs/superpowers/specs/2026-10-11-mine-unassigned-technician-design.md §5)
--
-- A third role, technician, sees only the customers assigned to them (contacts.assigned_to) and
-- every row that reaches those customers. Every table carrying customer data gets a RESTRICTIVE
-- policy ANDed with its permissive tenant policy:
--   (select app.sees_all_customers(app.current_account_id())) or <row reaches one of my contacts>
-- sees_all_customers is TRUE for the agency, an Owner and Staff, and FALSE (never NULL) for a
-- Technician and for a client with NO membership (owner ruling A1): an unknown role sees nothing.
-- The left operand is an uncorrelated scalar subquery (an InitPlan, once per statement); when it is
-- true the OR never builds the hashed subplan on the right, so Owner/Staff/agency pay ~nothing.
--
-- APPLY ORDER: CI project (ci-project-setup.yml), then production (MCP apply_migration), then the
-- parity check, then merge. Before production: every live client login must already hold a
-- membership (0066 rollout step 4), or that login sees no customers until its next page load
-- creates the row through the per-request fallback.
--
-- ROLLBACK (revert the app first: it offers the role), section by section:
--   7  drop function public.release_member_assignments(uuid, uuid);
--   6  drop index public.contacts_account_assigned; drop index public.tasks_account_assigned_open;
--   5  drop trigger tasks_assignee_guard on public.tasks; drop function app.tasks_assignee_guard();
--   4  drop every policy named *_technician_* below (the loops name them);
--   3  drop function app.my_contact_ids(); drop function app.sees_all_customers(uuid);
--      drop function app.is_technician(uuid); drop function app.current_user_id();
--   2  restore 0066's public.set_account_member_role body (owner|staff);
--   1  update public.memberships set role = 'staff' where role = 'technician'; restore the check to ('owner','staff').

set local lock_timeout = '5s';

-- 1. The role.
alter table public.memberships drop constraint memberships_role_check;
alter table public.memberships add constraint memberships_role_check check (role in ('owner', 'staff', 'technician'));

-- 2. Role changes accept technician. Same body as 0066 otherwise; demoting an Owner to technician
--    goes through the same last-Owner guard.
create or replace function public.set_account_member_role(p_account_id uuid, p_user_id uuid, p_role text)
returns text language plpgsql set search_path = '' as $$
declare v_current text; v_owners int;
begin
  if p_role is null or p_role not in ('owner', 'staff', 'technician') then
    raise exception 'set_account_member_role: role must be owner, staff or technician' using errcode = '22023';
  end if;
  perform 1 from public.accounts where id = p_account_id for no key update;
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
revoke all on function public.set_account_member_role(uuid, uuid, text) from public, anon, authenticated, service_role;
grant execute on function public.set_account_member_role(uuid, uuid, text) to service_role;

-- 3. Helpers. p_account_id, not account_id (0066 §3's reason). Every boolean is coalesced.
create function app.current_user_id() returns uuid
language sql stable security definer set search_path = '' as $$
  select u.id from public.users u where u.clerk_user_id = nullif(app.jwt() ->> 'sub', '')
$$;

create function app.is_technician(p_account_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(app.account_role(p_account_id) = 'technician', false)
$$;

create function app.sees_all_customers(p_account_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(app.is_agency(), false) or coalesce(app.account_role(p_account_id) in ('owner', 'staff'), false)
$$;

-- SECURITY DEFINER, so a policy on another table that calls it never re-enters contacts' own policy.
create function app.my_contact_ids() returns setof uuid
language sql stable security definer set search_path = '' as $$
  select c.id from public.contacts c
   where c.account_id = app.current_account_id() and c.assigned_to = app.current_user_id()
$$;

revoke all on function app.current_user_id() from public, anon;
revoke all on function app.is_technician(uuid) from public, anon;
revoke all on function app.sees_all_customers(uuid) from public, anon;
revoke all on function app.my_contact_ids() from public, anon;
grant execute on function app.current_user_id() to authenticated, service_role;
grant execute on function app.is_technician(uuid) to authenticated, service_role;
grant execute on function app.sees_all_customers(uuid) to authenticated, service_role;
grant execute on function app.my_contact_ids() to authenticated, service_role;

-- 4. Restrictive policies.
-- 4a. contacts: a with-check, not a trigger. "Me" is the only legal assigned_to before AND after a
--     Technician's update, so they cannot reassign (to anyone, or to NULL), and an insert must carry it.
create policy contacts_technician_scope on public.contacts as restrictive for all to authenticated
  using ((select app.sees_all_customers(app.current_account_id())) or assigned_to = (select app.current_user_id()))
  with check ((select app.sees_all_customers(app.current_account_id())) or assigned_to = (select app.current_user_id()));

-- 4b. Tables whose row names its contact directly.
do $$
declare t text;
begin
  foreach t in array array['contact_tags','notes','opportunities','conversations','calls','bookings',
                           'form_submissions','automation_log','consent_events'] loop
    execute format(
      'create policy %I on public.%I as restrictive for all to authenticated
         using ((select app.sees_all_customers(app.current_account_id())) or contact_id in (select app.my_contact_ids()))
         with check ((select app.sees_all_customers(app.current_account_id())) or contact_id in (select app.my_contact_ids()))',
      t || '_technician_scope', t);
  end loop;
end $$;

-- 4c. Rows that reach a contact through a parent.
create policy messages_technician_scope on public.messages as restrictive for all to authenticated
  using ((select app.sees_all_customers(app.current_account_id()))
         or conversation_id in (select v.id from public.conversations v where v.contact_id in (select app.my_contact_ids())));
create policy call_proposals_technician_scope on public.call_proposals as restrictive for all to authenticated
  using ((select app.sees_all_customers(app.current_account_id()))
         or call_id in (select k.id from public.calls k where k.contact_id in (select app.my_contact_ids())));

-- 4d. tasks: visible when the customer is theirs, or there is no customer and it is assigned to them.
--     UPDATE re-checks the same expression (no WITH CHECK given), so finishing an Owner-held task on
--     their own customer passes; the assignee itself is guarded by the trigger in section 5.
create policy tasks_technician_scope on public.tasks as restrictive for all to authenticated
  using ((select app.sees_all_customers(app.current_account_id()))
         or contact_id in (select app.my_contact_ids())
         or (contact_id is null and assigned_to = (select app.current_user_id())));
create policy tasks_technician_insert on public.tasks as restrictive for insert to authenticated
  with check ((select app.sees_all_customers(app.current_account_id())) or assigned_to = (select app.current_user_id()));

-- 4e. Nothing at all for a Technician: the account-wide ledger and the merge queue.
create policy events_technician_none on public.events as restrictive for select to authenticated
  using ((select app.sees_all_customers(app.current_account_id())));
create policy contact_duplicate_flags_technician_none on public.contact_duplicate_flags as restrictive for all to authenticated
  using ((select app.sees_all_customers(app.current_account_id())))
  with check ((select app.sees_all_customers(app.current_account_id())));

-- 4f. Account configuration is read-only to a Technician (M4). tags keeps INSERT: tagging their own
--     customer with a new word creates the tag (addTagToContact).
do $$
declare t text; cmd text;
begin
  foreach t in array array['accounts','forms','pipelines','pipeline_stages','custom_fields','custom_values','checklist_items','tags'] loop
    foreach cmd in array array['insert','update','delete'] loop
      continue when t = 'tags' and cmd = 'insert';
      if cmd = 'insert' then
        execute format('create policy %I on public.%I as restrictive for insert to authenticated
                          with check ((select app.sees_all_customers(app.current_account_id())))', t || '_technician_' || cmd, t);
      else
        execute format('create policy %I on public.%I as restrictive for %s to authenticated
                          using ((select app.sees_all_customers(app.current_account_id())))', t || '_technician_' || cmd, t, cmd);
      end if;
    end loop;
  end loop;
end $$;

-- 5. A Technician never changes a task's assignee. A trigger, not a with-check: the legal value after
--    their update is "whatever it was", not "me" (an Owner-held task on their customer). Plain, NOT
--    security definer, so current_user is the caller; keyed on 'authenticated' so the service role passes.
create function app.tasks_assignee_guard() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.assigned_to is distinct from old.assigned_to
     and current_user = 'authenticated'
     and not coalesce(app.sees_all_customers(new.account_id), false) then
    raise exception 'tasks: a technician cannot change a task''s assignee' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger tasks_assignee_guard before update of assigned_to on public.tasks
  for each row execute function app.tasks_assignee_guard();

-- 6. Indexes for my_contact_ids() / Mine, and To do's Mine.
create index contacts_account_assigned on public.contacts (account_id, assigned_to);
create index tasks_account_assigned_open on public.tasks (account_id, assigned_to) where completed_at is null;

-- 7. A departed member's customers and open tasks go back to Unassigned (owner ruling A3). users
--    rows survive a removal, so no FK action can do this. Does nothing while the person is still a
--    member, so a late retry can never strip an active person. service_role only.
create function public.release_member_assignments(p_account_id uuid, p_user_id uuid)
returns jsonb language plpgsql set search_path = '' as $$
declare v_contacts uuid[]; v_tasks uuid[];
begin
  if exists (select 1 from public.memberships
              where scope = 'account' and account_id = p_account_id and user_id = p_user_id) then
    return jsonb_build_object('contacts', '[]'::jsonb, 'tasks', '[]'::jsonb);
  end if;
  with c as (update public.contacts set assigned_to = null, updated_at = now()
              where account_id = p_account_id and assigned_to = p_user_id returning id)
  select coalesce(array_agg(id order by id), '{}') into v_contacts from c;
  with t as (update public.tasks set assigned_to = null
              where account_id = p_account_id and assigned_to = p_user_id and completed_at is null returning id)
  select coalesce(array_agg(id order by id), '{}') into v_tasks from t;
  return jsonb_build_object('contacts', to_jsonb(v_contacts), 'tasks', to_jsonb(v_tasks));
end $$;
revoke all on function public.release_member_assignments(uuid, uuid) from public, anon, authenticated, service_role;
grant execute on function public.release_member_assignments(uuid, uuid) to service_role;
