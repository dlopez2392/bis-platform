# Weekly report email — design

**Date:** 2026-09-10 · **Branch:** `feat/weekly-report` · **Base:** `b37aa9d`

## Why

The CRM review artifact ("What the CRM is Missing", 2026-09-09) called the
weekly ROI email the cheapest high-value item in the product: the data exists
and the cron already runs. It is a retention feature. A client who sees what
they got last week does not spend Monday wondering what they are paying for.

Two of that artifact's claims were checked against the repo before this spec
and one was wrong, which is worth recording here so nobody re-plans from it:

- Its three "defects" (the 100-contact ceiling, no CSV import, no CSV export)
  were closed by the contacts-data milestone, merged as `b37aa9d`.
- **Review generation, which it calls the highest-ROI feature, was already
  built** when it was written — `reviewRequestPass` is registered on the
  harness with a config UI. The artifact is wrong about that row.

## Decisions

Settled with danlo before writing, in this order:

1. **Audience: both.** Each client gets their own numbers, and the agency gets
   one roll-up across every account.
2. **Recipient: a new account-level list.** There is no account-level email
   recipient today — operator mail (lead alerts, booking alerts, voice
   summaries) goes to `forms.notify_emails`, which is per FORM. Reusing it
   would conflate two audiences, and a client with no form would get nothing.
3. **Content: four numbers with week-over-week deltas.** DESIGN.md rule 1
   already requires a metric to ship with context, and the dashboard pulls
   14-day windows for exactly this reason, so the comparison week is nearly
   free.
4. **A quiet week still sends,** with copy written for it rather than four
   zero rows.

Judgment calls made rather than asked, recorded so they can be reversed
knowingly:

- **No on/off toggle.** The Settings recipients field is the switch: with
  recipients it sends, without them it does not. Nothing extra to build or
  explain.
- **No snapshot table.** Every input is already a timestamped row, so the
  second window the deltas need is just a second query. A `weekly_reports`
  table would make a future reporting screen easier, but that screen is not
  scoped and this would be storage built for it in advance.

### Rejected, and why

- **Clerk for recipients.** `public.users` and `public.memberships` exist from
  migration 0001 and are **completely empty — 0 rows against 3 live accounts.**
  The app never populates them; access runs through Clerk orgs. Emailing
  "the account's members" would mean a new Clerk call in the cron path.
  (This also means the artifact's *record ownership and assignment* gap is
  larger than it looks: there are no user rows to assign anything to.)
- **One pass doing both emails.** Accounts reach their local Monday morning on
  different ticks, so there is no clean moment when "all accounts are done"
  and the roll-up can be assembled.

## The numbers

Each definition is a choice; stating them here is the point.

| Number | Defined as |
| --- | --- |
| Calls answered | calls with `outcome IN ('booked','lead','message')` |
| Leads captured | form submissions with `spam_reason IS NULL`, **plus** calls with `outcome = 'lead'` |
| Bookings made | `listBookingCreationsBetween` |
| Website visitors | sum of `site_traffic_daily.visitors` |

`CallOutcome` is `booked | lead | message | abandoned | spam`. Counting spam
flatters the number; counting abandoned calls the receptionist never handled
overstates it.

Leads deliberately spans both channels. A lead the receptionist took at 9pm is
a lead, and excluding it would undercount the thing being sold. The cost is
that a client comparing this email against their form inbox will see a larger
number here; the copy says "leads captured", not "form submissions".

**A zero we measured and a zero we did not measure must not look the same.**
The website line is **omitted entirely** for an account with no linked site,
never rendered as `0 visitors`. One account has a site today; the rest would
otherwise receive a weekly report that their website is dead.

## Schema

One migration, five columns. No data migration, no backfill.

```
accounts.report_emails       text[] not null default '{}'
accounts.weekly_report_week  date                    -- the Monday last sent for
agencies.report_email        text                    -- nullable, see below
agencies.timezone            text                    -- the roll-up's gate zone
agencies.weekly_report_week  date
```

`agencies.report_email` is nullable and has no editing screen — there is no
agency settings surface and one row does not justify building one. The pass
counts `skippedNoRecipient` when it is unset, so an unset address fails
visibly. The value is set by a one-off `UPDATE`. **Known limitation, stated
rather than hidden:** changing it later is a SQL edit, not a screen.

`agencies.timezone` exists because the agency row has no zone and the roll-up
needs one to gate on. A hardcoded `America/Chicago` inside a pass would be the
same value with nowhere to change it.

## Architecture

Two passes over one shared metrics function, registered in
`lib/automations/registry.ts`. This follows `siteTrafficPass`, which is the
closest existing precedent: a data-layer query returns only what is due
carrying the account's timezone, then the pass gates, acts and stamps per row
with named counters.

### `weeklyMetrics(db, accountId, window)`

The single source of every number. Both emails call it, so the roll-up row for
a client and the email that client received cannot disagree.

### `weeklyClientReportPass`

- `listAccountsDueWeeklyReport(db)` returns accounts with at least one
  `report_emails` entry, carrying `timezone` and `weekly_report_week`. An
  account with no recipients is never a row, so it can never be a failure.
