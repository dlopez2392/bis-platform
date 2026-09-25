# M7a PR-2: Usage Recording + Stripe Meter Reporting Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship rollout step (2) of M7a client billing: one `usage_events` row per billable fact, written where the fact already happens (a call Sofía talked to ends → its minutes; a text reaches a customer → its segments; Sofía's FIRST reply in a website chat succeeds → 1), for EVERY account; a cron pass that sends unreported rows of billed accounts to Stripe Billing Meters with the row id as the identifier; and a derived agency banner when a billed client's usage has not reached Stripe for over a day.

**Architecture:** `packages/db/src/usage.ts` is the only code that touches `usage_events`: an insert-once `recordUsage` (ON CONFLICT (meter, source_ref) DO NOTHING) plus the reads the reporter and the banner share, each ONE read per 50 billed accounts (never one per account). In `apps/web`, every send path records through ONE wrapper, `recordUsageSafely` (`lib/billing/usage.ts`), which never throws, placed after the path's own durable write, so a ledger failure can never change a call, a text or a chat. The reporter is a new cron pass (`usageReport`, last in `PASSES`) that sends the OLDEST unreported rows first across every billed account, talks to Stripe through a new `BillingGateway.reportMeterEvent` (v1 `billing.meterEvents.create`, no SDK retry, a 10 s timeout), stamps `reported_at` only after Stripe accepts, and classifies a failure as that account's problem (its other rows wait for the next tick; everyone else's still go) or the tick's (stop). The banner copies `LineDownBanner` exactly: computed each render on the agency work queue, nothing stored, nothing at zero. **No migration.**

**Tech Stack:** Next.js 16.3.6 (App Router, server actions, route handlers), Supabase Postgres 17 (RLS), `@supabase/supabase-js`, vitest 4, Playwright, `stripe@22.6.2` (API version `2026-08-26.dahlia`), Tailwind 4 with the repo's tokens.

**Spec:** `docs/superpowers/specs/2026-09-24-m7a-client-billing-design.md`. This plan covers rollout step (2) only: section 3 flow 3 (usage recording and the reporting pass) and section 4's "usage reporting failure" bullet. NOT in this PR: nightly reconciliation and the pause (PR-4); Checkout, webhooks, the Billing card and the client Billing page (PR-3).

## Global Constraints

- Tier: **HIGH** (money, and three customer-facing send paths: voice, SMS, concierge). Every new assertion names the mutation that turns it red, in the test title. The reviewer applies those probes.
- **A usage leg never breaks or slows the primary flow.** Every leg goes through `recordUsageSafely`, which catches everything, and sits AFTER the path's own durable write. Each call site has a test proving a throwing `recordUsage` leaves the call/send/conversation result unchanged (mutation: remove `recordUsageSafely`'s catch → that test FAILS; the concierge leg also wraps its lazy import in its own `try`, so its test names both). Nothing in working out a quantity may sit where a throw could mark a delivered text failed or skip its dedupe stamp (Task 4).
- Recording never checks billing status: the ledger fills for every account (spec section 4, rollout (2)). Only the reporter looks at `account_billing`.
- No floats on the money path: every quantity is a positive whole number, checked in `recordUsage` before the database (0051's CHECK is the backstop) and again in `meterEventParams` before Stripe.
- `usage_events` is written ONLY through `serviceDb()` (0051 grants `authenticated` SELECT only). Writers set `updated_at` themselves (0051 has no trigger).
- Stripe: every idempotency key covers every parameter the request sends (PR-1 correction). Meter payload keys are exactly `stripe_customer_id` and `value`, values are STRINGS. Event names are the permanent `bis_voice_minutes`, `bis_sms_segments`, `bis_ai_chats` (`METERS`, PR-1 G9).
- The app refuses a Stripe TEST key whenever `NEXT_PUBLIC_SUPABASE_URL` names production (`stripeKeyVerdict`). The reporter uses `billingGatewayFromEnv()` and nothing else to reach Stripe.
- **DB tests (`packages/db`) run only in CI**: the db suite's global setup refuses to start while the local env names production (`packages/db/src/test/refuse-production.ts`). Web unit tests run locally.
- **Implementers never apply migrations.** This plan has none; if a task comes to need one, STOP and report (a migration is HIGH ceremony: CI project first through `ci-project-setup.yml`, then production through MCP, then parity).
- Copy lives in `apps/web/src/lib/messages.ts`, in plain language, with no milestone codes. Copy assertions go through `renderedText` (`lib/rendered-text.ts`): React escapes `'` in static markup.
- UI follows DESIGN.md: tokens only (the banner is a `Notice`), dark and light through `.dark`, status never colour alone (the sentence is the marker), the new component added to `/dashboard/styleguide`.
- The e2e suite never touches `Test Client One`. The Stripe e2e test skips loudly without a key (`test.skip` with the reason plus a `::warning` line), and runs only on a `sk_test_`/`rk_test_` key.
- Gates before merge: `pnpm check`, `pnpm --filter web build`, `pnpm --filter web test:e2e`. CI runs them (`verify`, `e2e`); read the check runs FOR THE HEAD SHA.

## Prerequisites

1. `CI_STRIPE_SECRET_KEY` (a Stripe TEST secret key) exists as a repository secret (danlo added it during PR-1; ledger line "danlo added CI_STRIPE_SECRET_KEY"). The e2e job exposes it as `STRIPE_SECRET_KEY` (`.github/workflows/ci.yml:206`). Nothing to add.
2. No migration, no new environment variable, no new secret.
3. **In production this PR reports NOTHING to Stripe until PR-3.** The reporter sends only rows of accounts with an `account_billing` row carrying a Stripe customer and subscription, and PR-3 creates the first such row. From the moment this deploys, production's ledger fills for every account (rows the reporter will never send, because they occurred before billing began), and each cron tick's `usageReport` counters read all zeros. The reporter is proven in CI (unit tests with `FakeGateway`, DB tests with fixture `account_billing` rows) and against Stripe test mode (Task 10).

## External facts: verified vs assumed

Verified on 2026-09-25:
- Installed `stripe` is **22.6.2** (`apps/web/node_modules/stripe/VERSION`). A scratch file typechecked with `tsc --noEmit --strict` (exit 0) against it: `stripe.billing.meterEvents.create(p: Stripe.Billing.MeterEventCreateParams, { idempotencyKey })`, the returned `.identifier`, `stripe.customers.create({ name, metadata })`, `stripe.customers.del(id)`, and `new Stripe.errors.StripeInvalidRequestError({ message, type })`.
- `MeterEvents.d.ts`: `payload: { [key: string]: string }`; `identifier` optional, "Stripe enforces uniqueness within a rolling period of at least 24 hours"; `timestamp` in SECONDS, "within the past 35 calendar days or up to 5 minutes in the future".
- At runtime (node, the installed package), each Stripe error class carries a `.type` string equal to its class name: `StripeInvalidRequestError`, `StripeIdempotencyError`, `StripeRateLimitError`, `StripeAuthenticationError`, `StripePermissionError`, `StripeConnectionError`, `StripeAPIError` (`cjs/Error.js`: `this.type = type || this.constructor.name`, each subclass passes its literal).
- Stripe docs, "Record usage for billing with the API" (docs.stripe.com/billing/subscriptions/usage-based/recording-usage-api, fetched 2026-09-25): meter events are processed ASYNCHRONOUSLY; errors (`meter_event_customer_not_found`, `timestamp_too_far_in_past`, `timestamp_in_future`, `archived_meter`, `meter_event_invalid_value`, ...) arrive later as `v1.billing.meter.error_report_triggered` thin events, not as an error on the create call. Live mode: a separate limit of 1000 meter-event calls per second, plus **one concurrent call per customer per meter**. Sandbox: meter-event calls count toward the account's global rate limit.
- `.github/workflows/ci.yml` gives the `e2e` job `STRIPE_SECRET_KEY` (line 206) and **no `CRON_SECRET`** (grep finds none in the file), so the cron route cannot be driven end to end in e2e; it answers 503 without the secret (`api/cron/reminders/route.ts:40-41`).
- The "Talk to Sofía" web demo writes no `calls` row: `startCallRow` and `finishCall` are called only from `api/voice/incoming/route.ts` (939, 291).
- `turn_count` is NOT "the caller spoke": `finish-call.ts:560` writes `turnCount: state.transcript.length`, and the transcript holds Sofía's own turns (`call-events.ts:97`, role `assistant`), so a silent ring that heard her greeting has `turn_count` 1. The code's real "caller spoke" signal is a `caller` turn with words: `call-state.ts:123` (the `abandoned` rule) and `proposals/eligibility.ts:58`. A robocall caught by the recording guard still leaves its words as a caller turn (`call-events.ts:132-134` and `:145-147`).
- A booked/lead/message call need not hold a transcribed caller turn: `classifyOutcome` returns those three from `bookings`/`leads`/`messages` BEFORE it looks at the transcript (`call-state.ts:106-108`), and `isMeaningful` (`finish-call.ts:134-138`) is exactly those three. Hence the voice gate `callerSpoke(state) || isMeaningful(outcome)` (G5).
- Installed stripe 22.6.2 (`cjs/resources/Billing/Meters.d.ts:33`): `stripe.billing.meters.listEventSummaries(id: string, params: Billing.MeterListEventSummariesParams, options?)`, params `customer: string`, `start_time: number` (inclusive), `end_time: number` (exclusive), both "aligned with minute boundaries" (`:216-236`); without `value_grouping_window` "a single event summary would be returned for the specified time range". `MeterEventSummary.aggregated_value: number` (`MeterEventSummaries.d.ts`).
- `RequestOptions` (`cjs/lib.d.ts`, the `interface RequestOptions` block) takes `idempotencyKey`, `maxNetworkRetries` and `timeout` (ms) PER REQUEST, and `RequestSender.js:236-240` / `:413-419` prefer the per-request values over the client's. `billingGatewayFromEnv` builds its client with `maxNetworkRetries: 2, timeout: 20_000` (`stripe-gateway.ts:192`); the SDK backs off 0.5 s then 0.5-1 s between retries (`stripe.core.js:101-102`, `RequestSender.js:221-233`), so one call there can take about 61.5 s at worst. `reportMeterEvent` therefore overrides both per request (Task 7).
- PostgREST `.or()` with double-quoted ISO instants is this repo's proven idiom (`packages/db/src/automations.ts:94-103`, `eitherAnchorSince`, proven live in `automations.test.ts`), and `.in("account_id", [...])` over every enabled account is the recipes' (`automations.ts:278` and five more).

Assumptions (not verified; Task 10's e2e run, reading Stripe's aggregate, is the proof for A9-A10 and the observation for A11; A16-A19 are labelled where they are used):
- A9. Stripe test mode accepts `billing.meterEvents.create` for an existing test customer on an active `bis_sms_segments` meter, with our payload shape.
- A10. Replaying the SAME request under the SAME idempotency key within 24 hours returns without error and records no second event. A 200 cannot show the second half (validation is asynchronous, A12), so Task 10 polls Stripe's own aggregate (`listEventSummaries`) and asserts the sum a correct dedupe implies.
- A11. The same `identifier` under a DIFFERENT idempotency key (the only way BIS sends one twice: its key expired after 24 hours, or the account's customer id changed) is accepted and deduplicated, accepted and COUNTED AGAIN, or refused with a `StripeInvalidRequestError`. **Unproven; the spec's "Stripe dedupes by identifier" (section 4) is relied on NOWHERE in this plan until Task 10 observes it.** `FakeGateway` therefore assumes the costlier answer (a second event, Task 7). Task 10 records which of the three (or "unproven", if the summary does not settle in time) as a test annotation, and ANY outcome other than "deduplicated as expected" blocks PR-3 from creating the first billed account (Task 11 handoff).
- A16. Stripe's meter event summaries reflect an accepted event within 120 seconds. Not documented as a bound; Task 10 polls every 5 s for up to 120 s per phase, fails when the sum is WRONG (more than a correct dedupe implies, or a value no outcome explains), and when it simply has not appeared, passes with a `::warning` and an "unproven" annotation (a PR-3 blocker, not a PR-2 one).
- A17. Stripe aggregates one customer's events on one meter in the order it accepted them, so once a sentinel event sent AFTER the A11 probe shows in the sum, the probe has been counted too (or deduplicated). Task 10 re-reads 30 s after the sentinel appears to narrow the gap; it cannot close it.
- A18. **Superseded twice (review corrections 2026-09-25; see Task 1's report, Fix 1, and Fix 2/A20 below).** The "about 100 characters per account" estimate was wrong at uuid length: a node measurement of `usageRangeFilter`'s OWN output, encoded as a query string, at maximum id/timestamp length (a uuid; a microsecond, `+00:00`-suffixed `occurred_at`), gives ~6,150 characters for 50 accounts on a two-part (`account_id.eq` + `occurred_at.gte`) filter — still under postgrest-js's 8,000-character warning, so `USAGE_ACCOUNTS_PER_READ = 50` stands for `staleUsageAccountIds` (the only remaining two-part caller after A20) — but ~9,350 characters for 50 accounts on the THREE-part filter `countExpiredUsage` builds (it also sets `beforeIso`), which is past that warning. `countExpiredUsage` therefore chunks by its own, smaller constant (~4,700 characters at 25, comfortably under a 6,000-character bound), unit-pinned in `usage.test.ts`. Today there are a handful of accounts and one read either way. Fix 1's own first version of this note named that smaller constant `USAGE_ACCOUNTS_PER_EXPIRED_READ`; A20 renamed it and gave it a second caller.
- A20. **Fix 2 (review correction, 2026-09-25).** Fix 1 added a `beforeIso` (the future-grace ceiling) to EVERY range `listReportableUsage` builds, making its filter three-part too, but left it chunking by the two-part `USAGE_ACCOUNTS_PER_READ` (50) — a mismatch A18's own doc comment already warned against. Measured with the real `usageRangeFilter` at 50 accounts, max-length uuid and `+00:00`-suffixed microsecond timestamp on both `fromIso` and `beforeIso`: encoded length 9,347 (all-`beforeIso`-equals-`fromIso` shape; the finding's own measurement using a realistic shorter `untilIso` was 8,747) — over the 6,000-character bound this file enforces and past postgrest-js's 8,000-character warning either way. Fixed by renaming `USAGE_ACCOUNTS_PER_EXPIRED_READ` to `USAGE_ACCOUNTS_PER_BOUNDED_READ` (it now has two callers: `countExpiredUsage` and `listReportableUsage`) and chunking `listReportableUsage` by it instead. `staleUsageAccountIds` was checked and is unaffected: its ranges never set `beforeIso`, so it stays two-part and correctly on `USAGE_ACCOUNTS_PER_READ`. Two new/changed unit tests in `usage.test.ts` capture the filter `listReportableUsage` itself sends (not just the constant's raw value) and assert it stays under 6,000 characters encoded.
- A19. A meter event round trip takes about 0.2-0.3 s (not measured), so 200 sequential sends take about 40-60 s. The code does not rely on it: the budget (G4) bounds the pass whatever a round trip costs. **Task 7's review** lowered the last-start point from 50 s to 39 s (the transport's real worst case, not the 10 s timeout alone — see G4), which at this same assumed round trip caps a single tick at roughly 130-195 sends rather than 200 (39 s ÷ 0.2-0.3 s); at 96 ticks a day that is still ~12,500-18,700 sends of daily headroom against the ~19,200-a-day estimate below. A tick that cannot fully drain a backlog loses nothing (the next tick picks up the same oldest rows), so this narrows headroom rather than breaking anything; today's real volume is far under either bound. Chose the lower last-start point over keeping 50 s and accepting a stated ~71 s worst-case pass, because that would exceed this pass's own stated 60 s budget by design and the plan preferred a truthful budget that holds over a truthful budget that is routinely allowed to overrun (option (a) over (b); the cron route's 300 s `maxDuration` would still absorb it, but the point of a per-pass budget is that its own callers can trust the number).
- A12. A 200 from `meterEvents.create` means Stripe RECEIVED the event, not that it will bill it (validation is asynchronous). `reported_at` therefore means "Stripe received it". PR-4's nightly reconciliation is the backstop for events Stripe later drops.
- A13. `StripeInvalidRequestError` and `StripeIdempotencyError` are about the one request; every other failure (auth, permission, rate limit, connection, 5xx) would repeat for every row this tick. **Known limitation (Task 7's review):** a deploy whose Stripe key is TEST while the account's customer id is a LIVE one (or vice versa) makes EVERY row of that account fail with `StripeInvalidRequestError` — a per-request problem by Stripe's own classification, not a systemic one — so `meterEventFailureKind` correctly calls it "row" and G4's fairness rule bounds it to one refused send per account per tick, but every tick is noisy (a `failed` count and a `console.error` that never resolves itself) until the key/customer mismatch is fixed by hand. Not a correctness bug; recorded here so the noise is not mistaken for a new one.
- A14. Events for a customer whose subscription is canceled are recorded by Stripe but invoiced by no subscription, so the reporter need not read `subscription_status`.
- A15. PostgREST's `upsert(..., { onConflict: "meter,source_ref", ignoreDuplicates: true }).select("id")` returns `[]` for a conflicting row (the same behaviour `crm-config.ts:80-86` relies on). Task 1's live test proves it.

## Spec gaps resolved here (the reviewer should confirm or overrule)

- **G1. The ledger fills for every account; recording is best-effort.** No send path looks at billing status. Each leg runs through `recordUsageSafely`, after the path's primary durable write, and can change nothing the path returns (the existing `recordAutomationLog`/`emit` legs are the pattern).
- **G2. Insert once.** `recordUsage(db, { accountId, meter, quantity, occurredAt, sourceRef })` is an insert with ON CONFLICT (meter, source_ref) DO NOTHING; it never updates a stored row, and says `"recorded"` or `"duplicate"`. It refuses, before any query, a quantity that is not a positive whole number, a `sourceRef` whose prefix does not match its meter (`call:<calls.id>` for `voice_minutes`, `message:<messages.id>` for `sms`, `conversation:<concierge_conversations.id>` for `ai_chats`), an empty id, more than 200 characters, and an invalid date.
- **G3. What the reporter sends.** A row is reportable when its account has an `account_billing` row with `stripe_customer_id` AND `stripe_subscription_id` set (a complimentary row has neither subscription nor pause, by 0051's `account_billing_complimentary_check`, so it is excluded by construction), the row is unreported, and its `occurred_at` is on or after `max(account_billing.created_at, now − 34 days)`. **34, not 35:** Stripe validates the timestamp asynchronously and DROPS a too-old event without an error, so a row sent near the 35-day edge could be stamped reported and never billed; one day of margin prevents that. Everything else stays in the ledger unreported, and is not an error. Rows of a billed account between its billing start and the 34-day floor are counted `expired` and logged every tick, never sent. **The banner does not count expired rows**: they can never be sent, so a banner about them could never clear, and every expired row has already spent about 33 days on the banner as stale. In production nothing is reported until PR-3 creates the first billed account.
- **G4. The reporter.** A new cron pass, key `usageReport`, appended LAST in `PASSES`: every SMS-sending pass runs before it, so a text sent this tick is reported this tick, and nothing reads what it writes. Stripe v1 `billing.meterEvents.create` through a new `BillingGateway.reportMeterEvent`. `identifier` = the row id (spec). Idempotency key `bis-usage-<row id>-<customer id>`: event name, value and timestamp are functions of the row, which never changes after insert (G2), so the row id plus the customer id covers every parameter. Timestamp = `floor(occurred_at / 1000)` seconds; payload values strings. `reported_at` and `updated_at` are stamped with the tick's `now` only after Stripe accepts; a stamp that finds the row already stamped (a concurrent tick) is `alreadyStamped`, never `reported`. **Fairness:** each read takes the OLDEST unreported rows across every billed account (`listReportableUsage`, one read per 50 accounts, merged oldest first), so no account waits behind another's place in a list and a backlog drains in the order it grew. One row's `StripeInvalidRequestError`/`StripeIdempotencyError` → that row `failed`, and that ACCOUNT's other rows wait for the next tick (a refusal is usually the account's, and its rows must not spend everyone's cap); when that read was full, the pass reads again without the refused accounts, so their rows can never fill the cap ahead of everyone else's. Any other failure → `failed`, `stoppedOnError: 1`, the tick stops (A13). Per tick: at most **200** sends (`USAGE_REPORT_TICK_CAP`; reaching it sets `stoppedOnCap: 1`) inside **60 s** (`USAGE_REPORT_BUDGET_MS`). Each send overrides the client's transport per request (`maxNetworkRetries: 0`, a 10 s `METER_EVENT_TIMEOUT_MS`; the next tick is the retry, under the same key) — but for the installed stripe 22.6.2, that does not mean "no retry, bounded at 10 s": `RequestSender.js`'s `_shouldRetry` retries a reset/broken-pipe connection ONCE regardless of `maxNetworkRetries`, and `timeout` is a socket-idle timeout, not a hard deadline (stripe-gateway.ts's comments carry the file:line evidence). Worst case for one send past its start: ~10 s idle + reset + ~0.5 s backoff + ~10 s idle ≈ 20.5 s. The pass stops STARTING sends at 60 − 21 = **39 s** (`METER_EVENT_WORST_CASE_MS`, rounded up from 20.5 s for margin), so even a send that hits that worst case still ends inside the 60 s budget (the client-wide 2 retries × 20 s would let one send run about 61.5 s past the last start, which the per-request override still prevents). That leaves the route's 300 s `maxDuration` room beside the release pass's own 60 s. 200 rows every 15 minutes is 19,200 a day, about 128 clients at an estimated 150 billable facts a day each (A19 for the time per send; sandbox traffic counts toward the global rate limit, so sequential sends are also the polite shape there). No usable key (`billingGatewayFromEnv` not ok) → `skippedNoStripe` = billed accounts, logged, returned, not an error. Stale accounts (G7) and expired rows (G3) are counted AFTER the send loop (so the bookkeeping never spends the send budget; on the no-Stripe path, before returning), and logged with `console.error` on every tick that sees them: the stale probe reads at most `STALE_PROBE_ROWS` (50) rows per stale account plus 50 per 50 billed accounts (G7), and the expired count is one head-only count per 25 accounts billed before the window's floor. (Review correction 2026-09-25: this line said "one read per 50 billed accounts each", which was never true of the stale read — it paged through every stale row — and the pass ran both before the budget's clock started.)
- **G5. The voice leg is gated on the call row id and "Sofía talked to the caller" = `callerSpoke(state) || isMeaningful(outcome)`, NOT on `stored` and NOT on `turn_count`.** danlo's decision is "every call Sofía talked to"; the planning-start ledger line paraphrases it as "caller spoke, turn_count>=1", and that paraphrase is superseded here (the orchestrator appends a ledger correction). `finishCallRow` failing (a database blip) does not un-spend the carrier and model minutes, and `recordAutomationLog`, the precedent leg, is gated on `meta.callRowId` alone (`finish-call.ts:579`). The call id is the `source_ref`; with no row id (`startCallRow` failed open) there is nothing to key idempotently, and nothing is recorded. The two halves: `callerSpoke(state)`, a caller turn with words, exported from `call-state.ts` and shared with `classifyOutcome` (`turn_count >= 1` would bill silent rings, because Sofía's greeting is a turn); and `isMeaningful(outcome)`, because a booked, lead or message outcome means the caller interacted even when no caller turn was transcribed (danlo, 2026-09-25). A silent ring or a connect-timeout (no caller words, no booking/lead/message) never bills. A robocall that reached Sofía is billed (danlo), and it is, because the guard records its words as a caller turn. Quantity = `max(1, ceil(duration_secs / 60))` from the SAME `durationSecs` written to the calls row; `occurred_at` = the call's end.
- **G6. The Stripe proof is at the gateway, in the e2e job, and it reads Stripe's AGGREGATE, not the 200.** The `verify` job has no Stripe key by design, and the `e2e` job has no `CRON_SECRET`, so the cron route cannot be driven end to end. `e2e/usage-meter.spec.ts` makes a Stripe TEST customer, ensures the meters, sends one meter event through the real `stripeGateway(...).reportMeterEvent`, replays it under the same key, sends a second distinct event, and polls `listEventSummaries` until the sum is the 2 + 3 = 5 a correct dedupe implies (A9, A10, A16). It then sends the first event's identifier under a new key (A11) and a sentinel (7) after it, and polls for 12 (deduplicated) or 14 (counted again) (A17). It deletes the customer. No database, no account, never Test Client One.
- **G7. The banner.** `listAccountsWithStaleUsage(db, now)` returns the ids of billed accounts with a reportable row (G3's window) still unreported 24 hours after it was RECORDED (`created_at`, not `occurred_at`: a row recorded late is not late to Stripe until it has waited a day). Bounded by ACCOUNTS, never by backlog: the billed-account list (paged), then per 50 of them (`staleUsageAccountIds`) a probe of at most `STALE_PROBE_ROWS` (50) rows over the accounts not yet found, each account's own window expressed in the read's `.or()`; every account a read names leaves the next read's filter, and the group ends on the first EMPTY read (never a merely short one: a server `max_rows` below 50 makes reads short while rows remain). So a group takes at most (its stale accounts + 1) reads, and a call reads at most 50 × (stale accounts + groups) rows however large the backlog grows while Stripe is down. With nothing stale it is one read per 50 accounts. (Review correction 2026-09-25: the shipped Task 1 paged through EVERY stale row, 1,000 at a time — unbounded while Stripe is down, and the pass ran it before its budget started.) The cron's stale log calls the same function. `/dashboard/work` renders `UsageStaleBanner` with the count, beside `LineDownBanner`, in the same `Promise.all`, swallowed the same way: a failed read renders no banner and logs `console.error` (`work/page.tsx:62-65`'s precedent). Copy: "Usage for 2 clients hasn't reached Stripe in over a day, so it isn't on their bills yet. We retry every 15 minutes." + a link "Check the Stripe connection" to `/dashboard/plans`, where a missing or refused key is already explained.
- **G8. No migration.** Every read names its accounts in one `.or(and(account_id.eq.<id>,occurred_at.gte."<from>"),...)` plus `.is("reported_at", null)`: each clause is an `(account_id, occurred_at)` range that `usage_events_account_occurred_idx (account_id, occurred_at desc)` can serve, and the planner can OR them (a BitmapOr; expected, not measured, and irrelevant at today's row counts). None uses `usage_events_unreported_idx (created_at) where reported_at is null`. That partial index WILL hold every unbilled account's rows forever (every account's usage is unreported until it is billed, and pre-billing rows stay unreported for good): at an estimated 200 rows a day across today's accounts, about 73,000 entries a year. Harmless in size, useless as a queue; dropping or replacing it belongs with PR-4's reconciliation, once that access pattern is known.
- **G9. A text bills only when it reached the CUSTOMER** (`smsBillable`): a real provider (`isFake === false`) with no `redirectTo`. The fake provider delivers nothing, and a real provider forced outside production sends every text to a developer's phone (`lib/sms/index.ts:35-36`). Production always holds the real, unredirected provider (`getSmsProvider` throws there without a key), so this changes nothing in production; it keeps a preview, which writes production's database, from leaving usage rows for texts no customer received. This refines the research note "key off a successful send, not the environment": it keys off the PROVIDER, not the environment.
- **G10. Automation texts are billed in `markAutomationSmsSent`,** after the caller's dedupe stamp and the status write, never between the send and the stamp (a ledger round trip there would widen the window in which a crash re-sends the text). `SentSms` gains `usage: { segments, sentAt } | null`, computed on the body AS SENT (the opt-out disclosure included). All seven callers call `markAutomationSmsSent` on their success path; a source-scan test in `send-sms.test.ts` keeps that true.
- **G11. The two direct sends (composer reply, missed-call text-back) write `sent` straight after the provider send, and record usage in that write's `finally`: `try { sent write } finally { usage }`.** (Review correction 2026-09-25: the first version recorded usage BETWEEN the send and the `sent` write, and that write is what stores `provider_message_id` — a Telnyx status webhook landing in that gap, up to recordUsageSafely's 5 s, found no row and was lost for good. The gap is back to milliseconds.) That write may throw (the composer propagates it; the text-back's outer catch logs it), and it must not take a delivered text's usage with it, which the `finally` guarantees; `recordUsageSafely` never throws, so it cannot replace that write's error either. The composer runs on the RLS client, so its usage write uses `serviceDb()`, passed as a getter so a missing service key is caught too (`automations/actions.ts:5`'s precedent for service-only tables after `requireAccountAccess`). One text-back leg covers both callers (`finishCall` and `/api/voice/texml/handoff-result`), because both deliver through `deliverTextback`.
- **G12. The reporting start is `account_billing.created_at` (binding on PR-3).** PR-3 must write the row when the subscription exists (`checkout.session.completed`), or move this floor to a dedicated column; a row created when the link is SENT would report usage from before the customer subscribed.
- **G13. A website chat bills when Sofía's FIRST reply succeeds, not when the conversation row is created** (danlo, 2026-09-25: a failed start, e.g. the model call's 503 during an OpenAI outage, never bills). "Succeeds" = on a TURN-1 request (`!priorId`), the model call returned and the visitor was told something real: `reply` non-empty, or a lead filed this turn (`spoken`'s own condition, `route.ts:485`); an empty completion that falls back to `strings.unavailable` is not an answer. Only turn 1 ever attempts it; the unique `(meter, source_ref)` on `conversation:<id>` is the backstop, not the gate. The leg sits just before the route's success response, after the transcript append.
- **G14. A re-sent automation text bills per copy.** When a pass's dedupe stamp fails after a successful send, the next tick sends the text again (`passes/review-request.ts:254` logs "expect up to 11 more copies before the morning band closes"; `no-show-nudge.ts:233` and `referral-ask.ts:283` say the same); each copy is a real, delivered text with its own `messages` row, so each records its own `sms` usage row. That is correct billing, not a double count, and the PR body says so.

## File Structure

12 files created, 23 modified (35 total).

**packages/db**
- Create `packages/db/src/usage.ts`: `recordUsage`, `reportableFrom`, `usageRangeFilter`, `listBilledUsageAccounts`, `listReportableUsage`, `markUsageReported`, `staleUsageAccountIds`, `countExpiredUsage`, `listAccountsWithStaleUsage`, constants and types. Every `usage_events` read is one request per `USAGE_ACCOUNTS_PER_READ` (50, two-part filters) or `USAGE_ACCOUNTS_PER_BOUNDED_READ` (25, three-part filters — see A20) accounts.
- Modify `packages/db/src/index.ts`: export them.
- Create `packages/db/src/usage.test.ts` (14 tests, no database; runs in CI only, like the whole db suite).
- Create `packages/db/src/test/usage.test.ts` (8 tests, live through `serviceDb()`, CI only).

**apps/web: recording**
- Create `apps/web/src/lib/billing/usage.ts`: `voiceMinutes`, `smsBillable`, `recordUsageSafely`.
- Create `apps/web/src/lib/billing/usage.test.ts` (8 tests — revised from 4: the original "never throws" test was vacuous; review corrections applied 2026-09-25, see Task 2's report, Fix 1-4).
- Modify `apps/web/src/lib/voice/call-state.ts` (`callerSpoke`) and `call-state.test.ts` (+1).
- Modify `apps/web/src/lib/voice/finish-call.ts` (the voice leg, gated `callerSpoke(state) || isMeaningful(outcome)`) and `finish-call.test.ts` (+7).
- Modify `apps/web/src/lib/voice/textback.ts` (the text-back leg); create `apps/web/src/lib/voice/textback.test.ts` (5 tests).
- Modify `apps/web/src/lib/automations/send-sms.ts` (`SentSms.usage` worked out after the send's `try`, the leg in `markAutomationSmsSent`) and `send-sms.test.ts` (+6, 2 edited).
- Modify `apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/conversations/actions.ts` and `actions.test.ts` (+6).
- Modify `apps/web/src/app/api/concierge/[publicId]/turn/route.ts` (the leg, on turn 1's successful reply) and `route.test.ts` (+5).

**apps/web: reporting**
- Modify `apps/web/src/lib/billing/stripe-gateway.ts`: `MeterEventInput`, `meterEventParams`, `METER_EVENT_TIMEOUT_MS`, `reportMeterEvent` (per-request `maxNetworkRetries: 0`, 10 s timeout — does not fully suppress the installed SDK's own single automatic retry of a reset connection, nor does `timeout` cut off a trickling response; corrected in Task 7's review), `meterEventFailureKind`.
- Modify `apps/web/src/lib/billing/fake-gateway.ts`: `reportMeterEvent` (a new key is a new event: A11 is not assumed), `meterEvents`, `failOn.error`.
- Modify `apps/web/src/lib/billing/stripe-gateway.test.ts` (+11).
- Create `apps/web/src/lib/billing/meter-event-failure.test.ts` (1 test, the real Stripe error classes).
- Modify `apps/web/src/lib/automations/caps.ts`: `USAGE_REPORT_TICK_CAP`, `USAGE_REPORT_BUDGET_MS`, `METER_EVENT_WORST_CASE_MS` (added in Task 7's review).
- Create `apps/web/src/lib/automations/passes/usage-report.ts` and `usage-report.test.ts` (14 tests).
- Modify `apps/web/src/lib/automations/registry.ts`, `sentinel.test.ts` (2 edited), `apps/web/src/app/api/cron/reminders/route.test.ts` (7 bodies edited, mock extended).

**apps/web: the banner**
- Modify `apps/web/src/lib/messages.ts`: `work.usageStale.*`.
- Create `apps/web/src/components/usage-stale-banner.tsx` and `usage-stale-banner.test.ts` (5 tests).
- Modify `apps/web/src/app/(dashboard)/dashboard/work/page.tsx` and `page.test.ts` (+3, 1 edited).
- Modify `apps/web/src/app/(dashboard)/dashboard/styleguide/page.tsx`.

**e2e**
- Create `apps/web/e2e/usage-meter.spec.ts` (1 test).

**New test count: 91** (revised from 85 — review corrections applied 2026-09-25, Fix 1 and Fix 2) = db usage 14 + db live usage 8 + web billing/usage 4 + call-state 1 + finish-call 7 + textback 5 + send-sms 6 + composer actions 6 + concierge route 5 + stripe-gateway 11 + meter-event-failure 1 + usage-report 14 + usage-stale-banner 5 + work page 3 + e2e 1. `it.each` is not used; each `it` is one test.

Baselines read on `main` 5dac86a on 2026-09-25 (`pnpm --filter web exec vitest run <file>`): stripe-gateway 45, call-state 20, finish-call 85, send-sms 10, composer actions 14, concierge route 43, sentinel 5, cron route 30, work page 15.

## Task order and checkpoints

11 tasks and 1 orchestrator checkpoint:

1. `packages/db/src/usage.ts` + its two test files
**Checkpoint A (orchestrator only):** push the branch; CI `verify` runs the db tests on the CI project; mutation probes on a throwaway branch.
2. `lib/billing/usage.ts` (the wrapper, `voiceMinutes`, `smsBillable`)
3. Voice leg (`callerSpoke`, `finishCall`)
4. SMS leg: automations (`send-sms.ts`)
5. SMS legs: the missed-call text-back and the composer reply
6. Concierge leg (billed when Sofía's first reply succeeds)
7. `BillingGateway.reportMeterEvent`, the fake, failure classification
8. The `usageReport` pass, caps, registry, sentinel and cron route tests
9. The stale-usage banner
10. e2e: Stripe test mode counts our meter events once (read from its aggregate)
11. Gates, counts, handoff

Task 2 needs Task 1's exports (code only, no database). Tasks 3-6 need Task 2. Task 8 needs Tasks 1 and 7. Task 9 needs Task 1. Task 10 needs Task 7. Tasks 3, 4, 5, 6, 7 touch disjoint files and may run in parallel lanes; Task 8 edits `sentinel.test.ts` and the cron `route.test.ts`, which no other task touches.

Commands run from the repo root `C:\Users\danlo\bis-platform` (Git Bash).

---

### Task 1: `usage.ts`, the only code that touches `usage_events`

**Files:**
- Create: `packages/db/src/usage.ts`
- Modify: `packages/db/src/index.ts` (append one export block at the end)
- Test: `packages/db/src/usage.test.ts` (no database), `packages/db/src/test/usage.test.ts` (live)

**Interfaces:**
- Consumes: 0051's `usage_events` (`0051_billing_core.sql:191-218`: `unique (meter, source_ref)`, `quantity > 0`, meter in `voice_minutes|sms|ai_chats`, `source_ref` 1-200 chars, index `(account_id, occurred_at desc)`) and `account_billing` (`:151-171`); `MeterKey` from `./billing`.
- Produces (used by Tasks 2, 8, 9):
  - `USAGE_SOURCE_PREFIX: Record<MeterKey, string>` = `{ voice_minutes: "call:", sms: "message:", ai_chats: "conversation:" }`
  - `USAGE_REPORT_WINDOW_MS = 34 * 24 * 60 * 60 * 1000`, `USAGE_STALE_AFTER_MS = 24 * 60 * 60 * 1000`
  - `type UsageInput = { accountId: string; meter: MeterKey; quantity: number; occurredAt: Date; sourceRef: string }`
  - `type UsageRow = { id: string; accountId: string; meter: MeterKey; quantity: number; occurredAt: string; sourceRef: string; reportedAt: string | null; createdAt: string }`
  - `type BilledUsageAccount = { accountId: string; stripeCustomerId: string; billingStartedAt: string }`
  - `USAGE_ACCOUNTS_PER_READ = 50` (two-part filter, no `beforeIso` — `staleUsageAccountIds` only), `USAGE_ACCOUNTS_PER_BOUNDED_READ = 25` (smaller: its filter carries a `beforeIso` on EVERY range, three parts per account instead of two — `countExpiredUsage`'s expired-row window AND `listReportableUsage`'s future-grace-bounded range both need it, since Fix 2 added a `beforeIso` to every range `listReportableUsage` builds — see A18 and A20), `USAGE_FUTURE_GRACE_MS = 5 * 60 * 1000`; `type UsageRange = { accountId: string; fromIso: string; beforeIso?: string }`
  - `recordUsage(db: SupabaseClient, input: UsageInput): Promise<"recorded" | "duplicate">`
  - `reportableFrom(billingStartedAt: string, now: Date): string`
  - `usageRangeFilter(ranges: readonly UsageRange[]): string` (the PostgREST `.or()` string)
  - `listBilledUsageAccounts(db: SupabaseClient): Promise<BilledUsageAccount[]>`
  - `listReportableUsage(db: SupabaseClient, accounts: readonly BilledUsageAccount[], now: Date, limit: number): Promise<UsageRow[]>` (oldest first ACROSS the accounts)
  - `markUsageReported(db: SupabaseClient, id: string, at: Date): Promise<boolean>`
  - `staleUsageAccountIds(db: SupabaseClient, accounts: readonly BilledUsageAccount[], now: Date): Promise<string[]>`
  - `countExpiredUsage(db: SupabaseClient, accounts: readonly BilledUsageAccount[], now: Date): Promise<number>`
  - `listAccountsWithStaleUsage(db: SupabaseClient, now: Date): Promise<string[]>`
  - Every read over `usage_events` is ONE request per `USAGE_ACCOUNTS_PER_READ` (two-part filters) or `USAGE_ACCOUNTS_PER_BOUNDED_READ` (three-part filters, a `beforeIso` on every range) accounts, never one per account (G7, G8) — except the stale probe, which is at most (stale accounts + 1) reads of `STALE_PROBE_ROWS` rows per group (G7, review correction 2026-09-25).

- [ ] **Step 1: Write the failing tests**

Create `packages/db/src/usage.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  recordUsage, reportableFrom, listBilledUsageAccounts, listReportableUsage, staleUsageAccountIds, usageRangeFilter,
  USAGE_REPORT_WINDOW_MS, USAGE_STALE_AFTER_MS, USAGE_FUTURE_GRACE_MS,
  USAGE_ACCOUNTS_PER_READ, USAGE_ACCOUNTS_PER_BOUNDED_READ,
  type BilledUsageAccount, type UsageInput,
} from "./usage";

/**
 * usage.ts without a database: the guards that must fire BEFORE a query, the
 * exact insert shape, the window arithmetic, the paging, the per-account
 * filter string and the batching of the reads. The live behaviour is
 * ./test/usage.test.ts. (Like every db-package test, this file runs only
 * where the env names a non-production project: CI.)
 */
const DAY = 24 * 60 * 60 * 1000;
const NOW = new Date("2026-09-25T15:00:00.000Z");
/** A valid-shaped uuid for account `n`, distinct and deterministic, so a
 *  test using dozens of "accounts" doesn't need dozens of randomUUID() calls
 *  and still passes usageRangeFilter's uuid check. */
const uuidFor = (n: number): string => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const billed = (accountId: string): BilledUsageAccount => ({
  accountId, stripeCustomerId: `cus_${accountId}`, billingStartedAt: "2026-09-20T00:00:00+00:00",
});
const dbRow = (id: string, accountId: string, occurredAt: string) => ({
  id, account_id: accountId, meter: "sms", quantity: 1, occurred_at: occurredAt,
  source_ref: `message:${id}`, reported_at: null, created_at: occurredAt,
});
const untouchable = {
  from: () => { throw new Error("the database was reached"); },
} as unknown as SupabaseClient;
const OK: UsageInput = {
  accountId: "acct_1", meter: "sms", quantity: 2,
  occurredAt: new Date("2026-09-25T14:00:00Z"), sourceRef: "message:m_1",
};

describe("recordUsage — refused before the database", () => {
  it("refuses a quantity that is not a positive whole number (mutation: drop the quantity guard → the stub's 'database was reached' is thrown instead, FAILS)", async () => {
    for (const quantity of [0, -3, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      await expect(recordUsage(untouchable, { ...OK, quantity })).rejects.toThrow(/quantity/);
    }
  });

  it("refuses a source that is not its meter's, an empty id, one past 200 characters, and an invalid date (mutation: drop the prefix check → FAILS)", async () => {
    await expect(recordUsage(untouchable, { ...OK, meter: "voice_minutes", sourceRef: "message:m_1" })).rejects.toThrow(/source_ref/);
    await expect(recordUsage(untouchable, { ...OK, sourceRef: "message:" })).rejects.toThrow(/source_ref/);
    await expect(recordUsage(untouchable, { ...OK, sourceRef: `message:${"x".repeat(200)}` })).rejects.toThrow(/source_ref/);
    await expect(recordUsage(untouchable, { ...OK, occurredAt: new Date("not a date") })).rejects.toThrow(/occurredAt/);
  });
});

describe("recordUsage — the insert", () => {
  it("inserts ON CONFLICT (meter, source_ref) DO NOTHING, never an update, every column mapped (mutation: onConflict 'source_ref' → FAILS; ignoreDuplicates false → FAILS)", async () => {
    const seen: unknown[] = [];
    const db = {
      from: (table: string) => ({
        upsert: (row: unknown, opts: unknown) => {
          seen.push(table, row, opts);
          return { select: async () => ({ data: [{ id: "u_1" }], error: null }) };
        },
      }),
    } as unknown as SupabaseClient;
    expect(await recordUsage(db, OK)).toBe("recorded");
    expect(seen).toEqual([
      "usage_events",
      { account_id: "acct_1", meter: "sms", quantity: 2, occurred_at: "2026-09-25T14:00:00.000Z", source_ref: "message:m_1" },
      { onConflict: "meter,source_ref", ignoreDuplicates: true },
    ]);
  });
});

describe("the reporting window", () => {
  it("reportableFrom: a billing start inside the window passes through untouched, microseconds and all; an older one is floored at now − 34 days (mutation: always return the window → FAILS; re-serialise the start through new Date() → the microseconds are lost, FAILS)", () => {
    const now = new Date("2026-09-25T15:00:00.000Z");
    expect(reportableFrom("2026-09-20T10:00:00.123456+00:00", now)).toBe("2026-09-20T10:00:00.123456+00:00");
    expect(reportableFrom("2026-06-01T00:00:00+00:00", now)).toBe("2026-08-22T15:00:00.000Z");
  });

  it("pins the window at 34 days, a day inside Stripe's 35 because a too-old event is dropped without an error, and the stale alarm at 24 hours (mutation: 35 days → FAILS)", () => {
    expect(USAGE_REPORT_WINDOW_MS).toBe(34 * DAY);
    expect(USAGE_STALE_AFTER_MS).toBe(DAY);
  });
});

describe("listBilledUsageAccounts — paging", () => {
  it("pages until an EMPTY page, never stopping on one merely SHORTER than the request — a server max_rows below the page size would otherwise make a short-but-nonempty page look like the end and drop every account past it (mutation: stop once a page is shorter than BILLED_PAGE → the third, empty-confirming read never happens, FAILS)", async () => {
    const ranges: [number, number][] = [];
    const page = (n: number, offset: number) => Array.from({ length: n }, (_, i) => ({
      account_id: `acct_${offset + i}`, stripe_customer_id: `cus_${offset + i}`, created_at: "2026-09-01T00:00:00+00:00",
    }));
    // Page 2 is short (2 rows, not 1000) but NOT the end: exactly what a
    // server max_rows cap below the requested 1,000 would produce. Only
    // page 3's genuine emptiness may end the loop.
    const pages = [page(1000, 0), page(2, 1000), [] as ReturnType<typeof page>];
    const chain = {
      select: () => chain, not: () => chain, order: () => chain,
      range: async (a: number, b: number) => {
        ranges.push([a, b]);
        return { data: pages[ranges.length - 1] ?? [], error: null };
      },
    };
    const db = { from: () => chain } as unknown as SupabaseClient;
    const got = await listBilledUsageAccounts(db);
    expect(got).toHaveLength(1002);
    expect(ranges).toEqual([[0, 999], [1000, 1999], [1002, 2001]]);
    expect(got[1001]).toEqual({ accountId: "acct_1001", stripeCustomerId: "cus_1001", billingStartedAt: "2026-09-01T00:00:00+00:00" });
  });
});

describe("usageRangeFilter: the account-id guard", () => {
  it("refuses an account id that is not uuid-shaped, so a value carrying `,`/`(`/`)` can never widen the filter (mutation: drop the uuid check → the malicious id is written straight into an unquoted account_id.eq clause instead of throwing, FAILS)", () => {
    const malicious = "x),account_id.not.is.null,and(account_id.eq.x";
    expect(() => usageRangeFilter([{ accountId: malicious, fromIso: "2026-09-20T10:00:00.000Z" }]))
      .toThrow(/uuid/);
  });

  it("accepts a real uuid, upper or lower case (mutation: reject a valid uuid → FAILS)", () => {
    expect(() => usageRangeFilter([{ accountId: uuidFor(1), fromIso: "2026-09-20T10:00:00.000Z" }])).not.toThrow();
    expect(() => usageRangeFilter([{ accountId: uuidFor(1).toUpperCase(), fromIso: "2026-09-20T10:00:00.000Z" }])).not.toThrow();
  });
});

describe("URL size: the per-account filter must fit in one request", () => {
  it("the shared three-part chunk (USAGE_ACCOUNTS_PER_BOUNDED_READ accounts, 3 filter parts each — a floor AND a ceiling — used by both countExpiredUsage's expired-row window and listReportableUsage's future-grace-bounded range) stays under a safe URL bound at the longest an id and a timestamp can be: a uuid and a microsecond, `+00:00`-suffixed occurred_at (mutation: raise USAGE_ACCOUNTS_PER_BOUNDED_READ to 50 → the same filter shape encodes past 9,000 characters, FAILS)", () => {
    const maxTs = "2026-09-20T10:00:00.123456+00:00";
    const ranges = Array.from({ length: USAGE_ACCOUNTS_PER_BOUNDED_READ }, () => ({
      accountId: randomUUID(), fromIso: maxTs, beforeIso: maxTs,
    }));
    const encoded = encodeURIComponent(usageRangeFilter(ranges));
    expect(encoded.length).toBeLessThan(6000);
  });

  it("listReportableUsage chunks its OWN read (every range it builds carries a beforeIso ceiling, so it is the three-part shape) by USAGE_ACCOUNTS_PER_BOUNDED_READ, not the two-part USAGE_ACCOUNTS_PER_READ — proven by capturing the filter this function itself sends, not just the constant's raw value (mutation: chunk this read by the 50-account USAGE_ACCOUNTS_PER_READ constant → all 50 accounts land in ONE request, whose encoded filter is past 9,000 characters, FAILS)", async () => {
    const maxTs = "2026-09-20T10:00:00.123456+00:00";
    const accounts: BilledUsageAccount[] = Array.from({ length: USAGE_ACCOUNTS_PER_READ }, () => ({
      accountId: randomUUID(), stripeCustomerId: "cus_x", billingStartedAt: maxTs,
    }));
    const filters: string[] = [];
    const chain = {
      select: () => chain, is: () => chain, order: () => chain,
      or: (f: string) => { filters.push(f); return chain; },
      limit: async () => ({ data: [], error: null }),
    };
    await listReportableUsage({ from: () => chain } as unknown as SupabaseClient, accounts, NOW, 10);
    expect(filters).toHaveLength(Math.ceil(USAGE_ACCOUNTS_PER_READ / USAGE_ACCOUNTS_PER_BOUNDED_READ));
    for (const f of filters) expect(encodeURIComponent(f).length).toBeLessThan(6000);
  });
});

describe("the per-account reads: bounded, one request per group of accounts", () => {
  it("usageRangeFilter: one and() per account with ITS OWN range, every timestamp double-quoted — checked by exact string comparison, since PostgREST's own acceptance of the quoted form is proved live, not here (mutation: drop the quotes around a timestamp → the built string no longer matches the expected literal, FAILS; one shared floor for every account → FAILS)", () => {
    expect(usageRangeFilter([
      { accountId: uuidFor(1), fromIso: "2026-09-20T10:00:00.123456+00:00" },
      { accountId: uuidFor(2), fromIso: "2026-08-22T15:00:00.000Z", beforeIso: "2026-08-23T15:00:00.000Z" },
    ])).toBe(
      `and(account_id.eq.${uuidFor(1)},occurred_at.gte."2026-09-20T10:00:00.123456+00:00"),`
      + `and(account_id.eq.${uuidFor(2)},occurred_at.gte."2026-08-22T15:00:00.000Z",occurred_at.lt."2026-08-23T15:00:00.000Z")`,
    );
  });

  it("listReportableUsage reads accounts in groups of USAGE_ACCOUNTS_PER_BOUNDED_READ and merges the reads OLDEST FIRST across accounts, at most `limit` (mutation: concatenate the reads in read order → FAILS; one read naming all 120 accounts → FAILS)", async () => {
    const accounts = Array.from({ length: 120 }, (_, i) => billed(uuidFor(i)));
    const filters: string[] = [];
    // 120 accounts chunked by USAGE_ACCOUNTS_PER_BOUNDED_READ (25) is 5 groups:
    // [0-24],[25-49],[50-74],[75-99],[100-119]. uuidFor(0) lands in group 0,
    // uuidFor(60) in group 2, uuidFor(110) in group 4.
    const perRead = [
      [dbRow("u_late", uuidFor(0), "2026-09-25T12:00:00+00:00")],
      [],
      [dbRow("u_early", uuidFor(60), "2026-09-24T12:00:00+00:00")],
      [],
      [dbRow("u_mid", uuidFor(110), "2026-09-25T01:00:00+00:00")],
    ];
    const chain = {
      select: () => chain, is: () => chain, order: () => chain,
      or: (f: string) => { filters.push(f); return chain; },
      limit: async () => ({ data: perRead[filters.length - 1] ?? [], error: null }),
    };
    const rows = await listReportableUsage({ from: () => chain } as unknown as SupabaseClient, accounts, NOW, 2);
    expect(filters.map((f) => f.split("and(").length - 1)).toEqual([25, 25, 25, 25, 20]);
    expect(rows.map((r) => r.id)).toEqual(["u_early", "u_mid"]);
  });

  it("listReportableUsage's filter caps every account's range at now + 5 minutes, the shared future grace, on top of its own floor (mutation: drop the upper bound → the filter carries no occurred_at.lt clause, FAILS)", async () => {
    const account = billed(uuidFor(1));
    const filters: string[] = [];
    const chain = {
      select: () => chain, is: () => chain, order: () => chain,
      or: (f: string) => { filters.push(f); return chain; },
      limit: async () => ({ data: [], error: null }),
    };
    await listReportableUsage({ from: () => chain } as unknown as SupabaseClient, [account], NOW, 10);
    const until = new Date(NOW.getTime() + USAGE_FUTURE_GRACE_MS).toISOString();
    expect(filters).toHaveLength(1);
    expect(filters[0]).toContain(`occurred_at.lt."${until}"`);
  });

  /**
   * A fake `usage_events` holding stale rows, answering the stale probe the
   * way PostgREST would: only the accounts the `.or()` names, ordered by id,
   * at most `.limit()` rows AND at most the server's `max_rows`. Awaiting the
   * chain without a `.limit()` returns every match (what an unbounded read
   * would), so a missing cap shows up as rows read, not as a crash.
   */
  function staleFake(rows: { id: string; account_id: string }[], maxRows = Infinity) {
    const served: number[] = [];
    const read = (named: Set<string>, limit: number) => {
      const out = rows.filter((r) => named.has(r.account_id))
        .sort((x, y) => (x.id < y.id ? -1 : 1)).slice(0, Math.min(limit, maxRows))
        .map((r) => ({ account_id: r.account_id }));
      served.push(out.length);
      return { data: out, error: null };
    };
    const db = {
      from: () => {
        let named = new Set<string>();
        const chain = {
          select: () => chain, is: () => chain, lt: () => chain, order: () => chain,
          or: (f: string) => { named = new Set([...f.matchAll(/account_id\.eq\.([0-9a-f-]{36})/g)].map((m) => m[1]!)); return chain; },
          limit: async (n: number) => read(named, n),
          then: (ok: (v: unknown) => unknown) => Promise.resolve(read(named, Infinity)).then(ok),
        };
        return chain;
      },
    } as unknown as SupabaseClient;
    return { db, served };
  }
  const backlog = (accountId: string, n: number) =>
    Array.from({ length: n }, (_, i) => ({ id: `${accountId}-${String(i).padStart(6, "0")}`, account_id: accountId }));

  it("staleUsageAccountIds reads a number of rows bounded by ACCOUNTS, never by backlog: 8,000 stale rows on two of 60 accounts are found reading at most STALE_PROBE_ROWS × (2 stale accounts + 2 groups) rows (mutation: remove the .limit(STALE_PROBE_ROWS) cap → all 8,000 rows are read, FAILS)", async () => {
    expect(STALE_PROBE_ROWS).toBe(50);
    const accounts = Array.from({ length: 60 }, (_, i) => billed(uuidFor(i)));
    const { db, served } = staleFake([...backlog(uuidFor(1), 5000), ...backlog(uuidFor(55), 3000)]);
    const ids = await staleUsageAccountIds(db, accounts, NOW);
    expect(ids).toEqual([uuidFor(1), uuidFor(55)]);
    const read = served.reduce((a, b) => a + b, 0);
    expect(read).toBeLessThanOrEqual(STALE_PROBE_ROWS * (2 + 2));
    // Two groups of USAGE_ACCOUNTS_PER_READ: each reads once per stale
    // account it holds, then once more to come back empty.
    expect(served).toEqual([STALE_PROBE_ROWS, 0, STALE_PROBE_ROWS, 0]);
  });

  it("staleUsageAccountIds ends a group only on an EMPTY read, never a SHORT one — a server max_rows below STALE_PROBE_ROWS makes every read short while accounts are still unread (mutation: stop once a read is shorter than STALE_PROBE_ROWS → only the first account is found, FAILS)", async () => {
    const accounts = [uuidFor(1), uuidFor(2), uuidFor(3)].map(billed);
    const { db, served } = staleFake([...backlog(uuidFor(1), 40), ...backlog(uuidFor(3), 2)], 1);
    const ids = await staleUsageAccountIds(db, accounts, NOW);
    expect(ids).toEqual([uuidFor(1), uuidFor(3)]);
    expect(served).toEqual([1, 1, 0]);
  });
});
```

Count: **14 tests** (revised from 9: +2 for the account-id uuid guard, +1 for the URL-size bound on the shared bounded-chunk constant, +1 for `listReportableUsage`'s future-grace upper bound, +1 for `listReportableUsage`'s OWN chunking staying under the URL bound — review corrections applied 2026-09-25, see Task 1's report, Fix 1 and Fix 2).

Create `packages/db/src/test/usage.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { serviceDb } from "../service";
import { withTestAccount } from "./fixtures";
import { insertPlan, type PlanWrite } from "../billing";
import {
  recordUsage, listBilledUsageAccounts, listReportableUsage, markUsageReported,
  countExpiredUsage, listAccountsWithStaleUsage,
} from "../usage";

/**
 * usage.ts, live through serviceDb(). Accounts come from withTestAccount
 * (their usage_events and account_billing rows cascade with them). A billed
 * account needs a plan (account_billing.plan_id is NOT NULL); plans are
 * AGENCY-scoped, so each is stamped with this run and deleted after the
 * accounts, whose billing rows `restrict` the delete.
 */
const RUN = Math.random().toString(36).slice(2, 10);
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const iso = (ms: number) => new Date(ms).toISOString();

const PLAN: PlanWrite = {
  terms: {
    name: "placeholder", monthlyPriceCents: 4900,
    features: { voice_receptionist: true, web_concierge: true },
    allowances: { voice_minutes: 500, sms: 1000, ai_chats: 200 },
    overageCents: { voice_minutes: 12, sms: 3, ai_chats: 25 },
  },
  stripeProductId: "prod_t_usage",
  stripePriceIds: { base: "price_t_b", voice_minutes: "price_t_v", sms: "price_t_s", ai_chats: "price_t_a" },
};

async function withPlan(fn: (planId: string) => Promise<void>): Promise<void> {
  const id = randomUUID();
  const r = await insertPlan(serviceDb(), { id, ...PLAN, terms: { ...PLAN.terms, name: `Usage ${RUN} ${id.slice(0, 8)}` } });
  if (!r.ok) throw new Error(`usage.test plan fixture refused: ${r.reason}`);
  let bodyOk = false;
  try {
    await fn(id);
    bodyOk = true;
  } finally {
    // Thrown only when the body passed: a throw from finally would REPLACE
    // the primary failure (billing.test.ts's withPlans rule).
    const { error } = await serviceDb().from("plans").delete().eq("id", id);
    if (error) {
      const msg = `usage.test cleanup failed on plans: ${error.message}`;
      if (bodyOk) throw new Error(msg);
      console.error(msg);
    }
  }
}

/** A billed account: a Stripe customer AND a subscription. */
async function bill(accountId: string, planId: string, startedAtMs: number): Promise<string> {
  const customer = `cus_t_${randomUUID()}`;
  const { error } = await serviceDb().from("account_billing").insert({
    account_id: accountId, plan_id: planId, stripe_customer_id: customer,
    stripe_subscription_id: `sub_t_${randomUUID()}`, subscription_status: "active",
    created_at: iso(startedAtMs),
  });
  if (error) throw new Error(`usage.test billing fixture refused: ${error.message}`);
  return customer;
}

/** A ledger row written straight to the table, so created_at and reported_at can be set. */
async function usageRow(
  accountId: string, at: { occurredAt: number; createdAt?: number; reportedAt?: number },
): Promise<string> {
  const { data, error } = await serviceDb().from("usage_events").insert({
    account_id: accountId, meter: "sms", quantity: 1,
    occurred_at: iso(at.occurredAt), source_ref: `message:${randomUUID()}`,
    ...(at.createdAt === undefined ? {} : { created_at: iso(at.createdAt) }),
    ...(at.reportedAt === undefined ? {} : { reported_at: iso(at.reportedAt) }),
  }).select("id").single();
  if (error || !data) throw new Error(`usage.test usage fixture refused: ${error?.message ?? "no row"}`);
  return (data as { id: string }).id;
}

describe("usage.ts, live", () => {
  it("recordUsage stores the fact exactly as given and says 'recorded' (mutation: write occurred_at from the clock instead of input.occurredAt → FAILS)", () =>
    withTestAccount(async (db, acct) => {
      const sourceRef = `call:${randomUUID()}`;
      const occurredAt = new Date(Date.now() - 3 * DAY);
      expect(await recordUsage(db, { accountId: acct, meter: "voice_minutes", quantity: 4, occurredAt, sourceRef })).toBe("recorded");
      const { data, error } = await db.from("usage_events")
        .select("account_id, meter, quantity, occurred_at, reported_at").eq("source_ref", sourceRef);
      expect(error).toBeNull();
      expect(data).toHaveLength(1);
      const row = data![0] as { account_id: string; meter: string; quantity: number; occurred_at: string; reported_at: string | null };
      expect({ ...row, occurred_at: Date.parse(row.occurred_at) }).toEqual({
        account_id: acct, meter: "voice_minutes", quantity: 4, occurred_at: occurredAt.getTime(), reported_at: null,
      });
    }));

  it("recordUsage a second time for the same source is 'duplicate' and changes nothing: one row, the first quantity (mutation: drop ignoreDuplicates → the upsert UPDATES quantity to 9, FAILS)", () =>
    withTestAccount(async (db, acct) => {
      const input = { accountId: acct, meter: "sms" as const, quantity: 2, occurredAt: new Date(), sourceRef: `message:${randomUUID()}` };
      expect(await recordUsage(db, input)).toBe("recorded");
      expect(await recordUsage(db, { ...input, quantity: 9 })).toBe("duplicate");
      const { data, error } = await db.from("usage_events").select("quantity").eq("source_ref", input.sourceRef);
      expect(error).toBeNull();
      expect(data).toEqual([{ quantity: 2 }]);
    }));

  it("listBilledUsageAccounts returns accounts with a Stripe customer AND subscription, with the billing start; complimentary, link-only and customer-less rows are left out (mutation: drop the subscription filter → FAILS; drop the customer filter → FAILS)", () =>
    withPlan((planId) => withTestAccount((db, billed) => withTestAccount((_d1, comp) => withTestAccount((_d2, linkOnly) =>
      withTestAccount(async (_d3, subOnly) => {
        const started = Date.now() - 5 * DAY;
        const customer = await bill(billed, planId, started);
        expect((await db.from("account_billing").insert({ account_id: comp, plan_id: planId, complimentary: true })).error).toBeNull();
        expect((await db.from("account_billing").insert({
          account_id: linkOnly, plan_id: planId, stripe_customer_id: `cus_t_${randomUUID()}`,
        })).error).toBeNull();
        expect((await db.from("account_billing").insert({
          account_id: subOnly, plan_id: planId, stripe_subscription_id: `sub_t_${randomUUID()}`, subscription_status: "active",
        })).error).toBeNull();
        const ours = (await listBilledUsageAccounts(db)).filter((a) => [billed, comp, linkOnly, subOnly].includes(a.accountId));
        expect(ours.map((a) => ({ ...a, billingStartedAt: Date.parse(a.billingStartedAt) }))).toEqual([
          { accountId: billed, stripeCustomerId: customer, billingStartedAt: started },
        ]);
      }))))));

  it("listReportableUsage: the unreported rows of the accounts given, each from ITS OWN floor (billing start, or now − 34 days), oldest first ACROSS them, at most `limit`; PostgREST's own microsecond timestamps survive the quoted filter (mutation: drop .is('reported_at', null) → FAILS; one shared floor for both accounts → the pre-billing row appears, FAILS; order descending → FAILS). The quoting itself is defence-in-depth, not something this read can prove red: supabase-js percent-encodes '+' before PostgREST ever sees it, so an unquoted timestamp parses identically here — see usage.ts's usageRangeFilter doc.", () =>
    withPlan((planId) => withTestAccount((db, a) => withTestAccount((_d1, b) => withTestAccount(async (_d2, unbilled) => {
      const now = Date.now();
      await bill(a, planId, now - 5 * DAY);
      await bill(b, planId, now - 60 * DAY);
      await usageRow(a, { occurredAt: now - 6 * DAY });                     // before A's billing start
      const a1 = await usageRow(a, { occurredAt: now - 3 * HOUR });
      await usageRow(a, { occurredAt: now - 1 * HOUR, reportedAt: now });   // already reported
      await usageRow(b, { occurredAt: now - 40 * DAY });                    // older than the window
      const b1 = await usageRow(b, { occurredAt: now - 6 * DAY });           // A's floor would exclude it
      const a2 = await usageRow(a, { occurredAt: now - 2 * HOUR });
      await usageRow(unbilled, { occurredAt: now - 2.5 * HOUR });            // not an account given
      const ours = (await listBilledUsageAccounts(db)).filter((x) => [a, b].includes(x.accountId));
      expect(ours).toHaveLength(2);
      const rows = await listReportableUsage(db, ours, new Date(now), 10);
      expect(rows.map((r) => r.id)).toEqual([b1, a1, a2]);
      expect(rows[1]).toMatchObject({ accountId: a, meter: "sms", quantity: 1, reportedAt: null });
      expect((await listReportableUsage(db, ours, new Date(now), 1)).map((r) => r.id)).toEqual([b1]);
    })))));

  it("listReportableUsage excludes a row dated more than 5 minutes in the future — Stripe accepts a meter event up to 5 minutes ahead of its own clock and silently drops one further out, so a too-future row must stay unreported rather than be sent and stamped (mutation: drop the upper bound on the filter → the far-future row is returned too, FAILS)", () =>
    withPlan((planId) => withTestAccount(async (db, a) => {
      const now = Date.now();
      await bill(a, planId, now - 5 * DAY);
      const past = await usageRow(a, { occurredAt: now - 3 * HOUR });
      const inGrace = await usageRow(a, { occurredAt: now + 3 * 60 * 1000 });   // 3 min ahead: within grace
      await usageRow(a, { occurredAt: now + 10 * 60 * 1000 });                  // 10 min ahead: excluded
      const account = (await listBilledUsageAccounts(db)).find((x) => x.accountId === a)!;
      const rows = await listReportableUsage(db, [account], new Date(now), 10);
      expect(rows.map((r) => r.id)).toEqual([past, inGrace]);
    })));

  it("markUsageReported stamps reported_at and updated_at once, then reports false (mutation: drop .is('reported_at', null) → the second call returns true, FAILS)", () =>
    withTestAccount(async (db, a) => {
      const id = await usageRow(a, { occurredAt: Date.now() - HOUR });
      const at = new Date(Date.now() - 1000);
      expect(await markUsageReported(db, id, at)).toBe(true);
      expect(await markUsageReported(db, id, new Date())).toBe(false);
      const { data, error } = await db.from("usage_events").select("reported_at, updated_at").eq("id", id).single();
      expect(error).toBeNull();
      const row = data as { reported_at: string; updated_at: string };
      expect(Date.parse(row.reported_at)).toBe(at.getTime());
      expect(Date.parse(row.updated_at)).toBe(at.getTime());
    }));

  it("countExpiredUsage counts only unreported rows between an account's billing start and now − 34 days, and only for accounts billed before that floor (mutation: drop the billing-start bound → the pre-billing row counts, FAILS; drop the window's upper bound → the in-window row counts, FAILS; drop the reported filter → FAILS)", () =>
    withPlan((planId) => withTestAccount((db, old) => withTestAccount(async (_d, recent) => {
      const now = Date.now();
      await bill(old, planId, now - 60 * DAY);
      await bill(recent, planId, now - 5 * DAY);
      await usageRow(old, { occurredAt: now - 40 * DAY });                    // expired: counted
      await usageRow(old, { occurredAt: now - 70 * DAY });                    // before billing: never billable
      await usageRow(old, { occurredAt: now - 2 * DAY });                     // inside the window
      await usageRow(old, { occurredAt: now - 40 * DAY, reportedAt: now });   // reported in time
      await usageRow(recent, { occurredAt: now - 40 * DAY });                 // before ITS billing start
      const ours = (await listBilledUsageAccounts(db)).filter((x) => [old, recent].includes(x.accountId));
      expect(ours).toHaveLength(2);
      expect(await countExpiredUsage(db, ours, new Date(now))).toBe(1);
    }))));

  it("listAccountsWithStaleUsage names a billed account whose reportable row has waited over a day since it was RECORDED; not one whose old row predates billing, nor one whose old event was recorded an hour ago (mutation: drop the billing-start floor → FAILS; test occurred_at instead of created_at → FAILS)", () =>
    withPlan((planId) => withTestAccount((db, stale) => withTestAccount((_d1, preBilling) => withTestAccount(async (_d2, lateRecorded) => {
      const now = Date.now();
      await bill(stale, planId, now - 10 * DAY);
      await usageRow(stale, { occurredAt: now - 25 * HOUR, createdAt: now - 25 * HOUR });
      await bill(preBilling, planId, now - HOUR);
      await usageRow(preBilling, { occurredAt: now - 25 * HOUR, createdAt: now - 25 * HOUR });
      await bill(lateRecorded, planId, now - 10 * DAY);
      await usageRow(lateRecorded, { occurredAt: now - 30 * HOUR, createdAt: now - HOUR });
      const ids = await listAccountsWithStaleUsage(db, new Date());
      expect(ids).toContain(stale);
      expect(ids).not.toContain(preBilling);
      expect(ids).not.toContain(lateRecorded);
    })))));
});
```

Count: **8 tests** (revised from 7: +1 for `listReportableUsage`'s future-grace exclusion — review corrections applied 2026-09-25, see Task 1's report).

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm --filter @bis/db typecheck`
Expected: FAIL: `Cannot find module './usage'` (and `'../usage'`).

The db suite cannot run locally while `packages/db/.env` names production: `pnpm --filter @bis/db exec vitest run src/usage.test.ts src/test/usage.test.ts` stops in global setup with `The db suite refuses to run against production: ...`. That refusal is expected, not a failure of this task; CI is the proof (Checkpoint A).

- [ ] **Step 3: Write `usage.ts`**

Create `packages/db/src/usage.ts`:

```ts
import type { SupabaseClient } from "@supabase/supabase-js";
import type { MeterKey } from "./billing";

/**
 * The usage ledger (0051's `usage_events`): one row per billable fact, and
 * the reads the cron's usage report and the agency's stale-usage banner make
 * over it. Client billing spec 2026-09-24, section 3 flow 3 and section 4.
 *
 * Writes need serviceDb(): 0051 grants `authenticated` SELECT on
 * usage_events and nothing more, so a client can neither forge nor erase its
 * own bill. Writers set `updated_at` themselves (0051 has no trigger).
 */

/** What each meter counts, as the prefix of `source_ref`. The unique key is
 *  (meter, source_ref), so these prefixes are what make "one call is billed
 *  once as minutes" true. */
export const USAGE_SOURCE_PREFIX: Record<MeterKey, string> = {
  voice_minutes: "call:",
  sms: "message:",
  ai_chats: "conversation:",
};

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * How far back the report still sends a row. Stripe takes a meter event up
 * to 35 CALENDAR days old and validates that asynchronously: an older event
 * is accepted, then dropped, with no error this process ever sees (Stripe
 * docs, "Handle meter event errors": `timestamp_too_far_in_past`). One day
 * of margin keeps a row sent near the edge from being stamped reported and
 * never billed. An older row is counted `expired` and never sent.
 */
export const USAGE_REPORT_WINDOW_MS = 34 * DAY_MS;

/** A reportable row still unreported this long after it was RECORDED raises
 *  the agency banner (spec section 4: "unreported for > 24 h"). */
export const USAGE_STALE_AFTER_MS = DAY_MS;

/**
 * How far into the FUTURE a row's `occurred_at` may be and still be sent.
 * Stripe accepts a meter event timestamped up to 5 minutes ahead of its own
 * clock and silently drops one further out (same asynchronous-validation
 * shape as USAGE_REPORT_WINDOW_MS's past-side bound, undocumented as a
 * number but observed in Stripe's meter event handling). A row past this
 * bound is left unreported rather than sent and stamped `reported_at`,
 * which would bury it: `reported_at` is this codebase's only record of
 * "Stripe has it", and there is no un-reporting a row once stamped.
 */
export const USAGE_FUTURE_GRACE_MS = 5 * 60 * 1000;

export type UsageInput = {
  accountId: string;
  meter: MeterKey;
  /** Whole units: minutes, segments or conversations. Never a fraction. */
  quantity: number;
  occurredAt: Date;
  /** `<prefix><id>`, the prefix fixed by the meter (USAGE_SOURCE_PREFIX). */
  sourceRef: string;
};

export type UsageRow = {
  id: string;
  accountId: string;
  meter: MeterKey;
  quantity: number;
  /** As PostgREST returns it, microseconds included. */
  occurredAt: string;
  sourceRef: string;
  reportedAt: string | null;
  createdAt: string;
};

/** A billed account as the report and the banner see it. */
export type BilledUsageAccount = {
  accountId: string;
  stripeCustomerId: string;
  /** `account_billing.created_at`, untouched: usage before it is never sent. */
  billingStartedAt: string;
};

type UsageDbRow = {
  id: string; account_id: string; meter: MeterKey; quantity: number; occurred_at: string;
  source_ref: string; reported_at: string | null; created_at: string;
};

const USAGE_COLUMNS = "id, account_id, meter, quantity, occurred_at, source_ref, reported_at, created_at";

function toUsageRow(r: UsageDbRow): UsageRow {
  return {
    id: r.id, accountId: r.account_id, meter: r.meter, quantity: r.quantity, occurredAt: r.occurred_at,
    sourceRef: r.source_ref, reportedAt: r.reported_at, createdAt: r.created_at,
  };
}

function assertUsage(input: UsageInput): void {
  if (!Number.isSafeInteger(input.quantity) || input.quantity <= 0) {
    throw new Error(`recordUsage: quantity must be a positive whole number, got ${input.quantity}`);
  }
  const prefix = USAGE_SOURCE_PREFIX[input.meter];
  if (prefix === undefined) throw new Error(`recordUsage: unknown meter ${JSON.stringify(input.meter)}`);
  const ref = input.sourceRef;
  if (!ref.startsWith(prefix) || ref.length === prefix.length || ref.length > 200) {
    throw new Error(
      `recordUsage: a ${input.meter} source_ref is "${prefix}<id>" and at most 200 characters, got ${JSON.stringify(ref.slice(0, 60))}`,
    );
  }
  if (Number.isNaN(input.occurredAt.getTime())) throw new Error("recordUsage: occurredAt is not a valid date");
}

/**
 * Records one billable fact ONCE: an insert with ON CONFLICT (meter,
 * source_ref) DO NOTHING (`upsert` + `ignoreDuplicates`, crm-config.ts's
 * precedent), so recording the same call, message or conversation again
 * changes nothing and says "duplicate". It never updates a row: a stored
 * quantity is what Stripe was, or will be, sent.
 *
 * Throws on a malformed input (before any query) and on any other database
 * error. Send paths never call this directly: they call apps/web's
 * `recordUsageSafely`, which catches.
 */
export async function recordUsage(db: SupabaseClient, input: UsageInput): Promise<"recorded" | "duplicate"> {
  assertUsage(input);
  const { data, error } = await db.from("usage_events")
    .upsert({
      account_id: input.accountId, meter: input.meter, quantity: input.quantity,
      occurred_at: input.occurredAt.toISOString(), source_ref: input.sourceRef,
    }, { onConflict: "meter,source_ref", ignoreDuplicates: true })
    .select("id");
  if (error) throw new Error(`recordUsage failed: ${error.message}`);
  return (data ?? []).length === 1 ? "recorded" : "duplicate";
}

/**
 * The earliest `occurred_at` the report still sends for an account: its
 * billing start, or the 34-day window's floor when that is later. The
 * billing start is returned UNTOUCHED (PostgREST's microseconds kept); only
 * the floor is built here.
 */
export function reportableFrom(billingStartedAt: string, now: Date): string {
  const windowStartMs = now.getTime() - USAGE_REPORT_WINDOW_MS;
  return Date.parse(billingStartedAt) >= windowStartMs ? billingStartedAt : new Date(windowStartMs).toISOString();
}

const BILLED_PAGE = 1000;

/**
 * Every account whose usage goes to Stripe: an account_billing row with a
 * Stripe customer AND a subscription. A complimentary row never has a
 * subscription (0051's account_billing_complimentary_check), so it is left
 * out by construction. Paged by account id, continuing until an actually
 * EMPTY page: a page shorter than BILLED_PAGE is NOT proof there is no more
 * — if the project's PostgREST `max_rows` setting is below BILLED_PAGE, a
 * request for 1,000 rows can come back with fewer than 1,000 even though
 * more remain, and advancing `from` by the requested page size (rather than
 * the page's actual length) would then skip the rest of that window
 * entirely, silently dropping billed accounts. Advancing by `rows.length`
 * and stopping only on zero rows is correct under any `max_rows` value.
 */
export async function listBilledUsageAccounts(db: SupabaseClient): Promise<BilledUsageAccount[]> {
  const out: BilledUsageAccount[] = [];
  for (let from = 0; ; ) {
    const { data, error } = await db.from("account_billing")
      .select("account_id, stripe_customer_id, created_at")
      .not("stripe_customer_id", "is", null)
      .not("stripe_subscription_id", "is", null)
      .order("account_id", { ascending: true })
      .range(from, from + BILLED_PAGE - 1);
    if (error) throw new Error(`listBilledUsageAccounts failed: ${error.message}`);
    const rows = (data ?? []) as { account_id: string; stripe_customer_id: string; created_at: string }[];
    for (const r of rows) {
      out.push({ accountId: r.account_id, stripeCustomerId: r.stripe_customer_id, billingStartedAt: r.created_at });
    }
    if (rows.length === 0) return out;
    from += rows.length;
  }
}

/**
 * Accounts per read for a filter with TWO parts per account (`account_id.eq`
 * and `occurred_at.gte` — staleUsageAccountIds is the only caller: it never
 * sets a `beforeIso`, so its ranges stay two-part). Measured with node
 * (usage.test.ts), at the longest an id and a timestamp can be (a uuid; a
 * microsecond, `+00:00`-suffixed `occurred_at`): 50 such accounts encode to
 * about 6,150 characters, under postgrest-js's own 8,000-character warning
 * and a common 8 KB request-line limit. A filter with a THIRD part per
 * account (a `beforeIso` on every range) needs its OWN smaller
 * USAGE_ACCOUNTS_PER_BOUNDED_READ below — at 50 accounts that shape measures
 * about 9,350 characters, already past the 8,000-character warning. Do not
 * reuse this constant for a caller that sets `beforeIso` on every range
 * (listReportableUsage's own future-grace ceiling is exactly that shape —
 * see USAGE_ACCOUNTS_PER_BOUNDED_READ).
 */
export const USAGE_ACCOUNTS_PER_READ = 50;

/**
 * Accounts per read for a filter that carries BOTH a floor and a ceiling on
 * every range (three `and(...)` parts per account): countExpiredUsage's
 * expired-row window, and listReportableUsage's per-account range now that
 * every range also carries the USAGE_FUTURE_GRACE_MS ceiling. Half of
 * USAGE_ACCOUNTS_PER_READ: measured (usage.test.ts) at 25 accounts, maximum
 * id/timestamp length, the encoded filter is about 4,700 characters,
 * comfortably under the 6,000-character bound that test pins — chunking
 * either of those two reads by USAGE_ACCOUNTS_PER_READ (50) instead measures
 * past 9,000, over postgrest-js's 8,000-character warning.
 */
export const USAGE_ACCOUNTS_PER_BOUNDED_READ = 25;

/** One account's slice of occurred_at: from `fromIso` (inclusive), before
 *  `beforeIso` (exclusive) when given. */
export type UsageRange = { accountId: string; fromIso: string; beforeIso?: string };

/** The shape Postgres accepts as a uuid (automations.ts's
 *  parseQuoteFollowupConfig is the precedent for this exact pattern). */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * A PostgREST `or` filter selecting each account's rows in ITS OWN range, so
 * one read serves many accounts whose windows differ (each billing start is
 * its own floor). Timestamps are double-quoted: with a real `MeterKey`
 * timestamp (from the database or `toISOString()`) supabase-js already
 * percent-encodes the value before it reaches PostgREST — `+` becomes
 * `%2B`, so PostgREST never sees the bare `.`/`:`/`+` this quoting was
 * written to escape, and unquoted timestamps are proven to parse
 * identically in ./test/usage.test.ts's live read. The quoting stays anyway
 * as defence-in-depth against a future caller passing an unencoded value
 * through some other path, and because it matches automations.ts's
 * eitherAnchorSince precedent for the same column type.
 *
 * Account ids are asserted to be uuids and REFUSED otherwise: `account_id`
 * is not quoted, so an id built from anything but a real uuid — one
 * carrying `,`, `(` or `)` — could otherwise widen the filter to name rows
 * outside the caller's ranges (e.g. `x),account_id.not.is.null,and(...)`).
 * Every caller here sources ids from `accounts.id` (uuid primary key), so
 * this can only fire on a defect upstream — which is exactly when it must
 * throw rather than silently building a wider query.
 */
export function usageRangeFilter(ranges: readonly UsageRange[]): string {
  return ranges.map((r) => {
    if (!UUID_RE.test(r.accountId)) {
      throw new Error(`usageRangeFilter: accountId is not a uuid: ${JSON.stringify(r.accountId)}`);
    }
    const parts = [`account_id.eq.${r.accountId}`, `occurred_at.gte."${r.fromIso}"`];
    if (r.beforeIso !== undefined) parts.push(`occurred_at.lt."${r.beforeIso}"`);
    return `and(${parts.join(",")})`;
  }).join(",");
}

function inGroups<T>(xs: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += size) out.push(xs.slice(i, i + size));
  return out;
}

/** Each account's reportable range: from max(billing start, now − 34 days). */
function reportableRanges(accounts: readonly BilledUsageAccount[], now: Date): UsageRange[] {
  return accounts.map((a) => ({ accountId: a.accountId, fromIso: reportableFrom(a.billingStartedAt, now) }));
}

const oldestFirst = (x: UsageRow, y: UsageRow): number =>
  Date.parse(x.occurredAt) - Date.parse(y.occurredAt) || (x.id < y.id ? -1 : x.id > y.id ? 1 : 0);

/**
 * The next rows the report may send, OLDEST FIRST ACROSS the accounts given,
 * at most `limit`: unreported, each account's from its own `reportableFrom`,
 * and none dated more than USAGE_FUTURE_GRACE_MS past `now` (a row further
 * in the future than that stays unreported rather than being sent — Stripe
 * would silently drop it — and stamped reported by markUsageReported, which
 * would bury it for good). One read per USAGE_ACCOUNTS_PER_BOUNDED_READ
 * accounts — every range here carries a `beforeIso` (the future-grace
 * ceiling), so it is the three-part filter shape, not
 * USAGE_ACCOUNTS_PER_READ's two-part one — each ordered and limited in SQL,
 * then merged here, so the result is the true oldest `limit` rows.
 *
 * Oldest first across accounts is the fairness rule (G4): no account waits
 * behind another's place in a list, and a backlog drains in the order it
 * grew. The merge compares milliseconds; within one millisecond the order is
 * by id, which no caller relies on.
 */
export async function listReportableUsage(
  db: SupabaseClient, accounts: readonly BilledUsageAccount[], now: Date, limit: number,
): Promise<UsageRow[]> {
  if (!Number.isSafeInteger(limit) || limit <= 0 || accounts.length === 0) return [];
  const untilIso = new Date(now.getTime() + USAGE_FUTURE_GRACE_MS).toISOString();
  const rows: UsageRow[] = [];
  for (const group of inGroups(accounts, USAGE_ACCOUNTS_PER_BOUNDED_READ)) {
    const ranges = reportableRanges(group, now).map((r) => ({ ...r, beforeIso: untilIso }));
    const { data, error } = await db.from("usage_events").select(USAGE_COLUMNS)
      .is("reported_at", null)
      .or(usageRangeFilter(ranges))
      .order("occurred_at", { ascending: true }).order("id", { ascending: true })
      .limit(limit);
    if (error) throw new Error(`listReportableUsage failed: ${error.message}`);
    rows.push(...((data ?? []) as UsageDbRow[]).map(toUsageRow));
  }
  return rows.sort(oldestFirst).slice(0, limit);
}

/** Stamps a row reported, once. True when this call stamped it; false when
 *  it already was (a concurrent tick got there first). */
export async function markUsageReported(db: SupabaseClient, id: string, at: Date): Promise<boolean> {
  const stamp = at.toISOString();
  const { data, error } = await db.from("usage_events")
    .update({ reported_at: stamp, updated_at: stamp })
    .eq("id", id).is("reported_at", null)
    .select("id");
  if (error) throw new Error(`markUsageReported failed: ${error.message}`);
  return (data ?? []).length === 1;
}

/** The most rows ONE stale-probe read may return. The probe only has to learn
 *  WHICH accounts hold a stale row, never how many rows they hold, so a read
 *  is small and the next one names only the accounts not yet found. */
export const STALE_PROBE_ROWS = 50;

/**
 * The billed accounts, among those given, with STALE usage: a reportable
 * row (G3's window) still unreported a day after it was RECORDED
 * (`created_at`, not `occurred_at`: a row recorded late is not late to
 * Stripe until it has waited a day). One definition for the cron's log and
 * the agency banner, in the accounts' own order.
 *
 * BOUNDED BY ACCOUNTS, NEVER BY BACKLOG. Per group of USAGE_ACCOUNTS_PER_READ
 * accounts, one read of at most STALE_PROBE_ROWS rows over the accounts NOT
 * YET FOUND; every account a read names leaves the next read's filter, and
 * the group is done on the first EMPTY read. A non-empty read always names
 * at least one account still in the filter, so a group takes at most (its
 * stale accounts + 1) reads, and one call reads at most
 * STALE_PROBE_ROWS × (stale accounts + groups) rows — however many stale
 * rows pile up while Stripe is down. (It used to page through EVERY stale
 * row, 1,000 at a time: a day-long outage made the tick's bookkeeping grow
 * with the backlog.)
 *
 * Only an EMPTY read ends a group, never a SHORT one: a read shorter than
 * STALE_PROBE_ROWS is not proof nothing else matches (a project whose
 * PostgREST `max_rows` is below it returns short reads while rows remain).
 * Narrowing the filter is what makes that safe: the loop stops only when
 * no account left in the filter has a stale row.
 */
export async function staleUsageAccountIds(
  db: SupabaseClient, accounts: readonly BilledUsageAccount[], now: Date,
): Promise<string[]> {
  const createdBefore = new Date(now.getTime() - USAGE_STALE_AFTER_MS).toISOString();
  const stale = new Set<string>();
  for (const group of inGroups(accounts, USAGE_ACCOUNTS_PER_READ)) {
    let open = group;
    while (open.length > 0) {
      const { data, error } = await db.from("usage_events").select("account_id")
        .is("reported_at", null).lt("created_at", createdBefore)
        .or(usageRangeFilter(reportableRanges(open, now)))
        .order("id", { ascending: true })
        .limit(STALE_PROBE_ROWS);
      if (error) throw new Error(`staleUsageAccountIds failed: ${error.message}`);
      const rows = (data ?? []) as { account_id: string }[];
      const found = new Set(rows.map((r) => r.account_id).filter((id) => open.some((a) => a.accountId === id)));
      // Empty, or (defensively) naming no account still open: nothing left
      // to learn from this group.
      if (found.size === 0) break;
      for (const id of found) stale.add(id);
      open = open.filter((a) => !found.has(a.accountId));
    }
  }
  return accounts.filter((a) => stale.has(a.accountId)).map((a) => a.accountId);
}

/**
 * Unreported rows of billed accounts that fell OUT of the window: from the
 * billing start to now − 34 days. Never sent (Stripe would drop them without
 * an error), counted so the cron can say so. Only accounts billed before
 * that floor can have any; one count per USAGE_ACCOUNTS_PER_BOUNDED_READ of
 * them (this filter carries a `beforeIso` on every range, so it needs the
 * smaller chunk — see that constant).
 */
export async function countExpiredUsage(
  db: SupabaseClient, accounts: readonly BilledUsageAccount[], now: Date,
): Promise<number> {
  const floorMs = now.getTime() - USAGE_REPORT_WINDOW_MS;
  const floorIso = new Date(floorMs).toISOString();
  const old = accounts.filter((a) => Date.parse(a.billingStartedAt) < floorMs);
  let total = 0;
  for (const group of inGroups(old, USAGE_ACCOUNTS_PER_BOUNDED_READ)) {
    const { count, error } = await db.from("usage_events").select("id", { count: "exact", head: true })
      .is("reported_at", null)
      .or(usageRangeFilter(group.map((a) => ({ accountId: a.accountId, fromIso: a.billingStartedAt, beforeIso: floorIso }))));
    if (error) throw new Error(`countExpiredUsage failed: ${error.message}`);
    total += count ?? 0;
  }
  return total;
}

/** The billed accounts with stale usage (the banner's count is its length):
 *  the paged billed-account list, then staleUsageAccountIds over it. */
export async function listAccountsWithStaleUsage(db: SupabaseClient, now: Date): Promise<string[]> {
  return staleUsageAccountIds(db, await listBilledUsageAccounts(db), now);
}
```

- [ ] **Step 4: Export it**

Append to the end of `packages/db/src/index.ts`:

```ts

// Client billing usage ledger (0051's usage_events): recorded where each
// billable fact happens, reported to Stripe by the cron. See ./usage.ts.
export { recordUsage, reportableFrom, usageRangeFilter, listBilledUsageAccounts, listReportableUsage,
         markUsageReported, staleUsageAccountIds, countExpiredUsage, listAccountsWithStaleUsage,
         USAGE_SOURCE_PREFIX, USAGE_REPORT_WINDOW_MS, USAGE_STALE_AFTER_MS, USAGE_ACCOUNTS_PER_READ,
         USAGE_ACCOUNTS_PER_BOUNDED_READ, USAGE_FUTURE_GRACE_MS,
         type UsageInput, type UsageRow, type UsageRange, type BilledUsageAccount } from "./usage";
```

- [ ] **Step 5: Typecheck**

Run: `pnpm --filter @bis/db typecheck`
Expected: exit 0.

Run: `pnpm --filter web typecheck`
Expected: exit 0 (nothing in apps/web uses the new exports yet).

- [ ] **Step 6: Commit**

```bash
git add packages/db/src/usage.ts packages/db/src/index.ts packages/db/src/usage.test.ts packages/db/src/test/usage.test.ts
git commit -m "feat(db): usage.ts, the usage ledger (insert once, billed accounts, unreported rows, stale check)"
```

---

### Checkpoint A (ORCHESTRATOR ONLY, not an implementer step)

No migration: 0051 is already on both projects (ledger: "0051 APPLIED ... NEVER RE-APPLY").

1. Push the branch. CI `verify` runs the db suite against the CI project. Read the check runs for the head SHA: `verify` green, and in its log `src/usage.test.ts` 13 passed and `src/test/usage.test.ts` 8 passed.
2. Mutation probes, as PR-1 ran them: a throwaway branch `probe/m7a-pr2-db` (its own worktree), one commit per probe group, each applying the mutations named in the titles of Task 1's 21 tests; push, confirm each named test is red for its own reason, then delete the branch and the worktree. Never merge a probe.
3. Ledger line: `M7a-PR2 Checkpoint A: db tests green on <sha>, probes <run ids>`.

---

### Task 2: `lib/billing/usage.ts`, the one way a send path records usage

**Files:**
- Create: `apps/web/src/lib/billing/usage.ts`
- Test: `apps/web/src/lib/billing/usage.test.ts`

**Interfaces:**
- Consumes: `recordUsage`, `type UsageInput`, `type SupabaseClient` from `@bis/db` (Task 1); `type SmsProvider` from `@/lib/sms/types` (`isFake: boolean`, `redirectTo?: string`).
- Produces (used by Tasks 3-6):
  - `voiceMinutes(durationSecs: number): number`
  - `smsBillable(provider: Pick<SmsProvider, "isFake" | "redirectTo">): boolean`
  - `recordUsageSafely(db: SupabaseClient | (() => SupabaseClient), input: UsageInput | (() => UsageInput), label: string): Promise<void>` (never throws; `input` may be a thunk, for a caller whose fields are read off a value that could itself be null or throw while being read — built inside the same try as `db`; the write races a 5 s timeout, `USAGE_WRITE_TIMEOUT_MS`, so a stalled insert is abandoned and logged rather than left open forever; an existing caller that passes a plain `UsageInput` object needs no change, since that is still a valid member of the union)

**Review correction (Fix 1, 2026-09-25):** the brief's original `recordUsageSafely` test (single "never throws" case) was vacuous — a rejected write and a throwing getter both logged the same shared prefix, so either failure path alone satisfied both assertions, and an unawaited write (`void recordUsage(...)`) or a silent early return stayed green too. The corrected test below splits that into distinct cases, each asserting its OWN unique log text and an exact call count, and adds a case that proves the write is actually awaited (a deferred promise whose settlement is the only thing that can flip the outer `.then`). It also adds: a case for a throwing input thunk (Fix 2), a fake-timer case for the write's timeout bound (Fix 3), and a case for a rejection reason that cannot survive `String(e)` (Fix 4, `Object.create(null)`).

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/lib/billing/usage.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const dbMocks = vi.hoisted(() => ({ recordUsage: vi.fn() }));
vi.mock("@bis/db", async (importOriginal) => ({ ...(await importOriginal<object>()), ...dbMocks }));

import type { SupabaseClient, UsageInput } from "@bis/db";
import { voiceMinutes, smsBillable, recordUsageSafely } from "./usage";

const DB = { tag: "service-db" } as unknown as SupabaseClient;
const INPUT: UsageInput = {
  accountId: "acct_1", meter: "sms", quantity: 2,
  occurredAt: new Date("2026-09-25T14:00:00Z"), sourceRef: "message:msg_1",
};

beforeEach(() => {
  dbMocks.recordUsage.mockReset().mockResolvedValue("recorded");
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("voiceMinutes", () => {
  it("rounds UP to whole minutes, never below one (mutation: Math.round → 61 s bills 1, FAILS; drop the floor of 1 → 0 s bills 0, FAILS)", () => {
    expect([0, 1, 59, 60, 61, 119, 120, 121, 3600].map(voiceMinutes)).toEqual([1, 1, 1, 1, 2, 2, 2, 3, 60]);
  });
});

describe("smsBillable", () => {
  it("only a real, unredirected provider bills (mutation: drop the redirect check → a developer-phone text bills, FAILS; test isFake for truthiness → a provider that never says it is real bills, FAILS)", () => {
    expect(smsBillable({ isFake: false })).toBe(true);
    expect(smsBillable({ isFake: true })).toBe(false);
    expect(smsBillable({ isFake: false, redirectTo: "+19565550199" })).toBe(false);
    expect(smsBillable({ isFake: undefined as unknown as boolean })).toBe(false);
  });
});

describe("recordUsageSafely", () => {
  it("hands recordUsage the input unchanged, on the client given or the one a getter builds, and the input given or the one a thunk builds (mutation: pass the getter itself as the client → FAILS; pass the input thunk itself as the input → FAILS)", async () => {
    await recordUsageSafely(DB, INPUT, "t");
    await recordUsageSafely(() => DB, INPUT, "t");
    await recordUsageSafely(DB, () => INPUT, "t");
    expect(dbMocks.recordUsage.mock.calls).toEqual([[DB, INPUT], [DB, INPUT], [DB, INPUT]]);
  });

  it("a rejected write is awaited before it is logged, with its own message, exactly once (mutation: void the write instead of awaiting it → resolves before the write settles, FAILS; remove the catch → rejects, FAILS)", async () => {
    let reject!: (e: unknown) => void;
    const pendingWrite = new Promise<never>((_resolve, rej) => { reject = rej; });
    dbMocks.recordUsage.mockReturnValueOnce(pendingWrite);

    let settled = false;
    const call = recordUsageSafely(DB, INPUT, "sendSmsAction msg_1").then(() => { settled = true; });

    await Promise.resolve();
    await Promise.resolve();
    expect(settled).toBe(false);
    expect(console.error).not.toHaveBeenCalled();

    reject(new Error("usage_events is down"));
    await call;

    expect(settled).toBe(true);
    expect(console.error).toHaveBeenCalledTimes(1);
    expect(console.error).toHaveBeenCalledWith(
      "sendSmsAction msg_1: usage not recorded (sms message:msg_1, quantity 2): usage_events is down",
    );
  });

  it("a throwing db getter is caught before the write is attempted, and logged with its own message (mutation: build the client outside the try → throws, FAILS)", async () => {
    await expect(recordUsageSafely(
      () => { throw new Error("SUPABASE_SERVICE_ROLE_KEY is missing"); }, INPUT, "sendSmsAction msg_1",
    )).resolves.toBeUndefined();

    expect(dbMocks.recordUsage).not.toHaveBeenCalled();
    expect(console.error).toHaveBeenCalledTimes(1);
    expect(console.error).toHaveBeenCalledWith(
      "sendSmsAction msg_1: usage not recorded (sms message:msg_1, quantity 2): SUPABASE_SERVICE_ROLE_KEY is missing",
    );
  });

  it("a throwing input builder is caught inside the same try, before recordUsage is ever called (mutation: build the input outside the try → throws, FAILS)", async () => {
    await expect(recordUsageSafely(
      DB, () => { throw new Error("row is null"); }, "sendSmsAction msg_1",
    )).resolves.toBeUndefined();

    expect(dbMocks.recordUsage).not.toHaveBeenCalled();
    expect(console.error).toHaveBeenCalledTimes(1);
    expect(console.error).toHaveBeenCalledWith(
      "sendSmsAction msg_1: usage not recorded (input not built): row is null",
    );
  });

  it("bounds the write so one that never settles is abandoned and logged, not left open forever (mutation: remove the timeout race → the hanging write outlives the caller, FAILS)", async () => {
    vi.useFakeTimers();
    dbMocks.recordUsage.mockReturnValueOnce(new Promise<never>(() => {}));

    const pending = recordUsageSafely(DB, INPUT, "sendSmsAction msg_1");
    await vi.advanceTimersByTimeAsync(5_000);
    await expect(pending).resolves.toBeUndefined();

    expect(console.error).toHaveBeenCalledTimes(1);
    expect(console.error).toHaveBeenCalledWith(
      "sendSmsAction msg_1: usage not recorded (sms message:msg_1, quantity 2): usage write timed out after 5000ms",
    );
  });

  it("describes a rejection reason it cannot stringify without throwing itself (mutation: use String(e) directly → throws on Object.create(null), FAILS)", async () => {
    dbMocks.recordUsage.mockRejectedValueOnce(Object.create(null) as unknown);

    await expect(recordUsageSafely(DB, INPUT, "sendSmsAction msg_1")).resolves.toBeUndefined();

    expect(console.error).toHaveBeenCalledTimes(1);
    expect(console.error).toHaveBeenCalledWith(
      "sendSmsAction msg_1: usage not recorded (sms message:msg_1, quantity 2): unprintable error",
    );
  });
});
```

Count: **8 tests**.

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter web exec vitest run src/lib/billing/usage.test.ts`
Expected: FAIL at import: `Failed to resolve import "./usage"`.

- [ ] **Step 3: Write `usage.ts`**

Create `apps/web/src/lib/billing/usage.ts`:

```ts
import { recordUsage, type SupabaseClient, type UsageInput } from "@bis/db";
import type { SmsProvider } from "@/lib/sms/types";

/**
 * Client billing, the recording half (spec 2026-09-24, section 3 flow 3).
 * Every billable fact writes one usage_events row where it already happens:
 * a call Sofía talked to ends (finish-call.ts), a text reaches a customer
 * (send-sms.ts, textback.ts, the composer's sendSmsAction), Sofía's first
 * reply in a website chat succeeds (the concierge turn route). The cron's usage report
 * (automations/passes/usage-report.ts) sends the rows to Stripe.
 *
 * Recording NEVER checks whether the account is billed: the ledger fills for
 * every account (spec section 4, rollout (2)); only the report looks at
 * account_billing.
 */

/**
 * Minutes billed for a call Sofía talked to: the call's stored duration
 * rounded UP to whole minutes, never fewer than one. Fed the SAME
 * `durationSecs` finishCall writes to the calls row, so the row and the bill
 * agree to the minute (125 s is 3 minutes on both).
 */
export function voiceMinutes(durationSecs: number): number {
  return Math.max(1, Math.ceil(durationSecs / 60));
}

/**
 * Did this send put the text in front of the CUSTOMER? Only then does it
 * bill. The fake provider delivers nothing, and a real provider forced
 * outside production sends every text to a developer's phone
 * (lib/sms/index.ts). Production always holds the real, unredirected
 * provider, so this changes nothing there; it keeps a preview, which writes
 * production's database, from leaving usage rows for texts no customer
 * received. Strict `=== false`: a provider that does not say it is real is
 * not billed.
 */
export function smsBillable(provider: Pick<SmsProvider, "isFake" | "redirectTo">): boolean {
  return provider.isFake === false && provider.redirectTo === undefined;
}

/**
 * A usage write must never hold its caller's send path open: supabase-js has
 * no default timeout on a query (`lib/sms/telnyx.ts:5-8` bounds the same
 * finishCall path's outbound HTTP call for the identical reason — a hanging
 * provider there would keep a webhook alive for the platform's whole
 * function timeout). 5 s, not that call's 10 s: this is one small insert,
 * not a carrier round trip.
 */
const USAGE_WRITE_TIMEOUT_MS = 5_000;

async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer!: ReturnType<typeof setTimeout>;
  const timedOut = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error(`usage write timed out after ${ms}ms`)), ms);
  });
  try {
    return await Promise.race([promise, timedOut]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * `String(e)` throws on a rejection reason with no prototype
 * (`Object.create(null)`): there is no `toString`/`valueOf` to fall back to,
 * and coercing it would turn a LOGGING call into the very escape
 * `recordUsageSafely` exists to prevent. Falls back to a fixed string rather
 * than risk a second throw describing the first.
 */
function describeError(e: unknown): string {
  if (e instanceof Error) return e.message;
  try {
    return String(e);
  } catch {
    return "unprintable error";
  }
}

/**
 * The ONLY way a send path records usage. Best effort, and it NEVER throws:
 * by the time it runs the text is sent, the call is over or the chat has
 * started, and a ledger problem must not change what the caller of the send
 * path sees, nor skip the steps after it. A failure is logged with what was
 * lost; PR-4's nightly reconciliation is where a missing row gets noticed
 * against Stripe.
 *
 * `db` may be a getter, so a caller on the RLS surface (the composer) builds
 * the service client INSIDE this try: `serviceDb()` throws when its key is
 * missing, and that throw must not escape either. `input` may likewise be a
 * thunk, for a caller whose fields are read off a value that could itself be
 * null or throw while being read (e.g. a row looked up moments earlier) — it
 * is built INSIDE this same try, not by the caller before this function is
 * ever entered, for the same reason. The write itself races
 * `USAGE_WRITE_TIMEOUT_MS`, so a stalled `usage_events` insert is abandoned
 * and logged rather than left open forever.
 */
export async function recordUsageSafely(
  db: SupabaseClient | (() => SupabaseClient),
  input: UsageInput | (() => UsageInput),
  label: string,
): Promise<void> {
  let built: UsageInput | undefined;
  try {
    built = typeof input === "function" ? input() : input;
    const client = typeof db === "function" ? db() : db;
    await withTimeout(recordUsage(client, built), USAGE_WRITE_TIMEOUT_MS);
  } catch (e) {
    const detail = built
      ? `${built.meter} ${built.sourceRef}, quantity ${built.quantity}`
      : "input not built";
    console.error(`${label}: usage not recorded (${detail}): ${describeError(e)}`);
  }
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `pnpm --filter web exec vitest run src/lib/billing/usage.test.ts`
Expected: `Tests  8 passed (8)`.

Run: `pnpm --filter web typecheck`
Expected: exit 0.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/billing/usage.ts apps/web/src/lib/billing/usage.test.ts
git commit -m "feat(billing): recordUsageSafely, voiceMinutes and smsBillable, the one way a send path records usage"
```

**Note (Fix 1, 2026-09-25):** this task's code shipped in commit `26d4144` with the ORIGINAL (vacuous) test; the corrected test and the `usage.ts` changes above (thunk input, write timeout, safe error describer) shipped separately in a follow-up commit once the review finding was fixed. Tasks 3-6 below call `recordUsageSafely` with a plain `UsageInput` object at every site (no site's fields are read from a value that could be null or throw while being read), so none of them needed to change to pass a thunk — a plain object remains a valid `UsageInput | (() => UsageInput)` argument without modification.

---

### Task 3: The voice leg (minutes of every call Sofía talked to)

**Files:**
- Modify: `apps/web/src/lib/voice/call-state.ts` (`callerSpoke`; `classifyOutcome` uses it)
- Modify: `apps/web/src/lib/voice/finish-call.ts` (one `durationSecs`; the usage leg after the automation-log leg)
- Test: `apps/web/src/lib/voice/call-state.test.ts` (+1), `apps/web/src/lib/voice/finish-call.test.ts` (+7)

**Interfaces:**
- Consumes: `voiceMinutes`, `recordUsageSafely` (Task 2). Verified today in `finish-call.ts`: `finishCall` at 348; the durable row at 549-572 (duration computed inline at 559); the automation-log leg at 574-590, gated on `meta.callRowId`; the alert-SMS deliver at 598-604; the text-back deliver at 629-632; `emit` at 648-652. `ctx.db` is `serviceDb()` (the incoming route's `finishCtx`).
- Produces: `callerSpoke(state: Pick<CallState, "transcript">): boolean` (exported from `call-state.ts`); one `voice_minutes` row per call with a call row id where `callerSpoke(state) || isMeaningful(outcome)` (G5): `{ accountId: ctx.accountId, meter: "voice_minutes", quantity: voiceMinutes(durationSecs), occurredAt: meta.endedAt, sourceRef: "call:<meta.callRowId>" }`.

- [ ] **Step 1: Write the failing tests**

In `apps/web/src/lib/voice/call-state.test.ts`, add `callerSpoke` to the import list (the block at lines 2-6):

```ts
import {
  emptyCallState, classifyOutcome, withBooking, withBookingCancelled,
  withLead, withMessage, withTranscript, withServed, wasServed, withTransferred,
  withRecordedCaller, withCallerDelta, clearPendingCallerTurn, callerSpoke,
} from "./call-state";
```

and append at the end of the file:

```ts

describe("callerSpoke — the billing signal for voice minutes", () => {
  it("is true only when a CALLER turn carries words: Sofía's greeting alone, or a blank caller turn, is not the caller speaking; a robocall's recorded words are (mutation: return transcript.length > 0 → FAILS; drop .trim() → FAILS)", () => {
    expect(callerSpoke(emptyCallState())).toBe(false);
    expect(callerSpoke(withTranscript(emptyCallState(), { role: "assistant", text: "Hi, this is Sofía with Rio Roofing.", at: "t" }))).toBe(false);
    expect(callerSpoke(withTranscript(emptyCallState(), { role: "caller", text: "   ", at: "t" }))).toBe(false);
    expect(callerSpoke(withTranscript(emptyCallState(), { role: "caller", text: "hello?", at: "t" }))).toBe(true);
    expect(callerSpoke(withRecordedCaller(withTranscript(emptyCallState(),
      { role: "caller", text: "Press 1 to renew your vehicle warranty", at: "t" })))).toBe(true);
  });
});
```

In `apps/web/src/lib/voice/finish-call.test.ts`:

(a) add `recordUsage: vi.fn(),` to the hoisted `dbMocks` (lines 3-7), after `recordAutomationLog: vi.fn(),`:

```ts
const dbMocks = vi.hoisted(() => ({
  finishCallRow: vi.fn(), createContact: vi.fn(), ensureConversation: vi.fn(),
  createMessage: vi.fn(), incrementUnreadCount: vi.fn(), emit: vi.fn(),
  fillContactBlanks: vi.fn(), updateMessageStatus: vi.fn(), hasRecentOutboundSms: vi.fn(),
  getAlertPhone: vi.fn(), getContact: vi.fn(), recordAutomationLog: vi.fn(), recordUsage: vi.fn(),
}));
```

(b) add `withRecordedCaller` to the `./call-state` import:

```ts
import {
  emptyCallState, withLead, withMessage, withTranscript, withBooking, withBookingCancelled, withServed,
  withTransferred, withRecordedCaller,
} from "./call-state";
```

(c) in `beforeEach`, after `dbMocks.recordAutomationLog.mockResolvedValue(undefined);`, add:

```ts
  dbMocks.recordUsage.mockResolvedValue("recorded");
```

(d) append at the end of the file:

```ts

describe("finishCall — usage: the minutes of a call Sofía talked to (client billing)", () => {
  const callOf = (secs: number) => ({
    callRowId: "call1", startedAt: new Date("2027-06-01T12:00:00Z"),
    endedAt: new Date(new Date("2027-06-01T12:00:00Z").getTime() + secs * 1000),
  });

  it("records voice minutes AFTER the durable row: the stored duration rounded UP, the call as source, the call's end as occurred_at; an abandoned call bills through the callerSpoke half alone (mutation: Math.round(secs / 60) → 2 minutes, FAILS; move the leg above finishCallRow → call order FAILS; gate on isMeaningful(outcome) alone → this abandoned call records nothing, FAILS)", async () => {
    const m = callOf(125);
    await finishCall(abandonedState(), ctx, m);
    expect(dbMocks.finishCallRow.mock.calls[0]![3]).toEqual(expect.objectContaining({ durationSecs: 125 }));
    expect(dbMocks.recordUsage).toHaveBeenCalledTimes(1);
    expect(dbMocks.recordUsage).toHaveBeenCalledWith(ctx.db, {
      accountId: "a1", meter: "voice_minutes", quantity: 3, occurredAt: m.endedAt, sourceRef: "call:call1",
    });
    expect(dbMocks.finishCallRow.mock.invocationCallOrder[0]!).toBeLessThan(dbMocks.recordUsage.mock.invocationCallOrder[0]!);
  });

  it("a silent call (Sofía's greeting, no caller words, no booking/lead/message) records nothing, though its turn_count is 1; nor does a connect-timeout with no transcript at all (mutation: gate on turn_count / transcript.length → FAILS; gate on the call row id alone → FAILS)", async () => {
    const s = withTranscript(emptyCallState(), { role: "assistant", text: "Hi, this is Sofía with Rio Roofing.", at: "t" });
    const r = await finishCall(s, ctx, meta);
    expect(r.outcome).toBe("spam");
    expect(dbMocks.finishCallRow.mock.calls[0]![3]).toEqual(expect.objectContaining({ turnCount: 1 }));
    await finishCall(emptyCallState(), ctx, meta);
    expect(dbMocks.recordUsage).not.toHaveBeenCalled();
  });

  it("a message Sofía took bills though no caller turn was transcribed: the outcome says the caller interacted (mutation: gate on callerSpoke(state) alone → FAILS)", async () => {
    const s = withMessage(emptyCallState(), { body: "call me", at: "t" });
    const r = await finishCall(s, ctx, meta);
    expect(r.outcome).toBe("message");
    expect(dbMocks.recordUsage).toHaveBeenCalledTimes(1);
    expect(dbMocks.recordUsage).toHaveBeenCalledWith(ctx.db, {
      accountId: "a1", meter: "voice_minutes", quantity: 2, occurredAt: meta.endedAt, sourceRef: "call:call1",
    });
  });

  it("a robocall that reached Sofía is billed although it records as spam: its minutes were spent (mutation: skip usage when the outcome is 'spam' → FAILS)", async () => {
    const s = withRecordedCaller(withTranscript(emptyCallState(),
      { role: "caller", text: "This is an important message about your vehicle's extended warranty", at: "t" }));
    const r = await finishCall(s, ctx, meta);
    expect(r.outcome).toBe("spam");
    expect(dbMocks.recordUsage).toHaveBeenCalledWith(ctx.db, expect.objectContaining({
      meter: "voice_minutes", quantity: 2, sourceRef: "call:call1",
    }));
  });

  it("records the minutes even when the call row could not be written: the call still happened (mutation: gate the leg on `stored` → FAILS)", async () => {
    dbMocks.finishCallRow.mockRejectedValue(new Error("db down"));
    const r = await finishCall(abandonedState(), ctx, meta);
    expect(r.stored).toBe(false);
    expect(dbMocks.recordUsage).toHaveBeenCalledWith(ctx.db, expect.objectContaining({ quantity: 2, sourceRef: "call:call1" }));
  });

  it("with no call row there is nothing to key the usage on, so nothing is recorded (mutation: drop the callRowId gate → recorded as 'call:null', FAILS)", async () => {
    await finishCall(abandonedState(), ctx, { ...meta, callRowId: null });
    expect(dbMocks.recordUsage).not.toHaveBeenCalled();
  });

  it("a failing usage write changes nothing: same result, the text-back still sent, the activity event still emitted (mutation: remove recordUsageSafely's catch → finishCall rejects, FAILS)", async () => {
    dbMocks.recordUsage.mockRejectedValue(new Error("usage_events is down"));
    const r = await finishCall(abandonedState(), textbackCtx, meta);
    expect(r).toEqual({ stored: true, notified: false, outcome: "abandoned" });
    expect(smsRefs.send).toHaveBeenCalledTimes(1);
    expect(dbMocks.emit).toHaveBeenCalledWith(
      expect.anything(), "a1", "call.recorded", "voice", { callId: "call1", outcome: "abandoned" }, "ai");
  });
});
```

Count: **1** (call-state) + **7** (finish-call).

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm --filter web exec vitest run src/lib/voice/call-state.test.ts src/lib/voice/finish-call.test.ts`
Expected: FAIL: `callerSpoke is not a function`, and the new finish-call tests fail on `recordUsage` never being called (the silent-call, no-row-id and failing-write tests may already pass; the other four must be red).

- [ ] **Step 3: Add `callerSpoke`**

In `apps/web/src/lib/voice/call-state.ts`, replace line 123:

```ts
  if (state.transcript.some((t) => t.role === "caller" && t.text.trim())) return "abandoned";
```

with:

```ts
  if (callerSpoke(state)) return "abandoned";
```

and add directly after `classifyOutcome`'s closing brace (before the `withRecordedCaller` doc comment):

```ts

/**
 * Did the CALLER say anything? A caller turn with words in the transcript.
 *
 * Two readers: `classifyOutcome` above (a call where the caller spoke and
 * got nothing is `abandoned`, not `spam`), and client billing, which bills
 * voice minutes for these calls and for any booked/lead/message call
 * (finish-call.ts: `callerSpoke(state) || isMeaningful(outcome)`). NOT `turn_count`:
 * the transcript holds Sofía's own turns too, so a silent ring that heard
 * her greeting has a turn count of 1 and must not bill. A robocall that
 * reached her DOES speak here: the recording guard writes its words as a
 * caller turn before hanging up (call-events.ts), and those minutes were
 * spent.
 */
export function callerSpoke(state: Pick<CallState, "transcript">): boolean {
  return state.transcript.some((t) => t.role === "caller" && t.text.trim().length > 0);
}
```

- [ ] **Step 4: Add the voice leg**

In `apps/web/src/lib/voice/finish-call.ts`:

(a) Imports. Replace

```ts
import { classifyOutcome, wasServed, wasTransferred } from "./call-state";
```

with

```ts
import { classifyOutcome, wasServed, wasTransferred, callerSpoke } from "./call-state";
import { voiceMinutes, recordUsageSafely } from "@/lib/billing/usage";
```

(b) One duration. Replace

```ts
  // The durable row. Its own try/catch, independent of both legs above — a
  // DB outage here must not un-send an alert already on the wire, and must
  // not roll back a contact/message already written.
  let stored = false;
```

with

```ts
  // Computed once: the calls row stores it, and the voice usage below bills
  // from the SAME number, so the row and the bill agree to the minute.
  const durationSecs = Math.max(0, Math.round((meta.endedAt.getTime() - meta.startedAt.getTime()) / 1000));

  // The durable row. Its own try/catch, independent of both legs above — a
  // DB outage here must not un-send an alert already on the wire, and must
  // not roll back a contact/message already written.
  let stored = false;
```

and replace

```ts
        durationSecs: Math.max(0, Math.round((meta.endedAt.getTime() - meta.startedAt.getTime()) / 1000)),
```

with

```ts
        durationSecs,
```

(c) The leg. Replace

```ts
    } catch (e) {
      console.error(`finishCall ${meta.callRowId}: automation log write failed: ${String(e)}`);
    }
  }
```

with

```ts
    } catch (e) {
      console.error(`finishCall ${meta.callRowId}: automation log write failed: ${String(e)}`);
    }
  }

  // USAGE (client billing): one `voice_minutes` row per call Sofía talked
  // to (danlo): the caller said something (`callerSpoke`), OR the outcome
  // is booked/lead/message (`meaningful`, computed at the top), because
  // those mean the caller interacted even when no caller turn was
  // transcribed. That includes a robocall that reached her (its words are a
  // caller turn, and its minutes were spent) and excludes a silent ring or a
  // connect-timeout. Minutes are the stored duration rounded UP, at least
  // one (`voiceMinutes`).
  //
  // Gated on `meta.callRowId`, NOT on `stored`, like the automation-log leg
  // above: the carrier and model minutes were spent whether or not
  // finishCallRow landed. The call id is the usage row's source_ref, so a
  // call with no row id (startCallRow failed open) has nothing to key
  // idempotently on and is not recorded.
  //
  // After the durable row and before the carrier sends below: a database
  // insert, and `recordUsageSafely` never throws, so it cannot cost the call
  // its alert text, its text-back, or this function's never-throws contract.
  if (meta.callRowId && (callerSpoke(state) || meaningful)) {
    await recordUsageSafely(ctx.db, {
      accountId: ctx.accountId, meter: "voice_minutes", quantity: voiceMinutes(durationSecs),
      occurredAt: meta.endedAt, sourceRef: `call:${meta.callRowId}`,
    }, `finishCall ${meta.callRowId}`);
  }
```

- [ ] **Step 5: Run them to verify they pass**

Run: `pnpm --filter web exec vitest run src/lib/voice/call-state.test.ts src/lib/voice/finish-call.test.ts`
Expected: `Tests  113 passed (113)` (call-state 20 → 21, finish-call 85 → 92).

Run: `pnpm --filter web typecheck`
Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/lib/voice/call-state.ts apps/web/src/lib/voice/call-state.test.ts apps/web/src/lib/voice/finish-call.ts apps/web/src/lib/voice/finish-call.test.ts
git commit -m "feat(voice): record voice minutes for every call Sofía talked to (callerSpoke or a meaningful outcome, never turn_count)"
```

---

### Task 4: The SMS leg for automation texts

**Files:**
- Modify: `apps/web/src/lib/automations/send-sms.ts` (whole file shown)
- Test: `apps/web/src/lib/automations/send-sms.test.ts` (+6, 2 edited)

**Interfaces:**
- Consumes: `recordUsageSafely`, `smsBillable` (Task 2); `segmentsFor` (`lib/sms/segments.ts:28`). Verified today: `sendAutomationSms` at `send-sms.ts:62-106` (send at 89, body with the opt-out disclosure built at 82); `markAutomationSmsSent` at 113-122; seven callers, each calling `markAutomationSmsSent` on its success path after its own stamp: `instant-reply.ts:203`, `passes/appointment-confirm.ts:170`, `passes/no-show-nudge.ts:238`, `passes/quote-followup.ts:226`, `passes/referral-ask.ts:286`, `passes/review-request.ts:259`, `passes/sms-reminder.ts:133`. `stampWithRetry` never throws (`lib/booking/stamp-retry.ts:68-86`).
- Produces: `SentSms = { messageId: string; providerMessageId: string; usage: { segments: number; sentAt: Date } | null }`, `usage` worked out AFTER the send's `try` by a helper that never throws (a delivered text can never be marked failed, or re-sent, because of its usage). `markAutomationSmsSent` records `{ accountId, meter: "sms", quantity: usage.segments, occurredAt: usage.sentAt, sourceRef: "message:<messageId>" }` on `ctx.db` when `usage` is not null.

- [ ] **Step 1: Write the failing tests**

In `apps/web/src/lib/automations/send-sms.test.ts`:

(a) add `recordUsage: vi.fn(),` to the hoisted mocks:

```ts
const dbMocks = vi.hoisted(() => ({
  ensureConversation: vi.fn(), createMessage: vi.fn(), updateMessageStatus: vi.fn(), recordUsage: vi.fn(),
}));
```

(b) add these imports below `import { sendAutomationSms, markAutomationSmsSent, smsCooldownActive } from "./send-sms";`:

```ts
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { segmentsFor } from "@/lib/sms/segments";
```

(c) EDIT the first test of `sendAutomationSms — write then send` (the fake provider now reports no usage). Replace

```ts
    expect(await sendAutomationSms(ctx(), input(onProviderFailure))).toEqual({ messageId: "msg_1", providerMessageId: "s1" });
```

with

```ts
    expect(await sendAutomationSms(ctx(), input(onProviderFailure))).toEqual({ messageId: "msg_1", providerMessageId: "s1", usage: null });
```

(d) EDIT `marks the row sent with the provider id, and swallows its own failure`: replace its two `SentSms` literals

```ts
    await markAutomationSmsSent(ctx(), "acct_1", { messageId: "msg_1", providerMessageId: "s1" }, "test");
```

and

```ts
    await expect(markAutomationSmsSent(ctx(), "acct_1", { messageId: "msg_1", providerMessageId: "s1" }, "test")).resolves.toBeUndefined();
```

with

```ts
    await markAutomationSmsSent(ctx(), "acct_1", { messageId: "msg_1", providerMessageId: "s1", usage: null }, "test");
```

and

```ts
    await expect(markAutomationSmsSent(ctx(), "acct_1", { messageId: "msg_1", providerMessageId: "s1", usage: null }, "test")).resolves.toBeUndefined();
```

(e) append at the end of the file:

```ts

describe("usage: what an automation text bills (client billing)", () => {
  const realCtx = (redirectTo?: string): PassContext => ({
    ...ctx(),
    sms: () => ({ isFake: false, ...(redirectTo === undefined ? {} : { redirectTo }), send: (...a: unknown[]) => smsSend(...a) }),
  });

  it("a text a real carrier accepted carries its segments counted on the body AS SENT, disclosure included (mutation: count input.body → 1 segment, FAILS)", async () => {
    const body = "x".repeat(150);
    expect(segmentsFor(body).segments).toBe(1);
    const sent = await sendAutomationSms(realCtx(), { ...input(), body });
    expect(sent.usage).toEqual({ segments: 2, sentAt: expect.any(Date) });
  });

  it("a fake provider, or a real one redirected to a developer's phone, delivered nothing to the customer: no usage (mutation: drop the smsBillable gate → FAILS)", async () => {
    expect((await sendAutomationSms(ctx(), input())).usage).toBeNull();
    expect((await sendAutomationSms(realCtx("+19565550199"), input())).usage).toBeNull();
  });

  it("a throw while working out a DELIVERED text's usage never marks it failed or gets it re-sent: the send resolves, usage null, no attempt marker (mutation: compute usage inside the send's try → the row is marked failed and the send rejects, FAILS; compute it after the try with no catch → the send rejects, the pass never stamps and re-sends next tick, FAILS)", async () => {
    const onProviderFailure = vi.fn(async () => {});
    const explodes: PassContext = {
      ...ctx(),
      sms: () => ({
        get isFake(): boolean { throw new Error("provider shape changed"); },
        send: (...a: unknown[]) => smsSend(...a),
      }),
    };
    expect(await sendAutomationSms(explodes, input(onProviderFailure)))
      .toEqual({ messageId: "msg_1", providerMessageId: "s1", usage: null });
    expect(smsSend).toHaveBeenCalledTimes(1);
    expect(dbMocks.updateMessageStatus).not.toHaveBeenCalled();
    expect(onProviderFailure).not.toHaveBeenCalled();
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("usage not worked out for message msg_1"));
  });

  it("markAutomationSmsSent records the segments against the message, AFTER the status write (mutation: record before the status write → call order FAILS)", async () => {
    const sentAt = new Date("2026-09-09T14:00:05Z");
    await markAutomationSmsSent(ctx(), "acct_1", { messageId: "msg_1", providerMessageId: "s1", usage: { segments: 3, sentAt } }, "test");
    expect(dbMocks.recordUsage).toHaveBeenCalledWith(expect.anything(), {
      accountId: "acct_1", meter: "sms", quantity: 3, occurredAt: sentAt, sourceRef: "message:msg_1",
    });
    expect(dbMocks.updateMessageStatus.mock.invocationCallOrder[0]!).toBeLessThan(dbMocks.recordUsage.mock.invocationCallOrder[0]!);
  });

  it("records nothing for a text with no usage, and a failing usage write never escapes (mutation: ignore usage: null → FAILS; remove recordUsageSafely's catch → rejects, FAILS)", async () => {
    await markAutomationSmsSent(ctx(), "acct_1", { messageId: "msg_1", providerMessageId: "s1", usage: null }, "test");
    expect(dbMocks.recordUsage).not.toHaveBeenCalled();
    dbMocks.recordUsage.mockRejectedValue(new Error("usage_events is down"));
    await expect(markAutomationSmsSent(ctx(), "acct_1",
      { messageId: "msg_1", providerMessageId: "s1", usage: { segments: 1, sentAt: NOW } }, "test")).resolves.toBeUndefined();
    expect(dbMocks.recordUsage).toHaveBeenCalledTimes(1);
  });

  it("every module that sends with sendAutomationSms( also CALLS markAutomationSmsSent(, where its usage is recorded; comments do not count (mutation: delete one pass's markAutomationSmsSent call → that file is named here, FAILS; replace the call with a comment that names it → still named, FAILS)", () => {
    const ROOT = fileURLToPath(new URL(".", import.meta.url));
    const walk = (dir: string): string[] => readdirSync(dir).flatMap((name) => {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) return walk(full);
      return full.endsWith(".ts") && !full.endsWith(".test.ts") ? [full] : [];
    });
    const rel = (f: string) => f.slice(ROOT.length).replace(/\\/g, "/");
    // The CODE of a file: block comments, then line comments, stripped (a
    // `//` right after a `:` is a URL, not a comment), so a doc comment that
    // names the call cannot satisfy the scan.
    const code = (f: string) => readFileSync(f, "utf-8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/(^|[^:])\/\/.*$/gm, "$1");
    // Guards the stripper itself: a phrase only send-sms.ts's doc comment holds.
    expect(readFileSync(join(ROOT, "send-sms.ts"), "utf-8")).toContain("AFTER the dedupe stamp");
    expect(code(join(ROOT, "send-sms.ts"))).not.toContain("AFTER the dedupe stamp");
    const senders = walk(ROOT).filter((f) => rel(f) !== "send-sms.ts" && code(f).includes("sendAutomationSms("));
    // Guards the fixture: the seven callers on 2026-09-25. A new caller reds
    // here until it is added, which is the moment to check it bills.
    expect(senders.map(rel).sort()).toEqual([
      "instant-reply.ts", "passes/appointment-confirm.ts", "passes/no-show-nudge.ts", "passes/quote-followup.ts",
      "passes/referral-ask.ts", "passes/review-request.ts", "passes/sms-reminder.ts",
    ]);
    expect(senders.filter((f) => !code(f).includes("markAutomationSmsSent(")).map(rel)).toEqual([]);
  });
});
```

Count: **+6**, 2 edited.

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm --filter web exec vitest run src/lib/automations/send-sms.test.ts`
Expected: FAIL: the edited first test sees no `usage` key, and the usage tests fail on `usage` being undefined / `recordUsage` never called. (The scan test passes already: it pins today's callers.)

- [ ] **Step 3: Rewrite `send-sms.ts`**

Replace the whole of `apps/web/src/lib/automations/send-sms.ts` with:

```ts
import { ensureConversation, createMessage, updateMessageStatus } from "@bis/db";
import { SMS_RETRY_COOLDOWN_MS } from "./caps";
import { withOptOut } from "@/lib/sms/opt-out";
import { segmentsFor } from "@/lib/sms/segments";
import { recordUsageSafely, smsBillable } from "@/lib/billing/usage";
import type { SmsProvider } from "@/lib/sms/types";
import type { PassContext } from "./context";

/**
 * What the two helpers below actually need: the client and the LAZY SMS
 * getter — not the whole cron context. A full PassContext satisfies this
 * (it is a Pick), so every pass keeps handing over `ctx` unchanged; the
 * inline instant reply (instant-reply.ts, Milestone C) builds exactly these
 * two fields and never constructs the email provider it has no use for.
 */
export type SmsSendContext = Pick<PassContext, "db" | "sms">;

/** The messages rows automations write are the platform's, not a person's —
 *  the same actor shape the voice text-back uses ("voice"/"ai"). */
export const AUTOMATION_ACTOR_ID = "automation";
export const AUTOMATION_ACTOR_TYPE = "system" as const;

export type AutomationSmsInput = {
  accountId: string;
  contactId: string;
  /** E.164, already through toE164. */
  to: string;
  /** The account's live number, from resolveSmsSender. */
  from: string;
  body: string;
  /** The language THIS message is written in, which decides the language of
   *  the opt-out disclosure appended to it. Optional and defaulting to "en"
   *  because most passes have no locale to offer — the scheduled recipes
   *  (reminders, review requests, no-show nudges) compose English copy end to
   *  end. The form instant reply is the exception and passes the submission's
   *  own locale, so a person who filled the form in Spanish is not told how
   *  to opt out in English. */
  language?: "en" | "es";
  /** Runs on a PROVIDER failure, after the message row is marked failed: the
   *  recipe's own attempt marker (`*_sms_failed_at`) goes here. Best effort —
   *  its own failure is logged, never thrown, and never re-raised over the
   *  provider's error. */
  onProviderFailure: () => Promise<void>;
};

export type SentSms = {
  messageId: string;
  providerMessageId: string;
  /**
   * What this text bills (client billing), or null when the provider put
   * nothing in front of the customer: the fake provider, or a real one
   * redirected to a developer's phone (`smsBillable`). Segments are counted
   * on the body AS SENT, the opt-out disclosure included, because that is
   * what the carrier bills. Recorded by markAutomationSmsSent, never here.
   */
  usage: { segments: number; sentAt: Date } | null;
};

/**
 * WRITE THEN SEND — sendSmsAction's discipline, shared by every SMS-capable
 * pass so the ordering below is written once (the review-request tests are
 * the proof it did not change when it moved here):
 *   1. the provider FIRST: `ctx.sms()` is lazy and throws in production while
 *      TELNYX_API_KEY is unset; constructing it after the row would leave a
 *      failed text in the customer's conversation on every tick for a
 *      misconfiguration that has nothing to do with the customer;
 *   2. the conversation and the message row, so a provider failure is a
 *      visible failed text in the inbox, not a silent gap;
 *   3. the send;
 *   4. on failure: mark the row failed, write the recipe's attempt marker
 *      (the 24h cooldown's input for the morning-band recipes; the text
 *      reminder writes it and never reads it, the instant reply writes
 *      none), rethrow so the caller counts `failed` and stamps nothing.
 * The caller stamps its dedupe column and THEN calls markAutomationSmsSent.
 */
export async function sendAutomationSms(ctx: SmsSendContext, input: AutomationSmsInput): Promise<SentSms> {
  const sms = ctx.sms();
  // THE choke point for every unprompted text this platform sends on a
  // schedule — reminders, review requests, no-show nudges, and the inline
  // form instant reply, which routes through here too. Putting the opt-out
  // disclosure at this one line is what makes "every programme message says
  // how to stop it" a property of the system rather than a rule each pass has
  // to remember; a new pass gets it by calling this function.
  //
  // Computed ONCE, above the row write, and the same string is both stored
  // and sent. Appending it at the send call instead would leave the operator
  // reading a shorter message in the conversation than the customer received.
  //
  // The language comes from the caller, defaulting to English — see the field
  // comment on `language`. The default is for the scheduled passes, which
  // compose English copy and have no locale to offer; the instant reply
  // already picks a body by locale and hands that same locale over, so its
  // Spanish reply does not end in an English sentence. When a scheduled pass
  // learns a locale, thread it through here rather than leaving it defaulting
  // quietly.
  const body = withOptOut(input.body, input.language);
  const convo = await ensureConversation(
    ctx.db, input.accountId, input.contactId, AUTOMATION_ACTOR_ID, AUTOMATION_ACTOR_TYPE);
  const { id: messageId } = await createMessage(ctx.db, input.accountId, {
    conversationId: convo.id, channel: "sms", direction: "outbound", body,
  }, AUTOMATION_ACTOR_ID, AUTOMATION_ACTOR_TYPE);
  let providerMessageId: string;
  try {
    ({ providerMessageId } = await sms.send({ to: input.to, from: input.from, body }));
  } catch (e) {
    const message = e instanceof Error ? e.message : "unknown send failure";
    try {
      await updateMessageStatus(ctx.db, input.accountId, messageId, "failed", { error: message },
        AUTOMATION_ACTOR_ID, AUTOMATION_ACTOR_TYPE);
    } catch (statusErr) {
      console.error(`automation sms: could not mark message ${messageId} failed: ${String(statusErr)}`);
    }
    try {
      await input.onProviderFailure();
    } catch (markErr) {
      console.error(`automation sms: could not record the failed attempt for message ${messageId}: ${String(markErr)}`);
    }
    throw e;
  }
  // AFTER the send's try, never inside it: the text is delivered, and
  // nothing about its usage may reach the catch above (which marks the row
  // failed) or reject this function (the caller would then never stamp, and
  // re-send the text next tick). billedUsage never throws.
  return { messageId, providerMessageId, usage: billedUsage(sms, body, messageId) };
}

/**
 * What a delivered automation text bills, or null. NEVER throws: a failure
 * here (a provider whose shape changed, a counting bug) loses one text's
 * usage, logged, rather than the text's `sent` status or its dedupe stamp.
 */
function billedUsage(
  sms: Pick<SmsProvider, "isFake" | "redirectTo">, body: string, messageId: string,
): SentSms["usage"] {
  try {
    return smsBillable(sms) ? { segments: segmentsFor(body).segments, sentAt: new Date() } : null;
  } catch (e) {
    console.error(`automation sms: usage not worked out for message ${messageId}, so it will not bill: ${String(e)}`);
    return null;
  }
}

/**
 * Best effort, AFTER the dedupe stamp: the text is gone and stamped, and a
 * failure here must not re-label a delivered text "failed" (that invites a
 * duplicate send). `what` names the recipe in the log line.
 *
 * Also where an automation text is BILLED (client billing): after the
 * caller's stamp and the status write, never between the send and the stamp,
 * where a ledger round trip would widen the window in which a crash re-sends
 * the text. `recordUsageSafely` never throws. Every caller of
 * sendAutomationSms calls this on its success path; send-sms.test.ts's scan
 * keeps that true.
 */
export async function markAutomationSmsSent(
  ctx: SmsSendContext, accountId: string, sent: SentSms, what: string,
): Promise<void> {
  try {
    await updateMessageStatus(ctx.db, accountId, sent.messageId, "sent",
      { providerMessageId: sent.providerMessageId }, AUTOMATION_ACTOR_ID, AUTOMATION_ACTOR_TYPE);
  } catch (e) {
    console.error(`${what}: text sent but message ${sent.messageId} not marked sent: ${String(e)}`);
  }
  if (sent.usage) {
    await recordUsageSafely(ctx.db, {
      accountId, meter: "sms", quantity: sent.usage.segments,
      occurredAt: sent.usage.sentAt, sourceRef: `message:${sent.messageId}`,
    }, what);
  }
}

/**
 * Whether a booking's last FAILED text attempt is still inside the cooldown
 * (SMS_RETRY_COOLDOWN_MS). The pass counts a hold as `skippedRecentFailure`
 * and leaves the row unstamped, so it is simply due again once the marker
 * ages out. A marker in the future or one that cannot be read HOLDS — the
 * house rule for a stamp that cannot be trusted is the safe direction.
 */
export function smsCooldownActive(smsFailedAt: string | null, now: Date): boolean {
  if (smsFailedAt === null) return false;
  const t = new Date(smsFailedAt).getTime();
  if (!Number.isFinite(t)) return true;
  return now.getTime() - t < SMS_RETRY_COOLDOWN_MS;
}
```

- [ ] **Step 4: Run them to verify they pass, and that nothing downstream broke**

Run: `pnpm --filter web exec vitest run src/lib/automations/send-sms.test.ts`
Expected: `Tests  16 passed (16)` (10 → 16).

Run: `pnpm --filter web exec vitest run src/lib/automations src/lib/forms "src/app/(dashboard)/dashboard/accounts/[accountId]/automations"`
Expected: all pass. (The pass tests' providers are `isFake: true`, so `usage` is null and nothing new is recorded there.)

Run: `pnpm --filter web typecheck`
Expected: exit 0.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/automations/send-sms.ts apps/web/src/lib/automations/send-sms.test.ts
git commit -m "feat(automations): bill each automation text's segments in markAutomationSmsSent, after the stamp"
```

---

### Task 5: The SMS legs for direct sends: the missed-call text-back and the composer reply

Both record the same way (in the `finally` of the `sent` status write that follows the provider send, G11 — review correction 2026-09-25: the code blocks below show the first version, which recorded BEFORE that write; the shipped files are the source of truth), so they are one reviewable change. The automation leg (Task 4) records elsewhere, for a different reason (G10), which is why it is its own task.

**Files:**
- Modify: `apps/web/src/lib/voice/textback.ts` (`deliverTextback`)
- Create: `apps/web/src/lib/voice/textback.test.ts` (5 tests)
- Modify: `apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/conversations/actions.ts` (`sendSmsAction`)
- Modify: `apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/conversations/actions.test.ts` (+6)

**Interfaces:**
- Consumes: `recordUsageSafely`, `smsBillable` (Task 2); `segmentsFor`; `serviceDb` from `@bis/db`. Verified today: `deliverTextback` at `textback.ts:229-269` (send at 243, `sent` write at 264-265, outer catch at 266-268); both callers deliver through it (`finish-call.ts:630`, `handoff-result/route.ts:294`); `sendSmsAction` at `conversations/actions.ts:112` (message row 157-159, send 167-176, `sent` write 178, on `dbForRequest()`).
- Produces: one `sms` usage row per delivered text-back / composer text: `{ accountId, meter: "sms", quantity: segmentsFor(body).segments, occurredAt: <now>, sourceRef: "message:<messageId>" }`; the text-back on its own service client, the composer on `serviceDb()` built inside the wrapper.

- [ ] **Step 1: Write the failing tests**

Create `apps/web/src/lib/voice/textback.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const dbMocks = vi.hoisted(() => ({ updateMessageStatus: vi.fn(), recordUsage: vi.fn() }));
vi.mock("@bis/db", async (importOriginal) => ({ ...(await importOriginal<object>()), ...dbMocks }));
const sms = vi.hoisted(() => ({
  isFake: false as boolean, redirectTo: undefined as string | undefined, send: vi.fn(),
}));
vi.mock("@/lib/sms", () => ({
  getSmsProvider: () => ({ isFake: sms.isFake, redirectTo: sms.redirectTo, send: (...a: unknown[]) => sms.send(...a) }),
}));

import type { serviceDb } from "@bis/db";
import { segmentsFor } from "@/lib/sms/segments";
import { deliverTextback, type PendingTextback } from "./textback";

/**
 * The text-back's usage leg. One leg covers both callers (finishCall and the
 * handoff-result route), because both deliver through deliverTextback.
 */
const DB = { tag: "service-db" } as unknown as ReturnType<typeof serviceDb>;
const BODY = "Sorry we missed you. ".repeat(9).trim();
const pending: PendingTextback = { messageId: "m_tb", conversationId: "cv1", to: "+19562921696", from: "+19565550100", body: BODY };

beforeEach(() => {
  sms.isFake = false;
  sms.redirectTo = undefined;
  sms.send.mockReset().mockResolvedValue({ providerMessageId: "sm1" });
  dbMocks.updateMessageStatus.mockReset().mockResolvedValue(undefined);
  dbMocks.recordUsage.mockReset().mockResolvedValue("recorded");
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("deliverTextback — usage (client billing)", () => {
  it("a delivered text-back records its segments against the message, on the same service client (mutation: bill 1 per text instead of segmentsFor → FAILS)", async () => {
    expect(segmentsFor(BODY).segments).toBe(2);
    await deliverTextback(DB, "a1", pending, "finishCall call1");
    expect(dbMocks.recordUsage).toHaveBeenCalledTimes(1);
    expect(dbMocks.recordUsage).toHaveBeenCalledWith(DB, {
      accountId: "a1", meter: "sms", quantity: 2, occurredAt: expect.any(Date), sourceRef: "message:m_tb",
    });
  });

  it("a fake provider, or a real one redirected to a developer's phone, records nothing (mutation: drop the smsBillable gate → FAILS)", async () => {
    sms.isFake = true;
    await deliverTextback(DB, "a1", pending, "finishCall call1");
    sms.isFake = false;
    sms.redirectTo = "+19565550199";
    await deliverTextback(DB, "a1", pending, "finishCall call1");
    expect(sms.send).toHaveBeenCalledTimes(2);
    expect(dbMocks.recordUsage).not.toHaveBeenCalled();
  });

  it("a text the carrier refused records nothing (mutation: record before the send → FAILS)", async () => {
    sms.send.mockRejectedValue(new Error("carrier rejected"));
    await deliverTextback(DB, "a1", pending, "finishCall call1");
    expect(dbMocks.recordUsage).not.toHaveBeenCalled();
  });

  it("the usage row lands even when the 'sent' write then fails (mutation: record after that write → FAILS)", async () => {
    dbMocks.updateMessageStatus.mockRejectedValue(new Error("db down"));
    await expect(deliverTextback(DB, "a1", pending, "finishCall call1")).resolves.toBeUndefined();
    expect(dbMocks.recordUsage).toHaveBeenCalledTimes(1);
  });

  it("a failing usage write never stops the 'sent' write or reaches the text-back's failure log (mutation: remove recordUsageSafely's catch → the outer catch logs 'text-back failed' and skips 'sent', FAILS)", async () => {
    dbMocks.recordUsage.mockRejectedValue(new Error("usage_events is down"));
    await expect(deliverTextback(DB, "a1", pending, "finishCall call1")).resolves.toBeUndefined();
    expect(dbMocks.updateMessageStatus).toHaveBeenCalledWith(DB, "a1", "m_tb", "sent", { providerMessageId: "sm1" }, "voice", "ai");
    expect(console.error).not.toHaveBeenCalledWith(expect.stringContaining("text-back failed"));
  });
});
```

Count: **5 tests**.

In `apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/conversations/actions.test.ts`:

(a) Replace the SMS provider mock

```ts
const smsSendMock = vi.fn();
vi.mock("@/lib/sms", () => ({
  getSmsProvider: () => ({ send: (...a: unknown[]) => smsSendMock(...a) }),
}));
```

with

```ts
const smsSendMock = vi.fn();
// The service client the usage write goes through, and the provider's
// billing-relevant shape. Hoisted: the two mock factories read them.
const svc = vi.hoisted(() => ({
  db: { tag: "service-db" }, throws: false,
  provider: { isFake: false as boolean, redirectTo: undefined as string | undefined },
}));
vi.mock("@/lib/sms", () => ({
  getSmsProvider: () => ({
    isFake: svc.provider.isFake, redirectTo: svc.provider.redirectTo,
    send: (...a: unknown[]) => smsSendMock(...a),
  }),
}));
```

(b) Replace the `@bis/db` mock (lines 85-94) with

```ts
vi.mock("@bis/db", () => ({
  brandLogoUrl: (path: string) => `https://cdn.test/${path}`,
  getContact: async () => contactRow,
  ensureConversation: async () => ({ id: "convo_1" }),
  // vi.fn(), not a plain async function: the write-then-send ordering test
  // below needs invocationCallOrder against the SMS provider's send mock.
  createMessage: vi.fn(async () => ({ id: "msg_1" })),
  updateMessageStatus: vi.fn(),
  clearUnreadCount: vi.fn(),
  serviceDb: () => {
    if (svc.throws) throw new Error("SUPABASE_SERVICE_ROLE_KEY is missing");
    return svc.db;
  },
  recordUsage: vi.fn(),
}));
```

(c) Replace

```ts
import { createMessage, updateMessageStatus } from "@bis/db";

const createMessageMock = vi.mocked(createMessage);
const updateMessageStatusMock = vi.mocked(updateMessageStatus);
```

with

```ts
import { createMessage, updateMessageStatus, recordUsage } from "@bis/db";

const createMessageMock = vi.mocked(createMessage);
const updateMessageStatusMock = vi.mocked(updateMessageStatus);
const recordUsageMock = vi.mocked(recordUsage);
```

(d) At the end of `beforeEach` (after `contactRow.phone = "9565551234";`), add

```ts
  svc.throws = false;
  svc.provider.isFake = false;
  svc.provider.redirectTo = undefined;
  recordUsageMock.mockReset().mockResolvedValue("recorded");
```

(e) Append at the end of the file:

```ts

describe("sendSmsAction — usage (client billing)", () => {
  beforeEach(() => { vi.spyOn(console, "error").mockImplementation(() => {}); });

  it("a sent text records its segments on the SERVICE client, against the message row (mutation: pass the request's RLS client → FAILS)", async () => {
    await sendSmsAction("acct_1", fd({ contactId: "contact_1", body: "On our way" }));
    expect(recordUsageMock).toHaveBeenCalledTimes(1);
    expect(recordUsageMock).toHaveBeenCalledWith(svc.db, {
      accountId: "acct_1", meter: "sms", quantity: 1, occurredAt: expect.any(Date), sourceRef: "message:msg_1",
    });
  });

  it("a 161-character text bills two segments (mutation: bill 1 per text → FAILS)", async () => {
    await sendSmsAction("acct_1", fd({ contactId: "contact_1", body: "a".repeat(161) }));
    expect(recordUsageMock).toHaveBeenCalledWith(svc.db, expect.objectContaining({ quantity: 2 }));
  });

  it("a text the carrier refused records nothing (mutation: record before the send → FAILS)", async () => {
    smsSendMock.mockRejectedValue(new Error("carrier rejected"));
    await expect(sendSmsAction("acct_1", fd({ contactId: "contact_1", body: "On our way" }))).rejects.toThrow("carrier rejected");
    expect(recordUsageMock).not.toHaveBeenCalled();
  });

  it("a fake provider, or a real one redirected to a developer's phone, records nothing (mutation: drop the smsBillable gate → FAILS)", async () => {
    svc.provider.isFake = true;
    await sendSmsAction("acct_1", fd({ contactId: "contact_1", body: "On our way" }));
    svc.provider.isFake = false;
    svc.provider.redirectTo = "+19565550199";
    await sendSmsAction("acct_1", fd({ contactId: "contact_1", body: "On our way" }));
    expect(smsSendMock).toHaveBeenCalledTimes(2);
    expect(recordUsageMock).not.toHaveBeenCalled();
  });

  it("the usage row lands even when the final 'sent' write throws (mutation: record after that write → FAILS)", async () => {
    updateMessageStatusMock.mockRejectedValue(new Error("db down"));
    await expect(sendSmsAction("acct_1", fd({ contactId: "contact_1", body: "On our way" }))).rejects.toThrow("db down");
    expect(recordUsageMock).toHaveBeenCalledTimes(1);
  });

  it("a failing usage write, even a service client that cannot be built, leaves the action resolving and the row marked sent (mutation: remove the catch, or call serviceDb() outside it → rejects, FAILS)", async () => {
    svc.throws = true;
    await expect(sendSmsAction("acct_1", fd({ contactId: "contact_1", body: "On our way" }))).resolves.toBeUndefined();
    svc.throws = false;
    recordUsageMock.mockRejectedValue(new Error("usage_events is down"));
    await expect(sendSmsAction("acct_1", fd({ contactId: "contact_1", body: "On our way" }))).resolves.toBeUndefined();
    expect(updateMessageStatusMock.mock.calls.map((c) => c[3])).toEqual(["sent", "sent"]);
  });
});
```

Count: **+6**.

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm --filter web exec vitest run src/lib/voice/textback.test.ts "src/app/(dashboard)/dashboard/accounts/[accountId]/conversations/actions.test.ts"`
Expected: FAIL: `recordUsage` never called in the positive tests. (The refusal and never-escapes tests may pass already.)

- [ ] **Step 3: The text-back leg**

In `apps/web/src/lib/voice/textback.ts`:

(a) After `import { withOptOut } from "@/lib/sms/opt-out";` add

```ts
import { segmentsFor } from "@/lib/sms/segments";
import type { SmsProvider } from "@/lib/sms/types";
import { recordUsageSafely, smsBillable } from "@/lib/billing/usage";
```

(b) In `deliverTextback`, replace

```ts
    let providerMessageId: string;
    try {
      ({ providerMessageId } = await getSmsProvider().send({ to, from, body }));
    } catch (sendError) {
```

with

```ts
    let providerMessageId: string;
    let provider: SmsProvider;
    try {
      provider = getSmsProvider();
      ({ providerMessageId } = await provider.send({ to, from, body }));
    } catch (sendError) {
```

and replace

```ts
      throw sendError;
    }
    await updateMessageStatus(db, accountId, messageId, "sent",
      { providerMessageId }, ACTOR_ID, ACTOR_TYPE);
```

with

```ts
      throw sendError;
    }
    // USAGE (client billing): the text reached the customer, so its segments
    // bill. BEFORE the `sent` write, which may throw into the catch below and
    // must not take a delivered text's usage with it; recordUsageSafely never
    // throws, so it cannot stop that write either. This one leg covers both
    // callers (finishCall and the handoff-result route).
    if (smsBillable(provider)) {
      await recordUsageSafely(db, {
        accountId, meter: "sms", quantity: segmentsFor(body).segments,
        occurredAt: new Date(), sourceRef: `message:${messageId}`,
      }, label);
    }
    await updateMessageStatus(db, accountId, messageId, "sent",
      { providerMessageId }, ACTOR_ID, ACTOR_TYPE);
```

- [ ] **Step 4: The composer leg**

In `apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/conversations/actions.ts`:

(a) Replace

```ts
import {
  getContact, ensureConversation, createMessage, updateMessageStatus,
  clearUnreadCount,
} from "@bis/db";
```

with

```ts
import {
  getContact, ensureConversation, createMessage, updateMessageStatus,
  clearUnreadCount, serviceDb,
} from "@bis/db";
```

and after `import { getSmsProvider } from "@/lib/sms";` add

```ts
import type { SmsProvider } from "@/lib/sms/types";
import { segmentsFor } from "@/lib/sms/segments";
import { recordUsageSafely, smsBillable } from "@/lib/billing/usage";
```

(b) In `sendSmsAction`, replace

```ts
  let providerMessageId: string;
  try {
    ({ providerMessageId } = await getSmsProvider().send({ to, from: gate.from, body }));
  } catch (e) {
```

with

```ts
  let providerMessageId: string;
  let provider: SmsProvider;
  try {
    provider = getSmsProvider();
    ({ providerMessageId } = await provider.send({ to, from: gate.from, body }));
  } catch (e) {
```

and replace

```ts
  await updateMessageStatus(db, accountId, messageId, "sent", { providerMessageId }, userId);

  revalidatePath(`/dashboard/accounts/${accountId}/conversations`);
  revalidatePath(`/dashboard/accounts/${accountId}/contacts/${contactId}`);
}
```

with

```ts
  // USAGE (client billing): the text is out the door to the customer, so its
  // segments bill. On serviceDb(), not `db`: 0051 lets only service_role
  // write usage_events (a client must not be able to write, or skip, its own
  // bill), the same service-after-requireAccountAccess shape
  // automations/actions.ts uses for its service-only table. The account is
  // the one requireAccountAccess passed above and the message id is the row
  // this action just wrote. Passed as a GETTER so a missing service key is
  // caught inside recordUsageSafely too. BEFORE the `sent` write below, which
  // is allowed to throw and must not take a delivered text's usage with it.
  if (smsBillable(provider)) {
    await recordUsageSafely(() => serviceDb(), {
      accountId, meter: "sms", quantity: segmentsFor(body).segments,
      occurredAt: new Date(), sourceRef: `message:${messageId}`,
    }, `sendSmsAction ${messageId}`);
  }

  await updateMessageStatus(db, accountId, messageId, "sent", { providerMessageId }, userId);

  revalidatePath(`/dashboard/accounts/${accountId}/conversations`);
  revalidatePath(`/dashboard/accounts/${accountId}/contacts/${contactId}`);
}
```

(The `sendEmailAction` block above it ends in a different pair of `revalidatePath` lines, contacts first, so this match is unique.)

- [ ] **Step 5: Run them to verify they pass**

Run: `pnpm --filter web exec vitest run src/lib/voice/textback.test.ts "src/app/(dashboard)/dashboard/accounts/[accountId]/conversations/actions.test.ts" src/lib/voice/finish-call.test.ts src/app/api/voice/texml/handoff-result/route.test.ts`
Expected: all pass; textback 5, composer actions 20 (14 → 20), finish-call 92 (its text-back provider is `isFake: true`, so it records no SMS usage).

Run: `pnpm --filter web typecheck && pnpm --filter web lint`
Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/lib/voice/textback.ts apps/web/src/lib/voice/textback.test.ts "apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/conversations/actions.ts" "apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/conversations/actions.test.ts"
git commit -m "feat(sms): bill delivered text-backs and composer replies by segment, before the sent write"
```

---

### Task 6: The concierge leg (one website chat, billed when Sofía's first reply succeeds)

**Files:**
- Modify: `apps/web/src/app/api/concierge/[publicId]/turn/route.ts`
- Test: `apps/web/src/app/api/concierge/[publicId]/turn/route.test.ts` (+5)

**Review correction (2026-09-25): the leg runs in `after()`.** The first version awaited the usage write before returning the visitor's reply, so a stalled ledger write delayed the reply up to recordUsageSafely's 5 s. It now runs in `after()` from `next/server` (the voice routes' precedent: `api/voice/incoming/route.ts`, `api/voice/texml/route.ts`, `handoff-result/route.ts`), the lazy import and its own try inside the callback; the tests mock `after` as a recorder and FLUSH it before every assertion, including the "records nothing" ones. Added: a first turn where the model only called `capture_lead` (empty text, lead filed) bills exactly one (probe: `answered = Boolean(reply)` → red). The code blocks below show the first version; the shipped files are the source of truth.

**Interfaces:**
- Consumes: `recordUsageSafely` (Task 2), imported LAZILY and inside the leg's own `try`: this route keeps `@bis/db` off module scope (`route.ts:113-123`'s rule: a module-scope `@bis/db` import breaks `next build`'s page-data collection), and `lib/billing/usage.ts` imports `@bis/db` at its module scope. Verified today: `db = serviceDb()` at 131; turn 1 is `!priorId` (195); `createConciergeConversation` at 288; the model call at 395-430, whose failure answers 503 (428-429); `spoken`'s condition at 485 (`reply || ((toolArgs && filed) ? strings.captured : strings.unavailable)`); the transcript append at 499-517; the success response at 519.
- Produces: `{ accountId: profile.account_id, meter: "ai_chats", quantity: 1, occurredAt: <now>, sourceRef: "conversation:<conversationId>" }`, once per conversation, on the TURN-1 request whose reply succeeded (G13, danlo 2026-09-25). A start that fails (model 503, timeout, an empty completion the visitor reads as "unavailable") records nothing; a later turn never attempts it.

- [ ] **Step 1: Write the failing tests**

In `apps/web/src/app/api/concierge/[publicId]/turn/route.test.ts`:

(a) Replace

```ts
  recordAutomationLog: vi.fn(async () => undefined),
}));
```

with

```ts
  recordAutomationLog: vi.fn(async () => undefined),
  recordUsage: vi.fn(async () => "recorded"),
}));
```

(b) In `beforeEach`, after `dbFns.recordAutomationLog.mockResolvedValue(undefined);`, add

```ts
  dbFns.recordUsage.mockResolvedValue("recorded");
```

(c) Append at the end of the file:

```ts

describe("POST /api/concierge/[publicId]/turn — usage: one website chat, billed when Sofía's FIRST reply succeeds (client billing)", () => {
  it("a first turn Sofía answered records ONE website chat against the conversation (mutation: drop the usage leg → FAILS)", async () => {
    const res = await firstTurn();
    expect(res.status).toBe(200);
    expect(dbFns.recordUsage).toHaveBeenCalledTimes(1);
    expect(dbFns.recordUsage).toHaveBeenCalledWith(expect.anything(), {
      accountId: "a1", meter: "ai_chats", quantity: 1, occurredAt: expect.any(Date), sourceRef: "conversation:c1",
    });
  });

  it("a first turn whose model call FAILS (an OpenAI outage's 503) records nothing, though the conversation row exists (mutation: record at createConciergeConversation → FAILS)", async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 503, json: async () => ({}) });
    const res = await firstTurn();
    expect(res.status).toBe(503);
    expect(dbFns.createConciergeConversation).toHaveBeenCalledTimes(1);
    expect(dbFns.recordUsage).not.toHaveBeenCalled();
  });

  it("a first turn whose completion is EMPTY (the visitor reads the 'unavailable' line) records nothing (mutation: gate on the model call returning alone → FAILS)", async () => {
    fetchMock.mockResolvedValue(modelReplies(""));
    const res = await firstTurn();
    expect(res.status).toBe(200);
    expect((await res.json() as { reply: string }).reply).toBe(conciergeStrings("en").unavailable);
    expect(dbFns.recordUsage).not.toHaveBeenCalled();
  });

  it("a later turn, answered, records nothing: only turn 1 ever attempts it (mutation: drop the turn-1 gate → FAILS)", async () => {
    const res = await laterTurn();
    expect(res.status).toBe(200);
    expect(dbFns.recordUsage).not.toHaveBeenCalled();
  });

  it("a failing usage write leaves the visitor's answer untouched (mutation: remove recordUsageSafely's catch AND the leg's own try → the route's outer catch answers 503, FAILS)", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    dbFns.recordUsage.mockRejectedValue(new Error("usage_events is down"));
    const res = await firstTurn();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ conversationId: "c1", reply: "Yes, we do.", ended: false, closing: "" });
  });
});
```

Count: **+5**.

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm --filter web exec vitest run "src/app/api/concierge/[publicId]/turn/route.test.ts"`
Expected: FAIL: the first test (`recordUsage` never called). The other four pass already (nothing records yet); they are the regression guards, and their named mutations are what the reviewer probes.

