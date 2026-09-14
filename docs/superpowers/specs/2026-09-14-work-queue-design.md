# The work queue — a screen that says what to do next

The dashboard answers "how did we do?". Four KPI tiles, three all-time totals,
a fourteen-day calls chart and a recent-activity feed. Nothing in this product
answers **"what should I do now?"**, and that is the question a business owner
opens an app daily to have answered.

This is Milestone A of the four the 2026-09-14 competitive read proposed
(artifact `4f600fbb-c2bb-4e34-8974-1db59eb43533`). B — letting a finished call
propose its own follow-up — is blocked on this existing to propose into.

## Why this first, and what it switches back on

The `tasks` table has shipped since `0003_crm_core.sql` and renders in exactly
one place: inside a single contact's timeline. There is no tasks route. Nothing
lists what is due across contacts, so nothing can open on it.

That is the expected gap. The unexpected one, found while scoping this:

**The review-request automation has never sent a single message, and cannot,
until a human clicks a button on a different screen.** It selects
`.eq("status", "completed")` (`packages/db/src/automations.ts:218`). Live data
for every booking that has ever existed:

| status | bookings | in the past | review sent |
|---|---|---|---|
| cancelled | 10 | 10 | 0 |
| booked | 7 | 7 | 0 |
| completed | **0** | — | — |
| no_show | **0** | — | — |

Nothing is broken. `setBookingStatus` exists (`booking.ts:301-305`), and the
Calendar screen's booking list has working **Completed** and **No-show**
buttons (`bookings-list.tsx:85-88`). The chain simply contains a human step
that nothing ever asks for, so in seven opportunities it has never happened —
and the highest-ROI feature in the product has been dormant since it shipped.

A work queue is the thing that asks.

## Scope

**In:** one per-account screen, one agency-wide screen, a compact dashboard
row, and the four sources below.

**Out:** assignment and ownership (`tasks.assigned_to` references
`public.users`, which holds **0 rows** — there is nobody to assign to, and
building a user concept is its own milestone); notifications of any kind; a
mobile-specific layout; and any change to how tasks are created on the contact
timeline.

**No migration.** Every column this needs already ships. This is deliberate and
should be preserved through implementation — if a task appears to need a schema
change, that is a signal the design drifted, not a licence to add one.

## 1. What is on the queue

Four sources, unioned and bucketed. Each row carries a stable synthetic id of
the form `<source>:<uuid>` so the UI can key rows without a shared table.

### 1.1 Tasks

`tasks` where `completed_at is null`, scoped to the account. The partial index
`tasks_account_open on (account_id) where completed_at is null` already exists
and is exactly the right one.

`due_at` is **nullable**, and most rows will have no due date. That is why the
screen buckets rather than sorts (§2).

### 1.2 Unreturned calls

`calls` where `outcome in ('lead','message')` and no **outbound** message
exists on that contact after `calls.started_at`.

`outcome` is constrained to `('booked','lead','message','abandoned','spam')`
(`0019_voice_core.sql:53`). `booked` and `spam` need nothing.

**`abandoned` is deliberately excluded.** A hang-up is most often a wrong
number or a robocall, and including it would flood the queue with rows nobody
can act on — which is how a queue loses its reader. This is a one-line change
if real use says otherwise; it is a product judgement, not a technical limit.

"Returned" is defined as *any outbound message on that contact after the call*,
using `messages.direction = 'outbound'`. A returned call that was returned by
telephone rather than by message will still appear; the operator dismisses it
with **Not now** (§3), which is the correct cost for not having outbound call
logging.

### 1.3 Unanswered conversations

`conversations` where `unread_count > 0`. The column already exists and is
maintained today — the forms e2e asserts on the unread badge it drives.

### 1.4 Past bookings not closed out

`bookings` where `status = 'booked'` and `ends_at < now()`.

This row carries two actions rather than one: **Completed** and **No-show**,
both calling the existing `setBookingStatus`. It is the cheapest source to
build and the only one with money behind it — each Completed makes a booking
eligible for a review request on the next cron tick.

## 2. Buckets, not a sorted list

Three groups, in this order:

- **Overdue** — tasks with `due_at < today`
- **Today** — tasks with `due_at` within today, in the account's own timezone
- **Waiting** — everything else: undated tasks and all three derived sources

Within **Waiting**, order **oldest first**. An unreturned call from Tuesday
matters more than one from an hour ago; recency ordering would bury exactly the
rows that have gone stale.

**Only tasks can be Overdue.** A booking that ended three weeks ago is not
placed in Overdue even though it reads as late, and neither is a month-old
unreturned call. Overdue means *someone set a date and it passed*; derived rows
carry a timestamp for when the thing happened, which is not the same claim.
Oldest-first ordering surfaces them at the top of Waiting regardless, so
nothing is buried — this is a naming decision, not a priority one. Implementers
should not "fix" this by promoting stale derived rows into Overdue.

"Today" is resolved in the **account's** timezone (`accounts.timezone`), never
the server's and never the browser's. This repo has a recorded defect in this
exact shape — `Intl` formatting in the system zone rendering the previous day
for American accounts — and the weekly report already resolves account-local
day boundaries; reuse that, do not re-derive it.

A bucket with no rows is **omitted entirely**, not rendered empty. An account
with nothing overdue should not be shown an "Overdue" heading.

## 3. How a row leaves the queue

Tasks complete through the existing `completeTask`.

