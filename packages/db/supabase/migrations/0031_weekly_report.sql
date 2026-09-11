-- 0031_weekly_report.sql
-- Weekly report email: who receives it, and the once-per-week stamp.
--
-- `report_emails` is the ACCOUNT-level twin of forms.notify_emails. There is no
-- account-level recipient in this schema today: every operator-facing email
-- (lead alerts, booking alerts, voice summaries) goes to a FORM's notify list,
-- which is a different audience — people who asked about one form's leads, not
-- people who want the business's weekly numbers. An account with no form would
-- otherwise be unreachable.
--
-- `weekly_report_week` stores the MONDAY the report was last sent FOR, as a
-- date, not a timestamp. "Already sent for this week" is a local-day question,
-- and a date makes it a single equality with no zone arithmetic at read time.
alter table public.accounts
  add column report_emails text[] not null default '{}',
  add column weekly_report_week date;

-- The agency row has neither an address nor a zone, and there is no agency
-- settings screen to add one through.
--
-- `report_email` stays NULL on purpose: the roll-up pass counts
-- `skippedNoRecipient` when it is unset, so an unconfigured address fails
-- VISIBLY in the cron's JSON rather than silently sending nothing forever.
--
-- `timezone` exists because the roll-up needs a zone to gate its Monday
-- morning on, and the alternative was a hardcoded 'America/Chicago' buried in
-- a pass with nowhere to change it.
alter table public.agencies
  add column report_email text,
  add column timezone text not null default 'America/Chicago',
  add column weekly_report_week date;

-- NO `grant update (...) to authenticated` on any column above, and that is
-- deliberate — do not "fix" it by adding one.
--
-- 0013 revoked UPDATE on public.accounts and 0014 re-granted it one column at a
-- time (the seven branding columns plus reply_to_email), because this table is
-- edited per-column by clients. These columns are different: `report_emails` is
-- written by setReportEmailsAction, which runs behind
-- requireAgencyOnlyAccountAccess and writes through serviceDb() — exactly like
-- setFromEmailAction beside it — so it never needs the grant. Granting it would
-- hand every `authenticated` client the ability to redirect their own account's
-- report to any address through PostgREST directly.
--
-- `weekly_report_week` is written ONLY by the cron's service client. A client
-- that could write it could forge the stamp and suppress the report.
--
-- SELECT needs no grant either: it is table-level on public.accounts for
-- `authenticated` (verified against information_schema before this migration),
-- so both new columns are readable by the Settings page without further work.

comment on column public.accounts.report_emails is
  'Weekly report recipients. Empty = this account is not due a report at all, and it is never a due row.';
comment on column public.accounts.weekly_report_week is
  'The Monday (local to the account) the weekly report was last sent for. Service-client write only.';
comment on column public.agencies.report_email is
  'Where the agency roll-up goes. NULL = unset; the pass counts skippedNoRecipient rather than failing silently.';
