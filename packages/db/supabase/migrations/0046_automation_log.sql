-- 0046_automation_log.sql
-- Automation engine, part C (docs/superpowers/specs/2026-09-21-automation-engine-c-design.md).
--
-- ONE record of everything the automations do on a client's behalf, and ONE
-- quiet-hours window per account.
--
-- automation_log: one row per (account, source, subject). A subject moves
-- through states IN PLACE — held → sent when the window ends, skipped → sent
-- when an address is added, failed → sent when a retry lands — which is why
-- the unique key carries no status. Two things follow, and both are the
-- design rather than tidiness:
--   1. the history shows one line per thing the system considered, wearing
--      its latest status, never a held line and a sent line for one subject;
--   2. the release step (lib/automations/passes/release-held.ts) finds work
--      by `status = 'held' and held_until <= now()`, so a held row IS the
--      queue. The email reminder's due window is 75 minutes wide and the SMS
--      reminder's 45, so a booking held at 22:00 is gone from both due-lists
--      by 08:00 — nothing but this row remembers it.
--
-- `payload` carries what a release needs that the subject row cannot cheaply
-- re-derive (the instant reply's phone, locale and consent flag). Never
-- rendered. `reason` is CLIENT-READABLE plain language ("Held until 8:00 AM —
-- quiet hours", "No email address on file"); the console keeps the detail.
--
-- `on delete cascade`, NOT restrict, and therefore NOT on ACCOUNT_OWNED_TABLES
-- or the e2e sweep list: these rows are derived state about an account, the
-- exact class 0036 and 0039 argued for (account-teardown.ts:30-56). The
-- cascade is proven in automation-log-grants.test.ts, not assumed.
-- `contact_id … on delete set null`: a contact deleted later leaves the line
-- in the history with no name, which is the truth.
create table public.automation_log (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  source text not null
    constraint automation_log_source_check check (source in (
      'reminders', 'followups', 'review_request', 'no_show_nudge', 'sms_reminder',
      'instant_reply', 'weekly_report', 'concierge', 'voice')),
  channel text not null
    constraint automation_log_channel_check check (channel in ('sms', 'email', 'ai')),
  contact_id uuid references public.contacts(id) on delete set null,
  -- 'booking:<id>', 'submission:<id>', 'conversation:<id>', 'call:<id>', 'week:<YYYY-MM-DD>'
  subject_key text not null,
  status text not null
    constraint automation_log_status_check check (status in ('sent', 'held', 'skipped', 'failed')),
  reason text not null default '',
  held_until timestamptz,
  payload jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now(),
  -- held rows carry held_until; no other status does. A held row without a
  -- release time would sit in the queue forever; a sent row with one would
  -- be released again.
  constraint automation_log_held_until_check check ((status = 'held') = (held_until is not null)),
  constraint automation_log_subject_key unique (account_id, source, subject_key)
);

comment on table public.automation_log is
  'One row per (account, source, subject) for everything the automations, the website assistant and the phone assistant do on a client''s behalf. Status moves in place (held → sent). The release pass reads held rows as its queue. authenticated reads its own account under RLS; service_role writes.';

-- The history page: newest first, keyset on (occurred_at, id).
create index automation_log_account_occurred_idx
  on public.automation_log (account_id, occurred_at desc, id desc);
-- The release pass: every held row whose time has come, across accounts.
create index automation_log_held_idx
  on public.automation_log (held_until) where status = 'held';

-- Grants copy 0025 (automations): authenticated SELECT under RLS, nothing
-- else; anon nothing. Supabase's default ACL hands ALL to every role on a
-- new table (the 0020 lesson), so the revokes live HERE.
alter table public.automation_log enable row level security;
create policy automation_log_tenant on public.automation_log for select to authenticated
  using (app.is_agency() or account_id = app.current_account_id());
grant select on public.automation_log to authenticated;
revoke insert, update, delete, truncate, references, trigger
  on public.automation_log from authenticated;
revoke all on public.automation_log from anon;


-- automation_settings: the quiet-hours window. One row per account, and a
-- MISSING row means the defaults (21:00–08:00, on) — readQuietSettings
-- returns them without writing, so nothing is inserted until the agency
-- edits. `time` columns: the wall clock in the ACCOUNT's zone
-- (accounts.timezone); the pure module resolves them against an instant.
-- `quiet_start = quiet_end` is the "disabled" spelling the module honours;
-- the CHECK does not forbid it.
create table public.automation_settings (
  account_id uuid primary key references public.accounts(id) on delete cascade,
  quiet_enabled boolean not null default true,
  quiet_start time not null default '21:00',
  quiet_end time not null default '08:00',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.automation_settings is
  'Per-account automation settings: the quiet-hours window every customer-facing automated send obeys (held, never skipped). Missing row = defaults. Agency-edited through serviceDb(); authenticated reads its own under RLS.';

alter table public.automation_settings enable row level security;
create policy automation_settings_tenant on public.automation_settings for select to authenticated
  using (app.is_agency() or account_id = app.current_account_id());
grant select on public.automation_settings to authenticated;
revoke insert, update, delete, truncate, references, trigger
  on public.automation_settings from authenticated;
revoke all on public.automation_settings from anon;
