-- 0025: automations — the generic config spine for built-in recipes.
--
-- Config is GENERIC (one row per account per recipe: a toggle, a body, a jsonb
-- config), due-ness is DOMAIN-SPECIFIC (a stamp on the domain row, here
-- bookings.review_requested_at), so a booking that is cancelled or
-- un-completed simply stops matching the due query — no void step.
--
-- Grants copy voice_profiles (0019 + 0020), NOT calendars (0022): every
-- recipe here spends the client's money and messages their customers, so v1
-- is agency-configured. `authenticated` reads its own row under RLS; every
-- write goes through serviceDb() behind an isAgency check. Supabase default
-- privileges auto-grant ALL on a new table (the 0020 lesson), so the revoke
-- is in THIS migration rather than a follow-up.
--
-- OFF BY DEFAULT: enabled=false. Nothing changes for any client on deploy.
--
-- recipe_key is CHECK-constrained to the catalogue: this platform ships fixed
-- recipes, not a rule builder, and the database is where that is enforced.
-- Milestone B extends the list in its own migration.

create table public.automations (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete restrict,
  recipe_key text not null check (recipe_key in ('review_request')),
  enabled boolean not null default false,
  body text not null default '',
  config jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (account_id, recipe_key)
);
alter table public.automations enable row level security;
create policy automations_tenant on public.automations for all to authenticated
  using (app.is_agency() or account_id = app.current_account_id())
  with check (app.is_agency() or account_id = app.current_account_id());
grant select on public.automations to authenticated;
revoke insert, update, delete, truncate, references, trigger
  on public.automations from authenticated;
revoke all on public.automations from anon;

-- The review request's dedupe stamp. Send-then-stamp, like reminder_sent_at
-- and followup_sent_at: it marks a confirmed send, never an attempt.
alter table public.bookings add column review_requested_at timestamptz;
create index bookings_review_due
  on public.bookings (ends_at) where status = 'completed' and review_requested_at is null;
