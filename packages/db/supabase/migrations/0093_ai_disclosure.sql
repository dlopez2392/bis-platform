-- 0093_ai_disclosure.sql - Sofia says she is an AI: the per-account setting and the per-call stamp
-- (S-47 part a; F-034; decision 20)
-- (docs/superpowers/specs/2026-10-20-ai-disclosure-design.md section 4;
--  docs/superpowers/plans/2026-10-20-ai-disclosure-pr47a.md, Task 1)
--
-- WHY. Decision 20 (owner, 2026-10-05): every assistant discloses by default, measured first. No account
-- has real call volume, so a before/after trial would measure nothing; instead a Trial account splits its
-- calls by a fair coin, and each call records which half it was in.
--
-- THREE COLUMNS:
--   public.voice_profiles.disclosure text not null default 'off', one of off, trial, on.
--     off: Sofia says she is automated only when asked (today's behaviour). on: she says it after the
--     greeting on every call. trial: a fair coin per call decides. NOT NULL so 'off' has one spelling
--     (0058's argument about forward_calls).
--   public.calls.disclosed boolean, nullable. Written once, at call start, by the incoming call route,
--     for every call whose profile was trial or on: true if she said it, false if not. NULL for an off
--     account and for every call before this file.
--   public.calls.disclosure_setting text, nullable, trial or on (owner decision D5, 2026-10-20): the
--     setting that decided the call, written on the same insert as disclosed and only with it. The results
--     card counts only trial rows, so moving an account from trial to on never pours every-call-discloses
--     calls into the half that heard it. No 'off': an off call is never stamped.
--
-- WHO WRITES THEM. disclosure: the agency only, through serviceDb(), behind the app's agency check, in
-- saveVoiceProfileAction (the Voice page's own Save). calls.disclosed and calls.disclosure_setting: the
-- server only, in startCallRow.
--
-- GRANTS: NONE, and the absence is the control (0058's DO NOT FIX, word for word in spirit).
--   authenticated has table SELECT on voice_profiles and calls (0019) and no write verb on either (0020
--   revoked insert, update, delete, truncate, references and trigger; 0053 revoked maintain), so a column
--   added today inherits exactly that: a client Owner reads the setting and never writes it (decision 28:
--   guardrails are never owner-editable), and nobody but the server stamps a call. That includes the
--   agency's own authenticated token. anon has nothing on either table (0020) and gains nothing.
--   service_role writes through the project's default privileges. The client-write digest is unchanged.
--
-- NO RLS POLICY CHANGE. voice_profiles_tenant and calls_tenant (0019), and the restrictive
-- calls_technician_scope (0068), are row policies and cover every column added today.
--
-- APPLY ORDER: CI project (ci-project-setup.yml: push-dry-run, then push), then production (MCP
-- apply_migration, once), then the parity check, then merge. The migration goes BEFORE the code: the
-- build after this file selects disclosure on every voice profile read (PROFILE_COLS), and PostgREST
-- fails a select naming a column it does not know.
-- SAFE UNDER THE RUNNING BUILD: additive. The running build never names any of the three columns; the
-- default fills disclosure on its profile inserts, and both calls columns stay null on its call inserts.
--
-- ROLLBACK (roll the app back first), in this order; the two calls columns only on an owner decision,
-- because they drop the trial's per-call record:
--   alter table public.calls drop column disclosure_setting;   (its CHECK goes with it)
--   alter table public.calls drop column disclosed;
--   alter table public.voice_profiles drop column disclosure;  (its CHECK goes with it)
--
-- ASCII only, no backslash anywhere.

-- 0. Fail fast instead of queueing behind a long lock (0091's reason: inside a do block, so it is always in
--    the block's transaction). Both ALTERs take ACCESS EXCLUSIVE on tables the call path reads on every call.
do $$
begin
  perform pg_catalog.set_config('lock_timeout', '5s', true);
end $$;

-- 1. The setting.
alter table public.voice_profiles
  add column disclosure text not null default 'off'
    constraint voice_profiles_disclosure_check check (disclosure in ('off', 'trial', 'on'));

comment on column public.voice_profiles.disclosure is
  'Whether the receptionist says she is an AI right after the greeting: off (only when asked), trial (a fair coin per call), on (every call). The website chat is labelled AI on trial or on. Agency-written through serviceDb() by saveVoiceProfileAction; authenticated has SELECT and deliberately no UPDATE.';

-- 2. The per-call stamp.
alter table public.calls
  add column disclosed boolean;

comment on column public.calls.disclosed is
  'Set once at call start by the incoming call route (startCallRow) when the profile was trial or on: true if the receptionist said she is an AI, false if not. NULL for an off account and for every call before 0093. Server-written only.';

-- 3. Which setting decided it (D5).
alter table public.calls
  add column disclosure_setting text
    constraint calls_disclosure_setting_check check (disclosure_setting in ('trial', 'on'));

comment on column public.calls.disclosure_setting is
  'The setting that decided calls.disclosed, written with it at call start by the incoming call route (startCallRow): trial or on. NULL for an off account and for every call before 0093. The results card counts only trial calls. Server-written only.';