- [ ] **Step 3: Add the leg**

In `apps/web/src/app/api/concierge/[publicId]/turn/route.ts`, replace

```ts
      log("transcript append failed", { conversationId, error: String(e) });
    }

    return quiet(conversationId, spoken, false);
```

with

```ts
      log("transcript append failed", { conversationId, error: String(e) });
    }

    // USAGE (client billing): ONE `ai_chats` row per conversation, recorded
    // when Sofía's FIRST reply has succeeded (danlo, 2026-09-25: a failed
    // start, e.g. the model call's 503 during an OpenAI outage, never
    // bills). Every refusal and the model call are above this line, so none
    // of them can reach it. "Succeeded" is `spoken`'s own condition: the
    // model wrote a reply, or a lead was filed this turn; an empty completion
    // that fell back to `strings.unavailable` is not an answer.
    //
    // Turn 1 only (`!priorId`): a later turn never attempts it. The unique
    // (meter, source_ref) on `conversation:<id>` is the backstop, not the
    // gate. recordUsageSafely never throws, and the LAZY import (this
    // handler's rule, lines 113-123: lib/billing/usage imports @bis/db at its
    // module scope) sits inside this leg's own try, so neither a ledger
    // failure nor a failed import can cost the visitor the answer below.
    const answered = Boolean(reply || (toolArgs && filed));
    if (!priorId && answered) {
      try {
        const { recordUsageSafely } = await import("@/lib/billing/usage");
        await recordUsageSafely(db, {
          accountId: profile.account_id, meter: "ai_chats", quantity: 1,
          occurredAt: new Date(), sourceRef: `conversation:${conversationId}`,
        }, `concierge ${conversationId}`);
      } catch (e) {
        log("usage leg failed", { conversationId, error: String(e) });
      }
    }

    return quiet(conversationId, spoken, false);
```

