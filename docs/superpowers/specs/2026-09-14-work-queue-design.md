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

### 1.2 Unreturned calls — WITHDRAWN 2026-09-14, before implementation

**This source does not exist. It was specified, found broken in review, and
removed rather than repaired.** The record is kept because the reasoning
governs §1.3.

It was to be: `calls` where `outcome in ('lead','message')` and no **outbound**
message exists on that contact after `calls.started_at`.

🔴 **That rule can never match.** The platform's own missed-call text-back
writes an outbound SMS on the contact's conversation seconds after the call
ends (`apps/web/src/lib/voice/finish-call.ts:388-390`), so every returnable
call marks itself returned immediately. `createMessage` does not persist an
author on the `messages` row — `actorId`/`actorType` reach `emit()` only — so
the platform's own sends cannot be filtered out without a schema change, which
the zero-migration constraint forbids.

**Withdrawn in favour of §1.3 carrying the work**, which is the better design
rather than a workaround: `finishCall` already writes the call's summary as an
**inbound** message and bumps `unread_count` (`finish-call.ts:226-237`), so an
unreturned call is *already* an unanswered conversation — and `unread_count`
dropping when somebody reads the thread is a truer "handled" signal than the
existence of an outbound row.

🔑 **The `abandoned` exclusion is therefore also withdrawn**, and its test
deleted rather than retained. `isMeaningful` (`finish-call.ts:99-101`) is
`booked || lead || message`, so a hang-up never writes an inbound message and
never bumps `unread_count`. The exclusion is enforced structurally upstream,
and a test over code that can no longer break is theatre — this repo has a
recorded lesson about exactly that.

**The queue therefore has three sources, not four.**

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

Since §1.2 was withdrawn, this source also carries unreturned calls. The row's
**title is the most recent call's `summary`** for that conversation, where one
exists, so the queue still reads "Maria called about a quote" rather than a
bare contact name. One extra account-scoped read for the whole batch, never
one per row.

### 1.4 Past bookings not closed out

`bookings` where `status = 'booked'` and `ends_at < now()`.

This row carries two actions rather than one: **Completed** and **No-show**,
both calling the existing `setBookingStatus`. It is the cheapest source to
build and the only one with money behind it — each Completed makes a booking
eligible for a review request on the next cron tick.

**Both outcomes are terminal — no un-complete, no un-no-show, and Task 4
deliberately ships no confirmation dialog for either.** Recorded here because
otherwise it is only discoverable by reading the automations and booking
modules directly:
- **Flipping a booking's status back can collide with `bookings_no_overlap`.**
  The row's slot is not reserved once it leaves `booked` — another booking can
  legitimately take the same time — so reopening it is not a guaranteed-safe
  operation the way reopening a task is; it can fail outright, and "sometimes
  works" is worse than "doesn't exist."
- **The review-request (and no-show-nudge) automation may already have fired
  on an intervening scheduled run** by the time anyone would think to undo the
  click — the cron tick that reads `status = 'completed'` does not wait for a
  human to confirm the click was intentional. An undo button that cannot undo
  the message already sent would be a false promise, worse than no undo
  button at all.
No confirmation dialog either, per DESIGN.md rule 6 (reflexive "Are you sure?"
dialogs are banned) — the two buttons are differentiated visually instead
(destructive for No-show) and the toast on each names the outcome recorded,
so a wrong click is caught immediately rather than guarded against upfront.

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

