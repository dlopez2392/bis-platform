-- 0059_forwarded_calls.sql
-- The operational floor, the forward's KNOWN LIMIT closed
-- (docs/superpowers/specs/2026-10-01-operational-floor-design.md, section 3,
-- "Amendments taken while building PR-2"; danlo 2026-10-04: "go ahead with
-- the forward-call cap").
--
-- WHY. A call that reaches a person without Sofia writes no calls row: the
-- calls row is written by Sofia's own webhook, and a forwarded call never
-- reaches it. The daily caps (decideLimit, fed by countCallsSince and
-- countCallsByCallerSince) count calls rows only, so while an account's
-- forward is on, or while Sofia is down and the model-down fallback rings
-- the transfer number, a robot can ring the business's own phone without
-- limit, each leg up to an hour (timeLimit) on the platform's trunk. This
-- table is the count those caps were missing: one row per call the platform
-- put through to a person instead of to Sofia.
--
-- WHY THIS IS NOT A calls ROW (0039's argument, and the same conclusion):
--   * calls drives the call list, the dashboard chart, the weekly report's
--     "calls answered", minutes metering and the call-detail page. A
--     forwarded call has no transcript, no outcome, no duration we measured
--     and no summary; every one of those readers would need a new exception.
--   * countCallerHistorySince reads calls.outcome. A forwarded row with any
--     outcome would land in its otherCalls branch and UN-BLOCK a repeat-spam
--     caller for the window (0039's header, the second point).
--   This table is read by exactly one thing: the TeXML route's cap counts.
--
-- KIND, a CHECK on our own two values (0039's position on values we
-- enumerate ourselves):
--   * account-forward: voice_profiles.forward_calls (0058) sent the call to
--     accounts.transfer_phone.
--   * model-down: Sofia's SIP leg never connected and the handoff route's
--     fallback rang accounts.transfer_phone.
--   VOICE_FORWARD_TO, the deployment-wide override, is deliberately NOT
--   recorded: it runs before any number lookup, has no account to write
--   against, and bypasses the caps on purpose (.env.example: "a cap must not
--   swallow the call they are waiting for").
--
-- A ROW IS AN ATTEMPT, exactly like a calls row: written when the platform
-- hands the call to a person's phone, whether or not anyone picks up. That
-- is what the cap must count: the trunk is spent either way.
--
-- account_id NOT NULL, on delete cascade: both writers know the account
-- (the TeXML route resolved it; the fallback's signed ticket names it), and
-- a deleted account's forwarding history is about nothing. Off
-- ACCOUNT_OWNED_TABLES for that reason, like screened_calls (0039).
-- phone_number_id nullable, on delete set null: a number outlives its
-- assignment (0039's reasoning).
--
-- GRANTS ARE THE CONTROL (0039's shape): RLS on with no policy, nothing to
-- anon or authenticated, service_role select/insert/delete. The writers and
-- the reader run through serviceDb().
--
-- ADDITIVE ONLY. The build before this file never reads or writes the table.
-- The build after it READS it on every cleared inbound call (the cap
-- counts); if the table is missing that read throws, the cap block fails
-- open, the call is not cleared, and it goes to Sofia instead of being
-- forwarded. APPLY ORDER: the CI project first, then production, then
-- notify pgrst, 'reload schema', and only then the merge deploy.
--
-- No backslash and no non-ASCII byte anywhere in this file (the MCP apply
-- rule).
--
-- ROLLBACK (roll the app back first; the build after this file reads the
-- table on every cleared call):
--   drop table public.forwarded_calls;

create table public.forwarded_calls (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  phone_number_id uuid references public.phone_numbers(id) on delete set null,
  called_e164 text not null,
  caller_e164 text,
  kind text not null,
  created_at timestamptz not null default now(),
  constraint forwarded_calls_kind_check check (kind in ('account-forward', 'model-down'))
);

comment on table public.forwarded_calls is
  'Inbound calls put through to a person (accounts.transfer_phone) instead of to the receptionist: the per-account forward and the model-down fallback. One row per attempt. Read only by the TeXML route''s daily cap counts. NOT a calls row, deliberately: see 0059 header. Service-only; no client grant.';

-- The per-account cap: (account_id, created_at) prefix.
create index forwarded_calls_account_created_idx
  on public.forwarded_calls (account_id, created_at desc);

-- The per-caller cap: (account_id, caller_e164, created_at), the shape of
-- calls_caller_idx (0019).
create index forwarded_calls_caller_idx
  on public.forwarded_calls (account_id, caller_e164, created_at desc);

alter table public.forwarded_calls enable row level security;
revoke all on public.forwarded_calls from anon, authenticated;
grant select, insert, delete on public.forwarded_calls to service_role;