(The first `transcript append failed` log is the only one in the file, so the match is unique.)

- [ ] **Step 4: Run it to verify it passes**

Run: `pnpm --filter web exec vitest run "src/app/api/concierge/[publicId]/turn/route.test.ts"`
Expected: `Tests  48 passed (48)` (43 → 48).

Run: `pnpm --filter web typecheck`
Expected: exit 0.

- [ ] **Step 5: Commit**

```bash
git add "apps/web/src/app/api/concierge/[publicId]/turn/route.ts" "apps/web/src/app/api/concierge/[publicId]/turn/route.test.ts"
git commit -m "feat(concierge): record one website chat when Sofía's first reply succeeds"
```

---

### Task 7: `BillingGateway.reportMeterEvent`, the fake, and failure classification

**Files:**
- Modify: `apps/web/src/lib/billing/stripe-gateway.ts`
- Modify: `apps/web/src/lib/billing/fake-gateway.ts`
- Test: `apps/web/src/lib/billing/stripe-gateway.test.ts` (+11), create `apps/web/src/lib/billing/meter-event-failure.test.ts` (1)

**Interfaces:**
- Consumes: the installed `stripe` 22.6.2 (`Stripe.Billing.MeterEventCreateParams`, `stripe.billing.meterEvents.create(params, { idempotencyKey })`, verified by a strict typecheck today). Verified today: `BillingGateway` at `stripe-gateway.ts:24-30`, the adapter at 84-112; `FakeGateway` at `fake-gateway.ts:30-98`, `GatewayOp` at 3, `failOn` at 34, `step` at 39-46.
- Produces (used by Tasks 8 and 10):
  - `type MeterEventInput = { eventName: string; customerId: string; value: number; identifier: string; timestampSeconds: number }`
  - `meterEventParams(input: MeterEventInput): Stripe.Billing.MeterEventCreateParams`: `{ event_name, identifier, timestamp, payload: { stripe_customer_id, value: String(value) } }`; throws on a value that is not a positive whole number, a timestamp that is not whole seconds (non-integer, `<= 0`, or `>= 100_000_000_000`, i.e. milliseconds), and a customer id not starting `cus_`.
  - `BillingGateway.reportMeterEvent(input: MeterEventInput, idempotencyKey: string): Promise<void>`; the real adapter sends it with PER-REQUEST options `{ idempotencyKey, maxNetworkRetries: 0, timeout: METER_EVENT_TIMEOUT_MS }`, overriding the client's 2 retries × 20 s (M6: one send is bounded at 10 s, and the next tick is the retry, under the same key).
  - `METER_EVENT_TIMEOUT_MS = 10_000` (Task 8's budget reads it).
  - `meterEventFailureKind(e: unknown): "row" | "systemic"`: `"row"` for `.type` `StripeInvalidRequestError` or `StripeIdempotencyError`; `"systemic"` for everything else.
  - `FakeGateway.meterEvents: MeterEventInput[]` (one per ACCEPTED KEY: a new key records a new event even for an identifier already held, because A11 is unproven and the fake must be at least as strict as Stripe, `fake-gateway.ts:17-24`); `FakeGateway.failOn: { op; after?; error?: unknown } | null` (throws `error` when given).

- [ ] **Step 1: Write the failing tests**

In `apps/web/src/lib/billing/stripe-gateway.test.ts`:

(a) Replace the `./stripe-gateway` import block (lines 5-8) with

```ts
import {
  billingGatewayFromEnv, priceCreateParams, PRODUCTION_SUPABASE_REF, stripeGateway, stripeKeyVerdict,
  STRIPE_API_VERSION, meterEventParams, meterEventFailureKind, METER_EVENT_TIMEOUT_MS,
  type StripeEnv, type MeterEventInput,
} from "./stripe-gateway";
```

(b) In `stubStripe`, replace

```ts
        create: vi.fn(async (p: { event_name: string }) => ({ id: "mtr_new", event_name: p.event_name })),
      },
    },
```

with

```ts
        create: vi.fn(async (p: { event_name: string }) => ({ id: "mtr_new", event_name: p.event_name })),
      },
      meterEvents: {
        create: vi.fn(async () => ({ object: "billing.meter_event", identifier: "u_1", livemode: false })),
      },
    },
```

(c) Append at the end of the file:

```ts

const EVENT: MeterEventInput = {
  eventName: "bis_sms_segments", customerId: "cus_1", value: 2, identifier: "u_1", timestampSeconds: 1790344800,
};

describe("meterEventParams (the usage mapping)", () => {
  it("sends the meter's event name, the row id as identifier, SECONDS, and a payload of strings under the meters' exact keys (mutation: value as a number → FAILS; payload key 'customer' → FAILS)", () => {
    expect(meterEventParams(EVENT)).toEqual({
      event_name: "bis_sms_segments", identifier: "u_1", timestamp: 1790344800,
      payload: { stripe_customer_id: "cus_1", value: "2" },
    });
  });

  it("refuses a value that is not a positive whole number before it can reach Stripe (mutation: drop the value guard → FAILS)", () => {
    for (const value of [0, -1, 1.5, Number.NaN]) {
      expect(() => meterEventParams({ ...EVENT, value })).toThrow(/value/);
    }
  });

  it("refuses a timestamp that is not whole seconds: a fraction, zero, or MILLISECONDS (mutation: drop the upper bound → a millisecond timestamp reaches Stripe, FAILS)", () => {
    expect(() => meterEventParams({ ...EVENT, timestampSeconds: 1790344800.5 })).toThrow(/timestampSeconds/);
    expect(() => meterEventParams({ ...EVENT, timestampSeconds: 0 })).toThrow(/timestampSeconds/);
    expect(() => meterEventParams({ ...EVENT, timestampSeconds: 1790344800000 })).toThrow(/timestampSeconds/);
  });

  it("refuses a customer id that is not a Stripe customer (mutation: drop the cus_ check → FAILS)", () => {
    expect(() => meterEventParams({ ...EVENT, customerId: "acct_1" })).toThrow(/customerId/);
  });
});

describe("stripeGateway.reportMeterEvent", () => {
  it("creates ONE meter event with the mapped params under the idempotency key, passing maxNetworkRetries: 0 and a 10 s timeout of its own (which does not fully suppress the SDK's own single automatic retry of a reset connection — see stripe-gateway.ts's comments), and returns nothing Stripe sent back (mutation: drop the options argument → FAILS; drop the per-request transport → the client's 2 retries × 20 s apply, one send can run about 61.5 s, FAILS)", async () => {
    const s = stubStripe();
    await expect(stripeGateway(s as unknown as Stripe).reportMeterEvent(EVENT, "bis-usage-u_1-cus_1")).resolves.toBeUndefined();
    expect(s.billing.meterEvents.create).toHaveBeenCalledTimes(1);
    expect(s.billing.meterEvents.create).toHaveBeenCalledWith(meterEventParams(EVENT), {
      idempotencyKey: "bis-usage-u_1-cus_1", maxNetworkRetries: 0, timeout: 10_000,
    });
    expect(METER_EVENT_TIMEOUT_MS).toBe(10_000);
  });
});

describe("meterEventFailureKind (does one row's failure stop the tick?)", () => {
  it("an invalid request or an idempotency mismatch is that row's problem; anything else stops the tick (mutation: 'row' for everything → FAILS; 'systemic' for everything → FAILS)", () => {
    const typed = (type: string) => Object.assign(new Error(type), { type });
    expect(meterEventFailureKind(typed("StripeInvalidRequestError"))).toBe("row");
    expect(meterEventFailureKind(typed("StripeIdempotencyError"))).toBe("row");
    for (const t of ["StripeRateLimitError", "StripeAuthenticationError", "StripePermissionError", "StripeConnectionError", "StripeAPIError"]) {
      expect(meterEventFailureKind(typed(t))).toBe("systemic");
    }
    expect(meterEventFailureKind(new Error("socket hang up"))).toBe("systemic");
    expect(meterEventFailureKind("not an error")).toBe("systemic");
    expect(meterEventFailureKind(null)).toBe("systemic");
  });
});

describe("FakeGateway meter events (at least as strict as Stripe: replay is A10; identifier dedupe, A11, is NOT assumed)", () => {
  it("the same key with the same event replays: no second event (mutation: record on replay → FAILS)", async () => {
    const g = new FakeGateway();
    await g.reportMeterEvent(EVENT, "k1");
    await g.reportMeterEvent(EVENT, "k1");
    expect(g.meterEvents).toEqual([EVENT]);
    expect(g.calls.filter((c) => c.op === "reportMeterEvent")).toHaveLength(2);
  });

  it("the same identifier under a NEW key records a SECOND event: A11 is unproven, so the fake assumes the costlier answer and a test can never lean on a dedupe Stripe may not do (mutation: dedupe by identifier → one event, FAILS)", async () => {
    const g = new FakeGateway();
    await g.reportMeterEvent(EVENT, "k1");
    await g.reportMeterEvent(EVENT, "k2");
    expect(g.meterEvents).toEqual([EVENT, EVENT]);
  });

  it("the same key with a different event throws, as Stripe's 400 does (mutation: replay without comparing → FAILS)", async () => {
    const g = new FakeGateway();
    await g.reportMeterEvent(EVENT, "k1");
    await expect(g.reportMeterEvent({ ...EVENT, value: 3 }, "k1")).rejects.toThrow(/idempotency/i);
  });

  it("runs the same guard as the real adapter, so a fractional value reaches nobody (mutation: skip meterEventParams in the fake → FAILS)", async () => {
    const g = new FakeGateway();
    await expect(g.reportMeterEvent({ ...EVENT, value: 1.5 }, "k1")).rejects.toThrow(/value/);
    expect(g.meterEvents).toEqual([]);
  });

  it("failOn throws the chosen error, which the usage report's tests use (mutation: ignore failOn.error → a generic Error, FAILS)", async () => {
    const g = new FakeGateway();
    const refused = Object.assign(new Error("No such customer"), { type: "StripeInvalidRequestError" });
    g.failOn = { op: "reportMeterEvent", error: refused };
    await expect(g.reportMeterEvent(EVENT, "k1")).rejects.toBe(refused);
  });
});
```

Count: **+11** (4 + 1 + 1 + 5).

Create `apps/web/src/lib/billing/meter-event-failure.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import Stripe from "stripe";
import { meterEventFailureKind } from "./stripe-gateway";

/**
 * stripe-gateway.test.ts mocks the `stripe` module, so its classification
 * test can only use Stripe-SHAPED errors. This file uses the REAL classes the
 * SDK throws, so a `.type` rename in an SDK upgrade cannot pass unnoticed.
 */
describe("meterEventFailureKind against the installed SDK's own error classes", () => {
  it("classifies the SDK's real errors (mutation: match on the class name via instanceof a local copy, or on .code → FAILS)", () => {
    const E = Stripe.errors;
    expect(meterEventFailureKind(new E.StripeInvalidRequestError({ message: "No such customer" }))).toBe("row");
    expect(meterEventFailureKind(new E.StripeIdempotencyError({ message: "Keys for idempotent requests" }))).toBe("row");
    expect(meterEventFailureKind(new E.StripeRateLimitError({ message: "Too many requests" }))).toBe("systemic");
    expect(meterEventFailureKind(new E.StripeAuthenticationError({ message: "Invalid API key" }))).toBe("systemic");
    expect(meterEventFailureKind(new E.StripeConnectionError({ message: "socket hang up" }))).toBe("systemic");
  });
});
```

Count: **1 test**.

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm --filter web exec vitest run src/lib/billing/stripe-gateway.test.ts src/lib/billing/meter-event-failure.test.ts`
Expected: FAIL: `meterEventParams is not a function` / `meterEventFailureKind is not a function`.

- [ ] **Step 3: The gateway**

In `apps/web/src/lib/billing/stripe-gateway.ts`:

(a) Replace the header line

```ts
 * Everything BIS asks of Stripe on the Plans page, behind one interface:
```

with

```ts
 * Everything BIS asks of Stripe (the Plans page, and the cron's usage
 * report), behind one interface:
```

(b) Replace the interface (lines 24-30) with

```ts
/** One usage row as a Stripe meter event (client billing, usage report). */
export type MeterEventInput = {
  eventName: string;
  customerId: string;
  /** Whole units. Sent as a string (Stripe's payload values are strings). */
  value: number;
  /** The usage row's id. Stripe documents uniqueness "within a rolling
   *  period of at least 24 hours"; whether a SECOND key carrying it is
   *  deduplicated is assumption A11, unproven until the e2e observes it. */
  identifier: string;
  timestampSeconds: number;
};

export interface BillingGateway {
  listActiveMeters(): Promise<StripeMeter[]>;
  createMeter(input: { eventName: string; displayName: string }, idempotencyKey: string): Promise<StripeMeter>;
  createProduct(input: { planId: string; name: string }, idempotencyKey: string): Promise<{ id: string }>;
  renameProduct(productId: string, name: string): Promise<void>;
  createPrice(spec: PriceSpec, idempotencyKey: string): Promise<{ id: string }>;
  reportMeterEvent(input: MeterEventInput, idempotencyKey: string): Promise<void>;
}
```

(c) After `priceCreateParams`'s closing brace (before `export function stripeGateway`), add

```ts

/** At or above this, a "seconds" timestamp is really milliseconds (in
 *  seconds it would be the year 5138). */
const MAX_TIMESTAMP_SECONDS = 100_000_000_000;

/**
 * One meter event's PER-REQUEST timeout, overriding the client's 2 retries ×
 * 20 s (billingGatewayFromEnv below), which could hold one send about 61.5 s.
 *
 * Assumption about the installed stripe SDK's transport (22.6.2; not
 * verified against the network, only its source), corrected from an earlier,
 * false claim of "no retry" and "a send that times out ends inside the
 * budget": `timeout` here is a SOCKET-IDLE timeout (`req.setTimeout`,
 * `cjs/net/NodeHttpClient.js:47`), not a hard deadline, so a response that
 * trickles in is never cut off by it; and `RequestSender.js`'s
 * `_shouldRetry` retries an `ECONNRESET`/`EPIPE` ONCE even when
 * `maxNetworkRetries: 0` is set (probed with a fake `httpClient`:
 * `ECONNRESET attempts=2 keys=["k1","k1"]` under the same idempotency key, so
 * it cannot double-bill). Worst case for one send that starts near a
 * budget's last-start point: ~10 s idle + reset + ~0.5 s backoff + ~10 s idle
 * ≈ 20.5 s past its start. The usage report's own budget (usage-report.ts)
 * is sized against that worst case, not against this constant alone.
 */
export const METER_EVENT_TIMEOUT_MS = 10_000;

/**
 * The usage mapping: one usage row → one v1 meter event. The payload keys
 * are the ones the meters were created with (customer_mapping
 * `stripe_customer_id`, value_settings `value`, createMeter below) and are
 * PERMANENT; the values are strings. Guarded here, like priceCreateParams,
 * so a fraction, a millisecond timestamp or a non-customer id never leaves
 * the process; real Stripe and FakeGateway both run this.
 */
export function meterEventParams(input: MeterEventInput): Stripe.Billing.MeterEventCreateParams {
  if (!Number.isSafeInteger(input.value) || input.value <= 0) {
    throw new Error(`meterEventParams: value must be a positive whole number, got ${input.value}`);
  }
  if (!Number.isSafeInteger(input.timestampSeconds) || input.timestampSeconds <= 0
    || input.timestampSeconds >= MAX_TIMESTAMP_SECONDS) {
    throw new Error(`meterEventParams: timestampSeconds must be whole seconds since the epoch, got ${input.timestampSeconds}`);
  }
  if (!input.customerId.startsWith("cus_")) {
    throw new Error(`meterEventParams: customerId must be a Stripe customer id (cus_), got ${input.customerId}`);
  }
  return {
    event_name: input.eventName, identifier: input.identifier, timestamp: input.timestampSeconds,
    payload: { stripe_customer_id: input.customerId, value: String(input.value) },
  };
}

/** Errors about THIS request; anything else (auth, permission, rate limit,
 *  network, Stripe 5xx) would fail the next row too (assumption A13). */
const ROW_SPECIFIC_ERRORS = new Set(["StripeInvalidRequestError", "StripeIdempotencyError"]);

/**
 * Does one meter event's failure stop the report for this tick? Read from
 * the SDK error's `.type` (each class sets it to its own name), not from
 * `instanceof`, so a test double and the real SDK classify alike.
 */
export function meterEventFailureKind(e: unknown): "row" | "systemic" {
  const type = typeof e === "object" && e !== null ? (e as { type?: unknown }).type : undefined;
  return typeof type === "string" && ROW_SPECIFIC_ERRORS.has(type) ? "row" : "systemic";
}
```

(d) In `stripeGateway`, replace

```ts
    async createPrice(spec, idempotencyKey) {
      const p = await stripe.prices.create(priceCreateParams(spec), { idempotencyKey });
      return { id: p.id };
    },
  };
}
```

with

```ts
    async createPrice(spec, idempotencyKey) {
      const p = await stripe.prices.create(priceCreateParams(spec), { idempotencyKey });
      return { id: p.id };
    },
    async reportMeterEvent(input, idempotencyKey) {
      // Per-request transport (stripe 22.6.2 RequestOptions), overriding the
      // client-wide settings that suit the Plans page, not a cron pass with
      // a budget. `maxNetworkRetries: 0` does not stop the SDK's own single
      // automatic retry of a reset/broken-pipe connection, and `timeout` is
      // a socket-idle timeout, not a hard deadline — see the worst-case note
      // on METER_EVENT_TIMEOUT_MS above.
      await stripe.billing.meterEvents.create(meterEventParams(input), {
        idempotencyKey, maxNetworkRetries: 0, timeout: METER_EVENT_TIMEOUT_MS,
      });
    },
  };
}
```

- [ ] **Step 4: The fake**

In `apps/web/src/lib/billing/fake-gateway.ts`:

(a) Replace the first two lines

```ts
import { priceCreateParams, type BillingGateway, type PriceSpec, type StripeMeter } from "./stripe-gateway";