- **Gate:** Monday, 08:00–11:00 in the account's own zone, via
  `resolveAccountZone`, **fail closed** on an unresolvable zone with its own
  counter. Identical to the review-request and site-traffic rule: no hour is
  defensible without a zone.
- **Window:** the previous Monday–Sunday in that account's zone, plus the week
  before it for deltas.
- **Send, then stamp** through `stampWithRetry`. A send failure does not stamp
  and retries on the next tick inside the band. A stamp failure after a
  successful send counts `unstamped` — the reminders precedent, which errs
  toward a duplicate over silence and makes it visible.
- Per-account `try/catch`; `AUTOMATION_TICK_CAP` applies.
- **One message per account, not per recipient.** Every address in
  `report_emails` goes in the `to` of a single send: they are colleagues
  looking at one business's numbers, not separate customers, and one send
  keeps the stamp meaning exactly one thing.
- **Counters:** `{ sent, failed, skippedNotMonday, skippedAlreadySent,
  skippedCap, unresolvableTimezone, unstamped }`.

**A missed band is a missed week.** The gate is three hours wide and the cron
ticks every 15 minutes, so an outage spanning the entire band means that
week's report never sends and is not retried later — sending Thursday's
"here's how last week went" is worse than not sending. This matches the
booking milestone's recorded decision that an outage longer than the reminder
window permanently misses that reminder. Accepted for v1, recorded here.

### `weeklyAgencyReportPass`

One row, one send, gated the same way on `agencies.timezone`. Computes **each
account's week in that account's own zone** through the same `weeklyMetrics`,
and reports every account — including those with no `report_emails`, marked as
such, so a client silently receiving nothing is visible.

**Recorded consequence:** the roll-up fires on its own gate, not after all
client emails. With every account in US zones the difference is a couple of
hours and each account's numbers are still computed in its own zone. A client
outside the US could be caught mid-week.

## The emails

`weeklyReportEmail` and `agencyRollupEmail`, both built on
`shell(brand, bodyHtml)`. Operator-facing mail may spend structure — there is
no deliverability cost to a table here, unlike a message a customer receives.

The client's email carries **the client's own brand** via `brandDisplayName`,
never `accounts.name`. That internal label has escaped to customers three times
in this codebase; the brand-name resolver exists to stop it.

### Normal week

> **Subject:** Last week: 12 calls, 4 new leads
>
> Here's how last week went.
>
> **12** calls answered — 3 more than the week before
> **4** leads captured — same as the week before
> **2** bookings — 1 fewer than the week before
> **86** website visitors — 12 more than the week before
>
> [Open your dashboard]

Deltas are **words, not arrows**: "3 more than the week before", "1 fewer",
"same as". A bare arrow is meaningless in the text/plain part, unreadable to a
screen reader, and renders inconsistently across mail clients.

### Quiet week

> **Subject:** Last week was quiet
>
> Nothing came in last week — no calls, no leads, no bookings.
>
> Sofía is still answering, and your missed-call text-back is still on.
>
> [Open your dashboard]

The reassurance line is claimed **only when it is true of that account**. An
account without the receptionist or without text-back does not get told it has
them.

### No prior week means no delta

When the comparison window starts before `accounts.created_at`, the delta
phrase is **omitted entirely** and the number ships alone. An account that is
eight days old has no honest "week before".

## Settings

A "Weekly report" card on the account's Settings page, modeled on
`sending-address-card.tsx`, editing `report_emails` as a comma-separated input
— the shape clients already know from a form's notify field — **validated with
`isValidEmail`** from `@/lib/forms/guards`, which that field is not.

The same validation is applied to the forms notify field in the same change.
That is a parked minor from the booking milestone recorded as "close BOTH
later"; writing the identical guard two files away is the moment to close it.

## Testing

This feature is mostly date math, which is where this project has been bitten
most.

- **The Monday gate gets one instant, two zones, opposite verdicts** — a
  timestamp that is Monday 09:00 in one zone and Sunday 23:00 in another must
  send for one account and not the other. A fixture zone equal to the dev
  machine's zone cannot discriminate.
- **Week boundaries across a DST transition** — the window is seven local
  days, not 168 hours.
- **Delta phrasing** — more / fewer / same, and omitted on no prior week.
- **The website line is absent, not zero,** for an account with no site.
- **Real-database tests** for `listAccountsDueWeeklyReport`, including that an
  account with no recipients is not a row, and column grants.
- **Mutation checks, each with a named failing test:** drop the stamp → a
  double-send test fails; drop the Monday check → it sends on a Tuesday; drop
  the `created_at` guard → a fabricated delta appears.
- No e2e for the send itself — it is a cron path with no UI. The Settings card
  gets one.

## Out of scope

Named so they are not quietly absorbed: a reporting screen with a date range,
a `weekly_reports` history table, an agency settings screen, resend/preview of
a past report, per-recipient unsubscribe, and any change to what the dashboard
itself displays.

## Open

The value of `agencies.report_email` — danlo confirms the address, then a
one-off `UPDATE` sets it. The pass is honest about the unset state until then.
