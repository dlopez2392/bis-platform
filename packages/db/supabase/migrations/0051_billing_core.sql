-- 0051_billing_core.sql
-- Client billing, rollout step 1 of 4
-- (docs/superpowers/specs/2026-09-24-m7a-client-billing-design.md, sections 2 and 4).
--
-- Four tables. Nothing reads them yet except the agency Plans page
-- (/dashboard/plans), which writes `plans`. No account is billed, paused or
-- gated by this file: an account with NO account_billing row is "unbilled"
-- (spec section 2), and every account starts that way. This PR writes no
-- account_billing, usage_events or stripe_webhook_events row; steps 2-4 do.
--
-- WHO WRITES WHAT. Only service_role writes any of the four. The agency's
-- writes go through serviceDb() after requireAgency() (0046's
-- automation_settings pattern), so `authenticated` holds SELECT and nothing
-- else, and on stripe_webhook_events not even that. Reads:
--   plans                  the agency only (app.is_agency()).
--   account_billing        the agency, and a client its OWN row.
--   usage_events           the agency, and a client its OWN rows.
--   stripe_webhook_events  service_role only (no policy, no grant).
-- A client's "own" is app.current_account_id(), which is NULL while the
-- account's client access is switched off (0008), so a switched-off client
-- reads nothing here, as everywhere else.
--
-- GRANTS copy 0046: `revoke all`, then grant select. Supabase's default ACL
-- hands ALL (arwdDxtm on PG17, the m being MAINTAIN, which
-- information_schema.role_table_grants does not report) to every role on a
-- new table; an enumerated revoke leaves MAINTAIN behind.
--
-- MONEY is integer cents, USD only. Meter keys are ONE vocabulary across
-- allowances, overage_cents, stripe_price_ids and usage_events.meter:
-- voice_minutes, sms, ai_chats. (The spec's usage_events line spells the
-- last one ai_chat; every other line of it says ai_chats, and one spelling
-- is the point, so ai_chat is refused.)
--
-- DELETE BEHAVIOUR. account_billing and usage_events cascade with their
-- account (derived state about the account, 0046's reasoning), so they are
-- NOT on ACCOUNT_OWNED_TABLES; billing-schema.test.ts proves the cascade
-- live. A plan referenced by any account_billing row cannot be deleted
-- (restrict): plans are archived, never deleted, and a delete that silently
-- unbilled accounts would be the worst possible failure here.
--
-- ROLLBACK (nothing reads these outside the Plans page; Stripe objects the
-- page created stay in Stripe):
--   drop table public.stripe_webhook_events;
--   drop table public.usage_events;
--   drop table public.account_billing;
--   drop table public.plans;


-- plans: what a client pays each month, what it includes, what extra use
-- costs, and the Stripe objects that bill it. A row cannot exist without its
-- Stripe product and all four prices (NOT NULL + the shape CHECK): the Plans
-- page calls Stripe FIRST and writes the row once, so there is no half-made
-- plan for step 3 to assign. A price change adds new Stripe prices and
-- rewrites stripe_price_ids; subscriptions already on the old prices keep
-- them until they are moved (spec section 2).
--
-- The jsonb CHECKs are nested CASEs on purpose: CASE evaluates in order,
-- AND does not, so the ::numeric casts only ever see a jsonb number and a
-- bad value is a 23514, never a 22P02 cast error.
create table public.plans (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references public.agencies(id),
  name text not null
    constraint plans_name_check check (name = btrim(name) and char_length(name) between 1 and 60),
  monthly_price_cents integer not null
    constraint plans_monthly_price_cents_check check (monthly_price_cents between 50 and 1000000),
  currency text not null default 'usd'
    constraint plans_currency_check check (currency = 'usd'),
  features jsonb not null
    constraint plans_features_check check (
      case
        when jsonb_typeof(features) <> 'object' then false
        when not (features ?& array['voice_receptionist', 'web_concierge']) then false
        when (features - 'voice_receptionist' - 'web_concierge') <> '{}'::jsonb then false
        else jsonb_typeof(features -> 'voice_receptionist') = 'boolean'
         and jsonb_typeof(features -> 'web_concierge') = 'boolean'
      end),
  allowances jsonb not null
    constraint plans_allowances_check check (
      case
        when jsonb_typeof(allowances) <> 'object' then false
        when not (allowances ?& array['voice_minutes', 'sms', 'ai_chats']) then false
        when (allowances - 'voice_minutes' - 'sms' - 'ai_chats') <> '{}'::jsonb then false
        when jsonb_typeof(allowances -> 'voice_minutes') <> 'number'
          or jsonb_typeof(allowances -> 'sms') <> 'number'
          or jsonb_typeof(allowances -> 'ai_chats') <> 'number' then false
        else (allowances ->> 'voice_minutes')::numeric between 0 and 1000000
         and (allowances ->> 'sms')::numeric between 0 and 1000000
         and (allowances ->> 'ai_chats')::numeric between 0 and 1000000
         and (allowances ->> 'voice_minutes')::numeric % 1 = 0
         and (allowances ->> 'sms')::numeric % 1 = 0
         and (allowances ->> 'ai_chats')::numeric % 1 = 0
      end),
  overage_cents jsonb not null
    constraint plans_overage_cents_check check (
      case
        when jsonb_typeof(overage_cents) <> 'object' then false
        when not (overage_cents ?& array['voice_minutes', 'sms', 'ai_chats']) then false
        when (overage_cents - 'voice_minutes' - 'sms' - 'ai_chats') <> '{}'::jsonb then false
        when jsonb_typeof(overage_cents -> 'voice_minutes') <> 'number'
          or jsonb_typeof(overage_cents -> 'sms') <> 'number'
          or jsonb_typeof(overage_cents -> 'ai_chats') <> 'number' then false
        else (overage_cents ->> 'voice_minutes')::numeric between 0 and 10000
         and (overage_cents ->> 'sms')::numeric between 0 and 10000
         and (overage_cents ->> 'ai_chats')::numeric between 0 and 10000
         and (overage_cents ->> 'voice_minutes')::numeric % 1 = 0
         and (overage_cents ->> 'sms')::numeric % 1 = 0
         and (overage_cents ->> 'ai_chats')::numeric % 1 = 0
      end),
  stripe_product_id text not null
    constraint plans_stripe_product_id_check check (left(stripe_product_id, 5) = 'prod_'),
  stripe_price_ids jsonb not null
    constraint plans_stripe_price_ids_check check (
      case
        when jsonb_typeof(stripe_price_ids) <> 'object' then false
        when not (stripe_price_ids ?& array['base', 'voice_minutes', 'sms', 'ai_chats']) then false
        when (stripe_price_ids - 'base' - 'voice_minutes' - 'sms' - 'ai_chats') <> '{}'::jsonb then false
        when jsonb_typeof(stripe_price_ids -> 'base') <> 'string'
          or jsonb_typeof(stripe_price_ids -> 'voice_minutes') <> 'string'
          or jsonb_typeof(stripe_price_ids -> 'sms') <> 'string'
          or jsonb_typeof(stripe_price_ids -> 'ai_chats') <> 'string' then false
        else left(stripe_price_ids ->> 'base', 6) = 'price_'
         and left(stripe_price_ids ->> 'voice_minutes', 6) = 'price_'
         and left(stripe_price_ids ->> 'sms', 6) = 'price_'
         and left(stripe_price_ids ->> 'ai_chats', 6) = 'price_'
      end),
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint plans_agency_name_key unique (agency_id, name)
);

comment on table public.plans is
  'Client billing plans (agency-scoped). Every row carries its Stripe product and four prices (base + voice_minutes/sms/ai_chats metered, graduated: allowance free, then overage_cents per unit). Written only by service_role from the agency Plans page; read by the agency only. Archived, never deleted.';

alter table public.plans enable row level security;
create policy plans_agency_read on public.plans for select to authenticated
  using (app.is_agency());
revoke all on public.plans from anon, authenticated;
grant select on public.plans to authenticated;


-- account_billing: one row per BILLED account. No row = unbilled (never
-- paused, features unchanged). complimentary = on a plan with no Stripe
-- subscription, and never paused: the CHECK makes that a fact of the
-- schema, not a promise of the pause pass (spec section 6). The status list
-- is Stripe's full set, not the spec's six, so the webhook mirror (step 3)
-- can never be refused for a status Stripe really sends. The billing pause
-- (billing_paused_at) is separate from accounts.status = 'paused', so
-- lifting one never undoes the other (spec section 2).
create table public.account_billing (
  account_id uuid primary key references public.accounts(id) on delete cascade,
  plan_id uuid not null references public.plans(id) on delete restrict,
  complimentary boolean not null default false,
  stripe_customer_id text unique
    constraint account_billing_customer_check check (stripe_customer_id is null or left(stripe_customer_id, 4) = 'cus_'),
  stripe_subscription_id text unique
    constraint account_billing_subscription_check check (stripe_subscription_id is null or left(stripe_subscription_id, 4) = 'sub_'),
  subscription_status text
    constraint account_billing_status_check check (subscription_status in (
      'incomplete', 'incomplete_expired', 'trialing', 'active', 'past_due', 'unpaid', 'canceled', 'paused')),
  current_period_end timestamptz,
  past_due_since timestamptz,
  billing_paused_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint account_billing_complimentary_check
    check (not complimentary or (stripe_subscription_id is null and billing_paused_at is null)),
  constraint account_billing_status_needs_subscription_check
    check ((subscription_status is null) = (stripe_subscription_id is null))
);

comment on table public.account_billing is
  'One row per billed account (no row = unbilled). Mirrors the Stripe subscription (status, period end) and holds the non-payment pause, separate from accounts.status. Complimentary rows have no subscription and are never paused (CHECK). Agency reads all, a client its own; only service_role writes.';

-- The plan list's client count, and the restrict check on a plan delete.
create index account_billing_plan_idx on public.account_billing (plan_id);

alter table public.account_billing enable row level security;
create policy account_billing_tenant on public.account_billing for select to authenticated
  using (app.is_agency() or account_id = app.current_account_id());
revoke all on public.account_billing from anon, authenticated;
grant select on public.account_billing to authenticated;


-- usage_events: BIS's own usage ledger (step 2 fills it). One source counts
-- once: unique (meter, source_ref), where source_ref is the call, message or
-- conversation id, all globally unique, so the key needs no account_id. A
-- voice call and a text may share nothing, but one call may be metered
-- only once as minutes.
create table public.usage_events (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  meter text not null
    constraint usage_events_meter_check check (meter in ('voice_minutes', 'sms', 'ai_chats')),
  quantity integer not null
    constraint usage_events_quantity_check check (quantity > 0),
  occurred_at timestamptz not null,
  source_ref text not null
    constraint usage_events_source_ref_check check (char_length(source_ref) between 1 and 200),
  reported_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint usage_events_meter_source_ref_key unique (meter, source_ref)
);

comment on table public.usage_events is
  'Billable usage ledger: one row per billable fact (voice_minutes, sms segments, ai_chats), unique per (meter, source_ref). reported_at is set once Stripe has the meter event. Agency reads all, a client its own; only service_role writes.';

-- Month-to-date totals per account; the report pass's queue.
create index usage_events_account_occurred_idx on public.usage_events (account_id, occurred_at desc);
create index usage_events_unreported_idx on public.usage_events (created_at) where reported_at is null;

alter table public.usage_events enable row level security;
create policy usage_events_tenant on public.usage_events for select to authenticated
  using (app.is_agency() or account_id = app.current_account_id());
revoke all on public.usage_events from anon, authenticated;
grant select on public.usage_events to authenticated;


-- stripe_webhook_events: each Stripe event id recorded once (step 3's
-- webhook). RLS on with NO policy, and no grant to anon or authenticated:
-- service_role only.
create table public.stripe_webhook_events (
  event_id text primary key
    constraint stripe_webhook_events_event_id_check check (left(event_id, 4) = 'evt_'),
  type text not null,
  received_at timestamptz not null default now(),
  processed_at timestamptz
);

comment on table public.stripe_webhook_events is
  'Stripe webhook events seen, one row per event id, so each is processed once. service_role only.';

alter table public.stripe_webhook_events enable row level security;
revoke all on public.stripe_webhook_events from anon, authenticated;
