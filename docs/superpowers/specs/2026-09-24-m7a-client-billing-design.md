# M7a — Client billing (plans, usage, Stripe) — Design

Status: approved by danlo section by section, 2026-09-24. First of three M7 sub-projects:
**#1 client billing (this)**, #2 self-serve sign-up, #3 multi-agency / white-label SaaS (Stripe Connect). #2 and #3
build on this and get their own specs.

## 1. Decisions (danlo, 2026-09-24)

| Question | Decision |
|---|---|
| Pricing model | **Fixed tiers + usage**: 2–3 plans at fixed monthly prices, each with included allowances; usage above the allowance billed as overage |
| Metered usage | **Voice minutes** (Sofía answered calls), **SMS** (outbound segments), **AI chat conversations** (web concierge). Email is not metered |
| Non-payment | **Grace, then soft pause**: Stripe retries ~7 days with a banner; then automations + outbound texts stop, dashboard read-only, calls forwarded to the business instead of answered by Sofía; lifts on payment or by hand |
| Payment flow | **Stripe-hosted**: Checkout link emailed from the agency dashboard; Customer Portal from the client's Billing page |
| Tier shape | **Allowances + premium features**: every plan has CRM, booking, forms, texting; higher plans add Sofía voice receptionist and the web chat assistant and bigger allowances |
| Plan admin | **Plans page in the agency dashboard**; BIS creates the Stripe product/prices |
| Architecture | **A — Stripe meters**: Stripe owns subscriptions, allowances and overage maths; BIS reports usage and mirrors status via webhooks |

## 2. Data model

New tables (all RLS-enabled; grants explicit, per house rule):

- **`plans`** — agency-scoped (`agency_id`). `name`, `monthly_price_cents`, `currency` (`'usd'` only),
  `features jsonb` (`{ "voice_receptionist": bool, "web_concierge": bool }`), `allowances jsonb`
  (`{ "voice_minutes": int, "sms": int, "ai_chats": int }`), `overage_cents jsonb` (per unit, same keys),
  `stripe_product_id`, `stripe_price_ids jsonb` (`base`, `voice_minutes`, `sms`, `ai_chats`), `archived_at`,
  timestamps. A price change creates new Stripe prices; existing subscriptions keep theirs until moved.
  Agency read/write only.
- **`account_billing`** — one row per billed account (`account_id` PK/FK). `plan_id`, `complimentary bool`,
  `stripe_customer_id`, `stripe_subscription_id`, `subscription_status` (Stripe's value mirrored:
  `incomplete|trialing|active|past_due|unpaid|canceled`), `current_period_end`, `past_due_since`,
  `billing_paused_at`, timestamps. Agency full access; a client reads its own row only.
- **`usage_events`** — BIS's usage ledger. `id`, `account_id`, `meter` (`voice_minutes|sms|ai_chat`),
  `quantity int > 0`, `occurred_at`, `source_ref text` (call id / message id / conversation id),
  `reported_at`, timestamps. `unique (meter, source_ref)` — one source counts once. Agency read; client reads its
  own; writes by the service role only.
- **`stripe_webhook_events`** — `event_id` PK, `type`, `received_at`, `processed_at`. Service role only.

Reused: **`accounts.permissions`** (the account-level feature ceiling reserved for plans in the platform spec §3) —
on subscription start/plan change the plan's `features` are written into it, and voice/concierge gating reads it.
The billing pause is **`account_billing.billing_paused_at`**, kept separate from the existing manual
`accounts.status = 'paused'` so lifting one never undoes the other.

**An account with no `account_billing` row is "unbilled"**: never paused, features unchanged. `complimentary`
accounts have a plan but no Stripe subscription and are never paused.

## 3. Flows

1. **Plans page (agency)** — create/edit/archive. On save BIS creates (or, on price change, adds) the Stripe product
   and prices: a flat monthly `base` price and three metered prices on Stripe Billing Meters, each **graduated** so
   units up to the allowance cost 0 and the rest cost the overage rate.
