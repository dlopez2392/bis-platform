# Stripe billing: live operations

What BIS's client billing needs outside the code, how to read what it says
when something goes wrong, and the rules for touching billing by hand.

Plan: `docs/superpowers/plans/2026-09-25-m7a-pr3-checkout-webhooks-billing.md`
(Task 13, and "Execution corrections (2026-09-26)" at its end).

Audience: danlo (the Stripe and Vercel dashboards, and any hand-written change
to production data) and the orchestrator (reads of production through MCP,
Vercel logs). Every SQL statement below runs against PRODUCTION's database
(`tlbkbmlrfafquucsmsmm`), in the Supabase SQL editor. The `select`s are safe
at any time. Every `update` or `delete` here is a hand change to money data:
one row, keyed by its id, run by danlo or with danlo's go-ahead, and written
down afterwards.

**How to read the labels.** Anything this file says about how Stripe or Vercel
behaves, and that nobody here has observed, is marked **(assumption)**. Menu
names in the Stripe dashboard are Stripe's, and were not re-read when this was
written.

## Facts

| | |
|---|---|
| Webhook route | `POST https://app.bis-rgv.com/api/webhooks/stripe` (`apps/web/src/app/api/webhooks/stripe/route.ts`) |
| API version | `2026-08-26.dahlia` (`STRIPE_API_VERSION`, `apps/web/src/lib/billing/stripe-gateway.ts`) |
| Events | exactly the six in `HANDLED_WEBHOOK_EVENTS` (same file) |
| What it does with an event | verifies the signature, records the event id once (`stripe_webhook_events`), RE-READS the subscription from Stripe, and stores it on `account_billing` (`apps/web/src/lib/billing/webhook.ts`, `packages/db/src/account-billing.ts`) |
| Signing secret | `STRIPE_WEBHOOK_SECRET`, Vercel **Production only**, Sensitive. Unset or blank on a deployment, that deployment turns billing links OFF (section 1) |
| Stripe key | `STRIPE_SECRET_KEY`, the LIVE key, on Vercel Production only (`.env.example`; the app refuses a live key anywhere else) |
| Reply-to on the billing-link email | `AGENCY_SUPPORT_EMAIL`, falling back to `hello@bis-rgv.com` in code |
| CI | signs its fixture events with the public literal `whsec_bis_ci_e2e_fixture_only` in `ci.yml`'s e2e job. It verifies nothing anywhere else. **Never put it on Vercel.** Nothing in the code refuses it next to a live key. |

## 1. Live setup (once, before the first live client pays)

Do these in order, after migration 0052 is on production and before (or right
after) PR-3 merges. Until the route is deployed and steps 2 and 4 are done,
every delivery fails (404 before the merge, 503 after it) and Stripe keeps
retrying, for up to three days **(assumption, B6)**.

**Billing links stay off until the signing secret is set.** While
`STRIPE_WEBHOOK_SECRET` is unset or blank on the running deployment, every
account's Billing card says "Stripe's webhook isn't set up on this site yet, so
billing links are off", offers no Send billing link, and the send action
refuses with the same reason (`webhookSecretFromEnv`,
`apps/web/src/lib/billing/stripe-gateway.ts`). So nobody can be sent a link,
and so nobody can pay, before the webhook is able to hear about the payment.
Mark complimentary and Change plan are not affected. The secret counts as set
only on a deployment made AFTER it was added (step 4).

1. **The endpoint.** Stripe dashboard, LIVE mode → Developers → Webhooks → Add
   endpoint:
   - URL `https://app.bis-rgv.com/api/webhooks/stripe`;
   - API version **`2026-08-26.dahlia`**;
   - these six events, and no others:
     - `checkout.session.completed`
     - `customer.subscription.created`
     - `customer.subscription.updated`
     - `customer.subscription.deleted`
     - `invoice.paid`
     - `invoice.payment_failed`

   An endpoint on another API version still maps invoices, through a fallback
   in `subscriptionIdOf` **(assumption, B7)**, but pin this one anyway.
2. **The signing secret.** Copy the endpoint's signing secret (`whsec_…`) into
   Vercel → project `bis-platform` → Settings → Environment Variables →
   `STRIPE_WEBHOOK_SECRET`:
   - **Production only.** Never Preview (no production credential belongs
     there, `production-isolation.md`) and never Development;
   - marked **Sensitive**;
   - if the name already exists, **Remove it, then Add it.** "Add New" on an
     existing name silently does nothing.
3. **`AGENCY_SUPPORT_EMAIL`** on Vercel Production. It is not a secret, so do
   not mark it Sensitive. It is where a client's reply to the billing-link
   email lands ("If it runs out, reply and we'll send a new one"), and where
   the Website page's "ask us" link mails. Unset, both use
   `hello@bis-rgv.com`
   (`apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/settings/billing-actions.ts`,
   `…/[accountId]/website/page.tsx`). Either set a real address or leave it
   unset. Never leave it blank: the Website page keeps a blank value and
   renders a mail link with no address. **Open question for danlo:** does
   someone read `hello@bis-rgv.com`? Clients will reply there for a new link.
4. **Redeploy production.** An env change reaches NEW deployments only. Then
   run the usual deploy check (deployment READY on the merge sha, aliased to
   `app.bis-rgv.com`).
5. **Check the endpoint. UNVERIFIED step: read all of it before you trust
   the result.** The plan's check was to use the dashboard's "Send test event"
   for a type BIS ignores (`customer.created`) and expect 200
   `{"received":true,"outcome":"ignored"}`. Two things about that are
   **assumptions nobody has checked**:
   - the button may not exist on a live endpoint;
   - a dashboard test event may carry `livemode: false` even when sent to a
     LIVE endpoint.

   What each answer means:

   | Stripe shows | Vercel log | Meaning |
   |---|---|---|
   | 200 `{"received":true,"outcome":"ignored"}` | none | The secret is right and the event was live-mode. Done. |
   | 400 `wrong mode` | `stripe webhook: customer.created evt_… is test mode but this deployment's key is not; not recorded` | The secret is RIGHT (the signature verified). Stripe sent a test-mode event, which a live deployment refuses by design. That is acceptable. Stripe will retry this 400 for days, and each retry is refused the same way and records nothing. |
   | 400 `invalid signature` | `stripe webhook: signature did not verify (a wrong STRIPE_WEBHOOK_SECRET, or a forgery); answering 400` | The secret is WRONG. Copy it again, Remove-then-Add, and redeploy. |
   | 503 `not configured` | `stripe webhook: STRIPE_WEBHOOK_SECRET is not set; …` | The secret is missing, or production was not redeployed after it was set. |
   | 503 `stripe unavailable` | `stripe webhook: Stripe key refused here (<reason>); …` | `STRIPE_SECRET_KEY` is missing or refused on Production. |

   A test event for one of the SIX handled types carries a subscription id
   that does not exist, so the re-read fails and the answer is 500. That is
   by design, not a fault.

   If the button does not exist, the first real event is the check. Watch
   the endpoint's deliveries in Stripe and the Vercel logs when the first
   billing link is paid.

   **What the order of these steps can and cannot cost.** A MISSING secret
   can no longer leave a payer unbilled: links are off until it is set and
   deployed (above). A WRONG secret still can. The app only knows the
   variable is set, not that it matches the endpoint, so the card offers
   Send, and a client who pays is shown as Unbilled while every event
   answers 400. This step is what catches a wrong secret: do it before the
   first live billing link goes out, and if it cannot be done, watch that
   first payment's deliveries as above.
