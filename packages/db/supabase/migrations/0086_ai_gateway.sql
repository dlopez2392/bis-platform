-- 0086_ai_gateway.sql - one door for AI calls (first release item 8, part 8a-1)
-- (docs/superpowers/specs/2026-10-18-ai-gateway-record-summary-design.md section 3;
--  docs/superpowers/plans/2026-10-18-ai-gateway-pr8a1.md)
--
-- Every completion the app makes goes through apps/web/src/lib/ai/gateway.ts, which asks
-- ai_gate_check before it spends and calls ai_ledger_record after. ai_ledger keeps one row per
-- call: account, feature, model, tokens, estimated cost in whole micro-dollars, outcome, latency.
-- It has NO column that could hold a prompt or an output (the model id is capped at 64 characters).
-- account_ai_settings holds the account's switch, its monthly budget (cents) and two counters the
-- record function moves forward: the month's spend and today's record summaries. No row means the
-- defaults (on, 1000 cents). ai_gateway_settings is one row: the switch for every account.
-- The agency alone reads all three (clients never see a meter); nobody but service_role writes or
-- executes. Both functions are security definer with an empty search_path.
--
-- APPLY ORDER: CI project (ci-project-setup.yml: push-dry-run, then push), then production (MCP
-- apply_migration, once), then the parity check, then merge. Additive: the build before it reads
-- none of it. The build after it needs it (the gateway fails closed on a missing function, which
-- would turn every call summary into its fact line): the migration goes BEFORE the code deploy.
--
-- Rollback (by hand, in this order; revert the app first):
--   drop function public.ai_ledger_record(uuid, text, text, integer, integer, bigint, text, integer, text, text);
--   drop function public.ai_gate_check(uuid, text, text);
--   drop table public.ai_gateway_settings;
--   drop table public.account_ai_settings;
--   drop table public.ai_ledger;
--
-- ASCII only, no backslash anywhere.

-- 0. Fail fast instead of queueing behind a long lock on accounts (the two foreign keys).
set local lock_timeout = '5s';

-- 1. The ledger.
create table public.ai_ledger (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  feature text not null constraint ai_ledger_feature_check
    check (feature in ('call_summary', 'call_proposals', 'call_card', 'record_summary')),
  model text not null constraint ai_ledger_model_check check (char_length(model) between 1 and 64),
  input_tokens integer constraint ai_ledger_input_tokens_check check (input_tokens >= 0),
  output_tokens integer constraint ai_ledger_output_tokens_check check (output_tokens >= 0),
  cost_microusd bigint not null default 0 constraint ai_ledger_cost_check check (cost_microusd >= 0),
  outcome text not null constraint ai_ledger_outcome_check
    check (outcome in ('ok', 'global_off', 'account_off', 'over_budget', 'unknown_model', 'gate_unreadable', 'no_key', 'timeout', 'provider_error')),
  latency_ms integer not null default 0 constraint ai_ledger_latency_check check (latency_ms >= 0),
  created_at timestamptz not null default now()
);
create index ai_ledger_by_account on public.ai_ledger (account_id, created_at desc);
comment on table public.ai_ledger is
  'One row per AI completion or refusal (0086). Never the prompt, never the output. Written by ai_ledger_record only; the agency reads it.';

-- 2. The account's switch, budget and counters.
create table public.account_ai_settings (
  account_id uuid primary key references public.accounts(id) on delete cascade,
  enabled boolean not null default true,
  monthly_budget_cents integer not null default 1000
    constraint account_ai_settings_budget_check check (monthly_budget_cents between 0 and 100000),
  -- SIMILAR TO matches the WHOLE string, so these need no anchor characters (the byte rule).
  month_key text constraint account_ai_settings_month_key_check
    check (month_key is null or month_key similar to '[0-9]{4}-(0[1-9]|1[0-2])'),
  month_spend_microusd bigint not null default 0 constraint account_ai_settings_spend_check check (month_spend_microusd >= 0),
  day_key text constraint account_ai_settings_day_key_check
    check (day_key is null or day_key similar to '[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])'),
  record_summaries_today integer not null default 0 constraint account_ai_settings_today_check check (record_summaries_today >= 0),
  updated_by text,
  updated_at timestamptz
);
comment on table public.account_ai_settings is
  'An account''s AI switch and monthly budget (0086), and the month''s spend and today''s record summaries, moved forward by ai_ledger_record. No row means on and 1000 cents.';

-- 3. The switch for every account: one row.
create table public.ai_gateway_settings (
  id boolean primary key default true constraint ai_gateway_settings_singleton check (id),
  enabled boolean not null default true,
  updated_by text,
  updated_at timestamptz
);
insert into public.ai_gateway_settings (id, enabled) values (true, true);
comment on table public.ai_gateway_settings is
  'The one switch for AI in every account (0086). A missing row reads as OFF (fail closed).';

-- 4. Who reads: the agency, nobody else. Who writes: service_role only.
alter table public.ai_ledger enable row level security;
alter table public.account_ai_settings enable row level security;
alter table public.ai_gateway_settings enable row level security;
revoke all on public.ai_ledger, public.account_ai_settings, public.ai_gateway_settings from anon, authenticated;
grant select on public.ai_ledger, public.account_ai_settings, public.ai_gateway_settings to authenticated;
grant select, insert, update, delete on public.ai_ledger, public.account_ai_settings, public.ai_gateway_settings to service_role;
create policy ai_ledger_agency_read on public.ai_ledger for select to authenticated
  using (coalesce(app.is_agency(), false));