export type GatewayOp = "listActiveMeters" | "createMeter" | "createProduct" | "renameProduct" | "createPrice";
```

with

```ts
import {
  priceCreateParams, meterEventParams, type BillingGateway, type MeterEventInput, type PriceSpec, type StripeMeter,
} from "./stripe-gateway";

export type GatewayOp =
  | "listActiveMeters" | "createMeter" | "createProduct" | "renameProduct" | "createPrice" | "reportMeterEvent";
```

(b) Replace

```ts
 *   failOn   throw on the (after + 1)th call of `op`, and every one after
 */
export class FakeGateway implements BillingGateway {
  meters: StripeMeter[] = [];
  readonly calls: Array<{ op: GatewayOp; key?: string; input?: unknown }> = [];
  readonly created: Array<{ op: GatewayOp; input: unknown; id: string }> = [];
  failOn: { op: GatewayOp; after?: number } | null = null;
```

with

```ts
 *   failOn   throw on the (after + 1)th call of `op`, and every one after;
 *            `error` when given (a Stripe-shaped error), else a plain Error
 *   meterEvents  the meter events Stripe would hold: one per accepted key,
 *            even when two keys carry one identifier (A11 is not assumed)
 */
export class FakeGateway implements BillingGateway {
  meters: StripeMeter[] = [];
  readonly calls: Array<{ op: GatewayOp; key?: string; input?: unknown }> = [];
  readonly created: Array<{ op: GatewayOp; input: unknown; id: string }> = [];
  readonly meterEvents: MeterEventInput[] = [];
  failOn: { op: GatewayOp; after?: number; error?: unknown } | null = null;
```

(c) In `step`, replace

```ts
      throw new Error(`fake Stripe refused ${op}`);
```

with

```ts
      throw this.failOn.error ?? new Error(`fake Stripe refused ${op}`);
```

(d) Before the class's final closing brace (after `createPrice`), add

```ts

