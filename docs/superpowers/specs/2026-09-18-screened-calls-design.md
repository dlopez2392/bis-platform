# Screened calls — surfacing the refusals the product currently forgets

**Date:** 2026-09-18 · **Branch:** `feat/surface-refused-calls` · **Base:** `177be5b`
**Status:** Design approved by danlo, 2026-09-18. Ready to plan.

## Why

A refused inbound call leaves no trace in the product. `texml/route.ts` writes a
`console.log` line and hangs up; no `calls` row is created, nothing appears on
any screen, and nothing is queryable after the log rotates.

Two consequences, and the second is the one that matters:

1. **A false positive on a real customer is undiscoverable.** Guard 2
   (`decideReputation`) blocks a caller whose entire recent history on an
   account is silent calls. If it ever misfires on a real person, the only
   evidence is one server log line. 956 Woodworks took eight robocalls in a day
   on 2026-09-17, so this guard is live against real traffic on a real client.
2. **A misconfigured number turns every caller away, silently.** A number whose
   status is not `live`/`testing`, or an account whose voice profile is
   disabled or missing, refuses *everyone* — and no screen, report or alert says
   so. That is an outage on a paying client that the product does not notice.

The spam-screening spec (2026-09-15) recorded the first as "a worthwhile
follow-up" and accepted the invisibility as consistent with existing behaviour.
This is that follow-up, and it turns out the second consequence is larger.

## The six refusals, and what is recordable

`routability()` in `apps/web/src/app/api/voice/texml/route.ts` produces four
refusal kinds across six distinct causes:

| Cause | Log today | `account_id` known? | `phone_number_id` known? |
|---|---|---|---|
| Number belongs to nobody | `refuse-unknown` | **no** | **no** |
| Number we own, not `live`/`testing` | `refuse-unknown` | yes | yes |
| No voice profile | `refuse-disabled` | yes | yes |
| Voice profile disabled | `refuse-disabled` | yes | yes |
| Over the daily cap | `cap` | yes | yes |
| Repeat spam | `blocked (repeat-spam)` | yes | yes |

Two collapses in that column are defects of their own. `refuse-unknown` merges
a wrong number (nothing to do) with our own misconfiguration (an outage).
`refuse-disabled` merges "never set up" with "deliberately turned off", which
is the `gate.reason` threading already recorded as a deferred follow-up in the
ledger. This design un-collapses both.

**`calls.account_id` and `calls.phone_number_id` are both `NOT NULL`**, so the
first row in that table is not representable as a `calls` row at all.

## The decision that shapes everything: NOT a `calls` row

Two findings, both verified in the code, make reusing `calls` actively
dangerous rather than merely untidy.

**`countCallsSince` (`packages/db/src/voice.ts:403`) counts every `calls` row
for an account since an instant, unfiltered by outcome.** It feeds `decideLimit`
via `forAccount` — the daily cap that declines real callers — and the Calls
page usage meter. Refusals stored as `calls` rows would let a robocall wave
consume a client's daily call limit and start declining genuine customers. The
guard would cause the outage it exists to prevent.

**`decideReputation` disarms on a single non-spam call**
(`apps/web/src/lib/voice/caller-reputation.ts:130`):

```ts
if (history.otherCalls > 0) return { blocked: false };
```

`otherCalls` is `countCallerHistorySince`'s `.neq("outcome", "spam")` branch. A
refusal written as a `calls` row with any new outcome would therefore count as
`otherCalls` and **un-block that caller for the rest of the window on the very
first block** — the guard would disable itself against a robocaller the moment
it worked, silently, and in the direction of letting spam through.

Writing them as `outcome: "spam"` instead is not a fix: the spam branch also
requires `.gte("turn_count", 1)`, and a refused call has zero turns, so such a
row would be invisible to both branches by accident. Correct today, fragile
forever — one change to that `turn_count` filter flips it.

A separate table touches none of this: no cap, no reputation feedback, no KPI,
no weekly-report metric, no work queue, no text-back window.

## Data

New table `screened_calls`:

