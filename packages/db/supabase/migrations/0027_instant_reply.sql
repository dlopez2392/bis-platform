-- 0027: Automations Milestone C — the instant reply to a new web-form lead.
-- The INLINE recipe: it fires from the public form action the moment a
-- submission lands (docs/superpowers/specs/2026-09-07-automations-milestone-c-
-- design.md), not from the cron. Three things, in the 0026 shape:
--
-- 1. THE DEDUPE STAMP. `form_submissions.instant_reply_sent_at`, send-then-
--    stamp like every other recipe. Null = no text was sent for this
--    submission. It is NOT the primary double-text guard — that is the 24h
--    per-thread hold (hasRecentOutboundSms) the send path reads — it is the
--    evidence the daily cap counts.
-- 2. THE CATALOGUE grows by one key. Postgres names an inline column CHECK
--    <table>_<column>_check; the pre-flight read confirms the name before
--    this runs.
-- 3. ONE partial index so the cap count (account, stamp >= now - 24h) is an
--    index-only read.
--
-- Grants: NONE change. form_submissions carries Supabase's default table-
-- level grants (`authenticated` AND `anon` hold SELECT/INSERT/UPDATE/DELETE/
-- TRUNCATE/REFERENCES/TRIGGER); RLS is on with ONE policy,
-- form_submissions_member_all (the agency, or account_id = the caller's own
-- account), so anon reaches nothing and a member reaches only their own
-- account's rows. The new column inherits exactly that standing, pinned in
-- automations-grants.test.ts. OFF BY DEFAULT: the recipe needs an enabled
-- `instant_reply` automations row that no account has.

alter table public.form_submissions add column instant_reply_sent_at timestamptz;

alter table public.automations drop constraint automations_recipe_key_check;
alter table public.automations add constraint automations_recipe_key_check
  check (recipe_key in ('review_request', 'no_show_nudge', 'sms_reminder', 'instant_reply'));

create index form_submissions_instant_reply_sent
  on public.form_submissions (account_id, instant_reply_sent_at)
  where instant_reply_sent_at is not null;