  /**
   * A meter event. Same idempotency strictness as the creates above (A4):
   * the same key with the same event replays and records nothing; the same
   * key with a different event throws. A NEW key records a NEW event, even
   * when its identifier is one already held: whether Stripe dedupes an
   * identifier across keys is assumption A11, which only Task 10's e2e
   * observes, so this fake assumes the costlier answer (the rule in the
   * class doc: never looser than what it fakes). A test that passes here
   * cannot be relying on a dedupe Stripe may not do.
   */
  async reportMeterEvent(input: MeterEventInput, key: string): Promise<void> {
    meterEventParams(input);
    this.step("reportMeterEvent", input, key);
    const seen = this.replay.get(key);
    if (seen) {
      if (seen.op !== "reportMeterEvent" || !sameInput(seen.input, input)) {
        throw new Error(
          `fake Stripe: idempotency key "${key}" was already used for ${seen.op} with different parameters; ` +
            `Stripe itself rejects this with a 400 (assumption A4)`,
        );
      }
      return;
    }
    this.replay.set(key, { op: "reportMeterEvent", input, value: undefined });
    this.meterEvents.push({ ...input });
  }
```

- [ ] **Step 5: Run them to verify they pass**

Run: `pnpm --filter web exec vitest run src/lib/billing`
Expected: all pass; stripe-gateway 56 (45 → 56), meter-event-failure 1, usage 4, and the untouched billing files as before.

Run: `pnpm --filter web exec vitest run "src/app/(dashboard)/dashboard/plans"`
Expected: all pass (the Plans actions never call the new method).

Run: `pnpm --filter web typecheck && pnpm --filter web lint`
Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/lib/billing/stripe-gateway.ts apps/web/src/lib/billing/fake-gateway.ts apps/web/src/lib/billing/stripe-gateway.test.ts apps/web/src/lib/billing/meter-event-failure.test.ts
git commit -m "feat(billing): reportMeterEvent on the Stripe gateway and the fake, with row-vs-systemic failure classification"
```

---

### Task 8: The `usageReport` pass

**Files:**
- Modify: `apps/web/src/lib/automations/caps.ts` (append two constants)
- Create: `apps/web/src/lib/automations/passes/usage-report.ts`
- Test: `apps/web/src/lib/automations/passes/usage-report.test.ts` (14 tests)
- Modify: `apps/web/src/lib/automations/registry.ts` (append the pass)
- Modify: `apps/web/src/lib/automations/sentinel.test.ts` (2 tests edited, mocks extended)
- Modify: `apps/web/src/app/api/cron/reminders/route.test.ts` (mock extended, 7 whole-body equalities edited)

**Interfaces:**
- Consumes: from `@bis/db` (Task 1) `listBilledUsageAccounts`, `listReportableUsage`, `markUsageReported`, `staleUsageAccountIds`, `countExpiredUsage`; from Task 7 `billingGatewayFromEnv`, `meterEventFailureKind`; `METERS` (`stripe-catalog.ts:12-16`). Verified today: `Pass` / `PassContext` (`context.ts:15-56`), `runPasses` (`harness.ts:62-75`, each pass in its own try/catch), `PASSES` (`registry.ts:45`), the route's `maxDuration = 300` (`api/cron/reminders/route.ts:16`), `RELEASE_BUDGET_MS = 60_000` (`passes/release-held.ts:69`).
- Produces: `usageReportPass: Pass` with key `"usageReport"` and counters `{ reported, unstamped, alreadyStamped, failed, expired, staleAccounts, skippedNoStripe, stoppedOnCap, stoppedOnError, stoppedOnBudget }` (ten); `usageIdempotencyKey(rowId: string, customerId: string): string`; `USAGE_REPORT_TICK_CAP = 200`, `USAGE_REPORT_BUDGET_MS = 60_000`, `METER_EVENT_WORST_CASE_MS = 21_000`.
- Bounded per tick (G4, G7): the billed-account list (paged), reads of the oldest rows across all of them (one per 25 accounts; a repeat only after an account's refusal emptied a full read), then, AFTER the sends, the stale probe (at most 50 rows per stale account plus 50 per 50 billed accounts, G7) and one expired count per 25 accounts billed before the window's floor; never a read per account, never a read that grows with the backlog. (Review correction 2026-09-25.)

Every `@bis/db` export the pass uses is dereferenced INSIDE `run()`, never at module scope: the cron route test's `@bis/db` mock is a bare factory, which throws the moment an export it does not define is dereferenced.

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/lib/automations/passes/usage-report.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const dbMocks = vi.hoisted(() => ({
  listBilledUsageAccounts: vi.fn(), listReportableUsage: vi.fn(), markUsageReported: vi.fn(),
  countExpiredUsage: vi.fn(), staleUsageAccountIds: vi.fn(),
}));
vi.mock("@bis/db", async (importOriginal) => ({ ...(await importOriginal<object>()), ...dbMocks }));
const gatewayMocks = vi.hoisted(() => ({ fromEnv: vi.fn() }));
vi.mock("@/lib/billing/stripe-gateway", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  billingGatewayFromEnv: () => gatewayMocks.fromEnv(),
}));

import type { BilledUsageAccount, UsageRow } from "@bis/db";
import { FakeGateway } from "@/lib/billing/fake-gateway";
import { USAGE_REPORT_BUDGET_MS, USAGE_REPORT_TICK_CAP, METER_EVENT_WORST_CASE_MS } from "../caps";
import type { PassContext } from "../context";
import { usageReportPass } from "./usage-report";

const TICK = new Date("2026-09-25T15:00:00.000Z");
const A: BilledUsageAccount = { accountId: "acct_a", stripeCustomerId: "cus_a", billingStartedAt: "2026-09-20T10:00:00.123456+00:00" };
const B: BilledUsageAccount = { accountId: "acct_b", stripeCustomerId: "cus_b", billingStartedAt: "2026-06-01T00:00:00+00:00" };
const C: BilledUsageAccount = { accountId: "acct_c", stripeCustomerId: "cus_c", billingStartedAt: "2026-09-21T00:00:00+00:00" };

function usage(id: string, over: Partial<UsageRow> = {}): UsageRow {
  return {
    id, accountId: "acct_a", meter: "sms", quantity: 2, occurredAt: "2026-09-25T14:00:00.654321+00:00",
    sourceRef: `message:${id}`, reportedAt: null, createdAt: "2026-09-25T14:00:01+00:00", ...over,
  };
}
const SECS = 1790344800;   // 2026-09-25T14:00:00Z in seconds

const ctx = (): PassContext => ({
  db: {} as never, now: TICK, origin: "https://app.example.com",
  email: { isFake: true, send: vi.fn() }, sms: () => ({ isFake: true, send: vi.fn() }),
  quiet: async () => ({ enabled: false, start: "21:00", end: "08:00" }),
});
const EMPTY = {
  reported: 0, unstamped: 0, alreadyStamped: 0, failed: 0, expired: 0, staleAccounts: 0,
  skippedNoStripe: 0, stoppedOnCap: 0, stoppedOnError: 0, stoppedOnBudget: 0,
};
const stripeError = (type: string) => Object.assign(new Error(type), { type });

let fake: FakeGateway;
/**
 * The unreported rows the fake database holds, OLDEST FIRST. The read mock
 * does what the real read does that the pass relies on (only the accounts
 * asked for, oldest first, at most `limit`), and a stamp removes its row,
 * as the real read's `reported_at is null` would.
 */
let queue: UsageRow[];

beforeEach(() => {
  for (const fn of Object.values(dbMocks)) fn.mockReset();
  fake = new FakeGateway();
  queue = [];
  gatewayMocks.fromEnv.mockReset().mockReturnValue({ ok: true, gateway: fake });
  dbMocks.listBilledUsageAccounts.mockResolvedValue([]);
  dbMocks.listReportableUsage.mockImplementation(async (_db: unknown, accts: BilledUsageAccount[], _now: Date, limit: number) =>
    queue.filter((r) => accts.some((a) => a.accountId === r.accountId)).slice(0, limit));
  dbMocks.markUsageReported.mockImplementation(async (_db: unknown, id: string) => {
    const i = queue.findIndex((r) => r.id === id);
    if (i === -1) return false;
    queue.splice(i, 1);
    return true;
  });
  dbMocks.countExpiredUsage.mockResolvedValue(0);
  dbMocks.staleUsageAccountIds.mockResolvedValue([]);
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => { vi.restoreAllMocks(); });

describe("usageReportPass", () => {
  it("reports under the key usageReport; with no billed account it returns idle counters and never builds Stripe (mutation: build the gateway before listing accounts → FAILS)", async () => {
    expect(usageReportPass.key).toBe("usageReport");
    expect(await usageReportPass.run(ctx())).toEqual(EMPTY);
    expect(gatewayMocks.fromEnv).not.toHaveBeenCalled();
    expect(dbMocks.staleUsageAccountIds).not.toHaveBeenCalled();
    expect(dbMocks.countExpiredUsage).not.toHaveBeenCalled();
  });

  it("sends each row as one meter event: the meter's permanent event name, the account's customer, the quantity, the row id as identifier, occurred_at in SECONDS, under bis-usage-<row>-<customer> (mutation: timestamp in ms → refused by the guard, FAILS; random identifier → FAILS; key without the customer → FAILS)", async () => {
    dbMocks.listBilledUsageAccounts.mockResolvedValue([A]);
    queue = [usage("u1"), usage("u2", { meter: "voice_minutes", quantity: 3 }), usage("u3", { meter: "ai_chats", quantity: 1 })];
    expect(await usageReportPass.run(ctx())).toEqual({ ...EMPTY, reported: 3 });
    expect(fake.meterEvents).toEqual([
      { eventName: "bis_sms_segments", customerId: "cus_a", value: 2, identifier: "u1", timestampSeconds: SECS },
      { eventName: "bis_voice_minutes", customerId: "cus_a", value: 3, identifier: "u2", timestampSeconds: SECS },
      { eventName: "bis_ai_chats", customerId: "cus_a", value: 1, identifier: "u3", timestampSeconds: SECS },
    ]);
    expect(fake.calls.filter((c) => c.op === "reportMeterEvent").map((c) => c.key))
      .toEqual(["bis-usage-u1-cus_a", "bis-usage-u2-cus_a", "bis-usage-u3-cus_a"]);
  });

  it("stamps reported_at with the tick's now, only AFTER Stripe accepted (mutation: stamp before the send → call order FAILS)", async () => {
    dbMocks.listBilledUsageAccounts.mockResolvedValue([A]);
    queue = [usage("u1")];
    const send = vi.spyOn(fake, "reportMeterEvent");
    await usageReportPass.run(ctx());
    expect(dbMocks.markUsageReported).toHaveBeenCalledWith(expect.anything(), "u1", TICK);
    expect(send.mock.invocationCallOrder[0]!).toBeLessThan(dbMocks.markUsageReported.mock.invocationCallOrder[0]!);
  });

  it("reads the rows of EVERY billed account in ONE call asking for the whole cap, and sends them oldest first ACROSS accounts (mutation: a read per account in list order → acct_a's newer row goes first, FAILS)", async () => {
    dbMocks.listBilledUsageAccounts.mockResolvedValue([A, B]);
    queue = [usage("b1", { accountId: "acct_b", occurredAt: "2026-09-25T13:00:00+00:00" }), usage("a1")];
    expect(await usageReportPass.run(ctx())).toEqual({ ...EMPTY, reported: 2 });
    expect(dbMocks.listReportableUsage.mock.calls).toEqual([[expect.anything(), [A, B], TICK, USAGE_REPORT_TICK_CAP]]);
    expect(fake.meterEvents.map((e) => e.identifier)).toEqual(["b1", "a1"]);
  });

  it("counts rows too old for Stripe as expired with ONE call over every billed account, logs them, never sends them (mutation: skip the expired count → FAILS; one count per account → called twice, FAILS)", async () => {
    dbMocks.listBilledUsageAccounts.mockResolvedValue([A, B]);
    dbMocks.countExpiredUsage.mockResolvedValue(4);
    expect(await usageReportPass.run(ctx())).toEqual({ ...EMPTY, expired: 4 });
    expect(dbMocks.countExpiredUsage.mock.calls).toEqual([[expect.anything(), [A, B], TICK]]);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("older than Stripe accepts"));
  });

  it("runs the stale and expired bookkeeping AFTER the sends, so a stale backlog read never spends the send budget (mutation: run the bookkeeping before the send loop → call order FAILS)", async () => {
    dbMocks.listBilledUsageAccounts.mockResolvedValue([A]);
    queue = [usage("u1"), usage("u2")];
    const send = vi.spyOn(fake, "reportMeterEvent");
    expect(await usageReportPass.run(ctx())).toEqual({ ...EMPTY, reported: 2 });
    const lastSend = send.mock.invocationCallOrder.at(-1)!;
    expect(dbMocks.staleUsageAccountIds.mock.invocationCallOrder[0]!).toBeGreaterThan(lastSend);
    expect(dbMocks.countExpiredUsage.mock.invocationCallOrder[0]!).toBeGreaterThan(lastSend);
  });

  it("counts and logs the billed accounts with usage unreported for over a day, with ONE call over every billed account (mutation: drop the stale log → FAILS; one read per account → called twice, FAILS)", async () => {
    dbMocks.listBilledUsageAccounts.mockResolvedValue([A, B]);
    dbMocks.staleUsageAccountIds.mockResolvedValue(["acct_a"]);
    expect(await usageReportPass.run(ctx())).toEqual({ ...EMPTY, staleAccounts: 1 });
    expect(dbMocks.staleUsageAccountIds.mock.calls).toEqual([[expect.anything(), [A, B], TICK]]);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("unreported for over 24 hours on 1 billed account(s): acct_a"));
  });

  it("sends at most USAGE_REPORT_TICK_CAP rows a tick and says the cap stopped it (mutation: ask the read for more than the cap leaves → 230 sent, FAILS)", async () => {
    dbMocks.listBilledUsageAccounts.mockResolvedValue([A, B]);
    queue = [
      ...Array.from({ length: 150 }, (_, i) => usage(`a${i}`)),
      ...Array.from({ length: 80 }, (_, i) => usage(`b${i}`, { accountId: "acct_b" })),
    ];
    expect(await usageReportPass.run(ctx())).toEqual({ ...EMPTY, reported: 200, stoppedOnCap: 1 });
    expect(fake.meterEvents).toHaveLength(200);
    expect(dbMocks.listReportableUsage).toHaveBeenCalledTimes(1);
  });

  it("an account whose row Stripe refuses as an invalid request waits for the next tick, its refused row is NEVER stamped, and its rows can never fill the cap ahead of anyone else's: the full read is repeated without it (mutation: keep sending the refused account's rows → 200 attempts on acct_a and b1 never goes, FAILS; no second read → b1 starves, FAILS; stamp the refused row in the refusal's catch → a0 among the stamped ids, FAILS)", async () => {
    dbMocks.listBilledUsageAccounts.mockResolvedValue([A, B]);
    queue = [
      ...Array.from({ length: 200 }, (_, i) => usage(`a${i}`)),
      usage("b1", { accountId: "acct_b", occurredAt: "2026-09-25T14:30:00+00:00" }),
    ];
    const send = vi.spyOn(fake, "reportMeterEvent").mockRejectedValueOnce(stripeError("StripeInvalidRequestError"));
    expect(await usageReportPass.run(ctx())).toEqual({ ...EMPTY, reported: 1, failed: 1 });
    expect(send).toHaveBeenCalledTimes(2);
    expect(fake.meterEvents.map((e) => e.identifier)).toEqual(["b1"]);
    expect(dbMocks.listReportableUsage.mock.calls.map((c) => [(c[1] as BilledUsageAccount[]).map((a) => a.accountId), c[3]]))
      .toEqual([[["acct_a", "acct_b"], 200], [["acct_b"], 199]]);
    // Exactly the row Stripe accepted is stamped: a0, refused, stays
    // unreported, so a later tick sends it again once the refusal is fixed.
    expect(dbMocks.markUsageReported.mock.calls.map((c) => c[1])).toEqual(["b1"]);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("account acct_a's other rows wait for the next tick"));
  });