create policy account_ai_settings_agency_read on public.account_ai_settings for select to authenticated
  using (coalesce(app.is_agency(), false));
create policy ai_gateway_settings_agency_read on public.ai_gateway_settings for select to authenticated
  using (coalesce(app.is_agency(), false));

-- 5. The gate: both switches, the budget in micro-dollars, this month's spend and today's summaries
--    (zero when the stored key is an OLDER period; the stored values when it is a NEWER one, which
--    is a lagging instance at a boundary: it must not read a fresh budget). The global switch reads
--    OFF when its row is gone. A key that is not a real month, or a day outside it, is refused
--    (22023): a bad key stored would freeze the counters and switch the budget off for good.
create function public.ai_gate_check(p_account uuid, p_month text, p_day text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_global boolean; v_s public.account_ai_settings%rowtype;
begin
  if p_account is null or p_month is null or p_day is null then
    raise exception 'ai_gate_check: a required argument is null' using errcode = '22004';
  end if;
  if not (p_month similar to '[0-9]{4}-(0[1-9]|1[0-2])') then
    raise exception 'ai_gate_check: p_month is not a month (YYYY-MM)' using errcode = '22023';
  end if;
  if char_length(p_day) <> 10 or left(p_day, 8) <> p_month || '-'
     or not (right(p_day, 2) similar to '(0[1-9]|[12][0-9]|3[01])') then
    raise exception 'ai_gate_check: p_day is not a day of p_month (YYYY-MM-DD)' using errcode = '22023';
  end if;
  if right(p_day, 2)::integer > extract(day from (p_month || '-01')::date + interval '1 month' - interval '1 day') then
    raise exception 'ai_gate_check: p_day is past the end of its month' using errcode = '22023';
  end if;
  select g.enabled into v_global from public.ai_gateway_settings g where g.id;
  select * into v_s from public.account_ai_settings s where s.account_id = p_account;
  return jsonb_build_object(
    'global_enabled', coalesce(v_global, false),
    'account_enabled', coalesce(v_s.enabled, true),
    'budget_microusd', coalesce(v_s.monthly_budget_cents, 1000)::bigint * 10000,
    'month_spend_microusd', case when v_s.month_key >= p_month then v_s.month_spend_microusd else 0 end,
    'record_summaries_today', case when v_s.day_key >= p_day then v_s.record_summaries_today else 0 end);
end $$;
revoke all on function public.ai_gate_check(uuid, text, text) from public, anon, authenticated, service_role;
grant execute on function public.ai_gate_check(uuid, text, text) to service_role;

-- 6. The record: one ledger row, then the counters, in one transaction. A key equal to the stored
--    one adds; a NEWER key resets; an OLDER key (a late row from another instance) leaves the
--    counters alone. YYYY-MM and YYYY-MM-DD sort as text.
create function public.ai_ledger_record(
  p_account uuid, p_feature text, p_model text, p_in integer, p_out integer, p_cost bigint,
  p_outcome text, p_latency integer, p_month text, p_day text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_inc integer;
begin
  if p_account is null or p_feature is null or p_model is null or p_cost is null or p_outcome is null
     or p_latency is null or p_month is null or p_day is null then
    raise exception 'ai_ledger_record: a required argument is null' using errcode = '22004';
  end if;
  if not (p_month similar to '[0-9]{4}-(0[1-9]|1[0-2])') then
    raise exception 'ai_ledger_record: p_month is not a month (YYYY-MM)' using errcode = '22023';
  end if;
  if char_length(p_day) <> 10 or left(p_day, 8) <> p_month || '-'
     or not (right(p_day, 2) similar to '(0[1-9]|[12][0-9]|3[01])') then
    raise exception 'ai_ledger_record: p_day is not a day of p_month (YYYY-MM-DD)' using errcode = '22023';
  end if;
  if right(p_day, 2)::integer > extract(day from (p_month || '-01')::date + interval '1 month' - interval '1 day') then
    raise exception 'ai_ledger_record: p_day is past the end of its month' using errcode = '22023';
  end if;
  v_inc := case when p_feature = 'record_summary' and p_outcome = 'ok' then 1 else 0 end;
  insert into public.ai_ledger (account_id, feature, model, input_tokens, output_tokens, cost_microusd, outcome, latency_ms)
  values (p_account, p_feature, p_model, p_in, p_out, p_cost, p_outcome, p_latency);
  insert into public.account_ai_settings as s (account_id, month_key, month_spend_microusd, day_key, record_summaries_today)
  values (p_account, p_month, p_cost, p_day, v_inc)
  on conflict (account_id) do update set
    month_spend_microusd = case
      when s.month_key = p_month then s.month_spend_microusd + p_cost
      when s.month_key is null or s.month_key < p_month then p_cost
      else s.month_spend_microusd end,
    month_key = case when s.month_key is null or s.month_key < p_month then p_month else s.month_key end,
    record_summaries_today = case
      when s.day_key = p_day then s.record_summaries_today + v_inc
      when s.day_key is null or s.day_key < p_day then v_inc
      else s.record_summaries_today end,
    day_key = case when s.day_key is null or s.day_key < p_day then p_day else s.day_key end;
end $$;
revoke all on function public.ai_ledger_record(uuid, text, text, integer, integer, bigint, text, integer, text, text) from public, anon, authenticated, service_role;
grant execute on function public.ai_ledger_record(uuid, text, text, integer, integer, bigint, text, integer, text, text) to service_role;