Top level, beside Accounts and Blueprints. Same three sources across every
account (§1.2: the fourth, unreturned calls, was withdrawn before
implementation — the rule it needed could never match, and its work is
already carried by §1.3's unanswered conversations instead), with the
account's **`brand_name`** on every row.

🔴 **Agency only.** `requireAgency`, and a client must never reach it. This is
the first screen in the product whose entire purpose is to span tenants, so its
test is a boundary test first and a feature test second: a client user asking
for `/dashboard/work` is redirected, and the query itself is never issued on a
client's behalf.

The row label uses `brand_name`, never `accounts.name` — the internal label
("Rio Roofing — trial") has leaked to customers three times in this codebase.
The agency screen is not a customer surface, but the habit is the protection.
`brandDisplayName` (`packages/db/src/branding.ts`) takes no second argument to
fall back to, deliberately, so there is nothing here for a future edit to pass
`name` into even under pressure; a blank `brand_name` (unreachable through the
product today — migration 0028 backfilled it) reads as a neutral placeholder
in the UI, not as the internal label and not as an empty caption.

**Suppressed accounts still appear on this screen, marked (danlo, 2026-09-15).**
`outbound_suppressed` (migration 0032) no longer excludes an account from
`listAgencyWork` — dropping the account made a blank queue on a suppressed
account indistinguishable from a finished one, on the exact account (newest,
pending carrier registration) most likely to have real customers waiting. Every
row from a suppressed account carries `suppressed: true`, and the row is
marked right where the company is identified — the brand-name caption — dot
plus word (rule 3), never color alone. Nothing about actual outbound sending
changes; this is a read-only screen, and the mark exists so the agency sees
the work and knows not to text.

**Company blocks within a bucket rank by urgency, not account id or read
order (danlo, 2026-09-15).** Rows are grouped by account inside each bucket,
and the account blocks are then ordered by that account's own MOST URGENT
row in that bucket — the same comparator that already sorts the rows
themselves (`due_at` ascending for Overdue/Today, oldest-first for Waiting),
never a second, different notion of urgency. Ties break on `accountId`
ascending, so two equally-urgent companies never swap order between renders.

### 4.3 Dashboard row

A compact glass row above the KPI tiles, following `checklist-row.tsx`
exactly — the established pattern for "summary that links to its screen".
Links to §4.1. The metrics stay and move down.

⚠️ **The count is the whole queue, not the dated part.** Only tasks can be
Overdue or Today (§2), and most accounts have no tasks at all — so a row
reading `0 overdue · 0 today` would sit above a queue holding seven unreturned
calls, and would be worse than showing nothing. The row leads with the total
and breaks it down only where a breakdown exists: `7 things to do · 2 overdue`,
falling back to `7 things to do` when none are dated. A total of exactly one
takes its own singular phrase, never the plural template with the number
swapped in: `1 thing to do`, or `1 thing to do · 1 overdue`. One is not an
edge case here — §3's dismiss-to-task action is what first populates `tasks`
on an account that has never created one by hand, so one is the first
non-zero state most accounts reach.

When the queue is empty the row says so in one plain sentence rather than
vanishing; a row that disappears reads as a broken feature.

## Copy

Every string goes through `lib/messages.ts` under a `work.` namespace, and
passes the landscaper-at-7am read. "Call Maria Garcia back", not "Unreturned
inbound voice interaction". No milestone codes, no `{{syntax}}`, no arrows.
Any string that carries a count needs a singular twin — a whole-phrase pick by
count, never a plural template reused for a count of one (the same shape as
`contacts.count`/`contacts.countOne`, and see that key's own comment in
`messages.ts` for the "1 people" bug this convention exists to prevent). The
landscaper-at-7am read alone did not catch this the first time a `work.`
string shipped without one, so it is named here explicitly rather than left
implicit in the read.

The screen is named **To do** in the nav.

## Testing

- **Bucketing is the unit under test.** A pure function takes the three source
  arrays plus a reference instant and an IANA zone, and returns the three
  buckets. Every timezone case lives here: the pin is the **account** zone, and
  a fixture zone equal to the dev zone cannot discriminate — so the test runs
  ONE instant through TWO zones and asserts opposite verdicts, which no fixed
  or ambient zone can satisfy. (Delegating the zone read to `partsInZone`
  turned out to make constructor-spying unnecessary; the two-zone pair is the
  stronger pin anyway.)
- **The two-zone shape above binds every consumer of the account's zone, not
  only `bucketWork`.** The row's rendered date and "Not now"'s due-date write
  (`tomorrowAt9`) both read the same account zone and both need the same
  one-instant-two-zones proof, on pain of a fixture that happens to run on
  the developer's own system zone (America/Chicago, here) quietly certifying
  nothing. It binds `tomorrowAt9` most of all: bucketing and the row date are
  read paths that get a fresh chance to be right on every request, but
  `tomorrowAt9` feeds a WRITE — the only one of the three that turns the
  account's zone into a stored value (`due_at`). A wrong answer there is not
  refreshed away on the next page load; it is a row sitting in the wrong
  bucket until someone notices and hand-edits the task. (This is the gap
  `dismiss-date.test.ts` shipped with: its first case exercised only Chicago,
  which is also the dev machine's system zone, so it could not tell a real
  zone-aware read from a system-zone read wearing an unused parameter.)
- **A helper making more than one named claim needs one mutation per claim.**
  `tomorrowAt9` makes two: "uses the ACCOUNT's zone, not the server's" and
  "crosses a DST boundary without drifting an hour." The prescribed mutation
  in the Task 4 plan tested only the DST claim (replacing the zone-aware
  conversion with a flat `+86_400_000`) — a real, useful check, but blind to
  the first claim, which is exactly why it shipped unpinned. One mutation per
  claim a helper's own doc comment or name asserts, not one mutation per
  helper.
- **It must degrade, not throw — and this binds the whole route, not just
  `bucketWork`.** An invalid IANA zone reaches this screen today —
  `create-account-dialog.tsx:80` is a free-text input and
  `accounts/actions.ts:13` passes it through unchecked. The account's zone has
  a second consumer besides bucketing: the row's own rendered date. Neither
  consumer may fall back to UTC or the server's zone, anywhere, ever — a
  silent one would reintroduce the previous-day defect this repo has already
  shipped. On a bad zone, bucketing sends every row to Waiting rather than
  classifying it, and the date beside each row is OMITTED rather than
  guessed; on an unparseable `due_at`, only that one row degrades. A row that
  cannot be dated must still say "Waiting" without also claiming a specific
  day it cannot back up.
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