| Column | Type | Notes |
|---|---|---|
| `id` | uuid pk | |
| `account_id` | uuid **null** | FK `accounts`. Nullable is load-bearing — it is what makes the wrong-number case recordable at all. |
| `phone_number_id` | uuid **null** | FK `phone_numbers`, same reason. |
| `called_e164` | text not null | Always known; it is the key we looked up. |
| `caller_e164` | text null | A withheld caller ID is a real shape, not an error. |
| `reason` | text not null | One of the six below. |
| `created_at` | timestamptz not null default now() | |

`reason` ∈ `unknown-number` · `not-live` · `no-profile` · `profile-disabled` ·
`over-cap` · `repeat-spam`.

**The class is DERIVED from the reason, never stored.** One exported mapping
function is the single source of truth; a stored class column would be a second
one, free to disagree. Classes:

- **`misconfigured`** — `not-live`, `no-profile`, `profile-disabled`. Our fault.
  Reaches the work queue banner.
- **`screened`** — `over-cap`, `repeat-spam`. Working as designed. Log only.
- **`unattributed`** — `unknown-number`. Nobody's account. Log only.

### RLS and grants

**As shipped in 0039, this is grants-only — no policy at all** — the shape
`0036_alert_phone_verifications.sql` established for a table only the server
touches, not the `app.is_agency()` policy this section originally proposed.
RLS is enabled (so a future `grant select ... to authenticated` cannot
silently open the table), `anon` and `authenticated` are revoked entirely,
and only `service_role` is granted `select, insert, delete`. No in-app caller
needs the `authenticated` grant at all: the agency list runs
`requireAgency()` then reads through `serviceDb()`, the pattern
`/dashboard/numbers` already uses for a cross-tenant screen.

This is strictly stronger than a policy. With no grant, a client asking for
this table gets `PERMISSION DENIED` at the ACL layer, before Postgres ever
reaches RLS — not zero rows from a policy that evaluated `app.is_agency()`
and came back false. A denied-by-ACL result cannot be defeated by a future
query that forgets a filter, and there is no policy for a later migration to
loosen. Do not add an `app.is_agency()` (or any other) policy on top of this:
there is no role left for one to serve, and a policy appearing here would
mean a grant to `authenticated` appeared with it — the change to stop, not to
make. The audience decision is still enforced in the database rather than in
a query someone can forget to write; it is just enforced one layer earlier
than this section originally described.

## Where the write happens

