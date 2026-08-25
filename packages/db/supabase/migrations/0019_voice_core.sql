-- Voice Receptionist Core: tenant-routed phone numbers, per-account voice
-- profiles, durable call records. Additive only. Writes go through
-- serviceDb(); authenticated gets SELECT only (0018 lesson: grants are
-- per-column/per-verb and invisible to the service-role test suite).

create table public.phone_numbers (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete restrict,
  e164 text not null unique check (e164 ~ '^\+[0-9]{8,15}$'),
  telnyx_id text,
  status text not null default 'provisioned'
    check (status in ('provisioned','testing','live','released')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.phone_numbers enable row level security;
create policy phone_numbers_tenant on public.phone_numbers for all to authenticated
  using (app.is_agency() or account_id = app.current_account_id())
  with check (app.is_agency() or account_id = app.current_account_id());
grant select on public.phone_numbers to authenticated;

create table public.voice_profiles (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null unique references public.accounts(id) on delete restrict,
  persona_name text not null default 'Sofía',
  greeting_en text not null default '',
  greeting_es text not null default '',
  facts text not null default '',
  services text not null default '',
  languages text not null default 'both' check (languages in ('en','es','both')),
  booking_enabled boolean not null default true,
  after_hours text not null default 'hours_then_message'
    check (after_hours in ('hours_then_message','message_only')),
  enabled boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.voice_profiles enable row level security;
create policy voice_profiles_tenant on public.voice_profiles for all to authenticated
  using (app.is_agency() or account_id = app.current_account_id())
  with check (app.is_agency() or account_id = app.current_account_id());
grant select on public.voice_profiles to authenticated;

create table public.calls (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete restrict,
  phone_number_id uuid not null references public.phone_numbers(id) on delete restrict,
  contact_id uuid references public.contacts(id) on delete set null,
  conversation_id uuid references public.conversations(id) on delete set null,
  booking_id uuid references public.bookings(id) on delete set null,
  caller_e164 text,
  language text not null default 'en' check (language in ('en','es')),
  outcome text not null default 'abandoned'
    check (outcome in ('booked','lead','message','abandoned','spam')),
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  duration_secs integer,
  turn_count integer not null default 0,
  transcript jsonb not null default '[]'::jsonb,
  summary text not null default '',
  created_at timestamptz not null default now()
);
create index calls_account_started_idx on public.calls (account_id, started_at desc);
create index calls_caller_idx on public.calls (account_id, caller_e164, started_at desc);
alter table public.calls enable row level security;
create policy calls_tenant on public.calls for all to authenticated
  using (app.is_agency() or account_id = app.current_account_id())
  with check (app.is_agency() or account_id = app.current_account_id());
grant select on public.calls to authenticated;

-- NO messages constraint change: migration 0006 already models the FULL
-- channel enum (email, sms, webchat, note, form, voice) — a deliberate M1b
-- decision so channels are adapters, not migrations. 'voice' is already
-- legal at the DB layer; only the TypeScript NewMessage type narrows it.
