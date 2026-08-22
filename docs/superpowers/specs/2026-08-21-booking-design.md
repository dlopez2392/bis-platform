# Booking — design

**Date:** 2026-08-21
**Status:** approved by danlo in conversation, spec not yet reviewed, not implemented
**Branch:** `docs/booking`, cut from `main` @ `3c6c3c0`

## 1. What & why

The Calendar nav item is one of the six things in a client's sidebar, and it
leads every client to an empty page that says booking "isn't available yet."
This milestone makes it real: a company gets a bookable calendar, a stranger
books a slot from the public page or an embed, the company is alerted the same
way they are alerted about a lead, and the booker is confirmed and reminded.

The roadmap called this module "M2". That label is NOT used here, deliberately:
what shipped under the name M2 was client access, and the numbering drift is
already recorded. The milestone is **Booking**, plainly.

A note on ambition: GoHighLevel's calendar is a ~50-field entity with six
calendar types, round-robin team routing, resources, and a notifications
array. This platform's stated identity is the deliberately simpler tool. Every
cut below is a decision, not an omission.

## 2. Decisions locked with danlo — do not re-litigate

1. **One calendar per company.** The business is the bookable resource —
   "Book an estimate with Rio Roofing" — availability is the company's hours,
   and whoever answers the phone handles the appointment. No staff model, no
   round-robin, no multiple named calendars. A staff dimension can be ADDED
   later; it cannot easily be removed.
2. **Confirmation now + ONE reminder via cron.** Instant branded confirmation
   at booking (existing send path), plus one reminder email ~24h before,
   driven by a Vercel cron hitting an API route every 15 minutes. This is the
   platform's first scheduled-job primitive, and the automation engine
   (roadmap M3) inherits it. Email only — SMS stays blocked on A2P 10DLC.
3. **Full lead treatment.** A booking behaves like a form submission: contact
   created or matched through the existing dedupe, conversation opened with
   the booking details, unread badge, branded alert email to the notify list.
   A booked stranger is the hottest kind of lead, and the operator watches ONE
   screen.
4. **Composed core scope**: public page + embed + cancel link, mirroring the
   forms architecture piece for piece. Not standalone-page-only, and not the
   GHL direction.

## 3. Data — migration 0016

### `calendars` — one row per account

| column | type | notes |
|---|---|---|
| `id` | uuid pk | |
| `account_id` | uuid fk → accounts | **unique** — one calendar per company, enforced by the schema, not convention |
| `public_id` | text | opaque, globally unique — same generator and same collision semantics as `forms.public_id` |
| `enabled` | boolean default **false** | nothing is bookable until someone turns it on |
| `slot_duration_minutes` | int default 60 | |
| `buffer_minutes` | int default 0 | dead time appended after each booking |
| `min_notice_hours` | int default 12 | nobody books five minutes from now |
| `max_advance_days` | int default 30 | horizon of the picker |
| `open_hours` | jsonb | per-weekday intervals, e.g. `{"mon":[["09:00","17:00"]],…}` — ONE set for the company, not per member |
| `notify_emails` | text[] default `{}` | same semantics as forms: empty means the alert goes nowhere, and the checklist warns |
| timestamps | | house pattern |

### `bookings`

| column | type | notes |
|---|---|---|
| `id` | uuid pk | |
| `account_id` | uuid fk | RLS scope |
| `calendar_id` | uuid fk | |
| `contact_id` | uuid fk → contacts | always set — decision 3 |
| `starts_at` / `ends_at` | timestamptz | UTC in the column, account-timezone in every computation |
| `status` | text | `booked` \| `cancelled` \| `completed` \| `no_show` |
| `note` | text | the booker's "what do you need" |
| `cancel_token` | text | opaque, unique — the capability in the confirmation email |
| `reminder_sent_at` | timestamptz null | **the idempotency stamp** — see §7 |
| timestamps | | |

### Double-booking is DB-enforced

```sql
alter table public.bookings add constraint bookings_no_overlap
  exclude using gist (
    calendar_id with =,
    tstzrange(starts_at, ends_at) with &&
  ) where (status = 'booked');
```

Two people submitting the same slot race; the loser gets a constraint
violation surfaced as "that time was just taken — pick another," never a
silent double-book. The app also checks availability before insert, but the
constraint is the guarantee and the app check is UX. Requires the
`btree_gist` extension (for `=` on uuid inside a gist exclusion); the
migration creates it if absent.

### RLS

