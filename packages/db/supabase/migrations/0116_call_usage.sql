-- 0116_call_usage.sql - record token use on every call (owner decision, 2026-11-10)
--
-- WHY. calls stores no OpenAI usage, so BIS cannot measure what a minute of Sofia really costs before it sets
-- prices. public.call_usage keeps one row per call: the Realtime model's id, how many responses it gave, its
-- input and output tokens split by text and audio (cached input apart), the caller-speech transcription model's
-- usage (it reports EITHER tokens OR seconds, so those four columns are nullable), and an ESTIMATED cost in whole
-- micro-dollars computed by the app from its own price table. Never a prompt, never a transcript: no column could
-- hold one (the model ids are capped at 64 characters).
-- WHO READS. The agency alone (coalesce(app.is_agency(), false), in the 0109 initplan form). No client role reads
-- it at all, not even the account's Owner: it is BIS's cost data, not the client's. 0086's ai_ledger shape.
-- WHO WRITES. service_role only (select, insert, update, delete), through packages/db/src/call-usage.ts
-- recordCallUsage, which inserts with on conflict (call_id) do nothing, so a retried finish never double-counts.
-- authenticated holds SELECT and nothing else; anon holds nothing.
-- DELETES. call_id and account_id both cascade: the row is derived cost state, not a lead-bearing row. It is not
-- on ACCOUNT_OWNED_TABLES: calls is, and each usage row leaves with its call.
-- LOCKS. One new, empty table. Its foreign keys take SHARE ROW EXCLUSIVE on public.calls and public.accounts for
-- the few milliseconds this file runs; lock_timeout 5s bounds the wait (0105's shape). No existing table is
-- altered or rewritten.
-- APPLY ORDER: after 0113, 0114 and 0115. CI project (ci-project-setup.yml: push-dry-run, then push), then
-- production (MCP apply_migration, once), then the parity check, then merge. Additive: no build before this file
-- reads it; the build that writes it calls recordCallUsage inside a never-throw guard, but the table must exist
-- before that build deploys or every call's usage is lost.
--
-- Rollback (by hand; revert the app first). IT DESTROYS THE RECORDED USAGE:
--   drop table public.call_usage;
--
-- ASCII only, no backslash anywhere.

do $$
begin
  perform pg_catalog.set_config('lock_timeout', '5s', true);
end $$;

create table public.call_usage (
  call_id uuid primary key references public.calls(id) on delete cascade,
  account_id uuid not null references public.accounts(id) on delete cascade,
  model text not null constraint call_usage_model_check check (char_length(model) between 1 and 64),
  responses integer not null default 0 constraint call_usage_responses_check check (responses >= 0),
  input_text_tokens integer not null default 0
    constraint call_usage_input_text_tokens_check check (input_text_tokens >= 0),
  input_audio_tokens integer not null default 0
    constraint call_usage_input_audio_tokens_check check (input_audio_tokens >= 0),
  input_cached_text_tokens integer not null default 0
    constraint call_usage_input_cached_text_tokens_check check (input_cached_text_tokens >= 0),
  input_cached_audio_tokens integer not null default 0
    constraint call_usage_input_cached_audio_tokens_check check (input_cached_audio_tokens >= 0),
  output_text_tokens integer not null default 0
    constraint call_usage_output_text_tokens_check check (output_text_tokens >= 0),
  output_audio_tokens integer not null default 0
    constraint call_usage_output_audio_tokens_check check (output_audio_tokens >= 0),
  transcribe_model text
    constraint call_usage_transcribe_model_check check (transcribe_model is null or char_length(transcribe_model) between 1 and 64),
  transcribe_input_tokens integer
    constraint call_usage_transcribe_input_tokens_check check (transcribe_input_tokens >= 0),
  transcribe_output_tokens integer
    constraint call_usage_transcribe_output_tokens_check check (transcribe_output_tokens >= 0),
  transcribe_seconds numeric
    constraint call_usage_transcribe_seconds_check check (transcribe_seconds >= 0),
  est_cost_microusd bigint not null default 0
    constraint call_usage_est_cost_microusd_check check (est_cost_microusd >= 0),
  created_at timestamptz not null default now()
);
create index call_usage_by_account on public.call_usage (account_id, created_at desc);
comment on table public.call_usage is
  'One row per call (0116): the Realtime model''s token use and the caller-speech transcription''s, and an estimated cost. Written by service_role only (recordCallUsage); only the agency reads it.';
comment on column public.call_usage.est_cost_microusd is
  'An ESTIMATE in whole micro-dollars, computed by the app from its own price table when the call finished. Not an invoice amount.';

alter table public.call_usage enable row level security;
revoke all on public.call_usage from anon, authenticated, service_role;
grant select on public.call_usage to authenticated;
grant select, insert, update, delete on public.call_usage to service_role;
create policy call_usage_agency_read on public.call_usage for select to authenticated
  using ((select coalesce(app.is_agency(), false)));
