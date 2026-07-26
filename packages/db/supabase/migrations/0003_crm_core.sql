-- CRM core (spec §4). Every table: account_id + RLS (member-of-account or agency).

create table public.contacts (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id),
  first_name text,
  last_name text,
  email text,
  phone text,
  company_name text,
  source text,
  assigned_to uuid references public.users(id),
  dnd jsonb not null default '{}'::jsonb,
  custom jsonb not null default '{}'::jsonb,
  attribution jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index contacts_account_created on public.contacts (account_id, created_at desc);
create index contacts_account_email on public.contacts (account_id, lower(email));
create index contacts_account_phone on public.contacts (account_id, phone);

create table public.tags (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id),
  name text not null,
  unique (account_id, name)
);

create table public.contact_tags (
  contact_id uuid not null references public.contacts(id) on delete cascade,
  tag_id uuid not null references public.tags(id) on delete cascade,
  account_id uuid not null references public.accounts(id),
  primary key (contact_id, tag_id)
);

create table public.custom_fields (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id),
  model text not null check (model in ('contact','opportunity')),
  field_key text not null check (field_key ~ '^[a-z0-9_]+$'),
  name text not null,
  data_type text not null check (data_type in ('text','number','date','checkbox','single_select')),
  options jsonb not null default '[]'::jsonb,
  position int not null default 0,
  created_at timestamptz not null default now(),
  unique (account_id, model, field_key)
);

create table public.custom_values (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id),
  value_key text not null check (value_key ~ '^[a-z0-9_]+$'),
  name text not null,
  value text not null default '',
  unique (account_id, value_key)
);

create table public.pipelines (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id),
  name text not null,
  position int not null default 0,
  created_at timestamptz not null default now()
);

create table public.pipeline_stages (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id),
  pipeline_id uuid not null references public.pipelines(id) on delete cascade,
  name text not null,
  position int not null
);
create index stages_pipeline on public.pipeline_stages (pipeline_id, position);

create table public.opportunities (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id),
  contact_id uuid not null references public.contacts(id),
  pipeline_id uuid not null references public.pipelines(id),
  stage_id uuid not null references public.pipeline_stages(id),
  name text not null,
  status text not null default 'open' check (status in ('open','won','lost')),
  monetary_value numeric(12,2) not null default 0,
  assigned_to uuid references public.users(id),
  custom jsonb not null default '{}'::jsonb,
  stage_changed_at timestamptz not null default now(),
  status_changed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index opps_account_pipeline on public.opportunities (account_id, pipeline_id, stage_id);
create index opps_contact on public.opportunities (contact_id);

create table public.notes (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id),
  contact_id uuid not null references public.contacts(id) on delete cascade,
  author_id text,
  body text not null,
  pinned boolean not null default false,
  created_at timestamptz not null default now()
);
create index notes_contact on public.notes (contact_id, created_at desc);

create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id),
  contact_id uuid references public.contacts(id) on delete cascade,
  title text not null,
  due_at timestamptz,
  completed_at timestamptz,
  assigned_to uuid references public.users(id),
  created_at timestamptz not null default now()
);
create index tasks_account_open on public.tasks (account_id) where completed_at is null;

-- RLS: one uniform pattern for all ten tables
do $$
declare t text;
begin
  foreach t in array array['contacts','tags','contact_tags','custom_fields','custom_values',
                           'pipelines','pipeline_stages','opportunities','notes','tasks'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format(
      'create policy %I_member_all on public.%I for all to authenticated
         using (app.is_agency() or account_id = app.current_account_id())
         with check (app.is_agency() or account_id = app.current_account_id())', t, t);
  end loop;
end $$;
