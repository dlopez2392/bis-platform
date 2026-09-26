-- 0052_billing_checkout.sql
-- Client billing, rollout step 3 of 4
-- (docs/superpowers/specs/2026-09-24-m7a-client-billing-design.md, sections 2,
-- 3 flows 2 and 4, and 5; plan docs/superpowers/plans/2026-09-25-m7a-pr3-checkout-webhooks-billing.md).
--
-- ADDITIVE ONLY, on purpose. The CI Supabase project is shared by every
-- branch, and this file reaches it (ci-project-setup.yml) while this PR is
-- still open. Nothing here changes a column any existing code or test writes,
-- so no other branch's CI can break when it lands there first.
--
-- 1. account_billing.billing_started_at: when usage reporting starts. PR-2
--    used created_at, which is right only while a row is born with its
--    subscription. A complimentary row later paid for, or a canceled
--    subscription later replaced, keeps its created_at, and every unreported
--    row since then would be sent onto the NEW subscription. The webhook
--    mirror sets this to the subscription's own start_date whenever the
--    subscription id changes. Existing rows (none in production; test rows
--    on the CI project) take their created_at, which is exactly what PR-2
--    already reported from.
-- 2. account_billing.current_period_start: Stripe's current billing period
--    start (it lives on subscription ITEMS in API 2026-08-26.dahlia).
--    Allowances reset on the subscription's anniversary, so "312 of 500
--    minutes" is counted from here, not from the 1st of the month.
-- 3. billing_links: the Checkout link the agency sent, before any
--    subscription exists. account_billing is NOT written at link time (a row
--    there makes the account billed and starts reporting). One row per
--    account: the Stripe customer, the open Checkout session, its URL, who it
--    went to and when Stripe expires it. service_role ONLY (RLS on, no
--    policy, no grant, like stripe_webhook_events): it holds the payer's
--    email and a live payment URL, and every reader is an agency action or
--    page that has already run requireAgency().
--
-- NOT HERE, deliberately: a composite FK tying account_billing.plan_id to
-- the account's agency. It needs a NOT NULL agency_id on account_billing,
-- and every other branch's fixtures insert (account_id, plan_id) only. With
-- one agency (insertPlan and createAccount both use row #1) a crossed row
-- cannot be written today, and every writer checks plan.agency_id against
-- account.agency_id. Multi-agency (M7 #3) adds the FK with 0050's pattern.
--
-- DELETE BEHAVIOUR: billing_links cascades with its account (derived state,
-- 0051's reasoning for account_billing), so it is NOT on
-- ACCOUNT_OWNED_TABLES; billing-checkout-schema.test.ts proves the cascade
-- live. plan_id is restrict: plans are archived, never deleted.
--
-- ROLLBACK (nothing outside PR-3's code reads these):
--   drop table public.billing_links;
--   alter table public.account_billing drop column current_period_start;
--   alter table public.account_billing drop column billing_started_at;

alter table public.account_billing
  add column billing_started_at timestamptz,
  add column current_period_start timestamptz;

update public.account_billing set billing_started_at = created_at where billing_started_at is null;

alter table public.account_billing
  alter column billing_started_at set default now(),
  alter column billing_started_at set not null;

comment on column public.account_billing.billing_started_at is
  'When usage reporting starts for this account: the current Stripe subscription''s start_date (set by the webhook mirror when the subscription id changes), or the row''s creation for a complimentary row. Usage before it is never sent to Stripe.';
comment on column public.account_billing.current_period_start is
  'Start of the current Stripe billing period (from the subscription items). Usage screens count from here.';


create table public.billing_links (
  account_id uuid primary key references public.accounts(id) on delete cascade,
  plan_id uuid not null references public.plans(id) on delete restrict,
  stripe_customer_id text not null unique
    constraint billing_links_customer_check check (left(stripe_customer_id, 4) = 'cus_'),
  checkout_session_id text not null
    constraint billing_links_session_check check (left(checkout_session_id, 3) = 'cs_'),
  checkout_url text not null
    constraint billing_links_url_check check (left(checkout_url, 8) = 'https://' and char_length(checkout_url) <= 2048),
  sent_to text not null
    constraint billing_links_sent_to_check check (char_length(sent_to) between 3 and 254 and position('@' in sent_to) > 1),
  expires_at timestamptz not null,
  sent_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.billing_links is
  'The Stripe Checkout link last sent for an account, before a subscription exists (one per account). Consumed by the webhook mirror once the subscription is stored. service_role only.';

alter table public.billing_links enable row level security;
revoke all on public.billing_links from anon, authenticated;