  it("a systemic failure (rate limit) stops the tick: counted once, nothing after it attempted (mutation: treat it as row-specific → FAILS)", async () => {
    dbMocks.listBilledUsageAccounts.mockResolvedValue([A, C]);
    queue = [usage("u1"), usage("u2"), usage("u3", { accountId: "acct_c" })];
    const send = vi.spyOn(fake, "reportMeterEvent").mockRejectedValueOnce(stripeError("StripeRateLimitError"));
    expect(await usageReportPass.run(ctx())).toEqual({ ...EMPTY, failed: 1, stoppedOnError: 1 });
    expect(send).toHaveBeenCalledTimes(1);
    expect(fake.meterEvents).toEqual([]);
    expect(dbMocks.markUsageReported).not.toHaveBeenCalled();
    expect(dbMocks.listReportableUsage).toHaveBeenCalledTimes(1);
  });

  it("with no usable Stripe key every billed account is skippedNoStripe and nothing is read or sent, but the stale and expired bookkeeping still runs (mutation: throw instead → the pass errors, FAILS)", async () => {
    dbMocks.listBilledUsageAccounts.mockResolvedValue([A, B]);
    gatewayMocks.fromEnv.mockReturnValue({ ok: false, reason: "missing" });
    expect(await usageReportPass.run(ctx())).toEqual({ ...EMPTY, skippedNoStripe: 2 });
    expect(dbMocks.listReportableUsage).not.toHaveBeenCalled();
    expect(dbMocks.staleUsageAccountIds).toHaveBeenCalledTimes(1);
    expect(dbMocks.countExpiredUsage).toHaveBeenCalledTimes(1);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("Stripe is not usable here (missing)"));
  });

  it("Stripe accepted but the stamp failed: counted unstamped, and the next tick resends under the SAME identifier and key, which the idempotent replay keeps to ONE event (mutation: a fresh key per attempt → two events, FAILS)", async () => {
    dbMocks.listBilledUsageAccounts.mockResolvedValue([A]);
    queue = [usage("u1")];
    dbMocks.markUsageReported.mockRejectedValueOnce(new Error("db down"));
    expect(await usageReportPass.run(ctx())).toEqual({ ...EMPTY, unstamped: 1 });
    expect(await usageReportPass.run(ctx())).toEqual({ ...EMPTY, reported: 1 });
    expect(fake.meterEvents).toHaveLength(1);
    expect(fake.calls.filter((c) => c.op === "reportMeterEvent").map((c) => c.key)).toEqual(["bis-usage-u1-cus_a", "bis-usage-u1-cus_a"]);
  });

  it("a stamp that finds the row already stamped (a concurrent tick) is alreadyStamped, never reported (mutation: count every resolved stamp as reported → FAILS)", async () => {
    dbMocks.listBilledUsageAccounts.mockResolvedValue([A]);
    queue = [usage("u1")];
    dbMocks.markUsageReported.mockResolvedValueOnce(false);
    expect(await usageReportPass.run(ctx())).toEqual({ ...EMPTY, alreadyStamped: 1 });
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("was already marked reported"));
  });

  it("stops STARTING sends once the budget less one send's worst case is spent, so a send that hits that worst case still ends inside the budget (mutation: check against the whole budget → u2 starts at 39 s, 2 sent, FAILS; drop the budget check → 3 sent, FAILS)", async () => {
    dbMocks.listBilledUsageAccounts.mockResolvedValue([A]);
    queue = [usage("u1"), usage("u2"), usage("u3")];
    // Date.now() calls the pass makes: `startedAt`, then one check before
    // each row. Row 1's check reads no time passed; row 2's reads exactly
    // the last moment a send may start, so rows 2 and 3 wait for the next tick.
    vi.spyOn(Date, "now")
      .mockReturnValueOnce(0)
      .mockReturnValueOnce(0)
      .mockReturnValueOnce(USAGE_REPORT_BUDGET_MS - METER_EVENT_WORST_CASE_MS);
    expect(await usageReportPass.run(ctx())).toEqual({ ...EMPTY, reported: 1, stoppedOnBudget: 1 });
    expect(fake.meterEvents.map((e) => e.identifier)).toEqual(["u1"]);
  });

  it("pins the cap at 200 rows, the budget at 60 seconds, the worst case at 21 seconds, and so the last send start at 39 seconds (mutation: change any → FAILS)", () => {
    expect(USAGE_REPORT_TICK_CAP).toBe(200);
    expect(USAGE_REPORT_BUDGET_MS).toBe(60_000);
    expect(METER_EVENT_WORST_CASE_MS).toBe(21_000);
    expect(USAGE_REPORT_BUDGET_MS - METER_EVENT_WORST_CASE_MS).toBe(39_000);
  });
});
```

Count: **14 tests**.

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter web exec vitest run src/lib/automations/passes/usage-report.test.ts`
Expected: FAIL at import: `Failed to resolve import "./usage-report"` (and the caps exports are missing).