2. **Subscribing a client (agency)** — on the account's Billing card, pick a plan → **Send billing link**: BIS
   creates the Stripe customer and a Checkout session (subscription mode, the plan's four prices) and emails the link.
   `checkout.session.completed` → `account_billing` stored, plan features written to `accounts.permissions`.
3. **Usage recording** — one `usage_events` row per billable fact, written where it already happens: an answered
   call ends → minutes rounded up; an outbound SMS is sent → its segments; a concierge conversation starts → 1.
   A cron pass reports unreported rows to Stripe meter events with the row id as the idempotency identifier.
4. **Webhook sync** — `POST /api/webhooks/stripe`: signature verified, `event_id` recorded once, then the current
   subscription is re-read from Stripe (never trusting event order) and mirrored onto `account_billing`. Handled:
   `checkout.session.completed`, `customer.subscription.created|updated|deleted`, `invoice.paid`,
   `invoice.payment_failed`.
5. **Non-payment** — `past_due` → `past_due_since` stamped, client banner, agency alert. A cron pass sets
   `billing_paused_at` when `past_due_since` is ≥ 7 days old. While paused: automations and every outbound SMS stop;
   the dashboard is read-only with a banner; the voice answer route **forwards the call to the account's existing
   handoff number** instead of connecting Sofía, or, with no handoff number, plays a short "please call back"
   message and logs the call. Payment (`invoice.paid` → active) clears the pause; the agency can lift it by hand.
6. **Cancellation** — ends at period end, then the same soft pause. Nothing is deleted.

## 4. Safety, failures, rollout

- **Test vs live**: CI, the CI Supabase project and previews use Stripe **test-mode** keys; only production holds
  live keys. The CI target guard refuses an `sk_live_` Stripe key as it refuses Clerk's `sk_live_`. A preview's
  test key is only usable once that preview has its own (non-production) database — while Preview shares
  production's database, the app itself refuses a test key there (`stripeKeyVerdict`,
  `test_key_on_production_data`), so no key belongs on Vercel Preview until then.
- **Webhooks**: signature-checked, processed once, retried by Stripe on failure.
- **Usage reporting failure**: rows stay unreported and are retried each pass; Stripe dedupes by identifier; a row
  unreported for > 24 h raises an agency alert.
- **Nightly reconciliation**: month-to-date BIS totals vs Stripe meter totals per account; any mismatch alerts.
- **Permissions**: only the agency creates plans, assigns plans, marks complimentary, or lifts a pause; a client sees
  only its own billing and opens the Stripe portal. Money in integer cents, USD only.
- **Rollout, one PR each**: (1) tables + Plans page, no effect on anyone; (2) usage recording for every account
  (ledger fills, usage screens useful at once); (3) Checkout + webhooks + Billing card and page; (4) the non-payment
  pause, behind its own switch, last.

## 5. Screens (DESIGN.md: tokens only, both themes, loaded/empty/error, plain copy)

- **Agency › Settings › Plans** (registered in ⌘K): plans list — price, allowances, features, dot+word status
  (Active/Archived), client count; New plan form (one primary: Save). Empty: "Create your first plan to start
  billing clients."
- **Agency › account › Billing card**: plan + dot+word status (Active / Payment failed / Paused / Unbilled),
  usage this month vs allowances; primary **Send billing link**; ghost actions Change plan, Mark complimentary,
  Lift pause (reversible → immediate + undo toast).
- **Client › Billing page**: plan, "your usage this month" ("312 of 500 minutes"), next invoice date,
  **Manage billing** → Stripe Customer Portal.
- **Banners**: payment failed ("Your payment didn't go through. Update your card to keep automations running." +
  link) and paused.

## 6. Testing (tier HIGH — money)

- Unit: plan → Stripe objects mapping (graduated allowances); webhook handler per event type with signed fixtures,
  duplicate and out-of-order events; pause/unpause rules; voice answer route choice (Sofía / forward / message).
- DB (CI project): usage ledger idempotency; RLS (client sees own billing only, only agency writes plans); unbilled
  and complimentary accounts are never paused.
- E2E (CI project + Stripe test mode): agency creates a plan and sends a billing link; a simulated signed webhook
  activates the subscription; the client Billing page shows plan and usage; a simulated failed payment + the 7-day
  pass pauses the fixture account and shows the banners. Stripe's hosted Checkout is not driven; its webhook is.
- Reconciliation: a deliberate mismatch raises the alert.

## 7. Out of scope

Self-serve sign-up (#2), multi-agency / Stripe Connect (#3), non-USD currencies, tax, coupons/discounts, annual plans.

## 8. External assumptions to verify at build time (not repo facts)

- Stripe Billing Meters + meter events API and graduated metered prices behave as described (current API version).
- Stripe Checkout supports a subscription mixing one licensed price and three metered prices.
- Stripe test-mode keys are available to CI as repository secrets and live keys only in Vercel production — **this
  needs a Stripe account and danlo to add the keys** (see the plan's prerequisites).