6. **Failed payments** (DECISION 7, danlo 2026-09-25). Stripe dashboard, LIVE
   mode → Billing settings: the subscription retry settings and the customer
   emails. Set exactly these:
   - **Retries:** Smart Retries, on Stripe's default schedule.
   - **After the last retry:** mark the subscription **unpaid**. Never
     "cancel the subscription": cancelling is a person's decision, and PR-4's
     pause handles access. BIS shows `unpaid` as Payment failed and keeps the
     date the first failure was seen (`past_due_since`).
   - **Customer emails:** receipts for successful payments ON, and notices
     for failed payments ON.

   Record what was set, with the date:

   | Setting | Set to | Date | By |
   |---|---|---|---|
   | Retry schedule | | | |
   | After the last retry | | | |
   | Receipt emails | | | |
   | Failed-payment emails | | | |

7. **Nothing else.** The Customer Portal configuration is created by code
   on the first Manage billing click (`apps/web/src/lib/billing/portal.ts`),
   and Checkout needs no setup.
8. **Before the first live client:** the pre-launch probe (section 7) has
   been run and recorded. **Before the first live mid-month Change plan on
   a paid account:** B4 is settled (section 8).

**Never point a TEST-mode endpoint at production.** The mode check answers
400 to every test event there, and Stripe retries each one for days.

## 2. What the webhook answers, and what each log line means

Stripe retries every answer that is not 2xx, a 400 included. Vercel's runtime
logs are the only place the reason is written down, and they are kept for a
limited time **(assumption: Vercel's retention for the plan in use)**. So read
them the same day.

| Answer | Log line (starts with) | Meaning | What to do |
|---|---|---|---|
| 200 `processed` | none | Stored. | Nothing. |
| 200 `duplicate` | none | This event id was already done. | Nothing. |
| 200 `ignored` | none | The event names no subscription (a type BIS does not handle, or a one-off payment checkout). | Nothing. |
| 200 `refused` | `stripe webhook: <type> <evt> for subscription <sub> refused: <reason>` | Stripe holds a subscription BIS will not store. | **Same day.** Section 3. |
| 400 | `stripe webhook: signature did not verify …` | A wrong or rotated `STRIPE_WEBHOOK_SECRET` (or a forgery). EVERY event fails while this lasts. | Re-copy the endpoint's secret, Remove-then-Add, redeploy. Afterwards, check section 4 for events lost meanwhile. |
| 400 | `stripe webhook: <type> <evt> is test mode but …` | The event's mode does not match the key's. | On a live endpoint, only ever a dashboard test event. Anything else means a test endpoint points at production: delete that endpoint. |
| 500 | `stripe webhook: verified but unreadable: …` | Signed by Stripe, but BIS could not read it (not JSON, or a shape the code does not expect, for example after an API version change). | Check the endpoint's API version (section 1, step 1). Otherwise, a code fix. |
| 500 | `stripe webhook: <type> <evt> failed; Stripe will retry: …` | Something failed part-way (Stripe, the database). Nothing was stamped, so the retry redoes it. | Once or twice on a first checkout: normal (below). Repeating for the same event: read the message. |
| 503 | `… STRIPE_WEBHOOK_SECRET is not set …` or `… Stripe key refused here …` | Not configured. With no secret, billing links are also off on every Billing card. | Section 1, steps 2 and 4. |

**A client's first checkout sends a burst of events at once.** One or two of
them may answer 500 with `… kept changing (3 attempts); Stripe will retry`:
the deliveries raced each other for the same new row. Stripe retries them,
and they succeed. That is normal. A 500 that keeps repeating for the same
event is not.

**Change plan logs refusals too.** `change plan: Stripe changed <sub> for
account <id>, but the mirror refused it (<reason>); the card still shows the
old plan` means Stripe HAS the new prices, but BIS will not show them. Treat
it like a refused event (section 3).

## 3. Refused events

A `refused` line means Stripe holds a subscription that BIS did not store.
**Stripe may be CHARGING a client that BIS does not bill, or billing them
twice.** Act on it the same day.

**First, open the subscription in Stripe** (the `sub_…` id in the log line).
Decide which of these it is:
- **A mistake**: made by hand in the dashboard, or a second payment. Cancel
  it and refund it in Stripe. That is the whole fix: the cancellation's own
  events are refused the same way and change nothing in BIS.
- **Legitimate**: the client should be billed on it. Fix what the reason
  names (the table below). Then make BIS read it again.

**Making BIS read it again: the correct way.** Do not just resend the event
from the dashboard. A refused event is already STAMPED as done, so the resent
copy answers `duplicate` and nothing is processed. (That assumes a resend
keeps the same `evt_` id, which has not been observed. Either way, the steps
below work.) Use one of these:

1. Clear the stamp, then resend it (Webhooks → the endpoint → the event →
   Resend):

   ```sql
   update stripe_webhook_events set processed_at = null where event_id = '<evt_…>';
   ```

   The resent event is then claimed as a retry and processed again. It
   re-reads the subscription as Stripe holds it NOW, so resending an old
   event is safe.
2. Or edit the subscription's metadata in Stripe: add or change a harmless
   key, for example `bis_recheck` = today's date. That fires a fresh
   `customer.subscription.updated` **(assumption: a metadata edit fires
   that event)**, and BIS re-reads the subscription. **Never edit
   `bis_account_id`.**

What each reason means (`MirrorRefusal`, `packages/db/src/account-billing.ts`):

| Reason | What happened | Charging? | What to do |
|---|---|---|---|
| `no_account` | The subscription has no `bis_account_id` metadata (or it is not an id). BIS's Checkout always sets it, so this one was not made by BIS. | Possibly. | If it is a BIS client's by mistake, cancel and refund it. If it belongs to something else in the same Stripe account, ignore it. |
| `unknown_account` | `bis_account_id` names no account: the account was deleted, or the id was typed by hand. | Possibly. | If the account was deleted on purpose, cancel the subscription in Stripe. |
| `customer_mismatch` | The account has no billed row yet, and the subscription is not on the customer of the account's pending billing link. For example, a subscription made by hand with a guessed `bis_account_id`, or a link row deleted by hand before the client paid. | Yes, if it is active. | Usually cancel and refund it, then send a new billing link. Do not hand-write `billing_links` or `account_billing` rows to force it through. If it must be kept, ask the orchestrator. |
| `customer_changed` | The account is billed on customer A, and this subscription is on customer B. An account's customer never changes (section 5.1). | Yes, if it is active. | A mistake: cancel and refund. If the customer genuinely has to change, follow section 5.1 first, then make BIS read it again. |
| `another_live_subscription` | The account already has a subscription that has not ended, and this is a different one: live, or one that started after the stored one. It is NEVER an old subscription that has ended (that is `ended_other_subscription`, next row). **The client may be paying twice.** | Yes: both. | Decide which subscription is right, and cancel and refund the other in Stripe. If the NEW one is right: cancel the old one first (its cancellation is stored), then make BIS read the new one again. |
| `ended_other_subscription` | A late event for an OLD subscription that has already ended (canceled, or expired before its first payment), older than the one stored, whether the stored one is live or has ended too. | No: it has ended. | Nothing. It is a stale event. BIS decided it from Stripe's own re-read of the subscription, so the subscription really has ended. Do not refund anything because of this line: its last invoice may be a legitimate final one. |
| `unknown_plan` | The subscription's base price does not name a BIS plan (`bis_plan_id` in the price's metadata). Someone changed its prices in Stripe to prices BIS did not make. | Yes, at those prices. | Put the plan's own prices back in Stripe, or cancel. The edit itself fires a new `customer.subscription.updated` **(assumption)**, so no reset is needed. |
| `plan_other_agency` | The plan belongs to another agency. That cannot happen with one agency. | Possibly. | Stop and ask the orchestrator. |
| `unknown_status` | Stripe returned a subscription status BIS does not know (a new one). | Possibly. | A code change (`SUBSCRIPTION_STATUSES`). Ask the orchestrator. |

