-- 0057_ops_heartbeats.sql
-- The operational floor, Section 1 "Heartbeats" (F-119 part)
-- (docs/superpowers/specs/2026-10-01-operational-floor-design.md, sections 1,
-- 2 and 5; approved by danlo 2026-10-01).
--
-- WHY. Today nothing records whether the platform's moving parts ran. If the
-- 15-minute cron stops, or one of its passes throws on every tick, or a
-- webhook route starts failing, the only trace is a console.error line in
-- Vercel's logs (spec "Why this, and why now"). This table is the record
-- the alert pass (spec section 2) and GET /api/ops/health (section 1) read:
-- one row per moving part, keyed by name, holding when it last worked, when
-- it last failed, why, and how many times in a row.
--
-- ADDITIVE ONLY. The build before this file never reads or writes the table
-- or calls the function, so production takes this file BEFORE the merge
-- deploy, and the build after it can rely on it from its first request.
--
-- 1. public.ops_heartbeats: global and agency-level, NO account_id (a
--    heartbeat is about the platform, not a tenant), so it is not on
--    ACCOUNT_OWNED_TABLES and never rides an account teardown.
--    Keys (spec section 1): cron.tick, cron.pass.<pass key>, voice.texml,
--    voice.sip_webhook, email.resend_webhook, sms.inbound, stripe.webhook.
--    The key CHECK allows UPPER case on purpose: a pass key is camelCase
--    (cron.pass.weeklyAgencyReport, apps/web lib/automations/passes/*), and
--    a lower-case-only pattern refuses 11 of today's 14, which the writer
--    (best effort, never throws) would swallow into a missing heartbeat.
--    last_error is the first 300 characters of the error and must never hold
--    a token, an address or a phone number (spec section 1): what goes in is
--    the caller's job, the 300 is enforced here.
--    alerted_at is the alert pass's: set when it emails about the key,
--    cleared by it after the recovered email. record_heartbeat never touches
--    it, so a success leaves it set for the alert pass to see as a recovery.
-- 2. public.record_heartbeat(p_key, p_ok, p_error): the ONE write path for a
--    heartbeat. A single INSERT ... ON CONFLICT DO UPDATE, so two writers
--    stamping the same key at once serialise on the row and neither
--    increment of consecutive_failures is lost (a read-then-write would lose
--    one). On ok: last_ok_at = now(), consecutive_failures = 0. On error:
--    last_error_at = now(), last_error = left(p_error, 300),
--    consecutive_failures + 1. Either way updated_at = now(). The previous
--    error is KEPT on success, so the alert pass can compare last_error_at
--    with last_ok_at (spec section 2, rule 2).
--    SECURITY INVOKER with an empty search_path (0055's shape for a
--    service-only function): it writes with service_role's own grants, and
--    EXECUTE is service_role's alone.
--
-- WHO WRITES WHAT. service_role only, through packages/db/src/ops.ts (the
-- cron harness and the webhook routes call recordHeartbeat; the alert pass
-- calls markAlerted). RLS on with NO policy, and no grant of any kind to anon
-- or authenticated: a client session can neither read nor write a heartbeat
-- (stripe_webhook_events' shape, 0051). service_role gets SELECT, INSERT and
-- UPDATE only (0054's revoke-all-then-grant-back shape: the default ACL hands
-- ALL, MAINTAIN included, to all three roles by name). No role holds DELETE:
-- a retired key is removed by the table owner by hand.
--
-- No backslash and no non-ASCII byte anywhere in this file (the MCP apply
-- rule).
--
-- ROLLBACK (roll the app back first; the build after this file calls the
-- function on every cron tick and webhook):
--   drop function public.record_heartbeat(text, boolean, text);
--   drop table public.ops_heartbeats;

create table public.ops_heartbeats (
  key text primary key
    constraint ops_heartbeats_key_check check (key ~ '^[A-Za-z0-9_.-]{1,80}$'),
  last_ok_at timestamptz,
  last_error_at timestamptz,
  last_error text
    constraint ops_heartbeats_last_error_check check (char_length(last_error) <= 300),
  consecutive_failures integer not null default 0
    constraint ops_heartbeats_consecutive_failures_check check (consecutive_failures >= 0),
  alerted_at timestamptz,
  updated_at timestamptz not null default now()
);

comment on table public.ops_heartbeats is
  'One row per moving part of the platform (cron.tick, cron.pass.<pass key>, each webhook route): when it last worked, when it last failed and why (300 characters, never a token, address or phone number), how many failures in a row, and when the alert pass last emailed about it. Global, no account. Written only by service_role through public.record_heartbeat and markAlerted (packages/db/src/ops.ts); no grant to anon or authenticated.';
comment on column public.ops_heartbeats.consecutive_failures is
  'Failures since the last success; reset to 0 by the next ok heartbeat. The alert pass emails at 2 for a cron pass (spec section 2).';
comment on column public.ops_heartbeats.alerted_at is
  'When the alert pass last emailed about this key. Set and cleared by the alert pass only (markAlerted); record_heartbeat never touches it.';
comment on column public.ops_heartbeats.updated_at is
  'When record_heartbeat last wrote this row. markAlerted does not move it.';

alter table public.ops_heartbeats enable row level security;
-- No policy: RLS on with none refuses every row to every role that does not
-- bypass it, and the grants below refuse anon and authenticated outright.
revoke all on public.ops_heartbeats from anon, authenticated, service_role;
grant select, insert, update on public.ops_heartbeats to service_role;

create function public.record_heartbeat(p_key text, p_ok boolean, p_error text default null)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_now timestamptz := pg_catalog.now();
begin
  -- A NULL outcome is a caller bug, not a failure to count.
  if p_ok is null then
    raise exception 'record_heartbeat: p_ok must be true or false' using errcode = '22023';
  end if;
  insert into public.ops_heartbeats as h
    (key, last_ok_at, last_error_at, last_error, consecutive_failures, updated_at)
  values
    (p_key,
     case when p_ok then v_now end,
     case when p_ok then null else v_now end,
     case when p_ok then null else pg_catalog.left(p_error, 300) end,
     case when p_ok then 0 else 1 end,
     v_now)
  on conflict (key) do update set
    last_ok_at = case when p_ok then v_now else h.last_ok_at end,
    last_error_at = case when p_ok then h.last_error_at else v_now end,
    last_error = case when p_ok then h.last_error else pg_catalog.left(p_error, 300) end,
    consecutive_failures = case when p_ok then 0 else h.consecutive_failures + 1 end,
    updated_at = v_now;
end;
$$;

comment on function public.record_heartbeat(text, boolean, text) is
  'Stamps one heartbeat in one INSERT ... ON CONFLICT DO UPDATE (0057). ok: last_ok_at = now(), consecutive_failures = 0. error: last_error_at = now(), last_error = left(p_error, 300), consecutive_failures + 1. updated_at = now() either way; alerted_at untouched; a NULL p_ok raises 22023. Called only from packages/db/src/ops.ts as service_role.';

-- Default privileges hand EXECUTE to anon, authenticated and service_role BY
-- NAME, so revoking from PUBLIC alone would leave them (0043's lesson).
revoke all on function public.record_heartbeat(text, boolean, text) from public, anon, authenticated, service_role;
grant execute on function public.record_heartbeat(text, boolean, text) to service_role;
