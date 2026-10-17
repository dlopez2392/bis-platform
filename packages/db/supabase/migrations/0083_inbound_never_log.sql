-- 0083_inbound_never_log.sql - inbound email, part 2: the Never record list
-- (docs/superpowers/specs/2026-10-17-forward-to-record-design.md "Data model";
--  docs/superpowers/plans/2026-10-17-forward-to-record.md)
--
-- Each account keeps a list of addresses and whole domains whose mail is dropped by the inbound
-- pipeline before anything is stored, even when the sender is a customer. An address entry is the
-- sender's email key (lowercase, +tag stripped, the app's emailKey); a domain entry matches that
-- domain and every subdomain of it (the app's neverLogMatches). The agency edits it on Settings, an
-- Owner on Branding; both go through server actions on the service client (0053: server-only
-- writes). Members of the account read it, the agency every account's, a Technician none (plan G7:
-- staff can read it here; no page shows it to them).
-- One unique (account_id, pattern) index; it leads with account_id, so it serves every per-account
-- read and no second index is made (plan G17).
--
-- APPLY ORDER: CI project (ci-project-setup.yml: push-dry-run, then push), then production (MCP
-- apply_migration, once), then the parity check, then merge. Purely additive: safe for the build
-- before it, which never reads this table. The app that reads it must not run before this file
-- (every inbound email would answer 503 on the list read).
--
-- Rollback (by hand; revert the app first): drop table public.inbound_never_log;
--   Lost: every account's Never record entries.
--
-- ASCII only, no backslash anywhere.

-- 0. Fail fast instead of queueing behind a long lock.
set local lock_timeout = '5s';

-- 1. The table.
create table public.inbound_never_log (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  pattern text not null,
  kind text not null,
  added_by text not null,
  created_at timestamptz not null default now(),
  constraint inbound_never_log_account_pattern_key unique (account_id, pattern),
  constraint inbound_never_log_kind_check check (kind in ('address', 'domain')),
  constraint inbound_never_log_pattern_check check (
    pattern = lower(pattern)
    and char_length(pattern) <= 254
    and (
      (kind = 'address'
        and pattern ~ '^[a-z0-9.!#$%&''*/=?^_`{|}~-]+@([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?[.])+[a-z]{2,63}$')
      or (kind = 'domain'
        and pattern ~ '^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?[.])+[a-z]{2,63}$')))
);

-- 2. Who reads it. Server-written only (0053).
alter table public.inbound_never_log enable row level security;
create policy inbound_never_log_member_read on public.inbound_never_log for select to authenticated
  using (coalesce(app.is_agency(), false) or account_id = app.current_account_id());
create policy inbound_never_log_no_technician on public.inbound_never_log as restrictive for select to authenticated
  using (coalesce(app.sees_all_customers(account_id), false));
revoke all on public.inbound_never_log from anon, authenticated;
grant select on public.inbound_never_log to authenticated;
grant select, insert, update, delete on public.inbound_never_log to service_role;
