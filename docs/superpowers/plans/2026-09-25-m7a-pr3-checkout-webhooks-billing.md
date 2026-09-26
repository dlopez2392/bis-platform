# M7a PR-3: Checkout, Webhooks, the Agency Billing Card and the Client Billing Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship rollout step (3) of M7a client billing. The agency picks a plan on an account's Billing card and presses **Send billing link**: BIS reuses or creates the account's Stripe customer, opens a Checkout session in subscription mode with the plan's four prices, and emails the link. When the client pays, Stripe's signed webhook (`POST /api/webhooks/stripe`) is recorded once, the subscription is RE-READ from Stripe, and it is mirrored onto `account_billing`, the row that makes the account "billed" (and starts usage reporting). The plan's features are written into `accounts.permissions`. The agency's Billing card shows plan, dot+word status and usage against allowances. The client's Billing page shows its plan, "312 of 500 minutes", the next invoice date and **Manage billing** (Stripe's Customer Portal). A payment-failed banner appears on every page of a past-due account.

**Architecture:** Three layers, as in PR-1 and PR-2. **Data** (`packages/db/src/account-billing.ts`) is the only code that writes `account_billing`, `billing_links` and `stripe_webhook_events`. Its core is a PURE `decideMirror` (snapshot + stored rows → the row to write, or a named refusal) and a compare-and-set `mirrorSubscription` that reads the stored row, THEN asks Stripe, decides, and writes only if the row is still the one it read (B5). **Stripe** (`apps/web/src/lib/billing/stripe-gateway.ts`) grows the Checkout, subscription, portal and webhook-verification calls behind the existing `BillingGateway` interface and `FakeGateway`. Nothing else imports the SDK. **Flows** (`lib/billing/webhook.ts`, `billing-link.ts`, `portal.ts`, `change-plan.ts`) compose those two, and thin routes and actions call them after their guard (`requireAgency`, `requireAccountAccess`, or the Stripe signature). One migration, **0052**, is additive only: `account_billing.billing_started_at` and `current_period_start`, plus a service-role-only `billing_links` table.

**Tech Stack:** Next.js 16.3.6 (App Router, server actions, route handlers), Supabase Postgres 17 (RLS), `@supabase/supabase-js`, vitest 4, Playwright, `stripe@22.6.2` (API version `2026-08-26.dahlia`), Tailwind 4 with the repo's tokens.

**Spec:** `docs/superpowers/specs/2026-09-24-m7a-client-billing-design.md`. This plan covers rollout step (3): section 3 flows 2 and 4, the permissions write (section 2 "Reused"), section 5's Billing card, client Billing page and payment-failed banner, and `past_due_since` stamping (G8). It does NOT cover the pause, its banner, the agency non-payment alert, Lift pause, nightly reconciliation, or the voice/concierge gate that reads `accounts.permissions` (all PR-4, G9 and G14).

## Global Constraints

- Tier: **HIGH** (money, a public unauthenticated endpoint, and a client-facing page). Every new assertion names, in its title, the mutation that turns it red. The reviewer applies those probes.
- **The webhook trusts only the signature and Stripe itself.** It never reads an unverified payload: it verifies `stripe-signature` on the RAW body (`request.text()`), and it never mirrors a field from the event payload. It takes one subscription id from the verified event and re-reads that subscription from Stripe (spec flow 4), so duplicate and out-of-order events converge on Stripe's current state. The write is conditional on the stored row being unchanged since BEFORE that re-read (B5), so an earlier read of Stripe can never overwrite a later one.
- **An event is recorded once.** `stripe_webhook_events.processed_at` is stamped only after the mirror finishes or is refused for good. A failure leaves the event unstamped and answers 500, so Stripe's retry processes it again, and the re-read makes a repeat harmless.
- **The account_billing row is created when the subscription EXISTS** (PR-2 G12, binding). A sent link writes only `billing_links`. Usage reporting starts at `account_billing.billing_started_at`, the subscription's own `start_date` (G1).
- Writers set `updated_at` themselves (0051 has no trigger), and every `account_billing` writer must MOVE it (it is the mirror's compare-and-set version, B5): the mirror writes at least 1 ms past the stored value (`nextVersion`); the complimentary writers write `now`, which can equal the stored value only in a same-millisecond collision with another write to that row (accepted; noted for PR-4, whose pause writer must use `nextVersion`). All writes to the billing tables go through `serviceDb()`, after `requireAgency()` (agency actions), `requireAccountAccess()` (the client's portal action), or a verified signature (webhook).
- **Stripe:** every idempotency key covers every parameter the request sends (`idempotencyKey(prefix, id, params)`, a hash of the canonical params; Task 3). Money is integer cents, USD. The app refuses a TEST key whenever `NEXT_PUBLIC_SUPABASE_URL` names production, and a LIVE key outside Vercel Production (`stripeKeyVerdict`, unchanged). The webhook also refuses an event whose `livemode` differs from the key's mode.
- **Usage screens read `usage_events`** (`sumUsageSince`), never the Activity page's counts. The Activity page counts a chat when it starts, billing counts it at Sofía's first reply, and the page says so (PR-2 binding).
- **DB tests (`packages/db`) run only in CI.** Implementers never apply migrations. 0052 goes to the CI project first (`ci-project-setup.yml`, Checkpoint A), then to production through MCP before merge, then parity (Task 13). It is additive only, so applying it to the shared CI project cannot break any other branch's CI run (G10 explains why the composite FK is NOT in it).
- Copy lives in `apps/web/src/lib/messages.ts`, in plain language, with no milestone codes (`messages.test.ts` scans every key). Copy assertions go through `renderedText`.
- UI follows DESIGN.md. Tokens only (status treatments are pinned to token classes by a test). Both themes through `.dark`. Status is a dot plus a word (`DotPill`). Loaded, empty, error and loading (skeleton) states. One primary per card or dialog (rule 8). Reversible complimentary changes run immediately with an undo toast (rule 6). New components get `/dashboard/styleguide` specimens. The settings anchor is registered in ⌘K.
- The e2e suite never touches `Test Client One`. It runs on the per-run fixture account ("E2E Client Co"). The billing spec skips loudly without `STRIPE_SECRET_KEY` or `STRIPE_WEBHOOK_SECRET`, and runs only on a `sk_test_`/`rk_test_` key.
- Gates before merge: `pnpm check`, `pnpm --filter web build`, `pnpm --filter web test:e2e`. CI runs them (`verify`, `e2e`). Read the check runs FOR THE HEAD SHA.

## Prerequisites

1. **The A11 fix is merged first** (branch `fix/usage-report-already-exists`, in flight; not re-planned here). PR-2's e2e observed that Stripe REFUSES a reused meter-event identifier under a new idempotency key ("An event already exists with identifier ..."). Until the reporter treats that refusal as already reported, such a row is never stamped and its whole account is skipped every tick. This PR creates the first billed accounts, so **PR-3 does not merge before that fix is on `main`**. The orchestrator checks this in Task 13.

   The A11 fix does NOT cover a row resent MORE than 24 hours after a send Stripe accepted (say, the send landed but the stamp failed): Stripe documents identifier uniqueness only "within a rolling period of at least 24 hours" (assumption B10), so such a row can be counted twice. PR-2's stale-usage banner flags any row unreported for 24 hours; PR-4's reconciliation is the only automatic backstop. Billing a live client before PR-4 exists is **decided (danlo, 2026-09-25): yes** (DECISION 6), and the rule is carried into Next plans.
2. `CI_STRIPE_SECRET_KEY` (a Stripe TEST key) is a repository secret already, exposed to the e2e job as `STRIPE_SECRET_KEY`. Nothing to add.
3. `STRIPE_WEBHOOK_SECRET`:
   - **CI:** a fixed literal (`whsec_bis_ci_e2e_fixture_only`), added to the e2e job's env by Task 5. It is not a secret. It lets the e2e spec sign fixture events that the e2e server accepts, and it signs nothing anywhere else.
   - **Production:** danlo creates the LIVE webhook endpoint and sets its signing secret on Vercel **Production only** (Task 13, Step 5). Until then the route answers 503 and Stripe retries.
   - **Preview:** none, while Preview shares production's database (the same rule `STRIPE_SECRET_KEY` follows).
4. `APP_ORIGIN` (existing variable) names the production origin. Checkout's success/cancel URLs and the portal's return URL use `configuredOrigin()`, falling back to the request's host.
5. The migration: 0052 applied to `bis-ci` at Checkpoint A, and to production before merge (Task 13). No other schema change.

## External facts: verified vs assumed

Verified on 2026-09-25:
- Installed `stripe` is **22.6.2** (`apps/web/node_modules/stripe/VERSION`).
- `cjs/Webhooks.d.ts:46-75`: `constructEvent(payload: string | Uint8Array, header, secret, tolerance?)`, `generateTestHeaderString({ payload, secret, timestamp? })` and its `...Async` twin, `DEFAULT_TOLERANCE`.
- Run with node against the installed package (scratch script, 2026-09-25):
  - `Stripe.webhooks` exists as a STATIC (no client or key needed), and so does `stripe.webhooks`.
  - `DEFAULT_TOLERANCE` is `300` seconds.
  - A header from `generateTestHeaderString` verifies under `constructEvent`.
  - A tampered body (one trailing space), a wrong secret, a timestamp 600 s old ("Timestamp outside the tolerance zone") and an empty header ("No stripe-signature header value was provided.") each throw an error whose `.type` is `StripeSignatureVerificationError`.
  - `Stripe.errors.StripeSignatureVerificationError` is a class.
- A scratch file typechecked `tsc --strict --noUncheckedIndexedAccess` against the installed package (exit 0). It covered:
  - `checkout.sessions.create` with `mode: "subscription"`, `customer`, `client_reference_id`, `line_items` (the base price with `quantity: 1`, the three metered prices with NO quantity), `subscription_data.metadata`, `metadata`, `success_url` and `cancel_url`. The session's `url: string | null`, `expires_at: number` and `status`. The CALL shapes of `checkout.sessions.retrieve` and `checkout.sessions.expire`. **Correction (plan review):** that scratch did NOT cover `getCheckoutSessionStatus`'s body, which narrowed `s.status` by equality and failed to compile (`Type 'OtherString' is not assignable to type 'CheckoutStatus'`); the code now widens to `string | null` first, and the correction round's scratch typecheck covers it.
  - `subscriptions.retrieve`, `.update(id, { items: [{ id, price }], proration_behavior: "create_prorations", metadata }, { idempotencyKey })`, `.create` and `.cancel`.
  - Period fields: `SubscriptionItem.current_period_start`/`current_period_end` (`SubscriptionItems.d.ts:54,58`). **In this API version the period lives on the ITEMS, not on the Subscription.** `Subscription.start_date` (`Subscriptions.d.ts:249`), and `customer: string | Customer | DeletedCustomer`.
  - `Invoice.parent.subscription_details.subscription` (`Invoices.d.ts:651,856`). There is no top-level `invoice.subscription` in this version.
  - `billingPortal.configurations.list({ active, limit })` → `has_more`/`data[].metadata`, and `.create({ features: { invoice_history, payment_method_update, customer_update, subscription_cancel, subscription_update }, metadata })`. `billingPortal.sessions.create({ customer, return_url, configuration })` → `url: string`.
  - `paymentMethods.attach("pm_card_visa", { customer })`.
  - `Stripe.Event` narrowing by `event.type` for the six handled types.
- This plan's `account-billing.ts` (Task 2), extracted verbatim, typechecks `tsc --strict --noUncheckedIndexedAccess` (exit 0) against the installed `@supabase/supabase-js`, with a stub `./billing` carrying 0051's types. That check found one real defect, now fixed: a `+`-concatenated select string types rows as `GenericStringError`, so column lists stay single literals.
- `Subscription.Status` and `Checkout.Session.Status` both end in `| OtherString`. A status BIS does not know must be refused, not cast (0051's CHECK would reject it anyway).
- The raw body: `api/webhooks/resend/route.ts` reads `await request.text()` before verifying (svix), and its test calls `POST(new Request(...))` directly. `apps/web/src/proxy.ts:3` protects only `/dashboard(.*)`, so `/api/webhooks/stripe` and `/billing-done` are public.
- On this machine's Node 24:
  - `Intl.DateTimeFormat("en-US", { timeZone: "America/Chicago", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })` formats 2026-10-16T20:30Z as `Oct 16, 3:30 PM`.
  - `en-CA` `formatToParts` gives year/month for the zone (2026-10-01T03:00Z is still `09` in Chicago).
  - `(1200).toLocaleString("en-US")` is `1,200`.
  - Some ICU builds put U+202F before AM/PM, so `formatMoment` normalises it (Task 6).
- `accounts.permissions` is `jsonb not null default '{}'` (`0001_tenancy.sql:28`). **Nothing reads or writes it today.** Voice and concierge gating read `voice_profiles.enabled` and `concierge_enabled` (`packages/db/src/concierge.ts:27-31`).
- `accounts` has no billing or owner email column. `reply_to_email` (0014) and `report_emails text[]` (0031) exist.
- `getEmailProvider()` returns the FAKE provider everywhere but Vercel Production (`lib/email/index.ts`), so CI and e2e never send mail.
- `ci-workflow.test.ts:150-163` allowlists every `secrets.X` the workflow may read. A literal env value is not a secret reference, so the webhook literal needs no allowlist entry, only its own pinning test (Task 5).
- The Plans page and the Billing card read Stripe's key state through `stripeKeyVerdict` (`plans/page.tsx`). `billingGatewayFromEnv` builds the client with `maxNetworkRetries: 2, timeout: 20_000`.

Assumptions (not verified; each names what settles it):
- **B1.** Checkout accepts one licensed price plus three metered prices (without quantity) in one subscription-mode session (spec section 8). **Task 12's e2e retrieves the real test-mode session with `line_items` and asserts four.**
- **B2.** A Checkout session lives 24 hours by default. The code never assumes this: it stores Stripe's own `expires_at`.
- **B3.** A portal configuration created by API with only `features` + `metadata` is usable in test and live mode. **Task 12's e2e clicks Manage billing and lands on `billing.stripe.com`.**
- **B4.** Swapping each subscription item's price in place mid-period (Change plan) prorates the base price and prices the WHOLE period's meter usage at the new metered prices at period end, because a meter aggregates per customer per meter, not per price. Unverified. It decides what DECISION 2 means in money, and the e2e does not settle it. **Decided on it anyway (danlo, 2026-09-25): danlo accepted the risk** of Change plan "now" resting on this unverified assumption. It is settled on a Stripe test clock before the first live mid-month Change plan (Next plans).
- **B5. Stripe's delivery order is not relied on, and neither is timing between two deliveries.** Two deliveries for one account processed at once each re-read Stripe, and the one that reads EARLIER can reach the database LATER. The first draft accepted that as "a window of milliseconds". The plan review showed it is not: the stale write STICKS until the next event for that subscription, possibly next month's invoice. Example: `customer.subscription.created` reads `incomplete`, `invoice.paid` reads `active` and writes, then the first writes `incomplete`; the card and the client then say Payment failed for a month, and PR-4 would pause a paying client on that state. The same shape lets a late delivery for an old subscription overwrite a just-stored new one. **Engineered around, not accepted:** the mirror is compare-and-set (G5, Task 2). It reads the stored row BEFORE asking Stripe and writes only while the row still carries that `updated_at`. With no row it inserts, and a 23505 is the same conflict. On a conflict it re-reads the row, then Stripe, and tries again, at most `MIRROR_ATTEMPTS` (3) times, then throws (500, Stripe retries). A REFUSAL is returned only if the row is still the one read before Stripe was asked; otherwise it is a conflict too (the second review's first-checkout burst: another delivery inserts the row and consumes the link in between, and the stale attempt would have refused `customer_mismatch` over an `incomplete` row). **What is guaranteed is the ROW** (its status, plan, customer, periods): the permissions write and the link cleanup follow it outside the compare-and-set, so two racing deliveries can leave `accounts.permissions` from the older one. That is rare and harmless in PR-3 (nothing reads permissions yet, G9); PR-4 closes it before enforcing them (Next plans (b)). The first checkout's burst may therefore answer one or two 500s that succeed on Stripe's retry (runbook). Task 2's unit tests pin the order and the condition, the refusal re-check, the 23505 path and the give-up, and its live replay test proves the `updated_at` round trip through PostgREST. Still unverified (external): whether a Checkout-created subscription passes through `incomplete` at all. The `past_due`↔`active` race exists either way.
- **B6.** Stripe retries a non-2xx delivery with backoff for up to three days in live mode (Stripe docs, not re-read today).
- **B7.** The live endpoint is created pinned to `2026-08-26.dahlia` (Task 13, Step 5). The code ALSO reads a legacy top-level `invoice.subscription`, so an endpoint on an older version still maps invoices.
- **B8.** A subscription's `items` list holds all four items in one page. The code throws on `has_more` rather than guess.
- **B9.** `redirect()` to an absolute external URL from a server action works in Next 16 (documented behaviour). **Task 12's portal click proves it.**
- **B10.** Stripe documents a meter event's `identifier` as unique only "within a rolling period of at least 24 hours" (Stripe docs, not re-read today). A usage row resent more than 24 hours after a send Stripe accepted may be counted twice. Nothing in PR-3 settles it. PR-4's reconciliation is the backstop. **Decided (danlo, 2026-09-25, DECISION 6): a live client IS billed before then**, with the manual invoice check while the stale-usage banner shows (runbook rule 2).
- **B11.** Stripe's failed-payment behaviour is a dashboard setting, not code. It covers the retry schedule ("Smart Retries" is Stripe's default), what happens after the last retry (cancel the subscription, mark it unpaid, or leave it past due), and whether Stripe emails the customer receipts and failed-payment notices. The menu names and the default schedule are from Stripe's docs, not re-read today. The chosen values decide which statuses the mirror sees (`past_due` → `unpaid` or `canceled`), so they are set before the first live client pays (Task 13, Step 5). **Decided (danlo, 2026-09-25, DECISION 7): Smart Retries, then mark the subscription unpaid (never auto-cancel), Stripe's receipts and failed-payment emails on.**

## Spec gaps resolved here (the reviewer should confirm or overrule)

- **G1. The billed row, and when reporting starts.** `account_billing` is written ONLY by the webhook mirror when a subscription exists, or by Mark complimentary. The link writes `billing_links`. PR-2 read the reporting floor from `created_at`. That is wrong in two cases this PR makes reachable:
  - **complimentary → paid:** the row already exists, so the floor would be the complimentary start;
  - **canceled → re-subscribed:** the floor would be the first subscription's start.

  In both cases usage from before the paid subscription would be reported onto it. PR-2's G12 allowed "move the floor to a dedicated column", so 0052 adds `billing_started_at`:
  - the mirror sets it to the subscription's `start_date` whenever the subscription id CHANGES, and keeps it for the same subscription;
  - `listBilledUsageAccounts` reads it (Task 2, one line, plus its two tests).
- **G2. Before the subscription: `billing_links`.** One row per account, service-role only:
  - It holds the Stripe customer, the Checkout session id and URL, the recipient and Stripe's `expires_at`.
  - **At most one open session per account.** Send:
    1. refuses when the account has a live subscription;
    2. reads the previous session's status and refuses when it is `complete` (the client already paid, the webhook is on its way);
    3. EXPIRES it when `open`, and marks the row expired first, so a failure below never leaves a dead link shown as live;
    4. only then creates the new session.

    The save is optimistic on the previous session id. A second tab that raced it loses, expires its own new session and says "Something changed".
  - Two open sessions would let a client pay twice. The mirror would then refuse the second subscription (G7), but Stripe would still be billing it, so prevention is the design and the refusal is only the backstop.
- **G3. The customer.** Reused from `account_billing.stripe_customer_id`, then `billing_links.stripe_customer_id`, else created:
  - Created with `name` = the client's customer-facing brand name (never `accounts.name`, the agency's private label), `email` = the recipient, and metadata `bis_account_id`.
  - The key is `idempotencyKey("bis-customer", accountId, params)`, so a retry with the same inputs within 24 hours replays the same customer.
  - A customer made just before a failed session creation, and retried more than 24 hours later, is an orphan in Stripe. It is harmless: no session, no subscription.
  - **Invariant: once `account_billing` holds a customer, the account's customer never changes.** The first draft rested this on Send's lookup ORDER alone. `decideMirror` accepted a subscription on the stored OR the linked customer and then overwrote `stripe_customer_id`, and no test pinned the order. Now it is enforced twice:
    - the mirror refuses a subscription on any other customer, the pending link's included, as `customer_changed` (G7);
    - a `billing-link.test.ts` case pins that the stored customer wins over a link that names another.
  - **A manual customer change** is SQL only, for example after a customer is deleted in Stripe. It must SETTLE FIRST. The usage reporter must have sent every usage row of the account (none left unstamped), because anything reported after the change is billed to the new customer. Rows Stripe already holds under the old customer stay there, including those stamped as duplicates by the A11 fix. Then change `account_billing.stripe_customer_id`, delete the account's `billing_links` row, and send a new link. The runbook (Task 13, Step 8) carries this rule.
- **G4. The webhook pipeline** (`route.ts` → `processStripeEvent`):
  1. The secret is set, else 503.
  2. Verify the raw body, else 400; nothing is read before this.
  3. The Stripe key is usable (`billingGatewayFromEnv`), else 503.
  4. `event.livemode` matches the key, else 400, not recorded. Stripe retries every non-2xx, this 400 included. Each retry is refused the same way, which is harmless: nothing is recorded.
  5. Claim the event (`insert ... on conflict do nothing`): `new`, `retry` (stored but never stamped) or `done`.
  6. `done` → 200 "duplicate", no Stripe read.
  7. No subscription in the event (an unhandled type, or a payment-mode checkout) → stamp → 200 "ignored".
  8. `mirrorSubscription` → stamp → 200 "processed" or "refused". The mirror reads Stripe once to learn the account. Then, per attempt, it reads the stored row, re-reads the subscription from Stripe, and writes only if the row is unchanged (G5, B5).
  9. A throw anywhere in 5-8 → NOT stamped → 500, and Stripe retries. This includes a mirror that lost `MIRROR_ATTEMPTS` races in a row.
- **G5. Duplicates and out-of-order events** need no ordering logic: nothing from the payload is mirrored. An `updated` arriving after `deleted` re-reads the subscription, which is `canceled`, and writes `canceled`. **Concurrent deliveries** are handled by compare-and-set (B5). The row's `updated_at` is the version: read before Stripe is asked, and required unchanged at the write. `decideMirror` moves `updated_at` at least 1 ms past the stored value, so two writes in one millisecond can never look like no write. A delivery that loses re-reads the row and Stripe and tries again, and a refusal counts only while the row is unchanged. So the ROW stored last is always from the LATEST read of Stripe. The permissions write and the link cleanup are outside that guarantee (B5): rare, harmless in PR-3, closed by PR-4 before it enforces permissions.
- **G6. The plan comes from the subscription's BASE PRICE metadata** (`bis_plan_id`, set on every price by PR-1's `priceCreateParams`). It does not come from `plans.stripe_price_ids`, because a price change rewrites those ids while existing subscriptions keep their old prices (spec section 2), and a lookup by price id would lose them.
- **G7. Three mirror guards, each a named refusal** (stamped, logged, 200, never retried, because retrying cannot fix it):
  - `customer_changed`: the account's billed row already holds a customer, and the subscription is on a DIFFERENT one, the pending link's included. The stored customer is the account's for good (G3).
  - `customer_mismatch`: the account has no stored customer, and the subscription's customer is not the pending link's. So a subscription made by hand in the Stripe dashboard with a guessed `bis_account_id` never lands on an account.
  - `another_live_subscription`: a different subscription id arriving while the stored one is not ended.

  The other refusals are `no_account`, `unknown_account`, `unknown_plan`, `plan_other_agency` and `unknown_status`.
- **G8. `past_due_since` IS stamped here** (decided). The mirror sets it to `now` the first time it reads `past_due` or `unpaid`, keeps the earlier stamp while the status stays unpaid, and clears it on any other status. PR-4's pause reads it. In this PR it drives only the payment-failed banner and the card's status, both of which need the status anyway, and stamping it where the status is mirrored avoids a second writer in PR-4.
- **G9. Permissions are WRITTEN, not ENFORCED, in this PR.**
  - On every mirror, and on every complimentary change, `accounts.permissions` becomes EXACTLY `{ voice_receptionist, web_concierge }` from the plan. The column is reserved for plans (platform spec section 3), and nothing else writes it (verified).
  - Stop complimentary resets it to `{}`, the unbilled state ("features unchanged").
  - Nothing reads it yet. The gate belongs with PR-4, where the voice answer route already gains its three-way choice (Sofía / forward / message, spec section 6), and where a plan without the receptionist gets its turn-off behaviour designed once. Shipping a reader here would change live calls for accounts whose plan lacks the receptionist on the day this merges.
- **G10. The composite FK (`account_billing.plan_id` ↔ the account's agency): DEFERRED to M7 #3 (multi-agency), enforced in the writers now.**
  - The FK needs a NOT NULL `agency_id` column on `account_billing`. The CI project is SHARED: once 0052 is on it, every other branch's db suite would fail its existing `insert into account_billing (account_id, plan_id)` fixtures until this PR merged.
  - There is exactly one agency (`insertPlan` and `createAccount` both use agency row #1), so a crossed row cannot be written today.
  - Every writer here checks `plan.agencyId === account.agencyId` (`decideMirror`, `markComplimentary`, `changeComplimentaryPlan`, and the Send and Change-plan actions BEFORE they call Stripe). A test pins each check.
  - M7 #3, which builds the second agency, adds the FK with 0050's pattern.
- **G11. `countBilledAccountsByPlan` pages until an empty page** (PR-1 final review, binding) before the first billed row exists.
- **G12. What "this month" means on the usage screens.**
  - For a subscribed account it is the CURRENT BILLING PERIOD, from Stripe's `current_period_start` (0052 stores it), because allowances reset on the subscription's anniversary, not on the 1st.
  - For complimentary and unbilled accounts it is the calendar month in the account's own zone.
  - The label always says which ("Since Oct 12").
  - Chats carry the one-line note "A website chat counts once Sofía first replies", so no one reconciles it against the Activity page's count (PR-2 binding).
- **G13. Seven status words** (dot + word, `BILLING_STATUS_TREATMENTS`):

  | Word | Stored state |
  |---|---|
  | Active | `active`, `trialing` |
  | Payment failed | `past_due`, `unpaid`, `incomplete` (first payment not through; the card says it, the banner does not, G21) |
  | Paused | `billing_paused_at` set (PR-4), or Stripe's own `paused` |
  | Canceled | `canceled`, `incomplete_expired` |
  | Complimentary | `complimentary` |
  | Link sent | no row, and an unexpired link |
  | Unbilled | no row, and no live link |

  The spec named four. The other three are facts the card must not hide.
- **G14. Lift pause ships with the pause (PR-4).** Nothing sets `billing_paused_at` in this PR, so the card never offers it, although the status mapping already covers Paused. The agency's non-payment alert and the paused banner are PR-4's too (spec flow 5).
- **G15. Change plan:**
  - Complimentary: a database change, applied immediately with an undo toast.
  - Subscribed: each item's price is swapped in place (`planChangeItems` maps base→base and each meter→its meter, and refuses anything else) with `proration_behavior: "create_prorations"` (Stripe's default, stated explicitly). Then the fresh subscription is mirrored at once, so the card is right before the webhook arrives. The key is `idempotencyKey("bis-subchange", requestId, change)`, where `requestId` is minted when the dialog opens, so a double click replays and an A→B→A sequence does not. No undo toast here: undoing is another prorated change, so the dialog is the decision.
  - Offered, and accepted by the action, only on a live subscription that is NOT `incomplete`: before the first payment is through, Stripe may refuse item updates.
  - Change plan applies NOW, with proration: **decided (danlo, 2026-09-25, DECISION 2)**, on the unverified B4.
- **G16. Mark complimentary** appears only when the account is Unbilled (no row, no live link): 0051's CHECK forbids complimentary with a subscription, and an open link could otherwise convert it back to paid behind the agency's back. It is a dialog to pick the plan, then immediate + Undo (the undo is Stop complimentary). **Stop complimentary** deletes the row and resets permissions, with Undo re-marking the same plan.
- **G17. Checkout's success and cancel pages** are one public page, `/billing-done?result=success|cancelled`. It uses `AuthShell` and the platform's mark: the payer is not signed in, so no tenant can be identified (DESIGN rule 9's sign-in exception, same reason).
- **G18. The billing-link email** is sent from BIS in BIS's own branding (`BIS_BRANDING`, the weekly agency report's precedent), with reply-to `AGENCY_SUPPORT_EMAIL`: **decided (danlo, 2026-09-25, DECISION 1)**.
  - The agency types the recipient; the dialog pre-fills `reply_to_email`, else the first `report_emails`.
  - The URL is in both the HTML and the text part.
  - If the email fails, the link is still saved and the card shows **Copy link**, so the agency can send it another way.
- **G19. The Customer Portal configuration is created by code on first use** (`ensurePortalConfiguration`: find an active configuration with metadata `bis_portal = v1`, else create one under a params-hash key). No dashboard step is needed in either mode. Its features are **update card + invoice history only**; no self-cancel and no plan switching: **decided (danlo, 2026-09-25, DECISION 3)**.
- **G20. The client's Billing page** is a client-only nav item (like Branding: the agency reaches billing through Settings). Before the account is billed it shows an empty state: **decided (danlo, 2026-09-25, DECISION 4)**. A complimentary account sees its plan and usage, with no Manage billing.
- **G21. The payment-failed banner** is mounted in the account layout, so it is on every page of that account. It shows only for `past_due` and `unpaid` (`showsPaymentFailedBanner`). It never shows for `incomplete`: a first payment still in progress has not failed, and "Your payment didn't go through" would be false. Its two audiences:
  - the client copy is the spec's ("Your payment didn't go through. Update your card to keep automations running." + a link to the Billing page);
  - the agency, inside the same account, sees "This client's last payment didn't go through." + a link to the Billing card.

  A failed billing read logs and renders no banner: the layout must never go down with billing.
- **G22. Trials: none**, **decided (danlo, 2026-09-25, DECISION 5)**. Checkout charges the first month's base price at signup.
- **G23. Cancellation** is mirrored as Canceled; features are unchanged. The soft pause that follows cancellation, and whether usage after it reaches Stripe, are PR-4's (binding 8). The reporter is untouched here.
- **G24. The CI webhook secret is a literal, in the e2e job only.** It is pinned by a `ci-workflow.test.ts` case, like `STRIPE_SECRET_KEY`.

## File Structure

40 files created, 22 modified (62 total). `...` below is `apps/web/src/app/(dashboard)/dashboard`.

**packages/db**

Created:
- `supabase/migrations/0052_billing_checkout.sql`: `billing_started_at`, `current_period_start`, and `billing_links`.
- `src/account-billing.ts`: the only writer of `account_billing`, `billing_links` and `stripe_webhook_events`. Pure `decideMirror`.
- `src/account-billing.test.ts` (17, no database).
- `src/test/account-billing.test.ts` (4, live).
- `src/test/billing-checkout-schema.test.ts` (11, live).
- `src/billing.test.ts` (1, no database).

Modified:
- `src/billing.ts`: `countBilledAccountsByPlan` pages until empty.
- `src/usage.ts`: `listBilledUsageAccounts` reads `billing_started_at`; new `sumUsageSince`.
- `src/usage.test.ts`: +1, 1 edited.
- `src/test/usage.test.ts`: the `bill()` helper and one title.
- `src/account-teardown.ts`: comment only.
- `src/index.ts`: exports.

**apps/web: Stripe and the flows**

Modified:
- `lib/billing/stripe-gateway.ts`: Checkout, subscription, portal and webhook-verification surface; `idempotencyKey`; `live` on the gateway verdict.
- `lib/billing/fake-gateway.ts`.
- `lib/billing/stripe-gateway.test.ts` (+8).

Created:
- `lib/billing/stripe-webhook.test.ts` (3): webhook verification on the REAL SDK, in its own file because `stripe-gateway.test.ts` mocks the `stripe` module.
- `lib/billing/webhook.ts` and `webhook.test.ts` (7).
- `lib/billing/billing-view.ts` and `billing-view.test.ts` (9).
- `lib/billing/billing-link.ts` and `billing-link.test.ts` (9).
- `lib/billing/change-plan.ts` and `change-plan.test.ts` (2).
- `lib/billing/portal.ts` and `portal.test.ts` (3).
- `lib/email/templates/billing-link.ts` and `billing-link.test.ts` (3).
- `app/api/webhooks/stripe/route.ts` and `route.test.ts` (6).

**apps/web: screens**

Created:
- `.../accounts/[accountId]/settings/billing-actions.ts` and `billing-actions.test.ts` (8).
- `.../settings/billing-section.tsx` and `billing-section.test.ts` (3).
- `.../settings/billing-card.tsx` and `billing-card.test.ts` (5).
- `.../accounts/[accountId]/billing/page.tsx`, `page.test.ts` (4) and `loading.tsx`.
- `.../billing/actions.ts` and `actions.test.ts` (3).
- `.../billing/manage-billing-button.tsx`.
- `components/billing-banner.tsx` and `billing-banner.test.ts` (3).
- `.../accounts/[accountId]/layout.test.ts` (2).
- `app/(dashboard)/billing-done/page.tsx` and `page.test.ts` (2).

Modified:
- `.../settings/page.tsx`: mounts the section.
- `.../accounts/[accountId]/layout.tsx`: the banner.
- `lib/messages.ts`.
- `lib/nav-groups.ts` and `nav-groups.test.ts` (+1).
- `components/app-sidebar.tsx`.
- `lib/palette/registry.ts` and `registry.test.ts` (+1).
- `.../styleguide/page.tsx`.

**CI, env, e2e**

Modified:
- `.github/workflows/ci.yml`: the e2e job's `STRIPE_WEBHOOK_SECRET` literal.
- `apps/web/ci/ci-workflow.test.ts` (+1).
- `.env.example`.
- `apps/web/e2e/fixtures/sweep.ts`: comment only (e2e now creates billing rows).

Created:
- `apps/web/e2e/billing.spec.ts` (2).
- `docs/runbooks/stripe-billing.md`: the live setup, the failed-payment settings, the customer invariant and the >24 h resend rule (Task 13, Step 8).

**New test count: 119** = db 15 live + 19 unit, web 83, e2e 2 (itemised in Task 13, Step 1). `it.each` is not used; each `it` is one test.

## Task order and checkpoints

13 tasks and 1 orchestrator checkpoint:

1. Migration 0052 and its live proof (bis-db-schema)
   **Checkpoint A (orchestrator only):** 0052 to `bis-ci` through `ci-project-setup.yml`; push; `verify` runs the db suite there; mutation probes.
2. `account-billing.ts`, the reporting floor, the paged counts, `sumUsageSince` (bis-db-schema)
3. The gateway: customers, Checkout, subscriptions, the portal, webhook verification
4. `processStripeEvent`
5. `POST /api/webhooks/stripe` and the CI fixture secret
6. The copy and `billing-view.ts`
7. The billing link (email + `sendBillingLink`), `planChangeItems`, the portal helper
8. The agency's billing actions
9. The agency Billing card and its ⌘K entry
10. The client Billing page, Manage billing, the nav entry
11. The payment-failed banner, `/billing-done`, the styleguide
12. e2e (bis-e2e-qa)
13. Gates, counts, production migration, Stripe live setup, handoff

Dependencies:
- Task 2 needs Task 1's columns only at RUN time (CI), not to compile.
- Task 3 needs Task 2's types.
- Tasks 4 and 7 need Task 3.
- Task 5 needs Task 4.
- Task 7 needs Task 6.
- Task 8 needs Task 7.
- Task 9 needs Tasks 6 and 8.
- Task 10 needs Tasks 6 and 7.
- Task 11 needs Task 6.
- Task 12 needs everything.

Parallel lanes, on disjoint files:
- {4, 5} and {6} run in parallel after Task 3.
- {9}, {10} and {11} run in parallel after Task 8. They touch different files, except `registry.ts`: Task 9 edits `SETTINGS_SECTIONS` and Task 10 edits `NAV_KEYWORDS`. Merge those two by hand if both lanes land together.

Commands run from the repo root `C:\Users\danlo\bis-platform` (Git Bash).

---

### Task 1: Migration 0052 (billing start, period start, `billing_links`) and its live proof

**Owner:** bis-db-schema. Writes the migration and its tests; **never applies it** (Checkpoint A does, on the CI project only).

**Files:**
- Create: `packages/db/supabase/migrations/0052_billing_checkout.sql`
- Create: `packages/db/src/test/billing-checkout-schema.test.ts` (live, CI only)
- Modify: `packages/db/src/account-teardown.ts` (the comment block that explains which billing tables are off `ACCOUNT_OWNED_TABLES`: add `billing_links`, same reason)

**Interfaces:**
- Consumes: 0051's `account_billing`, `plans`, `accounts`; `withRollback`, `actAs` (`src/test/db.ts`); `withTestAccount` (`src/test/fixtures.ts`); `serviceDb`.
- Produces (used by Task 2):
  - `account_billing.billing_started_at timestamptz not null default now()`
  - `account_billing.current_period_start timestamptz` (nullable)
  - `public.billing_links (account_id pk → accounts on delete cascade, plan_id → plans on delete restrict, stripe_customer_id unique 'cus_', checkout_session_id 'cs_', checkout_url 'https://', sent_to, expires_at, sent_at, created_at, updated_at)`: service_role only.

- [ ] **Step 1: Write the failing tests**

Create `packages/db/src/test/billing-checkout-schema.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import type { Client } from "pg";
import { withRollback, actAs } from "./db";
import { withTestAccount } from "./fixtures";
import { serviceDb } from "../service";

/**
 * 0052 (M7a billing, rollout step 3) at the level that can see it: real SQL
 * in a rolled-back transaction for grants and constraints, and serviceDb()
 * under withTestAccount for the account-delete cascade. Money tier: every
 * test names the mutation that turns it red.
 */
const RUN = Math.random().toString(36).slice(2, 10);
const orgId = (label: string) => `org_BLINK_${label}_${RUN}`;
const PRICE_IDS = { base: "price_t_base", voice_minutes: "price_t_vm", sms: "price_t_sms", ai_chats: "price_t_ai" };
const FEATURES = { voice_receptionist: true, web_concierge: false };
const ZERO = { voice_minutes: 0, sms: 0, ai_chats: 0 };

type Seeded = { a: string; b: string; plan: string };

async function seed(c: Client): Promise<Seeded> {
  const { rows: [agency] } = await c.query<{ id: string }>("select id from agencies limit 1");
  const mk = async (label: string) => (await c.query<{ id: string }>(
    "insert into accounts (agency_id, clerk_org_id, name, client_access_enabled) values ($1,$2,$3,true) returning id",
    [agency!.id, orgId(label), `Link ${label}`])).rows[0]!.id;
  const a = await mk("A");
  const b = await mk("B");
  const plan = (await c.query<{ id: string }>(
    `insert into plans (agency_id, name, monthly_price_cents, features, allowances, overage_cents,
                        stripe_product_id, stripe_price_ids)
       values ($1, $2, 4900, $3, $4, $4, 'prod_t_link', $5) returning id`,
    [agency!.id, `Link plan ${RUN}`, JSON.stringify(FEATURES), JSON.stringify(ZERO), JSON.stringify(PRICE_IDS)],
  )).rows[0]!.id;
  return { a, b, plan };
}

const LINK_SQL = `insert into billing_links
  (account_id, plan_id, stripe_customer_id, checkout_session_id, checkout_url, sent_to, expires_at)
  values ($1, $2, $3, $4, $5, $6, now() + interval '1 day')`;
const linkParams = (s: Seeded, over: Partial<Record<"account" | "customer" | "session" | "url" | "to", string>> = {}) => [
  over.account ?? s.a, s.plan, over.customer ?? `cus_t_${RUN}`, over.session ?? `cs_test_${RUN}`,
  over.url ?? "https://checkout.stripe.com/c/pay/cs_test_x", over.to ?? "owner@example.com",
];

/** One statement expected to fail, inside a savepoint so the transaction
 *  survives for the next one (a failed statement aborts a Postgres txn). */
async function refused(c: Client, sql: string, params: unknown[]): Promise<unknown> {
  await c.query("savepoint probe");
  try {
    await c.query(sql, params);
    return null;
  } catch (e) {
    return e;
  } finally {
    await c.query("rollback to savepoint probe");
  }
}

const denied = (table: string) => ({
  code: "42501",
  message: expect.stringMatching(new RegExp(`permission denied for table ${table}`, "i")),
});

// Same house shape as billing-schema.test.ts's stripe_webhook_events block:
// service_role holds every privilege, authenticated and anon hold none at
// all (not just refused by RLS — no grant to refuse in the first place).
const SERVICE_ROLE_ALL = ["DELETE", "INSERT", "REFERENCES", "SELECT", "TRIGGER", "TRUNCATE", "UPDATE"]
  .map((privilege_type) => ({ grantee: "service_role", privilege_type }));

describe("0052 billing_links: grants, anon and RLS (house pattern from stripe_webhook_events)", () => {
  it("billing_links: anon holds nothing (mutation: drop the revoke from anon → FAILS)", () =>
    withRollback(async (c) => {
      const { rows } = await c.query(
        `select privilege_type from information_schema.role_table_grants
           where table_schema = 'public' and table_name = 'billing_links' and grantee = 'anon'`);
      expect(rows).toEqual([]);
    }));

  it("billing_links: neither authenticated nor anon holds MAINTAIN (mutation: enumerate the revoke like 0025 → FAILS)", () =>
    withRollback(async (c) => {
      const { rows } = await c.query<{ auth: boolean; anon: boolean }>(
        `select has_table_privilege('authenticated', 'public.billing_links', 'MAINTAIN') as auth,
                has_table_privilege('anon', 'public.billing_links', 'MAINTAIN') as anon`);
      expect(rows[0]).toEqual({ auth: false, anon: false });
    }));

  it("billing_links: the whole grant set across every role but postgres is exactly service_role's default ACL (mutation: grant select on billing_links to authenticated → FAILS; also catches service_role missing UPDATE or DELETE)", () =>
    withRollback(async (c) => {
      const { rows } = await c.query(
        `select grantee, privilege_type from information_schema.role_table_grants
           where table_schema = 'public' and table_name = 'billing_links' and grantee <> 'postgres'
           order by grantee, privilege_type`);
      expect(rows).toEqual(SERVICE_ROLE_ALL);
    }));

  it("billing_links: row level security is on (mutation: drop its enable row level security → FAILS)", () =>
    withRollback(async (c) => {
      const { rows } = await c.query<{ relrowsecurity: boolean }>(
        `select relrowsecurity from pg_class where oid = 'public.billing_links'::regclass`);
      expect(rows[0]!.relrowsecurity).toBe(true);
    }));
});

describe("0052 billing_links: service_role only (42501 AND 'permission denied for table billing_links': the GRANT refusing)", () => {
  it("neither a client nor the agency's own JWT can READ a link (it holds the payer's email and a live payment URL) (mutation: grant select on billing_links to authenticated → FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      await c.query(LINK_SQL, linkParams(s));
      await actAs(c, { org_id: orgId("A") });
      expect(await refused(c, "select * from billing_links", [])).toMatchObject(denied("billing_links"));
      await actAs(c, { app_role: "agency_admin" });
      expect(await refused(c, "select * from billing_links", [])).toMatchObject(denied("billing_links"));
    }));

  it("no authenticated role can WRITE a link: writes go through serviceDb() after requireAgency() (mutation: grant insert or update on billing_links to authenticated → FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      await actAs(c, { app_role: "agency_admin" });
      expect(await refused(c, LINK_SQL, linkParams(s))).toMatchObject(denied("billing_links"));
      expect(await refused(c, "update billing_links set sent_to = 'x@y.z'", [])).toMatchObject(denied("billing_links"));
    }));
});

describe("0052 billing_links: shape", () => {
  it("refuses a non-customer id, a non-session id, a non-https URL and an address with no @ (mutation: drop any one of the four CHECKs → that insert succeeds, FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      expect(await refused(c, LINK_SQL, linkParams(s, { customer: "acct_1" })))
        .toMatchObject({ code: "23514", constraint: "billing_links_customer_check" });
      expect(await refused(c, LINK_SQL, linkParams(s, { session: "pi_1" })))
        .toMatchObject({ code: "23514", constraint: "billing_links_session_check" });
      expect(await refused(c, LINK_SQL, linkParams(s, { url: "http://checkout.stripe.com/x" })))
        .toMatchObject({ code: "23514", constraint: "billing_links_url_check" });
      expect(await refused(c, LINK_SQL, linkParams(s, { to: "owner.example.com" })))
        .toMatchObject({ code: "23514", constraint: "billing_links_sent_to_check" });
    }));

  it("one link per account, and one account per Stripe customer (mutation: drop the unique on stripe_customer_id → the second account's insert succeeds, FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      await c.query(LINK_SQL, linkParams(s));
      expect(await refused(c, LINK_SQL, linkParams(s, { session: `cs_test_2_${RUN}` })))
        .toMatchObject({ code: "23505", constraint: "billing_links_pkey" });
      expect(await refused(c, LINK_SQL, linkParams(s, { account: s.b, session: `cs_test_3_${RUN}` })))
        .toMatchObject({ code: "23505", constraint: "billing_links_stripe_customer_id_key" });
    }));

  it("a plan with a pending link cannot be deleted (plans are archived, never deleted) (mutation: plan_id on delete cascade → the delete succeeds, FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      await c.query(LINK_SQL, linkParams(s));
      expect(await refused(c, "delete from plans where id = $1", [s.plan])).toMatchObject({ code: "23503" });
    }));
});

describe("0052 account_billing: the billing start and the period start", () => {
  it("billing_started_at defaults to now() and can never be null; current_period_start is optional (mutation: drop the default → the fixture insert FAILS with 23502; drop NOT NULL → the update to null succeeds, FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      await c.query("insert into account_billing (account_id, plan_id) values ($1, $2)", [s.a, s.plan]);
      const { rows: [row] } = await c.query<{ started_ok: boolean; period_start: string | null }>(
        `select billing_started_at between now() - interval '1 minute' and now() as started_ok,
                current_period_start as period_start
           from account_billing where account_id = $1`, [s.a]);
      expect(row).toEqual({ started_ok: true, period_start: null });
      expect(await refused(c, "update account_billing set billing_started_at = null where account_id = $1", [s.a]))
        .toMatchObject({ code: "23502" });
    }));
});

describe("0052 billing_links, live: the account's own deletion carries its link away", () => {
  it("a link cascades with its account, so it needs no ACCOUNT_OWNED_TABLES entry (mutation: account_id on delete restrict → withTestAccount's teardown FAILS; drop the cascade → the orphan read finds the row, FAILS)", async () => {
    const db = serviceDb();
    const { data: agency, error: agErr } = await db.from("agencies").select("id").limit(1).single();
    expect(agErr).toBeNull();
    const { data: plan, error: planErr } = await db.from("plans").insert({
      agency_id: (agency as { id: string }).id, name: `Link cascade ${RUN}`, monthly_price_cents: 4900,
      features: FEATURES, allowances: ZERO, overage_cents: ZERO,
      stripe_product_id: "prod_t_link_cascade", stripe_price_ids: PRICE_IDS,
    }).select("id").single();
    expect(planErr).toBeNull();
    const planId = (plan as { id: string }).id;
    let accountId = "";
    let bodyOk = false;
    try {
      await withTestAccount(async (tdb, id) => {
        accountId = id;
        const { error } = await tdb.from("billing_links").insert({
          account_id: id, plan_id: planId, stripe_customer_id: `cus_t_cascade_${RUN}`,
          checkout_session_id: `cs_test_cascade_${RUN}`, checkout_url: "https://checkout.stripe.com/c/pay/x",
          sent_to: "owner@example.com", expires_at: new Date(Date.now() + 86_400_000).toISOString(),
        });
        expect(error).toBeNull();
      });
      const { data: left, error } = await db.from("billing_links").select("account_id").eq("account_id", accountId);
      expect(error).toBeNull();
      expect(left).toEqual([]);
      bodyOk = true;
    } finally {
      const { error } = await db.from("plans").delete().eq("id", planId);
      if (error) {
        const msg = `billing-checkout-schema cleanup failed on plans: ${error.message}`;
        if (bodyOk) throw new Error(msg);
        console.error(msg);
      }
    }
  });
});
```

- [ ] **Step 2: Typecheck (the tests cannot run locally)**

Run: `pnpm --filter @bis/db typecheck`
Expected: exit 0. (The db suite refuses to start while the local env names production. These tests first run at Checkpoint A, on `bis-ci`, AFTER 0052 is applied there. Until then they fail, which is the red.)

- [ ] **Step 3: Write the migration**

Create `packages/db/supabase/migrations/0052_billing_checkout.sql` (ASCII only, no backslash anywhere, the house rule for MCP-applied files):

```sql
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
```

Check the file for anything that is not ASCII, and for backslashes:

Run: `LC_ALL=C grep -n '[^ -~]' packages/db/supabase/migrations/0052_billing_checkout.sql; LC_ALL=C grep -c '[\\]' packages/db/supabase/migrations/0052_billing_checkout.sql`
Expected: no lines from the first, and `0` from the second. (`grep -P` refuses this machine's locale; the plan's own copy of the file was checked this way on 2026-09-25: no non-ASCII, no tab, no backslash.)

- [ ] **Step 4: The teardown comment**

In `packages/db/src/account-teardown.ts`, in the comment paragraph beginning `` `account_billing` and `usage_events` (0051) are deliberately not on it``, replace its first sentence's subject with `` `account_billing`, `usage_events` (0051) and `billing_links` (0052) ``, "both carry" with "all three carry" (three names now, not two), and its proof sentence with `` `billing-schema.test.ts` and `billing-checkout-schema.test.ts` prove those cascades live. `` Also add, to the closing parenthetical about `plans`, that `billing_links.plan_id` is `restrict` toward it too, same as `account_billing.plan_id`. Nothing else changes.

- [ ] **Step 5: Commit**

```bash
git add packages/db/supabase/migrations/0052_billing_checkout.sql packages/db/src/test/billing-checkout-schema.test.ts packages/db/src/account-teardown.ts
git commit -m "feat(db): 0052 billing start, period start and billing_links (service role only), with live proof"
```

---

### Checkpoint A (ORCHESTRATOR ONLY, not an implementer step)

1. **Apply 0052 to the CI project, and ONLY there**: first run `gh run list --status in_progress` and confirm no other branch's `verify` is running against `bis-ci` — the migration's `ALTER TABLE public.account_billing` (ACCESS EXCLUSIVE while the new columns and their NOT NULL are added) followed by `create table public.billing_links` with FKs onto `accounts` and `plans` (SHARE ROW EXCLUSIVE there) can deadlock against `billing-schema.test.ts`'s seed, which locks `accounts` → `plans` → `account_billing` in a fixed order inside its own transaction. Only once the list is empty, run `ci-project-setup.yml` with `push-dry-run` (the listing must show exactly `0052_billing_checkout.sql` pending), then `push`, then `migrations` (0052 listed as applied). Ledger line: `0052 APPLIED to bis-ci <run id> — NEVER RE-APPLY there`.
2. Push the branch. CI `verify` runs the db suite on `bis-ci`. Read the check runs for the head SHA. In the log, `src/test/billing-checkout-schema.test.ts` shows 11 passed.
3. **Mutation probes**, as PR-1 and PR-2 ran them:
   - Use a throwaway branch `probe/m7a-pr3-db` in its own worktree, with one commit per probe group.
   - A migration probe is NOT a commit on the branch. It is an ALTER run on `bis-ci` through MCP `execute_sql` inside the probe window, then reverted with the inverse ALTER. The orchestrator records both statements in the ledger.
   - The probes are the mutations named in the 11 titles. The grant ones are `grant select on billing_links to authenticated`, `grant insert on billing_links to authenticated`, `grant update on billing_links to authenticated`, and `grant all on billing_links to anon`. The RLS one is `alter table billing_links disable row level security`.
   - **After the "on delete restrict" probe** (`alter table public.billing_links drop constraint billing_links_account_id_fkey, add constraint billing_links_account_id_fkey foreign key (account_id) references public.accounts(id) on delete restrict` — `alter constraint` cannot change the delete action, only drop-and-readd can — exercised through the live cascade test): the live test's `withTestAccount` teardown fails on `billing_links` as expected, but it fails BEFORE the account row is deleted, and the outer test's own `finally` then fails to delete its `plans` row too (the row is still referenced by the stranded `billing_links` row) and only logs it, since the test body already threw. This leaves two orphans on `bis-ci`: the stranded fixture account (with its `billing_links` row still attached) and the plan named `Link cascade <RUN>` (the `RUN` suffix from that probe's own test run, read from the failing test's own title/output). After reverting with `alter table public.billing_links drop constraint billing_links_account_id_fkey, add constraint billing_links_account_id_fkey foreign key (account_id) references public.accounts(id) on delete cascade`, delete the stranded fixture account first (its `billing_links` row cascades away with it), then delete the now-unreferenced `Link cascade <RUN>` plan row. Record both deletes in the ledger.
   - **Shared-project hazard: the "drop the default" probe.** `alter table public.account_billing alter column billing_started_at drop default` makes EVERY other branch's `insert into account_billing (account_id, plan_id)` fixture fail with 23502 while it stands. Run it LAST and ALONE. Start it only when `gh run list --status in_progress` shows no other branch's `verify` running. Revert it (`... set default now()`) the moment its one probe run finishes, and record both statements and both times in the ledger. The `billing_links` probes and the NOT NULL probe are safe: no other branch writes that table or a null there.
   - Confirm each named test goes red for its own reason, then revert, and re-run `verify` green.
4. Production is NOT touched here (Task 13, Step 2).

### Task 2: `account-billing.ts`, the only writer of the billing rows; the reporting floor; the paged counts

**Owner:** bis-db-schema (data layer, no migration).

**Files:**
- Create: `packages/db/src/account-billing.ts`
- Create: `packages/db/src/account-billing.test.ts` (no database; runs in CI with the db suite)
- Create: `packages/db/src/test/account-billing.test.ts` (live, CI only)
- Create: `packages/db/src/billing.test.ts` (no database: the count paging)
- Modify: `packages/db/src/billing.ts` (`countBilledAccountsByPlan` pages to empty)
- Modify: `packages/db/src/usage.ts` (`listBilledUsageAccounts` reads `billing_started_at`; add `sumUsageSince`)
- Modify: `packages/db/src/usage.test.ts` (the paging fixture's `created_at` key → `billing_started_at`; +1 test for `sumUsageSince`)
- Modify: `packages/db/src/test/usage.test.ts` (`bill()` sets `billing_started_at`, and `created_at` to a DIFFERENT instant)
- Modify: `packages/db/src/index.ts` (exports)

**Interfaces:**
- Consumes: 0051 + 0052; `PlanFeatures`, `MeterAmounts`, `MeterKey`, `METER_KEYS` (`./billing`).
- Produces (used by Tasks 3-11):
  - `SUBSCRIPTION_STATUSES`, `type SubscriptionStatus`, `ENDED_STATUSES`, `PAST_DUE_STATUSES`, `isSubscriptionStatus(s: string): s is SubscriptionStatus`
  - `type AccountBilling`, `getAccountBilling(db, accountId): Promise<AccountBilling | null>`
  - `type BillingLink`, `getBillingLink(db, accountId)`, `saveBillingLink(db, link, expectedSessionId: string | null, now): Promise<boolean>`, `markBillingLinkExpired(db, accountId, sessionId, now): Promise<void>`
  - `type SubscriptionItemSnapshot`, `type SubscriptionSnapshot` (built by Task 3's gateway)
  - `type MirrorRefusal`, `type MirrorDecision`, `decideMirror(input): MirrorDecision` (pure), `type MirrorOutcome`, `MIRROR_ATTEMPTS`, `mirrorSubscription(db, read: () => Promise<SubscriptionSnapshot>, now: () => Date): Promise<MirrorOutcome>`. It takes a READER, not a snapshot. It must read the stored row BEFORE asking Stripe (B5), so the caller hands it the Stripe read (`() => gateway.retrieveSubscription(id)`) instead of a finished snapshot.
  - `markComplimentary(db, { accountId, planId, now })`, `unmarkComplimentary(db, accountId): Promise<boolean>`, `changeComplimentaryPlan(db, { accountId, planId, expectedPlanId, now })`
  - `claimWebhookEvent(db, eventId, type): Promise<"new" | "retry" | "done">`, `markWebhookEventProcessed(db, eventId, at): Promise<void>`
  - `sumUsageSince(db, accountId, sinceIso): Promise<MeterAmounts>` (in `usage.ts`)

- [ ] **Step 1: Write the failing unit tests**

Create `packages/db/src/account-billing.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  decideMirror, mirrorSubscription, markComplimentary, claimWebhookEvent, saveBillingLink,
  type AccountBilling, type SubscriptionSnapshot,
} from "./account-billing";

/**
 * account-billing.ts without a database: the mirror's decisions (pure), and
 * the exact writes around them. The live round trips are
 * ./test/account-billing.test.ts.
 */
const NOW = new Date("2026-10-01T12:00:00.000Z");
const ACCOUNT = "11111111-1111-4111-8111-111111111111";
const PLAN = "22222222-2222-4222-8222-222222222222";
const AGENCY = "33333333-3333-4333-8333-333333333333";
const START = 1_790_000_000; // seconds
const iso = (sec: number) => new Date(sec * 1000).toISOString();

const snap = (over: Partial<SubscriptionSnapshot> = {}): SubscriptionSnapshot => ({
  id: "sub_1", customerId: "cus_1", status: "active", accountId: ACCOUNT, planId: PLAN,
  currentPeriodStart: START, currentPeriodEnd: START + 2_592_000, startedAt: START,
  items: [], ...over,
});
const stored = (over: Partial<AccountBilling> = {}): AccountBilling => ({
  accountId: ACCOUNT, planId: PLAN, complimentary: false, stripeCustomerId: "cus_1", stripeSubscriptionId: "sub_1",
  subscriptionStatus: "active", currentPeriodStart: null, currentPeriodEnd: null, pastDueSince: null,
  billingPausedAt: null, billingStartedAt: "2026-09-01T00:00:00.123456+00:00",
  createdAt: "2026-09-01T00:00:00+00:00", updatedAt: "2026-09-01T00:00:00+00:00", ...over,
});
const base = {
  account: { id: ACCOUNT, agencyId: AGENCY },
  plan: { id: PLAN, agencyId: AGENCY, features: { voice_receptionist: true, web_concierge: false } },
  link: { stripeCustomerId: "cus_1" } as { stripeCustomerId: string } | null,
  existing: null as AccountBilling | null,
  now: NOW,
};

describe("decideMirror: a subscription BIS made becomes the billed row", () => {
  it("writes a NEW row from Stripe's own values: billing starts at the subscription's start_date, the period from its items, the plan's features as permissions (mutation: billing_started_at = now → FAILS; period from now → FAILS)", () => {
    const d = decideMirror({ ...base, snapshot: snap() });
    expect(d).toEqual({
      kind: "write",
      permissions: { voice_receptionist: true, web_concierge: false },
      row: {
        account_id: ACCOUNT, plan_id: PLAN, complimentary: false, stripe_customer_id: "cus_1",
        stripe_subscription_id: "sub_1", subscription_status: "active",
        current_period_start: iso(START), current_period_end: iso(START + 2_592_000),
        past_due_since: null, billing_started_at: iso(START), updated_at: NOW.toISOString(),
      },
    });
  });

  it("keeps the stored billing start, microseconds and all, for the SAME subscription; a NEW subscription after an ended one starts afresh; updated_at (the B5 version) always moves, even within the stored millisecond (mutation: always use start_date → FAILS; always keep the stored start → FAILS; write updated_at = now unconditionally → the same-millisecond write leaves the version unchanged, FAILS)", () => {
    const same = decideMirror({ ...base, existing: stored({ updatedAt: "2026-10-01T12:00:00.000456+00:00" }), snapshot: snap() });
    expect(same.kind === "write" && same.row.billing_started_at).toBe("2026-09-01T00:00:00.123456+00:00");
    expect(same.kind === "write" && same.row.updated_at).toBe("2026-10-01T12:00:00.001Z");
    const renewed = decideMirror({
      ...base, existing: stored({ stripeSubscriptionId: "sub_old", subscriptionStatus: "canceled" }),
      snapshot: snap({ startedAt: START + 99 }),
    });
    expect(renewed.kind === "write" && renewed.row.billing_started_at).toBe(iso(START + 99));
  });

  it("turns a complimentary row into a paid one, with the billing start moved to the subscription's start (G1) (mutation: keep complimentary true → FAILS; keep the complimentary start → FAILS)", () => {
    const d = decideMirror({
      ...base,
      existing: stored({ complimentary: true, stripeCustomerId: null, stripeSubscriptionId: null, subscriptionStatus: null }),
      snapshot: snap(),
    });
    expect(d.kind === "write" && [d.row.complimentary, d.row.billing_started_at]).toEqual([false, iso(START)]);
  });
});

describe("decideMirror: past_due_since (G8)", () => {
  it("stamps now on the first unpaid read, keeps the earlier stamp while still unpaid, clears it once paid (mutation: always stamp now → FAILS; never clear → FAILS)", () => {
    const first = decideMirror({ ...base, existing: stored(), snapshot: snap({ status: "past_due" }) });
    expect(first.kind === "write" && first.row.past_due_since).toBe(NOW.toISOString());
    const later = decideMirror({
      ...base, existing: stored({ subscriptionStatus: "past_due", pastDueSince: "2026-09-28T00:00:00+00:00" }),
      snapshot: snap({ status: "unpaid" }),
    });
    expect(later.kind === "write" && later.row.past_due_since).toBe("2026-09-28T00:00:00+00:00");
    const paid = decideMirror({
      ...base, existing: stored({ subscriptionStatus: "past_due", pastDueSince: "2026-09-28T00:00:00+00:00" }),
      snapshot: snap({ status: "active" }),
    });
    expect(paid.kind === "write" && paid.row.past_due_since).toBeNull();
  });
});

describe("decideMirror: named refusals (G7, G10)", () => {
  it("refuses a subscription whose customer is neither the stored nor the linked one: a hand-made subscription with a guessed bis_account_id never lands on an account (mutation: drop the customer check → FAILS)", () => {
    expect(decideMirror({ ...base, link: null, snapshot: snap({ customerId: "cus_other" }) }))
      .toEqual({ kind: "refused", reason: "customer_mismatch" });
  });

  it("once the billed row holds a customer, only THAT customer's subscription is accepted, even when a newer link names another (G3) (mutation: accept the stored OR the linked customer → the link's customer overwrites stripe_customer_id, FAILS)", () => {
    expect(decideMirror({
      ...base, existing: stored({ stripeCustomerId: "cus_A", subscriptionStatus: "canceled" }),
      link: { stripeCustomerId: "cus_B" }, snapshot: snap({ id: "sub_2", customerId: "cus_B" }),
    })).toEqual({ kind: "refused", reason: "customer_changed" });
  });

  it("refuses a DIFFERENT subscription while the stored one is not ended, and accepts it once the stored one is canceled (mutation: drop the live-subscription guard → FAILS)", () => {
    expect(decideMirror({ ...base, existing: stored({ subscriptionStatus: "past_due" }), snapshot: snap({ id: "sub_2" }) }))
      .toEqual({ kind: "refused", reason: "another_live_subscription" });
    expect(decideMirror({ ...base, existing: stored({ subscriptionStatus: "canceled" }), snapshot: snap({ id: "sub_2" })}).kind)
      .toBe("write");
  });

  it("refuses an unknown account, an unknown plan, a plan of another agency, and a status BIS does not know (mutation: drop the agency check → FAILS; cast the status → FAILS)", () => {
    expect(decideMirror({ ...base, account: null, snapshot: snap() })).toEqual({ kind: "refused", reason: "unknown_account" });
    expect(decideMirror({ ...base, plan: null, snapshot: snap() })).toEqual({ kind: "refused", reason: "unknown_plan" });
    expect(decideMirror({ ...base, plan: { ...base.plan, agencyId: "44444444-4444-4444-8444-444444444444" }, snapshot: snap() }))
      .toEqual({ kind: "refused", reason: "plan_other_agency" });
    expect(decideMirror({ ...base, snapshot: snap({ status: "on_hold" }) })).toEqual({ kind: "refused", reason: "unknown_status" });
  });
});

/** A fake PostgREST that records every call and answers each read from `reads`. */
function recorder(reads: Record<string, unknown>) {
  const calls: unknown[][] = [];
  const db = {
    from: (table: string) => {
      const chain: Record<string, unknown> = {};
      const rec = (op: string) => (...args: unknown[]) => { calls.push([table, op, ...args]); return chain; };
      for (const op of ["select", "eq", "is", "delete", "update"]) chain[op] = rec(op);
      chain.upsert = (...args: unknown[]) => { calls.push([table, "upsert", ...args]); return Promise.resolve({ error: null }); };
      chain.insert = (...args: unknown[]) => { calls.push([table, "insert", ...args]); return Promise.resolve({ error: null }); };
      chain.maybeSingle = () => Promise.resolve({ data: reads[table] ?? null, error: null });
      chain.then = (ok: (v: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(ok);
      return chain;
    },
  } as unknown as SupabaseClient;
  return { db, calls };
}

describe("mirrorSubscription: the writes", () => {
  it("refuses a subscription with no uuid bis_account_id BEFORE reading the database (mutation: drop the uuid check → the database is read, FAILS)", async () => {
    const { db, calls } = recorder({});
    expect(await mirrorSubscription(db, async () => snap({ accountId: "acct_x" }), () => NOW)).toEqual({ kind: "refused", reason: "no_account" });
    expect(calls).toEqual([]);
  });

  it("with no stored row it INSERTS (never an upsert: B5), then writes EXACTLY the plan's two features into accounts.permissions, then consumes the link keyed by account AND customer (mutation: write the whole features object unfiltered → FAILS; delete the link by account alone → FAILS)", async () => {
    const { db, calls } = recorder({
      accounts: { id: ACCOUNT, agency_id: AGENCY },
      plans: { id: PLAN, agency_id: AGENCY, features: { voice_receptionist: true, web_concierge: false, extra: true }, archived_at: null },
      billing_links: {
        account_id: ACCOUNT, plan_id: PLAN, stripe_customer_id: "cus_1", checkout_session_id: "cs_1",
        checkout_url: "https://x", sent_to: "a@b.co", expires_at: "2026-10-02T00:00:00+00:00",
        sent_at: "2026-10-01T00:00:00+00:00", updated_at: "2026-10-01T00:00:00+00:00",
      },
    });
    expect(await mirrorSubscription(db, async () => snap(), () => NOW)).toEqual({ kind: "written", accountId: ACCOUNT, planId: PLAN, status: "active" });
    const at = (table: string, op: string) => calls.findIndex((c) => c[0] === table && c[1] === op);
    const insert = at("account_billing", "insert");
    const perms = at("accounts", "update");
    const del = at("billing_links", "delete");
    expect(calls[insert]).toEqual(["account_billing", "insert",
      expect.objectContaining({ account_id: ACCOUNT, stripe_subscription_id: "sub_1", updated_at: NOW.toISOString() })]);
    expect(calls.some((c) => c[1] === "upsert")).toBe(false);
    expect(calls[perms]).toEqual(["accounts", "update", { permissions: { voice_receptionist: true, web_concierge: false } }]);
    expect(insert).toBeGreaterThan(-1);
    expect(perms).toBeGreaterThan(insert);
    expect(del).toBeGreaterThan(perms);
    expect(calls.slice(del + 1, del + 3)).toEqual([
      ["billing_links", "eq", "account_id", ACCOUNT], ["billing_links", "eq", "stripe_customer_id", "cus_1"],
    ]);
  });

  it("B5: the stored row is read BEFORE Stripe and written only while unchanged; losing that race re-reads both, so an EARLIER read of Stripe never overwrites a LATER one (mutation: update without the updated_at condition → the stale 'incomplete' is written, FAILS; read the row after asking Stripe → the order FAILS)", async () => {
    const V0 = "2026-10-01T11:00:00+00:00";
    const V1 = "2026-10-01T11:59:59.5+00:00";
    const dbRow = (updatedAt: string, status: string) => ({
      account_id: ACCOUNT, plan_id: PLAN, complimentary: false, stripe_customer_id: "cus_1", stripe_subscription_id: "sub_1",
      subscription_status: status, current_period_start: null, current_period_end: null, past_due_since: null,
      billing_paused_at: null, billing_started_at: "2026-09-01T00:00:00+00:00", created_at: "2026-09-01T00:00:00+00:00",
      updated_at: updatedAt,
    });
    let stored: Record<string, unknown> = dbRow(V0, "incomplete");
    const log: string[] = [];
    const writes: { status: unknown; version: unknown }[] = [];
    const db = {
      from: (table: string) => {
        const filters: [string, unknown][] = [];
        let patch: Record<string, unknown> | null = null;
        const chain: Record<string, unknown> = {
          select: () => chain, delete: () => chain,
          eq: (c: string, v: unknown) => { filters.push([c, v]); return chain; },
          update: (p: Record<string, unknown>) => { patch = p; return chain; },
          insert: async () => ({ error: null }),
          maybeSingle: async () => {
            if (table === "account_billing") { log.push("row"); return { data: { ...stored }, error: null }; }
            if (table === "accounts") return { data: { id: ACCOUNT, agency_id: AGENCY }, error: null };
            if (table === "plans") {
              return { data: { id: PLAN, agency_id: AGENCY, features: { voice_receptionist: true, web_concierge: false }, archived_at: null }, error: null };
            }
            return { data: null, error: null };
          },
          then: (ok: (v: unknown) => unknown) => {
            let result: { data: unknown[]; error: null } = { data: [], error: null };
            if (table === "account_billing" && patch) {
              const version = filters.find(([c]) => c === "updated_at")?.[1];
              writes.push({ status: patch.subscription_status, version });
              if (version === undefined || version === stored.updated_at) {
                stored = { ...stored, ...patch };
                result = { data: [{ account_id: ACCOUNT }], error: null };
              }
            }
            return Promise.resolve(result).then(ok);
          },
        };
        return chain;
      },
    } as unknown as SupabaseClient;
    // Stripe: the first read only names the account; the second is THIS
    // delivery's (stale) read; right after it, another delivery that read
    // Stripe LATER ("active") lands its write first; the third is the retry.
    const answers = [snap({ status: "incomplete" }), snap({ status: "incomplete" }), snap({ status: "active" })];
    let n = 0;
    const read = async () => {
      log.push("stripe");
      const s = answers[Math.min(n, answers.length - 1)]!;
      n += 1;
      if (n === 2) stored = dbRow(V1, "active");
      return s;
    };
    expect(await mirrorSubscription(db, read, () => NOW)).toEqual({ kind: "written", accountId: ACCOUNT, planId: PLAN, status: "active" });
    expect(log).toEqual(["stripe", "row", "stripe", "row", "stripe"]);
    expect(writes).toEqual([{ status: "incomplete", version: V0 }, { status: "active", version: V1 }]);
    expect(stored.subscription_status).toBe("active");
  });
});

/**
 * A small stateful "database" for the first-checkout races: one
 * account_billing row (or none), one billing link (or none), and a log of
 * every row read and every write attempt. `concurrent` is what ANOTHER
 * delivery writes; the tests call it from inside the Stripe reader, i.e.
 * between this delivery's row read and its write.
 */
function world(opts: { row?: Record<string, unknown> | null; updatesNeverMatch?: boolean } = {}) {
  const state: { row: Record<string, unknown> | null; link: Record<string, unknown> | null } = {
    row: opts.row ?? null,
    link: {
      account_id: ACCOUNT, plan_id: PLAN, stripe_customer_id: "cus_1", checkout_session_id: "cs_1",
      checkout_url: "https://checkout.stripe.com/x", sent_to: "a@b.co", expires_at: "2026-10-02T00:00:00+00:00",
      sent_at: "2026-10-01T00:00:00+00:00", updated_at: "2026-10-01T00:00:00+00:00",
    },
  };
  const log: string[] = [];
  const db = {
    from: (table: string) => {
      const filters: [string, unknown][] = [];
      let patch: Record<string, unknown> | null = null;
      let del = false;
      const chain: Record<string, unknown> = {
        select: () => chain,
        delete: () => { del = true; return chain; },
        eq: (c: string, v: unknown) => { filters.push([c, v]); return chain; },
        update: (p: Record<string, unknown>) => { patch = p; return chain; },
        insert: async (r: Record<string, unknown>) => {
          log.push("insert");
          if (state.row) return { error: { code: "23505", constraint: "account_billing_pkey", message: "duplicate key value" } };
          state.row = { ...r };
          return { error: null };
        },
        maybeSingle: async () => {
          if (table === "account_billing") { log.push("row"); return { data: state.row ? { ...state.row } : null, error: null }; }
          if (table === "billing_links") return { data: state.link ? { ...state.link } : null, error: null };
          if (table === "accounts") return { data: { id: ACCOUNT, agency_id: AGENCY }, error: null };
          if (table === "plans") {
            return { data: { id: PLAN, agency_id: AGENCY, features: { voice_receptionist: true, web_concierge: false }, archived_at: null }, error: null };
          }
          return { data: null, error: null };
        },
        then: (ok: (v: unknown) => unknown) => {
          let result: { data: unknown[]; error: null } = { data: [], error: null };
          if (table === "account_billing" && patch) {
            const version = filters.find(([c]) => c === "updated_at")?.[1];
            log.push(`update@${String(version)}`);
            if (!opts.updatesNeverMatch && state.row && (version === undefined || version === state.row.updated_at)) {
              state.row = { ...state.row, ...patch };
              result = { data: [{ account_id: ACCOUNT }], error: null };
            }
          }
          if (table === "billing_links" && del) state.link = null;
          return Promise.resolve(result).then(ok);
        },
      };
      return chain;
    },
  } as unknown as SupabaseClient;
  /** Another delivery's first write: it read Stripe EARLIER ("incomplete"). */
  const concurrent = (consumeLink: boolean) => {
    state.row = {
      account_id: ACCOUNT, plan_id: PLAN, complimentary: false, stripe_customer_id: "cus_1", stripe_subscription_id: "sub_1",
      subscription_status: "incomplete", current_period_start: null, current_period_end: null, past_due_since: null,
      billing_paused_at: null, billing_started_at: "2026-09-01T00:00:00+00:00", created_at: "2026-10-01T11:59:59+00:00",
      updated_at: "2026-10-01T11:59:59.9+00:00",
    };
    if (consumeLink) state.link = null;
  };
  return { db, state, log, concurrent };
}

describe("mirrorSubscription: the first checkout's event burst (B5)", () => {
  it("a REFUSAL decided on a row that changed meanwhile is a conflict, not final: another delivery inserted the row AND consumed the link after this one's row read, so this attempt sees no customer anywhere; it re-reads and writes Stripe's newer state (mutation: return the refusal without re-reading the row → customer_mismatch is stamped and the row stays 'incomplete', FAILS)", async () => {
    const w = world();
    let n = 0;
    const read = async () => { n += 1; if (n === 2) w.concurrent(true); return snap({ status: "active" }); };
    expect(await mirrorSubscription(w.db, read, () => NOW)).toEqual({ kind: "written", accountId: ACCOUNT, planId: PLAN, status: "active" });
    expect(w.state.row?.subscription_status).toBe("active");
  });

  it("an insert that hits 23505 naming account_billing_pkey (another delivery inserted first) is a conflict: the next attempt reads THAT row and updates it on its version (mutation: throw on 23505 → FAILS; ignore the constraint name and treat every 23505 as a conflict → FAILS on a stripe_customer_id/stripe_subscription_id collision; report the lost insert as written → the row stays 'incomplete', FAILS)", async () => {
    const w = world();
    let n = 0;
    const read = async () => { n += 1; if (n === 2) w.concurrent(false); return snap({ status: "active" }); };
    expect(await mirrorSubscription(w.db, read, () => NOW)).toEqual({ kind: "written", accountId: ACCOUNT, planId: PLAN, status: "active" });
    expect(w.log).toEqual(["row", "insert", "row", "update@2026-10-01T11:59:59.9+00:00"]);
    expect(w.state.row?.subscription_status).toBe("active");
  });

  it("a row that keeps changing is given up on after EXACTLY MIRROR_ATTEMPTS (3) row reads, by THROWING (so the event stays unstamped and Stripe retries), never by a refusal (mutation: return a refusal when the attempts run out → it would be stamped and lost, FAILS; MIRROR_ATTEMPTS = 100 → FAILS)", async () => {
    const w = world({ updatesNeverMatch: true });
    w.concurrent(false);
    await expect(mirrorSubscription(w.db, async () => snap({ status: "active" }), () => NOW)).rejects.toThrow(/kept changing/);
    expect(w.log.filter((e) => e === "row")).toHaveLength(3);
  });
});

describe("markComplimentary: the agency check comes first (G10)", () => {
  it("refuses a plan of another agency and an archived plan WITHOUT writing (mutation: drop either check → an insert is attempted, FAILS)", async () => {
    const other = recorder({ accounts: { id: ACCOUNT, agency_id: AGENCY }, plans: { id: PLAN, agency_id: "x", features: {}, archived_at: null } });
    expect(await markComplimentary(other.db, { accountId: ACCOUNT, planId: PLAN, now: NOW })).toEqual({ ok: false, reason: "plan_other_agency" });
    const archived = recorder({ accounts: { id: ACCOUNT, agency_id: AGENCY }, plans: { id: PLAN, agency_id: AGENCY, features: {}, archived_at: "2026-09-01T00:00:00Z" } });
    expect(await markComplimentary(archived.db, { accountId: ACCOUNT, planId: PLAN, now: NOW })).toEqual({ ok: false, reason: "plan_archived" });
    expect([...other.calls, ...archived.calls].filter((c) => c[1] === "insert" || c[1] === "upsert")).toEqual([]);
  });
});

describe("claimWebhookEvent and saveBillingLink: the concurrency answers", () => {
  it("claim: an inserted row is 'new'; a stored row is 'retry' until processed_at is set, then 'done' (mutation: treat every stored row as done → a failed event is never retried, FAILS)", async () => {
    const claim = (inserted: boolean, processedAt: string | null) => claimWebhookEvent({
      from: () => ({
        upsert: () => ({ select: async () => ({ data: inserted ? [{ event_id: "evt_1" }] : [], error: null }) }),
        select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { processed_at: processedAt }, error: null }) }) }),
      }),
    } as unknown as SupabaseClient, "evt_1", "invoice.paid");
    expect(await claim(true, null)).toBe("new");
    expect(await claim(false, null)).toBe("retry");
    expect(await claim(false, "2026-10-01T00:00:00Z")).toBe("done");
  });

  it("save: with a previous session it UPDATES only while that session is still the stored one, and reports a lost race as false (mutation: drop the .eq on the previous session → a racing tab overwrites the other's link, FAILS)", async () => {
    const seen: unknown[][] = [];
    const chain: Record<string, unknown> = {};
    chain.update = (row: unknown) => { seen.push(["update", row]); return chain; };
    chain.eq = (col: string, v: unknown) => { seen.push(["eq", col, v]); return chain; };
    chain.select = async () => ({ data: [], error: null });
    const ok = await saveBillingLink({ from: () => chain } as unknown as SupabaseClient, {
      accountId: ACCOUNT, planId: PLAN, stripeCustomerId: "cus_1", checkoutSessionId: "cs_new",
      checkoutUrl: "https://checkout.stripe.com/x", sentTo: "a@b.co", expiresAt: "2026-10-02T12:00:00.000Z",
    }, "cs_old", NOW);
    expect(ok).toBe(false);
    expect(seen).toContainEqual(["eq", "checkout_session_id", "cs_old"]);
  });
});
```

Create `packages/db/src/billing.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { countBilledAccountsByPlan } from "./billing";

describe("countBilledAccountsByPlan", () => {
  it("pages until an EMPTY page, so a server max_rows below the page size can never truncate the count (PR-1 final review) (mutation: one unpaged read → only the first page is counted, FAILS; stop on a short page → FAILS)", async () => {
    const ranges: [number, number][] = [];
    const page = (n: number, planId: string) => Array.from({ length: n }, (_, i) => ({ account_id: `a_${planId}_${i}`, plan_id: planId }));
    const pages = [page(1000, "p1"), page(3, "p2"), []];
    const chain = {
      select: () => chain, order: () => chain,
      range: async (a: number, b: number) => { ranges.push([a, b]); return { data: pages[ranges.length - 1] ?? [], error: null }; },
    };
    expect(await countBilledAccountsByPlan({ from: () => chain } as unknown as SupabaseClient)).toEqual({ p1: 1000, p2: 3 });
    expect(ranges).toEqual([[0, 999], [1000, 1999], [1003, 2002]]);
  });
});
```

In `packages/db/src/usage.test.ts`:
- In the `listBilledUsageAccounts — paging` test's `page()` helper, rename the fixture key `created_at` to `billing_started_at`. Nothing else in that test changes: its expectation already names `billingStartedAt`.
- Append this block at the end of the file:

```ts
describe("sumUsageSince", () => {
  it("sums each meter over EVERY page of the account's rows since the instant, paging until an empty page (mutation: stop after the first page → the second page's 2 texts are lost, FAILS; drop the account filter → FAILS)", async () => {
    const eqs: unknown[][] = [];
    const ranges: [number, number][] = [];
    const pages = [
      [{ meter: "voice_minutes", quantity: 3 }, { meter: "sms", quantity: 1 }],
      [{ meter: "sms", quantity: 2 }, { meter: "ai_chats", quantity: 1 }],
      [],
    ];
    const chain = {
      select: () => chain, order: () => chain,
      eq: (c: string, v: unknown) => { eqs.push([c, v]); return chain; },
      gte: (c: string, v: unknown) => { eqs.push([c, v]); return chain; },
      range: async (a: number, b: number) => { ranges.push([a, b]); return { data: pages[ranges.length - 1] ?? [], error: null }; },
    };
    const got = await sumUsageSince({ from: () => chain } as unknown as SupabaseClient, "acct_1", "2026-10-01T00:00:00.000Z");
    expect(got).toEqual({ voice_minutes: 3, sms: 3, ai_chats: 1 });
    expect(eqs).toContainEqual(["account_id", "acct_1"]);
    expect(eqs).toContainEqual(["occurred_at", "2026-10-01T00:00:00.000Z"]);
    expect(ranges).toEqual([[0, 999], [2, 1001], [4, 1003]]);
  });
});
```

(and add `sumUsageSince` to that file's import from `"./usage"`).

In `packages/db/src/test/usage.test.ts`, replace the `bill()` helper so the billing start and the row's creation are DIFFERENT instants. The existing `listBilledUsageAccounts` test, which expects `billingStartedAt: started`, then goes red if the read still uses `created_at`:

```ts
/** A billed account: a Stripe customer AND a subscription. Reporting starts
 *  at billing_started_at (0052), NOT created_at: the two are deliberately a
 *  day apart, so a read of the wrong column shows up as the wrong start. */
async function bill(accountId: string, planId: string, startedAtMs: number): Promise<string> {
  const customer = `cus_t_${randomUUID()}`;
  const { error } = await serviceDb().from("account_billing").insert({
    account_id: accountId, plan_id: planId, stripe_customer_id: customer,
    stripe_subscription_id: `sub_t_${randomUUID()}`, subscription_status: "active",
    billing_started_at: iso(startedAtMs), created_at: iso(startedAtMs - DAY),
  });
  if (error) throw new Error(`usage.test billing fixture refused: ${error.message}`);
  return customer;
}
```

and extend that test's title with `; read billing_started_at, not created_at → FAILS (mutation: select created_at → the start is a day early)`.

Create `packages/db/src/test/account-billing.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { serviceDb } from "../service";
import { withTestAccount } from "./fixtures";
import {
  mirrorSubscription, markComplimentary, unmarkComplimentary, claimWebhookEvent, markWebhookEventProcessed,
  getAccountBilling, saveBillingLink, getBillingLink,
} from "../account-billing";
import { sumUsageSince } from "../usage";

/**
 * The billing writers against the CI project: the rows, the permissions
 * write and the link's consumption as Postgres really stores them. CI only.
 */
const RUN = randomUUID().slice(0, 8);
const FEATURES = { voice_receptionist: true, web_concierge: true };
const ZERO = { voice_minutes: 0, sms: 0, ai_chats: 0 };
const PRICE_IDS = { base: "price_t_b", voice_minutes: "price_t_v", sms: "price_t_s", ai_chats: "price_t_a" };

async function withPlan(fn: (planId: string) => Promise<void>): Promise<void> {
  const db = serviceDb();
  const { data: agency } = await db.from("agencies").select("id").limit(1).single();
  const { data, error } = await db.from("plans").insert({
    agency_id: (agency as { id: string }).id, name: `AcctBilling ${RUN} ${randomUUID().slice(0, 6)}`,
    monthly_price_cents: 4900, features: FEATURES, allowances: ZERO, overage_cents: ZERO,
    stripe_product_id: "prod_t_ab", stripe_price_ids: PRICE_IDS,
  }).select("id").single();
  if (error) throw new Error(`plan fixture refused: ${error.message}`);
  const id = (data as { id: string }).id;
  let bodyOk = false;
  try {
    await fn(id);
    bodyOk = true;
  } finally {
    const { error: e } = await db.from("plans").delete().eq("id", id);
    if (e) {
      const msg = `account-billing.test cleanup failed on plans: ${e.message}`;
      if (bodyOk) throw new Error(msg);
      console.error(msg);
    }
  }
}

describe("billing writers, live", () => {
  it("mirrorSubscription stores the subscription, writes the plan's features to accounts.permissions and consumes the link; a replay changes nothing but updated_at, through the compare-and-set on PostgREST's own updated_at text (mutation: skip the permissions write → FAILS; skip the link delete → FAILS; move billing_started_at on replay → FAILS; a version filter that never matches the stored text → the replay THROWS after MIRROR_ATTEMPTS, FAILS)", () =>
    withPlan((planId) => withTestAccount(async (db, accountId) => {
      const customer = `cus_t_${randomUUID()}`;
      expect(await saveBillingLink(db, {
        accountId, planId, stripeCustomerId: customer, checkoutSessionId: `cs_test_${RUN}`,
        checkoutUrl: "https://checkout.stripe.com/c/pay/x", sentTo: "owner@example.com",
        expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
      }, null, new Date())).toBe(true);
      const snapshot = {
        id: `sub_t_${randomUUID()}`, customerId: customer, status: "active", accountId, planId,
        currentPeriodStart: 1_790_000_000, currentPeriodEnd: 1_792_592_000, startedAt: 1_790_000_000, items: [],
      };
      expect((await mirrorSubscription(db, async () => snapshot, () => new Date())).kind).toBe("written");
      const first = await getAccountBilling(db, accountId);
      expect(first).toMatchObject({
        planId, complimentary: false, stripeCustomerId: customer, stripeSubscriptionId: snapshot.id,
        subscriptionStatus: "active", pastDueSince: null,
      });
      expect(Date.parse(first!.billingStartedAt)).toBe(1_790_000_000_000);
      expect(Date.parse(first!.currentPeriodStart!)).toBe(1_790_000_000_000);
      const { data: acct } = await db.from("accounts").select("permissions").eq("id", accountId).single();
      expect((acct as { permissions: unknown }).permissions).toEqual(FEATURES);
      expect(await getBillingLink(db, accountId)).toBeNull();
      expect((await mirrorSubscription(db, async () => snapshot, () => new Date(Date.now() + 1000))).kind).toBe("written");
      const second = await getAccountBilling(db, accountId);
      expect(second!.billingStartedAt).toBe(first!.billingStartedAt);
      expect(Date.parse(second!.updatedAt)).toBeGreaterThan(Date.parse(first!.updatedAt));
    })));

  it("markComplimentary stores a complimentary row with the plan's features; a second mark is already_billed; unmark deletes it and resets permissions to {} (mutation: unmark leaves permissions → FAILS; drop the complimentary filter on the delete → FAILS on the paid-row case)", () =>
    withPlan((planId) => withTestAccount(async (db, accountId) => {
      expect(await markComplimentary(db, { accountId, planId, now: new Date() })).toEqual({ ok: true });
      expect(await markComplimentary(db, { accountId, planId, now: new Date() })).toEqual({ ok: false, reason: "already_billed" });
      expect(await getAccountBilling(db, accountId)).toMatchObject({ complimentary: true, stripeSubscriptionId: null });
      expect(await unmarkComplimentary(db, accountId)).toBe(true);
      expect(await getAccountBilling(db, accountId)).toBeNull();
      const { data: acct } = await db.from("accounts").select("permissions").eq("id", accountId).single();
      expect((acct as { permissions: unknown }).permissions).toEqual({});
      expect(await unmarkComplimentary(db, accountId)).toBe(false);
    })));

  it("claimWebhookEvent: new, then retry while unprocessed, then done once stamped (mutation: claim via plain insert → the second claim THROWS 23505, FAILS; treat every stored row as done → the second claim reads 'done', FAILS)", async () => {
    const db = serviceDb();
    const id = `evt_t_${randomUUID()}`;
    try {
      expect(await claimWebhookEvent(db, id, "invoice.paid")).toBe("new");
      expect(await claimWebhookEvent(db, id, "invoice.paid")).toBe("retry");
      await markWebhookEventProcessed(db, id, new Date());
      expect(await claimWebhookEvent(db, id, "invoice.paid")).toBe("done");
    } finally {
      await db.from("stripe_webhook_events").delete().eq("event_id", id);
    }
  });

  it("sumUsageSince counts only this account's rows on or after the instant (mutation: gt instead of gte → the boundary row is lost, FAILS; drop the account filter → the other account's row counts, FAILS)", () =>
    withTestAccount((db, a) => withTestAccount(async (_d, b) => {
      const at = "2026-10-01T00:00:00.000Z";
      const rows = [
        { account_id: a, meter: "sms", quantity: 2, occurred_at: at, source_ref: `message:${randomUUID()}` },
        { account_id: a, meter: "voice_minutes", quantity: 5, occurred_at: "2026-10-03T00:00:00.000Z", source_ref: `call:${randomUUID()}` },
        { account_id: a, meter: "sms", quantity: 9, occurred_at: "2026-09-30T23:59:59.000Z", source_ref: `message:${randomUUID()}` },
        { account_id: b, meter: "sms", quantity: 7, occurred_at: "2026-10-02T00:00:00.000Z", source_ref: `message:${randomUUID()}` },
      ];
      expect((await db.from("usage_events").insert(rows)).error).toBeNull();
      expect(await sumUsageSince(db, a, at)).toEqual({ voice_minutes: 5, sms: 2, ai_chats: 0 });
    })));
});
```

- [ ] **Step 2: Typecheck (red: the module does not exist)**

Run: `pnpm --filter @bis/db typecheck`
Expected: FAIL, `Cannot find module './account-billing'` and `sumUsageSince` not exported.

- [ ] **Step 3: Write `account-billing.ts`**

Create `packages/db/src/account-billing.ts`:

```ts
import type { SupabaseClient } from "@supabase/supabase-js";
import type { PlanFeatures, PlanPriceKey } from "./billing";

/**
 * The billed-account state (0051 account_billing, 0052 billing_links) and
 * the Stripe webhook ledger (0051 stripe_webhook_events). The ONLY module
 * that writes them. Every writer needs serviceDb() (authenticated holds at
 * most SELECT); callers guard first: requireAgency() for the agency's
 * actions, a verified Stripe signature for the webhook. There is no
 * updated_at trigger (0051): every writer sets it.
 */

export const SUBSCRIPTION_STATUSES = [
  "incomplete", "incomplete_expired", "trialing", "active", "past_due", "unpaid", "canceled", "paused",
] as const;
export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number];
/** Over for good: a new subscription may replace one in these. */
export const ENDED_STATUSES: readonly SubscriptionStatus[] = ["incomplete_expired", "canceled"];
/** Unpaid: past_due_since is stamped while the subscription sits in one of these (G8). */
export const PAST_DUE_STATUSES: readonly SubscriptionStatus[] = ["past_due", "unpaid"];

export function isSubscriptionStatus(s: string): s is SubscriptionStatus {
  return (SUBSCRIPTION_STATUSES as readonly string[]).includes(s);
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type AccountBilling = {
  accountId: string;
  planId: string;
  complimentary: boolean;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  subscriptionStatus: SubscriptionStatus | null;
  currentPeriodStart: string | null;
  currentPeriodEnd: string | null;
  pastDueSince: string | null;
  billingPausedAt: string | null;
  /** As PostgREST returns it (microseconds). Never re-serialise it. */
  billingStartedAt: string;
  createdAt: string;
  updatedAt: string;
};

type AccountBillingDbRow = {
  account_id: string; plan_id: string; complimentary: boolean;
  stripe_customer_id: string | null; stripe_subscription_id: string | null;
  subscription_status: SubscriptionStatus | null; current_period_start: string | null;
  current_period_end: string | null; past_due_since: string | null; billing_paused_at: string | null;
  billing_started_at: string; created_at: string; updated_at: string;
};

// ONE string literal, never a `+` concatenation: supabase-js parses the
// select text at the type level, and a widened `string` types the row as a
// GenericStringError (caught typechecking this plan, 2026-09-25).
const BILLING_COLUMNS =
  "account_id, plan_id, complimentary, stripe_customer_id, stripe_subscription_id, subscription_status, current_period_start, current_period_end, past_due_since, billing_paused_at, billing_started_at, created_at, updated_at";

function toBilling(r: AccountBillingDbRow): AccountBilling {
  return {
    accountId: r.account_id, planId: r.plan_id, complimentary: r.complimentary,
    stripeCustomerId: r.stripe_customer_id, stripeSubscriptionId: r.stripe_subscription_id,
    subscriptionStatus: r.subscription_status, currentPeriodStart: r.current_period_start,
    currentPeriodEnd: r.current_period_end, pastDueSince: r.past_due_since, billingPausedAt: r.billing_paused_at,
    billingStartedAt: r.billing_started_at, createdAt: r.created_at, updatedAt: r.updated_at,
  };
}

/** The account's billing row, or null (= unbilled). Works on the RLS client
 *  for the agency and for the account's own client (0051 policy). */
export async function getAccountBilling(db: SupabaseClient, accountId: string): Promise<AccountBilling | null> {
  const { data, error } = await db.from("account_billing").select(BILLING_COLUMNS).eq("account_id", accountId).maybeSingle();
  if (error) throw new Error(`getAccountBilling failed: ${error.message}`);
  return data ? toBilling(data as AccountBillingDbRow) : null;
}

export type BillingLink = {
  accountId: string;
  planId: string;
  stripeCustomerId: string;
  checkoutSessionId: string;
  checkoutUrl: string;
  sentTo: string;
  expiresAt: string;
  sentAt: string;
  updatedAt: string;
};
export type BillingLinkWrite = Omit<BillingLink, "sentAt" | "updatedAt">;

type BillingLinkDbRow = {
  account_id: string; plan_id: string; stripe_customer_id: string; checkout_session_id: string;
  checkout_url: string; sent_to: string; expires_at: string; sent_at: string; updated_at: string;
};
const LINK_COLUMNS = "account_id, plan_id, stripe_customer_id, checkout_session_id, checkout_url, sent_to, expires_at, sent_at, updated_at";

/** service_role only (0052): call with serviceDb() after requireAgency(). */
export async function getBillingLink(db: SupabaseClient, accountId: string): Promise<BillingLink | null> {
  const { data, error } = await db.from("billing_links").select(LINK_COLUMNS).eq("account_id", accountId).maybeSingle();
  if (error) throw new Error(`getBillingLink failed: ${error.message}`);
  if (!data) return null;
  const r = data as BillingLinkDbRow;
  return {
    accountId: r.account_id, planId: r.plan_id, stripeCustomerId: r.stripe_customer_id,
    checkoutSessionId: r.checkout_session_id, checkoutUrl: r.checkout_url, sentTo: r.sent_to,
    expiresAt: r.expires_at, sentAt: r.sent_at, updatedAt: r.updated_at,
  };
}

/**
 * Stores the link just made. OPTIMISTIC on the previous session (G2): with
 * `expectedSessionId` null it inserts, and a row that appeared meanwhile is a
 * 23505 → false; otherwise it updates only while the stored session is still
 * `expectedSessionId` → false when another tab replaced it first. The caller
 * expires its own new session on false.
 *
 * The 23505 → false branch checks the CONSTRAINT NAME, not just the code:
 * `billing_links` carries a second unique key (`stripe_customer_id`), and a
 * violation there is a different account colliding on the same Stripe
 * customer — a data-integrity bug, not "someone already saved a link for
 * THIS account". Only `billing_links_pkey` is a CAS conflict; any other
 * 23505 throws.
 */
export async function saveBillingLink(
  db: SupabaseClient, link: BillingLinkWrite, expectedSessionId: string | null, now: Date,
): Promise<boolean> {
  const at = now.toISOString();
  const row = {
    plan_id: link.planId, stripe_customer_id: link.stripeCustomerId, checkout_session_id: link.checkoutSessionId,
    checkout_url: link.checkoutUrl, sent_to: link.sentTo, expires_at: link.expiresAt, sent_at: at, updated_at: at,
  };
  if (expectedSessionId === null) {
    const { error } = await db.from("billing_links").insert({ account_id: link.accountId, ...row });
    if (!error) return true;
    if (error.code === "23505" && error.constraint === "billing_links_pkey") return false;
    throw new Error(`saveBillingLink insert failed: ${error.message}`);
  }
  const { data, error } = await db.from("billing_links").update(row)
    .eq("account_id", link.accountId).eq("checkout_session_id", expectedSessionId).select("account_id");
  if (error) throw new Error(`saveBillingLink update failed: ${error.message}`);
  return (data ?? []).length === 1;
}

/** Marks the stored link expired NOW, before its Stripe session is expired,
 *  so a failure after this never leaves a dead link shown as live (G2). */
export async function markBillingLinkExpired(db: SupabaseClient, accountId: string, sessionId: string, now: Date): Promise<void> {
  const at = now.toISOString();
  const { error } = await db.from("billing_links").update({ expires_at: at, updated_at: at })
    .eq("account_id", accountId).eq("checkout_session_id", sessionId);
  if (error) throw new Error(`markBillingLinkExpired failed: ${error.message}`);
}

/** One subscription item as BIS reads it: the price's own metadata names
 *  its plan and its role (PR-1's priceCreateParams sets both). */
export type SubscriptionItemSnapshot = { id: string; priceId: string; priceKey: PlanPriceKey | null; planId: string | null };

/** What BIS keeps of a Stripe subscription, re-read from Stripe on every
 *  event (never from the event payload). Times are Stripe's SECONDS. */
export type SubscriptionSnapshot = {
  id: string;
  customerId: string;
  /** Stripe's value, unvalidated: decideMirror refuses one BIS does not know. */
  status: string;
  /** metadata.bis_account_id, set by BIS's Checkout (subscription_data). */
  accountId: string | null;
  /** The BASE item's price metadata bis_plan_id (G6). */
  planId: string | null;
  currentPeriodStart: number | null;
  currentPeriodEnd: number | null;
  startedAt: number;
  items: SubscriptionItemSnapshot[];
};

export type MirrorRefusal =
  | "no_account" | "unknown_account" | "customer_changed" | "customer_mismatch" | "unknown_plan" | "plan_other_agency"
  | "another_live_subscription" | "unknown_status";

type MirrorRow = {
  account_id: string; plan_id: string; complimentary: false; stripe_customer_id: string;
  stripe_subscription_id: string; subscription_status: SubscriptionStatus;
  current_period_start: string | null; current_period_end: string | null; past_due_since: string | null;
  billing_started_at: string; updated_at: string;
};

export type MirrorDecision =
  | { kind: "write"; row: MirrorRow; permissions: PlanFeatures }
  | { kind: "refused"; reason: MirrorRefusal };

export type MirrorPlan = { id: string; agencyId: string; features: PlanFeatures };

const seconds = (s: number): string => new Date(s * 1000).toISOString();

/** updated_at is the mirror's compare-and-set version (B5), so a write must
 *  never leave it where it was: at least 1 ms past the stored value, even
 *  when two writes share a millisecond or this instance's clock runs behind.
 *  (Date.parse keeps the milliseconds of PostgREST's microsecond text.) */
function nextVersion(now: Date, stored: string | undefined): string {
  const floor = stored ? Date.parse(stored) + 1 : Number.NEGATIVE_INFINITY;
  return new Date(Math.max(now.getTime(), floor)).toISOString();
}

/**
 * PURE. The billed row a subscription snapshot becomes, or why not (G7).
 * `account`, `plan`, `existing` and `link` are what the database holds for
 * the snapshot's account; nothing here reads the event that triggered it.
 */
export function decideMirror(input: {
  snapshot: SubscriptionSnapshot;
  account: { id: string; agencyId: string } | null;
  plan: MirrorPlan | null;
  existing: AccountBilling | null;
  link: Pick<BillingLink, "stripeCustomerId"> | null;
  now: Date;
}): MirrorDecision {
  const { snapshot: s, account, plan, existing, link, now } = input;
  const refuse = (reason: MirrorRefusal): MirrorDecision => ({ kind: "refused", reason });
  if (!account) return refuse("unknown_account");
  // G3: once the billed row holds a customer, it is the account's customer
  // for good (a pending link naming another does not change that). Only an
  // account with no stored customer takes the link's.
  const storedCustomer = existing?.stripeCustomerId ?? null;
  if (storedCustomer !== null && s.customerId !== storedCustomer) return refuse("customer_changed");
  if (storedCustomer === null && link?.stripeCustomerId !== s.customerId) return refuse("customer_mismatch");
  if (!isSubscriptionStatus(s.status)) return refuse("unknown_status");
  if (!plan) return refuse("unknown_plan");
  if (plan.agencyId !== account.agencyId) return refuse("plan_other_agency");
  const sameSubscription = existing !== null && existing.stripeSubscriptionId === s.id;
  if (existing?.stripeSubscriptionId && !sameSubscription && existing.subscriptionStatus
    && !ENDED_STATUSES.includes(existing.subscriptionStatus)) {
    return refuse("another_live_subscription");
  }
  const unpaid = PAST_DUE_STATUSES.includes(s.status);
  return {
    kind: "write",
    permissions: { voice_receptionist: plan.features.voice_receptionist, web_concierge: plan.features.web_concierge },
    row: {
      account_id: account.id, plan_id: plan.id, complimentary: false,
      stripe_customer_id: s.customerId, stripe_subscription_id: s.id, subscription_status: s.status,
      current_period_start: s.currentPeriodStart === null ? null : seconds(s.currentPeriodStart),
      current_period_end: s.currentPeriodEnd === null ? null : seconds(s.currentPeriodEnd),
      past_due_since: unpaid ? (sameSubscription && existing?.pastDueSince ? existing.pastDueSince : now.toISOString()) : null,
      billing_started_at: sameSubscription ? existing.billingStartedAt : seconds(s.startedAt),
      updated_at: nextVersion(now, existing?.updatedAt),
    },
  };
}

type PlanForBilling = MirrorPlan & { archivedAt: string | null };

async function readAccount(db: SupabaseClient, accountId: string): Promise<{ id: string; agencyId: string } | null> {
  const { data, error } = await db.from("accounts").select("id, agency_id").eq("id", accountId).maybeSingle();
  if (error) throw new Error(`billing: account read failed: ${error.message}`);
  const r = data as { id: string; agency_id: string } | null;
  return r ? { id: r.id, agencyId: r.agency_id } : null;
}

async function readPlan(db: SupabaseClient, planId: string): Promise<PlanForBilling | null> {
  const { data, error } = await db.from("plans").select("id, agency_id, features, archived_at").eq("id", planId).maybeSingle();
  if (error) throw new Error(`billing: plan read failed: ${error.message}`);
  const r = data as { id: string; agency_id: string; features: PlanFeatures; archived_at: string | null } | null;
  return r ? { id: r.id, agencyId: r.agency_id, features: r.features, archivedAt: r.archived_at } : null;
}

/** accounts.permissions is reserved for plans (platform spec section 3) and
 *  nothing else writes it (G9): EXACTLY the two feature flags, or {} for an
 *  unbilled account. accounts has no updated_at column. */
async function writePermissions(db: SupabaseClient, accountId: string, features: PlanFeatures | null): Promise<void> {
  const permissions = features
    ? { voice_receptionist: features.voice_receptionist, web_concierge: features.web_concierge }
    : {};
  const { error } = await db.from("accounts").update({ permissions }).eq("id", accountId);
  if (error) throw new Error(`billing: permissions write failed: ${error.message}`);
}

export type MirrorOutcome =
  | { kind: "written"; accountId: string; planId: string; status: SubscriptionStatus }
  | { kind: "refused"; reason: MirrorRefusal };

/** How many times the mirror starts again after losing a race (B5) before
 *  it throws: the webhook then answers 500, and Stripe retries later. */
export const MIRROR_ATTEMPTS = 3;

/**
 * Stores what Stripe says NOW about one subscription as the account's billed
 * row (spec flow 4): the row (billing_paused_at is never touched here), the
 * permissions, and the link that led to it consumed. `read` asks Stripe (the
 * gateway's retrieveSubscription); nothing from a webhook payload reaches
 * here. Idempotent: the same Stripe state twice writes the same row.
 *
 * COMPARE-AND-SET (B5). The stored row is read BEFORE Stripe is asked, and
 * written only while it is still that row: an update filtered on its
 * updated_at, or an insert when there was none (a 23505 naming
 * `account_billing_pkey` is the same signal — another delivery inserted
 * first. A 23505 naming `stripe_customer_id` or `stripe_subscription_id`
 * instead is a different account already holding that Stripe id, which is
 * not this race, and throws).
 * A delivery that read Stripe earlier but reaches the database later
 * therefore loses, reads the row and Stripe again, and writes the NEWER
 * state instead of overwriting it with an older one. A REFUSAL is returned
 * only while the row is still that row too (it is final: the event gets
 * stamped). The first read only names the account; its values are never
 * written. Throws on any database error, and after MIRROR_ATTEMPTS lost
 * races, so the webhook answers 500 and Stripe retries.
 *
 * What is guaranteed is the ROW. The permissions write and the link cleanup
 * follow it outside the compare-and-set, so two racing deliveries can leave
 * `accounts.permissions` from the older one. Harmless in PR-3 (nothing reads
 * permissions yet, G9); PR-4 closes it before it enforces them (Next plans).
 */
export async function mirrorSubscription(
  db: SupabaseClient, read: () => Promise<SubscriptionSnapshot>, now: () => Date,
): Promise<MirrorOutcome> {
  let snapshot = await read();
  for (let attempt = 1; attempt <= MIRROR_ATTEMPTS; attempt += 1) {
    const accountId = snapshot.accountId;
    if (!accountId || !UUID.test(accountId)) return { kind: "refused", reason: "no_account" };
    const existing = await getAccountBilling(db, accountId);
    snapshot = await read();
    // Its bis_account_id changed between the two reads: start over on the new one.
    if (snapshot.accountId !== accountId) continue;
    const outcome = await writeMirror(db, accountId, snapshot, existing, now());
    if (outcome !== "conflict") return outcome;
  }
  throw new Error(`mirrorSubscription: the billing row for ${snapshot.id} kept changing (${MIRROR_ATTEMPTS} attempts); Stripe will retry`);
}

/** One attempt: decide against `existing` (read before Stripe was asked),
 *  then write only if the row is still `existing`. "conflict" = it is not. */
async function writeMirror(
  db: SupabaseClient, accountId: string, snapshot: SubscriptionSnapshot, existing: AccountBilling | null, now: Date,
): Promise<MirrorOutcome | "conflict"> {
  const planId = snapshot.planId && UUID.test(snapshot.planId) ? snapshot.planId : null;
  const [account, link, plan] = await Promise.all([
    readAccount(db, accountId), getBillingLink(db, accountId), planId ? readPlan(db, planId) : Promise.resolve(null),
  ]);
  const decision = decideMirror({ snapshot, account, plan, existing, link, now });
  if (decision.kind === "refused") {
    // A refusal is FINAL (the event is stamped), so it must rest on the row as
    // it is now, not as it was before Stripe was asked. The link is read AFTER
    // the Stripe read: on a first checkout, a concurrent delivery can insert
    // the row AND consume the link in between, and this attempt then sees no
    // stored customer and no link (customer_mismatch) while the row it would
    // correct sits `incomplete`. If the row moved (or appeared, or went), it
    // is a conflict: start again on the new row.
    const current = await getAccountBilling(db, accountId);
    return (current?.updatedAt ?? null) === (existing?.updatedAt ?? null) ? decision : "conflict";
  }
  if (existing === null) {
    const { error } = await db.from("account_billing").insert(decision.row);
    if (error?.code === "23505" && error.constraint === "account_billing_pkey") return "conflict";
    if (error) throw new Error(`mirrorSubscription insert failed: ${error.message}`);
  } else {
    const { data, error } = await db.from("account_billing").update(decision.row)
      .eq("account_id", accountId).eq("updated_at", existing.updatedAt).select("account_id");
    if (error) throw new Error(`mirrorSubscription update failed: ${error.message}`);
    if ((data ?? []).length === 0) return "conflict";
  }
  await writePermissions(db, accountId, decision.permissions);
  if (link && link.stripeCustomerId === snapshot.customerId) {
    const { error: delErr } = await db.from("billing_links").delete()
      .eq("account_id", accountId).eq("stripe_customer_id", snapshot.customerId);
    if (delErr) throw new Error(`mirrorSubscription link cleanup failed: ${delErr.message}`);
  }
  return { kind: "written", accountId, planId: decision.row.plan_id, status: decision.row.subscription_status };
}

type PlanRefusal = "unknown_account" | "unknown_plan" | "plan_other_agency" | "plan_archived";

async function checkedPlan(
  db: SupabaseClient, accountId: string, planId: string,
): Promise<{ ok: true; plan: PlanForBilling } | { ok: false; reason: PlanRefusal }> {
  const [account, plan] = await Promise.all([readAccount(db, accountId), readPlan(db, planId)]);
  if (!account) return { ok: false, reason: "unknown_account" };
  if (!plan) return { ok: false, reason: "unknown_plan" };
  if (plan.agencyId !== account.agencyId) return { ok: false, reason: "plan_other_agency" };
  if (plan.archivedAt) return { ok: false, reason: "plan_archived" };
  return { ok: true, plan };
}

/** Complimentary (G16): on a plan, no Stripe subscription, never paused
 *  (0051's CHECK). Only for an account with NO billing row: a 23505 naming
 *  `account_billing_pkey` means one now exists (already_billed); any other
 *  23505 (there should be none here, since this insert carries no Stripe id)
 *  throws instead of being read as the same thing. */
export async function markComplimentary(
  db: SupabaseClient, input: { accountId: string; planId: string; now: Date },
): Promise<{ ok: true } | { ok: false; reason: PlanRefusal | "already_billed" }> {
  const checked = await checkedPlan(db, input.accountId, input.planId);
  if (!checked.ok) return checked;
  const at = input.now.toISOString();
  const { error } = await db.from("account_billing").insert({
    account_id: input.accountId, plan_id: input.planId, complimentary: true, billing_started_at: at, updated_at: at,
  });
  if (error) {
    if (error.code === "23505" && error.constraint === "account_billing_pkey") return { ok: false, reason: "already_billed" };
    throw new Error(`markComplimentary failed: ${error.message}`);
  }
  await writePermissions(db, input.accountId, checked.plan.features);
  return { ok: true };
}

/** Back to unbilled: deletes a COMPLIMENTARY row only (never a paid one) and
 *  resets permissions to {}. False when there was no complimentary row. */
export async function unmarkComplimentary(db: SupabaseClient, accountId: string): Promise<boolean> {
  const { data, error } = await db.from("account_billing").delete()
    .eq("account_id", accountId).eq("complimentary", true).select("account_id");
  if (error) throw new Error(`unmarkComplimentary failed: ${error.message}`);
  if ((data ?? []).length === 0) return false;
  await writePermissions(db, accountId, null);
  return true;
}

/** A complimentary account's plan change, optimistic on the plan the caller
 *  saw (a second tab's change makes this `stale`). */
export async function changeComplimentaryPlan(
  db: SupabaseClient, input: { accountId: string; planId: string; expectedPlanId: string; now: Date },
): Promise<{ ok: true } | { ok: false; reason: PlanRefusal | "stale" }> {
  const checked = await checkedPlan(db, input.accountId, input.planId);
  if (!checked.ok) return checked;
  const { data, error } = await db.from("account_billing")
    .update({ plan_id: input.planId, updated_at: input.now.toISOString() })
    .eq("account_id", input.accountId).eq("complimentary", true).eq("plan_id", input.expectedPlanId)
    .select("account_id");
  if (error) throw new Error(`changeComplimentaryPlan failed: ${error.message}`);
  if ((data ?? []).length === 0) return { ok: false, reason: "stale" };
  await writePermissions(db, input.accountId, checked.plan.features);
  return { ok: true };
}

/**
 * Records a Stripe event id once (insert ... on conflict do nothing):
 * "new" the first time, "retry" when it is stored but was never stamped (an
 * earlier attempt threw; process it again), "done" once stamped.
 */
export async function claimWebhookEvent(db: SupabaseClient, eventId: string, type: string): Promise<"new" | "retry" | "done"> {
  const { data, error } = await db.from("stripe_webhook_events")
    .upsert({ event_id: eventId, type }, { onConflict: "event_id", ignoreDuplicates: true })
    .select("event_id");
  if (error) throw new Error(`claimWebhookEvent failed: ${error.message}`);
  if ((data ?? []).length === 1) return "new";
  const { data: row, error: readErr } = await db.from("stripe_webhook_events")
    .select("processed_at").eq("event_id", eventId).maybeSingle();
  if (readErr) throw new Error(`claimWebhookEvent read failed: ${readErr.message}`);
  if (!row) throw new Error(`claimWebhookEvent: ${eventId} neither inserted nor found`);
  return (row as { processed_at: string | null }).processed_at ? "done" : "retry";
}

export async function markWebhookEventProcessed(db: SupabaseClient, eventId: string, at: Date): Promise<void> {
  const { error } = await db.from("stripe_webhook_events")
    .update({ processed_at: at.toISOString() }).eq("event_id", eventId).is("processed_at", null);
  if (error) throw new Error(`markWebhookEventProcessed failed: ${error.message}`);
}
```

- [ ] **Step 4: The count, the floor, the sum**

In `packages/db/src/billing.ts`, replace `countBilledAccountsByPlan` with:

```ts
const COUNT_PAGE = 1000;

/** Billed accounts per plan id (the Plans list's "N clients"). A plan with
 *  none is absent from the record. Paged until an EMPTY page (PR-1 final
 *  review): a single read stops at PostgREST's max_rows (1000) silently, and
 *  a page shorter than asked is not proof of the end under a lower max_rows. */
export async function countBilledAccountsByPlan(db: SupabaseClient): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  for (let from = 0; ; ) {
    const { data, error } = await db.from("account_billing").select("account_id, plan_id")
      .order("account_id", { ascending: true }).range(from, from + COUNT_PAGE - 1);
    if (error) throw new Error(`countBilledAccountsByPlan failed: ${error.message}`);
    const rows = (data ?? []) as { account_id: string; plan_id: string }[];
    for (const r of rows) out[r.plan_id] = (out[r.plan_id] ?? 0) + 1;
    if (rows.length === 0) return out;
    from += rows.length;
  }
}
```

In `packages/db/src/usage.ts`:
- `BilledUsageAccount.billingStartedAt`'s doc comment becomes `` /** `account_billing.billing_started_at` (0052), untouched: usage before it is never sent. */ ``.
- In `listBilledUsageAccounts`, the select becomes `"account_id, stripe_customer_id, billing_started_at"`, the row type's `created_at: string` becomes `billing_started_at: string`, and the push reads `billingStartedAt: r.billing_started_at`.
- Append:

```ts
const USAGE_SUM_PAGE = 1000;

/**
 * Month-to-date (or period-to-date) usage for ONE account, per meter: every
 * usage_events row of the account with occurred_at >= sinceIso, summed.
 * The billing screens' only source (never the Activity page's counts, which
 * count a chat at its start; billing counts it at Sofía's first reply).
 * Paged until an empty page; served by usage_events_account_occurred_idx.
 */
export async function sumUsageSince(db: SupabaseClient, accountId: string, sinceIso: string): Promise<MeterAmounts> {
  const out: MeterAmounts = { voice_minutes: 0, sms: 0, ai_chats: 0 };
  for (let from = 0; ; ) {
    const { data, error } = await db.from("usage_events").select("meter, quantity")
      .eq("account_id", accountId).gte("occurred_at", sinceIso)
      .order("occurred_at", { ascending: true }).order("id", { ascending: true })
      .range(from, from + USAGE_SUM_PAGE - 1);
    if (error) throw new Error(`sumUsageSince failed: ${error.message}`);
    const rows = (data ?? []) as { meter: MeterKey; quantity: number }[];
    for (const r of rows) out[r.meter] += r.quantity;
    if (rows.length === 0) return out;
    from += rows.length;
  }
}
```

(`usage.ts` already imports `MeterKey`; add `type MeterAmounts` to that import from `"./billing"`.)

- [ ] **Step 5: Export it**

Append to `packages/db/src/index.ts`:

```ts

// Client billing state (0051 account_billing + stripe_webhook_events, 0052
// billing_links): the webhook mirror, complimentary, links, the event ledger.
export { SUBSCRIPTION_STATUSES, ENDED_STATUSES, PAST_DUE_STATUSES, isSubscriptionStatus,
         getAccountBilling, getBillingLink, saveBillingLink, markBillingLinkExpired,
         decideMirror, mirrorSubscription, MIRROR_ATTEMPTS, markComplimentary, unmarkComplimentary, changeComplimentaryPlan,
         claimWebhookEvent, markWebhookEventProcessed,
         type SubscriptionStatus, type AccountBilling, type BillingLink, type BillingLinkWrite,
         type SubscriptionItemSnapshot, type SubscriptionSnapshot, type MirrorRefusal, type MirrorDecision,
         type MirrorOutcome, type MirrorPlan } from "./account-billing";
export { sumUsageSince } from "./usage";
```

- [ ] **Step 6: Typecheck and commit**

Run: `pnpm --filter @bis/db typecheck` → exit 0. Run: `pnpm --filter web typecheck` → exit 0.

```bash
git add packages/db/src/account-billing.ts packages/db/src/account-billing.test.ts packages/db/src/test/account-billing.test.ts packages/db/src/billing.ts packages/db/src/billing.test.ts packages/db/src/usage.ts packages/db/src/usage.test.ts packages/db/src/test/usage.test.ts packages/db/src/index.ts
git commit -m "feat(db): account-billing.ts (mirror, complimentary, links, event ledger); reporting floor = billing_started_at; paged plan counts; sumUsageSince"
```

The db tests run at the next CI push. The orchestrator folds Task 2's probes into Checkpoint A's probe branch if Task 2 lands before the probes run. Otherwise it runs a second probe round, one group per test title above.

---

### Task 3: The gateway: customers, Checkout, subscriptions, the portal, webhook verification

**Owner:** bis-platform (Stripe seam). No database.

**Files:**
- Modify: `apps/web/src/lib/billing/stripe-gateway.ts`
- Modify: `apps/web/src/lib/billing/fake-gateway.ts`
- Modify: `apps/web/src/lib/billing/stripe-gateway.test.ts` (+8)
- Create: `apps/web/src/lib/billing/stripe-webhook.test.ts` (3: webhook verification on the REAL SDK)

**Interfaces:**
- Consumes: `SubscriptionSnapshot`, `SubscriptionItemSnapshot`, `StripePriceIds`, `PlanPriceKey`, `METER_KEYS` (`@bis/db`).
- Produces (used by Tasks 4-12):
  - `idempotencyKey(prefix: string, id: string, params: unknown): string` (a SHA-256 of the canonical JSON: covers every parameter)
  - `type CheckoutInput = { accountId; planId; customerId; priceIds: StripePriceIds; successUrl; cancelUrl }`, `checkoutSessionParams(input): Stripe.Checkout.SessionCreateParams`
  - `subscriptionSnapshot(sub: Stripe.Subscription): SubscriptionSnapshot`
  - `PORTAL_VERSION = "v1"`, `portalConfigurationParams()`
  - `type VerifiedWebhookEvent = { id; type; livemode; subscriptionId: string | null }`, `HANDLED_WEBHOOK_EVENTS`, `verifyWebhookEvent(payload, signature, secret): VerifiedWebhookEvent` (throws on a bad signature)
  - `BillingGateway` gains `createCustomer`, `createCheckoutSession`, `getCheckoutSessionStatus`, `expireCheckoutSession`, `retrieveSubscription`, `updateSubscriptionPrices`, `listPortalConfigurations`, `createPortalConfiguration`, `createPortalSession`
  - `billingGatewayFromEnv()` success value gains `live: boolean`

- [ ] **Step 1: Write the failing tests**

Append to `apps/web/src/lib/billing/stripe-gateway.test.ts`. Keep its existing `import type Stripe from "stripe"` as it is: the tests appended here use `Stripe` only as a TYPE. A second, default `import Stripe` would be a duplicate identifier (TS2300). Add `checkoutSessionParams, idempotencyKey, subscriptionSnapshot, portalConfigurationParams, PORTAL_VERSION` to the existing import from `"./stripe-gateway"`; it already has `billingGatewayFromEnv` and `STRIPE_API_VERSION`, and `FakeGateway` is already imported. The webhook-verification tests are NOT here. This file `vi.mock`s the `stripe` module with a stub class, under which `Stripe.webhooks` does not exist; the plan review ran them here and got `TypeError: Cannot read properties of undefined (reading 'generateTestHeaderString')` ×3. They live in their own file, below.

```ts
const PRICES = { base: "price_b", voice_minutes: "price_v", sms: "price_s", ai_chats: "price_a" };
const CHECKOUT = {
  accountId: "11111111-1111-4111-8111-111111111111", planId: "22222222-2222-4222-8222-222222222222",
  customerId: "cus_1", priceIds: PRICES,
  successUrl: "https://app.example/billing-done?result=success", cancelUrl: "https://app.example/billing-done?result=cancelled",
};

describe("checkoutSessionParams", () => {
  it("is a subscription with the plan's FOUR prices: the base once, the three metered ones with no quantity (Stripe measures them), and the account + plan in BOTH the session's and the subscription's metadata (mutation: drop a meter price → FAILS; give a metered line a quantity → FAILS; drop subscription_data.metadata → the webhook cannot find the account, FAILS)", () => {
    expect(checkoutSessionParams(CHECKOUT)).toEqual({
      mode: "subscription", customer: "cus_1", client_reference_id: CHECKOUT.accountId,
      line_items: [{ price: "price_b", quantity: 1 }, { price: "price_v" }, { price: "price_s" }, { price: "price_a" }],
      subscription_data: { metadata: { bis_account_id: CHECKOUT.accountId, bis_plan_id: CHECKOUT.planId } },
      metadata: { bis_account_id: CHECKOUT.accountId, bis_plan_id: CHECKOUT.planId },
      success_url: CHECKOUT.successUrl, cancel_url: CHECKOUT.cancelUrl,
    });
  });

  it("refuses a non-customer id and a non-price id before anything leaves the process (mutation: drop either guard → FAILS)", () => {
    expect(() => checkoutSessionParams({ ...CHECKOUT, customerId: "acct_1" })).toThrow(/customerId/);
    expect(() => checkoutSessionParams({ ...CHECKOUT, priceIds: { ...PRICES, sms: "prod_x" } })).toThrow(/sms/);
  });
});

describe("idempotencyKey", () => {
  it("changes when ANY parameter changes, nested or not, and not when key order does (every key covers every parameter) (mutation: hash only the top-level keys → the nested change keeps the key, FAILS; hash JSON.stringify unsorted → the reordered object changes the key, FAILS)", () => {
    const k = idempotencyKey("bis-checkout", "req_1", CHECKOUT);
    expect(idempotencyKey("bis-checkout", "req_1", { ...CHECKOUT, priceIds: { ...PRICES, sms: "price_s2" } })).not.toBe(k);
    expect(idempotencyKey("bis-checkout", "req_2", CHECKOUT)).not.toBe(k);
    const reordered = Object.fromEntries(Object.entries(CHECKOUT).reverse());
    expect(idempotencyKey("bis-checkout", "req_1", reordered)).toBe(k);
    expect(k).toMatch(/^bis-checkout-req_1-[0-9a-f]{24}$/);
  });
});

describe("subscriptionSnapshot", () => {
  const sub = (over: Record<string, unknown> = {}) => ({
    id: "sub_1", customer: "cus_1", status: "past_due", start_date: 1_790_000_000,
    metadata: { bis_account_id: CHECKOUT.accountId, bis_plan_id: "stale-in-metadata" },
    items: {
      has_more: false,
      data: [
        { id: "si_b", current_period_start: 1_790_000_000, current_period_end: 1_792_592_000,
          price: { id: "price_b", metadata: { bis_plan_id: CHECKOUT.planId, bis_price: "base" } } },
        { id: "si_s", current_period_start: 1_790_000_060, current_period_end: 1_792_592_060,
          price: { id: "price_s", metadata: { bis_plan_id: CHECKOUT.planId, bis_price: "sms" } } },
      ],
    },
    ...over,
  }) as unknown as Stripe.Subscription;

  it("reads the plan from the BASE PRICE's metadata (not the subscription's), the period from the items (earliest), the customer id from an expanded customer too (G6) (mutation: plan from subscription metadata → 'stale-in-metadata', FAILS; period from the last item → FAILS)", () => {
    expect(subscriptionSnapshot(sub({ customer: { id: "cus_1" } }))).toEqual({
      id: "sub_1", customerId: "cus_1", status: "past_due", accountId: CHECKOUT.accountId, planId: CHECKOUT.planId,
      currentPeriodStart: 1_790_000_000, currentPeriodEnd: 1_792_592_000, startedAt: 1_790_000_000,
      items: [
        { id: "si_b", priceId: "price_b", priceKey: "base", planId: CHECKOUT.planId },
        { id: "si_s", priceId: "price_s", priceKey: "sms", planId: CHECKOUT.planId },
      ],
    });
  });

  it("refuses a subscription whose items do not fit one page rather than guess (B8) (mutation: ignore has_more → FAILS)", () => {
    expect(() => subscriptionSnapshot(sub({ items: { has_more: true, data: [] } }))).toThrow(/items/);
  });
});

describe("the new gateway surface", () => {
  it("portalConfigurationParams: card updates and invoice history ON; self-cancel, plan switching and profile edits OFF; tagged with the version BIS looks for (G19) (mutation: enable subscription_cancel → FAILS)", () => {
    expect(portalConfigurationParams()).toEqual({
      features: {
        invoice_history: { enabled: true }, payment_method_update: { enabled: true },
        customer_update: { enabled: false }, subscription_cancel: { enabled: false }, subscription_update: { enabled: false },
      },
      metadata: { bis_portal: PORTAL_VERSION },
    });
  });

  it("billingGatewayFromEnv says which MODE its key is, for the webhook's livemode check (mutation: always false → a live endpoint's every event is refused, FAILS)", () => {
    const test = billingGatewayFromEnv({ STRIPE_SECRET_KEY: "sk_test_x", NEXT_PUBLIC_SUPABASE_URL: "https://ci.supabase.co" });
    expect(test.ok && test.live).toBe(false);
    const live = billingGatewayFromEnv({ STRIPE_SECRET_KEY: "sk_live_x", VERCEL_ENV: "production", NEXT_PUBLIC_SUPABASE_URL: "https://tlbkbmlrfafquucsmsmm.supabase.co" });
    expect(live.ok && live.live).toBe(true);
  });

  it("FakeGateway.createCheckoutSession replays one key, refuses the same key with other params, and expire only works on an open session, as Stripe does (mutation: mint a new session on a replayed key → FAILS)", async () => {
    const fake = new FakeGateway();
    const a = await fake.createCheckoutSession(CHECKOUT, "k1");
    expect(await fake.createCheckoutSession(CHECKOUT, "k1")).toEqual(a);
    await expect(fake.createCheckoutSession({ ...CHECKOUT, customerId: "cus_2" }, "k1")).rejects.toThrow(/idempotency/);
    expect(await fake.getCheckoutSessionStatus(a.id)).toBe("open");
    await fake.expireCheckoutSession(a.id);
    expect(await fake.getCheckoutSessionStatus(a.id)).toBe("expired");
    await expect(fake.expireCheckoutSession(a.id)).rejects.toThrow(/open/);
  });
});
```

Create `apps/web/src/lib/billing/stripe-webhook.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import Stripe from "stripe";
import { isSignatureError, STRIPE_API_VERSION, verifyWebhookEvent } from "./stripe-gateway";

/**
 * Webhook verification against the REAL Stripe SDK: signed with its own
 * generateTestHeaderString, verified by its own constructEvent. Its own file
 * on purpose: stripe-gateway.test.ts replaces the "stripe" module with a
 * stub class (vi.mock), under which Stripe.webhooks does not exist.
 */
describe("verifyWebhookEvent (the real SDK, signed fixtures)", () => {
  const SECRET = "whsec_unit_fixture";
  const payload = JSON.stringify({
    id: "evt_1", object: "event", type: "invoice.payment_failed", livemode: false, api_version: STRIPE_API_VERSION,
    data: { object: { id: "in_1", object: "invoice", parent: { subscription_details: { subscription: "sub_9" } } } },
  });

  it("accepts a correctly signed payload and returns the id, type, mode and the ONE subscription id to re-read (mutation: return the payload's status or any other field → the shape FAILS)", () => {
    const header = Stripe.webhooks.generateTestHeaderString({ payload, secret: SECRET });
    expect(verifyWebhookEvent(payload, header, SECRET)).toEqual({
      id: "evt_1", type: "invoice.payment_failed", livemode: false, subscriptionId: "sub_9",
    });
  });

  it("throws on a tampered body, the wrong secret, a stale timestamp and a missing header, each as a signature error (mutation: JSON.parse first and verify re-serialised → the one-space tamper still verifies, FAILS)", () => {
    const header = Stripe.webhooks.generateTestHeaderString({ payload, secret: SECRET });
    const stale = Stripe.webhooks.generateTestHeaderString({ payload, secret: SECRET, timestamp: Math.floor(Date.now() / 1000) - 600 });
    for (const [body, sig, secret] of [[`${payload} `, header, SECRET], [payload, header, "whsec_other"], [payload, stale, SECRET], [payload, "", SECRET]]) {
      let caught: unknown = null;
      try { verifyWebhookEvent(body!, sig!, secret!); } catch (e) { caught = e; }
      expect(isSignatureError(caught)).toBe(true);
    }
  });

  it("maps each handled type to its subscription, and everything else to null: payment-mode checkouts, unhandled types, a legacy top-level invoice.subscription still maps (B7) (mutation: drop the legacy fallback → FAILS; map a payment-mode session → FAILS)", () => {
    const signed = (obj: object, type: string) => {
      const p = JSON.stringify({ id: "evt_x", object: "event", type, livemode: true, data: { object: obj } });
      return verifyWebhookEvent(p, Stripe.webhooks.generateTestHeaderString({ payload: p, secret: SECRET }), SECRET).subscriptionId;
    };
    expect(signed({ object: "checkout.session", mode: "subscription", subscription: "sub_c" }, "checkout.session.completed")).toBe("sub_c");
    expect(signed({ object: "checkout.session", mode: "payment", subscription: null }, "checkout.session.completed")).toBeNull();
    for (const t of ["customer.subscription.created", "customer.subscription.updated", "customer.subscription.deleted"]) {
      expect(signed({ id: "sub_s", object: "subscription" }, t)).toBe("sub_s");
    }
    expect(signed({ id: "in_1", object: "invoice", parent: null, subscription: "sub_legacy" }, "invoice.paid")).toBe("sub_legacy");
    expect(signed({ id: "cus_1", object: "customer" }, "customer.updated")).toBeNull();
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm --filter web exec vitest run src/lib/billing/stripe-gateway.test.ts src/lib/billing/stripe-webhook.test.ts`
Expected: FAIL (the new names are not exported).

- [ ] **Step 3: The gateway**

In `apps/web/src/lib/billing/stripe-gateway.ts`:

Replace the imports at the top with:

```ts
import { createHash } from "node:crypto";
import Stripe from "stripe";
import {
  METER_KEYS, type MeterKey, type PlanPriceKey, type StripePriceIds,
  type SubscriptionItemSnapshot, type SubscriptionSnapshot,
} from "@bis/db";
```

Add after the `MeterEventInput` type:

```ts
/** A Checkout session for one account on one plan (spec flow 2). */
export type CheckoutInput = {
  accountId: string;
  planId: string;
  customerId: string;
  priceIds: StripePriceIds;
  successUrl: string;
  cancelUrl: string;
};
export type CheckoutSession = { id: string; url: string; expiresAt: number };
export type CheckoutStatus = "open" | "complete" | "expired";
/** Change plan (G15): each item's price swapped in place. */
export type SubscriptionPriceChange = { subscriptionId: string; planId: string; items: { id: string; price: string }[] };
export type PortalSessionInput = { customerId: string; returnUrl: string; configurationId: string };
export type PortalConfiguration = { id: string; metadata: Record<string, string> };
```

Extend `BillingGateway` (keep the six existing members; add):

```ts
  createCustomer(input: { accountId: string; name: string | null; email: string }, idempotencyKey: string): Promise<{ id: string }>;
  createCheckoutSession(input: CheckoutInput, idempotencyKey: string): Promise<CheckoutSession>;
  getCheckoutSessionStatus(sessionId: string): Promise<CheckoutStatus>;
  expireCheckoutSession(sessionId: string): Promise<void>;
  retrieveSubscription(subscriptionId: string): Promise<SubscriptionSnapshot>;
  updateSubscriptionPrices(change: SubscriptionPriceChange, idempotencyKey: string): Promise<void>;
  listPortalConfigurations(): Promise<PortalConfiguration[]>;
  createPortalConfiguration(idempotencyKey: string): Promise<{ id: string }>;
  createPortalSession(input: PortalSessionInput): Promise<{ url: string }>;
```

Add before `stripeGateway`:

```ts
/** JSON with every object's keys sorted, recursively: equal params → equal
 *  text, whatever order they were built in. */
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value as Record<string, unknown>).sort()
      .map((k) => [k, canonical((value as Record<string, unknown>)[k])]));
  }
  return value;
}

/**
 * An idempotency key that covers EVERY parameter the request sends (PR-1's
 * correction): `<prefix>-<id>-<24 hex of sha256(canonical params)>`. The same
 * request retried replays; any changed parameter is a new request, never a
 * 400 from Stripe for reusing a key with different parameters. Under
 * Stripe's 255-character limit for any id under 200 characters.
 */
export function idempotencyKey(prefix: string, id: string, params: unknown): string {
  const hash = createHash("sha256").update(JSON.stringify(canonical(params))).digest("hex").slice(0, 24);
  return `${prefix}-${id}-${hash}`;
}

const PRICE_KEYS: readonly PlanPriceKey[] = ["base", ...METER_KEYS];

/**
 * The Checkout mapping (spec flow 2): subscription mode, the plan's base
 * price once and its three metered prices WITHOUT a quantity (Stripe
 * measures them; assumption B1, proven by the e2e), the account and plan in
 * the session's metadata AND the subscription's (the webhook reads the
 * subscription's), and client_reference_id for the dashboard. Guarded like
 * priceCreateParams: a wrong id never leaves the process.
 */
export function checkoutSessionParams(input: CheckoutInput): Stripe.Checkout.SessionCreateParams {
  if (!input.customerId.startsWith("cus_")) {
    throw new Error(`checkoutSessionParams: customerId must be a Stripe customer id (cus_), got ${input.customerId}`);
  }
  for (const key of PRICE_KEYS) {
    if (!input.priceIds[key]?.startsWith("price_")) {
      throw new Error(`checkoutSessionParams: ${key} must be a Stripe price id (price_), got ${input.priceIds[key]}`);
    }
  }
  const metadata = { bis_account_id: input.accountId, bis_plan_id: input.planId };
  return {
    mode: "subscription",
    customer: input.customerId,
    client_reference_id: input.accountId,
    line_items: [
      { price: input.priceIds.base, quantity: 1 },
      { price: input.priceIds.voice_minutes },
      { price: input.priceIds.sms },
      { price: input.priceIds.ai_chats },
    ],
    subscription_data: { metadata },
    metadata,
    success_url: input.successUrl,
    cancel_url: input.cancelUrl,
  };
}

/**
 * What BIS keeps of a subscription (G6). The plan is the BASE item's price
 * metadata (every BIS price carries bis_plan_id and bis_price), never the
 * subscription's own metadata, which a Change plan could leave stale and a
 * dashboard edit could forge. The period lives on the ITEMS in this API
 * version; the earliest across items is the period.
 */
export function subscriptionSnapshot(sub: Stripe.Subscription): SubscriptionSnapshot {
  if (sub.items.has_more) throw new Error(`subscriptionSnapshot: ${sub.id} has more items than one page; refusing to guess`);
  const items: SubscriptionItemSnapshot[] = sub.items.data.map((it) => {
    const key = it.price.metadata?.bis_price ?? "";
    return {
      id: it.id,
      priceId: it.price.id,
      priceKey: (PRICE_KEYS as readonly string[]).includes(key) ? (key as PlanPriceKey) : null,
      planId: it.price.metadata?.bis_plan_id ?? null,
    };
  });
  const starts = sub.items.data.map((it) => it.current_period_start);
  const ends = sub.items.data.map((it) => it.current_period_end);
  return {
    id: sub.id,
    customerId: typeof sub.customer === "string" ? sub.customer : sub.customer.id,
    status: sub.status,
    accountId: sub.metadata?.bis_account_id ?? null,
    planId: items.find((i) => i.priceKey === "base")?.planId ?? null,
    currentPeriodStart: starts.length > 0 ? Math.min(...starts) : null,
    currentPeriodEnd: ends.length > 0 ? Math.min(...ends) : null,
    startedAt: sub.start_date,
    items,
  };
}

/** The portal configuration BIS creates and later finds by this tag (G19). */
export const PORTAL_VERSION = "v1";

/** Update a card and see invoices. No self-cancel, no plan switching, no
 *  profile edits: the agency manages plans (decided, danlo 2026-09-25). */
export function portalConfigurationParams(): Stripe.BillingPortal.ConfigurationCreateParams {
  return {
    features: {
      invoice_history: { enabled: true },
      payment_method_update: { enabled: true },
      customer_update: { enabled: false },
      subscription_cancel: { enabled: false },
      subscription_update: { enabled: false },
    },
    metadata: { bis_portal: PORTAL_VERSION },
  };
}

/** The six events the endpoint subscribes to (spec flow 4; Task 13 Step 5). */
export const HANDLED_WEBHOOK_EVENTS = [
  "checkout.session.completed", "customer.subscription.created", "customer.subscription.updated",
  "customer.subscription.deleted", "invoice.paid", "invoice.payment_failed",
] as const;

/** A verified event, reduced to what BIS acts on: which subscription to
 *  re-read. Nothing else from the payload is ever used (G5). */
export type VerifiedWebhookEvent = { id: string; type: string; livemode: boolean; subscriptionId: string | null };

function idOf(ref: string | { id: string } | null | undefined): string | null {
  if (!ref) return null;
  return typeof ref === "string" ? ref : ref.id;
}

function subscriptionIdOf(event: Stripe.Event): string | null {
  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object;
      return session.mode === "subscription" ? idOf(session.subscription) : null;
    }
    case "customer.subscription.created":
    case "customer.subscription.updated":
    case "customer.subscription.deleted":
      return event.data.object.id;
    case "invoice.paid":
    case "invoice.payment_failed": {
      const invoice = event.data.object;
      // `parent.subscription_details` in this API version; the top-level
      // `subscription` is what an endpoint on an older version sends (B7).
      return idOf(invoice.parent?.subscription_details?.subscription)
        ?? idOf((invoice as unknown as { subscription?: string | { id: string } | null }).subscription);
    }
    default:
      return null;
  }
}

/**
 * Verifies `stripe-signature` over the RAW body (the exact string Stripe
 * signed; never a re-serialised parse) with Stripe's static helper, and
 * reduces the event. Throws a StripeSignatureVerificationError on a bad or
 * stale signature (tolerance: the SDK's 300 s default).
 */
export function verifyWebhookEvent(payload: string, signature: string, secret: string): VerifiedWebhookEvent {
  const event = Stripe.webhooks.constructEvent(payload, signature, secret);
  return { id: event.id, type: event.type, livemode: event.livemode, subscriptionId: subscriptionIdOf(event) };
}

export function isSignatureError(e: unknown): boolean {
  return typeof e === "object" && e !== null && (e as { type?: unknown }).type === "StripeSignatureVerificationError";
}
```

Add to the object `stripeGateway(stripe)` returns (after `reportMeterEvent`):

```ts
    async createCustomer({ accountId, name, email }, idempotencyKey) {
      const c = await stripe.customers.create(
        { email, metadata: { bis_account_id: accountId }, ...(name ? { name } : {}) },
        { idempotencyKey },
      );
      return { id: c.id };
    },
    async createCheckoutSession(input, idempotencyKey) {
      const s = await stripe.checkout.sessions.create(checkoutSessionParams(input), { idempotencyKey });
      if (!s.url) throw new Error(`createCheckoutSession: Stripe returned session ${s.id} with no url`);
      return { id: s.id, url: s.url, expiresAt: s.expires_at };
    },
    async getCheckoutSessionStatus(sessionId) {
      const s = await stripe.checkout.sessions.retrieve(sessionId);
      // Widened first: Stripe's type ends in `| OtherString`, which an
      // equality check does not narrow away (TS2322 without this line).
      const status: string | null = s.status;
      if (status === "open" || status === "complete" || status === "expired") return status;
      throw new Error(`getCheckoutSessionStatus: ${sessionId} has status ${String(status)}`);
    },
    async expireCheckoutSession(sessionId) {
      await stripe.checkout.sessions.expire(sessionId);
    },
    async retrieveSubscription(subscriptionId) {
      return subscriptionSnapshot(await stripe.subscriptions.retrieve(subscriptionId));
    },
    async updateSubscriptionPrices(change, idempotencyKey) {
      await stripe.subscriptions.update(change.subscriptionId, {
        items: change.items.map((i) => ({ id: i.id, price: i.price })),
        proration_behavior: "create_prorations",
        metadata: { bis_plan_id: change.planId },
      }, { idempotencyKey });
    },
    async listPortalConfigurations() {
      const page = await stripe.billingPortal.configurations.list({ active: true, limit: 100 });
      if (page.has_more) throw new Error("listPortalConfigurations: more than 100 active configurations; refusing to guess");
      return page.data.map((c) => ({ id: c.id, metadata: c.metadata ?? {} }));
    },
    async createPortalConfiguration(idempotencyKey) {
      const c = await stripe.billingPortal.configurations.create(portalConfigurationParams(), { idempotencyKey });
      return { id: c.id };
    },
    async createPortalSession({ customerId, returnUrl, configurationId }) {
      const s = await stripe.billingPortal.sessions.create({ customer: customerId, return_url: returnUrl, configuration: configurationId });
      return { url: s.url };
    },
```

Replace `billingGatewayFromEnv` with (the return type gains `live`):

```ts
export function billingGatewayFromEnv(
  // `process.env` satisfies this shape structurally at runtime, but its
  // properties come from an index signature, which TS's weak-type check does
  // not count: hence the explicit cast rather than a bare default.
  env: StripeEnv = process.env as StripeEnv,
): { ok: true; gateway: BillingGateway; live: boolean } | Extract<StripeKeyVerdict, { ok: false }> {
  const verdict = stripeKeyVerdict(env);
  if (!verdict.ok) return verdict;
  const stripe = new Stripe(verdict.key, { apiVersion: STRIPE_API_VERSION, maxNetworkRetries: 2, timeout: 20_000 });
  const live = verdict.key.startsWith("sk_live_") || verdict.key.startsWith("rk_live_");
  return { ok: true, gateway: stripeGateway(stripe), live };
}
```

- [ ] **Step 4: The fake**

In `apps/web/src/lib/billing/fake-gateway.ts`:
- Import `checkoutSessionParams`, `PORTAL_VERSION`, `type CheckoutInput`, `type CheckoutSession`, `type CheckoutStatus`, `type SubscriptionPriceChange`, `type PortalSessionInput`, `type PortalConfiguration` from `"./stripe-gateway"`, and `type SubscriptionSnapshot` from `"@bis/db"`.
- Extend `GatewayOp` with `| "createCustomer" | "createCheckoutSession" | "getCheckoutSessionStatus" | "expireCheckoutSession" | "retrieveSubscription" | "updateSubscriptionPrices" | "listPortalConfigurations" | "createPortalConfiguration" | "createPortalSession"`.
- In `once`, replace the `prefix` line with a lookup:

```ts
    const PREFIX: Partial<Record<GatewayOp, string>> = {
      createMeter: "mtr", createProduct: "prod", createPrice: "price", createCustomer: "cus",
      createCheckoutSession: "cs_test", createPortalConfiguration: "bpc",
    };
    const value = make(`${PREFIX[op] ?? "obj"}_${++this.seq}`);
```

- Add these fields and methods to the class:

```ts
  /** Stripe's clock for sessions the fake makes (seconds). */
  clockSeconds = 1_790_000_000;
  readonly customers: Array<{ id: string; accountId: string; name: string | null; email: string }> = [];
  readonly checkoutSessions = new Map<string, CheckoutSession & { status: CheckoutStatus; input: CheckoutInput }>();
  /** Seed with the subscriptions a test's "Stripe" holds; retrieveSubscription reads here. */
  readonly subscriptions = new Map<string, SubscriptionSnapshot>();
  readonly subscriptionChanges: Array<{ change: SubscriptionPriceChange; key: string }> = [];
  portalConfigurations: PortalConfiguration[] = [];
  readonly portalSessions: PortalSessionInput[] = [];

  async createCustomer(input: { accountId: string; name: string | null; email: string }, key: string): Promise<{ id: string }> {
    this.step("createCustomer", input, key);
    return this.once("createCustomer", key, input, (id) => {
      this.customers.push({ id, ...input });
      return { id };
    });
  }

  async createCheckoutSession(input: CheckoutInput, key: string): Promise<CheckoutSession> {
    checkoutSessionParams(input);
    this.step("createCheckoutSession", input, key);
    return this.once("createCheckoutSession", key, input, (id) => {
      const session = { id, url: `https://checkout.stripe.test/c/pay/${id}`, expiresAt: this.clockSeconds + 86_400 };
      this.checkoutSessions.set(id, { ...session, status: "open", input });
      return session;
    });
  }

  async getCheckoutSessionStatus(sessionId: string): Promise<CheckoutStatus> {
    this.step("getCheckoutSessionStatus", { sessionId });
    const s = this.checkoutSessions.get(sessionId);
    if (!s) throw new Error(`fake Stripe: no such checkout session ${sessionId}`);
    return s.status;
  }

  async expireCheckoutSession(sessionId: string): Promise<void> {
    this.step("expireCheckoutSession", { sessionId });
    const s = this.checkoutSessions.get(sessionId);
    if (!s || s.status !== "open") throw new Error(`fake Stripe: only an open session can be expired (${sessionId})`);
    s.status = "expired";
  }

  async retrieveSubscription(subscriptionId: string): Promise<SubscriptionSnapshot> {
    this.step("retrieveSubscription", { subscriptionId });
    const s = this.subscriptions.get(subscriptionId);
    if (!s) throw new Error(`fake Stripe: no such subscription ${subscriptionId}`);
    return structuredClone(s);
  }

  /** Same replay strictness as the creates (A4); applies the swap to the
   *  held subscription so a re-read after it sees the new plan. */
  async updateSubscriptionPrices(change: SubscriptionPriceChange, key: string): Promise<void> {
    this.step("updateSubscriptionPrices", change, key);
    const seen = this.replay.get(key);
    if (seen) {
      if (seen.op !== "updateSubscriptionPrices" || !sameInput(seen.input, change)) {
        throw new Error(`fake Stripe: idempotency key "${key}" was already used with different parameters (A4)`);
      }
      return;
    }
    this.replay.set(key, { op: "updateSubscriptionPrices", input: change, value: undefined });
    this.subscriptionChanges.push({ change, key });
    const sub = this.subscriptions.get(change.subscriptionId);
    if (!sub) throw new Error(`fake Stripe: no such subscription ${change.subscriptionId}`);
    for (const { id, price } of change.items) {
      const item = sub.items.find((i) => i.id === id);
      if (!item) throw new Error(`fake Stripe: no item ${id} on ${change.subscriptionId}`);
      item.priceId = price;
      item.planId = change.planId;
    }
    sub.planId = change.planId;
  }

  async listPortalConfigurations(): Promise<PortalConfiguration[]> {
    this.step("listPortalConfigurations");
    return this.portalConfigurations.map((c) => ({ ...c }));
  }

  async createPortalConfiguration(key: string): Promise<{ id: string }> {
    this.step("createPortalConfiguration", undefined, key);
    return this.once("createPortalConfiguration", key, { version: PORTAL_VERSION }, (id) => {
      this.portalConfigurations.push({ id, metadata: { bis_portal: PORTAL_VERSION } });
      return { id };
    });
  }

  async createPortalSession(input: PortalSessionInput): Promise<{ url: string }> {
    this.step("createPortalSession", input);
    this.portalSessions.push(input);
    return { url: `https://billing.stripe.test/p/session/${input.customerId}` };
  }
```

`structuredClone` exists in Node 24 (the repo's runtime).

- [ ] **Step 5: Run them to verify they pass, and nothing else broke**

Run: `pnpm --filter web exec vitest run src/lib/billing/`
Expected: all pass. The PR-2 baseline was 56 in `stripe-gateway.test.ts`; it is now 64. `stripe-webhook.test.ts` has 3.

Run: `pnpm --filter web typecheck`
Expected: exit 0. A typecheck error in any other `BillingGateway` literal (a test double that hand-builds the interface) is fixed by adding the new members as `vi.fn()` or by switching it to `FakeGateway`. Grep first: `grep -rn "BillingGateway = {\|as BillingGateway" apps/web/src`.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/lib/billing/stripe-gateway.ts apps/web/src/lib/billing/fake-gateway.ts apps/web/src/lib/billing/stripe-gateway.test.ts apps/web/src/lib/billing/stripe-webhook.test.ts
git commit -m "feat(billing): gateway for customers, Checkout, subscriptions, the portal and webhook verification"
```

---

### Task 4: `processStripeEvent`, the webhook's decision path

**Owner:** bis-platform.

**Files:**
- Create: `apps/web/src/lib/billing/webhook.ts`
- Create: `apps/web/src/lib/billing/webhook.test.ts` (7 tests)

**Interfaces:**
- Consumes: `claimWebhookEvent`, `markWebhookEventProcessed`, `mirrorSubscription`, `type SupabaseClient` (`@bis/db`); `type BillingGateway`, `type VerifiedWebhookEvent` (Task 3).
- Produces: `type WebhookOutcome`, `processStripeEvent(deps, event): Promise<WebhookOutcome>` (used by Task 5).

- [ ] **Step 1: Write the failing tests**

Create `apps/web/src/lib/billing/webhook.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { SubscriptionSnapshot } from "@bis/db";

const db = vi.hoisted(() => ({
  claimWebhookEvent: vi.fn(),
  markWebhookEventProcessed: vi.fn(),
  mirrorSubscription: vi.fn(),
}));
vi.mock("@bis/db", async (importOriginal) => ({ ...(await importOriginal<object>()), ...db }));

const { processStripeEvent } = await import("./webhook");
const { FakeGateway } = await import("./fake-gateway");

const NOW = new Date("2026-10-01T12:00:00.000Z");
const SUB: SubscriptionSnapshot = {
  id: "sub_1", customerId: "cus_1", status: "past_due", accountId: "acct", planId: "plan",
  currentPeriodStart: 1, currentPeriodEnd: 2, startedAt: 1, items: [],
};
const event = (over: Partial<{ id: string; type: string; livemode: boolean; subscriptionId: string | null }> = {}) => ({
  id: "evt_1", type: "invoice.payment_failed", livemode: false, subscriptionId: "sub_1", ...over,
});

let gateway: InstanceType<typeof FakeGateway>;
/** What each mirror call's reader returned. The mocked mirror reads Stripe
 *  once through the reader it was handed, like one attempt of the real one. */
let mirrored: SubscriptionSnapshot[];
const deps = () => ({ db: {} as never, gateway, live: false, now: () => NOW });

beforeEach(() => {
  gateway = new FakeGateway();
  gateway.subscriptions.set("sub_1", structuredClone(SUB));
  mirrored = [];
  db.claimWebhookEvent.mockReset().mockResolvedValue("new");
  db.markWebhookEventProcessed.mockReset().mockResolvedValue(undefined);
  db.mirrorSubscription.mockReset().mockImplementation(async (_db: unknown, read: () => Promise<SubscriptionSnapshot>) => {
    const s = await read();
    mirrored.push(s);
    return { kind: "written", accountId: s.accountId, planId: s.planId, status: s.status };
  });
});

describe("processStripeEvent", () => {
  it("mirrors what Stripe SAYS NOW, re-read by id, never the event: the mirror's reader is the gateway's retrieveSubscription for the event's subscription, and the event is stamped after the mirror (mutation: hand the mirror a reader that returns the event's own data → retrieveSubscription is never called, FAILS; stamp before mirroring → FAILS)", async () => {
    expect(await processStripeEvent(deps(), event())).toEqual({ status: "processed", accountId: "acct" });
    expect(gateway.calls.map((c) => c.op)).toEqual(["retrieveSubscription"]);
    expect(mirrored).toEqual([SUB]);
    expect(db.mirrorSubscription.mock.calls[0]![0]).toEqual({});
    expect(db.mirrorSubscription.mock.invocationCallOrder[0]!)
      .toBeLessThan(db.markWebhookEventProcessed.mock.invocationCallOrder[0]!);
  });

  it("a DUPLICATE (already stamped) is acknowledged without reading Stripe or writing anything (mutation: ignore 'done' → FAILS)", async () => {
    db.claimWebhookEvent.mockResolvedValue("done");
    expect(await processStripeEvent(deps(), event())).toEqual({ status: "duplicate" });
    expect(gateway.calls).toEqual([]);
    expect(db.mirrorSubscription).not.toHaveBeenCalled();
    expect(db.markWebhookEventProcessed).not.toHaveBeenCalled();
  });

  it("a RETRY (stored, never stamped: an earlier attempt threw) is processed again in full (mutation: treat 'retry' like 'done' → a failed event is lost forever, FAILS)", async () => {
    db.claimWebhookEvent.mockResolvedValue("retry");
    expect((await processStripeEvent(deps(), event())).status).toBe("processed");
    expect(db.mirrorSubscription).toHaveBeenCalledTimes(1);
  });

  it("out of order converges: an older 'updated' processed AFTER 'deleted' still writes Stripe's current state (canceled), because both re-read (G5) (mutation: skip the re-read when the event type is 'updated' → FAILS)", async () => {
    gateway.subscriptions.set("sub_1", { ...SUB, status: "canceled" });
    await processStripeEvent(deps(), event({ id: "evt_del", type: "customer.subscription.deleted" }));
    await processStripeEvent(deps(), event({ id: "evt_old", type: "customer.subscription.updated" }));
    expect(mirrored.map((s) => s.status)).toEqual(["canceled", "canceled"]);
  });

  it("an event with no subscription to follow (an unhandled type, a payment-mode checkout) is stamped and ignored, with no Stripe read (mutation: leave it unstamped → Stripe's retry reprocesses it forever, FAILS)", async () => {
    expect(await processStripeEvent(deps(), event({ type: "customer.updated", subscriptionId: null }))).toEqual({ status: "ignored" });
    expect(gateway.calls).toEqual([]);
    expect(db.markWebhookEventProcessed).toHaveBeenCalledWith({}, "evt_1", NOW);
  });

  it("a REFUSED mirror is stamped (a retry cannot fix it) and logged; an event from the wrong MODE is not even recorded (mutation: leave a refusal unstamped → FAILS; record a wrong-mode event → FAILS)", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    db.mirrorSubscription.mockResolvedValue({ kind: "refused", reason: "customer_mismatch" });
    expect(await processStripeEvent(deps(), event())).toEqual({ status: "refused", reason: "customer_mismatch" });
    expect(db.markWebhookEventProcessed).toHaveBeenCalledTimes(1);
    expect(log.mock.calls.flat().join(" ")).toContain("customer_mismatch");
    db.claimWebhookEvent.mockClear();
    expect(await processStripeEvent(deps(), event({ livemode: true }))).toEqual({ status: "mode_mismatch" });
    expect(db.claimWebhookEvent).not.toHaveBeenCalled();
    log.mockRestore();
  });

  it("a Stripe read that FAILS propagates and leaves the event UNSTAMPED, so Stripe's retry processes it (mutation: stamp in a finally → the event is marked done and never retried, FAILS)", async () => {
    gateway.failOn = { op: "retrieveSubscription" };
    await expect(processStripeEvent(deps(), event())).rejects.toThrow(/refused retrieveSubscription/);
    expect(db.markWebhookEventProcessed).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter web exec vitest run src/lib/billing/webhook.test.ts` → FAIL (no module).

- [ ] **Step 3: Write `webhook.ts`**

Create `apps/web/src/lib/billing/webhook.ts`:

```ts
import {
  claimWebhookEvent, markWebhookEventProcessed, mirrorSubscription, type MirrorRefusal, type SupabaseClient,
} from "@bis/db";
import type { BillingGateway, VerifiedWebhookEvent } from "./stripe-gateway";

export type WebhookOutcome =
  | { status: "processed"; accountId: string }
  | { status: "ignored" }
  | { status: "duplicate" }
  | { status: "refused"; reason: MirrorRefusal }
  | { status: "mode_mismatch" };

export type WebhookDeps = { db: SupabaseClient; gateway: BillingGateway; live: boolean; now: () => Date };

/**
 * One verified Stripe event (spec flow 4, plan G4):
 *   wrong mode (a test event at a live key, or the reverse) → not recorded;
 *   claim the id once → "done" means a duplicate, nothing else happens;
 *   no subscription to follow → stamp, ignore;
 *   otherwise the mirror RE-READS the subscription from Stripe (it is handed
 *   the reader, never the event's payload, so duplicates and out-of-order
 *   events converge; and it reads the stored row first and writes only if
 *   it is unchanged, so concurrent deliveries do too: B5), then stamp. A
 *   refusal is stamped too (retrying cannot fix it) and logged.
 * Anything that throws leaves the event unstamped: the route answers 500,
 * Stripe retries, and the next attempt claims it as "retry".
 */
export async function processStripeEvent(deps: WebhookDeps, event: VerifiedWebhookEvent): Promise<WebhookOutcome> {
  if (event.livemode !== deps.live) {
    console.error(`stripe webhook: ${event.type} ${event.id} is ${event.livemode ? "live" : "test"} mode but this deployment's key is not; not recorded`);
    return { status: "mode_mismatch" };
  }
  const claim = await claimWebhookEvent(deps.db, event.id, event.type);
  if (claim === "done") return { status: "duplicate" };
  const subscriptionId = event.subscriptionId;
  if (!subscriptionId) {
    await markWebhookEventProcessed(deps.db, event.id, deps.now());
    return { status: "ignored" };
  }
  const outcome = await mirrorSubscription(deps.db, () => deps.gateway.retrieveSubscription(subscriptionId), deps.now);
  await markWebhookEventProcessed(deps.db, event.id, deps.now());
  if (outcome.kind === "refused") {
    console.error(`stripe webhook: ${event.type} ${event.id} for subscription ${subscriptionId} refused: ${outcome.reason}`);
    return { status: "refused", reason: outcome.reason };
  }
  return { status: "processed", accountId: outcome.accountId };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter web exec vitest run src/lib/billing/webhook.test.ts` → `Tests  7 passed (7)`.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/billing/webhook.ts apps/web/src/lib/billing/webhook.test.ts
git commit -m "feat(billing): processStripeEvent — claim once, re-read the subscription, mirror, stamp"
```

---

### Task 5: `POST /api/webhooks/stripe`, and the CI secret

**Owner:** bis-platform.

**Files:**
- Create: `apps/web/src/app/api/webhooks/stripe/route.ts`
- Create: `apps/web/src/app/api/webhooks/stripe/route.test.ts` (6 tests)
- Modify: `.github/workflows/ci.yml` (e2e job env: `STRIPE_WEBHOOK_SECRET` literal)
- Modify: `apps/web/ci/ci-workflow.test.ts` (+1)
- Modify: `.env.example` (the Stripe block)

**Interfaces:**
- Consumes: `serviceDb` (`@bis/db`); `billingGatewayFromEnv`, `verifyWebhookEvent`, `type StripeEnv` (Task 3); `processStripeEvent` (Task 4).
- Produces: the public endpoint Stripe calls (and the e2e signs fixtures for).

- [ ] **Step 1: Write the failing tests**

Create `apps/web/src/app/api/webhooks/stripe/route.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import Stripe from "stripe";

const processMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/billing/webhook", () => ({ processStripeEvent: (...a: unknown[]) => processMock(...a) }));
vi.mock("@bis/db", async (importOriginal) => ({ ...(await importOriginal<object>()), serviceDb: () => ({ tag: "service" }) }));

const route = await import("./route");
const { POST } = route;

const SECRET = "whsec_route_fixture";
/** Deliberately NOT what JSON.stringify would print: odd spacing and key
 *  order. Only a verifier that reads the raw text accepts it. */
const RAW = '{ "type":"invoice.paid",  "id":"evt_r1","object":"event","livemode":false,\n "data":{"object":{"id":"in_1","object":"invoice","parent":{"subscription_details":{"subscription":"sub_r1"}}}} }';
const signed = (body: string, secret = SECRET) =>
  new Request("http://localhost/api/webhooks/stripe", {
    method: "POST",
    headers: { "stripe-signature": Stripe.webhooks.generateTestHeaderString({ payload: body, secret }) },
    body,
  });

const saved = { ...process.env };
beforeEach(() => {
  process.env.STRIPE_WEBHOOK_SECRET = SECRET;
  process.env.STRIPE_SECRET_KEY = "sk_test_route";
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://odnobiodsftffphuuosz.supabase.co";
  delete process.env.VERCEL_ENV;
  processMock.mockReset().mockResolvedValue({ status: "processed", accountId: "acct" });
});
afterEach(() => { process.env = { ...saved }; });

describe("POST /api/webhooks/stripe", () => {
  it("answers 503 with no signing secret configured, reading nothing (so Stripe keeps retrying until it is set) (mutation: default the secret to '' and verify anyway → 400, FAILS)", async () => {
    delete process.env.STRIPE_WEBHOOK_SECRET;
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    expect((await POST(signed(RAW))).status).toBe(503);
    expect(processMock).not.toHaveBeenCalled();
    log.mockRestore();
  });

  it("answers 400 to a bad signature and never processes it: the security boundary (mutation: process before verifying → FAILS)", async () => {
    expect((await POST(signed(RAW, "whsec_forged"))).status).toBe(400);
    expect(processMock).not.toHaveBeenCalled();
  });

  it("verifies the RAW body, byte for byte: an oddly spaced, oddly ordered payload Stripe signed is accepted and reduced to its subscription (mutation: verify JSON.stringify(await request.json()) instead → the signature no longer matches, 400, FAILS)", async () => {
    const res = await POST(signed(RAW));
    expect(res.status).toBe(200);
    expect(processMock).toHaveBeenCalledWith(
      expect.objectContaining({ live: false, db: { tag: "service" } }),
      { id: "evt_r1", type: "invoice.paid", livemode: false, subscriptionId: "sub_r1" },
    );
  });

  it("answers 500 when processing throws, so Stripe retries; 400 on a wrong-mode event; 200 on a duplicate (mutation: swallow the throw with a 200 → the event is lost, FAILS)", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    processMock.mockRejectedValueOnce(new Error("db down"));
    expect((await POST(signed(RAW))).status).toBe(500);
    processMock.mockResolvedValueOnce({ status: "mode_mismatch" });
    expect((await POST(signed(RAW))).status).toBe(400);
    processMock.mockResolvedValueOnce({ status: "duplicate" });
    expect((await POST(signed(RAW))).status).toBe(200);
    log.mockRestore();
  });

  it("answers 503 when the Stripe key is refused here (a test key on production's data), without processing (mutation: skip the verdict → a test key re-reads against production's database, FAILS)", async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://tlbkbmlrfafquucsmsmm.supabase.co";
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    expect((await POST(signed(RAW))).status).toBe(503);
    expect(processMock).not.toHaveBeenCalled();
    log.mockRestore();
  });

  it("runs on Node (the SDK's crypto) with a bounded duration, and is never cached (mutation: drop the runtime export → FAILS)", () => {
    expect(route.runtime).toBe("nodejs");
    expect(route.dynamic).toBe("force-dynamic");
    expect(route.maxDuration).toBe(30);
  });
});
```

Append to `apps/web/ci/ci-workflow.test.ts`, inside the same `describe` as the Stripe key tests:

```ts
  it("gives the e2e job — and only it — the fixture webhook signing secret as a LITERAL, never a secrets reference: the e2e signs its own fixture events with it, and it signs nothing anywhere else (mutation: move it to the top-level env, or read it from secrets → FAILS)", () => {
    expect(jobEnv(job("e2e")).STRIPE_WEBHOOK_SECRET).toBe("whsec_bis_ci_e2e_fixture_only");
    expect(jobEnv(job("verify")).STRIPE_WEBHOOK_SECRET).toBeUndefined();
    expect(ciEnv.STRIPE_WEBHOOK_SECRET).toBeUndefined();
    expect(ciLines.filter((l) => l.includes("STRIPE_WEBHOOK_SECRET") && !l.trim().startsWith("#"))).toHaveLength(1);
  });
```

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm --filter web exec vitest run src/app/api/webhooks/stripe/route.test.ts ci/ci-workflow.test.ts`
Expected: FAIL (no route; no env line).

- [ ] **Step 3: The route**

Create `apps/web/src/app/api/webhooks/stripe/route.ts`:

```ts
import { serviceDb } from "@bis/db";
import {
  billingGatewayFromEnv, verifyWebhookEvent, type StripeEnv, type VerifiedWebhookEvent,
} from "@/lib/billing/stripe-gateway";
import { processStripeEvent } from "@/lib/billing/webhook";

/**
 * Stripe's webhook (spec flow 4). PUBLIC: proxy.ts protects /dashboard only,
 * and the signature is the whole of the authentication. The pipeline is
 * plan G4: secret → signature over the RAW body → a usable key → mode →
 * claim once → re-read → mirror → stamp. Status codes, for Stripe's retry
 * logic: 2xx = done (processed, duplicate, ignored, refused). 400 = refused
 * (forged, or the wrong mode). Stripe retries EVERY non-2xx, a 400 too, and
 * each retry is refused the same way and recorded nowhere, which is
 * harmless. 5xx = retry later (not configured, key refused, or a failure
 * mid-way; the event stays unstamped and the retry reprocesses it).
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function POST(request: Request): Promise<Response> {
  const secret = (process.env.STRIPE_WEBHOOK_SECRET ?? "").trim();
  if (!secret) {
    console.error("stripe webhook: STRIPE_WEBHOOK_SECRET is not set; answering 503 so Stripe retries");
    return new Response("not configured", { status: 503 });
  }

  // The exact text Stripe signed. Never parse and re-serialise before
  // verifying: a parse changes whitespace and key order, and the signature
  // is over the bytes.
  const payload = await request.text();
  let event: VerifiedWebhookEvent;
  try {
    event = verifyWebhookEvent(payload, request.headers.get("stripe-signature") ?? "", secret);
  } catch {
    // Unverified payloads are never read. This is the security boundary.
    return new Response("invalid signature", { status: 400 });
  }

  const gateway = billingGatewayFromEnv(process.env as StripeEnv);
  if (!gateway.ok) {
    console.error(`stripe webhook: Stripe key refused here (${gateway.reason}); answering 503 so Stripe retries`);
    return new Response("stripe unavailable", { status: 503 });
  }

  try {
    const outcome = await processStripeEvent(
      { db: serviceDb(), gateway: gateway.gateway, live: gateway.live, now: () => new Date() }, event,
    );
    if (outcome.status === "mode_mismatch") return new Response("wrong mode", { status: 400 });
    return Response.json({ received: true, outcome: outcome.status });
  } catch (e) {
    console.error(`stripe webhook: ${event.type} ${event.id} failed; Stripe will retry: ${e instanceof Error ? e.message : String(e)}`);
    return new Response("processing failed", { status: 500 });
  }
}
```

- [ ] **Step 4: CI and the env contract**

In `.github/workflows/ci.yml`, in the `e2e` job's `env:` block, directly below `STRIPE_SECRET_KEY: ${{ secrets.CI_STRIPE_SECRET_KEY }}`, add:

```yaml
      # NOT a secret: a fixed literal the e2e billing spec signs its own
      # fixture webhook events with, so the e2e server accepts them. It
      # verifies nothing anywhere else: production's signing secret is set
      # on Vercel Production only (M7a PR-3 plan, Task 13).
      STRIPE_WEBHOOK_SECRET: whsec_bis_ci_e2e_fixture_only
```

In `.env.example`, directly below `STRIPE_SECRET_KEY=`, add:

```
# The signing secret of the Stripe webhook endpoint (Developers → Webhooks →
# the endpoint for /api/webhooks/stripe → Signing secret, whsec_...). The
# route answers 503 without it, and Stripe retries for up to three days.
# Production: the LIVE endpoint's secret, on Vercel Production only. CI: a
# fixed fixture literal in ci.yml's e2e job. Locally: from `stripe listen`,
# only once the env files name the CI project (same rule as the key).
STRIPE_WEBHOOK_SECRET=
```

- [ ] **Step 5: Run to verify they pass**

Run: `pnpm --filter web exec vitest run src/app/api/webhooks/stripe/route.test.ts ci/ci-workflow.test.ts`
Expected: pass (route 6; the ci-workflow file one more than before).

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/app/api/webhooks/stripe .github/workflows/ci.yml apps/web/ci/ci-workflow.test.ts .env.example
git commit -m "feat(billing): POST /api/webhooks/stripe (signature on the raw body, claim once, re-read, mirror); CI fixture secret"
```

---

### Task 6: The copy, and `billing-view.ts` (status, usage lines, periods, the card's view model)

**Owner:** bis-frontend. Pure code, no database, no Stripe.

**Files:**
- Modify: `apps/web/src/lib/messages.ts` (the `billing.*` block, `nav.billing`, `palette.settings.billing`)
- Create: `apps/web/src/lib/billing/billing-view.ts`
- Create: `apps/web/src/lib/billing/billing-view.test.ts` (9 tests)

**Interfaces:**
- Consumes: `AccountBilling`, `BillingLink`, `Plan`, `MeterAmounts`, `MeterKey`, `METER_KEYS`, `ENDED_STATUSES`, `PAST_DUE_STATUSES`, `isUsableZone` (`@bis/db`); `formatCents` (`./plan-form`); `localMidnightInstant` (`@/lib/reports/weekly-window`).
- Produces (used by Tasks 7-11):
  - `type BillingStatus`, `billingStatusOf(billing, link, now)`, `BILLING_STATUS_TREATMENTS`, `showsPaymentFailedBanner(billing)` (G21: `past_due`/`unpaid` only)
  - `FALLBACK_ZONE`, `safeZone(tz)`, `monthStartInZone(now, zone)`, `usagePeriodStart(billing, zone, now)`, `formatDay(d, zone)`, `formatMoment(d, zone)`
  - `priceLine(cents)`, `includedLine(allowances)`, `type UsageLine`, `usageLines(allowances, used)`
  - `type PlanOption`, `type BillingCardView`, `billingCardView(input)`

- [ ] **Step 1: The copy**

In `apps/web/src/lib/messages.ts`:
- Directly below `"nav.plans": "Plans",` add `"nav.billing": "Billing",`.
- Directly below `"palette.settings.alertPhone": "Alert texts",` add `"palette.settings.billing": "Billing",`.
- Directly above the closing `} as const;` add:

```ts
  // Client billing, rollout step 3: the agency's Billing card (account
  // Settings, agency only), the client's Billing page, the payment-failed
  // banner and Checkout's landing page (/billing-done, signed out). The
  // billing.error.noOrigin line names an env var because only the agency
  // ever sees it (the plans.stripe.* precedent).
  "billing.card.title": "Billing",
  "billing.card.empty": "Send a billing link to start charging this client, or mark them complimentary.",
  "billing.card.noPlans": "Create a plan first. Then you can send this client a billing link.",
  "billing.card.error": "Billing couldn't load just now. Refresh to try again.",
  "billing.status.active": "Active",
  "billing.status.payment_failed": "Payment failed",
  "billing.status.paused": "Paused",
  "billing.status.canceled": "Canceled",
  "billing.status.complimentary": "Complimentary",
  "billing.status.link_sent": "Link sent",
  "billing.status.unbilled": "Unbilled",
  "billing.price": "{price}/month",
  "billing.includes": "It includes {list} each month.",
  "billing.includes.minutes": "{n} minutes of calls",
  "billing.includes.sms": "{n} texts",
  "billing.includes.chats": "{n} website chats",
  "billing.includes.none": "Calls, texts and website chats are charged as you use them.",
  "billing.usage.minutes": "{used} of {included} minutes",
  "billing.usage.sms": "{used} of {included} texts",
  "billing.usage.chats": "{used} of {included} website chats",
  "billing.usage.minutes.none": "{used} minutes (none included)",
  "billing.usage.sms.none": "{used} texts (none included)",
  "billing.usage.chats.none": "{used} website chats (none included)",
  "billing.usage.since": "Since {date}",
  "billing.usage.chatsNote": "A website chat counts once Sofía first replies.",
  "billing.nextInvoice": "Next invoice {date}",
  "billing.link.sentTo": "Billing link sent to {email}. It works until {date}.",
  "billing.link.copy": "Copy link",
  "billing.link.copied": "Link copied.",
  "billing.send": "Send billing link",
  "billing.send.title": "Send a billing link",
  "billing.send.body": "They'll get an email with a secure Stripe page to add a card. Their plan starts when they finish.",
  "billing.send.plan": "Plan",
  "billing.send.email": "Send to",
  "billing.send.done": "Billing link sent.",
  "billing.changePlan": "Change plan",
  "billing.changePlan.bodyPaid": "The new plan starts now. Stripe adjusts this month's price on the next invoice.",
  "billing.changePlan.bodyComplimentary": "The new plan's features and allowances apply right away. Nothing is charged.",
  "billing.changePlan.done": "Plan changed.",
  "billing.comp.mark": "Mark complimentary",
  "billing.comp.markBody": "They get the plan's features and allowances and are never charged.",
  "billing.comp.done": "Marked complimentary.",
  "billing.comp.stop": "Stop complimentary",
  "billing.comp.stopped": "No longer complimentary.",
  "billing.error.noStripe": "Stripe isn't connected here, so billing can't change. The Plans page says why.",
  "billing.error.noOrigin": "This deployment doesn't know its own web address (APP_ORIGIN), so no link can be made.",
  "billing.error.plan": "Pick an active plan.",
  "billing.error.email": "Enter one email address.",
  "billing.error.alreadySubscribed": "This client already has a subscription. Use Change plan instead.",
  "billing.error.checkoutFinished": "This client already finished checkout. Their plan shows here within a minute.",
  "billing.error.alreadyBilled": "This client is already on a plan.",
  "billing.error.stripeFailed": "Stripe didn't accept that. Nothing was charged. Try again in a minute.",
  "billing.error.emailFailed": "The link was made, but the email didn't send. Use Copy link to send it yourself.",
  "billing.error.stale": "Something changed. Refresh and try again.",
  "billing.page.title": "Billing",
  "billing.page.subtitle": "Your plan, what you've used, and your next invoice.",
  "billing.page.empty.title": "Billing isn't set up yet",
  "billing.page.empty.body": "When your plan starts, your usage and next invoice show here.",
  "billing.page.usage": "Your usage",
  "billing.page.manage": "Manage billing",
  "billing.page.manageHelp": "Update your card and see past invoices on Stripe's secure page.",
  "billing.page.complimentary": "Your plan is complimentary. There's nothing to pay.",
  "billing.page.canceled": "Your subscription has ended.",
  "billing.page.portalFailed": "Billing couldn't open just now. Try again in a minute.",
  "billing.banner.client": "Your payment didn't go through. Update your card to keep automations running.",
  "billing.banner.clientAction": "Update your card",
  "billing.banner.agency": "This client's last payment didn't go through.",
  "billing.banner.agencyAction": "See billing",
  "billing.done.success.title": "You're all set",
  "billing.done.success.body": "Your plan starts as soon as your payment is confirmed, usually within a minute. You can close this tab.",
  "billing.done.cancelled.title": "Checkout wasn't finished",
  "billing.done.cancelled.body": "Nothing was charged. Use the link in your email to try again.",
```

- [ ] **Step 2: Write the failing tests**

Create `apps/web/src/lib/billing/billing-view.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import type { AccountBilling, BillingLink, Plan } from "@bis/db";
import { m } from "@/lib/messages";
import {
  billingStatusOf, BILLING_STATUS_TREATMENTS, usageLines, includedLine, monthStartInZone, usagePeriodStart, billingCardView,
  type BillingStatus,
} from "./billing-view";

const NOW = new Date("2026-10-15T15:00:00.000Z");
const ZONE = "America/Chicago";
const row = (over: Partial<AccountBilling> = {}): AccountBilling => ({
  accountId: "a", planId: "p1", complimentary: false, stripeCustomerId: "cus_1", stripeSubscriptionId: "sub_1",
  subscriptionStatus: "active", currentPeriodStart: "2026-10-12T17:00:00+00:00", currentPeriodEnd: "2026-11-12T17:00:00+00:00",
  pastDueSince: null, billingPausedAt: null, billingStartedAt: "2026-09-12T17:00:00+00:00",
  createdAt: "2026-09-12T17:00:00+00:00", updatedAt: "2026-09-12T17:00:00+00:00", ...over,
});
const link = (expiresAt: string): BillingLink => ({
  accountId: "a", planId: "p1", stripeCustomerId: "cus_1", checkoutSessionId: "cs_1",
  checkoutUrl: "https://checkout.stripe.com/c/pay/cs_1", sentTo: "owner@example.com", expiresAt,
  sentAt: "2026-10-15T14:00:00+00:00", updatedAt: "2026-10-15T14:00:00+00:00",
});
const plan = (id: string, over: Partial<Plan> = {}): Plan => ({
  id, agencyId: "ag", name: `Plan ${id}`, monthlyPriceCents: 14900, currency: "usd",
  features: { voice_receptionist: true, web_concierge: true },
  allowances: { voice_minutes: 500, sms: 1000, ai_chats: 0 }, overageCents: { voice_minutes: 10, sms: 3, ai_chats: 25 },
  stripeProductId: "prod_1", stripePriceIds: { base: "price_b", voice_minutes: "price_v", sms: "price_s", ai_chats: "price_a" },
  archivedAt: null, createdAt: "2026-09-01T00:00:00+00:00", updatedAt: "2026-09-01T00:00:00+00:00", ...over,
});

describe("billingStatusOf (G13)", () => {
  it("maps every stored state to one of the seven words (mutation: incomplete → active → FAILS; ignore billing_paused_at → FAILS)", () => {
    const cases: [AccountBilling | null, BillingStatus][] = [
      [null, "unbilled"],
      [row(), "active"], [row({ subscriptionStatus: "trialing" }), "active"],
      [row({ subscriptionStatus: "past_due" }), "payment_failed"], [row({ subscriptionStatus: "unpaid" }), "payment_failed"],
      [row({ subscriptionStatus: "incomplete" }), "payment_failed"],
      [row({ subscriptionStatus: "paused" }), "paused"], [row({ billingPausedAt: "2026-10-10T00:00:00Z" }), "paused"],
      [row({ subscriptionStatus: "canceled" }), "canceled"], [row({ subscriptionStatus: "incomplete_expired" }), "canceled"],
      [row({ complimentary: true, stripeSubscriptionId: null, subscriptionStatus: null }), "complimentary"],
    ];
    for (const [billing, want] of cases) {
      expect(billingStatusOf(billing, null, NOW), JSON.stringify(billing && [billing.subscriptionStatus, billing.billingPausedAt])).toBe(want);
    }
  });

  it("'Link sent' only while the link is unexpired, on an unbilled OR canceled account (mutation: ignore expiresAt → an expired link reads 'Link sent', FAILS)", () => {
    expect(billingStatusOf(null, link("2026-10-16T00:00:00Z"), NOW)).toBe("link_sent");
    expect(billingStatusOf(null, link("2026-10-15T14:59:59Z"), NOW)).toBe("unbilled");
    expect(billingStatusOf(row({ subscriptionStatus: "canceled" }), link("2026-10-16T00:00:00Z"), NOW)).toBe("link_sent");
  });

  it("every treatment is a dot AND a word, in token classes only: no raw palette colour can slip in (PR-1 carried F1) (mutation: write bg-red-500 for payment_failed → FAILS; drop a label → FAILS)", () => {
    const TOKEN = /^(bg|border|text)-(success|destructive|warning|muted-foreground|border|foreground|transparent)(\/\d{1,2})?$/;
    const labels = new Set<string>();
    for (const [status, t] of Object.entries(BILLING_STATUS_TREATMENTS)) {
      expect(t.label, status).toBe(m[`billing.status.${status as BillingStatus}`]);
      labels.add(t.label);
      for (const cls of `${t.dot} ${t.chip}`.split(/\s+/)) expect(cls, `${status}: ${cls}`).toMatch(TOKEN);
    }
    expect(labels.size).toBe(7);
  });
});

describe("usage", () => {
  it("reads '312 of 500 minutes', flags use over the allowance, and says 'none included' instead of 'of 0'; the plan's included line leaves a zero allowance OUT instead of saying '0 minutes of calls' (mutation: swap used and included → FAILS; list every meter in the included line → FAILS)", () => {
    const lines = usageLines({ voice_minutes: 500, sms: 1000, ai_chats: 0 }, { voice_minutes: 312, sms: 1200, ai_chats: 4 });
    expect(lines.map((l) => [l.meter, l.text, l.over])).toEqual([
      ["voice_minutes", "312 of 500 minutes", false],
      ["sms", "1,200 of 1,000 texts", true],
      ["ai_chats", "4 website chats (none included)", true],
    ]);
    expect(includedLine({ voice_minutes: 500, sms: 1000, ai_chats: 200 }))
      .toBe("It includes 500 minutes of calls, 1,000 texts and 200 website chats each month.");
    expect(includedLine({ voice_minutes: 0, sms: 1000, ai_chats: 200 })).toBe("It includes 1,000 texts and 200 website chats each month.");
    expect(includedLine({ voice_minutes: 0, sms: 0, ai_chats: 0 })).toBe(m["billing.includes.none"]);
  });

  it("monthStartInZone is local midnight on the 1st, in the account's zone: Chicago's October starts 05:00 UTC, and 03:00 UTC on Oct 1 is still September there (mutation: use the UTC month → FAILS)", () => {
    expect(monthStartInZone(NOW, ZONE).toISOString()).toBe("2026-10-01T05:00:00.000Z");
    expect(monthStartInZone(new Date("2026-10-01T03:00:00Z"), ZONE).toISOString()).toBe("2026-09-01T05:00:00.000Z");
  });

  it("a live subscription counts from Stripe's period start; complimentary and canceled accounts from the calendar month (G12) (mutation: always use the calendar month → a subscriber's allowance resets on the 1st, FAILS)", () => {
    expect(usagePeriodStart(row(), ZONE, NOW)).toEqual({ start: new Date("2026-10-12T17:00:00Z"), kind: "billing_period" });
    expect(usagePeriodStart(row({ complimentary: true, subscriptionStatus: null, stripeSubscriptionId: null }), ZONE, NOW).kind).toBe("calendar_month");
    expect(usagePeriodStart(row({ subscriptionStatus: "canceled" }), ZONE, NOW).kind).toBe("calendar_month");
  });
});

describe("billingCardView", () => {
  const view = (billing: AccountBilling | null, l: BillingLink | null, over: Partial<Parameters<typeof billingCardView>[0]> = {}) =>
    billingCardView({
      billing, link: l, plan: billing ? plan("p1") : null, activePlans: [plan("p1"), plan("p2")],
      used: { voice_minutes: 312, sms: 0, ai_chats: 0 }, zone: ZONE, now: NOW, defaultEmail: "owner@example.com",
      stripeReady: true, ...over,
    });

  it("offers exactly the actions each status allows (G16, G15): Send only when not subscribed, Mark complimentary only when unbilled, Stop only when complimentary, Change plan only on a plan with another plan to go to, and never on an incomplete first payment (mutation: offer Mark complimentary on a canceled row → 0051's CHECK would refuse it, FAILS; offer Change plan on incomplete → FAILS)", () => {
    const can = (b: AccountBilling | null, l: BillingLink | null = null) => view(b, l).can;
    expect(can(null)).toEqual({ send: true, changePlan: false, markComplimentary: true, stopComplimentary: false, copyLink: false });
    expect(can(null, link("2026-10-16T00:00:00Z"))).toEqual({ send: true, changePlan: false, markComplimentary: false, stopComplimentary: false, copyLink: true });
    expect(can(row())).toEqual({ send: false, changePlan: true, markComplimentary: false, stopComplimentary: false, copyLink: false });
    expect(can(row({ subscriptionStatus: "canceled" }))).toEqual({ send: true, changePlan: false, markComplimentary: false, stopComplimentary: false, copyLink: false });
    expect(can(row({ complimentary: true, subscriptionStatus: null, stripeSubscriptionId: null }))).toEqual({ send: true, changePlan: true, markComplimentary: false, stopComplimentary: true, copyLink: false });
    expect(can(row({ subscriptionStatus: "incomplete" })).changePlan).toBe(false);
  });

  it("without a usable Stripe key nothing that calls Stripe is offered, but complimentary changes still are (mutation: ignore stripeReady → FAILS)", () => {
    expect(view(null, null, { stripeReady: false }).can).toMatchObject({ send: false, markComplimentary: true });
    expect(view(row(), null, { stripeReady: false }).can.changePlan).toBe(false);
  });

  it("shows the next invoice only for a live subscription, the period it counts from, and the link's recipient and expiry in the account's zone (mutation: show a canceled subscription's old period end as its next invoice → FAILS)", () => {
    const live = view(row(), null);
    expect([live.nextInvoice, live.since]).toEqual([
      m["billing.nextInvoice"].replace("{date}", "Nov 12"), m["billing.usage.since"].replace("{date}", "Oct 12"),
    ]);
    expect(view(row({ subscriptionStatus: "canceled" }), null).nextInvoice).toBeNull();
    expect(view(null, link("2026-10-16T20:30:00Z")).link).toEqual({
      sentTo: "owner@example.com", expires: "Oct 16, 3:30 PM", url: "https://checkout.stripe.com/c/pay/cs_1",
    });
  });
});
```

- [ ] **Step 3: Run to verify it fails**

Run: `pnpm --filter web exec vitest run src/lib/billing/billing-view.test.ts` → FAIL (no module).

- [ ] **Step 4: Write `billing-view.ts`**

Create `apps/web/src/lib/billing/billing-view.ts`:

```ts
import {
  ENDED_STATUSES, METER_KEYS, PAST_DUE_STATUSES, isUsableZone,
  type AccountBilling, type BillingLink, type MeterAmounts, type MeterKey, type Plan,
} from "@bis/db";
import { localMidnightInstant } from "@/lib/reports/weekly-window";
import { m, type MessageKey } from "@/lib/messages";
import { formatCents } from "./plan-form";

/**
 * What the billing screens SAY, computed from stored rows (never from
 * Stripe at render time). Pure: the agency card, the client page and the
 * banner all read these, so the three can never disagree.
 */

/** Seven words, one per state the card must not hide (plan G13). */
export type BillingStatus = "active" | "payment_failed" | "paused" | "canceled" | "complimentary" | "link_sent" | "unbilled";

export function billingStatusOf(billing: AccountBilling | null, link: Pick<BillingLink, "expiresAt"> | null, now: Date): BillingStatus {
  const linkLive = link !== null && Date.parse(link.expiresAt) > now.getTime();
  if (!billing) return linkLive ? "link_sent" : "unbilled";
  if (billing.billingPausedAt) return "paused";
  if (billing.complimentary) return "complimentary";
  switch (billing.subscriptionStatus) {
    case "active":
    case "trialing":
      return "active";
    case "past_due":
    case "unpaid":
    case "incomplete":
      return "payment_failed";
    case "paused":
      return "paused";
    default:
      return linkLive ? "link_sent" : "canceled";
  }
}

/** The payment-failed banner (G21): only a subscription whose payment
 *  FAILED (past_due, unpaid). Not `incomplete`: a first payment still in
 *  progress has not failed, and the card already shows that state. */
export function showsPaymentFailedBanner(billing: AccountBilling | null): boolean {
  return billing !== null && !billing.complimentary && !billing.billingPausedAt
    && billing.subscriptionStatus !== null && PAST_DUE_STATUSES.includes(billing.subscriptionStatus);
}

/** DESIGN rule 3: a dot AND a word. Token classes only (pinned by a test). */
export const BILLING_STATUS_TREATMENTS: Record<BillingStatus, { label: string; dot: string; chip: string }> = {
  active: { label: m["billing.status.active"], dot: "bg-success", chip: "border-success/30 bg-success/10 text-foreground" },
  payment_failed: { label: m["billing.status.payment_failed"], dot: "bg-destructive", chip: "border-destructive/30 bg-destructive/10 text-foreground" },
  paused: { label: m["billing.status.paused"], dot: "bg-warning", chip: "border-warning/30 bg-warning/10 text-foreground" },
  canceled: { label: m["billing.status.canceled"], dot: "bg-muted-foreground/60", chip: "border-border bg-transparent text-muted-foreground" },
  complimentary: { label: m["billing.status.complimentary"], dot: "bg-success", chip: "border-border bg-transparent text-foreground" },
  link_sent: { label: m["billing.status.link_sent"], dot: "bg-warning", chip: "border-warning/30 bg-warning/10 text-foreground" },
  unbilled: { label: m["billing.status.unbilled"], dot: "bg-muted-foreground/60", chip: "border-border bg-transparent text-muted-foreground" },
};

/** The zone a billing date is shown in: the account's own, when usable. */
export const FALLBACK_ZONE = "America/Chicago";
export function safeZone(tz: string | null | undefined): string {
  return tz && isUsableZone(tz) ? tz : FALLBACK_ZONE;
}

/** Local midnight on the 1st of `now`'s month, in `zone`. */
export function monthStartInZone(now: Date, zone: string): Date {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit" }).formatToParts(now);
  const year = parts.find((p) => p.type === "year")?.value;
  const month = parts.find((p) => p.type === "month")?.value;
  if (!year || !month) throw new Error(`monthStartInZone: no year/month for ${now.toISOString()} in ${zone}`);
  return localMidnightInstant(`${year}-${month}-01`, zone);
}

/** A subscription BIS still bills (not ended, not complimentary). */
function liveSubscription(billing: AccountBilling): boolean {
  return !billing.complimentary && billing.subscriptionStatus !== null && !ENDED_STATUSES.includes(billing.subscriptionStatus);
}

/** Where "this month" starts (G12): Stripe's period for a live subscription,
 *  else the calendar month in the account's zone. */
export function usagePeriodStart(billing: AccountBilling, zone: string, now: Date): { start: Date; kind: "billing_period" | "calendar_month" } {
  if (liveSubscription(billing) && billing.currentPeriodStart) {
    return { start: new Date(billing.currentPeriodStart), kind: "billing_period" };
  }
  return { start: monthStartInZone(now, zone), kind: "calendar_month" };
}

/** Newer ICU (Node 20+) puts a NARROW no-break space (U+202F) before
 *  AM/PM. It is invisible in a browser but breaks exact-string copy
 *  assertions and some email clients' wrapping, so it becomes a plain space. */
const plainSpaces = (s: string): string => s.replace(/[  ]/g, " ");

export function formatDay(d: Date, zone: string): string {
  return plainSpaces(new Intl.DateTimeFormat("en-US", { timeZone: zone, month: "short", day: "numeric" }).format(d));
}

export function formatMoment(d: Date, zone: string): string {
  return plainSpaces(new Intl.DateTimeFormat("en-US", {
    timeZone: zone, month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
  }).format(d));
}

const count = (n: number): string => n.toLocaleString("en-US");

export function priceLine(cents: number): string {
  return m["billing.price"].replace("{price}", formatCents(cents));
}

const INCLUDED_COPY: Record<MeterKey, MessageKey> = {
  voice_minutes: "billing.includes.minutes", sms: "billing.includes.sms", ai_chats: "billing.includes.chats",
};

/** "It includes 500 minutes of calls, 1,000 texts and 200 website chats each
 *  month." Only what the plan includes: a zero allowance is left out (never
 *  "0 minutes of calls"), and a plan that includes nothing says so plainly. */
export function includedLine(a: MeterAmounts): string {
  const parts = METER_KEYS.filter((k) => a[k] > 0).map((k) => m[INCLUDED_COPY[k]].replace("{n}", count(a[k])));
  if (parts.length === 0) return m["billing.includes.none"];
  const list = parts.length === 1 ? parts[0]! : `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]!}`;
  return m["billing.includes"].replace("{list}", list);
}

export type UsageLine = { meter: MeterKey; used: number; included: number; over: boolean; text: string };

const USAGE_COPY: Record<MeterKey, { of: MessageKey; none: MessageKey }> = {
  voice_minutes: { of: "billing.usage.minutes", none: "billing.usage.minutes.none" },
  sms: { of: "billing.usage.sms", none: "billing.usage.sms.none" },
  ai_chats: { of: "billing.usage.chats", none: "billing.usage.chats.none" },
};

/** "312 of 500 minutes", one line per meter, in METER_KEYS order. */
export function usageLines(allowances: MeterAmounts, used: MeterAmounts): UsageLine[] {
  return METER_KEYS.map((meter) => {
    const included = allowances[meter];
    const text = included === 0
      ? m[USAGE_COPY[meter].none].replace("{used}", count(used[meter]))
      : m[USAGE_COPY[meter].of].replace("{used}", count(used[meter])).replace("{included}", count(included));
    return { meter, used: used[meter], included, over: used[meter] > included, text };
  });
}

export type PlanOption = { id: string; name: string; price: string };

export type BillingCardView = {
  status: BillingStatus;
  plan: PlanOption | null;
  usage: UsageLine[];
  since: string | null;
  nextInvoice: string | null;
  link: { sentTo: string; expires: string; url: string } | null;
  planOptions: PlanOption[];
  defaultEmail: string;
  can: { send: boolean; changePlan: boolean; markComplimentary: boolean; stopComplimentary: boolean; copyLink: boolean };
  stripeReady: boolean;
};

export function billingCardView(input: {
  billing: AccountBilling | null;
  link: BillingLink | null;
  /** The account's plan (billing.planId), read by the caller. */
  plan: Plan | null;
  /** Unarchived plans, for the pickers. */
  activePlans: Plan[];
  /** sumUsageSince from usagePeriodStart, or null when unbilled. */
  used: MeterAmounts | null;
  zone: string;
  now: Date;
  defaultEmail: string;
  stripeReady: boolean;
}): BillingCardView {
  const { billing, link, plan, activePlans, used, zone, now, stripeReady } = input;
  const status = billingStatusOf(billing, link, now);
  const option = (p: Plan): PlanOption => ({ id: p.id, name: p.name, price: priceLine(p.monthlyPriceCents) });
  const live = billing !== null && liveSubscription(billing);
  const period = billing ? usagePeriodStart(billing, zone, now) : null;
  const otherPlan = activePlans.some((p) => p.id !== billing?.planId);
  return {
    status,
    plan: plan ? option(plan) : null,
    usage: plan && used ? usageLines(plan.allowances, used) : [],
    since: period ? m["billing.usage.since"].replace("{date}", formatDay(period.start, zone)) : null,
    nextInvoice: live && billing?.currentPeriodEnd
      ? m["billing.nextInvoice"].replace("{date}", formatDay(new Date(billing.currentPeriodEnd), zone))
      : null,
    link: status === "link_sent" && link
      ? { sentTo: link.sentTo, expires: formatMoment(new Date(link.expiresAt), zone), url: link.checkoutUrl }
      : null,
    planOptions: activePlans.map(option),
    defaultEmail: input.defaultEmail,
    can: {
      send: stripeReady && activePlans.length > 0 && ["unbilled", "link_sent", "canceled", "complimentary"].includes(status),
      // Not on `incomplete`: before the first payment, Stripe may refuse item updates (G15).
      changePlan: otherPlan && (status === "complimentary"
        || (stripeReady && live && billing?.subscriptionStatus !== "incomplete")),
      markComplimentary: status === "unbilled" && activePlans.length > 0,
      stopComplimentary: status === "complimentary",
      copyLink: status === "link_sent",
    },
    stripeReady,
  };
}
```

- [ ] **Step 5: Run to verify it passes**

Run: `pnpm --filter web exec vitest run src/lib/billing/billing-view.test.ts src/lib/messages.test.ts`
Expected: `billing-view` 9 passed; `messages.test.ts` green (no milestone label in any new string).

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/lib/messages.ts apps/web/src/lib/billing/billing-view.ts apps/web/src/lib/billing/billing-view.test.ts
git commit -m "feat(billing): billing copy and billing-view (seven statuses, usage lines, billing-period vs calendar month, card view model)"
```

---

### Task 7: The billing link (email + `sendBillingLink`), `planChangeItems`, and the portal helper

**Owner:** bis-comms (the email template), then bis-platform (the rest). One implementer, in order.

**Files:**
- Create: `apps/web/src/lib/email/templates/billing-link.ts`, `billing-link.test.ts` (3 tests)
- Create: `apps/web/src/lib/billing/billing-link.ts`, `billing-link.test.ts` (9 tests)
- Create: `apps/web/src/lib/billing/change-plan.ts`, `change-plan.test.ts` (2 tests)
- Create: `apps/web/src/lib/billing/portal.ts`, `portal.test.ts` (3 tests)

**Interfaces:**
- Consumes: Task 2's `getAccountBilling`, `getBillingLink`, `saveBillingLink`, `markBillingLinkExpired`, `ENDED_STATUSES`, `type Plan`, `type Branding`, `type SubscriptionSnapshot`; Task 3's gateway surface and `idempotencyKey`; Task 6's `priceLine`, `includedLine`, `formatMoment`; `shell`, `button`, `escapeHtml`, `emailBrandNamed` (`lib/email/templates/shell.ts`); `type EmailProvider` (`@/lib/email`).
- Produces (used by Tasks 8 and 10):
  - `billingLinkEmail(input): { subject; html; text }`
  - `sendBillingLink(deps, input): Promise<SendBillingLinkResult>`
  - `planChangeItems(snapshot, priceIds): { id: string; price: string }[] | null`
  - `ensurePortalConfiguration(gateway): Promise<string>`, `openPortal(gateway, { customerId, returnUrl }): Promise<string>`

- [ ] **Step 1: Write the failing tests**

Create `apps/web/src/lib/email/templates/billing-link.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import type { Branding } from "@bis/db";
import { emailBrandNamed } from "./shell";
import { billingLinkEmail } from "./billing-link";

const BIS: Branding = {
  brandName: null, brandLogoPath: null, brandColor: null, brandNeutral: null,
  brandCorners: null, brandType: null, brandMode: null, replyToEmail: null,
};
const URL = "https://checkout.stripe.com/c/pay/cs_test_a1?x=1&y=2";
const input = {
  brand: emailBrandNamed(BIS, "BIS"), businessName: "Rio Roofing" as string | null, planName: "Growth",
  price: "$149.00/month", includes: "It includes 500 minutes of calls, 1,000 texts and 200 website chats each month.",
  url: URL, expires: "Oct 16, 3:30 PM",
};

describe("billingLinkEmail", () => {
  it("names the business in the subject when it has a customer-facing name, and falls back to plain words, never an internal label (mutation: fall back to accounts.name-style text → FAILS)", () => {
    expect(billingLinkEmail(input).subject).toBe("Set up billing for Rio Roofing");
    expect(billingLinkEmail({ ...input, businessName: null }).subject).toBe("Set up your billing");
  });

  it("carries the ABSOLUTE link in both parts, escaped in the HTML (mutation: drop the link from the text part → a text-only client gets no way to pay, FAILS)", () => {
    const { html, text } = billingLinkEmail(input);
    expect(html).toContain(`href="${URL.replace(/&/g, "&amp;")}"`);
    expect(text).toContain(URL);
  });

  it("says what they are buying, in plain words: plan, price, what's included and when the link stops working, with no template syntax (mutation: drop the expiry sentence → FAILS)", () => {
    const { html, text } = billingLinkEmail(input);
    for (const part of [html, text]) {
      expect(part).toContain("Growth");
      expect(part).toContain("$149.00/month");
      expect(part).toContain("500 minutes of calls");
      expect(part).toContain("Oct 16, 3:30 PM");
      expect(part).not.toMatch(/\{\{|\{[a-z]+\}/);
    }
  });
});
```

Create `apps/web/src/lib/billing/billing-link.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { AccountBilling, BillingLink, Plan } from "@bis/db";

const db = vi.hoisted(() => ({
  getAccountBilling: vi.fn(),
  getBillingLink: vi.fn(),
  saveBillingLink: vi.fn(),
  markBillingLinkExpired: vi.fn(),
}));
vi.mock("@bis/db", async (importOriginal) => ({ ...(await importOriginal<object>()), ...db }));

const { sendBillingLink } = await import("./billing-link");
const { FakeGateway } = await import("./fake-gateway");
const { idempotencyKey } = await import("./stripe-gateway");

const ACCOUNT = "11111111-1111-4111-8111-111111111111";
const PLAN: Plan = {
  id: "22222222-2222-4222-8222-222222222222", agencyId: "ag", name: "Growth", monthlyPriceCents: 14900, currency: "usd",
  features: { voice_receptionist: true, web_concierge: true },
  allowances: { voice_minutes: 500, sms: 1000, ai_chats: 200 }, overageCents: { voice_minutes: 10, sms: 3, ai_chats: 25 },
  stripeProductId: "prod_1", stripePriceIds: { base: "price_b", voice_minutes: "price_v", sms: "price_s", ai_chats: "price_a" },
  archivedAt: null, createdAt: "2026-09-01T00:00:00+00:00", updatedAt: "2026-09-01T00:00:00+00:00",
};
const NOW = new Date("2026-10-15T15:00:00.000Z");
const INPUT = { accountId: ACCOUNT, plan: PLAN, email: "owner@example.com", businessName: "Rio Roofing", zone: "America/Chicago" };
const stored = (over: Partial<AccountBilling>): AccountBilling => ({
  accountId: ACCOUNT, planId: PLAN.id, complimentary: false, stripeCustomerId: "cus_stored", stripeSubscriptionId: "sub_1",
  subscriptionStatus: "active", currentPeriodStart: null, currentPeriodEnd: null, pastDueSince: null, billingPausedAt: null,
  billingStartedAt: "2026-09-01T00:00:00+00:00", createdAt: "2026-09-01T00:00:00+00:00", updatedAt: "2026-09-01T00:00:00+00:00", ...over,
});
const prevLink = (sessionId: string): BillingLink => ({
  accountId: ACCOUNT, planId: PLAN.id, stripeCustomerId: "cus_linked", checkoutSessionId: sessionId,
  checkoutUrl: `https://checkout.stripe.test/c/pay/${sessionId}`, sentTo: "old@example.com",
  expiresAt: "2026-10-16T00:00:00+00:00", sentAt: "2026-10-15T00:00:00+00:00", updatedAt: "2026-10-15T00:00:00+00:00",
});

let gateway: InstanceType<typeof FakeGateway>;
let sent: Array<{ to: string; subject: string; body: string; html?: string; replyTo?: string; fromName: string }>;
let emailFails = false;
const deps = () => ({
  db: {} as never, gateway, now: NOW, origin: "https://app.example", replyTo: "help@bis.example",
  email: { isFake: true, send: async (i: (typeof sent)[number]) => { if (emailFails) throw new Error("smtp down"); sent.push(i); return { providerMessageId: "e1" }; } },
});

beforeEach(() => {
  gateway = new FakeGateway();
  sent = [];
  emailFails = false;
  db.getAccountBilling.mockReset().mockResolvedValue(null);
  db.getBillingLink.mockReset().mockResolvedValue(null);
  db.saveBillingLink.mockReset().mockResolvedValue(true);
  db.markBillingLinkExpired.mockReset().mockResolvedValue(undefined);
});

describe("sendBillingLink", () => {
  it("first link: makes the customer (key over account, name AND email), a subscription Checkout on the plan's four prices returning to /billing-done, saves it as the first link, and emails it from BIS (mutation: key the customer by account alone → a corrected email replays the old customer, FAILS)", async () => {
    const r = await sendBillingLink(deps(), INPUT);
    expect(r.ok).toBe(true);
    const customer = { accountId: ACCOUNT, name: "Rio Roofing", email: "owner@example.com" };
    expect(gateway.calls[0]).toEqual({ op: "createCustomer", key: idempotencyKey("bis-customer", ACCOUNT, customer), input: customer });
    const session = [...gateway.checkoutSessions.values()][0]!;
    expect(session.input).toEqual({
      accountId: ACCOUNT, planId: PLAN.id, customerId: gateway.customers[0]!.id, priceIds: PLAN.stripePriceIds,
      successUrl: "https://app.example/billing-done?result=success", cancelUrl: "https://app.example/billing-done?result=cancelled",
    });
    expect(db.saveBillingLink).toHaveBeenCalledWith({}, {
      accountId: ACCOUNT, planId: PLAN.id, stripeCustomerId: gateway.customers[0]!.id, checkoutSessionId: session.id,
      checkoutUrl: session.url, sentTo: "owner@example.com", expiresAt: new Date(session.expiresAt * 1000).toISOString(),
    }, null, NOW);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ to: "owner@example.com", fromName: "BIS", replyTo: "help@bis.example" });
    expect(sent[0]!.body).toContain(session.url);
  });

  it("reuses the account's customer and never makes another: the billed row's customer WINS over a pending link that names a different one (G3's invariant; the mirror would refuse the other as customer_changed) (mutation: always create → a second Stripe customer per resend, FAILS; prefer the link's customer → FAILS)", async () => {
    const old = await gateway.createCheckoutSession({
      accountId: ACCOUNT, planId: PLAN.id, customerId: "cus_linked", priceIds: PLAN.stripePriceIds, successUrl: "https://x", cancelUrl: "https://y",
    }, "old-key");
    gateway.checkoutSessions.get(old.id)!.status = "expired";
    db.getAccountBilling.mockResolvedValue(stored({ subscriptionStatus: "canceled" }));
    db.getBillingLink.mockResolvedValue(prevLink(old.id));
    await sendBillingLink(deps(), INPUT);
    expect(gateway.customers).toEqual([]);
    expect([...gateway.checkoutSessions.values()].at(-1)!.input.customerId).toBe("cus_stored");
  });

  it("refuses an account whose subscription is not ended, before ANY Stripe call (mutation: drop the guard → a second subscription can be bought, FAILS)", async () => {
    db.getAccountBilling.mockResolvedValue(stored({ subscriptionStatus: "past_due" }));
    expect(await sendBillingLink(deps(), INPUT)).toEqual({ ok: false, reason: "already_subscribed" });
    expect(gateway.calls).toEqual([]);
  });

  it("a previous OPEN link is marked expired in the database FIRST, then expired at Stripe, and only then is a new session made; the save is conditional on that previous session (G2) (mutation: expire after creating the new one → two open sessions, FAILS; save unconditionally → FAILS)", async () => {
    const old = await gateway.createCheckoutSession({
      accountId: ACCOUNT, planId: PLAN.id, customerId: "cus_linked", priceIds: PLAN.stripePriceIds,
      successUrl: "https://x", cancelUrl: "https://y",
    }, "old-key");
    db.getBillingLink.mockResolvedValue(prevLink(old.id));
    gateway.calls.length = 0;
    const order: string[] = [];
    db.markBillingLinkExpired.mockImplementation(async () => { order.push("db:markExpired"); });
    const realExpire = gateway.expireCheckoutSession.bind(gateway);
    vi.spyOn(gateway, "expireCheckoutSession").mockImplementation(async (id: string) => {
      order.push("stripe:expire");
      return realExpire(id);
    });
    await sendBillingLink(deps(), INPUT);
    expect(gateway.calls.map((c) => c.op)).toEqual(["getCheckoutSessionStatus", "expireCheckoutSession", "createCheckoutSession"]);
    expect(db.markBillingLinkExpired).toHaveBeenCalledWith({}, ACCOUNT, old.id, NOW);
    expect(order).toEqual(["db:markExpired", "stripe:expire"]);
    expect(await gateway.getCheckoutSessionStatus(old.id)).toBe("expired");
    expect(db.saveBillingLink.mock.calls[0]![2]).toBe(old.id);
  });

  it("a deliberate resend of the SAME plan to the SAME address makes a NEW, OPEN session: the checkout key covers the previous session, so Stripe cannot replay the one it just expired (mutation: drop `previous` from the key → the expired session is replayed and emailed, FAILS)", async () => {
    await sendBillingLink(deps(), INPUT);
    const [first] = [...gateway.checkoutSessions.values()];
    // The first send's saved link is now the stored one, exactly as written.
    db.getBillingLink.mockResolvedValue({
      ...(db.saveBillingLink.mock.calls[0]![1] as object), sentAt: NOW.toISOString(), updatedAt: NOW.toISOString(),
    });
    const again = await sendBillingLink(deps(), INPUT);
    const sessions = [...gateway.checkoutSessions.values()];
    expect(sessions.map((s) => s.status)).toEqual(["expired", "open"]);
    expect(sessions[1]!.id).not.toBe(first!.id);
    expect(again).toEqual({ ok: true, url: sessions[1]!.url });
  });

  it("a previous link the client already COMPLETED stops the resend: the webhook is on its way (mutation: expire it anyway → the client paid a dead link and gets a second one, FAILS)", async () => {
    const done = await gateway.createCheckoutSession({
      accountId: ACCOUNT, planId: PLAN.id, customerId: "cus_linked", priceIds: PLAN.stripePriceIds, successUrl: "https://x", cancelUrl: "https://y",
    }, "done-key");
    gateway.checkoutSessions.get(done.id)!.status = "complete";
    db.getBillingLink.mockResolvedValue(prevLink(done.id));
    expect(await sendBillingLink(deps(), INPUT)).toEqual({ ok: false, reason: "checkout_finished" });
    expect(gateway.checkoutSessions.size).toBe(1);
  });

  it("a lost save race: another tab's link won, so this one's session is expired and 'stale' returned; but a replay of OUR OWN request (same key, same session) is success with no second email (mutation: never expire the loser → two open sessions, FAILS)", async () => {
    db.saveBillingLink.mockResolvedValue(false);
    db.getBillingLink.mockResolvedValueOnce(null).mockResolvedValueOnce(prevLink("cs_other_tab"));
    expect(await sendBillingLink(deps(), INPUT)).toEqual({ ok: false, reason: "stale" });
    expect([...gateway.checkoutSessions.values()][0]!.status).toBe("expired");
    expect(sent).toEqual([]);

    gateway = new FakeGateway();
    const mine = await gateway.createCheckoutSession({
      accountId: ACCOUNT, planId: PLAN.id, customerId: "cus_x", priceIds: PLAN.stripePriceIds,
      successUrl: "https://app.example/billing-done?result=success", cancelUrl: "https://app.example/billing-done?result=cancelled",
    }, "probe");
    db.getBillingLink.mockReset().mockResolvedValueOnce(null).mockResolvedValueOnce(prevLink(mine.id));
    const replay = vi.spyOn(gateway, "createCheckoutSession").mockResolvedValue(mine);
    expect(await sendBillingLink(deps(), INPUT)).toEqual({ ok: true, url: mine.url });
    expect(sent).toEqual([]);
    expect(await gateway.getCheckoutSessionStatus(mine.id)).toBe("open");
    replay.mockRestore();
  });

  it("an email failure keeps the saved link and hands its URL back for Copy link (G18) (mutation: throw → the agency sees a crash and no link, FAILS)", async () => {
    emailFails = true;
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const r = await sendBillingLink(deps(), INPUT);
    expect(r).toEqual({ ok: false, reason: "email_failed", url: [...gateway.checkoutSessions.values()][0]!.url });
    expect(db.saveBillingLink).toHaveBeenCalledTimes(1);
    log.mockRestore();
  });

  it("a Stripe refusal is 'stripe_failed' with nothing saved; a DATABASE failure is not disguised as Stripe's (mutation: catch every error as stripe_failed → FAILS)", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    gateway.failOn = { op: "createCheckoutSession", error: Object.assign(new Error("card_declined"), { type: "StripeCardError" }) };
    expect(await sendBillingLink(deps(), INPUT)).toEqual({ ok: false, reason: "stripe_failed" });
    expect(db.saveBillingLink).not.toHaveBeenCalled();
    gateway.failOn = null;
    db.getBillingLink.mockRejectedValue(new Error("getBillingLink failed: timeout"));
    await expect(sendBillingLink(deps(), INPUT)).rejects.toThrow(/getBillingLink failed/);
    log.mockRestore();
  });
});
```

Create `apps/web/src/lib/billing/change-plan.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import type { SubscriptionSnapshot } from "@bis/db";
import { planChangeItems } from "./change-plan";

const NEW = { base: "price_B2", voice_minutes: "price_V2", sms: "price_S2", ai_chats: "price_A2" };
const sub = (keys: (string | null)[]): SubscriptionSnapshot => ({
  id: "sub_1", customerId: "cus_1", status: "active", accountId: "a", planId: "p1",
  currentPeriodStart: 1, currentPeriodEnd: 2, startedAt: 1,
  items: keys.map((k, i) => ({ id: `si_${i}`, priceId: `price_old_${i}`, priceKey: k as never, planId: "p1" })),
});

describe("planChangeItems (G15)", () => {
  it("swaps each item's price for the SAME role's new price, in place (mutation: map by position → the meter prices cross, FAILS)", () => {
    expect(planChangeItems(sub(["sms", "base", "ai_chats", "voice_minutes"]), NEW)).toEqual([
      { id: "si_1", price: "price_B2" }, { id: "si_3", price: "price_V2" }, { id: "si_0", price: "price_S2" }, { id: "si_2", price: "price_A2" },
    ]);
  });

  it("refuses a subscription that is not exactly BIS's four roles: a missing, doubled, unknown or extra item (mutation: skip the count check → a hand-added item is left on the old plan, FAILS)", () => {
    expect(planChangeItems(sub(["base", "sms", "ai_chats"]), NEW)).toBeNull();
    expect(planChangeItems(sub(["base", "sms", "sms", "ai_chats", "voice_minutes"]), NEW)).toBeNull();
    expect(planChangeItems(sub(["base", "sms", "ai_chats", "voice_minutes", null]), NEW)).toBeNull();
  });
});
```

Create `apps/web/src/lib/billing/portal.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { FakeGateway } from "./fake-gateway";
import { ensurePortalConfiguration, openPortal } from "./portal";
import { PORTAL_VERSION } from "./stripe-gateway";

describe("the Customer Portal (G19)", () => {
  it("reuses BIS's tagged configuration and creates nothing (mutation: always create → a new configuration per click, FAILS)", async () => {
    const fake = new FakeGateway();
    fake.portalConfigurations = [{ id: "bpc_other", metadata: {} }, { id: "bpc_ours", metadata: { bis_portal: PORTAL_VERSION } }];
    expect(await ensurePortalConfiguration(fake)).toBe("bpc_ours");
    expect(fake.calls.map((c) => c.op)).toEqual(["listPortalConfigurations"]);
  });

  it("creates it once when missing, under a key that replays: two first-clicks at once make ONE configuration (mutation: a random key → two, FAILS)", async () => {
    const fake = new FakeGateway();
    const [a, b] = await Promise.all([ensurePortalConfiguration(fake), ensurePortalConfiguration(fake)]);
    expect(a).toBe(b);
    expect(fake.portalConfigurations).toHaveLength(1);
  });

  it("opens a session for the customer on BIS's configuration, returning where the caller asked (mutation: omit the configuration → the account's default portal, with self-cancel if enabled there, FAILS)", async () => {
    const fake = new FakeGateway();
    const url = await openPortal(fake, { customerId: "cus_1", returnUrl: "https://app.example/dashboard/accounts/a/billing" });
    expect(url).toBe("https://billing.stripe.test/p/session/cus_1");
    expect(fake.portalSessions).toEqual([{
      customerId: "cus_1", returnUrl: "https://app.example/dashboard/accounts/a/billing", configurationId: fake.portalConfigurations[0]!.id,
    }]);
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm --filter web exec vitest run src/lib/email/templates/billing-link.test.ts src/lib/billing/billing-link.test.ts src/lib/billing/change-plan.test.ts src/lib/billing/portal.test.ts` → FAIL (no modules).

- [ ] **Step 3: The email**

Create `apps/web/src/lib/email/templates/billing-link.ts`:

```ts
import { shell, button, escapeHtml, type EmailBrand } from "./shell";

export type BillingLinkEmailInput = {
  brand: EmailBrand;
  /** The client's customer-facing brand name, or null. NEVER accounts.name
   *  (the agency's private label; shell.ts's rule). */
  businessName: string | null;
  planName: string;
  /** "$149.00/month" (priceLine). */
  price: string;
  /** includedLine's whole sentence: "It includes 500 minutes of calls, 1,000
   *  texts and 200 website chats each month." (zero allowances left out). */
  includes: string;
  /** Absolute Stripe Checkout URL. */
  url: string;
  /** When Stripe expires the session, in the account's zone. */
  expires: string;
};

/** The billing link (spec flow 2). From BIS to the client (G18). */
export function billingLinkEmail(input: BillingLinkEmailInput): { subject: string; html: string; text: string } {
  const subject = input.businessName ? `Set up billing for ${input.businessName}` : "Set up your billing";
  const html = shell(input.brand, `
    <p style="margin:0 0 12px;font-size:17px;font-weight:600;">Set up your billing</p>
    <p style="margin:0 0 12px;">Your ${escapeHtml(input.planName)} plan is ${escapeHtml(input.price)}. ${escapeHtml(input.includes)}</p>
    <p style="margin:0 0 20px;">Add a card on Stripe&rsquo;s secure page. It takes about two minutes.</p>
    ${button(input.brand, input.url, "Set up billing")}
    <p style="margin:20px 0 0;color:#71717a;">This link works until ${escapeHtml(input.expires)}. If it runs out, reply and we&rsquo;ll send a new one.</p>
  `);
  const text = [
    "Set up your billing",
    "",
    `Your ${input.planName} plan is ${input.price}. ${input.includes}`,
    "",
    "Add a card on Stripe's secure page. It takes about two minutes:",
    input.url,
    "",
    `This link works until ${input.expires}. If it runs out, reply and we'll send a new one.`,
  ].join("\n");
  return { subject, html, text };
}
```

- [ ] **Step 4: `sendBillingLink`**

Create `apps/web/src/lib/billing/billing-link.ts`:

```ts
import {
  ENDED_STATUSES, getAccountBilling, getBillingLink, markBillingLinkExpired, saveBillingLink,
  type Branding, type Plan, type SupabaseClient,
} from "@bis/db";
import type { EmailProvider } from "@/lib/email";
import { billingLinkEmail } from "@/lib/email/templates/billing-link";
import { emailBrandNamed } from "@/lib/email/templates/shell";
import { formatMoment, includedLine, priceLine } from "./billing-view";
import { idempotencyKey, type BillingGateway, type CheckoutInput, type CheckoutSession } from "./stripe-gateway";

/** Every visual field null: the platform's own unthemed identity, as the
 *  agency's weekly roll-up uses (weekly-agency-report.ts). G18; decided, danlo 2026-09-25. */
const BIS_BRANDING: Branding = {
  brandName: null, brandLogoPath: null, brandColor: null, brandNeutral: null,
  brandCorners: null, brandType: null, brandMode: null, replyToEmail: null,
};

export type SendBillingLinkInput = {
  accountId: string;
  /** Already checked by the caller: exists, active, the account's agency's. */
  plan: Plan;
  email: string;
  /** Customer-facing brand name, or null. */
  businessName: string | null;
  zone: string;
};

export type SendBillingLinkDeps = {
  db: SupabaseClient;
  gateway: BillingGateway;
  email: EmailProvider;
  /** Absolute origin for Checkout's return pages. */
  origin: string;
  now: Date;
  replyTo?: string;
};

export type SendBillingLinkResult =
  | { ok: true; url: string }
  | { ok: false; reason: "already_subscribed" | "checkout_finished" | "stripe_failed" | "stale" }
  | { ok: false; reason: "email_failed"; url: string };

/** A Stripe SDK error (every class sets .type to its own name). Anything
 *  else, a database error included, is not Stripe's and is rethrown. */
function isStripeError(e: unknown): boolean {
  const type = typeof e === "object" && e !== null ? (e as { type?: unknown }).type : undefined;
  return typeof type === "string" && type.startsWith("Stripe");
}

/**
 * Spec flow 2 (plan G2, G3, G18). Order matters for money:
 *   refuse a live subscription → the previous session: complete → stop;
 *   open → mark the stored link expired, THEN expire it at Stripe → reuse or
 *   create the customer → create the session → save it conditionally on the
 *   previous one → email it.
 * The checkout key covers the params AND the previous session id: a double
 * submit that saw the same previous link replays ONE session; a deliberate
 * resend (previous = the last link) makes a new one.
 */
export async function sendBillingLink(deps: SendBillingLinkDeps, input: SendBillingLinkInput): Promise<SendBillingLinkResult> {
  const { db, gateway, now } = deps;
  const [billing, link] = await Promise.all([getAccountBilling(db, input.accountId), getBillingLink(db, input.accountId)]);
  if (billing?.subscriptionStatus && !ENDED_STATUSES.includes(billing.subscriptionStatus)) {
    return { ok: false, reason: "already_subscribed" };
  }

  let session: CheckoutSession;
  let customerId: string;
  try {
    if (link) {
      const status = await gateway.getCheckoutSessionStatus(link.checkoutSessionId);
      if (status === "complete") return { ok: false, reason: "checkout_finished" };
      if (status === "open") {
        await markBillingLinkExpired(db, input.accountId, link.checkoutSessionId, now);
        await gateway.expireCheckoutSession(link.checkoutSessionId);
      }
    }
    const customer = { accountId: input.accountId, name: input.businessName, email: input.email };
    customerId = billing?.stripeCustomerId ?? link?.stripeCustomerId
      ?? (await gateway.createCustomer(customer, idempotencyKey("bis-customer", input.accountId, customer))).id;
    const checkout: CheckoutInput = {
      accountId: input.accountId, planId: input.plan.id, customerId, priceIds: input.plan.stripePriceIds,
      successUrl: `${deps.origin}/billing-done?result=success`, cancelUrl: `${deps.origin}/billing-done?result=cancelled`,
    };
    session = await gateway.createCheckoutSession(
      checkout, idempotencyKey("bis-checkout", input.accountId, { ...checkout, previous: link?.checkoutSessionId ?? null }),
    );
  } catch (e) {
    if (!isStripeError(e)) throw e;
    console.error(`billing link: Stripe refused for account ${input.accountId}: ${e instanceof Error ? e.message : String(e)}`);
    return { ok: false, reason: "stripe_failed" };
  }

  const saved = await saveBillingLink(db, {
    accountId: input.accountId, planId: input.plan.id, stripeCustomerId: customerId, checkoutSessionId: session.id,
    checkoutUrl: session.url, sentTo: input.email, expiresAt: new Date(session.expiresAt * 1000).toISOString(),
  }, link?.checkoutSessionId ?? null, now);
  if (!saved) {
    const current = await getBillingLink(db, input.accountId);
    // A replay of this very request (a double submit) already saved and
    // emailed this session: success, and no second email.
    if (current?.checkoutSessionId === session.id) return { ok: true, url: session.url };
    try {
      await gateway.expireCheckoutSession(session.id);
    } catch (e) {
      console.error(`billing link: could not expire the losing session ${session.id}: ${e instanceof Error ? e.message : String(e)}`);
    }
    return { ok: false, reason: "stale" };
  }

  const mail = billingLinkEmail({
    brand: emailBrandNamed(BIS_BRANDING, "BIS"), businessName: input.businessName, planName: input.plan.name,
    price: priceLine(input.plan.monthlyPriceCents), includes: includedLine(input.plan.allowances), url: session.url,
    expires: formatMoment(new Date(session.expiresAt * 1000), input.zone),
  });
  try {
    await deps.email.send({
      to: input.email, fromName: "BIS", ...(deps.replyTo ? { replyTo: deps.replyTo } : {}),
      subject: mail.subject, body: mail.text, html: mail.html,
    });
  } catch (e) {
    console.error(`billing link: email to the client of ${input.accountId} failed: ${e instanceof Error ? e.message : String(e)}`);
    return { ok: false, reason: "email_failed", url: session.url };
  }
  return { ok: true, url: session.url };
}
```

- [ ] **Step 5: `planChangeItems` and the portal**

Create `apps/web/src/lib/billing/change-plan.ts`:

```ts
import { METER_KEYS, type PlanPriceKey, type StripePriceIds, type SubscriptionSnapshot } from "@bis/db";

const ROLES: readonly PlanPriceKey[] = ["base", ...METER_KEYS];

/**
 * Change plan on a paid subscription (G15): each of BIS's four items gets
 * the SAME role's price from the new plan, in place (so a meter stays on its
 * meter). Null unless the subscription is exactly those four roles, once
 * each: a hand-edited subscription is refused, never half-moved.
 */
export function planChangeItems(snapshot: SubscriptionSnapshot, priceIds: StripePriceIds): { id: string; price: string }[] | null {
  if (snapshot.items.length !== ROLES.length) return null;
  const out: { id: string; price: string }[] = [];
  for (const role of ROLES) {
    const items = snapshot.items.filter((i) => i.priceKey === role);
    if (items.length !== 1) return null;
    out.push({ id: items[0]!.id, price: priceIds[role] });
  }
  return out;
}
```

Create `apps/web/src/lib/billing/portal.ts`:

```ts
import {
  idempotencyKey, portalConfigurationParams, PORTAL_VERSION, type BillingGateway,
} from "./stripe-gateway";

/**
 * BIS's own portal configuration (G19), found by its tag or created once.
 * The key hashes the configuration's params, so two first-clicks at once
 * replay one create, and a changed configuration (a new PORTAL_VERSION)
 * makes a new one instead of a 400.
 */
export async function ensurePortalConfiguration(gateway: BillingGateway): Promise<string> {
  const mine = (await gateway.listPortalConfigurations()).find((c) => c.metadata.bis_portal === PORTAL_VERSION);
  if (mine) return mine.id;
  const created = await gateway.createPortalConfiguration(
    idempotencyKey("bis-portal", PORTAL_VERSION, portalConfigurationParams()),
  );
  return created.id;
}

/** A Customer Portal session URL for the customer, on BIS's configuration. */
export async function openPortal(gateway: BillingGateway, input: { customerId: string; returnUrl: string }): Promise<string> {
  const configurationId = await ensurePortalConfiguration(gateway);
  return (await gateway.createPortalSession({ ...input, configurationId })).url;
}
```

(`FakeGateway.createPortalConfiguration` goes through `once`, so the concurrent test sees one configuration. Real Stripe replays the same key the same way.)

- [ ] **Step 6: Run to verify they pass**

Run the Step 2 command. Expected: 3 + 9 + 2 + 3 = `Tests  17 passed (17)`.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/lib/email/templates/billing-link.ts apps/web/src/lib/email/templates/billing-link.test.ts apps/web/src/lib/billing/billing-link.ts apps/web/src/lib/billing/billing-link.test.ts apps/web/src/lib/billing/change-plan.ts apps/web/src/lib/billing/change-plan.test.ts apps/web/src/lib/billing/portal.ts apps/web/src/lib/billing/portal.test.ts
git commit -m "feat(billing): send a billing link (one open session per account), plan-change item mapping, the portal configuration"
```

---

### Task 8: The agency's billing actions

**Owner:** bis-platform.

**Files:**
- Create: `apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/settings/billing-actions.ts`
- Create: `apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/settings/billing-actions.test.ts` (8 tests)

**Interfaces:**
- Consumes: `requireAgency` (`@/lib/auth`); `serviceDb`, `getPlan`, `getAccountBilling`, `getBillingLink`, `getBranding`, `markComplimentary`, `unmarkComplimentary`, `changeComplimentaryPlan`, `mirrorSubscription`, `ENDED_STATUSES` (`@bis/db`); `billingGatewayFromEnv`, `idempotencyKey` (Task 3); `sendBillingLink`, `planChangeItems` (Task 7); `safeZone` (Task 6); `getEmailProvider`, `configuredOrigin`, `originFrom`, `normalizeReplyTo`, `brandDisplayName`.
- Produces (bound to the account id by Task 9's section, server-side):
  - `type BillingActionResult = { ok: true } | { ok: false; error: string; url?: string }`
  - `sendBillingLinkAction(accountId, formData{ planId, email })`
  - `markComplimentaryAction(accountId, formData{ planId })`
  - `removeComplimentaryAction(accountId)`
  - `changePlanAction(accountId, formData{ planId, expectedPlanId, requestId })`

- [ ] **Step 1: Write the failing tests**

Create `apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/settings/billing-actions.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { AccountBilling, Plan, SubscriptionSnapshot } from "@bis/db";

const ACCOUNT = "11111111-1111-4111-8111-111111111111";
const P1 = "22222222-2222-4222-8222-222222222222";
const P2 = "33333333-3333-4333-8333-333333333333";
const REQ = "44444444-4444-4444-8444-444444444444";

const guard = vi.hoisted(() => ({ agency: true, reads: 0 }));
vi.mock("@/lib/auth", () => ({
  requireAgency: async () => { if (!guard.agency) throw new Error("NEXT_REDIRECT"); return { userId: "u_agency" }; },
}));
vi.mock("next/headers", () => ({ headers: async () => new Headers({ host: "app.example", "x-forwarded-proto": "https" }) }));

const dbm = vi.hoisted(() => ({
  account: { id: "", agency_id: "ag", timezone: "America/Chicago" } as { id: string; agency_id: string; timezone: string | null } | null,
  getPlan: vi.fn(), getAccountBilling: vi.fn(), getBillingLink: vi.fn(), getBranding: vi.fn(),
  markComplimentary: vi.fn(), unmarkComplimentary: vi.fn(), changeComplimentaryPlan: vi.fn(), mirrorSubscription: vi.fn(),
}));
vi.mock("@bis/db", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  getPlan: dbm.getPlan, getAccountBilling: dbm.getAccountBilling, getBillingLink: dbm.getBillingLink, getBranding: dbm.getBranding,
  markComplimentary: dbm.markComplimentary, unmarkComplimentary: dbm.unmarkComplimentary,
  changeComplimentaryPlan: dbm.changeComplimentaryPlan, mirrorSubscription: dbm.mirrorSubscription,
  serviceDb: () => ({
    tag: "service",
    from: () => {
      guard.reads += 1;
      const chain = { select: () => chain, eq: () => chain, maybeSingle: async () => ({ data: dbm.account, error: null }) };
      return chain;
    },
  }),
}));

const sendMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/billing/billing-link", () => ({ sendBillingLink: (...a: unknown[]) => sendMock(...a) }));

const gw = vi.hoisted(() => ({ value: null as unknown }));
vi.mock("@/lib/billing/stripe-gateway", async (importOriginal) => ({
  ...(await importOriginal<object>()), billingGatewayFromEnv: () => gw.value,
}));
vi.mock("@/lib/email", () => ({ getEmailProvider: () => ({ isFake: true, send: vi.fn() }) }));

const actions = await import("./billing-actions");
const { FakeGateway } = await import("@/lib/billing/fake-gateway");
const { idempotencyKey } = await import("@/lib/billing/stripe-gateway");
const { m } = await import("@/lib/messages");

const plan = (id: string, over: Partial<Plan> = {}): Plan => ({
  id, agencyId: "ag", name: `Plan ${id.slice(0, 2)}`, monthlyPriceCents: 9900, currency: "usd",
  features: { voice_receptionist: false, web_concierge: true },
  allowances: { voice_minutes: 0, sms: 100, ai_chats: 50 }, overageCents: { voice_minutes: 0, sms: 3, ai_chats: 20 },
  stripeProductId: "prod_x", stripePriceIds: { base: `price_b_${id}`, voice_minutes: `price_v_${id}`, sms: `price_s_${id}`, ai_chats: `price_a_${id}` },
  archivedAt: null, createdAt: "2026-09-01T00:00:00+00:00", updatedAt: "2026-09-01T00:00:00+00:00", ...over,
});
const billing = (over: Partial<AccountBilling> = {}): AccountBilling => ({
  accountId: ACCOUNT, planId: P1, complimentary: false, stripeCustomerId: "cus_1", stripeSubscriptionId: "sub_1",
  subscriptionStatus: "active", currentPeriodStart: null, currentPeriodEnd: null, pastDueSince: null, billingPausedAt: null,
  billingStartedAt: "2026-09-01T00:00:00+00:00", createdAt: "2026-09-01T00:00:00+00:00", updatedAt: "2026-09-01T00:00:00+00:00", ...over,
});
const form = (fields: Record<string, string>) => { const f = new FormData(); for (const [k, v] of Object.entries(fields)) f.set(k, v); return f; };

let fake: InstanceType<typeof FakeGateway>;
beforeEach(() => {
  guard.agency = true;
  guard.reads = 0;
  dbm.account = { id: ACCOUNT, agency_id: "ag", timezone: "America/Chicago" };
  for (const f of [dbm.getPlan, dbm.getAccountBilling, dbm.getBillingLink, dbm.getBranding, dbm.markComplimentary,
    dbm.unmarkComplimentary, dbm.changeComplimentaryPlan, dbm.mirrorSubscription, sendMock]) f.mockReset();
  dbm.getPlan.mockImplementation(async (_db: unknown, id: string) => plan(id));
  dbm.getBranding.mockResolvedValue({ brandName: "Rio Roofing", brandLogoPath: null, brandColor: null, brandNeutral: null, brandCorners: null, brandType: null, brandMode: null, replyToEmail: null });
  dbm.getBillingLink.mockResolvedValue(null);
  fake = new FakeGateway();
  gw.value = { ok: true, gateway: fake, live: false };
  process.env.APP_ORIGIN = "https://app.example";
});

describe("the agency's billing actions", () => {
  it("every action runs requireAgency FIRST: a client (or a forged form post) reads nothing and reaches no one (mutation: move requireAgency below any read → FAILS)", async () => {
    guard.agency = false;
    // allSettled, so no rejection is ever unhandled while the others run.
    const settled = await Promise.allSettled([
      actions.sendBillingLinkAction(ACCOUNT, form({ planId: P1, email: "a@b.co" })),
      actions.markComplimentaryAction(ACCOUNT, form({ planId: P1 })),
      actions.removeComplimentaryAction(ACCOUNT),
      actions.changePlanAction(ACCOUNT, form({ planId: P2, expectedPlanId: P1, requestId: REQ })),
    ]);
    expect(settled.map((s) => s.status === "rejected" && String((s.reason as Error).message))).toEqual(Array(4).fill("NEXT_REDIRECT"));
    expect(guard.reads).toBe(0);
    expect([dbm.getPlan, dbm.getAccountBilling, dbm.getBillingLink, dbm.getBranding, dbm.markComplimentary, dbm.unmarkComplimentary, sendMock]
      .every((f) => f.mock.calls.length === 0)).toBe(true);
  });

  it("send: a bad plan id or email is refused before Stripe, and a plan of ANOTHER agency or an archived one is refused before sendBillingLink (G10) (mutation: skip the agency check → FAILS)", async () => {
    expect(await actions.sendBillingLinkAction(ACCOUNT, form({ planId: "x", email: "a@b.co" }))).toEqual({ ok: false, error: m["billing.error.plan"] });
    expect(await actions.sendBillingLinkAction(ACCOUNT, form({ planId: P1, email: "a@b.co, c@d.co" }))).toEqual({ ok: false, error: m["billing.error.email"] });
    dbm.getPlan.mockResolvedValueOnce(plan(P1, { agencyId: "other" }));
    expect(await actions.sendBillingLinkAction(ACCOUNT, form({ planId: P1, email: "a@b.co" }))).toEqual({ ok: false, error: m["billing.error.plan"] });
    dbm.getPlan.mockResolvedValueOnce(plan(P1, { archivedAt: "2026-09-02T00:00:00Z" }));
    expect(await actions.sendBillingLinkAction(ACCOUNT, form({ planId: P1, email: "a@b.co" }))).toEqual({ ok: false, error: m["billing.error.plan"] });
    expect(sendMock).not.toHaveBeenCalled();
  });

  it("send: hands sendBillingLink the customer-facing brand name, the account's zone and APP_ORIGIN, and maps an email failure to its copy WITH the link (mutation: pass accounts.name → FAILS; drop the url → FAILS)", async () => {
    sendMock.mockResolvedValue({ ok: false, reason: "email_failed", url: "https://checkout.stripe.test/c/pay/cs_1" });
    const r = await actions.sendBillingLinkAction(ACCOUNT, form({ planId: P1, email: " owner@example.com " }));
    expect(r).toEqual({ ok: false, error: m["billing.error.emailFailed"], url: "https://checkout.stripe.test/c/pay/cs_1" });
    const [deps, input] = sendMock.mock.calls[0]!;
    expect(deps).toMatchObject({ origin: "https://app.example", gateway: fake });
    expect(input).toEqual({ accountId: ACCOUNT, plan: plan(P1), email: "owner@example.com", businessName: "Rio Roofing", zone: "America/Chicago" });
  });

  it("send: no usable Stripe key → the no-Stripe copy, and nothing is called (mutation: skip the verdict → FAILS)", async () => {
    gw.value = { ok: false, reason: "missing" };
    expect(await actions.sendBillingLinkAction(ACCOUNT, form({ planId: P1, email: "a@b.co" }))).toEqual({ ok: false, error: m["billing.error.noStripe"] });
    expect(sendMock).not.toHaveBeenCalled();
  });

  it("mark complimentary is refused while a live billing link is out, and 'already on a plan' is said in words (G16) (mutation: drop the link check → a paid checkout could later overwrite it, FAILS)", async () => {
    dbm.getBillingLink.mockResolvedValue({ expiresAt: new Date(Date.now() + 3_600_000).toISOString() });
    expect(await actions.markComplimentaryAction(ACCOUNT, form({ planId: P1 }))).toEqual({ ok: false, error: m["billing.error.stale"] });
    expect(dbm.markComplimentary).not.toHaveBeenCalled();
    dbm.getBillingLink.mockResolvedValue(null);
    dbm.markComplimentary.mockResolvedValue({ ok: false, reason: "already_billed" });
    expect(await actions.markComplimentaryAction(ACCOUNT, form({ planId: P1 }))).toEqual({ ok: false, error: m["billing.error.alreadyBilled"] });
  });

  it("change plan, complimentary: a database change only, never a Stripe call (mutation: route complimentary through Stripe → FAILS)", async () => {
    dbm.getAccountBilling.mockResolvedValue(billing({ complimentary: true, stripeSubscriptionId: null, subscriptionStatus: null, stripeCustomerId: null }));
    dbm.changeComplimentaryPlan.mockResolvedValue({ ok: true });
    expect(await actions.changePlanAction(ACCOUNT, form({ planId: P2, expectedPlanId: P1, requestId: REQ }))).toEqual({ ok: true });
    expect(dbm.changeComplimentaryPlan).toHaveBeenCalledWith({ tag: "service", from: expect.any(Function) }, expect.objectContaining({ accountId: ACCOUNT, planId: P2, expectedPlanId: P1 }));
    expect(fake.calls).toEqual([]);
  });

  it("change plan, paid: swaps each item in place under a key over the request id AND the change, then mirrors the RE-READ subscription (G15) (mutation: mirror the pre-change snapshot → the old plan is written back, FAILS)", async () => {
    dbm.getAccountBilling.mockResolvedValue(billing());
    const sub: SubscriptionSnapshot = {
      id: "sub_1", customerId: "cus_1", status: "active", accountId: ACCOUNT, planId: P1,
      currentPeriodStart: 1, currentPeriodEnd: 2, startedAt: 1,
      items: (["base", "voice_minutes", "sms", "ai_chats"] as const).map((k) => ({ id: `si_${k}`, priceId: `price_${k}_old`, priceKey: k, planId: P1 })),
    };
    fake.subscriptions.set("sub_1", sub);
    dbm.mirrorSubscription.mockResolvedValue({ kind: "written", accountId: ACCOUNT, planId: P2, status: "active" });
    expect(await actions.changePlanAction(ACCOUNT, form({ planId: P2, expectedPlanId: P1, requestId: REQ }))).toEqual({ ok: true });
    const change = {
      subscriptionId: "sub_1", planId: P2,
      items: [
        { id: "si_base", price: `price_b_${P2}` }, { id: "si_voice_minutes", price: `price_v_${P2}` },
        { id: "si_sms", price: `price_s_${P2}` }, { id: "si_ai_chats", price: `price_a_${P2}` },
      ],
    };
    expect(fake.subscriptionChanges).toEqual([{ change, key: idempotencyKey("bis-subchange", REQ, change) }]);
    // The mirror is handed a READER (B5); what it reads is Stripe after the change.
    const read = dbm.mirrorSubscription.mock.calls[0]![1] as () => Promise<SubscriptionSnapshot>;
    expect((await read()).planId).toBe(P2);
  });

  it("change plan refuses a stale screen (the plan it saw is no longer the account's) before any Stripe call (mutation: drop the expectedPlanId check → FAILS)", async () => {
    dbm.getAccountBilling.mockResolvedValue(billing({ planId: P2 }));
    expect(await actions.changePlanAction(ACCOUNT, form({ planId: P2, expectedPlanId: P1, requestId: REQ }))).toEqual({ ok: false, error: m["billing.error.stale"] });
    expect(fake.calls).toEqual([]);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter web exec vitest run "src/app/(dashboard)/dashboard/accounts/[accountId]/settings/billing-actions.test.ts"` → FAIL.

- [ ] **Step 3: Write the actions**

Create `apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/settings/billing-actions.ts`:

```ts
"use server";

/**
 * The agency's Billing card actions (spec section 5; plan G2, G10, G15,
 * G16). requireAgency() is the FIRST line of every one: the Settings page is
 * agency-only, but a server action is a public POST endpoint, so each guards
 * itself. The account id is bound server-side by billing-section.tsx and
 * never travels as a form field. Writes go through serviceDb() (0051/0052
 * grant authenticated at most SELECT).
 */
import { headers } from "next/headers";
import {
  ENDED_STATUSES, changeComplimentaryPlan, getAccountBilling, getBillingLink, getBranding, getPlan,
  markComplimentary, mirrorSubscription, serviceDb, unmarkComplimentary, type Plan, type SupabaseClient,
} from "@bis/db";
import { requireAgency } from "@/lib/auth";
import { sendBillingLink, type SendBillingLinkResult } from "@/lib/billing/billing-link";
import { safeZone } from "@/lib/billing/billing-view";
import { planChangeItems } from "@/lib/billing/change-plan";
import { billingGatewayFromEnv, idempotencyKey } from "@/lib/billing/stripe-gateway";
import { getEmailProvider } from "@/lib/email";
import { configuredOrigin, originFrom } from "@/lib/email/origin";
import { normalizeReplyTo } from "@/lib/email/reply-to";
import { brandDisplayName } from "@/lib/email/templates/shell";
import { m, type MessageKey } from "@/lib/messages";

export type BillingActionResult = { ok: true } | { ok: false; error: string; url?: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const isUuid = (x: unknown): x is string => typeof x === "string" && UUID.test(x);
/** ONE address: no spaces, commas or semicolons (a list is refused). */
const EMAIL = /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/;
const fail = (key: MessageKey, url?: string): BillingActionResult =>
  (url ? { ok: false, error: m[key], url } : { ok: false, error: m[key] });
const field = (f: FormData, name: string): string => String(f.get(name) ?? "").trim();

type AccountRow = { id: string; agency_id: string; timezone: string | null };

async function loadAccount(db: SupabaseClient, accountId: string): Promise<AccountRow | null> {
  const { data, error } = await db.from("accounts").select("id, agency_id, timezone").eq("id", accountId).maybeSingle();
  if (error) throw new Error(`billing action: account read failed: ${error.message}`);
  return data as AccountRow | null;
}

/** A plan this account may be put on: exists, not archived, the account's
 *  own agency's (G10). Checked BEFORE any Stripe call. */
async function usablePlan(db: SupabaseClient, account: AccountRow, planId: string): Promise<Plan | null> {
  const plan = await getPlan(db, planId);
  return plan && !plan.archivedAt && plan.agencyId === account.agency_id ? plan : null;
}

const SEND_ERRORS: Record<Exclude<SendBillingLinkResult, { ok: true }>["reason"], MessageKey> = {
  already_subscribed: "billing.error.alreadySubscribed",
  checkout_finished: "billing.error.checkoutFinished",
  stripe_failed: "billing.error.stripeFailed",
  stale: "billing.error.stale",
  email_failed: "billing.error.emailFailed",
};

export async function sendBillingLinkAction(accountId: string, formData: FormData): Promise<BillingActionResult> {
  await requireAgency();
  if (!isUuid(accountId)) return fail("billing.error.stale");
  const planId = field(formData, "planId");
  const email = field(formData, "email");
  if (!isUuid(planId)) return fail("billing.error.plan");
  if (email.length > 254 || !EMAIL.test(email)) return fail("billing.error.email");
  const gateway = billingGatewayFromEnv();
  if (!gateway.ok) return fail("billing.error.noStripe");
  const origin = configuredOrigin() ?? originFrom(await headers());
  if (!origin) return fail("billing.error.noOrigin");
  const db = serviceDb();
  const account = await loadAccount(db, accountId);
  if (!account) return fail("billing.error.stale");
  const [plan, branding] = await Promise.all([usablePlan(db, account, planId), getBranding(db, accountId)]);
  if (!plan) return fail("billing.error.plan");
  const result = await sendBillingLink(
    {
      db, gateway: gateway.gateway, email: getEmailProvider(), origin, now: new Date(),
      replyTo: normalizeReplyTo(process.env.AGENCY_SUPPORT_EMAIL),
    },
    { accountId, plan, email, businessName: brandDisplayName(branding) || null, zone: safeZone(account.timezone) },
  );
  if (result.ok) return { ok: true };
  return fail(SEND_ERRORS[result.reason], result.reason === "email_failed" ? result.url : undefined);
}

export async function markComplimentaryAction(accountId: string, formData: FormData): Promise<BillingActionResult> {
  await requireAgency();
  const planId = field(formData, "planId");
  if (!isUuid(accountId)) return fail("billing.error.stale");
  if (!isUuid(planId)) return fail("billing.error.plan");
  const db = serviceDb();
  // G16: never while a live link is out; the card hides the button then,
  // and this is the check a stale card cannot skip.
  const link = await getBillingLink(db, accountId);
  if (link && Date.parse(link.expiresAt) > Date.now()) return fail("billing.error.stale");
  const r = await markComplimentary(db, { accountId, planId, now: new Date() });
  if (r.ok) return { ok: true };
  if (r.reason === "already_billed") return fail("billing.error.alreadyBilled");
  return fail(r.reason === "unknown_account" ? "billing.error.stale" : "billing.error.plan");
}

export async function removeComplimentaryAction(accountId: string): Promise<BillingActionResult> {
  await requireAgency();
  if (!isUuid(accountId)) return fail("billing.error.stale");
  return (await unmarkComplimentary(serviceDb(), accountId)) ? { ok: true } : fail("billing.error.stale");
}

export async function changePlanAction(accountId: string, formData: FormData): Promise<BillingActionResult> {
  await requireAgency();
  const planId = field(formData, "planId");
  const expectedPlanId = field(formData, "expectedPlanId");
  const requestId = field(formData, "requestId");
  if (!isUuid(accountId) || !isUuid(expectedPlanId) || !isUuid(requestId)) return fail("billing.error.stale");
  if (!isUuid(planId)) return fail("billing.error.plan");
  const db = serviceDb();
  const account = await loadAccount(db, accountId);
  if (!account) return fail("billing.error.stale");
  const [plan, billing] = await Promise.all([usablePlan(db, account, planId), getAccountBilling(db, accountId)]);
  if (!plan) return fail("billing.error.plan");
  if (!billing || billing.planId !== expectedPlanId) return fail("billing.error.stale");

  if (billing.complimentary) {
    const r = await changeComplimentaryPlan(db, { accountId, planId, expectedPlanId, now: new Date() });
    if (r.ok) return { ok: true };
    return fail(r.reason === "stale" || r.reason === "unknown_account" ? "billing.error.stale" : "billing.error.plan");
  }

  // Not on an ended subscription, and not on `incomplete`: before the first
  // payment, Stripe may refuse item updates (G15; the card hides it too).
  if (!billing.stripeSubscriptionId || !billing.subscriptionStatus || ENDED_STATUSES.includes(billing.subscriptionStatus)
    || billing.subscriptionStatus === "incomplete") {
    return fail("billing.error.stale");
  }
  const gateway = billingGatewayFromEnv();
  if (!gateway.ok) return fail("billing.error.noStripe");
  let subscriptionId: string;
  try {
    const snapshot = await gateway.gateway.retrieveSubscription(billing.stripeSubscriptionId);
    const items = planChangeItems(snapshot, plan.stripePriceIds);
    if (!items) {
      console.error(`change plan: subscription ${snapshot.id} is not BIS's four items; refusing to move it`);
      return fail("billing.error.stripeFailed");
    }
    const change = { subscriptionId: snapshot.id, planId, items };
    await gateway.gateway.updateSubscriptionPrices(change, idempotencyKey("bis-subchange", requestId, change));
    subscriptionId = snapshot.id;
  } catch (e) {
    console.error(`change plan: Stripe refused for account ${accountId}: ${e instanceof Error ? e.message : String(e)}`);
    return fail("billing.error.stripeFailed");
  }
  // Outside the try: Stripe has the change, so a database failure here must
  // NOT say "nothing was charged". It throws (the card shows the generic
  // crash toast) and the webhook's own mirror lands the same row shortly.
  // The mirror is handed the READER, not a snapshot: it reads the stored row
  // before it asks Stripe (compare-and-set, B5).
  const stripe = gateway.gateway;
  await mirrorSubscription(db, () => stripe.retrieveSubscription(subscriptionId), () => new Date());
  return { ok: true };
}
```

- [ ] **Step 4: Run to verify it passes**

Run the Step 2 command → `Tests  8 passed (8)`.

- [ ] **Step 5: Commit**

```bash
git add "apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/settings/billing-actions.ts" "apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/settings/billing-actions.test.ts"
git commit -m "feat(billing): agency actions — send a billing link, complimentary on/off, change plan (in place, then mirrored)"
```

---

### Task 9: The agency Billing card on account Settings, and its ⌘K entry

**Owner:** bis-frontend. **Design review required** (bis-design-reviewer, on a running build).

**Files:**
- Create: `.../accounts/[accountId]/settings/billing-section.tsx` (server: load, fail soft, bind actions; plus `BillingCardSkeleton`, `BillingCardError`)
- Create: `.../accounts/[accountId]/settings/billing-section.test.ts` (3 tests)
- Create: `.../accounts/[accountId]/settings/billing-card.tsx` (client)
- Create: `.../accounts/[accountId]/settings/billing-card.test.ts` (5 tests)
- Modify: `.../accounts/[accountId]/settings/page.tsx` (mount in `<Suspense>` directly after `ClientAccessPanel`)
- Modify: `apps/web/src/lib/palette/registry.ts` (`SETTINGS_SECTIONS` + `billing`) and `registry.test.ts` (+1)

(`...` = `apps/web/src/app/(dashboard)/dashboard`.)

**Interfaces:**
- Consumes: Task 6's `billingCardView`, `BILLING_STATUS_TREATMENTS`, `safeZone`, `usagePeriodStart`; Task 8's actions; `getAccountBilling`, `getBillingLink`, `listPlans`, `sumUsageSince`, `serviceDb` (`@bis/db`); `stripeKeyVerdict`.
- Produces: `<BillingSection accountId />` (rendered by the Settings page); anchor `#billing`; palette entry `settings:billing`.

- [ ] **Step 1: Write the failing tests**

Create `.../settings/billing-card.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { BillingCardView } from "@/lib/billing/billing-view";
import { BILLING_STATUS_TREATMENTS } from "@/lib/billing/billing-view";
import { m } from "@/lib/messages";
import { renderedText } from "@/lib/rendered-text";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {} }) }));
vi.mock("sonner", () => ({ toast: { success: () => {}, error: () => {} } }));

const { BillingCard } = await import("./billing-card");

const ok = async () => ({ ok: true as const });
const base: BillingCardView = {
  status: "unbilled", plan: null, usage: [], since: null, nextInvoice: null, link: null,
  planOptions: [{ id: "p1", name: "Growth", price: "$149.00/month" }, { id: "p2", name: "Pro", price: "$299.00/month" }],
  defaultEmail: "owner@example.com",
  can: { send: true, changePlan: false, markComplimentary: true, stopComplimentary: false, copyLink: false },
  stripeReady: true,
};
const render = (view: BillingCardView) => renderToStaticMarkup(createElement(BillingCard, {
  view, send: ok, markComplimentary: ok, stopComplimentary: ok, changePlan: ok,
}));
const active: BillingCardView = {
  ...base, status: "active", plan: { id: "p1", name: "Growth", price: "$149.00/month" },
  usage: [
    { meter: "voice_minutes", used: 312, included: 500, over: false, text: "312 of 500 minutes" },
    { meter: "sms", used: 12, included: 1000, over: false, text: "12 of 1,000 texts" },
    { meter: "ai_chats", used: 3, included: 200, over: false, text: "3 of 200 website chats" },
  ],
  since: "Since Oct 12", nextInvoice: "Next invoice Nov 12",
  can: { send: false, changePlan: true, markComplimentary: false, stopComplimentary: false, copyLink: false },
};

describe("BillingCard", () => {
  it("says the status as a dot AND a word, on the #billing anchor ⌘K jumps to (mutation: drop the word → FAILS; drop the id → the palette entry lands nowhere, FAILS)", () => {
    const html = render(active);
    expect(html).toContain('id="billing"');
    expect(html).toContain('data-status="active"');
    expect(renderedText(html)).toContain(BILLING_STATUS_TREATMENTS.active.label);
  });

  it("carries at most ONE primary button, and it is Send billing link (DESIGN rule 8): unbilled has it, active has none (mutation: render Change plan as the default variant → two primaries, FAILS)", () => {
    const primaries = (html: string) => html.match(/btn-primary/g)?.length ?? 0;
    expect(primaries(render(base))).toBe(1);
    expect(renderedText(render(base))).toContain(m["billing.send"]);
    expect(primaries(render(active))).toBe(0);
    expect(primaries(render({ ...active, status: "complimentary", can: { ...active.can, send: true, stopComplimentary: true } }))).toBe(1);
  });

  it("shows plan, '312 of 500 minutes', the period it counts from, the chats note and the next invoice (G12) (mutation: drop the period label → the number has no context, rule 1, FAILS)", () => {
    const text = renderedText(render(active));
    for (const s of ["Growth", "$149.00/month", "312 of 500 minutes", "12 of 1,000 texts", "Since Oct 12", m["billing.usage.chatsNote"], "Next invoice Nov 12"]) {
      expect(text).toContain(s);
    }
  });

  it("the empty state sells the action; with no plans at all it says to create one first (DESIGN rule 5) (mutation: render the empty sentence when plans are missing → FAILS)", () => {
    expect(renderedText(render(base))).toContain(m["billing.card.empty"]);
    expect(renderedText(render({ ...base, planOptions: [], can: { ...base.can, send: false, markComplimentary: false } }))).toContain(m["billing.card.noPlans"]);
  });

  it("renders exactly the actions the view allows, and the link line + Copy link only while a link is out (mutation: always render Mark complimentary → FAILS)", () => {
    const linkView: BillingCardView = {
      ...base, status: "link_sent", link: { sentTo: "owner@example.com", expires: "Oct 16, 3:30 PM", url: "https://checkout.stripe.com/x" },
      can: { send: true, changePlan: false, markComplimentary: false, stopComplimentary: false, copyLink: true },
    };
    const text = renderedText(render(linkView));
    expect(text).toContain(m["billing.link.sentTo"].replace("{email}", "owner@example.com").replace("{date}", "Oct 16, 3:30 PM"));
    expect(text).toContain(m["billing.link.copy"]);
    expect(text).not.toContain(m["billing.comp.mark"]);
    const activeText = renderedText(render(active));
    expect(activeText).toContain(m["billing.changePlan"]);
    expect(activeText).not.toContain(m["billing.send"]);
    expect(activeText).not.toContain(m["billing.link.copy"]);
  });
});
```

Create `.../settings/billing-section.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { isValidElement, type ReactElement } from "react";
import type { AccountBilling, Plan } from "@bis/db";

const dbm = vi.hoisted(() => ({
  getAccountBilling: vi.fn(), getBillingLink: vi.fn(), listPlans: vi.fn(), sumUsageSince: vi.fn(),
  account: { timezone: "America/Chicago", reply_to_email: null as string | null, report_emails: ["boss@example.com"] },
}));
vi.mock("@bis/db", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  getAccountBilling: dbm.getAccountBilling, getBillingLink: dbm.getBillingLink, listPlans: dbm.listPlans, sumUsageSince: dbm.sumUsageSince,
  serviceDb: () => ({
    tag: "service",
    from: () => { const c = { select: () => c, eq: () => c, maybeSingle: async () => ({ data: dbm.account, error: null }) }; return c; },
  }),
}));
vi.mock("./billing-actions", () => ({
  sendBillingLinkAction: async () => ({ ok: true }), markComplimentaryAction: async () => ({ ok: true }),
  removeComplimentaryAction: async () => ({ ok: true }), changePlanAction: async () => ({ ok: true }),
}));

const { BillingSection, BillingCardError } = await import("./billing-section");
const { BillingCard } = await import("./billing-card");

const PLAN = { id: "p1", agencyId: "ag", name: "Growth", monthlyPriceCents: 14900, currency: "usd",
  features: { voice_receptionist: true, web_concierge: true }, allowances: { voice_minutes: 500, sms: 1000, ai_chats: 200 },
  overageCents: { voice_minutes: 10, sms: 3, ai_chats: 25 }, stripeProductId: "prod_1",
  stripePriceIds: { base: "price_b", voice_minutes: "price_v", sms: "price_s", ai_chats: "price_a" },
  archivedAt: null, createdAt: "", updatedAt: "" } as Plan;
const BILLED = { accountId: "a", planId: "p1", complimentary: false, stripeCustomerId: "cus_1", stripeSubscriptionId: "sub_1",
  subscriptionStatus: "active", currentPeriodStart: "2026-10-12T17:00:00+00:00", currentPeriodEnd: "2026-11-12T17:00:00+00:00",
  pastDueSince: null, billingPausedAt: null, billingStartedAt: "", createdAt: "", updatedAt: "" } as AccountBilling;

beforeEach(() => {
  for (const f of [dbm.getAccountBilling, dbm.getBillingLink, dbm.listPlans, dbm.sumUsageSince]) f.mockReset();
  dbm.getBillingLink.mockResolvedValue(null);
  dbm.listPlans.mockResolvedValue([PLAN]);
  dbm.sumUsageSince.mockResolvedValue({ voice_minutes: 312, sms: 0, ai_chats: 0 });
});

describe("BillingSection", () => {
  it("reads everything through serviceDb (billing_links is service-role only) and counts usage from Stripe's period start (mutation: count from the 1st → FAILS)", async () => {
    dbm.getAccountBilling.mockResolvedValue(BILLED);
    const el = (await BillingSection({ accountId: "a" })) as ReactElement<{ view: { usage: { text: string }[] } }>;
    expect(isValidElement(el) && el.type).toBe(BillingCard);
    expect(dbm.getAccountBilling.mock.calls[0]![0]).toMatchObject({ tag: "service" });
    expect(dbm.sumUsageSince).toHaveBeenCalledWith(expect.objectContaining({ tag: "service" }), "a", "2026-10-12T17:00:00.000Z");
    expect(el.props.view.usage[0]!.text).toBe("312 of 500 minutes");
  });

  it("pre-fills the recipient with the reply-to address, else the first weekly-report address (G18) (mutation: always blank → FAILS)", async () => {
    dbm.getAccountBilling.mockResolvedValue(null);
    const el = (await BillingSection({ accountId: "a" })) as ReactElement<{ view: { defaultEmail: string } }>;
    expect(el.props.view.defaultEmail).toBe("boss@example.com");
  });

  it("a failed read renders the error card and logs; it never takes Settings (and its client-access switch) offline (mutation: let the error propagate → FAILS)", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    dbm.getAccountBilling.mockRejectedValue(new Error("getAccountBilling failed: timeout"));
    const el = (await BillingSection({ accountId: "a" })) as ReactElement;
    expect(isValidElement(el) && el.type).toBe(BillingCardError);
    expect(log.mock.calls.flat().join(" ")).toContain("timeout");
    log.mockRestore();
  });
});
```

Append to `apps/web/src/lib/palette/registry.test.ts`, beside the alert-phone case:

```ts
  it("registers the billing settings section, agency only (mutation: remove the SETTINGS_SECTIONS entry → FAILS)", () => {
    const entry = buildPaletteEntries(BASE, true).find((e) => e.id === "settings:billing");
    expect((entry as { href: string } | undefined)?.href).toBe(`${BASE}/settings#billing`);
    expect(buildPaletteEntries(BASE, false).some((e) => e.id === "settings:billing")).toBe(false);
  });
```

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm --filter web exec vitest run "src/app/(dashboard)/dashboard/accounts/[accountId]/settings/billing-" src/lib/palette/registry.test.ts` → FAIL.

- [ ] **Step 3: The card**

Create `.../settings/billing-card.tsx`:

```tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { DotPill } from "@/components/dot-pill";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { BILLING_STATUS_TREATMENTS, type BillingCardView, type PlanOption } from "@/lib/billing/billing-view";
import { useFormSubmit } from "@/lib/forms/use-form-submit";
import { m } from "@/lib/messages";
import { SubmitButton } from "../../submit-button";
import type { BillingActionResult } from "./billing-actions";

type Action = (formData: FormData) => Promise<BillingActionResult>;

/**
 * The agency's Billing card (spec section 5). Agency-only by construction:
 * rendered from Settings (requireAgencyOnlyAccountAccess), and every action
 * re-checks requireAgency. One view with ONE primary (DESIGN rule 8): Send
 * billing link, when it applies; everything else is ghost. Complimentary
 * changes are reversible, so they run at once with an Undo toast (rule 6);
 * a paid plan change is a dialog decision with no undo (G15).
 */
export function BillingCard({ view, send, markComplimentary, stopComplimentary, changePlan }: {
  view: BillingCardView;
  send: Action;
  markComplimentary: Action;
  stopComplimentary: () => Promise<BillingActionResult>;
  changePlan: Action;
}) {
  const router = useRouter();
  const t = BILLING_STATUS_TREATMENTS[view.status];

  type Undo = { go: () => Promise<BillingActionResult>; success: string };
  const run = async (go: () => Promise<BillingActionResult>, success: string, undo?: Undo): Promise<boolean> => {
    let r: BillingActionResult;
    try {
      r = await go();
    } catch {
      toast.error(m["common.actionCrashed"]);
      return false;
    }
    router.refresh();
    if (!r.ok) {
      toast.error(r.error);
      return false;
    }
    toast.success(success, undo
      ? { action: { label: m["common.undo"], onClick: () => void run(undo.go, undo.success) } }
      : undefined);
    return true;
  };

  const planForm = (fields: Record<string, string>) => {
    const f = new FormData();
    for (const [k, v] of Object.entries(fields)) f.set(k, v);
    return f;
  };

  return (
    <Card id="billing" className="scroll-mt-24">
      <CardHeader>
        <CardTitle>{m["billing.card.title"]}</CardTitle>
        <CardAction>
          <DotPill label={t.label} chip={t.chip} dot={t.dot} data-status={view.status} />
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {view.plan ? (
          <p className="text-sm font-medium text-foreground">
            {view.plan.name} <span className="text-muted-foreground">· {view.plan.price}</span>
          </p>
        ) : (
          <p className="text-sm text-muted-foreground">
            {view.planOptions.length === 0 ? m["billing.card.noPlans"] : m["billing.card.empty"]}
          </p>
        )}

        {view.usage.length > 0 ? (
          <div className="flex flex-col gap-2">
            <ul className="space-y-1 text-sm tabular-nums text-foreground">
              {view.usage.map((u) => (
                <li key={u.meter} data-over={u.over ? "true" : undefined} className={u.over ? "font-medium" : undefined}>
                  {u.text}
                </li>
              ))}
            </ul>
            {view.since ? (
              <p className="font-mono text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground">{view.since}</p>
            ) : null}
            <p className="text-xs text-muted-foreground">{m["billing.usage.chatsNote"]}</p>
          </div>
        ) : null}

        {view.nextInvoice ? <p className="text-sm text-muted-foreground">{view.nextInvoice}</p> : null}
        {view.link ? (
          <p className="text-sm text-muted-foreground">
            {m["billing.link.sentTo"].replace("{email}", view.link.sentTo).replace("{date}", view.link.expires)}
          </p>
        ) : null}

        <div className="flex flex-wrap items-center gap-2">
          {view.can.send ? (
            <PlanDialog
              trigger={m["billing.send"]} primary title={m["billing.send.title"]} body={m["billing.send.body"]}
              submit={m["billing.send"]} plans={view.planOptions} defaultPlanId={view.plan?.id ?? view.planOptions[0]?.id}
              email={view.defaultEmail}
              onSubmit={(f) => run(() => send(f), m["billing.send.done"])}
            />
          ) : null}
          {view.can.copyLink && view.link ? (
            <Button
              variant="ghost" type="button"
              onClick={() => void navigator.clipboard.writeText(view.link!.url).then(
                () => toast.success(m["billing.link.copied"]), () => toast.error(m["common.actionCrashed"]),
              )}
            >
              {m["billing.link.copy"]}
            </Button>
          ) : null}
          {view.can.changePlan && view.plan ? (
            <PlanDialog
              trigger={m["billing.changePlan"]} title={m["billing.changePlan"]}
              body={view.status === "complimentary" ? m["billing.changePlan.bodyComplimentary"] : m["billing.changePlan.bodyPaid"]}
              submit={m["billing.changePlan"]} plans={view.planOptions.filter((p) => p.id !== view.plan!.id)}
              withRequestId expectedPlanId={view.plan.id}
              onSubmit={(f) => {
                const from = view.plan!.id;
                const to = String(f.get("planId"));
                const undo = view.status === "complimentary"
                  ? {
                    go: () => changePlan(planForm({ planId: from, expectedPlanId: to, requestId: crypto.randomUUID() })),
                    success: m["billing.changePlan.done"],
                  }
                  : undefined;
                return run(() => changePlan(f), m["billing.changePlan.done"], undo);
              }}
            />
          ) : null}
          {view.can.markComplimentary ? (
            <PlanDialog
              trigger={m["billing.comp.mark"]} title={m["billing.comp.mark"]} body={m["billing.comp.markBody"]}
              submit={m["billing.comp.mark"]} plans={view.planOptions} defaultPlanId={view.planOptions[0]?.id}
              onSubmit={(f) => run(() => markComplimentary(f), m["billing.comp.done"],
                { go: () => stopComplimentary(), success: m["billing.comp.stopped"] })}
            />
          ) : null}
          {view.can.stopComplimentary && view.plan ? (
            <Button
              variant="ghost" type="button"
              onClick={() => {
                const planId = view.plan!.id;
                void run(() => stopComplimentary(), m["billing.comp.stopped"],
                  { go: () => markComplimentary(planForm({ planId })), success: m["billing.comp.done"] });
              }}
            >
              {m["billing.comp.stop"]}
            </Button>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}

/** One dialog shape for Send, Change plan and Mark complimentary: a plan
 *  picker (+ an email for Send). The dialog is the decision, not an "Are you
 *  sure?" (rule 6): its one primary is the submit. */
function PlanDialog({
  trigger, primary = false, title, body, submit, plans, defaultPlanId, email, withRequestId = false, expectedPlanId, onSubmit,
}: {
  trigger: string;
  primary?: boolean;
  title: string;
  body: string;
  submit: string;
  plans: PlanOption[];
  defaultPlanId?: string;
  email?: string;
  withRequestId?: boolean;
  expectedPlanId?: string;
  onSubmit: (formData: FormData) => Promise<boolean>;
}) {
  const [open, setOpen] = useState(false);
  const [requestId, setRequestId] = useState("");
  const { pending, onSubmit: submitForm } = useFormSubmit(async (formData) => {
    if (await onSubmit(formData)) setOpen(false);
  });
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        // A new request id per opening (G15): a double click inside one
        // opening replays at Stripe; a second, deliberate change does not.
        if (next && withRequestId) setRequestId(crypto.randomUUID());
      }}
    >
      <DialogTrigger asChild>
        <Button variant={primary ? "default" : "ghost"} type="button">{trigger}</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{body}</DialogDescription>
        </DialogHeader>
        <form onSubmit={submitForm} className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="billing-plan">{m["billing.send.plan"]}</Label>
            <Select name="planId" defaultValue={defaultPlanId ?? plans[0]?.id}>
              <SelectTrigger id="billing-plan"><SelectValue /></SelectTrigger>
              <SelectContent>
                {plans.map((p) => <SelectItem key={p.id} value={p.id}>{p.name} · {p.price}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          {email !== undefined ? (
            <div className="flex flex-col gap-2">
              <Label htmlFor="billing-email">{m["billing.send.email"]}</Label>
              <Input id="billing-email" name="email" type="email" required defaultValue={email} />
            </div>
          ) : null}
          {withRequestId ? <input type="hidden" name="requestId" value={requestId} /> : null}
          {expectedPlanId ? <input type="hidden" name="expectedPlanId" value={expectedPlanId} /> : null}
          <DialogFooter>
            <DialogClose asChild><Button variant="ghost" type="button">{m["common.cancel"]}</Button></DialogClose>
            <SubmitButton pending={pending}>{submit}</SubmitButton>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
```

(`common.cancel`, `common.undo` and `common.actionCrashed` already exist, at `messages.ts:185,186,194`. Each Undo lands with its own success toast: undoing Mark complimentary says "No longer complimentary.", and undoing Stop says "Marked complimentary.".)

- [ ] **Step 4: The section**

Create `.../settings/billing-section.tsx`:

```tsx
import { getAccountBilling, getBillingLink, listPlans, serviceDb, sumUsageSince } from "@bis/db";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Notice } from "@/components/ui/notice";
import { Skeleton } from "@/components/ui/skeleton";
import { billingCardView, safeZone, usagePeriodStart, type BillingCardView } from "@/lib/billing/billing-view";
import { stripeKeyVerdict, type StripeEnv } from "@/lib/billing/stripe-gateway";
import { m } from "@/lib/messages";
import { changePlanAction, markComplimentaryAction, removeComplimentaryAction, sendBillingLinkAction } from "./billing-actions";
import { BillingCard } from "./billing-card";

/**
 * Loads the Billing card. Runs INSIDE the Settings page, after its
 * requireAgencyOnlyAccountAccess, and reads through serviceDb(): billing_links
 * is service-role only (0052), and plans is agency-read (0051). Fails SOFT:
 * a billing failure must never take Settings offline, because the page also
 * hosts the client-access switch (the Vercel-projects precedent above it).
 */
async function loadBillingCardView(accountId: string, now: Date): Promise<BillingCardView> {
  const db = serviceDb();
  const [billing, link, plans, account] = await Promise.all([
    getAccountBilling(db, accountId),
    getBillingLink(db, accountId),
    listPlans(db),
    db.from("accounts").select("timezone, reply_to_email, report_emails").eq("id", accountId).maybeSingle()
      .then(({ data, error }) => {
        if (error) throw new Error(`billing card: account read failed: ${error.message}`);
        if (!data) throw new Error("billing card: account not found");
        return data as { timezone: string | null; reply_to_email: string | null; report_emails: string[] | null };
      }),
  ]);
  const zone = safeZone(account.timezone);
  const plan = billing ? plans.find((p) => p.id === billing.planId) ?? null : null;
  const used = billing ? await sumUsageSince(db, accountId, usagePeriodStart(billing, zone, now).start.toISOString()) : null;
  return billingCardView({
    billing, link, plan, activePlans: plans.filter((p) => !p.archivedAt), used, zone, now,
    defaultEmail: account.reply_to_email ?? account.report_emails?.[0] ?? "",
    stripeReady: stripeKeyVerdict(process.env as StripeEnv).ok,
  });
}

export async function BillingSection({ accountId }: { accountId: string }) {
  let view: BillingCardView;
  try {
    view = await loadBillingCardView(accountId, new Date());
  } catch (e) {
    console.error(`settings: billing card unavailable for account ${accountId}: ${e instanceof Error ? e.message : String(e)}`);
    return <BillingCardError />;
  }
  return (
    <BillingCard
      view={view}
      send={sendBillingLinkAction.bind(null, accountId)}
      markComplimentary={markComplimentaryAction.bind(null, accountId)}
      stopComplimentary={removeComplimentaryAction.bind(null, accountId)}
      changePlan={changePlanAction.bind(null, accountId)}
    />
  );
}

/** The error state (DESIGN rule 5): the card, its title, and one sentence. */
export function BillingCardError() {
  return (
    <Card id="billing" className="scroll-mt-24">
      <CardHeader><CardTitle>{m["billing.card.title"]}</CardTitle></CardHeader>
      <CardContent><Notice tone="warn" className="text-foreground">{m["billing.card.error"]}</Notice></CardContent>
    </Card>
  );
}

/** The loading state (rule 7): shaped like the card — a title, a plan line,
 *  three usage lines, the action row. */
export function BillingCardSkeleton() {
  return (
    <Card aria-busy="true" aria-label={m["billing.card.title"]}>
      <CardHeader><Skeleton className="h-5 w-24" /></CardHeader>
      <CardContent className="flex flex-col gap-3">
        <Skeleton className="h-4 w-48" />
        {[0, 1, 2].map((i) => <Skeleton key={i} className="h-4 w-40" />)}
        <Skeleton className="h-9 w-36" />
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 5: Mount it, and register the section**

In `.../settings/page.tsx`: add `import { Suspense } from "react";` and `import { BillingSection, BillingCardSkeleton } from "./billing-section";`, then directly after the closing tag of `<ClientAccessPanel ... />` add:

```tsx
        {/* Billing (M7a step 3): streamed in its own boundary so a slow
            Stripe-backed read never holds the rest of Settings, and a failed
            one renders its own error card (billing-section.tsx). */}
        <Suspense fallback={<BillingCardSkeleton />}>
          <BillingSection accountId={accountId} />
        </Suspense>
```

In `apps/web/src/lib/palette/registry.ts`, append to `SETTINGS_SECTIONS`:

```ts
  { anchor: "billing", label: m["palette.settings.billing"], keywords: ["plan", "subscription", "invoice", "stripe", "complimentary", "payment"] },
```

- [ ] **Step 6: Run to verify they pass**

Run the Step 2 command → billing-card 5, billing-section 3, registry +1, all green. Then `pnpm --filter web exec vitest run "src/app/(dashboard)/dashboard/accounts/[accountId]/settings/"` → every existing settings test still green (the page test, if any, gains a Suspense child; update an exact-children assertion only if one exists, and say so in the report).

- [ ] **Step 7: Commit**

```bash
git add "apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/settings" apps/web/src/lib/palette/registry.ts apps/web/src/lib/palette/registry.test.ts
git commit -m "feat(billing): the agency Billing card on account Settings (status, usage vs allowances, send link, complimentary, change plan) + ⌘K"
```

---

### Task 10: The client's Billing page, Manage billing, and its nav entry

**Owner:** bis-frontend (page, nav), bis-platform (the portal action). **Design review required.**

**Files:**
- Create: `.../accounts/[accountId]/billing/page.tsx`, `page.test.ts` (4 tests), `loading.tsx`
- Create: `.../accounts/[accountId]/billing/actions.ts`, `actions.test.ts` (3 tests)
- Create: `.../accounts/[accountId]/billing/manage-billing-button.tsx`
- Modify: `apps/web/src/lib/nav-groups.ts` (a client-only `billing` item, last in OVERVIEW; `"billing"` in `NavIconKey`) and `nav-groups.test.ts` (+1)
- Modify: `apps/web/src/components/app-sidebar.tsx` (`billing: Receipt` in `NAV_ICONS`)
- Modify: `apps/web/src/lib/palette/registry.ts` (`NAV_KEYWORDS["/billing"]`)

**Interfaces:**
- Consumes: `requireAccountAccess`; `dbForRequest`; `getAccountBilling`, `getPlan`, `sumUsageSince`, `serviceDb`; Task 6's view helpers; Task 7's `openPortal`; `billingGatewayFromEnv`; `configuredOrigin`/`originFrom`.
- Produces: the route `/dashboard/accounts/[accountId]/billing`; `openBillingPortalAction(accountId)`.

- [ ] **Step 1: Write the failing tests**

Create `.../accounts/[accountId]/billing/page.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { isValidElement, type ReactElement, type ReactNode } from "react";
import type { AccountBilling, Plan } from "@bis/db";

const guard = vi.hoisted(() => ({ allowed: true, order: [] as string[] }));
vi.mock("@/lib/auth", () => ({
  requireAccountAccess: async () => { guard.order.push("guard"); if (!guard.allowed) throw new Error("NEXT_REDIRECT"); return { userId: "u", isAgency: false }; },
}));
const dbm = vi.hoisted(() => ({ getAccountBilling: vi.fn(), getPlan: vi.fn(), sumUsageSince: vi.fn() }));
vi.mock("@bis/db", async (importOriginal) => ({
  ...(await importOriginal<object>()), ...dbm, serviceDb: () => ({ tag: "service" }),
}));
vi.mock("@/lib/db", () => ({
  dbForRequest: async () => {
    guard.order.push("db");
    return { tag: "rls", from: () => { const c = { select: () => c, eq: () => c, maybeSingle: async () => ({ data: { timezone: "America/Chicago" }, error: null }) }; return c; } };
  },
}));
vi.mock("./actions", () => ({ openBillingPortalAction: async () => ({ ok: false, error: "x" }) }));

const { default: BillingPage } = await import("./page");
const { EmptyState } = await import("@/components/empty-state");
const { ManageBillingButton } = await import("./manage-billing-button");
const { m } = await import("@/lib/messages");

/** Every element of a type in the tree the page returns (it is CALLED, not rendered). */
function find(node: ReactNode, type: unknown): ReactElement[] {
  if (!isValidElement(node)) return Array.isArray(node) ? node.flatMap((n) => find(n, type)) : [];
  const own = node.type === type ? [node] : [];
  return [...own, ...find((node.props as { children?: ReactNode }).children, type)];
}
const text = (node: ReactNode): string => {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(text).join(" ");
  if (isValidElement(node)) return text((node.props as { children?: ReactNode }).children);
  return "";
};

const PLAN = { id: "p1", agencyId: "ag", name: "Growth", monthlyPriceCents: 14900, currency: "usd",
  features: { voice_receptionist: true, web_concierge: true }, allowances: { voice_minutes: 500, sms: 1000, ai_chats: 200 },
  overageCents: { voice_minutes: 10, sms: 3, ai_chats: 25 }, stripeProductId: "prod_1",
  stripePriceIds: { base: "price_b", voice_minutes: "price_v", sms: "price_s", ai_chats: "price_a" },
  archivedAt: null, createdAt: "", updatedAt: "" } as Plan;
const PAID = { accountId: "a", planId: "p1", complimentary: false, stripeCustomerId: "cus_1", stripeSubscriptionId: "sub_1",
  subscriptionStatus: "active", currentPeriodStart: "2026-10-12T17:00:00+00:00", currentPeriodEnd: "2026-11-12T17:00:00+00:00",
  pastDueSince: null, billingPausedAt: null, billingStartedAt: "", createdAt: "", updatedAt: "" } as AccountBilling;
const page = () => BillingPage({ params: Promise.resolve({ accountId: "a" }) });

beforeEach(() => {
  guard.allowed = true;
  guard.order = [];
  for (const f of Object.values(dbm)) f.mockReset();
  dbm.getPlan.mockResolvedValue(PLAN);
  dbm.sumUsageSince.mockResolvedValue({ voice_minutes: 312, sms: 0, ai_chats: 0 });
});

describe("the client Billing page", () => {
  it("requireAccountAccess runs before anything is read: another account's id never reads a row (mutation: read first → FAILS)", async () => {
    guard.allowed = false;
    await expect(page()).rejects.toThrow("NEXT_REDIRECT");
    expect(guard.order).toEqual(["guard"]);
    expect(dbm.getAccountBilling).not.toHaveBeenCalled();
  });

  it("an account that is not billed yet gets the empty state, which says what will appear here (DESIGN rule 5) (mutation: render an empty card → FAILS)", async () => {
    dbm.getAccountBilling.mockResolvedValue(null);
    const tree = await page();
    const [empty] = find(tree, EmptyState);
    expect(empty?.props).toMatchObject({ title: m["billing.page.empty.title"], body: m["billing.page.empty.body"] });
  });

  it("a subscriber sees plan, price, '312 of 500 minutes' since the period start, the next invoice and Manage billing; the plan is read through the SERVICE path keyed by the account's OWN row (PR-1 binding: never widen plans_agency_read) (mutation: read the plan on the RLS client → it is invisible to a client, FAILS)", async () => {
    dbm.getAccountBilling.mockResolvedValue(PAID);
    const tree = await page();
    expect(dbm.getAccountBilling.mock.calls[0]![0]).toMatchObject({ tag: "rls" });
    expect(dbm.getPlan).toHaveBeenCalledWith({ tag: "service" }, "p1");
    expect(dbm.sumUsageSince).toHaveBeenCalledWith(expect.objectContaining({ tag: "rls" }), "a", "2026-10-12T17:00:00.000Z");
    const words = text(tree);
    for (const s of ["Growth", "$149.00/month", "312 of 500 minutes", "Since Oct 12", "Next invoice Nov 12"]) expect(words).toContain(s);
    expect(find(tree, ManageBillingButton)).toHaveLength(1);
  });

  it("a complimentary account sees its plan and usage, says there is nothing to pay, and has no Manage billing (mutation: always render the button → a portal with no customer, FAILS)", async () => {
    dbm.getAccountBilling.mockResolvedValue({ ...PAID, complimentary: true, stripeCustomerId: null, stripeSubscriptionId: null, subscriptionStatus: null });
    const tree = await page();
    expect(text(tree)).toContain(m["billing.page.complimentary"]);
    expect(find(tree, ManageBillingButton)).toHaveLength(0);
  });
});
```

Create `.../accounts/[accountId]/billing/actions.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const ACCOUNT = "11111111-1111-4111-8111-111111111111";
const guard = vi.hoisted(() => ({ allowed: true, order: [] as string[] }));
vi.mock("@/lib/auth", () => ({
  requireAccountAccess: async () => { guard.order.push("guard"); if (!guard.allowed) throw new Error("NEXT_REDIRECT"); return { userId: "u", isAgency: false }; },
}));
vi.mock("next/headers", () => ({ headers: async () => new Headers({ host: "app.example" }) }));
vi.mock("next/navigation", () => ({ redirect: (url: string) => { throw Object.assign(new Error("NEXT_REDIRECT"), { url }); } }));
const billing = vi.hoisted(() => ({ value: null as unknown }));
vi.mock("@bis/db", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  serviceDb: () => ({ tag: "service" }),
  getAccountBilling: async () => { guard.order.push("read"); return billing.value; },
}));
const gw = vi.hoisted(() => ({ value: null as unknown }));
vi.mock("@/lib/billing/stripe-gateway", async (importOriginal) => ({ ...(await importOriginal<object>()), billingGatewayFromEnv: () => gw.value }));

const { openBillingPortalAction } = await import("./actions");
const { FakeGateway } = await import("@/lib/billing/fake-gateway");
const { m } = await import("@/lib/messages");

let fake: InstanceType<typeof FakeGateway>;
beforeEach(() => {
  guard.allowed = true;
  guard.order = [];
  fake = new FakeGateway();
  gw.value = { ok: true, gateway: fake, live: false };
  billing.value = { stripeCustomerId: "cus_1" };
  process.env.APP_ORIGIN = "https://app.example";
});

describe("openBillingPortalAction", () => {
  it("guards first: an account that is not the caller's own is redirected before its row is read (mutation: read first → FAILS)", async () => {
    guard.allowed = false;
    await expect(openBillingPortalAction(ACCOUNT)).rejects.toThrow("NEXT_REDIRECT");
    expect(guard.order).toEqual(["guard"]);
  });

  it("redirects to a portal session for the account's OWN customer, returning to its own Billing page (mutation: return to /dashboard → the client lands somewhere else, FAILS)", async () => {
    const err = await openBillingPortalAction(ACCOUNT).catch((e: unknown) => e) as { url?: string };
    expect(err.url).toBe("https://billing.stripe.test/p/session/cus_1");
    expect(fake.portalSessions[0]).toMatchObject({ customerId: "cus_1", returnUrl: `https://app.example/dashboard/accounts/${ACCOUNT}/billing` });
  });

  it("no Stripe customer (complimentary) or a Stripe failure is a plain sentence, never a crash (mutation: redirect anyway → FAILS)", async () => {
    billing.value = { stripeCustomerId: null };
    expect(await openBillingPortalAction(ACCOUNT)).toEqual({ ok: false, error: m["billing.page.portalFailed"] });
    billing.value = { stripeCustomerId: "cus_1" };
    fake.failOn = { op: "listPortalConfigurations" };
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await openBillingPortalAction(ACCOUNT)).toEqual({ ok: false, error: m["billing.page.portalFailed"] });
    log.mockRestore();
  });
});
```

Append to `apps/web/src/lib/nav-groups.test.ts`, beside the Branding client-only case:

```ts
  it("Billing is a CLIENT nav item, last in Overview; the agency reaches billing through Settings (G20) (mutation: show it to the agency → FAILS; drop it → FAILS)", () => {
    const overview = (isAgency: boolean) => buildNavGroups(BASE, isAgency).find((g) => g.label === "nav.group.overview")!;
    expect(overview(false).items.at(-1)).toEqual({ href: `${BASE}/billing`, labelKey: "nav.billing", iconKey: "billing" });
    expect(overview(true).items.map((i) => i.labelKey)).not.toContain("nav.billing");
  });
```

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm --filter web exec vitest run "src/app/(dashboard)/dashboard/accounts/[accountId]/billing/" src/lib/nav-groups.test.ts` → FAIL.

- [ ] **Step 3: The portal action and the button**

Create `.../accounts/[accountId]/billing/actions.ts`:

```ts
"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getAccountBilling, serviceDb } from "@bis/db";
import { requireAccountAccess } from "@/lib/auth";
import { openPortal } from "@/lib/billing/portal";
import { billingGatewayFromEnv } from "@/lib/billing/stripe-gateway";
import { configuredOrigin, originFrom } from "@/lib/email/origin";
import { m } from "@/lib/messages";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const failed = { ok: false as const, error: m["billing.page.portalFailed"] };

/**
 * Manage billing (spec section 5): a Stripe Customer Portal session for
 * THIS account's customer. requireAccountAccess first: a client is
 * redirected to its own dashboard for any other account id, so a client can
 * only ever open its own portal. The read is serviceDb() keyed by the
 * guarded id. On success it REDIRECTS (never returns).
 */
export async function openBillingPortalAction(accountId: string): Promise<{ ok: false; error: string }> {
  await requireAccountAccess(accountId);
  if (!UUID.test(accountId)) return failed;
  const billing = await getAccountBilling(serviceDb(), accountId);
  if (!billing?.stripeCustomerId) return failed;
  const gateway = billingGatewayFromEnv();
  if (!gateway.ok) return failed;
  const origin = configuredOrigin() ?? originFrom(await headers());
  if (!origin) return failed;
  let url: string;
  try {
    url = await openPortal(gateway.gateway, {
      customerId: billing.stripeCustomerId, returnUrl: `${origin}/dashboard/accounts/${accountId}/billing`,
    });
  } catch (e) {
    console.error(`billing portal: failed for account ${accountId}: ${e instanceof Error ? e.message : String(e)}`);
    return failed;
  }
  redirect(url);
}
```

Create `.../accounts/[accountId]/billing/manage-billing-button.tsx`:

```tsx
"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { m } from "@/lib/messages";

/**
 * A form, not an onClick: the action REDIRECTS to Stripe on success, and a
 * form action lets Next perform that navigation (a try/catch around a direct
 * call could swallow it). A failure comes back as state and is said inline.
 * The page's one primary (DESIGN rule 8).
 */
export function ManageBillingButton({ open }: { open: () => Promise<{ ok: false; error: string }> }) {
  const [state, action, pending] = useActionState<{ ok: false; error: string } | null>(async () => open(), null);
  return (
    <form action={action} className="flex flex-col items-start gap-2">
      <Button type="submit" disabled={pending}>{m["billing.page.manage"]}</Button>
      <p className="text-xs text-muted-foreground">{m["billing.page.manageHelp"]}</p>
      {state ? <p role="alert" className="text-sm text-destructive">{state.error}</p> : null}
    </form>
  );
}
```

- [ ] **Step 4: The page and its loading state**

Create `.../accounts/[accountId]/billing/page.tsx`:

```tsx
import { CreditCard } from "lucide-react";
import { getAccountBilling, getPlan, serviceDb, sumUsageSince } from "@bis/db";
import { DotPill } from "@/components/dot-pill";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { Card, CardAction, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { requireAccountAccess } from "@/lib/auth";
import { BILLING_STATUS_TREATMENTS, billingCardView, safeZone, usagePeriodStart } from "@/lib/billing/billing-view";
import { dbForRequest } from "@/lib/db";
import { m } from "@/lib/messages";
import { openBillingPortalAction } from "./actions";
import { ManageBillingButton } from "./manage-billing-button";

export const dynamic = "force-dynamic";

/**
 * The client's Billing page (spec section 5): plan, usage this period ("312
 * of 500 minutes", read from usage_events, never the Activity page's
 * counts), the next invoice, and Manage billing. The billing row and the
 * usage are read on the RLS client (0051: a client reads its own rows);
 * the PLAN through serviceDb() keyed by that row's plan_id (PR-1 binding:
 * plans stays agency-read). Reads are not swallowed: a failure reaches the
 * dashboard error boundary (the Plans page's precedent).
 */
export default async function BillingPage({ params }: { params: Promise<{ accountId: string }> }) {
  const { accountId } = await params;
  await requireAccountAccess(accountId);
  const db = await dbForRequest();
  const [billing, account] = await Promise.all([
    getAccountBilling(db, accountId),
    db.from("accounts").select("timezone").eq("id", accountId).maybeSingle().then(({ data, error }) => {
      if (error) throw new Error(`billing page: account read failed: ${error.message}`);
      return data as { timezone: string | null } | null;
    }),
  ]);
  const header = <PageHeader title={m["billing.page.title"]} subtitle={m["billing.page.subtitle"]} />;
  if (!billing) {
    return (
      <>
        {header}
        <div className="p-6">
          <EmptyState icon={CreditCard} title={m["billing.page.empty.title"]} body={m["billing.page.empty.body"]} />
        </div>
      </>
    );
  }

  const plan = await getPlan(serviceDb(), billing.planId);
  if (!plan) throw new Error(`billing page: plan ${billing.planId} of account ${accountId} not found`);
  const zone = safeZone(account?.timezone);
  const now = new Date();
  const used = await sumUsageSince(db, accountId, usagePeriodStart(billing, zone, now).start.toISOString());
  const view = billingCardView({ billing, link: null, plan, activePlans: [], used, zone, now, defaultEmail: "", stripeReady: true });
  const t = BILLING_STATUS_TREATMENTS[view.status];

  return (
    <>
      {header}
      <div className="space-y-4 p-6">
        <Card>
          <CardHeader>
            <CardTitle>{plan.name}</CardTitle>
            <CardAction><DotPill label={t.label} chip={t.chip} dot={t.dot} data-status={view.status} /></CardAction>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <p className="text-sm text-foreground">
              {billing.complimentary ? m["billing.page.complimentary"] : view.plan?.price}
            </p>
            <div className="flex flex-col gap-2">
              <h2 className="text-sm font-medium text-foreground">{m["billing.page.usage"]}</h2>
              <ul className="space-y-1 text-sm tabular-nums text-foreground">
                {view.usage.map((u) => <li key={u.meter} className={u.over ? "font-medium" : undefined}>{u.text}</li>)}
              </ul>
              {view.since ? (
                <p className="font-mono text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground">{view.since}</p>
              ) : null}
              <p className="text-xs text-muted-foreground">{m["billing.usage.chatsNote"]}</p>
            </div>
            {view.nextInvoice ? <p className="text-sm text-muted-foreground">{view.nextInvoice}</p> : null}
            {view.status === "canceled" ? <p className="text-sm text-muted-foreground">{m["billing.page.canceled"]}</p> : null}
            {!billing.complimentary && billing.stripeCustomerId ? (
              <ManageBillingButton open={openBillingPortalAction.bind(null, accountId)} />
            ) : null}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
```

Create `.../accounts/[accountId]/billing/loading.tsx`:

```tsx
import { Skeleton } from "@/components/ui/skeleton";

/** Shaped like the page (DESIGN rule 7): header, then one card with a plan
 *  line, three usage lines and the button. */
export default function Loading() {
  return (
    <div className="p-6" aria-busy="true" aria-label="Loading">
      <Skeleton className="mb-6 h-[76px] rounded-lg" />
      <div className="space-y-3 rounded-xl border border-border p-6">
        <Skeleton className="h-5 w-40" />
        <Skeleton className="h-4 w-28" />
        {[0, 1, 2].map((i) => <Skeleton key={i} className="h-4 w-44" />)}
        <Skeleton className="h-9 w-36" />
      </div>
    </div>
  );
}
```

- [ ] **Step 5: The nav entry**

In `apps/web/src/lib/nav-groups.ts`: add `| "billing"` to `NavIconKey` (after `"plans"`), and in the OVERVIEW group, after the agency-only checklist spread, add:

```ts
        // Clients only (G20), like Branding: the agency sees billing on the
        // account's Settings card. The route itself works for the agency too;
        // hiding a link is not authorization (requireAccountAccess is).
        ...(isAgency
          ? []
          : ([{ href: `${base}/billing`, labelKey: "nav.billing", iconKey: "billing" }] satisfies NavItemSpec[])),
```

In `apps/web/src/components/app-sidebar.tsx`: import `Receipt` from `lucide-react` and add to `NAV_ICONS`, after `plans: CreditCard,`:

```ts
  // `Receipt`, not `CreditCard`: the client's page is what they were billed
  // and will be, not the agency's price list.
  billing: Receipt,
```

In `apps/web/src/lib/palette/registry.ts`, `NAV_KEYWORDS`, add:

```ts
  "/billing": ["invoice", "invoices", "card", "payment", "plan", "subscription", "receipt"],
```

- [ ] **Step 6: Run to verify they pass**

Run the Step 2 command → billing page 4, actions 3, nav-groups +1. Then `pnpm --filter web exec vitest run src/lib/palette src/components/app-sidebar` → green (the palette's nav-parity test picks the new item up by itself).

- [ ] **Step 7: Commit**

```bash
git add "apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/billing" apps/web/src/lib/nav-groups.ts apps/web/src/lib/nav-groups.test.ts apps/web/src/components/app-sidebar.tsx apps/web/src/lib/palette/registry.ts
git commit -m "feat(billing): the client Billing page (plan, usage this period, next invoice, Manage billing → Stripe portal) and its nav entry"
```

---

### Task 11: The payment-failed banner, Checkout's landing page, the styleguide

**Owner:** bis-frontend. **Design review required.**

**Files:**
- Create: `apps/web/src/components/billing-banner.tsx`, `billing-banner.test.ts` (3 tests)
- Modify: `.../accounts/[accountId]/layout.tsx`; Create: `.../accounts/[accountId]/layout.test.ts` (2 tests)
- Create: `apps/web/src/app/(dashboard)/billing-done/page.tsx`, `page.test.ts` (2 tests)
- Modify: `.../styleguide/page.tsx` (one Section)

- [ ] **Step 1: Write the failing tests**

Create `apps/web/src/components/billing-banner.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { m } from "@/lib/messages";
import { renderedText } from "@/lib/rendered-text";

vi.mock("next/link", () => ({
  default: ({ href, children, className }: { href: string; children: unknown; className?: string }) =>
    createElement("a", { href, className }, children as never),
}));
const { BillingBanner } = await import("./billing-banner");
const render = (audience: "client" | "agency") => renderToStaticMarkup(createElement(BillingBanner, { audience, accountId: "acct_1" }));

describe("BillingBanner", () => {
  it("tells the CLIENT, in the spec's words, and links to their own Billing page (mutation: link to Settings → a client cannot open it, FAILS)", () => {
    const html = render("client");
    expect(renderedText(html).replace(/\s+/g, " ").trim()).toBe(`${m["billing.banner.client"]} ${m["billing.banner.clientAction"]}`);
    expect(html).toContain('href="/dashboard/accounts/acct_1/billing"');
  });

  it("tells the AGENCY, inside that account, and links to the Billing card (mutation: show the client sentence to the agency → FAILS)", () => {
    const html = render("agency");
    expect(renderedText(html).replace(/\s+/g, " ").trim()).toBe(`${m["billing.banner.agency"]} ${m["billing.banner.agencyAction"]}`);
    expect(html).toContain('href="/dashboard/accounts/acct_1/settings#billing"');
  });

  it("is a standing note, not an alert, and never colour alone (rule 3): the sentence is the marker (mutation: role=alert → announced on every navigation, FAILS)", () => {
    const html = render("client");
    expect(html).toContain('role="note"');
    expect(renderedText(html)).toContain(m["billing.banner.client"]);
  });
});
```

Create `.../accounts/[accountId]/layout.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { isValidElement, type ReactElement, type ReactNode } from "react";

vi.mock("@/lib/auth", () => ({ requireAccountAccess: async () => ({ userId: "u", isAgency: false }) }));
vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("NOT_FOUND"); } }));
vi.mock("@/lib/db", () => ({
  dbForRequest: async () => ({ from: () => { const c = { select: () => c, eq: () => c, maybeSingle: async () => ({ data: { id: "a", name: "A" }, error: null }) }; return c; } }),
}));
const billing = vi.hoisted(() => ({ read: vi.fn() }));
vi.mock("@bis/db", async (importOriginal) => ({ ...(await importOriginal<object>()), getAccountBilling: billing.read }));

const { default: Layout } = await import("./layout");
const { BillingBanner } = await import("@/components/billing-banner");

function find(node: ReactNode, type: unknown): ReactElement[] {
  if (!isValidElement(node)) return Array.isArray(node) ? node.flatMap((n) => find(n, type)) : [];
  return [...(node.type === type ? [node] : []), ...find((node.props as { children?: ReactNode }).children, type)];
}
const render = () => Layout({ children: "page", params: Promise.resolve({ accountId: "a" }) });

// A BLOCK body, not `() => billing.read.mockReset()`: vitest treats a
// function returned from beforeEach as that test's teardown, and mockReset
// returns the mock itself, which would then be CALLED after the test (the
// plan review saw exactly that: `Error: getAccountBilling failed: timeout`).
beforeEach(() => {
  billing.read.mockReset();
});

describe("account layout: the payment-failed banner (G21)", () => {
  it("shows the client banner on every page of a past-due account, and none on a paid one or an incomplete first payment (mutation: never mount it → FAILS; mount it for active → FAILS; mount it for incomplete → FAILS)", async () => {
    billing.read.mockResolvedValue({ complimentary: false, subscriptionStatus: "past_due", billingPausedAt: null });
    expect(find(await render(), BillingBanner).map((b) => (b.props as { audience: string }).audience)).toEqual(["client"]);
    billing.read.mockResolvedValue({ complimentary: false, subscriptionStatus: "active", billingPausedAt: null });
    expect(find(await render(), BillingBanner)).toHaveLength(0);
    billing.read.mockResolvedValue({ complimentary: false, subscriptionStatus: "incomplete", billingPausedAt: null });
    expect(find(await render(), BillingBanner)).toHaveLength(0);
  });

  it("a failed billing read logs and renders the page WITHOUT a banner: the layout never goes down with billing (mutation: let it throw → every page of the account errors, FAILS)", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    billing.read.mockRejectedValue(new Error("getAccountBilling failed: timeout"));
    const tree = await render();
    expect(find(tree, BillingBanner)).toHaveLength(0);
    expect((tree as ReactElement<{ children: ReactNode[] }>).props.children).toContain("page");
    expect(log).toHaveBeenCalled();
    log.mockRestore();
  });
});
```

Create `apps/web/src/app/(dashboard)/billing-done/page.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { m } from "@/lib/messages";
import { renderedText } from "@/lib/rendered-text";

vi.mock("@/components/auth-shell", () => ({ AuthShell: ({ children }: { children: ReactNode }) => createElement("main", null, children) }));
const { default: BillingDone } = await import("./page");
const html = async (result?: string) => renderToStaticMarkup(await BillingDone({ searchParams: Promise.resolve({ result }) }));

describe("/billing-done (G17)", () => {
  it("after checkout says the plan starts once the payment is confirmed and the tab can close, never that it IS active: only the webhook knows that (mutation: show the cancelled copy on success → FAILS; say the plan is active → FAILS)", async () => {
    const text = renderedText(await html("success"));
    expect(text).toContain(m["billing.done.success.title"]);
    expect(text).toContain(m["billing.done.success.body"]);
    expect(text).not.toMatch(/\bactive\b/i);
  });

  it("anything else (cancelled, or no result) says nothing was charged: the page never claims a payment it cannot know (mutation: default to the success copy → FAILS)", async () => {
    for (const r of ["cancelled", undefined, "bogus"]) {
      const text = renderedText(await html(r));
      expect(text).toContain(m["billing.done.cancelled.body"]);
      expect(text).not.toContain(m["billing.done.success.title"]);
    }
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm --filter web exec vitest run src/components/billing-banner.test.ts "src/app/(dashboard)/dashboard/accounts/[accountId]/layout.test.ts" "src/app/(dashboard)/billing-done/page.test.ts"` → FAIL.

- [ ] **Step 3: The banner**

Create `apps/web/src/components/billing-banner.tsx`:

```tsx
import Link from "next/link";
import { Notice } from "@/components/ui/notice";
import { m } from "@/lib/messages";

/**
 * The payment-failed banner (spec section 5; plan G21). Mounted by the
 * account layout on every page of an account whose subscription is unpaid.
 * role="note", not the Notice default "alert": a standing fact, not an event
 * (LineDownBanner's reasoning). The sentence is the marker, never the tint
 * alone (DESIGN rule 3). The paused banner is PR-4's.
 */
export function BillingBanner({ audience, accountId }: { audience: "client" | "agency"; accountId: string }) {
  const client = audience === "client";
  const href = client ? `/dashboard/accounts/${accountId}/billing` : `/dashboard/accounts/${accountId}/settings#billing`;
  return (
    <Notice tone="crit" role="note" className="text-foreground">
      {client ? m["billing.banner.client"] : m["billing.banner.agency"]}{" "}
      <Link href={href} className="underline underline-offset-2">
        {client ? m["billing.banner.clientAction"] : m["billing.banner.agencyAction"]}
      </Link>
    </Notice>
  );
}
```

- [ ] **Step 4: Mount it in the account layout**

Replace `.../accounts/[accountId]/layout.tsx` with (the existing lookup and its 22P02 comment are kept verbatim):

```tsx
import { notFound } from "next/navigation";
import { getAccountBilling } from "@bis/db";
import { BillingBanner } from "@/components/billing-banner";
import { requireAccountAccess } from "@/lib/auth";
import { showsPaymentFailedBanner } from "@/lib/billing/billing-view";
import { dbForRequest } from "@/lib/db";

export default async function AccountWorkspaceLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ accountId: string }>;
}) {
  const { accountId } = await params;
  const { isAgency } = await requireAccountAccess(accountId);
  const db = await dbForRequest();
  const { data: account, error } = await db
    .from("accounts")
    .select("id, name")
    .eq("id", accountId)
    .maybeSingle();
  if (error) {
    // 22P02 = Postgres invalid_text_representation, which PostgREST surfaces
    // when accountId isn't valid uuid syntax (e.g. a malformed or guessed
    // URL segment like ".../accounts/foo/dashboard"). That is a routing
    // miss, not a query fault, so it belongs behind the same notFound() a
    // well-formed-but-nonexistent id already gets below — not the error
    // boundary. Every other query error still throws and fails loud.
    if (error.code === "22P02") notFound();
    throw new Error(`account lookup failed: ${error.message}`);
  }
  if (!account) notFound();

  // The payment-failed banner (M7a step 3, plan G21), on every page of this
  // account. One primary-key read on the RLS client (0051: the agency and
  // the account's own client may read it). Fails SOFT: a billing read must
  // never take the account's pages down with it. past_due/unpaid only, never
  // incomplete (showsPaymentFailedBanner says why).
  let paymentFailed = false;
  try {
    paymentFailed = showsPaymentFailedBanner(await getAccountBilling(db, accountId));
  } catch (e) {
    console.error(`account layout: billing read failed for ${accountId}: ${e instanceof Error ? e.message : String(e)}`);
  }

  return (
    <>
      {paymentFailed ? (
        <div className="px-6 pt-6">
          <BillingBanner audience={isAgency ? "agency" : "client"} accountId={accountId} />
        </div>
      ) : null}
      {children}
    </>
  );
}
```

- [ ] **Step 5: Checkout's landing page**

Create `apps/web/src/app/(dashboard)/billing-done/page.tsx`:

```tsx
import { CheckCircle2, CircleSlash } from "lucide-react";
import { AuthShell } from "@/components/auth-shell";
import { m } from "@/lib/messages";

/**
 * Where Stripe Checkout returns the payer (G17). PUBLIC (proxy.ts protects
 * /dashboard only) and signed out, so it wears the platform's mark in
 * AuthShell, like /sign-in and /no-access: no tenant can be identified
 * before authentication (DESIGN rule 9's exception, same reason). It claims
 * success only for ?result=success, which only Checkout's success_url sets;
 * the subscription itself becomes real through the webhook, not this page.
 */
export default async function BillingDone({ searchParams }: { searchParams: Promise<{ result?: string }> }) {
  const { result } = await searchParams;
  const success = result === "success";
  const Icon = success ? CheckCircle2 : CircleSlash;
  return (
    <AuthShell>
      <div className="flex flex-col items-start gap-3">
        <Icon className="size-8 text-muted-foreground" aria-hidden />
        <p className="text-sm font-medium text-foreground">
          {success ? m["billing.done.success.title"] : m["billing.done.cancelled.title"]}
        </p>
        <p className="text-sm text-muted-foreground">
          {success ? m["billing.done.success.body"] : m["billing.done.cancelled.body"]}
        </p>
      </div>
    </AuthShell>
  );
}
```

- [ ] **Step 6: The styleguide**

In `.../styleguide/page.tsx`, import `BillingBanner` from `@/components/billing-banner` and `BILLING_STATUS_TREATMENTS`, `type BillingStatus` from `@/lib/billing/billing-view`. Add after the "Stale-usage banner" Section:

```tsx
        <Section title="Billing status and banner" file="lib/billing/billing-view.ts · components/billing-banner.tsx">
          {/* DESIGN rule 3: every billing state is a dot AND a word, in token
              classes only (billing-view.test.ts pins them). The banner is the
              payment-failed one, in both audiences' words. */}
          <div className="w-full space-y-5">
            <div className="flex flex-wrap gap-2">
              {(Object.keys(BILLING_STATUS_TREATMENTS) as BillingStatus[]).map((s) => (
                <DotPill key={s} label={BILLING_STATUS_TREATMENTS[s].label} chip={BILLING_STATUS_TREATMENTS[s].chip}
                  dot={BILLING_STATUS_TREATMENTS[s].dot} data-status={s} />
              ))}
            </div>
            <div className="space-y-2">
              <p className="text-xs text-muted-foreground">The client, on every page of their account</p>
              <BillingBanner audience="client" accountId="styleguide" />
            </div>
            <div className="space-y-2">
              <p className="text-xs text-muted-foreground">The agency, inside that account</p>
              <BillingBanner audience="agency" accountId="styleguide" />
            </div>
          </div>
        </Section>
```

(import `DotPill` from `@/components/dot-pill` if the file does not already.)

- [ ] **Step 7: Run to verify they pass, then the whole web suite**

Run the Step 2 command → 3 + 2 + 2 = `Tests  7 passed (7)`.
Run: `pnpm --filter web test` → all green (the known local `work/page.test.ts` timeout aside; it must pass in CI).

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/components/billing-banner.tsx apps/web/src/components/billing-banner.test.ts "apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/layout.tsx" "apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/layout.test.ts" "apps/web/src/app/(dashboard)/billing-done" "apps/web/src/app/(dashboard)/dashboard/styleguide/page.tsx"
git commit -m "feat(billing): payment-failed banner on every account page, Checkout's landing page, styleguide specimens"
```

---

### Task 12: e2e — a real test-mode Checkout, a signed webhook, both screens, the portal

**Owner:** bis-e2e-qa.

**Files:**
- Create: `apps/web/e2e/billing.spec.ts` (2 tests, serial)
- Modify: `apps/web/e2e/fixtures/sweep.ts` (the plans leg's comment only: "e2e never creates billing rows" stops being true, AND `billing_links.plan_id` (0052) is now also `on delete restrict` toward the plan, same as `account_billing.plan_id` (0051) — the leg's comment names both restricting tables)

**What it proves** (spec section 6, "E2E"):
- **B1:** a real test-mode Checkout session holds the plan's four prices.
- The webhook route accepts a signed event, refuses a forged one, and records a replay once.
- The re-read mirror makes the fixture account billed.
- Both screens show it.
- **B3/B9:** Manage billing lands on Stripe's portal.

Stripe's hosted Checkout page is not driven. Its subscription is made through the API, on the link's own customer, exactly as Checkout would make it (spec section 6: "Stripe's hosted Checkout is not driven; its webhook is"). Mutating: the per-run fixture account only; never `Test Client One`.

- [ ] **Step 1: Write the spec**

Create `apps/web/e2e/billing.spec.ts`:

```ts
import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { config as loadEnv } from "dotenv";
import Stripe from "stripe";
import { insertPlan, serviceDb, type PlanTerms, type StripePriceIds } from "@bis/db";
import { STRIPE_API_VERSION, stripeGateway } from "../src/lib/billing/stripe-gateway";
import { syncPlanToStripe } from "../src/lib/billing/stripe-catalog";
import { m } from "../src/lib/messages";

// Same two dotenv lines as plans.spec.ts.
loadEnv({ path: "apps/web/.env.local" });
loadEnv({ path: ".env.local" });

// STRIPE TEST MODE ONLY, on the per-run fixture account ("E2E Client Co"),
// never Test Client One. The webhook secret is ci.yml's fixture literal: the
// e2e server verifies with it, and this spec signs with it.
const STRIPE_KEY = (process.env.STRIPE_SECRET_KEY ?? "").trim();
const WEBHOOK_SECRET = (process.env.STRIPE_WEBHOOK_SECRET ?? "").trim();
const SKIP = "STRIPE_SECRET_KEY or STRIPE_WEBHOOK_SECRET is not set, so the billing link, the Stripe webhook and both Billing screens were NOT exercised against Stripe test mode.";
const RUN = Date.now();
const PLAN_NAME = `E2E Plan ${RUN}`;
const TERMS: PlanTerms = {
  name: PLAN_NAME, monthlyPriceCents: 4900, features: { voice_receptionist: false, web_concierge: true },
  allowances: { voice_minutes: 100, sms: 200, ai_chats: 50 }, overageCents: { voice_minutes: 10, sms: 3, ai_chats: 20 },
};

test.describe.configure({ mode: "serial" });

test.describe("client billing: the link, the webhook, both Billing screens (Stripe test mode)", () => {
  let stripe: Stripe;
  let accountId = "";
  const planId = randomUUID();
  let productId = "";
  let priceIds: StripePriceIds;
  let customerId = "";
  let subscriptionId = "";
  const eventId = `evt_e2e_${RUN}`;

  test.beforeAll(async () => {
    if (!STRIPE_KEY || !WEBHOOK_SECRET) console.warn(`::warning title=billing.spec.ts skipped::${SKIP}`);
    test.skip(!STRIPE_KEY || !WEBHOOK_SECRET, SKIP);
    expect(/^(sk|rk)_test_/.test(STRIPE_KEY), "billing.spec.ts runs on a Stripe TEST key only").toBe(true);
    stripe = new Stripe(STRIPE_KEY, { apiVersion: STRIPE_API_VERSION });
    accountId = (JSON.parse(readFileSync("e2e/.auth/client-fixture.json", "utf-8")) as { accountId: string }).accountId;
    const made = await syncPlanToStripe(stripeGateway(stripe), planId, TERMS, null);
    productId = made.productId;
    priceIds = made.priceIds;
    const saved = await insertPlan(serviceDb(), { id: planId, terms: TERMS, stripeProductId: productId, stripePriceIds: priceIds });
    expect(saved.ok, "the e2e plan row was written").toBe(true);
  });

  test.afterAll(async () => {
    // Order matters: the billed row RESTRICTS the plan's delete (0051), so
    // the account's billing goes first. Failures are logged, not thrown: an
    // afterAll throw would hide the test's own failure.
    const step = async (label: string, fn: () => Promise<unknown>) => {
      try { await fn(); } catch (e) { console.error(`billing.spec cleanup (${label}): ${e instanceof Error ? e.message : String(e)}`); }
    };
    const db = serviceDb();
    if (subscriptionId) await step("cancel subscription", () => stripe.subscriptions.cancel(subscriptionId));
    if (accountId) {
      await step("account_billing", async () => { const { error } = await db.from("account_billing").delete().eq("account_id", accountId); if (error) throw error; });
      await step("billing_links", async () => { const { error } = await db.from("billing_links").delete().eq("account_id", accountId); if (error) throw error; });
      await step("permissions", async () => { const { error } = await db.from("accounts").update({ permissions: {} }).eq("id", accountId); if (error) throw error; });
    }
    await step("webhook event", async () => { const { error } = await db.from("stripe_webhook_events").delete().eq("event_id", eventId); if (error) throw error; });
    if (customerId) await step("customer", () => stripe.customers.del(customerId));
    await step("plan", async () => { const { error } = await db.from("plans").delete().eq("id", planId); if (error) throw error; });
    if (productId) await step("product", () => stripe.products.update(productId, { active: false }));
  });

  test("the agency sends a billing link: Stripe test mode takes the plan's four prices in ONE subscription Checkout (B1), and the card says Link sent", async ({ page }) => {
    await page.goto(`/dashboard/accounts/${accountId}/settings#billing`);
    const card = page.locator("#billing");
    await expect(card.locator('[data-status="unbilled"]')).toBeVisible();
    await card.getByRole("button", { name: m["billing.send"] }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel(m["billing.send.plan"]).click();
    await page.getByRole("option", { name: new RegExp(`^${PLAN_NAME} `) }).click();
    await dialog.getByLabel(m["billing.send.email"]).fill(`e2e-billing-${RUN}@example.com`);
    await dialog.getByRole("button", { name: m["billing.send"] }).click();
    await expect(page.getByText(m["billing.send.done"])).toBeVisible();
    await expect(card.locator('[data-status="link_sent"]')).toBeVisible();

    const { data: link, error } = await serviceDb().from("billing_links")
      .select("stripe_customer_id, checkout_session_id, sent_to").eq("account_id", accountId).single();
    expect(error).toBeNull();
    const row = link as { stripe_customer_id: string; checkout_session_id: string; sent_to: string };
    customerId = row.stripe_customer_id;
    expect(row.sent_to).toBe(`e2e-billing-${RUN}@example.com`);
    const session = await stripe.checkout.sessions.retrieve(row.checkout_session_id, { expand: ["line_items"] });
    expect([session.mode, session.status, session.client_reference_id, session.customer])
      .toEqual(["subscription", "open", accountId, customerId]);
    expect((session.line_items?.data ?? []).map((l) => l.price?.id).sort()).toEqual(Object.values(priceIds).sort());
  });

  test("a signed webhook makes the account billed — once — and both screens show it; Manage billing opens Stripe's portal (B3, B9)", async ({ page, browser, request }) => {
    expect(customerId, "the first test stored the link's customer").not.toBe("");
    const pm = await stripe.paymentMethods.attach("pm_card_visa", { customer: customerId });
    const sub = await stripe.subscriptions.create({
      customer: customerId, default_payment_method: pm.id,
      items: [{ price: priceIds.base, quantity: 1 }, { price: priceIds.voice_minutes }, { price: priceIds.sms }, { price: priceIds.ai_chats }],
      metadata: { bis_account_id: accountId, bis_plan_id: planId },
    });
    subscriptionId = sub.id;

    const body = JSON.stringify({
      id: eventId, object: "event", type: "customer.subscription.created", livemode: false,
      api_version: STRIPE_API_VERSION, created: Math.floor(Date.now() / 1000),
      data: { object: { id: sub.id, object: "subscription", status: "incomplete" } },
    });
    const post = (secret: string) => request.post("/api/webhooks/stripe", {
      headers: { "content-type": "application/json", "stripe-signature": Stripe.webhooks.generateTestHeaderString({ payload: body, secret }) },
      data: body,
    });
    const forged = await post("whsec_forged");
    expect(forged.status(), "a forged signature is refused").toBe(400);
    const first = await post(WEBHOOK_SECRET);
    expect(first.status()).toBe(200);
    expect(await first.json()).toEqual({ received: true, outcome: "processed" });
    const replay = await post(WEBHOOK_SECRET);
    expect(await replay.json()).toEqual({ received: true, outcome: "duplicate" });

    // The payload said "incomplete"; Stripe says "active". The mirror wrote
    // Stripe's word (G5).
    const { data: billed } = await serviceDb().from("account_billing")
      .select("subscription_status, stripe_subscription_id, plan_id").eq("account_id", accountId).single();
    expect(billed).toEqual({ subscription_status: "active", stripe_subscription_id: sub.id, plan_id: planId });

    await page.goto(`/dashboard/accounts/${accountId}/settings#billing`);
    await expect(page.locator('#billing [data-status="active"]')).toBeVisible();
    await expect(page.locator("#billing")).toContainText("0 of 100 minutes");

    const client = await browser.newContext({ storageState: "e2e/.auth/client-state.json" });
    try {
      const cp = await client.newPage();
      await cp.goto(`/dashboard/accounts/${accountId}/billing`);
      await expect(cp.getByText(PLAN_NAME)).toBeVisible();
      await expect(cp.getByText("0 of 100 minutes")).toBeVisible();
      await expect(cp.getByText(/^Next invoice /)).toBeVisible();
      await cp.getByRole("button", { name: m["billing.page.manage"] }).click();
      await cp.waitForURL(/^https:\/\/billing\.stripe\.com\//, { timeout: 30_000 });
    } finally {
      await client.close();
    }
  });
});
```

- [ ] **Step 2: Typecheck, lint, and the fixture-name rule**

Run: `pnpm --filter web typecheck && pnpm --filter web lint && pnpm --filter web exec vitest run e2e/fixtures/fixture-names.test.ts`
Expected: exit 0. `E2E Plan ${RUN}` is admitted by `FIXTURE_PLAN_RE`, so a killed run's plan is swept. A killed run's `account_billing` row goes with the fixture account's teardown (cascade).

- [ ] **Step 3: Where it runs**

It runs only in CI's `e2e` job (Stripe test key + the fixture webhook secret). Locally it skips with the warning until D7. **Check the rest of the suite:** the client nav now always carries Billing. Grep the e2e suite for any spec that counts or lists the client's nav items (`grep -rn "nav\.\|getByRole(\"link\"" apps/web/e2e/shell.spec.ts apps/web/e2e/palette.spec.ts`) and update an exact list in the same commit, saying so in the report.

- [ ] **Step 4: The sweep's stale comment**

In `apps/web/e2e/fixtures/sweep.ts`, leg 6 (plans), replace the four-line comment paragraph that begins `// A plan referenced by` and ends `never thrown.` — it says "e2e never creates billing rows", which this PR makes false, and it names only `account_billing`'s restrict FK toward the plan, when `billing_links.plan_id` (0052) is now ALSO `on delete restrict` toward the same plan and blocks this leg too — with:

```ts
  // A plan referenced by `account_billing` or `billing_links` (0051/0052,
  // `on delete restrict`) cannot be deleted this way. `billing.spec.ts` DOES
  // create both, on the per-run fixture account only, and its afterAll
  // deletes them before the plan. A killed run's rows go with the fixture
  // account in leg 1 above (both cascade with their account), before this
  // leg runs, so this is not expected to fire; if it ever does, the delete
  // error is reported like every other leg, never thrown.
```

Nothing else in the file changes.

- [ ] **Step 5: Commit**

```bash
git add apps/web/e2e/billing.spec.ts apps/web/e2e/fixtures/sweep.ts
git commit -m "test(e2e): a real test-mode Checkout holds four prices; a signed webhook bills the fixture account once; both screens and the portal"
```

---

### Task 13: Gates, counts, production, Stripe, handoff

**Files:** Create `docs/runbooks/stripe-billing.md` (Step 8, orchestrator). No code.

- [ ] **Step 1: Confirm the new-test count** (the reviewer recounts from vitest's and Playwright's own output, never from this plan)

| Scope | New tests |
|---|---|
| db, live: `billing-checkout-schema` / `account-billing` | 11 / 4 |
| db, unit: `account-billing` / `billing` / `usage` | 17 / 1 / +1 |
| `stripe-gateway` / `stripe-webhook` / `webhook` / webhook `route` / `ci-workflow` | +8 / 3 / 7 / 6 / +1 |
| `billing-view` / `billing-link` email / `billing-link` / `change-plan` / `portal` | 9 / 3 / 9 / 2 / 3 |
| `billing-actions` / `billing-card` / `billing-section` / `registry` | 8 / 5 / 3 / +1 |
| client billing `page` / `actions` / `nav-groups` | 4 / 3 / +1 |
| `billing-banner` / account `layout` / `billing-done` | 3 / 2 / 2 |
| e2e | 2 |

**Total 119.** Edited, not new:
- `usage.test.ts`: the paging fixture;
- `test/usage.test.ts`: the `bill()` helper plus that test's title.

Run: `pnpm --filter web exec vitest run src/lib/billing src/app/api/webhooks/stripe src/components/billing-banner.test.ts "src/app/(dashboard)/billing-done" "src/app/(dashboard)/dashboard/accounts/[accountId]/billing" "src/app/(dashboard)/dashboard/accounts/[accountId]/settings/billing-" "src/app/(dashboard)/dashboard/accounts/[accountId]/layout.test.ts" src/lib/email/templates/billing-link.test.ts`
Expected: all pass.

- [ ] **Step 2: Production migration — BEFORE merge (orchestrator only)**

Merging deploys, and the new code reads `billing_started_at` and `billing_links`. So 0052 must be on production first:
1. Apply it through MCP `apply_migration` (name `0052_billing_checkout`), exactly once. The file has no backslash and no non-ASCII, so no escaping applies. Ledger: `0052 APPLIED to prod — NEVER RE-APPLY`.
2. **Parity** (runbook `ci-supabase-project.md`; PR-1 final review m5: full ACLs + policies), on both projects:
   - `select column_name, data_type, is_nullable, column_default from information_schema.columns where table_name in ('account_billing','billing_links') order by 1, 2`
   - `select relname, relacl, relrowsecurity from pg_class where relname = 'billing_links'` (`relrowsecurity` must be `t` on both)
   - `select * from pg_policies where tablename = 'billing_links'` (expect none)
   - `select conname, pg_get_constraintdef(oid) from pg_constraint where conrelid = 'public.billing_links'::regclass order by 1`

   Diff them. They must be identical.
3. Main's code on production does not read the new columns, and ignores the new table, so applying ahead of the merge is safe (additive).

- [ ] **Step 3: Local gates (what runs locally until D7)**

Run: `pnpm typecheck && pnpm lint` → exit 0. Run: `pnpm --filter web test` → all green except the two live web tests that refuse production by design.

- [ ] **Step 4: CI is the gate**

Push. Read the check runs for the HEAD SHA (`gh api repos/{owner}/{repo}/commits/<sha>/check-runs`):
- `verify`: typecheck, lint, the db suite (Tasks 1-2 on `bis-ci`), the web suite.
- `e2e`: the build plus the whole Playwright suite, `billing.spec.ts` included and NOT skipped. Check the job log for no `billing.spec.ts skipped` warning.

- [ ] **Step 5: Stripe live setup (danlo, with the orchestrator; after the production migration, before or right after merge)**

1. Stripe dashboard (LIVE mode) → Developers → Webhooks → Add endpoint:
   - URL `https://<production domain>/api/webhooks/stripe`;
   - **API version `2026-08-26.dahlia`** (B7);
   - events exactly the six in `HANDLED_WEBHOOK_EVENTS`: `checkout.session.completed`, `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.paid`, `invoice.payment_failed`.
2. Copy its signing secret into Vercel → Project → Settings → Environment Variables → `STRIPE_WEBHOOK_SECRET`, **Production only**, marked Sensitive.
3. **Redeploy production.** Vercel applies an env var to NEW deployments only (ledger correction, PR #35).
4. Verify with the dashboard's "Send test event" for an event type BIS ignores (`customer.created`): expect 200 with `{"received":true,"outcome":"ignored"}`.
   - A test event for one of the six carries a fake subscription id, so the re-read fails and the answer is 500. That is by design, not a fault.
   - Never point the TEST-mode endpoint at production: the key-mode check answers 400 to every test event there.
5. The portal configuration needs no dashboard step (G19). Checkout needs none.
6. **Failed payments, set BEFORE the first live client pays: decided (danlo, 2026-09-25, DECISION 7).** These settings decide which statuses the mirror sees and PR-4 pauses on (B11). Stripe dashboard (LIVE mode) → Billing settings (the retry and customer-email settings; the menu names are Stripe's, not re-read today). Set exactly:
   - **Retry schedule:** Smart Retries, on Stripe's default schedule.
   - **After the last retry:** mark the subscription UNPAID. Never "cancel the subscription": cancelling stays danlo's call, and PR-4's pause handles access. BIS mirrors `unpaid` as Payment failed and keeps the earlier `past_due_since` (G8).
   - **Customer emails:** Stripe emails the client a receipt for each successful payment, and a notice for each failed one: both ON.

   Record the values as set in the ledger and in the runbook (Step 8).

- [ ] **Step 6: The A11 prerequisite, checked, not assumed**

Before merge, `git log origin/main --oneline | grep -i "already exists"` shows the `fix/usage-report-already-exists` squash commit. If it is missing, PR-3 waits. This PR is what creates billed accounts, and the reporter would otherwise wedge the first one whose identifier Stripe refuses as a duplicate.

- [ ] **Step 7: Manual DESIGN.md pass (bis-design-reviewer on a running build)**

Check each of these in dark AND light (`.dark`), at 375 px, and with the blur fallback:
- Settings → Billing card in all seven states. Use the styleguide for the pills and the fixture account for Unbilled, Link sent and Active.
- The three dialogs: Tab order, Esc closes, focus returns to the trigger.
- The client Billing page: loaded, empty, and the error boundary.
- The banner in both audiences.
- `/billing-done` in both results.

Confirm one primary per card and per dialog, and that no raw colour appears in the diff (`git diff origin/main -- apps/web/src | grep -nE "#[0-9a-fA-F]{3,8}\b|rgb\(|bg-(red|green|amber|yellow|blue)-"` shows only the email template's inline hex, which is the email-client dialect `lead-alert.ts` already uses).

- [ ] **Step 8: The billing runbook (orchestrator; commit on the branch before the PR)**

Create `docs/runbooks/stripe-billing.md` (the Step 5 values are the decided ones; correct them if the dashboard was set otherwise):

```markdown
# Stripe billing: live operations

What BIS's client billing needs outside the code, and the rules for touching
it by hand. Plan: docs/superpowers/plans/2026-09-25-m7a-pr3-checkout-webhooks-billing.md.

## The webhook

- LIVE endpoint: `https://<production domain>/api/webhooks/stripe`, API version
  `2026-08-26.dahlia`, the six events in `HANDLED_WEBHOOK_EVENTS`
  (`apps/web/src/lib/billing/stripe-gateway.ts`).
- Its signing secret is `STRIPE_WEBHOOK_SECRET` on Vercel **Production only**.
  An env change needs a redeploy.
- Check it with the dashboard's "Send test event" for `customer.created`:
  200 `{"received":true,"outcome":"ignored"}`. A test event for one of the six
  answers 500 by design (its subscription id is fake).
- CI signs fixture events with a public literal in ci.yml's e2e job. It
  verifies nothing anywhere else.
- **A client's first checkout sends a burst of events at once.** One or two
  of them may answer 500 (the mirror lost a race with its sibling three
  times); Stripe retries them and they succeed. That is normal. A 500 that
  keeps repeating for the same event is not.
- **A `refused` line in the logs needs a person.** `stripe webhook: ...
  refused: <reason>` means Stripe holds a subscription BIS did not store, so
  Stripe may be CHARGING a client BIS does not bill (or bills on another
  subscription). Open that subscription in Stripe the same day: if it is a
  mistake (hand-made, or a second payment), cancel and refund it there; if
  it is legitimate, fix the account (for example the customer, rule 1) and
  re-send the event from the dashboard.

## Failed payments (set in the Stripe dashboard, LIVE)

Decided by danlo, 2026-09-25:

- Retries: Smart Retries, Stripe's default schedule.
- After the last retry: mark the subscription unpaid. Never auto-cancel:
  cancelling is a person's decision.
- Stripe's customer emails: receipts on, failed-payment notices on.

## Rules for changing billing by hand

1. **An account's Stripe customer never changes** once `account_billing`
   holds one. The webhook refuses a subscription on any other customer
   (`customer_changed`). If one MUST change (say, the customer was deleted in
   Stripe), settle first:
   - the usage reporter must have sent every usage row of the account (none
     unstamped), because anything reported after the change is billed to the
     new customer;
   - rows Stripe already holds under the old customer stay there, including
     those stamped as duplicates.

   Then change `account_billing.stripe_customer_id` by SQL. Before deleting
   the account's `billing_links` row, EXPIRE its Checkout session if it is
   still open (Stripe dashboard, or `checkout.sessions.expire`): a deleted
   row with a live session leaves a payable link nobody can see. Then delete
   the row and send a new billing link.
2. **A usage row unreported for more than 24 hours** may be counted twice if
   it is resent: Stripe dedupes a meter event's identifier only for at least
   24 hours. While the Work page's stale-usage banner shows, check the
   affected client's upcoming Stripe invoice by hand before it finalises,
   until the nightly reconciliation (M7a PR-4) exists.
3. **Never point a TEST-mode endpoint at production.** The key-mode check
   answers 400 to every test event there.
```

```bash
git add docs/runbooks/stripe-billing.md
git commit -m "docs(runbook): Stripe billing live operations — webhook, failed payments, manual-change rules"
```

- [ ] **Step 9: Handoff (implementers stop at Step 4)**

The PR body lists:
- the spec gaps G1-G24;
- the assumptions B1-B11, with B1/B3/B9 marked proven by `billing.spec.ts` and the job log cited, B5 marked "engineered around (compare-and-set mirror; the row is guaranteed, the permissions write is not)", B4 marked "decided on unverified (DECISION 2, danlo accepted the risk)", and B10/B11 marked as decided (DECISIONS 6 and 7);
- the eight DECISIONS (danlo, 2026-09-25), as a list;
- **"one migration, 0052, additive, applied to bis-ci (run id) and production (before merge)"**;
- the Stripe live setup steps (Step 5, the failed-payment settings included) as a checklist for danlo, and the runbook (Step 8);
- the prerequisite (Step 6);
- in its own paragraph: **permissions are written but not yet enforced (G9); PR-4 adds the gate with the pause.**

Orchestrator: ledger lines for Checkpoint A, the production apply, parity, and the Step 5 settings as set.

---

## Self-review (done while writing; recorded for the reviewer)

**Spec coverage (step 3 only)**
- **Flow 2** (Tasks 3, 7, 8, 9). The Billing card → Send billing link → the Stripe customer (reused or created) → a subscription Checkout with the plan's four prices → the link emailed. "`checkout.session.completed` → `account_billing` stored, plan features written to `accounts.permissions`" is the mirror (Tasks 2, 4).
- **Flow 4** (Tasks 2-5). `POST /api/webhooks/stripe`, signature verified on the raw body, `event_id` recorded once, the subscription re-read from Stripe and mirrored. All six event types are handled (`HANDLED_WEBHOOK_EVENTS`, `subscriptionIdOf`).
- **Section 5.**
  - The Billing card: plan, a dot+word status (Active / Payment failed / Paused / Unbilled, plus Canceled / Complimentary / Link sent, G13), usage against allowances, primary Send billing link, ghost Change plan and Mark complimentary. Lift pause is deferred to PR-4, G14. (Task 9.)
  - The client page: plan, "312 of 500 minutes", next invoice, Manage billing → portal. (Task 10.)
  - The payment-failed banner. The paused banner is PR-4's. (Task 11.)
- **Section 4, permissions.** Only the agency marks complimentary, assigns plans or sends links (`requireAgency` first in every action). A client sees only its own billing (RLS on the page's reads; `requireAccountAccess` on the portal action) and opens the portal.
- **Section 6.** Unit tests of the webhook handler use signed fixtures (the SDK's own `generateTestHeaderString`), with duplicate and out-of-order events (Tasks 3-5). The e2e: the agency sends a link, a simulated signed webhook activates the subscription, the client page shows plan and usage, and Stripe's hosted Checkout is not driven (Task 12).
- **Not here, by design:** the pause and its banner, the agency non-payment alert, Lift pause, nightly reconciliation, the permissions READER (PR-4, G9), and usage-after-cancel (PR-4, binding 8).

**Bindings from PR-1/PR-2, each with where it is honoured**
1. A11 is a merge prerequisite (Prerequisites 1, Task 13 Step 6).
2. The `account_billing` row is created when the subscription exists (G1; the only writers are the mirror and Mark complimentary). Its reporting floor moved to `billing_started_at`, for the two cases `created_at` got wrong.
3. Usage screens read `usage_events` through `sumUsageSince`, with the chats note (G12).
4. `countBilledAccountsByPlan` pages (Task 2).
5. The composite FK is decided: deferred, with the writers checked (G10) and the reason (the shared CI project) in the migration header.
6. Every writer sets `updated_at` (`decideMirror`, `saveBillingLink`, `markBillingLinkExpired`, the complimentary writers). `markWebhookEventProcessed` stamps `processed_at`; the table has no `updated_at`. On `account_billing`, `updated_at` is also the mirror's compare-and-set version (B5), so every writer must MOVE it forward. The mirror writes strictly past the stored value (`nextVersion`). `markComplimentary`, `changeComplimentaryPlan` and `unmarkComplimentary` (a delete) write `now` or remove the row, which collides with a stored value only when two writes to one row share a millisecond (accepted). PR-4's pause writer must use `nextVersion` (Next plans (b)).
7. Idempotency:
   - Every key is `idempotencyKey(prefix, id, params)` over the full params: customer, checkout (plus the previous session), subscription change (plus the request id), portal configuration.
   - Money is integer cents throughout.
   - `stripeKeyVerdict` guards every Stripe path through `billingGatewayFromEnv`; the webhook adds the `livemode` check.
8. Usage after cancel is left to PR-4 (G23).
9. DB tests run in CI only, and the migration path is CI project → production → parity (Checkpoint A, Task 13 Step 2). House rules: RLS on, revoke-all, no grant, ASCII only, no backslash (checked by grep in Task 1 Step 3).

**Placeholders:** none. Every code step carries its code. Nothing waits on danlo: all eight questions were decided on 2026-09-25 ("go with your recommendations"), and the plan ships those decisions (see DECISIONS). The code that carries them: `updateSubscriptionPrices` (DECISION 2, proration now), `portalConfigurationParams` (DECISION 3), `BIS_BRANDING` in `billing-link.ts` (DECISION 1), the client nav item (DECISION 4), `checkoutSessionParams` without a trial (DECISION 5); DECISIONS 6 and 7 are Task 13's live setup, with no code.

**Type consistency**
- `SubscriptionSnapshot`/`SubscriptionItemSnapshot` are defined once, in `@bis/db`. They are built by `subscriptionSnapshot` (Task 3) and consumed by `decideMirror`, `mirrorSubscription` (through its `read: () => Promise<SubscriptionSnapshot>`, never a finished snapshot), `planChangeItems`, the fake and `processStripeEvent`. Both callers of the mirror, the webhook and the paid Change plan, hand it `() => gateway.retrieveSubscription(id)`.
- `AccountBilling` and `BillingLink` are used unchanged by `billing-view`, `billing-link`, the actions, the section and the page.
- `VerifiedWebhookEvent` is the only shape the route and `processStripeEvent` share, so no module outside `stripe-gateway.ts` imports the SDK's `Event`.
- `BillingActionResult` is one type for all four actions and the card.
- `billingGatewayFromEnv`'s success value gained `live`. The existing callers (the Plans page, the usage report) read `.gateway` only.

**Counts, re-derived from the code blocks**

| File | Tests |
|---|---|
| `billing-checkout-schema` | 11 (grants 6, shape 3, account_billing 1, live cascade 1) |
| `account-billing` unit | 17 (decide 3 + past-due 1 + refusals 4 + writes 3 + first-checkout burst 3 + complimentary 1 + claim/save 2) |
| `account-billing` live | 4 |
| `billing` unit | 1 |
| `usage` | +1 |
| `stripe-gateway` | +8 (checkout 2, key 1, snapshot 2, surface 3) |
| `stripe-webhook` | 3 (verify: accept, reject ×4 in one test, type mapping) |
| `webhook` | 7 |
| `route` | 6 |
| `ci-workflow` | +1 |
| `billing-view` | 9 (status 3, usage 3, view 3) |
| email | 3 |
| `billing-link` | 9 |
| `change-plan` | 2 |
| `portal` | 3 |
| `billing-actions` | 8 |
| `billing-card` | 5 |
| `billing-section` | 3 |
| `registry` | +1 |
| client `page` | 4 |
| client `actions` | 3 |
| `nav-groups` | +1 |
| `banner` | 3 |
| `layout` | 2 |
| `billing-done` | 2 |
| e2e | 2 |

**Total 119** (db 15 live + 19 unit, web 83, e2e 2). Files: 40 created, 22 modified. Tasks: 13, plus Checkpoint A.

**Existing tests this plan must not break (each named in its task)**
- The whole db suite's `account_billing` fixtures. 0052 is additive, and `billing_started_at` has a default, so none changes except the one that must: `usage.test`'s `bill()`.
- `stripe-gateway.test.ts` and every `FakeGateway` user. The interface grows; `tsc` finds any hand-built double (Task 3 Step 5).
- `ci-workflow.test.ts`'s secrets allowlist (a literal is not a secret reference).
- `nav-groups.test.ts`'s exact agency lists (Billing is client-only, so the agency lists are unchanged).
- The palette's nav-parity test (it derives the new entry).
- `messages.test.ts`'s milestone guard (no new string names one).
- `fixture-names.test.ts` (`E2E Plan <13 digits>` is swept).
- The Settings page test, if any asserts its exact children (Task 9 Step 6).
- Any e2e spec that lists the client's nav (Task 12 Step 3).

**Not verified here (CI, the e2e job, or the reviewer settles them)**
- B1, B3 and B9 (the e2e proves them).
- B4 (proration semantics). DECISION 2 was taken on it unverified; danlo accepted the risk, and it is settled on a Stripe test clock before the first live mid-month Change plan (Next plans).
- B10 and B11 (Stripe's 24-hour identifier window and its failed-payment settings; DECISIONS 6 and 7 act on them).
- That `.eq("updated_at", existing.updatedAt)` matches PostgREST's own timestamp text exactly, which the compare-and-set mirror depends on (B5). Task 2's live replay test proves it: a filter that never matched would throw after `MIRROR_ATTEMPTS`.
- That PostgREST's `upsert(..., { onConflict: "event_id", ignoreDuplicates: true }).select()` returns `[]` for a stored event (the PR-2 A15 idiom, proven again by Task 2's live claim test).
- That Radix `Select` with `name` posts its value in a plain `FormData` (the Plans dialog's precedent uses Checkbox/Input; the e2e's first test is the proof).

**Correction round 1 (2026-09-25): the opus plan review of 0a8fff9 said EXECUTE AFTER CORRECTIONS.** Each finding was checked against this plan and the repo before it was applied. None was rejected.
1. B5 was not a millisecond window: a stale state could stick for a billing period. Fixed by the compare-and-set mirror (B5, G4 point 8, G5, Task 2). `mirrorSubscription` now takes a READER and reads the row before Stripe. Its callers changed (Task 4's webhook, Task 8's paid Change plan). New tests: the B5 compare-and-set unit test, and the same-millisecond version bump folded into the billing-start test. Separately, the banner no longer shows for `incomplete` (`showsPaymentFailedBanner`, G21, the layout test).
2. The customer invariant is enforced, not implied. `decideMirror` refuses `customer_changed` (G3, G7, new unit test). `billing-link.test.ts`'s reuse test now pins that the stored customer beats a link that names another. The manual-change settle-first rule is in G3 and the runbook (Task 13, Step 8).
3. The >24 h resend risk is carried: Prerequisites 1, assumption B10, QUESTION 6 (now DECISION 6), Next plans (g), and runbook rule 2.
4. `getCheckoutSessionStatus` widens `s.status` to `string | null` before narrowing. The External-facts claim is corrected. Task 3 no longer adds a second `Stripe` import to the gateway test file.
5. The three verification tests moved to a new `stripe-webhook.test.ts`, which does not mock `stripe`. `stripe-gateway.test.ts` is +8.
6. The layout test's `beforeEach` has a block body.
7. The "requireAgency FIRST" test also checks `getBillingLink` and `getBranding`.
8. A new `billing-link.test.ts` case pins the checkout key's `previous`: a deliberate resend gets a NEW, OPEN session.
9. The failed-payment settings are Task 13, Step 5, item 6, parameterised on QUESTION 7 (B11); since decided, DECISION 7.

Minors applied:
- the retry comments (G4 point 4, the route's doc comment);
- the sweep's stale comment (Task 12, Step 4);
- `relrowsecurity` in the parity SQL;
- the Checkpoint A shared-project probe hazard;
- `includedLine` leaves a zero allowance out (never "0 minutes of calls");
- `/billing-done` no longer says "active" before the webhook confirms it;
- Change plan is not offered, or accepted, on `incomplete`.

The rest are listed under "Deferred to whole-branch review".

Verification, in a scratch copy OUTSIDE the worktree (`git archive 0a8fff9`, every changed code block assembled from this edited plan by marker, `node_modules` junctioned from the main checkout, no install anywhere):
- `tsc --noEmit`: exit 0 for `packages/db` and for `apps/web`. The web run covers every Task 3-12 block, `e2e/billing.spec.ts` included.
- eslint on every new or changed web file: exit 0.
- vitest, db unit: `account-billing` 14 passed, and the three db unit files 31 passed.
- vitest, web: 23 files and 213 tests passed, `messages.test.ts` included. Per file: `stripe-gateway` 64 (56 + 8), `stripe-webhook` 3, `webhook` 7, `route` 6, `billing-view` 9, `billing-link` 9, email 3, `change-plan` 2, `portal` 3, `billing-actions` 8, `billing-card` 5, `billing-section` 3, client `page` 4, client `actions` 3, `banner` 3, `layout` 2, `billing-done` 2.
- 14 mutation probes, each turning its own named test red and nothing else:
  - the mirror's update without the `updated_at` filter;
  - reading the row after Stripe;
  - an upsert where there is no row;
  - accepting the link's customer;
  - `updated_at = now` unconditionally;
  - the checkout key without `previous`;
  - Send preferring the link's customer;
  - `requireAgency` below `getBillingLink`;
  - the banner on `incomplete`;
  - `includedLine` listing a zero meter;
  - Change plan offered on `incomplete`;
  - `/billing-done` saying "active";
  - the webhook's reader skipping Stripe (3 tests red);
  - Change plan mirroring the pre-change snapshot.

The live db tests (15) and the e2e (2) still run only in CI.

**Correction round 2 (2026-09-25): the opus re-review of 21aecb3 said FIX FIRST.** It confirmed round 1's nine findings closed. Each new item was checked against the plan, and against the reviewer's probe (`rv-probe.test.ts`), before it was applied. None was rejected.
1. **A refusal could still leave a stale state.** `writeMirror` reads the billing link AFTER the Stripe read. On a first checkout, a concurrent delivery can insert the row and consume the link in between, so this attempt refused `customer_mismatch` over an `incomplete` row. The reviewer's probe confirmed it on 21aecb3 (`expected 'incomplete' to be 'active'`). Fix: a refusal re-reads the row, and if its `updated_at` differs from the one read before Stripe (a row that appeared or went included), it is a conflict and the mirror retries. The B5 and G5 claims now say so. New test: the refusal-on-a-moved-row case, shaped like the probe. The reviewer's probe itself passes against the fixed code.
2. **Untested give-up and insert paths.** Two new tests:
   - an insert that hits 23505 makes the next attempt update the other delivery's row, on that row's version;
   - a row whose updates never match makes the mirror THROW `/kept changing/` after exactly 3 row reads.
3. **B5, G5, the mirror's doc comment and the Global Constraints now say what is guaranteed.** It is the ROW. The permissions write is outside the compare-and-set: rare, and harmless in PR-3. Next plans (b) carries the fix to PR-4 (derive permissions from `plan_id`, or one RPC under the version check). It also carries the rule that every `account_billing` writer moves `updated_at` forward (Global Constraints, Bindings item 6).
4. **All eight questions are DECISIONS (danlo, 2026-09-25, "go with your recommendations").**
   - The questions section became DECISIONS, with each chosen option marked.
   - Every "pending QUESTION n" is now "decided", and the code comments that cited a QUESTION now say decided.
   - Task 13 Step 5 item 6 states the decided failed-payment values, and Step 9 lists the decisions.
   - Next plans item 3 is replaced by settling B4 on a Stripe test clock before the first live mid-month Change plan. DECISION 2 rests on the unverified B4, and danlo accepted that risk (B4, DECISION 2, "Not verified here").
5. **Runbook (Task 13 Step 8).** Three additions:
   - a `refused` log line means Stripe may be charging a client BIS does not bill: act on it the same day;
   - rule 1 expires any open Checkout session before a `billing_links` row is deleted;
   - the first checkout's burst may answer one or two 500s that succeed on Stripe's retry, and that is normal.

Verification, in a fresh scratch copy OUTSIDE the worktree (`git archive` of 21aecb3, blocks assembled from this edited plan, `node_modules` junctioned from the main checkout, no install; junctions removed after):
- `tsc --noEmit`: exit 0 for `packages/db` and for `apps/web`.
- eslint on the web files: exit 0.
- db unit: `account-billing` 17 passed, and 34 passed across the three db unit files.
- web: 23 files and 213 tests passed (unchanged by this round).
- Mutation probes, each red on the named test:
  - refusal returned without re-reading the row → the refusal test;
  - 23505 thrown (e) → the 23505 test;
  - 23505 reported as written (e2) → the 23505 test;
  - a refusal after the attempts run out (f) → the give-up test;
  - `MIRROR_ATTEMPTS = 100` (g) → the give-up test;
  - the update without its version filter → the B5 test and the 23505 test;
  - the row read after Stripe → the B5 test and the 23505 test;
  - a 0-row update not detected → the B5 test and the give-up test;
  - `nextVersion` without the +1 → the billing-start test;
  - `customer_changed` dropped → the customer test.

## Deferred to whole-branch review

Minor findings from the plan review of 0a8fff9, not applied in the correction round. The whole-branch reviewer decides each one:
- `maxDuration = 30` against the SDK's 2 retries × 20 s per call. The mirror now makes up to 1 + `MIRROR_ATTEMPTS` Stripe reads. Everything is idempotent, so a timeout is safe, but it can cut a mirror between its writes; the retry heals it.
- The portal action (`billing/actions.ts`) and most Billing-card section reads go through `serviceDb()`. The house rule is `dbForRequest()` wherever RLS allows it; `billing_links` genuinely needs the service role.
- `sumUsageSince` pages by offset over a table that is being written, one round trip per 1,000 rows per page view. Consider a per-meter `SUM` SQL function (it would have to ride in 0052, before Checkpoint A).
- The complimentary writes are not atomic. A `permissions` write that fails after the row write never heals, which matters once PR-4 reads permissions.
- If the mirror REFUSES a completed checkout, `checkout_finished` blocks Send for that account permanently (`billing-link.ts`).
- `monthStartInZone` is tested only for Chicago. Add a zone whose DST change falls at midnight, or document the limit.
- Nothing refuses the public CI webhook literal when a LIVE key is present.
- The A11 prerequisite check (Task 13 Step 6) greps commit titles. Check by PR number or commit instead.
- Stripe and SMTP error messages are logged whole and may contain the recipient's email (`billing-link.ts`).
- The loading skeleton (`BillingCardSkeleton`) lacks `id="billing"`, so a ⌘K jump during streaming lands nowhere.
- The Plans page's "N clients" now counts canceled rows too.
- Weak tests: the webhook "out of order" test repeats the first test's shape, since the real ordering guard is now Task 2's compare-and-set test. `saveBillingLink`'s insert race (23505 → false) is untested.

## DECISIONS (danlo, 2026-09-25)

These were the plan's eight questions. On 2026-09-25 danlo answered "go with your recommendations" to all eight, so each recommendation below is now a DECISION and the plan ships it. Each item keeps its original text; the chosen option is marked **CHOSEN**, and every alternative was not chosen.

1. **Who does the billing-link email come from?** Recommended, **CHOSEN**: **from BIS, in BIS's look** (it is BIS billing the business; the weekly agency report is the precedent). Alternative (not chosen): in the client's own logo and colour. (Task 7, one constant.)
2. **Change plan in the middle of a month: now or next billing date?** Recommended, **CHOSEN**: **now, with Stripe's proration** (the base price is credited or charged on the next invoice, and the whole month's usage counts against the new plan's allowances). **This recommendation rests on assumption B4, which is UNVERIFIED:** it is how Stripe is expected to price a meter after an in-place price swap. Nothing in PR-3 proves it, and if B4 is wrong, the money outcome of "now" differs from the one described. **danlo accepted that risk** when deciding; B4 is settled on a Stripe test clock before the first live mid-month Change plan (Next plans). Alternative (not chosen): switch on the next billing date (needs Stripe subscription schedules, a follow-up; until then Change plan is complimentary-only). (Task 3's `updateSubscriptionPrices`, Task 8.)
3. **What may a client do on Stripe's billing page?** Recommended, **CHOSEN**: **update their card and see or download invoices only**. No self-cancel and no self plan-switch; those go through you. Alternative (not chosen): allow self-cancel at period end. (Task 3's `portalConfigurationParams`, one flag.)
4. **Before a client is billed, do they see "Billing" in their menu?** Recommended, **CHOSEN**: **yes**, with "Billing isn't set up yet. When your plan starts, your usage and next invoice show here." Alternative (not chosen): hide it until they are on a plan. (Task 10, the nav item reads billing state.)
5. **Free trials?** Recommended, **CHOSEN**: **none**: the first month is charged at checkout. Alternative (not chosen): an N-day trial on every plan. (Task 3's `checkoutSessionParams` gains `subscription_data.trial_period_days`.)
6. **Bill a live client before PR-4's nightly reconciliation exists?** Recommended, **CHOSEN**: **yes** (the only double-count path is a usage row left unstamped for more than 24 hours and then resent (B10), and PR-2's stale-usage banner already flags any row unreported for 24 hours; if it ever shows before PR-4 lands, you check that client's Stripe invoice by hand before it finalises). Alternative (not chosen): hold the first live client until PR-4 merges. (No code: Task 13's live setup and the first live billing link wait, or not.)
7. **What should Stripe do when a client's card keeps failing?** Recommended, **CHOSEN**: **Stripe's Smart Retries, then MARK THE SUBSCRIPTION UNPAID, never auto-cancel; Stripe's receipts and failed-payment emails to the client ON** (cancelling stays your call, and BIS's own 7-day soft pause in PR-4 handles access). Smart Retries' schedule is Stripe's own default, an external assumption (B11), not re-read. Alternative (not chosen): cancel after the last retry, or leave it past due; emails off. (Task 13 Step 5 item 6: dashboard settings only, no code.)
8. **May a canceled client later be made complimentary?** Recommended, **CHOSEN**: **no, not in PR-3; G16 stays** (a canceled client comes back through a new billing link, and a complimentary row over a canceled subscription is a new state nothing needs yet; revisit if a real case appears). Alternative (not chosen): allow it (a row rewrite that drops the old subscription, in a follow-up plan). (Task 6's `billingCardView` and Task 8's `markComplimentaryAction`.)

## Next plans

1. **PR-4: the non-payment pause and nightly reconciliation.** Binding from this plan:
   - (a) `past_due_since` is already stamped by the mirror (G8), and the pause reads it.
   - (b) The permissions READER ships here with the voice route's three-way choice (G9): a plan without the receptionist, and a paused account, are one decision in one place. **Before it reads `accounts.permissions`, close the gap B5 leaves:** the mirror guarantees the `account_billing` ROW, but its permissions write is outside the compare-and-set, so racing deliveries can leave permissions from the older one. Either derive permissions from `account_billing.plan_id` at read time (no second copy to drift), or write the row and the permissions in ONE RPC under the same version check. And the rule every `account_billing` writer follows (Global Constraints): it moves `updated_at` strictly forward; the pause writer uses `nextVersion`, like the mirror.
   - (c) Lift pause goes on the Billing card, and the paused banner in the account layout beside the payment-failed one (G14, G21).
   - (d) B5 is closed IN PR-3 (the compare-and-set mirror, G5), so the pause may trust the stored status. A nightly re-mirror of every subscription is NEW scope: the spec's reconciliation compares meter totals only. Add it only as the backstop for a MISSED webhook, and say so in PR-4's plan.
   - (e) Decide whether usage after cancellation reaches Stripe (binding 8, G23).
   - (f) The agency's non-payment alert (spec flow 5): a derived work-queue banner, `LineDownBanner` pattern.
   - (g) **The >24 h resend rule (B10; DECISION 6 bills live clients before PR-4).** Stripe dedupes a meter event's identifier only for at least 24 hours. So a usage row still unstamped more than 24 hours after a send Stripe may have ACCEPTED must not be blindly resent. Reconciliation compares Stripe's meter totals with `usage_events` per account and billing period, and reports any gap BEFORE the invoice finalises. The reporter holds such a row for that comparison instead of resending it. Until PR-4 lands, the runbook's rule 2 (a manual invoice check while the stale-usage banner shows) stands in for it.
   - (h) The failed-payment settings (DECISION 7, Task 13 Step 5) decide which statuses the pause sees: after the last retry Stripe marks the subscription `unpaid`, never auto-`canceled`.
2. **M7 #3 (multi-agency):** the composite FK `account_billing (plan_id, agency_id)` with 0050's pattern (G10). The writers' agency checks stay as defence in depth.
3. **Settle B4 before the first live mid-month Change plan** (DECISION 2 was taken on it unverified, and danlo accepted the risk). On a Stripe TEST clock: a subscription on plan A with metered usage, an in-place price swap to plan B mid-period (`updateSubscriptionPrices`), then advance the clock past the period end and read the invoice. If the meters are not priced as B4 says, write a small follow-up plan (Stripe subscription schedules, or a switch at the next billing date) before any live Change plan.