- [ ] **Step 3: The caps**

Append to `apps/web/src/lib/automations/caps.ts`:

```ts

/**
 * THE USAGE REPORT's per-tick limits (client billing, spec section 3 flow 3).
 * Not a burst guard like the recipe caps: a backlog is simply sent over the
 * next ticks, and nothing is lost by waiting (each row carries its own
 * occurred_at, and Stripe takes events up to 35 days old).
 *
 *   USAGE_REPORT_TICK_CAP  meter events sent per tick. At an ASSUMED 0.2-0.3 s
 *     a round trip (not measured; the budget below bounds the pass whatever
 *     it costs), 200 rows take about 40-60 s. 200 every 15 minutes is 19,200
 *     a day, about 128 clients at an estimated 150 billable facts a day each.
 *     Past that, Stripe's v2 meter event stream is the next step.
 *   USAGE_REPORT_BUDGET_MS the pass's wall clock for sending. It stops
 *     STARTING sends at this minus METER_EVENT_WORST_CASE_MS below, so the
 *     last send still ends inside it even in that worst case. The release
 *     pass's own shape (RELEASE_BUDGET_MS): the two 60 s budgets leave the
 *     route's 300 s maxDuration room for every other pass.
 *   METER_EVENT_WORST_CASE_MS one send's worst case past its start, for the
 *     installed stripe SDK (22.6.2; see stripe-gateway.ts's
 *     METER_EVENT_TIMEOUT_MS/reportMeterEvent comments): its per-request
 *     `timeout` is a SOCKET-IDLE timeout, not a hard deadline, and its
 *     `RequestSender.js` retries a reset/broken-pipe connection ONCE even
 *     with `maxNetworkRetries: 0`. Two idle timeouts plus one retry's
 *     ~0.5 s backoff: 2 * 10_000 + 500 = 20,500 ms, rounded up to 21,000 for
 *     margin — hence the 60 − 21 = 39 s last-start point above.
 */
export const USAGE_REPORT_TICK_CAP = 200;
export const USAGE_REPORT_BUDGET_MS = 60_000;
export const METER_EVENT_WORST_CASE_MS = 21_000;
```

- [ ] **Step 4: The pass**

Create `apps/web/src/lib/automations/passes/usage-report.ts`:

```ts
import {
  listBilledUsageAccounts, listReportableUsage, markUsageReported, countExpiredUsage, staleUsageAccountIds,
} from "@bis/db";
import { billingGatewayFromEnv, meterEventFailureKind } from "@/lib/billing/stripe-gateway";
import { METERS } from "@/lib/billing/stripe-catalog";
import { USAGE_REPORT_BUDGET_MS, USAGE_REPORT_TICK_CAP, METER_EVENT_WORST_CASE_MS } from "../caps";
import type { Pass } from "../context";

/**
 * The Stripe idempotency key for one usage row's meter event. It covers
 * every parameter the request sends: event name, value and timestamp are
 * functions of the row, which never changes after it is recorded
 * (recordUsage never updates), and the customer is the only thing that can
 * differ between two sends of the same row.
 */
export function usageIdempotencyKey(rowId: string, customerId: string): string {
  return `bis-usage-${rowId}-${customerId}`;
}

/**
 * Client billing: usage rows → Stripe Billing Meter events (spec section 3
 * flow 3, section 4 "usage reporting failure"). Not a recipe; it sends
 * nothing to a customer. LAST in the registry: every SMS-sending pass runs
 * before it, so a text sent this tick is reported this tick.
 *
 * Per tick, every read bounded (never one per account, never one per
 * backlogged row):
 *   1. The billed accounts (a Stripe customer AND subscription). None → done;
 *      production is in that state until the first client subscribes.
 *   2. No usable Stripe key → `skippedNoStripe`, logged, then step 4, done.
 *      Not an error.
 *   3. The OLDEST unreported rows across every billed account, one meter
 *      event each, identifier = row id; reported_at stamped only after
 *      Stripe accepted. A refusal that is the row's (A13) is `failed`, and
 *      that ACCOUNT's other rows wait for the next tick; if the read was
 *      full, the pass reads again without the refused accounts, so their
 *      rows never fill the cap ahead of everyone else's. Any other failure
 *      stops the tick (the next row would fail the same way).
 *   4. Bookkeeping, whether or not Stripe is reachable, AFTER the sends so it
 *      never spends their budget, logged: stale accounts (usage unreported
 *      for over a day; the agency banner reads the same
 *      `staleUsageAccountIds`) — one read of at most STALE_PROBE_ROWS rows
 *      per stale account plus one per 50 billed accounts, so a backlog
 *      that grows while Stripe is down never grows the read — and expired
 *      rows (too old for Stripe to accept), one head-only count per 25
 *      accounts billed before the window's floor.
 *
 * A stamp that fails after Stripe accepted is `unstamped`: the next tick
 * resends the same row under the same identifier AND the same key, and
 * Stripe's idempotent replay keeps one event (A10). Identifier dedupe
 * across keys (A11) is NOT relied on. "reported" means Stripe RECEIVED the
 * event: it validates asynchronously (A12), and PR-4's nightly
 * reconciliation is the backstop.
 *
 * Every @bis/db export is dereferenced inside run(), never at module scope
 * (the cron route test's bare mock throws on a dereference).
 */
export const usageReportPass: Pass = {
  key: "usageReport",
  async run(ctx) {
    const c = {
      reported: 0, unstamped: 0, alreadyStamped: 0, failed: 0, expired: 0, staleAccounts: 0,
      skippedNoStripe: 0, stoppedOnCap: 0, stoppedOnError: 0, stoppedOnBudget: 0,
    };
    const accounts = await listBilledUsageAccounts(ctx.db);
    if (accounts.length === 0) return c;

    // Step 4, run last on both paths below.
    const bookkeeping = async () => {
      const stale = await staleUsageAccountIds(ctx.db, accounts, ctx.now);
      c.staleAccounts = stale.length;
      if (stale.length > 0) {
        console.error(`usage report: usage unreported for over 24 hours on ${stale.length} billed account(s): ${stale.join(", ")}`);
      }
      c.expired = await countExpiredUsage(ctx.db, accounts, ctx.now);
      if (c.expired > 0) {
        console.error(
          `usage report: ${c.expired} unreported usage row(s) of billed accounts are older than Stripe accepts (34 days); they will never be billed`,
        );
      }
    };

    const built = billingGatewayFromEnv();
    if (!built.ok) {
      c.skippedNoStripe = accounts.length;
      console.error(`usage report: Stripe is not usable here (${built.reason}); ${accounts.length} billed account(s) not reported this tick`);
      await bookkeeping();
      return c;
    }
    const gateway = built.gateway;
    const customerOf = new Map(accounts.map((a) => [a.accountId, a.stripeCustomerId]));

    // The last moment a send may START: the installed stripe SDK's transport
    // can run a send about METER_EVENT_WORST_CASE_MS past its start (a
    // socket-idle timeout retried once on a reset connection, per
    // stripe-gateway.ts's comments), so stopping this early keeps one
    // started by then inside the budget.
    const lastStartMs = USAGE_REPORT_BUDGET_MS - METER_EVENT_WORST_CASE_MS;
    const startedAt = Date.now();
    const refused = new Set<string>();
    let attempts = 0;
    let stop = false;
    while (!stop && attempts < USAGE_REPORT_TICK_CAP) {
      const want = USAGE_REPORT_TICK_CAP - attempts;
      const rows = await listReportableUsage(ctx.db, accounts.filter((a) => !refused.has(a.accountId)), ctx.now, want);
      let refusedHere = false;
      for (const row of rows) {
        if (refused.has(row.accountId)) continue;
        if (Date.now() - startedAt >= lastStartMs) {
          c.stoppedOnBudget = 1;
          console.error(`usage report: budget spent after ${attempts} send(s); the rest go next tick`);
          stop = true;
          break;
        }
        attempts++;
        const customerId = customerOf.get(row.accountId)!;
        try {
          await gateway.reportMeterEvent({
            eventName: METERS[row.meter].eventName, customerId,
            value: row.quantity, identifier: row.id,
            timestampSeconds: Math.floor(Date.parse(row.occurredAt) / 1000),
          }, usageIdempotencyKey(row.id, customerId));
        } catch (e) {
          c.failed++;
          if (meterEventFailureKind(e) === "row") {
            refused.add(row.accountId);
            refusedHere = true;
            console.error(
              `usage report: Stripe refused usage row ${row.id}; account ${row.accountId}'s other rows wait for the next tick: ${String(e)}`,
            );
            continue;
          }
          c.stoppedOnError = 1;
          console.error(`usage report: stopped for this tick after a Stripe failure on usage row ${row.id}: ${String(e)}`);
          stop = true;
          break;
        }
        try {
          if (await markUsageReported(ctx.db, row.id, ctx.now)) {
            c.reported++;
          } else {
            c.alreadyStamped++;
            console.error(`usage report: usage row ${row.id} was already marked reported (a concurrent tick); not counted here`);
          }
        } catch (e) {
          c.unstamped++;
          console.error(
            `usage report: Stripe has usage row ${row.id} but it was not marked reported; the next tick resends it under the same identifier and key: ${String(e)}`,
          );
        }
      }
      // A short read means nothing else is waiting; a full read with no
      // refusal spent the cap. Only a full read that a refusal left short of
      // the cap is read again, without the refused accounts.
      //
      // That re-read can return a row this tick already SENT whose stamp
      // then threw (`unstamped`): it is still unreported, so it is sent
      // again. Stripe replays it (same identifier, same key, every
      // parameter a function of an immutable row), so nothing is billed
      // twice, but the counters see it twice: one more attempt, and a
      // second `unstamped` or a `reported`. A stamp that resolves false is
      // `alreadyStamped`, never `reported`.
      if (stop || rows.length < want || !refusedHere) break;
    }
    if (!stop && attempts >= USAGE_REPORT_TICK_CAP) c.stoppedOnCap = 1;
    await bookkeeping();
    return c;
  },
};
```

- [ ] **Step 5: Run it to verify it passes**

Run: `pnpm --filter web exec vitest run src/lib/automations/passes/usage-report.test.ts`
Expected: `Tests  14 passed (14)`.

- [ ] **Step 6: Register it, and bring the two whole-registry suites along**

In `apps/web/src/lib/automations/registry.ts`, after `import { weeklyAgencyReportPass } from "./passes/weekly-agency-report";` add

```ts
import { usageReportPass } from "./passes/usage-report";
```

replace

```ts
 * Adding a recipe = one line here plus its pass file. Nothing else.
 */
export const PASSES: readonly Pass[] = [releaseHeldPass, remindersPass, followupsPass, reviewRequestPass, referralAskPass, noShowNudgePass, smsReminderPass, appointmentConfirmPass, reactivationPass, quoteFollowupPass, siteTrafficPass, weeklyClientReportPass, weeklyAgencyReportPass];
```

with

```ts
 * The usage report (client billing) runs LAST: every SMS-sending pass above
 * records its texts' usage as it sends, so running after all of them means
 * a text sent this tick reaches Stripe this tick. Nothing reads what it
 * writes (usage_events.reported_at).
 * Adding a recipe = one line here plus its pass file. Nothing else.
 */
export const PASSES: readonly Pass[] = [releaseHeldPass, remindersPass, followupsPass, reviewRequestPass, referralAskPass, noShowNudgePass, smsReminderPass, appointmentConfirmPass, reactivationPass, quoteFollowupPass, siteTrafficPass, weeklyClientReportPass, weeklyAgencyReportPass, usageReportPass];
```

In `apps/web/src/lib/automations/sentinel.test.ts`:

(a) in the hoisted `dbMocks`, replace

```ts
  // The release pass's own queue read — first in the registry, every tick.
  listReleasableHolds: vi.fn(),
}));
```

with

```ts
  // The release pass's own queue read — first in the registry, every tick.
  listReleasableHolds: vi.fn(),
  // The usage report, last in the registry: no account is billed here.
  listBilledUsageAccounts: vi.fn(), recordUsage: vi.fn(),
}));
```

(b) in `beforeEach`, after `dbMocks.listReleasableHolds.mockResolvedValue([]);` add

```ts
  dbMocks.listBilledUsageAccounts.mockResolvedValue([]);
  dbMocks.recordUsage.mockResolvedValue("recorded");
```

(c) EDIT the first test: after

```ts
    expect(results.weeklyAgencyReport).not.toHaveProperty("errored");
```

add

```ts
    expect(results.usageReport).toEqual(expect.objectContaining({ reported: 0, failed: 0 }));
    expect(results.usageReport).not.toHaveProperty("errored");
```

(d) EDIT the registry-order test: replace its title and list

```ts
  it("the registry runs the release pass, then reminders, follow-ups, review requests, referral asks, no-show nudges, text reminders, appointment confirmations, check-ins, quote follow-ups, site traffic, then the two weekly reports — the first three's order is the collision's contract", () => {
    expect(PASSES.map((p) => p.key)).toEqual(["releaseHeld", "reminders", "followups", "reviewRequests", "referralAsks", "noShowNudges", "smsReminders", "appointmentConfirms", "reactivations", "quoteFollowups", "siteTraffic", "weeklyClientReport", "weeklyAgencyReport"]);
  });
```

with

```ts
  it("the registry runs the release pass, then reminders, follow-ups, review requests, referral asks, no-show nudges, text reminders, appointment confirmations, check-ins, quote follow-ups, site traffic, the two weekly reports, then the usage report LAST — the first three's order is the collision's contract (mutation: move usageReport ahead of an SMS pass → FAILS)", () => {
    expect(PASSES.map((p) => p.key)).toEqual(["releaseHeld", "reminders", "followups", "reviewRequests", "referralAsks", "noShowNudges", "smsReminders", "appointmentConfirms", "reactivations", "quoteFollowups", "siteTraffic", "weeklyClientReport", "weeklyAgencyReport", "usageReport"]);
  });
```

In `apps/web/src/app/api/cron/reminders/route.test.ts`:

(a) in the `@bis/db` mock, replace

```ts
  listReleasableHolds: async () => [],
}));
```

with

```ts
  listReleasableHolds: async () => [],
  // The usage report (client billing), LAST in the registry. No account is
  // billed in this suite, so it reads account_billing once and returns its
  // idle counters. The rest THROW, this file's convention for a thing that
  // must not happen here, so an edit that bills an account fails loudly.
  listBilledUsageAccounts: async () => [],
  listReportableUsage: async () => { throw new Error("route.test: no account is billed"); },
  markUsageReported: async () => { throw new Error("route.test: no account is billed"); },
  staleUsageAccountIds: async () => { throw new Error("route.test: no account is billed"); },
  countExpiredUsage: async () => { throw new Error("route.test: no account is billed"); },
  // markAutomationSmsSent records each billable text's segments.
  recordUsage: async () => "recorded" as const,
}));
```

(b) after the `EMPTY_QUOTE_FOLLOWUPS` constant add

```ts
const EMPTY_USAGE_REPORT = {
  reported: 0, unstamped: 0, alreadyStamped: 0, failed: 0, expired: 0, staleAccounts: 0,
  skippedNoStripe: 0, stoppedOnCap: 0, stoppedOnError: 0, stoppedOnBudget: 0,
};
```

(c) the seven whole-body equalities gain the new key. With the Edit tool and `replace_all: true`, replace

```ts
weeklyAgencyReport: EMPTY_WEEKLY_AGENCY });
```

(five one-line bodies, at 333, 356, 379, 395 and 488 today) with

```ts
weeklyAgencyReport: EMPTY_WEEKLY_AGENCY, usageReport: EMPTY_USAGE_REPORT });
```

and, again with `replace_all: true`, replace

```ts
      weeklyAgencyReport: EMPTY_WEEKLY_AGENCY,
    });
```

(the two multi-line bodies, ending at 520 and 560 today) with

```ts
      weeklyAgencyReport: EMPTY_WEEKLY_AGENCY,
      usageReport: EMPTY_USAGE_REPORT,
    });
```

Confirm: `grep -c "usageReport: EMPTY_USAGE_REPORT" apps/web/src/app/api/cron/reminders/route.test.ts` prints `7`.

- [ ] **Step 7: Run everything the registry touches**

Run: `pnpm --filter web exec vitest run src/lib/automations src/app/api/cron`
Expected: all pass: usage-report 14, sentinel 5 (2 edited), cron route 30 (7 bodies edited), imports.test 2 (the pass imports no email/SMS provider), cron-coupling unchanged.

Run: `pnpm --filter web typecheck && pnpm --filter web lint`
Expected: exit 0.

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/lib/automations/caps.ts apps/web/src/lib/automations/passes/usage-report.ts apps/web/src/lib/automations/passes/usage-report.test.ts apps/web/src/lib/automations/registry.ts apps/web/src/lib/automations/sentinel.test.ts apps/web/src/app/api/cron/reminders/route.test.ts
git commit -m "feat(automations): the usageReport pass sends unreported usage to Stripe meters, last in the tick"
```

---

### Task 9: The stale-usage banner on the agency work queue

**Files:**
- Modify: `apps/web/src/lib/messages.ts` (three keys after `work.linesDown.action`)
- Create: `apps/web/src/components/usage-stale-banner.tsx`, `apps/web/src/components/usage-stale-banner.test.ts` (5 tests)
- Modify: `apps/web/src/app/(dashboard)/dashboard/work/page.tsx`, `page.test.ts` (+3, 1 edited)
- Modify: `apps/web/src/app/(dashboard)/dashboard/styleguide/page.tsx`

**Interfaces:**
- Consumes: `listAccountsWithStaleUsage(db, now)` (Task 1); `Notice` (`components/ui/notice.tsx`, tokens only). Verified today: `LineDownBanner` (`components/line-down-banner.tsx:41-65`: nothing at zero, `Notice tone="warn" role="note" className="text-foreground"`, a `Link`); mounted on `/dashboard/work` (`work/page.tsx:141`), whose count is read in the page's `Promise.all` with an in-element `.catch` that logs and returns 0 (60-70), after `requireAgency()` (23) on `serviceDb()` (25); `work/page.test.ts`'s bare `@bis/db` mock (53-59) and guard test (99-106); the styleguide's Line-down section (484-508).
- Produces: `UsageStaleBanner({ count }: { count: number })`; `m["work.usageStale.one"]`, `m["work.usageStale.many"]` (`{n}`), `m["work.usageStale.action"]`.

- [ ] **Step 1: Write the failing tests**

Create `apps/web/src/components/usage-stale-banner.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { m } from "@/lib/messages";
import { renderedText } from "@/lib/rendered-text";

vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: unknown }) =>
    createElement("a", { href }, children as never),
}));

const { UsageStaleBanner } = await import("./usage-stale-banner");

const render = (count: number) => renderToStaticMarkup(createElement(UsageStaleBanner, { count }));

describe("UsageStaleBanner", () => {
  it("renders NOTHING at zero, so it clears itself once usage reaches Stripe (mutation: always render → FAILS)", () => {
    expect(render(0)).toBe("");
  });

  it("says ONE client in the singular (mutation: always use the plural string → FAILS)", () => {
    expect(renderedText(render(1))).toContain(m["work.usageStale.one"]);
  });

  it("counts clients in the plural above one (mutation: as above → FAILS)", () => {
    expect(renderedText(render(3))).toContain(m["work.usageStale.many"].replace("{n}", "3"));
  });

  it("says it in WORDS, not by colour alone: the whole visible text is exactly the sentence and the link, nothing more or less (mutation: delete the sentence, keep the tint → FAILS; add or drop any word → FAILS)", () => {
    expect(renderedText(render(2)).replace(/\s+/g, " ").trim())
      .toBe(`${m["work.usageStale.many"].replace("{n}", "2")} ${m["work.usageStale.action"]}`);
  });

  it("links to the Plans page, where a missing or refused Stripe key is explained (mutation: drop or change the href → FAILS)", () => {
    expect(render(2)).toContain('href="/dashboard/plans"');
    expect(renderedText(render(2))).toContain(m["work.usageStale.action"]);
  });
});
```

Count: **5 tests**.

In `apps/web/src/app/(dashboard)/dashboard/work/page.test.ts`:

(a) after the `listPendingProposalsForAgencyMock` declaration add

```ts
// The stale-usage banner's read (client billing) — defaults to [] (no
// banner) so every case above is unaffected. Real signature:
// packages/db/src/usage.ts, `(db, now) => Promise<string[]>`.
const listAccountsWithStaleUsageMock = vi.fn<(db: unknown, now: Date) => Promise<string[]>>(async () => []);
```

(b) replace the `@bis/db` mock

```ts
vi.mock("@bis/db", () => ({
  serviceDb: () => FAKE_DB,
  listAgencyWork: () => listAgencyWorkMock(),
  countLinesTurningCallersAway: (db: unknown, sinceIso: string) =>
    countLinesTurningCallersAwayMock(db, sinceIso),
  listPendingProposalsForAgency: () => listPendingProposalsForAgencyMock(),
}));
```

with

```ts
vi.mock("@bis/db", () => ({
  serviceDb: () => FAKE_DB,
  listAgencyWork: () => listAgencyWorkMock(),
  countLinesTurningCallersAway: (db: unknown, sinceIso: string) =>
    countLinesTurningCallersAwayMock(db, sinceIso),
  listPendingProposalsForAgency: () => listPendingProposalsForAgencyMock(),
  listAccountsWithStaleUsage: (db: unknown, now: Date) => listAccountsWithStaleUsageMock(db, now),
}));
```

(c) add `import { renderedText } from "@/lib/rendered-text";` below `import { m } from "@/lib/messages";`

(d) in `beforeEach`, after `listPendingProposalsForAgencyMock.mockReset().mockResolvedValue([]);` add

```ts
    listAccountsWithStaleUsageMock.mockReset().mockResolvedValue([]);
```

(e) EDIT the guard test: replace

```ts
    expect(listPendingProposalsForAgencyMock).not.toHaveBeenCalled();
    expect(pipelineStagesInMock).not.toHaveBeenCalled();
  });
```

with

```ts
    expect(listPendingProposalsForAgencyMock).not.toHaveBeenCalled();
    expect(pipelineStagesInMock).not.toHaveBeenCalled();
    expect(listAccountsWithStaleUsageMock).not.toHaveBeenCalled();
  });
```

(f) append, inside the file's `describe("AgencyWorkPage", ...)` block, just before its final closing `});`:

