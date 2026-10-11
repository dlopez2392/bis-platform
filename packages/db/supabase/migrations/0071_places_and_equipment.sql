-- 0071_places_and_equipment.sql - properties and equipment on the customer record
-- (docs/superpowers/specs/2026-10-11-places-and-equipment-design.md section 5)
--
-- A property ("place") belongs to ONE owner, a contact or a client group (0069), so a household's
-- house shows on every member's record. Equipment sits at a place; a replacement is a NEW row whose
-- replaces_id names the old unit at the SAME place, so "replaced" and "when" (the new unit's
-- installed_on) are read, never stored twice. Client-written under RLS (operator-entered state,
-- like notes and contact_relationships), with 0068-style restrictive fences: a Technician reads and
-- writes a place only through their own customer or that customer's group, and a trigger stops
-- them moving a place between owners. A place with equipment cannot be deleted by a client token
-- (places_delete_empty); the app archives it instead. Composite same-account keys (0050's shape).
--
-- APPLY ORDER: CI project (ci-project-setup.yml: push-dry-run, then push), then production (MCP
-- apply_migration), then the parity check, then merge. 0070 reaches each project first.
--
-- ROLLBACK (revert the app first; this drops what people typed, so only on an owner decision,
-- after an export):
--   drop table public.equipment; drop table public.places;
--   drop function app.places_owner_guard(), app.stamp_created_by(), app.my_place_ids(), app.tidy_text(text, int);
--
-- ASCII only, no backslash anywhere.

set local lock_timeout = '5s';

-- 1. A stored text value is trimmed and never blank. 0070's POSIX class (measured 2026-10-11 under
--    ICU en_US.UTF-8: 09-0D, 1C-1F, 20, 85, A0, 1680, 2000-200A, 2028, 2029, 202F, 205F, 3000); the
--    app strips a superset first (apps/web lib/inline-rule.ts). PG's "." matches a newline.
--    Executable by authenticated: a CHECK runs with the inserting role's privileges.
create function app.tidy_text(p_value text, p_max int) returns boolean
language sql immutable parallel safe set search_path = '' as $$
  select p_value is null
      or (char_length(p_value) between 1 and p_max and p_value ~ '^[^[:space:]](.*[^[:space:]])?$')
$$;

-- 2. Tables.
create table public.places (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  contact_id uuid,
  client_group_id uuid,
  label text constraint places_label_check check (app.tidy_text(label, 80)),
  address text constraint places_address_check check (app.tidy_text(address, 300)),
  landmark text constraint places_landmark_check check (app.tidy_text(landmark, 200)),
  directions text constraint places_directions_check check (app.tidy_text(directions, 1000)),
  city text constraint places_city_check check (app.tidy_text(city, 80)),
  region text constraint places_region_check check (app.tidy_text(region, 80)),
  postal_code text constraint places_postal_code_check check (app.tidy_text(postal_code, 12)),
  country text constraint places_country_check check (country is null or country in ('US', 'MX')),
  archived_at timestamptz,
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint places_contact_fkey foreign key (account_id, contact_id)
    references public.contacts (account_id, id) on delete cascade,
  constraint places_group_fkey foreign key (account_id, client_group_id)
    references public.client_groups (account_id, id) on delete cascade,
  constraint places_one_owner check (num_nonnulls(contact_id, client_group_id) = 1),
  constraint places_findable check (num_nonnulls(address, landmark, directions) >= 1),
  constraint places_account_id_id_key unique (account_id, id)
);

create table public.equipment (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  place_id uuid not null,
  name text not null constraint equipment_name_check check (app.tidy_text(name, 80)),
  make text constraint equipment_make_check check (app.tidy_text(make, 60)),
  model text constraint equipment_model_check check (app.tidy_text(model, 60)),
  serial text constraint equipment_serial_check check (app.tidy_text(serial, 60)),
  notes text constraint equipment_notes_check check (app.tidy_text(notes, 1000)),
  installed_on date,
  warranty_until date,
  replaces_id uuid,
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint equipment_place_fkey foreign key (account_id, place_id)
    references public.places (account_id, id) on delete cascade,
  constraint equipment_place_id_id_key unique (place_id, id),
  constraint equipment_not_self check (replaces_id is null or replaces_id <> id),
  constraint equipment_replacement_dated check (replaces_id is null or installed_on is not null),
  constraint equipment_warranty_order check (warranty_until is null or installed_on is null or warranty_until >= installed_on)
);
-- Same place, so the same account. NO ACTION: a unit something replaced cannot be deleted on its
-- own; a place's cascade removes the whole chain in one statement.
alter table public.equipment add constraint equipment_replaces_fkey foreign key (place_id, replaces_id)
  references public.equipment (place_id, id);

