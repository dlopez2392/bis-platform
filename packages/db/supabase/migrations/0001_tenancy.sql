create schema if not exists app;

-- JWT helpers (work on Supabase and in bare-pg tests via request.jwt.claims GUC)
create or replace function app.jwt() returns jsonb
language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb, '{}'::jsonb)
$$;

create or replace function app.is_agency() returns boolean
language sql stable as $$
  select app.jwt()->>'app_role' = 'agency_admin'
$$;

-- Tenancy spine (spec §3)
create table public.agencies (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now()
);

create table public.accounts (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references public.agencies(id),
  clerk_org_id text not null unique,
  name text not null,
  timezone text not null default 'America/Chicago',
  status text not null default 'active' check (status in ('active','paused','archived')),
  permissions jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table public.users (
  id uuid primary key default gen_random_uuid(),
  clerk_user_id text not null unique,
  email text not null,
  name text,
  created_at timestamptz not null default now()
);

create table public.memberships (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id),
  scope text not null check (scope in ('agency','account')),
  agency_id uuid references public.agencies(id),
  account_id uuid references public.accounts(id),
  role text not null check (role in ('admin','member')),
  permissions jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  check (
    (scope = 'agency' and agency_id is not null and account_id is null) or
    (scope = 'account' and account_id is not null and agency_id is null)
  )
);
create unique index memberships_unique
  on public.memberships (user_id, scope, coalesce(agency_id, '00000000-0000-0000-0000-000000000000'), coalesce(account_id, '00000000-0000-0000-0000-000000000000'));

-- Events log: keystone primitive (spec §4). Append-only.
create table public.events (
  id bigint generated always as identity primary key,
  account_id uuid references public.accounts(id),
  type text not null,
  actor_type text not null check (actor_type in ('user','system','ai')),
  actor_id text,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index events_account_created on public.events (account_id, created_at desc);
create index events_type on public.events (type);

-- Maps the caller's Clerk org claim to an account id (used by every tenant table's policies)
create or replace function app.current_account_id() returns uuid
language sql stable security definer set search_path = public as $$
  select id from public.accounts where clerk_org_id = app.jwt()->>'org_id'
$$;

-- RLS
alter table public.agencies enable row level security;
alter table public.accounts enable row level security;
alter table public.users enable row level security;
alter table public.memberships enable row level security;
alter table public.events enable row level security;

create policy agencies_agency_all on public.agencies
  for all to authenticated using (app.is_agency()) with check (app.is_agency());

create policy accounts_agency_all on public.accounts
  for all to authenticated using (app.is_agency()) with check (app.is_agency());
create policy accounts_member_read on public.accounts
  for select to authenticated using (clerk_org_id = app.jwt()->>'org_id');

create policy users_agency_all on public.users
  for all to authenticated using (app.is_agency()) with check (app.is_agency());

create policy memberships_agency_all on public.memberships
  for all to authenticated using (app.is_agency()) with check (app.is_agency());
create policy memberships_member_read on public.memberships
  for select to authenticated using (account_id = app.current_account_id());

create policy events_read on public.events
  for select to authenticated
  using (app.is_agency() or account_id = app.current_account_id());
create policy events_insert on public.events
  for insert to authenticated
  with check (app.is_agency() or account_id = app.current_account_id());
-- append-only: no update/delete policies, and belt-and-suspenders:
revoke update, delete on public.events from authenticated;

-- Seed the agency layer: BIS is row #1 (spec §3)
insert into public.agencies (name) values ('BIS');