## 4. Events Stripe gave up on

Stripe stops retrying an event after about three days **(assumption, B6)**.
Until PR-4's nightly reconciliation exists, nothing in BIS notices. Look for
lost events after any run of 500s, 503s or signature failures, and weekly
until PR-4 lands. There are two kinds:

1. **Claimed but never finished.** BIS recorded the event, then failed before
   stamping it. Its row is still unstamped:

   ```sql
   select event_id, type, received_at
   from stripe_webhook_events
   where processed_at is null and received_at < now() - interval '1 hour';
   ```

   (The hour leaves out events that are still being processed or retried.)
   Resend each one from the dashboard. It is claimed as a retry and
   processed.
2. **Never claimed.** Every 503, every 400, and every delivery that arrived
   while the database was down. BIS has NO row for these, so only Stripe's
   list of failed deliveries for the endpoint shows them. Resend them from
   there, while Stripe still lists them.

Both routes re-read the subscription as Stripe holds it NOW. For a
subscription whose events were all lost, one metadata edit (section 3,
option 2) brings it up to date just as well.

## 5. Rules for changing billing by hand

### 5.1 An account's Stripe customer never changes once it is billed

Once `account_billing` holds a customer, that customer belongs to the account
for good. The webhook refuses a subscription on any other customer
(`customer_changed`), and Send always reuses the stored one.

If the customer MUST change (for example, it was deleted in Stripe), settle
first:

1. **The account's usage is all reported.** Anything reported after the
   change is billed to the new customer. This must return 0:

   ```sql
   select count(*)
   from usage_events u
   join account_billing b on b.account_id = u.account_id
   where u.account_id = '<account id>'
     and u.reported_at is null
     and u.occurred_at >= b.billing_started_at
     and u.occurred_at >= now() - interval '34 days';
   ```

   If it does not return 0, wait for the usage report (it runs every 15
   minutes), then check again.