Inside `after()` in the TeXML route — the pattern `incoming/route.ts:1035`
already establishes, with the same justification ("so it never delays the
webhook's own 200"). This route sits on Telnyx's carrier answer deadline and
its own comments say wall-clock is the thing it cannot spend.

**Best-effort, and that is a contract, not a caveat.** A failed write **or a
failed schedule** logs and changes nothing: not the refusal, not the spoken
copy, not the hang-up. A caller's experience must never depend on our
bookkeeping. The existing log lines stay exactly as they are — the table is
added evidence, not a replacement, and the logs are what remain if the write
itself is broken. (`after()` has its own synchronous throw paths, distinct
from the write callback rejecting — a failure to SCHEDULE the write is caught
around the `after()` call itself, not only inside its callback.)

## Screens

### Screened calls (new, agency-only)

A new route `/dashboard/screened`, registered in `nav-groups.ts` as a top-level
entry alongside `/dashboard/accounts`, `/dashboard/blueprints`,
`/dashboard/work` and `/dashboard/numbers`. Gated by `requireAgency()`, the
same guard the other four carry. It must also be registered in the command
palette index, per DESIGN.md's ⌘K pattern.

- Cursor paging, never offset; exactly ONE pager; the header states a real
  total, not the number on screen (DESIGN.md, paged lists).
- Each row: when, account, called number, caller, reason.
- Timestamps render in **the account's own zone** through `renderZone`, with the
  zone named — the rule the five date screens now follow. The `unknown-number`
  rows have no account, so they resolve through the agency's zone and say so.
- Reason is a **dot + word**, never colour alone (DESIGN.md rule 3).
- Designed loaded / empty / error states. The empty state sells the feature:
  what appears here and what causes it.

### Agency work queue banner (derived)

A banner above the queue on `/dashboard/work`: *"2 numbers are turning callers
away."* It counts
DISTINCT numbers with a `misconfigured` refusal in the last 24 hours, and links
to the screened list filtered to that class.

**Derived, never stored, and that is the design.** When the number goes live the
refusals stop and the banner clears itself on the next render. There is no task
to stamp, complete, dismiss or forget, and therefore no state that can go stale
and lie. It is also why this adds no new `WorkSource` — a new source would
ripple into `bucketWork`, the per-account queue and both list components to
model something that is not a task.

## Testing

Each proven by mutating the code it guards until a test named for that claim
fails.

**The boundary that matters: a client can never read `screened_calls`.** A
grants-layer proof, not an app-level filter — the app-level filter is not the
control, the grant is: as shipped, `authenticated` holds no privilege on this
table at all, so the assertion is that the client role gets `PERMISSION
DENIED` (ACL refusal, before RLS is even consulted), not that a policy
returns zero rows.

**The defect this whole shape exists to avoid:** seed `screened_calls` rows,
then assert `countCallsSince` and `decideReputation` return byte-identical
results. This gets the sharpest mutation, because the failure mode is silent
and points toward letting robocallers through.

Alongside:

- The write happens in `after()`, not on the answer path — following
  `lifecycle.test.ts`'s existing harness for exactly this. This is the claim
  that actually needs pinning: both responses in a same-request comparison are
  captured before `after()`'s callback ever runs, so an equality assertion
  there cannot distinguish "written before responding" from "written after" —
  only an ordering assertion (recorder not yet called at response time, called
  once after the flush) can. Mutation: await `recordScreenedCall` inline on
  the answer path.
- A write that REJECTS is swallowed inside the `after()` callback's own
  try/catch — proven by asserting the console.error spy fired, not by
  comparing two responses (see above for why that comparison can't fail).
  Mutation: remove the try/catch inside the callback.
- A throw from scheduling the write — `after()` itself, before its callback
  ever runs — is also caught, so it cannot replace the refusal document with a
  500. Mutation: remove the try/catch around the `after()` call.
- Each of the six reasons is produced by the branch that claims it, one
  mutation per reason. The two un-collapsed pairs get particular attention:
  `not-live` vs `unknown-number`, and `no-profile` vs `profile-disabled`.
- The class mapping: a `misconfigured` reason raises the banner count and a
  `screened` reason does not.
- The banner is derived — refusals stop, banner clears, with nothing stamped.
- A `null` `account_id` row renders on the list without throwing, and is
  excluded from the per-account banner count.

Any test that writes runs on the per-run fixture account, never `Test Client
One` or a live account.

## Out of scope

Named so they are not quietly absorbed: changing anything a caller hears;
showing refused calls to clients; inbound texts (no spam concept, and no bill
behind them); unblocking a caller from the UI; per-account screening
configuration; and any change to how `decideReputation` or `decideLimit` decide.

## Known properties, accepted

- **No retention policy.** Observed volume is ~8 refusals a day at peak on one
  account. The list pages and the banner's window is 24 hours, so growth costs
  nothing operationally. Recorded rather than engineered for; revisit if a
  dialer ever makes the table large.
- **The unattributed rows have no account**, so they appear on the agency list
  and in no per-account view. That is correct — the call was to a number this
  platform does not own.
- **This does not tell you a block was WRONG**, only that it happened. Deciding
  a refusal was a false positive still needs a human reading the caller number.
  A "this was a real customer" affordance is a follow-up, not this work.
- **A SEVENTH refusal exists that this table cannot see.** `dialXml`
  (`route.ts:276`) speaks a configuration-error sentence and hangs up when
  `VOICE_OPENAI_PROJECT_ID` is missing. It is classified `kind: "dial"`,
  writes no row, and is the only refusal that hits EVERY account at once — a
  platform-wide outage, not a per-tenant one — so the work-queue banner (which
  counts numbers, per account) cannot see the one outage that takes the whole
  platform down. Recorded here; not fixed by this work.
