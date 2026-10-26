-- 0099_billing_pause.sql - the non-payment pause, Lift pause and the nightly Stripe reconciliation
-- (M7a rollout step 4; docs/superpowers/specs/2026-09-24-m7a-client-billing-design.md sections 3 flows 5-6,
--  4 and 9; docs/superpowers/plans/2026-10-26-m7a-pr4-pause-and-reconciliation.md, Task 1)
--
-- WHY. account_billing.billing_paused_at (0051) is the pause itself. Four facts it needs beside it had no
-- column: who lifted a pause and when, when Stripe last confirmed the row, what the nightly comparison of
-- usage with Stripe found, and two reasons a call is now forwarded or refused for.
--
-- WHAT THIS FILE ADDS:
--   public.account_billing.pause_lifted_at  when the agency last lifted this account's pause (Lift pause).
--     The cron pass does not pause the same unpaid stretch again: it compares this with past_due_since,
--     or with current_period_end for an ended plan. NULL = never lifted. account_billing_lift_check: never
--     on a complimentary row (a complimentary row is never paused, 0051's complimentary check).
--   public.account_billing.stripe_checked_at  when the webhook mirror last wrote what Stripe said about
--     the subscription (every mirror write sets it; the nightly step re-reads every unpaid one). A past-due
--     pause needs Stripe to have confirmed the unpaid status AFTER the 7-day grace ended and within the last
--     26 hours, so a client who paid is paused, at worst, until Stripe's webhook retry or the next nightly
--     re-read. NULL on every row before the first mirror write after this file, which only delays a pause.
--   public.billing_reconciliations  the nightly comparison per account, meter and billing period: BIS's
--     settled, in-flight and held usage, Stripe's total over the same window, and the verdict. One row per
--     period (keyed by its window_start), replaced each night while the period is current, and compared one
--     last time to the period's end on the first night after it closes.
--   forwarded_calls_kind_check and screened_calls_reason_check, each widened by billing-paused and
--     plan-no-voice (a call forwarded, or refused with a short message, because the account is paused
--     or its plan has no receptionist).
--
-- WHO WRITES. Only service_role, as for every billing table (0051): the cron pass and the agency's Lift
-- pause action (after requireAgency) write the two columns, the webhook mirror writes stripe_checked_at,
-- the nightly step writes billing_reconciliations, the TeXML route writes the two call records.
--
-- GRANTS AND POLICIES. billing_reconciliations copies 0051: revoke all from anon and authenticated (an
-- enumerated revoke would leave PG17's MAINTAIN behind), grant select to authenticated, one policy: the
-- agency reads. service_role keeps Supabase's default privileges. No table-level client write is added, so
-- the client-write digest (proposals-drop.test.ts) stays 52|b66203ca5d355155540b520af510d120 and
-- EXPECTED_WRITES in schema-grants-guard.test.ts is unchanged. The added columns change no grant.
--
-- SEARCH PATHS (0096 rule). This file creates and re-creates no function. EXPECTED_DEFINERS in
-- definer-search-path.test.ts is unchanged (23).
--
-- TEARDOWN. billing_reconciliations cascades with its account (derived state, 0051's reasoning for
-- account_billing), so it is NOT on ACCOUNT_OWNED_TABLES.
--
-- LOCKS. The ALTERs take ACCESS EXCLUSIVE on account_billing, forwarded_calls and screened_calls for the
-- length of this file; lock_timeout 5s is the protection. The added columns are nullable with no default
-- (no rewrite). The widened CHECKs are added NOT VALID and then validated, so the scan runs under SHARE
-- UPDATE EXCLUSIVE, not under the ALTER's lock.
--
-- APPLY ORDER: after 0098 everywhere. CI project (ci-project-setup.yml: push-dry-run, then push), then
-- production (MCP apply_migration, once), then the parity check, then merge.
-- LOAD-BEARING: the build after this file selects pause_lifted_at and stripe_checked_at on every in-account
-- page (the layout's billing read), every webhook delivery and every cron tick, and reads
-- billing_reconciliations on the work queue and the Billing card. PostgREST refuses a column it does not
-- know, so production gets this file BEFORE the merge deploy.
-- SAFE UNDER THE RUNNING BUILD: additive. The running build names none of these objects, and the widened
-- CHECKs accept every value it writes.
--
-- ROLLBACK (roll the app back first), in this order. Deleting reconciliation rows loses the nightly
-- comparisons (each period's last verdict); the two call-record values are records, so relabelling them
-- is an owner decision.
--   alter table public.screened_calls drop constraint screened_calls_reason_check;
--   (delete or relabel rows with reason billing-paused or plan-no-voice), then re-add 0039's six-value CHECK;
--   alter table public.forwarded_calls drop constraint forwarded_calls_kind_check;
--   (delete or relabel rows with kind billing-paused or plan-no-voice), then re-add 0059's two-value CHECK;
--   drop table public.billing_reconciliations;
--   alter table public.account_billing drop constraint account_billing_lift_check,
--     drop column stripe_checked_at, drop column pause_lifted_at;
--
-- ASCII only, no backslash anywhere, and every dollar sign in this file is part of a dollar-quote pair.

-- 0. Fail fast instead of queueing behind a long lock (0094 reason: inside a do block).
do $$
begin
  perform pg_catalog.set_config('lock_timeout', '5s', true);
end $$;

-- 1. Lift pause and the Stripe freshness stamp.
alter table public.account_billing
  add column pause_lifted_at timestamptz,
  add column stripe_checked_at timestamptz;

alter table public.account_billing
  add constraint account_billing_lift_check check (pause_lifted_at is null or not complimentary);

comment on column public.account_billing.pause_lifted_at is
  'When the agency last lifted this account''s non-payment pause (Lift pause, service_role). The cron pass does not pause the same unpaid stretch again (pause_lifted_at >= past_due_since, or >= current_period_end for an ended plan). NULL = never lifted. Never on a complimentary row (account_billing_lift_check).';
comment on column public.account_billing.stripe_checked_at is
  'When the webhook mirror last wrote what Stripe said about this subscription (set on every mirror write; the nightly step re-reads every unpaid one). A past-due pause needs it after the 7-day grace ended and within the last 26 hours. NULL until the first mirror write after 0099.';

-- 2. The nightly comparison of BIS usage with Stripe's meter totals.
create table public.billing_reconciliations (
  account_id uuid not null references public.accounts(id) on delete cascade,
  meter text not null
    constraint billing_reconciliations_meter_check check (meter in ('voice_minutes', 'sms', 'ai_chats')),
  window_start timestamptz not null,
  window_end timestamptz not null,
  bis_settled bigint not null constraint billing_reconciliations_settled_check check (bis_settled >= 0),
  bis_in_flight bigint not null constraint billing_reconciliations_in_flight_check check (bis_in_flight >= 0),
  bis_held bigint not null constraint billing_reconciliations_held_check check (bis_held >= 0),
  stripe_total numeric not null constraint billing_reconciliations_stripe_check check (stripe_total >= 0),
  verdict text not null
    constraint billing_reconciliations_verdict_check check (verdict in (
      'match', 'held_at_stripe', 'held_missing', 'stripe_over', 'stripe_under', 'ambiguous')),
  checked_at timestamptz not null default now(),
  constraint billing_reconciliations_window_check check (window_end > window_start),
  primary key (account_id, meter, window_start)
);

comment on table public.billing_reconciliations is
  'The nightly comparison of BIS usage (usage_events) with Stripe''s meter total, per account, meter and billing period (window_start is the period''s first whole minute). Replaced each night while the period is current; compared once more to the period''s end on the first night after it closes. The agency reads it (work queue, Billing card); only service_role writes.';

alter table public.billing_reconciliations enable row level security;
create policy billing_reconciliations_agency_read on public.billing_reconciliations for select to authenticated
  using ((select coalesce(app.is_agency(), false)));
revoke all on public.billing_reconciliations from anon, authenticated;
grant select on public.billing_reconciliations to authenticated;

-- 3. Two new reasons a call is forwarded or refused.
alter table public.forwarded_calls drop constraint forwarded_calls_kind_check;
alter table public.forwarded_calls add constraint forwarded_calls_kind_check
  check (kind in ('account-forward', 'model-down', 'billing-paused', 'plan-no-voice')) not valid;
alter table public.forwarded_calls validate constraint forwarded_calls_kind_check;

alter table public.screened_calls drop constraint screened_calls_reason_check;
alter table public.screened_calls add constraint screened_calls_reason_check check (reason in (
  'unknown-number', 'not-live', 'no-profile', 'profile-disabled', 'over-cap', 'repeat-spam',
  'billing-paused', 'plan-no-voice')) not valid;
alter table public.screened_calls validate constraint screened_calls_reason_check;

notify pgrst, 'reload schema';
