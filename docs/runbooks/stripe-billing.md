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
| Signing secret | `STRIPE_WEBHOOK_SECRET`, Vercel **Production only**, Sensitive |
| Stripe key | `STRIPE_SECRET_KEY`, the LIVE key, on Vercel Production only (`.env.example`; the app refuses a live key anywhere else) |
| Reply-to on the billing-link email | `AGENCY_SUPPORT_EMAIL`, falling back to `hello@bis-rgv.com` in code |
| CI | signs its fixture events with the public literal `whsec_bis_ci_e2e_fixture_only` in `ci.yml`'s e2e job. It verifies nothing anywhere else. **Never put it on Vercel.** Nothing in the code refuses it next to a live key. |

## 1. Live setup (once, before the first live client pays)

Do these in order, after migration 0052 is on production and before (or right
after) PR-3 merges. Until the route is deployed and steps 2 and 4 are done,
every delivery fails (404 before the merge, 503 after it) and Stripe keeps
retrying, for up to three days **(assumption, B6)**.

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
   - **Production only.** Never Preview (it shares production's database) and
     never Development;
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
| 503 | `… STRIPE_WEBHOOK_SECRET is not set …` or `… Stripe key refused here …` | Not configured. | Section 1, steps 2 and 4. |

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
| `another_live_subscription` | The account already has a subscription that has not ended, and this is a different one. **The client may be paying twice.** | Yes: both. | Decide which subscription is right, and cancel and refund the other in Stripe. If the NEW one is right: cancel the old one first (its cancellation is stored), then make BIS read the new one again. |
| `ended_other_subscription` | A late event for an OLD subscription that has already ended (canceled, or expired before its first payment), older than the one stored. | No: it has ended. | Confirm in Stripe that it really is canceled or expired. Nothing else. |
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
of at least 24 hours" **(assumption, B10: Stripe's docs, not re-read)**. So if
a send landed at Stripe but was never stamped, and the row is sent again more
than 24 hours later, Stripe may count it twice. PR-4's nightly reconciliation
is the backstop, and it does not exist yet.

The tripwire is the Work page's banner: "Usage for N client(s) hasn't reached
Stripe in over a day …". The usage report logs the account ids:
`usage report: usage unreported for over 24 hours on N billed account(s):
<ids>`. **While that banner shows (DECISION 6):** before each affected
client's Stripe invoice finalises, open the upcoming invoice by hand. Compare
its usage quantities with the client's Billing card for the same period. If
Stripe's number is higher, the difference was counted twice, so correct the
invoice in Stripe before it finalises **(how Stripe lets a draft invoice be
corrected was not re-read)**.

A separate line, `usage report: N unreported usage row(s) of billed accounts
are older than Stripe accepts (34 days); they will never be billed`, is lost
revenue, not a double charge.

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