Derived rows have no row to flip, and the design deliberately does not add one:

- They **disappear when their condition clears** — reply and `unread_count`
  drops to zero; mark the booking and it leaves; message the contact and the
  call is returned. No state to keep in sync, nothing to reconcile.
- **"Not now" writes a real task** against the same contact. The derived row
  then stops matching (the task is what remains), and the dismissal is recorded
  as work somebody owns.

  Concretely, so two implementers do not build two behaviours: the task title
  is the row's own label verbatim — `Call Maria Garcia back`, `Reply to J.
  Ruiz`, `Close out Thursday's job` — and `due_at` is set to **tomorrow at
  09:00 in the account's timezone**. Tomorrow rather than a picker, because a
  dismissal that demands a decision is a dismissal nobody uses; the date is
  editable afterwards from the contact timeline like any other task.

  🔑 The derived row must stop matching once the task exists, or the queue
  shows both. For a booking that is automatic (marking it changes `status`);
  for calls and conversations it is **not** — an open task against the contact
  suppresses that contact's derived rows of the same source. That suppression
  rule is load-bearing and gets its own test.

This is why there is no dismissals table. It also solves the empty-queue
problem from the other side: **dismissing is what first populates `tasks`**, on
accounts where nobody has ever created one by hand.

The acknowledged limit: there is no "never show me this again". A row someone
truly wants gone is dismissed to a task and completed immediately — two clicks.
That is accepted rather than solved, because a table that exists only to
remember negatives earns its keep at a scale this product is nowhere near.

## 4. Two screens

### 4.1 Per-account — `/dashboard/accounts/[accountId]/tasks`

In the **Overview** nav group, next to Dashboard — it is a daily-driver screen,
not a record type, so it does not belong under CRM beside Contacts and
Opportunities.

This takes the in-account sidebar to fourteen destinations, in the same
programme that proposes cutting some (Milestone D). That is a real tension and
is accepted knowingly: D removes screens for features that are switched *off*,
while this is the screen to open every morning.

### 4.2 Agency-wide — `/dashboard/work`

Top level, beside Accounts and Blueprints. Same four sources across every
account, with the account's **`brand_name`** on every row.

🔴 **Agency only.** `requireAgency`, and a client must never reach it. This is
the first screen in the product whose entire purpose is to span tenants, so its
test is a boundary test first and a feature test second: a client user asking
for `/dashboard/work` is redirected, and the query itself is never issued on a
client's behalf.

The row label uses `brand_name`, never `accounts.name` — the internal label
("Rio Roofing — trial") has leaked to customers three times in this codebase.
The agency screen is not a customer surface, but the habit is the protection.

### 4.3 Dashboard row

A compact glass row above the KPI tiles, following `checklist-row.tsx`
exactly — the established pattern for "summary that links to its screen".
Links to §4.1. The metrics stay and move down.

⚠️ **The count is the whole queue, not the dated part.** Only tasks can be
Overdue or Today (§2), and most accounts have no tasks at all — so a row
reading `0 overdue · 0 today` would sit above a queue holding seven unreturned
calls, and would be worse than showing nothing. The row leads with the total
and breaks it down only where a breakdown exists: `7 things to do · 2 overdue`,
falling back to `7 things to do` when none are dated.

When the queue is empty the row says so in one plain sentence rather than
vanishing; a row that disappears reads as a broken feature.

## Copy

Every string goes through `lib/messages.ts` under a `work.` namespace, and
passes the landscaper-at-7am read. "Call Maria Garcia back", not "Unreturned
inbound voice interaction". No milestone codes, no `{{syntax}}`, no arrows.

The screen is named **To do** in the nav.

## Testing

- **Bucketing is the unit under test.** A pure function takes the four source
  arrays plus a reference instant and an IANA zone, and returns the three
  buckets. Every timezone case lives here: the pin is the **account** zone, and
  the test spies the constructor rather than relying on the runner's zone —
  a fixture zone equal to the dev zone cannot discriminate.
- **One named test per source**, each proved by mutation: remove the source
  from the union and the test fails by name.
- **The `abandoned` exclusion gets its own test**, so a later widening is a
  deliberate act with a red test rather than a silent drift.
- **The agency boundary gets an e2e**, on the per-run fixture account, asserting
  a client is redirected away from `/dashboard/work`.
- **A booking marked Completed becomes review-eligible** — the assertion that
  closes the loop this spec opens with.
- Mutating specs run on the per-run `E2E Client Co` fixture. `Test Client One`
  is read-only.

## Rollout

Ships behind no flag. It is additive: a new route, a new nav entry, one new row
on the dashboard, and no change to existing behaviour.

The first thing to check after deploy is **not** the screen. It is whether
`bookings.status = 'completed'` is still zero a week later. If it is, the queue
is not being read, and the problem is placement, not plumbing.

## Decisions on record

- **Derived, not materialised.** No queue table, no background job keeping one
  current. The queue is computed per request from four indexed reads.
- **`abandoned` calls excluded** — product judgement, one line to reverse.
- **No dismissals table** — "Not now" makes a task instead.
- **No assignment** — `users` has 0 rows; ownership is its own milestone.
- **Account timezone, always** — never server, never browser.
- **Agency screen is in scope**, revised mid-design: today `client_access_enabled`
  is false on Bespoke and true only on the test account, so **no real client
  signs in and every user of this software is the agency.** A per-account-only
  queue would have been built for a user who does not exist yet.
