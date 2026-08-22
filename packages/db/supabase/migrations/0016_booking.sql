-- Booking: one calendar per company, bookings whose no-overlap guarantee
-- lives HERE, not in application code.

-- btree_gist lets a gist exclusion constraint carry the uuid equality leg.
create extension if not exists btree_gist;

create table public.calendars (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  -- One calendar per company is SCHEMA, not convention (spec §2 decision 1).
  constraint calendars_one_per_account unique (account_id),
  public_id text not null unique,
  -- Nothing is bookable until someone turns it on.
  enabled boolean not null default false,
  slot_duration_minutes int not null default 60 check (slot_duration_minutes between 5 and 480),
  buffer_minutes int not null default 0 check (buffer_minutes between 0 and 240),
  min_notice_hours int not null default 12 check (min_notice_hours between 0 and 168),
  max_advance_days int not null default 30 check (max_advance_days between 1 and 365),
  -- Per-weekday intervals: {"mon":[["09:00","17:00"]], ...}. ONE set for the
  -- company — no per-member availability, deliberately (spec §2 decision 1).
  open_hours jsonb not null default '{}'::jsonb,
  -- Same semantics as forms.notify_emails: empty means the booking alert goes
  -- nowhere, and the settings panel warns inline.
  notify_emails text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.bookings (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  calendar_id uuid not null references public.calendars(id) on delete cascade,
  -- Non-null: a booking cannot exist without its person (spec §6 step 2).
  contact_id uuid not null references public.contacts(id) on delete cascade,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  check (ends_at > starts_at),
  status text not null default 'booked'
    check (status in ('booked','cancelled','completed','no_show')),
  note text,
  -- The capability in the confirmation email. Opaque; knowing it IS the
  -- authorisation to cancel, exactly as knowing a form's public_id is the
  -- authorisation to submit.
  cancel_token text not null unique,
  -- The booker's IANA zone, captured from their browser at booking, so the
  -- confirmation and the reminder can speak their local time.
  booker_timezone text,
  -- Rate limiting: hashed submitter IP, same hashing as form submissions.
  ip_hash text,
  -- THE reminder dedupe marker. Null = not yet sent. Stamped AFTER a
  -- successful send, never before (spec §7 — send-then-stamp).
  reminder_sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Two racers for one slot resolve in the database: the loser gets this
-- constraint, surfaced as "that time was just taken." Only live bookings
-- bind — a cancelled booking frees its range.
alter table public.bookings add constraint bookings_no_overlap
  exclude using gist (
    calendar_id with =,
    tstzrange(starts_at, ends_at) with &&
  ) where (status = 'booked');

create index bookings_reminder_due
  on public.bookings (starts_at) where status = 'booked' and reminder_sent_at is null;
create index bookings_by_calendar on public.bookings (calendar_id, starts_at);

-- RLS: house pattern.
alter table public.calendars enable row level security;
alter table public.bookings enable row level security;

create policy calendars_tenant on public.calendars for all
  using (app.is_agency() or account_id = app.current_account_id())
  with check (app.is_agency() or account_id = app.current_account_id());
create policy bookings_tenant on public.bookings for all
  using (app.is_agency() or account_id = app.current_account_id())
  with check (app.is_agency() or account_id = app.current_account_id());

-- Column grants. Settings are client-editable (M4c precedent); identity is
-- not; bookings get NO client UPDATE grant at all — operator mutations go
-- through server actions, the public flow through service role.
revoke update on public.calendars from authenticated;
grant update (enabled, slot_duration_minutes, buffer_minutes, min_notice_hours,
              max_advance_days, open_hours, notify_emails)
  on public.calendars to authenticated;
revoke update on public.bookings from authenticated;