House pattern: `account_id = app.current_account_id()` for tenant reads and
writes on both tables, plus `app.is_agency()`. **Column grants:** the
`authenticated` role's UPDATE on `calendars` covers the settings columns
(hours, duration, buffer, notice, horizon, enabled, notify_emails) —
calendar settings are the client's business data, client-editable by design
like M4c's branding. `public_id` and `account_id` are NOT granted. Public
booking submits through a server action using `serviceDb()` (the anonymous
booker has no role at all), gated by the calendar being `enabled` — the same
trust shape as the public form's submission path.

## 4. Slot computation — a pure function, tested hardest

`computeSlots(config, existingBookings, now)` → `Slot[]`, dependency-free.
Inputs: open hours, duration, buffer, min-notice, max-advance, the account's
IANA timezone (already on `accounts.timezone` since migration 0001), the
already-booked ranges, and an injected `now`.

- **All day/hour arithmetic happens in the account's timezone** via
  `Intl.DateTimeFormat` with an explicit `timeZone:` — never the system zone.
  The recorded trap this project family has already shipped once: `Intl`
  formats in the SYSTEM zone by default and UTC-anchored dates render the
  previous day everywhere in the Americas. Tests spy/pin the `timeZone`
  argument rather than setting `process.env.TZ` (Node caches the zone; a UTC
  CI box stays green).
- A slot is offered iff it fits inside open hours, clears `min_notice`, is
  inside `max_advance`, and does not conflict with a booked range: a
  candidate conflicts with a booked range when `candStart < bookedEnd +
  buffer` and `bookedStart < candEnd + buffer` — buffer on both sides,
  deliberately conservative (corrected during Task 3 review to match the
  implementation and its tests).
- DST transition days get explicit test cases: the nonexistent hour, the
  repeated hour, and a booking spanning neither.

The booker's browser renders slots in the booker's local time with the zone
labelled ("2:00 PM CDT"); the stored value is the instant, so no conversion
ambiguity survives past the picker.

## 5. Public surface — `/b/<publicId>`, mirroring `/f/<publicId>`

- Anonymous route, branded through the same cached `getBranding` read the
  public form uses, `noindex`, 404 for unknown or disabled ids (404, not a
  sign-in redirect — the smoke check that proves the public path reaches its
  handler, same as forms).
- UI: a week-strip day picker, a slot grid for the chosen day, then
  name / email / phone / note and a confirm step showing the chosen time in
  both the booker's zone and the company's.
- **Embed:** `embed.js` gains the booking variant of what it does for forms —
  a **fixed-height** iframe (`data-min-height`, default 560) and host-page
  attribution. *(Amended at final review: this section originally promised
  auto-height, matching the form embed's own resize-on-postMessage behavior.
  Cut — the booking page has no natural resize signal of its own to auto-fit
  with the way a form's field count does; the week-strip/slot-grid/form
  sequence changes height by user interaction, not by content the embed
  script can observe growing. A fixed, generous default is the shipped
  behavior; auto-height is a recorded follow-up, not a defect.)* The known
  `data-target` gap (GTM injections land at the top of `<body>`) is NOT fixed
  here; it is a recorded forms gap and fixing it once for both is its own
  small change.
- Spam: the same three layers as forms — honeypot, signed fill-time token,
  IP rate limit — reused, not reimplemented.

## 6. On booking — the M1c pipeline, reused

In order, in the submit action:

1. Validate + spam gates.
2. **Contact dedupe** through the existing `findDuplicate` (the one that
   already survived the ILIKE wildcard audit) — same email = same person,
   fields filled but never overwritten. This runs BEFORE the booking insert
   because `bookings.contact_id` is non-null: the row cannot exist without
   its person. If the slot race is then lost, a contact may remain with no
   booking — the same acceptable residue a failed form submission leaves.
3. Availability re-check, then insert the booking carrying `contact_id`; an
   exclusion-constraint violation returns the "just taken" message with
   fresh slots.
4. **Conversation**: open or append, with a booking-details body (when, what,
   the note), so the thread an operator reads carries the appointment.
5. Unread badge fires by the same mechanism as form submissions.
6. **Alert email** to `notify_emails` — branded lead-alert template, subject
   like `New booking: Tue Aug 26, 2:00 PM — Maria Garcia`, with a working
   absolute dashboard link (the forms lesson: a bare path is not a link).