```ts

  // Client billing: usage that has not reached Stripe in over a day.
  it("renders the stale-usage banner with the NUMBER of billed clients behind, reading the real clock (mutation: pass a fixed date → FAILS; always render → the next test FAILS)", async () => {
    listAccountsWithStaleUsageMock.mockResolvedValueOnce(["acct-a", "acct-b"]);
    const before = Date.now();
    const { default: AgencyWorkPage } = await import("./page");
    const text = renderedText(renderToStaticMarkup(await AgencyWorkPage()));
    const after = Date.now();
    expect(text).toContain(m["work.usageStale.many"].replace("{n}", "2"));
    expect(text).toContain(m["work.usageStale.action"]);
    expect(listAccountsWithStaleUsageMock).toHaveBeenCalledTimes(1);
    const now = listAccountsWithStaleUsageMock.mock.calls[0]![1];
    expect(now.getTime()).toBeGreaterThanOrEqual(before);
    expect(now.getTime()).toBeLessThanOrEqual(after);
  });

  it("renders no stale-usage banner when every billed client's usage has reached Stripe (mutation: mount the banner with a fixed count, or `staleUsage.length || 1` → FAILS)", async () => {
    const { default: AgencyWorkPage } = await import("./page");
    const text = renderedText(renderToStaticMarkup(await AgencyWorkPage()));
    expect(text).not.toContain(m["work.usageStale.action"]);
  });

  it("swallows a failed stale-usage read and still renders the whole queue (mutation: let the rejection propagate → FAILS)", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    listAgencyWorkMock.mockResolvedValueOnce([row()]);
    listAccountsWithStaleUsageMock.mockRejectedValueOnce(new Error("permission denied for table usage_events"));
    const { default: AgencyWorkPage } = await import("./page");
    const text = renderedText(renderToStaticMarkup(await AgencyWorkPage()));
    expect(text).toContain("Call back");
    expect(text).not.toContain(m["work.usageStale.action"]);
    expect(spy).toHaveBeenCalledWith(expect.stringContaining("stale-usage read failed"));
    spy.mockRestore();
  });
```

Count: **+3**, 1 edited.

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm --filter web exec vitest run src/components/usage-stale-banner.test.ts "src/app/(dashboard)/dashboard/work/page.test.ts"`
Expected: FAIL: `Failed to resolve import "./usage-stale-banner"`; in the page test the banner test fails (no banner, the mock never called).

- [ ] **Step 3: The copy**

In `apps/web/src/lib/messages.ts`, replace

```ts
  "work.linesDown.action": "See which",
```

with

```ts
  "work.linesDown.action": "See which",
  // The stale-usage banner (client billing), beside the one above on the
  // agency work queue. Counts CLIENTS, not rows: one client's backlog is one
  // problem to fix. Says what it costs (the usage is not on the bill yet)
  // and that it heals itself once the cause is fixed.
  "work.usageStale.one": "Usage for 1 client hasn't reached Stripe in over a day, so it isn't on their bill yet. We retry every 15 minutes.",
  "work.usageStale.many": "Usage for {n} clients hasn't reached Stripe in over a day, so it isn't on their bills yet. We retry every 15 minutes.",
  "work.usageStale.action": "Check the Stripe connection",
```

- [ ] **Step 4: The component**

Create `apps/web/src/components/usage-stale-banner.tsx`:

```tsx
import Link from "next/link";
import { Notice } from "@/components/ui/notice";
import { m } from "@/lib/messages";

/**
 * "Usage for 2 clients hasn't reached Stripe in over a day."
 *
 * LineDownBanner's design, deliberately: DERIVED, NEVER STORED. The count is
 * the billed accounts `listAccountsWithStaleUsage` (packages/db/src/usage.ts)
 * finds with a reportable usage row still unreported a day after it was
 * recorded. When the cause is fixed the next cron tick sends the rows and
 * this disappears on the next render: nothing to stamp, dismiss or forget,
 * so nothing that can go stale and lie. Rows too old for Stripe (34 days)
 * are not counted: they can never be sent, so they could never clear it;
 * the cron logs them instead.
 *
 * Renders NOTHING at zero. The link goes to the Plans page, which already
 * explains a missing or refused Stripe key, the usual cause.
 *
 * `text-foreground` and `role="note"`: LineDownBanner's own reasons (a full
 * sentence keeps the foreground colour; a standing fact is not an alert).
 */
export function UsageStaleBanner({ count }: { count: number }) {
  if (count <= 0) return null;
  const sentence =
    count === 1
      ? m["work.usageStale.one"]
      : m["work.usageStale.many"].replace("{n}", String(count));

  return (
    <Notice tone="warn" role="note" className="text-foreground">
      {sentence}{" "}
      <Link href="/dashboard/plans" className="underline underline-offset-2">
        {m["work.usageStale.action"]}
      </Link>
    </Notice>
  );
}
```

- [ ] **Step 5: Mount it**

In `apps/web/src/app/(dashboard)/dashboard/work/page.tsx`:

(a) replace

```ts
import { countLinesTurningCallersAway, listAgencyWork, listPendingProposalsForAgency, serviceDb } from "@bis/db";
import { PageHeader } from "@/components/page-header";
import { LineDownBanner } from "@/components/line-down-banner";
```

with

```ts
import {
  countLinesTurningCallersAway, listAccountsWithStaleUsage, listAgencyWork, listPendingProposalsForAgency, serviceDb,
} from "@bis/db";
import { PageHeader } from "@/components/page-header";
import { LineDownBanner } from "@/components/line-down-banner";
import { UsageStaleBanner } from "@/components/usage-stale-banner";
```

(b) replace

```ts
  const [rows, linesDown, proposals] = await Promise.all([
    listAgencyWork(db),
    countLinesTurningCallersAway(db, since).catch((e: unknown) => {
      console.error(`work queue: lines-down read failed, rendering no banner: ${String(e)}`);
      return 0;
    }),
    listPendingProposalsForAgency(db).catch((e: unknown) => {
      console.error(`work queue: proposals read failed, rendering no suggestions: ${String(e)}`);
      return [];
    }),
  ]);
```

with

```ts
  // The stale-usage read (client billing) joins the same Promise.all, and is
  // swallowed the same way as the lines-down read: a banner is cosmetic, the
  // queue is the page. `now` is the page's one clock reference.
  const [rows, linesDown, proposals, staleUsage] = await Promise.all([
    listAgencyWork(db),
    countLinesTurningCallersAway(db, since).catch((e: unknown) => {
      console.error(`work queue: lines-down read failed, rendering no banner: ${String(e)}`);
      return 0;
    }),
    listPendingProposalsForAgency(db).catch((e: unknown) => {
      console.error(`work queue: proposals read failed, rendering no suggestions: ${String(e)}`);
      return [];
    }),
    listAccountsWithStaleUsage(db, now).catch((e: unknown) => {
      console.error(`work queue: stale-usage read failed, rendering no banner: ${String(e)}`);
      return [] as string[];
    }),
  ]);
```

(c) replace

```tsx
        <LineDownBanner count={linesDown} />
```

with

```tsx
        <LineDownBanner count={linesDown} />
        <UsageStaleBanner count={staleUsage.length} />
```

- [ ] **Step 6: The styleguide**

In `apps/web/src/app/(dashboard)/dashboard/styleguide/page.tsx`, after `import { LineDownBanner } from "@/components/line-down-banner";` add

```ts
import { UsageStaleBanner } from "@/components/usage-stale-banner";
```

and replace

```tsx
        <Section title="Empty state" file="components/empty-state.tsx">
```

with

```tsx
        <Section title="Stale-usage banner" file="components/usage-stale-banner.tsx">
          {/* The line-down banner's design: derived, never stored, and the
              zero state renders NOTHING. DESIGN.md rule 3: the sentence is
              the marker, never the tint alone. */}
          <div className="w-full space-y-5">
            <p className="text-xs text-muted-foreground">
              Every billed client up to date renders nothing at all. The line below mounts
              <code className="font-mono">{"<UsageStaleBanner count={0} />"}</code>
              and nothing appears between this line and the next one.
            </p>
            <UsageStaleBanner count={0} />
            <div className="space-y-2">
              <p className="text-xs text-muted-foreground">One client — singular phrase, not a plural template</p>
              <UsageStaleBanner count={1} />
            </div>
            <div className="space-y-2">
              <p className="text-xs text-muted-foreground">Several — billed clients whose usage has waited over a day</p>
              <UsageStaleBanner count={3} />
            </div>
          </div>
        </Section>

        <Section title="Empty state" file="components/empty-state.tsx">
```

- [ ] **Step 7: Run them to verify they pass**

Run: `pnpm --filter web exec vitest run src/components/usage-stale-banner.test.ts "src/app/(dashboard)/dashboard/work/page.test.ts" src/lib/messages.test.ts src/components/line-down-banner.test.ts`
Expected: all pass; usage-stale-banner 5, work page 18 (15 → 18), messages unchanged (no string names a milestone).

Run: `pnpm --filter web typecheck && pnpm --filter web lint`
Expected: exit 0.

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/lib/messages.ts apps/web/src/components/usage-stale-banner.tsx apps/web/src/components/usage-stale-banner.test.ts "apps/web/src/app/(dashboard)/dashboard/work/page.tsx" "apps/web/src/app/(dashboard)/dashboard/work/page.test.ts" "apps/web/src/app/(dashboard)/dashboard/styleguide/page.tsx"
git commit -m "feat(work): derived banner when a billed client's usage hasn't reached Stripe in a day"
```

---

### Task 10: e2e: Stripe test mode counts our meter events once

**Files:**
- Create: `apps/web/e2e/usage-meter.spec.ts` (1 test)

**Interfaces:**
- Consumes: `stripeGateway`, `meterEventParams`, `STRIPE_API_VERSION`, `type MeterEventInput` (Task 7); `ensureMeters` (returns `Record<MeterKey, string>` of meter ids, `stripe-catalog.ts:26`), `METERS`; `stripe.billing.meters.listEventSummaries(meterId, { customer, start_time, end_time })` (verified against the installed 22.6.2 types, External facts); `STRIPE_SECRET_KEY` in the e2e job (`ci.yml:206`). `e2e/plans.spec.ts` is the precedent for importing app modules into a spec, the two `loadEnv` lines, the `NO_STRIPE` skip and the test-key prefix check.
- Produces: proof of A9 and A10 read from Stripe's own AGGREGATE (a 200 proves receipt only: validation is asynchronous, A12), and an observation of A11, each as a test annotation. No database, no account, never Test Client One. The customer name is a template literal that does NOT start with `E2E ` (so `e2e/fixtures/fixture-names.test.ts`, which collects stamped `E2E …` names for the sweep, has nothing to admit: this spec writes nothing the sweep could find).
- What the bound does (A16): each phase polls every 5 s for up to 120 s. A sum ABOVE what a correct dedupe implies, or one no outcome explains, FAILS the test. A sum that has simply not reached it yet by the bound PASSES with a `::warning` and an "unproven" annotation, because the e2e job must not go red on Stripe's aggregation lag; "unproven" is a PR-3 blocker instead (Task 11). Worst case the test takes about 4.5 minutes (two 120 s waits, a 30 s settle, the sends); the e2e job's limit is 30 minutes (`ci.yml:162`), and normally each wait ends as soon as the sum appears.

- [ ] **Step 1: Write the spec**

Create `apps/web/e2e/usage-meter.spec.ts`:

```ts
import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { config as loadEnv } from "dotenv";
import Stripe from "stripe";
import {
  STRIPE_API_VERSION, meterEventParams, stripeGateway, type MeterEventInput,
} from "../src/lib/billing/stripe-gateway";
import { ensureMeters, METERS } from "../src/lib/billing/stripe-catalog";

// Same two dotenv lines as plans.spec.ts.
loadEnv({ path: "apps/web/.env.local" });
loadEnv({ path: ".env.local" });

// Client billing, usage reporting: the one thing only a real Stripe can
// prove. The cron's usage report sends each usage row as a v1 meter event
// through `reportMeterEvent`; its unit tests run against FakeGateway, which
// is only as right as our reading of Stripe. A 200 from Stripe proves only
// that it RECEIVED an event (it validates asynchronously), so this reads
// Stripe's own aggregate for a throwaway customer and asserts the sum a
// correct dedupe implies:
//   phase 1: event 1 (2), the same request replayed under the same key, a
//            distinct event 2 (3)                       → 5    (A9, A10)
//   phase 2: event 1's identifier under a NEW key, then a sentinel (7)
//            → 12 if Stripe deduplicated it, 14 if it counted it again (A11)
//
// No database and no account: a throwaway Stripe TEST customer, deleted at
// the end. STRIPE TEST MODE ONLY: CI's target guard refuses a live key before
// any step runs, and this file re-checks the prefix before its first call.
// The e2e job has no CRON_SECRET, so the cron route itself is not driven here.
const STRIPE_KEY = (process.env.STRIPE_SECRET_KEY ?? "").trim();
const NO_STRIPE =
  "STRIPE_SECRET_KEY is not set, so BIS's usage meter event was NOT sent to Stripe test mode. Add the Stripe TEST secret key (sk_test_) as the repository secret CI_STRIPE_SECRET_KEY, or locally only once apps/web/.env.local points at a non-production database.";
const RUN = Date.now();

/** Assumption A16: Stripe's summaries show an accepted event within this. */
const SUMMARY_WAIT_MS = 120_000;
const SUMMARY_POLL_MS = 5_000;
/** After the sentinel appears, one more read this much later (A17). */
const SETTLE_MS = 30_000;

type Sum = { value: number; reached: boolean };

/** The customer's aggregate on the meter for [startTime, startTime + 60 s),
 *  polled until it reaches `target` or the wait runs out. */
async function waitForSum(
  stripe: Stripe, meterId: string, customer: string, startTime: number, target: number,
): Promise<Sum> {
  const deadline = Date.now() + SUMMARY_WAIT_MS;
  for (;;) {
    const page = await stripe.billing.meters.listEventSummaries(meterId, {
      customer, start_time: startTime, end_time: startTime + 60,
    });
    const value = page.data.reduce((sum, s) => sum + s.aggregated_value, 0);
    if (value >= target) return { value, reached: true };
    if (Date.now() >= deadline) return { value, reached: false };
    await new Promise((resolve) => setTimeout(resolve, SUMMARY_POLL_MS));
  }
}

function report(type: string, outcome: string, level: "notice" | "warning"): void {
  test.info().annotations.push({ type, description: outcome });
  console.log(`::${level} title=usage-meter.spec.ts ${type}::${outcome}`);
}

test.describe("usage reaches Stripe as meter events, counted once", () => {
  test("Stripe test mode counts BIS's meter event once, replay included; a reused identifier under a new key is observed", async () => {
    if (!STRIPE_KEY) console.warn(`::warning title=usage-meter.spec.ts skipped::${NO_STRIPE}`);
    test.skip(!STRIPE_KEY, NO_STRIPE);
    expect(/^(sk|rk)_test_/.test(STRIPE_KEY), "usage-meter.spec.ts runs on a Stripe TEST key only").toBe(true);
    test.setTimeout(330_000);

    const stripe = new Stripe(STRIPE_KEY, { apiVersion: STRIPE_API_VERSION });
    const gateway = stripeGateway(stripe);
    // The meters the Plans page makes; created here if this test account has
    // never saved a plan (idempotent, the Plans page's own keys).
    const meterId = (await ensureMeters(gateway)).sms;
    const customer = await stripe.customers.create({
      name: `usage-meter.spec ${RUN}`, metadata: { bis_e2e: "usage-meter" },
    });

    let bodyOk = false;
    try {
      // Every event at one minute-aligned instant two minutes ago, so one
      // summary window [ts, ts + 60) holds them all and lies in the past.
      const ts = Math.floor(Date.now() / 60_000) * 60 - 120;
      const eventOf = (value: number): MeterEventInput => ({
        eventName: METERS.sms.eventName, customerId: customer.id, value, identifier: randomUUID(), timestampSeconds: ts,
      });
      // The key shape the usage report builds (usageIdempotencyKey).
      const keyOf = (e: MeterEventInput) => `bis-usage-${e.identifier}-${customer.id}`;

      // ── Phase 1: A9 (accepted and mapped to this customer) and A10 (a
      // replay under the same key adds nothing). ──
      const first = eventOf(2);
      const second = eventOf(3);
      await gateway.reportMeterEvent(first, keyOf(first));
      await gateway.reportMeterEvent(first, keyOf(first));   // a lost response, retried
      await gateway.reportMeterEvent(second, keyOf(second));
      const p1 = await waitForSum(stripe, meterId, customer.id, ts, 5);
      if (p1.reached) {
        // WRONG, not late: more than 5 means the replay was counted (A10) or
        // the mapping is off (A9). A replay under the same key is answered
        // from Stripe's idempotency cache, so it cannot arrive later.
        expect(p1.value, "Stripe's sum for event 1 (2), its replay, and event 2 (3)").toBe(5);
        report("A9/A10", "deduplicated as expected (5)", "notice");
      } else {
        report("A9/A10", `unproven: the summary showed ${p1.value} of 5 after ${SUMMARY_WAIT_MS / 1000} s`, "warning");
      }

      // ── Phase 2: A11, observed, never assumed. The only acceptable refusal
      // is an invalid request (the reporter's row-specific class). ──
      // Only the probe itself sits in the try, so a failed assertion below
      // can never be mistaken for Stripe refusing the probe.
      let refusal: { type?: string; code?: string; message?: string } | null = null;
      try {
        await stripe.billing.meterEvents.create(meterEventParams(first), {
          idempotencyKey: `bis-usage-probe-${randomUUID()}`,
        });
      } catch (e) {
        refusal = e as { type?: string; code?: string; message?: string };
      }
      let a11: string;
      if (refusal) {
        a11 = `refused: ${refusal.type ?? "?"} ${refusal.code ?? ""} ${refusal.message ?? ""}`.trim();
        expect(refusal.type, "a reused identifier may be refused only as an invalid request (the reporter's row-specific class)")
          .toBe("StripeInvalidRequestError");
      } else {
        // A sentinel AFTER the probe (A17): once it shows, the probe has
        // been counted or deduplicated.
        const sentinel = eventOf(7);
        await gateway.reportMeterEvent(sentinel, keyOf(sentinel));
        const seen = await waitForSum(stripe, meterId, customer.id, ts, 12);
        let value = seen.value;
        if (seen.reached) {
          await new Promise((resolve) => setTimeout(resolve, SETTLE_MS));
          value = (await waitForSum(stripe, meterId, customer.id, ts, 12)).value;
          // 12 and 14 are the two answers Stripe can give; anything else is WRONG.
          expect([12, 14], `Stripe's sum after the A11 probe and the sentinel was ${value}, which no outcome explains`)
            .toContain(value);
        }
        a11 = !seen.reached
          ? `unproven: accepted, and the summary showed ${value} of 12 after ${SUMMARY_WAIT_MS / 1000} s`
          : value === 12 ? "deduplicated as expected (12)" : "accepted but double-counted (14)";
      }
      report("A11 same identifier, new idempotency key", a11, a11.startsWith("deduplicated") ? "notice" : "warning");
      bodyOk = true;
    } finally {
      try {
        await stripe.customers.del(customer.id);
      } catch (e) {
        // Thrown only when the body passed: a throw from finally would
        // REPLACE the primary failure.
        const msg = `usage-meter.spec cleanup failed on Stripe customer ${customer.id}: ${String(e)}`;
        if (bodyOk) throw new Error(msg);
        console.error(msg);
      }
    }
  });
});
```

Count: **1 test**.

Two things this test can NOT tell apart, recorded so nobody reads more into it: a phase-2 value of 12 read before a late double count lands (A17; the 30 s settle narrows it, cannot close it), and whether Stripe's dedupe window for identifiers outlives the 24-hour idempotency key (the real case is a resend after the key expired; this probe resends within seconds). Both are reasons A11 "deduplicated" still only clears PR-3 together with PR-4's reconciliation as the backstop (A12).

- [ ] **Step 2: Typecheck and lint**

Run: `pnpm --filter web typecheck && pnpm --filter web lint`
Expected: exit 0.

Run: `pnpm --filter web exec vitest run e2e/fixtures`
Expected: all pass (`fixture-names.test.ts` finds no new `E2E …` name).

- [ ] **Step 3: Where it runs**

Playwright cannot run locally while `apps/web/.env.local` names production (the e2e production guard refuses). The implementer stops here; CI's `e2e` job runs it. Expected there: `usage-meter.spec.ts` 1 passed, and the job log carries a `::notice` or `::warning` line titled `usage-meter.spec.ts A9/A10` and one titled `usage-meter.spec.ts A11 same identifier, new idempotency key`. Without the key it is 1 skipped with the `::warning` skip line.

- [ ] **Step 4: Commit**

```bash
git add apps/web/e2e/usage-meter.spec.ts
git commit -m "test(e2e): Stripe test mode counts BIS's usage meter events once (read from its aggregate); record the reused-identifier outcome"
```

---

### Task 11: Gates, counts, handoff

**Files:** none new.

- [ ] **Step 1: Confirm the new-test count**

Expected new tests: db usage 14 (revised from 9 — review corrections applied 2026-09-25, Fix 1 and Fix 2), db live usage 8 (revised from 7), billing/usage 4, call-state 1, finish-call 7, textback 5, send-sms 6, composer actions 6, concierge route 5, stripe-gateway 11, meter-event-failure 1, usage-report 14, usage-stale-banner 5, work page 3, e2e 1 = **91**. The reviewer re-counts from vitest's own output, never from this plan.

Run: `pnpm --filter web exec vitest run src/lib/billing/usage.test.ts src/lib/billing/meter-event-failure.test.ts src/lib/voice/textback.test.ts src/lib/automations/passes/usage-report.test.ts src/components/usage-stale-banner.test.ts`
Expected: `Tests  29 passed (29)` (4 + 1 + 5 + 14 + 5).

Run, per file, and compare with the baselines in File Structure: `stripe-gateway` 56, `call-state` 21, `finish-call` 92, `send-sms` 16, composer `actions` 20, concierge `route` 48, `sentinel` 5, cron `route` 30, `work/page` 18.

The db counts (9 and 7) come from CI's `verify` log (Checkpoint A).

- [ ] **Step 2: Local gates (what runs locally until D7)**

Run: `pnpm typecheck && pnpm lint`
Expected: exit 0.

Run: `pnpm --filter web test`
Expected: all pass except the two live web tests that refuse production by design (and the known local `work/page.test.ts` timeout noted in the ledger, if it recurs; it must pass in CI).

- [ ] **Step 3: CI is the gate**

Push. Read the check runs for the head SHA (`gh api repos/{owner}/{repo}/commits/<sha>/check-runs`): `verify` (typecheck, lint, the db suite including Task 1's 21 tests, the web suite) and `e2e` (the whole Playwright suite including `usage-meter.spec.ts`, and `pnpm --filter web build`) both green.

- [ ] **Step 4: Manual DESIGN.md pass (bis-design-reviewer on a running build, or a human on the preview)**

- `/dashboard/styleguide` → "Stale-usage banner": dark AND light (the `.dark` toggle), nothing for 0, the singular and the plural; the link's focus ring visible on Tab.
- `/dashboard/work` renders unchanged with no billed accounts (the banner renders nothing).
- 375 px: the banner wraps, no horizontal scroll.

- [ ] **Step 5: Handoff to the orchestrator (implementers stop here)**

- Open the PR. The body lists: spec gaps G1-G14, assumptions A9-A19 (A9-A11 with the outcomes the e2e job's two annotations recorded, copied from the job log), "no migration", "production reports nothing to Stripe until PR-3; from deploy, production's ledger fills for every account", and, in its own paragraph, G14: **an automation text re-sent because its dedupe stamp failed (review-request, no-show nudge and referral ask each log "expect up to 11 more copies") is billed per copy: each copy is a real, delivered text with its own message row.**
- Orchestrator: read `verify` and `e2e` for the head SHA; read BOTH annotations (`A9/A10` and `A11 same identifier, new idempotency key`). The only outcome that clears PR-3 is `deduplicated as expected` on BOTH. **Anything else is a PR-3 blocker (not a PR-2 one):** `unproven` (the summary did not settle within the wait: re-run the e2e job on the same SHA until it is proven either way), `refused: StripeInvalidRequestError ...` (map that error to "already reported" before a resend can wedge an account; the reporter's refused-account rule would otherwise hold that account's usage back every tick), and `accepted but double-counted` (the reporter must stop resending a row under a new key, e.g. reconcile against Stripe before resending a row first sent over 24 hours ago). PR-3 does not create the first billed account until its blocker is resolved.
- Orchestrator: append a ledger line correcting the planning-start paraphrase of the voice decision ("caller spoke, turn_count>=1") to the gate this plan ships: `callerSpoke(state) || isMeaningful(outcome)` (G5).
- Nothing to apply to any database. Merge per the runbook.

---

## Self-review (done while writing; recorded for the reviewer)

- **Spec coverage (step 2 only):** section 3 flow 3: an answered call ends → minutes rounded up (Task 3; "answered" = Sofía talked to the caller, `callerSpoke(state) || isMeaningful(outcome)`, danlo); an outbound SMS is sent → its segments (Tasks 4-5; outbound to customers only, danlo; staff alerts `lib/sms/alerts.ts:182` and OTP codes `settings/actions.ts:324` untouched, so never billed); a concierge conversation → 1, when Sofía's first reply succeeds (Task 6, danlo 2026-09-25); a cron pass reports unreported rows to Stripe meter events with the row id as identifier (Tasks 7-8). Section 4: rows stay unreported and are retried each pass (Task 8: a refused row, and its account's other rows, go again next tick; `unstamped` rows are resent under the same identifier AND key, so Stripe's idempotent replay, A10, keeps one event). **Section 4's "Stripe dedupes by identifier" is UNPROVEN and relied on nowhere** (A11): the fake assumes the opposite, and only Task 10's observation can clear it, as a PR-3 gate. A row unreported > 24 h raises an agency alert (Task 9's banner, Task 8's per-tick `console.error`). Rollout (2): the ledger fills for every account (G1). Not here by design: reconciliation and the pause (PR-4), Checkout/webhooks/Billing screens (PR-3).
- **danlo's decisions honoured:** voice bills every call Sofía talked to: a caller turn with words OR a booked/lead/message outcome, robocalls included, silent rings and connect-timeouts never, `max(1, ceil(duration_secs / 60))`, the web demo never (no calls row); SMS only to customers (automations, composer, both text-back callers), after a successful send, `segmentsFor(body).segments`, a re-sent copy billed per copy (G14); 1 AI chat per conversation, recorded when Sofía's FIRST reply succeeds (a failed start never bills), no QA exemption; the stale alert is a derived banner (no migration) plus a `console.error` per cron run.
- **Review corrections applied (2026-09-25):** the e2e reads Stripe's aggregate with a bounded wait (Task 10, A16-A17); the fake records a second event for a reused identifier under a new key (Task 7); automation-text usage is worked out after the send's `try` by a helper that never throws (Task 4); the concierge bills on turn 1's successful reply, its lazy import inside the leg's own `try` (Task 6); the voice gate has both halves (Task 3); every `usage_events` read is one request per 50 accounts, sends go oldest first across accounts, and a refused account cannot fill the cap (Tasks 1, 8); each meter event carries a per-request `maxNetworkRetries: 0` and a 10 s timeout, which the installed SDK's transport does not turn into a hard "no retry, bounded at 10 s" guarantee (one retry of a reset connection, and a socket-idle rather than hard timeout), so the pass stops starting sends 21 s (not 10 s) before its 60 s budget (Tasks 7, 8 Fix 1; A19 labels the round-trip estimate); the duplicate banner test is gone, the length check is an exact-copy assertion, the absence test names its mutation, the SMS scan strips comments, and a `false` stamp counts `alreadyStamped`, not `reported` (Tasks 4, 8, 9).
- **Placeholders:** none. Every code step carries the code.
- **Type consistency:** `UsageInput`, `UsageRow`, `BilledUsageAccount`, `UsageRange` (Task 1) are used unchanged in Tasks 2, 8 and 9. `recordUsageSafely`'s `db` accepts a client or a getter; only the composer passes a getter. Since the Fix 1-4 review corrections (2026-09-25), `input` accepts a `UsageInput` or a thunk that builds one, built inside the same try as `db`; every Task 3-6 call site passes a plain object (none reads its fields off a value that could be null or throw while being read), so none needed to change. `SentSms.usage` (Task 4) is the only shape change on an existing type; its two test literals are edited in the same task. `MeterEventInput` is shared by `meterEventParams`, the adapter, the fake, the pass and the e2e. `METER_EVENT_TIMEOUT_MS` is defined once (`stripe-gateway.ts`) and read by the adapter and its own tests; the pass's last-start threshold reads `METER_EVENT_WORST_CASE_MS` (`caps.ts`, Task 7's review) instead, since the two are not the same number for the installed SDK. The pass's counter object and the cron test's `EMPTY_USAGE_REPORT` list the same ten keys in the same order (`reported, unstamped, alreadyStamped, failed, expired, staleAccounts, skippedNoStripe, stoppedOnCap, stoppedOnError, stoppedOnBudget`).
- **Counts re-derived from the code blocks:** db `usage.test.ts` 9 (2 guard + 1 insert + 2 window + 1 paging + 3 per-account reads); db `test/usage.test.ts` 7; `billing/usage.test.ts` 8 (revised from 4: Fix 1-4 review corrections, 2026-09-25 — see Task 2's report); call-state 1; finish-call 7; textback 5; send-sms 6 new + 2 edited; composer 6; concierge 5; stripe-gateway 11 (4 + 1 + 1 + 5); meter-event-failure 1; usage-report 14; usage-stale-banner 5; work page 3 new + 1 edited; e2e 1. Total **89** (85 + 4 from the Task 2 fix). Files: 12 created, 23 modified (35), unchanged by the corrections. Tasks: 11, plus Checkpoint A.
- **Existing tests this plan must not break:** the cron `route.test.ts`'s seven whole-body equalities (edited, Task 8); `sentinel.test.ts`'s exact registry order (edited, Task 8); `imports.test.ts` (the pass imports no email/SMS provider or factory; `@/lib/sms/segments` and `@/lib/sms/types` do not match its patterns); `send-sms.test.ts`'s exact return value and `SentSms` literals (edited, Task 4); the concierge `route.test.ts`'s existing empty-reply and model-failure tests (the leg sits after both of their decisions and records nothing on either); `fixture-names.test.ts` (the new spec mints no `E2E …` name); `messages.test.ts`'s milestone guard (no new string names one); every pass test that spreads `importOriginal` over `@bis/db` keeps the real `recordUsage`, which is never reached because their providers are `isFake: true`.
- **Not verified here (the reviewer or CI settles them):** that PostgREST accepts `+00:00` microsecond timestamps inside a double-quoted `.or()` value (the precedent quotes `toISOString()` values only; Task 1's live `listReportableUsage` test is the proof, in CI); A16-A19.
- **Carried minor (PR-1's M4, same shape):** a killed db run strands its `Usage <run> <id>` plan row (agency-scoped, no sweep leg). Harmless; the plans sweep leg PR-1 added in e2e does not cover the db package.

## Next plans

1. **PR-3: Checkout, webhooks, the Billing card and the client Billing page.** Binding from this plan: (a) `account_billing.created_at` is the usage reporting start (G12): create the row when the subscription exists, or move the floor to a dedicated column; (b) remove `countBilledAccountsByPlan`'s 1000-row cap (PR-1 final review); (c) the usage screens read `usage_events` month to date through `usage_events_account_occurred_idx`; (d) PR-3 creates no billed account until Task 10's A9/A10 AND A11 annotations both read `deduplicated as expected`, or the follow-up for the outcome observed has landed (Task 11, Step 5).
2. **PR-4: the non-payment pause and nightly reconciliation.** Reconciliation is the backstop for A12 (Stripe's asynchronous drops); consider subscribing to `v1.billing.meter.error_report_triggered` thin events there. Decide the fate of `usage_events_unreported_idx` (G8) with the reconciliation's access pattern in hand.
3. **Scale path (no date):** past about 128 clients at today's estimate, move the reporter to Stripe's v2 meter event stream (100 events per request).
