# M7a PR-4: The Non-Payment Pause, Lift Pause, the Plan Gates and the Nightly Stripe Reconciliation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship rollout step (4) of M7a client billing, behind its own switch (`BILLING_ENFORCE=1`, off by default). A billed account whose payment has been failing for 7 days, or whose plan has ended, is PAUSED: calls go to the business's own transfer number instead of Sofía (or, with none, a short "please call back"), every text to its customers and every automation stops, the website chat closes, and its dashboard is read-only for the client. Payment clears the pause at once; the agency can Lift it by hand (immediate, with Undo). A plan without Sofía or without the website chat is enforced by the same decision. Every night the usage BIS reported is compared with Stripe's own meter totals per account, held usage rows from PR-3's ">24 h" gap are resolved, and any mismatch is shown to the agency before the invoice finalises.

**Architecture:** Three layers, as in PR-1..3. **Data** (`packages/db/src/account-billing.ts`, `usage.ts`, new `billing-reconciliations.ts`) gains one read (`readBillingStanding`: the pause stamp and the plan's features in one embed), compare-and-set pause writers that move `updated_at` with `nextVersion` (PR-3 B5), and the reconciliation store. **Policy** (`apps/web/src/lib/billing/standing.ts`, pure) decides, from stored rows only: pause or not (`decidePause`), and what an account may do now (`billingVerdict`). **Enforcement** reads that ONE verdict at the existing chokepoints, never per caller: the SMS and email send gates, the TeXML answer route's existing decision order, the concierge's two entry points, and `requireAccountAccess` for client server actions. A new cron pass (`billingPause`) stamps and heals pauses; the nightly reconciliation runs inside the existing `usageReport` pass under its own budget. One migration, **0099**, additive only.

**Tech Stack:** Next.js 16.3.6 (App Router, server actions, route handlers), Supabase Postgres 17 (RLS), `@supabase/supabase-js`, vitest 4, Playwright, `stripe@22.6.2` (API `2026-08-26.dahlia`), Tailwind 4 with the repo's tokens.

**Spec:** `docs/superpowers/specs/2026-09-24-m7a-client-billing-design.md`, sections 3 flows 5-6, 4, 5 (Lift pause, paused banner), 6, and the new section 9 (amendments this plan forces, committed with it). Builds on PR-3 (`docs/superpowers/plans/2026-09-25-m7a-pr3-checkout-webhooks-billing.md`), whose "Next plans" item 1 (a)-(h) is binding here; each is answered in G1-G20 below.

## Global Constraints

- **Tiers are per TASK** (`bis-speed-process`, binding since 2026-10-19). HIGH: full ceremony (brief review, opus review with mutation probes, re-review, the orchestrator applies the migration once). MEDIUM: implementer + one review. LOW: implementer only, covered by the end-of-PR review. Every new assertion in a HIGH or MEDIUM task names, in its title, the mutation that turns it red; the reviewer applies those probes. Copy and styleguide assertions need no probe.
- **The switch.** Every enforcement reads `billingEnforced()` (`lib/billing/enforce.ts`): `process.env.BILLING_ENFORCE === "1"`, nothing else counts as on (not `"true"`, not `" 1"`). OFF: nothing is paused, stopped, forwarded, closed or read-only because of billing, and the pause pass writes NOTHING (it counts what it would do). ON only on Vercel Production after rollout (Task 14), and in CI's e2e job (Task 12). Never on Vercel Preview.
- **One decision, read in one place.** What an account may do is `billingVerdict(standing, enforced)` over `readBillingStanding` (one row read with the plan embedded). No enforcement reads `accounts.permissions` (G4). No caller adds its own billing check: exactly five files import `readBillingStanding` — the SMS gate, the email gate, the TeXML route, the concierge turn route, and `lib/billing/standing-read.ts`, which alone serves the paused banner, the read-only guard in `requireAccountAccess` and the `/c` page — pinned by a source scan (Task 7).
- **Failure direction is the house rule of each chokepoint, stated once:** the SMS and email gates FAIL CLOSED on an unreadable billing row (blocked `ledger_unavailable`, their existing doctrine); the TeXML route, the concierge and the read-only guard FAIL OPEN (answer, chat, allow), because wrongly cutting off a paying client is worse than one unbilled call or chat, and each logs.
- **Every `account_billing` writer moves `updated_at` strictly forward with `nextVersion`** (PR-3 Global Constraints, B5): the pause pass, Lift pause, its Undo, and the mirror. Pause writes are compare-and-set on `updated_at`; a lost race is skipped this tick, never retried in a loop.
- **The pause never rests on a stale Stripe status.** A past-due pause needs `stripe_checked_at` within `STRIPE_FRESH_MS` (26 h); the nightly step re-reads every unpaid subscription (G6).
- **Unbilled accounts (no `account_billing` row) and complimentary rows are never paused and keep every feature** (spec section 2; 0051's `account_billing_complimentary_check`).
- **Writes**: the billing tables only through `serviceDb()` after `requireAgency()` (agency actions) or from the cron (service role). The billing standing read for the banner, the guard and the concierge goes through `serviceDb()` (a client Staff session reads NO `account_billing` row under 0066's `account_billing_owner_read`, so RLS cannot tell Staff their account is paused), from one listed module (`lib/billing/standing-read.ts`) with its reason in `in-account-service-reads.test.ts`.
- **Stripe**: the pause pass makes no Stripe call. The nightly step's calls run under `USAGE_REPORT_BUDGET_MS` (shared, no new budget; `cron-coupling.test.ts:335-346` pins the sum at exactly `maxDuration`). Per-request transport `{ maxNetworkRetries: 0, timeout: METER_EVENT_TIMEOUT_MS }`, as `reportMeterEvent` does. Money stays integer cents; meter totals are compared as exact integers (a non-integer `aggregated_value` is `ambiguous`, never rounded).
- **DB tests (`packages/db`) run only in CI.** Implementers never apply migrations. 0099 goes to `bis-ci` first (`ci-project-setup.yml`, Checkpoint A), then production through MCP before merge, then parity (Task 14). It is additive: it widens two CHECKs and adds nullable columns and one table, so applying it to the shared CI project cannot break another branch.
- **Copy** lives in `apps/web/src/lib/messages.ts`, plain language, no milestone codes (`messages.test.ts` scans every key). Every new key outside the agency-only prefixes (`lib/i18n/ratchet-scan.ts:82-84`) ships with its `.es` twin in the owner register already in the catalogue (usted: "Suba un archivo o tome una foto", `messages.ts:4393`; "dueño", #287). Never hand-edit `catalogue-baseline.json`; regenerate it (`pnpm --filter web exec tsx scripts/generate-i18n-baseline.ts`, `ratchet.test.ts:1-11`).
- **UI follows DESIGN.md**: tokens only; both themes through `.dark`; status is dot + word (`BILLING_STATUS_TREATMENTS` already has Paused); loaded/empty/error states; one primary per card (rule 8: Send billing link stays the card's primary, Lift pause is ghost); Lift pause runs immediately with an Undo toast (rule 6); new components get `/dashboard/styleguide` specimens; the paused banner renders in English and Spanish and survives the pseudo-locale's +35%.
- **The e2e suite never touches `Test Client One`.** It runs on the per-run fixture `E2E Client Co <stamp>` and restores what it changed (workers = 1, `playwright.config.ts:166-171`).
- **Affected tests, every task** (memory `bis-agent-test-scope`, `bis-lane-pipeline`): every test file that references a changed export; every bare `vi.mock("@bis/db", () => ({...}))` factory that the changed code now dereferences (a missing export throws only when touched; the plan says which reads happen only with the switch on); every source-scanning test (`grep -rln "readFileSync\|webSources\|code(" apps/web/src --include=*.test.ts`), always including `lib/consent/scans.test.ts`, `lib/automations/sentinel.test.ts` (pass order, `:296`), `lib/automations/cron-coupling.test.ts`, `app/(dashboard)/dashboard/accounts/[accountId]/in-account-service-reads.test.ts`; any lane that adds a `messages.ts` key runs `lib/consent/copy.test.ts` (pins `automations.reason.*` at 42 English keys, `:41-54`) and `lib/messages.test.ts`; every lane runs `pnpm --filter web lint` and `pnpm --filter web typecheck` (or `tsc -p apps/web`). Never the full suite locally (CI is the gate).
- Gates before merge: `pnpm check`, `pnpm --filter web build`, `pnpm --filter web test:e2e`. CI runs them (`verify`, `e2e`). Read the check runs FOR THE HEAD SHA.

## Scope

In:
1. The pause: the `billingPause` cron pass (stamp after 7 days unpaid, or once an ended plan's period is over; heal a pause the mirror missed), the mirror clearing the pause on payment, and `stripe_checked_at`.
2. Enforcement, behind `BILLING_ENFORCE`: SMS gate, email gate (automation kinds), TeXML answer route (forward / message), concierge page + turn route, read-only client server actions (+ the one client API POST).
3. The plan gates (`voice_receptionist`, `web_concierge`) through the same verdict (PR-3 G9 deferred them here).
4. The agency: Lift pause (+ Undo) on the Billing card, the work-queue billing banner (payment failed / paused / usage mismatch), the reconciliation result on the card.
5. The client: the paused banner on every page (Owner, Staff, Technician), the paused line on the Billing page, the payment-failed banner made bilingual.
6. Nightly: re-read every unpaid or paused subscription from Stripe, reconcile month-to-date usage per account and meter, resolve held >24 h usage rows, rewrite `accounts.permissions` from the plan.
7. Migration 0099; runbook; `.env.example`; CI e2e switch.

Non-goals (each is a deliberate line, not an oversight):
- No email or SMS to the client when the pause starts or lifts (owner question 3; Stripe's own failed-payment emails are on, PR-3 DECISION 7).
- No "Pause now" button for the agency: a pause comes only from the pass (spec section 4 "only the agency ... lifts a pause"). The Undo of a Lift is the one manual re-pause.
- No change to Stripe dunning, no auto-cancel (PR-3 DECISION 7), no change to the reporter's send logic except the hold (G15).
- No nightly re-mirror of EVERY subscription (PR-3 Next plans (d)): only unpaid and paused ones, because those are the only rows a pause decision reads (G6).
- No enforcement in the SIP webhook (`api/voice/incoming/route.ts`): the decision lives once, in the TeXML route (G9).
- The Billing page and Billing card stay English-only except the lines this PR adds (their 81 keys are frozen ratchet debt, `catalogue-baseline.json`); the payment-failed banner's 4 keys are translated here because the paused banner sits beside it.
- The demo ("Talk to Sofía" on bis-rgv.com, `api/voice/web/session`), inbound email and inbound SMS, STOP/HELP/START replies, owner alerts, the weekly report and the public booking page and forms are NOT stopped (G10, owner questions 1 and 6).
- Multi-agency (M7 #3), Change-plan B4 (PR-3 Next plans 3), self-serve sign-up (M7 #2).

## Owner decisions this plan encodes (sources)

- Grace, then soft pause; 7 days; lifts on payment or by hand (spec section 1, row "Non-payment"; section 3 flow 5).
- Cancellation ends at period end, then the same soft pause; nothing is deleted (spec section 3 flow 6).
- Forward to the existing handoff number, else a short "please call back" and log the call (spec section 3 flow 5).
- The pause is rollout step 4, behind its own switch, last (spec section 4).
- Stripe dunning: Smart Retries, then MARK UNPAID, never auto-cancel; Stripe's receipts and failed-payment emails ON (memory `bis-m7a-billing-decisions`, PR-3 DECISION 7). So the pause sees `past_due`, then `unpaid`; never an automatic `canceled`.
- Live billing may start before PR-4; the >24 h stale banner is the tripwire meanwhile (PR-3 DECISION 6). PR-4's reconciliation is the backstop (PR-3 B10, Next plans (g)).
- Stale-usage alerts are a derived agency banner + `console.error`, not email (memory `bis-m7a-billing-decisions`). Reconciliation follows the same channel (G17).
- What bills is unchanged (memory `bis-m7a-billing-decisions`).
- The Customer Portal stays update-card + invoices only (PR-3 DECISION 3): a paused client pays through it; a canceled one sees invoices only.

## Open questions for the owner (each has a recommendation; the plan is written to the recommendation and names the one constant or list that changes otherwise)

1. **Which texts still go out while paused?** Recommended: every text to the business's CUSTOMERS stops (automations, the text-back, staff-typed texts, document requests), but the owner's own alerts (`operator.*`) and the STOP/START/HELP replies (`consent.*`) still go: the carriers' rules expect a HELP and STOP answer, and the owner alerts are unbilled and help a business whose calls are now forwarded. The spec says "every outbound SMS". (One function, `smsStopsWhilePaused`, Task 5.)
2. **A paused account with no transfer number: message or Sofía takes a message?** Recommended: the spec's short "please call back" message, logged on the agency's Screened calls list. Sofía answering costs BIS the call and undoes the pause. (Task 6, `COPY.unavailable`.)
3. **Email the client when the pause starts?** Recommended: no BIS email in this PR. Stripe already emails each failed payment (DECISION 7), and the paused banner is on every page of their dashboard. Adding one later is a small, separate change (an `operator.*` kind and a template).
4. **After you Lift a pause by hand, when may it come back on its own?** Recommended: not for the same unpaid stretch. It stays lifted until they pay (then a later failure starts a new 7 days) or the plan ends. The alternative is "7 more days, then pause again". (`decidePause`, Task 4: `liftedAt >= pastDueSince`.)
5. **A plan WITHOUT Sofía: what happens to calls?** Recommended: the same as a pause (forward to the transfer number, else the message), and a plan without the website chat closes the chat. Both only while `BILLING_ENFORCE` is on. (`billingVerdict`, Task 4.)
6. **While paused, do the public booking page and forms keep working?** Recommended: yes, with their confirmation emails; only their TEXTS stop (question 1). The pause is aimed at the business, not its customers. The website chat stops (it is a metered AI cost).
7. **The cron tick's pass budget** (`docs/crm-features.md` §3.2 rule 9, `:948`: at most six new passes, "M7a's non-payment pause pass and nightly Stripe reconciliation" named as two). Since that rule (`0970a2c5`, 14 passes), four were added: the vault took three (`documentsSweep`, `documentsScan`, `documentsExpiry`) of its two, plus `opsWatch`, and the consent reconciliation is still owed one. Recommended: M7a adds ONE pass (`billingPause`) and runs the reconciliation inside the existing `usageReport` pass (it is that pass's audit, and it must share its Stripe budget anyway, Global Constraints). Total stays at six. (Task 13 updates the rule's text.)
8. **One switch for the pause AND the plan gates, as an env var** (`BILLING_ENFORCE=1` on Vercel Production; a change needs a redeploy, like `VOICE_HANDOFF_ENFORCE`, `.env.example:269-271`). Recommended: yes. Turning it off is the whole rollback: every reader ignores the stamps at once, without SQL.

## External facts: verified vs assumed

Verified on 2026-10-26 (this worktree, `3e73b4d6`):
- `account_billing.past_due_since` and `billing_paused_at` exist (`0051_billing_core.sql:163-164`); `account_billing_complimentary_check` forbids a complimentary row with a pause (`:167-168`). The mirror stamps `past_due_since` (`account-billing.ts:286`) and never touches `billing_paused_at` (`:330`).
- `nextVersion` is module-private (`account-billing.ts:223-226`). `writePermissions` is module-private (`:312-318`). The only reader of `accounts.permissions` is the Setup wizard (`lib/setup/setup-inputs.ts:104`, `setup-status.ts:209-212`).
- `billingStatusOf` already maps `billingPausedAt` to Paused (`billing-view.ts:20`), and `showsPaymentFailedBanner` already hides itself on a paused row (`:41-44`).
- The account layout reads billing through the cached RLS read and fails soft (`accounts/[accountId]/layout.tsx:52-57`). A client Staff session reads no `account_billing` row (0066 `account_billing_owner_read`, `0066_staff_and_roles.sql:95-98`; the layout's comment `:45-51`).
- The cron registry holds 18 passes, order pinned by `sentinel.test.ts:296`. `cron-coupling.test.ts:335-346` pins five budgets summing to 240 s + 60 s headroom = `maxDuration` 300 exactly (`api/cron/reminders/route.ts:16`).
- The usage report: `usageReportPass` (`lib/automations/passes/usage-report.ts`), `USAGE_REPORT_BUDGET_MS` 60 s and `METER_EVENT_WORST_CASE_MS` 21 s (`caps.ts:138-140`), `listReportableUsage` (`packages/db/src/usage.ts:279`).
- The SMS gate's step 3 reads `isAccountOutboundSuppressed` and fails closed (`lib/consent/gate.ts:192-197`); the email gate's equivalent (`email-gate.ts:252-260`). `BLOCK_REASONS` and `EMAIL_BLOCK_REASONS` are exhaustive `Record`s over the block reasons (`hold-or-send.ts:255-276`), so a new reason is a type error until mapped. A blocked automation is logged `skipped` and stamped (`hold-or-send.ts` doc, "SmsBlocked → skipped").
- SMS kinds and classes: `lib/consent/classes.ts:31-48` (operator: `operator.alert_sms`, `operator.alert_phone_code`; consent_reply: three `consent.*`). Email kinds `:96-131`.
- TeXML: decision order in `route()` (`api/voice/texml/route.ts:616-748`): deployment-wide `VOICE_FORWARD_TO` (`:622-630`), `classify` guards (refuse, blocked, cap, `:632-674`), the press-1 screen (`:680-704`), the per-account forward (`:705-724`), the bridge. `classify` reads the profile at `:240-241`. `accountForwardTarget` (`:521-550`) resolves the transfer number with the loop guards. Forwarded calls are recorded in `forwarded_calls` (`forwarded_calls_kind_check`, `0059_forwarded_calls.sql:81`) and counted by the caps (`countForwardedCallsSince` counts every kind, `packages/db/src/forwarded-calls.ts:58-66`). Refusals go to `screened_calls` (`screened_calls_reason_check`, `0039_screened_calls.sql:69-72`; `ScreenedReason`, `screened-calls.ts:13-19`; labels `messages.ts:3780-3785`).
- S-47d (#286, 0097) changes how SOFÍA answers (`api/voice/incoming/route.ts`, the prompt, the topbar), not the TeXML routing: a paused call never reaches Sofía, so the business status needs no composition beyond running BEFORE the bridge (G9).
- Concierge entry points: `/c/[publicId]/page.tsx:88` (`isConciergeLive` → `notFound()`), and the turn route (`api/concierge/[publicId]/turn/route.ts:221-224`, unknown/off → 404 `not_found`).
- `requireAccountAccess` (`lib/auth.ts:36-61`) is the guard every account server action reaches, directly or through `requireAccountOwner` (`:71-79`) / `requireNotTechnician` (`:142-149`); the agency returns at `:43`. 47 `"use server"` files export 206 actions; the six without any guard are public or user-level (`preferences/actions.ts`, `b/`, `f/`, `u/`). The 15 `apiAccountAccess` routes are GET-only except `ai-summary` (GET and POST, `api/accounts/[accountId]/contacts/[contactId]/ai-summary/route.ts:97-98`).
- Next.js 16.3.6's server-action request header constant is `next-action` (`apps/web/node_modules/next/dist/client/components/app-router-headers.js:96`).
- `stripe@22.6.2` types `billing.meters.listEventSummaries(id, { customer, start_time, end_time, value_grouping_window? })`, both times minute-aligned, one summary for the range when no window is given (`node_modules/stripe/cjs/resources/Billing/Meters.d.ts:33,216-236`); `MeterEventSummary.aggregated_value: number` (`MeterEventSummaries.d.ts`).
- The e2e job has no `CRON_SECRET` (`e2e/usage-meter.spec.ts:37`; `ci.yml` env `:302-340`), runs on a throwaway local stack, serially (`playwright.config.ts:166-171`), and the fixture account owns no phone number (`e2e/forward-calls.spec.ts`, "The fixture account owns no numbers of its own").
- The client-write digest is `52|b66203ca5d355155540b520af510d120` (`packages/db/src/test/proposals-drop.test.ts:100`); 23 definers in `EXPECTED_DEFINERS` (`definer-search-path.test.ts:27`; 0098 header "22 -> 23").

Assumptions (not verified; each names what settles it):
- **S1. Meter summaries are exact and settle within 2 h.** `listEventSummaries` returns the sum of the customer's ACCEPTED events whose timestamps fall in `[start_time, end_time)`. PR-2's `usage-meter.spec.ts` observed a summary within 120 s in test mode (PR-2 A16) and accepted-order aggregation (A17); `RECONCILE_SETTLE_MS` (2 h) is a margin, not a documented bound. **Settled by:** Task 12's e2e (a real test-mode meter: report two rows through the gateway, wait for the sum, run `reconcileMeter` against it, expect `match`; then a third row sent to Stripe but left unstamped and back-dated past the hold, expect `held_at_stripe`).
- **S2. Smart Retries keeps the subscription `past_due` past day 7**, then `unpaid` after the last retry (PR-3 B11; DECISION 7). Pausing on day 7 while Stripe still retries is the spec's design. **Settled by:** the runbook's pre-launch probe (Task 13, test clock), before the switch goes on.
- **S3. A canceled subscription keeps its items' `current_period_end`** at the end of the paid period, so "paused once the period is over" holds; an immediate cancel in the dashboard leaves the stored end in the future, which only delays the pause (generous direction). **Settled by:** the same probe.
- **S4. Meter events for a customer with no live subscription are accepted and never invoiced.** So usage recorded between a cancellation and the pause tick (at most one 15-minute tick, since Sofía, texts and chat stop at the pause) bills nobody. PR-3 Next plans (e): the reporter is NOT changed. **Settled by:** the probe (report one event after cancel, read the next invoice preview: none).
- **S5. `aggregated_value` for a `sum` meter of whole-number values is a whole number.** A non-integer is reported `ambiguous`, never rounded.
- **S6. Stripe's own `paused` status never occurs** (it needs a trial without a payment method; there are no trials, DECISION 5). `decidePause` neither pauses nor heals on it; the card shows Paused (existing mapping).
- **S7. Identifier uniqueness lasts at least 24 h** (Stripe docs, PR-3 B10). The hold starts at 20 h (`USAGE_HOLD_AFTER_MS`).
- **N1. `next-action` is on the request of every server action, readable through `headers()` inside the action body; `redirect()` there navigates the browser** (documented). **Settled by:** Task 12's e2e (a paused client's edit lands back on its page, unsaved).

## Spec gaps resolved here (the reviewer should confirm or overrule)

- **G1. Pause rule** (`decidePause`, pure, Task 4). For a row that is not complimentary and has a subscription:
  - already paused: `unpause` when the status is `active` or `trialing` (the mirror clears it, G2; this heals a missed write), otherwise `keep`;
  - `past_due` / `unpaid`: `pause` when `now - past_due_since >= PAUSE_GRACE_MS` (7 days), the agency has not lifted this stretch (`pause_lifted_at >= past_due_since`, owner question 4), and Stripe confirmed the status within 26 h (`stripe_checked_at`, G6); `unconfirmed` when only the last fails (counted and logged, retried next tick);
  - `canceled`: `pause` once `current_period_end <= now` (or it is null), unless lifted after that end;
  - anything else (`incomplete`, `incomplete_expired`, `paused`, `active`, `trialing`): `keep`. `incomplete_expired` is a first checkout that never paid: the account was never served on a plan, so it stays as an unbilled one would (spec "unbilled ... never paused").
- **G2. Payment clears the pause in the mirror** (spec flow 5 "Payment (invoice.paid → active) clears the pause"). `decideMirror` writes `billing_paused_at: null` when the re-read status is `active` or `trialing`, and never otherwise. The pause pass heals the same case (G1), so a mirror that wrote before 0099's build still converges within a tick.
- **G3. Lift pause.** Agency only (`requireAgency`). Compare-and-set: clears `billing_paused_at`, stamps `pause_lifted_at = now`, moves `updated_at` with `nextVersion`. Undo re-pauses only while the row still carries that lift stamp, is still unpaid or ended, and is not complimentary; otherwise it says the billing changed. 0099 adds `account_billing_lift_check` (no lift stamp on a complimentary row).
- **G4. Permissions (PR-3 Next plans (b)).** Enforcement derives the features from `account_billing.plan_id → plans.features` at READ time (`readBillingStanding`, one embed), so the PR-3 race (permissions written outside the compare-and-set) cannot reach a gate. `accounts.permissions` keeps being written (the Setup wizard reads it) and the nightly step rewrites it from the plan (`healPermissions`), so its drift lasts at most a day and only changes which Setup steps show.
- **G5. The verdict** (`billingVerdict`, pure). Not enforced, or no row (unbilled): everything on. Otherwise `paused = pausedAt !== null`; `voice = !paused && features.voice_receptionist`; `concierge = !paused && features.web_concierge`; `readOnly = paused`. Complimentary rows follow their plan's features and are never paused.
- **G6. Stripe freshness (PR-3 Next plans (d)).** The mirror stamps `stripe_checked_at = now` on every write (0099 column). The nightly step re-mirrors every subscription whose row is `past_due`, `unpaid` or paused (one `retrieveSubscription` each, under the usage budget). A past-due pause needs that stamp within 26 h, so an `invoice.paid` webhook that never arrived cannot pause a client who paid, and a pause already stamped is lifted within a day of the payment by the same re-read. This is the ONLY re-mirror added; a missed webhook on an `active` row changes nothing the pause reads.
- **G7. SMS while paused** (owner question 1): the SMS gate blocks with `billing_paused` every kind whose class is `customer_initiated`, `informational`, `marketing` or `staff_typed`; `operator` and `consent_reply` pass. A new step 3b, right after the suppression check (`gate.ts:192-197`), so it covers every SMS path, present and future.
- **G8. Email while paused**: the email gate blocks with `billing_paused` every `automation.*` kind ("automations stop"); every other kind passes (booking and form receipts, operator alerts, staff-typed mail, which the read-only guard already limits to the agency).
- **G9. Calls while paused or without Sofía** (owner questions 2 and 5). In the TeXML route, AFTER every guard and the press-1 screen and BEFORE the per-account forward and the bridge, a call whose verdict has `voice = false`:
  - a CLEARED call is forwarded to the account's transfer number (the same resolver and loop guards as the per-account forward), recorded in `forwarded_calls` with kind `billing-paused` or `plan-no-voice` (so the daily caps count it);
  - otherwise (no usable transfer number, or the call was not cleared) the caller hears `COPY.unavailable` in the profile's languages, and the call is recorded in `screened_calls` with the same reason, which the agency's Screened calls list shows.
  An uncleared call is never forwarded (`route.ts:708-711`'s rule: a call the guards could not vouch for never rings a person's phone). A failed billing read changes nothing (fail open). The deployment-wide `VOICE_FORWARD_TO` still runs first. The SIP webhook gets no billing check: a paused call reaches Sofía only when the TeXML route's own read failed, and the webhook declining then would be dead air instead of the answer fail-open promised.
- **G10. What stops, what does not** (owner question 6): stop = texts per G7, automation emails per G8, Sofía per G9, the website chat (both entry points answer as for a switched-off chat: 404), client writes per G11. Keep = the public booking page and forms (and their emails), inbound email and SMS (recorded), STOP/HELP/START replies, owner alerts, the weekly report, the demo (BIS's own number, never billed), the agency's own actions.
- **G11. "Dashboard read-only"** = a CLIENT caller's server action on a paused account is refused inside `requireAccountAccess`: it redirects to the page the action came from (the `referer`'s path, only when it is inside `/dashboard/accounts/<id>/`), else the caller's account home; nothing is written, and the paused banner on that page says why. Pages, layouts and GETs are untouched (no `next-action` header). The agency is never read-only. Exactly these server actions stay usable while paused, each opting out with `{ duringPause: "allow" }` and pinned with its reason by `lib/billing/read-only.test.ts`: Manage billing (`openBillingPortalAction`: the way to pay), the shell's snapshot poll (`getShellSnapshot`) and every other action that only READS (Task 7 audits all 206 exports; the starting candidates are `getDocumentUrlAction`, `countContactDocumentsAction`, `searchGroupsAction`, `searchRelatableContactsAction`, `getForwardingAddressAction`, checked one by one, because a getter that lazily creates a row is a write). The one client API write, `ai-summary`'s POST (Regenerate, a model call), refuses with 409 `{ error: "paused" }`. An allowed action must not revalidate (its re-render would run the page's guard under the same `next-action` header); the scan pins that too.
- **G12. The paused banner** is mounted beside the payment-failed one in the account layout, for every member (Owner, Staff, Technician) and the agency, read through `billingVerdictFor` (service role, cached per request). It shows only while the switch is on and the account is paused. Two causes, two sentences (payment / ended); the client Owner gets a link to Billing, Staff and Technicians a line saying the owner can update the card (Billing is Owner-only, `requireAccountOwner`); the agency gets the Settings link. `role="note"`, `tone="crit"`, the sentence is the marker (DESIGN rule 3).
- **G13. The agency alert** (spec flow 5; PR-3 Next plans (f)): one derived banner on the work queue (`/dashboard/work`), LineDownBanner's pattern (derived, nothing stored, renders nothing at zero), listing by name, each linking to the account's `settings#billing`: "Payment failed: …", "Paused: …", "Usage doesn't match Stripe: …", at most five names per line plus "and N more". Read failure → no banner, logged (the queue is the page).
- **G14. Nightly reconciliation (spec section 4; PR-3 Next plans (g)).** Inside `usageReportPass`, after the sends and bookkeeping, on the first ticks at or after 08:00 UTC each day (`nightlyRunStart`), sharing the pass's 60 s budget (a Stripe call starts only while `elapsed < USAGE_REPORT_BUDGET_MS - METER_EVENT_WORST_CASE_MS`); whatever the budget does not reach is done by the next tick, because the unit of work is one (account, meter) whose latest `checked_at` is before today's run start. For each live subscription (not ended, not complimentary): the window is `[ceilMinute(max(current_period_start, billing_started_at)), floorMinute(now))`; BIS's side is split into three bands by `readUsageBands` (settled = reported at least 2 h ago; in flight = reported within 2 h, or unreported and recorded within the hold; held = unreported and recorded at least 20 h ago); Stripe's side is `meterTotal`. The verdict is pure (`reconcileMeter`, Task 8): `match`, `held_at_stripe` (stamp the held rows reported), `held_missing` (send them now, then stamp), `stripe_over`, `stripe_under`, `ambiguous`. The latest verdict per (account, meter) is upserted into `billing_reconciliations`; the last three are alerts (G13, the card line, `console.error`).
- **G15. The hold (PR-3 B10).** `listReportableUsage` stops returning a row recorded `USAGE_HOLD_AFTER_MS` (20 h) ago or more: it is never blindly resent past Stripe's dedupe window. Only reconciliation sends or stamps it (G14). A held row from a period that has already closed cannot be compared any more: it stays unreported, the stale banner keeps showing its account (correct: it needs a person), and the runbook says what to do. Rows of a NEW account in its first day are unaffected (they report within a tick).
- **G16. Pass order.** `billingPause` runs FIRST, ahead of `releaseHeld`: a pause stamped this tick stops this tick's held releases and every recipe after it. It touches no automation state, so the release-first contract (`registry.ts:22-26`) stands between the release and the recipes; `route.ts`'s and `release-held.ts`'s "the FIRST pass" wording is updated to "the release pass". It makes no Stripe call and has no wall-clock budget (one paged read of at most the billed accounts, a few compare-and-set writes), so the budget sum is unchanged.
- **G17. Alert channels**: banners (work queue, card) + `console.error` per tick/night. No email, no heartbeat failure (a nightly heartbeat would read as a stale pass to `opsWatch`). The `usageReport` pass's counters gain `reconciled`, `mismatched`, `heldStamped`, `heldSent`, `remirrored`, `reconcileSkippedBudget`.
- **G18. Cancellation's usage (PR-3 Next plans (e))**: the reporter keeps sending rows of a canceled account (S4: never invoiced); nothing new is recorded once paused. No code change.
- **G19. The card**: status word already covers Paused. New lines: "Paused since Oct 20: the payment failed on Oct 13." / "Paused since Oct 20: the plan ended."; after a lift, "Pause lifted Oct 26."; the ghost **Lift pause** (only while paused); with the switch off and a stamp present, "Pausing is switched off here, so this pause changes nothing."; reconciliation mismatches as one line per meter with when it was checked.
- **G20. Client Billing page**: one paused line above Manage billing (payment / ended); Manage billing stays available while paused (it is how they pay; an ended plan's portal shows invoices only, PR-3 G19).

## Migration 0099 impact

- **Needed: yes.** Four facts have no column today: who lifted a pause and when (`pause_lifted_at`, G3), when Stripe last confirmed a row (`stripe_checked_at`, G6), the nightly result (`billing_reconciliations`, G13/G14, which the work queue must read between nights without calling Stripe), and two new recorded reasons a CHECK refuses today (`forwarded_calls.kind`, `screened_calls.reason`, G9). `billing_paused_at` and `past_due_since` already exist (0051).
- **0096 rule**: no function is created or re-created, so no `search_path` clause is needed; stated in the header.
- **Definers**: none added; `EXPECTED_DEFINERS` unchanged (23).
- **Client-write digest**: unchanged at `52|b66203ca5d355155540b520af510d120` (the new table grants `authenticated` SELECT only; added columns change no grant). `schema-grants-guard.test.ts` `EXPECTED_WRITES` unchanged.
- **Grants guard**: the new table has RLS on, no PUBLIC policy, and no client write, so the schema-wide guard passes without an allow-list edit.
- **Teardown**: `billing_reconciliations` cascades with its account (0051's reasoning for `account_billing`), so it is NOT on `ACCOUNT_OWNED_TABLES`.
- **Rollback**: in the file's header (Task 1).

## File Structure

Created:
- `packages/db/supabase/migrations/0099_billing_pause.sql` — the migration.
- `packages/db/src/test/billing-pause-schema.test.ts` — its live proof (CI).
- `packages/db/src/billing-reconciliations.ts` — the reconciliation store.
- `packages/db/src/test/billing-pause.test.ts` — live round trips of the new writers and reads (CI).
- `apps/web/src/lib/billing/enforce.ts` — the switch.
- `apps/web/src/lib/billing/standing.ts` (+ `.test.ts`) — `decidePause`, `billingVerdict`, constants. Pure.
- `apps/web/src/lib/billing/standing-read.ts` (+ `.test.ts`) — `billingVerdictFor`: the one cached service-role read for the layout, the guard and the concierge page.
- `apps/web/src/lib/billing/read-only.ts` (+ `.test.ts`) — the action refusal, `sameAccountPath`, the allow-list scan.
- `apps/web/src/lib/billing/reconcile.ts` (+ `.test.ts`) — `reconcileMeter`, `reconcileWindow`, `nightlyRunStart`. Pure.
- `apps/web/src/lib/billing/nightly.ts` (+ `.test.ts`) — the nightly step (re-mirror, reconcile, resolve the held rows, heal permissions).
- `apps/web/src/lib/automations/passes/billing-pause.ts` (+ `.test.ts`) — the pass.
- `apps/web/src/components/billing-paused-banner.tsx` (+ `.test.ts`).
- `apps/web/src/components/billing-alert-banner.tsx` (+ `.test.ts`).
- `apps/web/e2e/billing-pause.spec.ts`.

Modified (main ones; each task lists its own):
- `packages/db/src/account-billing.ts`, `usage.ts`, `screened-calls.ts`, `forwarded-calls.ts`, `index.ts`, `account-billing.test.ts`, `test/usage.test.ts`.
- `apps/web/src/lib/consent/gate.ts`, `email-gate.ts`, `classes.ts`, `lib/automations/hold-or-send.ts`, `registry.ts`, `passes/usage-report.ts`, `passes/release-held.ts` (comment), `api/cron/reminders/route.ts` (comment).
- `apps/web/src/app/api/voice/texml/route.ts`, `app/api/concierge/[publicId]/turn/route.ts`, `app/c/[publicId]/page.tsx`.
- `apps/web/src/lib/auth.ts`, the opted-out action files, `api/accounts/[accountId]/contacts/[contactId]/ai-summary/route.ts`.
- `apps/web/src/lib/billing/stripe-gateway.ts`, `fake-gateway.ts`, `billing-view.ts`.
- `apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/layout.tsx`, `billing/page.tsx`, `settings/billing-actions.ts`, `settings/billing-card.tsx`, `settings/billing-section.tsx`, `components/billing-banner.tsx`, `app/(dashboard)/dashboard/work/page.tsx`, `conversations/actions.ts`, styleguide.
- `apps/web/src/lib/messages.ts`, `lib/i18n/catalogue-baseline.json` (regenerated).
- `.github/workflows/ci.yml`, `apps/web/ci/ci-workflow.test.ts`, `.env.example`, `docs/runbooks/stripe-billing.md`, `docs/crm-features.md`.

## Task order, tiers, owners and checkpoints

| # | Task | Tier | Owner |
|---|---|---|---|
| 1 | Migration 0099 and its live proof | HIGH | bis-db-schema |
| — | **Checkpoint A** (orchestrator): 0099 to `bis-ci` via `ci-project-setup.yml`; push; `verify` runs the db suite there | — | orchestrator |
| 2 | Data layer: standing read, pause writers, mirror, alerts, reconciliation store, usage hold and bands | HIGH | bis-db-schema |
| 3 | Copy, English and Spanish | LOW | bis-frontend |
| 4 | The switch, the pure policy, and the `billingPause` pass | HIGH | bis-automations |
| 5 | The two send gates | HIGH | bis-comms |
| 6 | The TeXML answer route and the concierge | HIGH | bis-voice |
| 7 | Read-only client actions | HIGH | bis-platform |
| 8 | Nightly: re-mirror, reconcile, the held rows, permissions | HIGH | bis-automations |
| 9 | Lift pause actions and the card's view model | MEDIUM | bis-frontend |
| 10 | Client surfaces: paused banner, layout, Billing page, bilingual payment-failed banner | LOW | bis-frontend |
| 11 | Agency surfaces: Billing card, work-queue banner, styleguide | LOW | bis-frontend |
| 12 | e2e and the CI switch | MEDIUM | bis-e2e-qa |
| 13 | Docs: runbook, `.env.example`, crm-features rule 9 | LOW | bis-platform |
| 14 | Final review, design review, one fix agent, gates, rollout | — | orchestrator (opus reviewer, bis-design-reviewer, one fix agent) |

Dependencies: 2 needs 1's columns only at run time (CI). 4, 5, 6, 7, 8, 9 need 2. 5 and 9 need 3's keys. 5, 6, 7, 8 need 4's `enforce.ts`/`standing.ts`. 10 needs 3, 4, 7 (`standing-read.ts`). 11 needs 3 and 9. 12 needs everything. 13 any time after 4.

Parallel lanes on disjoint files: after 4, {5}, {6}, {7}, {8} touch different files (5 and 8 both import `@bis/db`, neither edits the other's files). {10} and {11} run in parallel after 9 (both edit the styleguide page: merge by hand). `messages.ts` is written ONLY by Task 3.

Commands run from the repo root `C:\Users\danlo\bis-platform\.claude\worktrees\m7a-pr4` (Git Bash).

---

### Task 1: Migration 0099 and its live proof (HIGH, bis-db-schema)

**Files:**
- Create: `packages/db/supabase/migrations/0099_billing_pause.sql`
- Create: `packages/db/src/test/billing-pause-schema.test.ts`
- Modify: `packages/db/src/screened-calls.ts:13-22` (union + its mirror list), `packages/db/src/forwarded-calls.ts:15-18` (`ForwardKind`, `FORWARD_KINDS`), `apps/web/src/lib/messages.ts` is NOT touched here (the two `screened.reason.*` labels are Task 3's).

**Interfaces:**
- Produces: columns `account_billing.pause_lifted_at`, `account_billing.stripe_checked_at`; table `billing_reconciliations`; `ScreenedReason` gains `"billing-paused" | "plan-no-voice"`; `ForwardKind` gains the same two.

- [ ] **Step 1: Write the failing live test** `packages/db/src/test/billing-pause-schema.test.ts` (uses `withRollback`, `actAs` from `./db`, the seed shape of `billing-checkout-schema.test.ts`). Cases (each title names its mutation):
  1. "pause_lifted_at and stripe_checked_at are nullable timestamptz with no default (mutation: add `default now()` to stripe_checked_at → FAILS)" — `information_schema.columns` for both: `data_type = 'timestamp with time zone'`, `is_nullable = 'YES'`, `column_default is null`.
  2. "a complimentary row cannot carry a lift stamp (mutation: drop account_billing_lift_check → FAILS)" — insert a complimentary row, then `update ... set pause_lifted_at = now()` expects `23514`.
  3. "billing_reconciliations: RLS on, exactly one SELECT policy for the agency (mutation: add `or account_id = app.current_account_id()` → FAILS)" — `pg_policies` equals `[{ policyname: "billing_reconciliations_agency_read", cmd: "SELECT", roles: "{authenticated}", permissive: "PERMISSIVE" }]`; `relrowsecurity` true.
  4. "a client reads no reconciliation row, the agency reads it (mutation: policy `using (true)` → FAILS)" — seed one row as service, `actAs(c, { org_id, app_role: "client" ...})` select count 0; `actAs` agency count 1.
  5. "anon and authenticated hold SELECT at most, MAINTAIN included (mutation: enumerated revoke instead of `revoke all` → FAILS)" — `has_table_privilege` false for INSERT/UPDATE/DELETE/TRUNCATE/REFERENCES/TRIGGER/MAINTAIN for both roles; SELECT true for authenticated only.
  6. "the row cascades with its account (mutation: `on delete restrict` → FAILS)".
  7. "CHECKs refuse a bad meter, verdict, window and negative count (mutation: drop billing_reconciliations_verdict_check → FAILS)" — `ai_chat` meter, `bogus` verdict, `window_end = window_start`, `bis_held = -1`, `stripe_total = -1`, each `23514`.
  8. "forwarded_calls takes billing-paused and plan-no-voice, still refuses anything else (mutation: leave plan-no-voice out → FAILS)"; same for `screened_calls`.
  9. "both widened CHECKs are VALIDATED (mutation: drop the `validate constraint` lines → FAILS)" — `pg_constraint.convalidated` true for `forwarded_calls_kind_check` and `screened_calls_reason_check`.
  10. "ScreenedReason and FORWARD_KINDS mirror the CHECKs (mutation: drop a value from the TS list → FAILS)" — parse `pg_get_constraintdef` and compare with the exported lists.

- [ ] **Step 2: Typecheck the test** — `pnpm --filter @bis/db exec tsc --noEmit`. Expected: passes except the missing TS union members (red until Step 3). The live cases are red until Checkpoint A (CI only; never run the db suite locally against bis-ci, memory `bis-agent-test-scope`).

- [ ] **Step 3: Write the migration** `packages/db/supabase/migrations/0099_billing_pause.sql`:

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
--     the subscription (every mirror write sets it). A past-due pause needs it within 26 hours, so a
--     missed invoice.paid webhook can never pause a client who paid. NULL on every row before the first
--     mirror write after this file, which only delays a pause.
--   public.billing_reconciliations  the latest nightly comparison per account and meter: BIS's settled,
--     in-flight and held usage, Stripe's total over the same window, and the verdict.
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
-- ROLLBACK (roll the app back first), in this order. Deleting reconciliation rows loses only last night's
-- comparison; the two call-record values are records, so relabelling them is an owner decision.
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
  'When the webhook mirror last wrote what Stripe said about this subscription (set on every mirror write; the nightly step re-reads every unpaid one). A past-due pause needs it within 26 hours. NULL until the first mirror write after 0099.';

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
  primary key (account_id, meter)
);

comment on table public.billing_reconciliations is
  'The latest nightly comparison of BIS usage (usage_events) with Stripe''s meter total, per account and meter, over the current billing period up to the run. One row per (account, meter), replaced each night. The agency reads it (work queue, Billing card); only service_role writes.';

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

- [ ] **Step 4: Widen the two TS mirrors.** `packages/db/src/screened-calls.ts`: add `| "billing-paused" | "plan-no-voice"` to `ScreenedReason` and to its mirrored list (the comment at `:21` says "Keep the two in step"). `packages/db/src/forwarded-calls.ts:15-18`: `export type ForwardKind = "account-forward" | "model-down" | "billing-paused" | "plan-no-voice";` and the same four in `FORWARD_KINDS`.

- [ ] **Step 5: Typecheck and lint** — `pnpm --filter @bis/db exec tsc --noEmit && pnpm --filter web exec tsc --noEmit`. The web side compiles: the screened-calls table and styleguide index `m[\`screened.reason.${reason}\`]` by template, so the two new labels (Task 3) are needed before the web build; run Task 3 before building web, or expect `tsc` to name `screened.reason.billing-paused` until then.

- [ ] **Step 6: Commit** — `git add packages/db/supabase/migrations/0099_billing_pause.sql packages/db/src/test/billing-pause-schema.test.ts packages/db/src/screened-calls.ts packages/db/src/forwarded-calls.ts && git commit -m "M7a PR-4: migration 0099 (Lift pause, Stripe freshness, reconciliations, two call reasons) and its live proof"`

### Checkpoint A (ORCHESTRATOR ONLY, not an implementer step)

1. `ci-project-setup.yml` with 0099: push-dry-run, then push, to `bis-ci`.
2. Push the branch; `verify` runs `billing-pause-schema.test.ts`, `proposals-drop.test.ts` (digest unchanged), `definer-search-path.test.ts` (unchanged), `schema-grants-guard.test.ts` (unchanged) against the local stack; `e2e`'s migration check proves 0099 is on bis-ci.
3. The reviewer applies Step 1's mutation probes on a scratch copy of the SQL against the LOCAL replica (memory `bis-local-db-replica`), never against bis-ci.

### Task 2: Data layer (HIGH, bis-db-schema)

**Files:**
- Modify: `packages/db/src/account-billing.ts` (types `:57-98`, `decideMirror` `:233-293`, new exports), `packages/db/src/usage.ts` (`listReportableUsage` `:279-297`, new `readUsageBands`, `USAGE_HOLD_AFTER_MS`), `packages/db/src/index.ts:222-237`.
- Create: `packages/db/src/billing-reconciliations.ts`.
- Test: `packages/db/src/account-billing.test.ts` (unit, `recorder` stub `:150`), `packages/db/src/billing-reconciliations.test.ts` (unit), `packages/db/src/test/billing-pause.test.ts` (live, CI), `packages/db/src/test/usage.test.ts` (live, CI; existing).
- Fixture updates (add `pauseLiftedAt: null, stripeCheckedAt: null` to every literal `AccountBilling`): `apps/web/src/lib/billing/billing-view.test.ts`, `billing-link.test.ts`, `app/(dashboard)/dashboard/accounts/[accountId]/billing/page.test.ts`, `layout.test.ts`, `settings/billing-actions.test.ts`, `settings/billing-section.test.ts`, `app/(dashboard)/dashboard/styleguide/billing-card-states.tsx`, `packages/db/src/account-billing.test.ts` (`stored()` `:26`).

**Interfaces:**
- Produces (all exported from `@bis/db`):
  - `AccountBilling` gains `pauseLiftedAt: string | null; stripeCheckedAt: string | null`.
  - `PAID_STATUSES: readonly SubscriptionStatus[]` = `["active", "trialing"]`.
  - `nextVersion(now: Date, stored: string | undefined): string` (now exported, body unchanged).
  - `type BillingStanding = { complimentary: boolean; pausedAt: string | null; subscriptionStatus: SubscriptionStatus | null; features: PlanFeatures }` (the status only says WHY a paused account is paused, for the banner; `billingVerdict` ignores it).
  - `readBillingStanding(db, accountId): Promise<BillingStanding | null>` (null = unbilled; throws on a read error).
  - `listPauseCandidates(db): Promise<AccountBilling[]>`.
  - `pauseBilling(db, { accountId, expectedUpdatedAt, now }): Promise<"paused" | "conflict">`.
  - `clearBillingPause(db, { accountId, expectedUpdatedAt, now, lift }): Promise<"cleared" | "conflict">` (`lift: true` also stamps `pause_lifted_at`).
  - `undoLiftBillingPause(db, { accountId, liftedAt, now }): Promise<"repaused" | "stale">`.
  - `healPermissions(db, accountId): Promise<void>`.
  - `type BillingAlert = { accountId: string; accountName: string; kind: "payment_failed" | "paused" | "usage_mismatch"; since: string }`; `listBillingAlerts(db): Promise<BillingAlert[]>`.
  - `listReconcilableAccounts(db): Promise<AccountBilling[]>` (live subscription, not complimentary).
  - From `billing-reconciliations.ts`: `RECONCILIATION_VERDICTS`, `type ReconciliationVerdict`, `type ReconciliationWrite`, `type Reconciliation`, `saveReconciliation(db, w)`, `listReconciliations(db, accountId)`, `reconciledSince(db, sinceIso): Promise<Set<string>>` (keys `"<accountId>:<meter>"`).
  - From `usage.ts`: `USAGE_HOLD_AFTER_MS` (20 h), `type UsageBands = { settled: number; inFlight: number; held: number; heldRows: UsageRow[] }`, `readUsageBands(db, { accountId, meter, startIso, endIso, now, settleMs }): Promise<UsageBands>`.

- [ ] **Step 1: Write the failing unit tests** in `packages/db/src/account-billing.test.ts` (extend `stored()` with the two new fields):
  1. "decideMirror stamps stripe_checked_at with now on every write (mutation: drop the field → FAILS)".
  2. "decideMirror clears billing_paused_at when Stripe says active or trialing (mutation: drop the clear → FAILS)" — row has `billing_paused_at: null` for both.
  3. "decideMirror leaves billing_paused_at out of the row for past_due, unpaid, canceled, incomplete (mutation: always write null → FAILS)" — `"billing_paused_at" in row` is false.
  4. "pauseBilling is compare-and-set on updated_at and moves it with nextVersion (mutation: drop `.eq('updated_at', …)` → FAILS)" — recorder sees `update({ billing_paused_at: NOW, updated_at: nextVersion(NOW, stored) })` filtered by `account_id`, `updated_at`, `complimentary = false`, `billing_paused_at is null`.
  5. "pauseBilling answers conflict when no row matched (mutation: return 'paused' on an empty result → FAILS)".
  6. "clearBillingPause with lift stamps pause_lifted_at; without lift it does not (mutation: always stamp → FAILS)".
  7. "undoLiftBillingPause refuses when the stored lift is not the one passed (mutation: skip the lift comparison → FAILS)" — compares by `Date.parse`, so `…123Z` equals PostgREST's `…123+00:00`.
  8. "undoLiftBillingPause refuses a row that is now active, complimentary, or has no subscription (mutation: drop the status check → FAILS)".
  9. "readBillingStanding returns null with no row, the status and the plan's features from the embed, and throws on an error (mutation: default features to true when the embed is missing → FAILS)" — a row whose `plans` embed is null throws (`billing: standing read found no plan for account …`): a billed row always has a plan (`plan_id not null`), so a missing embed is a read fault, never "everything on".
  10. "listPauseCandidates pages until an EMPTY page (mutation: stop on a short page → FAILS)" — PR-1's binding rule (PR-3 G11).
  11. "listBillingAlerts names payment_failed (past_due/unpaid, not paused), paused, and usage_mismatch for stripe_over/stripe_under/ambiguous only (mutation: count held_missing as a mismatch → FAILS)".
  And `packages/db/src/billing-reconciliations.test.ts`:
  12. "saveReconciliation upserts on (account_id, meter) with every field (mutation: insert instead of upsert → FAILS)".
  13. "reconciledSince keys rows by account and meter, checked at or after the instant (mutation: gt instead of gte → FAILS)".
  And the usage hold (`packages/db/src/usage.test.ts`, unit):
  14. "listReportableUsage leaves out a row recorded USAGE_HOLD_AFTER_MS ago or more (mutation: drop the created_at filter → FAILS)".
  15. "readUsageBands sorts each row into settled, in flight or held by reported_at and created_at (mutation: count a row reported 1 h ago as settled → FAILS)".

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

`toBilling` maps `pause_lifted_at → pauseLiftedAt`, `stripe_checked_at → stripeCheckedAt`; `AccountBillingDbRow` gains the two.

`nextVersion` becomes `export function nextVersion(...)` (body unchanged).

`MirrorRow` gains `stripe_checked_at: string; billing_paused_at?: null;` and `decideMirror`'s returned row:

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
 * What enforcement reads (plan G4, G5): the pause stamp and the PLAN's
 * features, in one embed read through account_billing.plan_id. Never
 * accounts.permissions, which the mirror writes outside its compare-and-set
 * (PR-3 B5). null = no row = unbilled (everything on). A row always has a
 * plan (plan_id not null, restrict), so a missing embed is a read fault and
 * throws; each caller decides what a throw means (plan Global Constraints).
 * Needs serviceDb(): plans is agency-read only, and a client Staff session
 * reads no account_billing row at all (0066).
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

/** Every row the pause pass may act on: not complimentary, with a
 *  subscription, and paused or in a status the pass reads (G1). Paged by
 *  account id until an actually EMPTY page (PR-1 binding rule). */
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
 *  over an existing pause. */
export async function pauseBilling(
  db: SupabaseClient, input: { accountId: string; expectedUpdatedAt: string; now: Date },
): Promise<"paused" | "conflict"> {
  const { data, error } = await db.from("account_billing")
    .update({ billing_paused_at: input.now.toISOString(), updated_at: nextVersion(input.now, input.expectedUpdatedAt) })
    .eq("account_id", input.accountId).eq("updated_at", input.expectedUpdatedAt)
    .eq("complimentary", false).is("billing_paused_at", null)
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
 *  ended. Anything else is "stale": the billing changed under the toast. */
export async function undoLiftBillingPause(
  db: SupabaseClient, input: { accountId: string; liftedAt: string; now: Date },
): Promise<"repaused" | "stale"> {
  const row = await getAccountBilling(db, input.accountId);
  const sameLift = row?.pauseLiftedAt != null && Date.parse(row.pauseLiftedAt) === Date.parse(input.liftedAt);
  const status = row?.subscriptionStatus ?? null;
  const pausable = status !== null && (PAST_DUE_STATUSES.includes(status) || status === "canceled");
  if (!row || !sameLift || row.billingPausedAt || row.complimentary || !row.stripeSubscriptionId || !pausable) return "stale";
  const { data, error } = await db.from("account_billing")
    .update({ billing_paused_at: input.now.toISOString(), pause_lifted_at: null, updated_at: nextVersion(input.now, row.updatedAt) })
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

The alerts and the reconcilable list:

```ts
export type BillingAlert = {
  accountId: string; accountName: string; kind: "payment_failed" | "paused" | "usage_mismatch"; since: string;
};

/** The agency's work-queue banner (G13). Agency only: the caller has run
 *  requireAgency() and passes serviceDb(). Names come from accounts.name,
 *  the agency's own label (agency eyes only, never a client's). */
export async function listBillingAlerts(db: SupabaseClient): Promise<BillingAlert[]> {
  const alerts: BillingAlert[] = [];
  for (let from = 0; ; ) {
    const { data, error } = await db.from("account_billing")
      .select("account_id, subscription_status, past_due_since, billing_paused_at, accounts(name)")
      .eq("complimentary", false)
      .or("billing_paused_at.not.is.null,subscription_status.in.(past_due,unpaid)")
      .order("account_id", { ascending: true }).range(from, from + PAUSE_PAGE - 1);
    if (error) throw new Error(`listBillingAlerts failed: ${error.message}`);
    const rows = (data ?? []) as unknown as {
      account_id: string; subscription_status: SubscriptionStatus | null; past_due_since: string | null;
      billing_paused_at: string | null; accounts: { name: string } | null;
    }[];
    if (rows.length === 0) break;
    for (const r of rows) {
      const accountName = r.accounts?.name ?? r.account_id;
      if (r.billing_paused_at) alerts.push({ accountId: r.account_id, accountName, kind: "paused", since: r.billing_paused_at });
      else if (r.past_due_since) alerts.push({ accountId: r.account_id, accountName, kind: "payment_failed", since: r.past_due_since });
    }
    from += rows.length;
  }
  const { data, error } = await db.from("billing_reconciliations")
    .select("account_id, checked_at, verdict, accounts(name)")
    .in("verdict", ["stripe_over", "stripe_under", "ambiguous"]);
  if (error) throw new Error(`listBillingAlerts reconciliation read failed: ${error.message}`);
  const seen = new Set<string>();
  for (const r of (data ?? []) as unknown as { account_id: string; checked_at: string; accounts: { name: string } | null }[]) {
    if (seen.has(r.account_id)) continue;
    seen.add(r.account_id);
    alerts.push({ accountId: r.account_id, accountName: r.accounts?.name ?? r.account_id, kind: "usage_mismatch", since: r.checked_at });
  }
  return alerts;
}

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

- [ ] **Step 4: Create `packages/db/src/billing-reconciliations.ts`:**

```ts
import type { SupabaseClient } from "@supabase/supabase-js";
import type { MeterKey } from "./billing";

/** The latest nightly comparison per account and meter (0099). Service-role
 *  writes only; the agency reads (work queue, Billing card). */
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

export async function saveReconciliation(db: SupabaseClient, w: ReconciliationWrite): Promise<void> {
  const { error } = await db.from("billing_reconciliations").upsert({
    account_id: w.accountId, meter: w.meter, window_start: w.windowStart, window_end: w.windowEnd,
    bis_settled: w.bisSettled, bis_in_flight: w.bisInFlight, bis_held: w.bisHeld, stripe_total: w.stripeTotal,
    verdict: w.verdict, checked_at: w.checkedAt,
  }, { onConflict: "account_id,meter" });
  if (error) throw new Error(`saveReconciliation failed: ${error.message}`);
}

type Row = {
  account_id: string; meter: MeterKey; window_start: string; window_end: string; bis_settled: number;
  bis_in_flight: number; bis_held: number; stripe_total: number | string; verdict: ReconciliationVerdict; checked_at: string;
};

export async function listReconciliations(db: SupabaseClient, accountId: string): Promise<Reconciliation[]> {
  const { data, error } = await db.from("billing_reconciliations")
    .select("account_id, meter, window_start, window_end, bis_settled, bis_in_flight, bis_held, stripe_total, verdict, checked_at")
    .eq("account_id", accountId).order("meter", { ascending: true });
  if (error) throw new Error(`listReconciliations failed: ${error.message}`);
  return ((data ?? []) as Row[]).map((r) => ({
    accountId: r.account_id, meter: r.meter, windowStart: r.window_start, windowEnd: r.window_end,
    bisSettled: Number(r.bis_settled), bisInFlight: Number(r.bis_in_flight), bisHeld: Number(r.bis_held),
    stripeTotal: Number(r.stripe_total), verdict: r.verdict, checkedAt: r.checked_at,
  }));
}

/** "<accountId>:<meter>" for every pair checked at or after `sinceIso`
 *  (tonight's run start): the nightly step skips those. Paged until empty. */
export async function reconciledSince(db: SupabaseClient, sinceIso: string): Promise<Set<string>> {
  const out = new Set<string>();
  for (let from = 0; ; ) {
    const { data, error } = await db.from("billing_reconciliations").select("account_id, meter")
      .gte("checked_at", sinceIso).order("account_id", { ascending: true }).order("meter", { ascending: true })
      .range(from, from + 999);
    if (error) throw new Error(`reconciledSince failed: ${error.message}`);
    const rows = (data ?? []) as { account_id: string; meter: string }[];
    if (rows.length === 0) return out;
    for (const r of rows) out.add(`${r.account_id}:${r.meter}`);
    from += rows.length;
  }
}
```

- [ ] **Step 5: The usage hold and bands in `packages/db/src/usage.ts`.**

```ts
/** PR-3 B10 / plan G15: Stripe dedupes a meter event's identifier for "at
 *  least 24 hours" (assumption S7). A row still unreported this long after
 *  it was RECORDED is never resent by the report: only the nightly
 *  reconciliation, which first asks Stripe whether it already holds it,
 *  sends or stamps it. Four hours of margin under Stripe's 24. */
export const USAGE_HOLD_AFTER_MS = 20 * 60 * 60 * 1000;
```

In `listReportableUsage` (`:279-297`), add to the query, after `.is("reported_at", null)`:

```ts
      // Held (G15): recorded USAGE_HOLD_AFTER_MS ago or more → reconciliation's, not ours.
      .gt("created_at", new Date(now.getTime() - USAGE_HOLD_AFTER_MS).toISOString())
```

and update its doc comment to say so. Then:

```ts
export type UsageBands = { settled: number; inFlight: number; held: number; heldRows: UsageRow[] };

/**
 * BIS's side of one (account, meter) reconciliation (G14), over rows whose
 * occurred_at is in [startIso, endIso): settled = reported at least
 * `settleMs` ago (Stripe has aggregated it, assumption S1); in flight =
 * reported more recently, or unreported and recorded under
 * USAGE_HOLD_AFTER_MS ago (on its way); held = unreported and recorded
 * USAGE_HOLD_AFTER_MS ago or more (G15), returned whole so reconciliation
 * can stamp or send them. Paged by id until an empty page.
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

(Use the module's existing row type and mapper names — `USAGE_COLUMNS` `:86`, the mapper at `:88-92`; rename `UsageDbRow`/`toUsageRow` in the snippet to whatever they are called there.)

- [ ] **Step 6: Export from `packages/db/src/index.ts`** (extend the two blocks at `:222-237`; add `export * from "./billing-reconciliations";`). Add `USAGE_HOLD_AFTER_MS`, `readUsageBands`, `type UsageBands` to the usage block; `PAID_STATUSES`, `nextVersion`, `readBillingStanding`, `listPauseCandidates`, `pauseBilling`, `clearBillingPause`, `undoLiftBillingPause`, `healPermissions`, `listBillingAlerts`, `listReconcilableAccounts`, `type BillingStanding`, `type BillingAlert` to the account-billing block.

- [ ] **Step 7: Live tests** `packages/db/src/test/billing-pause.test.ts` (CI only), each with its mutation:
  1. "readBillingStanding reads the plan's features through the embed for a PAID and a complimentary row, and null with no row (mutation: select plan_id only → FAILS)".
  2. "pauseBilling then clearBillingPause(lift) round-trips through PostgREST and each moves updated_at forward (mutation: write `now` instead of nextVersion → FAILS when the stored updated_at is in the future)".
  3. "a mirror write between the pass's read and its write makes pauseBilling a conflict (mutation: drop the updated_at filter → FAILS)".
  4. "listPauseCandidates returns paused, past_due, unpaid and canceled rows and never a complimentary or subscription-less one (mutation: drop `.eq('complimentary', false)` → FAILS)".
  5. "listReportableUsage holds a row recorded 21 hours ago and returns one recorded 19 hours ago (mutation: hold at 24 h → FAILS)".
  6. "listBillingAlerts names the account by accounts.name (mutation: embed brand_name → FAILS)".

- [ ] **Step 8: Run** — `pnpm --filter @bis/db exec vitest run src/account-billing.test.ts src/billing-reconciliations.test.ts src/usage.test.ts` (PASS), `pnpm --filter @bis/db exec tsc --noEmit`, and the web fixtures' typecheck `pnpm --filter web exec tsc --noEmit`. Affected web tests (references to `AccountBilling` literals and `@bis/db` mocks): `lib/billing/billing-view.test.ts`, `billing-link.test.ts`, `billing/page.test.ts`, `layout.test.ts`, `settings/billing-actions.test.ts`, `settings/billing-section.test.ts`, `api/cron/reminders/route.test.ts` (its `@bis/db` factory is untouched by this task: no pass dereferences the new exports yet).

- [ ] **Step 9: Commit** — `git commit -m "M7a PR-4: billing standing read, compare-and-set pause writers, the mirror clears the pause, alerts, the reconciliation store and the usage hold"` (with the files above).

### Task 3: Copy, English and Spanish (LOW, bis-frontend)

**Files:**
- Modify: `apps/web/src/lib/messages.ts` (only writer of this file in the PR), `apps/web/src/lib/i18n/catalogue-baseline.json` (regenerated, never hand-edited), `apps/web/src/lib/consent/copy.test.ts:41-54` (42 → 43 and its prose).
- Test: `apps/web/src/lib/messages.test.ts` (new `describe("M7a PR-4 copy")`).

**Interfaces:**
- Produces the keys below; every consumer task uses them by name.

- [ ] **Step 1: Add the keys** (English, then the `.es` twin directly below it, in the house layout). Next to the existing `billing.banner.*` (`messages.ts:3974-3977`):

| Key | English | Spanish (`.es`) |
|---|---|---|
| `billing.banner.client` | (unchanged) | Su pago no se completó. Actualice su tarjeta para que las automatizaciones sigan funcionando. |
| `billing.banner.clientAction` | (unchanged) | Ir a Facturación |
| `billing.banner.agency` | (unchanged) | El último pago de este cliente no se completó. |
| `billing.banner.agencyAction` | (unchanged) | Ver facturación |
| `billing.paused.client.payment` | Your account is paused because a payment didn't go through. Calls go straight to your phone, texts and automations are stopped, and nothing here can be changed until it's paid. | Su cuenta está en pausa porque un pago no se completó. Las llamadas van directo a su teléfono, los mensajes y las automatizaciones están detenidos, y aquí no se puede cambiar nada hasta que se pague. |
| `billing.paused.client.ended` | Your plan has ended, so your account is paused. Calls go straight to your phone, texts and automations are stopped, and nothing here can be changed. | Su plan terminó, así que su cuenta está en pausa. Las llamadas van directo a su teléfono, los mensajes y las automatizaciones están detenidos, y aquí no se puede cambiar nada. |
| `billing.paused.client.action` | Go to Billing | Ir a Facturación |
| `billing.paused.client.staff` | The account owner can turn everything back on from the Billing page. | El dueño de la cuenta puede volver a activar todo desde la página de Facturación. |
| `billing.paused.agency` | This client is paused: calls are forwarded, texts and automations are stopped, and their dashboard is read-only. | Este cliente está en pausa: las llamadas se desvían, los mensajes y las automatizaciones están detenidos, y su panel es de solo lectura. |
| `billing.paused.agencyAction` | See billing | Ver facturación |
| `billing.page.paused.payment` | Your account is paused until the payment goes through. Update your card below to turn everything back on. | Su cuenta está en pausa hasta que se complete el pago. Actualice su tarjeta abajo para volver a activar todo. |
| `billing.page.paused.ended` | Your plan has ended, so your account is paused. To start again, contact us. | Su plan terminó, así que su cuenta está en pausa. Para volver a empezar, comuníquese con nosotros. |
| `billing.card.pausedPayment` | Paused since {date}: the payment failed on {failed}. | En pausa desde el {date}: el pago falló el {failed}. |
| `billing.card.pausedEnded` | Paused since {date}: the plan ended. | En pausa desde el {date}: el plan terminó. |
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
| `automations.reason.billingPaused` | Not sent: the account is paused until a payment goes through | No se envió: la cuenta está en pausa hasta que se reciba un pago |
| `compose.smsBlockedPaused` | Texts are stopped while this account is paused for billing. | Los mensajes están detenidos mientras esta cuenta está en pausa por facturación. |
| `screened.reason.billing-paused` | Account paused (billing) | (agency-only prefix `screened.`: no twin) |
| `screened.reason.plan-no-voice` | Plan has no receptionist | (agency-only prefix: no twin) |

Agency-only (`work.agency.` prefix, `ratchet-scan.ts:82-84`, English only):

| Key | English |
|---|---|
| `work.agency.billing.paymentFailed` | Payment failed: |
| `work.agency.billing.paused` | Paused: |
| `work.agency.billing.mismatch` | Usage doesn't match Stripe: |
| `work.agency.billing.more` | and {n} more |

- [ ] **Step 2: Tests** in `messages.test.ts`: "every PR-4 key is the plan's wording, in both languages (mutation: change any one string → FAILS)" (exact-string table of all of the above); "a placeholder in English is a placeholder in Spanish (mutation: drop {failed} from billing.card.pausedPayment.es → FAILS)"; "the Spanish is usted, never tú (mutation: 'Actualiza su tarjeta' → FAILS)" — no `.es` value matches `/\b(actualiza|usa|ve|tu|tus)\b/i`. `copy.test.ts:54`: 42 → 43, prose names `billingPaused` (PR-4).

- [ ] **Step 3: Regenerate the baseline** — `pnpm --filter web exec tsx scripts/generate-i18n-baseline.ts`. Expected diff: the four `billing.banner.*` entries leave `catalogue-baseline.json`; nothing is added.

- [ ] **Step 4: Run** — `pnpm --filter web exec vitest run src/lib/messages.test.ts src/lib/consent/copy.test.ts src/lib/i18n` and `pnpm --filter web lint`. Expected: PASS.

- [ ] **Step 5: Commit** — `git commit -m "M7a PR-4: the pause's copy in English and Spanish"`.

### Task 4: The switch, the pure policy, and the `billingPause` pass (HIGH, bis-automations)

**Files:**
- Create: `apps/web/src/lib/billing/enforce.ts`, `apps/web/src/lib/billing/standing.ts`, `apps/web/src/lib/billing/standing.test.ts`, `apps/web/src/lib/automations/passes/billing-pause.ts`, `apps/web/src/lib/automations/passes/billing-pause.test.ts`.
- Modify: `apps/web/src/lib/automations/registry.ts` (doc + `PASSES` `:63`), `apps/web/src/lib/automations/sentinel.test.ts:296` (order), `apps/web/src/app/api/cron/reminders/route.test.ts` (its bare `@bis/db` factory gains `listPauseCandidates: vi.fn(async () => [])`, `pauseBilling`, `clearBillingPause`), `apps/web/src/app/api/cron/reminders/route.ts:10-15` and `passes/release-held.ts` comments ("the FIRST pass" → "the release pass"), `cron-coupling.test.ts` prose if it says "first".

**Interfaces:**
- Produces:
  - `billingEnforced(env?: NodeJS.ProcessEnv): boolean` (`enforce.ts`).
  - `PAUSE_GRACE_MS` (7 d), `STRIPE_FRESH_MS` (26 h), `type PauseDecision = "pause" | "unpause" | "keep" | "unconfirmed"`, `decidePause(row: AccountBilling, now: Date): PauseDecision`.
  - `type BillingVerdict = { paused: boolean; voice: boolean; concierge: boolean }`, `ALL_ON: BillingVerdict`, `billingVerdict(standing: BillingStanding | null, enforced: boolean): BillingVerdict`, `voiceBlock(v: BillingVerdict): "billing-paused" | "plan-no-voice" | null`, `pauseCause(row: Pick<AccountBilling, "subscriptionStatus">): "payment" | "ended"`.
  - `billingPausePass: Pass` (key `"billingPause"`).

- [ ] **Step 1: Failing tests** `standing.test.ts` (fixtures via a `row()` builder over `AccountBilling`, `NOW = 2026-10-26T12:00Z`):
  1. "billingEnforced is on for exactly '1' (mutation: accept 'true' → FAILS)" — `"1"` true; `undefined`, `""`, `"0"`, `"true"`, `" 1"` false.
  2. "past_due for 7 days, confirmed by Stripe 1 h ago, never lifted → pause (mutation: `>` instead of `>=` on the grace → FAILS at exactly 7 days)".
  3. "6 days 23 hours → keep (mutation: grace of 6 days → FAILS)".
  4. "unconfirmed when stripe_checked_at is 27 h old or null (mutation: skip the freshness check → FAILS)".
  5. "lifted after past_due_since → keep; lifted BEFORE it (an earlier stretch) → pause (mutation: compare with billing_paused_at → FAILS)".
  6. "canceled with period end passed → pause; period end tomorrow → keep; null end → pause (mutation: `<` instead of `<=` → FAILS at the exact end)".
  7. "canceled and lifted after its end → keep (mutation: ignore lifts on ended plans → FAILS)".
  8. "paused and now active or trialing → unpause; paused and past_due → keep (mutation: unpause on any non-null status → FAILS)".
  9. "incomplete, incomplete_expired, Stripe's paused, active → keep; complimentary or no subscription → keep (mutation: treat incomplete_expired as ended → FAILS)".
  10. "billingVerdict: switch off → ALL_ON whatever the row (mutation: drop the enforced check → FAILS)"; "no row → ALL_ON (unbilled)"; "paused → nothing on"; "plan without voice → voice off, concierge per plan"; "complimentary follows its plan".
  11. "voiceBlock prefers billing-paused over plan-no-voice (mutation: swap the order → FAILS)".

  `billing-pause.test.ts` (a stub `ctx.db` via `vi.mock("@bis/db", …)` with `listPauseCandidates`, `pauseBilling`, `clearBillingPause` as `vi.fn`):
  12. "switch off: counts wouldPause and wouldUnpause, writes NOTHING (mutation: write regardless of the switch → FAILS)".
  13. "switch on: pauses each 'pause' row with its own stored updated_at (mutation: pass ctx.now as the expected version → FAILS)".
  14. "a conflict is counted `raced`, never retried in the tick (mutation: loop on conflict → FAILS)".
  15. "unconfirmed rows are counted and logged, not paused (mutation: pause unconfirmed → FAILS)".
  16. "one row's write throwing is counted `failed` and the next row still runs (mutation: let it propagate → FAILS)".
  And `sentinel.test.ts:296`: `["billingPause", "releaseHeld", …existing 17…]` ("mutation: register billingPause after releaseHeld → FAILS").

- [ ] **Step 2: Run** — `pnpm --filter web exec vitest run src/lib/billing/standing.test.ts src/lib/automations/passes/billing-pause.test.ts src/lib/automations/sentinel.test.ts`. Expected: FAIL.

- [ ] **Step 3: `apps/web/src/lib/billing/enforce.ts`:**

```ts
/**
 * THE SWITCH (spec section 4: "the non-payment pause, behind its own switch";
 * plan owner question 8). `BILLING_ENFORCE=1` turns on, together: the pause
 * pass's writes, and every reader of the billing verdict (the SMS and email
 * gates, the TeXML route, the concierge, read-only client actions, the paused
 * banner). Exactly "1" is on. Off is the whole rollback: every reader ignores
 * a stored pause at once, no SQL needed. Like every env change, it needs a
 * redeploy to take effect.
 */
export function billingEnforced(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.BILLING_ENFORCE === "1";
}
```

- [ ] **Step 4: `apps/web/src/lib/billing/standing.ts`:**

```ts
import {
  PAID_STATUSES, PAST_DUE_STATUSES, type AccountBilling, type BillingStanding,
} from "@bis/db";

/**
 * What a billed account may do, decided from STORED rows only (no Stripe
 * call). Pure. Plan G1 (when to pause), G5 (the verdict), G9 (why a call is
 * not Sofía's).
 */

/** Spec section 3 flow 5: "≥ 7 days old". */
export const PAUSE_GRACE_MS = 7 * 24 * 60 * 60 * 1000;
/** G6: a past-due pause needs Stripe's word on the status from within this.
 *  The nightly step re-reads every unpaid subscription once a day; two hours
 *  of slack over 24 cover a late night run. */
export const STRIPE_FRESH_MS = 26 * 60 * 60 * 1000;

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
    if (checked === null || t - checked > STRIPE_FRESH_MS) return "unconfirmed";
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

/** Why a paused account is paused, for the banner, the card and the page. */
export function pauseCause(row: Pick<AccountBilling, "subscriptionStatus">): "payment" | "ended" {
  return row.subscriptionStatus === "canceled" ? "ended" : "payment";
}

export type BillingVerdict = { paused: boolean; voice: boolean; concierge: boolean };
export const ALL_ON: BillingVerdict = Object.freeze({ paused: false, voice: true, concierge: true });

/** G5. Unbilled (null) and switch-off are ALL_ON. Complimentary rows follow
 *  their plan and are never paused (0051's CHECK). */
export function billingVerdict(standing: BillingStanding | null, enforced: boolean): BillingVerdict {
  if (!enforced || standing === null) return ALL_ON;
  const paused = standing.pausedAt !== null;
  return {
    paused,
    voice: !paused && standing.features.voice_receptionist === true,
    concierge: !paused && standing.features.web_concierge === true,
  };
}

/** The recorded reason a call is not Sofía's (0099's two values). */
export function voiceBlock(v: BillingVerdict): "billing-paused" | "plan-no-voice" | null {
  if (v.paused) return "billing-paused";
  return v.voice ? null : "plan-no-voice";
}
```

- [ ] **Step 5: `apps/web/src/lib/automations/passes/billing-pause.ts`:**

```ts
import { billingEnforced } from "@/lib/billing/enforce";
import { decidePause } from "@/lib/billing/standing";
import type { Pass } from "../context";

/**
 * The non-payment pause (spec section 3 flows 5-6; plan G1, G16). FIRST in
 * the registry: a pause stamped this tick stops this tick's held releases and
 * every recipe after it (they all send through the gates, which read it).
 * No Stripe call, no wall-clock budget: one paged read of the candidate rows
 * and a compare-and-set write per change.
 *
 * Switch OFF (BILLING_ENFORCE): counts what it WOULD do and writes nothing,
 * so the owner can read the cron log before turning it on.
 *
 * Every @bis/db export is dereferenced inside run(), never at module scope
 * (the cron route test's bare mock throws on a dereference).
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
        console.error(`billing pause: account ${row.accountId} is past the grace but Stripe has not confirmed it within a day; not paused this tick`);
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

(If the repo's pass convention is a static `import { … } from "@bis/db"` with dereference inside `run()` — `usage-report.ts:1-3` does that — follow it instead of the dynamic import; the point is no module-scope dereference.)

- [ ] **Step 6: Register it first** — `registry.ts`: `import { billingPausePass } from "./passes/billing-pause";`, `PASSES = [billingPausePass, releaseHeldPass, …]`, and a doc paragraph: "The billing pause runs FIRST: a pause it stamps this tick is read by every send gate below in the same tick. It touches no automation state, so the release-first contract below is unchanged between the release pass and the recipes." Update `route.ts:10-15` and `release-held.ts`'s "FIRST pass" wording to "the release pass", and `cron-coupling.test.ts:300`'s title text if it says "the FIRST pass" (the assertion is unchanged).

- [ ] **Step 7: Run** — the three tests of Step 2 plus `src/app/api/cron/reminders/route.test.ts`, `src/lib/automations/harness.test.ts`, `src/lib/automations/cron-coupling.test.ts`. Expected: PASS.

- [ ] **Step 8: Commit** — `git commit -m "M7a PR-4: the switch, the pause policy, and the billingPause pass (first in the tick)"`.

### Task 5: The two send gates (HIGH, bis-comms)

**Files:**
- Modify: `apps/web/src/lib/consent/classes.ts` (two functions), `apps/web/src/lib/consent/gate.ts:89-97` (reason) and `:186-200` (step 3b) and its doc (`:17-57`), `apps/web/src/lib/consent/email-gate.ts:86-92` and `:252-260`, `apps/web/src/lib/automations/hold-or-send.ts:106-143, 255-276`, `apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/conversations/actions.ts:238-252`.
- Test: `lib/consent/gate.test.ts`, `email-gate.test.ts`, `classes.test.ts`, `lib/automations/hold-or-send.test.ts`, `conversations/actions.test.ts`; run `lib/consent/scans.test.ts`.

**Interfaces:**
- Consumes: `billingEnforced` (Task 4), `readBillingStanding` (Task 2), keys `automations.reason.billingPaused`, `compose.smsBlockedPaused` (Task 3).
- Produces: `SmsBlockReason` and `EmailBlockReason` gain `"billing_paused"`; `smsStopsWhilePaused(kind: SmsKind): boolean`; `emailStopsWhilePaused(kind: EmailKind): boolean`.

- [ ] **Step 1: Failing tests.**
  - `classes.test.ts`: "smsStopsWhilePaused: every kind, by name (mutation: let staff.composer_sms through → FAILS)" — a literal table of all 18 SMS kinds (`classes.ts:31-48`): `true` for every `automation.*`, `voice.textback`, `staff.*`; `false` for `operator.alert_sms`, `operator.alert_phone_code`, `consent.stop_confirmation`, `consent.start_confirmation`, `consent.help`. "emailStopsWhilePaused: exactly the automation.* kinds (mutation: stop booking.confirmation → FAILS)" — literal table of every email kind.
  - `gate.test.ts` (its `@bis/db` mock gains `readBillingStanding: vi.fn()`; set `process.env.BILLING_ENFORCE` per test and restore it): "switch on and paused: an automation text is blocked billing_paused BEFORE the A2P read (mutation: put the check after resolveSmsSender → FAILS: the sender mock is called)"; "switch on and paused: operator.alert_sms and consent.help still clear (mutation: block every kind → FAILS)"; "switch on, not paused, or unbilled (null) → clears (mutation: block on a null standing → FAILS)"; "switch OFF and paused → clears, and readBillingStanding is never called (mutation: read regardless of the switch → FAILS)"; "an unreadable billing row blocks ledger_unavailable (mutation: fail open → FAILS)".
  - `email-gate.test.ts`: the same five, with `automation.reminder` blocked and `booking.confirmation`, `operator.lead_alert` passing.
  - `hold-or-send.test.ts`: "a billing_paused refusal is logged skipped with the Activity page's words (mutation: map it to accountSuppressed → FAILS)".
  - `conversations/actions.test.ts`: "a paused account's composer text says why (mutation: fall through to composerBlockedLine → FAILS)".

- [ ] **Step 2: Run** — `pnpm --filter web exec vitest run src/lib/consent src/lib/automations/hold-or-send.test.ts "src/app/(dashboard)/dashboard/accounts/[accountId]/conversations/actions.test.ts"`. Expected: FAIL.

- [ ] **Step 3: `classes.ts`** (beside the registries):

```ts
/**
 * The non-payment pause (M7a PR-4, plan G7; owner question 1): every text to
 * the business's CUSTOMERS stops; the owner's own alerts (operator) and the
 * STOP/START/HELP answers (consent_reply) still go. Read only by the send
 * gate, after the switch.
 */
export function smsStopsWhilePaused(kind: SmsKind): boolean {
  const c = SMS_KINDS[kind].class;
  return c !== "operator" && c !== "consent_reply";
}

/** G8: "automations stop". Only the automation kinds; receipts, operator
 *  mail and staff-typed mail pass (the read-only guard already limits the
 *  last to the agency). */
export function emailStopsWhilePaused(kind: EmailKind): boolean {
  return kind.startsWith("automation.");
}
```

(Use the module's existing email-kind type name for `EmailKind`.)

- [ ] **Step 4: `gate.ts`.** Reason union: add `/** M7a PR-4: the account is paused for non-payment (BILLING_ENFORCE on). */ | "billing_paused"`. Step 3b, right after the suppression block (`:192-197`), before `resolveSmsSender`:

```ts
  // 3b. The non-payment pause (M7a PR-4, plan G7). Only with the switch on,
  // so with it off nothing here is read. FAILS CLOSED like step 3.
  if (billingEnforced() && smsStopsWhilePaused(req.kind)) {
    try {
      if ((await readBillingStanding(db, req.accountId))?.pausedAt) return { kind: "blocked", reason: "billing_paused" };
    } catch (e) {
      console.error(`consent gate: ${req.kind} for account ${req.accountId} blocked, billing state unreadable: ${loggableError(e)}`);
      return { kind: "blocked", reason: "ledger_unavailable" };
    }
  }
```

Add item "3b" to the doc list (`:28-33`). `deliver`'s recheck path stays as it is (a pause landing between decide and deliver is one send).

- [ ] **Step 5: `email-gate.ts`** — reason union gains `"billing_paused"`; inside the `if (req.accountId)` block (`:252-260`), after the suppression check:

```ts
    if (billingEnforced() && emailStopsWhilePaused(req.kind)) {
      try {
        if ((await readBillingStanding(deps.db ?? serviceDb(), req.accountId))?.pausedAt) {
          return { kind: "blocked", reason: "billing_paused" };
        }
      } catch (e) {
        console.error(`email gate: ${req.kind} for account ${req.accountId} blocked, billing state unreadable: ${loggableError(e)}`);
        return { kind: "blocked", reason: "ledger_unavailable" };
      }
    }
```

- [ ] **Step 6: `hold-or-send.ts`** — `REASONS.billingPaused: m["automations.reason.billingPaused"]`; `BLOCK_REASONS.billing_paused` and `EMAIL_BLOCK_REASONS.billing_paused` map to it (the `Record` types force both).

- [ ] **Step 7: `conversations/actions.ts`** — in the switch (`:239-251`): `case "billing_paused": rejectSend(t(m, "compose.smsBlockedPaused", locale));`.

- [ ] **Step 8: Run** Step 2's suites again, plus `src/lib/consent/scans.test.ts` (the gate is still the only provider importer), `src/lib/automations/send-sms.test.ts`, `src/lib/voice/textback.test.ts`, `src/lib/sms/alerts.test.ts`, `src/lib/automations/instant-reply.test.ts` (their `@bis/db` factories need nothing: the new read happens only with the switch on). Expected: PASS.

- [ ] **Step 9: Commit** — `git commit -m "M7a PR-4: the send gates stop customer texts and automation emails while an account is paused"`.

### Task 6: The TeXML answer route and the concierge (HIGH, bis-voice)

**Files:**
- Modify: `apps/web/src/app/api/voice/texml/route.ts` (`COPY` `:99-110`, `Routability` `:81-94`, `classify` `:202-363`, `accountForwardTarget` `:521-550`, `route` `:616-748`), `apps/web/src/app/api/concierge/[publicId]/turn/route.ts:221-224`, `apps/web/src/app/c/[publicId]/page.tsx:43,88`.
- Test: `api/voice/texml/route.test.ts`, `api/voice/texml/forward.test.ts`, `api/voice/texml/wellformed.test.ts`, `api/concierge/[publicId]/turn/route.test.ts`, `app/c/[publicId]/page.test.ts`.

**Interfaces:**
- Consumes: `billingEnforced`, `billingVerdict`, `voiceBlock` (Task 4); `readBillingStanding` (Task 2); `billingVerdictFor` (Task 7's `standing-read.ts`; if Task 7 has not landed, this task creates `standing-read.ts` exactly as Task 7 Step 3 specifies and Task 7 then only adds its test entry).
- Produces: nothing new for later tasks.

- [ ] **Step 1: Failing tests.** `texml/route.test.ts` (its `@bis/db` lazy-import mock gains `readBillingStanding`; switch set per test):
  1. "switch on, paused, cleared call with a usable transfer number: the forward document, recorded billing-paused (mutation: record account-forward → FAILS)".
  2. "switch on, plan without the receptionist: the same forward, recorded plan-no-voice (mutation: drop the plan half of voiceBlock → FAILS)".
  3. "switch on, paused, NO transfer number: the unavailable sentence in the profile's languages, a screened_calls row billing-paused, never the bridge (mutation: fall through to the bridge → FAILS)".
  4. "switch on, paused, call NOT cleared (a cap read failed): the message, never the forward (mutation: forward uncleared calls → FAILS)".
  5. "the guards still answer first: an over-cap caller on a paused account hears the cap sentence (mutation: run the billing check before classify's guards → FAILS)".
  6. "the press-1 screen still comes first for a first-time caller (mutation: billing before the screen → FAILS)".
  7. "a billing read that throws changes nothing: the bridge, as today (mutation: refuse on a read error → FAILS)".
  8. "switch OFF and paused: the bridge, and readBillingStanding is never called (mutation: read regardless → FAILS)".
  9. "VOICE_FORWARD_TO still wins over everything (mutation: billing before the deployment-wide forward → FAILS)".
  10. `wellformed.test.ts`: the unavailable document is well-formed XML in `en`, `es`, `both`.
  `turn/route.test.ts`: "switch on, paused → 404 not_found before any counter is spent (mutation: check after createConciergeConversation → FAILS)"; "plan without the website chat → 404"; "a billing read error → the chat answers (fail open)".
  `c/[publicId]/page.test.ts`: "switch on, paused → notFound (mutation: drop the billing check → FAILS)"; "generateMetadata returns robots only for it (no branded title)".

- [ ] **Step 2: Run** — `pnpm --filter web exec vitest run src/app/api/voice/texml "src/app/api/concierge" "src/app/c"`. Expected: FAIL.

- [ ] **Step 3: TeXML route.**

`COPY` gains (byte-exact; a test pins both):

```ts
  // M7a PR-4 (plan G9; owner question 2): a paused account, or a plan with no
  // receptionist, and no usable transfer number. Not the refusal sentence: the
  // business is open, nobody can pick up right now.
  unavailable: {
    en: "Thanks for calling. No one can take your call right now. Please call back later.",
    es: "Gracias por llamar. En este momento nadie puede atender su llamada. Por favor llame más tarde.",
  },
```

`Routability`'s `dial` variant gains `noVoice?: "billing-paused" | "plan-no-voice"` (documented: "set only when BILLING_ENFORCE is on and the account's verdict has no Sofía; absent when the billing read failed (fail open)"), and the uncleared count-failure return (`:353`) gains `languages: profile.languages` and `phoneNumberId: row.id` so the message path has both.

In `classify`, right after the profile gate (after `:262`'s narrowing, before the cap block), still inside the outer `try`:

```ts
    // M7a PR-4 (plan G9): what the account's billing allows. Read only with
    // the switch on; a read error is today's path (fail open, logged).
    let noVoice: "billing-paused" | "plan-no-voice" | undefined;
    if (billingEnforced()) {
      try {
        const block = voiceBlock(billingVerdict(await readBillingStanding(db, row.account_id), true));
        if (block) noVoice = block;
      } catch (e) {
        console.error(`texml billing read failed — Sofía answers, accountId ${row.account_id}: ${String(e)}`);
      }
    }
```

and every `kind: "dial"` return below it carries `...(noVoice ? { noVoice } : {})`.

Extract the screened-call `after()` block in `route()` (`:646-670`) into `function recordScreenedCallLater(screened: ScreenedCallInput): void` (same body, same two catches) and call it from the refusal path unchanged. Extract the resolver core of `accountForwardTarget` (`:521-550`) into `async function resolveTransferTarget(accountId: string): Promise<{ to: string } | { to: null; why: string }>` returning the reason instead of logging, and keep `accountForwardTarget` as the wrapper that logs today's three lines byte-identically (route.test asserts them).

In `route()`, after the screen block (`:704`) and BEFORE the per-account forward (`:705`):

```ts
    // M7a PR-4 (plan G9): a paused account, or a plan with no receptionist.
    // After every guard and the screen (a robot never rings a person's phone,
    // and a refusal costs nothing); before the per-account forward and the
    // bridge. A CLEARED call goes to the transfer number; anything else, or
    // no usable number, hears the short message. Both are recorded, the
    // forward where the caps count it.
    if (result.accountId && result.noVoice) {
      const why = result.noVoice;
      const target = result.cleared ? await resolveTransferTarget(result.accountId) : { to: null, why: "not cleared" };
      if (target.to) {
        console.log(`texml FORWARDING account ${result.accountId} to its transfer number — ${why}`);
        recordForwardedCallLater({
          accountId: result.accountId, phoneNumberId: result.phoneNumberId ?? null,
          calledE164, callerE164, kind: why,
        });
        return done(xmlResponse(forwardXml(target.to, calledE164)));
      }
      console.log(`texml unavailable message for account ${result.accountId} — ${why}, no forward (${target.why})`);
      recordScreenedCallLater({
        accountId: result.accountId, phoneNumberId: result.phoneNumberId ?? null,
        calledE164, callerE164, reason: why,
      });
      return done(xmlResponse(sayXml(result.languages ?? "en", COPY.unavailable)));
    }
```

- [ ] **Step 4: Concierge turn route** — after `if (!profile) return … 404` (`:224`):

```ts
    // M7a PR-4 (plan G10): a paused account, or a plan without the website
    // chat, answers exactly as a switched-off chat does. Before anything is
    // spent. A read error lets the chat answer (fail open, logged).
    if (billingEnforced()) {
      try {
        if (!billingVerdict(await readBillingStanding(db, profile.account_id), true).concierge) {
          return NextResponse.json({ error: "not_found" }, { status: 404 });
        }
      } catch (e) {
        log("billing read failed, chat answers", { accountId: profile.account_id, error: String(e) });
      }
    }
```

(`readBillingStanding` joins the lazy `@bis/db` destructure at `:194-201`.)

- [ ] **Step 5: `/c/[publicId]/page.tsx`** — `if (!profile || !isConciergeLive(profile) || !(await billingVerdictFor(profile.account_id)).concierge) notFound();` at `:88`, and the same condition in `generateMetadata` (`:43`) returning `{ robots }`. `billingVerdictFor` already fails open and returns `ALL_ON` with the switch off.

- [ ] **Step 6: Run** Step 2's suites, plus `src/app/api/voice/incoming/route.test.ts` (untouched; proves the webhook is unchanged), `src/app/api/voice/texml/screen/route.test.ts` (`answer(skipScreen)` path), and `src/lib/voice` tests importing `forwarded-calls`/`screened-calls`. Expected: PASS. `pnpm --filter web lint`.

- [ ] **Step 7: Commit** — `git commit -m "M7a PR-4: a paused or receptionist-less account's calls go to its own phone (or a short message), and its website chat closes"`.

### Task 7: Read-only client actions (HIGH, bis-platform)

**Files:**
- Create: `apps/web/src/lib/billing/standing-read.ts` (+ `.test.ts`), `apps/web/src/lib/billing/read-only.ts` (+ `.test.ts`).
- Modify: `apps/web/src/lib/auth.ts:36-61, 71-79, 142-149` (the option), the opted-out actions (the audit's list: at least `accounts/[accountId]/billing/actions.ts:36`, `accounts/[accountId]/shell-actions.ts:150`), `apps/web/src/app/api/accounts/[accountId]/contacts/[contactId]/ai-summary/route.ts` (POST), `app/(dashboard)/dashboard/accounts/[accountId]/in-account-service-reads.test.ts` (one entry).
- Test: `lib/auth.test.ts` (gains `vi.mock("next/headers")` and the switch), `technician-guards.test.ts`, `ai-summary/route.test.ts`.

**Interfaces:**
- Consumes: `billingEnforced`, `billingVerdict`, `ALL_ON` (Task 4); `readBillingStanding` (Task 2).
- Produces: `type AccountBillingVerdict = BillingVerdict & { cause: "payment" | "ended" | null }`; `billingVerdictFor(accountId: string): Promise<AccountBillingVerdict>` (React-`cache`d, service role, fails open; `cause` is `pauseCause(standing)` when paused, else null); `refuseActionWhilePaused(accountId: string, fallback: string): Promise<void>`; `sameAccountPath(referer: string | null, accountId: string): string | null`; `apiRefuseWhilePaused(accountId: string, isAgency: boolean): Promise<Response | null>`; `requireAccountAccess(accountId, opts?: { duringPause?: "allow" })` (and the same option on `requireAccountOwner`, `requireNotTechnician`).

- [ ] **Step 1: Audit every exported server action.** For each `export async function` in the 41 account-scoped `"use server"` files (list: `grep -rl '^"use server"' "apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]" apps/web/src/lib`) and every inline `"use server"` function under `accounts/[accountId]`, write one row into `READ_ONLY_ALLOWED` in `read-only.test.ts`: `{ file, fn, why }`, ONLY for those that write nothing and call no model or provider. Starting candidates (verify each body: a getter that lazily creates a row is a write and stays refused): `shell-actions.ts` `getShellSnapshot`; `contacts/documents-actions.ts` `getDocumentUrlAction`; `contacts/actions.ts` `countContactDocumentsAction`; `contacts/groups-actions.ts` `searchGroupsAction`; `contacts/relationship-actions.ts` `searchRelatableContactsAction`; `contacts/[contactId]/forwarding-actions.ts` `getForwardingAddressAction`; plus `billing/actions.ts` `openBillingPortalAction` with `why: "the way to pay (spec flow 5)"`. Agency-only actions (`requireAgency`, `requireAgencyOnlyAccountAccess`) need no entry: the guard never applies to the agency.

- [ ] **Step 2: Failing tests.**
  `standing-read.test.ts`: "switch off → nothing paused, without a read (mutation: read regardless → FAILS)"; "a read error → nothing paused, logged (mutation: rethrow → FAILS)"; "a paused past_due row → paused, cause payment; a paused canceled row → cause ended (mutation: cause from billingPausedAt alone → FAILS)".
  `read-only.test.ts`:
  1. "sameAccountPath keeps a path inside this account only (mutation: accept any /dashboard path → FAILS)" — `https://x/dashboard/accounts/A/contacts?q=1` → `/dashboard/accounts/A/contacts?q=1`; another account's path, `/dashboard/work`, `//evil.com/dashboard/accounts/A/x` parsed as a URL with another host is still only a PATH (the origin is dropped, so no open redirect), garbage → null.
  2. "refuseActionWhilePaused: switch off → returns, reads nothing (mutation: drop the switch check → FAILS)".
  3. "no next-action header (a page render) → returns (mutation: drop the header check → FAILS)".
  4. "a server action on a paused account → redirect to the referer's path (mutation: redirect to the home always → FAILS)"; "no usable referer → the fallback".
  5. "not paused → returns".
  6. "THE ALLOW-LIST: the set of (file, function) that pass `duringPause: \"allow\"` equals READ_ONLY_ALLOWED, each with a reason (mutation: add the option to a write action → FAILS by name)" — source scan over the same files as Step 1.
  7. "no allowed action revalidates (mutation: add revalidatePath to getShellSnapshot → FAILS)" — the body of each allowed function contains none of `revalidatePath`, `revalidateTag`, `refresh(`.
  8. "exactly five non-test files in apps/web/src import readBillingStanding (mutation: import it from a pass → FAILS by name)" — `lib/consent/gate.ts`, `lib/consent/email-gate.ts`, `app/api/voice/texml/route.ts`, `app/api/concierge/[publicId]/turn/route.ts`, `lib/billing/standing-read.ts` (which serves the layout, the guard and the `/c` page). The nightly step and the pause pass read rows (`listPauseCandidates`, `listReconcilableAccounts`), never the verdict.
  `auth.test.ts`: "a client's server action on a paused account is redirected, the agency's is not (mutation: refuse the agency too → FAILS)"; "`duringPause: 'allow'` skips the refusal (mutation: ignore the option → FAILS)"; "requireAccountOwner and requireNotTechnician pass the option through (mutation: drop it in requireAccountOwner → FAILS)".
  `ai-summary/route.test.ts`: "POST by a client on a paused account → 409 { error: 'paused' }, no model call (mutation: check after the model call → FAILS)"; "GET unaffected".

- [ ] **Step 3: `apps/web/src/lib/billing/standing-read.ts`:**

```ts
import { cache } from "react";
import { readBillingStanding, serviceDb } from "@bis/db";
import { billingEnforced } from "./enforce";
import { ALL_ON, billingVerdict, pauseCause, type BillingVerdict } from "./standing";

export type AccountBillingVerdict = BillingVerdict & { cause: "payment" | "ended" | null };
const NOTHING_PAUSED: AccountBillingVerdict = Object.freeze({ ...ALL_ON, cause: null });

/**
 * The account's billing verdict for THIS request, read once (React cache):
 * the paused banner, the read-only guard and the concierge page.
 *
 * serviceDb, on purpose (plan Global Constraints): a client Staff session
 * reads NO account_billing row (0066 account_billing_owner_read), and
 * `plans` is agency-read only, yet every member must be told the account is
 * paused. It returns three booleans about the ACCOUNT, never a customer's
 * data, and every caller has already run requireAccountAccess (or is the
 * public concierge page, whose public id is its authorisation).
 *
 * FAILS OPEN: a read error is ALL_ON, logged. Switch off: ALL_ON, no read.
 */
export const billingVerdictFor = cache(async (accountId: string): Promise<AccountBillingVerdict> => {
  if (!billingEnforced()) return NOTHING_PAUSED;
  try {
    const standing = await readBillingStanding(serviceDb(), accountId);
    const verdict = billingVerdict(standing, true);
    return { ...verdict, cause: verdict.paused && standing ? pauseCause(standing) : null };
  } catch (e) {
    console.error(`billing standing read failed for account ${accountId}; treated as not paused: ${e instanceof Error ? e.message : String(e)}`);
    return NOTHING_PAUSED;
  }
});
```

Add to `in-account-service-reads.test.ts`: `"lib/billing/standing-read.ts": "configuration"` (with the comment "the account's billing verdict (three booleans), never customer data; every member must see the pause").

- [ ] **Step 4: `apps/web/src/lib/billing/read-only.ts`:**

```ts
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { billingEnforced } from "./enforce";
import { billingVerdictFor } from "./standing-read";

/** Next 16.3.6's server-action request header (app-router-headers.js:96). */
export const ACTION_HEADER = "next-action";

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
 * for a CLIENT caller only. Refuses a SERVER ACTION (the request carries
 * `next-action`; a page render, a layout and a GET never do) on a paused
 * account by sending the browser back to the page it came from, where the
 * paused banner says why. Nothing is written: the action body never runs
 * past its guard. Switch off: returns at once. A failed read: allowed
 * (billingVerdictFor fails open).
 */
export async function refuseActionWhilePaused(accountId: string, fallback: string): Promise<void> {
  if (!billingEnforced()) return;
  const h = await headers();
  if (h.get(ACTION_HEADER) === null) return;
  if (!(await billingVerdictFor(accountId)).paused) return;
  console.log(`read-only: refused a client action on paused account ${accountId}`);
  redirect(sameAccountPath(h.get("referer"), accountId) ?? fallback);
}

/** The one client API write (ai-summary's POST, Regenerate): 409 while paused. */
export async function apiRefuseWhilePaused(accountId: string, isAgency: boolean): Promise<Response | null> {
  if (isAgency || !billingEnforced()) return null;
  return (await billingVerdictFor(accountId)).paused
    ? Response.json({ error: "paused" }, { status: 409 })
    : null;
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

`requireAccountOwner(accountId, opts: AccessOptions = {})` and `requireNotTechnician(accountId, opts: AccessOptions = {})` pass `opts` to `requireAccountAccess`. Update the doc comment of `requireAccountAccess` with one paragraph on the read-only rule.

- [ ] **Step 6: Opt out the audited actions** — e.g. `billing/actions.ts:37`: `await requireAccountOwner(accountId, { duringPause: "allow" })`; `shell-actions.ts:150`: `await requireAccountAccess(accountId, { duringPause: "allow" })`; and each row of `READ_ONLY_ALLOWED`.

- [ ] **Step 7: `ai-summary` POST** — after `apiAccountAccess` succeeds, in the POST branch only: `const refused = await apiRefuseWhilePaused(accountId, access.isAgency); if (refused) return refused;`.

- [ ] **Step 8: Run** — `pnpm --filter web exec vitest run src/lib/billing/read-only.test.ts src/lib/billing/standing-read.test.ts src/lib/auth.test.ts "src/app/(dashboard)/dashboard/accounts/[accountId]/technician-guards.test.ts" "src/app/(dashboard)/dashboard/accounts/[accountId]/in-account-service-reads.test.ts" "src/app/api/accounts"`, plus every test of an opted-out file (`shell-actions.test.ts`, `billing/actions.test.ts`, `documents-actions` tests, …): their `@/lib/auth` mocks receive a second argument, which a `toHaveBeenCalledWith(accountId)` assertion rejects; update those to `(accountId, { duringPause: "allow" })` and name the change in the commit. `pnpm --filter web lint && pnpm --filter web exec tsc --noEmit`.

- [ ] **Step 9: Commit** — `git commit -m "M7a PR-4: a paused account's dashboard is read-only for the client: server actions are refused at requireAccountAccess, with an audited allow-list"`.

### Task 8: Nightly: re-mirror, reconcile, the held rows, permissions (HIGH, bis-automations)

**Files:**
- Create: `apps/web/src/lib/billing/reconcile.ts` (+ `.test.ts`), `apps/web/src/lib/billing/nightly.ts` (+ `.test.ts`).
- Modify: `apps/web/src/lib/billing/stripe-gateway.ts` (interface `:68-85`, implementation; `usageIdempotencyKey` MOVES here from `usage-report.ts:16`, which re-exports it for its existing importers, so `nightly.ts` and `usage-report.ts` do not import each other), `apps/web/src/lib/billing/fake-gateway.ts`, `apps/web/src/lib/automations/passes/usage-report.ts` (counters + the nightly call), `apps/web/src/app/api/cron/reminders/route.test.ts` (`@bis/db` factory gains the nightly's reads: `listReconcilableAccounts`, `listPauseCandidates` already there, `reconciledSince`, `readUsageBands`, `saveReconciliation`, `healPermissions`, `mirrorSubscription`).
- Test: `lib/billing/stripe-gateway.test.ts` (+1 or +2), `lib/automations/passes/usage-report.test.ts` (if it exists; else the route test), `lib/automations/cron-coupling.test.ts` (unchanged, must still pass).

**Interfaces:**
- Consumes: Task 2's `listReconcilableAccounts`, `listPauseCandidates`, `readUsageBands`, `saveReconciliation`, `reconciledSince`, `healPermissions`, `markUsageReported`, `mirrorSubscription`, `PAST_DUE_STATUSES`; `usageIdempotencyKey` (`usage-report.ts:16`); `METERS` (`stripe-catalog.ts:12`).
- Produces: `BillingGateway.meterTotal(input: { meterId: string; customerId: string; startSeconds: number; endSeconds: number }): Promise<number>`; `RECONCILE_HOUR_UTC = 8`, `RECONCILE_SETTLE_MS = 2 h`, `nightlyRunStart(now): Date`, `reconcileWindow(row, now): { start: Date; end: Date } | null`, `reconcileMeter(bands: { settled; inFlight; held }, stripeTotal: number): ReconciliationVerdict`, `runBillingNightly(ctx, gateway, clock): Promise<NightlyCounters>`.

- [ ] **Step 1: Failing tests** `reconcile.test.ts` (pure):
  1. "nightlyRunStart is today 08:00 UTC from 08:00 on, else yesterday's (mutation: local midnight → FAILS)".
  2. "reconcileWindow: start is the later of period start and billing start, CEILED to the minute; end is now FLOORED to the minute (mutation: floor the start → FAILS: an event in the first seconds of the period counts on BIS's side only)"; "no current_period_start → null (nothing to compare)"; "end <= start → null".
  3. "no held rows: Stripe between settled and settled + in flight → match; below → stripe_under; above → stripe_over (mutation: ignore in-flight → FAILS)".
  4. "held rows Stripe already counts → held_at_stripe (mutation: send them anyway → FAILS)".
  5. "held rows Stripe does not count → held_missing (mutation: stamp them → FAILS)".
  6. "the two ranges overlap → ambiguous, never a guess (mutation: prefer held_at_stripe on overlap → FAILS)".
  7. "Stripe between the ranges (part of the held rows) → ambiguous (mutation: call it stripe_under → FAILS)".
  8. "a non-integer Stripe total → ambiguous (assumption S5; mutation: Math.round → FAILS)".
  `nightly.test.ts` (FakeGateway + a vi.mock of `@bis/db`):
  9. "before 08:00 UTC nothing runs (mutation: run every tick → FAILS)".
  10. "re-mirrors every past_due, unpaid and paused subscription, once (mutation: re-mirror active rows too → FAILS by call count)".
  11. "skips an (account, meter) already checked since tonight's start (mutation: re-check everything → FAILS)".
  12. "held_at_stripe stamps exactly the held rows; held_missing sends each with usageIdempotencyKey then stamps (mutation: send without stamping → FAILS)".
  13. "an alerting verdict is saved and logged with console.error (mutation: save only matches → FAILS)".
  14. "a Stripe call starts only while elapsed < budget − worst case, sharing the pass's own start (mutation: a fresh clock for the nightly → FAILS: it overruns USAGE_REPORT_BUDGET_MS)".
  15. "heals accounts.permissions for every account it reconciled (mutation: skip the heal → FAILS)".
  16. "one account's Stripe failure is counted and the next account still runs (mutation: rethrow → FAILS)".
  `stripe-gateway.test.ts`: "meterTotal asks listEventSummaries with exactly { customer, start_time, end_time } and per-request { maxNetworkRetries: 0, timeout: METER_EVENT_TIMEOUT_MS } (mutation: pass value_grouping_window → FAILS)"; "an empty summary list is 0".

- [ ] **Step 2: Run** — `pnpm --filter web exec vitest run src/lib/billing/reconcile.test.ts src/lib/billing/nightly.test.ts src/lib/billing/stripe-gateway.test.ts`. Expected: FAIL.

- [ ] **Step 3: Gateway.** Interface: `meterTotal(input: { meterId: string; customerId: string; startSeconds: number; endSeconds: number }): Promise<number>;`. Implementation:

```ts
    async meterTotal({ meterId, customerId, startSeconds, endSeconds }) {
      // One summary for the whole range (no value_grouping_window); both
      // times minute-aligned (stripe 22.6.2 Meters.d.ts:216-236). Assumption
      // S1: it is the sum of the customer's ACCEPTED events in the range.
      const page = await stripe.billing.meters.listEventSummaries(meterId, {
        customer: customerId, start_time: startSeconds, end_time: endSeconds,
      }, { maxNetworkRetries: 0, timeout: METER_EVENT_TIMEOUT_MS });
      return page.data.reduce((sum, s) => sum + s.aggregated_value, 0);
    },
```

`FakeGateway.meterTotal` sums the events its `reportMeterEvent` recorded for that meter's event name and customer whose `timestampSeconds` fall in `[start, end)`, and lets a test seed an extra total (`seedMeterTotal(meterId, customerId, value)`).

- [ ] **Step 4: `apps/web/src/lib/billing/reconcile.ts`:**

```ts
import type { AccountBilling, ReconciliationVerdict } from "@bis/db";

/** Nightly = the first ticks at or after this hour, UTC (2-3 AM Central). */
export const RECONCILE_HOUR_UTC = 8;
/** Assumption S1: an event Stripe accepted this long ago is in its summary. */
export const RECONCILE_SETTLE_MS = 2 * 60 * 60 * 1000;

const MINUTE_MS = 60_000;

export function nightlyRunStart(now: Date): Date {
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), RECONCILE_HOUR_UTC);
  return new Date(now.getTime() >= today ? today : today - 24 * 60 * 60 * 1000);
}

/** The current billing period so far, on whole minutes (Stripe's summary
 *  times must be minute-aligned). Start CEILED, end FLOORED: an event in a
 *  partial minute at either edge is outside the window on BOTH sides, since
 *  Stripe's event timestamp is floor(occurred_at in seconds). */
export function reconcileWindow(
  row: Pick<AccountBilling, "currentPeriodStart" | "billingStartedAt">, now: Date,
): { start: Date; end: Date } | null {
  if (!row.currentPeriodStart) return null;
  const from = Math.max(Date.parse(row.currentPeriodStart), Date.parse(row.billingStartedAt));
  const start = Math.ceil(from / MINUTE_MS) * MINUTE_MS;
  const end = Math.floor(now.getTime() / MINUTE_MS) * MINUTE_MS;
  return end > start ? { start: new Date(start), end: new Date(end) } : null;
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
  METER_KEYS, PAST_DUE_STATUSES, healPermissions, listPauseCandidates, listReconcilableAccounts,
  markUsageReported, mirrorSubscription, readUsageBands, reconciledSince, saveReconciliation,
  ALERTING_VERDICTS,
} from "@bis/db";
import { USAGE_REPORT_BUDGET_MS, METER_EVENT_WORST_CASE_MS } from "@/lib/automations/caps";
import type { PassContext } from "@/lib/automations/context";
import { METERS } from "./stripe-catalog";
import { meterEventFailureKind, usageIdempotencyKey, type BillingGateway } from "./stripe-gateway";
import { RECONCILE_SETTLE_MS, nightlyRunStart, reconcileMeter, reconcileWindow } from "./reconcile";

export type NightlyCounters = {
  remirrored: number; reconciled: number; mismatched: number; heldStamped: number; heldSent: number;
  reconcileFailed: number; reconcileSkippedBudget: number;
};

/**
 * The nightly billing step (spec section 4 "nightly reconciliation"; plan G6,
 * G14, G15, G4). Runs INSIDE usageReportPass, after its sends, on the SAME
 * wall-clock budget: `startedAt` is that pass's own start, so the budget
 * sum cron-coupling.test.ts pins is unchanged. A Stripe call starts only
 * while elapsed < USAGE_REPORT_BUDGET_MS − METER_EVENT_WORST_CASE_MS. The
 * unit of work is one (account, meter) not yet checked since tonight's run
 * start, so whatever this tick does not reach, the next one does.
 *
 *   1. re-mirror every past_due, unpaid or paused subscription (G6): the
 *      pause never rests on a status Stripe has not confirmed in a day;
 *   2. per live subscription and meter: BIS's bands vs Stripe's total over
 *      the current period so far; held rows stamped (Stripe has them) or
 *      sent now (it does not); the verdict saved; a mismatch logged;
 *   3. accounts.permissions rewritten from the plan for each account done.
 */
export async function runBillingNightly(
  ctx: PassContext, gateway: BillingGateway, clock: { startedAt: number; nowMs: () => number },
): Promise<NightlyCounters> {
  const c: NightlyCounters = { remirrored: 0, reconciled: 0, mismatched: 0, heldStamped: 0, heldSent: 0, reconcileFailed: 0, reconcileSkippedBudget: 0 };
  const runStart = nightlyRunStart(ctx.now);
  if (ctx.now.getTime() < runStart.getTime()) return c;
  const canStart = () => clock.nowMs() - clock.startedAt < USAGE_REPORT_BUDGET_MS - METER_EVENT_WORST_CASE_MS;

  // 1. Freshness for the pause (once per night: stripe_checked_at after runStart means done).
  for (const row of await listPauseCandidates(ctx.db)) {
    const unpaid = row.billingPausedAt !== null || (row.subscriptionStatus !== null && PAST_DUE_STATUSES.includes(row.subscriptionStatus));
    if (!unpaid || !row.stripeSubscriptionId) continue;
    if (row.stripeCheckedAt && Date.parse(row.stripeCheckedAt) >= runStart.getTime()) continue;
    if (!canStart()) { c.reconcileSkippedBudget++; return c; }
    try {
      const subId = row.stripeSubscriptionId;
      const out = await mirrorSubscription(ctx.db, () => gateway.retrieveSubscription(subId), () => ctx.now);
      if (out.kind === "refused") console.error(`billing nightly: re-mirror of ${subId} (account ${row.accountId}) refused: ${out.reason}`);
      else c.remirrored++;
    } catch (e) {
      c.reconcileFailed++;
      console.error(`billing nightly: re-mirror failed for account ${row.accountId}: ${String(e)}`);
    }
  }

  // 2 + 3. Reconcile.
  const done = await reconciledSince(ctx.db, runStart.toISOString());
  const meterIds = new Map((await gateway.listActiveMeters()).map((m) => [m.eventName, m.id]));
  for (const row of await listReconcilableAccounts(ctx.db)) {
    const window = reconcileWindow(row, ctx.now);
    if (!window || !row.stripeCustomerId) continue;
    let touched = false;
    for (const meter of METER_KEYS) {
      if (done.has(`${row.accountId}:${meter}`)) continue;
      const meterId = meterIds.get(METERS[meter].eventName);
      if (!meterId) { console.error(`billing nightly: no active Stripe meter for ${meter}`); continue; }
      if (!canStart()) { c.reconcileSkippedBudget++; return c; }
      try {
        const bands = await readUsageBands(ctx.db, {
          accountId: row.accountId, meter, startIso: window.start.toISOString(), endIso: window.end.toISOString(),
          now: ctx.now, settleMs: RECONCILE_SETTLE_MS,
        });
        const stripeTotal = await gateway.meterTotal({
          meterId, customerId: row.stripeCustomerId,
          startSeconds: window.start.getTime() / 1000, endSeconds: window.end.getTime() / 1000,
        });
        const verdict = reconcileMeter(bands, stripeTotal);
        if (verdict === "held_at_stripe") {
          for (const h of bands.heldRows) if (await markUsageReported(ctx.db, h.id, ctx.now)) c.heldStamped++;
        } else if (verdict === "held_missing") {
          for (const h of bands.heldRows) {
            if (!canStart()) { c.reconcileSkippedBudget++; return c; }
            // The reporter's key and identifier. Stripe holding the identifier
            // after all ("duplicate", A11) means the usage IS there: stamp it.
            // Any other failure leaves the row held for tomorrow, logged.
            let atStripe = false;
            try {
              await gateway.reportMeterEvent({
                eventName: METERS[meter].eventName, customerId: row.stripeCustomerId, value: h.quantity,
                identifier: h.id, timestampSeconds: Math.floor(Date.parse(h.occurredAt) / 1000),
              }, usageIdempotencyKey(h.id, row.stripeCustomerId));
            } catch (e) {
              if (meterEventFailureKind(e, h.id) !== "duplicate") {
                c.reconcileFailed++;
                console.error(`billing nightly: held usage row ${h.id} (account ${row.accountId}) not sent: ${String(e)}`);
                continue;
              }
              atStripe = true;
            }
            if (await markUsageReported(ctx.db, h.id, ctx.now)) {
              if (atStripe) c.heldStamped++; else c.heldSent++;
            }
          }
        }
        await saveReconciliation(ctx.db, {
          accountId: row.accountId, meter, windowStart: window.start.toISOString(), windowEnd: window.end.toISOString(),
          bisSettled: bands.settled, bisInFlight: bands.inFlight, bisHeld: bands.held, stripeTotal,
          verdict, checkedAt: ctx.now.toISOString(),
        });
        c.reconciled++;
        touched = true;
        if (ALERTING_VERDICTS.includes(verdict)) {
          c.mismatched++;
          console.error(`billing nightly: ${meter} for account ${row.accountId} is ${verdict}: Stripe ${stripeTotal}, BIS settled ${bands.settled}, in flight ${bands.inFlight}, held ${bands.held} (window ${window.start.toISOString()} to ${window.end.toISOString()})`);
        }
      } catch (e) {
        c.reconcileFailed++;
        console.error(`billing nightly: ${meter} for account ${row.accountId} not reconciled: ${String(e)}`);
      }
    }
    if (touched) {
      try { await healPermissions(ctx.db, row.accountId); } catch (e) {
        console.error(`billing nightly: permissions not healed for account ${row.accountId}: ${String(e)}`);
      }
    }
  }
  return c;
}
```

The `held_missing` send uses the SAME idempotency key and identifier the reporter used: more than 20 h have passed and the verdict says Stripe's total lacks the event, so a replay of an earlier acceptance is the only way it can "succeed" without a new event, and an identifier refusal ("duplicate") means Stripe has it after all; both end stamped, never counted twice. Add tests 17 ("held_missing: a duplicate refusal stamps the row as heldStamped, never heldSent (mutation: count it sent → FAILS)") and 18 ("held_missing: a row refusal leaves the row unstamped and the next held row still runs (mutation: stamp on any failure → FAILS)").

- [ ] **Step 6: Call it from `usageReportPass`.** After `await bookkeeping();` on the Stripe-usable path only (the no-Stripe path returns before it), keeping the pass's own `startedAt`:

```ts
    // The nightly step (plan G14), on THIS pass's clock and budget.
    try {
      Object.assign(c, await runBillingNightly(ctx, gateway, { startedAt, nowMs: () => Date.now() }));
    } catch (e) {
      console.error(`usage report: the nightly billing step failed outright: ${String(e)}`);
    }
```

and add the seven counters (zeroed) to `c`'s initial object. Doc comment: a step 5.

- [ ] **Step 7: Run** Step 2's suites, plus `src/app/api/cron/reminders/route.test.ts`, `src/lib/automations/cron-coupling.test.ts`, `src/lib/automations/sentinel.test.ts`, `src/lib/billing/usage.test.ts`, `src/lib/billing/meter-event-failure.test.ts`. Expected: PASS. Lint + typecheck.

- [ ] **Step 8: Commit** — `git commit -m "M7a PR-4: nightly reconciliation of usage with Stripe's meters, the held >24h rows resolved, unpaid subscriptions re-read, permissions healed"`.

### Task 9: Lift pause actions and the card's view model (MEDIUM, bis-frontend)

**Files:**
- Modify: `apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/settings/billing-actions.ts` (two actions), `apps/web/src/lib/billing/billing-view.ts` (`BillingCardView`, `billingCardView`).
- Test: `settings/billing-actions.test.ts`, `lib/billing/billing-view.test.ts`.

**Interfaces:**
- Consumes: `clearBillingPause`, `undoLiftBillingPause`, `getAccountBilling`, `listReconciliations`, `type Reconciliation` (Task 2); `pauseCause` (Task 4); `billingEnforced` (Task 4); keys (Task 3).
- Produces:
  - `liftPauseAction(accountId: string): Promise<{ ok: true; liftedAt: string } | { ok: false; error: string }>`.
  - `undoLiftPauseAction(accountId: string, liftedAt: string): Promise<BillingActionResult>`.
  - `BillingCardView` gains `pause: { line: string } | null`, `lifted: string | null`, `pauseOff: boolean`, `reconciliation: string[]`, `can.liftPause: boolean`; `billingCardView` input gains `reconciliations: Reconciliation[]` and `enforced: boolean`.

- [ ] **Step 1: Failing tests.** `billing-actions.test.ts`: "liftPauseAction calls requireAgency FIRST (mutation: move it after the read → FAILS)"; "lifts with the stored updated_at, returns the liftedAt it wrote (mutation: return Date.now() → FAILS: Undo would never match)"; "not paused → billing.error.notPaused (mutation: lift anyway → FAILS)"; "a lost race → billing.error.notPaused"; "undoLiftPauseAction stale → billing.error.cannotRepause"; "a bad uuid → billing.error.stale". `billing-view.test.ts`: "a paused past_due row: the payment line with both dates, can.liftPause (mutation: offer Lift on a complimentary row → FAILS)"; "an ended row: the ended line"; "lifted and still past_due: the lifted line, no Lift button"; "pauseOff only when a stamp exists and the switch is off (mutation: show it whenever off → FAILS)"; "reconciliation lines only for the alerting verdicts, with the meter's words and the check time in the account's zone (mutation: show held_missing → FAILS)".

- [ ] **Step 2: Run** — `pnpm --filter web exec vitest run src/lib/billing/billing-view.test.ts "src/app/(dashboard)/dashboard/accounts/[accountId]/settings/billing-actions.test.ts"`. Expected: FAIL.

- [ ] **Step 3: The actions** (in `billing-actions.ts`, after `removeComplimentaryAction`):

```ts
export type LiftResult = { ok: true; liftedAt: string } | { ok: false; error: string };

/** Lift pause (spec section 5; plan G3): immediate, with Undo (rule 6). */
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
  return { ok: true, liftedAt: now.toISOString() };
}

/** The Lift's Undo: re-pauses only while THAT lift still stands (G3). */
export async function undoLiftPauseAction(accountId: string, liftedAt: string): Promise<BillingActionResult> {
  await requireAgency();
  if (!isUuid(accountId) || Number.isNaN(Date.parse(liftedAt))) return fail("billing.error.stale");
  const r = await undoLiftBillingPause(serviceDb(), { accountId, liftedAt, now: new Date() });
  return r === "repaused" ? { ok: true } : fail("billing.error.cannotRepause");
}
```

- [ ] **Step 4: The view** (`billing-view.ts`). New input fields `reconciliations: Reconciliation[]`, `enforced: boolean`. Computation:

```ts
  const pausedAt = billing?.billingPausedAt ?? null;
  const pause = pausedAt && billing
    ? { line: pauseCause(billing) === "ended"
        ? m["billing.card.pausedEnded"].replace("{date}", formatDay(new Date(pausedAt), zone))
        : m["billing.card.pausedPayment"].replace("{date}", formatDay(new Date(pausedAt), zone))
            .replace("{failed}", billing.pastDueSince ? formatDay(new Date(billing.pastDueSince), zone) : formatDay(new Date(pausedAt), zone)) }
    : null;
  const lifted = !pausedAt && billing?.pauseLiftedAt && status === "payment_failed"
    ? m["billing.card.lifted"].replace("{date}", formatDay(new Date(billing.pauseLiftedAt), zone)) : null;
  const reconciliation = input.reconciliations
    .filter((r) => ALERTING_VERDICTS.includes(r.verdict))
    .map((r) => m["billing.card.reconcile.line"]
      .replace("{meter}", m[`billing.card.reconcile.meter.${r.meter}` as MessageKey])
      .replace("{stripe}", count(r.stripeTotal)).replace("{bis}", count(r.bisSettled + r.bisInFlight + r.bisHeld))
      .replace("{when}", formatMoment(new Date(r.checkedAt), zone)));
```

and `pauseOff: pausedAt !== null && !input.enforced`, `can.liftPause: pausedAt !== null && billing !== null && !billing.complimentary`. (Import `pauseCause` from `./standing`, `ALERTING_VERDICTS` and `type Reconciliation` from `@bis/db`. The card shows English, like the rest of the card, ratchet debt; the `.es` twins exist for the day it is translated.)

- [ ] **Step 5: Run** Step 2's suites, plus `billing-section.test.ts` (its call of `billingCardView` gains the two inputs; Task 11 wires them) and lint/typecheck.

- [ ] **Step 6: Commit** — `git commit -m "M7a PR-4: Lift pause and its Undo (agency), and the Billing card's pause and reconciliation lines"`.

### Task 10: Client surfaces (LOW, bis-frontend)

**Files:**
- Create: `apps/web/src/components/billing-paused-banner.tsx` (+ `.test.ts`).
- Modify: `apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/layout.tsx:42-75`, `apps/web/src/components/billing-banner.tsx` (bilingual), `apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/billing/page.tsx:80-105`.
- Test: `layout.test.ts`, `billing/page.test.ts`, `components/billing-banner` test if present.

**Interfaces:**
- Consumes: `billingVerdictFor` (Task 7), `pauseCause` (Task 4), `readAccountBilling` (existing), keys (Task 3).

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
 * the marker (DESIGN rule 3; LineDownBanner's reasoning). tone crit: service
 * is reduced right now. Three audiences: the client Owner (link to Billing),
 * Staff and Technicians (Billing is Owner-only: a line instead), the agency
 * (link to the Settings card). `lang` on the sentence (the root html stays en).
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

Tests: each audience's words and link (agency → `settings#billing`, owner → `/billing`, member → no link); `lang="es"` and the Spanish sentence for `locale: "es"` (mutation: hard-code "en" → FAILS).

- [ ] **Step 2: The layout.** Read the verdict beside the existing billing read. `billingVerdictFor` is cached, fails open and carries `cause`, so Staff (who read no `account_billing` row under RLS) get the same sentence as the Owner:

```tsx
  const [paymentFailedRow, verdict] = await Promise.all([
    readAccountBilling(accountId).catch((e: unknown) => { console.error(`account layout: billing read failed for ${accountId}: ${e instanceof Error ? e.message : String(e)}`); return null; }),
    billingVerdictFor(accountId),
  ]);
  const paymentFailed = showsPaymentFailedBanner(paymentFailedRow);
  const audience = isAgency ? "agency" : role === "owner" ? "owner" : "member";
```

Render `<BillingPausedBanner audience={audience} accountId={accountId} cause={verdict.cause ?? "payment"} locale={locale} />` INSTEAD of the payment-failed one when `verdict.paused` (both never show: `showsPaymentFailedBanner` is false on a paused row, and with the switch off `verdict.paused` is false). The layout needs `role`: take it from `requireAccountAccess`'s return (already awaited at `:21`, today destructured as `{ isAgency }`).

- [ ] **Step 3: The payment-failed banner, bilingual.** `BillingBanner` gains `locale: Locale` and uses `t(m, key, locale)` for its four keys, inside `<span lang={locale}>`; the layout passes `locale` (already computed at `:63`).

- [ ] **Step 4: The Billing page's paused line.** Above Manage billing (`page.tsx` near `:99`), when `billing.billingPausedAt` and `billingEnforced()`: `<p className="text-sm text-foreground" lang={locale}>{t(m, pauseCause(billing) === "ended" ? "billing.page.paused.ended" : "billing.page.paused.payment", locale)}</p>` (the page's locale: the same `requestLocale` the layout uses; if the page has none, read it the layout's way). Manage billing stays.

- [ ] **Step 5: Tests** — `layout.test.ts`: "paused + switch on: the paused banner for an Owner with the Billing link, for Staff with the owner line, for the agency with the Settings link, and never beside the payment-failed one"; "switch off: no paused banner (mutation: read the stamp without the switch → FAILS)"; "a failed verdict read: no banner, the page renders". `page.test.ts`: the paused line per cause; Manage billing still rendered.

- [ ] **Step 6: Run** — `pnpm --filter web exec vitest run src/components "src/app/(dashboard)/dashboard/accounts/[accountId]/layout.test.ts" "src/app/(dashboard)/dashboard/accounts/[accountId]/billing"`, lint, typecheck, `pnpm --filter web exec vitest run src/lib/i18n` (the ratchet: the new component routes every string through `t()`).

- [ ] **Step 7: Commit** — `git commit -m "M7a PR-4: the paused banner on every page of a paused account, its Billing page line, and the payment-failed banner in Spanish"`.

### Task 11: Agency surfaces (LOW, bis-frontend)

**Files:**
- Create: `apps/web/src/components/billing-alert-banner.tsx` (+ `.test.ts`).
- Modify: `settings/billing-section.tsx` (read `listReconciliations`, pass `enforced`, bind the two actions), `settings/billing-card.tsx` (lines + Lift pause with Undo), `app/(dashboard)/dashboard/work/page.tsx:77-99, 199-201`, `app/(dashboard)/dashboard/styleguide/page.tsx` + `billing-card-states.tsx` (paused, lifted, pause-off, mismatch specimens; both paused banner audiences; the alert banner).
- Test: `billing-card.test.ts`, `billing-section.test.ts`, work page test if present, `styleguide` tests.

- [ ] **Step 1: `BillingAlertBanner`** — props `{ alerts: BillingAlert[] }`; renders nothing at zero; one line per kind present, in the order paused, payment failed, usage mismatch; each line = the kind's label (`work.agency.billing.*`) + up to five account links (`/dashboard/accounts/<id>/settings#billing`, the account's name) + `work.agency.billing.more` for the rest; `tone="crit"` when any paused or mismatch, else `"warn"`; `role="note"`. Tests: zero → null; the cap at five with "and 2 more"; the tone rule.

- [ ] **Step 2: Work page** — `listBillingAlerts(db).catch(...)` joins the existing `Promise.all` (swallowed like the stale-usage read, logged), and `<BillingAlertBanner alerts={billingAlerts} />` renders below `UsageStaleBanner`.

- [ ] **Step 3: The card** — under the status chip: `view.pause?.line`, `view.lifted`, `view.pauseOff ? m["billing.card.pauseOff"] : null`; a reconciliation block when `view.reconciliation.length > 0` (`billing.card.reconcile.title`, the lines, `billing.card.reconcile.help`); and, when `view.can.liftPause`, a ghost button `billing.card.liftPause` with `billing.card.liftPauseHelp` as its description, which runs `liftPause()` immediately and on success toasts `billing.card.liftedToast` with an Undo calling `undoLiftPause(liftedAt)` (success toast `billing.card.repausedToast`), through the card's existing `run(go, success, undo)` helper (`billing-card.tsx:106-125`). The section binds `liftPauseAction.bind(null, accountId)` and `(liftedAt) => undoLiftPauseAction(accountId, liftedAt)`. Send billing link stays the one primary.

- [ ] **Step 4: Tests** — `billing-card.test.ts`: Lift pause is ghost, never a second primary (mutation: `variant="default"` → FAILS); Undo calls the undo action with the returned `liftedAt`; the reconciliation block renders the lines; `billing-section.test.ts`: `enforced` comes from `billingEnforced()` (mutation: hard-code true → FAILS).

- [ ] **Step 5: Styleguide** — specimens for: card Paused (payment), Paused (ended), lifted, pause-off, mismatch; `BillingPausedBanner` × three audiences × en/es; `BillingAlertBanner` with all three kinds and one with seven names.

- [ ] **Step 6: Run** — the card, section, banner and styleguide tests; lint; typecheck; `pnpm --filter web build` (UI changed).

- [ ] **Step 7: Commit** — `git commit -m "M7a PR-4: Lift pause on the Billing card, the reconciliation result, the work queue's billing banner, styleguide specimens"`.

### Task 12: e2e and the CI switch (MEDIUM, bis-e2e-qa)

**Files:**
- Create: `apps/web/e2e/billing-pause.spec.ts`.
- Modify: `.github/workflows/ci.yml` (e2e job env, beside `STRIPE_WEBHOOK_SECRET` `:331`), `apps/web/ci/ci-workflow.test.ts` (one pinning case, like the webhook literal's).

- [ ] **Step 1: The switch in CI.** In the e2e job's `env:`:

```yaml
      # NOT a secret: turns the non-payment pause on for this job only (M7a
      # PR-4), so e2e/billing-pause.spec.ts sees the pause enforced. The
      # fixture account is the only one paused, and the spec restores it.
      # Production's value is set on Vercel Production only, by the owner.
      BILLING_ENFORCE: "1"
```

`ci-workflow.test.ts`: "the e2e job turns BILLING_ENFORCE on and verify does not (mutation: remove it, or add it to verify → FAILS)".

- [ ] **Step 2: The spec** (`billing-pause.spec.ts`, runs serially, sorts before `billing.spec.ts`; skips loudly unless `BILLING_ENFORCE === "1"`; uses `serviceDb()` from the runner like `forward-calls.spec.ts`; client fixture from `e2e/.auth/client-fixture.json`). `beforeAll` captures any `account_billing` row of the fixture (there should be none: `billing.spec.ts` deletes its own), inserts an `E2E Plan <stamp>` plan (fake Stripe ids, `voice_receptionist: true, web_concierge: true`) and a PAID row for the fixture: `stripe_customer_id: cus_e2e_<stamp>`, `stripe_subscription_id: sub_e2e_<stamp>`, `subscription_status: past_due`, `past_due_since: now − 8 days`, `stripe_checked_at: now − 1 hour`. `afterAll` (in `finally`, each step attempted): deletes the row and the plan, restores the captured row if any. Tests:
  1. "the pass pauses a past-due account after 7 days" — import `billingPausePass` from `../src/lib/automations/passes/billing-pause` and run it with `{ db: serviceDb(), now: new Date(), … }` (the e2e job has no `CRON_SECRET`, so the route itself is not driven; the PR-2 precedent, `usage-meter.spec.ts:37`); expect the row's `billing_paused_at` set.
  2. "the client Owner sees the paused banner on the dashboard and on Contacts, and the Billing page's paused line with Manage billing" (both texts by `renderedText`/locator on the exact `m[...]` strings).
  3. "a change while paused is not saved and lands back on the same page (N1)" — on the dashboard, flip the business status switch (`one-switch.spec.ts`'s locators); expect the URL unchanged, the banner visible, and `business_status` unchanged in the database.
  4. "the agency sees Paused on the Billing card, lifts it, sees the Undo, undoes, lifts again" — the card's status chip `Paused`, the pause line, click `Lift pause`, toast `Pause lifted.` with Undo, Undo → `Paused again.`, Lift again; the row ends with `billing_paused_at` null and `pause_lifted_at` set.
  5. "the work queue names the fixture under Paused, then under Payment failed after the lift" — `/dashboard/work`.
  6. "S1: a real test-mode meter reconciles" (skips without a Stripe test key, like `usage-meter.spec.ts`; throwaway customer, no DB) — report two events through `stripeGateway(...).reportMeterEvent`, poll `meterTotal` until it reaches their sum (120 s, A16's bound), expect `reconcileMeter({ settled: sum, inFlight: 0, held: 0 }, total) === "match"`; then a third event, polled, and `reconcileMeter({ settled: sum, inFlight: 0, held: third }, total + third) === "held_at_stripe"`; delete the customer. "Unproven" is a `::warning`, not a failure (A16's rule).

- [ ] **Step 3: Run** — locally only if the env names the CI project (CLAUDE.md), one spec: `pnpm --filter web exec playwright test e2e/billing-pause.spec.ts`; otherwise push and read the e2e job FOR THE HEAD SHA. Also `pnpm --filter web exec vitest run ci/ci-workflow.test.ts e2e/fixtures` (fixture-name tests admit `E2E Plan <stamp>` already, `stale.ts:214`).

- [ ] **Step 4: Commit** — `git commit -m "M7a PR-4: e2e for the pause, the read-only dashboard, Lift pause and the work queue; BILLING_ENFORCE on in CI's e2e job"`.

### Task 13: Docs (LOW, bis-platform)

**Files:**
- Modify: `.env.example` (beside `STRIPE_WEBHOOK_SECRET` `:310-317`), `docs/runbooks/stripe-billing.md` (new section 9 + edits to 5.6), `docs/crm-features.md:304` (status) and `:948` (rule 9's text, per owner question 7's answer).

- [ ] **Step 1: `.env.example`:**

```
# The non-payment pause and the plan gates (M7a PR-4). Exactly 1 = on: a
# billed account unpaid for 7 days, or whose plan ended, is paused (calls go
# to its transfer number, texts and automations stop, the website chat
# closes, the client's dashboard is read-only), and a plan without the
# receptionist or the website chat is enforced. Unset = off: the cron logs
# what it WOULD pause and changes nothing. Production only, set by the owner
# after the runbook's checks (docs/runbooks/stripe-billing.md section 9).
# Turning it off is the rollback. Needs a redeploy, like every env change.
BILLING_ENFORCE=
```

- [ ] **Step 2: Runbook section 9, "The pause and the nightly reconciliation"**: what pauses and when (G1); what stops and what does not (G7-G11); turning it on (Task 14 Step 6); reading the cron log (`billingPause` counters; `wouldPause` while off); Lift pause and its Undo; "a client paid but is still paused" (the webhook + nightly re-read; if both failed, `mirrorSubscription` by hand is not available: edit the subscription's metadata in Stripe to fire `customer.subscription.updated`, PR-3 runbook 3); each reconciliation verdict and what to do (`stripe_over`: check the draft invoice before it finalises and credit the difference; `stripe_under`: Stripe dropped events (A12), add a manual invoice item or accept; `ambiguous`: compare `usage_events` with the Stripe meter's events for the window by hand); a held row from a closed period (G15: decide by hand, then set `reported_at`); the S2/S3/S4 test-clock probe (past_due through day 7, unpaid after the last retry; cancel at period end; usage after cancel not invoiced) to run once in TEST mode before the switch goes on. Rewrite 5.6 to say the reporter now holds such rows and reconciliation resolves them.

- [ ] **Step 3: `crm-features.md`** — `:304` "Shipped (M7a PR-3); the pause and reconciliation ship behind `BILLING_ENFORCE` (M7a PR-4)"; `:948` rule 9: per owner question 7, "M7a's non-payment pause pass (its nightly Stripe reconciliation runs inside the usage report)" and note the vault took three.

- [ ] **Step 4: Commit** — `git commit -m "M7a PR-4: runbook for the pause and the reconciliation, BILLING_ENFORCE in .env.example, crm-features rule 9"`.

### Task 14: Final review, design review, one fix agent, gates, rollout (orchestrator)

- [ ] **Step 1: Counts from the runners, never from this plan** (PR-3's lesson): `git diff --name-only --diff-filter=AM origin/main HEAD -- apps/web packages/db | grep '\.test\.ts$'` → vitest `--reporter=json` for web, `vitest list --json` for db; e2e `test(` blocks.
- [ ] **Step 2: Final review (opus, bis-reviewer)** of `origin/main..HEAD` against this plan and the spec section 9, with every HIGH task's mutation probes re-run on a sample, plus: the five-reader scan; `decidePause` boundaries; the gates' fail-closed / route's fail-open; the allow-list audit (each `why`); the TeXML order (screen, guards, VOICE_FORWARD_TO before billing); `nextVersion` in every writer; the budget sum unchanged; the held-row send's duplicate handling.
- [ ] **Step 3: Design review (bis-design-reviewer)** on a running build: the paused banner (three audiences, en and es, the pseudo-locale +35%, 375 px, both themes, the blur fallback, focus ring on `--crit-bg`), the Billing card's paused / lifted / pause-off / mismatch states and Lift pause's Undo by keyboard, the work-queue banner, the Billing page's paused line, the styleguide specimens. Also PR-3's still-open running-build checks (Task 11 "Still open").
- [ ] **Step 4: ONE fix agent** for both reviews' findings; no re-review unless it touches a HIGH task's logic.
- [ ] **Step 5: Gates and production migration.** `pnpm check`, `pnpm --filter web build`, `pnpm --filter web test:e2e` (CI, head SHA). 0099 to production through MCP `apply_migration` ONCE (ASCII, no backslash: memory `bis-mcp-sql-escapes` does not bite), then the parity check (`docs/runbooks/ci-supabase-project.md`), BEFORE the merge (LOAD-BEARING: the build selects the new columns). Merge via squash PR (auto-merge armed on green).
- [ ] **Step 6: Turning it on (the owner, after the merge, in this order):**
  1. Leave `BILLING_ENFORCE` unset for at least one night. Read the cron log: `billingPause.wouldPause` / `wouldUnpause` should name only accounts you expect; `usageReport.reconciled` > 0 for each billed account; no `mismatched`. The work queue's billing banner shows payment-failed accounts already (it does not need the switch).
  2. Run the runbook's TEST-mode probe (S2-S4) once.
  3. Check every billed account's plan features: a plan with `voice_receptionist: false` sends that client's calls to their transfer number the moment the switch is on (owner question 5). Set each such account's transfer number first.
  4. Set `BILLING_ENFORCE=1` on Vercel **Production only**; redeploy.
  5. Rollback at any time: unset it and redeploy; every reader ignores the stamps; Lift any stamped pause from the card if you want the cards to stop saying Paused.
- [ ] **Step 7: Ledger and tracker** — `.superpowers/sdd/progress.md` lines; roadmap tracker rows (memory `bis-roadmap-tracker`); memory `bis-next-work`.

## Self-review (done while writing)

- **Spec coverage.** Flow 5: past_due stamping (PR-3, verified), banner (existing + Task 10), agency alert (Task 11), the 7-day pass (Task 4), automations + SMS stop (Task 5), read-only (Task 7), voice forward/message (Task 6), payment clears (Task 2 mirror, Task 4 heal), lift by hand (Tasks 2, 9, 11). Flow 6: canceled → pause after the period (Task 4). Section 4: nightly reconciliation + alert (Tasks 8, 11), permissions (Task 7's reader rule, Task 2's derived read), rollout behind a switch (Tasks 4, 12, 14). Section 5: Lift pause on the card, paused banner (Tasks 10, 11). Section 6: unit (Tasks 4-8), DB (Tasks 1-2), E2E (Task 12), reconciliation mismatch alert (Tasks 8, 12 S1). PR-3 Next plans (a)-(h): (a) G1 reads `past_due_since`; (b) G4 + `nextVersion` everywhere; (c) G12, G19; (d) G6, scoped; (e) G18; (f) G13; (g) G14, G15; (h) Global Constraints / S2.
- **Placeholder scan.** The two places that name a list the implementer must build (Task 7 Step 1's audit; Task 2 Step 5's local type names) say exactly what to read and how to decide; everything else carries its code or its exact strings.
- **Type consistency.** `BillingStanding` carries `subscriptionStatus` (Task 2) only for `pauseCause`; `billingVerdictFor` returns the verdict plus `cause` (Task 7), which Task 10's banner reads; `voiceBlock` values equal 0099's CHECK values and `ForwardKind`/`ScreenedReason`; `ReconciliationVerdict` equals 0099's CHECK; `liftPauseAction` returns the `liftedAt` that `undoLiftBillingPause` compares by instant.
- **Brief deviation, recorded:** the brief cites "`docs/crm-features.md` §4 rule 9"; the rule is in §3.2 (`:936`, `:948`).