create index places_by_contact on public.places (account_id, contact_id) where contact_id is not null;
create index places_by_group on public.places (account_id, client_group_id) where client_group_id is not null;
create index equipment_by_place on public.equipment (account_id, place_id);
create unique index equipment_one_successor on public.equipment (replaces_id) where replaces_id is not null;

-- 3. Grants. Identity columns stay out of UPDATE, as 0070 kept them out.
alter table public.places enable row level security;
alter table public.equipment enable row level security;
revoke all on public.places, public.equipment from anon, authenticated;
grant select, insert, delete on public.places, public.equipment to authenticated;
grant update (label, address, landmark, directions, city, region, postal_code, country,
              contact_id, client_group_id, archived_at, updated_at) on public.places to authenticated;
grant update (name, make, model, serial, notes, installed_on, warranty_until, updated_at)
  on public.equipment to authenticated;
grant select, insert, update, delete on public.places, public.equipment to service_role;

-- 4. The tenant policies, 0070's shape.
create policy places_member_all on public.places for all to authenticated
  using (app.is_agency() or account_id = app.current_account_id())
  with check (app.is_agency() or account_id = app.current_account_id());
create policy equipment_member_all on public.equipment for all to authenticated
  using (app.is_agency() or account_id = app.current_account_id())
  with check (app.is_agency() or account_id = app.current_account_id());

-- 5. The Technician (P3, O2). SECURITY DEFINER, so the equipment policy never re-enters places'.
create function app.my_place_ids() returns setof uuid
language sql stable security definer set search_path = '' as $$
  select p.id from public.places p
   where p.account_id = app.current_account_id()
     and (p.contact_id in (select app.my_contact_ids()) or p.client_group_id in (select app.my_client_group_ids()))
$$;
create policy places_technician_scope on public.places as restrictive for all to authenticated
  using ((select app.sees_all_customers(app.current_account_id()))
         or contact_id in (select app.my_contact_ids())
         or client_group_id in (select app.my_client_group_ids()))
  with check ((select app.sees_all_customers(app.current_account_id()))
         or contact_id in (select app.my_contact_ids())
         or client_group_id in (select app.my_client_group_ids()));
create policy equipment_technician_scope on public.equipment as restrictive for all to authenticated
  using ((select app.sees_all_customers(app.current_account_id())) or place_id in (select app.my_place_ids()))
  with check ((select app.sees_all_customers(app.current_account_id())) or place_id in (select app.my_place_ids()));

-- 6. A client token deletes only an EMPTY place (C5). Referential cascades bypass row security.
create policy places_delete_empty on public.places as restrictive for delete to authenticated
  using (not exists (select 1 from public.equipment e where e.place_id = places.id));

-- 7. Triggers. Plain, not definer, so current_user is the caller (0068's tasks_assignee_guard).
create function app.stamp_created_by() returns trigger
language plpgsql set search_path = '' as $$
begin
  if current_user = 'authenticated' then
    new.created_by := app.current_user_id();
  end if;
  return new;
end $$;
create trigger places_stamp_created_by before insert on public.places
  for each row execute function app.stamp_created_by();
create trigger equipment_stamp_created_by before insert on public.equipment
  for each row execute function app.stamp_created_by();

create function app.places_owner_guard() returns trigger
language plpgsql set search_path = '' as $$
begin
  if (new.contact_id is distinct from old.contact_id or new.client_group_id is distinct from old.client_group_id)
     and current_user = 'authenticated'
     and not coalesce(app.sees_all_customers(new.account_id), false) then
    raise exception 'places: only an Owner or Staff can change who a property belongs to' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger places_owner_guard before update of contact_id, client_group_id on public.places
  for each row execute function app.places_owner_guard();

revoke all on function app.tidy_text(text, int) from public, anon;
revoke all on function app.my_place_ids() from public, anon;
revoke all on function app.stamp_created_by() from public, anon;
revoke all on function app.places_owner_guard() from public, anon;
grant execute on function app.tidy_text(text, int) to authenticated, service_role;
grant execute on function app.my_place_ids() to authenticated, service_role;
grant execute on function app.stamp_created_by() to authenticated, service_role;
grant execute on function app.places_owner_guard() to authenticated, service_role;