2. Know that usage Stripe already holds under the OLD customer stays there,
   including rows stamped as duplicates (the A11 fix, #146). None of it
   moves to the new customer.
3. Change the customer by SQL, in one statement keyed by `account_id`, that
   ALSO moves `updated_at` forward. `updated_at` is the version the webhook
   compares before it writes (B5). An edit that leaves it unchanged can be
   overwritten by a delivery that read the row before the edit.

   ```sql
   update account_billing set stripe_customer_id = '<cus_new>', updated_at = now()
   where account_id = '<account id>';
   ```

   Any other hand edit of `account_billing` follows the same rule.
4. If the account has a `billing_links` row, follow 5.3 to remove it, then
   send a new billing link.

### 5.2 Correcting a client's billing email address

Stripe sends its receipts and failed-payment notices to the CUSTOMER's email.
Checkout does not overwrite it **(assumption, Stripe's docs)**, and the
portal cannot edit it (DECISION 3). Send billing link handles this:
- **Not billed yet:** send the link again to the right address. A different
  address gets a NEW customer, and the old link's session is expired first.
  The unused old customer is harmless.
- **Billed before** (a canceled client coming back): the one customer stays,
  and its email is changed to the new recipient before the new link is made.
- **Billed now, with a live subscription:** Send refuses ("already has a
  subscription"). Change the customer's email in the Stripe dashboard
  directly. That changes the address, not the customer, so it is allowed.

### 5.3 Before deleting a `billing_links` row, expire its Checkout session

A deleted row whose session is still open leaves a link the client can PAY
that nobody in BIS can see. So first:

1. Look up the session: `select checkout_session_id, stripe_customer_id,
   expires_at from billing_links where account_id = '<account id>';`
2. Open that `cs_…` session in Stripe.
   - **Open:** expire it (Stripe dashboard, or
     `POST /v1/checkout/sessions/<cs_…>/expire`).
   - **Complete:** the client paid on it. Do not delete the row while that
     payment's subscription is still on its way to BIS. If it is a leftover,
     follow 5.5 instead.
   - **Expired:** nothing to do.
3. Only then:

   ```sql
   delete from billing_links where account_id = '<account id>' and checkout_session_id = '<cs_…>';
   ```

### 5.4 A link whose session Stripe no longer knows

Send billing link and Mark complimentary both ask Stripe about the account's
stored session before they do anything. If Stripe answers that the session
does not exist (`resource_missing`), both refuse, every time:
- Send answers "Stripe didn't accept that. Nothing was charged. Try again in a
  minute." and logs `billing link: Stripe refused for account <id>:
  StripeInvalidRequestError code=resource_missing …`;
- Mark complimentary answers the same and logs `mark complimentary: could not
  confirm session <cs_…> is dead for account <id>: … code=resource_missing …`.

Trying again never helps. This happens when the row was written under
another Stripe account or mode (a key swapped to another account, say). The
fix:

1. In the Stripe dashboard, in the mode and account the Production key
   belongs to, search for the `cs_…` id. If Stripe DOES find it, this is
   not the case: the fault is the key or the mode, so stop and check
   `STRIPE_SECRET_KEY`.
2. Check that the link's customer (`billing_links.stripe_customer_id`) has no
   subscription in Stripe. If it has one, go to section 3 instead.
3. If the row came from ANOTHER Stripe account, and you still have access to
   it, expire the session there: it may still be payable in that account.
   In this account there is nothing to expire.
4. Delete the row (the `delete` in 5.3).
5. Send a new billing link.

### 5.5 "This client already finished checkout" that does not go away

Send billing link and Mark complimentary both refuse while the account's
stored link points at a session Stripe calls complete. Normally the webhook
stores the subscription within a minute and removes the link, and the message
goes away. If it is still there after a few minutes:
1. Look up the session (5.3, step 1) and, in Stripe, the subscription that
   session made.
2. If the webhook REFUSED that subscription (Vercel logs), go to section 3
   first.
3. If that subscription has ended, or is already the one stored on the
   account and the link row stayed anyway, the row is a leftover. Delete it
   (the `delete` in 5.3): a completed session cannot be paid again
   **(assumption)**. Then Send.

### 5.6 A usage row resent more than 24 hours later may be counted twice

Stripe keeps a meter event's identifier unique only "within a rolling period
of at least 24 hours" **(assumption, B10: Stripe's docs, not re-read)**. Before
M7a PR-4's reconciliation, the usage report resent any unreported row no
matter its age, so a send that landed at Stripe but was never stamped could be
counted twice if it was resent after that window.

**With `BILLING_ENFORCE` on (PR-4, section 9):** the usage report no longer
blindly resends an old row. It only STOPS handing a row to the reporter once
it is 20 hours old (`USAGE_HOLD_AFTER_MS`) — the nightly reconciliation
(section 9.9) is what resolves it from there, by comparing BIS's held usage
against Stripe's own meter total for the period: it stamps a held row Stripe
already counts (`held_at_stripe`), or sends it with the SAME identifier and
then stamps it (`held_missing`), never a blind resend. So with the switch on,
the double-count this section used to guard against cannot happen from an
ordinary day's delay. The one case reconciliation only REPORTS and does not
resolve on its own — a held row from a period that has already closed — is
section 9.11.

**With `BILLING_ENFORCE` off** (before rollout, or after a rollback, section
9.12): the usage report is PR-3's behaviour, and the tripwire below is the
only protection.

The tripwire (switch off only) is the Work page's banner: "Usage for N
client(s) hasn't reached Stripe in over a day …". The usage report logs the
account ids: `usage report: usage unreported for over 24 hours on N billed
account(s): <ids>`. **While that banner shows, with the switch off:** before
each affected client's Stripe invoice finalises, open the upcoming invoice by
hand. Compare its usage quantities with the client's Billing card for the same
period. If Stripe's number is higher, the difference was counted twice, so
correct the invoice in Stripe before it finalises **(how Stripe lets a draft
invoice be corrected was not re-read)**.

A separate line, `usage report: N unreported usage row(s) of billed accounts
are older than Stripe accepts (34 days); they will never be billed`, is lost
revenue, not a double charge, whichever way the switch is set.

### 5.7 The portal configuration: do not edit or deactivate it

Manage billing uses a portal configuration BIS creates itself, tagged
`bis_portal` in its metadata (`apps/web/src/lib/billing/portal.ts`). It allows
exactly card updates and invoice history (DECISION 3).
- **Edited in the dashboard** (for example, self-cancel switched on): BIS
  notices, stops using it, logs `portal: configuration <id> is tagged … no
  longer match …`, and creates a new one on the next click. The edited one
  stays in Stripe, unused.
- **Deactivated within 24 hours of BIS creating it:** Manage billing
  breaks for EVERY client until that 24 hours is over. BIS lists only active
  configurations, so it tries to create one again, under the same key as the
  first creation. Stripe then replays the first answer, which names the
  deactivated configuration **(assumption: Stripe's 24-hour idempotency
  window, and that a portal session on an inactive configuration is
  refused)**. Fix it by reactivating the configuration, or wait out the 24
  hours. After that window, deactivating one simply makes BIS create a new
  one.
- If the very first creation in a mode fails with a Stripe 500, Stripe may
  replay that 500 for 24 hours, so Manage billing fails for everyone until
  then **(assumption, same source)**.

### 5.8 Before creating a subscription by hand, expire the account's open billing link

Prefer Send billing link. If a subscription must be made in the Stripe
dashboard instead, first expire any open billing link for that account
(5.3, steps 1 and 2: look up the session, and expire it if it is open).

Why: when BIS stores a subscription on the link's customer that started after
the link was sent, it CONSUMES the link. That only deletes the `billing_links`
row (`mirrorSubscription`, `packages/db/src/account-billing.ts`); it never
expires the Checkout session at Stripe. So a subscription made by hand would
make the link disappear from the card while the emailed session stays
payable. If the client then pays it, they hold two subscriptions, the second
is refused as `another_live_subscription`, and **the client pays twice**.

## 6. Changing plan on a paid account

Change plan applies NOW, with Stripe's proration (DECISION 2). What that
means in money rests on **B4, which is UNVERIFIED**: that the base price is
prorated, and that the WHOLE period's usage is priced at the NEW plan's
metered prices at the end of the period. **Do not use Change plan on a paid
live account in the middle of a period until B4 is settled (section 8).**
Changing a complimentary account's plan touches only BIS's database and is
unaffected.

## 7. Pre-launch probe (TEST mode, once, before the first live client)

Mark complimentary's handling of a link that is dead in BIS but may still be
open at Stripe (`settleDeadLink`, `…/settings/billing-actions.ts`) rests on
two Stripe behaviours that the e2e cannot see. It never drives Stripe's hosted
page (`apps/web/e2e/billing.spec.ts` reports both as "NOT observed"):
- **X1 (completed):** Stripe refuses to expire a session that has been
  COMPLETED (paid);
- **X2:** once Stripe accepts an expire, the session can never be paid,
  including a payment already waiting on a 3-D Secure challenge.

Run this in **TEST mode only**, with the TEST secret key (Stripe Workbench's
shell, or `curl`), never the live key. Use any test-mode price in a
subscription-mode session, for example:
`POST /v1/checkout/sessions` with `mode=subscription`,
`line_items[0][price]=<test price>`, `line_items[0][quantity]=1` and
`success_url=https://example.com/done`.

1. **X1 on a completed session.** Create a session and open its `url`. Pay
   with card `4242 4242 4242 4242` (any future date, any CVC). Then call
   `POST /v1/checkout/sessions/<cs_…>/expire`. Record the error's type, code
   and message. Expected: an invalid-request error saying the session is not
   open **(assumption)**.
2. **X2 on a payment held in 3-D Secure.** Create a new session and open it.
   Pay with Stripe's always-authenticate test card `4000 0027 6000 3184`
   **(from Stripe's testing docs; not verified here)**. When the 3-D Secure
   challenge appears, STOP, and do not answer it. Expire the session through
   the API. Then complete the challenge. Record:
   - whether the payment went through;
   - the session's status afterwards;
   - **whether a subscription appeared on the session's customer.**
3. Record the results here:

   | Probe | Date | By | Result |
   |---|---|---|---|
   | X1, expire a completed session | | | |
   | X2, expire during 3-D Secure, then complete it | | | |

If a result contradicts the assumption, update `settleDeadLink`'s comment in
`billing-actions.ts`. If X2 FAILS (a subscription appears after the expire),
stop before the first live client and tell the orchestrator. That result
means:
- Mark complimentary's "open → expire → mark" is unsafe, and must refuse
  while a session is open instead;
- Send's expiry of an earlier link is not a guarantee either, so
  `another_live_subscription` (section 3) becomes a case to expect.

## 8. Settle B4 before the first live mid-month Change plan

On a Stripe TEST clock:
1. A customer on the clock, subscribed to plan A (base price plus the three
   metered prices), with some metered usage reported.
2. Mid-period, swap each item's price to plan B's in place, with
   `proration_behavior: create_prorations`. That is what Change plan does
   (`updateSubscriptionPrices`, `apps/web/src/lib/billing/stripe-gateway.ts`).
3. Advance the clock past the end of the period, and read the invoice.

B4 holds if the base price is prorated and the whole period's usage is priced
at plan B's metered prices. If it does not hold, a small follow-up plan (a
switch at the next billing date, or subscription schedules) comes before any
live mid-month Change plan. Record the result:

| Date | By | Base price | Metered usage priced at | B4 holds? |
|---|---|---|---|---|
| | | | | |

## 9. The pause and the nightly reconciliation (M7a PR-4)

Plan: `docs/superpowers/plans/2026-10-26-m7a-pr4-pause-and-reconciliation.md`
(sections "Owner decisions", "Spec gaps resolved here" G1-G22, Task 13). Spec:
`docs/superpowers/specs/2026-09-24-m7a-client-billing-design.md`, sections 3
flows 5-6, 4, 5, 9.

Everything in this section is read, written and enforced through ONE switch,
`BILLING_ENFORCE` (`apps/web/src/lib/billing/enforce.ts`), exactly `"1"` to
turn on, `.env.example`. **Vercel Production only. Needs a redeploy** — an env
change reaches new deployments only, same as every other var in this file.

**Turning it off is the whole rollback**, with two deliberate exceptions that
stay on either way: the webhook mirror keeps stamping `stripe_checked_at` on
every write, and keeps clearing `billing_paused_at` the moment Stripe reports
`active` or `trialing` (both harmless — a correct clear, and a stamp nothing
reads with the switch off). With the switch off: nothing is paused, held,
stopped, forwarded, closed or made read-only because of billing; the usage
report does not hold old rows (section 5.6); the nightly step (this section)
does not run at all; the pause pass (below) writes nothing, only counts what
it would do.

### 9.1 What pauses, and when

A billed, non-complimentary account pauses when:
- it has been `past_due` or `unpaid` for **7 days** (`past_due_since`), it has
  not been Lifted for this stretch, **and** Stripe has CONFIRMED the unpaid
  status both AFTER the 7 days ended and within the last **26 hours**
  (`stripe_checked_at`); or
- its subscription is `canceled` and the paid period it already covers has
  ended (`current_period_end`, or no end at all).

**The freshness rule's bound, stated precisely (G6): not "never a wrong
pause", but this bound.** A client who pays after Stripe's LAST confirming
read, whose `invoice.paid` webhook delivery then fails, can stay paused until
Stripe's own webhook retry succeeds or the next nightly re-read confirms it —
whichever comes first, at most about 24 hours plus one tick. See 9.8 for what
to do about it right now instead of waiting.

A row with no subscription, a complimentary row, and `incomplete` /
`incomplete_expired` never pause — they stay as an unbilled account would
(0051's own CHECK forbids a complimentary row carrying a pause). Nothing here
touches Stripe's dunning (section 1, step 6) or releases a phone number,
ever — not on pause, not on day 30, not on cancellation.

### 9.2 What stops while paused, and what does not

**Stops:** Sofía answering (9.4); texts to the business's CUSTOMERS (every SMS
kind except the owner's own alerts and the STOP/START/HELP replies, which
still send); automations due during the pause (held, not dropped — 9.3); the
website chat (every entry point answers as a switched-off chat does, 404); AI
record summaries (the route answers "none" to every caller, cached or not);
every CLIENT server action under `/dashboard/accounts/<id>/` except a short,
pinned allow-list that writes nothing (Manage billing — the way to pay — the
shell's read-only snapshot poll, and marking a conversation read).

**Keeps going:** the public booking page and its forms, and their email
receipts; inbound email and SMS (recorded, not answered by Sofía); the
STOP/HELP/START replies; the agency's own alerts; the weekly report; the
production demo on `bis-rgv.com` (never billed); every action the agency
itself takes. A plan with no receptionist or no website chat is enforced the
same way, with no payment pause involved.

**A plan without Sofía or the website chat** is enforced through the exact
same read, whether or not the account has ever been paused: `voice_receptionist:
false` or `web_concierge: false` on the account's CURRENT plan switches that
feature off the moment the switch goes on (9.5 step 3 below — check transfer
numbers FIRST).

**Two known limitations, carried as written, not bugs to chase:**
- **No timeout on the TeXML billing read.** The call-answering route's own
  `account_billing` read (`readBillingStanding`) starts in parallel with the
  spam-cap counts and is awaited before the dial document is built, but it
  carries no timeout of its own (unlike the AI summary gate's 3-second
  `GATE_TIMEOUT_MS`). A slow database read — not a slow Stripe call, there is
  none here — delays answering the call by however long that read takes, with
  no cap, though a read that THROWS still answers at once (fail open, G9). If
  call pickup ever gets slow, check this read before anything else.
- **A paused account in "Closed today" or "Storm" still forwards** to its
  transfer number in the first 30 days of the pause, exactly like any other
  cleared call: the TeXML route never reads S-47d's business-status (plan
  M13, accepted on purpose).

### 9.3 Automations: held, not dropped

A send due during a pause is HELD (the closure hold's own shape), not
dropped, and not refused with a sentence:
- **The hold sits on a fixed grid.** `held_until` is the earlier of the
  subject's own deadline and the next WHOLE HOUR (UTC). A pause already in
  force short-circuits before either send gate is asked.
- **A stale one still drops**, with "Not sent: it was no longer timely when
  the account's pause ended" — each automation recipe's own existing max-age
  window (review request, referral ask, no-show nudge, quote follow-up each
  have one; reactivation has none and relies on its own release re-check).
- **Release:** still paused → held again; the pause lifts (paid, or Lift
  pause) → every held row of the account goes within the hour (Lift bumps
  them immediately); switch off → sent as normal.
- The one SEND that is refused outright, never held, is the staff document
  request by text (`automations.reason.billingPaused` on the Activity page) —
  it is a person's own action in the moment, not a scheduled automation.

### 9.4 The 30-day rule and the work-queue item

**`PAUSE_FORWARD_MS` = 30 days (I7).** For the first 30 days of a pause, a
CLEARED call that cannot reach Sofía still rings the business at its own
transfer number, recorded on `forwarded_calls` with kind `billing-paused` (or
`plan-no-voice` for a plan with no receptionist, which forwards with no time
limit — only a PAUSE ever stops forwarding). From day 30 on, or with no usable
transfer number at any point, the caller hears a short message instead
("Thanks for calling. No one can take your call right now. Please call back
later." / its Spanish twin) and the call is recorded on Screened calls with
the same reason. **The phone number itself is never released, automatically or
otherwise — not on day 30, not ever.**

The agency sees this coming on the work queue (`/dashboard/work`), a line
"Paused 30+ days, calls are no longer forwarded:" naming the account, from day
30 through day 44 (switch off: the account stays under the plain "Paused:"
line to day 44 instead, since nothing is or is not forwarding with the switch
off); after day 44 the account leaves the banner on its own — its Billing card
still says Paused, and still carries its own "Calls are no longer forwarded…"
line, for as long as it stays unpaid.

**Owner note: a first-time caller still hears the press-1 spam screen
FIRST**, ahead of either the forward or the call-back message, on every
account, paused or not (`lib/voice/call-screen.ts`). Only once a caller has
pressed 1 (or is calling a SECOND time, so their number has history) does the
route ever reach the billing block. Testing a paused account's call behaviour
from a number that has never called it before will show the "press 1" prompt
first, every time — that is correct, not a sign the pause is not working; call
again from the same number (or set `VOICE_SCREEN_ALWAYS_FROM` /
`VOICE_SCREEN_NUMBERS`, `.env.example`'s own voice-screening vars, for a
repeatable test) to reach the forward or the message.

### 9.5 Turning it on (the owner, after the merge, in this order)

**Prerequisite, the owner's own step, done once, well before this:** the LIVE
`STRIPE_SECRET_KEY` and the live endpoint's `STRIPE_WEBHOOK_SECRET` are set on
Vercel Production (section 1) and the failed-payment settings there (Smart
Retries, mark unpaid, never cancel) are the ones recorded in section 1 step 6.
Nothing below substitutes for that — `BILLING_ENFORCE` turns on what BIS does
with a row Stripe already reports; it does not make Stripe report anything.

1. **Leave `BILLING_ENFORCE` unset for at least one night.** Read the cron
   log: `billingPause: would pause account <id>` / `billing pause (switch
   off): would unpause account <id>` and the `unconfirmed` line name only
   accounts you expect. With the switch off nothing re-reads Stripe nightly,
   so a past-due account mostly logs as `unconfirmed` (its stamp is only as
   fresh as the last webhook) — that is expected, not a fault. The work
   queue's "Payment failed:" line already shows these accounts today.
2. **Run the TEST-mode probe below (9.13) once**, in TEST mode, before
   trusting day counts and invoice timing against a real client.
3. **Check every billed account's plan features and transfer numbers BEFORE
   step 4.** The moment the switch goes on, a plan with `voice_receptionist:
   false` sends that account's calls to its OWN transfer number at once (not
   a pause — a plan gate, 9.2). Set each such account's transfer number first,
   or its calls get the "please call back" message instead (9.4) the instant
   the switch flips.
4. **Set `BILLING_ENFORCE=1` on Vercel Production only; redeploy.** Confirm
   the deployment's meta names the merge SHA before relying on it (the
   platform agent's usual deploy check).
5. **The real test call — do this once, immediately after step 4, before
   trusting the switch with a real paying client's calls.** The switch gates
   the WHOLE read (9.2): with it unset, a call never consults
   `billing_paused_at` at all, so none of this can be rehearsed before step 4
   — only right after it, on an account you control.
   1. Pick ONE account with its OWN working phone number that you can afford
      to have paused for a few minutes — never `Test Client One`, never a live
      paying client. Record its current row so it can be put back exactly:
      ```sql
      select billing_paused_at, pause_lifted_at, past_due_since, updated_at
      from account_billing where account_id = '<account id>';
      ```
   2. Stamp it paused by hand, moving `updated_at` forward with it (every
      writer does; a hand edit follows the same rule, section 5.1):
      ```sql
      update account_billing set billing_paused_at = now(), updated_at = now()
      where account_id = '<account id>';
      ```
   3. With that account's Settings transfer number SET, call its number TWICE
      from the same caller number (the first call answers the press-1 screen,
      9.4's owner note). Expect the SECOND call to ring the transfer number,
      and a new `forwarded_calls` row, kind `billing-paused`.
   4. Clear the transfer number, call again from the same number: expect the
      short "please call back" message and a new `screened_calls` row, reason
      `billing-paused`.
   5. Push the pause back past 30 days and put the transfer number back:
      ```sql
      update account_billing set billing_paused_at = now() - interval '31 days', updated_at = now()
      where account_id = '<account id>';
      ```
      Call again: expect the "please call back" message EVEN THOUGH a
      transfer number is set (I7 — only the first 30 days forward), and a
      `screened_calls` row.
   6. Put the row back exactly as recorded in step 1 above, moving
      `updated_at` forward again:
      ```sql
      update account_billing set billing_paused_at = <original value or null>, updated_at = now()
      where account_id = '<account id>';
      ```
6. **Read the next night's cron log** (9.6): `usageReport.reconciled` should
   be greater than 0 for every billed account, and `usageReport.mismatched`
   should be 0. Anything else, read 9.9 before doing anything by hand.
7. **Rollback (required steps, M4) — first, the held usage; then unset
   `BILLING_ENFORCE` and redeploy.** With the switch off the usage report
   stops HOLDING: every usage row still held is resent on the next tick. A
   row Stripe already has, resent more than 24 hours after its first send, is
   past Stripe's identifier dedupe (assumption S7, section 5.6) and is BILLED
   TWICE. So BEFORE you unset it, list every account, meter and window whose
   newest check is ambiguous or held:
   ```sql
   select distinct on (account_id, meter) account_id, meter, window_start, window_end,
          bis_held, stripe_total, verdict, checked_at
   from billing_reconciliations
   where verdict in ('ambiguous', 'held_at_stripe', 'held_missing')
   order by account_id, meter, checked_at desc;
   ```
   For each, open that customer's invoice in Stripe and decide its held rows
   by 9.11's method: stamp the ones Stripe already counts (so they are never
   resent), and leave unstamped only the ones it genuinely lacks. Only then
   unset the switch. Every reader ignores the stamps at once; held automations
   go out within the hour; the usage report stops holding; the nightly step
   stops running. Then
   run 9.12's ONE SQL statement, so no card still says Paused and no stale
   stamp re-enforces the moment the switch comes back on. **Do not use Lift
   pause for this** — a Lift stamp would stop those accounts re-pausing for
   the SAME unpaid stretch, which is not what a rollback means.

### 9.6 Reading the cron log

**The pause pass (`billingPause`), every tick, switch either way:**
- `billing pause: paused account <id>` / `billing pause: cleared the pause of
  paid account <id>` — a real write, switch on only.
- `billing pause (switch off): would pause account <id>` / `would unpause
  account <id>` — switch off; counted as `wouldPause` / `wouldUnpause`.
- `billing pause: account <id> is past the grace but Stripe has not confirmed
  it since; not paused this tick` — counted `unconfirmed`, logged with
  `console.log` (an everyday line, not an error) every tick until the nightly
  re-read or the next webhook confirms it.

**The nightly step (runs inside `usageReport`, switch on only):**
`remirrored`, `reconciled`, `mismatched`, `heldStamped`, `heldSent`,
`reconcileFailed`, `reconcileSkippedBudget`. An alerting verdict is always
logged with `console.error`:
```
billing nightly: <meter> for account <id>[ (closed period)] is <verdict>:
Stripe <n>, BIS settled <n>, in flight <n>, held <n> (window <start> to <end>)
```
`reconcileSkippedBudget` above 0 most nights means the 60-second budget ran
out before every account was reached — not a fault by itself (the next tick
resumes whatever a tick's budget did not reach, section 9's own `nightlyRunStart`
rule), but rising night over night is worth a look.

### 9.7 Lift pause and its Undo

**Lift pause** (the Billing card, agency only) clears the pause at once and
stamps `pause_lifted_at = now()`; it bumps every held automation of the
account so they go on the NEXT tick, not the next release window. **Undo**
restores the EXACT pause the Lift cleared (its own start, so the 30-day
forward clock does not restart) — but only while the row still carries that
same lift stamp and is still unpaid or ended; otherwise Undo says the billing
changed underneath it and does nothing. Neither writes directly against
`account_billing` by hand; always use the card.

### 9.8 "A client paid but is still paused"

**The ordinary case.** The webhook's own re-read clears the pause the instant
Stripe reports `active` or `trialing`. If that one delivery is lost, the
nightly re-read (9.1's bound) catches up within about a day. **To clear it AT
ONCE instead of waiting**, Lift pause from the card (9.7) — this is the
intended way to short-circuit the wait, not a workaround.

**A narrower case the nightly re-read does NOT catch (G6 note).** The nightly
step re-reads only the subscription id ALREADY stored on the row
(`account_billing.stripe_subscription_id`) — it never discovers a DIFFERENT
one on the same customer. If the client's old subscription ended and they
started a brand NEW one (a new `sub_…` id), and the webhook for THAT new
subscription is lost, the nightly re-read keeps confirming the OLD (now
ended) subscription forever, and the pause sits. Tell this case apart by
checking the client's Stripe customer directly: if it holds a LIVE
subscription with a DIFFERENT id than the one `account_billing` has, use
section 3's remedy (resend the event, or the metadata-edit trick) on THAT
new subscription's events, not the old one's. Lift pause clears the ACCESS
either way, but the row will not reflect the new subscription until BIS reads
it.

### 9.9 Each reconciliation verdict, and what to do

Find the newest mismatches:
```sql
select account_id, meter, window_start, window_end, bis_settled, bis_in_flight,
       bis_held, stripe_total, verdict, checked_at
from billing_reconciliations
where verdict <> 'match'
order by checked_at desc;
```

| Verdict | What it means | What to do |
|---|---|---|
| `match` | Stripe's total is inside what BIS settled (plus what is still in flight). | Nothing. |
| `held_at_stripe` | BIS had held this usage past 20 hours, but Stripe's total already counts it. | Nothing — the nightly step stamps it `reported_at` itself. |
| `held_missing` | BIS had held this usage past 20 hours, and Stripe's total does NOT count it. | Nothing — the nightly step sends it with the ORIGINAL identifier (so a later "duplicate" answer still only stamps it, never double-counts) and stamps it. |
| `stripe_over` | Stripe's total is HIGHER than everything BIS can account for, held rows included. | Check the account's draft invoice BEFORE it finalises (S8, 9.10) and credit the difference if it is real. |
| `stripe_under` | Stripe's total is LOWER than BIS settled alone. Stripe dropped an event it accepted (assumption A12: a 200 from `meterEvents.create` means RECEIVED, not that it will bill). | A manual invoice item for the difference, or accept the loss — an owner decision, not automatic. |
| `ambiguous` | The held and non-held ranges overlap, or Stripe's total is a non-integer, or it falls strictly between the two ranges. | Compare `usage_events` for the account, meter and window against Stripe's own `listEventSummaries` for the same window, by hand. |

**A false `ambiguous` from a held send split across ticks.** The nightly
step sends a `held_missing` window's held rows one at a time, each only while
its worst case still fits the budget; when the budget runs out midway, the
rest wait for the next tick. Until the next NIGHT re-checks that window,
Stripe counts some of its held rows and not others — exactly the partial set
the comparison refuses to decide — so a check in between reads `ambiguous`.
Before working an `ambiguous` row by hand, wait for the next night's check of
the same window: if the remaining rows went out, it reads `match` (or
`held_at_stripe`) on its own.

### 9.10 A closed-period mismatch (S8)

Stripe finalises a period's invoice about an hour after the period ends
**(assumption, Stripe's docs, not re-read)**. The nightly step compares a
just-closed period once, on the first night after it closes — usually AFTER
that invoice is already final, so this comparison REPORTS a mismatch, it
cannot prevent one. If it shows `stripe_over` or `stripe_under` on a closed
period (the row's `window_end` is before the account's current period
started), credit or adjust the FINAL invoice directly, the same as any other
mismatch (9.9) — there is no draft left to fix.

### 9.11 A held row from a closed period (G15)

The nightly step only ever REPORTS a held row from a period that has already
closed — it never sends or stamps one, because that period's invoice is
already final (9.10) and a late send could land on the wrong bill. A person
decides. Find them:
```sql
select r.account_id, r.meter, r.window_start, r.window_end, r.verdict, r.bis_held
from billing_reconciliations r
where r.verdict in ('held_missing', 'held_at_stripe')
order by r.checked_at desc;
```
Then the rows themselves, for one account and meter and window:
```sql
select id, quantity, occurred_at, created_at
from usage_events
where account_id = '<account id>' and meter = '<meter>'
  and reported_at is null
  and occurred_at >= '<window_start>' and occurred_at < '<window_end>';
```
Decide by comparing them with the closed invoice (already final, 9.10): if
the usage is already billed (`held_at_stripe`-shaped), stamp it so it stops
showing as held and is never resent by mistake; if it genuinely never reached
Stripe and belongs on a later, manual invoice item instead, stamp it anyway
once that is settled (stamping only means "do not try to send this again"):
```sql
update usage_events set reported_at = now(), updated_at = now()
where id = '<id>' and reported_at is null;
```

### 9.12 Rollback: clearing every pause stamp

First the held usage (9.5 step 7's list, BEFORE the switch goes off: with it
off, every held row is resent, and one Stripe already has bills twice past its
24-hour dedupe). After unsetting `BILLING_ENFORCE` and redeploying, run this ONCE
through MCP, against production, to clear every stamp the pause left behind —
otherwise no card can be trusted ("Paused" may be stale) and turning the
switch back ON would re-pause every account still genuinely past due, with no
record of when:
```sql
update public.account_billing
set billing_paused_at = null,
    updated_at = greatest(clock_timestamp(), updated_at + interval '1 millisecond')
where billing_paused_at is not null;
```
`updated_at` moves strictly forward even when a stored value is somehow ahead
of the clock (the same `nextVersion` rule every other billing writer follows,
section 5.1), so no delivery in flight can silently overwrite this clear. This
statement deliberately writes NO `pause_lifted_at` — it is a rollback, not a
Lift, so the same accounts pause again, correctly, the first night after the
switch goes back on.

### 9.13 The TEST-mode probe (S2, S3, S4, S8) — run once before 9.5 step 4

On a Stripe TEST clock (same approach as section 8's B4 probe), never the
live key:
1. **S2 — Smart Retries past day 7.** A subscription with a card that fails
   every charge. Advance the clock a day at a time through day 7 and past the
   last scheduled retry. Record the subscription's `status` each day: expect
   `past_due` through the retries, then `unpaid` once they are exhausted
   (never an automatic `canceled`, section 1 step 6).
2. **S3 — a canceled subscription's period end.** Cancel a live test
   subscription immediately (not "at period end"). Read
   `items.data[].current_period_end` right after: expect it to still be the
   END of the period already paid for, in the future — not now.
3. **S4 — usage with no live subscription.** On that now-canceled customer,
   send one metered event (`meterEvents.create`). Expect Stripe to accept it
   (200) and the upcoming invoice preview for that customer to show no charge
   for it (nothing to bill without a live subscription).
4. **S8 — when a period's invoice finalises.** Advance the clock past a
   period's end on a live test subscription. Read the resulting invoice's
   `finalized_at` and compare it with the period's own end. Record how long
   after.

Record the results here:

| Probe | Date | By | Result |
|---|---|---|---|
| S2, past_due then unpaid | | | |
| S3, canceled period end | | | |
| S4, usage with no subscription | | | |
| S8, invoice finalized_at vs period end | | | |

If S2 or S3 contradicts what is written above, stop before turning
`BILLING_ENFORCE` on and tell the orchestrator: `decidePause` (Task 4,
`apps/web/src/lib/billing/standing.ts`) is written against exactly these two
behaviours. If S4 contradicts it, the usage report's own DECISION 7-era
assumption (A17 in the PR-2 plan) needs the same re-check. S8 cannot fail —
it only tells you how early 9.10 starts mattering for a given account.