7. **Confirmation email** to the booker — restrained outbound template:
   company brand, the time in the booker's zone alongside the company's, and
   the **cancel link**. (No location line — `accounts` carries no address
   fields, and inventing one is not this milestone's job.)

Events (`booking.created`, `booking.cancelled`, …) emit on every mutation,
house style.

### Cancel

`/b/<publicId>/cancel/<token>` — a page, not a bare action: shows the
booking, one button, then marks `status='cancelled'` (freeing the slot — the
exclusion constraint only binds `status='booked'`), emails the company, and
appends to the conversation. An unknown token 404s; a replayed token (the
link clicked again, or twice, after it already cancelled the booking) renders
an "already cancelled" page instead of 404 *(amended at final review — better
than 404: the booker followed a real link that DID work the first time, and a
second visit finding nothing would read as if the cancel itself had failed)*.
**Reschedule = cancel + rebook.** No separate flow.

## 7. Reminders — the first scheduled job

- `vercel.json` gains a cron entry: every 15 minutes → `/api/cron/reminders`.
- The route authenticates by comparing a `CRON_SECRET` bearer header
  (Vercel's own cron invocations carry it once the env var exists); wrong or
  absent secret → 401 with no body detail.
- Query: `status = 'booked' AND reminder_sent_at IS NULL AND starts_at
  BETWEEN now() + interval '23 hours' AND now() + interval '24 hours 15
  minutes'` — **a window keyed to lead time, not an equality**, so a missed
  tick is caught by the next one rather than lost.
- **Send-then-stamp — deliberately the REVERSE of messaging's
  write-then-send**, because the two writes mean different things. In
  messaging the row is the record of an attempt and must exist before
  anything leaves the building; here `reminder_sent_at` is a DEDUPE MARKER,
  and stamping before a send that then fails would silence the reminder
  forever. Send first; stamp on success; a failed send retries next tick;
  a double-send is prevented by the stamp, not by hope. The route reports
  `{sent, failed}` counts and logs failures with the booking id.
- The reminder email is the confirmation template minus the novelty: the
  time in the booker's zone and the cancel link.

⚠️ Ops note: `CRON_SECRET` must be set in Vercel (Production) and the cron
only runs on production deployments — preview/dev never send reminders, which
is consistent with the send guard (the fake provider suppresses delivery
there anyway).

## 8. Operator surface — the Calendar page becomes real

One page, both audiences (agency and client — RLS and column grants already
make the writes safe):

- **Upcoming bookings, listed and grouped by day** — deliberately NOT a month
  grid. A month grid is a lot of UI for a calendar holding a handful of
  bookings; build it when a client asks. Each row: time, contact (linked),
  note, status, and actions — cancel, mark completed, mark no-show.
- **Calendar settings on the same page**: enabled toggle, open hours editor,
  duration/buffer/notice/horizon, notify list, and the public link + embed
  snippet (copy-paste, same component pattern as the form embed snippet).
- Booking activity appears on the contact timeline through the existing
  activity merge, and the checklist gains nothing new — but
  `checklist.form_notify`'s sibling risk applies: an empty notify list means
  silent bookings, so the settings panel warns inline when it is empty.
- The `empty.calendar.*` strings die.

Copy: every string through `m`, audience-correct voice (the client reads
"your calendar", the agency reads "this company's"), no internal roadmap
labels — `messages.test.ts` enforces that mechanically now.

## 9. Testing

- **`computeSlots` is the heart** and gets the deepest suite: DST spring/fall
  days, buffer arithmetic, min-notice boundary (the slot exactly at the
  boundary), horizon edge, fully-booked day, empty open-hours day, and a
  timezone-pin assertion proving `timeZone:` is passed explicitly. Each
  assertion mutation-named per house rule.
- **The exclusion constraint** proven by racing two inserts for the same
  range in an integration test — one succeeds, one errors, and the error is
  the constraint's name.
- **Cron idempotency**: run the handler twice over the same window; second
  run sends zero. A failed send leaves the stamp null.
- **e2e**: through the real public page — book, see the conversation and the
  booking row appear, cancel via the link, see the slot reopen. Client-side:
  the Calendar page shows the booking and the settings save through RLS.
- The lead-alert-style assertions carry positive AND negative halves — the
  vacuous-absence lesson is a week old.

## 10. Out of scope, recorded

- Staff/team calendars, round-robin, multiple calendars per account
- SMS anything (A2P), Google/Outlook calendar sync, .ics attachments
- Payments at booking, recurring appointments, waitlists
- Configurable reminder schedules (the one 24h reminder is hardcoded)
- Month-grid calendar UI
- The embed `data-target` fix (shared with forms; separate small change)

## 11. Sequencing

The largest milestone since M1c — roughly: migration + accessors · slot
engine · public page · submit pipeline · cancel · emails · cron · operator
page · e2e. Subagent-driven with per-task and whole-branch review, same as
M4d. Blueprints deliberately do NOT capture calendars in this milestone
(capture would clone `public_id` semantics that must stay unique and hours
that are genuinely per-business); if that changes later it follows the forms
exclusion-list precedent.
