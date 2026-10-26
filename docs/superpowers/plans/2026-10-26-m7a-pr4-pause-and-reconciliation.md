# M7a PR-4: The Non-Payment Pause, Lift Pause, the Plan Gates and the Nightly Stripe Reconciliation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **Revision 2 (2026-10-26)** after the opus plan review (CHANGES REQUIRED) and the owner's answers. The owner chose every recommendation (Q1-Q8) and added two rules: automations due during a pause are HELD, not dropped (I6), and after 30 days paused calls stop forwarding (I7). Every review item (I1-I10, M1-M13) is folded in; the "Revision 2 changes" table at the end maps each to where it landed. 0099 changed in one place (the reconciliation key gains `window_start`, for I9) and in two comments (I1); it was re-verified on a PG18 replica (Migration 0099 impact).

**Goal:** Ship rollout step (4) of M7a client billing, behind its own switch (`BILLING_ENFORCE=1`, off by default). A billed account whose payment has been failing for 7 days, or whose plan has ended, is PAUSED: Sofía stops answering (calls go to the business's own transfer number for the first 30 days of the pause, then, or with no transfer number, a short "please call back"), texts to its customers stop, its automations are HELD and go out once the pause lifts (or drop when they no longer make sense), the website chat closes, AI summaries stop, and its dashboard is read-only for the client. Payment clears the pause; the agency can Lift it by hand (immediate, with Undo). A plan without Sofía or without the website chat is enforced by the same decision. Every night the usage BIS reported is compared with Stripe's own meter totals per account and billing period, PR-3's held ">24 h" usage rows are resolved, and any mismatch is shown to the agency. **Turning the switch off is the whole rollback**: with it off, nothing is paused, held, stopped, forwarded, closed or read-only because of billing, the usage report behaves exactly as in PR-3 (no hold), and the nightly step does not run. Two harmless writes stay on with the switch off (the webhook mirror stamps `stripe_checked_at`, and clears a pause when Stripe says paid), and the agency's screens keep showing billing state (Task 14 Step 6 says what to clear on rollback).

**Architecture:** Three layers, as in PR-1..3. **Data** (`packages/db/src/account-billing.ts`, `usage.ts`, new `billing-reconciliations.ts`) gains one read (`readBillingStanding`: the pause stamp, the status and the plan's features in one embed), compare-and-set pause writers that move `updated_at` with `nextVersion` (PR-3 B5), and the reconciliation store. **Policy** (`apps/web/src/lib/billing/standing.ts`, pure) decides, from stored rows only: pause or not (`decidePause`), and what an account may do now (`billingVerdict`). **Enforcement** reads that ONE verdict at the existing chokepoints, never per caller: the SMS and email send gates (whose `billing_paused` refusal `holdOrSend` turns into a hold), the TeXML answer route's existing decision order, the concierge's entry points, `requireAccountAccess` for client server actions, and the AI summary route's gate. A new cron pass (`billingPause`) stamps and heals pauses; the nightly reconciliation runs inside the existing `usageReport` pass under that pass's budget. One migration, **0099**, additive only.

**Tech Stack:** Next.js 16.3.6 (App Router, server actions, route handlers), Supabase Postgres 17 (RLS), `@supabase/supabase-js`, vitest 4, Playwright, `stripe@22.6.2` (API `2026-08-26.dahlia`), Tailwind 4 with the repo's tokens.

**Spec:** `docs/superpowers/specs/2026-09-24-m7a-client-billing-design.md`, sections 3 flows 5-6, 4, 5 (Lift pause, paused banner), 6, and section 9 (amendments this plan forces, revised with this plan). Builds on PR-3 (`docs/superpowers/plans/2026-09-25-m7a-pr3-checkout-webhooks-billing.md`), whose "Next plans" item 1 (a)-(h) is binding here; each is answered in G1-G22 below.

## Global Constraints

- **Tiers are per TASK** (`bis-speed-process`, binding since 2026-10-19). HIGH: full ceremony (brief review, opus review with mutation probes, re-review, the orchestrator applies the migration once). MEDIUM: implementer + one review. LOW: implementer only, covered by the end-of-PR review. Every assertion in a HIGH or MEDIUM task names, in its title, the mutation that turns it red; the reviewer applies those probes. Copy and styleguide assertions need no probe.
- **The switch is the rollback.** Every billing behaviour this PR adds reads `billingEnforced()` (`lib/billing/enforce.ts`): `process.env.BILLING_ENFORCE === "1"`, nothing else counts as on (not `"true"`, not `" 1"`). OFF: nothing is paused, held, stopped, forwarded, closed or read-only because of billing; the pause pass writes NOTHING (it counts what it would do); the usage report does not hold rows (PR-3 behaviour); the nightly step (re-reads, reconciliation, held sends, permission heal) does not run. What still runs with it off, on purpose: the mirror stamps `stripe_checked_at` and clears `billing_paused_at` on a paid status (metadata and a correct clear), and the agency's card and work queue show billing state they read from rows. ON only on Vercel Production after rollout (Task 14), and in CI's e2e job (Task 12). Never on Vercel Preview.
- **One decision, read in few places.** What an account may do is `billingVerdict(standing, enforced, now)` over `readBillingStanding`. No enforcement reads `accounts.permissions` (G4). Exactly five non-test files import `readBillingStanding`: the SMS gate, the email gate, the TeXML route, the concierge turn route, and `lib/billing/standing-read.ts` (which alone serves the paused banner, the read-only guard in `requireAccountAccess`, the `/c` page and layout, and the AI summary route); pinned by a source scan (Task 7).
- **Failure direction is the house rule of each chokepoint, stated once:** the SMS and email gates FAIL CLOSED on an unreadable billing row (blocked `ledger_unavailable`, their existing doctrine; an automation is then re-held for `LEDGER_RETRY_MS`, as today); the TeXML route, the concierge, the read-only guard and the AI summary FAIL OPEN (answer, chat, allow, summarise), because wrongly cutting off a paying client is worse than one unbilled call, chat or summary; each logs.
- **The gates read billing through `serviceDb()` inside the gate**, never through the caller's client: a Staff session's RLS client reads no `account_billing` row (0066 `account_billing_owner_read`) and no plan (agency-read), so a caller-bound read would see "unbilled".
- **Every `account_billing` writer moves `updated_at` strictly forward with `nextVersion`** (PR-3 Global Constraints, B5): the pause pass, Lift pause, its Undo, and the mirror. Pause writes are compare-and-set on `updated_at`; a lost race is skipped this tick, never retried in a loop.
- **The pause never rests on a stale or premature Stripe status** (G6): a past-due pause needs `stripe_checked_at` AFTER the grace ended (`checked − past_due_since ≥ PAUSE_GRACE_MS`) and within `STRIPE_FRESH_MS` (26 h).
- **Unbilled accounts (no `account_billing` row) and complimentary rows are never paused and keep every feature** (spec section 2; 0051's `account_billing_complimentary_check`).
- **Writes**: the billing tables only through `serviceDb()` after `requireAgency()` (agency actions) or from the cron (service role). Every new module that obtains a service client is listed with its reason in `in-account-service-reads.test.ts`.
- **Stripe**: the pause pass makes no Stripe call. The nightly step's calls run under `USAGE_REPORT_BUDGET_MS` (shared: no new budget; `cron-coupling.test.ts:335-346` pins the five budgets' sum at exactly `maxDuration`), every one of them with the per-request transport `{ maxNetworkRetries: 0, timeout: METER_EVENT_TIMEOUT_MS }` (`retrieveSubscription` and `listActiveMeters` gain a `bounded` option for it; the webhook and Plans page paths are unchanged). A re-mirror (up to two subscription reads in the normal case) starts only while `elapsed < USAGE_REPORT_BUDGET_MS − 2 × METER_EVENT_WORST_CASE_MS`, and in the nightly path its reads are CAPPED at two (`REMIRROR_READS`): `mirrorSubscription` alone can read 1 + `MIRROR_ATTEMPTS` = 4 times, more than the budget holds, so a third read (a lost race; nothing was written) throws, is counted, and the row is re-read next tick (review of 82634ba4, item 6); any other call only while `elapsed < USAGE_REPORT_BUDGET_MS − METER_EVENT_WORST_CASE_MS`. Meter totals are compared as exact integers (a non-integer `aggregated_value` is `ambiguous`, never rounded).
- **DB tests (`packages/db`) run only in CI.** Implementers never apply migrations. 0099 goes to `bis-ci` first (`ci-project-setup.yml`, Checkpoint A), then production through MCP before merge, then parity (Task 14). It is additive: it widens two CHECKs and adds nullable columns and one table, so applying it to the shared CI project cannot break another branch.
- **Copy** lives in `apps/web/src/lib/messages.ts`, plain language, no milestone codes (`messages.test.ts` scans every key). Every new key outside the agency-only prefixes (`lib/i18n/ratchet-scan.ts:82-84`: `accounts.`, `blueprints.`, `work.agency.`, `numbers.`, `screened.`, `plans.`) ships with its `.es` twin in the owner register already in the catalogue (usted: "Suba un archivo o tome una foto", `messages.ts:4393`; "dueño", #287). Never hand-edit `catalogue-baseline.json`; regenerate it (`pnpm --filter web exec tsx scripts/generate-i18n-baseline.ts`, `ratchet.test.ts:1-11`). Task 1 adds the two agency-only `screened.reason.*` labels; Task 3 adds every other key; no other task writes `messages.ts`.
- **UI follows DESIGN.md**: tokens only; both themes through `.dark`; status is dot + word (`BILLING_STATUS_TREATMENTS` already has Paused); loaded/empty/error states; one primary per card (rule 8: Send billing link stays the card's primary, Lift pause is ghost); Lift pause runs immediately with an Undo toast (rule 6); new components get `/dashboard/styleguide` specimens; the paused banner renders in English and Spanish and survives the pseudo-locale's +35%.
- **The e2e suite never touches `Test Client One`.** It runs on the per-run fixture `E2E Client Co <stamp>`, acts on that account's rows only (never a whole pass over a shared database), and restores what it changed (workers = 1, `playwright.config.ts:166-171`).
- **Affected tests, every task** (memory `bis-agent-test-scope`, `bis-lane-pipeline`): every test file that references a changed export; every bare `vi.mock("@bis/db", () => ({...}))` factory that the changed code now dereferences (a missing export throws only when touched; each task says which reads happen only with the switch on); every source-scanning test (`grep -rln "readFileSync\|webSources\|code(" apps/web/src --include=*.test.ts`), always including `lib/consent/scans.test.ts`, `lib/automations/sentinel.test.ts` (pass order, `:296`), `lib/automations/cron-coupling.test.ts`, `app/(dashboard)/dashboard/accounts/[accountId]/in-account-service-reads.test.ts`; any lane that adds a `messages.ts` key runs `lib/consent/copy.test.ts` (pins `automations.reason.*` at 42 English keys, `:41-54`) and `lib/messages.test.ts`; every lane runs `pnpm --filter web lint` and `pnpm --filter web exec tsc --noEmit`. Never the full suite locally (CI is the gate).
- Gates before merge: `pnpm check`, `pnpm --filter web build`, `pnpm --filter web test:e2e`. CI runs them (`verify`, `e2e`). Read the check runs FOR THE HEAD SHA.

## Scope

In:
1. The pause: the `billingPause` cron pass (stamp after 7 days unpaid, confirmed by Stripe after the grace; or once an ended plan's period is over; heal a pause the mirror missed), the mirror clearing the pause on payment, and `stripe_checked_at`.
2. Enforcement, behind `BILLING_ENFORCE`: SMS gate (customer texts), email gate (automation kinds), automations held through `holdOrSend` (I6), TeXML answer route (forward for 30 days, then the message; I7), concierge page, layout and turn route, the AI summary, read-only client server actions.
3. The plan gates (`voice_receptionist`, `web_concierge`) through the same verdict (PR-3 G9 deferred them here).
4. The agency: Lift pause (+ Undo) on the Billing card; the work-queue billing banner (payment failed / paused / paused 30+ days with calls no longer forwarded / usage mismatch); the reconciliation result on the card.
5. The client: the paused banner on every page (Owner, Staff, Technician), the paused line on the Billing page, the payment-failed banner made bilingual.
6. Nightly (switch on): re-read every unpaid or paused subscription from Stripe, reconcile each live subscription's current period per meter, reconcile the just-closed period once after it closes, resolve held >20 h usage rows, rewrite `accounts.permissions` from the plan.
7. Migration 0099; runbook; `.env.example`; CI e2e switch.

Non-goals (each is a deliberate line, not an oversight):
- No email or SMS to the client when the pause starts or lifts (owner answer Q3; Stripe's own failed-payment emails are on, PR-3 DECISION 7).
- No "Pause now" button for the agency: a pause comes only from the pass. The Undo of a Lift is the one manual re-pause.
- No automatic release of a paused account's phone number, ever (owner answer I7). Nothing in this PR writes `phone_numbers`.
- No change to Stripe dunning, no auto-cancel (PR-3 DECISION 7), no change to the reporter's sends except the hold (G15).
- No nightly re-mirror of EVERY subscription (PR-3 Next plans (d)): only unpaid and paused ones, the only rows a pause decision reads (G6).
- No enforcement in the SIP webhook (`api/voice/incoming/route.ts`): the decision lives once, in the TeXML route (G9).
- No business-status composition in the forward: a paused account in Closed today or Storm still forwards to its transfer number in the first 30 days, because the TeXML route reads no business status (S-47d changes how SOFÍA answers; a paused call never reaches her). Known and accepted (M13).
- AI work other than the record summary is not separately gated: it is triggered by calls and chats, which stop.
- The Billing page and Billing card stay English-only except the lines this PR adds (their 81 keys are frozen ratchet debt, `catalogue-baseline.json`); the payment-failed banner's 4 keys are translated here because the paused banner sits beside it.
- The demo ("Talk to Sofía" on bis-rgv.com, `api/voice/web/session`), inbound email and inbound SMS, STOP/HELP/START replies, owner alerts, the weekly report, and the public booking page and forms (with their emails) are NOT stopped (G10).
- Multi-agency (M7 #3), Change-plan B4 (PR-3 Next plans 3), self-serve sign-up (M7 #2).

## Owner decisions this plan encodes (sources)

From the spec and PR-3 (unchanged):
- Grace, then soft pause; 7 days; lifts on payment or by hand (spec section 1, row "Non-payment"; section 3 flow 5).
- Cancellation ends at period end, then the same soft pause; nothing is deleted (spec section 3 flow 6).
- Forward to the existing handoff number, else a short "please call back" and log the call (spec section 3 flow 5).
- The pause is rollout step 4, behind its own switch, last (spec section 4).
- Stripe dunning: Smart Retries, then MARK UNPAID, never auto-cancel; receipts and failed-payment emails ON (memory `bis-m7a-billing-decisions`, PR-3 DECISION 7). So the pause sees `past_due`, then `unpaid`; never an automatic `canceled`.
- Live billing may start before PR-4; the >24 h stale banner is the tripwire meanwhile (PR-3 DECISION 6). PR-4's reconciliation is the backstop (PR-3 B10, Next plans (g)).
- Stale-usage alerts are a derived agency banner + `console.error`, not email (memory `bis-m7a-billing-decisions`). Reconciliation and the 30-day item follow the same channel (G17).
- What bills is unchanged; the Customer Portal stays update-card + invoices only (PR-3 DECISION 3).

The owner's answers to this plan (danlo, 2026-10-26; "all your recommendations", plus I6 and I7 from the review):
- **Q1.** Only texts to the business's CUSTOMERS stop; the owner's own alerts (`operator.*`) and the STOP/START/HELP replies (`consent.*`) still send (`smsStopsWhilePaused`, Task 5).
- **Q2.** No usable transfer number → the short call-back message, logged on Screened calls (Task 6, `COPY.unavailable`).
- **Q3.** No pause email.
- **Q4.** A Lift stays lifted until they pay or a NEW payment failure starts a new stretch (`decidePause`: `liftedAt >= pastDueSince`).
- **Q5.** A plan without Sofía or without the chat behaves like a pause for that feature (switch on only) (`billingVerdict`).
- **Q6.** The public booking page and forms keep working, with their emails; their texts stop (Q1); the website chat stops.
- **Q7** (orchestrator). One new pass, `billingPause`; the reconciliation runs inside the `usageReport` pass (`docs/crm-features.md` §3.2 rule 9, `:948`; Task 13 updates its text).
- **Q8.** One switch, `BILLING_ENFORCE=1` on Vercel Production, covering the pause, the plan gates, the hold and the nightly step; off is the rollback.
- **I6.** Automations due during a pause are HELD, not dropped, with S-47d's hold pattern (`hold-or-send.ts`, `CLOSURE_REASONS`): once the pause lifts (paid or Lift) they send; ones that no longer make sense (the appointment has passed) drop, as the closure hold does (G7a).
- **I7.** After 30 days paused, calls stop forwarding: the caller hears the call-back message (logged on Screened calls), the agency gets a work-queue item, and the number is never released automatically (G9, G13).

## External facts: verified vs assumed

Verified on 2026-10-26 (this worktree, `3e73b4d6`):
- `account_billing.past_due_since` and `billing_paused_at` exist (`0051_billing_core.sql:163-164`); `account_billing_complimentary_check` forbids a complimentary row with a pause (`:167-168`). The mirror stamps `past_due_since` (`account-billing.ts:286`) and never touches `billing_paused_at` (`:330`).
- `nextVersion` is module-private (`account-billing.ts:223-226`). `writePermissions` is module-private (`:312-318`). The only reader of `accounts.permissions` is the Setup wizard (`lib/setup/setup-inputs.ts:104`, `setup-status.ts:209-212`).
- `billingStatusOf` already maps `billingPausedAt` to Paused (`billing-view.ts:20`), and `showsPaymentFailedBanner` already hides itself on a paused row (`:41-44`).
- The account layout reads billing through the cached RLS read and fails soft (`accounts/[accountId]/layout.tsx:52-57`). A client Staff session reads no `account_billing` row (0066 `account_billing_owner_read`, `0066_staff_and_roles.sql:95-98`; the layout's comment `:45-51`).
- The cron registry holds 18 passes, order pinned by `sentinel.test.ts:296`. `cron-coupling.test.ts:335-346` pins five budgets summing to 240 s + 60 s headroom = `maxDuration` 300 exactly (`api/cron/reminders/route.ts:16`).
- The usage report: `usageReportPass` (`lib/automations/passes/usage-report.ts`), `USAGE_REPORT_BUDGET_MS` 60 s and `METER_EVENT_WORST_CASE_MS` 21 s (`caps.ts:138-140`), `listReportableUsage` (`packages/db/src/usage.ts:279`).
- The SMS gate's step 3 reads `isAccountOutboundSuppressed` and fails closed (`lib/consent/gate.ts:192-197`); the email gate's equivalent (`email-gate.ts:252-260`). `BLOCK_REASONS` and `EMAIL_BLOCK_REASONS` are exhaustive `Record`s over the block reasons (`hold-or-send.ts:255-276`). `holdOrSend` turns a gate's refusal into a `skipped` row and a deferral or an outage into a `held` row with `held_until` (`hold-or-send.ts:312-372`); the closure hold holds until the earlier of the window's end and the deadline and skips once the deadline has passed (`closures.ts:181-215`); the release pass brings a held row back at `held_until` (`registry.ts:22-26`). `LEDGER_RETRY_MS` is 15 minutes (`send-sms.ts:64`).
- SMS kinds and classes: 15 kinds (`lib/consent/classes.ts:31-48`): 7 `automation.*`, `voice.textback`, 2 `staff.*`, 2 `operator.*` (`operator.alert_sms`, `operator.alert_phone_code`), 3 `consent.*`. Email kinds `:96-131`.
- TeXML: decision order in `route()` (`api/voice/texml/route.ts:616-748`): deployment-wide `VOICE_FORWARD_TO` (`:622-630`), `classify` guards (refuse, blocked, cap, `:632-674`), the press-1 screen (`:680-704`), the per-account forward (`:705-724`), the bridge. `classify` reads the profile at `:240-241` and runs the caps' counts in one `Promise.all` (`:296-307`). `accountForwardTarget` (`:521-550`) resolves the transfer number with the loop guards. Forwarded calls are recorded in `forwarded_calls` (`forwarded_calls_kind_check`, `0059_forwarded_calls.sql:81`) and counted by the caps (`countForwardedCallsSince` counts every kind, `packages/db/src/forwarded-calls.ts:58-66`). Refusals go to `screened_calls` (`screened_calls_reason_check`, `0039_screened_calls.sql:69-72`; `ScreenedReason`, `screened-calls.ts:13-19`; labels `messages.ts:3780-3785`).
- S-47d (#286, 0097) changes how SOFÍA answers (`api/voice/incoming/route.ts`, the prompt, the topbar), not the TeXML routing.
- Concierge entry points: `/c/[publicId]/page.tsx:43,88`, `/c/[publicId]/layout.tsx:37,68` (each applies `isConciergeLive`), and the turn route (`api/concierge/[publicId]/turn/route.ts:221-224`, unknown/off → 404 `not_found`).
- `requireAccountAccess` (`lib/auth.ts:36-61`) is the guard every account server action reaches, directly or through `requireAccountOwner` (`:71-79`) / `requireNotTechnician` (`:142-149`); the agency returns at `:43`. 48 files start with `"use server"`; 38 are account-scoped (36 under `accounts/[accountId]`, 2 under `lib`: `lib/ai-acts/actions.ts`, `lib/proposals/actions.ts`); the rest are agency pages, user-level (`preferences/actions.ts`) or public (`b/`, `f/`, `u/`). 14 route files call `apiAccountAccess`, all GET-only except `ai-summary` (GET and POST, `api/accounts/[accountId]/contacts/[contactId]/ai-summary/route.ts:97-98`), and its GET also spends model calls when no fresh summary is cached (`serveRecordSummary`, gate at `lib/record/ai-summary-service.ts:38-43`).
- Next.js 16.3.6's server-action request header constant is `next-action` (`apps/web/node_modules/next/dist/client/components/app-router-headers.js:96`).
- `stripe@22.6.2` types `billing.meters.listEventSummaries(id, { customer, start_time, end_time, value_grouping_window? }, options?)`, both times minute-aligned, one summary for the range when no window is given (`node_modules/stripe/cjs/resources/Billing/Meters.d.ts:33,216-236`); `MeterEventSummary.aggregated_value: number`.
- The e2e job has no `CRON_SECRET` (`e2e/usage-meter.spec.ts:37`; `ci.yml` env `:302-340`), runs serially (`playwright.config.ts:166-171`), and the fixture account owns no phone number (`e2e/forward-calls.spec.ts`, "The fixture account owns no numbers of its own").
- The client-write digest is `52|b66203ca5d355155540b520af510d120` (`packages/db/src/test/proposals-drop.test.ts:100`); 23 definers in `EXPECTED_DEFINERS` (`definer-search-path.test.ts:27`).

Assumptions (not verified; each names what settles it):
- **S1. Meter summaries are exact and settle within 2 h.** `listEventSummaries` returns the sum of the customer's ACCEPTED events whose timestamps fall in `[start_time, end_time)`. PR-2's `usage-meter.spec.ts` observed a summary within 120 s in test mode (PR-2 A16) and accepted-order aggregation (A17); `RECONCILE_SETTLE_MS` (2 h) is a margin, not a documented bound. **Settled by:** Task 12's e2e test 6.
- **S2. Smart Retries keeps the subscription `past_due` past day 7**, then `unpaid` after the last retry (PR-3 B11; DECISION 7). **Settled by:** the runbook's TEST-mode probe (Task 13), before the switch goes on.
- **S3. A canceled subscription keeps its items' `current_period_end`** at the end of the paid period; an immediate cancel in the dashboard leaves the stored end in the future, which only delays the pause. **Settled by:** the same probe.
- **S4. Meter events for a customer with no live subscription are accepted and never invoiced** (usage between a cancellation and the pause tick bills nobody; PR-3 Next plans (e): the reporter is NOT changed). **Settled by:** the probe.
- **S5. `aggregated_value` for a `sum` meter of whole-number values is a whole number.** A non-integer is reported `ambiguous`, never rounded.
- **S6. Stripe's own `paused` status never occurs** (it needs a trial without a payment method; there are no trials, DECISION 5). `decidePause` neither pauses nor heals on it.
- **S7. Identifier uniqueness lasts at least 24 h** (Stripe docs, PR-3 B10). The hold starts at 20 h (`USAGE_HOLD_AFTER_MS`).
- **S8. Stripe finalises a period's invoice about an hour after the period ends** (Stripe docs on draft invoices, not re-read). So the just-closed period's comparison (G14) usually REPORTS a mismatch after the invoice is final; it cannot prevent it. **Settled by:** the probe reads the invoice's `finalized_at`.
- **N1. A server action is recognisable through `headers()` inside the action body, and `redirect()` there navigates the browser** (documented). Verified in Next 16.3.6's source (Task 7 review I1): a POST is an action when it carries `next-action` (the client's fetch) OR its body is a form, multipart or url-encoded, with no header at all (a no-JS form post; `server-action-request-meta.js`, `isMultipartAction` / `isURLEncodedAction`), which Next answers with a plain 303 after its write has run; and the render Next forwards after an action's redirect drops `next-action` but keeps the form's content-type and sends `rsc: 1` (`action-handler.js:276-313`). So `isActionRequest` counts `next-action`, or no `rsc` header and a form content-type. **Settled by:** Task 12's e2e test 3.

## Spec gaps resolved here (the reviewer should confirm or overrule)

- **G1. Pause rule** (`decidePause`, pure, Task 4). For a row that is not complimentary and has a subscription:
  - already paused: `unpause` when the status is `active` or `trialing` (the mirror clears it, G2; this heals a missed write), otherwise `keep`;
  - `past_due` / `unpaid`: `pause` when `now − past_due_since ≥ PAUSE_GRACE_MS` (7 days), the agency has not lifted this stretch (`pause_lifted_at ≥ past_due_since`, Q4), and Stripe confirmed the unpaid status AFTER the grace ended and recently (G6); `unconfirmed` when only the last fails (counted, logged, re-decided next tick);
  - `canceled`: `pause` once `current_period_end ≤ now` (or it is null), unless lifted at or after that end. **Deferred edge (assumption S3):** with a null (or unreadable) period end there is no end to compare a lift against, so ANY stored lift, however old, keeps the row unpaused; a canceled subscription with no period end is not expected from Stripe, so this is stated, not solved;
  - anything else (`incomplete`, `incomplete_expired`, `paused`, `active`, `trialing`): `keep`. `incomplete_expired` is a first checkout that never paid: the account was never served on a plan, so it stays as an unbilled one would.
- **G2. Payment clears the pause in the mirror** (spec flow 5). `decideMirror` writes `billing_paused_at: null` when the re-read status is `active` or `trialing`, and never otherwise. The pause pass heals the same case (G1).
- **G3. Lift pause.** Agency only (`requireAgency`). Compare-and-set: clears `billing_paused_at`, stamps `pause_lifted_at = now`, moves `updated_at` with `nextVersion`. The Lift bumps the account's held automations so they go next tick (`bumpHeldForAccount`; re-review m7). Undo re-pauses only while the row still carries that lift stamp, is still unpaid or ended, and is not complimentary, and it RESTORES the pause's own start (returned by the Lift), so the 30-day forward clock does not restart (re-review m1); otherwise it says the billing changed. 0099's `account_billing_lift_check` forbids a lift stamp on a complimentary row.
- **G4. Permissions (PR-3 Next plans (b)).** Enforcement derives the features from `account_billing.plan_id → plans.features` at READ time (`readBillingStanding`, one embed), so the PR-3 race (permissions written outside the compare-and-set) cannot reach a gate. `accounts.permissions` keeps being written (the Setup wizard reads it) and the nightly step rewrites it from the plan (`healPermissions`), so its drift lasts at most a day (switch on) and only changes which Setup steps show.
- **G5. The verdict** (`billingVerdict(standing, enforced, now)`, pure). Not enforced, or no row (unbilled): everything on. Otherwise `paused = pausedAt !== null`; `voice = !paused && features.voice_receptionist`; `concierge = !paused && features.web_concierge`; `forward` = whether a call Sofía does not take may still ring the business: true for `plan-no-voice`, and for a pause only while `now − pausedAt < PAUSE_FORWARD_MS` (30 days, I7). Complimentary rows follow their plan's features and are never paused.
- **G6. Stripe freshness (PR-3 Next plans (d); review I1).** The mirror stamps `stripe_checked_at = now` on every write (0099 column). With the switch on, the nightly step re-mirrors every subscription whose row is `past_due`, `unpaid` or paused (G14). A past-due pause needs BOTH `stripe_checked_at − past_due_since ≥ PAUSE_GRACE_MS` (Stripe said "still unpaid" after the 7 days were over, not before) AND `now − stripe_checked_at ≤ STRIPE_FRESH_MS` (26 h). So the pause lands between day 7 and day 8, on the first tick after the first confirmation past day 7. **The bound that holds** (not "never"): a client who pays after Stripe's last confirming read, and whose `invoice.paid` delivery fails, can be paused until Stripe's webhook retry is processed or the next nightly re-read clears it, whichever comes first (at most about 24 hours plus one tick). The webhook path itself is unchanged.
- **G7. SMS while paused** (Q1): the SMS gate blocks with `billing_paused` every kind whose class is `customer_initiated`, `informational`, `marketing` or `staff_typed` (12 of the 15 kinds); `operator` and `consent_reply` (3 kinds) pass. A new step 3b, right after the suppression check (`gate.ts:192-197`), so it covers every SMS path, present and future.
- **G7a. Automations are held, not dropped (I6).** `holdOrSend` turns a `billing_paused` refusal from either gate into a HOLD, the closure hold's shape, with three rules:
  - **The hold is on a fixed grid (re-review I1).** `held_until` = the earlier of the subject's pause deadline and the NEXT WHOLE HOUR (UTC) after now. Every repeat hold within the same hour computes the same instant, so `writeHeld`'s "same held_until writes nothing" rule (`hold-or-send.ts:290-297`) holds and the Activity page is not re-sorted (`automation-log.ts:83-90`). And a pause hold still in force short-circuits BEFORE the gate: when the subject's log row is `held`, with the pause reason, and `held_until > now`, `holdOrSend` returns `held` on that one log read (the read `writeHeld` makes anyway) and asks no gate.
  - **Stale ones drop (I6; re-review I2).** Each subject carries a `pauseDeadline`: the appointment for the booking recipes that already have a `deadline` (reminders, SMS reminder, appointment confirm); for the others, its recipe's OWN list-window end (corrected after Task 5: the release DOES re-apply the age window, not in `getDue…ById` but in each pass's own gate, which runs on both paths: `review-request-gate.ts:46`, `referral-ask-gate.ts:81`, `no-show-nudge-gate.ts:38`, `quote-followup-gate.ts:45`; so a subject released past it was already skipped "No longer due" and never sent, and the `pauseDeadline` adds only that a pause hold never runs past that end and a release AT it reads "too late, the account was paused"): review request = anchor + `REVIEW_REQUEST_MAX_AGE_MS` (`automations.ts:176`), referral ask = anchor + `REFERRAL_ASK_MAX_AGE_MS` (`:1038`), no-show nudge = anchor + `NO_SHOW_NUDGE_MAX_AGE_MS` (`:417`), quote follow-up = `stage_changed_at` + `QUOTE_FOLLOWUP_MAX_AGE_MS` (`:1859`); each anchor is the one that pass already computes (`laterOf(...)`, `review-request.ts:113`, `referral-ask.ts:117`, `no-show-nudge.ts:105`; `quote-followup.ts:102`). Once past it, the subject is `skipped` ("Not sent: it was no longer timely when the account's pause ended"). The follow-up already enforces `FOLLOWUP_MAX_AGE_MS` on release (`followup-timing.ts:86`); the instant reply and the text-back already stop at `RETRY_MAX_AGE_MS` (`send-sms.ts:71`, the re-hold age cap `hold-or-send.ts:121`). **Reactivation has no max-age constant** (its list is "lapsed for N months", which stays true): its release re-check (`getDueReactivationById`, `automations.ts:1716`) re-reads eligibility (unstamped, still lapsed, recipe on), and `REACTIVATION_DAILY_CAP` throttles it, so it carries no pause deadline. Stated for the owner to overrule.
  - **A held row gives back its tick slot (Task 5 review, item 1).** A paused account's subjects are held every tick and never stamp, so they stay at the head of their due list for the whole pause. Every recipe pass therefore returns the `AUTOMATION_TICK_CAP` slot (one counter across every account) a held row reserved, as review request, referral ask, no-show nudge and quote follow-up already did; reactivation now does too, and also returns its in-tick day count (`REACTIVATION_DAILY_CAP`), so a paused account never logs "Daily limit reached" on a day nothing went out. Without it two paused accounts with five candidates each would take all ten slots every tick and starve every other account.
  - **A send that is not held** (the staff document request by text) is refused while paused with its own words: `automations.reason.billingPaused` on the Activity page (`BLOCK_REASONS`/`EMAIL_BLOCK_REASONS.billing_paused`, never the deadline skip's "too late") and `documents.request.reason.accountPaused` in the dialog (`document-requests/deliver.ts` `SMS_REASON`).
  - **Release.** The release pass brings each held row back at `held_until`: still paused → held again (no write within the hour); lifted → the Lift bumps every held row of the account (`bumpHeldForAccount`, `automation-log.ts:131`), so they go next tick; paid → within the hour; switch off → sent.
  Non-automation sends (the staff composer) are refused with a sentence, not held.
- **G8. Email while paused**: the email gate blocks with `billing_paused` every `automation.*` kind, which `holdOrSend` then holds (G7a); every other kind passes: booking and form receipts (Q6), operator alerts, staff-typed mail, and `staff.document_request_email`, which is an email to the customer and so keeps going per Q6, while its SMS twin `staff.document_request_sms` stops with the other customer texts (M11). The read-only guard already limits staff-typed mail and document requests to the agency while paused.
- **G9. Calls while paused or without Sofía** (Q2, Q5, I7). In the TeXML route, AFTER every guard and the press-1 screen and BEFORE the per-account forward and the bridge, a call whose verdict has `voice = false`:
  - a CLEARED call whose verdict has `forward = true` is forwarded to the account's transfer number (the same resolver and loop guards as the per-account forward), recorded in `forwarded_calls` with kind `billing-paused` or `plan-no-voice` (so the daily caps count it);
  - otherwise (paused 30 days or more, no usable transfer number, or the call was not cleared) the caller hears `COPY.unavailable` in the profile's languages, and the call is recorded in `screened_calls` with the same reason, which the agency's Screened calls list shows.
  An uncleared call is never forwarded (`route.ts:708-711`'s rule). A failed billing read changes nothing (fail open). The deployment-wide `VOICE_FORWARD_TO` still runs first. The SIP webhook gets no billing check (a paused call reaches Sofía only when the TeXML route's own read failed, and a decline there would be dead air). The billing read starts before the caps' `Promise.all` with its own catch, so it adds no latency and a billing failure can never mark the call uncleared (M1).
- **G10. What stops, what does not** (Q6): stop = customer texts (G7), automations held (G7a, G8), Sofía (G9), the website chat (every entry point answers as for a switched-off chat: 404), AI record summaries (the summary route's gate answers "none"; M2), client writes (G11). Keep = the public booking page and forms (and their emails), inbound email and SMS (recorded), STOP/HELP/START replies, owner alerts, the weekly report, the demo (BIS's own number, never billed), the agency's own actions.
- **G11. "Dashboard read-only"** = a CLIENT caller's server action on a paused account is refused inside `requireAccountAccess`: it redirects to the page the action came from (the `referer`'s path, only when it is inside `/dashboard/accounts/<id>/`), else the caller's account home; nothing is written, and the paused banner on that page says why. Pages, layouts and GETs are untouched: an action is a request with `next-action`, or a no-JS form post (multipart or url-encoded body, no `rsc` header; N1), and a render is neither. The agency is never read-only. Exactly these server actions stay usable while paused, each opting out with `{ duringPause: "allow" }` and pinned with its reason by `lib/billing/read-only.test.ts`: Manage billing (`openBillingPortalAction`: the way to pay), the shell's snapshot poll (`getShellSnapshot`), read state (`markConversationReadAction`, which writes only the unread counter and no longer revalidates; MarkRead refreshes the page after it, Task 7 review I2), and every other action Task 7's audit finds to write nothing and call no model or provider (starting candidates: `getDocumentUrlAction`, `countContactDocumentsAction`, `searchGroupsAction`, `searchRelatableContactsAction`; `getForwardingAddressAction` is NOT one: it creates the forwarding address on first use, a write, M6). An allowed action must not revalidate; the scan pins that too. The one client API write, `ai-summary`'s POST (Regenerate), is covered by G10's AI gate, which answers "none" while paused, for every caller. **What this guard is, and is not:** it stops the APP's own requests (server actions and no-JS posts from these pages); it is not a security boundary against a forged request. A client's own token can still write through PostgREST wherever RLS and grants already allow a client to write (those grants are unchanged by this PR), so read-only is a product behaviour, not an enforcement layer; making it one would mean billing-aware RLS, which this PR does not do.
- **G12. The paused banner** is mounted beside the payment-failed one in the account layout, for every member (Owner, Staff, Technician) and the agency, read through `billingVerdictFor` (service role, cached per request). It shows only while the switch is on and the account is paused. Its sentence is true whether or not the account has a transfer number and whatever day of the pause it is (M3): "Your receptionist isn't answering calls, texts to your customers are stopped, automations are waiting, and nothing here can be changed …". Two causes, two sentences (payment / ended); the client Owner gets a link to Billing, Staff and Technicians a line saying the owner can turn it back on (Billing is Owner-only), the agency the Settings link. `role="note"`, `tone="crit"`, the sentence is the marker (DESIGN rule 3).
- **G13. The agency alert** (spec flow 5; PR-3 Next plans (f); I7): one derived banner on the work queue (`/dashboard/work`), LineDownBanner's pattern (derived, nothing stored, renders nothing at zero), listing by name, each linking to the account's `settings#billing`, at most five names per line plus "and N more". Lines and how each ENDS (M8):
  - "Payment failed:" while `past_due_since` is set and the row is not paused (the mirror clears it on any other status, a cancellation included);
  - "Paused:" while paused and `now − billing_paused_at < 30 days`;
  - "Paused 30+ days, calls are no longer forwarded:" (I7's work-queue item) while the switch is on, paused, and `30 days ≤ now − billing_paused_at < 44 days` (switch off: such an account stays under "Paused:" to day 44, because nothing is forwarding or not; re-review m3); after that the account leaves the banner (its card still says Paused), so a client who left does not stay on the queue for ever;
  - "Usage doesn't match Stripe:" while a row of the newest night's run for an (account, meter) has an alerting verdict and was checked within 48 hours (a current period's row is re-checked nightly, so its alert lasts while the mismatch does; a closed period's row is checked once, so its alert shows until the next night's run, and the card and the runbook carry it from there).
  The item is a line on the work queue, not a stored To-do: it clears itself when the account pays or is lifted. A failure of the FIRST read (the paused and payment rows) → no banner, logged (the queue is the page). A failure of the reconciliation read alone is caught inside `listBillingAlerts` (design review I3): the paused and payment lines stand, no partial mismatch set is shown, and the banner adds "Couldn't check usage against Stripe just now."; the Billing card does the same on its own read (I2).
  **Not on the work queue:** a plan WITHOUT the receptionist on an account with no usable transfer number. Its callers hear the call-back message (G9) and each call is a `screened_calls` row with reason `plan-no-voice` (the Screened calls list shows it), but it is a plan choice, not a billing fault, so no banner line names it; 9.5 step 3 of the runbook is the check that each such account has a transfer number before the switch goes on.
- **G14. Nightly reconciliation (spec section 4; PR-3 Next plans (g); I4, I9).** Inside `usageReportPass`, after the sends and bookkeeping, only with the switch on, sharing the pass's 60 s budget. **Once per 24-hour window starting 08:00 UTC** (`nightlyRunStart(now)` = the most recent 08:00 UTC): the unit of work is one (account, meter, period) not yet checked since that instant, so whatever a tick's budget does not reach, the next tick does, and a pair is checked once per window. For each live subscription (not ended, not complimentary):
  - **current period:** window `[ceilMinute(max(current_period_start, billing_started_at)), floorMinute(now))`;
  - **the just-closed period, once (I9):** when the newest stored row for that (account, meter) has a `window_start` before the current period's and a `window_end` before the current period's start, it is compared once more over `[its window_start, ceilMinute(current_period_start))` and upserted on its own key, report-only (held rows of a closed period are neither sent nor stamped: their invoice is final, S8).
  **Closed-period retry rule:** the closed period's own once-guard is that its saved row becomes the newest one reaching the current start. So when a meter's closing comparison FAILS this tick (anything but the budget running out), that meter's current pair waits too: saving the current period's row would make it the newest, `closedPeriodWindow` would answer null on the next tick, and the closed period would never be compared to its end. The next tick retries the closed one, then the current one. (A budget stop needs no rule: the whole step stops, nothing for that meter was saved, and the next tick resumes in order.)
  BIS's side is split into three bands by `readUsageBands` (settled = reported at least 2 h ago; in flight = reported within 2 h, or unreported and recorded within the hold; held = unreported and recorded at least 20 h ago); Stripe's side is `meterTotal`. The verdict is pure (`reconcileMeter`): `match`, `held_at_stripe` (stamp the held rows reported), `held_missing` (send them now with the reporter's key and identifier, then stamp), `stripe_over`, `stripe_under`, `ambiguous`. Each result is upserted into `billing_reconciliations` on `(account_id, meter, window_start)`; the last three verdicts are alerts (G13, the card line, `console.error`).
  **Remaining gaps, stated:** (1) a mismatch in the last day of a period is found after the invoice is final (S8): a credit is manual (runbook); (2) held rows of a closed period are reported, not resolved: a person decides (runbook); (3) the nightly does not run while the switch is off, so reconciliation starts with enforcement; (4) a period that closes while the nightly cannot run (Stripe down for a day or more) is still compared once, later, from its stored row; a period that closed BEFORE its first ever row (an account billed less than a day before rollover) is never compared.
- **G15. The hold (PR-3 B10).** With the switch on, `listReportableUsage` stops returning a row recorded `USAGE_HOLD_AFTER_MS` (20 h) ago or more: it is never blindly resent past Stripe's dedupe window; only reconciliation sends or stamps it (G14). With the switch off the reporter is PR-3's (I8). A held row of a closed period stays unreported, the stale banner keeps showing its account (correct: it needs a person), and the runbook says what to do.
- **G16. Pass order.** `billingPause` runs FIRST, ahead of `releaseHeld`: a pause stamped this tick is read by every gate in the same tick, and the release pass re-holds rather than sends. It touches no automation state, so the release-first contract (`registry.ts:22-26`) stands between the release and the recipes; `route.ts`'s and `release-held.ts`'s "the FIRST pass" wording becomes "the release pass". No Stripe call, no wall-clock budget.
- **G17. Alert channels**: banners (work queue, card) + `console.error` per tick/night. No email, no heartbeat failure. The `usageReport` pass's counters gain `remirrored`, `reconciled`, `mismatched`, `heldStamped`, `heldSent`, `reconcileFailed`, `reconcileSkippedBudget`.
- **G18. Cancellation's usage (PR-3 Next plans (e))**: the reporter keeps sending rows of a canceled account (S4: never invoiced); nothing new is recorded once paused. No code change.
- **G19. The card**: status word already covers Paused. Lines: "Paused since Oct 20: the payment failed on Oct 13." / "Paused since Oct 20: the plan ended."; from day 30 and only while the switch is on, "Calls are no longer forwarded: the account has been paused for over 30 days." (re-review m3); after a lift, on a still-unpaid OR ended plan, "Pause lifted Oct 26." (M10); the ghost **Lift pause** (only while paused); with the switch off and a stamp present, "Pausing is switched off here, so this pause changes nothing."; reconciliation alerts as one line per meter with when it was checked.
- **G20. Client Billing page**: one paused line above Manage billing (payment / ended); Manage billing stays available while paused (it is how they pay; an ended plan's portal shows invoices only, PR-3 G19).
- **G21. The AI summary while paused (M2).** The route's gate callback answers "account AI off" when `billingVerdictFor(accountId).paused`, so GET and POST both answer `{ state: "none" }` (no completion, no cached text) for every caller, through `serveRecordSummary`'s existing gate path (`ai-summary-service.ts:38-43`). No new client-API refusal is needed.
- **G22. Spec section 4's Preview line is stale**: Preview has held no production credential and has run on the CI project since 2026-10-07 (CLAUDE.md), so `stripeKeyVerdict` would accept a test key there; whether one is set is a Vercel setting, not a repo fact. Fixed in spec section 4 and noted in section 9.

## Migration 0099 impact

- **Needed: yes.** Four facts have no column today: who lifted a pause and when (`pause_lifted_at`, G3), when Stripe last confirmed a row (`stripe_checked_at`, G6), the nightly result per period (`billing_reconciliations`, G13/G14, which the work queue must read between nights without calling Stripe), and two new recorded reasons a CHECK refuses today (`forwarded_calls.kind`, `screened_calls.reason`, G9). `billing_paused_at` and `past_due_since` already exist (0051). I6 (the hold) and I7 (30 days) need no column: the hold uses `automation_log`'s existing held rows, and the 30 days are `now − billing_paused_at`.
- **Revision 2 change:** `billing_reconciliations`' primary key is `(account_id, meter, window_start)` (was `(account_id, meter)`), so a closed period keeps its own row (I9); the header and two comments are reworded (I1's bound instead of "can never"). Nothing else changed.
- **Re-verified on a PG18 replica (2026-10-26)**, built with the review's own script (`scratchpad/m7a/rv/replica.sh`: every migration 0001-0098 into `pre`, then 0099 into `post`): 0099 applies in one transaction; client-write digest `52|b66203ca5d355155540b520af510d120` on both `pre` and `post` (unchanged); definers `23|a32c0c5b…` on both (unchanged); `billing_reconciliations` has the eight constraints, all validated, the new primary key, RLS with one agency SELECT policy, and `authenticated` holds SELECT only (`anon` nothing, MAINTAIN included); two rows for one (account, meter) in two periods insert, a second row for the same period is refused by the key; the rollback statements in the header, run on a copy of `post`, give a schema dump identical to `pre` (only `pg_dump`'s random `\restrict` token differs). File: 0 non-ASCII bytes, 0 backslashes (positive control on `messages.ts`).
- **0096 rule**: no function is created or re-created; stated in the header.
- **Definers**: none added; `EXPECTED_DEFINERS` unchanged (23).
- **Client-write digest**: unchanged. `schema-grants-guard.test.ts` `EXPECTED_WRITES` unchanged.
- **Grants guard**: the new table has RLS on, no PUBLIC policy, and no client write.
- **Teardown**: `billing_reconciliations` cascades with its account, so it is NOT on `ACCOUNT_OWNED_TABLES`.
- **Rollback**: in the file's header (Task 1), verified as above.

## File Structure

Created:
- `packages/db/supabase/migrations/0099_billing_pause.sql` — the migration.
- `packages/db/src/test/billing-pause-schema.test.ts` — its live proof (CI).
- `packages/db/src/billing-reconciliations.ts` (+ `.test.ts`) — the reconciliation store.
- `packages/db/src/test/billing-pause.test.ts` — live round trips of the new writers and reads (CI).
- `apps/web/src/lib/billing/enforce.ts` — the switch.
- `apps/web/src/lib/billing/standing.ts` (+ `.test.ts`) — `decidePause`, `billingVerdict`, constants. Pure.
- `apps/web/src/lib/billing/standing-read.ts` (+ `.test.ts`) — `billingVerdictFor`, `conciergeOpen`: the one cached service-role read for the layout, the guard, the concierge page and layout, and the AI summary.
- `apps/web/src/lib/billing/read-only.ts` (+ `.test.ts`) — the action refusal, `sameAccountPath`, the allow-list scan.
- `apps/web/src/lib/billing/reconcile.ts` (+ `.test.ts`) — `reconcileMeter`, `reconcileWindow`, `closedPeriodWindow`, `nightlyRunStart`. Pure.
- `apps/web/src/lib/billing/nightly.ts` (+ `.test.ts`) — the nightly step.
- `apps/web/src/lib/automations/pause-hold.ts` (+ `.test.ts`) — `pauseHold` (G7a). Pure.
- `apps/web/src/lib/automations/passes/billing-pause.ts` (+ `.test.ts`) — the pass.
- `apps/web/src/components/billing-paused-banner.tsx` (+ `.test.ts`).
- `apps/web/src/components/billing-alert-banner.tsx` (+ `.test.ts`).
- `apps/web/e2e/billing-pause.spec.ts`.

Modified (main ones; each task lists its own):
- `packages/db/src/account-billing.ts`, `usage.ts`, `screened-calls.ts`, `forwarded-calls.ts`, `index.ts`, `account-billing.test.ts`, `usage.test.ts`.
- `apps/web/src/lib/consent/gate.ts`, `email-gate.ts`, `classes.ts`, `lib/automations/hold-or-send.ts`, `registry.ts`, `passes/usage-report.ts`, `passes/release-held.ts` (comment), `api/cron/reminders/route.ts` (comment).
- `apps/web/src/app/api/voice/texml/route.ts`, `app/api/concierge/[publicId]/turn/route.ts`, `app/c/[publicId]/page.tsx`, `app/c/[publicId]/layout.tsx`.
- `apps/web/src/lib/auth.ts`, the opted-out action files, `api/accounts/[accountId]/contacts/[contactId]/ai-summary/route.ts`.
- `apps/web/src/lib/billing/stripe-gateway.ts`, `fake-gateway.ts`, `billing-view.ts`.
- `apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/layout.tsx`, `billing/page.tsx`, `settings/billing-actions.ts`, `settings/billing-card.tsx`, `settings/billing-section.tsx`, `components/billing-banner.tsx`, `app/(dashboard)/dashboard/work/page.tsx`, `conversations/actions.ts`, styleguide.
- `apps/web/src/lib/messages.ts`, `lib/i18n/catalogue-baseline.json` (regenerated).
- `.github/workflows/ci.yml`, `apps/web/ci/ci-workflow.test.ts`, `.env.example`, `docs/runbooks/stripe-billing.md`, `docs/crm-features.md`.

## Task order, tiers, owners and checkpoints

| # | Task | Tier | Owner |
|---|---|---|---|
| 1 | Migration 0099, its live proof, the two `screened.reason.*` labels | HIGH | bis-db-schema |
| — | **Checkpoint A** (orchestrator): 0099 to `bis-ci` via `ci-project-setup.yml`; push; `verify` runs the db suite there | — | orchestrator |
| 2 | Data layer: standing read, pause writers, mirror, alerts, reconciliation store, usage hold and bands | HIGH | bis-db-schema |
| 3 | Copy, English and Spanish | LOW | bis-frontend |
| 4 | The switch, the pure policy, and the `billingPause` pass | HIGH | bis-automations |
| 5 | The two send gates and the pause hold | HIGH | bis-comms |
| 6 | The TeXML answer route and the concierge | HIGH | bis-voice |
| 7 | Read-only client actions, `standing-read.ts`, the AI summary gate | HIGH | bis-platform |
| 8 | Nightly: re-mirror, reconcile (current and closed period), the held rows, permissions | HIGH | bis-automations |
| 9 | Lift pause actions and the card's view model | MEDIUM | bis-frontend |
| 10 | Client surfaces: paused banner, layout, Billing page, bilingual payment-failed banner | LOW | bis-frontend |
| 11 | Agency surfaces: Billing card, work-queue banner, styleguide | LOW | bis-frontend |
| 12 | e2e and the CI switch | MEDIUM | bis-e2e-qa |
| 13 | Docs: runbook, `.env.example`, crm-features rule 9 | LOW | bis-platform |
| 14 | Final review, design review, one fix agent, gates, rollout | — | orchestrator (opus reviewer, bis-design-reviewer, one fix agent) |

Dependencies: Checkpoint A needs only Task 1 (it adds the two `screened.reason.*` labels, so `tsc` over web stays green; I3). 2 needs 1's columns only at run time (CI). 4, 5, 6, 7, 8, 9 need 2. 5 and 9 need 3's keys. 5, 6, 7, 8 need 4's `enforce.ts`/`standing.ts`. 6 needs 7's `standing-read.ts` (Task 7 owns that file; run 7 before 6, or 6 waits on it; M7). 10 needs 3, 4, 7. 11 needs 3 and 9. 12 needs everything. 13 any time after 4.

Parallel lanes on disjoint files: after 4 and 7, {5}, {6}, {8} touch different files. {10} and {11} run in parallel after 9 (both edit the styleguide page: merge by hand).

Commands run from the repo root `C:\Users\danlo\bis-platform\.claude\worktrees\m7a-pr4` (Git Bash).

---

### Task 1: Migration 0099, its live proof, the two screened labels (HIGH, bis-db-schema)

**Files:**
- Create: `packages/db/supabase/migrations/0099_billing_pause.sql`
- Create: `packages/db/src/test/billing-pause-schema.test.ts`
- Modify: `packages/db/src/screened-calls.ts:13-22` (union + its mirrored list), `packages/db/src/forwarded-calls.ts:15-18` (`ForwardKind`, `FORWARD_KINDS`), `apps/web/src/lib/messages.ts` (ONLY the two agency-only labels beside `:3780-3785`: `"screened.reason.billing-paused": "Account paused (billing)"`, `"screened.reason.plan-no-voice": "Plan has no receptionist"`; the `screened.` prefix needs no Spanish twin, `ratchet-scan.ts:82-84`).

**Interfaces:**
- Produces: columns `account_billing.pause_lifted_at`, `account_billing.stripe_checked_at`; table `billing_reconciliations` keyed `(account_id, meter, window_start)`; `ScreenedReason` and `ForwardKind` gain `"billing-paused" | "plan-no-voice"`.

- [ ] **Step 1: Write the failing live test** `packages/db/src/test/billing-pause-schema.test.ts` (uses `withRollback`, `actAs` from `./db`, the seed shape of `billing-checkout-schema.test.ts`). Cases (each title names its mutation):
  1. "pause_lifted_at and stripe_checked_at are nullable timestamptz with no default (mutation: add `default now()` to stripe_checked_at → FAILS)".
  2. "a complimentary row cannot carry a lift stamp (mutation: drop account_billing_lift_check → FAILS)" — `23514`.
  3. "billing_reconciliations: RLS on, exactly one SELECT policy for the agency (mutation: add `or account_id = app.current_account_id()` → FAILS)".
  4. "a client reads no reconciliation row, the agency reads it (mutation: policy `using (true)` → FAILS)".
  5. "anon and authenticated hold SELECT at most, MAINTAIN included (mutation: enumerated revoke instead of `revoke all` → FAILS)".
  6. "the row cascades with its account (mutation: `on delete restrict` → FAILS)".
  7. "CHECKs refuse a bad meter, verdict, window and negative count (mutation: drop billing_reconciliations_verdict_check → FAILS)".
  8. "one row per (account, meter, period): a second period inserts, the same period twice is a 23505 on billing_reconciliations_pkey (mutation: key on (account_id, meter) → FAILS)".
  9. "forwarded_calls takes billing-paused and plan-no-voice, still refuses anything else (mutation: leave plan-no-voice out → FAILS)"; same for `screened_calls`.
  10. "both widened CHECKs are VALIDATED (mutation: drop the `validate constraint` lines → FAILS)".
  11. "ScreenedReason and FORWARD_KINDS mirror the CHECKs (mutation: drop a value from the TS list → FAILS)".

- [ ] **Step 2: Typecheck** — `pnpm --filter @bis/db exec tsc --noEmit`. The live cases are red until Checkpoint A (CI only).

- [ ] **Step 3: Write the migration** `packages/db/supabase/migrations/0099_billing_pause.sql` exactly as below (this text is the one verified on the replica; keep it ASCII, no backslash):

```sql
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
-- (no rewrite). The widened CHECKs are added NOT VALID and then validated, as the repo does; inside one
-- transaction that saves no lock (0095), and both tables are small, so the scan is brief.
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
```

- [ ] **Step 4: Widen the two TS mirrors** (`ScreenedReason` + its list; `ForwardKind` + `FORWARD_KINDS`) and add the two `screened.reason.*` labels.

- [ ] **Step 5: Typecheck and lint** — `pnpm --filter @bis/db exec tsc --noEmit && pnpm --filter web exec tsc --noEmit && pnpm --filter web lint`. Expected: green (the screened table and the styleguide index `m[\`screened.reason.${reason}\`]` by template, which is why the labels ride here). Run `"src/app/(dashboard)/dashboard/screened"` tests.

- [ ] **Step 6: Commit** — `git commit -m "M7a PR-4: migration 0099 (Lift pause, Stripe freshness, reconciliations per period, two call reasons) and its live proof"` (the five files).

### Checkpoint A (ORCHESTRATOR ONLY, not an implementer step)

1. `ci-project-setup.yml` with 0099: push-dry-run, then push, to `bis-ci`.
2. Push the branch; `verify` runs `billing-pause-schema.test.ts`, `proposals-drop.test.ts` (digest unchanged), `definer-search-path.test.ts` (unchanged), `schema-grants-guard.test.ts` (unchanged); `e2e`'s migration check proves 0099 is on bis-ci.
3. The reviewer applies Step 1's mutation probes on the LOCAL replica (memory `bis-local-db-replica`), never on bis-ci.

### Task 2: Data layer (HIGH, bis-db-schema)

**Files:**
- Modify: `packages/db/src/account-billing.ts` (types `:57-98`, `decideMirror` `:233-293`, new exports), `packages/db/src/usage.ts` (`listReportableUsage` `:279-297`, new `readUsageBands`, `USAGE_HOLD_AFTER_MS`), `packages/db/src/index.ts:222-237`.
- Create: `packages/db/src/billing-reconciliations.ts` (+ `.test.ts`).
- Test: `packages/db/src/account-billing.test.ts` (unit, `recorder` stub `:150`), `packages/db/src/usage.test.ts` (unit), `packages/db/src/test/billing-pause.test.ts` (live, CI), `packages/db/src/test/usage.test.ts` (live, CI).
- Fixture updates (add `pauseLiftedAt: null, stripeCheckedAt: null` to every literal `AccountBilling`): `apps/web/src/lib/billing/billing-view.test.ts`, `billing-link.test.ts`, `app/(dashboard)/dashboard/accounts/[accountId]/billing/page.test.ts`, `layout.test.ts`, `settings/billing-actions.test.ts`, `settings/billing-section.test.ts`, `app/(dashboard)/dashboard/styleguide/billing-card-states.tsx`, `packages/db/src/account-billing.test.ts` (`stored()` `:26`).

**Interfaces:**
- Produces (all exported from `@bis/db`):
  - `AccountBilling` gains `pauseLiftedAt: string | null; stripeCheckedAt: string | null`.
  - `PAID_STATUSES: readonly SubscriptionStatus[]` = `["active", "trialing"]`.
  - `nextVersion(now: Date, stored: string | undefined): string` (now exported, body unchanged).
  - `type BillingStanding = { complimentary: boolean; pausedAt: string | null; subscriptionStatus: SubscriptionStatus | null; features: PlanFeatures }`; `readBillingStanding(db, accountId): Promise<BillingStanding | null>` (null = unbilled; throws on a read error).
  - `listPauseCandidates(db): Promise<AccountBilling[]>`.
  - `pauseBilling(db, { accountId, expectedUpdatedAt, now }): Promise<"paused" | "conflict">`.
  - `clearBillingPause(db, { accountId, expectedUpdatedAt, now, lift }): Promise<"cleared" | "conflict">`.
  - `undoLiftBillingPause(db, { accountId, liftedAt, pausedAt, now }): Promise<"repaused" | "stale">` (restores the pre-lift `pausedAt`, re-review m1).
  - `healPermissions(db, accountId): Promise<void>`.
  - `PAUSE_ALERT_FORWARD_MS` (30 days), `PAUSE_ALERT_END_MS` (44 days), `RECONCILE_ALERT_FRESH_MS` (48 h); `type BillingAlert = { accountId: string; accountName: string; kind: "payment_failed" | "paused" | "paused_no_forward" | "usage_mismatch"; since: string }`; `listBillingAlerts(db, now, opts: { enforced: boolean }): Promise<BillingAlert[]>` (with the switch off a long pause stays `paused` and never claims calls stopped forwarding, re-review m3).
  - `listReconcilableAccounts(db): Promise<AccountBilling[]>`.
  - From `billing-reconciliations.ts`: `RECONCILIATION_VERDICTS`, `ALERTING_VERDICTS`, `type ReconciliationVerdict`, `type ReconciliationWrite`, `type Reconciliation`, `saveReconciliation(db, w)`, `listReconciliations(db, accountId, now)` (the latest row per meter), `latestReconciliations(db, accountIds, now): Promise<Map<string, Reconciliation>>` (key `"<accountId>:<meter>"`, newest `window_start`; bounded: periods starting in the last `RECONCILE_LOOKBACK_MS` (70 days), accounts in groups of 50, pages of 1,000 until an empty page, re-review m6), `reconciledSince(db, sinceIso): Promise<Set<string>>` (key `"<accountId>:<meter>:<windowStartMs>"`), `reconcileNightStart(at: Date): Date` (the most recent 08:00 UTC at or before `at`; Task 2 review m3).
  - From `usage.ts`: `USAGE_HOLD_AFTER_MS` (20 h); `listReportableUsage(db, accounts, now, limit, opts?: { holdAfterMs?: number | null })`; `type UsageBands = { settled: number; inFlight: number; held: number; heldRows: UsageRow[] }`; `readUsageBands(db, { accountId, meter, startIso, endIso, now, settleMs }): Promise<UsageBands>`.

- [ ] **Step 1: Write the failing unit tests** in `packages/db/src/account-billing.test.ts` (extend `stored()` with the two new fields):
  1. "decideMirror stamps stripe_checked_at with now on every write (mutation: drop the field → FAILS)".
  2. "decideMirror clears billing_paused_at when Stripe says active or trialing (mutation: drop the clear → FAILS)".
  3. "decideMirror leaves billing_paused_at out of the row for past_due, unpaid, canceled, incomplete (mutation: always write null → FAILS)".
  4. "pauseBilling is compare-and-set on updated_at and moves it with nextVersion (mutation: drop `.eq('updated_at', …)` → FAILS)".
  5. "pauseBilling answers conflict when no row matched (mutation: return 'paused' on an empty result → FAILS)".
  6. "clearBillingPause with lift stamps pause_lifted_at; without lift it does not (mutation: always stamp → FAILS)".
  7. "undoLiftBillingPause refuses when the stored lift is not the one passed, comparing instants (mutation: compare the strings → FAILS on `…123Z` vs `…123+00:00`)".
  8. "undoLiftBillingPause refuses a row that is now active, complimentary, or has no subscription (mutation: drop the status check → FAILS)".
  8b. "undoLiftBillingPause restores the pre-lift billing_paused_at, not now (mutation: write now → FAILS: the 30-day forward clock restarts); a pausedAt after the lift, or unparseable, is stale (mutation: accept it → FAILS)".
  9. "readBillingStanding returns null with no row, the status and the plan's features from the embed, and throws on an error or a missing embed (mutation: default features to true when the embed is missing → FAILS)".
  10. "listPauseCandidates pages until an EMPTY page (mutation: stop on a short page → FAILS)".
  11. "listBillingAlerts: payment_failed for past_due/unpaid not paused; paused under 30 days; paused_no_forward from day 30 to day 44, nothing after (mutation: drop the 44-day end → FAILS)"; "switch off: a 35-day pause is `paused`, never `paused_no_forward` (mutation: ignore opts.enforced → FAILS)" (m3).
  12. "listBillingAlerts: usage_mismatch only from each (account, meter)'s newest night's rows, alerting verdict, checked within 48 h; a closed-period mismatch found tonight beside a matching current period alerts, and drops after the next night (mutation: newest window_start only → FAILS: tonight's closed-period mismatch is hidden; mutation: any alerting row → FAILS: it stays for ever)".
  `billing-reconciliations.test.ts`:
  13. "saveReconciliation upserts on (account_id, meter, window_start) with every field (mutation: onConflict 'account_id,meter' → FAILS)".
  14. "listReconciliations and latestReconciliations return the newest window_start per meter (mutation: order ascending → FAILS)"; "latestReconciliations reads only periods starting within 70 days, pages until an EMPTY page, and splits 120 accounts into three reads (mutation: stop on a short page → FAILS; mutation: one read of every account → FAILS by call count)" (m6).
  15. "reconciledSince keys by account, meter and window start, checked at or after the instant (mutation: gt instead of gte → FAILS)".
  `usage.test.ts` (unit):
  16. "listReportableUsage with holdAfterMs leaves out a row recorded that long ago or more (mutation: drop the created_at filter → FAILS)"; "without it (switch off) it does not filter (mutation: always filter → FAILS)".
  17. "readUsageBands sorts each row into settled, in flight or held by reported_at and created_at (mutation: count a row reported 1 h ago as settled → FAILS)".

- [ ] **Step 2: Run them** — `pnpm --filter @bis/db exec vitest run src/account-billing.test.ts src/billing-reconciliations.test.ts src/usage.test.ts`. Expected: FAIL (missing exports).

- [ ] **Step 3: Implement `account-billing.ts`.**

Types and columns (ONE literal, PR-3's lesson at `:83-84`):

```ts
export const PAID_STATUSES: readonly SubscriptionStatus[] = ["active", "trialing"];

export type AccountBilling = {
  // …existing fields…
  billingPausedAt: string | null;
  /** When the agency last lifted the pause (0099). */
  pauseLiftedAt: string | null;
  /** When the mirror last wrote what Stripe said (0099). */
  stripeCheckedAt: string | null;
  billingStartedAt: string;
  createdAt: string;
  updatedAt: string;
};

const BILLING_COLUMNS =
  "account_id, plan_id, complimentary, stripe_customer_id, stripe_subscription_id, subscription_status, current_period_start, current_period_end, past_due_since, billing_paused_at, pause_lifted_at, stripe_checked_at, billing_started_at, created_at, updated_at";
```

`toBilling` maps `pause_lifted_at → pauseLiftedAt`, `stripe_checked_at → stripeCheckedAt`; `AccountBillingDbRow` gains the two. `nextVersion` becomes `export function`.

`MirrorRow` gains `stripe_checked_at: string; billing_paused_at?: null;` and `decideMirror`'s row:

```ts
  const unpaid = PAST_DUE_STATUSES.includes(s.status);
  const paid = PAID_STATUSES.includes(s.status);
  return {
    kind: "write",
    permissions: plan.features,
    row: {
      // …existing fields unchanged…
      stripe_checked_at: now.toISOString(),
      // Payment clears the pause (spec flow 5; plan G2). Only a PAID status
      // clears it: the key is absent otherwise, so a past_due re-read never
      // un-pauses and an insert takes the column default (NULL).
      ...(paid ? { billing_paused_at: null } : {}),
      updated_at: nextVersion(now, existing?.updatedAt),
    },
  };
```

Update the `mirrorSubscription` doc (`:330`): "the row (billing_paused_at is cleared on a paid status and never set here) …".

The standing read:

```ts
export type BillingStanding = {
  complimentary: boolean; pausedAt: string | null; subscriptionStatus: SubscriptionStatus | null; features: PlanFeatures;
};

/**
 * What enforcement reads (plan G4, G5): the pause stamp, the status (for WHY
 * a pause is on) and the PLAN's features, in one embed read through
 * account_billing.plan_id. Never accounts.permissions, which the mirror
 * writes outside its compare-and-set (PR-3 B5). null = no row = unbilled.
 * A row always has a plan (plan_id not null, restrict), so a missing embed is
 * a read fault and throws; each caller decides what a throw means. Needs
 * serviceDb(): plans is agency-read only, and a client Staff session reads no
 * account_billing row at all (0066).
 */
export async function readBillingStanding(db: SupabaseClient, accountId: string): Promise<BillingStanding | null> {
  const { data, error } = await db.from("account_billing")
    .select("complimentary, billing_paused_at, subscription_status, plans(features)")
    .eq("account_id", accountId).maybeSingle();
  if (error) throw new Error(`billing: standing read failed: ${error.message}`);
  if (!data) return null;
  const r = data as unknown as {
    complimentary: boolean; billing_paused_at: string | null; subscription_status: SubscriptionStatus | null;
    plans: { features: PlanFeatures } | null;
  };
  if (!r.plans) throw new Error(`billing: standing read found no plan for account ${accountId}`);
  return {
    complimentary: r.complimentary, pausedAt: r.billing_paused_at,
    subscriptionStatus: r.subscription_status, features: r.plans.features,
  };
}
```

The candidates (paged until an EMPTY page):

```ts
const PAUSE_PAGE = 500;

/** Every row the pause pass (and the nightly re-read) may act on: not
 *  complimentary, with a subscription, and paused or in a status the pass
 *  reads (G1). Paged by account id until an actually EMPTY page (PR-1 rule). */
export async function listPauseCandidates(db: SupabaseClient): Promise<AccountBilling[]> {
  const out: AccountBilling[] = [];
  for (let from = 0; ; ) {
    const { data, error } = await db.from("account_billing").select(BILLING_COLUMNS)
      .eq("complimentary", false).not("stripe_subscription_id", "is", null)
      .or("billing_paused_at.not.is.null,subscription_status.in.(past_due,unpaid,canceled)")
      .order("account_id", { ascending: true }).range(from, from + PAUSE_PAGE - 1);
    if (error) throw new Error(`listPauseCandidates failed: ${error.message}`);
    const rows = (data ?? []) as AccountBillingDbRow[];
    if (rows.length === 0) return out;
    out.push(...rows.map(toBilling));
    from += rows.length;
  }
}
```

The writers:

```ts
/** Stamps the pause (the cron pass, G1). Compare-and-set on updated_at
 *  (PR-3 B5): a row the mirror or the agency changed since the pass read it
 *  is a conflict, re-decided next tick. Never on a complimentary row, never
 *  over an existing pause, and only on a row with a subscription that is
 *  unpaid or ended (Task 2 review m1): the row itself refuses, so a bug in
 *  the pause decision can never pause a paying or never-paid row. */
export async function pauseBilling(
  db: SupabaseClient, input: { accountId: string; expectedUpdatedAt: string; now: Date },
): Promise<"paused" | "conflict"> {
  const { data, error } = await db.from("account_billing")
    .update({ billing_paused_at: input.now.toISOString(), updated_at: nextVersion(input.now, input.expectedUpdatedAt) })
    .eq("account_id", input.accountId).eq("updated_at", input.expectedUpdatedAt)
    .eq("complimentary", false).is("billing_paused_at", null)
    .not("stripe_subscription_id", "is", null).in("subscription_status", ["past_due", "unpaid", "canceled"])
    .select("account_id");
  if (error) throw new Error(`pauseBilling failed: ${error.message}`);
  return (data ?? []).length === 1 ? "paused" : "conflict";
}

/** Clears the pause: `lift` = the agency's Lift pause (stamps
 *  pause_lifted_at, G3); otherwise the pass healing a paid row (G1/G2). */
export async function clearBillingPause(
  db: SupabaseClient, input: { accountId: string; expectedUpdatedAt: string; now: Date; lift: boolean },
): Promise<"cleared" | "conflict"> {
  const at = input.now.toISOString();
  const { data, error } = await db.from("account_billing")
    .update({
      billing_paused_at: null, updated_at: nextVersion(input.now, input.expectedUpdatedAt),
      ...(input.lift ? { pause_lifted_at: at } : {}),
    })
    .eq("account_id", input.accountId).eq("updated_at", input.expectedUpdatedAt)
    .not("billing_paused_at", "is", null)
    .select("account_id");
  if (error) throw new Error(`clearBillingPause failed: ${error.message}`);
  return (data ?? []).length === 1 ? "cleared" : "conflict";
}

/** Undo of a Lift (G3): re-pauses only while the row still carries THAT lift
 *  (compared as instants: PostgREST returns microseconds and +00:00), is not
 *  paused, is not complimentary, has a subscription and is still unpaid or
 *  ended. Anything else is "stale": the billing changed under the toast. It
 *  RESTORES the pause's own start (`pausedAt`, returned by the Lift), so the
 *  30-day forward clock (I7) does not restart (re-review m1). */
export async function undoLiftBillingPause(
  db: SupabaseClient, input: { accountId: string; liftedAt: string; pausedAt: string; now: Date },
): Promise<"repaused" | "stale"> {
  const pausedAtMs = Date.parse(input.pausedAt);
  if (Number.isNaN(pausedAtMs) || pausedAtMs > Date.parse(input.liftedAt)) return "stale";
  const row = await getAccountBilling(db, input.accountId);
  const sameLift = row?.pauseLiftedAt != null && Date.parse(row.pauseLiftedAt) === Date.parse(input.liftedAt);
  const status = row?.subscriptionStatus ?? null;
  const pausable = status !== null && (PAST_DUE_STATUSES.includes(status) || status === "canceled");
  if (!row || !sameLift || row.billingPausedAt || row.complimentary || !row.stripeSubscriptionId || !pausable) return "stale";
  const { data, error } = await db.from("account_billing")
    .update({ billing_paused_at: new Date(pausedAtMs).toISOString(), pause_lifted_at: null, updated_at: nextVersion(input.now, row.updatedAt) })
    .eq("account_id", input.accountId).eq("updated_at", row.updatedAt)
    .select("account_id");
  if (error) throw new Error(`undoLiftBillingPause failed: ${error.message}`);
  return (data ?? []).length === 1 ? "repaused" : "stale";
}

/** The nightly heal (G4): accounts.permissions rewritten from the row's
 *  CURRENT plan. No row = {} (unbilled). */
export async function healPermissions(db: SupabaseClient, accountId: string): Promise<void> {
  const row = await getAccountBilling(db, accountId);
  if (!row) return writePermissions(db, accountId, null);
  const plan = await readPlan(db, row.planId);
  if (!plan) throw new Error(`healPermissions: plan ${row.planId} of account ${accountId} not found`);
  await writePermissions(db, accountId, plan.features);
}
```

The alerts (each line ENDS, M8) and the reconcilable list:

```ts
const DAY = 24 * 60 * 60 * 1000;
/** I7: from here a paused account's calls are no longer forwarded (mirrors
 *  standing.ts's PAUSE_FORWARD_MS; a test pins the two equal). */
export const PAUSE_ALERT_FORWARD_MS = 30 * DAY;
/** The 30-day item leaves the work queue two weeks later (M8). */
export const PAUSE_ALERT_END_MS = 44 * DAY;
/** A reconciliation alert is shown while its newest check is this recent. */
export const RECONCILE_ALERT_FRESH_MS = 48 * 60 * 60 * 1000;

export type BillingAlert = {
  accountId: string; accountName: string;
  kind: "payment_failed" | "paused" | "paused_no_forward" | "usage_mismatch"; since: string;
};

/** The agency's work-queue banner (G13). Agency only: the caller has run
 *  requireAgency() and passes serviceDb(). Names come from accounts.name,
 *  the agency's own label (agency eyes only, never a client's). */
export async function listBillingAlerts(db: SupabaseClient, now: Date, opts: { enforced: boolean }): Promise<BillingAlert[]> {
  const t = now.getTime();
  const alerts: BillingAlert[] = [];
  for (let from = 0; ; ) {
    const { data, error } = await db.from("account_billing")
      .select("account_id, past_due_since, billing_paused_at, accounts(name)")
      .eq("complimentary", false)
      .or("billing_paused_at.not.is.null,subscription_status.in.(past_due,unpaid)")
      .order("account_id", { ascending: true }).range(from, from + PAUSE_PAGE - 1);
    if (error) throw new Error(`listBillingAlerts failed: ${error.message}`);
    const rows = (data ?? []) as unknown as {
      account_id: string; past_due_since: string | null; billing_paused_at: string | null; accounts: { name: string } | null;
    }[];
    if (rows.length === 0) break;
    for (const r of rows) {
      const accountName = r.accounts?.name ?? r.account_id;
      if (r.billing_paused_at) {
        const age = t - Date.parse(r.billing_paused_at);
        // m3: "calls are no longer forwarded" is true only while the switch enforces it.
        if (age < PAUSE_ALERT_FORWARD_MS || (!opts.enforced && age < PAUSE_ALERT_END_MS)) alerts.push({ accountId: r.account_id, accountName, kind: "paused", since: r.billing_paused_at });
        else if (age < PAUSE_ALERT_END_MS) alerts.push({ accountId: r.account_id, accountName, kind: "paused_no_forward", since: r.billing_paused_at });
      } else if (r.past_due_since) {
        alerts.push({ accountId: r.account_id, accountName, kind: "payment_failed", since: r.past_due_since });
      }
    }
    from += rows.length;
  }
  // Reconciliation: per (account, meter), the rows of its NEWEST night's run,
  // alerting, and fresh. "Its newest night" is the 08:00 UTC window
  // (reconcileNightStart) holding the key's newest check, exactly (Task 2
  // review m3; it replaced a 6-hour RUN_SPAN_MS, which split a run the budget
  // resumed later in the same window and joined 07:59 to 08:01). PAGED until
  // an EMPTY page (Task 2 review I: one read stops at PostgREST's max_rows and
  // silently dropped the oldest-checked alert, proved live with 1,200 rows),
  // in a stable total order: newest check first (the night logic relies on
  // it), then the key.
  const nightOf = new Map<string, number>();
  const flagged = new Set<string>();
  const freshSince = new Date(t - RECONCILE_ALERT_FRESH_MS).toISOString();
  for (let from = 0; ; ) {
    const { data, error } = await db.from("billing_reconciliations")
      .select("account_id, meter, checked_at, verdict, accounts(name)")
      .gte("checked_at", freshSince)
      .order("checked_at", { ascending: false }).order("account_id", { ascending: true })
      .order("meter", { ascending: true }).order("window_start", { ascending: true })
      .range(from, from + PAUSE_PAGE - 1);
    if (error) throw new Error(`listBillingAlerts reconciliation read failed: ${error.message}`);
    const rows = (data ?? []) as unknown as {
      account_id: string; meter: string; checked_at: string; verdict: string; accounts: { name: string } | null;
    }[];
    if (rows.length === 0) break;
    for (const r of rows) {
      const key = `${r.account_id}:${r.meter}`;
      const checked = Date.parse(r.checked_at);
      const night = nightOf.get(key) ?? reconcileNightStart(new Date(checked)).getTime();
      nightOf.set(key, night);
      if (checked < night) continue; // an earlier night's row for this key
      if (!(ALERTING_VERDICTS as readonly string[]).includes(r.verdict) || flagged.has(r.account_id)) continue;
      flagged.add(r.account_id);
      alerts.push({ accountId: r.account_id, accountName: r.accounts?.name ?? r.account_id, kind: "usage_mismatch", since: r.checked_at });
    }
    from += rows.length;
  }
  return alerts;
}
```

`reconcileNightStart(at)` lives in `billing-reconciliations.ts` (the most recent 08:00 UTC at or before `at`), so Task 8's `nightlyRunStart` can be it rather than a second definition that could drift.

Test 12 covers both shapes: a current-period mismatch (alerts every night it persists), and a closed-period mismatch found tonight beside a matching current period (alerts until the next night's run, then drops). Two more (review): "listBillingAlerts pages the reconciliation read until an EMPTY page in a stable order, so an alerting row past the server's max_rows still alerts (mutation: one unpaged read → FAILS; stop on a short page → FAILS; drop the tie-break orders → FAILS)", with a live twin of 1,200 rows; and "one night is the 08:00 UTC window holding a key's newest check, exactly (mutation: a 6-hour span between checks → FAILS; nights from midnight UTC → FAILS)".

```ts
/** Live subscriptions BIS bills usage for (G14): a subscription and a
 *  customer, not ended, not complimentary. Paged until an empty page. */
export async function listReconcilableAccounts(db: SupabaseClient): Promise<AccountBilling[]> {
  const out: AccountBilling[] = [];
  for (let from = 0; ; ) {
    const { data, error } = await db.from("account_billing").select(BILLING_COLUMNS)
      .eq("complimentary", false).not("stripe_subscription_id", "is", null).not("stripe_customer_id", "is", null)
      .not("subscription_status", "in", "(canceled,incomplete_expired)")
      .order("account_id", { ascending: true }).range(from, from + PAUSE_PAGE - 1);
    if (error) throw new Error(`listReconcilableAccounts failed: ${error.message}`);
    const rows = (data ?? []) as AccountBillingDbRow[];
    if (rows.length === 0) return out;
    out.push(...rows.map(toBilling));
    from += rows.length;
  }
}
```

(Import `ALERTING_VERDICTS` from `./billing-reconciliations`.)

- [ ] **Step 4: Create `packages/db/src/billing-reconciliations.ts`:**

```ts
import type { SupabaseClient } from "@supabase/supabase-js";
import type { MeterKey } from "./billing";

/** The nightly comparison per account, meter and billing period (0099).
 *  Service-role writes only; the agency reads (work queue, Billing card). */
export const RECONCILIATION_VERDICTS = [
  "match", "held_at_stripe", "held_missing", "stripe_over", "stripe_under", "ambiguous",
] as const;
export type ReconciliationVerdict = (typeof RECONCILIATION_VERDICTS)[number];
/** The three a person must look at (G13). */
export const ALERTING_VERDICTS: readonly ReconciliationVerdict[] = ["stripe_over", "stripe_under", "ambiguous"];

export type ReconciliationWrite = {
  accountId: string; meter: MeterKey; windowStart: string; windowEnd: string;
  bisSettled: number; bisInFlight: number; bisHeld: number; stripeTotal: number;
  verdict: ReconciliationVerdict; checkedAt: string;
};
export type Reconciliation = ReconciliationWrite;

const COLUMNS = "account_id, meter, window_start, window_end, bis_settled, bis_in_flight, bis_held, stripe_total, verdict, checked_at";

type Row = {
  account_id: string; meter: MeterKey; window_start: string; window_end: string; bis_settled: number | string;
  bis_in_flight: number | string; bis_held: number | string; stripe_total: number | string;
  verdict: ReconciliationVerdict; checked_at: string;
};

const toReconciliation = (r: Row): Reconciliation => ({
  accountId: r.account_id, meter: r.meter, windowStart: r.window_start, windowEnd: r.window_end,
  bisSettled: Number(r.bis_settled), bisInFlight: Number(r.bis_in_flight), bisHeld: Number(r.bis_held),
  stripeTotal: Number(r.stripe_total), verdict: r.verdict, checkedAt: r.checked_at,
});

export async function saveReconciliation(db: SupabaseClient, w: ReconciliationWrite): Promise<void> {
  const { error } = await db.from("billing_reconciliations").upsert({
    account_id: w.accountId, meter: w.meter, window_start: w.windowStart, window_end: w.windowEnd,
    bis_settled: w.bisSettled, bis_in_flight: w.bisInFlight, bis_held: w.bisHeld, stripe_total: w.stripeTotal,
    verdict: w.verdict, checked_at: w.checkedAt,
  }, { onConflict: "account_id,meter,window_start" });
  if (error) throw new Error(`saveReconciliation failed: ${error.message}`);
}

/** The newest period's row per meter, for the Billing card. */
export async function listReconciliations(db: SupabaseClient, accountId: string, now: Date): Promise<Reconciliation[]> {
  return [...(await latestReconciliations(db, [accountId], now)).values()];
}

/** Only periods that started this recently are read (two billing periods and
 *  slack): an older row can be neither the current nor the just-closed one. */
export const RECONCILE_LOOKBACK_MS = 70 * 24 * 60 * 60 * 1000;
const ACCOUNTS_PER_READ = 50;
const RECONCILE_PAGE = 1000;

/** Newest window_start per (account, meter); key "<accountId>:<meter>".
 *  Bounded (re-review m6): the lookback, accounts in groups, and pages of
 *  RECONCILE_PAGE until an actually EMPTY page (PR-1's rule). */
export async function latestReconciliations(
  db: SupabaseClient, accountIds: string[], now: Date,
): Promise<Map<string, Reconciliation>> {
  const out = new Map<string, Reconciliation>();
  const since = new Date(now.getTime() - RECONCILE_LOOKBACK_MS).toISOString();
  for (let i = 0; i < accountIds.length; i += ACCOUNTS_PER_READ) {
    const group = accountIds.slice(i, i + ACCOUNTS_PER_READ);
    for (let from = 0; ; ) {
      const { data, error } = await db.from("billing_reconciliations").select(COLUMNS)
        .in("account_id", group).gte("window_start", since)
        .order("account_id", { ascending: true }).order("meter", { ascending: true })
        .order("window_start", { ascending: false }).range(from, from + RECONCILE_PAGE - 1);
      if (error) throw new Error(`latestReconciliations failed: ${error.message}`);
      const rows = (data ?? []) as Row[];
      if (rows.length === 0) break;
      for (const r of rows) {
        const key = `${r.account_id}:${r.meter}`;
        if (!out.has(key)) out.set(key, toReconciliation(r));
      }
      from += rows.length;
    }
  }
  return out;
}

/** "<accountId>:<meter>:<windowStartMs>" for every row checked at or after
 *  `sinceIso` (this window's start, G14): the nightly step skips those.
 *  Paged until empty. */
export async function reconciledSince(db: SupabaseClient, sinceIso: string): Promise<Set<string>> {
  const out = new Set<string>();
  for (let from = 0; ; ) {
    const { data, error } = await db.from("billing_reconciliations").select("account_id, meter, window_start")
      .gte("checked_at", sinceIso).order("account_id", { ascending: true }).order("meter", { ascending: true })
      .order("window_start", { ascending: true }).range(from, from + 999);
    if (error) throw new Error(`reconciledSince failed: ${error.message}`);
    const rows = (data ?? []) as { account_id: string; meter: string; window_start: string }[];
    if (rows.length === 0) return out;
    for (const r of rows) out.add(`${r.account_id}:${r.meter}:${Date.parse(r.window_start)}`);
    from += rows.length;
  }
}
```

(`latestReconciliations` is bounded three ways: the 70-day lookback, 50 accounts per read, and 1,000-row pages until an empty page.)

- [ ] **Step 5: The usage hold and bands in `packages/db/src/usage.ts`.**

```ts
/** PR-3 B10 / plan G15: Stripe dedupes a meter event's identifier for "at
 *  least 24 hours" (assumption S7). With BILLING_ENFORCE on, a row still
 *  unreported this long after it was RECORDED is never resent by the report:
 *  only the nightly reconciliation, which first asks Stripe whether it
 *  already holds it, sends or stamps it. Four hours of margin under 24. */
export const USAGE_HOLD_AFTER_MS = 20 * 60 * 60 * 1000;
```

`listReportableUsage` gains a last parameter `opts: { holdAfterMs?: number | null } = {}`; when `opts.holdAfterMs` is a number it adds, after `.is("reported_at", null)`:

```ts
      .gt("created_at", new Date(now.getTime() - opts.holdAfterMs).toISOString())
```

and its doc says so. Then:

```ts
export type UsageBands = { settled: number; inFlight: number; held: number; heldRows: UsageRow[] };

/**
 * BIS's side of one (account, meter, window) reconciliation (G14), over rows
 * whose occurred_at is in [startIso, endIso): settled = reported at least
 * `settleMs` ago (Stripe has aggregated it, assumption S1); in flight =
 * reported more recently, or unreported and recorded under
 * USAGE_HOLD_AFTER_MS ago; held = unreported and recorded USAGE_HOLD_AFTER_MS
 * ago or more (G15), returned whole so reconciliation can stamp or send them.
 * Paged by id until an empty page.
 */
export async function readUsageBands(
  db: SupabaseClient,
  input: { accountId: string; meter: MeterKey; startIso: string; endIso: string; now: Date; settleMs: number },
): Promise<UsageBands> {
  const settledBefore = input.now.getTime() - input.settleMs;
  const holdBefore = input.now.getTime() - USAGE_HOLD_AFTER_MS;
  const bands: UsageBands = { settled: 0, inFlight: 0, held: 0, heldRows: [] };
  for (let from = 0; ; ) {
    const { data, error } = await db.from("usage_events").select(USAGE_COLUMNS)
      .eq("account_id", input.accountId).eq("meter", input.meter)
      .gte("occurred_at", input.startIso).lt("occurred_at", input.endIso)
      .order("id", { ascending: true }).range(from, from + USAGE_SUM_PAGE - 1);
    if (error) throw new Error(`readUsageBands failed: ${error.message}`);
    const rows = ((data ?? []) as UsageDbRow[]).map(toUsageRow);
    if (rows.length === 0) return bands;
    for (const r of rows) {
      if (r.reportedAt !== null) {
        if (Date.parse(r.reportedAt) <= settledBefore) bands.settled += r.quantity; else bands.inFlight += r.quantity;
      } else if (Date.parse(r.createdAt) <= holdBefore) {
        bands.held += r.quantity; bands.heldRows.push(r);
      } else {
        bands.inFlight += r.quantity;
      }
    }
    from += rows.length;
  }
}
```

(Use the module's existing row type and mapper — `USAGE_COLUMNS` `:86`, the mapper at `:88-92` — renaming `UsageDbRow`/`toUsageRow` to whatever they are called there.)

- [ ] **Step 6: Export from `packages/db/src/index.ts`** (extend the blocks at `:222-237`; `export * from "./billing-reconciliations";`): `USAGE_HOLD_AFTER_MS`, `readUsageBands`, `type UsageBands`; `PAID_STATUSES`, `nextVersion`, `readBillingStanding`, `listPauseCandidates`, `pauseBilling`, `clearBillingPause`, `undoLiftBillingPause`, `healPermissions`, `listBillingAlerts`, `listReconcilableAccounts`, `PAUSE_ALERT_FORWARD_MS`, `PAUSE_ALERT_END_MS`, `RECONCILE_ALERT_FRESH_MS`, `type BillingStanding`, `type BillingAlert`.

- [ ] **Step 7: Live tests** `packages/db/src/test/billing-pause.test.ts` (CI only), each with its mutation:
  1. "readBillingStanding reads the plan's features and the status through the embed for a PAID and a complimentary row, and null with no row (mutation: select plan_id only → FAILS)".
  2. "pauseBilling then clearBillingPause(lift) round-trip through PostgREST and each moves updated_at forward (mutation: write `now` instead of nextVersion → FAILS when the stored updated_at is in the future)".
  3. "a mirror write between the pass's read and its write makes pauseBilling a conflict (mutation: drop the updated_at filter → FAILS)".
  4. "listPauseCandidates returns paused, past_due, unpaid and canceled rows and never a complimentary or subscription-less one (mutation: drop `.eq('complimentary', false)` → FAILS)".
  5. "listReportableUsage with the hold skips a row recorded 21 hours ago and returns one recorded 19 hours ago (mutation: hold at 24 h → FAILS)".
  6. "listBillingAlerts names the account by accounts.name (mutation: embed brand_name → FAILS)".
  7. "saveReconciliation keeps two periods of one meter apart (mutation: onConflict without window_start → FAILS: the closed period's row is overwritten)".

- [ ] **Step 8: Run** — Step 2's suites (PASS), `pnpm --filter @bis/db exec tsc --noEmit`, `pnpm --filter web exec tsc --noEmit`. Affected web tests (the `AccountBilling` literals): `lib/billing/billing-view.test.ts`, `billing-link.test.ts`, `billing/page.test.ts`, `layout.test.ts`, `settings/billing-actions.test.ts`, `settings/billing-section.test.ts`; `api/cron/reminders/route.test.ts` (its `@bis/db` factory is untouched by this task).

- [ ] **Step 9: Commit** — `git commit -m "M7a PR-4: billing standing read, compare-and-set pause writers, the mirror clears the pause, alerts that end, the reconciliation store per period and the usage hold"`.

### Task 3: Copy, English and Spanish (LOW, bis-frontend)

**Files:**
- Modify: `apps/web/src/lib/messages.ts` (every key below; Task 1 already added the two `screened.reason.*`), `apps/web/src/lib/i18n/catalogue-baseline.json` (regenerated), `apps/web/src/lib/consent/copy.test.ts:41-54` (42 → 44 and its prose).
- Test: `apps/web/src/lib/messages.test.ts` (new `describe("M7a PR-4 copy")`).

- [ ] **Step 1: Add the keys** (English, then the `.es` twin directly below it). Next to the existing `billing.banner.*` (`messages.ts:3974-3977`):

| Key | English | Spanish (`.es`) |
|---|---|---|
| `billing.banner.client` | (unchanged) | Su pago no se completó. Actualice su tarjeta para que las automatizaciones sigan funcionando. |
| `billing.banner.clientAction` | (unchanged) | Ir a Facturación |
| `billing.banner.agency` | (unchanged) | El último pago de este cliente no se completó. |
| `billing.banner.agencyAction` | (unchanged) | Ver facturación |
| `billing.paused.client.payment` | Your account is paused because a payment didn't go through. Your receptionist isn't answering calls, texts to your customers are stopped, automations are waiting, and nothing here can be changed until it's paid. | Su cuenta está en pausa porque un pago no se completó. Su recepcionista no está contestando llamadas, los mensajes a sus clientes están detenidos, las automatizaciones están en espera, y aquí no se puede cambiar nada hasta que se pague. |
| `billing.paused.client.ended` | Your plan has ended, so your account is paused. Your receptionist isn't answering calls, texts to your customers are stopped, automations are waiting, and nothing here can be changed. | Su plan terminó, así que su cuenta está en pausa. Su recepcionista no está contestando llamadas, los mensajes a sus clientes están detenidos, las automatizaciones están en espera, y aquí no se puede cambiar nada. |
| `billing.paused.client.action` | Go to Billing | Ir a Facturación |
| `billing.paused.client.staff` | The account owner can turn everything back on from the Billing page. | El dueño de la cuenta puede volver a activar todo desde la página de Facturación. |
| `billing.paused.agency` | This client is paused: the receptionist isn't answering, texts to their customers are stopped, automations are waiting, and their dashboard is read-only. | Este cliente está en pausa: la recepcionista no está contestando, los mensajes a sus clientes están detenidos, las automatizaciones están en espera, y su panel es de solo lectura. |
| `billing.paused.agencyAction` | See billing | Ver facturación |
| `billing.page.paused.payment` | Your account is paused until the payment goes through. Update your card below to turn everything back on. | Su cuenta está en pausa hasta que se complete el pago. Actualice su tarjeta abajo para volver a activar todo. |
| `billing.page.paused.ended` | Your plan has ended, so your account is paused. To start again, contact us. | Su plan terminó, así que su cuenta está en pausa. Para volver a empezar, comuníquese con nosotros. |
| `billing.card.pausedPayment` | Paused since {date}: the payment failed on {failed}. | En pausa desde el {date}: el pago falló el {failed}. |
| `billing.card.pausedEnded` | Paused since {date}: the plan ended. | En pausa desde el {date}: el plan terminó. |
| `billing.card.noForward` | Calls are no longer forwarded: the account has been paused for over 30 days. | Las llamadas ya no se desvían: la cuenta lleva más de 30 días en pausa. |
| `billing.card.pauseOff` | Pausing is switched off here, so this pause changes nothing. | La pausa está desactivada aquí, así que no cambia nada. |
| `billing.card.lifted` | Pause lifted {date}. | Pausa quitada el {date}. |
| `billing.card.liftPause` | Lift pause | Quitar la pausa |
| `billing.card.liftPauseHelp` | Turns calls, texts and automations back on now. It stays lifted until they pay or another payment fails. | Vuelve a activar llamadas, mensajes y automatizaciones ahora. Sigue así hasta que paguen o falle otro pago. |
| `billing.card.liftedToast` | Pause lifted. | Pausa quitada. |
| `billing.card.repausedToast` | Paused again. | En pausa de nuevo. |
| `billing.card.reconcile.title` | Usage doesn't match Stripe | El uso no coincide con Stripe |
| `billing.card.reconcile.line` | {meter}: Stripe counts {stripe}, BIS counts {bis}. Checked {when}. | {meter}: Stripe cuenta {stripe}, BIS cuenta {bis}. Revisado el {when}. |
| `billing.card.reconcile.help` | Check this client's invoice in Stripe before it's finalised. The billing runbook says how. | Revise la factura de este cliente en Stripe antes de que se cierre. La guía de facturación explica cómo. |
| `billing.card.reconcile.meter.voice_minutes` | Call minutes | Minutos de llamadas |
| `billing.card.reconcile.meter.sms` | Texts | Mensajes de texto |
| `billing.card.reconcile.meter.ai_chats` | Website chats | Chats del sitio web |
| `billing.error.notPaused` | This account isn't paused any more. Refresh to see its billing. | Esta cuenta ya no está en pausa. Actualice la página para ver su facturación. |
| `billing.error.cannotRepause` | This account's billing changed, so it can't be paused again from here. Refresh to see it. | La facturación de esta cuenta cambió, así que no se puede volver a pausar desde aquí. Actualice la página para verla. |
| `automations.reason.heldBillingPaused` | Held: the account is paused until a payment goes through | En espera: la cuenta está en pausa hasta que se reciba un pago |
| `automations.reason.skippedBillingPaused` | Not sent: too late, the account was paused | No se envió: demasiado tarde, la cuenta estaba en pausa |
| `compose.smsBlockedPaused` | Texts are stopped while this account is paused for billing. | Los mensajes están detenidos mientras esta cuenta está en pausa por facturación. |

Agency-only (`work.agency.` prefix, English only):

| Key | English |
|---|---|
| `work.agency.billing.paymentFailed` | Payment failed: |
| `work.agency.billing.paused` | Paused: |
| `work.agency.billing.pausedNoForward` | Paused 30+ days, calls are no longer forwarded: |
| `work.agency.billing.mismatch` | Usage doesn't match Stripe: |
| `work.agency.billing.more` | and {n} more |

- [ ] **Step 2: Tests** in `messages.test.ts`: "every PR-4 key is the plan's wording, in both languages" (exact-string table); "a placeholder in English is a placeholder in Spanish (drop {failed} from billing.card.pausedPayment.es → FAILS)"; "the Spanish is usted, never tú (`/\b(actualiza|usa|ve|tu|tus)\b/i` matches no `.es` → else FAILS)"; "the paused banner never promises a forward (no `.paused.` value contains 'phone' / 'teléfono' → else FAILS)" (M3). `copy.test.ts:54`: 42 → 44, prose names `heldBillingPaused` and `skippedBillingPaused` (PR-4).

- [ ] **Step 3: Regenerate the baseline** — `pnpm --filter web exec tsx scripts/generate-i18n-baseline.ts`. Expected diff: the four `billing.banner.*` entries leave `catalogue-baseline.json`; nothing is added.

- [ ] **Step 4: Run** — `pnpm --filter web exec vitest run src/lib/messages.test.ts src/lib/consent/copy.test.ts src/lib/i18n` and `pnpm --filter web lint`.

- [ ] **Step 5: Commit** — `git commit -m "M7a PR-4: the pause's copy in English and Spanish"`.

### Task 4: The switch, the pure policy, and the `billingPause` pass (HIGH, bis-automations)

**Files:**
- Create: `apps/web/src/lib/billing/enforce.ts`, `apps/web/src/lib/billing/standing.ts` (+ `.test.ts`), `apps/web/src/lib/automations/passes/billing-pause.ts` (+ `.test.ts`).
- Modify: `apps/web/src/lib/automations/registry.ts` (doc + `PASSES` `:63`), `apps/web/src/lib/automations/sentinel.test.ts:296`, `apps/web/src/app/api/cron/reminders/route.test.ts` (its bare `@bis/db` factory gains `listPauseCandidates: vi.fn(async () => [])`, `pauseBilling`, `clearBillingPause`), `apps/web/src/app/api/cron/reminders/route.ts:10-15` and `passes/release-held.ts` comments ("the FIRST pass" → "the release pass").

**Interfaces:**
- Produces:
  - `billingEnforced(env?: NodeJS.ProcessEnv): boolean`.
  - `PAUSE_GRACE_MS` (7 d), `STRIPE_FRESH_MS` (26 h), `PAUSE_FORWARD_MS` (30 d), `type PauseDecision = "pause" | "unpause" | "keep" | "unconfirmed"`, `decidePause(row: AccountBilling, now: Date): PauseDecision`, `pauseCause(row: { subscriptionStatus: SubscriptionStatus | null }): "payment" | "ended"`.
  - `type BillingVerdict = { paused: boolean; voice: boolean; concierge: boolean; forward: boolean }`, `ALL_ON`, `billingVerdict(standing: BillingStanding | null, enforced: boolean, now: Date): BillingVerdict`, `voiceBlock(v: BillingVerdict): { reason: "billing-paused" | "plan-no-voice"; forward: boolean } | null`.
  - `billingPausePass: Pass` (key `"billingPause"`).

- [ ] **Step 1: Failing tests** `standing.test.ts` (a `row()` builder over `AccountBilling`, `NOW = 2026-10-26T12:00Z`):
  1. "billingEnforced is on for exactly '1' (mutation: accept 'true' → FAILS)".
  2. "past_due for 7 days, confirmed by Stripe after day 7 and within 26 h, never lifted → pause (mutation: `>` instead of `>=` on the grace → FAILS at exactly 7 days)".
  3. "6 days 23 hours → keep (mutation: grace of 6 days → FAILS)".
  4. "I1: Stripe confirmed on day 6 (before the grace ended), 20 h ago → unconfirmed, not pause (mutation: drop `checked − since ≥ grace` → FAILS)".
  5. "confirmed after day 7 but 27 h ago, or never → unconfirmed (mutation: skip the freshness check → FAILS)".
  6. "lifted after past_due_since → keep; lifted BEFORE it (an earlier stretch) → pause (mutation: compare with billing_paused_at → FAILS)".
  7. "canceled with period end passed → pause; period end tomorrow → keep; null end → pause (mutation: `<` instead of `<=` → FAILS at the exact end)".
  8. "canceled and lifted after its end → keep (mutation: ignore lifts on ended plans → FAILS)".
  9. "paused and now active or trialing → unpause; paused and past_due → keep (mutation: unpause on any non-null status → FAILS)".
  10. "incomplete, incomplete_expired, Stripe's paused, active → keep; complimentary or no subscription → keep (mutation: treat incomplete_expired as ended → FAILS)".
  11. "billingVerdict: switch off → ALL_ON whatever the row (mutation: drop the enforced check → FAILS)"; "no row → ALL_ON (mutation: pause a null standing → FAILS)"; "paused → voice, concierge off (mutation: keep concierge on → FAILS)"; "plan without voice → voice off, forward on, concierge per plan (mutation: forward off for plan-no-voice → FAILS)"; "complimentary follows its plan (mutation: ALL_ON for complimentary → FAILS)".
  12. "I7: paused 29 days 23 h → forward; paused exactly 30 days → no forward (mutation: `<=` → FAILS at exactly 30 days)".
  13. "voiceBlock prefers billing-paused over plan-no-voice, carrying forward (mutation: swap the order → FAILS)".
  14. "PAUSE_FORWARD_MS equals @bis/db's PAUSE_ALERT_FORWARD_MS (mutation: change one → FAILS)".
  `billing-pause.test.ts` (`@bis/db` mocked with `listPauseCandidates`, `pauseBilling`, `clearBillingPause`):
  15. "switch off: counts wouldPause, wouldUnpause and unconfirmed, writes NOTHING (mutation: write regardless of the switch → FAILS)".
  16. "switch on: pauses each 'pause' row with its own stored updated_at (mutation: pass ctx.now as the expected version → FAILS)".
  17. "a conflict is counted `raced`, never retried in the tick (mutation: loop on conflict → FAILS)".
  18. "unconfirmed rows are counted and logged with console.log, never console.error, and not paused (mutation: pause unconfirmed → FAILS; mutation: console.error → FAILS)" (m4).
  19. "one row's write throwing is counted `failed` and the next row still runs (mutation: let it propagate → FAILS)".
  `sentinel.test.ts:296`: `["billingPause", "releaseHeld", …the existing 17…]` ("mutation: register billingPause after releaseHeld → FAILS").

- [ ] **Step 2: Run** — `pnpm --filter web exec vitest run src/lib/billing/standing.test.ts src/lib/automations/passes/billing-pause.test.ts src/lib/automations/sentinel.test.ts`. Expected: FAIL.

- [ ] **Step 3: `apps/web/src/lib/billing/enforce.ts`:**

```ts
/**
 * THE SWITCH (spec section 4: "the non-payment pause, behind its own switch";
 * owner answer Q8). `BILLING_ENFORCE=1` turns on, together: the pause pass's
 * writes; every reader of the billing verdict (the SMS and email gates and the
 * automation hold, the TeXML route, the concierge, the AI summary, read-only
 * client actions, the paused banner); the usage report's 20-hour hold; and
 * the nightly step (re-reads, reconciliation, held sends, permission heal).
 * Exactly "1" is on. Off is the whole rollback. Needs a redeploy.
 */
export function billingEnforced(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.BILLING_ENFORCE === "1";
}
```

- [ ] **Step 4: `apps/web/src/lib/billing/standing.ts`:**

```ts
import {
  PAID_STATUSES, PAST_DUE_STATUSES, type AccountBilling, type BillingStanding, type SubscriptionStatus,
} from "@bis/db";

/**
 * What a billed account may do, decided from STORED rows only (no Stripe
 * call). Pure. Plan G1 (when to pause), G5 (the verdict), G6 (freshness),
 * G9 (why a call is not Sofía's, and whether it may still ring the business).
 */

const DAY_MS = 24 * 60 * 60 * 1000;
/** Spec section 3 flow 5: "≥ 7 days old". */
export const PAUSE_GRACE_MS = 7 * DAY_MS;
/** G6: Stripe's word on the unpaid status must be this recent. The nightly
 *  step re-reads every unpaid subscription once a day; two hours of slack. */
export const STRIPE_FRESH_MS = 26 * 60 * 60 * 1000;
/** I7: a paused account's calls ring the business for this long, then the
 *  caller hears the call-back message instead. */
export const PAUSE_FORWARD_MS = 30 * DAY_MS;

export type PauseDecision = "pause" | "unpause" | "keep" | "unconfirmed";

const at = (iso: string | null): number | null => (iso === null ? null : Date.parse(iso));

export function decidePause(row: AccountBilling, now: Date): PauseDecision {
  if (row.complimentary || !row.stripeSubscriptionId || row.subscriptionStatus === null) return "keep";
  const status = row.subscriptionStatus;
  const t = now.getTime();
  const lifted = at(row.pauseLiftedAt);
  if (row.billingPausedAt) return PAID_STATUSES.includes(status) ? "unpause" : "keep";
  if (PAST_DUE_STATUSES.includes(status)) {
    const since = at(row.pastDueSince);
    if (since === null || t - since < PAUSE_GRACE_MS) return "keep";
    if (lifted !== null && lifted >= since) return "keep";
    const checked = at(row.stripeCheckedAt);
    // G6 / review I1: Stripe said "still unpaid" AFTER the grace ended, and recently.
    if (checked === null || checked - since < PAUSE_GRACE_MS || t - checked > STRIPE_FRESH_MS) return "unconfirmed";
    return "pause";
  }
  if (status === "canceled") {
    const end = at(row.currentPeriodEnd);
    if (end !== null && end > t) return "keep";
    if (lifted !== null && (end === null || lifted >= end)) return "keep";
    return "pause";
  }
  return "keep";
}

/** Why a paused account is paused (banner, card, page). */
export function pauseCause(row: { subscriptionStatus: SubscriptionStatus | null }): "payment" | "ended" {
  return row.subscriptionStatus === "canceled" ? "ended" : "payment";
}

export type BillingVerdict = { paused: boolean; voice: boolean; concierge: boolean; forward: boolean };
export const ALL_ON: BillingVerdict = Object.freeze({ paused: false, voice: true, concierge: true, forward: true });

/** G5. Unbilled (null) and switch-off are ALL_ON. Complimentary rows follow
 *  their plan and are never paused (0051's CHECK). */
export function billingVerdict(standing: BillingStanding | null, enforced: boolean, now: Date): BillingVerdict {
  if (!enforced || standing === null) return ALL_ON;
  const pausedAt = at(standing.pausedAt);
  const paused = pausedAt !== null;
  return {
    paused,
    voice: !paused && standing.features.voice_receptionist === true,
    concierge: !paused && standing.features.web_concierge === true,
    forward: !paused || now.getTime() - pausedAt < PAUSE_FORWARD_MS,
  };
}

/** The recorded reason a call is not Sofía's (0099's two values), and
 *  whether it may still be forwarded (G9). */
export function voiceBlock(v: BillingVerdict): { reason: "billing-paused" | "plan-no-voice"; forward: boolean } | null {
  if (v.paused) return { reason: "billing-paused", forward: v.forward };
  return v.voice ? null : { reason: "plan-no-voice", forward: true };
}
```

- [ ] **Step 5: `apps/web/src/lib/automations/passes/billing-pause.ts`:**

```ts
import { billingEnforced } from "@/lib/billing/enforce";
import { decidePause } from "@/lib/billing/standing";
import type { Pass } from "../context";

/**
 * The non-payment pause (spec section 3 flows 5-6; plan G1, G16). FIRST in
 * the registry: a pause stamped this tick is read by every send gate in the
 * same tick (the release pass then re-holds rather than sends). No Stripe
 * call, no wall-clock budget: one paged read of the candidate rows and a
 * compare-and-set write per change.
 *
 * Switch OFF (BILLING_ENFORCE): counts what it WOULD do and writes nothing.
 * With it off the nightly re-read does not run, so past-due accounts mostly
 * count as `unconfirmed` (their stamp is only as fresh as the last webhook);
 * the log names every account past the grace either way.
 *
 * Every @bis/db export is dereferenced inside run(), never at module scope.
 */
export const billingPausePass: Pass = {
  key: "billingPause",
  async run(ctx) {
    const { listPauseCandidates, pauseBilling, clearBillingPause } = await import("@bis/db");
    const c = { paused: 0, unpaused: 0, raced: 0, unconfirmed: 0, failed: 0, wouldPause: 0, wouldUnpause: 0 };
    const enforced = billingEnforced();
    for (const row of await listPauseCandidates(ctx.db)) {
      const decision = decidePause(row, ctx.now);
      if (decision === "keep") continue;
      if (decision === "unconfirmed") {
        c.unconfirmed++;
        // m4: expected every tick until the nightly re-read confirms it, so an
        // info line (and the counter), never console.error each tick.
        console.log(`billing pause: account ${row.accountId} is past the grace but Stripe has not confirmed it since; not paused this tick`);
        continue;
      }
      if (!enforced) {
        if (decision === "pause") c.wouldPause++; else c.wouldUnpause++;
        console.log(`billing pause (switch off): would ${decision} account ${row.accountId}`);
        continue;
      }
      try {
        const r = decision === "pause"
          ? await pauseBilling(ctx.db, { accountId: row.accountId, expectedUpdatedAt: row.updatedAt, now: ctx.now })
          : await clearBillingPause(ctx.db, { accountId: row.accountId, expectedUpdatedAt: row.updatedAt, now: ctx.now, lift: false });
        if (r === "conflict") { c.raced++; continue; }
        if (decision === "pause") { c.paused++; console.log(`billing pause: paused account ${row.accountId}`); }
        else { c.unpaused++; console.log(`billing pause: cleared the pause of paid account ${row.accountId}`); }
      } catch (e) {
        c.failed++;
        console.error(`billing pause: ${decision} failed for account ${row.accountId}: ${String(e)}`);
      }
    }
    return c;
  },
};
```

(Follow `usage-report.ts:1-3`'s static-import convention if it is the house style; the rule is no module-scope dereference.)

- [ ] **Step 6: Register it first** — `PASSES = [billingPausePass, releaseHeldPass, …]`; doc paragraph: "The billing pause runs FIRST: a pause it stamps this tick is read by every send gate below in the same tick. It touches no automation state, so the release-first contract below is unchanged between the release pass and the recipes." Update the "FIRST pass" wording in `route.ts:10-15`, `release-held.ts` and `cron-coupling.test.ts:300`'s title (assertion unchanged).

- [ ] **Step 7: Run** — Step 2's tests plus `src/app/api/cron/reminders/route.test.ts`, `src/lib/automations/harness.test.ts`, `src/lib/automations/cron-coupling.test.ts`.

- [ ] **Step 8: Commit** — `git commit -m "M7a PR-4: the switch, the pause policy (confirmed after the grace), and the billingPause pass, first in the tick"`.

### Task 5: The two send gates and the pause hold (HIGH, bis-comms for the gates; bis-automations for Steps 6-7b, the hold and the passes, in the same lane)

**Files:**
- Create: `apps/web/src/lib/automations/pause-hold.ts` (+ `.test.ts`).
- Modify (the passes, Step 7b): `apps/web/src/lib/automations/hold-or-send.ts` (`HoldSubject.pauseDeadline`), `passes/review-request.ts`, `passes/referral-ask.ts`, `passes/no-show-nudge.ts`, `passes/quote-followup.ts`, `passes/reminders.ts`, `passes/sms-reminder.ts`, `passes/appointment-confirm.ts` (each subject builder, used by its run AND its releaser), `passes/reactivation.ts` (a held row gives back its tick slot and day count), and their tests.
- Modify (added after Task 5's review): `apps/web/src/lib/voice/textback.ts` (a paused text-back is held to the next whole UTC hour, as Step 7 says), `apps/web/src/lib/document-requests/deliver.ts` (`SMS_REASON.billing_paused`), `apps/web/src/lib/messages.ts` (`automations.reason.billingPaused`, `documents.request.reason.accountPaused`, each with its `.es`; `lib/consent/copy.test.ts` pins 45), and their tests.
- Modify: `apps/web/src/lib/consent/classes.ts` (two functions), `apps/web/src/lib/consent/gate.ts:89-97` (reason), `:186-200` (step 3b) and its doc (`:17-57`), `apps/web/src/lib/consent/email-gate.ts:86-92` and `:252-260`, `apps/web/src/lib/automations/hold-or-send.ts:106-143, 255-276, 345-372`, `apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/conversations/actions.ts:238-252`, `in-account-service-reads.test.ts` (`lib/consent/gate.ts` gains a service client: entry `"configuration"`, "the account's billing pause flag, read on the service client so a Staff composer cannot read it as unbilled"; `email-gate.ts` is already listed — confirm).
- Test: `lib/consent/gate.test.ts`, `email-gate.test.ts`, `classes.test.ts`, `lib/automations/hold-or-send.test.ts`, `conversations/actions.test.ts`; run `lib/consent/scans.test.ts`.

**Interfaces:**
- Consumes: `billingEnforced` (Task 4), `readBillingStanding`, `serviceDb` (Task 2), keys (Task 3).
- Produces: `SmsBlockReason` and `EmailBlockReason` gain `"billing_paused"`; `smsStopsWhilePaused(kind)`; `emailStopsWhilePaused(kind)`; `pauseHoldUntil(now: Date): Date` (the next whole UTC hour); `pauseHold(pauseDeadline: Date | null | undefined, now: Date): { kind: "held"; until: Date } | { kind: "skipped" }`; `pauseHoldInForce(row: AutomationLogRow | null, now: Date): boolean`; `HoldSubject.pauseDeadline?: Date | null`.

- [ ] **Step 1: Failing tests.**
  - `classes.test.ts`: "smsStopsWhilePaused: all 15 kinds, by name (mutation: let staff.composer_sms through → FAILS)" — literal table: `true` for the 7 `automation.*`, `voice.textback`, `staff.composer_sms`, `staff.document_request_sms`; `false` for `operator.alert_sms`, `operator.alert_phone_code`, `consent.stop_confirmation`, `consent.start_confirmation`, `consent.help`. "emailStopsWhilePaused: exactly the automation.* kinds (mutation: stop booking.confirmation or staff.document_request_email → FAILS)" — literal table of every email kind.
  - `pause-hold.test.ts`: "no deadline → held until the next whole UTC hour (mutation: now + 60 min → FAILS)"; "two holds 15 minutes apart in the same hour give the same instant, so writeHeld writes once (mutation: now + 60 min → FAILS: two writes)" (re-review I1; through `writeHeld` with a recording `recordAutomationLog`); "at exactly the hour → the NEXT hour (mutation: ceil instead of floor + 1 h → FAILS: held until now, released at once)"; "a deadline before the next hour → held until the deadline (mutation: ignore the deadline → FAILS)"; "a deadline at or before now → skipped (mutation: `<` instead of `<=` → FAILS at the exact instant)"; "pauseHoldInForce: held, the pause reason, held_until in the future → true; any other reason, a past held_until, or another status → false (mutation: ignore the reason → FAILS: a quiet-hours hold would skip the gate)".
  - `gate.test.ts` (its `@bis/db` mock gains `readBillingStanding: vi.fn()` and `serviceDb: vi.fn(() => SVC)`; set/restore `process.env.BILLING_ENFORCE` per test): "switch on and paused: an automation text is blocked billing_paused BEFORE the A2P read (mutation: put the check after resolveSmsSender → FAILS: the sender mock is called)"; "the billing read uses serviceDb(), not the caller's client (mutation: pass `db` → FAILS: called with the caller's client)" (M9); "switch on and paused: operator.alert_sms and consent.help still clear (mutation: block every kind → FAILS)"; "switch on, not paused, or unbilled (null) → clears (mutation: block on a null standing → FAILS)"; "switch OFF and paused → clears, and readBillingStanding is never called (mutation: read regardless of the switch → FAILS)"; "an unreadable billing row blocks ledger_unavailable (mutation: fail open → FAILS)".
  - `email-gate.test.ts`: the same six, with `automation.reminder` blocked and `booking.confirmation`, `staff.document_request_email`, `operator.lead_alert` passing.
  - `hold-or-send.test.ts`: "SMS billing_paused → a held row until the next whole UTC hour with the held reason, never skipped (mutation: map it to BLOCK_REASONS → FAILS)" (I6); "email billing_paused → the same (mutation: skip it → FAILS)"; "billing_paused with a pause deadline already passed → skipped with skippedBillingPaused (mutation: hold it → FAILS)"; "a pause hold in force returns held without calling send() (mutation: drop the short-circuit → FAILS: the gate stub is called)" (re-review I1); "a subject with a deadline but no pauseDeadline uses its deadline (mutation: ignore deadline → FAILS)"; "a held row released while still paused is held again; released after the lift is sent (mutation: stamp it skipped on the second refusal → FAILS)" (through `holdOrSend` twice with a gate stub that flips).
  - `conversations/actions.test.ts`: "a paused account's composer text says why (mutation: fall through to composerBlockedLine → FAILS)".

- [ ] **Step 2: Run** — `pnpm --filter web exec vitest run src/lib/consent src/lib/automations/hold-or-send.test.ts src/lib/automations/pause-hold.test.ts "src/app/(dashboard)/dashboard/accounts/[accountId]/conversations/actions.test.ts"`. Expected: FAIL.

- [ ] **Step 3: `classes.ts`:**

```ts
/**
 * The non-payment pause (M7a PR-4, plan G7; owner answer Q1): every text to
 * the business's CUSTOMERS stops; the owner's own alerts (operator) and the
 * STOP/START/HELP answers (consent_reply) still go. Read only by the send
 * gate, after the switch.
 */
export function smsStopsWhilePaused(kind: SmsKind): boolean {
  const c = SMS_KINDS[kind].class;
  return c !== "operator" && c !== "consent_reply";
}

/** G8: only the automation kinds (which holdOrSend then HOLDS, G7a). Every
 *  other email keeps going (owner answer Q6), staff.document_request_email
 *  included: it is an email to the customer; its SMS twin stops above. */
export function emailStopsWhilePaused(kind: EmailKind): boolean {
  return kind.startsWith("automation.");
}
```

- [ ] **Step 4: `gate.ts`.** Reason union: `| "billing_paused"` (doc: "M7a PR-4: the account is paused for non-payment (BILLING_ENFORCE on)"). Step 3b, right after the suppression block (`:192-197`), before `resolveSmsSender`:

```ts
  // 3b. The non-payment pause (M7a PR-4, plan G7). Only with the switch on,
  // so with it off nothing here is read. On the SERVICE client (a Staff
  // caller's RLS client reads no billing row). FAILS CLOSED like step 3; an
  // automation refused here is HELD by holdOrSend (G7a), not dropped.
  if (billingEnforced() && smsStopsWhilePaused(req.kind)) {
    try {
      if ((await readBillingStanding(serviceDb(), req.accountId))?.pausedAt) return { kind: "blocked", reason: "billing_paused" };
    } catch (e) {
      console.error(`consent gate: ${req.kind} for account ${req.accountId} blocked, billing state unreadable: ${loggableError(e)}`);
      return { kind: "blocked", reason: "ledger_unavailable" };
    }
  }
```

Add item "3b" to the doc list. `deliver`'s recheck path stays as it is.

- [ ] **Step 5: `email-gate.ts`** — reason union gains `"billing_paused"`; inside `if (req.accountId)` (`:252-260`), after the suppression check, the same block with `emailStopsWhilePaused(req.kind)` and `readBillingStanding(serviceDb(), req.accountId)`.

- [ ] **Step 6: `pause-hold.ts`:**

```ts
/**
 * Owner answer I6: an automation due while its account is paused is HELD,
 * with S-47d's closure-hold shape (closures.ts:181-215): held until the
 * earlier of the next whole hour and the subject's pause deadline; skipped
 * once that deadline has passed (it is no longer timely). The release pass
 * re-runs it at held_until: still paused → held again (no write within the
 * hour); lifted (the Lift bumps held rows), paid or switch off → sent.
 */
import type { AutomationLogRow } from "@bis/db";
import { m } from "@/lib/messages";

const HOUR_MS = 60 * 60 * 1000;

/** Re-review I1: a FIXED grid, the next whole UTC hour after now. Every
 *  repeat hold within one hour computes the same instant, so writeHeld writes
 *  nothing ("same held_until", hold-or-send.ts:290-297) and the Activity page
 *  is not re-sorted. At exactly the hour it is the NEXT hour, never now. */
export function pauseHoldUntil(now: Date): Date {
  return new Date(Math.floor(now.getTime() / HOUR_MS) * HOUR_MS + HOUR_MS);
}

export function pauseHold(
  pauseDeadline: Date | null | undefined, now: Date,
): { kind: "held"; until: Date } | { kind: "skipped" } {
  if (pauseDeadline && pauseDeadline.getTime() <= now.getTime()) return { kind: "skipped" };
  const next = pauseHoldUntil(now).getTime();
  return { kind: "held", until: new Date(pauseDeadline ? Math.min(next, pauseDeadline.getTime()) : next) };
}

/** A pause hold still in force: holdOrSend returns `held` on this row alone,
 *  without asking the gate (re-review I1). Only OUR reason: a quiet-hours or
 *  closure hold never skips the gate this way. */
export function pauseHoldInForce(row: AutomationLogRow | null, now: Date): boolean {
  return row !== null && row.status === "held" && row.reason === m["automations.reason.heldBillingPaused"]
    && row.held_until !== null && Date.parse(row.held_until) > now.getTime();
}
```

- [ ] **Step 7: `hold-or-send.ts`** — `REASONS.heldBillingPaused` and `REASONS.skippedBillingPaused` from the two keys; `BLOCK_REASONS.billing_paused` and `EMAIL_BLOCK_REASONS.billing_paused` map to `REASONS.skippedBillingPaused` (the `Record` types force them; the paths below intercept first). In the `catch` (`:345-372`), BEFORE the `SmsBlocked` and `EmailNotSent` skips:

```ts
    // I6 / G7a: a paused account's automation is held, not dropped.
    const pausedRefusal = (e instanceof SmsBlocked && e.reason === "billing_paused")
      || (e instanceof EmailNotSent && e.result.kind === "blocked" && e.result.reason === "billing_paused");
    if (pausedRefusal) {
      const v = pauseHold(s.pauseDeadline ?? s.deadline, ctx.now);
      if (v.kind === "skipped") { await logSkipped(ctx, s, REASONS.skippedBillingPaused); return "skipped"; }
      await writeHeld(ctx, s, v.until, zone, REASONS.heldBillingPaused);
      return "held";
    }
```

And BEFORE `await send()` (after the sending-hours check), the short-circuit (re-review I1):

```ts
  // G7a: a pause hold still in force answers on its own log row, so a held
  // subject seen on every tick costs one log read and no gate read. Only the
  // pause reason short-circuits; any other hold goes on as today.
  if (billingEnforced()) {
    const existing = await getAutomationLogEntry(ctx.db, s.accountId, s.source, s.subjectKey);
    if (pauseHoldInForce(existing, ctx.now)) return "held";
  }
```

`HoldSubject` gains `pauseDeadline?: Date | null` (doc: "I6: when a pause-held subject is no longer timely (G7a); falls back to `deadline`"). Update the module doc's table with the new rows. The inline instant reply gets the same hold and still stops at `RETRY_MAX_AGE_MS`; so does the text-back.

- [ ] **Step 7b: Each recipe's pause deadline (re-review I2).** In each pass's subject builder (the one its run AND its releaser use), set `pauseDeadline`:

| Pass | `pauseDeadline` | Constant |
|---|---|---|
| `review-request.ts` (anchor `:113`) | `anchor + REVIEW_REQUEST_MAX_AGE_MS` | `automations.ts:176` |
| `referral-ask.ts` (anchor `:117`) | `anchor + REFERRAL_ASK_MAX_AGE_MS` | `automations.ts:1038` |
| `no-show-nudge.ts` (anchor `:105`) | `anchor + NO_SHOW_NUDGE_MAX_AGE_MS` | `automations.ts:417` |
| `quote-followup.ts` (`stage_changed_at`, `:102`) | `stageChangedAt + QUOTE_FOLLOWUP_MAX_AGE_MS` | `automations.ts:1859` |
| `reminders.ts`, `sms-reminder.ts`, `appointment-confirm.ts` | none: their existing `deadline` (the appointment) is used | — |
| `followups.ts` | none: `FOLLOWUP_MAX_AGE_MS` is already enforced on release | `followup-timing.ts:86` |
| `reactivation.ts` | none: no age constant; the release re-check re-reads eligibility (G7a) | — |

Tests, one per recipe, each through its pass's releaser with a gate stub answering `billing_paused` and a clock moved past the deadline: "a review request held by the pause past anchor + 61 h is skipped, not sent after the lift (mutation: no pauseDeadline on the subject → FAILS: sent)"; "a referral ask past anchor + 85 h is skipped (mutation: REVIEW_REQUEST_MAX_AGE_MS instead → FAILS at 70 h)"; "a no-show nudge past anchor + 37 h is skipped (mutation: no pauseDeadline → FAILS)"; "a quote follow-up past stage_changed_at + 30 days is skipped (mutation: anchor on the hold's own start → FAILS)"; and, per recipe, "inside its deadline it is held, then sent after the lift (mutation: pauseDeadline = now → FAILS: skipped at once)".

- [ ] **Step 8: `conversations/actions.ts`** — `case "billing_paused": rejectSend(t(m, "compose.smsBlockedPaused", locale));`.

- [ ] **Step 9: Run** Step 2's suites, plus `src/lib/consent/scans.test.ts`, `src/lib/automations/send-sms.test.ts`, `src/lib/automations/passes/release-held.test.ts`, `src/lib/voice/textback.test.ts`, `src/lib/sms/alerts.test.ts`, `src/lib/automations/instant-reply.test.ts`, `src/lib/automations/closures.test.ts`, the seven pass tests of Step 7b, `in-account-service-reads.test.ts` (their `@bis/db` factories need nothing new: the new read happens only with the switch on). Lint, typecheck.

- [ ] **Step 10: Commit** — `git commit -m "M7a PR-4: customer texts stop and automations are held (not dropped) while an account is paused"`.

### Task 6: The TeXML answer route and the concierge (HIGH, bis-voice)

**Files:**
- Modify: `apps/web/src/app/api/voice/texml/route.ts` (`COPY` `:99-110`, `Routability` `:81-94`, `classify` `:202-363`, `accountForwardTarget` `:521-550`, `route` `:616-748`), `apps/web/src/app/api/concierge/[publicId]/turn/route.ts:221-224`, `apps/web/src/app/c/[publicId]/page.tsx:43,88`, `apps/web/src/app/c/[publicId]/layout.tsx:37,68` (M12).
- Test: `api/voice/texml/route.test.ts`, `forward.test.ts`, `wellformed.test.ts`, `api/concierge/[publicId]/turn/route.test.ts`, `app/c/[publicId]/page.test.ts`, `app/c/[publicId]/layout.test.ts`.

**Interfaces:**
- Consumes: `billingEnforced`, `billingVerdict`, `voiceBlock` (Task 4); `readBillingStanding` (Task 2); `conciergeOpen` (Task 7's `standing-read.ts`, which Task 7 creates; this task never creates it, M7).

- [ ] **Step 1: Failing tests.** `texml/route.test.ts` (its lazy `@bis/db` mock gains `readBillingStanding`; switch set per test):
  1. "switch on, paused under 30 days, cleared call with a usable transfer number: the forward document, recorded billing-paused (mutation: record account-forward → FAILS)".
  2. "I7: paused 30 days or more: the unavailable sentence and a screened_calls row billing-paused, never the forward, even with a transfer number (mutation: ignore verdict.forward → FAILS)".
  3. "plan without the receptionist: the forward, recorded plan-no-voice (mutation: drop the plan half of voiceBlock → FAILS)".
  4. "paused, NO transfer number: the unavailable sentence in the profile's languages, a screened_calls row billing-paused, never the bridge (mutation: fall through to the bridge → FAILS)".
  5. "paused, call NOT cleared (a cap read failed): the message, never the forward (mutation: forward uncleared calls → FAILS)".
  6. "the guards still answer first: an over-cap caller on a paused account hears the cap sentence (mutation: act on billing inside classify before the caps → FAILS)".
  7. "the press-1 screen still comes first for a first-time caller (mutation: billing before the screen → FAILS)".
  8. "a billing read that throws changes nothing: the bridge, cleared as today (mutation: let the billing error reach the caps' catch → FAILS: the call is uncleared)" (M1).
  9. "the billing read starts before the caps' counts and is awaited after them (mutation: await it before starting the counts → FAILS: the stub records the order)" (M1).
  10. "switch OFF and paused: the bridge, and readBillingStanding is never called (mutation: read regardless → FAILS)".
  11. "VOICE_FORWARD_TO still wins over everything (mutation: billing before the deployment-wide forward → FAILS)".
  12. "accountForwardTarget's three log lines are byte-identical after the resolver is extracted (mutation: reword one → FAILS)".
  13. (Task 6 review, item 1) "forward_calls on AND paused 30 days or more: the unavailable sentence and a billing-paused screened row, never the per-account forward (mutation: skip the billing block when the call is cleared and forward_calls is on → FAILS)".
  14. (Task 6 review, item 1) "forward_calls on AND paused under 30 days: forwarded and recorded billing-paused, never account-forward (same mutation → FAILS)".
  15. (Task 6 review, item 3) "paused and the transfer-number read throws: the unavailable sentence, logged as an ERROR naming the failure (mutation: log it with console.log → FAILS)".
  `wellformed.test.ts`: "the unavailable document is well-formed XML in en, es and both (mutation: drop the Hangup → FAILS)".
  `turn/route.test.ts`: "switch on, paused → 404 not_found before any counter is spent (mutation: check after createConciergeConversation → FAILS)"; "plan without the website chat → 404 (mutation: read voice instead of concierge → FAILS)"; "a billing read error → the chat answers (mutation: return 404 on a read error → FAILS)".
  `c/[publicId]/page.test.ts`: "switch on, paused → notFound (mutation: drop the conciergeOpen check → FAILS)"; "generateMetadata returns robots only for it (mutation: brand its title → FAILS)". `layout.test.ts`: "a paused chat's not-found page is branded like a switched-off one, and its tab title is the brand's (mutation: keep isConciergeLive alone in the layout → FAILS)" (M12).

- [ ] **Step 2: Run** — `pnpm --filter web exec vitest run src/app/api/voice/texml "src/app/api/concierge" "src/app/c"`. Expected: FAIL.

- [ ] **Step 3: TeXML route.**

`COPY` gains (byte-exact; a test pins both):

```ts
  // M7a PR-4 (plan G9; owner answers Q2 and I7): a paused account, or a plan
  // with no receptionist, when the call cannot or may no longer be forwarded.
  // Not the refusal sentence: nobody can pick up right now.
  unavailable: {
    en: "Thanks for calling. No one can take your call right now. Please call back later.",
    es: "Gracias por llamar. En este momento nadie puede atender su llamada. Por favor llame más tarde.",
  },
```

`Routability`'s `dial` variant gains `noVoice?: { reason: "billing-paused" | "plan-no-voice"; forward: boolean }` (documented: "set only when BILLING_ENFORCE is on and the account's verdict has no Sofía; absent when the billing read failed (fail open)"), and the uncleared count-failure return (`:353`) gains `languages: profile.languages` and `phoneNumberId: row.id` so the message path has both.

In `classify`, right after the profile gate (after `:262`'s narrowing) and BEFORE the caps' `Promise.all` (`:296`), START the billing read with its own catch, so it runs in parallel with the counts and can never reject into the caps' catch (M1):

```ts
    // M7a PR-4 (plan G9). Started now, awaited after the counts: no added
    // latency, and its own catch, so a billing failure is today's path (fail
    // open, logged) and never marks the call uncleared.
    const billingRead: Promise<ReturnType<typeof voiceBlock>> = billingEnforced()
      ? readBillingStanding(db, row.account_id)
          .then((s) => voiceBlock(billingVerdict(s, true, new Date())))
          .catch((e: unknown) => {
            console.error(`texml billing read failed — Sofía answers, accountId ${row.account_id}: ${String(e)}`);
            return null;
          })
      : Promise.resolve(null);
```

Then every `kind: "dial"` return after it awaits `const noVoice = await billingRead;` and carries `...(noVoice ? { noVoice } : {})`. The `blocked` and `cap` returns do not wait for it.

Extract the screened-call `after()` block in `route()` (`:646-670`) into `function recordScreenedCallLater(screened: ScreenedCallInput): void` (same body, same two catches) and call it from the refusal path unchanged. Extract the resolver core of `accountForwardTarget` (`:521-550`) into `async function resolveTransferTarget(accountId: string): Promise<{ to: string } | { to: null; why: string }>` returning the reason instead of logging; `accountForwardTarget` stays the wrapper that logs today's three lines byte-identically.

In `route()`, after the screen block (`:704`) and BEFORE the per-account forward (`:705`):

```ts
    // M7a PR-4 (plan G9): a paused account, or a plan with no receptionist.
    // After every guard and the screen; before the per-account forward and
    // the bridge. A CLEARED call the verdict still lets ring the business (a
    // pause under 30 days, or a plan without Sofía) goes to the transfer
    // number; anything else hears the short message. Both are recorded.
    if (result.accountId && result.noVoice) {
      const { reason, forward } = result.noVoice;
      const target = result.cleared && forward
        ? await resolveTransferTarget(result.accountId)
        : { to: null, why: forward ? "not cleared" : "paused 30 days or more" };
      if (target.to) {
        console.log(`texml FORWARDING account ${result.accountId} to its transfer number — ${reason}`);
        recordForwardedCallLater({
          accountId: result.accountId, phoneNumberId: result.phoneNumberId ?? null,
          calledE164, callerE164, kind: reason,
        });
        return done(xmlResponse(forwardXml(target.to, calledE164)));
      }
      console.log(`texml unavailable message for account ${result.accountId} — ${reason}, no forward (${target.why})`);
      recordScreenedCallLater({
        accountId: result.accountId, phoneNumberId: result.phoneNumberId ?? null,
        calledE164, callerE164, reason,
      });
      return done(xmlResponse(sayXml(result.languages ?? "en", COPY.unavailable)));
    }
```

Known (M13): a paused account in Closed today or Storm forwards in its first 30 days like any other; the route reads no business status.

- [ ] **Step 4: Concierge turn route** — after `if (!profile) return … 404` (`:224`):

```ts
    // M7a PR-4 (plan G10): a paused account, or a plan without the website
    // chat, answers exactly as a switched-off chat does. Before anything is
    // spent. A read error lets the chat answer (fail open, logged).
    if (billingEnforced()) {
      try {
        if (!billingVerdict(await readBillingStanding(db, profile.account_id), true, new Date()).concierge) {
          return NextResponse.json({ error: "not_found" }, { status: 404 });
        }
      } catch (e) {
        log("billing read failed, chat answers", { accountId: profile.account_id, error: String(e) });
      }
    }
```

(`readBillingStanding` joins the lazy `@bis/db` destructure at `:194-201`.)

- [ ] **Step 5: `/c/[publicId]/page.tsx` and `layout.tsx`** — replace each `isConciergeLive(profile)` decision with `await conciergeOpen(profile)` (page `:43`, `:88`; layout `:37` as `const showNotFoundBrand = !!profile && !(await conciergeOpen(profile));` and `:68` as `if (!profile || (await conciergeOpen(profile))) return …`). `conciergeOpen` is `isConciergeLive(profile) && (await billingVerdictFor(profile.account_id)).concierge`, cached and fail-open (Task 7).

- [ ] **Step 6: Run** Step 2's suites, plus `src/app/api/voice/incoming/route.test.ts` (untouched; proves the webhook is unchanged), `src/app/api/voice/texml/screen/route.test.ts`, and `src/lib/voice` tests that import `forwarded-calls`/`screened-calls`. Lint.

- [ ] **Step 7: Commit** — `git commit -m "M7a PR-4: a paused or receptionist-less account's calls go to its own phone for 30 days, then a short message; its website chat closes"`.

### Task 7: Read-only client actions, `standing-read.ts`, the AI summary gate (HIGH, bis-platform)

**Files:**
- Create: `apps/web/src/lib/billing/standing-read.ts` (+ `.test.ts`), `apps/web/src/lib/billing/read-only.ts` (+ `.test.ts`).
- Modify: `apps/web/src/lib/auth.ts:36-61, 71-79, 142-149`, the opted-out actions (the audit's list: at least `accounts/[accountId]/billing/actions.ts:36`, `accounts/[accountId]/shell-actions.ts:150`), `apps/web/src/app/api/accounts/[accountId]/contacts/[contactId]/ai-summary/route.ts` (the gate callback), `in-account-service-reads.test.ts` (one entry for `standing-read.ts`).
- Test: `lib/auth.test.ts` (gains `vi.mock("next/headers")` and the switch), `technician-guards.test.ts`, `ai-summary/route.test.ts`, every opted-out file's test.

**Interfaces:**
- Consumes: `billingEnforced`, `billingVerdict`, `pauseCause`, `ALL_ON` (Task 4); `readBillingStanding`, `isConciergeLive` (`@bis/db`).
- Produces: `type AccountBillingVerdict = BillingVerdict & { cause: "payment" | "ended" | null; pausedAt: string | null }`; `billingVerdictFor(accountId): Promise<AccountBillingVerdict>` (React-`cache`d, service role, fails open); `conciergeOpen(profile): Promise<boolean>`; `refuseActionWhilePaused(accountId, fallback): Promise<void>`; `sameAccountPath(referer, accountId): string | null`; `requireAccountAccess(accountId, opts?: { duringPause?: "allow" })` (same option on `requireAccountOwner`, `requireNotTechnician`).

- [ ] **Step 1: Audit every exported server action.** For each `export async function` in the 38 account-scoped `"use server"` files (`grep -rl '^"use server"' "apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]" apps/web/src/lib`) and every inline `"use server"` function under `accounts/[accountId]`, add one row to `READ_ONLY_ALLOWED` in `read-only.test.ts` (`{ file, fn, why }`) ONLY for those that write nothing and call no model or provider. Read each body: a getter that lazily creates a row is a write. Starting candidates: `shell-actions.ts` `getShellSnapshot`; `contacts/documents-actions.ts` `getDocumentUrlAction`; `contacts/actions.ts` `countContactDocumentsAction`; `contacts/groups-actions.ts` `searchGroupsAction`; `contacts/relationship-actions.ts` `searchRelatableContactsAction`; plus `billing/actions.ts` `openBillingPortalAction` with `why: "the way to pay (spec flow 5)"`. NOT `contacts/[contactId]/forwarding-actions.ts` `getForwardingAddressAction`: it creates the forwarding address on first use (M6). Agency-only actions need no entry.

- [ ] **Step 2: Failing tests.**
  `standing-read.test.ts`: "switch off → nothing paused, without a read (mutation: read regardless → FAILS)"; "a read error → nothing paused, logged (mutation: rethrow → FAILS)"; "a paused past_due row → paused, cause payment, its pausedAt; a paused canceled row → cause ended (mutation: cause from billingPausedAt alone → FAILS)"; "conciergeOpen is false for a live chat on a paused account and true for a live chat on an unpaused one (mutation: return isConciergeLive alone → FAILS)".
  `read-only.test.ts`:
  1. "sameAccountPath keeps a path inside this account only, dropping the origin (mutation: accept any /dashboard path → FAILS)" — `https://x/dashboard/accounts/A/contacts?q=1` → `/dashboard/accounts/A/contacts?q=1`; another account's path, `/dashboard/work`, garbage → null.
  2. "refuseActionWhilePaused: switch off → returns, reads nothing (mutation: drop the switch check → FAILS)".
  3. "no next-action header (a page render) → returns (mutation: drop the header check → FAILS)".
  4. "a server action on a paused account → redirect to the referer's path (mutation: always redirect home → FAILS)".
  5. "no usable referer → the fallback (mutation: redirect to '/' → FAILS)".
  6. "not paused → returns (mutation: refuse every action while the switch is on → FAILS)".
  7. "THE ALLOW-LIST: the set of (file, function) passing `duringPause: \"allow\"` equals READ_ONLY_ALLOWED, each with a reason (mutation: add the option to a write action → FAILS by name)".
  8. "getForwardingAddressAction is NOT allowed (mutation: add it → FAILS by name)" (M6).
  9. "no allowed action revalidates (mutation: add revalidatePath to getShellSnapshot → FAILS)".
  10. "exactly five non-test files import readBillingStanding (mutation: import it from a pass → FAILS by name)" — `lib/consent/gate.ts`, `lib/consent/email-gate.ts`, `app/api/voice/texml/route.ts`, `app/api/concierge/[publicId]/turn/route.ts`, `lib/billing/standing-read.ts`.
  11. "every non-GET handler under app/api/accounts is listed with its reason (mutation: add a POST without a reason → FAILS)" — today only `ai-summary`'s POST, reason "AI off while paused (G21)".
  `auth.test.ts`: "a client's server action on a paused account is redirected, the agency's is not (mutation: refuse the agency too → FAILS)"; "`duringPause: 'allow'` skips the refusal (mutation: ignore the option → FAILS)"; "requireAccountOwner and requireNotTechnician pass the option through (mutation: drop it in requireAccountOwner → FAILS)".
  `ai-summary/route.test.ts`: "paused (switch on): GET answers { state: 'none' } with no completion and no claim (mutation: skip the gate wrapper on GET → FAILS)"; "paused: POST (Regenerate) answers { state: 'none' } (mutation: wrap the gate on GET only → FAILS)"; "not paused or switch off: unchanged (mutation: always 'none' → FAILS)".

- [ ] **Step 3: `apps/web/src/lib/billing/standing-read.ts`:**

```ts
import { cache } from "react";
import { isConciergeLive, readBillingStanding, serviceDb } from "@bis/db";
import { billingEnforced } from "./enforce";
import { ALL_ON, billingVerdict, pauseCause, type BillingVerdict } from "./standing";

export type AccountBillingVerdict = BillingVerdict & { cause: "payment" | "ended" | null; pausedAt: string | null };
const NOTHING_PAUSED: AccountBillingVerdict = Object.freeze({ ...ALL_ON, cause: null, pausedAt: null });

/**
 * The account's billing verdict for THIS request, read once (React cache):
 * the paused banner, the read-only guard, the concierge page and layout, and
 * the AI summary route.
 *
 * serviceDb, on purpose (plan Global Constraints): a client Staff session
 * reads NO account_billing row (0066 account_billing_owner_read), and
 * `plans` is agency-read only, yet every member must be told the account is
 * paused. It returns booleans and a cause about the ACCOUNT, never customer
 * data, and every caller has already run requireAccountAccess (or is the
 * public concierge, whose public id is its authorisation).
 *
 * FAILS OPEN: a read error is nothing paused, logged. Switch off: no read.
 */
export const billingVerdictFor = cache(async (accountId: string): Promise<AccountBillingVerdict> => {
  if (!billingEnforced()) return NOTHING_PAUSED;
  try {
    const standing = await readBillingStanding(serviceDb(), accountId);
    const verdict = billingVerdict(standing, true, new Date());
    return {
      ...verdict,
      cause: verdict.paused && standing ? pauseCause(standing) : null,
      pausedAt: standing?.pausedAt ?? null,
    };
  } catch (e) {
    console.error(`billing standing read failed for account ${accountId}; treated as not paused: ${e instanceof Error ? e.message : String(e)}`);
    return NOTHING_PAUSED;
  }
});

/** The concierge is open: switched on, a published destination
 *  (isConciergeLive) AND the account's billing allows the chat (G10). */
export async function conciergeOpen(
  profile: Parameters<typeof isConciergeLive>[0] & { account_id: string },
): Promise<boolean> {
  return isConciergeLive(profile) && (await billingVerdictFor(profile.account_id)).concierge;
}
```

`in-account-service-reads.test.ts`: `"lib/billing/standing-read.ts": "configuration"` ("the account's billing verdict, never customer data; every member must see the pause").

- [ ] **Step 4: `apps/web/src/lib/billing/read-only.ts`:**

```ts
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { billingEnforced } from "./enforce";
import { billingVerdictFor } from "./standing-read";

/** Next 16.3.6's server-action request header (app-router-headers.js:96). */
export const ACTION_HEADER = "next-action";

/** A server action (N1, review I1): `next-action`, or a form body with no
 *  `rsc` header (a no-JS form post; the forwarded render after a redirect
 *  sends `rsc: 1` with the form's content-type). */
export function isActionRequest(h: Headers): boolean {
  if (h.get(ACTION_HEADER) !== null) return true;
  if (h.get("rsc") !== null) return false;
  const type = (h.get("content-type") ?? "").toLowerCase();
  return type.startsWith("multipart/form-data") || type.startsWith("application/x-www-form-urlencoded");
}

/** The path of `referer` when it is inside THIS account, else null. Only the
 *  path is kept, so the redirect is always same-origin. */
export function sameAccountPath(referer: string | null, accountId: string): string | null {
  if (!referer) return null;
  let url: URL;
  try { url = new URL(referer); } catch { return null; }
  return url.pathname.startsWith(`/dashboard/accounts/${accountId}/`) ? url.pathname + url.search : null;
}

/**
 * "Dashboard read-only" (spec flow 5; plan G11). Called by requireAccountAccess
 * for a CLIENT caller only. Refuses a SERVER ACTION (isActionRequest: the
 * `next-action` header, or a no-JS form post; a page render, a layout and a
 * GET carry neither) on a paused account by sending the browser back to the
 * page it came from, where the paused banner says why. Nothing is written.
 * Switch off: returns at once. A failed read: allowed (billingVerdictFor
 * fails open).
 */
export async function refuseActionWhilePaused(accountId: string, fallback: string): Promise<void> {
  if (!billingEnforced()) return;
  const h = await headers();
  if (!isActionRequest(h)) return;
  if (!(await billingVerdictFor(accountId)).paused) return;
  console.log(`read-only: refused a client action on paused account ${accountId}`);
  redirect(sameAccountPath(h.get("referer"), accountId) ?? fallback);
}
```

- [ ] **Step 5: `lib/auth.ts`.**

```ts
export type AccessOptions = {
  /** "allow": this server action stays usable while the account is paused
   *  for billing (it only reads, or it is how the client pays). Every use is
   *  pinned, with its reason, by lib/billing/read-only.test.ts. */
  duringPause?: "allow";
};

export async function requireAccountAccess(
  accountId: string, opts: AccessOptions = {},
): Promise<{ userId: string; isAgency: boolean; role: AccountRole | null; canManage: boolean }> {
  // …unchanged through ensureAccountRole…
  const role = await ensureAccountRole(account.id, claims.org_id, userId, storedRole);
  // M7a PR-4 (plan G11): a client's server action on a paused account.
  if (opts.duringPause !== "allow") await refuseActionWhilePaused(account.id, accountHome(account.id, role));
  return { userId, isAgency: false, role, canManage: role === "owner" };
}
```

`requireAccountOwner(accountId, opts: AccessOptions = {})` and `requireNotTechnician(accountId, opts: AccessOptions = {})` pass `opts` through. One paragraph on the rule in `requireAccountAccess`'s doc.

- [ ] **Step 6: Opt out the audited actions** — e.g. `billing/actions.ts:37`: `await requireAccountOwner(accountId, { duringPause: "allow" })`; `shell-actions.ts:150`: `await requireAccountAccess(accountId, { duringPause: "allow" })`; and each row of `READ_ONLY_ALLOWED`.

- [ ] **Step 7: The AI summary (G21, M2)** — in `ai-summary/route.ts`, wrap the gate callback:

```ts
      // M7a PR-4 (plan G21): no model call for a paused account, on GET or
      // POST, for any caller: the gate answers "account AI off", which
      // serveRecordSummary turns into { state: "none" }. Fails open.
      gate: async () => {
        const g = await aiGateCheck(svc, { accountId, ...periodKeys(now, safeZone(zone)), signal: AbortSignal.timeout(GATE_TIMEOUT_MS) });
        return (await billingVerdictFor(accountId)).paused ? { ...g, accountEnabled: false } : g;
      },
```

- [ ] **Step 8: Run** — `pnpm --filter web exec vitest run src/lib/billing/read-only.test.ts src/lib/billing/standing-read.test.ts src/lib/auth.test.ts "src/app/(dashboard)/dashboard/accounts/[accountId]/technician-guards.test.ts" "src/app/(dashboard)/dashboard/accounts/[accountId]/in-account-service-reads.test.ts" "src/app/api/accounts"`, plus each opted-out file's test (a `toHaveBeenCalledWith(accountId)` on the mocked guard now needs `(accountId, { duringPause: "allow" })`; name each in the commit). Lint, typecheck.

- [ ] **Step 9: Commit** — `git commit -m "M7a PR-4: a paused account's dashboard is read-only for the client (audited allow-list), and its AI summary is off"`.

### Task 8: Nightly: re-mirror, reconcile, the held rows, permissions (HIGH, bis-automations)

**Files:**
- Create: `apps/web/src/lib/billing/reconcile.ts` (+ `.test.ts`), `apps/web/src/lib/billing/nightly.ts` (+ `.test.ts`).
- Modify: `apps/web/src/lib/billing/stripe-gateway.ts` (interface `:68-85`: `meterTotal`; `retrieveSubscription(id, opts?: { bounded?: boolean })` and `listActiveMeters(opts?: { bounded?: boolean })`; `usageIdempotencyKey` MOVES here from `usage-report.ts:16`, which re-exports it, so `nightly.ts` and `usage-report.ts` do not import each other), `apps/web/src/lib/billing/fake-gateway.ts`, `apps/web/src/lib/automations/passes/usage-report.ts` (the hold option, counters, the nightly call), `apps/web/src/app/api/cron/reminders/route.test.ts` (its `@bis/db` factory gains the nightly's reads — touched only with the switch on; add them anyway: `listReconcilableAccounts`, `reconciledSince`, `latestReconciliations`, `readUsageBands`, `saveReconciliation`, `healPermissions`, `mirrorSubscription`).
- Test: `lib/billing/stripe-gateway.test.ts`, `lib/automations/cron-coupling.test.ts` (unchanged, must pass).

**Interfaces:**
- Consumes: Task 2's reads and writers, `markUsageReported`, `mirrorSubscription`, `PAST_DUE_STATUSES`, `METER_KEYS`, `ALERTING_VERDICTS`, `USAGE_HOLD_AFTER_MS`; `METERS` (`stripe-catalog.ts:12`); `meterEventFailureKind`.
- Produces: `BillingGateway.meterTotal({ meterId, customerId, startSeconds, endSeconds }): Promise<number>`; `RECONCILE_HOUR_UTC` (8), `RECONCILE_SETTLE_MS` (2 h), `nightlyRunStart(now): Date`, `reconcileWindow(row, now)`, `closedPeriodWindow(latest, row)`, `reconcileMeter({ settled, inFlight, heldQuantities }, stripeTotal)` (the held rows' QUANTITIES, not their sum: review item 2), `runBillingNightly(ctx, gateway, clock): Promise<NightlyCounters>`.

- [ ] **Step 1: Failing tests** `reconcile.test.ts` (pure):
  1. "nightlyRunStart is the most recent 08:00 UTC: 07:59 → yesterday's, 08:00 → today's (mutation: local midnight → FAILS)".
  2. "reconcileWindow: start is the later of period start and billing start, CEILED to the minute; end is now FLOORED (mutation: floor the start → FAILS)"; "no current_period_start → null (mutation: fall back to billing start → FAILS)"; "end ≤ start → null (mutation: return an empty window → FAILS)".
  3. "closedPeriodWindow: the newest stored row's window_start, up to the current period's start ceiled; null when the newest row IS the current period or already reaches its end (mutation: compare window_end with now → FAILS: a closed period is re-checked every night)" (I9).
  4. "no held rows: Stripe between settled and settled + in flight → match; below → stripe_under; above → stripe_over (mutation: ignore in-flight → FAILS)".
  5. "held rows Stripe already counts → held_at_stripe (mutation: send them anyway → FAILS)".
  6. "held rows Stripe does not count → held_missing (mutation: stamp them → FAILS)".
  7. "the two ranges overlap → ambiguous (mutation: prefer held_at_stripe on overlap → FAILS)".
  8. "Stripe between the ranges → ambiguous (mutation: call it stripe_under → FAILS)".
  9. "a non-integer Stripe total → ambiguous (mutation: Math.round → FAILS)".
  `nightly.test.ts` (FakeGateway + a vi.mock of `@bis/db`, switch on unless said):
  10. "switch off → nothing runs: no re-mirror, no Stripe call, no write (mutation: drop the switch check → FAILS)" (I8).
  11. "skip-before / due-after: a pair checked after this window's start is skipped; one checked before it is due (mutation: compare with the previous window → FAILS)" (I4).
  12. "re-mirrors every past_due, unpaid and paused subscription not yet re-read this window, once, with bounded transport (mutation: re-mirror active rows too → FAILS by call count; mutation: unbounded read → FAILS: the stub sees no options)" (I2).
  13. "a re-mirror starts only while elapsed < budget − 2 × worst case; at budget − 1.5 × worst case it stops and counts reconcileSkippedBudget (mutation: one worst case → FAILS)" (I2).
  14. "listActiveMeters is called bounded and only while canStart (mutation: call it unconditionally → FAILS when the budget is spent)" (I2).
  15. "a Stripe call starts only while elapsed < budget − worst case, on the pass's own clock (mutation: a fresh clock → FAILS: it overruns USAGE_REPORT_BUDGET_MS)".
  16. "held_at_stripe stamps exactly the held rows; held_missing sends each with the reporter's key, then stamps (mutation: send without stamping → FAILS)".
  17. "held_missing: a duplicate refusal stamps the row as heldStamped, never heldSent (mutation: count it sent → FAILS)".
  18. "held_missing: a row refusal leaves the row unstamped and the next held row still runs (mutation: stamp on any failure → FAILS)".
  19. "I9: on the first window after rollover the closed period is compared once to its end, report-only, before the current one (mutation: send held rows of the closed period → FAILS)".
  20. "an alerting verdict is saved and logged with console.error (mutation: save only matches → FAILS)".
  21. "heals accounts.permissions for every account it reconciled (mutation: skip the heal → FAILS)".
  22. "one account's Stripe failure is counted and the next account still runs (mutation: rethrow → FAILS)".
  Added by the review of 82634ba4 (each with its mutation):
  19b. "I9 across ticks: a period checked at 08:05 on the day it rolls over at 15:00 is still compared to its end, once (mutation: consult done for the closing window → FAILS: the old row ends at 08:05)" (item 1; ticks 10-20 08:05, 15:05, 10-21 08:05, 10-22 08:05 over an in-memory store).
  23. "each held send needs its own worst case of budget: the second waits for the next tick (mutation: drop the need(1) before a held send → FAILS)" (item 3).
  24. "a closed period whose held rows Stripe already counts is still report-only: nothing stamped (mutation: stamp held_at_stripe rows of a closed period → FAILS)" (item 4).
  25. "a re-mirror reads Stripe at most twice in the nightly path (mutation: no cap → 3 reads, FAILS)" (item 6).
  26. "nothing due this window → Stripe is not asked even for its meters (mutation: list the meters before computing what is due → FAILS)" (item 7).
  `reconcile.test.ts`, several held rows (item 2), `{ settled: 10, inFlight: 5, heldQuantities: [3, 5] }`: "total 18 → ambiguous, never held_at_stripe (mutation: present = in [lo + H, hi + H] alone → FAILS)"; "total 13 → ambiguous, never held_missing (mutation: missing = in [lo, hi] alone → FAILS)"; "21+ held_at_stripe, under 13 held_missing, 20 and 14 ambiguous (mutation: the largest held row instead of the smallest → FAILS)".
  `stripe-gateway.test.ts`: "meterTotal asks listEventSummaries with exactly { customer, start_time, end_time } and { maxNetworkRetries: 0, timeout: METER_EVENT_TIMEOUT_MS } (mutation: pass value_grouping_window → FAILS)"; "an empty summary list is 0 (mutation: return null → FAILS)"; "retrieveSubscription and listActiveMeters send the bounded options only when asked (mutation: always bounded → FAILS: the webhook path changes)".
  `usage-report.test.ts` (or the route test): "with the switch on the reporter passes holdAfterMs = USAGE_HOLD_AFTER_MS; off, it passes nothing (mutation: always hold → FAILS)" (I8).

- [ ] **Step 2: Run** — `pnpm --filter web exec vitest run src/lib/billing/reconcile.test.ts src/lib/billing/nightly.test.ts src/lib/billing/stripe-gateway.test.ts`. Expected: FAIL.

- [ ] **Step 3: Gateway.** Interface: `meterTotal(input: { meterId: string; customerId: string; startSeconds: number; endSeconds: number }): Promise<number>;`, `retrieveSubscription(subscriptionId: string, opts?: { bounded?: boolean }): Promise<SubscriptionSnapshot>;`, `listActiveMeters(opts?: { bounded?: boolean }): Promise<StripeMeter[]>;`. A shared constant:

```ts
/** The nightly step's per-request transport (plan I2): one attempt, the
 *  meter event's socket timeout. The webhook and the Plans page keep the
 *  client's defaults. */
const BOUNDED: Stripe.RequestOptions = { maxNetworkRetries: 0, timeout: METER_EVENT_TIMEOUT_MS };
```

`retrieveSubscription` passes `opts?.bounded ? BOUNDED : undefined` as the request options of its `subscriptions.retrieve`; `listActiveMeters` likewise for `billing.meters.list`. `meterTotal`:

```ts
    async meterTotal({ meterId, customerId, startSeconds, endSeconds }) {
      // One summary for the whole range (no value_grouping_window); both
      // times minute-aligned (Meters.d.ts:216-236). Assumption S1.
      const page = await stripe.billing.meters.listEventSummaries(meterId, {
        customer: customerId, start_time: startSeconds, end_time: endSeconds,
      }, BOUNDED);
      return page.data.reduce((sum, s) => sum + s.aggregated_value, 0);
    },
```

`FakeGateway.meterTotal` sums the events its `reportMeterEvent` recorded for that meter's event name and customer whose `timestampSeconds` fall in `[start, end)`, plus anything seeded with `seedMeterTotal(meterId, customerId, value)`; it records each call's `bounded` flag for the tests.

- [ ] **Step 4: `apps/web/src/lib/billing/reconcile.ts`:**

```ts
import type { AccountBilling, Reconciliation, ReconciliationVerdict } from "@bis/db";

/** The nightly window starts at this hour, UTC (2-3 AM Central). */
export const RECONCILE_HOUR_UTC = 8;
/** Assumption S1: an event Stripe accepted this long ago is in its summary. */
export const RECONCILE_SETTLE_MS = 2 * 60 * 60 * 1000;

const MINUTE_MS = 60_000;
const ceilMinute = (ms: number) => Math.ceil(ms / MINUTE_MS) * MINUTE_MS;
const floorMinute = (ms: number) => Math.floor(ms / MINUTE_MS) * MINUTE_MS;

/** The most recent 08:00 UTC: each (account, meter, period) is checked once
 *  per 24-hour window starting there (G14; review I4). */
export function nightlyRunStart(now: Date): Date {
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), RECONCILE_HOUR_UTC);
  return new Date(now.getTime() >= today ? today : today - 24 * 60 * 60 * 1000);
}

/** The current billing period so far, on whole minutes. Start CEILED, end
 *  FLOORED: an event in a partial minute at either edge is outside the window
 *  on BOTH sides (Stripe's event timestamp is floor(occurred_at in s)). */
export function reconcileWindow(
  row: Pick<AccountBilling, "currentPeriodStart" | "billingStartedAt">, now: Date,
): { start: Date; end: Date } | null {
  if (!row.currentPeriodStart) return null;
  const start = ceilMinute(Math.max(Date.parse(row.currentPeriodStart), Date.parse(row.billingStartedAt)));
  const end = floorMinute(now.getTime());
  return end > start ? { start: new Date(start), end: new Date(end) } : null;
}

/** I9: the just-closed period, compared once to its end. `latest` is the
 *  newest stored row for this (account, meter). Null when there is none, when
 *  it already is the current period, or when it already reaches the current
 *  period's start (compared to its end before). */
export function closedPeriodWindow(
  latest: Pick<Reconciliation, "windowStart" | "windowEnd"> | null,
  row: Pick<AccountBilling, "currentPeriodStart">,
): { start: Date; end: Date } | null {
  if (!latest || !row.currentPeriodStart) return null;
  const currentStart = ceilMinute(Date.parse(row.currentPeriodStart));
  const start = Date.parse(latest.windowStart);
  if (start >= currentStart) return null;
  if (Date.parse(latest.windowEnd) >= currentStart) return null;
  return { start: new Date(start), end: new Date(currentStart) };
}

/**
 * Plan G14. BIS's settled usage MUST be in Stripe's total; its in-flight
 * usage MAY be; its held rows are what this decides. Exact integers only.
 */
export function reconcileMeter(
  bands: { settled: number; inFlight: number; held: number }, stripeTotal: number,
): ReconciliationVerdict {
  if (!Number.isInteger(stripeTotal)) return "ambiguous";
  const lo = bands.settled;
  const hi = bands.settled + bands.inFlight;
  const inRange = (x: number, a: number, b: number) => x >= a && x <= b;
  if (bands.held === 0) {
    if (inRange(stripeTotal, lo, hi)) return "match";
    return stripeTotal < lo ? "stripe_under" : "stripe_over";
  }
  const missing = inRange(stripeTotal, lo, hi);
  const present = inRange(stripeTotal, lo + bands.held, hi + bands.held);
  if (present && !missing) return "held_at_stripe";
  if (missing && !present) return "held_missing";
  if (missing && present) return "ambiguous";
  if (stripeTotal < lo) return "stripe_under";
  if (stripeTotal > hi + bands.held) return "stripe_over";
  return "ambiguous";
}
```

- [ ] **Step 5: `apps/web/src/lib/billing/nightly.ts`:**

```ts
import {
  ALERTING_VERDICTS, METER_KEYS, PAST_DUE_STATUSES, healPermissions, latestReconciliations, listPauseCandidates,
  listReconcilableAccounts, markUsageReported, mirrorSubscription, readUsageBands, reconciledSince,
  saveReconciliation, type AccountBilling, type MeterKey, type UsageBands,
} from "@bis/db";
import { USAGE_REPORT_BUDGET_MS, METER_EVENT_WORST_CASE_MS } from "@/lib/automations/caps";
import type { PassContext } from "@/lib/automations/context";
import { billingEnforced } from "./enforce";
import { METERS } from "./stripe-catalog";
import { meterEventFailureKind, usageIdempotencyKey, type BillingGateway } from "./stripe-gateway";
import {
  RECONCILE_SETTLE_MS, closedPeriodWindow, nightlyRunStart, reconcileMeter, reconcileWindow,
} from "./reconcile";

export type NightlyCounters = {
  remirrored: number; reconciled: number; mismatched: number; heldStamped: number; heldSent: number;
  reconcileFailed: number; reconcileSkippedBudget: number;
};

class BudgetSpent extends Error {}

/**
 * The nightly billing step (spec section 4; plan G6, G14, G15, G4). Runs
 * INSIDE usageReportPass, after its sends, ONLY with BILLING_ENFORCE on (I8),
 * on that pass's own clock and budget (the budget sum cron-coupling.test.ts
 * pins is unchanged). Every Stripe call is bounded (one attempt, the meter
 * event timeout; I2). Unit of work: one (account, meter, period) not checked
 * since this window's 08:00 UTC start (I4), so the next tick resumes.
 *
 *   1. re-mirror every past_due, unpaid or paused subscription not re-read
 *      this window (G6), each only while 2 worst cases of budget remain;
 *   2. per live subscription and meter: the just-closed period once,
 *      report-only (I9), then the current period: bands vs Stripe; held rows
 *      stamped or sent; the verdict saved; an alerting one logged;
 *   3. accounts.permissions rewritten from the plan for each account done.
 */
export async function runBillingNightly(
  ctx: PassContext, gateway: BillingGateway, clock: { startedAt: number; nowMs: () => number },
): Promise<NightlyCounters> {
  const c: NightlyCounters = { remirrored: 0, reconciled: 0, mismatched: 0, heldStamped: 0, heldSent: 0, reconcileFailed: 0, reconcileSkippedBudget: 0 };
  if (!billingEnforced()) return c;
  const runStart = nightlyRunStart(ctx.now);
  const left = () => USAGE_REPORT_BUDGET_MS - (clock.nowMs() - clock.startedAt);
  const need = (worstCases: number) => {
    if (left() <= worstCases * METER_EVENT_WORST_CASE_MS) { c.reconcileSkippedBudget++; throw new BudgetSpent(); }
  };
  try {
    // 1. Freshness for the pause.
    for (const row of await listPauseCandidates(ctx.db)) {
      const unpaid = row.billingPausedAt !== null || (row.subscriptionStatus !== null && PAST_DUE_STATUSES.includes(row.subscriptionStatus));
      if (!unpaid || !row.stripeSubscriptionId) continue;
      if (row.stripeCheckedAt && Date.parse(row.stripeCheckedAt) >= runStart.getTime()) continue;
      need(2); // a mirror reads Stripe twice in the normal case (MIRROR_ATTEMPTS bounds the rest)
      const subId = row.stripeSubscriptionId;
      try {
        const out = await mirrorSubscription(ctx.db, () => gateway.retrieveSubscription(subId, { bounded: true }), () => ctx.now);
        if (out.kind === "refused") console.error(`billing nightly: re-mirror of ${subId} (account ${row.accountId}) refused: ${out.reason}`);
        else c.remirrored++;
      } catch (e) {
        c.reconcileFailed++;
        console.error(`billing nightly: re-mirror failed for account ${row.accountId}: ${String(e)}`);
      }
    }

    // 2 + 3. Reconcile.
    const accounts = await listReconcilableAccounts(ctx.db);
    if (accounts.length === 0) return c;
    const done = await reconciledSince(ctx.db, runStart.toISOString());
    const latest = await latestReconciliations(ctx.db, accounts.map((a) => a.accountId), ctx.now);
    need(1);
    const meterIds = new Map((await gateway.listActiveMeters({ bounded: true })).map((m) => [m.eventName, m.id]));
    for (const row of accounts) {
      if (!row.stripeCustomerId) continue;
      let touched = false;
      for (const meter of METER_KEYS) {
        const meterId = meterIds.get(METERS[meter].eventName);
        if (!meterId) { console.error(`billing nightly: no active Stripe meter for ${meter}`); continue; }
        const closed = closedPeriodWindow(latest.get(`${row.accountId}:${meter}`) ?? null, row);
        const current = reconcileWindow(row, ctx.now);
        for (const [window, closing] of [[closed, true], [current, false]] as const) {
          if (!window || done.has(`${row.accountId}:${meter}:${window.start.getTime()}`)) continue;
          try {
            await reconcileOne(ctx, gateway, c, need, row, meter, meterId, window, closing);
            touched = true;
          } catch (e) {
            if (e instanceof BudgetSpent) throw e;
            c.reconcileFailed++;
            console.error(`billing nightly: ${meter} for account ${row.accountId} not reconciled: ${String(e)}`);
          }
        }
      }
      if (touched) {
        try { await healPermissions(ctx.db, row.accountId); } catch (e) {
          console.error(`billing nightly: permissions not healed for account ${row.accountId}: ${String(e)}`);
        }
      }
    }
  } catch (e) {
    if (!(e instanceof BudgetSpent)) throw e;
  }
  return c;
}

async function reconcileOne(
  ctx: PassContext, gateway: BillingGateway, c: NightlyCounters, need: (n: number) => void,
  row: AccountBilling, meter: MeterKey, meterId: string, window: { start: Date; end: Date }, closing: boolean,
): Promise<void> {
  const customerId = row.stripeCustomerId!;
  const bands: UsageBands = await readUsageBands(ctx.db, {
    accountId: row.accountId, meter, startIso: window.start.toISOString(), endIso: window.end.toISOString(),
    now: ctx.now, settleMs: RECONCILE_SETTLE_MS,
  });
  need(1);
  const stripeTotal = await gateway.meterTotal({
    meterId, customerId, startSeconds: window.start.getTime() / 1000, endSeconds: window.end.getTime() / 1000,
  });
  const verdict = reconcileMeter(bands, stripeTotal);
  // A closed period is report-only (I9, S8): its invoice is final.
  if (!closing && verdict === "held_at_stripe") {
    for (const h of bands.heldRows) if (await markUsageReported(ctx.db, h.id, ctx.now)) c.heldStamped++;
  } else if (!closing && verdict === "held_missing") {
    for (const h of bands.heldRows) {
      need(1);
      let atStripe = false;
      try {
        await gateway.reportMeterEvent({
          eventName: METERS[meter].eventName, customerId, value: h.quantity,
          identifier: h.id, timestampSeconds: Math.floor(Date.parse(h.occurredAt) / 1000),
        }, usageIdempotencyKey(h.id, customerId));
      } catch (e) {
        // Stripe holding the identifier after all ("duplicate", A11): the
        // usage IS there, so stamp it. Anything else: the row stays held.
        if (meterEventFailureKind(e, h.id) !== "duplicate") {
          c.reconcileFailed++;
          console.error(`billing nightly: held usage row ${h.id} (account ${row.accountId}) not sent: ${String(e)}`);
          continue;
        }
        atStripe = true;
      }
      if (await markUsageReported(ctx.db, h.id, ctx.now)) { if (atStripe) c.heldStamped++; else c.heldSent++; }
    }
  }
  await saveReconciliation(ctx.db, {
    accountId: row.accountId, meter, windowStart: window.start.toISOString(), windowEnd: window.end.toISOString(),
    bisSettled: bands.settled, bisInFlight: bands.inFlight, bisHeld: bands.held, stripeTotal,
    verdict, checkedAt: ctx.now.toISOString(),
  });
  c.reconciled++;
  if (ALERTING_VERDICTS.includes(verdict)) {
    c.mismatched++;
    console.error(`billing nightly: ${meter} for account ${row.accountId}${closing ? " (closed period)" : ""} is ${verdict}: Stripe ${stripeTotal}, BIS settled ${bands.settled}, in flight ${bands.inFlight}, held ${bands.held} (window ${window.start.toISOString()} to ${window.end.toISOString()})`);
  }
}
```

**Review of 82634ba4, what shipped instead of the code above where they differ.** (1) The just-closed window is NOT looked up in `done`: its key is the old period's `window_start`, which the same 08:00 window already holds when the period was checked before a same-day rollover, so it would never be compared to its end; `closedPeriodWindow`'s own guard (the saved row reaches the current start) makes it once. (2) `reconcileMeter` takes the held rows' quantities and rules out every PARTIAL set: with held rows summing to H, smallest m, `held_missing` only while the total is in [lo, hi] AND below lo + m; `held_at_stripe` only while it is in [lo + H, hi + H] AND above hi + H − m; anything else between is `ambiguous` (stamping a partial set loses usage, sending one bills it twice). (3) and (4) are tests only (23, 24). (5) A REFUSED re-mirror writes nothing, so the row is re-read every tick of the window: the bound, stated rather than fixed, is `REMIRROR_READS` bounded reads per refused row per tick, inside the pass's budget, logged each time; stamping `stripe_checked_at` on a refusal would let a pause rest on a status Stripe never confirmed (G6), and recording a refusal needs a column (a migration). (6) The re-mirror's reads are capped at `REMIRROR_READS` = 2 (Global Constraints, Stripe). (7) The due (account, meter, period) list is computed before any Stripe call; nothing due returns before `listActiveMeters`. A failed `listActiveMeters` is counted `reconcileFailed` and the step returns, keeping the re-mirror counts. Deferred (item 8): healing permissions when every meter failed, and for ended accounts.

The `held_missing` send uses the reporter's key and identifier: more than 20 h have passed and the verdict says Stripe's total lacks the event, so a replay of an earlier acceptance is the only way it can succeed without a new event, and a "duplicate" refusal means Stripe has it; both end stamped once.

- [ ] **Step 6: `usageReportPass`.** The reporter's read passes `{ holdAfterMs: billingEnforced() ? USAGE_HOLD_AFTER_MS : null }` to `listReportableUsage` (I8). After `await bookkeeping();` on the Stripe-usable path only, on the pass's own `startedAt`:

```ts
    // The nightly step (plan G14), on THIS pass's clock and budget; it
    // returns at once with the switch off.
    try {
      Object.assign(c, await runBillingNightly(ctx, gateway, { startedAt, nowMs: () => Date.now() }));
    } catch (e) {
      console.error(`usage report: the nightly billing step failed outright: ${String(e)}`);
    }
```

The seven counters start at 0 in `c`. Doc: a step 5, and the hold.

- [ ] **Step 7: Run** Step 2's suites, plus `src/app/api/cron/reminders/route.test.ts`, `src/lib/automations/cron-coupling.test.ts`, `src/lib/automations/sentinel.test.ts`, `src/lib/billing/usage.test.ts`, `src/lib/billing/meter-event-failure.test.ts`, `src/lib/billing/webhook.test.ts` (the gateway signature change). Lint, typecheck.

- [ ] **Step 8: Commit** — `git commit -m "M7a PR-4: nightly reconciliation of usage with Stripe per period (the closed one once), held rows resolved, unpaid subscriptions re-read, permissions healed; all behind BILLING_ENFORCE and bounded"`.

### Task 9: Lift pause actions and the card's view model (MEDIUM, bis-frontend)

**Files:**
- Modify: `apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/settings/billing-actions.ts` (two actions), `apps/web/src/lib/billing/billing-view.ts`.
- Test: `settings/billing-actions.test.ts`, `lib/billing/billing-view.test.ts`.

**Interfaces:**
- Consumes: `clearBillingPause`, `undoLiftBillingPause`, `getAccountBilling`, `ALERTING_VERDICTS`, `type Reconciliation` (Task 2); `bumpHeldForAccount` (existing, `automation-log.ts:131`); `pauseCause`, `PAUSE_FORWARD_MS` (Task 4); keys (Task 3).
- Produces: `liftPauseAction(accountId): Promise<{ ok: true; liftedAt: string; pausedAt: string } | { ok: false; error: string }>`; `undoLiftPauseAction(accountId, liftedAt, pausedAt): Promise<BillingActionResult>`; `BillingCardView` gains `pause: { line: string; noForward: string | null } | null`, `lifted: string | null`, `pauseOff: boolean`, `reconciliation: string[]`, `can.liftPause: boolean`; `billingCardView` input gains `reconciliations: Reconciliation[]` and `enforced: boolean`.

- [ ] **Step 1: Failing tests.** `billing-actions.test.ts`: "liftPauseAction calls requireAgency FIRST (mutation: move it after the read → FAILS)"; "lifts with the stored updated_at and returns the liftedAt it wrote and the pausedAt it cleared (mutation: return Date.now() later → FAILS: Undo never matches; mutation: omit pausedAt → FAILS)"; "a successful lift bumps the account's held automations; a bump failure is logged and the lift still answers ok (mutation: skip the bump → FAILS; mutation: let it throw → FAILS)" (m7); "the Undo passes pausedAt through (mutation: pass liftedAt as pausedAt → FAILS)" (m1); "not paused → billing.error.notPaused (mutation: lift anyway → FAILS)"; "a lost race → billing.error.notPaused (mutation: report ok on conflict → FAILS)"; "undoLiftPauseAction stale → billing.error.cannotRepause (mutation: report ok on stale → FAILS)"; "a bad uuid or liftedAt → billing.error.stale, nothing read (mutation: drop the uuid check → FAILS)". `billing-view.test.ts`: "a paused past_due row: the payment line with both dates, can.liftPause (mutation: offer Lift on a complimentary row → FAILS)"; "an ended row: the ended line (mutation: always the payment line → FAILS)"; "paused 30 days or more with the switch ON: the noForward line; with it off, none (mutation: show it from day 29 → FAILS; mutation: ignore `enforced` → FAILS)" (m3); "lifted and still past_due: the lifted line, no Lift button (mutation: show Lift → FAILS)"; "lifted and the plan ended (canceled): the lifted line too (mutation: lifted only on payment_failed → FAILS)" (M10); "pauseOff only when a stamp exists and the switch is off (mutation: show it whenever off → FAILS)"; "reconciliation lines only for the alerting verdicts, with the meter's words and the check time in the account's zone (mutation: show held_missing → FAILS)".

- [ ] **Step 2: Run** — `pnpm --filter web exec vitest run src/lib/billing/billing-view.test.ts "src/app/(dashboard)/dashboard/accounts/[accountId]/settings/billing-actions.test.ts"`. Expected: FAIL.

- [ ] **Step 3: The actions** (after `removeComplimentaryAction`):

```ts
export type LiftResult = { ok: true; liftedAt: string; pausedAt: string } | { ok: false; error: string };

/** Lift pause (spec section 5; plan G3): immediate, with Undo (rule 6).
 *  Returns the pause's own start for the Undo (re-review m1), and bumps the
 *  account's held automations so they go next tick (m7). */
export async function liftPauseAction(accountId: string): Promise<LiftResult> {
  await requireAgency();
  if (!isUuid(accountId)) return { ok: false, error: m["billing.error.stale"] };
  const db = serviceDb();
  const now = new Date();
  const billing = await getAccountBilling(db, accountId);
  if (!billing?.billingPausedAt) return { ok: false, error: m["billing.error.notPaused"] };
  const r = await clearBillingPause(db, { accountId, expectedUpdatedAt: billing.updatedAt, now, lift: true });
  if (r === "conflict") return { ok: false, error: m["billing.error.notPaused"] };
  console.log(`billing: pause lifted by the agency for account ${accountId}`);
  try {
    // S-47d's own helper (automation-log.ts:131): every held row due now. A
    // failure only delays them to their next whole hour (G7a); never the lift.
    await bumpHeldForAccount(db, accountId);
  } catch (e) {
    console.error(`billing: held automations not bumped after the lift of account ${accountId}: ${loggableError(e)}`);
  }
  return { ok: true, liftedAt: now.toISOString(), pausedAt: billing.billingPausedAt };
}

/** The Lift's Undo: re-pauses only while THAT lift still stands, from the
 *  pause's own start (G3; m1). */
export async function undoLiftPauseAction(accountId: string, liftedAt: string, pausedAt: string): Promise<BillingActionResult> {
  await requireAgency();
  if (!isUuid(accountId) || Number.isNaN(Date.parse(liftedAt)) || Number.isNaN(Date.parse(pausedAt))) return fail("billing.error.stale");
  const r = await undoLiftBillingPause(serviceDb(), { accountId, liftedAt, pausedAt, now: new Date() });
  return r === "repaused" ? { ok: true } : fail("billing.error.cannotRepause");
}
```

- [ ] **Step 4: The view** (`billing-view.ts`; new inputs `reconciliations`, `enforced`):

```ts
  const pausedAt = billing?.billingPausedAt ?? null;
  const pause = pausedAt && billing
    ? {
        line: pauseCause(billing) === "ended"
          ? m["billing.card.pausedEnded"].replace("{date}", formatDay(new Date(pausedAt), zone))
          : m["billing.card.pausedPayment"].replace("{date}", formatDay(new Date(pausedAt), zone))
              .replace("{failed}", formatDay(new Date(billing.pastDueSince ?? pausedAt), zone)),
        // m3: a claim about calls, so only while the switch enforces it.
        noForward: input.enforced && now.getTime() - Date.parse(pausedAt) >= PAUSE_FORWARD_MS ? m["billing.card.noForward"] : null,
      }
    : null;
  // M10: on a still-unpaid OR an ended plan.
  const lifted = !pausedAt && billing?.pauseLiftedAt && (status === "payment_failed" || status === "canceled")
    ? m["billing.card.lifted"].replace("{date}", formatDay(new Date(billing.pauseLiftedAt), zone)) : null;
  const reconciliation = input.reconciliations
    .filter((r) => ALERTING_VERDICTS.includes(r.verdict))
    .map((r) => m["billing.card.reconcile.line"]
      .replace("{meter}", m[`billing.card.reconcile.meter.${r.meter}` as MessageKey])
      .replace("{stripe}", count(r.stripeTotal)).replace("{bis}", count(r.bisSettled + r.bisInFlight + r.bisHeld))
      .replace("{when}", formatMoment(new Date(r.checkedAt), zone)));
```

with `pauseOff: pausedAt !== null && !input.enforced` and `can.liftPause: pausedAt !== null && billing !== null && !billing.complimentary`. The card stays English (ratchet debt); the `.es` twins exist for the day it is translated.

- [ ] **Step 5: Run** Step 2's suites plus `billing-section.test.ts` (Task 11 wires the new inputs; until then pass `[]` and `false`); lint; typecheck.

- [ ] **Step 6: Commit** — `git commit -m "M7a PR-4: Lift pause and its Undo (agency), and the Billing card's pause, 30-day and reconciliation lines"`.

### Task 10: Client surfaces (LOW, bis-frontend)

**Files:**
- Create: `apps/web/src/components/billing-paused-banner.tsx` (+ `.test.ts`).
- Modify: `apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/layout.tsx:21, 42-75`, `apps/web/src/components/billing-banner.tsx` (bilingual), `apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/billing/page.tsx:80-105`.
- Test: `layout.test.ts`, `billing/page.test.ts`.

- [ ] **Step 1: `BillingPausedBanner`:**

```tsx
import Link from "next/link";
import { Notice } from "@/components/ui/notice";
import { m } from "@/lib/messages";
import { t } from "@/lib/i18n/t";
import type { Locale } from "@/lib/i18n/locale";

/**
 * The paused banner (spec section 5; plan G12). On every page of a paused
 * account, for every member and the agency. role="note" and the sentence is
 * the marker (DESIGN rule 3). tone crit: service is reduced right now. Its
 * words are true with or without a transfer number and on any day of the
 * pause (M3). Three audiences: the client Owner (link to Billing), Staff and
 * Technicians (Billing is Owner-only: a line instead), the agency (link to the
 * Settings card). `lang` on the sentence (the root html stays en).
 */
export function BillingPausedBanner({ audience, accountId, cause, locale }: {
  audience: "owner" | "member" | "agency"; accountId: string; cause: "payment" | "ended"; locale: Locale;
}) {
  if (audience === "agency") {
    return (
      <Notice tone="crit" role="note" className="text-foreground">
        {m["billing.paused.agency"]}{" "}
        <Link href={`/dashboard/accounts/${accountId}/settings#billing`} className="underline underline-offset-2">
          {m["billing.paused.agencyAction"]}
        </Link>
      </Notice>
    );
  }
  const sentence = t(m, cause === "ended" ? "billing.paused.client.ended" : "billing.paused.client.payment", locale);
  return (
    <Notice tone="crit" role="note" className="text-foreground">
      <span lang={locale}>
        {sentence}{" "}
        {audience === "owner" ? (
          <Link href={`/dashboard/accounts/${accountId}/billing`} className="underline underline-offset-2">
            {t(m, "billing.paused.client.action", locale)}
          </Link>
        ) : t(m, "billing.paused.client.staff", locale)}
      </span>
    </Notice>
  );
}
```

Tests: each audience's words and link; `lang="es"` and the Spanish sentence for `locale: "es"`.

- [ ] **Step 2: The layout.** Take `role` from `requireAccountAccess`'s return (`:21`, today destructured as `{ isAgency }`), then:

```tsx
  const [billingRow, verdict] = await Promise.all([
    readAccountBilling(accountId).catch((e: unknown) => {
      console.error(`account layout: billing read failed for ${accountId}: ${e instanceof Error ? e.message : String(e)}`);
      return null;
    }),
    billingVerdictFor(accountId),
  ]);
  const paymentFailed = showsPaymentFailedBanner(billingRow);
  const audience = isAgency ? "agency" : role === "owner" ? "owner" : "member";
```

When `verdict.paused`, render `<BillingPausedBanner audience={audience} accountId={accountId} cause={verdict.cause ?? "payment"} locale={locale} />`, otherwise the payment-failed banner as today (both never show: `showsPaymentFailedBanner` is false on a paused row, and with the switch off `verdict.paused` is false). Staff get the cause too: `billingVerdictFor` reads on the service client.

- [ ] **Step 3: The payment-failed banner, bilingual.** `BillingBanner` gains `locale: Locale` and uses `t(m, key, locale)` for its four keys inside `<span lang={locale}>`; the layout passes `locale` (`:63`).

- [ ] **Step 4: The Billing page's paused line.** Above Manage billing (near `:99`), when `(await billingVerdictFor(accountId)).paused`: `<p className="text-sm text-foreground" lang={locale}>{t(m, verdict.cause === "ended" ? "billing.page.paused.ended" : "billing.page.paused.payment", locale)}</p>`, with the page's locale read the layout's way. Manage billing stays.

- [ ] **Step 5: Tests** — `layout.test.ts`: the paused banner per audience, never beside the payment-failed one; switch off → none; a failed verdict read → none, the page renders. `page.test.ts`: the paused line per cause; Manage billing still rendered.

- [ ] **Step 6: Run** — `pnpm --filter web exec vitest run src/components "src/app/(dashboard)/dashboard/accounts/[accountId]/layout.test.ts" "src/app/(dashboard)/dashboard/accounts/[accountId]/billing" src/lib/i18n`, lint, typecheck.

- [ ] **Step 7: Commit** — `git commit -m "M7a PR-4: the paused banner on every page of a paused account, its Billing page line, and the payment-failed banner in Spanish"`.

### Task 11: Agency surfaces (LOW, bis-frontend)

**Files:**
- Create: `apps/web/src/components/billing-alert-banner.tsx` (+ `.test.ts`).
- Modify: `settings/billing-section.tsx` (read `listReconciliations(db, accountId, now)`, pass `enforced: billingEnforced()`, bind the two actions: `liftPauseAction.bind(null, accountId)` and `(liftedAt, pausedAt) => undoLiftPauseAction(accountId, liftedAt, pausedAt)`), `settings/billing-card.tsx`, `app/(dashboard)/dashboard/work/page.tsx:77-99, 199-201`, the styleguide (`page.tsx`, `billing-card-states.tsx`).
- Test: `billing-card.test.ts`, `billing-section.test.ts`, styleguide tests.

- [ ] **Step 1: `BillingAlertBanner`** — props `{ alerts: BillingAlert[] }`; nothing at zero; one line per kind present, in the order paused, paused 30+ days, payment failed, usage mismatch (`work.agency.billing.paused`, `.pausedNoForward`, `.paymentFailed`, `.mismatch`); each line = the label + up to five account links (`/dashboard/accounts/<id>/settings#billing`, the account's name, `data-account-id` on each link) + `work.agency.billing.more` for the rest; `tone="crit"` when any paused, paused 30+ or mismatch, else `"warn"`; `role="note"`. Tests: zero → null; the cap at five with "and 2 more"; the tone rule; the order.

- [ ] **Step 2: Work page** — `listBillingAlerts(db, now, { enforced: billingEnforced() }).catch(...)` joins the existing `Promise.all` (logged, `[]` on failure), and `<BillingAlertBanner alerts={billingAlerts} />` renders below `UsageStaleBanner`.

- [ ] **Step 3: The card** — under the status chip: `view.pause?.line`, `view.pause?.noForward`, `view.lifted`, `view.pauseOff ? m["billing.card.pauseOff"] : null`; a reconciliation block when `view.reconciliation.length > 0` (`billing.card.reconcile.title`, the lines, `billing.card.reconcile.help`); and, when `view.can.liftPause`, a ghost button `billing.card.liftPause` with `billing.card.liftPauseHelp`, which runs `liftPause()` immediately and on success toasts `billing.card.liftedToast` with an Undo calling `undoLiftPause(liftedAt, pausedAt)` (both from the Lift's answer; success `billing.card.repausedToast`), through the card's existing `run(go, success, undo)` helper (`billing-card.tsx:106-125`). Send billing link stays the one primary.

- [ ] **Step 4: Tests** — Lift pause is ghost, never a second primary; Undo calls the undo action with the returned `liftedAt` and `pausedAt`; the reconciliation block renders; the section's `enforced` comes from `billingEnforced()` (hard-coding true is red).

- [ ] **Step 5: Styleguide** — the card Paused (payment), Paused (ended), paused 30+ days, lifted (payment and ended), pause-off, mismatch; `BillingPausedBanner` × three audiences × en/es; `BillingAlertBanner` with all four kinds and one with seven names.

- [ ] **Step 6: Run** — the card, section, banner and styleguide tests; lint; typecheck; `pnpm --filter web build`.

- [ ] **Step 7: Commit** — `git commit -m "M7a PR-4: Lift pause on the Billing card, the reconciliation result, the work queue's billing banner (with the 30-day item), styleguide specimens"`.

### Task 12: e2e and the CI switch (MEDIUM, bis-e2e-qa)

**Files:**
- Create: `apps/web/e2e/billing-pause.spec.ts`.
- Modify: `.github/workflows/ci.yml` (e2e job env, beside `STRIPE_WEBHOOK_SECRET` `:331`), `apps/web/ci/ci-workflow.test.ts`.

- [ ] **Step 1: The switch in CI.** In the e2e job's `env:`:

```yaml
      # NOT a secret: turns the non-payment pause on for this job only (M7a
      # PR-4), so e2e/billing-pause.spec.ts sees it enforced. The spec pauses
      # the fixture account only, by its own row, and restores it. Production's
      # value is set on Vercel Production only, by the owner.
      BILLING_ENFORCE: "1"
```

`ci-workflow.test.ts`: "the e2e job turns BILLING_ENFORCE on and verify does not (mutation: remove it, or add it to verify → FAILS)".

- [ ] **Step 2: The spec** (`billing-pause.spec.ts`; serial; sorts before `billing.spec.ts`; FAILS loudly, never skips, when `BILLING_ENFORCE !== "1"` under `CI`; uses `serviceDb()` from the runner like `forward-calls.spec.ts`; the client fixture from `e2e/.auth/client-fixture.json`). It acts ONLY on the fixture's own rows: never `billingPausePass.run`, never `listPauseCandidates`, never anything that reads or writes another account (I5). `beforeAll` captures the fixture's `account_billing` row (expected none), inserts an `E2E Plan <stamp>` plan (fake Stripe ids, both features on) and a row for the fixture: `stripe_customer_id: cus_e2e_<stamp>`, `stripe_subscription_id: sub_e2e_<stamp>`, `subscription_status: past_due`, `past_due_since: now − 8 days`, `stripe_checked_at: now − 1 hour`. `afterAll` (`finally`, each step attempted and reported): deletes the row and the plan, restores the captured row if any. Tests, each with the production mutation it catches:
  1. "the fixture's row is paused by decidePause + pauseBilling (mutation: decidePause ignores stripe_checked_at's grace rule → FAILS: the row would also pause with a day-6 confirmation, asserted by a second fixture state first)" — set `stripe_checked_at` to day 6 → `decidePause` is `unconfirmed`; set it to now − 1 h → `pause`; `pauseBilling(serviceDb(), { accountId, expectedUpdatedAt: row.updatedAt, now })` → `"paused"`; the row's `billing_paused_at` is set.
  2. "the client Owner sees the paused banner on the dashboard and on Contacts, and the Billing page's paused line with Manage billing (mutation: the banner on the dashboard page alone → FAILS on Contacts)".
  3. "a change while paused is not saved and lands back on the same page (N1) (mutation: refuseActionWhilePaused not called from requireAccountAccess → FAILS: the status changes)" — on the dashboard, flip the business status switch (`one-switch.spec.ts`'s locators); expect the URL unchanged, the banner visible, `business_status` unchanged in the database.
  4. "the agency sees Paused on the Billing card, lifts it, sees the Undo, undoes, lifts again (mutation: Undo compares the lift stamps as strings → FAILS: 'can't be paused again'; mutation: Undo re-pauses at now → FAILS: billing_paused_at after the Undo differs from before the Lift)" — chip `Paused`, the pause line, `Lift pause`, toast `Pause lifted.` with Undo, Undo → `Paused again.` and `billing_paused_at` equal (as an instant) to its value before the Lift, Lift again; the row ends with `billing_paused_at` null and `pause_lifted_at` set.
  5. "the work queue lists the fixture under Paused, then under Payment failed after the lift (mutation: listBillingAlerts drops paused rows → FAILS)" — robust to other paused accounts on a shared database (I5): assert through `listBillingAlerts(serviceDb(), new Date())` that the fixture is present with the expected kind, AND that the page shows the line's label; when that line holds more than five names, assert the "and N more" text instead of the fixture's link.
  6. "S1: a real test-mode meter reconciles (mutation: meterTotal passes a value_grouping_window → FAILS: Stripe answers per hour)" (skips without a Stripe test key, like `usage-meter.spec.ts`; throwaway customer, no DB): report two events through `stripeGateway(...).reportMeterEvent`, poll `meterTotal` until their sum (120 s, A16's bound), expect `reconcileMeter({ settled: sum, inFlight: 0, heldQuantities: [] }, total) === "match"`; then a third event, polled, and `reconcileMeter({ settled: sum, inFlight: 0, heldQuantities: [third] }, total + third) === "held_at_stripe"`; delete the customer. "Unproven" is a `::warning`, not a failure (A16's rule).

- [ ] **Step 3: Run** — locally only if the env names the CI project (CLAUDE.md): `pnpm --filter web exec playwright test e2e/billing-pause.spec.ts`; otherwise push and read the e2e job FOR THE HEAD SHA. Also `pnpm --filter web exec vitest run ci/ci-workflow.test.ts e2e/fixtures` (`E2E Plan <stamp>` is already admitted, `stale.ts:214`).

- [ ] **Step 4: Commit** — `git commit -m "M7a PR-4: e2e for the pause on the fixture's own row, the read-only dashboard, Lift pause and the work queue; BILLING_ENFORCE on in CI's e2e job"`.

### Task 13: Docs (LOW, bis-platform)

**Files:**
- Modify: `.env.example` (beside `STRIPE_WEBHOOK_SECRET` `:310-317`), `docs/runbooks/stripe-billing.md` (new section 9 + edits to 5.6), `docs/crm-features.md:304` and `:948`.

- [ ] **Step 1: `.env.example`:**

```
# The non-payment pause, the plan gates and the nightly reconciliation (M7a
# PR-4). Exactly 1 = on: a billed account unpaid for 7 days, or whose plan
# ended, is paused (Sofia stops answering: calls go to its transfer number for
# 30 days, then a short call-back message; texts to its customers stop; its
# automations wait and go out once it is paid or lifted; the website chat
# closes; the client's dashboard is read-only), a plan without the receptionist
# or the website chat is enforced, the usage report holds rows over 20 hours
# for the nightly reconciliation, and that reconciliation runs. Unset = off:
# all of that stops, and the cron logs what it WOULD pause. Production only,
# set by the owner after the runbook's checks (docs/runbooks/stripe-billing.md
# section 9). Turning it off is the rollback. Needs a redeploy.
BILLING_ENFORCE=
```

- [ ] **Step 2: Runbook section 9, "The pause and the nightly reconciliation"**: what pauses and when (G1, G6's bound); what stops and what does not (G7-G11, G21); automations held and released (G7a); the 30-day rule and the work-queue item (I7; the number is never released automatically); turning it on (Task 14 Step 6); reading the cron log (`billingPause` counters; `wouldPause`/`unconfirmed` while off); Lift pause and its Undo; "a client paid but is still paused" (the webhook + the nightly re-read clear it within a day; to clear it at once, Lift pause from the card); each reconciliation verdict and what to do (`stripe_over`: check the draft invoice before it finalises and credit the difference; `stripe_under`: Stripe dropped events (A12): a manual invoice item or accept; `ambiguous`: compare `usage_events` with the Stripe meter's events for the window by hand); a closed-period mismatch (S8: found after the invoice is final: credit it); a held row from a closed period (G15: decide by hand, then set `reported_at`); the rollback SQL that clears every stamp (`update public.account_billing set billing_paused_at = null, updated_at = greatest(clock_timestamp(), updated_at + interval '1 millisecond') where billing_paused_at is not null;` — `updated_at` strictly forward even when a stored version is ahead of the clock, the `nextVersion` rule (re-review m2), run once through MCP after the switch is off: it clears without a lift stamp, so turning the switch back on re-pauses accounts still past due); the S2/S3/S4/S8 test-clock probe to run once in TEST mode before the switch goes on. Rewrite 5.6: the reporter now holds such rows (switch on) and reconciliation resolves them.

- [ ] **Step 3: `crm-features.md`** — `:304` "Shipped (M7a PR-3); the pause and reconciliation ship behind `BILLING_ENFORCE` (M7a PR-4)"; `:948` rule 9 per Q7: "M7a's non-payment pause pass (its nightly Stripe reconciliation runs inside the usage report)", and note that the vault took three passes.

- [ ] **Step 4: Commit** — `git commit -m "M7a PR-4: runbook for the pause and the reconciliation, BILLING_ENFORCE in .env.example, crm-features rule 9"`.

### Task 14: Final review, design review, one fix agent, gates, rollout (orchestrator)

- [ ] **Step 1: Counts from the runners, never from this plan** (PR-3's lesson): `git diff --name-only --diff-filter=AM origin/main HEAD -- apps/web packages/db | grep '\.test\.ts$'` → vitest `--reporter=json` for web, `vitest list --json` for db; e2e `test(` blocks.
- [ ] **Step 2: Final review (opus, bis-reviewer)** of `origin/main..HEAD` against this plan and spec section 9, re-running a sample of every HIGH task's mutation probes, plus: the five-importer scan; `decidePause`'s grace, I1 and freshness boundaries; the hold (I6) on both gates and its deadline drop; the 30-day forward (I7); the gates' fail-closed / route's fail-open; the allow-list audit (each `why`, and M6); the TeXML order (screen, guards, VOICE_FORWARD_TO before billing; the billing read started before the counts); `nextVersion` in every writer; the budget sum unchanged and every nightly Stripe call bounded; the switch-off rollback (I8) end to end.
- [ ] **Step 3: Design review (bis-design-reviewer)** on a running build: the paused banner (three audiences, en and es, the pseudo-locale +35%, 375 px, both themes, the blur fallback, focus ring on `--crit-bg`), the Billing card's paused / 30-day / lifted / pause-off / mismatch states and Lift pause's Undo by keyboard, the work-queue banner, the Billing page's paused line, the styleguide specimens. Also PR-3's still-open running-build checks.
- [ ] **Step 4: ONE fix agent** for both reviews' findings; no re-review unless it touches a HIGH task's logic.
- [ ] **Step 5: Gates and production migration.** `pnpm check`, `pnpm --filter web build`, `pnpm --filter web test:e2e` (CI, head SHA). 0099 to production through MCP `apply_migration` ONCE (ASCII, no backslash), then the parity check (`docs/runbooks/ci-supabase-project.md`), BEFORE the merge (LOAD-BEARING: the build selects the new columns). Merge via squash PR (auto-merge armed on green).
- [ ] **Step 6: Turning it on (the owner, after the merge, in this order):**
  1. Leave `BILLING_ENFORCE` unset for at least one night. Read the cron log: `billingPause.wouldPause`, `wouldUnpause` and `unconfirmed` name only accounts you expect (with the switch off nothing re-reads Stripe nightly, so past-due accounts mostly show as `unconfirmed`; that is expected). The work queue's billing banner already shows payment-failed accounts. The reconciliation does NOT run while off (I8): its first results come the first night after step 4.
  2. Run the runbook's TEST-mode probe (S2, S3, S4, S8) once.
  3. Check every billed account's plan features: a plan with `voice_receptionist: false` sends that client's calls to their transfer number the moment the switch is on (Q5). Set each such account's transfer number first.
  4. Set `BILLING_ENFORCE=1` on Vercel **Production only**; redeploy. The next night's cron log should show `usageReport.reconciled` > 0 for each billed account and no `mismatched`.
  5. **Rollback (required steps, M4):** unset it and redeploy. Every reader ignores the stamps at once; held automations go out within the hour; the reporter stops holding; the nightly stops. Then clear every stamp with the runbook's one SQL statement (section 9), so no card still says Paused and no stale stamp re-enforces when the switch comes back on. Do not use Lift for this: a lift stamp would stop those accounts re-pausing for the same unpaid stretch.
- [ ] **Step 7: Ledger and tracker** — `.superpowers/sdd/progress.md` lines; roadmap tracker rows (memory `bis-roadmap-tracker`); memory `bis-next-work`.

## Self-review (done while writing)

- **Spec coverage.** Flow 5: past_due stamping (PR-3, verified), banner (existing + Task 10), agency alert (Task 11), the 7-day pass (Task 4), automations held (Task 5), customer texts stop (Task 5), read-only (Task 7), voice forward/message with the 30-day limit (Task 6), payment clears (Task 2 mirror, Task 4 heal), lift by hand (Tasks 2, 9, 11). Flow 6: canceled → pause after the period (Task 4). Section 4: nightly reconciliation + alert (Tasks 8, 11), permissions (Task 2's derived read, Task 7's scan), rollout behind a switch (Tasks 4, 8, 12, 14). Section 5: Lift pause on the card, paused banner (Tasks 10, 11). Section 6: unit (Tasks 4-9), DB (Tasks 1-2), E2E (Task 12), reconciliation mismatch alert (Tasks 8, 12 S1). PR-3 Next plans (a)-(h): (a) G1; (b) G4 + `nextVersion` everywhere; (c) G12, G19; (d) G6, scoped; (e) G18; (f) G13; (g) G14, G15; (h) Global Constraints / S2.
- **Placeholder scan.** The places that name a list the implementer builds (Task 7 Step 1's audit; Task 2 Step 5's local type names) say what to read and how to decide; everything else carries its code or its exact strings.
- **Type consistency.** `BillingStanding` carries `subscriptionStatus` (Task 2) only for `pauseCause`; `billingVerdict` takes `now` and returns `forward` (Task 4), which `voiceBlock` carries to the TeXML route (Task 6) and `billingVerdictFor` (Task 7) to the layout and the card; `PAUSE_FORWARD_MS` equals `PAUSE_ALERT_FORWARD_MS` (pinned); `voiceBlock`'s reasons equal 0099's CHECK values and `ForwardKind`/`ScreenedReason`; `ReconciliationVerdict` equals 0099's CHECK; `reconciledSince`'s key includes `window_start` like 0099's primary key; `liftPauseAction` returns the `liftedAt` that `undoLiftBillingPause` compares by instant.
- **Brief deviation, recorded:** the brief cites "`docs/crm-features.md` §4 rule 9"; the rule is in §3.2 (`:936`, `:948`).

## Revision 2 changes (review of a633b219, and the owner's answers)

| Item | Where it landed |
|---|---|
| Owner Q1-Q8 | "Owner decisions" section (the questions are now decisions); Q7's text change is Task 13 |
| I6 automations held | G7a; Task 5 (`pause-hold.ts`, `holdOrSend`'s catch, two `automations.reason.*` keys, copy count 42 → 44) |
| I7 30 days | G5 (`forward`), G9, G13 (`paused_no_forward`), G19; Task 4 (`PAUSE_FORWARD_MS`), Task 6 (tests 1-2), Task 2 (alerts), Task 11 |
| I1 premature confirmation | G6 (the bound that holds), `decidePause` (`checked − since ≥ grace`), Task 4 test 4; spec section 9 and 0099's two comments reworded |
| I2 unbounded nightly calls | Global Constraints (Stripe); Task 8 (`bounded` option, `need(2)` before a re-mirror, `need(1)` before `listActiveMeters`; tests 12-14) |
| I3 Checkpoint A red | Task 1 adds the two `screened.reason.*` labels; dependencies note |
| I4 nightly guard | the 08:00 guard and its test removed; G14 "once per 24-hour window starting 08:00 UTC"; Task 8 tests 1 and 11 |
| I5 e2e pass on shared db | Task 12: `decidePause` + `pauseBilling` on the fixture's row only; test 5 robust to "and N more" |
| I8 switch off = rollback | Global Constraints, Goal, Q8, Task 2 (`holdAfterMs`), Task 8 (nightly returns at once; test 10; reporter test), Task 13, Task 14 Step 6 |
| I9 closed period | 0099 key `(account_id, meter, window_start)`; G14 (and its remaining gaps); `closedPeriodWindow`; Task 8 tests 3 and 19; G13's alert rule |
| I10 mutation names | every HIGH/MEDIUM assertion in Tasks 6, 7, 8, 9, 12 now names its mutation |
| M1 TeXML read start | G9; Task 6 Step 3 (started before the counts, own catch; tests 8-9) |
| M2 ai-summary GET | G21; Task 7 Step 7 (gate wrapper on GET and POST; tests) |
| M3 banner copy | G12; Task 3 (the sentences; a test forbids "phone") |
| M4 rollback lifts stamps | Task 14 Step 6.5 (required SQL clear), Task 13 runbook |
| M5 counts | External facts: 15 SMS kinds, 48 `"use server"` files, 38 account-scoped, 14 `apiAccountAccess` routes |
| M6 getForwardingAddressAction | G11; Task 7 Step 1 and test 8 |
| M7 standing-read fallback | Task 6 no longer creates it; dependency 6 after 7 |
| M8 alerts end | G13; Task 2 `listBillingAlerts` (30/44 days, newest night per key, 48 h) |
| M9 gates on serviceDb | Global Constraints; Task 5 (both gates; test; service-reads entry) |
| M10 lifted line on ended plans | G19; Task 9 Step 4 and test |
| M11 staff.document_request_email | G8; `emailStopsWhilePaused` doc; Task 5 test |
| M12 `/c` layout | Task 6 Step 5 (`conciergeOpen` in page and layout; test) |
| M13 Closed today / Storm | Non-goals; Task 6 Step 3 note |
| Spec §4 Preview line | G22; spec section 4 fixed |

## Revision 3 changes (re-review of 7680f3ea; 0099 unchanged)

| Item | Where it landed |
|---|---|
| I1 the hold rewrote every tick | G7a; Task 5 `pauseHoldUntil` (the next whole UTC hour), `pauseHoldInForce` short-circuit before the gate; tests "two holds 15 minutes apart in the same hour write once (mutation: now + 60 min → FAILS)" and "a pause hold in force returns held without calling send()" |
| I2 stale non-appointment recipes | G7a; Task 5 Step 7b (`pauseDeadline` per recipe from its own max-age constant: review request, referral ask, no-show nudge, quote follow-up; one test per recipe); follow-up, instant reply and text-back already expire; reactivation has no age constant and relies on its release re-check (stated for the owner) |
| m1 Undo restores pausedAt | G3; Task 2 `undoLiftBillingPause` (+ test 8b); Task 9 `liftPauseAction` returns `pausedAt`, Undo passes it; Task 11 wiring; Task 12 test 4 |
| m2 rollback SQL | Task 13 runbook: `updated_at = greatest(clock_timestamp(), updated_at + interval '1 millisecond')` |
| m3 30-day lines only when enforced | G13, G19; Task 2 `listBillingAlerts(db, now, { enforced })` (+ test); Task 9 `noForward` (+ test); Task 11 work page |
| m4 unconfirmed log level | Task 4 pass: `console.log`, test 18 |
| m5 e2e test 2 | the un-failable mutation clause removed |
| m6 latestReconciliations bounded | Task 2: 70-day lookback, 50 accounts per read, 1,000-row pages until empty (+ test); callers pass `now` |
| m7 Lift bumps held rows | G3, G7a; Task 9 `liftPauseAction` calls `bumpHeldForAccount` (+ test) |
