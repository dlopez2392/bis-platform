-- Missed-call text-back, per company.
--
-- OFF by default and deliberately so: this sends automatically, on the
-- client's own number, costing their money, with no human in the loop. It is
-- trialled on one company before it touches another — the same posture as the
-- voice go-live press and the calendar's follow-up emails.
--
-- No grant work needed: 0020_voice_grants_revoke.sql already revoked
-- insert/update/delete on voice_profiles from `authenticated`, so these
-- columns are serviceDb-only by inheritance and a client cannot flip their
-- own toggle.
--
-- An EMPTY textback_body means "use the live default at send time" — the same
-- contract calendars.followup_body carries, so an unrelated save can never
-- silently pin the frozen default into the column.
alter table public.voice_profiles
  add column textback_enabled boolean not null default false,
  add column textback_body text not null default '';
